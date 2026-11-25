// SPDX-FileCopyrightText: 2026 Marknote fork contributors
// SPDX-License-Identifier: GPL-2.0-only OR GPL-3.0-only OR LicenseRef-KDE-Accepted-GPL

#pragma once

#include <QObject>
#include <QString>
#include <QUrl>
#include <QVariantMap>
#include <QtQmlIntegration/qqmlintegration.h>

#include <optional>

/// File attachments (docs/attachments.md): a paragraph that is only
/// "[📎 Name](relative/file)" is shown as a card. The file lives next to the
/// note. This mirrors web/src/attachments.js.
namespace Attachments
{
struct Attachment {
    QString name; ///< the text after "📎 ", or the file name
    QString href; ///< the link target as written (without <>)
    QString path; ///< href URL-decoded: the file, relative to the note's folder
};

/// Whether a link target can be an attachment: a relative path to a file that is not a note.
bool isTarget(const QString &href);

/// The attachment a paragraph's markdown is, if it is one.
std::optional<Attachment> parse(const QString &markdown);

/// @p fileName URL-encoded for a link target.
QString encodePath(const QString &fileName);

/// The markdown for an attached file: "[📎 name](link)".
QString markdown(const QString &name, const QString &link);

/// A free file name in @p dir for @p fileName: itself, or "Name (2).ext", "Name (3).ext", …
QString uniqueName(const QString &dir, const QString &fileName);

/// Copies @p source next to the note @p notePath (keeping its name, numbered
/// if taken) and returns the attachment markdown, or an empty string on error.
QString attach(const QString &notePath, const QString &source, QString *error = nullptr);
}

/// What the attachment card and the Insert › File… action need, for QML.
class AttachmentHelper : public QObject
{
    Q_OBJECT
    QML_ELEMENT
    QML_SINGLETON

public:
    explicit AttachmentHelper(QObject *parent = nullptr);

    /// For the card of the attachment @p markdown in the note @p note:
    /// {valid, name, href, path, url, folderUrl, exists, size, sizeText,
    ///  iconName, kind, driveId, driveUrl, downloadUrl, syncsToGoogle}
    Q_INVOKABLE QVariantMap info(const QUrl &note, const QString &markdown) const;

    /// Copies @p file next to @p note; returns the attachment markdown or "" (see statusMessage).
    Q_INVOKABLE QString attach(const QUrl &note, const QUrl &file);

Q_SIGNALS:
    void statusMessage(const QString &message);
};
