// SPDX-FileCopyrightText: 2026 Marknote fork contributors
// SPDX-License-Identifier: GPL-2.0-only OR GPL-3.0-only OR LicenseRef-KDE-Accepted-GPL

import { render } from 'preact';
import { App } from './ui/App.jsx';

render(<App />, document.getElementById('app'));

if ('serviceWorker' in navigator && location.protocol === 'https:' || location.hostname === 'localhost') {
    navigator.serviceWorker?.register('sw.js').catch(() => {});
}

// A setup link or sign-in reply opened in a tab that already shows the app
// only changes the fragment; reload so it is handled like a fresh visit.
addEventListener('hashchange', () => {
    if (/(^|[#&])(setup|access_token|error)=/.test(location.hash)) location.reload();
});
