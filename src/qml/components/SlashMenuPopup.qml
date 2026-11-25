// SPDX-FileCopyrightText: 2026 Prayag Jain <prayagjain2@gmail.com>
// SPDX-License-Identifier: LGPL-3.0-or-later

import QtQuick
import QtQuick.Controls
import QtQuick.Layouts
import org.kde.kirigami as Kirigami
import org.kde.kirigamiaddons.delegates

Popup {
    id: root

    property string filterText: ""
    property int slashPosition: -1
    property alias visibleItemsCount: listView.count

    signal elementSelected(var item)

    readonly property var allItems: [
        { group: i18n("Text"), md: "#", name: i18n("Heading 1"), type: "heading1", iconText: "H1", description: i18n("Large section heading") },
        { group: i18n("Text"), md: "##", name: i18n("Heading 2"), type: "heading2", iconText: "H2", description: i18n("Medium section heading") },
        { group: i18n("Text"), md: "###", name: i18n("Heading 3"), type: "heading3", iconText: "H3", description: i18n("Small section heading") },
        { group: i18n("Text"), md: "####", name: i18n("Heading 4"), type: "heading4", iconText: "H4", description: i18n("Sub-heading 4") },
        { group: i18n("Text"), md: "#####", name: i18n("Heading 5"), type: "heading5", iconText: "H5", description: i18n("Sub-heading 5") },
        { group: i18n("Text"), md: "######", name: i18n("Heading 6"), type: "heading6", iconText: "H6", description: i18n("Sub-heading 6") },
        { group: i18n("Text"), md: "", name: i18n("Paragraph"), type: "paragraph", iconText: "¶", description: i18n("Plain text paragraph") },
        { group: i18n("Lists"), md: "-", name: i18n("Bullet List"), type: "unordered_list", icon: "format-list-unordered", description: i18n("Unordered bulleted list") },
        { group: i18n("Lists"), md: "1.", name: i18n("Numbered List"), type: "ordered_list", icon: "format-list-ordered", description: i18n("Numbered sequential list") },
        { group: i18n("Lists"), md: "- [ ]", name: i18n("Checklist"), type: "task_list", icon: "view-list-details", description: i18n("Task list with checkboxes") },
        { group: i18n("Lists"), md: "todo", name: i18n("To-do list"), type: "todo", icon: "checkbox", description: i18n("Checklist with due dates and a Done section") },
        { group: i18n("Blocks"), md: ">", name: i18n("Quote"), type: "blockquote", icon: "format-text-blockquote", description: i18n("Quote or callout block") },
        { group: i18n("Blocks"), md: "```", name: i18n("Code Block"), type: "code", icon: "code-context", description: i18n("Code snippet with syntax") },
        { group: i18n("Blocks"), md: "```mermaid", name: i18n("Mermaid Diagram"), type: "mermaid", icon: "view-preview", description: i18n("Flowchart, sequence, or architecture diagram") },
        { group: i18n("Blocks"), md: "---", name: i18n("Divider"), type: "divider", icon: "insert-horizontal-rule", description: i18n("Horizontal dividing line") },
        { group: i18n("Blocks"), md: "|", name: i18n("Table"), type: "table", icon: "insert-table", description: i18n("Tabular data grid") },
        { group: "", md: "Esc", name: i18n("Close menu"), type: "close", icon: "dialog-close", description: i18n("Dismiss this menu") }
    ]

    /// Whether the item at @p index starts a new group (and gets a heading).
    function startsGroup(index: int): bool {
        const items = root.filteredItems;
        if (index < 0 || index >= items.length || !items[index].group) {
            return false;
        }
        return index === 0 || items[index - 1].group !== items[index].group;
    }

    readonly property int groupCount: {
        let n = 0;
        for (let i = 0; i < filteredItems.length; i++) {
            if (startsGroup(i)) n++;
        }
        return n;
    }

    readonly property var filteredItems: {
        if (!filterText) return allItems;
        let query = filterText.toLowerCase().trim();
        return allItems.filter(item => {
            if (item.type === "close") return true;
            return item.name.toLowerCase().includes(query) ||
                   item.type.toLowerCase().includes(query) ||
                   item.description.toLowerCase().includes(query);
        });
    }

    onVisibleItemsCountChanged: {
        if (visibleItemsCount === 0 && visible) {
            close();
        }
        listView.currentIndex = 0;
        listView.positionViewAtIndex(0, ListView.Beginning);
    }

    onClosed: {
        listView.currentIndex = 0;
        listView.positionViewAtIndex(0, ListView.Beginning);
    }

    onOpened: {
        listView.currentIndex = 0;
        listView.positionViewAtIndex(0, ListView.Beginning);
    }

    function moveSelectionUp(): void {
        if (listView.currentIndex > 0) {
            listView.currentIndex--;
            listView.positionViewAtIndex(listView.currentIndex, ListView.Contain);
        }
    }

    function moveSelectionDown(): void {
        if (listView.currentIndex < visibleItemsCount - 1) {
            listView.currentIndex++;
            listView.positionViewAtIndex(listView.currentIndex, ListView.Contain);
        }
    }

    function selectCurrent(): void {
        if (listView.currentItem) {
            listView.currentItem.select();
        }
    }

    padding: Kirigami.Units.smallSpacing

    contentItem: Item {
        implicitWidth: Kirigami.Units.gridUnit * 19
        implicitHeight: Math.min(Kirigami.Units.gridUnit * 20, Math.max(Kirigami.Units.gridUnit * 4, (listView.count * Kirigami.Units.gridUnit * 2.2) + root.groupCount * Kirigami.Units.gridUnit * 1.4 + Kirigami.Units.smallSpacing * 2))

        ListView {
            id: listView
            anchors.fill: parent
            model: root.filteredItems
            clip: true
            currentIndex: 0

            ScrollBar.vertical: ScrollBar {
                policy: ScrollBar.AsNeeded
            }

            delegate: Column {
                id: delegateWrapper
                required property var modelData
                required property int index
                readonly property bool isCurrent: ListView.isCurrentItem
                width: ListView.view.width

                function select(): void {
                    delegateRoot.select();
                }

                Kirigami.Heading {
                    visible: root.startsGroup(delegateWrapper.index)
                    width: parent.width
                    height: visible ? Kirigami.Units.gridUnit * 1.4 : 0
                    level: 5
                    text: delegateWrapper.modelData.group
                    color: Kirigami.Theme.disabledTextColor
                    leftPadding: Kirigami.Units.smallSpacing
                    verticalAlignment: Text.AlignBottom
                }

            RoundedItemDelegate {
                id: delegateRoot
                readonly property var modelData: delegateWrapper.modelData
                width: parent.width
                height: Kirigami.Units.gridUnit * 2.2

                padding: Kirigami.Units.smallSpacing
                leftInset: 0
                rightInset: 0
                topInset: 0
                bottomInset: 0

                highlighted: delegateWrapper.isCurrent

                contentItem: RowLayout {
                    spacing: Kirigami.Units.mediumSpacing

                    Item {
                        Layout.preferredWidth: Kirigami.Units.iconSizes.smallMedium
                        Layout.preferredHeight: Kirigami.Units.iconSizes.smallMedium
                        Layout.alignment: Qt.AlignVCenter

                        Kirigami.Icon {
                            anchors.fill: parent
                            source: modelData.icon || ""
                            visible: Boolean(modelData.icon)
                        }

                        Label {
                            anchors.fill: parent
                            text: modelData.iconText || ""
                            visible: Boolean(modelData.iconText)
                            horizontalAlignment: Text.AlignHCenter
                            verticalAlignment: Text.AlignVCenter
                            font.bold: true
                            font.pointSize: modelData.iconText === "¶" ? Kirigami.Theme.defaultFont.pointSize * 1.1 : Kirigami.Theme.smallFont.pointSize
                            color: delegateRoot.highlighted ? Kirigami.Theme.highlightedTextColor : Kirigami.Theme.textColor
                        }
                    }

                    ColumnLayout {
                        spacing: 0
                        Layout.fillWidth: true
                        Layout.alignment: Qt.AlignVCenter

                        Label {
                            text: modelData.name
                            font.bold: true
                            elide: Text.ElideRight
                            Layout.fillWidth: true
                        }

                        Label {
                            text: modelData.description
                            font.pointSize: Kirigami.Theme.smallFont.pointSize
                            color: Kirigami.Theme.disabledTextColor
                            elide: Text.ElideRight
                            Layout.fillWidth: true
                        }
                    }

                    // Markdown shortcut that creates the same block without the menu.
                    Label {
                        text: modelData.md || ""
                        visible: text.length > 0
                        font.family: "monospace"
                        font.pointSize: Kirigami.Theme.smallFont.pointSize
                        color: delegateRoot.highlighted ? Kirigami.Theme.highlightedTextColor : Kirigami.Theme.disabledTextColor
                        Layout.alignment: Qt.AlignVCenter
                        Layout.rightMargin: Kirigami.Units.largeSpacing * 2 // clear of the scrollbar
                    }
                }

                function select(): void {
                    root.elementSelected(modelData);
                }

                onClicked: {
                    select();
                }
            }
            }
        }
    }
}
