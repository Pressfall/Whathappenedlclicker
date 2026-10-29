/**
 * Rewards from the Wilds (world.html) to the main game (index.html): gems, Golden What Happened and lootboxes; and the
 * other way, rubies from the game to the Wilds (Golden traded in the Divine menu, rubies codes; see the inbox below).
 *
 * The main game's autosave rewrites the whole main save from memory, so the world page never touches it. Instead each
 * key has exactly one writer and neither page can overwrite the other:
 * - world.html writes `whathappened_world`, whose `outbox` lists rewards, each with a sequence number that only grows;
 * - main.js writes `whathappened_world_ack`: the sequence number of the last reward it has applied.
 * The game applies every outbox entry above the ack, saves, then moves the ack. The world drops entries at or below the
 * ack the next time it saves. Works in a browser (<script src="core/world-bridge.js"> sets window.WHWorldBridge) and
 * in Node (require).
 */
(function (root, factory) {
    if (typeof module === 'object' && module.exports) module.exports = factory();
    else root.WHWorldBridge = factory();
}(typeof self !== 'undefined' ? self : this, function () {
    'use strict';

    const WORLD_KEY = 'whathappened_world';
    const ACK_KEY = 'whathappened_world_ack';
    // items.js BOXES, by tier
    const BOX_NAMES = ['Wooden Crate', 'Iron Chest', 'Golden Chest', 'Diamond Chest', 'Mythic Vault'];
    // the most one entry may carry (the world's own caps are far lower; this only bounds a damaged or edited save)
    const LIMITS = { gems: 50, golden: 3, box: 20 };
    const MAX_OUTBOX = 300;
    // Things bought in the Wilds that are partly paid in the game: an outbox entry { buy: id } says one was bought there (its
    // rubies and materials already paid); main.js takes these gems and Golden and adds the item, as soon as you have them.
    const BUYS = { autoClicker: { name: 'The Auto Clicker', item: 'autoClicker', gems: 5000, golden: 500 } };
    const isBuy = (id) => typeof id === 'string' && Object.prototype.hasOwnProperty.call(BUYS, id);

    const count = (v, max) => Math.max(0, Math.min(max, Math.floor(Number(v) || 0)));
    function readJSON(store, key) { try { return JSON.parse(store.getItem(key) || 'null'); } catch (e) { return null; } }

    // A reward entry with every amount a whole number within LIMITS, or null when it has no valid sequence number
    function clampEntry(e) {
        if (!e || typeof e !== 'object') return null;
        const seq = Math.floor(Number(e.seq));
        if (!Number.isFinite(seq) || seq < 1) return null;
        const boxes = BOX_NAMES.map((_, i) => count(Array.isArray(e.boxes) ? e.boxes[i] : 0, LIMITS.box));
        const out = { seq, gems: count(e.gems, LIMITS.gems), golden: count(e.golden, LIMITS.golden), boxes, src: typeof e.src === 'string' ? e.src.slice(0, 40) : '', at: Number(e.at) || 0 };
        if (isBuy(e.buy)) out.buy = e.buy;
        return out;
    }
    function isEmpty(r) { return !r || (!r.buy && !r.gems && !r.golden && !(r.boxes || []).some(n => n > 0)); }

    function readAck(store) { try { return count(store.getItem(ACK_KEY), Number.MAX_SAFE_INTEGER); } catch (e) { return 0; } }
    function writeAck(store, seq) {
        try { store.setItem(ACK_KEY, String(count(seq, Number.MAX_SAFE_INTEGER))); return true; } catch (e) { return false; }
    }

    // What the game still has to apply: entries above the ack, oldest first, and their totals.
    // minAck: the highest sequence number this page already applied (in case writing the ack failed)
    function pending(store, minAck) {
        const ack = Math.max(readAck(store), count(minAck, Number.MAX_SAFE_INTEGER));
        const w = readJSON(store, WORLD_KEY);
        const list = (w && Array.isArray(w.outbox)) ? w.outbox : [];
        const entries = list.map(clampEntry).filter(e => e && e.seq > ack).sort((a, b) => a.seq - b.seq);
        const totals = { gems: 0, golden: 0, boxes: BOX_NAMES.map(() => 0), buys: [] };
        let lastSeq = ack;
        for (const e of entries) {
            totals.gems += e.gems; totals.golden += e.golden;
            if (e.buy) totals.buys.push(e.buy);
            e.boxes.forEach((n, i) => { totals.boxes[i] += n; });
            lastSeq = Math.max(lastSeq, e.seq);
        }
        return { entries, totals, lastSeq, ack };
    }

    const BIG = Number.MAX_SAFE_INTEGER;
    function amounts(r) {
        return { gems: count(r.gems, BIG), golden: count(r.golden, BIG), boxes: BOX_NAMES.map((_, i) => count(Array.isArray(r.boxes) ? r.boxes[i] : 0, BIG)) };
    }

    // World side: queue a reward. Mutates state (outSeq, outbox, overflow). A reward bigger than one entry may carry is
    // split over several, so nothing is cut off. Entries are never merged: merging one the game may already have
    // applied would pay it twice. Returns the first new entry, or null when nothing was queued.
    function push(state, reward, ack, now) {
        const r = amounts(reward || {});
        const src = typeof (reward && reward.src) === 'string' ? reward.src.slice(0, 40) : '';
        if (!Array.isArray(state.outbox)) state.outbox = [];
        if (reward && isBuy(reward.buy)) {
            // a purchase is its own entry, never held back: the outbox only fills up when the game hasn't been opened in ages
            const seq = Math.max(count(state.outSeq, BIG), count(ack, BIG)) + 1;
            state.outSeq = seq;
            const e = { seq, gems: 0, golden: 0, boxes: BOX_NAMES.map(() => 0), buy: reward.buy, src, at: Number(now) || 0 };
            state.outbox.push(e);
            return e;
        }
        if (isEmpty(r)) return null;
        let first = null;
        while (!isEmpty(r)) {
            if (state.outbox.length >= MAX_OUTBOX) {
                // the game hasn't been opened in a long time: hold the rest until there is room
                const o = state.overflow || (state.overflow = { gems: 0, golden: 0, boxes: BOX_NAMES.map(() => 0) });
                o.gems += r.gems; o.golden += r.golden;
                r.boxes.forEach((n, i) => { o.boxes[i] = (o.boxes[i] || 0) + n; });
                break;
            }
            const part = { gems: Math.min(r.gems, LIMITS.gems), golden: Math.min(r.golden, LIMITS.golden), boxes: r.boxes.map(n => Math.min(n, LIMITS.box)) };
            r.gems -= part.gems; r.golden -= part.golden;
            r.boxes = r.boxes.map((n, i) => n - part.boxes[i]);
            const seq = Math.max(count(state.outSeq, BIG), count(ack, BIG)) + 1;
            state.outSeq = seq;
            const e = { seq, gems: part.gems, golden: part.golden, boxes: part.boxes, src, at: Number(now) || 0 };
            state.outbox.push(e);
            if (!first) first = e;
        }
        return first;
    }

    // World side, on every save: forget what the game has applied, and move held-back rewards in once there is room
    function prune(state, ack, now) {
        const a = count(ack, BIG);
        state.outbox = (Array.isArray(state.outbox) ? state.outbox : []).map(clampEntry).filter(e => e && e.seq > a);
        if (!(count(state.outSeq, BIG) >= a)) state.outSeq = a;
        const o = state.overflow;
        if (o && state.outbox.length < MAX_OUTBOX) {
            state.overflow = null;
            push(state, Object.assign({}, o, { src: 'held' }), a, now); // holds back again whatever still doesn't fit
        }
        return state;
    }

    // The game's gems and Golden as last saved (the Wilds only reads them, to show what you can afford)
    function mainBalance(store) {
        const s = readJSON(store, 'whathappened_save');
        return { gems: count(s && s.diamonds, BIG), golden: Math.max(0, Number(s && s.goldenWhat) || 0) };
    }

    // ---------------- the other way: rubies from the game to the Wilds ----------------
    // main.js is the only writer of INBOX_KEY: { seq, entries: [{ seq, rubies, src, at }] }. The world applies every entry
    // above its own `inAck`, which it keeps in its save, and the game forgets entries at or below that ack the next time it
    // writes. Entries are never merged, for the same reason as the outbox.
    const INBOX_KEY = 'whathappened_world_inbox';
    // rubies for one Golden What Happened. The Trader sells a Golden for 6,000 rubies, so going round never pays.
    const GOLDEN_RUBIES = 250;
    const MAX_RUBIES = 10000000; // the most one entry carries; more is split over several
    const MAX_INBOX = 200;

    function clampInEntry(e) {
        if (!e || typeof e !== 'object') return null;
        const seq = Math.floor(Number(e.seq)), rubies = count(e.rubies, MAX_RUBIES);
        if (!Number.isFinite(seq) || seq < 1 || !rubies) return null;
        return { seq, rubies, src: typeof e.src === 'string' ? e.src.slice(0, 40) : '', at: Number(e.at) || 0 };
    }
    function readInbox(store) {
        const raw = readJSON(store, INBOX_KEY);
        const entries = (raw && Array.isArray(raw.entries) ? raw.entries : []).map(clampInEntry).filter(Boolean);
        return { seq: Math.max(count(raw && raw.seq, BIG), 0, ...entries.map(e => e.seq)), entries };
    }
    // the last inbox entry the world has applied and saved
    function readInAck(store) { const w = readJSON(store, WORLD_KEY); return count(w && w.inAck, BIG); }

    // Game side: queue rubies for the Wilds. Returns the first new entry, or null when nothing was queued (nothing to send,
    // too much already waiting, or storage refused the write); then nothing at all was queued.
    function sendRubies(store, rubies, src, now) {
        let left = count(rubies, BIG);
        if (!left) return null;
        const ack = readInAck(store), box = readInbox(store);
        const entries = box.entries.filter(e => e.seq > ack);
        let seq = Math.max(box.seq, ack), first = null;
        while (left > 0) {
            if (entries.length >= MAX_INBOX) return null;
            const e = { seq: ++seq, rubies: Math.min(left, MAX_RUBIES), src: typeof src === 'string' ? src.slice(0, 40) : '', at: Number(now) || 0 };
            left -= e.rubies;
            entries.push(e);
            if (!first) first = e;
        }
        try { store.setItem(INBOX_KEY, JSON.stringify({ seq, entries })); } catch (err) { return null; }
        return first;
    }
    // World side: what is waiting above its ack, oldest first, with the total and the last sequence number
    function inbox(store, inAck) {
        const ack = count(inAck, BIG);
        const entries = readInbox(store).entries.filter(e => e.seq > ack).sort((a, b) => a.seq - b.seq);
        return { entries, rubies: entries.reduce((n, e) => n + e.rubies, 0), lastSeq: entries.length ? entries[entries.length - 1].seq : ack };
    }
    // Game side: rubies sent that the Wilds hasn't collected yet
    function rubiesWaiting(store) { return inbox(store, readInAck(store)).rubies; }

    // At most GOLDEN_TRADE_WEEKLY Golden What Happeneds can be traded for rubies each week (local time, weeks start on
    // Monday). main.js is the only writer of GOLDEN_TRADES_KEY: { week: '2026-W44', n: Golden traded that week }.
    const GOLDEN_TRADES_KEY = 'whathappened_golden_trades';
    const GOLDEN_TRADE_WEEKLY = 4;
    function weekKey(now) {
        const d = new Date(now);
        const t = new Date(Date.UTC(d.getFullYear(), d.getMonth(), d.getDate()));
        const dow = t.getUTCDay() || 7;
        t.setUTCDate(t.getUTCDate() + 4 - dow); // the Thursday of this week decides its year
        const year = t.getUTCFullYear();
        const week = Math.ceil(((t - Date.UTC(year, 0, 1)) / 86400000 + 1) / 7);
        return year + '-W' + String(week).padStart(2, '0');
    }
    function goldenTradedThisWeek(store, now) {
        let v = null;
        try { v = JSON.parse(store.getItem(GOLDEN_TRADES_KEY) || 'null'); } catch (e) { v = null; }
        if (!v || typeof v !== 'object' || v.week !== weekKey(now)) return 0;
        return Math.max(0, Math.min(GOLDEN_TRADE_WEEKLY, Math.floor(Number(v.n) || 0)));
    }
    function goldenTradeLeft(store, now) { return GOLDEN_TRADE_WEEKLY - goldenTradedThisWeek(store, now); }
    // Count n more traded this week. Returns false when it can't be stored (then nothing should be traded).
    function noteGoldenTrade(store, n, now) {
        try { store.setItem(GOLDEN_TRADES_KEY, JSON.stringify({ week: weekKey(now), n: goldenTradedThisWeek(store, now) + n })); return true; } catch (e) { return false; }
    }
    // Undo a counted trade that didn't go through
    function unnoteGoldenTrade(store, n, now) {
        try { store.setItem(GOLDEN_TRADES_KEY, JSON.stringify({ week: weekKey(now), n: Math.max(0, goldenTradedThisWeek(store, now) - n) })); } catch (e) {}
    }
    // When the next week starts (local midnight on Monday), as a timestamp
    function nextWeekAt(now) {
        const d = new Date(now);
        const t = new Date(d.getFullYear(), d.getMonth(), d.getDate());
        t.setDate(t.getDate() + (8 - (t.getDay() || 7)));
        return t.getTime();
    }

    function plural(n, one, many) { return n + ' ' + (n === 1 ? one : (many || one + 's')); }
    // "From the Wilds: +3 gems, +1 Golden What Happened and 2 Iron Chests"
    function describe(t) {
        const parts = [];
        if (t.gems) parts.push('+' + plural(t.gems, 'gem'));
        if (t.golden) parts.push('+' + t.golden + ' Golden What Happened');
        (t.boxes || []).forEach((n, i) => { if (n) parts.push(plural(n, BOX_NAMES[i])); });
        if (!parts.length) return '';
        const last = parts.pop();
        return 'From the Wilds: ' + (parts.length ? parts.join(', ') + ' and ' + last : last);
    }

    return { WORLD_KEY, ACK_KEY, BOX_NAMES, LIMITS, MAX_OUTBOX, BUYS, clampEntry, isEmpty, readAck, writeAck, pending, push, prune, describe, mainBalance,
        INBOX_KEY, GOLDEN_RUBIES, MAX_RUBIES, MAX_INBOX, clampInEntry, readInAck, sendRubies, inbox, rubiesWaiting,
        GOLDEN_TRADES_KEY, GOLDEN_TRADE_WEEKLY, weekKey, goldenTradeLeft, noteGoldenTrade, unnoteGoldenTrade, nextWeekAt };
}));
