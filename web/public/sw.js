// SPDX-FileCopyrightText: 2026 Marknote fork contributors
// SPDX-License-Identifier: GPL-2.0-only OR GPL-3.0-only OR LicenseRef-KDE-Accepted-GPL
//
// Offline app shell. Only this site's own files are cached; Google API calls
// and sign-in always go to the network (notes are cached by the app itself).

const VERSION = '__BUILD_VERSION__';
const SHELL = __SHELL_FILES__;
const CACHE = `marknote-${VERSION}`;

self.addEventListener('install', (event) => {
    event.waitUntil(caches.open(CACHE).then((c) => c.addAll(SHELL)).then(() => self.skipWaiting()));
});

self.addEventListener('activate', (event) => {
    event.waitUntil(
        caches.keys()
            .then((keys) => Promise.all(keys.filter((k) => k.startsWith('marknote-') && k !== CACHE).map((k) => caches.delete(k))))
            .then(() => self.clients.claim()),
    );
});

self.addEventListener('fetch', (event) => {
    const url = new URL(event.request.url);
    if (event.request.method !== 'GET' || url.origin !== location.origin) return;
    if (event.request.mode === 'navigate') {
        // The page itself: network first (fresh deploys), cached copy offline.
        event.respondWith(fetch(event.request).catch(() => caches.match('./index.html').then((r) => r ?? caches.match('./'))));
        return;
    }
    event.respondWith(caches.match(event.request).then((hit) => hit ?? fetch(event.request).then((res) => {
        if (res.ok && url.pathname.includes('/chunks/')) {
            const copy = res.clone();
            caches.open(CACHE).then((c) => c.put(event.request, copy));
        }
        return res;
    })));
});
