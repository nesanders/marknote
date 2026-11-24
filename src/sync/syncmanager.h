// SPDX-FileCopyrightText: 2026 Marknote fork contributors
// SPDX-License-Identifier: GPL-2.0-only OR GPL-3.0-only OR LicenseRef-KDE-Accepted-GPL

#pragma once

#include "googleauth.h"
#include "syncengine.h"

#include <QObject>
#include <QQmlEngine>
#include <QUrl>
#include <QVariantMap>

class QThread;

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

    static QString configPath(const QString &notebookPath);
    static QString cleanNotebookPath(const QString &notebookPath);

Q_SIGNALS:
    void runningChanged();
    void progressChanged();
    void googleClientChanged();
    /// Emitted right before a sync reads the notebook: save open edits now.
    void aboutToSync(const QString &notebookPath);
    void syncFinished(const QString &notebookPath, bool ok, const QString &summary, const QStringList &errors);
    /// Absolute URLs of files the sync wrote or removed locally.
    void filesChanged(const QList<QUrl> &fileUrls, const QStringList &filePaths);

private:
    explicit SyncManager(QObject *parent = nullptr);
    void startNext();
    void finished(const QString &notebookPath, const SyncResult &result);
    static QString summarize(const SyncResult &result);

    GoogleAuth *m_google = nullptr;
    QString m_running;
    QString m_progress;
    QStringList m_queue;
    QString m_builtInClientId;
    QString m_builtInClientSecret;
};

} // namespace Sync
