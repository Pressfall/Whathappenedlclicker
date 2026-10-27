'use strict';
// core/calc.js on its own: no page, no jsdom.
const test = require('node:test');
const assert = require('node:assert/strict');
const calc = require('../core/calc').create();

test('stepCost rounds each price up, and costAtLevel / computeBatchCost follow it', () => {
    // 100 x 1.1 is 110.00000000000001 in floating point, so it rounds up to 111. The game has always priced this way
    // (saves recompute prices with the same arithmetic), so 100, 111, 123, 136, 150, 165...
    assert.equal(calc.stepCost(100, 1.1), 111);
    assert.equal(calc.stepCost(111, 1.1), 123);
    assert.equal(calc.stepCost(123, 1.1), 136);
    assert.equal(calc.costAtLevel(100, 1.1, 0), 100);
    assert.equal(calc.costAtLevel(100, 1.1, 3), 136);
    assert.equal(calc.costAtLevel(100, 1.1, '3'), 136);
    assert.equal(calc.costAtLevel(100, 1.1, 5), 165);
    assert.equal(calc.computeBatchCost(100, 1, 1.1), 100);
    assert.equal(calc.computeBatchCost(100, 3, 1.1), 100 + 111 + 123);
    assert.equal(calc.computeBatchCost(100, 4, 1.1), 100 + 111 + 123 + 136);
});

test('computeBatchCost treats a missing or silly batch as 1 and a silly rate as 1.1', () => {
    assert.equal(calc.computeBatchCost(100, 0, 1.1), 100);
    assert.equal(calc.computeBatchCost(100, -4, 1.1), 100);
    assert.equal(calc.computeBatchCost(100, 'x', 1.1), 100);
    assert.equal(calc.computeBatchCost(100, 2.9, 1.1), 100 + 111, 'whole levels only');
    assert.equal(calc.computeBatchCost(100, 2, NaN), 100 + 111);
});

test('maxAffordableLevels counts the levels the money pays for, with a discount', () => {
    assert.equal(calc.maxAffordableLevels(100, 1.1, 99), 0);
    assert.equal(calc.maxAffordableLevels(100, 1.1, 100), 1);
    assert.equal(calc.maxAffordableLevels(100, 1.1, 210), 1, '100 + 111 is 211');
    assert.equal(calc.maxAffordableLevels(100, 1.1, 211), 2);
    assert.equal(calc.maxAffordableLevels(100, 1.1, 333), 2);
    assert.equal(calc.maxAffordableLevels(100, 1.1, 334), 3);
    assert.equal(calc.maxAffordableLevels(100, 1.1, 66, 0.5), 1, 'half price: 50, then 55.5 would make 105.5');
    assert.equal(calc.maxAffordableLevels(100, 1.1, 1e300, 1, 50), 50, 'stops at the cap');
    assert.equal(calc.maxAffordableLevels(100, 1.1, 'nope'), 0);
});

test('safeNum falls back when a value is not finite', () => {
    assert.equal(calc.safeNum('12'), 12);
    assert.equal(calc.safeNum('abc'), 0);
    assert.equal(calc.safeNum(Infinity, 7), 7);
    assert.equal(calc.safeNum(undefined, 3), 3);
    assert.equal(calc.safeNum(null), 0);
});

test('level milestones: nothing up to 500, then x2 / 25 levels, x4 / 100, x10 / 1000', () => {
    assert.equal(calc.computeLevelMultiplier(0), 1);
    assert.equal(calc.computeLevelMultiplier(500), 1);
    assert.equal(calc.computeLevelMultiplier(524), 1);
    assert.equal(calc.computeLevelMultiplier(525), 2);
    assert.equal(calc.computeLevelMultiplier(550), 4);
    assert.equal(calc.computeLevelMultiplier(599), 8);
    assert.equal(calc.computeLevelMultiplier(600), 2 ** 4 * 4);
    assert.equal(calc.computeLevelMultiplier(1000), 2 ** 20 * 4 ** 5 * 10);
    assert.equal(calc.computeLevelMultiplier('600'), 64);
    assert.equal(calc.computeLevelMultiplier('x'), 1);
});

test('the multiplier never shrinks as levels grow', () => {
    let prev = 1;
    for (let lv = 0; lv <= 3000; lv++) {
        const m = calc.computeLevelMultiplier(lv);
        assert.ok(m >= prev, `level ${lv}`);
        prev = m;
    }
});

test('getNextMilestone points at the next level that multiplies, and its boost', () => {
    assert.equal(calc.getNextMilestone(0), null);
    assert.equal(calc.getNextMilestone(499), null);
    assert.deepEqual(calc.getNextMilestone(500), { level: 525, boost: 2 });
    assert.deepEqual(calc.getNextMilestone(524), { level: 525, boost: 2 });
    assert.deepEqual(calc.getNextMilestone(575), { level: 600, boost: 4 });
    assert.deepEqual(calc.getNextMilestone(975), { level: 1000, boost: 10 });
    assert.deepEqual(calc.getNextMilestone(1000), { level: 1025, boost: 2 });
});

test('between two milestones the multiplier is flat, and the next one lifts it by at least its boost', () => {
    for (let lv = 500; lv < 2500; lv++) {
        const next = calc.getNextMilestone(lv);
        const ratio = calc.computeLevelMultiplier(next.level) / calc.computeLevelMultiplier(lv);
        assert.ok(ratio >= next.boost, `from ${lv} to ${next.level}: x${ratio} < x${next.boost}`);
        for (let between = lv + 1; between < next.level; between++) {
            assert.equal(calc.computeLevelMultiplier(between), calc.computeLevelMultiplier(lv), `${between} is between milestones`);
        }
    }
});

test('Divine prices follow their documented curves', () => {
    const row = (kind, n) => Array.from({ length: n }, (_, L) => Number(calc.divineCostFor(kind, L)));
    assert.deepEqual(row('argon', 4), [1, 3, 9, 27]);
    assert.deepEqual(row('somalian', 3), [1, 3, 9]);
    assert.deepEqual(row('assassin', 4), [1, 2, 3, 4]);
    assert.deepEqual(row('collector', 5), [1, 2, 3, 5, 7]);
    assert.deepEqual(row('villager', 4), [1, 2, 3, 5]);
    assert.deepEqual(row('moneyMan', 6), [1, 2, 3, 5, 9, 17]);
    assert.deepEqual(row('spirit', 6), [1, 2, 3, 5, 8, 13]);
    assert.deepEqual(row('brileyism', 6), [2, 4, 6, 9, 14, 21]);
    assert.equal(calc.divineCostFor('unknown', 3), 1);
    assert.equal(calc.divineCostFor('argon', -5), 1, 'a negative level counts as 0');
    assert.equal(calc.divineCostFor('argon', '2'), 9);
});

test('fibNumber: 1, 2, 3, 5, 8...', () => {
    assert.deepEqual([1, 2, 3, 4, 5, 6, 7].map((n) => calc.fibNumber(n)), [1, 2, 3, 5, 8, 13, 21]);
    assert.equal(calc.fibNumber(0), 1);
});

test('prestige: levels per Golden shrink with bonuses, awards round down', () => {
    assert.equal(calc.levelsPerGolden(1500, 0, 0), 1500);
    assert.equal(calc.levelsPerGolden(1500, 0.5, 0), 1000);
    assert.equal(calc.levelsPerGolden(1500, 0, 100), 750, 'Void followers: +100% Golden');
    assert.equal(calc.levelsPerGolden(1500, 0.5, 50), 1500 / (1.5 * 1.5));
    assert.equal(calc.prestigeAwards(1499, 1500), 0);
    assert.equal(calc.prestigeAwards(1500, 1500), 1);
    assert.equal(calc.prestigeAwards(4499, 1500), 2);
    // 1200 levels at +25% is exactly 1 Golden, not 0.99999 from float error
    assert.equal(calc.prestigeAwards(1200, calc.levelsPerGolden(1500, 0.25, 0)), 1);
    assert.equal(calc.prestigeAwards(0, 1500), 0);
});

test('offlineSeconds: whole seconds, capped at 24 hours, never negative', () => {
    const now = 1_700_000_000_000;
    assert.equal(calc.offlineSeconds(now - 3_900, now), 3);
    assert.equal(calc.offlineSeconds(now - 900, now), 0);
    assert.equal(calc.offlineSeconds(now - 3_600_000, now), 3600);
    assert.equal(calc.offlineSeconds(now - 86_400_000, now), 86_400);
    assert.equal(calc.offlineSeconds(now - 90 * 86_400_000, now), 86_400);
    assert.equal(calc.offlineSeconds(now + 5_000, now), 0, 'a save from the future');
    assert.equal(calc.offlineSeconds(now - 90 * 86_400_000, now, 600), 600, 'custom cap');
    for (const bad of [undefined, null, 0, '', 'banana', NaN]) assert.equal(calc.offlineSeconds(bad, now), 0, String(bad));
    assert.equal(calc.offlineSeconds(String(now - 10_000), now), 10, 'a save time stored as a string');
});

const base = { pirateEffective: 10, otherEffective: 100, jonathanEffective: 0, crEffective: 0 };
const near = (a, b) => assert.ok(Math.abs(a - b) <= 1e-9 * Math.max(1, Math.abs(b)), `${a} vs ${b}`);

test('offlineCps with no bonuses is pirate + other', () => {
    assert.equal(calc.offlineCps(base), 110);
});

test('offlineCps applies each multiplier in turn', () => {
    assert.equal(calc.offlineCps({ ...base, pirateMultiplier: 2 }), 10 * 2 + 100);
    assert.equal(calc.offlineCps({ ...base, goonMultiplier: 3 }), 10 + 300);
    assert.equal(calc.offlineCps({ ...base, diddyMultiplier: 2, argonMultiplier: 3 }), 110 * 6);
    assert.equal(calc.offlineCps({ ...base, phonkBaseCps: 5, phonkOther: 2 }), 10 + 100 + 10);
    near(calc.offlineCps({ ...base, golden: 5 }), 110 * 1.5);
    assert.equal(calc.offlineCps({ ...base, divineCpsMult: 4 }), 440);
    near(calc.offlineCps({ ...base, clanPerkPercent: 10 }), 110 * 1.1);
    near(calc.offlineCps({ ...base, followerCpsPercent: 20, followerOfflinePercent: 50 }), 110 * 1.2 * 1.5);
    near(calc.offlineCps({ ...base, itemCpsPercent: 10, itemOfflinePercent: 100 }), 110 * 1.1 * 2);
});

test('offlineCps: section multipliers reach Jonathan and CR lurker income too', () => {
    assert.equal(calc.offlineCps({ ...base, diddyOther: 2, jonathanEffective: 10, jonathanOther: 3 }), 10 + 200 + 30);
    assert.equal(calc.offlineCps({ ...base, crEffective: 7, crOther: 2 }), 10 + 100 + 14);
});

test('offlineCps with zero income is zero, whatever the bonuses', () => {
    assert.equal(calc.offlineCps({ pirateEffective: 0, otherEffective: 0, jonathanEffective: 0, crEffective: 0, golden: 99, divineCpsMult: 1e6, itemOfflinePercent: 900 }), 0);
});
