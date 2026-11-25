#  <img src="https://invent.kde.org/mbruchert/marknote/-/raw/master/logo.png">  Marknote

Write down your thoughts.

> [!NOTE]
> **This is a personal fork** of [KDE's Marknote](https://invent.kde.org/office/marknote)
> with a Dolphin-style interface overhaul. It is not affiliated with or submitted to KDE.
> The "[About this fork](#about-this-fork)" section describes fork-only changes; the rest of
> this README is upstream's.

## About this fork

Built on current KDE `master` (which includes the GSoC 2026 block editor), plus
[Mermaid diagram rendering (KDE MR !299)](https://invent.kde.org/office/marknote/-/merge_requests/299).

<img src="screenshots/fork/main-window.png" width="900" alt="Main window: menu bar, notebooks and tags sidebar, folder tree with icons, tags and created dates, editor with metadata strip">

### Changes in this fork

**Window and navigation**
- Standard in-window KDE **menu bar** (File, Edit, View, Insert, Note, Settings, Help),
  toggled with *Settings › Show Menubar* (<kbd>Ctrl</kbd>+<kbd>M</kbd>).
- Right-click on the **notebooks sidebar** for *New Notebook…*, import, and sidebar options.
- The sidebar lists the current notebook's **tags** with note counts; click one to filter.

**Folder tree (Dolphin-style)**
- Nested folders with a **folder context menu**: *New Note Here*, *New Subfolder*,
  *Rename* (also <kbd>F2</kbd>, in place), *Set Icon*, *Expand/Collapse*, *Delete*.
- **Drag and drop**: onto a folder to move a note in, onto a note to move next to it,
  onto empty space to move it to the top of the notebook.
- Each row shows the note's **icon or emoji**, its **tags** and its **created date**
  (visible by default; *View › Show Tags / Show Created Date*).
- *View › Density*: **Compact** (one line, tag dots and a short date), **Normal** (title, then
  date and tags on a tight second line) or **Comfortable** rows. Dates and tags show in all three.
- *View › Sort Notes › By Created Date*, or **Manual**: drag a note or folder onto the upper
  or lower half of another to put it above or below (a line shows where); the middle of a
  folder still moves it inside. The order is kept per folder in its `.directory` file, so
  it syncs and the web app shows the same. New notes go to the bottom; renamed ones keep
  their place.

**Filter bar**
- Always visible under the notes list (<kbd>Ctrl</kbd>+<kbd>E</kbd> to focus).
- Filters by name, `tag:name`, or — with **Contents** on — the text inside notes.
- Selected tags show as chips, with an **All tags / Any tag** switch.

**Notes**
- **Icon or emoji** for any note or folder (emoji search, theme icons, full KDE icon browser).
- **Tags** on any note, with an autocompleting tag editor (<kbd>Ctrl</kbd>+<kbd>Shift</kbd>+<kbd>T</kbd>).
- A separate strip above the editor shows the note's icon, created date and tags.
- **Zoom** notes with <kbd>Ctrl</kbd>+mouse wheel, <kbd>Ctrl</kbd>+<kbd>+</kbd>/<kbd>−</kbd>
  (reset with <kbd>Ctrl</kbd>+<kbd>0</kbd>) or *View › Zoom*; the level is remembered.
- **Slash menu** (type `/`) grouped into Text / Lists / Blocks, showing each block's
  Markdown shortcut; the *Insert* menu inserts the same blocks.
- **Autosave after every edit**, including the paragraph you are still typing in
  (upstream only saved after the first change, or when you left the block).
- **To-do blocks** (`/` › *To-do list*, or *Make To-Do Block* on a checklist): ticked items
  move to the top of a collapsible *Done* section with the date they were done; unticking
  puts them back at the bottom. Optional due dates with a picker (orange today, red when
  overdue), and each block is ordered by hand or by due date. Plain Markdown, the same on
  desktop and web: [docs/todo.md](docs/todo.md).

**Storage**
- **Image links are relative to the note**, so a notebook folder can be copied, synced or
  moved anywhere. Inserted images and sketches are linked relatively; images from outside
  the notebook are first copied next to the note (`<Note>_<timestamp>.png`). Moving a note
  or folder fixes its links and takes the note's own images along. Older notes with
  absolute `file://` links still show; right-click a notebook › *Make Image Links Relative*
  converts them. Exports resolve relative images too.
- Note metadata lives in Obsidian-compatible YAML front matter (`id`, `created`, `icon`,
  `tags`); the editor never shows it and keeps it intact on save. Plain notes get one the
  first time they are edited. Folder icons go in Dolphin's `.directory` file.

**Sync**
- Each notebook syncs on its own, to **Google Drive** or to **another folder** (for example
  one Nextcloud or Syncthing already syncs): right-click a notebook › *Sync Settings…*.
- Synced notebooks sync **in the background**: shortly after Marknote starts, every 5
  minutes, and when you come back to the window (*Settings › Sync in the Background* and
  *Check for Changes Every…*). *Sync Now* (<kbd>Ctrl</kbd>+<kbd>Alt</kbd>+<kbd>S</kbd>,
  *File* menu, or the cloud button) syncs at once.
- Changes go both ways. When a note was edited on two devices, both versions are kept
  (`Note (conflict 2026-11-24 0915).md`). Deleted notes are moved to a trash folder
  (`.marknote/trash`, or the Drive trash), never destroyed. An open note reloads when sync
  brings in a newer version.
- **You can see what sync changed.** Notes that arrived from another device get a dot
  (folders and notebooks show how many) until you open them, like unread mail. Opening
  one says where and when it changed. If both sides changed a note, the banner says both
  versions were kept and opens the other one. The cloud button next to *New Folder* shows
  the state ("Synced with Google Drive 3 min ago", or the error) and the recent changes,
  each one clickable. Background syncs stay quiet unless notes arrive.
- **Show in Google Drive** (note, folder and notebook menus, and *Note* menu) opens the item
  on drive.google.com, where Google's own Share dialog lets you share it with other Google
  accounts (view or edit). They can add a shortcut to it in their Drive from Google's
  sharing email. Shared notes are Markdown files: Drive previews them as plain text.
- Google Drive access uses the `drive.file` scope: Marknote can only see files it created.
  The sign-in is kept in KDE Wallet. No OAuth client is shipped; see below.

<table>
<tr>
<td><img src="screenshots/fork/tag-filter.png" width="440" alt="Filtering by two tags with Any tag"><br><sub>Tag filter, <i>Any tag</i> mode</sub></td>
<td><img src="screenshots/fork/content-search.png" width="440" alt="Filter with Contents searching inside notes"><br><sub>Searching inside notes (<i>Contents</i>)</sub></td>
</tr>
<tr>
<td><img src="screenshots/fork/folder-menu.png" width="440" alt="Folder context menu"><br><sub>Folder context menu</sub></td>
<td><img src="screenshots/fork/density.png" width="440" alt="Compact, normal and comfortable density side by side"><br><sub>Density: compact, normal, comfortable</sub></td>
</tr>
<tr>
<td><img src="screenshots/fork/icon-picker.png" width="300" alt="Emoji picker"> <img src="screenshots/fork/icon-picker-icons.png" width="300" alt="Icon picker"><br><sub>Icon or emoji for notes and folders</sub></td>
<td><img src="screenshots/fork/tag-editor.png" width="380" alt="Tag editor with autocomplete"><br><sub>Tag editor</sub></td>
</tr>
<tr>
<td><img src="screenshots/fork/slash-menu.png" width="440" alt="Grouped slash menu with Markdown hints"><br><sub>Slash menu</sub></td>
<td><img src="screenshots/fork/view-menu.png" width="320" alt="View menu"> <img src="screenshots/fork/sidebar-menu.png" width="320" alt="Notebooks sidebar context menu"><br><sub>View menu and notebooks sidebar menu</sub></td>
</tr>
<tr>
<td><img src="screenshots/fork/sync-dialog.png" width="400" alt="Notebook sync settings with Google Drive selected"><br><sub>Per-notebook sync settings</sub></td>
<td><img src="screenshots/fork/sync-received.png" width="440" alt="An open note updated by sync, with a notification"><br><sub>An open note updated by sync</sub></td>
</tr>
<tr>
<td><img src="screenshots/fork/sync-activity.png" width="440" alt="Sync button popup with recent changes, updated notes marked with dots"><br><sub>Sync state and recent changes; updated notes marked</sub></td>
<td><img src="screenshots/fork/sync-conflict-banner.png" width="440" alt="Banner on a note changed on two devices, with Open Other Version"><br><sub>A note changed on two devices</sub></td>
</tr>
<tr>
<td><img src="screenshots/fork/encrypt-recovery-key.png" width="400" alt="Recovery key shown once after encrypting a notebook"><br><sub>Encrypting a notebook: the recovery key</sub></td>
<td><img src="screenshots/fork/encrypted-locked-note.png" width="440" alt="A note in a locked notebook asks for the password"><br><sub>A note in a locked notebook</sub></td>
</tr>
</table>

**Web app for phones** (folder [`web/`](web/README.md))
- An installable web app (PWA) for Android and iPhone that opens the same notebooks from
  Google Drive: tree with drag and drop, tags, filter, icons, notes with math, Mermaid
  diagrams and images, a live-preview Markdown editor with a `/` menu, to-do blocks,
  block handles to drag (or tap to move) paragraphs, list items and other blocks, photo upload,
  an offline copy with edits uploaded later, conflict copies instead of overwrites, and
  encrypted notebooks (unlock, read, edit). Try it with `?demo` (its “Private” notebook is
  encrypted, password `demo password`); setup is in [web/README.md](web/README.md).

**Encrypted notebooks** (format: [docs/encryption.md](docs/encryption.md))
- Right-click a notebook › *Encrypt Notebook…*: every note's text, tags, icon and dates
  are encrypted with a password (Argon2id + XChaCha20-Poly1305, libsodium). Note titles
  (file names), folder names and images stay readable, and the app says so.
- You get a **recovery key** once. Store it in your password manager: without the
  password or that key, nobody can read the notes, not even you.
- Locked notebooks list their notes by title; opening one asks for the password.
  Lock now with <kbd>Ctrl</kbd>+<kbd>Shift</kbd>+<kbd>L</kbd>; auto-lock after 5–60 idle
  minutes (*Settings › Lock Encrypted Notebooks After*).
  Change the password or remove encryption from the notebook menu.
- Moving a note between an encrypted and a plain notebook encrypts or decrypts it.
- Encrypting a notebook that already syncs: the encrypted notes replace the readable ones
  on the next sync, and a checkbox (on by default) also deletes the readable copies left
  behind: earlier versions on Google Drive, this notebook's notes in the Drive trash, and
  deleted notes kept on this computer. The dialog says what stays readable if you keep them.
- Sync never uploads an unencrypted note into an encrypted notebook: one written by a
  device that did not know yet is encrypted first, or held back while the notebook is locked.
- Synced notebooks stay encrypted on Google Drive; the web app unlocks and edits them
  too (encrypting a notebook or changing its password is desktop-only for now).

### Setting up Google Drive sync

Google requires every app that signs in to have an OAuth client. This repository and
its CI builds contain none: you create your own (free, once) and enter it on each device.
It is stored only in that device's settings (`~/.config/marknoterc`), never in a notebook
folder.

1. In the [Google Cloud console](https://console.cloud.google.com/), create a project and
   enable the **Google Drive API** (*APIs & Services › Library*).
2. *APIs & Services › OAuth consent screen*: user type **External**, fill in the app name
   and your e-mail. Add the scope `https://www.googleapis.com/auth/drive.file` (the full URL; the console
   lists it as `…/auth/drive.file`). Then set the publishing status to
   **In production**: while it is in *Testing*, Google expires the sign-in after 7 days.
   (`drive.file` is a non-sensitive scope, so no Google review is needed; the consent page
   says the app is unverified until you verify it.)
3. *Credentials › Create credentials › OAuth client ID*, type **Desktop app**. Copy the
   client ID and secret.
4. Paste them into Marknote (*Sync Settings…* › *Google Drive* › *Use my own Google OAuth
   client*).

Then choose *Sign in with Google…*. The browser opens Google's consent page and returns
to Marknote on its own (it listens on `127.0.0.1` for the reply).

### Installing this fork

This fork installs as its own app, **`io.github.nesanders.marknote`** (shown as "Marknote"),
next to the official Marknote if you have that too. GitHub Actions publishes every build of
`master` to a signed Flatpak repository, so installs update like any other Flatpak:

```sh
flatpak install --user https://nsanders.me/marknote/flatpak/marknote.flatpakref
flatpak run io.github.nesanders.marknote
```

(The GitHub Pages site of this repository is served at `nsanders.me`; the build writes
whatever address Pages really uses into the repository files.) If you added the
repository before it used that address, point it there once:
`flatpak remote-modify --user marknote --url=https://nsanders.me/marknote/flatpak/repo/`

Updates then come with `flatpak update` or Discover. (The KDE runtime comes from Flathub,
which the command sets up if needed. The repository's key is in the `.flatpakref` file.)

**Moving from a manually installed build** (app id `org.kde.marknote`): your notes stay where
they are (`~/Documents/Notes`). To keep your settings (Google OAuth client, account,
view options), copy them once before the first start of the new app, then remove the old one:

```sh
mkdir -p ~/.var/app/io.github.nesanders.marknote
cp -a ~/.var/app/org.kde.marknote/. ~/.var/app/io.github.nesanders.marknote/
flatpak uninstall --user org.kde.marknote
```

The Google sign-in is kept in KDE Wallet and works for the new app as well.

Single builds are also available as files: *Actions › Build Flatpak* › a run › **Artifacts** ›
`marknote-flatpak` (`flatpak install --user --reinstall marknote.flatpak`).

<details><summary>Setting up the repository (owner of this GitHub repository, once)</summary>

The repository is signed with a GPG key whose private half is stored only as a GitHub
Actions secret. Create a key without a passphrase, just for this, in **one** terminal:

```sh
export GNUPGHOME="$(mktemp -d)"
gpg --batch --passphrase '' --quick-gen-key "Marknote Flatpak builds" ed25519 sign never
gpg --armor --export-secret-keys > marknote-flatpak-key.asc
head -1 marknote-flatpak-key.asc   # must print: -----BEGIN PGP PRIVATE KEY BLOCK-----
```

Store it as the secret `FLATPAK_GPG_PRIVATE_KEY`, either with the GitHub CLI (no copy and
paste involved):

```sh
gh secret set FLATPAK_GPG_PRIVATE_KEY --repo nesanders/marknote < marknote-flatpak-key.asc
```

or in *Settings › Secrets and variables › Actions › New repository secret*, pasting the
**whole contents** of the file (from `-----BEGIN` to `-----END PGP PRIVATE KEY BLOCK-----`).
Then delete the file (`shred -u marknote-flatpak-key.asc`) and `rm -rf "$GNUPGHOME"`. Keep a
copy in your password manager if you like: a new key later means everyone has to add the
repository again. The next build of `master` publishes the repository at `/flatpak/` on the
GitHub Pages site; if the secret is not a usable key, that build says what it looks like.

</details>

Back up your notes folder first (default `~/Documents/Notes`): editing a note adds the
front matter described above.

Planned work (math rendering, encryption, Google Cloud Storage, Android) is tracked in [TODO.md](TODO.md).

---

Marknote supports a wide range of formatting options useful for taking everyday notes, like bold, italic, underlined and strike through fonts as well as headings, lists, check boxes, images and more.

<img src="screenshots/desktop.png"  height="350" > <img src="screenshots/mobile.png"  height="350" >

## Installation

<a href='https://flathub.org/apps/details/org.kde.marknote'><img width='190px' alt='Download on Flathub' src='https://flathub.org/assets/badges/flathub-badge-i-en.png'/></a>

<a href='https://snapcraft.io/marknote'><img width='190px' alt='Download on Snap Store' src='https://snapcraft.io/en/light/install.svg'/></a>


Nightly flatpak: [https://cdn.kde.org/flatpak/marknote-nightly/org.kde.marknote.flatpakref](https://cdn.kde.org/flatpak/marknote-nightly/org.kde.marknote.flatpakref)


## Contributing and AI
Contributors keep this project alive! We greatly appreciate any help. To make it possible for us to review your contributions properly, please respect the following guidelines:

### Merge Requests

Code contributions should be submitted through merge requests. Please clearly explain what your merge request does.

### Bug Reports

Bug reports can be submitted either on bugs.kde.org or through the work items of this repository.

### Feature Requests and Discussion

If you have great ideas, come talk to us! You can do so either through the work items or by joining our Matrix room: [#marknote:kde.org](https://matrix.to/#/#marknote:kde.org).

### AI

The use of "AI" for contributions is strongly discouraged. If you nevertheless choose to use "AI", please never submit code that you do not fully understand. If "AI" has been involved in your merge request or bug report, you must add the #AI-generated label.

Most "AI"-generated submissions we have received so far have been nonsensical or unnecessarily complicated. We therefore take extra precautions when reviewing "AI"-generated submissions.

## Build Instructions

### flatpak builder (with kde sdk)
```
flatpak-builder tmp --force-clean --ccache --install --user org.kde.marknote.json
```
### cmake
```
mkdir build
cd build
cmake ..
make
```
### kdesrc-build
```
kdesrc-build marknote
```

### Nix
#### Dev path:
```
nix develop
cmake -B build -G Ninja -DCMAKE_BUILD_TYPE=Debug
cmake --build build
./build/bin/marknote
```
#### Package path:
```
nix build .#marknote
./result/bin/Marknote
```

