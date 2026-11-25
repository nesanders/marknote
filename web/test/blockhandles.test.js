import assert from 'node:assert/strict';
import test from 'node:test';
import { EditorState } from '@codemirror/state';
import { ensureSyntaxTree } from '@codemirror/language';
import { markdown, markdownLanguage } from '@codemirror/lang-markdown';
import { blocksOf, moveChanges } from '../src/ui/blockhandles.js';

function setup(text) {
    const state = EditorState.create({ doc: text, extensions: [markdown({ base: markdownLanguage })] });
    ensureSyntaxTree(state, state.doc.length, 5000);
    return { state, blocks: blocksOf(state) };
}

function moved(text, srcIndex, targetIndex, before) {
    const { state, blocks } = setup(text);
    const m = moveChanges(state, blocks[srcIndex], blocks[targetIndex], before);
    if (!m) return null;
    const out = state.update({ changes: m.changes, selection: { anchor: m.cursor } }).state;
    return { text: out.doc.toString(), cursorLine: out.doc.lineAt(m.cursor).text };
}

const doc = '# Title\n\nFirst paragraph.\n\n- [ ] one\n- [ ] two\n  - [ ] two-a\n- [ ] three\n\nLast paragraph.';

test('blocks: headings, paragraphs, list items with their sub-items', () => {
    const { blocks, state } = setup(doc);
    const texts = blocks.map((b) => state.sliceDoc(b.from, b.to));
    assert.deepEqual(texts, ['# Title', 'First paragraph.', '- [ ] one', '- [ ] two\n  - [ ] two-a', '  - [ ] two-a', '- [ ] three', 'Last paragraph.']);
    assert.deepEqual(blocks.map((b) => b.depth), [0, 0, 0, 0, 1, 0, 0]);
});

test('reorder list items, sub-items move with their parent', () => {
    const r = moved(doc, 3, 2, true); // "two" (with two-a) above "one"
    assert.equal(r.text, '# Title\n\nFirst paragraph.\n\n- [ ] two\n  - [ ] two-a\n- [ ] one\n- [ ] three\n\nLast paragraph.');
    assert.equal(r.cursorLine, '- [ ] two');
    const down = moved(doc, 2, 5, false); // "one" below "three"
    assert.equal(down.text, '# Title\n\nFirst paragraph.\n\n- [ ] two\n  - [ ] two-a\n- [ ] three\n- [ ] one\n\nLast paragraph.');
});

test('paragraphs keep one blank line around them', () => {
    const r = moved(doc, 6, 1, true); // last paragraph above the first
    assert.equal(r.text, '# Title\n\nLast paragraph.\n\nFirst paragraph.\n\n- [ ] one\n- [ ] two\n  - [ ] two-a\n- [ ] three');
    const r2 = moved(doc, 1, 6, false); // first paragraph to the end
    assert.equal(r2.text, '# Title\n\n- [ ] one\n- [ ] two\n  - [ ] two-a\n- [ ] three\n\nLast paragraph.\n\nFirst paragraph.');
    const r3 = moved(doc, 0, 1, false); // heading below the paragraph
    assert.equal(r3.text, 'First paragraph.\n\n# Title\n\n- [ ] one\n- [ ] two\n  - [ ] two-a\n- [ ] three\n\nLast paragraph.');
});

test('a nested item moved to the top level is out-dented; nothing for a no-op', () => {
    const r = moved(doc, 4, 2, true); // "two-a" above "one"
    assert.equal(r.text, '# Title\n\nFirst paragraph.\n\n- [ ] two-a\n- [ ] one\n- [ ] two\n- [ ] three\n\nLast paragraph.');
    assert.equal(moved(doc, 2, 3, true), null); // "one" above "two": already there
    assert.equal(moved(doc, 3, 4, true), null); // into itself
});
