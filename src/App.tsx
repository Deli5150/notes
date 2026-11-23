import { App as CapApp } from '@capacitor/app'
import { ChevronLeft, SquarePen } from 'lucide-react'
import { useEffect, useRef, useState } from 'react'
import { NotePane, useEditorRef } from './editor/Editor'
import { applyImport, importFiles } from './import'
import * as exporter from './lib/export'
import * as lock from './lib/lock'
import { dropIfBlank, flushSave, useStore } from './lib/store'
import { paintBars } from './lib/android'
import { backToList, usePhone } from './lib/phone'
import { desktop, isAndroid, isMac } from './lib/storage'
import { newNote } from './ui/actions'
import { startSync, syncNow } from './lib/syncRunner'
import { applyTheme } from './lib/themes'
import { useUi } from './lib/ui'
import { applyShortcuts } from './lib/shortcuts'
import { startWindowSync } from './lib/windows'
import * as feeds from './lib/feeds'
import { startFeeds } from './lib/feeds'
import { checkForUpdates, startUpdater, useUpdate } from './lib/updater'
import { AttachmentsBrowser } from './ui/AttachmentsBrowser'
import { runCommand } from './ui/commands'
import { Gallery } from './ui/NoteList'
import { OverlayHost, ToastHost } from './ui/overlays'
import { SettingsWindow } from './ui/Settings'
import { Sidebar } from './ui/Sidebar'
import { Toolbar } from './ui/Toolbar'
import { UpdateSheet, useUpdateSheet } from './ui/UpdateSheet'

// Notes' window: folders on the left, the note list in the middle, the open note on the right
// (or the gallery of notes, or the attachments browser), with the toolbar along the top.

/** A drag handle between two columns. */
function Splitter({ value, min, max, onChange }: { value: number; min: number; max: number; onChange: (v: number) => void }) {
  const start = useRef<{ x: number; v: number } | null>(null)
  return (
    <div
      className="splitter"
      onPointerDown={(e) => {
        start.current = { x: e.clientX, v: value }
        ;(e.target as Element).setPointerCapture(e.pointerId)
      }}
      onPointerMove={(e) => {
        if (!start.current) return
        onChange(Math.max(min, Math.min(max, start.current.v + e.clientX - start.current.x)))
      }}
      onPointerUp={() => (start.current = null)}
    />
  )
}

/** Keyboard shortcuts in a browser (the desktop app's menu bar has them there). */
function browserShortcut(e: KeyboardEvent): string | null {
  const mod = isMac ? e.metaKey : e.ctrlKey
  if (!mod) return null
  const k = e.key.toLowerCase()
  if (e.altKey && k === 'f') return 'search'
  if (e.altKey && k === 't') return 'table'
  if (e.shiftKey && k === 'n') return 'new-folder'
  if (e.shiftKey && k === 'b') return 'style:body'
  if (e.shiftKey && k === 'm') return 'style:mono'
  if (e.shiftKey && k === '9') return 'style:numbered'
  if (e.shiftKey && k === 'a') return 'attach'
  if (!e.shiftKey && !e.altKey) {
    if (k === 'n' || k === 't') return 'new-note'
    if (k === 's') return 'sidebar'
    if (k === ',') return 'settings'
    if (k === 'f') return 'find'
    if (k === 'k') return 'link'
    if (k === 'd') return 'duplicate'
    if (k === 'p') return 'print'
    if (k === "'") return 'style:quote'
  }
  return null
}

// For the screenshot hook and debugging: the stores and commands.
;(window as unknown as { __notes: unknown }).__notes = { store: useStore, ui: useUi, run: runCommand, editor: useEditorRef, importFiles, applyImport, lock, exporter, updater: { check: checkForUpdates, state: useUpdate }, feeds }

export default function App() {
  const loaded = useStore((s) => s.loaded)
  const appearance = useStore((s) => s.settings.appearance)
  const themeId = useStore((s) => s.settings.theme)
  const translucent = useStore((s) => s.settings.translucent)
  const sidebarHidden = useStore((s) => s.settings.sidebarHidden)
  const view = useStore((s) => s.settings.view)
  const sidebarWidth = useStore((s) => s.settings.sidebarWidth)
  const noteId = useUi((s) => s.noteId)
  const galleryOpen = useUi((s) => s.galleryOpen)
  const browser = useUi((s) => s.attachmentsBrowser)
  const phone = usePhone()
  const phoneNote = useUi((s) => s.phoneNote)
  const settingsOpen = useUi((s) => Boolean(s.settings))
  const [, setDarkTick] = useState(0)

  useEffect(() => {
    void useStore.getState().hydrate({ dropBlank: true })
    startUpdater()
  }, [])

  // Theme: CSS variables, and the window's own colours (title bar on Windows, see-through sidebar,
  // Android's status and navigation bars).
  useEffect(() => {
    const apply = () => {
      const p = applyTheme(themeId, appearance, translucent && Boolean(desktop?.translucency))
      const dark = document.documentElement.dataset.theme === 'dark'
      paintBars(p, dark, phone && (phoneNote || settingsOpen) ? 'note' : 'list')
      desktop?.setChrome({ bg: p.bg, fg: p.text, dark, translucent })
    }
    apply()
    const mq = matchMedia('(prefers-color-scheme: dark)')
    const onChange = () => {
      apply()
      setDarkTick((n) => n + 1)
    }
    mq.addEventListener('change', onChange)
    return () => mq.removeEventListener('change', onChange)
  }, [themeId, appearance, translucent, phone, phoneNote, settingsOpen, loaded])

  useEffect(() => {
    if (!loaded) return
    startSync()
    const s = useStore.getState().settings
    desktop?.updater.setAuto(s.checkUpdates)
    desktop?.setQuickNoteShortcut(s.quickNoteShortcut)
    desktop?.setSpellcheck(s.spellcheck)
    void applyShortcuts()
    startWindowSync()
    void startFeeds()
    // Android's back button (or gesture): close what's on top, then back to the list, then out.
    const back = isAndroid
      ? CapApp.addListener('backButton', () => {
          const ui = useUi.getState()
          if (document.querySelector('.menu, .dialog')) dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' }))
          else if (useUpdateSheet.getState().open) useUpdateSheet.setState({ open: false })
          else if (ui.settings) useUi.setState({ settings: null })
          else if (ui.findOpen) useUi.setState({ findOpen: false })
          else if (ui.phoneNote) backToList()
          else void CapApp.minimizeApp()
        })
      : null
    // Empty notes don't stay (hydrate drops any from before): each one goes as it's closed or left. Not the
    // one the floating note has open (it does its own).
    const floating = () => {
      try {
        return localStorage.getItem('notes.floating-note')
      } catch {
        return null
      }
    }
    const offLeave = useUi.subscribe((st, prev) => {
      if (prev.noteId && st.noteId !== prev.noteId && prev.noteId !== floating()) dropIfBlank(prev.noteId)
    })
    const offKeys = useStore.subscribe((st, prev) => st.settings.shortcuts !== prev.settings.shortcuts && void applyShortcuts())
    const off = desktop?.onMenu((cmd, arg) => runCommand(cmd, arg))
    const onCommand = (e: Event) => runCommand((e as CustomEvent<string>).detail)
    window.addEventListener('notes:command', onCommand)
    const onKey = (e: KeyboardEvent) => {
      if (desktop) return
      const cmd = browserShortcut(e)
      if (cmd) {
        e.preventDefault()
        runCommand(cmd)
      }
    }
    addEventListener('keydown', onKey)
    const onVisible = () => document.visibilityState === 'visible' && void syncNow()
    document.addEventListener('visibilitychange', onVisible)
    const onHide = () => void flushSave()
    window.addEventListener('pagehide', onHide)
    return () => {
      off?.()
      void back?.then((h) => h.remove())
      offKeys()
      offLeave()
      window.removeEventListener('notes:command', onCommand)
      removeEventListener('keydown', onKey)
      document.removeEventListener('visibilitychange', onVisible)
      window.removeEventListener('pagehide', onHide)
    }
  }, [loaded])

  if (!loaded) return <div className="app is-loading" />

  const setSettings = useStore.getState().setSettings
  const platform = desktop ? `is-${desktop.platform}` : isAndroid ? 'is-android' : 'is-web'

  let main: React.ReactNode
  if (browser) main = <AttachmentsBrowser />
  else if (view === 'gallery' && !galleryOpen && !phone) main = <Gallery />
  else
    main = (
      <>
        {view === 'gallery' && galleryOpen && (
          <button className="gallery-back" onClick={() => useUi.setState({ galleryOpen: false })}>
            <ChevronLeft size={16} /> Gallery
          </button>
        )}
        <Toolbar />
        <NotePane noteId={noteId} />
      </>
    )

  // A phone shows one screen at a time: the list (the sidebar), or the open note.
  if (phone)
    return (
      <div className={`app ${platform} is-phone`}>
        {phoneNote && noteId ? (
          <main className="stage">
            <div className="card">{main}</div>
          </main>
        ) : (
          <>
            <Sidebar width={0} onSettings={() => useUi.setState({ settings: 'general' })} onFeedback={() => useUi.setState({ settings: 'feedback' })} />
            <button className="phone-fab" aria-label="New Note" onClick={() => newNote()}>
              <SquarePen size={22} />
            </button>
          </>
        )}
        <SettingsWindow />
        <UpdateSheet />
        <OverlayHost />
        <ToastHost />
      </div>
    )

  return (
    <div className={`app ${platform}${sidebarHidden ? ' no-sidebar' : ''}`}>
      {!sidebarHidden && (
        <>
          <Sidebar width={Math.max(240, sidebarWidth)} onSettings={() => useUi.setState({ settings: 'general' })} onFeedback={() => useUi.setState({ settings: 'feedback' })} />
          <Splitter value={sidebarWidth} min={240} max={460} onChange={(v) => setSettings({ sidebarWidth: v })} />
        </>
      )}
      <main className="stage">
        <div className="stage-drag" />
        <div className="card">{main}</div>
      </main>
      <SettingsWindow />
      <UpdateSheet />
      <OverlayHost />
      <ToastHost />
    </div>
  )
}
