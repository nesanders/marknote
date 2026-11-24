// SPDX-FileCopyrightText: 2026 Marknote fork contributors
// SPDX-License-Identifier: GPL-2.0-or-later

// Where the Google sign-in is kept: the fallback chain, and KDE Wallet 5 over
// D-Bus (Plasma 5) against a fake kwalletd5. The D-Bus test needs a private
// session bus (DBUS_SESSION_BUS_ADDRESS); it is skipped without one.

#include "../sync/tokenstore.h"

#include <QDBusConnection>
#include <QDBusConnectionInterface>
#include <QHash>
#include <QSignalSpy>
#include <QStandardPaths>
#include <QtTest/QtTest>

using namespace Qt::Literals::StringLiterals;
using namespace Sync;

namespace
{
class FakeStore : public TokenStore
{
public:
    FakeStore(QString name, bool works, QHash<QString, QString> *data)
        : m_name(std::move(name))
        , m_works(works)
        , m_data(data)
    {
    }
    QString description() const override
    {
        return m_name;
    }
    void load(const QString &key, LoadCallback done) override
    {
        m_works ? done(true, m_data->value(key), QString()) : done(false, QString(), m_name + u" is broken"_s);
    }
    void save(const QString &key, const QString &secret, SaveCallback done) override
    {
        if (!m_works) {
            done(false, m_name + u" is broken"_s);
            return;
        }
        m_data->insert(key, secret);
        done(true, QString());
    }
    void remove(const QString &key) override
    {
        m_data->remove(key);
    }

private:
    QString m_name;
    bool m_works;
    QHash<QString, QString> *m_data;
};
}

/// Enough of kwalletd5's org.kde.KWallet interface for Marknote.
class FakeKWallet5 : public QObject
{
    Q_OBJECT
    Q_CLASSINFO("D-Bus Interface", "org.kde.KWallet")
public:
    QHash<QString, QString> entries; // "folder/key" -> value
    QStringList folders;
    bool refuseOpen = false;
    int opens = 0;

public Q_SLOTS:
    QString localWallet()
    {
        return u"kdewallet"_s;
    }
    int open(const QString &wallet, qlonglong, const QString &appid)
    {
        ++opens;
        return refuseOpen || wallet != u"kdewallet"_s || appid.isEmpty() ? -1 : 42;
    }
    bool hasFolder(int handle, const QString &folder, const QString &)
    {
        return handle == 42 && folders.contains(folder);
    }
    bool createFolder(int handle, const QString &folder, const QString &)
    {
        if (handle != 42) {
            return false;
        }
        folders << folder;
        return true;
    }
    bool hasEntry(int handle, const QString &folder, const QString &key, const QString &)
    {
        return handle == 42 && entries.contains(folder + u'/' + key);
    }
    QString readPassword(int handle, const QString &folder, const QString &key, const QString &)
    {
        return handle == 42 ? entries.value(folder + u'/' + key) : QString();
    }
    int writePassword(int handle, const QString &folder, const QString &key, const QString &value, const QString &)
    {
        if (handle != 42) {
            return -1;
        }
        entries.insert(folder + u'/' + key, value);
        return 0;
    }
    int removeEntry(int handle, const QString &folder, const QString &key, const QString &)
    {
        return handle == 42 && entries.remove(folder + u'/' + key) ? 0 : -1;
    }
};

class TokenStoreTest : public QObject
{
    Q_OBJECT

    static QString loadSync(TokenStore &store, const QString &key, bool *ok = nullptr)
    {
        bool done = false;
        QString result;
        store.load(key, [&](bool success, const QString &secret, const QString &) {
            if (ok) {
                *ok = success;
            }
            result = secret;
            done = true;
        });
        if (!QTest::qWaitFor([&]() {
                return done;
            }, 30000)) {
            qFatal("load did not finish");
        }
        return result;
    }

    static bool saveSync(TokenStore &store, const QString &key, const QString &secret)
    {
        bool done = false;
        bool ok = false;
        store.save(key, secret, [&](bool success, const QString &) {
            ok = success;
            done = true;
        });
        if (!QTest::qWaitFor([&]() {
                return done;
            }, 30000)) {
            qFatal("save did not finish");
        }
        return ok;
    }

private Q_SLOTS:
    void initTestCase()
    {
        QStandardPaths::setTestModeEnabled(true);
    }

    void testChainSkipsBrokenStores()
    {
        QHash<QString, QString> wallet, keyring;
        std::vector<std::unique_ptr<TokenStore>> stores;
        stores.push_back(std::make_unique<FakeStore>(u"wallet"_s, false, &wallet));
        stores.push_back(std::make_unique<FakeStore>(u"keyring"_s, true, &keyring));
        ChainTokenStore chain(std::move(stores));

        QVERIFY(saveSync(chain, u"k"_s, u"secret"_s));
        QCOMPARE(keyring.value(u"k"_s), u"secret"_s);
        QCOMPARE(chain.description(), u"keyring"_s);
        bool ok = false;
        QCOMPARE(loadSync(chain, u"k"_s, &ok), u"secret"_s);
        QVERIFY(ok);
        chain.remove(u"k"_s);
        QVERIFY(keyring.isEmpty());
    }

    void testChainFindsSignInSavedByAFallback()
    {
        // Saved to the file while the wallet was down; the wallet works again now.
        QHash<QString, QString> wallet, file{{u"k"_s, u"old"_s}};
        std::vector<std::unique_ptr<TokenStore>> stores;
        stores.push_back(std::make_unique<FakeStore>(u"wallet"_s, true, &wallet));
        stores.push_back(std::make_unique<FakeStore>(u"file"_s, true, &file));
        ChainTokenStore chain(std::move(stores));
        QCOMPARE(loadSync(chain, u"k"_s), u"old"_s);
        QCOMPARE(chain.description(), u"file"_s);
        // Saving again goes to the wallet and drops the stale copy.
        QVERIFY(saveSync(chain, u"k"_s, u"new"_s));
        QCOMPARE(wallet.value(u"k"_s), u"new"_s);
        QVERIFY(file.isEmpty());
        QCOMPARE(chain.description(), u"wallet"_s);
    }

    void testChainAllBroken()
    {
        QHash<QString, QString> a;
        std::vector<std::unique_ptr<TokenStore>> stores;
        stores.push_back(std::make_unique<FakeStore>(u"a"_s, false, &a));
        ChainTokenStore chain(std::move(stores));
        bool ok = true;
        QVERIFY(loadSync(chain, u"k"_s, &ok).isEmpty());
        QVERIFY(!ok);
        QVERIFY(!saveSync(chain, u"k"_s, u"x"_s));
    }

    void testDefaultUsesKWallet5OverDBus()
    {
        auto bus = QDBusConnection::sessionBus();
        if (!bus.isConnected() || qEnvironmentVariableIsEmpty("MARKNOTE_TEST_PRIVATE_BUS")) {
            QSKIP("needs a private D-Bus session bus (MARKNOTE_TEST_PRIVATE_BUS)");
        }
        FakeKWallet5 fake;
        QVERIFY(bus.registerObject(u"/modules/kwalletd5"_s, &fake, QDBusConnection::ExportAllSlots));
        QVERIFY(bus.registerService(u"org.kde.kwalletd5"_s));

        auto store = TokenStore::createDefault();
        QVERIFY(saveSync(*store, u"google-refresh-token"_s, u"rt-1"_s));
        QCOMPARE(fake.entries.value(u"Marknote/google-refresh-token"_s), u"rt-1"_s);
        QCOMPARE(store->description(), u"KDE Wallet"_s);

        auto again = TokenStore::createDefault();
        QCOMPARE(loadSync(*again, u"google-refresh-token"_s), u"rt-1"_s);
        again->remove(u"google-refresh-token"_s);
        QTRY_VERIFY(fake.entries.isEmpty());

        // A wallet that will not open (e.g. the user cancelled): the next store takes it.
        fake.refuseOpen = true;
        auto third = TokenStore::createDefault();
        QVERIFY(saveSync(*third, u"google-refresh-token"_s, u"rt-2"_s));
        QVERIFY(fake.entries.isEmpty());
        QVERIFY(third->description() != u"KDE Wallet"_s);
        QCOMPARE(loadSync(*third, u"google-refresh-token"_s), u"rt-2"_s);
        third->remove(u"google-refresh-token"_s);

        bus.unregisterService(u"org.kde.kwalletd5"_s);
        bus.unregisterObject(u"/modules/kwalletd5"_s);
    }
};

QTEST_GUILESS_MAIN(TokenStoreTest)
#include "tokenstoretest.moc"
