import { create } from 'zustand'
import { desktop, isMac } from './storage'
import { useStore } from './store'

// Keyboard shortcuts. The desktop app owns the list (desktop/main.cjs: every menu command and a few
// more); Settings → Shortcuts changes their keys, kept in settings.shortcuts as { id: keys } ("" for
// none). Keys are accelerators such as "CmdOrCtrl+Shift+N": ⌘ on a Mac, Ctrl on Windows.

export interface Shortcut {
  id: string
  label: string
  group: string
  /** The keys it comes with. */
  def: string
  /** The keys it has now ("" for none). */
  keys: string
  /** Works while Notes is in the background. */
  global: boolean
}

export const useShortcuts = create<{ list: Shortcut[] }>(() => ({ list: [] }))

/** Sends the chosen keys to the desktop app, which rebuilds its menu and hands back the list. */
export async function applyShortcuts(): Promise<void> {
  if (!desktop) return
  const list = await desktop.shortcuts.set(useStore.getState().settings.shortcuts ?? {})
  useShortcuts.setState({ list })
}

const MAC_MODS: Record<string, string> = { Ctrl: '⌃', Alt: '⌥', Shift: '⇧', CmdOrCtrl: '⌘', Super: '⌘' }
const WIN_MODS: Record<string, string> = { CmdOrCtrl: 'Ctrl', Ctrl: 'Ctrl', Alt: 'Alt', Shift: 'Shift', Super: 'Win' }
const MAC_KEYS: Record<string, string> = { Up: '↑', Down: '↓', Left: '←', Right: '→', Enter: '↩', Backspace: '⌫', Delete: '⌦', Escape: '⎋', Tab: '⇥', Space: 'Space', PageUp: '⇞', PageDown: '⇟' }
const MAC_ORDER = ['Ctrl', 'Alt', 'Shift', 'CmdOrCtrl', 'Super']

/** "CmdOrCtrl+Shift+N" as people read it: ⇧⌘N on a Mac, Ctrl+Shift+N on Windows. */
export function formatKeys(keys: string): string {
  if (!keys) return ''
  const parts = keys.split('+')
  // "CmdOrCtrl+-": the last part is the key even when it's a "-" or "=".
  const key = parts.pop() || '+'
  const k = key.startsWith('num') ? `Num ${key.slice(3)}` : key
  if (isMac) return MAC_ORDER.filter((m) => parts.includes(m)).map((m) => MAC_MODS[m]).join('') + (MAC_KEYS[k] ?? k)
  return [...parts.map((m) => WIN_MODS[m] ?? m), k].join('+')
}

/** The keys a command has now, ready to show ("" for none, or before the desktop app answers). */
export const keysLabel = (id: string): string => formatKeys(useShortcuts.getState().list.find((s) => s.id === id)?.keys ?? '')

/** "Bold (⌘B)", or just "Bold" when it has no keys. */
export const withKeys = (label: string, id: string): string => {
  const k = keysLabel(id)
  return k ? `${label} (${k})` : label
}

/** The same, kept up to date in a component. */
export const useKeys = (id: string): string => formatKeys(useShortcuts((s) => s.list.find((x) => x.id === id)?.keys ?? ''))

/** Keys that can be given to a command: with a modifier (Shift alone doesn't count), or a function key. */
export const assignable = (keys: string): boolean => /^F\d{1,2}$/.test(keys.split('+').pop() ?? '') || /(CmdOrCtrl|Ctrl|Alt|Super)\+/.test(keys)
