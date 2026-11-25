// SPDX-FileCopyrightText: 2026 Marknote fork contributors
// SPDX-License-Identifier: GPL-2.0-only OR GPL-3.0-only OR LicenseRef-KDE-Accepted-GPL
//
// To-do blocks in the live editor: the marker line becomes a slim header with
// the order switch, dates become chips that open the due-date picker, and the
// Done section folds into one "Done (n)" row, collapsed until tapped. Ticking a
// box in a block moves the item (see ../todo.js).

import { Prec, RangeSetBuilder, StateEffect, StateField } from '@codemirror/state';
import { Decoration, EditorView, WidgetType } from '@codemirror/view';
import * as Todo from '../todo.js';
import { openDuePicker } from './duepicker.js';

/** Replaces the document with `body`, as one minimal change (keeps undo tidy and the cursor put). */
export function dispatchBody(view, body) {
    const old = view.state.doc.toString();
    if (old === body) return;
    let a = 0;
    while (a < old.length && a < body.length && old[a] === body[a]) a += 1;
    let b = 0;
    while (b < old.length - a && b < body.length - a && old[old.length - 1 - b] === body[body.length - 1 - b]) b += 1;
    view.dispatch({ changes: { from: a, to: old.length - b, insert: body.slice(a, body.length - b) }, userEvent: 'input.todo' });
}

/** Applies a to-do operation in the editor; false when `op.line` is not in a block. */
export function applyInEditor(view, op) {
    const body = Todo.apply(view.state.doc.toString(), op);
    if (body === null) return false;
    dispatchBody(view, body);
    return true;
}

/** For the checkbox widget: tick/untick line (0-based) with the to-do rules if it is in a block. */
export function toggleInEditor(view, line, checked) {
    return applyInEditor(view, { type: 'toggle', line, checked });
}

const toggleDone = StateEffect.define({ map: (pos, mapping) => mapping.mapPos(pos) });

/** Marker positions of blocks whose Done section is open in this editor. */
const openDone = StateField.define({
    create: () => [],
    update(value, tr) {
        let out = tr.docChanged ? value.map((p) => tr.changes.mapPos(p)) : value;
        for (const e of tr.effects) {
            if (!e.is(toggleDone)) continue;
            out = out.includes(e.value) ? out.filter((p) => p !== e.value) : [...out, e.value];
        }
        return out;
    },
});

const lineOf = (view, el) => view.state.doc.lineAt(view.posAtDOM(el)).number - 1;

class HeadWidget extends WidgetType {
    constructor(sort) {
        super();
        this.sort = sort;
    }
    eq(o) {
        return o.sort === this.sort;
    }
    toDOM(view) {
        const el = document.createElement('div');
        el.className = 'cm-todo-head';
        const b = document.createElement('button');
        b.type = 'button';
        b.className = 'todo-sort';
        b.textContent = this.sort === 'due' ? 'By due date' : 'Manual order';
        b.title = 'Change the order';
        b.addEventListener('mousedown', (e) => e.preventDefault());
        b.addEventListener('click', () => applyInEditor(view, { type: 'sort', line: lineOf(view, el), sort: this.sort === 'due' ? 'manual' : 'due' }));
        el.appendChild(b);
        return el;
    }
    ignoreEvent() {
        return true;
    }
}

class DoneWidget extends WidgetType {
    constructor(count, open, marker) {
        super();
        this.count = count;
        this.open = open;
        this.marker = marker;
    }
    eq(o) {
        return o.count === this.count && o.open === this.open && o.marker === this.marker;
    }
    toDOM(view) {
        const el = document.createElement('div');
        el.className = 'cm-todo-done' + (this.open ? ' open' : '');
        el.textContent = `Done (${this.count})`;
        el.setAttribute('role', 'button');
        el.setAttribute('aria-expanded', String(this.open));
        el.addEventListener('mousedown', (e) => e.preventDefault());
        el.addEventListener('click', () => view.dispatch({ effects: toggleDone.of(this.marker) }));
        return el;
    }
    ignoreEvent() {
        return true;
    }
}

class EndWidget extends WidgetType {
    eq() {
        return true;
    }
    toDOM() {
        const el = document.createElement('div');
        el.className = 'cm-todo-end';
        return el;
    }
}

class DueWidget extends WidgetType {
    constructor(due, today, done = false) {
        super();
        this.due = due;
        this.today = today;
        this.done = done;
    }
    eq(o) {
        return o.due === this.due && o.today === this.today && o.done === this.done;
    }
    toDOM(view) {
        const b = document.createElement('button');
        b.type = 'button';
        if (this.due) {
            const { label, state } = Todo.dueInfo(this.due, this.today);
            b.className = 'cm-due' + (state && !this.done ? ' ' + state : '');
            b.textContent = `📅 ${label}`;
            b.title = `Due ${this.due}`;
        } else {
            b.className = 'cm-due-add';
            b.textContent = '📅';
            b.title = 'Add due date';
            b.setAttribute('aria-label', 'Add due date');
        }
        b.addEventListener('mousedown', (e) => e.preventDefault());
        b.addEventListener('click', () => {
            const line = lineOf(view, b);
            openDuePicker(b, this.due, (date) => applyInEditor(view, { type: 'due', line, date }));
        });
        return b;
    }
    ignoreEvent() {
        return true;
    }
}

class DoneDateWidget extends WidgetType {
    constructor(done, today) {
        super();
        this.done = done;
        this.today = today;
    }
    eq(o) {
        return o.done === this.done && o.today === this.today;
    }
    toDOM() {
        const s = document.createElement('span');
        s.className = 'cm-done-date';
        s.textContent = `✓ ${Todo.dueInfo(this.done, this.today).label}`;
        s.title = `Completed ${this.done}`;
        return s;
    }
}

class MakeWidget extends WidgetType {
    eq() {
        return true;
    }
    toDOM(view) {
        const b = document.createElement('button');
        b.type = 'button';
        b.className = 'cm-make-todo';
        b.textContent = 'Make to-do block';
        b.title = 'Ticked items move to a Done section';
        b.addEventListener('mousedown', (e) => e.preventDefault());
        b.addEventListener('click', () => {
            const body = Todo.makeBlock(view.state.doc.toString(), lineOf(view, b));
            if (body !== null) dispatchBody(view, body);
        });
        return b;
    }
    ignoreEvent() {
        return true;
    }
}

const DUE_TOKEN = /\s?📅\s*(\d{4}-\d{2}-\d{2})/u;
const DONE_TOKEN = /\s?✅\s*(\d{4}-\d{2}-\d{2})/u;

function build(state) {
    const doc = state.doc;
    const body = doc.toString();
    const today = Todo.localToday();
    const open = state.field(openDone);
    const cursorLines = new Set(state.selection.ranges.map((r) => doc.lineAt(r.head).number - 1));
    const decos = [];
    const add = (from, to, deco) => decos.push(deco.range(from, to));
    const L = (n) => doc.line(n + 1);

    const blocks = Todo.findBlocks(body);
    for (const block of blocks) {
        const marker = L(block.start);
        if (!cursorLines.has(block.start)) add(marker.from, marker.to, Decoration.replace({ widget: new HeadWidget(block.options.sort), block: true }));
        const items = [...block.open, ...block.done];
        for (const it of items) {
            const ln = L(it.line);
            const text = ln.text;
            const due = DUE_TOKEN.exec(text);
            if (due) add(ln.from + due.index, ln.from + due.index + due[0].length, Decoration.replace({ widget: new DueWidget(due[1], today, it.checked) }));
            else if (!it.checked && cursorLines.has(it.line)) add(ln.to, ln.to, Decoration.widget({ widget: new DueWidget(null, today), side: 1 }));
            const done = DONE_TOKEN.exec(text);
            if (done) add(ln.from + done.index, ln.from + done.index + done[0].length, Decoration.replace({ widget: new DoneDateWidget(done[1], today) }));
        }
        if (block.doneStart < 0) continue;
        // From just after the open list to just before the first done item: the fold header.
        const lastOpen = block.open.length ? block.open[block.open.length - 1] : null;
        const headFrom = lastOpen ? lastOpen.line + lastOpen.extra.length + 1 : block.start + 1;
        const isOpen = open.includes(marker.from);
        const widget = new DoneWidget(block.done.length, isOpen, marker.from);
        const lastLine = block.end - 1;
        if (!isOpen || !block.done.length) {
            add(L(headFrom).from, L(lastLine).to, Decoration.replace({ widget, block: true }));
            continue;
        }
        const firstDone = block.done[0].line;
        const lastD = block.done[block.done.length - 1];
        add(L(headFrom).from, L(firstDone - 1).to, Decoration.replace({ widget, block: true }));
        add(L(lastD.line + lastD.extra.length + 1).from, L(lastLine).to, Decoration.replace({ widget: new EndWidget(), block: true }));
    }

    // A plain checklist under the cursor can become a to-do block.
    const cur = [...cursorLines][0];
    if (cursorLines.size === 1 && !Todo.locate(body, cur) && /^\s{0,3}[-*+]\s+\[[ xX]\]/.test(L(cur).text)) {
        let first = cur;
        while (first > 0 && /^\s{0,3}[-*+]\s+\[[ xX]\]|^\s+\S/.test(L(first - 1).text)) first -= 1;
        if (!/^\s*<!--\s*marknote-todo/.test(first > 0 ? L(first - 1).text : '')) {
            add(L(cur).to, L(cur).to, Decoration.widget({ widget: new MakeWidget(), side: 2 }));
        }
    }

    decos.sort((a, b) => a.from - b.from || a.value.startSide - b.value.startSide);
    const builder = new RangeSetBuilder();
    for (const d of decos) builder.add(d.from, d.to, d.value);
    return builder.finish();
}

const decorations = StateField.define({
    create: (state) => build(state),
    update(value, tr) {
        if (tr.docChanged || tr.selection || tr.effects.some((e) => e.is(toggleDone))) return build(tr.state);
        return value;
    },
    provide: (f) => [EditorView.decorations.from(f), EditorView.atomicRanges.of((view) => view.state.field(f))],
});

/** The editor extension (live mode only). */
export function todoBlocks() {
    return [openDone, Prec.high(decorations)];
}
