import type { Editor as TEditor } from '@tiptap/core'
import { EditorContent, useEditor } from '@tiptap/react'
import { ChevronDown, ChevronUp, ExternalLink, Fingerprint, Loader2, Lock, Sparkles, X } from 'lucide-react'
import { generateTitle } from '../lib/titles'
import { toast } from '../ui/overlays'
import { useEffect, useMemo, useRef, useState } from 'react'
import { create } from 'zustand'
import { putDataUrl } from '../lib/attachments'
import { lockedWithOldPassword, openLocked, openWithOldPassword, saveLocked, unlock, unlockWithTouchId, useLock } from '../lib/lock'
import { desktop, openExternal } from '../lib/storage'
import { useKeys } from '../lib/shortcuts'
import { TASK_LABEL, TaskState } from '../ui/TaskState'
import { serviceById } from '../lib/services'
import { noteById, useStore } from '../lib/store'
import { useUi } from '../lib/ui'
import { DEFAULT_FOLDER, type Note } from '../lib/types'
import { findKey, findStep, mathKey, tagKey, replaceAll, replaceCurrent, setFind } from './extensions'
import { fontCss, insertFiles, insertLinkPreview, noteExtensions } from './setup'

/** Opens the link at `target` (a link to another note, or a web, mail or phone link). False if there's none. */
function followLink(target: EventTarget | null): boolean {
  const el = target instanceof Element ? target : null
  const a = el?.closest?.('a[href]')
  if (!a || el!.closest('.att')) return false
  const href = a.getAttribute('href') ?? ''
  if (href.startsWith('note://')) {
    const id = href.slice(7)
    const note = noteById(id)
    if (note) {
      useUi.getState().open(id)
      if (useUi.getState().source.kind === 'folder' && note.folderId !== (useUi.getState().source as { id: string }).id) useUi.getState().select({ kind: 'folder', id: note.folderId || DEFAULT_FOLDER })
      useUi.getState().open(id)
    }
    return true
  }
  if (/^(https?|mailto|tel):/.test(href)) {
    openExternal(href)
    return true
  }
  return false
}

// The open note: the TipTap editor with the note's content, saved shortly after each change.

/** The editor of the open note, for the toolbar and menus. */
export const useEditorRef = create<{ editor: TEditor | null; noteId: string | null }>(() => ({ editor: null, noteId: null }))

// The title has its own field now; "title" starts the body as plain text.
const START_HTML = { title: '<p></p>', heading: '<h2></h2>', subheading: '<h3></h3>', body: '<p></p>' }

export function startHtml(): string {
  return START_HTML[useStore.getState().settings.startWith]
}

/** Pictures pasted with data: or web addresses become attachments of their own. */
async function adoptPictures(editor: TEditor): Promise<void> {
  const todo: Array<{ pos: number; src: string }> = []
  editor.state.doc.descendants((node, pos) => {
    if (node.type.name === 'attachment' && !node.attrs.att && node.attrs.src && node.attrs.kind === 'image') todo.push({ pos, src: node.attrs.src })
  })
  for (const { pos, src } of todo) {
    let saved: { id: string; mime: string } | null = null
    if (src.startsWith('data:')) saved = await putDataUrl(src)
    else if (/^https?:/.test(src)) {
      try {
        const res = await fetch(src)
        if (res.ok) {
          const { putBlob } = await import('../lib/attachments')
          const blob = await res.blob()
          saved = { id: await putBlob(blob), mime: blob.type }
        }
      } catch {}
    }
    if (!saved || editor.isDestroyed) continue
    const node = editor.state.doc.nodeAt(pos)
    if (node?.type.name === 'attachment' && node.attrs.src === src) editor.view.dispatch(editor.state.tr.setNodeMarkup(pos, undefined, { ...node.attrs, att: saved.id, mime: saved.mime, src: null }))
  }
}

function NoteLinkPicker({ editor, query, at, onClose }: { editor: TEditor; query: string; at: { left: number; top: number; from: number }; onClose: () => void }) {
  const notes = useStore((s) => s.notes)
  const [index, setIndex] = useState(0)
  const current = useEditorRef((s) => s.noteId)
  const list = useMemo(() => {
    const q = query.toLowerCase()
    return notes.filter((n) => !n.deletedAt && n.id !== current && (n.title || 'New Note').toLowerCase().includes(q)).slice(0, 8)
  }, [notes, query, current])
  const pick = (n: Note) => {
    const to = editor.state.selection.from
    editor
      .chain()
      .focus()
      .deleteRange({ from: at.from, to })
      .insertContent([
        { type: 'text', text: n.title || 'New Note', marks: [{ type: 'link', attrs: { href: `note://${n.id}` } }] },
        { type: 'text', text: ' ' }
      ])
      .run()
    onClose()
  }
  useEffect(() => setIndex(0), [query])
  useEffect(() => {
    const key = (e: KeyboardEvent) => {
      if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
        e.preventDefault()
        e.stopPropagation()
        setIndex((i) => (i + (e.key === 'ArrowDown' ? 1 : -1) + list.length) % Math.max(1, list.length))
      } else if (e.key === 'Enter' || e.key === 'Tab') {
        if (!list[index]) return
        e.preventDefault()
        e.stopPropagation()
        pick(list[index])
      } else if (e.key === 'Escape') {
        e.preventDefault()
        e.stopPropagation()
        onClose()
      }
    }
    addEventListener('keydown', key, true)
    return () => removeEventListener('keydown', key, true)
  })
  return (
    <div className="menu link-picker" style={{ left: at.left, top: at.top }} onMouseDown={(e) => e.preventDefault()}>
      <div className="menu-header">Link to a note</div>
      {list.length ? (
        list.map((n, i) => (
          <div key={n.id} className={`menu-item${i === index ? ' is-open' : ''}`} onMouseEnter={() => setIndex(i)} onClick={() => pick(n)}>
            <span className="menu-label">{n.title || 'New Note'}</span>
          </div>
        ))
      ) : (
        <div className="menu-item is-disabled">
          <span className="menu-label">No notes match</span>
        </div>
      )}
    </div>
  )
}

function FindBar({ editor }: { editor: TEditor }) {
  const [query, setQuery] = useState('')
  const [replace, setReplace] = useState('')
  const [showReplace, setShowReplace] = useState(false)
  const [caseSensitive, setCase] = useState(false)
  const [, rerender] = useState(0)
  const input = useRef<HTMLInputElement>(null)
  useEffect(() => {
    input.current?.focus()
    const update = () => rerender((n) => n + 1)
    editor.on('transaction', update)
    return () => {
      editor.off('transaction', update)
      if (!editor.isDestroyed) setFind(editor.view, { query: '' })
    }
  }, [editor])
  const st = findKey.getState(editor.state)
  const close = () => useUi.setState({ findOpen: false })
  return (
    <div className="findbar">
      <div className="findbar-row">
        <input
          ref={input}
          className="field"
          placeholder="Find in note"
          value={query}
          onChange={(e) => {
            setQuery(e.target.value)
            setFind(editor.view, { query: e.target.value, current: 0 })
          }}
          onKeyDown={(e) => {
            if (e.key === 'Enter') findStep(editor.view, e.shiftKey ? -1 : 1)
            if (e.key === 'Escape') close()
          }}
        />
        <span className="findbar-count">{query ? `${st?.matches.length ? st.current + 1 : 0} of ${st?.matches.length ?? 0}` : ''}</span>
        <button className="icon-btn" title="Previous" onClick={() => findStep(editor.view, -1)}>
          <ChevronUp size={15} />
        </button>
        <button className="icon-btn" title="Next" onClick={() => findStep(editor.view, 1)}>
          <ChevronDown size={15} />
        </button>
        <label className="check" title="Match case">
          <input
            type="checkbox"
            checked={caseSensitive}
            onChange={(e) => {
              setCase(e.target.checked)
              setFind(editor.view, { caseSensitive: e.target.checked })
            }}
          />
          Aa
        </label>
        <button className={`btn btn-small${showReplace ? ' is-on' : ''}`} onClick={() => setShowReplace(!showReplace)}>
          Replace
        </button>
        <button className="icon-btn" title="Done" onClick={close}>
          <X size={15} />
        </button>
      </div>
      {showReplace && (
        <div className="findbar-row">
          <input className="field" placeholder="Replace with" value={replace} onChange={(e) => setReplace(e.target.value)} onKeyDown={(e) => e.key === 'Enter' && replaceCurrent(editor.view, replace)} />
          <button className="btn btn-small" onClick={() => replaceCurrent(editor.view, replace)}>
            Replace
          </button>
          <button className="btn btn-small" onClick={() => replaceAll(editor.view, replace)}>
            All
          </button>
        </div>
      )}
    </div>
  )
}

/** The note's title, above its body. Empty: offers to write one from what the note says. */
function TitleField({ note, editor, readOnly }: { note: Note; editor: TEditor | null; readOnly: boolean }) {
  const [value, setValue] = useState(note.name ?? '')
  const [busy, setBusy] = useState(false)
  const [, setTick] = useState(0)
  const ref = useRef<HTMLTextAreaElement>(null)
  const engine = useStore((s) => s.settings.titleEngine)
  const focused = useRef(false)

  // Changed elsewhere (Sync, Generate): show it unless it's being typed in.
  useEffect(() => {
    if (!focused.current) setValue(note.name ?? '')
  }, [note.name])

  // Grow with the text.
  useEffect(() => {
    const el = ref.current
    if (!el) return
    el.style.height = '0px'
    el.style.height = `${el.scrollHeight}px`
  }, [value])

  // Show the Generate button once the body has words in it.
  useEffect(() => {
    if (!editor) return
    const update = () => setTick((n) => n + 1)
    editor.on('update', update)
    return () => {
      editor.off('update', update)
    }
  }, [editor])

  const bodyText = () => (editor && !editor.isDestroyed ? editor.getText({ blockSeparator: '\n' }) : note.text).trim()
  const canGenerate = !readOnly && !value.trim() && bodyText().length > 0

  const generate = async () => {
    const text = bodyText()
    if (!text) return
    setBusy(true)
    try {
      const title = await generateTitle(text, engine)
      if (!title) return toast('There isn’t enough in the note to title it yet')
      setValue(title)
      useStore.getState().setName(note.id, title)
    } catch (e) {
      toast((e as Error).message)
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="title-field">
      <textarea
        ref={ref}
        className="title-input"
        rows={1}
        placeholder="Title"
        value={value}
        readOnly={readOnly}
        autoFocus={!readOnly && !note.name && !note.text.trim()}
        spellCheck={false}
        onFocus={() => (focused.current = true)}
        onBlur={() => (focused.current = false)}
        onChange={(e) => {
          const v = e.target.value.replace(/\n/g, ' ')
          setValue(v)
          useStore.getState().setName(note.id, v)
        }}
        onKeyDown={(e) => {
          const el = e.currentTarget
          // Enter (or ↓ at the end) carries on into the body.
          if (e.key === 'Enter' || (e.key === 'ArrowDown' && el.selectionStart === el.value.length)) {
            e.preventDefault()
            editor?.commands.focus('start')
          }
        }}
      />
      {canGenerate && (
        <button className="title-generate" onClick={() => void generate()} disabled={busy} title={engine === 'claude' ? 'Claude reads the note and suggests a title' : 'Suggests a title from what the note says'}>
          {busy ? <Loader2 size={13} className="spin" /> : <Sparkles size={13} />}
          {busy ? 'Writing a title…' : 'Generate title'}
        </button>
      )}
    </div>
  )
}

function NoteEditor({ note, html, readOnly }: { note: Note; html: string; readOnly: boolean }) {
  const settings = useStore((s) => s.settings)
  const findOpen = useUi((s) => s.findOpen)
  const saved = useRef(html)
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null)
  const [picker, setPicker] = useState<{ query: string; at: { left: number; top: number; from: number } } | null>(null)
  const scroller = useRef<HTMLDivElement>(null)

  const save = (editor: TEditor) => {
    if (timer.current) clearTimeout(timer.current)
    timer.current = null
    if (editor.isDestroyed) return
    const out = editor.getHTML()
    if (out === saved.current) return
    saved.current = out
    if (note.locked) void saveLocked(note.id, out)
    else useStore.getState().setContent(note.id, out)
  }

  const editor = useEditor(
    {
      extensions: noteExtensions(),
      content: html || startHtml(),
      editable: !readOnly,
      autofocus: false,
      editorProps: {
        attributes: { class: 'note-content', spellcheck: String(settings.spellcheck) },
        handleKeyDown(view, event) {
          // ↑ at the very start of the body goes back up to the title.
          if (event.key === 'ArrowUp' && view.state.selection.empty && view.state.selection.from <= 1) {
            const title = view.dom.closest('.editor-scroll')?.querySelector<HTMLTextAreaElement>('.title-input')
            if (title) {
              event.preventDefault()
              title.focus()
              title.setSelectionRange(title.value.length, title.value.length)
              return true
            }
          }
          return false
        },
        handlePaste(view, event) {
          const files = [...(event.clipboardData?.files ?? [])]
          if (files.length) {
            event.preventDefault()
            void insertFiles(editorRef.current!, files)
            return true
          }
          const text = event.clipboardData?.getData('text/plain')?.trim() ?? ''
          const html = event.clipboardData?.getData('text/html') ?? ''
          // A lone web address on an empty line becomes a link preview.
          if (/^https?:\/\/\S+$/.test(text) && !html.includes('<img') && view.state.selection.empty && view.state.selection.$from.parent.textContent === '' && desktop) {
            event.preventDefault()
            void insertLinkPreview(editorRef.current!, text)
            return true
          }
          return false
        },
        handleDrop(view, event, _slice, moved) {
          const files = [...(event.dataTransfer?.files ?? [])]
          if (moved || !files.length) return false
          event.preventDefault()
          const pos = view.posAtCoords({ left: event.clientX, top: event.clientY })?.pos
          void insertFiles(editorRef.current!, files, pos)
          return true
        },
        handleClickOn(_view, _pos, _node, _nodePos, event) {
          return followLink(event.target)
        }
      },
      onUpdate({ editor }) {
        if (timer.current) clearTimeout(timer.current)
        timer.current = setTimeout(() => save(editor), 300)
        // ">>" links to another note.
        const { $from, empty } = editor.state.selection
        const before = $from.parent.textBetween(0, $from.parentOffset, undefined, '￼')
        const m = empty ? />>([^>\n]{0,40})$/.exec(before) : null
        if (m) {
          const c = editor.view.coordsAtPos($from.pos)
          setPicker({ query: m[1], at: { left: c.left, top: c.bottom + 4, from: $from.pos - m[0].length } })
        } else setPicker(null)
        if (editor.state.doc.content.size < 400_000) void adoptPictures(editor)
      },
      onBlur({ editor }) {
        save(editor)
      }
    },
    [note.id]
  )
  const editorRef = useRef<TEditor | null>(null)
  editorRef.current = editor

  // Touch screens: when you're not typing (no cursor in the note), tapping a link opens it instead
  // of putting the cursor in it and bringing up the keyboard. While typing, a tap still moves the
  // cursor, so a link's text can be edited. (The editor leaves taps to the browser on touch screens,
  // so its own click handling never saw them.)
  useEffect(() => {
    const dom = editor?.view.dom
    if (!dom) return
    let tapped: Element | null = null
    const down = (e: PointerEvent) => {
      tapped = null
      if (e.pointerType !== 'touch' || editor.view.hasFocus()) return
      const a = (e.target as Element).closest?.('a[href]')
      if (!a || (e.target as Element).closest('.att')) return
      tapped = a
      // No mouse events follow, so the note doesn't take focus (no cursor, no keyboard); the click still comes.
      e.preventDefault()
    }
    const click = (e: MouseEvent) => {
      if (!tapped) return
      const a = (e.target as Element).closest?.('a[href]')
      const same = a === tapped
      tapped = null
      if (!same) return
      e.preventDefault()
      e.stopPropagation()
      followLink(a)
    }
    dom.addEventListener('pointerdown', down, true)
    dom.addEventListener('click', click, true)
    return () => {
      dom.removeEventListener('pointerdown', down, true)
      dom.removeEventListener('click', click, true)
    }
  }, [editor])

  useEffect(() => {
    if (!editor) return
    useEditorRef.setState({ editor, noteId: note.id })
    return () => {
      save(editor)
      if (useEditorRef.getState().editor === editor) useEditorRef.setState({ editor: null, noteId: null })
    }
  }, [editor, note.id])

  // The note changed elsewhere (Sync, a tag renamed, the other window): show it, unless it's being
  // typed in (focus in a window that isn't in front doesn't count).
  useEffect(() => {
    if (!editor || (editor.isFocused && document.hasFocus()) || html === saved.current) return
    saved.current = html
    editor.commands.setContent(html || startHtml(), { emitUpdate: false })
  }, [editor, html])

  useEffect(() => {
    if (editor && editor.isEditable === readOnly) editor.setEditable(!readOnly)
  }, [editor, readOnly])

  // Settings the editor's plugins read: redraw them when they change.
  useEffect(() => {
    if (editor && !editor.isDestroyed) editor.view.dispatch(editor.state.tr.setMeta(mathKey, true).setMeta(tagKey, true).setMeta('addToHistory', false))
  }, [editor, settings.mathResults, settings.tags])

  useEffect(() => {
    if (editor) editor.view.dom.setAttribute('spellcheck', String(settings.spellcheck))
  }, [editor, settings.spellcheck])

  const paper = note.paper ?? settings.paper
  const style = { '--note-font': fontCss(settings.fontFamily), '--note-size': `${settings.fontSize}px`, '--note-line': String(settings.lineHeight) } as React.CSSProperties

  return (
    <div className="editor-pane">
      {findOpen && editor && <FindBar editor={editor} />}
      <div
        ref={scroller}
        className={`editor-scroll paper-${paper}`}
        style={style}
        onMouseDown={(e) => {
          // Clicking below the text puts the cursor at the end.
          if (e.target === e.currentTarget && editor) {
            e.preventDefault()
            editor.commands.focus('end')
          }
        }}
      >
        {note.external && <ExternalBar note={note} />}
        <TitleField note={note} editor={editor} readOnly={readOnly} />
        <EditorContent editor={editor} />
      </div>
      {picker && editor && <NoteLinkPicker editor={editor} query={picker.query} at={picker.at} onClose={() => setPicker(null)} />}
    </div>
  )
}

function LockedNote({ note }: { note: Note }) {
  const [password, setPassword] = useState('')
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)
  const settings = useStore((s) => s.settings)
  const old = lockedWithOldPassword(note.id)
  const touchId = Boolean(desktop?.touchId.available && settings.touchId && !old)
  useEffect(() => {
    if (touchId) void unlockWithTouchId()
  }, [touchId])
  const submit = async () => {
    setBusy(true)
    const ok = old ? await openWithOldPassword(note.id, password) : await unlock(password)
    setBusy(false)
    if (!ok) {
      setError(settings.lock?.hint ? `Wrong password. Hint: ${settings.lock.hint}` : 'Wrong password. Try again.')
      setPassword('')
    }
  }
  return (
    <div className="locked">
      <Lock size={44} strokeWidth={1.4} className="locked-icon" />
      <div className="locked-title">This note is locked.</div>
      <div className="locked-sub">{old ? 'It was locked with an older password. Enter that password to view it.' : 'Enter the notes password to view locked notes.'}</div>
      <form
        onSubmit={(e) => {
          e.preventDefault()
          void submit()
        }}
      >
        <input className="field" type="password" autoFocus placeholder="Password" value={password} onChange={(e) => (setPassword(e.target.value), setError(''))} disabled={busy} />
      </form>
      {error && <div className="alert-error">{error}</div>}
      {touchId && (
        <button className="btn" onClick={() => void unlockWithTouchId()}>
          <Fingerprint size={15} /> Use Touch ID
        </button>
      )}
    </div>
  )
}

/** The right-hand pane: the open note, a locked note's password screen, or nothing. */
/** On a note mirrored from a connected service: where it's from, its status, and a link there. */
function ExternalBar({ note }: { note: Note }) {
  const x = note.external!
  return (
    <div className="external-bar">
      {x.state && (
        <span className={`external-state is-${x.state}`}>
          <TaskState state={x.state} size={14} />
          {TASK_LABEL[x.state]}
        </span>
      )}
      <span className="external-ref">
        {x.ref && <strong>{x.ref}</strong>}
        {x.ref && x.meta ? ' · ' : ''}
        {x.meta}
      </span>
      <span className="tb-flex" />
      <button className="external-open" onClick={() => openExternal(x.url)}>
        {serviceById(x.provider).openLabel} <ExternalLink size={12} />
      </button>
    </div>
  )
}

function EmptyPane() {
  const tab = useKeys('new-note:tab')
  const n = useKeys('new-note')
  const keys = tab || n
  return (
    <div className="editor-pane is-empty">
      <div className="empty-hint">
        No note open
        {keys && <span>{keys} for a new note</span>}
      </div>
    </div>
  )
}

export function NotePane({ noteId }: { noteId: string | null }) {
  const note = useStore((s) => (noteId ? s.notes.find((n) => n.id === noteId) : undefined))
  const key = useLock((s) => s.key)
  const opened = useLock((s) => (noteId ? s.open[noteId] : undefined))
  const [content, setContent] = useState<{ id: string; html: string } | null>(null)

  useEffect(() => {
    setContent(null)
    if (!note?.locked || !key) return
    let live = true
    void openLocked(note.id).then((c) => live && c && setContent({ id: note.id, html: c.html }))
    return () => {
      live = false
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [note?.id, Boolean(note?.locked), key, Boolean(opened)])

  if (!note) return <EmptyPane />
  if (note.locked) {
    if (!opened && (!content || content.id !== note.id)) return <LockedNote note={note} />
    return <NoteEditor key={note.id} note={note} html={opened?.html ?? content?.html ?? ''} readOnly={Boolean(note.deletedAt || note.external)} />
  }
  return <NoteEditor key={note.id} note={note} html={note.html} readOnly={Boolean(note.deletedAt || note.external)} />
}
