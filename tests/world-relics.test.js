'use strict';
// The Crucible (core/world-relics.js, core/world-logic.js): the forge's odds and its caps, what each factor does, pity,
// uniques and their Hearts, colours from essences, relics and sockets surviving a save, forged fields dropped, infusing,
// combos and upgrades.
const test = require('node:test');
const assert = require('node:assert/strict');
const D = require('../core/world-data');
const W = require('../core/world-logic');
const R = require('../core/world-relics');
const Gr = require('../core/gear');

const NOW = new Date(2026, 10, 10, 12, 0, 0).getTime();
const seq = (...xs) => { let i = 0; return () => xs[i++ % xs.length]; };
const reload = (s) => W.migrate(JSON.parse(W.serialize(s)), NOW);
const top = (o) => o[4] + o[5] + o[6];
const C3 = ['flint_shard', 'flint_shard', 'quartz_dust'];
function rich(s) { for (const id of D.ESSENCE_IDS) s.mats[id] = 20; s.mats.catalyst = 3; s.rubies = 1e7; return s; }

test('the odds add up, and Mythic and Primordial never pass their caps whatever goes in', () => {
    const best = { ess: ['heartstone', 'chrono_shard', 'abyssal_core', 'starseed', 'heartstone', 'chrono_shard', 'abyssal_core', 'starseed'], score: 100, luck: 99, catalyst: true, pity: 999 };
    for (const o of [{ ess: C3 }, best, { ess: Array(8).fill('titan_ruby'), score: 100 }]) {
        const odds = R.forgeOdds(o);
        assert.equal(odds.length, Gr.TIERS.length);
        assert.ok(Math.abs(odds.reduce((a, b) => a + b, 0) - 1) < 1e-9);
        assert.ok(odds[5] <= R.FORGE.caps[5] + 1e-12 && odds[6] <= R.FORGE.caps[6] + 1e-12, 'capped: ' + odds[5] + ' ' + odds[6]);
    }
    assert.equal(R.forgeOdds(best)[0], 0, 'a Catalyst: never Common');
    // three common essences: almost never better than Rare
    assert.ok(top(R.forgeOdds({ ess: C3, score: 50 })) < 0.005, 'commons stay humble: Legendary or better under 1 in 200');
});

test('each factor raises the odds of the top tiers: rarer essences, more of them, the score, luck, Resonance, pity', () => {
    const base = { ess: ['garnet_chip', 'silver_mote', 'onyx_flake', 'tiger_eye'], score: 50 };
    const t0 = top(R.forgeOdds(base));
    assert.ok(top(R.forgeOdds(Object.assign({}, base, { ess: ['sunstone', 'quicksilver', 'mithril_bead', 'star_sapphire'] }))) > t0 * 2.5, 'rarer essences count most');
    assert.ok(top(R.forgeOdds(Object.assign({}, base, { ess: base.ess.concat(['bloodstone', 'gold_fleck']) }))) > t0, 'more essences');
    assert.ok(top(R.forgeOdds(Object.assign({}, base, { score: 100 }))) > t0, 'a better game');
    assert.ok(top(R.forgeOdds(Object.assign({}, base, { luck: 0.3 }))) > t0, 'luck');
    assert.ok(top(R.forgeOdds(Object.assign({}, base, { ess: ['garnet_chip', 'garnet_chip', 'garnet_chip', 'garnet_chip'] }))) > t0, 'Resonance (one aspect)');
    assert.ok(top(R.forgeOdds(Object.assign({}, base, { pity: 10 }))) > t0, 'pity');
    assert.equal(top(R.forgeOdds(Object.assign({}, base, { pity: 1000 }))), top(R.forgeOdds(Object.assign({}, base, { pity: R.FORGE.pityMax / R.FORGE.pityStep }))), 'pity has a cap');
    assert.ok(top(R.forgeOdds(Object.assign({}, base, { luck: 50 }))) === top(R.forgeOdds(Object.assign({}, base, { luck: R.FORGE.luckMax }))), 'luck has a cap');
    // each further essence counts a little less than the one before
    assert.ok(R.potency(['sunstone', 'sunstone']) < 2 * R.potency(['sunstone']));
    assert.equal(R.potency(['sunstone', 'flint_shard']), R.potency(['flint_shard', 'sunstone']), 'rarest first, whatever the order');
});

test('forging Wilds gear: a relic of your gear tier, its boosts from the aspects put in, its colours from the essences', () => {
    const s = rich(W.freshState(NOW));
    s.unlocked.zones.mines = true;
    const ids = ['sunstone', 'titan_ruby', 'magma_pearl', 'flint_shard'];
    const n = s.gear.length, fee = W.canForge(s, 'wilds', ids, false).fee;
    assert.equal(W.beginForge(s, 'wilds', ids, false, NOW, 'Tester').ok, true);
    assert.equal(s.mats.titan_ruby, 19, 'essences are taken when it starts');
    assert.equal(s.rubies, 1e7 - fee);
    const res = W.finishCraft(s, 90, Math.random, NOW, null);
    assert.equal(res.kind, 'relic');
    assert.equal(s.gear.length, n + 1);
    const it = res.item, b = W.baseOf(it);
    assert.ok(it.r && it.r.t === res.tier && it.r.by === 'Tester' && it.r.lv === 0);
    assert.equal(b.tier, W.relicGearTier(s), 'at your own gear tier');
    assert.deepEqual(it.r.m, ids);
    for (const [a] of it.r.l) assert.ok(['might', 'ember'].includes(a) || it.r.l.length > 2, 'boosts follow the aspects: ' + a);
    assert.deepEqual(it.r.c, R.colorsOf(ids));
    assert.equal(it.r.c[1], D.MATERIALS_BY_ID.titan_ruby.color.toLowerCase(), 'the trim: the rarest essence');
    assert.equal(s.relics.forged, 1);
    // stronger than the same piece without the relic
    const plain = { uid: 999, base: it.base, score: it.score, aff: it.aff, at: 0 };
    if (b.slot === 'weapon') assert.ok(W.gearStats(it).dmg > W.gearStats(plain).dmg);
    else if (b.slot !== 'offhand') assert.ok(W.gearStats(it).armor >= W.gearStats(plain).armor);
    // it survives a save and load, every field
    const back = reload(s).gear.find(g => g.uid === it.uid);
    assert.deepEqual(back.r, it.r);
});

test('forging gear for the game puts it in the Relic Satchel; quitting gives the essences back but not the fee', () => {
    const s = rich(W.freshState(NOW));
    W.beginForge(s, 'game', C3, false, NOW, 'Me');
    const res = W.finishCraft(s, 70, Math.random, NOW, null);
    assert.equal(res.target, 'game');
    assert.equal(s.satchel.length, 1);
    const p = s.satchel[0];
    assert.ok(Gr.SLOTS.includes(p.s) && p.l.length === Gr.TIERS[p.t].lines + (p.q ? 1 : 0));
    assert.deepEqual(reload(s).satchel, s.satchel, 'kept on reload');
    const before = s.mats.flint_shard, rubies = s.rubies;
    W.beginForge(s, 'game', C3, false, NOW, 'Me');
    W.abortCraft(s);
    assert.equal(s.mats.flint_shard, before, 'essences back');
    assert.ok(s.rubies < rubies, 'the fee is spent');
    // the satchel has room for so many
    s.satchel = Array.from({ length: W.SATCHEL_MAX }, (_, i) => Object.assign({}, p, { id: i + 10 }));
    assert.equal(W.canForge(s, 'game', C3, false).reason, 'full');
    assert.equal(W.canForge(s, 'wilds', C3, false).ok, true, 'Wilds gear still fits');
});

test('who may forge: 3 to 8 essences you have, a Catalyst you have, the fee', () => {
    const s = rich(W.freshState(NOW));
    assert.equal(W.canForge(s, 'game', ['flint_shard', 'flint_shard'], false).reason, 'count');
    assert.equal(W.canForge(s, 'game', Array(9).fill('flint_shard'), false).reason, 'count');
    assert.equal(W.canForge(s, 'game', ['flint_shard', 'oak_log', 'flint_shard'], false).reason, 'unknown', 'only essences');
    assert.equal(W.canForge(s, 'nope', C3, false).reason, 'unknown');
    s.mats.flint_shard = 1;
    assert.equal(W.canForge(s, 'game', C3, false).reason, 'materials');
    s.mats.flint_shard = 5; s.mats.catalyst = 0;
    assert.equal(W.canForge(s, 'game', C3, true).reason, 'catalyst');
    s.rubies = 0;
    assert.equal(W.canForge(s, 'game', C3, false).reason, 'rubies');
});

test('pity: each forge without a Legendary adds up, a Legendary or better resets it', () => {
    const s = rich(W.freshState(NOW));
    s.relics.bp = 6; // every blueprint
    for (let i = 0; i < 3; i++) { W.beginForge(s, 'game', C3, false, NOW, ''); W.finishCraft(s, 50, seq(0.999), NOW, null); }
    assert.equal(s.relics.pity, 3);
    W.beginForge(s, 'game', C3, false, NOW, '');
    W.finishCraft(s, 50, seq(0.0001), NOW, null); // the luckiest roll there is
    assert.ok(s.relics.best >= 4);
    assert.equal(s.relics.pity, 0);
    assert.equal(reload(s).relics.pity, 0);
});

test('uniques: only from a Legendary or better forge, and only with their dungeon\'s Heart among the essences', () => {
    for (const u of Gr.UNIQUES) {
        assert.ok(u.name && u.desc && u.shape && Gr.SHAPES[u.shape], u.id + ' has a name, words and its own shape');
        assert.ok(Gr.OUTLINES[u.outline], u.id + ' outline');
        assert.ok(u.sig.length >= 1 && u.sig.every(a => Gr.ASPECT_GAME[a]), u.id + ' sig');
        if (u.need) assert.equal(D.MATERIALS_BY_ID[u.need].kind, 'essence', u.id + ' needs ' + u.need);
        if (u.kind === 'wilds') assert.ok(R.baseIdFor(R.uniqueBase(u), 5), u.id + ' has a base');
    }
    assert.ok(Gr.UNIQUES.filter(u => u.kind === 'wilds').length >= 15 && Gr.UNIQUES.filter(u => u.kind === 'game').length >= 10);
    assert.deepEqual(R.uniquesFor('wilds', C3).map(u => u.id).sort(), Gr.UNIQUES.filter(u => u.kind === 'wilds' && !u.need).map(u => u.id).sort(), 'without a Heart: only those that need none');
    assert.ok(R.uniquesFor('wilds', ['heart_crypt', 'flint_shard', 'flint_shard']).some(u => u.id === 'wyrmtongue'));
    // the luckiest roll with the Crypt's Heart: a Legendary, and (on a low unique roll) a unique, its signature boosts first
    const res = R.forge({ kind: 'wilds', ess: ['heart_crypt', 'titan_ruby', 'titan_ruby'], score: 100, gearTier: 5 }, seq(0.0001, 0.0001, 0.5, 0.5, 0.5, 0.5));
    assert.ok(res.tier >= 4 && res.unique, 'a unique');
    assert.deepEqual(res.lines.slice(0, res.unique.sig.length).map(l => l[0]), res.unique.sig);
    assert.equal(res.lines.length, Gr.TIERS[res.tier].lines + 1, 'a unique has one boost more');
    assert.equal(R.forge({ kind: 'wilds', ess: C3, score: 100, gearTier: 5 }, seq(0.9)).unique, null, 'no unique below Legendary');
    // a unique on the wrong kind of base is not one after a reload
    assert.equal(R.cleanRelic({ t: 5, l: [['ember', 1]], q: 'wyrmtongue' }, 'bow_5').q, '');
    assert.equal(R.cleanRelic({ t: 2, l: [['ember', 1]], q: 'wyrmtongue' }, 'sword_5').q, '', 'nor below Legendary');
});

test('a forged or damaged relic is cleaned on load: no extra boosts, no made-up aspects, rolls and levels within bounds', () => {
    const s = W.freshState(NOW);
    s.gear.push({ uid: 50, base: 'sword_3', score: 80, aff: [], at: 0,
        r: { t: 9, l: [['might', 9], ['might', 2], ['godmode', 1], ['keen', 0.1], ['swift', 1], ['ward', 1], ['vigor', 1]], m: ['flint_shard', 'oak_log', 'x'], c: ['red', '#00ff00'], q: 'nope', by: '<script>', n: -4, lv: 99 },
        k: [['sunstone', 999], ['oak_log', 5], ['quartz_dust', 2], ['flint_shard', 1], ['flint_shard', 1]] });
    const it = reload(s).gear.find(g => g.uid === 50);
    assert.equal(it.r.t, Gr.MAX_TIER);
    assert.ok(it.r.l.length <= Gr.TIERS[Gr.MAX_TIER].lines, 'no extra boosts');
    assert.deepEqual(it.r.l.map(l => l[0]), ['might', 'keen', 'swift', 'ward'], 'no repeats, nothing made up');
    for (const [, r] of it.r.l) assert.ok(r >= Gr.ROLL.lo && r <= Gr.ROLL.hi);
    assert.deepEqual(it.r.m, ['flint_shard']);
    assert.match(it.r.c[0], /^#[0-9a-f]{6}$/);
    assert.equal(it.r.q, '');
    assert.equal(it.r.by, 'script');
    assert.equal(it.r.lv, Gr.MAX_LEVEL);
    assert.ok(it.k.length <= R.socketCount(it));
    assert.ok(it.k[0][1] <= R.SOCKET_VALUE[2] * 1.3, 'a socket\'s value is capped by its essence');
    assert.equal(it.k[1], null, 'not an essence');
    assert.equal(reload(Object.assign(W.freshState(NOW), { satchel: [{ s: 'hat', t: 1, l: [['might', 1]] }, 'x', null] })).satchel.length, 0);
});

test('infusing: an essence into a socket, sized by its rarity and the game; two aspects make a combo', () => {
    const s = rich(W.freshState(NOW));
    const it = W.addGear(s, 'sword_3', 95, [], NOW);
    assert.equal(R.socketCount(it), 3, 'Masterwork: three sockets');
    assert.equal(R.socketCount(W.addGear(s, 'sword_3', 20, [], NOW)), 1);
    assert.equal(W.beginInfuse(s, it.uid, 5, 'sunstone').reason, 'socket');
    assert.equal(W.beginInfuse(s, it.uid, 0, 'oak_log').reason, 'unknown');
    const dmg0 = W.gearStats(it).dmg;
    W.beginInfuse(s, it.uid, 0, 'sunstone');
    let r = W.finishCraft(s, 100, Math.random, NOW, null);
    assert.equal(r.value, R.socketValue('sunstone', 100));
    assert.ok(W.gearStats(it).dmg > dmg0, 'Might: more damage');
    W.beginInfuse(s, it.uid, 1, 'magma_pearl');
    r = W.finishCraft(s, 50, Math.random, NOW, null);
    assert.deepEqual(r.combos, ['Wildfire'], 'Might and Ember');
    assert.ok(W.gearStats(it).burn, 'Ember: it burns');
    assert.ok(R.socketValue('heartstone', 100) > R.socketValue('flint_shard', 100), 'rarer, more');
    assert.ok(R.socketValue('sunstone', 100) > R.socketValue('sunstone', 0), 'a better game, more');
    // replacing: the old one is gone, the new one in its place
    W.beginInfuse(s, it.uid, 0, 'flint_shard');
    W.finishCraft(s, 50, Math.random, NOW, null);
    assert.equal(it.k[0][0], 'flint_shard');
    assert.deepEqual(reload(s).gear.find(g => g.uid === it.uid).k, it.k, 'kept on reload');
});

test('upgrading a relic: +8% a level up to +5, paid in essences of its band and rubies', () => {
    const s = rich(W.freshState(NOW));
    s.satchel.push(Gr.cleanPiece({ id: 1, s: 'ring', t: 4, l: [['swift', 1], ['might', 1], ['ward', 1]], c: ['#ffffff', '#000000'] }));
    s.relics.nextPid = 2;
    const v0 = Gr.lineValues('swift', 4, 1, 0).cps;
    for (let i = 1; i <= Gr.MAX_LEVEL; i++) assert.equal(W.upgradeRelic(s, 'satchel', 1).lv, i);
    assert.equal(W.upgradeRelic(s, 'satchel', 1).reason, 'max');
    assert.ok(Math.abs(Gr.lineValues('swift', 4, 1, Gr.MAX_LEVEL).cps - v0 * (1 + Gr.LEVEL_STEP * Gr.MAX_LEVEL)) < 0.2);
    const t = W.freshState(NOW);
    t.satchel.push(Gr.cleanPiece({ id: 1, s: 'ring', t: 6, l: [['swift', 1]] }));
    t.rubies = 1e7;
    assert.equal(W.upgradeRelic(t, 'satchel', 1).reason, 'materials');
    assert.equal(W.upgradeRelic(t, 'gear', 12345).reason, 'unknown');
});

test('stone and the Crucible: essences show where they come from, and the Crucible is a station in town', () => {
    assert.ok(D.STATIONS.crucible);
    const G = require('../core/world-gen');
    assert.ok(G.generateZone('town').stations.some(st => st.id === 'crucible'));
    for (const id of D.ESSENCE_IDS) assert.ok(W.materialSources(id).length > 0, id + ' comes from somewhere');
    assert.ok(W.materialSources('catalyst').length > 0);
});

test('weapon or armor: the forge makes the kind you chose, and only uniques of that kind', () => {
    const isWeapon = (id) => D.GEAR_BY_ID[id].slot === 'weapon';
    for (let i = 0; i < 300; i++) {
        const r = Math.random;
        assert.ok(isWeapon(R.forge({ kind: 'wilds', part: 'weapon', ess: C3, score: 50, gearTier: 3 }, r).base), 'a weapon');
        assert.ok(!isWeapon(R.forge({ kind: 'wilds', part: 'armor', ess: C3, score: 50, gearTier: 3 }, r).base), 'armor');
    }
    const hearts = D.ESSENCE_IDS.filter(id => /^heart_/.test(id));
    assert.ok(R.uniquesFor('wilds', hearts, 'weapon').every(u => u.cls) && R.uniquesFor('wilds', hearts, 'weapon').length);
    assert.ok(R.uniquesFor('wilds', hearts, 'armor').every(u => !u.cls) && R.uniquesFor('wilds', hearts, 'armor').length);
    // through the save: an armor forge lands an armor piece in the backpack
    const s = rich(W.freshState(NOW));
    assert.equal(W.canForge(s, 'shield', C3, false).reason, 'unknown');
    assert.equal(W.beginForge(s, 'armor', C3, false, NOW, '').ok, true);
    const res = W.finishCraft(s, 60, Math.random, NOW, null);
    assert.ok(res.item && !isWeapon(res.item.base));
});

test('blueprints: without any the forge stops at Rare; each one, bought in order and for good, opens the next tier', () => {
    assert.equal(R.BASE_MAX, 2);
    assert.deepEqual(R.BLUEPRINTS.map(b => [b.tier, b.rubies ? 'rubies' : 'glory']), [[3, 'rubies'], [4, 'rubies'], [5, 'glory'], [6, 'glory']]);
    // the odds: whatever is above the cap comes out as the cap, so they still add up to 1
    const strong = { ess: ['heart_roots', 'heart_deep', 'heart_crypt', 'heart_tomb'], score: 100, luck: 0.5, catalyst: true, pity: 50 };
    const free = R.forgeOdds(Object.assign({ maxTier: 2 }, strong)), all = R.forgeOdds(strong);
    assert.ok(Math.abs(free.reduce((a, b) => a + b, 0) - 1) < 1e-9);
    assert.deepEqual(free.slice(3), [0, 0, 0, 0]);
    assert.ok(Math.abs(free[2] - all.slice(2).reduce((a, b) => a + b, 0)) < 1e-9);
    // a new player forges the luckiest roll there is and gets a Rare
    const s = rich(W.freshState(NOW));
    assert.equal(s.relics.bp, 2);
    W.beginForge(s, 'weapon', ['heart_roots', 'heart_deep', 'heart_crypt'], true, NOW, '');
    assert.equal(W.finishCraft(s, 100, seq(0.0001), NOW, null).tier, 2);
    // buying: in order, rubies for Epic and Legendary, Glory for Mythic and Primordial
    s.rubies = 0; s.arena.glory = 0;
    assert.equal(W.buyBlueprint(s, 4).reason, 'order');
    assert.equal(W.buyBlueprint(s, 3).reason, 'rubies');
    s.rubies = 20000;
    assert.equal(W.buyBlueprint(s, 3).ok, true);
    assert.equal(s.rubies, 0);
    assert.equal(W.buyBlueprint(s, 3).reason, 'owned');
    s.rubies = 75000; W.buyBlueprint(s, 4);
    assert.equal(W.buyBlueprint(s, 5).reason, 'glory');
    s.arena.glory = 12000; assert.equal(W.buyBlueprint(s, 5).ok, true); assert.equal(s.arena.glory, 0);
    assert.equal(W.nextBlueprint(s).tier, 6);
    assert.equal(reload(s).relics.bp, 5, 'kept in the save');
    s.rubies = 1e7;
    W.beginForge(s, 'weapon', ['heart_roots', 'heart_deep', 'heart_crypt'], true, NOW, '');
    assert.ok(W.finishCraft(s, 100, seq(0.0001), NOW, null).tier >= 4, 'now the same roll is Legendary or better');
});

test('blueprints: a save from before them keeps every tier it has already forged', () => {
    assert.equal(W.migrate({ relics: { best: -1 } }, NOW).relics.bp, 2);
    assert.equal(W.migrate({ relics: { best: 4 } }, NOW).relics.bp, 4);
    assert.equal(W.migrate({ relics: { best: 6, bp: 3 } }, NOW).relics.bp, 3, 'a saved bp is kept as it is');
    assert.equal(W.migrate({ relics: { bp: 99 } }, NOW).relics.bp, 6);
});
