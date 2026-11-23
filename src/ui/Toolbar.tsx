import { useEditorState } from '@tiptap/react'
import { ChevronLeft, Shapes, WandSparkles, ALargeSmall, AudioLines, Inbox, ListChecks, Lock, LockOpen, MoreHorizontal, Paperclip, PanelLeft, Share, SquarePen, Table } from 'lucide-react'
import { listDate } from '../lib/dates'
import { FolderGlyph } from './FolderIcon'
import { useState } from 'react'
import { useEditorRef } from '../editor/Editor'
import { useLock } from '../lib/lock'
import { noteById, useStore } from '../lib/store'
import { useUi } from '../lib/ui'
import {
  addCanvas,
  imageWand,
  addRecording,
  attachMenu,
  checklistMenu,
  deleteNotes,
  find,
  insertTable,
  moveMenu,
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
import { withKeys } from '../lib/shortcuts'
import { backToList, isPhone } from '../lib/phone'
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

export function Toolbar() {
  const sidebarHidden = useStore((s) => s.settings.sidebarHidden)
  const hasLock = useStore((s) => Boolean(s.settings.lock))
  const noteId = useUi((s) => s.noteId)
  const note = useStore((s) => (noteId ? s.notes.find((n) => n.id === noteId) : undefined))
  const folder = useStore((s) => (note ? s.folders.find((f) => f.id === note.folderId) : undefined))
  const unlocked = useLock((s) => Boolean(s.key))
  const editor = useEditorRef((s) => s.editor)
  const [format, setFormat] = useState<DOMRect | null>(null)
  const inTable = useEditorState({ editor, selector: ({ editor: e }) => Boolean(e?.isActive('table')) })
  const inChecklist = useEditorState({ editor, selector: ({ editor: e }) => Boolean(e?.isActive('taskList')) })
  const noteEditable = Boolean(editor && note && !note.deletedAt)

  const phone = isPhone()
  return (
    <div className={`toolbar${note ? '' : ' is-empty'}`}>
      {phone && (
        <button className="tb-btn phone-back" aria-label="Back to notes" onClick={backToList}>
          <ChevronLeft size={22} />
        </button>
      )}
      {sidebarHidden && !phone && (
        <>
          <button className="tb-btn" title={withKeys('Show Sidebar', 'sidebar')} onClick={() => useStore.getState().setSettings({ sidebarHidden: false })}>
            <PanelLeft size={16} />
          </button>
          <button className="tb-btn" title={`New Note (${MOD}N)`} onClick={() => newNote()}>
            <SquarePen size={16} />
          </button>
        </>
      )}
      {note && (
        <button
          className="crumb"
          title="Move to another folder"
          onClick={(e) => !note.deletedAt && menuUnder(e.currentTarget, moveMenu([note]))}
        >
          {folder && folder.id !== 'notes' ? <FolderGlyph folder={folder} size={13} /> : <Inbox size={13} />}
          <span>{note.deletedAt ? 'Recently Deleted' : folder && folder.id !== 'notes' ? folder.name : 'Unfiled'}</span>
          <span className="crumb-sep">·</span>
          <span className="crumb-date">Edited {listDate(note.updatedAt).toLowerCase() === 'yesterday' ? 'yesterday' : listDate(note.updatedAt)}</span>
        </button>
      )}
      <span className="tb-flex" />
      <div className="tb-group">
        <button className={`tb-btn${format ? ' is-on' : ''}`} title="Format" disabled={!noteEditable} onClick={(e) => setFormat(format ? null : e.currentTarget.getBoundingClientRect())}>
          <ALargeSmall size={18} />
        </button>
        <button
          className={`tb-btn${inChecklist ? ' is-on' : ''}`}
          title={`Checklist (${SHIFT}${MOD}L)`}
          disabled={!noteEditable}
          onClick={toggleChecklist}
          onContextMenu={(e) => (e.preventDefault(), menuUnder(e.currentTarget, checklistMenu()))}
        >
          <ListChecks size={16} />
        </button>
        <button className={`tb-btn${inTable ? ' is-on' : ''}`} title="Table" disabled={!noteEditable} onClick={(e) => (inTable ? menuUnder(e.currentTarget, tableMenu()) : insertTable())}>
          <Table size={16} />
        </button>
        <button className="tb-btn" title="Canvas: shapes, arrows, drawing and text" disabled={!noteEditable} onClick={() => void addCanvas()}>
          <Shapes size={16} />
        </button>
        <button className="tb-btn" title="Image Wand: make a picture" disabled={!noteEditable} onClick={() => imageWand()}>
          <WandSparkles size={16} />
        </button>
        <button className="tb-btn" title="Attach" disabled={!noteEditable} onClick={(e) => menuUnder(e.currentTarget, attachMenu())}>
          <Paperclip size={16} />
        </button>
        <button className="tb-btn" title="Record Audio" disabled={!noteEditable} onClick={() => void addRecording()}>
          <AudioLines size={16} />
        </button>
      </div>
      <div className="tb-group">
        <button
          className="tb-btn"
          title="Lock"
          disabled={!note || Boolean(note.deletedAt)}
          onClick={(e) =>
            menuUnder(
              e.currentTarget,
              [{ label: note?.locked ? 'Remove Lock' : 'Lock Note', onClick: () => void toggleLock() }, ...(hasLock ? [{ label: 'Lock Now', disabled: !unlocked, onClick: lockNow }] : [])],
              'right'
            )
          }
        >
          {note?.locked && unlocked ? <LockOpen size={16} /> : <Lock size={16} />}
        </button>
        <button className="tb-btn" title="Share" disabled={!note} onClick={(e) => menuUnder(e.currentTarget, shareMenu(noteById(noteId)), 'right')}>
          <Share size={16} />
        </button>
        <button className="tb-btn" title="More" onClick={(e) => menuUnder(e.currentTarget, moreMenu(), 'right')}>
          <MoreHorizontal size={16} />
        </button>
      </div>
      {format && editor && <FormatPanel editor={editor} anchor={format} onClose={() => setFormat(null)} />}
    </div>
  )
}
