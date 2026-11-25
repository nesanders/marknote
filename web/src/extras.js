// SPDX-FileCopyrightText: 2026 Marknote fork contributors
// SPDX-License-Identifier: GPL-2.0-only OR GPL-3.0-only OR LicenseRef-KDE-Accepted-GPL
//
// Rendering that needs large libraries, loaded only when a note uses it:
// KaTeX for math, Mermaid for diagrams. Also fills in images.

import { fillAttachmentCard } from './attachments.js';

let katexPromise = null;
let mermaidPromise = null;
let mermaidTheme = '';
let counter = 0;

export function loadKatex() {
    if (!katexPromise) {
        const link = document.createElement('link');
        link.rel = 'stylesheet';
        link.href = 'katex/katex.min.css';
        document.head.appendChild(link);
        katexPromise = import('katex').then((m) => m.default ?? m);
    }
    return katexPromise;
}

function isDark() {
    const forced = document.documentElement.getAttribute('data-theme');
    return forced ? forced === 'dark' : matchMedia('(prefers-color-scheme: dark)').matches;
}

export async function loadMermaid() {
    if (!mermaidPromise) mermaidPromise = import('mermaid').then((m) => m.default ?? m);
    const mermaid = await mermaidPromise;
    const theme = isDark() ? 'dark' : 'default';
    if (theme !== mermaidTheme) {
        mermaid.initialize({ startOnLoad: false, securityLevel: 'strict', theme, fontFamily: 'inherit' });
        mermaidTheme = theme;
    }
    return mermaid;
}

export async function renderMath(el, tex, display) {
    const katex = await loadKatex();
    katex.render(tex, el, { displayMode: display, throwOnError: false, trust: false, strict: 'ignore', output: 'htmlAndMathml' });
}

export async function renderMermaid(el, source) {
    let mermaid;
    try {
        mermaid = await loadMermaid();
    } catch (e) {
        console.error('Mermaid failed to load', e);
        return;
    }
    try {
        const { svg } = await mermaid.render(`mermaid-${++counter}`, source);
        el.innerHTML = svg; // Mermaid sanitizes in strict mode
        el.classList.add('rendered-diagram');
    } catch (e) {
        el.classList.add('diagram-error');
        const msg = document.createElement('p');
        msg.className = 'error';
        msg.textContent = `Diagram error: ${String(e.message ?? e).split('\n')[0]}`;
        el.prepend(msg);
    } finally {
        // Mermaid leaves a measuring element behind on errors.
        document.getElementById(`dmermaid-${counter}`)?.remove();
    }
}

/**
 * Fill in math, diagrams and images inside rendered HTML.
 * @param images (src) => Promise<{url}|{missing}> resolving an image link
 */
export async function enhance(container, { images, attachments } = {}) {
    const jobs = [];
    for (const el of container.querySelectorAll('.math[data-tex]:not([data-done])')) {
        el.dataset.done = '1';
        jobs.push(renderMath(el, decodeURIComponent(el.dataset.tex), el.classList.contains('display')).catch(() => {}));
    }
    for (const el of container.querySelectorAll('.mermaid-block[data-src]:not([data-done])')) {
        el.dataset.done = '1';
        jobs.push(renderMermaid(el, decodeURIComponent(el.dataset.src)));
    }
    for (const img of container.querySelectorAll('img[data-src]:not([data-done])')) {
        img.dataset.done = '1';
        jobs.push((async () => {
            const r = images ? await images(img.dataset.src).catch((e) => ({ missing: e.message })) : { missing: img.dataset.src };
            if (r.url) {
                img.src = r.url;
            } else {
                const span = document.createElement('span');
                span.className = 'image-missing';
                span.textContent = `🖼 ${img.alt || r.missing || 'Image'} (not found in this notebook)`;
                img.replaceWith(span);
            }
        })());
    }
    for (const el of container.querySelectorAll('.attachment[data-attachment]:not([data-done])')) {
        el.dataset.done = '1';
        jobs.push((async () => {
            const info = attachments ? await attachments(el.dataset.attachment).catch((e) => ({ missing: e.message })) : null;
            fillAttachmentCard(el, el.dataset.name, info ?? { missing: el.dataset.attachment });
        })());
    }
    await Promise.all(jobs);
}
