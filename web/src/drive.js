// SPDX-FileCopyrightText: 2026 Marknote fork contributors
// SPDX-License-Identifier: GPL-2.0-only OR GPL-3.0-only OR LicenseRef-KDE-Accepted-GPL
//
// Google Drive API v3 over fetch. With the drive.file scope Marknote only sees
// files that Marknote created (desktop or web, same Google Cloud project).

export const FOLDER = 'application/vnd.google-apps.folder';
const FIELDS = 'id,name,mimeType,md5Checksum,modifiedTime,createdTime,parents,size';

export class AuthError extends Error {}
export class OfflineError extends Error {}

export class DriveApi {
    /** @param tokenProvider () => string|null, the current access token */
    constructor(tokenProvider, apiBase = 'https://www.googleapis.com') {
        this.token = tokenProvider;
        this.base = apiBase;
    }

    async request(method, path, { query, body, headers = {}, raw = false } = {}) {
        if (typeof navigator !== 'undefined' && navigator.onLine === false) throw new OfflineError('You are offline');
        const token = this.token();
        if (!token) throw new AuthError('Not signed in');
        const url = new URL(this.base + path);
        for (const [k, v] of Object.entries(query ?? {})) url.searchParams.set(k, v);
        let res;
        for (let attempt = 0; ; ++attempt) {
            try {
                res = await fetch(url, { method, body, headers: { Authorization: `Bearer ${token}`, ...headers } });
            } catch (e) {
                throw new OfflineError(navigator.onLine === false ? 'You are offline' : `Could not reach Google Drive (${e.message})`);
            }
            if ((res.status === 429 || res.status >= 500) && attempt < 2) {
                await new Promise((r) => setTimeout(r, 800 * (attempt + 1)));
                continue;
            }
            break;
        }
        if (res.status === 401) throw new AuthError('Google sign-in expired');
        if (!res.ok) {
            let message = `${res.status}`;
            try {
                message = (await res.json()).error?.message ?? message;
            } catch {
                // not JSON
            }
            throw new Error(`Google Drive: ${message}`);
        }
        if (raw) return res;
        return res.status === 204 ? null : res.json();
    }

    async about() {
        const r = await this.request('GET', '/drive/v3/about', { query: { fields: 'user(emailAddress,displayName)' } });
        return r.user ?? {};
    }

    static escape(value) {
        return value.replaceAll('\\', '\\\\').replaceAll("'", "\\'");
    }

    async listChildren(folderId) {
        const out = [];
        let pageToken = '';
        do {
            const query = {
                q: `'${DriveApi.escape(folderId)}' in parents and trashed = false`,
                fields: `nextPageToken,files(${FIELDS})`,
                pageSize: '1000',
                spaces: 'drive',
            };
            if (pageToken) query.pageToken = pageToken;
            const r = await this.request('GET', '/drive/v3/files', { query });
            out.push(...(r.files ?? []));
            pageToken = r.nextPageToken ?? '';
        } while (pageToken);
        return out;
    }

    async findFolder(parentId, name) {
        const r = await this.request('GET', '/drive/v3/files', {
            query: {
                q: `'${DriveApi.escape(parentId)}' in parents and name = '${DriveApi.escape(name)}' and mimeType = '${FOLDER}' and trashed = false`,
                fields: `files(${FIELDS})`,
                spaces: 'drive',
            },
        });
        return r.files?.[0] ?? null;
    }

    /** Folder id of a "A/B/C" path below My Drive; null if missing (or creates it). */
    async resolvePath(path, create = false) {
        let parent = 'root';
        for (const segment of path.split('/').filter(Boolean)) {
            let folder = await this.findFolder(parent, segment);
            if (!folder) {
                if (!create) return null;
                folder = await this.createFolder(parent, segment);
            }
            parent = folder.id;
        }
        return parent;
    }

    /** Every file and folder below a folder, with a relative "path". */
    async listTree(rootId) {
        const out = [];
        const queue = [{ id: rootId, path: '' }];
        while (queue.length) {
            const batch = queue.splice(0, 6);
            const results = await Promise.all(batch.map((f) => this.listChildren(f.id).then((files) => ({ f, files }))));
            for (const { f, files } of results) {
                for (const file of files) {
                    if (file.name.includes('/')) continue;
                    const isFolder = file.mimeType === FOLDER;
                    if (!isFolder && file.mimeType.startsWith('application/vnd.google-apps.')) continue;
                    const path = f.path ? `${f.path}/${file.name}` : file.name;
                    // App data stays out of the tree, except the encryption vault.
                    if (path === '.marknote') {
                        if (isFolder) queue.push({ id: file.id, path });
                        continue;
                    }
                    if (path.startsWith('.marknote/')) {
                        if (path === '.marknote/vault.json') out.push({ ...file, path, parentId: f.id, isFolder: false });
                        continue;
                    }
                    out.push({ ...file, path, parentId: f.id, isFolder });
                    if (isFolder) queue.push({ id: file.id, path });
                }
            }
        }
        return out;
    }

    async getText(fileId) {
        const res = await this.request('GET', `/drive/v3/files/${encodeURIComponent(fileId)}`, { query: { alt: 'media' }, raw: true });
        return res.text();
    }

    async getBlob(fileId) {
        const res = await this.request('GET', `/drive/v3/files/${encodeURIComponent(fileId)}`, { query: { alt: 'media' }, raw: true });
        return res.blob();
    }

    async getMeta(fileId) {
        return this.request('GET', `/drive/v3/files/${encodeURIComponent(fileId)}`, { query: { fields: FIELDS } });
    }

    /** @param text string or Blob (images) */
    async createFile(parentId, name, text, mimeType = 'text/markdown') {
        const boundary = 'marknote' + crypto.getRandomValues(new Uint32Array(2)).join('');
        const metadata = JSON.stringify({ name, parents: [parentId], mimeType });
        const body = new Blob([
            `--${boundary}\r\nContent-Type: application/json; charset=UTF-8\r\n\r\n${metadata}\r\n`,
            `--${boundary}\r\nContent-Type: ${mimeType}${typeof text === 'string' ? '; charset=UTF-8' : ''}\r\n\r\n`,
            text,
            `\r\n--${boundary}--\r\n`,
        ]);
        return this.request('POST', '/upload/drive/v3/files', {
            query: { uploadType: 'multipart', fields: FIELDS },
            body,
            headers: { 'Content-Type': `multipart/related; boundary=${boundary}` },
        });
    }

    async updateFile(fileId, text, mimeType = 'text/markdown') {
        return this.request('PATCH', `/upload/drive/v3/files/${encodeURIComponent(fileId)}`, {
            query: { uploadType: 'media', fields: FIELDS },
            body: new Blob([text]),
            headers: { 'Content-Type': `${mimeType}; charset=UTF-8` },
        });
    }

    async createFolder(parentId, name) {
        return this.request('POST', '/drive/v3/files', {
            query: { fields: FIELDS },
            body: JSON.stringify({ name, parents: [parentId], mimeType: FOLDER }),
            headers: { 'Content-Type': 'application/json' },
        });
    }

    async patchMeta(fileId, metadata, query = {}) {
        return this.request('PATCH', `/drive/v3/files/${encodeURIComponent(fileId)}`, {
            query: { fields: FIELDS, ...query },
            body: JSON.stringify(metadata),
            headers: { 'Content-Type': 'application/json' },
        });
    }

    rename(fileId, name) {
        return this.patchMeta(fileId, { name });
    }

    move(fileId, fromParentId, toParentId) {
        return this.patchMeta(fileId, {}, { addParents: toParentId, removeParents: fromParentId });
    }

    /** To the Drive trash, so it can be restored. */
    trash(fileId) {
        return this.patchMeta(fileId, { trashed: true });
    }
}
