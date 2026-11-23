/**
 * Holy What Happeneds 👼 bought on Ko-fi: the signed-in account's side (Firestore). Loaded as a module by index.html and world.html after
 * cloud.js; sets window.WHBeansCloud and fires a 'whbeans-cloud' event whenever something here changes.
 *
 * - wallets/{uid}: the balance the Ko-fi worker credits. Read live while signed in (never written here except to spend).
 * - Spending: one transaction that lowers the balance and logs the spend (wallets/{uid}/spends/{id}). firestore-premium.rules
 *   accepts exactly that and nothing that would raise the balance.
 * - The link code: kofi_links/<12 hex> -> { uid }, made the first time the player opens Get more while signed in.
 * - The worker matches a Ko-fi payment to the account that signs in with the email it was paid with (a Shop order can't
 *   carry the link code), by itself, when Ko-fi tells it about the payment.
 * - Collecting (payments made before the account existed or verified its email) and claims (a payment made with another
 *   email) are requests written to kofi_requests/{uid}; the worker answers them within a minute by replacing the request.
 *   The game never calls the worker itself: school networks block *.workers.dev, and most players play at school.
 * The page side is premium.js (window.WHBeans); core/premium.js explains the two pools.
 */
import { watchAuth } from './cloud.js';
import { getApp } from 'https://www.gstatic.com/firebasejs/12.8.0/firebase-app.js';
import {
    getFirestore, doc, getDoc, setDoc, onSnapshot, runTransaction, serverTimestamp, collection, query, orderBy, limit, getDocs,
} from 'https://www.gstatic.com/firebasejs/12.8.0/firebase-firestore.js';

const Kofi = globalThis.WHKofi, Config = globalThis.WHPremiumConfig;
const db = getFirestore(getApp());

const state = {
    ready: false,      // the first sign-in answer has arrived
    user: null,        // the signed-in account (never the Wilds' anonymous sign-in)
    live: false,       // balance is the account's own, just read
    balance: 0,
    error: '',         // 'rules' (the Firestore rules refuse: not published yet) or 'network'
    linkId: '',        // 12 hex digits; the code shown is Kofi.formatLinkCode(linkId)
    link: 'none',      // 'none' | 'checking' | 'ready' | 'error'
    collect: 'none',   // 'none' | 'busy' | 'done' | 'error': asking the worker for purchases made with the account's email
    collected: null,   // what the last collect() returned
};
let unsub = null, restored = '';
const emit = () => { try { window.dispatchEvent(new Event('whbeans-cloud')); } catch (e) {} };
const why = (e) => {
    const code = String((e && e.code) || '').replace(/^firestore\//, '');
    return code === 'permission-denied' ? 'rules' : code === 'beans/short' ? 'short' : 'network';
};

watchAuth(async (u) => {
    if (unsub) { try { unsub(); } catch (e) {} unsub = null; }
    state.user = u && !u.isAnonymous ? u : null;
    state.live = false; state.balance = 0; state.error = ''; state.linkId = ''; state.link = 'none'; state.collect = 'none'; state.collected = null;
    state.ready = true;
    emit();
    if (!state.user) return;
    const uid = state.user.uid;
    try { state.linkId = await Kofi.linkIdForUid(uid); } catch (e) {}
    if (!state.user || state.user.uid !== uid || unsub) return; // signed out or switched while hashing
    unsub = onSnapshot(doc(db, 'wallets', uid), (snap) => {
        if (!state.user || state.user.uid !== uid) return;
        const d = snap.exists() ? snap.data() : {};
        state.balance = Number.isInteger(d.balance) && d.balance > 0 ? d.balance : 0;
        state.live = true; state.error = '';
        emit();
    }, (e) => { state.error = why(e); emit(); });
    if (restored !== uid) { restored = uid; restoreSpends(uid); }
    emit();
});

// purchases this account paid for, back on this device if they aren't here
async function restoreSpends(uid) {
    try {
        const snap = await getDocs(query(collection(db, 'wallets', uid, 'spends'), orderBy('at', 'desc'), limit(100)));
        const list = snap.docs.map((d) => ({ id: d.id, item: d.data().item }));
        if (list.length && window.WHBeans) window.WHBeans.restore(list);
    } catch (e) { /* no spends yet, or the rules aren't published: nothing to restore */ }
}

// The link code exists in Firestore (made now if it isn't). Resolves 'ready' or 'error'.
async function ensureLink() {
    const u = state.user;
    if (!u || !state.linkId) return 'error';
    if (state.link === 'ready') return 'ready';
    state.link = 'checking'; emit();
    const ref = doc(db, 'kofi_links', state.linkId);
    try {
        const snap = await getDoc(ref);
        if (!snap.exists()) await setDoc(ref, { uid: u.uid, at: serverTimestamp() });
        state.link = 'ready';
    } catch (e) { state.link = 'error'; state.error = why(e); }
    emit();
    return state.link;
}

function spendId() {
    const a = new Uint8Array(12);
    crypto.getRandomValues(a);
    return Array.from(a, (b) => b.toString(36).padStart(2, '0')).join('').slice(0, 20);
}
// Take `cost` bought Holy What Happeneds for `item`. { ok, id } or { ok: false, reason: 'short' | 'rules' | 'network' | 'signin' }
async function spend(item, cost) {
    const u = state.user;
    if (!u) return { ok: false, reason: 'signin' };
    const id = spendId();
    const wref = doc(db, 'wallets', u.uid), sref = doc(db, 'wallets', u.uid, 'spends', id);
    try {
        await runTransaction(db, async (tx) => {
            const w = await tx.get(wref);
            const d = w.exists() ? w.data() : {};
            const bal = Number.isInteger(d.balance) ? d.balance : 0;
            if (bal < cost) { const e = new Error('short'); e.code = 'beans/short'; throw e; }
            tx.update(wref, { balance: bal - cost, spent: (Number.isInteger(d.spent) ? d.spent : 0) + cost, lastSpend: id });
            tx.set(sref, { item, cost, at: serverTimestamp() });
        });
        return { ok: true, id };
    } catch (e) {
        console.warn('Holy What Happeneds: spend failed', e && e.code);
        return { ok: false, reason: why(e) };
    }
}

// The account's recent Ko-fi payments: [{ beans, kind, at }]
async function history() {
    const u = state.user;
    if (!u) return [];
    try {
        const snap = await getDocs(query(collection(db, 'wallets', u.uid, 'credits'), orderBy('at', 'desc'), limit(10)));
        return snap.docs.map((d) => { const x = d.data(); return { beans: Number(x.beans) || 0, kind: String(x.kind || ''), at: x.at && x.at.toMillis ? x.at.toMillis() : 0 }; });
    } catch (e) { return []; }
}

// A payment made with another email, or without the link code: { ok, beans } or { ok: false, message }
async function claim(txid, email) {
    const u = state.user;
    if (!u) return { ok: false, message: 'Sign in to your account first.' };
    if (!Config.buyingOpen()) return { ok: false, message: 'Claiming isn\'t set up yet.' };
    const t = String(txid || '').trim(), e = String(email || '').trim().toLowerCase();
    if (!Kofi.TXID_RE.test(t) || !/^[^@\s]{1,128}@[^@\s]{1,128}$/.test(e)) return { ok: false, message: 'Enter the transaction ID and the email you paid with.' };
    try { return asked(await ask(u, 'claim', { txid: t, email: e }), (a) => ({ ok: true, beans: Number(a.beans) || 0 })); }
    catch (err) { return asked({ status: 'error', reason: why(err) }); }
}

// A request to the Ko-fi worker, through Firestore (kofi_requests/{uid}): the worker looks every minute and answers by
// replacing it. Resolves with the answer ({ status: 'done', beans, count } or { status: 'failed', error, reason }), or
// { status: 'waiting' } if none came within `ms` (it is still answered: anything it hands over arrives by itself).
async function ask(u, kind, extra, ms = 150000) {
    const ref = doc(db, 'kofi_requests', u.uid);
    await setDoc(ref, Object.assign({ kind, status: 'pending', at: serverTimestamp() }, extra || {}));
    return new Promise((resolve) => {
        let off = null, done = false, timer = null;
        const finish = (v) => { if (done) return; done = true; clearTimeout(timer); if (off) off(); resolve(v); };
        timer = setTimeout(() => finish({ status: 'waiting' }), ms);
        off = onSnapshot(ref, (snap) => {
            const d = snap.exists() ? snap.data() : null;
            if (d && d.kind === kind && d.status && d.status !== 'pending') finish(d);
        }, (e) => finish({ status: 'error', reason: why(e) }));
        if (done) off();
    });
}
const WAITING = 'The server hasn\'t answered yet (it looks every minute). Anything it finds arrives by itself, so check back in a few minutes.';
const asked = (a, ok) => (a.status === 'done' ? ok(a)
    : a.status === 'failed' ? { ok: false, reason: a.reason || 'server', message: a.error || 'That didn\'t work. Try again in a minute.' }
    : a.status === 'waiting' ? { ok: false, reason: 'waiting', message: WAITING }
    : { ok: false, reason: a.reason || 'network', message: a.reason === 'rules' ? 'The server isn\'t ready for this yet. Try again later.' : 'Couldn\'t reach the server. Check your connection and try again.' });

// Ko-fi payments made with this account's verified sign-in email that are still waiting (made before the account existed
// or before its email was verified). New ones arrive by themselves. { ok, beans, count } or { ok: false, reason, message }
async function collect() {
    const u = state.user;
    if (!u) return { ok: false, reason: 'signin', message: 'Sign in to your account first.' };
    if (u.email && !u.emailVerified) { try { await u.reload(); } catch (e) {} } // verified in another tab since?
    if (!u.email || !u.emailVerified) return { ok: false, reason: 'unverified', message: 'Verify your account\'s email first (on the Account page).' };
    if (!Config.buyingOpen()) return { ok: false, reason: 'closed', message: 'Buying isn\'t open yet.' };
    state.collect = 'busy'; emit();
    let out;
    try { out = asked(await ask(u, 'collect'), (a) => ({ ok: true, beans: Number(a.beans) || 0, count: Number(a.count) || 0 })); }
    catch (e) { out = asked({ status: 'error', reason: why(e) }); }
    if (state.user !== u) return out; // signed out or switched meanwhile
    state.collect = out.ok ? 'done' : 'error'; state.collected = out;
    emit();
    return out;
}

// a plain object with live getters (Object.assign would copy each getter's value once, at load, and freeze it there:
// the panel then waited for a sign-in forever)
window.WHBeansCloud = {
    get ready() { return state.ready; },
    get user() { return state.user; },
    get live() { return state.live; },
    get balance() { return state.balance; },
    get error() { return state.error; },
    get link() { return state.link; },
    get linkCode() { return state.linkId ? Kofi.formatLinkCode(state.linkId) : ''; },
    get email() { return state.user && state.user.email ? String(state.user.email) : ''; },
    get emailVerified() { return !!(state.user && state.user.email && state.user.emailVerified); },
    get collectState() { return state.collect; },
    get collected() { return state.collected; },
    ensureLink, spend, history, claim, collect,
};
emit();
