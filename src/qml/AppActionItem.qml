// SPDX-FileCopyrightText: 2026 Marknote fork contributors
// SPDX-License-Identifier: GPL-2.0-only OR GPL-3.0-only OR LicenseRef-KDE-Accepted-GPL

import QtQuick
import QtQuick.Controls as Controls
import QtQuick.Layouts
import org.kde.kirigami as Kirigami
import org.kde.marknote

/**
 * Menu item that triggers one of the application's QActions (KActionCollection).
 *
 * It triggers the QAction directly instead of wrapping it in a second
 * Kirigami.Action, which would register its shortcut a second time and make
 * it ambiguous. The shortcut is only displayed here.
 */
Controls.MenuItem {
    id: root

    required property string actionName
    property string iconName: ""
    property string shortcutText: ""

    readonly property var qaction: App.action(actionName)

    text: qaction ? qaction.text.replace("&", "") : actionName
    enabled: qaction ? qaction.enabled : false

    contentItem: RowLayout {
        spacing: Kirigami.Units.smallSpacing

        Kirigami.Icon {
            source: root.iconName
            visible: root.iconName.length > 0
            Layout.preferredWidth: Kirigami.Units.iconSizes.small
            Layout.preferredHeight: Kirigami.Units.iconSizes.small
        }
        Controls.Label {
            text: root.text
            elide: Text.ElideRight
            color: root.highlighted ? Kirigami.Theme.highlightedTextColor : Kirigami.Theme.textColor
            opacity: root.enabled ? 1 : 0.5
            Layout.fillWidth: true
        }
        Controls.Label {
            text: root.shortcutText
            visible: text.length > 0
            color: root.highlighted ? Kirigami.Theme.highlightedTextColor : Kirigami.Theme.disabledTextColor
            Layout.leftMargin: Kirigami.Units.largeSpacing
        }
    }

    onTriggered: if (qaction) qaction.trigger()
}
