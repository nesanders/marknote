// SPDX-FileCopyrightText: 2026 Marknote fork contributors
// SPDX-License-Identifier: GPL-2.0-only OR GPL-3.0-only OR LicenseRef-KDE-Accepted-GPL
//
// Offline cache on this device: note contents by file id, the last listing of
// each notebook, and edits waiting to be uploaded. Nothing here is shared.

const STORES = ['content', 'listings', 'outbox'];

export class MemoryStore {
    constructor() {
        this.data = Object.fromEntries(STORES.map((s) => [s, new Map()]));
    }
    async get(store, key) {
        return structuredClone(this.data[store].get(key));
    }
    async set(store, key, value) {
        this.data[store].set(key, structuredClone(value));
    }
    async del(store, key) {
        this.data[store].delete(key);
    }
    async all(store) {
        return [...this.data[store].entries()].map(([key, value]) => ({ key, value: structuredClone(value) }));
    }
    async clear() {
        for (const s of STORES) this.data[s].clear();
    }
}

export class IdbStore {
    constructor(name = 'marknote') {
        this.ready = new Promise((resolve, reject) => {
            const req = indexedDB.open(name, 1);
            req.onupgradeneeded = () => {
                for (const s of STORES) {
                    if (!req.result.objectStoreNames.contains(s)) req.result.createObjectStore(s);
                }
            };
            req.onsuccess = () => resolve(req.result);
            req.onerror = () => reject(req.error);
        });
    }
    async run(store, mode, fn) {
        const db = await this.ready;
        return new Promise((resolve, reject) => {
            const tx = db.transaction(store, mode);
            const req = fn(tx.objectStore(store));
            tx.oncomplete = () => resolve(req?.result);
            tx.onerror = () => reject(tx.error);
        });
    }
    get(store, key) {
        return this.run(store, 'readonly', (s) => s.get(key));
    }
    set(store, key, value) {
        return this.run(store, 'readwrite', (s) => s.put(value, key));
    }
    del(store, key) {
        return this.run(store, 'readwrite', (s) => s.delete(key));
    }
    async all(store) {
        const db = await this.ready;
        return new Promise((resolve, reject) => {
            const out = [];
            const tx = db.transaction(store, 'readonly');
            const req = tx.objectStore(store).openCursor();
            req.onsuccess = () => {
                const c = req.result;
                if (c) {
                    out.push({ key: c.key, value: c.value });
                    c.continue();
                }
            };
            tx.oncomplete = () => resolve(out);
            tx.onerror = () => reject(tx.error);
        });
    }
    async clear() {
        for (const s of STORES) await this.run(s, 'readwrite', (st) => st.clear());
    }
}

export function createStore() {
    try {
        if (typeof indexedDB !== 'undefined') return new IdbStore();
    } catch {
        // private mode without IndexedDB
    }
    return new MemoryStore();
}
