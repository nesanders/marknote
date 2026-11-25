// SPDX-FileCopyrightText: 2026 Marknote fork contributors
// SPDX-License-Identifier: GPL-2.0-only OR GPL-3.0-only OR LicenseRef-KDE-Accepted-GPL

#include "todoblock.h"

#include <KLocalizedString>
#include <QLocale>
#include <QRegularExpression>

#include <algorithm>

using namespace Qt::StringLiterals;

namespace TodoBlock
{
namespace
{
const QRegularExpression &markerRe()
{
    static const QRegularExpression re(u"^<!--\\s*marknote-todo\\b(.*?)-->\\s*$"_s);
    return re;
}

const QRegularExpression &itemRe()
{
    static const QRegularExpression re(u"^( {0,3})([-*+])\\s+\\[([ xX])\\](?:[ \\t]+(.*))?$"_s);
    return re;
}

const QRegularExpression &dueRe()
{
    static const QRegularExpression re(u"\\s*📅\\s*(\\d{4}-\\d{2}-\\d{2})"_s);
    return re;
}

const QRegularExpression &doneRe()
{
    static const QRegularExpression re(u"\\s*✅\\s*(\\d{4}-\\d{2}-\\d{2})"_s);
    return re;
}

const QRegularExpression &dateRe()
{
    static const QRegularExpression re(u"^\\d{4}-\\d{2}-\\d{2}$"_s);
    return re;
}

bool matches(const QRegularExpression &re, const QString &text)
{
    return re.match(text).hasMatch();
}

QString trimEnd(const QString &text)
{
    qsizetype n = text.size();
    while (n > 0 && text.at(n - 1).isSpace()) {
        --n;
    }
    return text.left(n);
}

Options parseOptions(const QString &text)
{
    static const QRegularExpression sortRe(u"^sort=(manual|due)$"_s);
    Options options;
    const QStringList words = text.trimmed().split(QRegularExpression(u"\\s+"_s), Qt::SkipEmptyParts);
    for (const QString &word : words) {
        const auto m = sortRe.match(word);
        if (m.hasMatch()) {
            options.sort = m.captured(1);
        } else {
            options.rest << word;
        }
    }
    return options;
}

/// Removes every match of @p re from @p text; returns the date of the last one.
QString takeDate(const QRegularExpression &re, QString &text)
{
    QString date;
    for (auto hit = re.match(text); hit.hasMatch(); hit = re.match(text)) {
        date = hit.captured(1);
        text.remove(hit.capturedStart(), hit.capturedLength());
    }
    return date;
}

std::optional<Item> parseItem(const QString &line, int lineNo)
{
    const auto m = itemRe().match(line);
    if (!m.hasMatch()) {
        return std::nullopt;
    }
    Item item;
    item.indent = m.captured(1);
    item.bullet = m.captured(2);
    item.checked = m.captured(3) != u" "_s;
    QString text = m.captured(4);
    item.due = takeDate(dueRe(), text);
    item.done = takeDate(doneRe(), text);
    item.text = trimEnd(text);
    item.line = lineNo;
    return item;
}

/// Reads the item list starting at line i; returns the next line.
int readItems(const QStringList &lines, int i, QList<Item> &items)
{
    static const QRegularExpression indentedRe(u"^\\s+\\S"_s);
    static const QRegularExpression detailsRe(u"^\\s*</?details>"_s, QRegularExpression::CaseInsensitiveOption);
    while (i < lines.size()) {
        if (auto item = parseItem(lines[i], i)) {
            items << *item;
            ++i;
            continue;
        }
        // Indented, non-blank lines belong to the item above (notes, sub-items).
        if (!items.isEmpty() && matches(indentedRe, lines[i]) && !matches(detailsRe, lines[i])) {
            items.last().extra << lines[i];
            ++i;
            continue;
        }
        break;
    }
    return i;
}

int skipBlank(const QStringList &lines, int i)
{
    while (i < lines.size() && lines[i].trimmed().isEmpty()) {
        ++i;
    }
    return i;
}

/// The block whose marker is on line @p start.
std::optional<Block> parseBlockAt(const QStringList &lines, int start)
{
    static const QRegularExpression detailsRe(u"^\\s*<details(\\s+open)?\\s*>\\s*$"_s, QRegularExpression::CaseInsensitiveOption);
    static const QRegularExpression summaryRe(u"^\\s*<summary>.*</summary>\\s*$"_s, QRegularExpression::CaseInsensitiveOption);
    static const QRegularExpression closeRe(u"^\\s*</details>\\s*$"_s, QRegularExpression::CaseInsensitiveOption);

    const auto m = markerRe().match(lines[start]);
    if (!m.hasMatch()) {
        return std::nullopt;
    }
    Block block;
    block.start = start;
    block.end = start + 1;
    block.options = parseOptions(m.captured(1));
    int i = skipBlank(lines, start + 1);
    if (i < lines.size() && matches(itemRe(), lines[i])) {
        i = readItems(lines, i, block.open);
        block.end = i;
    }
    // The Done section: <details>, <summary>, done items, </details>.
    int j = skipBlank(lines, i);
    if (j < lines.size() && matches(detailsRe, lines[j])) {
        const int detailsLine = j;
        j = skipBlank(lines, j + 1);
        if (j < lines.size() && matches(summaryRe, lines[j])) {
            j = skipBlank(lines, j + 1);
            QList<Item> done;
            if (j < lines.size() && matches(itemRe(), lines[j])) {
                j = readItems(lines, j, done);
            }
            j = skipBlank(lines, j);
            if (j < lines.size() && matches(closeRe, lines[j])) {
                block.done = done;
                block.doneStart = detailsLine;
                block.end = j + 1;
            }
        }
    }
    return block;
}

QList<Item> sortByDue(const QList<Item> &items)
{
    QList<Item> sorted = items;
    const QString undated = u"9999-99-99"_s;
    std::stable_sort(sorted.begin(), sorted.end(), [&](const Item &a, const Item &b) {
        return (a.due.isEmpty() ? undated : a.due) < (b.due.isEmpty() ? undated : b.due);
    });
    return sorted;
}

/// Moves misplaced items, applies the sort and fills in completion dates.
void normalise(Block &block, const QString &today)
{
    QList<Item> open;
    QList<Item> done;
    QList<Item> misplacedOpen;
    for (const Item &it : std::as_const(block.open)) {
        (it.checked ? done : open) << it;
    }
    for (const Item &it : std::as_const(block.done)) {
        if (it.checked) {
            done << it;
        } else {
            misplacedOpen << it;
        }
    }
    open << misplacedOpen;
    for (Item &it : open) {
        it.done.clear();
    }
    for (Item &it : done) {
        if (it.done.isEmpty()) {
            it.done = today;
        }
    }
    if (block.options.sort == u"due"_s) {
        open = sortByDue(open);
    }
    block.open = open;
    block.done = done;
}

QString replaceBlock(const QString &body, Block block, const QString &today)
{
    normalise(block, today);
    QStringList lines = body.split(u'\n');
    lines.remove(block.start, block.end - block.start);
    const QStringList replacement = serialize(block);
    for (int k = 0; k < replacement.size(); ++k) {
        lines.insert(block.start + k, replacement[k]);
    }
    return lines.join(u'\n');
}
}

bool isMarker(const QString &line)
{
    return matches(markerRe(), line);
}

QString localToday()
{
    return QDate::currentDate().toString(u"yyyy-MM-dd"_s);
}

QString addDays(const QString &date, int days)
{
    return QDate::fromString(date, u"yyyy-MM-dd"_s).addDays(days).toString(u"yyyy-MM-dd"_s);
}

QList<Block> findBlocks(const QString &body)
{
    static const QRegularExpression fenceRe(u"^\\s{0,3}(`{3,}|~{3,})"_s);
    const QStringList lines = body.split(u'\n');
    QList<Block> blocks;
    QChar fence;
    for (int i = 0; i < lines.size(); ++i) {
        const auto f = fenceRe.match(lines[i]);
        if (f.hasMatch()) {
            const QChar c = f.captured(1).at(0);
            if (fence.isNull()) {
                fence = c;
            } else if (c == fence) {
                fence = QChar();
            }
            continue;
        }
        if (!fence.isNull()) {
            continue;
        }
        if (auto block = parseBlockAt(lines, i)) {
            blocks << *block;
            i = block->end - 1;
        }
    }
    return blocks;
}

std::optional<Location> locate(const QString &body, int line)
{
    for (const Block &block : findBlocks(body)) {
        if (line < block.start || line >= block.end) {
            continue;
        }
        Location where{block, QString(), -1};
        for (const QString &list : {u"open"_s, u"done"_s}) {
            const QList<Item> &items = list == u"open"_s ? block.open : block.done;
            for (int k = 0; k < items.size(); ++k) {
                if (line >= items[k].line && line <= items[k].line + items[k].extra.size()) {
                    where.list = list;
                    where.index = k;
                    return where;
                }
            }
        }
        return where;
    }
    return std::nullopt;
}

QString itemLine(const Item &item)
{
    QStringList parts{u"%1%2 [%3]"_s.arg(item.indent, item.bullet, item.checked ? u"x"_s : u" "_s)};
    if (!item.text.isEmpty()) {
        parts << item.text;
    }
    if (!item.due.isEmpty()) {
        parts << u"📅 "_s + item.due;
    }
    if (!item.done.isEmpty()) {
        parts << u"✅ "_s + item.done;
    }
    return parts.join(u' ');
}

QStringList serialize(const Block &block)
{
    QStringList opts;
    if (block.options.sort == u"due"_s) {
        opts << u"sort=due"_s;
    }
    opts << block.options.rest;
    QStringList out{opts.isEmpty() ? markerLine.toString() : u"<!-- marknote-todo %1 -->"_s.arg(opts.join(u' '))};
    for (const Item &it : block.open) {
        out << itemLine(it) << it.extra;
    }
    if (!block.done.isEmpty()) {
        out << QString() << u"<details>"_s << u"<summary>Done (%1)</summary>"_s.arg(block.done.size()) << QString();
        for (const Item &it : block.done) {
            out << itemLine(it) << it.extra;
        }
        out << QString() << u"</details>"_s;
    }
    return out;
}

std::optional<QString> apply(const QString &body, const Op &op, const QString &today)
{
    auto where = locate(body, op.line);
    if (!where) {
        return std::nullopt;
    }
    Block &block = where->block;
    QList<Item> *list = where->list.isEmpty() ? nullptr : (where->list == u"open"_s ? &block.open : &block.done);
    const int index = where->index;

    switch (op.type) {
    case Op::Toggle: {
        if (!list) {
            return std::nullopt;
        }
        Item item = list->at(index);
        const bool checked = op.checked.value_or(!item.checked);
        if (checked == item.checked) {
            return body;
        }
        list->removeAt(index);
        item.checked = checked;
        if (checked) {
            item.done = today;
            block.done.prepend(item);
        } else {
            item.done.clear();
            block.open.append(item);
        }
        return replaceBlock(body, block, today);
    }
    case Op::Due:
        if (!list || (!op.date.isNull() && !matches(dateRe(), op.date))) {
            return std::nullopt;
        }
        (*list)[index].due = op.date;
        return replaceBlock(body, block, today);
    case Op::Sort:
        if (op.sort != u"manual"_s && op.sort != u"due"_s) {
            return std::nullopt;
        }
        block.options.sort = op.sort;
        return replaceBlock(body, block, today);
    case Op::Add: {
        Item item;
        item.text = op.text;
        block.open.append(item);
        return replaceBlock(body, block, today);
    }
    case Op::Text: {
        if (!list) {
            return std::nullopt;
        }
        Item &item = (*list)[index];
        // Parse the new text like a task line, so typed dates become dates.
        QString text = op.text;
        text.replace(u'\n', u' ');
        const auto parsed = parseItem(u"- [ ] "_s + text.trimmed(), -1);
        item.text = parsed ? parsed->text : QString();
        if (parsed && !parsed->due.isEmpty()) {
            item.due = parsed->due;
        }
        return replaceBlock(body, block, today);
    }
    case Op::Remove:
        if (!list) {
            return std::nullopt;
        }
        list->removeAt(index);
        return replaceBlock(body, block, today);
    }
    return std::nullopt;
}

QString toggleLine(const QString &body, int line, bool checked, const QString &today)
{
    Op op;
    op.type = Op::Toggle;
    op.line = line;
    op.checked = checked;
    if (auto moved = apply(body, op, today)) {
        return *moved;
    }
    QStringList lines = body.split(u'\n');
    if (line < 0 || line >= lines.size()) {
        return body;
    }
    static const QRegularExpression boxRe(u"^(\\s*(?:[-*+]|\\d+[.)])\\s+)\\[[ xX]\\]"_s);
    const auto m = boxRe.match(lines[line]);
    if (m.hasMatch()) {
        lines[line].replace(0, m.capturedLength(), m.captured(1) + (checked ? u"[x]"_s : u"[ ]"_s));
    }
    return lines.join(u'\n');
}

std::optional<QString> makeBlock(const QString &body, int line, const QString &today)
{
    if (locate(body, line)) {
        return std::nullopt;
    }
    QStringList lines = body.split(u'\n');
    if (line < 0 || line >= lines.size()) {
        return std::nullopt;
    }
    static const QRegularExpression indentedRe(u"^\\s+\\S"_s);
    const auto isTaskish = [](const QString &l) {
        return matches(itemRe(), l) || matches(indentedRe, l);
    };
    if (!isTaskish(lines[line])) {
        return std::nullopt;
    }
    int start = line;
    while (start > 0 && isTaskish(lines[start - 1])) {
        --start;
    }
    while (start < lines.size() && !matches(itemRe(), lines[start])) {
        ++start;
    }
    if (start > line && !matches(itemRe(), lines[line])) {
        return std::nullopt;
    }
    lines.insert(start, markerLine.toString());
    const QString withMarker = lines.join(u'\n');
    const auto block = parseBlockAt(withMarker.split(u'\n'), start);
    if (!block || block->open.isEmpty()) {
        return std::nullopt;
    }
    return replaceBlock(withMarker, *block, today);
}

QString dueState(const QString &due, const QString &today)
{
    if (due < today) {
        return u"overdue"_s;
    }
    if (due == today) {
        return u"today"_s;
    }
    return QString();
}

QString dateLabel(const QString &date, const QString &today)
{
    if (date == today) {
        return i18nc("@info due date", "Today");
    }
    if (date == addDays(today, 1)) {
        return i18nc("@info due date", "Tomorrow");
    }
    if (date == addDays(today, -1)) {
        return i18nc("@info due date", "Yesterday");
    }
    const QDate d = QDate::fromString(date, u"yyyy-MM-dd"_s);
    if (!d.isValid()) {
        return date;
    }
    const QLocale locale;
    if (d.year() == QStringView(today).left(4).toInt()) {
        return locale.toString(d, u"MMM d"_s);
    }
    return locale.toString(d, u"MMM d, yyyy"_s);
}
}

TodoHelper::TodoHelper(QObject *parent)
    : QObject(parent)
{
}

namespace
{
QVariantList itemsToVariant(const QList<TodoBlock::Item> &items)
{
    QVariantList list;
    for (const auto &it : items) {
        list << QVariantMap{
            {u"line"_s, it.line},
            {u"text"_s, it.text},
            {u"due"_s, it.due},
            {u"done"_s, it.done},
            {u"checked"_s, it.checked},
            {u"notes"_s, it.extra.join(u'\n')},
        };
    }
    return list;
}

QString orSame(const std::optional<QString> &result, const QString &markdown)
{
    return result ? *result : markdown;
}
}

QVariantMap TodoHelper::parse(const QString &markdown) const
{
    const auto blocks = TodoBlock::findBlocks(markdown);
    if (blocks.isEmpty() || blocks.first().start != 0) {
        return {{u"sort"_s, u"manual"_s}, {u"open"_s, QVariantList()}, {u"done"_s, QVariantList()}};
    }
    const auto &block = blocks.first();
    return {
        {u"sort"_s, block.options.sort},
        {u"open"_s, itemsToVariant(block.open)},
        {u"done"_s, itemsToVariant(block.done)},
    };
}

QString TodoHelper::toggle(const QString &markdown, int line) const
{
    TodoBlock::Op op;
    op.type = TodoBlock::Op::Toggle;
    op.line = line;
    return orSame(TodoBlock::apply(markdown, op), markdown);
}

QString TodoHelper::setDue(const QString &markdown, int line, const QString &date) const
{
    TodoBlock::Op op;
    op.type = TodoBlock::Op::Due;
    op.line = line;
    op.date = date.isEmpty() ? QString() : date;
    return orSame(TodoBlock::apply(markdown, op), markdown);
}

QString TodoHelper::setSort(const QString &markdown, const QString &sort) const
{
    TodoBlock::Op op;
    op.type = TodoBlock::Op::Sort;
    op.line = 0;
    op.sort = sort;
    return orSame(TodoBlock::apply(markdown, op), markdown);
}

QString TodoHelper::addItem(const QString &markdown, const QString &text) const
{
    TodoBlock::Op op;
    op.type = TodoBlock::Op::Add;
    op.line = 0;
    op.text = text.trimmed();
    return orSame(TodoBlock::apply(markdown, op), markdown);
}

QString TodoHelper::setText(const QString &markdown, int line, const QString &text) const
{
    TodoBlock::Op op;
    op.type = TodoBlock::Op::Text;
    op.line = line;
    op.text = text;
    return orSame(TodoBlock::apply(markdown, op), markdown);
}

QString TodoHelper::removeItem(const QString &markdown, int line) const
{
    TodoBlock::Op op;
    op.type = TodoBlock::Op::Remove;
    op.line = line;
    return orSame(TodoBlock::apply(markdown, op), markdown);
}

QString TodoHelper::today() const
{
    return TodoBlock::localToday();
}

QString TodoHelper::addDays(const QString &date, int days) const
{
    return TodoBlock::addDays(date, days);
}

QString TodoHelper::dueState(const QString &due) const
{
    return due.isEmpty() ? QString() : TodoBlock::dueState(due);
}

QString TodoHelper::dateLabel(const QString &date) const
{
    return date.isEmpty() ? QString() : TodoBlock::dateLabel(date);
}

QDate TodoHelper::toDate(const QString &date) const
{
    return QDate::fromString(date, u"yyyy-MM-dd"_s);
}

QString TodoHelper::fromDate(const QDate &date) const
{
    return date.isValid() ? date.toString(u"yyyy-MM-dd"_s) : QString();
}

QString TodoHelper::newBlock() const
{
    return TodoBlock::markerLine.toString() + u"\n- [ ]"_s;
}
