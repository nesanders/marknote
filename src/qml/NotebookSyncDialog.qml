// SPDX-FileCopyrightText: 2026 Marknote fork contributors
// SPDX-License-Identifier: GPL-2.0-only OR GPL-3.0-only OR LicenseRef-KDE-Accepted-GPL

import QtQuick
import QtQuick.Controls as Controls
import QtQuick.Dialogs as Dialogs
import QtQuick.Layouts
import org.kde.kirigami as Kirigami
import org.kde.ki18n
import org.kde.marknote

/**
 * Where one notebook syncs to: nowhere, a Google Drive folder or another folder
 * (e.g. one that Syncthing or Nextcloud already syncs). Settings are saved as
 * they change; "Sync Now" runs in the background.
 */
Kirigami.Dialog {
    id: root

    required property string notebookPath
    property string notebookName: ""

    property var config: ({})
    readonly property string destination: config.destination ?? "none"
    readonly property bool running: SyncManager.runningNotebook.length > 0
        && root.normalized(SyncManager.runningNotebook) === root.normalized(root.notebookPath)
    readonly property var google: SyncManager.google
    readonly property bool ready: destination === "google" ? (google.signedIn && remoteField.text.trim().length > 0)
        : destination === "folder" ? folderField.text.trim().length > 0 : false

    title: notebookName.length > 0
        ? KI18n.i18nc("@title:window %1 is a notebook name", "Sync “%1”", notebookName)
        : KI18n.i18nc("@title:window", "Sync Notebook")
    preferredWidth: Kirigami.Units.gridUnit * 28
    padding: Kirigami.Units.largeSpacing
    standardButtons: Kirigami.Dialog.Close

    customFooterActions: [
        Kirigami.Action {
            text: root.running ? KI18n.i18nc("@action:button", "Syncing…") : KI18n.i18nc("@action:button", "Sync Now")
            icon.name: "view-refresh"
            enabled: root.ready && !root.running
            onTriggered: {
                root.save();
                SyncManager.syncNow(root.notebookPath);
            }
        }
    ]

    function normalized(path: string): string {
        return path.replace(/^file:\/\//, "").replace(/\/+$/, "");
    }

    function reload(): void {
        root.config = SyncManager.settings(root.notebookPath);
        destinationBox.currentIndex = Math.max(0, destinationBox.model.findIndex(d => d.value === root.config.destination));
        remoteField.text = root.config.remoteFolder ?? "";
        folderField.text = root.config.localFolder ?? "";
    }

    function save(): void {
        SyncManager.saveSettings(root.notebookPath, {
            destination: destinationBox.model[destinationBox.currentIndex].value,
            remoteFolder: remoteField.text,
            localFolder: folderField.text,
        });
        root.config = SyncManager.settings(root.notebookPath);
    }

    onOpened: reload()
    onClosed: {
        save();
        destroy();
    }

    Connections {
        target: SyncManager
        function onSyncFinished(path: string): void {
            if (root.normalized(path) === root.normalized(root.notebookPath)) {
                root.config = SyncManager.settings(root.notebookPath);
            }
        }
    }

    Dialogs.FolderDialog {
        id: folderDialog
        title: KI18n.i18nc("@title:window", "Choose a Folder to Sync With")
        onAccepted: {
            folderField.text = selectedFolder.toString().replace(/^file:\/\//, "");
            root.save();
        }
    }

    ColumnLayout {
        id: content
        // Wrapped text must not widen the dialog.
        readonly property real textWidth: Kirigami.Units.gridUnit * 26
        spacing: Kirigami.Units.largeSpacing

        Kirigami.FormLayout {
            Layout.fillWidth: true

            Controls.ComboBox {
                id: destinationBox
                Kirigami.FormData.label: KI18n.i18nc("@label:listbox", "Sync to:")
                textRole: "text"
                valueRole: "value"
                model: [
                    { value: "none", text: KI18n.i18nc("@item:inlistbox sync destination", "Nothing (this device only)") },
                    { value: "google", text: KI18n.i18nc("@item:inlistbox sync destination", "Google Drive") },
                    { value: "folder", text: KI18n.i18nc("@item:inlistbox sync destination", "Another folder") },
                ]
                onActivated: {
                    root.save();
                }
            }

            // Google Drive
            RowLayout {
                visible: root.destination === "google"
                Kirigami.FormData.label: KI18n.i18nc("@label", "Account:")
                spacing: Kirigami.Units.smallSpacing

                Controls.Label {
                    Layout.fillWidth: true
                    elide: Text.ElideRight
                    text: root.google.busy ? KI18n.i18nc("@info", "Waiting for the browser…")
                        : root.google.signedIn ? (root.google.account.length > 0 ? root.google.account : KI18n.i18nc("@info", "Signed in"))
                        : KI18n.i18nc("@info", "Not signed in")
                }
                Controls.Button {
                    visible: !root.google.signedIn && !root.google.busy
                    enabled: root.google.configured
                    text: KI18n.i18nc("@action:button", "Sign in with Google…")
                    icon.name: "im-google"
                    onClicked: root.google.signIn()
                }
                Controls.Button {
                    visible: root.google.busy
                    text: KI18n.i18nc("@action:button", "Copy Link")
                    icon.name: "edit-copy"
                    Controls.ToolTip.text: KI18n.i18nc("@info:tooltip", "If no browser opened, paste this link into one")
                    Controls.ToolTip.visible: hovered
                    onClicked: {
                        linkCopy.text = root.google.pendingAuthorizationUrl.toString();
                        linkCopy.selectAll();
                        linkCopy.copy();
                    }
                }
                Controls.Button {
                    visible: root.google.busy
                    text: KI18n.i18nc("@action:button", "Cancel")
                    onClicked: root.google.cancelSignIn()
                }
                Controls.Button {
                    visible: root.google.signedIn
                    text: KI18n.i18nc("@action:button", "Sign Out")
                    onClicked: root.google.signOut()
                }
                TextEdit {
                    id: linkCopy
                    visible: false
                }
            }

            Controls.TextField {
                id: remoteField
                visible: root.destination === "google"
                Kirigami.FormData.label: KI18n.i18nc("@label:textbox", "Drive folder:")
                Layout.fillWidth: true
                placeholderText: SyncManager.defaultRemoteFolder(root.notebookPath)
                onEditingFinished: root.save()
            }

            // Another folder
            RowLayout {
                visible: root.destination === "folder"
                Kirigami.FormData.label: KI18n.i18nc("@label:textbox", "Folder:")
                Layout.fillWidth: true

                Controls.TextField {
                    id: folderField
                    Layout.fillWidth: true
                    placeholderText: KI18n.i18nc("@info:placeholder", "/path/to/synced/folder")
                    onEditingFinished: root.save()
                }
                Controls.Button {
                    icon.name: "document-open-folder"
                    text: KI18n.i18nc("@action:button", "Browse…")
                    onClicked: folderDialog.open()
                }
            }
        }

        Kirigami.InlineMessage {
            Layout.fillWidth: true
            Layout.preferredWidth: content.textWidth
            visible: root.destination === "google" && !root.google.configured
            type: Kirigami.MessageType.Warning
            text: KI18n.i18nc("@info", "This build has no Google client ID. Create an OAuth client of type “Desktop app” in the Google Cloud console, enable the Google Drive API, and enter its ID and secret below.")
        }

        Kirigami.InlineMessage {
            Layout.fillWidth: true
            Layout.preferredWidth: content.textWidth
            visible: root.destination === "google" && root.google.lastError.length > 0
            type: Kirigami.MessageType.Error
            text: root.google.lastError
        }

        Controls.Label {
            Layout.fillWidth: true
            Layout.preferredWidth: content.textWidth
            visible: root.destination === "google"
            wrapMode: Text.Wrap
            font: Kirigami.Theme.smallFont
            color: Kirigami.Theme.disabledTextColor
            text: KI18n.i18nc("@info %1 is where the token is stored, e.g. KDE Wallet",
                "Marknote only asks for access to files it creates itself; it cannot see the rest of your Drive. Your sign-in is kept in %1. Deleted notes go to the Drive trash.",
                root.google.tokenStorage)
        }

        Controls.Label {
            Layout.fillWidth: true
            Layout.preferredWidth: content.textWidth
            visible: root.destination === "folder"
            wrapMode: Text.Wrap
            font: Kirigami.Theme.smallFont
            color: Kirigami.Theme.disabledTextColor
            text: KI18n.i18nc("@info", "Notes are copied both ways between the notebook and this folder, for example one that Nextcloud or Syncthing keeps in sync. Deleted notes are moved to “.marknote/trash” instead of being removed.")
        }

        // OAuth client (shown when needed, or on request)
        Controls.CheckBox {
            id: advancedToggle
            visible: root.destination === "google" && root.google.configured
            text: KI18n.i18nc("@option:check", "Use my own Google OAuth client")
            checked: SyncManager.googleClientId.length > 0
        }

        Kirigami.FormLayout {
            Layout.fillWidth: true
            visible: root.destination === "google" && (!root.google.configured || advancedToggle.checked)

            Controls.TextField {
                id: clientIdField
                Kirigami.FormData.label: KI18n.i18nc("@label:textbox", "Client ID:")
                Layout.fillWidth: true
                text: SyncManager.googleClientId
                placeholderText: "1234-abc.apps.googleusercontent.com"
            }
            Controls.TextField {
                id: clientSecretField
                Kirigami.FormData.label: KI18n.i18nc("@label:textbox", "Client secret:")
                Layout.fillWidth: true
                echoMode: TextInput.Password
            }
            Controls.Button {
                text: KI18n.i18nc("@action:button", "Save Client")
                enabled: clientIdField.text.trim().length > 0
                onClicked: SyncManager.setGoogleClient(clientIdField.text, clientSecretField.text)
            }
        }

        Kirigami.Separator {
            Layout.fillWidth: true
            visible: root.destination !== "none"
        }

        // Status
        RowLayout {
            Layout.fillWidth: true
            visible: root.destination !== "none"
            spacing: Kirigami.Units.smallSpacing

            Controls.BusyIndicator {
                visible: root.running
                running: visible
                Layout.preferredWidth: Kirigami.Units.iconSizes.smallMedium
                Layout.preferredHeight: Kirigami.Units.iconSizes.smallMedium
            }
            Kirigami.Icon {
                visible: !root.running && !!root.config.lastSync && !isNaN(root.config.lastSync)
                source: root.config.lastOk ? "data-success" : "data-error"
                Layout.preferredWidth: Kirigami.Units.iconSizes.small
                Layout.preferredHeight: Kirigami.Units.iconSizes.small
            }
            Controls.Label {
                Layout.fillWidth: true
                Layout.preferredWidth: content.textWidth
                wrapMode: Text.Wrap
                text: {
                    if (root.running) {
                        return SyncManager.progress;
                    }
                    const last = root.config.lastSync;
                    if (!last || isNaN(last)) {
                        return KI18n.i18nc("@info", "Not synced yet");
                    }
                    return KI18n.i18nc("@info %1 is a date and time, %2 a summary", "Last synced %1: %2",
                        Qt.formatDateTime(last, Qt.locale().dateTimeFormat(Locale.ShortFormat)), root.config.lastSummary ?? "");
                }
            }
        }

        Repeater {
            model: root.running ? [] : (root.config.lastErrors ?? []).slice(0, 5)
            delegate: Controls.Label {
                required property string modelData
                Layout.fillWidth: true
                Layout.preferredWidth: content.textWidth
                wrapMode: Text.Wrap
                color: Kirigami.Theme.negativeTextColor
                text: "• " + modelData
            }
        }
    }
}
