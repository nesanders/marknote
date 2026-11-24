// SPDX-FileCopyrightText: 2026 Marknote fork contributors
// SPDX-License-Identifier: GPL-2.0-only OR GPL-3.0-only OR LicenseRef-KDE-Accepted-GPL
//
// In-memory stand-in for DriveApi: demo mode (?demo) and tests. Same methods,
// same file shapes, no network.

import { FOLDER } from './drive.js';

function hash(text) {
    // FNV-1a, two lanes: only identity matters here (Drive uses md5).
    let a = 0x811c9dc5;
    let b = 0x01000193;
    for (let i = 0; i < text.length; ++i) {
        const c = text.charCodeAt(i);
        a = Math.imul(a ^ c, 0x01000193) >>> 0;
        b = Math.imul(b ^ c, 0x5bd1e995) >>> 0;
    }
    return a.toString(16).padStart(8, '0') + b.toString(16).padStart(8, '0');
}

export class FakeDrive {
    constructor() {
        this.nodes = new Map([['root', { id: 'root', name: 'My Drive', mimeType: FOLDER, parents: [], trashed: false }]]);
        this.next = 1;
        this.calls = 0;
        this.latency = 0;
        this.ready = null; // a promise every call waits for (async demo seeding)
    }

    async tick() {
        ++this.calls;
        if (this.ready) await this.ready;
        if (this.latency) await new Promise((r) => setTimeout(r, this.latency));
    }

    view(node) {
        const { content, trashed, ...rest } = node;
        return { ...rest };
    }

    add(parentId, name, mimeType, content, created) {
        const id = 'f' + this.next++;
        const now = new Date().toISOString();
        const node = { id, name, mimeType, parents: [parentId], trashed: false, createdTime: created ?? now, modifiedTime: now };
        if (mimeType !== FOLDER) {
            node.content = content;
            node.md5Checksum = typeof content === 'string' ? hash(content) : hash(`${content.size}:${this.next}`);
        }
        this.nodes.set(id, node);
        return node;
    }

    live(id) {
        const node = this.nodes.get(id);
        if (!node || node.trashed) throw new Error('Google Drive: File not found');
        return node;
    }

    async about() {
        await this.tick();
        return { emailAddress: 'demo@example.com' };
    }

    async listChildren(folderId) {
        await this.tick();
        return [...this.nodes.values()].filter((n) => !n.trashed && n.parents.includes(folderId)).map((n) => this.view(n));
    }

    async findFolder(parentId, name) {
        await this.tick();
        const n = [...this.nodes.values()].find((x) => !x.trashed && x.parents.includes(parentId) && x.name === name && x.mimeType === FOLDER);
        return n ? this.view(n) : null;
    }

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

    async listTree(rootId) {
        const out = [];
        const walk = async (id, path) => {
            for (const file of await this.listChildren(id)) {
                const p = path ? `${path}/${file.name}` : file.name;
                const isFolder = file.mimeType === FOLDER;
                if (p === '.marknote') {
                    if (isFolder) await walk(file.id, p);
                    continue;
                }
                if (p.startsWith('.marknote/')) {
                    if (p === '.marknote/vault.json') out.push({ ...file, path: p, parentId: id, isFolder: false });
                    continue;
                }
                out.push({ ...file, path: p, parentId: id, isFolder });
                if (isFolder) await walk(file.id, p);
            }
        };
        await walk(rootId, '');
        return out;
    }

    async getText(fileId) {
        await this.tick();
        return this.live(fileId).content;
    }

    async getBlob(fileId) {
        await this.tick();
        const c = this.live(fileId).content;
        return typeof c === 'string' ? new Blob([c]) : c;
    }

    async getMeta(fileId) {
        await this.tick();
        return this.view(this.live(fileId));
    }

    async createFile(parentId, name, text, mimeType = 'text/markdown') {
        await this.tick();
        this.live(parentId);
        return this.view(this.add(parentId, name, mimeType, text));
    }

    async updateFile(fileId, text) {
        await this.tick();
        const node = this.live(fileId);
        node.content = text;
        node.md5Checksum = hash(text);
        node.modifiedTime = new Date().toISOString();
        return this.view(node);
    }

    async createFolder(parentId, name) {
        await this.tick();
        this.live(parentId);
        return this.view(this.add(parentId, name, FOLDER));
    }

    async rename(fileId, name) {
        await this.tick();
        const node = this.live(fileId);
        node.name = name;
        return this.view(node);
    }

    async move(fileId, fromParentId, toParentId) {
        await this.tick();
        const node = this.live(fileId);
        node.parents = node.parents.filter((p) => p !== fromParentId).concat(toParentId);
        return this.view(node);
    }

    async trash(fileId) {
        await this.tick();
        const node = this.live(fileId);
        node.trashed = true;
        // Children of a trashed folder are trashed with it.
        for (const n of this.nodes.values()) {
            if (n.parents.includes(fileId)) await this.trash(n.id);
        }
        return this.view(node);
    }

    /** Another device edits a file (tests). */
    externalEdit(fileId, text) {
        const node = this.live(fileId);
        node.content = text;
        node.md5Checksum = hash(text);
        node.modifiedTime = new Date().toISOString();
    }

    pathOf(id) {
        const parts = [];
        let node = this.nodes.get(id);
        while (node && node.id !== 'root') {
            parts.unshift(node.name);
            node = this.nodes.get(node.parents[0]);
        }
        return parts.join('/');
    }

    findByPath(path) {
        return [...this.nodes.values()].find((n) => !n.trashed && this.pathOf(n.id) === path) ?? null;
    }
}

/** Demo notebooks, like a desktop user's "Marknote" folder after a first sync. */
export function seedDemo(drive) {
    const daysAgo = (d) => new Date(Date.now() - d * 86400000);
    const iso = (d) => {
        const p = (n) => String(n).padStart(2, '0');
        return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}T${p(d.getHours())}:${p(d.getMinutes())}:00`;
    };
    const note = (parent, name, meta, body) => {
        const lines = [`id: 01DEMO${String(drive.next).padStart(20, '0')}`];
        if (meta.created) lines.push(`created: ${iso(meta.created)}`);
        if (meta.icon) lines.push(`icon: "${meta.icon}"`);
        if (meta.tags) lines.push(`tags: [${meta.tags.join(', ')}]`);
        drive.add(parent.id, name + '.md', 'text/markdown', `---\n${lines.join('\n')}\n---\n\n${body}`);
    };
    const dir = (folder, entries) => drive.add(folder.id, '.directory', 'text/plain', `[Desktop Entry]\n${entries}\n`);

    const root = drive.add('root', 'Marknote', FOLDER);
    const projects = drive.add(root.id, 'Projects', FOLDER);
    dir(projects, 'Icon=folder-blue\nX-MarkNote-Color=#2d7fb8');
    const personal = drive.add(root.id, 'Personal', FOLDER);
    dir(personal, 'Icon=user-home\nX-MarkNote-Color=#c2622a');
    const journal = drive.add(root.id, 'Journal', FOLDER);
    dir(journal, 'Icon=view-calendar\nX-MarkNote-Color=#3a8a55');

    const overhaul = drive.add(projects.id, 'Marknote overhaul', FOLDER);
    dir(overhaul, 'X-Marknote-Emoji=🛠️');
    const research = drive.add(overhaul.id, 'Research', FOLDER);
    const reading = drive.add(projects.id, 'Reading', FOLDER);
    dir(reading, 'X-Marknote-Emoji=📚');

    note(overhaul, 'Design notes', { created: daysAgo(3), icon: '🎨', tags: ['design', 'planning'] },
        '# Design notes\n\nThe tree should feel like **Dolphin**: folders first, then notes.\n\n## Open questions\n\n- [x] Menu bar or hamburger?\n- [ ] How dense should rows be?\n- [ ] Mobile layout\n\n> Keep the editor calm: metadata lives in its own strip.\n');
    note(overhaul, 'Feature list', { created: daysAgo(2), tags: ['planning'] },
        '# Feature list\n\nA desktop sketch (absolute file link, as Marknote desktop writes it):\n\n![](file:///home/me/Documents/Notes/Projects/Marknote%20overhaul/Feature%20list_1732400000000.svg)\n\n| Feature | Desktop | Web |\n|---|---|---|\n| Tags | ✅ | ✅ |\n| Icons | ✅ | ✅ |\n| Sync | ✅ | Drive |\n\n```js\nconst answer = 42;\n```\n');
    note(research, 'Dolphin tree behaviour', { created: daysAgo(6), icon: '🐬', tags: ['kde', 'reference'] },
        '# Dolphin tree behaviour\n\nExpand with the arrow, rename with F2, drag to move.\n');
    note(research, 'Notion slash menu', { created: daysAgo(5), tags: ['reference'] }, '# Notion slash menu\n\nType `/` to insert a block.\n');
    note(reading, 'KDE HIG excerpts', { created: daysAgo(40), tags: ['kde', 'reference'] }, '# KDE HIG excerpts\n\n*Simple by default, powerful when needed.*\n');
    note(reading, 'Qt Quick layouts', { created: daysAgo(50), tags: ['qt', 'learning'] }, '# Qt Quick layouts\n\nPrefer `Layout.fillWidth` over anchors inside layouts.\n');
    note(projects, 'Long checklist', { created: daysAgo(0.2), tags: ['todo'] },
        '# Long checklist\n\n- [ ] Buy milk\n- [x] Write sync engine\n- [ ] Try the web app on the phone\n- [ ] Create the OAuth client\n');
    drive.add(projects.id, 'Scratch.md', 'text/markdown', '# Scratch\n\nA plain note without front matter.\n');
    note(projects, 'Weekly sync', { created: daysAgo(7), icon: '🗓️', tags: ['meetings'] }, '# Weekly sync\n\n1. Status\n2. Blockers\n3. Next steps\n');
    const sketch = '<svg xmlns="http://www.w3.org/2000/svg" width="320" height="140" viewBox="0 0 320 140"><rect width="320" height="140" rx="10" fill="#e8f4fb"/><circle cx="70" cy="70" r="38" fill="#3daee9"/><rect x="130" y="40" width="150" height="16" rx="8" fill="#2d7fb8"/><rect x="130" y="70" width="110" height="12" rx="6" fill="#93cee9"/><rect x="130" y="92" width="130" height="12" rx="6" fill="#93cee9"/></svg>';
    drive.add(overhaul.id, 'Feature list_1732400000000.svg', 'image/svg+xml', sketch.replace('3daee9', 'f67400'));
    drive.add(projects.id, 'Rich note_1732400000000.svg', 'image/svg+xml', sketch);
    note(projects, 'Rich note', { created: daysAgo(1), icon: '✨', tags: ['demo'] },
        '# Rich note\n\nMath inline, like $e^{i\\pi} + 1 = 0$, and as a block:\n\n$$\n\\int_0^1 x^2\\,dx = \\frac{1}{3}\n$$\n\n'
        + '## Diagram\n\n```mermaid\ngraph LR\n    Desktop -->|sync| Drive\n    Drive --> Phone\n```\n\n'
        + '## Image\n\n![A sketch](Rich%20note_1732400000000.svg)\n\n'
        + '## Table\n\n| Feature | Desktop | Web |\n| --- | --- | --- |\n| Math | soon | ✅ |\n| Diagrams | ✅ | ✅ |\n\n'
        + '- [ ] Tick me\n- [x] Already done\n\n> Click any rendered block while editing to change its source.\n');
    note(personal, 'Recipes', { created: daysAgo(12), icon: '🍲', tags: ['home'] }, '# Recipes\n\n## Lentil soup\n\nOnion, carrots, lentils, stock. 30 minutes.\n');
    note(journal, iso(daysAgo(1)).slice(0, 10), { created: daysAgo(1), tags: ['journal'] }, '# Yesterday\n\nTried Marknote on the phone.\n');
    return drive;
}

export const DEMO_PASSWORD = 'demo password';

/**
 * An encrypted notebook "Private" (password DEMO_PASSWORD), made like the
 * desktop app makes one. Loads libsodium, so only demo mode and tests use it.
 */
export async function seedEncryptedDemo(drive) {
    const V = await import('./vault.js');
    const root = [...drive.nodes.values()].find((n) => n.name === 'Marknote' && n.parents.includes('root'));
    const nb = drive.add(root.id, 'Private', FOLDER);
    drive.add(nb.id, '.directory', 'text/plain', '[Desktop Entry]\nX-Marknote-Emoji=🔒\n');
    const { vault, key } = await V.createVault(DEMO_PASSWORD);
    const dot = drive.add(nb.id, '.marknote', FOLDER);
    drive.add(dot.id, 'vault.json', 'application/json', JSON.stringify(vault, null, 2));
    const notes = [
        ['Passwords hint', '---\nid: 01DEMOPRIVATE0000000000001\ntags: [private]\nicon: "🔑"\n---\n\n# Passwords hint\n\nThe bike lock is the year we met, backwards.\n'],
        ['Gift ideas', '---\nid: 01DEMOPRIVATE0000000000002\ntags: [private, family]\n---\n\n# Gift ideas\n\n- [ ] Book for Sam\n- [x] Concert tickets\n'],
    ];
    for (const [name, text] of notes) drive.add(nb.id, name + '.md', 'text/markdown', await V.encryptNote(text, key));
    return drive;
}
