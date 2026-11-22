const { contextBridge, ipcRenderer } = require('electron')

// window.notesApp: what the app (src/lib/storage.ts DesktopBridge) can ask the desktop side for.
contextBridge.exposeInMainWorld('notesApp', {
  platform: process.platform,
  version: ipcRenderer.sendSync('version'),
  translucency: ipcRenderer.sendSync('translucency'),
  load: () => ipcRenderer.invoke('data:load'),
  save: (json) => ipcRenderer.invoke('data:save', json),
  attachments: {
    put: (id, data) => ipcRenderer.invoke('att:put', id, data),
    get: (id) => ipcRenderer.invoke('att:get', id),
    has: (id) => ipcRenderer.invoke('att:has', id),
    list: () => ipcRenderer.invoke('att:list'),
    remove: (id) => ipcRenderer.invoke('att:remove', id)
  },
  saveFile: (name, data) => ipcRenderer.invoke('file:save', name, data),
  savePdf: (name, html) => ipcRenderer.invoke('file:pdf', name, html),
  print: (html) => ipcRenderer.invoke('print', html),
  appleNotes: () => ipcRenderer.invoke('apple-notes'),
  linkPreview: (url) => ipcRenderer.invoke('link-preview', url),
  openExternal: (url) => ipcRenderer.send('open-external', url),
  setChrome: (c) => ipcRenderer.send('chrome', c),
  setQuickNoteShortcut: (on) => ipcRenderer.send('quick-note-shortcut', on),
  setSpellcheck: (on) => ipcRenderer.send('spellcheck', on),
  onMenu: (cb) => {
    const listener = (_e, command, arg) => cb(command, arg)
    ipcRenderer.on('menu', listener)
    return () => ipcRenderer.off('menu', listener)
  },
  touchId: {
    available: ipcRenderer.sendSync('touchid:available'),
    save: (password) => ipcRenderer.invoke('touchid:save', password),
    unlock: (reason) => ipcRenderer.invoke('touchid:unlock', reason)
  },
  google: {
    configured: ipcRenderer.sendSync('google:configured'),
    signIn: () => ipcRenderer.invoke('google:sign-in'),
    signOut: () => ipcRenderer.invoke('google:sign-out'),
    fetch: (url, init) => ipcRenderer.invoke('google:fetch', url, init),
    fetchBytes: (url, init) => ipcRenderer.invoke('google:fetch-bytes', url, init)
  },
  updater: {
    status: () => ipcRenderer.invoke('update:status'),
    check: (quiet) => ipcRenderer.invoke('update:check', quiet),
    download: () => ipcRenderer.invoke('update:download'),
    install: () => ipcRenderer.invoke('update:install'),
    setAuto: (enabled) => ipcRenderer.send('update:auto', enabled),
    onChange: (cb) => {
      const listener = (_e, status) => cb(status)
      ipcRenderer.on('update:status', listener)
      return () => ipcRenderer.off('update:status', listener)
    }
  }
})
