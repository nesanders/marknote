# Marknote fork — TODO

Fork-only work. Nothing here is pushed to upstream KDE.

## In progress

- [ ] **UI overhaul** (`feature/ui-overhaul`) — standard menu bar, Dolphin-style
      folder tree, always-visible filter bar, created dates, note/folder icons and
      emoji, tags with All/Any filtering, extended slash menu.
      Design mockup: https://claude.ai/artifact/DJxD2S5s7TPaFCHZj5Lp7L

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

### Storage: sync (do NOT build yet)
- [ ] Per-notebook sync destinations: Google Drive (`drive.file` scope) and
      Google Cloud Storage (bucket + prefix). Each destination syncs
      independently against the local copy.
- [ ] Sign in with Google (needs the user's own Google Cloud project for OAuth
      client IDs).
- [ ] Sync state database (last-synced hash + remote revision/generation),
      conflict copies, deletion tombstones. Encrypted notebooks upload only
      ciphertext.
- [ ] Keep sync in its own module.

### Android app
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
