// SPDX-FileCopyrightText: 2026 Marknote fork contributors
// SPDX-License-Identifier: GPL-2.0-only OR GPL-3.0-only OR LicenseRef-KDE-Accepted-GPL

import QtQuick
import QtQuick.Controls as Controls
import QtQuick.Layouts
import org.kde.kirigami as Kirigami
import org.kde.ki18n
import org.kde.marknote

/**
 * Encrypt a notebook: say what is and is not protected, choose a password,
 * then show the recovery key once.
 */
Kirigami.Dialog {
    id: root

    required property string notebookPath
    property string notebookName: ""
    property bool busy: false
    property string error: ""

    readonly property int minLength: 8
    readonly property bool passwordOk: password.text.length >= minLength && password.text === confirm.text
    readonly property string strength: {
        const p = password.text;
        if (p.length === 0) {
            return "";
        }
        if (p.length < minLength) {
            return KI18n.i18nc("@info password strength", "Too short: at least %1 characters", minLength);
        }
        let kinds = 0;
        for (const re of [/[a-z]/, /[A-Z]/, /[0-9]/, /[^A-Za-z0-9]/]) {
            kinds += re.test(p) ? 1 : 0;
        }
        if (p.length >= 16 || (p.length >= 12 && kinds >= 3)) {
            return KI18n.i18nc("@info password strength", "Strong");
        }
        return p.length >= 10 && kinds >= 2 ? KI18n.i18nc("@info password strength", "Fair: longer is better") : KI18n.i18nc("@info password strength", "Weak: use a longer passphrase");
    }

    title: KI18n.i18nc("@title:window %1 is a notebook name", "Encrypt “%1”", notebookName)
    preferredWidth: Kirigami.Units.gridUnit * 30
    padding: Kirigami.Units.largeSpacing
    standardButtons: Kirigami.Dialog.NoButton
    closePolicy: Controls.Popup.CloseOnEscape | Controls.Popup.CloseOnPressOutside

    onOpened: password.forceActiveFocus()
    // Kept alive while the recovery key dialog it opened is shown (that
    // dialog lives in this one's QML context).
    property bool keepAlive: false
    onClosed: if (!keepAlive) destroy()

    customFooterActions: [cancelAction, encryptAction]

    readonly property Kirigami.Action cancelAction: Kirigami.Action {
        text: KI18n.i18nc("@action:button", "Cancel")
        icon.name: "dialog-cancel"
        enabled: !root.busy
        onTriggered: root.close()
    }

    readonly property Kirigami.Action encryptAction: Kirigami.Action {
        text: root.busy ? KI18n.i18nc("@action:button", "Encrypting…") : KI18n.i18nc("@action:button", "Encrypt Notebook")
        icon.name: "object-locked"
        enabled: root.passwordOk && !root.busy
        onTriggered: {
            root.busy = true;
            root.error = "";
            // Let the dialog show "Encrypting…" before the (short) blocking work.
            Qt.callLater(() => {
                const key = Vaults.encryptNotebook(root.notebookPath, password.text);
                root.busy = false;
                if (key.length > 0) {
                    password.text = "";
                    confirm.text = "";
                    // The key gets its own dialog (Kirigami does not rebuild a
                    // dialog's footer when its buttons change).
                    const component = Qt.createComponent("org.kde.marknote", "RecoveryKeyDialog");
                    const keyDialog = component.createObject(root.parent, { recoveryKey: key });
                    root.keepAlive = true;
                    keyDialog.closed.connect(() => root.destroy());
                    root.close();
                    keyDialog.open();
                } else {
                    root.error = Vaults.lastError;
                }
            });
        }
    }


    ColumnLayout {
        spacing: Kirigami.Units.largeSpacing

        ColumnLayout {
            Layout.fillWidth: true
            spacing: Kirigami.Units.largeSpacing

            Kirigami.InlineMessage {
                Layout.fillWidth: true
                Layout.preferredWidth: Kirigami.Units.gridUnit * 27
                visible: true
                type: Kirigami.MessageType.Information
                text: KI18n.i18nc("@info", "<b>Encrypted:</b> the text of every note, its tags, icon and created date.<br><b>Still visible to anyone with the files:</b> note titles (file names), folder names and images.")
            }

            Kirigami.FormLayout {
                Layout.fillWidth: true
                Kirigami.PasswordField {
                    id: password
                    Kirigami.FormData.label: KI18n.i18nc("@label:textbox", "Password:")
                    Layout.fillWidth: true
                    enabled: !root.busy
                    KeyNavigation.tab: confirm
                    onAccepted: confirm.forceActiveFocus()
                }
                Controls.Label {
                    visible: root.strength.length > 0
                    text: root.strength
                    color: password.text.length < root.minLength ? Kirigami.Theme.negativeTextColor : Kirigami.Theme.disabledTextColor
                    font: Kirigami.Theme.smallFont
                }
                Kirigami.PasswordField {
                    id: confirm
                    Kirigami.FormData.label: KI18n.i18nc("@label:textbox", "Repeat password:")
                    Layout.fillWidth: true
                    enabled: !root.busy
                    onAccepted: if (root.passwordOk) root.encryptAction.trigger()
                }
                Controls.Label {
                    visible: confirm.text.length > 0 && confirm.text !== password.text
                    text: KI18n.i18nc("@info", "The passwords are different.")
                    color: Kirigami.Theme.negativeTextColor
                    font: Kirigami.Theme.smallFont
                }
            }

            Controls.Label {
                Layout.fillWidth: true
                Layout.preferredWidth: Kirigami.Units.gridUnit * 27
                wrapMode: Text.Wrap
                color: Kirigami.Theme.disabledTextColor
                text: KI18n.i18nc("@info", "Every device that syncs this notebook will ask for this password. Without it, or the recovery key shown next, nobody (not even you) can read the notes again.")
            }

            Kirigami.InlineMessage {
                Layout.fillWidth: true
                visible: root.error.length > 0
                type: Kirigami.MessageType.Error
                text: root.error
            }
        }
    }
}
