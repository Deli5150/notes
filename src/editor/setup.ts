import type { Editor, Extensions } from '@tiptap/core'
import Highlight from '@tiptap/extension-highlight'
import { TaskItem, TaskList } from '@tiptap/extension-list'
import Subscript from '@tiptap/extension-subscript'
import Superscript from '@tiptap/extension-superscript'
import { TableKit } from '@tiptap/extension-table'
import TextAlign from '@tiptap/extension-text-align'
import { BackgroundColor, Color, FontFamily, FontSize, TextStyle } from '@tiptap/extension-text-style'
import Typography from '@tiptap/extension-typography'
import { Placeholder } from '@tiptap/extensions'
import StarterKit from '@tiptap/starter-kit'
import { kindOf, putBlob, shrinkImage } from '../lib/attachments'
import { desktop } from '../lib/storage'
import { useStore } from '../lib/store'
import { Attachment, type AttachmentAttrs } from './attachment'
import { Checklist, ChecklistInput, DashedList, Find, Indent, MathNotes, NoteBulletList, NoteHeading, Tags } from './extensions'

// The editor's extensions, configured like Apple Notes.

/** Highlights by name (they look right in light and dark), or any colour. */
const NoteHighlight = Highlight.extend({
  addAttributes() {
    return {
      color: {
        default: null,
        parseHTML: (el: HTMLElement) => el.getAttribute('data-color') || el.style.backgroundColor || null,
        renderHTML: (a: { color?: string | null }) => {
          if (!a.color) return {}
          return /^[a-z]+$/.test(a.color) ? { 'data-color': a.color } : { 'data-color': a.color, style: `background-color: ${a.color}; color: inherit` }
        }
      }
    }
  },
  addKeyboardShortcuts() {
    return { 'Mod-Shift-e': () => this.editor.commands.toggleHighlight({ color: 'yellow' }) }
  }
}).configure({ multicolor: true })

export function noteExtensions(): Extensions {
  const settings = () => useStore.getState().settings
  return [
    StarterKit.configure({
      heading: false,
      bulletList: false,
      link: { openOnClick: false, autolink: true, linkOnPaste: true, protocols: ['note'], HTMLAttributes: { rel: 'noopener noreferrer', target: null } },
      codeBlock: { HTMLAttributes: { class: 'mono' } },
      dropcursor: { color: 'var(--accent)', width: 2 }
    }),
    NoteHeading,
    NoteBulletList,
    DashedList,
    TaskList,
    TaskItem.configure({ nested: true }),
    TextStyle,
    Color,
    BackgroundColor,
    FontFamily,
    FontSize,
    NoteHighlight,
    TextAlign.configure({ types: ['heading', 'paragraph'] }),
    TableKit.configure({ table: { resizable: true, cellMinWidth: 60 } }),
    Subscript,
    Superscript,
    Typography.configure({ oneHalf: false, oneQuarter: false, threeQuarters: false, plusMinus: false, notEqual: false, laquo: false, raquo: false, multiplication: false }),
    Placeholder.configure({ placeholder: ({ editor }) => (editor.isEmpty ? 'Start typing…' : ''), showOnlyCurrent: true }),
    Indent,
    Checklist.configure({ sortChecked: () => settings().sortChecked }),
    ChecklistInput,
    Tags.configure({ enabled: () => settings().tags }),
    MathNotes.configure({ mode: () => settings().mathResults }),
    Find,
    Attachment
  ]
}

/** Puts files into the note at the cursor (or at `pos`): pictures inline, others as attachments. */
export async function insertFiles(editor: Editor, files: File[], pos?: number): Promise<void> {
  const nodes: Array<{ type: string; attrs: Partial<AttachmentAttrs> }> = []
  for (const file of files) {
    const mime = file.type || 'application/octet-stream'
    const kind = kindOf(mime, file.name)
    const blob = kind === 'image' ? await shrinkImage(file) : file
    const att = await putBlob(blob)
    nodes.push({ type: 'attachment', attrs: { att, kind, mime: blob.type || mime, name: file.name, size: blob.size, width: 'large', createdAt: Date.now() } })
  }
  if (!nodes.length) return
  const chain = editor.chain().focus()
  if (pos !== undefined) chain.insertContentAt(pos, nodes)
  else chain.insertContent(nodes)
  chain.run()
}

export function insertAttachments(editor: Editor, attrs: Array<Partial<AttachmentAttrs>>): void {
  if (!attrs.length) return
  editor
    .chain()
    .focus()
    .insertContent(attrs.map((a) => ({ type: 'attachment', attrs: { createdAt: Date.now(), width: 'large', ...a } })))
    .run()
}

/** A link preview card for a web address (falls back to a plain link offline). */
export async function insertLinkPreview(editor: Editor, url: string): Promise<void> {
  const preview = await desktop?.linkPreview(url).catch(() => null)
  if (!preview?.title) {
    editor.chain().focus().insertContent({ type: 'text', text: url, marks: [{ type: 'link', attrs: { href: url } }] }).run()
    return
  }
  insertAttachments(editor, [{ kind: 'link', src: url, title: preview.title, desc: preview.description ?? null, image: preview.image ?? null, name: preview.site ?? '' }])
}

export const FONT_FAMILIES: Array<{ id: string; label: string; css: string }> = [
  { id: 'system', label: 'System', css: '-apple-system, BlinkMacSystemFont, "Segoe UI Variable Text", "Segoe UI", system-ui, sans-serif' },
  { id: 'rounded', label: 'Rounded', css: 'ui-rounded, "SF Pro Rounded", Nunito, "Segoe UI", sans-serif' },
  { id: 'serif', label: 'Serif', css: '"New York", ui-serif, Georgia, "Times New Roman", serif' },
  { id: 'lora', label: 'Lora', css: 'Lora, Georgia, serif' },
  { id: 'merriweather', label: 'Merriweather', css: 'Merriweather, Georgia, serif' },
  { id: 'playfair', label: 'Playfair Display', css: '"Playfair Display", Georgia, serif' },
  { id: 'inter', label: 'Inter', css: 'Inter, system-ui, sans-serif' },
  { id: 'nunito', label: 'Nunito', css: 'Nunito, system-ui, sans-serif' },
  { id: 'mono', label: 'Monospaced', css: '"JetBrains Mono", ui-monospace, "SF Mono", Menlo, Consolas, monospace' },
  { id: 'hand', label: 'Handwriting', css: 'Caveat, "Bradley Hand", cursive' }
]

export const fontCss = (id: string): string => FONT_FAMILIES.find((f) => f.id === id)?.css ?? (id.includes(',') || id.includes('"') ? id : `"${id}", ${FONT_FAMILIES[0].css}`)

/** Apple Notes' highlight colours (iOS 18 / macOS 15), plus a classic yellow. */
export const HIGHLIGHTS = [
  { id: 'purple', label: 'Purple' },
  { id: 'pink', label: 'Pink' },
  { id: 'orange', label: 'Orange' },
  { id: 'mint', label: 'Mint' },
  { id: 'blue', label: 'Blue' },
  { id: 'yellow', label: 'Yellow' }
]

export const TEXT_COLORS = ['#ff453a', '#ff9f0a', '#ffd60a', '#30d158', '#64d2ff', '#0a84ff', '#bf5af2', '#ff375f', '#8e8e93']
