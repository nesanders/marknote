// SPDX-FileCopyrightText: 2026 Marknote fork contributors
// SPDX-License-Identifier: GPL-2.0-only OR GPL-3.0-only OR LicenseRef-KDE-Accepted-GPL

#pragma once

#include "googleauth.h"
#include "syncengine.h"

#include <QDateTime>
#include <QHash>
#include <QObject>
#include <QSet>
#include <QQmlEngine>
#include <QUrl>
#include <QVariantMap>

class QThread;
class QTimer;

namespace Sync
{

/**
 * Per-notebook sync for QML.
 *
 * Each notebook chooses its own destination. The choice and the sync state live
 * in "<notebook>/.marknote/sync/", which is never synced itself, so every device
 * keeps its own.
 */
class SyncManager : public QObject
{
    Q_OBJECT
    QML_ELEMENT
    QML_SINGLETON

    Q_PROPERTY(Sync::GoogleAuth *google READ google CONSTANT)
    Q_PROPERTY(QString runningNotebook READ runningNotebook NOTIFY runningChanged)
    Q_PROPERTY(QString progress READ progress NOTIFY progressChanged)
    Q_PROPERTY(QString googleClientId READ googleClientId NOTIFY googleClientChanged)
    Q_PROPERTY(bool googleClientBuiltIn READ googleClientBuiltIn CONSTANT)
    /// Changes whenever the activity log or the set of unseen notes changes.
    Q_PROPERTY(int activityRevision READ activityRevision NOTIFY activityChanged)

public:
    static SyncManager *create(QQmlEngine *qmlEngine, QJSEngine *jsEngine);
    static SyncManager *instance();

    GoogleAuth *google() const;
    QString runningNotebook() const;
    QString progress() const;
    QString googleClientId() const;
    bool googleClientBuiltIn() const;

    /// {destination: "none"|"google"|"folder", remoteFolder, localFolder,
    ///  lastSync (date), lastOk, lastSummary, lastErrors}
    Q_INVOKABLE QVariantMap settings(const QString &notebookPath) const;
    Q_INVOKABLE bool saveSettings(const QString &notebookPath, const QVariantMap &settings);
    Q_INVOKABLE QString defaultRemoteFolder(const QString &notebookPath) const;

    Q_INVOKABLE void setGoogleClient(const QString &clientId, const QString &clientSecret);

    Q_INVOKABLE bool syncNow(const QString &notebookPath);
    /// Syncs every notebook that has a destination (one after another).
    Q_INVOKABLE void syncAll(const QString &storagePath);
    /// Background check of every synced notebook; quiet unless something
    /// arrives. Skipped if the last one was less than @p minSeconds ago.
    Q_INVOKABLE void syncAllInBackground(int minSeconds = 0);

    int activityRevision() const;
    /// {state: "none"|"ok"|"syncing"|"queued"|"error", destination (display
    ///  name), lastSync, summary, errors}
    Q_INVOKABLE QVariantMap status(const QString &notebookPath) const;
    /// Newest first: {time, kind: received|sent|deletedHere|deletedThere|
    /// conflict, path, file (absolute), copy, copyFile, exists, unseen}
    Q_INVOKABLE QVariantList activity(const QString &notebookPath, int limit = 100);
    /// A note (path or file URL) that arrived from the destination and was not opened since.
    Q_INVOKABLE bool isUnseen(const QString &file);
    Q_INVOKABLE int unseenCount(const QString &notebookPath);
    /// Unseen notes inside a folder (path or URL), for folder rows.
    Q_INVOKABLE int unseenIn(const QString &folder);
    Q_INVOKABLE void markSeen(const QString &file);
    Q_INVOKABLE void markAllSeen(const QString &notebookPath);
    static QString activityPath(const QString &notebookPath);
    /// After encrypting a notebook: delete the readable copies Marknote can
    /// reach (this device's sync trash now; at the destination, earlier
    /// versions and its trash on the next sync), then sync.
    Q_INVOKABLE void purgeReadableCopies(const QString &notebookPath);
    /// Background sync settings changed: restart the timer.
    Q_INVOKABLE void backgroundSettingsChanged();

    static QString configPath(const QString &notebookPath);
    static QString cleanNotebookPath(const QString &notebookPath);

Q_SIGNALS:
    void runningChanged();
    void progressChanged();
    void googleClientChanged();
    /// Emitted right before a sync reads the notebook: save open edits now.
    void aboutToSync(const QString &notebookPath);
    /// @p background: started by the timer, not the user. @p received: notes
    /// that arrived (new, changed or conflict copies).
    void syncFinished(const QString &notebookPath, bool ok, const QString &summary, const QStringList &errors, bool background, int received);
    void activityChanged();
    /// Absolute URLs of files the sync wrote or removed locally.
    void filesChanged(const QList<QUrl> &fileUrls, const QStringList &filePaths);

private:
    explicit SyncManager(QObject *parent = nullptr);
    void startNext();
    void finished(const QString &notebookPath, const SyncResult &result);
    static QString summarize(const SyncResult &result);
    void record(const QString &notebookPath, const SyncResult &result);
    QSet<QString> &unseenOf(const QString &notebookPath);
    void saveUnseen(const QString &notebookPath);
    void scheduleBackground();
    /// The notebook a file belongs to (a synced notebook under the storage folder).
    QString notebookOf(const QString &file) const;

    GoogleAuth *m_google = nullptr;
    QString m_running;
    QString m_progress;
    QStringList m_queue;
    QString m_builtInClientId;
    QString m_builtInClientSecret;
    QSet<QString> m_background; ///< queued or running by the timer
    QHash<QString, QSet<QString>> m_unseen; ///< notebook -> relative paths
    int m_activityRevision = 0;
    QTimer *m_timer = nullptr;
    QDateTime m_lastBackground;
};

} // namespace Sync
