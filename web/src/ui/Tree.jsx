// SPDX-FileCopyrightText: 2026 Marknote fork contributors
// SPDX-License-Identifier: GPL-2.0-only OR GPL-3.0-only OR LicenseRef-KDE-Accepted-GPL

import { useEffect, useRef, useState } from 'preact/hooks';
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

const LONG_PRESS = 500;
const MOUSE_SLOP = 6;
const TOUCH_SLOP = 10;

/**
 * Drag and drop, like the desktop tree: onto a folder moves into it, onto a
 * note moves next to it, onto empty space moves to the top level.
 * Mouse: press and move. Touch: hold, then move (hold and release = menu).
 */
function useDrag({ library, onMove, onMenu, expand }) {
    const [drag, setDrag] = useState(null); // { item, x, y, target: {parentId, rowId, label} | null }
    const press = useRef(null);
    const suppressClick = useRef(false);
    const treeRef = useRef(null);
    const hoverTimer = useRef(null);

    const targetAt = (x, y, item) => {
        const el = document.elementFromPoint(x, y);
        if (!el || !treeRef.current?.contains(el)) return null;
        const row = el.closest('.row');
        let parentId;
        let rowId = null;
        if (!row) {
            parentId = null;
        } else {
            const over = library.items.get(row.dataset.id);
            if (!over) return null;
            parentId = over.isFolder ? over.id : over.parentId;
            rowId = over.isFolder ? over.id : over.parentId;
        }
        if (parentId === item.parentId) return { parentId, rowId, same: true };
        if (item.isFolder && parentId && library.isInside(item.id, parentId)) return null;
        const label = parentId ? library.items.get(parentId).title : library.notebook.name;
        return { parentId, rowId, label };
    };

    const autoScroll = (y) => {
        const tree = treeRef.current;
        if (!tree) return;
        const r = tree.getBoundingClientRect();
        if (y < r.top + 40) tree.scrollTop -= 12;
        else if (y > r.bottom - 40) tree.scrollTop += 12;
    };

    const start = (p, x, y) => {
        p.dragging = true;
        setDrag({ item: p.item, x, y, target: null });
        navigator.vibrate?.(15);
    };

    const move = (x, y) => {
        setDrag((d) => {
            if (!d) return d;
            const target = targetAt(x, y, d.item);
            if (target?.rowId !== d.target?.rowId) {
                clearTimeout(hoverTimer.current);
                const folder = target?.rowId && library.items.get(target.rowId);
                if (folder?.isFolder) hoverTimer.current = setTimeout(() => expand(folder.id), 700);
            }
            return { ...d, x, y, target };
        });
        autoScroll(y);
    };

    const finish = (commit) => {
        clearTimeout(hoverTimer.current);
        setDrag((d) => {
            if (d && commit && d.target && !d.target.same) onMove(d.item, d.target.parentId);
            return null;
        });
    };

    useEffect(() => {
        const onPointerMove = (e) => {
            const p = press.current;
            if (!p || e.pointerId !== p.id) return;
            const dist = Math.hypot(e.clientX - p.x, e.clientY - p.y);
            if (!p.dragging) {
                if (p.touch) {
                    if (!p.armed && dist > TOUCH_SLOP) {
                        clearTimeout(p.timer); // a scroll, not a press
                        press.current = null;
                    } else if (p.armed && dist > TOUCH_SLOP) {
                        start(p, e.clientX, e.clientY);
                    }
                } else if (dist > MOUSE_SLOP) {
                    start(p, e.clientX, e.clientY);
                }
                return;
            }
            move(e.clientX, e.clientY);
        };
        // The click that follows a drag or a long press must not reach what
        // is under the finger now (e.g. the backdrop of the menu just opened).
        const swallowNextClick = () => {
            const swallow = (ev) => {
                ev.stopPropagation();
                ev.preventDefault();
            };
            addEventListener('click', swallow, { capture: true, once: true });
            setTimeout(() => removeEventListener('click', swallow, { capture: true }), 400);
        };
        const onPointerUp = (e) => {
            const p = press.current;
            if (!p || e.pointerId !== p.id) return;
            clearTimeout(p.timer);
            if (p.armed && !p.dragging && e.type === 'pointercancel') return; // long press; wait for the release
            press.current = null;
            if (p.dragging) {
                swallowNextClick();
                finish(e.type === 'pointerup');
            } else if (p.armed) {
                swallowNextClick();
                onMenu(p.item);
            }
        };
        const onTouchEnd = () => {
            const p = press.current;
            if (p?.armed && !p.dragging) {
                press.current = null;
                swallowNextClick();
                onMenu(p.item);
            }
        };
        // While a touch drag is armed, the page must not scroll.
        const onTouchMove = (e) => {
            if (press.current?.armed || press.current?.dragging) e.preventDefault();
        };
        const onKey = (e) => {
            if (e.key === 'Escape' && press.current?.dragging) {
                press.current = null;
                finish(false);
            }
        };
        addEventListener('pointermove', onPointerMove);
        addEventListener('pointerup', onPointerUp);
        addEventListener('pointercancel', onPointerUp);
        addEventListener('touchmove', onTouchMove, { passive: false });
        addEventListener('touchend', onTouchEnd);
        addEventListener('keydown', onKey);
        return () => {
            removeEventListener('pointermove', onPointerMove);
            removeEventListener('pointerup', onPointerUp);
            removeEventListener('pointercancel', onPointerUp);
            removeEventListener('touchmove', onTouchMove);
            removeEventListener('touchend', onTouchEnd);
            removeEventListener('keydown', onKey);
        };
    }, [library]);

    const rowHandlers = (item) => ({
        onPointerDown: (e) => {
            if (e.button !== 0 || e.target.closest('.row-menu')) return;
            const p = { id: e.pointerId, item, x: e.clientX, y: e.clientY, touch: e.pointerType !== 'mouse', armed: false, dragging: false };
            if (p.touch) {
                p.timer = setTimeout(() => {
                    p.armed = true;
                    navigator.vibrate?.(10);
                }, LONG_PRESS);
            }
            press.current = p;
        },
        onContextMenu: (e) => {
            e.preventDefault();
            const p = press.current;
            if (p?.touch) {
                p.armed = true; // the browser saw a long press too
                return;
            }
            onMenu(item);
        },
        onClickCapture: (e) => {
            if (suppressClick.current) {
                e.stopImmediatePropagation();
                e.stopPropagation();
                e.preventDefault();
            }
        },
    });

    return { drag, treeRef, rowHandlers };
}

function Row({ item, depth, expanded, selected, onToggle, onOpen, onMenu, settings, filtering, handlers, dropTarget, dragging }) {
    const isOpen = filtering || expanded;
    return (
        <div role="treeitem" aria-expanded={item.isFolder ? isOpen : undefined} aria-selected={selected} data-id={item.id}
            class={'row' + (selected ? ' selected' : '') + (item.isFolder ? ' folder' : '') + (dropTarget ? ' drop-target' : '') + (dragging ? ' dragging' : '')}
            style={{ '--depth': depth }} tabIndex={0}
            onClick={() => (item.isFolder ? onToggle(item) : onOpen(item))}
            onKeyDown={(e) => {
                if (e.key === 'Enter') item.isFolder ? onToggle(item) : onOpen(item);
                if (e.key === 'F2' || e.key === 'ContextMenu') onMenu(item);
            }}
            {...handlers}>
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

export function Tree({ library, visible, selectedId, settings, setSettings, onOpen, onMenu, onMove }) {
    const expanded = settings.expanded ?? {};
    const toggle = (folder) => setSettings((s) => ({ ...s, expanded: { ...s.expanded, [folder.id]: !s.expanded?.[folder.id] } }));
    const expand = (id) => setSettings((s) => ({ ...s, expanded: { ...s.expanded, [id]: true } }));
    const { drag, treeRef, rowHandlers } = useDrag({ library, onMove, onMenu, expand });

    const rows = [];
    const walk = (parentId, depth) => {
        for (const item of sortItems(library.children(parentId), settings.sort)) {
            if (visible && !visible.has(item.id)) continue;
            rows.push(<Row key={item.id} item={item} depth={depth} expanded={!!expanded[item.id]} selected={item.id === selectedId}
                onToggle={toggle} onOpen={onOpen} onMenu={onMenu} settings={settings} filtering={!!visible}
                handlers={rowHandlers(item)} dropTarget={drag?.target && !drag.target.same && drag.target.rowId === item.id}
                dragging={drag?.item.id === item.id} />);
            if (item.isFolder && (visible || expanded[item.id])) walk(item.id, depth + 1);
        }
    };
    walk(null, 0);
    const toRoot = drag?.target && !drag.target.same && drag.target.parentId === null;
    return (
        <div class={'tree' + (toRoot ? ' drop-root' : '') + (drag ? ' is-dragging' : '')} role="tree" aria-label="Notes" ref={treeRef}>
            {rows}
            {!rows.length && <p class="hint pad">{visible ? 'No notes match the filter.' : 'No notes yet. Use + to create one.'}</p>}
            {drag && (
                <div class="drag-ghost" style={{ left: `${drag.x + 14}px`, top: `${drag.y + 10}px` }} aria-hidden="true">
                    <ItemIcon item={drag.item} size={16} /> {drag.item.title}
                    <span class="drag-hint">{drag.target && !drag.target.same ? `→ ${drag.target.label}` : drag.target?.same ? 'already here' : 'can’t drop here'}</span>
                </div>
            )}
        </div>
    );
}
