import react from '@vitejs/plugin-react'
import { defineConfig } from 'vite'

// The app is a plain web build: desktop/ wraps it in Electron (served over app://), and the Android
// app will wrap the same build. Relative paths, so it loads from any folder.
export default defineConfig({
  base: './',
  plugins: [react()],
  build: { outDir: 'desktop/web', emptyOutDir: true, chunkSizeWarningLimit: 4000 },
  server: { port: 5183, strictPort: true }
})
