// SPDX-FileCopyrightText: 2026 Marknote fork contributors
// SPDX-License-Identifier: GPL-2.0-only OR GPL-3.0-only OR LicenseRef-KDE-Accepted-GPL
//
// YAML front matter, the same subset and output as the desktop app
// (src/notemetadata/frontmatter.cpp): top-level scalars, flow lists and block
// lists. Unknown keys and their lines are preserved verbatim.

const KEY_LINE = /^([A-Za-z0-9_][A-Za-z0-9_.-]*)[ \t]*:(.*)$/;

function isDelimiter(line, closing) {
    const t = line.trim();
    return t === '---' || (closing && t === '...');
}

function isContinuation(line) {
    if (!line) return false;
    return /^\s/.test(line) || line.startsWith('- ') || line === '-';
}

export function unquote(value) {
    let s = value.trim();
    if (s.length >= 2 && s.startsWith('"') && s.endsWith('"')) {
        let out = '';
        const inner = s.slice(1, -1);
        for (let i = 0; i < inner.length; ++i) {
            const c = inner[i];
            if (c === '\\' && i + 1 < inner.length) {
                const n = inner[++i];
                out += n === 'n' ? '\n' : n === 't' ? '\t' : n;
            } else {
                out += c;
            }
        }
        return out;
    }
    if (s.length >= 2 && s.startsWith("'") && s.endsWith("'")) {
        return s.slice(1, -1).replaceAll("''", "'");
    }
    const hash = s.indexOf(' #');
    if (hash >= 0) s = s.slice(0, hash);
    return s.trim();
}

function splitFlowList(inner) {
    const items = [];
    let current = '';
    let quote = null;
    let escaped = false;
    for (const c of inner) {
        if (quote) {
            current += c;
            if (escaped) escaped = false;
            else if (quote === '"' && c === '\\') escaped = true;
            else if (c === quote) quote = null;
        } else if (c === '"' || c === "'") {
            quote = c;
            current += c;
        } else if (c === ',') {
            items.push(unquote(current));
            current = '';
        } else {
            current += c;
        }
    }
    if (current.trim()) items.push(unquote(current));
    return items.filter(Boolean);
}

function needsQuotes(s) {
    if (!s || s !== s.trim()) return true;
    if (/[:#[\]{},&*!|>'"%@`]/.test(s) || s.startsWith('-') || s.startsWith('?')) return true;
    if (['true', 'false', 'yes', 'no', 'null', '~', 'on', 'off'].includes(s.toLowerCase())) return true;
    if (!Number.isNaN(Number(s))) return true;
    for (const c of s) {
        if (c.codePointAt(0) > 0x7f) return true;
    }
    return false;
}

function quoted(s) {
    if (!needsQuotes(s)) return s;
    return '"' + s.replaceAll('\\', '\\\\').replaceAll('"', '\\"').replaceAll('\n', '\\n') + '"';
}

/** Local time without offset, like Qt's ISODate for a local QDateTime. */
export function isoLocal(date) {
    const p = (n) => String(n).padStart(2, '0');
    return `${date.getFullYear()}-${p(date.getMonth() + 1)}-${p(date.getDate())}T${p(date.getHours())}:${p(date.getMinutes())}:${p(date.getSeconds())}`;
}

function serialize(value) {
    if (Array.isArray(value)) return '[' + value.map(quoted).join(', ') + ']';
    if (value instanceof Date) return isoLocal(value);
    return quoted(String(value));
}

function isEmptyValue(value) {
    if (value === null || value === undefined) return true;
    if (Array.isArray(value)) return value.length === 0;
    if (value instanceof Date) return Number.isNaN(value.getTime());
    return String(value) === '';
}

/** Split a note into { present, raw, body }. */
export function split(text) {
    let t = text.startsWith('\uFEFF') ? text.slice(1) : text;
    const firstEnd = t.indexOf('\n');
    if (firstEnd < 0 || !isDelimiter(t.slice(0, firstEnd).replace(/\r$/, ''), false)) {
        return { present: false, raw: '', body: text };
    }
    const lines = t.slice(firstEnd + 1).split('\n');
    const raw = [];
    for (let i = 0; i < lines.length; ++i) {
        const line = lines[i].replace(/\r$/, '');
        if (isDelimiter(line, true)) {
            const body = lines.slice(i + 1).join('\n').replace(/^(\r?\n)+/, '');
            return { present: true, raw: raw.join('\n'), body };
        }
        raw.push(line);
    }
    return { present: false, raw: '', body: text };
}

/** Reassemble a note; an empty raw block gives just the body. */
export function join(raw, body) {
    const cleanBody = body.replace(/^\n+/, '');
    if (!raw.trim()) return cleanBody;
    let out = '---\n' + raw;
    if (!out.endsWith('\n')) out += '\n';
    out += '---\n';
    if (cleanBody) out += '\n' + cleanBody;
    return out;
}

/** A top-level value: string, array of strings, or undefined. */
export function value(raw, key) {
    const lines = raw.split('\n');
    for (let i = 0; i < lines.length; ++i) {
        const m = KEY_LINE.exec(lines[i]);
        if (!m || m[1] !== key) continue;
        const rest = m[2].trim();
        if (!rest) {
            const items = [];
            for (let j = i + 1; j < lines.length && isContinuation(lines[j]); ++j) {
                const item = lines[j].trim();
                if (item.startsWith('-')) {
                    const v = unquote(item.slice(1));
                    if (v) items.push(v);
                }
            }
            return items.length ? items : undefined;
        }
        if (rest.startsWith('[')) {
            let inner = rest.slice(1);
            const close = inner.lastIndexOf(']');
            if (close >= 0) inner = inner.slice(0, close);
            return splitFlowList(inner);
        }
        return unquote(rest);
    }
    return undefined;
}

/** Set or (for an empty value) remove a key, keeping every other line. */
export function setValue(raw, key, newValue) {
    const lines = raw ? raw.split('\n') : [];
    const remove = isEmptyValue(newValue);
    const newLine = key + ': ' + serialize(newValue);
    for (let i = 0; i < lines.length; ++i) {
        const m = KEY_LINE.exec(lines[i]);
        if (!m || m[1] !== key) continue;
        let end = i + 1;
        while (end < lines.length && isContinuation(lines[end])) ++end;
        lines.splice(i, end - i, ...(remove ? [] : [newLine]));
        return lines.join('\n');
    }
    if (!remove) {
        while (lines.length && !lines[lines.length - 1].trim()) lines.pop();
        lines.push(newLine);
    }
    return lines.join('\n');
}

function parseDate(s) {
    if (!s) return null;
    const d = new Date(/^\d{4}-\d{2}-\d{2}$/.test(s) ? s + 'T00:00:00' : s);
    return Number.isNaN(d.getTime()) ? null : d;
}

/** The keys Marknote uses: { id, created (Date|null), icon, tags, title }. */
export function parse(raw) {
    const str = (k) => {
        const v = value(raw, k);
        return Array.isArray(v) ? v.join(' ') : v ?? '';
    };
    let tags = value(raw, 'tags');
    if (typeof tags === 'string') tags = tags.split(/[,\s]+/);
    tags = [...new Set((tags ?? []).map((t) => t.replace(/^#/, '')).filter(Boolean))];
    return { id: str('id'), created: parseDate(str('created')), icon: str('icon'), tags, title: str('title') };
}

const CROCKFORD = '0123456789ABCDEFGHJKMNPQRSTVWXYZ';

/** A new sortable unique id (ULID). */
export function newId(now = Date.now()) {
    let time = '';
    let t = now;
    for (let i = 0; i < 10; ++i) {
        time = CROCKFORD[t % 32] + time;
        t = Math.floor(t / 32);
    }
    const bytes = crypto.getRandomValues(new Uint8Array(16));
    let rand = '';
    for (let i = 0; i < 16; ++i) rand += CROCKFORD[bytes[i] % 32];
    return time + rand;
}

/** Front matter for a brand new note. */
export function initialRaw(created = new Date()) {
    return `id: ${newId(created.getTime())}\ncreated: ${isoLocal(created)}`;
}

export function normalizeTag(tag) {
    return tag.trim().replace(/^#+/, '').replace(/\s+/g, '-').replaceAll(',', '');
}
