// SPDX-FileCopyrightText: 2026 Prayag Jain <prayagjain2@gmail.com>
// SPDX-License-Identifier: LGPL-3.0-or-later

import QtQuick
import QtQuick.Controls as QQC2

import org.kde.marknote

QQC2.Menu {
    id: root
    
    // Holds the reference to the block that was right-clicked
    property var currentBlock: null

    // The checklist the clicked block is in, when it can become a to-do block.
    property var checklist: null

    onAboutToShow: root.checklist = CommandManager.checklistForTodo(root.currentBlock)

    QQC2.MenuItem {
        action: EditorActions.copyAction
    }

    QQC2.MenuItem {
        text: i18nc("@action:inmenu", "Make To-Do Block")
        icon.name: "checkbox"
        visible: root.checklist !== null
        height: visible ? implicitHeight : 0
        onTriggered: CommandManager.makeTodoBlock(root.checklist)
    }

    QQC2.MenuItem {
        action: EditorActions.deleteBlockAction
    }
}
