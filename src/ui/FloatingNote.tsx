import { ChevronLeft, ChevronRight, Pin, PinOff, Plus, SquareArrowOutUpRight, Trash2, X } from 'lucide-react'
import { useEffect, useMemo, useState } from 'react'
import { useShallow } from 'zustand/react/shallow'
import { NotePane, useEditorRef } from '../editor/Editor'
import { withKeys } from '../lib/shortcuts'
import { desktop } from '../lib/storage'
import { useStore } from '../lib/store'
import { applyTheme } from '../lib/themes'
import { QUICK_NOTES, type Note } from '../lib/types'
import { useUi } from '../lib/ui'
import { startWindowSync } from '../lib/windows'
import { runCommand } from './commands'
import { OverlayHost, ToastHost } from './overlays'

// The floating Quick Note (desktop/main.cjs createFloat): one Quick Note at a time in a small window
// above every app, with the arrows going through the others. Esc or the shortcut hides it.

const LAST = 'notes.floating-note'
const remembered = () => {
  try {
    return localStorage.getItem(LAST)
  } catch {
    return null
  }
}
const remember = (id: string) => {
  try {
    localStorage.setItem(LAST, id)
  } catch {}
}

const isBlank = (n: Note | undefined) => Boolean(n && !n.name?.trim() && !n.text.trim() && !n.attachments.length)

/** The open floating note, or a new one if it's gone. */
function newFloatingNote(current?: Note): string {
  if (isBlank(current)) return current!.id
  return useStore.getState().createNote(QUICK_NOTES, '').id
}

export function FloatingNote() {
  const loaded = useStore((s) => s.loaded)
  const theme = useStore(useShallow((s) => [s.settings.theme, s.settings.appearance, s.settings.translucent] as const))
  // Newest first; by when they were made, so the order holds still while one is edited.
  const quick = useStore(useShallow((s) => s.notes.filter((n) => n.folderId === QUICK_NOTES && !n.deletedAt && !n.locked)))
  const list = useMemo(() => [...quick].sort((a, b) => b.createdAt - a.createdAt), [quick])
  const [id, setId] = useState<string | null>(null)
  const [pinned, setPinned] = useState(true)

  useEffect(() => {
    void useStore.getState().hydrate()
    startWindowSync()
    document.body.classList.add('is-float-window')
    void desktop?.float.pinned().then(setPinned)
  }, [])

  useEffect(() => {
    applyTheme(theme[0], theme[1], theme[2] && Boolean(desktop?.translucency))
  }, [theme])

  const note = list.find((n) => n.id === id)
  // Open the last one used, else the newest, else a new one.
  useEffect(() => {
    if (!loaded || note) return
    const last = remembered()
    setId(list.find((n) => n.id === last)?.id ?? list[0]?.id ?? newFloatingNote())
  }, [loaded, note, list])

  useEffect(() => {
    if (!id) return
    remember(id)
    useUi.setState({ noteId: id, selected: [id] })
  }, [id])

  const go = (step: number) => {
    const i = list.findIndex((n) => n.id === id)
    const next = list[i + step]
    if (next) setId(next.id)
  }
  const add = () => setId(newFloatingNote(note))
  const remove = () => {
    if (!note) return
    const i = list.findIndex((n) => n.id === note.id)
    const next = list[i + 1] ?? list[i - 1]
    useStore.getState().deleteNotes([note.id])
    setId(next?.id ?? newFloatingNote())
  }

  // Keys from the menu (desktop/main.cjs FLOAT_COMMANDS), Esc, and coming back into view.
  useEffect(() => {
    const off = desktop?.onMenu((cmd, arg) => {
      if (cmd === 'new-note' || cmd === 'new-quick-note') add()
      else if (cmd === 'close-note') desktop?.float.hide()
      else runCommand(cmd, arg)
    })
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape' && !e.defaultPrevented && !document.querySelector('.menu, .dialog, .findbar')) desktop?.float.hide()
    }
    addEventListener('keydown', onKey)
    const offShown = desktop?.float.onShown(() => {
      const ed = useEditorRef.getState().editor
      if (ed && !ed.isDestroyed && !(document.activeElement instanceof HTMLTextAreaElement)) ed.commands.focus('end')
    })
    return () => {
      off?.()
      offShown?.()
      removeEventListener('keydown', onKey)
    }
  })

  if (!loaded) return <div className="float is-loading" />
  const i = list.findIndex((n) => n.id === id)
  return (
    <div className={`float is-${desktop?.platform ?? 'web'}`}>
      <div className="float-bar">
        <button className="tb-btn is-small" title="Newer" disabled={i <= 0} onClick={() => go(-1)}>
          <ChevronLeft size={15} />
        </button>
        <span className="float-count">{list.length ? `${i + 1} of ${list.length}` : ''}</span>
        <button className="tb-btn is-small" title="Older" disabled={i < 0 || i >= list.length - 1} onClick={() => go(1)}>
          <ChevronRight size={15} />
        </button>
        <span className="float-title">{note?.title || 'Quick Note'}</span>
        <button className="tb-btn is-small" title={withKeys('New Quick Note', 'new-note')} onClick={add}>
          <Plus size={15} />
        </button>
        <button className="tb-btn is-small" title="Move to Recently Deleted" disabled={!note || isBlank(note)} onClick={remove}>
          <Trash2 size={14} />
        </button>
        <button className="tb-btn is-small" title="Open in Notes" disabled={!note} onClick={() => note && desktop?.float.openInNotes(note.id)}>
          <SquareArrowOutUpRight size={14} />
        </button>
        <button
          className={`tb-btn is-small${pinned ? ' is-on' : ''}`}
          title={pinned ? 'Floating above other windows' : 'Float above other windows'}
          onClick={() => {
            desktop?.float.pin(!pinned)
            setPinned(!pinned)
          }}
        >
          {pinned ? <Pin size={14} /> : <PinOff size={14} />}
        </button>
        <button className="tb-btn is-small" title="Hide (Esc)" onClick={() => desktop?.float.hide()}>
          <X size={15} />
        </button>
      </div>
      <div className="float-body">{id && <NotePane noteId={id} />}</div>
      <OverlayHost />
      <ToastHost />
    </div>
  )
}
