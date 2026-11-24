// SPDX-FileCopyrightText: 2026 Marknote fork contributors
// SPDX-License-Identifier: GPL-2.0-only OR GPL-3.0-only OR LicenseRef-KDE-Accepted-GPL

import QtQuick
import QtQuick.Controls as Controls
import QtQuick.Layouts
import org.kde.kirigami as Kirigami
import org.kde.ki18n
import org.kde.marknote

/**
 * A small coloured tag pill. The hue is derived from the tag name so a tag
 * looks the same everywhere; it is blended into the theme background so it
 * stays readable in light and dark colour schemes.
 */
Controls.AbstractButton {
    id: root

    required property string tag
    property bool removable: false
    property bool selected: false

    signal removeRequested()

    /// Smaller pill for dense list rows.
    property bool small: false

    readonly property color hue: FilterState.tagHue(tag)

    hoverEnabled: true
    focusPolicy: Qt.NoFocus
    implicitHeight: Math.round(Kirigami.Units.gridUnit * (small ? 0.85 : 1.1))
    implicitWidth: row.implicitWidth + Kirigami.Units.smallSpacing * (small ? 2 : 3)
    text: tag

    Accessible.name: removable ? KI18n.i18nc("@action:button", "Remove tag %1", tag) : tag

    background: Rectangle {
        radius: height / 2
        color: Kirigami.ColorUtils.tintWithAlpha(Kirigami.Theme.backgroundColor, root.hue, root.hovered || root.selected ? 0.34 : 0.2)
        border.width: root.selected ? 1 : 0
        border.color: root.hue
    }

    contentItem: Item {
        RowLayout {
            id: row
            anchors.centerIn: parent
            spacing: Kirigami.Units.smallSpacing / 2

            Controls.Label {
                text: root.tag
                font.pointSize: Kirigami.Theme.smallFont.pointSize * (root.small ? 0.92 : 1)
                color: Kirigami.Theme.textColor
            }
            Kirigami.Icon {
                visible: root.removable
                source: "edit-delete-remove"
                Layout.preferredWidth: Kirigami.Units.iconSizes.small * 0.75
                Layout.preferredHeight: Kirigami.Units.iconSizes.small * 0.75
            }
        }
    }

    onClicked: if (removable) removeRequested()
}
