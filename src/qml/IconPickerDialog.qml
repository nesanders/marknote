// SPDX-FileCopyrightText: 2026 Marknote fork contributors
// SPDX-License-Identifier: GPL-2.0-only OR GPL-3.0-only OR LicenseRef-KDE-Accepted-GPL

import QtQuick
import QtQuick.Controls as Controls
import QtQuick.Layouts
import org.kde.kirigami as Kirigami
import org.kde.iconthemes as IconThemes
import org.kde.ki18n
import org.kde.marknote

/**
 * Pick an emoji or a theme icon for a note or folder.
 * Notes store it in front matter ("icon"), folders in ".directory".
 */
Kirigami.Dialog {
    id: root

    required property url targetUrl
    required property bool isFolder
    property string targetName: ""

    readonly property string current: isFolder ? NoteMetadata.folderIcon(targetUrl) : (NoteMetadata.read(targetUrl).icon ?? "")

    title: targetName.length > 0
        ? KI18n.i18nc("@title:window %1 is a note or folder name", "Icon for “%1”", targetName)
        : KI18n.i18nc("@title:window", "Set Icon")
    padding: 0
    preferredWidth: Kirigami.Units.gridUnit * 24
    preferredHeight: Kirigami.Units.gridUnit * 26
    standardButtons: Kirigami.Dialog.Cancel

    customFooterActions: [
        Kirigami.Action {
            text: KI18n.i18nc("@action:button", "Remove Icon")
            icon.name: "edit-clear"
            enabled: root.current.length > 0
            onTriggered: root.apply("")
        }
    ]

    onClosed: destroy()

    function apply(value: string): void {
        const ok = root.isFolder ? NoteMetadata.setFolderIcon(root.targetUrl, value)
                                 : NoteMetadata.setIcon(root.targetUrl, value);
        if (!ok) {
            applicationWindow().showPassiveNotification(KI18n.i18nc("@info:status", "Could not save the icon."));
        }
        root.close();
    }

    function renderEmoji(code: string): string {
        if (!code) {
            return "";
        }
        return String.fromCodePoint.apply(null, code.split("-").map(c => parseInt(c, 16)));
    }

    readonly property var commonEmoji: ["📝", "📁", "📚", "🎨", "🛠️", "💡", "📌", "✅", "🗓️", "🔖", "🧪", "🧭", "📦", "🧩", "📊", "💬", "⭐", "🔥", "🚀", "🌱", "🎯", "🔒", "🧠", "🏠"]
    readonly property var commonIcons: ["folder", "folder-blue", "folder-green", "folder-orange", "folder-red", "folder-violet",
        "folder-documents", "folder-important", "bookmarks", "view-calendar", "flag", "tag", "favorite", "help-hint",
        "code-context", "applications-science", "office-chart-bar", "mail-message", "user-home", "lock", "games-highscores",
        "media-playback-start", "camera-photo", "globe"]

    contentItem: ColumnLayout {
        spacing: 0
        implicitWidth: Kirigami.Units.gridUnit * 22
        implicitHeight: Kirigami.Units.gridUnit * 22

        Controls.TabBar {
            id: tabs
            Layout.fillWidth: true
            currentIndex: root.current.length > 0 && !NoteMetadata.isEmoji(root.current) ? 1 : 0
            Controls.TabButton { text: KI18n.i18nc("@title:tab", "Emoji") }
            Controls.TabButton { text: KI18n.i18nc("@title:tab", "Icons") }
        }

        StackLayout {
            currentIndex: tabs.currentIndex
            Layout.fillWidth: true
            Layout.fillHeight: true

            // Emoji
            ColumnLayout {
                spacing: Kirigami.Units.smallSpacing

                Kirigami.SearchField {
                    id: emojiSearch
                    Layout.fillWidth: true
                    Layout.margins: Kirigami.Units.smallSpacing
                    placeholderText: KI18n.i18nc("@info:placeholder", "Search emoji…")
                    onTextChanged: emojiModel.searchText = text
                }

                Controls.Label {
                    visible: emojiSearch.text.length === 0
                    Layout.leftMargin: Kirigami.Units.smallSpacing
                    text: KI18n.i18nc("@info", "Common emoji — search to see all")
                    color: Kirigami.Theme.disabledTextColor
                    font.pointSize: Kirigami.Theme.smallFont.pointSize
                }

                Controls.ScrollView {
                    Layout.fillWidth: true
                    Layout.fillHeight: true

                    GridView {
                        id: emojiGrid
                        cellWidth: Kirigami.Units.gridUnit * 2.2
                        cellHeight: cellWidth
                        clip: true
                        model: emojiSearch.text.length > 0 ? emojiModel : root.commonEmoji

                        delegate: Controls.ToolButton {
                            required property var modelData
                            required property int index
                            readonly property string glyph: typeof modelData === "string" ? modelData : root.renderEmoji(modelData.emojicode)

                            width: emojiGrid.cellWidth
                            height: emojiGrid.cellHeight
                            checked: glyph === root.current
                            contentItem: Controls.Label {
                                text: parent.glyph
                                font.pixelSize: Kirigami.Units.gridUnit * 1.2
                                horizontalAlignment: Text.AlignHCenter
                                verticalAlignment: Text.AlignVCenter
                            }
                            Accessible.name: typeof modelData === "string" ? modelData : modelData.shortcode
                            onClicked: root.apply(glyph)
                        }
                    }
                }

                EmojierProxyModel {
                    id: emojiModel
                }
            }

            // Icons
            ColumnLayout {
                spacing: Kirigami.Units.smallSpacing

                Controls.ScrollView {
                    Layout.fillWidth: true
                    Layout.fillHeight: true

                    GridView {
                        id: iconGrid
                        cellWidth: Kirigami.Units.gridUnit * 2.6
                        cellHeight: cellWidth
                        clip: true
                        model: root.commonIcons
                        delegate: Controls.ToolButton {
                            required property string modelData
                            width: iconGrid.cellWidth
                            height: iconGrid.cellHeight
                            icon.name: modelData
                            icon.width: Kirigami.Units.iconSizes.medium
                            icon.height: Kirigami.Units.iconSizes.medium
                            display: Controls.AbstractButton.IconOnly
                            checked: modelData === root.current
                            text: modelData
                            Controls.ToolTip.text: modelData
                            Controls.ToolTip.visible: hovered
                            Controls.ToolTip.delay: Kirigami.Units.toolTipDelay
                            onClicked: root.apply(modelData)
                        }
                    }
                }

                Controls.Button {
                    Layout.alignment: Qt.AlignHCenter
                    Layout.margins: Kirigami.Units.smallSpacing
                    text: KI18n.i18nc("@action:button", "Browse All Icons…")
                    icon.name: "search"
                    visible: !Kirigami.Settings.isMobile
                    onClicked: iconDialog.open()
                }

                IconThemes.IconDialog {
                    id: iconDialog
                    onIconNameChanged: (iconName) => {
                        if (iconName.length > 0) {
                            root.apply(iconName);
                        }
                    }
                }
            }
        }
    }
}
