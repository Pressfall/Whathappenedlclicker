'use strict';
// Clan levels and the check-in (core/clan-levels.js): one table for the game and the clan page.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const L = require('../core/clan-levels');

// the curve both pages used before this file: level 2 at 200 XP, each further level 1.55x the one before
function oldLevel(xp) { let need = 200, total = 0, level = 1; while (level < 20 && xp >= total + need) { total += need; need *= 1.55; level++; } return level; }

test('the XP curve is the one both pages used', () => {
    for (const xp of [0, 1, 199, 200, 509, 510, 1000, 5000, 1e4, 5e4, 1e5, 1e6, 1e9]) assert.equal(L.levelFromXp(xp), oldLevel(xp), 'xp ' + xp);
    assert.equal(L.xpForLevel(2), 200);
    assert.equal(L.xpForLevel(3), 200 + 310);
    assert.equal(L.levelFromXp(L.xpForLevel(20)), 20);
    assert.equal(L.levelFromXp(L.xpForLevel(20) - 1), 19);
});

test('a forged XP total can only move a clan along the table', () => {
    for (const xp of [-5, 'lots', NaN, null, undefined, Infinity, 1e300]) {
        const lvl = L.levelFromXp(xp);
        assert.ok(lvl >= 1 && lvl <= 20, String(xp));
    }
    assert.equal(L.levelFromXp('lots'), 1, 'not a number: level 1');
    assert.equal(L.levelFromXp(Infinity), 20, 'never past the top');
    assert.equal(L.perk(99), L.PERKS[20]);
    assert.equal(L.perk(-3), L.PERKS[1]);
});

test('levelInfo says how far into a level a clan is', () => {
    const i = L.levelInfo(300);
    assert.deepEqual([i.level, i.xpInLevel, i.xpForNext], [2, 100, 310]);
    assert.ok(Math.abs(i.pct - 100 / 310 * 100) < 1e-9);
    const top = L.levelInfo(1e12);
    assert.deepEqual([top.level, top.xpForNext, top.pct], [20, 0, 100]);
});

test('perks: the text the clan page shows, and event gems raised by the level', () => {
    assert.equal(L.perkText(L.perk(1)), 'No bonus yet');
    assert.equal(L.perkText(L.perk(20)), '+55% CPS, +30% click power, +15% event gems');
    assert.equal(L.eventGems(20, 1), 20);
    assert.equal(L.eventGems(20, 10), 21, '+5% at level 10');
    assert.equal(L.eventGems(0, 20), 0);
});

test('check-ins: 5 CP, 2 more each day of a streak, up to 15', () => {
    assert.deepEqual([1, 2, 3, 4, 5, 6, 7, 30].map(L.checkinReward), [5, 7, 9, 11, 13, 15, 15, 15]);
    const now = Date.UTC(2026, 10, 10, 12);
    assert.equal(L.nextStreak({}, now), 1);
    assert.equal(L.nextStreak({ day: '2026-11-09', streak: 4 }, now), 5, 'yesterday continues it');
    assert.equal(L.nextStreak({ day: '2026-11-08', streak: 4 }, now), 1, 'a missed day starts again');
    assert.equal(L.nextStreak({ day: '2026-11-10', streak: 4 }, now), 4, 'today already: no change');
    assert.equal(L.currentStreak({ day: '2026-11-08', streak: 4 }, now), 0);
    assert.equal(L.currentStreak({ day: '2026-11-09', streak: 4 }, now), 4);
});

test('neither page keeps its own copy of the table any more', () => {
    const main = fs.readFileSync(path.join(__dirname, '..', 'main.js'), 'utf8');
    const page = fs.readFileSync(path.join(__dirname, '..', 'clan-page.js'), 'utf8');
    assert.match(main, /CLAN_LEVEL_PERKS = WHClanLevels\.PERKS/);
    assert.ok(!/cps: 55, click: 30/.test(main) && !/cps: 55, click: 30/.test(page), 'the level 20 perk is written down only in core/clan-levels.js');
});
