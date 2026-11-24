# Marknote encrypted notebooks — file format (version 1)

This describes how an encrypted notebook is stored, so that Marknote desktop,
the Marknote web app and any future client read and write the same files.
Everything uses [libsodium](https://libsodium.org) primitives.

## What is protected

| Encrypted | Not encrypted (visible to anyone with the files) |
|---|---|
| Note text | Note **display titles** (file name and `title:`) |
| Tags, icon, created date, all other front matter | Folder names and the folder structure |
| | Images and other attachments |
| | Number, size and modification times of files |

The app says this plainly when a notebook is encrypted.

## Keys

- **Notebook key**: 32 random bytes (`randombytes_buf`). Every note in the
  notebook is encrypted with it. It never changes, so changing the password
  does not re-encrypt any note.
- **Password key**: `crypto_pwhash` (Argon2id 1.3, `crypto_pwhash_ALG_ARGON2ID13`)
  of the password (UTF-8) with a random 16-byte salt, `opslimit` 3,
  `memlimit` 64 MiB, output 32 bytes. Parameters are stored, so later
  versions may raise them.
- **Recovery key**: 32 random bytes, shown once to the user as 52 Base32
  characters (RFC 4648 alphabet `A–Z2–7`, no padding) in groups of four:
  `ABCD-EFGH-…-WXYZ`. When reading one back, spaces, dashes and case are
  ignored, and `0`→`O`, `1`→`I`, `8`→`B` are accepted as typos. It is used
  directly as a key (it has full entropy; no KDF).

The notebook key is stored twice, wrapped by the password key and by the
recovery key, with `crypto_aead_xchacha20poly1305_ietf` (random 24-byte nonce).
Additional data: `marknote-vault-v1:password` or `marknote-vault-v1:recovery`.
A wrong password or recovery key fails authentication; there is no separate
check value.

## `<notebook>/.marknote/vault.json`

Its presence makes a notebook encrypted. It is synced like any other file.
Base64 is standard (RFC 4648 §4, with padding).

```json
{
  "format": "marknote-vault",
  "version": 1,
  "created": "2026-11-24T14:40:00Z",
  "kdf": { "alg": "argon2id13", "opslimit": 3, "memlimit": 67108864, "salt": "<16 bytes>" },
  "password": { "nonce": "<24 bytes>", "key": "<48 bytes: wrapped notebook key + tag>" },
  "recovery": { "nonce": "<24 bytes>", "key": "<48 bytes>" }
}
```

Changing the password replaces `kdf.salt` and `password`. Unknown keys are
preserved by writers.

## Encrypted note file

An encrypted note keeps its `.md` file name, so folders, renames, moves and
sync work as for plain notes, and other Markdown tools show a readable stub
instead of a broken file:

````markdown
---
marknote-encrypted: 1
title: "Trip ideas"
---

This note is encrypted. Open its notebook in Marknote to read it.

```marknote-encrypted
v1
<base64 of nonce (24 bytes) || ciphertext, wrapped at 76 characters>
```
````

- `title:` (optional) is the plaintext display title. Without it, the file
  name is shown.
- The ciphertext is `crypto_aead_xchacha20poly1305_ietf_encrypt` of the
  **whole original note** (UTF-8, including its own YAML front matter with
  `id`, `created`, `icon`, `tags`) with the notebook key, a fresh random
  nonce on every save, and additional data `marknote-note-v1`.
- Readers find the block by the fence info string `marknote-encrypted`; its
  first line is the version (`v1`), the remaining lines are Base64 (whitespace
  ignored).

A file without `marknote-encrypted: 1` in its front matter is a plain note,
even inside an encrypted notebook (for example one added by another tool);
Marknote encrypts it the next time it is saved.

## Behaviour

- A locked notebook lists its notes by display title; opening one asks for
  the password (or recovery key). Search and tag filters only see unlocked
  notes.
- Unlocking keeps the notebook key in memory until the notebook is locked,
  the app quits, or the auto-lock timeout passes.
- Encrypting a notebook encrypts every note in place; removing encryption
  decrypts them and deletes `vault.json`. Both need the notebook unlocked.

## Clients

- **Desktop**: all of the above, plus encrypting, changing the password and removing
  encryption.
- **Web app**: unlock (password or recovery key), read, edit, create; locks on demand
  or after idle time. Its device cache and offline queue store only the encrypted
  files.

## Test vectors

`src/autotests/data/encryption/` holds a vault and notes produced by one
implementation; the desktop and web test suites both decrypt them.
