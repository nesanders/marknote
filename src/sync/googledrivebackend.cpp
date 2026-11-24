// SPDX-FileCopyrightText: 2026 Marknote fork contributors
// SPDX-License-Identifier: GPL-2.0-only OR GPL-3.0-only OR LicenseRef-KDE-Accepted-GPL

#include "googledrivebackend.h"

#include <QEventLoop>
#include <QJsonArray>
#include <QJsonDocument>
#include <QNetworkAccessManager>
#include <QNetworkReply>
#include <QQueue>
#include <QRandomGenerator>
#include <QThread>
#include <QUrlQuery>

using namespace Qt::StringLiterals;

namespace Sync
{

namespace
{
const auto fileFields = u"id,name,mimeType,md5Checksum,modifiedTime"_s;
}

GoogleDriveBackend::GoogleDriveBackend(const QString &rootFolderPath, TokenProvider tokens, const QString &apiBase)
    : m_rootPath(rootFolderPath)
    , m_tokens(std::move(tokens))
    , m_apiBase(apiBase)
{
    while (m_apiBase.endsWith(u'/')) {
        m_apiBase.chop(1);
    }
}

GoogleDriveBackend::~GoogleDriveBackend() = default;

QString GoogleDriveBackend::displayName() const
{
    return u"Google Drive"_s;
}

QString GoogleDriveBackend::rootFolderId() const
{
    return m_folderIds.value(QString());
}

void GoogleDriveBackend::setTimeout(int ms)
{
    m_timeoutMs = ms;
}

QUrl GoogleDriveBackend::apiUrl(const QString &path) const
{
    return QUrl(m_apiBase + path);
}

QString GoogleDriveBackend::escapeQuery(const QString &value)
{
    QString v = value;
    v.replace(u"\\"_s, u"\\\\"_s).replace(u"'"_s, u"\\'"_s);
    return v;
}

RemoteFile GoogleDriveBackend::toRemoteFile(const QJsonObject &json, const QString &relativePath)
{
    RemoteFile rf;
    rf.path = relativePath;
    rf.id = json.value(u"id"_s).toString();
    rf.md5 = json.value(u"md5Checksum"_s).toString().toLatin1();
    rf.modified = QDateTime::fromString(json.value(u"modifiedTime"_s).toString(), Qt::ISODateWithMs);
    rf.isFolder = json.value(u"mimeType"_s).toString() == QLatin1String(FolderMimeType);
    return rf;
}

GoogleDriveBackend::Reply GoogleDriveBackend::send(const QByteArray &verb, const QUrl &url, const QByteArray &body, const QByteArray &contentType, QString *error)
{
    if (!m_nam) {
        m_nam = std::make_unique<QNetworkAccessManager>();
    }
    bool refreshed = false;
    bool retried = false;
    while (true) {
        if (m_token.isEmpty()) {
            m_token = m_tokens(false, error);
            if (m_token.isEmpty()) {
                return {0, {}, error->isEmpty() ? u"Not signed in to Google"_s : *error};
            }
        }
        QNetworkRequest request(url);
        request.setRawHeader("Authorization", "Bearer " + m_token.toUtf8());
        if (!contentType.isEmpty()) {
            request.setHeader(QNetworkRequest::ContentTypeHeader, contentType);
        }
        request.setTransferTimeout(m_timeoutMs);

        QNetworkReply *reply = m_nam->sendCustomRequest(request, verb, body);
        QEventLoop loop;
        QObject::connect(reply, &QNetworkReply::finished, &loop, &QEventLoop::quit);
        loop.exec();

        Reply result;
        result.status = reply->attribute(QNetworkRequest::HttpStatusCodeAttribute).toInt();
        result.body = reply->readAll();
        if (reply->error() != QNetworkReply::NoError && result.status == 0) {
            result.networkError = reply->errorString();
        }
        reply->deleteLater();

        if (result.status == 401 && !refreshed) {
            refreshed = true;
            m_token = m_tokens(true, error);
            if (m_token.isEmpty()) {
                result.networkError = error->isEmpty() ? u"Google sign-in expired; sign in again"_s : *error;
                return result;
            }
            continue;
        }
        if ((result.status == 429 || result.status >= 500 || result.status == 0) && !retried) {
            retried = true;
            QThread::msleep(1500);
            continue;
        }
        return result;
    }
}

bool GoogleDriveBackend::checkJson(const Reply &reply, QJsonObject *json, const QString &what, QString *error)
{
    if (!reply.networkError.isEmpty()) {
        *error = u"%1: %2"_s.arg(what, reply.networkError);
        return false;
    }
    if (reply.status < 200 || reply.status >= 300) {
        const QJsonObject err = QJsonDocument::fromJson(reply.body).object().value(u"error"_s).toObject();
        const QString message = err.value(u"message"_s).toString();
        *error = u"%1: HTTP %2%3"_s.arg(what).arg(reply.status).arg(message.isEmpty() ? QString() : u" – "_s + message);
        return false;
    }
    if (json) {
        *json = QJsonDocument::fromJson(reply.body).object();
    }
    return true;
}

bool GoogleDriveBackend::findChildFolder(const QString &parentId, const QString &name, QString *id, QString *error)
{
    QUrl url = apiUrl(u"/drive/v3/files"_s);
    QUrlQuery query;
    query.addQueryItem(u"q"_s,
                       u"name = '%1' and '%2' in parents and mimeType = '%3' and trashed = false"_s.arg(escapeQuery(name),
                                                                                                         escapeQuery(parentId),
                                                                                                         QLatin1String(FolderMimeType)));
    query.addQueryItem(u"fields"_s, u"files(id,name)"_s);
    query.addQueryItem(u"spaces"_s, u"drive"_s);
    url.setQuery(query);
    QJsonObject json;
    if (!checkJson(send("GET", url, {}, {}, error), &json, u"Looking up folder “%1”"_s.arg(name), error)) {
        return false;
    }
    const QJsonArray files = json.value(u"files"_s).toArray();
    *id = files.isEmpty() ? QString() : files.first().toObject().value(u"id"_s).toString();
    return true;
}

bool GoogleDriveBackend::createFolderIn(const QString &parentId, const QString &name, QString *id, QString *error)
{
    const QJsonObject metadata{
        {u"name"_s, name},
        {u"mimeType"_s, QLatin1String(FolderMimeType)},
        {u"parents"_s, QJsonArray{parentId}},
    };
    QUrl url = apiUrl(u"/drive/v3/files"_s);
    url.setQuery(u"fields=id"_s);
    QJsonObject json;
    if (!checkJson(send("POST", url, QJsonDocument(metadata).toJson(QJsonDocument::Compact), "application/json; charset=UTF-8", error),
                   &json,
                   u"Creating folder “%1”"_s.arg(name),
                   error)) {
        return false;
    }
    *id = json.value(u"id"_s).toString();
    return !id->isEmpty();
}

bool GoogleDriveBackend::ensureRoot(QString *error)
{
    if (m_folderIds.contains(QString())) {
        return true;
    }
    QString parent = u"root"_s;
    for (const QString &segment : m_rootPath.split(u'/', Qt::SkipEmptyParts)) {
        QString id;
        if (!findChildFolder(parent, segment, &id, error)) {
            return false;
        }
        if (id.isEmpty() && !createFolderIn(parent, segment, &id, error)) {
            return false;
        }
        parent = id;
    }
    m_folderIds.insert(QString(), parent);
    return true;
}

bool GoogleDriveBackend::ensureFolder(const QString &relativePath, QString *id, QString *error)
{
    if (!ensureRoot(error)) {
        return false;
    }
    if (m_folderIds.contains(relativePath)) {
        *id = m_folderIds.value(relativePath);
        return true;
    }
    const qsizetype slash = relativePath.lastIndexOf(u'/');
    const QString parentPath = slash < 0 ? QString() : relativePath.left(slash);
    const QString name = relativePath.mid(slash + 1);
    QString parentId;
    if (!ensureFolder(parentPath, &parentId, error)) {
        return false;
    }
    QString found;
    if (!findChildFolder(parentId, name, &found, error)) {
        return false;
    }
    if (found.isEmpty() && !createFolderIn(parentId, name, &found, error)) {
        return false;
    }
    m_folderIds.insert(relativePath, found);
    *id = found;
    return true;
}

bool GoogleDriveBackend::listAll(QHash<QString, RemoteFile> *out, QString *error)
{
    m_folderIds.clear();
    if (!ensureRoot(error)) {
        return false;
    }
    QQueue<std::pair<QString, QString>> pending; // (folder id, relative path)
    pending.enqueue({rootFolderId(), QString()});
    while (!pending.isEmpty()) {
        const auto [folderId, folderPath] = pending.dequeue();
        QString pageToken;
        do {
            QUrl url = apiUrl(u"/drive/v3/files"_s);
            QUrlQuery query;
            query.addQueryItem(u"q"_s, u"'%1' in parents and trashed = false"_s.arg(escapeQuery(folderId)));
            query.addQueryItem(u"fields"_s, u"nextPageToken,files(%1)"_s.arg(fileFields));
            query.addQueryItem(u"pageSize"_s, u"1000"_s);
            query.addQueryItem(u"spaces"_s, u"drive"_s);
            if (!pageToken.isEmpty()) {
                query.addQueryItem(u"pageToken"_s, pageToken);
            }
            url.setQuery(query);
            QJsonObject json;
            if (!checkJson(send("GET", url, {}, {}, error), &json, u"Listing Google Drive"_s, error)) {
                return false;
            }
            for (const QJsonValue &v : json.value(u"files"_s).toArray()) {
                const QJsonObject f = v.toObject();
                const QString name = f.value(u"name"_s).toString();
                const QString mime = f.value(u"mimeType"_s).toString();
                if (name.isEmpty() || name.contains(u'/') || name == u"."_s || name == u".."_s) {
                    continue; // cannot be mapped to a file name
                }
                if (mime.startsWith(u"application/vnd.google-apps."_s) && mime != QLatin1String(FolderMimeType)) {
                    continue; // Google Docs/Sheets have no file content to sync
                }
                const QString rel = folderPath.isEmpty() ? name : folderPath + u'/' + name;
                if (out->contains(rel)) {
                    continue; // Drive allows duplicate names; the first one wins
                }
                const RemoteFile rf = toRemoteFile(f, rel);
                out->insert(rel, rf);
                if (rf.isFolder) {
                    m_folderIds.insert(rel, rf.id);
                    pending.enqueue({rf.id, rel});
                }
            }
            pageToken = json.value(u"nextPageToken"_s).toString();
        } while (!pageToken.isEmpty());
    }
    return true;
}

bool GoogleDriveBackend::download(const RemoteFile &file, QByteArray *data, QString *error)
{
    QUrl url = apiUrl(u"/drive/v3/files/"_s + file.id);
    url.setQuery(u"alt=media"_s);
    const Reply reply = send("GET", url, {}, {}, error);
    if (!checkJson(reply, nullptr, u"Downloading “%1”"_s.arg(file.path), error)) {
        return false;
    }
    *data = reply.body;
    return true;
}

bool GoogleDriveBackend::upload(const QString &path, const QByteArray &data, const RemoteFile *existing, RemoteFile *result, QString *error)
{
    QJsonObject json;
    if (existing && !existing->id.isEmpty()) {
        QUrl url = apiUrl(u"/upload/drive/v3/files/"_s + existing->id);
        url.setQuery(u"uploadType=media&fields="_s + fileFields);
        if (!checkJson(send("PATCH", url, data, "application/octet-stream", error), &json, u"Uploading “%1”"_s.arg(path), error)) {
            return false;
        }
    } else {
        const qsizetype slash = path.lastIndexOf(u'/');
        QString parentId;
        if (!ensureFolder(slash < 0 ? QString() : path.left(slash), &parentId, error)) {
            return false;
        }
        const QJsonObject metadata{
            {u"name"_s, path.mid(slash + 1)},
            {u"parents"_s, QJsonArray{parentId}},
        };
        const QByteArray boundary = "marknote-" + QByteArray::number(QRandomGenerator::global()->generate64(), 16);
        QByteArray body;
        body += "--" + boundary + "\r\nContent-Type: application/json; charset=UTF-8\r\n\r\n";
        body += QJsonDocument(metadata).toJson(QJsonDocument::Compact);
        body += "\r\n--" + boundary + "\r\nContent-Type: application/octet-stream\r\n\r\n";
        body += data;
        body += "\r\n--" + boundary + "--\r\n";
        QUrl url = apiUrl(u"/upload/drive/v3/files"_s);
        url.setQuery(u"uploadType=multipart&fields="_s + fileFields);
        if (!checkJson(send("POST", url, body, "multipart/related; boundary=" + boundary, error), &json, u"Uploading “%1”"_s.arg(path), error)) {
            return false;
        }
    }
    *result = toRemoteFile(json, path);
    return true;
}

bool GoogleDriveBackend::createFolder(const QString &path, RemoteFile *result, QString *error)
{
    QString id;
    if (!ensureFolder(path, &id, error)) {
        return false;
    }
    result->path = path;
    result->id = id;
    result->isFolder = true;
    return true;
}

bool GoogleDriveBackend::remove(const RemoteFile &file, QString *error)
{
    QUrl url = apiUrl(u"/drive/v3/files/"_s + file.id);
    url.setQuery(u"fields=id"_s);
    if (!checkJson(send("PATCH", url, R"({"trashed":true})", "application/json; charset=UTF-8", error),
                   nullptr,
                   u"Moving “%1” to the Google Drive trash"_s.arg(file.path),
                   error)) {
        return false;
    }
    if (file.isFolder) {
        for (auto it = m_folderIds.begin(); it != m_folderIds.end();) {
            it = (it.key() == file.path || it.key().startsWith(file.path + u'/')) ? m_folderIds.erase(it) : std::next(it);
        }
    }
    return true;
}

} // namespace Sync
