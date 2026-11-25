// SPDX-FileCopyrightText: 2026 Marknote fork contributors
// SPDX-License-Identifier: GPL-2.0-only OR GPL-3.0-only OR LicenseRef-KDE-Accepted-GPL

#include "../mdtreemodel/mdtreemodel.h"
#include "../todoblock.h"

#include <KLocalizedString>
#include <QFile>
#include <QJsonArray>
#include <QJsonDocument>
#include <QJsonObject>
#include <QRegularExpression>
#include <QtTest/QtTest>

#include <md4qt/parser.h>

using namespace Qt::Literals::StringLiterals;

/// To-do blocks (docs/todo.md): the shared fixtures, also run by the web app's
/// tests, plus desktop-only cases.
class TodoTest : public QObject
{
    Q_OBJECT

    static QString run(const QJsonObject &c)
    {
        const QString input = c[u"input"_s].toString();
        const QString today = c[u"today"_s].toString();
        const QJsonObject op = c[u"op"_s].toObject();
        const QString type = op[u"type"_s].toString();
        const int line = op[u"line"_s].toInt();

        if (type == u"toggle"_s) {
            static const QRegularExpression checkedRe(u"\\[[xX]\\]"_s);
            const bool checked = op.contains(u"checked"_s) ? op[u"checked"_s].toBool() : !checkedRe.match(input.split(u'\n').value(line)).hasMatch();
            return TodoBlock::toggleLine(input, line, checked, today);
        }
        if (type == u"make"_s) {
            return TodoBlock::makeBlock(input, line, today).value_or(u"<null>"_s);
        }

        TodoBlock::Op o;
        o.line = line;
        if (type == u"due"_s) {
            o.type = TodoBlock::Op::Due;
            o.date = op[u"date"_s].isNull() ? QString() : op[u"date"_s].toString();
        } else if (type == u"sort"_s) {
            o.type = TodoBlock::Op::Sort;
            o.sort = op[u"sort"_s].toString();
        } else if (type == u"add"_s) {
            o.type = TodoBlock::Op::Add;
            o.text = op[u"text"_s].toString();
        } else if (type == u"move"_s) {
            o.type = TodoBlock::Op::Move;
            o.to = op[u"to"_s].toInt();
        } else {
            return u"<unknown op>"_s;
        }
        return TodoBlock::apply(input, o, today).value_or(u"<null>"_s);
    }

    /// Loads @p markdown the way a note is opened, and writes it back.
    static QString roundTrip(const QString &markdown, MDTreeModel &model)
    {
        QByteArray utf8 = markdown.toUtf8();
        QTextStream stream(&utf8);
        MD::Parser parser;
        auto doc = parser.parse(stream, QString(), QString());
        TreeItem::groupTodoBlocks(doc, markdown);
        model.setDocument(doc);
        return model.toMarkdown();
    }

    static TreeItem *findTodo(MDTreeModel &model)
    {
        for (TreeItem *child : model.rootItem()->children()) {
            if (child->type() == MDOptions::ElementType::Todo) {
                return child;
            }
        }
        return nullptr;
    }

private Q_SLOTS:
    void initTestCase()
    {
        KLocalizedString::setApplicationDomain("marknote");
    }

    void shared_data()
    {
        QTest::addColumn<QJsonObject>("testCase");
        QFile file(QStringLiteral(TODO_FIXTURES));
        QVERIFY(file.open(QIODevice::ReadOnly));
        const auto cases = QJsonDocument::fromJson(file.readAll()).object()[u"cases"_s].toArray();
        QVERIFY(!cases.isEmpty());
        for (const auto &c : cases) {
            QTest::newRow(c[u"name"_s].toString().toUtf8().constData()) << c.toObject();
        }
    }

    void shared()
    {
        QFETCH(QJsonObject, testCase);
        QCOMPARE(run(testCase), testCase[u"expected"_s].toString());
    }

    void findsBlocksWithTheirLineRanges()
    {
        const QString body = u"x\n<!-- marknote-todo sort=due -->\n- [ ] A\n\n<details>\n<summary>Done (1)</summary>\n\n- [x] B ✅ 2026-01-01\n\n</details>\ny"_s;
        const auto blocks = TodoBlock::findBlocks(body);
        QCOMPARE(blocks.size(), 1);
        const auto &b = blocks.first();
        QCOMPARE(b.start, 1);
        QCOMPARE(b.end, 10);
        QCOMPARE(b.options.sort, u"due"_s);
        QCOMPARE(b.doneStart, 4);
        QCOMPARE(b.done.size(), 1);
        QCOMPARE(b.done.first().text, u"B"_s);
        QCOMPARE(b.done.first().done, u"2026-01-01"_s);
        QCOMPARE(TodoBlock::locate(body, 7)->list, u"done"_s);
        QVERIFY(TodoBlock::locate(body, 5)->list.isEmpty());
        QVERIFY(!TodoBlock::locate(body, 10));
    }

    void incompleteDoneSectionIsLeftAlone()
    {
        const auto blocks = TodoBlock::findBlocks(u"<!-- marknote-todo -->\n- [ ] A\n\n<details>\nstuff"_s);
        QCOMPARE(blocks.size(), 1);
        QCOMPARE(blocks.first().end, 2);
        QVERIFY(blocks.first().done.isEmpty());
    }

    void unknownOptionsSurvive()
    {
        TodoBlock::Op op;
        op.type = TodoBlock::Op::Sort;
        op.sort = u"due"_s;
        const auto out = TodoBlock::apply(u"<!-- marknote-todo color=red -->\n- [ ] A"_s, op, u"2026-01-01"_s);
        QVERIFY(out);
        QCOMPARE(out->split(u'\n').first(), u"<!-- marknote-todo sort=due color=red -->"_s);
    }

    void invalidOperations()
    {
        TodoBlock::Op due;
        due.type = TodoBlock::Op::Due;
        due.line = 1;
        due.date = u"soon"_s;
        QVERIFY(!TodoBlock::apply(u"<!-- marknote-todo -->\n- [ ] A"_s, due));
        TodoBlock::Op toggle;
        QVERIFY(!TodoBlock::apply(u"- [ ] A"_s, toggle));
        QVERIFY(!TodoBlock::makeBlock(u"<!-- marknote-todo -->\n- [ ] A"_s, 1));
        QVERIFY(!TodoBlock::makeBlock(u"Just text"_s, 0));
    }

    void dates()
    {
        QCOMPARE(TodoBlock::dueState(u"2026-11-25"_s, u"2026-11-25"_s), u"today"_s);
        QCOMPARE(TodoBlock::dueState(u"2026-11-20"_s, u"2026-11-25"_s), u"overdue"_s);
        QCOMPARE(TodoBlock::dueState(u"2026-12-20"_s, u"2026-11-25"_s), QString());
        QCOMPARE(TodoBlock::dateLabel(u"2026-11-25"_s, u"2026-11-25"_s), u"Today"_s);
        QCOMPARE(TodoBlock::dateLabel(u"2026-11-26"_s, u"2026-11-25"_s), u"Tomorrow"_s);
        QCOMPARE(TodoBlock::dateLabel(u"2026-11-24"_s, u"2026-11-25"_s), u"Yesterday"_s);
        QCOMPARE(TodoBlock::addDays(u"2026-12-31"_s, 1), u"2027-01-01"_s);
        QCOMPARE(TodoBlock::addDays(u"2026-03-01"_s, -1), u"2026-02-28"_s);
    }

    void editTextAndRemove()
    {
        const QString body = u"<!-- marknote-todo -->\n- [ ] A 📅 2026-12-01\n  note\n- [ ] B"_s;
        TodoBlock::Op text;
        text.type = TodoBlock::Op::Text;
        text.line = 1;
        text.text = u"Renamed"_s;
        QCOMPARE(*TodoBlock::apply(body, text), u"<!-- marknote-todo -->\n- [ ] Renamed 📅 2026-12-01\n  note\n- [ ] B"_s);

        // A date typed into the text becomes the due date.
        text.line = 3;
        text.text = u"B 📅 2026-12-05"_s;
        QCOMPARE(*TodoBlock::apply(body, text), u"<!-- marknote-todo -->\n- [ ] A 📅 2026-12-01\n  note\n- [ ] B 📅 2026-12-05"_s);

        TodoBlock::Op remove;
        remove.type = TodoBlock::Op::Remove;
        remove.line = 2; // a note line removes its item
        QCOMPARE(*TodoBlock::apply(body, remove), u"<!-- marknote-todo -->\n- [ ] B"_s);
    }

    void uncheckingLastDoneDropsTheSection()
    {
        const QString body = u"<!-- marknote-todo -->\n\n<details>\n<summary>Done (1)</summary>\n\n- [x] A ✅ 2026-11-25\n\n</details>"_s;
        QCOMPARE(TodoBlock::toggleLine(body, 5, false, u"2026-11-26"_s), u"<!-- marknote-todo -->\n- [ ] A"_s);
    }

    void helperParses()
    {
        TodoHelper helper;
        const auto data = helper.parse(u"<!-- marknote-todo sort=due -->\n- [ ] A 📅 2026-12-01\n\n<details>\n<summary>Done (1)</summary>\n\n- [x] B ✅ 2026-11-25\n\n</details>"_s);
        QCOMPARE(data[u"sort"_s].toString(), u"due"_s);
        const auto open = data[u"open"_s].toList();
        QCOMPARE(open.size(), 1);
        QCOMPARE(open.first().toMap()[u"due"_s].toString(), u"2026-12-01"_s);
        QCOMPARE(open.first().toMap()[u"line"_s].toInt(), 1);
        const auto done = data[u"done"_s].toList();
        QCOMPARE(done.first().toMap()[u"line"_s].toInt(), 6);
        QCOMPARE(helper.addItem(helper.newBlock(), u"New"_s), u"<!-- marknote-todo -->\n- [ ]\n- [ ] New"_s);
    }

    /// A note with to-do blocks is read into one Todo block each and written
    /// back unchanged.
    void roundTripKeepsBlocksVerbatim_data()
    {
        QTest::addColumn<QString>("markdown");
        QTest::addColumn<int>("todoBlocks");
        QTest::newRow("open and done") << u"# Trip\n\n<!-- marknote-todo -->\n- [ ] Book flights\n- [ ] Renew passport 📅 2026-12-01\n  Photo booth\n\n<details>\n<summary>Done (2)</summary>\n\n- [x] Pack charger ✅ 2026-11-25\n- [x] Buy adapter 📅 2026-11-20 ✅ 2026-11-24\n\n</details>\n\nAfter\n"_s << 1;
        QTest::newRow("only done, sorted") << u"<!-- marknote-todo sort=due -->\n\n<details>\n<summary>Done (1)</summary>\n\n- [x] A ✅ 2026-11-25\n\n</details>\n"_s << 1;
        QTest::newRow("two blocks") << u"<!-- marknote-todo -->\n- [ ] A\n\n## Work\n\n<!-- marknote-todo -->\n- [ ] W1\n- [ ] W2\n"_s << 2;
        QTest::newRow("empty item") << u"Intro\n\n<!-- marknote-todo -->\n- [ ]\n"_s << 1;
    }

    void roundTripKeepsBlocksVerbatim()
    {
        QFETCH(QString, markdown);
        QFETCH(int, todoBlocks);
        MDTreeModel model;
        const QString out = roundTrip(markdown, model);
        int count = 0;
        for (TreeItem *child : model.rootItem()->children()) {
            if (child->type() == MDOptions::ElementType::Todo) {
                ++count;
                QVERIFY(markdown.contains(child->data()[u"todo"_s].toString()));
            }
        }
        QCOMPARE(count, todoBlocks);
        QCOMPARE(out.trimmed(), markdown.trimmed());
    }

    void editingTheBlockChangesOnlyIt()
    {
        MDTreeModel model;
        const QString markdown = u"# Trip\n\n<!-- marknote-todo -->\n- [ ] Book flights\n- [ ] Pack charger\n\nAfter"_s;
        roundTrip(markdown, model);
        TreeItem *todo = findTodo(model);
        QVERIFY(todo);
        TodoHelper helper;
        model.setTodoMD(todo, helper.toggle(todo->todoMarkdown(), 2));
        const QString today = TodoBlock::localToday();
        QCOMPARE(model.toMarkdown().trimmed(),
                 u"# Trip\n\n<!-- marknote-todo -->\n- [ ] Book flights\n\n<details>\n<summary>Done (1)</summary>\n\n- [x] Pack charger ✅ %1\n\n</details>\n\nAfter"_s.arg(today));
    }

    void pastedBlockIsGrouped()
    {
        auto doc = QSharedPointer<MD::Document>::create();
        const auto items = TreeItem::fromMarkdown(TodoHelper().newBlock(), doc);
        QCOMPARE(items.size(), 1);
        QCOMPARE(items.first()->type(), MDOptions::ElementType::Todo);
        qDeleteAll(items);
    }

    void textRunningPastTheBlockIsNotGrouped()
    {
        // "After" belongs to the HTML block of </details> for the parser.
        MDTreeModel model;
        const QString markdown = u"<!-- marknote-todo -->\n- [ ] A\n\n<details>\n<summary>Done (1)</summary>\n\n- [x] B ✅ 2026-11-25\n\n</details>\nAfter"_s;
        roundTrip(markdown, model);
        QVERIFY(!findTodo(model));
    }
};

QTEST_GUILESS_MAIN(TodoTest)
#include "todotest.moc"
