// SPDX-FileCopyrightText: 2026 Marknote fork contributors
// SPDX-License-Identifier: GPL-2.0-only OR GPL-3.0-only OR LicenseRef-KDE-Accepted-GPL

#include "tokenstore.h"

#include <KLocalizedString>

#include <QDir>
#include <QFile>
#include <QPointer>
#include <QSaveFile>
#include <QStandardPaths>

#ifdef HAVE_KWALLET
#include <KWallet>
#endif
#ifdef HAVE_QTDBUS
#include <QDBusConnection>
#include <QDBusConnectionInterface>
#include <QDBusInterface>
#include <QDBusPendingCallWatcher>
#include <QDBusPendingReply>
#include <QDBusReply>
#endif
#ifdef HAVE_LIBSECRET
#undef signals // GLib headers use "signals" as an identifier
#include <libsecret/secret.h>
#endif

using namespace Qt::StringLiterals;

namespace Sync
{

FileTokenStore::FileTokenStore(const QString &directory)
    : m_dir(directory)
{
}

QString FileTokenStore::description() const
{
    return i18nc("@info where the sign-in token is stored", "a private file in your user folder");
}

QString FileTokenStore::pathFor(const QString &key) const
{
    QString safe = key;
    for (QChar &c : safe) {
        if (!c.isLetterOrNumber() && c != u'-' && c != u'_') {
            c = u'_';
        }
    }
    return m_dir + u'/' + safe;
}

void FileTokenStore::load(const QString &key, LoadCallback done)
{
    QFile f(pathFor(key));
    if (!f.exists()) {
        done(true, QString(), QString());
        return;
    }
    if (!f.open(QFile::ReadOnly)) {
        done(false, QString(), f.errorString());
        return;
    }
    done(true, QString::fromUtf8(f.readAll()).trimmed(), QString());
}

void FileTokenStore::save(const QString &key, const QString &secret, SaveCallback done)
{
    QDir().mkpath(m_dir);
    QSaveFile f(pathFor(key));
    if (!f.open(QFile::WriteOnly)) {
        done(false, f.errorString());
        return;
    }
    f.setPermissions(QFile::ReadOwner | QFile::WriteOwner);
    f.write(secret.toUtf8());
    if (!f.commit()) {
        done(false, f.errorString());
        return;
    }
    QFile::setPermissions(pathFor(key), QFile::ReadOwner | QFile::WriteOwner);
    done(true, QString());
}

void FileTokenStore::remove(const QString &key)
{
    QFile::remove(pathFor(key));
}

#ifdef HAVE_KWALLET
namespace
{
const auto walletFolder = u"Marknote"_s;

class WalletTokenStore : public TokenStore
{
public:
    ~WalletTokenStore() override
    {
        delete m_wallet;
    }

    QString description() const override
    {
        return i18nc("@info where the sign-in token is stored", "KDE Wallet");
    }

    void load(const QString &key, LoadCallback done) override
    {
        withWallet([key, done](KWallet::Wallet *w, const QString &error) {
            if (!w) {
                done(false, QString(), error);
                return;
            }
            QString value;
            if (w->hasEntry(key) && w->readPassword(key, value) != 0) {
                done(false, QString(), i18n("Could not read from KDE Wallet."));
                return;
            }
            done(true, value, QString());
        });
    }

    void save(const QString &key, const QString &secret, SaveCallback done) override
    {
        withWallet([key, secret, done](KWallet::Wallet *w, const QString &error) {
            if (!w) {
                done(false, error);
                return;
            }
            if (w->writePassword(key, secret) != 0) {
                done(false, i18n("Could not write to KDE Wallet."));
                return;
            }
            done(true, QString());
        });
    }

    void remove(const QString &key) override
    {
        withWallet([key](KWallet::Wallet *w, const QString &) {
            if (w) {
                w->removeEntry(key);
            }
        });
    }

private:
    using WalletJob = std::function<void(KWallet::Wallet *, const QString &error)>;

    static bool prepareFolder(KWallet::Wallet *w)
    {
        if (!w->hasFolder(walletFolder) && !w->createFolder(walletFolder)) {
            return false;
        }
        return w->setFolder(walletFolder);
    }

    void withWallet(WalletJob job)
    {
        if (m_wallet && m_wallet->isOpen()) {
            job(prepareFolder(m_wallet) ? m_wallet : nullptr, i18n("Could not open the Marknote folder in KDE Wallet."));
            return;
        }
        m_pending.append(job);
        if (m_opening) {
            return;
        }
        delete m_wallet;
        m_opening = true;
        m_wallet = KWallet::Wallet::openWallet(KWallet::Wallet::LocalWallet(), 0, KWallet::Wallet::Asynchronous);
        if (!m_wallet) {
            finish(false);
            return;
        }
        QObject::connect(m_wallet, &KWallet::Wallet::walletOpened, m_wallet, [this](bool ok) {
            finish(ok);
        });
    }

    void finish(bool ok)
    {
        m_opening = false;
        const auto jobs = std::exchange(m_pending, {});
        KWallet::Wallet *w = ok && m_wallet && prepareFolder(m_wallet) ? m_wallet.data() : nullptr;
        const QString error = ok ? i18n("Could not open the Marknote folder in KDE Wallet.") : i18n("KDE Wallet could not be opened.");
        for (const auto &job : jobs) {
            job(w, error);
        }
    }

    QPointer<KWallet::Wallet> m_wallet;
    QList<WalletJob> m_pending;
    bool m_opening = false;
};
} // namespace
#endif

#ifdef HAVE_QTDBUS
namespace
{
/**
 * KDE Wallet 5 (Plasma 5) over D-Bus. KDE Frameworks 6 only talks to
 * kwalletd6, but kwalletd5 offers the same org.kde.KWallet interface.
 */
class KWallet5TokenStore : public TokenStore
{
public:
    static constexpr auto Service = "org.kde.kwalletd5";
    static constexpr auto AppId = "Marknote";

    static bool available()
    {
        auto *bus = QDBusConnection::sessionBus().interface();
        if (!bus) {
            return false;
        }
        const QString service = QString::fromLatin1(Service);
        return bus->isServiceRegistered(service) || bus->activatableServiceNames().value().contains(service);
    }

    QString description() const override
    {
        return i18nc("@info where the sign-in token is stored", "KDE Wallet");
    }

    void load(const QString &key, LoadCallback done) override
    {
        withHandle([this, key, done](int handle, const QString &error) {
            if (handle < 0) {
                done(false, QString(), error);
                return;
            }
            const QDBusReply<bool> has = m_iface->call(u"hasEntry"_s, handle, walletFolder(), key, appId());
            if (!has.isValid()) {
                done(false, QString(), has.error().message());
                return;
            }
            if (!has.value()) {
                done(true, QString(), QString());
                return;
            }
            const QDBusReply<QString> value = m_iface->call(u"readPassword"_s, handle, walletFolder(), key, appId());
            if (!value.isValid()) {
                done(false, QString(), value.error().message());
                return;
            }
            done(true, value.value(), QString());
        });
    }

    void save(const QString &key, const QString &secret, SaveCallback done) override
    {
        withHandle([this, key, secret, done](int handle, const QString &error) {
            if (handle < 0) {
                done(false, error);
                return;
            }
            const QDBusReply<int> r = m_iface->call(u"writePassword"_s, handle, walletFolder(), key, secret, appId());
            if (!r.isValid() || r.value() != 0) {
                done(false, r.isValid() ? i18n("Could not write to KDE Wallet.") : r.error().message());
                return;
            }
            done(true, QString());
        });
    }

    void remove(const QString &key) override
    {
        withHandle([this, key](int handle, const QString &) {
            if (handle >= 0) {
                m_iface->call(u"removeEntry"_s, handle, walletFolder(), key, appId());
            }
        });
    }

private:
    using Job = std::function<void(int handle, const QString &error)>;

    static QString walletFolder()
    {
        return u"Marknote"_s;
    }
    static QString appId()
    {
        return QString::fromLatin1(AppId);
    }

    void withHandle(Job job)
    {
        if (m_handle >= 0) {
            job(m_handle, QString());
            return;
        }
        m_pending.append(job);
        if (m_opening) {
            return;
        }
        m_opening = true;
        if (!m_iface) {
            m_iface = std::make_unique<QDBusInterface>(QString::fromLatin1(Service), u"/modules/kwalletd5"_s, u"org.kde.KWallet"_s,
                                                       QDBusConnection::sessionBus());
            m_iface->setTimeout(120000); // the user may have to type the wallet password
        }
        const QDBusReply<QString> wallet = m_iface->call(u"localWallet"_s);
        const QString name = wallet.isValid() && !wallet.value().isEmpty() ? wallet.value() : u"kdewallet"_s;
        auto *watcher = new QDBusPendingCallWatcher(m_iface->asyncCall(u"open"_s, name, qlonglong(0), appId()));
        QObject::connect(watcher, &QDBusPendingCallWatcher::finished, watcher, [this, watcher]() {
            watcher->deleteLater();
            const QDBusPendingReply<int> reply = *watcher;
            QString error;
            if (reply.isError() || reply.value() < 0) {
                error = i18n("KDE Wallet could not be opened.");
            } else {
                m_handle = reply.value();
                const QDBusReply<bool> has = m_iface->call(u"hasFolder"_s, m_handle, walletFolder(), appId());
                if (!has.isValid() || (!has.value() && !QDBusReply<bool>(m_iface->call(u"createFolder"_s, m_handle, walletFolder(), appId())).value())) {
                    error = i18n("Could not open the Marknote folder in KDE Wallet.");
                    m_handle = -1;
                }
            }
            m_opening = false;
            const auto jobs = std::exchange(m_pending, {});
            for (const auto &job : jobs) {
                job(m_handle, error);
            }
        });
    }

    std::unique_ptr<QDBusInterface> m_iface;
    int m_handle = -1;
    bool m_opening = false;
    QList<Job> m_pending;
};
} // namespace
#endif

#ifdef HAVE_LIBSECRET
namespace
{
/// The desktop keyring through libsecret (Secret Service, or the Secret portal in a Flatpak).
class SecretTokenStore : public TokenStore
{
public:
    QString description() const override
    {
        return i18nc("@info where the sign-in token is stored", "the system keyring");
    }

    static const SecretSchema *schema()
    {
        static const SecretSchema s = {
            "org.kde.marknote.Token",
            SECRET_SCHEMA_NONE,
            {{"key", SECRET_SCHEMA_ATTRIBUTE_STRING}, {nullptr, SecretSchemaAttributeType(0)}},
            0, nullptr, nullptr, nullptr, nullptr, nullptr, nullptr, nullptr,
        };
        return &s;
    }

    static QString takeError(GError *error)
    {
        const QString message = error ? QString::fromUtf8(error->message) : i18n("The system keyring is not available.");
        if (error) {
            g_error_free(error);
        }
        return message;
    }

    void load(const QString &key, LoadCallback done) override
    {
        GError *error = nullptr;
        const QByteArray k = key.toUtf8();
        gchar *value = secret_password_lookup_sync(schema(), nullptr, &error, "key", k.constData(), nullptr);
        if (error) {
            done(false, QString(), takeError(error));
            return;
        }
        const QString secret = value ? QString::fromUtf8(value) : QString();
        if (value) {
            secret_password_free(value);
        }
        done(true, secret, QString());
    }

    void save(const QString &key, const QString &secret, SaveCallback done) override
    {
        GError *error = nullptr;
        const QByteArray k = key.toUtf8();
        const QByteArray v = secret.toUtf8();
        const gboolean ok = secret_password_store_sync(schema(), SECRET_COLLECTION_DEFAULT, "Marknote: Google Drive sign-in", v.constData(), nullptr, &error,
                                                       "key", k.constData(), nullptr);
        if (!ok || error) {
            done(false, takeError(error));
            return;
        }
        done(true, QString());
    }

    void remove(const QString &key) override
    {
        const QByteArray k = key.toUtf8();
        secret_password_clear_sync(schema(), nullptr, nullptr, "key", k.constData(), nullptr);
    }
};
} // namespace
#endif

ChainTokenStore::ChainTokenStore(std::vector<std::unique_ptr<TokenStore>> stores)
    : m_stores(std::move(stores))
{
}

QString ChainTokenStore::description() const
{
    return m_stores.empty() ? QString() : m_stores.at(std::min(m_active, m_stores.size() - 1))->description();
}

void ChainTokenStore::loadFrom(size_t index, const QString &key, LoadCallback done, QStringList errors)
{
    if (index >= m_stores.size()) {
        // Nothing found: fine if at least one store could be read.
        const bool anyOk = errors.size() < int(m_stores.size());
        done(anyOk, QString(), anyOk ? QString() : errors.join(u"; "_s));
        return;
    }
    m_stores[index]->load(key, [this, index, key, done, errors](bool ok, const QString &secret, const QString &error) mutable {
        if (ok && !secret.isEmpty()) {
            m_active = index;
            done(true, secret, QString());
            return;
        }
        if (!ok) {
            errors << error;
        }
        loadFrom(index + 1, key, done, errors);
    });
}

void ChainTokenStore::load(const QString &key, LoadCallback done)
{
    loadFrom(0, key, std::move(done), {});
}

void ChainTokenStore::saveTo(size_t index, const QString &key, const QString &secret, SaveCallback done, QStringList errors)
{
    if (index >= m_stores.size()) {
        done(false, errors.join(u"; "_s));
        return;
    }
    m_stores[index]->save(key, secret, [this, index, key, secret, done, errors](bool ok, const QString &error) mutable {
        if (ok) {
            m_active = index;
            // A sign-in kept in a later store is now stale.
            for (size_t i = index + 1; i < m_stores.size(); ++i) {
                m_stores[i]->remove(key);
            }
            done(true, QString());
            return;
        }
        errors << error;
        saveTo(index + 1, key, secret, done, errors);
    });
}

void ChainTokenStore::save(const QString &key, const QString &secret, SaveCallback done)
{
    saveTo(0, key, secret, std::move(done), {});
}

void ChainTokenStore::remove(const QString &key)
{
    for (const auto &store : m_stores) {
        store->remove(key);
    }
}

std::unique_ptr<TokenStore> TokenStore::createDefault()
{
    std::vector<std::unique_ptr<TokenStore>> stores;
#ifdef HAVE_KWALLET
    bool wallet6 = KWallet::Wallet::isEnabled();
#ifdef HAVE_QTDBUS
    // Plasma 5 has no kwalletd6: don't try (and log) starting it.
    if (auto *bus = QDBusConnection::sessionBus().interface()) {
        const QString service = u"org.kde.kwalletd6"_s;
        wallet6 = wallet6 && (bus->isServiceRegistered(service) || bus->activatableServiceNames().value().contains(service));
    }
#endif
    if (wallet6) {
        stores.push_back(std::make_unique<WalletTokenStore>());
    }
#endif
#ifdef HAVE_QTDBUS
    if (KWallet5TokenStore::available()) {
        stores.push_back(std::make_unique<KWallet5TokenStore>());
    }
#endif
#ifdef HAVE_LIBSECRET
    stores.push_back(std::make_unique<SecretTokenStore>());
#endif
    stores.push_back(std::make_unique<FileTokenStore>(QStandardPaths::writableLocation(QStandardPaths::AppDataLocation) + u"/tokens"_s));
    return std::make_unique<ChainTokenStore>(std::move(stores));
}

} // namespace Sync
