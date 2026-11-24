// SPDX-FileCopyrightText: 2026 Marknote fork contributors
// SPDX-License-Identifier: GPL-2.0-only OR GPL-3.0-only OR LicenseRef-KDE-Accepted-GPL

#include "syncengine.h"

#include <QCryptographicHash>
#include <QDateTime>
#include <QDir>
#include <QDirIterator>
#include <QFile>
#include <QFileInfo>
#include <QJsonArray>
#include <QJsonDocument>
#include <QJsonObject>
#include <QSaveFile>

#include <algorithm>

using namespace Qt::StringLiterals;

namespace Sync
{

// ---- SyncState ----------------------------------------------------------

SyncState SyncState::load(const QString &filePath)
{
    SyncState state;
    QFile file(filePath);
    if (!file.open(QFile::ReadOnly)) {
        return state;
    }
    const QJsonObject root = QJsonDocument::fromJson(file.readAll()).object();
    const QJsonObject files = root.value(u"files"_s).toObject();
    for (auto it = files.begin(); it != files.end(); ++it) {
        state.files.insert(it.key(), it.value().toString().toLatin1());
    }
    for (const QJsonValue &v : root.value(u"folders"_s).toArray()) {
        state.folders.insert(v.toString());
    }
    return state;
}

bool SyncState::save(const QString &filePath) const
{
    QJsonObject files;
    for (auto it = this->files.cbegin(); it != this->files.cend(); ++it) {
        files.insert(it.key(), QString::fromLatin1(it.value()));
    }
    QStringList sortedFolders(folders.cbegin(), folders.cend());
    sortedFolders.sort();
    const QJsonObject root{
        {u"version"_s, 1},
        {u"files"_s, files},
        {u"folders"_s, QJsonArray::fromStringList(sortedFolders)},
    };
    QDir().mkpath(QFileInfo(filePath).absolutePath());
    QSaveFile out(filePath);
    if (!out.open(QFile::WriteOnly)) {
        return false;
    }
    out.write(QJsonDocument(root).toJson(QJsonDocument::Indented));
    return out.commit();
}

// ---- SyncEngine ---------------------------------------------------------

SyncEngine::SyncEngine(const QString &localRoot, RemoteBackend *backend, const QString &statePath)
    : m_root(QDir::cleanPath(localRoot))
    , m_backend(backend)
    , m_statePath(statePath)
{
}

QByteArray SyncEngine::md5Hex(const QByteArray &data)
{
    return QCryptographicHash::hash(data, QCryptographicHash::Md5).toHex();
}

bool SyncEngine::isExcluded(const QString &relativePath)
{
    return relativePath == u".marknote/sync"_s || relativePath.startsWith(u".marknote/sync/"_s) || relativePath == u".marknote/trash"_s
        || relativePath.startsWith(u".marknote/trash/"_s);
}

QString SyncEngine::absolute(const QString &relativePath) const
{
    return m_root + u'/' + relativePath;
}

QString SyncEngine::conflictCopyPath(const QString &relativePath) const
{
    const QFileInfo info(relativePath);
    const QString dir = info.path() == u"."_s ? QString() : info.path() + u'/';
    const QString suffix = info.suffix().isEmpty() ? QString() : u'.' + info.suffix();
    const QString stamp = QDateTime::currentDateTime().toString(u"yyyy-MM-dd HHmm"_s);
    QString candidate = dir + info.completeBaseName() + u" (conflict "_s + stamp + u')' + suffix;
    for (int n = 2; QFileInfo::exists(absolute(candidate)); ++n) {
        candidate = dir + info.completeBaseName() + u" (conflict "_s + stamp + u' ' + QString::number(n) + u')' + suffix;
    }
    return candidate;
}

bool SyncEngine::writeLocal(const QString &relativePath, const QByteArray &data, QString *error)
{
    const QString path = absolute(relativePath);
    if (!QDir().mkpath(QFileInfo(path).absolutePath())) {
        *error = u"Cannot create folder for %1"_s.arg(relativePath);
        return false;
    }
    QSaveFile out(path);
    if (!out.open(QFile::WriteOnly)) {
        *error = u"Cannot write %1: %2"_s.arg(relativePath, out.errorString());
        return false;
    }
    out.write(data);
    if (!out.commit()) {
        *error = u"Cannot write %1: %2"_s.arg(relativePath, out.errorString());
        return false;
    }
    return true;
}

bool SyncEngine::trashLocal(const QString &relativePath, QString *error)
{
    if (m_trashStamp.isEmpty()) {
        m_trashStamp = QDateTime::currentDateTime().toString(u"yyyyMMdd-HHmmss"_s);
    }
    const QString target = absolute(u".marknote/trash/"_s + m_trashStamp + u'/' + relativePath);
    QDir().mkpath(QFileInfo(target).absolutePath());
    if (!QFile::rename(absolute(relativePath), target)) {
        *error = u"Cannot move %1 to the trash"_s.arg(relativePath);
        return false;
    }
    return true;
}

SyncResult SyncEngine::run(const Progress &progress)
{
    SyncResult result;
    auto report = [&progress](const QString &message) {
        if (progress) {
            progress(message);
        }
    };

    const SyncState base = SyncState::load(m_statePath);
    SyncState next = base;

    // Local side.
    report(u"Scanning notebook…"_s);
    QHash<QString, QByteArray> localFiles;
    QSet<QString> localFolders;
    QDirIterator it(m_root, QDir::Files | QDir::Dirs | QDir::NoDotAndDotDot | QDir::Hidden, QDirIterator::Subdirectories);
    while (it.hasNext()) {
        const QString abs = it.next();
        const QString rel = QDir(m_root).relativeFilePath(abs);
        if (isExcluded(rel)) {
            continue;
        }
        const QFileInfo info = it.fileInfo();
        if (info.isDir()) {
            localFolders.insert(rel);
        } else if (info.isFile()) {
            QFile f(abs);
            if (f.open(QFile::ReadOnly)) {
                localFiles.insert(rel, md5Hex(f.readAll()));
            } else {
                result.errors << u"Cannot read %1"_s.arg(rel);
            }
        }
    }

    // Remote side.
    report(u"Listing %1…"_s.arg(m_backend->displayName()));
    QHash<QString, RemoteFile> remote;
    QString error;
    if (!m_backend->listAll(&remote, &error)) {
        result.errors << error;
        return result; // nothing can be decided without the remote listing
    }
    QHash<QString, RemoteFile> remoteFiles;
    QSet<QString> remoteFolders;
    for (auto r = remote.cbegin(); r != remote.cend(); ++r) {
        if (isExcluded(r.key())) {
            continue;
        }
        if (r->isFolder) {
            remoteFolders.insert(r.key());
        } else {
            remoteFiles.insert(r.key(), r.value());
        }
    }

    // Files: every path seen on either side or at the last sync.
    QSet<QString> paths;
    for (auto k = localFiles.keyBegin(); k != localFiles.keyEnd(); ++k) paths.insert(*k);
    for (auto k = remoteFiles.keyBegin(); k != remoteFiles.keyEnd(); ++k) paths.insert(*k);
    for (auto k = base.files.keyBegin(); k != base.files.keyEnd(); ++k) paths.insert(*k);
    QStringList ordered(paths.cbegin(), paths.cend());
    ordered.sort();

    auto upload = [&](const QString &path, const RemoteFile *existing) -> bool {
        QFile f(absolute(path));
        if (!f.open(QFile::ReadOnly)) {
            result.errors << u"Cannot read %1"_s.arg(path);
            return false;
        }
        const QByteArray data = f.readAll();
        RemoteFile uploaded;
        QString err;
        if (!m_backend->upload(path, data, existing, &uploaded, &err)) {
            result.errors << err;
            return false;
        }
        next.files.insert(path, md5Hex(data));
        ++result.uploaded;
        return true;
    };
    auto download = [&](const RemoteFile &rf, const QString &targetPath) -> bool {
        QByteArray data;
        QString err;
        if (!m_backend->download(rf, &data, &err) || !writeLocal(targetPath, data, &err)) {
            result.errors << err;
            return false;
        }
        result.changedLocalPaths << targetPath;
        return true;
    };

    for (const QString &path : std::as_const(ordered)) {
        report(path);
        const bool hasLocal = localFiles.contains(path);
        const bool hasRemote = remoteFiles.contains(path);
        const bool hasBase = base.files.contains(path);
        const QByteArray l = localFiles.value(path);
        const QByteArray b = base.files.value(path);
        const RemoteFile rf = remoteFiles.value(path);
        const QByteArray r = rf.md5;

        if (hasLocal && hasRemote) {
            if (l == r) {
                next.files.insert(path, l); // identical
            } else if (hasBase && l == b) {
                if (download(rf, path)) { // only the remote changed
                    next.files.insert(path, r);
                    ++result.downloaded;
                }
            } else if (hasBase && r == b) {
                upload(path, &rf); // only the local copy changed
            } else {
                // Both changed (or both new and different): keep both.
                const QString copy = conflictCopyPath(path);
                if (download(rf, copy)) {
                    result.conflictCopies << copy;
                    ++result.conflicts;
                    // The copy is uploaded on the next sync like any new file.
                    upload(path, &rf);
                }
            }
        } else if (hasLocal) {
            if (hasBase && l == b) {
                // Deleted on the destination, unchanged here: delete here too (recoverably).
                QString err;
                if (trashLocal(path, &err)) {
                    next.files.remove(path);
                    result.changedLocalPaths << path;
                    ++result.deletedLocal;
                } else {
                    result.errors << err;
                }
            } else {
                // New here, or edited here after being deleted there: edits win.
                upload(path, nullptr);
            }
        } else if (hasRemote) {
            if (hasBase && r == b) {
                // Deleted here, unchanged there: delete there (destination trash).
                QString err;
                if (m_backend->remove(rf, &err)) {
                    next.files.remove(path);
                    ++result.deletedRemote;
                } else {
                    result.errors << err;
                }
            } else if (download(rf, path)) {
                // New there, or edited there after being deleted here.
                next.files.insert(path, r);
                ++result.downloaded;
            }
        } else {
            next.files.remove(path); // gone on both sides
        }
    }

    // Folders, after files so emptiness is known. Parents before children for
    // creation, children before parents for removal.
    QSet<QString> folderPaths = localFolders;
    folderPaths.unite(remoteFolders);
    folderPaths.unite(base.folders);
    QStringList folders(folderPaths.cbegin(), folderPaths.cend());
    std::sort(folders.begin(), folders.end());

    auto hasSyncedContent = [&](const QString &folder) {
        const QString prefix = folder + u'/';
        for (auto k = next.files.keyBegin(); k != next.files.keyEnd(); ++k) {
            if (k->startsWith(prefix)) {
                return true;
            }
        }
        for (const QString &f : std::as_const(folders)) {
            if (f.startsWith(prefix) && next.folders.contains(f)) {
                return true;
            }
        }
        return false;
    };

    for (auto i = folders.crbegin(); i != folders.crend(); ++i) {
        const QString &folder = *i;
        const bool inLocal = localFolders.contains(folder) && QFileInfo(absolute(folder)).isDir();
        const bool inRemote = remoteFolders.contains(folder);
        const bool inBase = base.folders.contains(folder);
        if (inLocal && inRemote) {
            next.folders.insert(folder);
        } else if (inLocal && inBase && !hasSyncedContent(folder)) {
            // Removed on the destination and now empty here: remove the empty folder.
            QDir().rmdir(absolute(folder));
            next.folders.remove(folder);
        } else if (inRemote && inBase && !hasSyncedContent(folder)) {
            QString err;
            if (m_backend->remove(remote.value(folder), &err)) {
                next.folders.remove(folder);
            } else {
                result.errors << err;
            }
        } else if (!inLocal && !inRemote) {
            next.folders.remove(folder);
        }
    }
    for (const QString &folder : std::as_const(folders)) {
        const bool inLocal = QFileInfo(absolute(folder)).isDir();
        const bool inRemote = remoteFolders.contains(folder);
        if (next.folders.contains(folder) || (inLocal && inRemote)) {
            continue;
        }
        if (inLocal && !base.folders.contains(folder)) {
            RemoteFile created;
            QString err;
            if (m_backend->createFolder(folder, &created, &err)) {
                next.folders.insert(folder);
            } else {
                result.errors << err;
            }
        } else if (inRemote && !base.folders.contains(folder)) {
            if (QDir().mkpath(absolute(folder))) {
                next.folders.insert(folder);
            }
        } else if (inLocal || inRemote) {
            // Folder exists on one side and still has content: keep it on both.
            if (inLocal) {
                RemoteFile created;
                QString err;
                if (m_backend->createFolder(folder, &created, &err)) {
                    next.folders.insert(folder);
                }
            } else if (QDir().mkpath(absolute(folder))) {
                next.folders.insert(folder);
            }
        }
    }

    if (!next.save(m_statePath)) {
        result.errors << u"Cannot save the sync state"_s;
    }
    report(result.ok() ? u"Done"_s : u"Finished with errors"_s);
    return result;
}

} // namespace Sync
