/**
 * Renown: one rank for the whole game, made of what you did in the clicker AND in the Wilds. Both pages work it out the
 * same way from the same stored progress (achievements-data.js snapshot(), which reads both saves), so both show the same
 * number and neither has to write anything for the other.
 *
 * - Points come from lifetime progress only (prestige never lowers them). Every source has a cap and most grow slower and
 *   slower, so one game alone tops out around Renown 70; the last ranks need both.
 * - Each level gives a small passive boost in both places: CPS and click power in the clicker (main.js multiplier stack),
 *   rubies from monsters, bosses and veins in the Wilds (core/world-logic.js playerStats).
 * - Every 5 levels is a milestone with two halves. The Wilds half (rubies and potions) is claimed in the Wilds and noted in
 *   its save (renown.claimed); the clicker half (consumables from core/world-bridge.js ITEMS only: timed boosts and saved-up
 *   time, never gems, Golden or lootboxes) is claimed in the clicker and noted in localStorage CLAIMED_KEY, which only
 *   main.js (renown-panel.js on index.html) writes. One writer per key, like the rest of the bridge.
 *
 * Works in a browser (<script src="core/renown.js"> sets window.WHRenown) and in Node (require).
 */
(function (root, factory) {
    if (typeof module === 'object' && module.exports) module.exports = factory();
    else root.WHRenown = factory();
}(typeof self !== 'undefined' ? self : this, function () {
    'use strict';

    const CLAIMED_KEY = 'whathappened_renown';
    const MAX_LEVEL = 100;
    // points for level L: STEP x L^2 (Renown 10 = 10 points, 50 = 250, 70 = 490, 100 = 1,000)
    const STEP = 0.1;
    // the passive boost per level, in percent
    const PER_LEVEL = { cps: 1, click: 1, rubies: 0.5 };

    const n0 = (v) => { const n = Number(v); return Number.isFinite(n) && n > 0 ? n : 0; };
    const log2 = (v) => Math.log2(1 + n0(v));
    const log10 = (v) => Math.log10(1 + n0(v));
    // Where points come from. pts(snapshot) is capped at cap. hint: how to get more, for the panel.
    const SOURCES = [
        // the clicker
        { id: 'prestiges', game: 'clicker', label: 'Prestiges', cap: 160, pts: s => 40 * log2(s.prestiges), have: s => n0(s.prestiges), hint: 'Prestige in the game' },
        { id: 'golden', game: 'clicker', label: 'Golden What Happened earned', cap: 100, pts: s => 20 * log10(s.goldenEver), have: s => n0(s.goldenEver), hint: 'Earn Golden by prestiging' },
        { id: 'clicks', game: 'clicker', label: 'Clicks, all time', cap: 70, pts: s => 10 * log10(s.clicks), have: s => n0(s.clicks), hint: 'Click the What Happened image' },
        { id: 'upgrades', game: 'clicker', label: 'Upgrades ever bought', cap: 58, pts: s => 2 * n0(s.upgradesEver), have: s => n0(s.upgradesEver), hint: 'Buy every kind of upgrade at least once' },
        { id: 'divine', game: 'clicker', label: 'Divine upgrade levels', cap: 60, pts: s => 3 * n0(s.divineTotal), have: s => n0(s.divineTotal), hint: 'Spend Golden in the Divine menu' },
        { id: 'followers', game: 'clicker', label: 'Kinds of follower found', cap: 54, pts: s => 0.75 * n0(s.followersSeen), have: s => n0(s.followersSeen), hint: 'Open follower packs and breed new kinds' },
        // the Wilds
        { id: 'zones', game: 'wilds', label: 'Wild zones opened', cap: 120, pts: s => 15 * wildZones(s), have: s => wildZones(s), hint: 'Beat a zone\'s boss to open the next one' },
        { id: 'bosses', game: 'wilds', label: 'Great bosses beaten', cap: 120, pts: s => 15 * n0(s.wildsBosses), have: s => n0(s.wildsBosses), hint: 'Beat each zone\'s boss once' },
        { id: 'gods', game: 'wilds', label: 'Statue levels in the Hall of Gods', cap: 90, pts: s => 3 * n0(s.wildsGodLevels), have: s => n0(s.wildsGodLevels), hint: 'Raise the statues in the Hall of Gods' },
        { id: 'quests', game: 'wilds', label: 'Quests handed in', cap: 80, pts: s => 20 * log2(s.wildsQuests), have: s => n0(s.wildsQuests), hint: 'Take quests from the people of Wildgate' },
        { id: 'classes', game: 'wilds', label: 'Classes unlocked', cap: 40, pts: s => 8 * n0(s.wildsClasses), have: s => n0(s.wildsClasses), hint: 'Unlock a new class (Skills, K)' },
        { id: 'gear', game: 'wilds', label: 'Best gear tier owned', cap: 45, pts: s => 5 * n0(s.wildsTopTier), have: s => n0(s.wildsTopTier), hint: 'Craft gear from a further zone\'s metal' },
        { id: 'arena', game: 'wilds', label: 'Arena wins and best wave', cap: 30, pts: s => 8 * log2(n0(s.wildsArenaWins) + n0(s.wildsTeamWins)) + n0(s.wildsWaveBest), have: s => n0(s.wildsArenaWins) + n0(s.wildsTeamWins), hint: 'Win arena matches, hold out in the Proving Grounds' },
    ];
    // the snapshot's wildsZones counts the town too
    function wildZones(s) { return Math.max(0, n0(s.wildsZones) - 1); }

    // { total, clicker, wilds, parts: [{ id, game, label, pts, cap, have, hint }] }
    function points(snap) {
        const s = snap || {};
        const parts = SOURCES.map(src => {
            let p = 0;
            try { p = Math.max(0, Math.min(src.cap, src.pts(s) || 0)); } catch (e) { p = 0; }
            return { id: src.id, game: src.game, label: src.label, pts: p, cap: src.cap, have: src.have(s), hint: src.hint };
        });
        const sum = (g) => parts.filter(p => !g || p.game === g).reduce((a, p) => a + p.pts, 0);
        return { total: sum(), clicker: sum('clicker'), wilds: sum('wilds'), parts };
    }
    function pointsFor(level) { return STEP * level * level; }
    function levelFor(total) { return Math.max(0, Math.min(MAX_LEVEL, Math.floor(Math.sqrt(n0(total) / STEP) + 1e-9))); }
    // Everything the panels show: level, how far into it, and the points behind it
    function rank(snap) {
        const p = points(snap), level = levelFor(p.total);
        const at = pointsFor(level), next = level >= MAX_LEVEL ? at : pointsFor(level + 1);
        return Object.assign(p, { level, at, next, frac: level >= MAX_LEVEL ? 1 : (p.total - at) / (next - at) });
    }
    // The passive boost at a level, in percent: { cps, click, rubies }
    function bonus(level) {
        const l = Math.max(0, Math.min(MAX_LEVEL, Math.floor(n0(level))));
        return { cps: PER_LEVEL.cps * l, click: PER_LEVEL.click * l, rubies: PER_LEVEL.rubies * l };
    }

    // ---------------- milestones ----------------
    // clicker: items.js consumables (core/world-bridge.js ITEMS only). wilds: rubies and potions for the Wilds.
    const CLICKER_HALF = {
        5: { energyDrink: 2, spareBattery: 2 }, 10: { pocketWatch: 2 }, 15: { loadedDice: 2 }, 20: { overclockChip: 2 },
        25: { hourglass: 1 }, 30: { frenzyPotion: 2 }, 35: { overclockChip: 3 }, 40: { hourglass: 2 }, 45: { frenzyPotion: 3 },
        50: { timeMachine: 1 }, 55: { loadedDice: 4 }, 60: { hourglass: 3 }, 65: { overclockChip: 4 }, 70: { timeMachine: 1 },
        75: { singularity: 1 }, 80: { frenzyPotion: 4 }, 85: { hourglass: 4 }, 90: { timeMachine: 2 }, 95: { singularity: 2 }, 100: { singularity: 3 },
    };
    const MILESTONES = [];
    for (let level = 5; level <= MAX_LEVEL; level += 5) {
        const cons = level % 10 ? null : level >= 50 ? { potion_max: 1, potion_big: 2 } : { potion_big: 2 };
        MILESTONES.push({ level, wilds: cons ? { rubies: 100 * level, cons } : { rubies: 100 * level }, clicker: { items: CLICKER_HALF[level] } });
    }
    const MILESTONE_BY_LEVEL = Object.fromEntries(MILESTONES.map(m => [m.level, m]));
    // a stored list of claimed milestone levels -> sorted, real milestones only, each once
    function cleanClaimed(raw) {
        const list = Array.isArray(raw) ? raw : (raw && Array.isArray(raw.claimed) ? raw.claimed : []);
        return [...new Set(list.map(Number).filter(l => Object.prototype.hasOwnProperty.call(MILESTONE_BY_LEVEL, l)))].sort((a, b) => a - b);
    }
    // milestones reached and not yet claimed (on one side), oldest first
    function claimable(level, claimed) {
        const have = new Set(cleanClaimed(claimed));
        return MILESTONES.filter(m => m.level <= level && !have.has(m.level));
    }
    // the next milestone after a level, or null at the top
    function nextMilestone(level) { return MILESTONES.find(m => m.level > level) || null; }

    return { CLAIMED_KEY, MAX_LEVEL, STEP, PER_LEVEL, SOURCES, MILESTONES, MILESTONE_BY_LEVEL,
        points, pointsFor, levelFor, rank, bonus, cleanClaimed, claimable, nextMilestone };
}));
