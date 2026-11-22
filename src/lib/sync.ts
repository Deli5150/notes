import type { AppData, Settings } from './types'

// "Sync with Google": Notes' data kept in one JSON file in the user's own Google Drive app folder
// (scope drive.appdata, a hidden folder only Notes can read), shared by every device; attachments
// are files of their own in the same folder. Each folder, each note and each synced setting is an
// entry with the time it last changed; the newest wins, and deletions are remembered (with their
// time) so a delete on one device reaches the others. A note changed on two devices between syncs
// keeps both versions: the older one becomes a copy, so nothing typed is lost.

export const SYNC_FILE = 'notes-sync.json'

/** Settings that follow you between devices (the rest, like pane widths, are per device). */
export const SYNCED_SETTINGS = ['theme', 'appearance', 'sortBy', 'sortDir', 'groupByDate', 'startWith', 'sortChecked', 'paper', 'mathResults', 'fontFamily', 'fontSize', 'lineHeight', 'tags', 'lock', 'lockHistory'] as const satisfies ReadonlyArray<keyof Settings>

const COLLECTIONS = ['folders', 'notes'] as const
type Collection = (typeof COLLECTIONS)[number]

export interface SyncEntry {
  at: number
  value: unknown
}

export interface SyncDoc {
  version: 1
  updatedAt: number
  entries: Record<string, SyncEntry>
  /** Entry key → when it was deleted. */
  removed: Record<string, number>
}

/** Per-device bookkeeping, saved with the data. */
export interface SyncMeta {
  enabled: boolean
  email?: string
  /** Entry key → when it last changed on this device (missing = never: the cloud's copy wins). */
  at: Record<string, number>
  /** Entry key → its time at the last sync (to tell a conflict from a plain update). */
  base: Record<string, number>
  removed: Record<string, number>
  lastSync: number
  error?: string
}

export const emptyMeta = (): SyncMeta => ({ enabled: false, at: {}, base: {}, removed: {}, lastSync: 0 })
export const emptyDoc = (): SyncDoc => ({ version: 1, updatedAt: 0, entries: {}, removed: {} })

type Synced = Pick<AppData, Collection | 'settings'>

/** Every entry of this device's data: "folders:<id>", "notes:<id>", "settings:<field>". */
export function entriesOf(data: Synced): Record<string, unknown> {
  const out: Record<string, unknown> = {}
  for (const c of COLLECTIONS) for (const item of data[c] as Array<{ id: string }>) out[`${c}:${item.id}`] = item
  for (const k of SYNCED_SETTINGS) if (data.settings[k] !== undefined) out[`settings:${k}`] = data.settings[k]
  return out
}

const same = (a: unknown, b: unknown): boolean => JSON.stringify(a) === JSON.stringify(b)

/**
 * Stamps what changed between two versions of the data with `now` (and deletions as removed), so
 * the next sync knows this device's copy is newer.
 */
export function stampChanges(prev: Synced, next: Synced, meta: SyncMeta, now = Date.now()): SyncMeta | null {
  if (prev.folders === next.folders && prev.notes === next.notes && prev.settings === next.settings) return null
  const a = entriesOf(prev)
  const b = entriesOf(next)
  let at: Record<string, number> | null = null
  let removed: Record<string, number> | null = null
  for (const [k, v] of Object.entries(b)) {
    if (k in a && (a[k] === v || same(a[k], v))) continue
    at ??= { ...meta.at }
    at[k] = now
    if (meta.removed[k]) {
      removed ??= { ...meta.removed }
      delete removed[k]
    }
  }
  for (const k of Object.keys(a)) {
    if (k in b) continue
    removed ??= { ...meta.removed }
    removed[k] = now
  }
  return at || removed ? { ...meta, at: at ?? meta.at, removed: removed ?? meta.removed } : null
}

const TOMBSTONE_DAYS = 180

interface NoteLike {
  id: string
  html: string
  title: string
  locked?: unknown
  updatedAt: number
}

/** Merges this device's data with the cloud's: the newest change to each entry wins. */
export function merge(
  local: Synced,
  meta: SyncMeta,
  remote: SyncDoc,
  now = Date.now(),
  newId: () => string = () => `${now.toString(36)}${Math.random().toString(36).slice(2, 8)}`
): { data: Synced; meta: SyncMeta; doc: SyncDoc; changedLocal: boolean; changedRemote: boolean; conflicts: number } {
  const mine = entriesOf(local)
  const keys = new Set([...Object.keys(mine), ...Object.keys(remote.entries), ...Object.keys(meta.removed), ...Object.keys(remote.removed)])
  const entries: Record<string, SyncEntry> = {}
  const removed: Record<string, number> = {}
  const cutoff = now - TOMBSTONE_DAYS * 86_400_000
  let conflicts = 0
  for (const k of keys) {
    const localAt = k in mine ? (meta.at[k] ?? 0) : -1
    const remoteAt = remote.entries[k]?.at ?? -1
    const goneAt = Math.max(meta.removed[k] ?? -1, remote.removed[k] ?? -1)
    const liveAt = Math.max(localAt, remoteAt)
    if (goneAt >= 0 && goneAt >= liveAt) {
      if (goneAt > cutoff) removed[k] = goneAt
      continue
    }
    if (liveAt < 0) continue
    // Ties go to this device's copy.
    entries[k] = localAt >= remoteAt ? { at: localAt, value: mine[k] } : remote.entries[k]

    // Both sides changed the same note's text since the last sync: keep the losing side as a copy.
    const base = meta.base[k] ?? 0
    if (k.startsWith('notes:') && localAt > base && remoteAt > base && localAt >= 0 && remoteAt >= 0 && base > 0) {
      const a = mine[k] as NoteLike
      const b = remote.entries[k].value as NoteLike
      if (a && b && a.html !== b.html && !a.locked && !b.locked) {
        const loser = localAt >= remoteAt ? b : a
        const id = newId()
        entries[`notes:${id}`] = { at: now, value: { ...loser, id, title: `${loser.title || 'New Note'} (conflict copy)`, pinned: false } }
        conflicts++
      }
    }
  }

  // Rebuild the collections, keeping this device's order and adding new items at the end.
  const data: Synced = { ...local, settings: { ...local.settings } }
  let changedLocal = false
  for (const c of COLLECTIONS) {
    const list: Array<{ id: string }> = []
    const kept = new Set<string>()
    for (const item of local[c] as Array<{ id: string }>) {
      const k = `${c}:${item.id}`
      const e = entries[k]
      if (e) {
        list.push(e.value as { id: string })
        kept.add(k)
      }
    }
    for (const [k, e] of Object.entries(entries)) {
      if (k.startsWith(`${c}:`) && !kept.has(k)) list.push(e.value as { id: string })
    }
    if (!same(list, local[c])) changedLocal = true
    ;(data as Record<string, unknown>)[c] = list
  }
  for (const s of SYNCED_SETTINGS) {
    const e = entries[`settings:${s}`]
    if (e && !same(e.value, local.settings[s])) {
      ;(data.settings as unknown as Record<string, unknown>)[s] = e.value
      changedLocal = true
    }
  }

  const doc: SyncDoc = { version: 1, updatedAt: now, entries, removed }
  const changedRemote = !same(entries, remote.entries) || !same(removed, remote.removed)
  const times = Object.fromEntries(Object.entries(entries).map(([k, e]) => [k, e.at]))
  const newMeta: SyncMeta = { ...meta, at: times, base: { ...times }, removed, lastSync: now, error: undefined }
  return { data, meta: newMeta, doc, changedLocal, changedRemote, conflicts }
}
