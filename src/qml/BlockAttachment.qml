// SPDX-FileCopyrightText: 2026 Marknote fork contributors
// SPDX-License-Identifier: GPL-2.0-only OR GPL-3.0-only OR LicenseRef-KDE-Accepted-GPL

import QtQuick
import QtQuick.Layouts
import QtQuick.Controls as QQC2

import org.kde.kirigami as Kirigami
import org.kde.marknote

/// A file attachment (docs/attachments.md): "[📎 Name](file)" on its own,
/// shown as a card with the file's icon, name and size, and buttons to open
/// it (and, when the notebook syncs to Google Drive, to see or download it
/// there). Click it to select it; Delete or Backspace removes it.
BlockTemplate {
    id: root

    isFinalBlock: true

    topMargin: Kirigami.Units.smallSpacing
    bottomMargin: Kirigami.Units.smallSpacing

    readonly property string attachmentMd: root.block.data.attachment ?? ""
    // Re-read after a sync (the Drive id) and when the card is shown again.
    property int refresh: 0
    readonly property var info: {
        void SyncManager.activityRevision;
        void root.refresh;
        return AttachmentHelper.info(NavigationController.noteFullPath, root.attachmentMd);
    }
    readonly property bool missing: !root.info.exists
    readonly property bool onDrive: (root.info.driveId ?? "").length > 0

    function select(): void {
        if (root.cppModel) {
            root.cppModel.clearFocus();
            root.cppModel.selectBlock(root.block);
        }
        root.forceActiveFocus();
    }

    function open(): void {
        if (!root.missing) {
            Qt.openUrlExternally(root.info.url);
        }
    }

    blockComponent: Item {
        implicitHeight: card.implicitHeight

        QQC2.Control {
            id: card

            width: Math.min(parent.width, Kirigami.Units.gridUnit * 34)
            padding: Kirigami.Units.largeSpacing
            leftPadding: Kirigami.Units.largeSpacing
            hoverEnabled: true

            Accessible.role: Accessible.Button
            Accessible.name: root.info.name ?? ""
            Accessible.description: metaLabel.text

            background: Rectangle {
                radius: Kirigami.Units.cornerRadius * 2
                color: root.isSelected ? "transparent"
                     : Qt.alpha(Kirigami.Theme.textColor, card.hovered && !root.missing ? 0.07 : 0.04)
                border.width: 1
                border.color: root.isSelected ? Kirigami.Theme.highlightColor : Qt.alpha(Kirigami.Theme.textColor, 0.15)
                Behavior on color { ColorAnimation { duration: Kirigami.Units.shortDuration } }

                TapHandler {
                    acceptedButtons: Qt.LeftButton
                    onTapped: root.select()
                    onDoubleTapped: root.open()
                }
            }

            contentItem: RowLayout {
                spacing: Kirigami.Units.largeSpacing

                Kirigami.Icon {
                    source: root.info.iconName ?? "unknown"
                    fallback: root.info.genericIconName ?? "unknown"
                    implicitWidth: Kirigami.Units.iconSizes.medium
                    implicitHeight: Kirigami.Units.iconSizes.medium
                    opacity: root.missing ? 0.4 : 1
                }

                ColumnLayout {
                    Layout.fillWidth: true
                    spacing: 0

                    QQC2.Label {
                        Layout.fillWidth: true
                        text: root.info.name ?? ""
                        font.weight: Font.DemiBold
                        elide: Text.ElideMiddle
                        opacity: root.missing ? 0.6 : 1
                    }

                    QQC2.Label {
                        id: metaLabel
                        Layout.fillWidth: true
                        text: {
                            if (root.missing) {
                                return i18nc("@info attachment card", "File not found");
                            }
                            const parts = [root.info.kind, root.info.sizeText];
                            if (root.onDrive) {
                                parts.push(i18nc("@info attachment card", "Google Drive"));
                            }
                            return parts.filter(p => p && p.length > 0).join(" · ");
                        }
                        color: root.missing ? Kirigami.Theme.negativeTextColor : Kirigami.Theme.disabledTextColor
                        font: Kirigami.Theme.smallFont
                        elide: Text.ElideRight
                    }
                }

                QQC2.ToolButton {
                    text: i18nc("@action:button open an attached file", "Open")
                    icon.name: "document-open"
                    display: card.width > Kirigami.Units.gridUnit * 24 ? QQC2.AbstractButton.TextBesideIcon : QQC2.AbstractButton.IconOnly
                    visible: !root.missing
                    onClicked: root.open()

                    QQC2.ToolTip.visible: hovered && display === QQC2.AbstractButton.IconOnly
                    QQC2.ToolTip.text: text
                    QQC2.ToolTip.delay: Kirigami.Units.toolTipDelay
                }

                QQC2.ToolButton {
                    text: i18nc("@action:button", "Show in Google Drive")
                    icon.name: "folder-gdrive"
                    display: QQC2.AbstractButton.IconOnly
                    visible: root.onDrive
                    onClicked: Qt.openUrlExternally(root.info.driveUrl)

                    QQC2.ToolTip.visible: hovered
                    QQC2.ToolTip.text: text
                    QQC2.ToolTip.delay: Kirigami.Units.toolTipDelay
                }

                QQC2.ToolButton {
                    text: i18nc("@action:button", "Download from Google Drive")
                    icon.name: "download"
                    display: QQC2.AbstractButton.IconOnly
                    visible: root.onDrive
                    onClicked: Qt.openUrlExternally(root.info.downloadUrl)

                    QQC2.ToolTip.visible: hovered
                    QQC2.ToolTip.text: text
                    QQC2.ToolTip.delay: Kirigami.Units.toolTipDelay
                }

                QQC2.ToolButton {
                    id: moreButton
                    icon.name: "overflow-menu"
                    text: i18nc("@action:button", "More")
                    display: QQC2.AbstractButton.IconOnly
                    onClicked: moreMenu.popup(moreButton, 0, moreButton.height)

                    QQC2.ToolTip.visible: hovered
                    QQC2.ToolTip.text: text
                    QQC2.ToolTip.delay: Kirigami.Units.toolTipDelay
                }
            }
        }

        QQC2.Menu {
            id: moreMenu

            onAboutToShow: root.refresh++

            QQC2.MenuItem {
                text: i18nc("@action:inmenu", "Open")
                icon.name: "document-open"
                enabled: !root.missing
                onTriggered: root.open()
            }
            QQC2.MenuItem {
                text: i18nc("@action:inmenu", "Show in Folder")
                icon.name: "folder-open"
                onTriggered: Qt.openUrlExternally(root.info.folderUrl)
            }
            QQC2.MenuSeparator {
                visible: root.info.syncsToGoogle ?? false
            }
            QQC2.MenuItem {
                text: i18nc("@action:inmenu", "Show in Google Drive")
                icon.name: "folder-gdrive"
                visible: root.info.syncsToGoogle ?? false
                height: visible ? implicitHeight : 0
                enabled: root.onDrive
                onTriggered: Qt.openUrlExternally(root.info.driveUrl)
            }
            QQC2.MenuItem {
                text: i18nc("@action:inmenu", "Download from Google Drive")
                icon.name: "download"
                visible: root.info.syncsToGoogle ?? false
                height: visible ? implicitHeight : 0
                enabled: root.onDrive
                onTriggered: Qt.openUrlExternally(root.info.downloadUrl)
            }
            QQC2.MenuItem {
                text: i18nc("@info:inmenu", "Not on Google Drive yet: sync this notebook first")
                visible: (root.info.syncsToGoogle ?? false) && !root.onDrive && !root.missing
                height: visible ? implicitHeight : 0
                enabled: false
            }
            QQC2.MenuSeparator {}
            QQC2.MenuItem {
                text: i18nc("@action:inmenu", "Remove from Note")
                icon.name: "edit-delete"
                onTriggered: CommandManager.removeBlocks([root.block])
            }
        }
    }

    Keys.onPressed: (event) => {
        if ((event.key === Qt.Key_Delete || event.key === Qt.Key_Backspace) && root.isSelected) {
            CommandManager.removeBlocks([root.block]);
            event.accepted = true;
        } else if ((event.key === Qt.Key_Return || event.key === Qt.Key_Enter) && root.isSelected) {
            root.open();
            event.accepted = true;
        }
    }
}
