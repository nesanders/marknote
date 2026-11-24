// SPDX-FileCopyrightText: 2026 Marknote fork contributors
// SPDX-License-Identifier: GPL-2.0-only OR GPL-3.0-only OR LicenseRef-KDE-Accepted-GPL
//
// Live preview for the Markdown editor: the text stays exactly as written (no
// reformatting, so desktop and web never fight over a note's layout), but
// Markdown syntax is hidden and rendered everywhere except on the lines being
// edited. Checkboxes can be ticked, and images, math, diagrams and tables show
// rendered; click one to edit its source.

import { syntaxTree, ensureSyntaxTree } from '@codemirror/language';
import { RangeSetBuilder, StateField } from '@codemirror/state';
import { Decoration, EditorView, WidgetType } from '@codemirror/view';
import { renderMarkdown } from '../markdown.js';
import { renderMath, renderMermaid } from '../extras.js';

// ---- widgets ----------------------------------------------------------------

class CheckboxWidget extends WidgetType {
    constructor(checked) {
        super();
        this.checked = checked;
    }
    eq(other) {
        return other.checked === this.checked;
    }
    toDOM(view) {
        const box = document.createElement('input');
        box.type = 'checkbox';
        box.className = 'cm-task';
        box.checked = this.checked;
        box.setAttribute('aria-label', this.checked ? 'Done' : 'Not done');
        box.addEventListener('mousedown', (e) => e.preventDefault());
        box.addEventListener('click', (e) => {
            e.preventDefault();
            const pos = view.posAtDOM(box);
            const text = view.state.sliceDoc(pos, pos + 3);
            if (!/^\[[ xX]\]$/.test(text)) return;
            view.dispatch({ changes: { from: pos + 1, to: pos + 2, insert: this.checked ? ' ' : 'x' } });
        });
        return box;
    }
    ignoreEvent() {
        return true;
    }
}

class BulletWidget extends WidgetType {
    eq() {
        return true;
    }
    toDOM() {
        const s = document.createElement('span');
        s.className = 'cm-bullet';
        s.textContent = '•';
        return s;
    }
}

/** Rendered content that turns back into source when clicked. */
class RenderedWidget extends WidgetType {
    constructor(kind, source, extra = {}) {
        super();
        this.kind = kind;
        this.source = source;
        this.extra = extra;
    }
    eq(other) {
        return other.kind === this.kind && other.source === this.source && other.extra.display === this.extra.display;
    }
    toDOM(view) {
        const block = this.kind !== 'math' || this.extra.display;
        const el = document.createElement(block ? 'div' : 'span');
        el.className = `cm-rendered cm-rendered-${this.kind}` + (block ? ' cm-rendered-block' : '');
        el.title = 'Click to edit';
        const after = () => view.requestMeasure();
        if (this.kind === 'math') {
            el.textContent = this.source;
            renderMath(el, this.source, !!this.extra.display).then(after).catch(() => {});
        } else if (this.kind === 'mermaid') {
            // Source as a fallback; replaced by the diagram, kept under an error.
            const pre = document.createElement('pre');
            pre.className = 'code';
            pre.textContent = this.source;
            el.appendChild(pre);
            renderMermaid(el, this.source).then(after);
        } else if (this.kind === 'table') {
            el.innerHTML = renderMarkdown(this.source);
        } else if (this.kind === 'hr') {
            el.appendChild(document.createElement('hr'));
        } else if (this.kind === 'image') {
            const img = document.createElement('img');
            img.alt = this.extra.alt ?? '';
            el.appendChild(img);
            const resolve = this.extra.resolve;
            Promise.resolve(resolve ? resolve(this.source) : { missing: this.source }).then((r) => {
                if (r.url) {
                    img.onload = after;
                    img.src = r.url;
                } else {
                    el.textContent = `🖼 ${img.alt || r.missing || 'Image'} (not found in this notebook)`;
                    el.classList.add('image-missing');
                    after();
                }
            }).catch(() => {});
        }
        el.addEventListener('mousedown', (e) => {
            e.preventDefault();
            const pos = view.posAtDOM(el);
            view.dispatch({ selection: { anchor: Math.min(pos + (this.kind === 'hr' ? 0 : 1), view.state.doc.length) } });
            view.focus();
        });
        return el;
    }
    ignoreEvent() {
        return false;
    }
}

const hidden = Decoration.replace({});
const bullet = Decoration.replace({ widget: new BulletWidget() });
const line = (cls) => Decoration.line({ class: cls });
const mark = (cls) => Decoration.mark({ class: cls });

// ---- decoration builder ------------------------------------------------------

function activeLines(state) {
    const lines = new Set();
    for (const r of state.selection.ranges) {
        const a = state.doc.lineAt(r.from).number;
        const b = state.doc.lineAt(r.to).number;
        for (let n = a; n <= b; ++n) lines.add(n);
    }
    return lines;
}

function touches(state, from, to) {
    return state.selection.ranges.some((r) => r.to >= from && r.from <= to);
}

/** Inline/display math found by scanning text outside code. */
function findMath(text) {
    const out = [];
    const re = /\$\$([^$]+?)\$\$|\$(?!\s)((?:\\.|[^$\\\n])+?)(?<!\s)\$(?!\d)/g;
    let m;
    while ((m = re.exec(text))) {
        out.push({ from: m.index, to: m.index + m[0].length, tex: m[1] ?? m[2], display: m[1] !== undefined });
    }
    return out;
}

function build(state, resolveImage) {
    const decos = [];
    const add = (from, to, deco) => decos.push(deco.range(from, to));
    const active = activeLines(state);
    const isActive = (pos) => active.has(state.doc.lineAt(pos).number);
    const tree = ensureSyntaxTree(state, state.doc.length, 250) ?? syntaxTree(state);
    const codeRanges = [];

    tree.iterate({
        enter(node) {
            const { from, to, name } = node;
            const heading = /^ATXHeading(\d)$/.exec(name);
            if (heading) {
                add(from, from, line(`cm-h cm-h${heading[1]}`));
                return;
            }
            switch (name) {
            case 'HeaderMark': {
                if (node.node.parent?.name.startsWith('ATXHeading') && !isActive(from)) {
                    const end = state.sliceDoc(to, to + 1) === ' ' ? to + 1 : to;
                    add(from, end, hidden);
                }
                return;
            }
            case 'EmphasisMark':
            case 'StrikethroughMark':
                if (!isActive(from)) add(from, to, hidden);
                return;
            case 'InlineCode':
                codeRanges.push([from, to]);
                add(from, to, mark('cm-inline-code'));
                return;
            case 'CodeMark':
                if (node.node.parent?.name === 'InlineCode' && !isActive(from)) add(from, to, hidden);
                return;
            case 'Link': {
                if (isActive(from)) return;
                const marks = [];
                let url = null;
                for (let c = node.node.firstChild; c; c = c.nextSibling) {
                    if (c.name === 'LinkMark') marks.push(c);
                    if (c.name === 'URL') url = c;
                }
                if (marks.length >= 2) {
                    add(marks[0].from, marks[0].to, hidden);
                    add(marks[0].to, marks[1].from, mark('cm-link'));
                    add(marks[1].from, to, hidden); // "](url)"
                }
                return false;
            }
            case 'Image': {
                let url = null;
                let alt = '';
                const marks = [];
                for (let c = node.node.firstChild; c; c = c.nextSibling) {
                    if (c.name === 'URL') url = state.sliceDoc(c.from, c.to);
                    if (c.name === 'LinkMark') marks.push(c);
                }
                if (marks.length >= 2) alt = state.sliceDoc(marks[0].to, marks[1].from);
                if (url !== null && !touches(state, from, to)) {
                    add(from, to, Decoration.replace({ widget: new RenderedWidget('image', url.replace(/^<|>$/g, ''), { alt, resolve: resolveImage }) }));
                }
                return false;
            }
            case 'ListMark': {
                if (isActive(from)) return;
                const item = node.node.parent;
                const text = state.sliceDoc(from, to);
                const task = item?.getChild('Task');
                if (task) {
                    add(from, Math.min(to + 1, task.from), hidden);
                } else if (/^[-*+]$/.test(text)) {
                    add(from, to, bullet);
                }
                return;
            }
            case 'TaskMarker': {
                const checked = /x/i.test(state.sliceDoc(from, to));
                add(from, to, Decoration.replace({ widget: new CheckboxWidget(checked) }));
                if (checked) {
                    const ln = state.doc.lineAt(from);
                    if (to + 1 < ln.to) add(to + 1, ln.to, mark('cm-done'));
                }
                return;
            }
            case 'Blockquote': {
                for (let n = state.doc.lineAt(from).number; n <= state.doc.lineAt(to).number; ++n) {
                    add(state.doc.line(n).from, state.doc.line(n).from, line('cm-quote'));
                }
                return;
            }
            case 'QuoteMark':
                if (!isActive(from)) add(from, state.sliceDoc(to, to + 1) === ' ' ? to + 1 : to, hidden);
                return;
            case 'HorizontalRule':
                if (!isActive(from)) add(from, to, Decoration.replace({ widget: new RenderedWidget('hr', '---') }));
                return;
            case 'FencedCode': {
                codeRanges.push([from, to]);
                const info = node.node.getChild('CodeInfo');
                const lang = info ? state.sliceDoc(info.from, info.to).trim() : '';
                const text = node.node.getChild('CodeText');
                if (lang === 'mermaid' && text && !touches(state, from, to)) {
                    add(from, to, Decoration.replace({ widget: new RenderedWidget('mermaid', state.sliceDoc(text.from, text.to)), block: true }));
                    return false;
                }
                for (let n = state.doc.lineAt(from).number; n <= state.doc.lineAt(to).number; ++n) {
                    add(state.doc.line(n).from, state.doc.line(n).from, line('cm-codeblock'));
                }
                return false;
            }
            case 'Table': {
                codeRanges.push([from, to]);
                if (!touches(state, from, to)) {
                    add(from, to, Decoration.replace({ widget: new RenderedWidget('table', state.sliceDoc(from, to)), block: true }));
                }
                return false;
            }
            default:
                return undefined;
            }
        },
    });

    // Math: $$…$$ blocks over several lines, then inline/one-line math.
    const doc = state.doc.toString();
    const inCode = (pos) => codeRanges.some(([a, b]) => pos >= a && pos < b);
    const blockRe = /^\$\$[ \t]*\n([\s\S]*?)\n[ \t]*\$\$[ \t]*$/gm;
    let m;
    const blocks = [];
    while ((m = blockRe.exec(doc))) {
        const from = m.index;
        const to = from + m[0].length;
        if (inCode(from)) continue;
        blocks.push([from, to]);
        if (!touches(state, from, to)) add(from, to, Decoration.replace({ widget: new RenderedWidget('math', m[1], { display: true }), block: true }));
    }
    for (const { from: lf, to: lt } of visibleLines(state)) {
        const text = state.sliceDoc(lf, lt);
        if (!text.includes('$')) continue;
        for (const hit of findMath(text)) {
            const from = lf + hit.from;
            const to = lf + hit.to;
            if (inCode(from) || blocks.some(([a, b]) => from >= a && from < b) || touches(state, from, to)) continue;
            add(from, to, Decoration.replace({ widget: new RenderedWidget('math', hit.tex, { display: hit.display }) }));
        }
    }

    decos.sort((a, b) => a.from - b.from || a.value.startSide - b.value.startSide);
    const builder = new RangeSetBuilder();
    let lastTo = -1;
    for (const d of decos) {
        // Replacements must not overlap each other.
        const replacing = d.value.spec.widget !== undefined || d.value === hidden || d.value.spec.block;
        if (replacing && d.from < lastTo && d.from !== d.to) continue;
        builder.add(d.from, d.to, d.value);
        if (replacing && d.to > d.from) lastTo = Math.max(lastTo, d.to);
    }
    return builder.finish();
}

function* visibleLines(state) {
    for (let n = 1; n <= state.doc.lines; ++n) yield state.doc.line(n);
}

/**
 * The live preview extension. @param resolveImage (src) => Promise<{url}|{missing}>
 */
export function livePreview(resolveImage) {
    const field = StateField.define({
        create: (state) => build(state, resolveImage),
        update(value, tr) {
            if (tr.docChanged || tr.selection || syntaxTree(tr.startState) !== syntaxTree(tr.state)) return build(tr.state, resolveImage);
            return value;
        },
        provide: (f) => EditorView.decorations.from(f),
    });
    // Not atomic: markup is only hidden on lines without the cursor, so moving
    // onto a line reveals it and every position stays reachable.
    return [field];
}
