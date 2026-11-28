// SPDX-FileCopyrightText: 2026 Marknote fork contributors
// SPDX-License-Identifier: GPL-2.0-only OR GPL-3.0-only OR LicenseRef-KDE-Accepted-GPL
//
// A click (or tap) below the last line continues the note: into the last line
// when it is empty, else into a new paragraph after it. Without this the
// cursor lands at the end of the last block, which is awkward after a table,
// a diagram or a to-do block.

import { ViewPlugin } from '@codemirror/view';

/** The change that gives the note an empty last paragraph, and where the cursor goes. */
export function continueAtEnd(doc) {
    // A new paragraph needs a blank line before it (or it would continue the
    // list or paragraph above), so the end should look like "text", "", "|".
    const end = doc.length;
    const blank = (n) => n >= 1 && !doc.line(n).text.trim();
    const n = doc.lines;
    if (n === 1 && blank(1)) return { changes: null, cursor: end };
    if (blank(n) && blank(n - 1)) return { changes: null, cursor: end };
    const insert = blank(n) ? '\n' : '\n\n';
    return { changes: { from: end, insert }, cursor: end + insert.length };
}

const plugin = ViewPlugin.fromClass(class {
    constructor(view) {
        this.view = view;
        this.down = (e) => {
            if (e.button !== 0 || e.shiftKey || e.ctrlKey || e.metaKey) return;
            // Not on the scrollbar (it is part of the scroller element too).
            const box = view.scrollDOM.getBoundingClientRect();
            if (e.clientX >= box.left + view.scrollDOM.clientLeft + view.scrollDOM.clientWidth) return;
            const { doc } = view.state;
            // Where the text really ends on screen (widget heights may not be measured yet).
            const end = view.coordsAtPos(doc.length, -1);
            const bottom = end ? end.bottom : view.documentTop + view.lineBlockAt(doc.length).bottom;
            if (e.clientY <= bottom) return;
            // Only the empty area under the text, not scrollbars or widgets placed there.
            if (e.target !== view.scrollDOM && e.target !== view.contentDOM && !e.target.classList?.contains('cm-scroller')) return;
            e.preventDefault();
            e.stopPropagation();
            const { changes, cursor } = continueAtEnd(doc);
            view.dispatch({ changes: changes ?? undefined, selection: { anchor: cursor }, scrollIntoView: true, userEvent: 'input' });
            view.focus();
        };
        view.scrollDOM.addEventListener('mousedown', this.down, true);
    }
    destroy() {
        this.view.scrollDOM.removeEventListener('mousedown', this.down, true);
    }
});

export function clickBelowToContinue() {
    return plugin;
}
