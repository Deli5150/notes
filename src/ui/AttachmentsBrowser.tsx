import { Globe, Mic, X } from 'lucide-react'
import { useMemo, useState } from 'react'
import { formatBytes } from '../lib/attachments'
import { useStore } from '../lib/store'
import { useUi } from '../lib/ui'
import { fileIcon } from './icons'
import { useThumb } from './NoteList'

// View → Attachments Browser: every picture, scan, sketch, link, recording and document in your
// notes, by kind. Click one to open its note.

interface Item {
  noteId: string
  noteTitle: string
  att: string | null
  kind: string
  name: string
  mime: string
  size: number
  src: string | null
  title: string | null
  image: string | null
  updatedAt: number
}

const GROUPS: Array<{ id: string; label: string; kinds: string[] }> = [
  { id: 'media', label: 'Photos & Videos', kinds: ['image', 'video'] },
  { id: 'scan', label: 'Scans', kinds: ['scan'] },
  { id: 'sketch', label: 'Sketches', kinds: ['sketch'] },
  { id: 'link', label: 'Websites', kinds: ['link'] },
  { id: 'audio', label: 'Audio', kinds: ['audio'] },
  { id: 'docs', label: 'Documents', kinds: ['pdf', 'file'] }
]

function Tile({ item }: { item: Item }) {
  const url = useThumb(item.kind === 'image' || item.kind === 'scan' || item.kind === 'sketch' ? (item.att ?? undefined) : undefined)
  const open = () => {
    const n = useStore.getState().notes.find((x) => x.id === item.noteId)
    if (!n) return
    useUi.setState({ attachmentsBrowser: false, galleryOpen: false })
    useUi.getState().select({ kind: 'folder', id: n.folderId })
    useUi.getState().open(n.id)
  }
  const Icon = item.kind === 'audio' ? Mic : item.kind === 'link' ? Globe : fileIcon(item.mime, item.name)
  return (
    <button className="att-tile" onClick={open} title={`${item.name || item.title || ''} — in “${item.noteTitle || 'New Note'}”`}>
      <div className="att-tile-preview">
        {url ? <img src={url} alt="" /> : item.kind === 'link' && item.image ? <img src={item.image} alt="" /> : <Icon size={30} strokeWidth={1.3} />}
      </div>
      <div className="att-tile-name">{item.kind === 'link' ? item.title || item.src : item.name || item.kind}</div>
      <div className="att-tile-sub">{item.size ? formatBytes(item.size) : item.noteTitle}</div>
    </button>
  )
}

export function AttachmentsBrowser() {
  const notes = useStore((s) => s.notes)
  const [group, setGroup] = useState('media')
  const items = useMemo(() => {
    const out: Item[] = []
    const parser = new DOMParser()
    for (const n of notes) {
      if (n.deletedAt || n.locked || !n.html.includes('data-attachment')) continue
      const doc = parser.parseFromString(`<body>${n.html}</body>`, 'text/html')
      doc.querySelectorAll('figure[data-attachment]').forEach((f) => {
        const g = (k: string) => f.getAttribute(`data-${k}`)
        out.push({ noteId: n.id, noteTitle: n.title, att: g('att'), kind: g('kind') ?? 'file', name: g('name') ?? '', mime: g('mime') ?? '', size: Number(g('size')) || 0, src: g('src'), title: g('title'), image: g('image'), updatedAt: n.updatedAt })
      })
    }
    return out.sort((a, b) => b.updatedAt - a.updatedAt)
  }, [notes])
  const current = GROUPS.find((g) => g.id === group)!
  const shown = items.filter((i) => current.kinds.includes(i.kind))
  return (
    <div className="attachments-browser">
      <div className="ab-header">
        <div className="tb-seg is-wide">
          {GROUPS.map((g) => (
            <button key={g.id} className={g.id === group ? 'is-on' : ''} onClick={() => setGroup(g.id)}>
              {g.label}
            </button>
          ))}
        </div>
        <button className="tb-btn" title="Close" onClick={() => useUi.setState({ attachmentsBrowser: false })}>
          <X size={16} />
        </button>
      </div>
      {shown.length ? (
        <div className="ab-grid">
          {shown.map((it, i) => (
            <Tile key={`${it.noteId}-${i}`} item={it} />
          ))}
        </div>
      ) : (
        <div className="list-empty">No {current.label}</div>
      )}
    </div>
  )
}
