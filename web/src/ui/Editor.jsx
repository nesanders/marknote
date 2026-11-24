// SPDX-FileCopyrightText: 2026 Marknote fork contributors
// SPDX-License-Identifier: GPL-2.0-only OR GPL-3.0-only OR LicenseRef-KDE-Accepted-GPL

import { useEffect, useRef } from 'preact/hooks';
import { EditorView, keymap, placeholder } from '@codemirror/view';
import { Compartment, EditorState } from '@codemirror/state';
import { basicSetup } from 'codemirror';
import { markdown, markdownLanguage } from '@codemirror/lang-markdown';
import { languages } from '@codemirror/language-data';
import { indentWithTab } from '@codemirror/commands';
import { HighlightStyle, syntaxHighlighting } from '@codemirror/language';
import { tags as t } from '@lezer/highlight';
import { livePreview } from './livepreview.js';
import { slashSource } from './slash.js';

const markdownStyle = HighlightStyle.define([
    { tag: t.heading1, fontWeight: '700', fontSize: '1.45em' },
    { tag: t.heading2, fontWeight: '700', fontSize: '1.25em' },
    { tag: [t.heading3, t.heading4, t.heading5, t.heading6], fontWeight: '700', fontSize: '1.08em' },
    { tag: t.strong, fontWeight: '700' },
    { tag: t.emphasis, fontStyle: 'italic' },
    { tag: t.strikethrough, textDecoration: 'line-through' },
    { tag: t.link, color: 'var(--accent-strong)' },
    { tag: t.url, color: 'var(--muted)' },
    { tag: t.monospace, fontFamily: 'var(--mono)', fontSize: '0.92em' },
    { tag: [t.processingInstruction, t.contentSeparator, t.meta], color: 'var(--muted)' },
    { tag: t.quote, color: 'var(--muted)' },
    { tag: [t.keyword, t.atom, t.bool], color: '#8e44ad' },
    { tag: [t.string, t.special(t.string)], color: '#27ae60' },
    { tag: [t.number], color: '#d35400' },
    { tag: [t.comment], color: 'var(--muted)', fontStyle: 'italic' },
]);

/** Wrap the selection (or insert a placeholder) with before/after. */
function wrap(view, before, after = before, fallback = 'text') {
    const { from, to } = view.state.selection.main;
    const selected = view.state.sliceDoc(from, to) || fallback;
    view.dispatch({
        changes: { from, to, insert: before + selected + after },
        selection: { anchor: from + before.length, head: from + before.length + selected.length },
    });
    view.focus();
}

/** Toggle a line prefix ("# ", "- ", "- [ ] ", "> ") on the selected lines. */
function prefixLines(view, prefix) {
    const { state } = view;
    const { from, to } = state.selection.main;
    const first = state.doc.lineAt(from).number;
    const last = state.doc.lineAt(to).number;
    const changes = [];
    let allHave = true;
    for (let n = first; n <= last; ++n) {
        if (!state.doc.line(n).text.startsWith(prefix)) allHave = false;
    }
    for (let n = first; n <= last; ++n) {
        const line = state.doc.line(n);
        if (allHave) {
            changes.push({ from: line.from, to: line.from + prefix.length, insert: '' });
        } else {
            const stripped = line.text.match(/^(#{1,6} |[-*+] \[[ xX]\] |[-*+] |\d+[.)] |> )?/)[0];
            changes.push({ from: line.from, to: line.from + stripped.length, insert: prefix });
        }
    }
    view.dispatch({ changes });
    view.focus();
}

export const actions = {
    bold: (v) => wrap(v, '**'),
    italic: (v) => wrap(v, '*'),
    code: (v) => wrap(v, '`', '`', 'code'),
    link: (v) => wrap(v, '[', '](https://)', 'link'),
    insert: (v, text) => {
        const { from, to } = v.state.selection.main;
        const line = v.state.doc.lineAt(from);
        const pre = from > line.from && !/\s$/.test(line.text.slice(0, from - line.from)) ? ' ' : '';
        v.dispatch({ changes: { from, to, insert: pre + text }, selection: { anchor: from + pre.length + text.length } });
        v.focus();
    },
    heading: (v) => prefixLines(v, '## '),
    bullet: (v) => prefixLines(v, '- '),
    task: (v) => prefixLines(v, '- [ ] '),
    quote: (v) => prefixLines(v, '> '),
};

const theme = EditorView.theme({
    '&': { height: '100%', fontSize: 'calc(1rem * var(--font-scale))', backgroundColor: 'var(--view-bg)', color: 'var(--text)' },
    '.cm-scroller': { fontFamily: 'var(--sans)', lineHeight: '1.6', padding: '0.75rem 0' },
    '.cm-content': { maxWidth: '52rem', margin: '0 auto', padding: '0 1rem', caretColor: 'var(--accent)' },
    '.cm-gutters': { display: 'none' },
    '.cm-activeLine': { backgroundColor: 'transparent' },
    '&.cm-focused': { outline: 'none' },
    '.cm-selectionBackground, &.cm-focused .cm-selectionBackground': { backgroundColor: 'var(--selection) !important' },
});

/**
 * Markdown source editor. onChange gets the full text (debounced by the caller).
 * Exposes the EditorView through viewRef for the toolbar.
 */
export function Editor({ value, onChange, viewRef, autoFocus, live = true, resolveImage, onImage, onImageFiles }) {
    const host = useRef(null);
    const changeRef = useRef(onChange);
    changeRef.current = onChange;
    const imageRef = useRef(onImage);
    imageRef.current = onImage;
    const filesRef = useRef(onImageFiles);
    filesRef.current = onImageFiles;
    const resolveRef = useRef(resolveImage);
    resolveRef.current = resolveImage;
    const mode = useRef(new Compartment());
    const preview = () => (live ? [livePreview((src) => resolveRef.current?.(src) ?? Promise.resolve({ missing: src })), EditorView.editorAttributes.of({ class: 'cm-live' })] : [EditorView.editorAttributes.of({ class: 'cm-source' })]);

    useEffect(() => {
        const slashData = [{ autocomplete: slashSource(() => imageRef.current?.()) }];
        const view = new EditorView({
            parent: host.current,
            state: EditorState.create({
                doc: value,
                extensions: [
                    basicSetup,
                    keymap.of([
                        indentWithTab,
                        { key: 'Mod-b', run: (v) => (actions.bold(v), true) },
                        { key: 'Mod-i', run: (v) => (actions.italic(v), true) },
                    ]),
                    markdown({ base: markdownLanguage, codeLanguages: languages, completeHTMLTags: false }),
                    // One source object: autocomplete tells sources apart by identity.
                    EditorState.languageData.of(() => slashData),
                    mode.current.of(preview()),
                    EditorView.domEventHandlers({
                        paste(e) {
                            const files = [...(e.clipboardData?.files ?? [])].filter((f) => f.type.startsWith('image/'));
                            if (!files.length || !filesRef.current) return false;
                            e.preventDefault();
                            filesRef.current(files);
                            return true;
                        },
                        drop(e, view) {
                            const files = [...(e.dataTransfer?.files ?? [])].filter((f) => f.type.startsWith('image/'));
                            if (!files.length || !filesRef.current) return false;
                            e.preventDefault();
                            const pos = view.posAtCoords({ x: e.clientX, y: e.clientY });
                            if (pos !== null) view.dispatch({ selection: { anchor: pos } });
                            filesRef.current(files);
                            return true;
                        },
                    }),
                    syntaxHighlighting(markdownStyle, { fallback: false }),
                    EditorView.lineWrapping,
                    placeholder('Write in Markdown…'),
                    theme,
                    EditorView.contentAttributes.of({ autocapitalize: 'sentences', spellcheck: 'true', 'aria-label': 'Note text' }),
                    EditorView.updateListener.of((u) => {
                        if (u.docChanged) changeRef.current(u.state.doc.toString());
                    }),
                ],
            }),
        });
        if (viewRef) viewRef.current = view;
       
        if (autoFocus) view.focus();
        return () => {
            view.destroy();
            if (viewRef) viewRef.current = null;
        };
    }, []);

    useEffect(() => {
        viewRef?.current?.dispatch({ effects: mode.current.reconfigure(preview()) });
    }, [live]);

    // Text replaced from outside (conflict resolution, reload): reset the doc.
    useEffect(() => {
        const view = viewRef?.current;
        if (view && view.state.doc.toString() !== value) {
            view.dispatch({ changes: { from: 0, to: view.state.doc.length, insert: value } });
        }
    }, [value]);

    return <div class="editor" ref={host} />;
}
