// "Generate title". A language model reads the whole note and sums it up: Apple's on-device model on
// a Mac with Apple Intelligence, or Claude with an Anthropic API key (desktop/ai.cjs). Without
// either, a basic title from the note's words: the ones used most (leaving out common ones), in
// the order the note first uses them; a short first line is taken as it is.
import type { TitleEngine } from './types'

const STOP = new Set(
  `a an and are as at be been but by can could did do does for from had has have he her here him his how i if in into is it its just like me more most my no not of on or our out so some than that the their them then there these they this to too up us was we were what when where which who will with would you your yours am also about after again all any because before being both each few further get got having just let make many may might much must nor now off once only other over own same she should since such through under until very via while why yet go going one two new note notes need needs thing things really want lot today tomorrow yesterday buy remember call check use see think know take put keep look try add cheaper better good great`.split(
    /\s+/
  )
)

const titleCase = (s: string) =>
  s
    .split(' ')
    .map((w, i) => (i > 0 && /^(and|or|of|the|a|an|in|on|for|to|with)$/i.test(w) ? w.toLowerCase() : w[0].toUpperCase() + w.slice(1)))
    .join(' ')

export function localTitle(text: string): string {
  const lines = text
    .split('\n')
    .map((l) => l.replace(/#[\p{L}\p{N}_-]+/gu, '').trim())
    .filter(Boolean)
  if (!lines.length) return ''
  const first = lines[0]
  const firstWords = first.split(/\s+/)
  // A short heading-like first line ("Trip to Lisbon") is already a title.
  if (firstWords.length <= 7 && !/[.!?:]$/.test(first) && lines.length > 1) return titleCase(first.replace(/[,;]+$/, ''))

  const counts = new Map<string, { n: number; first: number; word: string }>()
  let pos = 0
  for (const raw of text.toLowerCase().match(/[\p{L}][\p{L}\p{N}'-]{2,}/gu) ?? []) {
    pos++
    const w = raw.replace(/'s$/, '')
    if (STOP.has(w)) continue
    const e = counts.get(w)
    if (e) e.n++
    else counts.set(w, { n: 1, first: pos, word: w })
  }
  if (!counts.size) return titleCase(firstWords.slice(0, 6).join(' ').replace(/[.,;:!?]+$/, ''))
  // Most used first; ties go to the earlier word. One word the note keeps coming back to is the title
  // on its own; otherwise the top few, in reading order.
  const ranked = [...counts.values()].sort((a, b) => b.n - a.n || a.first - b.first)
  if (ranked[0].n >= 2 && ranked[0].n >= 2 * (ranked[1]?.n ?? 0)) return titleCase(ranked[0].word)
  const top = ranked.slice(0, 3)
  const words = top.sort((a, b) => a.first - b.first).map((e) => e.word)
  const joined = words.length === 1 ? words[0] : `${words.slice(0, -1).join(', ')} and ${words[words.length - 1]}`
  return titleCase(joined)
}

/** Suggests a title for a note's text, with the engine chosen in Settings → Text. */
export async function generateTitle(text: string, engine: TitleEngine): Promise<string> {
  const { desktop } = await import('./storage')
  if (!desktop || engine === 'basic') return localTitle(text)
  if (engine === 'apple') return desktop.ai.appleTitle(text)
  if (engine === 'claude') return desktop.ai.title(text)
  if ((await desktop.ai.appleAvailable()) === true) return desktop.ai.appleTitle(text)
  if (await desktop.ai.hasKey()) return desktop.ai.title(text)
  return localTitle(text)
}
