import { attachmentStore, desktop } from './storage'

// Attachments (pictures, sketches, recordings, scans, files) are files of their own, named by a
// hash of their content, so the same picture in two notes is stored once. A note's content refers
// to them by id; the desktop app serves them as att://file/<id> (desktop/main.cjs).

export type AttachmentKind = 'image' | 'sketch' | 'audio' | 'video' | 'pdf' | 'file' | 'scan'

export async function hashBytes(data: Uint8Array): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', data as BufferSource)
  return [...new Uint8Array(digest)]
    .slice(0, 16)
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('')
}

/** Stores bytes and returns their id. */
export async function putAttachment(data: Uint8Array): Promise<string> {
  const id = await hashBytes(data)
  if (!(await attachmentStore.has(id))) await attachmentStore.put(id, data)
  return id
}

export const putBlob = async (blob: Blob): Promise<string> => putAttachment(new Uint8Array(await blob.arrayBuffer()))

const blobUrls = new Map<string, string>()
const mimes = new Map<string, string>()

/** A URL for showing an attachment (desktop: immediately; browser: once it's read). */
export async function attachmentUrl(id: string, mime?: string): Promise<string> {
  if (desktop) return `att://file/${id}`
  const known = blobUrls.get(id)
  if (known) return known
  const data = await attachmentStore.get(id)
  if (!data) return ''
  const url = URL.createObjectURL(new Blob([data as BlobPart], { type: mime ?? mimes.get(id) ?? '' }))
  blobUrls.set(id, url)
  return url
}

/** The synchronous URL where there is one (desktop), for HTML exports and quick previews. */
export const attachmentSrcSync = (id: string): string => (desktop ? `att://file/${id}` : (blobUrls.get(id) ?? ''))

export async function attachmentBytes(id: string): Promise<Uint8Array | null> {
  return attachmentStore.get(id)
}

export function kindOf(mime: string, name = ''): AttachmentKind {
  if (mime.startsWith('image/')) return 'image'
  if (mime.startsWith('audio/')) return 'audio'
  if (mime.startsWith('video/')) return 'video'
  if (mime === 'application/pdf' || /\.pdf$/i.test(name)) return 'pdf'
  return 'file'
}

const EXT_MIME: Record<string, string> = {
  png: 'image/png',
  jpg: 'image/jpeg',
  jpeg: 'image/jpeg',
  gif: 'image/gif',
  webp: 'image/webp',
  svg: 'image/svg+xml',
  heic: 'image/heic',
  bmp: 'image/bmp',
  pdf: 'application/pdf',
  mp3: 'audio/mpeg',
  m4a: 'audio/mp4',
  wav: 'audio/wav',
  ogg: 'audio/ogg',
  webm: 'audio/webm',
  mp4: 'video/mp4',
  mov: 'video/quicktime',
  txt: 'text/plain',
  md: 'text/markdown',
  html: 'text/html',
  json: 'application/json',
  zip: 'application/zip',
  docx: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  xlsx: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  pptx: 'application/vnd.openxmlformats-officedocument.presentationml.presentation'
}

export const mimeOf = (name: string, fallback = 'application/octet-stream'): string => EXT_MIME[name.split('.').pop()?.toLowerCase() ?? ''] ?? fallback

export function formatBytes(n: number): string {
  if (n < 1024) return `${n} bytes`
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(n < 10240 ? 1 : 0)} KB`
  return `${(n / 1024 / 1024).toFixed(1)} MB`
}

/** Shrinks big pictures (longest side `max`) to keep notes and sync light; small ones are kept as they are. */
export async function shrinkImage(blob: Blob, max = 2400): Promise<Blob> {
  if (!/^image\/(png|jpeg|webp)$/.test(blob.type) || blob.size < 600_000) return blob
  try {
    const bitmap = await createImageBitmap(blob)
    const scale = Math.min(1, max / Math.max(bitmap.width, bitmap.height))
    if (scale === 1 && blob.size < 3_000_000) return blob
    const canvas = new OffscreenCanvas(Math.round(bitmap.width * scale), Math.round(bitmap.height * scale))
    canvas.getContext('2d')!.drawImage(bitmap, 0, 0, canvas.width, canvas.height)
    const out = await canvas.convertToBlob({ type: blob.type === 'image/png' ? 'image/png' : 'image/jpeg', quality: 0.88 })
    return out.size < blob.size ? out : blob
  } catch {
    return blob
  }
}

export function base64ToBytes(b64: string): Uint8Array {
  const bin = atob(b64.replace(/\s/g, ''))
  const out = new Uint8Array(bin.length)
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i)
  return out
}

export function bytesToBase64(bytes: Uint8Array): string {
  let s = ''
  for (let i = 0; i < bytes.length; i += 0x8000) s += String.fromCharCode(...bytes.subarray(i, i + 0x8000))
  return btoa(s)
}

/** Stores a data: URL's bytes and returns { id, mime }. */
export async function putDataUrl(url: string): Promise<{ id: string; mime: string } | null> {
  const m = /^data:([^;,]+)?(;base64)?,(.*)$/s.exec(url)
  if (!m) return null
  const mime = m[1] ?? 'application/octet-stream'
  const bytes = m[2] ? base64ToBytes(m[3]) : new TextEncoder().encode(decodeURIComponent(m[3]))
  return { id: await putAttachment(bytes), mime }
}
