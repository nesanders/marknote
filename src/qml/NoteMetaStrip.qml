// SPDX-FileCopyrightText: 2026 Marknote fork contributors
// SPDX-License-Identifier: GPL-2.0-only OR GPL-3.0-only OR LicenseRef-KDE-Accepted-GPL

import QtQuick
import QtQuick.Controls as Controls
import QtQuick.Layouts
import QtQuick.Window
import org.kde.kirigami as Kirigami
import org.kde.ki18n
import org.kde.marknote
import org.kde.marknote.settings

/**
 * Strip above the editor: the note's icon, created date and tags, each editable.
 */
Item {
    id: root

    required property url noteUrl

    readonly property var meta: {
        NoteMetadata.revision; // re-read when any metadata changes
        return root.noteUrl.toString().length > 0 ? NoteMetadata.read(root.noteUrl) : ({});
    }
    readonly property var tagList: meta.tags ? Array.from(meta.tags) : []
    readonly property string icon: meta.icon ?? ""
    readonly property var window: Window.window

    implicitHeight: row.implicitHeight + Kirigami.Units.smallSpacing * 2 + separator.height

    // Its own opaque band with a divider, so it reads as separate from the note.
    Rectangle {
        anchors.fill: parent
        Kirigami.Theme.colorSet: Kirigami.Theme.View
        Kirigami.Theme.inherit: false
        color: Kirigami.Theme.backgroundColor
    }
    Kirigami.Separator {
        id: separator
        anchors.left: parent.left
        anchors.right: parent.right
        anchors.bottom: parent.bottom
    }

    RowLayout {
        id: row
        anchors.verticalCenter: parent.verticalCenter
        anchors.horizontalCenter: parent.horizontalCenter
        width: Math.min(parent.width - Kirigami.Units.largeSpacing * 4,
                        Config.fullWidth ? parent.width : Kirigami.Units.gridUnit * Config.textWidth)
        spacing: Kirigami.Units.smallSpacing

        Controls.ToolButton {
            id: iconButton
            text: root.icon.length > 0 ? KI18n.i18nc("@action:button", "Change Icon") : KI18n.i18nc("@action:button", "Add Icon")
            display: root.icon.length > 0 ? Controls.AbstractButton.IconOnly : Controls.AbstractButton.TextBesideIcon
            icon.name: root.icon.length > 0 && !NoteMetadata.isEmoji(root.icon) ? root.icon : (root.icon.length > 0 ? "" : "preferences-desktop-emoticons")
            onClicked: root.window.openIconPicker(root.noteUrl, false, NavigationController.noteName)
            Controls.ToolTip.text: text
            Controls.ToolTip.visible: hovered && display === Controls.AbstractButton.IconOnly
            Controls.ToolTip.delay: Kirigami.Units.toolTipDelay

            Controls.Label {
                anchors.centerIn: parent
                visible: NoteMetadata.isEmoji(root.icon)
                text: root.icon
                font.pixelSize: Kirigami.Units.iconSizes.smallMedium
            }
        }

        Kirigami.Icon {
            source: "view-calendar"
            Layout.preferredWidth: Kirigami.Units.iconSizes.small
            Layout.preferredHeight: Kirigami.Units.iconSizes.small
            color: Kirigami.Theme.disabledTextColor
            isMask: true
        }
        Controls.Label {
            text: root.meta.createdText ? KI18n.i18nc("@info note creation time", "Created %1", root.meta.createdText) : ""
            color: Kirigami.Theme.disabledTextColor
            font.pointSize: Kirigami.Theme.smallFont.pointSize
        }

        Controls.Label {
            text: "·"
            color: Kirigami.Theme.disabledTextColor
            visible: root.tagList.length > 0
        }

        Flow {
            Layout.fillWidth: true
            spacing: Kirigami.Units.smallSpacing

            Repeater {
                model: root.tagList
                delegate: TagChip {
                    required property string modelData
                    tag: modelData
                    selected: FilterState.tags.indexOf(modelData) !== -1
                    onClicked: FilterState.toggleTag(modelData)
                    Controls.ToolTip.visible: hovered
                    Controls.ToolTip.text: KI18n.i18nc("@info:tooltip", "Show notes tagged “%1”", modelData)
                    Controls.ToolTip.delay: Kirigami.Units.toolTipDelay
                }
            }

            Controls.ToolButton {
                height: Math.round(Kirigami.Units.gridUnit * 1.2)
                text: KI18n.i18nc("@action:button", "Add Tag")
                icon.name: "tag-new"
                font.pointSize: Kirigami.Theme.smallFont.pointSize
                onClicked: root.window.openTagEditor(root.noteUrl, NavigationController.noteName)
            }
        }
    }
}
