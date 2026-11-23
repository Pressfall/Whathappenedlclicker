'use strict';
// Divine Combo Man (added 2026-11-23): each of your clicks on the image adds 1 to a combo, and every combo point raises CPS
// and click power by 0.01% per level. 30 seconds without a click and the combo is gone. It is live income only: offline
// gains, timelapses and the stats other pages read leave it out.
const test = require('node:test');
const assert = require('node:assert/strict');
const calc = require('../core/calc');
const { PRESTIGE_KEEP } = require('../core/save');
const { loadGame } = require('./helpers/game-harness');

const NOW = Date.UTC(2026, 10, 23, 12);
const near = (a, b, msg) => assert.ok(Math.abs(a - b) <= 1e-9 * Math.max(1, Math.abs(b)), `${msg || ''} ${a} vs ${b}`);
// a game with some income, Combo Man at `level` and nothing else that moves CPS between reads
function game(level) {
    const g = loadGame({ now: NOW, noRenown: true });
    g.eval(`upgrade1Level = 40; upgrade2Level = 30; upgrade3Level = 10; goldenWhat = 0; divineComboManLevel = ${level}; updateDisplays();`);
    return g;
}
const click = (g, n = 1, auto = false) => g.eval(`for (let i = 0; i < ${n}; i++) increment(${auto ? '{ auto: true }' : ''}); updateDisplays();`);
const rates = (g) => ({ cps: g.eval('Number(cps)'), click: g.eval('Number(clickPower)') });

test('Combo Man costs 1, 2, 3, 5, 7, 11 Golden (x1.6 a level)', () => {
    assert.deepEqual(Array.from({ length: 6 }, (_, L) => calc.divineCostFor('comboMan', L)), [1, 2, 3, 5, 7, 11]);
});

test('buying a level takes the Golden and raises the next price; too little Golden is refused', () => {
    const g = game(0);
    g.eval('window.__notes = []; notify = (m) => { window.__notes.push(String(m)); }; goldenWhat = 3;');
    g.eval('buyDivineComboMan()');
    assert.deepEqual([g.eval('divineComboManLevel'), g.eval('goldenWhat'), g.eval('divineComboManCost')], [1, 2, 2]);
    g.eval('buyDivineComboMan()');
    assert.deepEqual([g.eval('divineComboManLevel'), g.eval('goldenWhat'), g.eval('divineComboManCost')], [2, 0, 3]);
    g.eval('buyDivineComboMan()');
    assert.equal(g.eval('divineComboManLevel'), 2);
    assert.match(g.eval('window.__notes[0]'), /need 3/);
    assert.match(g.eval("document.querySelector('#divineComboManBtn .upgrade-label').textContent"), /Divine Combo Man.*\+0\.02% → \+0\.03%/);
    g.close();
});

test('each click adds 1 to the combo: +0.01% CPS and click power per level per combo point', () => {
    const g = game(3);
    const base = rates(g);
    assert.ok(base.cps > 0 && base.click > 0);
    click(g, 200);
    assert.equal(g.eval('comboCount'), 200);
    const now = rates(g);
    near(now.cps, base.cps * (1 + 0.0001 * 3 * 200), 'CPS +6%');
    near(now.click, base.click * (1 + 0.0001 * 3 * 200), 'click power +6%');
    // the meter under the image shows it
    assert.equal(g.eval("document.getElementById('comboMeter').hidden"), false);
    assert.equal(g.eval("document.getElementById('comboCount').textContent"), '200');
    assert.match(g.eval("document.getElementById('comboBonus').textContent"), /^\+6\.00% CPS & click power$/);
    g.close();
});

test('no combo without the upgrade, and the Auto Clicker never builds one', () => {
    const none = game(0);
    click(none, 50);
    assert.equal(none.eval('comboCount'), 0);
    assert.equal(none.eval("document.getElementById('comboMeter').hidden"), true);
    none.close();
    const g = game(1);
    const base = rates(g);
    click(g, 50, true);
    assert.equal(g.eval('comboCount'), 0);
    near(rates(g).cps, base.cps);
    g.close();
});

test('30 seconds without a click ends the combo; a click in time keeps it going', () => {
    const g = game(2);
    const base = rates(g);
    click(g, 10);
    g.advance(25000); click(g, 10); // in time: 20
    g.advance(29999); g.eval('comboTick()');
    assert.equal(g.eval('comboCount'), 20, 'still alive 1 ms before the 30 s');
    near(rates(g).cps, base.cps * (1 + 0.0001 * 2 * 20));
    g.advance(1); g.eval('comboTick()');
    assert.equal(g.eval('comboCount'), 0, 'gone at 30 s');
    near(rates(g).cps, base.cps, 'CPS back to normal at once');
    near(rates(g).click, base.click);
    assert.equal(g.eval("document.getElementById('comboMeter').hidden"), true);
    // the next click starts again from 1
    click(g, 1);
    assert.equal(g.eval('comboCount'), 1);
    g.close();
});

test('Divine Prophit of Brileyism makes the combo stronger like every other Divine upgrade', () => {
    const g = game(1);
    g.eval('divineBrileyismLevel = 2;'); // +10%
    near(g.eval('getComboBonus(1, 100)'), 0.0001 * 100 * 1.1);
    g.close();
});

test('timelapses, the stats other pages read and long gaps leave the combo out', () => {
    const g = game(5);
    const base = rates(g);
    click(g, 1000); // +50%
    near(rates(g).cps, base.cps * 1.5);
    near(g.eval('cpsWithoutCombo()'), base.cps);
    near(g.eval('clickPowerWithoutCombo()'), base.click);
    // a timelapse pays the combo-free income
    const before = g.eval('Number(count)');
    g.eval('addCpsSeconds(3600)');
    near(g.eval('Number(count)') - before, base.cps * 3600, 'an hour at the normal CPS');
    // saved for achievements, clan challenges and other pages: no combo either
    g.eval('window._lastRatePersist = 0; updateDisplays();');
    near(Number(g.storage.getItem('whathappened_current_cps')), base.cps);
    near(g.eval('liveAchievementData().cps'), base.cps);
    // a CPS tick 2 minutes apart (a background tab): the combo's share only for the 30 s it lasted
    const t0 = g.eval('Date.now()');
    near(g.eval(`cpsSecondsSince(${t0}, ${t0 + 120000})`) * g.eval('Number(cps)'), base.cps * 120 + base.cps * 0.5 * 30);
    near(g.eval(`cpsSecondsSince(${t0}, ${t0 + 10000})`), 10, 'all of a short tick has the combo');
    g.close();
});

test('the level is saved and kept through a prestige; a reload within 30 s keeps the combo', () => {
    assert.ok(PRESTIGE_KEEP.includes('divineComboManLevel') && PRESTIGE_KEEP.includes('divineComboManCost'));
    const g = game(4);
    g.eval('divineComboManCost = divineCostFor("comboMan", 4);');
    click(g, 30);
    g.eval('saveGame(); saveComboState();');
    assert.equal(g.savedState().divineComboManLevel, 4);
    assert.equal(g.savedState().comboCount, undefined, 'the combo is not part of the save');
    g.advance(5000);
    const again = g.reload();
    assert.equal(again.eval('divineComboManLevel'), 4);
    assert.equal(again.eval('divineComboManCost'), 7);
    assert.equal(again.eval('comboNow()'), 30, 'back after a quick reload');
    again.advance(30000);
    const later = again.reload();
    assert.equal(later.eval('comboNow()'), 0, 'not after 30 s');
    g.close(); again.close(); later.close();
});
