/**
 * Beans ☕ bought on Ko-fi: the signed-in account's side (Firestore). Loaded as a module by index.html and world.html after
 * cloud.js; sets window.WHBeansCloud and fires a 'whbeans-cloud' event whenever something here changes.
 *
 * - wallets/{uid}: the balance the Ko-fi worker credits. Read live while signed in (never written here except to spend).
 * - Spending: one transaction that lowers the balance and logs the spend (wallets/{uid}/spends/{id}). firestore-premium.rules
 *   accepts exactly that and nothing that would raise the balance.
 * - The link code: kofi_links/<12 hex> -> { uid }, made the first time the player opens Get Beans while signed in.
 * - Claims (a payment sent without the code) go to the worker, with the player's ID token so it knows whose they are.
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
    state.live = false; state.balance = 0; state.error = ''; state.linkId = ''; state.link = 'none';
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
// Take `cost` bought Beans for `item`. { ok, id } or { ok: false, reason: 'short' | 'rules' | 'network' | 'signin' }
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
        console.warn('Beans: spend failed', e && e.code);
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

// A payment that came without a link code: { ok, beans } or { ok: false, message }
async function claim(txid, email) {
    const u = state.user;
    if (!u) return { ok: false, message: 'Sign in to your account first.' };
    if (Config.isPlaceholder(Config.workerUrl)) return { ok: false, message: 'Claiming isn\'t set up yet.' };
    try {
        const res = await fetch(Config.workerUrl.replace(/\/+$/, '') + '/claim', {
            method: 'POST',
            headers: { 'content-type': 'application/json', authorization: 'Bearer ' + (await u.getIdToken()) },
            body: JSON.stringify({ txid: String(txid || '').trim(), email: String(email || '').trim() }),
        });
        let body = {};
        try { body = await res.json(); } catch (e) {}
        if (res.ok && body.ok) return { ok: true, beans: Number(body.beans) || 0 };
        return { ok: false, message: body.error || 'That didn\'t work. Try again in a minute.' };
    } catch (e) {
        return { ok: false, message: 'Couldn\'t reach the server. Check your connection and try again.' };
    }
}

window.WHBeansCloud = Object.assign(Object.create(null), {
    get ready() { return state.ready; },
    get user() { return state.user; },
    get live() { return state.live; },
    get balance() { return state.balance; },
    get error() { return state.error; },
    get link() { return state.link; },
    get linkCode() { return state.linkId ? Kofi.formatLinkCode(state.linkId) : ''; },
    ensureLink, spend, history, claim,
});
emit();
