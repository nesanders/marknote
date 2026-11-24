// SPDX-FileCopyrightText: 2026 Marknote fork contributors
// SPDX-License-Identifier: GPL-2.0-only OR GPL-3.0-only OR LicenseRef-KDE-Accepted-GPL

import QtQuick
import QtQuick.Controls as Controls
import QtQuick.Layouts
import org.kde.kirigami as Kirigami
import org.kde.ki18n
import org.kde.marknote

/**
 * Password (or recovery key) entry for a locked notebook. Used in the unlock
 * dialog and in place of a locked note.
 */
ColumnLayout {
    id: root

    required property string notebookPath
    property bool useRecoveryKey: false
    property string error: ""
    readonly property bool canSubmit: field.text.length > 0

    signal unlocked()

    spacing: Kirigami.Units.largeSpacing

    function submit(): void {
        if (!canSubmit) {
            return;
        }
        root.error = "";
        const ok = root.useRecoveryKey
            ? Vaults.unlockWithRecoveryKey(root.notebookPath, field.text)
            : Vaults.unlock(root.notebookPath, field.text);
        if (ok) {
            field.text = "";
            root.unlocked();
        } else {
            root.error = Vaults.lastError;
            field.selectAll();
            field.forceActiveFocus();
        }
    }

    function focusField(): void {
        field.forceActiveFocus();
    }

    Kirigami.PasswordField {
        id: field
        Layout.fillWidth: true
        placeholderText: root.useRecoveryKey ? KI18n.i18nc("@info:placeholder", "Recovery key (ABCD-EFGH-…)") : KI18n.i18nc("@info:placeholder", "Password")
        echoMode: root.useRecoveryKey ? TextInput.Normal : TextInput.Password
        showPassword: root.useRecoveryKey
        font.family: root.useRecoveryKey ? "monospace" : Kirigami.Theme.defaultFont.family
        onAccepted: root.submit()
        Accessible.name: placeholderText
    }

    Kirigami.InlineMessage {
        Layout.fillWidth: true
        visible: root.error.length > 0
        type: Kirigami.MessageType.Error
        text: root.error
    }

    RowLayout {
        Layout.fillWidth: true
        Controls.Button {
            flat: true
            text: root.useRecoveryKey ? KI18n.i18nc("@action:button", "Use Password Instead") : KI18n.i18nc("@action:button", "Use Recovery Key…")
            onClicked: {
                root.useRecoveryKey = !root.useRecoveryKey;
                root.error = "";
                field.text = "";
                field.forceActiveFocus();
            }
        }
        Item { Layout.fillWidth: true }
        Controls.Button {
            text: KI18n.i18nc("@action:button", "Unlock")
            icon.name: "object-unlocked"
            enabled: root.canSubmit
            onClicked: root.submit()
        }
    }
}
