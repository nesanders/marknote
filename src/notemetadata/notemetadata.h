// SPDX-FileCopyrightText: 2026 Marknote fork contributors
// SPDX-License-Identifier: GPL-2.0-only OR GPL-3.0-only OR LicenseRef-KDE-Accepted-GPL

#pragma once

#include "frontmatter.h"

#include <QDateTime>
#include <QHash>
#include <QObject>
#include <QQmlEngine>
#include <QUrl>
#include <QVariant>

#include <functional>

/**
 * Note and folder metadata: icon/emoji, tags, created date, stable id.
 *
 * Notes keep it in YAML front matter (see FrontMatter); folders keep their
 * icon in the Dolphin-compatible ".directory" file. Reads are cached per file
 * and invalidated by modification time, so list views can query freely.
 */
class NoteMetadata : public QObject
{
    Q_OBJECT
    QML_ELEMENT
    QML_SINGLETON

    /// Bumped whenever any note's metadata changes; bind to it to refresh.
    Q_PROPERTY(int revision READ revision NOTIFY revisionChanged)

public:
    static NoteMetadata *instance();
    static NoteMetadata *create(QQmlEngine *qmlEngine, QJSEngine *jsEngine);

    int revision() const;

    /// Cached metadata for a note file (local path).
    FrontMatter::Meta metaForFile(const QString &filePath) const;
    /// Creation time from front matter, else the file's birth/modification time.
    QDateTime createdForFile(const QString &filePath) const;

    /// {id, created, createdText, icon, isEmoji, tags, title} for a note.
    Q_INVOKABLE QVariantMap read(const QUrl &note) const;

    Q_INVOKABLE bool setIcon(const QUrl &note, const QString &icon);
    Q_INVOKABLE bool setTags(const QUrl &note, const QStringList &tags);
    Q_INVOKABLE bool addTag(const QUrl &note, const QString &tag);
    Q_INVOKABLE bool removeTag(const QUrl &note, const QString &tag);

    /// Folder icon or emoji ("" when unset).
    Q_INVOKABLE QString folderIcon(const QUrl &folder) const;
    QString folderIconForPath(const QString &folderPath) const;
    Q_INVOKABLE bool setFolderIcon(const QUrl &folder, const QString &icon);

    /// Whether the note's body (front matter excluded) contains @p text, case-insensitively.
    Q_INVOKABLE bool noteContains(const QString &filePath, const QString &text) const;

    /// Every tag used in a notebook: [{name, count}], sorted by name.
    Q_INVOKABLE QVariantList tagsInNotebook(const QString &notebookPath) const;

    /// True when @p icon is an emoji rather than an icon theme name.
    Q_INVOKABLE static bool isEmoji(const QString &icon);

    /// "Today at 09:12", "Yesterday at …", or a short date.
    Q_INVOKABLE QString formatCreated(const QDateTime &created) const;
    /// Shorter form for narrow lists: the time today, "Nov 20" this year, else the short date.
    Q_INVOKABLE QString formatCreatedShort(const QDateTime &created) const;

    /// Normalise a user-entered tag: trimmed, no leading '#', spaces → '-'.
    Q_INVOKABLE static QString normalizeTag(const QString &tag);

    /// Files were changed behind our back (e.g. by sync); re-read them.
    Q_INVOKABLE void filesChanged(const QStringList &paths);

    /// Manual order of a folder's notes and subfolders (file names, from
    /// "X-Marknote-Order" in its .directory). Names not listed come last.
    QStringList folderOrder(const QString &folderPath) const;
    /// Sort key for the manual order: listed entries by position, then the
    /// rest by name.
    QString manualSortKey(const QString &filePath) const;
    /// Put @p name before or after @p target in @p folder's manual order (the
    /// whole current order is written, so what the user sees stays put).
    Q_INVOKABLE bool placeInOrder(const QString &folder, const QString &name, const QString &target, bool after);
    /// Keep a renamed entry's place.
    void renameInOrder(const QString &folder, const QString &oldName, const QString &newName);

    /// Link text for an image the user inserts into a note: relative, after
    /// copying the image next to the note if it is outside the notebook.
    Q_INVOKABLE QString imageLink(const QUrl &note, const QUrl &image, const QString &notebookPath);

    /// Rewrite absolute image links of a notebook as relative ones. Returns a summary.
    Q_INVOKABLE QString makeImageLinksRelative(const QString &notebookPath);

    /// Around rewriting note files on disk (moves, link conversion), so open
    /// editors save first and reload after.
    void beginRewrite();
    void endRewrite(const QStringList &changedNotes);

Q_SIGNALS:
    void aboutToRewriteNotes();
    void notesRewritten(const QList<QUrl> &notes);
    void statusMessage(const QString &message);
    void revisionChanged();
    void metadataChanged(const QString &path);
    /// A folder's manual order changed (also after a sync brought a new one).
    void orderChanged(const QString &folder);

private:
    explicit NoteMetadata(QObject *parent = nullptr);
    bool editFrontMatter(const QString &filePath, const std::function<QString(const QString &)> &edit);
    void bump(const QString &path);

    struct CacheEntry {
        QDateTime modified;
        qint64 size = -1;
        FrontMatter::Meta meta;
    };
    mutable QHash<QString, CacheEntry> m_cache;

    struct BodyEntry {
        QDateTime modified;
        qint64 size = -1;
        QString lowerBody;
    };
    mutable QHash<QString, BodyEntry> m_bodyCache;
    mutable QHash<QString, QStringList> m_orderCache;
    bool writeOrder(const QString &folder, const QStringList &order);
    int m_revision = 0;
};
