// SPDX-FileCopyrightText: 2026 Marknote fork contributors
// SPDX-License-Identifier: GPL-2.0-only OR GPL-3.0-only OR LicenseRef-KDE-Accepted-GPL

import { useEffect, useMemo, useRef, useState } from 'preact/hooks';
import * as Auth from '../auth.js';
import { DriveApi } from '../drive.js';
import { FakeDrive, seedDemo, seedEncryptedDemo } from '../fakedrive.js';
import { Library } from '../library.js';
import { loadSettings, saveSettings } from '../settings.js';
import { createStore, MemoryStore } from '../store.js';
import { ConfirmDialog, Dialog, IconPicker, Menu, MovePicker, PromptDialog, TagEditor, UnlockDialog } from './dialogs.jsx';
import { Icon } from './icons.jsx';
import { NoteView } from './NoteView.jsx';
import { Tree } from './Tree.jsx';

const DEMO = new URLSearchParams(location.search).has('demo');
const README = 'https://github.com/nesanders/marknote/blob/master/web/README.md';

function useWide() {
    const query = '(min-width: 900px)';
    const [wide, setWide] = useState(() => matchMedia(query).matches);
    useEffect(() => {
        const mq = matchMedia(query);
        const on = () => setWide(mq.matches);
        mq.addEventListener('change', on);
        return () => mq.removeEventListener('change', on);
    }, []);
    return wide;
}

function applyTheme(settings) {
    const root = document.documentElement;
    if (settings.theme === 'auto') root.removeAttribute('data-theme');
    else root.setAttribute('data-theme', settings.theme);
    root.style.setProperty('--font-scale', String(settings.fontScale / 100));
}

// ---- Setup and sign-in screens ----------------------------------------------

function Welcome({ children }) {
    return (
        <main class="welcome">
            <div class="welcome-card">
                <img src="icon.svg" alt="" width="72" height="72" />
                <h1>Marknote</h1>
                {children}
            </div>
        </main>
    );
}

function ClientIdForm({ onSaved, initial = '' }) {
    const [value, setValue] = useState(initial);
    const valid = Auth.looksLikeClientId(value);
    return (
        <form class="client-form" onSubmit={(e) => {
            e.preventDefault();
            if (valid) {
                Auth.setClientId(value);
                onSaved();
            }
        }}>
            <label class="field">
                <span>OAuth client ID (type “Web application”)</span>
                <input value={value} onInput={(e) => setValue(e.target.value)} placeholder="1234-abc.apps.googleusercontent.com"
                    autocomplete="off" autocapitalize="off" spellcheck={false} />
            </label>
            {value && !valid && <p class="error">That does not look like a Google OAuth client ID.</p>}
            <button class="primary" type="submit" disabled={!valid}>Save</button>
        </form>
    );
}

function Setup({ onReady, message }) {
    return (
        <Welcome>
            <p>Your notes from Google Drive, on any device.</p>
            {message && <p class="error">{message}</p>}
            <div class="notice">
                <Icon name="info" />
                <div>
                    <p><strong>First, connect your own Google OAuth client.</strong> Marknote ships without one, so nothing about your
                        Google setup is in the app or its public repository. It is kept only in this browser.</p>
                    <p>In the Google Cloud project you use for Marknote desktop, create an OAuth client of type
                        <em> Web application</em> with:</p>
                    <dl class="kv">
                        <dt>Authorized JavaScript origin</dt><dd><code>{location.origin}</code></dd>
                        <dt>Authorized redirect URI</dt><dd><code>{Auth.redirectUri()}</code></dd>
                    </dl>
                    <p><a href={README} target="_blank" rel="noopener noreferrer">Step-by-step guide</a></p>
                </div>
            </div>
            <ClientIdForm onSaved={onReady} />
            <p class="hint">Just looking? <a href="?demo">Try the demo</a> with sample notes (nothing is saved).</p>
        </Welcome>
    );
}

function SignIn({ error, onSettings }) {
    return (
        <Welcome>
            <p>Sign in to open your notebooks in Google Drive.</p>
            {error && <p class="error">{error}</p>}
            <button class="primary big" onClick={() => Auth.signIn({})}>Sign in with Google</button>
            <p class="hint">Marknote can only see files it created in your Drive (the desktop app's synced notebooks and notes made here).</p>
            <button class="link-button" onClick={onSettings}>Change OAuth client…</button>
        </Welcome>
    );
}

// ---- Settings ------------------------------------------------------------------

function SettingsDialog({ settings, setSettings, library, account, onClose, onSignOut }) {
    const [root, setRoot] = useState(settings.rootPath);
    const [extra, setExtra] = useState(settings.extraNotebooks.join('\n'));
    const [editClient, setEditClient] = useState(false);
    const [copied, setCopied] = useState(false);
    const setupLink = `${Auth.redirectUri()}#setup=${encodeURIComponent(Auth.clientId())}`;
    const saveFolders = () => {
        const extraNotebooks = extra.split('\n').map((l) => l.trim().replace(/^\/+|\/+$/g, '')).filter(Boolean);
        const rootPath = root.trim().replace(/^\/+|\/+$/g, '') || 'Marknote';
        if (rootPath !== settings.rootPath || extraNotebooks.join('\n') !== settings.extraNotebooks.join('\n')) {
            setSettings({ ...settings, rootPath, extraNotebooks });
        }
    };
    return (
        <Dialog title="Settings" onClose={() => {
            saveFolders();
            onClose();
        }} wide footer={<button class="primary" onClick={() => {
            saveFolders();
            onClose();
        }}>Done</button>}>
            <h3>Notebooks</h3>
            <label class="field">
                <span>Drive folder that holds your notebooks</span>
                <input value={root} onInput={(e) => setRoot(e.target.value)} placeholder="Marknote" />
            </label>
            <label class="field">
                <span>Other notebook folders (one Drive path per line)</span>
                <textarea rows={3} value={extra} onInput={(e) => setExtra(e.target.value)} placeholder="Work/Notes/Projects" />
            </label>
            <p class="hint">Use the same paths as the desktop app's sync settings. Marknote only sees folders it created.</p>

            <h3>Appearance</h3>
            <div class="row wrap">
                <label class="field inline"><span>Theme</span>
                    <select value={settings.theme} onChange={(e) => setSettings({ ...settings, theme: e.target.value })}>
                        <option value="auto">System</option><option value="light">Light</option><option value="dark">Dark</option>
                    </select>
                </label>
                <label class="field inline"><span>Text size</span>
                    <select value={settings.fontScale} onChange={(e) => setSettings({ ...settings, fontScale: Number(e.target.value) })}>
                        {[85, 100, 115, 130, 150].map((v) => <option value={v}>{v}%</option>)}
                    </select>
                </label>
                <label class="field inline"><span>Sort notes</span>
                    <select value={settings.sort ?? 'name'} onChange={(e) => setSettings({ ...settings, sort: e.target.value })}>
                        <option value="name">By name</option><option value="created">Newest first</option><option value="modified">Recently changed</option>
                    </select>
                </label>
                <label class="field inline" title="Encrypted notebooks lock themselves when unused for this long"><span>Lock encrypted notebooks after</span>
                    <select value={settings.autoLockMinutes ?? 15} onChange={(e) => setSettings({ ...settings, autoLockMinutes: Number(e.target.value) })}>
                        {[5, 15, 30, 60].map((m) => <option value={m}>{m} minutes idle</option>)}
                        <option value={0}>Never (until the page is closed)</option>
                    </select>
                </label>
            </div>
            <label class="check"><input type="checkbox" checked={settings.showTags} onChange={(e) => setSettings({ ...settings, showTags: e.target.checked })} /> Show tags in the list</label>
            <label class="check"><input type="checkbox" checked={settings.showCreated} onChange={(e) => setSettings({ ...settings, showCreated: e.target.checked })} /> Show created date in the list</label>

            {!DEMO && <>
                <h3>Google account</h3>
                <p>{account ? <>Signed in as <strong>{account}</strong>.</> : 'Signed in.'}</p>
                <div class="row wrap">
                    <button onClick={() => {
                        if (library.pending && !confirm(`${library.pending} change(s) have not been uploaded yet and will be lost. Sign out anyway?`)) return;
                        onSignOut();
                    }}>Sign Out</button>
                    <button disabled={library.pending > 0} title={library.pending ? 'Upload waiting changes first' : ''} onClick={async () => {
                        await library.store.clear();
                        location.reload();
                    }}>Clear Offline Copy</button>
                </div>
                <h3>OAuth client (this device only)</h3>
                <p class="hint">Stored in this browser, not in the app or its repository. To set up another device quickly, open this
                    link there; the part after “#” is never sent to the web server.</p>
                <div class="row">
                    <input readOnly value={setupLink} onFocus={(e) => e.target.select()} aria-label="Setup link" />
                    <button onClick={async () => {
                        try {
                            await navigator.clipboard.writeText(setupLink);
                            setCopied(true);
                        } catch {
                            setCopied(false);
                        }
                    }}>{copied ? 'Copied' : 'Copy'}</button>
                </div>
                {editClient ? <ClientIdForm initial={Auth.clientId()} onSaved={() => location.reload()} /> : (
                    <div class="row wrap">
                        <button onClick={() => setEditClient(true)}>Change Client ID…</button>
                        <button class="danger" onClick={() => {
                            onSignOut();
                            Auth.setClientId('');
                            location.reload();
                        }}>Forget Client ID</button>
                    </div>
                )}
            </>}
            <p class="hint">Marknote web · <a href={README} target="_blank" rel="noopener noreferrer">Help</a></p>
        </Dialog>
    );
}

// ---- Main app ------------------------------------------------------------------

function useLibraryRevision(library) {
    const [rev, setRev] = useState(0);
    useEffect(() => {
        if (!library) return undefined;
        const bump = () => setRev((r) => r + 1);
        for (const ev of ['notebooks', 'tree', 'status', 'vault']) library.addEventListener(ev, bump);
        return () => {
            for (const ev of ['notebooks', 'tree', 'status', 'vault']) library.removeEventListener(ev, bump);
        };
    }, [library]);
    return rev;
}

function Workspace({ library, settings, setSettings, account, onSignOut }) {
    const rev = useLibraryRevision(library);
    const wide = useWide();
    const [screen, setScreen] = useState('notebooks'); // narrow layout: notebooks | tree | note
    const [notebook, setNotebook] = useState(null);
    const [noteId, setNoteId] = useState(null);
    const [editing, setEditing] = useState(false);
    const [dialog, setDialog] = useState(null);
    const [toasts, setToasts] = useState([]);
    const [filterText, setFilterText] = useState('');
    const [filterTags, setFilterTags] = useState([]);
    const [authNeeded, setAuthNeeded] = useState(false);
    const [loading, setLoading] = useState(false);
    const filterRef = useRef(null);

    const toast = (message, kind = 'info') => {
        const id = Math.random();
        setToasts((t) => [...t, { id, message, kind }]);
        setTimeout(() => setToasts((t) => t.filter((x) => x.id !== id)), kind === 'info' ? 3500 : 8000);
    };

    const go = (next) => {
        if (wide) return;
        if (next !== screen) history.pushState({ screen: next }, '');
        setScreen(next);
    };

    useEffect(() => {
        const pop = (e) => setScreen(e.state?.screen ?? 'notebooks');
        addEventListener('popstate', pop);
        const authReq = () => setAuthNeeded(!DEMO);
        const conflicts = (e) => toast(`${e.detail.length} offline edit(s) had changed elsewhere and were saved as conflict copies.`, 'warning');
        const replaced = (e) => setNoteId((id) => (id === e.detail.from ? e.detail.to : id));
        library.addEventListener('auth-required', authReq);
        library.addEventListener('conflicts', conflicts);
        library.addEventListener('replaced', replaced);
        const online = () => {
            library.setOnline(true);
            library.refresh().catch(() => {});
        };
        addEventListener('online', online);
        addEventListener('offline', () => library.setOnline(false));
        library.countPending();
        return () => {
            removeEventListener('popstate', pop);
            library.removeEventListener('auth-required', authReq);
            library.removeEventListener('conflicts', conflicts);
            library.removeEventListener('replaced', replaced);
            removeEventListener('online', online);
        };
    }, [library]);

    const openNotebook = async (nb, { keepNote } = {}) => {
        setNotebook(nb);
        if (!keepNote) {
            setNoteId(null);
            setEditing(false);
        }
        setFilterTags([]);
        setLoading(true);
        try {
            await library.openNotebook(nb);
        } catch (e) {
            toast(e.message, 'error');
        } finally {
            setLoading(false);
        }
        setSettings((s) => ({ ...s, lastNotebook: nb.id }));
    };

    // Start: notebooks, then the last notebook/note.
    useEffect(() => {
        (async () => {
            setLoading(true);
            try {
                await library.loadNotebooks();
            } catch (e) {
                toast(e.message, 'error');
            }
            setLoading(false);
            const last = library.notebooks.find((n) => n.id === settings.lastNotebook) ?? (wide ? library.notebooks[0] : null);
            if (last) {
                await openNotebook(last, { keepNote: true });
                if (settings.lastNote && library.items.has(settings.lastNote)) {
                    setNoteId(settings.lastNote);
                    if (!wide) {
                        history.replaceState({ screen: 'notebooks' }, '');
                        history.pushState({ screen: 'tree' }, '');
                        history.pushState({ screen: 'note' }, '');
                        setScreen('note');
                    }
                } else if (!wide) {
                    history.replaceState({ screen: 'notebooks' }, '');
                    history.pushState({ screen: 'tree' }, '');
                    setScreen('tree');
                }
            }
        })();
    }, [library, settings.rootPath, settings.extraNotebooks.join('\n')]);

    const openNote = (item) => {
        setNoteId(item.id);
        setEditing(false);
        setSettings((s) => ({ ...s, lastNote: item.id }));
        go('note');
    };

    const note = noteId ? library.items.get(noteId) : null;
    const visible = useMemo(() => library.filter({ text: filterText, tags: filterTags, any: settings.tagAny, contents: settings.searchContents }),
        [rev, filterText, filterTags.join('\n'), settings.tagAny, settings.searchContents]);
    const tags = useMemo(() => library.tagCounts(), [rev]);
    const counts = useMemo(() => {
        let folders = 0;
        let notes = 0;
        for (const i of library.items.values()) {
            if (visible && !visible.has(i.id)) continue;
            if (i.isFolder) ++folders;
            else ++notes;
        }
        return { folders, notes };
    }, [rev, visible]);

    // Encrypted notebooks lock themselves after a while without use.
    useEffect(() => {
        const t = setInterval(() => library.autoLock(settings.autoLockMinutes ?? 15), 30000);
        return () => clearInterval(t);
    }, [library, settings.autoLockMinutes]);

    const lockNow = () => {
        library.lock(); // the open note saves its edit first ('before-lock')
        setEditing(false);
    };

    // Keyboard shortcuts (desktop browsers).
    useEffect(() => {
        const key = (e) => {
            if (dialog) return;
            const mod = e.ctrlKey || e.metaKey;
            if (mod && e.key.toLowerCase() === 'e' && !e.shiftKey) {
                e.preventDefault();
                filterRef.current?.focus();
            } else if (mod && e.key.toLowerCase() === 'n' && notebook) {
                e.preventDefault();
                newNote(null);
            } else if (mod && e.shiftKey && e.key.toLowerCase() === 'l') {
                e.preventDefault();
                lockNow();
            } else if (e.key === 'Escape' && editing) {
                setEditing(false);
            }
        };
        addEventListener('keydown', key);
        return () => removeEventListener('keydown', key);
    });

    const toggleTag = (t) => setFilterTags((cur) => (cur.includes(t) ? cur.filter((x) => x !== t) : [...cur, t]));

    // ---- actions ----
    const newNote = (parentId) => setDialog(
        <PromptDialog title="New Note" label="Name" initial="" okText="Create"
            onOk={async (name) => {
                const item = await library.createNote(parentId, name);
                if (parentId) setSettings((s) => ({ ...s, expanded: { ...s.expanded, [parentId]: true } }));
                openNote(item);
                setEditing(true);
            }} onClose={() => setDialog(null)} />,
    );
    const newFolder = (parentId) => setDialog(
        <PromptDialog title="New Folder" label="Name" okText="Create" hint={library.online ? null : 'Needs a connection.'}
            onOk={async (name) => {
                await library.createFolder(parentId, name);
                if (parentId) setSettings((s) => ({ ...s, expanded: { ...s.expanded, [parentId]: true } }));
            }} onClose={() => setDialog(null)} />,
    );
    const rename = (item) => setDialog(
        <PromptDialog title={item.isFolder ? 'Rename Folder' : 'Rename Note'} label="Name" initial={item.title} okText="Rename"
            onOk={(name) => library.rename(item.id, name)} onClose={() => setDialog(null)} />,
    );
    const remove = (item) => setDialog(
        <ConfirmDialog title={item.isFolder ? 'Delete Folder' : 'Delete Note'} danger okText="Move to Trash"
            message={item.isFolder ? `Move “${item.title}” and everything in it to the Google Drive trash?` : `Move “${item.title}” to the Google Drive trash? You can restore it from there.`}
            onOk={async () => {
                await library.trash(item.id);
                if (noteId && !library.items.has(noteId)) {
                    setNoteId(null);
                    go('tree');
                }
            }} onClose={() => setDialog(null)} />,
    );
    const pickIcon = (item) => setDialog(
        <IconPicker title={`Icon for “${item.title}”`} current={item.icon}
            onPick={(icon) => (item.isFolder ? library.setFolderIcon(item.id, icon) : library.setIcon(item.id, icon)).catch((e) => toast(e.message, 'error'))}
            onClose={() => setDialog(null)} />,
    );
    const editTags = (item) => setDialog(
        <TagEditor noteTitle={item.title} tags={item.tags} allTags={tags} onChange={(t) => library.setTags(item.id, t)} onClose={() => setDialog(null)} />,
    );
    const move = (item) => setDialog(<MovePicker library={library} item={item} onClose={() => setDialog(null)} />);

    const itemMenu = (item) => setDialog(
        <Menu title={item.title} onClose={() => setDialog(null)} items={item.isFolder ? [
            { label: 'New Note Here…', icon: 'plus', action: () => newNote(item.id) },
            { label: 'New Folder Here…', icon: 'folderNew', action: () => newFolder(item.id), disabled: !library.online },
            { separator: true },
            { label: 'Rename…', icon: 'rename', action: () => rename(item), disabled: !library.online },
            { label: 'Move…', icon: 'move', action: () => move(item), disabled: !library.online },
            { label: 'Set Icon…', icon: 'smile', action: () => pickIcon(item), disabled: !library.online },
            { separator: true },
            { label: 'Delete Folder…', icon: 'trash', danger: true, action: () => remove(item), disabled: !library.online },
        ] : [
            { label: 'Open', icon: 'eye', action: () => openNote(item) },
            { label: 'Rename…', icon: 'rename', action: () => rename(item), disabled: !library.online || item.pending },
            { label: 'Move…', icon: 'move', action: () => move(item), disabled: !library.online || item.pending },
            { label: 'Set Icon…', icon: 'smile', action: () => pickIcon(item) },
            { label: 'Edit Tags…', icon: 'tag', action: () => editTags(item) },
            { separator: true },
            { label: 'Delete Note…', icon: 'trash', danger: true, action: () => remove(item), disabled: !library.online && !item.id.startsWith('local-') },
        ]} />,
    );

    const notebookMenu = () => setDialog(
        <Menu title={notebook.name} onClose={() => setDialog(null)} items={[
            { label: 'New Note', icon: 'plus', action: () => newNote(null) },
            { label: 'New Folder…', icon: 'folderNew', action: () => newFolder(null), disabled: !library.online },
            { label: 'Set Notebook Icon…', icon: 'smile', action: () => setDialog(
                <IconPicker title={`Icon for “${notebook.name}”`} current={notebook.dir?.['X-Marknote-Emoji']}
                    onPick={(icon) => library.setFolderIcon(null, icon).then(() => library.loadNotebooks())} onClose={() => setDialog(null)} />), disabled: !library.online },
            { separator: true },
            { label: 'Expand All', icon: 'chevron', action: () => setSettings((s) => ({ ...s, expanded: Object.fromEntries([...library.items.values()].filter((i) => i.isFolder).map((i) => [i.id, true])) })) },
            { label: 'Collapse All', icon: 'back', action: () => setSettings((s) => ({ ...s, expanded: {} })) },
            { label: 'Refresh', icon: 'refresh', action: () => library.refresh().catch((e) => toast(e.message, 'error')) },
            ...(library.encrypted ? [
                { separator: true },
                library.locked
                    ? { label: 'Unlock…', icon: 'unlock', action: () => setDialog(<UnlockDialog library={library} name={notebook.name} onClose={() => setDialog(null)} />) }
                    : { label: 'Lock Notebook', icon: 'lock', action: lockNow },
            ] : []),
        ]} />,
    );

    const openPath = (href, from) => {
        const base = from.path.split('/').slice(0, -1);
        for (const part of href.split('#')[0].split('/')) {
            if (part === '..') base.pop();
            else if (part && part !== '.') base.push(part);
        }
        const path = base.join('/');
        const target = [...library.items.values()].find((i) => !i.isFolder && (i.path === path || i.path === path + '.md'));
        if (target) openNote(target);
        else toast(`No note at “${path}” in this notebook.`, 'warning');
    };

    // ---- layout ----
    const status = !library.online ? { icon: 'offline', text: 'Offline — showing the copy on this device' }
        : library.pending ? { icon: 'cloud', text: `${library.pending} change(s) waiting to upload` } : null;

    const sidebar = (
        <nav class="sidebar" aria-label="Notebooks">
            <header class="toolbar">
                <h1 class="app-title">Marknote</h1>
                <button class="icon-button" aria-label="New notebook" title="New notebook" disabled={!library.online} onClick={() => setDialog(
                    <PromptDialog title="New Notebook" label="Name" okText="Create" hint={`Created in “${settings.rootPath}” on Google Drive.`}
                        onOk={async (name) => {
                            const nb = await library.createNotebook(name);
                            if (nb) {
                                await openNotebook(nb);
                                go('tree');
                            }
                        }} onClose={() => setDialog(null)} />)}><Icon name="plus" /></button>
                <button class="icon-button" aria-label="Settings" title="Settings" onClick={() => setDialog(
                    <SettingsDialog settings={settings} setSettings={setSettings} library={library} account={account}
                        onSignOut={onSignOut} onClose={() => setDialog(null)} />)}><Icon name="gear" /></button>
            </header>
            <div class="notebooks">
                {library.notebooks.map((nb) => (
                    <button class={'notebook' + (notebook?.id === nb.id ? ' selected' : '')} onClick={() => {
                        openNotebook(nb);
                        go('tree');
                    }}>
                        <span class="nb-icon" style={{ '--nb-color': nb.dir?.['X-MarkNote-Color'] || 'var(--accent)' }}>
                            {nb.dir?.['X-Marknote-Emoji'] ? <span class="emoji">{nb.dir['X-Marknote-Emoji']}</span> : <Icon name="notebook" />}
                        </span>
                        <span class="nb-name">{nb.name}</span>
                        {nb.encrypted && <span class="nb-lock" title={notebook?.id === nb.id && !library.locked ? 'Encrypted, unlocked' : 'Encrypted'}>
                            <Icon name={notebook?.id === nb.id && !library.locked ? 'unlock' : 'lock'} size={14} /></span>}
                        {notebook?.id === nb.id && <span class="count">{counts.notes}</span>}
                    </button>
                ))}
                {!library.notebooks.length && !loading && (
                    <p class="hint pad">No notebooks in “{settings.rootPath}” yet. Sync one from Marknote desktop, or create one with +.</p>
                )}
            </div>
            {notebook && tags.length > 0 && (
                <div class="side-tags">
                    <h2>Tags</h2>
                    {tags.map((t) => (
                        <button class={'side-tag' + (filterTags.includes(t.name) ? ' selected' : '')} onClick={() => {
                            toggleTag(t.name);
                            go('tree');
                        }}>
                            <Icon name="tag" size={16} /> <span>{t.name}</span> <span class="count">{t.count}</span>
                        </button>
                    ))}
                </div>
            )}
            {account && <footer class="account" title={account}>{account}</footer>}
        </nav>
    );

    const treePanel = notebook && (
        <section class="tree-panel" aria-label={notebook.name}>
            <header class="toolbar">
                {!wide && <button class="icon-button" onClick={() => history.back()} aria-label="Notebooks"><Icon name="back" /></button>}
                <h1>{notebook.name}</h1>
                {library.encrypted && (library.locked
                    ? <button class="icon-button" aria-label="Unlock notebook" title="Encrypted and locked: unlock"
                        onClick={() => setDialog(<UnlockDialog library={library} name={notebook.name} onClose={() => setDialog(null)} />)}><Icon name="lock" /></button>
                    : <button class="icon-button" aria-label="Lock notebook" title="Encrypted: lock now (Ctrl+Shift+L)" onClick={lockNow}><Icon name="unlock" /></button>)}
                <button class="icon-button" aria-label="New note" title="New note (Ctrl+N)" disabled={library.locked}
                    onClick={() => newNote(null)}><Icon name="plus" /></button>
                <button class="icon-button" aria-label="New folder" title="New folder" disabled={!library.online} onClick={() => newFolder(null)}><Icon name="folderNew" /></button>
                <button class="icon-button" aria-label="Notebook actions" onClick={notebookMenu}><Icon name="menu" /></button>
            </header>
            <div class="filter-bar" role="search">
                <div class="filter-input">
                    <Icon name="search" size={18} />
                    <input ref={filterRef} type="search" placeholder="Filter by name, or tag:name…" value={filterText}
                        onInput={(e) => setFilterText(e.target.value)} aria-label="Filter notes" />
                </div>
                <button class={'toggle' + (settings.searchContents ? ' on' : '')} aria-pressed={settings.searchContents}
                    title="Also search inside notes" onClick={() => setSettings((s) => ({ ...s, searchContents: !s.searchContents }))}>Contents</button>
                {filterTags.length > 0 && (
                    <div class="filter-tags">
                        {filterTags.map((t) => <span class="chip">{t}<button aria-label={`Remove ${t}`} onClick={() => toggleTag(t)}><Icon name="close" size={14} /></button></span>)}
                        {filterTags.length > 1 && (
                            <button class={'toggle small' + (settings.tagAny ? ' on' : '')} aria-pressed={settings.tagAny}
                                onClick={() => setSettings((s) => ({ ...s, tagAny: !s.tagAny }))}>{settings.tagAny ? 'Any tag' : 'All tags'}</button>
                        )}
                    </div>
                )}
            </div>
            {loading && !library.items.size ? <p class="hint pad">Loading…</p> : (
                <Tree library={library} visible={visible} selectedId={noteId} settings={settings} setSettings={setSettings}
                    onOpen={openNote} onMenu={itemMenu}
                    onMove={(item, parentId) => {
                        if (!library.online) {
                            toast('Moving needs a connection.', 'warning');
                            return;
                        }
                        library.move(item.id, parentId)
                            .then(() => {
                                if (parentId) setSettings((s) => ({ ...s, expanded: { ...s.expanded, [parentId]: true } }));
                                toast(`Moved “${item.title}” to ${parentId ? `“${library.items.get(parentId)?.title}”` : 'the top level'}.`);
                            })
                            .catch((e) => toast(e.message, 'error'));
                    }} />
            )}
            <footer class="tree-footer">{counts.folders} folders, {counts.notes} notes{loading && library.items.size ? ' · updating…' : ''}</footer>
        </section>
    );

    const notePanel = note ? (
        <NoteView key={note.id} library={library} item={note} editing={editing} setEditing={setEditing} revision={rev}
            live={settings.editorMode !== 'source'} setLive={(on) => setSettings((s) => ({ ...s, editorMode: on ? 'live' : 'source' }))}
            showBack={!wide} onBack={() => history.back()} toast={toast} onOpenPath={openPath}
            onMenu={() => itemMenu(note)} onIcon={() => pickIcon(note)} onTags={() => editTags(note)} />
    ) : (
        <section class="note-panel empty"><p class="hint">{notebook ? 'Choose a note, or create one with +.' : 'Choose a notebook.'}</p></section>
    );

    return (
        <div class={'app ' + (wide ? 'wide' : 'narrow screen-' + screen)}>
            {(authNeeded || status) && (
                <div class={'banner' + (authNeeded ? ' warn' : '')} role="status">
                    {authNeeded ? (
                        <>
                            <Icon name="info" /> <span>Your Google sign-in expired. Changes are kept on this device.</span>
                            <button class="primary" onClick={() => Auth.signIn({})}>Sign in again</button>
                        </>
                    ) : <><Icon name={status.icon} /> <span>{status.text}</span></>}
                </div>
            )}
            <div class="panes">
                {(wide || screen === 'notebooks') && sidebar}
                {(wide || screen === 'tree') && (treePanel || <section class="tree-panel empty"><p class="hint pad">Choose a notebook.</p></section>)}
                {(wide || screen === 'note') && notePanel}
            </div>
            {dialog}
            <div class="toasts" aria-live="polite">
                {toasts.map((t) => <div class={'toast ' + t.kind}>{t.message}</div>)}
            </div>
        </div>
    );
}

export function App() {
    const [settings, setSettingsState] = useState(loadSettings);
    const setSettings = (next) => setSettingsState((prev) => {
        const value = typeof next === 'function' ? next(prev) : next;
        saveSettings(value);
        return value;
    });
    useEffect(() => applyTheme(settings), [settings.theme, settings.fontScale]);

    const [phase, setPhase] = useState('start'); // start | setup | signin | ready
    const [message, setMessage] = useState('');
    const [account, setAccount] = useState(DEMO ? 'Demo' : Auth.accountHint());
    const [showClient, setShowClient] = useState(false);

    const library = useMemo(() => {
        if (phase !== 'ready') return null;
        if (DEMO) {
            const drive = seedDemo(new FakeDrive());
            drive.ready = seedEncryptedDemo(drive).catch((e) => console.error("demo seeding failed", e)).then(() => {
                drive.ready = null;
            });
            drive.latency = 120;
            return new Library({ drive, store: new MemoryStore(), rootPath: 'Marknote' });
        }
        return new Library({
            drive: new DriveApi(() => Auth.token()),
            store: createStore(),
            rootPath: settings.rootPath,
            extraNotebooks: settings.extraNotebooks,
        });
    }, [phase === 'ready']);

    useEffect(() => {
        if (library) {
            library.rootPath = settings.rootPath;
            library.extraNotebooks = settings.extraNotebooks;
        }
    }, [library, settings.rootPath, settings.extraNotebooks.join('\n')]);

    useEffect(() => {
        if (DEMO) {
            setPhase('ready');
            return;
        }
        const r = Auth.handleRedirect();
        if (r.error) setMessage(r.error);
        if (!Auth.clientId()) {
            setPhase('setup');
            return;
        }
        if (Auth.token()) {
            setPhase('ready');
            if (r.signedIn || !Auth.accountHint()) {
                new DriveApi(() => Auth.token()).about().then((u) => {
                    const email = u.emailAddress ?? u.displayName ?? '';
                    Auth.setAccountHint(email);
                    setAccount(email);
                }).catch(() => {});
            }
            return;
        }
        if (!navigator.onLine) {
            setPhase('ready'); // offline: work from this device's copy
            return;
        }
        if (Auth.canTrySilent() && !r.silentFailed) {
            Auth.signIn({ silent: true });
            return;
        }
        setPhase('signin');
    }, []);

    if (phase === 'start') return <Welcome><p class="hint">Starting…</p></Welcome>;
    if (phase === 'setup') return <Setup message={message} onReady={() => setPhase('signin')} />;
    if (phase === 'signin' || showClient) {
        return showClient ? (
            <Welcome>
                <p>Change the OAuth client used on this device.</p>
                <ClientIdForm initial={Auth.clientId()} onSaved={() => {
                    Auth.forgetToken();
                    setShowClient(false);
                    setPhase('signin');
                }} />
                <button class="link-button" onClick={() => setShowClient(false)}>Cancel</button>
            </Welcome>
        ) : <SignIn error={message} onSettings={() => setShowClient(true)} />;
    }
    return (
        <>
            {DEMO && <div class="demo-banner">Demo with sample notes — changes are not saved. The “Private” notebook’s password is “demo password”. <a href="./">Leave demo</a></div>}
            <Workspace library={library} settings={settings} setSettings={setSettings} account={account}
                onSignOut={() => {
                    Auth.signOut();
                    library.store.clear().finally(() => location.reload());
                }} />
        </>
    );
}
