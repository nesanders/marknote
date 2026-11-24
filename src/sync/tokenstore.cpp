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

std::unique_ptr<TokenStore> TokenStore::createDefault()
{
#ifdef HAVE_KWALLET
    if (KWallet::Wallet::isEnabled()) {
        return std::make_unique<WalletTokenStore>();
    }
#endif
    return std::make_unique<FileTokenStore>(QStandardPaths::writableLocation(QStandardPaths::AppDataLocation) + u"/tokens"_s);
}

} // namespace Sync
