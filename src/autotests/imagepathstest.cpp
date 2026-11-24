// SPDX-FileCopyrightText: 2026 Marknote fork contributors
// SPDX-License-Identifier: GPL-2.0-or-later

#include "../mdtreemodel/mddatagenerator.h"
#include "../notemetadata/imagelinks.h"
#include "../notesmodel.h"

#include <md4qt/parser.h>

#include <QDir>
#include <QFile>
#include <QRegularExpression>
#include <QTemporaryDir>
#include <QImage>
#include <QTextBlock>
#include <QTextDocument>
#include <QTextStream>
#include <QtTest/QtTest>

using namespace Qt::Literals::StringLiterals;

/// Relative image links: shown from the note's folder, saved as written.
class ImagePathsTest : public QObject
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

    static QString read(const QString &path)
    {
        QFile f(path);
        return f.open(QFile::ReadOnly) ? QString::fromUtf8(f.readAll()) : QString();
    }

    /// A fresh "Notes" folder with notebooks A and B.
    QString freshStorage()
    {
        static int n = 0;
        const QString root = m_dir.filePath(u"storage%1"_s.arg(++n));
        QDir().mkpath(root + u"/A"_s);
        QDir().mkpath(root + u"/B"_s);
        return root;
    }

    QSharedPointer<MD::Document> parse(QByteArray md, const QString &noteDir)
    {
        QTextStream stream(&md);
        MD::Parser parser;
        return parser.parse(stream, noteDir, u"Note.md"_s);
    }

    static QStringList sources(const QSharedPointer<MD::Document> &doc)
    {
        QStringList out;
        static const QRegularExpression re(u"<img\\b[^>]*\\bsrc=\"([^\"]*)\""_s);
        for (const auto &item : doc->items()) {
            if (item->type() != MD::ItemType::Paragraph) {
                continue;
            }
            auto it = re.globalMatch(MDDataGenerator::toHtml(item, doc));
            while (it.hasNext()) {
                out << it.next().captured(1);
            }
        }
        return out;
    }

private Q_SLOTS:
    void initTestCase()
    {
        QVERIFY(m_dir.isValid());
        QDir().mkpath(m_dir.filePath(u"Notebook/Sub dir"_s));
    }

    void testRelativeLinksResolveToTheNotesFolder()
    {
        const QString nb = m_dir.filePath(u"Notebook"_s);
        auto doc = parse("![a](rel.png)\n\n![b](./rel%20copy.png)\n\n![c](<rel copy.png>)\n\n![d](../up.png)\n\n![e](img/x.png)\n",
                         nb + u"/Sub dir"_s);
        const QString sub = QUrl::fromLocalFile(nb + u"/Sub dir/"_s).toString(QUrl::FullyEncoded);
        QCOMPARE(sources(doc),
                 (QStringList{sub + u"rel.png"_s,
                              sub + u"rel%20copy.png"_s,
                              sub + u"rel%20copy.png"_s,
                              QUrl::fromLocalFile(nb + u"/up.png"_s).toString(QUrl::FullyEncoded),
                              sub + u"img/x.png"_s}));
    }

    void testAbsoluteAndWebLinksUnchanged()
    {
        auto doc = parse("![a](file:///home/me/x.png)\n\n![b](https://example.com/y.png)\n", m_dir.path());
        QCOMPARE(sources(doc), (QStringList{u"file:///home/me/x.png"_s, u"https://example.com/y.png"_s}));
    }

    void testSavingKeepsLinksAsWritten()
    {
        const QByteArray md = "![a](rel.png)\n\n![b](./rel%20copy.png)\n\n![c](<rel copy.png>)\n\n![d](../up.png)\n";
        auto doc = parse(md, m_dir.filePath(u"Notebook/Sub dir"_s));
        QString out;
        QTextStream os(&out);
        MD::SerialiseHelper helper;
        doc->write(os, &helper);
        QCOMPARE(out.trimmed(), QString::fromUtf8(md).trimmed());
    }

    void testFindSkipsCode()
    {
        const QString text = u"![a](a.png) `![b](b.png)`\n\n```\n![c](c.png)\n```\n![d](<d e.png>) ![e](f(1).png) [not](x.png)\n"_s;
        QStringList targets;
        for (const auto &l : ImageLinks::find(text)) {
            targets << l.target;
        }
        QCOMPARE(targets, (QStringList{u"a.png"_s, u"<d e.png>"_s, u"f(1).png"_s}));
    }

    void testRelativeLinkEncoding()
    {
        QCOMPARE(ImageLinks::relativeLink(u"/n/A/Sub"_s, u"/n/A/My pic (1).png"_s), u"../My%20pic%20%281%29.png"_s);
        QCOMPARE(ImageLinks::relativeLink(u"/n/A"_s, u"/n/A/Ünïcode.png"_s), u"Ünïcode.png"_s);
        QCOMPARE(ImageLinks::resolve(u"../My%20pic%20%281%29.png"_s, u"/n/A/Sub"_s), u"/n/A/My pic (1).png"_s);
        QCOMPARE(ImageLinks::resolve(u"file:///x/y%20z.png"_s, u"/n"_s), u"/x/y z.png"_s);
        QVERIFY(ImageLinks::resolve(u"https://e.com/a.png"_s, u"/n"_s).isEmpty());
        QVERIFY(ImageLinks::isRelative(u"a%20b.png"_s));
        QVERIFY(!ImageLinks::isRelative(u"file:///a.png"_s));
        QVERIFY(!ImageLinks::isRelative(u"/home/a.png"_s));
    }

    void testInsertingImages()
    {
        const QString s = freshStorage();
        const QString note = s + u"/A/Sub/My note.md"_s;
        write(note, "# Note\n");
        write(s + u"/A/pics/inside.png"_s, "in");
        write(m_dir.filePath(u"elsewhere/outside.png"_s), "out");
        QCOMPARE(ImageLinks::linkForNewImage(note, s + u"/A/pics/inside.png"_s, s + u"/A"_s), u"../pics/inside.png"_s);
        const QString link = ImageLinks::linkForNewImage(note, m_dir.filePath(u"elsewhere/outside.png"_s), s + u"/A"_s);
        QVERIFY2(QRegularExpression(u"^My%20note_\\d+\\.png$"_s).match(link).hasMatch(), qPrintable(link));
        QCOMPARE(read(ImageLinks::resolve(link, s + u"/A/Sub"_s)), u"out"_s);
    }

    void testMovingANoteWithinANotebook()
    {
        const QString s = freshStorage();
        write(s + u"/A/Note_1.png"_s, "own");
        write(s + u"/A/shared.png"_s, "shared");
        write(s + u"/A/Note.md"_s, "![own](Note_1.png)\n![shared](shared.png)\n![web](https://e.com/x.png)\n![abs](file:///abs/y.png)\n");
        QDir().mkpath(s + u"/A/Deep/Er"_s);
        QVERIFY(QFile::rename(s + u"/A/Note.md"_s, s + u"/A/Deep/Er/Note.md"_s));
        const auto r = ImageLinks::noteMoved(s + u"/A/Note.md"_s, s + u"/A/Deep/Er/Note.md"_s, s + u"/A"_s, s + u"/A"_s);
        QCOMPARE(r.moved, 1);
        QCOMPARE(r.copied, 0);
        QCOMPARE(read(s + u"/A/Deep/Er/Note.md"_s),
                 u"![own](Note_1.png)\n![shared](../../shared.png)\n![web](https://e.com/x.png)\n![abs](file:///abs/y.png)\n"_s);
        QVERIFY(QFile::exists(s + u"/A/Deep/Er/Note_1.png"_s));
        QVERIFY(!QFile::exists(s + u"/A/Note_1.png"_s));
        QVERIFY(QFile::exists(s + u"/A/shared.png"_s));
    }

    void testMovingANoteToAnotherNotebookCopiesSharedImages()
    {
        const QString s = freshStorage();
        write(s + u"/A/shared.png"_s, "shared");
        write(s + u"/A/Note.md"_s, "![shared](shared.png)\n");
        QVERIFY(QFile::rename(s + u"/A/Note.md"_s, s + u"/B/Note.md"_s));
        const auto r = ImageLinks::noteMoved(s + u"/A/Note.md"_s, s + u"/B/Note.md"_s, s + u"/A"_s, s + u"/B"_s);
        QCOMPARE(r.copied, 1);
        QCOMPARE(read(s + u"/B/Note.md"_s), u"![shared](shared.png)\n"_s);
        QCOMPARE(read(s + u"/B/shared.png"_s), u"shared"_s);
        QVERIFY(QFile::exists(s + u"/A/shared.png"_s)); // other notes may still use it
    }

    void testMovingAFolder()
    {
        const QString s = freshStorage();
        write(s + u"/A/X/Note.md"_s, "![in](img/in.png)\n![out](../top.png)\n");
        write(s + u"/A/X/img/in.png"_s, "in");
        write(s + u"/A/top.png"_s, "top");
        QDir().mkpath(s + u"/A/Y"_s);
        QVERIFY(QFile::rename(s + u"/A/X"_s, s + u"/A/Y/X"_s));
        const auto r = ImageLinks::folderMoved(s + u"/A/X"_s, s + u"/A/Y/X"_s, s + u"/A"_s, s + u"/A"_s);
        QCOMPARE(r.rewritten, 1);
        QCOMPARE(read(s + u"/A/Y/X/Note.md"_s), u"![in](img/in.png)\n![out](../../top.png)\n"_s);
    }

    void testMakeRelative()
    {
        const QString s = freshStorage();
        write(s + u"/A/pics/in side.png"_s, "in");
        write(m_dir.filePath(u"elsewhere2/out.png"_s), "out");
        const QString inUrl = QUrl::fromLocalFile(s + u"/A/pics/in side.png"_s).toString(QUrl::FullyEncoded);
        const QString outPath = m_dir.filePath(u"elsewhere2/out.png"_s);
        write(s + u"/A/Sub/Note.md"_s,
              (u"---\nid: X\n---\n\n![a](%1)\n![b](%2)\n![c](file:///gone/missing.png)\n![d](https://e.com/w.png)\n![e](rel.png)\n\n```\n![f](%1)\n```\n"_s.arg(inUrl, outPath)).toUtf8());
        const auto r = ImageLinks::makeRelative(s + u"/A"_s);
        QCOMPARE(r.rewritten, 2);
        QCOMPARE(r.copied, 1);
        QCOMPARE(r.missing, 1);
        QCOMPARE(read(s + u"/A/Sub/Note.md"_s),
                 u"---\nid: X\n---\n\n![a](../pics/in%20side.png)\n![b](out.png)\n![c](file:///gone/missing.png)\n![d](https://e.com/w.png)\n![e](rel.png)\n\n```\n![f](%1)\n```\n"_s.arg(inUrl));
        QCOMPARE(read(s + u"/A/Sub/out.png"_s), u"out"_s);
        // Running again changes nothing.
        QCOMPARE(ImageLinks::makeRelative(s + u"/A"_s).rewritten, 0);
    }

    void testPdfAndOdtExportsFindRelativeImages()
    {
        // Those exports render through QTextDocument with the note's folder as base URL.
        const QString s = freshStorage();
        QImage img(30, 20, QImage::Format_RGB32);
        img.fill(Qt::red);
        QVERIFY(img.save(s + u"/A/my pic.png"_s));
        QTextDocument doc;
        doc.setBaseUrl(QUrl::fromLocalFile(s + u"/A/Sub/"_s));
        doc.setMarkdown(u"![pic](../my%20pic.png)"_s);
        QTextBlock block = doc.begin();
        QString name;
        for (auto it = block.begin(); !it.atEnd(); ++it) {
            if (it.fragment().charFormat().isImageFormat()) {
                name = it.fragment().charFormat().toImageFormat().name();
            }
        }
        QVERIFY(!name.isEmpty());
        const QVariant res = doc.resource(QTextDocument::ImageResource, QUrl(name));
        QVERIFY2(res.isValid(), qPrintable(name));
        QCOMPARE(qvariant_cast<QImage>(res).size(), QSize(30, 20));
    }

    void testHtmlExportUsesAbsoluteImagePaths()
    {
        const QString s = freshStorage();
        write(s + u"/A/Sub/Note.md"_s, "---\nid: X\n---\n\n# Note\n\n![pic](../my%20pic.png)\n");
        write(s + u"/A/my pic.png"_s, "x");
        NotesModel model;
        const QString out = m_dir.filePath(u"export.html"_s);
        QVERIFY(model.exportToHtml(QUrl::fromLocalFile(s + u"/A/Sub/Note.md"_s), QUrl::fromLocalFile(out)));
        const QString html = read(out);
        QVERIFY2(html.contains(QUrl::fromLocalFile(s + u"/A/my pic.png"_s).toString(QUrl::FullyEncoded)), qPrintable(html));
        QVERIFY(!html.contains(u"id: X"_s));
    }
};

QTEST_MAIN(ImagePathsTest)
#include "imagepathstest.moc"
