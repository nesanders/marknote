// SPDX-FileCopyrightText: 2026 Marknote fork contributors
// SPDX-License-Identifier: GPL-2.0-only OR GPL-3.0-only OR LicenseRef-KDE-Accepted-GPL

#include "vaults.h"

#include "notemetadata/notemetadata.h"

#include <marknotesettings.h>

#include <KLocalizedString>

#include <QDateTime>
#include <QDir>
#include <QDirIterator>
#include <QFile>
#include <QFileInfo>
#include <QPointer>
#include <QSaveFile>

using namespace Qt::StringLiterals;

namespace
{
QPointer<Vaults> s_instance;

bool readFile(const QString &path, QString *text, QString *error)
{
    QFile f(path);
    if (!f.open(QFile::ReadOnly)) {
        if (error) {
            *error = f.errorString();
        }
        return false;
    }
    *text = QString::fromUtf8(f.readAll());
    return true;
}

bool writeFile(const QString &path, const QByteArray &data, QString *error)
{
    QDir().mkpath(QFileInfo(path).absolutePath());
    QSaveFile f(path);
    if (!f.open(QFile::WriteOnly)) {
        if (error) {
            *error = f.errorString();
        }
        return false;
    }
    f.write(data);
    if (!f.commit()) {
        if (error) {
            *error = f.errorString();
        }
        return false;
    }
    return true;
}
} // namespace

Vaults::Vaults(QObject *parent)
    : QObject(parent)
{
    VaultCrypto::init();
    m_autoLock.setInterval(30 * 1000);
    connect(&m_autoLock, &QTimer::timeout, this, &Vaults::checkAutoLock);
    m_autoLock.start();
}

Vaults *Vaults::instance()
{
    if (!s_instance) {
        s_instance = new Vaults(qApp);
    }
    return s_instance;
}

Vaults *Vaults::create(QQmlEngine *, QJSEngine *)
{
    auto *v = instance();
    QJSEngine::setObjectOwnership(v, QJSEngine::CppOwnership);
    return v;
}

QString Vaults::clean(const QString &path)
{
    QString p = path.startsWith(u"file:"_s) ? QUrl(path).toLocalFile() : path;
    return QDir::cleanPath(p);
}

QString Vaults::vaultFile(const QString &notebook)
{
    return clean(notebook) + u"/.marknote/vault.json"_s;
}

QString Vaults::notebookOf(const QString &path)
{
    QString dir = clean(path);
    if (QFileInfo(dir).isFile() || dir.endsWith(u".md"_s)) {
        dir = QFileInfo(dir).absolutePath();
    }
    for (int depth = 0; depth < 64 && !dir.isEmpty() && dir != u"/"_s; ++depth) {
        if (QFileInfo::exists(vaultFile(dir))) {
            return dir;
        }
        const QString parent = QFileInfo(dir).absolutePath();
        if (parent == dir) {
            break;
        }
        dir = parent;
    }
    return {};
}

bool Vaults::hasUnlocked() const
{
    QMutexLocker lock(&m_mutex);
    return !m_keys.isEmpty();
}

bool Vaults::isEncrypted(const QString &notebookOrNote) const
{
    return !notebookOf(notebookOrNote).isEmpty();
}

bool Vaults::isUnlocked(const QString &notebookOrNote) const
{
    const QString nb = notebookOf(notebookOrNote);
    QMutexLocker lock(&m_mutex);
    return !nb.isEmpty() && m_keys.contains(nb);
}

bool Vaults::isLocked(const QString &notebookOrNote) const
{
    return isEncrypted(notebookOrNote) && !isUnlocked(notebookOrNote);
}

QString Vaults::lastError() const
{
    return m_lastError;
}

int Vaults::revision() const
{
    return m_revision;
}

void Vaults::setError(const QString &error)
{
    m_lastError = error;
    Q_EMIT lastErrorChanged();
}

std::optional<VaultCrypto::Vault> Vaults::readVault(const QString &notebook)
{
    QFile f(vaultFile(notebook));
    if (!f.open(QFile::ReadOnly)) {
        setError(i18n("This notebook is not encrypted."));
        return std::nullopt;
    }
    QString error;
    auto v = VaultCrypto::Vault::fromJson(f.readAll(), &error);
    if (!v) {
        setError(error);
    }
    return v;
}

bool Vaults::writeVault(const QString &notebook, const VaultCrypto::Vault &vault)
{
    QString error;
    if (!writeFile(vaultFile(notebook), vault.toJson(), &error)) {
        setError(i18n("Could not save the notebook's keys: %1", error));
        return false;
    }
    return true;
}

void Vaults::setKey(const QString &notebook, const VaultCrypto::Key &key)
{
    {
        QMutexLocker lock(&m_mutex);
        m_keys.insert(notebook, key);
        m_lastUse.insert(notebook, QDateTime::currentMSecsSinceEpoch());
    }
    ++m_revision;
    setError(QString());
    Q_EMIT changed();
}

std::optional<VaultCrypto::Key> Vaults::keyFor(const QString &notebook)
{
    QMutexLocker lock(&m_mutex);
    const auto it = m_keys.constFind(notebook);
    if (it == m_keys.constEnd()) {
        return std::nullopt;
    }
    m_lastUse.insert(notebook, QDateTime::currentMSecsSinceEpoch());
    return *it;
}

std::optional<VaultCrypto::Key> Vaults::peekKey(const QString &notebook)
{
    QMutexLocker lock(&m_mutex);
    const auto it = m_keys.constFind(notebook);
    if (it == m_keys.constEnd()) {
        return std::nullopt;
    }
    return *it;
}

bool Vaults::unlock(const QString &notebook, const QString &password)
{
    const QString nb = notebookOf(notebook);
    const auto vault = readVault(nb.isEmpty() ? clean(notebook) : nb);
    if (!vault) {
        return false;
    }
    const auto key = VaultCrypto::unlockWithPassword(*vault, password);
    if (!key) {
        setError(i18n("Wrong password."));
        return false;
    }
    setKey(nb, *key);
    return true;
}

bool Vaults::unlockWithRecoveryKey(const QString &notebook, const QString &recoveryKey)
{
    const QString nb = notebookOf(notebook);
    const auto vault = readVault(nb.isEmpty() ? clean(notebook) : nb);
    if (!vault) {
        return false;
    }
    if (!VaultCrypto::decodeRecoveryKey(recoveryKey)) {
        setError(i18n("A recovery key has 52 letters and digits, in groups of four."));
        return false;
    }
    const auto key = VaultCrypto::unlockWithRecoveryKey(*vault, recoveryKey);
    if (!key) {
        setError(i18n("This recovery key does not belong to this notebook."));
        return false;
    }
    setKey(nb, *key);
    return true;
}

void Vaults::lock(const QString &notebook)
{
    const QString nb = notebookOf(notebook);
    if (!isUnlocked(nb)) {
        return;
    }
    Q_EMIT aboutToLock(nb);
    {
        QMutexLocker lock(&m_mutex);
        if (!m_keys.remove(nb)) {
            return;
        }
        m_lastUse.remove(nb);
    }
    ++m_revision;
    Q_EMIT locked(nb);
    Q_EMIT changed();
}

void Vaults::lockAll()
{
    QStringList notebooks;
    {
        QMutexLocker lock(&m_mutex);
        notebooks = m_keys.keys();
    }
    for (const QString &nb : notebooks) {
        lock(nb);
    }
}

void Vaults::checkAutoLock()
{
    const int minutes = Config::self()->autoLockMinutes();
    if (minutes <= 0) {
        return;
    }
    const qint64 limit = QDateTime::currentMSecsSinceEpoch() - qint64(minutes) * 60 * 1000;
    QStringList expired;
    {
        QMutexLocker lock(&m_mutex);
        for (auto it = m_lastUse.cbegin(); it != m_lastUse.cend(); ++it) {
            if (it.value() < limit) {
                expired << it.key();
            }
        }
    }
    for (const QString &nb : expired) {
        lock(nb);
    }
}

QStringList Vaults::rewriteNotes(const QString &notebook, const std::function<std::optional<QString>(const QString &, QString *)> &convert)
{
    QStringList changed;
    QDirIterator it(notebook, {u"*.md"_s}, QDir::Files, QDirIterator::Subdirectories);
    while (it.hasNext()) {
        const QString path = it.next();
        if (path.contains(u"/.marknote/"_s)) {
            continue;
        }
        QString text;
        QString error;
        if (!readFile(path, &text, &error)) {
            setError(error);
            continue;
        }
        const auto out = convert(text, &error);
        if (!out) {
            if (!error.isEmpty()) {
                setError(i18n("%1: %2", QFileInfo(path).fileName(), error));
            }
            continue;
        }
        if (*out != text && writeFile(path, out->toUtf8(), &error)) {
            changed << path;
        }
    }
    return changed;
}

QString Vaults::encryptNotebook(const QString &notebook, const QString &password)
{
    const QString nb = clean(notebook);
    if (isEncrypted(nb)) {
        setError(i18n("This notebook is already encrypted."));
        return {};
    }
    QString error;
    auto created = VaultCrypto::createVault(password, &error);
    if (!created) {
        setError(error);
        return {};
    }
    NoteMetadata::instance()->beginRewrite();
    // The vault first: from now on every save is encrypted, even if this is interrupted.
    if (!writeVault(nb, created->vault)) {
        return {};
    }
    setKey(nb, created->notebookKey);
    const VaultCrypto::Key key = created->notebookKey;
    const QStringList rewritten = rewriteNotes(nb, [&key](const QString &text, QString *) -> std::optional<QString> {
        if (VaultCrypto::isEncryptedNote(text)) {
            return text;
        }
        return VaultCrypto::encryptNote(text, key);
    });
    NoteMetadata::instance()->endRewrite(rewritten);
    return created->recoveryKey;
}

bool Vaults::changePassword(const QString &notebook, const QString &currentPassword, const QString &newPassword)
{
    const QString nb = notebookOf(notebook);
    const auto vault = readVault(nb);
    if (!vault) {
        return false;
    }
    const auto key = VaultCrypto::unlockWithPassword(*vault, currentPassword);
    if (!key) {
        setError(i18n("The current password is wrong."));
        return false;
    }
    const auto updated = VaultCrypto::changePassword(*vault, *key, newPassword);
    if (!updated || !writeVault(nb, *updated)) {
        if (!updated) {
            setError(i18n("Could not change the password."));
        }
        return false;
    }
    setKey(nb, *key);
    return true;
}

bool Vaults::removeEncryption(const QString &notebook, const QString &password)
{
    const QString nb = notebookOf(notebook);
    const auto vault = readVault(nb);
    if (!vault) {
        return false;
    }
    const auto key = VaultCrypto::unlockWithPassword(*vault, password);
    if (!key) {
        setError(i18n("Wrong password."));
        return false;
    }
    NoteMetadata::instance()->beginRewrite();
    bool failed = false;
    const QStringList rewritten = rewriteNotes(nb, [&key, &failed](const QString &text, QString *error) -> std::optional<QString> {
        if (!VaultCrypto::isEncryptedNote(text)) {
            return text;
        }
        auto plain = VaultCrypto::decryptNote(text, *key, error);
        if (!plain) {
            failed = true;
        }
        return plain;
    });
    if (failed) {
        // Keep the vault so the notes that could not be decrypted stay readable later.
        NoteMetadata::instance()->endRewrite(rewritten);
        return false;
    }
    QFile::remove(vaultFile(nb));
    QDir().rmdir(nb + u"/.marknote"_s); // only if nothing else is in it
    {
        QMutexLocker lock(&m_mutex);
        m_keys.remove(nb);
        m_lastUse.remove(nb);
    }
    ++m_revision;
    Q_EMIT changed();
    NoteMetadata::instance()->endRewrite(rewritten);
    return true;
}

namespace NoteIO
{

Status read(const QString &path, QString *text, QString *error)
{
    QString raw;
    if (!readFile(path, &raw, error)) {
        return Status::Error;
    }
    if (!VaultCrypto::isEncryptedNote(raw)) {
        *text = raw;
        return Status::Ok;
    }
    const QString nb = Vaults::notebookOf(path);
    const auto key = nb.isEmpty() ? std::nullopt : Vaults::instance()->keyFor(nb);
    if (!key) {
        if (error) {
            *error = i18n("This notebook is locked.");
        }
        return Status::Locked;
    }
    auto plain = VaultCrypto::decryptNote(raw, *key, error);
    if (!plain) {
        return Status::Error;
    }
    *text = *plain;
    return Status::Ok;
}

QString readText(const QString &path)
{
    QString text;
    return read(path, &text) == Status::Ok ? text : QString();
}

bool write(const QString &path, const QString &text, QString *error)
{
    const QString nb = Vaults::notebookOf(path);
    if (nb.isEmpty()) {
        return writeFile(path, text.toUtf8(), error);
    }
    const auto key = Vaults::instance()->keyFor(nb);
    if (!key) {
        // Never write plain text into an encrypted notebook.
        if (error) {
            *error = i18n("This notebook is locked.");
        }
        return false;
    }
    // Keep a display title the envelope already had.
    QString title;
    QString existing;
    if (QFileInfo::exists(path) && readFile(path, &existing, nullptr)) {
        title = VaultCrypto::envelopeTitle(existing);
    }
    return writeFile(path, VaultCrypto::encryptNote(text, *key, title).toUtf8(), error);
}

} // namespace NoteIO
