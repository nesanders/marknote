import assert from 'node:assert/strict';
import test from 'node:test';
import * as FM from '../src/frontmatter.js';

test('split and join round-trip', () => {
    const text = '---\nid: X\ntags: [a, b]\n---\n\n# Title\n\nBody\n';
    const s = FM.split(text);
    assert.equal(s.present, true);
    assert.equal(s.raw, 'id: X\ntags: [a, b]');
    assert.equal(s.body, '# Title\n\nBody\n');
    assert.equal(FM.join(s.raw, s.body), text);
});

test('no front matter without a closing delimiter', () => {
    const s = FM.split('---\nnot closed\n# Hi');
    assert.equal(s.present, false);
    assert.equal(s.body, '---\nnot closed\n# Hi');
});

test('values: flow lists, block lists, quotes, comments', () => {
    const raw = 'tags: ["a, b", \'c\', d]\nlist:\n  - one\n  - "two"\nicon: "🎨"\nplain: hello # comment\nesc: "say \\"hi\\""';
    assert.deepEqual(FM.value(raw, 'tags'), ['a, b', 'c', 'd']);
    assert.deepEqual(FM.value(raw, 'list'), ['one', 'two']);
    assert.equal(FM.value(raw, 'icon'), '🎨');
    assert.equal(FM.value(raw, 'plain'), 'hello');
    assert.equal(FM.value(raw, 'esc'), 'say "hi"');
    assert.equal(FM.value(raw, 'missing'), undefined);
});

test('setValue keeps other lines and quotes like the desktop app', () => {
    let raw = 'id: X\naliases:\n  - foo\nobsidian: keep';
    raw = FM.setValue(raw, 'tags', ['design', 'two words', 'yes']);
    raw = FM.setValue(raw, 'icon', '🎨');
    assert.equal(raw, 'id: X\naliases:\n  - foo\nobsidian: keep\ntags: [design, two words, "yes"]\nicon: "🎨"');
    raw = FM.setValue(raw, 'aliases', ['bar']);
    assert.match(raw, /^id: X\naliases: \[bar\]\nobsidian: keep/);
    raw = FM.setValue(raw, 'icon', '');
    assert.ok(!raw.includes('icon'));
});

test('parse: tags from strings, # prefixes, dates', () => {
    const m = FM.parse('id: A\ncreated: 2026-11-20T09:12:00\ntags: "#kde, reference kde"\ntitle: Visible');
    assert.deepEqual(m.tags, ['kde', 'reference']);
    assert.equal(m.created.getFullYear(), 2026);
    assert.equal(m.created.getHours(), 9);
    assert.equal(m.title, 'Visible');
    assert.equal(FM.parse('created: 2026-01-02').created.getDate(), 2);
});

test('ids are sortable ULIDs; initial block has id and created', () => {
    const a = FM.newId(1000);
    const b = FM.newId(2000);
    assert.equal(a.length, 26);
    assert.ok(a < b);
    const raw = FM.initialRaw(new Date(2026, 10, 24, 9, 5, 7));
    assert.match(raw, /^id: [0-9A-Z]{26}\ncreated: 2026-11-24T09:05:07$/);
});

test('tag normalization matches the desktop app', () => {
    assert.equal(FM.normalizeTag('  ##two words, x '), 'two-words-x');
});
