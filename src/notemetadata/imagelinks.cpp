// SPDX-FileCopyrightText: 2026 Marknote fork contributors
// SPDX-License-Identifier: GPL-2.0-only OR GPL-3.0-only OR LicenseRef-KDE-Accepted-GPL

#include "imagelinks.h"

#include <QDateTime>
#include <QDir>
#include <QDirIterator>
#include <QFile>
#include <QFileInfo>
#include <QRegularExpression>
#include <QSaveFile>
#include <QUrl>

using namespace Qt::StringLiterals;

namespace ImageLinks
{

void Report::add(const Report &o)
{
    rewritten += o.rewritten;
    copied += o.copied;
    moved += o.moved;
    missing += o.missing;
    for (const QString &n : o.changedNotes) {
        if (!changedNotes.contains(n)) {
            changedNotes << n;
        }
    }
    errors += o.errors;
}

namespace
{

/// Ranges of fenced code blocks and inline code, where nothing is a link.
QList<std::pair<qsizetype, qsizetype>> codeRanges(const QString &text)
{
    QList<std::pair<qsizetype, qsizetype>> out;
    static const QRegularExpression fence(u"^[ ]{0,3}(`{3,}|~{3,})"_s, QRegularExpression::MultilineOption);
    qsizetype pos = 0;
    while (true) {
        const auto open = fence.match(text, pos);
        if (!open.hasMatch()) {
            break;
        }
        const QString marker = open.captured(1);
        const QRegularExpression close(u"^[ ]{0,3}"_s + QRegularExpression::escape(marker.left(1)) + u"{"_s + QString::number(marker.size()) + u",}[ \\t]*$"_s,
                                       QRegularExpression::MultilineOption);
        const qsizetype lineEnd = text.indexOf(u'\n', open.capturedEnd());
        const auto end = lineEnd < 0 ? QRegularExpressionMatch() : close.match(text, lineEnd + 1);
        const qsizetype stop = end.hasMatch() ? end.capturedEnd() : text.size();
        out.append({open.capturedStart(), stop});
        pos = stop;
        if (pos >= text.size()) {
            break;
        }
    }
    static const QRegularExpression inlineCode(u"(`+)[^`]*?\\1"_s);
    auto it = inlineCode.globalMatch(text);
    while (it.hasNext()) {
        const auto m = it.next();
        out.append({m.capturedStart(), m.capturedEnd()});
    }
    return out;
}

QString readText(const QString &path, bool *ok)
{
    QFile f(path);
    *ok = f.open(QFile::ReadOnly);
    return *ok ? QString::fromUtf8(f.readAll()) : QString();
}

bool writeText(const QString &path, const QString &text)
{
    QSaveFile f(path);
    if (!f.open(QFile::WriteOnly)) {
        return false;
    }
    f.write(text.toUtf8());
    return f.commit();
}

QString decodeTarget(QString target)
{
    target = target.trimmed();
    if (target.startsWith(u'<') && target.endsWith(u'>')) {
        return target.mid(1, target.size() - 2);
    }
    return QUrl::fromPercentEncoding(target.toUtf8());
}

bool isWeb(const QString &target)
{
    static const QRegularExpression scheme(u"^[a-zA-Z][a-zA-Z0-9+.-]+:"_s);
    return scheme.match(target).hasMatch() && !target.startsWith(u"file:"_s, Qt::CaseInsensitive);
}

/// Copy @p source to a free name in @p dir, preferring its own file name.
QString copyInto(const QString &source, const QString &dir, const QString &preferredName, QString *error)
{
    QString name = preferredName.isEmpty() ? QFileInfo(source).fileName() : preferredName;
    QString target = QDir(dir).filePath(name);
    const QFileInfo info(name);
    for (int n = 2; QFileInfo::exists(target); ++n) {
        target = QDir(dir).filePath(info.completeBaseName() + u'-' + QString::number(n) + (info.suffix().isEmpty() ? QString() : u'.' + info.suffix()));
    }
    if (!QFile::copy(source, target)) {
        if (error) {
            *error = u"Could not copy %1"_s.arg(source);
        }
        return {};
    }
    return target;
}

using Rewriter = std::function<QString(const Link &link)>;

/// Apply @p rewrite (returns the new target, or an empty string to keep it) to every link.
QString rewrite(const QString &text, const Rewriter &fn, int *changes)
{
    QString out = text;
    const auto links = find(text);
    for (auto it = links.crbegin(); it != links.crend(); ++it) {
        const QString replacement = fn(*it);
        if (!replacement.isEmpty() && replacement != it->target) {
            out.replace(it->from, it->to - it->from, replacement);
            ++*changes;
        }
    }
    return out;
}

Report rewriteFile(const QString &notePath, const Rewriter &fn)
{
    Report r;
    bool ok = false;
    const QString text = readText(notePath, &ok);
    if (!ok) {
        r.errors << u"Could not read %1"_s.arg(notePath);
        return r;
    }
    int changes = 0;
    const QString out = rewrite(text, fn, &changes);
    if (changes) {
        if (writeText(notePath, out)) {
            r.rewritten = changes;
            r.changedNotes << notePath;
        } else {
            r.errors << u"Could not write %1"_s.arg(notePath);
        }
    }
    return r;
}

} // namespace

QList<Link> find(const QString &text)
{
    QList<Link> out;
    const auto code = codeRanges(text);
    static const QRegularExpression image(u"!\\[(?:[^\\]\\\\]|\\\\.)*\\]\\([ \\t]*(<[^>\\n]*>|[^\\s()]*(?:\\([^\\s()]*\\)[^\\s()]*)*)"_s);
    auto it = image.globalMatch(text);
    while (it.hasNext()) {
        const auto m = it.next();
        const qsizetype start = m.capturedStart();
        const bool inCode = std::any_of(code.cbegin(), code.cend(), [start](const auto &r) {
            return start >= r.first && start < r.second;
        });
        if (inCode || m.captured(1).isEmpty()) {
            continue;
        }
        out.append({m.capturedStart(1), m.capturedEnd(1), m.captured(1)});
    }
    return out;
}

bool isRelative(const QString &target)
{
    const QString t = target.trimmed();
    if (isWeb(t) || t.startsWith(u"file:"_s, Qt::CaseInsensitive)) {
        return false;
    }
    return !QDir::isAbsolutePath(decodeTarget(t));
}

QString resolve(const QString &target, const QString &noteDir)
{
    const QString t = target.trimmed();
    if (isWeb(t)) {
        return {};
    }
    if (t.startsWith(u"file:"_s, Qt::CaseInsensitive)) {
        return QDir::cleanPath(QUrl(t.startsWith(u'<') ? t.mid(1, t.size() - 2) : t).toLocalFile());
    }
    const QString path = decodeTarget(t);
    return QDir::cleanPath(QDir::isAbsolutePath(path) ? path : QDir(noteDir).filePath(path));
}

QString relativeLink(const QString &fromDir, const QString &imagePath)
{
    const QString rel = QDir(fromDir).relativeFilePath(imagePath);
    // Encode only what breaks a Markdown link; keep other characters readable.
    QString out;
    for (const QChar c : rel) {
        switch (c.unicode()) {
        case ' ':
            out += u"%20"_s;
            break;
        case '(':
            out += u"%28"_s;
            break;
        case ')':
            out += u"%29"_s;
            break;
        case '%':
            out += u"%25"_s;
            break;
        case '<':
            out += u"%3C"_s;
            break;
        case '>':
            out += u"%3E"_s;
            break;
        default:
            out += c;
        }
    }
    return out;
}

bool isInside(const QString &path, const QString &dir)
{
    const QString p = QDir::cleanPath(path);
    const QString d = QDir::cleanPath(dir);
    return !d.isEmpty() && (p == d || p.startsWith(d + u'/'));
}

QString attachmentPath(const QString &dir, const QString &noteBaseName, const QString &suffix)
{
    const QString ext = suffix.isEmpty() ? u"png"_s : suffix.toLower();
    qint64 stamp = QDateTime::currentMSecsSinceEpoch();
    QString base = noteBaseName;
    base.replace(u'/', u'-');
    QString path;
    do {
        path = QDir(dir).filePath(u"%1_%2.%3"_s.arg(base).arg(stamp++).arg(ext));
    } while (QFileInfo::exists(path));
    return path;
}

QString linkForNewImage(const QString &notePath, const QString &imagePath, const QString &notebookDir, QString *error)
{
    const QFileInfo note(notePath);
    const QString image = QDir::cleanPath(imagePath);
    if (isInside(image, notebookDir)) {
        return relativeLink(note.absolutePath(), image);
    }
    const QString target = attachmentPath(note.absolutePath(), note.completeBaseName(), QFileInfo(image).suffix());
    if (!QFile::copy(image, target)) {
        if (error) {
            *error = u"Could not copy the image into the notebook."_s;
        }
        return {};
    }
    return relativeLink(note.absolutePath(), target);
}

Report noteMoved(const QString &oldNotePath, const QString &newNotePath, const QString &oldNotebook, const QString &newNotebook)
{
    Report report;
    const QString oldDir = QFileInfo(oldNotePath).absolutePath();
    const QString newDir = QFileInfo(newNotePath).absolutePath();
    const QString noteBase = QFileInfo(oldNotePath).completeBaseName();
    if (oldDir == newDir) {
        return report;
    }
    report.add(rewriteFile(newNotePath, [&](const Link &link) -> QString {
        if (!isRelative(link.target)) {
            return {}; // absolute links still point where they did
        }
        const QString image = resolve(link.target, oldDir);
        if (!QFileInfo::exists(image)) {
            ++report.missing;
            return relativeLink(newDir, image); // keep pointing at the same place
        }
        const QFileInfo info(image);
        const bool ownImage = info.absolutePath() == oldDir && info.fileName().startsWith(noteBase + u'_');
        if (ownImage) {
            QString target = QDir(newDir).filePath(info.fileName());
            if (QFileInfo::exists(target)) {
                target = attachmentPath(newDir, noteBase, info.suffix());
            }
            if (QFile::rename(image, target)) {
                ++report.moved;
                return relativeLink(newDir, target);
            }
            report.errors << u"Could not move %1"_s.arg(image);
            return relativeLink(newDir, image);
        }
        if (!isInside(image, newNotebook)) {
            QString error;
            const QString copy = copyInto(image, newDir, QString(), &error);
            if (!copy.isEmpty()) {
                ++report.copied;
                return relativeLink(newDir, copy);
            }
            report.errors << error;
        }
        return relativeLink(newDir, image);
    }));
    Q_UNUSED(oldNotebook)
    return report;
}

Report folderMoved(const QString &oldFolder, const QString &newFolder, const QString &oldNotebook, const QString &newNotebook)
{
    Report report;
    Q_UNUSED(oldNotebook)
    QDirIterator it(newFolder, {u"*.md"_s}, QDir::Files, QDirIterator::Subdirectories);
    while (it.hasNext()) {
        const QString newNote = it.next();
        const QString oldNote = QDir(oldFolder).filePath(QDir(newFolder).relativeFilePath(newNote));
        const QString oldDir = QFileInfo(oldNote).absolutePath();
        const QString newDir = QFileInfo(newNote).absolutePath();
        report.add(rewriteFile(newNote, [&](const Link &link) -> QString {
            if (!isRelative(link.target)) {
                return {};
            }
            const QString oldImage = resolve(link.target, oldDir);
            if (isInside(oldImage, oldFolder)) {
                return {}; // moved along with the folder: the link still works
            }
            if (!QFileInfo::exists(oldImage)) {
                ++report.missing;
                return relativeLink(newDir, oldImage);
            }
            if (!isInside(oldImage, newNotebook)) {
                QString error;
                const QString copy = copyInto(oldImage, newDir, QString(), &error);
                if (!copy.isEmpty()) {
                    ++report.copied;
                    return relativeLink(newDir, copy);
                }
                report.errors << error;
            }
            return relativeLink(newDir, oldImage);
        }));
    }
    return report;
}

Report makeRelative(const QString &notebookDir)
{
    Report report;
    QDirIterator it(notebookDir, {u"*.md"_s}, QDir::Files, QDirIterator::Subdirectories);
    while (it.hasNext()) {
        const QString note = it.next();
        if (note.contains(u"/.marknote/"_s)) {
            continue;
        }
        const QString dir = QFileInfo(note).absolutePath();
        report.add(rewriteFile(note, [&](const Link &link) -> QString {
            if (isRelative(link.target)) {
                return {};
            }
            const QString image = resolve(link.target, dir);
            if (image.isEmpty()) {
                return {}; // web image
            }
            if (!QFileInfo::exists(image)) {
                ++report.missing;
                return {};
            }
            if (isInside(image, notebookDir)) {
                return relativeLink(dir, image);
            }
            QString error;
            const QString copy = copyInto(image, dir, QString(), &error);
            if (copy.isEmpty()) {
                report.errors << error;
                return {};
            }
            ++report.copied;
            return relativeLink(dir, copy);
        }));
    }
    return report;
}

} // namespace ImageLinks
