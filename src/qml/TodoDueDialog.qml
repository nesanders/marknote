// SPDX-FileCopyrightText: 2026 Marknote fork contributors
// SPDX-License-Identifier: GPL-2.0-only OR GPL-3.0-only OR LicenseRef-KDE-Accepted-GPL

import QtQuick
import QtQuick.Controls as QQC2

import org.kde.kirigamiaddons.dateandtime as DateAndTime
import org.kde.marknote

/// Picks the due date of a to-do item: quick choices, or a calendar.
Item {
    id: root

    /// YYYY-MM-DD, or empty for "no due date".
    signal picked(string date)

    property string currentDue: ""

    function openAt(anchor: Item, due: string): void {
        root.currentDue = due;
        menu.popup(anchor, 0, anchor.height);
    }

    QQC2.Menu {
        id: menu

        QQC2.MenuItem {
            text: i18nc("@action:inmenu due date", "Today")
            icon.name: "go-jump-today"
            onTriggered: root.picked(TodoHelper.today())
        }
        QQC2.MenuItem {
            text: i18nc("@action:inmenu due date", "Tomorrow")
            icon.name: "go-next"
            onTriggered: root.picked(TodoHelper.addDays(TodoHelper.today(), 1))
        }
        QQC2.MenuItem {
            text: i18nc("@action:inmenu due date", "Next week")
            icon.name: "go-last"
            onTriggered: root.picked(TodoHelper.addDays(TodoHelper.today(), 7))
        }
        QQC2.MenuSeparator {}
        QQC2.MenuItem {
            text: i18nc("@action:inmenu due date", "Pick a Date…")
            icon.name: "view-calendar"
            onTriggered: {
                // A local date from "YYYY-MM-DD" (a UTC one can show the day before).
                const [y, m, d] = (root.currentDue.length > 0 ? root.currentDue : TodoHelper.today()).split("-").map(Number);
                const date = new Date(y, m - 1, d);
                datePopup.value = date;
                // The popup's picker no longer follows `value` once used: set it too.
                if (datePopup.contentItem && datePopup.contentItem.selectedDate !== undefined) {
                    datePopup.contentItem.selectedDate = date;
                }
                datePopup.open();
            }
        }
        QQC2.MenuItem {
            text: i18nc("@action:inmenu due date", "Clear")
            icon.name: "edit-clear"
            enabled: root.currentDue.length > 0
            onTriggered: root.picked("")
        }
    }

    DateAndTime.DatePopup {
        id: datePopup
        parent: QQC2.Overlay.overlay
        x: parent ? Math.round((parent.width - width) / 2) : 0
        y: parent ? Math.round((parent.height - height) / 2) : 0
        modal: true
        autoAccept: true

        onAccepted: {
            root.picked(Qt.formatDate(datePopup.value, "yyyy-MM-dd"));
            close();
        }
    }
}
