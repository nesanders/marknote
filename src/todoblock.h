// SPDX-FileCopyrightText: 2026 Marknote fork contributors
// SPDX-License-Identifier: GPL-2.0-only OR GPL-3.0-only OR LicenseRef-KDE-Accepted-GPL

#pragma once

#include <QDate>
#include <QList>
#include <QObject>
#include <QString>
#include <QStringList>
#include <QVariantMap>
#include <QtQmlIntegration/qqmlintegration.h>

#include <optional>

/// To-do blocks: a checklist with its own collapsible Done section (see
/// docs/todo.md). Everything works on note bodies as plain text, by line
/// number. This is a port of web/src/todo.js; both are checked against the
/// same fixtures (src/autotests/data/todo.json) so they write identical text.
namespace TodoBlock
{
struct Item {
    QString indent;
    QString bullet = QStringLiteral("-");
    bool checked = false;
    QString text;
    QString due; ///< YYYY-MM-DD, or empty
    QString done; ///< YYYY-MM-DD, or empty
    QStringList extra; ///< indented lines that belong to the item
    int line = -1;
};

struct Options {
    QString sort = QStringLiteral("manual"); ///< "manual" or "due"
    QStringList rest; ///< unknown options, kept as written
};

struct Block {
    int start = 0; ///< marker line
    int end = 0; ///< one past the last line
    Options options;
    QList<Item> open;
    QList<Item> done;
    int doneStart = -1;
    bool detailsOpen = false; ///< written as <details open>
};

struct Location {
    Block block;
    QString list; ///< "open", "done", or empty when the line is not an item
    int index = -1;
};

struct Op {
    enum Type {
        Toggle,
        Due,
        Sort,
        Add,
        // Desktop extras (not in the shared fixtures): edit or drop an item.
        Text,
        Remove,
        // Shared: move an open item to another place in the open list.
        Move,
    };
    Type type = Toggle;
    int line = 0;
    std::optional<bool> checked; ///< Toggle: the new state; unset flips it
    QString date; ///< Due: YYYY-MM-DD, or a null string to clear it
    QString sort; ///< Sort: "manual" or "due"
    QString text; ///< Add / Text
    int to = 0; ///< Move: the item's index in the open list afterwards
};

/// The exact marker line written for a new block.
inline constexpr QStringView markerLine = u"<!-- marknote-todo -->";

/// Whether @p line is a to-do block marker.
bool isMarker(const QString &line);

/// Today as YYYY-MM-DD in local time.
QString localToday();
QString addDays(const QString &date, int days);

/// All to-do blocks in a body, lines [start, end).
QList<Block> findBlocks(const QString &body);
/// The block containing @p line, and where in it.
std::optional<Location> locate(const QString &body, int line);

QString itemLine(const Item &item);
QStringList serialize(const Block &block);

/// Applies one operation to the block holding op.line. Returns the new body,
/// or nothing when the line is not in a to-do block (or the operation is invalid).
std::optional<QString> apply(const QString &body, const Op &op, const QString &today = localToday());

/// Ticks or unticks a task line: the to-do block rules inside a block, a plain toggle elsewhere.
QString toggleLine(const QString &body, int line, bool checked, const QString &today = localToday());

/// Turns the checklist around @p line into a to-do block (ticked items go to
/// Done). Returns nothing when the line is not in a checklist or already in a block.
std::optional<QString> makeBlock(const QString &body, int line, const QString &today = localToday());

/// "overdue", "today" or empty.
QString dueState(const QString &due, const QString &today = localToday());
/// Short display label for a date: Today, Tomorrow, Yesterday, "Dec 1", "Dec 1, 2027".
QString dateLabel(const QString &date, const QString &today = localToday());
}

/// What the to-do block delegate needs from the core, for QML. Every edit
/// takes the block's markdown (the marker line first) and returns the new one.
class TodoHelper : public QObject
{
    Q_OBJECT
    QML_ELEMENT
    QML_SINGLETON

public:
    explicit TodoHelper(QObject *parent = nullptr);

    /// {sort, open: [{line, text, due, done, checked}], done: [...]}
    Q_INVOKABLE QVariantMap parse(const QString &markdown) const;

    Q_INVOKABLE QString toggle(const QString &markdown, int line) const;
    Q_INVOKABLE QString setDue(const QString &markdown, int line, const QString &date) const;
    Q_INVOKABLE QString setSort(const QString &markdown, const QString &sort) const;
    Q_INVOKABLE QString addItem(const QString &markdown, const QString &text) const;
    Q_INVOKABLE QString setText(const QString &markdown, int line, const QString &text) const;
    Q_INVOKABLE QString removeItem(const QString &markdown, int line) const;
    /// Moves the open item on `line` to position `to` (switches the block to manual order).
    Q_INVOKABLE QString moveItem(const QString &markdown, int line, int to) const;

    Q_INVOKABLE QString today() const;
    Q_INVOKABLE QString addDays(const QString &date, int days) const;
    Q_INVOKABLE QString dueState(const QString &due) const;
    Q_INVOKABLE QString dateLabel(const QString &date) const;
    /// A QDate for a YYYY-MM-DD string (invalid when empty), and back.
    Q_INVOKABLE QDate toDate(const QString &date) const;
    Q_INVOKABLE QString fromDate(const QDate &date) const;
    /// Markdown for a new block with one empty open item.
    Q_INVOKABLE QString newBlock() const;
};
