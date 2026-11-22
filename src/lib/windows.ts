import { desktop } from './storage'
import { exportData, useStore } from './store'
import type { Folder, Note, Settings } from './types'

// The desktop app can have two windows on the same notes: the main one and the floating Quick Note.
// Each keeps its own copy of the data and sends the other what it changed (through desktop/main.cjs).

export interface Patch {
  notes?: Note[]
  removed?: string[]
  folders?: Folder[]
  settings?: Settings
}

type Data = { notes: Note[]; folders: Folder[]; settings: Settings }

/** What changed from one state to the next: notes by reference, folders and settings whole. */
export function diffData(prev: Data, next: Data): Patch | null {
  const out: Patch = {}
  if (next.notes !== prev.notes) {
    const before = new Map(prev.notes.map((n) => [n.id, n]))
    const ids = new Set(next.notes.map((n) => n.id))
    const changed = next.notes.filter((n) => before.get(n.id) !== n)
    const removed = prev.notes.filter((n) => !ids.has(n.id)).map((n) => n.id)
    if (changed.length) out.notes = changed
    if (removed.length) out.removed = removed
  }
  if (next.folders !== prev.folders) out.folders = next.folders
  if (next.settings !== prev.settings) out.settings = next.settings
  return Object.keys(out).length ? out : null
}

export function applyPatch(data: Data, patch: Patch): Partial<Data> {
  let notes = data.notes
  if (patch.removed) {
    const gone = new Set(patch.removed)
    notes = notes.filter((n) => !gone.has(n.id))
  }
  if (patch.notes) {
    const byId = new Map(patch.notes.map((n) => [n.id, n]))
    const known = new Set(notes.map((n) => n.id))
    notes = [...patch.notes.filter((n) => !known.has(n.id)), ...notes.map((n) => byId.get(n.id) ?? n)]
  }
  return { notes, ...(patch.folders ? { folders: patch.folders } : {}), ...(patch.settings ? { settings: patch.settings } : {}) }
}

let applying = false

export function startWindowSync(): void {
  const bridge = desktop?.windows
  if (!bridge) return
  // The floating note starts from the main window's data as it is now (desktop/main.cjs data:load).
  ;(window as unknown as { __notesSnapshot: () => string }).__notesSnapshot = () => JSON.stringify({ ...exportData(), sync: useStore.getState().sync })
  useStore.subscribe((s, p) => {
    if (applying || !s.loaded || !p.loaded) return
    const patch = diffData(p, s)
    if (patch) bridge.send(patch)
  })
  bridge.onPatch((patch) => {
    applying = true
    try {
      useStore.setState(applyPatch(useStore.getState(), patch))
    } finally {
      applying = false
    }
  })
}
