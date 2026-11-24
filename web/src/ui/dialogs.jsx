// SPDX-FileCopyrightText: 2026 Marknote fork contributors
// SPDX-License-Identifier: GPL-2.0-only OR GPL-3.0-only OR LicenseRef-KDE-Accepted-GPL

import { useEffect, useMemo, useRef, useState } from 'preact/hooks';
import { Icon, ItemIcon } from './icons.jsx';
import { normalizeTag } from '../frontmatter.js';
import { EMOJI } from './emoji.js';

export function Dialog({ title, onClose, children, footer, wide }) {
    const ref = useRef(null);
    useEffect(() => {
        const key = (e) => e.key === 'Escape' && onClose();
        document.addEventListener('keydown', key);
        // A field first, then the main button; never the close button by accident.
        const root = ref.current;
        const focusable = root?.querySelector('.dialog-body input:not([type=hidden]):not([readonly]), .dialog-body textarea, .dialog-body select')
            ?? root?.querySelector('footer button.primary, footer button.danger, .dialog-body button, footer button');
        focusable?.focus();
        return () => document.removeEventListener('keydown', key);
    }, []);
    return (
        <div class="overlay" onClick={(e) => e.target === e.currentTarget && onClose()}>
            <div class={'dialog' + (wide ? ' wide' : '')} role="dialog" aria-modal="true" aria-label={title} ref={ref}>
                <header>
                    <h2>{title}</h2>
                    <button class="icon-button" onClick={onClose} aria-label="Close"><Icon name="close" /></button>
                </header>
                <div class="dialog-body">{children}</div>
                {footer && <footer>{footer}</footer>}
            </div>
        </div>
    );
}

export function PromptDialog({ title, label, initial = '', okText = 'OK', onOk, onClose, hint }) {
    const [value, setValue] = useState(initial);
    const [error, setError] = useState('');
    const [busy, setBusy] = useState(false);
    const submit = async (e) => {
        e?.preventDefault();
        if (!value.trim()) return;
        setBusy(true);
        try {
            await onOk(value.trim());
            onClose();
        } catch (err) {
            setError(err.message);
            setBusy(false);
        }
    };
    return (
        <Dialog title={title} onClose={onClose}
            footer={<><button onClick={onClose}>Cancel</button><button class="primary" disabled={!value.trim() || busy} onClick={submit}>{okText}</button></>}>
            <form onSubmit={submit}>
                <label class="field">
                    <span>{label}</span>
                    <input value={value} autofocus onInput={(e) => setValue(e.target.value)}
                        onFocus={(e) => e.target.select()} />
                </label>
                {hint && <p class="hint">{hint}</p>}
                {error && <p class="error">{error}</p>}
            </form>
        </Dialog>
    );
}

export function ConfirmDialog({ title, message, okText = 'OK', danger, onOk, onClose }) {
    const [busy, setBusy] = useState(false);
    const [error, setError] = useState('');
    const ok = async () => {
        setBusy(true);
        try {
            await onOk();
            onClose();
        } catch (e) {
            setError(e.message);
            setBusy(false);
        }
    };
    return (
        <Dialog title={title} onClose={onClose}
            footer={<><button onClick={onClose}>Cancel</button><button class={danger ? 'danger' : 'primary'} disabled={busy} onClick={ok}>{okText}</button></>}>
            <p>{message}</p>
            {error && <p class="error">{error}</p>}
        </Dialog>
    );
}

/** A menu: a popover on wide screens, an action sheet on phones. */
export function Menu({ title, items, onClose }) {
    return (
        <div class="overlay sheet-overlay" onClick={(e) => e.target === e.currentTarget && onClose()}>
            <div class="sheet" role="menu" aria-label={title}>
                {title && <div class="sheet-title">{title}</div>}
                {items.filter(Boolean).map((it) => it.separator ? <hr /> : (
                    <button role="menuitem" class={'sheet-item' + (it.danger ? ' danger-text' : '')} disabled={it.disabled}
                        onClick={() => {
                            onClose();
                            it.action();
                        }}>
                        <Icon name={it.icon ?? 'note'} /> <span>{it.label}</span>
                    </button>
                ))}
                <button class="sheet-item sheet-cancel" onClick={onClose}>Cancel</button>
            </div>
        </div>
    );
}

export function IconPicker({ title, current, onPick, onClose }) {
    const [query, setQuery] = useState('');
    const [custom, setCustom] = useState('');
    const results = useMemo(() => {
        const q = query.trim().toLowerCase();
        if (!q) return EMOJI;
        return EMOJI.filter(([, words]) => words.includes(q));
    }, [query]);
    const pick = async (icon) => {
        await onPick(icon);
        onClose();
    };
    return (
        <Dialog title={title} onClose={onClose} wide
            footer={<><button onClick={() => pick('')} disabled={!current}>Remove Icon</button><button onClick={onClose}>Cancel</button></>}>
            <div class="picker-search">
                <Icon name="search" />
                <input placeholder="Search emoji (e.g. book, idea, heart)" value={query} autofocus onInput={(e) => setQuery(e.target.value)} />
            </div>
            <div class="emoji-grid" role="listbox">
                {results.map(([e, words]) => (
                    <button class={'emoji-cell' + (e === current ? ' selected' : '')} title={words.split(' ')[0]} aria-label={words.split(' ')[0]} onClick={() => pick(e)}>{e}</button>
                ))}
                {!results.length && <p class="hint">No match. Paste any emoji below.</p>}
            </div>
            <form class="row" onSubmit={(e) => {
                e.preventDefault();
                if (custom.trim()) pick(custom.trim());
            }}>
                <input placeholder="Or paste an emoji" value={custom} onInput={(e) => setCustom(e.target.value)} maxLength={16} />
                <button type="submit" disabled={!custom.trim()}>Use</button>
            </form>
        </Dialog>
    );
}

export function TagEditor({ noteTitle, tags, allTags, onChange, onClose }) {
    const [current, setCurrent] = useState(tags);
    const [input, setInput] = useState('');
    const [error, setError] = useState('');
    const q = normalizeTag(input).toLowerCase();
    const suggestions = allTags.filter((t) => !current.includes(t.name) && (!q || t.name.toLowerCase().includes(q))).slice(0, 8);
    const canCreate = q && !allTags.some((t) => t.name.toLowerCase() === q) && !current.includes(normalizeTag(input));
    const apply = async (next) => {
        setCurrent(next);
        try {
            await onChange(next);
            setError('');
        } catch (e) {
            setError(e.message);
        }
    };
    const add = (tag) => {
        const t = normalizeTag(tag);
        if (t && !current.includes(t)) apply([...current, t]);
        setInput('');
    };
    return (
        <Dialog title={noteTitle ? `Tags for “${noteTitle}”` : 'Tags'} onClose={onClose} footer={<button class="primary" onClick={onClose}>Done</button>}>
            <div class="chips">
                {current.length === 0 && <span class="hint">No tags yet.</span>}
                {current.map((t) => (
                    <span class="chip">
                        {t}
                        <button aria-label={`Remove ${t}`} onClick={() => apply(current.filter((x) => x !== t))}><Icon name="close" size={14} /></button>
                    </span>
                ))}
            </div>
            <form onSubmit={(e) => {
                e.preventDefault();
                if (suggestions.length && !canCreate) add(suggestions[0].name);
                else if (input.trim()) add(input);
            }}>
                <input placeholder="Add a tag" value={input} autofocus onInput={(e) => setInput(e.target.value)} />
            </form>
            <div class="suggestions">
                {canCreate && <button class="suggestion" onClick={() => add(input)}><Icon name="plus" size={16} /> Create “{normalizeTag(input)}”</button>}
                {suggestions.map((t) => <button class="suggestion" onClick={() => add(t.name)}><Icon name="tag" size={16} /> {t.name} <span class="count">{t.count}</span></button>)}
            </div>
            {error && <p class="error">{error}</p>}
        </Dialog>
    );
}

/** Pick a destination folder in the current notebook. */
export function MovePicker({ library, item, onClose, onMoved }) {
    const [error, setError] = useState('');
    const folders = [];
    const walk = (parentId, depth) => {
        for (const f of library.children(parentId).filter((c) => c.isFolder).sort((a, b) => a.title.localeCompare(b.title))) {
            if (item.isFolder && library.isInside(item.id, f.id)) continue;
            folders.push({ f, depth });
            walk(f.id, depth + 1);
        }
    };
    walk(null, 1);
    const move = async (to) => {
        try {
            await library.move(item.id, to);
            onMoved?.();
            onClose();
        } catch (e) {
            setError(e.message);
        }
    };
    return (
        <Dialog title={`Move “${item.title}”`} onClose={onClose} footer={<button onClick={onClose}>Cancel</button>}>
            <div class="folder-list">
                <button class="folder-choice" disabled={item.parentId === null} onClick={() => move(null)}>
                    <Icon name="notebook" /> {library.notebook.name} <span class="hint">(top level)</span>
                </button>
                {folders.map(({ f, depth }) => (
                    <button class="folder-choice" style={{ paddingLeft: `${depth * 1.1 + 0.6}rem` }} disabled={item.parentId === f.id} onClick={() => move(f.id)}>
                        <ItemIcon item={f} /> {f.title}
                    </button>
                ))}
            </div>
            {error && <p class="error">{error}</p>}
        </Dialog>
    );
}
