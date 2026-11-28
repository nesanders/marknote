// SPDX-FileCopyrightText: 2026 Marknote fork contributors
// SPDX-License-Identifier: GPL-2.0-only OR GPL-3.0-only OR LicenseRef-KDE-Accepted-GPL

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseAttachment, attachmentMarkdown, formatSize, fileKind } from '../src/attachments.js';
import { freeName } from '../src/library.js';
import { renderUnsafeForTests } from '../src/markdown.js';

test('which paragraphs are attachments', () => {
    assert.deepEqual(parseAttachment('[📎 Itinerary.pdf](Itinerary.pdf)'), { name: 'Itinerary.pdf', href: 'Itinerary.pdf' });
    assert.deepEqual(parseAttachment('[📎My file.pdf](My%20file.pdf)'), { name: 'My file.pdf', href: 'My%20file.pdf' });
    assert.deepEqual(parseAttachment('[📎 Report (2).pdf](<Report (2).pdf>)'), { name: 'Report (2).pdf', href: 'Report (2).pdf' });
    assert.deepEqual(parseAttachment('[📎](sub/a.zip)'), { name: 'a.zip', href: 'sub/a.zip' });
    assert.equal(parseAttachment('[Itinerary.pdf](Itinerary.pdf)'), null); // no paperclip
    assert.equal(parseAttachment('[📎 Site](https://example.com/a.pdf)'), null); // a web link
    assert.equal(parseAttachment('[📎 Other note](Other%20note.md)'), null); // a note
    assert.equal(parseAttachment('See [📎 a.pdf](a.pdf) here'), null); // not alone
    assert.equal(parseAttachment('[📎 x](/etc/passwd)'), null);
});

test('the Markdown written for an attachment', () => {
    assert.equal(attachmentMarkdown('Itinerary.pdf', 'Itinerary.pdf'), '[📎 Itinerary.pdf](Itinerary.pdf)');
    assert.equal(attachmentMarkdown('Report (2).pdf', 'Report%20(2).pdf'), '[📎 Report (2).pdf](<Report%20(2).pdf>)');
    assert.deepEqual(parseAttachment(attachmentMarkdown('Report (2).pdf', 'Report%20(2).pdf')), { name: 'Report (2).pdf', href: 'Report%20(2).pdf' });
});

test('free names and sizes', () => {
    const taken = new Set(['Report.pdf', 'Report (2).pdf', 'README']);
    assert.equal(freeName('Report.pdf', (n) => taken.has(n)), 'Report (3).pdf');
    assert.equal(freeName('README', (n) => taken.has(n)), 'README (2)');
    assert.equal(freeName('new.txt', (n) => taken.has(n)), 'new.txt');
    assert.equal(formatSize(512), '512 B');
    assert.equal(formatSize(48 * 1024 + 50), '48 KB');
    assert.equal(formatSize(3.5 * 1024 * 1024), '3.5 MB');
    assert.deepEqual(fileKind('a.PDF'), ['📕', 'PDF']);
    assert.deepEqual(fileKind('a.weird'), ['📎', 'File']);
});

test('rendered as a card placeholder', () => {
    const html = renderUnsafeForTests('Intro\n\n[📎 Itinerary.pdf](Itinerary.pdf)\n\n- [📎 in a list](x.pdf)\n');
    assert.match(html, /<div class="attachment" data-attachment="Itinerary.pdf" data-name="Itinerary.pdf" data-line="2">/);
    assert.match(html, /<li>.*<a href="x.pdf">📎 in a list<\/a>/s);
});

test('attachments stay inside the note folder', () => {
    assert.equal(parseAttachment('[📎 x](%2Fetc%2Fpasswd)'), null);
    assert.equal(parseAttachment('[📎 x](../../.ssh/id_rsa)'), null);
    assert.equal(parseAttachment('[📎 x](%2e%2e/secret.txt)'), null);
    assert.equal(parseAttachment('[📎 x](C:%5Cwin.ini)'), null);
    assert.ok(parseAttachment('[📎 x](sub/ok.pdf)'));
    assert.equal(attachmentMarkdown('back\\slash[1]', 'a.pdf'), '[📎 backslash1](a.pdf)');
});

test('names with # ? : % are written and found again', async () => {
    const { encodeLinkPath, resolveAssetPath } = await import('../src/library.js');
    const files = new Map([['Invoice #12.pdf', {}], ['what?.pdf', {}], ['a:b.pdf', {}], ['100%.pdf', {}]]);
    for (const name of files.keys()) {
        const link = encodeLinkPath(name);
        assert.ok(parseAttachment(`[📎 ${name}](${link})`), link);
        assert.deepEqual(resolveAssetPath(link, 'Note.md', 'NB', files), { path: name });
    }
});
