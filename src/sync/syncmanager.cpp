// SPDX-FileCopyrightText: 2026 Marknote fork contributors
// SPDX-License-Identifier: GPL-2.0-only OR GPL-3.0-only OR LicenseRef-KDE-Accepted-GPL

#include "syncmanager.h"

#include "googledrivebackend.h"
#include "localfolderbackend.h"
#include "vaults.h"

#include <marknotesettings.h>

#include <KLocalizedString>

#include <QCryptographicHash>
#include <QDir>
#include <QFile>
#include <QJsonArray>
#include <QJsonDocument>
#include <QJsonObject>
#include <QPointer>
#include <QSaveFile>
#include <QThread>
#include <QTimer>

#include <memory>

using namespace Qt::StringLiterals;

namespace Sync
{

namespace
{
QPointer<SyncManager> s_instance;

QJsonObject readConfig(const QString &notebookPath)
{
    QFile f(SyncManager::configPath(notebookPath));
    if (!f.open(QFile::ReadOnly)) {
        return {};
    }
    return QJsonDocument::fromJson(f.readAll()).object();
}

bool writeConfig(const QString &notebookPath, const QJsonObject &json)
{
    const QString path = SyncManager::configPath(notebookPath);
    QDir().mkpath(QFileInfo(path).absolutePath());
    QSaveFile f(path);
    if (!f.open(QFile::WriteOnly)) {
        return false;
    }
    f.write(QJsonDocument(json).toJson());
    return f.commit();
}

/// A different destination gets a different base state.
QString statePathFor(const QString &notebookPath, const QString &destination, const QString &target)
{
    const QByteArray hash = QCryptographicHash::hash((destination + u'\n' + target).toUtf8(), QCryptographicHash::Sha1).toHex().left(12);
    return notebookPath + u"/.marknote/sync/state-"_s + destination + u'-' + QString::fromLatin1(hash) + u".json"_s;
}
} // namespace

SyncManager::SyncManager(QObject *parent)
    : QObject(parent)
    , m_google(new GoogleAuth(TokenStore::createDefault(), this))
{
#ifdef MARKNOTE_GOOGLE_CLIENT_ID
    m_builtInClientId = QStringLiteral(MARKNOTE_GOOGLE_CLIENT_ID);
#endif
#ifdef MARKNOTE_GOOGLE_CLIENT_SECRET
    m_builtInClientSecret = QStringLiteral(MARKNOTE_GOOGLE_CLIENT_SECRET);
#endif
    auto *config = Config::self();
    const QString id = config->googleClientId().isEmpty() ? m_builtInClientId : config->googleClientId();
    const QString secret = config->googleClientId().isEmpty() ? m_builtInClientSecret : config->googleClientSecret();
    m_google->setClientCredentials(id, secret);
    m_google->setAccount(config->googleAccount());
    connect(m_google, &GoogleAuth::accountChanged, this, [this]() {
        Config::self()->setGoogleAccount(m_google->account());
        Config::self()->save();
    });
    // Only touch the wallet if this device signed in before: no prompt otherwise.
    if (!config->googleAccount().isEmpty()) {
        m_google->restore();
    }

    // Background sync: shortly after start, then every few minutes.
    m_timer = new QTimer(this);
    m_timer->setSingleShot(true);
    connect(m_timer, &QTimer::timeout, this, [this]() {
        syncAllInBackground();
        scheduleBackground();
    });
    m_timer->start(8 * 1000);
}

void SyncManager::scheduleBackground()
{
    auto *config = Config::self();
    if (!config->autoSync()) {
        m_timer->stop();
        return;
    }
    m_timer->start(std::max(1, config->autoSyncMinutes()) * 60 * 1000);
}

void SyncManager::backgroundSettingsChanged()
{
    scheduleBackground();
}

void SyncManager::syncAllInBackground(int minSeconds)
{
    auto *config = Config::self();
    if (!config->autoSync()) {
        return;
    }
    const QDateTime now = QDateTime::currentDateTime();
    if (minSeconds > 0 && m_lastBackground.isValid() && m_lastBackground.secsTo(now) < minSeconds) {
        return;
    }
    m_lastBackground = now;
    const QDir root(cleanNotebookPath(config->storage()));
    const auto notebooks = root.entryInfoList(QDir::Dirs | QDir::NoDotAndDotDot);
    for (const QFileInfo &info : notebooks) {
        const QString path = cleanNotebookPath(info.filePath());
        if (!QFile::exists(configPath(path)) || m_running == path || m_queue.contains(path)) {
            continue;
        }
        const QString destination = settings(path).value(u"destination"_s).toString();
        // Quietly skip what cannot work without the user (no sign-in yet).
        if (destination == u"none"_s || (destination == u"google"_s && !m_google->signedIn())) {
            continue;
        }
        m_background.insert(path);
        m_queue.append(path);
    }
    Q_EMIT runningChanged();
    if (m_running.isEmpty()) {
        startNext();
    }
}

SyncManager *SyncManager::create(QQmlEngine *qmlEngine, QJSEngine *jsEngine)
{
    Q_UNUSED(qmlEngine)
    Q_UNUSED(jsEngine)
    SyncManager *manager = instance();
    QJSEngine::setObjectOwnership(manager, QJSEngine::CppOwnership);
    return manager;
}

SyncManager *SyncManager::instance()
{
    if (!s_instance) {
        s_instance = new SyncManager(qApp);
    }
    return s_instance;
}

GoogleAuth *SyncManager::google() const
{
    return m_google;
}

QString SyncManager::runningNotebook() const
{
    return m_running;
}

QString SyncManager::progress() const
{
    return m_progress;
}

QString SyncManager::googleClientId() const
{
    return Config::self()->googleClientId();
}

bool SyncManager::googleClientBuiltIn() const
{
    return !m_builtInClientId.isEmpty();
}

void SyncManager::setGoogleClient(const QString &clientId, const QString &clientSecret)
{
    auto *config = Config::self();
    const bool changed = config->googleClientId() != clientId.trimmed() || config->googleClientSecret() != clientSecret.trimmed();
    config->setGoogleClientId(clientId.trimmed());
    config->setGoogleClientSecret(clientSecret.trimmed());
    config->save();
    if (clientId.trimmed().isEmpty()) {
        m_google->setClientCredentials(m_builtInClientId, m_builtInClientSecret);
    } else {
        m_google->setClientCredentials(clientId, clientSecret);
    }
    if (changed && m_google->signedIn()) {
        // A refresh token only works with the client that issued it.
        m_google->signOut();
    }
    Q_EMIT googleClientChanged();
}

QString SyncManager::cleanNotebookPath(const QString &notebookPath)
{
    QString path = notebookPath;
    if (path.startsWith(u"file:"_s)) {
        path = QUrl(path).toLocalFile();
    }
    return QDir::cleanPath(path);
}

QString SyncManager::configPath(const QString &notebookPath)
{
    return cleanNotebookPath(notebookPath) + u"/.marknote/sync/config.json"_s;
}

QString SyncManager::defaultRemoteFolder(const QString &notebookPath) const
{
    return u"Marknote/"_s + QFileInfo(cleanNotebookPath(notebookPath)).fileName();
}

QVariantMap SyncManager::settings(const QString &notebookPath) const
{
    const QString path = cleanNotebookPath(notebookPath);
    const QJsonObject json = readConfig(path);
    QVariantMap out;
    out[u"destination"_s] = json.value(u"destination"_s).toString(u"none"_s);
    out[u"remoteFolder"_s] = json.value(u"remoteFolder"_s).toString(defaultRemoteFolder(path));
    out[u"localFolder"_s] = json.value(u"localFolder"_s).toString();
    out[u"lastSync"_s] = QDateTime::fromString(json.value(u"lastSync"_s).toString(), Qt::ISODate);
    out[u"lastOk"_s] = json.value(u"lastOk"_s).toBool(true);
    out[u"lastSummary"_s] = json.value(u"lastSummary"_s).toString();
    out[u"lastErrors"_s] = json.value(u"lastErrors"_s).toVariant().toStringList();
    return out;
}

bool SyncManager::saveSettings(const QString &notebookPath, const QVariantMap &settings)
{
    const QString path = cleanNotebookPath(notebookPath);
    QJsonObject json = readConfig(path);
    for (const auto &key : {u"destination"_s, u"remoteFolder"_s, u"localFolder"_s}) {
        if (settings.contains(key)) {
            QString value = settings.value(key).toString().trimmed();
            if (key == u"localFolder"_s && value.startsWith(u"file:"_s)) {
                value = QUrl(value).toLocalFile();
            }
            if (key == u"remoteFolder"_s) {
                while (value.endsWith(u'/')) {
                    value.chop(1);
                }
            }
            json[key] = value;
        }
    }
    return writeConfig(path, json);
}

bool SyncManager::syncNow(const QString &notebookPath)
{
    const QString path = cleanNotebookPath(notebookPath);
    if (settings(path).value(u"destination"_s).toString() == u"none"_s) {
        return false;
    }
    m_background.remove(path); // asked for by the user: report the outcome
    if (m_running == path || m_queue.contains(path)) {
        return true;
    }
    m_queue.append(path);
    if (m_running.isEmpty()) {
        startNext();
    }
    return true;
}

void SyncManager::syncAll(const QString &storagePath)
{
    const QDir root(cleanNotebookPath(storagePath));
    const auto notebooks = root.entryInfoList(QDir::Dirs | QDir::NoDotAndDotDot);
    for (const QFileInfo &info : notebooks) {
        if (QFile::exists(configPath(info.filePath()))) {
            syncNow(info.filePath());
        }
    }
}

void SyncManager::startNext()
{
    if (m_queue.isEmpty()) {
        return;
    }
    const QString path = m_queue.takeFirst();
    const QVariantMap config = settings(path);
    const QString destination = config.value(u"destination"_s).toString();

    m_running = path;
    m_progress = i18n("Starting…");
    Q_EMIT runningChanged();
    Q_EMIT progressChanged();
    Q_EMIT aboutToSync(path);

    std::function<std::unique_ptr<RemoteBackend>()> makeBackend;
    QString target;
    QString setupError;
    if (destination == u"google"_s) {
        target = config.value(u"remoteFolder"_s).toString();
        if (!m_google->signedIn()) {
            setupError = i18n("Sign in to Google Drive first.");
        } else if (target.isEmpty()) {
            setupError = i18n("Choose a Google Drive folder.");
        }
        const auto tokens = m_google->tokenProvider();
        const QString apiBase = m_google->endpoints().apiBase;
        makeBackend = [target, tokens, apiBase]() {
            return std::make_unique<GoogleDriveBackend>(target, tokens, apiBase);
        };
    } else if (destination == u"folder"_s) {
        target = QDir::cleanPath(config.value(u"localFolder"_s).toString());
        if (config.value(u"localFolder"_s).toString().isEmpty()) {
            setupError = i18n("Choose a folder to sync with.");
        } else if (target == path || target.startsWith(path + u'/') || path.startsWith(target + u'/')) {
            setupError = i18n("The sync folder cannot be inside the notebook, or the other way round.");
        }
        makeBackend = [target]() {
            return std::make_unique<LocalFolderBackend>(target);
        };
    } else {
        setupError = i18n("This notebook has no sync destination.");
    }

    if (!setupError.isEmpty()) {
        SyncResult result;
        result.errors << setupError;
        finished(path, result);
        return;
    }

    const QString statePath = statePathFor(path, destination, target);
    auto result = std::make_shared<SyncResult>();
    QPointer<SyncManager> self(this);
    Vaults *vaults = Vaults::instance(); // created here, on the main thread
    const bool purge = readConfig(path).value(u"purgeReadable"_s).toBool();
    QThread *thread = QThread::create([path, statePath, makeBackend, result, self, vaults, purge]() {
        std::unique_ptr<RemoteBackend> backend = makeBackend();
        SyncEngine engine(path, backend.get(), statePath);
        engine.setKeyProvider([vaults, path]() {
            return vaults->peekKey(path);
        });
        engine.setPurgeReadable(purge);
        *result = engine.run([self](const QString &message) {
            QMetaObject::invokeMethod(qApp, [self, message]() {
                if (self) {
                    self->m_progress = message;
                    Q_EMIT self->progressChanged();
                }
            });
        });
    });
    connect(thread, &QThread::finished, this, [this, thread, path, result]() {
        thread->deleteLater();
        finished(path, *result);
    });
    thread->start();
}

QString SyncManager::summarize(const SyncResult &r)
{
    QStringList parts;
    if (r.uploaded) {
        parts << i18np("1 file sent", "%1 files sent", r.uploaded);
    }
    if (r.downloaded) {
        parts << i18np("1 file received", "%1 files received", r.downloaded);
    }
    if (r.deletedLocal + r.deletedRemote) {
        parts << i18np("1 deletion", "%1 deletions", r.deletedLocal + r.deletedRemote);
    }
    if (r.conflicts) {
        parts << i18np("1 conflict (both versions kept)", "%1 conflicts (both versions kept)", r.conflicts);
    }
    if (parts.isEmpty()) {
        return r.ok() ? i18n("Everything up to date") : i18n("Sync failed");
    }
    return parts.join(u", "_s);
}

void SyncManager::finished(const QString &notebookPath, const SyncResult &result)
{
    const QString summary = summarize(result);

    QJsonObject json = readConfig(notebookPath);
    json[u"lastSync"_s] = QDateTime::currentDateTime().toString(Qt::ISODate);
    json[u"lastSummary"_s] = summary;
    QStringList errors = result.errors;
    if (!result.heldBack.isEmpty()) {
        errors.prepend(i18np("1 note was not sent: it is not encrypted yet and the notebook is locked. Unlock the notebook to sync it.",
                             "%1 notes were not sent: they are not encrypted yet and the notebook is locked. Unlock the notebook to sync them.",
                             result.heldBack.size()));
    }
    json[u"lastOk"_s] = errors.isEmpty();
    json[u"lastErrors"_s] = QJsonArray::fromStringList(errors.mid(0, 20));
    if (json.value(u"purgeReadable"_s).toBool() && result.ok() && result.heldBack.isEmpty()) {
        json.remove(u"purgeReadable"_s); // done
    }
    writeConfig(notebookPath, json);
    record(notebookPath, result);
    const bool background = m_background.remove(notebookPath);
    int received = 0;
    for (const SyncChange &c : result.log) {
        if ((c.kind == SyncChange::Received || c.kind == SyncChange::Conflict) && c.path.endsWith(u".md"_s)) {
            ++received;
        }
    }

    if (!result.changedLocalPaths.isEmpty()) {
        QList<QUrl> urls;
        QStringList paths;
        for (const QString &relative : result.changedLocalPaths) {
            const QString absolute = notebookPath + u'/' + relative;
            urls << QUrl::fromLocalFile(absolute);
            paths << absolute;
        }
        Q_EMIT filesChanged(urls, paths);
    }

    m_running.clear();
    m_progress.clear();
    Q_EMIT runningChanged();
    Q_EMIT progressChanged();
    Q_EMIT syncFinished(notebookPath, errors.isEmpty(), summary, errors, background, received);
    startNext();
}

// ---- Activity -------------------------------------------------------------

namespace
{
constexpr int MaxEntries = 300;

QString kindName(SyncChange::Kind kind)
{
    switch (kind) {
    case SyncChange::Received:
        return u"received"_s;
    case SyncChange::Sent:
        return u"sent"_s;
    case SyncChange::DeletedHere:
        return u"deletedHere"_s;
    case SyncChange::DeletedThere:
        return u"deletedThere"_s;
    case SyncChange::Conflict:
        return u"conflict"_s;
    }
    return {};
}

QJsonObject readActivity(const QString &notebookPath)
{
    QFile f(SyncManager::activityPath(notebookPath));
    if (!f.open(QFile::ReadOnly)) {
        return {};
    }
    return QJsonDocument::fromJson(f.readAll()).object();
}

void writeActivity(const QString &notebookPath, const QJsonObject &json)
{
    const QString path = SyncManager::activityPath(notebookPath);
    QDir().mkpath(QFileInfo(path).absolutePath());
    QSaveFile f(path);
    if (f.open(QFile::WriteOnly)) {
        f.write(QJsonDocument(json).toJson(QJsonDocument::Compact));
        f.commit();
    }
}

bool isNote(const QString &path)
{
    return path.endsWith(u".md"_s);
}
} // namespace

bool SyncManager::syncsToGoogle(const QString &path) const
{
    const QString nb = notebookOf(cleanNotebookPath(path) + u"/x"_s);
    return !nb.isEmpty() && settings(nb).value(u"destination"_s).toString() == u"google"_s;
}

QString SyncManager::googleDriveUrl(const QString &path) const
{
    const QString clean = cleanNotebookPath(path);
    const QString nb = notebookOf(clean + u"/x"_s);
    if (nb.isEmpty() || !syncsToGoogle(nb)) {
        return {};
    }
    const QString target = settings(nb).value(u"remoteFolder"_s).toString();
    const SyncState state = SyncState::load(statePathFor(nb, u"google"_s, target));
    const QString rel = clean == nb ? QString() : clean.mid(nb.size() + 1);
    const QString id = state.ids.value(rel);
    if (id.isEmpty()) {
        return {};
    }
    const bool folder = rel.isEmpty() || state.folders.contains(rel);
    return folder ? QString(u"https://drive.google.com/drive/folders/"_s + id) : QString(u"https://drive.google.com/file/d/"_s + id + u"/view"_s);
}

void SyncManager::purgeReadableCopies(const QString &notebookPath)
{
    const QString path = cleanNotebookPath(notebookPath);
    QDir(path + u"/.marknote/trash"_s).removeRecursively();
    if (settings(path).value(u"destination"_s).toString() == u"none"_s) {
        return;
    }
    QJsonObject json = readConfig(path);
    json[u"purgeReadable"_s] = true;
    writeConfig(path, json);
    syncNow(path);
}

QString SyncManager::activityPath(const QString &notebookPath)
{
    // Next to the sync state: device-local, never synced.
    return cleanNotebookPath(notebookPath) + u"/.marknote/sync/activity.json"_s;
}

int SyncManager::activityRevision() const
{
    return m_activityRevision;
}

QSet<QString> &SyncManager::unseenOf(const QString &notebookPath)
{
    auto it = m_unseen.find(notebookPath);
    if (it == m_unseen.end()) {
        QSet<QString> set;
        for (const QJsonValue &v : readActivity(notebookPath).value(u"unseen"_s).toArray()) {
            if (QFile::exists(notebookPath + u'/' + v.toString())) { // not deleted or moved since
                set.insert(v.toString());
            }
        }
        it = m_unseen.insert(notebookPath, set);
    }
    return it.value();
}

void SyncManager::saveUnseen(const QString &notebookPath)
{
    QJsonObject json = readActivity(notebookPath);
    const QSet<QString> &set = unseenOf(notebookPath);
    QStringList list(set.cbegin(), set.cend());
    list.sort();
    json[u"unseen"_s] = QJsonArray::fromStringList(list);
    writeActivity(notebookPath, json);
}

void SyncManager::record(const QString &notebookPath, const SyncResult &result)
{
    if (result.log.isEmpty()) {
        return;
    }
    QJsonObject json = readActivity(notebookPath);
    QJsonArray entries = json.value(u"entries"_s).toArray();
    QSet<QString> &unseen = unseenOf(notebookPath);
    const QString now = QDateTime::currentDateTime().toString(Qt::ISODate);
    for (const SyncChange &c : result.log) {
        QJsonObject e{{u"time"_s, now}, {u"kind"_s, kindName(c.kind)}, {u"path"_s, c.path}};
        if (!c.copy.isEmpty()) {
            e[u"copy"_s] = c.copy;
        }
        entries.append(e);
        if (c.kind == SyncChange::Received && isNote(c.path)) {
            unseen.insert(c.path);
        } else if (c.kind == SyncChange::Conflict && isNote(c.copy)) {
            unseen.insert(c.copy);
        } else if (c.kind == SyncChange::DeletedHere) {
            unseen.remove(c.path);
        }
    }
    while (entries.size() > MaxEntries) {
        entries.removeFirst();
    }
    json[u"entries"_s] = entries;
    QStringList list(unseen.cbegin(), unseen.cend());
    list.sort();
    json[u"unseen"_s] = QJsonArray::fromStringList(list);
    writeActivity(notebookPath, json);
    ++m_activityRevision;
    Q_EMIT activityChanged();
}

QString SyncManager::notebookOf(const QString &file) const
{
    const QString path = cleanNotebookPath(file);
    const QString storage = cleanNotebookPath(Config::self()->storage());
    if (!path.startsWith(storage + u'/')) {
        return {};
    }
    const QString first = path.mid(storage.size() + 1).section(u'/', 0, 0);
    return first.isEmpty() ? QString() : storage + u'/' + first;
}

QVariantMap SyncManager::status(const QString &notebookPath) const
{
    const QString path = cleanNotebookPath(notebookPath);
    const QVariantMap config = settings(path);
    const QString destination = config.value(u"destination"_s).toString();
    QVariantMap out;
    out[u"lastSync"_s] = config.value(u"lastSync"_s);
    out[u"summary"_s] = config.value(u"lastSummary"_s);
    out[u"errors"_s] = config.value(u"lastErrors"_s);
    if (destination == u"google"_s) {
        out[u"destination"_s] = i18n("Google Drive");
    } else if (destination == u"folder"_s) {
        out[u"destination"_s] = i18nc("@info sync destination", "folder “%1”", QFileInfo(config.value(u"localFolder"_s).toString()).fileName());
    }
    if (destination == u"none"_s) {
        out[u"state"_s] = u"none"_s;
    } else if (m_running == path) {
        out[u"state"_s] = u"syncing"_s;
    } else if (m_queue.contains(path)) {
        out[u"state"_s] = u"queued"_s;
    } else if (!config.value(u"lastSync"_s).toDateTime().isValid()) {
        out[u"state"_s] = u"never"_s;
    } else {
        out[u"state"_s] = config.value(u"lastOk"_s).toBool() ? u"ok"_s : u"error"_s;
    }
    return out;
}

QVariantList SyncManager::activity(const QString &notebookPath, int limit)
{
    const QString nb = cleanNotebookPath(notebookPath);
    const QJsonArray entries = readActivity(nb).value(u"entries"_s).toArray();
    const QSet<QString> &unseen = unseenOf(nb);
    QVariantList out;
    for (qsizetype i = entries.size() - 1; i >= 0 && out.size() < limit; --i) {
        const QJsonObject e = entries.at(i).toObject();
        const QString path = e.value(u"path"_s).toString();
        // Folder settings (.directory) and other hidden files are not shown.
        if (path.section(u'/', -1).startsWith(u'.')) {
            continue;
        }
        const QString copy = e.value(u"copy"_s).toString();
        QVariantMap m;
        m[u"time"_s] = QDateTime::fromString(e.value(u"time"_s).toString(), Qt::ISODate);
        m[u"kind"_s] = e.value(u"kind"_s).toString();
        m[u"path"_s] = path;
        m[u"file"_s] = QString(nb + u'/' + path);
        m[u"exists"_s] = QFile::exists(nb + u'/' + path);
        m[u"copy"_s] = copy;
        m[u"copyFile"_s] = copy.isEmpty() ? QString() : nb + u'/' + copy;
        m[u"copyExists"_s] = !copy.isEmpty() && QFile::exists(nb + u'/' + copy);
        const QString kind = e.value(u"kind"_s).toString();
        m[u"unseen"_s] = (kind == u"received"_s || kind == u"conflict"_s) && unseen.contains(copy.isEmpty() ? path : copy);
        out << m;
    }
    return out;
}

bool SyncManager::isUnseen(const QString &file)
{
    const QString nb = notebookOf(file);
    if (nb.isEmpty() || !QFile::exists(configPath(nb))) {
        return false;
    }
    return unseenOf(nb).contains(cleanNotebookPath(file).mid(nb.size() + 1));
}

int SyncManager::unseenCount(const QString &notebookPath)
{
    const QString nb = cleanNotebookPath(notebookPath);
    if (!QFile::exists(configPath(nb))) {
        return 0;
    }
    int n = 0;
    for (const QString &rel : unseenOf(nb)) {
        n += QFile::exists(nb + u'/' + rel) ? 1 : 0;
    }
    return n;
}

int SyncManager::unseenIn(const QString &folder)
{
    const QString path = cleanNotebookPath(folder);
    const QString nb = notebookOf(path + u"/x");
    if (nb.isEmpty() || !QFile::exists(configPath(nb))) {
        return 0;
    }
    const QString prefix = path == nb ? QString() : path.mid(nb.size() + 1) + u'/';
    int n = 0;
    for (const QString &rel : unseenOf(nb)) {
        n += rel.startsWith(prefix) && QFile::exists(nb + u'/' + rel) ? 1 : 0;
    }
    return n;
}

void SyncManager::markSeen(const QString &file)
{
    const QString nb = notebookOf(file);
    if (nb.isEmpty() || !QFile::exists(configPath(nb))) {
        return;
    }
    if (unseenOf(nb).remove(cleanNotebookPath(file).mid(nb.size() + 1))) {
        saveUnseen(nb);
        ++m_activityRevision;
        Q_EMIT activityChanged();
    }
}

void SyncManager::markAllSeen(const QString &notebookPath)
{
    const QString nb = cleanNotebookPath(notebookPath);
    QSet<QString> &set = unseenOf(nb);
    if (!set.isEmpty()) {
        set.clear();
        saveUnseen(nb);
        ++m_activityRevision;
        Q_EMIT activityChanged();
    }
}

} // namespace Sync
