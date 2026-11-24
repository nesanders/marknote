// SPDX-FileCopyrightText: 2026 Marknote fork contributors
// SPDX-License-Identifier: GPL-2.0-only OR GPL-3.0-only OR LicenseRef-KDE-Accepted-GPL
//
// Notebooks on Drive, as Marknote sees them: a folder per notebook, notes as
// Markdown files with YAML front matter, folder icons in ".directory" files.
// Same layout as the desktop app's Google Drive sync.
//
// Edits are conflict-safe: a note is only overwritten if Drive still has the
// version it was opened from; otherwise the edit is saved next to it as
// "Name (conflict yyyy-MM-dd HHmm).md", like the desktop sync engine does.
// Offline, saves and new notes wait in an outbox on this device.
//
// Encrypted notebooks (docs/encryption.md): Drive, this device's cache and the
// outbox only ever hold the encrypted files. Notes are decrypted in memory
// with the notebook key, which is kept only until the notebook is locked or
// the page is closed.

import { AuthError, OfflineError } from './drive.js';
import * as FM from './frontmatter.js';
import * as Vault from './vault.js';

/** The note is in an encrypted notebook that is locked. */
export class LockedError extends Error {
    constructor() {
        super('This notebook is locked.');
    }
}

export const NOTE_SUFFIX = '.md';
export const IMAGE_TYPES = { png: 'image/png', jpg: 'image/jpeg', jpeg: 'image/jpeg', gif: 'image/gif', webp: 'image/webp', svg: 'image/svg+xml', avif: 'image/avif', bmp: 'image/bmp' };

export function isImageName(name) {
    const dot = name.lastIndexOf('.');
    return dot > 0 && Object.hasOwn(IMAGE_TYPES, name.slice(dot + 1).toLowerCase());
}

/** Join and normalize "a/b" + "../c" style paths (no leading slash). */
export function joinPath(base, relative) {
    const parts = base ? base.split('/') : [];
    for (const part of relative.split('/')) {
        if (part === '..') parts.pop();
        else if (part && part !== '.') parts.push(part);
    }
    return parts.join('/');
}

/**
 * Where an image link in a note points inside the notebook, as a path relative
 * to the notebook root, or { external } for web URLs. Desktop Marknote writes
 * absolute "file:///home/…/Notes/<Notebook>/…" links; those are mapped by the
 * notebook folder name, else by file name.
 */
export function resolveAssetPath(src, notePath, notebookName, filesByPath) {
    let s = (src ?? '').trim();
    if (/^(https?:|data:image\/)/i.test(s)) return { external: s };
    try {
        s = decodeURI(s);
    } catch {
        // keep as written
    }
    const noteDir = notePath.split('/').slice(0, -1).join('/');
    if (/^file:/i.test(s) || s.startsWith('/') || /^[a-z]:[\\/]/i.test(s)) {
        const abs = s.replace(/^file:\/\/(localhost)?/i, '').replaceAll('\\', '/');
        const marker = `/${notebookName}/`;
        const at = abs.lastIndexOf(marker);
        if (at >= 0) {
            const rel = abs.slice(at + marker.length);
            if (filesByPath.has(rel)) return { path: rel };
        }
        const base = abs.split('/').pop();
        const sameName = [...filesByPath.keys()].filter((p) => p.split('/').pop() === base);
        if (sameName.length === 1) return { path: sameName[0] };
        const nextToNote = joinPath(noteDir, base);
        return filesByPath.has(nextToNote) ? { path: nextToNote } : { missing: base };
    }
    const rel = joinPath(noteDir, s.split('#')[0].split('?')[0]);
    return filesByPath.has(rel) ? { path: rel } : { missing: s };
}
const NOTEBOOKS_KEY = '__notebooks__';
const ORDER_KEY = 'X-Marknote-Order';

/** Manual order (View › Sort › Manual): listed names first, the rest by title. */
export function sortManual(items, order) {
    const pos = new Map((order ?? []).map((name, i) => [name, i]));
    return [...items].sort((a, b) => {
        const pa = pos.get(a.name) ?? Infinity;
        const pb = pos.get(b.name) ?? Infinity;
        if (pa !== pb) return pa - pb;
        return a.title.toLowerCase() < b.title.toLowerCase() ? -1 : a.title.toLowerCase() > b.title.toLowerCase() ? 1 : 0;
    });
}

export function noteName(fileName) {
    return fileName.endsWith(NOTE_SUFFIX) ? fileName.slice(0, -NOTE_SUFFIX.length) : fileName;
}

export function isNetworkError(e) {
    return e instanceof OfflineError;
}

/** Errors after which cached data is still shown and edits wait in the outbox. */
export function isRetryable(e) {
    return e instanceof OfflineError || e instanceof AuthError;
}

/** [Desktop Entry] values of a .directory file. */
export function parseDirectory(text) {
    const out = {};
    let inEntry = false;
    for (const line of (text ?? '').split(/\r?\n/)) {
        const t = line.trim();
        if (t.startsWith('[')) {
            inEntry = t === '[Desktop Entry]';
            continue;
        }
        const eq = t.indexOf('=');
        if (inEntry && eq > 0) out[t.slice(0, eq).trim()] = t.slice(eq + 1).trim();
    }
    return out;
}

/*
 * KDE config lists, as KConfig writes them: items joined by "," with "\\" and
 * "," escaped, then the whole value escaped again ("\\", "\s", "\n", "\t").
 */
export function parseConfigList(value) {
    // Undo the value escaping.
    let text = '';
    const raw = value ?? '';
    for (let i = 0; i < raw.length; ++i) {
        if (raw[i] === '\\' && i + 1 < raw.length) {
            const c = raw[++i];
            text += { s: ' ', n: '\n', t: '\t', r: '\r', '\\': '\\' }[c] ?? '\\' + c;
        } else {
            text += raw[i];
        }
    }
    // Split the list.
    const items = [];
    let cur = '';
    for (let i = 0; i < text.length; ++i) {
        if (text[i] === '\\' && i + 1 < text.length) {
            cur += text[++i];
        } else if (text[i] === ',') {
            items.push(cur);
            cur = '';
        } else {
            cur += text[i];
        }
    }
    if (cur.length || items.length) items.push(cur);
    return items;
}

export function formatConfigList(items) {
    const joined = items.map((s) => s.replaceAll('\\', '\\\\').replaceAll(',', '\\,')).join(',');
    let out = joined.replaceAll('\\', '\\\\').replaceAll('\n', '\\n').replaceAll('\t', '\\t').replaceAll('\r', '\\r');
    if (out.startsWith(' ')) out = '\\s' + out.slice(1);
    if (out.endsWith(' ')) out = out.slice(0, -1) + '\\s';
    return out;
}

/** Set (or delete, for null) keys in [Desktop Entry], keeping everything else. */
export function editDirectory(text, changes) {
    const lines = (text ?? '').split('\n');
    if (lines.length && lines[lines.length - 1] === '') lines.pop();
    let start = lines.findIndex((l) => l.trim() === '[Desktop Entry]');
    if (start < 0) {
        lines.unshift('[Desktop Entry]');
        start = 0;
    }
    let end = lines.findIndex((l, i) => i > start && l.trim().startsWith('['));
    if (end < 0) end = lines.length;
    for (const [key, value] of Object.entries(changes)) {
        const idx = lines.findIndex((l, i) => i > start && i < end && l.split('=')[0].trim() === key);
        if (idx >= 0) {
            if (value === null || value === '') {
                lines.splice(idx, 1);
                --end;
            } else {
                lines[idx] = `${key}=${value}`;
            }
        } else if (value !== null && value !== '') {
            let at = end;
            while (at - 1 > start && !lines[at - 1].trim()) --at; // before blank lines
            lines.splice(at, 0, `${key}=${value}`);
            ++end;
        }
    }
    return lines.join('\n') + '\n';
}

export function folderIconOf(dir) {
    return dir['X-Marknote-Emoji'] || dir['Icon'] || '';
}

export function conflictName(fileName, siblings, now = new Date()) {
    const p = (n) => String(n).padStart(2, '0');
    const stamp = `${now.getFullYear()}-${p(now.getMonth() + 1)}-${p(now.getDate())} ${p(now.getHours())}${p(now.getMinutes())}`;
    const dot = fileName.lastIndexOf('.');
    const base = dot > 0 ? fileName.slice(0, dot) : fileName;
    const ext = dot > 0 ? fileName.slice(dot) : '';
    let candidate = `${base} (conflict ${stamp})${ext}`;
    for (let n = 2; siblings.has(candidate); ++n) candidate = `${base} (conflict ${stamp} ${n})${ext}`;
    return candidate;
}

/** A file name for a note title: no slashes, unique among siblings. */
export function uniqueName(title, siblings, suffix = NOTE_SUFFIX) {
    const clean = title.replaceAll('/', '-').replace(/^\.+/, '').trim() || 'Untitled';
    let candidate = clean + suffix;
    for (let n = 2; siblings.has(candidate); ++n) candidate = `${clean} ${n}${suffix}`;
    return candidate;
}

export class Library extends EventTarget {
    constructor({ drive, store, rootPath = 'Marknote', extraNotebooks = [] }) {
        super();
        this.drive = drive;
        this.store = store;
        this.rootPath = rootPath;
        this.extraNotebooks = extraNotebooks;
        this.notebooks = [];
        this.notebook = null;
        this.items = new Map();
        this.files = new Map(); // relative path -> image file in this notebook
        this.blobUrls = new Map(); // file id -> object URL
        this.texts = new Map(); // id -> note text (this notebook), decrypted
        this.raws = new Map(); // id -> the file as stored (encrypted or not)
        this.vault = null; // { id, md5, data } when this notebook is encrypted
        this.keys = new Map(); // notebook id -> notebook key, in memory only
        this.lastUse = 0;
        this.saveChains = new Map(); // id -> promise of the running upload
        this.saveSeq = new Map(); // id -> number of the newest save
        this.online = true;
        this.busy = 0;
        this.pending = 0;
        this.lastError = '';
    }

    emit(type, detail) {
        this.dispatchEvent(new CustomEvent(type, { detail }));
    }

    // ---- Encryption ----------------------------------------------------------

    get encrypted() {
        return !!this.vault;
    }

    get locked() {
        return !!this.vault && !this.keys.has(this.notebook?.id);
    }

    key() {
        this.lastUse = Date.now();
        return this.notebook ? this.keys.get(this.notebook.id) : undefined;
    }

    /** Plain text of a stored file, or undefined while locked (or undecryptable). */
    async decode(raw) {
        if (!Vault.isEncryptedNote(raw)) return raw;
        const key = this.key();
        if (!key) return undefined;
        try {
            return await Vault.decryptNote(raw, key);
        } catch (e) {
            this.lastError = e.message;
            return undefined;
        }
    }

    /** What to store for a note's text: encrypted in an encrypted notebook. */
    async encode(text, id = null) {
        if (!this.vault) return text;
        const key = this.key();
        if (!key) throw new LockedError();
        return Vault.encryptNote(text, key, id ? Vault.envelopeTitle(this.raws.get(id)) : '');
    }

    async setRaw(id, raw) {
        this.raws.set(id, raw);
        const text = await this.decode(raw);
        if (text === undefined) this.texts.delete(id);
        else this.texts.set(id, text);
        return text;
    }

    isLockedNote(id) {
        return this.locked && Vault.isEncryptedNote(this.raws.get(id));
    }

    async unlock(secret, { recovery = false } = {}) {
        if (!this.vault) return true;
        const key = recovery ? await Vault.unlockWithRecoveryKey(this.vault.data, secret) : await Vault.unlockWithPassword(this.vault.data, secret);
        if (!key) return false;
        this.keys.set(this.notebook.id, key);
        this.lastUse = Date.now();
        for (const [id, raw] of this.raws) await this.setRaw(id, raw);
        for (const item of this.items.values()) if (!item.isFolder) this.applyMeta(item);
        this.emit('tree');
        this.emit('vault');
        return true;
    }

    /** Forget the keys of all notebooks (or one) and every decrypted text. */
    lock(notebookId = null) {
        const ids = notebookId ? [notebookId] : [...this.keys.keys()];
        if (!ids.length) return;
        // Open editors save now, while the key is still here (synchronous).
        this.emit('before-lock');
        // (Not zeroed: a save that started before locking may still use it.)
        for (const id of ids) this.keys.delete(id);
        if (this.notebook && ids.includes(this.notebook.id)) {
            for (const [id, raw] of this.raws) {
                if (Vault.isEncryptedNote(raw)) this.texts.delete(id);
            }
            for (const item of this.items.values()) {
                if (!item.isFolder && !this.texts.has(item.id)) {
                    item.icon = '';
                    item.tags = [];
                }
            }
        }
        this.emit('tree');
        this.emit('vault');
    }

    /** Lock after this many idle minutes (0: never). Call regularly. */
    autoLock(minutes) {
        if (minutes > 0 && this.keys.size && Date.now() - this.lastUse > minutes * 60000) this.lock();
    }

    /** Look up this notebook's vault file on Drive (two small requests). */
    async refreshVault() {
        const nb = this.notebook;
        const dot = (await this.drive.listChildren(nb.id)).find((f) => f.name === '.marknote' && f.mimeType.endsWith('.folder'));
        const file = dot ? (await this.drive.listChildren(dot.id)).find((f) => f.name === 'vault.json') : null;
        if (this.notebook === nb && file) await this.loadVault(file, true);
    }

    async loadVault(file, fetchMissing) {
        if (!file) {
            this.vault = null;
            return;
        }
        const md5 = file.md5Checksum ?? '';
        let text;
        const cached = await this.store.get('content', file.id);
        if (cached && (cached.md5 === md5 || !fetchMissing)) text = cached.text;
        else if (fetchMissing) {
            text = await this.drive.getText(file.id);
            await this.store.set('content', file.id, { md5, text });
        }
        if (text === undefined) return;
        try {
            this.vault = { id: file.id, md5, data: Vault.parseVault(text) };
        } catch (e) {
            this.lastError = e.message;
            this.vault = { id: file.id, md5, data: null };
        }
        if (this.notebook) this.notebook.encrypted = true;
    }

    setOnline(online) {
        if (this.online !== online) {
            this.online = online;
            this.emit('status');
        }
    }

    async guard(fn) {
        ++this.busy;
        this.emit('status');
        try {
            const r = await fn();
            this.setOnline(true);
            return r;
        } catch (e) {
            if (isNetworkError(e)) this.setOnline(false);
            if (e instanceof AuthError) this.emit('auth-required');
            throw e;
        } finally {
            --this.busy;
            this.emit('status');
        }
    }

    // ---- Notebooks -------------------------------------------------------

    async loadNotebooks() {
        const cached = await this.store.get('listings', NOTEBOOKS_KEY);
        if (cached) {
            this.notebooks = cached;
            this.emit('notebooks');
        }
        try {
            await this.guard(async () => {
                const found = [];
                const rootId = await this.drive.resolvePath(this.rootPath);
                if (rootId) {
                    const children = await this.drive.listChildren(rootId);
                    for (const f of children.filter((c) => c.mimeType.endsWith('.folder'))) {
                        found.push({ id: f.id, name: f.name, path: `${this.rootPath}/${f.name}`, dirFileId: null, dir: {} });
                    }
                }
                for (const path of this.extraNotebooks) {
                    const id = await this.drive.resolvePath(path);
                    if (id && !found.some((n) => n.id === id)) {
                        found.push({ id, name: path.split('/').filter(Boolean).pop(), path, dirFileId: null, dir: {} });
                    }
                }
                await Promise.all(found.map(async (nb) => {
                    const files = await this.drive.listChildren(nb.id);
                    const dirFile = files.find((f) => f.name === '.directory');
                    if (dirFile) {
                        nb.dirFileId = dirFile.id;
                        nb.dir = parseDirectory(await this.drive.getText(dirFile.id));
                    }
                }));
                found.sort((a, b) => a.name.localeCompare(b.name));
                this.notebooks = found;
                await this.store.set('listings', NOTEBOOKS_KEY, found);
                this.emit('notebooks');
            });
        } catch (e) {
            if (!cached || !isRetryable(e)) throw e;
        }
        return this.notebooks;
    }

    async createNotebook(name) {
        return this.guard(async () => {
            const rootId = await this.drive.resolvePath(this.rootPath, true);
            const existing = await this.drive.findFolder(rootId, name);
            if (existing) throw new Error(`A notebook called “${name}” already exists.`);
            await this.drive.createFolder(rootId, name.replaceAll('/', '-'));
            await this.loadNotebooks();
            return this.notebooks.find((n) => n.name === name.replaceAll('/', '-'));
        });
    }

    // ---- Notebook contents ------------------------------------------------

    /** Cached listing first (instant, offline), then Drive. */
    async openNotebook(nb) {
        this.notebook = nb;
        this.items = new Map();
        this.files = new Map();
        this.texts = new Map();
        this.raws = new Map();
        this.vault = null;
        const cached = await this.store.get('listings', nb.id);
        if (cached) {
            await this.applyListing(cached, false);
        }
        try {
            await this.refresh();
        } catch (e) {
            if (!cached || !isRetryable(e)) throw e;
        }
    }

    async refresh() {
        const nb = this.notebook;
        if (!nb) return;
        await this.flushOutbox();
        await this.guard(async () => {
            const listing = await this.drive.listTree(nb.id);
            if (this.notebook !== nb) return;
            await this.applyListing(listing, true);
            await this.store.set('listings', nb.id, listing);
        });
    }

    /** Build items from a listing; fetch note texts whose md5 changed. */
    async applyListing(listing, fetchMissing) {
        const nb = this.notebook;
        const items = new Map();
        const files = new Map();
        const dirFiles = new Map(); // folder id -> .directory file
        await this.loadVault(listing.find((f) => f.path === Vault.VAULT_PATH), fetchMissing);
        if (this.notebook !== nb) return;
        for (const f of listing) {
            if (f.path === Vault.VAULT_PATH) continue;
            if (f.name === '.directory') {
                dirFiles.set(f.parentId, f);
                continue;
            }
            if (!f.isFolder && isImageName(f.name)) {
                files.set(f.path, { id: f.id, name: f.name, path: f.path, md5: f.md5Checksum ?? '', mimeType: f.mimeType });
                continue;
            }
            if (!f.isFolder && !f.name.endsWith(NOTE_SUFFIX)) continue;
            items.set(f.id, {
                id: f.id,
                name: f.name,
                title: f.isFolder ? f.name : noteName(f.name),
                path: f.path,
                parentId: f.parentId === nb.id ? null : f.parentId,
                driveParentId: f.parentId,
                isFolder: f.isFolder,
                md5: f.md5Checksum ?? '',
                modified: f.modifiedTime ? new Date(f.modifiedTime) : null,
                created: f.createdTime ? new Date(f.createdTime) : null,
                icon: '',
                tags: [],
                dirFileId: null,
            });
        }
        // Keep notes created offline that are not uploaded yet.
        for (const { value: op } of await this.store.all('outbox')) {
            if (op.type === 'create' && op.notebookId === nb.id) items.set(op.id, this.itemFromCreateOp(op));
        }

        const notes = [...items.values()].filter((i) => !i.isFolder);
        const toFetch = [];
        for (const item of notes) {
            const cached = await this.store.get('content', item.id);
            if (cached && (cached.md5 === item.md5 || cached.dirty)) {
                await this.setRaw(item.id, cached.text);
                if (cached.dirty) item.pending = true;
            } else if (fetchMissing) {
                toFetch.push(item);
            } else if (cached) {
                await this.setRaw(item.id, cached.text); // stale but better than nothing offline
            }
        }
        const dirsToFetch = [];
        for (const [folderId, file] of dirFiles) {
            const target = folderId === nb.id ? null : items.get(folderId);
            if (!target && folderId !== nb.id) continue;
            const cached = await this.store.get('content', file.id);
            if (cached && cached.md5 === (file.md5Checksum ?? '')) {
                this.applyDirectory(target, file.id, cached.text);
            } else if (fetchMissing) {
                dirsToFetch.push({ target, file });
            } else if (cached) {
                this.applyDirectory(target, file.id, cached.text);
            }
        }
        this.items = items;
        this.files = files;
        for (const item of notes) this.applyMeta(item);
        this.emit('tree');

        if (toFetch.length || dirsToFetch.length) {
            const jobs = [
                ...toFetch.map((item) => async () => {
                    const text = await this.drive.getText(item.id);
                    await this.store.set('content', item.id, { md5: item.md5, text });
                    await this.setRaw(item.id, text);
                    this.applyMeta(item);
                }),
                ...dirsToFetch.map(({ target, file }) => async () => {
                    const text = await this.drive.getText(file.id);
                    await this.store.set('content', file.id, { md5: file.md5Checksum ?? '', text });
                    this.applyDirectory(target, file.id, text);
                }),
            ];
            for (let i = 0; i < jobs.length; i += 6) {
                await Promise.all(jobs.slice(i, i + 6).map((j) => j()));
                this.emit('tree');
            }
        }
    }

    applyDirectory(target, fileId, text) {
        const dir = parseDirectory(text);
        if (target) {
            target.icon = folderIconOf(dir);
            target.dirFileId = fileId;
            target.order = parseConfigList(dir[ORDER_KEY]);
        } else if (this.notebook) {
            this.notebook.dirFileId = fileId;
            this.notebook.dir = dir;
        }
    }

    applyMeta(item) {
        const text = this.texts.get(item.id);
        if (text === undefined) return;
        const meta = FM.parse(FM.split(text).raw);
        item.icon = meta.icon;
        item.tags = meta.tags;
        item.noteId = meta.id;
        if (meta.created) item.created = meta.created;
    }

    itemFromCreateOp(op) {
        return {
            id: op.id, name: op.name, title: noteName(op.name), path: op.name, parentId: op.parentId,
            driveParentId: op.parentId ?? this.notebook.id, isFolder: false, md5: '', modified: new Date(op.at),
            created: new Date(op.at), icon: '', tags: [], pending: true,
        };
    }

    children(parentId) {
        return [...this.items.values()].filter((i) => i.parentId === parentId);
    }

    siblingsNames(parentId) {
        return new Set(this.children(parentId).map((i) => i.name));
    }

    tagCounts() {
        const counts = new Map();
        for (const item of this.items.values()) {
            for (const t of item.tags) counts.set(t, (counts.get(t) ?? 0) + 1);
        }
        return [...counts.entries()].map(([name, count]) => ({ name, count })).sort((a, b) => a.name.localeCompare(b.name));
    }

    text(id) {
        return this.texts.get(id);
    }

    async readNote(id) {
        const item = this.items.get(id);
        if (!item) throw new Error('Note not found');
        if (this.texts.has(id)) return this.texts.get(id);
        if (this.isLockedNote(id)) throw new LockedError();
        return this.guard(async () => {
            const raw = await this.drive.getText(id);
            await this.store.set('content', id, { md5: item.md5, text: raw });
            const text = await this.setRaw(id, raw);
            if (text === undefined) throw this.locked ? new LockedError() : new Error(this.lastError || 'This note could not be decrypted.');
            this.applyMeta(item);
            return text;
        });
    }

    // ---- Images --------------------------------------------------------------

    /** Live path of a note (folders may have been renamed or moved since listing). */
    pathOf(id) {
        const parts = [];
        for (let i = this.items.get(id); i; i = i.parentId ? this.items.get(i.parentId) : null) parts.unshift(i.name);
        return parts.join('/');
    }

    resolveImage(noteId, src) {
        return resolveAssetPath(src, this.pathOf(noteId), this.notebook?.name ?? '', this.files);
    }

    /** An object URL for an image file, from this device's cache or Drive. */
    async imageUrl(file) {
        if (this.blobUrls.has(file.id)) return this.blobUrls.get(file.id);
        const key = `blob:${file.id}`;
        let blob = null;
        const cached = await this.store.get('content', key);
        if (cached && (cached.md5 === file.md5 || !this.online)) blob = cached.blob;
        if (!blob) {
            blob = await this.guard(() => this.drive.getBlob(file.id));
            const type = IMAGE_TYPES[file.name.split('.').pop().toLowerCase()];
            if (type && blob.type !== type) blob = new Blob([blob], { type });
            await this.store.set('content', key, { md5: file.md5, blob });
        }
        const url = URL.createObjectURL(blob);
        this.blobUrls.set(file.id, url);
        return url;
    }

    /**
     * Store an image next to a note as "<Note>_<timestamp>.<ext>" (the desktop
     * sketch naming) and return the relative link for the note.
     */
    async addImage(noteId, blob, fileName = '') {
        const note = this.items.get(noteId);
        if (note.id.startsWith('local-')) throw new Error('Wait until the note is uploaded before adding images.');
        const fromName = fileName.split('.').pop()?.toLowerCase();
        const fromType = Object.entries(IMAGE_TYPES).find(([, t]) => t === blob.type)?.[0];
        const ext = isImageName(fileName) ? fromName : fromType ?? 'png';
        const names = new Set([...this.files.values()].map((f) => f.path));
        const dir = this.pathOf(note.parentId ?? '') ;
        let name = `${note.title}_${Date.now()}.${ext}`.replaceAll('/', '-');
        while (names.has(dir ? `${dir}/${name}` : name)) name = `${note.title}_${Date.now() + 1}.${ext}`;
        const file = await this.guard(() => this.drive.createFile(note.driveParentId, name, blob, IMAGE_TYPES[ext] ?? blob.type));
        const path = note.parentId ? `${this.pathOf(note.parentId)}/${name}` : name;
        const entry = { id: file.id, name, path, md5: file.md5Checksum ?? '', mimeType: file.mimeType };
        this.files.set(path, entry);
        await this.store.set('content', `blob:${file.id}`, { md5: entry.md5, blob });
        this.emit('tree');
        return encodeURI(name);
    }

    // ---- Writing -----------------------------------------------------------

    /**
     * Save a note's full text. Returns { conflictCopy } when Drive had a newer
     * version: the edit then goes to a conflict copy and the note shows Drive's.
     */
    saveNote(id, text) {
        const item = this.items.get(id);
        if (!item) return Promise.reject(new Error('Note not found'));
        if (this.texts.get(id) === text) return Promise.resolve({});
        if (this.vault && !this.key()) return Promise.reject(new LockedError());
        // Encrypt with the key as it is now, so locking right after still saves.
        const encoded = this.encode(text, id);
        encoded.catch(() => {});
        this.texts.set(id, text);
        this.applyMeta(item);
        this.emit('tree');
        // One upload per note at a time, each based on the version the previous
        // one produced; a save superseded while waiting is skipped.
        const seq = (this.saveSeq.get(id) ?? 0) + 1;
        this.saveSeq.set(id, seq);
        const run = (this.saveChains.get(id) ?? Promise.resolve()).catch(() => {}).then(async () => {
            if (this.saveSeq.get(id) !== seq) return { superseded: true };
            const current = this.items.get(id) ?? item;
            const raw = await encoded;
            this.raws.set(id, raw);
            try {
                return await this.upload(current, raw, current.md5);
            } catch (e) {
                if (!isRetryable(e)) throw e;
                await this.queueSave(current, raw);
                // Back online already (the connection returned while this was
                // being queued): upload now rather than at the next refresh.
                if (typeof navigator !== 'undefined' && navigator.onLine && !(e instanceof AuthError)) {
                    setTimeout(() => this.flushOutbox().catch(() => {}), 1000);
                }
                return { queued: true };
            } finally {
                this.emit('tree');
            }
        });
        this.saveChains.set(id, run);
        return run;
    }

    async queueSave(item, text) {
        if (item.id.startsWith('local-')) {
            const op = await this.store.get('outbox', item.id);
            if (op) {
                op.text = text;
                await this.store.set('outbox', item.id, op);
            }
        } else {
            await this.store.set('outbox', `save:${item.id}`, { type: 'save', id: item.id, baseMd5: item.md5, text, at: Date.now() });
        }
        await this.store.set('content', item.id, { md5: item.md5, text, dirty: true });
        item.pending = true;
        await this.countPending();
    }

    /**
     * A plain note written before this device knew its notebook was encrypted
     * (e.g. queued offline): encrypt it now, or keep it back while locked.
     */
    async sealIfNeeded(item, text, notebookId = null) {
        const inThisNotebook = notebookId ? notebookId === this.notebook?.id : this.items.get(item.id) === item;
        if (!this.vault || !inThisNotebook || Vault.isEncryptedNote(text)) return text;
        const key = this.key();
        if (!key) throw new LockedError();
        return Vault.encryptNote(text, key, '');
    }

    /** Upload a note's stored form (raw: encrypted in an encrypted notebook). */
    async upload(item, text, baseMd5) {
        text = await this.sealIfNeeded(item, text);
        return this.guard(async () => {
            if (item.id.startsWith('local-')) throw new OfflineError('not uploaded yet');
            const remote = await this.drive.getMeta(item.id);
            if ((remote.md5Checksum ?? '') !== baseMd5) {
                const theirs = await this.drive.getText(item.id);
                const theirsPlain = theirs === text ? text : await this.decode(theirs);
                if (theirs === text || (theirsPlain !== undefined && theirsPlain === (await this.decode(text)))) {
                    item.md5 = remote.md5Checksum ?? '';
                    item.pending = false;
                    await this.store.set('content', item.id, { md5: item.md5, text });
                    return {};
                }
                {
                    // Changed elsewhere since we opened it: keep both.
                    const name = conflictName(item.name, this.siblingsNames(item.parentId));
                    const copy = await this.drive.createFile(item.driveParentId, name, text);
                    item.md5 = remote.md5Checksum ?? '';
                    await this.setRaw(item.id, theirs);
                    this.applyMeta(item);
                    await this.store.set('content', item.id, { md5: item.md5, text: theirs });
                    const copyItem = this.addItem(copy, item.parentId, text, await this.decode(text));
                    return { conflictCopy: copyItem };
                }
            }
            const saved = await this.drive.updateFile(item.id, text);
            item.md5 = saved.md5Checksum ?? '';
            item.modified = saved.modifiedTime ? new Date(saved.modifiedTime) : new Date();
            item.pending = false;
            await this.store.set('content', item.id, { md5: item.md5, text });
            return {};
        });
    }

    /** text: the stored form; plain: its decrypted text (defaults to text). */
    addItem(file, parentId, text, plain = text) {
        const item = {
            id: file.id, name: file.name, title: file.mimeType?.endsWith('.folder') ? file.name : noteName(file.name),
            path: file.name, parentId, driveParentId: parentId ?? this.notebook.id,
            isFolder: file.mimeType?.endsWith('.folder') ?? false, md5: file.md5Checksum ?? '',
            modified: file.modifiedTime ? new Date(file.modifiedTime) : new Date(),
            created: file.createdTime ? new Date(file.createdTime) : new Date(), icon: '', tags: [],
        };
        this.items.set(item.id, item);
        if (text !== undefined) {
            this.raws.set(item.id, text);
            if (plain !== undefined) this.texts.set(item.id, plain);
            this.store.set('content', item.id, { md5: item.md5, text });
            this.applyMeta(item);
        }
        this.emit('tree');
        return item;
    }

    async createNote(parentId, title) {
        const name = uniqueName(title, this.siblingsNames(parentId));
        const text = FM.join(FM.initialRaw(new Date()), `# ${noteName(name)}\n`);
        const raw = await this.encode(text);
        try {
            const file = await this.guard(() => this.drive.createFile(parentId ?? this.notebook.id, name, raw));
            return this.addItem(file, parentId, raw, text);
        } catch (e) {
            if (!isRetryable(e)) throw e;
            const op = { type: 'create', id: `local-${FM.newId()}`, notebookId: this.notebook.id, parentId, name, text: raw, at: Date.now() };
            await this.store.set('outbox', op.id, op);
            const item = this.itemFromCreateOp(op);
            this.items.set(item.id, item);
            this.raws.set(item.id, raw);
            this.texts.set(item.id, text);
            this.applyMeta(item);
            await this.countPending();
            this.emit('tree');
            return item;
        }
    }

    async createFolder(parentId, title) {
        const name = uniqueName(title, this.siblingsNames(parentId), '');
        const file = await this.guard(() => this.drive.createFolder(parentId ?? this.notebook.id, name));
        return this.addItem(file, parentId);
    }

    async rename(id, title) {
        const item = this.items.get(id);
        const names = this.siblingsNames(item.parentId);
        names.delete(item.name);
        const name = uniqueName(title, names, item.isFolder ? '' : NOTE_SUFFIX);
        if (name === item.name) return item;
        await this.guard(() => this.drive.rename(id, name));
        const order = this.orderOf(item.parentId);
        if (order.includes(item.name)) {
            const next = order.map((n) => (n === item.name ? name : n));
            item.name = name;
            await this.editFolderDirectory(item.parentId, { [ORDER_KEY]: formatConfigList(next) }).catch(() => {});
        }
        item.name = name;
        item.title = item.isFolder ? name : noteName(name);
        this.emit('tree');
        return item;
    }

    isInside(id, folderId) {
        for (let p = folderId; p; p = this.items.get(p)?.parentId) {
            if (p === id) return true;
        }
        return false;
    }

    async move(id, toParentId) {
        const item = this.items.get(id);
        if (item.parentId === toParentId) return item;
        if (item.isFolder && this.isInside(id, toParentId)) throw new Error('A folder cannot be moved into itself.');
        const names = this.siblingsNames(toParentId);
        if (names.has(item.name)) throw new Error(`“${item.title}” already exists there.`);
        const to = toParentId ?? this.notebook.id;
        await this.guard(() => this.drive.move(id, item.driveParentId, to));
        item.parentId = toParentId;
        item.driveParentId = to;
        this.emit('tree');
        return item;
    }

    async trash(id) {
        const item = this.items.get(id);
        if (id.startsWith('local-')) {
            await this.store.del('outbox', id);
        } else {
            await this.guard(() => this.drive.trash(id));
        }
        const remove = (i) => {
            for (const child of this.children(i)) remove(child.id);
            this.items.delete(i);
            this.texts.delete(i);
            this.raws.delete(i);
        };
        remove(item.id);
        await this.countPending();
        this.emit('tree');
    }

    async editFrontMatter(id, edit) {
        // Use the in-memory text when there is one, so the edit applies to the
        // latest version, not one read before an await.
        const text = this.texts.has(id) ? this.texts.get(id) : await this.readNote(id);
        const { raw, body } = FM.split(text);
        let newRaw = raw;
        if (!FM.value(newRaw, 'id')) newRaw = FM.setValue(newRaw, 'id', FM.newId());
        if (!FM.value(newRaw, 'created')) {
            const item = this.items.get(id);
            newRaw = FM.setValue(newRaw, 'created', item.created ?? new Date());
        }
        newRaw = edit(newRaw);
        return this.saveNote(id, FM.join(newRaw, body));
    }

    setTags(id, tags) {
        const clean = [...new Set(tags.map(FM.normalizeTag).filter(Boolean))];
        return this.editFrontMatter(id, (raw) => FM.setValue(raw, 'tags', clean));
    }

    setIcon(id, icon) {
        return this.editFrontMatter(id, (raw) => FM.setValue(raw, 'icon', icon));
    }

    /** The manual order of a folder (null: the notebook's top level). */
    orderOf(parentId) {
        if (!parentId) return parseConfigList(this.notebook?.dir?.[ORDER_KEY]);
        return this.items.get(parentId)?.order ?? [];
    }

    /** Write a folder's .directory with some keys changed. */
    async editFolderDirectory(folderId, changes) {
        const target = folderId ? this.items.get(folderId) : null;
        const fileId = target ? target.dirFileId : this.notebook.dirFileId;
        const driveFolder = folderId ?? this.notebook.id;
        await this.guard(async () => {
            const current = fileId ? await this.drive.getText(fileId) : '';
            const text = editDirectory(current, changes);
            const saved = fileId ? await this.drive.updateFile(fileId, text, 'text/plain') : await this.drive.createFile(driveFolder, '.directory', text, 'text/plain');
            await this.store.set('content', saved.id, { md5: saved.md5Checksum ?? '', text });
            this.applyDirectory(target, saved.id, text);
        });
    }

    /** Put an item just before or after another (moving it to that folder first if needed). */
    async placeInOrder(id, targetId, after) {
        const target = this.items.get(targetId);
        if (!target || id === targetId) return;
        let item = this.items.get(id);
        if (item.parentId !== target.parentId) item = await this.move(id, target.parentId);
        const parentId = target.parentId;
        const present = this.children(parentId);
        const order = sortManual(present, this.orderOf(parentId)).map((i) => i.name).filter((n) => n !== item.name);
        let at = order.indexOf(target.name);
        if (at < 0) at = order.length;
        else if (after) ++at;
        order.splice(at, 0, item.name);
        await this.editFolderDirectory(parentId, { [ORDER_KEY]: formatConfigList(order) });
        this.emit('tree');
    }

    async setFolderIcon(folderId, emoji) {
        const target = folderId ? this.items.get(folderId) : null;
        const fileId = target ? target.dirFileId : this.notebook.dirFileId;
        const driveFolder = folderId ?? this.notebook.id;
        await this.guard(async () => {
            const current = fileId ? await this.drive.getText(fileId) : '';
            const text = editDirectory(current, { 'X-Marknote-Emoji': emoji || null, ...(emoji ? { Icon: null } : {}) });
            const saved = fileId ? await this.drive.updateFile(fileId, text, 'text/plain') : await this.drive.createFile(driveFolder, '.directory', text, 'text/plain');
            await this.store.set('content', saved.id, { md5: saved.md5Checksum ?? '', text });
            this.applyDirectory(target, saved.id, text);
        });
        this.emit('tree');
    }

    // ---- Offline outbox ---------------------------------------------------

    async countPending() {
        this.pending = (await this.store.all('outbox')).length;
        this.emit('status');
    }

    /** Upload queued edits. Returns the conflict copies it had to make. */
    async flushOutbox() {
        const ops = (await this.store.all('outbox')).map((o) => o.value).sort((a, b) => a.at - b.at);
        const conflicts = [];
        // The notebook may have been encrypted elsewhere since these were queued:
        // learn that before anything is uploaded.
        if (ops.length && this.notebook) {
            try {
                await this.refreshVault();
            } catch (e) {
                if (!isRetryable(e)) throw e;
            }
        }
        for (const op of ops) {
            try {
                if (op.type === 'create') {
                    op.text = await this.sealIfNeeded(op, op.text, op.notebookId);
                    const file = await this.guard(() => this.drive.createFile(op.parentId ?? op.notebookId, op.name, op.text));
                    await this.store.del('outbox', op.id);
                    await this.store.del('content', op.id);
                    await this.store.set('content', file.id, { md5: file.md5Checksum ?? '', text: op.text });
                    if (this.notebook?.id === op.notebookId && this.items.has(op.id)) {
                        const plain = this.texts.get(op.id);
                        this.items.delete(op.id);
                        this.texts.delete(op.id);
                        this.raws.delete(op.id);
                        this.addItem(file, op.parentId, op.text, plain);
                        this.emit('replaced', { from: op.id, to: file.id });
                    }
                } else if (op.type === 'save') {
                    const item = this.items.get(op.id) ?? { id: op.id, name: '', parentId: null, driveParentId: null, md5: op.baseMd5 };
                    if (!item.driveParentId) {
                        const meta = await this.guard(() => this.drive.getMeta(op.id));
                        item.name = meta.name;
                        item.driveParentId = meta.parents?.[0];
                    }
                    const r = await this.upload(item, op.text, op.baseMd5);
                    if (r.conflictCopy) conflicts.push(r.conflictCopy);
                    await this.store.del('outbox', `save:${op.id}`);
                }
            } catch (e) {
                if (isNetworkError(e) || e instanceof AuthError) break;
                if (e instanceof LockedError) continue; // kept until the notebook is unlocked
                this.lastError = e.message;
                await this.store.del('outbox', op.type === 'create' ? op.id : `save:${op.id}`);
            }
        }
        await this.countPending();
        if (conflicts.length) this.emit('conflicts', conflicts);
        return conflicts;
    }

    // ---- Filtering ---------------------------------------------------------

    /**
     * Ids of items to show for a filter: matching notes and the folders on the
     * way to them. { text, tags, any, contents }; "tag:x" in text adds a tag.
     */
    filter({ text = '', tags = [], any = false, contents = false }) {
        const words = [];
        const wanted = [...tags];
        for (const w of text.trim().split(/\s+/).filter(Boolean)) {
            if (w.toLowerCase().startsWith('tag:') && w.length > 4) wanted.push(w.slice(4));
            else words.push(w.toLowerCase());
        }
        if (!words.length && !wanted.length) return null;
        const wantedLower = wanted.map((t) => t.toLowerCase());
        const visible = new Set();
        for (const item of this.items.values()) {
            if (item.isFolder) continue;
            const itemTags = item.tags.map((t) => t.toLowerCase());
            const tagOk = !wantedLower.length || (any ? wantedLower.some((t) => itemTags.includes(t)) : wantedLower.every((t) => itemTags.includes(t)));
            if (!tagOk) continue;
            let textOk = true;
            if (words.length) {
                const name = item.title.toLowerCase();
                const body = contents ? FM.split(this.texts.get(item.id) ?? '').body.toLowerCase() : '';
                textOk = words.every((w) => name.includes(w) || (contents && body.includes(w)));
            }
            if (!textOk) continue;
            for (let p = item.id; p; p = this.items.get(p)?.parentId) visible.add(p);
        }
        return visible;
    }
}
