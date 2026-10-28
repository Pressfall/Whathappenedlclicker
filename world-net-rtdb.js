/**
 * The Wilds online, production transport: Firebase Realtime Database. Players are signed in (their account if they
 * have one, otherwise an anonymous Firebase account) so the database rules (database.rules.json) can check who writes.
 * Same interface as world-net-dev.js; sets window.WHNetRTDB = { connect() } and fires 'whnet-rtdb-ready'.
 *
 * Setup in the Firebase console (once): Build > Realtime Database > Create database; paste database.rules.json into its
 * Rules tab; Authentication > Sign-in method > enable Anonymous. If the database is not in us-central1, copy its URL
 * (shown at the top of the Data tab) into DATABASE_URL below.
 */
import { initializeApp, getApps, getApp } from 'https://www.gstatic.com/firebasejs/12.8.0/firebase-app.js';
import { getAuth, onAuthStateChanged, signInAnonymously } from 'https://www.gstatic.com/firebasejs/12.8.0/firebase-auth.js';
import {
    getDatabase, ref, set, update, remove, push, onChildAdded, onChildChanged, onChildRemoved, onValue, onDisconnect,
    runTransaction, increment,
} from 'https://www.gstatic.com/firebasejs/12.8.0/firebase-database.js';

// The Wilds' own Firebase project (separate from the leaderboard/accounts one): its database only accepts sign-ins from the
// same project. (Web API keys are public by design; the database rules are what protect the data.)
const DATABASE_URL = 'https://whserver-5be72-default-rtdb.firebaseio.com';
const FIREBASE_CONFIG = {
    apiKey: 'AIzaSyBWB4mYRlzkiPPfq_X-4PxsZqC5iL61flQ',
    authDomain: 'whserver-5be72.firebaseapp.com',
    databaseURL: DATABASE_URL,
    projectId: 'whserver-5be72',
    messagingSenderId: '422765099580',
    appId: '1:422765099580:web:2f9f0bfe417741580e6139',
};

function waitForUser(auth) {
    return new Promise((resolve) => {
        const stop = onAuthStateChanged(auth, (u) => { stop(); resolve(u); });
    });
}
// sentinel used by the shared netcode for "add n" (both transports understand it)
const isInc = (v) => !!v && typeof v === 'object' && typeof v['.inc'] === 'number';

async function connect() {
    const app = getApps().some((x) => x.name === 'wilds') ? getApp('wilds') : initializeApp(FIREBASE_CONFIG, 'wilds');
    const auth = getAuth(app);
    let user = await waitForUser(auth);
    if (!user) {
        try { user = (await signInAnonymously(auth)).user; }
        catch (e) {
            const code = (e && e.code) || '';
            const setup = /operation-not-allowed|admin-restricted-operation|configuration-not-found/.test(code);
            const err = new Error(setup ? 'Online play needs Anonymous sign-in turned on in the Firebase console (Authentication > Sign-in method).'
                : 'Could not sign in for online play' + (code ? ' (' + code + ')' : '') + '. Check the connection and try again from the 🌐 menu.');
            err.code = code;
            throw err;
        }
    }
    const database = getDatabase(app, DATABASE_URL);
    let offset = 0;
    onValue(ref(database, '.info/serverTimeOffset'), (s) => { offset = Number(s.val()) || 0; });
    const r = (p) => ref(database, p);
    const fix = (obj) => { const out = {}; for (const k in obj) out[k] = isInc(obj[k]) ? increment(obj[k]['.inc']) : obj[k]; return out; };
    const db = {
        kind: 'rtdb', uid: user.uid,
        serverNow: () => Date.now() + offset,
        INC: (n) => ({ '.inc': n }),
        set: (p, v) => set(r(p), v).catch((e) => console.warn('wilds online:', e.code || e)),
        update: (p, v) => update(r(p), fix(v)).catch((e) => console.warn('wilds online:', e.code || e)),
        remove: (p) => remove(r(p)).catch(() => {}),
        push: (p, v) => { const k = push(r(p)); return set(k, v).then(() => k.key).catch(() => null); },
        // remove and return, atomically: only one player can pick up a loot bag
        take(p) {
            let got = null;
            return runTransaction(r(p), (cur) => { got = cur; return null; }, { applyLocally: false })
                .then((res) => (res.committed ? got : null)).catch(() => null);
        },
        onChild(p, cbs) {
            const offs = [];
            if (cbs.add) offs.push(onChildAdded(r(p), (s) => cbs.add(s.key, s.val())));
            if (cbs.change) offs.push(onChildChanged(r(p), (s) => cbs.change(s.key, s.val())));
            if (cbs.remove) offs.push(onChildRemoved(r(p), (s) => cbs.remove(s.key, s.val())));
            return () => offs.forEach((off) => off());
        },
        onValue(p, cb) { return onValue(r(p), (s) => cb(s.val())); },
        onDisconnectRemove: (p) => onDisconnect(r(p)).remove().catch(() => {}),
        cancelOnDisconnect: (p) => onDisconnect(r(p)).cancel().catch(() => {}),
        onStatus(cb) { return onValue(r('.info/connected'), (s) => cb(s.val() === true)); },
        close() {},
    };
    return db;
}

window.WHNetRTDB = { connect };
window.dispatchEvent(new Event('whnet-rtdb-ready'));
