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
import { useEffect, useRef, useState } from 'react'
import { EMOJI_GROUPS, loadEmoji, recentEmoji, rememberEmoji, searchEmoji, type Emoji } from '../lib/emoji'
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
    <span className="folder-emoji" style={{ fontSize: size * 1.1, lineHeight: 1 }}>
      {icon}
    </span>
  )
}

/** Every emoji by category, with search and the recently used ones (loaded on first use). */
function EmojiPicker({ selected, onPick }: { selected: string; onPick: (emoji: string) => void }) {
  const [list, setList] = useState<Emoji[] | null>(null)
  const [query, setQuery] = useState('')
  const grid = useRef<HTMLDivElement>(null)
  useEffect(() => {
    void loadEmoji().then(setList)
  }, [])
  const pick = (e: string) => {
    rememberEmoji(e)
    onPick(e)
  }
  const cell = (e: Emoji | string) => {
    const emoji = typeof e === 'string' ? e : e.emoji
    return (
      <button type="button" key={emoji} className={`emoji-cell${selected === emoji ? ' is-on' : ''}`} title={typeof e === 'string' ? undefined : e.label} onClick={() => pick(emoji)}>
        {emoji}
      </button>
    )
  }
  const jump = (group: string | number) => grid.current?.querySelector(`[data-group="${group}"]`)?.scrollIntoView({ block: 'start' })
  const recent = recentEmoji()
  const results = list && query.trim() ? searchEmoji(list, query) : null
  return (
    <div className="icon-panel">
      <input className="field panel-search" placeholder="Search emoji" value={query} onChange={(e) => setQuery(e.target.value)} />
      {!query.trim() && (
        <div className="emoji-tabs">
          {recent.length > 0 && (
            <button type="button" title="Recently Used" onClick={() => jump('recent')}>
              🕘
            </button>
          )}
          {EMOJI_GROUPS.map((g) => (
            <button type="button" key={g.id} title={g.label} onClick={() => jump(g.id)}>
              {g.icon}
            </button>
          ))}
        </div>
      )}
      <div className="emoji-grid" ref={grid}>
        {!list ? (
          <span className="brand-empty">Loading emoji…</span>
        ) : results ? (
          results.length ? (
            <div className="emoji-cells">{results.map(cell)}</div>
          ) : (
            <span className="brand-empty">No emoji for “{query}”</span>
          )
        ) : (
          <>
            {recent.length > 0 && (
              <section data-group="recent">
                <div className="emoji-group">Recently Used</div>
                <div className="emoji-cells">{recent.map(cell)}</div>
              </section>
            )}
            {EMOJI_GROUPS.map((g) => (
              <section key={g.id} data-group={g.id}>
                <div className="emoji-group">{g.label}</div>
                <div className="emoji-cells">{list.filter((e) => e.group === g.id).map(cell)}</div>
              </section>
            ))}
          </>
        )}
      </div>
    </div>
  )
}

/** Search the brand logos (loaded on first use) and pick one. */
function BrandSearch({ selected, onPick }: { selected: string | null; onPick: (b: Brand) => void }) {
  const [query, setQuery] = useState('')
  const [list, setList] = useState<Brand[] | null>(null)
  useEffect(() => {
    void loadBrands().then(setList)
  }, [])
  const results = list ? searchBrands(list, query, 64) : []
  return (
    <div className="icon-panel">
      <input className="field panel-search" placeholder="Search 3,000+ brands and apps" value={query} onChange={(e) => setQuery(e.target.value)} />
      {!query.trim() && <div className="panel-note">Popular</div>}
      <div className="icon-grid brand-grid">
        {!list ? (
          <span className="brand-empty">Loading logos…</span>
        ) : results.length ? (
          results.map((b) => (
            <button type="button" key={b.slug} className={`icon-cell${selected === b.slug ? ' is-on' : ''}`} style={selected === b.slug ? undefined : { color: usableColour(b.hex) }} title={b.title} onClick={() => onPick(b)}>
              <svg width={18} height={18} viewBox="0 0 24 24" fill="currentColor" aria-label={b.title}>
                <path d={b.path} />
              </svg>
            </button>
          ))
        ) : (
          <span className="brand-empty">No brand called “{query}”</span>
        )}
      </div>
    </div>
  )
}

type IconTab = 'icons' | 'brands' | 'emoji'

function Picker({ folder, close }: { folder: FolderT; close: () => void }) {
  const [icon, setIcon] = useState(folder.icon ?? 'lucide:Folder')
  const [color, setColor] = useState(folder.color)
  const [name, setName] = useState(folder.name)
  const [logo, setLogo] = useState(folder.logo)
  const [tab, setTab] = useState<IconTab>(icon.startsWith('brand:') ? 'brands' : icon.startsWith('lucide:') ? 'icons' : 'emoji')
  const emoji = icon.startsWith('lucide:') || icon.startsWith('brand:') ? '' : icon
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
      <div className="icon-tabs" role="tablist">
        {(
          [
            ['icons', 'Icons'],
            ['brands', 'Brand Logos'],
            ['emoji', 'Emoji']
          ] as const
        ).map(([id, label]) => (
          <button type="button" role="tab" aria-selected={tab === id} key={id} className={tab === id ? 'is-on' : undefined} onClick={() => setTab(id)}>
            {label}
          </button>
        ))}
      </div>
      {tab === 'icons' && (
        <div className="icon-panel">
          <div className="icon-grid">
            {Object.entries(FOLDER_ICONS).map(([k, Icon]) => (
              <button type="button" key={k} className={`icon-cell${icon === `lucide:${k}` ? ' is-on' : ''}`} onClick={() => setIcon(`lucide:${k}`)} title={k}>
                <Icon size={17} />
              </button>
            ))}
          </div>
        </div>
      )}
      {tab === 'brands' && (
        <BrandSearch
          selected={icon.startsWith('brand:') ? icon.slice(6) : null}
          onPick={(b) => {
            setIcon(`brand:${b.slug}`)
            setLogo(b.path)
            setColor(usableColour(b.hex))
          }}
        />
      )}
      {tab === 'emoji' && (
        <EmojiPicker
          selected={emoji}
          onPick={(e) => {
            setIcon(e)
            setLogo(undefined)
          }}
        />
      )}
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
