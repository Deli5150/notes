// Notes' data: one JSON document (folders, notes, settings), saved by the desktop app as a file and
// synced with Google per entry (src/lib/sync.ts). Pictures and other attachments are separate
// files, referenced from a note's content by id (src/lib/attachments.ts).

export type Paper = 'none' | 'lines-small' | 'lines' | 'lines-large' | 'grid-small' | 'grid' | 'grid-large' | 'dots'

export interface Note {
  id: string
  folderId: string
  /** The note's content as HTML (the editor's schema). Empty while the note is locked. */
  html: string
  /** Plain text of the content, for search and the list's preview. Empty while locked. */
  text: string
  /** What the title field says (the body then has no title line). Missing on notes from before it. */
  name?: string
  /** The title shown everywhere: the name, else the body's first line. Visible while locked. */
  title: string
  createdAt: number
  updatedAt: number
  pinned: boolean
  /** #tags found in the text. */
  tags: string[]
  /** Attachment ids used by the note (for sync and the attachments browser). */
  attachments: string[]
  /** The first picture, shown in the list and gallery. */
  thumb?: string
  hasChecklist: boolean
  paper?: Paper
  /** Set when the note is locked: its content, encrypted with the notes password. */
  locked?: LockedContent
  /** Moved to Recently Deleted at this time (deleted for good 30 days later). */
  deletedAt?: number
  /** The folder it was deleted from, to put it back on Recover. */
  deletedFrom?: string
}

export interface LockedContent {
  /** AES-GCM over JSON { html, text, attachments }; base64. */
  data: string
  iv: string
  /** Which password version locked it (see Settings.lock). */
  v: number
}

export interface SmartFilter {
  /** Every condition must match ("all") or any of them ("any"). */
  match: 'all' | 'any'
  tags: string[]
  /** Tag condition: notes with any of the tags, all of them, or none of them. */
  tagMode: 'any' | 'all' | 'none'
  created?: DateRange
  edited?: DateRange
  checklists?: 'any' | 'checked' | 'unchecked'
  attachments?: boolean
  locked?: boolean
  pinned?: boolean
  quickNotes?: boolean
  folders?: string[]
}

export interface DateRange {
  /** Within the last N days, or from/to dates. */
  lastDays?: number
  from?: number
  to?: number
}

export interface Folder {
  id: string
  name: string
  parentId?: string
  createdAt: number
  /** Order among siblings (lower first). */
  order: number
  /** A Smart Folder: shows notes from anywhere that match. */
  smart?: SmartFilter
  /** Its pinned tile's icon: a Lucide icon name ("lucide:Book") or an emoji. */
  icon?: string
  /** Its tile's colour (a hex colour), else the theme's accent. */
  color?: string
  /** The folder's own sort (else the app's). */
  sort?: SortBy
}

export type SortBy = 'edited' | 'created' | 'title'
export type StartWith = 'title' | 'heading' | 'subheading' | 'body'
export type Appearance = 'system' | 'light' | 'dark'
export type MathResults = 'off' | 'suggest' | 'insert'

export interface LockSettings {
  /** PBKDF2 salt and a check value, so a typed password can be verified. */
  salt: string
  check: string
  checkIv: string
  hint: string
  /** Bumped when the password changes (notes locked with older versions get re-encrypted on unlock). */
  v: number
}

export interface Settings {
  appearance: Appearance
  theme: string
  sortBy: SortBy
  sortDir: 'desc' | 'asc'
  groupByDate: boolean
  view: 'list' | 'gallery'
  startWith: StartWith
  /** Move checked checklist items to the bottom. */
  sortChecked: boolean
  paper: Paper
  mathResults: MathResults
  fontFamily: string
  fontSize: number
  lineHeight: number
  /** Show #tags highlighted and in the sidebar. */
  tags: boolean
  checkUpdates: boolean
  translucent: boolean
  quickNoteShortcut: boolean
  /** Keyboard shortcuts changed in Settings → Shortcuts: { command id: keys }, "" for none. */
  shortcuts: Record<string, string>
  spellcheck: boolean
  lock?: LockSettings
  /** Passwords replaced by Reset Password: notes locked with them still open with them. */
  lockHistory?: LockSettings[]
  touchId: boolean
  sidebarWidth: number
  listWidth: number
  sidebarHidden: boolean
  lastSeenVersion?: string
  collapsedFolders: string[]
  /** The pinned folders section is folded away. */
  foldersCollapsed: boolean
  /** Generate title: on this computer, or with Claude (needs an API key on this computer). */
  /** auto: Apple Intelligence when the Mac has it, else Claude with a key, else basic. */
  titleEngine: TitleEngine
}

export interface AppData {
  version: 1
  folders: Folder[]
  notes: Note[]
  settings: Settings
}

export const QUICK_NOTES = 'quick'
export const DEFAULT_FOLDER = 'notes'

export type TitleEngine = 'auto' | 'apple' | 'claude' | 'basic'
