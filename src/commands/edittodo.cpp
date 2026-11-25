// SPDX-FileCopyrightText: 2026 Marknote fork contributors
// SPDX-License-Identifier: GPL-2.0-only OR GPL-3.0-only OR LicenseRef-KDE-Accepted-GPL

#include "edittodo.h"

EditTodoCommand::EditTodoCommand(TreeItem *block, const QString &newMarkdown, MDTreeModel *model, QUndoCommand *parent)
    : QUndoCommand(parent)
    , m_model(model)
    , m_block(block)
    , m_oldMarkdown(block->todoMarkdown())
    , m_newMarkdown(newMarkdown)
{
}

void EditTodoCommand::undo()
{
    m_model->setTodoMD(m_block, m_oldMarkdown);
}

void EditTodoCommand::redo()
{
    m_model->setTodoMD(m_block, m_newMarkdown);
}
