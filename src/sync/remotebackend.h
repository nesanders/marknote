// SPDX-FileCopyrightText: 2026 Marknote fork contributors
// SPDX-License-Identifier: GPL-2.0-only OR GPL-3.0-only OR LicenseRef-KDE-Accepted-GPL

#pragma once

#include <QByteArray>
#include <QDateTime>
#include <QHash>
#include <QString>

namespace Sync
{

/// A file or folder on a sync destination, addressed by its path relative to
/// the notebook root ("Folder/Note.md", always '/'-separated).
struct RemoteFile {
    QString path;
    QString id; ///< backend-specific handle (Drive file id, absolute path, …)
    QByteArray md5; ///< hex MD5 of the content; empty for folders
    QDateTime modified;
    bool isFolder = false;
};

/**
 * A place a notebook syncs to.
 *
 * The interface is deliberately blocking: the sync engine runs on a worker
 * thread and calls these one after another. Implementations report failures
 * by returning false and filling @p error with a user-readable message.
 */
class RemoteBackend
{
public:
    virtual ~RemoteBackend() = default;

    /// Short user-visible name, e.g. "Google Drive".
    virtual QString displayName() const = 0;

    /// Every file and folder under the destination root, keyed by relative path.
    virtual bool listAll(QHash<QString, RemoteFile> *out, QString *error) = 0;

    virtual bool download(const RemoteFile &file, QByteArray *data, QString *error) = 0;

    /// Create or replace the file at @p path (parent folders are created as
    /// needed). @p existing is the current remote entry when replacing.
    virtual bool upload(const QString &path, const QByteArray &data, const RemoteFile *existing, RemoteFile *result, QString *error) = 0;

    virtual bool createFolder(const QString &path, RemoteFile *result, QString *error) = 0;

    /// Delete recoverably where the destination supports it (Drive: trash).
    virtual bool remove(const RemoteFile &file, QString *error) = 0;
};

} // namespace Sync
