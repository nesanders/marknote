// SPDX-FileCopyrightText: 2026 Marknote fork contributors
// SPDX-License-Identifier: GPL-2.0-only OR GPL-3.0-only OR LicenseRef-KDE-Accepted-GPL
//
// To-do blocks: a checklist with its own collapsible Done section (see
// docs/todo.md). Everything works on note bodies as plain text, by line
// number, so the rendered view and the editor share it; the desktop app has a
// port of the same rules, checked against the same fixtures.

export const MARKER_RE = /^<!--\s*marknote-todo\b(.*?)-->\s*$/;
const ITEM_RE = /^( {0,3})([-*+])\s+\[([ xX])\](?:[ \t]+(.*))?$/;
const DUE_RE = /\s*📅\s*(\d{4}-\d{2}-\d{2})/u;
const DONE_RE = /\s*✅\s*(\d{4}-\d{2}-\d{2})/u;
const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

/** Today as YYYY-MM-DD in local time. */
export function localToday(now = new Date()) {
    const p = (n) => String(n).padStart(2, '0');
    return `${now.getFullYear()}-${p(now.getMonth() + 1)}-${p(now.getDate())}`;
}

export function addDays(date, days) {
    const [y, m, d] = date.split('-').map(Number);
    return localToday(new Date(y, m - 1, d + days));
}

function parseOptions(text) {
    const options = { sort: 'manual', rest: [] };
    for (const word of text.trim().split(/\s+/).filter(Boolean)) {
        const m = /^sort=(manual|due)$/.exec(word);
        if (m) options.sort = m[1];
        else options.rest.push(word);
    }
    return options;
}

function parseItem(line, lineNo) {
    const m = ITEM_RE.exec(line);
    if (!m) return null;
    let text = m[4] ?? '';
    let due = null;
    let done = null;
    let hit;
    while ((hit = DUE_RE.exec(text))) {
        due = hit[1];
        text = text.slice(0, hit.index) + text.slice(hit.index + hit[0].length);
    }
    while ((hit = DONE_RE.exec(text))) {
        done = hit[1];
        text = text.slice(0, hit.index) + text.slice(hit.index + hit[0].length);
    }
    return { indent: m[1], bullet: m[2], checked: m[3] !== ' ', text: text.trimEnd(), due, done, extra: [], line: lineNo };
}

/** Reads the item list starting at line i; returns [items, next line]. */
function readItems(lines, i) {
    const items = [];
    while (i < lines.length) {
        const item = parseItem(lines[i], i);
        if (item) {
            items.push(item);
            i += 1;
            continue;
        }
        // Indented, non-blank lines belong to the item above (notes, sub-items).
        if (items.length && /^\s+\S/.test(lines[i]) && !/^\s*<\/?details>/i.test(lines[i])) {
            items[items.length - 1].extra.push(lines[i]);
            i += 1;
            continue;
        }
        break;
    }
    return [items, i];
}

function skipBlank(lines, i) {
    while (i < lines.length && !lines[i].trim()) i += 1;
    return i;
}

/** The block whose marker is on line `start`, or null. */
function parseBlockAt(lines, start) {
    const m = MARKER_RE.exec(lines[start]);
    if (!m) return null;
    const block = { start, end: start + 1, options: parseOptions(m[1]), open: [], done: [], doneStart: -1 };
    let i = skipBlank(lines, start + 1);
    if (i < lines.length && ITEM_RE.test(lines[i])) {
        [block.open, i] = readItems(lines, i);
        block.end = i;
    }
    // The Done section: <details>, <summary>, done items, </details>.
    let j = skipBlank(lines, i);
    if (j < lines.length && /^\s*<details(\s+open)?\s*>\s*$/i.test(lines[j])) {
        const detailsLine = j;
        j = skipBlank(lines, j + 1);
        if (j < lines.length && /^\s*<summary>.*<\/summary>\s*$/i.test(lines[j])) {
            j = skipBlank(lines, j + 1);
            let done = [];
            if (j < lines.length && ITEM_RE.test(lines[j])) [done, j] = readItems(lines, j);
            j = skipBlank(lines, j);
            if (j < lines.length && /^\s*<\/details>\s*$/i.test(lines[j])) {
                block.done = done;
                block.doneStart = detailsLine;
                block.end = j + 1;
            }
        }
    }
    return block;
}

/** All to-do blocks in a body: [{start, end, options, open, done, doneStart}], lines [start, end). */
export function findBlocks(body) {
    const lines = body.split('\n');
    const blocks = [];
    let fence = null;
    for (let i = 0; i < lines.length; ++i) {
        const f = /^\s{0,3}(`{3,}|~{3,})/.exec(lines[i]);
        if (f) {
            if (!fence) fence = f[1][0];
            else if (f[1][0] === fence) fence = null;
            continue;
        }
        if (fence) continue;
        const block = parseBlockAt(lines, i);
        if (block) {
            blocks.push(block);
            i = block.end - 1;
        }
    }
    return blocks;
}

/** The block containing a line, and where in it: {block, list: 'open'|'done', index} or {block} or null. */
export function locate(body, line) {
    for (const block of findBlocks(body)) {
        if (line < block.start || line >= block.end) continue;
        for (const list of ['open', 'done']) {
            const index = block[list].findIndex((it) => line >= it.line && line <= it.line + it.extra.length);
            if (index >= 0) return { block, list, index };
        }
        return { block };
    }
    return null;
}

export function itemLine(item) {
    const parts = [`${item.indent}${item.bullet} [${item.checked ? 'x' : ' '}]`];
    if (item.text) parts.push(item.text);
    if (item.due) parts.push(`📅 ${item.due}`);
    if (item.done) parts.push(`✅ ${item.done}`);
    return parts.join(' ');
}

function sortByDue(items) {
    return items
        .map((it, i) => [it, i])
        .sort(([a, i], [b, j]) => (a.due ?? '9999-99-99').localeCompare(b.due ?? '9999-99-99') || i - j)
        .map(([it]) => it);
}

/** Moves misplaced items, applies the sort and fills in completion dates. */
function normalise(block, today) {
    const misplacedDone = block.open.filter((it) => it.checked);
    const misplacedOpen = block.done.filter((it) => !it.checked);
    block.open = block.open.filter((it) => !it.checked).concat(misplacedOpen);
    block.done = misplacedDone.concat(block.done.filter((it) => it.checked));
    for (const it of block.open) it.done = null;
    for (const it of block.done) it.done ??= today;
    if (block.options.sort === 'due') block.open = sortByDue(block.open);
}

export function serialize(block) {
    const opts = [block.options.sort === 'due' ? 'sort=due' : null, ...block.options.rest].filter(Boolean);
    const out = [opts.length ? `<!-- marknote-todo ${opts.join(' ')} -->` : '<!-- marknote-todo -->'];
    for (const it of block.open) out.push(itemLine(it), ...it.extra);
    if (block.done.length) {
        out.push('', '<details>', `<summary>Done (${block.done.length})</summary>`, '');
        for (const it of block.done) out.push(itemLine(it), ...it.extra);
        out.push('', '</details>');
    }
    return out;
}

function replaceBlock(body, block, today) {
    normalise(block, today);
    const lines = body.split('\n');
    lines.splice(block.start, block.end - block.start, ...serialize(block));
    return lines.join('\n');
}

/**
 * Applies one operation to the block holding `op.line`; returns the new body,
 * or null when the line is not in a to-do block (or the operation is invalid).
 * Operations: {type: 'toggle', line, checked?}, {type: 'due', line, date|null},
 * {type: 'sort', line, sort: 'manual'|'due'}, {type: 'add', line, text},
 * {type: 'move', line, to} (an open item to index `to`; the order becomes manual).
 */
export function apply(body, op, today = localToday()) {
    const where = locate(body, op.line);
    if (!where) return null;
    const { block, list, index } = where;
    switch (op.type) {
    case 'toggle': {
        if (list === undefined) return null;
        const item = block[list][index];
        const checked = op.checked ?? !item.checked;
        if (checked === item.checked) return body;
        block[list].splice(index, 1);
        item.checked = checked;
        if (checked) {
            item.done = today;
            block.done.unshift(item);
        } else {
            item.done = null;
            block.open.push(item);
        }
        return replaceBlock(body, block, today);
    }
    case 'due': {
        if (list === undefined || (op.date !== null && !DATE_RE.test(op.date))) return null;
        block[list][index].due = op.date;
        return replaceBlock(body, block, today);
    }
    case 'sort':
        if (op.sort !== 'manual' && op.sort !== 'due') return null;
        block.options.sort = op.sort;
        return replaceBlock(body, block, today);
    case 'move': {
        // Placing an item by hand means the order is now manual.
        if (list !== 'open' || !(op.to >= 0 && op.to < block.open.length)) return null;
        block.options.sort = 'manual';
        const [item] = block.open.splice(index, 1);
        block.open.splice(op.to, 0, item);
        return replaceBlock(body, block, today);
    }
    case 'add':
        block.open.push({ indent: '', bullet: '-', checked: false, text: op.text ?? '', due: null, done: null, extra: [], line: -1 });
        return replaceBlock(body, block, today);
    default:
        return null;
    }
}

/** Ticks or unticks a task line: the to-do block rules inside a block, a plain toggle elsewhere. */
export function toggleLine(body, line, checked, today = localToday()) {
    const moved = apply(body, { type: 'toggle', line, checked }, today);
    if (moved !== null) return moved;
    const lines = body.split('\n');
    if (line < 0 || line >= lines.length) return body;
    lines[line] = lines[line].replace(/^(\s*(?:[-*+]|\d+[.)])\s+)\[[ xX]\]/, `$1[${checked ? 'x' : ' '}]`);
    return lines.join('\n');
}

/**
 * Turns the checklist around `line` into a to-do block (ticked items go to
 * Done). Returns the new body, or null when the line is not in a checklist or
 * already in a block.
 */
export function makeBlock(body, line, today = localToday()) {
    if (locate(body, line)) return null;
    const lines = body.split('\n');
    if (line < 0 || line >= lines.length) return null;
    const isTaskish = (l) => ITEM_RE.test(l) || (/^\s+\S/.test(l));
    if (!isTaskish(lines[line])) return null;
    let start = line;
    while (start > 0 && isTaskish(lines[start - 1])) start -= 1;
    while (start < lines.length && !ITEM_RE.test(lines[start])) start += 1;
    if (start > line && !ITEM_RE.test(lines[line])) return null;
    lines.splice(start, 0, '<!-- marknote-todo -->');
    const withMarker = lines.join('\n');
    const block = parseBlockAt(withMarker.split('\n'), start);
    if (!block || !block.open.length) return null;
    return replaceBlock(withMarker, block, today);
}

/** Display label for a due date, and how urgent it is. */
export function dueInfo(due, today = localToday()) {
    const [y, m, d] = due.split('-').map(Number);
    const date = new Date(y, m - 1, d);
    const ty = Number(today.slice(0, 4));
    let label;
    if (due === today) label = 'Today';
    else if (due === addDays(today, 1)) label = 'Tomorrow';
    else if (due === addDays(today, -1)) label = 'Yesterday';
    else label = date.toLocaleDateString([], y === ty ? { month: 'short', day: 'numeric' } : { year: 'numeric', month: 'short', day: 'numeric' });
    const state = due < today ? 'overdue' : due === today ? 'today' : '';
    return { label, state };
}

/** Short label for a completion date. */
export function doneLabel(done, today = localToday()) {
    return dueInfo(done, today).label;
}
