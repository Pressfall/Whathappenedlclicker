/**
 * The hidden dungeons (The Wilds): one under each zone (core/world-data.js DUNGEONS), its way in hidden off the roads until
 * that zone's boss has fallen to you (world-gen.js placeEntrance). Alone, or with a party of up to 4: every party gets its
 * own copy online (the zone key <dungeon>_<party id>, world-online.js); alone or offline the page runs it by itself.
 * - Three rooms, then the dungeon's boss. A room seals when its fight starts and opens the way on when it is cleared. Its
 *   monsters come in batches; every page builds the same ones from roomComposition(dungeon, seed, room, players), and the
 *   fight is run like the Proving Grounds' waves (world-waves.js: one page runs the monsters, the others follow its
 *   snapshot, damage is added up for everyone).
 * - The run (the instance's w node, same shape as the waves' run): wave = the room being fought or the last one cleared;
 *   st 'ready' (counting down to room `wave`), 'fight' (room `wave`), 'break' (rooms up to `wave` cleared), 'over' (the boss
 *   is down). A wipe (everyone down) puts it back to 'break' at the room before, so only that room is fought again. A run
 *   nobody touches for 30 minutes starts over.
 * - The boss: the zone's shared boss (world-online.js), its health scaled by the players in the fight (bossHp).
 * - The rest (2026-11-22, was: the boss's big reward once a week): once a dungeon's boss falls to you, that dungeon rests for
 *   COOLDOWN_MS (30 minutes, each dungeon on its own clock); then you can run it again. A boss beaten while its dungeon is
 *   resting for you (a party member who stayed down) pays nothing.
 * - Rewards (core/world-logic.js dungeonRoomCleared / dungeonBossLoot): rubies for each room (up to roomPaysPerDay rooms a
 *   day, all dungeons together) and a chest of essences, up to essRoomsPerDay chests a day (chestRoll). The boss's first kill
 *   each week is the boosted one: its Heart, rubies, a good chance of a Catalyst and a big boss chest. Every later kill opens
 *   a small boss chest (one of the day's chests: rooms and bosses share them), with rubies and a small chance of the Heart
 *   and a Catalyst; once the day's chests are gone, only a few rubies, as before. The Sunken Vault's Drowned King also pays Glory, Vault
 *   Seals and a Golden Chest for the game, on his weekly first kill only (they sit under the Glory and lootbox limits).
 *   Room monsters drop nothing, so a dungeon is no way around the zones' own materials.
 * Pure: callers pass `now` (ms), a seed and an rng.
 *
 * Works in a browser (<script src="core/world-dungeons.js"> after world-data.js sets window.WHWorldDungeons) and in Node.
 */
(function (root, factory) {
    if (typeof module === 'object' && module.exports) module.exports = factory(require('./world-data'));
    else root.WHWorldDungeons = factory(root.WHWorldData);
}(typeof self !== 'undefined' ? self : this, function (D) {
    'use strict';

    const IDS = Object.keys(D.DUNGEONS);
    const PARTY = { min: 1, max: 4 };
    // per extra player: this much more of everything (rooms), of the boss's health, and of the chests' rarer essences
    const SCALE = { count: 0.4, hp: 0.35, dmg: 0.08, bossHp: 0.6, luck: 0.1 };
    const RUN = { readySec: 6, idleResetMs: 30 * 60 * 1000, batch: 5, batchSec: 4, maxAlive: 18 };
    const ROOM_COUNT = 3;
    const KING_ROOM = ROOM_COUNT + 1; // 4: the boss's chamber
    // what they pay. room: rubies per room cleared, x the room's number (the Vault: vaultRoom), up to roomPaysPerDay rooms a day.
    // essRoomsPerDay: the day's chests of essences, all dungeons together, opened by rooms and by later boss kills alike.
    // boss: the first kill of a (Wilds) week, boosted: the Heart, rubies x the zone's tier, a Catalyst at `catalyst` and a big
    // boss chest (bossChest: two essences; once a week per dungeon, outside the day's chests). Later kills (each after the
    // dungeon's rest), while the day's chests last: `repeat` x tier rubies, a small boss chest (one essence), the Heart at
    // `heart` and a Catalyst at `repeatCatalyst`; once they are gone, `capped` x tier rubies and sometimes (`cappedEssence`) a
    // common essence, as before. vaultKing: the Drowned King's weekly extras; kingRepeat / kingCapped: his later kills'
    // rubies, with / past the day's chests.
    // (Kept inside the day's chests on purpose: tools/simulate-relics.js shows every essence a day speeding up the Crucible's
    // rare relics, the clicker's gear among them.)
    const COOLDOWN_MS = 30 * 60 * 1000;
    const REWARDS = {
        room: 60, vaultRoom: 400, roomPaysPerDay: 9, essRoomsPerDay: 6,
        boss: { rubies: 500, catalyst: 0.35, repeat: 150, heart: 0.03, repeatCatalyst: 0.02, capped: 80, cappedEssence: 0.15 },
        vaultKing: { rubies: 6000, glory: 300, seals: 3, box: 2 }, // box: a Golden Chest (core/world-data.js BOX_NAMES index)
        kingRepeat: 1200, kingCapped: 800,
    };
    const MID_RE = /^w[1-3]_\d{1,3}$/;
    const ID_RE = new RegExp('^(' + IDS.join('|') + ')$');

    function hashStr(str) { let h = 2166136261 >>> 0; for (let i = 0; i < str.length; i++) { h ^= str.charCodeAt(i); h = Math.imul(h, 16777619) >>> 0; } return h >>> 0; }
    function mulberry32(seed) {
        let a = seed >>> 0;
        return function () { a = (a + 0x6D2B79F5) >>> 0; let t = a; t = Math.imul(t ^ (t >>> 15), t | 1); t ^= t + Math.imul(t ^ (t >>> 7), t | 61); return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
    }
    const players = (n) => Math.max(1, Math.min(PARTY.max, Math.floor(n) || 1));
    const def = (id) => D.DUNGEONS[id] || null;
    // the dungeon under a wild zone (or null)
    function underZone(zone) { return IDS.find(id => D.DUNGEONS[id].zone === zone) || null; }
    // the zone's tier the dungeon is under (1-8)
    const tierOf = (id) => (def(id) ? D.ZONES[def(id).zone].tier : 1);

    // The monsters of room `room` (1-3) of a dungeon, the same on every page: [{ mid, type, elite, champion, gate, delay, hpMult, dmgMult }]
    function roomComposition(id, seed, room, n) {
        const dd = def(id), rd = dd && dd.rooms[room - 1];
        if (!rd) return [];
        const k = players(n), extra = k - 1;
        // the Vault keeps its old seed string, so a run started before this update builds the same monsters
        const rng = mulberry32(hashStr(seed + ':' + (id === 'vault' ? 'vault' : 'dungeon:' + id) + ':' + room + ':' + k));
        const pool = [];
        for (const z of rd.zones) for (const [mid, w] of D.ZONES[z].spawns) pool.push([mid, w]);
        const total = pool.reduce((a, s) => a + s[1], 0);
        const pick = () => { let x = rng() * total; for (const [mid, w] of pool) { x -= w; if (x < 0) return mid; } return pool[0][0]; };
        const hp = rd.hp * (1 + SCALE.hp * extra), dmg = 1 + SCALE.dmg * extra;
        const out = [];
        const add = (type, flags = {}) => out.push(Object.assign({ type, elite: !!D.MONSTERS[type].elite, champion: false, hpMult: hp, dmgMult: dmg }, flags));
        const count = Math.round(rd.count * (1 + SCALE.count * extra));
        for (let i = 0; i < count; i++) add(pick());
        const eliteOf = () => D.ZONES[rd.zones[Math.floor(rng() * rd.zones.length)]].elite;
        for (let i = 0; i < (rd.elites || 0) + (rd.elites ? Math.floor(extra / 2) : 0); i++) add(eliteOf());
        if (rd.champion) add(eliteOf(), { champion: true, hpMult: hp * 2.5 });
        out.forEach((m, i) => { m.mid = 'w' + room + '_' + i; m.gate = Math.floor(rng() * 4); m.delay = Math.floor(i / RUN.batch) * RUN.batchSec + rng() * 0.8; });
        return out;
    }
    // the boss's health for the players in the fight
    function bossHp(base, n) { return Math.round(base * (1 + SCALE.bossHp * (players(n) - 1))); }

    // ---------------- the run ----------------
    // rooms cleared so far (0-3)
    function cleared(run) {
        if (!run) return 0;
        if (run.st === 'break' || run.st === 'over') return Math.max(0, Math.min(ROOM_COUNT, run.wave));
        return Math.max(0, Math.min(ROOM_COUNT, run.wave - 1));
    }
    // Is door i open (the way into room i; i = KING_ROOM is the boss's chamber)? Into a room being fought: no (it seals).
    function doorOpen(run, i) {
        if (i <= 1 && (!run || run.st !== 'fight')) return true;
        if (run && run.st === 'fight' && run.wave === i) return false;
        return cleared(run) >= i - 1;
    }
    // the room a run can start next (1-3), or 0 when every room is cleared (the boss's turn) or a room is going
    function nextRoom(run) {
        if (!run || run.st === 'break') { const c = cleared(run); return c < ROOM_COUNT ? c + 1 : 0; }
        return 0;
    }
    function kingOpen(run) { return !!run && cleared(run) >= ROOM_COUNT && run.st !== 'over'; }
    // a run nobody has touched for a while starts over (the doors close again)
    function runNeedsReset(run, now) { return !run || now - (run.t || 0) > RUN.idleResetMs; }
    // A fresh run, nothing cleared yet
    function newRun(now, rnd = Math.random) {
        return { gen: Math.floor(rnd() * 36 ** 8).toString(36).padStart(8, '0'), seed: Math.floor(rnd() * 1e9), start: 1, wave: 0, st: 'break', n: 1, at: now, t: now };
    }
    // Everyone in the room is down: back to before this room (rooms already cleared stay so)
    function wiped(run) { return { st: 'break', wave: Math.max(0, run.wave - 1) }; }

    // ---------------- a run kept through a reload (alone: a party's run is in the database) ----------------
    // A browser can reload a tab on its own (to free memory, or after the page stopped). The run is saved as it stands
    // between rooms: rooms cleared stay cleared, and a room being fought (or about to start) starts again from its ready
    // circle, as after a wipe. A run whose boss is down is not kept (the next one starts fresh anyway).
    function checkpoint(id, run) {
        if (!D.DUNGEONS[id] || !run || run.st === 'over') return null;
        const wave = run.st === 'fight' || run.st === 'ready' ? run.wave - 1 : run.wave;
        return cleanCheckpoint({ id, gen: run.gen, seed: run.seed, wave, t: run.t });
    }
    function cleanCheckpoint(raw) {
        if (!raw || typeof raw !== 'object' || !D.DUNGEONS[raw.id]) return null;
        const wave = Math.floor(Number(raw.wave)), seed = Math.floor(Number(raw.seed)), t = Number(raw.t);
        if (!(wave >= 0 && wave <= ROOM_COUNT) || !(seed >= 0 && seed < 1e10) || !(t > 0) || !/^[a-z0-9]{1,12}$/.test(String(raw.gen))) return null;
        return { id: raw.id, gen: String(raw.gen), seed, wave, t };
    }
    // The run to carry on with in dungeon id, or null (another dungeon's, or left alone so long it would have started over)
    function resumeRun(cp, id, now) {
        cp = cleanCheckpoint(cp);
        if (!cp || cp.id !== id || now - cp.t > RUN.idleResetMs || cp.t - now > 60000) return null;
        return { gen: cp.gen, seed: cp.seed, start: 1, wave: cp.wave, st: 'break', n: 1, at: now, t: now };
    }

    // ---------------- the rest between runs ----------------
    // How long (ms) until a dungeon can be run again, its boss having last fallen to this player at `at` (ms; 0: never):
    // 0 when it can. A kill stamped in the future (the clock was turned back) still rests no longer than COOLDOWN_MS.
    function restLeft(at, now) {
        const t = Number(at) || 0;
        if (!(t > 0)) return 0;
        return Math.max(0, Math.min(COOLDOWN_MS, t + COOLDOWN_MS - now));
    }
    // the rest left in whole minutes, rounded up (for the words on screen): 1 for anything under a minute
    const restMinutes = (ms) => Math.max(1, Math.ceil(ms / 60000));

    // ---------------- who may come in ----------------
    // partySize: the party members going in (0 or 1: alone), open: whether this player has beaten the zone's boss,
    // rest: what restLeft says for this player in this dungeon (ms).
    // Returns { ok, reason?, rest? }: 'locked' (the zone's boss isn't beaten yet), 'resting' (its boss fell to you less than
    // COOLDOWN_MS ago), 'size' (more than PARTY.max)
    function mayEnter(partySize, open, rest) {
        if (!open) return { ok: false, reason: 'locked' };
        if (rest > 0) return { ok: false, reason: 'resting', rest };
        if ((partySize || 0) > PARTY.max) return { ok: false, reason: 'size' };
        return { ok: true };
    }
    // the instance's key in the database: one copy per party (database.rules.json: the dungeon's id, _ and the party id)
    function instanceKey(id, pid) { return ID_RE.test(String(id)) && /^[A-Za-z0-9]{8,12}$/.test(String(pid || '')) ? id + '_' + pid : null; }

    // ---------------- the chests ----------------
    // How likely each essence rarity is in a dungeon's room chest (weights, common .. mythic): deeper dungeons and later rooms
    // give rarer ones; luck and every extra player in the party raise the rarer ones' share (never the mythic one's past x1.5)
    function rarityWeights(id, room, luck, n) {
        const t = tierOf(id) + (Math.max(1, Math.min(ROOM_COUNT, room)) - 1) * 0.5;
        const boost = (1 + Math.max(0, Math.min(1, luck || 0))) * (1 + SCALE.luck * (players(n) - 1));
        return [Math.max(10, 70 - 7 * t), (22 + 2 * t) * boost, (3 + 1.6 * t) * boost, (0.3 + 0.22 * t) * boost, (0.01 + 0.006 * t) * Math.min(1.5, boost)];
    }
    const BY_RARITY = [0, 1, 2, 3, 4].map(r => D.ESSENCES.filter(e => e[3] === r && !IDS.some(id => D.DUNGEONS[id].essence === e[0] || D.DUNGEONS[id].heart === e[0])).map(e => e[0]));
    // A room's chest: { essence id: n }. One essence (two from the third room; count: as many as asked), each a rarity from
    // rarityWeights and then one of that rarity at random; and a chance (higher in later rooms) of the dungeon's own rare essence.
    function chestRoll(id, room, rng, luck, n, count) {
        const dd = def(id), out = {};
        if (!dd) return out;
        const w = rarityWeights(id, room, luck, n), total = w.reduce((a, b) => a + b, 0);
        const add = (e) => { out[e] = (out[e] || 0) + 1; };
        for (let i = 0; i < (count || (room >= ROOM_COUNT ? 2 : 1)); i++) {
            let x = rng() * total, r = 0;
            while (r < w.length - 1 && x >= w[r]) { x -= w[r]; r++; }
            const list = BY_RARITY[r];
            add(list[Math.floor(rng() * list.length) % list.length]);
        }
        if (rng() < 0.06 + 0.05 * room) add(dd.essence);
        return out;
    }
    // A boss chest, at the third room's odds with a chance of the dungeon's own essence: big (the week's boosted kill) holds
    // two essences like the third room's chest, small (a later kill) one
    function bossChest(id, rng, luck, n, big) { return chestRoll(id, ROOM_COUNT, rng, luck, n, big ? 2 : 1); }

    return { IDS, PARTY, SCALE, RUN, ROOM_COUNT, KING_ROOM, REWARDS, COOLDOWN_MS, MID_RE, ID_RE, def, underZone, tierOf, roomComposition, bossHp, cleared, doorOpen,
        nextRoom, kingOpen, runNeedsReset, newRun, wiped, checkpoint, cleanCheckpoint, resumeRun, restLeft, restMinutes, mayEnter, instanceKey, rarityWeights, chestRoll,
        bossChest, BY_RARITY };
}));
