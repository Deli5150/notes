import { Camera, Circle, RotateCcw, Square } from 'lucide-react'
import { useEffect, useRef, useState } from 'react'
import { putBlob } from '../lib/attachments'
import { openDialog } from '../ui/overlays'
import type { AttachmentAttrs } from './attachment'

// Recording audio and scanning documents (or taking a photo) with the computer's microphone and
// camera.

const clock = (ms: number) => {
  const s = Math.floor(ms / 1000)
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`
}

function Recorder({ onDone, onCancel }: { onDone: (blob: Blob, ms: number) => void; onCancel: () => void }) {
  const [state, setState] = useState<'starting' | 'recording' | 'paused' | 'error'>('starting')
  const [error, setError] = useState('')
  const [elapsed, setElapsed] = useState(0)
  const [levels, setLevels] = useState<number[]>(() => Array(48).fill(0))
  const rec = useRef<MediaRecorder | null>(null)
  const chunks = useRef<Blob[]>([])
  const started = useRef(0)
  const total = useRef(0)

  useEffect(() => {
    let stream: MediaStream | null = null
    let raf = 0
    let ctx: AudioContext | null = null
    void (async () => {
      try {
        stream = await navigator.mediaDevices.getUserMedia({ audio: { echoCancellation: true, noiseSuppression: true } })
        const mime = ['audio/webm;codecs=opus', 'audio/webm', 'audio/mp4'].find((m) => MediaRecorder.isTypeSupported(m)) ?? ''
        const r = new MediaRecorder(stream, mime ? { mimeType: mime } : undefined)
        r.ondataavailable = (e) => e.data.size && chunks.current.push(e.data)
        r.start(250)
        rec.current = r
        started.current = Date.now()
        setState('recording')
        ctx = new AudioContext()
        const analyser = ctx.createAnalyser()
        analyser.fftSize = 512
        ctx.createMediaStreamSource(stream).connect(analyser)
        const buf = new Uint8Array(analyser.fftSize)
        let last = 0
        const tick = (t: number) => {
          raf = requestAnimationFrame(tick)
          if (t - last < 60) return
          last = t
          analyser.getByteTimeDomainData(buf)
          let peak = 0
          for (const v of buf) peak = Math.max(peak, Math.abs(v - 128) / 128)
          if (rec.current?.state === 'recording') {
            setLevels((l) => [...l.slice(1), Math.min(1, peak * 2.2)])
            setElapsed(total.current + Date.now() - started.current)
          }
        }
        raf = requestAnimationFrame(tick)
      } catch (e) {
        setState('error')
        setError((e as Error).name === 'NotAllowedError' ? 'Notes isn’t allowed to use the microphone. Allow it in your system’s privacy settings, then try again.' : `Couldn’t start recording: ${(e as Error).message}`)
      }
    })()
    return () => {
      cancelAnimationFrame(raf)
      if (rec.current && rec.current.state !== 'inactive') rec.current.stop()
      stream?.getTracks().forEach((t) => t.stop())
      void ctx?.close()
    }
  }, [])

  const finish = () => {
    const r = rec.current
    if (!r) return onCancel()
    const ms = total.current + (r.state === 'recording' ? Date.now() - started.current : 0)
    r.onstop = () => onDone(new Blob(chunks.current, { type: r.mimeType || 'audio/webm' }), ms)
    r.stop()
  }

  return (
    <div className="capture">
      <div className="capture-title">New Recording</div>
      {state === 'error' ? (
        <div className="alert-message">{error}</div>
      ) : (
        <>
          <div className="recorder-wave">
            {levels.map((l, i) => (
              <span key={i} style={{ height: `${8 + l * 92}%` }} />
            ))}
          </div>
          <div className="recorder-time">{clock(elapsed)}</div>
          <div className="recorder-buttons">
            <button
              className="recorder-btn"
              title={state === 'paused' ? 'Resume' : 'Pause'}
              disabled={state === 'starting'}
              onClick={() => {
                const r = rec.current
                if (!r) return
                if (r.state === 'recording') {
                  r.pause()
                  total.current += Date.now() - started.current
                  setState('paused')
                } else {
                  r.resume()
                  started.current = Date.now()
                  setState('recording')
                }
              }}
            >
              {state === 'paused' ? <Circle size={20} fill="#ff453a" color="#ff453a" /> : <span className="recorder-pause" />}
            </button>
            <button className="recorder-btn is-stop" title="Done" disabled={state === 'starting'} onClick={finish}>
              <Square size={18} fill="currentColor" />
            </button>
          </div>
        </>
      )}
      <div className="alert-buttons">
        <button className="btn" onClick={onCancel}>
          Cancel
        </button>
        {state !== 'error' && (
          <button className="btn btn-primary" disabled={state === 'starting'} onClick={finish}>
            Done
          </button>
        )}
      </div>
    </div>
  )
}

export function recordAudio(): Promise<Partial<AttachmentAttrs> | null> {
  return new Promise((resolve) => {
    openDialog(
      (close) => (
        <Recorder
          onCancel={() => (close(), resolve(null))}
          onDone={async (blob) => {
            close()
            const att = await putBlob(blob)
            const when = new Date().toLocaleString(undefined, { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' })
            resolve({ att, kind: 'audio', mime: blob.type, size: blob.size, name: `Recording ${when}` })
          }}
        />
      ),
      { dismissable: false }
    )
  })
}

/** Makes a photo of a page look scanned: grey, brighter paper, darker ink. */
function enhance(canvas: HTMLCanvasElement): void {
  const ctx = canvas.getContext('2d')!
  const img = ctx.getImageData(0, 0, canvas.width, canvas.height)
  const d = img.data
  for (let i = 0; i < d.length; i += 4) {
    const g = 0.299 * d[i] + 0.587 * d[i + 1] + 0.114 * d[i + 2]
    const v = Math.max(0, Math.min(255, (g - 90) * 1.9 + 90))
    d[i] = d[i + 1] = d[i + 2] = v
  }
  ctx.putImageData(img, 0, 0)
}

function Scanner({ mode, onDone, onCancel }: { mode: 'scan' | 'photo'; onDone: (shots: Blob[]) => void; onCancel: () => void }) {
  const video = useRef<HTMLVideoElement>(null)
  const [error, setError] = useState('')
  const [shots, setShots] = useState<Array<{ blob: Blob; url: string }>>([])
  const [filter, setFilter] = useState(mode === 'scan')
  const [devices, setDevices] = useState<MediaDeviceInfo[]>([])
  const [device, setDevice] = useState<string>('')

  useEffect(() => {
    let stream: MediaStream | null = null
    void (async () => {
      try {
        stream = await navigator.mediaDevices.getUserMedia({ video: { width: { ideal: 1920 }, height: { ideal: 1080 }, ...(device ? { deviceId: { exact: device } } : {}) } })
        if (video.current) video.current.srcObject = stream
        const all = (await navigator.mediaDevices.enumerateDevices()).filter((d) => d.kind === 'videoinput')
        setDevices(all)
      } catch (e) {
        setError((e as Error).name === 'NotAllowedError' ? 'Notes isn’t allowed to use the camera. Allow it in your system’s privacy settings, then try again.' : `Couldn’t open the camera: ${(e as Error).message}`)
      }
    })()
    return () => stream?.getTracks().forEach((t) => t.stop())
  }, [device])

  const capture = async () => {
    const v = video.current
    if (!v?.videoWidth) return
    const c = document.createElement('canvas')
    c.width = v.videoWidth
    c.height = v.videoHeight
    c.getContext('2d')!.drawImage(v, 0, 0)
    if (filter) enhance(c)
    const blob = await new Promise<Blob>((r) => c.toBlob((b) => r(b!), 'image/jpeg', 0.9))
    setShots((s) => [...s, { blob, url: URL.createObjectURL(blob) }])
  }

  return (
    <div className="capture is-camera">
      <div className="capture-title">{mode === 'scan' ? 'Scan Documents' : 'Take Photo'}</div>
      {error ? (
        <div className="alert-message">{error}</div>
      ) : (
        <div className={`camera${filter ? ' is-scan' : ''}`}>
          <video ref={video} autoPlay playsInline muted />
        </div>
      )}
      {!!shots.length && (
        <div className="camera-shots">
          {shots.map((s, i) => (
            <img key={i} src={s.url} alt={`Page ${i + 1}`} onClick={() => setShots(shots.filter((_, j) => j !== i))} title="Remove" />
          ))}
        </div>
      )}
      <div className="camera-bar">
        <label className="check">
          <input type="checkbox" checked={filter} onChange={(e) => setFilter(e.target.checked)} /> Document filter
        </label>
        {devices.length > 1 && (
          <button className="icon-btn" title="Switch camera" onClick={() => setDevice(devices[(devices.findIndex((d) => d.deviceId === device) + 1) % devices.length].deviceId)}>
            <RotateCcw size={16} />
          </button>
        )}
        <button className="shutter" title="Capture" disabled={Boolean(error)} onClick={() => void capture()}>
          <Camera size={20} />
        </button>
      </div>
      <div className="alert-buttons">
        <button className="btn" onClick={onCancel}>
          Cancel
        </button>
        <button className="btn btn-primary" disabled={!shots.length} onClick={() => onDone(shots.map((s) => s.blob))}>
          {mode === 'scan' ? `Save${shots.length > 1 ? ` (${shots.length})` : ''}` : 'Use Photo'}
        </button>
      </div>
    </div>
  )
}

export function captureCamera(mode: 'scan' | 'photo'): Promise<Array<Partial<AttachmentAttrs>> | null> {
  return new Promise((resolve) => {
    openDialog(
      (close) => (
        <Scanner
          mode={mode}
          onCancel={() => (close(), resolve(null))}
          onDone={async (blobs) => {
            close()
            const out: Array<Partial<AttachmentAttrs>> = []
            for (const [i, blob] of blobs.entries()) out.push({ att: await putBlob(blob), kind: mode === 'scan' ? 'scan' : 'image', mime: 'image/jpeg', size: blob.size, name: mode === 'scan' ? `Scanned page ${i + 1}` : 'Photo' })
            resolve(out)
          }}
        />
      ),
      { dismissable: false, wide: true }
    )
  })
}
