import '@excalidraw/excalidraw/index.css'
import { convertToExcalidrawElements, Excalidraw, exportToBlob, serializeAsJSON } from '@excalidraw/excalidraw'
import type { ExcalidrawImperativeAPI } from '@excalidraw/excalidraw/types'
import {
  ArrowRight,
  Check,
  Circle,
  Diamond,
  Eraser,
  Frame,
  Hand,
  Image,
  Lock,
  LockOpen,
  MoreHorizontal,
  Minus,
  MousePointer2,
  Pencil,
  Pointer,
  Square,
  Type
} from 'lucide-react'
import { useEffect, useRef, useState } from 'react'
import { isPhone } from '../lib/phone'
import { menuUnder } from '../ui/overlays'
import { desktop } from '../lib/storage'
import { saveCanvas, useCanvas } from './state'

// The canvas: Excalidraw, with its own tool bar hidden and its tools in the note's toolbar row
// instead (select, hand, shapes, arrows, lines, pencil, text, pictures, eraser, laser, frames).
// Excalidraw's style panel, zoom, undo, library and menu stay as they are.

type Tool = 'selection' | 'hand' | 'rectangle' | 'diamond' | 'ellipse' | 'arrow' | 'line' | 'freedraw' | 'text' | 'image' | 'eraser' | 'laser' | 'frame'

const TOOLS: Array<[Tool, string, string, React.ReactNode]> = [
  ['selection', 'Select', 'V', <MousePointer2 size={16} />],
  ['hand', 'Hand (move around)', 'H', <Hand size={16} />],
  ['rectangle', 'Rectangle', 'R', <Square size={16} />],
  ['diamond', 'Diamond', 'D', <Diamond size={16} />],
  ['ellipse', 'Ellipse', 'O', <Circle size={16} />],
  ['arrow', 'Arrow', 'A', <ArrowRight size={16} />],
  ['line', 'Line', 'L', <Minus size={16} />],
  ['freedraw', 'Draw', 'P', <Pencil size={16} />],
  ['text', 'Text', 'T', <Type size={16} />],
  ['image', 'Insert picture', '9', <Image size={16} />],
  ['eraser', 'Eraser', 'E', <Eraser size={16} />],
  ['laser', 'Laser pointer', 'K', <Pointer size={16} />],
  ['frame', 'Frame', 'F', <Frame size={16} />]
]

/** A phone has room for these; the rest are in its More menu. */
const PHONE_TOOLS = new Set<Tool>(['selection', 'hand', 'rectangle', 'ellipse', 'arrow', 'freedraw', 'text', 'eraser'])

// Excalidraw's fonts are copied next to the app (vite.config.ts) and found through
// EXCALIDRAW_ASSET_PATH, set in index.html before Excalidraw loads, so the canvas works offline.

export default function CanvasEditor({ dark }: { dark: boolean }) {
  const open = useCanvas((s) => s.open)
  const api = useRef<ExcalidrawImperativeAPI | null>(null)
  const [tool, setTool] = useState<Tool>('selection')
  const [saving, setSaving] = useState(false)
  const [locked, setLocked] = useState(false)

  // The desktop app hands it ⌘Z, ⌘A, ⌘D and the like (which its menu would otherwise take).
  useEffect(() => {
    desktop?.setCanvasOpen(true)
    const off = desktop?.onCanvasKey((k) => document.dispatchEvent(new KeyboardEvent('keydown', { ...k, bubbles: true, cancelable: true })))
    return () => {
      desktop?.setCanvasOpen(false)
      off?.()
      useCanvas.setState({ finish: null })
    }
  }, [])

  if (!open) return null

  const done = async () => {
    const a = api.current
    if (!a) return open.done(null)
    const elements = a.getSceneElements()
    if (!elements.length) return open.done(null)
    setSaving(true)
    try {
      const appState = a.getAppState()
      const files = a.getFiles()
      const scene = serializeAsJSON(elements, appState, files, 'local')
      const blob = await exportToBlob({ elements, appState: { ...appState, exportBackground: true, exportWithDarkMode: false, exportScale: 2 }, files, mimeType: 'image/png', exportPadding: 24 })
      open.done(await saveCanvas(scene, new Uint8Array(await blob.arrayBuffer())))
    } catch (e) {
      console.warn('Notes: could not save the canvas', e)
      open.done(null)
    } finally {
      setSaving(false)
    }
  }

  useCanvas.setState({ finish: () => void done() })

  const pick = (t: Tool) => {
    api.current?.setActiveTool({ type: t, locked })
    setTool(t)
  }

  const phone = isPhone()
  const shown = phone ? TOOLS.filter(([t]) => PHONE_TOOLS.has(t)) : TOOLS
  const more = (el: Element) =>
    menuUnder(
      el,
      [
        ...TOOLS.filter(([t]) => !PHONE_TOOLS.has(t)).map(([t, label, , icon]) => ({ label, icon, checked: tool === t, onClick: () => pick(t) })),
        { separator: true },
        {
          label: 'Keep Tool On',
          checked: locked,
          onClick: () => {
            setLocked(!locked)
            api.current?.setActiveTool({ type: tool, locked: !locked })
          }
        }
      ],
      'right'
    )

  return (
    <div className={`canvas-stage${phone ? ' is-phone' : ''}`}>
      <div className="toolbar canvas-toolbar">
        <div className="tb-group canvas-tools">
          {phone && (
            <button className="tb-btn" title="More tools" onClick={(e) => more(e.currentTarget)}>
              <MoreHorizontal size={16} />
            </button>
          )}
          {shown.map(([t, label, key, icon]) => (
            <button key={t} className={`tb-btn${tool === t ? ' is-on' : ''}`} title={`${label} (${key})`} aria-pressed={tool === t} onClick={() => pick(t)}>
              {icon}
            </button>
          ))}
        </div>
        {!phone && (
        <button
          className={`tb-btn canvas-lock${locked ? ' is-on' : ''}`}
          title={locked ? 'Tool stays on after drawing (Q)' : 'Keep the tool on after drawing (Q)'}
          onClick={() => {
            setLocked(!locked)
            api.current?.setActiveTool({ type: tool, locked: !locked })
          }}
        >
          {locked ? <Lock size={15} /> : <LockOpen size={15} />}
        </button>
        )}
        <span className="tb-flex" />
        <button className="btn btn-primary canvas-done" disabled={saving} onClick={() => void done()}>
          <Check size={15} /> {saving ? 'Saving…' : 'Done'}
        </button>
      </div>
      <div className="canvas-host">
        <Excalidraw
          excalidrawAPI={(a) => {
            api.current = a
            if (open.tool) setTimeout(() => pick(open.tool as Tool))
            // For tests (like window.__notes): the open canvas and Excalidraw's helpers.
            ;(window as unknown as { __canvas: unknown }).__canvas = { api: a, convertToExcalidrawElements, done }
          }}
          initialData={open.scene ? { elements: open.scene.elements as never, appState: { ...(open.scene.appState ?? {}), collaborators: new Map() } as never, files: (open.scene.files ?? {}) as never, scrollToContent: true } : { appState: { viewBackgroundColor: '#ffffff' } }}
          theme={dark ? 'dark' : 'light'}
          handleKeyboardGlobally
          aiEnabled={false}
          UIOptions={{ canvasActions: { loadScene: false, saveToActiveFile: false, export: false, toggleTheme: null, saveAsImage: true, clearCanvas: true, changeViewBackgroundColor: true }, dockedSidebarBreakpoint: isPhone() ? 100000 : 900 }}
          onChange={(_els, appState) => {
            const t = appState.activeTool.type as Tool
            if (t !== tool) setTool(t)
            if (appState.activeTool.locked !== locked) setLocked(appState.activeTool.locked)
          }}
        />
      </div>
    </div>
  )
}
