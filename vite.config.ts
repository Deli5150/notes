import react from '@vitejs/plugin-react'
import fs from 'node:fs'
import path from 'node:path'
import { defineConfig, type Plugin } from 'vite'

// The app is a plain web build: desktop/ wraps it in Electron (served over app://), and the Android
// app wraps the same build (Capacitor). Relative paths, so it loads from any folder.

/**
 * Excalidraw (the canvas) loads its hand-drawn fonts from EXCALIDRAW_ASSET_PATH: copied into
 * public/excalidraw so they work offline (all but Xiaolai, a 12 MB Chinese font; the system's is used).
 */
function excalidrawFonts(): Plugin {
  return {
    name: 'excalidraw-fonts',
    buildStart() {
      const from = path.resolve('node_modules/@excalidraw/excalidraw/dist/prod/fonts')
      const to = path.resolve('public/excalidraw/fonts')
      if (!fs.existsSync(from)) return
      for (const family of fs.readdirSync(from)) {
        if (family === 'Xiaolai') continue
        fs.cpSync(path.join(from, family), path.join(to, family), { recursive: true })
      }
    }
  }
}

export default defineConfig({
  base: './',
  plugins: [react(), excalidrawFonts()],
  build: { outDir: 'desktop/web', emptyOutDir: true, chunkSizeWarningLimit: 4000 },
  server: { port: 5183, strictPort: true }
})
