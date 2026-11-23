import { isAndroid, isMac } from './storage'

// Emoji for folder icons (the picker in src/ui/FolderIcon.tsx), from emojibase-data (MIT): every
// emoji with its name, keywords and category. About 800 KB, so it loads when the picker opens.
// Emoji newer than the system can draw are left out (Windows lags behind Apple and Android).

export interface Emoji {
  emoji: string
  label: string
  tags: string[]
  group: number
}

export const EMOJI_GROUPS: Array<{ id: number; label: string; icon: string }> = [
  { id: 0, label: 'Smileys & Emotion', icon: '😀' },
  { id: 1, label: 'People & Body', icon: '👋' },
  { id: 3, label: 'Animals & Nature', icon: '🐻' },
  { id: 4, label: 'Food & Drink', icon: '🍔' },
  { id: 5, label: 'Travel & Places', icon: '✈️' },
  { id: 6, label: 'Activities', icon: '⚽' },
  { id: 7, label: 'Objects', icon: '💡' },
  { id: 8, label: 'Symbols', icon: '❤️' },
  { id: 9, label: 'Flags', icon: '🏁' }
]

const NEWEST = isMac || isAndroid ? 16 : 15.1

let all: Promise<Emoji[]> | null = null

export function loadEmoji(): Promise<Emoji[]> {
  all ??= import('emojibase-data/en/data.json').then((m) =>
    (m.default as Array<{ emoji: string; label: string; tags?: string[]; group?: number; version: number; order?: number }>)
      // Group 2 is skin-tone and hair pieces, not emoji on their own.
      .filter((e) => e.group !== undefined && e.group !== 2 && e.version <= NEWEST)
      .sort((a, b) => (a.order ?? 0) - (b.order ?? 0))
      .map((e) => ({ emoji: e.emoji, label: e.label, tags: e.tags ?? [], group: e.group! }))
  )
  return all
}

/**
 * Best matches first: the name itself, a whole word of it or a keyword ("plane" → ✈️ before 🪐),
 * then names and keywords starting with it, then anywhere in the name.
 */
export function searchEmoji(list: Emoji[], query: string, limit = 120): Emoji[] {
  const q = query.trim().toLowerCase()
  if (!q) return []
  const scored: Array<[number, Emoji]> = []
  for (const e of list) {
    const label = e.label.toLowerCase()
    const words = label.split(/[\s:-]+/)
    const score =
      label === q ? 0
      : words.includes(q) || e.tags.includes(q) ? 1
      : label.startsWith(q) ? 2
      : words.some((w) => w.startsWith(q)) || e.tags.some((t) => t.startsWith(q)) ? 3
      : label.includes(q) ? 4
      : -1
    if (score >= 0) scored.push([score, e])
  }
  // Ties: the ones with it in their name first (a keyword alone is a looser match).
  const inName = (e: Emoji) => (e.label.toLowerCase().includes(q) ? 0 : 1)
  return scored
    .sort((a, b) => a[0] - b[0] || inName(a[1]) - inName(b[1]))
    .slice(0, limit)
    .map(([, e]) => e)
}

// Recently used, on this device.
const RECENT = 'notes.recent-emoji'

export function recentEmoji(): string[] {
  try {
    return (JSON.parse(localStorage.getItem(RECENT) ?? '[]') as string[]).slice(0, 24)
  } catch {
    return []
  }
}

export function rememberEmoji(emoji: string): void {
  try {
    localStorage.setItem(RECENT, JSON.stringify([emoji, ...recentEmoji().filter((e) => e !== emoji)].slice(0, 24)))
  } catch {}
}
