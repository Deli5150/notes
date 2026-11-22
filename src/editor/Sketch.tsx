import { getStroke } from 'perfect-freehand'
import { Eraser, Highlighter, Pen, Pencil, Plus, Redo2, Trash2, Undo2 } from 'lucide-react'
import { useEffect, useMemo, useRef, useState } from 'react'
import { attachmentBytes, putAttachment } from '../lib/attachments'
import { openDialog } from '../ui/overlays'
import type { AttachmentAttrs } from './attachment'

// Sketches: drawn with the mouse, a trackpad or a pen (pressure where the device reports it). The
// strokes are kept (an attachment of their own) so a sketch can be edited again; a picture of it
// is saved too, for the list's thumbnail, exports and other apps. "Ink" follows the theme: black
// on light, white on dark.

export type Tool = 'pen' | 'marker' | 'pencil' | 'eraser'

export interface Stroke {
  tool: Exclude<Tool, 'eraser'>
  color: string
  size: number
  points: number[][]
}

export interface SketchData {
  width: number
  height: number
  strokes: Stroke[]
}

export const INK = 'ink'
const COLORS = [INK, '#0a84ff', '#30d158', '#ffd60a', '#ff9f0a', '#ff453a', '#bf5af2']
const SIZES = [2, 4, 8]

function strokeOptions(s: Stroke) {
  if (s.tool === 'marker') return { size: s.size * 4, thinning: 0, smoothing: 0.6, streamline: 0.5, simulatePressure: false }
  if (s.tool === 'pencil') return { size: Math.max(1.2, s.size * 0.6), thinning: 0.7, smoothing: 0.4, streamline: 0.4 }
  return { size: s.size * 1.6, thinning: 0.55, smoothing: 0.55, streamline: 0.5, simulatePressure: s.points.every((p) => p[2] === 0.5) }
}

export function strokePath(s: Stroke): string {
  const pts = getStroke(s.points, strokeOptions(s))
  if (!pts.length) return ''
  const d = pts.reduce<(string | number)[]>(
    (acc, [x0, y0], i, arr) => {
      const [x1, y1] = arr[(i + 1) % arr.length]
      acc.push(x0.toFixed(1), y0.toFixed(1), ((x0 + x1) / 2).toFixed(1), ((y0 + y1) / 2).toFixed(1))
      return acc
    },
    ['M', ...pts[0].map((n) => n.toFixed(1)), 'Q']
  )
  return `${d.join(' ')} Z`
}

const opacityOf = (s: Stroke) => (s.tool === 'marker' ? 0.38 : s.tool === 'pencil' ? 0.85 : 1)

/** The sketch as an SVG drawing (ink in `ink`). */
export function sketchSvg(data: SketchData, ink: string): string {
  const paths = data.strokes.map((s) => `<path d="${strokePath(s)}" fill="${s.color === INK ? ink : s.color}" fill-opacity="${opacityOf(s)}"/>`).join('')
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${data.width} ${data.height}" width="${data.width}" height="${data.height}">${paths}</svg>`
}

async function sketchPng(data: SketchData): Promise<Uint8Array> {
  const img = new Image()
  img.src = `data:image/svg+xml;charset=utf-8,${encodeURIComponent(sketchSvg(data, '#1d1d1f'))}`
  await img.decode()
  const canvas = document.createElement('canvas')
  canvas.width = data.width * 2
  canvas.height = data.height * 2
  const ctx = canvas.getContext('2d')!
  ctx.fillStyle = '#ffffff'
  ctx.fillRect(0, 0, canvas.width, canvas.height)
  ctx.drawImage(img, 0, 0, canvas.width, canvas.height)
  const blob = await new Promise<Blob>((r) => canvas.toBlob((b) => r(b!), 'image/png'))
  return new Uint8Array(await blob.arrayBuffer())
}

function distToSegment(p: number[], a: number[], b: number[]): number {
  const dx = b[0] - a[0]
  const dy = b[1] - a[1]
  const t = dx || dy ? Math.max(0, Math.min(1, ((p[0] - a[0]) * dx + (p[1] - a[1]) * dy) / (dx * dx + dy * dy))) : 0
  return Math.hypot(p[0] - (a[0] + t * dx), p[1] - (a[1] + t * dy))
}

const touches = (s: Stroke, p: number[], r: number) => s.points.some((q, i) => distToSegment(p, q, s.points[i + 1] ?? q) < r + s.size)

function SketchEditor({ initial, onDone, onCancel }: { initial: SketchData; onDone: (d: SketchData) => void; onCancel: () => void }) {
  const [data, setData] = useState<SketchData>(initial)
  const [undo, setUndo] = useState<SketchData[]>([])
  const [redo, setRedo] = useState<SketchData[]>([])
  const [tool, setTool] = useState<Tool>('pen')
  const [color, setColor] = useState(INK)
  const [size, setSize] = useState(SIZES[1])
  const [live, setLive] = useState<Stroke | null>(null)
  const svg = useRef<SVGSVGElement>(null)
  const drawing = useRef(false)
  // The stroke being drawn, kept outside React state so fast strokes never lose points.
  const liveRef = useRef<Stroke | null>(null)
  const dataRef = useRef(data)
  dataRef.current = data

  const commit = (next: SketchData) => {
    const prev = dataRef.current
    setUndo((u) => [...u.slice(-80), prev])
    setRedo([])
    dataRef.current = next
    setData(next)
  }

  const point = (e: React.PointerEvent): number[] => {
    const r = svg.current!.getBoundingClientRect()
    const scale = data.width / r.width
    return [(e.clientX - r.left) * scale, (e.clientY - r.top) * scale, e.pointerType === 'pen' ? e.pressure : 0.5]
  }

  const erase = (p: number[]) => {
    const d = dataRef.current
    const kept = d.strokes.filter((s) => !touches(s, p, 6))
    if (kept.length !== d.strokes.length) {
      dataRef.current = { ...d, strokes: kept }
      setData(dataRef.current)
    }
  }

  useEffect(() => {
    const key = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'z') {
        e.preventDefault()
        e.stopPropagation()
        if (e.shiftKey) doRedo()
        else doUndo()
      }
    }
    addEventListener('keydown', key, true)
    return () => removeEventListener('keydown', key, true)
  })

  const doUndo = () => {
    const prev = undo[undo.length - 1]
    if (!prev) return
    setRedo((r) => [...r, data])
    setUndo((u) => u.slice(0, -1))
    setData(prev)
  }
  const doRedo = () => {
    const next = redo[redo.length - 1]
    if (!next) return
    setUndo((u) => [...u, data])
    setRedo((r) => r.slice(0, -1))
    setData(next)
  }

  const paths = useMemo(() => data.strokes.map((s) => ({ s, d: strokePath(s) })), [data.strokes])

  return (
    <div className="sketch">
      <div className="sketch-bar">
        <button className="btn" onClick={onCancel}>
          Cancel
        </button>
        <div className="sketch-tools">
          {(
            [
              ['pen', Pen, 'Pen'],
              ['marker', Highlighter, 'Marker'],
              ['pencil', Pencil, 'Pencil'],
              ['eraser', Eraser, 'Eraser']
            ] as const
          ).map(([t, Icon, label]) => (
            <button key={t} className={`icon-btn${tool === t ? ' is-on' : ''}`} title={label} onClick={() => setTool(t)}>
              <Icon size={17} />
            </button>
          ))}
          <span className="sketch-sep" />
          {SIZES.map((s) => (
            <button key={s} className={`icon-btn${size === s ? ' is-on' : ''}`} title={`Size ${s}`} onClick={() => setSize(s)}>
              <span className="sketch-dot" style={{ width: s + 3, height: s + 3 }} />
            </button>
          ))}
          <span className="sketch-sep" />
          {COLORS.map((c) => (
            <button key={c} className={`sketch-color${color === c ? ' is-on' : ''}`} style={{ background: c === INK ? 'var(--text)' : c }} title={c === INK ? 'Ink' : c} onClick={() => (setColor(c), tool === 'eraser' && setTool('pen'))} />
          ))}
          <label className="sketch-color sketch-custom" title="Other colour">
            <input type="color" onChange={(e) => (setColor(e.target.value), tool === 'eraser' && setTool('pen'))} />
          </label>
          <span className="sketch-sep" />
          <button className="icon-btn" title="Undo" disabled={!undo.length} onClick={doUndo}>
            <Undo2 size={17} />
          </button>
          <button className="icon-btn" title="Redo" disabled={!redo.length} onClick={doRedo}>
            <Redo2 size={17} />
          </button>
          <button className="icon-btn" title="Clear" disabled={!data.strokes.length} onClick={() => commit({ ...data, strokes: [] })}>
            <Trash2 size={17} />
          </button>
          <button className="icon-btn" title="Add space below" onClick={() => commit({ ...data, height: data.height + 240 })}>
            <Plus size={17} />
          </button>
        </div>
        <button className="btn btn-primary" onClick={() => onDone(data)}>
          Done
        </button>
      </div>
      <div className="sketch-canvas">
        <svg
          ref={svg}
          viewBox={`0 0 ${data.width} ${data.height}`}
          style={{ aspectRatio: `${data.width} / ${data.height}` }}
          onPointerDown={(e) => {
            try {
              ;(e.target as Element).setPointerCapture(e.pointerId)
            } catch {}
            drawing.current = true
            const p = point(e)
            if (tool === 'eraser') {
              setUndo((u) => [...u.slice(-80), data])
              setRedo([])
              erase(p)
            } else {
              liveRef.current = { tool, color, size, points: [p] }
              setLive(liveRef.current)
            }
          }}
          onPointerMove={(e) => {
            if (!drawing.current) return
            const p = point(e)
            if (tool === 'eraser') erase(p)
            else if (liveRef.current) {
              liveRef.current = { ...liveRef.current, points: [...liveRef.current.points, p] }
              setLive(liveRef.current)
            }
          }}
          onPointerUp={() => {
            drawing.current = false
            const l = liveRef.current
            liveRef.current = null
            if (l && l.points.length) commit({ ...dataRef.current, strokes: [...dataRef.current.strokes, l.points.length === 1 ? { ...l, points: [...l.points, l.points[0]] } : l] })
            setLive(null)
          }}
        >
          {paths.map(({ s, d }, i) => (
            <path key={i} d={d} fill={s.color === INK ? 'var(--text)' : s.color} fillOpacity={opacityOf(s)} />
          ))}
          {live && <path d={strokePath(live)} fill={live.color === INK ? 'var(--text)' : live.color} fillOpacity={opacityOf(live)} />}
        </svg>
      </div>
    </div>
  )
}

const blank = (): SketchData => ({ width: 900, height: 520, strokes: [] })

async function loadStrokes(id: string | null): Promise<SketchData> {
  if (!id) return blank()
  const bytes = await attachmentBytes(id)
  try {
    return bytes ? (JSON.parse(new TextDecoder().decode(bytes)) as SketchData) : blank()
  } catch {
    return blank()
  }
}

/** Saves a sketch: its strokes and a picture of it. */
async function saveSketch(data: SketchData): Promise<Partial<AttachmentAttrs>> {
  const strokes = await putAttachment(new TextEncoder().encode(JSON.stringify(data)))
  const png = await sketchPng(data)
  const att = await putAttachment(png)
  return { att, strokes, kind: 'sketch', mime: 'image/png', size: png.length, name: 'Sketch' }
}

function editSketch(initial: SketchData): Promise<SketchData | null> {
  return new Promise((resolve) => {
    openDialog(
      (close) => (
        <SketchEditor
          initial={initial}
          onCancel={() => (close(), resolve(null))}
          onDone={(d) => {
            close()
            resolve(d)
          }}
        />
      ),
      { dismissable: false, wide: true }
    )
  })
}

/** Opens an existing sketch for editing. */
export async function openSketch(a: AttachmentAttrs, update: (attrs: Partial<AttachmentAttrs>) => void): Promise<void> {
  const data = await editSketch(await loadStrokes(a.strokes))
  if (data) update(await saveSketch(data))
}

/** Draws a new sketch; resolves with the attachment's attributes (or null if cancelled). */
export async function newSketch(): Promise<Partial<AttachmentAttrs> | null> {
  const data = await editSketch(blank())
  return data && data.strokes.length ? saveSketch(data) : null
}

/** A sketch drawn from its strokes, so its ink follows the theme. */
export function SketchView({ strokes, fallback, alt }: { strokes: string | null; fallback: string; alt: string }) {
  const [data, setData] = useState<SketchData | null>(null)
  useEffect(() => {
    let live = true
    if (strokes) void loadStrokes(strokes).then((d) => live && setData(d.strokes.length ? d : null))
    return () => {
      live = false
    }
  }, [strokes])
  if (!data) return fallback ? <img src={fallback} alt={alt} draggable={false} /> : null
  return (
    <svg className="sketch-view" viewBox={`0 0 ${data.width} ${data.height}`} role="img" aria-label={alt}>
      {data.strokes.map((s, i) => (
        <path key={i} d={strokePath(s)} fill={s.color === INK ? 'var(--text)' : s.color} fillOpacity={opacityOf(s)} />
      ))}
    </svg>
  )
}
