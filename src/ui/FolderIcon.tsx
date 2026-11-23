import {
  Archive,
  Backpack,
  BookOpen,
  Bookmark,
  Briefcase,
  Calendar,
  Camera,
  Car,
  ChefHat,
  Code,
  Coffee,
  Dumbbell,
  Film,
  Flag,
  Flame,
  Folder,
  Gamepad2,
  Gift,
  GraduationCap,
  Heart,
  Home,
  Lightbulb,
  ListTodo,
  Map,
  Music,
  Palette,
  PawPrint,
  PiggyBank,
  Plane,
  Rocket,
  ShoppingCart,
  Sparkles,
  Sprout,
  Star,
  Stethoscope,
  Users,
  Wallet,
  Wrench,
  Zap,
  type LucideIcon
} from 'lucide-react'
import { useEffect, useState } from 'react'
import { loadBrands, searchBrands, usableColour, type Brand } from '../lib/brands'
import { useStore } from '../lib/store'
import type { Folder as FolderT } from '../lib/types'
import { openDialog } from './overlays'

// Folder icons for the pinned folder tiles (like Arc's pinned tabs): a Lucide icon or an emoji,
// and a colour.

export const FOLDER_ICONS: Record<string, LucideIcon> = {
  Folder,
  BookOpen,
  Briefcase,
  Lightbulb,
  ListTodo,
  Home,
  Heart,
  Star,
  Bookmark,
  Calendar,
  Code,
  Palette,
  Music,
  Film,
  Camera,
  Gamepad2,
  Plane,
  Map,
  Car,
  ShoppingCart,
  Wallet,
  PiggyBank,
  ChefHat,
  Coffee,
  Dumbbell,
  Stethoscope,
  GraduationCap,
  Backpack,
  Users,
  PawPrint,
  Sprout,
  Gift,
  Rocket,
  Sparkles,
  Flame,
  Zap,
  Flag,
  Wrench,
  Archive
}

export const FOLDER_COLORS = ['#8b5cf6', '#ec4899', '#f43f5e', '#f97316', '#eab308', '#22c55e', '#14b8a6', '#0ea5e9', '#3b82f6', '#64748b']

export function FolderGlyph({ folder, size = 18 }: { folder: Pick<FolderT, 'icon' | 'color' | 'id' | 'logo'>; size?: number }) {
  const icon = folder.icon ?? (folder.id === 'quick' ? 'lucide:Zap' : 'lucide:Folder')
  const color = folder.color ?? 'var(--accent)'
  if (icon.startsWith('brand:') && folder.logo) {
    // A brand's logo: its own colour, or the text colour for near-black and near-white ones.
    return (
      <svg width={size * 0.92} height={size * 0.92} viewBox="0 0 24 24" fill={folder.color ?? 'currentColor'} role="img" aria-label={icon.slice(6)}>
        <path d={folder.logo} />
      </svg>
    )
  }
  if (icon.startsWith('lucide:')) {
    const Icon = FOLDER_ICONS[icon.slice(7)] ?? Folder
    return <Icon size={size} color={color} strokeWidth={2} />
  }
  return (
    <span className="folder-emoji" style={{ fontSize: size * 0.95, lineHeight: 1 }}>
      {icon}
    </span>
  )
}

/** Search the brand logos (loaded on first use) and pick one. */
function BrandSearch({ selected, onPick }: { selected: string | null; onPick: (b: Brand) => void }) {
  const [query, setQuery] = useState('')
  const [list, setList] = useState<Brand[] | null>(null)
  const [open, setOpen] = useState(Boolean(selected))
  useEffect(() => {
    if (open && !list) void loadBrands().then(setList)
  }, [open, list])
  const results = list ? searchBrands(list, query) : []
  return (
    <>
      <div className="icon-picker-label">Or a brand’s logo</div>
      <input className="field brand-search" placeholder="Search 3,000+ brands and apps" value={query} onFocus={() => setOpen(true)} onChange={(e) => (setQuery(e.target.value), setOpen(true))} />
      {open && (
        <div className="icon-grid brand-grid">
          {!list ? (
            <span className="brand-empty">Loading logos…</span>
          ) : results.length ? (
            results.map((b) => (
              <button type="button" key={b.slug} className={`icon-cell${selected === b.slug ? ' is-on' : ''}`} style={selected === b.slug ? undefined : { color: usableColour(b.hex) }} title={b.title} onClick={() => onPick(b)}>
                <svg width={17} height={17} viewBox="0 0 24 24" fill="currentColor" aria-label={b.title}>
                  <path d={b.path} />
                </svg>
              </button>
            ))
          ) : (
            <span className="brand-empty">No brand called “{query}”</span>
          )}
        </div>
      )}
    </>
  )
}

function Picker({ folder, close }: { folder: FolderT; close: () => void }) {
  const [icon, setIcon] = useState(folder.icon ?? 'lucide:Folder')
  const [color, setColor] = useState(folder.color)
  const [name, setName] = useState(folder.name)
  const [emoji, setEmoji] = useState(icon.startsWith('lucide:') || icon.startsWith('brand:') ? '' : icon)
  const [logo, setLogo] = useState(folder.logo)
  const save = () => {
    const isBrand = icon.startsWith('brand:')
    useStore.getState().updateFolder(folder.id, { icon, color, logo: isBrand ? logo : undefined, name: name.trim() || folder.name })
    close()
  }
  return (
    <form
      className="icon-picker"
      onSubmit={(e) => {
        e.preventDefault()
        save()
      }}
    >
      <div className="icon-picker-head">
        <div className="tile is-preview" style={{ '--tile': color ?? 'var(--accent)' } as React.CSSProperties}>
          <FolderGlyph folder={{ id: folder.id, icon, color, logo }} size={22} />
        </div>
        <input className="field" value={name} onChange={(e) => setName(e.target.value)} placeholder="Folder name" autoFocus />
      </div>
      <div className="icon-picker-label">Icon</div>
      <div className="icon-grid">
        {Object.entries(FOLDER_ICONS).map(([k, Icon]) => (
          <button type="button" key={k} className={`icon-cell${icon === `lucide:${k}` ? ' is-on' : ''}`} onClick={() => (setIcon(`lucide:${k}`), setEmoji(''))} title={k}>
            <Icon size={17} />
          </button>
        ))}
      </div>
      <BrandSearch
        selected={icon.startsWith('brand:') ? icon.slice(6) : null}
        onPick={(b) => {
          setIcon(`brand:${b.slug}`)
          setLogo(b.path)
          setEmoji('')
          setColor(usableColour(b.hex))
        }}
      />
      <div className="icon-picker-row">
        <span className="icon-picker-label">Or an emoji</span>
        <input
          className="field is-emoji"
          value={emoji}
          maxLength={8}
          placeholder="😀"
          onChange={(e) => {
            const v = [...e.target.value.trim()].slice(0, 2).join('')
            setEmoji(v)
            if (v) setIcon(v)
          }}
        />
      </div>
      <div className="icon-picker-label">Colour</div>
      <div className="color-row">
        <button type="button" className={`color-dot is-theme${!color ? ' is-on' : ''}`} title="Theme colour" onClick={() => setColor(undefined)} />
        {FOLDER_COLORS.map((c) => (
          <button type="button" key={c} className={`color-dot${color === c ? ' is-on' : ''}`} style={{ background: c }} onClick={() => setColor(c)} />
        ))}
      </div>
      <div className="alert-buttons">
        <button type="button" className="btn" onClick={close}>
          Cancel
        </button>
        <button type="submit" className="btn btn-primary">
          Save
        </button>
      </div>
    </form>
  )
}

/** Rename a folder and choose its icon and colour. */
export function editFolderLook(folder: FolderT): void {
  openDialog((close) => <Picker folder={folder} close={close} />)
}
