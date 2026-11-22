import { generateHTML, generateJSON } from '@tiptap/core'
import { marked } from 'marked'
import { mimeOf, putAttachment, putDataUrl } from '../lib/attachments'
import { derive, escapeHtml, splitTitle } from '../lib/content'
import { uid } from '../lib/defaults'
import { DEFAULT_FOLDER, type Folder, type Note } from '../lib/types'

// What every importer shares: turning other apps' HTML and Markdown into Notes' own, saving their
// pictures and files as attachments, and making the notes and folders.

export interface Imported {
  folders: Folder[]
  notes: Note[]
  /** Things that couldn't be brought over, to tell the person. */
  skipped: string[]
}

export const emptyImport = (): Imported => ({ folders: [], notes: [], skipped: [] })

export type Resolver = (src: string) => Promise<{ data: Uint8Array; name?: string; mime?: string } | null>

let schemaExtensions: ReturnType<typeof import('../editor/setup').noteExtensions> | null = null
async function extensions() {
  if (!schemaExtensions) schemaExtensions = (await import('../editor/setup')).noteExtensions()
  return schemaExtensions
}

/** Rewrites other apps' checklists (Markdown task lists, Evernote to-dos, Notion) as Notes checklists. */
function checklists(doc: Document): void {
  doc.querySelectorAll('ul').forEach((ul) => {
    const items = [...ul.children].filter((c) => c.tagName === 'LI')
    const boxes = items.map((li) => li.querySelector(':scope > input[type="checkbox"], :scope > p > input[type="checkbox"]'))
    if (!items.length || boxes.some((b) => !b)) return
    ul.setAttribute('data-type', 'taskList')
    items.forEach((li, i) => {
      const box = boxes[i] as HTMLInputElement
      li.setAttribute('data-type', 'taskItem')
      li.setAttribute('data-checked', String(box.checked || box.hasAttribute('checked')))
      box.remove()
      if (!li.querySelector(':scope > p')) {
        const p = doc.createElement('p')
        while (li.firstChild && !(li.firstChild.nodeType === 1 && ['UL', 'OL'].includes((li.firstChild as Element).tagName))) p.appendChild(li.firstChild)
        li.prepend(p)
      }
    })
  })
}

/**
 * Turns HTML from anywhere into a note's HTML: pictures and files saved as attachments (found by
 * `resolve` for relative paths), checklists converted, and everything else run through the
 * editor's schema so it opens exactly as saved.
 */
export async function toNoteHtml(html: string, resolve?: Resolver): Promise<string> {
  const doc = new DOMParser().parseFromString(`<body>${html}</body>`, 'text/html')
  doc.querySelectorAll('script, style, meta, link, title, head').forEach((el) => el.remove())
  checklists(doc)
  for (const img of [...doc.querySelectorAll('img')]) {
    const src = img.getAttribute('src') ?? ''
    let att: { id: string; mime: string; name?: string; size?: number } | null = null
    if (src.startsWith('data:')) att = await putDataUrl(src)
    else if (resolve && src && !/^https?:/i.test(src)) {
      const got = await resolve(decodeURIComponent(src)).catch(() => null)
      if (got) att = { id: await putAttachment(got.data), mime: got.mime ?? mimeOf(got.name ?? src, 'image/png'), name: got.name, size: got.data.length }
    }
    if (!att) continue
    const fig = doc.createElement('figure')
    fig.setAttribute('data-attachment', '')
    fig.setAttribute('data-att', att.id)
    fig.setAttribute('data-kind', 'image')
    fig.setAttribute('data-mime', att.mime)
    if (att.name) fig.setAttribute('data-name', att.name)
    // Pictures can't sit inside a paragraph: put it after the paragraph it was in.
    const block = img.closest('p, li, h1, h2, h3, h4, h5, h6, td, th, blockquote') as HTMLElement | null
    if (block && !['TD', 'TH', 'LI', 'BLOCKQUOTE'].includes(block.tagName)) {
      block.after(fig)
      img.remove()
    } else img.replaceWith(fig)
  }
  // Links to files in the export (PDFs and the like) become attachments too.
  if (resolve) {
    for (const a of [...doc.querySelectorAll('a[href]')]) {
      const href = a.getAttribute('href') ?? ''
      if (/^([a-z]+:|#)/i.test(href) || /\.(md|html?)$/i.test(href)) continue
      const got = await resolve(decodeURIComponent(href)).catch(() => null)
      if (!got) continue
      const name = got.name ?? href.split('/').pop() ?? 'File'
      const mime = got.mime ?? mimeOf(name)
      const fig = doc.createElement('figure')
      fig.setAttribute('data-attachment', '')
      fig.setAttribute('data-att', await putAttachment(got.data))
      fig.setAttribute('data-kind', mime.startsWith('image/') ? 'image' : mime === 'application/pdf' ? 'pdf' : mime.startsWith('audio/') ? 'audio' : 'file')
      fig.setAttribute('data-mime', mime)
      fig.setAttribute('data-name', name)
      fig.setAttribute('data-size', String(got.data.length))
      const block = a.closest('p, li, h1, h2, h3') as HTMLElement | null
      if (block?.tagName === 'P' && block.textContent?.trim() === a.textContent?.trim()) block.replaceWith(fig)
      else {
        ;(block ?? a).after(fig)
        a.remove()
      }
    }
  }
  const ext = await extensions()
  try {
    return generateHTML(generateJSON(doc.body.innerHTML, ext), ext)
  } catch {
    return doc.body.innerHTML
  }
}

/** Markdown (with task lists, tables and ==highlights==) as HTML. */
export function markdownToHtml(md: string): string {
  const html = marked.parse(md.replace(/==([^=\n]+)==/g, '<mark>$1</mark>'), { gfm: true, breaks: false, async: false }) as string
  return html
}

/** A note's first line as a Title (if it isn't a heading already). */
export function withTitle(html: string, title: string): string {
  const doc = new DOMParser().parseFromString(`<body>${html}</body>`, 'text/html')
  const first = doc.body.firstElementChild
  const text = first?.textContent?.trim() ?? ''
  if (first && /^H[1-3]$/.test(first.tagName) && text) {
    if (first.tagName !== 'H1' && text === title.trim()) {
      const h1 = doc.createElement('h1')
      h1.innerHTML = first.innerHTML
      first.replaceWith(h1)
    }
    return doc.body.innerHTML
  }
  if (title && text !== title.trim()) return `<h1>${escapeHtml(title)}</h1>${html}`
  if (first && text) {
    const h1 = doc.createElement('h1')
    h1.innerHTML = first.innerHTML
    first.replaceWith(h1)
  }
  return doc.body.innerHTML
}

export function makeNote(p: { html: string; folderId?: string; created?: number; updated?: number; pinned?: boolean; tags?: string[] }): Note {
  let html = p.html
  // Tags from the other app (labels, Evernote tags) become #tags at the end.
  const d0 = derive(html)
  const extra = (p.tags ?? []).map((t) => t.trim().replace(/\s+/g, '-').replace(/^#/, '')).filter((t) => t && !d0.tags.some((x) => x.toLowerCase() === t.toLowerCase()))
  if (extra.length) html += `<p>${extra.map((t) => `#${escapeHtml(t)}`).join(' ')}</p>`
  // The note's first heading becomes its title field.
  const split = splitTitle(html)
  html = split.html
  const d = derive(html)
  const now = Date.now()
  const created = p.created && Number.isFinite(p.created) ? p.created : now
  return {
    id: uid(),
    folderId: p.folderId ?? DEFAULT_FOLDER,
    html,
    ...d,
    name: split.name,
    title: split.name || d.title,
    createdAt: created,
    updatedAt: p.updated && Number.isFinite(p.updated) ? p.updated : created,
    pinned: Boolean(p.pinned)
  }
}

export function makeFolder(name: string, parentId?: string): Folder {
  return { id: uid(), name: name.trim() || 'Imported', parentId, createdAt: Date.now(), order: Date.now() }
}

/** "Meeting notes 3f2a…(32 hex)" → "Meeting notes": Notion puts ids in file names. */
export const cleanName = (name: string): string =>
  name
    .replace(/\.(md|markdown|txt|html?|enex|json|zip|docx|pdf|sdocx)$/i, '')
    .replace(/\s+[0-9a-f]{32}$/i, '')
    .replace(/\s+[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i, '')
    .trim()
