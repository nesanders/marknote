// SPDX-FileCopyrightText: 2026 Marknote fork contributors
// SPDX-License-Identifier: GPL-2.0-only OR GPL-3.0-only OR LicenseRef-KDE-Accepted-GPL

import QtQuick
import QtQuick.Controls as Controls
import QtQuick.Window
import org.kde.kirigami as Kirigami
import org.kde.ki18n
import org.kde.marknote
import org.kde.marknote.settings

/**
 * Window-level actions shared by the menu bar, context menus and shortcuts.
 *
 * Each action exists exactly once so its shortcut is never registered twice
 * (Qt Quick ignores ambiguous shortcuts).
 */
QtObject {
    id: root

    required property Kirigami.ApplicationWindow window

    readonly property bool hasNote: NavigationController.notePath.length > 0
    readonly property url noteUrl: NavigationController.noteFullPath
    readonly property bool hasNotebook: NavigationController.notebookPath.length > 0

    function notesPage(): var {
        return root.window.findPage("NotesPage");
    }

    function editorPage(): var {
        return root.window.findPage("RichEditPage");
    }

    function setSort(mode: string): void {
        Config.sortBehaviour = mode;
        Config.save();
    }

    function toggleConfig(key: string): void {
        Config[key] = !Config[key];
        Config.save();
    }

    // File

    property Kirigami.Action newFolder: Kirigami.Action {
        text: KI18n.i18nc("@action:inmenu", "New Folder…")
        icon.name: "folder-new"
        enabled: root.hasNotebook
        onTriggered: root.window.openNewEntryDialog(1, "")
    }

    property Kirigami.Action syncNow: Kirigami.Action {
        text: SyncManager.runningNotebook.length > 0
            ? KI18n.i18nc("@action:inmenu", "Syncing…")
            : KI18n.i18nc("@action:inmenu", "Sync Notebook Now")
        icon.name: "view-refresh"
        shortcut: "Ctrl+Alt+S"
        enabled: root.hasNotebook && SyncManager.runningNotebook.length === 0
        onTriggered: {
            if (!SyncManager.syncNow(NavigationController.notebookPath)) {
                root.window.openSyncDialog(NavigationController.notebookPath, NavigationController.notebookName);
            }
        }
    }

    property Kirigami.Action syncSettings: Kirigami.Action {
        text: KI18n.i18nc("@action:inmenu", "Notebook Sync Settings…")
        icon.name: "folder-sync"
        enabled: root.hasNotebook
        onTriggered: root.window.openSyncDialog(NavigationController.notebookPath, NavigationController.notebookName)
    }

    property Kirigami.Action exportHtml: Kirigami.Action {
        text: KI18n.i18nc("@action:inmenu", "Export to HTML…")
        icon.name: "text-html"
        enabled: root.hasNote
        onTriggered: root.notesPage()?.exportNote("html", root.noteUrl, NavigationController.noteName)
    }

    property Kirigami.Action exportPdf: Kirigami.Action {
        text: KI18n.i18nc("@action:inmenu", "Export to PDF…")
        icon.name: "application-pdf"
        enabled: root.hasNote
        onTriggered: root.notesPage()?.exportNote("pdf", root.noteUrl, NavigationController.noteName)
    }

    property Kirigami.Action exportOdt: Kirigami.Action {
        text: KI18n.i18nc("@action:inmenu", "Export to ODT…")
        icon.name: "application-vnd.oasis.opendocument.text"
        enabled: root.hasNote
        onTriggered: root.notesPage()?.exportNote("odt", root.noteUrl, NavigationController.noteName)
    }

    // Note

    property Kirigami.Action renameNote: Kirigami.Action {
        text: KI18n.i18nc("@action:inmenu", "Rename")
        icon.name: "edit-rename"
        shortcut: "F2"
        enabled: root.hasNote
        onTriggered: root.notesPage()?.startRename(NavigationController.absoluteNotePath)
    }

    property Kirigami.Action setIcon: Kirigami.Action {
        text: KI18n.i18nc("@action:inmenu", "Set Icon…")
        icon.name: "preferences-desktop-emoticons"
        enabled: root.hasNote
        onTriggered: root.window.openIconPicker(root.noteUrl, false, NavigationController.noteName)
    }

    property Kirigami.Action editTags: Kirigami.Action {
        text: KI18n.i18nc("@action:inmenu", "Edit Tags…")
        icon.name: "tag"
        shortcut: "Ctrl+Shift+T"
        enabled: root.hasNote
        onTriggered: root.window.openTagEditor(root.noteUrl, NavigationController.noteName)
    }

    property Kirigami.Action duplicateNote: Kirigami.Action {
        text: KI18n.i18nc("@action:inmenu", "Duplicate")
        icon.name: "edit-duplicate-symbolic"
        enabled: root.hasNote
        onTriggered: root.notesPage()?.duplicate(root.noteUrl)
    }

    property Kirigami.Action copyNote: Kirigami.Action {
        text: KI18n.i18nc("@action:inmenu", "Copy Note as Markdown")
        icon.name: "edit-copy"
        enabled: root.hasNote
        onTriggered: root.notesPage()?.copyNote(root.noteUrl)
    }

    property Kirigami.Action deleteNote: Kirigami.Action {
        text: KI18n.i18nc("@action:inmenu", "Delete…")
        icon.name: "delete"
        enabled: root.hasNote
        onTriggered: root.notesPage()?.confirmDelete(NavigationController.noteName, NavigationController.absoluteNotePath, root.noteUrl, false)
    }

    // Edit

    property Kirigami.Action findNotes: Kirigami.Action {
        text: KI18n.i18nc("@action:inmenu", "Filter Notes")
        icon.name: "view-filter"
        shortcut: "Ctrl+E"
        enabled: root.hasNotebook
        onTriggered: {
            if (!Config.showFilterBar) {
                Config.showFilterBar = true;
                Config.save();
            }
            FilterState.focusRequested();
        }
    }

    property Kirigami.Action findInNote: Kirigami.Action {
        text: KI18n.i18nc("@action:inmenu", "Find in Note…")
        icon.name: "edit-find"
        enabled: root.hasNote
        onTriggered: root.editorPage()?.openSearch()
    }

    // View

    property Kirigami.Action showSidebar: Kirigami.Action {
        text: KI18n.i18nc("@action:inmenu", "Show Notebook Names")
        icon.name: "sidebar-expand-left"
        checkable: true
        checked: Config.expandedSidebar
        onTriggered: root.toggleConfig("expandedSidebar")
    }

    property Kirigami.Action showFilterBar: Kirigami.Action {
        text: KI18n.i18nc("@action:inmenu", "Show Filter Bar")
        icon.name: "view-filter"
        checkable: true
        checked: Config.showFilterBar
        onTriggered: root.toggleConfig("showFilterBar")
    }

    property Kirigami.Action showTags: Kirigami.Action {
        text: KI18n.i18nc("@action:inmenu", "Show Tags")
        icon.name: "tag"
        checkable: true
        checked: Config.showTagsColumn
        onTriggered: root.toggleConfig("showTagsColumn")
    }

    property Kirigami.Action showCreated: Kirigami.Action {
        text: KI18n.i18nc("@action:inmenu", "Show Created Date")
        icon.name: "view-calendar"
        checkable: true
        checked: Config.showCreatedColumn
        onTriggered: root.toggleConfig("showCreatedColumn")
    }

    property Kirigami.Action sortByName: Kirigami.Action {
        text: KI18n.i18nc("@action:inmenu sort notes", "By Name")
        icon.name: "sort-name"
        checkable: true
        checked: Config.sortBehaviour === "sort-name"
        onTriggered: root.setSort("sort-name")
    }

    property Kirigami.Action sortByModified: Kirigami.Action {
        text: KI18n.i18nc("@action:inmenu sort notes", "By Modified Date")
        icon.name: "view-sort-descending"
        checkable: true
        checked: Config.sortBehaviour === "sort-date"
        onTriggered: root.setSort("sort-date")
    }

    property Kirigami.Action sortByCreated: Kirigami.Action {
        text: KI18n.i18nc("@action:inmenu sort notes", "By Created Date")
        icon.name: "view-sort-descending"
        checkable: true
        checked: Config.sortBehaviour === "sort-created"
        onTriggered: root.setSort("sort-created")
    }

    property Kirigami.Action lockAll: Kirigami.Action {
        text: KI18n.i18nc("@action:inmenu", "Lock Encrypted Notebooks")
        icon.name: "object-locked"
        shortcut: "Ctrl+Shift+L"
        enabled: Vaults.revision >= 0 && Vaults.hasUnlocked
        onTriggered: Vaults.lockAll()
    }

    function setAutoLock(minutes: int): void {
        Config.autoLockMinutes = minutes;
        Config.save();
    }

    function setDensity(level: int): void {
        Config.treeDensity = level;
        Config.save();
    }

    property Kirigami.Action densityCompact: Kirigami.Action {
        text: KI18n.i18nc("@action:inmenu notes list density", "Compact")
        icon.name: "view-list-details"
        checkable: true
        checked: Config.treeDensity === 0
        onTriggered: root.setDensity(0)
    }

    property Kirigami.Action densityNormal: Kirigami.Action {
        text: KI18n.i18nc("@action:inmenu notes list density", "Normal")
        icon.name: "view-list-text"
        checkable: true
        checked: Config.treeDensity === 1
        onTriggered: root.setDensity(1)
    }

    property Kirigami.Action densityComfortable: Kirigami.Action {
        text: KI18n.i18nc("@action:inmenu notes list density", "Comfortable")
        icon.name: "view-list-icons"
        checkable: true
        checked: Config.treeDensity === 2
        onTriggered: root.setDensity(2)
    }

    property Kirigami.Action searchContents: Kirigami.Action {
        text: KI18n.i18nc("@action:inmenu", "Filter Searches Note Text")
        icon.name: "document-preview"
        checkable: true
        checked: Config.filterSearchContents
        onTriggered: FilterState.setSearchContents(!Config.filterSearchContents)
    }

    // Note zoom (View › Zoom, Ctrl +/-/0, Ctrl + mouse wheel)

    function setZoom(percent: int): void {
        const clamped = Math.max(50, Math.min(300, percent));
        if (clamped !== Config.editorZoom) {
            Config.editorZoom = clamped;
            Config.save();
        }
    }

    /// Zoom by whole steps of 10% (positive = in).
    function zoomBy(steps: int): void {
        root.setZoom(Math.round(Config.editorZoom / 10) * 10 + steps * 10);
    }

    property Kirigami.Action zoomIn: Kirigami.Action {
        text: KI18n.i18nc("@action:inmenu", "Zoom In")
        icon.name: "zoom-in"
        shortcut: StandardKey.ZoomIn
        enabled: Config.editorZoom < 300
        onTriggered: root.zoomBy(1)
    }

    property Kirigami.Action zoomOut: Kirigami.Action {
        text: KI18n.i18nc("@action:inmenu", "Zoom Out")
        icon.name: "zoom-out"
        shortcut: StandardKey.ZoomOut
        enabled: Config.editorZoom > 50
        onTriggered: root.zoomBy(-1)
    }

    property Kirigami.Action zoomReset: Kirigami.Action {
        text: KI18n.i18nc("@action:inmenu %1 is the current zoom percentage", "Reset Zoom (%1%)", Config.editorZoom)
        icon.name: "zoom-original"
        shortcut: "Ctrl+0"
        enabled: Config.editorZoom !== 100
        onTriggered: root.setZoom(100)
    }

    // Ctrl+= zooms in too, so Shift is not needed for "+" on most layouts.
    property Shortcut zoomInAlt: Shortcut {
        sequence: "Ctrl+="
        onActivated: root.zoomBy(1)
    }

    property Kirigami.Action expandAll: Kirigami.Action {
        text: KI18n.i18nc("@action:inmenu", "Expand All Folders")
        icon.name: "expand-all"
        enabled: root.hasNotebook
        onTriggered: root.notesPage()?.setAllExpanded(true)
    }

    property Kirigami.Action collapseAll: Kirigami.Action {
        text: KI18n.i18nc("@action:inmenu", "Collapse All Folders")
        icon.name: "collapse-all"
        enabled: root.hasNotebook
        onTriggered: root.notesPage()?.setAllExpanded(false)
    }

    property Kirigami.Action sourceMode: Kirigami.Action {
        text: KI18n.i18nc("@action:inmenu", "Show Markdown Source")
        icon.name: "code-context"
        checkable: true
        checked: NavigationController.sourceMode
        enabled: root.hasNote
        onTriggered: NavigationController.sourceMode = !NavigationController.sourceMode
    }

    property Kirigami.Action fullScreen: Kirigami.Action {
        text: root.window.visibility === Window.FullScreen ? KI18n.i18nc("@action:inmenu", "Exit Full Screen Mode") : KI18n.i18nc("@action:inmenu", "Full Screen Mode")
        icon.name: root.window.visibility === Window.FullScreen ? "view-restore" : "view-fullscreen"
        shortcut: StandardKey.FullScreen
        onTriggered: root.window.visibility === Window.FullScreen ? root.window.showNormal() : root.window.showFullScreen()
    }

    // Settings

    property Kirigami.Action showMenubar: Kirigami.Action {
        text: KI18n.i18nc("@action:inmenu", "Show Menubar")
        icon.name: "show-menu"
        checkable: true
        checked: Config.showMenubar
        shortcut: "Ctrl+M"
        onTriggered: {
            root.toggleConfig("showMenubar");
            if (!Config.showMenubar) {
                root.window.showPassiveNotification(KI18n.i18nc("@info", "Press Ctrl+M to show the menu bar again."));
            }
        }
    }
}
