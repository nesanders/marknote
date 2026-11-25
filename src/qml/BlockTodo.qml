// SPDX-FileCopyrightText: 2026 Marknote fork contributors
// SPDX-License-Identifier: GPL-2.0-only OR GPL-3.0-only OR LicenseRef-KDE-Accepted-GPL

import QtQuick
import QtQuick.Layouts
import QtQuick.Controls as QQC2

import org.kde.kirigami as Kirigami
import org.kde.marknote

/// A to-do block (docs/todo.md): open items, a collapsible Done section and
/// an "Add item" field. Every change rewrites the block's markdown through
/// TodoHelper and is applied as one undoable edit.
BlockTemplate {
    id: root

    isFinalBlock: true

    topMargin: Kirigami.Units.mediumSpacing
    bottomMargin: Kirigami.Units.mediumSpacing

    readonly property string todoMd: root.block.data.todo ?? ""
    readonly property var todo: TodoHelper.parse(todoMd)
    property bool doneExpanded: false

    readonly property int fontSize: Math.max(4, Math.round(Config.editorFont.pointSize * Config.editorZoom / 100))

    function commit(markdown: string): void {
        if (markdown !== root.todoMd) {
            CommandManager.editTodo(root.block, markdown);
        }
    }

    TodoDueDialog {
        id: dueDialog
        property int line: -1
        onPicked: (date) => root.commit(TodoHelper.setDue(root.todoMd, line, date))
    }

    QQC2.Menu {
        id: sortMenu

        QQC2.MenuItem {
            text: i18nc("@action:inmenu to-do order", "Manual Order")
            checkable: true
            autoExclusive: true
            checked: root.todo.sort !== "due"
            onTriggered: root.commit(TodoHelper.setSort(root.todoMd, "manual"))
        }
        QQC2.MenuItem {
            text: i18nc("@action:inmenu to-do order", "By Due Date")
            checkable: true
            autoExclusive: true
            checked: root.todo.sort === "due"
            onTriggered: root.commit(TodoHelper.setSort(root.todoMd, "due"))
        }
    }

    component DueChip: QQC2.AbstractButton {
        id: chip

        required property string due
        property bool muted: false
        readonly property string state_: muted ? "" : TodoHelper.dueState(due)
        readonly property color tint: state_ === "overdue" ? Kirigami.Theme.negativeTextColor
                                    : state_ === "today" ? Kirigami.Theme.neutralTextColor
                                    : Kirigami.Theme.disabledTextColor

        leftPadding: Kirigami.Units.smallSpacing * 1.5
        rightPadding: Kirigami.Units.smallSpacing * 1.5
        topPadding: Kirigami.Units.smallSpacing / 2
        bottomPadding: Kirigami.Units.smallSpacing / 2
        hoverEnabled: true

        QQC2.ToolTip.visible: hovered && !muted
        QQC2.ToolTip.text: i18nc("@info:tooltip", "Due %1", due)
        QQC2.ToolTip.delay: Kirigami.Units.toolTipDelay

        contentItem: QQC2.Label {
            text: "📅 " + TodoHelper.dateLabel(chip.due)
            color: chip.state_ === "" ? Kirigami.Theme.textColor : chip.tint
            opacity: chip.muted ? 0.6 : 1
            font: Kirigami.Theme.smallFont
        }

        background: Rectangle {
            radius: height / 2
            color: Qt.alpha(chip.tint, chip.hovered && !chip.muted ? 0.25 : 0.12)
            border.width: chip.state_ === "" ? 0 : 1
            border.color: Qt.alpha(chip.tint, 0.4)
        }
    }

    blockComponent: Item {
        implicitHeight: content.implicitHeight

        ColumnLayout {
            id: content

            // Keep the checkboxes clear of the drag handle, like list items.
            anchors.left: parent.left
            anchors.right: parent.right
            anchors.leftMargin: Kirigami.Units.gridUnit + Kirigami.Units.smallSpacing
            spacing: 0

            // Header: what this is, and how the open items are ordered.
            RowLayout {
                Layout.fillWidth: true
                spacing: Kirigami.Units.smallSpacing

                Kirigami.Icon {
                    source: "checkbox"
                    implicitWidth: Kirigami.Units.iconSizes.small
                    implicitHeight: Kirigami.Units.iconSizes.small
                    opacity: 0.6
                }

                QQC2.Label {
                    text: i18nc("@title to-do block", "To-do")
                    font: Kirigami.Theme.smallFont
                    color: Kirigami.Theme.disabledTextColor
                }

                Item {
                    Layout.fillWidth: true
                }

                QQC2.ToolButton {
                    id: sortButton
                    text: root.todo.sort === "due" ? i18nc("@action:button to-do order", "By due date") : i18nc("@action:button to-do order", "Manual order")
                    icon.name: "view-sort"
                    font: Kirigami.Theme.smallFont
                    display: QQC2.AbstractButton.TextBesideIcon
                    flat: true
                    onClicked: sortMenu.popup(sortButton, 0, sortButton.height)

                    QQC2.ToolTip.visible: hovered
                    QQC2.ToolTip.text: i18nc("@info:tooltip", "Order of the open items")
                    QQC2.ToolTip.delay: Kirigami.Units.toolTipDelay
                }
            }

            // Open items. Each row has a grip to drag it to another place.
            Item {
                Layout.fillWidth: true
                implicitHeight: openList.implicitHeight

                ColumnLayout {
                    id: openList
                    anchors.left: parent.left
                    anchors.right: parent.right
                    spacing: 0

                    property int dragFrom: -1 // row being dragged
                    property int slot: -1 // gap it would land in: 0 = above the first row

                    function slotAt(y: real): int {
                        let n = 0;
                        for (let i = 0; i < openRepeater.count; ++i) {
                            const it = openRepeater.itemAt(i);
                            if (it && y > it.y + it.height / 2) {
                                n = i + 1;
                            }
                        }
                        return n;
                    }
                    function finishDrag(line: int): void {
                        const from = dragFrom;
                        const to = slot > from ? slot - 1 : slot;
                        dragFrom = -1;
                        slot = -1;
                        if (from >= 0 && to >= 0 && to !== from) {
                            root.commit(TodoHelper.moveItem(root.todoMd, line, to));
                        }
                    }

                    Repeater {
                        id: openRepeater
                        model: root.todo.open

                        delegate: ColumnLayout {
                            id: openRow

                            required property var modelData
                            required property int index

                            Layout.fillWidth: true
                            spacing: 0
                            opacity: openList.dragFrom === openRow.index ? 0.35 : 1

                            HoverHandler {
                                id: rowHover
                            }

                            RowLayout {
                                Layout.fillWidth: true
                                spacing: Kirigami.Units.smallSpacing

                                // Drag to reorder (the block switches to manual order).
                                Item {
                                    id: grip
                                    implicitWidth: Kirigami.Units.gridUnit
                                    Layout.fillHeight: true
                                    opacity: gripArea.containsMouse || gripArea.pressed ? 0.9 : (rowHover.hovered || itemField.activeFocus ? 0.35 : 0)
                                    Behavior on opacity { NumberAnimation { duration: Kirigami.Units.shortDuration } }

                                    Text {
                                        text: "\u205D\u205D"
                                        color: Kirigami.Theme.textColor
                                        anchors.centerIn: parent
                                    }

                                    MouseArea {
                                        id: gripArea
                                        anchors.fill: parent
                                        hoverEnabled: true
                                        preventStealing: true
                                        cursorShape: pressed ? Qt.ClosedHandCursor : Qt.OpenHandCursor
                                        onPressed: {
                                            openList.dragFrom = openRow.index;
                                            openList.slot = openRow.index;
                                        }
                                        onPositionChanged: (mouse) => {
                                            if (pressed) {
                                                openList.slot = openList.slotAt(mapToItem(openList, mouse.x, mouse.y).y);
                                            }
                                        }
                                        onReleased: openList.finishDrag(openRow.modelData.line)
                                        onCanceled: openList.dragFrom = -1

                                        QQC2.ToolTip.visible: containsMouse && !pressed
                                        QQC2.ToolTip.text: i18nc("@info:tooltip", "Drag to reorder")
                                        QQC2.ToolTip.delay: Kirigami.Units.toolTipDelay
                                    }
                                }

                                QQC2.CheckBox {
                                    id: openCheck
                                    checked: false
                                    onClicked: root.commit(TodoHelper.toggle(root.todoMd, openRow.modelData.line))

                                    QQC2.ToolTip.visible: hovered
                                    QQC2.ToolTip.text: i18nc("@info:tooltip", "Mark as done")
                                    QQC2.ToolTip.delay: Kirigami.Units.toolTipDelay
                                }

                                QQC2.TextField {
                                    id: itemField

                                    Layout.fillWidth: true
                                    text: openRow.modelData.text
                                    placeholderText: i18nc("@info:placeholder", "To-do")
                                    background: null
                                    leftPadding: 0
                                    font.pointSize: root.fontSize
                                    font.family: Config.editorFont.family

                                    onEditingFinished: {
                                        if (text !== openRow.modelData.text) {
                                            root.commit(TodoHelper.setText(root.todoMd, openRow.modelData.line, text));
                                        }
                                    }
                                    Keys.onPressed: (event) => {
                                        if (event.key === Qt.Key_Backspace && text.length === 0) {
                                            root.commit(TodoHelper.removeItem(root.todoMd, openRow.modelData.line));
                                            event.accepted = true;
                                        }
                                    }
                                }

                                DueChip {
                                    id: dueChip
                                    visible: openRow.modelData.due.length > 0
                                    due: openRow.modelData.due
                                    onClicked: {
                                        dueDialog.line = openRow.modelData.line;
                                        dueDialog.openAt(dueChip, openRow.modelData.due);
                                    }
                                }

                                QQC2.ToolButton {
                                    id: addDueButton
                                    visible: openRow.modelData.due.length === 0
                                    icon.name: "view-calendar"
                                    display: QQC2.AbstractButton.IconOnly
                                    text: i18nc("@action:button", "Set due date")
                                    flat: true
                                    opacity: hovered || itemField.activeFocus ? 0.8 : 0.25
                                    implicitWidth: Kirigami.Units.iconSizes.small + Kirigami.Units.smallSpacing * 2
                                    implicitHeight: implicitWidth
                                    onClicked: {
                                        dueDialog.line = openRow.modelData.line;
                                        dueDialog.openAt(addDueButton, "");
                                    }

                                    QQC2.ToolTip.visible: hovered
                                    QQC2.ToolTip.text: text
                                    QQC2.ToolTip.delay: Kirigami.Units.toolTipDelay
                                }
                            }

                            // Indented lines under the item (notes, sub-items), shown as written.
                            QQC2.Label {
                                visible: openRow.modelData.notes.length > 0
                                Layout.fillWidth: true
                                Layout.leftMargin: grip.width + openCheck.width + Kirigami.Units.smallSpacing * 2
                                Layout.bottomMargin: Kirigami.Units.smallSpacing
                                text: openRow.modelData.notes.split("\n").map(l => l.trim()).join("\n")
                                wrapMode: Text.Wrap
                                font: Kirigami.Theme.smallFont
                                color: Kirigami.Theme.disabledTextColor
                            }
                        }
                    }
                }

                // Where the dragged row would land.
                Rectangle {
                    visible: openList.dragFrom >= 0 && openList.slot >= 0 && openList.slot !== openList.dragFrom && openList.slot !== openList.dragFrom + 1
                    x: Kirigami.Units.gridUnit
                    width: parent.width - x
                    height: 2
                    radius: 1
                    color: Kirigami.Theme.highlightColor
                    y: {
                        if (openList.slot < 0 || openRepeater.count === 0) {
                            return 0;
                        }
                        const it = openRepeater.itemAt(Math.min(openList.slot, openRepeater.count - 1));
                        return (openList.slot < openRepeater.count ? it.y : it.y + it.height) - 1;
                    }
                }
            }

            // Add item.
            RowLayout {
                Layout.fillWidth: true
                Layout.leftMargin: Kirigami.Units.gridUnit + Kirigami.Units.smallSpacing // under the checkboxes, past the grips
                spacing: Kirigami.Units.smallSpacing

                Kirigami.Icon {
                    source: "list-add"
                    Layout.leftMargin: Kirigami.Units.smallSpacing
                    Layout.rightMargin: Kirigami.Units.smallSpacing
                    implicitWidth: Kirigami.Units.iconSizes.small
                    implicitHeight: Kirigami.Units.iconSizes.small
                    opacity: 0.4
                }

                QQC2.TextField {
                    id: addField
                    Layout.fillWidth: true
                    placeholderText: i18nc("@info:placeholder", "Add item")
                    background: null
                    leftPadding: 0
                    font.pointSize: root.fontSize
                    font.family: Config.editorFont.family

                    onAccepted: {
                        if (text.trim().length > 0) {
                            root.commit(TodoHelper.addItem(root.todoMd, text));
                            text = "";
                        }
                    }
                }
            }

            // Done section, collapsed by default.
            QQC2.AbstractButton {
                id: doneHeader
                visible: root.todo.done.length > 0
                Layout.leftMargin: Kirigami.Units.gridUnit + Kirigami.Units.smallSpacing
                Layout.topMargin: Kirigami.Units.smallSpacing
                hoverEnabled: true
                onClicked: root.doneExpanded = !root.doneExpanded

                contentItem: RowLayout {
                    spacing: Kirigami.Units.smallSpacing
                    Kirigami.Icon {
                        source: root.doneExpanded ? "arrow-down" : "arrow-right"
                        implicitWidth: Kirigami.Units.iconSizes.small
                        implicitHeight: Kirigami.Units.iconSizes.small
                        opacity: 0.7
                    }
                    QQC2.Label {
                        text: i18nc("@action:button number of done items", "Done (%1)", root.todo.done.length)
                        color: doneHeader.hovered ? Kirigami.Theme.textColor : Kirigami.Theme.disabledTextColor
                        font.pointSize: root.fontSize * 0.9
                    }
                }
            }

            Repeater {
                model: root.doneExpanded ? root.todo.done : []

                delegate: RowLayout {
                    id: doneRow

                    required property var modelData

                    Layout.fillWidth: true
                    Layout.leftMargin: Kirigami.Units.gridUnit + Kirigami.Units.smallSpacing
                    spacing: Kirigami.Units.smallSpacing

                    QQC2.CheckBox {
                        checked: true
                        onClicked: root.commit(TodoHelper.toggle(root.todoMd, doneRow.modelData.line))

                        QQC2.ToolTip.visible: hovered
                        QQC2.ToolTip.text: i18nc("@info:tooltip", "Mark as not done")
                        QQC2.ToolTip.delay: Kirigami.Units.toolTipDelay
                    }

                    QQC2.Label {
                        Layout.fillWidth: true
                        text: doneRow.modelData.text
                        elide: Text.ElideRight
                        font.strikeout: true
                        font.pointSize: root.fontSize
                        font.family: Config.editorFont.family
                        color: Kirigami.Theme.disabledTextColor
                    }

                    DueChip {
                        visible: doneRow.modelData.due.length > 0
                        due: doneRow.modelData.due
                        muted: true
                        enabled: false
                    }

                    QQC2.Label {
                        text: "✓ " + TodoHelper.dateLabel(doneRow.modelData.done)
                        font: Kirigami.Theme.smallFont
                        color: Kirigami.Theme.disabledTextColor
                    }
                }
            }
        }
    }
}
