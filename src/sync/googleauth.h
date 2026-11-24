// SPDX-FileCopyrightText: 2026 Marknote fork contributors
// SPDX-License-Identifier: GPL-2.0-only OR GPL-3.0-only OR LicenseRef-KDE-Accepted-GPL

#pragma once

#include "googledrivebackend.h"
#include "tokenstore.h"

#include <QDateTime>
#include <QMutex>
#include <QObject>
#include <QQmlEngine>
#include <QUrl>

#include <functional>
#include <memory>

class QNetworkAccessManager;
class QOAuth2AuthorizationCodeFlow;
class QOAuthHttpServerReplyHandler;

namespace Sync
{

/**
 * One Google account for Drive sync.
 *
 * Sign-in is the OAuth 2.0 "installed app" flow: the browser opens Google's
 * consent page, Google redirects back to a one-shot server on 127.0.0.1, and
 * the code is exchanged with PKCE. Only the drive.file scope is requested, so
 * Marknote can see nothing in Drive except the files it created.
 *
 * The refresh token goes to the TokenStore (KDE Wallet); access tokens are only
 * kept in memory. accessToken() is thread safe and blocking, so sync workers can
 * use tokenProvider() directly.
 */
class GoogleAuth : public QObject
{
    Q_OBJECT
    QML_ELEMENT
    QML_UNCREATABLE("Use SyncManager.google")

    Q_PROPERTY(bool configured READ configured NOTIFY configuredChanged)
    Q_PROPERTY(bool signedIn READ signedIn NOTIFY signedInChanged)
    Q_PROPERTY(bool busy READ busy NOTIFY busyChanged)
    Q_PROPERTY(QString account READ account NOTIFY accountChanged)
    Q_PROPERTY(QString lastError READ lastError NOTIFY lastErrorChanged)
    Q_PROPERTY(QUrl pendingAuthorizationUrl READ pendingAuthorizationUrl NOTIFY busyChanged)
    Q_PROPERTY(QString tokenStorage READ tokenStorage NOTIFY tokenStorageChanged)

public:
    static constexpr auto DriveFileScope = "https://www.googleapis.com/auth/drive.file";
    static constexpr auto TokenStoreKey = "google-refresh-token";

    struct Endpoints {
        QUrl authorization = QUrl(QStringLiteral("https://accounts.google.com/o/oauth2/v2/auth"));
        QUrl token = QUrl(QStringLiteral("https://oauth2.googleapis.com/token"));
        QString apiBase = QString::fromLatin1(GoogleDriveBackend::DefaultApiBase);
    };

    explicit GoogleAuth(std::unique_ptr<TokenStore> store, QObject *parent = nullptr);
    ~GoogleAuth() override;

    void setEndpoints(const Endpoints &endpoints);
    Endpoints endpoints() const;
    void setClientCredentials(const QString &clientId, const QString &clientSecret);
    /// Opens the consent page; defaults to QDesktopServices::openUrl.
    void setBrowserOpener(std::function<void(const QUrl &)> opener);

    bool configured() const;
    bool signedIn() const;
    bool busy() const;
    QString account() const;
    QString lastError() const;
    QUrl pendingAuthorizationUrl() const;
    QString tokenStorage() const;

    /// Restores the refresh token from the store (call once at startup).
    void restore();

    Q_INVOKABLE void signIn();
    Q_INVOKABLE void cancelSignIn();
    Q_INVOKABLE void signOut();

    /// Thread safe, blocking. Refreshes when expired or when @p forceRefresh.
    QString accessToken(bool forceRefresh, QString *error);
    GoogleDriveBackend::TokenProvider tokenProvider();

    /// Remembered account label, restored by the owner (not secret).
    void setAccount(const QString &account);

Q_SIGNALS:
    void configuredChanged();
    void signedInChanged();
    void busyChanged();
    void accountChanged();
    void lastErrorChanged();
    void restored();
    void tokenStorageChanged();

private:
    void setBusy(bool busy);
    void setError(const QString &error);
    void finishSignIn(const QString &accessToken, const QString &refreshToken, const QDateTime &expiry);
    void fetchAccount();

    std::unique_ptr<TokenStore> m_store;
    Endpoints m_endpoints;
    QString m_clientId;
    QString m_clientSecret;
    std::function<void(const QUrl &)> m_openBrowser;

    QOAuth2AuthorizationCodeFlow *m_flow = nullptr;
    QOAuthHttpServerReplyHandler *m_replyHandler = nullptr;
    QNetworkAccessManager *m_nam = nullptr;
    QUrl m_pendingUrl;
    bool m_busy = false;
    QString m_account;
    QString m_lastError;

    mutable QMutex m_mutex; ///< guards the token fields below
    QString m_refreshToken;
    QString m_accessToken;
    QDateTime m_expiry;
};

} // namespace Sync
