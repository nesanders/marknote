// SPDX-FileCopyrightText: 2026 Marknote fork contributors
// SPDX-License-Identifier: GPL-2.0-or-later

#include "../mdtreemodel/mdtreemodel.h"
#include "../notemetadata/frontmatter.h"
#include "../notemetadata/notemetadata.h"
#include "../rich_documenthandler.h"

#include <QFile>
#include <QObject>
#include <QTemporaryDir>
#include <QtTest/QtTest>

using namespace Qt::Literals::StringLiterals;

class FrontMatterTest : public QObject
{
    Q_OBJECT

private Q_SLOTS:
    void testSplitAndJoinRoundTrip()
    {
        const QString note = u"---\nid: ABC\naliases: [x, y]\n# a comment\ntags: [design, planning]\n---\n\n# Title\n\nBody\n"_s;
        const auto parts = FrontMatter::split(note);
        QVERIFY(parts.present);
        QCOMPARE(parts.body, u"# Title\n\nBody\n"_s);
        QCOMPARE(FrontMatter::join(parts.raw, parts.body), note);
    }

    void testNoFrontMatter_data()
    {
        QTest::addColumn<QString>("text");
        QTest::newRow("plain") << u"# Title\n\nBody\n"_s;
        QTest::newRow("leading rule, no closing") << u"---\nJust a rule then text\n"_s;
        QTest::newRow("empty") << QString();
    }

    void testNoFrontMatter()
    {
        QFETCH(QString, text);
        const auto parts = FrontMatter::split(text);
        QVERIFY(!parts.present);
        QCOMPARE(parts.body, text);
        QCOMPARE(FrontMatter::join(QString(), parts.body), text);
    }

    void testParseTagForms_data()
    {
        QTest::addColumn<QString>("raw");
        QTest::newRow("flow") << u"tags: [design, \"two words\", '#kde']"_s;
        QTest::newRow("block") << u"tags:\n  - design\n  - two words\n  - \"#kde\""_s;
        QTest::newRow("block at column 0") << u"tags:\n- design\n- two words\n- '#kde'\nother: 1"_s;
    }

    void testParseTagForms()
    {
        QFETCH(QString, raw);
        QCOMPARE(FrontMatter::parse(raw).tags, (QStringList{u"design"_s, u"two words"_s, u"kde"_s}));
    }

    void testParseScalars()
    {
        const auto meta = FrontMatter::parse(u"id: 01ABC\ncreated: 2026-11-24T09:12:00\nicon: \"🎨\"\ntitle: 'It''s here'"_s);
        QCOMPARE(meta.id, u"01ABC"_s);
        QCOMPARE(meta.created, QDateTime(QDate(2026, 11, 24), QTime(9, 12)));
        QCOMPARE(meta.icon, u"🎨"_s);
        QCOMPARE(meta.title, u"It's here"_s);
        QCOMPARE(FrontMatter::parse(u"created: 2026-11-24"_s).created, QDateTime(QDate(2026, 11, 24), QTime(0, 0)));
    }

    void testSetValuePreservesOtherLines()
    {
        const QString raw = u"id: X\n# keep me\ntags:\n  - old\n  - stale\naliases: [a]"_s;
        QString edited = FrontMatter::setValue(raw, u"tags"_s, QStringList{u"new"_s, u"two words"_s});
        QCOMPARE(edited, u"id: X\n# keep me\ntags: [new, two words]\naliases: [a]"_s);

        edited = FrontMatter::setValue(edited, u"icon"_s, u"🐬"_s);
        QVERIFY(edited.endsWith(u"\nicon: \"🐬\""_s));
        QCOMPARE(FrontMatter::parse(edited).icon, u"🐬"_s);

        edited = FrontMatter::setValue(edited, u"tags"_s, QStringList());
        QVERIFY(!edited.contains(u"tags"_s));
        QVERIFY(edited.contains(u"# keep me"_s));
        QVERIFY(edited.contains(u"aliases: [a]"_s));
    }

    void testQuotingRoundTrips()
    {
        const QStringList tricky{u"a: b"_s, u"#hash"_s, u"true"_s, u"42"_s, u"quote\"d"_s, u"plain"_s};
        const QString raw = FrontMatter::setValue(QString(), u"tags"_s, tricky);
        QStringList expected = tricky;
        expected[1] = u"hash"_s; // leading '#' is not part of a tag name
        QCOMPARE(FrontMatter::parse(raw).tags, expected);
    }

    void testNewIdIsUlid()
    {
        const QString a = FrontMatter::newId();
        const QString b = FrontMatter::newId();
        QCOMPARE(a.size(), 26);
        QVERIFY(a != b);
        QVERIFY(QRegularExpression(u"^[0-9A-HJKMNP-TV-Z]{26}$"_s).match(a).hasMatch());
    }

    void testEditorHidesAndPreservesFrontMatter()
    {
        QTemporaryDir dir;
        const QString path = dir.filePath(u"note.md"_s);
        writeFile(path, "---\nid: KEEP\naliases: [x]\ntags: [design]\n---\n\n# Title\n\nSome content\n");

        RichDocumentHandler handler;
        const QUrl url = QUrl::fromLocalFile(path);
        handler.load(url);
        QTRY_VERIFY(handler.treeModel()->toMarkdown().contains(u"Some content"_s));

        const QString shown = handler.treeModel()->toMarkdown();
        QVERIFY2(!shown.contains(u"id:"_s), qPrintable(shown));
        QVERIFY(!shown.contains(u"aliases"_s));

        QVERIFY(handler.treeModel()->saveToFile(url));
        const QString saved = QString::fromUtf8(readFile(path));
        const auto parts = FrontMatter::split(saved);
        QVERIFY(parts.present);
        QCOMPARE(FrontMatter::parse(parts.raw).id, u"KEEP"_s);
        QVERIFY(parts.raw.contains(u"aliases: [x]"_s));
        QCOMPARE(saved.count(u"Some content"_s), 1);
    }

    void testMetadataChangedWhileOpenSurvivesSave()
    {
        QTemporaryDir dir;
        const QString path = dir.filePath(u"note.md"_s);
        writeFile(path, "---\nid: KEEP\n---\n\nBody\n");

        RichDocumentHandler handler;
        const QUrl url = QUrl::fromLocalFile(path);
        handler.load(url);
        QTRY_VERIFY(handler.treeModel()->toMarkdown().contains(u"Body"_s));

        // Tags edited from the notes list while the note is open in the editor.
        QVERIFY(NoteMetadata::instance()->setTags(url, {u"kde"_s, u"#reference"_s}));
        QVERIFY(handler.treeModel()->saveToFile(url));

        const auto meta = FrontMatter::parse(FrontMatter::readRawFromFile(path));
        QCOMPARE(meta.id, u"KEEP"_s);
        QCOMPARE(meta.tags, (QStringList{u"kde"_s, u"reference"_s}));
    }

    void testLegacyNoteGetsIdAndCreatedOnSave()
    {
        QTemporaryDir dir;
        const QString path = dir.filePath(u"legacy.md"_s);
        writeFile(path, "# Old note\n\nText\n");

        RichDocumentHandler handler;
        const QUrl url = QUrl::fromLocalFile(path);
        handler.load(url);
        QTRY_VERIFY(handler.treeModel()->toMarkdown().contains(u"Text"_s));
        QVERIFY(handler.treeModel()->saveToFile(url));

        bool present = false;
        const auto meta = FrontMatter::parse(FrontMatter::readRawFromFile(path, &present));
        QVERIFY(present);
        QCOMPARE(meta.id.size(), 26);
        QVERIFY(meta.created.isValid());
        QVERIFY(FrontMatter::split(QString::fromUtf8(readFile(path))).body.startsWith(u"# Old note"_s));
    }

    void testFolderIconsUseDotDirectory()
    {
        QTemporaryDir dir;
        const QUrl folder = QUrl::fromLocalFile(dir.path());
        QVERIFY(NoteMetadata::instance()->setFolderIcon(folder, u"📚"_s));
        QCOMPARE(NoteMetadata::instance()->folderIcon(folder), u"📚"_s);
        QVERIFY(NoteMetadata::instance()->setFolderIcon(folder, u"folder-blue"_s));
        QCOMPARE(NoteMetadata::instance()->folderIcon(folder), u"folder-blue"_s);
        QVERIFY(readFile(dir.filePath(u".directory"_s)).contains("Icon=folder-blue"));
    }

private:
    static void writeFile(const QString &path, const QByteArray &content)
    {
        QFile file(path);
        QVERIFY(file.open(QFile::WriteOnly | QFile::Truncate));
        file.write(content);
    }

    static QByteArray readFile(const QString &path)
    {
        QFile file(path);
        if (!file.open(QFile::ReadOnly)) {
            return {};
        }
        return file.readAll();
    }
};

QTEST_MAIN(FrontMatterTest)
#include "frontmattertest.moc"
