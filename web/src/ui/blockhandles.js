// SPDX-FileCopyrightText: 2026 Marknote fork contributors
// SPDX-License-Identifier: GPL-2.0-only OR GPL-3.0-only OR LicenseRef-KDE-Accepted-GPL
//
// Block handles for the Markdown editor: a grip beside the block being edited
// (and, with a mouse, the one under the pointer). Drag it to move the block
// (a paragraph, heading, list item with its sub-items, quote, code block,
// table); tap it for Move up / Move down. Made for touch: the grip is a real
// target, dragging needs no long press, and the page does not scroll under it.

import { syntaxTree } from '@codemirror/language';
import { StateEffect, StateField } from '@codemirror/state';
import { Decoration, EditorView, ViewPlugin } from '@codemirror/view';

const LIST_ITEM = 'ListItem';
const LISTS = new Set(['BulletList', 'OrderedList']);

/**
 * The movable blocks of a document, in order: { from, to (line ends), depth,
 * listItem, indent }. List items at every depth are blocks; a list item
 * includes its sub-items.
 */
export function blocksOf(state) {
    const doc = state.doc;
    const out = [];
    const lineRange = (from, to) => {
        const first = doc.lineAt(from);
        // A node can end at the start of the next line: stay on the last line with content.
        let last = doc.lineAt(Math.max(from, to));
        if (last.from === to && last.number > first.number) last = doc.line(last.number - 1);
        while (last.number > first.number && !last.text.trim()) last = doc.line(last.number - 1);
        return { from: first.from, to: last.to, indent: first.text.match(/^\s*/)[0].length };
    };
    const walkList = (list, depth) => {
        for (let item = list.firstChild; item; item = item.nextSibling) {
            if (item.name !== LIST_ITEM) continue;
            out.push({ ...lineRange(item.from, item.to), depth, listItem: true });
            for (let c = item.firstChild; c; c = c.nextSibling) {
                if (LISTS.has(c.name)) walkList(c, depth + 1);
            }
        }
    };
    const top = syntaxTree(state).topNode;
    for (let node = top.firstChild; node; node = node.nextSibling) {
        if (LISTS.has(node.name)) walkList(node, 0);
        else if (node.to > node.from && doc.sliceString(node.from, node.to).trim()) out.push({ ...lineRange(node.from, node.to), depth: 0, listItem: false });
    }
    return out;
}

/** The innermost block containing pos. */
function blockAt(blocks, pos) {
    let best = null;
    for (const b of blocks) {
        if (pos >= b.from && pos <= b.to && (!best || b.from >= best.from)) best = b;
    }
    return best;
}

/** Shift every line of text by delta spaces (never removing non-spaces). */
function reindent(text, delta) {
    if (!delta) return text;
    return text.split('\n').map((l) => {
        if (delta > 0) return l.length ? ' '.repeat(delta) + l : l;
        const strip = Math.min(-delta, l.match(/^ */)[0].length);
        return l.slice(strip);
    }).join('\n');
}

/**
 * The changes that move block `src` so it starts where `target` starts
 * (before: true) or right after `target` (before: false): one transaction,
 * blank lines kept tidy, list items re-indented to their new level.
 * Returns { changes, cursor } or null when nothing would change.
 */
export function moveChanges(state, src, target, before) {
    const doc = state.doc;
    if (!target || (target.from >= src.from && target.to <= src.to)) return null;
    const first = doc.lineAt(src.from).number;
    const last = doc.lineAt(src.to).number;
    const blank = (n) => n >= 1 && n <= doc.lines && !doc.line(n).text.trim();

    let text = doc.sliceString(src.from, src.to);
    const tight = src.listItem && target.listItem; // list items sit on consecutive lines
    if (src.listItem) text = reindent(text, (tight ? target.indent : 0) - src.indent);

    // Take the block out with its line break; drop a blank line that would be doubled.
    let delFrom = doc.line(first).from;
    let delTo;
    if (last < doc.lines) {
        delTo = doc.line(last).to + 1;
        if ((blank(first - 1) || first === 1) && blank(last + 1)) delTo = last + 1 < doc.lines ? doc.line(last + 1).to + 1 : doc.length;
    } else {
        delTo = doc.length;
        if (first > 1) delFrom = doc.line(first - 1).to; // the break before it
        if (blank(first - 1) && first - 1 > 1) delFrom = doc.line(first - 2).to;
    }

    let insertAt;
    let insert;
    if (before) {
        const t = doc.lineAt(target.from).number;
        insertAt = doc.line(t).from;
        const blankBefore = !tight && t > 1 && !blank(t - 1);
        insert = (blankBefore ? '\n' : '') + text + (tight ? '\n' : '\n\n');
    } else {
        const t = doc.lineAt(target.to).number;
        insertAt = doc.line(t).to;
        const blankAfter = !tight && t < doc.lines && !blank(t + 1);
        insert = (tight ? '\n' : '\n\n') + text + (blankAfter ? '\n' : '');
    }
    if (insertAt > delFrom && insertAt < delTo) return null; // into itself
    const changes = [{ from: delFrom, to: delTo, insert: '' }, { from: insertAt, insert }].sort((a, b) => a.from - b.from || (a.to ?? a.from) - (b.to ?? b.from));
    let tr;
    try {
        tr = state.update({ changes });
    } catch {
        return null;
    }
    if (tr.state.doc.toString() === doc.toString()) return null;
    const cursor = tr.changes.mapPos(insertAt, -1) + insert.indexOf(text);
    return { changes, cursor };
}

// ---- view ----------------------------------------------------------------

const setDragged = StateEffect.define();
const draggedField = StateField.define({
    create: () => Decoration.none,
    update(value, tr) {
        value = value.map(tr.changes);
        for (const e of tr.effects) {
            if (!e.is(setDragged)) continue;
            if (!e.value) return Decoration.none;
            const decos = [];
            for (let pos = e.value.from; pos <= e.value.to;) {
                const line = tr.state.doc.lineAt(pos);
                decos.push(Decoration.line({ class: 'cm-block-dragged' }).range(line.from));
                pos = line.to + 1;
            }
            return Decoration.set(decos);
        }
        return value;
    },
    provide: (f) => EditorView.decorations.from(f),
});

const coarse = () => matchMedia('(pointer: coarse)').matches;

const plugin = ViewPlugin.fromClass(class {
    constructor(view) {
        this.view = view;
        this.blocks = blocksOf(view.state);
        this.hover = null;
        this.drag = null;
        this.grip = document.createElement('button');
        this.grip.type = 'button';
        this.grip.className = 'cm-block-grip';
        this.grip.setAttribute('aria-label', 'Move block (drag, or tap for options)');
        this.grip.innerHTML = '<svg viewBox="0 0 10 16" width="10" height="16" aria-hidden="true"><g fill="currentColor"><circle cx="2.5" cy="3" r="1.4"/><circle cx="7.5" cy="3" r="1.4"/><circle cx="2.5" cy="8" r="1.4"/><circle cx="7.5" cy="8" r="1.4"/><circle cx="2.5" cy="13" r="1.4"/><circle cx="7.5" cy="13" r="1.4"/></g></svg>';
        this.line = document.createElement('div');
        this.line.className = 'cm-block-drop-line';
        this.menu = null;
        view.scrollDOM.append(this.grip, this.line);
        this.grip.addEventListener('pointerdown', (e) => this.down(e));
        // Keep the editor's selection when the grip is pressed.
        this.grip.addEventListener('mousedown', (e) => e.preventDefault());
        this.onMove = (e) => this.move(e);
        this.onUp = (e) => this.up(e);
        this.onHover = (e) => {
            if (this.drag || coarse()) return;
            const pos = view.posAtCoords({ x: e.clientX, y: e.clientY }, false);
            const b = pos === null ? null : blockAt(this.blocks, pos);
            if (b !== this.hover) {
                this.hover = b;
                this.place();
            }
        };
        view.contentDOM.addEventListener('pointermove', this.onHover);
        this.place();
    }

    update(u) {
        if (u.docChanged || u.viewportChanged || syntaxTree(u.startState) !== syntaxTree(u.state)) this.blocks = blocksOf(u.state);
        if (u.docChanged) this.hover = null;
        if (u.docChanged || u.selectionSet || u.geometryChanged || u.viewportChanged || u.focusChanged) this.place();
    }

    target() {
        if (this.drag) return this.drag.src;
        if (this.hover) return this.hover;
        if (!this.view.hasFocus && !this.menu) return null;
        return blockAt(this.blocks, this.view.state.selection.main.head);
    }

    place() {
        this.view.requestMeasure({
            read: () => {
                const b = this.target();
                if (!b) return null;
                const top = this.view.lineBlockAt(b.from);
                const first = this.view.coordsAtPos(b.from, 1);
                const scroller = this.view.scrollDOM.getBoundingClientRect();
                const content = this.view.contentDOM.getBoundingClientRect();
                const padLeft = parseFloat(getComputedStyle(this.view.contentDOM).paddingLeft) || 0;
                return {
                    top: top.top + this.view.documentTop - scroller.top + this.view.scrollDOM.scrollTop,
                    height: Math.min(top.height, 40),
                    left: content.left - scroller.left + padLeft + (first ? first.left - content.left - padLeft : 0),
                };
            },
            write: (m) => {
                if (!m) {
                    this.grip.classList.remove('visible');
                    return;
                }
                this.grip.classList.add('visible');
                this.grip.style.top = `${m.top + m.height / 2}px`;
                this.grip.style.left = `${Math.max(2, m.left - 30)}px`;
            },
        });
    }

    down(e) {
        if (e.button !== 0) return;
        const src = this.target();
        if (!src) return;
        e.preventDefault();
        this.closeMenu();
        this.grip.setPointerCapture(e.pointerId);
        this.drag = { src, id: e.pointerId, x: e.clientX, y: e.clientY, started: false, drop: null };
        this.grip.addEventListener('pointermove', this.onMove);
        this.grip.addEventListener('pointerup', this.onUp);
        this.grip.addEventListener('pointercancel', this.onUp);
    }

    start() {
        const d = this.drag;
        d.started = true;
        navigator.vibrate?.(12);
        this.view.dispatch({ effects: setDragged.of({ from: d.src.from, to: d.src.to }) });
        const card = document.createElement('div');
        card.className = 'cm-block-ghost';
        const text = this.view.state.sliceDoc(d.src.from, d.src.to);
        const firstLine = text.split('\n')[0].replace(/^\s*([-*+]|\d+[.)])\s+(\[[ xX]\]\s+)?|^#{1,6}\s+|^>\s?/g, '').replace(/[*_`~]/g, '').trim();
        const more = text.split('\n').length - 1;
        card.textContent = firstLine || 'Block';
        if (more) {
            const extra = document.createElement('span');
            extra.className = 'cm-block-ghost-more';
            extra.textContent = ` +${more} line${more > 1 ? 's' : ''}`;
            card.append(extra);
        }
        document.body.append(card);
        d.card = card;
        this.grip.classList.add('dragging');
    }

    move(e) {
        const d = this.drag;
        if (!d || e.pointerId !== d.id) return;
        if (!d.started) {
            if (Math.hypot(e.clientX - d.x, e.clientY - d.y) < 6) return;
            this.start();
        }
        e.preventDefault();
        // Above the finger, so neither hides the insertion line.
        d.card.style.transform = `translate(${Math.round(Math.max(8, e.clientX - 24))}px, ${Math.round(e.clientY - 64)}px)`;
        // Nearest gap between blocks.
        const view = this.view;
        let best = null;
        for (const b of this.blocks) {
            const lb = view.lineBlockAt(b.from);
            const le = view.lineBlockAt(b.to);
            const top = view.documentTop + lb.top;
            const bottom = view.documentTop + le.bottom;
            for (const [y, before] of [[top, true], [bottom, false]]) {
                const dist = Math.abs(e.clientY - y);
                if (!best || dist < best.dist) best = { dist, y, before, block: b };
            }
        }
        d.drop = best && moveChanges(view.state, d.src, best.block, best.before) ? best : null;
        if (d.drop) {
            const scroller = view.scrollDOM.getBoundingClientRect();
            const coords = view.coordsAtPos(d.drop.block.from, 1);
            this.line.style.top = `${d.drop.y - scroller.top + view.scrollDOM.scrollTop}px`;
            this.line.style.left = `${(coords ? coords.left : view.contentDOM.getBoundingClientRect().left) - scroller.left}px`;
            this.line.classList.add('visible');
        } else {
            this.line.classList.remove('visible');
        }
        // Scroll near the edges.
        const r = view.scrollDOM.getBoundingClientRect();
        if (e.clientY < r.top + 48) view.scrollDOM.scrollTop -= 10;
        else if (e.clientY > r.bottom - 48) view.scrollDOM.scrollTop += 10;
    }

    up(e) {
        const d = this.drag;
        if (!d || e.pointerId !== d.id) return;
        this.grip.removeEventListener('pointermove', this.onMove);
        this.grip.removeEventListener('pointerup', this.onUp);
        this.grip.removeEventListener('pointercancel', this.onUp);
        this.drag = null;
        this.line.classList.remove('visible');
        this.grip.classList.remove('dragging');
        d.card?.remove();
        if (!d.started) {
            if (e.type === 'pointerup') this.openMenu(d.src);
            return;
        }
        const effects = [setDragged.of(null)];
        const move = e.type === 'pointerup' && d.drop ? moveChanges(this.view.state, d.src, d.drop.block, d.drop.before) : null;
        if (move) {
            this.view.dispatch({ changes: move.changes, selection: { anchor: move.cursor }, effects, userEvent: 'move.drag', scrollIntoView: true });
        } else {
            this.view.dispatch({ effects });
        }
        this.view.focus();
    }

    moveBy(src, dir) {
        const siblings = this.blocks.filter((b) => b.depth === src.depth && b.listItem === src.listItem);
        const i = siblings.indexOf(siblings.find((b) => b.from === src.from));
        const other = siblings[i + dir];
        const move = other ? moveChanges(this.view.state, src, other, dir < 0) : null;
        if (move) {
            this.view.dispatch({ changes: move.changes, selection: { anchor: move.cursor }, userEvent: 'move', scrollIntoView: true });
        }
        this.view.focus();
    }

    openMenu(src) {
        this.closeMenu();
        const menu = document.createElement('div');
        menu.className = 'cm-block-menu';
        menu.setAttribute('role', 'menu');
        const siblings = this.blocks.filter((b) => b.depth === src.depth && b.listItem === src.listItem);
        const i = siblings.findIndex((b) => b.from === src.from);
        for (const [label, dir, icon] of [['Move up', -1, 'M6 15l6-6 6 6'], ['Move down', 1, 'M6 9l6 6 6-6']]) {
            const btn = document.createElement('button');
            btn.type = 'button';
            btn.setAttribute('role', 'menuitem');
            btn.disabled = !siblings[i + dir];
            btn.innerHTML = `<svg viewBox="0 0 24 24" width="18" height="18" aria-hidden="true"><path d="${icon}" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/></svg><span>${label}</span>`;
            btn.addEventListener('mousedown', (ev) => ev.preventDefault());
            btn.addEventListener('click', () => {
                this.closeMenu();
                this.moveBy(src, dir);
            });
            menu.append(btn);
        }
        menu.style.top = this.grip.style.top;
        menu.style.left = `${parseFloat(this.grip.style.left) + 34}px`;
        this.view.scrollDOM.append(menu);
        this.menu = menu;
        this.outside = (ev) => {
            if (!menu.contains(ev.target) && ev.target !== this.grip && !this.grip.contains(ev.target)) this.closeMenu();
        };
        setTimeout(() => document.addEventListener('pointerdown', this.outside, true), 0);
    }

    closeMenu() {
        if (!this.menu) return;
        this.menu.remove();
        this.menu = null;
        document.removeEventListener('pointerdown', this.outside, true);
    }

    destroy() {
        this.closeMenu();
        this.grip.remove();
        this.line.remove();
        this.drag?.card?.remove();
        this.view.contentDOM.removeEventListener('pointermove', this.onHover);
    }
});

export function blockHandles() {
    return [draggedField, plugin];
}
