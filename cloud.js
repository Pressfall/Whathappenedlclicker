/**
 * Accounts and cloud saves (Firebase Authentication + Firestore). Used by account.html (account.js) and the game page.
 *
 * - The sync rules (what counts as progress, when this device and the account conflict, backups, export/import) are in
 *   core/progress.js, which has no Firebase in it and is tested on its own. This file gives it the browser's
 *   localStorage and the account's Firestore document, and adds sign-in and the screens.
 * - Progress is uploaded as one JSON string to saves/{uid}. Only the signed-in owner can read or write that document
 *   (see firestore-saves.rules). Every upload bumps the document's `rev`.
 * - Progress is never replaced silently: when this device and the account both changed, the player chooses which to
 *   keep. Whichever progress gets replaced is kept on this device and can be restored from the account page.
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
// the default app (the Wilds page also has its own app, 'wilds', for playing online: that one is not the account)
const app = getApps().some(a => a.name === '[DEFAULT]') ? getApp() : initializeApp(FIREBASE_CONFIG);
export const auth = getAuth(app);
const db = getFirestore(app);
try { auth.useDeviceLanguage(); } catch (e) {}

const WHProgress = globalThis.WHProgress;
if (!WHProgress) throw new Error('core/progress.js must be loaded before cloud.js');
export const { SyncConflict, summarize, furtherAhead, hasProgress } = WHProgress;
const { countLog10, syncError } = WHProgress;

const NOTICE_KEY = 'whathappened_cloud_notice';   // sessionStorage: message for the game page to show after it reloads
const SYNC_EVERY_MS = 2 * 60 * 1000;              // while the game is visible; also on leaving the tab
const MIN_GAP_MS = 60 * 1000;

// ---------------- the account's save (Firestore saves/{uid}) as the sync engine sees it ----------------
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
const remote = {
    async fetch(uid) {
        const snap = await getDoc(doc(db, 'saves', uid));
        return snap.exists() ? cloudFromSnap(snap) : null;
    },
    // decide(current | null) returns the document to write (or throws to refuse); updatedAt must be the server's clock
    transaction(uid, decide) {
        const ref = doc(db, 'saves', uid);
        return runTransaction(db, async (tx) => {
            const snap = await tx.get(ref);
            const next = decide(snap.exists() ? cloudFromSnap(snap) : null);
            tx.set(ref, { ...next, updatedAt: serverTimestamp() });
            return next.rev;
        });
    },
};
// localStorage is looked up on each call, so a browser that blocks it fails inside the sync code's try/catch, not at import
const store = {
    getItem: (k) => localStorage.getItem(k),
    setItem: (k, v) => localStorage.setItem(k, v),
    removeItem: (k) => localStorage.removeItem(k),
    key: (i) => localStorage.key(i),
    get length() { return localStorage.length; },
};
const engine = WHProgress.create({
    store,
    now: Date.now,
    deviceLabel,
    // the game must not save its in-memory state over progress we are about to write
    beforeReplace() { if (typeof window.freezeSavesForReload === 'function') window.freezeSavesForReload(); },
    remote,
});
export const {
    collectLocal, readMeta, readBackup, fetchCloud, uploadLocal, loadCloudIntoDevice, keepDeviceProgress, restoreBackup, reconcile,
    exportProgress, previewImport, importProgress,
} = engine;


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
    engine.clearMeta();
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
        engine.wipeDevice();
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
    // the Wilds, when this save has been there (older account saves don't have these numbers)
    if (Number(s.wildsSeconds) > 0 || Number(s.wildsRubies) > 0) rows.push(['Wilds rubies earned', (Number(s.wildsRubies) || 0).toLocaleString()], ['Time in the Wilds', fmtDuration(s.wildsSeconds)]);
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
// Used by the clicker (index.html) and the Wilds (world.html). The page provides window.saveGame (write its progress to
// storage now), window._saveLoaded (its save has loaded) and window.freezeSavesForReload (stop saving: progress is about
// to be replaced). opts.compact: the button shows only its icon, the words go in its tooltip.
export function startGameSync(opts = {}) {
    const btn = document.getElementById('cloudBtn');
    let user = null, busy = false, lastUpload = 0, state = 'signed-out', conflictCloud = null, lastSyncedAt = 0;
    const setState = (s, detail) => {
        state = s;
        if (!btn) return;
        const label = {
            'signed-out': '☁️ Save to account', checking: '☁️ Checking…', saving: '☁️ Saving…',
            synced: '☁️ Saved', conflict: '⚠️ Choose a save', error: '⚠️ Not saved',
        }[s];
        if (opts.compact) { btn.textContent = label.split(' ')[0]; btn.setAttribute('aria-label', label.replace(/^\S+\s*/, '')); }
        else btn.textContent = label;
        btn.classList.toggle('is-busy', s === 'checking' || s === 'saving');
        btn.classList.toggle('is-off', s === 'signed-out');
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
        // an anonymous sign-in is not an account: there is nothing of the player's to save it to
        user = u && !u.isAnonymous ? u : null;
        conflictCloud = null;
        if (!user) { setState('signed-out'); return; }
        const start = () => (window._saveLoaded ? reconcileNow() : setTimeout(start, 300));
        start();
    });
    setInterval(() => { if (document.visibilityState === 'visible') saveNow(false); }, SYNC_EVERY_MS);
    document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'hidden') saveNow(true); });
    setInterval(() => { if (state === 'synced') setState('synced'); }, 30000); // keeps "saved N min ago" current
    return { saveNow: () => saveNow(true), get conflictCloud() { return conflictCloud; } };
}
