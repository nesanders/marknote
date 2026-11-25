// SPDX-FileCopyrightText: 2026 Marknote fork contributors
// SPDX-License-Identifier: GPL-2.0-only OR GPL-3.0-only OR LicenseRef-KDE-Accepted-GPL
//
// "/" at the start of a line offers blocks to insert, like the desktop app's
// slash menu, each with its Markdown shortcut as a hint.

/** [label, section, markdown hint, text to insert ("|" marks the cursor)] */
const BLOCKS = [
    ['Text', 'Text', '', '|'],
    ['Heading 1', 'Text', '#', '# |'],
    ['Heading 2', 'Text', '##', '## |'],
    ['Heading 3', 'Text', '###', '### |'],
    ['Quote', 'Text', '>', '> |'],
    ['Bulleted list', 'Lists', '-', '- |'],
    ['Numbered list', 'Lists', '1.', '1. |'],
    ['Checklist', 'Lists', '- [ ]', '- [ ] |'],
    ['To-do list', 'Lists', 'with Done', '<!-- marknote-todo -->\n- [ ] |'],
    ['Code block', 'Blocks', '```', '```\n|\n```'],
    ['Table', 'Blocks', '|', '| Column | Column |\n| --- | --- |\n| | |'],
    ['Divider', 'Blocks', '---', '---\n|'],
    ['Math', 'Blocks', '$$', '$$\n|\n$$'],
    ['Diagram (Mermaid)', 'Blocks', '```mermaid', '```mermaid\ngraph TD\n    A[Start] --> B[Next]|\n```'],
    ['Image…', 'Blocks', '![]()', null],
];

export function slashSource(onImage) {
    return (context) => {
        const line = context.state.doc.lineAt(context.pos);
        const before = context.state.sliceDoc(line.from, context.pos);
        const m = /^(\s*(?:>\s?)*)\/([\w ]*)$/.exec(before); // also inside quotes
        if (!m) return null;
        // Options are matched against the word after "/"; applying also removes the "/".
        const from = line.from + m[1].length + 1;
        return {
            from,
            filter: true,
            options: BLOCKS.map(([label, section, hint, insert], i) => ({
                label,
                detail: hint,
                section,
                boost: -i,
                apply: (view, _completion, afterSlash, applyTo) => {
                    const applyFrom = afterSlash - 1;
                    if (insert === null) {
                        view.dispatch({ changes: { from: applyFrom, to: applyTo, insert: '' } });
                        onImage?.();
                        return;
                    }
                    const at = insert.indexOf('|');
                    const text = insert.replace('|', '');
                    view.dispatch({ changes: { from: applyFrom, to: applyTo, insert: text }, selection: { anchor: applyFrom + at } });
                },
            })),
        };
    };
}
