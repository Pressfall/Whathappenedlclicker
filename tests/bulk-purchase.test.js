'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { loadGame } = require('./helpers/game-harness');

// An independent model of the price rule: each level costs the previous price x rate, rounded up.
function model(startCost, levels, rate) {
    let total = 0;
    let cost = startCost;
    for (let i = 0; i < levels; i++) { total += cost; cost = Math.ceil(cost * rate); }
    return { total, next: cost };
}
const rateFor = (i) => (i <= 10 ? 1.1 : 1.15);
const BASE = [0, 100, 500, 1000, 3000, 10000, 250000, 1e6, 5e6, 2e7, 1e8, 5e8, 4.3e10, 4e13, 1.5e14, 3.6e14, 1.2e15, 3.3e16,
    1.7e19, 1.3e20, 3.1e20, 7e22, 6.8e23, 6e25, 1.8e26, 8.5e26, 4.2e27, 3e31, 1e33];

const game = (count) => {
    const g = loadGame({ now: 1_700_000_000_000 });
    g.eval(`count = ${count}`);
    return g;
};

test('buying a batch of 1, 5, 10, 25, 50 or 100 levels charges the compounding price', () => {
    for (const batch of [1, 5, 10, 25, 50, 100]) {
        const g = game(1e15);
        g.eval(`setBulkPurchase(${batch})`);
        g.eval('buyUpgrade1()');
        const want = model(100, batch, 1.1);
        assert.equal(g.eval('upgrade1Level'), batch, `level after x${batch}`);
        assert.equal(g.eval('upgrade1Cost'), want.next, `next price after x${batch}`);
        assert.equal(g.eval('count'), 1e15 - want.total, `spent for x${batch}`);
        g.close();
    }
});

test('every upgrade (1-28) follows its own price curve when bought in bulk', () => {
    const g = game(0); // one page load; each upgrade is independent
    g.eval('setBulkPurchase(10)');
    for (let i = 1; i <= 28; i++) {
        g.eval('count = 1e300');
        const base = g.eval(`Number(upgrade${i}Cost)`);
        assert.equal(base, BASE[i], `upgrade ${i} starting price`);
        g.eval(`buyUpgrade${i}()`);
        const want = model(base, 10, rateFor(i));
        assert.equal(g.eval(`Number(upgrade${i}Level)`), 10, `upgrade ${i} level`);
        assert.equal(g.eval(`Number(upgrade${i}Cost)`), want.next, `upgrade ${i} next price`);
    }
});

test('a batch you cannot fully afford buys as many levels as you can, then stops', () => {
    const want = model(100, 3, 1.1); // 100 + 110 + 121 = 331
    const g = game(want.total + 50); // enough for 3, not for the 4th (134)
    g.eval('setBulkPurchase(10)');
    g.eval('buyUpgrade1()');
    assert.equal(g.eval('upgrade1Level'), 3);
    assert.equal(g.eval('count'), 50);
    assert.equal(g.eval('upgrade1Cost'), want.next);
});

test('buying with too little money changes nothing', () => {
    const g = game(99);
    g.eval('setBulkPurchase(5)');
    g.eval('buyUpgrade1()');
    assert.equal(g.eval('upgrade1Level'), 0);
    assert.equal(g.eval('upgrade1Cost'), 100);
    assert.equal(g.eval('count'), 99);
});

test('Max buys every level you can afford', () => {
    const g = game(1e6);
    g.eval("setBulkPurchase('max')");
    g.eval('buyUpgrade1()');
    // walk the model until the money runs out
    let money = 1e6, cost = 100, levels = 0;
    while (money >= cost) { money -= cost; cost = Math.ceil(cost * 1.1); levels++; }
    assert.equal(g.eval('upgrade1Level'), levels);
    assert.equal(g.eval('count'), money);
    assert.equal(g.eval('upgrade1Cost'), cost);
});

test('the Max label counts the levels the next purchase would cover', () => {
    const g = game(1e6);
    g.eval("setBulkPurchase('max')");
    const label = g.eval('bulkLevelsFor(upgrade1Cost, 1.1)');
    g.eval('buyUpgrade1()');
    assert.equal(label, g.eval('upgrade1Level'));
});

test('Divine Simple Villager discounts every level of a bulk purchase', () => {
    const g = game(1e9);
    g.eval('divineSimpleVillagerLevel = 2'); // prices / (1 + 0.25 x 2)
    g.eval('setBulkPurchase(10)');
    g.eval('buyUpgrade1()');
    const want = model(100, 10, 1.1);
    assert.equal(g.eval('upgrade1Level'), 10);
    assert.equal(g.eval('upgrade1Cost'), want.next, 'the stored price is undiscounted');
    assert.ok(Math.abs((1e9 - g.eval('count')) - want.total / 1.5) < 1e-3, 'spent the discounted total');
});

test('the shown batch price matches what a purchase charges', () => {
    const g = game(1e12);
    const quoted = g.eval('Number(computeBatchCostWithSimpleVillager(upgrade3Cost, 25, 1.1))');
    g.eval('setBulkPurchase(25)');
    g.eval('buyUpgrade3()');
    assert.equal(1e12 - g.eval('count'), quoted);
});

test('the chosen bulk amount is remembered for the next visit', () => {
    const g = game(0);
    g.eval('setBulkPurchase(50)');
    assert.equal(g.storage.getItem('whathappened_bulk'), '50');
    assert.equal(g.reload().eval('purchaseBatch'), 50);
    g.eval("setBulkPurchase('max')");
    assert.equal(g.reload().eval('purchaseBatch'), 'max');
});
