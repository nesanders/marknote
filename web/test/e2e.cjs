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

function watch(page, errors) {
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
    add(nb.id, 'Plan.md', 'text/markdown', '---\nid: 01ABC\ntags: [work]\n---\n\n# Plan\n\n- [ ] Ship the web app\n');
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
            const raw = req.postDataBuffer().toString('utf8');
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
                if (url.searchParams.get('alt') === 'media') return route.fulfill({ status: 200, contentType: 'text/plain', body: n.content });
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
    await page.waitForFunction(() => !document.querySelector('.banner'), null, { timeout: 8000 });
    assert.match(google.byName('From the web.md').content, /Written offline/);

    // Reload: notes are shown at once from this device's copy, the token is still valid.
    await page.reload();
    await page.waitForSelector('.row:has-text("From the web")');
    await ctx.close();
}

(async () => {
    const browser = await chromium.launch();
    const errors = [];
    const steps = [['demo desktop', demoDesktop], ['demo phone', demoPhone], ['real mode', realMode]];
    let failed = false;
    for (const [name, fn] of steps) {
        try {
            await fn(browser, errors);
            console.log(`ok - ${name}`);
        } catch (e) {
            failed = true;
            console.log(`not ok - ${name}\n${e.stack}`);
        }
    }
    if (errors.length) {
        failed = true;
        console.log('Browser errors:\n' + errors.join('\n'));
    }
    await browser.close();
    process.exit(failed ? 1 : 0);
})();
