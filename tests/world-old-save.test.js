// A well-played Wilds save made by the code before the Rogue rework and the Hall of Gods (commit a2e7d87), loaded by
// today's code: nothing the player had is lost, old skills become their replacements, new things start fresh.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const D = require('../core/world-data');
const W = require('../core/world-logic');
const Gods = require('../core/world-gods');

const NOW = Date.UTC(2026, 9, 21, 9, 0, 0);
const raw = () => JSON.parse(fs.readFileSync(path.join(__dirname, 'fixtures/world-save-a2e7d87.json'), 'utf8'));

test('an old save loads whole: rubies, materials, gear, progress and where you stood', () => {
    const old = raw(), s = W.migrate(raw(), NOW);
    assert.deepEqual(W.validate(s), []);
    assert.equal(s.rubies, old.rubies);
    assert.deepEqual(s.mats, old.mats, 'banked materials');
    assert.deepEqual(s.bag, old.bag, 'carried materials');
    assert.deepEqual(s.gear.map(g => [g.uid, g.base, g.score, g.aff]), old.gear.map(g => [g.uid, g.base, g.score, g.aff]));
    assert.deepEqual(s.equip, old.equip);
    assert.deepEqual(s.hotbar, old.hotbar);
    assert.deepEqual(s.unlocked, old.unlocked);
    for (const b in old.bosses) assert.equal(s.bosses[b].kills, old.bosses[b].kills, b);
    for (const k in old.stats) assert.equal(s.stats[k], old.stats[k], 'stats.' + k);
    assert.equal(s.zone, 'ember');
    assert.deepEqual(s.pos, old.pos);
    assert.equal(s.hp, old.hp);
    assert.equal(s.cons.potion_small, old.cons.potion_small);
});

test('the old Rogue skills become the new ones, in the same places, and stay on their keys', () => {
    const s = W.migrate(raw(), NOW);
    const learned = Object.keys(s.skills.learned);
    for (const gone of ['blink', 'envenom', 'fan_of_knives', 'caltrops', 'quick_hands']) assert.ok(!learned.includes(gone), gone + ' is gone');
    for (const id of W.treeOrder('rogue')) assert.ok(s.skills.learned[id], id + ' is learned (the whole tree was)');
    assert.ok(s.skills.learned.whirlwind, "the Warrior's skill stays too");
    assert.equal(s.classes.active, 'rogue');
    W.setClass(s, 'rogue');
    assert.deepEqual(W.abilityKit(s), ['riposte', 'grapple', 'quick_cut'], 'Envenom, Blink and Fan of Knives were on the keys');
    // every learned skill has the one above it learned, so the tree reads right
    for (const id of learned) { const sk = D.ABILITIES[id] || D.PERKS[id]; if (sk.req) assert.ok(s.skills.learned[sk.req], id + ' needs ' + sk.req); }
    const ps = W.playerStats(s);
    assert.equal(ps.stunnedDmg, 1.4, 'Opportunist (was Quick Hands) works');
    assert.ok(ps.speed > 1 && Number.isFinite(ps.maxHp));
});

test('what is new since then starts fresh, and the save survives another round trip unchanged', () => {
    const s = W.migrate(raw(), NOW);
    assert.deepEqual(Gods.levelsFrom(s), Object.fromEntries(Gods.GOD_ORDER.map(id => [id, 0])), 'no statues raised yet');
    assert.equal(s.skin, null, 'wears the game\'s skin');
    assert.deepEqual(s.secrets, { hallDoor: false, autoClicker: false });
    assert.equal(s.inAck, 0);
    const again = W.migrate(JSON.parse(W.serialize(s, NOW, 0)), NOW);
    assert.deepEqual(again, s);
});
