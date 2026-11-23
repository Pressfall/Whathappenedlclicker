/**
 * Fusing (The Wilds, a tab of the Crucible): five Wilds relics of one tier and one kind (weapons, or armor: a helmet, chest,
 * boots or shield) go in, and either fuse into one relic a tier higher or are all lost.
 * - The chance: a base for the tier it would become, lower the higher it is (BASE), raised by what you feed in: essences
 *   (each by its rarity, core/world-relics.js PTS, worth less the higher the target), rubies (in steps, dearer the higher the
 *   target) and a Crucible Catalyst. Never past CAP: a fusion is never certain.
 * - The limits: never above the best tier your blueprints let the Crucible forge (s.relics.bp), and never into Mythic or
 *   Primordial (MAX_TARGET: those come only from a forge, under its caps). Uniques don't go in, and gear for the game never
 *   does (it stays the forge's alone, so the clicker's gear keeps its pace).
 * - What comes out: one of the five pieces' kinds (a sword, a bow, a helmet...) at the best gear tier among them, their
 *   average quality, boosts drawn from their boosts (the new tier's number of them), colours from their essences. It starts
 *   at +0, with empty sockets; essences set in the five come back to you either way (core/world-logic.js fuseRelics).
 * Pure: callers pass `rng`.
 *
 * Works in a browser (<script src="core/world-fuse.js"> after world-data.js, gear.js and world-relics.js sets window.WHWorldFuse)
 * and in Node.
 */
(function (root, factory) {
    if (typeof module === 'object' && module.exports) module.exports = factory(require('./world-data'), require('./gear'), require('./world-relics'));
    else root.WHWorldFuse = factory(root.WHWorldData, root.WHGear, root.WHWorldRelics);
}(typeof self !== 'undefined' ? self : this, function (D, Gear, Relics) {
    'use strict';

    const COUNT = 5;
    const MAX_TARGET = 4; // Legendary: Mythic and Primordial come only from a forge
    // by the tier it would become (1 Uncommon .. 4 Legendary): the chance with nothing fed in, and the most it can reach
    const BASE = [0, 0.6, 0.45, 0.3, 0.15];
    const CAP = [0, 0.95, 0.9, 0.8, 0.6];
    // feeding it. ess: each essence adds its potency (core/world-relics.js PTS: 1 common .. 40 mythic) x essPer x 2 / (target + 1),
    // up to maxEss of them. rubies: up to steps steps of +step each, a step costing stepCost x (target + 1)^2. catalyst: +this.
    const FEED = { essPer: 0.01, maxEss: 8, steps: 5, step: 0.04, stepCost: 150, catalyst: 0.15 };

    const int = (v, lo, hi) => Math.max(lo, Math.min(hi, Math.floor(Number(v) || 0)));
    const ess = (id) => { const m = D.MATERIALS_BY_ID[id]; return m && m.kind === 'essence' ? m : null; };
    // a Wilds relic's kind: 'weapon' or 'armor' (a shield counts as armor, as at the forge), or null for anything else
    function partOf(it) {
        const b = it && D.GEAR_BY_ID[it.base];
        if (!b) return null;
        if (b.slot === 'weapon') return b.cls === 'axe' || b.cls === 'pickaxe' ? null : 'weapon';
        return ['helmet', 'chest', 'boots', 'offhand'].includes(b.slot) ? 'armor' : null;
    }

    // ---------------- what may go in ----------------
    // items: the chosen gear items (from the save), bp: the best tier your blueprints allow.
    // Returns { ok, reason?, tier, target, part }: reasons 'count' (not five different pieces), 'plain' (one isn't a relic),
    // 'unique', 'kind' (weapons and armor mixed, or something that is neither), 'tier' (not all one tier), 'top' (they would
    // become Mythic or better), 'blueprint' (they would become a tier your blueprints don't reach yet)
    function check(items, bp) {
        const list = Array.isArray(items) ? items : [];
        if (list.length !== COUNT || list.some(it => !it) || new Set(list.map(it => it.uid)).size !== COUNT) return { ok: false, reason: 'count' };
        if (list.some(it => !it.r)) return { ok: false, reason: 'plain' };
        if (list.some(it => it.r.q)) return { ok: false, reason: 'unique' };
        const part = partOf(list[0]);
        if (!part || list.some(it => partOf(it) !== part)) return { ok: false, reason: 'kind' };
        const tier = list[0].r.t, target = tier + 1;
        if (list.some(it => it.r.t !== tier)) return { ok: false, reason: 'tier' };
        if (target > MAX_TARGET) return { ok: false, reason: 'top', tier, target, part };
        if (target > int(bp, 0, Gear.MAX_TIER)) return { ok: false, reason: 'blueprint', tier, target, part };
        return { ok: true, tier, target, part };
    }

    // ---------------- the chance ----------------
    // one essence's worth toward a fusion into `target`
    function essBoost(id, target) { const e = ess(id); return e ? Relics.PTS[e.rar] * FEED.essPer * 2 / (int(target, 1, MAX_TARGET) + 1) : 0; }
    // the rubies for `steps` ruby steps toward `target`
    function rubyCost(target, steps) { return int(steps, 0, FEED.steps) * FEED.stepCost * Math.pow(int(target, 1, MAX_TARGET) + 1, 2); }
    // feed: { ess: [essence ids] (the first maxEss count), steps (ruby steps), catalyst (bool) }. Returns the chance (0-1)
    function chance(target, feed) {
        const t = int(target, 1, MAX_TARGET), f = feed || {};
        let p = BASE[t];
        for (const id of (Array.isArray(f.ess) ? f.ess : []).slice(0, FEED.maxEss)) p += essBoost(id, t);
        p += int(f.steps, 0, FEED.steps) * FEED.step;
        if (f.catalyst) p += FEED.catalyst;
        return Math.round(Math.min(CAP[t], p) * 10000) / 10000;
    }
    // the roll: true when it fuses
    function roll(p, rng) { return rng() < p; }

    // ---------------- what comes out ----------------
    // A fusion that worked: { base (a GEAR id), score, lines, colors, ess } from the five pieces (check() said ok)
    function result(items, rng) {
        const target = items[0].r.t + 1;
        // its kind: a random one of the five's, at the best gear tier among them
        const pick = items[Math.floor(rng() * items.length) % items.length];
        const gearTier = Math.max(...items.map(it => D.GEAR_BY_ID[it.base].tier || 0));
        const base = Relics.baseIdFor(pick.base.replace(/_\d+$/, ''), gearTier) || pick.base;
        const score = Math.round(items.reduce((a, it) => a + (Number(it.score) || 0), 0) / items.length);
        // boosts: drawn from the five's (each one's main boost counts double), never the same twice, the new tier's number of
        // them; each one's roll halfway between the five's average for it and a fresh one
        const pts = {}, rolls = {};
        for (const it of items) it.r.l.forEach(([a, r], i) => { pts[a] = (pts[a] || 0) + (i === 0 ? 2 : 1); (rolls[a] = rolls[a] || []).push(r); });
        const fresh = () => Gear.ROLL.lo + (Gear.ROLL.hi - Gear.ROLL.lo) * rng();
        const lines = [];
        while (lines.length < Gear.TIERS[target].lines) {
            const left = Object.keys(pts).filter(a => !lines.some(l => l[0] === a));
            let a;
            if (left.length) { const tot = left.reduce((s, x) => s + pts[x], 0); let x = rng() * tot; a = left.find(k => (x -= pts[k]) < 0) || left[left.length - 1]; }
            else { const rest = Gear.ASPECT_IDS.filter(x => !lines.some(l => l[0] === x)); a = rest[Math.floor(rng() * rest.length) % rest.length]; }
            const avg = rolls[a] ? rolls[a].reduce((s, r) => s + r, 0) / rolls[a].length : fresh();
            lines.push([a, Math.round(Math.max(Gear.ROLL.lo, Math.min(Gear.ROLL.hi, (avg + fresh()) / 2)) * 1000) / 1000]);
        }
        // its essences (the rarest of the five's, as many as a forge takes) give its colours
        const m = [].concat(...items.map(it => it.r.m || [])).filter(ess).sort((a, b) => ess(b).rar - ess(a).rar).slice(0, Relics.FORGE.max);
        const colors = m.length ? Relics.colorsOf(m) : items[0].r.c.slice();
        return { base, score, lines, colors, ess: m, target };
    }

    return { COUNT, MAX_TARGET, BASE, CAP, FEED, partOf, check, essBoost, rubyCost, chance, roll, result };
}));
