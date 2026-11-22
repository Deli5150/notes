import { useEditorRef } from '../editor/Editor'
import { STYLES } from './FormatPanel'
import { useStore } from '../lib/store'
import { useUi } from '../lib/ui'
import { desktop } from '../lib/storage'
import type { Paper, SortBy } from '../lib/types'
import {
  addFromCamera,
  addLink,
  addRecording,
  addSketch,
  attachFiles,
  deleteNotes,
  duplicate,
  exportAs,
  find,
  insertTable,
  lockNow,
  newFolder,
  newNote,
  newQuickNote,
  newSmartFolder,
  print,
  searchNotes,
  selectedNotes,
  toggleChecklist,
  toggleLock,
  togglePin
} from './actions'
import { showUpdates } from './UpdateSheet'

// Commands by name: what the desktop app's menu bar (desktop/main.cjs) and keyboard shortcuts in
// a browser run.

const editor = () => useEditorRef.getState().editor

export function runCommand(cmd: string, arg?: string): void {
  const e = editor()
  const style = STYLES.find((s) => `style:${s.id}` === cmd)
  if (style) {
    if (e) style.run(e)
    return
  }
  switch (cmd) {
    case 'new-note':
      newNote()
      break
    case 'close-note':
      // ⌘W closes the open note, then the window.
      if (useUi.getState().noteId) useUi.getState().close()
      else desktop?.closeWindow()
      break
    case 'new-quick-note':
      newQuickNote()
      break
    case 'new-folder':
      void newFolder()
      break
    case 'new-smart-folder':
      newSmartFolder()
      break
    case 'settings':
      useUi.setState({ settings: (arg as never) || 'general' })
      break
    case 'import':
      useUi.setState({ settings: 'import' })
      break
    case 'feedback':
      useUi.setState({ settings: 'feedback' })
      break
    case 'updates':
      showUpdates()
      break
    case 'about':
      useUi.setState({ settings: 'about' })
      break
    case 'open-note': {
      // From the floating note: show it here.
      const n = useStore.getState().notes.find((x) => x.id === arg)
      if (!n) break
      useUi.getState().select({ kind: 'folder', id: n.folderId })
      useUi.getState().open(n.id)
      break
    }
    case 'float-note':
      desktop?.float.toggle()
      break
    case 'search':
      searchNotes()
      break
    case 'find':
      find()
      break
    case 'delete':
      void deleteNotes()
      break
    case 'pin':
      togglePin()
      break
    case 'lock':
      void toggleLock()
      break
    case 'lock-now':
      lockNow()
      break
    case 'duplicate':
      duplicate()
      break
    case 'print':
      void print()
      break
    case 'export':
      void exportAs((arg as 'pdf' | 'markdown' | 'html' | 'text') ?? 'pdf')
      break
    case 'checklist':
      toggleChecklist()
      break
    case 'check':
      e?.commands.keyboardShortcut('Mod-Shift-u')
      break
    case 'table':
      insertTable()
      break
    case 'link':
      void addLink()
      break
    case 'attach':
      void attachFiles()
      break
    case 'sketch':
      void addSketch()
      break
    case 'record':
      void addRecording()
      break
    case 'scan':
      void addFromCamera('scan')
      break
    case 'photo':
      void addFromCamera('photo')
      break
    case 'bold':
      e?.chain().focus().toggleBold().run()
      break
    case 'italic':
      e?.chain().focus().toggleItalic().run()
      break
    case 'underline':
      e?.chain().focus().toggleUnderline().run()
      break
    case 'strike':
      e?.chain().focus().toggleStrike().run()
      break
    case 'highlight':
      e?.chain().focus().toggleHighlight({ color: arg || 'yellow' }).run()
      break
    case 'bigger':
    case 'smaller': {
      if (!e) break
      const now = parseInt((e.getAttributes('textStyle').fontSize as string) ?? '', 10) || useStore.getState().settings.fontSize
      e.chain().focus().setFontSize(`${Math.max(8, Math.min(72, now + (cmd === 'bigger' ? 2 : -2)))}px`).run()
      break
    }
    case 'align':
      e?.chain().focus().setTextAlign(arg ?? 'left').run()
      break
    case 'indent':
      e?.chain().focus().indent().run()
      break
    case 'outdent':
      e?.chain().focus().outdent().run()
      break
    case 'paper': {
      const n = selectedNotes()[0]
      if (n) useStore.getState().updateNote(n.id, { paper: arg as Paper })
      break
    }
    case 'view':
      useStore.getState().setSettings({ view: arg === 'gallery' ? 'gallery' : 'list' })
      useUi.setState({ galleryOpen: false })
      break
    case 'sort':
      useStore.getState().setSettings({ sortBy: arg as SortBy, sortDir: arg === 'title' ? 'asc' : 'desc' })
      break
    case 'group':
      useStore.getState().setSettings({ groupByDate: !useStore.getState().settings.groupByDate })
      break
    case 'sidebar':
      useStore.getState().setSettings({ sidebarHidden: !useStore.getState().settings.sidebarHidden })
      break
    case 'attachments':
      useUi.setState({ attachmentsBrowser: !useUi.getState().attachmentsBrowser, galleryOpen: false })
      break
  }
}
