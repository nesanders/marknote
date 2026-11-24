// SPDX-FileCopyrightText: 2026 Marknote fork contributors
// SPDX-License-Identifier: GPL-2.0-only OR GPL-3.0-only OR LicenseRef-KDE-Accepted-GPL

#include "localfolderbackend.h"
#include "syncengine.h"

#include <QDateTime>
#include <QDir>
#include <QDirIterator>
#include <QFile>
#include <QFileInfo>
#include <QSaveFile>

using namespace Qt::StringLiterals;

namespace Sync
{

LocalFolderBackend::LocalFolderBackend(const QString &rootPath)
    : m_root(QDir::cleanPath(rootPath))
{
}

QString LocalFolderBackend::displayName() const
{
    return QDir(m_root).dirName();
}

bool LocalFolderBackend::listAll(QHash<QString, RemoteFile> *out, QString *error)
{
    if (!QDir().mkpath(m_root)) {
        *error = u"Cannot open destination folder %1"_s.arg(m_root);
        return false;
    }
    QDirIterator it(m_root, QDir::Files | QDir::Dirs | QDir::NoDotAndDotDot | QDir::Hidden, QDirIterator::Subdirectories);
    while (it.hasNext()) {
        const QString abs = it.next();
        const QString rel = QDir(m_root).relativeFilePath(abs);
        if (SyncEngine::isExcluded(rel)) {
            continue;
        }
        RemoteFile rf;
        rf.path = rel;
        rf.id = abs;
        rf.isFolder = it.fileInfo().isDir();
        rf.modified = it.fileInfo().lastModified();
        if (!rf.isFolder) {
            QFile f(abs);
            if (!f.open(QFile::ReadOnly)) {
                *error = u"Cannot read %1 at the destination"_s.arg(rel);
                return false;
            }
            rf.md5 = SyncEngine::md5Hex(f.readAll());
        }
        out->insert(rel, rf);
    }
    return true;
}

bool LocalFolderBackend::download(const RemoteFile &file, QByteArray *data, QString *error)
{
    QFile f(m_root + u'/' + file.path);
    if (!f.open(QFile::ReadOnly)) {
        *error = u"Cannot read %1 at the destination"_s.arg(file.path);
        return false;
    }
    *data = f.readAll();
    return true;
}

bool LocalFolderBackend::upload(const QString &path, const QByteArray &data, const RemoteFile *, RemoteFile *result, QString *error)
{
    const QString abs = m_root + u'/' + path;
    QDir().mkpath(QFileInfo(abs).absolutePath());
    QSaveFile out(abs);
    if (!out.open(QFile::WriteOnly)) {
        *error = u"Cannot write %1 at the destination"_s.arg(path);
        return false;
    }
    out.write(data);
    if (!out.commit()) {
        *error = u"Cannot write %1 at the destination"_s.arg(path);
        return false;
    }
    result->path = path;
    result->id = abs;
    result->md5 = SyncEngine::md5Hex(data);
    result->modified = QFileInfo(abs).lastModified();
    return true;
}

bool LocalFolderBackend::createFolder(const QString &path, RemoteFile *result, QString *error)
{
    const QString abs = m_root + u'/' + path;
    if (!QDir().mkpath(abs)) {
        *error = u"Cannot create folder %1 at the destination"_s.arg(path);
        return false;
    }
    result->path = path;
    result->id = abs;
    result->isFolder = true;
    return true;
}

bool LocalFolderBackend::remove(const RemoteFile &file, QString *error)
{
    const QString abs = m_root + u'/' + file.path;
    if (file.isFolder) {
        if (!QDir().rmdir(abs)) {
            *error = u"Cannot remove folder %1 at the destination"_s.arg(file.path);
            return false;
        }
        return true;
    }
    const QString target = m_root + u"/.marknote/trash/"_s + QDateTime::currentDateTime().toString(u"yyyyMMdd-HHmmss"_s) + u'/' + file.path;
    QDir().mkpath(QFileInfo(target).absolutePath());
    if (!QFile::rename(abs, target)) {
        *error = u"Cannot remove %1 at the destination"_s.arg(file.path);
        return false;
    }
    return true;
}

bool LocalFolderBackend::emptyTrash(int *deleted, QString *error)
{
    QDir trash(m_root + u"/.marknote/trash"_s);
    if (!trash.exists()) {
        return true;
    }
    int n = 0;
    QDirIterator it(trash.path(), QDir::Files | QDir::Hidden, QDirIterator::Subdirectories);
    while (it.hasNext()) {
        it.next();
        ++n;
    }
    if (!trash.removeRecursively()) {
        *error = u"Cannot empty the trash of the sync folder"_s;
        return false;
    }
    if (deleted) {
        *deleted += n;
    }
    return true;
}

} // namespace Sync
