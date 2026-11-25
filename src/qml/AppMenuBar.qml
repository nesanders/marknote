// SPDX-FileCopyrightText: 2026 Marknote fork contributors
// SPDX-License-Identifier: GPL-2.0-only OR GPL-3.0-only OR LicenseRef-KDE-Accepted-GPL

import QtQuick
import QtQuick.Controls as Controls
import org.kde.kirigami as Kirigami
import org.kde.ki18n
import org.kde.marknote
import org.kde.marknote.settings

/**
 * The standard in-window KDE menu bar (File, Edit, View, Insert, Note,
 * Settings, Help). Toggled with Settings › Show Menubar (Ctrl+M).
 */
Controls.MenuBar {
    id: root

    required property AppActions actions
    required property Kirigami.ApplicationWindow window

    // The text field Cut/Copy/Paste/Select All act on.
    property var field: null
    Connections {
        target: root.window
        function onActiveFocusItemChanged(): void {
            const item = root.window.activeFocusItem;
            if (item instanceof TextEdit || item instanceof TextInput) {
                root.field = item;
            }
        }
    }

    // The editor drops its focused block once the menu takes keyboard focus,
    // so remember it when the Insert menu is about to open.
    property var insertTarget: null

    function insert(type: string): void {
        const page = root.actions.editorPage();
        if (!page) {
            return;
        }
        if (root.insertTarget) {
            page.insertBlockBelow(root.insertTarget, type);
        } else {
            page.insertBlockFromMenu(type);
        }
        root.insertTarget = null;
    }

    Controls.Menu {
        title: KI18n.i18nc("@title:menu", "&File")

        AppActionItem { actionName: "add_note"; iconName: "document-new"; shortcutText: "Ctrl+N" }
        Controls.MenuItem { action: root.actions.newFolder }
        AppActionItem { actionName: "add_notebook"; iconName: "address-book-new"; shortcutText: "Ctrl+Shift+N" }
        Controls.MenuSeparator {}
        Controls.Menu {
            title: KI18n.i18nc("@title:menu", "Import")
            icon.name: "document-import"
            AppActionItem { actionName: "import_knotes"; iconName: "knotes-symbolic" }
            AppActionItem { actionName: "import_maildir"; iconName: "folder-mail" }
        }
        Controls.Menu {
            title: KI18n.i18nc("@title:menu", "Export Note")
            icon.name: "document-export"
            enabled: root.actions.hasNote
            Controls.MenuItem { action: root.actions.exportHtml }
            Controls.MenuItem { action: root.actions.exportPdf }
            Controls.MenuItem { action: root.actions.exportOdt }
        }
        Controls.MenuSeparator {}
        Controls.MenuItem { action: root.actions.syncNow }
        Controls.MenuItem { action: root.actions.syncSettings }
        Controls.MenuSeparator {}
        AppActionItem { actionName: "file_quit"; iconName: "application-exit"; shortcutText: "Ctrl+Q" }
    }

    Controls.Menu {
        title: KI18n.i18nc("@title:menu", "&Edit")

        Controls.MenuItem { action: EditorActions.undoAction }
        Controls.MenuItem { action: EditorActions.redoAction }
        Controls.MenuSeparator {}
        Controls.MenuItem {
            text: KI18n.i18nc("@action:inmenu", "Cut")
            icon.name: "edit-cut"
            enabled: root.field !== null && !!root.field.selectedText
            onTriggered: root.field.cut()
        }
        Controls.MenuItem {
            text: KI18n.i18nc("@action:inmenu", "Copy")
            icon.name: "edit-copy"
            enabled: root.field !== null && !!root.field.selectedText
            onTriggered: root.field.copy()
        }
        Controls.MenuItem {
            text: KI18n.i18nc("@action:inmenu", "Paste")
            icon.name: "edit-paste"
            enabled: root.field !== null && root.field.canPaste
            onTriggered: root.field.paste()
        }
        Controls.MenuItem {
            text: KI18n.i18nc("@action:inmenu", "Select All")
            icon.name: "edit-select-all"
            enabled: root.field !== null
            onTriggered: root.field.selectAll()
        }
        Controls.MenuSeparator {}
        Controls.MenuItem { action: root.actions.findInNote }
        Controls.MenuItem { action: root.actions.findNotes }
        Controls.MenuItem { action: root.actions.searchContents }
    }

    Controls.Menu {
        title: KI18n.i18nc("@title:menu", "&View")

        Controls.MenuItem { action: root.actions.showSidebar }
        Controls.MenuItem { action: root.actions.showFilterBar }
        Controls.MenuSeparator {}
        Controls.MenuItem { action: root.actions.showTags }
        Controls.MenuItem { action: root.actions.showCreated }
        Controls.Menu {
            title: KI18n.i18nc("@title:menu", "Density")
            icon.name: "view-list-details"
            Controls.MenuItem { action: root.actions.densityCompact }
            Controls.MenuItem { action: root.actions.densityNormal }
            Controls.MenuItem { action: root.actions.densityComfortable }
        }
        Controls.Menu {
            title: KI18n.i18nc("@title:menu", "Sort Notes")
            icon.name: "view-sort"
            Controls.MenuItem { action: root.actions.sortByName }
            Controls.MenuItem { action: root.actions.sortByModified }
            Controls.MenuItem { action: root.actions.sortByCreated }
            Controls.MenuItem { action: root.actions.sortManual }
        }
        Controls.MenuSeparator {}
        Controls.MenuItem { action: root.actions.expandAll }
        Controls.MenuItem { action: root.actions.collapseAll }
        Controls.MenuSeparator {}
        Controls.Menu {
            title: KI18n.i18nc("@title:menu", "Zoom")
            icon.name: "zoom"
            Controls.MenuItem { action: root.actions.zoomIn }
            Controls.MenuItem { action: root.actions.zoomOut }
            Controls.MenuItem { action: root.actions.zoomReset }
        }
        Controls.MenuItem { action: root.actions.sourceMode }
        Controls.MenuItem { action: root.actions.fullScreen }
    }

    Controls.Menu {
        title: KI18n.i18nc("@title:menu", "&Insert")
        enabled: root.actions.hasNote && !NavigationController.sourceMode
        onAboutToShow: root.insertTarget = CommandManager.model ? CommandManager.model.focusedBlock() : null

        Controls.MenuItem { text: KI18n.i18nc("@action:inmenu", "Heading 1"); icon.name: "format-text-heading"; onTriggered: root.insert("heading1") }
        Controls.MenuItem { text: KI18n.i18nc("@action:inmenu", "Heading 2"); icon.name: "format-text-heading"; onTriggered: root.insert("heading2") }
        Controls.MenuItem { text: KI18n.i18nc("@action:inmenu", "Heading 3"); icon.name: "format-text-heading"; onTriggered: root.insert("heading3") }
        Controls.MenuSeparator {}
        Controls.MenuItem { text: KI18n.i18nc("@action:inmenu", "Checklist"); icon.name: "checkbox"; onTriggered: root.insert("task_list") }
        Controls.MenuItem { text: KI18n.i18nc("@action:inmenu", "To-Do List"); icon.name: "checkbox"; onTriggered: root.insert("todo") }
        Controls.MenuItem { text: KI18n.i18nc("@action:inmenu", "Bulleted List"); icon.name: "format-list-unordered"; onTriggered: root.insert("unordered_list") }
        Controls.MenuItem { text: KI18n.i18nc("@action:inmenu", "Numbered List"); icon.name: "format-list-ordered"; onTriggered: root.insert("ordered_list") }
        Controls.MenuItem { text: KI18n.i18nc("@action:inmenu", "Quote"); icon.name: "format-text-blockquote"; onTriggered: root.insert("blockquote") }
        Controls.MenuSeparator {}
        Controls.MenuItem { text: KI18n.i18nc("@action:inmenu", "Code Block"); icon.name: "code-context"; onTriggered: root.insert("code") }
        Controls.MenuItem { text: KI18n.i18nc("@action:inmenu", "Mermaid Diagram"); icon.name: "view-preview"; onTriggered: root.insert("mermaid") }
        Controls.MenuItem { text: KI18n.i18nc("@action:inmenu", "Table"); icon.name: "insert-table"; onTriggered: root.insert("table") }
        Controls.MenuItem { text: KI18n.i18nc("@action:inmenu", "Divider"); icon.name: "insert-horizontal-rule"; onTriggered: root.insert("divider") }
        Controls.MenuSeparator {}
        Controls.MenuItem {
            text: KI18n.i18nc("@info:inmenu", "Tip: type / in a note for all blocks")
            enabled: false
        }
    }

    Controls.Menu {
        title: KI18n.i18nc("@title:menu", "&Note")

        Controls.MenuItem { action: root.actions.renameNote }
        Controls.MenuItem { action: root.actions.setIcon }
        Controls.MenuItem { action: root.actions.editTags }
        Controls.MenuSeparator {}
        Controls.MenuItem { action: root.actions.duplicateNote }
        Controls.MenuItem { action: root.actions.copyNote }
        Controls.MenuItem {
            action: root.actions.showInGoogleDrive
            visible: action.visible
            height: visible ? implicitHeight : 0
        }
        Controls.MenuSeparator {}
        Controls.MenuItem { action: root.actions.deleteNote }
    }

    Controls.Menu {
        title: KI18n.i18nc("@title:menu", "&Settings")

        Controls.MenuItem { action: root.actions.showMenubar }
        Controls.MenuSeparator {}
        Controls.MenuItem { action: root.actions.autoSync }
        Controls.Menu {
            title: KI18n.i18nc("@title:menu", "Check for Changes Every")
            enabled: Config.autoSync
            Repeater {
                model: [2, 5, 15, 30]
                delegate: Controls.MenuItem {
                    required property int modelData
                    text: KI18n.i18ncp("@action:inmenu", "%1 minute", "%1 minutes", modelData)
                    checkable: true
                    checked: Config.autoSyncMinutes === modelData
                    autoExclusive: true
                    onTriggered: root.actions.setAutoSyncMinutes(modelData)
                }
            }
        }
        Controls.MenuSeparator {}
        Controls.MenuItem { action: root.actions.lockAll }
        Controls.Menu {
            title: KI18n.i18nc("@title:menu", "Lock Encrypted Notebooks After")
            Repeater {
                model: [5, 15, 30, 60, 0]
                delegate: Controls.MenuItem {
                    required property int modelData
                    text: modelData === 0 ? KI18n.i18nc("@action:inmenu auto-lock", "Never (until Marknote quits)")
                                          : KI18n.i18ncp("@action:inmenu auto-lock", "%1 minute idle", "%1 minutes idle", modelData)
                    checkable: true
                    checked: Config.autoLockMinutes === modelData
                    autoExclusive: true
                    onTriggered: root.actions.setAutoLock(modelData)
                }
            }
        }
        Controls.MenuSeparator {}
        AppActionItem { actionName: "open_kcommand_bar"; iconName: "new-command-alarm"; shortcutText: "Ctrl+Alt+I" }
        AppActionItem { actionName: "options_configure_keybinding"; iconName: "configure-shortcuts"; shortcutText: "Ctrl+Alt+," }
        AppActionItem { actionName: "options_configure"; iconName: "configure"; shortcutText: "Ctrl+Shift+," }
    }

    Controls.Menu {
        title: KI18n.i18nc("@title:menu", "&Help")

        AppActionItem { actionName: "open_about_page"; iconName: "help-about" }
        AppActionItem { actionName: "open_about_kde_page"; iconName: "kde" }
    }
}
