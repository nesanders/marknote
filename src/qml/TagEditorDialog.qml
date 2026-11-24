// SPDX-FileCopyrightText: 2026 Marknote fork contributors
// SPDX-License-Identifier: GPL-2.0-only OR GPL-3.0-only OR LicenseRef-KDE-Accepted-GPL

import QtQuick
import QtQuick.Controls as Controls
import QtQuick.Layouts
import org.kde.kirigami as Kirigami
import org.kde.ki18n
import org.kde.marknote

/**
 * Add and remove tags on a note. Existing tags in the notebook autocomplete;
 * anything else typed becomes a new tag. Changes are saved immediately.
 */
Kirigami.Dialog {
    id: root

    required property url noteUrl
    property string noteName: ""

    property var tags: []
    readonly property var notebookTags: NavigationController.notebookPath.length > 0
        ? NoteMetadata.tagsInNotebook(NavigationController.notebookPath) : []
    readonly property string query: NoteMetadata.normalizeTag(input.text).toLowerCase()
    readonly property var suggestions: {
        const out = [];
        for (const t of root.notebookTags) {
            if (root.tags.indexOf(t.name) === -1 && (root.query.length === 0 || t.name.toLowerCase().indexOf(root.query) !== -1)) {
                out.push(t);
            }
        }
        return out.slice(0, 8);
    }
    readonly property bool canCreate: root.query.length > 0
        && !root.notebookTags.some(t => t.name.toLowerCase() === root.query)
        && root.tags.indexOf(NoteMetadata.normalizeTag(input.text)) === -1

    title: noteName.length > 0
        ? KI18n.i18nc("@title:window %1 is a note name", "Tags for “%1”", noteName)
        : KI18n.i18nc("@title:window", "Edit Tags")
    preferredWidth: Kirigami.Units.gridUnit * 22
    padding: Kirigami.Units.largeSpacing
    standardButtons: Kirigami.Dialog.Close

    onOpened: {
        reload();
        input.forceActiveFocus();
    }
    onClosed: destroy()

    function reload(): void {
        root.tags = NoteMetadata.read(root.noteUrl).tags ?? [];
    }

    function add(tag: string): void {
        const clean = NoteMetadata.normalizeTag(tag);
        if (clean.length > 0 && NoteMetadata.addTag(root.noteUrl, clean)) {
            reload();
        }
        input.clear();
    }

    function remove(tag: string): void {
        if (NoteMetadata.removeTag(root.noteUrl, tag)) {
            reload();
        }
    }

    contentItem: ColumnLayout {
        spacing: Kirigami.Units.largeSpacing

        Flow {
            Layout.fillWidth: true
            spacing: Kirigami.Units.smallSpacing

            Repeater {
                model: root.tags
                delegate: TagChip {
                    required property string modelData
                    tag: modelData
                    removable: true
                    onRemoveRequested: root.remove(modelData)
                }
            }
            Controls.Label {
                visible: root.tags.length === 0
                text: KI18n.i18nc("@info", "No tags yet.")
                color: Kirigami.Theme.disabledTextColor
            }
        }

        Controls.TextField {
            id: input
            Layout.fillWidth: true
            placeholderText: KI18n.i18nc("@info:placeholder", "Add a tag…")
            onAccepted: {
                if (suggestionList.currentIndex >= 0 && suggestionList.currentIndex < root.suggestions.length) {
                    root.add(root.suggestions[suggestionList.currentIndex].name);
                } else if (text.length > 0) {
                    root.add(text);
                }
            }
            onTextChanged: suggestionList.currentIndex = -1
            Keys.onDownPressed: suggestionList.currentIndex = Math.min(suggestionList.currentIndex + 1, root.suggestions.length - 1)
            Keys.onUpPressed: suggestionList.currentIndex = Math.max(suggestionList.currentIndex - 1, -1)
        }

        ListView {
            id: suggestionList
            Layout.fillWidth: true
            implicitHeight: contentHeight
            interactive: false
            currentIndex: -1
            model: root.suggestions
            delegate: Controls.ItemDelegate {
                required property var modelData
                required property int index
                width: ListView.view.width
                highlighted: ListView.isCurrentItem
                text: KI18n.i18nc("@action:button tag name and note count", "%1 (%2)", modelData.name, modelData.count)
                icon.name: "tag"
                onClicked: root.add(modelData.name)
            }
            footer: Controls.ItemDelegate {
                width: ListView.view.width
                visible: root.canCreate
                height: visible ? implicitHeight : 0
                icon.name: "list-add"
                text: KI18n.i18nc("@action:button", "Create tag “%1”", NoteMetadata.normalizeTag(input.text))
                onClicked: root.add(input.text)
            }
        }
    }
}
