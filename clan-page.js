/**
 * The clan page (clan.html): your clan or a preview of another one, the clan finder, the daily check-in, members, chat,
 * managing a clan, and the clan shop. The events tab is clan-events-tab.js.
 *
 * The rules come from core/: clan-roles.js (who may change what: firestore-social.rules says the same, so every write here
 * is one those rules allow), clan-levels.js (XP, perks, check-in), clan-buffs.js (the shop's buffs) and clan-events.js.
 *
 * A clan is held by Firebase sign-in ids: players with an account are signed in already (account.html); anyone else gets an
 * anonymous sign-in, enough to be a member. Creating, owning or being co-leader of a clan needs an account. Auth loads on its
 * own, so the page still shows clans if it can't (offline, a blocked host).
 *
 * The game's save is written here (Clan Points, gems, Golden): changeSave() also tells an open game tab what changed
 * (whathappened_clan_delta, read by clan-game.js), so its autosave doesn't write the old numbers back.
 */
import { initializeApp, getApps } from 'https://www.gstatic.com/firebasejs/12.8.0/firebase-app.js';
import { getFirestore, collection, addDoc, setDoc, doc, getDoc, updateDoc, arrayUnion, arrayRemove, query, where, limit, getDocs, serverTimestamp, deleteDoc,
    onSnapshot, runTransaction, increment, deleteField } from 'https://www.gstatic.com/firebasejs/12.8.0/firebase-firestore.js';
import { startEventsTab } from './clan-events-tab.js';

const firebaseConfig = {
    apiKey: 'AIzaSyDkrNV4bQgRHzGJ__9XqHzry7xbYuH8IuU',
    authDomain: 'whleaderboard.firebaseapp.com',
    projectId: 'whleaderboard',
    storageBucket: 'whleaderboard.firebasestorage.app',
    messagingSenderId: '602999414155',
    appId: '1:602999414155:web:541f51b97db8358be4638e',
    measurementId: 'G-C2FWNR7288',
};
const app = getApps().length ? getApps()[0] : initializeApp(firebaseConfig);
const db = getFirestore(app);
const Roles = window.WHClanRoles, Levels = window.WHClanLevels, Buffs = window.WHClanBuffs, EV = window.WHClanEvents;
const CHAT_SAFETY = window.WHChatSafety;
// the same Firestore for tests/browser/chat.js (and anything else on this page)
Object.assign(window, { db, doc, updateDoc, setDoc, addDoc, collection, getDoc, getDocs, onSnapshot, arrayUnion, arrayRemove, serverTimestamp, firestoreIncrement: increment });

// ---------------------------------------------------------------- who is writing
let _authReady = null, _myUid = null;
function authReady() {
    if (_authReady) return _authReady;
    _authReady = (async () => {
        let user = null;
        try {
            const A = await import('https://www.gstatic.com/firebasejs/12.8.0/firebase-auth.js');
            const auth = A.getAuth(app);
            user = await new Promise((res) => { const off = A.onAuthStateChanged(auth, (u) => { off(); res(u); }); setTimeout(() => res(auth.currentUser), 6000); });
            if (!user) { try { user = (await Promise.race([A.signInAnonymously(auth), new Promise((_, no) => setTimeout(() => no(new Error('timeout')), 8000))])).user; } catch (e) { user = null; } }
            A.onAuthStateChanged(auth, (u) => { _myUid = u ? u.uid : null; _me = u; });
        } catch (e) { user = null; }
        _me = user;
        _myUid = user ? user.uid : null;
        return user;
    })();
    return _authReady;
}
let _me = null;
// { uid, account } for the player on this page, or null when there is no sign-in
async function me() { const u = await authReady(); return u ? { uid: u.uid, account: !u.isAnonymous } : null; }
authReady();

// ---------------------------------------------------------------- small helpers
const $id = (id) => document.getElementById(id);
const ls = {
    get: (k) => { try { return localStorage.getItem(k); } catch (e) { return null; } },
    set: (k, v) => { try { localStorage.setItem(k, v); } catch (e) {} },
    del: (k) => { try { localStorage.removeItem(k); } catch (e) {} },
};
const num = (v) => { const n = Number(v); return Number.isFinite(n) ? n : 0; };
function esc(s) { return String(s == null ? '' : s).replace(/[&<>'"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', "'": '&#39;', '"': '&quot;' })[c]); }
const playerName = () => String(ls.get('player_username') || '').trim();
const myClanId = () => { const c = ls.get('player_clanId'); return c && c !== 'undefined' && c !== 'null' ? c : ''; };
const JOINED_KEY = 'whathappened_clan_joined';
function setMyClan(id, name, role) {
    ls.set('player_clanId', id); ls.set('player_clanName', name || ''); ls.set('player_clanRole', role || 'member');
}
function clearMyClan() { ['player_clanId', 'player_clanName', 'player_clanRole', JOINED_KEY].forEach(ls.del); }
const toMillis = (v) => EV.toMs(v);

// Non-blocking toasts. alert() is routed here so status messages don't freeze the page; confirm() and prompt() stay native
// for real decisions.
function notify(msg, kind) {
    const box = $id('clanToasts');
    if (!box) return;
    const text = String(msg == null ? '' : msg);
    const tone = kind || (/fail|not enough|can't|cannot|must |only |not found|not in|error|denied|permission|full|kicked|no longer/i.test(text) ? 'bad' : '');
    const el = document.createElement('div');
    el.className = 'toast' + (tone ? ' toast-' + tone : '');
    el.textContent = text;
    el.title = 'Click to dismiss';
    el.addEventListener('click', () => el.remove());
    box.appendChild(el);
    setTimeout(() => el.remove(), Math.min(12000, 3500 + text.length * 45));
}
window.alert = notify;

function fmtShort(v) {
    const n = Number(v) || 0, units = ['', 'K', 'M', 'B', 'T', 'Q', 'Qi', 'Sx', 'Sp', 'Oc', 'No', 'Dc'];
    let i = 0, x = Math.abs(n);
    while (x >= 1000 && i < units.length - 1) { x /= 1000; i++; }
    if (i === 0) return String(Math.floor(n));
    if (x >= 1000) return n.toExponential(2);
    return x.toFixed(x < 100 ? 2 : 0).replace(/\.0+$|(\.\d*[1-9])0+$/, '$1') + units[i];
}
function timeAgo(ms) {
    const s = Math.max(0, (Date.now() - ms) / 1000);
    if (s < 45) return 'just now';
    if (s < 3600) return Math.round(s / 60) + 'm ago';
    if (s < 86400) return Math.round(s / 3600) + 'h ago';
    if (s < 86400 * 30) return Math.round(s / 86400) + 'd ago';
    return new Date(ms).toLocaleDateString();
}
function fmtLeft(ms) {
    const m = Math.max(1, Math.ceil(ms / 60000));
    if (m >= 1440) return Math.floor(m / 1440) + 'd ' + Math.floor((m % 1440) / 60) + 'h';
    return m >= 60 ? Math.floor(m / 60) + 'h ' + (m % 60) + 'm' : m + 'm';
}
function msUntilUtcMidnight() { const d = new Date(); return Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate() + 1) - d.getTime(); }
const RARITY_HEX = { common: '#bfc7c9', uncommon: '#6bd26b', rare: '#4da6ff', epic: '#b86cff', legendary: '#ffb84d', mythic: '#ff5bd0' };
function titleColor(t) {
    let r = null;
    try { r = window.WHA && window.WHA.titleRarity(t); } catch (e) {}
    if (!r) { try { const ul = JSON.parse(ls.get('unlocked_titles') || '[]'); const f = ul.find((x) => String((x && x.name) || x).toLowerCase() === String(t).toLowerCase()); r = f && f.rarity; } catch (e) {} }
    return RARITY_HEX[r] || RARITY_HEX.common;
}
function lockedPanel(icon, title, text) { return `<div class="card locked-panel"><div class="lp-icon">${icon}</div><h2>${esc(title)}</h2><p class="muted">${esc(text)}</p></div>`; }
const skeleton = (kind, n) => (window.WHSk ? window.WHSk[kind](n) : '<div class="muted">Loading…</div>');

// ---- the game's save ----
function readSave() { try { return JSON.parse(ls.get('whathappened_save') || ls.get('whathappened_save_v1') || 'null'); } catch (e) { return null; } }
function writeSave(s) { const out = JSON.stringify(s); localStorage.setItem('whathappened_save', out); try { localStorage.setItem('whathappened_save_v1', out); } catch (e) {} }
const DELTA_FIELDS = ['diamonds', 'clanPoints', 'goldenWhat', 'totalGoldenEver'];
// Change the save with fn(save) (return false to cancel); an open game tab is told the difference (clan-game.js). Returns the
// changed save, or null when there is no save or fn cancelled.
function changeSave(fn) {
    const s = readSave();
    if (!s) return null;
    const before = {};
    DELTA_FIELDS.forEach((k) => { before[k] = num(s[k]); });
    if (fn(s) === false) return null;
    writeSave(s);
    const delta = { id: Date.now().toString(36) + Math.random().toString(36).slice(2, 8), at: Date.now() };
    DELTA_FIELDS.forEach((k) => { const d = num(s[k]) - before[k]; if (d) delta[k] = d; });
    ls.set('whathappened_clan_delta', JSON.stringify(delta));
    return s;
}
const clanPointsHave = () => num((readSave() || {}).clanPoints);
// add Clan Points (negative to spend); the new balance, or null when there isn't enough (or no save)
function changeClanPoints(delta) {
    let left = null;
    changeSave((s) => { const have = num(s.clanPoints); if (have + delta < 0) return false; s.clanPoints = have + delta; left = s.clanPoints; return true; });
    return left;
}
function clansUnlocked() { return num(ls.get('whathappened_prestige_times')) >= 1 || num((readSave() || {}).prestigeTimes) >= 1; }
function checkClanAchievements() {
    try {
        if (!window.WHA) return;
        window.WHA.checkAll(window.WHA.snapshot()).forEach((a, i) => setTimeout(() => notify(`🏆 ${a.name}: ${a.desc} Title: ${a.title}`, 'gold'), i * 700));
    } catch (e) {}
}
function ensureUsername() {
    let u = playerName().slice(0, 32);
    if (!u) {
        u = String(prompt('Choose a username (max 32 characters):', '') || '').trim().slice(0, 32);
        if (!u) return null;
        ls.set('player_username', u);
    }
    return u;
}
async function clanSystemMessage(clanId, message, color, extra) {
    try { await addDoc(collection(db, 'clan_chat'), Object.assign({ clanId, name: 'SYSTEM', message, createdAt: serverTimestamp(), system: true, color: color || 'green' }, extra || {})); } catch (e) {}
}
const setProfile = (name, data) => (name ? setDoc(doc(db, 'profiles', name), data, { merge: true }).catch(() => {}) : Promise.resolve());

// ---------------------------------------------------------------- reading a clan document
// A claimed clan's members, leaders and owner come from its sign-in entries (the old name lists are only kept for older
// pages). A player who joined again from another sign-in has two entries under one name: they show once, at the higher rank.
function normalizeClan(c) {
    if (!c || !Roles.claimed(c)) return c;
    const roles = c.roles || {}, names = c.names || {}, byName = new Map();
    for (const u of Object.keys(roles)) {
        const n = names[u], r = Roles.roleOf(c, u);
        if (typeof n !== 'string' || !r) continue;
        const prev = byName.get(n);
        if (!prev || Roles.rank(r) > Roles.rank(Roles.roleOf(c, prev))) byName.set(n, u);
    }
    const uids = [...byName.values()];
    return Object.assign({}, c, {
        members: [...byName.keys()], owner: names[c.ownerUid] || c.owner,
        leaders: uids.filter((u) => u === c.ownerUid || roles[u] === 'co-leader').map((u) => names[u]),
    });
}
const uidsOfName = (c, name) => Object.keys((c && c.names) || {}).filter((u) => c.names[u] === name && Roles.roleOf(c, u));
function isMemberOf(c, name) {
    if (Roles.claimed(c)) return !!(_myUid && Roles.roleOf(c, _myUid));
    return !!name && Array.isArray(c.members) && c.members.includes(name);
}
// stored role keys stay as they are in existing data; this only fixes how one reads on screen
function roleLabel(role) { return String(role || '') === 'eleite member' ? 'elite member' : String(role || 'member'); }
const roleRank = (r) => Roles.rank(r);
function viewerRoleFor(c, name) {
    if (c && Roles.claimed(c)) return (_myUid && Roles.roleOf(c, _myUid)) || 'member';
    if (!name || !c) return 'member';
    if (name === c.owner) return 'leader';
    if (Array.isArray(c.leaders) && c.leaders.includes(name)) return 'co-leader';
    const p = _view.membersData && _view.membersData.profiles[name];
    const r = (p && p.clanRole) || ls.get('player_clanRole') || 'member';
    return r === 'leader' || r === 'co-leader' ? 'member' : r;
}
function memberRole(c, name, p) {
    if (Roles.claimed(c)) { const us = uidsOfName(c, name); return us.map((u) => Roles.roleOf(c, u)).sort((a, b) => roleRank(b) - roleRank(a))[0] || 'member'; }
    if (name === c.owner) return 'leader';
    if (Array.isArray(c.leaders) && c.leaders.includes(name)) return 'co-leader';
    const r = (p && p.clanRole) || 'member';
    return r === 'leader' || r === 'co-leader' ? 'member' : r;
}
const memberCount = (c) => (Array.isArray(c.members) ? c.members.length : 0);

// ---- icons ----
const CLAN_ICONS = [
    { id: 'default', level: 1, label: 'Default', emoji: '⚔' }, { id: 'shield', level: 3, label: 'Shield', emoji: '🛡' }, { id: 'crown', level: 5, label: 'Crown', emoji: '👑' },
    { id: 'dragon', level: 7, label: 'Dragon', emoji: '🐉' }, { id: 'star', level: 10, label: 'Star', emoji: '⭐' }, { id: 'fire', level: 12, label: 'Fire', emoji: '🔥' },
    { id: 'gem', level: 15, label: 'Gem', emoji: '💎' }, { id: 'trophy', level: 18, label: 'Trophy', emoji: '🏆' }, { id: 'max', level: 20, label: 'Elite', emoji: '🌟' },
];
// bought once in the clan shop, for the whole clan
const CLAN_SHOP_ICONS = [
    { id: 'skull', label: 'Skull', emoji: '💀', cost: 350 }, { id: 'moon', label: 'Moon', emoji: '🌙', cost: 400 }, { id: 'lightning', label: 'Lightning', emoji: '⚡', cost: 450 },
    { id: 'heart', label: 'Heart', emoji: '❤️', cost: 500 }, { id: 'anchor', label: 'Anchor', emoji: '⚓', cost: 550 }, { id: 'rocket', label: 'Rocket', emoji: '🚀', cost: 600 },
    { id: 'crystal', label: 'Crystal', emoji: '🔮', cost: 700 }, { id: 'phoenix', label: 'Phoenix', emoji: '🔥', cost: 800 },
];
const CUSTOM_LOGO_CP_COST = 5000;
function iconFor(c) {
    const level = Levels.levelFromXp(c.clanXp);
    const fromLevel = CLAN_ICONS.find((ic) => ic.id === c.clanIcon);
    if (fromLevel && level >= fromLevel.level) return fromLevel;
    const owned = Array.isArray(c.clanShopIconsUnlocked) ? c.clanShopIconsUnlocked : [];
    const fromShop = CLAN_SHOP_ICONS.find((ic) => ic.id === c.clanIcon && owned.includes(ic.id));
    if (fromShop) return fromShop;
    let out = CLAN_ICONS[0];
    for (const ic of CLAN_ICONS) if (level >= ic.level) out = ic;
    return c.clanIcon ? CLAN_ICONS[0] : out;
}
function isEmbeddedLogo(url) { return typeof url === 'string' && url.length <= 900000 && /^data:image\/(png|jpeg|webp|gif);base64,[A-Za-z0-9+/=]+$/.test(url); }
function clanIconHtml(c) {
    // the logo field is writable by any member's browser: only an image embedded in the document (what the shop uploads) is
    // shown, never a link to another site, which would tell that site who is looking at the clan
    if (c.clanIcon === 'custom' && isEmbeddedLogo(c.clanCustomLogoUrl)) return `<img src="${esc(c.clanCustomLogoUrl)}" alt="">`;
    return `<span>${iconFor(c).emoji}</span>`;
}

// ---------------------------------------------------------------- the clan view
let _view = freshView();
function freshView() { return { id: null, member: false, shellFor: null, doc: null, raw: null, viewerRole: 'member', membersSig: '', membersAt: 0, membersData: null, chat: [], ui: {} }; }
let _clanUnsub = null, _chatUnsub = null;
function closeClanView() {
    try { if (_clanUnsub) _clanUnsub(); } catch (e) {}
    try { if (_chatUnsub) _chatUnsub(); } catch (e) {}
    _clanUnsub = null; _chatUnsub = null;
    _view = freshView();
    const area = $id('clanDetailArea');
    if (area) area.innerHTML = '';
}

async function loadClanDetail(clanId) {
    const area = $id('clanDetailArea');
    if (!area || !clanId) return;
    closeClanView();
    _view.id = clanId;
    area.innerHTML = '<div class="card">' + skeleton('panel', 6) + '</div>';
    await authReady(); // so the first view already knows who I am (the placeholder shows meanwhile)
    if (_view.id !== clanId) return; // another clan was opened while signing in
    _clanUnsub = onSnapshot(doc(db, 'clans', clanId), async (snap) => {
        try {
            if (_view.id !== clanId) return;
            if (!snap.exists()) return handleMissingClan(clanId);
            const raw = snap.data() || {};
            const c = normalizeClan(raw);
            const name = playerName();
            const isMember = isMemberOf(c, name);
            if (checkKicked(clanId, raw)) return;
            _view.doc = c; _view.raw = raw; _view.member = isMember;
            _view.viewerRole = viewerRoleFor(c, name);
            if (isMember) {
                // what the game and the achievements read: level, name and role (a promotion made by someone else shows too)
                ls.set('whathappened_clan_level', String(Levels.levelFromXp(c.clanXp)));
                if (myClanId() === clanId) { ls.set('player_clanName', c.name || ''); ls.set('player_clanRole', _view.viewerRole); updatePlayerClanStatus(); }
            }
            if (_view.shellFor !== (isMember ? 'member' : 'guest')) renderClanShell(clanId, isMember);
            renderClanBanner(clanId, c, isMember);
            renderCheckin(clanId, c);
            await refreshMembers(clanId, c);
            maybeClaim(clanId, raw);
            if (isMember) checkClanAchievements();
        } catch (e) { console.error('clan snapshot render failed', e); }
    }, (err) => { console.warn('clan snapshot failed', err); area.innerHTML = '<div class="card"><div class="muted">Couldn\'t load this clan. Try again in a moment.</div></div>'; });
}
async function handleMissingClan(clanId) {
    const name = playerName();
    if (name && myClanId() === String(clanId)) {
        // the stored clan may be stale: follow the profile to the clan the player is really in
        try {
            const prof = await getDoc(doc(db, 'profiles', name));
            const p = prof.exists() ? (prof.data() || {}) : {};
            if (p.clanId && p.clanId !== String(clanId) && (await membershipOf(p.clanId)) !== false) {
                setMyClan(String(p.clanId), p.clanName || '', p.clanRole || 'member');
                updatePlayerClanStatus();
                loadClanDetail(p.clanId);
                return;
            }
        } catch (e) {}
        clearMyClan();
        updatePlayerClanStatus();
        notify('Your clan no longer exists.', 'bad');
        showRecommendedClans();
    } else notify('That clan no longer exists.', 'bad');
    closeClanView();
}
// Is this player in that clan, by its document? true / false, or null when it can't be told (offline, or no member list)
async function membershipOf(clanId) {
    try {
        const s = await getDoc(doc(db, 'clans', clanId));
        if (!s.exists()) return false;
        const d = s.data() || {};
        if (Roles.claimed(d) && _myUid && Roles.roleOf(d, _myUid)) return true;
        return Roles.memberByName(d, playerName());
    } catch (e) { return null; }
}

function renderClanShell(clanId, isMember) {
    const area = $id('clanDetailArea');
    if (!area) return;
    area.innerHTML = `
      <section class="card clan-banner"><div id="bannerTop"></div><div class="manage-panel" id="managePanel" hidden></div><div id="bannerLevel"></div></section>
      <div class="clan-cols">
        <div class="clan-col">
          ${isMember ? '<section class="card checkin-card" id="checkinCard"></section>' : ''}
          <section class="card members-card">
            <div class="sec-head"><h2>Members <span class="count" id="memberCount"></span></h2><span class="online-count" id="onlineCount"></span></div>
            <div id="membersList" class="members-list">${skeleton('rows', 6)}</div>
          </section>
        </div>
        <section class="card chat-card">
          <div class="sec-head"><h2>Clan chat</h2>${isMember ? '<label class="chat-safe" title="Hides swear words in chat. On unless you turn it off."><input type="checkbox" id="clanChatSafe"> Safe mode</label>' : ''}</div>
          ${isMember
            ? '<div id="clanChatPinned" class="pinned"></div><div id="clanChatBox" class="chat-box" aria-live="polite"></div><form class="chat-form" id="clanChatForm"><input id="clanChatInput" type="text" maxlength="500" placeholder="Say something to your clan…" autocomplete="off" aria-label="Message your clan"><button id="clanChatSend" class="btn btn-primary" type="submit">Send</button></form>'
            : '<div class="chat-locked"><span>💬</span><p class="muted">Join the clan to read and send messages.</p></div>'}
        </section>
      </div>`;
    _view.shellFor = isMember ? 'member' : 'guest';
    _view.ui.manage = false;
    const list = $id('membersList');
    if (list) list.addEventListener('click', (e) => onMemberListClick(e, clanId));
    if (isMember) {
        $id('clanChatForm').addEventListener('submit', (e) => { e.preventDefault(); sendClanChat(clanId); });
        const safe = $id('clanChatSafe');
        if (safe) { safe.checked = CHAT_SAFETY.isOn(localStorage); safe.addEventListener('change', () => { CHAT_SAFETY.setOn(localStorage, safe.checked); renderChat(); }); }
        [$id('clanChatBox'), $id('clanChatPinned')].forEach((el) => el && el.addEventListener('click', (e) => onChatClick(e)));
        loadClanChat(clanId);
    } else {
        try { if (_chatUnsub) _chatUnsub(); } catch (e) {}
        _chatUnsub = null;
    }
}

function unclaimedNote(c) {
    if (Roles.claimed(c)) return '';
    const mine = playerName() && playerName() === c.owner;
    return `<div class="clan-unclaimed" role="note">🔓 ${mine ? 'Sign in to an account (the Account page) and open this page again to claim your clan. Until then it can\'t be managed, so nobody else can take it over.'
        : 'This clan hasn\'t been claimed yet. Its leader, ' + esc(c.owner || '?') + ', needs to sign in to an account and open this page. Until then nobody can manage it. Check-ins and events still work.'}</div>`;
}
function renderClanBanner(clanId, c, isMember) {
    const top = $id('bannerTop'), lvlEl = $id('bannerLevel');
    if (!top || !lvlEl) return;
    const name = playerName(), role = _view.viewerRole;
    const n = memberCount(c), max = c.maxMembers || 30;
    // an unclaimed clan can't be managed until its owner claims it (the rules refuse it; the banner says so)
    const canManage = isMember && Roles.claimed(c) && Roles.canEditDescription(role);
    const founded = toMillis(c.createdAt);
    const myClan = myClanId();
    const joinable = !isMember && !myClan && n < max && clansUnlocked();
    const joinNote = isMember ? '' : myClan ? 'Leave your clan to join this one.' : n >= max ? 'This clan is full.' : !clansUnlocked() ? 'Clans unlock after your first prestige.' : '';
    const iOwn = isMember && role === 'leader';
    top.innerHTML = `
      <div class="banner-main">
        <div class="emblem">${clanIconHtml(c)}</div>
        <div class="banner-text">
          <div class="banner-title"><h2>${esc(c.name || 'Clan')}</h2><span class="lvl-badge">Lv ${Levels.levelFromXp(c.clanXp)}</span>${isMember ? '<span class="tag">Your clan</span>' : ''}</div>
          <div class="banner-meta">👑 ${esc(c.owner || '?')} · 👥 ${n}/${max} members${founded ? ' · Founded ' + timeAgo(founded) : ''}</div>
          <p class="banner-desc">${c.description ? esc(c.description) : (canManage ? '<span class="muted">No description yet. Add one under ⚙️ Manage so people know what your clan is about.</span>' : '')}</p>
        </div>
        <div class="banner-actions" id="clanHeaderActions">
          ${isMember ? '' : `<button class="btn btn-primary" id="joinClanBtn"${joinable ? '' : ' disabled'}>Join clan</button>`}
          ${isMember ? '' : '<button class="btn btn-ghost btn-sm" id="closeClanPreview">✕ Close</button>'}
          ${canManage ? `<button class="btn btn-ghost btn-sm" id="manageClanBtn" aria-expanded="${_view.ui.manage ? 'true' : 'false'}">⚙️ Manage</button>` : ''}
          ${isMember ? '<button class="btn btn-danger btn-sm" id="leaveClanBtn">Leave</button>' : ''}
          ${joinNote ? `<span class="muted small">${esc(joinNote)}</span>` : ''}
        </div>
      </div>${unclaimedNote(c)}`;
    const lvl = Levels.levelInfo(c.clanXp);
    const perk = Levels.perk(lvl.level), next = lvl.level < Levels.MAX_LEVEL ? Levels.perk(lvl.level + 1) : null;
    const now = Date.now(), active = Buffs.resolveActive(c, now);
    lvlEl.innerHTML = `
      <div class="banner-level">
        <div class="lvl-row"><b>Level ${lvl.level}</b><span class="muted">${lvl.level >= Levels.MAX_LEVEL ? 'Max level!' : `${Math.floor(lvl.xpInLevel).toLocaleString()} / ${Math.ceil(lvl.xpForNext).toLocaleString()} XP to level ${lvl.level + 1}`}</span><button type="button" class="link-btn" id="perksToggle" aria-expanded="${_view.ui.perks ? 'true' : 'false'}">All level perks ${_view.ui.perks ? '▴' : '▾'}</button></div>
        <div class="xp-bar" role="progressbar" aria-label="Clan XP" aria-valuemin="0" aria-valuemax="100" aria-valuenow="${Math.round(lvl.pct)}"><i style="width:${lvl.pct}%"></i></div>
        <div class="perk-row">
          ${Levels.perkParts(perk).map((t) => `<span class="perk">${esc(t)}</span>`).join('') || '<span class="perk dim">No level perks yet</span>'}
          ${next ? `<span class="perk next">Level ${lvl.level + 1}: ${esc(Levels.perkText(next))}</span>` : ''}
        </div>
        ${active.length ? `<div class="perk-row">${active.map((b) => { const def = Buffs.byId(b.id); return `<span class="perk buff">${def.icon} ${esc(def.name)} · ${fmtLeft(b.expiresAt - now)} left</span>`; }).join('')}</div>` : ''}
        <div class="perk-list" id="perkList"${_view.ui.perks ? '' : ' hidden'}>${Levels.PERKS.slice(1).map((p, i) => { const L = i + 1; return `<div class="${L === lvl.level ? 'cur' : L < lvl.level ? 'done' : ''}"><span>Level ${L}</span><span>${esc(Levels.perkText(p) + (L === Levels.MAX_LEVEL ? ' (max)' : ''))}</span></div>`; }).join('')}</div>
      </div>`;
    const on = (id, fn) => { const el = $id(id); if (el) el.addEventListener('click', fn); };
    on('joinClanBtn', () => joinClan(clanId));
    on('closeClanPreview', () => { closeClanView(); const fa = $id('findArea'); if (fa) fa.scrollIntoView({ behavior: 'smooth', block: 'start' }); });
    on('leaveClanBtn', () => { if (confirm(iOwn ? 'Leave your clan? Leadership passes to the highest-ranked member with an account (or the clan is deleted if you are the last one).' : `Leave ${c.name || 'this clan'}?`)) leaveClan(clanId); });
    on('manageClanBtn', () => { _view.ui.manage = !_view.ui.manage; fillManagePanel(clanId); renderClanBanner(clanId, _view.doc, _view.member); });
    on('perksToggle', () => { _view.ui.perks = !_view.ui.perks; renderClanBanner(clanId, _view.doc, _view.member); });
}

// built when opened (not on every update), so what's being typed isn't wiped when the clan changes
function fillManagePanel(clanId) {
    const panel = $id('managePanel'), c = _view.doc;
    if (!panel || !c) return;
    panel.hidden = !_view.ui.manage;
    if (panel.hidden) { panel.innerHTML = ''; return; }
    const role = _view.viewerRole, isOwner = role === 'leader', canEdit = Roles.canEditDescription(role);
    const lvl = Levels.levelFromXp(c.clanXp);
    const owned = Array.isArray(c.clanShopIconsUnlocked) ? c.clanShopIconsUnlocked : [];
    const icons = CLAN_ICONS.filter((ic) => lvl >= ic.level).concat(CLAN_SHOP_ICONS.filter((ic) => owned.includes(ic.id)));
    if (isEmbeddedLogo(c.clanCustomLogoUrl)) icons.push({ id: 'custom', label: 'Custom logo', emoji: '🖼️' });
    const cur = c.clanIcon || 'default';
    panel.innerHTML = `
      <div class="manage-grid">
        ${canEdit ? `<label class="field"><span>Description</span><textarea id="descInput" maxlength="400" rows="3" placeholder="What's your clan about? Activity, goals, rules…">${esc(c.description || '')}</textarea></label>` : ''}
        ${canEdit ? `<label class="field"><span>Clan icon</span><select id="clanIconSelect">${icons.map((ic) => `<option value="${ic.id}"${ic.id === cur ? ' selected' : ''}>${ic.emoji} ${esc(ic.label)}</option>`).join('')}</select><small class="muted">More icons unlock with clan levels and in the Clan Shop.</small></label>` : ''}
      </div>
      <div class="manage-actions">
        ${canEdit ? '<button class="btn btn-primary btn-sm" id="saveDescBtn">Save description</button>' : ''}
        ${isOwner ? '<button class="btn btn-danger btn-sm" id="deleteClanBtn">Delete clan</button>' : ''}
      </div>
      ${isOwner ? '<p class="muted small">To hand the clan to someone else, open the ⋯ menu next to their name.</p>' : ''}`;
    const save = $id('saveDescBtn');
    if (save) save.addEventListener('click', async () => {
        const val = String($id('descInput').value || '').trim().slice(0, 400);
        save.disabled = true;
        try { await updateDoc(doc(db, 'clans', clanId), { description: val }); notify('Description saved.', 'good'); _view.ui.manage = false; fillManagePanel(clanId); renderClanBanner(clanId, _view.doc, _view.member); }
        catch (e) { notify('Saving the description failed.', 'bad'); save.disabled = false; }
    });
    const sel = $id('clanIconSelect');
    if (sel) sel.addEventListener('change', async () => {
        try { await updateDoc(doc(db, 'clans', clanId), { clanIcon: sel.value }); notify('Clan icon updated.', 'good'); }
        catch (e) { notify('Changing the icon failed.', 'bad'); }
    });
    const del = $id('deleteClanBtn');
    if (del) del.addEventListener('click', () => { if (confirm(`Delete ${c.name || 'this clan'} for everyone? This can't be undone.`)) deleteClan(clanId); });
}

// ---- the daily check-in (days are UTC, so the whole clan shares one) ----
const CHECKIN_KEY = 'whathappened_clan_checkin';
function readCheckinState() { try { return JSON.parse(ls.get(CHECKIN_KEY) || '{}') || {}; } catch (e) { return {}; } }
function checkedInToday(c) { const day = Levels.utcDay(Date.now()); return c.checkin && c.checkin.day === day && Array.isArray(c.checkin.names) ? c.checkin.names : []; }
function renderCheckin(clanId, c) {
    const card = $id('checkinCard');
    if (!card) return;
    const now = Date.now(), names = checkedInToday(c), done = names.includes(playerName());
    const st = readCheckinState(), streak = Levels.currentStreak(st, now), next = Levels.nextStreak(st, now), n = memberCount(c);
    card.innerHTML = `
      <div class="sec-head"><h2>Daily check-in</h2><span class="muted small">Resets in ${fmtLeft(msUntilUtcMidnight())}</span></div>
      <p class="muted">Check in once a day: your clan gets <b>+${Levels.CHECKIN_XP} XP</b> and you get Clan Points. Keep a streak going for up to ${Levels.checkinReward(99)} CP a day.</p>
      <div class="checkin-row">
        ${done
            ? `<div class="checked">✓ Checked in today${streak > 1 ? ` · 🔥 ${streak}-day streak` : ''}</div>`
            : `<button class="btn btn-gold" id="checkinBtn">Check in · +${Levels.checkinReward(next)} CP</button>${next > 1 ? `<span class="muted">🔥 Day ${next} of your streak</span>` : ''}`}
      </div>
      <div class="checkin-who"><div class="bar"><i style="width:${n ? Math.min(100, names.length / n * 100) : 0}%"></i></div><span class="muted small">${names.length} of ${n} member${n === 1 ? '' : 's'} checked in today</span></div>`;
    const btn = $id('checkinBtn');
    if (btn) btn.addEventListener('click', () => clanCheckIn(clanId));
}
async function clanCheckIn(clanId) {
    const name = ensureUsername();
    if (!name) return;
    const btn = $id('checkinBtn');
    if (btn) btn.disabled = true;
    const day = Levels.utcDay(Date.now());
    let already = false, before = 1, after = 1, clanName = '';
    try {
        await runTransaction(db, async (tx) => {
            const ref = doc(db, 'clans', clanId), snap = await tx.get(ref);
            if (!snap.exists()) throw new Error('Clan not found');
            const d = snap.data() || {};
            clanName = d.name || '';
            if (!isMemberOf(normalizeClan(d), name)) throw new Error('you are not in this clan');
            const names = d.checkin && d.checkin.day === day && Array.isArray(d.checkin.names) ? d.checkin.names.slice() : [];
            if (names.includes(name)) { already = true; return; }
            names.push(name);
            const xp = num(d.clanXp);
            before = Levels.levelFromXp(xp); after = Levels.levelFromXp(xp + Levels.CHECKIN_XP);
            tx.update(ref, { checkin: { day, names }, clanXp: xp + Levels.CHECKIN_XP });
        });
    } catch (e) { notify('Check-in failed: ' + (e.message || 'try again'), 'bad'); if (btn) btn.disabled = false; return; }
    if (already) notify('You already checked in today.');
    else {
        const st = readCheckinState(), streak = Levels.nextStreak(st, Date.now());
        ls.set(CHECKIN_KEY, JSON.stringify({ day, streak, best: Math.max(num(st.best), streak) }));
        const cp = Levels.checkinReward(streak);
        if (changeClanPoints(cp) === null) notify(`Checked in! ${clanName || 'Your clan'} got +${Levels.CHECKIN_XP} XP. (No saved game was found for your ${cp} CP: play the game once first.)`, 'good');
        else notify(`Checked in! ${clanName || 'Your clan'} got +${Levels.CHECKIN_XP} XP and you got ${cp} CP${streak > 1 ? ` (🔥 ${streak}-day streak)` : ''}.`, 'good');
        if (after > before) clanSystemMessage(clanId, `🎉 ${clanName} reached level ${after}!`, 'gold');
    }
    if (_view.doc) renderCheckin(clanId, _view.doc);
    checkClanAchievements();
}

// ---- members ----
async function refreshMembers(clanId, c, force) {
    const members = (Array.isArray(c.members) ? c.members : []).slice(0, 100);
    const sig = JSON.stringify([members, c.owner, c.leaders, c.roles]);
    if (force || sig !== _view.membersSig || Date.now() - _view.membersAt > 60000 || !_view.membersData) {
        _view.membersSig = sig; _view.membersAt = Date.now();
        const profiles = {}, stats = {};
        try { (await getDocs(query(collection(db, 'profiles'), where('clanId', '==', clanId), limit(200)))).forEach((d) => { profiles[d.id] = d.data() || {}; }); } catch (e) { console.warn('member profiles failed', e); }
        try { (await getDocs(collection(db, 'clans', clanId, 'members'))).forEach((d) => { stats[d.id] = d.data() || {}; }); } catch (e) { console.warn('member stats failed', e); }
        if (_view.id !== clanId) return;
        _view.membersData = { profiles, stats };
        _view.viewerRole = viewerRoleFor(_view.doc || c, playerName());
    }
    renderMembers(clanId, _view.doc || c);
}
function reloadMembers(clanId) { if (_view.id === clanId && _view.doc) refreshMembers(clanId, _view.doc, true); }
function renderMembers(clanId, c) {
    const list = $id('membersList');
    if (!list) return;
    const name = playerName(), data = _view.membersData || { profiles: {}, stats: {} };
    const viewer = _view.viewerRole, isMember = _view.member, isOwnerViewer = isMember && viewer === 'leader';
    const members = (Array.isArray(c.members) ? c.members : []).slice(0, 100);
    const checked = new Set(checkedInToday(c));
    const donated = c.cpDonated && typeof c.cpDonated === 'object' ? c.cpDonated : {};
    const now = Date.now();
    const rows = members.map((m) => {
        const p = data.profiles[m] || {}, st = data.stats[m] || {};
        return { name: m, role: memberRole(c, m, p), title: String(p.title || ''), cps: num(st.lastCps),
            golden: num(st.gpoints != null ? st.gpoints : (p.goldenWhat != null ? p.goldenWhat : p.golden)),
            seen: num(st.lastUpdate), checked: checked.has(m), donated: num(donated[m]),
            acct: Roles.claimed(c) ? uidsOfName(c, m).some((u) => c.acct && c.acct[u] === true) : false };
    }).sort((a, b) => roleRank(b.role) - roleRank(a.role) || b.cps - a.cps || a.name.localeCompare(b.name));
    const online = rows.filter((r) => now - r.seen < 120000).length;
    const countEl = $id('memberCount');
    if (countEl) countEl.textContent = `${members.length}/${c.maxMembers || 30}`;
    const onEl = $id('onlineCount');
    if (onEl) onEl.innerHTML = online ? `<span class="dot on"></span>${online} online` : '';
    const open = _view.ui.openMenu;
    list.innerHTML = rows.map((r) => {
        const isOn = now - r.seen < 120000;
        const seenText = isOn ? 'Online' : r.seen ? 'Seen ' + timeAgo(r.seen) : 'Not seen yet';
        const actions = [];
        if (isMember && r.name !== name && Roles.claimed(c)) {
            for (const role of ['co-leader', 'elder', 'eleite member', 'member']) {
                if (role === r.role || !Roles.canAssignRole(viewer, role) || !Roles.canAssignRole(viewer, r.role) || r.role === 'leader') continue;
                if (role === 'co-leader' && !r.acct) continue; // co-leaders need an account
                actions.push(`<button type="button" data-act="role" data-role="${role}">${roleRank(role) > roleRank(r.role) ? 'Promote' : 'Demote'} to ${esc(roleLabel(role))}</button>`);
            }
            if (isOwnerViewer && r.acct) actions.push('<button type="button" data-act="owner">👑 Make clan leader</button>');
            if (Roles.canKick(viewer, r.role, r.role === 'leader')) actions.push('<button type="button" data-act="kick" class="danger">Kick from clan</button>');
        }
        const stats = [r.cps ? `⚡ ${fmtShort(r.cps)} CPS` : '', `🪙 ${fmtShort(r.golden)} Golden`, r.donated ? `🤝 ${fmtShort(r.donated)} CP given` : ''].filter(Boolean).join(' · ');
        return `<div class="member${r.name === name ? ' is-me' : ''}" data-name="${esc(r.name)}">
        <span class="dot ${isOn ? 'on' : (r.seen && now - r.seen < 86400000 ? 'recent' : '')}" title="${esc(seenText)}"></span>
        <div class="m-main">
          <div class="m-name">${r.title ? `<span class="m-title" style="color:${titleColor(r.title)}">${esc(r.title)}</span>` : ''}<b>${esc(r.name)}</b>${r.name === name ? '<span class="muted small">(you)</span>' : ''}<span class="role role-${esc(roleLabel(r.role).replace(/\s+/g, '-'))}">${esc(roleLabel(r.role))}</span>${r.checked ? '<span class="tag good" title="Checked in today">✓ in</span>' : ''}</div>
          <div class="m-stats">${stats} · <span class="${isOn ? 'online' : 'muted'}">${esc(seenText)}</span></div>
        </div>
        ${actions.length ? `<div class="m-actions"><button type="button" class="icon-btn" data-act="menu" aria-label="Manage ${esc(r.name)}" aria-expanded="${open === r.name}">⋯</button><div class="m-menu"${open === r.name ? '' : ' hidden'}>${actions.join('')}</div></div>` : ''}
      </div>`;
    }).join('') || '<div class="muted">No members.</div>';
}
function onMemberListClick(e, clanId) {
    const btn = e.target.closest('[data-act]');
    if (!btn) return;
    const row = btn.closest('.member'), target = row && row.dataset.name;
    if (!target) return;
    const act = btn.dataset.act;
    if (act === 'menu') {
        _view.ui.openMenu = _view.ui.openMenu === target ? null : target;
        document.querySelectorAll('#membersList .m-menu').forEach((m) => { m.hidden = m.closest('.member').dataset.name !== _view.ui.openMenu; });
        document.querySelectorAll('#membersList [data-act="menu"]').forEach((b) => b.setAttribute('aria-expanded', String(b.closest('.member').dataset.name === _view.ui.openMenu)));
        // open upward when there isn't room below inside the scrolling list
        const menu = row.querySelector('.m-menu'), list = $id('membersList');
        if (menu && !menu.hidden && list) menu.classList.toggle('up', row.getBoundingClientRect().bottom + menu.offsetHeight + 8 > list.getBoundingClientRect().bottom);
        return;
    }
    _view.ui.openMenu = null;
    if (act === 'role') promoteMember(clanId, target, btn.dataset.role);
    else if (act === 'kick') { if (confirm(`Kick ${target} from the clan?`)) kickMember(clanId, target, (prompt('A reason they will see (optional):', '') || '').trim().slice(0, 200)); else reloadMembers(clanId); }
    else if (act === 'owner') { if (confirm(`Make ${target} the clan leader? You'll become a co-leader.`)) transferOwnership(clanId, target); else reloadMembers(clanId); }
}
// close an open member menu when clicking anywhere else
document.addEventListener('click', (e) => {
    if (_view.ui.openMenu && !e.target.closest('.m-actions')) { _view.ui.openMenu = null; document.querySelectorAll('#membersList .m-menu').forEach((m) => { m.hidden = true; }); }
});

// ---- chat ----
// Chat safety (core/chat-safety.js, shared with the game's chat and the Wilds): every row shows its name and message through
// chatName/chatText (swear filter on unless turned off), repeats in a row show once with a count, and sending goes through
// chatAllowed (send limits on this page).
const chatLimiter = CHAT_SAFETY.limiter();
const chatText = (raw) => esc(CHAT_SAFETY.display(String(raw || ''), CHAT_SAFETY.isOn(localStorage)));
const chatName = (raw) => esc(CHAT_SAFETY.display(String(raw || 'Anon'), CHAT_SAFETY.isOn(localStorage)));
const collapseChat = (list) => CHAT_SAFETY.collapse(list, (m) => ({ name: m && (m.system ? '\u0000system' : m.name), message: m && m.message })).map((x) => Object.assign({}, x.item, { _repeat: x.repeat }));
const repeatBadge = (m) => (m && m._repeat > 1 ? ` <span class="muted">×${m._repeat}</span>` : '');
function chatAllowed(txt) { const r = chatLimiter.check('clan', txt, Date.now()); if (!r.ok) { notify(r.message, 'bad'); return false; } return true; }
const CHAT_KEEP = 100;
function loadClanChat(clanId) {
    const box = $id('clanChatBox');
    if (!box) return;
    if (myClanId() !== String(clanId)) { box.innerHTML = '<div class="muted">Join the clan to view messages.</div>'; return; }
    try { if (_chatUnsub) _chatUnsub(); } catch (e) {}
    box.innerHTML = skeleton('rows', 5);
    _view.chatFirst = true;
    _chatUnsub = onSnapshot(query(collection(db, 'clan_chat'), where('clanId', '==', clanId), limit(200)), (snap) => {
        const msgs = [];
        snap.forEach((s) => msgs.push(Object.assign({ id: s.id }, s.data())));
        const ts = (m) => toMillis(m.createdAt) || Date.now();
        msgs.sort((a, b) => ts(a) - ts(b));
        _view.chat = msgs;
        renderChat();
    }, (err) => console.warn('chat snapshot error', err));
}
function renderChat() {
    const box = $id('clanChatBox');
    if (!box) return;
    const msgs = _view.chat || [];
    const nearBottom = box.scrollHeight - box.scrollTop - box.clientHeight <= 60;
    const name = playerName(), role = _view.viewerRole || 'member', canPin = Roles.canPinMessages(role);
    const ts = (m) => toMillis(m.createdAt) || Date.now();
    const pinnedEl = $id('clanChatPinned');
    if (pinnedEl) pinnedEl.innerHTML = msgs.filter((m) => m.pinned && !m.system).map((m) =>
        `<div class="pin-msg"><span>📌 <b>${chatName(m.name)}</b>: ${chatText(m.message)}</span>${canPin && roleRank(role) >= roleRank(m.pinnedByRole || 'member') ? `<button type="button" class="link-btn" data-unpin="${esc(m.id)}">Unpin</button>` : ''}</div>`).join('');
    let html = '', prev = null;
    for (const m of collapseChat(msgs)) {
        const t = ts(m), when = `<time data-ts="${t}" title="${esc(new Date(t).toLocaleString())}">${timeAgo(t)}</time>`;
        if (m.system) {
            const tone = ['green', 'red', 'gold'].includes(m.color) ? m.color : 'green';
            html += `<div class="msg-sys sys-${tone}"><span>${chatText(m.message)}</span>${when}</div>`;
            prev = null; continue;
        }
        const who = String(m.name || 'Anon'), mine = who === name, grouped = prev && prev.name === who && t - prev.t < 5 * 60000;
        const title = m.title ? String(m.title) : (mine ? (ls.get('equipped_title') || '') : '');
        html += `<div class="msg${mine ? ' mine' : ''}${grouped ? ' grouped' : ''}${m.pinned ? ' pinned' : ''}">`
            + (grouped ? '' : `<div class="msg-head">${title ? `<span class="msg-title" style="color:${titleColor(title)}">${esc(title)}</span>` : ''}<b>${chatName(who)}</b>${when}</div>`)
            + `<div class="msg-text"><span>${chatText(m.message)}${repeatBadge(m)}</span>${canPin && !m.pinned ? `<button type="button" class="pin-btn" data-pin="${esc(m.id)}" title="Pin this message" aria-label="Pin this message">📌</button>` : ''}</div></div>`;
        prev = { name: who, t };
    }
    box.innerHTML = html || '<div class="muted chat-empty">No messages yet. Say hi!</div>';
    const last = msgs[msgs.length - 1];
    if (_view.chatFirst || nearBottom || (last && last.name === name)) box.scrollTop = box.scrollHeight;
    _view.chatFirst = false;
}
async function sendClanChat(clanId) {
    const input = $id('clanChatInput'), btn = $id('clanChatSend');
    const txt = String((input && input.value) || '').trim();
    if (!txt) return;
    const name = ensureUsername();
    if (!name) { notify('Pick a username first.', 'bad'); return; }
    if (!chatAllowed(txt)) return;
    if (btn) btn.disabled = true;
    try {
        chatLimiter.note('clan', txt, Date.now());
        try { await addDoc(collection(db, 'clan_chat'), { clanId, name, message: txt.slice(0, 500), title: ls.get('equipped_title') || null, createdAt: serverTimestamp(), scrollToBottom: true }); }
        catch (e) { chatLimiter.undo('clan'); throw e; }
        if (input) input.value = '';
        // keep the newest messages (pinned ones stay), from what the listener already has: no extra download
        const msgs = (_view.chat || []).slice();
        if (msgs.length > CHAT_KEEP + 10) {
            const old = msgs.slice(0, msgs.length - CHAT_KEEP).filter((m) => !m.pinned);
            Promise.all(old.map((m) => deleteDoc(doc(db, 'clan_chat', m.id)).catch(() => {}))).catch(() => {});
        }
    } catch (e) { console.warn('clan send failed', e); notify('Sending failed. Try again.', 'bad'); }
    if (btn) btn.disabled = false;
    if (input) input.focus();
}
async function onChatClick(e) {
    const pin = e.target.closest('[data-pin]'), unpin = e.target.closest('[data-unpin]');
    try {
        if (pin) await updateDoc(doc(db, 'clan_chat', pin.dataset.pin), { pinned: true, pinnedBy: playerName(), pinnedByRole: _view.viewerRole || 'member' });
        else if (unpin) await updateDoc(doc(db, 'clan_chat', unpin.dataset.unpin), { pinned: false, pinnedBy: null, pinnedByRole: null });
    } catch (err) { notify('Pinning failed.', 'bad'); }
}

// ---------------------------------------------------------------- joining, leaving and managing
// my own entry in a clan's roles (joining as a member), and taking an entry out (leaving, or being kicked)
function joinFields(who, name) { return { ['roles.' + who.uid]: 'member', ['names.' + who.uid]: name, ['acct.' + who.uid]: !!who.account }; }
function leaveFields(uid) { return { ['roles.' + uid]: deleteField(), ['names.' + uid]: deleteField(), ['acct.' + uid]: deleteField() }; }

// Opening a clan from before sign-ins: its owner (signed in to an account) claims it; its members put their own entry back
// (also a member who now signs in differently). Each is tried once per visit.
const _claimTried = {};
async function maybeClaim(clanId, raw) {
    const name = playerName();
    if (!raw || !name || _claimTried[clanId]) return;
    const who = await me();
    if (!who) return;
    if ((raw.roles || {})[who.uid] || raw.ownerUid === who.uid) return;
    if (!(Array.isArray(raw.members) && raw.members.includes(name))) return;
    _claimTried[clanId] = true;
    try {
        if (!Roles.claimed(raw) && raw.owner === name) {
            if (!who.account) return; // the banner says to sign in
            await updateDoc(doc(db, 'clans', clanId), { ownerUid: who.uid, ['roles.' + who.uid]: 'leader', ['names.' + who.uid]: name, ['acct.' + who.uid]: true });
            notify('👑 You claimed ' + (raw.name || 'your clan') + ': it is tied to your account now, so nobody else can take it over.', 'good');
        } else if (raw.owner !== name) {
            await updateDoc(doc(db, 'clans', clanId), joinFields(who, name));
        }
    } catch (e) { console.warn('clan claim failed', e); }
}
// Kicked from a claimed clan: the notice is in the clan. Returns true when it was this player (the view is closed).
function checkKicked(clanId, raw) {
    if (!Roles.claimed(raw) || !_myUid || Roles.roleOf(raw, _myUid) || myClanId() !== clanId) return false;
    const k = raw.kicks && raw.kicks[_myUid];
    if (!k) return false;
    clearMyClan();
    setProfile(playerName(), { clanId: null, clanName: null, clanRole: null });
    updatePlayerClanStatus();
    notify('You were removed from ' + (raw.name || 'the clan') + (k.reason ? ': ' + k.reason : '.'), 'bad');
    closeClanView();
    showRecommendedClans();
    return true;
}

async function createClan() {
    try {
        const name = ensureUsername();
        if (!name) { notify('You need a username first.', 'bad'); return; }
        if (!clansUnlocked()) { notify('Clans unlock after you prestige once.', 'bad'); return; }
        const save = readSave();
        if (!save) { notify('No save found. Play the game first.', 'bad'); return; }
        const have = num(save.goldenWhat);
        if (have < 10) { notify('You need 10 Golden What Happeneds to start a clan. You have ' + have + '.', 'bad'); return; }
        const nameInp = $id('newClanName');
        const cname = String(nameInp.value || '').trim();
        let list = [];
        try { list = await fetchClanList(true); } catch (e) {}
        const err = validateClanName(cname, list);
        if (err) { notify(err, 'bad'); updateCreateHint(); return; }
        const who = await me();
        if (!who || !who.account) { notify('Creating a clan needs an account, so you keep it on any device. Sign in on the Account page first.', 'bad'); return; }
        if (!confirm(`Create the clan "${cname}" for 10 Golden What Happeneds?`)) return;
        const btn = $id('createClan');
        if (btn) btn.disabled = true;
        const ref = await addDoc(collection(db, 'clans'), { name: cname, owner: name, members: [name], leaders: [name], createdAt: serverTimestamp(), maxMembers: 30, clanIcon: 'default', clanXp: 0, description: '',
            ownerUid: who.uid, roles: { [who.uid]: 'leader' }, names: { [who.uid]: name }, acct: { [who.uid]: true }, kicks: {} });
        // charged only once the clan exists
        changeSave((s) => { s.goldenWhat = Math.max(0, num(s.goldenWhat) - 10); });
        setMyClan(ref.id, cname, 'leader');
        ls.set(JOINED_KEY, JSON.stringify({ clanId: ref.id, at: Date.now() }));
        try { const ach = window.WHA && window.WHA.unlock('clan_created'); if (ach) setTimeout(() => notify(`🏆 ${ach.name}: ${ach.desc} Title: ${ach.title}`, 'gold'), 600); } catch (e) {}
        setProfile(name, { clanId: ref.id, clanName: cname, clanRole: 'leader' });
        try { await setDoc(doc(db, 'clans', ref.id, 'members', name), { clanRole: 'leader', uid: who.uid }, { merge: true }); } catch (e) {}
        clanSystemMessage(ref.id, `🎉 ${name} founded ${cname}!`, 'gold');
        notify(`Welcome to ${cname}! You're the leader.`, 'good');
        nameInp.value = '';
        _clanList.at = 0;
        updatePlayerClanStatus();
        loadClanDetail(ref.id);
    } catch (e) { console.error('createClan failed', e); notify('Creating the clan failed. Try again.', 'bad'); updateCreateHint(); }
}

async function joinClan(clanId) {
    try {
        const name = ensureUsername();
        if (!name) { notify('Pick a username first.', 'bad'); return; }
        if (!clansUnlocked()) { notify('Clans unlock after you prestige once.', 'bad'); return; }
        const current = myClanId();
        if (current && current !== clanId) { notify('Leave your current clan before joining another one.', 'bad'); return; }
        const ref = doc(db, 'clans', clanId), snap = await getDoc(ref);
        if (!snap.exists()) { notify('That clan no longer exists.', 'bad'); return; }
        const data = normalizeClan(snap.data());
        const who = await me();
        if (!who) { notify("Couldn't sign in, so you can't join right now. Check your connection and try again.", 'bad'); return; }
        const members = Array.isArray(data.members) ? data.members : [];
        if (Roles.roleOf(data, who.uid) || (!Roles.claimed(data) && members.includes(name))) { notify('You are already a member.'); return; }
        if (members.length >= (data.maxMembers || 30)) { notify('That clan is full.', 'bad'); return; }
        await updateDoc(ref, Object.assign({ members: arrayUnion(name) }, joinFields(who, name)));
        clanSystemMessage(clanId, `${name} joined the clan!`, 'green', { scrollToBottom: true });
        setProfile(name, { clanId, clanName: data.name, clanRole: 'member' });
        try { await setDoc(doc(db, 'clans', clanId, 'members', name), { clanRole: 'member', uid: who.uid }, { merge: true }); } catch (e) {}
        setMyClan(clanId, data.name || '', 'member');
        ls.set(JOINED_KEY, JSON.stringify({ clanId, at: Date.now() }));
        updatePlayerClanStatus();
        _clanList.at = 0;
        notify(`Welcome to ${data.name || 'the clan'}! Check in every day to level it up.`, 'good');
        loadClanDetail(clanId);
        events.refresh();
    } catch (e) { console.error('join failed', e); notify('Joining failed. Try again.', 'bad'); }
}

async function leaveClan(clanId) {
    try {
        const name = ensureUsername();
        if (!name) return;
        const ref = doc(db, 'clans', clanId), snap = await getDoc(ref);
        if (!snap.exists()) { clearMyClan(); updatePlayerClanStatus(); closeClanView(); showRecommendedClans(); return; }
        const raw = snap.data(), data = normalizeClan(raw);
        const who = await me();
        const iOwn = Roles.claimed(data) ? !!who && data.ownerUid === who.uid : name === data.owner;
        if (iOwn) {
            const others = (Array.isArray(data.members) ? data.members : []).filter((m) => m !== name);
            if (!others.length) {
                await deleteClan(clanId, true);
                notify('You left, and the clan was deleted (nobody else was in it).');
                return;
            }
            const handed = await handOverToBest(clanId);
            if (handed === false) { notify('Nobody else in the clan is signed in to an account, so nobody can take it over. Ask someone to sign in, or delete the clan instead.', 'bad'); return; }
        }
        const mine = !!who && !!(raw.roles && raw.roles[who.uid]);
        await updateDoc(ref, Object.assign({ members: arrayRemove(name), leaders: arrayRemove(name) }, mine ? leaveFields(who.uid) : {}));
        clanSystemMessage(clanId, `${name} left the clan.`, 'red', { scrollToBottom: true });
        setProfile(name, { clanId: null, clanName: null, clanRole: null });
        clearMyClan();
        updatePlayerClanStatus();
        notify('You left the clan.');
        closeClanView();
        showRecommendedClans();
        events.refresh();
    } catch (e) { console.error('leave failed', e); notify('Leaving failed. Try again.', 'bad'); }
}

async function kickMember(clanId, target, reason) {
    try {
        const name = playerName();
        if (!name) { notify('Pick a username first.', 'bad'); return; }
        const ref = doc(db, 'clans', clanId), snap = await getDoc(ref);
        const cd = snap.exists() ? snap.data() : {};
        if (Roles.claimed(cd)) {
            const uids = uidsOfName(cd, target);
            if (!uids.length) { notify('That player is not in the clan any more.'); reloadMembers(clanId); return; }
            await authReady();
            // one write per entry (a player who joined from two sign-ins has two): the rules let a kick change one entry
            for (let i = 0; i < uids.length; i++) {
                const t = uids[i];
                await updateDoc(ref, Object.assign(i === 0 ? { members: arrayRemove(target), leaders: arrayRemove(target) } : {},
                    { ['kicks.' + t]: { reason: reason || null, at: Date.now() }, act: { by: _myUid, kind: 'kick', target: t } }, leaveFields(t)));
            }
        } else {
            await updateDoc(ref, { members: arrayRemove(target), leaders: arrayRemove(target) });
            // older clans tell the kicked player through their profile
            await setProfile(target, { clanId: null, clanName: null, clanRole: null, kickedMessage: reason || null, kickedAt: serverTimestamp() });
        }
        clanSystemMessage(clanId, `${target} was removed from the clan.`, 'red', { scrollToBottom: true });
        notify(`${target} was kicked from the clan.`);
        reloadMembers(clanId);
    } catch (e) { console.error('kick failed', e); notify('Kicking failed: you may not have the rank for it.', 'bad'); }
}

async function promoteMember(clanId, target, newRole) {
    try {
        const name = playerName();
        if (!name) { notify('Pick a username first.', 'bad'); return; }
        const ref = doc(db, 'clans', clanId), snap = await getDoc(ref);
        if (!snap.exists()) { notify('That clan no longer exists.', 'bad'); return; }
        const c = snap.data();
        let prevRole = 'member';
        if (Roles.claimed(c)) {
            await authReady();
            const uids = uidsOfName(c, target), myRole = _myUid ? Roles.roleOf(c, _myUid) : null;
            const t = uids.sort((a, b) => roleRank(Roles.roleOf(c, b)) - roleRank(Roles.roleOf(c, a)))[0];
            prevRole = t ? Roles.roleOf(c, t) : null;
            if (!t || !prevRole) { notify('That player is not in the clan any more.'); return; }
            if (!myRole || !Roles.canAssignRole(myRole, newRole) || !Roles.canAssignRole(myRole, prevRole)) { notify("You don't have the rank to give that role.", 'bad'); return; }
            if (roleRank(newRole) >= roleRank('co-leader') && !(c.acct && c.acct[t] === true)) { notify(target + ' needs to sign in to an account before they can be co-leader.', 'bad'); return; }
            await updateDoc(ref, { ['roles.' + t]: newRole, leaders: newRole === 'co-leader' ? arrayUnion(target) : arrayRemove(target), act: { by: _myUid, kind: 'role', target: t } });
        } else {
            // the owner is also in `leaders`, so ownership is checked first
            let myRole = name === c.owner ? 'leader' : (Array.isArray(c.leaders) && c.leaders.includes(name)) ? 'co-leader' : null;
            if (!myRole) { try { const p = await getDoc(doc(db, 'profiles', name)); myRole = (p.exists() && p.data().clanRole) || 'member'; } catch (e) { myRole = 'member'; } }
            try { const ps = await getDoc(doc(db, 'profiles', target)); if (ps.exists()) prevRole = ps.data().clanRole || 'member'; } catch (e) {}
            if (!Roles.canAssignRole(myRole, newRole) || !Roles.canAssignRole(myRole, prevRole)) { notify("You don't have the rank to give that role.", 'bad'); return; }
            await setProfile(target, { clanRole: newRole });
            try { await updateDoc(ref, { leaders: newRole === 'co-leader' ? arrayUnion(target) : arrayRemove(target) }); } catch (e) {}
        }
        const up = roleRank(newRole) > roleRank(prevRole);
        clanSystemMessage(clanId, `${name} ${up ? 'promoted' : 'demoted'} ${target} to ${roleLabel(newRole)}`, up ? 'green' : 'red', { scrollToBottom: true });
        notify(`${target} is now ${roleLabel(newRole)}.`, 'good');
        reloadMembers(clanId);
    } catch (e) { console.error('promote failed', e); notify('Changing the role failed.', 'bad'); }
}

async function transferOwnership(clanId, target) {
    const name = playerName();
    try {
        const snap = await getDoc(doc(db, 'clans', clanId)), cd = snap.exists() ? snap.data() : {};
        if (Roles.claimed(cd)) {
            await authReady();
            const t = uidsOfName(cd, target).find((u) => cd.acct && cd.acct[u] === true);
            if (!_myUid || cd.ownerUid !== _myUid) { notify('Only the clan leader can hand it over.', 'bad'); return; }
            if (!t) { notify(target + ' needs to sign in to an account before they can lead the clan.', 'bad'); return; }
            await updateDoc(doc(db, 'clans', clanId), { ownerUid: t, owner: target, leaders: arrayUnion(target), ['roles.' + t]: 'leader', ['roles.' + _myUid]: 'co-leader' });
        } else await updateDoc(doc(db, 'clans', clanId), { owner: target, leaders: arrayUnion(target) });
        setProfile(target, { clanRole: 'leader' });
        setProfile(name, { clanRole: 'co-leader' });
        ls.set('player_clanRole', 'co-leader');
        clanSystemMessage(clanId, `👑 ${name} handed the clan to ${target}.`, 'gold');
        notify(`${target} now leads the clan.`, 'good');
        updatePlayerClanStatus();
        reloadMembers(clanId);
    } catch (e) { console.warn('transfer failed', e); notify('Handing over the clan failed.', 'bad'); }
}
// The owner is leaving: the highest-ranked member with an account takes over (true), or nobody can (false)
async function handOverToBest(clanId) {
    const snap = await getDoc(doc(db, 'clans', clanId)), cd = snap.exists() ? snap.data() : null;
    if (!cd) return false;
    if (Roles.claimed(cd)) {
        await authReady();
        const cands = Object.keys(cd.roles || {}).filter((u) => u !== _myUid && cd.acct && cd.acct[u] === true && cd.names && cd.names[u] && cd.names[u] !== cd.names[_myUid]);
        if (!cands.length) return false;
        const best = Math.max(...cands.map((u) => roleRank(cd.roles[u])));
        const top = cands.filter((u) => roleRank(cd.roles[u]) === best);
        const t = top[Math.floor(Math.random() * top.length)];
        await updateDoc(doc(db, 'clans', clanId), { ownerUid: t, owner: cd.names[t], leaders: arrayUnion(cd.names[t]), ['roles.' + t]: 'leader', ['roles.' + _myUid]: 'co-leader' });
        setProfile(cd.names[t], { clanRole: 'leader' });
        clanSystemMessage(clanId, `👑 ${cd.names[t]} leads the clan now.`, 'gold');
        return true;
    }
    // an old clan: the highest role in the members' profiles
    const others = (Array.isArray(cd.members) ? cd.members : []).filter((m) => m !== playerName());
    const infos = await Promise.all(others.map(async (u) => { try { const s = await getDoc(doc(db, 'profiles', u)); return { u, r: (s.exists() && s.data().clanRole) || 'member' }; } catch (e) { return { u, r: 'member' }; } }));
    const best = Math.max(...infos.map((i) => roleRank(i.r)));
    const top = infos.filter((i) => roleRank(i.r) === best).map((i) => i.u);
    const chosen = top[Math.floor(Math.random() * top.length)];
    if (!chosen) return false;
    await updateDoc(doc(db, 'clans', clanId), { owner: chosen, leaders: arrayUnion(chosen) });
    setProfile(chosen, { clanRole: 'leader' });
    return true;
}
async function deleteClan(clanId, leaving) {
    try {
        const ref = doc(db, 'clans', clanId), snap = await getDoc(ref);
        if (!snap.exists()) { notify('That clan no longer exists.', 'bad'); return; }
        const c = normalizeClan(snap.data());
        await Promise.all((Array.isArray(c.members) ? c.members : []).map((m) => setProfile(m, { clanId: null, clanName: null, clanRole: null })));
        await deleteDoc(ref);
        try { const s = await getDocs(query(collection(db, 'clan_chat'), where('clanId', '==', clanId))); await Promise.all(s.docs.map((d) => deleteDoc(doc(db, 'clan_chat', d.id)).catch(() => {}))); } catch (e) {}
        if (myClanId() === clanId) clearMyClan();
        updatePlayerClanStatus();
        if (!leaving) notify('Clan deleted.');
        closeClanView();
        showRecommendedClans();
        events.refresh();
    } catch (e) { console.error('deleteClan failed', e); notify('Deleting the clan failed.', 'bad'); }
}

// ---------------------------------------------------------------- the header chip, and finding / creating clans
function updatePlayerClanStatus() {
    const status = $id('playerClanStatus');
    const myName = playerName(), cid = myClanId(), cname = ls.get('player_clanName') || '', role = ls.get('player_clanRole') || '';
    if (status) {
        if (!myName) status.innerHTML = '<span class="muted">No username yet</span><button type="button" class="btn btn-sm btn-ghost" id="ensureNameBtn">Pick a name</button>';
        else status.innerHTML = `<span class="me-name">${esc(myName)}</span>` + (cid ? `<span class="me-clan">🛡️ ${esc(cname || 'Your clan')} · ${esc(roleLabel(role || 'member'))}</span>` : '<span class="me-clan muted">Not in a clan</span>');
        const nb = $id('ensureNameBtn');
        if (nb) nb.addEventListener('click', () => { if (ensureUsername()) { updatePlayerClanStatus(); watchMyProfile(); } });
    }
    // the clan finder is only for players without a clan
    const fa = $id('findArea');
    if (fa) fa.style.display = cid ? 'none' : '';
    const lock = $id('clanLockNote');
    if (lock) lock.hidden = clansUnlocked();
    const lp = $id('clanLockProgress');
    if (lp && !clansUnlocked()) {
        const cr = Math.max(0, Math.floor(num((readSave() || {}).upgrade12Level)));
        lp.textContent = cr >= 150 ? 'Your CR lurker has reached level 150: the Prestige button is waiting in the game.' : cr > 0 ? `Your CR lurker: level ${cr} of 150.` : 'You have not bought CR lurker yet (upgrade 12).';
    }
    updateCreateHint();
}
function validateClanName(name, list) {
    const n = String(name || '').trim();
    if (n.length < 3) return 'Clan names need at least 3 characters.';
    if (n.length > 24) return 'Clan names can be at most 24 characters.';
    if ((list || []).some((c) => String(c.name || '').trim().toLowerCase() === n.toLowerCase())) return 'That name is already taken.';
    return '';
}
function updateCreateHint() {
    const hint = $id('createHint'), btn = $id('createClan'), inp = $id('newClanName');
    if (!hint || !btn || !inp) return;
    const golden = num((readSave() || {}).goldenWhat), typed = inp.value.trim();
    let msg, bad = false;
    if (!clansUnlocked()) { msg = 'Unlocks after your first prestige.'; bad = true; }
    else if (golden < 10) { msg = `You have ${golden} Golden. You need 10.`; bad = true; }
    else if (typed) { msg = validateClanName(typed, _clanList.list); bad = !!msg; if (!bad) msg = `Looks good. You have ${golden} Golden.`; }
    else msg = `You have ${golden} Golden. Creating a clan needs an account (sign in on the Account page).`;
    hint.textContent = msg;
    hint.classList.toggle('bad', bad);
    btn.disabled = !clansUnlocked() || golden < 10;
}

let _clanList = { at: 0, list: [] };
async function fetchClanList(force) {
    if (!force && _clanList.list.length && Date.now() - _clanList.at < 60000) return _clanList.list;
    const snap = await getDocs(query(collection(db, 'clans'), limit(200)));
    const arr = [];
    snap.forEach((s) => { const d = normalizeClan(s.data() || {}); d.id = s.id; if (!EV.isBot(d)) arr.push(d); });
    _clanList = { at: Date.now(), list: arr };
    return arr;
}
function clanCardHtml(r, unlocked, inClan) {
    const c = r.c, full = r.n >= r.max, desc = String(c.description || '').slice(0, 140);
    return `<article class="clan-card${full ? ' is-full' : ''}">
      <div class="emblem sm">${clanIconHtml(c)}</div>
      <div class="cc-body">
        <div class="cc-title"><b>${esc(c.name || c.id)}</b><span class="lvl-badge">Lv ${r.lvl}</span>${full ? '<span class="tag">Full</span>' : ''}</div>
        <div class="cc-meta">👑 ${esc(c.owner || '?')} · 👥 ${r.n}/${r.max}</div>
        <div class="bar thin"><i style="width:${Math.min(100, r.n / r.max * 100)}%"></i></div>
        ${desc ? `<p class="cc-desc">${esc(desc)}</p>` : ''}
      </div>
      <div class="cc-actions"><button type="button" class="btn btn-ghost btn-sm" data-view="${esc(c.id)}">View</button><button type="button" class="btn btn-primary btn-sm" data-join="${esc(c.id)}"${full || !unlocked || inClan ? ' disabled' : ''}>Join</button></div>
    </article>`;
}
async function renderClanBrowser(force) {
    const box = $id('searchResults');
    if (!box) return;
    if (!_clanList.list.length) box.innerHTML = skeleton('cards', 6);
    let list;
    try { list = await fetchClanList(force); } catch (e) { console.warn('clan list failed', e); box.innerHTML = '<div class="muted">Couldn\'t load clans. Check your connection and try again.</div>'; return; }
    const term = String(($id('searchClanName') || {}).value || '').trim().toLowerCase();
    const sort = ($id('clanSort') || {}).value || 'recommended';
    const rows = list.filter((c) => memberCount(c) > 0 && (!term || String(c.name || '').toLowerCase().includes(term) || String(c.description || '').toLowerCase().includes(term)))
        .map((c) => ({ c, lvl: Levels.levelFromXp(c.clanXp), n: memberCount(c), max: c.maxMembers || 30 }));
    const full = (r) => (r.n >= r.max ? 1 : 0);
    const sorters = {
        level: (a, b) => b.lvl - a.lvl || b.n - a.n,
        members: (a, b) => b.n - a.n || b.lvl - a.lvl,
        open: (a, b) => (b.max - b.n) - (a.max - a.n) || b.lvl - a.lvl,
        name: (a, b) => String(a.c.name || '').localeCompare(String(b.c.name || '')),
        // open clans first, then active-looking ones (level counts more than size)
        recommended: (a, b) => full(a) - full(b) || (b.lvl * 3 + Math.min(b.n, 20)) - (a.lvl * 3 + Math.min(a.n, 20)),
    };
    rows.sort(sorters[sort] || sorters.recommended);
    if (!rows.length) { box.innerHTML = term ? `<div class="muted empty">No clans match “${esc(term)}”. Why not start one?</div>` : '<div class="muted empty">No clans yet. Start the first one!</div>'; return; }
    box.innerHTML = rows.map((r) => clanCardHtml(r, clansUnlocked(), !!myClanId())).join('');
    updateCreateHint();
}
const showRecommendedClans = () => renderClanBrowser(true);

// ---------------------------------------------------------------- the clan shop
const CLAN_SHOP_ITEMS = [
    { id: 'gems5', name: '5 Gems', cost: 25, reward: { diamonds: 5 } }, { id: 'gems15', name: '15 Gems', cost: 60, reward: { diamonds: 15 } },
    { id: 'gems50', name: '50 Gems', cost: 200, reward: { diamonds: 50 } }, { id: 'gems120', name: '120 Gems', cost: 450, reward: { diamonds: 120 } },
    { id: 'golden1', name: '1 Golden What', cost: 80, reward: { goldenWhat: 1 } }, { id: 'golden3', name: '3 Golden Whats', cost: 220, reward: { goldenWhat: 3 } },
];
function purchaseClanShopItem(item) {
    if (!item) return;
    let left = null;
    const ok = changeSave((s) => {
        const have = num(s.clanPoints);
        if (have < item.cost) return false;
        s.clanPoints = have - item.cost; left = s.clanPoints;
        if (item.reward.diamonds) s.diamonds = num(s.diamonds) + item.reward.diamonds;
        // Golden bought with Clan Points also counts toward the lifetime Golden stat
        if (item.reward.goldenWhat) { s.goldenWhat = num(s.goldenWhat) + item.reward.goldenWhat; s.totalGoldenEver = num(s.totalGoldenEver) + item.reward.goldenWhat; }
    });
    if (!ok) { notify(`Not enough Clan Points. ${item.name} costs ${item.cost} CP.`, 'bad'); return; }
    notify(`Bought ${item.name}. You have ${left.toLocaleString()} CP left.`, 'good');
    renderClanShopTab();
}
let _shopTimer = null;
async function renderClanShopTab() {
    const tab = $id('tabShop');
    if (!tab) return;
    clearTimeout(_shopTimer);
    const clanId = myClanId();
    if (!clanId) { tab.innerHTML = lockedPanel('🛒', 'Join a clan to use the clan shop', 'Clan Points come from clan events and daily check-ins. Spend them on buffs for your whole clan or rewards for yourself.'); return; }
    let d = {};
    try { const snap = await getDoc(doc(db, 'clans', clanId)); if (snap.exists()) d = snap.data() || {}; } catch (e) { console.warn('clan shop fetch failed', e); }
    await authReady();
    const now = Date.now(), cp = clanPointsHave(), c = normalizeClan(d);
    const canLogo = Roles.canEditDescription(viewerRoleFor(c, playerName()));
    const progress = d.buffProgress && typeof d.buffProgress === 'object' ? d.buffProgress : {};
    const active = Buffs.resolveActive(d, now);
    const owned = Array.isArray(d.clanShopIconsUnlocked) ? d.clanShopIconsUnlocked : [];
    const level = Levels.levelFromXp(d.clanXp);
    const donors = Object.entries(d.cpDonated && typeof d.cpDonated === 'object' ? d.cpDonated : {}).filter((e) => num(e[1]) > 0).sort((a, b) => b[1] - a[1]).slice(0, 3);
    let html = `<section class="card shop-top"><div class="cp-balance"><span>Your Clan Points</span><b id="clanShopBalanceVal">${cp.toLocaleString()}</b></div><p class="muted">Earn CP from clan events and your daily check-in. Spend it on buffs for the whole clan or on rewards for yourself.</p></section>`;
    html += `<section class="card"><div class="sec-head"><h2>Clan buffs</h2>${donors.length ? `<span class="muted">Top donors: ${donors.map(([n, v]) => `<b>${esc(n)}</b> ${num(v).toLocaleString()}`).join(' · ')}</span>` : ''}</div>`;
    html += '<p class="muted">Everyone chips in CP. When a bar fills, the whole clan gets the buff (in the game, within a minute). Different buffs stack, and filling one that\'s already running adds more time, up to a day ahead.</p><div class="buff-grid">';
    for (const b of Buffs.BUFFS) {
        const have = num(progress[b.id]), need = Math.max(0, b.cpCost - have);
        const run = active.find((x) => x.id === b.id), room = Buffs.roomToQueue(d, b.id, now);
        const chips = [25, 100, 250].filter((n) => n < need).map((n) => `<button type="button" class="chip-btn" data-buff="${b.id}" data-amt="${n}"${cp >= n ? '' : ' disabled'}>+${n}</button>`).join('')
            + `<button type="button" class="chip-btn fill" data-buff="${b.id}" data-amt="${need}"${cp >= need && need > 0 && room ? '' : ' disabled'} title="${room ? '' : 'Already queued for nearly a day'}">Fill · ${need.toLocaleString()}</button>`;
        html += `<article class="buff-card${run ? ' is-active' : ''}"><div class="buff-icon">${b.icon}</div><div class="buff-body">`
            + `<div class="buff-title"><b>${esc(b.name)}</b>${run ? `<span class="tag good">Active · ${fmtLeft(run.expiresAt - now)} left</span>` : ''}${room ? '' : '<span class="tag">Queue full</span>'}</div>`
            + `<p>${esc(b.description)}</p><div class="bar" role="progressbar" aria-label="${esc(b.name)} progress" aria-valuemin="0" aria-valuemax="${b.cpCost}" aria-valuenow="${have}"><i style="width:${Math.min(100, have / b.cpCost * 100)}%"></i></div>`
            + `<div class="buff-foot"><span class="muted">${have.toLocaleString()} / ${b.cpCost.toLocaleString()} CP</span><div class="chips">${chips}</div></div></div></article>`;
    }
    html += '</div></section>';
    html += '<section class="card"><h2>Rewards for you</h2><div class="reward-grid">';
    for (const item of CLAN_SHOP_ITEMS) {
        const ok = cp >= item.cost;
        html += `<article class="reward-card"><img src="${item.reward.diamonds ? 'mainimage/gem.png' : 'mainimage/thumbs/goldwh.webp'}" alt=""><b>${esc(item.name)}</b>`
            + `<button type="button" class="btn btn-sm ${ok ? 'btn-primary' : 'btn-ghost'} clan-shop-buy" data-id="${item.id}"${ok ? '' : ' disabled'}>${item.cost} CP</button></article>`;
    }
    html += '</div></section>';
    html += '<section class="card"><h2>Clan icons</h2><p class="muted">Level icons unlock as your clan grows. Shop icons are bought once for the whole clan. Co-leaders and the leader choose the clan\'s icon under ⚙️ Manage on the clan page.</p><div class="icon-grid">';
    for (const ic of CLAN_ICONS) { const ok = level >= ic.level; html += `<div class="icon-tile${ok ? ' owned' : ' locked'}"><span>${ic.emoji}</span><b>${esc(ic.label)}</b><small>${ok ? 'Unlocked' : '🔒 Clan level ' + ic.level}</small></div>`; }
    for (const ic of CLAN_SHOP_ICONS) {
        const has = owned.includes(ic.id);
        html += `<div class="icon-tile${has ? ' owned' : ''}"><span>${ic.emoji}</span><b>${esc(ic.label)}</b>`
            + (has ? '<small>Owned</small>' : `<button type="button" class="btn btn-sm btn-ghost clan-shop-icon-buy" data-icon-id="${ic.id}"${cp >= ic.cost ? '' : ' disabled'}>${ic.cost} CP</button>`) + '</div>';
    }
    html += '</div></section>';
    html += `<section class="card"><h2>Custom clan logo</h2><p class="muted">Upload a PNG, JPEG, GIF or WebP (max 5 MB). It's resized and compressed before upload. Costs ${CUSTOM_LOGO_CP_COST.toLocaleString()} CP.</p>`
        + (canLogo ? `<input type="file" id="clanCustomLogoInput" accept="image/png,image/jpeg,image/gif,image/webp" hidden><div class="row-gap"><button type="button" id="clanCustomLogoBtn" class="btn btn-gold"${cp >= CUSTOM_LOGO_CP_COST ? '' : ' disabled'}>Upload clan logo (${CUSTOM_LOGO_CP_COST.toLocaleString()} CP)</button><span id="clanCustomLogoStatus" class="muted"></span></div>` : '<p class="muted">Only co-leaders and the leader can upload a logo.</p>')
        + '</section>';
    tab.innerHTML = html;
    tab.querySelectorAll('.clan-shop-buy').forEach((btn) => btn.addEventListener('click', () => purchaseClanShopItem(CLAN_SHOP_ITEMS.find((i) => i.id === btn.dataset.id))));
    tab.querySelectorAll('.chip-btn[data-buff]').forEach((btn) => btn.addEventListener('click', () => { btn.disabled = true; contributeClanBuff(btn.dataset.buff, num(btn.dataset.amt)); }));
    tab.querySelectorAll('.clan-shop-icon-buy').forEach((btn) => btn.addEventListener('click', () => { const ic = CLAN_SHOP_ICONS.find((i) => i.id === btn.dataset.iconId); if (ic) purchaseClanShopIcon(ic); }));
    const logoBtn = $id('clanCustomLogoBtn'), logoInput = $id('clanCustomLogoInput');
    if (logoBtn && logoInput) {
        logoBtn.addEventListener('click', () => logoInput.click());
        logoInput.addEventListener('change', async () => {
            const file = logoInput.files && logoInput.files[0];
            logoInput.value = '';
            if (!file || !file.type.startsWith('image/')) { notify('Please pick an image (PNG, JPEG, GIF or WebP).', 'bad'); return; }
            if (file.size > 5 * 1024 * 1024) { notify('Images must be under 5 MB.', 'bad'); return; }
            const statusEl = $id('clanCustomLogoStatus');
            if (statusEl) statusEl.textContent = 'Preparing…';
            try { await uploadClanCustomLogo(clanId, await compressImageForLogo(file), statusEl); }
            catch (e) { notify('Upload failed: ' + (e.message || e), 'bad'); if (statusEl) statusEl.textContent = ''; }
        });
    }
    // keep "time left" on running buffs fresh while the shop is open
    _shopTimer = setTimeout(() => { if (tab.style.display !== 'none') renderClanShopTab(); }, 60000);
}
// Resize and compress an image for the clan document (max 384 px, JPEG 0.7: under ~150 KB as a data URL)
function compressImageForLogo(file) {
    return new Promise((resolve, reject) => {
        const url = URL.createObjectURL(file), img = new Image();
        img.onload = () => {
            URL.revokeObjectURL(url);
            const MAX = 384;
            let w = img.naturalWidth || img.width, h = img.naturalHeight || img.height;
            if (w > MAX || h > MAX) { if (w >= h) { h = Math.round(h * MAX / w); w = MAX; } else { w = Math.round(w * MAX / h); h = MAX; } }
            const canvas = document.createElement('canvas');
            canvas.width = w; canvas.height = h;
            const ctx = canvas.getContext('2d');
            if (!ctx) { reject(new Error('Canvas not supported')); return; }
            ctx.drawImage(img, 0, 0, w, h);
            canvas.toBlob((b) => (b ? resolve(b) : reject(new Error('Compress failed'))), 'image/jpeg', 0.7);
        };
        img.onerror = () => { URL.revokeObjectURL(url); reject(new Error('Could not load image')); };
        img.src = url;
    });
}
function blobToDataUrl(blob) { return new Promise((resolve, reject) => { const r = new FileReader(); r.onload = () => resolve(r.result); r.onerror = () => reject(new Error('Read failed')); r.readAsDataURL(blob); }); }
async function uploadClanCustomLogo(clanId, blob, statusEl) {
    if (clanPointsHave() < CUSTOM_LOGO_CP_COST) { notify(`Not enough Clan Points. A custom logo costs ${CUSTOM_LOGO_CP_COST.toLocaleString()} CP.`, 'bad'); if (statusEl) statusEl.textContent = ''; return; }
    const dataUrl = await blobToDataUrl(blob);
    if (!isEmbeddedLogo(dataUrl)) { notify('That image is too large even after compressing. Try a smaller or simpler one.', 'bad'); if (statusEl) statusEl.textContent = ''; return; }
    if (statusEl) statusEl.textContent = 'Uploading…';
    await updateDoc(doc(db, 'clans', clanId), { clanCustomLogoUrl: dataUrl, clanIcon: 'custom' });
    changeClanPoints(-CUSTOM_LOGO_CP_COST);
    if (statusEl) statusEl.textContent = 'Uploaded!';
    notify('Your clan has its own logo now.', 'good');
    await renderClanShopTab();
}
async function purchaseClanShopIcon(ic) {
    const clanId = myClanId();
    if (!clanId) { notify('You are not in a clan.', 'bad'); return; }
    if (clanPointsHave() < ic.cost) { notify(`Not enough Clan Points. That icon costs ${ic.cost} CP.`, 'bad'); return; }
    try { await updateDoc(doc(db, 'clans', clanId), { clanShopIconsUnlocked: arrayUnion(ic.id) }); }
    catch (e) { notify('Buying the icon failed: ' + (e.message || 'try again'), 'bad'); return; }
    const left = changeClanPoints(-ic.cost);
    notify(`Unlocked the ${ic.label} icon for your clan. ${num(left).toLocaleString()} CP left.`, 'good');
    renderClanShopTab();
}
async function contributeClanBuff(buffId, amount) {
    const clanId = myClanId();
    if (!clanId) { notify('You are not in a clan.', 'bad'); return; }
    const def = Buffs.byId(buffId);
    amount = Math.floor(num(amount));
    if (!def || amount < 1) return;
    const have = clanPointsHave();
    if (have < amount) { notify(`Not enough Clan Points. You have ${have.toLocaleString()}.`, 'bad'); renderClanShopTab(); return; }
    const donor = playerName() || 'Someone';
    let result = null;
    try {
        await runTransaction(db, async (tx) => {
            const ref = doc(db, 'clans', clanId), snap = await tx.get(ref);
            if (!snap.exists()) throw new Error('clan not found');
            result = Buffs.contribute(snap.data() || {}, buffId, amount, donor, Date.now());
            if (!result.ok) throw new Error(result.reason === 'queue' ? 'that buff is already queued for nearly a day' : 'not a valid contribution');
            tx.update(ref, result.updates);
        });
    } catch (e) { notify('Contribution failed: ' + (e.message || 'try again'), 'bad'); renderClanShopTab(); return; }
    changeClanPoints(-amount);
    ls.set('whathappened_clan_donated', String(num(ls.get('whathappened_clan_donated')) + amount));
    if (result.activated) clanSystemMessage(clanId, `${def.icon} ${def.name} is active for the whole clan! ${donor} filled the bar.`, 'gold');
    notify(result.activated ? `${def.name} is now active for the whole clan!` : `You put ${amount.toLocaleString()} CP into ${def.name}.`, 'good');
    checkClanAchievements();
    renderClanShopTab();
}

// ---------------------------------------------------------------- the player's profile (older clans and other devices)
let _profileUnsub = null;
function watchMyProfile() {
    const name = playerName();
    if (!name) return;
    try { if (_profileUnsub) _profileUnsub(); } catch (e) {}
    _profileUnsub = onSnapshot(doc(db, 'profiles', name), async (snap) => {
        try {
            const data = snap.exists() ? (snap.data() || {}) : {};
            const cid = data.clanId || null, mine = myClanId();
            if (!cid && mine) {
                const msg = String(data.kickedMessage || '').trim();
                // the profile can be behind (it is written from several places): the clan document decides
                if ((await membershipOf(mine)) !== false) return;
                if (msg) { notify('You were kicked from your clan.\n' + msg, 'bad'); setProfile(name, { kickedMessage: null, kickedAt: null }); }
                else notify('You are no longer in your clan.', 'bad');
                clearMyClan();
                if (_view.member) { closeClanView(); showRecommendedClans(); }
                updatePlayerClanStatus();
                events.refresh();
            } else if (cid && cid !== mine && !mine) {
                // joined on another device: follow it, if the clan agrees
                if ((await membershipOf(cid)) !== true) return;
                setMyClan(cid, data.clanName || '', data.clanRole || 'member');
                updatePlayerClanStatus();
                if (_view.id !== cid) loadClanDetail(cid);
                events.refresh();
            }
        } catch (e) { console.warn('profile snapshot error', e); }
    }, (err) => console.warn('profile snapshot failed', err));
}

// ---------------------------------------------------------------- start
function applyBackground() {
    try {
        const s = readSave() || {};
        if (typeof s.equippedBgImage !== 'string' || !s.equippedBgImage) return;
        // older saves stored paths with different letter case; file names on the server are lower case
        const base = String(s.equippedBgImage).split('/').pop().toLowerCase();
        document.body.style.backgroundImage = `url('${base === 'mainbg.png' || base === 'vrillbg.png' ? 'mainimage/' + base : 'bgimages/' + base}')`;
    } catch (e) {}
}
const events = startEventsTab({
    db, fs: { collection, doc, getDoc, getDocs, setDoc, updateDoc, onSnapshot, runTransaction, increment, deleteField, serverTimestamp, query, where, limit },
    authReady, me, notify, esc, fmtShort, fmtLeft, timeAgo, lockedPanel, readSave, changeSave, myClanId, playerName, skeleton,
    clanDoc: () => (_view.member && _view.id === myClanId() ? _view.raw : null), listClans: () => fetchClanList(false),
});
function initClanUI() {
    const create = $id('createClan');
    if (create) create.addEventListener('click', createClan);
    const nameInp = $id('newClanName');
    if (nameInp) { nameInp.addEventListener('input', updateCreateHint); nameInp.addEventListener('keydown', (e) => { if (e.key === 'Enter') createClan(); }); }
    const search = $id('searchClanName');
    if (search) search.addEventListener('input', () => renderClanBrowser());
    const sort = $id('clanSort');
    if (sort) sort.addEventListener('change', () => renderClanBrowser());
    const results = $id('searchResults');
    if (results) results.addEventListener('click', (e) => {
        const view = e.target.closest('[data-view]'), join = e.target.closest('[data-join]');
        if (view) { loadClanDetail(view.dataset.view); const area = $id('clanDetailArea'); if (area) area.scrollIntoView({ behavior: 'smooth', block: 'start' }); }
        else if (join) { join.disabled = true; joinClan(join.dataset.join).finally(() => { join.disabled = false; }); }
    });
    const tabs = { clans: [$id('tabClansBtn'), $id('tabClans')], events: [$id('tabEventsBtn'), $id('tabEvents')], shop: [$id('tabShopBtn'), $id('tabShop')] };
    function showTab(which) {
        for (const k of Object.keys(tabs)) {
            const [btn, panel] = tabs[k];
            if (!btn || !panel) continue;
            panel.style.display = k === which ? 'block' : 'none';
            btn.classList.toggle('active', k === which);
            btn.setAttribute('aria-selected', String(k === which));
        }
        if (which === 'events') events.show();
        if (which === 'shop') renderClanShopTab();
        try { history.replaceState(null, '', which === 'clans' ? location.pathname : '#' + which); } catch (e) {}
    }
    for (const k of Object.keys(tabs)) if (tabs[k][0]) tabs[k][0].addEventListener('click', () => showTab(k));
    showTab(['events', 'shop'].includes(location.hash.slice(1)) ? location.hash.slice(1) : 'clans');
    // keep relative times ("5m ago") current
    setInterval(() => { document.querySelectorAll('time[data-ts]').forEach((t) => { t.textContent = timeAgo(Number(t.dataset.ts)); }); }, 60000);
    applyBackground();
    updatePlayerClanStatus();
    const cid = myClanId();
    if (cid) loadClanDetail(cid); else showRecommendedClans();
    watchMyProfile();
}
if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', initClanUI); else initClanUI();

// joining or leaving in another tab, or a new name
window.addEventListener('storage', (e) => {
    if (!e.key) return;
    if (e.key.indexOf('player_clan') === 0 || e.key === 'player_username') updatePlayerClanStatus();
    if (e.key === 'player_clanId') { events.refresh(); const tab = $id('tabShop'); if (tab && tab.style.display !== 'none') renderClanShopTab(); }
    if (e.key === 'equipped_title') renderChat();
});

// Dev: Ctrl+Alt+P adds 10,000 Clan Points (needs the code)
window.addEventListener('keydown', (ev) => {
    if (!(ev.ctrlKey && ev.altKey && String(ev.key || '').toLowerCase() === 'p')) return;
    const attempt = prompt('Enter dev code to add 10,000 Clan Points:', '');
    if (attempt === null) return;
    if (String(attempt).trim() !== 'GIVECP10000-2026') { notify('Incorrect code.', 'bad'); return; }
    if (changeClanPoints(10000) === null) { notify('No save found.', 'bad'); return; }
    notify('Added 10,000 Clan Points (dev).', 'good');
    const tab = $id('tabShop');
    if (tab && tab.style.display !== 'none') renderClanShopTab();
});

// the clan actions the buttons call, for tests/browser/chat.js
window.WHClanPage = { joinClan, leaveClan, kickMember, promoteMember, transferOwnership, loadClanDetail, me, changeSave };
