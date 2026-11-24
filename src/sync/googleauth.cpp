// SPDX-FileCopyrightText: 2026 Marknote fork contributors
// SPDX-License-Identifier: GPL-2.0-only OR GPL-3.0-only OR LicenseRef-KDE-Accepted-GPL

#include "googleauth.h"

#include <KLocalizedString>

#include <QDesktopServices>
#include <QEventLoop>
#include <QHostAddress>
#include <QJsonDocument>
#include <QJsonObject>
#include <QMutexLocker>
#include <QNetworkAccessManager>
#include <QNetworkReply>
#include <QOAuth2AuthorizationCodeFlow>
#include <QOAuthHttpServerReplyHandler>
#include <QTimer>
#include <QUrlQuery>

using namespace Qt::StringLiterals;

namespace Sync
{

GoogleAuth::GoogleAuth(std::unique_ptr<TokenStore> store, QObject *parent)
    : QObject(parent)
    , m_store(std::move(store))
    , m_openBrowser([](const QUrl &url) {
        QDesktopServices::openUrl(url);
    })
    , m_nam(new QNetworkAccessManager(this))
{
}

GoogleAuth::~GoogleAuth() = default;

void GoogleAuth::setEndpoints(const Endpoints &endpoints)
{
    m_endpoints = endpoints;
}

GoogleAuth::Endpoints GoogleAuth::endpoints() const
{
    return m_endpoints;
}

void GoogleAuth::setClientCredentials(const QString &clientId, const QString &clientSecret)
{
    const bool wasConfigured = configured();
    m_clientId = clientId.trimmed();
    m_clientSecret = clientSecret.trimmed();
    if (wasConfigured != configured()) {
        Q_EMIT configuredChanged();
    }
}

void GoogleAuth::setBrowserOpener(std::function<void(const QUrl &)> opener)
{
    m_openBrowser = std::move(opener);
}

bool GoogleAuth::configured() const
{
    return !m_clientId.isEmpty();
}

bool GoogleAuth::signedIn() const
{
    QMutexLocker lock(&m_mutex);
    return !m_refreshToken.isEmpty();
}

bool GoogleAuth::busy() const
{
    return m_busy;
}

QString GoogleAuth::account() const
{
    return m_account;
}

QString GoogleAuth::lastError() const
{
    return m_lastError;
}

QUrl GoogleAuth::pendingAuthorizationUrl() const
{
    return m_pendingUrl;
}

QString GoogleAuth::tokenStorage() const
{
    return m_store ? m_store->description() : QString();
}

void GoogleAuth::setAccount(const QString &account)
{
    if (m_account != account) {
        m_account = account;
        Q_EMIT accountChanged();
    }
}

void GoogleAuth::setBusy(bool busy)
{
    if (m_busy != busy) {
        m_busy = busy;
        if (!busy) {
            m_pendingUrl.clear();
        }
        Q_EMIT busyChanged();
    }
}

void GoogleAuth::setError(const QString &error)
{
    if (m_lastError != error) {
        m_lastError = error;
        Q_EMIT lastErrorChanged();
    }
}

void GoogleAuth::restore()
{
    if (!m_store) {
        Q_EMIT restored();
        return;
    }
    m_store->load(QString::fromLatin1(TokenStoreKey), [this](bool ok, const QString &secret, const QString &error) {
        if (!ok) {
            setError(error);
        } else if (!secret.isEmpty()) {
            {
                QMutexLocker lock(&m_mutex);
                m_refreshToken = secret;
            }
            Q_EMIT signedInChanged();
        }
        Q_EMIT tokenStorageChanged();
        Q_EMIT restored();
    });
}

void GoogleAuth::signIn()
{
    if (!configured()) {
        setError(i18n("Add a Google OAuth client ID in the sync settings first."));
        return;
    }
    cancelSignIn();
    setError(QString());

    m_replyHandler = new QOAuthHttpServerReplyHandler(this);
    if (m_replyHandler->isListening()) {
        m_replyHandler->close();
    }
    m_replyHandler->setCallbackHost(u"127.0.0.1"_s);
    m_replyHandler->setCallbackText(i18n("Marknote is signed in to Google Drive. You can close this tab."));
    if (!m_replyHandler->listen(QHostAddress::LocalHost, 0)) {
        setError(i18n("Could not start the local sign-in listener."));
        cancelSignIn();
        return;
    }

    m_flow = new QOAuth2AuthorizationCodeFlow(m_nam, this);
    m_flow->setReplyHandler(m_replyHandler);
    m_flow->setAuthorizationUrl(m_endpoints.authorization);
    m_flow->setTokenUrl(m_endpoints.token);
    m_flow->setClientIdentifier(m_clientId);
    m_flow->setClientIdentifierSharedKey(m_clientSecret);
    m_flow->setRequestedScopeTokens({QByteArray(DriveFileScope)});
    m_flow->setPkceMethod(QOAuth2AuthorizationCodeFlow::PkceMethod::S256);
    m_flow->setModifyParametersFunction([](QAbstractOAuth::Stage stage, QMultiMap<QString, QVariant> *params) {
        if (stage == QAbstractOAuth::Stage::RequestingAuthorization) {
            // Ask for a refresh token, and ask again on re-sign-in so we get a new one.
            params->replace(u"access_type"_s, u"offline"_s);
            params->replace(u"prompt"_s, u"consent"_s);
        }
    });

    connect(m_flow, &QAbstractOAuth::authorizeWithBrowser, this, [this](const QUrl &url) {
        m_pendingUrl = url;
        Q_EMIT busyChanged();
        m_openBrowser(url);
    });
    connect(m_flow, &QAbstractOAuth::granted, this, [this]() {
        if (m_flow->refreshToken().isEmpty()) {
            setError(i18n("Google did not return a refresh token. Remove Marknote from your Google account's third-party access and sign in again."));
            cancelSignIn();
            return;
        }
        finishSignIn(m_flow->token(), m_flow->refreshToken(), m_flow->expirationAt());
    });
    connect(m_flow, &QAbstractOAuth2::serverReportedErrorOccurred, this, [this](const QString &error, const QString &description) {
        setError(description.isEmpty() ? error : description);
        cancelSignIn();
    });
    connect(m_flow, &QAbstractOAuth::requestFailed, this, [this](QAbstractOAuth::Error) {
        if (m_lastError.isEmpty()) {
            setError(i18n("Signing in to Google failed."));
        }
        cancelSignIn();
    });

    setBusy(true);
    m_flow->grant();
}

void GoogleAuth::cancelSignIn()
{
    if (m_flow) {
        m_flow->disconnect(this);
        m_flow->deleteLater();
        m_flow = nullptr;
    }
    if (m_replyHandler) {
        m_replyHandler->close();
        m_replyHandler->deleteLater();
        m_replyHandler = nullptr;
    }
    setBusy(false);
}

void GoogleAuth::finishSignIn(const QString &accessToken, const QString &refreshToken, const QDateTime &expiry)
{
    {
        QMutexLocker lock(&m_mutex);
        m_refreshToken = refreshToken;
        m_accessToken = accessToken;
        m_expiry = expiry.isValid() ? expiry : QDateTime::currentDateTimeUtc().addSecs(3000);
    }
    cancelSignIn();
    Q_EMIT signedInChanged();
    fetchAccount();
    if (m_store) {
        m_store->save(QString::fromLatin1(TokenStoreKey), refreshToken, [this](bool ok, const QString &error) {
            Q_EMIT tokenStorageChanged();
            if (!ok) {
                setError(i18n("Signed in, but the sign-in could not be saved (%1). You will need to sign in again next time.", error));
            }
        });
    }
}

void GoogleAuth::fetchAccount()
{
    QString token;
    {
        QMutexLocker lock(&m_mutex);
        token = m_accessToken;
    }
    QNetworkRequest request(QUrl(m_endpoints.apiBase + u"/drive/v3/about?fields=user(emailAddress,displayName)"_s));
    request.setRawHeader("Authorization", "Bearer " + token.toUtf8());
    QNetworkReply *reply = m_nam->get(request);
    connect(reply, &QNetworkReply::finished, this, [this, reply]() {
        reply->deleteLater();
        const QJsonObject user = QJsonDocument::fromJson(reply->readAll()).object().value(u"user"_s).toObject();
        QString label = user.value(u"emailAddress"_s).toString();
        if (label.isEmpty()) {
            label = user.value(u"displayName"_s).toString();
        }
        // The label also marks "signed in on this device" for the next start.
        setAccount(label.isEmpty() ? i18n("Google account") : label);
    });
}

void GoogleAuth::signOut()
{
    cancelSignIn();
    QString refresh;
    {
        QMutexLocker lock(&m_mutex);
        refresh = std::exchange(m_refreshToken, {});
        m_accessToken.clear();
        m_expiry = {};
    }
    if (m_store) {
        m_store->remove(QString::fromLatin1(TokenStoreKey));
    }
    if (!refresh.isEmpty() && m_endpoints.token.host() == u"oauth2.googleapis.com"_s) {
        // Best effort: revoke the grant so it no longer appears in the account.
        QNetworkRequest request(QUrl(u"https://oauth2.googleapis.com/revoke"_s));
        request.setHeader(QNetworkRequest::ContentTypeHeader, u"application/x-www-form-urlencoded"_s);
        QUrlQuery body;
        body.addQueryItem(u"token"_s, refresh);
        QNetworkReply *reply = m_nam->post(request, body.toString(QUrl::FullyEncoded).toUtf8());
        connect(reply, &QNetworkReply::finished, reply, &QObject::deleteLater);
    }
    setAccount(QString());
    setError(QString());
    Q_EMIT signedInChanged();
}

QString GoogleAuth::accessToken(bool forceRefresh, QString *error)
{
    QMutexLocker lock(&m_mutex);
    if (m_refreshToken.isEmpty()) {
        if (error) {
            *error = i18n("Not signed in to Google Drive.");
        }
        return {};
    }
    const auto now = QDateTime::currentDateTimeUtc();
    if (!forceRefresh && !m_accessToken.isEmpty() && m_expiry.isValid() && now.secsTo(m_expiry) > 60) {
        return m_accessToken;
    }

    QUrlQuery form;
    form.addQueryItem(u"grant_type"_s, u"refresh_token"_s);
    form.addQueryItem(u"refresh_token"_s, m_refreshToken);
    form.addQueryItem(u"client_id"_s, m_clientId);
    if (!m_clientSecret.isEmpty()) {
        form.addQueryItem(u"client_secret"_s, m_clientSecret);
    }

    // Own manager and loop: this runs on whichever thread asked.
    QNetworkAccessManager nam;
    QNetworkRequest request(m_endpoints.token);
    request.setHeader(QNetworkRequest::ContentTypeHeader, u"application/x-www-form-urlencoded"_s);
    QNetworkReply *reply = nam.post(request, form.toString(QUrl::FullyEncoded).toUtf8());
    QEventLoop loop;
    QTimer timeout;
    timeout.setSingleShot(true);
    QObject::connect(&timeout, &QTimer::timeout, reply, &QNetworkReply::abort);
    QObject::connect(reply, &QNetworkReply::finished, &loop, &QEventLoop::quit);
    timeout.start(30000);
    loop.exec();

    const int status = reply->attribute(QNetworkRequest::HttpStatusCodeAttribute).toInt();
    const QJsonObject json = QJsonDocument::fromJson(reply->readAll()).object();
    const QString networkError = reply->error() != QNetworkReply::NoError && status == 0 ? reply->errorString() : QString();
    delete reply;

    const QString token = json.value(u"access_token"_s).toString();
    if (status == 200 && !token.isEmpty()) {
        m_accessToken = token;
        const int expiresIn = json.value(u"expires_in"_s).toInt(3600);
        m_expiry = now.addSecs(expiresIn);
        const QString rotated = json.value(u"refresh_token"_s).toString();
        if (!rotated.isEmpty() && rotated != m_refreshToken) {
            m_refreshToken = rotated;
            QMetaObject::invokeMethod(this, [this, rotated]() {
                if (m_store) {
                    m_store->save(QString::fromLatin1(TokenStoreKey), rotated, [](bool, const QString &) { });
                }
            });
        }
        return m_accessToken;
    }

    m_accessToken.clear();
    const QString code = json.value(u"error"_s).toString();
    if (error) {
        if (!networkError.isEmpty()) {
            *error = i18n("Could not reach Google: %1", networkError);
        } else if (code == u"invalid_grant"_s) {
            *error = i18n("The Google sign-in has expired or was revoked. Sign in again.");
        } else {
            const QString description = json.value(u"error_description"_s).toString();
            *error = i18n("Google sign-in failed (%1).", description.isEmpty() ? (code.isEmpty() ? QString::number(status) : code) : description);
        }
    }
    if (code == u"invalid_grant"_s) {
        // The grant is gone for good; drop it so the UI asks to sign in again.
        lock.unlock();
        QMetaObject::invokeMethod(this, [this]() {
            signOut();
            setError(i18n("The Google sign-in has expired or was revoked. Sign in again."));
        });
    }
    return {};
}

GoogleDriveBackend::TokenProvider GoogleAuth::tokenProvider()
{
    return [this](bool forceRefresh, QString *error) {
        return accessToken(forceRefresh, error);
    };
}

} // namespace Sync
