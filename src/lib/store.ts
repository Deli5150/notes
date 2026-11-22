import { create } from 'zustand'
import { derive, splitTitle, titleFor } from './content'
import { DEFAULT_SETTINGS, emptyData, isSystemFolder, systemFolders, uid, welcomeNote } from './defaults'
import { loadData, saveData } from './storage'
import { emptyMeta, stampChanges, type SyncMeta } from './sync'
import { DEFAULT_FOLDER, QUICK_NOTES, type AppData, type Folder, type Note, type Settings, type SmartFilter } from './types'

// All of Notes' data in one store, saved (shortly after each change) as a single JSON document.

export const TRASH_DAYS = 30

interface Store extends AppData {
  loaded: boolean
  /** Sync with Google's bookkeeping for this device (saved with the data, never exported). */
  sync: SyncMeta
  /** dropBlank: empty notes left from before are deleted (the main window; not the floating note). */
  hydrate(opts?: { dropBlank?: boolean }): Promise<void>
  createNote(folderId: string, html?: string, extra?: Partial<Note>): Note
  setContent(id: string, html: string): void
  setName(id: string, name: string): void
  updateNote(id: string, patch: Partial<Note>): void
  deleteNotes(ids: string[]): void
  recoverNotes(ids: string[]): void
  purgeNotes(ids: string[]): void
  emptyTrash(): void
  duplicateNote(id: string): Note | null
  moveNotes(ids: string[], folderId: string): void
  createFolder(name: string, parentId?: string, smart?: SmartFilter): Folder
  updateFolder(id: string, patch: Partial<Folder>): void
  deleteFolder(id: string): void
  renameTag(from: string, to: string): void
  deleteTag(tag: string): void
  setSettings(patch: Partial<Settings>): void
  addImported(folders: Folder[], notes: Note[]): void
  replaceAll(data: AppData): void
}

/** Fills in anything an older or hand-edited file is missing. */
export function normalize(raw: Partial<AppData>): AppData {
  const folders = Array.isArray(raw.folders) ? raw.folders.filter((f) => f && f.id) : []
  for (const f of systemFolders()) if (!folders.some((x) => x.id === f.id)) folders.push(f)
  const known = new Set(folders.map((f) => f.id))
  const notes = (Array.isArray(raw.notes) ? raw.notes : [])
    .filter((n) => n && n.id)
    .map((n) => ({
      ...n,
      folderId: known.has(n.folderId) ? n.folderId : DEFAULT_FOLDER,
      html: n.html ?? '',
      text: n.text ?? '',
      title: n.title ?? '',
      createdAt: n.createdAt ?? Date.now(),
      updatedAt: n.updatedAt ?? n.createdAt ?? Date.now(),
      pinned: Boolean(n.pinned),
      tags: Array.isArray(n.tags) ? n.tags : [],
      attachments: Array.isArray(n.attachments) ? n.attachments : [],
      hasChecklist: Boolean(n.hasChecklist)
    }))
  const settings = { ...DEFAULT_SETTINGS, ...(raw.settings ?? {}) }
  // 'local' was the old default, from before titles could come from Apple Intelligence.
  if ((settings.titleEngine as string) === 'local') settings.titleEngine = 'auto'
  return { version: 1, folders, notes, settings }
}

/** Notes from before the title field: their first heading becomes the title. */
function withName(n: Note): Note {
  if (n.name !== undefined || n.locked || typeof DOMParser === 'undefined') return n.name === undefined ? { ...n, name: n.locked ? n.title : '' } : n
  const { name, html } = splitTitle(n.html)
  if (!name) return { ...n, name: '' }
  return { ...n, name, html, ...derive(html), title: name }
}

const dataOf = (s: Store): AppData => ({ version: 1, folders: s.folders, notes: s.notes, settings: s.settings })

/** A folder and every folder inside it. */
export function folderTree(folders: Folder[], id: string): string[] {
  const out = [id]
  for (let i = 0; i < out.length; i++) for (const f of folders) if (f.parentId === out[i]) out.push(f.id)
  return out
}

const mapNotes = (notes: Note[], ids: Set<string>, fn: (n: Note) => Note): Note[] => notes.map((n) => (ids.has(n.id) ? fn(n) : n))

export const useStore = create<Store>((set, get) => ({
  ...emptyData(),
  loaded: false,
  sync: emptyMeta(),

  async hydrate(opts) {
    try {
      const json = await loadData()
      if (json) {
        const raw = JSON.parse(json) as Partial<AppData> & { sync?: SyncMeta }
        const data = normalize(raw)
        // Recently Deleted keeps notes for 30 days.
        const cutoff = Date.now() - TRASH_DAYS * 86_400_000
        data.notes = data.notes.filter((n) => !n.deletedAt || n.deletedAt > cutoff).map(withName)
        set({ ...data, sync: { ...emptyMeta(), ...raw.sync } })
      } else {
        const w = welcomeNote()
        set({ notes: [{ ...w, ...derive(w.html), title: w.title }] })
      }
    } catch (e) {
      console.warn('Notes: could not read saved data', e)
    }
    set({ loaded: true })
    // After loading, so Sync hears they're gone too.
    if (opts?.dropBlank) {
      const blank = get().notes.filter(isBlankNote).map((n) => n.id)
      if (blank.length) get().purgeNotes(blank)
    }
  },

  createNote(folderId, html = '', extra = {}) {
    const now = Date.now()
    const folder = get().folders.find((f) => f.id === folderId)
    const note: Note = {
      id: uid(),
      folderId: folder && !folder.smart ? folderId : DEFAULT_FOLDER,
      html,
      name: '',
      text: '',
      title: '',
      createdAt: now,
      updatedAt: now,
      pinned: false,
      tags: [],
      attachments: [],
      hasChecklist: false,
      ...(html ? derive(html) : {}),
      ...extra
    }
    note.title = titleFor(note.name, html ? derive(html).title : '')
    set((s) => ({ notes: [note, ...s.notes] }))
    return note
  },

  setContent(id, html) {
    const d = derive(html)
    set((s) => ({ notes: s.notes.map((n) => (n.id === id && n.html !== html ? { ...n, ...d, title: titleFor(n.name, d.title), html, updatedAt: Date.now() } : n)) }))
  },

  setName(id, name) {
    set((s) => ({
      notes: s.notes.map((n) => {
        if (n.id !== id || n.name === name) return n
        const derived = n.locked ? '' : derive(n.html).title
        return { ...n, name, title: titleFor(name, derived) || (n.locked ? n.title : ''), updatedAt: Date.now() }
      })
    }))
  },

  updateNote(id, patch) {
    set((s) => ({ notes: s.notes.map((n) => (n.id === id ? { ...n, ...patch } : n)) }))
  },

  deleteNotes(ids) {
    const gone = new Set(ids)
    const now = Date.now()
    // Already in Recently Deleted (or empty): delete for good.
    const purge = new Set(get().notes.filter((n) => gone.has(n.id) && (n.deletedAt || (!n.text.trim() && !n.attachments.length && !n.locked))).map((n) => n.id))
    set((s) => ({
      notes: s.notes.filter((n) => !purge.has(n.id)).map((n) => (gone.has(n.id) ? { ...n, deletedAt: now, deletedFrom: n.folderId, pinned: false } : n))
    }))
  },

  recoverNotes(ids) {
    const folders = new Set(get().folders.map((f) => f.id))
    set((s) => ({
      notes: mapNotes(s.notes, new Set(ids), ({ deletedAt: _d, deletedFrom, ...n }) => ({ ...n, folderId: deletedFrom && folders.has(deletedFrom) ? deletedFrom : DEFAULT_FOLDER }))
    }))
  },

  purgeNotes(ids) {
    const gone = new Set(ids)
    set((s) => ({ notes: s.notes.filter((n) => !gone.has(n.id)) }))
  },

  emptyTrash() {
    set((s) => ({ notes: s.notes.filter((n) => !n.deletedAt) }))
  },

  duplicateNote(id) {
    const n = get().notes.find((x) => x.id === id)
    if (!n) return null
    const now = Date.now()
    const copy: Note = { ...n, id: uid(), createdAt: now, updatedAt: now, pinned: false }
    set((s) => ({ notes: [copy, ...s.notes] }))
    return copy
  },

  moveNotes(ids, folderId) {
    set((s) => ({ notes: mapNotes(s.notes, new Set(ids), ({ deletedAt: _d, deletedFrom: _f, ...n }) => ({ ...n, folderId })) }))
  },

  createFolder(name, parentId, smart) {
    const siblings = get().folders.filter((f) => f.parentId === parentId)
    const folder: Folder = { id: uid(), name: name.trim() || 'New Folder', parentId, createdAt: Date.now(), order: Math.max(0, ...siblings.map((f) => f.order + 1)), ...(smart ? { smart } : {}) }
    set((s) => ({ folders: [...s.folders, folder] }))
    return folder
  },

  updateFolder(id, patch) {
    set((s) => ({ folders: s.folders.map((f) => (f.id === id ? { ...f, ...patch } : f)) }))
  },

  deleteFolder(id) {
    if (isSystemFolder(id)) return
    const ids = new Set(folderTree(get().folders, id))
    const now = Date.now()
    set((s) => ({
      folders: s.folders.filter((f) => !ids.has(f.id)),
      notes: s.notes.map((n) => (ids.has(n.folderId) ? { ...n, folderId: DEFAULT_FOLDER, deletedAt: n.deletedAt ?? now, deletedFrom: DEFAULT_FOLDER } : n))
    }))
  },

  renameTag(from, to) {
    const clean = to.replace(/^#/, '').trim().replace(/\s+/g, '-')
    if (!clean || clean === from) return
    const re = new RegExp(`(^|[\\s(>])#${from.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}(?![\\p{L}\\p{N}_-])`, 'gu')
    for (const n of get().notes.filter((n) => n.tags.includes(from))) get().setContent(n.id, n.html.replace(re, `$1#${clean}`))
  },

  deleteTag(tag) {
    // As in Apple Notes: the tag's text is taken out of every note.
    const re = new RegExp(`(^|[\\s(>])#${tag.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}(?![\\p{L}\\p{N}_-])`, 'gu')
    for (const n of get().notes.filter((n) => n.tags.includes(tag))) get().setContent(n.id, n.html.replace(re, '$1'))
  },

  setSettings(patch) {
    set((s) => ({ settings: { ...s.settings, ...patch } }))
  },

  addImported(folders, notes) {
    set((s) => ({ folders: [...s.folders, ...folders], notes: [...notes, ...s.notes] }))
  },

  replaceAll(data) {
    set({ ...normalize(data) })
  }
}))

/** Set while applying what Sync downloaded, so those changes aren't stamped as this device's. */
let applyingSync = false
export function applySynced(patch: Partial<Store>): void {
  applyingSync = true
  try {
    useStore.setState(patch)
  } finally {
    applyingSync = false
  }
}

const changeListeners = new Set<() => void>()
/** Called after this device changes something that syncs. */
export const onLocalChange = (fn: () => void): (() => void) => (changeListeners.add(fn), () => changeListeners.delete(fn))

// Note what changed for Sync, and save shortly after changes.
let timer: ReturnType<typeof setTimeout> | null = null
export function flushSave(): Promise<void> {
  if (timer) clearTimeout(timer)
  timer = null
  const s = useStore.getState()
  return saveData(JSON.stringify({ ...dataOf(s), sync: s.sync }))
}

useStore.subscribe((state, prev) => {
  if (!state.loaded || !prev.loaded) return
  if (!applyingSync) {
    const stamped = stampChanges(prev, state, state.sync)
    if (stamped) {
      useStore.setState({ sync: stamped })
      changeListeners.forEach((fn) => fn())
      return
    }
  }
  if (timer) clearTimeout(timer)
  timer = setTimeout(() => void flushSave(), 400)
})

if (typeof window !== 'undefined') window.addEventListener('beforeunload', () => void flushSave())

export const exportData = (): AppData => dataOf(useStore.getState())

/** Nothing written in it: no title, no text, no attachments (and not locked). */
export const isBlankNote = (n: Note | undefined): boolean => Boolean(n && !n.locked && !n.name?.trim() && !n.text.trim() && !n.attachments.length)

/** Deletes a note for good if it was left empty, so empty notes never pile up. */
export function dropIfBlank(id: string | null | undefined): void {
  if (id && isBlankNote(noteById(id))) useStore.getState().purgeNotes([id])
}

export const noteById = (id: string | null | undefined): Note | undefined => (id ? useStore.getState().notes.find((n) => n.id === id) : undefined)

export { DEFAULT_FOLDER, QUICK_NOTES }
