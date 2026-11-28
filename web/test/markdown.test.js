import assert from 'node:assert/strict';
import test from 'node:test';
import { renderUnsafeForTests as render, toggleTask } from '../src/markdown.js';

test('inline and display math', () => {
    const tex = (html) => decodeURIComponent(/data-tex="([^"]*)"/.exec(html)[1]);
    assert.match(render('Euler: $e^{i\\pi}+1=0$ done'), /<span class="math" data-tex=/);
    assert.equal(tex(render('Euler: $e^{i\\pi}+1=0$ done')), 'e^{i\\pi}+1=0');
    assert.equal(tex(render('$$\na^2+b^2=c^2\n$$\n')), 'a^2+b^2=c^2');
    assert.match(render('$$\na^2\n$$\n'), /<div class="math display"/);
    assert.equal(tex(render('$$x = 1$$')), 'x = 1');
});

test('dollar amounts are not math', () => {
    assert.doesNotMatch(render('It costs $5 and $10 later.'), /class="math/);
    assert.doesNotMatch(render('A lone $ sign'), /class="math/);
    assert.doesNotMatch(render('`$x$` in code'), /class="math/);
});

test('mermaid fences become diagram blocks; other code stays code', () => {
    const html = render('```mermaid\ngraph TD; A-->B\n```\n');
    assert.equal(decodeURIComponent(/data-src="([^"]*)"/.exec(html)[1]), 'graph TD; A-->B\n');
    assert.doesNotMatch(/data-src="([^"]*)"/.exec(html)[1], /-->/, 'no "-->" in attributes (the sanitizer drops those)');
    assert.match(render('```js\nlet a\n```\n'), /<pre class="code"><span class="code-lang">js<\/span>/);
});

test('images are placeholders with the original link', () => {
    assert.match(render('![A sketch](Note_1.png "t")'), /<img data-src="Note_1.png" alt="A sketch" title="t" loading="lazy">/);
});

test('checklists know their line; toggling edits only that line', () => {
    const body = 'Intro\n\n- [ ] one\n- [x] two\n';
    assert.match(render(body), /data-line="2">/);
    assert.match(render(body), /data-line="3" checked>/);
    assert.equal(toggleTask(body, 2, true), 'Intro\n\n- [x] one\n- [x] two\n');
});

test('raw HTML is not rendered', () => {
    assert.doesNotMatch(render('<script>alert(1)</script>'), /<script>/);
});

test('desktop file:// image links are kept for resolving; script links are not', () => {
    assert.match(render('![](file:///home/me/Notes/P/a%20b.png)'), /<img data-src="file:\/\/\/home\/me\/Notes\/P\/a%20b.png"/);
    assert.doesNotMatch(render('[x](javascript:alert(1))'), /href="javascript/);
});

test('reference links work in notes with to-do blocks', async () => {
    const { renderUnsafeForTests } = await import('../src/markdown.js');
    const html = renderUnsafeForTests('[x]: https://example.com\n\n<!-- marknote-todo -->\n- [ ] see [x]\n\nmore [x]');
    assert.equal(html.match(/<a href="https:\/\/example.com">x<\/a>/g)?.length, 2);
});
