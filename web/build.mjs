// SPDX-FileCopyrightText: 2026 Marknote fork contributors
// SPDX-License-Identifier: GPL-2.0-only OR GPL-3.0-only OR LicenseRef-KDE-Accepted-GPL
//
// node build.mjs           -> dist/ (static site for GitHub Pages)
// node build.mjs --serve   -> dist/ + local server on http://localhost:8080

import * as esbuild from 'esbuild';
import { createHash } from 'node:crypto';
import { cpSync, mkdirSync, readdirSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { join, relative } from 'node:path';

const out = 'dist';
rmSync(out, { recursive: true, force: true });
mkdirSync(out, { recursive: true });

await esbuild.build({
    entryPoints: { app: 'src/main.jsx', app_css: 'src/app.css' },
    outdir: out,
    entryNames: '[name]',
    chunkNames: 'chunks/[name]-[hash]',
    bundle: true,
    splitting: true,
    format: 'esm',
    minify: true,
    sourcemap: false,
    target: ['es2022', 'safari16'],
    jsx: 'automatic',
    jsxImportSource: 'preact',
    legalComments: 'linked',
    logLevel: 'warning',
});
// esbuild names the CSS entry after its key.
cpSync(join(out, 'app_css.css'), join(out, 'app.css'));
rmSync(join(out, 'app_css.css'));
rmSync(join(out, 'app_css.js'), { force: true });

cpSync('public', out, { recursive: true });

// Service worker: cache every file of this build; the version changes with content.
const files = [];
const walk = (dir) => {
    for (const name of readdirSync(dir)) {
        const p = join(dir, name);
        if (statSync(p).isDirectory()) walk(p);
        else if (name !== 'sw.js' && !name.endsWith('.LEGAL.txt')) files.push(p);
    }
};
walk(out);
const hash = createHash('sha256');
for (const f of files.sort()) hash.update(f).update(readFileSync(f));
const shell = ['./', ...files.map((f) => './' + relative(out, f).replaceAll('\\', '/'))];
const sw = readFileSync(join(out, 'sw.js'), 'utf8')
    .replace('__BUILD_VERSION__', hash.digest('hex').slice(0, 12))
    .replace('__SHELL_FILES__', JSON.stringify(shell.filter((f) => !f.includes('/chunks/'))));
writeFileSync(join(out, 'sw.js'), sw);
console.log(`Built ${files.length} files into ${out}/`);

if (process.argv.includes('--serve')) {
    const { createServer } = await import('node:http');
    const types = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.svg': 'image/svg+xml', '.png': 'image/png', '.webmanifest': 'application/manifest+json' };
    createServer((req, res) => {
        let path = decodeURIComponent(new URL(req.url, 'http://x').pathname);
        if (path.endsWith('/')) path += 'index.html';
        try {
            const body = readFileSync(join(out, path));
            res.writeHead(200, { 'Content-Type': types[path.slice(path.lastIndexOf('.'))] ?? 'application/octet-stream' });
            res.end(body);
        } catch {
            res.writeHead(404);
            res.end('not found');
        }
    }).listen(8080, () => console.log('http://localhost:8080/'));
}
