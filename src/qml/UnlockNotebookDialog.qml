// SPDX-FileCopyrightText: 2026 Marknote fork contributors
// SPDX-License-Identifier: GPL-2.0-only OR GPL-3.0-only OR LicenseRef-KDE-Accepted-GPL

import QtQuick
import QtQuick.Controls as Controls
import QtQuick.Layouts
import org.kde.kirigami as Kirigami
import org.kde.ki18n
import org.kde.marknote

Kirigami.Dialog {
    id: root

    required property string notebookPath
    property string notebookName: ""

    title: KI18n.i18nc("@title:window %1 is a notebook name", "Unlock “%1”", notebookName)
    preferredWidth: Kirigami.Units.gridUnit * 22
    padding: Kirigami.Units.largeSpacing
    standardButtons: Kirigami.Dialog.NoButton

    onOpened: form.focusField()
    onClosed: destroy()

    UnlockForm {
        id: form
        notebookPath: root.notebookPath
        onUnlocked: root.close()
    }
}
