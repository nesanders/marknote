// SPDX-FileCopyrightText: 2026 Marknote fork contributors
// SPDX-License-Identifier: GPL-2.0-or-later

#include "../crypto/vaults.h"
#include "../notemetadata/imagelinks.h"
#include "../notemetadata/notemetadata.h"
#include "../notesmodel.h"

#include <QDir>
#include <QFile>
#include <QTemporaryDir>
#include <QtTest/QtTest>

using namespace Qt::Literals::StringLiterals;

/// Encrypted notebooks end to end, through the code the app uses.
class VaultsTest : public QObject
{
    Q_OBJECT

    QTemporaryDir m_dir;

    static void write(const QString &path, const QByteArray &data)
    {
        QDir().mkpath(QFileInfo(path).absolutePath());
        QFile f(path);
        QVERIFY(f.open(QFile::WriteOnly | QFile::Truncate));
        f.write(data);
    }

    static QString raw(const QString &path)
    {
        QFile f(path);
        return f.open(QFile::ReadOnly) ? QString::fromUtf8(f.readAll()) : QString();
    }

    QString freshNotebook()
    {
        static int n = 0;
        const QString nb = m_dir.filePath(u"Notes/Secret%1"_s.arg(++n));
        write(nb + u"/Plans.md"_s, "---\nid: A\ntags: [travel, private]\n---\n\n# Plans\n\nSecret island ![map](map.png)\n");
        write(nb + u"/Sub/Diary.md"_s, "# Diary\n\nDear diary\n");
        write(nb + u"/map.png"_s, "png");
        write(nb + u"/.directory"_s, "[Desktop Entry]\nIcon=folder-red\n");
        return nb;
    }

private Q_SLOTS:
    void testEncryptReadLockUnlock()
    {
        auto *v = Vaults::instance();
        const QString nb = freshNotebook();
        QVERIFY(!v->isEncrypted(nb));
        const QString recovery = v->encryptNotebook(nb, u"hunter22"_s);
        QVERIFY2(!recovery.isEmpty(), qPrintable(v->lastError()));
        QVERIFY(QFile::exists(nb + u"/.marknote/vault.json"_s));
        QVERIFY(v->isEncrypted(nb + u"/Sub/Diary.md"_s));
        QVERIFY(v->isUnlocked(nb));

        // On disk: envelopes, nothing readable; non-notes untouched.
        for (const auto &note : {u"/Plans.md"_s, u"/Sub/Diary.md"_s}) {
            const QString text = raw(nb + note);
            QVERIFY(text.startsWith(u"---\nmarknote-encrypted: 1\n"_s));
            QVERIFY(!text.contains(u"Secret"_s) && !text.contains(u"diary"_s) && !text.contains(u"travel"_s));
        }
        QCOMPARE(raw(nb + u"/map.png"_s), u"png"_s);

        // Unlocked: the app sees the plain note and its metadata.
        QString text;
        QCOMPARE(NoteIO::read(nb + u"/Plans.md"_s, &text), NoteIO::Status::Ok);
        QVERIFY(text.contains(u"Secret island"_s));
        auto *meta = NoteMetadata::instance();
        QCOMPARE(meta->read(QUrl::fromLocalFile(nb + u"/Plans.md"_s)).value(u"tags"_s).toStringList(), (QStringList{u"travel"_s, u"private"_s}));
        QVERIFY(meta->noteContains(nb + u"/Plans.md"_s, u"island"_s));

        // Locked: nothing readable, and nothing can be written.
        QSignalSpy lockedSpy(v, &Vaults::locked);
        v->lock(nb);
        QCOMPARE(lockedSpy.count(), 1);
        QVERIFY(v->isLocked(nb + u"/Plans.md"_s));
        QCOMPARE(NoteIO::read(nb + u"/Plans.md"_s, &text), NoteIO::Status::Locked);
        QVERIFY(meta->read(QUrl::fromLocalFile(nb + u"/Plans.md"_s)).value(u"tags"_s).toStringList().isEmpty());
        QVERIFY(!meta->noteContains(nb + u"/Plans.md"_s, u"island"_s));
        const QString before = raw(nb + u"/Plans.md"_s);
        QVERIFY(!NoteIO::write(nb + u"/Plans.md"_s, u"plain text leak"_s));
        QCOMPARE(raw(nb + u"/Plans.md"_s), before);
        QVERIFY(!meta->setTags(QUrl::fromLocalFile(nb + u"/Plans.md"_s), {u"x"_s}));

        // Unlock: wrong password, recovery key, password.
        QVERIFY(!v->unlock(nb, u"hunter2"_s));
        QCOMPARE(v->lastError(), u"Wrong password."_s);
        QVERIFY(v->unlockWithRecoveryKey(nb, recovery.toLower()));
        v->lock(nb);
        QVERIFY(v->unlock(nb + u"/Sub/Diary.md"_s, u"hunter22"_s));
        QCOMPARE(NoteIO::read(nb + u"/Sub/Diary.md"_s, &text), NoteIO::Status::Ok);
        QCOMPARE(text, u"# Diary\n\nDear diary\n"_s);
    }

    void testWritingInsideAnEncryptedNotebook()
    {
        auto *v = Vaults::instance();
        const QString nb = freshNotebook();
        QVERIFY(!v->encryptNotebook(nb, u"pw-long-enough"_s).isEmpty());

        // Edits are saved encrypted, a fresh nonce each time.
        QVERIFY(NoteIO::write(nb + u"/Plans.md"_s, u"---\nid: A\n---\n\n# Plans v2\n"_s));
        QVERIFY(raw(nb + u"/Plans.md"_s).startsWith(u"---\nmarknote-encrypted: 1\n"_s));
        QCOMPARE(NoteIO::readText(nb + u"/Plans.md"_s), u"---\nid: A\n---\n\n# Plans v2\n"_s);

        // Tag edits too.
        QVERIFY(NoteMetadata::instance()->setTags(QUrl::fromLocalFile(nb + u"/Plans.md"_s), {u"later"_s}));
        QVERIFY(!raw(nb + u"/Plans.md"_s).contains(u"later"_s));
        QVERIFY(NoteIO::readText(nb + u"/Plans.md"_s).contains(u"tags: [later]"_s));

        // New notes from the app are encrypted from the start.
        NotesModel model;
        model.setPath(nb);
        QCOMPARE(model.addNote(u"Fresh"_s), u"Fresh"_s);
        const QString created = nb + u"/Fresh.md"_s;
        QVERIFY(raw(created).startsWith(u"---\nmarknote-encrypted: 1\n"_s));
        QVERIFY(NoteIO::readText(created).contains(u"# Fresh"_s));

        // A plain note added by another tool reads as is, and is encrypted when saved.
        write(nb + u"/Imported.md"_s, "# From elsewhere\n");
        QCOMPARE(NoteIO::readText(nb + u"/Imported.md"_s), u"# From elsewhere\n"_s);
        QVERIFY(NoteIO::write(nb + u"/Imported.md"_s, u"# From elsewhere, edited\n"_s));
        QVERIFY(raw(nb + u"/Imported.md"_s).startsWith(u"---\nmarknote-encrypted: 1\n"_s));

        // Moving a note fixes its image links inside the encrypted text.
        QDir().mkpath(nb + u"/Deep"_s);
        QVERIFY(QFile::rename(nb + u"/Plans.md"_s, nb + u"/Deep/Plans.md"_s));
        NoteIO::write(nb + u"/Deep/Plans.md"_s, u"# Plans\n\n![map](map.png)\n"_s);
        const auto report = ImageLinks::noteMoved(nb + u"/Plans.md"_s, nb + u"/Deep/Plans.md"_s, nb, nb);
        QCOMPARE(report.rewritten, 1);
        QCOMPARE(NoteIO::readText(nb + u"/Deep/Plans.md"_s), u"# Plans\n\n![map](../map.png)\n"_s);
        QVERIFY(raw(nb + u"/Deep/Plans.md"_s).startsWith(u"---\nmarknote-encrypted: 1\n"_s));
    }

    void testChangePasswordAndRemoveEncryption()
    {
        auto *v = Vaults::instance();
        const QString nb = freshNotebook();
        const QString recovery = v->encryptNotebook(nb, u"first password"_s);
        QVERIFY(!v->changePassword(nb, u"wrong"_s, u"second password"_s));
        QVERIFY(v->changePassword(nb, u"first password"_s, u"second password"_s));
        v->lock(nb);
        QVERIFY(!v->unlock(nb, u"first password"_s));
        QVERIFY(v->unlock(nb, u"second password"_s));
        QVERIFY(v->unlockWithRecoveryKey(nb, recovery)); // still valid

        QVERIFY(!v->removeEncryption(nb, u"first password"_s));
        QVERIFY(v->isEncrypted(nb));
        QVERIFY(v->removeEncryption(nb, u"second password"_s));
        QVERIFY(!v->isEncrypted(nb));
        QVERIFY(!QFile::exists(nb + u"/.marknote/vault.json"_s));
        QCOMPARE(raw(nb + u"/Sub/Diary.md"_s), u"# Diary\n\nDear diary\n"_s);
        QVERIFY(raw(nb + u"/Plans.md"_s).contains(u"Secret island"_s));
        // Plain again: writes are plain.
        QVERIFY(NoteIO::write(nb + u"/Sub/Diary.md"_s, u"# Diary\n"_s));
        QCOMPARE(raw(nb + u"/Sub/Diary.md"_s), u"# Diary\n"_s);
    }

    void testOtherNotebooksUnaffected()
    {
        const QString plain = m_dir.filePath(u"Notes/Open"_s);
        write(plain + u"/Note.md"_s, "# Open\n");
        QVERIFY(!Vaults::instance()->isEncrypted(plain + u"/Note.md"_s));
        QVERIFY(NoteIO::write(plain + u"/Note.md"_s, u"# Open 2\n"_s));
        QCOMPARE(raw(plain + u"/Note.md"_s), u"# Open 2\n"_s);
    }
};

QTEST_GUILESS_MAIN(VaultsTest)
#include "vaultstest.moc"
