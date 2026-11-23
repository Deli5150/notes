import { registerPlugin } from '@capacitor/core'
import { isAndroid } from './storage'
import type { Palette } from './themes'

// The Android app's own bits (android/app/src/main/java/app/notes/android/NotesNativePlugin.java).

interface NotesNative {
  setBackground(o: { color: string; dark: boolean }): Promise<void>
  insets(): Promise<Partial<Insets>>
  addListener(event: 'insets', fn: (e: Insets) => void): Promise<{ remove(): Promise<void> }>
  googleAuthorize(o: { interactive: boolean; scopes?: string[] }): Promise<{ accessToken: string }>
  downloadUpdate(o: { url: string; name: string; sha256?: string }): Promise<{ path: string }>
  installUpdate(o: { path: string }): Promise<{ needsPermission?: boolean; missing?: boolean }>
  addListener(event: 'updateProgress', fn: (e: { progress: number }) => void): Promise<{ remove(): Promise<void> }>
}

const native = isAndroid ? registerPlugin<NotesNative>('NotesNative') : null

interface Insets {
  top: number
  bottom: number
  left: number
  right: number
}

/**
 * Notes fills the whole screen, behind the status and navigation bars (NotesNativePlugin), so its
 * own background shows there. The bars' sizes come back as --safe-area-inset-*, which app.css
 * keeps the content clear of.
 */
export function startInsets(): void {
  if (!native) return
  const apply = (i: Partial<Insets>) => {
    for (const side of ['top', 'bottom', 'left', 'right'] as const) if (typeof i[side] === 'number') document.documentElement.style.setProperty(`--safe-area-inset-${side}`, `${i[side]}px`)
  }
  void native.insets().then(apply)
  void native.addListener('insets', apply)
}

/** The in-app updater's native half (src/lib/updater.ts). */
export const androidUpdater = native

const hex = (c: string): [number, number, number] | null => {
  const m = /^#([0-9a-f]{6})$/i.exec(c.trim())
  return m ? [0, 2, 4].map((i) => parseInt(m[1].slice(i, i + 2), 16)) as [number, number, number] : null
}

/** a mixed with b, like CSS color-mix (share is a's part, 0–1). */
function mix(a: string, b: string, share: number): string {
  const x = hex(a)
  const y = hex(b)
  if (!x || !y) return b
  return `#${x.map((v, i) => Math.round(v * share + y[i] * (1 - share)).toString(16).padStart(2, '0')).join('')}`
}

/** The status and navigation bars: the colour of what's under them, light or dark icons. */
export function paintBars(p: Palette, dark: boolean, screen: 'list' | 'note'): void {
  if (!native) return
  // The list sits on the tinted canvas (app.css .app); a note on its card.
  void native.setBackground({ color: screen === 'note' ? p.bg : mix(p.accent, p.sidebarSolid, 0.2), dark })
}

// ── Sign in with Google on Android ──────────────────────────────────────────────────────────
// Google's Android authorization (NotesNativePlugin.googleAuthorize) hands out short-lived access
// tokens; a new one comes without asking once the person has said yes. Sync (Drive) and Google
// Tasks are separate sessions, each remembered on its own. Google APIs are called straight from
// the page with the token.

/** Thrown when Notes has to ask again (google.ts turns it into SignedOutError). */
export class AndroidSignedOut extends Error {}

function session(key: string, scopes?: string[]) {
  let token: string | null = null
  const remembered = (): boolean => {
    try {
      return localStorage.getItem(key) === 'yes'
    } catch {
      return false
    }
  }
  const remember = (on: boolean) => {
    try {
      if (on) localStorage.setItem(key, 'yes')
      else localStorage.removeItem(key)
    } catch {}
  }
  async function authorize(interactive: boolean): Promise<string> {
    if (!native) throw new AndroidSignedOut('Not signed in to Google')
    try {
      token = (await native.googleAuthorize({ interactive, scopes })).accessToken
      remember(true)
      return token
    } catch (e) {
      const code = (e as { code?: string }).code
      if (code === 'signed-out' || code === 'cancelled') throw new AndroidSignedOut((e as Error).message)
      throw e
    }
  }
  async function withToken(send: (token: string) => Promise<Response>): Promise<Response> {
    if (!remembered()) throw new AndroidSignedOut('Not signed in to Google')
    let res = await send(token ?? (await authorize(false)))
    if (res.status === 401) res = await send(await authorize(false))
    if (res.status === 401) throw new AndroidSignedOut('Google sign-in expired')
    return res
  }
  const auth = (t: string, headers?: Record<string, string>) => ({ ...headers, Authorization: `Bearer ${t}` })
  return {
    signIn: async () => void (await authorize(true)),
    async signOut() {
      // Gives up Notes' access too, so signing in again asks afresh.
      if (token) await fetch(`https://oauth2.googleapis.com/revoke?token=${encodeURIComponent(token)}`, { method: 'POST' }).catch(() => {})
      token = null
      remember(false)
    },
    async fetch(url: string, init: { method?: string; headers?: Record<string, string>; body?: string } = {}) {
      const res = await withToken((t) => fetch(url, { method: init.method, headers: auth(t, init.headers), body: init.body }))
      return { status: res.status, ok: res.ok, text: await res.text() }
    },
    async fetchBytes(url: string, init: { method?: string; headers?: Record<string, string>; body?: Uint8Array } = {}) {
      const res = await withToken((t) => fetch(url, { method: init.method, headers: auth(t, init.headers), body: init.body as BodyInit | undefined }))
      if (!res.ok) return { status: res.status, ok: false, data: null, text: await res.text() }
      return { status: res.status, ok: true, data: new Uint8Array(await res.arrayBuffer()), text: '' }
    }
  }
}

const syncSession = session('notes.google-signed-in')
export const androidSignIn = syncSession.signIn
export const androidSignOut = syncSession.signOut
export const androidFetch = syncSession.fetch
export const androidFetchBytes = syncSession.fetchBytes

/** Google Tasks, read-only (Settings → Connected Services). */
export const androidTasks = session('notes.google-tasks-signed-in', ['https://www.googleapis.com/auth/tasks.readonly'])
