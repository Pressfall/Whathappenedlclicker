'use strict';
// How the real game page (main.js loadGame) treats saves from older versions and damaged saves.
const test = require('node:test');
const assert = require('node:assert/strict');
const { loadGame } = require('./helpers/game-harness');

const NOW = 1_700_000_000_000;
const withSave = (save, key = 'whathappened_save') => loadGame({ now: NOW, storage: { [key]: typeof save === 'string' ? save : JSON.stringify(save) } });
// the save the game itself writes after loading
const resaved = (g) => { g.eval('saveGame()'); return g.savedState(); };

test('a version-1 save (no version field) loads and is upgraded to the current version', () => {
    const g = withSave({ count: 12345, upgrade1Level: 7, upgrade1Cost: 999, goldenWhat: 2 });
    assert.equal(g.eval('count'), 12345);
    assert.equal(g.eval('upgrade1Level'), 7);
    assert.equal(g.eval('goldenWhat'), 2);
    const out = resaved(g);
    assert.equal(out.version, 3);
    assert.equal(out.count, 12345);
});

test('the SCP upgrade added in version 2 starts empty for version-1 saves', () => {
    const g = withSave({ version: 1, count: 5 });
    assert.equal(g.eval('upgrade17Level'), 0);
    assert.equal(g.eval('scp1Purchased'), false);
    assert.equal(g.eval('scpMultiplier'), 1);
});

test('upgrade prices are recomputed from the levels, so a save made under old prices follows today\'s balance', () => {
    const g = withSave({ version: 3, upgrade1Level: 10, upgrade1Cost: 1 });
    assert.equal(g.eval('upgrade1Cost'), 270); // 100 x 1.1 ten times, rounded up each step
});

test('a save under only the legacy key still loads', () => {
    const g = withSave({ version: 2, count: 777 }, 'whathappened_save_v1');
    assert.equal(g.eval('count'), 777);
});

test('the current key wins over the legacy key', () => {
    const g = loadGame({ now: NOW, storage: {
        whathappened_save: JSON.stringify({ version: 3, count: 2 }),
        whathappened_save_v1: JSON.stringify({ version: 3, count: 1 }),
    } });
    assert.equal(g.eval('count'), 2);
});

test('counts saved as strings load as numbers', () => {
    const g = withSave({ version: 3, count: '1.5e+30', baseClickPower: '25' });
    assert.equal(g.eval('count'), 1.5e30);
    assert.equal(g.eval('baseClickPower'), 25);
});

test('a garbage count falls back to zero instead of NaN', () => {
    for (const bad of ['banana', 'Infinity', '-Infinity', {}]) {
        const g = withSave({ version: 3, count: bad, upgrade1Level: 3 });
        const c = g.eval('Number(count)');
        assert.ok(Number.isFinite(c), `count for ${JSON.stringify(bad)} was ${c}`);
        assert.equal(g.eval('upgrade1Level'), 3, 'the rest of the save still loads');
    }
});

test('unknown keys are ignored and purchased flags are coerced to booleans', () => {
    const g = withSave({ version: 3, special1Purchased: 1, special2Purchased: 'yes', special3Purchased: 0, evil: { __proto__: { x: 1 } }, madeUp: 5 });
    assert.equal(g.eval('special1Purchased'), true);
    assert.equal(g.eval('special2Purchased'), true);
    assert.equal(g.eval('special3Purchased'), false);
    assert.equal(g.eval('typeof madeUp'), 'undefined');
});

test('The Bass specials saved under their old "seabass" names are recognised', () => {
    const g = withSave({ version: 3, seabass1Purchased: true, seabass2Purchased: true, seabassMultiplier: 3 });
    assert.equal(g.eval('theBass1Purchased'), true);
    assert.equal(g.eval('theBass2Purchased'), true);
    assert.equal(g.eval('theBass3Purchased'), false);
    assert.equal(g.eval('theBassMultiplier'), 3);
});

test('background purchases saved under bare file names move to their full path', () => {
    const probe = loadGame({ now: NOW });
    const file = probe.eval("BG_IMAGES.find(f => f !== 'vrillbg.png' && f !== DEFAULT_BG_IMAGE.split('/').pop())");
    const g = withSave({ version: 3, shopBgPurchased: { [file.toUpperCase()]: true, 'not-a-real-file.png': true, [file]: false } });
    const keys = Array.from(g.eval('Object.keys(shopBgPurchased)')); // arrays from the game's realm need copying for deepEqual
    assert.deepEqual(keys, ['bgimages/' + file], 'matched case-insensitively, moved to its folder, unknown and false entries dropped');
});

test('damaged JSON does not crash the game: it starts fresh', () => {
    const g = withSave('{"count": 12, "upgrade1Level"');
    assert.equal(g.eval('count'), 0);
    assert.equal(g.eval('upgrade1Level'), 0);
    assert.equal(g.window._saveLoaded, true, 'the game finished starting');
});

test('a save that is not an object (a number, an array, null) does not crash the game', () => {
    for (const raw of ['42', '[1,2,3]', 'null', '"hi"']) {
        const g = withSave(raw);
        assert.equal(g.eval('count'), 0, raw);
        assert.equal(g.window._saveLoaded, true, raw);
    }
});

test('saving and loading again round-trips the whole save', () => {
    const g = loadGame({ now: NOW });
    g.eval('count = 123456; upgrade4Level = 33; upgrade25Level = 4; special5Purchased = true; goldenWhat = 9; divineSpiritLevel = 3; diamonds = 8; divineUnlocked = true');
    g.eval('syncUpgradeCostsFromLevels(); syncDivineCostsFromLevels()'); // prices always follow the levels
    const first = resaved(g);
    const second = resaved(g.reload());
    assert.deepEqual(second, first);
});
