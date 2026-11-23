// Brand logos for folder icons, from Simple Icons (CC0; the logos belong to their owners). The
// whole set is a few megabytes, so it loads the first time someone searches it; a folder keeps
// its logo's path itself (folder.logo), so tiles draw without it.

export interface Brand {
  title: string
  slug: string
  /** Brand colour, without the #. */
  hex: string
  /** SVG path on a 24×24 grid. */
  path: string
}

let all: Promise<Brand[]> | null = null

export function loadBrands(): Promise<Brand[]> {
  all ??= import('simple-icons').then((m) =>
    Object.values(m as unknown as Record<string, unknown>)
      .filter((x): x is Brand => typeof x === 'object' && x !== null && 'slug' in x && 'path' in x)
      .map(({ title, slug, hex, path }) => ({ title, slug, hex, path }))
      .sort((a, b) => a.title.localeCompare(b.title))
  )
  return all
}

/** Shown before anything is typed. */
const POPULAR = ['github', 'google', 'apple', 'youtube', 'spotify', 'notion', 'figma', 'slack', 'discord', 'netflix', 'instagram', 'x', 'reddit', 'amazon', 'steam', 'playstation', 'android', 'obsidian', 'airbnb', 'uber', 'duolingo', 'strava', 'twitch', 'linear']

const norm = (s: string) => s.toLowerCase().normalize('NFKD').replace(/[^a-z0-9]/g, '')

/** Best matches first: the name itself, then names starting with it, then words starting with it, then anywhere. */
export function searchBrands(list: Brand[], query: string, limit = 48): Brand[] {
  const q = norm(query)
  if (!q) return POPULAR.map((s) => list.find((b) => b.slug === s)).filter((b): b is Brand => Boolean(b))
  const scored: Array<[number, Brand]> = []
  for (const b of list) {
    const t = norm(b.title)
    const words = b.title.toLowerCase().split(/[^a-z0-9]+/i).map(norm)
    const score = t === q || b.slug === q ? 0 : t.startsWith(q) ? 1 : words.some((w) => w.startsWith(q)) ? 2 : t.includes(q) || b.slug.includes(q) ? 3 : -1
    if (score >= 0) scored.push([score, b])
  }
  return scored.sort((a, b) => a[0] - b[0] || a[1].title.length - b[1].title.length).slice(0, limit).map(([, b]) => b)
}

/** Very dark or very light brand colours (GitHub's near-black, say) would vanish on one of the themes. */
export function usableColour(hex: string): string | undefined {
  const n = Number.parseInt(hex, 16)
  const l = (0.2126 * ((n >> 16) & 255) + 0.7152 * ((n >> 8) & 255) + 0.0722 * (n & 255)) / 255
  return l < 0.16 || l > 0.9 ? undefined : `#${hex}`
}
