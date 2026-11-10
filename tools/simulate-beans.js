#!/usr/bin/env node
/**
 * How many Holy What Happeneds 👼 a free player earns, month by month, against what the Holy What Happeneds shop costs.
 * Run: node tools/simulate-beans.js      (re-run after changing EARN or CATALOG in core/premium.js)
 *
 * Uses the real tables: EARN and CATALOG (core/premium.js), the achievements and their rarities (achievements-data.js),
 * the Wilds bosses (core/world-data.js BOSSES) and the Arena ranks (core/world-arena.js). The players are models: how
 * often each kind of player finishes the weekly challenges, keeps a daily streak, buys Holy What Happeneds with Glory, and how far
 * through each rarity of achievement they get in a year. Change the PLAYERS table to try other habits.
 */
'use strict';
const path = require('path');
const ROOT = path.resolve(__dirname, '..');
global.window = {};
global.localStorage = { getItem: () => null, setItem() {}, removeItem() {} };
require(path.join(ROOT, 'achievements-data.js'));
const ACH = global.window.WHA.ACHIEVEMENTS;
const P = require(path.join(ROOT, 'core/premium.js'));
const D = require(path.join(ROOT, 'core/world-data.js'));
const BOSSES = Object.keys(D.BOSSES);

// achievements of each rarity, and the Holy What Happeneds they are worth together
const byRarity = {};
for (const a of ACH) byRarity[a.rarity] = (byRarity[a.rarity] || 0) + 1;

// per month (1..12): weeks with all three weeklies, 7-day streaks reached, weeks with Glory bought, a season rank (or none),
// share of each rarity's achievements unlocked by month 12 (unlocked evenly over the year, front-loaded for common ones),
// bosses beaten by month 12
const PLAYERS = {
    'casual (clicker only, a few days a week)': { weekly: 1, streaks: 0, glory: 0, season: null, bosses: 0,
        ach: { common: 0.8, uncommon: 0.5, rare: 0.2, epic: 0.05, legendary: 0, mythic: 0 } },
    'regular (most days, both games)': { weekly: 3, streaks: 2, glory: 2, season: 'silver', bosses: 7,
        ach: { common: 1, uncommon: 0.8, rare: 0.6, epic: 0.35, legendary: 0.15, mythic: 0 } },
    'dedicated (every day, Arena regular)': { weekly: 4, streaks: 4, glory: 4, season: 'platinum', bosses: 9,
        ach: { common: 1, uncommon: 1, rare: 0.85, epic: 0.6, legendary: 0.4, mythic: 0.34 } },
};

const prices = P.CATALOG.map((c) => c.cost).sort((a, b) => a - b);
const catalogTotal = prices.reduce((a, b) => a + b, 0);
const median = prices[Math.floor(prices.length / 2)];

function simulate(pl) {
    const months = [];
    let total = 0;
    for (let m = 1; m <= 12; m++) {
        // achievements: front-loaded (a curve that reaches the year's share at month 12, faster at the start)
        const shareNow = (r) => pl.ach[r] * Math.sqrt(m / 12), sharePrev = (r) => pl.ach[r] * Math.sqrt((m - 1) / 12);
        let ach = 0;
        for (const r in byRarity) ach += (shareNow(r) - sharePrev(r)) * byRarity[r] * (P.EARN.achievement[r] || 0);
        const bosses = (Math.min(pl.bosses, Math.ceil(pl.bosses * m / 6)) - Math.min(pl.bosses, Math.ceil(pl.bosses * (m - 1) / 6))) * P.EARN.boss;
        const recurring = pl.weekly * P.EARN.weekly + pl.streaks * P.EARN.streak + pl.glory * P.EARN.glory + (pl.season ? P.EARN.season[pl.season] : 0);
        const month = ach + bosses + recurring;
        total += month;
        months.push({ m, ach, bosses, recurring, month, total });
    }
    return months;
}
const firstAt = (months, n) => { const x = months.find((r) => r.total >= n); return x ? 'month ' + x.m : 'over a year'; };

console.log('Holy What Happeneds shop: ' + P.CATALOG.length + ' items, ' + prices[0] + '-' + prices[prices.length - 1] + ' each (median ' + median + '), ' + catalogTotal + ' for everything.');
console.log('Achievements worth Holy What Happeneds: ' + Object.entries(byRarity).map(([r, n]) => n + ' ' + r + ' x ' + (P.EARN.achievement[r] || 0)).join(', ')
    + ' = ' + Object.entries(byRarity).reduce((a, [r, n]) => a + n * (P.EARN.achievement[r] || 0), 0) + ' Holy What Happeneds in all, once.');
console.log('Bosses: ' + BOSSES.length + ' x ' + P.EARN.boss + '. Recurring: weekly bonus ' + P.EARN.weekly + ', 7-day streak ' + P.EARN.streak
    + ', Glory ' + P.EARN.glory + '/week, season ' + Object.values(P.EARN.season).join('/') + '. First-visit catch-up capped at ' + P.EARN.retroCap + '.');
console.log('');
for (const [name, pl] of Object.entries(PLAYERS)) {
    const ms = simulate(pl);
    const r = (i) => Math.round(ms[i].month);
    console.log(name);
    console.log('  earned in month 1: ' + r(0) + ', month 3: ' + r(2) + ', month 6: ' + r(5) + ', month 12: ' + r(11)
        + ' (recurring part ' + Math.round(ms[11].recurring) + '/month)');
    console.log('  after a year: ' + Math.round(ms[11].total) + ' Holy What Happeneds = ' + (100 * ms[11].total / catalogTotal).toFixed(0) + '% of the whole shop'
        + '; cheapest item (' + prices[0] + ') by ' + firstAt(ms, prices[0]) + ', a median one (' + median + ') by ' + firstAt(ms, median)
        + ', the dearest (' + prices[prices.length - 1] + ') by ' + firstAt(ms, prices[prices.length - 1]));
}
