import { create } from 'zustand'
import type { Source } from './query'

// What's selected and open on screen (not saved with your notes).

export type Pane = 'sidebar' | 'list' | 'editor'
export type SettingsPage = 'general' | 'appearance' | 'editor' | 'sync' | 'import' | 'export' | 'lock' | 'services' | 'shortcuts' | 'updates' | 'feedback' | 'about'

interface UiState {
  source: Source
  /** The open note. */
  noteId: string | null
  /** Extra notes selected in the list (Cmd/Shift-click), including noteId. */
  selected: string[]
  search: string
  searching: boolean
  focus: Pane
  settings: SettingsPage | null
  /** Gallery view: a note opened from the grid. */
  galleryOpen: boolean
  attachmentsBrowser: boolean
  /** A folder being renamed in the sidebar. */
  renaming: string | null
  findOpen: boolean
  /** The open note was closed (⌘W), so the list doesn't open another one by itself. */
  closed: boolean
  /** On a phone: the open note is on screen (else the list). */
  phoneNote: boolean
  close(): void
  select(source: Source): void
  open(id: string | null, extend?: 'toggle' | 'range' | null, list?: string[]): void
}

export const useUi = create<UiState>((set, get) => ({
  source: { kind: 'all' },
  noteId: null,
  selected: [],
  search: '',
  searching: false,
  focus: 'list',
  settings: null,
  galleryOpen: false,
  attachmentsBrowser: false,
  renaming: null,
  findOpen: false,
  closed: false,
  phoneNote: false,
  close() {
    set({ noteId: null, selected: [], galleryOpen: false, findOpen: false, closed: true, phoneNote: false })
  },
  select(source) {
    set({ source, closed: false, galleryOpen: false, attachmentsBrowser: false, search: '', searching: false })
  },
  open(id, extend, list = []) {
    if (!id) return set({ noteId: null, selected: [] })
    if (get().closed) set({ closed: false })
    const { selected, noteId } = get()
    if (extend === 'toggle') {
      const next = selected.includes(id) ? selected.filter((x) => x !== id) : [...selected, id]
      return set({ selected: next, noteId: next.includes(id) ? id : (next[next.length - 1] ?? null) })
    }
    if (extend === 'range' && noteId) {
      const a = list.indexOf(noteId)
      const b = list.indexOf(id)
      if (a >= 0 && b >= 0) return set({ selected: list.slice(Math.min(a, b), Math.max(a, b) + 1), noteId: id })
    }
    set({ noteId: id, selected: [id] })
  }
}))

export const sameSource = (a: Source, b: Source): boolean => JSON.stringify(a) === JSON.stringify(b)
