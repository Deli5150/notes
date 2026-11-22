import { create } from 'zustand'
import { base64ToBytes, bytesToBase64 } from './attachments'
import { derive } from './content'
import { desktop } from './storage'
import { useStore } from './store'
import type { LockedContent, LockSettings } from './types'

// Locked notes, as in Apple Notes: one password for every locked note, set in Settings. A locked
// note's content is encrypted (AES-GCM, key from the password with PBKDF2) — only its title stays
// readable. Once you've typed the password, locked notes stay open until you choose Lock Now or
// quit Notes. On a Mac with Touch ID, the password can be kept in the keychain for Touch ID.

const ITERATIONS = 310_000
const CHECK = 'notes-lock-check'

interface LockState {
  key: CryptoKey | null
  /** Decrypted content of locked notes opened this session. */
  open: Record<string, { html: string; text: string }>
}

export const useLock = create<LockState>(() => ({ key: null, open: {} }))

async function deriveKey(password: string, salt: Uint8Array): Promise<CryptoKey> {
  const base = await crypto.subtle.importKey('raw', new TextEncoder().encode(password) as BufferSource, 'PBKDF2', false, ['deriveKey'])
  return crypto.subtle.deriveKey({ name: 'PBKDF2', salt: salt as BufferSource, iterations: ITERATIONS, hash: 'SHA-256' }, base, { name: 'AES-GCM', length: 256 }, false, ['encrypt', 'decrypt'])
}

async function seal(key: CryptoKey, text: string): Promise<{ data: string; iv: string }> {
  const iv = crypto.getRandomValues(new Uint8Array(12))
  const data = await crypto.subtle.encrypt({ name: 'AES-GCM', iv }, key, new TextEncoder().encode(text) as BufferSource)
  return { data: bytesToBase64(new Uint8Array(data)), iv: bytesToBase64(iv) }
}

async function unseal(key: CryptoKey, data: string, iv: string): Promise<string> {
  const plain = await crypto.subtle.decrypt({ name: 'AES-GCM', iv: base64ToBytes(iv) as BufferSource }, key, base64ToBytes(data) as BufferSource)
  return new TextDecoder().decode(plain)
}

export const hasPassword = (): boolean => Boolean(useStore.getState().settings.lock)
export const isUnlocked = (): boolean => Boolean(useLock.getState().key)

async function keyFor(password: string, lock: LockSettings): Promise<CryptoKey | null> {
  const key = await deriveKey(password, base64ToBytes(lock.salt))
  try {
    return (await unseal(key, lock.check, lock.checkIv)) === CHECK ? key : null
  } catch {
    return null
  }
}

async function newLock(password: string, hint: string, v: number): Promise<{ lock: LockSettings; key: CryptoKey }> {
  const salt = crypto.getRandomValues(new Uint8Array(16))
  const key = await deriveKey(password, salt)
  const check = await seal(key, CHECK)
  return { key, lock: { salt: bytesToBase64(salt), check: check.data, checkIv: check.iv, hint, v } }
}

/** Sets the notes password the first time. */
export async function setPassword(password: string, hint: string): Promise<void> {
  const { lock, key } = await newLock(password, hint, 1)
  useStore.getState().setSettings({ lock })
  useLock.setState({ key })
}

/** Types the password: opens locked notes for this session. False if it's wrong. */
export async function unlock(password: string): Promise<boolean> {
  const lock = useStore.getState().settings.lock
  if (!lock) return false
  const key = await keyFor(password, lock)
  if (!key) return false
  useLock.setState({ key })
  return true
}

/** Touch ID (Mac): unlock with the password kept in the keychain. */
export async function unlockWithTouchId(): Promise<boolean> {
  if (!desktop?.touchId.available || !useStore.getState().settings.touchId) return false
  const password = await desktop.touchId.unlock('unlock your locked notes').catch(() => null)
  return password ? unlock(password) : false
}

/** Closes every locked note again. */
export function lockNow(): void {
  useLock.setState({ key: null, open: {} })
}

async function sealNote(key: CryptoKey, html: string, v: number): Promise<LockedContent> {
  const { data, iv } = await seal(key, JSON.stringify({ html }))
  return { data, iv, v }
}

/** Locks a note (the password must be typed first). */
export async function lockNote(id: string): Promise<void> {
  const { key } = useLock.getState()
  const s = useStore.getState()
  const note = s.notes.find((n) => n.id === id)
  if (!key || !note || note.locked || !s.settings.lock) return
  const locked = await sealNote(key, note.html, s.settings.lock.v)
  useLock.setState((st) => ({ open: { ...st.open, [id]: { html: note.html, text: note.text } } }))
  s.updateNote(id, { locked, html: '', text: '', tags: [], thumb: undefined, hasChecklist: false })
}

/** A locked note's content (decrypting it the first time this session). */
export async function openLocked(id: string): Promise<{ html: string; text: string } | null> {
  const { key, open } = useLock.getState()
  if (open[id]) return open[id]
  const note = useStore.getState().notes.find((n) => n.id === id)
  if (!key || !note?.locked) return null
  try {
    const { html } = JSON.parse(await unseal(key, note.locked.data, note.locked.iv)) as { html: string }
    const content = { html, text: derive(html).text }
    useLock.setState((st) => ({ open: { ...st.open, [id]: content } }))
    return content
  } catch {
    return null
  }
}

/** Saves an edit to an open locked note (encrypted). */
export async function saveLocked(id: string, html: string): Promise<void> {
  const { key } = useLock.getState()
  const s = useStore.getState()
  if (!key || !s.settings.lock) return
  const d = derive(html)
  useLock.setState((st) => ({ open: { ...st.open, [id]: { html, text: d.text } } }))
  const locked = await sealNote(key, html, s.settings.lock.v)
  s.updateNote(id, { locked, title: d.title, attachments: d.attachments, updatedAt: Date.now() })
}

/** Takes the lock off a note. */
export async function removeLock(id: string): Promise<void> {
  const content = await openLocked(id)
  if (!content) return
  const s = useStore.getState()
  s.updateNote(id, { locked: undefined, html: content.html, ...derive(content.html) })
  useLock.setState((st) => {
    const { [id]: _gone, ...open } = st.open
    return { open }
  })
}

/** Changes the password: every locked note is re-encrypted with the new one. */
export async function changePassword(oldPassword: string, newPassword: string, hint: string): Promise<boolean> {
  const s = useStore.getState()
  if (!s.settings.lock) return false
  const oldKey = await keyFor(oldPassword, s.settings.lock)
  if (!oldKey) return false
  const { lock, key } = await newLock(newPassword, hint, s.settings.lock.v + 1)
  for (const n of s.notes.filter((x) => x.locked)) {
    try {
      const plain = await unseal(oldKey, n.locked!.data, n.locked!.iv)
      const { data, iv } = await seal(key, plain)
      s.updateNote(n.id, { locked: { data, iv, v: lock.v } })
    } catch {}
  }
  s.setSettings({ lock })
  useLock.setState({ key })
  if (desktop?.touchId.available && s.settings.touchId) await desktop.touchId.save(newPassword)
  return true
}

/**
 * Resets the password (when it's forgotten): notes locked with the old one stay locked with it;
 * new locks use the new password, as in Apple Notes.
 */
export async function resetPassword(newPassword: string, hint: string): Promise<void> {
  const old = useStore.getState().settings
  const v = (old.lock?.v ?? 0) + 1
  const { lock, key } = await newLock(newPassword, hint, v)
  useStore.getState().setSettings({ lock, lockHistory: [...(old.lock ? [old.lock] : []), ...(old.lockHistory ?? [])], touchId: false })
  useLock.setState({ key, open: {} })
  await desktop?.touchId.save(null)
}

/** Whether a locked note was locked with a password that has since been reset. */
export function lockedWithOldPassword(id: string): boolean {
  const s = useStore.getState()
  const n = s.notes.find((x) => x.id === id)
  return Boolean(n?.locked && s.settings.lock && n.locked.v !== s.settings.lock.v)
}

/**
 * Opens a note locked with an old (reset) password. It's re-locked with the current password, if
 * that's been typed this session.
 */
export async function openWithOldPassword(id: string, password: string): Promise<boolean> {
  const s = useStore.getState()
  const n = s.notes.find((x) => x.id === id)
  const old = s.settings.lockHistory?.find((l) => l.v === n?.locked?.v)
  if (!n?.locked || !old) return false
  const key = await keyFor(password, old)
  if (!key) return false
  try {
    const { html } = JSON.parse(await unseal(key, n.locked.data, n.locked.iv)) as { html: string }
    useLock.setState((st) => ({ open: { ...st.open, [id]: { html, text: derive(html).text } } }))
    const current = useLock.getState().key
    if (current && s.settings.lock) s.updateNote(id, { locked: await sealNote(current, html, s.settings.lock.v) })
    return true
  } catch {
    return false
  }
}
