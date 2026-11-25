// SPDX-FileCopyrightText: 2026 Marknote fork contributors
// SPDX-License-Identifier: GPL-2.0-only OR GPL-3.0-only OR LicenseRef-KDE-Accepted-GPL

#include "attachments.h"

#include "sync/syncmanager.h"

#include <KFormat>
#include <KLocalizedString>
#include <QDir>
#include <QFile>
#include <QFileInfo>
#include <QMimeDatabase>
#include <QRegularExpression>

using namespace Qt::StringLiterals;

namespace Attachments
{
namespace
{
QString decode(const QString &href)
{
    QString path = href;
    const qsizetype cut = path.indexOf(QRegularExpression(u"[?#]"_s));
    if (cut >= 0) {
        path.truncate(cut);
    }
    return QUrl::fromPercentEncoding(path.toUtf8());
}
}

bool isTarget(const QString &href)
{
    static const QRegularExpression schemeRe(u"^[a-z][a-z0-9+.-]*:"_s, QRegularExpression::CaseInsensitiveOption);
    if (href.isEmpty() || href.startsWith(u'#') || href.startsWith(u'/') || href.startsWith(u'\\') || schemeRe.match(href).hasMatch()) {
        return false;
    }
    const QString path = decode(href);
    return !path.isEmpty() && !path.endsWith(u".md"_s, Qt::CaseInsensitive);
}

std::optional<Attachment> parse(const QString &markdown)
{
    // Same as LINE_RE in web/src/attachments.js.
    static const QRegularExpression lineRe(u"^\\s*\\[📎\\s?([^\\]\\n]*)\\]\\(\\s*(<[^>\\n]+>|[^\\s)]+)\\s*\\)\\s*$"_s);
    const auto m = lineRe.match(markdown);
    if (!m.hasMatch()) {
        return std::nullopt;
    }
    QString href = m.captured(2);
    if (href.startsWith(u'<') && href.endsWith(u'>')) {
        href = href.mid(1, href.size() - 2);
    }
    if (!isTarget(href)) {
        return std::nullopt;
    }
    Attachment a;
    a.href = href;
    a.path = decode(href);
    a.name = m.captured(1).trimmed();
    if (a.name.isEmpty()) {
        a.name = a.path.section(u'/', -1);
    }
    return a;
}

QString encodePath(const QString &fileName)
{
    // Unreserved characters stay; so do a few that are safe in a link target.
    // Spaces and parentheses are encoded, so the link needs no <...>.
    return QString::fromUtf8(QUrl::toPercentEncoding(fileName, "/!$&'*+,;=:@"));
}

QString markdown(const QString &name, const QString &link)
{
    static const QRegularExpression bracketsRe(u"[\\[\\]]"_s);
    static const QRegularExpression needsAngleRe(u"[\\s()]"_s);
    QString cleanName = name;
    cleanName.remove(bracketsRe);
    cleanName.replace(u'\n', u' ');
    const QString target = needsAngleRe.match(link).hasMatch() ? u'<' + link + u'>' : link;
    return u"[📎 %1](%2)"_s.arg(cleanName, target);
}

QString uniqueName(const QString &dir, const QString &fileName)
{
    const QDir folder(dir);
    if (!QFileInfo::exists(folder.filePath(fileName))) {
        return fileName;
    }
    // Like freeName() in web/src/library.js: before the last extension; a
    // leading dot is part of the name.
    QString base = fileName;
    QString ext;
    const qsizetype dot = fileName.lastIndexOf(u'.');
    if (dot > 0) {
        base = fileName.left(dot);
        ext = fileName.mid(dot);
    }
    for (int n = 2;; ++n) {
        const QString candidate = u"%1 (%2)%3"_s.arg(base, QString::number(n), ext);
        if (!QFileInfo::exists(folder.filePath(candidate))) {
            return candidate;
        }
    }
}

QString attach(const QString &notePath, const QString &source, QString *error)
{
    const QFileInfo src(source);
    if (!src.isFile()) {
        if (error) {
            *error = i18n("“%1” is not a file.", source);
        }
        return {};
    }
    const QString dir = QFileInfo(notePath).absolutePath();
    QString name = src.fileName();
    if (QDir::cleanPath(src.absolutePath()) != QDir::cleanPath(dir)) {
        name = uniqueName(dir, name);
        if (!QFile::copy(src.absoluteFilePath(), QDir(dir).filePath(name))) {
            if (error) {
                *error = i18n("Could not copy “%1” next to the note.", src.fileName());
            }
            return {};
        }
    }
    // A file already in the note's folder is linked as it is.
    return markdown(name, encodePath(name));
}
}

AttachmentHelper::AttachmentHelper(QObject *parent)
    : QObject(parent)
{
}

namespace
{
QString localPath(const QUrl &url)
{
    return url.isLocalFile() ? url.toLocalFile() : url.toString();
}

QString kindOf(const QMimeType &mime, const QString &fileName)
{
    const QString name = mime.name();
    if (name == u"application/pdf"_s) {
        return i18nc("@info file kind", "PDF");
    }
    if (name.startsWith(u"image/"_s)) {
        return i18nc("@info file kind", "Image");
    }
    if (name.startsWith(u"audio/"_s)) {
        return i18nc("@info file kind", "Audio");
    }
    if (name.startsWith(u"video/"_s)) {
        return i18nc("@info file kind", "Video");
    }
    const QString suffix = QFileInfo(fileName).suffix().toUpper();
    return suffix.isEmpty() ? i18nc("@info file kind", "File") : i18nc("@info file kind, %1 is a file extension", "%1 file", suffix);
}
}

QVariantMap AttachmentHelper::info(const QUrl &note, const QString &markdown) const
{
    const auto att = Attachments::parse(markdown);
    if (!att) {
        return {{u"valid"_s, false}};
    }
    const QString dir = QFileInfo(localPath(note)).absolutePath();
    const QString path = QDir::cleanPath(QDir(dir).filePath(att->path));
    const QFileInfo file(path);
    const bool exists = file.isFile();

    QMimeDatabase db;
    const QMimeType mime = exists ? db.mimeTypeForFile(path) : db.mimeTypeForFile(path, QMimeDatabase::MatchExtension);
    QString icon = mime.iconName();
    if (icon.isEmpty() || mime.isDefault()) {
        icon = mime.isDefault() ? u"unknown"_s : mime.genericIconName();
    }

    QVariantMap map{
        {u"valid"_s, true},
        {u"name"_s, att->name},
        {u"href"_s, att->href},
        {u"path"_s, path},
        {u"url"_s, QUrl::fromLocalFile(path)},
        {u"folderUrl"_s, QUrl::fromLocalFile(file.absolutePath())},
        {u"exists"_s, exists},
        {u"size"_s, exists ? file.size() : -1},
        {u"sizeText"_s, exists ? KFormat().formatByteSize(file.size()) : QString()},
        {u"iconName"_s, icon},
        {u"genericIconName"_s, mime.genericIconName()},
        {u"kind"_s, kindOf(mime, path)},
    };

    auto *sync = Sync::SyncManager::instance();
    const bool google = sync->syncsToGoogle(path);
    const QString id = google && exists ? sync->googleDriveId(path) : QString();
    map[u"syncsToGoogle"_s] = google;
    map[u"driveId"_s] = id;
    map[u"driveUrl"_s] = id.isEmpty() ? QString() : u"https://drive.google.com/file/d/%1/view"_s.arg(id);
    map[u"downloadUrl"_s] = id.isEmpty() ? QString() : u"https://drive.google.com/uc?export=download&id=%1"_s.arg(id);
    return map;
}

QString AttachmentHelper::attach(const QUrl &note, const QUrl &file)
{
    QString error;
    const QString md = Attachments::attach(localPath(note), localPath(file), &error);
    if (md.isEmpty()) {
        Q_EMIT statusMessage(error);
    }
    return md;
}
