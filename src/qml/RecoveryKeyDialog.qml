// SPDX-FileCopyrightText: 2026 Marknote fork contributors
// SPDX-License-Identifier: GPL-2.0-only OR GPL-3.0-only OR LicenseRef-KDE-Accepted-GPL

import QtQuick
import QtQuick.Controls as Controls
import QtQuick.Layouts
import org.kde.kirigami as Kirigami
import org.kde.ki18n

/**
 * The recovery key of a newly encrypted notebook, shown once. It can only be
 * closed after the user confirms the key is stored.
 */
Kirigami.Dialog {
    id: root

    required property string recoveryKey

    title: KI18n.i18nc("@title:window", "Save Your Recovery Key")
    preferredWidth: Kirigami.Units.gridUnit * 30
    padding: Kirigami.Units.largeSpacing
    standardButtons: Kirigami.Dialog.NoButton
    showCloseButton: false
    closePolicy: Controls.Popup.NoAutoClose
    onClosed: destroy()

    customFooterActions: [
        Kirigami.Action {
            text: KI18n.i18nc("@action:button", "Done")
            icon.name: "dialog-ok"
            enabled: storedCheck.checked
            onTriggered: root.close()
        }
    ]

    ColumnLayout {
        Layout.fillWidth: true
        spacing: Kirigami.Units.largeSpacing

        Controls.Label {
            Layout.fillWidth: true
            Layout.preferredWidth: Kirigami.Units.gridUnit * 27
            wrapMode: Text.Wrap
            text: KI18n.i18nc("@info", "The notebook is encrypted. If you forget the password, this recovery key is the only way back into it. <b>Store it in your password manager now.</b> Marknote will not show it again.")
        }

        Controls.TextArea {
            id: keyText
            Layout.fillWidth: true
            readOnly: true
            wrapMode: TextEdit.Wrap
            text: root.recoveryKey
            font.family: "monospace"
            font.pointSize: Kirigami.Theme.defaultFont.pointSize * 1.1
            horizontalAlignment: TextEdit.AlignHCenter
            Accessible.name: KI18n.i18nc("@info", "Recovery key")
        }

        RowLayout {
            Controls.Button {
                text: KI18n.i18nc("@action:button", "Copy Recovery Key")
                icon.name: "edit-copy"
                onClicked: {
                    keyText.selectAll();
                    keyText.copy();
                    keyText.deselect();
                    copiedLabel.visible = true;
                }
            }
            Controls.Label {
                id: copiedLabel
                visible: false
                text: KI18n.i18nc("@info", "Copied. Paste it into your password manager.")
                color: Kirigami.Theme.disabledTextColor
            }
        }

        Controls.CheckBox {
            id: storedCheck
            text: KI18n.i18nc("@option:check", "I have stored the recovery key in my password manager")
        }
    }
}
