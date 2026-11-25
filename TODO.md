# Marknote fork — TODO

Fork-only work. Nothing here is pushed to upstream KDE.

## Little fixes

Small polish items, to do in one go. (A Marknote to-do block: open this file in
the app to tick items off.)

<!-- marknote-todo -->
- [ ] Web: nested checklist items are too cramped. Sub-items sit too close
  together and too close to their parent compared with desktop (desktop: more
  indent and more vertical room per row). Match desktop's indent and row
  spacing for indented task items, in both the rendered view and the editor.

## Done

- [x] **UI overhaul** (`feature/ui-overhaul`) — standard menu bar (File, Edit,
      View, Insert, Note, Settings, Help; Ctrl+M), Dolphin-style folder tree with
      folder context menu / rename / new note or subfolder here / drag and drop
      (onto folders, onto notes, onto empty space), created date and tags in the
      tree, always-visible filter bar (name or `tag:name`, tag chips, All/Any),
      sidebar tag list, note/folder icons and emoji, tag editor, metadata strip
      above the editor, grouped slash menu with Markdown hints.
- [x] Filter bar "Contents" toggle (search inside notes), notebooks sidebar
      context menu (New Notebook…), View › Density (compact/normal/comfortable),
      README section with screenshots.
- [x] Note zoom (Ctrl+wheel, Ctrl +/-/0, View › Zoom); metadata strip is a
      separate band and note content is clipped below it.
      Design mockup: https://claude.ai/artifact/DJxD2S5s7TPaFCHZj5Lp7L

- [x] **Sync** (`feature/gdrive-sync`) — per-notebook sync engine (three-way
      compare against the last synced state, conflict copies, recoverable
      deletes, device-local `.directory` keys kept out), destinations Google Drive
      (`drive.file`, OAuth loopback + PKCE, token in KDE Wallet) and another
      local folder; sync dialog, File › Sync Notebook Now (Ctrl+Alt+S), open
      notes reload after sync. Tests run against a fake Drive and fake OAuth
      server.

- [x] **Web app / PWA** (`feature/pwa`, `web/`) — Drive notebooks on phones:
      tree, tags, filter (name, tag:, contents, all/any), icons, rendered notes
      with tappable checklists, CodeMirror Markdown editor with formatting bar,
      conflict copies, offline outbox, demo mode. OAuth client entered per device
      (never in the repo or site). Unit + Playwright tests; GitHub Pages workflow.

## Known gaps / follow-ups

- [ ] Slash menu: Image and Link-to-note entries (mockup) are not added yet.
- [ ] Edit menu items (Cut/Copy/Paste/Undo) show no shortcut hints: the editor
      already owns those keys and Qt Quick ignores ambiguous duplicates.
- [ ] Renaming a folder that contains the open note leaves the editor on the
      old path until the note is reopened (pre-existing upstream behaviour;
      moving such a folder by drag and drop is handled).
- [ ] In a narrow notes pane, tags beyond what fits are clipped (2 chips + "+n").

## Later

### Math blocks
- [ ] Render LaTeX math (`$…$` inline, `$$…$$` block). md4qt already parses math
      spans (`MD_FLAG_LATEXMATHSPANS`); nothing draws them yet.
- [ ] Pick a Qt-native renderer so no TeX install is needed (candidates:
      MicroTeX, JKQtMathText). Upstream's 2024 `work/mbruchert/latex` experiment
      targets the removed rich-text editor and is not reusable as-is.
- [ ] Add "Math" back to the slash menu once it renders.

### Storage: encryption
- [ ] Shared crypto format with libsodium (Argon2id key derivation +
      XChaCha20-Poly1305), documented so desktop and Android read the same files.
- [ ] Notebook encryption: random per-notebook key, wrapped by the password;
      changing the password re-wraps the key, not every note.
- [ ] Per-note encryption with its own password (also works inside an encrypted
      notebook).
- [ ] Encrypted notes keep a **display title in plaintext**. The UI must say so
      clearly when the user sets one (e.g. "This title is visible to anyone with
      access to the files; the note's content, tags and dates are encrypted").
- [ ] Encrypted files use random file names; tags/created date live inside the
      ciphertext, so tag filtering only covers unlocked notes.
- [ ] Recovery key: generated on encryption setup, shown once, with an explicit
      instruction to **store it in a password manager**.
- [ ] Optional remember-password via KWallet (desktop) / Android Keystore with
      biometrics, plus an auto-lock timeout.

### Storage: sync (next steps)
- [ ] Google Cloud Storage destination (bucket + prefix) on the same
      `RemoteBackend` interface; GCS md5 hashes fit the engine as-is.
- [ ] Automatic sync: on start, every N minutes, and shortly after a note is
      saved (currently manual only).
- [ ] Drive: list only changes since the last sync (`changes.list` page token)
      instead of the whole folder tree; resumable uploads for large files.
- [ ] Renames are synced as delete + add (the old file goes to the trash).
      Use the front matter `id` to detect moves.
- [ ] Encrypted notebooks upload only ciphertext (after encryption lands).
- [ ] Live-test against real Google Drive with a real OAuth client (so far only
      the fake servers; the flow follows Google's documented installed-app flow).

### Web app follow-ups
- [x] Images (Drive blobs, offline cache, camera/paste/drop upload), math (KaTeX),
      Mermaid, live-preview editor with `/` menu, tree drag and drop.
- [ ] Incremental Drive listing (changes API) for big notebooks.
- [ ] Encrypted notebooks once the crypto format exists (libsodium.js).
- [x] Desktop: relative image links (display, insert, sketches, moves, exports,
      *Make Image Links Relative*) — `feature/relative-links`.
- [ ] Desktop: render math (the web app uses the same `$…$` / `$$…$$` syntax).

### Android app (native; the PWA may be enough)
- [ ] Same codebase (Kirigami is convergent; upstream CI already builds Android).
      Phone layout: drill-down folder pages instead of the tree, filter bar on
      top, menu bar replaced by the global drawer.
- [ ] Shares sync + encryption code with desktop; reads notebooks synced to Drive
      or GCS.
- [ ] Google Sign-In on Android (JNI bridge); APK builds in GitHub Actions.

## Storage groundwork done in the UI overhaul

These are laid down now so encryption and sync can be added without migrating
notes later:

- Each note has YAML front matter (Obsidian-compatible):
  `id` (stable, survives renames/moves), `created`, `icon`, `tags`.
- Folder icon/emoji stored in the folder's `.directory` file (Dolphin-compatible).
