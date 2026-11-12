'use strict';
// How long does it take a regular player to forge a first relic of each tier? Runs the real tables (core/world-data.js
// NODE_ESSENCES, core/world-dungeons.js chestRoll and boss Hearts, core/world-relics.js forge) for many simulated players
// and prints the median and the slow (75th percentile) day of each tier's first piece.
//
//   node tools/simulate-relics.js            a regular player at each stage of the game
//   node tools/simulate-relics.js --players 2000 --days 400
//
// The aim (the plan for relic gear): Common on day 1, Uncommon in a few days, Rare in about a week, Epic in 1-2 weeks,
// Legendary in 3-5 weeks, Mythic in 2-3 months, Primordial many months.
const D = require('../core/world-data');
const W = require('../core/world-logic');
const Dg = require('../core/world-dungeons');
const R = require('../core/world-relics');
const Gear = require('../core/gear');

const arg = (name, d) => { const i = process.argv.indexOf('--' + name); return i > 0 ? Number(process.argv[i + 1]) : d; };
const PLAYERS = arg('players', 600), DAYS = arg('days', 365);

// A regular player's day: about an hour in the Wilds. Mines `mined` pickaxe nodes in their zone (a third of the time on the
// crack), clears `rooms` dungeon rooms (at most the day's chests) in their zone's dungeon, and once a week beats its boss.
// Forges when they hold `batch` essences, putting the rarest in first, with an average minigame score.
const PROFILES = [
    { name: 'early (Stonepeak Mines)', zone: 'mines', mined: 50, rooms: 3, luck: 0.1, score: 60, batch: 4 },
    { name: 'mid (Frostveil)', zone: 'frost', mined: 50, rooms: 4, luck: 0.2, score: 70, batch: 5 },
    { name: 'late (Skyreach Isles)', zone: 'sky', mined: 45, rooms: 6, luck: 0.3, score: 75, batch: 6 },
];

function mulberry(seed) { let a = seed >>> 0; return () => { a = (a + 0x6D2B79F5) >>> 0; let t = a; t = Math.imul(t ^ (t >>> 15), t | 1); t ^= t + Math.imul(t ^ (t >>> 7), t | 61); return ((t ^ (t >>> 14)) >>> 0) / 4294967296; }; }

function simulate(pr, seed) {
    const rng = mulberry(seed);
    const zone = D.ZONES[pr.zone], dungeon = Dg.underZone(pr.zone);
    const pick = Object.keys(zone.nodes).filter(n => D.NODES[n].tool === 'pickaxe');
    const weights = pick.map(n => zone.nodes[n] / (D.NODES[n].respawn / 60)); // nodes that come back fast get mined more
    const totalW = weights.reduce((a, b) => a + b, 0);
    const bag = [];
    let pity = 0, catalysts = 0;
    const first = Array(7).fill(null);
    for (let day = 1; day <= DAYS; day++) {
        for (let i = 0; i < pr.mined; i++) {
            let x = rng() * totalW, k = 0;
            while (k < pick.length - 1 && x >= weights[k]) { x -= weights[k]; k++; }
            for (const id in W.nodeEssences(pick[k], rng, pr.luck, rng() < 0.33)) bag.push(id);
        }
        for (let room = 1; room <= Math.min(pr.rooms, Dg.REWARDS.essRoomsPerDay); room++) for (const [id, n] of Object.entries(Dg.chestRoll(dungeon, 1 + ((room - 1) % 3), rng, pr.luck, 1))) for (let j = 0; j < n; j++) bag.push(id);
        if (day % 7 === 0) { bag.push(D.DUNGEONS[dungeon].heart); if (rng() < Dg.REWARDS.boss.catalyst) catalysts++; }
        bag.sort((a, b) => D.MATERIALS_BY_ID[b].rar - D.MATERIALS_BY_ID[a].rar);
        while (bag.length >= pr.batch) {
            const ess = bag.splice(0, Math.min(R.FORGE.max, bag.length >= 2 * pr.batch ? R.FORGE.max : pr.batch));
            const cat = catalysts > 0 && ess.some(id => D.MATERIALS_BY_ID[id].rar >= 3);
            if (cat) catalysts--;
            const score = Math.max(0, Math.min(100, pr.score + (rng() - 0.5) * 40));
            const res = R.forge({ kind: 'game', ess, score, luck: pr.luck, catalyst: cat, pity }, rng);
            pity = res.tier >= 4 ? 0 : pity + 1;
            for (let t = 0; t <= res.tier; t++) if (first[t] === null) first[t] = day;
        }
    }
    return first;
}

const pct = (list, p) => { const xs = list.filter(x => x !== null).sort((a, b) => a - b); const i = Math.floor(p * list.length); return i < xs.length ? xs[i] : '>' + DAYS; };
console.log(`${PLAYERS} players each, ${DAYS} days. First piece of each tier: median day (slow players: 75th percentile)\n`);
for (const pr of PROFILES) {
    const runs = Array.from({ length: PLAYERS }, (_, i) => simulate(pr, 1000 + i * 7919));
    console.log(pr.name);
    for (let t = 0; t < 7; t++) {
        const days = runs.map(r => r[t]);
        console.log('  ' + Gear.TIERS[t].name.padEnd(11), String(pct(days, 0.5)).padStart(6), ' (' + pct(days, 0.75) + ')');
    }
    console.log('');
}
