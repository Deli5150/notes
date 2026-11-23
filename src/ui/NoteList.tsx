import { TaskState } from './TaskState'
import { Folder as FolderIcon, Lock, Paperclip, Pin } from 'lucide-react'
import { memo, useEffect, useMemo, useRef, useState } from 'react'
import { attachmentUrl } from '../lib/attachments'
import { snippetOf } from '../lib/content'
import { daysLeft, groupByDate, listDate } from '../lib/dates'
import { useLock } from '../lib/lock'
import { notesFor, searchNotes, sortFor, sortNotes } from '../lib/query'
import { TRASH_DAYS, useStore } from '../lib/store'
import { useUi } from '../lib/ui'
import type { Note, SortBy } from '../lib/types'
import { deleteNotes, noteMenu } from './actions'
import { confirm, showMenu } from './overlays'
import { NOTE_DRAG } from './Sidebar'

// The middle column: the selected folder's notes (or tags, search results, Recently Deleted),
// pinned first, then grouped by date like Apple Notes.

export function useThumb(id: string | undefined): string {
  const [url, setUrl] = useState('')
  useEffect(() => {
    let live = true
    if (id) void attachmentUrl(id).then((u) => live && setUrl(u))
    else setUrl('')
    return () => {
      live = false
    }
  }, [id])
  return url
}

export function sourceTitle(): string {
  const { source } = useUi.getState()
  const { folders } = useStore.getState()
  if (source.kind === 'all') return 'All Notes'
  if (source.kind === 'trash') return 'Recently Deleted'
  if (source.kind === 'tags') return source.tags.length ? source.tags.map((t) => `#${t}`).join(' ') : 'All Tags'
  return folders.find((f) => f.id === source.id)?.name ?? 'Notes'
}

/** What the list shows, in sections. */
export function useListSections(): { sections: Array<{ key: string; label: string; notes: Note[]; excerpts?: Map<string, string> }>; flat: Note[]; searching: boolean } {
  const notes = useStore((s) => s.notes)
  const folders = useStore((s) => s.folders)
  const settings = useStore((s) => s.settings)
  const source = useUi((s) => s.source)
  const search = useUi((s) => s.search)
  const open = useLock((s) => s.open)
  return useMemo(() => {
    const q = search.trim()
    if (q) {
      // Search looks through every note, as in Apple Notes.
      const hits = searchNotes(
        notes.filter((n) => !n.deletedAt),
        q,
        open
      )
      const sorted = sortNotes(
        hits.map((h) => h.note),
        'edited',
        'desc'
      )
      const excerpts = new Map(hits.filter((h) => h.excerpt).map((h) => [h.note.id, h.excerpt!]))
      return { sections: [{ key: 'results', label: sorted.length ? 'Top Hits' : '', notes: sorted, excerpts }], flat: sorted, searching: true }
    }
    const by = sortFor(source, folders, settings)
    const list = sortNotes(notesFor(source, notes, folders), by, settings.sortDir)
    if (source.kind === 'trash') return { sections: [{ key: 'trash', label: '', notes: list }], flat: list, searching: false }
    const pinned = list.filter((n) => n.pinned)
    const rest = list.filter((n) => !n.pinned)
    const sections: Array<{ key: string; label: string; notes: Note[] }> = []
    if (pinned.length) sections.push({ key: 'pinned', label: 'Pinned', notes: pinned })
    if (settings.groupByDate && by !== 'title') {
      for (const g of groupByDate(rest, (n) => (by === 'created' ? n.createdAt : n.updatedAt))) sections.push({ key: g.key, label: g.label, notes: g.items })
    } else if (rest.length) sections.push({ key: 'notes', label: pinned.length ? 'Notes' : '', notes: rest })
    return { sections, flat: [...pinned, ...rest], searching: false }
  }, [notes, folders, settings, source, search, open])
}

const highlight = (text: string, q: string) => {
  const words = q.toLowerCase().split(/\s+/).filter(Boolean)
  if (!words.length) return text
  const re = new RegExp(`(${words.map((w) => w.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')).join('|')})`, 'gi')
  return text.split(re).map((part, i) => (i % 2 ? <mark key={i}>{part}</mark> : part))
}

const NoteRow = memo(function NoteRow({
  note,
  selected,
  focused,
  showFolder,
  folderName,
  excerpt,
  query,
  onPick,
  onMenu,
  dragIds
}: {
  note: Note
  selected: boolean
  focused: boolean
  showFolder: boolean
  folderName: string
  excerpt?: string
  query: string
  onPick: (e: React.MouseEvent, id: string) => void
  onMenu: (e: React.MouseEvent, id: string) => void
  dragIds: () => string[]
}) {
  const thumb = useThumb(note.locked ? undefined : note.thumb)
  const title = note.title || 'New Note'
  const snippet = note.locked ? 'Locked' : excerpt ?? (snippetOf(note.text, note.title) || note.external?.meta || (note.attachments.length ? '' : 'No additional text'))
  return (
    <div
      className={`note-row${selected ? (focused ? ' is-selected' : ' is-selected-dim') : ''}`}
      onMouseDown={(e) => onPick(e, note.id)}
      onContextMenu={(e) => onMenu(e, note.id)}
      draggable
      onDragStart={(e) => {
        e.dataTransfer.setData(NOTE_DRAG, dragIds().includes(note.id) ? dragIds().join(',') : note.id)
        e.dataTransfer.effectAllowed = 'move'
      }}
      data-id={note.id}
    >
      <div className="note-row-text">
        <div className="note-row-top">
          <div className="note-row-title">
            {note.pinned && <Pin size={11} className="note-row-pin" />}
            {note.locked && <Lock size={11} className="note-row-lock" />}
            {note.external?.state && <TaskState state={note.external.state} />}
            {query ? highlight(title, query) : title}
          </div>
          <span className="note-row-date">{note.deletedAt ? `${daysLeft(note.deletedAt, TRASH_DAYS)}d left` : listDate(note.updatedAt)}</span>
        </div>
        <div className="note-row-snippet">
          {!snippet && note.attachments.length ? (
            <>
              <Paperclip size={11} /> {note.attachments.length === 1 ? '1 attachment' : `${note.attachments.length} attachments`}
            </>
          ) : query ? (
            highlight(snippet, query)
          ) : (
            snippet
          )}
        </div>
        {showFolder && folderName && (
          <div className="note-row-folder">
            <FolderIcon size={10} /> {folderName}
          </div>
        )}
      </div>
      {thumb && <img className="note-row-thumb" src={thumb} alt="" draggable={false} />}
    </div>
  )
})

export function listSortMenu() {
  const s = useStore.getState()
  const { sortBy, sortDir, groupByDate } = s.settings
  const set = (patch: Partial<typeof s.settings>) => s.setSettings(patch)
  const by = (v: SortBy, label: string) => ({ label, checked: sortBy === v, onClick: () => set({ sortBy: v, sortDir: v === 'title' ? 'asc' : 'desc' }) })
  return [
    { header: true, label: 'Sort By' },
    by('edited', 'Date Edited'),
    by('created', 'Date Created'),
    by('title', 'Title'),
    { separator: true },
    { label: sortBy === 'title' ? 'A to Z' : 'Newest First', checked: sortDir === (sortBy === 'title' ? 'asc' : 'desc'), onClick: () => set({ sortDir: sortBy === 'title' ? 'asc' : 'desc' }) },
    { label: sortBy === 'title' ? 'Z to A' : 'Oldest First', checked: sortDir === (sortBy === 'title' ? 'desc' : 'asc'), onClick: () => set({ sortDir: sortBy === 'title' ? 'desc' : 'asc' }) },
    { separator: true },
    { label: 'Group By Date', checked: groupByDate, disabled: sortBy === 'title', onClick: () => set({ groupByDate: !groupByDate }) }
  ]
}

export function NoteList() {
  const { sections, flat, searching } = useListSections()
  const folders = useStore((s) => s.folders)
  const noteId = useUi((s) => s.noteId)
  const selected = useUi((s) => s.selected)
  const focus = useUi((s) => s.focus)
  const source = useUi((s) => s.source)
  const search = useUi((s) => s.search)
  const ref = useRef<HTMLDivElement>(null)
  const flatIds = useMemo(() => flat.map((n) => n.id), [flat])
  const folderNames = useMemo(() => new Map(folders.map((f) => [f.id, f.id === 'notes' ? '' : f.name])), [folders])
  const showFolder = searching || source.kind === 'all' || source.kind === 'tags' || (source.kind === 'folder' && Boolean(folders.find((f) => f.id === source.id)?.smart))
  const selectedRef = useRef(selected)
  selectedRef.current = selected

  // Keep a note open: the first one when the open note isn't in the list.
  useEffect(() => {
    if (searching || (useUi.getState().closed && !noteId)) return
    if (!noteId || !flatIds.includes(noteId)) useUi.getState().open(flatIds[0] ?? null)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [flatIds, searching])

  useEffect(() => {
    const el = ref.current?.querySelector(`[data-id="${noteId}"]`)
    el?.scrollIntoView({ block: 'nearest' })
  }, [noteId])

  const onPick = (e: React.MouseEvent, id: string) => {
    if (e.button !== 0) return
    useUi.setState({ focus: 'list' })
    const extend = e.metaKey || e.ctrlKey ? 'toggle' : e.shiftKey ? 'range' : null
    useUi.getState().open(id, extend, flatIds)
    if (!extend) useUi.setState({ phoneNote: true })
  }
  const onMenu = (e: React.MouseEvent, id: string) => {
    e.preventDefault()
    const ui = useUi.getState()
    if (!ui.selected.includes(id)) ui.open(id)
    const ids = useUi.getState().selected
    const notes = ids.map((x) => flat.find((n) => n.id === x)).filter((n): n is Note => Boolean(n))
    showMenu(e.clientX, e.clientY, noteMenu(notes))
  }

  const onKey = (e: React.KeyboardEvent) => {
    if ((e.target as Element).tagName === 'INPUT') return
    const i = noteId ? flatIds.indexOf(noteId) : -1
    if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
      e.preventDefault()
      const next = flatIds[Math.max(0, Math.min(flatIds.length - 1, i + (e.key === 'ArrowDown' ? 1 : -1)))]
      if (next) useUi.getState().open(next, e.shiftKey ? 'range' : null, flatIds)
    } else if (e.key === 'Backspace' || e.key === 'Delete') {
      e.preventDefault()
      void deleteNotes()
    } else if (e.key === 'Enter' || e.key === 'Tab') {
      e.preventDefault()
      useUi.setState({ focus: 'editor' })
      document.querySelector<HTMLElement>('.note-content')?.focus()
    } else if ((e.metaKey || e.ctrlKey) && e.key === 'a') {
      e.preventDefault()
      useUi.setState({ selected: flatIds })
    }
  }

  const count = flat.length
  return (
    <div className="note-list" tabIndex={0} ref={ref} onKeyDown={onKey} onFocus={() => useUi.setState({ focus: 'list' })}>
      {source.kind === 'trash' && !searching && (
        <div className="trash-banner">
          Notes are available here for {TRASH_DAYS} days. After that time, notes will be permanently deleted.
          {count > 0 && (
            <button
              className="btn btn-small"
              onClick={async () => {
                if (await confirm({ title: 'Delete all notes in Recently Deleted?', message: 'You can’t undo this.', ok: 'Delete All', danger: true })) useStore.getState().emptyTrash()
              }}
            >
              Delete All
            </button>
          )}
        </div>
      )}
      <div className="list-scroll">
        {sections.map((sec) => (
          <div key={sec.key} className="list-section">
            {sec.label && (
              <div className="list-section-label">
                {sec.key === 'pinned' && <Pin size={11} />}
                {sec.label}
              </div>
            )}
            {sec.notes.map((n) => (
              <NoteRow
                key={n.id}
                note={n}
                selected={selected.includes(n.id) || noteId === n.id}
                focused={focus === 'list'}
                showFolder={showFolder}
                folderName={folderNames.get(n.folderId) ?? ''}
                excerpt={sec.excerpts?.get(n.id)}
                query={searching ? search : ''}
                onPick={onPick}
                onMenu={onMenu}
                dragIds={() => selectedRef.current}
              />
            ))}
          </div>
        ))}
        {!count && <div className="list-empty">{searching ? 'No Results' : source.kind === 'trash' ? 'No Notes' : 'No Notes'}</div>}
      </div>
    </div>
  )
}

/** Gallery view: notes as cards with a preview of their content. */
export function Gallery() {
  const { sections } = useListSections()
  const noteId = useUi((s) => s.noteId)
  return (
    <div className="gallery">
      {sections.map((sec) => (
        <div key={sec.key} className="gallery-section">
          {sec.label && <div className="list-section-label">{sec.label}</div>}
          <div className="gallery-grid">
            {sec.notes.map((n) => (
              <GalleryCard key={n.id} note={n} selected={n.id === noteId} />
            ))}
          </div>
        </div>
      ))}
    </div>
  )
}

const GalleryCard = memo(function GalleryCard({ note, selected }: { note: Note; selected: boolean }) {
  const thumb = useThumb(note.locked ? undefined : note.thumb)
  return (
    <div
      className="gallery-item"
      onClick={() => useUi.getState().open(note.id)}
      onDoubleClick={() => useUi.setState({ galleryOpen: true, noteId: note.id, selected: [note.id] })}
      onContextMenu={(e) => {
        e.preventDefault()
        useUi.getState().open(note.id)
        showMenu(e.clientX, e.clientY, noteMenu([note]))
      }}
      draggable
      onDragStart={(e) => e.dataTransfer.setData(NOTE_DRAG, note.id)}
    >
      <div className={`gallery-card${selected ? ' is-selected' : ''}`}>
        {note.locked ? (
          <div className="gallery-locked">
            <Lock size={26} strokeWidth={1.4} />
          </div>
        ) : thumb ? (
          <img src={thumb} alt="" draggable={false} />
        ) : (
          <div className="gallery-text">{note.text.split('\n').slice(0, 14).join('\n')}</div>
        )}
      </div>
      <div className="gallery-title">{note.title || 'New Note'}</div>
      <div className="gallery-date">{listDate(note.updatedAt)}</div>
    </div>
  )
})
