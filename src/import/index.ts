import { strFromU8, unzipSync } from 'fflate'
import { base64ToBytes, mimeOf, putAttachment } from '../lib/attachments'
import { escapeHtml, textToHtml } from '../lib/content'
import { uid } from '../lib/defaults'
import { desktop } from '../lib/storage'
import { normalize, useStore } from '../lib/store'
import { attachmentStore } from '../lib/storage'
import type { AppData, Folder } from '../lib/types'
import { cleanName, emptyImport, makeFolder, makeNote, markdownToHtml, toNoteHtml, withTitle, type Imported, type Resolver } from './common'
import { md5 } from './md5'

// Importing from other notes apps. Each one's own export format:
//   Apple Notes      read straight from the Notes app on a Mac (with permission)
//   Samsung Notes    .sdocx files (text and pictures), or its Word / PDF / text exports
//   Notion           "Markdown & CSV" or "HTML" export (.zip)
//   Evernote         .enex
//   Excalidraw       .excalidraw (each an editable canvas)
//   Google Keep      Google Takeout (.zip, or the .json files)
//   Bear             .bear2bk backup, or .textbundle / Markdown exports
//   Simplenote       its export (.zip or notes.json)
//   Standard Notes   its decrypted backup (.json)
//   Obsidian & any Markdown, text, HTML, Word (.docx) or PDF files; a zip of them keeps its folders
//   Notes backups    (.notesbackup, from Settings → Export) restore everything

export type Progress = (text: string) => void

const ext = (name: string) => name.split('.').pop()?.toLowerCase() ?? ''

const time = (v: unknown): number | undefined => {
  if (v == null || v === '') return undefined
  if (typeof v === 'number') return v < 1e12 ? v * 1000 : v
  const t = Date.parse(String(v))
  return Number.isFinite(t) ? t : undefined
}

// ── Apple Notes ──────────────────────────────────────────────────────────────────────────────

export async function importAppleNotes(progress: Progress): Promise<Imported> {
  if (!desktop || desktop.platform !== 'darwin') throw new Error('Importing straight from Apple Notes works on a Mac. On Windows, export your notes on a Mac or iPhone first (as PDF, or with an app like Exporter as Markdown) and import those files.')
  progress('Reading Apple Notes… (allow access if your Mac asks)')
  const data = await desktop.appleNotes()
  const out = emptyImport()
  const root = makeFolder('Apple Notes')
  out.folders.push(root)
  const ids = new Map<string, string>()
  // Parents first.
  const pending = [...data.folders]
  for (let guard = 0; pending.length && guard < 1000; guard++) {
    const f = pending.shift()!
    if (f.parent && !ids.has(f.parent) && data.folders.some((x) => x.id === f.parent)) {
      pending.push(f)
      continue
    }
    const folder = makeFolder(f.name, f.parent ? ids.get(f.parent) : root.id)
    ids.set(f.id, folder.id)
    out.folders.push(folder)
  }
  let i = 0
  for (const n of data.notes) {
    progress(`Importing ${++i} of ${data.notes.length}…`)
    if (n.locked) {
      out.skipped.push(`“${n.name}” is locked in Apple Notes — unlock it there and import again`)
      continue
    }
    const html = await toNoteHtml(n.body)
    out.notes.push(makeNote({ html: withTitle(html, n.name), folderId: ids.get(n.folder) ?? root.id, created: n.created, updated: n.modified }))
  }
  return out
}

// ── Evernote ─────────────────────────────────────────────────────────────────────────────────

function enexDate(s: string | null | undefined): number | undefined {
  const m = s && /^(\d{4})(\d\d)(\d\d)T(\d\d)(\d\d)(\d\d)Z$/.exec(s.trim())
  return m ? Date.UTC(+m[1], +m[2] - 1, +m[3], +m[4], +m[5], +m[6]) : undefined
}

async function importEnex(text: string, name: string, progress: Progress): Promise<Imported> {
  const out = emptyImport()
  const folder = makeFolder(cleanName(name) || 'Evernote')
  out.folders.push(folder)
  const xml = new DOMParser().parseFromString(text, 'application/xml')
  const notes = [...xml.querySelectorAll('note')]
  let i = 0
  for (const note of notes) {
    progress(`Importing ${++i} of ${notes.length}…`)
    const title = note.querySelector('title')?.textContent ?? ''
    const resources = new Map<string, { id: string; mime: string; name: string; size: number }>()
    for (const r of note.querySelectorAll('resource')) {
      const b64 = r.querySelector('data')?.textContent ?? ''
      if (!b64) continue
      const bytes = base64ToBytes(b64)
      const mime = r.querySelector('mime')?.textContent ?? 'application/octet-stream'
      const fileName = r.querySelector('resource-attributes > file-name')?.textContent ?? ''
      resources.set(md5(bytes), { id: await putAttachment(bytes), mime, name: fileName, size: bytes.length })
    }
    const enml = note.querySelector('content')?.textContent ?? ''
    const doc = new DOMParser().parseFromString(enml.replace(/<\?xml[^>]*>|<!DOCTYPE[^>]*>/g, ''), 'text/html')
    const body = doc.querySelector('en-note') ?? doc.body
    // Parsed as HTML, <en-todo/> and <en-media/> aren't self-closing: they swallow the text after them.
    for (const el of [...body.querySelectorAll('en-todo, en-media')]) el.after(...el.childNodes)
    for (const media of [...body.querySelectorAll('en-media')]) {
      const r = resources.get(media.getAttribute('hash') ?? '')
      if (!r) {
        media.remove()
        continue
      }
      const fig = doc.createElement('figure')
      fig.setAttribute('data-attachment', '')
      fig.setAttribute('data-att', r.id)
      fig.setAttribute('data-kind', r.mime.startsWith('image/') ? 'image' : r.mime === 'application/pdf' ? 'pdf' : r.mime.startsWith('audio/') ? 'audio' : 'file')
      fig.setAttribute('data-mime', r.mime)
      if (r.name) fig.setAttribute('data-name', r.name)
      fig.setAttribute('data-size', String(r.size))
      const block = media.closest('div, p')
      if (block && block !== body && !block.textContent?.trim()) block.replaceWith(fig)
      else media.replaceWith(fig)
    }
    // Evernote to-dos: <div><en-todo checked="true"/>text</div> → checklist items.
    for (const todo of [...body.querySelectorAll('en-todo')]) {
      const line = (todo.closest('div, p, li') ?? todo.parentElement) as HTMLElement
      const ul = doc.createElement('ul')
      ul.setAttribute('data-type', 'taskList')
      const li = doc.createElement('li')
      li.setAttribute('data-type', 'taskItem')
      li.setAttribute('data-checked', String(todo.getAttribute('checked') === 'true'))
      todo.remove()
      const p = doc.createElement('p')
      p.innerHTML = line.innerHTML
      li.appendChild(p)
      ul.appendChild(li)
      const prev = line.previousElementSibling
      if (prev?.getAttribute('data-type') === 'taskList') {
        prev.appendChild(li)
        line.remove()
      } else line.replaceWith(ul)
    }
    const tags = [...note.querySelectorAll('tag')].map((t) => t.textContent ?? '')
    const html = await toNoteHtml(body.innerHTML)
    out.notes.push(makeNote({ html: withTitle(html, title), folderId: folder.id, created: enexDate(note.querySelector('created')?.textContent), updated: enexDate(note.querySelector('updated')?.textContent), tags }))
  }
  return out
}

// ── Google Keep ──────────────────────────────────────────────────────────────────────────────

interface KeepNote {
  title?: string
  textContent?: string
  textContentHtml?: string
  listContent?: Array<{ text: string; isChecked: boolean }>
  labels?: Array<{ name: string }>
  attachments?: Array<{ filePath: string; mimetype: string }>
  annotations?: Array<{ url?: string; title?: string }>
  isTrashed?: boolean
  isPinned?: boolean
  isArchived?: boolean
  createdTimestampUsec?: number
  userEditedTimestampUsec?: number
}

const isKeep = (j: unknown): j is KeepNote => typeof j === 'object' && j !== null && ('textContent' in j || 'listContent' in j) && 'userEditedTimestampUsec' in j

async function keepNote(k: KeepNote, folderId: string, resolve: Resolver): Promise<ReturnType<typeof makeNote> | null> {
  if (k.isTrashed) return null
  let html = k.title ? `<h1>${escapeHtml(k.title)}</h1>` : ''
  if (k.textContentHtml) html += k.textContentHtml
  else if (k.textContent) html += textToHtml(k.textContent, !k.title)
  if (k.listContent?.length) html += `<ul data-type="taskList">${k.listContent.map((i) => `<li data-type="taskItem" data-checked="${i.isChecked}"><p>${escapeHtml(i.text)}</p></li>`).join('')}</ul>`
  for (const a of k.annotations ?? []) if (a.url) html += `<p><a href="${escapeHtml(a.url)}">${escapeHtml(a.title || a.url)}</a></p>`
  for (const a of k.attachments ?? []) html += `<p><img src="${escapeHtml(a.filePath)}"></p>`
  html = await toNoteHtml(html, resolve)
  const tags = [...(k.labels ?? []).map((l) => l.name), ...(k.isArchived ? ['archived'] : [])]
  return makeNote({ html, folderId, created: k.createdTimestampUsec ? k.createdTimestampUsec / 1000 : undefined, updated: k.userEditedTimestampUsec ? k.userEditedTimestampUsec / 1000 : undefined, pinned: k.isPinned, tags })
}

// ── Zips: Keep (Takeout), Notion, Bear, Obsidian, Simplenote, Samsung, backups ───────────────

type Files = Record<string, Uint8Array>

function resolverFor(files: Files, base: string): Resolver {
  const lower = new Map(Object.keys(files).map((k) => [k.toLowerCase(), k]))
  return async (src) => {
    const clean = src.replace(/^\.\//, '').split(/[?#]/)[0]
    const parts = [...base.split('/').filter(Boolean), ...clean.split('/')]
    const stack: string[] = []
    for (const p of parts) {
      if (p === '..') stack.pop()
      else if (p && p !== '.') stack.push(p)
    }
    const path = stack.join('/')
    const key = files[path] ? path : (lower.get(path.toLowerCase()) ?? [...lower.entries()].find(([k]) => k.endsWith(`/${clean.toLowerCase()}`))?.[1])
    if (!key) return null
    const name = key.split('/').pop()!
    return { data: files[key], name, mime: mimeOf(name) }
  }
}

const dirOf = (p: string) => p.split('/').slice(0, -1).join('/')

async function importBackup(files: Files): Promise<AppData> {
  const data = normalize(JSON.parse(strFromU8(files['notes.json'])) as Partial<AppData>)
  for (const [k, v] of Object.entries(files)) if (k.startsWith('attachments/')) await attachmentStore.put(k.slice(12), v)
  return data
}

/** A note from one Markdown/HTML/text file. */
async function fileNote(path: string, data: Uint8Array, folderId: string, resolve?: Resolver, modified?: number) {
  const name = path.split('/').pop()!
  const e = ext(name)
  const text = strFromU8(data)
  let html: string
  if (e === 'html' || e === 'htm') {
    const doc = new DOMParser().parseFromString(text, 'text/html')
    // Notion's HTML pages: the content is in .page-body, the title in h1.page-title.
    const body = doc.querySelector('.page-body') ?? doc.body
    const title = doc.querySelector('h1.page-title')?.textContent ?? doc.title
    html = withTitle(await toNoteHtml(body.innerHTML, resolve), title || cleanName(name))
  } else if (e === 'txt') {
    html = await toNoteHtml(textToHtml(text))
  } else {
    // Markdown, with Obsidian/Bear front matter dropped and [[wiki links]] kept as text.
    const md = text.replace(/^---\n[\s\S]*?\n---\n/, '').replace(/!\[\[([^\]|]+)(\|[^\]]*)?\]\]/g, (_m, f) => `![](${encodeURI(f)})`).replace(/\[\[([^\]|]+)\|?([^\]]*)\]\]/g, (_m, a, b) => b || a)
    html = withTitle(await toNoteHtml(markdownToHtml(md), resolve), cleanName(name))
  }
  return makeNote({ html, folderId, created: modified, updated: modified })
}

/** Samsung Notes' .sdocx: a zip whose note text is UTF-16 inside a binary file, with pictures in media/. */
async function importSdocx(files: Files, name: string): Promise<{ html: string; created?: number }> {
  const strings: string[] = []
  for (const [k, v] of Object.entries(files)) {
    if (!/\.note$|note\.note|\/text|pageInfo/i.test(k) && !k.endsWith('.note')) continue
    let run = ''
    for (let i = 0; i + 1 < v.length; i += 2) {
      const c = v[i] | (v[i + 1] << 8)
      if ((c >= 32 && c < 0xd800) || c === 10 || c === 13 || c === 9) run += String.fromCharCode(c)
      else {
        if (run.trim().length >= 2) strings.push(run)
        run = ''
      }
    }
    if (run.trim().length >= 2) strings.push(run)
  }
  const text = strings
    .map((s) => s.replace(/\r/g, '\n'))
    .filter((s) => /[\p{L}\p{N}]/u.test(s) && !/^[A-Za-z0-9+/=_.-]{16,}$/.test(s.trim()))
    .join('\n')
  let html = textToHtml(text.trim() || cleanName(name.replace(/\.sdocx$/i, '')))
  for (const [k, v] of Object.entries(files)) {
    if (!/^media\//i.test(k) || !/\.(png|jpe?g|gif|webp)$/i.test(k)) continue
    const id = await putAttachment(v)
    html += `<figure data-attachment data-att="${id}" data-kind="image" data-mime="${mimeOf(k)}"></figure>`
  }
  return { html }
}

async function importZip(files: Files, zipName: string, progress: Progress): Promise<Imported | AppData> {
  const names = Object.keys(files).filter((n) => !n.startsWith('__MACOSX/') && !n.split('/').pop()!.startsWith('.'))
  if (files['notes.json'] && names.some((n) => n.startsWith('attachments/') || n === 'notes.json')) {
    const raw = JSON.parse(strFromU8(files['notes.json']))
    if (raw && Array.isArray(raw.notes) && raw.settings) return importBackup(files)
  }
  const out = emptyImport()

  // Simplenote.
  const simple = names.find((n) => /(^|\/)notes\.json$/.test(n))
  if (simple) {
    const j = JSON.parse(strFromU8(files[simple]))
    if (j && Array.isArray(j.activeNotes)) return importSimplenote(j)
  }

  // Google Keep (Takeout).
  const keepJson = names.filter((n) => /Keep\/[^/]+\.json$/i.test(n) || (n.endsWith('.json') && !n.includes('/')))
  const keep = keepJson.filter((n) => {
    try {
      return isKeep(JSON.parse(strFromU8(files[n])))
    } catch {
      return false
    }
  })
  if (keep.length) {
    const folder = makeFolder('Google Keep')
    out.folders.push(folder)
    let i = 0
    for (const n of keep) {
      progress(`Importing ${++i} of ${keep.length}…`)
      const note = await keepNote(JSON.parse(strFromU8(files[n])), folder.id, resolverFor(files, dirOf(n)))
      if (note) out.notes.push(note)
    }
    return out
  }

  // Samsung Notes files inside a zip.
  const sdocx = names.filter((n) => n.toLowerCase().endsWith('.sdocx'))
  if (sdocx.length) {
    const folder = makeFolder('Samsung Notes')
    out.folders.push(folder)
    for (const n of sdocx) {
      const { html } = await importSdocx(unzipSync(files[n]), n)
      out.notes.push(makeNote({ html: await toNoteHtml(html), folderId: folder.id }))
    }
    return out
  }

  // Bear's .textbundle folders; then Notion, Obsidian and any folder of Markdown/HTML/text files.
  const bundles = [...new Set(names.filter((n) => /\.textbundle\//i.test(n)).map((n) => n.slice(0, n.toLowerCase().indexOf('.textbundle/') + 11)))]
  const docs = names.filter((n) => /\.(md|markdown|txt|html?)$/i.test(n) && !/\.textbundle\//i.test(n) && !/(^|\/)index\.html$/i.test(n))
  const rootName = cleanName(zipName.replace(/\.(zip|bear2bk)$/i, '')) || 'Imported'
  const root = makeFolder(bundles.length ? 'Bear' : /notion|export-/i.test(zipName) || docs.some((d) => /[0-9a-f]{32}/i.test(d)) ? 'Notion' : rootName)
  out.folders.push(root)
  const folders = new Map<string, Folder>([['', root]])
  const folderFor = (dir: string): string => {
    if (folders.has(dir)) return folders.get(dir)!.id
    const parent = folderFor(dirOf(dir))
    const f = makeFolder(cleanName(dir.split('/').pop()!), parent)
    folders.set(dir, f)
    out.folders.push(f)
    return f.id
  }
  let i = 0
  const total = bundles.length + docs.length
  for (const b of bundles) {
    progress(`Importing ${++i} of ${total}…`)
    const textFile = names.find((n) => n.startsWith(b) && /\/text\.(md|markdown|txt)$/i.test(n))
    if (!textFile) continue
    const note = await fileNote(textFile, files[textFile], root.id, resolverFor(files, b))
    out.notes.push(note)
  }
  // Notion nests a page's subpages in a folder named like the page: keep one shared top folder.
  const prefix = docs.length && docs.every((d) => d.split('/')[0] === docs[0].split('/')[0] && d.includes('/')) ? `${docs[0].split('/')[0]}/` : ''
  for (const d of docs) {
    progress(`Importing ${++i} of ${total}…`)
    const rel = d.slice(prefix.length)
    out.notes.push(await fileNote(rel, files[d], folderFor(dirOf(rel)), resolverFor(files, dirOf(d))))
  }
  if (!out.notes.length) out.skipped.push(`${zipName}: no notes found in it`)
  return out
}

function importSimplenote(j: { activeNotes: Array<{ content: string; creationDate?: string; lastModified?: string; tags?: string[]; pinned?: boolean; markdown?: boolean }> }): Promise<Imported> {
  const out = emptyImport()
  const folder = makeFolder('Simplenote')
  out.folders.push(folder)
  return (async () => {
    for (const n of j.activeNotes) {
      const html = await toNoteHtml(n.markdown ? markdownToHtml(n.content) : textToHtml(n.content))
      out.notes.push(makeNote({ html: withTitle(html, ''), folderId: folder.id, created: time(n.creationDate), updated: time(n.lastModified), tags: n.tags, pinned: n.pinned }))
    }
    return out
  })()
}

async function importJson(text: string, name: string, progress: Progress): Promise<Imported | AppData> {
  const j = JSON.parse(text)
  if (j && Array.isArray(j.notes) && j.settings) return normalize(j)
  if (j && Array.isArray(j.activeNotes)) return importSimplenote(j)
  if (isKeep(j)) {
    const out = emptyImport()
    const folder = makeFolder('Google Keep')
    out.folders.push(folder)
    const n = await keepNote(j, folder.id, async () => null)
    if (n) out.notes.push(n)
    return out
  }
  // Standard Notes' decrypted backup.
  if (j && Array.isArray(j.items)) {
    const out = emptyImport()
    const folder = makeFolder('Standard Notes')
    out.folders.push(folder)
    const items = j.items.filter((i: { content_type?: string; deleted?: boolean }) => i.content_type === 'Note' && !i.deleted)
    let i = 0
    for (const it of items) {
      progress(`Importing ${++i} of ${items.length}…`)
      const c = it.content ?? {}
      out.notes.push(makeNote({ html: withTitle(await toNoteHtml(markdownToHtml(c.text ?? '')), c.title ?? ''), folderId: folder.id, created: time(it.created_at), updated: time(it.updated_at), pinned: c.appData?.['org.standardnotes.sn']?.pinned }))
    }
    return out
  }
  throw new Error(`${name}: Notes doesn’t recognise this file`)
}

/** Imports files (and zips of files) from other apps. Returns what was imported, or a whole backup to restore. */
export async function importFiles(files: File[], progress: Progress): Promise<Imported | AppData> {
  const out = emptyImport()
  const loose = makeFolder('Imported')
  const add = (r: Imported) => {
    out.folders.push(...r.folders)
    out.notes.push(...r.notes)
    out.skipped.push(...r.skipped)
  }
  let i = 0
  for (const file of files) {
    i++
    const e = ext(file.name)
    progress(files.length > 1 ? `Reading ${file.name} (${i} of ${files.length})…` : `Reading ${file.name}…`)
    try {
      const bytes = new Uint8Array(await file.arrayBuffer())
      if (e === 'zip' || e === 'bear2bk' || e === 'notesbackup') {
        const r = await importZip(unzipSync(bytes), file.name, progress)
        if ('settings' in r) return r
        add(r)
      } else if (e === 'enex') add(await importEnex(strFromU8(bytes), file.name, progress))
      else if (e === 'json' && !/\.excalidraw\.json$/i.test(file.name)) {
        const r = await importJson(strFromU8(bytes), file.name, progress)
        if ('settings' in r) return r
        add(r)
      } else if (e === 'sdocx') {
        const { html } = await importSdocx(unzipSync(bytes), file.name)
        out.notes.push(makeNote({ html: await toNoteHtml(html), folderId: loose.id, updated: file.lastModified }))
      } else if (e === 'docx') {
        const mammoth = await import('mammoth')
        const { value } = await mammoth.convertToHtml({ arrayBuffer: bytes.buffer as ArrayBuffer })
        out.notes.push(makeNote({ html: withTitle(await toNoteHtml(value), cleanName(file.name.replace(/\.docx$/i, ''))), folderId: loose.id, updated: file.lastModified }))
      } else if (e === 'pdf') {
        const { extractText, getDocumentProxy } = await import('unpdf')
        const pdf = await getDocumentProxy(new Uint8Array(bytes))
        const { text } = await extractText(pdf, { mergePages: false })
        const pages = (Array.isArray(text) ? text : [text]).map((t) => t.trim()).filter(Boolean)
        const id = await putAttachment(bytes)
        const title = cleanName(file.name.replace(/\.pdf$/i, ''))
        const body = pages.map((p) => textToHtml(p, false)).join('<p></p>')
        const html = `<h1>${escapeHtml(title)}</h1><figure data-attachment data-att="${id}" data-kind="pdf" data-mime="application/pdf" data-name="${escapeHtml(file.name)}" data-size="${bytes.length}"></figure>${body}`
        out.notes.push(makeNote({ html: await toNoteHtml(html), folderId: loose.id, updated: file.lastModified }))
      } else if (e === 'excalidraw' || /\.excalidraw\.json$/i.test(file.name)) {
        const { excalidrawToHtml } = await import('../canvas/import')
        const title = cleanName(file.name.replace(/\.excalidraw(\.json)?$/i, ''))
        out.notes.push(makeNote({ html: await excalidrawToHtml(strFromU8(bytes), title), folderId: loose.id, updated: file.lastModified }))
      } else if (['md', 'markdown', 'txt', 'html', 'htm'].includes(e)) {
        out.notes.push(await fileNote(file.name, bytes, loose.id, undefined, file.lastModified))
      } else if (e === 'textbundle') {
        out.skipped.push(`${file.name}: zip the .textbundle folder first, then import the .zip`)
      } else out.skipped.push(`${file.name}: not a format Notes can import`)
    } catch (err) {
      out.skipped.push(`${file.name}: ${(err as Error).message}`)
    }
  }
  if (out.notes.some((n) => n.folderId === loose.id)) out.folders.push(loose)
  return out
}

/** Adds what was imported to your notes. */
export function applyImport(r: Imported): number {
  // Folders keep their new ids; make sure each is unique.
  const seen = new Set(useStore.getState().folders.map((f) => f.id))
  for (const f of r.folders) if (seen.has(f.id)) f.id = uid()
  useStore.getState().addImported(r.folders, r.notes)
  return r.notes.length
}
