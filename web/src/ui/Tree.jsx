// SPDX-FileCopyrightText: 2026 Marknote fork contributors
// SPDX-License-Identifier: GPL-2.0-only OR GPL-3.0-only OR LicenseRef-KDE-Accepted-GPL

import { useRef } from 'preact/hooks';
import { Icon, ItemIcon } from './icons.jsx';
import { formatCreated } from './NoteView.jsx';

function sortItems(items, sort) {
    return [...items].sort((a, b) => {
        if (a.isFolder !== b.isFolder) return a.isFolder ? -1 : 1;
        if (!a.isFolder && sort === 'created') return (b.created ?? 0) - (a.created ?? 0);
        if (!a.isFolder && sort === 'modified') return (b.modified ?? 0) - (a.modified ?? 0);
        return a.title.localeCompare(b.title, undefined, { numeric: true, sensitivity: 'base' });
    });
}

/** Long press (touch) or right click opens the item menu. */
function usePress(onMenu) {
    const timer = useRef(null);
    const fired = useRef(false);
    return {
        onContextMenu: (e) => {
            e.preventDefault();
            onMenu();
        },
        onTouchStart: () => {
            fired.current = false;
            timer.current = setTimeout(() => {
                fired.current = true;
                onMenu();
            }, 550);
        },
        onTouchEnd: (e) => {
            clearTimeout(timer.current);
            if (fired.current) e.preventDefault();
        },
        onTouchMove: () => clearTimeout(timer.current),
    };
}

function Row({ item, depth, expanded, selected, onToggle, onOpen, onMenu, settings, filtering }) {
    const press = usePress(() => onMenu(item));
    const isOpen = filtering || expanded;
    return (
        <div role="treeitem" aria-expanded={item.isFolder ? isOpen : undefined} aria-selected={selected}
            class={'row' + (selected ? ' selected' : '') + (item.isFolder ? ' folder' : '')}
            style={{ '--depth': depth }} tabIndex={0}
            onClick={() => (item.isFolder ? onToggle(item) : onOpen(item))}
            onKeyDown={(e) => {
                if (e.key === 'Enter') item.isFolder ? onToggle(item) : onOpen(item);
                if (e.key === 'F2' || (e.key === 'ContextMenu')) onMenu(item);
            }}
            {...press}>
            <span class="twisty" aria-hidden="true">{item.isFolder && <span class={'chev' + (isOpen ? ' open' : '')}><Icon name="chevron" size={14} /></span>}</span>
            <span class="row-icon"><ItemIcon item={item} /></span>
            <span class="row-text">
                <span class="row-title">{item.title}{item.pending && <span class="pending-dot" title="Waiting to upload" />}</span>
                {!item.isFolder && (settings.showTags || settings.showCreated) && (
                    <span class="row-sub">
                        {settings.showCreated && item.created && <span class="row-date">{formatCreated(item.created)}</span>}
                        {settings.showTags && item.tags.slice(0, 3).map((t) => <span class="chip tiny">{t}</span>)}
                        {settings.showTags && item.tags.length > 3 && <span class="chip tiny">+{item.tags.length - 3}</span>}
                    </span>
                )}
            </span>
            <button class="icon-button row-menu" aria-label={`Actions for ${item.title}`} onClick={(e) => {
                e.stopPropagation();
                onMenu(item);
            }}><Icon name="menu" size={18} /></button>
        </div>
    );
}

export function Tree({ library, visible, selectedId, settings, setSettings, onOpen, onMenu }) {
    const expanded = settings.expanded ?? {};
    const toggle = (folder) => setSettings({ ...settings, expanded: { ...expanded, [folder.id]: !expanded[folder.id] } });
    const rows = [];
    const walk = (parentId, depth) => {
        for (const item of sortItems(library.children(parentId), settings.sort)) {
            if (visible && !visible.has(item.id)) continue;
            rows.push(<Row key={item.id} item={item} depth={depth} expanded={!!expanded[item.id]} selected={item.id === selectedId}
                onToggle={toggle} onOpen={onOpen} onMenu={onMenu} settings={settings} filtering={!!visible} />);
            if (item.isFolder && (visible || expanded[item.id])) walk(item.id, depth + 1);
        }
    };
    walk(null, 0);
    return (
        <div class="tree" role="tree" aria-label="Notes">
            {rows}
            {!rows.length && <p class="hint pad">{visible ? 'No notes match the filter.' : 'No notes yet. Use + to create one.'}</p>}
        </div>
    );
}
