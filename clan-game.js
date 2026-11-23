/**
 * The player's clan on the game page (index.html), in the background:
 *  - keeps the clan's level perks and buffs current, and notices when the player is no longer in the clan (kicked, or the
 *    clan was deleted), so nothing of it keeps applying;
 *  - sends what clan events count: clicks for Clan v Clan, damage for the bosses (with the phase's twist), prestiges for
 *    the Prestige Party (a prestige reloads the page, so those are kept and sent on the next load);
 *  - pays clan event rewards once an event is over, whether or not the clan page is ever opened (the clan page pays too;
 *    whichever looks first does it, once: core/clan-events.js payEnded);
 *  - takes in what the clan page changed in the save while this tab was open (rewards, shop purchases), so the game's
 *    autosave doesn't write the old numbers back over them.
 * The rules and numbers are in core/clan-levels.js, core/clan-buffs.js, core/clan-events.js and core/clan-roles.js. Firestore
 * comes from index.html's Firebase module (window.db and friends), which may finish loading after this script.
 */
(function () {
    'use strict';
    const L = window.WHClanLevels, B = window.WHClanBuffs, EV = window.WHClanEvents, R = window.WHClanRoles;
    if (!L || !B || !EV) return;

    const DELTA_KEY = 'whathappened_clan_delta';   // written by the clan page when it changes the save
    const JOINED_KEY = 'whathappened_clan_joined'; // { clanId, at }: when this player joined their clan (clan page)
    // Firestore reads cost: the clan document and the schedule are listened to (a read only when they change); without a
    // listener the schedule is polled every 5 minutes. Payouts look every 30 minutes, and soon after a slot ends.
    const FLUSH_MS = 3000, PAY_MS = 30 * 60 * 1000, SCHEDULE_MS = 5 * 60 * 1000, BOSS_MS = 60 * 1000;
    const MAX_PENDING_CLICKS = 100000;

    const get = (k) => { try { return localStorage.getItem(k); } catch (e) { return null; } };
    const set = (k, v) => { try { localStorage.setItem(k, v); } catch (e) {} };
    const del = (k) => { try { localStorage.removeItem(k); } catch (e) {} };
    const clanId = () => { const c = get('player_clanId'); return c && c !== 'undefined' && c !== 'null' ? c : ''; };
    const username = () => String(get('player_username') || '').trim();
    const asNum = (v) => { try { return v && typeof v.toNumber === 'function' ? v.toNumber() : (Number(v) || 0); } catch (e) { return 0; } };
    // the Firestore functions index.html's module put on window, once it has loaded
    function fs() { const w = window; return w.db && typeof w.doc === 'function' && typeof w.getDoc === 'function' ? w : null; }
    async function readDoc(F, col, id) { const s = await F.getDoc(F.doc(F.db, col, id)); return s && s.exists() ? (s.data() || {}) : null; }
    const say = (msg) => { try { if (typeof notify === 'function') notify(msg, 7000); } catch (e) {} };

    const st = {
        member: null,        // true once the clan document lists this player; false once it doesn't (null: not known yet)
        active: [],          // the clan's buffs running now (core/clan-buffs.js resolveActive)
        clicks: 0,           // clicks since the last send
        sched: null,         // { at, upcoming, cur } from events/state
        boss: null,          // { start, meta, total, at } for the bossfight running now (its phase decides the twist)
        flushing: false, paying: false, questing: false, renaming: '',
        clanUnsub: null, watching: '', // the live listener on the clan document, and which clan it is for
        schedUnsub: null, slotTimer: null, // the live listener on events/state, and the timer for the end of the slot running
    };

    // ---- membership, level and buffs ----
    function applyBuffs() {
        const m = B.multipliers(st.active, Date.now());
        window.clanActiveBuffs = st.active;
        window.clanBuffCpsMult = m.cps;
        window.clanBuffClickMult = m.click;
    }
    function forgetClan(name, why) {
        ['player_clanId', 'player_clanName', 'player_clanRole', 'whathappened_clan_level'].forEach(del);
        st.member = false; st.active = []; st.clicks = 0; st.boss = null;
        unwatchClan();
        window.clanLevel = 1;
        applyBuffs();
        const user = username();
        // the profile says the same, so the clan page and the leaderboard stop listing them
        try { const F = fs(); if (F && user && typeof F.setDoc === 'function') F.setDoc(F.doc(F.db, 'profiles', user), { clanId: null, clanName: null, clanRole: null }, { merge: true }).catch(() => {}); } catch (e) {}
        say(why === 'gone' ? `🛡️ ${name || 'Your clan'} was disbanded, so its perks and buffs are off. Find a new clan on the Clan page.`
            : `🛡️ You are no longer in ${name || 'your clan'}, so its perks and buffs are off.`);
        try { if (typeof updateDisplays === 'function') updateDisplays(); } catch (e) {}
    }
    // the sign-in id the clan knows this player by (the clan page stores it), so a new name doesn't lose the clan
    const UID_KEY = 'whathappened_clan_uid';
    const myUid = () => String(get(UID_KEY) || '');
    // Is the player in this clan document? By sign-in id first, then by name. While the name still matches, the id is learnt
    // from the document (and the clan page stores it too), so a later new name (core/names.js) doesn't read as a kick.
    function memberOf(d) {
        if (!R) return null;
        const user = username();
        let uid = myUid();
        if (!uid || !R.roleOf(d, uid)) {
            const u = R.uidOfName(d, user);
            if (u && R.roleOf(d, u)) { set(UID_KEY, u); uid = u; }
        }
        return R.memberIn ? R.memberIn(d, { uid, names: [user] }) : R.memberByName(d, user);
    }
    // My name changed since the clan last heard it (a new chat or Wilds name): tell the clan, so the member list, check-ins
    // and kicks follow the new name. Only my own entry (core/clan-roles.js renameSelf); the clan page does the same.
    async function carryRename(id, d) {
        const uid = myUid(), user = username(), F = fs();
        if (!uid || !user || !R.roleOf(d, uid) || !d.names || d.names[uid] === user || st.renaming === id + ':' + user) return;
        if (!F || typeof F.updateDoc !== 'function') return;
        st.renaming = id + ':' + user;
        const old = d.names[uid], swap = (list) => (Array.isArray(list) ? list.map((n) => (n === old ? user : n)).filter((n, i, a) => a.indexOf(n) === i) : list);
        const patch = { ['names.' + uid]: user };
        if (Array.isArray(d.members)) patch.members = swap(d.members);
        if (Array.isArray(d.leaders) && d.leaders.includes(old)) patch.leaders = swap(d.leaders);
        if (d.ownerUid === uid) patch.owner = user;
        try { await F.updateDoc(F.doc(F.db, 'clans', id), patch); } catch (e) { st.renaming = ''; }
    }
    // What the clan document says: level perks, buffs, the player's role, and whether they are still in it
    function applyDoc(id, d) {
        if (id !== clanId()) return; // the player changed clan meanwhile
        const name = get('player_clanName') || '';
        if (!d) { forgetClan(name, 'gone'); return; }
        const inIt = memberOf(d);
        if (inIt === false) { forgetClan(d.name || name, 'removed'); return; }
        if (inIt) { st.member = true; carryRename(id, d).catch(() => {}); }
        const level = L.levelFromXp(d.clanXp);
        window.clanLevel = level;
        set('whathappened_clan_level', String(level));
        if (typeof d.name === 'string' && d.name) set('player_clanName', d.name);
        // a promotion made by someone else shows here too (achievements read the role)
        const role = R ? ((myUid() && R.roleOf(d, myUid())) || R.roleOfName(d, username())) : null;
        if (role) set('player_clanRole', role);
        // Several clan buffs can run at once. The clan document is written by every member's browser, so it only says WHICH
        // buffs are on and until when: what they multiply comes from core/clan-buffs.js, never from the document.
        st.active = B.resolveActive(d, Date.now());
        applyBuffs();
        try { if (typeof updateDisplays === 'function' && window._saveLoaded) updateDisplays(); } catch (e) {}
    }
    // Keep up with the clan document: a live listener when there is one (a read only when the clan changes), else one read
    // here and another on the next call (main.js calls this every minute)
    async function refresh() {
        const id = clanId();
        if (!id) { unwatchClan(); st.member = null; st.active = []; applyBuffs(); return; }
        if (st.clanUnsub && st.watching === id) { applyBuffs(); return; }
        const F = fs();
        if (!F) return;
        if (typeof F.onSnapshot === 'function') { watchClan(F, id); return; }
        let d;
        try { d = await readDoc(F, 'clans', id); } catch (e) { return; } // offline: keep what we had
        applyDoc(id, d);
    }
    function watchClan(F, id) {
        unwatchClan();
        st.watching = id;
        st.clanUnsub = F.onSnapshot(F.doc(F.db, 'clans', id), (snap) => applyDoc(id, snap && snap.exists() ? (snap.data() || {}) : null),
            () => { st.clanUnsub = null; st.watching = ''; }); // refused or offline: the next refresh tries again
    }
    function unwatchClan() { try { if (st.clanUnsub) st.clanUnsub(); } catch (e) {} st.clanUnsub = null; st.watching = ''; }
    function levelPerk() {
        if (!clanId()) return L.perk(1);
        return L.perk(Number(window.clanLevel || get('whathappened_clan_level')) || 1);
    }

    // ---- the schedule (events/state): listened to, or read at most every 5 minutes and as soon as the slot running ends ----
    function setSchedule(upcoming) {
        const now = Date.now();
        st.sched = { at: now, upcoming, cur: EV.current(upcoming, now) };
        planSlotEnd();
    }
    async function schedule(force) {
        const now = Date.now(), s = st.sched;
        if (!force && s && (st.schedUnsub || now - s.at < SCHEDULE_MS) && !(s.cur && EV.toMs(s.cur.end) <= now)) return s;
        const F = fs();
        if (!F) return s;
        try { const d = await readDoc(F, 'events', 'state'); setSchedule(d && Array.isArray(d.upcoming) ? d.upcoming : []); } catch (e) { return s; }
        return st.sched;
    }
    function watchSchedule() {
        const F = fs();
        if (st.schedUnsub || !F || typeof F.onSnapshot !== 'function') return;
        st.schedUnsub = F.onSnapshot(F.doc(F.db, 'events', 'state'), (snap) => {
            const d = snap && snap.exists() ? (snap.data() || {}) : {};
            setSchedule(Array.isArray(d.upcoming) ? d.upcoming : []);
        }, () => { st.schedUnsub = null; });
    }
    // When the slot running now ends (or the schedule has run out), move it on and pay what ended. Every page does this at about
    // the same time, so each waits a random moment first; the transaction makes sure only one really moves it.
    function planSlotEnd() {
        clearTimeout(st.slotTimer);
        const s = st.sched, now = Date.now();
        if (!s || !clanId()) return;
        const wait = s.cur ? EV.toMs(s.cur.end) - now : 0;
        st.slotTimer = setTimeout(() => { upkeep().catch(() => {}); }, Math.max(0, wait) + Math.floor(Math.random() * 30000));
    }
    async function upkeep() {
        const F = fs();
        if (!F || typeof F.runTransaction !== 'function' || typeof F.serverTimestamp !== 'function') return;
        try { await F.runTransaction(F.db, (tx) => EV.upkeepTx(tx, (name) => F.doc(F.db, 'events', name), Date.now(), F.serverTimestamp())); } catch (e) { return; }
        // an event that just ended is paid once the last sends have landed
        setTimeout(() => { pay().catch(() => {}); }, EV.SETTLE_MS + 15000);
        if (!st.schedUnsub) schedule(true).catch(() => {});
    }
    // the bossfight's phases and twists (made by the clan page when the event is first shown) and the clan's damage so far
    async function bossNow(F, ev, id) {
        const start = EV.toMs(ev.start), now = Date.now();
        if (st.boss && st.boss.start === start && now - st.boss.at < BOSS_MS) return st.boss;
        try {
            const metaDoc = await readDoc(F, 'events', 'bossfight_meta');
            const meta = metaDoc && metaDoc.events ? metaDoc.events[String(start)] || null : null;
            const prog = meta ? await readDoc(F, 'events', 'bossfight_progress') : null;
            st.boss = { start, meta, total: EV.blockOf(prog, start, id).total, at: now };
        } catch (e) { if (!st.boss || st.boss.start !== start) st.boss = { start, meta: null, total: 0, at: now }; }
        return st.boss;
    }

    // ---- sending what clan events count ----
    function noteClick() { if (clanId() && st.member !== false) st.clicks = Math.min(MAX_PENDING_CLICKS, st.clicks + 1); }
    async function flush() {
        if (st.flushing || !st.clicks) return;
        const id = clanId(), user = username();
        if (!id || !user || st.member === false) { st.clicks = 0; return; }
        const F = fs();
        if (!F || typeof F.setDoc !== 'function' || typeof F.firestoreIncrement !== 'function') return; // kept until Firebase is up
        st.flushing = true;
        const n = st.clicks;
        try {
            const sc = await schedule();
            const ev = sc && sc.cur, kind = EV.kindOf(ev);
            // clicks only count toward the event they were made in; with nothing to send them to they are dropped
            if (kind !== 'bf' && kind !== 'eb' && kind !== 'cvc') { st.clicks = Math.max(0, st.clicks - n); return; }
            let amount = n;
            if (kind !== 'cvc') {
                const boss = kind === 'bf' ? await bossNow(F, ev, id) : null;
                const twist = boss ? EV.currentGimmick(boss.meta, boss.total) : null;
                amount = EV.bossDamage(n, asNum(typeof clickPower !== 'undefined' ? clickPower : 0), asNum(typeof cps !== 'undefined' ? cps : 0), twist);
            }
            st.clicks = Math.max(0, st.clicks - n);
            if (amount <= 0) return;
            try {
                await F.setDoc(F.doc(F.db, 'events', EV.KINDS[kind].doc), EV.contributionPatch(ev.start, id, user, amount, F.firestoreIncrement), { merge: true });
                if (st.boss && kind === 'bf') st.boss.total += amount;
            } catch (e) { st.clicks = Math.min(MAX_PENDING_CLICKS, st.clicks + n); } // try again with the next send
        } finally { st.flushing = false; }
    }
    // a prestige: noted now (the page reloads right after), sent on the next load into the Prestige Party it happened in
    function notePrestige() { if (clanId()) EV.notePrestige(localStorage, Date.now()); }
    async function flushPrestiges() {
        const times = EV.readPending(localStorage);
        if (!times.length) return;
        const id = clanId(), user = username();
        if (!id || !user) { del(EV.PENDING_KEY); return; }
        const F = fs();
        if (!F || typeof F.setDoc !== 'function' || typeof F.firestoreIncrement !== 'function') return;
        try {
            const sc = await schedule(true);
            const ended = await readDoc(F, 'events', 'last_ended_event');
            const slots = (sc ? sc.upcoming : []).concat(EV.history(ended));
            const placed = EV.placePending(times, slots, Date.now());
            for (const start of Object.keys(placed.counts)) {
                await F.setDoc(F.doc(F.db, 'events', EV.KINDS.pp.doc), EV.contributionPatch(start, id, user, placed.counts[start], F.firestoreIncrement), { merge: true });
            }
            if (placed.keep.length) set(EV.PENDING_KEY, JSON.stringify(placed.keep)); else del(EV.PENDING_KEY);
        } catch (e) { /* kept for the next try */ }
    }

    // ---- paying for events that are over ----
    function joinedAt(id) { try { const j = JSON.parse(get(JOINED_KEY) || 'null'); return j && j.clanId === id ? Number(j.at) || 0 : 0; } catch (e) { return 0; } }
    // the clan's XP for an event, added once per clan (eventXpAwarded keeps the record)
    async function awardClanXp(F, id, key, xp) {
        if (typeof F.runTransaction !== 'function') return false;
        try {
            const ref = F.doc(F.db, 'clans', id);
            await F.runTransaction(F.db, async (tx) => {
                const snap = await tx.get(ref);
                if (!snap.exists()) throw new Error('no clan');
                const d = snap.data() || {};
                const done = d.eventXpAwarded && typeof d.eventXpAwarded === 'object' ? d.eventXpAwarded : {};
                if (done[key]) return;
                tx.update(ref, { clanXp: (Number(d.clanXp) || 0) + xp, eventXpAwarded: EV.withXpAwarded(done, key) });
            });
            return true;
        } catch (e) { return false; }
    }
    // gems and Clan Points straight into the running game (main.js's state), then saved
    function credit(r) {
        try {
            if (!window._saveLoaded || (typeof suppressAutosave !== 'undefined' && suppressAutosave)) return false;
            diamonds = (Number(diamonds) || 0) + (Number(r.gems) || 0);
            clanPoints = (Number(clanPoints) || 0) + (Number(r.clanPoints) || 0);
            saveGame();
            try { updateDisplays(); } catch (e) {}
            return true;
        } catch (e) { return false; }
    }
    // one tab at a time (the clan page pays under the same lock), so two open pages never pay the same event twice
    function withLock(fn) {
        try { if (navigator.locks && typeof navigator.locks.request === 'function') return navigator.locks.request('whathappened-clan-pay', fn); } catch (e) {}
        return fn();
    }
    async function pay() {
        const id = clanId();
        if (st.paying || !id || st.member === false || !window._saveLoaded) return [];
        const F = fs();
        if (!F || typeof F.runTransaction !== 'function') return [];
        st.paying = true;
        try {
            const paid = await EV.payEnded({
                now: () => Date.now(), store: localStorage, clanId: id, username: username(), joinedAt: joinedAt(id),
                read: (name) => readDoc(F, 'events', name),
                readClan: () => readDoc(F, 'clans', id),
                levelOf: (c) => L.levelFromXp(c && c.clanXp), eventGems: L.eventGems,
                credit: async (r) => credit(r),
                awardClanXp: (key, xp) => awardClanXp(F, id, key, xp),
                lock: withLock,
            });
            paid.forEach((p, i) => setTimeout(() => say(`🏆 Clan event over: ${EV.KINDS[p.kind].name}. ${p.reward.text} You got ${p.reward.gems} gems and ${p.reward.clanPoints} Clan Points.`
                + (p.reward.bonusGems ? ' (Top contributor bonus included!)' : '') + (p.xpOk ? '' : ' Your clan\'s XP will be added on the next try.')), i * 1500));
            return paid;
        } catch (e) { return []; } finally { st.paying = false; }
    }

    // ---- clan XP from the daily and weekly challenges (core/challenges.js; amounts in core/clan-levels.js) ----
    // Each challenge the player claims while in a clan gives the clan XP once, and counts toward this week's contributors.
    // Challenges claimed outside a clan are noted as done, so joining one later doesn't pour them all in.
    function readJSON(k) { try { return JSON.parse(get(k) || 'null'); } catch (e) { return null; } }
    async function quests() {
        if (st.questing) return 0;
        const given = readJSON(L.QUESTS_KEY), owed = L.questXpOwed(readJSON('whathappened_challenges'), given);
        if (!owed.length) return 0;
        const id = clanId(), user = username();
        if (!id || !user || st.member === false) { set(L.QUESTS_KEY, JSON.stringify(L.withQuestsGiven(given, owed.map((o) => o.key)))); return 0; }
        const F = fs();
        if (st.member !== true || !F || typeof F.runTransaction !== 'function') return 0; // tried again on the next look
        st.questing = true;
        const xp = owed.reduce((n, o) => n + o.xp, 0);
        let before = 1, after = 1, clanName = '';
        try {
            const ref = F.doc(F.db, 'clans', id);
            await F.runTransaction(F.db, async (tx) => {
                const snap = await tx.get(ref);
                if (!snap.exists()) throw new Error('no clan');
                const d = snap.data() || {}, cur = Number(d.clanXp) || 0;
                clanName = d.name || '';
                before = L.levelFromXp(cur); after = L.levelFromXp(cur + xp);
                tx.update(ref, { clanXp: cur + xp, contrib: L.addContribution(d.contrib, user, xp, Date.now()) });
            });
            set(L.QUESTS_KEY, JSON.stringify(L.withQuestsGiven(readJSON(L.QUESTS_KEY), owed.map((o) => o.key))));
            set('whathappened_clan_quest_xp', String((Number(get('whathappened_clan_quest_xp')) || 0) + xp)); // the Quest Giver achievement
            say(`🛡️ Your clan got +${xp} XP from your challenge${owed.length === 1 ? '' : 's'}!`);
            if (after > before && typeof F.addDoc === 'function' && typeof F.collection === 'function') {
                F.addDoc(F.collection(F.db, 'clan_chat'), { clanId: id, name: 'SYSTEM', message: `🎉 ${clanName || 'The clan'} reached level ${after}!`, createdAt: F.serverTimestamp(), system: true, color: 'gold' }).catch(() => {});
            }
            return xp;
        } catch (e) { return 0; } finally { st.questing = false; }
    }

    // ---- what the clan page changed in the save while this tab was open ----
    const seenDeltas = new Set();
    window.addEventListener('storage', (ev) => {
        if (ev.key !== DELTA_KEY || !ev.newValue) return;
        try {
            const d = JSON.parse(ev.newValue);
            if (!d || !d.id || seenDeltas.has(d.id)) return;
            seenDeltas.add(d.id);
            // before the save was loaded, or a change the loaded save already had: nothing to do
            if (!window._saveLoaded || (window._saveLoadedAt && Number(d.at) < window._saveLoadedAt)) return;
            if (d.diamonds) diamonds = Math.max(0, (Number(diamonds) || 0) + Number(d.diamonds));
            if (d.clanPoints) clanPoints = Math.max(0, (Number(clanPoints) || 0) + Number(d.clanPoints));
            if (d.goldenWhat) goldenWhat = Math.max(0, (Number(goldenWhat) || 0) + Number(d.goldenWhat));
            if (d.totalGoldenEver) totalGoldenEver = (Number(totalGoldenEver) || 0) + Number(d.totalGoldenEver);
            try { updateDisplays(); } catch (e) {}
        } catch (e) {}
    });
    // joining, leaving or switching clan on the clan page: start over with the new one
    window.addEventListener('storage', (ev) => {
        if (ev.key !== 'player_clanId') return;
        unwatchClan();
        st.member = null; st.active = []; st.clicks = 0; st.boss = null; applyBuffs();
        if (clanId()) refresh().then(() => { planSlotEnd(); return pay(); }).catch(() => {});
    });

    // ---- running ----
    async function start() {
        await refresh();
        watchSchedule();
        await flushPrestiges();
        await pay();
        setTimeout(() => { quests().catch(() => {}); }, 5000);
    }
    setInterval(() => { flush().catch(() => {}); }, FLUSH_MS);
    setInterval(() => { flushPrestiges().then(pay).catch(() => {}); }, PAY_MS);
    // a claimed challenge reaches the clan within half a minute (the challenges panel is on this page, so no storage event)
    setInterval(() => { quests().catch(() => {}); }, 30000);
    document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'hidden') flush().catch(() => {}); });

    window.WHClanGame = { refresh, applyBuffs, levelPerk, noteClick, flush, notePrestige, flushPrestiges, pay, start, schedule, upkeep, quests,
        member: () => st.member, _state: st };
}());
