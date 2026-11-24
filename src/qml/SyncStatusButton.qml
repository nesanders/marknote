// SPDX-FileCopyrightText: 2026 Marknote fork contributors
// SPDX-License-Identifier: GPL-2.0-only OR GPL-3.0-only OR LicenseRef-KDE-Accepted-GPL

import QtQuick
import QtQuick.Controls
import QtQuick.Layouts
import org.kde.kirigami as Kirigami
import org.kde.ki18n
import org.kde.marknote

/**
 * Sync state of a notebook (up to date, syncing, failed) and, on click, what
 * the recent syncs changed. Hidden for notebooks without a sync destination.
 */
ToolButton {
    id: root

    required property string notebookPath

    // Re-read on every sync event; "now" ticks so "3 min ago" stays right.
    property date now: new Date()
    readonly property var status: SyncManager.activityRevision >= 0 && SyncManager.runningNotebook !== undefined && now
        ? SyncManager.status(notebookPath) : ({})
    readonly property string state_: status.state ?? "none"
    readonly property int unseen: SyncManager.activityRevision >= 0 ? SyncManager.unseenCount(notebookPath) : 0

    Timer {
        interval: 30000
        repeat: true
        running: root.visible
        onTriggered: root.now = new Date()
    }
    Connections {
        target: SyncManager
        function onSyncFinished(): void { root.now = new Date(); }
        function onRunningChanged(): void { root.now = new Date(); }
    }

    function ago(date: var): string {
        if (!date || isNaN(date.getTime())) {
            return "";
        }
        const minutes = Math.floor((root.now - date) / 60000);
        if (minutes < 1) {
            return KI18n.i18nc("@info time", "just now");
        }
        if (minutes < 60) {
            return KI18n.i18ncp("@info time", "1 min ago", "%1 min ago", minutes);
        }
        if (date.toDateString() === root.now.toDateString()) {
            return KI18n.i18nc("@info time", "today at %1", date.toLocaleTimeString(Qt.locale(), Locale.ShortFormat));
        }
        return date.toLocaleString(Qt.locale(), Locale.ShortFormat);
    }

    readonly property string statusText: {
        const where = status.destination ?? "";
        switch (state_) {
        case "syncing":
            return SyncManager.progress.length > 0 ? KI18n.i18nc("@info", "Syncing with %1: %2", where, SyncManager.progress) : KI18n.i18nc("@info", "Syncing with %1…", where);
        case "queued":
            return KI18n.i18nc("@info", "Waiting to sync with %1…", where);
        case "never":
            return KI18n.i18nc("@info", "Not synced with %1 yet", where);
        case "error":
            return KI18n.i18nc("@info %1 destination, %2 time", "Last sync with %1 failed (%2)", where, ago(status.lastSync));
        default:
            return KI18n.i18nc("@info %1 destination, %2 time", "Synced with %1 %2", where, ago(status.lastSync));
        }
    }

    visible: state_ !== "none" && notebookPath.length > 0
    display: AbstractButton.IconOnly
    text: statusText
    icon.name: state_ === "syncing" || state_ === "queued" ? "state-sync"
             : state_ === "error" ? "state-error"
             : state_ === "never" ? "state-offline" : "state-ok"
    checkable: true
    checked: popup.visible
    onClicked: popup.visible ? popup.close() : popup.open()
    ToolTip.delay: Kirigami.Units.toolTipDelay
    ToolTip.visible: hovered && !popup.visible
    ToolTip.text: statusText

    Popup {
        id: popup
        y: root.height + Kirigami.Units.smallSpacing
        x: Math.min(0, (root.parent ? root.parent.width : root.width) - width - root.x)
        width: Kirigami.Units.gridUnit * 22
        padding: Kirigami.Units.largeSpacing
        closePolicy: Popup.CloseOnEscape | Popup.CloseOnPressOutsideParent
        onOpened: activityModel.reload()

        ListModel { id: activityModel
            function reload(): void {
                clear();
                for (const e of SyncManager.activity(root.notebookPath, 60)) {
                    // A conflict also uploads our version: one line is enough.
                    append({
                        kind: e.kind, path: e.path, copy: e.copy, exists: e.exists, copyExists: e.copyExists,
                        unseen: e.unseen, time: e.time.toISOString(),
                    });
                }
            }
        }
        Connections {
            target: SyncManager
            function onActivityChanged(): void {
                if (popup.visible) {
                    activityModel.reload();
                }
            }
        }

        contentItem: ColumnLayout {
            spacing: Kirigami.Units.smallSpacing

            RowLayout {
                Layout.fillWidth: true
                Kirigami.Icon {
                    source: root.icon.name
                    implicitWidth: Kirigami.Units.iconSizes.smallMedium
                    implicitHeight: implicitWidth
                }
                Label {
                    Layout.fillWidth: true
                    text: root.statusText
                    wrapMode: Text.Wrap
                    font.weight: Font.DemiBold
                }
            }
            Label {
                Layout.fillWidth: true
                visible: root.state_ === "error" && (root.status.errors ?? []).length > 0
                text: (root.status.errors ?? []).slice(0, 3).join("\n")
                wrapMode: Text.Wrap
                color: Kirigami.Theme.negativeTextColor
                font: Kirigami.Theme.smallFont
            }
            Label {
                Layout.fillWidth: true
                visible: Config.autoSync
                text: KI18n.i18ncp("@info", "Checks for changes every minute while Marknote is open.",
                                   "Checks for changes every %1 minutes while Marknote is open.", Config.autoSyncMinutes)
                wrapMode: Text.Wrap
                color: Kirigami.Theme.disabledTextColor
                font: Kirigami.Theme.smallFont
            }

            RowLayout {
                Layout.fillWidth: true
                Button {
                    text: KI18n.i18nc("@action:button", "Sync Now")
                    icon.name: "view-refresh"
                    enabled: root.state_ !== "syncing" && root.state_ !== "queued"
                    onClicked: SyncManager.syncNow(root.notebookPath)
                }
                Button {
                    text: KI18n.i18nc("@action:button", "Mark All Seen")
                    icon.name: "mail-mark-read"
                    visible: root.unseen > 0
                    onClicked: SyncManager.markAllSeen(root.notebookPath)
                }
                Item { Layout.fillWidth: true }
                ToolButton {
                    icon.name: "configure"
                    display: AbstractButton.IconOnly
                    text: KI18n.i18nc("@action:button", "Sync Settings…")
                    ToolTip.visible: hovered
                    ToolTip.text: text
                    onClicked: {
                        popup.close();
                        const component = Qt.createComponent("org.kde.marknote", "NotebookSyncDialog");
                        const dialog = component.createObject(root.Window.window?.overlay ?? root, {
                            notebookPath: root.notebookPath,
                            notebookName: root.notebookPath.split("/").filter(p => p.length > 0).pop() ?? "",
                        });
                        dialog.open();
                    }
                }
            }

            Kirigami.Separator { Layout.fillWidth: true }

            Label {
                Layout.fillWidth: true
                text: KI18n.i18nc("@title:group", "Recent changes")
                font: Kirigami.Theme.smallFont
                color: Kirigami.Theme.disabledTextColor
            }
            Label {
                visible: activityModel.count === 0
                Layout.fillWidth: true
                text: KI18n.i18nc("@info", "Nothing has changed by sync yet.")
                wrapMode: Text.Wrap
                color: Kirigami.Theme.disabledTextColor
            }

            ListView {
                id: list
                Layout.fillWidth: true
                Layout.preferredHeight: Math.min(contentHeight, Kirigami.Units.gridUnit * 16)
                visible: activityModel.count > 0
                clip: true
                model: activityModel
                ScrollBar.vertical: ScrollBar {}
                delegate: ItemDelegate {
                    id: row
                    required property string kind
                    required property string path
                    required property string copy
                    required property bool exists
                    required property bool copyExists
                    required property bool unseen
                    required property string time

                    readonly property string target: kind === "conflict" ? copy : path
                    readonly property bool canOpen: kind === "conflict" ? copyExists : (exists && path.endsWith(".md"))
                    readonly property string title: path.replace(/\.md$/, "")

                    width: ListView.view.width
                    enabled: canOpen
                    onClicked: {
                        NavigationController.notePath = target;
                        popup.close();
                    }
                    contentItem: RowLayout {
                        spacing: Kirigami.Units.smallSpacing
                        Kirigami.Icon {
                            implicitWidth: Kirigami.Units.iconSizes.small
                            implicitHeight: implicitWidth
                            source: ({ received: "cloud-download", sent: "cloud-upload", deletedHere: "edit-delete",
                                       deletedThere: "edit-delete", conflict: "data-warning" })[row.kind] ?? "folder-cloud"
                        }
                        ColumnLayout {
                            Layout.fillWidth: true
                            spacing: 0
                            Label {
                                Layout.fillWidth: true
                                text: row.title
                                elide: Text.ElideMiddle
                                font.weight: row.unseen ? Font.DemiBold : Font.Normal
                                opacity: row.canOpen || row.kind.startsWith("deleted") ? 1 : 0.6
                            }
                            Label {
                                Layout.fillWidth: true
                                elide: Text.ElideRight
                                font: Kirigami.Theme.smallFont
                                color: Kirigami.Theme.disabledTextColor
                                text: {
                                    const where = root.status.destination ?? "";
                                    const when = root.ago(new Date(row.time));
                                    switch (row.kind) {
                                    case "received": return KI18n.i18nc("@info %1 destination, %2 time", "Updated from %1 · %2", where, when);
                                    case "sent": return KI18n.i18nc("@info %1 destination, %2 time", "Sent to %1 · %2", where, when);
                                    case "deletedHere": return KI18n.i18nc("@info %1 time", "Deleted on another device, moved to the notebook’s trash · %1", when);
                                    case "deletedThere": return KI18n.i18nc("@info %1 destination, %2 time", "Deleted here, moved to the trash of %1 · %2", where, when);
                                    case "conflict": return KI18n.i18nc("@info %1 time", "Changed on both sides: both versions kept · %1", when);
                                    }
                                    return when;
                                }
                            }
                        }
                        Rectangle {
                            visible: row.unseen
                            implicitWidth: Math.round(Kirigami.Units.gridUnit * 0.45)
                            implicitHeight: implicitWidth
                            radius: width / 2
                            color: Kirigami.Theme.highlightColor
                        }
                    }
                }
            }
        }
    }
}
