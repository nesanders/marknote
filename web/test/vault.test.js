import assert from 'node:assert/strict';
import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import test from 'node:test';
import * as V from '../src/vault.js';

// Shared with the desktop tests: src/autotests/data/encryption.
const DIR = new URL('../../src/autotests/data/encryption/', import.meta.url);
const read = (name) => readFileSync(new URL(name, DIR), 'utf8');
const PASSWORD = 'correct horse battery staple ü';

test('desktop vectors: password, recovery key, note', async () => {
    const vault = V.parseVault(read('vault.json'));
    const key = await V.unlockWithPassword(vault, PASSWORD);
    assert.ok(key);
    assert.equal(await V.unlockWithPassword(vault, PASSWORD + 'x'), null);
    const viaRecovery = await V.unlockWithRecoveryKey(vault, read('recovery-key.txt').trim().toLowerCase().replaceAll('-', ' '));
    assert.deepEqual(viaRecovery, key);
    const env = read('desktop-note.md');
    assert.ok(V.isEncryptedNote(env));
    assert.equal(V.envelopeTitle(env), 'Vector note');
    assert.equal(await V.decryptNote(env, key), read('plain.md'));
});

test('web-made note for the desktop tests', async () => {
    const vault = V.parseVault(read('vault.json'));
    const key = await V.unlockWithPassword(vault, PASSWORD);
    const target = new URL('web-note.md', DIR);
    if (process.env.MARKNOTE_WRITE_VECTORS || !existsSync(target)) {
        writeFileSync(target, await V.encryptNote(read('plain.md'), key, 'Vector note'));
    }
    assert.equal(await V.decryptNote(readFileSync(target, 'utf8'), key), read('plain.md'));
});

test('create, unlock, recovery, tamper', async () => {
    const { vault, key, recoveryKey } = await V.createVault('pw');
    assert.match(recoveryKey, /^([A-Z2-7]{4}-){12}[A-Z2-7]{4}$/);
    assert.deepEqual(await V.unlockWithPassword(V.parseVault(JSON.stringify(vault)), 'pw'), key);
    assert.deepEqual(await V.unlockWithRecoveryKey(vault, recoveryKey), key);
    const env = await V.encryptNote('# secret plans\n', key, '');
    assert.ok(!env.includes('secret'));
    assert.ok(!env.includes('title:'));
    const tampered = env.replace(/\nv1\n(.)/, (m, c) => `\nv1\n${c === 'A' ? 'B' : 'A'}`);
    await assert.rejects(V.decryptNote(tampered, key), /could not be decrypted/);
    assert.equal(V.decodeRecoveryKey('nope'), null);
});
