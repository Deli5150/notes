import type { CapacitorConfig } from '@capacitor/cli'

// The Android app: the same web build as the desktop app (vite → desktop/web) in Capacitor.
const config: CapacitorConfig = {
  appId: 'app.notes.android',
  appName: 'Notes',
  webDir: 'desktop/web',
  android: { allowMixedContent: false, backgroundColor: '#2b2b2d' },
  // Notes draws behind the status and navigation bars itself (NotesNativePlugin hands the page the
  // bars' sizes), so the app's own background fills them on every WebView version.
  plugins: { SystemBars: { insetsHandling: 'disable' } }
}

export default config
