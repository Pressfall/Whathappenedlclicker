'use strict';
// The Ko-fi webhook worker (kofi-worker/src/index.js) end to end, against a fake Ko-fi and a fake Google:
// - fake Ko-fi: payloads posted the way Ko-fi posts them (form field `data` holding JSON), built from the example in
//   Ko-fi's help article "Does Ko-fi have an API or webhook?"
// - fake Google: the OAuth token endpoint (checks the service account's signed JWT), Firestore's REST API (documents,
//   atomic commits with preconditions, increments and server times, one-field queries), Firebase Authentication's account
//   lookups, and the sign-in keys for Firebase ID tokens.
const test = require('node:test');
const assert = require('node:assert/strict');
const { webcrypto } = require('node:crypto');
const path = require('path');
const { pathToFileURL } = require('url');

const ROOT = path.resolve(__dirname, '..');
const RealConfig = require('../core/premium-config.js');
const Kofi = require('../core/kofi.js');
const subtle = webcrypto.subtle;

const PROJECT = 'whleaderboard';
const TOKEN = 'kofi-secret-verification-token';
const ORIGIN = 'https://game.example';

let worker, google;
const load = async () => {
    if (!worker) {
        worker = await import(pathToFileURL(path.join(ROOT, 'kofi-worker/src/index.js')).href);
        google = await import(pathToFileURL(path.join(ROOT, 'kofi-worker/src/google.js')).href);
    }
};

// ---------------- keys ----------------
const b64url = (buf) => Buffer.from(buf).toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
async function rsaPair() {
    return subtle.generateKey({ name: 'RSASSA-PKCS1-v1_5', modulusLength: 2048, publicExponent: new Uint8Array([1, 0, 1]), hash: 'SHA-256' }, true, ['sign', 'verify']);
}
let keys = null;
async function getKeys() {
    if (keys) return keys;
    const sa = await rsaPair(), fb = await rsaPair();
    const pkcs8 = Buffer.from(await subtle.exportKey('pkcs8', sa.privateKey)).toString('base64');
    const pem = '-----BEGIN PRIVATE KEY-----\n' + pkcs8.match(/.{1,64}/g).join('\n') + '\n-----END PRIVATE KEY-----\n';
    const fbJwk = await subtle.exportKey('jwk', fb.publicKey);
    keys = { sa, fb, pem, fbJwk: Object.assign({ kid: 'fbkey1', alg: 'RS256', use: 'sig' }, fbJwk) };
    return keys;
}
async function idToken(claims, opts = {}) {
    const k = await getKeys();
    const now = Math.floor(Date.now() / 1000);
    const head = b64url(Buffer.from(JSON.stringify({ alg: 'RS256', kid: opts.kid || 'fbkey1', typ: 'JWT' })));
    const body = b64url(Buffer.from(JSON.stringify(Object.assign({
        aud: PROJECT, iss: 'https://securetoken.google.com/' + PROJECT, iat: now - 10, exp: now + 3000, auth_time: now - 100,
        firebase: { sign_in_provider: 'password' },
    }, claims))));
    const signer = opts.badSigner ? (await rsaPair()).privateKey : k.fb.privateKey;
    const sig = b64url(await subtle.sign('RSASSA-PKCS1-v1_5', signer, Buffer.from(head + '.' + body)));
    return head + '.' + body + '.' + sig;
}

// ---------------- fake Google ----------------
function fakeGoogle(k) {
    const docs = new Map(); // full name -> { fields, updateTime }
    let clock = 1;
    const calls = { token: 0, commits: 0, reads: 0, queries: 0, lookups: 0 };
    const fail = { commit: false, auth: false };
    // Firebase Authentication's accounts: uid -> { email, emailVerified, disabled, providers }
    const accounts = new Map();
    const root = 'projects/' + PROJECT + '/databases/(default)/documents/';
    const res = (status, body, headers) => new Response(body === undefined ? null : JSON.stringify(body), { status, headers: Object.assign({ 'content-type': 'application/json' }, headers || {}) });
    async function checkAssertion(jwt) {
        const [h, p, s] = jwt.split('.');
        const pub = await subtle.exportKey('jwk', k.sa.publicKey);
        const key = await subtle.importKey('jwk', pub, { name: 'RSASSA-PKCS1-v1_5', hash: 'SHA-256' }, false, ['verify']);
        const ok = await subtle.verify('RSASSA-PKCS1-v1_5', key, Buffer.from(s.replace(/-/g, '+').replace(/_/g, '/'), 'base64'), Buffer.from(h + '.' + p));
        const claims = JSON.parse(Buffer.from(p.replace(/-/g, '+').replace(/_/g, '/'), 'base64').toString());
        return ok && claims.iss === 'worker@whleaderboard.iam.gserviceaccount.com' && claims.aud === 'https://oauth2.googleapis.com/token'
            && claims.scope === 'https://www.googleapis.com/auth/datastore https://www.googleapis.com/auth/identitytoolkit' && claims.exp > claims.iat;
    }
    function applyTransforms(fields, transforms) {
        for (const t of transforms || []) {
            if (t.setToServerValue === 'REQUEST_TIME') fields[t.fieldPath] = { timestampValue: '2026-11-09T12:00:00Z' };
            else if (t.increment) fields[t.fieldPath] = { integerValue: String(Number((fields[t.fieldPath] || {}).integerValue || 0) + Number(t.increment.integerValue)) };
            else throw new Error('unknown transform');
        }
    }
    async function fetchFake(url, init = {}) {
        url = String(url);
        const method = (init.method || 'GET').toUpperCase();
        if (url === 'https://oauth2.googleapis.com/token') {
            calls.token++;
            const form = new URLSearchParams(init.body);
            assert.equal(form.get('grant_type'), 'urn:ietf:params:oauth:grant-type:jwt-bearer');
            if (!(await checkAssertion(form.get('assertion')))) return res(400, { error: 'invalid_grant' });
            return res(200, { access_token: 'ya29.fake', expires_in: 3600, token_type: 'Bearer' });
        }
        if (url.startsWith('https://www.googleapis.com/service_accounts/v1/jwk/')) return res(200, { keys: [k.fbJwk] }, { 'cache-control': 'public, max-age=3600' });
        if (url === 'https://identitytoolkit.googleapis.com/v1/projects/' + PROJECT + '/accounts:lookup') {
            // what the Admin SDK's getUserByEmail / getUser ask; 403 without the "Firebase Authentication Viewer" role
            calls.lookups++;
            assert.equal((init.headers || {}).authorization, 'Bearer ya29.fake');
            if (fail.auth) return res(403, { error: { code: 403, status: 'PERMISSION_DENIED' } });
            const by = JSON.parse(init.body);
            const users = [];
            for (const [uid, a] of accounts) {
                if ((by.email && by.email.includes(String(a.email || '').toLowerCase())) || (by.localId && by.localId.includes(uid)))
                    users.push({ localId: uid, email: a.email, emailVerified: !!a.emailVerified, disabled: !!a.disabled,
                        providerUserInfo: (a.providers || ['google.com']).map((providerId) => ({ providerId, email: a.email })) });
            }
            return res(200, users.length ? { kind: 'identitytoolkit#GetAccountInfoResponse', users } : { kind: 'identitytoolkit#GetAccountInfoResponse' });
        }
        if (!url.startsWith('https://firestore.googleapis.com/v1/')) throw new Error('unexpected fetch ' + url);
        assert.equal((init.headers || {}).authorization, 'Bearer ya29.fake', 'Firestore calls carry the access token');
        const name = url.slice('https://firestore.googleapis.com/v1/'.length);
        if (method === 'GET') {
            calls.reads++;
            const d = docs.get(name);
            return d ? res(200, { name, fields: d.fields, updateTime: d.updateTime }) : res(404, { error: { status: 'NOT_FOUND' } });
        }
        if (method === 'POST' && name.endsWith('/documents:commit')) {
            calls.commits++;
            if (fail.commit) return res(503, { error: { status: 'UNAVAILABLE' } });
            const { writes } = JSON.parse(init.body);
            const next = new Map(docs);
            for (const w of writes) {
                const n = w.update.name, cur = next.get(n);
                const pre = w.currentDocument || {};
                if (pre.exists === false && cur) return res(409, { error: { status: 'ALREADY_EXISTS' } });
                if (pre.exists === true && !cur) return res(404, { error: { status: 'NOT_FOUND' } });
                if (pre.updateTime && (!cur || cur.updateTime !== pre.updateTime)) return res(400, { error: { status: 'FAILED_PRECONDITION' } });
                let fields;
                if (w.updateMask) {
                    fields = Object.assign({}, cur ? cur.fields : {});
                    for (const p of w.updateMask.fieldPaths) { if (p in w.update.fields) fields[p] = w.update.fields[p]; else delete fields[p]; }
                } else fields = Object.assign({}, w.update.fields);
                applyTransforms(fields, w.updateTransforms);
                next.set(n, { fields, updateTime: 't' + (clock++) });
            }
            docs.clear();
            for (const [a, b] of next) docs.set(a, b);
            return res(200, { writeResults: writes.map(() => ({})) });
        }
        if (method === 'POST' && name.endsWith('/documents:runQuery')) {
            // what the worker asks: one collection, one equality filter, a limit
            calls.queries++;
            const q = JSON.parse(init.body).structuredQuery;
            assert.equal(q.from.length, 1);
            const f = q.where.fieldFilter;
            assert.equal(f.op, 'EQUAL');
            const col = root + q.from[0].collectionId + '/', want = JSON.stringify(f.value);
            const out = [];
            for (const [n, d] of docs) {
                if (!n.startsWith(col) || n.slice(col.length).includes('/')) continue;
                if (JSON.stringify(d.fields[f.field.fieldPath]) === want) out.push({ document: { name: n, fields: d.fields, updateTime: d.updateTime }, readTime: 'x' });
                if (q.limit && out.length >= q.limit) break;
            }
            return res(200, out.length ? out : [{ readTime: 'x' }]); // Firestore's answer when nothing matches
        }
        throw new Error('unexpected ' + method + ' ' + url);
    }
    const plain = (n) => { const d = docs.get(root + n); return d ? google.fromFields(d.fields) : null; };
    const put = (n, obj) => docs.set(root + n, { fields: google.toFields(obj), updateTime: 't' + (clock++) });
    return { fetch: fetchFake, docs, calls, fail, plain, put, accounts };
}

// ---------------- fake Ko-fi ----------------
// The example from Ko-fi's help article, as a function of what changes
function payload(over) {
    return Object.assign({
        verification_token: TOKEN,
        message_id: '2defe7b3-a0a9-4495-991c-ad08cd0dc51d',
        timestamp: '2024-01-25T15:22:49Z',
        type: 'Donation',
        is_public: true,
        from_name: 'Jo Example',
        message: 'Good luck with the integration!',
        amount: '3.00',
        url: 'https://ko-fi.com/Home/CoffeeShop?txid=00000000-1111-2222-3333-444444444444',
        email: 'jo.example@example.com',
        currency: 'USD',
        is_subscription_payment: false,
        is_first_subscription_payment: false,
        kofi_transaction_id: '00000000-1111-2222-3333-444444444444',
        shop_items: null,
        tier_name: null,
        shipping: null,
    }, over);
}
// Ko-fi's way: application/x-www-form-urlencoded, the JSON in `data`
function kofiPost(p, url) {
    return new Request(url || 'https://wh-kofi.example.workers.dev/kofi', {
        method: 'POST',
        headers: { 'content-type': 'application/x-www-form-urlencoded' },
        body: new URLSearchParams({ data: typeof p === 'string' ? p : JSON.stringify(p) }).toString(),
    });
}

// a config with shop packs and a flat tip rate (no tip packs), for the tests of those; the tip packs have their own test
// against the real config further down
const CFG = Object.assign({}, RealConfig, {
    packs: [{ code: 'beanpouch1', beans: 120, name: 'Pouch', price: '$1' }, { code: 'beansack9', beans: 1000, name: 'Sack', price: '$8' }],
    tipPacks: [],
    donationRate: { USD: 100 },
    subscriptionTiers: { 'Bean Club': 300 },
    maxBeansPerPayment: 5000,
});

async function setup(envOver) {
    await load();
    google.resetTokenCache(); google.resetJwkCache();
    const k = await getKeys();
    const g = fakeGoogle(k);
    const env = Object.assign({
        KOFI_VERIFICATION_TOKEN: TOKEN,
        GCP_SERVICE_ACCOUNT: JSON.stringify({ type: 'service_account', client_email: 'worker@whleaderboard.iam.gserviceaccount.com', private_key_id: 'k1', private_key: k.pem }),
        EMAIL_PEPPER: 'pepper-for-tests', ADMIN_TOKEN: 'admin-secret', FIREBASE_PROJECT_ID: PROJECT, ALLOWED_ORIGINS: ORIGIN,
    }, envOver);
    const call = (req, cfg) => worker.handle(req, env, { fetch: g.fetch, config: cfg || CFG });
    // a player who opened Get more while signed in: their link doc exists
    const linkFor = async (uid) => { const id = await Kofi.linkIdForUid(uid, subtle); g.put('kofi_links/' + id, { uid, at: 'x' }); return Kofi.formatLinkCode(id); };
    return { g, env, call, linkFor };
}
const body = async (r) => JSON.parse(await r.text());
const TX = (n) => 'aaaaaaaa-0000-4000-8000-' + String(n).padStart(12, '0');

test('a shop order with the player\'s link code credits their wallet once, and keeps no name, email or message', async () => {
    const { g, call, linkFor } = await setup();
    const code = await linkFor('uid_alice');
    const p = payload({ type: 'Shop Order', kofi_transaction_id: TX(1), amount: '9.00', message: 'for my game ' + code + ' thanks!',
        shop_items: [{ direct_link_code: 'beanpouch1', variation_name: '', quantity: 2 }, { direct_link_code: 'beansack9', quantity: 1 }, { direct_link_code: 'tshirt', quantity: 1 }] });
    const r = await call(kofiPost(p));
    assert.equal(r.status, 200);
    assert.deepEqual(await body(r), { ok: true, beans: 1240, matched: true });
    const w = g.plain('wallets/uid_alice');
    assert.equal(w.balance, 1240);
    assert.equal(w.total, 1240);
    const pay = g.plain('kofi_payments/' + TX(1));
    assert.equal(pay.status, 'credited');
    assert.equal(pay.uid, 'uid_alice');
    assert.equal(pay.beans, 1240);
    assert.deepEqual(pay.items, [{ code: 'beanpouch1', qty: 2, beans: 240 }, { code: 'beansack9', qty: 1, beans: 1000 }]);
    const stored = JSON.stringify([...g.docs.values()]);
    for (const secret of ['Jo Example', 'jo.example@example.com', 'thanks', TOKEN]) assert.ok(!stored.includes(secret), 'not stored: ' + secret);
    assert.equal(g.plain('wallets/uid_alice/credits/' + TX(1)).beans, 1240);
});

test('the same payment delivered again (Ko-fi retries until it sees a 200) is not credited twice', async () => {
    const { g, call, linkFor } = await setup();
    const code = await linkFor('uid_bob');
    const p = payload({ type: 'Shop Order', kofi_transaction_id: TX(2), message: code, shop_items: [{ direct_link_code: 'beanpouch1', quantity: 1 }] });
    assert.equal((await call(kofiPost(p))).status, 200);
    const again = await call(kofiPost(Object.assign({}, p, { message_id: 'a-new-message-id' })));
    assert.equal(again.status, 200);
    assert.deepEqual(await body(again), { ok: true, duplicate: true });
    assert.equal(g.plain('wallets/uid_bob').balance, 120);
    // two deliveries at the same moment: still once
    const p2 = Object.assign({}, p, { kofi_transaction_id: TX(3) });
    const both = await Promise.all([call(kofiPost(p2)), call(kofiPost(p2))]);
    assert.deepEqual(both.map((x) => x.status), [200, 200]);
    assert.equal(g.plain('wallets/uid_bob').balance, 240);
});

test('a wrong verification token is refused and nothing is written', async () => {
    const { g, call, linkFor } = await setup();
    const code = await linkFor('uid_carol');
    const r = await call(kofiPost(payload({ verification_token: 'guessed', type: 'Shop Order', kofi_transaction_id: TX(4), message: code, shop_items: [{ direct_link_code: 'beansack9', quantity: 1 }] })));
    assert.equal(r.status, 401);
    const missing = await call(kofiPost(payload({ verification_token: undefined, type: 'Donation', kofi_transaction_id: TX(5), message: code })));
    assert.equal(missing.status, 401);
    assert.equal(g.calls.commits, 0);
    assert.equal(g.plain('wallets/uid_carol'), null);
});

test('without the token secret set the worker answers 500 (so Ko-fi retries later) and writes nothing', async () => {
    const { g, call } = await setup({ KOFI_VERIFICATION_TOKEN: '' });
    const r = await call(kofiPost(payload({ kofi_transaction_id: TX(6) })));
    assert.equal(r.status, 500);
    assert.equal(g.calls.commits, 0);
});

test('bad bodies: not JSON, no data, no transaction id, wrong method', async () => {
    const { call } = await setup();
    assert.equal((await call(kofiPost('{not json'))).status, 400);
    assert.equal((await call(new Request('https://w.example/kofi', { method: 'POST', headers: { 'content-type': 'application/x-www-form-urlencoded' }, body: '' }))).status, 400);
    assert.equal((await call(kofiPost(payload({ kofi_transaction_id: '' })))).status, 400);
    assert.equal((await call(new Request('https://w.example/kofi'))).status, 405);
    assert.equal((await call(new Request('https://w.example/'))).status, 200);
});

test('Ko-fi\'s test payment (the example transaction id) is answered 200 and credits nothing', async () => {
    const { g, call, linkFor } = await setup();
    const code = await linkFor('uid_dan');
    const r = await call(kofiPost(payload({ message: code })));
    assert.equal(r.status, 200);
    assert.deepEqual(await body(r), { ok: true, test: true });
    assert.equal(g.calls.commits, 0);
});

test('tips: no Holy What Happeneds and nothing stored unless the owner set a rate; with a rate, amount x rate', async () => {
    const { g, call, linkFor } = await setup();
    const code = await linkFor('uid_erin');
    const noRate = await call(kofiPost(payload({ kofi_transaction_id: TX(7), message: code })), Object.assign({}, CFG, { donationRate: {} }));
    assert.deepEqual(await body(noRate), { ok: true, ignored: 'tip' });
    assert.equal(g.calls.commits, 0);
    const other = await call(kofiPost(payload({ kofi_transaction_id: TX(8), message: code, currency: 'JPY', amount: '500' })));
    assert.deepEqual(await body(other), { ok: true, ignored: 'tip' });
    const r = await call(kofiPost(payload({ kofi_transaction_id: TX(9), message: 'hi ' + code.toLowerCase().replace(/-/g, ' '), amount: '3.50' })));
    assert.equal(r.status, 200);
    assert.equal(g.plain('wallets/uid_erin').balance, 350);
});

test('memberships pay by tier name; other monthly payments pay by amount like a tip; commissions pay nothing', async () => {
    const { g, call, linkFor } = await setup();
    const code = await linkFor('uid_fay');
    await call(kofiPost(payload({ type: 'Subscription', is_subscription_payment: true, tier_name: 'Bean Club', kofi_transaction_id: TX(10), message: code })));
    assert.equal(g.plain('wallets/uid_fay').balance, 300);
    // a tier with no price set pays by its amount at the flat rate ($3 x 100 here) instead of nothing
    const other = await call(kofiPost(payload({ type: 'Subscription', tier_name: 'Other Tier', kofi_transaction_id: TX(11), message: code })));
    assert.equal((await body(other)).beans, 300);
    assert.equal(g.plain('wallets/uid_fay').balance, 600);
    const comm = await call(kofiPost(payload({ type: 'Commission', kofi_transaction_id: TX(12), message: code })));
    assert.deepEqual(await body(comm), { ok: true, ignored: 'not-a-sale' });
    // with nothing that prices it (no tier, no rate in its currency) a monthly payment still credits nothing
    const unpriced = await call(kofiPost(payload({ type: 'Subscription', tier_name: null, kofi_transaction_id: TX(13), message: code, currency: 'JPY', amount: '500' })));
    assert.deepEqual(await body(unpriced), { ok: true, ignored: 'no-tier' });
    assert.equal(g.plain('wallets/uid_fay').balance, 600);
});

test('a monthly tip (the tip box\'s "Make it monthly": a Subscription with no tier) pays the tip pack every month, also when a renewal has no message', async () => {
    const { g, call, linkFor } = await setup();
    const code = await linkFor('uid_mo');
    const first = await call(kofiPost(payload({ type: 'Subscription', is_subscription_payment: true, is_first_subscription_payment: true, tier_name: null,
        kofi_transaction_id: TX(14), amount: '5.00', currency: 'USD', message: code })), RealConfig);
    assert.equal(first.status, 200);
    assert.deepEqual(await body(first), { ok: true, beans: 550, matched: true });
    assert.equal(g.plain('wallets/uid_mo').balance, 550);
    assert.equal(g.plain('kofi_payments/' + TX(14)).items[0].code, 'monthly');
    // next month's payment, with no message: kept for its payer to collect or claim, never lost
    const renewal = await call(kofiPost(payload({ type: 'Subscription', is_subscription_payment: true, is_first_subscription_payment: false, tier_name: null,
        kofi_transaction_id: TX(15), amount: '5.00', currency: 'USD', message: null, email: 'mo@example.com' })), RealConfig);
    assert.deepEqual(await body(renewal), { ok: true, beans: 550, matched: false });
    assert.equal(g.plain('kofi_payments/' + TX(15)).status, 'unmatched');
});

test('a shop order of items that are not Holy What Happeneds is ignored; one payment never credits more than the cap', async () => {
    const { g, call, linkFor } = await setup();
    const code = await linkFor('uid_gus');
    const shirt = await call(kofiPost(payload({ type: 'Shop Order', kofi_transaction_id: TX(13), message: code, shop_items: [{ direct_link_code: 'tshirt', quantity: 3 }] })));
    assert.deepEqual(await body(shirt), { ok: true, ignored: 'unknown-items' });
    await call(kofiPost(payload({ type: 'Shop Order', kofi_transaction_id: TX(14), message: code, shop_items: [{ direct_link_code: 'beansack9', quantity: 40 }] })));
    assert.equal(g.plain('wallets/uid_gus').balance, 5000);
});

test('with the shipped placeholder config, nothing is credited for any item', async () => {
    const { g, call, linkFor } = await setup();
    const code = await linkFor('uid_hal');
    const r = await call(kofiPost(payload({ type: 'Shop Order', kofi_transaction_id: TX(15), message: code, shop_items: [{ direct_link_code: 'OWNER_SHOP_ITEM_CODE_1', quantity: 1 }] })), RealConfig);
    assert.deepEqual(await body(r), { ok: true, ignored: 'unknown-items' });
    assert.equal(g.calls.commits, 0);
});

test('no link code: kept as unmatched with only a keyed hash of the email; the payer claims it from the game', async () => {
    const { g, call, env } = await setup();
    const p = payload({ type: 'Shop Order', kofi_transaction_id: TX(16), message: 'forgot my code lol', email: 'Payer@Example.com', shop_items: [{ direct_link_code: 'beanpouch1', quantity: 1 }] });
    const r = await call(kofiPost(p));
    assert.deepEqual(await body(r), { ok: true, beans: 120, matched: false });
    const pay = g.plain('kofi_payments/' + TX(16));
    assert.equal(pay.status, 'unmatched');
    assert.equal(pay.why, 'no-code');
    assert.equal(pay.emailHash, await Kofi.emailHash('payer@example.com', env.EMAIL_PEPPER, subtle));
    assert.ok(!JSON.stringify(pay).toLowerCase().includes('payer@example.com'));

    const claimReq = async (o, headers) => new Request('https://w.example/claim', {
        method: 'POST',
        headers: Object.assign({ origin: ORIGIN, 'content-type': 'application/json', authorization: 'Bearer ' + (await idToken({ sub: 'uid_ivy' })) }, headers),
        body: JSON.stringify(o),
    });
    // the wrong email, then the right one
    const wrong = await call(await claimReq({ txid: TX(16), email: 'someone@else.com' }));
    assert.equal(wrong.status, 404);
    assert.equal(wrong.headers.get('access-control-allow-origin'), ORIGIN);
    const ok = await call(await claimReq({ txid: TX(16), email: ' payer@example.com ' }));
    assert.equal(ok.status, 200);
    assert.deepEqual(await body(ok), { ok: true, beans: 120 });
    assert.equal(g.plain('wallets/uid_ivy').balance, 120);
    const after = g.plain('kofi_payments/' + TX(16));
    assert.equal(after.status, 'credited');
    assert.equal(after.uid, 'uid_ivy');
    assert.equal(after.emailHash, undefined, 'the email hash is dropped once claimed');
    // claimed once only
    const twice = await call(await claimReq({ txid: TX(16), email: 'payer@example.com' }));
    assert.equal(twice.status, 404);
    assert.equal(g.plain('wallets/uid_ivy').balance, 120);
});

test('claims need the game\'s site, a real account and a valid sign-in', async () => {
    const { g, call } = await setup();
    g.put('kofi_payments/' + TX(17), { status: 'unmatched', beans: 50, type: 'Donation', items: [], emailHash: 'x' });
    const mk = async (headers, tokenOpts, claims) => new Request('https://w.example/claim', {
        method: 'POST',
        headers: Object.assign({ origin: ORIGIN, 'content-type': 'application/json', authorization: 'Bearer ' + (await idToken(claims || { sub: 'u1' }, tokenOpts)) }, headers),
        body: JSON.stringify({ txid: TX(17), email: 'a@b.c' }),
    });
    assert.equal((await call(await mk({ origin: 'https://evil.example' }))).status, 403);
    const pre = await call(new Request('https://w.example/claim', { method: 'OPTIONS', headers: { origin: ORIGIN } }));
    assert.equal(pre.status, 204);
    assert.equal(pre.headers.get('access-control-allow-headers'), 'authorization, content-type');
    assert.equal((await call(await mk({}, { badSigner: true }))).status, 401);
    assert.equal((await call(await mk({}, {}, { sub: 'u1', aud: 'another-project' }))).status, 401);
    assert.equal((await call(await mk({}, {}, { sub: 'u1', exp: 1000 }))).status, 401);
    assert.equal((await call(await mk({}, {}, { sub: 'u1', firebase: { sign_in_provider: 'anonymous' } }))).status, 403);
    assert.equal((await call(await mk({ authorization: '' }))).status, 401);
    assert.equal(g.calls.commits, 0);
});

test('a link code nobody registered keeps the payment as unmatched; the owner resolves it to the right player', async () => {
    const { g, call, linkFor } = await setup();
    const r = await call(kofiPost(payload({ type: 'Shop Order', kofi_transaction_id: TX(18), message: 'WH-0000-0000-0000', shop_items: [{ direct_link_code: 'beanpouch1', quantity: 1 }] })));
    assert.deepEqual(await body(r), { ok: true, beans: 120, matched: false });
    assert.equal(g.plain('kofi_payments/' + TX(18)).why, 'unknown-code');
    const code = await linkFor('uid_jo');
    const admin = (o, tok) => new Request('https://w.example/admin/resolve', { method: 'POST', headers: { authorization: 'Bearer ' + (tok || 'admin-secret') }, body: JSON.stringify(o) });
    assert.equal((await call(admin({ txid: TX(18), code }, 'wrong'))).status, 401);
    assert.equal((await call(admin({ txid: TX(18), code: 'WH-9999-9999-9999' }))).status, 404);
    const ok = await call(admin({ txid: TX(18), code }));
    assert.equal(ok.status, 200);
    assert.equal(g.plain('wallets/uid_jo').balance, 120);
    assert.equal((await call(admin({ txid: TX(18), code }))).status, 409, 'not twice');
    // a payment that was never stored: only with an explicit amount, and once
    assert.equal((await call(admin({ txid: TX(19), code }))).status, 404);
    assert.equal((await call(admin({ txid: TX(19), code, beans: 250 }))).status, 200);
    assert.equal((await call(admin({ txid: TX(19), code, beans: 250 }))).status, 409);
    assert.equal(g.plain('wallets/uid_jo').balance, 370);
});

test('when Firestore fails the worker answers 500, so Ko-fi delivers the payment again later', async () => {
    const { g, call, linkFor } = await setup();
    const code = await linkFor('uid_kim');
    g.fail.commit = true;
    const p = payload({ type: 'Shop Order', kofi_transaction_id: TX(20), message: code, shop_items: [{ direct_link_code: 'beanpouch1', quantity: 1 }] });
    assert.equal((await call(kofiPost(p))).status, 500);
    g.fail.commit = false;
    assert.equal((await call(kofiPost(p))).status, 200);
    assert.equal(g.plain('wallets/uid_kim').balance, 120);
    assert.equal(g.calls.token, 1, 'the access token is reused');
});

test('a JSON body on its own is accepted too (curl tests)', async () => {
    const { g, call, linkFor } = await setup();
    const code = await linkFor('uid_lee');
    const r = await call(new Request('https://w.example/kofi', { method: 'POST', headers: { 'content-type': 'application/json' },
        body: JSON.stringify(payload({ type: 'Shop Order', kofi_transaction_id: TX(21), message: code, shop_items: [{ direct_link_code: 'beanpouch1', quantity: 1 }] })) }));
    assert.equal(r.status, 200);
    assert.equal(g.plain('wallets/uid_lee').balance, 120);
});

test('tip packs (the shipped config): the tip\'s amount picks the pack; the same code works for every tip; a code only says who gets them', async () => {
    const { g, call, linkFor } = await setup();
    const real = RealConfig;
    const packs = real.activeTipPacks();
    assert.ok(packs.length >= 1, 'the config has tip packs');
    const mia = await linkFor('uid_mia');
    const tip = (n, amount, message, over) => call(kofiPost(payload(Object.assign({ type: 'Donation', kofi_transaction_id: TX(n), amount, currency: real.tipCurrency, message }, over))), real);
    // each pack's exact amount gives that pack, every time, to the same code
    let total = 0, n = 30;
    for (const p of packs) {
        const r = await tip(n++, p.dollars.toFixed(2), 'for the game ' + mia);
        assert.deepEqual(await body(r), { ok: true, beans: p.beans, matched: true });
        total += p.beans;
    }
    assert.equal(g.plain('wallets/uid_mia').balance, total);
    // an amount between packs gets the rate of the biggest pack it reached
    const small = packs[0], next = packs[1] || packs[0];
    const between = next.dollars + 1;
    const r = await tip(n++, between.toFixed(2), mia.toLowerCase());
    assert.equal((await body(r)).beans, Math.floor(between * next.beans / next.dollars));
    // another currency: nothing (no flat rate set), nothing stored
    const eur = await tip(n++, '5.00', mia, { currency: 'EUR' });
    assert.deepEqual(await body(eur), { ok: true, ignored: 'tip' });
    // someone else typing Mia's code only buys Holy What Happeneds for Mia
    const before = g.plain('wallets/uid_mia').balance;
    await tip(n++, small.dollars.toFixed(2), mia, { from_name: 'A Stranger', email: 'stranger@example.com' });
    assert.equal(g.plain('wallets/uid_mia').balance, before + small.beans);
    // a tip with no code is kept for its payer to claim
    const lost = await tip(n++, small.dollars.toFixed(2), 'great game!');
    assert.deepEqual(await body(lost), { ok: true, beans: small.beans, matched: false });
});

test('Ko-fi calls a tip "Tip" now (its own example still says "Donation"): both pay the same pack', async () => {
    const { g, call, linkFor } = await setup();
    const code = await linkFor('uid_tia');
    const p = RealConfig.activeTipPacks()[1] || RealConfig.activeTipPacks()[0];
    for (const [n, type] of [[50, 'Tip'], [51, 'Donation']]) {
        const r = await call(kofiPost(payload({ type, kofi_transaction_id: TX(n), amount: p.dollars.toFixed(2), currency: RealConfig.tipCurrency, message: code })), RealConfig);
        assert.deepEqual(await body(r), { ok: true, beans: p.beans, matched: true }, type);
    }
    assert.equal(g.plain('wallets/uid_tia').balance, p.beans * 2);
    assert.equal(g.plain('kofi_payments/' + TX(50)).type, 'Donation', 'stored under one name');
});

// /collect, as the game calls it: the player's ID token, from the game's site, no body
const collectReq = async (claims, headers, tokenOpts) => new Request('https://w.example/collect', {
    method: 'POST',
    headers: Object.assign({ origin: ORIGIN, authorization: 'Bearer ' + (await idToken(claims, tokenOpts)) }, headers),
});
const googleUser = (sub, email) => ({ sub, email, email_verified: true, firebase: { sign_in_provider: 'google.com' } });

test('shop packs: paid with the email the player signs in with; /collect hands over what was waiting, and later orders arrive by themselves', async () => {
    const { g, call, env, linkFor } = await setup();
    const order = (n, items, over) => call(kofiPost(payload(Object.assign({ type: 'Shop Order', kofi_transaction_id: TX(n), message: null, email: 'Nia.Buyer@Example.com', shop_items: items }, over))));
    // bought before the game ever said whose this email is: kept, with only the keyed hash
    assert.deepEqual(await body(await order(60, [{ direct_link_code: 'beanpouch1', variation_name: null, quantity: 1 }])), { ok: true, beans: 120, matched: false });
    assert.equal(g.plain('kofi_payments/' + TX(60)).status, 'unmatched');
    // the player opens Get more: the game calls /collect
    const r = await call(await collectReq(googleUser('uid_nia', 'nia.buyer@example.com')));
    assert.equal(r.status, 200);
    assert.equal(r.headers.get('access-control-allow-origin'), ORIGIN);
    assert.deepEqual(await body(r), { ok: true, beans: 120, count: 1 });
    assert.equal(g.plain('wallets/uid_nia').balance, 120);
    const pay = g.plain('kofi_payments/' + TX(60));
    assert.deepEqual([pay.status, pay.uid, pay.by, pay.emailHash], ['credited', 'uid_nia', 'email', undefined]);
    const hash = await Kofi.emailHash('nia.buyer@example.com', env.EMAIL_PEPPER, subtle);
    assert.equal(g.plain('kofi_emails/' + hash).uid, 'uid_nia');
    assert.ok(![...g.docs.keys()].some((k) => k.toLowerCase().includes('nia.buyer')), 'never the address itself');
    // again: nothing new, nothing written
    const commits = g.calls.commits;
    assert.deepEqual(await body(await call(await collectReq(googleUser('uid_nia', 'nia.buyer@example.com')))), { ok: true, beans: 0, count: 0 });
    assert.equal(g.calls.commits, commits);
    // the next order (any case in the address) is credited at once, and so is a tip with no code from that email
    assert.deepEqual(await body(await order(61, [{ direct_link_code: 'beansack9', quantity: 1 }], { email: 'NIA.BUYER@example.com' })), { ok: true, beans: 1000, matched: true });
    assert.equal(g.plain('kofi_payments/' + TX(61)).by, 'email');
    assert.deepEqual(await body(await order(62, null, { type: 'Donation', amount: '3.00', message: 'love the game' })), { ok: true, beans: 300, matched: true });
    assert.equal(g.plain('wallets/uid_nia').balance, 1420);
    // a link code in the message still decides: Nia tipping for a friend
    const friend = await linkFor('uid_oli');
    assert.deepEqual(await body(await order(63, null, { type: 'Donation', amount: '1.00', message: 'for you ' + friend })), { ok: true, beans: 100, matched: true });
    assert.equal(g.plain('wallets/uid_oli').balance, 100);
    assert.equal(g.plain('kofi_payments/' + TX(63)).by, 'code');
    assert.equal(g.plain('wallets/uid_nia').balance, 1420);
});

test('the shipped Shop packs: the same price and amount as each tip pack, and an order of each, paid with a noted email, credits it', async () => {
    const { g, call } = await setup();
    const shop = RealConfig.activePacks(), tips = RealConfig.activeTipPacks();
    assert.equal(shop.length, tips.length);
    shop.forEach((p, i) => {
        assert.equal(p.beans, tips[i].beans, p.name);
        assert.equal(p.price, '$' + tips[i].dollars, p.name);
        assert.match(p.code, /^[0-9a-f]{10}$/, 'a real Ko-fi item code');
    });
    assert.ok(!RealConfig.packByCode('b4b54189d5'), 'the "submit a background/song/skin" item is not a pack');
    assert.equal(RealConfig.maxBeansPerPayment, 100000);
    assert.equal((await call(await collectReq(googleUser('uid_pax', 'pax@example.com')), RealConfig)).status, 200);
    let n = 80, total = 0;
    for (const p of shop) {
        const r = await call(kofiPost(payload({ type: 'Shop Order', kofi_transaction_id: TX(n++), amount: p.price.slice(1) + '.00', message: null, email: 'pax@example.com',
            shop_items: [{ direct_link_code: p.code, variation_name: null, quantity: 1 }] })), RealConfig);
        assert.deepEqual(await body(r), { ok: true, beans: p.beans, matched: true }, p.name);
        total += p.beans;
    }
    assert.equal(g.plain('wallets/uid_pax').balance, total);
});

// Ko-fi's own examples, exactly as ko-fi.com/manage/webhooks showed them on 2026-11-21 (its tip still says "Donation";
// the page's text says "Tip"). Only the verification token, the transaction id and the shop item codes are swapped in.
const KOFI_EXAMPLES = {
    tip: { verification_token: '', message_id: 'f73b83cb-0de2-4d74-a6df-7980f1e81f7b', timestamp: '2026-11-21T21:04:16Z', type: 'Donation', is_public: true,
        from_name: 'Jo Example', message: 'Good luck with the integration!', amount: '3.00', url: 'https://ko-fi.com/Home/CoffeeShop?txid=00000000-1111-2222-3333-444444444444',
        email: 'jo.example@example.com', currency: 'USD', is_subscription_payment: false, is_first_subscription_payment: false,
        kofi_transaction_id: '00000000-1111-2222-3333-444444444444', shop_items: null, tier_name: null, shipping: null, discord_username: 'Jo#4105', discord_userid: '012345678901234567' },
    shop: { verification_token: '', message_id: '8442e418-3a99-451f-af66-dea739b3bd74', timestamp: '2026-11-21T21:04:16Z', type: 'Shop Order', is_public: true,
        from_name: 'Jo Example', message: null, amount: '27.95', url: 'https://ko-fi.com/Home/CoffeeShop?txid=00000000-1111-2222-3333-444444444444',
        email: 'jo.example@example.com', currency: 'USD', is_subscription_payment: false, is_first_subscription_payment: false,
        kofi_transaction_id: '00000000-1111-2222-3333-444444444444',
        shop_items: [{ direct_link_code: '1a2b3c4d5e', variation_name: 'Blue', quantity: 1 }, { direct_link_code: 'a1b2c3d4e5', variation_name: 'Large', quantity: 5 }],
        tier_name: null, shipping: { full_name: 'Ko-fi Mail Room', street_address: '123 The Old Exchange, High Street', city: 'Bigville', state_or_province: 'Kansas',
            postal_code: '12345', country: 'United States', country_code: 'US', telephone: '+1-212-456-7890' }, discord_username: 'Jo#4105', discord_userid: '012345678901234567' },
};

test('Ko-fi\'s own current examples go through: a Shop order of two packs (with shipping and Discord fields) and a tip, as "Donation" and as "Tip"', async () => {
    const { g, call, linkFor } = await setup();
    const [small, , large] = RealConfig.activePacks();
    // Ko-fi's test transaction id is ignored on purpose; a real payment has its own
    const test = await call(kofiPost(Object.assign({}, KOFI_EXAMPLES.shop, { verification_token: TOKEN })), RealConfig);
    assert.deepEqual(await body(test), { ok: true, test: true });
    // the shop example with our items: 1 Small + 5 Large, paid with an email the game already noted
    assert.equal((await call(await collectReq(googleUser('uid_jo', 'jo.example@example.com')), RealConfig)).status, 200);
    const shop = Object.assign({}, KOFI_EXAMPLES.shop, { verification_token: TOKEN, kofi_transaction_id: TX(90),
        shop_items: [{ direct_link_code: small.code, variation_name: 'Blue', quantity: 1 }, { direct_link_code: large.code, variation_name: 'Large', quantity: 5 }] });
    assert.deepEqual(await body(await call(kofiPost(shop), RealConfig)), { ok: true, beans: small.beans + 5 * large.beans, matched: true });
    const rec = g.plain('kofi_payments/' + TX(90));
    assert.deepEqual([rec.type, rec.by, rec.amount], ['Shop Order', 'email', '27.95']);
    assert.ok(!JSON.stringify(rec).includes('Mail Room') && !JSON.stringify(rec).includes('Jo#4105'), 'no shipping or Discord details kept');
    // the tip example, with a link code in its message, under both names
    const code = await linkFor('uid_kai');
    for (const [n, type] of [[91, 'Donation'], [92, 'Tip']]) {
        const tip = Object.assign({}, KOFI_EXAMPLES.tip, { verification_token: TOKEN, kofi_transaction_id: TX(n), type, message: 'Good luck with the integration! ' + code });
        assert.deepEqual(await body(await call(kofiPost(tip), RealConfig)), { ok: true, beans: RealConfig.tipBeans(3, 'USD'), matched: true }, type);
    }
    assert.equal(g.plain('wallets/uid_kai').balance, 2 * RealConfig.tipBeans(3, 'USD'));
});

test('/collect needs the game\'s site, a real account and a verified email, and only ever finds that email\'s payments', async () => {
    const { g, call } = await setup();
    g.put('kofi_payments/' + TX(70), { status: 'unmatched', beans: 50, type: 'Shop Order', items: [], emailHash: 'someone-elses' });
    const status = async (req) => { const r = await call(req); return [r.status, (await body(r)).reason || '']; };
    assert.deepEqual(await status(await collectReq(googleUser('u1', 'a@b.c'), { origin: 'https://evil.example' })), [403, '']);
    const pre = await call(new Request('https://w.example/collect', { method: 'OPTIONS', headers: { origin: ORIGIN } }));
    assert.equal(pre.status, 204);
    assert.deepEqual(await status(await collectReq(googleUser('u1', 'a@b.c'), {}, { badSigner: true })), [401, '']);
    assert.deepEqual(await status(await collectReq({ sub: 'u1', firebase: { sign_in_provider: 'anonymous' } })), [403, '']);
    // a password account that hasn't clicked the link in its verification email yet, and one with no email at all
    assert.deepEqual(await status(await collectReq({ sub: 'u1', email: 'a@b.c', email_verified: false })), [403, 'unverified']);
    assert.deepEqual(await status(await collectReq({ sub: 'u1' })), [403, 'unverified']);
    assert.equal(g.calls.commits, 0);
    // verified: noted, but someone else's payment stays where it is
    assert.deepEqual(await status(await collectReq({ sub: 'u1', email: 'a@b.c', email_verified: true })), [200, '']);
    assert.equal(g.plain('kofi_payments/' + TX(70)).status, 'unmatched');
    assert.equal(g.plain('wallets/u1'), null);
});

test('a Shop order paid with the email a game account signs in with is credited at once, with no step in the game (school networks block the worker)', async () => {
    const { g, call } = await setup();
    const [small] = RealConfig.activePacks();
    g.accounts.set('uid_sam', { email: 'Sam.Player@School.org', emailVerified: true });
    g.accounts.set('uid_una', { email: 'una@example.com', emailVerified: false, providers: ['password'] });
    const order = (n, email) => call(kofiPost(payload({ type: 'Shop Order', kofi_transaction_id: TX(n), message: null, email,
        shop_items: [{ direct_link_code: small.code, variation_name: null, quantity: 1 }] })), RealConfig);
    assert.deepEqual(await body(await order(100, 'sam.player@school.org')), { ok: true, beans: small.beans, matched: true });
    assert.equal(g.plain('wallets/uid_sam').balance, small.beans);
    assert.equal(g.plain('kofi_payments/' + TX(100)).by, 'account');
    // an email nobody has verified, or no account at all: kept, for a collect or a claim later
    assert.deepEqual(await body(await order(101, 'una@example.com')), { ok: true, beans: small.beans, matched: false });
    assert.deepEqual(await body(await order(102, 'nobody@example.com')), { ok: true, beans: small.beans, matched: false });
    assert.equal(g.plain('wallets/uid_una'), null);
    // without the role the lookup is refused: still a 200 for Ko-fi, kept as unmatched, nothing lost
    g.fail.auth = true;
    assert.deepEqual(await body(await order(103, 'sam.player@school.org')), { ok: true, beans: small.beans, matched: false });
    assert.equal(g.plain('kofi_payments/' + TX(103)).status, 'unmatched');
});

test('the game\'s requests in Firestore, answered every minute: collect hands over what waited for a newly verified email; claim checks the email; the answer replaces the request', async () => {
    const { g, call, env } = await setup();
    const deps = { fetch: g.fetch };
    const [small, medium] = RealConfig.activePacks();
    // Una paid before verifying her email; Vic paid with his school email, not the one he signs in with
    g.accounts.set('uid_una', { email: 'una@example.com', emailVerified: false, providers: ['password'] });
    g.accounts.set('uid_vic', { email: 'vic@home.example', emailVerified: true });
    const order = (n, email, item) => call(kofiPost(payload({ type: 'Shop Order', kofi_transaction_id: TX(n), message: null, email,
        shop_items: [{ direct_link_code: item.code, quantity: 1 }] })), RealConfig);
    await order(110, 'una@example.com', small);
    await order(111, 'vic@school.example', medium);
    const ask = (uid, fields) => g.put('kofi_requests/' + uid, Object.assign({ status: 'pending', at: 'now' }, fields));
    // not verified yet: told so, nothing handed over
    ask('uid_una', { kind: 'collect' });
    assert.equal(await worker.runRequests(env, deps), 1);
    let a = g.plain('kofi_requests/uid_una');
    assert.deepEqual([a.kind, a.status, a.reason], ['collect', 'failed', 'unverified']);
    // she clicks the link in her email, then Check now: handed over, and her email is noted for next time
    g.accounts.get('uid_una').emailVerified = true;
    ask('uid_una', { kind: 'collect' });
    assert.equal(await worker.runRequests(env, deps), 1);
    a = g.plain('kofi_requests/uid_una');
    assert.deepEqual([a.status, a.beans, a.count], ['done', small.beans, 1]);
    assert.equal(g.plain('wallets/uid_una').balance, small.beans);
    assert.equal(g.plain('kofi_emails/' + await Kofi.emailHash('una@example.com', env.EMAIL_PEPPER, subtle)).uid, 'uid_una');
    // nothing pending: nothing to do
    assert.equal(await worker.runRequests(env, deps), 0);
    // Vic claims with the wrong email, then the right one; the email he typed doesn't stay in Firestore
    ask('uid_vic', { kind: 'claim', txid: TX(111), email: 'vic@home.example' });
    await worker.runRequests(env, deps);
    a = g.plain('kofi_requests/uid_vic');
    assert.equal(a.status, 'failed');
    assert.match(a.error, /No unclaimed payment matches/);
    ask('uid_vic', { kind: 'claim', txid: TX(111), email: ' VIC@school.example ' });
    await worker.runRequests(env, deps);
    a = g.plain('kofi_requests/uid_vic');
    assert.deepEqual([a.status, a.beans, a.email, a.txid], ['done', medium.beans, undefined, undefined]);
    assert.equal(g.plain('wallets/uid_vic').balance, medium.beans);
    // the same claim again: already handed over
    ask('uid_vic', { kind: 'claim', txid: TX(111), email: 'vic@school.example' });
    await worker.runRequests(env, deps);
    assert.equal(g.plain('kofi_requests/uid_vic').status, 'failed');
    assert.equal(g.plain('wallets/uid_vic').balance, medium.beans);
    // an anonymous account (the Wilds' sign-in) or one that doesn't exist gets nothing
    g.accounts.set('uid_anon', { email: '', providers: [] });
    ask('uid_anon', { kind: 'collect' });
    ask('uid_ghost', { kind: 'collect' });
    assert.equal(await worker.runRequests(env, deps), 2);
    assert.match(g.plain('kofi_requests/uid_anon').error, /Sign in to an account/);
    assert.match(g.plain('kofi_requests/uid_ghost').error, /Sign in to an account/);
    // without the role: the request is answered with a "try again later", and the worker says what's missing
    g.fail.auth = true;
    ask('uid_una', { kind: 'collect' });
    await worker.runRequests(env, deps);
    assert.match(g.plain('kofi_requests/uid_una').error, /can't check accounts yet/);
});

test('a request the player replaced while it was being answered is left for the next minute', async () => {
    const { g, env } = await setup();
    g.accounts.set('uid_wes', { email: 'wes@example.com', emailVerified: true });
    g.put('kofi_requests/uid_wes', { kind: 'collect', status: 'pending', at: 'now' });
    // the player asks again between the worker's read and its answer: the answer's precondition fails
    const realFetch = g.fetch;
    let replaced = false;
    const fetchRacing = async (url, init) => {
        if (!replaced && String(url).endsWith('/documents:commit') && JSON.parse(init.body).writes.some((w) => w.update.name.endsWith('kofi_requests/uid_wes'))) {
            replaced = true;
            g.put('kofi_requests/uid_wes', { kind: 'claim', status: 'pending', at: 'later', txid: 'aaaa-bbbb-cccc', email: 'w@x.yz' });
        }
        return realFetch(url, init);
    };
    assert.equal(await worker.runRequests(env, { fetch: fetchRacing }), 0);
    assert.equal(g.plain('kofi_requests/uid_wes').kind, 'claim');
    assert.equal(g.plain('kofi_requests/uid_wes').status, 'pending', 'answered next time');
});

test('tools/kofi-test-payment.js connects like a browser: HTTPS_PROXY when set, and the certificates Windows trusts', () => {
    const T = require('../tools/kofi-test-payment.js');
    const allowed = new Set(['--use-system-ca', '--disable-warning']);
    // a proxy named in the environment: Node is told to use it (it ignores HTTPS_PROXY otherwise)
    const prox = T.relaunch({ PATH: 'x', HTTP_PROXY: 'http://proxy.example:3128' }, allowed);
    assert.deepEqual(prox.args, ['--disable-warning=UNDICI-EHPA', '--use-system-ca']);
    assert.equal(prox.env.HTTPS_PROXY, 'http://proxy.example:3128');
    assert.equal(prox.env.NODE_USE_ENV_PROXY, '1');
    assert.match(prox.env.NO_PROXY, /localhost/, 'wrangler dev on localhost stays direct');
    assert.equal(prox.env.WH_KOFI_TEST_RELAUNCHED, '1', 'started again only once');
    // what is already set is left as it is
    const set = T.relaunch({ HTTPS_PROXY: 'http://corp:3128', NO_PROXY: '.corp' }, allowed);
    assert.equal(set.env.HTTPS_PROXY, 'http://corp:3128');
    assert.equal(set.env.NO_PROXY, '.corp');
    // no proxy: direct, still trusting Windows' certificates (a network that inspects HTTPS)
    const direct = T.relaunch({}, allowed);
    assert.deepEqual(direct.args, ['--use-system-ca']);
    assert.equal(direct.env.NODE_USE_ENV_PROXY, undefined);
    assert.equal(direct.env.HTTPS_PROXY, undefined);
    // an older Node without the flag
    assert.deepEqual(T.relaunch({}, new Set()).args, []);
    assert.equal(T.parseArgs(['--check']).check, true);
});

test('tools/kofi-test-payment.js sends what the worker takes: credited once, a repeat refused, no code kept for claiming', async () => {
    const T = require('../tools/kofi-test-payment.js');
    const { g, call, linkFor } = await setup();
    const code = await linkFor('uid_tess');
    const send = async (p) => {
        const r = await call(new Request(T.webhookUrl('https://wh-kofi.example.workers.dev'), { method: 'POST', headers: { 'content-type': 'application/x-www-form-urlencoded' }, body: T.formBody(p) }), RealConfig);
        const b = await body(r);
        return { status: r.status, b, says: T.explain(r.status, b, p) };
    };
    const five = RealConfig.tipBeans(5, RealConfig.tipCurrency);
    const p = T.buildPayload({ token: TOKEN, code, amount: 5 });
    assert.match(p.kofi_transaction_id, /^TEST-/);
    assert.equal(p.amount, '5.00');
    const first = await send(p);
    assert.deepEqual(first.b, { ok: true, beans: five, matched: true });
    assert.match(first.says, new RegExp('Credited ' + five));
    const again = await send(p);
    assert.deepEqual(again.b, { ok: true, duplicate: true });
    assert.match(again.says, /nothing credited again/);
    assert.equal(g.plain('wallets/uid_tess').balance, five);
    // no code: kept, and the script says how to claim it
    const lost = T.buildPayload({ token: TOKEN, amount: 2, email: 'me@example.com' });
    const kept = await send(lost);
    assert.equal(kept.b.matched, false);
    assert.match(kept.says, new RegExp('Get more[\\s\\S]*claim it[\\s\\S]*' + lost.kofi_transaction_id + '[\\s\\S]*me@example\\.com'));
    // a wrong token is refused, and the script says so
    const bad = await send(T.buildPayload({ token: 'wrong', code, amount: 5 }));
    assert.equal(bad.status, 401);
    assert.match(bad.says, /token doesn't match/);
    // its guard rails
    assert.throws(() => T.buildPayload({ code: 'WH-12' }), /link code/);
    assert.throws(() => T.webhookUrl('http://example.com'), /https/);
    assert.equal(T.webhookUrl('http://localhost:8787/'), 'http://localhost:8787/kofi');
    assert.deepEqual(T.parseArgs(['--code', 'WH-1', '--amount=5', '--twice']), { code: 'WH-1', amount: '5', twice: true });
});

test('tools/kofi-test-payment.js knows a web filter\'s block page from the worker, even when the filter answers 200', () => {
    const T = require('../tools/kofi-test-payment.js');
    const ck = '<!-- CK-BLOCK -->\n<!DOCTYPE html><html><head><title>ContentKeeper Content Filtering</title></head><body>Blocked</body></html>';
    assert.equal(T.isFilterPage(ck), true);
    assert.equal(T.checkResult(200, ck).ok, false, 'a 200 block page is not the worker');
    assert.match(T.checkResult(200, ck).text, /web filter/);
    assert.equal(T.checkResult(200, 'What Happened Clicker: Ko-fi webhook. Ko-fi posts payments to /kofi.\n').ok, true);
    assert.equal(T.checkResult(200, '<html>some other site</html>').ok, false);
    assert.equal(T.isFilterPage(JSON.stringify({ ok: true, beans: 200, matched: true })), false);
});
