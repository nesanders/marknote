// SPDX-FileCopyrightText: 2026 Marknote fork contributors
// SPDX-License-Identifier: GPL-2.0-or-later

// Tests GoogleDriveBackend against an in-memory fake of the Drive v3 endpoints
// it uses, served locally with QHttpServer (no network access needed).

#include "../sync/googledrivebackend.h"
#include "../sync/syncengine.h"

#include <QCryptographicHash>
#include <QDir>
#include <QDirIterator>
#include <QFile>
#include <QHttpServer>
#include <QHttpServerRequest>
#include <QHttpServerResponse>
#include <QJsonArray>
#include <QJsonDocument>
#include <QJsonObject>
#include <QObject>
#include <QRegularExpression>
#include <QTcpServer>
#include <QTemporaryDir>
#include <QUrlQuery>
#include <QtTest/QtTest>

using namespace Qt::Literals::StringLiterals;
using namespace Sync;

namespace
{
const auto folderMime = u"application/vnd.google-apps.folder"_s;

struct Node {
    QString name;
    QString mime;
    QString parent;
    QByteArray content;
    bool trashed = false;
};
}

class FakeDrive
{
public:
    QHash<QString, Node> nodes;
    int nextId = 1;
    int pageSize = 2; // small, to exercise nextPageToken
    int unauthorizedCount = 0;
    bool rejectUploads = false;
    QHttpServer server;
    QTcpServer *tcp = new QTcpServer;

    FakeDrive()
    {
        using Method = QHttpServerRequest::Method;
        server.route(u"/drive/v3/files"_s, Method::Get | Method::Post, [this](const QHttpServerRequest &r) {
            return guard(r) ? (r.method() == Method::Get ? list(r) : createFolder(r)) : unauthorized();
        });
        server.route(u"/drive/v3/files/<arg>"_s, Method::Get | Method::Patch, [this](const QString &id, const QHttpServerRequest &r) {
            if (!guard(r)) {
                return unauthorized();
            }
            if (!nodes.contains(id)) {
                return QHttpServerResponse(QHttpServerResponse::StatusCode::NotFound);
            }
            if (r.method() == Method::Get) {
                return QHttpServerResponse("application/octet-stream"_ba, nodes[id].content);
            }
            const QJsonObject patch = QJsonDocument::fromJson(r.body()).object();
            if (patch.value(u"trashed"_s).toBool()) {
                nodes[id].trashed = true;
            }
            return QHttpServerResponse(meta(id));
        });
        server.route(u"/upload/drive/v3/files"_s, Method::Post, [this](const QHttpServerRequest &r) {
            if (!guard(r)) {
                return unauthorized();
            }
            if (rejectUploads) {
                return QHttpServerResponse(QJsonObject{{u"error"_s, QJsonObject{{u"message"_s, u"Quota exceeded"_s}}}},
                                           QHttpServerResponse::StatusCode::Forbidden);
            }
            return multipartCreate(r);
        });
        server.route(u"/upload/drive/v3/files/<arg>"_s, Method::Patch, [this](const QString &id, const QHttpServerRequest &r) {
            if (!guard(r)) {
                return unauthorized();
            }
            nodes[id].content = r.body();
            return QHttpServerResponse(meta(id));
        });
        QVERIFY(tcp->listen(QHostAddress::LocalHost));
        QVERIFY(server.bind(tcp));
    }

    QString base() const
    {
        return u"http://127.0.0.1:%1"_s.arg(tcp->serverPort());
    }

    bool guard(const QHttpServerRequest &r)
    {
        const QByteArray auth = r.headers().value(QHttpHeaders::WellKnownHeader::Authorization).toByteArray();
        if (auth != "Bearer good") {
            ++unauthorizedCount;
            return false;
        }
        return true;
    }

    static QHttpServerResponse unauthorized()
    {
        return QHttpServerResponse(QJsonObject{{u"error"_s, QJsonObject{{u"message"_s, u"Invalid Credentials"_s}}}},
                                   QHttpServerResponse::StatusCode::Unauthorized);
    }

    QJsonObject meta(const QString &id) const
    {
        const Node &n = nodes[id];
        QJsonObject o{{u"id"_s, id}, {u"name"_s, n.name}, {u"mimeType"_s, n.mime}, {u"modifiedTime"_s, u"2026-11-24T09:00:00.000Z"_s}};
        if (n.mime != folderMime) {
            o.insert(u"md5Checksum"_s, QString::fromLatin1(QCryptographicHash::hash(n.content, QCryptographicHash::Md5).toHex()));
        }
        return o;
    }

    QString add(const QString &name, const QString &mime, const QString &parent, const QByteArray &content = {})
    {
        const QString id = u"id"_s + QString::number(nextId++);
        nodes.insert(id, Node{name, mime, parent, content, false});
        return id;
    }

    QHttpServerResponse list(const QHttpServerRequest &r)
    {
        const QUrlQuery query(r.url());
        const QString q = query.queryItemValue(u"q"_s, QUrl::FullyDecoded);
        static const QRegularExpression byName(u"^name = '(.*)' and '(.*)' in parents and mimeType = '(.*)' and trashed = false$"_s);
        static const QRegularExpression byParent(u"^'(.*)' in parents and trashed = false$"_s);
        QStringList ids;
        if (const auto m = byName.match(q); m.hasMatch()) {
            for (auto it = nodes.cbegin(); it != nodes.cend(); ++it) {
                if (!it->trashed && it->name == m.captured(1) && it->parent == m.captured(2) && it->mime == m.captured(3)) {
                    ids << it.key();
                }
            }
        } else if (const auto m = byParent.match(q); m.hasMatch()) {
            for (auto it = nodes.cbegin(); it != nodes.cend(); ++it) {
                if (!it->trashed && it->parent == m.captured(1)) {
                    ids << it.key();
                }
            }
        } else {
            return QHttpServerResponse(QHttpServerResponse::StatusCode::BadRequest);
        }
        ids.sort();
        const int offset = query.queryItemValue(u"pageToken"_s).toInt();
        QJsonArray files;
        for (int i = offset; i < ids.size() && i < offset + pageSize; ++i) {
            files.append(meta(ids.at(i)));
        }
        QJsonObject out{{u"files"_s, files}};
        if (offset + pageSize < ids.size()) {
            out.insert(u"nextPageToken"_s, QString::number(offset + pageSize));
        }
        return QHttpServerResponse(out);
    }

    QHttpServerResponse createFolder(const QHttpServerRequest &r)
    {
        const QJsonObject m = QJsonDocument::fromJson(r.body()).object();
        const QString id = add(m.value(u"name"_s).toString(), m.value(u"mimeType"_s).toString(), m.value(u"parents"_s).toArray().first().toString());
        return QHttpServerResponse(meta(id));
    }

    QHttpServerResponse multipartCreate(const QHttpServerRequest &r)
    {
        const QByteArray type = r.headers().value(QHttpHeaders::WellKnownHeader::ContentType).toByteArray();
        const QByteArray boundary = "--" + type.mid(type.indexOf("boundary=") + 9);
        // Split on the boundary; each part is "headers\r\n\r\ncontent\r\n".
        QList<QByteArray> chunks;
        QByteArray body = r.body();
        qsizetype pos = body.indexOf(boundary);
        while (pos >= 0) {
            const qsizetype start = pos + boundary.size();
            const qsizetype next = body.indexOf(boundary, start);
            if (next < 0) {
                break;
            }
            chunks << body.mid(start, next - start);
            pos = next;
        }
        if (chunks.size() != 2) {
            return QHttpServerResponse(QHttpServerResponse::StatusCode::BadRequest);
        }
        auto content = [](const QByteArray &chunk) {
            QByteArray c = chunk.mid(chunk.indexOf("\r\n\r\n") + 4);
            c.chop(2); // trailing \r\n before the next boundary
            return c;
        };
        const QJsonObject m = QJsonDocument::fromJson(content(chunks.at(0))).object();
        const QString id = add(m.value(u"name"_s).toString(), u"text/markdown"_s, m.value(u"parents"_s).toArray().first().toString(), content(chunks.at(1)));
        return QHttpServerResponse(meta(id));
    }

    /// Live (not trashed) path -> node id, below the folder path "Marknote/<notebook>".
    QHash<QString, QString> tree(const QString &rootId) const
    {
        QHash<QString, QString> out;
        std::function<void(const QString &, const QString &)> walk = [&](const QString &parent, const QString &prefix) {
            for (auto it = nodes.cbegin(); it != nodes.cend(); ++it) {
                if (!it->trashed && it->parent == parent) {
                    const QString path = prefix.isEmpty() ? it->name : prefix + u'/' + it->name;
                    out.insert(path, it.key());
                    if (it->mime == folderMime) {
                        walk(it.key(), path);
                    }
                }
            }
        };
        walk(rootId, QString());
        return out;
    }
};

class GoogleDriveTest : public QObject
{
    Q_OBJECT

    QTemporaryDir m_tmp;
    int m_refreshes = 0;

    GoogleDriveBackend::TokenProvider tokens()
    {
        // The first token is stale, so the backend must refresh it after a 401.
        return [this](bool forceRefresh, QString *) {
            if (forceRefresh) {
                ++m_refreshes;
                return u"good"_s;
            }
            return m_refreshes > 0 ? u"good"_s : u"stale"_s;
        };
    }

    static void write(const QString &path, const QByteArray &content)
    {
        QDir().mkpath(QFileInfo(path).absolutePath());
        QFile f(path);
        QVERIFY(f.open(QFile::WriteOnly | QFile::Truncate));
        f.write(content);
    }

    static QByteArray read(const QString &path)
    {
        QFile f(path);
        return f.open(QFile::ReadOnly) ? f.readAll() : QByteArray();
    }

    SyncResult sync(FakeDrive &drive, const QString &device, GoogleDriveBackend **backendOut = nullptr)
    {
        auto *backend = new GoogleDriveBackend(u"Marknote/Projects"_s, tokens(), drive.base());
        backend->setTimeout(5000);
        SyncEngine engine(device, backend, device + u"/.marknote/sync/gdrive.json"_s);
        SyncResult r = engine.run();
        if (backendOut) {
            *backendOut = backend;
        } else {
            delete backend;
        }
        return r;
    }

private Q_SLOTS:
    void init()
    {
        m_refreshes = 0;
    }

    void testSyncRoundTripThroughDrive()
    {
        FakeDrive drive;
        const QString a = m_tmp.filePath(u"rt/a"_s), b = m_tmp.filePath(u"rt/b"_s);
        write(a + u"/Note.md"_s, "---\nid: X\n---\n\n# Note\n");
        write(a + u"/Folder/Deep/Inner.md"_s, "inner");
        write(a + u"/Folder/.directory"_s, "[Desktop Entry]\nX-Marknote-Emoji=📚\n");
        QDir().mkpath(b);

        GoogleDriveBackend *backend = nullptr;
        SyncResult r = sync(drive, a, &backend);
        QVERIFY2(r.ok(), qPrintable(r.errors.join(u"; "_s)));
        QCOMPARE(r.uploaded, 3);
        QCOMPARE(m_refreshes, 1); // the stale token was refreshed once

        // The notebook lives in My Drive › Marknote › Projects.
        const QString rootId = backend->rootFolderId();
        delete backend;
        const auto onDrive = drive.tree(rootId);
        QVERIFY(onDrive.contains(u"Note.md"_s));
        QVERIFY(onDrive.contains(u"Folder/Deep/Inner.md"_s));
        QCOMPARE(drive.nodes.value(onDrive.value(u"Folder/Deep/Inner.md"_s)).content, QByteArray("inner"));
        const QString projects = drive.nodes.value(rootId).name;
        QCOMPARE(projects, u"Projects"_s);
        QCOMPARE(drive.nodes.value(drive.nodes.value(rootId).parent).name, u"Marknote"_s);

        // A second device gets everything.
        r = sync(drive, b);
        QVERIFY2(r.ok(), qPrintable(r.errors.join(u"; "_s)));
        QCOMPARE(r.downloaded, 3);
        QCOMPARE(read(b + u"/Folder/.directory"_s), read(a + u"/Folder/.directory"_s));

        // Edits and deletes travel through Drive; deletes go to the Drive trash.
        write(b + u"/Note.md"_s, "---\nid: X\n---\n\n# Note, edited on B\n");
        QVERIFY(QFile::remove(b + u"/Folder/Deep/Inner.md"_s));
        r = sync(drive, b);
        QVERIFY2(r.ok(), qPrintable(r.errors.join(u"; "_s)));
        QCOMPARE(r.uploaded, 1);
        QCOMPARE(r.deletedRemote, 1);
        bool trashedOnDrive = false;
        for (const Node &n : std::as_const(drive.nodes)) {
            trashedOnDrive |= (n.name == u"Inner.md"_s && n.trashed);
        }
        QVERIFY(trashedOnDrive);

        r = sync(drive, a);
        QVERIFY2(r.ok(), qPrintable(r.errors.join(u"; "_s)));
        QCOMPARE(read(a + u"/Note.md"_s), QByteArray("---\nid: X\n---\n\n# Note, edited on B\n"));
        QVERIFY(!QFile::exists(a + u"/Folder/Deep/Inner.md"_s));
        QCOMPARE(sync(drive, a).changes(), 0);
        QCOMPARE(sync(drive, b).changes(), 0);
    }

    void testListingFollowsPages()
    {
        FakeDrive drive;
        const QString a = m_tmp.filePath(u"pages/a"_s), b = m_tmp.filePath(u"pages/b"_s);
        for (int i = 0; i < 7; ++i) {
            write(a + u"/Note %1.md"_s.arg(i), QByteArray::number(i));
        }
        QDir().mkpath(b);
        QVERIFY(sync(drive, a).ok());
        const SyncResult r = sync(drive, b);
        QVERIFY(r.ok());
        QCOMPARE(r.downloaded, 7); // all pages were read (page size 2)
    }

    void testServerErrorsAreReported()
    {
        FakeDrive drive;
        drive.rejectUploads = true;
        const QString a = m_tmp.filePath(u"err/a"_s);
        write(a + u"/Note.md"_s, "x");
        const SyncResult r = sync(drive, a);
        QVERIFY(!r.ok());
        QVERIFY2(r.errors.join(u" "_s).contains(u"HTTP 403"_s), qPrintable(r.errors.join(u"; "_s)));
        QVERIFY(r.errors.join(u" "_s).contains(u"Quota exceeded"_s));
        // Nothing recorded as synced, so the next run retries the upload.
        drive.rejectUploads = false;
        QCOMPARE(sync(drive, a).uploaded, 1);
    }

    void testNotSignedIn()
    {
        FakeDrive drive;
        const QString a = m_tmp.filePath(u"nosign/a"_s);
        write(a + u"/Note.md"_s, "x");
        GoogleDriveBackend backend(u"Marknote/Projects"_s, [](bool, QString *error) {
            *error = u"Not signed in to Google"_s;
            return QString();
        }, drive.base());
        SyncEngine engine(a, &backend, a + u"/.marknote/sync/gdrive.json"_s);
        const SyncResult r = engine.run();
        QVERIFY(!r.ok());
        QVERIFY(r.errors.join(u" "_s).contains(u"Not signed in"_s));
        QCOMPARE(r.changes(), 0);
    }
};

QTEST_GUILESS_MAIN(GoogleDriveTest)
#include "googledrivetest.moc"
