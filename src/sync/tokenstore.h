// SPDX-FileCopyrightText: 2026 Marknote fork contributors
// SPDX-License-Identifier: GPL-2.0-only OR GPL-3.0-only OR LicenseRef-KDE-Accepted-GPL

#pragma once

#include <QString>
#include <QStringList>

#include <functional>
#include <memory>
#include <vector>

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

/**
 * Tries stores in order: a store that fails (cannot be opened or written) is
 * skipped and the next one is used. Loading also looks in later stores, so a
 * sign-in saved by a fallback is found again. description() names the store
 * in use.
 */
class ChainTokenStore : public TokenStore
{
public:
    explicit ChainTokenStore(std::vector<std::unique_ptr<TokenStore>> stores);
    QString description() const override;
    void load(const QString &key, LoadCallback done) override;
    void save(const QString &key, const QString &secret, SaveCallback done) override;
    void remove(const QString &key) override;

private:
    void loadFrom(size_t index, const QString &key, LoadCallback done, QStringList errors);
    void saveTo(size_t index, const QString &key, const QString &secret, SaveCallback done, QStringList errors);
    std::vector<std::unique_ptr<TokenStore>> m_stores;
    size_t m_active = 0;
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
