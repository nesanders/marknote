// SPDX-FileCopyrightText: 2026 Marknote fork contributors
// SPDX-License-Identifier: GPL-2.0-only OR GPL-3.0-only OR LicenseRef-KDE-Accepted-GPL

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { Text } from '@codemirror/state';
import { continueAtEnd } from '../src/ui/endclick.js';

const apply = (s) => {
    const doc = Text.of(s.split('\n'));
    const { changes, cursor } = continueAtEnd(doc);
    const out = changes ? s.slice(0, changes.from) + changes.insert + s.slice(changes.from) : s;
    return out.slice(0, cursor) + '|' + out.slice(cursor);
};

test('a click below the text starts a separate paragraph', () => {
    assert.equal(apply('- [ ] Hat'), '- [ ] Hat\n\n|');
    assert.equal(apply('- [ ] Hat\n'), '- [ ] Hat\n\n|');
    assert.equal(apply('Text\n\n'), 'Text\n\n|');
    assert.equal(apply(''), '|');
    assert.equal(apply('```\ncode\n```\n'), '```\ncode\n```\n\n|');
});
