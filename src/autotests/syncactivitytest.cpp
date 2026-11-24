// SPDX-FileCopyrightText: 2026 Marknote fork contributors
// SPDX-License-Identifier: GPL-2.0-only OR GPL-3.0-only OR LicenseRef-KDE-Accepted-GPL

#include "../sync/syncmanager.h"

#include <marknotesettings.h>

#include <QDir>
#include <QFile>
#include <QSignalSpy>
#include <QStandardPaths>
#include <QTemporaryDir>
#include <QtTest/QtTest>

using namespace Qt::Literals::StringLiterals;
using namespace Sync;

/// Background sync, the activity log and "updated" markers, through SyncManager.
class SyncActivityTest : public QObject
{
    Q_OBJECT

    QTemporaryDir m_tmp;
    QString storage, notebook, remote, other;

    static void write(const QString &path, const QByteArray &content)
    {
        QDir().mkpath(QFileInfo(path).absolutePath());
        QFile f(path);
        QVERIFY(f.open(QFile::WriteOnly | QFile::Truncate));
        f.write(content);
    }

    /// Run a sync of the "other device" straight against the shared folder.
    void otherDeviceWrites(const QString &rel, const QByteArray &content)
    {
        write(remote + u'/' + rel, content);
    }

    void waitForSync(QSignalSpy &spy, int count = 1)
    {
        while (spy.count() < count) {
            QVERIFY(spy.wait(10000));
        }
    }

private Q_SLOTS:
    void initTestCase()
    {
        QStandardPaths::setTestModeEnabled(true);
        storage = m_tmp.filePath(u"Notes"_s);
        notebook = storage + u"/Journal"_s;
        remote = m_tmp.filePath(u"Shared/Journal"_s);
        QDir().mkpath(notebook);
        QDir().mkpath(remote);
        Config::self()->setStorage(storage);
        Config::self()->setAutoSync(true);
        write(notebook + u"/Today.md"_s, "# Today\n");
        auto *m = SyncManager::instance();
        QVERIFY(m->saveSettings(notebook, {{u"destination"_s, u"folder"_s}, {u"localFolder"_s, remote}}));
    }

    void testBackgroundSyncRecordsActivity()
    {
        auto *m = SyncManager::instance();
        QSignalSpy finished(m, &SyncManager::syncFinished);
        QCOMPARE(m->status(notebook).value(u"state"_s).toString(), u"never"_s);

        m->syncAllInBackground();
        waitForSync(finished);
        QCOMPARE(finished.last().at(4).toBool(), true); // background
        QCOMPARE(finished.last().at(5).toInt(), 0); // nothing received
        QCOMPARE(m->status(notebook).value(u"state"_s).toString(), u"ok"_s);
        QVERIFY(QFile::exists(remote + u"/Today.md"_s));

        // Another device adds and edits notes on the destination.
        otherDeviceWrites(u"Ideas.md"_s, "# Ideas\n");
        otherDeviceWrites(u"Trips/Rome.md"_s, "# Rome\n");
        otherDeviceWrites(u"Today.md"_s, "# Today\n\nFrom the phone\n");

        // A background run right after the last one is skipped…
        m->syncAllInBackground(60);
        QTest::qWait(200);
        QCOMPARE(finished.count(), 1);
        // …but a due one brings the changes in.
        m->syncAllInBackground();
        waitForSync(finished, 2);
        QCOMPARE(finished.last().at(5).toInt(), 3);

        QVERIFY(m->isUnseen(notebook + u"/Ideas.md"_s));
        QVERIFY(m->isUnseen(QUrl::fromLocalFile(notebook + u"/Trips/Rome.md"_s).toString()));
        QVERIFY(m->isUnseen(notebook + u"/Today.md"_s));
        QCOMPARE(m->unseenCount(notebook), 3);
        QCOMPARE(m->unseenIn(notebook + u"/Trips"_s), 1);
        QCOMPARE(m->unseenIn(notebook), 3);

        const QVariantList log = m->activity(notebook);
        QVERIFY(log.size() >= 4);
        QStringList received;
        for (const QVariant &v : log) {
            const QVariantMap e = v.toMap();
            if (e.value(u"kind"_s) == u"received"_s) {
                received << e.value(u"path"_s).toString();
                QVERIFY(e.value(u"unseen"_s).toBool());
                QVERIFY(e.value(u"exists"_s).toBool());
            }
        }
        received.sort();
        QCOMPARE(received, (QStringList{u"Ideas.md"_s, u"Today.md"_s, u"Trips/Rome.md"_s}));

        // Opening a note marks it seen, and that survives a restart (file on disk).
        QSignalSpy activity(m, &SyncManager::activityChanged);
        m->markSeen(notebook + u"/Ideas.md"_s);
        QCOMPARE(activity.count(), 1);
        QVERIFY(!m->isUnseen(notebook + u"/Ideas.md"_s));
        QVERIFY(QFile(SyncManager::activityPath(notebook)).size() > 0);
        QVERIFY(!QFile::exists(remote + u"/.marknote/sync/activity.json"_s)); // device-local

        // A note deleted here is no longer counted.
        QFile::remove(notebook + u"/Trips/Rome.md"_s);
        QCOMPARE(m->unseenCount(notebook), 1);

        m->markAllSeen(notebook);
        QCOMPARE(m->unseenCount(notebook), 0);
    }

    void testConflictCopyIsUnseen()
    {
        auto *m = SyncManager::instance();
        QSignalSpy finished(m, &SyncManager::syncFinished);
        write(notebook + u"/Today.md"_s, "# Today\n\nDesktop edit\n");
        otherDeviceWrites(u"Today.md"_s, "# Today\n\nPhone edit\n");
        QVERIFY(m->syncNow(notebook));
        waitForSync(finished);
        QCOMPARE(finished.last().at(4).toBool(), false); // asked for by the user
        const QVariantMap newest = m->activity(notebook, 5).constFirst().toMap();
        QVariantMap conflict;
        for (const QVariant &v : m->activity(notebook, 5)) {
            if (v.toMap().value(u"kind"_s) == u"conflict"_s) {
                conflict = v.toMap();
            }
        }
        QVERIFY(!conflict.isEmpty());
        QCOMPARE(conflict.value(u"path"_s).toString(), u"Today.md"_s);
        QVERIFY(conflict.value(u"copyExists"_s).toBool());
        QVERIFY(m->isUnseen(conflict.value(u"copyFile"_s).toString()));
        QVERIFY(!m->isUnseen(notebook + u"/Today.md"_s));
        Q_UNUSED(newest)
    }

    void testBackgroundSkipsWhenDisabled()
    {
        auto *m = SyncManager::instance();
        Config::self()->setAutoSync(false);
        QSignalSpy finished(m, &SyncManager::syncFinished);
        m->syncAllInBackground();
        QTest::qWait(300);
        QCOMPARE(finished.count(), 0);
        Config::self()->setAutoSync(true);
    }
};

QTEST_GUILESS_MAIN(SyncActivityTest)
#include "syncactivitytest.moc"
