'use strict';
// Evil Somalian Pirate (upgrade 27) was buffed on 2026-11-21 from 1e21 to 5e21 CPS per level: still under O'algo (28), and
// existing saves earn the new rate at once (late upgrades' income is worked out from levels, never saved).
const test = require('node:test');
const assert = require('node:assert/strict');
const { loadGame } = require('./helpers/game-harness');

const NOW = Date.UTC(2026, 10, 21, 12);

test('Evil Somalian Pirate gives 5e21 CPS per level: five times what it did, half of O\'algo', () => {
    const g = loadGame({ now: NOW, noRenown: true });
    assert.equal(g.eval('UPGRADE_CPS[27]'), 5e21);
    assert.ok(g.eval('UPGRADE_CPS[26] < UPGRADE_CPS[27] && UPGRADE_CPS[27] < UPGRADE_CPS[28]'), 'between Hypergamy and O\'algo');
    // pay-back (first level's price over its income) still grows from Hypergamy to Evil Pirate to O'algo
    const payback = (i) => g.eval(`UPGRADE_BASE_COSTS[${i}] / UPGRADE_CPS[${i}]`);
    assert.ok(payback(26) < payback(27) && payback(27) < payback(28));
    // a save with pirates: the same levels earn at the new rate, side by side with O'algo's
    g.eval('upgrade27Level = 10; upgrade28Level = 10; updateDisplays();');
    const evil = g.eval("getUpgradeCps('upgrade27')"), oalgo = g.eval("getUpgradeCps('upgrade28')");
    assert.ok(evil > 0 && oalgo > 0);
    assert.ok(Math.abs(evil / oalgo - 0.5) < 1e-9, 'half of O\'algo at the same level: ' + evil / oalgo);
    g.close();
});
