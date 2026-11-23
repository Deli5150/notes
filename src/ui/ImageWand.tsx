import { ImagePlus, RefreshCw, WandSparkles } from 'lucide-react'
import { useEffect, useState } from 'react'
import { generateImage, hasImageKey, IMAGE_STYLES, type ImageStyle } from '../lib/imagegen'
import { useStore } from '../lib/store'
import { useUi } from '../lib/ui'
import { openDialog } from './overlays'

// Image Wand (like Apple Notes'): describe a picture, or turn a canvas or sketch into one, pick a
// style, and put it in the note. Pictures come from Gemini with your own key (src/lib/imagegen.ts).

interface WandOptions {
  /** A drawing to turn into a picture (PNG). */
  from?: Uint8Array
  /** The note's text, offered as ideas for a picture from a description. */
  context?: string
  onInsert: (image: { bytes: Uint8Array; mime: string }) => void
}

function Wand({ opts, close }: { opts: WandOptions; close: () => void }) {
  const settings = useStore((s) => s.settings)
  const [prompt, setPrompt] = useState('')
  const [style, setStyle] = useState<ImageStyle>(settings.imageStyle ?? 'illustration')
  const [useNote, setUseNote] = useState(Boolean(opts.context?.trim()))
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [result, setResult] = useState<{ bytes: Uint8Array; mime: string; url: string } | null>(null)
  const [keyed, setKeyed] = useState<boolean | null>(null)
  const [drawing] = useState(() => (opts.from ? URL.createObjectURL(new Blob([opts.from as BlobPart], { type: 'image/png' })) : null))

  useEffect(() => {
    void hasImageKey().then(setKeyed)
  }, [])
  useEffect(() => () => {
    if (result) URL.revokeObjectURL(result.url)
  }, [result])

  const make = async () => {
    setBusy(true)
    setError('')
    useStore.getState().setSettings({ imageStyle: style })
    try {
      const img = await generateImage({ prompt, style, model: settings.imageModel || 'gemini-nano-banana-2.1', context: useNote ? opts.context : undefined, from: opts.from })
      setResult({ ...img, url: URL.createObjectURL(new Blob([img.bytes as BlobPart], { type: img.mime })) })
    } catch (e) {
      setError((e as Error).message)
    } finally {
      setBusy(false)
    }
  }

  if (keyed === false)
    return (
      <div className="wand">
        <div className="wand-head">
          <WandSparkles size={20} /> Image Wand
        </div>
        <p className="set-sub">Image Wand makes pictures with Google’s Gemini image models, using your own API key from Google AI Studio. Add it in Settings → Text → Image Wand.</p>
        <div className="alert-buttons">
          <button className="btn" onClick={close}>
            Cancel
          </button>
          <button
            className="btn btn-primary"
            onClick={() => {
              close()
              useUi.setState({ settings: 'editor' })
            }}
          >
            Open Settings
          </button>
        </div>
      </div>
    )

  return (
    <form
      className="wand"
      onSubmit={(e) => {
        e.preventDefault()
        void make()
      }}
    >
      <div className="wand-head">
        <WandSparkles size={20} /> {opts.from ? 'Turn into a Picture' : 'Image Wand'}
      </div>
      <div className={`wand-preview${busy ? ' is-busy' : ''}`}>
        {result ? <img src={result.url} alt="" /> : drawing ? <img src={drawing} alt="Your drawing" className="is-drawing" /> : <WandSparkles size={34} strokeWidth={1.2} />}
        {busy && (
          <div className="wand-busy">
            <RefreshCw size={18} className="spin" /> Making your picture…
          </div>
        )}
      </div>
      <div className="wand-styles">
        {IMAGE_STYLES.map(([id, label]) => (
          <button type="button" key={id} className={style === id ? 'is-on' : undefined} onClick={() => setStyle(id)}>
            {label}
          </button>
        ))}
      </div>
      <textarea
        className="field wand-prompt"
        rows={2}
        autoFocus
        placeholder={opts.from ? 'What is it? (optional) e.g. “a lighthouse on a cliff at sunset”' : 'Describe a picture, e.g. “a cozy reading nook with a sleeping cat”'}
        value={prompt}
        onChange={(e) => setPrompt(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === 'Enter' && !e.shiftKey) {
            e.preventDefault()
            if (!busy) void make()
          }
        }}
      />
      {!opts.from && opts.context?.trim() && (
        <label className="wand-check">
          <input type="checkbox" checked={useNote} onChange={(e) => setUseNote(e.target.checked)} /> Use this note for ideas
        </label>
      )}
      {error && <div className="set-error">{error}</div>}
      <div className="alert-buttons">
        <button type="button" className="btn" onClick={close}>
          Cancel
        </button>
        {result ? (
          <>
            <button type="submit" className="btn" disabled={busy}>
              <RefreshCw size={14} /> Try Again
            </button>
            <button
              type="button"
              className="btn btn-primary"
              onClick={() => {
                opts.onInsert(result)
                close()
              }}
            >
              <ImagePlus size={14} /> Insert
            </button>
          </>
        ) : (
          <button type="submit" className="btn btn-primary" disabled={busy || (!opts.from && !prompt.trim() && !(useNote && opts.context?.trim()))}>
            <WandSparkles size={14} /> Create
          </button>
        )}
      </div>
      <div className="wand-foot">Made by Google Gemini with your API key. The description{opts.from ? ' and your drawing are' : ' (and the note’s text, if ticked) is'} sent to Google.</div>
    </form>
  )
}

export function openImageWand(opts: WandOptions): void {
  openDialog((close) => <Wand opts={opts} close={close} />)
}
