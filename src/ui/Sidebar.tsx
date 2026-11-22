import { ChevronRight, Cloud, CloudOff, Folder as FolderIcon, FolderCog, MessageSquareText, Notebook, NotebookPen, Plus, Settings, Trash2, Zap } from 'lucide-react'
import { useMemo, useRef, useState } from 'react'
import { useShallow } from 'zustand/react/shallow'
import { isSystemFolder } from '../lib/defaults'
import { allTags, matchesSmart } from '../lib/query'
import { folderTree, useStore } from '../lib/store'
import { useSyncState } from '../lib/syncRunner'
import { sameSource, useUi } from '../lib/ui'
import { DEFAULT_FOLDER, QUICK_NOTES, type Folder, type SortBy } from '../lib/types'
import { newFolder, newSmartFolder } from './actions'
import { confirm, menuUnder, prompt, showMenu, toast } from './overlays'
import { openSmartFolder } from './SmartFolder'

// The left column: folders (nested, with Smart Folders), Recently Deleted, and #tags.

export const NOTE_DRAG = 'application/x-notes-ids'
const FOLDER_DRAG = 'application/x-notes-folder'

function useCounts() {
  const notes = useStore((s) => s.notes)
  const folders = useStore((s) => s.folders)
  return useMemo(() => {
    const counts = new Map<string, number>()
    let live = 0
    let trash = 0
    for (const n of notes) {
      if (n.deletedAt) {
        trash++
        continue
      }
      live++
      counts.set(n.folderId, (counts.get(n.folderId) ?? 0) + 1)
    }
    for (const f of folders) if (f.smart) counts.set(f.id, notes.filter((n) => !n.deletedAt && matchesSmart(n, f.smart!, folders)).length)
    return { counts, live, trash }
  }, [notes, folders])
}

function sortMenu(folder: Folder) {
  const set = (sort: SortBy | undefined) => useStore.getState().updateFolder(folder.id, { sort })
  return [
    { label: 'Default (from Settings)', checked: !folder.sort, onClick: () => set(undefined) },
    { label: 'Date Edited', checked: folder.sort === 'edited', onClick: () => set('edited') },
    { label: 'Date Created', checked: folder.sort === 'created', onClick: () => set('created') },
    { label: 'Title', checked: folder.sort === 'title', onClick: () => set('title') }
  ]
}

function folderMenu(folder: Folder) {
  const s = useStore.getState()
  const system = isSystemFolder(folder.id)
  return [
    ...(folder.smart
      ? [{ label: 'Edit Smart Folder…', onClick: () => openSmartFolder(folder) }]
      : [
          { label: 'New Folder Inside', onClick: () => void newFolder(folder.id) },
          { label: 'New Note in Folder', onClick: () => (useUi.getState().select({ kind: 'folder', id: folder.id }), window.dispatchEvent(new CustomEvent('notes:command', { detail: 'new-note' }))) }
        ]),
    ...(!system ? [{ label: 'Rename Folder', onClick: () => useUi.setState({ renaming: folder.id }) }] : []),
    { label: 'Sort By', submenu: sortMenu(folder) },
    ...(folder.parentId ? [{ label: 'Move to Top Level', onClick: () => s.updateFolder(folder.id, { parentId: undefined }) }] : []),
    ...(!system
      ? [
          { separator: true },
          {
            label: folder.smart ? 'Delete Smart Folder' : 'Delete Folder',
            danger: true,
            onClick: async () => {
              const count = s.notes.filter((n) => !n.deletedAt && folderTree(s.folders, folder.id).includes(n.folderId)).length
              const ok = await confirm({
                title: `Delete “${folder.name}”?`,
                message: folder.smart ? 'The notes in it stay where they are.' : count ? `Its ${count === 1 ? 'note' : `${count} notes`} and any folders inside it will be moved to Recently Deleted.` : 'Any folders inside it will be deleted too.',
                ok: 'Delete',
                danger: true
              })
              if (!ok) return
              s.deleteFolder(folder.id)
              const ui = useUi.getState()
              if (ui.source.kind === 'folder' && !useStore.getState().folders.some((f) => f.id === (ui.source as { id: string }).id)) ui.select({ kind: 'folder', id: DEFAULT_FOLDER })
            }
          }
        ]
      : [])
  ]
}

function RenameField({ folder }: { folder: Folder }) {
  const [name, setName] = useState(folder.name)
  const done = (save: boolean) => {
    if (save && name.trim()) useStore.getState().updateFolder(folder.id, { name: name.trim() })
    useUi.setState({ renaming: null })
  }
  return (
    <input
      className="rename"
      autoFocus
      value={name}
      onFocus={(e) => e.target.select()}
      onChange={(e) => setName(e.target.value)}
      onBlur={() => done(true)}
      onKeyDown={(e) => {
        if (e.key === 'Enter') done(true)
        if (e.key === 'Escape') done(false)
      }}
    />
  )
}

function FolderRow({ folder, depth, count, hasChildren, collapsed }: { folder: Folder; depth: number; count: number; hasChildren: boolean; collapsed: boolean }) {
  const active = useUi((s) => sameSource(s.source, { kind: 'folder', id: folder.id }))
  const renaming = useUi((s) => s.renaming === folder.id)
  const [over, setOver] = useState(false)
  const Icon = folder.id === QUICK_NOTES ? Zap : folder.smart ? FolderCog : FolderIcon
  const toggle = () => {
    const s = useStore.getState()
    const list = s.settings.collapsedFolders
    s.setSettings({ collapsedFolders: collapsed ? list.filter((x) => x !== folder.id) : [...list, folder.id] })
  }
  return (
    <div
      className={`side-row${active ? ' is-active' : ''}${over ? ' is-drop' : ''}`}
      style={{ paddingLeft: 10 + depth * 16 }}
      onClick={() => useUi.getState().select({ kind: 'folder', id: folder.id })}
      onDoubleClick={() => !isSystemFolder(folder.id) && useUi.setState({ renaming: folder.id })}
      onContextMenu={(e) => {
        e.preventDefault()
        showMenu(e.clientX, e.clientY, folderMenu(folder))
      }}
      draggable={!isSystemFolder(folder.id) && !renaming}
      onDragStart={(e) => e.dataTransfer.setData(FOLDER_DRAG, folder.id)}
      onDragOver={(e) => {
        const types = e.dataTransfer.types
        if (folder.smart || (!types.includes(NOTE_DRAG) && !types.includes(FOLDER_DRAG))) return
        e.preventDefault()
        setOver(true)
      }}
      onDragLeave={() => setOver(false)}
      onDrop={(e) => {
        setOver(false)
        const ids = e.dataTransfer.getData(NOTE_DRAG)
        const s = useStore.getState()
        if (ids) {
          s.moveNotes(ids.split(','), folder.id)
          toast(`Moved to ${folder.name}`)
          return
        }
        const fid = e.dataTransfer.getData(FOLDER_DRAG)
        if (fid && fid !== folder.id && !folderTree(s.folders, fid).includes(folder.id) && !isSystemFolder(folder.id)) s.updateFolder(fid, { parentId: folder.id })
      }}
    >
      <span
        className={`side-disclosure${hasChildren ? '' : ' is-empty'}${collapsed ? '' : ' is-open'}`}
        onClick={(e) => {
          e.stopPropagation()
          if (hasChildren) toggle()
        }}
      >
        {hasChildren && <ChevronRight size={12} strokeWidth={2.4} />}
      </span>
      <Icon size={16} className="side-icon" />
      {renaming ? <RenameField folder={folder} /> : <span className="side-label">{folder.name}</span>}
      {!renaming && <span className="side-count">{count || ''}</span>}
    </div>
  )
}

function TagsSection() {
  const notes = useStore((s) => s.notes)
  const enabled = useStore((s) => s.settings.tags)
  const source = useUi((s) => s.source)
  const tags = useMemo(() => allTags(notes), [notes])
  if (!enabled || !tags.length) return null
  const selected = source.kind === 'tags' ? source.tags : []
  const pick = (tag: string, multi: boolean) => {
    const next = multi ? (selected.includes(tag) ? selected.filter((t) => t !== tag) : [...selected, tag]) : selected.length === 1 && selected[0] === tag ? [] : [tag]
    useUi.getState().select(next.length ? { kind: 'tags', tags: next } : { kind: 'folder', id: DEFAULT_FOLDER })
  }
  return (
    <div className="side-section">
      <div className="side-header">Tags</div>
      <div className="tag-chips">
        <button className={`chip${source.kind === 'tags' && !selected.length ? ' is-on' : ''}`} onClick={() => useUi.getState().select({ kind: 'tags', tags: [] })}>
          All Tags
        </button>
        {tags.map(({ tag }) => (
          <button
            key={tag}
            className={`chip${selected.includes(tag) ? ' is-on' : ''}`}
            onClick={(e) => pick(tag, e.metaKey || e.ctrlKey || e.shiftKey || selected.length > 1)}
            onContextMenu={(e) => {
              e.preventDefault()
              showMenu(e.clientX, e.clientY, [
                {
                  label: 'Rename Tag…',
                  onClick: async () => {
                    const name = await prompt({ title: 'Rename Tag', value: tag, ok: 'Rename' })
                    if (name) useStore.getState().renameTag(tag, name)
                  }
                },
                {
                  label: 'Delete Tag',
                  danger: true,
                  onClick: async () => {
                    const ok = await confirm({ title: `Delete #${tag}?`, message: 'The tag will be removed from every note that has it.', ok: 'Delete', danger: true })
                    if (ok) useStore.getState().deleteTag(tag)
                  }
                }
              ])
            }}
          >
            #{tag}
          </button>
        ))}
      </div>
    </div>
  )
}

export function Sidebar({ width, onSettings, onFeedback }: { width: number; onSettings: () => void; onFeedback: () => void }) {
  const folders = useStore(useShallow((s) => s.folders))
  const collapsed = useStore((s) => s.settings.collapsedFolders)
  const sync = useStore(useShallow((s) => ({ enabled: s.sync.enabled, email: s.sync.email, error: s.sync.error })))
  const busy = useSyncState((s) => s.busy)
  const { counts, live, trash } = useCounts()
  const allActive = useUi((s) => s.source.kind === 'all')
  const trashActive = useUi((s) => s.source.kind === 'trash')
  const [topDrop, setTopDrop] = useState(false)
  const addRef = useRef<HTMLButtonElement>(null)

  const rows = useMemo(() => {
    const out: Array<{ folder: Folder; depth: number; hasChildren: boolean }> = []
    const kids = (parent?: string) =>
      folders
        .filter((f) => f.parentId === parent && (parent || !f.smart))
        .sort((a, b) => a.order - b.order || a.name.localeCompare(b.name, undefined, { numeric: true }))
    const walk = (parent: string | undefined, depth: number) => {
      for (const f of kids(parent)) {
        const children = kids(f.id)
        out.push({ folder: f, depth, hasChildren: children.length > 0 })
        if (!collapsed.includes(f.id)) walk(f.id, depth + 1)
      }
    }
    walk(undefined, 0)
    return out
  }, [folders, collapsed])
  const smart = folders.filter((f) => f.smart && !f.parentId)

  return (
    <aside className="sidebar" style={{ width }}>
      <div className="sidebar-top" />
      <div className="sidebar-scroll">
        <div
          className={`side-section${topDrop ? ' is-drop' : ''}`}
          onDragOver={(e) => {
            if (!e.dataTransfer.types.includes(FOLDER_DRAG)) return
            e.preventDefault()
            setTopDrop(true)
          }}
          onDragLeave={() => setTopDrop(false)}
          onDrop={(e) => {
            setTopDrop(false)
            const fid = e.dataTransfer.getData(FOLDER_DRAG)
            if (fid && e.target === e.currentTarget) useStore.getState().updateFolder(fid, { parentId: undefined })
          }}
        >
          <div className="side-header">
            {sync.enabled ? (
              <>
                <Cloud size={12} /> Google Drive{busy ? ' · Syncing…' : ''}
              </>
            ) : (
              <>
                <CloudOff size={12} /> On This Computer
              </>
            )}
          </div>
          {sync.error && (
            <div className="side-error" onClick={onSettings} title={sync.error}>
              Sync problem — open Settings
            </div>
          )}
          <div className={`side-row${allActive ? ' is-active' : ''}`} style={{ paddingLeft: 10 }} onClick={() => useUi.getState().select({ kind: 'all' })}>
            <span className="side-disclosure is-empty" />
            <Notebook size={16} className="side-icon" />
            <span className="side-label">All Notes</span>
            <span className="side-count">{live || ''}</span>
          </div>
          {rows.map(({ folder, depth, hasChildren }) => (
            <FolderRow key={folder.id} folder={folder} depth={depth} count={counts.get(folder.id) ?? 0} hasChildren={hasChildren} collapsed={collapsed.includes(folder.id)} />
          ))}
          {smart.map((f) => (
            <FolderRow key={f.id} folder={f} depth={0} count={counts.get(f.id) ?? 0} hasChildren={false} collapsed={false} />
          ))}
          {trash > 0 && (
            <div className={`side-row${trashActive ? ' is-active' : ''}`} style={{ paddingLeft: 10 }} onClick={() => useUi.getState().select({ kind: 'trash' })}>
              <span className="side-disclosure is-empty" />
              <Trash2 size={16} className="side-icon" />
              <span className="side-label">Recently Deleted</span>
              <span className="side-count">{trash}</span>
            </div>
          )}
        </div>
        <TagsSection />
      </div>
      <div className="sidebar-bottom">
        <button
          ref={addRef}
          className="side-new"
          onClick={() => void newFolder()}
          onContextMenu={(e) => {
            e.preventDefault()
            menuUnder(e.currentTarget, [
              { label: 'New Folder', icon: <NotebookPen size={14} />, onClick: () => void newFolder() },
              { label: 'New Smart Folder', icon: <FolderCog size={14} />, onClick: newSmartFolder }
            ])
          }}
        >
          <Plus size={15} /> New Folder
        </button>
        <button className="tb-btn" title="New Smart Folder" onClick={newSmartFolder}>
          <FolderCog size={16} />
        </button>
        <button className="tb-btn" title="Send Feedback" onClick={onFeedback}>
          <MessageSquareText size={16} />
        </button>
        <button className="tb-btn" title="Settings" onClick={onSettings}>
          <Settings size={16} />
        </button>
      </div>
    </aside>
  )
}
