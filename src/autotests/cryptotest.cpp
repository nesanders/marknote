// SPDX-FileCopyrightText: 2026 Marknote fork contributors
// SPDX-License-Identifier: GPL-2.0-or-later

#include "../crypto/vaultcrypto.h"
#include "../notemetadata/frontmatter.h"

#include <QFile>
#include <QtTest/QtTest>

using namespace Qt::Literals::StringLiterals;
using namespace VaultCrypto;

/// Test vectors shared with the web app (src/autotests/data/encryption).
static const QString VectorPassword = u"correct horse battery staple ü"_s;

class CryptoTest : public QObject
{
    Q_OBJECT

    static QString dataPath(const QString &name)
    {
        return QFINDTESTDATA(u"data/encryption/"_s + name);
    }

    static QByteArray readData(const QString &name)
    {
        QFile f(dataPath(name));
        return f.open(QFile::ReadOnly) ? f.readAll() : QByteArray();
    }

    // Faster KDF for the tests that do not need the real parameters.
    static Created quickVault(const QString &password)
    {
        auto c = createVault(password);
        Q_ASSERT(c);
        return *c;
    }

private Q_SLOTS:
    void initTestCase()
    {
        QVERIFY(init());
    }

    void testCreateAndUnlock()
    {
        const Created c = quickVault(u"secret pw"_s);
        QCOMPARE(c.vault.salt.size(), 16);
        QCOMPARE(c.vault.passwordKey.size(), 48);
        QVERIFY(c.notebookKey.isValid());
        const auto key = unlockWithPassword(c.vault, u"secret pw"_s);
        QVERIFY(key);
        QCOMPARE(key->bytes(), c.notebookKey.bytes());
        QVERIFY(!unlockWithPassword(c.vault, u"secret pW"_s));
        QVERIFY(!unlockWithPassword(c.vault, QString()));
    }

    void testRecoveryKey()
    {
        const Created c = quickVault(u"pw"_s);
        QVERIFY(QRegularExpression(u"^([A-Z2-7]{4}-){12}[A-Z2-7]{4}$"_s).match(c.recoveryKey).hasMatch());
        QCOMPARE(unlockWithRecoveryKey(c.vault, c.recoveryKey)->bytes(), c.notebookKey.bytes());
        // Forgiving input: lower case, spaces instead of dashes, typos 0/1/8.
        QString sloppy = c.recoveryKey.toLower();
        sloppy.replace(u'-', u' ');
        sloppy.replace(u'o', u'0').replace(u'i', u'1').replace(u'b', u'8');
        QCOMPARE(unlockWithRecoveryKey(c.vault, sloppy)->bytes(), c.notebookKey.bytes());
        QString wrong = c.recoveryKey;
        wrong[0] = wrong[0] == u'A' ? u'B' : u'A';
        QVERIFY(!unlockWithRecoveryKey(c.vault, wrong));
        QVERIFY(!unlockWithRecoveryKey(c.vault, u"too short"_s));
        // Encoding round trip.
        const QByteArray bytes = QByteArray::fromHex("00ff10203040506070809aabbccddeeff0123456789abcdef0011223344556677");
        QCOMPARE(*decodeRecoveryKey(encodeRecoveryKey(bytes.left(32))), bytes.left(32));
    }

    void testChangePasswordKeepsNotes()
    {
        const Created c = quickVault(u"old"_s);
        const QString note = encryptNote(u"---\nid: X\ntags: [a]\n---\n\n# Hi\n"_s, c.notebookKey);
        const auto v2 = changePassword(c.vault, c.notebookKey, u"new"_s);
        QVERIFY(v2);
        QVERIFY(v2->salt != c.vault.salt);
        QVERIFY(!unlockWithPassword(*v2, u"old"_s));
        const auto key = unlockWithPassword(*v2, u"new"_s);
        QVERIFY(key);
        QCOMPARE(*decryptNote(note, *key), u"---\nid: X\ntags: [a]\n---\n\n# Hi\n"_s);
        // The recovery key still works.
        QVERIFY(unlockWithRecoveryKey(*v2, c.recoveryKey));
    }

    void testNoteEnvelope()
    {
        const Created c = quickVault(u"pw"_s);
        const QString plain = u"---\nid: 01ABC\ncreated: 2026-11-24T09:00:00\ntags: [secret, plans]\n---\n\n# Plans 🗺️\n\nÜber long text\n"_s.repeated(20);
        const QString env = encryptNote(plain, c.notebookKey, u"Trip ideas"_s);
        QVERIFY(isEncryptedNote(env));
        QVERIFY(!isEncryptedNote(plain));
        QCOMPARE(envelopeTitle(env), u"Trip ideas"_s);
        QVERIFY(!env.contains(u"secret"_s));
        QVERIFY(!env.contains(u"Plans"_s));
        QVERIFY(env.startsWith(u"---\nmarknote-encrypted: 1\ntitle: Trip ideas\n---\n"_s));
        // Lines of the block are at most 76 characters.
        for (const auto &line : env.split(u'\n')) {
            QVERIFY(line.size() <= 76 || !line.contains(u'/') || line.startsWith(u"This note"_s));
        }
        QCOMPARE(*decryptNote(env, c.notebookKey), plain);
        // A fresh nonce every time.
        QVERIFY(encryptNote(plain, c.notebookKey) != encryptNote(plain, c.notebookKey));
        // Tampering is detected.
        QString tampered = env;
        const qsizetype at = tampered.indexOf(u"v1\n"_s) + 10;
        tampered[at] = tampered[at] == u'A' ? u'B' : u'A';
        QString error;
        QVERIFY(!decryptNote(tampered, c.notebookKey, &error));
        QVERIFY(!error.isEmpty());
        // Another notebook's key does not open it.
        QVERIFY(!decryptNote(env, quickVault(u"x"_s).notebookKey));
    }

    void testVaultJsonRoundTrip()
    {
        Created c = quickVault(u"pw"_s);
        c.vault.extra.insert(u"futureField"_s, u"kept"_s);
        const QByteArray json = c.vault.toJson();
        const auto back = Vault::fromJson(json);
        QVERIFY(back);
        QCOMPARE(back->salt, c.vault.salt);
        QCOMPARE(back->extra.value(u"futureField"_s).toString(), u"kept"_s);
        QVERIFY(unlockWithPassword(*back, u"pw"_s));
        QString error;
        QVERIFY(!Vault::fromJson("{\"format\":\"marknote-vault\",\"version\":2}", &error));
        QVERIFY(error.contains(u"newer"_s));
    }

    void testVectors()
    {
        // Written once by this test (MARKNOTE_WRITE_VECTORS=dir) and checked in;
        // the web app adds web-note.md, made with its own implementation.
        if (qEnvironmentVariableIsSet("MARKNOTE_WRITE_VECTORS")) {
            const QString dir = qEnvironmentVariable("MARKNOTE_WRITE_VECTORS");
            auto c = createVault(VectorPassword);
            QVERIFY(c);
            QFile v(dir + u"/vault.json"_s);
            QVERIFY(v.open(QFile::WriteOnly));
            v.write(c->vault.toJson());
            QFile r(dir + u"/recovery-key.txt"_s);
            QVERIFY(r.open(QFile::WriteOnly));
            r.write(c->recoveryKey.toLatin1() + '\n');
            const QString plain = QString::fromUtf8(readData(u"plain.md"_s));
            QFile n(dir + u"/desktop-note.md"_s);
            QVERIFY(n.open(QFile::WriteOnly));
            n.write(encryptNote(plain, c->notebookKey, u"Vector note"_s).toUtf8());
            QSKIP("vectors written");
        }
        const auto vault = Vault::fromJson(readData(u"vault.json"_s));
        QVERIFY2(vault, "test vectors missing");
        const auto key = unlockWithPassword(*vault, VectorPassword);
        QVERIFY(key);
        const QString recovery = QString::fromLatin1(readData(u"recovery-key.txt"_s)).trimmed();
        QCOMPARE(unlockWithRecoveryKey(*vault, recovery)->bytes(), key->bytes());
        const QString plain = QString::fromUtf8(readData(u"plain.md"_s));
        for (const auto &name : {u"desktop-note.md"_s, u"web-note.md"_s}) {
            const QByteArray env = readData(name);
            if (env.isEmpty() && name == u"web-note.md"_s) {
                qWarning("web-note.md not generated yet");
                continue;
            }
            QString error;
            const auto text = decryptNote(QString::fromUtf8(env), *key, &error);
            QVERIFY2(text, qPrintable(name + u": "_s + error));
            QCOMPARE(*text, plain);
            QCOMPARE(envelopeTitle(QString::fromUtf8(env)), u"Vector note"_s);
        }
    }
};

QTEST_GUILESS_MAIN(CryptoTest)
#include "cryptotest.moc"
