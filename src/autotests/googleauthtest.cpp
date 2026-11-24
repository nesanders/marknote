// SPDX-FileCopyrightText: 2026 Marknote fork contributors
// SPDX-License-Identifier: GPL-2.0-or-later

// Drives GoogleAuth through the real OAuth code flow (loopback redirect, PKCE,
// token exchange, refresh) against a local fake of Google's endpoints. The
// "browser" is a QNetworkAccessManager that follows the consent redirect.

#include "../sync/googleauth.h"
#include "../sync/tokenstore.h"

#include <QCryptographicHash>
#include <QHttpServer>
#include <QHttpServerRequest>
#include <QHttpServerResponse>
#include <QJsonDocument>
#include <QJsonObject>
#include <QNetworkAccessManager>
#include <QNetworkReply>
#include <QSignalSpy>
#include <QTcpServer>
#include <QTemporaryDir>
#include <QThread>
#include <QUrlQuery>
#include <QtTest/QtTest>

using namespace Qt::Literals::StringLiterals;
using namespace Sync;

class FakeGoogle
{
public:
    QHttpServer server;
    QTcpServer *tcp = new QTcpServer;

    QString consentError;       ///< non-empty: the user "denies" consent
    bool revoked = false;       ///< refresh token no longer valid
    QString challenge;          ///< PKCE challenge seen at /auth
    bool pkceVerified = false;
    QUrlQuery lastAuthQuery;
    int refreshCount = 0;

    FakeGoogle()
    {
        using Method = QHttpServerRequest::Method;
        server.route(u"/auth"_s, Method::Get, [this](const QHttpServerRequest &r) {
            lastAuthQuery = QUrlQuery(r.url());
            challenge = lastAuthQuery.queryItemValue(u"code_challenge"_s);
            QUrl redirect(lastAuthQuery.queryItemValue(u"redirect_uri"_s, QUrl::FullyDecoded));
            QUrlQuery back;
            if (consentError.isEmpty()) {
                back.addQueryItem(u"code"_s, u"CODE1"_s);
            } else {
                back.addQueryItem(u"error"_s, consentError);
                back.addQueryItem(u"error_description"_s, u"The user denied access"_s);
            }
            back.addQueryItem(u"state"_s, lastAuthQuery.queryItemValue(u"state"_s, QUrl::FullyDecoded));
            redirect.setQuery(back);
            QHttpServerResponse response(QHttpServerResponse::StatusCode::Found);
            QHttpHeaders headers;
            headers.append(QHttpHeaders::WellKnownHeader::Location, redirect.toString(QUrl::FullyEncoded).toUtf8());
            response.setHeaders(std::move(headers));
            return response;
        });
        server.route(u"/token"_s, Method::Post, [this](const QHttpServerRequest &r) {
            const QUrlQuery form(QString::fromUtf8(r.body()));
            const QString grant = form.queryItemValue(u"grant_type"_s);
            if (form.queryItemValue(u"client_id"_s) != u"test-client"_s) {
                return error(u"invalid_client"_s);
            }
            if (grant == u"authorization_code"_s) {
                const QByteArray verifier = form.queryItemValue(u"code_verifier"_s).toUtf8();
                const QByteArray expected = QCryptographicHash::hash(verifier, QCryptographicHash::Sha256)
                                                .toBase64(QByteArray::Base64UrlEncoding | QByteArray::OmitTrailingEquals);
                pkceVerified = !verifier.isEmpty() && QString::fromLatin1(expected) == challenge;
                if (form.queryItemValue(u"code"_s) != u"CODE1"_s || !pkceVerified) {
                    return error(u"invalid_grant"_s);
                }
                return QHttpServerResponse(QJsonObject{
                    {u"access_token"_s, u"at1"_s},
                    {u"refresh_token"_s, u"rt1"_s},
                    {u"expires_in"_s, 3600},
                    {u"token_type"_s, u"Bearer"_s},
                });
            }
            if (grant == u"refresh_token"_s) {
                ++refreshCount;
                if (revoked || form.queryItemValue(u"refresh_token"_s) != u"rt1"_s) {
                    return error(u"invalid_grant"_s);
                }
                return QHttpServerResponse(QJsonObject{
                    {u"access_token"_s, u"at%1"_s.arg(refreshCount + 1)},
                    {u"expires_in"_s, 3600},
                    {u"token_type"_s, u"Bearer"_s},
                });
            }
            return error(u"unsupported_grant_type"_s);
        });
        server.route(u"/drive/v3/about"_s, Method::Get, [](const QHttpServerRequest &r) {
            if (r.value("Authorization") != "Bearer at1") {
                return QHttpServerResponse(QHttpServerResponse::StatusCode::Unauthorized);
            }
            return QHttpServerResponse(QJsonObject{{u"user"_s, QJsonObject{{u"emailAddress"_s, u"me@example.com"_s}}}});
        });
    }

    static QHttpServerResponse error(const QString &code)
    {
        return QHttpServerResponse(QJsonObject{{u"error"_s, code}}, QHttpServerResponse::StatusCode::BadRequest);
    }

    bool start()
    {
        return tcp->listen(QHostAddress::LocalHost) && server.bind(tcp);
    }

    QString base() const
    {
        return u"http://127.0.0.1:%1"_s.arg(tcp->serverPort());
    }
};

class GoogleAuthTest : public QObject
{
    Q_OBJECT

    QTemporaryDir m_tmp;
    std::unique_ptr<FakeGoogle> m_google;
    QNetworkAccessManager m_browser;

    std::unique_ptr<GoogleAuth> makeAuth()
    {
        auto auth = std::make_unique<GoogleAuth>(std::make_unique<FileTokenStore>(m_tmp.path()));
        GoogleAuth::Endpoints endpoints;
        endpoints.authorization = QUrl(m_google->base() + u"/auth"_s);
        endpoints.token = QUrl(m_google->base() + u"/token"_s);
        endpoints.apiBase = m_google->base();
        auth->setEndpoints(endpoints);
        auth->setClientCredentials(u"test-client"_s, u"test-secret"_s);
        auth->setBrowserOpener([this](const QUrl &url) {
            // The "user" approves: follow the redirect back to the loopback listener.
            QNetworkReply *reply = m_browser.get(QNetworkRequest(url));
            connect(reply, &QNetworkReply::finished, reply, &QObject::deleteLater);
        });
        return auth;
    }

    /// accessToken() from a worker thread while this thread keeps serving.
    static QString tokenFromWorker(GoogleAuth *auth, bool force, QString *error)
    {
        QString token;
        QThread *thread = QThread::create([&]() {
            token = auth->accessToken(force, error);
        });
        thread->start();
        if (!QTest::qWaitFor([thread]() {
                return thread->isFinished();
            }, 10000)) {
            qFatal("worker did not finish");
        }
        delete thread;
        return token;
    }

    QString storedToken() const
    {
        QFile f(m_tmp.filePath(QString::fromLatin1(GoogleAuth::TokenStoreKey)));
        return f.open(QFile::ReadOnly) ? QString::fromUtf8(f.readAll()) : QString();
    }

private Q_SLOTS:
    void init()
    {
        QVERIFY(m_tmp.isValid());
        QFile::remove(m_tmp.filePath(QString::fromLatin1(GoogleAuth::TokenStoreKey)));
        m_google = std::make_unique<FakeGoogle>();
        QVERIFY(m_google->start());
    }

    void testNotConfigured()
    {
        GoogleAuth auth(std::make_unique<FileTokenStore>(m_tmp.path()));
        QVERIFY(!auth.configured());
        auth.signIn();
        QVERIFY(!auth.busy());
        QVERIFY(!auth.lastError().isEmpty());
    }

    void testSignInFlow()
    {
        auto auth = makeAuth();
        QVERIFY(auth->configured());
        QVERIFY(!auth->signedIn());

        auth->signIn();
        QVERIFY(auth->busy());
        QTRY_VERIFY_WITH_TIMEOUT(auth->signedIn(), 10000);
        QVERIFY2(auth->lastError().isEmpty(), qPrintable(auth->lastError()));
        QVERIFY(!auth->busy());

        // What we asked Google for.
        const QUrlQuery &q = m_google->lastAuthQuery;
        QCOMPARE(q.queryItemValue(u"response_type"_s), u"code"_s);
        QCOMPARE(q.queryItemValue(u"client_id"_s), u"test-client"_s);
        QCOMPARE(q.queryItemValue(u"scope"_s, QUrl::FullyDecoded), QString::fromLatin1(GoogleAuth::DriveFileScope));
        QCOMPARE(q.queryItemValue(u"access_type"_s), u"offline"_s);
        QCOMPARE(q.queryItemValue(u"code_challenge_method"_s), u"S256"_s);
        QVERIFY(q.queryItemValue(u"redirect_uri"_s, QUrl::FullyDecoded).startsWith(u"http://127.0.0.1:"_s));
        QVERIFY(m_google->pkceVerified);

        QTRY_COMPARE(auth->account(), u"me@example.com"_s);
        QTRY_COMPARE(storedToken(), u"rt1"_s);

        // The access token from the code exchange is used until it expires.
        QString error;
        QCOMPARE(tokenFromWorker(auth.get(), false, &error), u"at1"_s);
        QCOMPARE(m_google->refreshCount, 0);
    }

    void testRestoreAndRefreshFromWorker()
    {
        {
            FileTokenStore store(m_tmp.path());
            store.save(QString::fromLatin1(GoogleAuth::TokenStoreKey), u"rt1"_s, [](bool ok, const QString &) {
                QVERIFY(ok);
            });
        }
        auto auth = makeAuth();
        QSignalSpy restored(auth.get(), &GoogleAuth::restored);
        auth->restore();
        QTRY_COMPARE(restored.count(), 1);
        QVERIFY(auth->signedIn());

        QString error;
        QCOMPARE(tokenFromWorker(auth.get(), false, &error), u"at2"_s);
        QCOMPARE(m_google->refreshCount, 1);
        // Cached now…
        QCOMPARE(tokenFromWorker(auth.get(), false, &error), u"at2"_s);
        QCOMPARE(m_google->refreshCount, 1);
        // …unless the API said 401.
        QCOMPARE(tokenFromWorker(auth.get(), true, &error), u"at3"_s);
        QCOMPARE(m_google->refreshCount, 2);
    }

    void testRevokedGrantSignsOut()
    {
        {
            FileTokenStore store(m_tmp.path());
            store.save(QString::fromLatin1(GoogleAuth::TokenStoreKey), u"rt1"_s, [](bool, const QString &) { });
        }
        auto auth = makeAuth();
        auth->restore();
        QTRY_VERIFY(auth->signedIn());

        m_google->revoked = true;
        QString error;
        QVERIFY(tokenFromWorker(auth.get(), true, &error).isEmpty());
        QVERIFY(error.contains(u"Sign in again"_s));
        QTRY_VERIFY(!auth->signedIn());
        QVERIFY(!auth->lastError().isEmpty());
        QVERIFY(storedToken().isEmpty());
    }

    void testConsentDenied()
    {
        m_google->consentError = u"access_denied"_s;
        auto auth = makeAuth();
        auth->signIn();
        QTRY_VERIFY_WITH_TIMEOUT(!auth->busy(), 10000);
        QVERIFY(!auth->signedIn());
        QVERIFY(!auth->lastError().isEmpty());
        QVERIFY(storedToken().isEmpty());
    }

    void testSignOutForgetsToken()
    {
        auto auth = makeAuth();
        auth->signIn();
        QTRY_VERIFY_WITH_TIMEOUT(auth->signedIn(), 10000);
        QTRY_COMPARE(storedToken(), u"rt1"_s);
        auth->signOut();
        QVERIFY(!auth->signedIn());
        QVERIFY(auth->account().isEmpty());
        QVERIFY(storedToken().isEmpty());
        QString error;
        QVERIFY(tokenFromWorker(auth.get(), false, &error).isEmpty());
        QVERIFY(!error.isEmpty());
    }
};

QTEST_GUILESS_MAIN(GoogleAuthTest)
#include "googleauthtest.moc"
