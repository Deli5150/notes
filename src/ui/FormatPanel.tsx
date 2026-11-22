import type { Editor } from '@tiptap/core'
import { useEditorState } from '@tiptap/react'
import { AlignCenter, AlignJustify, AlignLeft, AlignRight, Bold, IndentDecrease, IndentIncrease, Italic, RemoveFormatting, Strikethrough, Subscript, Superscript, Underline } from 'lucide-react'
import { useEffect, useLayoutEffect, useRef, useState } from 'react'
import { FONT_FAMILIES, HIGHLIGHTS, TEXT_COLORS } from '../editor/setup'
import { MOD, SHIFT } from './actions'

// The "Aa" panel: Apple Notes' paragraph styles, then text styles, highlights, colours, fonts,
// sizes, alignment and indentation.

type Style = { id: string; label: string; cls: string; active: (e: Editor) => boolean; run: (e: Editor) => void; shortcut?: string }

const toBody = (e: Editor) => e.chain().focus().clearNodes().setParagraph().run()

export const STYLES: Style[] = [
  { id: 'title', label: 'Title', cls: 'fs-title', shortcut: `${SHIFT}${MOD}T`, active: (e) => e.isActive('heading', { level: 1 }), run: (e) => e.chain().focus().clearNodes().setHeading({ level: 1 }).run() },
  { id: 'heading', label: 'Heading', cls: 'fs-heading', shortcut: `${SHIFT}${MOD}H`, active: (e) => e.isActive('heading', { level: 2 }), run: (e) => e.chain().focus().clearNodes().setHeading({ level: 2 }).run() },
  { id: 'subheading', label: 'Subheading', cls: 'fs-subheading', shortcut: `${SHIFT}${MOD}J`, active: (e) => e.isActive('heading', { level: 3 }), run: (e) => e.chain().focus().clearNodes().setHeading({ level: 3 }).run() },
  {
    id: 'body',
    label: 'Body',
    cls: 'fs-body',
    shortcut: `${SHIFT}${MOD}B`,
    active: (e) => e.isActive('paragraph') && !['bulletList', 'dashedList', 'orderedList', 'taskList', 'blockquote'].some((n) => e.isActive(n)),
    run: toBody
  },
  { id: 'mono', label: 'Monostyled', cls: 'fs-mono', shortcut: `${SHIFT}${MOD}M`, active: (e) => e.isActive('codeBlock'), run: (e) => e.chain().focus().toggleCodeBlock().run() },
  { id: 'bullet', label: '•  Bulleted List', cls: 'fs-body', shortcut: `${SHIFT}${MOD}7`, active: (e) => e.isActive('bulletList'), run: (e) => e.chain().focus().toggleBulletList().run() },
  { id: 'dashed', label: '–  Dashed List', cls: 'fs-body', shortcut: `${SHIFT}${MOD}8`, active: (e) => e.isActive('dashedList'), run: (e) => e.chain().focus().toggleDashedList().run() },
  { id: 'numbered', label: '1.  Numbered List', cls: 'fs-body', shortcut: `${SHIFT}${MOD}9`, active: (e) => e.isActive('orderedList'), run: (e) => e.chain().focus().toggleOrderedList().run() },
  { id: 'quote', label: '|  Block Quote', cls: 'fs-body', shortcut: `${MOD}'`, active: (e) => e.isActive('blockquote'), run: (e) => e.chain().focus().toggleBlockquote().run() }
]

const SIZES = [10, 12, 13, 14, 15, 16, 18, 20, 24, 28, 32, 40, 48]

export function FormatPanel({ editor, anchor, onClose }: { editor: Editor; anchor: DOMRect; onClose: () => void }) {
  const ref = useRef<HTMLDivElement>(null)
  const [pos, setPos] = useState({ left: anchor.left, top: anchor.bottom + 6 })
  const [localFonts, setLocalFonts] = useState<string[]>([])
  const st = useEditorState({
    editor,
    selector: ({ editor: e }) => ({
      styles: STYLES.map((s) => s.active(e)),
      bold: e.isActive('bold'),
      italic: e.isActive('italic'),
      underline: e.isActive('underline'),
      strike: e.isActive('strike'),
      sub: e.isActive('subscript'),
      sup: e.isActive('superscript'),
      highlight: (e.getAttributes('highlight').color as string | undefined) ?? (e.isActive('highlight') ? 'yellow' : null),
      color: (e.getAttributes('textStyle').color as string | undefined) ?? null,
      font: (e.getAttributes('textStyle').fontFamily as string | undefined) ?? '',
      size: (e.getAttributes('textStyle').fontSize as string | undefined) ?? '',
      align: (['left', 'center', 'right', 'justify'] as const).find((a) => e.isActive({ textAlign: a })) ?? 'left'
    })
  })

  useLayoutEffect(() => {
    const r = ref.current?.getBoundingClientRect()
    if (!r) return
    setPos({ left: Math.max(8, Math.min(anchor.left - 8, innerWidth - r.width - 8)), top: anchor.bottom + 6 })
  }, [anchor])

  useEffect(() => {
    const down = (e: MouseEvent) => !ref.current?.contains(e.target as Node) && onClose()
    const key = (e: KeyboardEvent) => e.key === 'Escape' && onClose()
    const t = setTimeout(() => addEventListener('mousedown', down), 0)
    addEventListener('keydown', key)
    return () => {
      clearTimeout(t)
      removeEventListener('mousedown', down)
      removeEventListener('keydown', key)
    }
  }, [onClose])

  // Fonts installed on this computer (Chromium's Local Font Access).
  const loadLocalFonts = async () => {
    if (localFonts.length) return
    try {
      const q = (window as unknown as { queryLocalFonts?: () => Promise<Array<{ family: string }>> }).queryLocalFonts
      if (!q) return
      const fonts = await q()
      setLocalFonts([...new Set(fonts.map((f) => f.family))].sort((a, b) => a.localeCompare(b)))
    } catch {}
  }

  const chain = () => editor.chain().focus()
  const fontValue = FONT_FAMILIES.find((f) => f.css === st.font)?.id ?? (st.font ? `local:${st.font.replace(/^"|".*$/g, '')}` : '')

  return (
    <div ref={ref} className="format-panel" style={pos} onMouseDown={(e) => (e.target as Element).tagName !== 'SELECT' && (e.target as Element).tagName !== 'INPUT' && e.preventDefault()}>
      <div className="format-styles">
        {STYLES.map((s, i) => (
          <button key={s.id} className={`format-style ${s.cls}${st.styles[i] ? ' is-on' : ''}`} onClick={() => (s.run(editor), onClose())} title={s.shortcut}>
            {s.label}
          </button>
        ))}
      </div>
      <div className="format-row">
        <button className={`seg${st.bold ? ' is-on' : ''}`} title={`Bold (${MOD}B)`} onClick={() => chain().toggleBold().run()}>
          <Bold size={16} strokeWidth={2.6} />
        </button>
        <button className={`seg${st.italic ? ' is-on' : ''}`} title={`Italic (${MOD}I)`} onClick={() => chain().toggleItalic().run()}>
          <Italic size={16} />
        </button>
        <button className={`seg${st.underline ? ' is-on' : ''}`} title={`Underline (${MOD}U)`} onClick={() => chain().toggleUnderline().run()}>
          <Underline size={16} />
        </button>
        <button className={`seg${st.strike ? ' is-on' : ''}`} title={`Strikethrough (${SHIFT}${MOD}X)`} onClick={() => chain().toggleStrike().run()}>
          <Strikethrough size={16} />
        </button>
        <button className={`seg${st.sup ? ' is-on' : ''}`} title="Superscript" onClick={() => chain().toggleSuperscript().run()}>
          <Superscript size={15} />
        </button>
        <button className={`seg${st.sub ? ' is-on' : ''}`} title="Subscript" onClick={() => chain().toggleSubscript().run()}>
          <Subscript size={15} />
        </button>
      </div>
      <div className="format-label">Highlight</div>
      <div className="format-row is-swatches">
        {HIGHLIGHTS.map((h) => (
          <button
            key={h.id}
            className={`swatch hl-${h.id}${st.highlight === h.id ? ' is-on' : ''}`}
            title={h.label}
            onClick={() => (st.highlight === h.id ? chain().unsetHighlight().run() : chain().setHighlight({ color: h.id }).run())}
          >
            Aa
          </button>
        ))}
        <button className="swatch is-none" title="No highlight" onClick={() => chain().unsetHighlight().run()} />
      </div>
      <div className="format-label">Text colour</div>
      <div className="format-row is-swatches">
        {TEXT_COLORS.map((c) => (
          <button key={c} className={`dot${st.color === c ? ' is-on' : ''}`} style={{ background: c }} title={c} onClick={() => chain().setColor(c).run()} />
        ))}
        <label className="dot is-custom" title="Other colour">
          <input type="color" value={st.color ?? '#000000'} onChange={(e) => chain().setColor(e.target.value).run()} />
        </label>
        <button className="dot is-none" title="Default colour" onClick={() => chain().unsetColor().run()} />
      </div>
      <div className="format-row is-fields">
        <select
          className="field"
          value={fontValue}
          onFocus={() => void loadLocalFonts()}
          onMouseDown={() => void loadLocalFonts()}
          onChange={(e) => {
            const v = e.target.value
            if (!v) chain().unsetFontFamily().run()
            else if (v.startsWith('local:')) chain().setFontFamily(`"${v.slice(6)}"`).run()
            else chain().setFontFamily(FONT_FAMILIES.find((f) => f.id === v)!.css).run()
          }}
          title="Font"
        >
          <option value="">Default font</option>
          {FONT_FAMILIES.map((f) => (
            <option key={f.id} value={f.id}>
              {f.label}
            </option>
          ))}
          {localFonts.length > 0 && <option disabled>──────────</option>}
          {localFonts.map((f) => (
            <option key={f} value={`local:${f}`}>
              {f}
            </option>
          ))}
        </select>
        <select className="field is-size" value={st.size.replace('px', '')} onChange={(e) => (e.target.value ? chain().setFontSize(`${e.target.value}px`).run() : chain().unsetFontSize().run())} title="Size">
          <option value="">Size</option>
          {SIZES.map((s) => (
            <option key={s} value={s}>
              {s}
            </option>
          ))}
        </select>
      </div>
      <div className="format-row">
        {(
          [
            ['left', AlignLeft],
            ['center', AlignCenter],
            ['right', AlignRight],
            ['justify', AlignJustify]
          ] as const
        ).map(([a, Icon]) => (
          <button key={a} className={`seg${st.align === a ? ' is-on' : ''}`} title={`Align ${a}`} onClick={() => chain().setTextAlign(a).run()}>
            <Icon size={16} />
          </button>
        ))}
        <button className="seg" title={`Decrease indent (${MOD}[)`} onClick={() => chain().outdent().run()}>
          <IndentDecrease size={16} />
        </button>
        <button className="seg" title={`Increase indent (${MOD}])`} onClick={() => chain().indent().run()}>
          <IndentIncrease size={16} />
        </button>
        <button className="seg" title="Clear formatting" onClick={() => chain().unsetAllMarks().run()}>
          <RemoveFormatting size={16} />
        </button>
      </div>
    </div>
  )
}
