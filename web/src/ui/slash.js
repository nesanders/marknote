// SPDX-FileCopyrightText: 2026 Marknote fork contributors
// SPDX-License-Identifier: GPL-2.0-only OR GPL-3.0-only OR LicenseRef-KDE-Accepted-GPL
//
// "/" at the start of a line offers blocks to insert, like the desktop app's
// slash menu, each with its Markdown shortcut as a hint.

/** [label, section, markdown hint, text to insert ("|" marks the cursor)] */
const BLOCKS = [
    ['Text', 'Text', '', '|'],
    ['Heading 1', 'Text', '#', '# |'],
    ['Heading 2', 'Text', '##', '## |'],
    ['Heading 3', 'Text', '###', '### |'],
    ['Quote', 'Text', '>', '> |'],
    ['Bulleted list', 'Lists', '-', '- |'],
    ['Numbered list', 'Lists', '1.', '1. |'],
    ['Checklist', 'Lists', '- [ ]', '- [ ] |'],
    ['To-do list', 'Lists', 'with Done', '<!-- marknote-todo -->\n- [ ] |'],
    ['Code block', 'Blocks', '```', '```\n|\n```'],
    ['Table', 'Blocks', '|', '| Column | Column |\n| --- | --- |\n| | |'],
    ['Divider', 'Blocks', '---', '---\n|'],
    ['Math', 'Blocks', '$$', '$$\n|\n$$'],
    ['Diagram (Mermaid)', 'Blocks', '```mermaid', '```mermaid\ngraph TD\n    A[Start] --> B[Next]|\n```'],
    ['Image…', 'Blocks', '![]()', null],
];

const SECTIONS = Object.fromEntries(['Text', 'Lists', 'Blocks'].map((name, rank) => [name, { name, rank }]));
const KEYWORDS = { 'To-do list': 'todo task done due', Checklist: 'task todo checkbox', Divider: 'hr rule line', 'Diagram (Mermaid)': 'chart graph flow', Math: 'latex equation tex' };

export function slashSource(onImage) {
    return (context) => {
        const line = context.state.doc.lineAt(context.pos);
        const before = context.state.sliceDoc(line.from, context.pos);
        const m = /^(\s*(?:>\s?)*)\/([\w -]*)$/.exec(before); // also inside quotes
        if (!m) return null;
        // Options are matched against the word after "/"; applying also removes the "/".
        const from = line.from + m[1].length + 1;
        // Own matching, so "todo", "to-do" and "task" all find the to-do block.
        const norm = (t) => t.toLowerCase().replace(/[^a-z0-9]/g, '');
        const query = norm(m[2]);
        // 3: the name starts with it, 2: name or keywords contain it, 1: its letters in order.
        const score = (label) => {
            if (!query || norm(label).startsWith(query)) return 3;
            if (norm(label + ' ' + (KEYWORDS[label] ?? '')).includes(query)) return 2;
            return norm(label).split('').reduce((at, c) => (at < query.length && c === query[at] ? at + 1 : at), 0) === query.length ? 1 : 0;
        };
        const found = BLOCKS.map((b, i) => [b, score(b[0]), i]).filter(([, sc]) => sc > 0)
            .sort((a, b) => b[1] - a[1] || a[2] - b[2]).map(([b]) => b);
        return {
            from,
            filter: false,
            options: found.map(([label, section, hint, insert], i) => ({
                label,
                detail: hint,
                section: SECTIONS[section],
                boost: -i,
                apply: (view, _completion, afterSlash, applyTo) => {
                    const applyFrom = afterSlash - 1;
                    if (insert === null) {
                        view.dispatch({ changes: { from: applyFrom, to: applyTo, insert: '' } });
                        onImage?.();
                        return;
                    }
                    const at = insert.indexOf('|');
                    const text = insert.replace('|', '');
                    view.dispatch({ changes: { from: applyFrom, to: applyTo, insert: text }, selection: { anchor: applyFrom + at } });
                },
            })),
        };
    };
}
