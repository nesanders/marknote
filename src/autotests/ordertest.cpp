// SPDX-FileCopyrightText: 2026 Marknote fork contributors
// SPDX-License-Identifier: GPL-2.0-only OR GPL-3.0-only OR LicenseRef-KDE-Accepted-GPL

#include "../notemetadata/notemetadata.h"
#include "../notesmodel.h"

#include <KConfig>
#include <KConfigGroup>
#include <QDir>
#include <QFile>
#include <QTemporaryDir>
#include <QtTest/QtTest>

using namespace Qt::Literals::StringLiterals;

/// View › Sort Notes › Manual: the order kept in each folder's .directory.
class OrderTest : public QObject
{
    Q_OBJECT

    QTemporaryDir m_tmp;

    static void touch(const QString &path)
    {
        QDir().mkpath(QFileInfo(path).absolutePath());
        QFile f(path);
        QVERIFY(f.open(QFile::WriteOnly));
        f.write("# x\n");
    }

    QStringList sorted(const QString &folder)
    {
        auto *meta = NoteMetadata::instance();
        QStringList names;
        for (const QFileInfo &info : QDir(folder).entryInfoList(QDir::Dirs | QDir::Files | QDir::NoDotAndDotDot)) {
            if (info.isDir() || info.fileName().endsWith(u".md"_s)) {
                names << info.fileName();
            }
        }
        std::sort(names.begin(), names.end(), [&](const QString &a, const QString &b) {
            return meta->manualSortKey(folder + u'/' + a) < meta->manualSortKey(folder + u'/' + b);
        });
        return names;
    }

private Q_SLOTS:
    void testPlaceRenameAndNewNotes()
    {
        const QString nb = m_tmp.filePath(u"Notebook"_s);
        touch(nb + u"/Apples.md"_s);
        touch(nb + u"/Bananas.md"_s);
        QDir().mkpath(nb + u"/Cherries"_s);
        touch(nb + u"/image.png"_s); // not shown, never listed

        // Nothing arranged yet: by name.
        QCOMPARE(sorted(nb), (QStringList{u"Apples.md"_s, u"Bananas.md"_s, u"Cherries"_s}));

        // Two notes swapped (the case that used to do nothing).
        auto *meta = NoteMetadata::instance();
        QVERIFY(meta->placeInOrder(nb, u"Bananas.md"_s, u"Apples.md"_s, false));
        QCOMPARE(sorted(nb), (QStringList{u"Bananas.md"_s, u"Apples.md"_s, u"Cherries"_s}));
        QVERIFY(meta->placeInOrder(QUrl::fromLocalFile(nb).toString(), u"Cherries"_s, u"Bananas.md"_s, true));
        QCOMPARE(sorted(nb), (QStringList{u"Bananas.md"_s, u"Cherries"_s, u"Apples.md"_s}));

        // Stored in .directory, as a KDE list; other keys kept.
        KConfig config(nb + u"/.directory"_s, KConfig::SimpleConfig);
        QCOMPARE(config.group(u"Desktop Entry"_s).readEntry("X-Marknote-Order", QStringList()),
                 (QStringList{u"Bananas.md"_s, u"Cherries"_s, u"Apples.md"_s}));

        // A new note goes last; names with commas survive.
        touch(nb + u"/Aardvark, notes.md"_s);
        QCOMPARE(sorted(nb).last(), u"Aardvark, notes.md"_s);
        QVERIFY(meta->placeInOrder(nb, u"Aardvark, notes.md"_s, u"Bananas.md"_s, false));
        meta->filesChanged({nb + u"/.directory"_s}); // as after a sync: re-read from disk
        QCOMPARE(sorted(nb).first(), u"Aardvark, notes.md"_s);

        // A rename keeps its place.
        NotesModel model;
        model.setPath(nb);
        const QUrl renamed = model.renameNote(QUrl::fromLocalFile(nb + u"/Cherries"_s), u"Dates"_s);
        QVERIFY(renamed.isValid());
        QCOMPARE(sorted(nb), (QStringList{u"Aardvark, notes.md"_s, u"Bananas.md"_s, u"Dates"_s, u"Apples.md"_s}));
    }
};

QTEST_MAIN(OrderTest)
#include "ordertest.moc"
