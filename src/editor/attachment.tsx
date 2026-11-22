import { mergeAttributes, Node } from '@tiptap/core'
import { NodeViewWrapper, ReactNodeViewRenderer, type ReactNodeViewProps } from '@tiptap/react'
import { Download, ExternalLink, FileText, Maximize2, Minimize2, Pause, PenLine, Play, Trash2 } from 'lucide-react'
import { useEffect, useRef, useState } from 'react'
import { attachmentBytes, attachmentUrl, formatBytes, type AttachmentKind } from '../lib/attachments'
import { desktop, openExternal, saveFileAs } from '../lib/storage'
import { fileIcon } from '../ui/icons'
import { openSketch, SketchView } from './Sketch'

// Everything that isn't text in a note is an attachment node: pictures, scans, sketches,
// recordings, videos, PDFs, other files, and link previews. Its content is a file in the
// attachment store (src/lib/attachments.ts), referred to by id.

export interface AttachmentAttrs {
  att: string | null
  kind: AttachmentKind | 'link'
  name: string
  mime: string
  size: number
  /** Pictures: shown small or large (the note's full width). */
  width: 'small' | 'large'
  /** Sketches: the strokes (an attachment of their own), so they can be edited again. */
  strokes: string | null
  /** Link previews (and pictures not yet saved): the address. */
  src: string | null
  title: string | null
  desc: string | null
  /** Link previews: the page's picture (an address). */
  image: string | null
  createdAt: number | null
}

declare module '@tiptap/core' {
  interface Commands<ReturnType> {
    attachment: { insertAttachment: (attrs: Partial<AttachmentAttrs>) => ReturnType }
  }
}

const str = (name: string) => ({
  default: null,
  parseHTML: (el: HTMLElement) => el.getAttribute(`data-${name}`),
  renderHTML: (a: Record<string, unknown>) => (a[name] != null && a[name] !== '' ? { [`data-${name}`]: String(a[name]) } : {})
})

export const Attachment = Node.create({
  name: 'attachment',
  group: 'block',
  atom: true,
  draggable: true,
  selectable: true,

  addAttributes() {
    return {
      att: str('att'),
      kind: { default: 'image', parseHTML: (el) => el.getAttribute('data-kind') ?? 'image', renderHTML: (a) => ({ 'data-kind': a.kind }) },
      name: { default: '', parseHTML: (el) => el.getAttribute('data-name') ?? '', renderHTML: (a) => (a.name ? { 'data-name': a.name } : {}) },
      mime: { default: '', parseHTML: (el) => el.getAttribute('data-mime') ?? '', renderHTML: (a) => (a.mime ? { 'data-mime': a.mime } : {}) },
      size: { default: 0, parseHTML: (el) => Number(el.getAttribute('data-size')) || 0, renderHTML: (a) => (a.size ? { 'data-size': String(a.size) } : {}) },
      width: { default: 'large', parseHTML: (el) => (el.getAttribute('data-width') === 'small' ? 'small' : 'large'), renderHTML: (a) => ({ 'data-width': a.width }) },
      strokes: str('strokes'),
      src: str('src'),
      title: str('title'),
      desc: str('desc'),
      image: str('image'),
      createdAt: { default: null, parseHTML: (el) => Number(el.getAttribute('data-created')) || null, renderHTML: (a) => (a.createdAt ? { 'data-created': String(a.createdAt) } : {}) }
    }
  },

  parseHTML() {
    return [
      { tag: 'figure[data-attachment]' },
      // Pictures pasted or imported from elsewhere: kept by address until saved as attachments.
      {
        tag: 'img[src]',
        getAttrs: (el) => {
          const img = el as HTMLImageElement
          const att = img.getAttribute('data-att')
          return { kind: 'image', att, src: att ? null : img.getAttribute('src'), name: img.getAttribute('alt') ?? '' }
        }
      }
    ]
  },

  renderHTML({ HTMLAttributes, node }) {
    const a = node.attrs as AttachmentAttrs
    const inner: unknown[] =
      a.kind === 'image' || a.kind === 'sketch' || a.kind === 'scan'
        ? [['img', { src: a.att ? `att://file/${a.att}` : (a.src ?? ''), alt: a.name }]]
        : a.kind === 'link'
          ? [['a', { href: a.src ?? '' }, a.title || a.src || '']]
          : [['span', {}, a.name || a.kind]]
    return ['figure', mergeAttributes({ 'data-attachment': '' }, HTMLAttributes), ...inner] as never
  },

  addCommands() {
    return {
      insertAttachment:
        (attrs) =>
        ({ commands }) =>
          commands.insertContent({ type: this.name, attrs: { createdAt: Date.now(), ...attrs } })
    }
  },

  addNodeView() {
    return ReactNodeViewRenderer(AttachmentView)
  }
})

function useUrl(id: string | null, mime?: string): string {
  const [url, setUrl] = useState('')
  useEffect(() => {
    let live = true
    const load = () => id && void attachmentUrl(id, mime).then((u) => live && setUrl(u))
    load()
    // Downloaded by Sync after the note opened.
    window.addEventListener('notes:attachments', load)
    return () => {
      live = false
      window.removeEventListener('notes:attachments', load)
    }
  }, [id, mime])
  return url
}

async function saveAttachment(a: AttachmentAttrs) {
  if (!a.att) return
  const bytes = await attachmentBytes(a.att)
  if (bytes) await saveFileAs(a.name || `${a.kind}-${a.att.slice(0, 6)}`, bytes, a.mime)
}

function Tools({ children }: { children: React.ReactNode }) {
  return (
    <div className="att-tools" contentEditable={false}>
      {children}
    </div>
  )
}

function AttachmentView({ node, updateAttributes, deleteNode, selected, editor }: ReactNodeViewProps) {
  const a = node.attrs as AttachmentAttrs
  const url = useUrl(a.att, a.mime)
  const editable = editor.isEditable

  if (a.kind === 'image' || a.kind === 'scan' || a.kind === 'sketch') {
    const src = url || a.src || ''
    return (
      <NodeViewWrapper className={`att att-picture is-${a.width}${selected ? ' is-selected' : ''}`} data-drag-handle>
        {a.kind === 'sketch' && a.strokes ? (
          <div onDoubleClick={() => editable && void openSketch(a, updateAttributes)}>
            <SketchView strokes={a.strokes} fallback={src} alt={a.name} />
          </div>
        ) : src ? (
          <img src={src} alt={a.name} draggable={false} />
        ) : (
          <div className="att-missing">Picture not downloaded yet</div>
        )}
        {editable && (
          <Tools>
            {a.kind === 'sketch' && (
              <button title="Edit sketch" onClick={() => void openSketch(a, updateAttributes)}>
                <PenLine size={14} />
              </button>
            )}
            <button title={a.width === 'small' ? 'View as large image' : 'View as small image'} onClick={() => updateAttributes({ width: a.width === 'small' ? 'large' : 'small' })}>
              {a.width === 'small' ? <Maximize2 size={14} /> : <Minimize2 size={14} />}
            </button>
            {a.att && (
              <button title="Save as…" onClick={() => void saveAttachment(a)}>
                <Download size={14} />
              </button>
            )}
            <button title="Delete" onClick={() => deleteNode()}>
              <Trash2 size={14} />
            </button>
          </Tools>
        )}
      </NodeViewWrapper>
    )
  }

  if (a.kind === 'audio') return <AudioView a={a} url={url} selected={selected} onDelete={editable ? deleteNode : undefined} />

  if (a.kind === 'video') {
    return (
      <NodeViewWrapper className={`att att-video${selected ? ' is-selected' : ''}`}>
        {url && <video src={url} controls preload="metadata" />}
      </NodeViewWrapper>
    )
  }

  if (a.kind === 'link') {
    return (
      <NodeViewWrapper className={`att att-link${selected ? ' is-selected' : ''}`}>
        <a
          href={a.src ?? '#'}
          onClick={(e) => {
            e.preventDefault()
            if (a.src) openExternal(a.src)
          }}
          contentEditable={false}
        >
          {a.image && <img src={a.image} alt="" draggable={false} onError={(e) => ((e.target as HTMLElement).style.display = 'none')} />}
          <div className="att-link-text">
            <div className="att-link-title">{a.title || a.src}</div>
            {a.desc && <div className="att-link-desc">{a.desc}</div>}
            <div className="att-link-site">{hostOf(a.src)}</div>
          </div>
        </a>
      </NodeViewWrapper>
    )
  }

  // PDFs and other files.
  return <FileView a={a} url={url} selected={selected} onDelete={editable ? deleteNode : undefined} />
}

const hostOf = (u: string | null) => {
  try {
    return u ? new URL(u).hostname.replace(/^www\./, '') : ''
  } catch {
    return u ?? ''
  }
}

function FileView({ a, url, selected, onDelete }: { a: AttachmentAttrs; url: string; selected: boolean; onDelete?: () => void }) {
  const [preview, setPreview] = useState(a.kind === 'pdf')
  const Icon = fileIcon(a.mime, a.name)
  return (
    <NodeViewWrapper className={`att att-file${selected ? ' is-selected' : ''}`}>
      <div className="att-file-card" contentEditable={false} onDoubleClick={() => void saveAttachment(a)}>
        <div className="att-file-icon">
          <Icon size={26} strokeWidth={1.4} />
        </div>
        <div className="att-file-text">
          <div className="att-file-name">{a.name || 'Attachment'}</div>
          <div className="att-file-size">
            {a.kind === 'pdf' ? 'PDF Document' : (a.name.split('.').pop()?.toUpperCase() ?? 'File')}
            {a.size ? ` · ${formatBytes(a.size)}` : ''}
          </div>
        </div>
        <div className="att-file-actions">
          {a.kind === 'pdf' && (
            <button title={preview ? 'Hide preview' : 'Show preview'} onClick={() => setPreview(!preview)}>
              <FileText size={15} />
            </button>
          )}
          {url && !desktop && (
            <button title="Open" onClick={() => window.open(url, '_blank')}>
              <ExternalLink size={15} />
            </button>
          )}
          <button title="Save as…" onClick={() => void saveAttachment(a)}>
            <Download size={15} />
          </button>
          {onDelete && (
            <button title="Delete" onClick={onDelete}>
              <Trash2 size={15} />
            </button>
          )}
        </div>
      </div>
      {a.kind === 'pdf' && preview && url && <iframe className="att-pdf" src={`${url}#toolbar=0&navpanes=0`} title={a.name} />}
    </NodeViewWrapper>
  )
}

const clock = (s: number) => (Number.isFinite(s) ? `${Math.floor(s / 60)}:${String(Math.floor(s % 60)).padStart(2, '0')}` : '0:00')

function AudioView({ a, url, selected, onDelete }: { a: AttachmentAttrs; url: string; selected: boolean; onDelete?: () => void }) {
  const ref = useRef<HTMLAudioElement>(null)
  const [playing, setPlaying] = useState(false)
  const [time, setTime] = useState(0)
  const [duration, setDuration] = useState(0)
  return (
    <NodeViewWrapper className={`att att-audio${selected ? ' is-selected' : ''}`}>
      <div className="att-audio-card" contentEditable={false}>
        <button className="att-audio-play" onClick={() => (playing ? ref.current?.pause() : void ref.current?.play())} title={playing ? 'Pause' : 'Play'}>
          {playing ? <Pause size={16} fill="currentColor" /> : <Play size={16} fill="currentColor" />}
        </button>
        <div className="att-audio-body">
          <div className="att-audio-title">{a.name || 'New Recording'}</div>
          <input
            type="range"
            min={0}
            max={duration || 1}
            step={0.01}
            value={time}
            onChange={(e) => {
              if (ref.current) ref.current.currentTime = Number(e.target.value)
            }}
          />
          <div className="att-audio-time">
            <span>{clock(time)}</span>
            <span>{clock(duration)}</span>
          </div>
        </div>
        <button title="Save as…" onClick={() => void saveAttachment(a)}>
          <Download size={15} />
        </button>
        {onDelete && (
          <button title="Delete" onClick={onDelete}>
            <Trash2 size={15} />
          </button>
        )}
        <audio
          ref={ref}
          src={url}
          preload="metadata"
          onPlay={() => setPlaying(true)}
          onPause={() => setPlaying(false)}
          onEnded={() => setPlaying(false)}
          onTimeUpdate={(e) => setTime(e.currentTarget.currentTime)}
          onLoadedMetadata={(e) => {
            const d = e.currentTarget.duration
            // MediaRecorder's WebM files don't say how long they are until read to the end.
            if (d === Infinity) {
              const el = e.currentTarget
              el.currentTime = 1e9
              const fix = () => {
                el.removeEventListener('timeupdate', fix)
                setDuration(el.duration)
                el.currentTime = 0
              }
              el.addEventListener('timeupdate', fix)
            } else setDuration(d)
          }}
        />
      </div>
    </NodeViewWrapper>
  )
}
