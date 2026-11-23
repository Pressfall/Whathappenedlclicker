'use strict';
// Fusing at the Crucible (core/world-fuse.js, core/world-logic.js canFuse / fuseRelics): five Wilds relics of one tier and
// kind fuse into one a tier higher or are all lost; what may go in, the odds (lower for rarer results, raised by essences,
// rubies and a Catalyst, never certain), the blueprint and Mythic limits, and what comes out.
const test = require('node:test');
const assert = require('node:assert/strict');
const D = require('../core/world-data');
const W = require('../core/world-logic');
const Fu = require('../core/world-fuse');
const R = require('../core/world-relics');
const Gr = require('../core/gear');

const NOW = new Date(2026, 10, 22, 12, 0, 0).getTime();
const seq = (...xs) => { let i = 0; return () => xs[i++ % xs.length]; };
const reload = (s) => W.migrate(JSON.parse(W.serialize(s)), NOW);
const LINES = [['might', 1.1], ['keen', 0.9], ['ward', 1], ['vigor', 1]];
// a Wilds relic of tier t on gear `base`, straight into the save
function relic(s, base, t, opts = {}) {
    const r = { t, l: (opts.l || LINES).slice(0, Gr.TIERS[t].lines), m: opts.m || ['flint_shard', 'sunstone'], c: ['#ff0000', '#00ff00'], q: opts.q || '', by: 'me', n: 0, lv: opts.lv || 0 };
    const it = W.addGear(s, base, opts.score === undefined ? 60 : opts.score, [], NOW, { r, k: opts.k });
    assert.ok(it && it.r, 'made a relic on ' + base);
    return it;
}
function rich(bp = 4) {
    const s = W.freshState(NOW);
    s.relics.bp = bp; s.rubies = 1e7;
    return s;
}
const five = (s, t, bases = ['sword_3', 'bow_4', 'dagger_3', 'sword_5', 'spear_3'], opts) => bases.map(b => relic(s, b, t, opts).uid);

test('the odds: lower the rarer the result, raised by essences, rubies and a Catalyst, never past the cap', () => {
    for (let t = 1; t < Fu.MAX_TARGET; t++) {
        assert.ok(Fu.BASE[t + 1] < Fu.BASE[t], 'a rarer result starts less likely');
        assert.ok(Fu.CAP[t + 1] <= Fu.CAP[t]);
    }
    for (let t = 1; t <= Fu.MAX_TARGET; t++) {
        assert.equal(Fu.chance(t, {}), Fu.BASE[t]);
        assert.ok(Fu.CAP[t] < 1, 'never certain');
        assert.equal(Fu.chance(t, { ess: Array(8).fill('heartstone'), steps: 99, catalyst: true }), Fu.CAP[t], 'everything fed in stops at the cap');
    }
    // each feed raises it: rarer essences more, and each counts less toward a rarer result
    assert.ok(Fu.chance(2, { ess: ['sunstone'] }) > Fu.chance(2, { ess: ['flint_shard'] }));
    assert.ok(Fu.essBoost('sunstone', 4) < Fu.essBoost('sunstone', 1));
    assert.ok(Math.abs(Fu.chance(3, { steps: 2 }) - (Fu.BASE[3] + 2 * Fu.FEED.step)) < 1e-9);
    assert.ok(Math.abs(Fu.chance(3, { catalyst: true }) - (Fu.BASE[3] + Fu.FEED.catalyst)) < 1e-9);
    assert.equal(Fu.chance(2, { ess: Array(20).fill('flint_shard') }), Fu.chance(2, { ess: Array(Fu.FEED.maxEss).fill('flint_shard') }), 'only maxEss essences count');
    assert.equal(Fu.chance(2, { ess: ['copper_bar', 'nonsense'] }), Fu.BASE[2], 'only essences count');
    // rubies: dearer for rarer results, by the step
    assert.equal(Fu.rubyCost(1, 1), Fu.FEED.stepCost * 4);
    assert.ok(Fu.rubyCost(4, 1) > Fu.rubyCost(3, 1));
    assert.equal(Fu.rubyCost(2, 3), 3 * Fu.rubyCost(2, 1));
    assert.equal(Fu.rubyCost(2, 99), Fu.FEED.steps * Fu.rubyCost(2, 1));
    // the roll
    assert.equal(Fu.roll(0.3, () => 0.29), true);
    assert.equal(Fu.roll(0.3, () => 0.3), false);
});

test('what may go in: five different relics of one tier and kind, no uniques, nothing worn, within your blueprints, never into Mythic', () => {
    const s = rich(4);
    const ok = five(s, 2);
    assert.deepEqual(Object.assign({}, W.canFuse(s, ok, {}), { items: undefined, mats: undefined }), { ok: true, tier: 2, target: 3, part: 'weapon', chance: Fu.BASE[3], rubies: 0, items: undefined, mats: undefined, steps: 0 });
    assert.equal(W.canFuse(s, ok.slice(0, 4), {}).reason, 'count');
    assert.equal(W.canFuse(s, [ok[0], ok[0], ok[1], ok[2], ok[3]], {}).reason, 'count', 'the same piece twice');
    assert.equal(W.canFuse(s, ok.slice(0, 4).concat(999999), {}).reason, 'unknown');
    // a plain piece, a unique, a worn piece
    const plain = W.addGear(s, 'sword_3', 60, [], NOW).uid;
    assert.equal(W.canFuse(s, ok.slice(0, 4).concat(plain), {}).reason, 'plain');
    const uniq = relic(s, 'sword_5', 4, { q: Gr.UNIQUES.find(u => u.kind === 'wilds' && u.cls === 'sword').id });
    assert.equal(uniq.r.q !== '', true, 'a real unique');
    assert.equal(Fu.check([uniq].concat(ok.slice(0, 4).map(u => W.findGear(s, u))), 4).reason, 'unique');
    W.equip(s, ok[0]);
    assert.equal(W.canFuse(s, ok, {}).reason, 'equipped');
    W.unequip(s, ok[0]);
    // weapons and armor don't mix (a shield is armor); one tier only
    const armor = ['helmet_3', 'chest_4', 'boots_3', 'shield_5', 'helmet_6'].map(b => relic(s, b, 2).uid);
    assert.equal(W.canFuse(s, armor, {}).part, 'armor');
    assert.equal(W.canFuse(s, armor, {}).ok, true);
    assert.equal(W.canFuse(s, ok.slice(0, 4).concat(armor[0]), {}).reason, 'kind');
    const other = relic(s, 'sword_3', 1).uid;
    assert.equal(W.canFuse(s, ok.slice(0, 4).concat(other), {}).reason, 'tier');
    // the limits: your blueprints, and never Mythic or Primordial
    const s2 = rich(2);
    assert.equal(W.canFuse(s2, five(s2, 2), {}).reason, 'blueprint', 'Rare into Epic needs the Epic blueprint');
    assert.equal(W.canFuse(s2, five(s2, 1), {}).ok, true, 'Uncommon into Rare needs none');
    const s3 = rich(6);
    assert.equal(W.canFuse(s3, five(s3, 4), {}).reason, 'top', 'Legendary into Mythic: never, whatever the blueprints');
    assert.equal(W.canFuse(s3, five(s3, 3), {}).ok, true, 'Epic into Legendary');
    // a tournament's lent kit
    const s4 = rich(4); const lent = five(s4, 1); s4.lent = { gear: [] };
    assert.equal(W.canFuse(s4, lent, {}).reason, 'lent');
});

test('feeding it: essences, rubies and a Catalyst are checked and spent, whether it fuses or not', () => {
    const s = rich(4), uids = five(s, 2);
    const feed = { ess: ['sunstone', 'sunstone', 'flint_shard'], steps: 3, catalyst: true };
    assert.equal(W.canFuse(s, uids, feed).reason, 'catalyst');
    s.mats.catalyst = 1;
    assert.equal(W.canFuse(s, uids, feed).reason, 'materials');
    s.mats.sunstone = 2; s.mats.flint_shard = 1;
    const c = W.canFuse(s, uids, feed);
    assert.equal(c.ok, true);
    assert.equal(c.rubies, Fu.rubyCost(3, 3));
    assert.equal(c.chance, Fu.chance(3, feed));
    s.rubies = c.rubies - 1;
    assert.equal(W.canFuse(s, uids, feed).reason, 'rubies');
    s.rubies = c.rubies;
    assert.equal(W.canFuse(s, uids, { ess: Array(Fu.FEED.maxEss + 1).fill('flint_shard') }).reason, 'feed');
    const r = W.fuseRelics(s, uids, feed, seq(0.999), NOW, 'me'); // a roll over any chance: it fails
    assert.equal(r.ok, true); assert.equal(r.fused, false);
    assert.equal(s.rubies, 0); assert.equal(W.count(s, 'sunstone'), 0); assert.equal(W.count(s, 'catalyst'), 0);
    assert.equal(uids.filter(u => W.findGear(s, u)).length, 0, 'all five are lost');
    assert.equal(s.relics.fuseTries, 1); assert.equal(s.relics.fused, 0);
});

test('a fusion that works: one relic a tier higher, of one of the five\'s kinds at their best gear tier, their average quality, their boosts', () => {
    const s = rich(4);
    const uids = five(s, 2, ['sword_3', 'bow_4', 'dagger_3', 'sword_5', 'spear_3'], { score: 70 });
    W.findGear(s, uids[1]).score = 90;
    const gear0 = s.gear.length;
    const r = W.fuseRelics(s, uids, {}, seq(0.01), NOW, 'Fuser');
    assert.equal(r.fused, true);
    assert.equal(s.gear.length, gear0 - 5 + 1);
    const it = W.findGear(s, r.item.uid);
    assert.equal(it.r.t, 3, 'Rare into Epic');
    assert.equal(D.GEAR_BY_ID[it.base].tier, 5, 'the best gear tier among the five');
    assert.ok(['sword', 'bow', 'dagger', 'spear'].includes(D.GEAR_BY_ID[it.base].cls), 'one of the five\'s kinds');
    assert.equal(it.score, Math.round((70 * 4 + 90) / 5), 'their average quality');
    assert.equal(it.r.l.length, Gr.TIERS[3].lines);
    assert.ok(it.r.l.every(([a]) => LINES.slice(0, 2).some(l => l[0] === a)), 'boosts drawn from the five\'s');
    assert.equal(it.r.q, ''); assert.equal(it.r.lv, 0); assert.equal(it.r.by, 'Fuser');
    assert.ok(it.r.m.length > 0 && it.r.m[0] === 'sunstone', 'its essences, the rarest first');
    assert.equal(s.relics.fused, 1); assert.equal(s.relics.best, 3);
    // kept in the save, and named as a relic of its tier
    const back = reload(s);
    assert.equal(W.findGear(back, it.uid).r.t, 3);
    assert.equal(back.relics.fused, 1); assert.equal(back.relics.fuseTries, 1);
    assert.match(W.gearName(it), /^Epic /);
});

test('a fused relic\'s boosts: the new tier\'s number of them, never the same twice, filled in when the five had too few', () => {
    const s = rich(4);
    // five Uncommon relics with one boost each, all Might: an Epic needs two, so one more comes at random
    const uids = five(s, 1, undefined, { l: [['might', 1]] });
    const out = Fu.result(uids.map(u => W.findGear(s, u)), seq(0.4, 0.7, 0.2));
    assert.equal(out.lines.length, Gr.TIERS[2].lines);
    assert.equal(out.lines[0][0], 'might');
    assert.equal(new Set(out.lines.map(l => l[0])).size, out.lines.length);
    for (const [, roll] of out.lines) assert.ok(roll >= Gr.ROLL.lo && roll <= Gr.ROLL.hi);
    // armor stays armor
    const armor = ['helmet_3', 'chest_3', 'boots_3', 'shield_3', 'helmet_3'].map(b => W.findGear(s, relic(s, b, 1).uid));
    for (let i = 0; i < 20; i++) assert.equal(Fu.partOf({ base: Fu.result(armor, seq(i / 20, 0.5)).base }), 'armor');
});

test('essences set in the five come back either way; gear for the game never goes in', () => {
    const s = rich(4);
    const k = [['sunstone', 6], ['flint_shard', 2]];
    const uids = five(s, 2, ['sword_3', 'bow_3', 'dagger_3', 'sword_3', 'spear_3'], { k, score: 92 });
    assert.ok(W.findGear(s, uids[0]).k.length >= 2, 'socketed');
    const r = W.fuseRelics(s, uids, {}, seq(0.999), NOW, '');
    assert.equal(r.fused, false);
    assert.equal(r.back.sunstone, 5); assert.equal(W.count(s, 'sunstone'), 5);
    assert.equal(W.count(s, 'flint_shard'), 5);
    // the satchel's pieces (gear for the game) are not Wilds gear: a satchel id names nothing in your gear
    s.satchel.push(Gr.cleanPiece({ id: 77, s: 'ring', t: 2, l: [['might', 1], ['keen', 1]], at: NOW }));
    assert.equal(W.canFuse(s, [77, 78, 79, 80, 81], {}).reason, 'unknown');
    assert.equal(Fu.partOf({ base: 'ring_copper' }), null, 'a ring is neither');
    assert.equal(Fu.partOf({ base: 'pickaxe_3' }), null, 'nor a tool');
});

test('the Crucible can\'t be used to reach past the forge: the most a fusion makes is Legendary, and only with that blueprint', () => {
    assert.equal(Fu.MAX_TARGET, 4);
    assert.equal(Gr.TIERS[Fu.MAX_TARGET].id, 'legendary');
    assert.ok(R.BLUEPRINT_BY_TIER[4], 'Legendary has a blueprint');
    for (let bp = R.BASE_MAX; bp <= Gr.MAX_TIER; bp++) {
        const s = rich(bp);
        for (let t = 0; t < Gr.MAX_TIER; t++) {
            const c = W.canFuse(s, five(s, t), {});
            assert.equal(c.ok, t + 1 <= Math.min(bp, Fu.MAX_TARGET), 'tier ' + t + ' with blueprints up to ' + bp);
            s.gear = s.gear.filter(it => !it.r);
        }
    }
});
