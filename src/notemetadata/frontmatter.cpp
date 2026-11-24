// SPDX-FileCopyrightText: 2026 Marknote fork contributors
// SPDX-License-Identifier: GPL-2.0-only OR GPL-3.0-only OR LicenseRef-KDE-Accepted-GPL

#include "frontmatter.h"

#include <QFile>
#include <QFileInfo>
#include <QRandomGenerator>
#include <QRegularExpression>

using namespace Qt::StringLiterals;

namespace
{

bool isDelimiter(QStringView line, bool closing)
{
    const QStringView t = line.trimmed();
    return t == u"---" || (closing && t == u"...");
}

const QRegularExpression &keyLineRe()
{
    static const QRegularExpression re(u"^([A-Za-z0-9_][A-Za-z0-9_.-]*)[ \\t]*:(.*)$"_s);
    return re;
}

bool isContinuation(const QString &line)
{
    if (line.isEmpty()) {
        return false;
    }
    return line.at(0).isSpace() || line.startsWith(u"- "_s) || line == u"-"_s;
}

QString unquote(QString s)
{
    s = s.trimmed();
    if (s.size() >= 2 && s.startsWith(u'"') && s.endsWith(u'"')) {
        QString out;
        const QStringView inner = QStringView(s).mid(1, s.size() - 2);
        for (qsizetype i = 0; i < inner.size(); ++i) {
            const QChar c = inner.at(i);
            if (c == u'\\' && i + 1 < inner.size()) {
                const QChar n = inner.at(++i);
                switch (n.unicode()) {
                case 'n':
                    out += u'\n';
                    break;
                case 't':
                    out += u'\t';
                    break;
                default:
                    out += n;
                }
            } else {
                out += c;
            }
        }
        return out;
    }
    if (s.size() >= 2 && s.startsWith(u'\'') && s.endsWith(u'\'')) {
        return s.mid(1, s.size() - 2).replace(u"''"_s, u"'"_s);
    }
    // Plain scalar: drop a trailing " # comment".
    const qsizetype hash = s.indexOf(u" #"_s);
    if (hash >= 0) {
        s.truncate(hash);
    }
    return s.trimmed();
}

QStringList splitFlowList(const QString &inner)
{
    QStringList items;
    QString current;
    QChar quote;
    bool escaped = false;
    for (const QChar c : inner) {
        if (!quote.isNull()) {
            current += c;
            if (escaped) {
                escaped = false;
            } else if (quote == u'"' && c == u'\\') {
                escaped = true;
            } else if (c == quote) {
                quote = QChar();
            }
        } else if (c == u'"' || c == u'\'') {
            quote = c;
            current += c;
        } else if (c == u',') {
            items << unquote(current);
            current.clear();
        } else {
            current += c;
        }
    }
    if (!current.trimmed().isEmpty()) {
        items << unquote(current);
    }
    items.removeAll(QString());
    return items;
}

bool needsQuotes(const QString &s)
{
    if (s.isEmpty() || s != s.trimmed()) {
        return true;
    }
    static const QRegularExpression special(u"[:#\\[\\]{},&*!|>'\"%@`]"_s);
    if (s.contains(special) || s.startsWith(u'-') || s.startsWith(u'?')) {
        return true;
    }
    static const QStringList reserved = {u"true"_s, u"false"_s, u"yes"_s, u"no"_s, u"null"_s, u"~"_s, u"on"_s, u"off"_s};
    if (reserved.contains(s.toLower())) {
        return true;
    }
    bool isNumber = false;
    s.toDouble(&isNumber);
    if (isNumber) {
        return true;
    }
    for (const QChar c : s) {
        if (c.unicode() > 0x7f) {
            return true; // quote emoji and other non-ASCII to be safe with strict parsers
        }
    }
    return false;
}

QString quoted(const QString &s)
{
    if (!needsQuotes(s)) {
        return s;
    }
    QString escaped = s;
    escaped.replace(u"\\"_s, u"\\\\"_s).replace(u"\""_s, u"\\\""_s).replace(u"\n"_s, u"\\n"_s);
    return u'"' + escaped + u'"';
}

QString serialize(const QVariant &value)
{
    if (value.metaType().id() == QMetaType::QStringList || value.metaType().id() == QMetaType::QVariantList) {
        QStringList parts;
        for (const QString &item : value.toStringList()) {
            parts << quoted(item);
        }
        return u'[' + parts.join(u", "_s) + u']';
    }
    if (value.metaType().id() == QMetaType::QDateTime) {
        return value.toDateTime().toString(Qt::ISODate);
    }
    return quoted(value.toString());
}

bool isEmptyValue(const QVariant &value)
{
    if (!value.isValid() || value.isNull()) {
        return true;
    }
    if (value.metaType().id() == QMetaType::QStringList || value.metaType().id() == QMetaType::QVariantList) {
        return value.toStringList().isEmpty();
    }
    if (value.metaType().id() == QMetaType::QDateTime) {
        return !value.toDateTime().isValid();
    }
    return value.toString().isEmpty();
}

} // namespace

namespace FrontMatter
{

Split split(const QString &text)
{
    Split result;
    QString t = text;
    if (t.startsWith(QChar(0xFEFF))) {
        t.remove(0, 1);
    }

    const qsizetype firstEnd = t.indexOf(u'\n');
    if (firstEnd < 0 || !isDelimiter(QStringView(t).left(firstEnd), false)) {
        result.body = text;
        return result;
    }

    qsizetype pos = firstEnd + 1;
    QStringList rawLines;
    while (pos <= t.size()) {
        qsizetype end = t.indexOf(u'\n', pos);
        const bool last = end < 0;
        if (last) {
            end = t.size();
        }
        QString line = t.mid(pos, end - pos);
        if (line.endsWith(u'\r')) {
            line.chop(1);
        }
        if (isDelimiter(line, true)) {
            result.present = true;
            result.raw = rawLines.join(u'\n');
            QString body = last ? QString() : t.mid(end + 1);
            while (body.startsWith(u'\n') || body.startsWith(u"\r\n"_s)) {
                body.remove(0, body.startsWith(u'\n') ? 1 : 2);
            }
            result.body = body;
            return result;
        }
        rawLines << line;
        if (last) {
            break;
        }
        pos = end + 1;
    }

    // No closing delimiter: not front matter.
    result.body = text;
    return result;
}

QString join(const QString &raw, const QString &body)
{
    QString cleanBody = body;
    while (cleanBody.startsWith(u'\n')) {
        cleanBody.remove(0, 1);
    }
    if (raw.trimmed().isEmpty()) {
        return cleanBody;
    }
    QString out = u"---\n"_s + raw;
    if (!out.endsWith(u'\n')) {
        out += u'\n';
    }
    out += u"---\n"_s;
    if (!cleanBody.isEmpty()) {
        out += u'\n' + cleanBody;
    }
    return out;
}

QVariant value(const QString &raw, const QString &key)
{
    const QStringList lines = raw.split(u'\n');
    for (int i = 0; i < lines.size(); ++i) {
        const auto m = keyLineRe().match(lines.at(i));
        if (!m.hasMatch() || m.captured(1) != key) {
            continue;
        }
        const QString rest = m.captured(2).trimmed();
        if (rest.isEmpty()) {
            QStringList items;
            for (int j = i + 1; j < lines.size() && isContinuation(lines.at(j)); ++j) {
                const QString item = lines.at(j).trimmed();
                if (item.startsWith(u'-')) {
                    const QString v = unquote(item.mid(1));
                    if (!v.isEmpty()) {
                        items << v;
                    }
                }
            }
            return items.isEmpty() ? QVariant() : QVariant(items);
        }
        if (rest.startsWith(u'[')) {
            QString inner = rest.mid(1);
            const qsizetype close = inner.lastIndexOf(u']');
            if (close >= 0) {
                inner.truncate(close);
            }
            return splitFlowList(inner);
        }
        return unquote(rest);
    }
    return {};
}

Meta parse(const QString &raw)
{
    Meta meta;
    meta.id = value(raw, u"id"_s).toString();
    meta.icon = value(raw, u"icon"_s).toString();
    meta.title = value(raw, u"title"_s).toString();

    const QVariant tags = value(raw, u"tags"_s);
    if (tags.metaType().id() == QMetaType::QStringList) {
        meta.tags = tags.toStringList();
    } else if (!tags.toString().isEmpty()) {
        // Obsidian also accepts a single space/comma separated string.
        meta.tags = tags.toString().split(QRegularExpression(u"[,\\s]+"_s), Qt::SkipEmptyParts);
    }
    for (QString &tag : meta.tags) {
        if (tag.startsWith(u'#')) {
            tag.remove(0, 1);
        }
    }
    meta.tags.removeAll(QString());
    meta.tags.removeDuplicates();

    const QString created = value(raw, u"created"_s).toString();
    if (!created.isEmpty()) {
        meta.created = QDateTime::fromString(created, Qt::ISODate);
        if (!meta.created.isValid()) {
            meta.created = QDateTime(QDate::fromString(created, Qt::ISODate), QTime(0, 0));
        }
    }
    return meta;
}

QString setValue(const QString &raw, const QString &key, const QVariant &newValue)
{
    QStringList lines = raw.isEmpty() ? QStringList() : raw.split(u'\n');
    const bool remove = isEmptyValue(newValue);
    const QString newLine = key + u": "_s + serialize(newValue);

    for (int i = 0; i < lines.size(); ++i) {
        const auto m = keyLineRe().match(lines.at(i));
        if (!m.hasMatch() || m.captured(1) != key) {
            continue;
        }
        int end = i + 1;
        while (end < lines.size() && isContinuation(lines.at(end))) {
            ++end;
        }
        lines.remove(i, end - i);
        if (!remove) {
            lines.insert(i, newLine);
        }
        return lines.join(u'\n');
    }

    if (!remove) {
        while (!lines.isEmpty() && lines.constLast().trimmed().isEmpty()) {
            lines.removeLast();
        }
        lines << newLine;
    }
    return lines.join(u'\n');
}

QString readRawFromFile(const QString &filePath, bool *present)
{
    if (present) {
        *present = false;
    }
    QFile file(filePath);
    if (!file.open(QFile::ReadOnly)) {
        return {};
    }
    QByteArray first = file.readLine(1024);
    if (first.startsWith("\xEF\xBB\xBF")) {
        first.remove(0, 3);
    }
    if (!isDelimiter(QString::fromUtf8(first), false)) {
        return {};
    }
    QStringList rawLines;
    // Front matter is small; cap the scan so a stray "---" at the top of a big file stays cheap.
    for (int i = 0; i < 1000 && !file.atEnd(); ++i) {
        QString line = QString::fromUtf8(file.readLine());
        while (line.endsWith(u'\n') || line.endsWith(u'\r')) {
            line.chop(1);
        }
        if (isDelimiter(line, true)) {
            if (present) {
                *present = true;
            }
            return rawLines.join(u'\n');
        }
        rawLines << line;
    }
    return {};
}

QString newId()
{
    static const char alphabet[] = "0123456789ABCDEFGHJKMNPQRSTVWXYZ";
    quint64 ms = static_cast<quint64>(QDateTime::currentMSecsSinceEpoch());
    QString id(26, u'0');
    for (int i = 9; i >= 0; --i) {
        id[i] = QLatin1Char(alphabet[ms & 31]);
        ms >>= 5;
    }
    auto *rng = QRandomGenerator::system();
    for (int i = 10; i < 26; ++i) {
        id[i] = QLatin1Char(alphabet[rng->bounded(32)]);
    }
    return id;
}

QDateTime fileCreationTime(const QString &filePath)
{
    const QFileInfo info(filePath);
    const QDateTime birth = info.birthTime();
    return birth.isValid() ? birth : info.lastModified();
}

QString initialRaw(const QDateTime &created)
{
    QString raw = setValue(QString(), u"id"_s, newId());
    QDateTime local = created.toLocalTime();
    local.setTime(QTime(local.time().hour(), local.time().minute(), local.time().second()));
    raw = setValue(raw, u"created"_s, QVariant(local));
    return raw;
}

} // namespace FrontMatter
