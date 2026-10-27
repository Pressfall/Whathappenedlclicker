'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { loadGame } = require('./helpers/game-harness');

const NOW = 1_700_000_000_000;
const HOUR = 3600 * 1000;
const START_COUNT = 1000;

// A player with some income, saved at NOW.
function player(opts) {
    const g = loadGame({ now: NOW, ...opts });
    g.eval(`count = ${START_COUNT}; upgrade2Level = 50; upgrade3Level = 30; upgrade5Level = 12; updateDisplays(); saveGame();`);
    return g;
}
// Come back after `ms`. Returns { page, gained, cps }
function comeBack(g, ms, extra) {
    g.advance(ms);
    const page = g.reload(extra);
    return { page, gained: Number(page.eval('count')) - START_COUNT, cps: Number(page.eval('cps')) };
}
const welcomeShown = (g) => g.window.document.getElementById('welcomeBackModal').style.display === 'block';

test('time away earns CPS x seconds', () => {
    const { gained, cps } = comeBack(player(), HOUR);
    assert.ok(cps > 0);
    assert.ok(Math.abs(gained - cps * 3600) < 1e-6 * gained, `${gained} vs ${cps * 3600}`);
});

test('whole seconds only: 3.9 seconds away earns 3 seconds', () => {
    const { gained, cps } = comeBack(player(), 3900);
    assert.ok(Math.abs(gained - cps * 3) < 1e-6 * gained);
});

test('offline earnings stop at 24 hours', () => {
    const day = comeBack(player(), 24 * HOUR);
    const week = comeBack(player(), 7 * 24 * HOUR);
    assert.ok(Math.abs(day.gained - day.cps * 86400) < 1e-6 * day.gained);
    assert.equal(week.gained, day.gained);
});

test('less than a second away earns nothing', () => {
    assert.equal(comeBack(player(), 900).gained, 0);
});

test('a clock that moved backwards earns nothing and loses nothing', () => {
    const { gained } = comeBack(player(), -5 * HOUR);
    assert.equal(gained, 0);
});

test('a brand-new player earns nothing offline', () => {
    const g = loadGame({ now: NOW });
    assert.equal(Number(g.eval('count')), 0);
    g.advance(5 * HOUR);
    assert.equal(Number(g.reload().eval('count')), 0);
});

test('no income, no earnings', () => {
    const g = loadGame({ now: NOW });
    g.eval(`count = ${START_COUNT}; saveGame();`);
    g.advance(5 * HOUR);
    assert.equal(Number(g.reload().eval('count')), START_COUNT);
});

test('Golden (+10% each) and Divine Argonian count towards offline CPS', () => {
    const plain = comeBack(player(), HOUR);
    const g = loadGame({ now: NOW });
    g.eval(`count = ${START_COUNT}; upgrade2Level = 50; upgrade3Level = 30; upgrade5Level = 12; goldenWhat = 5; divineArgonLevel = 1; updateDisplays(); saveGame();`);
    const boosted = comeBack(g, HOUR);
    const mult = (1 + 5 * 0.1) * (1 + 300 / 100); // x1.5 Golden, +300% Argonian
    assert.ok(Math.abs(boosted.gained / plain.gained - mult) < 1e-9, `${boosted.gained / plain.gained} vs ${mult}`);
});

test('a clan level perk counts towards offline CPS', () => {
    const plain = comeBack(player(), HOUR);
    const clan = comeBack(player({ storage: { player_clanId: 'c1', whathappened_clan_level: '20' } }), HOUR, {});
    const perk = clan.page.eval('getClanLevelPerk().cps');
    assert.ok(perk > 0);
    assert.ok(Math.abs(clan.gained / plain.gained - (1 + perk / 100)) < 1e-9);
});

test('the offline bonus from items applies to away time, but not to live CPS', () => {
    const plain = comeBack(player(), HOUR);
    const withCharm = (w) => { w.WHI.bonuses = () => ({ cps: 0, click: 0, critChance: 0, critDmg: 0, gems: 0, boxRate: 0, offline: 50, cpsMult: 1, clickMult: 1 }); };
    const g = player({ beforeInit: withCharm });
    const charmed = comeBack(g, HOUR);
    assert.ok(Math.abs(charmed.gained / plain.gained - 1.5) < 1e-9);
    assert.ok(Math.abs(charmed.cps - plain.cps) < 1e-9, 'live CPS is unchanged');
});

test('a running consumable boost does not pay out while you are away', () => {
    const plain = comeBack(player(), HOUR);
    const boosted = (w) => { w.WHI.bonuses = () => ({ cps: 0, click: 0, critChance: 0, critDmg: 0, gems: 0, boxRate: 0, offline: 0, cpsMult: 10, clickMult: 1 }); };
    const r = comeBack(player({ beforeInit: boosted }), HOUR);
    assert.ok(Math.abs(r.gained - plain.gained) < 1e-6 * plain.gained, 'offline gain ignores cpsMult');
    assert.ok(r.cps > plain.cps * 9, 'live CPS has the boost');
});

test('the Welcome back panel appears after a minute away and not before', () => {
    assert.equal(welcomeShown(comeBack(player(), 59 * 1000).page), false);
    assert.equal(welcomeShown(comeBack(player(), 61 * 1000).page), true);
});
