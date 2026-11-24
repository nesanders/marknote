// SPDX-FileCopyrightText: 2026 Marknote fork contributors
// SPDX-License-Identifier: GPL-2.0-only OR GPL-3.0-only OR LicenseRef-KDE-Accepted-GPL

#pragma once

#include "remotebackend.h"

#include <QHash>
#include <QJsonObject>
#include <QNetworkRequest>
#include <QString>

#include <functional>
#include <memory>

class QNetworkAccessManager;
class QNetworkReply;

namespace Sync
{

/**
 * Google Drive (API v3) sync destination.
 *
 * The notebook is mirrored into a folder path below "My Drive", for example
 * "Marknote/Projects"; missing folders are created. With the drive.file scope
 * Marknote only sees what it created itself, so this is the only place it
 * reads or writes. Deleted files go to the Drive trash.
 *
 * Blocking: requests run a local event loop, so use it from one worker thread
 * (the QNetworkAccessManager is created in the thread of the first call).
 */
class GoogleDriveBackend : public RemoteBackend
{
public:
    /// Returns a current OAuth access token; @p forceRefresh after a 401.
    using TokenProvider = std::function<QString(bool forceRefresh, QString *error)>;

    static constexpr auto DefaultApiBase = "https://www.googleapis.com";
    static constexpr auto FolderMimeType = "application/vnd.google-apps.folder";

    GoogleDriveBackend(const QString &rootFolderPath, TokenProvider tokens, const QString &apiBase = QString::fromLatin1(DefaultApiBase));
    ~GoogleDriveBackend() override;

    QString displayName() const override;
    bool listAll(QHash<QString, RemoteFile> *out, QString *error) override;
    bool download(const RemoteFile &file, QByteArray *data, QString *error) override;
    bool upload(const QString &path, const QByteArray &data, const RemoteFile *existing, RemoteFile *result, QString *error) override;
    bool createFolder(const QString &path, RemoteFile *result, QString *error) override;
    bool remove(const RemoteFile &file, QString *error) override;

    /// Id of the notebook's root folder on Drive (after a successful call).
    QString rootFolderId() const;

    /// Per-request timeout in milliseconds (default 60 s).
    void setTimeout(int ms);

private:
    struct Reply {
        int status = 0;
        QByteArray body;
        QString networkError;
    };

    /// Send with auth; refresh the token once on 401, retry once on 429/5xx.
    Reply send(const QByteArray &verb, const QUrl &url, const QByteArray &body, const QByteArray &contentType, QString *error);
    bool checkJson(const Reply &reply, QJsonObject *json, const QString &what, QString *error);

    bool ensureRoot(QString *error);
    /// Id of a folder path relative to the root ("" = root), creating it if needed.
    bool ensureFolder(const QString &relativePath, QString *id, QString *error);
    bool findChildFolder(const QString &parentId, const QString &name, QString *id, QString *error);
    bool createFolderIn(const QString &parentId, const QString &name, QString *id, QString *error);

    QUrl apiUrl(const QString &path) const;
    static QString escapeQuery(const QString &value);
    static RemoteFile toRemoteFile(const QJsonObject &json, const QString &relativePath);

    QString m_rootPath;
    TokenProvider m_tokens;
    QString m_apiBase;
    QString m_token;
    int m_timeoutMs = 60000;
    std::unique_ptr<QNetworkAccessManager> m_nam;
    QHash<QString, QString> m_folderIds; ///< relative folder path -> Drive id ("" = root)
};

} // namespace Sync
