# Delta Notes

A notes app for macOS, Windows and Android. Its name is **Delta Notes** (README, website, About,
update sheet, release titles); installed it's just **Notes** (productName, Android app_name,
window titles, menus), which is also why files are `Notes-<v>…` (the updater matches them). See README.md for
features and build commands.

## Architecture decisions

- The app is a plain React web build (`src/`, Vite → `desktop/web`) in an Electron shell
  (`desktop/`, plain CommonJS, served over `app://`). Not Expo/React Native like the user's other
  apps: a rich-text editor works far better in the DOM. Android wraps the same build in Capacitor
  (below); keep platform code behind `src/lib/storage.ts`.
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
  sidebar (`src/ui/Sidebar.tsx`): search, folders as pinned tiles with an icon (Lucide, emoji, or
  a brand logo from Simple Icons — `brand:<slug>` with its path kept in `folder.logo`, the set
  loaded only when searched, src/lib/brands.ts; the dialog has Icons / Brand Logos / Emoji tabs,
  emoji from emojibase-data via src/lib/emoji.ts, also loaded on first use)
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
- Floating Quick Note: main.cjs `createFloat` opens the page with #float (src/ui/FloatingNote.tsx).
  Each window keeps its own store and sends the other its changes (src/lib/windows.ts, relayed by
  main); only the main window saves, and the float starts from its snapshot. Menu keys pressed in
  the float go to it only for FLOAT_COMMANDS. Test hook: steps "float!<js>", "focus:main|float",
  and shot names starting "float" capture that window.
- Shortcuts: main.cjs owns them (every menu item made with `cmd`/`item`, plus `extra`). The menu only
  shows the keys; `onKey` (before-input-event) runs them on both platforms, before the page. Changed
  keys live in `settings.shortcuts` (per device, not synced) and go to main through `applyShortcuts`
  (src/lib/shortcuts.ts). Show keys with `keysLabel`/`useKeys`/`withKeys`, never hardcoded ⌘. On the
  desktop the editor's own format keys are off (setup.ts MENU_KEYS) so a moved shortcut really moves.
- Titles: desktop/native/titles.swift (Apple's on-device model) is built by scripts/native.mjs into
  desktop/bin/notes-titles and shipped as an extraResource on the Mac.
- Android (started 2026-11-22): Capacitor 8 around the same web build (`capacitor.config.ts`,
  webDir desktop/web; `android/` is committed). `npm run android` → signed dist/Notes-<v>.apk
  (scripts/android.mjs; Java 21 from Homebrew openjdk@21; key in credentials/, passwords as
  NOTES_RELEASE_* in ~/.gradle/gradle.properties like the user's other apps; versionCode from
  package.json). Data: notes.json via @capacitor/filesystem (storage.ts, `isAndroid`), attachments
  in IndexedDB. Phones (≤700px, src/lib/phone.ts) show one screen at a time: the sidebar, then the
  note (`ui.phoneNote`, back button / `backToList`); tablets keep the desktop layout. Native bits:
  NotesNativePlugin.java: edge to edge on every WebView (Capacitor's SystemBars insets handling is
  off in capacitor.config.ts; the plugin sends the bars' sizes as --safe-area-inset-*, zeroes the
  bars for the WebView without consuming insets so the keyboard still works, and pads for the
  keyboard), bar icon colour, sign-in, updater (src/lib/android.ts).
  Icons from assets/src/icon.svg by `npm run icons` (adaptive icon too). Google sign-in: Google's
  Android authorization API (`googleAuthorize`, play-services-auth) gives drive.appdata access
  tokens; it needs Android OAuth clients (package app.notes.android + the release and debug key
  SHA-1s; "Notes Android (release)" and "(debug)" exist in notes-515500 since 2026-11-22), no secret. Updater: src/lib/updater.ts checks GitHub for
  `Notes-<v>.apk`, `downloadUpdate`/`installUpdate` in the plugin (SHA-256 checked, FileProvider,
  "Install unknown apps" the first time); same sheet as the desktop. Debug builds allow cleartext
  (app/src/debug) for testing it against a local server. Not done yet: Generate title beyond basic. Screenshots: a debug APK lets Chrome DevTools in
  (`adb forward tcp:9333 localabstract:webview_devtools_remote_<pid>`), then `window.__notes`.
- Phone Settings (Settings.tsx PhoneSettings): `settings: 'home'` is the list of sections (the
  desktop maps it to General); sections slide in full screen; `closeSettings()` animates out,
  `settingsBack()` is Android's back. Motion curves are --ease-* in app.css (Motion section);
  respect prefers-reduced-motion.
- Android "New note": QuickNoteTileService (Quick Settings tile) and res/xml/shortcuts.xml (icon
  long-press) open MainActivity with NEW_NOTE; NotesNativePlugin sends a retained "newNote" event
  (works from a cold start), App.tsx runs newQuickNote().
- README screenshots live in docs/screenshots (desktop from the NOTES_SHOTS hook with
  `--force-device-scale-factor=2`; Android from `adb exec-out screencap`), made from sample notes,
  never the user's.
- Connected Services (2026-11-22): Smart Folders with `folder.feed` filled by src/lib/feeds.ts from
  src/lib/services/*.ts (GitHub issues + PRs, Todoist API v1, Linear GraphQL, Jira Cloud
  /rest/api/3/search/jql, Google Tasks; each a `Service` in services/types.ts). Sign-ins in
  `secrets` as `<id>-token` (JSON; per device, never synced); Google Tasks has its own Google
  sign-in (google.cjs `tasks`, Android `androidTasks`) apart from Sync's. Requests go through
  `serviceFetch` (desktop main `net:service` for those hosts only, Android CapacitorHttp) because
  of CORS. Each
  item is a read-only note with `note.external` (state open/done/dropped → TaskState icons) and id
  `ext-<folderId>-<itemId>` so devices agree. Refresh on start, every 10 min, on focus, on opening
  the folder. Clear Completed moves done/dropped to Recently Deleted and lists them in
  `feed.dismissed` (they return only if reopened). Test with `window.__fakeService` (made-up
  replies, see services/net.ts), never the user's tokens.
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
