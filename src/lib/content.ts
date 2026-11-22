// What the app derives from a note's HTML: its title (the first line), plain text for search and
// previews, #tags, attachments, and whether it has a checklist.

export const TAG_RE = /(^|[\s(])#([\p{L}\p{N}_][\p{L}\p{N}_\-/]*)/gu

export interface Derived {
  title: string
  text: string
  tags: string[]
  attachments: string[]
  thumb?: string
  hasChecklist: boolean
}

const BLOCKS = new Set(['P', 'H1', 'H2', 'H3', 'H4', 'H5', 'H6', 'LI', 'PRE', 'BLOCKQUOTE', 'TR', 'DIV', 'FIGURE', 'HR'])

/** Plain text of an element, one line per block. */
export function textOf(root: Node): string {
  const out: string[] = []
  let line = ''
  const flush = () => {
    out.push(line)
    line = ''
  }
  const walk = (n: Node) => {
    if (n.nodeType === 3) {
      line += n.nodeValue ?? ''
      return
    }
    if (n.nodeType !== 1) return
    const el = n as Element
    if (el.tagName === 'BR') return flush()
    if (el.tagName === 'TD' || el.tagName === 'TH') {
      if (line) line += '\t'
    }
    const block = BLOCKS.has(el.tagName)
    if (block && line) flush()
    if (el.tagName === 'FIGURE' || el.hasAttribute('data-attachment')) {
      const name = el.getAttribute('data-name')
      if (name) line += name
    }
    if (el.tagName === 'LI' && el.getAttribute('data-type') === 'taskItem') {
      // Checklist items keep their text only.
    }
    el.childNodes.forEach(walk)
    if (block && line) flush()
  }
  walk(root)
  if (line) flush()
  return out
    .map((l) => l.replace(/ /g, ' ').replace(/\s+$/g, ''))
    .join('\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim()
}

export function tagsOf(text: string): string[] {
  const tags = new Set<string>()
  for (const m of text.matchAll(TAG_RE)) tags.add(m[2].replace(/[-/]+$/, ''))
  return [...tags]
}

export function derive(html: string): Derived {
  const doc = new DOMParser().parseFromString(`<body>${html}</body>`, 'text/html')
  const text = textOf(doc.body)
  const title = text.split('\n').find((l) => l.trim())?.trim().slice(0, 200) ?? ''
  const attachments: string[] = []
  let thumb: string | undefined
  doc.body.querySelectorAll('[data-att]').forEach((el) => {
    const id = el.getAttribute('data-att')!
    if (!attachments.includes(id)) attachments.push(id)
    const kind = el.getAttribute('data-kind')
    if (!thumb && (kind === 'image' || kind === 'sketch' || kind === 'scan')) thumb = id
  })
  doc.body.querySelectorAll('[data-strokes]').forEach((el) => {
    const id = el.getAttribute('data-strokes')!
    if (id && !attachments.includes(id)) attachments.push(id)
  })
  const hasChecklist = Boolean(doc.body.querySelector('ul[data-type="taskList"]'))
  return { title, text, tags: tagsOf(text), attachments, thumb, hasChecklist }
}

/** The preview line under a note's title in the list: the text after the title. */
export function snippetOf(text: string, title: string): string {
  const lines = text.split('\n').map((l) => l.trim()).filter(Boolean)
  const i = lines.findIndex((l) => l === title)
  const rest = (i >= 0 ? lines.slice(i + 1) : lines.slice(1)).join(' ')
  return rest.slice(0, 160)
}

export const escapeHtml = (s: string): string => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;')

/** Plain text (one paragraph per line) as note HTML, the first line as the title. */
export function textToHtml(text: string, firstIsTitle = true): string {
  const lines = text.replace(/\r\n?/g, '\n').split('\n')
  return lines
    .map((l, i) => {
      const body = escapeHtml(l) || ''
      if (i === 0 && firstIsTitle && l.trim()) return `<h1>${body}</h1>`
      return `<p>${body}</p>`
    })
    .join('')
}

/** Takes a Title (heading 1) at the very start of a note out of the body, as its title. */
export function splitTitle(html: string): { name: string; html: string } {
  const doc = new DOMParser().parseFromString(`<body>${html}</body>`, 'text/html')
  const first = doc.body.firstElementChild
  if (!first || first.tagName !== 'H1' || first.querySelector('img, figure')) return { name: '', html }
  const name = (first.textContent ?? '').replace(/\s+/g, ' ').trim()
  if (!name) return { name: '', html }
  first.remove()
  return { name: name.slice(0, 300), html: doc.body.innerHTML }
}

/** The note's title: its title field, else the first line of its body. */
export const titleFor = (name: string | undefined, derivedTitle: string): string => name?.trim() || derivedTitle
