// SPDX-License-Identifier: GPL-2.0-or-later
// SPDX-FileCopyrightText: 2024 Carl Schwan <carl@carlschwan.eu>

import QtQuick
import QtQuick.Controls as Controls

import org.kde.marknote
import org.kde.ki18n

Controls.Menu {
    id: root

    property string path
    property string name
    property NoteBooksModel model

    Controls.MenuItem {
        text: KI18n.i18nc("@action:inmenu", "Edit Notebook")
        icon.name: "edit-entry-symbolic"
        onTriggered: {
            const editComponent = Qt.createComponent("org.kde.marknote", "NotebookMetadataDialog");
            const editDialog = editComponent.createObject(root, {
                mode: NotebookMetadataDialog.Mode.Edit,
                path: root.path,
                name: root.name,
                color: root.model.colorForPath(root.path),
                iconName: root.model.iconNameForPath(root.path),
                model: root.model,
            }) as NotebookMetadataDialog;
            editDialog.open();
        }
    }

    Controls.MenuItem {
        text: KI18n.i18nc("@action:inmenu", "Sync Settings…")
        icon.name: "folder-sync"
        onTriggered: {
            const syncComponent = Qt.createComponent("org.kde.marknote", "NotebookSyncDialog");
            const syncDialog = syncComponent.createObject(root, {
                notebookPath: root.path,
                notebookName: root.name,
            }) as NotebookSyncDialog;
            syncDialog.open();
        }
    }

    Controls.MenuItem {
        readonly property string destination: root.path.length > 0 && root.visible ? SyncManager.settings(root.path).destination : "none"
        visible: destination !== "none"
        height: visible ? implicitHeight : 0
        enabled: SyncManager.runningNotebook.length === 0
        text: KI18n.i18nc("@action:inmenu", "Sync Now")
        icon.name: "view-refresh"
        onTriggered: SyncManager.syncNow(root.path)
    }

    Controls.MenuItem {
        text: KI18n.i18nc("@action:inmenu", "Make Image Links Relative")
        icon.name: "insert-image"
        onTriggered: NoteMetadata.makeImageLinksRelative(root.path)
    }

    Controls.MenuItem {
        text: KI18n.i18nc("@action:inmenu", "New Notebook…")
        icon.name: "list-add"
        onTriggered: App.action('add_notebook').trigger()
    }

    Controls.MenuSeparator {}

    Controls.MenuItem {
        text: KI18n.i18nc("@action:inmenu", "Delete Notebook")
        icon.name: "delete"
        onTriggered: {
            const deleteComponent = Qt.createComponent("org.kde.marknote", "NotebookDeleteDialog");
            const deleteDialog = deleteComponent.createObject(root, {
                path: root.path,
                name: root.name,
                model: root.model,
            }) as NotebookDeleteDialog;
            deleteDialog.open();
        }
    }
}
