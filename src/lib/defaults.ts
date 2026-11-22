import { DEFAULT_FOLDER, QUICK_NOTES, type AppData, type Folder, type Note, type Settings } from './types'

export const DEFAULT_SETTINGS: Settings = {
  appearance: 'system',
  theme: 'classic',
  sortBy: 'edited',
  sortDir: 'desc',
  groupByDate: true,
  view: 'list',
  startWith: 'title',
  sortChecked: false,
  paper: 'none',
  mathResults: 'suggest',
  fontFamily: 'system',
  fontSize: 15,
  lineHeight: 1.45,
  tags: true,
  checkUpdates: true,
  translucent: true,
  quickNoteShortcut: true,
  spellcheck: true,
  touchId: false,
  sidebarWidth: 220,
  listWidth: 290,
  sidebarHidden: false,
  collapsedFolders: []
}

export const systemFolders = (now = Date.now()): Folder[] => [
  { id: QUICK_NOTES, name: 'Quick Notes', createdAt: now, order: -2 },
  { id: DEFAULT_FOLDER, name: 'Notes', createdAt: now, order: -1 }
]

export const isSystemFolder = (id: string): boolean => id === QUICK_NOTES || id === DEFAULT_FOLDER

const WELCOME = `<h1>Welcome to Notes</h1>
<p>Notes keeps your thoughts, lists and pictures together, and syncs them with your Google account.</p>
<h2>Make it yours</h2>
<p>Use the <strong>Aa</strong> button for a <strong>Title</strong>, <strong>Heading</strong>, <strong>Subheading</strong>, <code>Monostyled</code> text, lists and block quotes — or <strong>bold</strong>, <em>italic</em>, <u>underline</u>, <s>strikethrough</s> and <mark data-color="yellow">highlights</mark>.</p>
<ul data-type="taskList"><li data-type="taskItem" data-checked="true"><p>Make a checklist</p></li><li data-type="taskItem" data-checked="false"><p>Add a table, a sketch, a recording or a picture</p></li><li data-type="taskItem" data-checked="false"><p>Tag notes with #ideas and find them in the sidebar</p></li></ul>
<h3>Math Notes</h3>
<p>Type an expression and an equals sign:</p>
<p>rent = 1200</p>
<p>rent * 12 =</p>
<blockquote><p>Settings has themes, Google Sync, importing from Apple Notes, Notion, Evernote, Google Keep and more.</p></blockquote>`

export function welcomeNote(now = Date.now()): Note {
  return {
    id: `welcome-${now.toString(36)}`,
    folderId: DEFAULT_FOLDER,
    html: WELCOME,
    text: '',
    title: 'Welcome to Notes',
    createdAt: now,
    updatedAt: now,
    pinned: false,
    tags: ['ideas'],
    attachments: [],
    hasChecklist: true
  }
}

export const emptyData = (): AppData => ({ version: 1, folders: systemFolders(), notes: [], settings: { ...DEFAULT_SETTINGS } })

export const uid = (): string => `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 10)}`
