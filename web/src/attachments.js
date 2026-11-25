// SPDX-FileCopyrightText: 2026 Marknote fork contributors
// SPDX-License-Identifier: GPL-2.0-only OR GPL-3.0-only OR LicenseRef-KDE-Accepted-GPL
//
// File attachments (docs/attachments.md): a paragraph that is only
// "[📎 Name](relative/file)" is shown as a card linking to the file on Drive.

const LINE_RE = /^\s*\[📎\s?([^\]\n]*)\]\(\s*(<[^>\n]+>|[^\s)]+)\s*\)\s*$/u;

/** Whether a link target can be an attachment: a relative path to a file that is not a note. */
export function isAttachmentTarget(href) {
    if (!href || href.startsWith('#') || href.startsWith('/') || /^[a-z][a-z0-9+.-]*:/i.test(href)) return false;
    let path = href;
    try {
        path = decodeURI(href);
    } catch {
        // keep as written
    }
    return !/\.md$/i.test(path.split(/[?#]/)[0]);
}

/** {name, href} when a line (or paragraph) is an attachment, else null. */
export function parseAttachment(text) {
    const m = LINE_RE.exec(text);
    if (!m) return null;
    const href = m[2].replace(/^<|>$/g, '');
    if (!isAttachmentTarget(href)) return null;
    let name = m[1].trim();
    if (!name) {
        try {
            name = decodeURI(href).split('/').pop();
        } catch {
            name = href.split('/').pop();
        }
    }
    return { name, href };
}

/** The Markdown for an attached file. */
export function attachmentMarkdown(name, link) {
    return `[📎 ${name.replace(/[[\]]/g, '')}](${/[\s()]/.test(link) ? `<${link}>` : link})`;
}

const KINDS = [
    [/\.pdf$/i, '📕', 'PDF'],
    [/\.(docx?|odt|rtf|pages)$/i, '📝', 'Document'],
    [/\.(xlsx?|ods|csv|tsv|numbers)$/i, '📊', 'Spreadsheet'],
    [/\.(pptx?|odp|key)$/i, '📽️', 'Presentation'],
    [/\.(zip|tar|gz|tgz|bz2|xz|7z|rar)$/i, '🗜️', 'Archive'],
    [/\.(mp3|wav|ogg|oga|flac|m4a|aac|opus)$/i, '🎵', 'Audio'],
    [/\.(mp4|mov|webm|mkv|avi|m4v)$/i, '🎬', 'Video'],
    [/\.(png|jpe?g|gif|webp|svg|avif|bmp|heic)$/i, '🖼️', 'Image'],
    [/\.(txt|log|json|xml|ya?ml|ini|toml)$/i, '📄', 'Text'],
];

/** [emoji, kind] for a file name. */
export function fileKind(name) {
    const hit = KINDS.find(([re]) => re.test(name));
    return hit ? [hit[1], hit[2]] : ['📎', 'File'];
}

export function formatSize(bytes) {
    if (bytes === null || bytes === undefined || Number.isNaN(bytes)) return '';
    if (bytes < 1024) return `${bytes} B`;
    const units = ['KB', 'MB', 'GB'];
    let v = bytes / 1024;
    let u = 0;
    while (v >= 1024 && u < units.length - 1) {
        v /= 1024;
        u += 1;
    }
    return `${v < 10 ? v.toFixed(1) : Math.round(v)} ${units[u]}`;
}

/**
 * Fills `el` with the card for an attachment. `info` comes from
 * Library.resolveAttachment: {name, size, driveUrl, downloadUrl} or {missing}.
 */
export function fillAttachmentCard(el, name, info) {
    const [emoji, kind] = fileKind(info?.name ?? name);
    el.textContent = '';
    el.classList.add('attachment-card');
    el.classList.toggle('missing', !!info?.missing);
    const icon = document.createElement('span');
    icon.className = 'att-icon';
    icon.textContent = emoji;
    const body = document.createElement(info?.driveUrl ? 'a' : 'span');
    body.className = 'att-body';
    if (info?.driveUrl) {
        body.href = info.driveUrl;
        body.target = '_blank';
        body.rel = 'noopener noreferrer';
        body.title = 'Open in Google Drive';
    }
    const title = document.createElement('span');
    title.className = 'att-name';
    title.textContent = name;
    const meta = document.createElement('span');
    meta.className = 'att-meta';
    meta.textContent = info?.missing ? 'Not found in this notebook (not synced to Google Drive yet?)'
        : [kind, formatSize(info?.size), info?.driveUrl ? 'Google Drive' : ''].filter(Boolean).join(' · ');
    body.append(title, meta);
    el.append(icon, body);
    if (info?.downloadUrl) {
        const dl = document.createElement('a');
        dl.className = 'att-download';
        dl.href = info.downloadUrl;
        dl.setAttribute('download', info.name ?? name);
        dl.target = '_blank';
        dl.rel = 'noopener noreferrer';
        dl.title = 'Download';
        dl.setAttribute('aria-label', `Download ${name}`);
        dl.innerHTML = '<svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M12 4v11M7 10.5l5 5 5-5M5 20h14"/></svg>';
        el.appendChild(dl);
    }
}
