/** What's New, newest first (also in CHANGELOG.md for the GitHub releases). */
export const CHANGELOG: Array<{ version: string; date: string; items: string[] }> = [
  {
    version: '1.0.5',
    date: '2026-11-26',
    items: [
      'Connected services sign in once for all your devices: with Sync with Google on, a GitHub, Todoist, Linear or Jira sign-in made on one device reaches your others, so you can make and manage connected Smart Folders anywhere. Disconnecting signs them all out. Google Tasks still signs in on each device (#3)',
      'Android: feedback now opens GitHub’s form inside the app, so the description and the bug or feature form come through instead of just the title. The description is also copied, in case it’s ever missing'
    ]
  },
  {
    version: '1.0.4',
    date: '2026-11-26',
    items: [
      'Sync with Google is much quicker: creating, deleting, moving or pinning a note or folder goes up right away, typing goes up within a moment of a pause, and your other devices check for changes every few seconds (#2)',
      'GitHub Smart Folders can show several repositories: pick as many as you like from a searchable list when you make the folder. Issues assigned to you, issues you opened and your pull requests can be narrowed to the repositories you pick, too (#1)'
    ]
  },
  {
    version: '1.0.3',
    date: '2026-11-24',
    items: [
      'Sync with Google no longer makes “(conflict copy)” notes of a note you’re writing. If you kept typing while it was sending your changes, it mistook its own upload for an edit from another device, so a new note written in one go could end up as three',
      'Android: closing the keyboard ends editing, so the cursor doesn’t stay in the note',
      'Android: tap a link in a note to open it (web links, email, phone numbers and links to other notes). While you’re typing, a tap on a link still puts the cursor in it, so you can edit it'
    ]
  },
  {
    version: '1.0.2',
    date: '2026-11-23',
    items: [
      'Pinned folders and subfolders: a pinned folder’s “All of …” chip now shows every note in it, including the ones in its subfolders, and each subfolder chip shows just its own notes',
      'A + chip next to the subfolders makes a new one in the pinned folder you’re in (and New Subfolder on a folder’s right-click menu)',
      'Connected Services: each service gets one pinned folder (GitHub, Todoist, Linear, Jira, Google Tasks) with your connected folders as its subfolders. “All of GitHub” shows everything once, even an item that’s in two of them, and refresh and Clear Completed work on the whole service. Existing connected folders move in by themselves',
      'Move to: pinned folders and subfolders are in sections of their own, each subfolder showing which pinned folder it’s in, and you can make a new subfolder right from the menu',
      'Drop notes on a subfolder chip to move them there, and double-click a subfolder chip to rename it'
    ]
  },
  {
    version: '1.0.1',
    date: '2026-11-23',
    items: [
      'Sync with Google keeps up: your changes go out within a few seconds, even while you keep typing, and as you leave the app. Another device’s changes arrive within about 15 seconds while Notes is open, instead of every few minutes',
      'Pictures and other attachments added on one device now reach your other devices (they could be missed before)',
      'Importing from Apple Notes works again. It was reading Delta Notes itself, which is also called Notes once installed',
      'Importing from Notion works with its current exports, which put the pages in a second zip inside the download',
      'Better imports from Bear (dates and pins kept, notes in its trash left out), Standard Notes (tags kept, trashed notes left out), Obsidian (tags at the top of a note, and callouts), Evernote (the note’s own title), Notion HTML (checklists), Google Keep and Samsung Notes',
      'Phones: the toolbar stays on screen while the keyboard is open, and the note scrolls while you type',
      'Phones: a brush size slider under the canvas toolbar'
    ]
  },
  {
    version: '1.0.0',
    date: '2026-11-22',
    items: [
      'Delta Notes for Mac, Windows and Android (early version): folders as pinned tiles, Smart Folders, #tags, pinned notes and Recently Deleted',
      'Folder icons: built-in icons, 3,000+ brand and app logos, or any emoji, with search',
      'Title, Heading, Subheading, Body and Monostyled text; bulleted, dashed and numbered lists; checklists; block quotes; tables',
      'Bold, italic, underline, strikethrough, superscript and subscript; highlights; text colours; fonts, sizes, alignment and indentation',
      'Pictures, scanned documents, sketches, audio recordings, videos, PDFs, any file, and link previews',
      'Math Notes: type an expression and = for the answer, with variables',
      'Collapsible sections, Lines & Grids, links between notes (type >>), find & replace',
      'A title field on every note, and Generate title (Apple Intelligence on the Mac, or Claude with your own API key)',
      'Floating Quick Note above every app (⌃⌘N, Ctrl+Alt+N on Windows)',
      'Connected Services: Smart Folders filled from GitHub (issues and pull requests), Todoist, Linear, Jira and Google Tasks, with each task’s status and Clear Completed',
      'Locked notes with one password, and Touch ID on Macs',
      'List and Gallery views, sorting and date groups, search, the Attachments Browser',
      'Sync with Google (your own Drive app folder); notes changed on two devices at once keep both versions',
      'Import from Apple Notes, Samsung Notes, Notion, Evernote, Google Keep, Bear, Simplenote, Standard Notes, Obsidian/Markdown, Word, PDF, text and HTML',
      'Export to PDF, Markdown, HTML and plain text; print; full backups',
      'Canvas: Excalidraw in your notes (shapes, arrows, lines, drawing, text, pictures, frames, styles and layers), its tools in the toolbar; import .excalidraw files',
      'Image Wand: make a picture from a description or turn a canvas or sketch into one (Google Gemini, with your own API key)',
      'Fourteen themes in light and dark, including Nothing and Pixel looks with their own fonts and shapes',
      'Keyboard shortcuts you can change (⌘T new note, ⌘S sidebar, ⌘W close note), Ctrl on Windows',
      'Empty notes are deleted when you leave them',
      'On Android: Settings as a list of sections that open full screen, a New note tile for Quick Settings and the app icon’s shortcut, and the canvas opens (with the pencil) when you take out a Samsung S Pen',
      'Smooth animations throughout (turned off when the system asks for reduced motion)',
      'In-app updates and feedback'
    ]
  }
]
