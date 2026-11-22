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
  win.webContents.on('context-menu', (_e, params) => contextMenu(params, win))
  win.webContents.on('before-input-event', (e, input) => onKey(e, input, 'main'))
  win.on('closed', () => {
    win = null
    if (!isMac) app.quit()
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
  if (!win || win.isDestroyed()) createWindow()
  else {
    win.show()
    win.focus()
  }
}

const send = (command, arg) => {
  showWindow()
  win?.webContents.send('menu', command, arg)
}

// ── Floating Quick Note ──────────────────────────────────────────────────────────────────────
// A small note that floats above every app, shown and hidden with one shortcut (like Raycast's
// Floating Notes). It's the same page with #float, keeping its own copy of the data in step with the
// main window (src/lib/windows.ts); the main window is the one that saves.

let floatWin = null
/** Notes wasn't the active app when the floating note opened: hiding it goes back to that app. */
let floatFromOtherApp = false
const FLOAT_FILE = () => path.join(app.getPath('userData'), 'floating-note.json')

function createFloat() {
  let b = {}
  try {
    b = JSON.parse(fs.readFileSync(FLOAT_FILE(), 'utf8'))
  } catch {}
  const { screen } = require('electron')
  const area = screen.getDisplayNearestPoint(screen.getCursorScreenPoint()).workArea
  const width = b.width ?? 380
  const height = b.height ?? 440
  const visible = b.x !== undefined && screen.getAllDisplays().some((d) => b.x >= d.workArea.x - 40 && b.x < d.workArea.x + d.workArea.width - 40 && b.y >= d.workArea.y - 10 && b.y < d.workArea.y + d.workArea.height - 40)
  floatWin = new BrowserWindow({
    width,
    height,
    x: visible ? b.x : Math.round(area.x + area.width - width - 40),
    y: visible ? b.y : Math.round(area.y + 60),
    minWidth: 260,
    minHeight: 180,
    title: 'Quick Note',
    show: false,
    frame: false,
    type: isMac ? 'panel' : undefined,
    alwaysOnTop: b.pinned !== false,
    skipTaskbar: true,
    fullscreenable: false,
    minimizable: false,
    maximizable: false,
    hasShadow: true,
    backgroundColor: isMac ? '#00000000' : '#ffffff',
    vibrancy: isMac ? 'hud' : undefined,
    visualEffectState: 'active',
    backgroundMaterial: process.platform === 'win32' && translucency ? 'acrylic' : undefined,
    webPreferences: { preload: path.join(__dirname, 'preload.cjs'), contextIsolation: true, sandbox: false, spellcheck: true }
  })
  if (b.pinned !== false) floatWin.setAlwaysOnTop(true, 'floating')
  floatWin.setVisibleOnAllWorkspaces(true, { visibleOnFullScreen: true })
  floatWin.loadURL(`${DEV_URL || 'app://notes/'}#float`)
  floatWin.once('ready-to-show', () => showFloat())
  floatWin.webContents.on('before-input-event', (e, input) => onKey(e, input, 'float'))
  floatWin.webContents.on('context-menu', (_e, params) => contextMenu(params, floatWin))
  floatWin.webContents.setWindowOpenHandler(({ url }) => {
    if (/^(https?|mailto):/.test(url)) void shell.openExternal(url)
    return { action: 'deny' }
  })
  floatWin.webContents.on('will-navigate', (e, url) => {
    if (url.startsWith('app://') || (DEV_URL && url.startsWith(DEV_URL))) return
    e.preventDefault()
    if (/^(https?|mailto):/.test(url)) void shell.openExternal(url)
  })
  // Closing only hides it, so the shortcut brings it straight back.
  floatWin.on('close', (e) => {
    if (app.isQuitting) return
    e.preventDefault()
    hideFloat()
  })
  floatWin.on('closed', () => (floatWin = null))
  let timer = null
  const remember = () => {
    clearTimeout(timer)
    timer = setTimeout(() => {
      if (!floatWin || floatWin.isDestroyed()) return
      fs.writeFileSync(FLOAT_FILE(), JSON.stringify({ ...floatWin.getBounds(), pinned: floatWin.isAlwaysOnTop() }))
    }, 400)
  }
  floatWin.on('moved', remember)
  floatWin.on('resized', remember)
  floatWin.on('always-on-top-changed', remember)
}

function showFloat() {
  if (!floatWin || floatWin.isDestroyed()) return createFloat()
  floatFromOtherApp = !BrowserWindow.getFocusedWindow()
  floatWin.show()
  floatWin.focus()
  floatWin.webContents.send('float:shown')
}

function hideFloat() {
  if (!floatWin || floatWin.isDestroyed() || !floatWin.isVisible()) return
  floatWin.hide()
  // Back to the app that was in front, as Raycast does.
  if (isMac && floatFromOtherApp) app.hide()
}

function toggleFloat() {
  if (floatWin && !floatWin.isDestroyed() && floatWin.isVisible() && floatWin.isFocused()) hideFloat()
  else showFloat()
}

ipcMain.on('float:toggle', () => toggleFloat())
ipcMain.on('float:hide', () => hideFloat())
ipcMain.on('float:pin', (_e, on) => floatWin?.setAlwaysOnTop(Boolean(on), 'floating'))
ipcMain.handle('float:pinned', () => Boolean(floatWin?.isAlwaysOnTop()))
ipcMain.on('float:open-in-notes', (_e, id) => {
  hideFloat()
  floatFromOtherApp = false
  send('open-note', id)
})

// The two windows tell each other what changed.
ipcMain.on('windows:patch', (e, patch) => {
  for (const w of [win, floatWin]) if (w && !w.isDestroyed() && w.webContents !== e.sender) w.webContents.send('windows:patch', patch)
})
const isFloat = (sender) => floatWin && !floatWin.isDestroyed() && sender === floatWin.webContents
const mainAlive = () => win && !win.isDestroyed()

// ── Menus ────────────────────────────────────────────────────────────────────────────────────

function contextMenu(params, w) {
  // Commands go to the window the menu is in.
  const send = (command, arg) => w.webContents.send('menu', command, arg)
  const items = []
  if (params.misspelledWord) {
    for (const s of params.dictionarySuggestions.slice(0, 6)) items.push({ label: s, click: () => w.webContents.replaceMisspelling(s) })
    if (!params.dictionarySuggestions.length) items.push({ label: 'No Guesses Found', enabled: false })
    items.push({ label: 'Learn Spelling', click: () => w.webContents.session.addWordToSpellCheckerDictionary(params.misspelledWord) }, { type: 'separator' })
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
  if (items.length && params.isEditable) Menu.buildFromTemplate(items).popup({ window: w })
  else if (items.length && params.selectionText) Menu.buildFromTemplate(items).popup({ window: w })
}

// ── Keyboard shortcuts ───────────────────────────────────────────────────────────────────────
// Every menu command (and a few without a menu item) can get its own keys in Settings → Shortcuts.
// The menu only shows them: onKey runs them before the page sees the keys, the same way on a Mac and
// on Windows (where CmdOrCtrl is Ctrl). Keys are kept as canonical accelerators, e.g.
// "CmdOrCtrl+Shift+N"; "" means none.

const MODS = ['CmdOrCtrl', 'Ctrl', 'Alt', 'Shift', 'Super']

function normalizeKeys(a) {
  if (!a) return ''
  const parts = a.split('+')
  const key = parts.pop()
  const m = new Set()
  for (const p of parts) {
    const t = p.toLowerCase()
    if (t === 'cmdorctrl' || t === 'commandorcontrol') m.add('CmdOrCtrl')
    else if (t === 'cmd' || t === 'command' || t === 'super' || t === 'meta') m.add(isMac ? 'CmdOrCtrl' : 'Super')
    else if (t === 'ctrl' || t === 'control') m.add(isMac ? 'Ctrl' : 'CmdOrCtrl')
    else if (t === 'alt' || t === 'option') m.add('Alt')
    else if (t === 'shift') m.add('Shift')
  }
  const k = key === 'Plus' ? '=' : key.length === 1 ? key.toUpperCase() : key
  return [...MODS.filter((x) => m.has(x)), k].join('+')
}

const CODE_KEYS = { Minus: '-', Equal: '=', BracketLeft: '[', BracketRight: ']', Backslash: '\\', Semicolon: ';', Quote: "'", Comma: ',', Period: '.', Slash: '/', Backquote: '`', Space: 'Space', Tab: 'Tab', Enter: 'Enter', NumpadEnter: 'Enter', Backspace: 'Backspace', Delete: 'Delete', Escape: 'Escape', ArrowUp: 'Up', ArrowDown: 'Down', ArrowLeft: 'Left', ArrowRight: 'Right', Home: 'Home', End: 'End', PageUp: 'PageUp', PageDown: 'PageDown' }

/** The keys pressed, as an accelerator (by key position, so it works with any keyboard layout). */
function keysOfInput(input) {
  const c = input.code ?? ''
  const key = /^Key[A-Z]$/.test(c) ? c.slice(3) : /^Digit\d$/.test(c) ? c.slice(5) : /^F\d{1,2}$/.test(c) ? c : /^Numpad\d$/.test(c) ? `num${c.slice(6)}` : CODE_KEYS[c]
  if (!key) return null
  const m = new Set()
  if (input.meta) m.add(isMac ? 'CmdOrCtrl' : 'Super')
  if (input.control) m.add(isMac ? 'Ctrl' : 'CmdOrCtrl')
  if (input.alt) m.add('Alt')
  if (input.shift) m.add('Shift')
  return [...MODS.filter((x) => m.has(x)), key].join('+')
}

let shortcutOverrides = {}
/** What can have keys: { id, label, group, def, keys, run, global }. */
let catalog = []
let bindings = new Map()
let capturing = false

const keysFor = (id, def) => (Object.hasOwn(shortcutOverrides, id) ? normalizeKeys(shortcutOverrides[id]) : normalizeKeys(def))

/** Commands the floating note runs itself; the rest of the menu's keys do nothing there. */
const FLOAT_COMMANDS = new Set(['new-note', 'new-quick-note', 'close-note', 'bold', 'italic', 'underline', 'strike', 'highlight', 'checklist', 'check', 'table', 'link', 'indent', 'outdent', 'find', 'bigger', 'smaller', 'attach', 'align'])

function onKey(e, input, where) {
  if (input.type !== 'keyDown') return
  const keys = keysOfInput(input)
  if (!keys) return
  if (capturing && where === 'main') {
    // Settings → Shortcuts is waiting for new keys: they go to it, not to the menu or the note.
    e.preventDefault()
    if (!input.isAutoRepeat) win?.webContents.send('shortcut:captured', keys)
    return
  }
  const entry = bindings.get(keys)
  if (!entry) return
  if (where === 'float' && entry.command) {
    if (!FLOAT_COMMANDS.has(entry.command) && !entry.command.startsWith('style:')) return
    e.preventDefault()
    floatWin.webContents.send('menu', entry.command, entry.arg)
    return
  }
  e.preventDefault()
  entry.run()
}

let quickNoteOn = false
let quickNoteKeys = ''
function applyQuickNote() {
  const entry = catalog.find((c) => c.id === 'global:float-note')
  const want = quickNoteOn && !capturing ? (entry?.keys ?? '') : ''
  if (want === quickNoteKeys) return
  if (quickNoteKeys) globalShortcut.unregister(quickNoteKeys)
  quickNoteKeys = ''
  if (want) {
    try {
      if (globalShortcut.register(want, toggleFloat)) quickNoteKeys = want
    } catch {}
  }
}

function buildMenu() {
  // A menu item with keys (`sc` is taken out before the menu is built).
  const item = (label, id, def, run, command, arg) => ({ label, sc: { id, def, run, command, arg }, click: run })
  const cmd = (label, command, accelerator, arg) => item(label, arg ? `${command}:${arg}` : command, accelerator, () => send(command, arg), command, arg)
  const focused = () => BrowserWindow.getFocusedWindow() ?? win
  const zoom = (by) => {
    const wc = focused()?.webContents
    if (wc) wc.setZoomLevel(by === 0 ? 0 : wc.getZoomLevel() + by)
  }
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
        item('Floating Quick Note', 'float-note', '', toggleFloat),
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
        item('Close Window', 'close-window', 'Shift+CmdOrCtrl+W', () => focused()?.close()),
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
            cmd('Bigger', 'bigger', 'CmdOrCtrl+='),
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
        item('Actual Size', 'zoom-reset', 'CmdOrCtrl+0', () => zoom(0)),
        item('Zoom In', 'zoom-in', 'Alt+CmdOrCtrl+=', () => zoom(0.5)),
        item('Zoom Out', 'zoom-out', 'Alt+CmdOrCtrl+-', () => zoom(-0.5)),
        { type: 'separator' },
        item(isMac ? 'Enter Full Screen' : 'Full Screen', 'fullscreen', isMac ? 'Ctrl+CmdOrCtrl+F' : 'F11', () => focused()?.setFullScreen(!focused().isFullScreen())),
        ...(!app.isPackaged ? [{ role: 'toggleDevTools' }, { role: 'reload' }] : [])
      ]
    },
    { role: 'windowMenu' },
    {
      role: 'help',
      submenu: [cmd('Send Feedback…', 'feedback'), ...(!isMac ? [cmd('Check for Updates…', 'updates'), cmd('About Notes', 'about')] : []), { label: 'Notes on GitHub', click: () => shell.openExternal('https://github.com/Deli5150/notes') }]
    }
  ]
  // Shortcuts without a menu item.
  const extra = [
    { id: 'new-note:tab', label: 'New Note (second shortcut)', group: 'File', def: 'CmdOrCtrl+T', run: () => send('new-note') },
    { id: 'global:float-note', label: 'Floating Quick Note', group: 'Anywhere', def: isMac ? 'Ctrl+CmdOrCtrl+N' : 'Ctrl+Alt+N', global: true }
  ]
  catalog = []
  bindings = new Map()
  const add = (entry) => {
    entry.keys = keysFor(entry.id, entry.def)
    entry.def = normalizeKeys(entry.def)
    catalog.push(entry)
    if (entry.keys && !entry.global && !bindings.has(entry.keys)) bindings.set(entry.keys, entry)
  }
  const walk = (items, group) => {
    for (const it of items) {
      if (it.sc) {
        add({ id: it.sc.id, label: it.label, group, def: it.sc.def, run: it.sc.run, command: it.sc.command, arg: it.sc.arg })
        it.accelerator = keysFor(it.sc.id, it.sc.def) || undefined
        // Shown in the menu; onKey runs it (on Windows the menu would otherwise take the keys first).
        it.registerAccelerator = false
        delete it.sc
      }
      if (Array.isArray(it.submenu)) walk(it.submenu, group)
    }
  }
  for (const top of template) if (Array.isArray(top.submenu)) walk(top.submenu, top.label ?? (top.role === 'help' ? 'Help' : 'Notes'))
  extra.forEach(add)
  Menu.setApplicationMenu(Menu.buildFromTemplate(template))
  applyQuickNote()
}

ipcMain.handle('shortcuts:set', (_e, overrides) => {
  shortcutOverrides = overrides && typeof overrides === 'object' ? overrides : {}
  buildMenu()
  return catalog.map(({ id, label, group, def, keys, global }) => ({ id, label, group, def, keys, global: Boolean(global) }))
})
ipcMain.on('shortcuts:capture', (_e, on) => {
  capturing = Boolean(on)
  applyQuickNote()
})

// ── Data and attachments ─────────────────────────────────────────────────────────────────────

ipcMain.on('version', (e) => (e.returnValue = version))
ipcMain.on('translucency', (e) => (e.returnValue = translucency))

ipcMain.handle('data:load', async (e) => {
  // The floating note starts from what the main window has now (it may not be saved yet).
  if (isFloat(e.sender) && mainAlive()) {
    const snapshot = await win.webContents.executeJavaScript('window.__notesSnapshot?.() ?? null').catch(() => null)
    if (snapshot) return snapshot
  }
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
ipcMain.handle('data:save', (e, json) => {
  // The main window has the floating note's changes too, and saves them.
  if (isFloat(e.sender) && mainAlive()) return
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

ipcMain.on('quick-note-shortcut', (_e, on) => {
  quickNoteOn = Boolean(on)
  applyQuickNote()
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
ipcMain.handle('ai:apple-available', () => ai.appleAvailable())
ipcMain.handle('ai:apple-title', (_e, text) => ai.appleTitle(String(text ?? '')))

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
  const logs = (w) =>
    w.webContents.on('console-message', (e) => {
      if (e.level === 'warning' || e.level === 'error') console.log(`[page ${e.level}] ${e.message}`)
    })
  logs(win)
  app.on('browser-window-created', (_e, w) => logs(w))
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
      if (text === 'focus:main' || text === 'focus:float') {
        ;(text === 'focus:main' ? win : floatWin)?.focus()
      } else if (text.startsWith('float!')) {
        // Script in the floating note's window.
        await floatWin?.webContents.executeJavaScript(text.slice(6)).catch((e) => console.log(`[step failed] ${e.message}`))
      } else if (text.startsWith('key:')) {
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
      // A name starting "float" is a picture of the floating note.
      const target = name.startsWith('float') && floatWin && !floatWin.isDestroyed() ? floatWin : win
      const img = await target.webContents.capturePage()
      fs.writeFileSync(path.join(dir, `${name}.png`), img.toPNG())
    }
    console.log('shot', name)
  }
  app.isQuitting = true
  app.quit()
}
