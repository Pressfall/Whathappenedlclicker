/**
 * Talking to Google from the worker, with nothing but fetch and WebCrypto (no SDK: the Firebase Admin SDK needs Node).
 *
 * - Firestore: the REST API (firestore.googleapis.com/v1), signed in as a service account. The worker makes a JWT with the
 *   service account's private key, trades it for an access token at oauth2.googleapis.com (cached for its hour), and
 *   commits writes in one atomic `documents:commit`. Service accounts are not subject to the Firestore security rules,
 *   which is why the rules can refuse every player write that would add Holy What Happeneds.
 * - Firebase sign-in: checks a player's ID token (a JWT signed by Google's securetoken service) against Google's
 *   published keys, so the claim page knows which account is asking.
 *
 * Everything that goes over the network uses the `fetch` passed in (tests pass a fake).
 */

const TOKEN_URL = 'https://oauth2.googleapis.com/token';
const SCOPE = 'https://www.googleapis.com/auth/datastore';
const JWK_URL = 'https://www.googleapis.com/service_accounts/v1/jwk/securetoken@system.gserviceaccount.com';
const FIRESTORE = 'https://firestore.googleapis.com/v1/';

const enc = new TextEncoder();
function b64url(bytes) {
    let s = '';
    const a = bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes);
    for (let i = 0; i < a.length; i++) s += String.fromCharCode(a[i]);
    return btoa(s).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}
function fromB64(text) {
    const s = atob(text);
    const out = new Uint8Array(s.length);
    for (let i = 0; i < s.length; i++) out[i] = s.charCodeAt(i);
    return out;
}
function fromB64url(text) {
    const t = String(text).replace(/-/g, '+').replace(/_/g, '/');
    return fromB64(t + '='.repeat((4 - (t.length % 4)) % 4));
}
const jsonPart = (obj) => b64url(enc.encode(JSON.stringify(obj)));

// ---------------- the service account's access token ----------------
let tokenCache = { id: '', token: '', exp: 0 };
export function resetTokenCache() { tokenCache = { id: '', token: '', exp: 0 }; }

function serviceAccount(env) {
    let sa;
    try { sa = JSON.parse(env.GCP_SERVICE_ACCOUNT || ''); } catch (e) { sa = null; }
    if (!sa || typeof sa.client_email !== 'string' || typeof sa.private_key !== 'string') throw new Error('GCP_SERVICE_ACCOUNT is missing or is not a service account key');
    return sa;
}
async function signRS256(input, pem) {
    const body = String(pem).replace(/-----[A-Z ]+-----/g, '').replace(/\s+/g, '');
    const key = await crypto.subtle.importKey('pkcs8', fromB64(body), { name: 'RSASSA-PKCS1-v1_5', hash: 'SHA-256' }, false, ['sign']);
    return b64url(await crypto.subtle.sign('RSASSA-PKCS1-v1_5', key, enc.encode(input)));
}
async function accessToken(env, f, nowMs) {
    const sa = serviceAccount(env);
    const id = sa.client_email + '|' + (sa.private_key_id || '');
    const now = Math.floor(nowMs / 1000);
    if (tokenCache.id === id && tokenCache.exp - 120 > now) return tokenCache.token;
    const head = jsonPart({ alg: 'RS256', typ: 'JWT', kid: sa.private_key_id });
    const claims = jsonPart({ iss: sa.client_email, sub: sa.client_email, aud: TOKEN_URL, scope: SCOPE, iat: now, exp: now + 3600 });
    const jwt = head + '.' + claims + '.' + (await signRS256(head + '.' + claims, sa.private_key));
    const res = await f(TOKEN_URL, {
        method: 'POST',
        headers: { 'content-type': 'application/x-www-form-urlencoded' },
        body: new URLSearchParams({ grant_type: 'urn:ietf:params:oauth:grant-type:jwt-bearer', assertion: jwt }).toString(),
    });
    if (!res.ok) throw new Error('Google refused the service account (' + res.status + ')');
    const data = await res.json();
    if (!data || typeof data.access_token !== 'string') throw new Error('no access token from Google');
    tokenCache = { id, token: data.access_token, exp: now + (Number(data.expires_in) || 3600) };
    return tokenCache.token;
}

// ---------------- Firestore values ----------------
export function toValue(v) {
    if (v === null || v === undefined) return { nullValue: null };
    if (typeof v === 'boolean') return { booleanValue: v };
    if (typeof v === 'number') return Number.isInteger(v) ? { integerValue: String(v) } : { doubleValue: v };
    if (typeof v === 'string') return { stringValue: v };
    if (Array.isArray(v)) return { arrayValue: { values: v.map(toValue) } };
    if (typeof v === 'object') return { mapValue: { fields: toFields(v) } };
    throw new Error('cannot store ' + typeof v);
}
export function toFields(obj) {
    const out = {};
    for (const k of Object.keys(obj)) if (obj[k] !== undefined) out[k] = toValue(obj[k]);
    return out;
}
export function fromValue(v) {
    if (!v || typeof v !== 'object') return null;
    if ('stringValue' in v) return v.stringValue;
    if ('integerValue' in v) return Number(v.integerValue);
    if ('doubleValue' in v) return Number(v.doubleValue);
    if ('booleanValue' in v) return !!v.booleanValue;
    if ('timestampValue' in v) return v.timestampValue;
    if ('nullValue' in v) return null;
    if ('arrayValue' in v) return ((v.arrayValue && v.arrayValue.values) || []).map(fromValue);
    if ('mapValue' in v) return fromFields((v.mapValue && v.mapValue.fields) || {});
    return null;
}
export function fromFields(fields) {
    const out = {};
    for (const k of Object.keys(fields || {})) out[k] = fromValue(fields[k]);
    return out;
}

// ---------------- the client ----------------
// env: GCP_SERVICE_ACCOUNT (the key file's JSON), FIREBASE_PROJECT_ID. deps: { fetch, now }
export function createFirestore(env, deps = {}) {
    const f = deps.fetch || fetch;
    const now = deps.now || Date.now;
    const project = env.FIREBASE_PROJECT_ID;
    if (!/^[a-z0-9-]{4,40}$/.test(project || '')) throw new Error('FIREBASE_PROJECT_ID is missing');
    const root = 'projects/' + project + '/databases/(default)/documents';
    const name = (path) => root + '/' + path;
    const auth = async () => ({ authorization: 'Bearer ' + (await accessToken(env, f, now())) });

    // { fields, updateTime } or null when there is no such document
    async function getDoc(path) {
        const res = await f(FIRESTORE + name(path), { headers: await auth() });
        if (res.status === 404) return null;
        if (!res.ok) throw new Error('Firestore read failed (' + res.status + ')');
        const d = await res.json();
        return { fields: fromFields(d.fields || {}), updateTime: d.updateTime || '' };
    }
    // All or nothing. { ok: true } or { ok: false, status, error } (a broken precondition is a refusal, not an exception)
    async function commit(writes) {
        const res = await f(FIRESTORE + root.replace(/\/documents$/, '/documents:commit'), {
            method: 'POST',
            headers: Object.assign({ 'content-type': 'application/json' }, await auth()),
            body: JSON.stringify({ writes }),
        });
        if (res.ok) return { ok: true };
        let error = '';
        try { const b = await res.json(); error = (b && b.error && (b.error.status || b.error.message)) || ''; } catch (e) {}
        return { ok: false, status: res.status, error };
    }
    const serverTime = (paths) => (paths || []).map((fieldPath) => ({ fieldPath, setToServerValue: 'REQUEST_TIME' }));
    // a new document; the commit fails if it already exists
    function create(path, fields, timeFields) {
        const w = { update: { name: name(path), fields: toFields(fields) }, currentDocument: { exists: false } };
        if (timeFields && timeFields.length) w.updateTransforms = serverTime(timeFields);
        return w;
    }
    // only the listed fields change (a listed field missing from `fields` is deleted); ifUpdateTime: only if nobody changed it since
    function patch(path, fields, mask, opts = {}) {
        const w = { update: { name: name(path), fields: toFields(fields) }, updateMask: { fieldPaths: mask } };
        if (opts.ifUpdateTime) w.currentDocument = { updateTime: opts.ifUpdateTime };
        if (opts.timeFields && opts.timeFields.length) w.updateTransforms = serverTime(opts.timeFields);
        return w;
    }
    // add to number fields, making the document if there is none
    function increment(path, add, timeFields) {
        const t = Object.keys(add).map((fieldPath) => ({ fieldPath, increment: { integerValue: String(add[fieldPath]) } }));
        return { update: { name: name(path), fields: {} }, updateMask: { fieldPaths: [] }, updateTransforms: t.concat(serverTime(timeFields)) };
    }
    return { getDoc, commit, create, patch, increment, name };
}

// ---------------- Firebase ID tokens ----------------
let jwkCache = { keys: null, exp: 0 };
export function resetJwkCache() { jwkCache = { keys: null, exp: 0 }; }
async function googleKeys(f, nowMs, force) {
    if (!force && jwkCache.keys && jwkCache.exp > nowMs) return jwkCache.keys;
    const res = await f(JWK_URL);
    if (!res.ok) throw new Error('could not fetch Google\'s sign-in keys');
    const data = await res.json();
    const age = /max-age=(\d+)/.exec(res.headers.get('cache-control') || '');
    jwkCache = { keys: (data && data.keys) || [], exp: nowMs + (age ? Number(age[1]) * 1000 : 3600000) };
    return jwkCache.keys;
}
// The signed-in player behind an ID token: { uid, provider }, or throws.
export async function verifyIdToken(token, projectId, deps = {}) {
    const f = deps.fetch || fetch;
    const nowMs = (deps.now || Date.now)();
    const parts = String(token || '').split('.');
    if (parts.length !== 3) throw new Error('not a token');
    let head, claims;
    try { head = JSON.parse(new TextDecoder().decode(fromB64url(parts[0]))); claims = JSON.parse(new TextDecoder().decode(fromB64url(parts[1]))); }
    catch (e) { throw new Error('not a token'); }
    if (head.alg !== 'RS256' || typeof head.kid !== 'string') throw new Error('wrong algorithm');
    let keys = await googleKeys(f, nowMs, false);
    let jwk = keys.find((k) => k.kid === head.kid);
    if (!jwk) { keys = await googleKeys(f, nowMs, true); jwk = keys.find((k) => k.kid === head.kid); }
    if (!jwk) throw new Error('unknown key');
    const key = await crypto.subtle.importKey('jwk', { kty: jwk.kty, n: jwk.n, e: jwk.e }, { name: 'RSASSA-PKCS1-v1_5', hash: 'SHA-256' }, false, ['verify']);
    const ok = await crypto.subtle.verify('RSASSA-PKCS1-v1_5', key, fromB64url(parts[2]), enc.encode(parts[0] + '.' + parts[1]));
    if (!ok) throw new Error('bad signature');
    const now = Math.floor(nowMs / 1000), skew = 300;
    if (claims.aud !== projectId || claims.iss !== 'https://securetoken.google.com/' + projectId) throw new Error('wrong project');
    if (!(claims.exp > now) || !(claims.iat <= now + skew) || (claims.auth_time !== undefined && !(claims.auth_time <= now + skew))) throw new Error('expired');
    if (typeof claims.sub !== 'string' || !claims.sub || claims.sub.length > 128) throw new Error('no user');
    return { uid: claims.sub, provider: (claims.firebase && claims.firebase.sign_in_provider) || '' };
}

export const _internal = { b64url, fromB64url, signRS256 };
