// SPDX-FileCopyrightText: 2026 Marknote fork contributors
// SPDX-License-Identifier: GPL-2.0-only OR GPL-3.0-only OR LicenseRef-KDE-Accepted-GPL
//
// Encrypted notebooks, format version 1 (docs/encryption.md), the same as the
// desktop app: Argon2id for the password, XChaCha20-Poly1305 for the notebook
// key and for notes. libsodium is loaded only when it is needed.

import * as FM from './frontmatter.js';

let sodiumPromise = null;
export function sodium() {
    if (!sodiumPromise) {
        sodiumPromise = import('libsodium-wrappers-sumo').then(async (m) => {
            const s = m.default ?? m;
            await s.ready;
            return s;
        });
    }
    return sodiumPromise;
}

const enc = new TextEncoder();
const dec = new TextDecoder();
const PASSWORD_AD = enc.encode('marknote-vault-v1:password');
const RECOVERY_AD = enc.encode('marknote-vault-v1:recovery');
const NOTE_AD = enc.encode('marknote-note-v1');
const BASE32 = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567';

const b64 = (bytes) => btoa(String.fromCharCode(...bytes));
const unb64 = (text) => Uint8Array.from(atob(text.replace(/\s/g, '')), (c) => c.charCodeAt(0));

export const VAULT_PATH = '.marknote/vault.json';

export function parseVault(json) {
    const o = typeof json === 'string' ? JSON.parse(json) : json;
    if (o.format !== 'marknote-vault') throw new Error('This is not a Marknote vault file.');
    if (o.version !== 1) throw new Error('This notebook was encrypted by a newer version of Marknote.');
    if (o.kdf?.alg !== 'argon2id13') throw new Error('Unsupported key derivation in the vault file.');
    return o;
}

async function passwordKey(s, vault, password) {
    return s.crypto_pwhash(32, enc.encode(password), unb64(vault.kdf.salt), vault.kdf.opslimit, vault.kdf.memlimit,
        s.crypto_pwhash_ALG_ARGON2ID13);
}

function open(s, sealed, key, nonce, ad) {
    try {
        return s.crypto_aead_xchacha20poly1305_ietf_decrypt(null, sealed, ad, nonce, key);
    } catch {
        return null;
    }
}

/** The notebook key (Uint8Array), or null for a wrong password. */
export async function unlockWithPassword(vault, password) {
    const s = await sodium();
    const kek = await passwordKey(s, vault, password);
    const key = open(s, unb64(vault.password.key), kek, unb64(vault.password.nonce), PASSWORD_AD);
    s.memzero(kek);
    return key && key.length === 32 ? key : null;
}

export function decodeRecoveryKey(text) {
    const clean = text.toUpperCase().replace(/[\s-]/g, '').replaceAll('0', 'O').replaceAll('1', 'I').replaceAll('8', 'B');
    if (clean.length !== 52) return null;
    const out = [];
    let buffer = 0;
    let bits = 0;
    for (const c of clean) {
        const v = BASE32.indexOf(c);
        if (v < 0) return null;
        buffer = ((buffer << 5) | v) & 0xffff;
        bits += 5;
        if (bits >= 8) {
            out.push((buffer >> (bits - 8)) & 0xff);
            bits -= 8;
        }
    }
    return out.length === 32 ? Uint8Array.from(out) : null;
}

export function encodeRecoveryKey(bytes) {
    let out = '';
    let buffer = 0;
    let bits = 0;
    for (const b of bytes) {
        buffer = ((buffer << 8) | b) & 0xffff;
        bits += 8;
        while (bits >= 5) {
            out += BASE32[(buffer >> (bits - 5)) & 31];
            bits -= 5;
        }
    }
    if (bits > 0) out += BASE32[(buffer << (5 - bits)) & 31];
    return out.match(/.{1,4}/g).join('-');
}

export async function unlockWithRecoveryKey(vault, recoveryKey) {
    const s = await sodium();
    const raw = decodeRecoveryKey(recoveryKey);
    if (!raw) return null;
    const key = open(s, unb64(vault.recovery.key), raw, unb64(vault.recovery.nonce), RECOVERY_AD);
    return key && key.length === 32 ? key : null;
}

export function isEncryptedNote(text) {
    const { present, raw } = FM.split(text ?? '');
    return present && FM.value(raw, 'marknote-encrypted') === '1';
}

export function envelopeTitle(text) {
    const { present, raw } = FM.split(text ?? '');
    return present ? FM.value(raw, 'title') ?? '' : '';
}

export async function encryptNote(plaintext, key, title = '') {
    const s = await sodium();
    const nonce = s.randombytes_buf(24);
    const sealed = s.crypto_aead_xchacha20poly1305_ietf_encrypt(enc.encode(plaintext), NOTE_AD, null, nonce, key);
    const data = new Uint8Array(nonce.length + sealed.length);
    data.set(nonce);
    data.set(sealed, nonce.length);
    const b = b64(data);
    const lines = b.match(/.{1,76}/g).join('\n');
    let raw = 'marknote-encrypted: 1';
    if (title) raw = FM.setValue(raw, 'title', title);
    return FM.join(raw, 'This note is encrypted. Open its notebook in Marknote to read it.\n\n```marknote-encrypted\nv1\n' + lines + '\n```\n');
}

const BLOCK = /^```marknote-encrypted[ \t]*\r?\n([\s\S]*?)\r?\n```[ \t]*$/m;

/** The note text, or throws (wrong key, damaged file, newer version). */
export async function decryptNote(envelope, key) {
    const s = await sodium();
    const m = BLOCK.exec(envelope);
    if (!m) throw new Error('The encrypted note is damaged.');
    const [version, ...rest] = m[1].split('\n');
    if (version.trim() !== 'v1') throw new Error('This note was encrypted by a newer version of Marknote.');
    let data;
    try {
        data = unb64(rest.join(''));
    } catch {
        throw new Error('The encrypted note is damaged.');
    }
    if (data.length < 40) throw new Error('The encrypted note is damaged.');
    const plain = open(s, data.subarray(24), key, data.subarray(0, 24), NOTE_AD);
    if (!plain) throw new Error("This note could not be decrypted with the notebook's key.");
    return dec.decode(plain);
}

/** A new vault for a password: { vault, key, recoveryKey }. */
export async function createVault(password) {
    const s = await sodium();
    const vault = {
        format: 'marknote-vault', version: 1, created: new Date().toISOString().replace(/\.\d+Z$/, 'Z'),
        kdf: { alg: 'argon2id13', opslimit: 3, memlimit: 64 * 1024 * 1024, salt: b64(s.randombytes_buf(16)) },
    };
    const key = s.randombytes_buf(32);
    const recovery = s.randombytes_buf(32);
    const kek = await passwordKey(s, vault, password);
    const pn = s.randombytes_buf(24);
    const rn = s.randombytes_buf(24);
    vault.password = { nonce: b64(pn), key: b64(s.crypto_aead_xchacha20poly1305_ietf_encrypt(key, PASSWORD_AD, null, pn, kek)) };
    vault.recovery = { nonce: b64(rn), key: b64(s.crypto_aead_xchacha20poly1305_ietf_encrypt(key, RECOVERY_AD, null, rn, recovery)) };
    s.memzero(kek);
    return { vault, key, recoveryKey: encodeRecoveryKey(recovery) };
}
