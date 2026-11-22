import { Check, ChevronRight } from 'lucide-react'
import { useEffect, useLayoutEffect, useRef, useState, type ReactNode } from 'react'
import { create } from 'zustand'

// Pop-ups drawn by the app: menus (at the pointer or under a button), dialogs (confirm, prompt or
// any content), and sheets. One host renders them all (App.tsx).

export interface MenuItem {
  label?: string
  icon?: ReactNode
  shortcut?: string
  checked?: boolean
  disabled?: boolean
  danger?: boolean
  separator?: boolean
  /** A heading inside the menu. */
  header?: boolean
  submenu?: MenuItem[]
  onClick?: () => void
}

interface MenuState {
  x: number
  y: number
  items: MenuItem[]
  /** Open above/left of the point when there's no room. */
  minWidth?: number
}

interface Dialog {
  id: number
  render: (close: () => void) => ReactNode
  /** Clicking outside closes it. */
  dismissable: boolean
  wide?: boolean
}

const useOverlays = create<{ menu: MenuState | null; dialogs: Dialog[] }>(() => ({ menu: null, dialogs: [] }))

let nextId = 1

export function showMenu(x: number, y: number, items: MenuItem[], minWidth?: number): void {
  useOverlays.setState({ menu: { x, y, items, minWidth } })
}

/** A menu under a button. */
export function menuUnder(el: Element, items: MenuItem[], align: 'left' | 'right' = 'left'): void {
  const r = el.getBoundingClientRect()
  showMenu(align === 'left' ? r.left : r.right, r.bottom + 4, items, align === 'right' ? -1 : undefined)
}

export const closeMenu = (): void => useOverlays.setState({ menu: null })

export function openDialog(render: Dialog['render'], opts: { dismissable?: boolean; wide?: boolean } = {}): () => void {
  const id = nextId++
  const close = () => useOverlays.setState((s) => ({ dialogs: s.dialogs.filter((d) => d.id !== id) }))
  useOverlays.setState((s) => ({ dialogs: [...s.dialogs, { id, render, dismissable: opts.dismissable ?? true, wide: opts.wide }] }))
  return close
}

export function confirm(opts: { title: string; message?: string; ok?: string; danger?: boolean; cancel?: string }): Promise<boolean> {
  return new Promise((resolve) => {
    openDialog(
      (close) => (
        <div className="alert">
          <div className="alert-title">{opts.title}</div>
          {opts.message && <div className="alert-message">{opts.message}</div>}
          <div className="alert-buttons">
            <button
              className="btn"
              onClick={() => {
                close()
                resolve(false)
              }}
            >
              {opts.cancel ?? 'Cancel'}
            </button>
            <button
              className={`btn ${opts.danger ? 'btn-danger' : 'btn-primary'}`}
              autoFocus
              onClick={() => {
                close()
                resolve(true)
              }}
            >
              {opts.ok ?? 'OK'}
            </button>
          </div>
        </div>
      ),
      { dismissable: false }
    )
  })
}

export function alertBox(title: string, message?: string): Promise<void> {
  return new Promise((resolve) => {
    openDialog((close) => (
      <div className="alert">
        <div className="alert-title">{title}</div>
        {message && <div className="alert-message">{message}</div>}
        <div className="alert-buttons">
          <button
            className="btn btn-primary"
            autoFocus
            onClick={() => {
              close()
              resolve()
            }}
          >
            OK
          </button>
        </div>
      </div>
    ))
  })
}

function PromptBody({ opts, close, resolve }: { opts: PromptOpts; close: () => void; resolve: (v: string | null) => void }) {
  const [value, setValue] = useState(opts.value ?? '')
  const [error, setError] = useState('')
  const ref = useRef<HTMLInputElement>(null)
  useEffect(() => {
    ref.current?.focus()
    ref.current?.select()
  }, [])
  const submit = async () => {
    if (opts.validate) {
      const e = await opts.validate(value)
      if (e) return setError(e)
    }
    close()
    resolve(value)
  }
  return (
    <form
      className="alert"
      onSubmit={(e) => {
        e.preventDefault()
        void submit()
      }}
    >
      <div className="alert-title">{opts.title}</div>
      {opts.message && <div className="alert-message">{opts.message}</div>}
      <input ref={ref} className="field" type={opts.password ? 'password' : 'text'} value={value} placeholder={opts.placeholder} onChange={(e) => (setValue(e.target.value), setError(''))} />
      {error && <div className="alert-error">{error}</div>}
      <div className="alert-buttons">
        <button
          type="button"
          className="btn"
          onClick={() => {
            close()
            resolve(null)
          }}
        >
          Cancel
        </button>
        <button type="submit" className="btn btn-primary" disabled={!opts.allowEmpty && !value.trim()}>
          {opts.ok ?? 'OK'}
        </button>
      </div>
    </form>
  )
}

interface PromptOpts {
  title: string
  message?: string
  value?: string
  placeholder?: string
  ok?: string
  password?: boolean
  allowEmpty?: boolean
  /** An error message, or nothing when the value is fine. */
  validate?: (v: string) => string | undefined | Promise<string | undefined>
}

export function prompt(opts: PromptOpts): Promise<string | null> {
  return new Promise((resolve) => {
    openDialog((close) => <PromptBody opts={opts} close={close} resolve={resolve} />, { dismissable: false })
  })
}

function MenuList({ items, x, y, minWidth, depth = 0, onClose }: MenuState & { depth?: number; onClose: () => void }) {
  const ref = useRef<HTMLDivElement>(null)
  const [pos, setPos] = useState({ left: x, top: y })
  const [sub, setSub] = useState<{ i: number; x: number; y: number } | null>(null)
  useLayoutEffect(() => {
    const el = ref.current
    if (!el) return
    const r = el.getBoundingClientRect()
    let left = minWidth === -1 ? x - r.width : x
    let top = y
    if (left + r.width > innerWidth - 6) left = depth ? x - r.width - (ref.current?.offsetWidth ?? 0) : innerWidth - r.width - 6
    if (top + r.height > innerHeight - 6) top = Math.max(6, depth ? innerHeight - r.height - 6 : y - r.height - 4)
    setPos({ left: Math.max(6, left), top })
  }, [x, y, minWidth, depth])
  return (
    <>
      <div ref={ref} className="menu" style={{ left: pos.left, top: pos.top, minWidth: minWidth && minWidth > 0 ? minWidth : undefined }} onMouseDown={(e) => e.preventDefault()} role="menu">
        {items.map((it, i) =>
          it.separator ? (
            <div key={i} className="menu-sep" />
          ) : it.header ? (
            <div key={i} className="menu-header">
              {it.label}
            </div>
          ) : (
            <div
              key={i}
              role="menuitem"
              className={`menu-item${it.disabled ? ' is-disabled' : ''}${it.danger ? ' is-danger' : ''}${sub?.i === i ? ' is-open' : ''}`}
              onMouseEnter={(e) => {
                if (it.submenu) {
                  const r = e.currentTarget.getBoundingClientRect()
                  setSub({ i, x: r.right - 2, y: r.top - 5 })
                } else setSub(null)
              }}
              onClick={() => {
                if (it.disabled || it.submenu) return
                onClose()
                it.onClick?.()
              }}
            >
              <span className="menu-check">{it.checked ? <Check size={13} strokeWidth={2.5} /> : null}</span>
              {it.icon && <span className="menu-icon">{it.icon}</span>}
              <span className="menu-label">{it.label}</span>
              {it.shortcut && <span className="menu-shortcut">{it.shortcut}</span>}
              {it.submenu && <ChevronRight size={13} className="menu-arrow" />}
            </div>
          )
        )}
      </div>
      {sub && items[sub.i]?.submenu && <MenuList items={items[sub.i].submenu!} x={sub.x} y={sub.y} depth={depth + 1} onClose={onClose} />}
    </>
  )
}

export function OverlayHost() {
  const { menu, dialogs } = useOverlays()
  useEffect(() => {
    if (!menu) return
    const close = (e: Event) => {
      if (e.type === 'keydown' && (e as KeyboardEvent).key !== 'Escape') return
      if (e.type === 'mousedown' && (e.target as Element).closest?.('.menu')) return
      closeMenu()
    }
    addEventListener('mousedown', close, true)
    addEventListener('keydown', close, true)
    addEventListener('blur', close)
    addEventListener('resize', close)
    return () => {
      removeEventListener('mousedown', close, true)
      removeEventListener('keydown', close, true)
      removeEventListener('blur', close)
      removeEventListener('resize', close)
    }
  }, [menu])
  useEffect(() => {
    const top = dialogs[dialogs.length - 1]
    if (!top) return
    const key = (e: KeyboardEvent) => {
      if (e.key === 'Escape' && top.dismissable) {
        e.stopPropagation()
        useOverlays.setState((s) => ({ dialogs: s.dialogs.filter((d) => d.id !== top.id) }))
      }
    }
    addEventListener('keydown', key, true)
    return () => removeEventListener('keydown', key, true)
  }, [dialogs])
  return (
    <>
      {dialogs.map((d) => {
        const close = () => useOverlays.setState((s) => ({ dialogs: s.dialogs.filter((x) => x.id !== d.id) }))
        return (
          <div key={d.id} className="scrim" onMouseDown={(e) => e.target === e.currentTarget && d.dismissable && close()}>
            <div className={`dialog${d.wide ? ' is-wide' : ''}`}>{d.render(close)}</div>
          </div>
        )
      })}
      {menu && <MenuList {...menu} onClose={closeMenu} />}
    </>
  )
}

/** A brief message at the bottom of the window. */
export const useToast = create<{ text: string | null; action?: { label: string; run: () => void } }>(() => ({ text: null }))
let toastTimer: ReturnType<typeof setTimeout> | null = null
export function toast(text: string, action?: { label: string; run: () => void }): void {
  useToast.setState({ text, action })
  if (toastTimer) clearTimeout(toastTimer)
  toastTimer = setTimeout(() => useToast.setState({ text: null, action: undefined }), action ? 6000 : 3000)
}

export function ToastHost() {
  const { text, action } = useToast()
  if (!text) return null
  return (
    <div className="toast" role="status">
      <span>{text}</span>
      {action && (
        <button
          onClick={() => {
            useToast.setState({ text: null })
            action.run()
          }}
        >
          {action.label}
        </button>
      )}
    </div>
  )
}
