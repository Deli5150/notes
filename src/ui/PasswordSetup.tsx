import { Lock } from 'lucide-react'
import { useState } from 'react'
import { desktop } from '../lib/storage'
import { useStore } from '../lib/store'

/** Setting the notes password the first time (or a new one after Reset Password). */
export function PasswordSetup({ onDone, onCancel, title = 'Create a Password' }: { onDone: (password: string, hint: string) => Promise<void> | void; onCancel: () => void; title?: string }) {
  const [pw, setPw] = useState('')
  const [again, setAgain] = useState('')
  const [hint, setHint] = useState('')
  const [touchId, setTouchId] = useState(Boolean(desktop?.touchId.available))
  const [busy, setBusy] = useState(false)
  const mismatch = again.length > 0 && pw !== again
  const ok = pw.length > 0 && pw === again && !hint.toLowerCase().includes(pw.toLowerCase())
  return (
    <form
      className="alert"
      onSubmit={async (e) => {
        e.preventDefault()
        if (!ok) return
        setBusy(true)
        await onDone(pw, hint.trim())
        if (desktop?.touchId.available) {
          useStore.getState().setSettings({ touchId })
          await desktop.touchId.save(touchId ? pw : null)
        }
      }}
    >
      <Lock size={30} strokeWidth={1.5} className="alert-icon" />
      <div className="alert-title">{title}</div>
      <div className="alert-message">One password locks all your locked notes, on every device you sync with. If you forget it, Notes can’t open the notes you locked with it.</div>
      <input className="field" type="password" autoFocus placeholder="Password" value={pw} onChange={(e) => setPw(e.target.value)} />
      <input className="field" type="password" placeholder="Verify" value={again} onChange={(e) => setAgain(e.target.value)} />
      <input className="field" placeholder="Hint (recommended)" value={hint} onChange={(e) => setHint(e.target.value)} />
      {mismatch && <div className="alert-error">The passwords don’t match.</div>}
      {pw && hint && hint.toLowerCase().includes(pw.toLowerCase()) && <div className="alert-error">The hint can’t contain the password.</div>}
      {desktop?.touchId.available && (
        <label className="check">
          <input type="checkbox" checked={touchId} onChange={(e) => setTouchId(e.target.checked)} /> Use Touch ID
        </label>
      )}
      <div className="alert-buttons">
        <button type="button" className="btn" onClick={onCancel}>
          Cancel
        </button>
        <button type="submit" className="btn btn-primary" disabled={!ok || busy}>
          Set Password
        </button>
      </div>
    </form>
  )
}
