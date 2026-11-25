// SPDX-FileCopyrightText: 2026 Marknote fork contributors
// SPDX-License-Identifier: GPL-2.0-only OR GPL-3.0-only OR LicenseRef-KDE-Accepted-GPL

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { apply, toggleLine, makeBlock, findBlocks, locate, dueInfo, addDays } from '../src/todo.js';

const fixtures = JSON.parse(readFileSync(new URL('../../src/autotests/data/todo.json', import.meta.url), 'utf8'));

for (const c of fixtures.cases) {
    test(`shared: ${c.name}`, () => {
        const { op } = c;
        let out;
        if (op.type === 'toggle') out = toggleLine(c.input, op.line, op.checked ?? !/\[[xX]\]/.test(c.input.split('\n')[op.line]), c.today);
        else if (op.type === 'make') out = makeBlock(c.input, op.line, c.today);
        else out = apply(c.input, op, c.today);
        assert.equal(out, c.expected);
    });
}

test('finds blocks with their line ranges', () => {
    const body = 'x\n<!-- marknote-todo sort=due -->\n- [ ] A\n\n<details>\n<summary>Done (1)</summary>\n\n- [x] B ✅ 2026-01-01\n\n</details>\ny';
    const [b] = findBlocks(body);
    assert.equal(b.start, 1);
    assert.equal(b.end, 10);
    assert.equal(b.options.sort, 'due');
    assert.equal(b.doneStart, 4);
    assert.deepEqual(b.done.map((i) => [i.text, i.done]), [['B', '2026-01-01']]);
    assert.equal(locate(body, 7).list, 'done');
    assert.equal(locate(body, 5).list, undefined);
    assert.equal(locate(body, 10), null);
});

test('an incomplete Done section is left alone', () => {
    const body = '<!-- marknote-todo -->\n- [ ] A\n\n<details>\nstuff';
    const [b] = findBlocks(body);
    assert.equal(b.end, 2);
    assert.equal(b.done.length, 0);
});

test('unknown marker options survive', () => {
    const out = apply('<!-- marknote-todo color=red -->\n- [ ] A', { type: 'sort', line: 0, sort: 'due' }, '2026-01-01');
    assert.equal(out.split('\n')[0], '<!-- marknote-todo sort=due color=red -->');
});

test('due labels', () => {
    assert.deepEqual(dueInfo('2026-11-25', '2026-11-25'), { label: 'Today', state: 'today' });
    assert.equal(dueInfo('2026-11-26', '2026-11-25').label, 'Tomorrow');
    assert.equal(dueInfo('2026-11-20', '2026-11-25').state, 'overdue');
    assert.equal(dueInfo('2026-12-20', '2026-11-25').state, '');
    assert.equal(addDays('2026-12-31', 1), '2027-01-01');
    assert.equal(addDays('2026-03-01', -1), '2026-02-28');
});

test('invalid operations', () => {
    assert.equal(apply('<!-- marknote-todo -->\n- [ ] A', { type: 'due', line: 1, date: 'soon' }), null);
    assert.equal(apply('- [ ] A', { type: 'toggle', line: 0 }), null);
    assert.equal(makeBlock('<!-- marknote-todo -->\n- [ ] A', 1), null);
    assert.equal(makeBlock('Just text', 0), null);
});
