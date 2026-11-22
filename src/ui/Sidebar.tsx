import { ArrowUpDown, ChevronDown, Cloud, CloudOff, FolderCog, Hash, Layers, MessageSquareText, PanelLeftClose, Plus, Search, Settings, SquarePen, Trash2, X, Zap } from 'lucide-react'
import { useMemo, useState } from 'react'
import { useShallow } from 'zustand/react/shallow'
import { isSystemFolder } from '../lib/defaults'
import { allTags, matchesSmart } from '../lib/query'
import { folderTree, useStore } from '../lib/store'
import { useSyncState } from '../lib/syncRunner'
import { sameSource, useUi } from '../lib/ui'
import { DEFAULT_FOLDER, QUICK_NOTES, type Folder, type SortBy } from '../lib/types'
import { newFolder, newNote, newSmartFolder } from './actions'
import { withKeys } from '../lib/shortcuts'
import { editFolderLook, FolderGlyph } from './FolderIcon'
import { listSortMenu, NoteList, useListSections } from './NoteList'
import { confirm, menuUnder, showMenu, toast, type MenuItem } from './overlays'
import { openSmartFolder } from './SmartFolder'

// The one sidebar: search, folders as pinned tiles (like Arc's pinned tabs), a switcher between
// All Notes, Quick Notes and the other views, and the notes themselves.

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

function sortMenu(folder: Folder): MenuItem[] {
  const set = (sort: SortBy | undefined) => useStore.getState().updateFolder(folder.id, { sort })
  return [
    { label: 'Default (from Settings)', checked: !folder.sort, onClick: () => set(undefined) },
    { label: 'Date Edited', checked: folder.sort === 'edited', onClick: () => set('edited') },
    { label: 'Date Created', checked: folder.sort === 'created', onClick: () => set('created') },
    { label: 'Title', checked: folder.sort === 'title', onClick: () => set('title') }
  ]
}

async function deleteFolder(folder: Folder) {
  const s = useStore.getState()
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
  if (ui.source.kind === 'folder' && !useStore.getState().folders.some((f) => f.id === (ui.source as { id: string }).id)) ui.select({ kind: 'all' })
}

export function folderMenu(folder: Folder): MenuItem[] {
  const s = useStore.getState()
  const system = isSystemFolder(folder.id)
  return [
    ...(!system ? [{ label: 'Rename', onClick: () => useUi.setState({ renaming: folder.id }) }] : []),
    ...(!system ? [{ label: 'Change Icon & Colour…', onClick: () => editFolderLook(folder) }] : []),
    ...(folder.smart
      ? [{ label: 'Edit Smart Folder…', onClick: () => openSmartFolder(folder) }]
      : [
          { label: 'New Note Here', onClick: () => (useUi.getState().select({ kind: 'folder', id: folder.id }), newNote(folder.id)) },
          { label: 'New Folder Inside', onClick: () => void newFolder(folder.id) }
        ]),
    { label: 'Sort By', submenu: sortMenu(folder) },
    ...(folder.parentId ? [{ label: 'Move to Top Level', onClick: () => s.updateFolder(folder.id, { parentId: undefined }) }] : []),
    ...(!system ? [{ separator: true }, { label: folder.smart ? 'Delete Smart Folder' : 'Delete Folder', danger: true, onClick: () => void deleteFolder(folder) }] : [])
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
      onClick={(e) => e.stopPropagation()}
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

/** One pinned folder tile. Click to open (again to go back to All Notes), drop notes on it, drag to reorder. */
function Tile({ folder, count }: { folder: Folder; count: number }) {
  const active = useUi((s) => s.source.kind === 'folder' && (s.source.id === folder.id || folderTree(useStore.getState().folders, folder.id).includes(s.source.id)))
  const renaming = useUi((s) => s.renaming === folder.id)
  const [over, setOver] = useState<'notes' | 'before' | null>(null)
  return (
    <div
      className={`tile${active ? ' is-active' : ''}${over === 'notes' ? ' is-drop' : ''}${over === 'before' ? ' is-before' : ''}`}
      style={{ '--tile': folder.color ?? 'var(--accent)' } as React.CSSProperties}
      title={`${folder.name}${count ? ` — ${count} note${count === 1 ? '' : 's'}` : ''}`}
      onClick={() => useUi.getState().select(active && useUi.getState().source.kind === 'folder' && (useUi.getState().source as { id: string }).id === folder.id ? { kind: 'all' } : { kind: 'folder', id: folder.id })}
      onDoubleClick={() => useUi.setState({ renaming: folder.id })}
      onContextMenu={(e) => {
        e.preventDefault()
        showMenu(e.clientX, e.clientY, folderMenu(folder))
      }}
      draggable={!renaming}
      onDragStart={(e) => e.dataTransfer.setData(FOLDER_DRAG, folder.id)}
      onDragOver={(e) => {
        const t = e.dataTransfer.types
        if (t.includes(NOTE_DRAG) && !folder.smart) {
          e.preventDefault()
          setOver('notes')
        } else if (t.includes(FOLDER_DRAG)) {
          e.preventDefault()
          setOver('before')
        }
      }}
      onDragLeave={() => setOver(null)}
      onDrop={(e) => {
        setOver(null)
        const s = useStore.getState()
        const ids = e.dataTransfer.getData(NOTE_DRAG)
        if (ids) {
          s.moveNotes(ids.split(','), folder.id)
          toast(`Moved to ${folder.name}`)
          return
        }
        const fid = e.dataTransfer.getData(FOLDER_DRAG)
        if (!fid || fid === folder.id) return
        // Reorder: the dragged folder goes before this one.
        const tiles = s.folders.filter((f) => !f.parentId && !isSystemFolder(f.id) && !f.smart && f.id !== fid).sort((a, b) => a.order - b.order)
        const at = tiles.findIndex((f) => f.id === folder.id)
        tiles.splice(at, 0, s.folders.find((f) => f.id === fid)!)
        tiles.forEach((f, i) => f.order !== i && s.updateFolder(f.id, { order: i, parentId: undefined }))
      }}
    >
      <div className="tile-icon">
        <FolderGlyph folder={folder} size={20} />
      </div>
      {renaming ? <RenameField folder={folder} /> : <div className="tile-name">{folder.name}</div>}
    </div>
  )
}

function FolderTiles() {
  const folders = useStore(useShallow((s) => s.folders))
  const collapsed = useStore((s) => s.settings.foldersCollapsed)
  const { counts } = useCounts()
  const tiles = useMemo(() => folders.filter((f) => !f.parentId && !isSystemFolder(f.id) && !f.smart).sort((a, b) => a.order - b.order || a.name.localeCompare(b.name)), [folders])
  const toggle = () => useStore.getState().setSettings({ foldersCollapsed: !collapsed })
  // No folders yet: just a slim header with its + button.
  const open = tiles.length > 0 && !collapsed
  return (
    <div className={`folders${open ? ' is-open' : ''}`}>
      <div className="folders-head">
        {tiles.length > 0 ? (
          <button className="folders-toggle" onClick={toggle} title={collapsed ? 'Show folders' : 'Hide folders'} aria-expanded={!collapsed}>
            <ChevronDown size={13} className={`folders-chevron${collapsed ? ' is-collapsed' : ''}`} />
            Folders
            <span className="folders-count">{tiles.length}</span>
          </button>
        ) : (
          <span className="folders-toggle is-static">Folders</span>
        )}
        <span className="tb-flex" />
        <button className="tb-btn is-small" title="New Folder" onClick={() => void newFolder()}>
          <Plus size={14} />
        </button>
      </div>
      {open && (
        <div className="tiles">
          {tiles.map((f) => (
            <Tile key={f.id} folder={f} count={folderTree(folders, f.id).reduce((n, id) => n + (counts.get(id) ?? 0), 0)} />
          ))}
        </div>
      )}
    </div>
  )
}

/** Inside a folder that has folders of its own: them as chips. */
function SubFolders() {
  const folders = useStore((s) => s.folders)
  const source = useUi((s) => s.source)
  if (source.kind !== 'folder') return null
  const current = folders.find((f) => f.id === source.id)
  if (!current || current.smart || isSystemFolder(current.id)) return null
  const top = (() => {
    let f = current
    while (f.parentId) f = folders.find((x) => x.id === f.parentId) ?? f
    return f
  })()
  const children = (id: string) => folders.filter((f) => f.parentId === id).sort((a, b) => a.order - b.order || a.name.localeCompare(b.name))
  const rows: Array<{ f: Folder; depth: number }> = []
  const walk = (id: string, depth: number) => children(id).forEach((f) => (rows.push({ f, depth }), walk(f.id, depth + 1)))
  walk(top.id, 0)
  if (!rows.length) return null
  return (
    <div className="subfolders">
      <button className={`chip${current.id === top.id ? ' is-on' : ''}`} onClick={() => useUi.getState().select({ kind: 'folder', id: top.id })}>
        All of {top.name}
      </button>
      {rows.map(({ f }) => (
        <button
          key={f.id}
          className={`chip${current.id === f.id ? ' is-on' : ''}`}
          onClick={() => useUi.getState().select({ kind: 'folder', id: f.id })}
          onContextMenu={(e) => {
            e.preventDefault()
            showMenu(e.clientX, e.clientY, folderMenu(f))
          }}
          onDragOver={(e) => e.dataTransfer.types.includes(NOTE_DRAG) && e.preventDefault()}
          onDrop={(e) => {
            const ids = e.dataTransfer.getData(NOTE_DRAG)
            if (ids) useStore.getState().moveNotes(ids.split(','), f.id)
          }}
        >
          {f.name}
        </button>
      ))}
    </div>
  )
}

/** The button above the list: which notes it shows (All Notes, Quick Notes, Smart Folders, tags, Recently Deleted). */
function SourceSwitcher() {
  const source = useUi((s) => s.source)
  const search = useUi((s) => s.search)
  const folders = useStore((s) => s.folders)
  const notes = useStore((s) => s.notes)
  const { counts, live, trash } = useCounts()
  const { flat } = useListSections()
  const select = (src: Parameters<ReturnType<typeof useUi.getState>['select']>[0]) => useUi.getState().select(src)

  let label = 'All Notes'
  let icon: React.ReactNode = <Layers size={15} />
  if (search.trim()) {
    label = 'Search'
    icon = <Search size={15} />
  } else if (source.kind === 'trash') {
    label = 'Recently Deleted'
    icon = <Trash2 size={15} />
  } else if (source.kind === 'tags') {
    label = source.tags.length ? source.tags.map((t) => `#${t}`).join(' ') : 'All Tags'
    icon = <Hash size={15} />
  } else if (source.kind === 'folder') {
    const f = folders.find((x) => x.id === source.id)
    label = f?.id === DEFAULT_FOLDER ? 'Unfiled' : (f?.name ?? 'Notes')
    icon = f?.smart ? <FolderCog size={15} /> : f ? <FolderGlyph folder={f} size={15} /> : null
  }

  const open = (el: Element) => {
    const smart = folders.filter((f) => f.smart)
    const tags = allTags(notes)
    const items: MenuItem[] = [
      { label: `All Notes`, icon: <Layers size={14} />, shortcut: String(live), checked: source.kind === 'all', onClick: () => select({ kind: 'all' }) },
      { label: 'Quick Notes', icon: <Zap size={14} />, shortcut: String(counts.get(QUICK_NOTES) ?? 0), checked: sameSource(source, { kind: 'folder', id: QUICK_NOTES }), onClick: () => select({ kind: 'folder', id: QUICK_NOTES }) },
      { label: 'Unfiled', shortcut: String(counts.get(DEFAULT_FOLDER) ?? 0), checked: sameSource(source, { kind: 'folder', id: DEFAULT_FOLDER }), onClick: () => select({ kind: 'folder', id: DEFAULT_FOLDER }) },
      { separator: true },
      ...(smart.length ? [{ header: true, label: 'Smart Folders' } as MenuItem] : []),
      ...smart.map((f) => ({ label: f.name, icon: <FolderCog size={14} />, shortcut: String(counts.get(f.id) ?? 0), checked: sameSource(source, { kind: 'folder', id: f.id }), onClick: () => select({ kind: 'folder', id: f.id }) })),
      { label: 'New Smart Folder…', icon: <Plus size={14} />, onClick: newSmartFolder },
      ...(tags.length
        ? [
            { separator: true },
            {
              label: 'Tags',
              icon: <Hash size={14} />,
              submenu: [
                { label: 'All Tags', checked: source.kind === 'tags' && !source.tags.length, onClick: () => select({ kind: 'tags', tags: [] }) },
                { separator: true },
                ...tags.map(({ tag, count }) => ({ label: `#${tag}`, shortcut: String(count), checked: source.kind === 'tags' && source.tags.includes(tag), onClick: () => select({ kind: 'tags', tags: [tag] }) }))
              ]
            } as MenuItem
          ]
        : []),
      { separator: true },
      { label: 'Recently Deleted', icon: <Trash2 size={14} />, shortcut: trash ? String(trash) : '', checked: source.kind === 'trash', onClick: () => select({ kind: 'trash' }) }
    ]
    menuUnder(el, items)
  }

  return (
    <div className="list-head">
      <button className="switcher" onClick={(e) => open(e.currentTarget)}>
        <span className="switcher-icon">{icon}</span>
        <span className="switcher-label">{label}</span>
        <ChevronDown size={14} className="switcher-chevron" />
      </button>
      <span className="list-count">{flat.length}</span>
      <span className="tb-flex" />
      <button
        className="tb-btn"
        title="Sort, group and view"
        onClick={(e) =>
          menuUnder(
            e.currentTarget,
            [
              ...listSortMenu(),
              { separator: true },
              { header: true, label: 'View' },
              { label: 'List', checked: useStore.getState().settings.view === 'list', onClick: () => useStore.getState().setSettings({ view: 'list' }) },
              { label: 'Gallery', checked: useStore.getState().settings.view === 'gallery', onClick: () => (useStore.getState().setSettings({ view: 'gallery' }), useUi.setState({ galleryOpen: false })) }
            ],
            'right'
          )
        }
      >
        <ArrowUpDown size={14} />
      </button>
    </div>
  )
}

function SearchField() {
  const search = useUi((s) => s.search)
  return (
    <div className="search-field">
      <Search size={14} />
      <input placeholder="Search notes" value={search} onChange={(e) => useUi.setState({ search: e.target.value, searching: true })} onKeyDown={(e) => e.key === 'Escape' && useUi.setState({ search: '', searching: false })} />
      {search && (
        <button onMouseDown={(e) => e.preventDefault()} onClick={() => useUi.setState({ search: '', searching: false })} title="Clear">
          <X size={11} />
        </button>
      )}
    </div>
  )
}

export function Sidebar({ width, onSettings, onFeedback }: { width: number; onSettings: () => void; onFeedback: () => void }) {
  const sync = useStore(useShallow((s) => ({ enabled: s.sync.enabled, error: s.sync.error })))
  const busy = useSyncState((s) => s.busy)
  const { trash } = useCounts()
  const trashOn = useUi((s) => s.source.kind === 'trash')

  return (
    <aside className="sidebar" style={width ? { width } : undefined}>
      <div className="sidebar-top">
        <span className="tb-flex" />
        <button className="tb-btn sidebar-hide" title={withKeys('Hide Sidebar', 'sidebar')} onClick={() => useStore.getState().setSettings({ sidebarHidden: true })}>
          <PanelLeftClose size={16} />
        </button>
        <button className="tb-btn" title={withKeys('New Note', 'new-note:tab')} onClick={() => newNote()}>
          <SquarePen size={16} />
        </button>
      </div>
      <SearchField />
      <FolderTiles />
      <SourceSwitcher />
      <SubFolders />
      <NoteList />
      <div className="sidebar-bottom">
        <button className={`sync-pill${sync.error ? ' is-error' : ''}`} onClick={() => useUi.setState({ settings: 'sync' })} title={sync.error ?? (sync.enabled ? 'Synced with Google' : 'Sync is off')}>
          {sync.enabled ? <Cloud size={13} /> : <CloudOff size={13} />}
          {sync.error ? 'Sync problem' : sync.enabled ? (busy ? 'Syncing…' : 'Synced') : 'This computer'}
        </button>
        <span className="tb-flex" />
        <button className={`tb-btn${trashOn ? ' is-on' : ''}`} title={trash ? `Recently Deleted (${trash})` : 'Recently Deleted'} onClick={() => useUi.getState().select(trashOn ? { kind: 'all' } : { kind: 'trash' })}>
          <Trash2 size={15} />
        </button>
        <button className="tb-btn" title="Send Feedback" onClick={onFeedback}>
          <MessageSquareText size={15} />
        </button>
        <button className="tb-btn" title="Settings" onClick={onSettings}>
          <Settings size={15} />
        </button>
      </div>
    </aside>
  )
}

