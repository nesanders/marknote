// SPDX-FileCopyrightText: 2026 Marknote fork contributors
// SPDX-License-Identifier: GPL-2.0-only OR GPL-3.0-only OR LicenseRef-KDE-Accepted-GPL

#pragma once

#include <QByteArray>
#include <QJsonObject>
#include <QString>

#include <optional>

/**
 * Encrypted notebooks, format version 1 (docs/encryption.md): libsodium
 * Argon2id for passwords, XChaCha20-Poly1305 for keys and notes.
 */
namespace VaultCrypto
{

/// Initialise libsodium; false if it cannot be used.
bool init();

/// A key that is wiped from memory when it goes away.
class Key
{
public:
    Key() = default;
    explicit Key(QByteArray bytes);
    Key(const Key &other);
    Key &operator=(const Key &other);
    ~Key();
    bool isValid() const;
    const QByteArray &bytes() const;
    void wipe();

private:
    QByteArray m_bytes;
};

struct Vault {
    quint64 opslimit = 3;
    quint64 memlimit = 64ull * 1024 * 1024;
    QByteArray salt;
    QByteArray passwordNonce;
    QByteArray passwordKey; ///< wrapped notebook key
    QByteArray recoveryNonce;
    QByteArray recoveryKey; ///< wrapped notebook key
    QString created;
    QJsonObject extra; ///< unknown keys, kept when writing

    static std::optional<Vault> fromJson(const QByteArray &json, QString *error = nullptr);
    QByteArray toJson() const;
};

struct Created {
    Vault vault;
    Key notebookKey;
    QString recoveryKey; ///< to show the user once
};

/// A new vault for @p password: random notebook key, password and recovery wrapping.
std::optional<Created> createVault(const QString &password, QString *error = nullptr);
/// The notebook key, or nothing if the password is wrong.
std::optional<Key> unlockWithPassword(const Vault &vault, const QString &password);
std::optional<Key> unlockWithRecoveryKey(const Vault &vault, const QString &recoveryKey);
/// Rewrap the notebook key for a new password (new salt). Notes are unchanged.
std::optional<Vault> changePassword(const Vault &vault, const Key &notebookKey, const QString &newPassword);

/// "ABCD-EFGH-…" (52 Base32 characters) for 32 bytes.
QString encodeRecoveryKey(const QByteArray &bytes);
/// Forgiving parse (case, spaces, dashes, 0/1/8 typos); nothing if malformed.
std::optional<QByteArray> decodeRecoveryKey(const QString &text);

/// True if @p text is an encrypted note envelope.
bool isEncryptedNote(const QString &text);
/// The plaintext display title of an envelope, if it has one.
QString envelopeTitle(const QString &text);
/// The envelope for a note; @p title is optional.
QString encryptNote(const QString &plaintext, const Key &key, const QString &title = {});
/// The note inside an envelope, or nothing (wrong key, damaged file).
std::optional<QString> decryptNote(const QString &envelope, const Key &key, QString *error = nullptr);

}
