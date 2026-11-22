import { create } from 'zustand'
import { App as CapApp } from '@capacitor/app'
import { VERSION } from '../version'
import { androidUpdater } from './android'
import { LATEST_RELEASE_API, newerRelease, RELEASES_PAGE, type GitHubRelease, type ReleaseInfo, type UpdateStatus } from './release'
import { desktop, isAndroid, openExternal } from './storage'
import { useStore } from './store'

// The in-app updater, from the GitHub repo's Releases. The desktop app does the work in its main
// process (desktop/updater.cjs: checks, downloads with a checksum, swaps the app and reopens it)
// and reports here. The Android app checks here itself, downloads the new APK (NotesNativePlugin)
// and opens Android's installer on it: same signing key, so it installs over Notes and keeps
// everything.

export const useUpdate = create<UpdateStatus>(() => ({ current: VERSION, state: 'idle', inApp: Boolean(desktop) || isAndroid }))

const APK = /^Notes-\d+\.\d+\.\d+\.apk$/
const CHECK_EVERY_MS = 6 * 60 * 60_000
let release: ReleaseInfo | null = null
let downloaded: string | null = null
let lastAuto = 0

const set = (patch: Partial<UpdateStatus>) => useUpdate.setState(patch)

async function checkAndroid(quiet: boolean): Promise<void> {
  if (['checking', 'downloading', 'installing'].includes(useUpdate.getState().state)) return
  set({ state: 'checking', error: undefined })
  try {
    const res = await fetch(LATEST_RELEASE_API, { headers: { Accept: 'application/vnd.github+json' } })
    if (res.status === 404) return set({ state: 'latest', lastCheck: Date.now() })
    if (!res.ok) throw new Error(`GitHub answered ${res.status}`)
    const found = newerRelease((await res.json()) as GitHubRelease, VERSION, APK)
    if (!found) return set({ state: 'latest', version: undefined, lastCheck: Date.now() })
    if (found.version !== release?.version) downloaded = null
    release = found
    set({ state: downloaded ? 'ready' : 'available', version: found.version, notes: found.notes, page: found.page, inApp: Boolean(found.asset), lastCheck: Date.now() })
  } catch (e) {
    if (quiet) set({ state: release ? 'available' : 'idle' })
    else set({ state: 'error', error: `Couldn’t check for updates: ${(e as Error).message}` })
  }
}

async function downloadAndroid(): Promise<void> {
  if (!release?.asset || !androidUpdater) return openExternal(release?.page ?? RELEASES_PAGE)
  if (useUpdate.getState().state === 'downloading') return
  set({ state: 'downloading', progress: 0, error: undefined })
  const listener = await androidUpdater.addListener('updateProgress', ({ progress }) => set({ progress }))
  try {
    const { path } = await androidUpdater.downloadUpdate({ url: release.asset.url, name: release.asset.name, sha256: release.asset.sha256 })
    downloaded = path
    set({ state: 'ready', progress: 1 })
  } catch (e) {
    set({ state: 'error', error: `Couldn’t download the update: ${(e as Error).message}` })
  } finally {
    void listener.remove()
  }
}

/** Android's installer on the APK; the first time, the "Install unknown apps" switch for Notes instead. */
async function installAndroid(): Promise<void> {
  if (!downloaded || !androidUpdater) return
  const r = await androidUpdater.installUpdate({ path: downloaded })
  if (r.missing) {
    downloaded = null
    set({ state: 'available', error: 'The downloaded update is gone. Tap Update to download it again.' })
  } else if (r.needsPermission) set({ error: 'Allow “Install unknown apps” for Notes, then come back and tap Install.' })
  else set({ error: undefined })
}

export async function checkForUpdates(quiet = false): Promise<void> {
  if (desktop) return desktop.updater.check(quiet)
  if (isAndroid) return checkAndroid(quiet)
}

/** Android: one tap downloads the APK (progress on the button) and then opens the installer. */
export async function downloadUpdate(): Promise<void> {
  if (desktop) return desktop.updater.download()
  if (isAndroid) {
    await downloadAndroid()
    if (useUpdate.getState().state === 'ready') await installAndroid()
    return
  }
  openExternal(useUpdate.getState().page ?? RELEASES_PAGE)
}

export async function installUpdate(): Promise<void> {
  if (desktop) return desktop.updater.install()
  if (isAndroid) return installAndroid()
}

/** Android: checks when Notes starts and comes back to the front, at most every few hours. */
function autoCheck(): void {
  if (!useStore.getState().settings.checkUpdates || Date.now() - lastAuto < CHECK_EVERY_MS) return
  lastAuto = Date.now()
  void checkForUpdates(true)
}

/** Follows the desktop app's updater (it checks on its own schedule), or runs Android's. */
export function startUpdater(): void {
  if (isAndroid) {
    // After the notes load, so the "Check for updates" setting is known.
    const off = useStore.subscribe((s) => {
      if (!s.loaded) return
      off()
      autoCheck()
    })
    void CapApp.addListener('appStateChange', ({ isActive }) => isActive && autoCheck())
    return
  }
  if (!desktop) return
  void desktop.updater.status().then((s) => useUpdate.setState(s))
  desktop.updater.onChange((s) => useUpdate.setState(s))
}
