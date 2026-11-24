// SPDX-FileCopyrightText: 2026 Marknote fork contributors
// SPDX-License-Identifier: GPL-2.0-only OR GPL-3.0-only OR LicenseRef-KDE-Accepted-GPL
//
// Markdown to safe HTML. Raw HTML in notes is not rendered, output is
// sanitized, and "- [ ]" items become checkboxes that know their source line.

import MarkdownIt from 'markdown-it';
import DOMPurify from 'dompurify';

const md = new MarkdownIt({ html: false, linkify: true, typographer: false, breaks: false });

md.core.ruler.after('inline', 'marknote_tasks', (state) => {
    const tokens = state.tokens;
    for (let i = 2; i < tokens.length; ++i) {
        const t = tokens[i];
        if (t.type !== 'inline' || tokens[i - 1].type !== 'paragraph_open' || tokens[i - 2].type !== 'list_item_open') continue;
        const m = /^\[([ xX])\][ \t]/.exec(t.content);
        if (!m || !t.children?.length || t.children[0].type !== 'text') continue;
        t.children[0].content = t.children[0].content.replace(/^\[[ xX]\][ \t]/, '');
        const box = new state.Token('html_inline', '', 0);
        const line = tokens[i - 2].map ? tokens[i - 2].map[0] : -1;
        box.content = `<input type="checkbox" class="task" data-line="${line}"${m[1] === ' ' ? '' : ' checked'}> `;
        t.children.unshift(box);
        tokens[i - 2].attrJoin('class', 'task-item');
    }
});

// html: false escapes raw HTML, but our own checkbox tokens must pass through.
md.renderer.rules.html_inline = (tokens, idx) => tokens[idx].content;

md.renderer.rules.fence = (tokens, idx) => {
    const t = tokens[idx];
    const lang = (t.info || '').trim().split(/\s+/)[0];
    const label = lang ? `<span class="code-lang">${md.utils.escapeHtml(lang)}</span>` : '';
    return `<pre class="code">${label}<code>${md.utils.escapeHtml(t.content)}</code></pre>\n`;
};

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
    return DOMPurify.sanitize(md.render(body), { ADD_ATTR: ['data-line', 'target'], FORBID_TAGS: ['style', 'form'] });
}

/** Toggle the checkbox of the list item starting at a body line. */
export function toggleTask(body, line, checked) {
    const lines = body.split('\n');
    if (line < 0 || line >= lines.length) return body;
    lines[line] = lines[line].replace(/^(\s*(?:[-*+]|\d+[.)])\s+)\[[ xX]\]/, `$1[${checked ? 'x' : ' '}]`);
    return lines.join('\n');
}
