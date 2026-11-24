// SPDX-FileCopyrightText: 2026 Marknote fork contributors
// SPDX-License-Identifier: GPL-2.0-only OR GPL-3.0-only OR LicenseRef-KDE-Accepted-GPL
// Line icons in the spirit of Breeze (drawn for this app).

const paths = {
    folder: 'M3 6.5A1.5 1.5 0 0 1 4.5 5h4l2 2h9A1.5 1.5 0 0 1 21 8.5v9a1.5 1.5 0 0 1-1.5 1.5h-15A1.5 1.5 0 0 1 3 17.5z',
    folderNew: 'M3 6.5A1.5 1.5 0 0 1 4.5 5h4l2 2h9A1.5 1.5 0 0 1 21 8.5v9a1.5 1.5 0 0 1-1.5 1.5h-15A1.5 1.5 0 0 1 3 17.5zM12 10v6M9 13h6',
    note: 'M6 3h9l4 4v13a1 1 0 0 1-1 1H6a1 1 0 0 1-1-1V4a1 1 0 0 1 1-1zM14 3v5h5M8 16v-4l2 2 2-2v4M15 12v4M13.5 14.5 15 16l1.5-1.5',
    plus: 'M12 5v14M5 12h14',
    chevron: 'M9 6l6 6-6 6',
    back: 'M15 6l-6 6 6 6',
    menu: 'M12 5.5h.01M12 12h.01M12 18.5h.01',
    hamburger: 'M4 7h16M4 12h16M4 17h16',
    search: 'M10.5 17a6.5 6.5 0 1 0 0-13 6.5 6.5 0 0 0 0 13zM20 20l-4.8-4.8',
    tag: 'M3 12.2V4.5A1.5 1.5 0 0 1 4.5 3h7.7l8.8 8.8-9.2 9.2zM7.5 7.5h.01',
    gear: 'M12 15a3 3 0 1 0 0-6 3 3 0 0 0 0 6zM19.4 15a1.7 1.7 0 0 0 .3 1.8l.1.1a2 2 0 1 1-2.8 2.8l-.1-.1a1.7 1.7 0 0 0-1.8-.3 1.7 1.7 0 0 0-1 1.5V21a2 2 0 1 1-4 0v-.1a1.7 1.7 0 0 0-1.1-1.5 1.7 1.7 0 0 0-1.8.3l-.1.1a2 2 0 1 1-2.8-2.8l.1-.1a1.7 1.7 0 0 0 .3-1.8 1.7 1.7 0 0 0-1.5-1H3a2 2 0 1 1 0-4h.1a1.7 1.7 0 0 0 1.5-1.1 1.7 1.7 0 0 0-.3-1.8l-.1-.1a2 2 0 1 1 2.8-2.8l.1.1a1.7 1.7 0 0 0 1.8.3H9a1.7 1.7 0 0 0 1-1.5V3a2 2 0 1 1 4 0v.1a1.7 1.7 0 0 0 1 1.5 1.7 1.7 0 0 0 1.8-.3l.1-.1a2 2 0 1 1 2.8 2.8l-.1.1a1.7 1.7 0 0 0-.3 1.8V9a1.7 1.7 0 0 0 1.5 1H21a2 2 0 1 1 0 4h-.1a1.7 1.7 0 0 0-1.5 1z',
    edit: 'M4 20h4L19 9l-4-4L4 16zM13.5 6.5l4 4',
    check: 'M5 12.5l4.5 4.5L19 7.5',
    close: 'M6 6l12 12M18 6L6 18',
    trash: 'M4 7h16M9 7V4h6v3M6 7l1 13h10l1-13M10 11v6M14 11v6',
    refresh: 'M20 11a8 8 0 1 0-2.3 5.7M20 5v6h-6',
    offline: 'M3 3l18 18M8.5 8.6A6 6 0 0 0 6 13.5 4 4 0 0 0 6.5 21H17M12.4 6.1A6 6 0 0 1 18 11a4.5 4.5 0 0 1 2.7 7.9',
    cloud: 'M6.5 19a4.5 4.5 0 0 1-.8-8.9A6 6 0 0 1 17.5 9a5 5 0 0 1 0 10z',
    smile: 'M12 21a9 9 0 1 0 0-18 9 9 0 0 0 0 18zM8.5 14.5s1.2 2 3.5 2 3.5-2 3.5-2M9 9.5h.01M15 9.5h.01',
    calendar: 'M4 6.5A1.5 1.5 0 0 1 5.5 5h13A1.5 1.5 0 0 1 20 6.5v12a1.5 1.5 0 0 1-1.5 1.5h-13A1.5 1.5 0 0 1 4 18.5zM4 10h16M8 3v4M16 3v4',
    move: 'M3 6.5A1.5 1.5 0 0 1 4.5 5h4l2 2h9A1.5 1.5 0 0 1 21 8.5v9a1.5 1.5 0 0 1-1.5 1.5h-15A1.5 1.5 0 0 1 3 17.5zM9 13h6M13 10.5l2.5 2.5-2.5 2.5',
    rename: 'M4 7V5h16v2M12 5v14M9 19h6',
    bold: 'M7 4h6a4 4 0 0 1 0 8H7zM7 12h7a4 4 0 0 1 0 8H7z',
    italic: 'M10 4h8M6 20h8M14 4l-4 16',
    heading: 'M6 4v16M18 4v16M6 12h12',
    list: 'M9 6h11M9 12h11M9 18h11M4.5 6h.01M4.5 12h.01M4.5 18h.01',
    checklist: 'M3.5 6.5l1.5 1.5 3-3M3.5 12.5l1.5 1.5 3-3M3.5 18.5l1.5 1.5 3-3M11 7h10M11 13h10M11 19h10',
    quote: 'M7 7h4v5c0 3-2 5-4 5M14 7h4v5c0 3-2 5-4 5',
    code: 'M8 7l-5 5 5 5M16 7l5 5-5 5',
    link: 'M10 14a4 4 0 0 0 5.7 0l3-3a4 4 0 0 0-5.7-5.7l-1 1M14 10a4 4 0 0 0-5.7 0l-3 3a4 4 0 0 0 5.7 5.7l1-1',
    eye: 'M2 12s3.5-7 10-7 10 7 10 7-3.5 7-10 7S2 12 2 12zM12 15a3 3 0 1 0 0-6 3 3 0 0 0 0 6z',
    notebook: 'M6 3h12a1 1 0 0 1 1 1v16a1 1 0 0 1-1 1H6a1 1 0 0 1-1-1V4a1 1 0 0 1 1-1zM8.5 3v18',
    info: 'M12 21a9 9 0 1 0 0-18 9 9 0 0 0 0 18zM12 11v6M12 7.5h.01',
};

export function Icon({ name, size = 20, label }) {
    return (
        <svg class="icon" width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor"
            stroke-width={name === 'menu' ? 3 : 1.6} stroke-linecap="round" stroke-linejoin="round"
            aria-hidden={label ? undefined : 'true'} role={label ? 'img' : undefined} aria-label={label}>
            <path d={paths[name] ?? paths.note} />
        </svg>
    );
}

/** A note or folder icon: emoji if set, else a line icon. */
export function ItemIcon({ item, size = 18 }) {
    const icon = item.icon ?? '';
    if (icon && !/^[a-z0-9-]+$/i.test(icon)) {
        return <span class="emoji" style={{ fontSize: `${size * 0.95}px`, width: `${size}px` }} aria-hidden="true">{icon}</span>;
    }
    return <Icon name={item.isFolder ? 'folder' : 'note'} size={size} />;
}
