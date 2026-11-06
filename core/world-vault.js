/**
 * The Sunken Vault (The Wilds): a dungeon for a party of 2 to 4. Every party gets its own copy (online it lives under the
 * zone key vault_<party id>, world-online.js), three rooms of monsters and then the Drowned King.
 * - A room seals when its fight starts and opens the way on when it is cleared. Its monsters come in batches; every page
 *   builds the same ones from roomComposition(seed, room, players), and the fight is run like the Proving Grounds' waves
 *   (world-waves.js: one page runs the monsters, the others follow its snapshot, damage is added up for everyone).
 * - The run (the instance's w node, same shape as the waves' run): wave = the room being fought or the last one cleared;
 *   st 'ready' (counting down to room `wave`), 'fight' (room `wave`), 'break' (rooms up to `wave` cleared), 'over' (the
 *   Drowned King is down). A wipe (everyone down) puts it back to 'break' at the room before, so only that room is fought
 *   again. A run nobody touches for 30 minutes starts over.
 * - The Drowned King: the zone's shared boss (world-online.js), his health scaled by the players in the fight (bossHp).
 * - Rewards (core/world-logic.js vaultRoomCleared / vaultKingLoot): rubies for each room (up to roomPaysPerDay rooms a
 *   day), and the King's first kill of the week pays rubies, Glory, Vault Seals and a Golden Chest for the game. Room
 *   monsters drop nothing, like the waves, so the Vault is no way around the zones' materials.
 * Pure: callers pass `now` (ms) and a seed.
 *
 * Works in a browser (<script src="core/world-vault.js"> after world-data.js sets window.WHWorldVault) and in Node.
 */
(function (root, factory) {
    if (typeof module === 'object' && module.exports) module.exports = factory(require('./world-data'));
    else root.WHWorldVault = factory(root.WHWorldData);
}(typeof self !== 'undefined' ? self : this, function (D) {
    'use strict';

    const ZONE = 'vault';
    const BOSS = 'drowned_king';
    const PARTY = { min: 2, max: 4 };
    // per extra player: this much more of everything (rooms), and of the King's health
    const SCALE = { count: 0.4, hp: 0.35, dmg: 0.08, bossHp: 0.6 };
    const RUN = { readySec: 6, idleResetMs: 30 * 60 * 1000, batch: 5, batchSec: 4, maxAlive: 18 };
    // the rooms, in order: which zones' monsters, how many, their elites and toughness
    const ROOMS = [
        { id: 'hall', name: 'The Flooded Hall', zones: ['coast', 'storm'], count: 9, elites: 1, hp: 1.0 },
        { id: 'gallery', name: 'The Broken Gallery', zones: ['ruins'], count: 10, elites: 2, hp: 1.1 },
        { id: 'breach', name: 'The Sky Breach', zones: ['sky'], count: 10, elites: 1, champion: true, hp: 1.15 },
    ];
    const KING_ROOM = ROOMS.length + 1; // 4: the King's chamber
    // what it pays. rooms: rubies per room cleared (x the room's number), up to roomPaysPerDay rooms a day.
    // king: the first kill of a (Wilds) week; later kills that week pay kingRepeat rubies.
    const REWARDS = {
        room: 400, roomPaysPerDay: 9,
        king: { rubies: 6000, glory: 300, seals: 3, box: 2 }, // box: a Golden Chest (core/world-data.js BOX_NAMES index)
        kingRepeat: 800,
    };
    const MID_RE = /^w[1-3]_\d{1,3}$/;

    function hashStr(str) { let h = 2166136261 >>> 0; for (let i = 0; i < str.length; i++) { h ^= str.charCodeAt(i); h = Math.imul(h, 16777619) >>> 0; } return h >>> 0; }
    function mulberry32(seed) {
        let a = seed >>> 0;
        return function () { a = (a + 0x6D2B79F5) >>> 0; let t = a; t = Math.imul(t ^ (t >>> 15), t | 1); t ^= t + Math.imul(t ^ (t >>> 7), t | 61); return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
    }
    const players = (n) => Math.max(1, Math.min(PARTY.max, Math.floor(n) || 1));

    // The monsters of room `room` (1-3), the same on every page: [{ mid, type, elite, champion, gate, delay, hpMult, dmgMult }]
    function roomComposition(seed, room, n) {
        const def = ROOMS[room - 1];
        if (!def) return [];
        const k = players(n), extra = k - 1;
        const rng = mulberry32(hashStr(seed + ':vault:' + room + ':' + k));
        const pool = [];
        for (const z of def.zones) for (const [id, w] of D.ZONES[z].spawns) pool.push([id, w]);
        const total = pool.reduce((a, s) => a + s[1], 0);
        const pick = () => { let x = rng() * total; for (const [id, w] of pool) { x -= w; if (x < 0) return id; } return pool[0][0]; };
        const hp = def.hp * (1 + SCALE.hp * extra), dmg = 1 + SCALE.dmg * extra;
        const out = [];
        const add = (type, flags = {}) => out.push(Object.assign({ type, elite: !!D.MONSTERS[type].elite, champion: false, hpMult: hp, dmgMult: dmg }, flags));
        const count = Math.round(def.count * (1 + SCALE.count * extra));
        for (let i = 0; i < count; i++) add(pick());
        const eliteOf = () => D.ZONES[def.zones[Math.floor(rng() * def.zones.length)]].elite;
        for (let i = 0; i < def.elites + Math.floor(extra / 2); i++) add(eliteOf());
        if (def.champion) add(eliteOf(), { champion: true, hpMult: hp * 2.5 });
        out.forEach((m, i) => { m.mid = 'w' + room + '_' + i; m.gate = Math.floor(rng() * 4); m.delay = Math.floor(i / RUN.batch) * RUN.batchSec + rng() * 0.8; });
        return out;
    }
    // the King's health for the players in the fight
    function bossHp(base, n) { return Math.round(base * (1 + SCALE.bossHp * (players(n) - 1))); }

    // ---------------- the run ----------------
    // rooms cleared so far (0-3), and whether the King is down
    function cleared(run) {
        if (!run) return 0;
        if (run.st === 'break' || run.st === 'over') return Math.max(0, Math.min(ROOMS.length, run.wave));
        return Math.max(0, Math.min(ROOMS.length, run.wave - 1));
    }
    // Is door i open (the way into room i; i = KING_ROOM is the King's chamber)? Into a room being fought: no (it seals).
    function doorOpen(run, i) {
        if (i <= 1 && (!run || run.st !== 'fight')) return true;
        if (run && run.st === 'fight' && run.wave === i) return false;
        return cleared(run) >= i - 1;
    }
    // the room a run can start next (1-3), or 0 when every room is cleared (the King's turn) or a room is going
    function nextRoom(run) {
        if (!run || run.st === 'break') { const c = cleared(run); return c < ROOMS.length ? c + 1 : 0; }
        return 0;
    }
    function kingOpen(run) { return !!run && cleared(run) >= ROOMS.length && run.st !== 'over'; }
    // a run nobody has touched for a while starts over (the doors close again)
    function runNeedsReset(run, now) { return !run || now - (run.t || 0) > RUN.idleResetMs; }
    // A fresh run, nothing cleared yet
    function newRun(now, rnd = Math.random) {
        return { gen: Math.floor(rnd() * 36 ** 8).toString(36).padStart(8, '0'), seed: Math.floor(rnd() * 1e9), start: 1, wave: 0, st: 'break', n: 1, at: now, t: now };
    }
    // Everyone in the room is down: back to before this room (rooms already cleared stay so)
    function wiped(run) { return { st: 'break', wave: Math.max(0, run.wave - 1) }; }

    // ---------------- who may come in ----------------
    // party: the members holding a ticket (core/world-party.js tickets), reached: whether this player has reached the Far
    // Reaches. Returns { ok, reason? }: 'party' (not in a party), 'size' (more than PARTY.max), 'reach'
    function mayEnter(partySize, reached) {
        if (!reached) return { ok: false, reason: 'reach' };
        if (!partySize || partySize < PARTY.min) return { ok: false, reason: 'party' };
        if (partySize > PARTY.max) return { ok: false, reason: 'size' };
        return { ok: true };
    }
    // the instance's key in the database: one copy per party (database.rules.json: vault_ and the party id)
    function instanceKey(pid) { return /^[A-Za-z0-9]{8,12}$/.test(String(pid || '')) ? ZONE + '_' + pid : null; }

    return { ZONE, BOSS, PARTY, SCALE, RUN, ROOMS, KING_ROOM, REWARDS, MID_RE, roomComposition, bossHp, cleared, doorOpen, nextRoom, kingOpen,
        runNeedsReset, newRun, wiped, mayEnter, instanceKey };
}));
