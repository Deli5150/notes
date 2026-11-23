import { serviceFetch, ServiceError } from './services/net'
import { secrets } from './storage'

// Image Wand: pictures made by Google's Gemini image models (Nano Banana), with the person's own
// API key from Google AI Studio (kept on this device, never synced). From a description (and the
// note's text, if they like), or from a canvas or sketch, which it turns into a finished picture.
// API: the Interactions API (https://aistudio.google.com/docs/image-generation).

const API = 'https://generativelanguage.googleapis.com/v1beta/interactions'
const KEY = 'gemini-key'

export const IMAGE_MODELS: Array<[id: string, label: string]> = [
  ['gemini-nano-banana-2.1', 'Nano Banana 2.1 (best)'],
  ['gemini-3.1-flash-lite-image', 'Nano Banana 2 Lite (fastest, cheapest)'],
  ['gemini-3-pro-image', 'Nano Banana Pro (most detailed)']
]

export type ImageStyle = 'animation' | 'illustration' | 'sketch' | 'photo'

export const IMAGE_STYLES: Array<[ImageStyle, string, string]> = [
  ['animation', 'Animation', 'in the style of a modern 3D animated film: soft lighting, rounded shapes, bright friendly colours'],
  ['illustration', 'Illustration', 'as a flat editorial illustration with clean shapes, bold simple colours and minimal detail'],
  ['sketch', 'Sketch', 'as a hand-drawn pencil and ink sketch on white paper, with loose expressive lines'],
  ['photo', 'Photo', 'as a natural, realistic photograph']
]

export const NEW_KEY_URL = 'https://aistudio.google.com/apikey'

export const hasImageKey = async (): Promise<boolean> => Boolean(await secrets.get(KEY))
export const saveImageKey = (key: string | null): Promise<void> => secrets.set(KEY, key?.trim() || null)

/** The last picture in the answer, wherever the API puts it ({ type: "image", data, mime_type }). */
export function findImage(value: unknown): { data: string; mime: string } | null {
  let found: { data: string; mime: string } | null = null
  const walk = (v: unknown) => {
    if (!v || typeof v !== 'object') return
    if (Array.isArray(v)) return v.forEach(walk)
    const o = v as Record<string, unknown>
    const data = o.data ?? (o.inline_data as Record<string, unknown> | undefined)?.data ?? (o.inlineData as Record<string, unknown> | undefined)?.data
    const mime = o.mime_type ?? o.mimeType ?? (o.inline_data as Record<string, unknown> | undefined)?.mime_type ?? (o.inlineData as Record<string, unknown> | undefined)?.mimeType
    if (typeof data === 'string' && data.length > 100 && (o.type === 'image' || o.inline_data || o.inlineData || (typeof mime === 'string' && mime.startsWith('image/')))) found = { data, mime: typeof mime === 'string' ? mime : 'image/png' }
    for (const k of Object.keys(o)) if (k !== 'data') walk(o[k])
  }
  walk(value)
  return found
}

const b64 = (bytes: Uint8Array) => {
  let s = ''
  for (let i = 0; i < bytes.length; i += 0x8000) s += String.fromCharCode(...bytes.subarray(i, i + 0x8000))
  return btoa(s)
}

export interface ImageRequest {
  prompt: string
  style: ImageStyle
  model: string
  /** The note's text, for ideas. */
  context?: string
  /** A drawing (canvas or sketch, PNG) to turn into a finished picture. */
  from?: Uint8Array
}

/** Makes one picture: PNG/JPEG bytes and their type. */
export async function generateImage(req: ImageRequest): Promise<{ bytes: Uint8Array; mime: string }> {
  const key = await secrets.get(KEY)
  if (!key) throw new ServiceError('Add your Gemini API key in Settings → Text → Image Wand first.')
  const style = IMAGE_STYLES.find(([s]) => s === req.style)?.[2] ?? ''
  const what = req.prompt.trim()
  const text = req.from
    ? `Turn this rough drawing into a finished picture ${style}. Keep its composition, subjects and layout.${what ? ` It shows: ${what}.` : ''} No text or captions unless the drawing has them.`
    : `Create a picture of ${what || 'the main idea of the note below'} ${style}. No text or captions in the picture.${req.context?.trim() ? `\n\nFor context, the note it's going in says:\n${req.context.trim().slice(0, 3000)}` : ''}`
  const input: unknown[] = [{ type: 'text', text }]
  if (req.from) input.push({ type: 'image', mime_type: 'image/png', data: b64(req.from) })
  const res = await serviceFetch(API, {
    method: 'POST',
    headers: { 'x-goog-api-key': key, 'Content-Type': 'application/json', 'Api-Revision': '2026-05-20' },
    body: JSON.stringify({ model: req.model, input, response_format: { type: 'image', mime_type: 'image/png', aspect_ratio: '1:1' } })
  })
  if (res.status === 400 && /api.?key/i.test(res.text)) throw new ServiceError('Google didn’t accept the API key. Check it in Settings → Text → Image Wand.')
  if (res.status === 401 || res.status === 403) throw new ServiceError('Google didn’t accept the API key (or it can’t use this model).')
  if (res.status === 429) throw new ServiceError('Too many pictures right now (or the key’s quota is used up). Try again in a moment.')
  if (!res.ok) {
    let msg = ''
    try {
      msg = (JSON.parse(res.text) as { error?: { message?: string } }).error?.message ?? ''
    } catch {}
    throw new ServiceError(`Google answered ${res.status}${msg ? `: ${msg}` : ''}`)
  }
  const image = findImage(JSON.parse(res.text))
  if (!image) throw new ServiceError('Google didn’t send a picture back (it may have declined the request). Try describing it differently.')
  const bin = atob(image.data)
  const bytes = new Uint8Array(bin.length)
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i)
  return { bytes, mime: image.mime }
}
