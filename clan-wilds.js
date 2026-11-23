/**
 * The player's clan, from the Wilds (world.html). Only runs while the player is in a clan.
 *  - Wilds Hunt (a clan event: core/clan-events.js kind 'wh'): every monster defeated here while one runs is added to the
 *    clan's total, every 15 seconds and when the tab is hidden. The kill counter in the Wilds save is the source: only the
 *    rise since the last send counts (core/clan-events.js wildsKillDelta), so kills made between events never count, and a
 *    counter that jumps sends no more than WILDS_SEND_MAX at a time.
 *  - "In the Wilds" on the clan page: a heartbeat on the player's clan stats (clans/{id}/members/{name}) with their Wilds card
 *    (class, arena rating, best wave, monsters: core/clan-events.js wildsCard), once a minute while the tab is in view.
 * Payouts are not done here: the game page and the clan page pay (core/clan-events.js payEnded).
 * Firebase: the game's own project (the [DEFAULT] app, as cloud.js uses), never the Wilds' online-play app.
 */
const EV = window.WHClanEvents;
const MARK_KEY = 'whathappened_clan_wilds_mark'; // { kills, start }: the kill counter as last sent, and for which Wilds Hunt
const SEND_MS = 15000, BEAT_MS = 60000;
const CONFIG = {
    apiKey: 'AIzaSyDkrNV4bQgRHzGJ__9XqHzry7xbYuH8IuU', authDomain: 'whleaderboard.firebaseapp.com', projectId: 'whleaderboard',
    storageBucket: 'whleaderboard.firebasestorage.app', messagingSenderId: '602999414155', appId: '1:602999414155:web:541f51b97db8358be4638e',
};

const get = (k) => { try { return localStorage.getItem(k); } catch (e) { return null; } };
const set = (k, v) => { try { localStorage.setItem(k, v); } catch (e) {} };
const clanId = () => { const c = get('player_clanId'); return c && c !== 'undefined' && c !== 'null' ? c : ''; };
const username = () => String(get('player_username') || '').trim();
const state = () => { try { return window.WHW && window.WHW.game ? window.WHW.game.state : null; } catch (e) { return null; } };
const kills = () => { const s = state(); return s && s.stats ? Number(s.stats.kills) || 0 : null; };
const toast = (m) => { try { if (window.WHW && window.WHW.toast) window.WHW.toast(m); } catch (e) {} };
function readMark() { try { const m = JSON.parse(get(MARK_KEY) || 'null'); return m && typeof m === 'object' ? m : null; } catch (e) { return null; } }

let F = null, loading = null, schedUnsub = null, upcoming = [], sending = false, sentThisHunt = 0, toldHunt = 0, beatAt = 0;
async function firebase() {
    if (F) return F;
    if (!loading) loading = (async () => {
        const A = await import('https://www.gstatic.com/firebasejs/12.8.0/firebase-app.js');
        const S = await import('https://www.gstatic.com/firebasejs/12.8.0/firebase-firestore.js');
        const app = A.getApps().find((a) => a.name === '[DEFAULT]') || A.initializeApp(CONFIG);
        F = { db: S.getFirestore(app), doc: S.doc, setDoc: S.setDoc, onSnapshot: S.onSnapshot, increment: S.increment };
        return F;
    })().catch(() => { loading = null; return null; });
    return loading;
}
// the Wilds Hunt running now, or null
function hunt() { const cur = EV.current(upcoming, Date.now()); return EV.kindOf(cur) === 'wh' ? cur : null; }

async function watch() {
    if (schedUnsub || !clanId()) return;
    const f = await firebase();
    if (!f || schedUnsub) return;
    schedUnsub = f.onSnapshot(f.doc(f.db, 'events', 'state'), (snap) => {
        const d = snap && snap.exists() ? (snap.data() || {}) : {};
        upcoming = Array.isArray(d.upcoming) ? d.upcoming : [];
        const h = hunt();
        if (h && toldHunt !== EV.toMs(h.start) && clanId()) {
            toldHunt = EV.toMs(h.start);
            toast(`🌲 A Wilds Hunt is on! Every monster you defeat counts for ${get('player_clanName') || 'your clan'}.`);
        }
    }, () => { schedUnsub = null; });
}

// send the monsters defeated since the last send to the Wilds Hunt running now
async function send() {
    if (sending || !window._saveLoaded) return;
    const k = kills();
    if (k === null) return;
    const h = hunt(), start = h ? EV.toMs(h.start) : 0, mark = readMark();
    // no hunt, or a different one: the counter as it is now is where the next hunt starts counting
    if (!h || !clanId() || !username() || !mark || mark.start !== start) { set(MARK_KEY, JSON.stringify({ kills: k, start })); return; }
    const d = EV.wildsKillDelta(Number(mark.kills), k);
    if (!d.send) { if (d.mark !== mark.kills) set(MARK_KEY, JSON.stringify({ kills: d.mark, start })); return; }
    const f = await firebase();
    if (!f) return;
    sending = true;
    // marked first (another send can't count these again), put back if the write fails
    set(MARK_KEY, JSON.stringify({ kills: Number(mark.kills) + d.send, start }));
    try {
        await f.setDoc(f.doc(f.db, 'events', EV.KINDS.wh.doc), EV.contributionPatch(start, clanId(), username(), d.send, f.increment), { merge: true });
        const before = sentThisHunt;
        sentThisHunt += d.send;
        set('whathappened_clan_hunted', String((Number(get('whathappened_clan_hunted')) || 0) + d.send)); // the Monster Hunter achievement
        if (Math.floor(sentThisHunt / 50) > Math.floor(before / 50)) toast(`🌲 ${sentThisHunt} monsters for your clan's Wilds Hunt!`);
    } catch (e) { set(MARK_KEY, JSON.stringify(mark)); } finally { sending = false; }
}

// "In the Wilds" on the clan page, with this player's Wilds card
async function beat() {
    if (document.visibilityState === 'hidden' || !window._saveLoaded || !clanId() || !username() || Date.now() - beatAt < BEAT_MS - 1000) return;
    const card = EV.wildsCard(state());
    const f = await firebase();
    if (!f || !card) return;
    beatAt = Date.now();
    try { await f.setDoc(f.doc(f.db, 'clans', clanId(), 'members', username()), { wildsAt: Date.now(), wilds: card }, { merge: true }); } catch (e) { beatAt = 0; }
}

function tick() {
    if (!EV || !clanId()) return;
    watch().catch(() => {});
    send().catch(() => {});
    beat().catch(() => {});
}
if (EV) {
    setTimeout(tick, 4000);
    setInterval(tick, SEND_MS);
    document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'hidden') send().catch(() => {}); else tick(); });
    // joined or left a clan in another tab
    window.addEventListener('storage', (e) => {
        if (e.key !== 'player_clanId') return;
        if (!clanId()) { try { if (schedUnsub) schedUnsub(); } catch (err) {} schedUnsub = null; upcoming = []; }
        else tick();
    });
}
window.WHClanWilds = { send, beat, tick, hunt, _mark: readMark };
