import { App as CapApp } from '@capacitor/app'
import { create } from 'zustand'
import { driveFile } from './drive'
import { googleAvailable, googleFetch, googleFetchBytes, googleSignIn, googleSignOut, SignedOutError } from './google'
import { attachmentStore, isAndroid } from './storage'
import { applySynced, onLocalChange, useStore } from './store'
import { emptyMeta, merge, rememberUpload } from './sync'
import type { Note } from './types'

// Runs Sync with Google: at once when a note or folder is created, deleted, moved or pinned; within
// a moment of a pause in typing (and at least every few seconds while you keep typing); when the app
// opens, comes back or goes to the background; whenever another device has synced (a cheap check of
// the file's version every few seconds while the app is showing, and right after each sync for a
// little while, when the other device is most likely to answer); and every few minutes regardless. One sync = download the file, merge, apply here, upload if changed, then
// copy attachments the other side is missing.

const drive = driveFile(googleFetch, googleFetchBytes)
const EVERY_MS = 5 * 60_000
/** After a change: wait this long for a pause in typing, but never longer than MAX_WAIT_MS. */
const QUIET_MS = 700
const MAX_WAIT_MS = 3000
/** While the app is showing: how often to check whether another device has synced. */
const CHECK_MS = 4000
/** For this long after a change on either side, check every FAST_CHECK_MS instead. */
const FAST_FOR_MS = 60_000
const FAST_CHECK_MS = 2000

export const useSyncState = create<{ busy: boolean; progress?: string; conflicts: number }>(() => ({ busy: false, conflicts: 0 }))

let running: Promise<void> | null = null
let again = false

export function syncNow(): Promise<void> {
  if (!useStore.getState().sync.enabled) return Promise.resolve()
  if (running) {
    again = true
    return running
  }
  running = (async () => {
    useSyncState.setState({ busy: true })
    try {
      do {
        again = false
        await syncOnce()
      } while (again)
    } finally {
      useSyncState.setState({ busy: false, progress: undefined })
      running = null
    }
  })()
  return running
}

/** Every attachment any note (or a locked note's sealed list) uses. */
function usedAttachments(notes: Note[]): Set<string> {
  const ids = new Set<string>()
  for (const n of notes) for (const a of n.attachments) ids.add(a)
  return ids
}

async function syncAttachments(): Promise<void> {
  const used = usedAttachments(useStore.getState().notes)
  if (!used.size) return
  const local = new Set(await attachmentStore.list())
  // Missing here: look in Drive again, as another device may have added it since the last look.
  const remote = await drive.attachments([...used].some((id) => !local.has(id)))
  const up = [...used].filter((id) => local.has(id) && !remote.has(id))
  const down = [...used].filter((id) => !local.has(id) && remote.has(id))
  let done = 0
  const total = up.length + down.length
  for (const id of up) {
    useSyncState.setState({ progress: `Uploading attachments… ${++done} of ${total}` })
    const data = await attachmentStore.get(id)
    if (data) await drive.putAttachment(id, data)
  }
  for (const id of down) {
    useSyncState.setState({ progress: `Downloading attachments… ${++done} of ${total}` })
    const data = await drive.getAttachment(id)
    if (data) await attachmentStore.put(id, data)
  }
  if (down.length) window.dispatchEvent(new CustomEvent('notes:attachments'))
}

async function syncOnce(): Promise<void> {
  try {
    const remote = await drive.download()
    const s = useStore.getState()
    const result = merge({ folders: s.folders, notes: s.notes, settings: s.settings }, s.sync, remote)
    if (result.changedRemote) await drive.upload(result.doc)
    const latest = useStore.getState()
    // Changed here meanwhile: merge again rather than overwrite that change.
    if (latest.sync.at !== s.sync.at || latest.sync.removed !== s.sync.removed) {
      // What was just uploaded is this device's own: note it, or the next pass takes it for
      // another device's edit and keeps a conflict copy.
      if (result.changedRemote) applySynced({ sync: rememberUpload(latest.sync, result.meta) })
      again = true
      return
    }
    applySynced({ ...(result.changedLocal ? result.data : {}), sync: { ...result.meta, enabled: latest.sync.enabled, email: latest.sync.email } })
    if (result.conflicts) useSyncState.setState((st) => ({ conflicts: st.conflicts + result.conflicts }))
    seenVersion = await drive.version().catch(() => seenVersion)
    await syncAttachments()
  } catch (e) {
    const signedOut = e instanceof SignedOutError
    applySynced({ sync: { ...useStore.getState().sync, error: signedOut ? 'Signed out of Google. Turn Sync on again to reconnect.' : (e as Error).message } })
  }
}

/** The sync file's version when this device last synced; another device's sync changes it. */
let seenVersion: string | null = null

/** Syncs if another device has synced since this one did. */
let lastActivity = 0
let lastCheck = 0
async function checkRemote(): Promise<void> {
  if (running || !useStore.getState().sync.enabled || document.visibilityState !== 'visible') return
  const now = Date.now()
  if (now - lastCheck < (now - lastActivity < FAST_FOR_MS ? FAST_CHECK_MS : CHECK_MS) - 250) return
  lastCheck = now
  const v = await drive.version().catch(() => null)
  if (v && v !== seenVersion) {
    lastActivity = Date.now()
    void syncNow()
  }
}

let timer: ReturnType<typeof setTimeout> | null = null
let firstChange = 0
let started = false

/** Starts syncing in the background (call once the store has loaded). */
export function startSync(): void {
  if (started) return
  started = true
  onLocalChange((structural) => {
    if (timer) clearTimeout(timer)
    lastActivity = Date.now()
    firstChange ||= Date.now()
    // Creating, deleting or moving something goes up at once (a short beat lets a burst, like
    // deleting several notes, go in one sync); typing waits for a pause.
    const wait = structural ? 150 : Math.max(0, Math.min(QUIET_MS, firstChange + MAX_WAIT_MS - Date.now()))
    timer = setTimeout(() => {
      timer = null
      firstChange = 0
      void syncNow()
    }, wait)
  })
  setInterval(() => void syncNow(), EVERY_MS)
  setInterval(() => void checkRemote(), FAST_CHECK_MS)
  window.addEventListener('focus', () => void syncNow())
  document.addEventListener('visibilitychange', () => document.visibilityState === 'visible' && void checkRemote())
  // Leaving the app (Android pauses it soon after): send what's waiting now.
  const leaving = () => {
    if (!timer) return
    clearTimeout(timer)
    timer = null
    firstChange = 0
    void syncNow()
  }
  document.addEventListener('visibilitychange', () => document.visibilityState === 'hidden' && leaving())
  // Android doesn't always tell the page it went to the background or came back.
  if (isAndroid) void CapApp.addListener('appStateChange', ({ isActive }) => (isActive ? void syncNow() : leaving()))
  void syncNow()
}

export async function turnOnSync(): Promise<void> {
  if (!googleAvailable()) throw new Error('Sync isn’t set up in this copy of Notes (it needs a Google OAuth client; see README → Sync with Google).')
  const email = await googleSignIn()
  drive.reset()
  applySynced({ sync: { ...useStore.getState().sync, enabled: true, email: email ?? (await drive.email()), error: undefined } })
  await syncNow()
}

export async function turnOffSync(): Promise<void> {
  const meta = useStore.getState().sync
  applySynced({ sync: { ...emptyMeta(), at: meta.at, removed: meta.removed } })
  drive.reset()
  await googleSignOut()
}
