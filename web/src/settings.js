// SPDX-FileCopyrightText: 2026 Marknote fork contributors
// SPDX-License-Identifier: GPL-2.0-only OR GPL-3.0-only OR LicenseRef-KDE-Accepted-GPL
//
// Per-device preferences in localStorage (never synced, never in the repo).

const KEY = 'marknote.settings';

export const defaults = {
    rootPath: 'Marknote',
    extraNotebooks: [],
    theme: 'auto', // auto | light | dark
    fontScale: 100,
    showTags: true,
    showCreated: true,
    tagAny: false,
    searchContents: false,
    lastNotebook: '',
    lastNote: '',
    expanded: {},
};

export function loadSettings() {
    try {
        return { ...defaults, ...JSON.parse(localStorage.getItem(KEY) ?? '{}') };
    } catch {
        return { ...defaults };
    }
}

export function saveSettings(settings) {
    try {
        localStorage.setItem(KEY, JSON.stringify(settings));
    } catch {
        // storage full or blocked: preferences just are not remembered
    }
}
