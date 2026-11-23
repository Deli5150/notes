import { Bug, Check, FileText, Plug, RotateCcw, Cloud, Download, FileDown, Info, Keyboard, Lightbulb, Lock, MessageSquareText, Palette, RefreshCw, Settings2, Type, Upload, X } from 'lucide-react'
import { useEffect, useRef, useState } from 'react'
import { useShallow } from 'zustand/react/shallow'
import { CHANGELOG } from '../data/changelog'
import { FONT_FAMILIES, fontCss } from '../editor/setup'
import { exportAllMarkdown, exportBackup } from '../lib/export'
import { feedbackUrl, type FeedbackKind } from '../lib/feedback'
import { googleAvailable } from '../lib/google'
import { changePassword, lockNow, resetPassword, useLock } from '../lib/lock'
import { RELEASES_PAGE, REPO_URL } from '../lib/release'
import { desktop, isAndroid, isMac, openExternal, secrets } from '../lib/storage'
import { listDate } from '../lib/dates'
import { connectService, createFeedFolder, disconnectService, feedLabel, refreshFeed, targetOptions, useServices } from '../lib/feeds'
import { SERVICES, serviceById } from '../lib/services'
import type { Service } from '../lib/services/types'
import { useStore } from '../lib/store'
import { syncNow, turnOffSync, turnOnSync, useSyncState } from '../lib/syncRunner'
import { THEMES } from '../lib/themes'
import { useUi, type SettingsPage } from '../lib/ui'
import { assignable, formatKeys, useKeys, useShortcuts } from '../lib/shortcuts'
import { checkForUpdates, downloadUpdate, installUpdate, useUpdate } from '../lib/updater'
import type { AppData, FeedSource, ServiceId, MathResults, Paper, Settings as SettingsT, SortBy, StartWith, TitleEngine } from '../lib/types'
import { VERSION } from '../version'
import { applyImport, importAppleNotes, importFiles } from '../import'
import { ALT, MOD, PAPERS, setupPassword, SHIFT } from './actions'
import { alertBox, confirm, openDialog, prompt, toast } from './overlays'
import { PasswordSetup } from './PasswordSetup'

// Settings: a window of its own with pages down the side, like macOS's settings windows.

const PAGES: Array<{ id: SettingsPage; label: string; icon: React.ReactNode }> = [
  { id: 'general', label: 'General', icon: <Settings2 size={16} /> },
  { id: 'appearance', label: 'Appearance', icon: <Palette size={16} /> },
  { id: 'editor', label: 'Text', icon: <Type size={16} /> },
  { id: 'lock', label: 'Password', icon: <Lock size={16} /> },
  { id: 'sync', label: 'Google Sync', icon: <Cloud size={16} /> },
  { id: 'services', label: 'Connected Services', icon: <Plug size={16} /> },
  { id: 'import', label: 'Import', icon: <Download size={16} /> },
  { id: 'export', label: 'Export & Backup', icon: <Upload size={16} /> },
  ...(desktop ? [{ id: 'shortcuts' as const, label: 'Shortcuts', icon: <Keyboard size={16} /> }] : []),
  { id: 'updates', label: 'Updates', icon: <RefreshCw size={16} /> },
  { id: 'feedback', label: 'Feedback', icon: <MessageSquareText size={16} /> },
  { id: 'about', label: 'About', icon: <Info size={16} /> }
]

const set = (patch: Partial<SettingsT>) => useStore.getState().setSettings(patch)

function Row({ label, sub, children }: { label: React.ReactNode; sub?: string; children: React.ReactNode }) {
  return (
    <div className="set-row">
      <div className="set-label">
        <div>{label}</div>
        {sub && <div className="set-sub">{sub}</div>}
      </div>
      <div className="set-control">{children}</div>
    </div>
  )
}

function Toggle({ on, onChange }: { on: boolean; onChange: (v: boolean) => void }) {
  return <button role="switch" aria-checked={on} className={`toggle${on ? ' is-on' : ''}`} onClick={() => onChange(!on)} />
}

function Select<T extends string | number>({ value, options, onChange }: { value: T; options: Array<[T, string]>; onChange: (v: T) => void }) {
  return (
    <select className="field" value={String(value)} onChange={(e) => onChange(options.find(([v]) => String(v) === e.target.value)![0])}>
      {options.map(([v, l]) => (
        <option key={String(v)} value={String(v)}>
          {l}
        </option>
      ))}
    </select>
  )
}

function Group({ title, children, footer }: { title?: string; children: React.ReactNode; footer?: React.ReactNode }) {
  return (
    <div className="set-group-wrap">
      {title && <div className="set-group-title">{title}</div>}
      <div className="set-group">{children}</div>
      {footer && <div className="set-footer">{footer}</div>}
    </div>
  )
}

function General() {
  const s = useStore(useShallow((x) => x.settings))
  const quickKeys = useKeys('global:float-note')
  return (
    <>
      <Group title="Notes">
        <Row label="Sort notes by">
          <Select<SortBy>
            value={s.sortBy}
            options={[
              ['edited', 'Date Edited'],
              ['created', 'Date Created'],
              ['title', 'Title']
            ]}
            onChange={(v) => set({ sortBy: v, sortDir: v === 'title' ? 'asc' : 'desc' })}
          />
        </Row>
        <Row label="Group notes by date">
          <Toggle on={s.groupByDate} onChange={(v) => set({ groupByDate: v })} />
        </Row>
        <Row label="New notes start with">
          <Select<StartWith>
            value={s.startWith}
            options={[
              ['title', 'Title'],
              ['heading', 'Heading'],
              ['subheading', 'Subheading'],
              ['body', 'Body']
            ]}
            onChange={(v) => set({ startWith: v })}
          />
        </Row>
        <Row label="Sort checked items" sub="Move checked checklist items to the bottom.">
          <Select<string>
            value={s.sortChecked ? 'auto' : 'manual'}
            options={[
              ['manual', 'Manually'],
              ['auto', 'Automatically']
            ]}
            onChange={(v) => set({ sortChecked: v === 'auto' })}
          />
        </Row>
        <Row label="Lines & Grids" sub="For new notes and notes you haven’t set one for.">
          <Select<Paper> value={s.paper} options={PAPERS.map((p) => [p.id, p.label])} onChange={(v) => set({ paper: v })} />
        </Row>
      </Group>
      <Group title="Math Results" footer="Type an expression followed by = to see the answer. Variables work too: “price = 12”, then “price * 3 =”.">
        <Row label="Math results">
          <Select<MathResults>
            value={s.mathResults}
            options={[
              ['suggest', 'Suggest Results (Tab to insert)'],
              ['insert', 'Insert Results'],
              ['off', 'Off']
            ]}
            onChange={(v) => set({ mathResults: v })}
          />
        </Row>
      </Group>
      <Group>
        <Row label="Tags" sub="Words starting with # become tags, listed in the sidebar.">
          <Toggle on={s.tags} onChange={(v) => set({ tags: v })} />
        </Row>
        <Row label="Check spelling while typing">
          <Toggle
            on={s.spellcheck}
            onChange={(v) => {
              set({ spellcheck: v })
              desktop?.setSpellcheck(v)
            }}
          />
        </Row>
        {desktop && (
          <Row label="Floating Quick Note" sub={quickKeys ? `${quickKeys} shows or hides a Quick Note that floats above every app.` : 'Give it keys in Settings → Shortcuts.'}>
            <Toggle
              on={s.quickNoteShortcut}
              onChange={(v) => {
                set({ quickNoteShortcut: v })
                desktop?.setQuickNoteShortcut(v)
              }}
            />
          </Row>
        )}
      </Group>
      {desktop ? (
        <Group title="Keyboard shortcuts">
          <Row label="Change any shortcut" sub="Every menu command can have its own keys.">
            <button className="btn" onClick={() => useUi.setState({ settings: 'shortcuts' })}>
              Shortcuts…
            </button>
          </Row>
        </Group>
      ) : (
      <Group title="Keyboard shortcuts">
        <div className="shortcuts">
          {(
            [
              ['New Note', `${MOD}N`],
              ['New Folder', `${SHIFT}${MOD}N`],
              ['Title / Heading / Subheading', `${SHIFT}${MOD}T / H / J`],
              ['Body', `${SHIFT}${MOD}B`],
              ['Monostyled', `${SHIFT}${MOD}M`],
              ['Bulleted / Dashed / Numbered List', `${SHIFT}${MOD}7 / 8 / 9`],
              ['Checklist', `${SHIFT}${MOD}L`],
              ['Mark as Checked', `${SHIFT}${MOD}U`],
              ['Block Quote', `${MOD}'`],
              ['Highlight', `${SHIFT}${MOD}E`],
              ['Table', `${ALT}${MOD}T`],
              ['Link', `${MOD}K`],
              ['Indent / Outdent', `${MOD}] / ${MOD}[`],
              ['Find in Note', `${MOD}F`],
              ['Search All Notes', `${ALT}${MOD}F`],
              ['Link to a Note', 'type >>']
            ] as const
          ).map(([a, k]) => (
            <div key={a} className="shortcut">
              <span>{a}</span>
              <kbd>{k}</kbd>
            </div>
          ))}
        </div>
      </Group>
      )}
    </>
  )
}

function Appearance() {
  const s = useStore(useShallow((x) => ({ appearance: x.settings.appearance, theme: x.settings.theme, translucent: x.settings.translucent })))
  const dark = document.documentElement.dataset.theme === 'dark'
  return (
    <>
      <Group title="Appearance">
        <div className="appearance-pick">
          {(
            [
              ['system', 'Auto'],
              ['light', 'Light'],
              ['dark', 'Dark']
            ] as const
          ).map(([v, l]) => (
            <button key={v} className={`appearance-opt${s.appearance === v ? ' is-on' : ''}`} onClick={() => set({ appearance: v })}>
              <span className={`appearance-swatch is-${v}`} />
              {l}
            </button>
          ))}
        </div>
      </Group>
      <Group title="Theme">
        <div className="theme-grid">
          {THEMES.map((t) => {
            const p = dark ? t.dark : t.light
            return (
              <button key={t.id} className={`theme-card${s.theme === t.id ? ' is-on' : ''}`} onClick={() => set({ theme: t.id })}>
                <div className="theme-preview" style={{ background: p.bg }}>
                  <div className="theme-side" style={{ background: p.sidebarSolid }}>
                    <span style={{ background: p.accent }} />
                    <span style={{ background: p.dim, opacity: 0.4 }} />
                    <span style={{ background: p.dim, opacity: 0.4 }} />
                  </div>
                  <div className="theme-list" style={{ background: p.list }}>
                    <span className="theme-sel" style={{ background: p.accent }} />
                    <span style={{ background: p.dim, opacity: 0.3 }} />
                  </div>
                  <div className="theme-note">
                    <span style={{ background: p.text, width: '60%' }} />
                    <span style={{ background: p.dim, opacity: 0.5 }} />
                    <span style={{ background: p.dim, opacity: 0.5, width: '70%' }} />
                  </div>
                </div>
                <div className="theme-name">
                  {s.theme === t.id && <Check size={12} />} {t.name}
                </div>
              </button>
            )
          })}
        </div>
      </Group>
      {desktop && (
        <Group>
          <Row label="See-through sidebar" sub={isMac ? 'Lets your desktop show through the sidebar.' : 'Uses Windows’ Mica material where it’s available.'}>
            <Toggle on={s.translucent} onChange={(v) => set({ translucent: v })} />
          </Row>
        </Group>
      )}
    </>
  )
}

function TextPage() {
  const s = useStore(useShallow((x) => ({ fontFamily: x.settings.fontFamily, fontSize: x.settings.fontSize, lineHeight: x.settings.lineHeight })))
  return (
    <>
      <Group title="Default font" footer="Change a selection’s font, size and colour from the Aa button. Fonts installed on your computer are listed there too.">
        <div className="font-grid">
          {FONT_FAMILIES.map((f) => (
            <button key={f.id} className={`font-card${s.fontFamily === f.id ? ' is-on' : ''}`} style={{ fontFamily: f.css }} onClick={() => set({ fontFamily: f.id })}>
              <span className="font-sample">Aa</span>
              <span className="font-name">{f.label}</span>
            </button>
          ))}
        </div>
      </Group>
      <Group>
        <Row label="Text size">
          <div className="stepper">
            <button className="btn btn-small" onClick={() => set({ fontSize: Math.max(11, s.fontSize - 1) })}>
              A−
            </button>
            <span>{s.fontSize} pt</span>
            <button className="btn btn-small" onClick={() => set({ fontSize: Math.min(28, s.fontSize + 1) })}>
              A+
            </button>
          </div>
        </Row>
        <Row label="Line spacing">
          <Select<number>
            value={s.lineHeight}
            options={[
              [1.3, 'Compact'],
              [1.45, 'Standard'],
              [1.65, 'Relaxed'],
              [1.9, 'Double']
            ]}
            onChange={(v) => set({ lineHeight: v })}
          />
        </Row>
      </Group>
      <TitlesGroup />
      <div className="font-preview" style={{ fontFamily: fontCss(s.fontFamily), fontSize: s.fontSize, lineHeight: s.lineHeight }}>
        <strong>The quick brown fox</strong> jumps over the lazy dog. Notes keeps your thoughts in order — and your lists checked.
      </div>
    </>
  )
}

function TitlesGroup() {
  const engine = useStore((s) => s.settings.titleEngine)
  const [hasKey, setHasKey] = useState<boolean | null>(null)
  const [apple, setApple] = useState<true | string | null>(null)
  const [key, setKey] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  useEffect(() => {
    void desktop?.ai.hasKey().then(setHasKey)
    void desktop?.ai.appleAvailable().then(setApple)
  }, [])
  if (!desktop) return null
  const save = async () => {
    setBusy(true)
    setError('')
    try {
      await desktop!.ai.setKey(key.trim())
      // Check it works with a tiny note.
      await desktop!.ai.title('Shopping list: milk, eggs, bread')
      setHasKey(true)
      setKey('')
      set({ titleEngine: 'claude' })
      toast('Claude will write your titles')
    } catch (e) {
      await desktop!.ai.setKey(null)
      setHasKey(false)
      setError((e as Error).message)
    } finally {
      setBusy(false)
    }
  }
  return (
    <Group
      title="Generate title"
      footer="When a note has no title, the ✨ Generate title button under the title field reads the whole note and sums it up in a title. Apple Intelligence runs on your Mac, so the note never leaves it. With Claude, the note’s text is sent to Anthropic with your own API key (from console.anthropic.com), which is kept encrypted on this computer and never synced. Basic titles only pick out the note’s main words."
    >
      <Row label="Write titles with" sub={engine === 'apple' && apple !== true && apple ? apple : engine === 'auto' ? `Now: ${apple === true ? 'Apple Intelligence' : hasKey ? 'Claude' : 'basic titles'}` : undefined}>
        <Select<TitleEngine>
          value={engine === 'claude' && !hasKey ? 'auto' : engine}
          options={[
            ['auto', 'Automatic'],
            ...(isMac ? [['apple', apple === true ? 'Apple Intelligence (on this Mac)' : 'Apple Intelligence (not available)'] as [TitleEngine, string]] : []),
            ['claude', hasKey ? 'Claude' : 'Claude (add a key below)'],
            ['basic', 'Basic (main words)']
          ]}
          onChange={(v) => set({ titleEngine: v })}
        />
      </Row>
      {hasKey ? (
        <Row label="Anthropic API key" sub="Saved on this computer.">
          <button
            className="btn"
            onClick={async () => {
              await desktop!.ai.setKey(null)
              setHasKey(false)
              if (engine === 'claude') set({ titleEngine: 'auto' })
            }}
          >
            Remove Key
          </button>
        </Row>
      ) : (
        <Row label="Anthropic API key" sub={error || 'Paste a key to let Claude write titles.'}>
          <input className="field is-key" type="password" placeholder="sk-ant-…" value={key} onChange={(e) => setKey(e.target.value)} />
          <button className="btn btn-primary" disabled={!key.trim() || busy} onClick={() => void save()}>
            {busy ? 'Checking…' : 'Save'}
          </button>
        </Row>
      )}
    </Group>
  )
}

function PasswordPage() {
  const s = useStore(useShallow((x) => ({ lock: x.settings.lock, touchId: x.settings.touchId })))
  const unlocked = useLock((x) => Boolean(x.key))
  const lockedCount = useStore((x) => x.notes.filter((n) => n.locked).length)
  if (!s.lock)
    return (
      <Group title="Locked notes" footer="Lock notes from the toolbar’s lock button or a note’s menu. Their content is encrypted; only titles stay visible.">
        <Row label="Notes password" sub="Not set up yet.">
          <button className="btn" onClick={() => void setupPassword()}>
            Set Password…
          </button>
        </Row>
      </Group>
    )
  return (
    <>
      <Group title="Locked notes" footer={`${lockedCount === 1 ? '1 note is' : `${lockedCount} notes are`} locked. Locked notes stay open until you choose Lock Now or quit Notes.`}>
        <Row label="Change password">
          <button
            className="btn"
            onClick={() =>
              openDialog((close) => (
                <ChangePassword close={close} />
              ))
            }
          >
            Change Password…
          </button>
        </Row>
        <Row label="Reset password" sub="If you’ve forgotten it. Notes locked with the old password stay locked with it.">
          <button
            className="btn"
            onClick={async () => {
              const ok = await confirm({ title: 'Reset Password?', message: 'Notes already locked will still need your old password. New locks will use the new one.', ok: 'Reset' })
              if (!ok) return
              openDialog(
                (close) => (
                  <PasswordSetup
                    title="New Password"
                    onCancel={close}
                    onDone={async (pw, hint) => {
                      await resetPassword(pw, hint)
                      close()
                      toast('Password reset')
                    }}
                  />
                ),
                { dismissable: false }
              )
            }}
          >
            Reset Password…
          </button>
        </Row>
        {desktop?.touchId.available && (
          <Row label="Use Touch ID">
            <Toggle
              on={s.touchId}
              onChange={async (v) => {
                if (!v) {
                  set({ touchId: false })
                  await desktop?.touchId.save(null)
                  return
                }
                const pw = await prompt({ title: 'Enter the notes password', message: 'To use Touch ID for locked notes.', password: true })
                if (!pw) return
                const { unlock } = await import('../lib/lock')
                if (!(await unlock(pw))) return void alertBox('Wrong password')
                await desktop?.touchId.save(pw)
                set({ touchId: true })
              }}
            />
          </Row>
        )}
        <Row label="Lock Now" sub="Close every open locked note.">
          <button className="btn" disabled={!unlocked} onClick={lockNow}>
            Lock Now
          </button>
        </Row>
      </Group>
    </>
  )
}

function ChangePassword({ close }: { close: () => void }) {
  const [old, setOld] = useState('')
  const [pw, setPw] = useState('')
  const [again, setAgain] = useState('')
  const [hint, setHint] = useState(useStore.getState().settings.lock?.hint ?? '')
  const [error, setError] = useState('')
  return (
    <form
      className="alert"
      onSubmit={async (e) => {
        e.preventDefault()
        if (pw !== again) return setError('The new passwords don’t match.')
        if (!(await changePassword(old, pw, hint))) return setError('The old password is wrong.')
        close()
        toast('Password changed')
      }}
    >
      <div className="alert-title">Change Password</div>
      <input className="field" type="password" autoFocus placeholder="Old password" value={old} onChange={(e) => setOld(e.target.value)} />
      <input className="field" type="password" placeholder="New password" value={pw} onChange={(e) => setPw(e.target.value)} />
      <input className="field" type="password" placeholder="Verify" value={again} onChange={(e) => setAgain(e.target.value)} />
      <input className="field" placeholder="Hint (recommended)" value={hint} onChange={(e) => setHint(e.target.value)} />
      {error && <div className="alert-error">{error}</div>}
      <div className="alert-buttons">
        <button type="button" className="btn" onClick={close}>
          Cancel
        </button>
        <button type="submit" className="btn btn-primary" disabled={!old || !pw}>
          Change
        </button>
      </div>
    </form>
  )
}

function SyncPage() {
  const sync = useStore(useShallow((s) => s.sync))
  const { busy, progress, conflicts } = useSyncState()
  const [working, setWorking] = useState(false)
  const [error, setError] = useState('')
  const available = googleAvailable()
  return (
    <>
      <div className="set-hero">
        <Cloud size={34} strokeWidth={1.4} />
        <div>
          <div className="set-hero-title">Sync with Google</div>
          <div className="set-sub">Your notes, folders, pictures and settings are kept in a private folder in your Google Drive that only Notes can see. Sign in on each computer and your Android phone to have them everywhere.</div>
        </div>
      </div>
      <Group>
        {sync.enabled ? (
          <>
            <Row label="Signed in" sub={sync.email ?? 'Google account'}>
              <button
                className="btn"
                onClick={async () => {
                  if (await confirm({ title: 'Turn off Sync?', message: 'Your notes stay on this computer and in your Google Drive.', ok: 'Turn Off' })) await turnOffSync()
                }}
              >
                Turn Off
              </button>
            </Row>
            <Row label="Last synced" sub={busy ? (progress ?? 'Syncing…') : sync.lastSync ? new Date(sync.lastSync).toLocaleString() : 'Not yet'}>
              <button className="btn" disabled={busy} onClick={() => void syncNow()}>
                Sync Now
              </button>
            </Row>
          </>
        ) : (
          <Row label="Sync is off" sub={available ? 'Sign in with your Google account to start.' : 'This copy of Notes wasn’t built with a Google client, so it can’t sign in.'}>
            <button
              className="btn btn-primary"
              disabled={!available || working}
              onClick={async () => {
                setWorking(true)
                setError('')
                try {
                  await turnOnSync()
                } catch (e) {
                  setError((e as Error).message)
                } finally {
                  setWorking(false)
                }
              }}
            >
              {working ? 'Waiting for Google…' : 'Sign in with Google'}
            </button>
          </Row>
        )}
      </Group>
      {(error || sync.error) && <div className="set-error">{error || sync.error}</div>}
      {conflicts > 0 && <div className="set-note">{conflicts === 1 ? 'A note was changed on two devices at once; both versions were kept (look for “conflict copy”).' : `${conflicts} notes were changed on two devices at once; both versions were kept (look for “conflict copy”).`}</div>}
      {working && <div className="set-note">Finish signing in in your browser, then come back here.</div>}
    </>
  )
}

// Each app's own icon (from its App Store or Google Play listing; Apple Notes' from the Mac).
const IMPORT_ICONS: Record<string, string> = import.meta.glob('../assets/import/*.png', { eager: true, import: 'default', query: '?url' })
const importIcon = (id: string): string | undefined => IMPORT_ICONS[`../assets/import/${id}.png`]

const IMPORTERS: Array<{ id: string; name: string; how: string; accept: string; color: string }> = [
  { id: 'apple', name: 'Apple Notes', how: 'Reads your notes straight from the Notes app on this Mac. On Windows, import notes you’ve exported as PDF or Markdown.', accept: '', color: '#f5c400' },
  { id: 'samsung', name: 'Samsung Notes', how: 'Import .sdocx files, or notes saved from Samsung Notes as Word, PDF or text files (Share → Save as file).', accept: '.sdocx,.docx,.pdf,.txt,.zip', color: '#f25c4c' },
  { id: 'notion', name: 'Notion', how: 'In Notion: Settings → Export all workspace content (or a page’s ••• → Export) as “Markdown & CSV” or “HTML”, then import the .zip.', accept: '.zip,.md,.html', color: '#111111' },
  { id: 'evernote', name: 'Evernote', how: 'In Evernote: select notes or a notebook → Export as ENEX (.enex), then import that file.', accept: '.enex', color: '#00a82d' },
  { id: 'keep', name: 'Google Keep', how: 'At takeout.google.com choose only Keep, download the .zip, then import it.', accept: '.zip,.json', color: '#fbbc04' },
  { id: 'onenote', name: 'OneNote & Word', how: 'Save pages from OneNote or documents from Word as .docx, then import them.', accept: '.docx', color: '#7719aa' },
  { id: 'bear', name: 'Bear', how: 'In Bear: File → Backup Notes (.bear2bk), or export as Markdown/TextBundle (zip it), then import.', accept: '.bear2bk,.zip,.md', color: '#dd4c4f' },
  { id: 'obsidian', name: 'Obsidian & Markdown', how: 'Zip your vault (or pick .md files). Folders are kept, and ![[pictures]] come along.', accept: '.zip,.md,.markdown,.txt', color: '#7c3aed' },
  { id: 'simplenote', name: 'Simplenote', how: 'In Simplenote: File → Export Notes, then import the .zip.', accept: '.zip,.json', color: '#3361cc' },
  { id: 'standard', name: 'Standard Notes', how: 'Download a decrypted backup (.json) from Standard Notes, then import it.', accept: '.json', color: '#086dd6' },
  { id: 'files', name: 'Other files', how: 'Markdown, text, HTML, Word (.docx), PDF, or a Notes backup (.notesbackup).', accept: '.md,.markdown,.txt,.html,.htm,.docx,.pdf,.zip,.notesbackup,.json,.enex', color: '#8e8e93' }
]

function ImportPage() {
  const [busy, setBusy] = useState<string | null>(null)
  const [over, setOver] = useState(false)
  const run = async (fn: (p: (t: string) => void) => Promise<Awaited<ReturnType<typeof importFiles>>>) => {
    setBusy('Starting…')
    try {
      const r = await fn((t) => setBusy(t))
      if ('settings' in r) {
        const ok = await confirm({ title: 'Restore this backup?', message: `It has ${r.notes.length} notes. Restoring replaces all the notes on this computer${useStore.getState().sync.enabled ? ' (and in Sync)' : ''}.`, ok: 'Restore', danger: true })
        if (ok) useStore.getState().replaceAll(r as AppData)
        return
      }
      const count = applyImport(r)
      if (r.folders[0]) useUi.getState().select({ kind: 'folder', id: r.folders[0].id })
      await alertBox(count === 1 ? 'Imported 1 note' : `Imported ${count} notes`, r.skipped.length ? `Not imported:\n• ${r.skipped.slice(0, 12).join('\n• ')}${r.skipped.length > 12 ? `\n…and ${r.skipped.length - 12} more` : ''}` : r.folders.length ? `They’re in the “${r.folders[0].name}” folder.` : undefined)
    } catch (e) {
      await alertBox('Couldn’t import', (e as Error).message)
    } finally {
      setBusy(null)
    }
  }
  const pick = (accept: string) => {
    const input = document.createElement('input')
    input.type = 'file'
    input.multiple = true
    input.accept = accept
    input.onchange = () => input.files?.length && void run((p) => importFiles([...input.files!], p))
    input.click()
  }
  return (
    <>
      <div
        className={`drop-zone${over ? ' is-over' : ''}`}
        onDragOver={(e) => (e.preventDefault(), setOver(true))}
        onDragLeave={() => setOver(false)}
        onDrop={(e) => {
          e.preventDefault()
          setOver(false)
          const files = [...e.dataTransfer.files]
          if (files.length) void run((p) => importFiles(files, p))
        }}
      >
        {busy ? (
          <>
            <RefreshCw size={22} className="spin" /> {busy}
          </>
        ) : (
          <>
            <FileDown size={22} /> Drop exported notes here, or choose an app below.
          </>
        )}
      </div>
      <div className="import-grid">
        {IMPORTERS.map((im) => (
          <button
            key={im.id}
            className="import-card"
            disabled={Boolean(busy) || (im.id === 'apple' && desktop?.platform !== 'darwin' && false)}
            onClick={() => (im.id === 'apple' && desktop?.platform === 'darwin' ? void run(importAppleNotes) : pick(im.accept || '*/*'))}
          >
            {importIcon(im.id) ? (
              <img className="import-icon" src={importIcon(im.id)} alt="" draggable={false} />
            ) : (
              <span className="import-badge" style={{ background: im.color }}>
                <FileText size={18} />
              </span>
            )}
            <span className="import-text">
              <span className="import-name">{im.name}</span>
              <span className="import-how">{im.how}</span>
            </span>
          </button>
        ))}
      </div>
    </>
  )
}

function ExportPage() {
  const [busy, setBusy] = useState(false)
  const go = async (fn: () => Promise<boolean>) => {
    setBusy(true)
    try {
      if (await fn()) toast('Exported')
    } catch (e) {
      await alertBox('Couldn’t export', (e as Error).message)
    } finally {
      setBusy(false)
    }
  }
  return (
    <>
      <Group title="Export" footer="Every note as a Markdown file, in folders like yours, with pictures and attachments beside them. Locked notes are included only while they’re open.">
        <Row label="All notes as Markdown (.zip)">
          <button className="btn" disabled={busy} onClick={() => void go(exportAllMarkdown)}>
            Export…
          </button>
        </Row>
      </Group>
      <Group title="Backup" footer="Everything — notes, folders, attachments and settings — in one file. Restore it from Import (or drop it there).">
        <Row label="Back up all notes">
          <button className="btn" disabled={busy} onClick={() => void go(exportBackup)}>
            Back Up…
          </button>
        </Row>
      </Group>
      <Group title="Single notes">
        <div className="set-sub set-pad">Export one note as PDF, Markdown, HTML or plain text from the Share button in the toolbar, or print it.</div>
      </Group>
    </>
  )
}

function UpdatesPage() {
  const u = useUpdate()
  const checkUpdatesOn = useStore((s) => s.settings.checkUpdates)
  return (
    <>
      <Group>
        <Row label="Notes" sub={`Version ${VERSION}`}>
          {u.state === 'available' ? (
            <button className="btn btn-primary" onClick={() => void downloadUpdate()}>
              {u.inApp ? `Download ${u.version}` : 'Get the Update'}
            </button>
          ) : u.state === 'downloading' ? (
            <span className="set-sub">Downloading… {Math.round((u.progress ?? 0) * 100)}%</span>
          ) : u.state === 'ready' ? (
            <button className="btn btn-primary" onClick={() => void installUpdate()}>
              Restart to Update
            </button>
          ) : (
            <button className="btn" disabled={u.state === 'checking' || u.state === 'installing'} onClick={() => void checkForUpdates(false)}>
              {u.state === 'checking' ? 'Checking…' : u.state === 'installing' ? 'Installing…' : 'Check for Updates'}
            </button>
          )}
        </Row>
        <Row label="Check for updates automatically">
          <Toggle
            on={checkUpdatesOn}
            onChange={(v) => {
              set({ checkUpdates: v })
              desktop?.updater.setAuto(v)
            }}
          />
        </Row>
      </Group>
      {u.state === 'latest' && <div className="set-note">Notes is up to date.</div>}
      {u.error && <div className="set-error">{u.error}</div>}
      {u.state === 'available' && u.notes && (
        <Group title={`What’s new in ${u.version}`}>
          <div className="release-notes">{u.notes}</div>
        </Group>
      )}
      <div className="set-links">
        <button className="link" onClick={() => openExternal(RELEASES_PAGE)}>
          All releases on GitHub
        </button>
      </div>
    </>
  )
}

/** A service's logo on its brand colour, like an app icon. */
function ServiceLogo({ service, size = 26 }: { service: Service; size?: number }) {
  return (
    <span className="svc-logo" style={{ width: size, height: size, background: service.color }}>
      <svg width={size * 0.6} height={size * 0.6} viewBox="0 0 24 24" fill="#fff" aria-hidden="true">
        <path d={service.logo} />
      </svg>
    </span>
  )
}

function ServiceRow({ service }: { service: Service }) {
  const account = useServices((s) => s.accounts[service.id])
  const saved = useServices((s) => s.errors[service.id])
  const checking = useServices((s) => s.checking)
  const [open, setOpen] = useState(false)
  const [values, setValues] = useState<Record<string, string>>({})
  const [working, setWorking] = useState(false)
  const [error, setError] = useState('')
  const connect = async () => {
    setWorking(true)
    setError('')
    try {
      await connectService(service.id, values)
      setValues({})
      setOpen(false)
    } catch (e) {
      setError((e as Error).message)
    } finally {
      setWorking(false)
    }
  }
  const form = service.connect !== 'google' ? service.connect : null
  const ready = form ? form.fields.every((f) => values[f.key]?.trim()) : true
  return (
    <>
      <Row
        label={
          <span className="svc-name">
            <ServiceLogo service={service} />
            {service.name}
          </span>
        }
        sub={account ? `Connected as ${account.login}` : checking ? 'Checking…' : error || saved || 'Not connected'}
      >
        {account ? (
          <button className="btn" onClick={() => void disconnectService(service.id)}>
            Disconnect
          </button>
        ) : form ? (
          <button className={`btn${open ? '' : ' btn-primary'}`} onClick={() => setOpen(!open)}>
            {open ? 'Cancel' : 'Connect'}
          </button>
        ) : (
          <button className="btn btn-primary" disabled={working} onClick={() => void connect()}>
            {working ? 'Waiting for Google…' : 'Sign in with Google'}
          </button>
        )}
      </Row>
      {open && form && !account && (
        <div className="svc-form">
          {form.fields.map((f) => (
            <label key={f.key} className="svc-field">
              <span>{f.label}</span>
              <input className="field" type={f.secret ? 'password' : 'text'} placeholder={f.placeholder} value={values[f.key] ?? ''} onChange={(e) => setValues({ ...values, [f.key]: e.target.value })} />
            </label>
          ))}
          <div className="svc-form-foot">
            <span className="set-sub">
              {form.help}{' '}
              <button className="link-btn" onClick={() => openExternal(form.helpUrl)}>
                {form.helpLabel}
              </button>
            </span>
            <button className="btn btn-primary" disabled={!ready || working} onClick={() => void connect()}>
              {working ? 'Checking…' : 'Connect'}
            </button>
          </div>
        </div>
      )}
    </>
  )
}

function ServicesPage() {
  const accounts = useServices((s) => s.accounts)
  const busy = useServices((s) => s.busy)
  const feeds = useStore(useShallow((s) => s.folders.filter((f) => f.feed)))
  const connected = SERVICES.filter((s) => accounts[s.id])
  return (
    <>
      <div className="set-hero">
        <Plug size={34} strokeWidth={1.4} />
        <div>
          <div className="set-hero-title">Connected Services</div>
          <div className="set-sub">Smart Folders that fill themselves from other apps. Each item becomes a note you can read and search, with its status when it’s a task, and the folder keeps up as things change there.</div>
        </div>
      </div>
      <Group title="Services" footer="Sign-ins stay on this device (encrypted where the system allows) and are never synced: connect each computer or phone you want refreshing. The folders and their notes sync as usual. Notes only reads from these services.">
        {SERVICES.map((s) => (
          <ServiceRow key={s.id} service={s} />
        ))}
      </Group>
      {connected.length > 0 && <NewFeedFolder services={connected} />}
      {feeds.length > 0 && (
        <Group title="Your connected Smart Folders">
          {feeds.map((f) => (
            <Row
              key={f.id}
              label={
                <span className="svc-name">
                  <ServiceLogo service={serviceById(f.feed!.provider)} size={20} />
                  {f.name}
                </span>
              }
              sub={f.feed!.error ?? `${feedLabel(f.feed!)} · ${f.feed!.lastSync ? `refreshed ${listDate(f.feed!.lastSync).toLowerCase()}` : 'not refreshed yet'}`}
            >
              <button className="btn" disabled={!accounts[f.feed!.provider] || busy.includes(f.id)} onClick={() => void refreshFeed(f.id)}>
                {busy.includes(f.id) ? 'Refreshing…' : 'Refresh'}
              </button>
              <button
                className="btn"
                onClick={() => {
                  useUi.getState().select({ kind: 'folder', id: f.id })
                  useUi.setState({ settings: null })
                }}
              >
                Show
              </button>
            </Row>
          ))}
        </Group>
      )}
    </>
  )
}

/** Make a Smart Folder from a connected service: which service, which of its lists, which target. */
function NewFeedFolder({ services }: { services: Service[] }) {
  const [serviceId, setServiceId] = useState<ServiceId>(services[0].id)
  const service = services.find((s) => s.id === serviceId) ?? services[0]
  const [kind, setKind] = useState(service.sources[0].kind)
  const source = service.sources.find((k) => k.kind === kind) ?? service.sources[0]
  const [options, setOptions] = useState<Array<[string, string]> | null>(null)
  const [target, setTarget] = useState('')
  const [name, setName] = useState('')
  const [error, setError] = useState('')
  useEffect(() => {
    setOptions(null)
    setTarget('')
    setError('')
    if (!source.target || source.target.free) return
    let live = true
    targetOptions(service.id, source.kind)
      .then((o) => {
        if (!live) return
        setOptions(o)
        if (o[0]) setTarget(o[0][0])
      })
      .catch((e) => live && setError((e as Error).message))
    return () => {
      live = false
    }
  }, [service.id, source.kind, source.target])
  const targetName = options?.find(([id]) => id === target)?.[1]
  const fallback = source.target && !source.target.free ? (targetName?.replace(/ \([^)]*\)$/, '').split('/').pop() ?? source.folderName) : source.folderName
  return (
    <Group title="New connected Smart Folder">
      <Row label="From">
        <Select<ServiceId>
          value={service.id}
          options={services.map((s) => [s.id, s.name] as [ServiceId, string])}
          onChange={(v) => {
            setServiceId(v)
            setKind(services.find((s) => s.id === v)!.sources[0].kind)
          }}
        />
      </Row>
      <Row label="Fill it with">
        <Select<string> value={source.kind} options={service.sources.map((k) => [k.kind, k.label] as [string, string])} onChange={setKind} />
      </Row>
      {source.target && (
        <Row label={source.target.label} sub={error || (!source.target.free && !options ? 'Loading…' : undefined)}>
          {options?.length ? (
            <Select<string> value={target} options={options} onChange={setTarget} />
          ) : (
            <input className="field" placeholder={source.target.placeholder} value={target} onChange={(e) => setTarget(e.target.value)} />
          )}
        </Row>
      )}
      <Row label="Folder name">
        <input className="field" placeholder={fallback} value={name} onChange={(e) => setName(e.target.value)} />
      </Row>
      <Row label="">
        <button
          className="btn btn-primary"
          disabled={Boolean(source.target) && !target.trim()}
          onClick={() => {
            const feed: FeedSource = { provider: service.id, kind: source.kind, ...(source.target ? { target: target.trim(), targetName: targetName ?? target.trim() } : {}) }
            const f = createFeedFolder(name.trim() || fallback, feed)
            setName('')
            useUi.getState().select({ kind: 'folder', id: f.id })
            useUi.setState({ settings: null })
          }}
        >
          Create Smart Folder
        </button>
      </Row>
    </Group>
  )
}

function FeedbackPage() {
  const [kind, setKind] = useState<FeedbackKind>('bug')
  const [title, setTitle] = useState('')
  const [text, setText] = useState('')
  return (
    <>
      <div className="set-hero">
        <MessageSquareText size={34} strokeWidth={1.4} />
        <div>
          <div className="set-hero-title">Send Feedback</div>
          <div className="set-sub">Report a bug or suggest a feature. You’ll finish on GitHub, where you can add screenshots and follow the reply.</div>
        </div>
      </div>
      <div className="feedback-kinds">
        <button className={`feedback-kind${kind === 'bug' ? ' is-on' : ''}`} onClick={() => setKind('bug')}>
          <Bug size={18} /> Report a Bug
        </button>
        <button className={`feedback-kind${kind === 'feature' ? ' is-on' : ''}`} onClick={() => setKind('feature')}>
          <Lightbulb size={18} /> Request a Feature
        </button>
      </div>
      <input className="field" placeholder={kind === 'bug' ? 'What went wrong, in a few words' : 'Your idea, in a few words'} value={title} onChange={(e) => setTitle(e.target.value)} />
      <textarea className="field feedback-text" placeholder={kind === 'bug' ? 'What did you do, what did you expect, and what happened instead?' : 'What should Notes do, and why would it help?'} value={text} onChange={(e) => setText(e.target.value)} />
      <div className="feedback-foot">
        <span className="set-sub">Notes {VERSION} · {desktop ? (desktop.platform === 'darwin' ? 'Mac' : desktop.platform === 'win32' ? 'Windows' : 'Linux') : 'Web'}</span>
        <button
          className="btn btn-primary"
          disabled={!title.trim()}
          onClick={() => {
            openExternal(feedbackUrl(kind, title, text, VERSION))
            setTitle('')
            setText('')
            toast('Opened GitHub in your browser')
          }}
        >
          Continue on GitHub
        </button>
      </div>
    </>
  )
}

function AboutPage() {
  return (
    <>
      <div className="about">
        <img src="./icon.png" alt="" className="about-icon" />
        <div className="about-name">Notes</div>
        <div className="set-sub">Version {VERSION}</div>
        <div className="set-links">
          <button className="link" onClick={() => openExternal(REPO_URL)}>
            GitHub
          </button>
          <button className="link" onClick={() => openExternal(`${REPO_URL}/blob/main/LICENSE`)}>
            License
          </button>
          <button className="link" onClick={() => openExternal('https://deli5150.github.io/notes/privacy.html')}>
            Privacy
          </button>
        </div>
      </div>
      {CHANGELOG.map((c) => (
        <Group key={c.version} title={`What’s New in ${c.version}`}>
          <ul className="whats-new">
            {c.items.map((i) => (
              <li key={i}>{i}</li>
            ))}
          </ul>
        </Group>
      ))}
      <div className="set-footer">Not affiliated with Apple or the makers of the other apps it imports from; their names and icons belong to them. Brand logos for folders: Simple Icons (CC0). Emoji data: Emojibase (MIT). Fonts: Inter, Lora, Merriweather, Playfair Display, Nunito, JetBrains Mono and Caveat (SIL Open Font License).</div>
    </>
  )
}

const RENDER: Record<SettingsPage, () => React.ReactElement> = {
  general: General,
  appearance: Appearance,
  editor: TextPage,
  lock: PasswordPage,
  sync: SyncPage,
  import: ImportPage,
  export: ExportPage,
  services: ServicesPage,
  shortcuts: ShortcutsPage,
  updates: UpdatesPage,
  feedback: FeedbackPage,
  about: AboutPage
}

function ShortcutsPage() {
  const list = useShortcuts((s) => s.list)
  const overrides = useStore((s) => s.settings.shortcuts)
  const [query, setQuery] = useState('')
  const [editing, setEditing] = useState<string | null>(null)
  const [hint, setHint] = useState('')

  const assign = (id: string, keys: string) => {
    const next = { ...useStore.getState().settings.shortcuts }
    const entry = useShortcuts.getState().list.find((s) => s.id === id)
    const taken = keys ? useShortcuts.getState().list.find((s) => s.id !== id && s.keys === keys) : undefined
    if (taken) {
      next[taken.id] = ''
      toast(`${formatKeys(keys)} was ${taken.label}: that now has no shortcut`)
    }
    if (entry && keys === entry.def) delete next[id]
    else next[id] = keys
    set({ shortcuts: next })
  }

  // Waiting for keys: the desktop app sends them here instead of running anything.
  useEffect(() => {
    if (!editing || !desktop) return
    desktop.shortcuts.capture(true)
    setHint('')
    const off = desktop.shortcuts.onCaptured((keys) => {
      if (keys === 'Escape') return setEditing(null)
      if (keys === 'Backspace' || keys === 'Delete') {
        assign(editing, '')
        return setEditing(null)
      }
      if (!assignable(keys)) return setHint(`Include ${isMac ? '⌘, ⌃ or ⌥' : 'Ctrl or Alt'} (or use a function key)`)
      assign(editing, keys)
      setEditing(null)
    })
    return () => {
      off()
      desktop!.shortcuts.capture(false)
    }
  }, [editing])

  const q = query.trim().toLowerCase()
  const shown = list.filter((s) => !q || s.label.toLowerCase().includes(q) || s.group.toLowerCase().includes(q) || formatKeys(s.keys).toLowerCase().includes(q))
  const groups = [...new Set(shown.map((s) => s.group))]
  const changed = Object.keys(overrides ?? {}).length > 0
  return (
    <>
      <div className="shortcuts-bar">
        <input className="field" placeholder="Search shortcuts" value={query} onChange={(e) => setQuery(e.target.value)} />
        <button className="btn" disabled={!changed} onClick={() => set({ shortcuts: {} })}>
          Reset All
        </button>
      </div>
      {groups.map((g) => (
        <Group key={g} title={g}>
          {shown
            .filter((s) => s.group === g)
            .map((s) => {
              const on = editing === s.id
              const custom = Object.hasOwn(overrides ?? {}, s.id)
              return (
                <Row key={s.id} label={s.label} sub={on ? hint || 'Press the new keys. Esc cancels, Delete removes.' : s.global ? 'Works even when Notes is in the background.' : undefined}>
                  {custom && (
                    <button className="tb-btn is-small" title={`Back to ${formatKeys(s.def) || 'none'}`} onClick={() => assign(s.id, s.def)}>
                      <RotateCcw size={13} />
                    </button>
                  )}
                  <button className={`keys-btn${on ? ' is-on' : ''}${s.keys ? '' : ' is-none'}`} onClick={() => setEditing(on ? null : s.id)}>
                    {on ? 'Press keys…' : formatKeys(s.keys) || 'None'}
                  </button>
                </Row>
              )
            })}
        </Group>
      ))}
      <div className="set-footer">Click a shortcut, then press the keys you want. Undo, cut, copy, paste and Select All keep your system’s keys.</div>
    </>
  )
}

export function SettingsWindow() {
  const page = useUi((s) => s.settings)
  const settingsKeys = useKeys('settings')
  const body = useRef<HTMLDivElement>(null)
  useEffect(() => {
    body.current?.scrollTo(0, 0)
  }, [page])
  useEffect(() => {
    const key = (e: KeyboardEvent) => e.key === 'Escape' && useUi.setState({ settings: null })
    addEventListener('keydown', key)
    return () => removeEventListener('keydown', key)
  }, [])
  if (!page) return null
  const Page = RENDER[page]
  const close = () => useUi.setState({ settings: null })
  return (
    <div className="scrim" onMouseDown={(e) => e.target === e.currentTarget && close()}>
      <div className="settings">
        <nav className="settings-nav">
          <div className="settings-nav-title">Settings</div>
          {PAGES.map((p) => (
            <button key={p.id} className={`settings-nav-item${p.id === page ? ' is-on' : ''}`} onClick={() => useUi.setState({ settings: p.id })}>
              {p.icon}
              {p.label}
            </button>
          ))}
          <div className="settings-nav-foot">
            <Keyboard size={12} /> {settingsKeys || (isMac ? '⌘,' : 'Ctrl+,')} opens Settings
          </div>
        </nav>
        <div className="settings-body" ref={body}>
          <div className="settings-head">
            <div className="settings-title">{PAGES.find((p) => p.id === page)?.label}</div>
            <button className="tb-btn" title="Close" onClick={close}>
              <X size={16} />
            </button>
          </div>
          <Page />
        </div>
      </div>
    </div>
  )
}
