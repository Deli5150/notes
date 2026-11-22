import type { Appearance } from './types'

// Colour themes: each has a light and a dark version (Settings → Appearance picks Light, Dark or
// follows the system). They're CSS variables on <html>, so the whole app follows at once.

export interface Palette {
  accent: string
  /** Text on the accent (selected rows, buttons). */
  onAccent: string
  /** The selected note (the accent unless the theme has its own). */
  select: string
  onSelect: string
  /** Selected note when the list isn't focused. */
  selectDim: string
  bg: string
  list: string
  sidebar: string
  /** The sidebar where the window can't be see-through. */
  sidebarSolid: string
  text: string
  dim: string
  faint: string
  sep: string
  hover: string
  field: string
  menu: string
  tag: string
  paperLine: string
}

export interface Theme {
  id: string
  name: string
  light: Palette
  dark: Palette
}

const LIGHT: Omit<Palette, 'accent' | 'onAccent' | 'tag' | 'select' | 'onSelect'> = {
  selectDim: 'rgba(0,0,0,0.08)',
  bg: '#ffffff',
  list: '#ffffff',
  sidebar: 'rgba(232,232,234,0.62)',
  sidebarSolid: '#ececee',
  text: '#1d1d1f',
  dim: '#6e6e73',
  faint: '#a1a1a6',
  sep: 'rgba(0,0,0,0.09)',
  hover: 'rgba(0,0,0,0.05)',
  field: 'rgba(0,0,0,0.05)',
  menu: 'rgba(246,246,246,0.94)',
  paperLine: 'rgba(0,0,0,0.09)'
}

const DARK: Omit<Palette, 'accent' | 'onAccent' | 'tag' | 'select' | 'onSelect'> = {
  selectDim: 'rgba(255,255,255,0.1)',
  bg: '#1e1e1e',
  list: '#232323',
  sidebar: 'rgba(40,40,42,0.6)',
  sidebarSolid: '#2a2a2c',
  text: '#f2f2f7',
  dim: '#98989d',
  faint: '#636366',
  sep: 'rgba(255,255,255,0.1)',
  hover: 'rgba(255,255,255,0.06)',
  field: 'rgba(255,255,255,0.08)',
  menu: 'rgba(42,42,44,0.94)',
  paperLine: 'rgba(255,255,255,0.1)'
}

function theme(id: string, name: string, light: [string, string], dark: [string, string], tints: { light?: Partial<Palette>; dark?: Partial<Palette> } = {}): Theme {
  return {
    id,
    name,
    light: { ...LIGHT, accent: light[0], onAccent: light[1], select: light[0], onSelect: light[1], tag: light[0], ...tints.light },
    dark: { ...DARK, accent: dark[0], onAccent: dark[1], select: dark[0], onSelect: dark[1], tag: dark[0], ...tints.dark }
  }
}

export const THEMES: Theme[] = [
  theme('classic', 'Classic', ['#e5a50a', '#1d1d1f'], ['#ffd60a', '#1d1d1f'], { light: { select: '#ffd84a', onSelect: '#1d1d1f' } }),
  theme('ocean', 'Ocean', ['#007aff', '#ffffff'], ['#0a84ff', '#ffffff']),
  theme('mint', 'Mint', ['#00a383', '#ffffff'], ['#63e6be', '#0c2a22']),
  theme('lavender', 'Lavender', ['#8e5cf7', '#ffffff'], ['#b18cff', '#1c1233']),
  theme('rose', 'Rose', ['#e3416e', '#ffffff'], ['#ff6b93', '#2b0a14']),
  theme('sunset', 'Sunset', ['#f2701d', '#ffffff'], ['#ff9f45', '#2b1500']),
  theme('forest', 'Forest', ['#2f8f4e', '#ffffff'], ['#5fd38a', '#0b2414'], {
    light: { bg: '#fbfdf9', list: '#f6faf3', sidebar: 'rgba(224,236,222,0.66)', sidebarSolid: '#e3ede0' },
    dark: { bg: '#18201a', list: '#1c251e', sidebar: 'rgba(30,44,34,0.62)', sidebarSolid: '#223026' }
  }),
  theme('graphite', 'Graphite', ['#6e6e73', '#ffffff'], ['#aeaeb2', '#1d1d1f']),
  theme('sepia', 'Paper', ['#a0632e', '#ffffff'], ['#d9a066', '#2a1c0f'], {
    light: { bg: '#fbf6ec', list: '#f6efe1', sidebar: 'rgba(236,225,204,0.7)', sidebarSolid: '#ece1cc', text: '#3b2f22', dim: '#85725c', faint: '#b3a38c', paperLine: 'rgba(120,80,30,0.14)', menu: 'rgba(250,244,232,0.96)' },
    dark: { bg: '#231d17', list: '#29221b', sidebar: 'rgba(48,40,32,0.66)', sidebarSolid: '#30281f', text: '#efe4d3', dim: '#a8977f', faint: '#6f6252', menu: 'rgba(48,40,32,0.96)' }
  }),
  theme('midnight', 'Midnight', ['#3b6fd4', '#ffffff'], ['#58a6ff', '#06101f'], {
    light: { bg: '#f7f9fc', list: '#f1f4f9', sidebar: 'rgba(220,228,240,0.7)', sidebarSolid: '#dfe6f1', text: '#16202e', dim: '#5b6b80' },
    dark: { bg: '#0d1117', list: '#111722', sidebar: 'rgba(22,30,44,0.66)', sidebarSolid: '#161e2c', text: '#e6edf3', dim: '#8b98a8', faint: '#57606b', menu: 'rgba(22,30,44,0.96)' }
  }),
  theme('cherry', 'Cherry Blossom', ['#d6487d', '#ffffff'], ['#ff8fb8', '#2c0a18'], {
    light: { bg: '#fffafc', list: '#fdf2f6', sidebar: 'rgba(250,224,234,0.66)', sidebarSolid: '#f8e1ea' },
    dark: { bg: '#1f171a', list: '#251b1f', sidebar: 'rgba(46,30,36,0.64)', sidebarSolid: '#2e1e24' }
  }),
  theme('nord', 'Nord', ['#5e81ac', '#ffffff'], ['#88c0d0', '#1b2230'], {
    light: { bg: '#eceff4', list: '#e5e9f0', sidebar: 'rgba(216,222,233,0.75)', sidebarSolid: '#d8dee9', text: '#2e3440', dim: '#4c566a' },
    dark: { bg: '#2e3440', list: '#323947', sidebar: 'rgba(59,66,82,0.7)', sidebarSolid: '#3b4252', text: '#eceff4', dim: '#a3acbd', faint: '#6b7487', menu: 'rgba(59,66,82,0.97)' }
  })
]

export const themeById = (id: string): Theme => THEMES.find((t) => t.id === id) ?? THEMES[0]

export function systemDark(): boolean {
  return typeof matchMedia !== 'undefined' && matchMedia('(prefers-color-scheme: dark)').matches
}

export const isDark = (appearance: Appearance): boolean => (appearance === 'system' ? systemDark() : appearance === 'dark')

const kebab = (k: string) => k.replace(/[A-Z]/g, (m) => `-${m.toLowerCase()}`)

/** Applies a theme to the page. */
export function applyTheme(id: string, appearance: Appearance, translucent: boolean): Palette {
  const dark = isDark(appearance)
  const p = themeById(id)[dark ? 'dark' : 'light']
  const root = document.documentElement
  for (const [k, v] of Object.entries(p)) root.style.setProperty(`--${kebab(k)}`, v)
  root.dataset.theme = dark ? 'dark' : 'light'
  root.style.colorScheme = dark ? 'dark' : 'light'
  root.dataset.translucent = translucent ? 'yes' : 'no'
  return p
}
