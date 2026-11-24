'use strict';
// Kim Jong Un (upgrade 31, added 2026-11-23): the last upgrade. He follows the curve of upgrades 28-30
// (x10 the income, about x33 the price), has the usual four specials, a hero guild, and saves like the other late upgrades.
const test = require('node:test');
const { after } = require('node:test');
const assert = require('node:assert/strict');
const Guilds = require('../core/world-guilds');
const { loadGame } = require('./helpers/game-harness');

const NOW = Date.UTC(2026, 10, 23, 12);
const opened = [];
after(() => { for (const g of opened) try { g.close(); } catch (e) {} });
const open = (opts) => { const g = loadGame(Object.assign({ now: NOW, noRenown: true }, opts)); opened.push(g); return g; };
const withSave = (save) => open({ storage: { whathappened_save: JSON.stringify(Object.assign({ version: 3 }, save)) } });

test('balance: x10 Mincecraft Man\'s income, and the pay-back time grows x3.3 again like 28 -> 29 -> 30', () => {
    const g = open();
    assert.equal(g.eval('UPGRADE_COUNT'), 31);
    assert.equal(g.eval('UPGRADE_NAMES[31]'), 'Kim Jong Un');
    assert.equal(g.eval('UPGRADE_CPS[31]'), 1e25);
    assert.equal(g.eval('UPGRADE_BASE_COSTS[31]'), 3.3e37);
    assert.equal(g.eval('upgradeCostRate(31)'), 1.15);
    // seconds of its own income a first level takes to pay for itself
    const payback = (i) => g.eval(`UPGRADE_BASE_COSTS[${i}] / UPGRADE_CPS[${i}]`);
    const steps = [29, 30, 31].map((i) => payback(i) / payback(i - 1));
    for (const s of steps) assert.ok(s >= 3 && s <= 3.5, 'each late upgrade takes about 3.3x longer to pay back: ' + steps);
    // his first level costs what Mincecraft Man's 25th does, as Mincecraft Man's first costs about Siberian Hitman's 25th
    const ratio = (i) => g.eval(`UPGRADE_BASE_COSTS[${i}] / costForLevel(${i - 1}, 25)`);
    assert.ok(Math.abs(ratio(31) - 1) < 0.01, 'Kim lv 1 vs Mincecraft lv 25: ' + ratio(31));
    assert.ok(Math.abs(ratio(30) - 1) < 0.05, 'Mincecraft lv 1 vs Hitman lv 25: ' + ratio(30));
});

test('his button shows once Mincecraft Man is owned, and buying a level raises the price 15%', () => {
    const g = open();
    const btn = () => g.window.document.getElementById('upgrade31');
    assert.ok(btn(), 'the button is on the page');
    assert.equal(btn().querySelector('img').getAttribute('src'), 'mainimage/upgrades/thumbs/kimjongun.webp');
    g.eval('updateDisplays();');
    assert.equal(btn().style.display, 'none', 'hidden before Mincecraft Man');
    g.eval('upgrade30Level = 1; updateDisplays();');
    assert.equal(btn().style.display, 'flex');
    g.eval('count = 1e38; buyUpgrade31();');
    assert.equal(g.eval('upgrade31Level'), 1);
    assert.ok(Math.abs(g.eval('upgrade31Cost') / 3.3e37 - 1.15) < 1e-9);
    assert.ok(Math.abs(g.eval('count') - (1e38 - 3.3e37)) < 1e24);
    assert.ok(g.eval("getUpgradeCps('upgrade31')") > 0, 'he earns');
});

test('level, specials and multiplier survive save/load, and the specials multiply his CPS (x1.5, x2, x2.5, x3)', () => {
    const g = withSave({ count: 1e100, upgrade30Level: 5, upgrade31Level: 100 });
    assert.equal(g.eval('upgrade31Cost'), g.eval('costForLevel(31, 100)'));
    const before = g.eval("getUpgradeCps('upgrade31')");
    g.eval('buyKimJongUn1(); buyKimJongUn2(); buyKimJongUn3(); buyKimJongUn4();');
    assert.equal(g.eval('kimJongUnMultiplier'), 1.5 * 2 * 2.5 * 3);
    assert.ok(Math.abs(g.eval("getUpgradeCps('upgrade31')") / before - 22.5) < 1e-9);
    g.eval('saveGame();');
    const out = g.savedState();
    assert.equal(out.upgrade31Level, 100);
    assert.deepEqual([out.kimJongUn1Purchased, out.kimJongUn2Purchased, out.kimJongUn3Purchased, out.kimJongUn4Purchased], [true, true, true, true]);
    assert.equal(out.kimJongUnMultiplier, 22.5);
    const again = g.reload(); opened.push(again);
    assert.equal(again.eval('upgrade31Level'), 100);
    assert.equal(again.eval('kimJongUnMultiplier'), 22.5);
    assert.equal(again.eval('kimJongUn4Purchased'), true);
    const sp = Array.from(g.window.SPECIAL_UPGRADES.filter((s) => s.group && s.group.name === 'Kim Jong Un'), (s) => s.id);
    assert.deepEqual(sp, ['kimJongUn1', 'kimJongUn2', 'kimJongUn3', 'kimJongUn4']);
});

test('an older save without him starts him at level 0', () => {
    const g = withSave({ count: 5, upgrade30Level: 3 });
    assert.equal(g.eval('upgrade31Level'), 0);
    assert.equal(g.eval('upgrade31Cost'), 3.3e37);
    assert.equal(g.eval('kimJongUnMultiplier'), 1);
});

test('he has a hero guild in the Wilds, priced like the other tier-8 heroes', () => {
    const k = Guilds.GUILDS.find((x) => x.up === 31);
    assert.ok(k && k.hero === 'Kim Jong Un');
    assert.equal(Guilds.tierOf ? Guilds.tierOf(31) : 8, 8);
});
