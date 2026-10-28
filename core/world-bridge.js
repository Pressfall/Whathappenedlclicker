/**
 * Rewards from the Wilds (world.html) to the main game (index.html): gems, Golden What Happened and lootboxes.
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

    const count = (v, max) => Math.max(0, Math.min(max, Math.floor(Number(v) || 0)));
    function readJSON(store, key) { try { return JSON.parse(store.getItem(key) || 'null'); } catch (e) { return null; } }

    // A reward entry with every amount a whole number within LIMITS, or null when it has no valid sequence number
    function clampEntry(e) {
        if (!e || typeof e !== 'object') return null;
        const seq = Math.floor(Number(e.seq));
        if (!Number.isFinite(seq) || seq < 1) return null;
        const boxes = BOX_NAMES.map((_, i) => count(Array.isArray(e.boxes) ? e.boxes[i] : 0, LIMITS.box));
        return { seq, gems: count(e.gems, LIMITS.gems), golden: count(e.golden, LIMITS.golden), boxes, src: typeof e.src === 'string' ? e.src.slice(0, 40) : '', at: Number(e.at) || 0 };
    }
    function isEmpty(r) { return !r || (!r.gems && !r.golden && !(r.boxes || []).some(n => n > 0)); }

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
        const totals = { gems: 0, golden: 0, boxes: BOX_NAMES.map(() => 0) };
        let lastSeq = ack;
        for (const e of entries) {
            totals.gems += e.gems; totals.golden += e.golden;
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
        if (isEmpty(r)) return null;
        const src = typeof (reward && reward.src) === 'string' ? reward.src.slice(0, 40) : '';
        if (!Array.isArray(state.outbox)) state.outbox = [];
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

    return { WORLD_KEY, ACK_KEY, BOX_NAMES, LIMITS, MAX_OUTBOX, clampEntry, isEmpty, readAck, writeAck, pending, push, prune, describe };
}));
