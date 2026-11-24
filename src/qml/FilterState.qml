// SPDX-FileCopyrightText: 2026 Marknote fork contributors
// SPDX-License-Identifier: GPL-2.0-only OR GPL-3.0-only OR LicenseRef-KDE-Accepted-GPL

pragma Singleton

import QtQuick
import org.kde.marknote
import org.kde.marknote.settings

/**
 * Notes-list filter shared by the filter bar, the sidebar tag list and the menus.
 *
 * Text matches note and folder names; "tag:name" in the text also matches tags.
 * Selected tags narrow the list to notes having all of them, or any of them
 * when matchAny is set.
 */
QtObject {
    id: root

    property string text: ""
    property var tags: []
    readonly property bool matchAny: Config.tagFilterMatchAny
    readonly property bool searchContents: Config.filterSearchContents
    readonly property bool active: text.trim().length > 0 || tags.length > 0

    /// Bumped on every change so filter proxies know to re-run.
    property int revision: 0

    onTextChanged: revision++
    onTagsChanged: revision++
    onMatchAnyChanged: revision++
    onSearchContentsChanged: revision++

    signal focusRequested()

    function hasTag(tag: string): bool {
        return tags.indexOf(tag) !== -1;
    }

    function toggleTag(tag: string): void {
        const next = tags.slice();
        const i = next.indexOf(tag);
        if (i === -1) {
            next.push(tag);
        } else {
            next.splice(i, 1);
        }
        tags = next;
    }

    function setSearchContents(on: bool): void {
        Config.filterSearchContents = on;
        Config.save();
    }

    function setMatchAny(any: bool): void {
        Config.tagFilterMatchAny = any;
        Config.save();
    }

    function clear(): void {
        text = "";
        tags = [];
    }

    /// Whether a note with @p name and @p noteTags (at @p path) passes the filter.
    /// With searchContents, plain text also matches the note's body.
    function acceptsNote(name: string, noteTags: var, path: string): bool {
        const list = noteTags ? Array.from(noteTags) : [];
        let q = text.trim().toLowerCase();
        if (q.length > 0) {
            if (q.startsWith("tag:")) {
                const wanted = q.substring(4).trim();
                if (wanted.length > 0 && !list.some(t => t.toLowerCase().startsWith(wanted))) {
                    return false;
                }
            } else if (name.toLowerCase().indexOf(q) === -1
                       && !list.some(t => t.toLowerCase() === q)
                       && !(searchContents && path && NoteMetadata.noteContains(path, q))) {
                return false;
            }
        }
        if (tags.length > 0) {
            const has = t => list.indexOf(t) !== -1;
            if (matchAny ? !tags.some(has) : !tags.every(has)) {
                return false;
            }
        }
        return true;
    }

    /// Folders only pass on their own name (tag filters never match a folder
    /// itself; recursive filtering keeps folders that contain matching notes).
    function acceptsFolder(name: string): bool {
        const q = text.trim().toLowerCase();
        if (tags.length > 0 || q.length === 0 || q.startsWith("tag:")) {
            return false;
        }
        return name.toLowerCase().indexOf(q) !== -1;
    }
}
