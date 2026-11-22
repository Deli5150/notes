import { useEditorState } from '@tiptap/react'
import { ALargeSmall, AudioLines, LayoutGrid, List, ListChecks, Lock, LockOpen, MoreHorizontal, Paperclip, PanelLeft, Search, Share, SquarePen, Table, Trash2, X } from 'lucide-react'
import { useState } from 'react'
import { useEditorRef } from '../editor/Editor'
import { useLock } from '../lib/lock'
import { noteById, useStore } from '../lib/store'
import { useUi } from '../lib/ui'
import {
  addRecording,
  attachMenu,
  checklistMenu,
  deleteNotes,
  find,
  insertTable,
  lockNow,
  MOD,
  newNote,
  noteMenu,
  paperMenu,
  selectedNotes,
  shareMenu,
  SHIFT,
  toggleChecklist,
  toggleLock
} from './actions'
import { FormatPanel } from './FormatPanel'
import { menuUnder, type MenuItem } from './overlays'

// The window's toolbar, like Apple Notes': view and delete over the list; new note, format,
// checklist, table, attachments, recording, lock, share and search over the note.

function tableMenu(): MenuItem[] {
  const e = useEditorRef.getState().editor
  if (!e?.isActive('table')) return [{ label: 'Insert Table', shortcut: `${'⌥'}${MOD}T`, disabled: !e, onClick: insertTable }]
  const c = () => e.chain().focus()
  return [
    { label: 'Add Row Above', onClick: () => c().addRowBefore().run() },
    { label: 'Add Row Below', onClick: () => c().addRowAfter().run() },
    { label: 'Add Column Before', onClick: () => c().addColumnBefore().run() },
    { label: 'Add Column After', onClick: () => c().addColumnAfter().run() },
    { separator: true },
    { label: 'Delete Row', onClick: () => c().deleteRow().run() },
    { label: 'Delete Column', onClick: () => c().deleteColumn().run() },
    { separator: true },
    { label: 'Merge Cells', disabled: !e.can().mergeCells(), onClick: () => c().mergeCells().run() },
    { label: 'Split Cell', disabled: !e.can().splitCell(), onClick: () => c().splitCell().run() },
    { label: 'Header Row', onClick: () => c().toggleHeaderRow().run() },
    { label: 'Header Column', onClick: () => c().toggleHeaderColumn().run() },
    { separator: true },
    { label: 'Delete Table', danger: true, onClick: () => c().deleteTable().run() }
  ]
}

function moreMenu(): MenuItem[] {
  const note = selectedNotes()[0]
  const { settings } = useStore.getState()
  return [
    ...(note ? noteMenu([note]).filter((i) => i.label !== 'Share') : []),
    { separator: true },
    { label: 'Find in Note', shortcut: `${MOD}F`, disabled: !useEditorRef.getState().editor, onClick: find },
    { label: 'Lines & Grids', submenu: paperMenu(note) },
    { label: 'Checklist', submenu: checklistMenu() },
    { separator: true },
    { label: 'Sort Checked Items to Bottom', checked: settings.sortChecked, onClick: () => useStore.getState().setSettings({ sortChecked: !settings.sortChecked }) },
    { label: 'Attachments Browser', onClick: () => useUi.setState({ attachmentsBrowser: true, galleryOpen: false }) }
  ]
}

function SearchBox() {
  const search = useUi((s) => s.search)
  const searching = useUi((s) => s.searching)
  if (!searching && !search)
    return (
      <button className="tb-btn" title={`Search (${'⌥'}${MOD}F)`} onClick={() => useUi.setState({ searching: true })}>
        <Search size={17} />
      </button>
    )
  return (
    <div className="search-field">
      <Search size={14} />
      <input
        autoFocus
        placeholder="Search"
        value={search}
        onChange={(e) => useUi.setState({ search: e.target.value })}
        onKeyDown={(e) => {
          if (e.key === 'Escape') useUi.setState({ search: '', searching: false })
        }}
        onBlur={() => !search && useUi.setState({ searching: false })}
      />
      {search && (
        <button onMouseDown={(e) => e.preventDefault()} onClick={() => useUi.setState({ search: '' })} title="Clear">
          <X size={12} />
        </button>
      )}
    </div>
  )
}

export function Toolbar({ listWidth, showList }: { listWidth: number; showList: boolean }) {
  const view = useStore((s) => s.settings.view)
  const sidebarHidden = useStore((s) => s.settings.sidebarHidden)
  const hasLock = useStore((s) => Boolean(s.settings.lock))
  const noteId = useUi((s) => s.noteId)
  const source = useUi((s) => s.source)
  const note = useStore((s) => (noteId ? s.notes.find((n) => n.id === noteId) : undefined))
  const unlocked = useLock((s) => Boolean(s.key))
  const editor = useEditorRef((s) => s.editor)
  const [format, setFormat] = useState<DOMRect | null>(null)
  const inTable = useEditorState({ editor, selector: ({ editor: e }) => Boolean(e?.isActive('table')) })
  const inChecklist = useEditorState({ editor, selector: ({ editor: e }) => Boolean(e?.isActive('taskList')) })
  const trash = source.kind === 'trash'
  const noteEditable = Boolean(editor && note && !note.deletedAt)

  return (
    <div className="toolbar">
      <div className="toolbar-list" style={{ width: showList ? listWidth : undefined }}>
        <button className="tb-btn" title={`${sidebarHidden ? 'Show' : 'Hide'} Folders`} onClick={() => useStore.getState().setSettings({ sidebarHidden: !sidebarHidden })}>
          <PanelLeft size={17} />
        </button>
        <div className="tb-seg">
          <button className={view === 'list' ? 'is-on' : ''} title="View as List" onClick={() => (useStore.getState().setSettings({ view: 'list' }), useUi.setState({ galleryOpen: false }))}>
            <List size={16} />
          </button>
          <button className={view === 'gallery' ? 'is-on' : ''} title="View as Gallery" onClick={() => (useStore.getState().setSettings({ view: 'gallery' }), useUi.setState({ galleryOpen: false }))}>
            <LayoutGrid size={15} />
          </button>
        </div>
        <span className="tb-flex" />
        <button className="tb-btn" title="Delete" disabled={!noteId} onClick={() => void deleteNotes()}>
          <Trash2 size={17} />
        </button>
      </div>
      <div className="toolbar-note">
        <button className="tb-btn" title={`New Note (${MOD}N)`} disabled={trash && false} onClick={() => newNote()}>
          <SquarePen size={17} />
        </button>
        <span className="tb-gap" />
        <button className={`tb-btn${format ? ' is-on' : ''}`} title="Format" disabled={!noteEditable} onClick={(e) => setFormat(format ? null : e.currentTarget.getBoundingClientRect())}>
          <ALargeSmall size={19} />
        </button>
        <button
          className={`tb-btn${inChecklist ? ' is-on' : ''}`}
          title={`Checklist (${SHIFT}${MOD}L)`}
          disabled={!noteEditable}
          onClick={toggleChecklist}
          onContextMenu={(e) => (e.preventDefault(), menuUnder(e.currentTarget, checklistMenu()))}
        >
          <ListChecks size={17} />
        </button>
        <button className={`tb-btn${inTable ? ' is-on' : ''}`} title="Table" disabled={!noteEditable} onClick={(e) => (inTable ? menuUnder(e.currentTarget, tableMenu()) : insertTable())}>
          <Table size={17} />
        </button>
        <button className="tb-btn" title="Attach" disabled={!noteEditable} onClick={(e) => menuUnder(e.currentTarget, attachMenu())}>
          <Paperclip size={17} />
        </button>
        <button className="tb-btn" title="Record Audio" disabled={!noteEditable} onClick={() => void addRecording()}>
          <AudioLines size={17} />
        </button>
        <span className="tb-flex" />
        <button
          className="tb-btn"
          title="Lock"
          disabled={!note || Boolean(note.deletedAt)}
          onClick={(e) =>
            menuUnder(
              e.currentTarget,
              [
                { label: note?.locked ? 'Remove Lock' : 'Lock Note', onClick: () => void toggleLock() },
                ...(hasLock ? [{ label: 'Lock Now', disabled: !unlocked, onClick: lockNow }] : [])
              ],
              'right'
            )
          }
        >
          {note?.locked && unlocked ? <LockOpen size={17} /> : <Lock size={17} />}
        </button>
        <button className="tb-btn" title="Share" disabled={!note} onClick={(e) => menuUnder(e.currentTarget, shareMenu(noteById(noteId)), 'right')}>
          <Share size={17} />
        </button>
        <button className="tb-btn" title="More" onClick={(e) => menuUnder(e.currentTarget, moreMenu(), 'right')}>
          <MoreHorizontal size={17} />
        </button>
        <SearchBox />
      </div>
      {format && editor && <FormatPanel editor={editor} anchor={format} onClose={() => setFormat(null)} />}
    </div>
  )
}
