import { ChevronLeft, ChevronRight } from 'lucide-react'
import { useEffect, useState } from 'react'
import { create } from 'zustand'
import { marked } from 'marked'
import { isAndroid } from '../lib/storage'
import { useUi } from '../lib/ui'
import { downloadUpdate, installUpdate, useUpdate } from '../lib/updater'

// The "Update available" sheet (the same design as the user's other apps: app icon, NEW RELEASE,
// old → new, Release Notes, Update, Later / Skip this version). It opens by itself when an
// automatic check finds a new version (once per launch, never for a skipped one).

const SKIP = 'notes:skippedVersion'
const LATER = 'notes:laterUntil'

export const useUpdateSheet = create<{ open: boolean; notes: boolean }>(() => ({ open: false, notes: false }))
export const openUpdateSheet = (): void => useUpdateSheet.setState({ open: true, notes: false })

let shownFor: string | null = null

export function UpdateSheet() {
  const u = useUpdate()
  const { open, notes } = useUpdateSheet()
  const [, rerender] = useState(0)

  useEffect(() => {
    if (u.state !== 'available' || !u.version || shownFor === u.version) return
    if (localStorage.getItem(SKIP) === u.version) return
    const later = JSON.parse(localStorage.getItem(LATER) ?? 'null') as { v: string; until: number } | null
    if (later?.v === u.version && later.until > Date.now()) return
    shownFor = u.version
    useUpdateSheet.setState({ open: true, notes: false })
  }, [u.state, u.version])

  useEffect(() => {
    if (!open) return
    const key = (e: KeyboardEvent) => e.key === 'Escape' && useUpdateSheet.setState({ open: false })
    addEventListener('keydown', key)
    return () => removeEventListener('keydown', key)
  }, [open])

  if (!open || !u.version || !['available', 'downloading', 'ready', 'installing', 'error'].includes(u.state)) return null
  const close = () => useUpdateSheet.setState({ open: false })
  const busy = u.state === 'downloading' || u.state === 'installing'

  return (
    <div className="update-sheet" role="dialog" aria-label="Update available">
      {notes ? (
        <>
          <div className="update-notes-head">
            <button className="tb-btn" onClick={() => useUpdateSheet.setState({ notes: false })} title="Back">
              <ChevronLeft size={18} />
            </button>
            <div className="update-notes-title">What’s New in Delta Notes {u.version}</div>
          </div>
          <div className="update-notes release-notes" dangerouslySetInnerHTML={{ __html: marked.parse(u.notes || 'No release notes.', { async: false }) as string }} />
        </>
      ) : (
        <>
          <div className="update-handle" />
          <img className="update-icon" src="./icon.png" alt="" />
          <div className="update-pill">NEW RELEASE</div>
          <div className="update-title">Update available</div>
          <div className="update-sub">See what’s new and get the latest version of Delta Notes.</div>
          <div className="update-versions">
            {u.current} → <strong>{u.version}</strong>
          </div>
          <button className="update-notes-link" onClick={() => useUpdateSheet.setState({ notes: true })}>
            Release Notes <ChevronRight size={14} />
          </button>
          {u.error && <div className="set-error">{u.error}</div>}
          <button
            className="update-btn"
            disabled={busy}
            onClick={() => {
              if (u.state === 'ready') void installUpdate()
              else void downloadUpdate()
              rerender((n) => n + 1)
            }}
          >
            {u.state === 'downloading' ? (
              <>
                <span className="update-progress" style={{ width: `${Math.round((u.progress ?? 0) * 100)}%` }} />
                <span>Downloading… {Math.round((u.progress ?? 0) * 100)}%</span>
              </>
            ) : u.state === 'ready' ? (
              isAndroid ? 'Install' : 'Restart to Update'
            ) : u.state === 'installing' ? (
              'Installing…'
            ) : u.inApp ? (
              'Update'
            ) : (
              'Download'
            )}
          </button>
          <div className="update-secondary">
            <button
              disabled={busy}
              onClick={() => {
                localStorage.setItem(LATER, JSON.stringify({ v: u.version, until: Date.now() + 24 * 3600_000 }))
                close()
              }}
            >
              Later
            </button>
            <button
              disabled={busy}
              onClick={() => {
                localStorage.setItem(SKIP, u.version!)
                close()
              }}
            >
              Skip this version
            </button>
          </div>
        </>
      )}
    </div>
  )
}

/** Settings → Updates and the menu bar open it too. */
export function showUpdates(): void {
  const u = useUpdate.getState()
  if (u.state === 'available' || u.state === 'ready') openUpdateSheet()
  else useUi.setState({ settings: 'updates' })
}
