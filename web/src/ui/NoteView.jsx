// SPDX-FileCopyrightText: 2026 Marknote fork contributors
// SPDX-License-Identifier: GPL-2.0-only OR GPL-3.0-only OR LicenseRef-KDE-Accepted-GPL

import { useEffect, useMemo, useRef, useState } from 'preact/hooks';
import * as FM from '../frontmatter.js';
import { renderMarkdown, toggleTask } from '../markdown.js';
import { enhance } from '../extras.js';
import { Editor, actions } from './Editor.jsx';
import { Icon, ItemIcon } from './icons.jsx';
import { UnlockForm } from './dialogs.jsx';
import { LockedError } from '../library.js';

const SAVE_DELAY = 1200;

export function formatCreated(date) {
    if (!date) return '';
    const now = new Date();
    const sameDay = date.toDateString() === now.toDateString();
    const minutes = (now - date) / 60000;
    if (minutes >= 0 && minutes < 1) return 'Just now';
    if (minutes >= 0 && minutes < 60) return `${Math.round(minutes)} minutes ago`;
    if (sameDay) return `Today at ${date.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' })}`;
    const yesterday = new Date(now);
    yesterday.setDate(now.getDate() - 1);
    if (date.toDateString() === yesterday.toDateString()) return 'Yesterday';
    return date.toLocaleDateString([], { year: '2-digit', month: 'numeric', day: 'numeric' });
}

/**
 * One note: metadata strip, rendered Markdown, or the source editor.
 * Edits autosave; "status" reports Saving…/Saved/Waiting to upload/conflict.
 */
export function NoteView({ library, item, editing, setEditing, onBack, onMenu, onIcon, onTags, onOpenPath, showBack, toast, revision, live = true, setLive }) {
    const [text, setText] = useState(() => library.text(item.id));
    const [error, setError] = useState('');
    const [status, setStatus] = useState('');
    const pending = useRef(null); // body waiting to be saved
    const timer = useRef(null);
    const viewRef = useRef(null);
    const articleRef = useRef(null);
    const fileInput = useRef(null);
    const [uploading, setUploading] = useState(0);

    const resolveImage = async (src) => {
        const r = library.resolveImage(item.id, src);
        if (r.external) return { url: r.external };
        if (r.path) return { url: await library.imageUrl(library.files.get(r.path)) };
        return r;
    };

    const addImages = async (files) => {
        for (const file of files) {
            setUploading((n) => n + 1);
            try {
                const link = await library.addImage(item.id, file, file.name);
                const alt = (file.name || 'Image').replace(/\.[^.]+$/, '').replace(/[[\]]/g, '');
                if (viewRef.current) actions.insert(viewRef.current, `![${alt}](${link})`);
            } catch (e) {
                toast(library.online ? `Could not add the image: ${e.message}` : 'Adding images needs a connection.', 'error');
            } finally {
                setUploading((n) => n - 1);
            }
        }
    };

    // Load (or reload when the note changes underneath, e.g. after a refresh).
    useEffect(() => {
        let alive = true;
        const current = library.text(item.id);
        setError('');
        if (current !== undefined) {
            if (!pending.current) setText(current);
        } else if (library.isLockedNote(item.id)) {
            setText(undefined);
            setEditing(false);
        } else {
            library.readNote(item.id).then((t) => alive && setText(t))
                .catch((e) => alive && (e instanceof LockedError ? (setText(undefined), setEditing(false)) : setError(e.message)));
        }
        return () => {
            alive = false;
        };
    }, [item.id, revision]);

    const split = useMemo(() => FM.split(text ?? ''), [text]);

    const flush = async () => {
        clearTimeout(timer.current);
        const body = pending.current;
        if (body === null || body === undefined) return;
        pending.current = null;
        // Front matter may have changed meanwhile (tags, icon): join with the latest.
        const latest = FM.split(library.text(item.id) ?? '');
        const full = FM.join(latest.raw, body);
        setStatus('Saving…');
        try {
            const r = await library.saveNote(item.id, full);
            if (r.conflictCopy) {
                setStatus('');
                setText(library.text(item.id));
                toast(`This note changed on another device. Your edit was saved as “${r.conflictCopy.title}”.`, 'warning');
            } else if (r.queued) {
                setStatus('Saved on this device; will upload when online');
            } else {
                setStatus('Saved');
            }
        } catch (e) {
            pending.current = body;
            setStatus('');
            toast(`Could not save: ${e.message}`, 'error');
        }
    };

    // Save when leaving the note, the editor, or the page.
    useEffect(() => {
        const away = () => flush();
        window.addEventListener('pagehide', away);
        library.addEventListener('before-lock', away);
        document.addEventListener('visibilitychange', away);
        return () => {
            window.removeEventListener('pagehide', away);
        library.removeEventListener('before-lock', away);
            document.removeEventListener('visibilitychange', away);
            flush();
        };
    }, [item.id]);
    useEffect(() => {
        if (!editing) flush();
    }, [editing]);

    const onChange = (body) => {
        pending.current = body;
        setStatus('Editing…');
        clearTimeout(timer.current);
        timer.current = setTimeout(flush, SAVE_DELAY);
    };

    const html = useMemo(() => (editing || text === undefined ? '' : renderMarkdown(split.body)), [split.body, editing, text]);

    // Math, diagrams and images, once the HTML is in the page.
    useEffect(() => {
        if (!editing && articleRef.current) enhance(articleRef.current, { images: resolveImage }).catch(() => {});
    }, [html, editing, revision]);

    const onContentClick = async (e) => {
        const box = e.target.closest('input.task');
        if (box) {
            const line = Number(box.dataset.line);
            const body = toggleTask(split.body, line, box.checked);
            const full = FM.join(split.raw, body);
            setText(full);
            try {
                const r = await library.saveNote(item.id, full);
                if (r.conflictCopy) {
                    setText(library.text(item.id));
                    toast(`This note changed on another device. Your change was saved as “${r.conflictCopy.title}”.`, 'warning');
                }
            } catch (err) {
                toast(`Could not save: ${err.message}`, 'error');
            }
            return;
        }
        const link = e.target.closest('a[data-note-link]');
        if (link) {
            e.preventDefault();
            onOpenPath(decodeURIComponent(link.getAttribute('data-note-link')), item);
        }
    };

    const locked = text === undefined && library.locked;
    const meta = FM.parse(split.raw);
    const created = meta.created ?? item.created;

    return (
        <section class="note-panel" aria-label={item.title}>
            <header class="toolbar">
                {showBack && <button class="icon-button" onClick={onBack} aria-label="Back to notes"><Icon name="back" /></button>}
                <h1 class="note-title">{item.title}</h1>
                <span class="save-status" aria-live="polite">{uploading ? 'Uploading image…' : status}</span>
                {editing && setLive && (
                    <button class={'toggle small' + (live ? '' : ' on')} aria-pressed={!live} title="Show the Markdown source"
                        onClick={() => setLive(!live)}>Source</button>
                )}
                <button class={'icon-button' + (editing ? ' active' : '')} onClick={() => setEditing(!editing)} disabled={locked}
                    aria-label={editing ? 'Done editing' : 'Edit note'} title={editing ? 'Done (Esc)' : 'Edit'}>
                    <Icon name={editing ? 'check' : 'edit'} />
                </button>
                <button class="icon-button" onClick={onMenu} aria-label="Note actions"><Icon name="menu" /></button>
            </header>
            {!locked && <div class="meta-strip">
                <button class="meta-button" onClick={onIcon} title="Set icon">
                    {item.icon ? <ItemIcon item={item} size={18} /> : <Icon name="smile" size={18} />}
                    <span>{item.icon ? 'Icon' : 'Add Icon'}</span>
                </button>
                {created && <span class="meta-created" title={created.toLocaleString()}><Icon name="calendar" size={16} /> Created {formatCreated(created)}</span>}
                <span class="meta-tags">
                    {meta.tags.map((t) => <span class="chip small">{t}</span>)}
                    <button class="meta-button" onClick={onTags} title="Edit tags"><Icon name="tag" size={16} /><span>{meta.tags.length ? 'Edit' : 'Add Tag'}</span></button>
                </span>
            </div>}
            {error && <p class="error pad">{error}</p>}
            {locked && (
                <div class="locked-note">
                    <Icon name="lock" size={48} />
                    <h2>This note is encrypted</h2>
                    <p class="hint">Unlock the notebook to read and edit it.</p>
                    <UnlockForm library={library} />
                </div>
            )}
            {text === undefined && !error && !locked && <p class="hint pad">Loading…</p>}
            {text !== undefined && (editing ? (
                <>
                    <Editor value={split.body} onChange={onChange} viewRef={viewRef} autoFocus live={live}
                        resolveImage={resolveImage} onImage={() => fileInput.current?.click()} onImageFiles={addImages} />
                    <input ref={fileInput} type="file" accept="image/*" multiple hidden
                        onChange={(e) => {
                            addImages([...e.target.files]);
                            e.target.value = '';
                        }} />
                    <div class="format-bar" role="toolbar" aria-label="Formatting">
                        {[['bold', 'Bold'], ['italic', 'Italic'], ['heading', 'Heading'], ['bullet', 'List', 'list'], ['task', 'Checklist', 'checklist'], ['quote', 'Quote'], ['code', 'Code'], ['link', 'Link'], ['image', 'Image', 'image']].map(([a, label, icon]) => (
                            <button class="icon-button" aria-label={label} title={label} onMouseDown={(e) => e.preventDefault()}
                                onClick={() => (a === 'image' ? fileInput.current?.click() : viewRef.current && actions[a](viewRef.current))}>
                                <Icon name={icon ?? a} />
                            </button>
                        ))}
                    </div>
                </>
            ) : (
                <article class="rendered" ref={articleRef} onClick={onContentClick} onDblClick={(e) => !e.target.closest('a,input') && setEditing(true)}
                    dangerouslySetInnerHTML={{ __html: html || '<p class="hint">Empty note. Tap ✎ to write.</p>' }} />
            ))}
        </section>
    );
}
