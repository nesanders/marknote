// SPDX-FileCopyrightText: 2026 Marknote fork contributors
// SPDX-License-Identifier: GPL-2.0-only OR GPL-3.0-only OR LicenseRef-KDE-Accepted-GPL
//
// Browser test of the built app (needs Playwright + Chromium):
//   npm run build && node build.mjs --serve &   then   node test/e2e.cjs [screenshot dir]
//
// 1. Demo mode on desktop and phone sizes.
// 2. Real mode: setup link, Google sign-in redirect (intercepted), and the
//    Drive client against a fake googleapis.com served from this test.

const { chromium, devices } = require('playwright');
const assert = require('node:assert/strict');
const path = require('node:path');

const BASE = process.env.MARKNOTE_URL || 'http://localhost:8080/';
const SHOTS = process.argv[2] || '';
const CLIENT = '123456789012-testclientidonly.apps.googleusercontent.com';

async function noteRows(page, expected) {
    const titles = await page.locator('.tree .row:not(.folder) .row-title').allTextContents();
    assert.equal(titles.length, expected, `visible notes: ${JSON.stringify(titles)}`);
}

async function shot(page, name) {
    if (SHOTS) await page.screenshot({ path: path.join(SHOTS, name + '.png') });
}

let lastPage = null;

function watch(page, errors) {
    lastPage = page;
    page.on('pageerror', (e) => errors.push(String(e)));
    page.on('console', (m) => m.type() === 'error' && !/favicon|ERR_FAILED/.test(m.text()) && errors.push(m.text()));
}

/** A tiny Google Drive v3 + userinfo fake, enough for drive.js. */
function fakeGoogle() {
    let next = 1;
    const nodes = new Map([['root', { id: 'root', name: 'root', mimeType: 'application/vnd.google-apps.folder', parents: [] }]]);
    const add = (parent, name, mimeType, content) => {
        const id = 'g' + next++;
        const now = new Date().toISOString();
        const n = { id, name, mimeType, parents: [parent], createdTime: now, modifiedTime: now, trashed: false };
        if (content !== undefined) {
            n.content = content;
            n.md5Checksum = require('node:crypto').createHash('md5').update(content).digest('hex');
        }
        nodes.set(id, n);
        return n;
    };
    const FOLDER = 'application/vnd.google-apps.folder';
    const root = add('root', 'Marknote', FOLDER);
    const nb = add(root.id, 'Work', FOLDER);
    add(nb.id, '.directory', 'text/plain', '[Desktop Entry]\nX-MarkNote-Color=#3a8a55\nX-Marknote-Emoji=💼\n');
    add(nb.id, 'Plan.md', 'text/markdown', '---\nid: 01ABC\ntags: [work]\n---\n\n# Plan\n\n- [ ] Ship the web app\n\n![chart](Plan_1.svg)\n');
    add(nb.id, 'Plan_1.svg', 'image/svg+xml', '<svg xmlns="http://www.w3.org/2000/svg" width="40" height="20"><rect width="40" height="20" fill="red"/></svg>');
    const view = ({ content, trashed, ...rest }) => rest;
    const requests = [];
    async function handle(route) {
        const req = route.request();
        const url = new URL(req.url());
        requests.push(`${req.method()} ${url.pathname}`);
        const auth = req.headers().authorization;
        if (auth !== 'Bearer test-token') return route.fulfill({ status: 401, body: '{}' });
        const json = (o, status = 200) => route.fulfill({ status, contentType: 'application/json', body: JSON.stringify(o) });
        const p = url.pathname;
        if (p === '/drive/v3/about') return json({ user: { emailAddress: 'me@example.com' } });
        if (p === '/drive/v3/files' && req.method() === 'GET') {
            const q = url.searchParams.get('q');
            const parent = /'([^']+)' in parents/.exec(q)[1];
            const name = /name = '([^']+)'/.exec(q)?.[1];
            const files = [...nodes.values()].filter((n) => !n.trashed && n.parents.includes(parent) && (!name || n.name === name) && (!q.includes('mimeType =') || n.mimeType === FOLDER));
            return json({ files: files.map(view) });
        }
        if (p === '/drive/v3/files' && req.method() === 'POST') {
            const body = JSON.parse(req.postData());
            return json(view(add(body.parents[0], body.name, body.mimeType)));
        }
        if (p === '/upload/drive/v3/files' && req.method() === 'POST') {
            const raw = req.postDataBuffer().toString('latin1');
            const parts = raw.split(/--marknote\d+/);
            const meta = JSON.parse(parts[1].split('\r\n\r\n')[1]);
            const content = parts[2].split('\r\n\r\n').slice(1).join('\r\n\r\n').replace(/\r\n$/, '');
            return json(view(add(meta.parents[0], meta.name, meta.mimeType, content)));
        }
        let m = /^\/upload\/drive\/v3\/files\/([^/]+)$/.exec(p);
        if (m && req.method() === 'PATCH') {
            const n = nodes.get(m[1]);
            n.content = req.postDataBuffer().toString('utf8');
            n.md5Checksum = require('node:crypto').createHash('md5').update(n.content).digest('hex');
            n.modifiedTime = new Date().toISOString();
            return json(view(n));
        }
        m = /^\/drive\/v3\/files\/([^/]+)$/.exec(p);
        if (m) {
            const n = nodes.get(m[1]);
            if (!n || n.trashed) return json({ error: { message: 'File not found' } }, 404);
            if (req.method() === 'GET') {
                if (url.searchParams.get('alt') === 'media') return route.fulfill({ status: 200, contentType: n.mimeType, body: n.content });
                return json(view(n));
            }
            if (req.method() === 'PATCH') {
                Object.assign(n, JSON.parse(req.postData() || '{}'));
                const addP = url.searchParams.get('addParents');
                if (addP) n.parents = n.parents.filter((x) => x !== url.searchParams.get('removeParents')).concat(addP);
                return json(view(n));
            }
        }
        return json({ error: { message: `unhandled ${req.method()} ${p}` } }, 500);
    }
    return { nodes, handle, requests, byName: (name) => [...nodes.values()].find((n) => n.name === name && !n.trashed) };
}

async function demoDesktop(browser, errors) {
    const page = await browser.newPage({ viewport: { width: 1360, height: 820 } });
    watch(page, errors);
    await page.goto(BASE + '?demo');
    await page.getByRole('button', { name: /Projects/ }).click();
    await page.getByText('Marknote overhaul').click();
    await page.getByText('Design notes').click();
    await page.waitForSelector('.rendered h1');
    assert.equal(await page.textContent('.note-title'), 'Design notes');
    assert.ok(await page.isVisible('.meta-strip >> text=design'));
    await shot(page, 'desktop-note');

    // Tick a checklist item; it is saved into the Markdown.
    const boxes = page.locator('.rendered input.task');
    assert.equal(await boxes.count(), 3);
    await boxes.nth(1).check();
    await page.waitForTimeout(400);
    await page.getByText('Feature list').click();
    await page.getByText('Design notes').click();
    assert.equal(await page.locator('.rendered input.task').nth(1).isChecked(), true);

    // Edit with the source editor; autosave.
    await page.getByRole('button', { name: 'Edit note' }).click();
    await page.waitForSelector('.cm-content');
    await page.click('.cm-content');
    await page.keyboard.press('Control+End');
    await page.keyboard.type('\nAdded from the browser test.');
    await page.waitForSelector('.save-status:text("Saved")', { timeout: 5000 });
    await shot(page, 'desktop-edit');
    await page.getByRole('button', { name: 'Done editing' }).click();
    assert.ok(await page.isVisible('.rendered >> text=Added from the browser test.'));

    // Tags dialog: add one, it shows in the strip and the sidebar.
    await page.getByRole('button', { name: /Edit/, exact: false }).filter({ hasText: 'Edit' }).last().click();
    await page.fill('input[placeholder="Add a tag"]', 'from-test');
    await page.keyboard.press('Enter');
    await page.getByRole('button', { name: 'Done' }).click();
    assert.ok(await page.isVisible('.meta-strip >> text=from-test'));
    assert.ok(await page.isVisible('.side-tags >> text=from-test'));

    // Icon picker.
    await page.click('.meta-button[title="Set icon"]');
    await page.fill('.picker-search input', 'rocket');
    await page.click('.emoji-cell');
    await page.waitForSelector('.meta-strip .emoji');

    // Filter: tag chip from the sidebar, then any/all.
    await page.click('.side-tag:has-text("reference")');
    await noteRows(page, 3);
    await page.click('.side-tag:has-text("kde")');
    await noteRows(page, 2);
    await page.click('button.toggle.small');
    await noteRows(page, 3);
    await shot(page, 'desktop-filter');
    await page.click('.filter-tags .chip:has-text("kde") button');
    await page.click('.filter-tags .chip:has-text("reference") button');

    // Contents search.
    await page.fill('.filter-input input', 'lentil');
    await noteRows(page, 0);
    await page.getByRole('button', { name: 'Contents' }).click();
    await page.fill('.filter-input input', 'dolphin');
    await noteRows(page, 2);
    await page.fill('.filter-input input', '');

    // New note, rename, move into a folder, delete.
    await page.getByRole('button', { name: 'New note', exact: true }).click();
    await page.fill('.dialog input', 'Browser note');
    await page.click('.dialog button.primary');
    await page.waitForSelector('.cm-content');
    assert.equal(await page.textContent('.note-title'), 'Browser note');
    await page.getByRole('button', { name: 'Done editing' }).click();
    await page.getByRole('button', { name: 'Note actions' }).click();
    await page.click('.sheet-item:has-text("Rename")');
    await page.fill('.dialog input', 'Renamed note');
    await page.click('.dialog button.primary');
    await page.waitForSelector('.note-title:text("Renamed note")');
    await page.getByRole('button', { name: 'Note actions' }).click();
    await page.click('.sheet-item:has-text("Move")');
    await page.click('.folder-choice:has-text("Reading")');
    await page.waitForSelector('.dialog', { state: 'detached' });
    await page.getByRole('button', { name: 'Note actions' }).click();
    await page.click('.sheet-item:has-text("Delete Note")');
    await page.click('.dialog button.danger');
    await page.waitForSelector('.note-panel.empty');
    assert.equal(await page.locator('.row:has-text("Renamed note")').count(), 0);
    await page.close();
}

async function demoRich(browser, errors) {
    const page = await browser.newPage({ viewport: { width: 1360, height: 900 } });
    watch(page, errors);
    await page.goto(BASE + '?demo');
    await page.getByRole('button', { name: /Projects/ }).click();
    await page.click('.row:has-text("Rich note")');
    // Reading: math, diagram, image, table.
    await page.waitForSelector('.rendered .katex', { timeout: 15000 });
    assert.equal(await page.locator('.rendered .katex').count(), 2);
    await page.waitForSelector('.rendered .mermaid-block svg', { timeout: 15000 });
    await page.waitForFunction(() => document.querySelector('.rendered img')?.src.startsWith('blob:'));
    assert.equal(await page.locator('.rendered table').count(), 1);
    await shot(page, 'rich-read');

    // Desktop-style absolute file:// image link resolves to the file in the notebook.
    await page.click('.row:has-text("Marknote overhaul")');
    await page.click('.row:has-text("Feature list")');
    await page.waitForFunction(() => document.querySelector('.rendered img')?.src.startsWith('blob:'));
    await page.click('.row:has-text("Rich note")');

    // Live preview: rendered widgets, markup hidden off the cursor line.
    await page.getByRole('button', { name: 'Edit note' }).click();
    await page.waitForSelector('.cm-rendered-math .katex');
    await page.waitForSelector('.cm-rendered-mermaid svg', { timeout: 15000 });
    await page.waitForSelector('.cm-rendered-image img[src^="blob:"]');
    await page.waitForSelector('.cm-rendered-table table');
    assert.equal(await page.locator('.cm-line:has-text("## Diagram")').count(), 0, 'heading marks hidden');
    await shot(page, 'rich-live');

    // Tick a checkbox widget: the Markdown changes.
    const before = await page.locator('input.cm-task').first().isChecked();
    await page.locator('input.cm-task').first().click();
    await page.waitForFunction((b) => document.querySelector('input.cm-task').checked !== b, before);

    // Click the math block: its source shows for editing.
    await page.locator('.cm-rendered-math.cm-rendered-block').click();
    await page.waitForSelector('.cm-line:has-text("\\int_0^1")');

    // Slash menu at the end of the note.
    await page.click('.cm-content');
    await page.keyboard.press('Control+End');
    await page.keyboard.type('\n/check');
    await page.waitForSelector('.cm-tooltip-autocomplete');
    await shot(page, 'rich-slash');
    await page.keyboard.press('Enter');
    await page.keyboard.type('Inserted from the slash menu');
    await page.getByRole('button', { name: 'Source' }).click();
    await page.waitForSelector('.cm-line:has-text("- [ ] Inserted from the slash menu")');
    assert.ok(await page.isVisible('.cm-line:has-text("$$")'), 'source mode shows the markup');
    await page.getByRole('button', { name: 'Source' }).click();

    // Add an image from a file: stored next to the note, linked relatively.
    const png = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8DwHwAFBQIAX8jx0gAAAABJRU5ErkJggg==', 'base64');
    await page.setInputFiles('input[type=file]', { name: 'dot.png', mimeType: 'image/png', buffer: png });
    await page.waitForSelector('.save-status:text("Saved")', { timeout: 8000 });
    await page.getByRole('button', { name: 'Source' }).click();
    await page.waitForSelector('.cm-line:has-text("![dot](Rich%20note_")');
    await page.getByRole('button', { name: 'Source' }).click();
    await page.getByRole('button', { name: 'Done editing' }).click();
    await page.waitForFunction(() => [...document.querySelectorAll('.rendered img')].filter((i) => i.src.startsWith('blob:')).length === 2);
    await page.close();
}

async function demoDrag(browser, errors) {
    // Mouse.
    const page = await browser.newPage({ viewport: { width: 1360, height: 820 } });
    watch(page, errors);
    await page.goto(BASE + '?demo');
    await page.getByRole('button', { name: /Projects/ }).click();
    const dragTo = async (from, to) => {
        const a = await page.locator(from).boundingBox();
        const b = await page.locator(to).boundingBox();
        await page.mouse.move(a.x + 60, a.y + a.height / 2);
        await page.mouse.down();
        await page.mouse.move(a.x + 80, a.y + a.height / 2 + 10, { steps: 3 });
        await page.mouse.move(b.x + 80, b.y + b.height / 2, { steps: 8 });
        await shot(page, 'drag-mouse');
        await page.mouse.up();
    };
    await dragTo('.row:has-text("Scratch")', '.row.folder:has-text("Reading")');
    await page.waitForSelector('.toast:has-text("Moved “Scratch” to “Reading”")');
    await page.click('.row.folder:has-text("Reading")'); // opened on drop; close and reopen to see
    await page.click('.row.folder:has-text("Reading")');
    const depth = await page.locator('.row:has-text("Scratch")').evaluate((el) => el.style.getPropertyValue('--depth'));
    assert.equal(depth, '1');
    // Back to the top level by dropping on empty space.
    const tree = await page.locator('.tree').boundingBox();
    const a = await page.locator('.row:has-text("Scratch")').boundingBox();
    await page.mouse.move(a.x + 60, a.y + a.height / 2);
    await page.mouse.down();
    await page.mouse.move(a.x + 70, a.y + 30, { steps: 3 });
    await page.mouse.move(tree.x + 100, tree.y + tree.height - 30, { steps: 8 });
    await page.mouse.up();
    await page.waitForSelector('.toast:has-text("to the top level")');
    // A plain click still opens the note (no drag).
    await page.click('.row:has-text("Weekly sync")');
    await page.waitForSelector('.note-title:text("Weekly sync")');
    await page.close();

    // Touch: hold, then drag.
    const ctx = await browser.newContext({ ...devices['Pixel 7'] });
    const phone = await ctx.newPage();
    watch(phone, errors);
    await phone.goto(BASE + '?demo');
    await phone.click('.notebook:has-text("Projects")');
    await phone.waitForSelector('.tree .row');
    const cdp = await ctx.newCDPSession(phone);
    const touch = (type, x, y) => cdp.send('Input.dispatchTouchEvent', { type, touchPoints: type === 'touchEnd' ? [] : [{ x, y }] });
    const s = await phone.locator('.row:has-text("Long checklist")').boundingBox();
    const t = await phone.locator('.row.folder:has-text("Reading")').boundingBox();
    await touch('touchStart', s.x + 80, s.y + s.height / 2);
    await phone.waitForTimeout(650);
    for (let i = 1; i <= 8; ++i) await touch('touchMove', s.x + 80, s.y + s.height / 2 + ((t.y + t.height / 2) - (s.y + s.height / 2)) * i / 8);
    await shot(phone, 'drag-touch');
    await touch('touchEnd', 0, 0);
    await phone.waitForSelector('.toast:has-text("Moved “Long checklist” to “Reading”")');
    // Hold and release without moving: the menu.
    const w = await phone.locator('.row:has-text("Weekly sync")').boundingBox();
    await touch('touchStart', w.x + 80, w.y + w.height / 2);
    await phone.waitForTimeout(650);
    await touch('touchEnd', 0, 0);
    await phone.waitForSelector('.sheet:has-text("Weekly sync")');
    await ctx.close();
}

async function demoPhone(browser, errors) {
    const ctx = await browser.newContext({ ...devices['Pixel 7'] });
    const page = await ctx.newPage();
    watch(page, errors);
    await page.goto(BASE + '?demo');
    await page.waitForSelector('.notebook');
    await shot(page, 'phone-notebooks');
    await page.click('.notebook:has-text("Projects")');
    await page.waitForSelector('.tree .row');
    await page.click('.row:has-text("Marknote overhaul")');
    await shot(page, 'phone-tree');
    await page.click('.row:has-text("Design notes")');
    await page.waitForSelector('.rendered h1');
    await shot(page, 'phone-note');
    await page.getByRole('button', { name: 'Edit note' }).click();
    await page.waitForSelector('.format-bar');
    await shot(page, 'phone-edit');
    await page.getByRole('button', { name: 'Done editing' }).click();
    // Long press opens the action sheet.
    await page.goBack();
    await page.waitForSelector('.tree');
    await page.dispatchEvent('.row:has-text("Feature list")', 'contextmenu');
    await page.waitForSelector('.sheet');
    await shot(page, 'phone-menu');
    await page.click('.sheet-cancel');
    await page.goBack();
    await page.waitForSelector('.notebook');
    await ctx.close();
}

async function demoBlockHandles(browser, errors) {
    const ctx = await browser.newContext({ ...devices['Pixel 7'] });
    const page = await ctx.newPage();
    watch(page, errors);
    await page.goto(BASE + '?demo');
    await page.click('.notebook:has-text("Projects")');
    await page.click('.row:has-text("Marknote overhaul")');
    await page.click('.row:has-text("Design notes")');
    await page.getByRole('button', { name: 'Edit note' }).click();
    await page.waitForSelector('.cm-content');
    const lineText = () => page.locator('.cm-line').allTextContents();
    // Put the cursor in the last checklist item: its grip appears.
    const item = page.locator('.cm-line', { hasText: 'Mobile layout' });
    const box = await item.boundingBox();
    await page.touchscreen.tap(box.x + box.width - 20, box.y + box.height / 2);
    await page.waitForSelector('.cm-block-grip.visible');
    await shot(page, 'phone-block-grip');
    // Drag it above the first checklist item, with real touch events (once the
    // grip has finished gliding to this block).
    let grip = await page.locator('.cm-block-grip').boundingBox();
    for (let i = 0; i < 20; ++i) {
        await page.waitForTimeout(60);
        const again = await page.locator('.cm-block-grip').boundingBox();
        if (again.y === grip.y && again.x === grip.x) break;
        grip = again;
    }
    const first = await page.locator('.cm-line', { hasText: 'Menu bar or hamburger' }).boundingBox();
    const cdp = await ctx.newCDPSession(page);
    const touch = (type, x, y) => cdp.send('Input.dispatchTouchEvent', { type, touchPoints: type === 'touchEnd' ? [] : [{ x, y }] });
    const gx = grip.x + grip.width / 2;
    let gy = grip.y + grip.height / 2;
    await touch('touchStart', gx, gy);
    for (let i = 1; i <= 12; ++i) {
        gy -= (grip.y + grip.height / 2 - (first.y + 3)) / 12;
        await touch('touchMove', gx, gy);
        await page.waitForTimeout(20);
    }
    await page.waitForSelector('.cm-block-drop-line.visible');
    await page.waitForSelector('.cm-block-ghost');
    await shot(page, 'phone-block-drag');
    await touch('touchEnd', gx, gy);
    await page.waitForTimeout(200);
    let lines = (await lineText()).filter((t) => /layout|hamburger|dense/.test(t));
    assert.match(lines[0], /Mobile layout/, JSON.stringify(lines));
    // Tap the grip: Move down puts it back one place.
    await page.waitForSelector('.cm-block-grip.visible');
    await page.waitForTimeout(300);
    await page.locator('.cm-block-grip').tap();
    await page.waitForSelector('.cm-block-menu');
    await shot(page, 'phone-block-menu');
    await page.locator('.cm-block-menu button', { hasText: 'Move down' }).tap();
    lines = (await lineText()).filter((t) => /layout|hamburger|dense/.test(t));
    assert.match(lines[1], /Mobile layout/, JSON.stringify(lines));
    await ctx.close();
}

async function demoTodo(browser, errors) {
    const ctx = await browser.newContext({ ...devices['Pixel 7'] });
    const page = await ctx.newPage();
    watch(page, errors);
    await page.goto(BASE + '?demo');
    await page.click('.notebook:has-text("Projects")');
    await page.click('.row:has-text("Trip to Lisbon")');
    await page.waitForSelector('.todo-block');
    const openItems = () => page.locator('.todo-block > .todo-list .todo-text').allTextContents();
    assert.deepEqual(await openItems(), ['Book flights', 'Renew passport', 'Find a place near Alfama', 'Pack charger']);
    assert.equal(await page.locator('.due-chip.overdue').count(), 1);
    assert.equal(await page.locator('.due-chip.today').count(), 1);
    assert.equal(await page.locator('details.todo-done').evaluate((d) => d.open), false);
    await shot(page, 'phone-todo');

    // Ticking moves the item to the top of Done, dated today.
    await page.locator('.todo-item:has-text("Book flights") input.task').tap();
    await page.waitForSelector('summary:has-text("Done (3)")');
    assert.deepEqual(await openItems(), ['Renew passport', 'Find a place near Alfama', 'Pack charger']);
    await page.locator('details.todo-done > summary').tap();
    const doneItems = () => page.locator('details.todo-done .todo-text').allTextContents();
    assert.deepEqual(await doneItems(), ['Book flights', 'Ask for time off', 'Pick dates']);
    assert.match(await page.locator('details.todo-done .todo-item').first().textContent(), /✓ Today/);
    await shot(page, 'phone-todo-done');

    // Unticking puts it back at the bottom; the Done section stays open.
    await page.locator('details.todo-done .todo-item:has-text("Book flights") input.task').tap();
    await page.waitForSelector('summary:has-text("Done (2)")');
    assert.deepEqual((await openItems()).at(-1), 'Book flights');
    assert.equal(await page.locator('details.todo-done').evaluate((d) => d.open), true);

    // A due date from the picker.
    await page.locator('.todo-item:has-text("Find a place") .due-add').tap();
    await page.waitForSelector('.due-picker');
    await shot(page, 'phone-todo-picker');
    await page.locator('.due-picker button', { hasText: 'Tomorrow' }).tap();
    await page.waitForSelector('.todo-item:has-text("Find a place") .due-chip:has-text("Tomorrow")');

    // Order by due date.
    await page.locator('.todo-sort').tap();
    await page.waitForSelector('.todo-sort:has-text("By due date")');
    assert.deepEqual(await openItems(), ['Book flights', 'Renew passport', 'Find a place near Alfama', 'Pack charger']);

    // Add an item from the rendered view.
    await page.locator('input.todo-new').tap();
    await page.keyboard.type('Buy a guidebook');
    await page.keyboard.press('Enter');
    await page.waitForSelector('.todo-text:has-text("Buy a guidebook")');
    assert.equal(await page.evaluate(() => document.activeElement?.className), 'todo-new');

    // The editor: header, fold, chips; ticking there moves the item too.
    await page.getByRole('button', { name: 'Edit note' }).click();
    await page.waitForSelector('.cm-todo-head');
    assert.equal(await page.locator('.cm-due.today').count(), 1);
    assert.equal(await page.locator('.cm-line:has-text("Ask for time off")').count(), 0);
    await page.locator('.cm-todo-done').tap();
    await page.waitForSelector('.cm-line:has-text("Ask for time off")');
    await shot(page, 'phone-todo-editor');
    await page.locator('.cm-line:has-text("Pack charger") input.cm-task').tap();
    await page.waitForSelector('.cm-todo-done:has-text("Done (3)")');
    const lines = (await page.locator('.cm-line').allTextContents()).map((t) => t.trim()).filter(Boolean);
    const doneAt = lines.findIndex((t) => /Pack charger/.test(t));
    assert.ok(doneAt > lines.findIndex((t) => /Buy a guidebook/.test(t)), JSON.stringify(lines));
    await ctx.close();
}

async function demoBlockMenu(browser, errors) {
    const ctx = await browser.newContext({ ...devices['Pixel 7'] });
    const page = await ctx.newPage();
    watch(page, errors);
    await page.goto(BASE + '?demo');
    await page.click('.notebook:has-text("Projects")');
    await page.click('.row:has-text("Scratch")');
    await page.getByRole('button', { name: 'Edit note' }).click();
    await page.waitForSelector('.cm-content');
    // The raw text, read from the Source view.
    const doc = async () => {
        await page.getByRole('button', { name: 'Source', exact: true }).click();
        await page.waitForSelector('.cm-source');
        const text = (await page.locator('.cm-line').allTextContents()).join('\n');
        await page.getByRole('button', { name: 'Source', exact: true }).click();
        await page.waitForSelector('.cm-live');
        return text;
    };
    // The cursor in the paragraph: To-do list turns it into a to-do block.
    const para = page.locator('.cm-line', { hasText: 'A plain note' });
    const box = await para.boundingBox();
    await page.touchscreen.tap(box.x + box.width - 10, box.y + box.height / 2);
    await page.getByRole('button', { name: 'Block type' }).tap();
    await page.waitForSelector('.block-menu');
    assert.equal(await page.locator('.block-menu button.on span').textContent(), 'Text');
    await shot(page, 'phone-block-menu-toolbar');
    await page.locator('.block-menu button', { hasText: 'To-do list' }).tap();
    assert.match(await doc(), /<!-- marknote-todo -->\n- \[ \] A plain note without front matter\./);
    await page.waitForSelector('.cm-todo-head');
    // Blocks that are not text go below the current line.
    await page.getByRole('button', { name: 'Block type' }).tap();
    await page.locator('.block-menu button', { hasText: 'Code block' }).tap();
    await page.keyboard.type('let x = 1;');
    assert.match(await doc(), /```\nlet x = 1;\n```/);
    // And headings convert the line in place.
    await page.locator('.cm-line', { hasText: 'Scratch' }).first().tap();
    await page.getByRole('button', { name: 'Block type' }).tap();
    assert.equal(await page.locator('.block-menu button.on span').textContent(), 'Heading 1');
    await page.locator('.block-menu button', { hasText: 'Heading 2' }).tap();
    assert.match(await doc(), /^## Scratch/);
    await ctx.close();
}

async function demoManualOrder(browser, errors) {
    const page = await browser.newPage({ viewport: { width: 1360, height: 820 } });
    watch(page, errors);
    await page.goto(BASE + '?demo');
    await page.evaluate(() => localStorage.setItem('marknote.settings', JSON.stringify({ sort: 'manual' })));
    await page.reload();
    await page.getByRole('button', { name: /Personal/ }).click();
    await page.waitForSelector('.tree .row');
    // A notebook with just two notes: put the second above the first.
    await page.click('.notebook-actions, .tree-panel .toolbar [aria-label="New note"]');
    await page.fill('.dialog input', 'Apples');
    await page.click('.dialog button.primary');
    await page.waitForSelector('.cm-content');
    await page.getByRole('button', { name: 'Done editing' }).click();
    const titles = () => page.locator('.tree .row .row-title').allTextContents();
    assert.deepEqual(await titles(), ['Apples', 'Recipes']);
    const a = await page.locator('.row:has-text("Recipes")').boundingBox();
    const b = await page.locator('.row:has-text("Apples")').boundingBox();
    await page.mouse.move(a.x + 60, a.y + a.height / 2);
    await page.mouse.down();
    await page.mouse.move(a.x + 70, a.y + a.height / 2 - 10, { steps: 3 });
    await page.mouse.move(b.x + 80, b.y + b.height * 0.2, { steps: 8 });
    await page.waitForSelector('.row.drop-before');
    await shot(page, 'manual-order-drag');
    await page.mouse.up();
    await page.waitForFunction(() => document.querySelector('.tree .row .row-title')?.textContent === 'Recipes');
    assert.deepEqual(await titles(), ['Recipes', 'Apples']);
    await page.close();
}

async function demoEncrypted(browser, errors) {
    const ctx = await browser.newContext({ viewport: { width: 1280, height: 800 } });
    const page = await ctx.newPage();
    watch(page, errors);
    await page.goto(BASE + '?demo');
    await page.click('.notebook:has-text("Private")');
    await page.waitForSelector('.tree .row:has-text("Gift ideas")');
    assert.equal(await page.locator('.tree .row:has-text("vault")').count(), 0);
    await page.click('.row:has-text("Gift ideas")');
    await page.waitForSelector('.locked-note');
    assert.equal(await page.locator('.rendered').count(), 0);
    await shot(page, 'encrypted-locked');
    await page.fill('.locked-note input', 'wrong');
    await page.click('.locked-note button.primary');
    await page.waitForSelector('.locked-note .error');
    await page.fill('.locked-note input', 'demo password');
    await page.click('.locked-note button.primary');
    await page.waitForSelector('.rendered h1:has-text("Gift ideas")', { timeout: 15000 });
    await page.waitForSelector('.meta-strip .chip:has-text("family")');
    await shot(page, 'encrypted-unlocked');
    // Lock again from the notebook toolbar: back to the unlock form.
    await page.getByRole('button', { name: 'Lock notebook' }).click();
    await page.waitForSelector('.locked-note');
    // Recovery key path is offered.
    await page.click('.locked-note .link-button');
    await page.waitForSelector('.locked-note input.mono');
    await ctx.close();
}

async function realMode(browser, errors) {
    const google = fakeGoogle();
    const ctx = await browser.newContext({ viewport: { width: 1200, height: 800 } });
    await ctx.route('https://www.googleapis.com/**', google.handle);
    let authUrl = null;
    await ctx.route('https://accounts.google.com/**', (route) => {
        authUrl = new URL(route.request().url());
        // Google sends the user back with a token in the fragment.
        const back = new URL(authUrl.searchParams.get('redirect_uri'));
        back.hash = new URLSearchParams({
            access_token: 'test-token', token_type: 'Bearer', expires_in: '3599',
            scope: 'https://www.googleapis.com/auth/drive.file', state: authUrl.searchParams.get('state'),
        }).toString();
        return route.fulfill({ status: 302, headers: { location: back.toString() } });
    });
    const page = await ctx.newPage();
    watch(page, errors);
    const served = [];
    page.on('request', (r) => r.url().startsWith(BASE) && served.push(r.url()));

    // No client ID: setup screen.
    await page.goto(BASE);
    await page.waitForSelector('.client-form');
    await shot(page, 'setup');

    // Setup link: the client ID arrives in the fragment, which is never requested from the server.
    await page.goto(BASE + '#setup=' + CLIENT);
    await page.waitForSelector('button:has-text("Sign in with Google")');
    assert.ok(!page.url().includes('setup='), 'fragment removed from the address bar');
    assert.ok(!served.some((u) => u.includes(CLIENT)), 'client ID never sent to the web server');
    assert.equal(await page.evaluate(() => localStorage.getItem('marknote.clientId')), CLIENT);

    await page.click('button:has-text("Sign in with Google")');
    await page.waitForSelector('.notebook:has-text("Work")', { timeout: 10000 });
    assert.equal(authUrl.searchParams.get('client_id'), CLIENT);
    assert.equal(authUrl.searchParams.get('response_type'), 'token');
    assert.equal(authUrl.searchParams.get('scope'), 'https://www.googleapis.com/auth/drive.file');
    assert.ok(!authUrl.searchParams.has('client_secret'));
    assert.ok(!page.url().includes('access_token'), 'token removed from the address bar');

    await page.click('.notebook:has-text("Work")');
    await page.click('.row:has-text("Plan")');
    await page.waitForSelector('.rendered h1');
    // Images come from Drive (alt=media) as blobs.
    await page.waitForFunction(() => document.querySelector('.rendered img')?.src.startsWith('blob:'));
    await page.locator('.rendered input.task').check();
    await page.waitForTimeout(600);
    assert.match(google.byName('Plan.md').content, /- \[x\] Ship the web app/);

    // Edited on another device meanwhile: both versions are kept.
    const plan = google.byName('Plan.md');
    plan.content = plan.content.replace('# Plan', '# Plan (desktop edit)');
    plan.md5Checksum = 'changed-elsewhere';
    await page.getByRole('button', { name: 'Edit note' }).click();
    await page.click('.cm-content');
    await page.keyboard.press('Control+End');
    await page.keyboard.type('\nPhone edit');
    await page.getByRole('button', { name: 'Done editing' }).click();
    await page.waitForSelector('.toast.warning');
    const copy = [...google.nodes.values()].find((n) => /^Plan \(conflict .*\)\.md$/.test(n.name));
    assert.ok(copy, 'conflict copy created');
    assert.match(copy.content, /Phone edit/);
    assert.match(google.byName('Plan.md').content, /desktop edit/);
    await shot(page, 'real-conflict');

    // New note goes to Drive with front matter.
    await page.getByRole('button', { name: 'New note', exact: true }).click();
    await page.fill('.dialog input', 'From the web');
    await page.click('.dialog button.primary');
    await page.waitForSelector('.cm-content');
    const created = google.byName('From the web.md');
    assert.match(created.content, /^---\nid: [0-9A-Z]{26}\ncreated: \d{4}-\d\d-\d\dT\d\d:\d\d:\d\d\n---\n\n# From the web\n$/);
    assert.equal(google.nodes.get(created.parents[0]).name, 'Work');

    // Offline: the edit waits on this device and uploads when back online.
    await page.getByRole('button', { name: 'Done editing' }).click();
    await ctx.setOffline(true);
    await page.evaluate(() => dispatchEvent(new Event('offline')));
    await page.getByRole('button', { name: 'Edit note' }).click();
    await page.click('.cm-content');
    await page.keyboard.press('Control+End');
    await page.keyboard.type('\nWritten offline');
    await page.getByRole('button', { name: 'Done editing' }).click();
    await page.waitForSelector('.banner:has-text("Offline")');
    await shot(page, 'real-offline');
    assert.doesNotMatch(google.byName('From the web.md').content, /Written offline/);
    await ctx.setOffline(false);
    await page.evaluate(() => dispatchEvent(new Event('online')));
    for (let i = 0; i < 40 && !/Written offline/.test(google.byName('From the web.md').content); ++i) await page.waitForTimeout(250);
    assert.match(google.byName('From the web.md').content, /Written offline/);
    await page.waitForFunction(() => !document.querySelector('.banner'), null, { timeout: 8000 });

    // Reload: notes are shown at once from this device's copy, the token is still valid.
    await page.reload();
    await page.waitForSelector('.row:has-text("From the web")');

    // "Show in Google Drive" opens the note's own page on drive.google.com.
    await ctx.route('https://drive.google.com/**', (route) => route.fulfill({ status: 200, contentType: 'text/html', body: '<title>Drive</title>' }));
    await page.dispatchEvent('.row:has-text("Plan.md"), .row:has-text("Plan")', 'contextmenu');
    const [drivePage] = await Promise.all([ctx.waitForEvent('page'), page.click('.menu button:has-text("Show in Google Drive"), [role=menu] :text("Show in Google Drive")')]);
    assert.equal(drivePage.url(), `https://drive.google.com/file/d/${google.byName('Plan.md').id}/view`);
    await ctx.close();
}

(async () => {
    const browser = await chromium.launch();
    const errors = [];
    const steps = [['demo desktop', demoDesktop], ['demo rich notes', demoRich], ['demo drag and drop', demoDrag], ['demo phone', demoPhone], ['demo block handles', demoBlockHandles], ['demo to-do block', demoTodo], ['demo block menu', demoBlockMenu], ['demo manual order', demoManualOrder], ['demo encrypted notebook', demoEncrypted], ['real mode', realMode]];
    let failed = false;
    for (const [name, fn] of steps.filter(([n]) => !process.env.E2E_ONLY || n.includes(process.env.E2E_ONLY))) {
        try {
            await fn(browser, errors);
            console.log(`ok - ${name}`);
        } catch (e) {
            failed = true;
            console.log(`not ok - ${name}\n${e.stack}`);
            if (SHOTS && lastPage && !lastPage.isClosed()) await lastPage.screenshot({ path: path.join(SHOTS, `failed-${name.replaceAll(' ', '-')}.png`) }).catch(() => {});
        }
    }
    if (errors.length) {
        failed = true;
        console.log('Browser errors:\n' + errors.join('\n'));
    }
    await browser.close();
    process.exit(failed ? 1 : 0);
})();
