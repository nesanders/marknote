// SPDX-FileCopyrightText: 2026 Marknote fork contributors
// SPDX-License-Identifier: GPL-2.0-only OR GPL-3.0-only OR LicenseRef-KDE-Accepted-GPL
//
// Google sign-in for a static site: the OAuth 2.0 flow for client-side web
// apps (redirect to Google, access token comes back in the URL fragment).
// No Google script is loaded and there is no server.
//
// Privacy: the OAuth client ID is NOT part of this code or the published site.
// Each user enters it on each device (or opens a setup link whose "#setup=…"
// fragment is never sent to the web server); it stays in this browser's
// localStorage. Access tokens live in sessionStorage and expire within an hour.

export const SCOPE = 'https://www.googleapis.com/auth/drive.file';
const AUTH_URL = 'https://accounts.google.com/o/oauth2/v2/auth';
const K = {
    clientId: 'marknote.clientId',
    hint: 'marknote.accountHint',
    token: 'marknote.token',
    state: 'marknote.oauthState',
    silentTried: 'marknote.silentTried',
};

function safe(fn, fallback = null) {
    try {
        return fn();
    } catch {
        return fallback;
    }
}

export function redirectUri() {
    // The app's own address, without index.html, query or fragment.
    return location.origin + location.pathname.replace(/index\.html$/, '');
}

export function clientId() {
    return safe(() => localStorage.getItem(K.clientId), '') ?? '';
}

export function setClientId(id) {
    const clean = (id ?? '').trim();
    safe(() => (clean ? localStorage.setItem(K.clientId, clean) : localStorage.removeItem(K.clientId)));
}

export function looksLikeClientId(id) {
    return /^[0-9]+-[a-z0-9]+\.apps\.googleusercontent\.com$/.test((id ?? '').trim());
}

export function accountHint() {
    return safe(() => localStorage.getItem(K.hint), '') ?? '';
}

export function setAccountHint(email) {
    safe(() => (email ? localStorage.setItem(K.hint, email) : localStorage.removeItem(K.hint)));
}

export function token() {
    const t = safe(() => JSON.parse(sessionStorage.getItem(K.token)));
    if (!t || Date.now() > t.expiresAt - 60000) return null;
    return t.value;
}

export function tokenExpiresAt() {
    return safe(() => JSON.parse(sessionStorage.getItem(K.token)))?.expiresAt ?? 0;
}

export function forgetToken() {
    safe(() => sessionStorage.removeItem(K.token));
}

/**
 * Handle a "#setup=<client id>" link or an OAuth redirect in the URL fragment.
 * Returns { setup: bool, signedIn: bool, error: string, returnTo: object|null }.
 */
export function handleRedirect() {
    const out = { setup: false, signedIn: false, error: '', returnTo: null };
    const hash = location.hash.startsWith('#') ? location.hash.slice(1) : '';
    if (!hash) return out;
    const params = new URLSearchParams(hash);
    const clean = () => history.replaceState(history.state, '', location.pathname + location.search);

    if (params.has('setup')) {
        const id = params.get('setup');
        if (looksLikeClientId(id)) {
            setClientId(id);
            out.setup = true;
        } else {
            out.error = 'The setup link does not contain a valid Google OAuth client ID.';
        }
        clean();
        return out;
    }
    if (!params.has('access_token') && !params.has('error')) return out;

    const saved = safe(() => JSON.parse(sessionStorage.getItem(K.state)));
    safe(() => sessionStorage.removeItem(K.state));
    clean();
    if (!saved || saved.state !== params.get('state')) {
        out.error = 'Sign-in was not started by this page. Please try again.';
        return out;
    }
    out.returnTo = saved.returnTo ?? null;
    if (params.has('error')) {
        const e = params.get('error');
        out.error = saved.silent && ['interaction_required', 'login_required', 'consent_required'].includes(e)
            ? '' // silent renewal not possible; the user signs in with a click
            : e === 'access_denied' ? 'Google sign-in was cancelled.' : `Google sign-in failed (${e}).`;
        out.silentFailed = saved.silent;
        return out;
    }
    const granted = (params.get('scope') ?? '').split(' ');
    if (!granted.includes(SCOPE)) {
        out.error = 'Marknote needs permission to see the files it creates in your Drive. Please allow it when signing in.';
        return out;
    }
    const expiresIn = Number(params.get('expires_in') ?? 3600);
    safe(() => sessionStorage.setItem(K.token, JSON.stringify({ value: params.get('access_token'), expiresAt: Date.now() + expiresIn * 1000 })));
    safe(() => sessionStorage.removeItem(K.silentTried));
    out.signedIn = true;
    return out;
}

/** Go to Google. silent: no UI if the user is already signed in to Google. */
export function signIn({ silent = false, returnTo = null } = {}) {
    const id = clientId();
    if (!id) throw new Error('No OAuth client ID set');
    const state = Array.from(crypto.getRandomValues(new Uint8Array(16)), (b) => b.toString(16).padStart(2, '0')).join('');
    safe(() => sessionStorage.setItem(K.state, JSON.stringify({ state, silent, returnTo })));
    if (silent) safe(() => sessionStorage.setItem(K.silentTried, '1'));
    const url = new URL(AUTH_URL);
    url.search = new URLSearchParams({
        client_id: id,
        redirect_uri: redirectUri(),
        response_type: 'token',
        scope: SCOPE,
        state,
        include_granted_scopes: 'true',
        ...(silent ? { prompt: 'none' } : {}),
        ...(accountHint() ? { login_hint: accountHint() } : {}),
    }).toString();
    location.assign(url.toString());
}

/** Try one silent renewal per browser session (avoids redirect loops). */
export function canTrySilent() {
    return !!clientId() && !!accountHint() && !safe(() => sessionStorage.getItem(K.silentTried));
}

export function signOut() {
    const t = token();
    forgetToken();
    setAccountHint('');
    if (t) {
        // Best effort: revoke the token so the grant is gone right away.
        fetch('https://oauth2.googleapis.com/revoke', {
            method: 'POST',
            mode: 'no-cors',
            headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
            body: new URLSearchParams({ token: t }),
        }).catch(() => {});
    }
}
