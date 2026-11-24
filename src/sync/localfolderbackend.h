// SPDX-FileCopyrightText: 2026 Marknote fork contributors
// SPDX-License-Identifier: GPL-2.0-only OR GPL-3.0-only OR LicenseRef-KDE-Accepted-GPL

#pragma once

#include "remotebackend.h"

namespace Sync
{

/**
 * Sync destination that is another local folder (a mounted network share,
 * a Nextcloud/Syncthing folder, a USB stick, …). Deleted files are moved to
 * "<destination>/.marknote/trash/". Also the reference backend for tests.
 */
class LocalFolderBackend : public RemoteBackend
{
public:
    explicit LocalFolderBackend(const QString &rootPath);

    QString displayName() const override;
    bool listAll(QHash<QString, RemoteFile> *out, QString *error) override;
    bool download(const RemoteFile &file, QByteArray *data, QString *error) override;
    bool upload(const QString &path, const QByteArray &data, const RemoteFile *existing, RemoteFile *result, QString *error) override;
    bool createFolder(const QString &path, RemoteFile *result, QString *error) override;
    bool remove(const RemoteFile &file, QString *error) override;

private:
    QString m_root;
};

} // namespace Sync
