// SPDX-FileCopyrightText: 2026 Marknote fork contributors
// SPDX-License-Identifier: GPL-2.0-only OR GPL-3.0-only OR LicenseRef-KDE-Accepted-GPL

#pragma once

#include "vaultcrypto.h"

#include <QHash>
#include <QMutex>
#include <QObject>
#include <QQmlEngine>
#include <QTimer>
#include <QUrl>

/**
 * Encrypted notebooks: which are encrypted, which are unlocked (keys kept in
 * memory only), and the operations on them. Thread safe for NoteIO.
 */
class Vaults : public QObject
{
    Q_OBJECT
    QML_ELEMENT
    QML_SINGLETON

    Q_PROPERTY(QString lastError READ lastError NOTIFY lastErrorChanged)
    Q_PROPERTY(int revision READ revision NOTIFY changed)
    Q_PROPERTY(bool hasUnlocked READ hasUnlocked NOTIFY changed)

public:
    static Vaults *instance();
    static Vaults *create(QQmlEngine *, QJSEngine *);

    static QString vaultFile(const QString &notebook);
    /// The encrypted notebook containing @p path, or an empty string.
    static QString notebookOf(const QString &path);

    bool hasUnlocked() const;
    /// Show an encryption-related error to the user (via lastError).
    void reportError(const QString &error)
    {
        setError(error);
        Q_EMIT notice(error);
    }
    Q_INVOKABLE bool isEncrypted(const QString &notebookOrNote) const;
    Q_INVOKABLE bool isUnlocked(const QString &notebookOrNote) const;
    /// Encrypted and not unlocked: its notes cannot be read now.
    Q_INVOKABLE bool isLocked(const QString &notebookOrNote) const;

    Q_INVOKABLE bool unlock(const QString &notebook, const QString &password);
    Q_INVOKABLE bool unlockWithRecoveryKey(const QString &notebook, const QString &recoveryKey);
    Q_INVOKABLE void lock(const QString &notebook);
    Q_INVOKABLE void lockAll();

    /// Encrypt every note of a notebook; returns the recovery key to show, or "" on error.
    Q_INVOKABLE QString encryptNotebook(const QString &notebook, const QString &password);
    Q_INVOKABLE bool changePassword(const QString &notebook, const QString &currentPassword, const QString &newPassword);
    /// Decrypt every note and delete the vault.
    Q_INVOKABLE bool removeEncryption(const QString &notebook, const QString &password);

    QString lastError() const;
    int revision() const;

    /// The notebook key, if unlocked (any thread). Counts as activity for auto-lock.
    std::optional<VaultCrypto::Key> keyFor(const QString &notebook);

Q_SIGNALS:
    void changed();
    void lastErrorChanged();
    /// A problem the window should show (not tied to an open dialog).
    void notice(const QString &message);
    /// About to lock: save open edits now (the key is still there).
    void aboutToLock(const QString &notebook);
    /// A notebook was locked (the open note must be closed).
    void locked(const QString &notebook);

private:
    explicit Vaults(QObject *parent = nullptr);
    static QString clean(const QString &path);
    std::optional<VaultCrypto::Vault> readVault(const QString &notebook);
    bool writeVault(const QString &notebook, const VaultCrypto::Vault &vault);
    void setError(const QString &error);
    void setKey(const QString &notebook, const VaultCrypto::Key &key);
    void checkAutoLock();
    /// Re-encrypt / decrypt all notes of a notebook; the changed files.
    QStringList rewriteNotes(const QString &notebook, const std::function<std::optional<QString>(const QString &, QString *)> &convert);

    mutable QMutex m_mutex;
    QHash<QString, VaultCrypto::Key> m_keys; ///< notebook -> key
    QHash<QString, qint64> m_lastUse; ///< notebook -> ms
    QString m_lastError;
    int m_revision = 0;
    QTimer m_autoLock;
};

/// Reading and writing notes, encrypted or not.
namespace NoteIO
{
enum class Status {
    Ok, ///< plain note, or decrypted
    Locked, ///< encrypted and its notebook is locked
    Error,
};

/// The note's text (decrypted when needed).
Status read(const QString &path, QString *text, QString *error = nullptr);
/// Convenience: the text, or an empty string if it cannot be read now.
QString readText(const QString &path);
/// Write a note: encrypted if its notebook is encrypted (refuses while locked).
bool write(const QString &path, const QString &text, QString *error = nullptr);
}
