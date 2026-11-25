// SPDX-FileCopyrightText: 2026 Marknote fork contributors
// SPDX-License-Identifier: GPL-2.0-only OR GPL-3.0-only OR LicenseRef-KDE-Accepted-GPL
//
// "/" at the start of a line offers blocks to insert, like the desktop app's
// slash menu, each with its Markdown shortcut as a hint.

import * as Todo from '../todo.js';
import { dispatchBody } from './todoedit.js';

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
    ['File…', 'Blocks', '📎', null],
];

const SECTIONS = Object.fromEntries(['Text', 'Lists', 'Blocks'].map((name, rank) => [name, { name, rank }]));
const KEYWORDS = { 'File…': 'attach attachment upload pdf document download', 'To-do list': 'todo task done due', Checklist: 'task todo checkbox', Divider: 'hr rule line', 'Diagram (Mermaid)': 'chart graph flow', Math: 'latex equation tex' };

export function slashSource(onImage, onFile) {
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
                        (label === 'File…' ? onFile : onImage)?.();
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

// ---- The toolbar's block menu ------------------------------------------------

/** Line-prefix blocks: picking one turns the selected lines into it. */
const PREFIX = { Text: '', 'Heading 1': '# ', 'Heading 2': '## ', 'Heading 3': '### ', Quote: '> ', 'Bulleted list': '- ', 'Numbered list': '1. ', Checklist: '- [ ] ', 'To-do list': '- [ ] ' };
const ANY_PREFIX = /^(#{1,6} |[-*+] \[[ xX]\] |[-*+] |\d+[.)] |> )?/;

/** Blocks for the toolbar menu: [{label, section, hint}], in slash-menu order. */
export const blockTypes = BLOCKS.map(([label, section, hint]) => ({ label, section, hint: label === 'To-do list' ? '' : hint }));

/** The block type of the line with the cursor (for the menu's tick). */
export function currentBlockType(state) {
    const line = state.doc.lineAt(state.selection.main.head);
    const text = line.text;
    if (/^#{1} /.test(text)) return 'Heading 1';
    if (/^#{2} /.test(text)) return 'Heading 2';
    if (/^#{3} /.test(text)) return 'Heading 3';
    if (/^> /.test(text)) return 'Quote';
    if (/^\s*[-*+] \[[ xX]\] /.test(text)) {
        return Todo.locate(state.doc.toString(), line.number - 1) ? 'To-do list' : 'Checklist';
    }
    if (/^\s*[-*+] /.test(text)) return 'Bulleted list';
    if (/^\s*\d+[.)] /.test(text)) return 'Numbered list';
    return text.trim() ? 'Text' : null;
}

/**
 * Applies a block type from the toolbar: text-like blocks convert the
 * selected lines (a checklist becomes a to-do block); the others are
 * inserted on a new line below, or in place of an empty line.
 */
export function applyBlockType(view, label, onImage, onFile) {
    const { state } = view;
    const sel = state.selection.main;
    const first = state.doc.lineAt(sel.from);
    const last = state.doc.lineAt(sel.to);
    if (label in PREFIX) {
        const body = state.doc.toString();
        if (label === 'To-do list' && Todo.locate(body, first.number - 1)) return view.focus();
        const prefix = PREFIX[label];
        const changes = [];
        for (let n = first.number; n <= last.number; ++n) {
            const line = state.doc.line(n);
            if (!line.text.trim() && first.number !== last.number) continue;
            const old = line.text.match(ANY_PREFIX)[0];
            changes.push({ from: line.from, to: line.from + old.length, insert: prefix });
        }
        view.dispatch({ changes, selection: { anchor: changes.length === 1 ? first.from + prefix.length + (first.text.length - first.text.match(ANY_PREFIX)[0].length) : sel.anchor } });
        if (label === 'To-do list') {
            const made = Todo.makeBlock(view.state.doc.toString(), view.state.doc.lineAt(view.state.selection.main.head).number - 1);
            if (made !== null) dispatchBody(view, made);
        }
        return view.focus();
    }
    const insert = BLOCKS.find(([l]) => l === label)?.[3];
    if (insert === null) return (label === 'File…' ? onFile : onImage)?.();
    if (insert === undefined) return undefined;
    const at = insert.indexOf('|');
    const text = insert.replace('|', '');
    if (!last.text.trim()) {
        view.dispatch({ changes: { from: last.from, to: last.to, insert: text }, selection: { anchor: last.from + at } });
    } else {
        const pre = '\n\n';
        view.dispatch({ changes: { from: last.to, insert: pre + text }, selection: { anchor: last.to + pre.length + at } });
    }
    return view.focus();
}

/**
 * Inserts `text` as its own paragraph below the cursor's line (or in place of
 * an empty line). The cursor stays off the new line, so a block shown as a
 * card (an attachment) is shown at once.
 */
export function insertBlockBelow(view, text) {
    const { state } = view;
    const line = state.doc.lineAt(state.selection.main.head);
    if (!line.text.trim()) {
        const insert = `${text}\n\n`;
        view.dispatch({ changes: { from: line.from, to: line.to, insert }, selection: { anchor: line.from + insert.length } });
    } else {
        view.dispatch({ changes: { from: line.to, insert: `\n\n${text}` }, selection: { anchor: line.to } });
    }
    view.focus();
}
