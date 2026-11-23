import { create } from 'zustand'
import type { AttachmentAttrs } from '../editor/attachment'
import { attachmentBytes, putAttachment } from '../lib/attachments'

// The canvas (Excalidraw, in src/canvas/CanvasEditor.tsx): a drawing that lives in a note as an
// attachment, its picture in `att` and its scene (Excalidraw's JSON) in `strokes`. While one is
// open it fills the note's card and the toolbar row becomes its tools (App.tsx).

export interface CanvasScene {
  type: 'excalidraw'
  elements: unknown[]
  appState?: Record<string, unknown>
  files?: Record<string, unknown>
}

interface OpenCanvas {
  /** The scene to start from (empty for a new canvas). */
  scene: CanvasScene | null
  /** Saves the finished canvas into the note (null when a new one was left empty). */
  done: (attrs: Partial<AttachmentAttrs> | null) => void
}

export const useCanvas = create<{ open: OpenCanvas | null }>(() => ({ open: null }))

export async function loadScene(id: string | null): Promise<CanvasScene | null> {
  if (!id) return null
  const bytes = await attachmentBytes(id)
  if (!bytes) return null
  try {
    return JSON.parse(new TextDecoder().decode(bytes)) as CanvasScene
  } catch {
    return null
  }
}

/** Saves a canvas: its scene and a picture of it, as the attachment node's attributes. */
export async function saveCanvas(sceneJson: string, png: Uint8Array): Promise<Partial<AttachmentAttrs>> {
  const strokes = await putAttachment(new TextEncoder().encode(sceneJson))
  const att = await putAttachment(png)
  return { att, strokes, kind: 'canvas', mime: 'image/png', size: png.length, name: 'Canvas', width: 'large' }
}

/** Opens a canvas (an existing one, or a new one); resolves with what to save, or null. */
export function openCanvas(scene: CanvasScene | null): Promise<Partial<AttachmentAttrs> | null> {
  return new Promise((resolve) => {
    useCanvas.setState({
      open: {
        scene,
        done: (attrs) => {
          useCanvas.setState({ open: null })
          resolve(attrs)
        }
      }
    })
  })
}
