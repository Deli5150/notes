import { create } from 'zustand'
import { derive } from './content'
import { GITHUB_LOGO, GitHubError, githubIssues, githubUser, type GitHubUser } from './services/github'
import { secrets } from './storage'
import { useStore } from './store'
import { useUi } from './ui'
import type { FeedSource, Folder, Note } from './types'

// Smart Folders filled from connected services (Settings → Connected Services). Each item at the
// service (a GitHub issue) is a read-only note in the folder, with its status when it's a task; a
// refresh adds new ones, rewrites changed ones and takes out ones that are gone. The note's id is
// made from the folder's and the item's, so two devices refreshing the same folder agree and Sync
// doesn't double them.

const TOKEN = 'github-token'
const EVERY_MS = 10 * 60_000

interface ServicesState {
  github: GitHubUser | null
  /** Checking the saved token when Notes starts. */
  checking: boolean
  error?: string
  /** Folders being refreshed now. */
  busy: string[]
}

export const useServices = create<ServicesState>(() => ({ github: null, checking: true, busy: [] }))

export const noteIdFor = (folderId: string, itemId: string): string => `ext-${folderId}-${itemId}`

/** Saves the token if GitHub accepts it. */
export async function connectGitHub(token: string): Promise<void> {
  const user = await githubUser(token.trim())
  await secrets.set(TOKEN, token.trim())
  useServices.setState({ github: user, error: undefined })
  void refreshFeeds(true)
}

/** Forgets the token on this device. The folders and their notes stay (they stop refreshing). */
export async function disconnectGitHub(): Promise<void> {
  await secrets.set(TOKEN, null)
  useServices.setState({ github: null })
}

export function githubSourceLabel(feed: FeedSource): string {
  if (feed.kind === 'assigned') return 'Issues assigned to you'
  if (feed.kind === 'created') return 'Issues you opened'
  return `Issues in ${feed.repo}`
}

export function createFeedFolder(name: string, feed: FeedSource): Folder {
  const s = useStore.getState()
  const folder = s.createFolder(name)
  s.updateFolder(folder.id, { feed, icon: 'brand:github', logo: GITHUB_LOGO })
  void refreshFeed(folder.id)
  return folder
}

const patchFeed = (id: string, patch: Partial<FeedSource>) => {
  const f = useStore.getState().folders.find((x) => x.id === id)
  if (f?.feed) useStore.getState().updateFolder(id, { feed: { ...f.feed, ...patch } })
}

export async function refreshFeed(folderId: string): Promise<void> {
  const folder = useStore.getState().folders.find((f) => f.id === folderId)
  if (!folder?.feed || useServices.getState().busy.includes(folderId)) return
  const token = await secrets.get(TOKEN)
  if (!token) return patchFeed(folderId, { error: 'Connect GitHub in Settings → Connected Services to refresh this folder.' })
  useServices.setState((s) => ({ busy: [...s.busy, folderId] }))
  try {
    const { items, complete } = await githubIssues(token, folder.feed)
    const store = useStore.getState()
    const dismissed = new Set(folder.feed.dismissed ?? [])
    const seen = new Set<string>()
    const changed: Note[] = []
    const purge: string[] = []
    for (const item of items) {
      const id = noteIdFor(folderId, item.id)
      seen.add(id)
      // Cleared while completed: stays away unless it's reopened, then it's back (out of Recently Deleted).
      let reopened = false
      if (dismissed.has(item.id)) {
        if (item.state !== 'open') {
          if (store.notes.some((n) => n.id === id && !n.deletedAt)) purge.push(id)
          continue
        }
        dismissed.delete(item.id)
        reopened = true
      }
      const old = store.notes.find((n) => n.id === id)
      // Deleted by hand: left alone.
      if (old?.deletedAt && !reopened) continue
      if (old && !old.deletedAt && old.external?.updatedAt === item.updatedAt && old.folderId === folderId) continue
      const d = derive(item.html)
      changed.push({
        id,
        folderId,
        html: item.html,
        ...d,
        name: item.title,
        title: item.title,
        createdAt: item.createdAt,
        updatedAt: Date.parse(item.updatedAt) || Date.now(),
        pinned: old?.pinned ?? false,
        external: { provider: 'github', id: item.id, url: item.url, state: item.state, ref: item.ref, meta: item.meta, updatedAt: item.updatedAt }
      })
    }
    // Gone from GitHub (or no longer assigned): only when the whole list came back.
    if (complete) for (const n of store.notes) if (n.folderId === folderId && n.external && !n.deletedAt && !seen.has(n.id)) purge.push(n.id)
    store.upsertNotes(changed)
    if (purge.length) store.purgeNotes(purge)
    patchFeed(folderId, { lastSync: Date.now(), error: undefined, dismissed: [...dismissed] })
  } catch (e) {
    patchFeed(folderId, { error: e instanceof GitHubError ? e.message : `Couldn’t refresh: ${(e as Error).message}` })
  } finally {
    useServices.setState((s) => ({ busy: s.busy.filter((x) => x !== folderId) }))
  }
}

/** Refreshes every connected folder (unless it was refreshed in the last few minutes). */
export async function refreshFeeds(force = false): Promise<void> {
  if (!useServices.getState().github) return
  const due = useStore.getState().folders.filter((f) => f.feed && (force || !f.feed.lastSync || Date.now() - f.feed.lastSync > 2 * 60_000))
  for (const f of due) await refreshFeed(f.id)
}

/** The folder's completed tasks (done or closed) go to Recently Deleted and don't come back. */
export function clearCompleted(folderId: string): number {
  const s = useStore.getState()
  const done = s.notes.filter((n) => n.folderId === folderId && !n.deletedAt && n.external?.state && n.external.state !== 'open')
  if (!done.length) return 0
  const folder = s.folders.find((f) => f.id === folderId)
  if (folder?.feed) patchFeed(folderId, { dismissed: [...new Set([...(folder.feed.dismissed ?? []), ...done.map((n) => n.external!.id)])] })
  s.deleteNotes(done.map((n) => n.id))
  return done.length
}

/** Checks the saved token, then keeps the folders fresh while Notes runs. */
export async function startFeeds(): Promise<void> {
  const token = await secrets.get(TOKEN)
  if (!token) return useServices.setState({ checking: false })
  try {
    useServices.setState({ github: await githubUser(token), checking: false })
  } catch (e) {
    useServices.setState({ checking: false, error: (e as Error).message })
    return
  }
  void refreshFeeds()
  setInterval(() => void refreshFeeds(), EVERY_MS)
  addEventListener('focus', () => void refreshFeeds())
  // Opening a connected folder refreshes it, unless it just was.
  useUi.subscribe((s, prev) => {
    const src = s.source
    if (src === prev.source || src.kind !== 'folder') return
    const f = useStore.getState().folders.find((x) => x.id === src.id)
    if (f?.feed && (!f.feed.lastSync || Date.now() - f.feed.lastSync > 2 * 60_000)) void refreshFeed(f.id)
  })
}
