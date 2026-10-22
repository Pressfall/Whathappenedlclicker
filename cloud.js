/**
 * Accounts and cloud saves (Firebase Authentication + Firestore). Used by account.html (account.js) and the game page.
 *
 * - Progress = every localStorage key the game keeps progress in (SYNC_KEYS / SYNC_PREFIXES), uploaded as one JSON
 *   string to saves/{uid}. Only the signed-in owner can read or write that document (see firestore-saves.rules).
 * - Every upload bumps the document's `rev`. Each device remembers the rev and a hash of what it last synced
 *   (META_KEY), so it can tell "another device saved since" from "this device changed since". Progress is never
 *   replaced silently: when both happened, the player chooses which to keep.
 * - Whichever progress gets replaced (this device's or the account's) is kept on this device (BACKUP_KEY) and can be
 *   restored from the account page.
 */
import { initializeApp, getApps, getApp } from 'https://www.gstatic.com/firebasejs/12.8.0/firebase-app.js';
import {
    getAuth, onAuthStateChanged, signInWithEmailAndPassword, createUserWithEmailAndPassword, sendEmailVerification,
    sendPasswordResetEmail, GoogleAuthProvider, signInWithPopup, signOut, EmailAuthProvider, reauthenticateWithCredential,
    reauthenticateWithPopup, updatePassword, deleteUser,
} from 'https://www.gstatic.com/firebasejs/12.8.0/firebase-auth.js';
import { getFirestore, doc, getDoc, runTransaction, serverTimestamp, deleteDoc } from 'https://www.gstatic.com/firebasejs/12.8.0/firebase-firestore.js';

const FIREBASE_CONFIG = {
    apiKey: 'AIzaSyDkrNV4bQgRHzGJ__9XqHzry7xbYuH8IuU',
    authDomain: 'whleaderboard.firebaseapp.com',
    projectId: 'whleaderboard',
    storageBucket: 'whleaderboard.firebasestorage.app',
    messagingSenderId: '602999414155',
    appId: '1:602999414155:web:541f51b97db8358be4638e',
    measurementId: 'G-C2FWNR7288',
};
const app = getApps().length ? getApp() : initializeApp(FIREBASE_CONFIG);
export const auth = getAuth(app);
const db = getFirestore(app);
try { auth.useDeviceLanguage(); } catch (e) {}

const SAVE_KEY = 'whathappened_save', SAVE_KEY_LEGACY = 'whathappened_save_v1';
const META_KEY = 'whathappened_cloud_meta';       // { uid, rev, hash, at }: what this device last synced
const BACKUP_KEY = 'whathappened_cloud_backup';   // { at, kind: 'device' | 'account', payload, summary }
const APPLIED_KEY = 'whathappened_cloud_applied'; // written when account progress replaces this device's: open game tabs reload instead of saving over it
const NOTICE_KEY = 'whathappened_cloud_notice';   // sessionStorage: message for the game page to show after it reloads
const MAX_PAYLOAD = 900000;                       // Firestore caps a document at 1 MiB
const SYNC_EVERY_MS = 2 * 60 * 1000;              // while the game is visible; also on leaving the tab
const MIN_GAP_MS = 60 * 1000;
// Opening the game always changes the save a little (offline earnings, timestamps), and the last save before a tab
// closes often can't finish uploading. So when the account has newer progress and this device was only played this
// long since it last synced (and didn't prestige), the account's progress loads without asking (this device's is
// still kept as a backup).
const SMALL_PLAY_SEC = 180;

// Progress keys. Device settings, chat state, half-played casino rounds and cross-tab signals stay on the device.
const SYNC_KEYS = new Set([
    SAVE_KEY, 'whathappened_followers', 'whathappened_items',
    'unlocked_titles', 'equipped_title', 'whathappened_ach_new',
    'whathappened_lifetime_clicks', 'whathappened_clicks_since_prestige', 'whathappened_playtime_seconds',
    'whathappened_prestige_times', 'whathappened_total_golden', 'whathappened_last_prestige_ts', 'whathappened_golden',
    'whathappened_redeemed_codes', 'whathappened_casino_stats', 'gamba_total_wins', 'shopCasinoDealerPurchased',
    'whathappened_specials_owned', 'whathappened_specials_total', 'whathappened_specials_fullsets',
    'player_username', 'player_clanId', 'player_clanName', 'player_clanRole',
    'whathappened_clan_level', 'whathappened_clan_donated', 'whathappened_clan_checkin',
]);
// achievement flags (ach_<key>) and clan event rewards already claimed (so they can't be claimed again on another device)
const SYNC_PREFIXES = ['ach_', 'whathappened_pp_claimed_', 'whathappened_bf_claimed_', 'whathappened_eb_claimed_',
    'whathappened_cvc_claimed_', 'whathappened_race_claimed_', 'whathappened_con_claimed_'];
function isSyncKey(k) { return typeof k === 'string' && k.length <= 120 && (SYNC_KEYS.has(k) || SYNC_PREFIXES.some(p => k.startsWith(p))); }

function syncError(code, message) { const e = new Error(message); e.code = code; return e; }
function readJSON(store, key) { try { return JSON.parse(store.getItem(key) || 'null'); } catch (e) { return null; } }

// cyrb53: a fast 53-bit string hash, only used to notice that progress changed (not for security)
function hash(str) {
    let h1 = 0xdeadbeef, h2 = 0x41c6ce57;
    for (let i = 0; i < str.length; i++) {
        const ch = str.charCodeAt(i);
        h1 = Math.imul(h1 ^ ch, 2654435761);
        h2 = Math.imul(h2 ^ ch, 1597334677);
    }
    h1 = Math.imul(h1 ^ (h1 >>> 16), 2246822507) ^ Math.imul(h2 ^ (h2 >>> 13), 3266489909);
    h2 = Math.imul(h2 ^ (h2 >>> 16), 2246822507) ^ Math.imul(h1 ^ (h1 >>> 13), 3266489909);
    return (4294967296 * (2097151 & h2) + (h1 >>> 0)).toString(36);
}

// ---------------- this device's progress ----------------
// All progress keys, sorted so the same progress always gives the same JSON and hash
export function collectLocal() {
    const data = {};
    for (let i = 0; i < localStorage.length; i++) {
        const k = localStorage.key(i);
        if (isSyncKey(k)) data[k] = localStorage.getItem(k);
    }
    if (!(SAVE_KEY in data) && localStorage.getItem(SAVE_KEY_LEGACY) != null) data[SAVE_KEY] = localStorage.getItem(SAVE_KEY_LEGACY);
    const sorted = {};
    Object.keys(data).sort().forEach(k => { sorted[k] = data[k]; });
    const json = JSON.stringify(sorted);
    return { data: sorted, json, hash: hash(json) };
}
// A few headline numbers, shown when choosing between saves and stored next to the cloud save
export function summarize(data) {
    let s = {};
    try { s = JSON.parse(data[SAVE_KEY] || '{}') || {}; } catch (e) { s = {}; }
    const num = v => Number(v) || 0;
    let followers = 0;
    try { const f = JSON.parse(data.whathappened_followers || 'null'); followers = (f && Array.isArray(f.list)) ? f.list.length : 0; } catch (e) {}
    return {
        count: String(s.count == null ? '0' : s.count).slice(0, 40),
        golden: num(s.goldenWhat),
        totalGolden: num(s.totalGoldenEver),
        prestiges: Math.max(num(s.prestigeTimes), num(data.whathappened_prestige_times)),
        gems: num(s.diamonds),
        playSeconds: num(data.whathappened_playtime_seconds),
        achievements: Object.keys(data).filter(k => k.startsWith('ach_') && k !== 'ach_clicks' && data[k] === '1').length,
        followers,
    };
}
function countLog10(c) {
    const m = String(c || '0').match(/^(\d+(?:\.\d+)?)e\+?(\d+)$/i);
    if (m) return Math.log10(Number(m[1]) || 1) + Number(m[2]);
    const n = Number(c) || 0;
    return n > 0 ? Math.log10(n) : 0;
}
// true when a has gone further than b: prestiges first, then Golden earned, then What Happeneds, then play time
export function furtherAhead(a, b) {
    const keys = [x => x.prestiges || 0, x => x.totalGolden || 0, x => countLog10(x.count), x => x.playSeconds || 0];
    for (const k of keys) { if (k(a) !== k(b)) return k(a) > k(b); }
    return false;
}
// A brand-new device (nothing worth asking about) can take the account's progress without a prompt
export function hasProgress(data) {
    if (!data[SAVE_KEY]) return false;
    const s = summarize(data);
    return s.prestiges > 0 || s.totalGolden > 0 || s.golden > 0 || s.gems > 0 || s.followers > 0 || countLog10(s.count) >= 3;
}

const SUFFIXES = ['K', 'M', 'B', 'T', 'Q', 'Qi', 'Sx', 'Sp', 'Oc', 'No', 'Dc', 'Ud', 'Dd', 'Td', 'Qad', 'Qid'];
// Format a count that may be a huge Decimal string ("1.5e+40") the same way the game does
export function fmtCount(c) {
    const lg = countLog10(c);
    if (lg < 3) return String(Math.round(Number(c) || 0));
    const exp = Math.floor(lg), unit = Math.floor(exp / 3) - 1;
    if (unit >= SUFFIXES.length) return (10 ** (lg - exp)).toFixed(2) + 'e' + exp;
    const v = 10 ** (lg - (unit + 1) * 3);
    return v.toFixed(v < 100 ? 1 : 0) + SUFFIXES[unit];
}
export function fmtDuration(sec) {
    sec = Math.max(0, Math.floor(Number(sec) || 0));
    const d = Math.floor(sec / 86400), h = Math.floor((sec % 86400) / 3600), m = Math.floor((sec % 3600) / 60);
    return d ? `${d}d ${h}h` : h ? `${h}h ${m}m` : `${m}m`;
}
export function fmtAgo(ms) {
    if (!ms) return 'never';
    const s = Math.max(0, Math.round((Date.now() - ms) / 1000));
    if (s < 45) return 'just now';
    if (s < 3600) return `${Math.round(s / 60)} min ago`;
    if (s < 86400) return `${Math.round(s / 3600)} h ago`;
    return new Date(ms).toLocaleDateString();
}
// "Chrome on Android": enough to recognise a device, without storing the full user agent
function deviceLabel() {
    const ua = navigator.userAgent || '';
    const browser = /Edg\//.test(ua) ? 'Edge' : /OPR\//.test(ua) ? 'Opera' : /Firefox\//.test(ua) ? 'Firefox' : /Chrome\//.test(ua) ? 'Chrome' : /Safari\//.test(ua) ? 'Safari' : 'Browser';
    const os = /Android/.test(ua) ? 'Android' : /iPhone|iPad|iPod/.test(ua) ? 'iOS' : /Windows/.test(ua) ? 'Windows' : /CrOS/.test(ua) ? 'ChromeOS' : /Mac OS X/.test(ua) ? 'Mac' : /Linux/.test(ua) ? 'Linux' : '';
    return (browser + (os ? ' on ' + os : '')).slice(0, 40);
}

// ---------------- sync bookkeeping ----------------
export function readMeta() {
    const m = readJSON(localStorage, META_KEY);
    if (!m || typeof m !== 'object') return { uid: '', rev: 0, hash: '', at: 0, play: null, prestiges: 0 };
    return { uid: String(m.uid || ''), rev: Number(m.rev) || 0, hash: String(m.hash || ''), at: Number(m.at) || 0,
        play: m.play == null ? null : Number(m.play) || 0, prestiges: Number(m.prestiges) || 0 };
}
// rev and hash of what was synced, plus its play time and prestiges (see SMALL_PLAY_SEC)
function writeMeta(uid, rev, synced) {
    const s = summarize(synced.data);
    try { localStorage.setItem(META_KEY, JSON.stringify({ uid, rev, hash: synced.hash, at: Date.now(), play: s.playSeconds, prestiges: s.prestiges })); } catch (e) {}
}
function barelyPlayedSince(data, meta) {
    const s = summarize(data);
    return meta.play != null && s.prestiges <= meta.prestiges && s.playSeconds - meta.play <= SMALL_PLAY_SEC;
}
function clearMeta() { try { localStorage.removeItem(META_KEY); } catch (e) {} }
export function readBackup() {
    const b = readJSON(localStorage, BACKUP_KEY);
    return (b && typeof b.payload === 'string') ? b : null;
}
function writeBackup(kind, payload, summary) {
    try { localStorage.setItem(BACKUP_KEY, JSON.stringify({ at: Date.now(), kind, payload, summary })); }
    catch (e) { throw syncError('sync/no-space', 'Not enough browser storage to keep a backup, so nothing was replaced.'); }
}

// ---------------- the account's progress ----------------
function cloudFromSnap(snap) {
    const d = snap.data() || {};
    return {
        rev: Number(d.rev) || 0,
        payload: typeof d.payload === 'string' ? d.payload : '',
        summary: (d.summary && typeof d.summary === 'object') ? d.summary : {},
        device: typeof d.device === 'string' ? d.device : '',
        updatedAt: (d.updatedAt && typeof d.updatedAt.toMillis === 'function') ? d.updatedAt.toMillis() : 0,
    };
}
export async function fetchCloud(uid) {
    const snap = await getDoc(doc(db, 'saves', uid));
    return snap.exists() ? cloudFromSnap(snap) : null;
}
// Only progress keys with string values are accepted from the account; anything else in the document is ignored
function parsePayload(json) {
    if (typeof json !== 'string' || !json || json.length > MAX_PAYLOAD) throw syncError('sync/bad-data', 'The progress in your account could not be read.');
    let obj;
    try { obj = JSON.parse(json); } catch (e) { obj = null; }
    if (!obj || typeof obj !== 'object' || Array.isArray(obj)) throw syncError('sync/bad-data', 'The progress in your account could not be read.');
    const out = {};
    for (const k of Object.keys(obj)) if (isSyncKey(k) && typeof obj[k] === 'string') out[k] = obj[k];
    if (out[SAVE_KEY]) { try { JSON.parse(out[SAVE_KEY]); } catch (e) { throw syncError('sync/bad-data', 'The progress in your account could not be read.'); } }
    return out;
}

export class SyncConflict extends Error {
    constructor(cloud) { super('This account was saved from another device since this one last synced.'); this.code = 'sync/conflict'; this.cloud = cloud; }
}
// Save this device's progress to the account. Refuses (SyncConflict) when another device saved since this one last
// synced, unless force (the player chose this device's progress).
export async function uploadLocal(user, opts) {
    const force = !!(opts && opts.force);
    const local = collectLocal();
    if (local.json.length > MAX_PAYLOAD) throw syncError('sync/too-large', 'Your progress is too large to save to an account.');
    const meta = readMeta();
    const known = meta.uid === user.uid ? meta.rev : -1;
    const ref = doc(db, 'saves', user.uid);
    const rev = await runTransaction(db, async tx => {
        const snap = await tx.get(ref);
        const cur = snap.exists() ? (Number(snap.data().rev) || 0) : 0;
        if (!force && snap.exists() && cur !== known) throw new SyncConflict(cloudFromSnap(snap));
        tx.set(ref, { v: 1, rev: cur + 1, payload: local.json, summary: summarize(local.data), device: deviceLabel(), updatedAt: serverTimestamp() });
        return cur + 1;
    });
    writeMeta(user.uid, rev, local);
    return { rev, local };
}

// Replace this device's progress with `json` (from the account or a backup). The game page reloads afterwards.
function applyPayload(json) {
    const data = parsePayload(json);
    // the game must not save its in-memory state over what we write (this tab: main.js; other tabs: the storage event)
    try { if (typeof window.freezeSavesForReload === 'function') window.freezeSavesForReload(); } catch (e) {}
    const remove = [];
    for (let i = 0; i < localStorage.length; i++) { const k = localStorage.key(i); if (isSyncKey(k) && !(k in data)) remove.push(k); }
    remove.forEach(k => localStorage.removeItem(k));
    try {
        for (const k in data) localStorage.setItem(k, data[k]);
        if (data[SAVE_KEY]) localStorage.setItem(SAVE_KEY_LEGACY, data[SAVE_KEY]);
        else localStorage.removeItem(SAVE_KEY_LEGACY);
    } catch (e) { throw syncError('sync/no-space', 'Not enough browser storage to load your progress.'); }
    try { localStorage.setItem(APPLIED_KEY, String(Date.now())); } catch (e) {}
    return collectLocal();
}
// Load the account's progress onto this device, keeping this device's progress as a backup first.
// Returns true when a backup was kept.
export function loadCloudIntoDevice(user, cloud) {
    const local = collectLocal();
    const backedUp = hasProgress(local.data);
    if (backedUp) writeBackup('device', local.json, summarize(local.data));
    const applied = applyPayload(cloud.payload);
    writeMeta(user.uid, cloud.rev, applied);
    return backedUp;
}
// Keep this device's progress: the account's progress is backed up on this device, then overwritten
export async function keepDeviceProgress(user, cloud) {
    if (cloud && cloud.payload) writeBackup('account', cloud.payload, cloud.summary);
    return uploadLocal(user, { force: true });
}
// Put the backed-up progress back on this device (the progress it replaces becomes the new backup).
// When signed in, the restored progress is then saved to the account on the next sync.
export async function restoreBackup(user) {
    const b = readBackup();
    if (!b) throw syncError('sync/no-backup', 'There is no backup on this device.');
    const local = collectLocal();
    const cloud = user ? await fetchCloud(user.uid) : null;
    const applied = applyPayload(b.payload);
    if (hasProgress(local.data)) writeBackup('device', local.json, summarize(local.data));
    else localStorage.removeItem(BACKUP_KEY);
    // in step with the account's current rev, but changed: the next sync uploads the restored progress
    if (user) writeMeta(user.uid, cloud ? cloud.rev : 0, { data: applied.data, hash: 'restored' });
    else clearMeta();
    return applied;
}

// Bring this device and the account in line after signing in or opening the game.
// askUser(localSummary, cloud) resolves 'local', 'cloud' or 'later' when both sides changed.
// Returns { state: 'synced' | 'uploaded' | 'loaded' | 'conflict', cloud, backedUp }.
export async function reconcile(user, askUser) {
    const local = collectLocal(), meta = readMeta();
    const cloud = await fetchCloud(user.uid);
    if (!cloud) { await uploadLocal(user); return { state: 'uploaded', cloud: null }; }
    const mine = meta.uid === user.uid;
    // exactly the same progress on both sides (e.g. signing back in on this device): nothing to ask
    if (cloud.payload && hash(cloud.payload) === local.hash) { writeMeta(user.uid, cloud.rev, local); return { state: 'synced', cloud }; }
    if (mine && cloud.rev === meta.rev) {
        if (local.hash === meta.hash) return { state: 'synced', cloud };
        try { await uploadLocal(user); return { state: 'uploaded', cloud }; }
        catch (e) { if (!(e instanceof SyncConflict)) throw e; return reconcile(user, askUser); }
    }
    // the account has progress this device hasn't seen
    const untouched = mine && cloud.rev > meta.rev && (local.hash === meta.hash || barelyPlayedSince(local.data, meta));
    if (untouched || !hasProgress(local.data)) return { state: 'loaded', cloud, backedUp: loadCloudIntoDevice(user, cloud) };
    const choice = askUser ? await askUser(summarize(local.data), cloud) : 'later';
    if (choice === 'cloud') return { state: 'loaded', cloud, backedUp: loadCloudIntoDevice(user, cloud) };
    if (choice === 'local') { await keepDeviceProgress(user, cloud); return { state: 'uploaded', cloud }; }
    return { state: 'conflict', cloud };
}

// ---------------- accounts ----------------
export function watchAuth(cb) { return onAuthStateChanged(auth, cb); }
function googleProvider() {
    const p = new GoogleAuthProvider();
    p.setCustomParameters({ prompt: 'select_account' });
    return p;
}
// Call straight from a click handler (no await before it) or the browser blocks the pop-up
export function signInGoogle() { return signInWithPopup(auth, googleProvider()).then(r => r.user); }
export async function signInEmail(email, password) { return (await signInWithEmailAndPassword(auth, String(email).trim(), password)).user; }
export async function createAccount(email, password) {
    const cred = await createUserWithEmailAndPassword(auth, String(email).trim(), password);
    try { await sendEmailVerification(cred.user); } catch (e) {}
    return cred.user;
}
export function sendReset(email) { return sendPasswordResetEmail(auth, String(email).trim()); }
export function resendVerification() { return sendEmailVerification(auth.currentUser); }
export function usesPassword(user) { return !!user && user.providerData.some(p => p.providerId === 'password'); }
export function usesGoogle(user) { return !!user && user.providerData.some(p => p.providerId === 'google.com'); }
// Firebase asks for a recent sign-in before changing the password or deleting the account
async function reauth(user, password) {
    if (usesPassword(user) && password) return reauthenticateWithCredential(user, EmailAuthProvider.credential(user.email, password));
    if (usesGoogle(user)) return reauthenticateWithPopup(user, googleProvider());
    throw syncError('auth/missing-password', 'Enter your current password.');
}
export async function changePassword(current, next) {
    const user = auth.currentUser;
    await reauth(user, current);
    await updatePassword(user, next);
}
// Deletes the account's cloud save and the account. This device keeps its progress.
export async function deleteAccount(password) {
    const user = auth.currentUser;
    await reauth(user, password);
    await deleteDoc(doc(db, 'saves', user.uid));
    await deleteUser(user);
    clearMeta();
}
// clearDevice: also remove the game's progress from this device (shared computers). The progress is saved to the
// account first; if that fails, nothing is removed. A plain sign-out keeps this device's sync record (META_KEY), so
// signing back in to the same account knows what this device last synced.
export async function signOutUser(clearDevice) {
    const user = auth.currentUser;
    if (clearDevice && !user) throw syncError('sync/signed-out', 'You\'re not signed in, so nothing was removed from this device.');
    if (clearDevice) {
        const local = collectLocal(), meta = readMeta();
        if (!(meta.uid === user.uid && local.hash === meta.hash)) await uploadLocal(user);
        try { if (typeof window.freezeSavesForReload === 'function') window.freezeSavesForReload(); } catch (e) {}
        const keys = [];
        for (let i = 0; i < localStorage.length; i++) { const k = localStorage.key(i); if (isSyncKey(k)) keys.push(k); }
        keys.concat([SAVE_KEY_LEGACY, BACKUP_KEY]).forEach(k => localStorage.removeItem(k));
        try { localStorage.setItem(APPLIED_KEY, String(Date.now())); } catch (e) {}
        clearMeta();
    }
    await signOut(auth);
}

// ---------------- messages ----------------
const MESSAGES = {
    'auth/invalid-email': 'That email address doesn\'t look right.',
    // the same message for every wrong-login case, so the form never reveals whether an email has an account
    'auth/invalid-credential': 'Email or password is incorrect.',
    'auth/invalid-login-credentials': 'Email or password is incorrect.',
    'auth/wrong-password': 'Email or password is incorrect.',
    'auth/user-not-found': 'Email or password is incorrect.',
    'auth/missing-password': 'Enter your password.',
    'auth/email-already-in-use': 'There\'s already an account with this email. Sign in instead.',
    'auth/weak-password': 'Choose a stronger password.',
    'auth/password-does-not-meet-requirements': 'That password doesn\'t meet the password requirements.',
    'auth/too-many-requests': 'Too many attempts. Wait a few minutes, or reset your password.',
    'auth/network-request-failed': 'Couldn\'t reach the server. Check your connection and try again.',
    'auth/popup-blocked': 'Your browser blocked the Google sign-in window. Allow pop-ups for this site and try again.',
    'auth/user-disabled': 'This account has been disabled.',
    'auth/requires-recent-login': 'For your security, confirm it\'s you again first.',
    'auth/user-mismatch': 'That\'s a different account from the one you\'re signed in with.',
    'auth/account-exists-with-different-credential': 'This email already uses a different sign-in method. Sign in that way first.',
    'auth/unauthorized-domain': 'Sign-in isn\'t set up for this website yet. (Site owner: add this domain in Firebase Authentication → Settings → Authorized domains.)',
    'auth/operation-not-allowed': 'This sign-in method isn\'t turned on yet. (Site owner: enable it in Firebase Authentication → Sign-in method.)',
    'permission-denied': 'The server refused access to your save. (Site owner: add the saves rules from firestore-saves.rules.)',
    'unavailable': 'Couldn\'t reach the server. Check your connection and try again.',
};
const SILENT = new Set(['auth/popup-closed-by-user', 'auth/cancelled-popup-request', 'auth/user-cancelled']);
// '' for errors the player caused on purpose (closing the Google window)
export function errorMessage(e) {
    const code = (e && e.code) ? String(e.code).replace(/^firestore\//, '') : '';
    if (SILENT.has(code)) return '';
    if (MESSAGES[code]) return MESSAGES[code];
    if (code.startsWith('sync/') && e.message) return e.message;
    return 'Something went wrong. Please try again.';
}

// ---------------- choosing between two saves (account page and game page) ----------------
function esc(s) { return String(s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', '\'': '&#39;' })[c]); }
export function statsHtml(s) {
    const rows = [
        ['What Happeneds', fmtCount(s.count)], ['Golden', (Number(s.golden) || 0).toLocaleString()],
        ['Prestiges', (Number(s.prestiges) || 0).toLocaleString()], ['Gems', (Number(s.gems) || 0).toLocaleString()],
        ['Achievements', (Number(s.achievements) || 0).toLocaleString()], ['Play time', fmtDuration(s.playSeconds)],
    ];
    return '<dl class="cs-stats">' + rows.map(([k, v]) => `<div><dt>${k}</dt><dd>${esc(v)}</dd></div>`).join('') + '</dl>';
}
let chooser = null;
// Resolves 'local', 'cloud' or 'later'
export function chooseProgress(localSummary, cloud) {
    if (chooser) chooser.finish('later');
    return new Promise(resolve => {
        const cloudSummary = cloud.summary || {};
        const localAhead = furtherAhead(localSummary, cloudSummary), cloudAhead = furtherAhead(cloudSummary, localSummary);
        const badge = '<span class="cs-badge">Further ahead</span>';
        const wrap = document.createElement('div');
        wrap.className = 'cs-wrap';
        wrap.innerHTML = `<div class="cs-backdrop"></div>
            <div class="cs-dialog" role="dialog" aria-modal="true" aria-labelledby="csTitle" aria-describedby="csDesc">
                <div class="cs-kicker">☁️ Two different saves</div>
                <h3 id="csTitle" class="cs-title">Which progress do you want to keep?</h3>
                <p id="csDesc" class="cs-desc">This device and your account were both played since they last synced. The one you don't pick is kept as a backup on this device, and you can restore it from the Account page.</p>
                <div class="cs-options">
                    <button type="button" class="cs-card${localAhead ? ' is-ahead' : ''}" data-pick="local">
                        ${localAhead ? badge : ''}<span class="cs-card-title">💻 This device</span>
                        <span class="cs-card-sub">Playing now</span>
                        ${statsHtml(localSummary)}
                        <span class="cs-pick">Keep this device's progress</span>
                    </button>
                    <button type="button" class="cs-card${cloudAhead ? ' is-ahead' : ''}" data-pick="cloud">
                        ${cloudAhead ? badge : ''}<span class="cs-card-title">☁️ Your account</span>
                        <span class="cs-card-sub">Saved ${esc(fmtAgo(cloud.updatedAt))}${cloud.device ? ' from ' + esc(cloud.device) : ''}</span>
                        ${statsHtml(cloudSummary)}
                        <span class="cs-pick">Keep account progress</span>
                    </button>
                </div>
                <button type="button" class="btn btn-ghost btn-sm cs-later" data-pick="later">Decide later</button>
            </div>`;
        document.body.appendChild(wrap);
        const prevFocus = document.activeElement;
        const finish = pick => {
            if (!chooser || chooser.wrap !== wrap) return;
            chooser = null;
            wrap.remove();
            try { if (prevFocus && document.contains(prevFocus)) prevFocus.focus({ preventScroll: true }); } catch (e) {}
            resolve(pick);
        };
        chooser = { wrap, finish };
        wrap.addEventListener('click', e => { const b = e.target.closest('[data-pick]'); if (b) finish(b.dataset.pick); });
        wrap.addEventListener('keydown', e => {
            if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); finish('later'); return; }
            if (e.key !== 'Tab') return;
            const btns = wrap.querySelectorAll('button');
            const first = btns[0], last = btns[btns.length - 1];
            if (e.shiftKey && document.activeElement === first) { e.preventDefault(); last.focus(); }
            else if (!e.shiftKey && document.activeElement === last) { e.preventDefault(); first.focus(); }
        });
        try { wrap.querySelector(cloudAhead ? '[data-pick="cloud"]' : '[data-pick="local"]').focus({ preventScroll: true }); } catch (e) {}
    });
}

// ---------------- game page: keep the account up to date while playing ----------------
// Drives the ☁️ button (#cloudBtn): saves to the account every few minutes while the game is visible and whenever
// the player leaves the tab, and loads newer progress from the account when the game opens.
export function startGameSync() {
    const btn = document.getElementById('cloudBtn');
    let user = null, busy = false, lastUpload = 0, state = 'signed-out', conflictCloud = null, lastSyncedAt = 0;
    const setState = (s, detail) => {
        state = s;
        if (!btn) return;
        const label = {
            'signed-out': '☁️ Save to account', checking: '☁️ Checking…', saving: '☁️ Saving…',
            synced: '☁️ Saved', conflict: '⚠️ Choose a save', error: '⚠️ Not saved',
        }[s];
        btn.textContent = label;
        btn.classList.toggle('is-warn', s === 'conflict' || s === 'error');
        btn.title = s === 'signed-out' ? 'Sign in to save your progress and play on any device'
            : s === 'synced' ? `Saved to ${user && user.email ? user.email : 'your account'} · ${fmtAgo(lastSyncedAt)}`
            : s === 'conflict' ? 'This device and your account have different progress. Click to choose which to keep.'
            : s === 'error' ? (detail || 'Your progress could not be saved to your account. Click for details.')
            : '';
    };
    const toast = msg => { try { if (msg && typeof window.notify === 'function') window.notify(msg, 4200); } catch (e) {} };
    const reload = backedUp => {
        const note = 'Loaded your newer progress from your account.' + (backedUp ? ' This device\'s previous progress is kept as a backup on the Account page.' : '');
        try { sessionStorage.setItem(NOTICE_KEY, note); } catch (e) {}
        location.reload();
    };
    const flushGame = () => { try { if (typeof window.saveGame === 'function') window.saveGame(); } catch (e) {} };
    const ask = async (localSummary, cloud) => {
        conflictCloud = cloud;
        setState('conflict');
        return chooseProgress(localSummary, cloud);
    };
    const handle = async res => {
        if (res.state === 'loaded') { reload(res.backedUp); return; }
        if (res.state === 'conflict') { conflictCloud = res.cloud; setState('conflict'); return; }
        conflictCloud = null;
        lastSyncedAt = Date.now();
        setState('synced');
    };
    // full check: on sign-in, on opening the game, and after a conflict
    const reconcileNow = async () => {
        if (!user || busy) return;
        busy = true;
        setState('checking');
        try { flushGame(); await handle(await reconcile(user, ask)); lastUpload = Date.now(); }
        catch (e) { console.warn('cloud sync failed', e); setState('error', errorMessage(e)); }
        finally { busy = false; }
    };
    // routine save: only uploads when progress changed, and stops at a conflict instead of overwriting
    const saveNow = async force => {
        if (!user || busy || state === 'conflict' || !window._saveLoaded) return;
        if (!force && Date.now() - lastUpload < MIN_GAP_MS) return;
        flushGame();
        const meta = readMeta();
        if (meta.uid === user.uid && collectLocal().hash === meta.hash) return;
        busy = true;
        setState('saving');
        try { await uploadLocal(user); lastUpload = lastSyncedAt = Date.now(); setState('synced'); }
        catch (e) {
            if (e instanceof SyncConflict) { busy = false; await reconcileNow(); return; }
            console.warn('cloud save failed', e);
            setState('error', errorMessage(e));
        } finally { busy = false; }
    };
    // #cloudBtn links to account.html; when there's a save to choose, it asks right here instead
    if (btn) btn.addEventListener('click', e => {
        if (state === 'conflict' && user) { e.preventDefault(); reconcileNow(); }
    });
    try {
        const notice = sessionStorage.getItem(NOTICE_KEY);
        if (notice) { sessionStorage.removeItem(NOTICE_KEY); setTimeout(() => toast(notice), 600); }
    } catch (e) {}
    setState('signed-out');
    watchAuth(u => {
        user = u;
        conflictCloud = null;
        if (!u) { setState('signed-out'); return; }
        const start = () => (window._saveLoaded ? reconcileNow() : setTimeout(start, 300));
        start();
    });
    setInterval(() => { if (document.visibilityState === 'visible') saveNow(false); }, SYNC_EVERY_MS);
    document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'hidden') saveNow(true); });
    setInterval(() => { if (state === 'synced') setState('synced'); }, 30000); // keeps "saved N min ago" current
    return { saveNow: () => saveNow(true), get conflictCloud() { return conflictCloud; } };
}
