// SPDX-FileCopyrightText: 2026 Marknote fork contributors
// SPDX-License-Identifier: GPL-2.0-only OR GPL-3.0-only OR LicenseRef-KDE-Accepted-GPL

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { EditorState, EditorSelection } from '@codemirror/state';
import { applyBlockType, insertBlockBelow } from '../src/ui/slash.js';

/** A stand-in for EditorView: enough for the block menu functions. */
function fakeView(doc, anchor, head = anchor) {
    const view = {
        state: EditorState.create({ doc, selection: EditorSelection.single(anchor, head) }),
        dispatch(spec) {
            view.state = view.state.update(spec).state;
        },
        focus() {},
    };
    return view;
}
const text = (v) => v.state.doc.toString();
const cursor = (v) => {
    const s = text(v);
    const h = v.state.selection.main.head;
    return s.slice(0, h) + '|' + s.slice(h);
};

test('a block type on a bottom-up multi-line selection keeps the selection', () => {
    const v = fakeView('# a\n# b', 7, 0);
    applyBlockType(v, 'Text');
    assert.equal(text(v), 'a\nb');
    assert.equal(v.state.selection.main.from, 0);
    assert.equal(v.state.selection.main.to, 3);
});

test('list types keep the indent; others drop it and replace any prefix', () => {
    let v = fakeView('  - nested', 5);
    applyBlockType(v, 'Numbered list');
    assert.equal(text(v), '  1. nested');
    v = fakeView('  - nested', 5);
    applyBlockType(v, 'Heading 1');
    assert.equal(text(v), '# nested');
    v = fakeView('1. [ ] task', 3);
    applyBlockType(v, 'Checklist');
    assert.equal(text(v), '- [ ] task');
});

test('To-do list on an empty line leaves room to type', () => {
    const v = fakeView('', 0);
    applyBlockType(v, 'To-do list');
    assert.equal(cursor(v), '<!-- marknote-todo -->\n- [ ] |');
});

test('a divider under a paragraph does not turn it into a heading', () => {
    const v = fakeView('para\n', 5);
    applyBlockType(v, 'Divider');
    assert.equal(text(v), 'para\n\n---\n');
});

test('blocks are inserted after the paragraph, list or to-do block, not inside it', () => {
    let v = fakeView('one\ntwo\n\nnext', 1);
    insertBlockBelow(v, 'X');
    assert.equal(text(v), 'one\ntwo\n\nX\n\nnext');
    assert.equal(v.state.selection.main.head, 1); // the cursor stays put
    v = fakeView('<!-- marknote-todo -->\n- [ ] a\n- [ ] b\n- [ ] c', 25);
    insertBlockBelow(v, '[📎 f.pdf](f.pdf)');
    assert.equal(text(v), '<!-- marknote-todo -->\n- [ ] a\n- [ ] b\n- [ ] c\n\n[📎 f.pdf](f.pdf)');
    // On an empty line right under a paragraph: a blank line first.
    v = fakeView('Hello\n', 6);
    insertBlockBelow(v, '[📎 a.pdf](a.pdf)');
    assert.equal(text(v), 'Hello\n\n[📎 a.pdf](a.pdf)');
    // Several in a row go in order, each after the previous one.
    v = fakeView('Text', 2);
    const end = insertBlockBelow(v, 'A');
    insertBlockBelow(v, 'B', end);
    assert.equal(text(v), 'Text\n\nA\n\nB');
});
