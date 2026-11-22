import { registerPlugin } from '@capacitor/core'
import { isAndroid } from './storage'
import type { Palette } from './themes'

// The Android app's own bits (android/app/src/main/java/app/notes/android/NotesNativePlugin.java).

interface NotesNative {
  setBackground(o: { color: string; dark: boolean }): Promise<void>
}

const native = isAndroid ? registerPlugin<NotesNative>('NotesNative') : null

const hex = (c: string): [number, number, number] | null => {
  const m = /^#([0-9a-f]{6})$/i.exec(c.trim())
  return m ? [0, 2, 4].map((i) => parseInt(m[1].slice(i, i + 2), 16)) as [number, number, number] : null
}

/** a mixed with b, like CSS color-mix (share is a's part, 0–1). */
function mix(a: string, b: string, share: number): string {
  const x = hex(a)
  const y = hex(b)
  if (!x || !y) return b
  return `#${x.map((v, i) => Math.round(v * share + y[i] * (1 - share)).toString(16).padStart(2, '0')).join('')}`
}

/** The status and navigation bars: the colour of what's under them, light or dark icons. */
export function paintBars(p: Palette, dark: boolean, screen: 'list' | 'note'): void {
  if (!native) return
  // The list sits on the tinted canvas (app.css .app); a note on its card.
  void native.setBackground({ color: screen === 'note' ? p.bg : mix(p.accent, p.sidebarSolid, 0.2), dark })
}
