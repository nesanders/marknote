// SPDX-FileCopyrightText: 2026 Marknote fork contributors
// SPDX-License-Identifier: GPL-2.0-only OR GPL-3.0-only OR LicenseRef-KDE-Accepted-GPL

#include "vaultcrypto.h"

#include "notemetadata/frontmatter.h"

#include <KLocalizedString>

#include <QDateTime>
#include <QJsonDocument>
#include <QRegularExpression>

#include <sodium.h>

using namespace Qt::StringLiterals;

namespace VaultCrypto
{

namespace
{
constexpr auto KeyBytes = crypto_aead_xchacha20poly1305_ietf_KEYBYTES; // 32
constexpr auto NonceBytes = crypto_aead_xchacha20poly1305_ietf_NPUBBYTES; // 24
constexpr auto TagBytes = crypto_aead_xchacha20poly1305_ietf_ABYTES; // 16
constexpr auto SaltBytes = crypto_pwhash_SALTBYTES; // 16
const QByteArray PasswordAd = "marknote-vault-v1:password";
const QByteArray RecoveryAd = "marknote-vault-v1:recovery";
const QByteArray NoteAd = "marknote-note-v1";
const char Base32[] = "ABCDEFGHIJKLMNOPQRSTUVWXYZ234567";

QByteArray randomBytes(size_t n)
{
    QByteArray out(qsizetype(n), Qt::Uninitialized);
    randombytes_buf(out.data(), n);
    return out;
}

QByteArray seal(const QByteArray &plain, const QByteArray &key, const QByteArray &nonce, const QByteArray &ad)
{
    QByteArray out(plain.size() + qsizetype(TagBytes), Qt::Uninitialized);
    unsigned long long len = 0;
    crypto_aead_xchacha20poly1305_ietf_encrypt(reinterpret_cast<unsigned char *>(out.data()), &len, reinterpret_cast<const unsigned char *>(plain.constData()),
                                               plain.size(), reinterpret_cast<const unsigned char *>(ad.constData()), ad.size(), nullptr,
                                               reinterpret_cast<const unsigned char *>(nonce.constData()), reinterpret_cast<const unsigned char *>(key.constData()));
    out.resize(qsizetype(len));
    return out;
}

std::optional<QByteArray> open(const QByteArray &sealed, const QByteArray &key, const QByteArray &nonce, const QByteArray &ad)
{
    if (key.size() != qsizetype(KeyBytes) || nonce.size() != qsizetype(NonceBytes) || sealed.size() < qsizetype(TagBytes)) {
        return std::nullopt;
    }
    QByteArray out(sealed.size() - qsizetype(TagBytes), Qt::Uninitialized);
    unsigned long long len = 0;
    if (crypto_aead_xchacha20poly1305_ietf_decrypt(reinterpret_cast<unsigned char *>(out.data()), &len, nullptr,
                                                   reinterpret_cast<const unsigned char *>(sealed.constData()), sealed.size(),
                                                   reinterpret_cast<const unsigned char *>(ad.constData()), ad.size(),
                                                   reinterpret_cast<const unsigned char *>(nonce.constData()),
                                                   reinterpret_cast<const unsigned char *>(key.constData()))
        != 0) {
        sodium_memzero(out.data(), out.size());
        return std::nullopt;
    }
    out.resize(qsizetype(len));
    return out;
}

std::optional<Key> passwordKey(const QString &password, const QByteArray &salt, quint64 ops, quint64 mem)
{
    if (salt.size() != qsizetype(SaltBytes)) {
        return std::nullopt;
    }
    QByteArray pw = password.toUtf8();
    QByteArray out(qsizetype(KeyBytes), Qt::Uninitialized);
    const int rc = crypto_pwhash(reinterpret_cast<unsigned char *>(out.data()), KeyBytes, pw.constData(), pw.size(),
                                 reinterpret_cast<const unsigned char *>(salt.constData()), ops, size_t(mem), crypto_pwhash_ALG_ARGON2ID13);
    sodium_memzero(pw.data(), pw.size());
    if (rc != 0) {
        return std::nullopt;
    }
    return Key(out);
}

QByteArray b64(const QByteArray &bytes)
{
    return bytes.toBase64();
}

QByteArray unb64(const QJsonValue &value)
{
    return QByteArray::fromBase64(value.toString().toLatin1());
}

const QRegularExpression &blockRe()
{
    static const QRegularExpression re(u"^```marknote-encrypted[ \\t]*\\r?\\n([\\s\\S]*?)\\r?\\n```[ \\t]*$"_s, QRegularExpression::MultilineOption);
    return re;
}
} // namespace

bool init()
{
    static const bool ok = sodium_init() >= 0;
    return ok;
}

Key::Key(QByteArray bytes)
    : m_bytes(std::move(bytes))
{
}

Key::Key(const Key &other)
    : m_bytes(other.m_bytes)
{
    m_bytes.detach();
}

Key &Key::operator=(const Key &other)
{
    if (this != &other) {
        wipe();
        m_bytes = other.m_bytes;
        m_bytes.detach();
    }
    return *this;
}

Key::~Key()
{
    wipe();
}

bool Key::isValid() const
{
    return m_bytes.size() == qsizetype(KeyBytes);
}

const QByteArray &Key::bytes() const
{
    return m_bytes;
}

void Key::wipe()
{
    if (!m_bytes.isEmpty() && m_bytes.isDetached()) {
        sodium_memzero(m_bytes.data(), m_bytes.size());
    }
    m_bytes.clear();
}

std::optional<Vault> Vault::fromJson(const QByteArray &json, QString *error)
{
    const QJsonObject o = QJsonDocument::fromJson(json).object();
    if (o.value(u"format"_s).toString() != u"marknote-vault"_s) {
        if (error) {
            *error = i18n("This is not a Marknote vault file.");
        }
        return std::nullopt;
    }
    if (o.value(u"version"_s).toInt() != 1) {
        if (error) {
            *error = i18n("This notebook was encrypted by a newer version of Marknote.");
        }
        return std::nullopt;
    }
    Vault v;
    const QJsonObject kdf = o.value(u"kdf"_s).toObject();
    if (kdf.value(u"alg"_s).toString() != u"argon2id13"_s) {
        if (error) {
            *error = i18n("Unsupported key derivation in the vault file.");
        }
        return std::nullopt;
    }
    v.opslimit = quint64(kdf.value(u"opslimit"_s).toDouble(3));
    v.memlimit = quint64(kdf.value(u"memlimit"_s).toDouble(64.0 * 1024 * 1024));
    v.salt = unb64(kdf.value(u"salt"_s));
    const QJsonObject pw = o.value(u"password"_s).toObject();
    const QJsonObject rec = o.value(u"recovery"_s).toObject();
    v.passwordNonce = unb64(pw.value(u"nonce"_s));
    v.passwordKey = unb64(pw.value(u"key"_s));
    v.recoveryNonce = unb64(rec.value(u"nonce"_s));
    v.recoveryKey = unb64(rec.value(u"key"_s));
    v.created = o.value(u"created"_s).toString();
    for (auto it = o.begin(); it != o.end(); ++it) {
        static const QStringList known = {u"format"_s, u"version"_s, u"created"_s, u"kdf"_s, u"password"_s, u"recovery"_s};
        if (!known.contains(it.key())) {
            v.extra.insert(it.key(), it.value());
        }
    }
    if (v.salt.size() != qsizetype(SaltBytes) || v.passwordNonce.size() != qsizetype(NonceBytes)) {
        if (error) {
            *error = i18n("The vault file is damaged.");
        }
        return std::nullopt;
    }
    return v;
}

QByteArray Vault::toJson() const
{
    QJsonObject o = extra;
    o[u"format"_s] = u"marknote-vault"_s;
    o[u"version"_s] = 1;
    o[u"created"_s] = created;
    o[u"kdf"_s] = QJsonObject{
        {u"alg"_s, u"argon2id13"_s},
        {u"opslimit"_s, double(opslimit)},
        {u"memlimit"_s, double(memlimit)},
        {u"salt"_s, QString::fromLatin1(b64(salt))},
    };
    o[u"password"_s] = QJsonObject{{u"nonce"_s, QString::fromLatin1(b64(passwordNonce))}, {u"key"_s, QString::fromLatin1(b64(passwordKey))}};
    o[u"recovery"_s] = QJsonObject{{u"nonce"_s, QString::fromLatin1(b64(recoveryNonce))}, {u"key"_s, QString::fromLatin1(b64(recoveryKey))}};
    return QJsonDocument(o).toJson(QJsonDocument::Indented);
}

QString encodeRecoveryKey(const QByteArray &bytes)
{
    QString out;
    int buffer = 0;
    int bits = 0;
    for (const char c : bytes) {
        buffer = (buffer << 8) | (static_cast<unsigned char>(c));
        bits += 8;
        while (bits >= 5) {
            out += QLatin1Char(Base32[(buffer >> (bits - 5)) & 31]);
            bits -= 5;
        }
    }
    if (bits > 0) {
        out += QLatin1Char(Base32[(buffer << (5 - bits)) & 31]);
    }
    QString grouped;
    for (qsizetype i = 0; i < out.size(); i += 4) {
        if (!grouped.isEmpty()) {
            grouped += u'-';
        }
        grouped += out.mid(i, 4);
    }
    return grouped;
}

std::optional<QByteArray> decodeRecoveryKey(const QString &text)
{
    QString s = text.toUpper();
    s.remove(QRegularExpression(u"[\\s-]"_s));
    s.replace(u'0', u'O').replace(u'1', u'I').replace(u'8', u'B');
    if (s.size() != 52) {
        return std::nullopt;
    }
    QByteArray out;
    int buffer = 0;
    int bits = 0;
    for (const QChar c : s) {
        const char *p = strchr(Base32, c.toLatin1());
        if (!p || c.unicode() > 127 || c.isNull()) {
            return std::nullopt;
        }
        buffer = (buffer << 5) | int(p - Base32);
        bits += 5;
        if (bits >= 8) {
            out.append(char((buffer >> (bits - 8)) & 0xff));
            bits -= 8;
        }
    }
    if (out.size() != 32) {
        return std::nullopt;
    }
    return out;
}

std::optional<Created> createVault(const QString &password, QString *error)
{
    if (!init()) {
        if (error) {
            *error = i18n("Encryption is not available (libsodium could not start).");
        }
        return std::nullopt;
    }
    Created c;
    Vault &v = c.vault;
    v.salt = randomBytes(SaltBytes);
    v.created = QDateTime::currentDateTimeUtc().toString(Qt::ISODate);
    const auto pwKey = passwordKey(password, v.salt, v.opslimit, v.memlimit);
    if (!pwKey) {
        if (error) {
            *error = i18n("Not enough memory to protect the password.");
        }
        return std::nullopt;
    }
    c.notebookKey = Key(randomBytes(KeyBytes));
    const QByteArray recovery = randomBytes(KeyBytes);
    v.passwordNonce = randomBytes(NonceBytes);
    v.passwordKey = seal(c.notebookKey.bytes(), pwKey->bytes(), v.passwordNonce, PasswordAd);
    v.recoveryNonce = randomBytes(NonceBytes);
    v.recoveryKey = seal(c.notebookKey.bytes(), recovery, v.recoveryNonce, RecoveryAd);
    c.recoveryKey = encodeRecoveryKey(recovery);
    return c;
}

std::optional<Key> unlockWithPassword(const Vault &vault, const QString &password)
{
    if (!init()) {
        return std::nullopt;
    }
    const auto pwKey = passwordKey(password, vault.salt, vault.opslimit, vault.memlimit);
    if (!pwKey) {
        return std::nullopt;
    }
    auto key = open(vault.passwordKey, pwKey->bytes(), vault.passwordNonce, PasswordAd);
    return key && key->size() == qsizetype(KeyBytes) ? std::optional<Key>(Key(*key)) : std::nullopt;
}

std::optional<Key> unlockWithRecoveryKey(const Vault &vault, const QString &recoveryKey)
{
    if (!init()) {
        return std::nullopt;
    }
    const auto raw = decodeRecoveryKey(recoveryKey);
    if (!raw) {
        return std::nullopt;
    }
    auto key = open(vault.recoveryKey, *raw, vault.recoveryNonce, RecoveryAd);
    return key && key->size() == qsizetype(KeyBytes) ? std::optional<Key>(Key(*key)) : std::nullopt;
}

std::optional<Vault> changePassword(const Vault &vault, const Key &notebookKey, const QString &newPassword)
{
    if (!init() || !notebookKey.isValid()) {
        return std::nullopt;
    }
    Vault v = vault;
    v.salt = randomBytes(SaltBytes);
    const auto pwKey = passwordKey(newPassword, v.salt, v.opslimit, v.memlimit);
    if (!pwKey) {
        return std::nullopt;
    }
    v.passwordNonce = randomBytes(NonceBytes);
    v.passwordKey = seal(notebookKey.bytes(), pwKey->bytes(), v.passwordNonce, PasswordAd);
    return v;
}

bool isEncryptedNote(const QString &text)
{
    const auto split = FrontMatter::split(text);
    return split.present && FrontMatter::value(split.raw, u"marknote-encrypted"_s).toString() == u"1"_s;
}

QString envelopeTitle(const QString &text)
{
    const auto split = FrontMatter::split(text);
    return split.present ? FrontMatter::value(split.raw, u"title"_s).toString() : QString();
}

QString encryptNote(const QString &plaintext, const Key &key, const QString &title)
{
    init();
    const QByteArray nonce = randomBytes(NonceBytes);
    const QByteArray sealed = seal(plaintext.toUtf8(), key.bytes(), nonce, NoteAd);
    const QByteArray data = QByteArray(nonce + sealed).toBase64();
    QString block;
    for (qsizetype i = 0; i < data.size(); i += 76) {
        block += QString::fromLatin1(data.mid(i, 76)) + u'\n';
    }
    QString raw = u"marknote-encrypted: 1"_s;
    if (!title.isEmpty()) {
        raw = FrontMatter::setValue(raw, u"title"_s, title);
    }
    const QString body = i18n("This note is encrypted. Open its notebook in Marknote to read it.") + u"\n\n```marknote-encrypted\nv1\n"_s + block + u"```\n"_s;
    return FrontMatter::join(raw, body);
}

std::optional<QString> decryptNote(const QString &envelope, const Key &key, QString *error)
{
    init();
    const auto m = blockRe().match(envelope);
    if (!m.hasMatch()) {
        if (error) {
            *error = i18n("The encrypted note is damaged.");
        }
        return std::nullopt;
    }
    QString content = m.captured(1);
    const qsizetype firstNewline = content.indexOf(u'\n');
    const QString version = (firstNewline < 0 ? content : content.left(firstNewline)).trimmed();
    if (version != u"v1"_s) {
        if (error) {
            *error = i18n("This note was encrypted by a newer version of Marknote.");
        }
        return std::nullopt;
    }
    content = firstNewline < 0 ? QString() : content.mid(firstNewline + 1);
    content.remove(QRegularExpression(u"\\s"_s));
    const QByteArray data = QByteArray::fromBase64(content.toLatin1());
    if (data.size() < qsizetype(NonceBytes + TagBytes)) {
        if (error) {
            *error = i18n("The encrypted note is damaged.");
        }
        return std::nullopt;
    }
    auto plain = open(data.mid(NonceBytes), key.bytes(), data.left(NonceBytes), NoteAd);
    if (!plain) {
        if (error) {
            *error = i18n("This note could not be decrypted with the notebook's key.");
        }
        return std::nullopt;
    }
    QString text = QString::fromUtf8(*plain);
    sodium_memzero(plain->data(), plain->size());
    return text;
}

} // namespace VaultCrypto
