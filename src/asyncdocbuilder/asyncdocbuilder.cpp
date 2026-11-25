// SPDX-FileCopyrightText: 2026 Prayag Jain <prayagjain2@gmail.com>
// SPDX-License-Identifier: LGPL-3.0-or-later

#include "asyncdocbuilder.h"

#include "crypto/vaults.h"
#include "mdtreemodel/treeitem.h"
#include "notemetadata/frontmatter.h"

#include <QFile>
#include <QFileInfo>
#include <QFutureWatcher>
#include <QTextStream>
#include <QtConcurrent/QtConcurrentRun>

AsyncDocBuilder::AsyncDocBuilder(QObject *parent)
    : QObject(parent)
{
}

AsyncDocBuilder::~AsyncDocBuilder() = default;

void AsyncDocBuilder::loadDocument(const QString &filePath)
{
    QFutureWatcher<DocPointer> *watcher = new QFutureWatcher<DocPointer>(this);

    connect(watcher, &QFutureWatcher<DocPointer>::finished, this, [this, watcher]() {
        Q_EMIT documentReady(watcher->result());
        watcher->deleteLater();
    });

    QFuture<DocPointer> future = QtConcurrent::run(&AsyncDocBuilder::parseDocument, filePath);
    watcher->setFuture(future);
}

void AsyncDocBuilder::parseDocument(QPromise<DocPointer> &promise, const QString &filePath)
{
    MD::Parser parser;

    // Encrypted notes are decrypted here; a locked one opens empty (and is
    // never saved: NoteIO refuses to write into a locked notebook).
    QString text;
    if (NoteIO::read(filePath, &text) == NoteIO::Status::Error && !QFile::exists(filePath)) {
        promise.addResult(parser.parse(filePath, false));
        return;
    }

    // Front matter (id, created, icon, tags) is note metadata, not content:
    // keep it out of the block editor. MDTreeModel::saveToFile puts it back.
    const FrontMatter::Split parts = FrontMatter::split(text);
    QByteArray body = parts.body.toUtf8();
    QTextStream stream(&body);
    stream.setEncoding(QStringConverter::Utf8);

    const QFileInfo info(filePath);
    auto doc = parser.parse(stream, info.absolutePath(), info.fileName());
    TreeItem::groupSpecialBlocks(doc, parts.body);

    promise.addResult(doc);
}
