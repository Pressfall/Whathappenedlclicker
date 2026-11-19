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
 * WHAT THEY BUY (CATALOG): looks (titles, themes, click numbers, clicker auras, Wilds trails, a halo or wings in the Wilds),
 * and, within a weekly limit, gems and Golden What Happeneds and boost bundles from the Items menu (no random ones). The owner chose on 2026-11-10 that bought ones may trade for gems and Golden too, knowing gems
 * and Golden can then be spent on lootboxes (random contents) and in the casino. Never lootboxes, follower packs, rubies or
 * Glory directly, and never anything the game gives for free today. tests/premium.test.js holds that line.
 *
 * WHERE EARNED ONES COME FROM (EARN): worked out from the saves the game already keeps, never from a hook in the code
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
    // page's colours), pop (the "+N" that floats up when you click), aura (around the What Happened you click), trail
    // (behind you in the Wilds), mark (a halo or wings on you in the Wilds); the Wilds ones only you see. Each is owned once
    // and switched on and off freely.
    // Bought again and again, up to perWeek times a week (the Wilds' weeks), and only on the game page: exchange (gems or
    // Golden What Happeneds, main.js addGems / addGolden) and bundle (timed boosts from the Items menu, items.js grantItems;
    // only ids core/world-bridge.js ITEMS allows, which are never gems, Golden or lootboxes).
    const KINDS = ['title', 'theme', 'pop', 'aura', 'trail', 'mark', 'exchange', 'bundle'];
    const CATALOG = [
        { id: 'x_gems', kind: 'exchange', name: '10 gems', cost: 15, gems: 10, perWeek: 5, desc: 'For the Treasury, skins, music and everything else gems buy.' },
        { id: 'x_golden', kind: 'exchange', name: '1 Golden What Happened', cost: 40, golden: 1, perWeek: 2, desc: 'For Divine upgrades, followers and everything else Golden buys.' },
        { id: 'b_hourglass', kind: 'bundle', name: 'Hourglass', cost: 20, items: { hourglass: 1 }, perWeek: 3, desc: 'An hour of What Happeneds at once, whenever you use it from Items.' },
        { id: 'b_rush', kind: 'bundle', name: 'Holy Rush', cost: 10, items: { energyDrink: 2, spareBattery: 2, loadedDice: 1 }, perWeek: 3, desc: '2 Energy Drinks, 2 Spare Batteries and a Loaded Dice: short bursts of double clicks, double income and crits.' },
        { id: 't_acolyte', kind: 'title', name: 'Acolyte of What', cost: 100, rarity: 'rare', desc: 'A title. Every saint starts by clicking.' },
        { id: 't_haloed', kind: 'title', name: 'Haloed', cost: 250, rarity: 'epic', desc: 'A title. Your name, lit from above.' },
        { id: 't_saint', kind: 'title', name: 'Saint of the Click', cost: 400, rarity: 'epic', desc: 'A title for the most faithful clicker.' },
        { id: 't_archangel', kind: 'title', name: 'Archangel of What', cost: 600, rarity: 'legendary', desc: 'A title. The highest choir sings your name.' },
        { id: 'th_heaven', kind: 'theme', name: 'Heavenly', cost: 350, swatch: ['#fff1b8', '#c9a24a'], desc: 'The game page in soft gold and sky.' },
        { id: 'th_sanctum', kind: 'theme', name: 'Sanctum', cost: 350, swatch: ['#b48cff', '#ffd27a'], desc: 'The game page in temple violet and gold.' },
        { id: 'th_dawn', kind: 'theme', name: 'First Light', cost: 350, swatch: ['#ffd1b3', '#e07a52'], desc: 'The game page in the colours of dawn.' },
        { id: 'th_stained', kind: 'theme', name: 'Stained Glass', cost: 350, swatch: ['#5fb4ff', '#ff6b8a'], desc: 'The game page in cathedral blues and reds.' },
        { id: 'pop_feather', kind: 'pop', name: 'Feather', cost: 200, swatch: ['#ffffff', '#b9a77a'], desc: 'Your click numbers, light as a feather.' },
        { id: 'pop_halo', kind: 'pop', name: 'Halo', cost: 200, swatch: ['#ffe9a3', '#ffcf3a'], desc: 'Your click numbers wear a golden halo.' },
        { id: 'pop_choir', kind: 'pop', name: 'Choir', cost: 200, swatch: ['#e8f4ff', '#b48cff'], desc: 'Your click numbers glow like a hymn.' },
        { id: 'au_halo', kind: 'aura', name: 'Halo', cost: 300, swatch: ['#fff3b0', '#e6b93a'], desc: 'A golden halo floats over the What Happened you click.' },
        { id: 'au_glow', kind: 'aura', name: 'Holy Glow', cost: 300, swatch: ['#fffbe0', '#ffd66e'], desc: 'Soft holy light breathes around the What Happened you click.' },
        { id: 'au_rays', kind: 'aura', name: 'Heaven\'s Rays', cost: 450, swatch: ['#fff1b8', '#9fc7ff'], desc: 'Rays of light turn slowly behind the What Happened you click.' },
        { id: 'tr_feathers', kind: 'trail', name: 'Falling Feathers', cost: 300, colors: ['rgba(255,255,255,0.85)', 'rgba(230,236,255,0.6)'], rise: -10, desc: 'Feathers drift down behind you in the Wilds. Only you see it.' },
        { id: 'tr_light', kind: 'trail', name: 'Holy Light', cost: 300, colors: ['rgba(255,230,140,0.9)', 'rgba(255,250,210,0.7)'], rise: 22, desc: 'A trail of holy light behind you in the Wilds. Only you see it.' },
        { id: 'tr_divine', kind: 'trail', name: 'Divine Embers', cost: 300, colors: ['rgba(190,150,255,0.85)', 'rgba(255,210,120,0.75)'], rise: 16, desc: 'Violet and gold sparks behind you in the Wilds. Only you see it.' },
        { id: 'mk_halo', kind: 'mark', name: 'Halo', cost: 350, swatch: ['#fff3b0', '#e6b93a'], desc: 'A golden halo over your head in the Wilds. Only you see it.' },
        { id: 'mk_wings', kind: 'mark', name: 'Angel Wings', cost: 500, swatch: ['#ffffff', '#c9d6f2'], desc: 'White wings on your back in the Wilds, beating as you run. Only you see them.' },
    ];
    const BY_ID = Object.fromEntries(CATALOG.map((c) => [c.id, c]));
    const EQUIP_KINDS = ['theme', 'pop', 'aura', 'trail', 'mark'];
    const isExchange = (it) => !!it && it.kind === 'exchange';
    // bought again and again (up to perWeek a week) instead of owned once
    const isRepeat = (it) => !!it && (it.kind === 'exchange' || it.kind === 'bundle');
    // the week as the Wilds count them (core/world-bridge.js weekKey: ISO weeks, the player's local date)
    function weekKey(now) {
        const d = new Date(now);
        const t = new Date(Date.UTC(d.getFullYear(), d.getMonth(), d.getDate()));
        const dow = t.getUTCDay() || 7;
        t.setUTCDate(t.getUTCDate() + 4 - dow);
        const year = t.getUTCFullYear();
        return year + '-W' + String(Math.ceil(((t - Date.UTC(year, 0, 1)) / 86400000 + 1) / 7)).padStart(2, '0');
    }

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
        return { v: 1, earned: 0, earnedTotal: 0, started: 0, owned: {}, equip: { theme: '', pop: '', aura: '', trail: '', mark: '' }, grants: {}, log: [],
            applied: [], paid: { uid: '', balance: 0, at: 0 }, week: { id: '', n: {} } };
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
        if (isObj(raw.owned)) for (const id in raw.owned) if (BY_ID[id] && !isRepeat(BY_ID[id]) && raw.owned[id] === true) s.owned[id] = true;
        if (isObj(raw.week) && typeof raw.week.id === 'string' && /^\d{4}-W\d{2}$/.test(raw.week.id)) {
            s.week.id = raw.week.id;
            if (isObj(raw.week.n)) for (const id in raw.week.n) if (isRepeat(BY_ID[id])) s.week.n[id] = int(raw.week.n[id], 0, 1000);
        }
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
    // how many more of a repeat item (gems, Golden, a bundle) can be bought this week (Infinity for a look)
    function weekLeft(s, id, now) {
        const it = BY_ID[id];
        if (!isRepeat(it)) return Infinity;
        const used = s.week && s.week.id === weekKey(now) ? (s.week.n[id] || 0) : 0;
        return Math.max(0, it.perWeek - used);
    }
    // { ok, reason?: 'unknown' | 'owned' | 'week', item }
    function canBuy(s, id, now) {
        const it = BY_ID[id];
        if (!it) return { ok: false, reason: 'unknown' };
        if (isRepeat(it)) return weekLeft(s, id, now === undefined ? Date.now() : now) > 0 ? { ok: true, item: it } : { ok: false, reason: 'week', item: it };
        if (s.owned[id]) return { ok: false, reason: 'owned' };
        return { ok: true, item: it };
    }
    // A repeat item: the earned part is taken and the week's count goes up. The caller then hands over the gems, Golden or
    // boosts (main.js addGems / addGolden, items.js grantItems), straight after this is saved.
    function completeExchange(s, id, fromEarned, now, spendId) {
        const it = BY_ID[id];
        if (!isRepeat(it) || weekLeft(s, id, now) <= 0) return false;
        const e = int(fromEarned, 0, EARNED_MAX);
        if (e > s.earned) return false;
        s.earned -= e;
        const wk = weekKey(now);
        if (s.week.id !== wk) s.week = { id: wk, n: {} };
        s.week.n[id] = (s.week.n[id] || 0) + 1;
        if (spendId) markApplied(s, spendId);
        note(s, now, -it.cost, (isExchange(it) ? 'Traded for ' : 'Bought ') + it.name);
        return true;
    }
    // The item arrives and the earned part is taken (the account's part was already taken by the caller).
    function completePurchase(s, id, fromEarned, now, spendId) {
        const it = BY_ID[id];
        if (!it || isRepeat(it) || s.owned[id]) return false;
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
    // Looks bought with the account's Holy What Happeneds (wallets/{uid}/spends: [{ id, item }]) that this device doesn't have
    // yet. Returns the items given back. Gems, Golden and boosts are never handed out again from the log: the device that
    // bought them already did, and the log can't tell whether this device's save has them.
    function restoreFromSpends(s, spends) {
        const back = [];
        for (const sp of spends || []) {
            if (!sp || typeof sp.id !== 'string' || s.applied.includes(sp.id)) continue;
            markApplied(s, sp.id);
            const it = BY_ID[sp.item];
            if (it && !isRepeat(it) && !s.owned[sp.item]) { s.owned[sp.item] = true; back.push(it); }
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
        credit, prune, planSpend, canBuy, weekLeft, weekKey, isExchange, isRepeat, completePurchase, completeExchange, markApplied, equip, restoreFromSpends,
        checkWalletSpend, WALLET_CLIENT_KEYS, amount, plural };
}));
