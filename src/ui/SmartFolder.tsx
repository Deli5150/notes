import { useMemo, useState } from 'react'
import { allTags, matchesSmart } from '../lib/query'
import { useStore } from '../lib/store'
import { useUi } from '../lib/ui'
import type { DateRange, Folder, SmartFilter } from '../lib/types'
import { openDialog } from './overlays'

// Smart Folders, as in Apple Notes: notes from every folder that match tags, dates, checklists,
// attachments, locked, pinned, Quick Notes and folders.

const DATE_CHOICES: Array<{ label: string; value: string; range?: DateRange }> = [
  { label: 'Any time', value: '' },
  { label: 'Today', value: '1', range: { lastDays: 1 } },
  { label: 'Last 7 days', value: '7', range: { lastDays: 7 } },
  { label: 'Last 30 days', value: '30', range: { lastDays: 30 } },
  { label: 'Last 90 days', value: '90', range: { lastDays: 90 } },
  { label: 'Last year', value: '365', range: { lastDays: 365 } }
]

const emptyFilter = (): SmartFilter => ({ match: 'all', tags: [], tagMode: 'any' })

type TriState = '' | 'yes' | 'no'
const tri = (v: boolean | undefined): TriState => (v === undefined ? '' : v ? 'yes' : 'no')
const fromTri = (v: TriState): boolean | undefined => (v === '' ? undefined : v === 'yes')

function Editor({ folder, close }: { folder?: Folder; close: () => void }) {
  const notes = useStore((s) => s.notes)
  const folders = useStore((s) => s.folders)
  const [name, setName] = useState(folder?.name ?? 'Smart Folder')
  const [f, setF] = useState<SmartFilter>(folder?.smart ?? emptyFilter())
  const tags = useMemo(() => allTags(notes), [notes])
  const count = useMemo(() => notes.filter((n) => !n.deletedAt && matchesSmart(n, f, folders)).length, [notes, f, folders])
  const set = (patch: Partial<SmartFilter>) => setF((x) => ({ ...x, ...patch }))
  const plain = folders.filter((x) => !x.smart)

  const save = () => {
    const s = useStore.getState()
    if (folder) s.updateFolder(folder.id, { name: name.trim() || 'Smart Folder', smart: f })
    else {
      const created = s.createFolder(name, undefined, f)
      useUi.getState().select({ kind: 'folder', id: created.id })
    }
    close()
  }

  return (
    <div className="smart">
      <div className="alert-title">{folder ? 'Edit Smart Folder' : 'New Smart Folder'}</div>
      <label className="form-row">
        <span>Name</span>
        <input className="field" value={name} onChange={(e) => setName(e.target.value)} autoFocus />
      </label>
      <label className="form-row">
        <span>Include notes matching</span>
        <select className="field" value={f.match} onChange={(e) => set({ match: e.target.value as 'all' | 'any' })}>
          <option value="all">all selected filters</option>
          <option value="any">any selected filter</option>
        </select>
      </label>
      <div className="form-section">Tags</div>
      <div className="form-row">
        <select className="field" value={f.tagMode} onChange={(e) => set({ tagMode: e.target.value as SmartFilter['tagMode'] })}>
          <option value="any">Any of these tags</option>
          <option value="all">All of these tags</option>
          <option value="none">None of these tags</option>
        </select>
      </div>
      <div className="tag-chips">
        {tags.length ? (
          tags.map(({ tag }) => {
            const on = f.tags.includes(tag)
            return (
              <button key={tag} className={`chip${on ? ' is-on' : ''}`} onClick={() => set({ tags: on ? f.tags.filter((t) => t !== tag) : [...f.tags, tag] })}>
                #{tag}
              </button>
            )
          })
        ) : (
          <span className="dim">Type #tags in your notes to filter by them.</span>
        )}
      </div>
      <div className="form-section">Other filters</div>
      <label className="form-row">
        <span>Date created</span>
        <select className="field" value={String(f.created?.lastDays ?? '')} onChange={(e) => set({ created: DATE_CHOICES.find((d) => d.value === e.target.value)?.range })}>
          {DATE_CHOICES.map((d) => (
            <option key={d.value} value={d.value}>
              {d.label}
            </option>
          ))}
        </select>
      </label>
      <label className="form-row">
        <span>Date edited</span>
        <select className="field" value={String(f.edited?.lastDays ?? '')} onChange={(e) => set({ edited: DATE_CHOICES.find((d) => d.value === e.target.value)?.range })}>
          {DATE_CHOICES.map((d) => (
            <option key={d.value} value={d.value}>
              {d.label}
            </option>
          ))}
        </select>
      </label>
      <label className="form-row">
        <span>Checklists</span>
        <select className="field" value={f.checklists ?? ''} onChange={(e) => set({ checklists: (e.target.value || undefined) as SmartFilter['checklists'] })}>
          <option value="">Don’t filter</option>
          <option value="any">Has a checklist</option>
          <option value="unchecked">Has unchecked items</option>
          <option value="checked">Has checked items</option>
        </select>
      </label>
      {(
        [
          ['attachments', 'Attachments', 'Has attachments', 'No attachments'],
          ['locked', 'Locked notes', 'Locked', 'Not locked'],
          ['pinned', 'Pinned notes', 'Pinned', 'Not pinned'],
          ['quickNotes', 'Quick Notes', 'Only Quick Notes', 'No Quick Notes']
        ] as const
      ).map(([key, label, yes, no]) => (
        <label key={key} className="form-row">
          <span>{label}</span>
          <select className="field" value={tri(f[key])} onChange={(e) => set({ [key]: fromTri(e.target.value as TriState) })}>
            <option value="">Don’t filter</option>
            <option value="yes">{yes}</option>
            <option value="no">{no}</option>
          </select>
        </label>
      ))}
      <label className="form-row">
        <span>Folders</span>
        <select
          className="field"
          value={f.folders?.[0] ?? ''}
          onChange={(e) => set({ folders: e.target.value ? [e.target.value] : undefined })}
        >
          <option value="">Any folder</option>
          {plain.map((x) => (
            <option key={x.id} value={x.id}>
              {x.name}
            </option>
          ))}
        </select>
      </label>
      <div className="smart-count">{count === 1 ? '1 note matches' : `${count} notes match`}</div>
      <div className="alert-buttons">
        <button className="btn" onClick={close}>
          Cancel
        </button>
        <button className="btn btn-primary" onClick={save}>
          {folder ? 'Save' : 'Create'}
        </button>
      </div>
    </div>
  )
}

export function openSmartFolder(folder?: Folder): void {
  openDialog((close) => <Editor folder={folder} close={close} />, { dismissable: false })
}
