# Notes

A notes app inspired by Apple Notes, for macOS and Windows; Android next. See README.md for
features and build commands.

## Architecture decisions

- The app is a plain React web build (`src/`, Vite → `desktop/web`) in an Electron shell
  (`desktop/`, plain CommonJS, served over `app://`). Not Expo/React Native like the user's other
  apps: a rich-text editor works far better in the DOM. Android will wrap the same build (e.g.
  Capacitor) with its own storage bridge; keep platform code behind `src/lib/storage.ts`.
- Editor: TipTap 3 (`src/editor/`). `setup.ts` lists the extensions; `extensions.ts` has Notes'
  own (collapsible headings via a `collapsed` heading attr + decorations, dashed lists, indent,
  checklist sorting, #tag decorations, Math Notes, find & replace). Everything that isn't text is
  one `attachment` node (`attachment.tsx`, kinds image/scan/sketch/audio/video/pdf/file/link).
- Data: one JSON document (`src/lib/store.ts`, zustand): folders, notes (HTML + derived title,
  text, tags, attachments — `src/lib/content.ts`), settings. Desktop saves it to
  `userData/notes.json` (+ `.bak`). Attachments are files named by a hash of their content in
  `userData/attachments/`, served as `att://file/<id>` (main.cjs sniffs their type).
- Titles (user's request, 2026-11-21): a separate title field above the body (`note.name`; `note.title` = name or the body's first line). Older notes had their first Title heading lifted into it on load (`withName` in store.ts), imports too (`makeNote`). Generate title: `src/lib/titles.ts` (on-device) or Claude via `desktop/ai.cjs` (user's own key in safeStorage, `claude-opus-5-5`, effort low, `fallbacks: "default"`).
- Folders `notes` and `quick` (Quick Notes) always exist. Smart Folders are folders with `smart`
  filters (`src/lib/query.ts`). Recently Deleted = notes with `deletedAt` (purged after 30 days).
- Locked notes (`src/lib/lock.ts`): one password; PBKDF2 → AES-GCM; content sealed in
  `note.locked`, title stays readable. Reset Password keeps old locks openable (`lockHistory`).
  Touch ID keeps the password in safeStorage (main.cjs).
- Sync with Google (`src/lib/sync.ts`, `syncRunner.ts`, `drive.ts`): per-entry last-write-wins
  with tombstones over folders/notes/synced settings in `notes-sync.json` in the Drive app
  folder; attachments are `att-<id>` files there. A note changed on both sides since the last sync
  keeps the loser as a "(conflict copy)" (`meta.base`).
- Updater: GitHub Releases of Deli5150/notes; asset names must match `desktop/updater.cjs`
  (`Notes-<v>-mac.zip`, `Notes-Setup-<v>.exe`). The sheet is `src/ui/UpdateSheet.tsx` (same design
  as the user's other apps).
- Look (user's request, 2026-11-21: "don't make it look like Apple Notes"): Arc-browser style. One
  sidebar (`src/ui/Sidebar.tsx`): search, folders as pinned tiles with an icon (Lucide or emoji)
  and colour (`FolderIcon.tsx`; rename, reorder by drag, drop notes on them), a switcher
  dropdown (All Notes / Quick Notes / Unfiled / Smart Folders / Tags / Recently Deleted), then
  the note list. The note is a raised card on the theme-tinted canvas; its toolbar is inside the
  card. Inter is the UI font. Keep the window controls clear: macOS traffic lights (sidebar top
  left, 76px; toolbar left 80px when the sidebar is hidden), Windows caption buttons (40px strip
  above the card, `titleBarOverlay` height 40).
- Themes (`src/lib/themes.ts`): CSS variables on `<html>`, light + dark per theme. The sidebar is
  see-through (macOS vibrancy, Windows 11 Mica) when `translucent` is on. A theme with `style`
  (Nothing, Pixel) also sets `<html data-style>`, and app.css's "Theme looks" section changes its
  fonts and shapes (Doto + Space Mono, Google Sans Flex; all bundled from @fontsource).
- Commands: the native menu (main.cjs `buildMenu`) sends names to `src/ui/commands.ts`; in a
  plain browser App.tsx maps shortcuts to the same names.
- Importers (`src/import/`): each app's export format → HTML run through the editor's schema
  (`toNoteHtml`), pictures saved as attachments. Apple Notes is read with JXA via `osascript`.

## Before finishing a change

`npm run typecheck`, `npm test`, then `npx vite build` and screenshots: in desktop/,
`NOTES_SHOTS=<dir> NOTES_SHOT_STEPS='[["name","!js…","Click text","@Title","wait500"],…]'
./node_modules/.bin/electron . --user-data-dir=<scratch>` (`window.__notes` has the stores,
`run(command)`, the editor ref, importFiles and lock). `NOTES_SHOT_REAL=1` captures the real
window (shows the see-through sidebar).
