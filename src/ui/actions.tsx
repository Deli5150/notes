import type { Editor as TEditor } from '@tiptap/core'
import { putAttachment } from '../lib/attachments'
import { openImageWand } from './ImageWand'
import { openCanvas } from '../canvas/state'
import { Copy, FileDown, FileText, FolderInput, Lock, LockOpen, Pin, PinOff, Printer, Trash2 } from 'lucide-react'
import { insertAttachments, insertFiles, insertLinkPreview } from '../editor/setup'
import { captureCamera, recordAudio } from '../editor/Capture'
import { startHtml, useEditorRef } from '../editor/Editor'
import { newSketch } from '../editor/Sketch'
import { copyNote, exportNote, printNote, type ExportFormat } from '../lib/export'
import { hasPassword, isUnlocked, lockNote, lockNow, removeLock, setPassword, unlock, unlockWithTouchId } from '../lib/lock'
import { notesFor, sortNotes } from '../lib/query'
import { desktop, isMac } from '../lib/storage'
import { keysLabel } from '../lib/shortcuts'
import { noteById, useStore } from '../lib/store'
import { useUi } from '../lib/ui'
import { DEFAULT_FOLDER, QUICK_NOTES, type Folder, type Note, type Paper } from '../lib/types'
import { confirm, openDialog, prompt, toast, type MenuItem } from './overlays'
import { PasswordSetup } from './PasswordSetup'
import { openSmartFolder } from './SmartFolder'

// What the toolbar, menus, keyboard shortcuts and the desktop app's menu bar do.

export const MOD = isMac ? '⌘' : 'Ctrl+'
export const SHIFT = isMac ? '⇧' : 'Shift+'
export const ALT = isMac ? '⌥' : 'Alt+'

/** The folder new notes go in: the selected folder, or Notes. */
function targetFolder(): string {
  const { source } = useUi.getState()
  if (source.kind === 'folder') {
    const f = useStore.getState().folders.find((x) => x.id === source.id)
    if (f && !f.smart) return f.id
  }
  return DEFAULT_FOLDER
}

export function newNote(folderId = targetFolder(), html?: string): Note {
  const ui = useUi.getState()
  const src = ui.source
  const smart = src.kind === 'folder' && useStore.getState().folders.find((f) => f.id === src.id)?.smart
  if (src.kind === 'trash' || smart) ui.select({ kind: 'folder', id: folderId })
  // Tags view: the new note starts with those tags.
  const tags = ui.source.kind === 'tags' ? ui.source.tags : []
  const start = html ?? (tags.length ? `${startHtml()}<p>${tags.map((t) => `#${t}`).join(' ')}</p>` : startHtml())
  const note = useStore.getState().createNote(folderId, start)
  useUi.setState({ search: '', searching: false, galleryOpen: useStore.getState().settings.view === 'gallery' })
  ui.open(note.id)
  useUi.setState({ phoneNote: true })
  return note
}

export function newQuickNote(): void {
  useUi.getState().select({ kind: 'folder', id: QUICK_NOTES })
  newNote(QUICK_NOTES)
}

export async function newFolder(parentId?: string): Promise<Folder | null> {
  const name = await prompt({ title: 'New Folder', placeholder: 'Name', ok: 'Create' })
  if (!name) return null
  const f = useStore.getState().createFolder(name, parentId)
  useUi.getState().select({ kind: 'folder', id: f.id })
  return f
}

export const newSmartFolder = (): void => openSmartFolder()

export const selectedNotes = (): Note[] => {
  const { selected, noteId } = useUi.getState()
  const ids = selected.length ? selected : noteId ? [noteId] : []
  return ids.map((id) => noteById(id)).filter((n): n is Note => Boolean(n))
}

/** The notes the list shows, in order (for moving the selection after a delete). */
export function visibleNotes(): Note[] {
  const { source } = useUi.getState()
  const { notes, folders, settings } = useStore.getState()
  return sortNotes(notesFor(source, notes, folders), settings.sortBy, settings.sortDir)
}

export async function deleteNotes(notes = selectedNotes()): Promise<void> {
  if (!notes.length) return
  const s = useStore.getState()
  const inTrash = notes.every((n) => n.deletedAt)
  if (inTrash) {
    const ok = await confirm({ title: notes.length > 1 ? `Delete ${notes.length} notes permanently?` : 'Delete this note permanently?', message: 'You can’t undo this.', ok: 'Delete', danger: true })
    if (!ok) return
  }
  const list = visibleNotes()
  const ids = new Set(notes.map((n) => n.id))
  const after = list.slice(list.findIndex((n) => ids.has(n.id))).find((n) => !ids.has(n.id)) ?? [...list].reverse().find((n) => !ids.has(n.id))
  s.deleteNotes(notes.map((n) => n.id))
  useUi.getState().open(after?.id ?? null)
  if (!inTrash) toast(notes.length > 1 ? `${notes.length} notes moved to Recently Deleted` : 'Moved to Recently Deleted', { label: 'Undo', run: () => s.recoverNotes(notes.map((n) => n.id)) })
}

export function togglePin(notes = selectedNotes()): void {
  const pin = !notes.every((n) => n.pinned)
  for (const n of notes) if (!n.deletedAt) useStore.getState().updateNote(n.id, { pinned: pin })
}

export function duplicate(note = selectedNotes()[0]): void {
  if (!note) return
  const copy = useStore.getState().duplicateNote(note.id)
  if (copy) useUi.getState().open(copy.id)
}

export function moveMenu(notes = selectedNotes()): MenuItem[] {
  const { folders } = useStore.getState()
  const regular = folders.filter((f) => !f.smart)
  const build = (parent?: string, depth = 0): MenuItem[] =>
    regular
      .filter((f) => f.parentId === parent)
      .sort((a, b) => a.order - b.order || a.name.localeCompare(b.name))
      .flatMap((f) => [
        { label: `${'   '.repeat(depth)}${f.name}`, checked: notes.length > 0 && notes.every((n) => n.folderId === f.id && !n.deletedAt), onClick: () => moveTo(notes, f.id) },
        ...build(f.id, depth + 1)
      ])
  return [...build(), { separator: true }, { label: 'New Folder…', onClick: () => void newFolder().then((f) => f && moveTo(notes, f.id)) }]
}

export function moveTo(notes: Note[], folderId: string): void {
  useStore.getState().moveNotes(
    notes.map((n) => n.id),
    folderId
  )
  const name = useStore.getState().folders.find((f) => f.id === folderId)?.name
  toast(`Moved to ${name}`)
}

/** Lock or unlock the open note (setting up the password the first time). */
export async function toggleLock(note = selectedNotes()[0]): Promise<void> {
  if (!note || note.deletedAt) return
  if (note.locked) {
    if (!isUnlocked() && !(await askPassword())) return
    await removeLock(note.id)
    toast('Lock removed')
    return
  }
  if (!hasPassword()) {
    const ok = await setupPassword()
    if (!ok) return
  } else if (!isUnlocked() && !(await askPassword())) return
  await lockNote(note.id)
  toast('Note locked. Choose Lock Now to close locked notes.')
}

export function setupPassword(): Promise<boolean> {
  return new Promise((resolve) => {
    openDialog(
      (close) => (
        <PasswordSetup
          onDone={async (password, hint) => {
            await setPassword(password, hint)
            close()
            resolve(true)
          }}
          onCancel={() => (close(), resolve(false))}
        />
      ),
      { dismissable: false }
    )
  })
}

export async function askPassword(): Promise<boolean> {
  if (await unlockWithTouchId()) return true
  const hint = useStore.getState().settings.lock?.hint
  const pw = await prompt({
    title: 'Enter the notes password',
    message: hint ? `Hint: ${hint}` : undefined,
    password: true,
    ok: 'OK',
    validate: async (v) => ((await unlock(v)) ? undefined : 'Wrong password. Try again.')
  })
  return pw !== null
}

export { lockNow }

export async function exportAs(format: ExportFormat, note = selectedNotes()[0]): Promise<void> {
  if (!note) return
  if (note.locked && !isUnlocked() && !(await askPassword())) return
  if (await exportNote(note, format)) toast('Exported')
}

export async function print(note = selectedNotes()[0]): Promise<void> {
  if (!note) return
  if (note.locked && !isUnlocked() && !(await askPassword())) return
  await printNote(note)
}

export function shareMenu(note = selectedNotes()[0]): MenuItem[] {
  const off = !note
  return [
    { label: 'Export as PDF…', icon: <FileDown size={14} />, disabled: off, onClick: () => void exportAs('pdf') },
    { label: 'Export as Markdown…', icon: <FileText size={14} />, disabled: off, onClick: () => void exportAs('markdown') },
    { label: 'Export as HTML…', disabled: off, onClick: () => void exportAs('html') },
    { label: 'Export as Plain Text…', disabled: off, onClick: () => void exportAs('text') },
    { separator: true },
    {
      label: 'Copy Note',
      icon: <Copy size={14} />,
      disabled: off,
      onClick: () =>
        void copyNote(note!)
          .then(() => toast('Copied'))
          .catch(() => toast('Couldn’t copy'))
    },
    { label: 'Print…', icon: <Printer size={14} />, shortcut: keysLabel('print'), disabled: off, onClick: () => void print() }
  ]
}

export function noteMenu(notes = selectedNotes()): MenuItem[] {
  const one = notes.length === 1 ? notes[0] : null
  if (notes.length && notes.every((n) => n.deletedAt)) {
    return [
      { label: 'Recover', icon: <FolderInput size={14} />, onClick: () => useStore.getState().recoverNotes(notes.map((n) => n.id)) },
      { label: 'Move to', submenu: moveMenu(notes) },
      { separator: true },
      { label: 'Delete Permanently', icon: <Trash2 size={14} />, danger: true, onClick: () => void deleteNotes(notes) }
    ]
  }
  const pinned = notes.every((n) => n.pinned)
  return [
    { label: pinned ? 'Unpin Note' : 'Pin Note', icon: pinned ? <PinOff size={14} /> : <Pin size={14} />, onClick: () => togglePin(notes) },
    ...(one ? [{ label: one.locked ? 'Remove Lock' : 'Lock Note', icon: one.locked ? <LockOpen size={14} /> : <Lock size={14} />, onClick: () => void toggleLock(one) }] : []),
    { separator: true },
    { label: 'Move to', icon: <FolderInput size={14} />, submenu: moveMenu(notes) },
    ...(one ? [{ label: 'Duplicate', icon: <Copy size={14} />, shortcut: keysLabel('duplicate'), onClick: () => duplicate(one) }] : []),
    ...(one ? [{ label: 'Share', submenu: shareMenu(one) }] : []),
    { separator: true },
    { label: 'Delete', icon: <Trash2 size={14} />, danger: true, onClick: () => void deleteNotes(notes) }
  ]
}

// ── In the open note ───────────────────────────────────────────────────────────────────────────

const ed = () => useEditorRef.getState().editor

export function insertTable(): void {
  ed()?.chain().focus().insertTable({ rows: 3, cols: 3, withHeaderRow: false }).run()
}

export function toggleChecklist(): void {
  ed()?.chain().focus().toggleTaskList().run()
}

export async function attachFiles(accept = '*/*'): Promise<void> {
  const editor = ed()
  if (!editor) return
  const input = document.createElement('input')
  input.type = 'file'
  input.multiple = true
  input.accept = accept
  input.onchange = () => input.files && void insertFiles(editor, [...input.files])
  input.click()
}

/** Image Wand: a picture from a description (and the note's text), put where the cursor is. */
export function imageWand(): void {
  const editor = ed()
  if (!editor) return
  const at = editor.state.selection.to
  openImageWand({
    context: editor.getText({ blockSeparator: '\n' }),
    onInsert: (img) => void insertGenerated(editor, img, at)
  })
}

/** A generated picture as an attachment, at `at` in the note. */
export async function insertGenerated(editor: TEditor, img: { bytes: Uint8Array; mime: string }, at: number): Promise<void> {
  const att = await putAttachment(img.bytes)
  if (editor.isDestroyed) return
  editor
    .chain()
    .focus()
    .insertContentAt(Math.min(at, editor.state.doc.content.size), { type: 'attachment', attrs: { att, kind: 'image', mime: img.mime, size: img.bytes.length, name: 'Image Wand', width: 'large' } })
    .run()
}

/** A canvas (Excalidraw) where the cursor is: it opens over the note, and goes in on Done. */
export async function addCanvas(): Promise<void> {
  const editor = ed()
  if (!editor) return
  const at = editor.state.selection.to
  const attrs = await openCanvas(null)
  if (!attrs || editor.isDestroyed) return
  editor.chain().focus().insertContentAt(Math.min(at, editor.state.doc.content.size), { type: 'attachment', attrs }).run()
}

export async function addSketch(): Promise<void> {
  const editor = ed()
  if (!editor) return
  const attrs = await newSketch()
  if (attrs) insertAttachments(editor, [{ ...attrs, width: 'large' }])
}

export async function addRecording(): Promise<void> {
  const editor = ed()
  if (!editor) return
  const attrs = await recordAudio()
  if (attrs) insertAttachments(editor, [attrs])
}

export async function addFromCamera(mode: 'scan' | 'photo'): Promise<void> {
  const editor = ed()
  if (!editor) return
  const list = await captureCamera(mode)
  if (list) insertAttachments(editor, list)
}

export async function addLink(): Promise<void> {
  const editor = ed()
  if (!editor) return
  const current = editor.getAttributes('link').href as string | undefined
  const url = await prompt({ title: current ? 'Edit Link' : 'Add Link', message: 'A web address, or type >> in a note to link to another note.', value: current ?? 'https://', ok: current ? 'Save' : 'Add', allowEmpty: Boolean(current) })
  if (url === null) return
  if (!url.trim() || url.trim() === 'https://') {
    editor.chain().focus().extendMarkRange('link').unsetLink().run()
    return
  }
  const href = /^[a-z]+:/i.test(url.trim()) ? url.trim() : `https://${url.trim()}`
  if (editor.state.selection.empty && !current) {
    if (desktop) await insertLinkPreview(editor, href)
    else editor.chain().focus().insertContent({ type: 'text', text: href, marks: [{ type: 'link', attrs: { href } }] }).run()
  } else editor.chain().focus().extendMarkRange('link').setLink({ href }).run()
}

export function attachMenu(): MenuItem[] {
  return [
    { label: 'Photo or Video…', onClick: () => void attachFiles('image/*,video/*') },
    { label: 'Attach File…', shortcut: keysLabel('attach'), onClick: () => void attachFiles() },
    { separator: true },
    { label: 'Scan Documents', onClick: () => void addFromCamera('scan') },
    { label: 'Take Photo', onClick: () => void addFromCamera('photo') },
    { label: 'Add Sketch', onClick: () => void addSketch() },
    { label: 'Record Audio', onClick: () => void addRecording() },
    { separator: true },
    { label: 'Add Link…', shortcut: keysLabel('link'), onClick: () => void addLink() }
  ]
}

export const PAPERS: Array<{ id: Paper; label: string }> = [
  { id: 'none', label: 'None' },
  { id: 'lines-small', label: 'Small Lines' },
  { id: 'lines', label: 'Medium Lines' },
  { id: 'lines-large', label: 'Large Lines' },
  { id: 'grid-small', label: 'Small Grid' },
  { id: 'grid', label: 'Medium Grid' },
  { id: 'grid-large', label: 'Large Grid' },
  { id: 'dots', label: 'Dots' }
]

export function paperMenu(note = selectedNotes()[0]): MenuItem[] {
  const current = note?.paper ?? useStore.getState().settings.paper
  return PAPERS.map((p) => ({ label: p.label, checked: current === p.id, disabled: !note, onClick: () => note && useStore.getState().updateNote(note.id, { paper: p.id }) }))
}

export function checklistMenu(): MenuItem[] {
  const e = ed()
  return [
    { label: 'Check All', disabled: !e, onClick: () => e?.chain().focus().setAllChecked(true).run() },
    { label: 'Uncheck All', disabled: !e, onClick: () => e?.chain().focus().setAllChecked(false).run() },
    { label: 'Move Checked to Bottom', disabled: !e, onClick: () => e?.chain().focus().sortChecked().run() },
    { label: 'Delete Checked Items', disabled: !e, onClick: () => e?.chain().focus().deleteChecked().run() }
  ]
}

export function find(): void {
  if (ed()) useUi.setState({ findOpen: true })
}

export function searchNotes(): void {
  useUi.setState({ searching: true })
  setTimeout(() => document.querySelector<HTMLInputElement>('.search-field input')?.focus(), 0)
}
