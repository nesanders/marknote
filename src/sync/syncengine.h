// SPDX-FileCopyrightText: 2026 Marknote fork contributors
// SPDX-License-Identifier: GPL-2.0-only OR GPL-3.0-only OR LicenseRef-KDE-Accepted-GPL

#pragma once

#include "remotebackend.h"
#include "../crypto/vaultcrypto.h"

#include <QHash>
#include <QSet>
#include <QString>
#include <QStringList>

#include <functional>

namespace Sync
{

/// What the last successful sync saw: content hash per file, and folders.
struct SyncState {
    QHash<QString, QByteArray> files; ///< relative path -> hex md5 at last sync
    QSet<QString> folders;
    /// Relative path -> the destination's id ("" = the notebook folder).
    /// Lets the app link to a note on Google Drive.
    QHash<QString, QString> ids;

    static SyncState load(const QString &filePath);
    bool save(const QString &filePath) const;
};

/// One thing a sync did to one file.
struct SyncChange {
    enum Kind {
        Received, ///< new or changed on the destination, written here
        Sent, ///< new or changed here, written there
        DeletedHere, ///< deleted on the destination, moved to .marknote/trash here
        DeletedThere, ///< deleted here, trashed on the destination
        Conflict, ///< changed on both sides: path kept ours, copy holds theirs
    };
    Kind kind;
    QString path; ///< relative to the notebook
    QString copy; ///< Conflict: relative path of the copy with the other version
};

struct SyncResult {
    QList<SyncChange> log; ///< in the order they happened
    int uploaded = 0;
    int downloaded = 0;
    int deletedLocal = 0; ///< moved to .marknote/trash
    int deletedRemote = 0; ///< trashed on the destination
    int conflicts = 0;
    QStringList conflictCopies; ///< relative paths of conflict copies created locally
    QStringList changedLocalPaths; ///< local files written or removed (editor must reload)
    QStringList errors;
    /// Plain notes in an encrypted notebook that was locked: not sent, so
    /// they never reach the destination unencrypted.
    QStringList heldBack;
    int oldVersionsDeleted = 0;
    int trashDeleted = 0;

    bool ok() const
    {
        return errors.isEmpty();
    }
    int changes() const
    {
        return uploaded + downloaded + deletedLocal + deletedRemote + conflicts;
    }
};

/**
 * Two-way sync between a local notebook folder and a RemoteBackend.
 *
 * Each file is compared three ways: its local content, the remote content and
 * the content both had at the last sync (SyncState), by MD5. Whichever side
 * changed wins; when both changed, the local version stays in place and is
 * uploaded, and the remote version is kept next to it as a conflict copy, so
 * nothing is lost. Deletions are recoverable: local files go to
 * .marknote/trash/, remote files to the destination's trash.
 *
 * run() blocks; call it from a worker thread.
 */
class SyncEngine
{
public:
    using Progress = std::function<void(const QString &message)>;

    SyncEngine(const QString &localRoot, RemoteBackend *backend, const QString &statePath);

    SyncResult run(const Progress &progress = {});

    /// The notebook key while the notebook is unlocked (called on the sync thread).
    using KeyProvider = std::function<std::optional<VaultCrypto::Key>()>;
    void setKeyProvider(const KeyProvider &provider);
    /// Also delete readable leftovers at the destination: earlier versions of
    /// every note and this notebook's trash (after encrypting it).
    void setPurgeReadable(bool purge);

    static QByteArray md5Hex(const QByteArray &data);
    /// Paths the engine never syncs (its own state, the local trash).
    static bool isExcluded(const QString &relativePath);

    /// What of a local file is synced. Device-local keys (the note last opened
    /// in a notebook, kept in its .directory) are left out, so they never conflict.
    static QByteArray syncedContent(const QString &relativePath, const QByteArray &localData);
    /// Incoming content plus the device-local keys of the file it replaces.
    static QByteArray withLocalKeys(const QString &relativePath, const QByteArray &incoming, const QByteArray &currentLocal);
    /// "Note (conflict 2026-11-24 0912).md" next to @p relativePath, unique on disk.
    QString conflictCopyPath(const QString &relativePath) const;

private:
    bool writeLocal(const QString &relativePath, const QByteArray &data, QString *error);
    bool trashLocal(const QString &relativePath, QString *error);
    QString absolute(const QString &relativePath) const;

    QString m_root;
    RemoteBackend *m_backend;
    QString m_statePath;
    QString m_trashStamp;
    KeyProvider m_keyProvider;
    bool m_purgeReadable = false;
};

} // namespace Sync
