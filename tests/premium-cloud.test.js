'use strict';
// premium-cloud.js (the account's side of Holy What Happeneds) run for real, with Firebase and cloud.js replaced by fakes:
// the panel must see a sign-in, the live balance, the link code, and spend through one transaction. It once published its
// state with Object.assign, which froze every getter at load: the shop then said "Checking your account..." forever.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const vm = require('vm');
const { webcrypto } = require('node:crypto');

const ROOT = path.resolve(__dirname, '..');
const Kofi = require('../core/kofi.js');
const Config = require('../core/premium-config.js');

function load() {
    let src = fs.readFileSync(path.join(ROOT, 'premium-cloud.js'), 'utf8');
    // the module's imports become plain names taken from the fakes below
    src = src.replace(/import\s*\{([\s\S]*?)\}\s*from\s*'[^']+';/g, 'const {$1} = __stubs;');
    assert.ok(!/\bimport\b[^(]/.test(src.replace(/\/\/.*$/gm, '').replace(/\/\*[\s\S]*?\*\//g, '')), 'every import was replaced');
    const fake = { authCb: null, snapNext: null, snaps: {}, docs: {}, writes: [], events: 0 };
    const __stubs = {
        watchAuth: (cb) => { fake.authCb = cb; return () => {}; },
        getApp: () => ({}),
        getFirestore: () => ({}),
        doc: (db, ...parts) => parts.join('/'),
        collection: (db, ...parts) => parts.join('/'),
        query: (c) => c, orderBy: () => null, limit: () => null,
        getDoc: async (ref) => ({ exists: () => ref in fake.docs, data: () => fake.docs[ref] }),
        setDoc: async (ref, data) => { fake.docs[ref] = data; fake.writes.push(['set', ref]); },
        getDocs: async () => ({ docs: [] }),
        serverTimestamp: () => 'SERVER_TIME',
        onSnapshot: (ref, next) => { fake.snaps[ref] = next; if (ref.startsWith('wallets/')) fake.snapNext = next; return () => {}; },
        runTransaction: async (db, fn) => {
            const tx = {
                get: async (ref) => ({ exists: () => ref in fake.docs, data: () => fake.docs[ref] }),
                update: (ref, data) => { fake.writes.push(['update', ref, data]); fake.docs[ref] = Object.assign({}, fake.docs[ref], data); },
                set: (ref, data) => { fake.writes.push(['set', ref, data]); fake.docs[ref] = data; },
            };
            return fn(tx);
        },
    };
    const window = { dispatchEvent: () => { fake.events++; }, WHBeans: null };
    const ctx = vm.createContext({ __stubs, window, globalThis: null, crypto: webcrypto, TextEncoder, console, setTimeout, clearTimeout, Event: class { constructor(t) { this.type = t; } } });
    ctx.globalThis = ctx;
    ctx.WHKofi = Kofi;
    ctx.WHPremiumConfig = Config;
    vm.runInContext(src, ctx, { filename: 'premium-cloud.js' });
    return { fake, cloud: window.WHBeansCloud };
}
const plain = (o) => JSON.parse(JSON.stringify(o)); // objects made inside the sandbox come from another realm
// a few turns of the event loop; with `until`, more (up to 3 s) until it holds: hashing the link code takes longer on a busy machine
const settle = async (until) => {
    const end = Date.now() + 3000;
    do { for (let i = 0; i < 10; i++) await new Promise((r) => setImmediate(r)); } while (until && !until() && Date.now() < end);
};

test('premium-cloud.js: a sign-in reaches the shop, the balance follows the account, the link code is the account\'s', async () => {
    const { fake, cloud } = load();
    assert.equal(cloud.ready, false, 'before Firebase answers');
    fake.authCb({ uid: 'uid_live', isAnonymous: false });
    await settle(() => !!cloud.linkCode && !!fake.snapNext);
    assert.equal(cloud.ready, true, 'ready once Firebase answered (a frozen getter stays false)');
    assert.equal(cloud.user.uid, 'uid_live');
    assert.equal(cloud.linkCode, Kofi.formatLinkCode(await Kofi.linkIdForUid('uid_live', webcrypto.subtle)));
    assert.equal(cloud.live, false);
    fake.snapNext({ exists: () => true, data: () => ({ balance: 550 }) });
    assert.equal(cloud.live, true);
    assert.equal(cloud.balance, 550);
    // the link code is registered the first time Get more opens
    assert.equal(await cloud.ensureLink(), 'ready');
    const linkRef = 'kofi_links/' + await Kofi.linkIdForUid('uid_live', webcrypto.subtle);
    assert.deepEqual(plain(fake.docs[linkRef]), { uid: 'uid_live', at: 'SERVER_TIME' });
    assert.equal(cloud.link, 'ready');
});

test('premium-cloud.js: spending takes from the wallet and logs it in one transaction; too little is refused', async () => {
    const { fake, cloud } = load();
    fake.authCb({ uid: 'uid_spend', isAnonymous: false });
    await settle();
    fake.docs['wallets/uid_spend'] = { balance: 100, total: 100 };
    const r = await cloud.spend('x_gems', 15);
    assert.equal(r.ok, true);
    assert.deepEqual(plain(fake.docs['wallets/uid_spend']), { balance: 85, total: 100, spent: 15, lastSpend: r.id });
    assert.deepEqual(plain(fake.docs['wallets/uid_spend/spends/' + r.id]), { item: 'x_gems', cost: 15, at: 'SERVER_TIME' });
    const short = await cloud.spend('t_archangel', 600);
    assert.deepEqual([short.ok, short.reason], [false, 'short']);
    assert.equal(fake.docs['wallets/uid_spend'].balance, 85);
});

test('premium-cloud.js: collect and claim are requests in Firestore that the worker answers; the game never calls the worker (school networks block it)', async () => {
    const src = fs.readFileSync(path.join(ROOT, 'premium-cloud.js'), 'utf8');
    assert.ok(!/\bfetch\s*\(/.test(src.replace(/\/\/.*$/gm, '')), 'no fetch: nothing goes to *.workers.dev');
    const { fake, cloud } = load();
    fake.authCb({ uid: 'uid_req', isAnonymous: false, email: 'req@example.com', emailVerified: true, reload: async () => {} });
    await settle();
    const ref = 'kofi_requests/uid_req';
    const answer = (d) => fake.snaps[ref]({ exists: () => true, data: () => d });
    const p = cloud.collect();
    await settle(() => !!fake.snaps[ref]);
    assert.deepEqual(plain(fake.docs[ref]), { kind: 'collect', status: 'pending', at: 'SERVER_TIME' });
    assert.equal(cloud.collectState, 'busy');
    answer({ kind: 'collect', status: 'pending', at: 'SERVER_TIME' }); // its own write comes back first
    answer({ kind: 'collect', status: 'done', beans: 550, count: 1 });
    assert.deepEqual(plain(await p), { ok: true, beans: 550, count: 1 });
    assert.equal(cloud.collectState, 'done');
    // a claim: the transaction id and the email as typed, trimmed and in lower case; the worker's answer comes back as is
    const c = cloud.claim(' TX-1234-5678 ', ' Me@Example.com ');
    await settle(() => fake.docs[ref].kind === 'claim');
    assert.deepEqual(plain(fake.docs[ref]), { kind: 'claim', status: 'pending', at: 'SERVER_TIME', txid: 'TX-1234-5678', email: 'me@example.com' });
    answer({ kind: 'claim', status: 'failed', error: 'No unclaimed payment matches that transaction ID and email.' });
    assert.deepEqual(plain(await c), { ok: false, reason: 'server', message: 'No unclaimed payment matches that transaction ID and email.' });
    assert.equal((await cloud.claim('short', 'me@example.com')).ok, false, 'checked before anything is written');
    // an email not verified yet: asked to verify, nothing written
    const writes = fake.writes.length;
    fake.authCb({ uid: 'uid_unv', isAnonymous: false, email: 'u@example.com', emailVerified: false, reload: async () => {} });
    await settle();
    assert.equal((await cloud.collect()).reason, 'unverified');
    assert.equal(fake.writes.length, writes);
});

test('premium-cloud.js: the Wilds\' anonymous sign-in is not an account; signing out clears it', async () => {
    const { fake, cloud } = load();
    fake.authCb({ uid: 'anon', isAnonymous: true });
    await settle();
    assert.equal(cloud.ready, true);
    assert.equal(cloud.user, null);
    assert.equal((await cloud.spend('x_gems', 15)).reason, 'signin');
    fake.authCb({ uid: 'uid_a', isAnonymous: false });
    await settle();
    assert.equal(cloud.user.uid, 'uid_a');
    fake.authCb(null);
    await settle();
    assert.equal(cloud.user, null);
    assert.equal(cloud.balance, 0);
});
