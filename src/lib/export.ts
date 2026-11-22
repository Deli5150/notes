import { strToU8, zipSync } from 'fflate'
import TurndownService from 'turndown'
import { attachmentBytes, bytesToBase64, mimeOf } from './attachments'
import { escapeHtml } from './content'
import { openLocked } from './lock'
import { desktop, saveFileAs } from './storage'
import { exportData, useStore } from './store'
import type { Folder, Note } from './types'

// Sending notes out of Notes: one note as PDF, Markdown, HTML or plain text, printing, and the
// whole library as a folder of Markdown files or a full backup (restorable in Settings → Import).

const safeName = (s: string) => (s || 'New Note').replace(/[\\/:*?"<>|\n\r\t]+/g, ' ').trim().slice(0, 80) || 'Note'

const EXT: Record<string, string> = { 'image/png': 'png', 'image/jpeg': 'jpg', 'image/gif': 'gif', 'image/webp': 'webp', 'image/svg+xml': 'svg', 'audio/webm': 'webm', 'audio/mp4': 'm4a', 'audio/mpeg': 'mp3', 'application/pdf': 'pdf', 'video/mp4': 'mp4' }

async function contentOf(note: Note): Promise<string> {
  const body = note.locked ? ((await openLocked(note.id))?.html ?? '') : note.html
  // The title field goes at the top, as the document's heading.
  return note.name?.trim() ? `<h1>${escapeHtml(note.name.trim())}</h1>${body}` : body
}

/** The note's HTML with attachments turned into something other apps understand. */
async function portableHtml(html: string, assets: 'inline' | ((id: string, name: string, mime: string) => string)): Promise<string> {
  const doc = new DOMParser().parseFromString(`<body>${html}</body>`, 'text/html')
  for (const fig of [...doc.body.querySelectorAll('figure[data-attachment]')]) {
    const id = fig.getAttribute('data-att')
    const kind = fig.getAttribute('data-kind') ?? 'file'
    const name = fig.getAttribute('data-name') ?? ''
    const mime = fig.getAttribute('data-mime') || mimeOf(name)
    if (kind === 'link') {
      const a = doc.createElement('p')
      a.innerHTML = `<a href="${escapeHtml(fig.getAttribute('data-src') ?? '')}">${escapeHtml(fig.getAttribute('data-title') || fig.getAttribute('data-src') || '')}</a>`
      fig.replaceWith(a)
      continue
    }
    let src = fig.getAttribute('data-src') ?? ''
    if (id) {
      if (assets === 'inline') {
        const bytes = await attachmentBytes(id)
        if (bytes) src = `data:${mime};base64,${bytesToBase64(bytes)}`
      } else src = assets(id, name, mime)
    }
    let el: HTMLElement
    if (kind === 'image' || kind === 'sketch' || kind === 'scan') {
      el = doc.createElement('img')
      el.setAttribute('src', src)
      el.setAttribute('alt', name)
      if (fig.getAttribute('data-width') === 'small') el.setAttribute('width', '240')
    } else if (kind === 'audio') {
      el = doc.createElement('audio')
      el.setAttribute('controls', '')
      el.setAttribute('src', src)
    } else if (kind === 'video') {
      el = doc.createElement('video')
      el.setAttribute('controls', '')
      el.setAttribute('src', src)
    } else {
      el = doc.createElement('a')
      el.setAttribute('href', src)
      el.textContent = `📎 ${name || 'Attachment'}`
    }
    const p = doc.createElement('p')
    p.appendChild(el)
    fig.replaceWith(p)
  }
  doc.body.querySelectorAll('ul[data-type="taskList"] > li').forEach((li) => {
    const checked = li.getAttribute('data-checked') === 'true'
    li.insertAdjacentHTML('afterbegin', `<input type="checkbox" disabled${checked ? ' checked' : ''}> `)
  })
  return doc.body.innerHTML
}

const PRINT_CSS = `
  body { font: 15px/1.5 -apple-system, "Segoe UI", system-ui, sans-serif; color: #1d1d1f; max-width: 760px; margin: 32px auto; padding: 0 24px; }
  h1 { font-size: 28px; margin: .2em 0 .4em } h2 { font-size: 22px } h3 { font-size: 18px }
  pre, code { font-family: ui-monospace, Menlo, Consolas, monospace; } pre { background: #f4f4f5; padding: 12px; border-radius: 8px; white-space: pre-wrap }
  blockquote { border-left: 3px solid #d1d1d6; margin: 0; padding-left: 14px; color: #555 }
  img { max-width: 100%; border-radius: 6px } table { border-collapse: collapse } td, th { border: 1px solid #d1d1d6; padding: 6px 10px; vertical-align: top }
  ul[data-type="taskList"] { list-style: none; padding-left: 4px } ul[data-type="taskList"] li > p { display: inline }
  ul[data-type="dashed"] { list-style: none; padding-left: 20px } ul[data-type="dashed"] > li::before { content: "–"; margin-left: -16px; position: absolute }
  mark { background: #fff3a3; border-radius: 3px; padding: 0 2px }
  mark[data-color="purple"] { background: #eadcff; color: #6d28d9 } mark[data-color="pink"] { background: #ffdbe7; color: #be185d }
  mark[data-color="orange"] { background: #ffe5cc; color: #c2410c } mark[data-color="mint"] { background: #d3f5ea; color: #047857 } mark[data-color="blue"] { background: #d9e9ff; color: #1d4ed8 }
`

export async function noteAsHtmlDocument(note: Note): Promise<string> {
  const body = await portableHtml(await contentOf(note), 'inline')
  return `<!doctype html><html><head><meta charset="utf-8"><title>${escapeHtml(note.title || 'New Note')}</title><style>${PRINT_CSS}</style></head><body>${body}</body></html>`
}

function turndown(): TurndownService {
  const td = new TurndownService({ headingStyle: 'atx', codeBlockStyle: 'fenced', bulletListMarker: '-', emDelimiter: '*' })
  td.addRule('task', {
    filter: (node) => node.nodeName === 'LI' && node.parentElement?.getAttribute('data-type') === 'taskList',
    replacement: (content, node) => `- [${(node as Element).getAttribute('data-checked') === 'true' ? 'x' : ' '}] ${content.replace(/^\s*\[[ x]\]\s*/, '').trim()}\n`
  })
  td.addRule('checkboxInput', { filter: (node) => node.nodeName === 'INPUT', replacement: () => '' })
  td.addRule('strike', { filter: ['s', 'del'], replacement: (c) => `~~${c}~~` })
  td.addRule('mark', { filter: ['mark'], replacement: (c) => `==${c}==` })
  td.addRule('underline', { filter: ['u'], replacement: (c) => `<u>${c}</u>` })
  td.keep(['table', 'audio', 'video'])
  return td
}

export async function noteAsMarkdown(note: Note, assets: 'inline' | ((id: string, name: string, mime: string) => string) = 'inline'): Promise<string> {
  return turndown().turndown(await portableHtml(await contentOf(note), assets))
}

export type ExportFormat = 'pdf' | 'markdown' | 'html' | 'text'

export async function exportNote(note: Note, format: ExportFormat): Promise<boolean> {
  const name = safeName(note.title)
  if (format === 'pdf') {
    const html = await noteAsHtmlDocument(note)
    if (desktop) return desktop.savePdf(`${name}.pdf`, html)
    const w = window.open('', '_blank')
    w?.document.write(html)
    w?.print()
    return true
  }
  if (format === 'html') return saveFileAs(`${name}.html`, await noteAsHtmlDocument(note), 'text/html')
  if (format === 'text') {
    const text = note.locked ? ((await openLocked(note.id))?.text ?? '') : note.text
    return saveFileAs(`${name}.txt`, text, 'text/plain')
  }
  // Markdown: a .md file, or a .zip with the pictures beside it.
  const files: Record<string, string> = {}
  const md = await noteAsMarkdown(note, (id, n, mime) => {
    const file = `attachments/${id.slice(0, 12)}${n ? `-${safeName(n).replace(/\.[^.]+$/, '')}` : ''}.${EXT[mime] ?? n.split('.').pop() ?? 'bin'}`
    files[file] = id
    return file.replace(/ /g, '%20')
  })
  if (!Object.keys(files).length) return saveFileAs(`${name}.md`, md, 'text/markdown')
  const zip: Record<string, Uint8Array> = { [`${name}.md`]: strToU8(md) }
  for (const [file, id] of Object.entries(files)) zip[file] = (await attachmentBytes(id)) ?? new Uint8Array()
  return saveFileAs(`${name}.zip`, zipSync(zip), 'application/zip')
}

export async function printNote(note: Note): Promise<void> {
  const html = await noteAsHtmlDocument(note)
  if (desktop) return desktop.print(html)
  const w = window.open('', '_blank')
  w?.document.write(html)
  w?.print()
}

export async function copyNote(note: Note): Promise<void> {
  const html = await portableHtml(await contentOf(note), 'inline')
  const text = note.locked ? ((await openLocked(note.id))?.text ?? '') : note.text
  await navigator.clipboard.write([new ClipboardItem({ 'text/html': new Blob([html], { type: 'text/html' }), 'text/plain': new Blob([text], { type: 'text/plain' }) })])
}

function folderPath(folders: Folder[], id: string): string {
  const parts: string[] = []
  let f = folders.find((x) => x.id === id)
  while (f) {
    parts.unshift(safeName(f.name))
    f = f.parentId ? folders.find((x) => x.id === f!.parentId) : undefined
  }
  return parts.join('/')
}

/** Every note as Markdown in folders (a .zip), with attachments. Locked notes are left out unless open. */
export async function exportAllMarkdown(): Promise<boolean> {
  const { notes, folders } = useStore.getState()
  const files: Record<string, Uint8Array> = {}
  const used = new Set<string>()
  for (const n of notes.filter((x) => !x.deletedAt)) {
    if (n.locked && !(await openLocked(n.id))) continue
    const dir = folderPath(folders, n.folderId) || 'Notes'
    let base = `${dir}/${safeName(n.title)}`
    for (let i = 2; used.has(base); i++) base = `${dir}/${safeName(n.title)} ${i}`
    used.add(base)
    const md = await noteAsMarkdown(n, (id, name, mime) => {
      const file = `attachments/${id}.${EXT[mime] ?? name.split('.').pop() ?? 'bin'}`
      files[file] ??= new Uint8Array()
      return `${'../'.repeat(dir.split('/').length)}${file}`
    })
    files[`${base}.md`] = strToU8(md)
  }
  for (const file of Object.keys(files).filter((f) => f.startsWith('attachments/'))) {
    const id = file.slice(12).split('.')[0]
    files[file] = (await attachmentBytes(id)) ?? new Uint8Array()
  }
  return saveFileAs(`Notes ${new Date().toISOString().slice(0, 10)}.zip`, zipSync(files), 'application/zip')
}

/** A full backup: the data file and every attachment, restorable in Settings → Import. */
export async function exportBackup(): Promise<boolean> {
  const data = exportData()
  const files: Record<string, Uint8Array> = { 'notes.json': strToU8(JSON.stringify(data)) }
  const ids = new Set(data.notes.flatMap((n) => n.attachments))
  for (const id of ids) {
    const bytes = await attachmentBytes(id)
    if (bytes) files[`attachments/${id}`] = bytes
  }
  return saveFileAs(`Notes Backup ${new Date().toISOString().slice(0, 10)}.notesbackup`, zipSync(files, { level: 1 }), 'application/zip')
}
