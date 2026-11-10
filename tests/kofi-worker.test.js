'use strict';
// The Ko-fi webhook worker (kofi-worker/src/index.js) end to end, against a fake Ko-fi and a fake Google:
// - fake Ko-fi: payloads posted the way Ko-fi posts them (form field `data` holding JSON), built from the example in
//   Ko-fi's help article "Does Ko-fi have an API or webhook?"
// - fake Google: the OAuth token endpoint (checks the service account's signed JWT), Firestore's REST API (documents,
//   atomic commits with preconditions, increments and server times), and the sign-in keys for Firebase ID tokens.
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
    const calls = { token: 0, commits: 0, reads: 0 };
    const fail = { commit: false };
    const root = 'projects/' + PROJECT + '/databases/(default)/documents/';
    const res = (status, body, headers) => new Response(body === undefined ? null : JSON.stringify(body), { status, headers: Object.assign({ 'content-type': 'application/json' }, headers || {}) });
    async function checkAssertion(jwt) {
        const [h, p, s] = jwt.split('.');
        const pub = await subtle.exportKey('jwk', k.sa.publicKey);
        const key = await subtle.importKey('jwk', pub, { name: 'RSASSA-PKCS1-v1_5', hash: 'SHA-256' }, false, ['verify']);
        const ok = await subtle.verify('RSASSA-PKCS1-v1_5', key, Buffer.from(s.replace(/-/g, '+').replace(/_/g, '/'), 'base64'), Buffer.from(h + '.' + p));
        const claims = JSON.parse(Buffer.from(p.replace(/-/g, '+').replace(/_/g, '/'), 'base64').toString());
        return ok && claims.iss === 'worker@whleaderboard.iam.gserviceaccount.com' && claims.aud === 'https://oauth2.googleapis.com/token'
            && claims.scope === 'https://www.googleapis.com/auth/datastore' && claims.exp > claims.iat;
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
        throw new Error('unexpected ' + method + ' ' + url);
    }
    const plain = (n) => { const d = docs.get(root + n); return d ? google.fromFields(d.fields) : null; };
    const put = (n, obj) => docs.set(root + n, { fields: google.toFields(obj), updateTime: 't' + (clock++) });
    return { fetch: fetchFake, docs, calls, fail, plain, put };
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

// a config with real packs filled in (the shipped one is all placeholders)
const CFG = Object.assign({}, RealConfig, {
    packs: [{ code: 'beanpouch1', beans: 120, name: 'Pouch', price: '$1' }, { code: 'beansack9', beans: 1000, name: 'Sack', price: '$8' }],
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

test('memberships pay by tier name; commissions and unknown tiers pay nothing', async () => {
    const { g, call, linkFor } = await setup();
    const code = await linkFor('uid_fay');
    await call(kofiPost(payload({ type: 'Subscription', is_subscription_payment: true, tier_name: 'Bean Club', kofi_transaction_id: TX(10), message: code })));
    assert.equal(g.plain('wallets/uid_fay').balance, 300);
    const other = await call(kofiPost(payload({ type: 'Subscription', tier_name: 'Other Tier', kofi_transaction_id: TX(11), message: code })));
    assert.deepEqual(await body(other), { ok: true, ignored: 'no-tier' });
    const comm = await call(kofiPost(payload({ type: 'Commission', kofi_transaction_id: TX(12), message: code })));
    assert.deepEqual(await body(comm), { ok: true, ignored: 'not-a-sale' });
    assert.equal(g.plain('wallets/uid_fay').balance, 300);
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
