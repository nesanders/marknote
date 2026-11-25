// SPDX-FileCopyrightText: 2026 Marknote fork contributors
// SPDX-License-Identifier: GPL-2.0-only OR GPL-3.0-only OR LicenseRef-KDE-Accepted-GPL

#pragma once

#include "mdtreemodel/mdtreemodel.h"
#include <QUndoCommand>

/// Replaces the markdown of a to-do block (an item ticked, a date set, …).
class EditTodoCommand : public QUndoCommand
{
public:
    EditTodoCommand(TreeItem *block, const QString &newMarkdown, MDTreeModel *model, QUndoCommand *parent = nullptr);

    void undo() override;
    void redo() override;

private:
    MDTreeModel *m_model;
    TreeItem *m_block;
    QString m_oldMarkdown;
    QString m_newMarkdown;
};
