// SPDX-FileCopyrightText: 2026 Marknote fork contributors
// SPDX-License-Identifier: GPL-2.0-only OR GPL-3.0-only OR LicenseRef-KDE-Accepted-GPL
//
// Markdown to safe HTML. Raw HTML in notes is not rendered, output is
// sanitized, and "- [ ]" items become checkboxes that know their source line.

import MarkdownIt from 'markdown-it';
import DOMPurify from 'dompurify';
import { findBlocks, dueInfo, localToday } from './todo.js';

const md = new MarkdownIt({ html: false, linkify: true, typographer: false, breaks: false });

// Desktop Marknote links images as file:///…; those are resolved to the copy in
// Drive, never opened. Script-like schemes stay blocked.
md.validateLink = (url) => {
    const s = url.trim().toLowerCase();
    if (/^(javascript|vbscript):/.test(s)) return false;
    if (s.startsWith('data:')) return /^data:image\/(gif|png|jpeg|webp);/.test(s);
    return true;
};

md.core.ruler.after('inline', 'marknote_tasks', (state) => {
    const tokens = state.tokens;
    for (let i = 2; i < tokens.length; ++i) {
        const t = tokens[i];
        if (t.type !== 'inline' || tokens[i - 1].type !== 'paragraph_open' || tokens[i - 2].type !== 'list_item_open') continue;
        const m = /^\[([ xX])\][ \t]/.exec(t.content);
        if (!m || !t.children?.length || t.children[0].type !== 'text') continue;
        t.children[0].content = t.children[0].content.replace(/^\[[ xX]\][ \t]/, '');
        const box = new state.Token('html_inline', '', 0);
        const line = tokens[i - 2].map ? tokens[i - 2].map[0] + (state.env?.lineOffset ?? 0) : -1;
        box.content = `<input type="checkbox" class="task" data-line="${line}"${m[1] === ' ' ? '' : ' checked'}> `;
        t.children.unshift(box);
        tokens[i - 2].attrJoin('class', 'task-item');
    }
});

// html: false escapes raw HTML, but our own checkbox tokens must pass through.
md.renderer.rules.html_inline = (tokens, idx) => tokens[idx].content;

// ---- Math: $inline$, $$display$$ (same syntax md4qt parses on desktop) ----

function mathInline(state, silent) {
    const src = state.src;
    const start = state.pos;
    if (src[start] !== '$') return false;
    const display = src[start + 1] === '$';
    const open = display ? 2 : 1;
    const first = src[start + open];
    if (first === undefined || (!display && /\s/.test(first))) return false;
    let pos = start + open;
    while (pos < state.posMax) {
        if (src[pos] === '\\') {
            pos += 2;
            continue;
        }
        if (src[pos] === '$' && (!display || src[pos + 1] === '$')) {
            if (!display && (/\s/.test(src[pos - 1]) || /\d/.test(src[pos + 1] ?? ''))) {
                pos += 1;
                continue;
            }
            break;
        }
        pos += 1;
    }
    if (pos >= state.posMax) return false;
    const tex = src.slice(start + open, pos);
    if (!tex.trim()) return false;
    if (!silent) {
        const t = state.push('math_inline', 'span', 0);
        t.content = tex;
        t.meta = { display };
    }
    state.pos = pos + open;
    return true;
}

function mathBlock(state, startLine, endLine, silent) {
    const start = state.bMarks[startLine] + state.tShift[startLine];
    const max = state.eMarks[startLine];
    if (state.src.slice(start, start + 2) !== '$$') return false;
    let firstLine = state.src.slice(start + 2, max);
    let next = startLine;
    let lastLine = '';
    let found = false;
    if (firstLine.trim().endsWith('$$') && firstLine.trim().length > 2) {
        firstLine = firstLine.trim().slice(0, -2);
        found = true;
    }
    while (!found) {
        next += 1;
        if (next >= endLine) return false;
        const s = state.bMarks[next] + state.tShift[next];
        const line = state.src.slice(s, state.eMarks[next]);
        if (line.trim().endsWith('$$')) {
            lastLine = line.trim().slice(0, -2);
            found = true;
        }
    }
    if (silent) return true;
    const t = state.push('math_block', 'div', 0);
    t.block = true;
    t.content = (firstLine.trim() ? firstLine + '\n' : '')
        + (next > startLine ? state.getLines(startLine + 1, next, state.tShift[startLine], true) : '')
        + (lastLine.trim() ? lastLine : '');
    t.map = [startLine, next + 1];
    state.line = next + 1;
    return true;
}

md.inline.ruler.after('escape', 'math_inline', mathInline);
md.block.ruler.before('fence', 'math_block', mathBlock, { alt: ['paragraph', 'reference', 'blockquote', 'list'] });
md.renderer.rules.math_inline = (tokens, idx) => {
    const t = tokens[idx];
    const cls = t.meta?.display ? 'math display' : 'math';
    return `<span class="${cls}" data-tex="${encodeURIComponent(t.content)}">${md.utils.escapeHtml(t.content)}</span>`;
};
md.renderer.rules.math_block = (tokens, idx) => {
    const tex = tokens[idx].content.trim();
    return `<div class="math display" data-tex="${encodeURIComponent(tex)}">${md.utils.escapeHtml(tex)}</div>\n`;
};

// Images are filled in later (from Drive, or the web for http links).
md.renderer.rules.image = (tokens, idx) => {
    const t = tokens[idx];
    const alt = md.utils.escapeHtml(t.children ? md.renderer.renderInlineAsText(t.children, md.options, {}) : t.content);
    const title = t.attrGet('title');
    return `<img data-src="${md.utils.escapeHtml(t.attrGet('src') ?? '')}" alt="${alt}"${title ? ` title="${md.utils.escapeHtml(title)}"` : ''} loading="lazy">`;
};

md.renderer.rules.fence = (tokens, idx) => {
    const t = tokens[idx];
    const lang = (t.info || '').trim().split(/\s+/)[0];
    if (lang === 'mermaid') {
        // Encoded: the sanitizer drops attribute values containing "-->".
        return `<div class="mermaid-block" data-src="${encodeURIComponent(t.content)}"><pre class="code"><code>${md.utils.escapeHtml(t.content)}</code></pre></div>\n`;
    }
    const label = lang ? `<span class="code-lang">${md.utils.escapeHtml(lang)}</span>` : '';
    return `<pre class="code">${label}<code>${md.utils.escapeHtml(t.content)}</code></pre>\n`;
};

const esc = (t) => md.utils.escapeHtml(t);

function dueChip(item, line, today) {
    if (!item.due) {
        return item.checked ? '' : `<button type="button" class="due-add" data-due-line="${line}" aria-label="Add due date" title="Add due date">📅</button>`;
    }
    const { label } = dueInfo(item.due, today);
    const state = item.checked ? '' : dueInfo(item.due, today).state;
    return `<button type="button" class="due-chip${state ? ' ' + state : ''}" data-due-line="${line}" data-due="${item.due}" title="Due ${item.due}">📅 ${esc(label)}</button>`;
}

function todoItem(item, today) {
    const extra = item.extra.length ? md.render(item.extra.map((l) => l.replace(/^ {1,4}|^\t/, '')).join('\n'), { lineOffset: item.line + 1 }) : '';
    const done = item.done ? `<span class="done-date" title="Completed ${item.done}">✓ ${esc(dueInfo(item.done, today).label)}</span>` : '';
    return `<li class="task-item todo-item${item.checked ? ' checked' : ''}"><div class="todo-row">`
        + `<input type="checkbox" class="task" data-line="${item.line}"${item.checked ? ' checked' : ''}> `
        + `<span class="todo-text">${md.renderInline(item.text)}</span>${dueChip(item, item.line, today)}${done}</div>${extra}</li>`;
}

/** HTML for one to-do block (docs/todo.md); data-line attributes point into the body. */
function renderTodo(block, today) {
    const sort = block.options.sort === 'due';
    let html = `<div class="todo-block" data-todo-line="${block.start}">`
        + `<div class="todo-head"><button type="button" class="todo-sort" data-todo-sort="${sort ? 'manual' : 'due'}" data-line="${block.start}" `
        + `title="Change the order">${sort ? 'By due date' : 'Manual order'}</button></div>`
        + `<ul class="todo-list">${block.open.map((it) => todoItem(it, today)).join('')}</ul>`
        + `<input type="text" class="todo-new" data-todo-add="${block.start}" placeholder="Add item" aria-label="Add item" enterkeyhint="done">`;
    if (block.done.length) {
        html += `<details class="todo-done" data-done-line="${block.start}"><summary>Done (${block.done.length})</summary>`
            + `<ul class="todo-list">${block.done.map((it) => todoItem(it, today)).join('')}</ul></details>`;
    }
    return html + '</div>\n';
}

/** Renders the body, with to-do blocks drawn by renderTodo and the rest by markdown-it. */
function renderWithTodos(body, today = localToday()) {
    const blocks = findBlocks(body);
    if (!blocks.length) return md.render(body);
    const lines = body.split('\n');
    let html = '';
    let at = 0;
    for (const b of blocks) {
        if (b.start > at) html += md.render(lines.slice(at, b.start).join('\n'), { lineOffset: at });
        html += renderTodo(b, today);
        at = b.end;
    }
    if (at < lines.length) html += md.render(lines.slice(at).join('\n'), { lineOffset: at });
    return html;
}

let hooked = false;

export function renderMarkdown(body) {
    if (!hooked && typeof window !== 'undefined') {
        DOMPurify.addHook('afterSanitizeAttributes', (node) => {
            if (node.tagName === 'A') {
                const href = node.getAttribute('href') ?? '';
                if (/^[a-z][a-z0-9+.-]*:/i.test(href)) {
                    node.setAttribute('target', '_blank');
                    node.setAttribute('rel', 'noopener noreferrer');
                } else {
                    node.setAttribute('data-note-link', href);
                }
            }
        });
        hooked = true;
    }
    return DOMPurify.sanitize(renderWithTodos(body), { ADD_ATTR: ['data-line', 'target', 'data-src', 'data-tex', 'loading'], FORBID_TAGS: ['style', 'form'] });
}

/** Toggle the checkbox of the list item starting at a body line. */
export function toggleTask(body, line, checked) {
    const lines = body.split('\n');
    if (line < 0 || line >= lines.length) return body;
    lines[line] = lines[line].replace(/^(\s*(?:[-*+]|\d+[.)])\s+)\[[ xX]\]/, `$1[${checked ? 'x' : ' '}]`);
    return lines.join('\n');
}

/** Unsanitized HTML, for tests. */
export function renderUnsafeForTests(body) {
    return renderWithTodos(body, '2026-11-25');
}
