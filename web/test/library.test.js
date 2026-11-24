import assert from 'node:assert/strict';
import test from 'node:test';
import { FakeDrive, seedDemo } from '../src/fakedrive.js';
import { OfflineError } from '../src/drive.js';
import { Library, conflictName, editDirectory, parseDirectory } from '../src/library.js';
import { MemoryStore } from '../src/store.js';
import * as FM from '../src/frontmatter.js';

async function setup() {
    const drive = seedDemo(new FakeDrive());
    const store = new MemoryStore();
    const lib = new Library({ drive, store });
    await lib.loadNotebooks();
    const projects = lib.notebooks.find((n) => n.name === 'Projects');
    await lib.openNotebook(projects);
    return { drive, store, lib };
}

const byTitle = (lib, title) => [...lib.items.values()].find((i) => i.title === title);

test('notebooks come from Marknote/, with .directory colors', async () => {
    const { lib } = await setup();
    assert.deepEqual(lib.notebooks.map((n) => n.name), ['Journal', 'Personal', 'Projects']);
    assert.equal(lib.notebooks.find((n) => n.name === 'Projects').dir['X-MarkNote-Color'], '#2d7fb8');
});

test('tree, metadata, folder emoji and tag counts', async () => {
    const { lib } = await setup();
    const design = byTitle(lib, 'Design notes');
    assert.equal(design.icon, '🎨');
    assert.deepEqual(design.tags, ['design', 'planning']);
    const overhaul = byTitle(lib, 'Marknote overhaul');
    assert.equal(overhaul.isFolder, true);
    assert.equal(overhaul.icon, '🛠️');
    assert.equal(design.parentId, overhaul.id);
    assert.equal(byTitle(lib, 'Scratch').parentId, null);
    const tags = Object.fromEntries(lib.tagCounts().map((t) => [t.name, t.count]));
    assert.equal(tags.reference, 3);
    assert.ok(![...lib.items.values()].some((i) => i.name === '.directory'));
});

test('filter by name, tags (all/any) and contents', async () => {
    const { lib } = await setup();
    const titles = (set) => [...set].map((id) => lib.items.get(id).title).filter((t) => !['Marknote overhaul', 'Research', 'Reading'].includes(t)).sort();
    assert.equal(lib.filter({}), null);
    assert.deepEqual(titles(lib.filter({ text: 'tag:kde tag:reference' })), ['Dolphin tree behaviour', 'KDE HIG excerpts']);
    assert.deepEqual(titles(lib.filter({ tags: ['qt', 'meetings'], any: true })), ['Qt Quick layouts', 'Weekly sync']);
    assert.deepEqual(titles(lib.filter({ text: 'dolphin' })), ['Dolphin tree behaviour']);
    assert.deepEqual(titles(lib.filter({ text: 'Dolphin', contents: true })), ['Design notes', 'Dolphin tree behaviour']);
    const visible = lib.filter({ text: 'notion' });
    assert.ok(visible.has(byTitle(lib, 'Research').id) && visible.has(byTitle(lib, 'Marknote overhaul').id));
});

test('save writes to Drive; reopening shows it', async () => {
    const { drive, lib, store } = await setup();
    const scratch = byTitle(lib, 'Scratch');
    await lib.saveNote(scratch.id, '# Scratch\n\nEdited on the phone\n');
    assert.equal(drive.nodes.get(scratch.id).content, '# Scratch\n\nEdited on the phone\n');
    const lib2 = new Library({ drive, store: new MemoryStore() });
    await lib2.loadNotebooks();
    await lib2.openNotebook(lib2.notebooks.find((n) => n.name === 'Projects'));
    assert.equal(await lib2.readNote(scratch.id), '# Scratch\n\nEdited on the phone\n');
});

test('edit made elsewhere meanwhile: both versions kept', async () => {
    const { drive, lib } = await setup();
    const scratch = byTitle(lib, 'Scratch');
    drive.externalEdit(scratch.id, '# Scratch\n\nEdited on the desktop\n');
    const r = await lib.saveNote(scratch.id, '# Scratch\n\nEdited on the phone\n');
    assert.ok(r.conflictCopy);
    assert.match(r.conflictCopy.name, /^Scratch \(conflict \d{4}-\d\d-\d\d \d{4}\)\.md$/);
    assert.equal(drive.nodes.get(scratch.id).content, '# Scratch\n\nEdited on the desktop\n');
    assert.equal(drive.nodes.get(r.conflictCopy.id).content, '# Scratch\n\nEdited on the phone\n');
    assert.equal(lib.text(scratch.id), '# Scratch\n\nEdited on the desktop\n');
    // The next save is based on the desktop version, so it goes straight through.
    assert.deepEqual(await lib.saveNote(scratch.id, '# Scratch\n\nMerged\n'), {});
});

test('offline: saves and new notes wait, then upload', async () => {
    const { drive, lib, store } = await setup();
    const scratch = byTitle(lib, 'Scratch');
    const real = { getMeta: drive.getMeta, createFile: drive.createFile };
    drive.getMeta = drive.createFile = async () => {
        throw new OfflineError('offline');
    };
    assert.deepEqual(await lib.saveNote(scratch.id, 'offline edit'), { queued: true });
    const fresh = await lib.createNote(null, 'Written offline');
    assert.ok(fresh.id.startsWith('local-'));
    await lib.saveNote(fresh.id, '# Written offline\n\nmore');
    assert.equal(lib.online, false);
    assert.equal(lib.pending, 2);

    // A reload while offline still shows both.
    const online = { ...real, listTree: drive.listTree, resolvePath: drive.resolvePath };
    for (const m of Object.keys(online)) {
        drive[m] = async () => {
            throw new OfflineError('offline');
        };
    }
    const lib2 = new Library({ drive, store });
    await lib2.loadNotebooks();
    await lib2.openNotebook(lib2.notebooks.find((n) => n.name === 'Projects'));
    assert.equal(lib2.text(scratch.id), 'offline edit');
    assert.equal(lib2.text(fresh.id), '# Written offline\n\nmore');
    assert.equal(byTitle(lib2, 'Written offline').pending, true);
    Object.assign(drive, online);

    await lib.flushOutbox();
    assert.equal(lib.pending, 0);
    assert.equal(drive.nodes.get(scratch.id).content, 'offline edit');
    const created = drive.findByPath('Marknote/Projects/Written offline.md');
    assert.equal(created.content, '# Written offline\n\nmore');
    assert.ok(!lib.items.has(fresh.id));
    assert.ok(lib.items.has(created.id));
});

test('create, rename, move, trash; folder icon', async () => {
    const { drive, lib } = await setup();
    const folder = await lib.createFolder(null, 'Ideas');
    const n = await lib.createNote(folder.id, 'First idea');
    assert.equal(drive.pathOf(n.id), 'Marknote/Projects/Ideas/First idea.md');
    assert.match(lib.text(n.id), /^---\nid: [0-9A-Z]{26}\ncreated: .+\n---\n\n# First idea\n$/);
    const n2 = await lib.createNote(folder.id, 'First idea');
    assert.equal(n2.name, 'First idea 2.md');
    await lib.rename(n2.id, 'Second idea');
    assert.equal(drive.pathOf(n2.id), 'Marknote/Projects/Ideas/Second idea.md');
    await lib.move(n2.id, null);
    assert.equal(drive.pathOf(n2.id), 'Marknote/Projects/Second idea.md');
    await assert.rejects(lib.move(folder.id, folder.id), /itself/);
    await lib.setFolderIcon(folder.id, '💡');
    assert.equal(lib.items.get(folder.id).icon, '💡');
    assert.match(drive.findByPath('Marknote/Projects/Ideas/.directory').content, /X-Marknote-Emoji=💡/);
    await lib.trash(folder.id);
    assert.equal(drive.nodes.get(n.id).trashed, true);
    assert.ok(!lib.items.has(n.id));
});

test('tags and icon edit the front matter and keep the body', async () => {
    const { drive, lib } = await setup();
    const scratch = byTitle(lib, 'Scratch');
    await lib.setTags(scratch.id, ['#home', 'two words', 'home']);
    await lib.setIcon(scratch.id, '📝');
    const text = drive.nodes.get(scratch.id).content;
    const { raw, body } = FM.split(text);
    assert.deepEqual(FM.parse(raw).tags, ['home', 'two-words']);
    assert.equal(FM.parse(raw).icon, '📝');
    assert.ok(FM.parse(raw).id);
    assert.equal(body, '# Scratch\n\nA plain note without front matter.\n');
    assert.deepEqual(byTitle(lib, 'Scratch').tags, ['home', 'two-words']);
});

test('.directory helpers keep other keys', () => {
    const text = '[Desktop Entry]\nIcon=folder-blue\nX-MarkNote-Color=#fff\n\n[Other]\nA=1\n';
    const edited = editDirectory(text, { 'X-Marknote-Emoji': '💡', Icon: null });
    assert.equal(edited, '[Desktop Entry]\nX-MarkNote-Color=#fff\nX-Marknote-Emoji=💡\n\n[Other]\nA=1\n');
    assert.deepEqual(parseDirectory(edited), { 'X-MarkNote-Color': '#fff', 'X-Marknote-Emoji': '💡' });
    assert.equal(editDirectory('', { 'X-Marknote-Emoji': '🌱' }), '[Desktop Entry]\nX-Marknote-Emoji=🌱\n');
});

test('conflict names are unique', () => {
    const now = new Date(2026, 10, 24, 9, 15);
    assert.equal(conflictName('Note.md', new Set(), now), 'Note (conflict 2026-11-24 0915).md');
    assert.equal(conflictName('Note.md', new Set(['Note (conflict 2026-11-24 0915).md']), now), 'Note (conflict 2026-11-24 0915 2).md');
});

test('quick successive saves of one note never conflict with each other', async () => {
    const { drive, lib } = await setup();
    const scratch = byTitle(lib, 'Scratch');
    drive.latency = 5;
    const results = await Promise.all([
        lib.saveNote(scratch.id, 'one'),
        lib.setTags(scratch.id, ['a']),
        lib.saveNote(scratch.id, FM.join(FM.split(lib.text(scratch.id)).raw, 'three')),
    ]);
    assert.ok(results.every((r) => !r.conflictCopy), JSON.stringify(results));
    assert.ok(![...drive.nodes.values()].some((n) => n.name.includes('conflict')));
    const final = drive.nodes.get(scratch.id).content;
    assert.equal(FM.split(final).body, 'three');
    assert.deepEqual(FM.parse(FM.split(final).raw).tags, ['a']);
});
