import assert from 'node:assert/strict';
import test from 'node:test';
import { FakeDrive, seedDemo } from '../src/fakedrive.js';
import { OfflineError } from '../src/drive.js';
import { Library, LockedError } from '../src/library.js';
import { MemoryStore } from '../src/store.js';
import * as V from '../src/vault.js';

const PASSWORD = 'hunter22 hunter22';

/** The demo Drive with "Personal" encrypted the way the desktop app does it. */
async function setup() {
    const drive = seedDemo(new FakeDrive());
    const store = new MemoryStore();
    const lib = new Library({ drive, store });
    await lib.loadNotebooks();
    const personal = lib.notebooks.find((n) => n.name === 'Personal');
    const { vault, key, recoveryKey } = await V.createVault(PASSWORD);
    const dot = await drive.createFolder(personal.id, '.marknote');
    await drive.createFile(dot.id, 'vault.json', JSON.stringify(vault), 'application/json');
    for (const f of await drive.listTree(personal.id)) {
        if (!f.isFolder && f.name.endsWith('.md')) {
            await drive.updateFile(f.id, await V.encryptNote(await drive.getText(f.id), key));
        }
    }
    await lib.openNotebook(personal);
    return { drive, store, lib, personal, recoveryKey };
}

const notes = (lib) => [...lib.items.values()].filter((i) => !i.isFolder);
const allStored = async (store) => (await store.all('content')).map((c) => c.value.text ?? '').concat((await store.all('outbox')).map((o) => o.value.text ?? ''));

test('locked notebook: titles only, nothing readable', async () => {
    const { lib, store } = await setup();
    assert.ok(lib.encrypted && lib.locked);
    assert.ok(!lib.items.has(undefined));
    assert.ok(![...lib.items.values()].some((i) => i.name === '.marknote' || i.name === 'vault.json'));
    const groceries = notes(lib).find((n) => n.title === 'Recipes');
    assert.ok(groceries);
    assert.equal(lib.text(groceries.id), undefined);
    await assert.rejects(lib.readNote(groceries.id), LockedError);
    await assert.rejects(lib.saveNote(groceries.id, 'leak'), LockedError);
    await assert.rejects(lib.createNote(null, 'New'), LockedError);
    assert.equal(lib.filter({ text: 'lentil', contents: true }).size, 0);
    // The device cache holds only envelopes.
    for (const t of await allStored(store)) assert.ok(!t.includes('# Recipes'));
});

test('unlock, read, edit, create, lock', async () => {
    const { lib, drive, store } = await setup();
    assert.equal(await lib.unlock('wrong password'), false);
    assert.equal(await lib.unlock(PASSWORD), true);
    assert.ok(!lib.locked);
    const groceries = notes(lib).find((n) => n.title === 'Recipes');
    assert.match(lib.text(groceries.id), /# Recipes/);

    await lib.saveNote(groceries.id, '# Recipes\n\nSecret eggs\n');
    const onDrive = await drive.getText(groceries.id);
    assert.ok(V.isEncryptedNote(onDrive));
    assert.ok(!onDrive.includes('Secret'));

    const fresh = await lib.createNote(null, 'Diary');
    assert.match(lib.text(fresh.id), /# Diary/);
    assert.ok(V.isEncryptedNote(await drive.getText(fresh.id)));
    await lib.setTags(fresh.id, ['private']);
    assert.deepEqual(fresh.tags, ['private']);

    for (const t of await allStored(store)) assert.ok(!t.includes('Secret eggs') && !t.includes('# Diary'));

    lib.lock();
    assert.ok(lib.locked);
    assert.equal(lib.text(groceries.id), undefined);
    assert.deepEqual(fresh.tags, []);
    await assert.rejects(lib.readNote(fresh.id), LockedError);
});

test('recovery key unlocks; a save started before locking completes', async () => {
    const { lib, drive, recoveryKey } = await setup();
    assert.equal(await lib.unlock(recoveryKey.toLowerCase(), { recovery: true }), true);
    const groceries = notes(lib).find((n) => n.title === 'Recipes');
    const saving = lib.saveNote(groceries.id, '# Recipes\n\nLast words\n');
    lib.lock();
    await saving;
    assert.ok(await lib.unlock(PASSWORD));
    const key = lib.key();
    assert.equal(await V.decryptNote(await drive.getText(groceries.id), key), '# Recipes\n\nLast words\n');
});

test('offline in an encrypted notebook: the outbox holds envelopes', async () => {
    const { lib, drive, store } = await setup();
    await lib.unlock(PASSWORD);
    const groceries = notes(lib).find((n) => n.title === 'Recipes');
    drive.updateFile = async () => {
        throw new OfflineError('offline');
    };
    drive.getMeta = drive.updateFile;
    assert.deepEqual(await lib.saveNote(groceries.id, '# Recipes\n\nOffline secret\n'), { queued: true });
    for (const t of await allStored(store)) assert.ok(!t.includes('Offline secret'));
});

test('auto-lock after idle time', async () => {
    const { lib } = await setup();
    await lib.unlock(PASSWORD);
    lib.autoLock(15);
    assert.ok(!lib.locked);
    lib.lastUse = Date.now() - 16 * 60000;
    lib.autoLock(15);
    assert.ok(lib.locked);
});
