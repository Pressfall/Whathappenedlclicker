'use strict';
// The Far Reaches: the Waystone's zones, their sealed lairs (ward stones), and the save rules around them
const test = require('node:test');
const assert = require('node:assert/strict');
const D = require('../core/world-data');
const W = require('../core/world-logic');

const NOW = new Date(2026, 10, 3, 12, 0, 0).getTime();
const FAR = D.ZONE_ORDER.filter(z => D.ZONES[z].via === 'waystone');

test('the Far Reaches come after Frostveil, one tier each, reached by the Waystone', () => {
    assert.deepEqual(FAR, ['coast', 'storm', 'ruins', 'sky']);
    FAR.forEach((z, i) => assert.equal(D.ZONES[z].tier, 5 + i, z));
    // each one opens with the boss before it, and Frozen WH's sigil finally means something
    assert.equal(D.ZONES.coast.gate, 'sigil_frost');
    const s = W.freshState(NOW);
    s.unlocked.zones.frost = true;
    const r = W.bossLoot(s, 'frozen', () => 0.5, NOW, 0);
    assert.equal(r.unlocked, 'coast');
    assert.ok(s.unlocked.zones.coast);
});

test('an old save that already beat Frozen WH finds the Waystone awake', () => {
    const s = W.freshState(NOW);
    Object.assign(s.unlocked.zones, { mines: true, ember: true, frost: true });
    s.bosses.frozen = { kills: 4, lastKillDay: '', lastKillWeek: '', mythicWeek: '' };
    const m = W.migrate(JSON.parse(JSON.stringify(s)), NOW);
    assert.ok(m.unlocked.zones.coast, 'Saltspray Coast is open');
    assert.ok(!m.unlocked.zones.storm, 'but not the zone after it');
    assert.deepEqual(W.validate(m), []);
});

test('a sealed lair: a ward needs its key, the key is spent only when the guardian falls, the last ward opens the lair', () => {
    const s = W.freshState(NOW);
    s.unlocked.zones.coast = true;
    assert.equal(W.lairOpen(s, 'coast'), false);
    assert.equal(W.lairOpen(s, 'frost'), true, 'the first four zones have no wards');
    assert.deepEqual(W.wardState(s, 'coast', 0), { ok: false, reason: 'key', key: 'key_coast' });
    // the key comes from the Rune Altar
    Object.assign(s.mats, { tide_essence: 6, coral: 18, pearl: 3 });
    assert.equal(W.craftBasic(s, 'key_coast', 3), 3);
    assert.equal(W.count(s, 'key_coast'), 3);
    assert.equal(W.wardState(s, 'coast', 0).ok, true, 'waking it does not spend the key');
    assert.equal(W.count(s, 'key_coast'), 3);
    let r = W.breakWard(s, 'coast', 0);
    assert.deepEqual(r, { ok: true, lairOpen: false, broken: 1, of: 3 });
    assert.equal(W.count(s, 'key_coast'), 2);
    assert.deepEqual(W.breakWard(s, 'coast', 0), { ok: false, reason: 'broken', key: 'key_coast' }, 'a ward breaks once');
    assert.equal(W.breakWard(s, 'coast', 9).reason, 'unknown');
    W.breakWard(s, 'coast', 1);
    r = W.breakWard(s, 'coast', 2);
    assert.equal(r.lairOpen, true);
    assert.equal(W.lairOpen(s, 'coast'), true);
    assert.equal(W.count(s, 'key_coast'), 0);
    // keys are never lost on death and can't be sold
    assert.equal(D.MATERIALS_BY_ID.key_coast.kind, 'key');
    assert.equal(W.sell(s, 'sigil_coast', 1), 0);
});

test('broken wards survive a reload; junk in the save is dropped', () => {
    const s = W.freshState(NOW);
    s.seals = { coast: 5 };
    const raw = JSON.parse(JSON.stringify(s));
    raw.seals.storm = 99;  // more wards than the zone has: cut down to its 3
    raw.seals.frost = 1;   // no wards in Frostveil
    raw.seals.nowhere = 3;
    const m = W.migrate(raw, NOW);
    assert.deepEqual(m.seals, { coast: 5, storm: 7 });
    assert.equal(W.wardsBroken(m, 'coast'), 2);
    assert.deepEqual(W.validate(m), []);
});

test('ward quests count the zone\'s broken wards, so breaking one early never strands a quest', () => {
    const s = W.freshState(NOW);
    s.unlocked.zones.coast = true;
    s.seals.coast = 0b011; // two broken before the quest was taken
    s.quests.mara = { step: 4, active: null, dailyDone: '' };
    assert.equal(W.questOffer(s, 'mara', NOW).id, 'mara_seals');
    W.acceptQuest(s, 'mara', NOW);
    assert.deepEqual(W.questProgress(s, 'mara'), { have: 2, need: 3, done: false });
    s.seals.coast = 0b111;
    assert.deepEqual(W.questProgress(s, 'mara'), { have: 3, need: 3, done: true });
    const r = W.turnInQuest(s, 'mara', NOW);
    assert.equal(r.ok, true);
    assert.equal(r.rubies, D.QUESTS.mara_seals.rubies);
});

test('a crafting quest can ask for a gear tier', () => {
    const s = W.freshState(NOW);
    s.unlocked.zones.storm = true;
    s.quests.hilde = { step: D.NPCS.hilde.chain.indexOf('hilde_adamant'), active: null, dailyDone: '' };
    W.acceptQuest(s, 'hilde', NOW);
    W.questEvent(s, { kind: 'craft', score: 99, tier: 6 });
    assert.equal(W.questProgress(s, 'hilde').have, 0, 'Orichalcum is not Adamant');
    W.questEvent(s, { kind: 'craft', score: 40, tier: 7 });
    assert.equal(W.questProgress(s, 'hilde').done, true);
});

test('potions heal a share of max health once that is more than their flat amount', () => {
    assert.equal(W.potionHeal('potion_small', 100), 40);
    assert.equal(W.potionHeal('potion_small', 800), 120);
    assert.equal(W.potionHeal('potion_big', 200), 110);
    assert.equal(W.potionHeal('potion_big', 900), 315);
    assert.ok(W.potionHeal('potion_max', 900) >= 900);
    assert.equal(W.potionHeal('nothing', 900), 0);
});

test('the Far Reaches\' gear needs their alloys, and every Far Reaches material has somewhere to come from', () => {
    assert.deepEqual(D.GEAR_BY_ID.sword_6.recipe.in, { orichalcum_bar: 5, driftwood_plank: 2, crawler_shell: 2 });
    assert.equal(D.GEAR_BY_ID.chest_9.recipe.fee, 20000);
    for (const z of FAR) {
        const ids = new Set();
        for (const n in D.ZONES[z].nodes) D.NODES[n].drops.forEach(d => ids.add(d[0]));
        for (const [m] of D.ZONES[z].spawns) D.MONSTERS[m].drops.forEach(d => ids.add(d[0]));
        ids.add(D.ZONES[z].wardKey);
        for (const id of ids) assert.ok(W.materialSources(id).length, z + ': ' + id + ' has a source');
    }
});
