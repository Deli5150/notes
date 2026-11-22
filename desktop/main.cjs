const { app, BrowserWindow, dialog, globalShortcut, ipcMain, Menu, nativeTheme, net, protocol, safeStorage, session, shell, systemPreferences } = require('electron')
const { execFile } = require('node:child_process')
const fs = require('node:fs')
const os = require('node:os')
const path = require('node:path')
const { pathToFileURL } = require('node:url')
const updater = require('./updater.cjs')
const google = require('./google.cjs')
const ai = require('./ai.cjs')
const { version } = require('./package.json')

// Notes' desktop shell: the app's web build (web/, from `vite build`) served over app://, its data
// in a JSON file, attachments as files served over att://, the menu bar, Apple Notes import (Mac),
// link previews, PDF export and printing, Touch ID for locked notes, and the updater.

const WEB = path.join(__dirname, 'web')
const DATA = () => path.join(app.getPath('userData'), 'notes.json')
const ATTACHMENTS = () => path.join(app.getPath('userData'), 'attachments')
const TOUCH_ID = () => path.join(app.getPath('userData'), 'touchid.bin')
const DEV_URL = process.env.NOTES_DEV_URL
const isMac = process.platform === 'darwin'

protocol.registerSchemesAsPrivileged([
  { scheme: 'app', privileges: { standard: true, secure: true, supportFetchAPI: true, corsEnabled: true } },
  { scheme: 'att', privileges: { standard: true, secure: true, supportFetchAPI: true, corsEnabled: true, stream: true } }
])

if (!app.requestSingleInstanceLock()) app.exit(0)

let win = null

/** Windows 11 22H2+ has Mica, which the see-through sidebar uses. */
const translucency = isMac || (process.platform === 'win32' && Number(os.release().split('.')[2]) >= 22621)

function serve() {
  protocol.handle('app', (req) => {
    const { pathname } = new URL(req.url)
    let file = path.normalize(path.join(WEB, decodeURIComponent(pathname)))
    if (!file.startsWith(WEB) || !fs.existsSync(file) || fs.statSync(file).isDirectory()) file = path.join(WEB, 'index.html')
    return net.fetch(pathToFileURL(file).toString())
  })
  protocol.handle('att', (req) => {
    const id = new URL(req.url).pathname.split('/').pop()
    const file = path.join(ATTACHMENTS(), String(id).replace(/[^a-z0-9]/gi, ''))
    if (!fs.existsSync(file)) return new Response('not found', { status: 404 })
    const data = fs.readFileSync(file)
    return new Response(data, { headers: { 'Content-Type': sniff(data), 'Cache-Control': 'max-age=31536000, immutable', 'Access-Control-Allow-Origin': '*' } })
  })
}

/** Attachments are stored without a file type: tell the page what they are from their first bytes. */
function sniff(b) {
  const hex = b.subarray(0, 12).toString('hex')
  const ascii = b.subarray(0, 12).toString('latin1')
  if (hex.startsWith('89504e47')) return 'image/png'
  if (hex.startsWith('ffd8ff')) return 'image/jpeg'
  if (ascii.startsWith('GIF8')) return 'image/gif'
  if (ascii.startsWith('RIFF') && ascii.slice(8, 12) === 'WEBP') return 'image/webp'
  if (ascii.startsWith('RIFF') && ascii.slice(8, 12) === 'WAVE') return 'audio/wav'
  if (ascii.startsWith('%PDF')) return 'application/pdf'
  if (hex.startsWith('1a45dfa3')) return 'video/webm'
  if (ascii.slice(4, 8) === 'ftyp') return /M4A|m4a/.test(ascii) ? 'audio/mp4' : 'video/mp4'
  if (ascii.startsWith('ID3') || hex.startsWith('fffb')) return 'audio/mpeg'
  if (ascii.startsWith('OggS')) return 'audio/ogg'
  const start = b.subarray(0, 200).toString('utf8').trimStart()
  if (start.startsWith('<svg') || (start.startsWith('<?xml') && start.includes('<svg'))) return 'image/svg+xml'
  return 'application/octet-stream'
}

const MAC_CSS = ''

function createWindow() {
  win = new BrowserWindow({
    width: 1180,
    height: 780,
    minWidth: 720,
    minHeight: 460,
    title: 'Notes',
    show: false,
    backgroundColor: translucency ? '#00000000' : '#ffffff',
    titleBarStyle: 'hidden',
    trafficLightPosition: { x: 16, y: 15 },
    titleBarOverlay: process.platform === 'win32' ? { color: '#00000000', symbolColor: '#666666', height: 40 } : undefined,
    vibrancy: isMac ? 'sidebar' : undefined,
    visualEffectState: 'followWindow',
    backgroundMaterial: process.platform === 'win32' && translucency ? 'mica' : undefined,
    autoHideMenuBar: true,
    webPreferences: { preload: path.join(__dirname, 'preload.cjs'), contextIsolation: true, sandbox: false, spellcheck: true, plugins: true }
  })
  win.loadURL(DEV_URL || 'app://notes/')
  win.once('ready-to-show', () => win.show())
  win.webContents.on('did-finish-load', () => {
    win.webContents.insertCSS(`
      ::-webkit-scrollbar { width: 10px; height: 10px; background: transparent; }
      ::-webkit-scrollbar-thumb { background: rgba(128,128,128,0.35); border-radius: 5px; border: 2px solid transparent; background-clip: padding-box; }
      ::-webkit-scrollbar-thumb:hover { background-color: rgba(128,128,128,0.55); }
      ${isMac ? MAC_CSS : ''}
    `)
  })
  // Links open in the browser, never inside Notes.
  win.webContents.setWindowOpenHandler(({ url }) => {
    if (/^(https?|mailto):/.test(url)) void shell.openExternal(url)
    return { action: 'deny' }
  })
  win.webContents.on('will-navigate', (e, url) => {
    if (url.startsWith('app://') || (DEV_URL && url.startsWith(DEV_URL))) return
    e.preventDefault()
    if (/^(https?|mailto):/.test(url)) void shell.openExternal(url)
  })
  win.webContents.on('context-menu', (_e, params) => contextMenu(params))
  // ⌘T is a second New Note shortcut, as in Arc (a menu item has room for only one).
  win.webContents.on('before-input-event', (e, input) => {
    const mod = process.platform === 'darwin' ? input.meta : input.control
    if (input.type === 'keyDown' && mod && !input.shift && !input.alt && input.key.toLowerCase() === 't') {
      e.preventDefault()
      win.webContents.send('menu', 'new-note')
    }
  })
  win.on('close', (e) => {
    // On a Mac, closing the window keeps Notes running (reopen it from the Dock), like Apple Notes.
    if (isMac && !app.isQuitting) {
      e.preventDefault()
      win.hide()
    }
  })
}

function showWindow() {
  if (!win) createWindow()
  else {
    win.show()
    win.focus()
  }
}

const send = (command, arg) => {
  showWindow()
  win?.webContents.send('menu', command, arg)
}

// ── Menus ────────────────────────────────────────────────────────────────────────────────────

function contextMenu(params) {
  const items = []
  if (params.misspelledWord) {
    for (const s of params.dictionarySuggestions.slice(0, 6)) items.push({ label: s, click: () => win.webContents.replaceMisspelling(s) })
    if (!params.dictionarySuggestions.length) items.push({ label: 'No Guesses Found', enabled: false })
    items.push({ label: 'Learn Spelling', click: () => win.webContents.session.addWordToSpellCheckerDictionary(params.misspelledWord) }, { type: 'separator' })
  }
  if (params.isEditable) {
    items.push({ role: 'cut' }, { role: 'copy' }, { role: 'paste' }, { role: 'pasteAndMatchStyle' }, { type: 'separator' })
    items.push({
      label: 'Format',
      submenu: [
        { label: 'Title', click: () => send('style:title') },
        { label: 'Heading', click: () => send('style:heading') },
        { label: 'Subheading', click: () => send('style:subheading') },
        { label: 'Body', click: () => send('style:body') },
        { label: 'Monostyled', click: () => send('style:mono') },
        { type: 'separator' },
        { label: 'Bold', click: () => send('bold') },
        { label: 'Italic', click: () => send('italic') },
        { label: 'Underline', click: () => send('underline') },
        { label: 'Strikethrough', click: () => send('strike') },
        { label: 'Highlight', click: () => send('highlight') }
      ]
    })
    items.push({ label: 'Add Link…', click: () => send('link') }, { role: 'selectAll' })
  } else if (params.selectionText) items.push({ role: 'copy' })
  if (params.linkURL && /^https?:/.test(params.linkURL)) items.push({ type: 'separator' }, { label: 'Open Link', click: () => shell.openExternal(params.linkURL) }, { label: 'Copy Link', click: () => require('electron').clipboard.writeText(params.linkURL) })
  // Notes' own lists and folders have their own menus.
  if (items.length && params.isEditable) Menu.buildFromTemplate(items).popup({ window: win })
  else if (items.length && params.selectionText) Menu.buildFromTemplate(items).popup({ window: win })
}

function buildMenu() {
  const cmd = (label, command, accelerator, arg) => ({ label, accelerator, click: () => send(command, arg) })
  const template = [
    ...(isMac
      ? [
          {
            label: 'Notes',
            submenu: [
              cmd('About Notes', 'about'),
              cmd('Check for Updates…', 'updates'),
              { type: 'separator' },
              cmd('Settings…', 'settings', 'Cmd+,'),
              { type: 'separator' },
              { role: 'services' },
              { type: 'separator' },
              { role: 'hide' },
              { role: 'hideOthers' },
              { role: 'unhide' },
              { type: 'separator' },
              { role: 'quit' }
            ]
          }
        ]
      : []),
    {
      label: 'File',
      submenu: [
        cmd('New Note', 'new-note', 'CmdOrCtrl+N'),
        cmd('New Quick Note', 'new-quick-note'),
        cmd('New Folder', 'new-folder', 'Shift+CmdOrCtrl+N'),
        cmd('New Smart Folder', 'new-smart-folder'),
        { type: 'separator' },
        cmd('Pin Note', 'pin'),
        cmd('Lock Note', 'lock', 'CmdOrCtrl+L'),
        cmd('Lock Now', 'lock-now'),
        cmd('Duplicate Note', 'duplicate', 'CmdOrCtrl+D'),
        { type: 'separator' },
        cmd('Import…', 'import'),
        {
          label: 'Export Note',
          submenu: [cmd('PDF…', 'export', undefined, 'pdf'), cmd('Markdown…', 'export', undefined, 'markdown'), cmd('HTML…', 'export', undefined, 'html'), cmd('Plain Text…', 'export', undefined, 'text')]
        },
        cmd('Print…', 'print', 'CmdOrCtrl+P'),
        { type: 'separator' },
        cmd('Delete Note', 'delete'),
        { type: 'separator' },
        cmd('Close Note', 'close-note', 'CmdOrCtrl+W'),
        { role: 'close', accelerator: 'Shift+CmdOrCtrl+W' },
        ...(isMac ? [] : [{ type: 'separator' }, cmd('Settings…', 'settings', 'Ctrl+,'), { role: 'quit' }])
      ]
    },
    {
      label: 'Edit',
      submenu: [
        { role: 'undo' },
        { role: 'redo' },
        { type: 'separator' },
        { role: 'cut' },
        { role: 'copy' },
        { role: 'paste' },
        { role: 'pasteAndMatchStyle' },
        { role: 'delete' },
        { role: 'selectAll' },
        { type: 'separator' },
        cmd('Attach File…', 'attach', 'Shift+CmdOrCtrl+A'),
        cmd('Add Link…', 'link', 'CmdOrCtrl+K'),
        cmd('Add Sketch', 'sketch'),
        cmd('Record Audio', 'record'),
        cmd('Scan Documents', 'scan'),
        cmd('Take Photo', 'photo'),
        { type: 'separator' },
        { label: 'Find', submenu: [cmd('Search All Notes', 'search', 'Alt+CmdOrCtrl+F'), cmd('Find in Note…', 'find', 'CmdOrCtrl+F')] },
        ...(isMac ? [{ label: 'Speech', submenu: [{ role: 'startSpeaking' }, { role: 'stopSpeaking' }] }] : [])
      ]
    },
    {
      label: 'Format',
      submenu: [
        cmd('Title', 'style:title', 'Shift+CmdOrCtrl+T'),
        cmd('Heading', 'style:heading', 'Shift+CmdOrCtrl+H'),
        cmd('Subheading', 'style:subheading', 'Shift+CmdOrCtrl+J'),
        cmd('Body', 'style:body', 'Shift+CmdOrCtrl+B'),
        cmd('Monostyled', 'style:mono', 'Shift+CmdOrCtrl+M'),
        cmd('Bulleted List', 'style:bullet', 'Shift+CmdOrCtrl+7'),
        cmd('Dashed List', 'style:dashed', 'Shift+CmdOrCtrl+8'),
        cmd('Numbered List', 'style:numbered', 'Shift+CmdOrCtrl+9'),
        cmd('Block Quote', 'style:quote', "CmdOrCtrl+'"),
        { type: 'separator' },
        cmd('Checklist', 'checklist', 'Shift+CmdOrCtrl+L'),
        cmd('Mark as Checked', 'check', 'Shift+CmdOrCtrl+U'),
        cmd('Table', 'table', 'Alt+CmdOrCtrl+T'),
        { type: 'separator' },
        {
          label: 'Font',
          submenu: [
            cmd('Bold', 'bold', 'CmdOrCtrl+B'),
            cmd('Italic', 'italic', 'CmdOrCtrl+I'),
            cmd('Underline', 'underline', 'CmdOrCtrl+U'),
            cmd('Strikethrough', 'strike', 'Shift+CmdOrCtrl+X'),
            cmd('Highlight', 'highlight', 'Shift+CmdOrCtrl+E'),
            { type: 'separator' },
            cmd('Bigger', 'bigger', 'CmdOrCtrl+Plus'),
            cmd('Smaller', 'smaller', 'CmdOrCtrl+-')
          ]
        },
        {
          label: 'Text',
          submenu: [cmd('Align Left', 'align', undefined, 'left'), cmd('Center', 'align', undefined, 'center'), cmd('Align Right', 'align', undefined, 'right'), cmd('Justify', 'align', undefined, 'justify')]
        },
        { label: 'Indentation', submenu: [cmd('Increase', 'indent', 'CmdOrCtrl+]'), cmd('Decrease', 'outdent', 'CmdOrCtrl+[')] },
        {
          label: 'Lines & Grids',
          submenu: [
            ['none', 'None'],
            ['lines-small', 'Small Lines'],
            ['lines', 'Medium Lines'],
            ['lines-large', 'Large Lines'],
            ['grid-small', 'Small Grid'],
            ['grid', 'Medium Grid'],
            ['grid-large', 'Large Grid'],
            ['dots', 'Dots']
          ].map(([id, label]) => cmd(label, 'paper', undefined, id))
        }
      ]
    },
    {
      label: 'View',
      submenu: [
        cmd('as List', 'view', 'CmdOrCtrl+1', 'list'),
        cmd('as Gallery', 'view', 'CmdOrCtrl+2', 'gallery'),
        { type: 'separator' },
        { label: 'Sort By', submenu: [cmd('Date Edited', 'sort', undefined, 'edited'), cmd('Date Created', 'sort', undefined, 'created'), cmd('Title', 'sort', undefined, 'title')] },
        cmd('Group by Date', 'group'),
        { type: 'separator' },
        cmd('Toggle Sidebar', 'sidebar', 'CmdOrCtrl+S'),
        cmd('Attachments Browser', 'attachments', 'CmdOrCtrl+3'),
        { type: 'separator' },
        { role: 'resetZoom' },
        { role: 'zoomIn' },
        { role: 'zoomOut' },
        { type: 'separator' },
        { role: 'togglefullscreen' },
        ...(!app.isPackaged ? [{ role: 'toggleDevTools' }, { role: 'reload' }] : [])
      ]
    },
    { role: 'windowMenu' },
    {
      role: 'help',
      submenu: [cmd('Send Feedback…', 'feedback'), ...(!isMac ? [cmd('Check for Updates…', 'updates'), cmd('About Notes', 'about')] : []), { label: 'Notes on GitHub', click: () => shell.openExternal('https://github.com/Deli5150/notes') }]
    }
  ]
  Menu.setApplicationMenu(Menu.buildFromTemplate(template))
}

// ── Data and attachments ─────────────────────────────────────────────────────────────────────

ipcMain.on('version', (e) => (e.returnValue = version))
ipcMain.on('translucency', (e) => (e.returnValue = translucency))

ipcMain.handle('data:load', () => {
  for (const f of [DATA(), `${DATA()}.bak`]) {
    try {
      const text = fs.readFileSync(f, 'utf8')
      JSON.parse(text)
      return text
    } catch {}
  }
  return null
})

let lastBackup = 0
ipcMain.handle('data:save', (_e, json) => {
  const file = DATA()
  fs.mkdirSync(path.dirname(file), { recursive: true })
  // A backup copy, at most every few minutes (saves come after every pause in typing).
  if (fs.existsSync(file) && Date.now() - lastBackup > 5 * 60_000) {
    fs.copyFileSync(file, `${file}.bak`)
    lastBackup = Date.now()
  }
  fs.writeFileSync(`${file}.tmp`, json)
  fs.renameSync(`${file}.tmp`, file)
})

const attFile = (id) => path.join(ATTACHMENTS(), String(id).replace(/[^a-z0-9]/gi, ''))
ipcMain.handle('att:put', (_e, id, data) => {
  fs.mkdirSync(ATTACHMENTS(), { recursive: true })
  fs.writeFileSync(attFile(id), Buffer.from(data))
})
ipcMain.handle('att:get', (_e, id) => {
  try {
    return new Uint8Array(fs.readFileSync(attFile(id)))
  } catch {
    return null
  }
})
ipcMain.handle('att:has', (_e, id) => fs.existsSync(attFile(id)))
ipcMain.handle('att:list', () => {
  try {
    return fs.readdirSync(ATTACHMENTS())
  } catch {
    return []
  }
})
ipcMain.handle('att:remove', (_e, id) => fs.rmSync(attFile(id), { force: true }))

ipcMain.handle('file:save', async (_e, name, data) => {
  const { canceled, filePath } = await dialog.showSaveDialog(win, { defaultPath: path.join(app.getPath('downloads'), name) })
  if (canceled || !filePath) return false
  fs.writeFileSync(filePath, typeof data === 'string' ? data : Buffer.from(data))
  return true
})

/** Renders HTML in a hidden window (for PDFs and printing). */
async function offscreen(html) {
  const w = new BrowserWindow({ show: false, webPreferences: { sandbox: true, javascript: false } })
  const tmp = path.join(app.getPath('temp'), `notes-print-${Date.now()}.html`)
  fs.writeFileSync(tmp, html)
  await w.loadFile(tmp)
  // Let pictures load.
  await new Promise((r) => setTimeout(r, 300))
  return { w, done: () => (w.destroy(), fs.rmSync(tmp, { force: true })) }
}

ipcMain.handle('file:pdf', async (_e, name, html) => {
  const { canceled, filePath } = await dialog.showSaveDialog(win, { defaultPath: path.join(app.getPath('downloads'), name), filters: [{ name: 'PDF', extensions: ['pdf'] }] })
  if (canceled || !filePath) return false
  const { w, done } = await offscreen(html)
  try {
    const pdf = await w.webContents.printToPDF({ printBackground: true, margins: { marginType: 'default' }, pageSize: 'A4' })
    fs.writeFileSync(filePath, pdf)
    return true
  } finally {
    done()
  }
})

ipcMain.handle('print', async (_e, html) => {
  const { w, done } = await offscreen(html)
  await new Promise((resolve) => w.webContents.print({ printBackground: true }, () => resolve()))
  done()
})

ipcMain.on('close-window', (e) => BrowserWindow.fromWebContents(e.sender)?.close())
ipcMain.on('open-external', (_e, url) => {
  if (/^(https?|mailto):/.test(url)) void shell.openExternal(url)
})

// ── Apple Notes (Mac) ────────────────────────────────────────────────────────────────────────
// Read with JavaScript for Automation; macOS asks once for permission to control Notes.

const APPLE_NOTES_JXA = `
const Notes = Application('Notes')
const folders = []
const objects = []
const seen = new Set()
function walk(container, parent) {
  const list = container.folders()
  for (const f of list) {
    const id = f.id()
    if (seen.has(id)) continue
    seen.add(id)
    const name = f.name()
    if (name === 'Recently Deleted') continue
    folders.push({ id, name, parent })
    objects.push(f)
    walk(f, id)
  }
}
for (const a of Notes.accounts()) walk(a, undefined)
const notes = []
objects.forEach((fo, k) => {
  const n = fo.notes
  const ids = n.id()
  if (!ids.length) return
  const names = n.name(), created = n.creationDate(), modified = n.modificationDate(), locked = n.passwordProtected()
  // Every body at once (much faster than one by one); one by one if a locked note gets in the way.
  let bodies = null
  try { bodies = n.body() } catch (e) {}
  for (let i = 0; i < ids.length; i++) {
    let body = ''
    if (!locked[i]) {
      if (bodies) body = bodies[i] || ''
      else { try { body = n[i].body() } catch (e) {} }
    }
    notes.push({ id: ids[i], folder: folders[k].id, name: names[i], body, created: created[i].getTime(), modified: modified[i].getTime(), locked: locked[i] })
  }
})
JSON.stringify({ folders, notes })
`

ipcMain.handle('apple-notes', async () => {
  if (!isMac) throw new Error('Apple Notes is only on a Mac')
  return new Promise((resolve, reject) => {
    execFile('/usr/bin/osascript', ['-l', 'JavaScript', '-e', APPLE_NOTES_JXA], { maxBuffer: 2 * 1024 * 1024 * 1024, timeout: 30 * 60_000 }, (err, stdout, stderr) => {
      if (err) {
        const msg = String(stderr || err.message)
        if (/-1743|not authori[sz]ed|Not allowed/i.test(msg)) return reject(new Error('Notes isn’t allowed to read Apple Notes. Open System Settings → Privacy & Security → Automation, turn on Notes under “Notes” (this app), then try again.'))
        return reject(new Error(`Couldn’t read Apple Notes: ${msg.trim().split('\n').pop()}`))
      }
      try {
        resolve(JSON.parse(stdout))
      } catch (e) {
        reject(new Error(`Couldn’t read Apple Notes’ answer: ${e.message}`))
      }
    })
  })
})

// ── Link previews ────────────────────────────────────────────────────────────────────────────

const decode = (s) =>
  s
    .replace(/&amp;/g, '&')
    .replace(/&quot;/g, '"')
    .replace(/&#39;|&apos;/g, "'")
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&#(\d+);/g, (_m, n) => String.fromCharCode(Number(n)))
    .trim()

ipcMain.handle('link-preview', async (_e, url) => {
  if (!/^https?:\/\//.test(url)) return null
  try {
    const ctrl = new AbortController()
    const t = setTimeout(() => ctrl.abort(), 8000)
    const res = await net.fetch(url, { signal: ctrl.signal, headers: { 'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.0 Safari/605.1.15', Accept: 'text/html' } })
    clearTimeout(t)
    if (!res.ok || !/html/.test(res.headers.get('content-type') || '')) return null
    const html = (await res.text()).slice(0, 400_000)
    const meta = (prop) => {
      const re = new RegExp(`<meta[^>]+(?:property|name)=["']${prop}["'][^>]*>`, 'i')
      const tag = re.exec(html)?.[0]
      return tag ? decode(/content=["']([^"']*)["']/i.exec(tag)?.[1] ?? '') : ''
    }
    const title = meta('og:title') || meta('twitter:title') || decode(/<title[^>]*>([^<]*)<\/title>/i.exec(html)?.[1] ?? '')
    let image = meta('og:image') || meta('twitter:image')
    if (image) image = new URL(image, res.url || url).toString()
    return { url, title, description: meta('og:description') || meta('description'), image: image || undefined, site: meta('og:site_name') || new URL(url).hostname.replace(/^www\./, '') }
  } catch {
    return null
  }
})

// ── Window chrome, shortcuts, spelling ───────────────────────────────────────────────────────

ipcMain.on('chrome', (_e, c) => {
  if (!win) return
  nativeTheme.themeSource = c.dark ? 'dark' : 'light'
  if (isMac) win.setVibrancy(c.translucent ? 'sidebar' : null)
  if (process.platform === 'win32') {
    try {
      win.setTitleBarOverlay({ color: '#00000000', symbolColor: c.fg, height: 40 })
    } catch {}
    if (translucency) win.setBackgroundMaterial(c.translucent ? 'mica' : 'none')
  }
  if (!c.translucent || !translucency) win.setBackgroundColor(c.bg)
})

let quickShortcut = false
ipcMain.on('quick-note-shortcut', (_e, on) => {
  const key = 'Control+Alt+N'
  if (on && !quickShortcut) quickShortcut = globalShortcut.register(key, () => send('new-quick-note'))
  if (!on && quickShortcut) {
    globalShortcut.unregister(key)
    quickShortcut = false
  }
})

ipcMain.on('spellcheck', (_e, on) => session.defaultSession.setSpellCheckerEnabled(Boolean(on)))

// ── Touch ID (Mac) ───────────────────────────────────────────────────────────────────────────

ipcMain.on('touchid:available', (e) => {
  try {
    e.returnValue = isMac && systemPreferences.canPromptTouchID() && safeStorage.isEncryptionAvailable()
  } catch {
    e.returnValue = false
  }
})
ipcMain.handle('touchid:save', (_e, password) => {
  if (!password) return void fs.rmSync(TOUCH_ID(), { force: true })
  fs.writeFileSync(TOUCH_ID(), safeStorage.encryptString(password))
})
ipcMain.handle('touchid:unlock', async (_e, reason) => {
  if (!fs.existsSync(TOUCH_ID())) return null
  await systemPreferences.promptTouchID(reason)
  return safeStorage.decryptString(fs.readFileSync(TOUCH_ID()))
})

// ── Sync with Google ─────────────────────────────────────────────────────────────────────────

ipcMain.on('google:configured', (e) => (e.returnValue = google.configured()))
ipcMain.handle('google:sign-in', () => google.signIn())
ipcMain.handle('google:sign-out', () => google.signOut())
ipcMain.handle('google:fetch', (_e, url, init) => google.authFetch(url, init))
ipcMain.handle('google:fetch-bytes', (_e, url, init) => google.authFetchBytes(url, init))

// ── Titles with Claude ───────────────────────────────────────────────────────────────────────

ipcMain.handle('ai:has-key', () => ai.hasKey())
ipcMain.handle('ai:set-key', (_e, key) => ai.saveKey(key ? String(key).trim() : null))
ipcMain.handle('ai:title', (_e, text) => ai.title(String(text ?? '')))

// ── Updates ──────────────────────────────────────────────────────────────────────────────────

ipcMain.handle('update:status', () => updater.updateStatus())
ipcMain.handle('update:check', (_e, quiet) => updater.checkForUpdates(Boolean(quiet)))
ipcMain.handle('update:download', () => updater.downloadUpdate())
ipcMain.handle('update:install', () => updater.installUpdate())
ipcMain.on('update:auto', (_e, enabled) => updater.setAuto(enabled))

// ── App ──────────────────────────────────────────────────────────────────────────────────────

app.on('second-instance', showWindow)
app.on('activate', showWindow)
app.on('before-quit', () => (app.isQuitting = true))
app.on('will-quit', () => globalShortcut.unregisterAll())
app.on('window-all-closed', () => {
  if (!isMac) app.quit()
})

app.whenReady().then(() => {
  app.setAppUserModelId('app.notes.desktop')
  serve()
  // The camera and microphone (scans, recordings) and the fonts on this computer (the Aa panel).
  session.defaultSession.setPermissionRequestHandler((_wc, permission, cb) => cb(['media', 'local-fonts', 'clipboard-read', 'clipboard-sanitized-write'].includes(permission)))
  session.defaultSession.setPermissionCheckHandler((_wc, permission) => ['media', 'local-fonts', 'clipboard-read', 'clipboard-sanitized-write'].includes(permission))
  buildMenu()
  createWindow()
  updater.startUpdater((status) => win?.webContents.send('update:status', status))
  if (process.env.NOTES_SHOTS) void screenshots(process.env.NOTES_SHOTS)
})

/** Test hook: NOTES_SHOTS=<dir> [NOTES_SHOT_STEPS="name:click text|@aria-label|!js,…"] saves screenshots, then quits. */
async function screenshots(dir) {
  const wait = (ms) => new Promise((r) => setTimeout(r, ms))
  fs.mkdirSync(dir, { recursive: true })
  win.webContents.on('console-message', (e) => {
    if (e.level === 'warning' || e.level === 'error') console.log(`[page ${e.level}] ${e.message}`)
  })
  await wait(3500)
  // Steps: "name:click,…", or JSON [[name, action, …], …] (easier with scripts in it).
  const raw = process.env.NOTES_SHOT_STEPS || 'home:'
  const steps = raw.startsWith('[') ? JSON.parse(raw) : raw.split(',').map((s) => s.split(':'))
  for (const [name, ...clicks] of steps) {
    for (const text of clicks.filter(Boolean)) {
      if (text.startsWith('wait')) {
        await wait(Number(text.slice(4)) || 1000)
        continue
      }
      if (text.startsWith('key:')) {
        // "key:meta+t": a key press, as if typed (goes through before-input-event).
        const parts = text.slice(4).split('+')
        const keyCode = parts.pop()
        for (const type of ['keyDown', 'char', 'keyUp']) win.webContents.sendInputEvent({ type, keyCode, modifiers: parts })
      } else if (text.startsWith('!')) {
        await win.webContents.executeJavaScript(text.slice(1).replace(/%2C/g, ',').replace(/%3A/g, ':').replace(/%26/g, '&')).catch((e) => console.log(`[step failed] ${e.message}`))
      } else if (text.startsWith('@')) {
        await win.webContents.executeJavaScript(`(() => { const el = [...document.querySelectorAll('[title=${JSON.stringify(text.slice(1))}],[aria-label=${JSON.stringify(text.slice(1))}]')].filter((e) => e.offsetParent).pop(); el && el.click(); return !!el })()`)
      } else {
        await win.webContents.executeJavaScript(
          `(() => { const els = [...document.querySelectorAll('div,span,button')].filter(e => e.textContent.trim() === ${JSON.stringify(text)} && e.offsetParent && [...e.children].every(c => c.textContent.trim() !== ${JSON.stringify(text)})); const el = els[els.length - 1]; if (el) { el.dispatchEvent(new MouseEvent('mousedown', { bubbles: true })); el.click() } return !!el })()`
        )
      }
      await wait(700)
    }
    await wait(900)
    if (process.env.NOTES_SHOT_REAL && isMac) {
      // The real window, see-through sidebar and all (needs Screen Recording permission).
      win.focus()
      await wait(300)
      const b = win.getBounds()
      await new Promise((r) => execFile('/usr/sbin/screencapture', ['-x', '-o', `-R${b.x},${b.y},${b.width},${b.height}`, path.join(dir, `${name}.png`)], () => r()))
    } else {
      const img = await win.webContents.capturePage()
      fs.writeFileSync(path.join(dir, `${name}.png`), img.toPNG())
    }
    console.log('shot', name)
  }
  app.isQuitting = true
  app.quit()
}
