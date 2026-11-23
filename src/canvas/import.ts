import { escapeHtml } from '../lib/content'
import { saveCanvas, type CanvasScene } from './state'

// Excalidraw files (.excalidraw, the JSON excalidraw.com saves) as notes: each one a note with an
// editable canvas, its picture made the same way the canvas editor makes it.

/** The note HTML for an Excalidraw scene (titled with the file's name). */
export async function excalidrawToHtml(json: string, title: string): Promise<string> {
  let scene: CanvasScene
  try {
    scene = JSON.parse(json) as CanvasScene
  } catch {
    throw new Error('not an Excalidraw file')
  }
  if (scene.type !== 'excalidraw' || !Array.isArray(scene.elements)) throw new Error('not an Excalidraw drawing')
  ;(window as unknown as { EXCALIDRAW_ASSET_PATH: string }).EXCALIDRAW_ASSET_PATH = new URL('./excalidraw/', location.href).href
  const { exportToBlob, restore, serializeAsJSON } = await import('@excalidraw/excalidraw')
  const data = restore(scene as never, null, null)
  const elements = data.elements.filter((e) => !e.isDeleted)
  if (!elements.length) throw new Error('the drawing is empty')
  const blob = await exportToBlob({ elements, appState: { ...data.appState, exportBackground: true, exportWithDarkMode: false, exportScale: 2 }, files: data.files, mimeType: 'image/png', exportPadding: 24 })
  const png = new Uint8Array(await blob.arrayBuffer())
  const a = await saveCanvas(serializeAsJSON(elements, data.appState, data.files, 'local'), png)
  return `<h1>${escapeHtml(title)}</h1><figure data-attachment data-att="${a.att}" data-kind="canvas" data-strokes="${a.strokes}" data-mime="image/png" data-name="Canvas" data-size="${a.size}" data-width="large"></figure>`
}
