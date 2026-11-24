// SPDX-FileCopyrightText: 2026 Marknote fork contributors
// SPDX-License-Identifier: GPL-2.0-only OR GPL-3.0-only OR LicenseRef-KDE-Accepted-GPL

import QtQuick
import QtQuick.Controls as Controls
import QtQuick.Layouts
import org.kde.kirigami as Kirigami
import org.kde.ki18n
import org.kde.marknote

/** Change a notebook's password, or remove its encryption. */
Kirigami.Dialog {
    id: root

    enum Mode { Change, Remove }

    required property string notebookPath
    property string notebookName: ""
    property int mode: VaultPasswordDialog.Mode.Change
    property string error: ""
    property bool busy: false
    readonly property bool changing: mode === VaultPasswordDialog.Mode.Change
    readonly property bool valid: current.text.length > 0
        && (!changing || (newPassword.text.length >= 8 && newPassword.text === confirm.text))

    title: changing ? KI18n.i18nc("@title:window %1 is a notebook name", "Change Password of “%1”", notebookName)
                    : KI18n.i18nc("@title:window %1 is a notebook name", "Remove Encryption from “%1”", notebookName)
    preferredWidth: Kirigami.Units.gridUnit * 26
    padding: Kirigami.Units.largeSpacing
    standardButtons: Kirigami.Dialog.NoButton

    onOpened: current.forceActiveFocus()
    onClosed: destroy()

    function apply(): void {
        if (!root.valid || root.busy) {
            return;
        }
        root.busy = true;
        root.error = "";
        Qt.callLater(() => {
            const ok = root.changing ? Vaults.changePassword(root.notebookPath, current.text, newPassword.text)
                                     : Vaults.removeEncryption(root.notebookPath, current.text);
            root.busy = false;
            if (ok) {
                root.close();
            } else {
                root.error = Vaults.lastError;
            }
        });
    }

    customFooterActions: [
        Kirigami.Action {
            text: KI18n.i18nc("@action:button", "Cancel")
            icon.name: "dialog-cancel"
            onTriggered: root.close()
        },
        Kirigami.Action {
            text: root.changing ? KI18n.i18nc("@action:button", "Change Password") : KI18n.i18nc("@action:button", "Decrypt All Notes")
            icon.name: root.changing ? "lock-edit" : "object-unlocked"
            enabled: root.valid && !root.busy
            onTriggered: root.apply()
        }
    ]

    ColumnLayout {
        spacing: Kirigami.Units.largeSpacing

        Controls.Label {
            Layout.fillWidth: true
            Layout.preferredWidth: Kirigami.Units.gridUnit * 23
            wrapMode: Text.Wrap
            text: root.changing
                ? KI18n.i18nc("@info", "Notes are not re-encrypted; only the password that unlocks them changes. The recovery key stays the same. Other devices need the new password after the next sync.")
                : KI18n.i18nc("@info", "Every note in this notebook will be stored as plain text again, on this device and on every device it syncs to.")
        }

        Kirigami.FormLayout {
            Layout.fillWidth: true
            Kirigami.PasswordField {
                id: current
                Kirigami.FormData.label: KI18n.i18nc("@label:textbox", "Current password:")
                Layout.fillWidth: true
                onAccepted: root.changing ? newPassword.forceActiveFocus() : root.apply()
                KeyNavigation.tab: root.changing ? newPassword : null
            }
            Kirigami.PasswordField {
                id: newPassword
                KeyNavigation.tab: confirm
                onAccepted: confirm.forceActiveFocus()
                visible: root.changing
                Kirigami.FormData.label: KI18n.i18nc("@label:textbox", "New password:")
                Layout.fillWidth: true
            }
            Kirigami.PasswordField {
                id: confirm
                visible: root.changing
                Kirigami.FormData.label: KI18n.i18nc("@label:textbox", "Repeat new password:")
                Layout.fillWidth: true
                onAccepted: root.apply()
            }
            Controls.Label {
                visible: root.changing && newPassword.text.length > 0 && newPassword.text.length < 8
                text: KI18n.i18nc("@info", "At least 8 characters.")
                color: Kirigami.Theme.negativeTextColor
                font: Kirigami.Theme.smallFont
            }
        }

        Kirigami.InlineMessage {
            Layout.fillWidth: true
            visible: root.error.length > 0
            type: Kirigami.MessageType.Error
            text: root.error
        }
    }
}
