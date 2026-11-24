// SPDX-FileCopyrightText: 2026 Marknote fork contributors
// SPDX-License-Identifier: GPL-2.0-only OR GPL-3.0-only OR LicenseRef-KDE-Accepted-GPL

#pragma once

#include <QList>
#include <QString>
#include <QStringList>

/**
 * Image links in notes, kept relative to the note so a notebook folder can be
 * copied, synced or moved anywhere (the convention of Obsidian, GitHub and the
 * Marknote web app). Images that belong to a note live next to it as
 * "<Note>_<timestamp>.<ext>".
 *
 * All functions take absolute local paths.
 */
namespace ImageLinks
{

struct Link {
    qsizetype from = 0; ///< position of the destination in the text (inside the parentheses)
    qsizetype to = 0;
    QString target; ///< as written, e.g. "a%20b.png", "<a b.png>", "file:///…"
};

struct Report {
    int rewritten = 0; ///< links changed
    int copied = 0; ///< images copied into the notebook
    int moved = 0; ///< images moved along with their note
    int missing = 0; ///< links to images that do not exist
    QStringList changedNotes; ///< notes whose text was rewritten
    QStringList errors;
    void add(const Report &other);
};

/// Image links in Markdown text, skipping code blocks and inline code.
QList<Link> find(const QString &text);

/// Absolute local path a link points to, from the note's folder; empty for
/// web/data links.
QString resolve(const QString &target, const QString &noteDir);

/// True for links written relative to the note.
bool isRelative(const QString &target);

/// Link text for an image, relative to @p fromDir (spaces and parentheses encoded).
QString relativeLink(const QString &fromDir, const QString &imagePath);

/// A file name not yet used in @p dir: "<base>_<ms>.<ext>".
QString attachmentPath(const QString &dir, const QString &noteBaseName, const QString &suffix);

/// True if @p path is inside @p dir (or is it).
bool isInside(const QString &path, const QString &dir);

/**
 * The link to insert for an image chosen by the user: relative if the image is
 * already in the notebook, otherwise the image is first copied next to the note.
 */
QString linkForNewImage(const QString &notePath, const QString &imagePath, const QString &notebookDir, QString *error = nullptr);

/**
 * A note was moved from @p oldNotePath (in @p oldNotebook) to @p newNotePath (in
 * @p newNotebook). Rewrites its relative image links; the note's own images
 * ("<Note>_…" next to it) move with it, images from another notebook are copied.
 */
Report noteMoved(const QString &oldNotePath, const QString &newNotePath, const QString &oldNotebook, const QString &newNotebook);

/// A folder (and everything in it) was moved; fixes links pointing out of it.
Report folderMoved(const QString &oldFolder, const QString &newFolder, const QString &oldNotebook, const QString &newNotebook);

/**
 * Turn absolute image links (file:///…, /home/…) in every note of a notebook into
 * relative ones. Images outside the notebook are copied next to the note.
 */
Report makeRelative(const QString &notebookDir);

}
