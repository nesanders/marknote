// SPDX-FileCopyrightText: 2023 Mathis Brüchert <mbb@kaidan.im>
// SPDX-FileCopyrightText: 2024 Carl Schwan <carl@carlschwan.eu>
// SPDX-License-Identifier: GPL-2.0-only OR GPL-3.0-only OR LicenseRef-KDE-Accepted-GPL

import QtQuick
import QtQuick.Controls as Controls

import org.kde.marknote
import org.kde.kirigami as Kirigami
import org.kde.kirigamiaddons.formcard as FormCard
import org.kde.ki18n

FormCard.FormCardDialog {
    id: root

    enum Mode {
        Edit,
        Add
    }

    property int mode: NoteMetadataDialog.Mode.Add
    property alias name: nameInput.text
    required property var model
    /// Folder to create the note/folder in; empty means the notebook root.
    property url parentFolder
    /// 0 = note, 1 = folder
    property int initialType: 0

    readonly property bool duplicateName: mode === NoteMetadataDialog.Mode.Add && nameInput.text.length > 0
        && !!root.model
        && root.model.existsIn(root.parentFolder, nameInput.text, typeSelector.selectedIndex === 1)

    title: mode === NotebookMetadataDialog.Mode.Add ? KI18n.i18nc("@title:window", "Add New") : KI18n.i18nc("@title:window", "Edit Note")
    standardButtons: Controls.Dialog.Save | Controls.Dialog.Cancel

    function updateSaveButton(): void {
        const saveButton = root.standardButton(Controls.Dialog.Save);
        if (saveButton) {
            saveButton.enabled = nameInput.text.length > 0 && !root.duplicateName;
        }
    }

    onOpened: {
        typeSelector.selectedIndex = root.initialType
        nameInput.forceActiveFocus()
        updateSaveButton()
    }

    onDuplicateNameChanged: updateSaveButton()

    onRejected: {
        root.close();
    }

    onClosed: {
        name = "";
    }

    onAccepted: {
        if (nameInput.text.length === 0 || root.duplicateName) {
            return;
        }
        if (mode === NoteMetadataDialog.Mode.Add) {
            if (typeSelector.selectedIndex === 0) {
                const createdPath = root.model.addNoteIn(root.parentFolder, root.name);
                if (createdPath.length === 0) {
                    return;
                }
                let notebookRoot = root.model.path;
                if (!notebookRoot.endsWith("/")) notebookRoot += "/";
                NavigationController.notePath = createdPath.startsWith(notebookRoot) ? createdPath.substring(notebookRoot.length) : root.name + '.md';
            } else if (typeSelector.selectedIndex === 1) {
                root.model.addFolderIn(root.parentFolder, root.name);
            }
        }

        close();
    }
    FormCard.FormRadioSelectorDelegate {
        id: typeSelector
        consistentWidth: true
          actions: [
              Kirigami.Action {
                  text: i18nc("@option:radio", "Note")
                  icon.name: "note-symbolic"
              },
              Kirigami.Action {
                  text: i18nc("@option:radio", "Folder")
                  icon.name: "folder-symbolic"
              }
          ]
    }
    FormCard.FormTextFieldDelegate {
        id: nameInput

        label: KI18n.i18nc("@label:textbox Note name", "Name:")
        validator: RegularExpressionValidator {
            regularExpression: /^[^./\\][^/\\]*$/
        }
        status: root.duplicateName ? Kirigami.MessageType.Error : Kirigami.MessageType.Information
        statusMessage: root.duplicateName ? KI18n.i18nc("@info", "A note or folder with this name already exists.") : ""
        onTextChanged: root.updateSaveButton()

        onAccepted: root.accepted()
    }
}
