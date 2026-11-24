// SPDX-FileCopyrightText: 2023 Mathis Brüchert <mbb@kaidan.im>
// SPDX-FileCopyrightText: 2026 Valentyn Bondarenko <bondarenko@vivaldi.net>
// SPDX-License-Identifier: GPL-2.0-only OR GPL-3.0-only OR LicenseRef-KDE-Accepted-GPL

import QtQuick
import QtQuick.Controls
import QtQuick.Layouts
import QtQuick.Dialogs
import QtQml.Models

import org.kde.marknote
import org.kde.marknote.settings
import org.kde.notification
import org.kde.ki18n
import org.kde.kitemmodels 1.0 as KItemModels
import org.kde.kirigami as Kirigami
import org.kde.kirigamiaddons.delegates as Delegates
import org.kde.kirigamiaddons.components as Components
import org.kde.kirigamiaddons.treeview 1.0 as KTreeView

pragma ComponentBehavior: Bound

Kirigami.ScrollablePage {
    id: root

    objectName: "NotesPage"

    readonly property bool isWideScreen: !!_window?.isWideScreen // qmllint disable missing-property
    property color backgroundColor: Kirigami.ColorUtils.linearInterpolation(Kirigami.Theme.backgroundColor, Kirigami.Theme.alternateBackgroundColor, 0.6)
    background: Rectangle {color: root.backgroundColor}
    readonly property string currentSearchText: FilterState.active ? "x" : ""
    property int defaultPlaceholderWidth: notesList.width - (Kirigami.Units.largeSpacing * 4)

    bottomPadding: inlineStatusBar.visible ? inlineStatusBar.effectiveHeight : 0

    property var _window: ApplicationWindow.window
    readonly property Kirigami.PageRow pageStack: (ApplicationWindow.window as Kirigami.ApplicationWindow)?.pageStack ?? null

    readonly property string normRoot: cleanPath(NavigationController.notebookPath)
    readonly property int rootDepth: Math.max(0, (normRoot.match(/\//g) || []).length)
    property bool isTreeExpanded: true

    readonly property string activeAbsolutePath: {
        if (!NavigationController.notePath) return "";
        let rPath = root.normRoot;
        if (!rPath.endsWith("/")) rPath += "/";
        return rPath + NavigationController.notePath;
    }

    function cleanPath(p) {
        if (!p) return "";
        let s = p.toString();
        if (s.startsWith("file://")) s = s.substring(7);
            return s.replace(/\/+$/, "");
    }

    function activateItem(index, isExpandable, path) {
        if (isExpandable) {
            pageNotesModel.fetchMore(path)
            notesProxyModel.toggleChildren(index)
        } else {
            let full = cleanPath(path);
            let rPath = root.normRoot;
            if (!rPath.endsWith("/")) rPath += "/";

            if (full.startsWith(rPath)) {
                NavigationController.notePath = full.substring(rPath.length);
            }
        }
    }

    function toggleExpandAll() {
        root.isTreeExpanded = !root.isTreeExpanded;
        if (root.isTreeExpanded) {
            let i = 0;
            let limit = 0;
            // Check rowCount dynamically as the tree grows
            while (i < notesProxyModel.rowCount() && limit < 500) {
                let idx = notesProxyModel.index(i, 0);
                if (notesProxyModel.data(idx, notesProxyModel.KDescendantExpandableRole) &&
                    !notesProxyModel.data(idx, notesProxyModel.KDescendantExpandedRole)) {

                    let p = notesProxyModel.data(idx, NotesModel.Path);
                if (p) pageNotesModel.fetchMore(p);
                notesProxyModel.toggleChildren(i);
                    // Don't increment i;
                    // check the same row (now expanded) to dive into children
                    } else {
                        i++;
                    }
                    limit++;
            }
        } else {
            // Collapse backward to avoid index shifting
            for (let i = notesProxyModel.rowCount() - 1; i >= 0; i--) {
                if (notesProxyModel.data(notesProxyModel.index(i, 0), notesProxyModel.KDescendantExpandedRole)) {
                    notesProxyModel.toggleChildren(i);
                }
            }
        }
    }

    footer: ToolBar {
        id: filterBar
        visible: Config.showFilterBar && NavigationController.notebookPath.length > 0
        position: ToolBar.Footer
        leftPadding: Kirigami.Units.smallSpacing
        rightPadding: Kirigami.Units.smallSpacing

        Connections {
            target: FilterState
            function onFocusRequested(): void {
                filterField.forceActiveFocus();
                filterField.selectAll();
            }
            function onTextChanged(): void {
                if (filterField.text !== FilterState.text) {
                    filterField.text = FilterState.text;
                }
            }
        }

        contentItem: ColumnLayout {
            spacing: Kirigami.Units.smallSpacing

            RowLayout {
                Layout.fillWidth: true
                spacing: Kirigami.Units.smallSpacing

                Kirigami.SearchField {
                    id: filterField
                    Layout.fillWidth: true
                    focusSequences: []
                    placeholderText: FilterState.searchContents
                        ? KI18n.i18nc("@info:placeholder", "Filter by name or text, or tag:name…")
                        : KI18n.i18nc("@info:placeholder", "Filter by name, or tag:name…")
                    onTextChanged: FilterState.text = text
                    Keys.onEscapePressed: (event) => {
                        if (text.length > 0) {
                            clear();
                        } else {
                            notesList.forceActiveFocus();
                        }
                        event.accepted = true;
                    }
                    Keys.onDownPressed: notesList.forceActiveFocus()
                }

                ToolButton {
                    id: contentsButton
                    icon.name: "document-preview"
                    text: KI18n.i18nc("@action:button search inside note text", "Contents")
                    checkable: true
                    checked: FilterState.searchContents
                    display: root.width > Kirigami.Units.gridUnit * 16 ? AbstractButton.TextBesideIcon : AbstractButton.IconOnly
                    onToggled: FilterState.setSearchContents(checked)
                    ToolTip.visible: hovered
                    ToolTip.text: checked ? KI18n.i18nc("@info:tooltip", "Searching note names and text") : KI18n.i18nc("@info:tooltip", "Also search inside notes")
                    ToolTip.delay: Kirigami.Units.toolTipDelay
                }

                ToolButton {
                    id: tagsButton
                    icon.name: "tag"
                    text: FilterState.tags.length > 0
                        ? KI18n.i18nc("@action:button tag filter with count", "Tags (%1)", FilterState.tags.length)
                        : KI18n.i18nc("@action:button", "Tags")
                    display: root.width > Kirigami.Units.gridUnit * 16 ? AbstractButton.TextBesideIcon : AbstractButton.IconOnly
                    enabled: root.notebookTags.length > 0
                    down: pressed || tagMenu.visible
                    onPressed: tagMenu.popup(tagsButton, 0, -tagMenu.implicitHeight)
                    ToolTip.visible: hovered && display === AbstractButton.IconOnly
                    ToolTip.text: KI18n.i18nc("@info:tooltip", "Filter by tag")
                    ToolTip.delay: Kirigami.Units.toolTipDelay

                    Menu {
                        id: tagMenu
                        Instantiator {
                            model: root.notebookTags
                            delegate: MenuItem {
                                required property var modelData
                                checkable: true
                                checked: FilterState.tags.indexOf(modelData.name) !== -1
                                text: KI18n.i18nc("@action:inmenu tag name and number of notes", "%1 (%2)", modelData.name, modelData.count)
                                onTriggered: FilterState.toggleTag(modelData.name)
                            }
                            onObjectAdded: (index, object) => tagMenu.insertItem(index, object)
                            onObjectRemoved: (index, object) => tagMenu.removeItem(object)
                        }
                    }
                }

                ToolButton {
                    icon.name: "dialog-close"
                    text: KI18n.i18nc("@action:button", "Hide Filter Bar")
                    display: AbstractButton.IconOnly
                    onClicked: {
                        FilterState.clear();
                        Config.showFilterBar = false;
                        Config.save();
                    }
                    ToolTip.visible: hovered
                    ToolTip.text: text
                    ToolTip.delay: Kirigami.Units.toolTipDelay
                }
            }

            Flow {
                Layout.fillWidth: true
                visible: FilterState.tags.length > 0
                spacing: Kirigami.Units.smallSpacing

                Repeater {
                    model: FilterState.tags
                    delegate: TagChip {
                        required property string modelData
                        tag: modelData
                        removable: true
                        selected: true
                        onRemoveRequested: FilterState.toggleTag(modelData)
                    }
                }

                RowLayout {
                    visible: FilterState.tags.length > 1
                    spacing: 0
                    Label {
                        text: KI18n.i18nc("@label tag filter match mode", "Match:")
                        rightPadding: Kirigami.Units.smallSpacing
                    }
                    Button {
                        text: KI18n.i18nc("@option:radio tag filter", "All Tags")
                        checkable: true
                        autoExclusive: true
                        checked: !FilterState.matchAny
                        flat: !checked
                        onClicked: FilterState.setMatchAny(false)
                    }
                    Button {
                        text: KI18n.i18nc("@option:radio tag filter", "Any Tag")
                        checkable: true
                        autoExclusive: true
                        checked: FilterState.matchAny
                        flat: !checked
                        onClicked: FilterState.setMatchAny(true)
                    }
                }

                ToolButton {
                    text: KI18n.i18nc("@action:button", "Clear")
                    icon.name: "edit-clear-all"
                    onClicked: FilterState.clear()
                }
            }
        }
    }

    Connections {
        target: pageNotesModel
        function onTotalNotesCountChanged(): void {
            root.refreshTags();
        }
    }

    Component {
        id: noteMetadataDialogComponent
        NoteMetadataDialog {}
    }

    Components.FloatingButton {
        visible: Kirigami.Settings.isMobile
        parent: root.overlay
        anchors {
            bottom: parent.bottom
            right: parent.right
            rightMargin: Kirigami.Units.gridUnit
            bottomMargin: Kirigami.Units.gridUnit
        }
        text: KI18n.i18n("Add note")
        icon.name: "list-add"
        onClicked: newNoteAction.trigger()
    }

    enum SortRole {
        SortName,
        SortDate
    }

    Connections {
        target: App
        function onNewNote(): void {
            if (noteMetadataDialogComponent.status === Component.Ready) {
                const dialog = noteMetadataDialogComponent.createObject(root, {
                    mode: NoteMetadataDialog.Mode.Add,
                    model: pageNotesModel,
                }) as NoteMetadataDialog;
                dialog.open();
            } else if (noteMetadataDialogComponent.status === Component.Error) {
                console.error("Error loading NoteMetadataDialog:", noteMetadataDialogComponent.errorString());
            }
        }
    }

    titleDelegate: RowLayout {
        id: titleLayout
        spacing: Kirigami.Units.smallSpacing
        Layout.fillWidth: true

        ToolButton {
            id: addButton
            visible: !Kirigami.Settings.isMobile
            display: AbstractButton.IconOnly
            action: newNoteAction
            ToolTip.delay: Kirigami.Units.toolTipDelay
            ToolTip.visible: hovered
            ToolTip.text: text
        }

        ToolButton {
            visible: !Kirigami.Settings.isMobile
            display: AbstractButton.IconOnly
            icon.name: "folder-new"
            text: KI18n.i18nc("@action:button", "New Folder")
            onClicked: root.openNewEntryDialog(1, "")
            ToolTip.delay: Kirigami.Units.toolTipDelay
            ToolTip.visible: hovered
            ToolTip.text: text
        }

        Kirigami.Heading {
            id: heading
            visible: root.isWideScreen
            text: NavigationController.notebookName
            Layout.fillWidth: true
            Layout.leftMargin: Kirigami.Units.largeSpacing
            Layout.rightMargin: Kirigami.Units.largeSpacing
            horizontalAlignment: Text.AlignHCenter
            elide: Qt.ElideRight
        }

        ToolButton {
            id: headingButton
            visible: !root.isWideScreen
            Layout.fillWidth: true
            Layout.fillHeight: true
            onClicked: ApplicationWindow.window.openBottomDrawer()
            contentItem: RowLayout {
                Item {
                    visible: !Kirigami.Settings.isMobile
                    Layout.fillWidth: true
                }
                Kirigami.Heading {
                    type: Kirigami.Heading.Type.Primary
                    text: NavigationController.notebookName
                    Layout.leftMargin: Kirigami.Units.largeSpacing
                }
                Kirigami.Icon {
                    source: "go-down-symbolic"
                    implicitHeight: Kirigami.Units.gridUnit
                }
                Item { Layout.fillWidth: true }
            }
        }

        ToolButton {
            icon.name: "view-filter"
            text: KI18n.i18nc("@action:button", "Filter Notes")
            display: AbstractButton.IconOnly
            visible: !Config.showFilterBar
            onClicked: {
                Config.showFilterBar = true;
                Config.save();
                FilterState.focusRequested();
            }
            ToolTip.delay: Kirigami.Units.toolTipDelay
            ToolTip.visible: hovered
            ToolTip.text: text
        }

        ToolButton {
            visible: root._window ? (root._window.visibility === Window.FullScreen && root.pageStack.depth !== 2) : false
            icon.name: "window-restore-symbolic"
            text: KI18n.i18nc("@action:menu", "Exit Full Screen")
            display: AbstractButton.IconOnly
            checkable: true
            checked: true
            onClicked: root._window.showNormal()

            ToolTip.text: text
            ToolTip.visible: hovered
            ToolTip.delay: Kirigami.Units.toolTipDelay
        }
    }

    Components.MessageDialog {
        id: removeDialog

        property string notePath
        property url fileUrl
        property string noteName
        property bool isFolder

        dialogType: Components.MessageDialog.Warning
        title: isFolder? KI18n.i18nc("@title:window", "Delete Folder") : KI18n.i18nc("@title:window", "Delete Note")
        onRejected: close()
        onAccepted: {
            if (isFolder) {
                let folderPath = cleanPath(notePath);
                let activePath = cleanPath(root.activeAbsolutePath);

                let isInsideFolder = (path) =>
                    path === folderPath || path.startsWith(folderPath + "/");

                pageNotesModel.deleteFolder(fileUrl);

                if (isInsideFolder(activePath)) {
                    NavigationController.notePath = '';
                }
            } else {
                let isCurrentNote = (cleanPath(notePath) === root.activeAbsolutePath)
                                 || (fileUrl.toString() === NavigationController.noteFullPath.toString());

                pageNotesModel.deleteNote(fileUrl);

                if (isCurrentNote) {
                    NavigationController.notePath = '';
                }
            }

            close();
        }
        standardButtons: Dialog.Ok | Dialog.Cancel
        subtitle: { if (isFolder) {
                    KI18n.i18n("Are you sure you want to delete the folder <b> %1 </b>? This will delete all notes contained in <b>%2</b> definitively.", removeDialog.noteName, removeDialog.notePath)
                } else {
                    KI18n.i18n("Are you sure you want to delete the note <b> %1 </b>? This will delete the file <b>%2</b> definitively.", removeDialog.noteName, removeDialog.notePath)

                }
            }
    }

    NotesModel {
        id: pageNotesModel
        path: NavigationController.notebookPath

        onErrorOccurred: (errorMessage) => {
            root._window.showPassiveNotification(errorMessage, "long");
        }
    }

    KItemModels.KSortFilterProxyModel {
        id: filterModel
        property int sortOrder: Qt.AscendingOrder
        filterCaseSensitivity: Qt.CaseInsensitive
        sortCaseSensitivity: Qt.CaseInsensitive
        sortRole: NotesModel.Name
        recursiveFilteringEnabled : true
        sourceModel: pageNotesModel
        filterRowCallback: function(sourceRow, sourceParent) {
            if (!FilterState.active) {
                return true;
            }
            const idx = pageNotesModel.index(sourceRow, 0, sourceParent);
            const name = pageNotesModel.data(idx, NotesModel.Name) ?? "";
            if (pageNotesModel.data(idx, NotesModel.IsFolder)) {
                return FilterState.acceptsFolder(name);
            }
            return FilterState.acceptsNote(name, pageNotesModel.data(idx, NotesModel.Tags), pageNotesModel.data(idx, NotesModel.Path));
        }
        Component.onCompleted: filterModel.sort(0, filterModel.sortOrder)
    }

    Connections {
        target: FilterState
        function onRevisionChanged(): void {
            filterRefresh.restart();
        }
        function onActiveChanged(): void {
            if (FilterState.active) {
                // Matches can be inside folders that were never opened.
                pageNotesModel.fetchAll();
            }
        }
    }

    // Re-run the filter. KDescendantsProxyModel keeps stale expansion state when
    // rows of its source vanish and reappear across several re-filters, so it is
    // rebuilt (reattached) and every folder expanded to show the matches.
    Timer {
        id: filterRefresh
        interval: 120
        onTriggered: {
            filterModel.invalidateFilter();
            notesProxyModel.sourceModel = null;
            notesProxyModel.sourceModel = filterModel;
            root.setAllExpanded(true);
        }
    }

    Connections {
        target: NoteMetadata
        function onRevisionChanged(): void {
            if (FilterState.active) {
                filterRefresh.restart();
            }
            root.refreshTags();
        }
    }

    Connections {
        target: pageNotesModel
        function onRowsInserted(): void {
            if (FilterState.active) {
                filterRefresh.restart();
            }
        }
    }

    /// Every tag in this notebook with its note count, for the filter bar menu.
    property var notebookTags: []
    function refreshTags(): void {
        root.notebookTags = NavigationController.notebookPath.length > 0
            ? NoteMetadata.tagsInNotebook(NavigationController.notebookPath) : [];
    }
    Connections {
        target: NavigationController
        function onNotebookPathChanged(): void {
            FilterState.clear();
            root.refreshTags();
        }
    }
    Component.onCompleted: refreshTags()

    // --- API used by the menu bar (AppActions) ---

    function setAllExpanded(expand: bool): void {
        root.isTreeExpanded = !expand;
        root.toggleExpandAll();
    }

    function openNewEntryDialog(type: int, parentPath: string): void {
        if (noteMetadataDialogComponent.status !== Component.Ready) {
            console.error("Error loading NoteMetadataDialog:", noteMetadataDialogComponent.errorString());
            return;
        }
        const dialog = noteMetadataDialogComponent.createObject(root, {
            mode: NoteMetadataDialog.Mode.Add,
            model: pageNotesModel,
            initialType: type,
            parentFolder: parentPath.length > 0 ? ("file://" + root.cleanPath(parentPath)) : ""
        }) as NoteMetadataDialog;
        dialog.open();
    }

    function findDelegate(absPath: string): var {
        const wanted = root.cleanPath(absPath);
        for (let i = 0; i < notesList.count; i++) {
            const item = notesList.itemAtIndex(i);
            if (item && item.normPath === wanted) {
                return item;
            }
        }
        return null;
    }

    function startRename(absPath: string): void {
        const item = root.findDelegate(absPath);
        if (item) {
            notesList.positionViewAtIndex(item.index, ListView.Contain);
            item.renameField.enabled = true;
            item.renameField.forceActiveFocus();
            item.renameField.selectAll();
        }
    }

    function exportNote(kind: string, url: url, name: string): void {
        const kinds = {
            html: [KI18n.i18nc("@title:window", "Export to HTML"), KI18n.i18n("HTML file (*.html)")],
            pdf: [KI18n.i18nc("@title:window", "Export to PDF"), KI18n.i18n("PDF file (*.pdf)")],
            odt: [KI18n.i18nc("@title:window", "Export to ODT"), KI18n.i18n("ODF Text Document (*.odt)")]
        };
        fileDialog.name = name;
        fileDialog.path = url;
        fileDialog.selectedFile = name + '.' + kind;
        fileDialog.title = kinds[kind][0];
        fileDialog.nameFilters = [kinds[kind][1]];
        fileDialog.open();
    }

    /// Move a note or folder (by path or file URL) into @p destPath, keeping the editor on it.
    function moveInto(source: string, destPath: string): void {
        const src = root.cleanPath(source);
        const dest = root.cleanPath(destPath);
        if (src.length === 0 || dest.length === 0 || src === dest) {
            return;
        }
        if (src.substring(0, src.lastIndexOf("/")) === dest) {
            return; // already there
        }
        const newPath = dest + src.substring(src.lastIndexOf("/"));
        const active = root.activeAbsolutePath;
        if (pageNotesModel.moveEntry("file://" + src, "file://" + dest)) {
            if (active === src) {
                NavigationController.noteRenamed("file://" + src, "file://" + newPath);
            } else if (active.startsWith(src + "/")) {
                // The open note was inside the moved folder.
                NavigationController.noteRenamed("file://" + active, "file://" + newPath + active.substring(src.length));
            }
        }
    }

    function duplicate(url: url): void {
        pageNotesModel.duplicateNote(url);
    }

    function copyNote(url: url): void {
        pageNotesModel.copyWholeNote(url);
    }

    function confirmDelete(name: string, path: string, url: url, isFolder: bool): void {
        removeDialog.noteName = name;
        removeDialog.notePath = path;
        removeDialog.fileUrl = url;
        removeDialog.isFolder = isFolder;
        removeDialog.open();
    }

    KItemModels.KDescendantsProxyModel {
        id: notesProxyModel
        sourceModel: filterModel
    }

    ListView {
        id: notesList
        model: notesProxyModel
        anchors.fill: parent
        clip: true
        focus: true
        activeFocusOnTab: true
        boundsBehavior: Flickable.StopAtBounds

        highlightRangeMode: ListView.NoHighlightRange
        keyNavigationEnabled: true
        highlightMoveDuration: 0

        currentIndex: -1

        populate: Transition {
            NumberAnimation { property: "opacity"; from: 0.0; to: 1.0; duration: Kirigami.Units.shortDuration; easing.type: Easing.OutQuart }
        }
        add: Transition {
            NumberAnimation { property: "opacity"; from: 0.0; to: 1.0; duration: Kirigami.Units.longDuration; easing.type: Easing.InOutQuart }
        }
        addDisplaced: Transition {
            NumberAnimation { properties: "x,y"; duration: Kirigami.Units.longDuration; easing.type: Easing.InOutQuart }
        }
        displaced: Transition {
            NumberAnimation { properties: "x,y"; duration: Kirigami.Units.longDuration; easing.type: Easing.InOutQuart }
        }
        remove: Transition {
            NumberAnimation { property: "opacity"; from: 1.0; to: 0.0; duration: Kirigami.Units.longDuration; easing.type: Easing.InQuart }
        }
        removeDisplaced: Transition {
            NumberAnimation { properties: "x,y"; duration: Kirigami.Units.longDuration; easing.type: Easing.InOutQuart }
        }

        Component {
            id: sectionDelegate
            Kirigami.ListSectionHeader {
                required property string section
                text: section
                width: parent.width
            }
        }
        Component {
            id: nullComponent
            Item {}
        }

        state: Config.sortBehaviour
        states: [
            State {
                name: "sort-name"
                PropertyChanges {
                    filterModel.sortRole: NotesModel.Name
                    filterModel.sortOrder: Qt.AscendingOrder
                }
                PropertyChanges {
                    notesList.section.delegate: nullComponent
                }
                StateChangeScript { script: filterModel.sort(0, Qt.AscendingOrder) }
            },
            State {
                name: "sort-date"
                PropertyChanges {
                    filterModel.sortRole: NotesModel.Date
                    filterModel.sortOrder: Qt.DescendingOrder
                }
                PropertyChanges {
                    notesList.section.delegate: sectionDelegate
                }
                StateChangeScript { script: filterModel.sort(0, Qt.DescendingOrder) }
            },
            State {
                name: "sort-created"
                PropertyChanges {
                    filterModel.sortRole: NotesModel.Created
                    filterModel.sortOrder: Qt.DescendingOrder
                }
                PropertyChanges {
                    notesList.section.delegate: nullComponent
                }
                StateChangeScript { script: filterModel.sort(0, Qt.DescendingOrder) }
            }
        ]

        section {
            property: "month"
            delegate: Kirigami.ListSectionHeader {
                required property string section
                text: section
                width: parent.width
            }
        }

        FileDialog {
            id: fileDialog
            property string name
            property string path
            property string exportPath

            fileMode: FileDialog.SaveFile
            onAccepted: {
                var success = false;
                fileDialog.exportPath = selectedFile
                if (selectedFile.toString().endsWith('.html')) {
                    success = pageNotesModel.exportToHtml(path, selectedFile);
                } else if (selectedFile.toString().endsWith('.pdf')) {
                    success = pageNotesModel.exportToPdf(path, selectedFile);
                } else if (selectedFile.toString().endsWith('.odt')) {
                    success = pageNotesModel.exportToOdt(path, selectedFile);
                }
                var notification = null;
                if (success) {
                    notification = exportSuccessNotificationComponent.createObject(this, {
                        "name": fileDialog.name,
                        "path": fileDialog.exportPath
                    });
                } else {
                    notification = exportFailedNotificationComponent.createObject(this, {
                        "name": fileDialog.name
                    });
                }

                if (notification !== null) {
                    notification.sendEvent();
                } else {
                    console.error("Failed to dynamically create the notification component.");
                }
            }

            Component {
                id: exportSuccessNotificationComponent
                Notification {
                    id: exportSuccessNotification
                    required property string path
                    required property string name

                    componentName: "marknote"
                    eventId: "exportSuccessful"
                    title: KI18n.i18nc("@title:window", "Marknote")
                    text: KI18n.i18nc("@info", "Export of “%1” was successful.", exportSuccessNotification.name);
                    iconName: {
                        const ext = exportSuccessNotification.path.split('.').pop().toLowerCase();
                        switch (ext) {
                            case "pdf": return "application-pdf";
                            case "html":
                            case "htm": return "text-html";
                            case "odt": return "application-vnd.oasis.opendocument.text";
                            default: return "document-export";
                        }
                    }
                    actions: [
                        NotificationAction {
                            label: KI18n.i18nc("@action:notifaction","Open File")
                            onActivated: Qt.openUrlExternally(exportSuccessNotification.path)
                        }
                    ]
                }
            }

            Component {
                id: exportFailedNotificationComponent
                Notification {
                    id: exportFailedNotification
                    required property string name
                    componentName: "marknote"
                    eventId: "exportFailed"
                    title: KI18n.i18nc("@title:window", "Marknote")
                    text: KI18n.i18nc("@info", "Export of “%1” failed.", exportFailedNotification.name);
                    iconName: "error"
                }
            }
        }

        Components.ConvergentContextMenu {
            id: folderMenu
            property Delegates.RoundedItemDelegate delegateItem

            Kirigami.Action {
                text: KI18n.i18nc("@action:inmenu", "New Note Here…")
                icon.name: "document-new"
                onTriggered: root.openNewEntryDialog(0, folderMenu.delegateItem.normPath)
            }

            Kirigami.Action {
                text: KI18n.i18nc("@action:inmenu", "New Subfolder…")
                icon.name: "folder-new"
                onTriggered: root.openNewEntryDialog(1, folderMenu.delegateItem.normPath)
            }

            Kirigami.Action { separator: true }

            Kirigami.Action {
                text: KI18n.i18nc("@action:inmenu", "Rename")
                icon.name: "edit-rename"
                onTriggered: {
                    folderMenu.delegateItem.renameField.enabled = true;
                    folderMenu.delegateItem.renameField.forceActiveFocus();
                    folderMenu.delegateItem.renameField.selectAll();
                }
            }

            Kirigami.Action {
                text: KI18n.i18nc("@action:inmenu", "Set Icon…")
                icon.name: "preferences-desktop-emoticons"
                onTriggered: root._window.openIconPicker(folderMenu.delegateItem.fileUrl, true, folderMenu.delegateItem.name)
            }

            Kirigami.Action { separator: true }

            Kirigami.Action {
                text: folderMenu.delegateItem && folderMenu.delegateItem.kDescendantExpanded
                    ? KI18n.i18nc("@action:inmenu", "Collapse") : KI18n.i18nc("@action:inmenu", "Expand")
                icon.name: folderMenu.delegateItem && folderMenu.delegateItem.kDescendantExpanded ? "collapse-all" : "expand-all"
                onTriggered: {
                    pageNotesModel.fetchMore(folderMenu.delegateItem.path);
                    notesProxyModel.toggleChildren(folderMenu.delegateItem.index);
                }
            }

            Kirigami.Action { separator: true }

            Kirigami.Action {
                text: KI18n.i18nc("@action:inmenu", "Delete")
                icon.name: "delete"
                onTriggered: root.confirmDelete(folderMenu.delegateItem.name, folderMenu.delegateItem.path, folderMenu.delegateItem.fileUrl, true)
            }
        }

        Components.ConvergentContextMenu {
            id: menu
            property Delegates.RoundedItemDelegate delegateItem

            Kirigami.Action {
                text: KI18n.i18nc("@action:inmenu", "Rename")
                icon.name: "edit-rename"
                onTriggered: {
                    menu.delegateItem.renameField.enabled = true;
                    menu.delegateItem.renameField.forceActiveFocus();
                    menu.delegateItem.renameField.selectAll();
                }
            }

            Kirigami.Action {
                text: KI18n.i18nc("@action:inmenu", "Set Icon…")
                icon.name: "preferences-desktop-emoticons"
                onTriggered: root._window.openIconPicker(menu.delegateItem.fileUrl, false, menu.delegateItem.name)
            }

            Kirigami.Action {
                text: KI18n.i18nc("@action:inmenu", "Edit Tags…")
                icon.name: "tag"
                onTriggered: root._window.openTagEditor(menu.delegateItem.fileUrl, menu.delegateItem.name)
            }

            Kirigami.Action { separator: true }

            Kirigami.Action {
                text: KI18n.i18nc("@action:inmenu", "Copy")
                icon.name: "edit-copy"
                visible: menu.delegateItem ? !menu.delegateItem.isFolder : false
                onTriggered: {
                    pageNotesModel.copyWholeNote(menu.delegateItem.fileUrl)
                    if (root._window && root.pageStack) {
                        const editorPage = root.pageStack.get(root.pageStack.depth - 1);
                        if (editorPage && editorPage.copyMessage) {
                            editorPage.copyMessage.visible = true;
                            return;
                        }
                    }
                }
            }

            Kirigami.Action {
                text: KI18n.i18nc("@action:inmenu", "Duplicate")
                icon.name: "edit-duplicate-symbolic"
                visible: menu.delegateItem ? !menu.delegateItem.isFolder : false
                onTriggered: {
                    pageNotesModel.duplicateNote(menu.delegateItem.fileUrl)
                }
            }

            Kirigami.Action {
                text: KI18n.i18nc("@action:inmenu", "Export")
                icon.name: "document-export"
                visible: menu.delegateItem ? !menu.delegateItem.isFolder : false
                Kirigami.Action {
                    text: KI18n.i18nc("@action:inmenu", "Export to HTML")
                    icon.name: "text-html"
                    onTriggered: {
                        fileDialog.name = menu.delegateItem.name;
                        fileDialog.path = menu.delegateItem.fileUrl;
                        fileDialog.selectedFile = menu.delegateItem.name + '.html';
                        fileDialog.title = KI18n.i18nc("@title:window", "Export to HTML");
                        fileDialog.nameFilters = [KI18n.i18n("HTML file (*.html)")];
                        fileDialog.open();
                    }
                }

                Kirigami.Action {
                    text: KI18n.i18nc("@action:inmenu", "Export to PDF")
                    icon.name: "application-pdf"
                    onTriggered: {
                        fileDialog.name = menu.delegateItem.name;
                        fileDialog.path = menu.delegateItem.fileUrl;
                        fileDialog.selectedFile = menu.delegateItem.name + '.pdf';
                        fileDialog.title = KI18n.i18nc("@title:window", "Export to PDF");
                        fileDialog.nameFilters = [KI18n.i18n("PDF file (*.pdf)")];
                        fileDialog.open();
                    }
                }

                Kirigami.Action {
                    text: KI18n.i18nc("@action:inmenu", "Export to ODT")
                    icon.name: "application-vnd.oasis.opendocument.text"
                    onTriggered: {
                        fileDialog.name = menu.delegateItem.name;
                        fileDialog.path = menu.delegateItem.fileUrl;
                        fileDialog.selectedFile = menu.delegateItem.name + '.odt';
                        fileDialog.title = KI18n.i18nc("@title:window", "Export to ODT");
                        fileDialog.nameFilters = [KI18n.i18n("ODF Text Document (*.odt)")];
                        fileDialog.open();
                    }
                }
            }

            Kirigami.Action { separator: true }

            Action {
                text: KI18n.i18nc("@action:inmenu", "Delete")
                icon.name: "delete"
                onTriggered: {
                    removeDialog.noteName = menu.delegateItem.name;
                    removeDialog.notePath = menu.delegateItem.path;
                    removeDialog.fileUrl = menu.delegateItem.fileUrl;
                    removeDialog.isFolder = menu.delegateItem.isFolder;
                    removeDialog.open()
                }
            }
        }

        delegate: Delegates.RoundedItemDelegate {
            id: delegateItem

            Kirigami.Theme.inherit: false
            Kirigami.Theme.backgroundColor: root.backgroundColor

            required property string name
            required property string path
            required property string color
            required property var date
            required property int index
            required property url fileUrl
            required property bool isFolder
            required property var tags
            required property string createdText
            required property string noteIcon
            required property bool noteIconIsEmoji
            property alias renameField: renameField
            property bool isRenaming: false

            required property int kDescendantLevel
            required property bool kDescendantExpandable
            required property bool kDescendantExpanded
            required property var kDescendantHasSiblings

            readonly property string normPath: root.cleanPath(path)
            readonly property bool isRelevant: normPath !== root.normRoot && normPath.startsWith(root.normRoot)
            readonly property int visualLevel: Math.max(1, (normPath.match(/\//g) || []).length - root.rootDepth)
            readonly property string parentDir: normPath.substring(0, normPath.lastIndexOf("/"))
            // Dolphin-style single line with columns when the list is wide enough.
            readonly property bool wide: notesList.width > Kirigami.Units.gridUnit * 26
            // View › Density: 0 compact (single line, tight), 1 normal, 2 comfortable.
            readonly property int density: Config.treeDensity
            readonly property bool compact: density === 0
            readonly property var tagList: tags ? Array.from(tags) : []
            readonly property bool showTags: Config.showTagsColumn && !isFolder && tagList.length > 0
            readonly property bool showCreated: Config.showCreatedColumn && createdText.length > 0

            property bool isDropTarget: false

            visible: isRelevant
            height: isRelevant ? implicitHeight : 0
            enabled: isRelevant

            function updateColor(): void {
                if (!delegateItem.background || !ApplicationWindow.window) {
                    return;
                }

                if (color !== '#ffffff' && color !== '#00000000') {
                    delegateItem.background.Kirigami.Theme.highlightColor = color;
                } else if (root._window) {
                    delegateItem.background.Kirigami.Theme.highlightColor = ApplicationWindow.window.Kirigami.Theme.highlightColor;
                }
            }

            function openContextMenu(): void {
                const target = delegateItem.isFolder ? folderMenu : menu;
                target.delegateItem = delegateItem;
                target.popup();
            }

            onColorChanged: updateColor();
            onBackgroundChanged: updateColor();

            Component.onCompleted: {
                updateColor();
                if (kDescendantExpandable) pageNotesModel.fetchMore(path);
            }
            onPathChanged: {
                if (kDescendantExpandable) pageNotesModel.fetchMore(path);
            }
            onHighlightedChanged: {
                if (highlighted) {
                    notesList.currentIndex = delegateItem.index;
                }
            }

            Keys.onRightPressed: if (kDescendantExpandable && !kDescendantExpanded) {
                pageNotesModel.fetchMore(path);
                notesProxyModel.toggleChildren(index);
            }
            Keys.onLeftPressed: if (kDescendantExpandable && kDescendantExpanded) {
                notesProxyModel.toggleChildren(index);
            }
            Keys.onReturnPressed: if (!delegateItem.isRenaming && !renameField.enabled) { root.activateItem(delegateItem.index, kDescendantExpandable, path) }
            Keys.onEnterPressed: if (!delegateItem.isRenaming && !renameField.enabled) { root.activateItem(delegateItem.index, kDescendantExpandable, path) }
            Keys.onPressed: (event) => {
                if (event.key === Qt.Key_F2 && !renameField.enabled) {
                    renameField.enabled = true;
                    renameField.forceActiveFocus();
                    renameField.selectAll();
                    event.accepted = true;
                } else if (event.key === Qt.Key_Menu) {
                    delegateItem.openContextMenu();
                    event.accepted = true;
                }
            }

            DragHandler {
                id: dragHandler
                target: null
                grabPermissions: PointerHandler.CanTakeOverFromAnything
                onActiveChanged: {
                    if (active) {
                        delegateItem.grabToImage(function(result) {
                            delegateItem.Drag.imageSource = result.url;
                            delegateItem.Drag.active = true;
                        });
                    } else {
                        delegateItem.Drag.drop();
                        delegateItem.Drag.active = false;
                    }
                }
            }

            Drag.dragType: Drag.Automatic
            Drag.hotSpot.x: width / 2
            Drag.hotSpot.y: height / 2
            Drag.proposedAction: Qt.MoveAction
            Drag.supportedActions: Qt.MoveAction
            Drag.mimeData: {
                "application/x-marknote-note": fileUrl.toString(),
                "text/uri-list": fileUrl.toString()
            }

            opacity: dragHandler.active ? 0.5 : 1

            DropArea {
                id: dropArea

                anchors.fill: parent
                anchors.margins: delegateItem.isFolder ? -Kirigami.Units.gridUnit * 0.5 : 0
                z: 99
                keys: ["application/x-marknote-note"]

                // Folders take the note; dropping on a note moves it next to that note.
                readonly property string destination: delegateItem.isFolder ? delegateItem.normPath : delegateItem.parentDir

                function sourcePath(drag): string {
                    return root.cleanPath(drag.getDataAsString ? drag.getDataAsString("application/x-marknote-note") : "");
                }

                onEntered: (drag) => {
                    delegateItem.isDropTarget = true;
                    drag.accept(Qt.MoveAction);
                }

                onPositionChanged: (drag) => {
                    drag.accept(Qt.MoveAction);
                }

                onExited: {
                    delegateItem.isDropTarget = false;
                }

                onDropped: (drop) => {
                    delegateItem.isDropTarget = false;
                    let noteUri = "";
                    if (drop.keys.indexOf("application/x-marknote-note") !== -1) {
                        noteUri = drop.getDataAsString("application/x-marknote-note");
                    } else if (drop.keys.indexOf("text/uri-list") !== -1) {
                        noteUri = drop.getDataAsString("text/uri-list").split("\n")[0].trim();
                    }
                    root.moveInto(noteUri, dropArea.destination);
                    drop.acceptProposedAction();
                }
            }

            ContextMenu.onRequested: (position) => delegateItem.openContextMenu()

            contentItem: RowLayout {
                spacing: Kirigami.Units.smallSpacing

                KTreeView.TreeViewDecoration {
                    Layout.fillHeight: true
                    Layout.topMargin: -delegateItem.topPadding
                    Layout.bottomMargin: -delegateItem.bottomPadding

                    model: notesProxyModel
                    parentDelegate: delegateItem
                    index: delegateItem.index

                    kDescendantLevel: delegateItem.visualLevel
                    kDescendantHasSiblings: delegateItem.kDescendantHasSiblings
                    kDescendantExpandable: delegateItem.kDescendantExpandable
                    kDescendantExpanded: delegateItem.kDescendantExpanded
                }

                // Note/folder icon: an emoji, a chosen theme icon, or the default.
                Item {
                    Layout.preferredWidth: delegateItem.compact ? Kirigami.Units.iconSizes.small : Kirigami.Units.iconSizes.smallMedium
                    Layout.preferredHeight: delegateItem.compact ? Kirigami.Units.iconSizes.small : Kirigami.Units.iconSizes.smallMedium
                    Layout.alignment: delegateItem.compact ? Qt.AlignVCenter : Qt.AlignTop
                    Layout.topMargin: delegateItem.compact ? 0 : Math.max(0, (renameField.implicitHeight - height) / 2)

                    Label {
                        anchors.centerIn: parent
                        visible: delegateItem.noteIconIsEmoji
                        text: delegateItem.noteIcon
                        font.pixelSize: Kirigami.Units.iconSizes.small
                        textFormat: Text.PlainText
                    }
                    Kirigami.Icon {
                        anchors.fill: parent
                        visible: !delegateItem.noteIconIsEmoji
                        source: delegateItem.noteIcon.length > 0 ? delegateItem.noteIcon
                              : (delegateItem.isFolder ? "folder" : "text-markdown")
                    }
                }

                ColumnLayout {
                    Layout.fillWidth: true
                    Layout.fillHeight: true
                    spacing: 0

                    Item{
                        id: textcolorItem
                        Kirigami.Theme.inherit: false
                        property color textcolor: Kirigami.Theme.textColor
                    }

                    RowLayout {
                        Layout.fillWidth: true
                        spacing: Kirigami.Units.smallSpacing

                        Label {
                            Layout.fillWidth: true
                            Layout.leftMargin: Kirigami.Units.smallSpacing
                            Layout.preferredHeight: delegateItem.compact ? -1 : renameField.implicitHeight
                            verticalAlignment: Text.AlignVCenter

                            text: delegateItem.name
                            elide: Qt.ElideRight
                            visible: !renameField.enabled
                            color: textcolorItem.textcolor
                            font.weight: delegateItem.isFolder ? Font.DemiBold : Font.Normal
                        }

                        Kirigami.ActionTextField {
                            id: renameField

                            Layout.fillWidth: true
                            Layout.leftMargin: Kirigami.Units.smallSpacing

                            text: delegateItem.name
                            visible: enabled
                            enabled: false
                            background.visible: enabled
                            topPadding: enabled ? Kirigami.Units.smallSpacing : 0
                            leftPadding: enabled ? Kirigami.Units.smallSpacing : 0
                            color: textcolorItem.textcolor

                            Keys.onReturnPressed: (event) => {
                                acceptedAction.trigger();
                                event.accepted = true;
                            }
                            Keys.onEnterPressed: (event) => {
                                acceptedAction.trigger();
                                event.accepted = true;
                            }
                            Keys.onEscapePressed: (event) => {
                                renameField.enabled = false;
                                event.accepted = true;
                            }

                            rightActions: [
                                Kirigami.Action {
                                    id: acceptedAction
                                    icon.name: "answer-correct"
                                    enabled: renameField.text.length > 0
                                    visible: renameField.enabled
                                    onTriggered: {
                                        if (renameField.text === delegateItem.name) {
                                            renameField.enabled = false;
                                            return;
                                        }

                                        delegateItem.isRenaming = true;
                                        renameField.enabled = false;
                                        const oldUrl = delegateItem.fileUrl;
                                        const renamedUrl = pageNotesModel.renameNote(oldUrl, renameField.text);

                                        if (renamedUrl && renamedUrl.toString().length > 0) {
                                            NavigationController.noteRenamed(oldUrl, renamedUrl);
                                        }
                                        Qt.callLater(() => {
                                            delegateItem.isRenaming = false;
                                        });
                                    }
                                }
                            ]
                        }


                        // Wide layout: tags and created date as columns on the same line.
                        Row {
                            visible: delegateItem.wide && delegateItem.showTags && !renameField.enabled
                            spacing: Kirigami.Units.smallSpacing / 2
                            Repeater {
                                model: delegateItem.wide ? delegateItem.tagList.slice(0, 3) : []
                                delegate: TagChip {
                                    required property string modelData
                                    tag: modelData
                                    selected: FilterState.tags.indexOf(modelData) !== -1
                                    onClicked: FilterState.toggleTag(modelData)
                                    ToolTip.visible: hovered
                                    ToolTip.text: KI18n.i18nc("@info:tooltip", "Filter by tag “%1”", modelData)
                                    ToolTip.delay: Kirigami.Units.toolTipDelay
                                }
                            }
                            Label {
                                visible: delegateItem.tagList.length > 3
                                text: "+" + (delegateItem.tagList.length - 3)
                                color: Kirigami.Theme.disabledTextColor
                            }
                        }

                        Label {
                            visible: delegateItem.wide && delegateItem.showCreated && !renameField.enabled
                            text: delegateItem.createdText
                            color: Kirigami.Theme.disabledTextColor
                            font.pointSize: Kirigami.Theme.smallFont.pointSize
                            horizontalAlignment: Text.AlignRight
                            Layout.preferredWidth: Kirigami.Units.gridUnit * 6
                            elide: Text.ElideRight
                        }
                    }

                    // Narrow layout: created date and tags on a fixed-height second line
                    // (never wraps, so row heights stay stable while filtering).
                    Row {
                        visible: !delegateItem.wide && !delegateItem.compact && (delegateItem.showCreated || delegateItem.showTags)
                        Layout.fillWidth: true
                        Layout.preferredHeight: Math.round(Kirigami.Units.gridUnit * 1.1)
                        Layout.leftMargin: Kirigami.Units.smallSpacing
                        Layout.bottomMargin: Kirigami.Units.smallSpacing
                        spacing: Kirigami.Units.smallSpacing
                        clip: true

                        Label {
                            visible: delegateItem.showCreated
                            text: delegateItem.createdText
                            color: Kirigami.Theme.disabledTextColor
                            font.pointSize: Kirigami.Theme.smallFont.pointSize
                            height: parent.height
                            verticalAlignment: Text.AlignVCenter
                        }
                        Repeater {
                            model: !delegateItem.wide && delegateItem.showTags ? delegateItem.tagList.slice(0, 2) : []
                            delegate: TagChip {
                                required property string modelData
                                tag: modelData
                                selected: FilterState.tags.indexOf(modelData) !== -1
                                onClicked: FilterState.toggleTag(modelData)
                            }
                        }
                        Label {
                            visible: !delegateItem.wide && delegateItem.showTags && delegateItem.tagList.length > 2
                            text: "+" + (delegateItem.tagList.length - 2)
                            color: Kirigami.Theme.disabledTextColor
                            font.pointSize: Kirigami.Theme.smallFont.pointSize
                            height: parent.height
                            verticalAlignment: Text.AlignVCenter
                        }
                    }
                }

                ToolButton{
                    id: menuButton
                    text: KI18n.i18nc("@action:button", "Show Menu")
                    icon.name: "overflow-menu"
                    down: pressed || ((menu.opened && menu.delegateItem === delegateItem) || (folderMenu.opened && folderMenu.delegateItem === delegateItem))
                    display: ToolButton.IconOnly

                    opacity: {Kirigami.Settings.isMobile ? 1 : delegateItem.hovered || down ? 1 : 0 }
                    Layout.maximumWidth: {Kirigami.Settings.isMobile ? implicitWidth : delegateItem.hovered || down ? implicitWidth : 0 }

                    Behavior on opacity {
                        PropertyAnimation {
                            duration: Kirigami.Units.shortDuration
                        }
                    }

                    onPressed: openMenu()
                    Keys.onReturnPressed: openMenu()
                    Keys.onEnterPressed: openMenu()

                    Layout.alignment: Qt.AlignHCenter
                    Layout.margins: 0
                    // Keep compact rows tight: the hidden menu button must not set the row height.
                    Layout.maximumHeight: delegateItem.compact ? Kirigami.Units.iconSizes.small + Kirigami.Units.smallSpacing : -1
                    icon.width: delegateItem.compact ? Kirigami.Units.iconSizes.small : Kirigami.Units.iconSizes.smallMedium
                    icon.height: delegateItem.compact ? Kirigami.Units.iconSizes.small : Kirigami.Units.iconSizes.smallMedium

                    Accessible.role: Accessible.ButtonMenu
                    Accessible.onPressAction: openMenu()

                    ToolTip.visible: hovered && !menu.visible && !folderMenu.visible
                    ToolTip.text: text
                    ToolTip.delay: Kirigami.Units.toolTipDelay

                    function openMenu(): void {
                        const target = delegateItem.isFolder ? folderMenu : menu;
                        target.delegateItem = delegateItem;
                        target.popup(this, Qt.point(0, height))
                    }
                }
            }

            onClicked: {
                // Ignore the click that a drag release or rename emits.
                if (dragHandler.active || delegateItem.isRenaming || renameField.enabled) {
                    return;
                }

                if (highlighted) {
                    root.pageStack.currentIndex = root.pageStack.depth - 1;
                    return;
                }

                notesList.currentIndex = delegateItem.index;

                if (delegateItem.kDescendantExpandable || delegateItem.isFolder) {
                    pageNotesModel.fetchMore(path);
                    notesProxyModel.toggleChildren(index);
                } else {
                    root.activateItem(index, false, path);
                }
            }

            highlighted: NavigationController.absoluteNotePath === delegateItem.normPath || delegateItem.isDropTarget
            readonly property real rowPadding: compact ? 1
                : density === 2 ? Kirigami.Units.largeSpacing
                : (wide ? Kirigami.Units.smallSpacing : Kirigami.Units.mediumSpacing)
            topPadding: rowPadding
            bottomPadding: rowPadding
            // RoundedItemDelegate enforces a 2-gridUnit minimum height; compact rows drop it.
            implicitHeight: compact
                ? implicitContentHeight + topPadding + bottomPadding + 2
                : Math.max(implicitBackgroundHeight + topInset + bottomInset,
                           implicitContentHeight + topPadding + bottomPadding,
                           Kirigami.Units.gridUnit * 2)
            topInset: compact ? 0 : Math.round(Kirigami.Units.smallSpacing / 2)
            bottomInset: compact ? 0 : Math.round(Kirigami.Units.smallSpacing / 2)
        }

        // Dropping on empty space moves the note to the top level of the notebook.
        DropArea {
            anchors.fill: parent
            z: -1
            keys: ["application/x-marknote-note"]
            onEntered: (drag) => drag.accept(Qt.MoveAction)
            onDropped: (drop) => {
                root.moveInto(drop.getDataAsString("application/x-marknote-note"), root.normRoot);
                drop.acceptProposedAction();
            }
        }

        Kirigami.PlaceholderMessage {
            anchors.centerIn: parent
            width: defaultPlaceholderWidth
            icon.name: "note-symbolic"
            visible: notesList.count === 0 && root.currentSearchText.length === 0
            text: KI18n.i18n("Add a note!")
            helpfulAction: newNoteAction
        }

        Kirigami.PlaceholderMessage {
            anchors.centerIn: parent
            width: defaultPlaceholderWidth
            icon.name: "edit-none-symbolic"
            visible: filterModel.count === 0 && FilterState.active
            text: KI18n.i18n("No notes match the filter")
            helpfulAction: Kirigami.Action {
                icon.name: "edit-clear-all"
                text: KI18n.i18nc("@action:button", "Clear Filter")
                onTriggered: FilterState.clear()
            }
        }
    }

    NoteInlineStatusBar {
        id: inlineStatusBar
        parent: root
        hoverTarget: notesList
        // Sit above the filter bar instead of on top of it.
        anchors.bottomMargin: filterBar.visible ? filterBar.height : -background.border.width

        text: {
            const noteCount = pageNotesModel.totalNotesCount;
            const folderCount = pageNotesModel.totalFoldersCount;

            if (noteCount === 0 && folderCount === 0) return "";

            if (folderCount === 0) {
                return KI18n.i18ncp("@info:status", "%1 note", "%1 notes", noteCount);
            }

            if (noteCount === 0) {
                return KI18n.i18ncp("@info:status", "%1 folder", "%1 folders", folderCount);
            }

            const folderText = KI18n.i18ncp("@info:status", "%1 folder", "%1 folders", folderCount);
            const noteText = KI18n.i18ncp("@info:status", "%1 note", "%1 notes", noteCount);

            return KI18n.i18nc("@info:status", "%1, %2", folderText, noteText);
        }
    }
}
