'use strict';
// core/guide.js: what the first-run guide says.
const test = require('node:test');
const assert = require('node:assert/strict');
const { plan, VETERAN_LEVELS } = require('../core/guide');

const names = [null, 'OP mouse', 'Somalian Pirate', 'Goonsaw Man', 'Diddy blud'];
for (let i = names.length; i <= 12; i++) names[i] = 'Upgrade ' + i;
names[12] = 'CR lurker';
const specials = [
    { name: 'Mousepad of Destiny', upgrade: 1, upgradeName: 'OP mouse', level: 10, owned: false },
    { name: 'RGB Underglow', upgrade: 1, upgradeName: 'OP mouse', level: 25, owned: false },
    { name: 'Bigger Speedboat', upgrade: 2, upgradeName: 'Somalian Pirate', level: 10, owned: false },
    { name: 'Second Chainsaw', upgrade: 3, upgradeName: 'Goonsaw Man', level: 10, owned: false },
];
const lv = (o) => { const a = new Array(13).fill(0); for (const [k, v] of Object.entries(o)) a[k] = v; return a; };
const state = (over = {}) => ({ levels: lv({}), names, costs: [], specials, count: 0, clicks: 0, prestiges: 0, golden: 0, prestigeAwards: 0, dismissed: false, ...over });
const done = (p) => p.steps.map((s) => s.done);

test('a brand-new player sees the guide with the first step current', () => {
    const p = plan(state());
    assert.equal(p.visible, true);
    assert.deepEqual(done(p), [false, false, false, false, false]);
    assert.deepEqual(p.steps.map((s) => s.current), [true, false, false, false, false]);
    assert.equal(p.allDone, false);
});

test('steps tick off as the player progresses', () => {
    assert.deepEqual(done(plan(state({ clicks: 3 }))), [true, false, false, false, false]);
    assert.deepEqual(done(plan(state({ count: 50 }))), [true, false, false, false, false]);
    assert.deepEqual(done(plan(state({ levels: lv({ 1: 1 }) }))), [true, true, false, false, false]);
    assert.deepEqual(done(plan(state({ levels: lv({ 1: 4, 2: 1 }) }))), [true, true, true, false, false]);
    assert.deepEqual(done(plan(state({ levels: lv({ 1: 10, 2: 1 }) }))), [true, true, true, true, false]);
    const owned = specials.map((s, i) => (i === 0 ? { ...s, owned: true } : s));
    const all = plan(state({ levels: lv({ 1: 10, 2: 1 }), specials: owned }));
    assert.deepEqual(done(all), [true, true, true, true, true]);
    assert.equal(all.allDone, true);
    assert.equal(all.steps.some((s) => s.current), false);
});

test('the level step names the level of the first OP mouse special', () => {
    assert.match(plan(state()).steps[3].label, /level 10 /);
    const odd = specials.map((s) => (s.upgrade === 1 ? { ...s, level: 7 } : s));
    assert.match(plan(state({ specials: odd })).steps[3].label, /level 7 /);
});

test('the next unlock is the special that needs the fewest more levels', () => {
    const p = plan(state({ levels: lv({ 1: 4, 2: 8, 3: 1 }) }));
    assert.deepEqual(p.nextUnlock, { kind: 'special', name: 'Bigger Speedboat', upgrade: 2, upgradeName: 'Somalian Pirate', level: 10, remaining: 2 });
});

test('ties go to the lower-numbered upgrade', () => {
    const p = plan(state({ levels: lv({ 1: 5, 2: 5, 3: 5 }) }));
    assert.equal(p.nextUnlock.upgrade, 1);
});

test('specials of upgrades you have not bought are not "next"', () => {
    const p = plan(state({ levels: lv({ 1: 1 }) }));
    assert.equal(p.nextUnlock.upgrade, 1);
    assert.equal(p.nextUnlock.remaining, 9);
});

test('owned specials and levels already reached are skipped', () => {
    const sp = [
        { name: 'A', upgrade: 1, upgradeName: 'OP mouse', level: 10, owned: true },
        { name: 'B', upgrade: 1, upgradeName: 'OP mouse', level: 25, owned: false },
        { name: 'C', upgrade: 2, upgradeName: 'Somalian Pirate', level: 10, owned: false },
    ];
    // OP mouse is level 30, so B is unlocked (it shows as ready in the Specials menu, not as a lock to climb to)
    const p = plan(state({ levels: lv({ 1: 30, 2: 3 }), specials: sp }));
    assert.equal(p.nextUnlock.name, 'C');
});

test('no next unlock before anything is bought', () => {
    assert.equal(plan(state()).nextUnlock, null);
});

test('the next upgrade to buy is the first one at level 0', () => {
    const p = plan(state({ levels: lv({ 1: 2 }), costs: [0, 100, 500, 1000] }));
    assert.deepEqual(p.nextUpgrade, { kind: 'upgrade', upgrade: 2, name: 'Somalian Pirate', cost: 500 });
    assert.equal(plan(state({ levels: lv({ 1: 2, 2: 1 }), costs: [0, 100, 500, 1000] })).nextUpgrade.upgrade, 3);
    assert.equal(plan(state({ levels: new Array(13).fill(1) })).nextUpgrade, null, 'all bought');
});

test('with CR lurker bought and no special left to chase, it points at Prestige', () => {
    const p = plan(state({ levels: lv({ 12: 40 }), specials: [] }));
    assert.deepEqual(p.nextUnlock, { kind: 'prestige', upgradeName: 'CR lurker', level: 150, remaining: 110 });
});

test('a ready prestige takes priority over everything', () => {
    const p = plan(state({ levels: lv({ 1: 4, 12: 150 }), prestigeAwards: 2 }));
    assert.deepEqual(p.nextUnlock, { kind: 'prestige-ready', awards: 2 });
});

test('the guide stays hidden once dismissed, and for players who already prestiged or hold Golden', () => {
    assert.equal(plan(state({ dismissed: true })).visible, false);
    assert.equal(plan(state({ prestiges: 1 })).visible, false);
    assert.equal(plan(state({ golden: 2 })).visible, false);
    assert.equal(plan(state({ levels: lv({ 1: VETERAN_LEVELS - 1 }) })).visible, true);
    assert.equal(plan(state({ levels: lv({ 1: VETERAN_LEVELS }) })).visible, false);
    assert.equal(plan(state({ levels: lv({ 1: 800, 2: 700 }) })).visible, false, 'levels are summed across upgrades');
});

test('bad or missing input never throws', () => {
    for (const s of [{}, { levels: [] }, { levels: [null, 'x', NaN], names: [], specials: null }, state({ levels: undefined })]) {
        assert.doesNotThrow(() => plan(s));
    }
    assert.equal(plan({}).visible, true);
});

test('the current step shows how close it is: What Happeneds toward the first OP mouse, and what it unlocks', () => {
    const costs = [0, 100, 500, 1000];
    const p = plan(state({ costs, count: 37.6 }));
    assert.deepEqual(p.progress, { kind: 'buy', upgrade: 1, name: 'OP mouse', have: 37, need: 100, first: true, ready: false,
        unlocks: { name: 'Mousepad of Destiny', level: 10 } });
    assert.equal(plan(state({ costs, count: 100, clicks: 100 })).progress.ready, true, 'enough to buy it');
    // then the Pirate, then OP mouse levels toward its first special
    const pirate = plan(state({ costs, count: 120, levels: lv({ 1: 1 }) })).progress;
    assert.deepEqual([pirate.name, pirate.have, pirate.need, pirate.unlocks], ['Somalian Pirate', 120, 500, null]);
    const lvl = plan(state({ costs, levels: lv({ 1: 4, 2: 1 }) })).progress;
    assert.deepEqual([lvl.kind, lvl.have, lvl.need, lvl.unlocks.name], ['level', 4, 10, 'Mousepad of Destiny']);
    // the last step (buy a special) has no bar, and neither does a step whose price is unknown
    assert.equal(plan(state({ costs, levels: lv({ 1: 10, 2: 1 }) })).progress, null);
    assert.equal(plan(state({ count: 5 })).progress, null);
});

test('the save reminder is due once there is something to lose, and never again once shown, used, or synced', () => {
    const { saveReminderDue, REMINDER_LEVELS } = require('../core/guide');
    assert.equal(saveReminderDue(state()), false, 'a brand-new player has nothing to lose yet');
    assert.equal(saveReminderDue(state({ levels: lv({ 1: REMINDER_LEVELS - 1 }) })), false);
    assert.equal(saveReminderDue(state({ levels: lv({ 1: 20, 2: 5 }) })), true, 'enough upgrade levels');
    assert.equal(saveReminderDue(state({ specials: specials.map((s, i) => (i === 0 ? { ...s, owned: true } : s)) })), true, 'a special bought');
    assert.equal(saveReminderDue(state({ prestiges: 1 })), true, 'a veteran on a browser that was never backed up');
    const due = state({ levels: lv({ 1: 30 }) });
    assert.equal(saveReminderDue({ ...due, reminder: 'shown' }), false, 'once only');
    assert.equal(saveReminderDue({ ...due, reminder: 'done' }), false, 'already downloaded a save file');
    assert.equal(saveReminderDue({ ...due, accountSynced: true }), false, 'already saving to an account');
    assert.equal(saveReminderDue(null), false);
});
