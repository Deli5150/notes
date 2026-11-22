import { create } from 'zustand'
import { VERSION } from '../version'
import { RELEASES_PAGE, type UpdateStatus } from './release'
import { desktop, openExternal } from './storage'

// The in-app updater, from the GitHub repo's Releases. The desktop app does the work in its main
// process (desktop/updater.cjs: checks, downloads with a checksum, swaps the app and reopens it)
// and reports here.

export const useUpdate = create<UpdateStatus>(() => ({ current: VERSION, state: 'idle', inApp: Boolean(desktop) }))

export async function checkForUpdates(quiet = false): Promise<void> {
  if (desktop) return desktop.updater.check(quiet)
}

export async function downloadUpdate(): Promise<void> {
  if (desktop) return desktop.updater.download()
  openExternal(useUpdate.getState().page ?? RELEASES_PAGE)
}

export async function installUpdate(): Promise<void> {
  if (desktop) return desktop.updater.install()
}

/** Follows the desktop app's updater (it checks on its own schedule). */
export function startUpdater(): void {
  if (!desktop) return
  void desktop.updater.status().then((s) => useUpdate.setState(s))
  desktop.updater.onChange((s) => useUpdate.setState(s))
}
