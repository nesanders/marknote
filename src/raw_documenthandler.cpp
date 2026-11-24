// SPDX-FileCopyrightText: 2026 Siddharth Chopra <contact.sid.chopra@gmail.com>
// SPDX-License-Identifier: GPL-2.0-only OR GPL-3.0-only OR LicenseRef-KDE-Accepted-GPL

#include "raw_documenthandler.h"
#include "crypto/vaults.h"

#include <KColorScheme>
#include <KLocalizedString>
#include <KStandardShortcut>

#include <QAbstractTextDocumentLayout>
#include <QClipboard>
#include <QCryptographicHash>
#include <QDesktopServices>
#include <QFile>
#include <QFileInfo>
#include <QGuiApplication>
#include <QMimeData>
#include <QMimeDatabase>
#include <QPalette>
#include <QQmlFile>
#include <QRegularExpression>
#include <QTextBlock>
#include <QTextCharFormat>
#include <QTextCursor>
#include <QTextDocument>

using namespace Qt::StringLiterals;

RawDocumentHandler::RawDocumentHandler(QObject *parent)
    : DocumentHandler(parent)
{
    m_document = nullptr;
    m_textArea = nullptr;
    m_cursorPosition = -1;
    m_selectionStart = 0;
    m_selectionEnd = 0;
}

void RawDocumentHandler::load(const QUrl &fileUrl)
{
    if (fileUrl == m_fileUrl)
        return;

    if (!QFile::exists(fileUrl.toLocalFile()))
        return;

    m_fileUrl = fileUrl;
    Q_EMIT fileUrlChanged();

    // A note in a locked notebook (or an unreadable one) opens empty, so no
    // earlier plaintext stays on screen. NoteIO refuses to save it.
    QString content;
    if (NoteIO::read(fileUrl.toLocalFile(), &content) != NoteIO::Status::Ok)
        content.clear();

    if (QTextDocument *doc = textDocument()) {
        doc->setUndoRedoEnabled(false);


        Q_EMIT loaded(content, Qt::PlainText);

        doc->setModified(false);
        doc->clearUndoRedoStacks();
        doc->setUndoRedoEnabled(true);
    }

    QTextCursor cursor = textCursor();
    cursor.movePosition(QTextCursor::End);
    moveCursor(cursor.position());
    reset();
}

void RawDocumentHandler::saveAs(const QUrl &fileUrl)
{
    QTextDocument *doc = textDocument();
    if (!doc)
        return;

    QString writeError;
    if (!NoteIO::write(fileUrl.toLocalFile(), doc->toPlainText(), &writeError)) {
        Q_EMIT error(tr("Cannot save: ") + writeError + u' ' + fileUrl.toLocalFile());
        return;
    }

    if (fileUrl == m_fileUrl)
        return;
    m_fileUrl = fileUrl;
    Q_EMIT fileUrlChanged();
}

void RawDocumentHandler::reset()
{
}

void RawDocumentHandler::pasteFromClipboard()
{
    const QMimeData *mimeData = QGuiApplication::clipboard()->mimeData();
    if (!mimeData) {
        return;
    }

    QTextCursor cursor = textCursor();
    cursor.beginEditBlock();

    if (mimeData->hasFormat(QStringLiteral("text/markdown"))) {
        const QByteArray md = mimeData->data(QStringLiteral("text/markdown"));
        cursor.insertText(QString::fromUtf8(md));
    } else if (mimeData->hasText()) {
        cursor.insertText(mimeData->text());
    }

    cursor.endEditBlock();
}

#include "moc_raw_documenthandler.cpp"
