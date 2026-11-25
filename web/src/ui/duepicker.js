// SPDX-FileCopyrightText: 2026 Marknote fork contributors
// SPDX-License-Identifier: GPL-2.0-only OR GPL-3.0-only OR LicenseRef-KDE-Accepted-GPL
//
// A small popover for a to-do item's due date: quick choices plus the
// browser's own date picker. Plain DOM, so the rendered view and the editor
// widgets can both use it.

import { localToday, addDays } from '../todo.js';

let current = null;

export function closeDuePicker() {
    current?.();
    current = null;
}

/**
 * Opens the picker under `anchor`. onPick(date|null) is called with the chosen
 * date (YYYY-MM-DD) or null to clear it.
 */
export function openDuePicker(anchor, due, onPick) {
    closeDuePicker();
    const today = localToday();
    const pop = document.createElement('div');
    pop.className = 'due-picker';
    pop.setAttribute('role', 'dialog');
    pop.setAttribute('aria-label', 'Due date');
    const choose = (date) => {
        closeDuePicker();
        onPick(date);
    };
    const quick = [['Today', today], ['Tomorrow', addDays(today, 1)], ['Next week', addDays(today, 7)]];
    for (const [label, date] of quick) {
        const b = document.createElement('button');
        b.type = 'button';
        b.textContent = label;
        if (date === due) b.className = 'on';
        b.addEventListener('click', () => choose(date));
        pop.appendChild(b);
    }
    const field = document.createElement('label');
    field.className = 'due-picker-date';
    field.textContent = 'Date ';
    const input = document.createElement('input');
    input.type = 'date';
    input.value = due ?? '';
    input.addEventListener('change', () => input.value && choose(input.value));
    field.appendChild(input);
    pop.appendChild(field);
    if (due) {
        const clear = document.createElement('button');
        clear.type = 'button';
        clear.className = 'danger';
        clear.textContent = 'Clear';
        clear.addEventListener('click', () => choose(null));
        pop.appendChild(clear);
    }
    pop.addEventListener('mousedown', (e) => e.target !== input && e.preventDefault());

    document.body.appendChild(pop);
    const r = anchor.getBoundingClientRect();
    const w = pop.offsetWidth;
    const h = pop.offsetHeight;
    const left = Math.max(8, Math.min(r.left, window.innerWidth - w - 8));
    const below = r.bottom + 4 + h < window.innerHeight - 8;
    pop.style.left = `${left}px`;
    pop.style.top = `${below ? r.bottom + 4 : Math.max(8, r.top - h - 4)}px`;

    const outside = (e) => !pop.contains(e.target) && !anchor.contains(e.target) && closeDuePicker();
    const key = (e) => e.key === 'Escape' && closeDuePicker();
    setTimeout(() => document.addEventListener('pointerdown', outside, true));
    document.addEventListener('keydown', key);
    window.addEventListener('resize', closeDuePicker);
    current = () => {
        pop.remove();
        document.removeEventListener('pointerdown', outside, true);
        document.removeEventListener('keydown', key);
        window.removeEventListener('resize', closeDuePicker);
    };
}
