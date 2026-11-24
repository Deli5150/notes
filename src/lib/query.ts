import { folderTree } from './store'
import { QUICK_NOTES, type DateRange, type Folder, type Note, type Settings, type SmartFilter, type SortBy } from './types'

// Which notes the middle column shows: a folder (a pinned folder shows its subfolders' notes too —
// its "All of …" chip), All Notes, a Smart Folder, tags, Recently Deleted, or search results.

export type Source = { kind: 'all' } | { kind: 'folder'; id: string } | { kind: 'tags'; tags: string[] } | { kind: 'trash' }

const DAY = 86_400_000

function inRange(t: number, r: DateRange | undefined, now: number): boolean {
  if (!r) return true
  if (r.lastDays) return t >= now - r.lastDays * DAY
  if (r.from && t < r.from) return false
  if (r.to && t > r.to + DAY - 1) return false
  return true
}

/** Whether a note matches a Smart Folder's conditions. */
export function matchesSmart(n: Note, f: SmartFilter, folders: Folder[], now = Date.now(), html = n.html): boolean {
  const checks: boolean[] = []
  if (f.tags.length) {
    const has = f.tags.map((t) => n.tags.some((x) => x.toLowerCase() === t.toLowerCase()))
    checks.push(f.tagMode === 'all' ? has.every(Boolean) : f.tagMode === 'none' ? !has.some(Boolean) : has.some(Boolean))
  }
  if (f.created) checks.push(inRange(n.createdAt, f.created, now))
  if (f.edited) checks.push(inRange(n.updatedAt, f.edited, now))
  if (f.checklists) {
    if (f.checklists === 'any') checks.push(n.hasChecklist)
    else if (f.checklists === 'checked') checks.push(n.hasChecklist && html.includes('data-checked="true"'))
    else checks.push(n.hasChecklist && html.includes('data-checked="false"'))
  }
  if (f.attachments !== undefined) checks.push(n.attachments.length > 0 === f.attachments)
  if (f.locked !== undefined) checks.push(Boolean(n.locked) === f.locked)
  if (f.pinned !== undefined) checks.push(n.pinned === f.pinned)
  if (f.quickNotes !== undefined) checks.push(n.folderId === QUICK_NOTES === f.quickNotes)
  if (f.folders?.length) {
    const ids = new Set(f.folders.flatMap((id) => folderTree(folders, id)))
    checks.push(ids.has(n.folderId))
  }
  if (!checks.length) return true
  return f.match === 'any' ? checks.some(Boolean) : checks.every(Boolean)
}

export function sortNotes(notes: Note[], by: SortBy, dir: 'asc' | 'desc'): Note[] {
  const sign = dir === 'asc' ? 1 : -1
  const key = (n: Note) => (by === 'created' ? n.createdAt : n.updatedAt)
  return [...notes].sort((a, b) => {
    if (by === 'title') return sign * -1 * (a.title || 'New Note').localeCompare(b.title || 'New Note', undefined, { numeric: true, sensitivity: 'base' })
    return sign * (key(a) - key(b))
  })
}

export function notesFor(source: Source, notes: Note[], folders: Folder[], now = Date.now()): Note[] {
  if (source.kind === 'trash') return notes.filter((n) => n.deletedAt)
  const live = notes.filter((n) => !n.deletedAt)
  if (source.kind === 'all') return live
  if (source.kind === 'tags') {
    const want = source.tags.map((t) => t.toLowerCase())
    // All Tags: every note with a tag.
    if (!want.length) return live.filter((n) => n.tags.length > 0)
    return live.filter((n) => want.every((t) => n.tags.some((x) => x.toLowerCase() === t)))
  }
  const folder = folders.find((f) => f.id === source.id)
  if (folder?.smart) return live.filter((n) => matchesSmart(n, folder.smart!, folders, now))
  const tree = new Set(folderTree(folders, source.id))
  if (tree.size === 1) return live.filter((n) => n.folderId === source.id)
  // A service's pinned folder: an item in two of its subfolders (assigned to you, and in a repo) shows once.
  const seen = new Set<string>()
  return live.filter((n) => {
    if (!tree.has(n.folderId)) return false
    if (!n.external) return true
    const key = `${n.external.provider}:${n.external.id}`
    return !seen.has(key) && Boolean(seen.add(key))
  })
}

export interface SearchHit {
  note: Note
  /** Where the words were found, for the list's preview. */
  excerpt?: string
}

/** Searches titles and text; every word must appear. */
export function searchNotes(notes: Note[], query: string, unlockedText: Record<string, { text: string }> = {}): SearchHit[] {
  const words = query.toLowerCase().split(/\s+/).filter(Boolean)
  if (!words.length) return notes.map((note) => ({ note }))
  const hits: SearchHit[] = []
  for (const note of notes) {
    const text = note.locked ? (unlockedText[note.id]?.text ?? '') : note.text
    const hay = `${note.title}\n${text}`.toLowerCase()
    if (!words.every((w) => hay.includes(w))) continue
    const i = text.toLowerCase().indexOf(words[0])
    const excerpt = i >= 0 ? `${i > 30 ? '…' : ''}${text.slice(Math.max(0, i - 30), i + 90).replace(/\s+/g, ' ')}` : undefined
    hits.push({ note, excerpt })
  }
  return hits
}

export function sortFor(source: Source, folders: Folder[], settings: Settings): SortBy {
  if (source.kind === 'folder') return folders.find((f) => f.id === source.id)?.sort ?? settings.sortBy
  return settings.sortBy
}

/** Every tag with how many notes use it, most used first. */
export function allTags(notes: Note[]): Array<{ tag: string; count: number }> {
  const counts = new Map<string, { tag: string; count: number }>()
  for (const n of notes) {
    if (n.deletedAt) continue
    for (const t of n.tags) {
      const k = t.toLowerCase()
      const e = counts.get(k)
      if (e) e.count++
      else counts.set(k, { tag: t, count: 1 })
    }
  }
  return [...counts.values()].sort((a, b) => a.tag.localeCompare(b.tag))
}
