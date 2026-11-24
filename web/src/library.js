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

import { AuthError, OfflineError } from './drive.js';
import * as FM from './frontmatter.js';

export const NOTE_SUFFIX = '.md';
const NOTEBOOKS_KEY = '__notebooks__';

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
        this.texts = new Map(); // id -> note text (this notebook)
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
        this.texts = new Map();
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
        const dirFiles = new Map(); // folder id -> .directory file
        for (const f of listing) {
            if (f.name === '.directory') {
                dirFiles.set(f.parentId, f);
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
                this.texts.set(item.id, cached.text);
                if (cached.dirty) item.pending = true;
            } else if (fetchMissing) {
                toFetch.push(item);
            } else if (cached) {
                this.texts.set(item.id, cached.text); // stale but better than nothing offline
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
        for (const item of notes) this.applyMeta(item);
        this.emit('tree');

        if (toFetch.length || dirsToFetch.length) {
            const jobs = [
                ...toFetch.map((item) => async () => {
                    const text = await this.drive.getText(item.id);
                    await this.store.set('content', item.id, { md5: item.md5, text });
                    this.texts.set(item.id, text);
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
        return this.guard(async () => {
            const text = await this.drive.getText(id);
            await this.store.set('content', id, { md5: item.md5, text });
            this.texts.set(id, text);
            this.applyMeta(item);
            return text;
        });
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
            const latest = this.texts.get(id);
            try {
                return await this.upload(current, latest, current.md5);
            } catch (e) {
                if (!isRetryable(e)) throw e;
                await this.queueSave(current, latest);
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

    async upload(item, text, baseMd5) {
        return this.guard(async () => {
            if (item.id.startsWith('local-')) throw new OfflineError('not uploaded yet');
            const remote = await this.drive.getMeta(item.id);
            if ((remote.md5Checksum ?? '') !== baseMd5) {
                const theirs = await this.drive.getText(item.id);
                if (theirs === text) {
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
                    this.texts.set(item.id, theirs);
                    this.applyMeta(item);
                    await this.store.set('content', item.id, { md5: item.md5, text: theirs });
                    const copyItem = this.addItem(copy, item.parentId, text);
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

    addItem(file, parentId, text) {
        const item = {
            id: file.id, name: file.name, title: file.mimeType?.endsWith('.folder') ? file.name : noteName(file.name),
            path: file.name, parentId, driveParentId: parentId ?? this.notebook.id,
            isFolder: file.mimeType?.endsWith('.folder') ?? false, md5: file.md5Checksum ?? '',
            modified: file.modifiedTime ? new Date(file.modifiedTime) : new Date(),
            created: file.createdTime ? new Date(file.createdTime) : new Date(), icon: '', tags: [],
        };
        this.items.set(item.id, item);
        if (text !== undefined) {
            this.texts.set(item.id, text);
            this.store.set('content', item.id, { md5: item.md5, text });
            this.applyMeta(item);
        }
        this.emit('tree');
        return item;
    }

    async createNote(parentId, title) {
        const name = uniqueName(title, this.siblingsNames(parentId));
        const text = FM.join(FM.initialRaw(new Date()), `# ${noteName(name)}\n`);
        try {
            const file = await this.guard(() => this.drive.createFile(parentId ?? this.notebook.id, name, text));
            return this.addItem(file, parentId, text);
        } catch (e) {
            if (!isRetryable(e)) throw e;
            const op = { type: 'create', id: `local-${FM.newId()}`, notebookId: this.notebook.id, parentId, name, text, at: Date.now() };
            await this.store.set('outbox', op.id, op);
            const item = this.itemFromCreateOp(op);
            this.items.set(item.id, item);
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
        for (const op of ops) {
            try {
                if (op.type === 'create') {
                    const file = await this.guard(() => this.drive.createFile(op.parentId ?? op.notebookId, op.name, op.text));
                    await this.store.del('outbox', op.id);
                    await this.store.del('content', op.id);
                    await this.store.set('content', file.id, { md5: file.md5Checksum ?? '', text: op.text });
                    if (this.notebook?.id === op.notebookId && this.items.has(op.id)) {
                        this.items.delete(op.id);
                        this.texts.delete(op.id);
                        this.addItem(file, op.parentId, op.text);
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
