/**
 * Holy What Happeneds 👼: the premium currency, the pure part (no page, no Firebase). premium.js and premium-panel.js are the pages' side,
 * premium-cloud.js the account's side, kofi-worker/ the server that credits bought Holy What Happeneds.
 *
 * TWO POOLS, ONE NAME
 * - Earned Holy What Happeneds come from playing (EARN below). They live in localStorage whathappened_premium with the rest of this
 *   state, synced to the account like every other progress key (core/progress.js SYNC_KEYS). Like gems, the browser is
 *   trusted with them: a player who edits their storage only changes their own game.
 * - Bought Holy What Happeneds come only from a Ko-fi payment, credited by the worker into Firestore wallets/{uid}. No browser can add
 *   to that balance (firestore-premium.rules): it can only take Holy What Happeneds off it, in the same write that logs what they paid
 *   for (wallets/{uid}/spends). checkWalletSpend() below is that rule, written out so it can be tested here.
 * - The balance shown is the two together. A purchase takes earned Holy What Happeneds first and the rest from the account; the
 *   account's part is taken first (a Firestore transaction), and only then the earned part and the item, so a failed
 *   or refused write costs nothing. A purchase that used bought Holy What Happeneds is in the account's spends log, so it comes back
 *   on any device signed in to the account (restoreFromSpends).
 *
 * WHAT BEANS BUY: cosmetics only (CATALOG). Never gems, rubies, Golden, Glory, lootboxes, follower packs or anything with a
 * random outcome, nothing the game gives for free today, and nothing in the casino. tests/premium.test.js holds that line.
 *
 * WHERE EARNED BEANS COME FROM (EARN): worked out from the saves the game already keeps, never from a hook in the code
 * that pays them, so each one is paid once whichever page notices first (grant ids, e.g. 'ach:x_golden_10', 'boss:tidal',
 * 'wk:2026-W46'). The first time a save sees Holy What Happeneds, what it had already done pays at most EARN.retroCap.
 *
 * Works in a browser (<script src="core/premium.js"> after core/premium-config.js sets window.WHPremium) and in Node.
 */
(function (root, factory) {
    if (typeof module === 'object' && module.exports) module.exports = factory(require('./premium-config'));
    else root.WHPremium = factory(root.WHPremiumConfig);
}(typeof self !== 'undefined' ? self : this, function (Config) {
    'use strict';

    const KEY = 'whathappened_premium';
    const CUR = Config.currency;
    const LOG_MAX = 30, APPLIED_MAX = 200, EARNED_MAX = 1e7;

    // ---------------- what Holy What Happeneds buy ----------------
    // kind: title (added to the game's titles; shown next to your name in chat and on the leaderboard), theme (the game
    // page's colours), pop (the "+N" that floats up when you click), trail (behind you in the Wilds; only you see it).
    // Each is owned once and can be switched on and off freely. No item gives anything else.
    const KINDS = ['title', 'theme', 'pop', 'trail'];
    const CATALOG = [
        { id: 't_bean_counter', kind: 'title', name: 'Bean Counter', cost: 100, rarity: 'rare', desc: 'A title. Counts every bean, twice.' },
        { id: 't_night_roaster', kind: 'title', name: 'Night Roaster', cost: 250, rarity: 'epic', desc: 'A title for the ones who play after midnight.' },
        { id: 't_barista', kind: 'title', name: 'Barista of Chaos', cost: 400, rarity: 'epic', desc: 'A title. Nobody ordered this.' },
        { id: 't_espresso', kind: 'title', name: 'Espresso Legend', cost: 600, rarity: 'legendary', desc: 'A title. Short, strong, unforgettable.' },
        { id: 'th_mocha', kind: 'theme', name: 'Mocha', cost: 350, swatch: ['#d39a5c', '#7a4a2a'], desc: 'The game page in caramel and cocoa.' },
        { id: 'th_matcha', kind: 'theme', name: 'Matcha', cost: 350, swatch: ['#9ad66b', '#3d6b3a'], desc: 'The game page in soft green tea.' },
        { id: 'th_cherry', kind: 'theme', name: 'Cherry Cola', cost: 350, swatch: ['#ff6b81', '#7a1d36'], desc: 'The game page in fizzy red.' },
        { id: 'th_midnight', kind: 'theme', name: 'Midnight Roast', cost: 350, swatch: ['#8f9bff', '#2a2f6b'], desc: 'The game page in deep night blue.' },
        { id: 'pop_latte', kind: 'pop', name: 'Latte Foam', cost: 200, swatch: ['#fff3df', '#c98a4b'], desc: 'Your click numbers, creamy and round.' },
        { id: 'pop_neon', kind: 'pop', name: 'Neon', cost: 200, swatch: ['#5ee7ff', '#ff5bd0'], desc: 'Your click numbers glow like a sign at 3 a.m.' },
        { id: 'pop_ember', kind: 'pop', name: 'Ember', cost: 200, swatch: ['#ffd36b', '#ff5a1f'], desc: 'Your click numbers, hot off the grill.' },
        { id: 'tr_steam', kind: 'trail', name: 'Steam Trail', cost: 300, colors: ['rgba(235,240,255,0.55)', 'rgba(200,210,230,0.35)'], rise: 18, desc: 'Puffs of steam behind you in the Wilds. Only you see it.' },
        { id: 'tr_ember', kind: 'trail', name: 'Ember Trail', cost: 300, colors: ['rgba(255,190,80,0.85)', 'rgba(255,90,30,0.7)'], rise: 26, desc: 'Sparks behind you in the Wilds. Only you see it.' },
        { id: 'tr_frost', kind: 'trail', name: 'Frost Trail', cost: 300, colors: ['rgba(170,235,255,0.8)', 'rgba(120,170,255,0.6)'], rise: 6, desc: 'Frost glitter behind you in the Wilds. Only you see it.' },
    ];
    const BY_ID = Object.fromEntries(CATALOG.map((c) => [c.id, c]));
    const EQUIP_KINDS = ['theme', 'pop', 'trail'];

    // ---------------- how Holy What Happeneds are earned ----------------
    // Small on purpose (tools/simulate-beans.js prints what each kind of player earns a month against the prices above).
    const EARN = {
        // each achievement, once, by rarity
        achievement: { common: 0, uncommon: 1, rare: 1, epic: 2, legendary: 4, mythic: 8 },
        boss: 5,          // the first time each Wilds boss falls to you
        weekly: 4,        // all three weekly challenges claimed (the week's bonus)
        streak: 2,        // every 7th day in a row with all three dailies
        // a finished Arena season you played 5+ rated games in, by the best rank you reached; once a season
        season: { bronze: 2, silver: 4, gold: 6, platinum: 8, diamond: 10, champion: 15 },
        glory: 5,         // Varro's shop in the Arena (core/world-arena.js SHOP 'beans'): 1,500 Glory, once a week
        retroCap: 40,     // the first time a save sees Holy What Happeneds: what it had already done pays this much at most
    };
    // how far back a weekly/daily/season reward still counts, and how long its grant id is kept after that
    const DERIVE_DAYS = 70, PRUNE_DAYS = 120;
    const DAY = 86400000;

    // ---------------- the state ----------------
    function fresh() {
        return { v: 1, earned: 0, earnedTotal: 0, started: 0, owned: {}, equip: { theme: '', pop: '', trail: '' }, grants: {}, log: [],
            applied: [], paid: { uid: '', balance: 0, at: 0 } };
    }
    const isObj = (v) => v !== null && typeof v === 'object' && !Array.isArray(v);
    const int = (v, lo, hi) => { const n = Math.floor(Number(v)); return Number.isFinite(n) ? Math.max(lo, Math.min(hi, n)) : lo; };
    const GRANT_RE = /^(ach|boss|wk|streak|season|glory|retro):[A-Za-z0-9_:-]{1,60}$/;
    function clean(raw) {
        const s = fresh();
        if (!isObj(raw)) return s;
        s.earned = int(raw.earned, 0, EARNED_MAX);
        s.earnedTotal = Math.max(s.earned, int(raw.earnedTotal, 0, 1e9));
        s.started = int(raw.started, 0, 1e15);
        if (isObj(raw.owned)) for (const id in raw.owned) if (BY_ID[id] && raw.owned[id] === true) s.owned[id] = true;
        if (isObj(raw.equip)) for (const k of EQUIP_KINDS) {
            const id = raw.equip[k];
            if (typeof id === 'string' && BY_ID[id] && BY_ID[id].kind === k && s.owned[id]) s.equip[k] = id;
        }
        if (isObj(raw.grants)) for (const id in raw.grants) if (GRANT_RE.test(id)) s.grants[id] = int(raw.grants[id], 0, 1e6);
        if (Array.isArray(raw.log)) s.log = raw.log.filter((e) => isObj(e) && Number.isFinite(e.n) && typeof e.why === 'string')
            .slice(-LOG_MAX).map((e) => ({ t: int(e.t, 0, 1e15), n: int(e.n, -1e7, 1e7), why: e.why.slice(0, 80) }));
        if (Array.isArray(raw.applied)) s.applied = raw.applied.filter((x) => typeof x === 'string' && /^[A-Za-z0-9_-]{4,40}$/.test(x)).slice(-APPLIED_MAX);
        if (isObj(raw.paid)) s.paid = { uid: typeof raw.paid.uid === 'string' ? raw.paid.uid.slice(0, 128) : '', balance: int(raw.paid.balance, 0, 1e9), at: int(raw.paid.at, 0, 1e15) };
        return s;
    }
    function note(s, t, n, why) {
        s.log.push({ t, n, why: String(why).slice(0, 80) });
        if (s.log.length > LOG_MAX) s.log.splice(0, s.log.length - LOG_MAX);
    }

    // ---------------- earning ----------------
    // When a period id began (ms), or null: 'YYYY-Www' (ISO week, as core/world-bridge.js weekKey), 'YYYY-MM-DD', 'YYYY-MM'
    function periodStart(id) {
        let m = /^(\d{4})-W(\d{2})$/.exec(id);
        if (m) {
            const jan4 = Date.UTC(+m[1], 0, 4), dow = new Date(jan4).getUTCDay() || 7;
            return jan4 - (dow - 1) * DAY + (+m[2] - 1) * 7 * DAY;
        }
        m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(id);
        if (m) return Date.UTC(+m[1], +m[2] - 1, +m[3]);
        m = /^(\d{4})-(\d{2})$/.exec(id);
        if (m) return Date.UTC(+m[1], +m[2] - 1, 1);
        return null;
    }
    const recent = (id, now) => { const t = periodStart(id); return t !== null && now - t <= DERIVE_DAYS * DAY && t <= now + 8 * DAY; };

    // Every reward the saves say was earned: [{ id, n, why }]. view = {
    //   achievements: [{ key, rarity, name }] unlocked,  world: the Wilds save (or null),  challenges: core/challenges.js state }
    function sources(view, now) {
        const out = [];
        const v = view || {};
        for (const a of v.achievements || []) {
            const n = EARN.achievement[a && a.rarity] || 0;
            if (n > 0 && a.key && /^[A-Za-z0-9_]{1,60}$/.test(a.key)) out.push({ id: 'ach:' + a.key, n, why: 'Achievement: ' + (a.name || a.key) });
        }
        const w = isObj(v.world) ? v.world : null;
        if (w) {
            const names = v.bossNames || {};
            // the Wilds save keeps each boss as { kills, lastKillDay, ... } (core/world-logic.js)
            if (isObj(w.bosses)) for (const id in w.bosses) {
                const b = w.bosses[id], kills = isObj(b) ? Number(b.kills) : 0;
                if (/^[a-z0-9_]{1,40}$/.test(id) && kills > 0) out.push({ id: 'boss:' + id, n: EARN.boss, why: 'First win: ' + (names[id] || id) });
            }
            const a = isObj(w.arena) ? w.arena : null;
            const last = a && isObj(a.seasonLast) ? a.seasonLast : null;
            if (last && last.claimed === true && typeof last.id === 'string' && Number(last.games) >= (v.seasonMinGames || 5) && EARN.season[last.rank] && recent(last.id, now))
                out.push({ id: 'season:' + last.id, n: EARN.season[last.rank], why: 'Arena season ' + last.id + ' (' + last.rank + ')' });
            const b = a && isObj(a.bought) ? a.bought : null;
            if (b && typeof b.week === 'string' && isObj(b.n) && recent(b.week, now)) {
                const k = int(b.n.beans, 0, 7);
                for (let i = 1; i <= k; i++) out.push({ id: 'glory:' + b.week + ':' + i, n: EARN.glory, why: 'Bought with Glory' });
            }
        }
        const c = isObj(v.challenges) ? v.challenges : null;
        if (c) {
            if (isObj(c.week) && c.week.bonus === true && typeof c.week.key === 'string' && recent(c.week.key, now)) out.push({ id: 'wk:' + c.week.key, n: EARN.weekly, why: 'All three weekly challenges' });
            const st = isObj(c.streak) ? c.streak : null;
            if (st && Number(st.n) > 0 && Number(st.n) % (v.streakEvery || 7) === 0 && typeof st.last === 'string' && recent(st.last, now))
                out.push({ id: 'streak:' + st.last, n: EARN.streak, why: st.n + ' days in a row of dailies' });
        }
        return out.filter((x) => GRANT_RE.test(x.id));
    }

    // Pay what `list` (sources()) holds that this state hasn't paid. The first time, it all counts as one thank-you of at most
    // EARN.retroCap. Returns { paid, items: [{ id, n, why }], retro }.
    function applyEarnings(s, list, now) {
        const items = [];
        let paid = 0;
        if (!s.started) {
            let sum = 0;
            for (const x of list) if (!(x.id in s.grants)) { s.grants[x.id] = 0; sum += x.n; }
            const n = Math.min(sum, EARN.retroCap);
            s.started = now;
            if (n > 0) { s.grants['retro:first'] = n; credit(s, n, now, 'For what you had already done'); items.push({ id: 'retro:first', n, why: 'For what you had already done' }); }
            return { paid: n, items, retro: true };
        }
        for (const x of list) {
            if (x.id in s.grants) continue;
            s.grants[x.id] = x.n;
            credit(s, x.n, now, x.why);
            paid += x.n;
            items.push(x);
        }
        prune(s, now);
        return { paid, items, retro: false };
    }
    function credit(s, n, now, why) {
        const amt = int(n, 0, 1e6);
        if (!amt) return 0;
        s.earned = Math.min(EARNED_MAX, s.earned + amt);
        s.earnedTotal += amt;
        note(s, now, amt, why);
        return amt;
    }
    // drop grant ids of weeks, days and seasons long gone (sources() no longer offers them)
    function prune(s, now) {
        for (const id of Object.keys(s.grants)) {
            const m = /^(?:wk|streak|season|glory):([0-9W-]+)/.exec(id);
            if (!m) continue;
            const t = periodStart(m[1]);
            if (t !== null && now - t > PRUNE_DAYS * DAY) delete s.grants[id];
        }
    }

    // ---------------- spending ----------------
    // Earned first, the rest from the account. ok: whether both together cover it.
    function planSpend(earned, paid, cost) {
        const e = Math.max(0, Math.floor(earned) || 0), p = Math.max(0, Math.floor(paid) || 0), c = Math.max(0, Math.floor(cost) || 0);
        const fromEarned = Math.min(e, c);
        return { ok: e + p >= c, fromEarned, fromPaid: c - fromEarned, short: Math.max(0, c - e - p) };
    }
    function canBuy(s, id) {
        const it = BY_ID[id];
        if (!it) return { ok: false, reason: 'unknown' };
        if (s.owned[id]) return { ok: false, reason: 'owned' };
        return { ok: true, item: it };
    }
    // The item arrives and the earned part is taken (the account's part was already taken by the caller).
    function completePurchase(s, id, fromEarned, now, spendId) {
        const it = BY_ID[id];
        if (!it || s.owned[id]) return false;
        const e = int(fromEarned, 0, EARNED_MAX);
        if (e > s.earned) return false;
        s.earned -= e;
        s.owned[id] = true;
        if (EQUIP_KINDS.includes(it.kind)) s.equip[it.kind] = id;
        if (spendId) markApplied(s, spendId);
        note(s, now, -it.cost, 'Bought ' + it.name);
        return true;
    }
    function markApplied(s, spendId) {
        if (typeof spendId !== 'string' || s.applied.includes(spendId)) return;
        s.applied.push(spendId);
        if (s.applied.length > APPLIED_MAX) s.applied.splice(0, s.applied.length - APPLIED_MAX);
    }
    function equip(s, id) {
        const it = BY_ID[id];
        if (!it || !s.owned[id] || !EQUIP_KINDS.includes(it.kind)) return false;
        s.equip[it.kind] = s.equip[it.kind] === id ? '' : id;
        return true;
    }
    // Purchases logged in the account (wallets/{uid}/spends: [{ id, item }]) that this device doesn't have yet. Returns the
    // items given back.
    function restoreFromSpends(s, spends) {
        const back = [];
        for (const sp of spends || []) {
            if (!sp || typeof sp.id !== 'string' || s.applied.includes(sp.id)) continue;
            markApplied(s, sp.id);
            if (BY_ID[sp.item] && !s.owned[sp.item]) { s.owned[sp.item] = true; back.push(BY_ID[sp.item]); }
        }
        return back;
    }

    // ---------------- the account's balance: the spend rule (firestore-premium.rules, written out) ----------------
    // before/after: wallets/{uid} before and after the write; spend: the spends/{spendId} document written with it;
    // spendExisted: whether that spend id was already taken. True when the rules would allow the pair of writes.
    const WALLET_CLIENT_KEYS = ['balance', 'spent', 'lastSpend'];
    function checkWalletSpend(before, after, spend, spendId, spendExisted) {
        if (!isObj(before) || !isObj(after) || !isObj(spend)) return false;
        const changed = Object.keys(Object.assign({}, before, after)).filter((k) => JSON.stringify(before[k]) !== JSON.stringify(after[k]));
        if (!changed.every((k) => WALLET_CLIENT_KEYS.includes(k))) return false;
        const cost = (before.balance || 0) - after.balance;
        if (!Number.isInteger(after.balance) || after.balance < 0 || !(cost > 0)) return false;
        if (after.spent !== (Number.isInteger(before.spent) ? before.spent : 0) + cost) return false;
        if (after.lastSpend !== spendId || spendExisted) return false;
        if (!/^[A-Za-z0-9_-]{4,40}$/.test(String(spendId))) return false;
        const keys = Object.keys(spend);
        if (!keys.every((k) => ['item', 'cost', 'at'].includes(k)) || keys.length !== 3) return false;
        return spend.cost === cost && typeof spend.item === 'string' && spend.item.length >= 1 && spend.item.length <= 40 && spend.at === 'request.time';
    }

    // ---------------- showing amounts ----------------
    const amount = (n) => CUR.icon + ' ' + Math.floor(Number(n) || 0).toLocaleString('en-US');
    const plural = (n) => (Math.floor(n) === 1 ? CUR.one : CUR.many);

    return { KEY, CUR, KINDS, CATALOG, BY_ID, EQUIP_KINDS, EARN, DERIVE_DAYS, PRUNE_DAYS, fresh, clean, periodStart, sources, applyEarnings,
        credit, prune, planSpend, canBuy, completePurchase, markApplied, equip, restoreFromSpends, checkWalletSpend, WALLET_CLIENT_KEYS,
        amount, plural };
}));
