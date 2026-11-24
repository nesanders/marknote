// SPDX-FileCopyrightText: 2026 Marknote fork contributors
// SPDX-License-Identifier: GPL-2.0-only OR GPL-3.0-only OR LicenseRef-KDE-Accepted-GPL

#pragma once

#include <QString>

#include <functional>
#include <memory>

namespace Sync
{

/**
 * Where OAuth refresh tokens live. The secret never goes into marknoterc or
 * into a notebook folder (which may itself be synced).
 */
class TokenStore
{
public:
    using LoadCallback = std::function<void(bool ok, const QString &secret, const QString &error)>;
    using SaveCallback = std::function<void(bool ok, const QString &error)>;

    virtual ~TokenStore() = default;

    /// Human readable, shown in the sync dialog ("KDE Wallet", …).
    virtual QString description() const = 0;
    /// Callbacks run on the thread that called (the main thread).
    virtual void load(const QString &key, LoadCallback done) = 0;
    virtual void save(const QString &key, const QString &secret, SaveCallback done) = 0;
    virtual void remove(const QString &key) = 0;

    /// KDE Wallet when available, otherwise a private (0600) file in the app data dir.
    static std::unique_ptr<TokenStore> createDefault();
};

/// Plain file store: one file per key, readable only by the user.
class FileTokenStore : public TokenStore
{
public:
    explicit FileTokenStore(const QString &directory);
    QString description() const override;
    void load(const QString &key, LoadCallback done) override;
    void save(const QString &key, const QString &secret, SaveCallback done) override;
    void remove(const QString &key) override;

private:
    QString pathFor(const QString &key) const;
    QString m_dir;
};

} // namespace Sync
