/**
 * The Proving Grounds (The Wilds): co-op waves of monsters, harder with every player who joins. One page runs a wave (the
 * host: the lowest id in the room, taking over when it goes quiet, like a shared boss) and shares where its monsters are
 * and what they do; the others replay that against their own player. Every page can build every wave's monsters on its
 * own: composition(seed, wave, players) gives the same list (types, ids, gates, spawn times, toughness) everywhere, so only
 * positions, attacks and damage travel. Rewards are rubies and Glory per wave cleared (never gems or Golden).
 * Pure: callers pass `now` (ms, server time).
 *
 * Works in a browser (<script src="core/world-waves.js"> sets window.WHWorldWaves, after world-data.js) and in Node.
 */
(function (root, factory) {
    if (typeof module === 'object' && module.exports) module.exports = factory(require('./world-data'));
    else root.WHWorldWaves = factory(root.WHWorldData);
}(typeof self !== 'undefined' ? self : this, function (D) {
    'use strict';

    // per extra player: this much more of everything
    const SCALE = { count: 0.5, hp: 0.3, dmg: 0.1 };
    // a wave: base + (its place in its five) monsters, more every five; every 5th wave adds elites, every 10th a champion
    const WAVES = { perTier: 5, base: 4, eliteEvery: 5, championEvery: 10, championHp: 3, hpRamp: 0.08, dmgRamp: 0.04, batch: 6, batchSec: 3, maxAlive: 24 };
    // hostHz / flushSec while a wave is fought; idleHostHz / idleFlushSec between waves (the snapshot then only says the host
    // is still there). touchSec: how often the host refreshes the run's time during a long fight, so it never looks idle.
    const RATE = { hostHz: 10, idleHostHz: 2, flushSec: 0.1, idleFlushSec: 0.25, hostQuietMs: 1500, touchSec: 15, readySec: 5, breakSec: 8, idleResetSec: 60, overResetSec: 10, maxPlayers: 8, maxSnap: 1000 };
    const MILESTONES = [10, 20, 30, 40];
    const STATES = ['ready', 'fight', 'break', 'over'];
    const MID_RE = /^w\d{1,3}_\d{1,3}$/;
    const isObj = (v) => !!v && typeof v === 'object' && !Array.isArray(v);
    const num = (v, lo, hi, d = 0) => { const n = Number(v); return Number.isFinite(n) ? Math.max(lo, Math.min(hi, n)) : d; };

    function hashStr(str) { let h = 2166136261 >>> 0; for (let i = 0; i < str.length; i++) { h ^= str.charCodeAt(i); h = Math.imul(h, 16777619) >>> 0; } return h >>> 0; }
    function mulberry32(seed) {
        let a = seed >>> 0;
        return function () { a = (a + 0x6D2B79F5) >>> 0; let t = a; t = Math.imul(t ^ (t >>> 15), t | 1); t ^= t + Math.imul(t ^ (t >>> 7), t | 61); return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
    }
    // which zone's monsters a wave brings: five waves of each, Greenwood first, the Skyreach Isles last (and after)
    function tierFor(wave) { return Math.max(1, Math.min(D.ZONE_ORDER.length, Math.ceil(wave / WAVES.perTier))); }
    function zoneFor(wave) { return D.ZONE_ORDER[tierFor(wave) - 1]; }
    // The monsters of a wave, the same on every page: [{ mid, type, elite, champion, gate, delay (s after the wave starts),
    // hpMult, dmgMult }]. players: how many are in the room when it starts (1-8).
    function composition(seed, wave, players) {
        const n = Math.max(1, Math.min(RATE.maxPlayers, Math.floor(players) || 1));
        const rng = mulberry32(hashStr(seed + ':' + wave + ':' + n));
        const z = D.ZONES[zoneFor(wave)], k = (wave - 1) % WAVES.perTier;
        const total = z.spawns.reduce((a, s) => a + s[1], 0);
        const pick = () => { let x = rng() * total; for (const [id, w] of z.spawns) { x -= w; if (x < 0) return id; } return z.spawns[0][0]; };
        const extra = n - 1;
        const hp = (1 + WAVES.hpRamp * k) * (1 + SCALE.hp * extra), dmg = (1 + WAVES.dmgRamp * k) * (1 + SCALE.dmg * extra);
        const out = [];
        const add = (type, flags = {}) => out.push(Object.assign({ type, elite: !!D.MONSTERS[type].elite, champion: false, hpMult: hp, dmgMult: dmg }, flags));
        const count = Math.round((WAVES.base + k + Math.floor(wave / WAVES.perTier)) * (1 + SCALE.count * extra));
        for (let i = 0; i < count; i++) add(pick());
        if (wave % WAVES.eliteEvery === 0) for (let i = 0; i < 1 + Math.floor(extra / 2); i++) add(z.elite);
        if (wave % WAVES.championEvery === 0) add(z.elite, { champion: true, hpMult: hp * WAVES.championHp });
        out.forEach((m, i) => { m.mid = 'w' + wave + '_' + i; m.gate = Math.floor(rng() * 6); m.delay = Math.floor(i / WAVES.batch) * WAVES.batchSec + rng() * 0.8; });
        return out;
    }
    // where a run starts: always wave 1, however far anyone in the room got before (there are no checkpoints)
    function startWave() { return 1; }
    // What clearing a wave pays (the Glory still goes through the day's cap): { rubies, glory, milestone }
    function rewardFor(wave, firstTime) {
        const tier = tierFor(wave);
        const milestone = firstTime && MILESTONES.includes(wave) ? wave : 0;
        return { rubies: Math.round(10 * tier * (1 + wave / 10)) + (milestone ? 100 * wave : 0), glory: 2 + tier, bonusGlory: milestone ? 5 * wave / 2 : 0, milestone };
    }

    // ---------------- the shared run (w) ----------------
    // { gen, seed, start, wave, st, n, at, t, m: { mid: damage taken }, f, x: { id: { from, mid, st, t } }, h: { u, n, s } }
    function sanitizeRun(raw) {
        if (!isObj(raw) || typeof raw.gen !== 'string' || !raw.gen || raw.gen.length > 24) return null;
        const m = {};
        if (isObj(raw.m)) for (const k in raw.m) if (MID_RE.test(k)) m[k] = num(raw.m[k], 0, 1e7);
        const x = [];
        if (isObj(raw.x)) for (const k in raw.x) { const e = raw.x[k]; if (isObj(e) && MID_RE.test(String(e.mid || ''))) x.push({ id: k, from: String(e.from || ''), mid: e.mid, st: num(e.st, 0, 3), t: num(e.t, 0, 1e15) }); }
        const h = isObj(raw.h) && typeof raw.h.u === 'string' ? { u: raw.h.u, n: num(raw.h.n, 0, 1e9), s: typeof raw.h.s === 'string' ? raw.h.s.slice(0, RATE.maxSnap) : '' } : null;
        return { gen: raw.gen, seed: num(raw.seed, 0, 1e9), start: Math.floor(num(raw.start, 1, 999, 1)), wave: Math.floor(num(raw.wave, 0, 999)), st: STATES.includes(raw.st) ? raw.st : 'over',
            n: Math.floor(num(raw.n, 1, RATE.maxPlayers, 1)), at: num(raw.at, 0, 1e15), t: num(raw.t, 0, 1e15), m, x, h };
    }
    // a run nobody is playing (over a while ago, or untouched for a minute) may be replaced by a new one
    function runNeedsReset(run, now) {
        if (!run) return true;
        if (run.st === 'over') return now - run.t > RATE.overResetSec * 1000;
        return now - run.t > RATE.idleResetSec * 1000;
    }
    // The host's snapshot: per live monster mid,x,y,facing x10,attack seq,attack index,aim x,aim y; ';' between them
    function packSnap(list) {
        const out = [];
        let len = 0;
        for (const m of list) {
            const s = [m.mid, Math.round(m.x), Math.round(m.y), Math.round((m.fa || 0) * 10), m.as | 0, m.ai | 0, Math.round(m.tx || 0), Math.round(m.ty || 0)].join(',');
            if (len + s.length + 1 > RATE.maxSnap) break;
            out.push(s); len += s.length + 1;
        }
        return out.join(';');
    }
    function unpackSnap(str) {
        const out = new Map();
        if (typeof str !== 'string' || !str) return out;
        for (const part of str.slice(0, RATE.maxSnap).split(';')) {
            const f = part.split(',');
            if (f.length !== 8 || !MID_RE.test(f[0])) continue;
            const n = f.slice(1).map(Number);
            if (n.some(v => !Number.isFinite(v))) continue;
            out.set(f[0], { mid: f[0], x: num(n[0], 0, 1e5), y: num(n[1], 0, 1e5), fa: num(n[2] / 10, -7, 7), as: Math.floor(num(n[3], 0, 1e6)), ai: Math.floor(num(n[4], 0, 9)), tx: num(n[5], 0, 1e5), ty: num(n[6], 0, 1e5) });
        }
        return out;
    }
    // the player who runs the waves: the lowest id in the room (every page works out the same one)
    function hostOf(uids) { return uids.filter(Boolean).sort()[0] || null; }
    // Who runs the waves, as seen from page me: down the list from the lowest id, the first that is me, or that has sent a
    // snapshot within hostQuietMs (quietMs: { uid: ms since its last snapshot }; none yet counts as quiet). A page that went
    // quiet (a menu open, a hidden tab) is passed over, and so is the next if it is quiet too, so the wave always has someone
    // running it; once a lower page is back, it runs it again.
    function hostAmong(uids, me, quietMs) {
        const list = uids.filter(Boolean).sort(), q = quietMs || {};
        for (const u of list) if (u === me || (q[u] !== undefined && q[u] <= RATE.hostQuietMs)) return u;
        return list[0] || null;
    }
    // how often the host shares its snapshot and every page sends its damage, for a run in state st
    const hostRate = (st) => (st === 'fight' ? RATE.hostHz : RATE.idleHostHz);
    const flushRate = (st) => (st === 'fight' ? RATE.flushSec : RATE.idleFlushSec);
    // Which of a page's wave monsters (their mids) no longer belong: all of them when no wave is being fought (it was cleared,
    // lost or the run is over), else those of another wave or room (ids are 'w<wave>_<i>' for waves and dungeon rooms alike).
    // A page that does not run the wave only learns of the last kills through this: the host clears the wave and changes the
    // run's state in the same step, before any snapshot without those monsters.
    function staleMids(run, mids) {
        if (!run || run.st !== 'fight') return mids.slice();
        const pre = 'w' + run.wave + '_';
        return mids.filter(mid => String(mid).indexOf(pre) !== 0);
    }

    return { SCALE, WAVES, RATE, MILESTONES, STATES, tierFor, zoneFor, composition, startWave, rewardFor, sanitizeRun, runNeedsReset, packSnap, unpackSnap, hostOf,
        hostAmong, hostRate, flushRate, staleMids };
}));
