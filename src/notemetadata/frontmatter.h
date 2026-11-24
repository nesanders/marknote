// SPDX-FileCopyrightText: 2026 Marknote fork contributors
// SPDX-License-Identifier: GPL-2.0-only OR GPL-3.0-only OR LicenseRef-KDE-Accepted-GPL

#pragma once

#include <QDateTime>
#include <QString>
#include <QStringList>
#include <QVariant>

/**
 * Minimal YAML front matter support for notes.
 *
 * A note may start with a block delimited by "---" lines:
 *
 *     ---
 *     id: 01JDZ3K6Q8V5S0J9M2X7T4C1BE
 *     created: 2026-11-24T09:12:00
 *     icon: "🎨"
 *     tags: [design, planning]
 *     ---
 *
 * Only the subset of YAML that notes need is understood (top-level scalar
 * keys, flow lists and block lists). Keys this code does not know about are
 * preserved verbatim when the block is rewritten, so files edited by other
 * tools (e.g. Obsidian) keep their metadata.
 */
namespace FrontMatter
{

struct Split {
    bool present = false; ///< true if the text started with a front matter block
    QString raw; ///< YAML between the delimiters, without the "---" lines
    QString body; ///< Markdown after the block
};

/// Split a note's text into front matter and body.
Split split(const QString &text);

/// Reassemble a note. An empty @p raw produces just the body.
QString join(const QString &raw, const QString &body);

/// Parsed view of the keys Marknote uses.
struct Meta {
    QString id;
    QDateTime created;
    QString icon;
    QStringList tags;
    QString title; ///< display title (used for encrypted notes later)
};

Meta parse(const QString &raw);

/// Read a single top-level value. Lists come back as QStringList.
QVariant value(const QString &raw, const QString &key);

/// Set (or, for a null/empty value, remove) a top-level key, preserving all other lines.
QString setValue(const QString &raw, const QString &key, const QVariant &value);

/// Read the front matter block of a file without loading the whole note.
QString readRawFromFile(const QString &filePath, bool *present = nullptr);

/// A new sortable unique note id (ULID, Crockford base32).
QString newId();

/// Best available creation time for a file: birth time, else modification time.
QDateTime fileCreationTime(const QString &filePath);

/// A front matter block for a brand new note.
QString initialRaw(const QDateTime &created);

}
