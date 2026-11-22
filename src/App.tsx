import { ChevronLeft } from 'lucide-react'
import { useEffect, useRef, useState } from 'react'
import { NotePane, useEditorRef } from './editor/Editor'
import { applyImport, importFiles } from './import'
import * as lock from './lib/lock'
import { flushSave, useStore } from './lib/store'
import { desktop, isMac } from './lib/storage'
import { startSync, syncNow } from './lib/syncRunner'
import { applyTheme, systemDark } from './lib/themes'
import { useUi } from './lib/ui'
import { startUpdater } from './lib/updater'
import { AttachmentsBrowser } from './ui/AttachmentsBrowser'
import { runCommand } from './ui/commands'
import { Gallery, NoteList } from './ui/NoteList'
import { OverlayHost, ToastHost } from './ui/overlays'
import { SettingsWindow } from './ui/Settings'
import { Sidebar } from './ui/Sidebar'
import { Toolbar } from './ui/Toolbar'
import { UpdateSheet } from './ui/UpdateSheet'

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
    if (k === 'n') return 'new-note'
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
;(window as unknown as { __notes: unknown }).__notes = { store: useStore, ui: useUi, run: runCommand, editor: useEditorRef, importFiles, applyImport, lock }

export default function App() {
  const loaded = useStore((s) => s.loaded)
  const appearance = useStore((s) => s.settings.appearance)
  const themeId = useStore((s) => s.settings.theme)
  const translucent = useStore((s) => s.settings.translucent)
  const sidebarHidden = useStore((s) => s.settings.sidebarHidden)
  const view = useStore((s) => s.settings.view)
  const sidebarWidth = useStore((s) => s.settings.sidebarWidth)
  const listWidth = useStore((s) => s.settings.listWidth)
  const noteId = useUi((s) => s.noteId)
  const galleryOpen = useUi((s) => s.galleryOpen)
  const browser = useUi((s) => s.attachmentsBrowser)
  const [, setDarkTick] = useState(0)

  useEffect(() => {
    void useStore.getState().hydrate()
    startUpdater()
  }, [])

  // Theme: CSS variables, and the window's own colours (title bar on Windows, see-through sidebar).
  useEffect(() => {
    const apply = () => {
      const p = applyTheme(themeId, appearance, translucent && Boolean(desktop?.translucency))
      desktop?.setChrome({ bg: p.bg, fg: p.text, dark: document.documentElement.dataset.theme === 'dark', translucent })
    }
    apply()
    const mq = matchMedia('(prefers-color-scheme: dark)')
    const onChange = () => {
      apply()
      setDarkTick((n) => n + 1)
    }
    mq.addEventListener('change', onChange)
    return () => mq.removeEventListener('change', onChange)
  }, [themeId, appearance, translucent])

  useEffect(() => {
    if (!loaded) return
    startSync()
    const s = useStore.getState().settings
    desktop?.updater.setAuto(s.checkUpdates)
    desktop?.setQuickNoteShortcut(s.quickNoteShortcut)
    desktop?.setSpellcheck(s.spellcheck)
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
      window.removeEventListener('notes:command', onCommand)
      removeEventListener('keydown', onKey)
      document.removeEventListener('visibilitychange', onVisible)
      window.removeEventListener('pagehide', onHide)
    }
  }, [loaded])

  if (!loaded) return <div className="app is-loading" />

  const setSettings = useStore.getState().setSettings
  const showList = view === 'list' || galleryOpen
  const platform = desktop ? `is-${desktop.platform}` : 'is-web'

  let main: React.ReactNode
  if (browser) main = <AttachmentsBrowser />
  else if (view === 'gallery' && !galleryOpen) main = <Gallery />
  else
    main = (
      <div className="panes">
        {view === 'list' && (
          <>
            <NoteList width={listWidth} />
            <Splitter value={listWidth} min={220} max={520} onChange={(v) => setSettings({ listWidth: v })} />
          </>
        )}
        {view === 'gallery' && galleryOpen && (
          <button className="gallery-back" onClick={() => useUi.setState({ galleryOpen: false })}>
            <ChevronLeft size={16} /> All notes
          </button>
        )}
        <NotePane noteId={noteId} />
      </div>
    )

  return (
    <div className={`app ${platform}${systemDark() ? ' sys-dark' : ''}`}>
      {!sidebarHidden && (
        <>
          <Sidebar width={sidebarWidth} onSettings={() => useUi.setState({ settings: 'general' })} onFeedback={() => useUi.setState({ settings: 'feedback' })} />
          <Splitter value={sidebarWidth} min={170} max={360} onChange={(v) => setSettings({ sidebarWidth: v })} />
        </>
      )}
      <div className="main">
        <Toolbar listWidth={listWidth} showList={showList && view === 'list' && !browser} />
        {main}
      </div>
      <SettingsWindow />
      <UpdateSheet />
      <OverlayHost />
      <ToastHost />
    </div>
  )
}
