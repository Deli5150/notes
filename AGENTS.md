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
- Themes (`src/lib/themes.ts`): CSS variables on `<html>`, light + dark per theme. The sidebar is
  see-through (macOS vibrancy, Windows 11 Mica) when `translucent` is on.
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
