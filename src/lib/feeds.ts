import { create } from 'zustand'
import { usableColour } from './brands'
import { derive } from './content'
import { serviceById, SERVICES } from './services'
import { googleTasksSignIn, googleTasksSignOut } from './services/gtasks'
import { ServiceError } from './services/net'
import type { Credentials } from './services/types'
import { secrets } from './storage'
import { useStore } from './store'
import type { FeedSource, Folder, Note, ServiceId } from './types'
import { useUi } from './ui'

// Smart Folders filled from connected services (Settings → Connected Services: GitHub, Todoist,
// Linear, Jira, Google Tasks; each in src/lib/services/). Each item at the service is a read-only
// note in the folder, with its status when it's a task; a refresh adds new ones, rewrites changed
// ones and takes out ones that are gone. The note's id is made from the folder's and the item's,
// so two devices refreshing the same folder agree and Sync doesn't double them.

const EVERY_MS = 10 * 60_000
/** Where a service's sign-in is kept (storage.ts secrets): JSON, or "google" for Google's own sign-in. */
const KEY = (id: ServiceId) => `${id}-token`

export interface Account {
  login: string
  name?: string
}

interface ServicesState {
  accounts: Partial<Record<ServiceId, Account>>
  /** A saved sign-in the service no longer accepts, by service. */
  errors: Partial<Record<ServiceId, string>>
  /** Checking the saved sign-ins when Notes starts. */
  checking: boolean
  /** Folders being refreshed now. */
  busy: string[]
}

export const useServices = create<ServicesState>(() => ({ accounts: {}, errors: {}, checking: true, busy: [] }))

export const noteIdFor = (folderId: string, itemId: string): string => `ext-${folderId}-${itemId}`

async function credentials(id: ServiceId): Promise<Credentials | null> {
  const raw = await secrets.get(KEY(id))
  if (!raw) return null
  if (raw === 'google') return {}
  try {
    return JSON.parse(raw) as Credentials
  } catch {
    // GitHub's token from before there were other services.
    return { token: raw }
  }
}

const setAccount = (id: ServiceId, account: Account | null, error?: string) =>
  useServices.setState((s) => {
    const accounts = { ...s.accounts }
    if (account) accounts[id] = account
    else delete accounts[id]
    return { accounts, errors: { ...s.errors, [id]: error } }
  })

/** Checks the sign-in with the service, then keeps it on this device. */
export async function connectService(id: ServiceId, cred: Credentials): Promise<void> {
  const service = serviceById(id)
  if (service.connect === 'google') {
    await googleTasksSignIn()
    setAccount(id, await service.account({}))
    await secrets.set(KEY(id), 'google')
  } else {
    const clean = Object.fromEntries(Object.entries(cred).map(([k, v]) => [k, v.trim()]))
    setAccount(id, await service.account(clean))
    await secrets.set(KEY(id), JSON.stringify(clean))
  }
  void refreshFeeds(true)
}

/** Forgets the sign-in on this device. The folders and their notes stay (they stop refreshing). */
export async function disconnectService(id: ServiceId): Promise<void> {
  if (serviceById(id).connect === 'google') await googleTasksSignOut().catch(() => {})
  await secrets.set(KEY(id), null)
  setAccount(id, null)
}

/** The choices for a source's second step (repositories, projects, teams, lists). */
export async function targetOptions(id: ServiceId, kind: string): Promise<Array<[string, string]>> {
  const source = serviceById(id).sources.find((k) => k.kind === kind)
  const cred = await credentials(id)
  if (!source?.target?.options || !cred) return []
  return source.target.options(cred)
}

export function feedLabel(feed: FeedSource): string {
  const service = serviceById(feed.provider)
  const kind = service.sources.find((k) => k.kind === feed.kind)
  const target = feed.targetName ?? feed.target ?? feed.repo
  return `${service.name}: ${kind?.label ?? feed.kind}${kind?.target && target ? ` (${target})` : ''}`
}

export function createFeedFolder(name: string, feed: FeedSource): Folder {
  const s = useStore.getState()
  const service = serviceById(feed.provider)
  const folder = s.createFolder(name)
  s.updateFolder(folder.id, { feed, icon: `brand:${service.id}`, logo: service.logo, color: usableColour(service.color.slice(1)) })
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
  const service = serviceById(folder.feed.provider)
  const cred = await credentials(service.id)
  if (!cred) return patchFeed(folderId, { error: `Connect ${service.name} in Settings → Connected Services to refresh this folder.` })
  useServices.setState((s) => ({ busy: [...s.busy, folderId] }))
  try {
    const { items, complete } = await service.items(cred, folder.feed)
    const store = useStore.getState()
    const dismissed = new Set(folder.feed.dismissed ?? [])
    const seen = new Set<string>()
    const changed: Note[] = []
    const purge: string[] = []
    for (const item of items) {
      const id = noteIdFor(folderId, item.id)
      if (seen.has(id)) continue
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
      changed.push({
        id,
        folderId,
        html: item.html,
        ...derive(item.html),
        name: item.title,
        title: item.title,
        createdAt: item.createdAt || Date.now(),
        updatedAt: Date.parse(item.updatedAt) || Date.now(),
        pinned: old?.pinned ?? false,
        external: { provider: service.id, id: item.id, url: item.url, state: item.state, ref: item.ref, meta: item.meta, updatedAt: item.updatedAt }
      })
    }
    // Gone from the service (or no longer assigned): only when the whole list came back.
    if (complete) for (const n of store.notes) if (n.folderId === folderId && n.external && !n.deletedAt && !seen.has(n.id)) purge.push(n.id)
    store.upsertNotes(changed)
    if (purge.length) store.purgeNotes(purge)
    patchFeed(folderId, { lastSync: Date.now(), error: undefined, dismissed: [...dismissed] })
  } catch (e) {
    patchFeed(folderId, { error: e instanceof ServiceError ? e.message : `Couldn’t refresh: ${(e as Error).message}` })
  } finally {
    useServices.setState((s) => ({ busy: s.busy.filter((x) => x !== folderId) }))
  }
}

/** Refreshes every connected folder (unless it was refreshed in the last few minutes). */
export async function refreshFeeds(force = false): Promise<void> {
  const accounts = useServices.getState().accounts
  const due = useStore.getState().folders.filter((f) => f.feed && accounts[f.feed.provider] && (force || !f.feed.lastSync || Date.now() - f.feed.lastSync > 2 * 60_000))
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

/** Checks the saved sign-ins, then keeps the folders fresh while Notes runs. */
export async function startFeeds(): Promise<void> {
  await Promise.all(
    SERVICES.map(async (service) => {
      const cred = await credentials(service.id)
      if (!cred) return
      try {
        setAccount(service.id, await service.account(cred))
      } catch (e) {
        setAccount(service.id, null, (e as Error).message)
      }
    })
  )
  useServices.setState({ checking: false })
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
