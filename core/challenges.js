/**
 * Daily and weekly challenges for the game (index.html: the 📋 chip and panel are challenges-panel.js).
 *
 * - Three dailies and three weeklies, picked from POOL for the day (the player's local day) or week (the same weeks as the
 *   Wilds' weekly limits, core/world-bridge.js weekKey), seeded by the period so they don't change on a reload. Only
 *   challenges the player can do are offered (eligible): no Wilds goals before the Wilds, no prestige goals before the first.
 * - Progress is a lifetime counter now, less the same counter when the period began (base). The counters come from
 *   achievements-data.js snapshot(), so nothing in main.js has to report them. The one counter the game doesn't keep, upgrade
 *   levels bought, is kept here: observe() adds every rise of the levels owned (a prestige's drop only moves the mark).
 *   Progress stops at the target, so a jump (a cloud save arriving) finishes one challenge at most.
 * - Rewards: a daily pays boosts; finishing all three pays an Iron Chest too, and every 7th day in a row a Golden Chest.
 *   A weekly pays 1 gem and an Hourglass; all three, 2 more gems and a Golden Chest. So gems come from the weeklies only:
 *   5 a week at most. Boosts are items the bridge accepts (core/world-bridge.js ITEMS: timed boosts and saved-up time).
 * - One free reroll of a daily a day (not of one already claimed).
 * The state lives in localStorage whathappened_challenges, written only by index.html. Pure: callers pass `now` and the
 * snapshot. Works in a browser (<script src="core/challenges.js"> after core/world-bridge.js sets window.WHChallenges) and
 * in Node.
 */
(function (root, factory) {
    if (typeof module === 'object' && module.exports) module.exports = factory(require('./world-bridge'));
    else root.WHChallenges = factory(root.WHWorldBridge);
}(typeof self !== 'undefined' ? self : this, function (Bridge) {
    'use strict';

    const KEY = 'whathappened_challenges';
    const PER = 3;              // challenges a period
    const STREAK_EVERY = 7;     // every this many days in a row with all three dailies: a Golden Chest
    const BOX = { iron: 1, gold: 2 }; // items.js BOXES index
    // the counters progress is measured on: snapshot fields, plus 'levels' (kept here) and 'minutes' (from playHours)
    const STATS = ['clicks', 'levels', 'boxesOpened', 'minutes', 'casinoRounds', 'followersBred', 'prestiges', 'wildsKills', 'wildsQuests', 'wildsArenaWins'];

    const wilds = (s) => s.wildsStarted > 0;
    const prestiged = (s) => s.prestiges >= 1;
    const breeder = (s) => s.followers >= 2 || s.followersBred > 0;
    const arena = (s) => s.wildsArenaWins > 0;
    const DAILY_PAY = { items: { energyDrink: 1, spareBattery: 1 } };
    // text: {n} is the target. icon: shown in the panel.
    const POOL = [
        { id: 'd_clicks', period: 'day', icon: '👆', stat: 'clicks', target: 1500, text: 'Click the button {n} times', reward: { items: { energyDrink: 2 } } },
        { id: 'd_levels', period: 'day', icon: '📈', stat: 'levels', target: 100, text: 'Buy {n} upgrade levels', reward: { items: { spareBattery: 2 } } },
        { id: 'd_boxes', period: 'day', icon: '🎁', stat: 'boxesOpened', target: 2, text: 'Open {n} lootboxes', reward: { items: { pocketWatch: 1 } } },
        { id: 'd_play', period: 'day', icon: '⏳', stat: 'minutes', target: 20, text: 'Play for {n} minutes', reward: DAILY_PAY },
        { id: 'd_casino', period: 'day', icon: '🎰', stat: 'casinoRounds', target: 3, text: 'Play {n} rounds in the casino', reward: { items: { loadedDice: 1 } } },
        { id: 'd_breed', period: 'day', icon: '🥚', stat: 'followersBred', target: 1, text: 'Breed a follower', reward: { items: { pocketWatch: 1 } }, eligible: breeder },
        { id: 'd_kills', period: 'day', icon: '⚔️', stat: 'wildsKills', target: 25, text: 'Defeat {n} monsters in the Wilds', reward: { items: { loadedDice: 1, energyDrink: 1 } }, eligible: wilds },
        { id: 'w_clicks', period: 'week', icon: '👆', stat: 'clicks', target: 15000, text: 'Click the button {n} times' },
        { id: 'w_levels', period: 'week', icon: '📈', stat: 'levels', target: 1000, text: 'Buy {n} upgrade levels' },
        { id: 'w_boxes', period: 'week', icon: '🎁', stat: 'boxesOpened', target: 10, text: 'Open {n} lootboxes' },
        { id: 'w_play', period: 'week', icon: '⏳', stat: 'minutes', target: 180, text: 'Play for {n} minutes' },
        { id: 'w_casino', period: 'week', icon: '🎰', stat: 'casinoRounds', target: 20, text: 'Play {n} rounds in the casino' },
        { id: 'w_prestige', period: 'week', icon: '🔁', stat: 'prestiges', target: 1, text: 'Prestige once', eligible: prestiged },
        { id: 'w_breed', period: 'week', icon: '🥚', stat: 'followersBred', target: 3, text: 'Breed {n} followers', eligible: breeder },
        { id: 'w_kills', period: 'week', icon: '⚔️', stat: 'wildsKills', target: 200, text: 'Defeat {n} monsters in the Wilds', eligible: wilds },
        { id: 'w_quests', period: 'week', icon: '📜', stat: 'wildsQuests', target: 5, text: 'Finish {n} quests in the Wilds', eligible: wilds },
        { id: 'w_arena', period: 'week', icon: '🏟️', stat: 'wildsArenaWins', target: 3, text: 'Win {n} matches in the Arena', eligible: arena },
    ];
    const WEEKLY_PAY = { gems: 1, items: { hourglass: 1 } };
    const BONUS = { day: { boxes: { [BOX.iron]: 1 } }, week: { gems: 2, boxes: { [BOX.gold]: 1 } } };
    const STREAK_PAY = { boxes: { [BOX.gold]: 1 } };
    const BY_ID = Object.fromEntries(POOL.map((c) => [c.id, c]));

    const isObj = (v) => !!v && typeof v === 'object' && !Array.isArray(v);
    const int = (v, lo, hi) => { const n = Math.floor(Number(v)); return Number.isFinite(n) ? Math.max(lo, Math.min(hi, n)) : lo; };

    // ---------------- periods ----------------
    function dayKey(now) {
        const d = new Date(now);
        return d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0');
    }
    function weekKey(now) { return Bridge.weekKey(now); }
    function keyFor(period, now) { return period === 'day' ? dayKey(now) : weekKey(now); }
    // when the period ends (local midnight; the week on Monday's)
    function endsAt(period, now) {
        if (period === 'week') return Bridge.nextWeekAt(now);
        const d = new Date(now);
        return new Date(d.getFullYear(), d.getMonth(), d.getDate() + 1).getTime();
    }
    function prevDay(key) {
        const [y, m, d] = key.split('-').map(Number);
        return dayKey(new Date(y, m - 1, d - 1).getTime());
    }

    // ---------------- picking ----------------
    function hashStr(str) { let h = 2166136261 >>> 0; for (let i = 0; i < str.length; i++) { h ^= str.charCodeAt(i); h = Math.imul(h, 16777619) >>> 0; } return h >>> 0; }
    function mulberry32(seed) {
        let a = seed >>> 0;
        return function () { a = (a + 0x6D2B79F5) >>> 0; let t = a; t = Math.imul(t ^ (t >>> 15), t | 1); t ^= t + Math.imul(t ^ (t >>> 7), t | 61); return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
    }
    function eligibleFor(c, snap) { return !c.eligible || !!c.eligible(snap || {}); }
    // The period's challenges in the order they are offered: the first PER are given, the rest are what a reroll brings
    function order(period, key, snap) {
        const list = POOL.filter((c) => c.period === period && eligibleFor(c, snap));
        const rng = mulberry32(hashStr(period + ':' + key));
        for (let i = list.length - 1; i > 0; i--) { const j = Math.floor(rng() * (i + 1)); [list[i], list[j]] = [list[j], list[i]]; }
        return list.map((c) => c.id);
    }
    function pick(period, key, snap) { return order(period, key, snap).slice(0, PER); }

    // ---------------- counters ----------------
    function value(stat, snap, state) {
        if (stat === 'levels') return state && state.levels ? state.levels.total : 0;
        if (stat === 'minutes') return Math.floor((Number(snap && snap.playHours) || 0) * 60);
        return Math.max(0, Number(snap && snap[stat]) || 0);
    }
    function baseline(snap, state) { const b = {}; for (const s of STATS) b[s] = value(s, snap, state); return b; }

    // ---------------- the state ----------------
    function freshPeriod(period, key, snap, state) {
        return { key, ids: pick(period, key, snap), base: baseline(snap, state), claimed: {}, bonus: false, rerolled: false };
    }
    function fresh() {
        return { v: 1, day: null, week: null, levels: { total: 0, last: -1 }, streak: { n: 0, last: '' }, done: 0 };
    }
    function cleanPeriod(raw, period) {
        if (!isObj(raw) || typeof raw.key !== 'string' || raw.key.length > 12) return null;
        const ids = Array.isArray(raw.ids) ? raw.ids.filter((id, i, a) => BY_ID[id] && BY_ID[id].period === period && a.indexOf(id) === i).slice(0, PER) : [];
        const base = {};
        for (const s of STATS) base[s] = Math.max(0, Number(isObj(raw.base) ? raw.base[s] : 0) || 0);
        const claimed = {};
        if (isObj(raw.claimed)) for (const id of ids) if (raw.claimed[id] === true) claimed[id] = true;
        return { key: raw.key, ids, base, claimed, bonus: raw.bonus === true, rerolled: raw.rerolled === true };
    }
    function clean(raw) {
        const s = fresh();
        if (!isObj(raw)) return s;
        s.day = cleanPeriod(raw.day, 'day');
        s.week = cleanPeriod(raw.week, 'week');
        if (isObj(raw.levels)) s.levels = { total: Math.max(0, Number(raw.levels.total) || 0), last: Number.isFinite(Number(raw.levels.last)) ? Number(raw.levels.last) : -1 };
        if (isObj(raw.streak)) s.streak = { n: int(raw.streak.n, 0, 1e6), last: typeof raw.streak.last === 'string' ? raw.streak.last.slice(0, 12) : '' };
        s.done = int(raw.done, 0, 1e9);
        return s;
    }

    // Every tick (and on opening): count the levels bought since last time, and start a new day or week when one began.
    // snap.upgradeTotal: the levels of all upgrades owned now. Returns true when something changed.
    function observe(state, snap, now) {
        let changed = false;
        const lv = state.levels, total = Math.max(0, Number(snap && snap.upgradeTotal) || 0);
        if (lv.last < 0) { lv.last = total; changed = true; }
        else if (total !== lv.last) { if (total > lv.last) lv.total += total - lv.last; lv.last = total; changed = true; }
        for (const period of ['day', 'week']) {
            const key = keyFor(period, now);
            if (!state[period] || state[period].key !== key) { state[period] = freshPeriod(period, key, snap, state); changed = true; }
        }
        return changed;
    }

    // A challenge of this period as the panel shows it
    function view(state, id, period, snap) {
        const c = BY_ID[id], p = state[period];
        const got = Math.max(0, Math.min(c.target, value(c.stat, snap, state) - (p.base[c.stat] || 0)));
        return { id, period, icon: c.icon, text: c.text.replace('{n}', c.target.toLocaleString('en-US')), target: c.target, progress: Math.floor(got),
            done: got >= c.target, claimed: !!p.claimed[id], reward: rewardOf(c) };
    }
    function list(state, period, snap) { return state[period] ? state[period].ids.map((id) => view(state, id, period, snap)) : []; }
    function rewardOf(c) { return c.period === 'week' ? WEEKLY_PAY : (c.reward || DAILY_PAY); }
    // what is ready to claim, across both periods
    function claimable(state, snap) { return ['day', 'week'].reduce((n, p) => n + list(state, p, snap).filter((v) => v.done && !v.claimed).length, 0); }

    // add reward b into a: { items: {id: n}, boxes: {tier: n}, gems }
    function merge(a, b) {
        if (!b) return a;
        if (b.gems) a.gems = (a.gems || 0) + b.gems;
        for (const k of ['items', 'boxes']) if (b[k]) { a[k] = a[k] || {}; for (const id in b[k]) a[k][id] = (a[k][id] || 0) + b[k][id]; }
        return a;
    }
    // Claim a finished challenge. The third of a period also pays the period's bonus (and, for the dailies, the streak).
    // Returns { ok, reason?, reward: { items, boxes, gems }, bonus, streak }. The state is changed first: the caller saves it
    // before giving anything, so a reward can never be paid twice.
    function claim(state, id, snap, now) {
        const c = BY_ID[id];
        if (!c) return { ok: false, reason: 'unknown' };
        const p = state[c.period];
        if (!p || p.key !== keyFor(c.period, now) || !p.ids.includes(id)) return { ok: false, reason: 'gone' };
        if (p.claimed[id]) return { ok: false, reason: 'claimed' };
        if (!view(state, id, c.period, snap).done) return { ok: false, reason: 'unfinished' };
        p.claimed[id] = true;
        state.done++;
        const reward = merge({}, rewardOf(c));
        const out = { ok: true, reward, bonus: false, streak: 0 };
        if (!p.bonus && p.ids.length === PER && p.ids.every((x) => p.claimed[x])) {
            p.bonus = true;
            out.bonus = true;
            merge(reward, BONUS[c.period]);
            if (c.period === 'day') {
                const st = state.streak;
                st.n = st.last === prevDay(p.key) ? st.n + 1 : st.last === p.key ? st.n : 1;
                st.last = p.key;
                out.streak = st.n;
                if (st.n % STREAK_EVERY === 0) { merge(reward, STREAK_PAY); out.streakPaid = true; }
            }
        }
        return out;
    }
    // Swap one of today's dailies for the next on offer (once a day; not one already claimed)
    function reroll(state, id, snap, now) {
        const p = state.day;
        if (!p || p.key !== dayKey(now)) return { ok: false, reason: 'gone' };
        if (p.rerolled) return { ok: false, reason: 'used' };
        const i = p.ids.indexOf(id);
        if (i < 0) return { ok: false, reason: 'unknown' };
        if (p.claimed[id]) return { ok: false, reason: 'claimed' };
        const next = order('day', p.key, snap).find((x) => !p.ids.includes(x));
        if (!next) return { ok: false, reason: 'none' };
        p.ids[i] = next;
        p.rerolled = true;
        return { ok: true, id: next };
    }
    // The daily streak as the panel shows it: days in a row so far (0 once a day was missed), whether today counts yet, and
    // how many more days until the next Golden Chest
    function streakState(state, now) {
        const today = dayKey(now), st = state.streak;
        const alive = st.last === today || st.last === prevDay(today);
        return { n: alive ? st.n : 0, today: st.last === today, next: STREAK_EVERY - ((alive ? st.n : 0) % STREAK_EVERY) };
    }

    return { KEY, PER, STREAK_EVERY, STATS, POOL, BY_ID, WEEKLY_PAY, BONUS, STREAK_PAY, BOX, dayKey, weekKey, keyFor, endsAt, prevDay,
        order, pick, value, baseline, fresh, clean, observe, view, list, claimable, merge, claim, reroll, streakState, rewardOf };
}));
