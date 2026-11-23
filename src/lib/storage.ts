import { Capacitor } from '@capacitor/core'
import { Directory, Encoding, Filesystem } from '@capacitor/filesystem'
import type { UpdateStatus } from './release'

// Where Notes keeps its data: on desktop, a JSON file and an attachments folder in the app's data
// folder (through the Electron preload's bridge, desktop/preload.cjs); on Android, a JSON file in
// the app's storage (Capacitor Filesystem) and IndexedDB; in a plain browser, localStorage and
// IndexedDB.

export interface FetchInit {
  method?: string
  headers?: Record<string, string>
  body?: string
}

export interface LinkPreview {
  url: string
  title?: string
  description?: string
  image?: string
  site?: string
}

export interface DesktopBridge {
  platform: 'darwin' | 'win32' | 'linux'
  version: string
  /** Whether the window can be see-through (macOS, Windows 11). */
  translucency: boolean
  load(): Promise<string | null>
  save(json: string): Promise<void>
  attachments: {
    put(id: string, data: Uint8Array): Promise<void>
    get(id: string): Promise<Uint8Array | null>
    has(id: string): Promise<boolean>
    list(): Promise<string[]>
    remove(id: string): Promise<void>
  }
  saveFile(name: string, data: string | Uint8Array): Promise<boolean>
  /** Prints HTML to a PDF and asks where to save it. */
  savePdf(name: string, html: string): Promise<boolean>
  print(html: string): Promise<void>
  /** Reads every note from Apple Notes (macOS, asks for permission the first time). */
  appleNotes(): Promise<{ folders: Array<{ id: string; name: string; parent?: string }>; notes: Array<{ id: string; folder: string; name: string; body: string; created: number; modified: number; locked: boolean }> }>
  linkPreview(url: string): Promise<LinkPreview | null>
  openExternal(url: string): void
  closeWindow(): void
  secrets: {
    get(name: string): Promise<string | null>
    set(name: string, value: string | null): Promise<void>
  }
  float: {
    toggle(): void
    hide(): void
    pin(on: boolean): void
    pinned(): Promise<boolean>
    openInNotes(id: string): void
    onShown(cb: () => void): () => void
    onHidden(cb: () => void): () => void
  }
  windows: {
    send(patch: import('./windows').Patch): void
    onPatch(cb: (patch: import('./windows').Patch) => void): () => void
  }
  setChrome(colors: { bg: string; fg: string; dark: boolean; translucent: boolean }): void
  setQuickNoteShortcut(on: boolean): void
  shortcuts: {
    set(overrides: Record<string, string>): Promise<import('./shortcuts').Shortcut[]>
    /** While on, keys pressed go to onCaptured instead of running anything. */
    capture(on: boolean): void
    onCaptured(cb: (keys: string) => void): () => void
  }
  setSpellcheck(on: boolean): void
  onMenu(cb: (command: string, arg?: string) => void): () => void
  touchId: {
    available: boolean
    save(password: string | null): Promise<void>
    unlock(reason: string): Promise<string | null>
  }
  ai: {
    hasKey(): Promise<boolean>
    setKey(key: string | null): Promise<void>
    title(text: string): Promise<string>
    /** true, or why Apple Intelligence can't be used. */
    appleAvailable(): Promise<true | string>
    appleTitle(text: string): Promise<string>
  }
  google: {
    configured: boolean
    signIn(): Promise<string | undefined>
    signOut(): Promise<void>
    fetch(url: string, init?: FetchInit): Promise<{ status: number; ok: boolean; text: string }>
    /** Binary up/downloads for attachments (base64 in, base64 out). */
    fetchBytes(url: string, init?: { method?: string; headers?: Record<string, string>; body?: Uint8Array }): Promise<{ status: number; ok: boolean; data: Uint8Array | null; text: string }>
  }
  updater: {
    status(): Promise<UpdateStatus>
    check(quiet?: boolean): Promise<void>
    download(): Promise<void>
    install(): Promise<void>
    setAuto(enabled: boolean): void
    onChange(cb: (status: UpdateStatus) => void): () => void
  }
}

export const desktop: DesktopBridge | null = typeof window !== 'undefined' ? ((window as unknown as { notesApp?: DesktopBridge }).notesApp ?? null) : null

/** The Android app (Capacitor around this same web build). */
export const isAndroid = Capacitor.getPlatform() === 'android'

export const isMac = desktop ? desktop.platform === 'darwin' : typeof navigator !== 'undefined' && /Mac/.test(navigator.platform)

const KEY = 'notes:data'

// On Android the notes are a file in the app's own storage (with a .bak copy), not localStorage,
// which only holds a few megabytes.
const FILE = 'notes.json'

async function readFile(path: string): Promise<string | null> {
  try {
    const r = await Filesystem.readFile({ path, directory: Directory.Data, encoding: Encoding.UTF8 })
    const text = typeof r.data === 'string' ? r.data : await r.data.text()
    JSON.parse(text)
    return text
  } catch {
    return null
  }
}

export async function loadData(): Promise<string | null> {
  if (desktop) return desktop.load()
  if (isAndroid) return (await readFile(FILE)) ?? (await readFile(`${FILE}.bak`))
  return localStorage.getItem(KEY)
}

let lastBackup = 0
export async function saveData(json: string): Promise<void> {
  if (desktop) return desktop.save(json)
  if (isAndroid) {
    // A backup copy, at most every few minutes.
    if (Date.now() - lastBackup > 5 * 60_000) {
      await Filesystem.copy({ from: FILE, to: `${FILE}.bak`, directory: Directory.Data }).catch(() => {})
      lastBackup = Date.now()
    }
    await Filesystem.writeFile({ path: FILE, data: json, directory: Directory.Data, encoding: Encoding.UTF8 })
    return
  }
  localStorage.setItem(KEY, json)
}

// ── Attachments in a browser: IndexedDB ──────────────────────────────────────────────────────

let dbPromise: Promise<IDBDatabase> | null = null
function db(): Promise<IDBDatabase> {
  dbPromise ??= new Promise((resolve, reject) => {
    const req = indexedDB.open('notes-attachments', 1)
    req.onupgradeneeded = () => req.result.createObjectStore('files')
    req.onsuccess = () => resolve(req.result)
    req.onerror = () => reject(req.error)
  })
  return dbPromise
}

function idb<T>(mode: IDBTransactionMode, fn: (s: IDBObjectStore) => IDBRequest): Promise<T> {
  return db().then(
    (d) =>
      new Promise<T>((resolve, reject) => {
        const req = fn(d.transaction('files', mode).objectStore('files'))
        req.onsuccess = () => resolve(req.result as T)
        req.onerror = () => reject(req.error)
      })
  )
}

export const browserAttachments: DesktopBridge['attachments'] = {
  put: (id, data) => idb<void>('readwrite', (s) => s.put(data, id)),
  get: async (id) => (await idb<Uint8Array | undefined>('readonly', (s) => s.get(id))) ?? null,
  has: async (id) => (await idb<number>('readonly', (s) => s.count(id))) > 0,
  list: async () => (await idb<IDBValidKey[]>('readonly', (s) => s.getAllKeys())).map(String),
  remove: (id) => idb<void>('readwrite', (s) => s.delete(id))
}

export const attachmentStore = desktop?.attachments ?? browserAttachments

/** Saves a file the user asked for (desktop: a save dialog; browser: a download). */
export async function saveFileAs(name: string, data: string | Uint8Array, mime = 'application/octet-stream'): Promise<boolean> {
  if (desktop) return desktop.saveFile(name, data)
  if (isAndroid) {
    // Android: hand the file to the share sheet (Save to Files, Drive, send it…).
    const { Share } = await import('@capacitor/share')
    const base64 = typeof data === 'string' ? btoa(unescape(encodeURIComponent(data))) : btoa(Array.from(data, (b) => String.fromCharCode(b)).join(''))
    const { uri } = await Filesystem.writeFile({ path: name, data: base64, directory: Directory.Cache })
    try {
      await Share.share({ title: name, files: [uri] })
      return true
    } catch {
      return false
    }
  }
  const blob = new Blob([typeof data === 'string' ? data : (data as BlobPart)], { type: mime })
  const a = document.createElement('a')
  a.href = URL.createObjectURL(blob)
  a.download = name
  a.click()
  setTimeout(() => URL.revokeObjectURL(a.href), 30_000)
  return true
}

export function openExternal(url: string): void {
  if (desktop) desktop.openExternal(url)
  else window.open(url, '_blank', 'noopener')
}

/** Secrets kept on this device only (a connected service's token): the desktop keychain, the
 *  Android app's private storage, or (in a browser) localStorage. Never synced or exported. */
export const secrets = {
  async get(name: string): Promise<string | null> {
    if (desktop) return desktop.secrets.get(name)
    if (isAndroid) return readSecret(name)
    return localStorage.getItem(`notes:secret:${name}`)
  },
  async set(name: string, value: string | null): Promise<void> {
    if (desktop) return desktop.secrets.set(name, value)
    if (isAndroid) {
      const path = `secrets/${name}`
      if (!value) await Filesystem.deleteFile({ path, directory: Directory.Data }).catch(() => {})
      else await Filesystem.writeFile({ path, data: value, directory: Directory.Data, encoding: Encoding.UTF8, recursive: true })
      return
    }
    if (value) localStorage.setItem(`notes:secret:${name}`, value)
    else localStorage.removeItem(`notes:secret:${name}`)
  }
}

async function readSecret(name: string): Promise<string | null> {
  try {
    const r = await Filesystem.readFile({ path: `secrets/${name}`, directory: Directory.Data, encoding: Encoding.UTF8 })
    return typeof r.data === 'string' ? r.data : await r.data.text()
  } catch {
    return null
  }
}
