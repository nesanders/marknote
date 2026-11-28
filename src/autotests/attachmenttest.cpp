// SPDX-FileCopyrightText: 2026 Marknote fork contributors
// SPDX-License-Identifier: GPL-2.0-only OR GPL-3.0-only OR LicenseRef-KDE-Accepted-GPL

#include "../attachments.h"
#include "../commands/commandmanager.h"
#include "../mdtreemodel/mdtreemodel.h"

#include <QFile>
#include <QTemporaryDir>
#include <QtTest/QtTest>

#include <md4qt/parser.h>

using namespace Qt::Literals::StringLiterals;

/// File attachments (docs/attachments.md).
class AttachmentTest : public QObject
{
    Q_OBJECT

    /// Loads @p markdown the way a note is opened, and writes it back.
    static QString roundTrip(const QString &markdown, MDTreeModel &model)
    {
        QByteArray utf8 = markdown.toUtf8();
        QTextStream stream(&utf8);
        MD::Parser parser;
        auto doc = parser.parse(stream, QString(), QString());
        TreeItem::groupSpecialBlocks(doc, markdown);
        model.setDocument(doc);
        return model.toMarkdown();
    }

    static QList<TreeItem *> attachments(MDTreeModel &model)
    {
        QList<TreeItem *> out;
        for (TreeItem *child : model.rootItem()->children()) {
            if (child->type() == MDOptions::ElementType::Attachment) {
                out << child;
            }
        }
        return out;
    }

    /// The note's blocks (without the document's anchor).
    static QList<TreeItem *> blocks(MDTreeModel &model)
    {
        QList<TreeItem *> out;
        for (TreeItem *child : model.rootItem()->children()) {
            if (child->type() != MDOptions::ElementType::Anchor) {
                out << child;
            }
        }
        return out;
    }

    static void touch(const QString &path, const QByteArray &data = "x")
    {
        QFile f(path);
        QVERIFY(f.open(QIODevice::WriteOnly));
        f.write(data);
    }

private Q_SLOTS:
    void recognition_data()
    {
        QTest::addColumn<QString>("markdown");
        QTest::addColumn<bool>("isAttachment");
        QTest::addColumn<QString>("name");
        QTest::addColumn<QString>("path");

        QTest::newRow("plain") << u"[📎 Itinerary.pdf](Itinerary.pdf)"_s << true << u"Itinerary.pdf"_s << u"Itinerary.pdf"_s;
        QTest::newRow("no space after clip") << u"[📎Itinerary.pdf](Itinerary.pdf)"_s << true << u"Itinerary.pdf"_s << u"Itinerary.pdf"_s;
        QTest::newRow("surrounding blanks") << u"  [📎 A](a.zip)  \n"_s << true << u"A"_s << u"a.zip"_s;
        QTest::newRow("encoded name") << u"[📎 My file (2).pdf](My%20file%20%282%29.pdf)"_s << true << u"My file (2).pdf"_s << u"My file (2).pdf"_s;
        QTest::newRow("encoded unicode") << u"[📎 Café.txt](Caf%C3%A9.txt)"_s << true << u"Café.txt"_s << u"Café.txt"_s;
        QTest::newRow("angle brackets") << u"[📎 My file.pdf](<My file.pdf>)"_s << true << u"My file.pdf"_s << u"My file.pdf"_s;
        QTest::newRow("subfolder") << u"[📎 Scan](files/scan%201.png)"_s << true << u"Scan"_s << u"files/scan 1.png"_s;
        QTest::newRow("empty name uses file name") << u"[📎](docs/Report%20A.pdf)"_s << true << u"Report A.pdf"_s << u"docs/Report A.pdf"_s;
        QTest::newRow("no clip") << u"[Itinerary.pdf](Itinerary.pdf)"_s << false << QString() << QString();
        QTest::newRow("clip not first") << u"[See 📎 Itinerary.pdf](Itinerary.pdf)"_s << false << QString() << QString();
        QTest::newRow("absolute url") << u"[📎 Spec](https://example.com/spec.pdf)"_s << false << QString() << QString();
        QTest::newRow("file url") << u"[📎 Spec](file:///home/me/spec.pdf)"_s << false << QString() << QString();
        QTest::newRow("absolute path") << u"[📎 Spec](/home/me/spec.pdf)"_s << false << QString() << QString();
        QTest::newRow("anchor") << u"[📎 Up](#top)"_s << false << QString() << QString();
        QTest::newRow("note") << u"[📎 Other note](Other%20note.md)"_s << false << QString() << QString();
        QTest::newRow("note upper case") << u"[📎 Other](Other.MD)"_s << false << QString() << QString();
        QTest::newRow("text before") << u"See [📎 Itinerary.pdf](Itinerary.pdf)"_s << false << QString() << QString();
        QTest::newRow("text after") << u"[📎 Itinerary.pdf](Itinerary.pdf) for details"_s << false << QString() << QString();
        QTest::newRow("two links") << u"[📎 A](a.pdf) [📎 B](b.pdf)"_s << false << QString() << QString();
        QTest::newRow("image") << u"![📎 A](a.png)"_s << false << QString() << QString();
        QTest::newRow("two lines") << u"[📎 A](a.pdf)\n[📎 B](b.pdf)"_s << false << QString() << QString();
    }

    void recognition()
    {
        QFETCH(QString, markdown);
        QFETCH(bool, isAttachment);
        QFETCH(QString, name);
        QFETCH(QString, path);
        const auto att = Attachments::parse(markdown);
        QCOMPARE(att.has_value(), isAttachment);
        if (att) {
            QCOMPARE(att->name, name);
            QCOMPARE(att->path, path);
        }
    }

    void markdownForNewFiles()
    {
        QCOMPARE(Attachments::markdown(u"Itinerary.pdf"_s, Attachments::encodePath(u"Itinerary.pdf"_s)), u"[📎 Itinerary.pdf](Itinerary.pdf)"_s);
        const QString md = Attachments::markdown(u"My [draft] (2).pdf"_s, Attachments::encodePath(u"My [draft] (2).pdf"_s));
        const auto att = Attachments::parse(md);
        QVERIFY(att);
        QCOMPARE(att->path, u"My [draft] (2).pdf"_s);
        QCOMPARE(att->name, u"My draft (2).pdf"_s);
        // Links that need them get <...>.
        QCOMPARE(Attachments::markdown(u"A b"_s, u"A b.pdf"_s), u"[📎 A b](<A b.pdf>)"_s);
        // A # or ? in a name is part of the file name, not a fragment or query.
        QCOMPARE(Attachments::parse(Attachments::markdown(u"Q#1?.txt"_s, Attachments::encodePath(u"Q#1?.txt"_s)))->path, u"Q#1?.txt"_s);
    }

    /// Links that point outside the note's folder are not attachments.
    void staysInsideTheNoteFolder()
    {
        QVERIFY(!Attachments::parse(u"[📎 x](%2Fetc%2Fpasswd)"_s));
        QVERIFY(!Attachments::parse(u"[📎 x](../../.ssh/id_rsa)"_s));
        QVERIFY(!Attachments::parse(u"[📎 x](%2e%2e/secret.txt)"_s));
        QVERIFY(!Attachments::parse(u"[📎 x](C:%5Cwin.ini)"_s));
        QVERIFY(Attachments::parse(u"[📎 x](sub/ok.pdf)"_s));
    }

    /// Names with ":", "#", "?" or "\\" make working links.
    void awkwardNames()
    {
        for (const QString &name : {u"a:b.pdf"_s, u"Invoice #12.pdf"_s, u"what?.pdf"_s, u"100%.pdf"_s}) {
            const QString md = Attachments::markdown(name, Attachments::encodePath(name));
            const auto att = Attachments::parse(md);
            QVERIFY2(att, qPrintable(md));
            QCOMPARE(att->path, name);
        }
        QCOMPARE(Attachments::markdown(u"back\\slash[1]"_s, u"a.pdf"_s), u"[📎 backslash1](a.pdf)"_s);
    }

    void uniqueNames()
    {
        QTemporaryDir dir;
        QVERIFY(dir.isValid());
        QCOMPARE(Attachments::uniqueName(dir.path(), u"Report.pdf"_s), u"Report.pdf"_s);
        touch(dir.filePath(u"Report.pdf"_s));
        QCOMPARE(Attachments::uniqueName(dir.path(), u"Report.pdf"_s), u"Report (2).pdf"_s);
        touch(dir.filePath(u"Report (2).pdf"_s));
        QCOMPARE(Attachments::uniqueName(dir.path(), u"Report.pdf"_s), u"Report (3).pdf"_s);
        touch(dir.filePath(u"README"_s));
        QCOMPARE(Attachments::uniqueName(dir.path(), u"README"_s), u"README (2)"_s);
        touch(dir.filePath(u".env"_s));
        QCOMPARE(Attachments::uniqueName(dir.path(), u".env"_s), u".env (2)"_s);
        touch(dir.filePath(u"photos.tar.gz"_s));
        QCOMPARE(Attachments::uniqueName(dir.path(), u"photos.tar.gz"_s), u"photos.tar (2).gz"_s);
    }

    void attachCopiesNextToTheNote()
    {
        QTemporaryDir notebook;
        QTemporaryDir outside;
        QVERIFY(notebook.isValid() && outside.isValid());
        const QString note = notebook.filePath(u"Trip.md"_s);
        touch(note, "# Trip\n");
        const QString source = outside.filePath(u"Itinerary (final).pdf"_s);
        touch(source, "%PDF-1.4 hello");

        QString error;
        QCOMPARE(Attachments::attach(note, source, &error), u"[📎 Itinerary (final).pdf](Itinerary%20%28final%29.pdf)"_s);
        QVERIFY(QFile::exists(notebook.filePath(u"Itinerary (final).pdf"_s)));
        QVERIFY(QFile::exists(source));

        // The name is taken now.
        QCOMPARE(Attachments::attach(note, source, &error), u"[📎 Itinerary (final) (2).pdf](Itinerary%20%28final%29%20%282%29.pdf)"_s);
        QFile copy(notebook.filePath(u"Itinerary (final) (2).pdf"_s));
        QVERIFY(copy.open(QIODevice::ReadOnly));
        QCOMPARE(copy.readAll(), QByteArray("%PDF-1.4 hello"));

        // A file already next to the note is linked, not copied again.
        QCOMPARE(Attachments::attach(note, notebook.filePath(u"Itinerary (final).pdf"_s), &error), u"[📎 Itinerary (final).pdf](Itinerary%20%28final%29.pdf)"_s);
        QVERIFY(!QFile::exists(notebook.filePath(u"Itinerary (final) (3).pdf"_s)));

        QVERIFY(Attachments::attach(note, outside.filePath(u"missing.pdf"_s), &error).isEmpty());
        QVERIFY(!error.isEmpty());

        // What the card shows.
        AttachmentHelper helper;
        const QVariantMap info = helper.info(QUrl::fromLocalFile(note), u"[📎 Itinerary (final).pdf](Itinerary%20%28final%29.pdf)"_s);
        QVERIFY(info[u"valid"_s].toBool());
        QVERIFY(info[u"exists"_s].toBool());
        QCOMPARE(info[u"size"_s].toLongLong(), 14);
        QCOMPARE(info[u"path"_s].toString(), notebook.filePath(u"Itinerary (final).pdf"_s));
        QVERIFY(!info[u"iconName"_s].toString().isEmpty());
        QVERIFY(info[u"driveUrl"_s].toString().isEmpty());
        const QVariantMap gone = helper.info(QUrl::fromLocalFile(note), u"[📎 Gone.pdf](Gone.pdf)"_s);
        QVERIFY(gone[u"valid"_s].toBool());
        QVERIFY(!gone[u"exists"_s].toBool());
    }

    /// A note with attachments is read into one Attachment block each and
    /// written back unchanged.
    void roundTripKeepsTextVerbatim_data()
    {
        QTest::addColumn<QString>("markdown");
        QTest::addColumn<int>("count");
        QTest::newRow("one") << u"# Trip\n\nFlights booked.\n\n[📎 Itinerary.pdf](Itinerary.pdf)\n\nAfter\n"_s << 1;
        QTest::newRow("encoded, first and last") << u"[📎 My file (2).pdf](My%20file%20%282%29.pdf)\n\nText\n\n[📎 Scan](<scans/a b.png>)\n"_s << 2;
        QTest::newRow("with to-do block") << u"<!-- marknote-todo -->\n- [ ] Pack\n\n[📎 List.txt](List.txt)\n"_s << 1;
        QTest::newRow("not attachments") << u"See [📎 A](a.pdf) here.\n\n[📎 Web](https://example.com/a.pdf)\n\n[📎 Note](Note.md)\n"_s << 0;
    }

    void roundTripKeepsTextVerbatim()
    {
        QFETCH(QString, markdown);
        QFETCH(int, count);
        MDTreeModel model;
        const QString out = roundTrip(markdown, model);
        const auto found = attachments(model);
        QCOMPARE(found.size(), count);
        for (TreeItem *item : found) {
            QVERIFY(markdown.contains(item->data()[u"attachment"_s].toString()));
            QVERIFY(Attachments::parse(item->attachmentMarkdown()));
        }
        if (count > 0) {
            QCOMPARE(out.trimmed(), markdown.trimmed());
        }
    }

    void pastedAttachmentIsGrouped()
    {
        auto doc = QSharedPointer<MD::Document>::create();
        const auto items = TreeItem::fromMarkdown(u"[📎 Itinerary.pdf](Itinerary.pdf)"_s, doc);
        QCOMPARE(items.size(), 1);
        QCOMPARE(items.first()->type(), MDOptions::ElementType::Attachment);
        qDeleteAll(items);
    }

    void insertBelowIsUndoable()
    {
        MDTreeModel model;
        const QString markdown = u"# Trip\n\nFirst\n\nLast\n"_s;
        roundTrip(markdown, model);
        CommandManager manager;
        manager.setModel(&model);
        TreeItem *first = blocks(model).value(1);
        QVERIFY(first);
        manager.insertBlockBelow(first, u"[📎 Itinerary.pdf](Itinerary.pdf)"_s);
        QCOMPARE(blocks(model).size(), 4);
        QCOMPARE(blocks(model).at(2)->type(), MDOptions::ElementType::Attachment);
        QCOMPARE(model.toMarkdown().trimmed(), u"# Trip\n\nFirst\n\n[📎 Itinerary.pdf](Itinerary.pdf)\n\nLast"_s);
        manager.undo();
        QCOMPARE(blocks(model).size(), 3);
        QCOMPARE(model.toMarkdown().trimmed(), markdown.trimmed());
        manager.redo();
        QCOMPARE(blocks(model).at(2)->type(), MDOptions::ElementType::Attachment);
    }

    void backspaceAfterCardSelectsThenRemovesIt()
    {
        MDTreeModel model;
        roundTrip(u"[📎 A.pdf](A.pdf)\n\nText\n"_s, model);
        CommandManager manager;
        manager.setModel(&model);
        TreeItem *card = blocks(model).at(0);
        TreeItem *text = blocks(model).at(1);
        QCOMPARE(card->type(), MDOptions::ElementType::Attachment);
        manager.mergeWithPreviousBlock(text, u"Text"_s);
        QVERIFY(model.isBlockSelected(card));
        QCOMPARE(blocks(model).size(), 2);
        manager.mergeWithPreviousBlock(text, u"Text"_s);
        QCOMPARE(blocks(model).size(), 1);
        QCOMPARE(model.toMarkdown().trimmed(), u"Text"_s);
        manager.undo();
        QCOMPARE(model.toMarkdown().trimmed(), u"[📎 A.pdf](A.pdf)\n\nText"_s);
    }
};

QTEST_GUILESS_MAIN(AttachmentTest)
#include "attachmenttest.moc"
