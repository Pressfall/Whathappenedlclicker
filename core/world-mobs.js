/**
 * Shared monsters (The Wilds): the same monsters for everyone in a zone, for very little database traffic.
 *
 * What is shared, and how little of it travels:
 *  - Which monster stands where is not sent at all. Every page builds the zone's monsters from the zone's own seed, and a
 *    monster's kind comes from a hash of (zone, spawn point, generation), so every page makes the same ones.
 *  - A kill is one small number (k/<id>: the server time it fell). Everyone's copy falls and comes back on that clock.
 *  - Only the monsters being fought are sent (m/<uid>): who is running each one's AI (the player who woke it, the lowest id
 *    when two did), where it is, which attack it just started, and how much damage this player has dealt it. A few numbers
 *    a monster, a few times a second, and nothing at all while nobody fights or when you are alone.
 *  - Damage adds up across players, like a shared boss: a monster's health is its maximum less everyone's damage.
 * Pure: callers pass `now` (ms, server time).
 *
 * Works in a browser (<script src="core/world-mobs.js"> sets window.WHWorldMobs, after world-data.js) and in Node.
 */
(function (root, factory) {
    if (typeof module === 'object' && module.exports) module.exports = factory(require('./world-data'));
    else root.WHWorldMobs = factory(root.WHWorldData);
}(typeof self !== 'undefined' ? self : this, function (D) {
    'use strict';

    // sendHz: how often a page reports the monsters it is fighting (and only while it is fighting, with someone else there);
    // freshMs: how long a report counts after it arrives; engagedSec: how long a monster I stopped fighting stays reported;
    // maxItems/maxChars: bounds on one report (the database rules allow maxChars); extrapolateSec: how far a follower carries a
    // monster on at its last speed between reports
    const RATE = { sendHz: 3, freshMs: 2500, engagedSec: 8, maxItems: 6, maxChars: 320, extrapolateSec: 0.6, staleKillMult: 3 };
    const SID_RE = /^[se]\d{1,3}(_\d)?$/;
    const UID_RE = /^[A-Za-z0-9]{6,40}$/;
    const num = (v, lo, hi, d = 0) => { const n = Number(v); return Number.isFinite(n) ? Math.max(lo, Math.min(hi, n)) : d; };

    function hashStr(str) { let h = 2166136261 >>> 0; for (let i = 0; i < str.length; i++) { h ^= str.charCodeAt(i); h = Math.imul(h, 16777619) >>> 0; } return h >>> 0; }
    // 0..1, always the same for the same text
    function unit(str) { let h = hashStr(str); h ^= h >>> 15; h = Math.imul(h, 2246822519) >>> 0; h ^= h >>> 13; return (h >>> 0) / 4294967296; }

    // a monster's id in the zone: the spawn point and which of its pack (s12_1), or an elite's spawn point (e3)
    function sid(spawn, member, elite) { return elite ? 'e' + spawn : 's' + spawn + '_' + (member || 0); }
    function validSid(s) { return SID_RE.test(String(s)); }

    // The kind of monster a spawn point makes at a generation (the server time of the kill that came before it, 0 for the first):
    // the zone's own weights, the same answer on every page
    function pickType(zoneId, spawn, gen) {
        const list = D.ZONES[zoneId].spawns, total = list.reduce((a, [, w]) => a + w, 0);
        let x = unit(zoneId + ':' + spawn + ':' + Math.floor(gen || 0)) * total;
        for (const [id, w] of list) { x -= w; if (x < 0) return id; }
        return list[0][0];
    }
    // seconds a fallen monster is gone
    function respawnSec(elite) { return elite ? D.ELITE_RESPAWN_SEC : D.MONSTER_RESPAWN_SEC; }
    // a kill record still counts while the monster is meant to be dead; older ones only say what generation it is on
    function killFresh(t, now, elite) { return Number.isFinite(t) && now - t < respawnSec(elite) * 1000; }
    // a kill record worth deleting: nobody needs it any more
    function killStale(t, now) { return !Number.isFinite(t) || now - t > RATE.staleKillMult * D.ELITE_RESPAWN_SEC * 1000; }
    function sanitizeKill(v) { const n = Number(v); return Number.isFinite(n) && n > 0 && n < 1e15 ? n : 0; }

    // ---------------- one page's report ----------------
    // item: { sid, d (1: this page runs it), x, y, fa (facing), as (attack number), ai (which attack), tx, ty (where it aims), dmg }
    const r1 = (v) => Math.round(v);
    function pack(n, items) {
        const out = [];
        let len = String(n).length + 1;
        for (const it of (items || []).slice(0, RATE.maxItems)) {
            const s = it.d ? [it.sid, 1, r1(it.x), r1(it.y), r1(it.fa * 100), it.as | 0, it.ai | 0, r1(it.tx || 0), r1(it.ty || 0), r1(it.dmg || 0)].join(',') : [it.sid, 0, 0, 0, 0, 0, 0, 0, 0, r1(it.dmg || 0)].join(',');
            if (len + s.length + 1 > RATE.maxChars) break;
            out.push(s); len += s.length + 1;
        }
        return n + '|' + out.join(';');
    }
    // -> { n, items: Map(sid -> item) } or null
    function unpack(str) {
        if (typeof str !== 'string' || str.length > RATE.maxChars) return null;
        const bar = str.indexOf('|');
        if (bar < 1) return null;
        const items = new Map();
        for (const part of str.slice(bar + 1).split(';')) {
            const f = part.split(',');
            if (f.length !== 10 || !validSid(f[0]) || items.size >= RATE.maxItems) continue;
            const d = f[1] === '1' ? 1 : 0;
            items.set(f[0], { sid: f[0], d, x: num(f[2], 0, 1e5), y: num(f[3], 0, 1e5), fa: num(f[4], -700, 700) / 100, as: num(f[5], 0, 1e9), ai: num(f[6], 0, 20),
                tx: num(f[7], 0, 1e5), ty: num(f[8], 0, 1e5), dmg: num(f[9], 0, 1e8) });
        }
        return { n: num(str.slice(0, bar), 0, 1e12), items };
    }

    // ---------------- reading everyone's reports ----------------
    // peers: [{ uid, items: Map, fresh (bool) }] (other players), mine: whether this page runs the monster right now, myUid.
    // -> { driver: uid of whoever runs the monster (me, a peer, or null), others: damage dealt by the other players }
    function standing(sidKey, peers, mine, myUid) {
        let driver = mine ? myUid : null, others = 0;
        for (const p of peers) {
            if (!p.fresh) continue;
            const it = p.items.get(sidKey);
            if (!it) continue;
            others += it.dmg;
            if (it.d && (driver === null || p.uid < driver)) driver = p.uid;
        }
        return { driver, others };
    }
    // a monster's health once everyone's damage is counted; mine is what this page dealt (already in `hp`)
    function pooledHp(hp, maxHp, mine, others) { return Math.min(hp, maxHp - mine - others); }

    return { RATE, sid, validSid, pickType, respawnSec, killFresh, killStale, sanitizeKill, pack, unpack, standing, pooledHp, UID_RE, unit };
}));
