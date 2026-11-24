// SPDX-FileCopyrightText: 2026 Marknote fork contributors
// SPDX-License-Identifier: GPL-2.0-only OR GPL-3.0-only OR LicenseRef-KDE-Accepted-GPL

#include "notemetadata.h"

#include "imagelinks.h"

#include <KConfig>
#include <KConfigGroup>
#include <KFormat>
#include <KLocalizedString>

#include <QDirIterator>
#include <QFile>
#include <QFileInfo>
#include <QMap>
#include <QRegularExpression>
#include <QSaveFile>

using namespace Qt::StringLiterals;

namespace
{
QString localPath(const QUrl &url)
{
    return url.isLocalFile() ? url.toLocalFile() : url.toString();
}

const auto desktopGroup = "Desktop Entry";
const auto emojiKey = "X-Marknote-Emoji";
}

NoteMetadata::NoteMetadata(QObject *parent)
    : QObject(parent)
{
}

NoteMetadata *NoteMetadata::instance()
{
    static NoteMetadata *s_instance = new NoteMetadata();
    return s_instance;
}

NoteMetadata *NoteMetadata::create(QQmlEngine *, QJSEngine *)
{
    auto *self = instance();
    QJSEngine::setObjectOwnership(self, QJSEngine::CppOwnership);
    return self;
}

int NoteMetadata::revision() const
{
    return m_revision;
}

FrontMatter::Meta NoteMetadata::metaForFile(const QString &filePath) const
{
    const QFileInfo info(filePath);
    if (!info.isFile()) {
        return {};
    }
    auto it = m_cache.constFind(filePath);
    if (it != m_cache.constEnd() && it->modified == info.lastModified() && it->size == info.size()) {
        return it->meta;
    }
    CacheEntry entry;
    entry.modified = info.lastModified();
    entry.size = info.size();
    entry.meta = FrontMatter::parse(FrontMatter::readRawFromFile(filePath));
    m_cache.insert(filePath, entry);
    return entry.meta;
}

QDateTime NoteMetadata::createdForFile(const QString &filePath) const
{
    const QDateTime created = metaForFile(filePath).created;
    return created.isValid() ? created : FrontMatter::fileCreationTime(filePath);
}

QVariantMap NoteMetadata::read(const QUrl &note) const
{
    const QString path = localPath(note);
    const FrontMatter::Meta meta = metaForFile(path);
    const QDateTime created = meta.created.isValid() ? meta.created : FrontMatter::fileCreationTime(path);
    return {
        {u"id"_s, meta.id},
        {u"created"_s, created},
        {u"createdText"_s, formatCreated(created)},
        {u"icon"_s, meta.icon},
        {u"isEmoji"_s, isEmoji(meta.icon)},
        {u"tags"_s, meta.tags},
        {u"title"_s, meta.title},
    };
}

bool NoteMetadata::editFrontMatter(const QString &filePath, const std::function<QString(const QString &)> &edit)
{
    QFile in(filePath);
    if (!in.open(QFile::ReadOnly)) {
        return false;
    }
    const FrontMatter::Split parts = FrontMatter::split(QString::fromUtf8(in.readAll()));
    in.close();

    QString raw = parts.present ? parts.raw : FrontMatter::initialRaw(FrontMatter::fileCreationTime(filePath));
    if (FrontMatter::value(raw, u"id"_s).toString().isEmpty()) {
        raw = FrontMatter::setValue(raw, u"id"_s, FrontMatter::newId());
    }
    raw = edit(raw);

    QSaveFile out(filePath);
    if (!out.open(QFile::WriteOnly)) {
        return false;
    }
    out.write(FrontMatter::join(raw, parts.body).toUtf8());
    if (!out.commit()) {
        return false;
    }
    bump(filePath);
    return true;
}

void NoteMetadata::bump(const QString &path)
{
    m_cache.remove(path);
    ++m_revision;
    Q_EMIT metadataChanged(path);
    Q_EMIT revisionChanged();
}

QString NoteMetadata::imageLink(const QUrl &note, const QUrl &image, const QString &notebookPath)
{
    const QString notePath = note.isLocalFile() ? note.toLocalFile() : note.toString();
    const QString imagePath = image.isLocalFile() ? image.toLocalFile() : image.toString();
    if (!image.isLocalFile() && !image.isRelative()) {
        return image.toString(); // a web image stays a web link
    }
    const QString notebook = notebookPath.startsWith(u"file:"_s) ? QUrl(notebookPath).toLocalFile() : notebookPath;
    QString error;
    const QString link = ImageLinks::linkForNewImage(notePath, imagePath, notebook, &error);
    if (link.isEmpty()) {
        Q_EMIT statusMessage(error);
    } else {
        bump(notePath);
    }
    return link;
}

QString NoteMetadata::makeImageLinksRelative(const QString &notebookPath)
{
    const QString notebook = notebookPath.startsWith(u"file:"_s) ? QUrl(notebookPath).toLocalFile() : notebookPath;
    beginRewrite();
    const ImageLinks::Report r = ImageLinks::makeRelative(notebook);
    endRewrite(r.changedNotes);
    QString summary;
    if (r.rewritten == 0 && r.missing == 0 && r.errors.isEmpty()) {
        summary = i18n("All image links in this notebook are already relative.");
    } else {
        summary = i18np("Made 1 image link relative", "Made %1 image links relative", r.rewritten);
        if (r.copied) {
            summary += i18np(", copied 1 image into the notebook", ", copied %1 images into the notebook", r.copied);
        }
        if (r.missing) {
            summary += i18np(", 1 image not found", ", %1 images not found", r.missing);
        }
        if (!r.errors.isEmpty()) {
            summary += u". "_s + r.errors.first();
        }
        summary += u'.';
    }
    Q_EMIT statusMessage(summary);
    return summary;
}

void NoteMetadata::beginRewrite()
{
    Q_EMIT aboutToRewriteNotes();
}

void NoteMetadata::endRewrite(const QStringList &changedNotes)
{
    if (changedNotes.isEmpty()) {
        return;
    }
    QList<QUrl> urls;
    for (const QString &path : changedNotes) {
        urls << QUrl::fromLocalFile(path);
        m_cache.remove(path);
        m_bodyCache.remove(path);
    }
    ++m_revision;
    Q_EMIT revisionChanged();
    Q_EMIT notesRewritten(urls);
}

void NoteMetadata::filesChanged(const QStringList &paths)
{
    for (const QString &path : paths) {
        m_cache.remove(path);
        m_bodyCache.remove(path);
    }
    ++m_revision;
    Q_EMIT revisionChanged();
}

bool NoteMetadata::setIcon(const QUrl &note, const QString &icon)
{
    return editFrontMatter(localPath(note), [&icon](const QString &raw) {
        return FrontMatter::setValue(raw, u"icon"_s, icon.trimmed());
    });
}

bool NoteMetadata::setTags(const QUrl &note, const QStringList &tags)
{
    QStringList clean;
    for (const QString &tag : tags) {
        const QString t = normalizeTag(tag);
        if (!t.isEmpty() && !clean.contains(t)) {
            clean << t;
        }
    }
    return editFrontMatter(localPath(note), [&clean](const QString &raw) {
        return FrontMatter::setValue(raw, u"tags"_s, clean);
    });
}

bool NoteMetadata::addTag(const QUrl &note, const QString &tag)
{
    QStringList tags = metaForFile(localPath(note)).tags;
    const QString t = normalizeTag(tag);
    if (t.isEmpty() || tags.contains(t)) {
        return false;
    }
    tags << t;
    return setTags(note, tags);
}

bool NoteMetadata::removeTag(const QUrl &note, const QString &tag)
{
    QStringList tags = metaForFile(localPath(note)).tags;
    if (!tags.removeAll(tag)) {
        return false;
    }
    return setTags(note, tags);
}

QString NoteMetadata::folderIconForPath(const QString &folderPath) const
{
    const QString dotDirectory = folderPath + u"/.directory"_s;
    if (!QFile::exists(dotDirectory)) {
        return {};
    }
    const KConfig config(dotDirectory, KConfig::SimpleConfig);
    const KConfigGroup group = config.group(QString::fromLatin1(desktopGroup));
    const QString emoji = group.readEntry(emojiKey, QString());
    return emoji.isEmpty() ? group.readEntry("Icon", QString()) : emoji;
}

QString NoteMetadata::folderIcon(const QUrl &folder) const
{
    return folderIconForPath(localPath(folder));
}

bool NoteMetadata::setFolderIcon(const QUrl &folder, const QString &icon)
{
    const QString path = localPath(folder);
    if (!QFileInfo(path).isDir()) {
        return false;
    }
    KConfig config(path + u"/.directory"_s, KConfig::SimpleConfig);
    KConfigGroup group = config.group(QString::fromLatin1(desktopGroup));
    const QString value = icon.trimmed();
    // Emoji live in a Marknote key so Dolphin's own "Icon" stays a valid theme icon name.
    if (value.isEmpty()) {
        group.deleteEntry(emojiKey);
        group.deleteEntry("Icon");
    } else if (isEmoji(value)) {
        group.writeEntry(emojiKey, value);
        group.deleteEntry("Icon");
    } else {
        group.writeEntry("Icon", value);
        group.deleteEntry(emojiKey);
    }
    const bool ok = config.sync();
    bump(path);
    return ok;
}

bool NoteMetadata::noteContains(const QString &filePath, const QString &text) const
{
    const QString needle = text.trimmed().toLower();
    if (needle.isEmpty()) {
        return true;
    }
    QString path = filePath;
    if (path.startsWith(u"file://"_s)) {
        path = QUrl(path).toLocalFile();
    }
    const QFileInfo info(path);
    if (!info.isFile()) {
        return false;
    }
    auto it = m_bodyCache.constFind(path);
    if (it == m_bodyCache.constEnd() || it->modified != info.lastModified() || it->size != info.size()) {
        QFile file(path);
        if (!file.open(QFile::ReadOnly)) {
            return false;
        }
        BodyEntry entry;
        entry.modified = info.lastModified();
        entry.size = info.size();
        // Notes are small; cap at 4 MiB so a stray huge file cannot stall filtering.
        entry.lowerBody = FrontMatter::split(QString::fromUtf8(file.read(4 * 1024 * 1024))).body.toLower();
        it = m_bodyCache.insert(path, entry);
    }
    return it->lowerBody.contains(needle);
}

QVariantList NoteMetadata::tagsInNotebook(const QString &notebookPath) const
{
    QString root = QUrl::fromUserInput(notebookPath).toLocalFile();
    if (root.isEmpty()) {
        root = notebookPath;
    }
    QMap<QString, int> counts;
    QDirIterator it(root, {u"*.md"_s}, QDir::Files, QDirIterator::Subdirectories);
    while (it.hasNext()) {
        const QString file = it.next();
        for (const QString &tag : metaForFile(file).tags) {
            counts[tag] += 1;
        }
    }
    QVariantList result;
    for (auto c = counts.cbegin(); c != counts.cend(); ++c) {
        result.append(QVariantMap{{u"name"_s, c.key()}, {u"count"_s, c.value()}});
    }
    return result;
}

bool NoteMetadata::isEmoji(const QString &icon)
{
    for (const QChar c : icon) {
        if (c.unicode() > 0x7f) {
            return true;
        }
    }
    return false;
}

QString NoteMetadata::formatCreated(const QDateTime &created) const
{
    if (!created.isValid()) {
        return {};
    }
    const QDate date = created.date();
    const QDate today = QDate::currentDate();
    if (date == today || date == today.addDays(-1)) {
        return KFormat().formatRelativeDateTime(created, QLocale::ShortFormat);
    }
    return QLocale().toString(date, QLocale::ShortFormat);
}

QString NoteMetadata::normalizeTag(const QString &tag)
{
    QString t = tag.trimmed();
    while (t.startsWith(u'#')) {
        t.remove(0, 1);
    }
    t.replace(QRegularExpression(u"\\s+"_s), u"-"_s);
    t.remove(u',');
    return t;
}

#include "moc_notemetadata.cpp"
