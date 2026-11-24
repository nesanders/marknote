// SPDX-FileCopyrightText: 2026 Marknote fork contributors
// SPDX-License-Identifier: GPL-2.0-or-later

#include "../sync/localfolderbackend.h"
#include "../sync/syncengine.h"

#include <QDir>
#include <QDirIterator>
#include <QFile>
#include <QObject>
#include <QTemporaryDir>
#include <QtTest/QtTest>

using namespace Qt::Literals::StringLiterals;
using namespace Sync;

/// Two "devices" (notebook folders A and B) syncing through one destination.
class SyncEngineTest : public QObject
{
    Q_OBJECT

    QTemporaryDir m_tmp;
    QString a, b, remote;

    SyncResult syncDevice(const QString &device)
    {
        LocalFolderBackend backend(remote);
        SyncEngine engine(device, &backend, device + u"/.marknote/sync/test.json"_s);
        return engine.run();
    }

    static void write(const QString &path, const QByteArray &content)
    {
        QDir().mkpath(QFileInfo(path).absolutePath());
        QFile f(path);
        QVERIFY(f.open(QFile::WriteOnly | QFile::Truncate));
        f.write(content);
    }

    static QByteArray read(const QString &path)
    {
        QFile f(path);
        return f.open(QFile::ReadOnly) ? f.readAll() : QByteArray();
    }

    static QStringList files(const QString &root, const QString &nameFilter = u"*"_s)
    {
        QStringList out;
        QDirIterator it(root, {nameFilter}, QDir::Files | QDir::Hidden, QDirIterator::Subdirectories);
        while (it.hasNext()) {
            const QString rel = QDir(root).relativeFilePath(it.next());
            if (!SyncEngine::isExcluded(rel)) {
                out << rel;
            }
        }
        out.sort();
        return out;
    }

private Q_SLOTS:
    void init()
    {
        QVERIFY(m_tmp.isValid());
        static int n = 0;
        const QString base = m_tmp.filePath(QString::number(++n));
        a = base + u"/deviceA"_s;
        b = base + u"/deviceB"_s;
        remote = base + u"/remote"_s;
        QDir().mkpath(a);
        QDir().mkpath(b);
        QDir().mkpath(remote);
    }

    void testInitialSyncBothDirections()
    {
        write(a + u"/One.md"_s, "one");
        write(a + u"/Folder/Two.md"_s, "two");
        write(a + u"/.directory"_s, "[Desktop Entry]\nIcon=folder-blue\n");
        write(b + u"/Three.md"_s, "three");

        SyncResult r = syncDevice(a);
        QVERIFY2(r.ok(), qPrintable(r.errors.join(u"; "_s)));
        QCOMPARE(r.uploaded, 3);
        r = syncDevice(b);
        QVERIFY(r.ok());
        QCOMPARE(r.uploaded, 1);
        QCOMPARE(r.downloaded, 3);
        r = syncDevice(a);
        QCOMPARE(r.downloaded, 1);

        QCOMPARE(files(a), files(b));
        QCOMPARE(read(b + u"/Folder/Two.md"_s), QByteArray("two"));
        QCOMPARE(read(b + u"/.directory"_s), read(a + u"/.directory"_s));
    }

    void testSecondSyncIsANoOp()
    {
        write(a + u"/One.md"_s, "one");
        QVERIFY(syncDevice(a).ok());
        const SyncResult r = syncDevice(a);
        QVERIFY(r.ok());
        QCOMPARE(r.changes(), 0);
    }

    void testEditsPropagate()
    {
        write(a + u"/Note.md"_s, "v1");
        syncDevice(a);
        syncDevice(b);

        write(a + u"/Note.md"_s, "v2 from A");
        syncDevice(a);
        SyncResult r = syncDevice(b);
        QCOMPARE(r.downloaded, 1);
        QCOMPARE(r.changedLocalPaths, QStringList{u"Note.md"_s});
        QCOMPARE(read(b + u"/Note.md"_s), QByteArray("v2 from A"));

        write(b + u"/Note.md"_s, "v3 from B");
        syncDevice(b);
        r = syncDevice(a);
        QCOMPARE(r.downloaded, 1);
        QCOMPARE(read(a + u"/Note.md"_s), QByteArray("v3 from B"));
    }

    void testConflictKeepsBothVersions()
    {
        write(a + u"/Note.md"_s, "base");
        syncDevice(a);
        syncDevice(b);

        write(a + u"/Note.md"_s, "edited on A");
        write(b + u"/Note.md"_s, "edited on B");
        syncDevice(a);
        SyncResult r = syncDevice(b);
        QVERIFY(r.ok());
        QCOMPARE(r.conflicts, 1);
        QCOMPARE(r.conflictCopies.size(), 1);
        // B keeps its own edit in place and gets A's as a conflict copy…
        QCOMPARE(read(b + u"/Note.md"_s), QByteArray("edited on B"));
        QCOMPARE(read(b + u"/"_s + r.conflictCopies.first()), QByteArray("edited on A"));
        QVERIFY(r.conflictCopies.first().startsWith(u"Note (conflict "_s));
        // The change list names the note and its copy.
        QCOMPARE(r.log.first().kind, SyncChange::Conflict);
        QCOMPARE(r.log.first().path, u"Note.md"_s);
        QCOMPARE(r.log.first().copy, r.conflictCopies.first());

        // …and after another round both devices hold both versions.
        syncDevice(b);
        syncDevice(a);
        QCOMPARE(files(a), files(b));
        QCOMPARE(read(a + u"/Note.md"_s), QByteArray("edited on B"));
        QCOMPARE(syncDevice(a).changes(), 0);
        QCOMPARE(syncDevice(b).changes(), 0);
    }

    void testChangeList()
    {
        write(a + u"/One.md"_s, "1");
        write(a + u"/Two.md"_s, "2");
        SyncResult r = syncDevice(a);
        QCOMPARE(r.log.size(), 2);
        for (const SyncChange &c : r.log) {
            QCOMPARE(c.kind, SyncChange::Sent);
        }
        r = syncDevice(b);
        QCOMPARE(r.log.size(), 2);
        QCOMPARE(r.log.at(0).kind, SyncChange::Received);
        QCOMPARE(r.log.at(0).path, u"One.md"_s);

        QFile::remove(a + u"/Two.md"_s);
        r = syncDevice(a);
        QCOMPARE(r.log.size(), 1);
        QCOMPARE(r.log.first().kind, SyncChange::DeletedThere);
        r = syncDevice(b);
        QCOMPARE(r.log.size(), 1);
        QCOMPARE(r.log.first().kind, SyncChange::DeletedHere);
        QCOMPARE(r.log.first().path, u"Two.md"_s);
    }

    void testDeletionsAreRecoverable()
    {
        write(a + u"/Keep.md"_s, "keep");
        write(a + u"/Gone.md"_s, "gone");
        syncDevice(a);
        syncDevice(b);

        QVERIFY(QFile::remove(a + u"/Gone.md"_s));
        SyncResult r = syncDevice(a);
        QCOMPARE(r.deletedRemote, 1);
        QVERIFY(!QFile::exists(remote + u"/Gone.md"_s));
        QCOMPARE(files(remote + u"/.marknote/trash"_s, u"Gone.md"_s).size(), 1);

        r = syncDevice(b);
        QCOMPARE(r.deletedLocal, 1);
        QVERIFY(!QFile::exists(b + u"/Gone.md"_s));
        // Moved into the local trash, not destroyed.
        QDirIterator trash(b + u"/.marknote/trash"_s, {u"Gone.md"_s}, QDir::Files, QDirIterator::Subdirectories);
        QVERIFY(trash.hasNext());
        QCOMPARE(read(trash.next()), QByteArray("gone"));
        QVERIFY(QFile::exists(b + u"/Keep.md"_s));
    }

    void testEditWinsOverDelete()
    {
        write(a + u"/Note.md"_s, "v1");
        syncDevice(a);
        syncDevice(b);

        QVERIFY(QFile::remove(a + u"/Note.md"_s));
        syncDevice(a); // deleted remotely
        write(b + u"/Note.md"_s, "v2 edited on B");
        SyncResult r = syncDevice(b);
        QCOMPARE(r.uploaded, 1);
        QCOMPARE(r.deletedLocal, 0);
        r = syncDevice(a);
        QCOMPARE(read(a + u"/Note.md"_s), QByteArray("v2 edited on B"));
    }

    void testEmptyFoldersAndFolderRemoval()
    {
        QDir().mkpath(a + u"/Empty/Nested"_s);
        syncDevice(a);
        QVERIFY(QFileInfo(remote + u"/Empty/Nested"_s).isDir());
        syncDevice(b);
        QVERIFY(QFileInfo(b + u"/Empty/Nested"_s).isDir());

        QVERIFY(QDir(a + u"/Empty"_s).removeRecursively());
        syncDevice(a);
        QVERIFY(!QFileInfo::exists(remote + u"/Empty"_s));
        syncDevice(b);
        QVERIFY(!QFileInfo::exists(b + u"/Empty"_s));
    }

    void testSyncStateIsNotSynced()
    {
        write(a + u"/Note.md"_s, "x");
        syncDevice(a);
        QVERIFY(QFile::exists(a + u"/.marknote/sync/test.json"_s));
        QVERIFY(!QFileInfo::exists(remote + u"/.marknote/sync"_s));
    }

    void testLastOpenedNoteStaysOnTheDevice()
    {
        write(a + u"/.directory"_s, "[Desktop Entry]\nX-MarkNote-LastEntry=One.md\nIcon=folder-blue\n");
        syncDevice(a);
        QVERIFY(!read(remote + u"/.directory"_s).contains("LastEntry"));
        syncDevice(b);
        QCOMPARE(read(b + u"/.directory"_s), QByteArray("[Desktop Entry]\nIcon=folder-blue\n"));

        // Each device opens other notes: nothing to sync, no conflicts.
        write(b + u"/.directory"_s, "[Desktop Entry]\nIcon=folder-blue\nX-MarkNote-LastEntry=Two.md\n");
        write(a + u"/.directory"_s, "[Desktop Entry]\nX-MarkNote-LastEntry=Three.md\nIcon=folder-blue\n");
        QCOMPARE(syncDevice(b).changes(), 0);
        QCOMPARE(syncDevice(a).changes(), 0);

        // A real change (the icon) travels, and B keeps its own last note.
        write(a + u"/.directory"_s, "[Desktop Entry]\nX-MarkNote-LastEntry=Three.md\nIcon=folder-red\n");
        QCOMPARE(syncDevice(a).uploaded, 1);
        const SyncResult r = syncDevice(b);
        QCOMPARE(r.downloaded, 1);
        QCOMPARE(r.conflicts, 0);
        const QByteArray onB = read(b + u"/.directory"_s);
        QVERIFY(onB.contains("Icon=folder-red"));
        QVERIFY(onB.contains("X-MarkNote-LastEntry=Two.md"));
        QCOMPARE(syncDevice(b).changes(), 0);
    }

    void testListingFailureChangesNothing()
    {
        write(a + u"/Note.md"_s, "x");
        LocalFolderBackend broken(u"/proc/definitely/not/writable"_s);
        SyncEngine engine(a, &broken, a + u"/.marknote/sync/broken.json"_s);
        const SyncResult r = engine.run();
        QVERIFY(!r.ok());
        QCOMPARE(r.changes(), 0);
        QCOMPARE(read(a + u"/Note.md"_s), QByteArray("x"));
    }
};

QTEST_GUILESS_MAIN(SyncEngineTest)
#include "syncenginetest.moc"
