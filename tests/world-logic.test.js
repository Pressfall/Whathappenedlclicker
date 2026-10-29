'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const D = require('../core/world-data');
const W = require('../core/world-logic');
const Bridge = require('../core/world-bridge');

const NOW = new Date(2026, 9, 27, 12, 0, 0).getTime(); // a Tuesday
const DAY = 86400000;
const rngOf = (v) => () => v;
function seeded(seed = 1) { let a = seed; return () => { a = (a * 16807) % 2147483647; return (a - 1) / 2147483646; }; }

test('a fresh state is sound and starts with the rusty kit on the hotbar', () => {
    const s = W.freshState(NOW);
    assert.deepEqual(W.validate(s), []);
    assert.deepEqual(s.hotbar.slice(0, 3).map(u => W.findGear(s, u).base), D.STARTER_KIT);
    assert.equal(s.cons.potion_small, 3);
});

test('migrate turns anything into a sound state', () => {
    for (const raw of [null, 'x', 42, [], { v: 0 }, { v: 99, rubies: -5, mats: { oak_log: 'lots', fiber: 3.7 }, gear: 'no' }]) {
        const s = W.migrate(raw, NOW);
        assert.deepEqual(W.validate(s), [], JSON.stringify(raw));
        assert.ok(s.gear.length >= 3, 'starter kit restored');
    }
    const s = W.migrate({ v: 1, rubies: 12.9, mats: { fiber: 3.7, renamed_thing: 2, bad: -1 }, gear: [{ uid: 5, base: 'sword_2', score: 150, aff: ['keen', 'nope'] }, { uid: 5, base: 'sword_1' }, { uid: 6, base: 'gone_item' }], hotbar: [5, 5, 99], equip: { helmet: 5 } }, NOW);
    assert.equal(s.rubies, 12);
    assert.deepEqual(s.mats, { fiber: 3, renamed_thing: 2 }, 'unknown ids are kept, junk dropped');
    assert.equal(s.gear[0].score, 100);
    assert.deepEqual(s.gear[0].aff, ['keen']);
    assert.equal(s.stats.lostGear, 1);
    assert.equal(s.hotbar[0], 5);
    assert.equal(s.hotbar[1], null, 'no duplicates on the hotbar');
    assert.equal(s.equip.helmet, null, 'a sword is not a helmet');
    assert.ok(s.nextUid > 5);
});

test('round trip through serialize keeps everything', () => {
    const s = W.freshState(NOW);
    W.give(s, 'oak_log', 5, false);
    W.addRubies(s, 30);
    const again = W.migrate(JSON.parse(W.serialize(s, NOW, 0)), NOW);
    assert.deepEqual(again.bag, { oak_log: 5 });
    assert.equal(again.rubies, 30);
    assert.deepEqual(again.hotbar, s.hotbar);
});

test('inventory: carried materials go in the bag until town; taking is all or nothing', () => {
    const s = W.freshState(NOW);
    W.give(s, 'copper_ore', 4, false);
    W.give(s, 'copper_ore', 1, true);
    assert.equal(W.count(s, 'copper_ore'), 5);
    assert.equal(W.take(s, { copper_ore: 6 }), false);
    assert.equal(W.count(s, 'copper_ore'), 5);
    assert.equal(W.take(s, { copper_ore: 2 }), true);
    assert.deepEqual(s.mats, {}, 'banked first');
    assert.deepEqual(s.bag, { copper_ore: 3 });
    W.bank(s);
    assert.deepEqual(s.mats, { copper_ore: 3 });
    assert.deepEqual(s.bag, {});
    W.give(s, 'sigil_greenwood', 1, false);
    assert.equal(s.mats.sigil_greenwood, 1, 'keys are never at risk');
});

test('crafting takes materials and fee up front; quitting refunds materials but not the fee', () => {
    const s = W.freshState(NOW);
    W.giveAll(s, { copper_bar: 3, oak_plank: 1 }, true);
    W.addRubies(s, 50);
    assert.equal(W.canCraft(s, 'gear', 'sword_1', NOW).ok, true);
    const b = W.beginCraft(s, 'gear', 'sword_1', NOW);
    assert.equal(b.ok, true);
    assert.equal(s.rubies, 30);
    assert.equal(W.count(s, 'copper_bar'), 0);
    assert.equal(W.beginCraft(s, 'gear', 'sword_1', NOW).reason, 'busy');
    // the page reloads mid-minigame: the pending craft survives in the save and is refunded
    const again = W.migrate(JSON.parse(W.serialize(s, NOW, 0)), NOW);
    assert.ok(again.pendingCraft);
    W.abortCraft(again);
    assert.equal(W.count(again, 'copper_bar'), 3);
    assert.equal(again.rubies, 30);
});

test('a craft makes gear whose stats grow with the minigame score', () => {
    const make = (score) => {
        const s = W.freshState(NOW);
        W.giveAll(s, { copper_bar: 3, oak_plank: 1 }, true);
        W.addRubies(s, 20);
        W.beginCraft(s, 'gear', 'sword_1', NOW);
        return W.finishCraft(s, score, rngOf(0.99), NOW, 0).item;
    };
    const crude = W.gearStats(make(10)), fine = W.gearStats(make(60)), legend = make(99);
    assert.ok(crude.dmg < 12 && fine.dmg > 12);
    assert.ok(W.gearStats(legend).dmg > fine.dmg);
    assert.equal(W.qualityOf(legend.score).id, 'legendary');
    assert.equal(legend.aff.length, 1, 'legendary always rolls an affix');
});

test('reforging keeps the better score', () => {
    const s = W.freshState(NOW);
    W.giveAll(s, { copper_bar: 9, oak_plank: 3 }, true);
    W.addRubies(s, 100);
    W.beginCraft(s, 'gear', 'sword_1', NOW);
    const it = W.finishCraft(s, 50, rngOf(0.99), NOW, 0).item;
    assert.equal(W.beginReforge(s, it.uid, NOW).ok, true);
    assert.equal(W.finishCraft(s, 30, rngOf(0.99), NOW, 0).improved, false);
    assert.equal(it.score, 50);
    W.beginReforge(s, it.uid, NOW);
    assert.equal(W.finishCraft(s, 80, rngOf(0.99), NOW, 0).improved, true);
    assert.equal(it.score, 80);
});

test('instant recipes and salvaging', () => {
    const s = W.freshState(NOW);
    W.giveAll(s, { copper_ore: 5, coal: 3 }, true);
    assert.equal(W.craftBasic(s, 'copper_bar', 5), 2);
    assert.equal(W.count(s, 'copper_bar'), 2);
    assert.equal(W.count(s, 'copper_ore'), 1);
    const sword = W.addGear(s, 'sword_1', 50, [], NOW);
    const back = W.salvage(s, sword.uid);
    assert.deepEqual(back, { copper_bar: 1 });
    // the last weapon can't go
    for (const g of s.gear.slice()) if (W.baseOf(g).slot === 'weapon' && s.gear.filter(x => W.baseOf(x).slot === 'weapon').length > 1) W.salvage(s, g.uid);
    assert.equal(W.salvage(s, s.gear.find(g => W.baseOf(g).slot === 'weapon').uid), null);
});

test('equipping armor and rings changes the player stats; equipping again takes it off', () => {
    const s = W.freshState(NOW);
    const helm = W.addGear(s, 'helmet_2', 30, [], NOW);
    const boots = W.addGear(s, 'boots_1', 30, [], NOW);
    const ring = W.addGear(s, 'ring_ruby', 30, [], NOW);
    const base = W.playerStats(s);
    W.equip(s, helm.uid); W.equip(s, boots.uid); W.equip(s, ring.uid);
    const st = W.playerStats(s);
    assert.ok(st.armor > base.armor && st.maxHp > base.maxHp && st.speed > 1);
    assert.equal(st.rubies, 0.2);
    W.equip(s, helm.uid);
    assert.equal(s.equip.helmet, null);
});

test('tools: the right tool of a high enough tier works a node; better tools work it faster', () => {
    const s = W.freshState(NOW);
    const rustyPick = s.gear.find(g => g.base === 'pickaxe_0');
    assert.ok(W.toolPower(rustyPick, D.NODES.copper) > 0);
    assert.equal(W.toolPower(rustyPick, D.NODES.iron), 0, 'iron needs a copper pickaxe');
    assert.equal(W.toolPower(rustyPick, D.NODES.tree_oak), 0, 'a pickaxe does not chop');
    const copperPick = W.addGear(s, 'pickaxe_1', 50, [], NOW);
    assert.ok(W.toolPower(copperPick, D.NODES.copper) > W.toolPower(rustyPick, D.NODES.copper));
    assert.equal(W.toolPower(rustyPick, D.NODES.herb), 1, 'anything picks herbs');
});

test('calendar keys: local days, ISO weeks across the new year', () => {
    assert.equal(W.dayKey(NOW), '2026-10-27');
    assert.equal(W.weekKey(new Date(2026, 0, 1).getTime()), '2026-W01');
    assert.equal(W.weekKey(new Date(2027, 0, 1).getTime()), '2026-W53');
    assert.equal(W.weekKey(new Date(2027, 0, 4).getTime()), '2027-W01');
    assert.equal(W.weekKey(new Date(2026, 9, 26).getTime()), W.weekKey(new Date(2026, 10, 1).getTime()), 'Monday to Sunday');
    assert.notEqual(W.weekKey(new Date(2026, 10, 1).getTime()), W.weekKey(new Date(2026, 10, 2).getTime()));
});

test('gems are capped per day; past the cap they pay rubies; the cap resets tomorrow', () => {
    const s = W.freshState(NOW);
    let sent = 0;
    for (let i = 0; i < 20; i++) sent += W.grantGems(s, 1, NOW, 'test', 0).gems;
    assert.equal(sent, D.CAPS.gemsPerDay);
    assert.equal(s.rubies, (20 - D.CAPS.gemsPerDay) * D.CAPS.overCapRubies.gem);
    assert.equal(Bridge.pending({ getItem: (k) => (k === Bridge.WORLD_KEY ? JSON.stringify(s) : null) }).totals.gems, D.CAPS.gemsPerDay);
    assert.equal(W.grantGems(s, 1, NOW + DAY, 'test', 0).gems, 1);
    assert.equal(W.grantGolden(s, 3, NOW, 'test', 0).golden, D.CAPS.goldenPerDay);
});

test('crafted lootboxes use the weekly allowance, which is held during the craft and given back on quitting', () => {
    const s = W.freshState(NOW);
    W.addRubies(s, 100000);
    W.giveAll(s, { oak_plank: 1000, fiber: 1000, iron_bar: 200, golem_core: 100 }, true);
    let made = 0;
    while (W.canCraft(s, 'box', 'box_iron', NOW).ok) { W.beginCraft(s, 'box', 'box_iron', NOW); W.finishCraft(s, 50, rngOf(0.5), NOW, 0); made++; }
    assert.equal(made, 20, '60 points / 3');
    assert.equal(W.canCraft(s, 'box', 'box_wood', NOW).reason, 'allowance');
    const next = NOW + 7 * DAY;
    assert.equal(W.boxAllowanceLeft(s, next), D.CAPS.boxPointsPerWeek);
    W.beginCraft(s, 'box', 'box_iron', next);
    assert.equal(W.boxAllowanceLeft(s, next), 57);
    W.abortCraft(s);
    assert.equal(W.boxAllowanceLeft(s, next), 60);
});

test('box crafting sends the box home through the outbox, at a tier shifted by the score', () => {
    const s = W.freshState(NOW);
    W.addRubies(s, 1000);
    W.giveAll(s, { oak_plank: 16, fiber: 8 }, true);
    W.beginCraft(s, 'box', 'box_wood', NOW);
    assert.equal(W.finishCraft(s, 99, rngOf(0.1), NOW, 0).tier, 1);
    W.beginCraft(s, 'box', 'box_wood', NOW);
    assert.equal(W.finishCraft(s, 10, rngOf(0.1), NOW, 0).tier, 0, 'never below wooden');
    assert.deepEqual(s.outbox.map(e => e.boxes), [[0, 1, 0, 0, 0], [1, 0, 0, 0, 0]]);
});

test('worst-case weekly gems and Golden from the Wilds stay within the caps', () => {
    const s = W.freshState(NOW);
    const rng = seeded(7);
    W.addRubies(s, 1e6);
    let gems = 0, golden = 0;
    for (let day = 0; day < 7; day++) {
        const t = NOW + day * DAY;
        for (let k = 0; k < 50; k++) {
            for (const b of Object.keys(D.BOSSES)) { s.bosses[b] = s.bosses[b] || { kills: 1 }; s.bosses[b].lastKillDay = ''; const r = W.bossLoot(s, b, rng, t, 0); gems += r.gems; golden += r.golden; }
            gems += W.monsterLoot(s, 'mossback', rng, t).gems;
            gems += W.nodeLoot(s, 'ruby_vein', rng, t).gems;
        }
        W.exchange(s, 'gems', t, 0); W.exchange(s, 'golden', t, 0);
    }
    const sent = s.outbox.reduce((a, e) => ({ gems: a.gems + e.gems, golden: a.golden + e.golden }), { gems: 0, golden: 0 });
    assert.ok(sent.gems <= 7 * D.CAPS.gemsPerDay, 'gems ' + sent.gems);
    assert.ok(sent.golden <= 7 * D.CAPS.goldenPerDay, 'golden ' + sent.golden);
});

test('bosses: the first kill of the day pays the most, drops the sigil once, and opens the next zone', () => {
    const s = W.freshState(NOW);
    const r1 = W.bossLoot(s, 'overgrown', rngOf(0.01), NOW, 0);
    assert.equal(r1.firstToday, true);
    assert.equal(r1.rubies >= D.BOSSES.overgrown.rubiesFirst, true);
    assert.equal(W.count(s, 'sigil_greenwood'), 1);
    assert.equal(s.unlocked.zones.mines, true);
    const r2 = W.bossLoot(s, 'overgrown', rngOf(0.01), NOW + 1000, 0);
    assert.equal(r2.firstToday, false);
    assert.equal(r2.gems, 0);
    assert.equal(W.count(s, 'sigil_greenwood'), 1, 'one sigil is enough');
    const f = W.freshState(NOW);
    assert.equal(W.bossLoot(f, 'frozen', rngOf(0.5), NOW, 0).mythic, true);
    assert.equal(W.bossLoot(f, 'frozen', rngOf(0.5), NOW + DAY, 0).mythic, false, 'one Mythic Vault a week');
});

test('death drops 30% of each carried stack (rounded down) where you fell; it can be picked up once', () => {
    const s = W.freshState(NOW);
    W.giveAll(s, { iron_ore: 10, coal: 3, fiber: 1 }, false);
    W.give(s, 'stone', 50, true);
    const drop = W.die(s, 'mines', 100, 200, NOW);
    assert.deepEqual(drop, { iron_ore: 3 });
    assert.deepEqual(s.bag, { iron_ore: 7, coal: 3, fiber: 1 });
    assert.equal(s.mats.stone, 50, 'banked materials are safe');
    assert.equal(s.zone, 'town');
    W.recoverGrave(s);
    assert.equal(W.count(s, 'iron_ore'), 10);
    assert.equal(s.grave, null);
    assert.equal(W.recoverGrave(s), null);
});

test('trader: selling, buying and once-a-week exchanges', () => {
    const s = W.freshState(NOW);
    assert.equal(W.buy(s, 'potion_small', NOW).reason, 'rubies');
    W.give(s, 'iron_ore', 4, true);
    assert.equal(W.sell(s, 'iron_ore', 10), 4 * D.MATERIALS_BY_ID.iron_ore.sell);
    assert.equal(W.sell(s, 'sigil_greenwood', 1), 0);
    s.rubies = 20000;
    assert.equal(W.buy(s, 'arrows', NOW).ok, true);
    assert.equal(s.cons.arrow, 20);
    assert.equal(W.exchange(s, 'gems', NOW, 0).ok, true);
    assert.equal(W.exchange(s, 'gems', NOW, 0).reason, 'week');
    assert.equal(W.exchange(s, 'golden', NOW, 0).ok, true);
    assert.equal(W.exchange(s, 'gems', NOW + 7 * DAY, 0).ok, true);
});

test('rivals pay rubies, drop their weapon on the first defeat, and come back later', () => {
    const s = W.freshState(NOW);
    const r = W.rivalLoot(s, 'greenwood', rngOf(0.99), NOW);
    assert.ok(r.item && W.baseOf(r.item).cls === 'sword');
    assert.equal(r.rubies, D.RIVAL_TIERS.greenwood.rubies * 2);
    assert.equal(s.rivals.greenwood.respawnAt, NOW + D.RIVAL_RESPAWN_SEC * 1000);
});

test('long node respawns are saved and expire', () => {
    const s = W.freshState(NOW);
    W.noteNode(s, 'mines:3', 600, NOW);
    W.noteNode(s, 'mines:4', 60, NOW);
    assert.deepEqual(Object.keys(s.nodes), ['mines:3']);
    W.pruneNodes(s, NOW + 601000);
    assert.deepEqual(s.nodes, {});
});

test('a full save stays small', () => {
    const s = W.freshState(NOW);
    for (const m of D.MATERIALS) W.give(s, m.id, 999, true);
    while (s.gear.length < D.RULES.maxGear) W.addGear(s, 'sword_5', 99, ['keen', 'swift'], NOW);
    for (let i = 0; i < Bridge.MAX_OUTBOX; i++) Bridge.push(s, { gems: 1, boxes: [1, 1, 1, 1, 1], src: 'test' }, 0, NOW);
    const size = W.serialize(s, NOW, 0).length;
    assert.ok(size < 60000, size + ' bytes');
});

const beat = (s, ...ids) => { for (const id of ids) s.bosses[id] = { kills: 1, lastKillDay: '', lastKillWeek: '', mythicWeek: '' }; };

test('skill trees: you start as a Warrior with an empty loadout, and learn skills from the top of a branch down', () => {
    const s = W.freshState(NOW);
    assert.equal(s.classes.active, 'warrior');
    assert.deepEqual(Object.keys(s.classes.unlocked), ['warrior']);
    assert.deepEqual(W.abilityKit(s), [null, null, null]);
    s.rubies = 5000;
    assert.deepEqual(W.learnSkill(s, 'whirlwind'), { ok: true, slot: 0 }, 'a new ability goes on the first free key');
    assert.deepEqual(W.abilityKit(s), ['whirlwind', null, null]);
    assert.equal(s.rubies, 5000 - D.ABILITIES.whirlwind.cost);
    assert.equal(W.learnSkill(s, 'whirlwind').reason, 'known');
    assert.deepEqual(W.learnSkill(s, 'deep_cuts'), { ok: false, reason: 'req', need: 'execute' });
    assert.equal(W.learnSkill(s, 'shockwave').need, 'thick_skin', 'the skill above comes first');
    assert.deepEqual(W.learnSkill(s, 'honed_edge'), { ok: true, slot: -1 }, 'a perk never goes on a key');
    assert.equal(W.learnSkill(s, 'execute').reason, 'boss');
    beat(s, 'overgrown');
    assert.ok(W.learnSkill(s, 'execute').ok);
    assert.deepEqual(W.abilityKit(s), ['whirlwind', 'execute', null]);
    assert.equal(W.learnSkill(s, 'grapple').reason, 'class', "another class's skill needs that class");
    assert.equal(W.learnSkill(s, 'nope').reason, 'unknown');
    s.rubies = 1;
    assert.equal(W.learnSkill(s, 'war_cry').reason, 'rubies');
    assert.deepEqual(W.validate(s), []);
});

test('loadout: up to three abilities on R Q C; equipping swaps keys and perks or unlearned abilities never go on', () => {
    const s = W.freshState(NOW);
    s.rubies = 99999;
    beat(s, 'overgrown', 'inferno');
    for (const id of ['whirlwind', 'war_cry', 'honed_edge', 'execute', 'bloodthirst']) assert.ok(W.learnSkill(s, id).ok, id);
    assert.deepEqual(W.abilityKit(s), ['whirlwind', 'war_cry', 'execute']);
    assert.deepEqual(W.learnSkill(s, 'berserk'), { ok: true, slot: -1 }, 'a full loadout stays as it is');
    assert.deepEqual(W.equipAbility(s, 'berserk', 1), { ok: true, fresh: true });
    assert.deepEqual(W.abilityKit(s), ['whirlwind', 'berserk', 'execute']);
    assert.deepEqual(W.equipAbility(s, 'whirlwind', 1), { ok: true, fresh: false }, 'moving to another key swaps');
    assert.deepEqual(W.abilityKit(s), ['berserk', 'whirlwind', 'execute']);
    assert.equal(W.equipAbility(s, 'honed_edge', 0).ok, false);
    assert.equal(W.equipAbility(s, 'earthsplitter', 0).ok, false);
    assert.equal(W.equipAbility(s, 'berserk', 3).ok, false);
    assert.ok(W.unequipAbility(s, 'warrior', 2));
    assert.equal(W.unequipAbility(s, 'warrior', 2), false);
    assert.deepEqual(W.abilityKit(s), ['berserk', 'whirlwind', null]);
    assert.deepEqual(W.validate(s), []);
});

test('classes: a challenge, then rubies, unlock a class; each class keeps its own loadout and perks', () => {
    const s = W.freshState(NOW);
    s.rubies = 5000;
    let r = W.classState(s, 'guardian');
    assert.equal(r.reason, 'req');
    assert.deepEqual(r.progress, { have: 0, need: 25, done: false });
    s.stats.blocks = 24;
    assert.equal(W.unlockClass(s, 'guardian').reason, 'req');
    s.stats.blocks = 99;
    assert.deepEqual(W.classProgress(s, 'guardian'), { have: 25, need: 25, done: true }, 'progress is capped at the goal');
    s.rubies = 10;
    assert.equal(W.unlockClass(s, 'guardian').reason, 'rubies');
    s.rubies = 5000;
    assert.ok(W.unlockClass(s, 'guardian').ok);
    assert.equal(s.rubies, 5000 - D.CLASSES.guardian.cost);
    assert.equal(W.unlockClass(s, 'guardian').reason, 'known');
    assert.equal(s.classes.active, 'warrior', 'unlocking does not switch');
    assert.equal(W.setClass(s, 'rogue'), false, 'locked');
    W.learnSkill(s, 'whirlwind');
    const before = W.playerStats(s);
    assert.ok(W.setClass(s, 'guardian'));
    const after = W.playerStats(s);
    assert.equal(after.maxHp, before.maxHp - 10 + 15);
    assert.equal(after.armor, before.armor + 4);
    assert.deepEqual(after.dmgBy, {}, 'the Warrior sword bonus is gone');
    assert.deepEqual(W.abilityKit(s), [null, null, null], "the Guardian's own loadout");
    assert.ok(W.learnSkill(s, 'shield_slam').ok);
    assert.ok(W.learnSkill(s, 'steady_guard').ok);
    assert.equal(W.playerStats(s).blockStam, 0.65);
    assert.deepEqual(W.abilityKit(s), ['shield_slam', null, null]);
    W.setClass(s, 'warrior');
    assert.deepEqual(W.abilityKit(s), ['whirlwind', null, null], 'switching back brings the Warrior loadout back');
    assert.equal(W.playerStats(s).blockStam, 1, 'Guardian perks only count while you are a Guardian');
    assert.deepEqual(W.validate(s), []);
});

test('classes: the Mystic unlocks by beating The Overgrown, the Lancer with charging spear thrusts', () => {
    const s = W.freshState(NOW);
    s.rubies = 9000;
    assert.equal(W.unlockClass(s, 'mystic').reason, 'req');
    beat(s, 'overgrown');
    assert.ok(W.unlockClass(s, 'mystic').ok);
    W.setClass(s, 'mystic');
    let ps = W.playerStats(s);
    assert.equal(ps.abilityCd, 0.9);
    assert.equal(ps.abilityDmg, 1.15);
    W.learnSkill(s, 'chain_lightning'); W.learnSkill(s, 'conduit');
    assert.ok(Math.abs(W.playerStats(s).abilityCd - 0.9 * 0.85) < 1e-9, 'multipliers stack');
    assert.equal(W.classState(s, 'lancer').reason, 'req');
    s.stats.rushHits = 20;
    assert.ok(W.unlockClass(s, 'lancer').ok);
    W.setClass(s, 'lancer');
    ps = W.playerStats(s);
    assert.equal(ps.momentum, 0.2);
    assert.equal(ps.dmgBy.spear, 1.15);
    W.learnSkill(s, 'lunge'); W.learnSkill(s, 'gathering_speed'); W.learnSkill(s, 'javelin'); W.learnSkill(s, 'skewer');
    ps = W.playerStats(s);
    assert.ok(Math.abs(ps.momentum - 0.5) < 1e-9);
    assert.equal(ps.pierce, 1);
    assert.deepEqual(W.abilityKit(s), ['lunge', 'javelin', null]);
});

test('perks add up with the class bonus, and the extremes are capped', () => {
    const s = W.freshState(NOW);
    s.rubies = 99999; s.stats.backstabs = 10;
    beat(s, 'overgrown', 'gilded', 'inferno', 'frozen');
    W.unlockClass(s, 'rogue'); W.setClass(s, 'rogue');
    for (const id of W.treeOrder('rogue')) assert.ok(W.learnSkill(s, id).ok, id);
    const ps = W.playerStats(s);
    assert.ok(Math.abs(ps.speed - (1 + 0.08 + 0.08)) < 1e-9);
    assert.ok(Math.abs(ps.dmgBy.dagger - 1.2) < 1e-9);
    assert.equal(ps.dodge, 0.12);
    assert.equal(ps.backstab, 0.5);
    assert.equal(ps.crit, 0.08);
    assert.ok(Math.abs(ps.dashCd - 0.85 * 0.7) < 1e-9, 'the class and Light Feet both speed the dash up');
    assert.equal(ps.stunnedDmg, 1.4, 'Opportunist: hits on a stunned enemy');
    assert.equal(W.playerStats(W.freshState(NOW)).stunnedDmg, 1, 'nobody else gets it');
    assert.ok(Math.abs(ps.abilityStam - 0.7) < 1e-9);
    assert.ok(Math.abs(ps.stamRegen - 1.1) < 1e-9);
    assert.equal(W.abilityKit(s).filter(Boolean).length, 3, 'only three of the six abilities are on keys');
    assert.equal(Object.keys(s.skills.learned).length, 12);
    assert.deepEqual(W.validate(s), []);
});

test('classes, skills and loadouts survive a save; damaged data is cleaned', () => {
    const s = W.freshState(NOW);
    s.rubies = 5000; s.stats.backstabs = 10;
    W.unlockClass(s, 'rogue'); W.setClass(s, 'rogue'); W.learnSkill(s, 'grapple'); W.learnSkill(s, 'riposte');
    W.equipAbility(s, 'riposte', 2);
    const back = W.migrate(JSON.parse(W.serialize(s, NOW, 0)), NOW);
    assert.deepEqual(back.classes, s.classes);
    assert.deepEqual(back.skills, s.skills);
    assert.deepEqual(W.abilityKit(back), ['grapple', null, 'riposte']);
    assert.equal(back.stats.backstabs, 10);
    const bad = W.migrate({ v: 1,
        classes: { active: 'mystic', unlocked: { fake: true, ranger: true }, loadout: { ranger: ['disengage', 'eagle_eye', 'disengage', 'arrow_volley'], warrior: ['grapple', 'nope', null], fake: ['x'] } },
        skills: { learned: { fake: true, disengage: true, eagle_eye: true } } }, NOW);
    assert.deepEqual(bad.classes.unlocked, { warrior: true, ranger: true });
    assert.equal(bad.classes.active, 'warrior', 'a locked active class falls back to the Warrior');
    assert.deepEqual(bad.skills.learned, { disengage: true, eagle_eye: true });
    assert.deepEqual(bad.classes.loadout, { warrior: [null, null, null], ranger: ['disengage', null, null] }, 'perks, unlearned, foreign and repeated abilities are taken off');
    assert.deepEqual(W.validate(bad), []);
    assert.deepEqual(W.migrate({ v: 1, classes: 7, skills: 7 }, NOW).classes, { active: 'warrior', unlocked: { warrior: true }, loadout: {} });
});

test('older saves keep their abilities: classes unlock, and each class gets its learned abilities on its keys', () => {
    // from before classes: any ability in any slot
    const old = { v: 1, abilities: { learned: { whirlwind: true, blink: true, fire_nova: true }, slots: ['blink', 'whirlwind', null] } };
    const s = W.migrate(old, NOW);
    assert.deepEqual(s.classes.unlocked, { warrior: true, rogue: true, mystic: true });
    assert.equal(s.classes.active, 'rogue');
    assert.deepEqual(W.abilityKit(s), ['grapple', null, null], 'Blink is the Grappling Hook now');
    assert.deepEqual(s.skills.learned, { whirlwind: true, grapple: true, fire_nova: true });
    assert.equal(s.abilities, undefined);
    // from before skill trees: three fixed abilities per class
    const t = W.migrate({ v: 1, classes: { active: 'warrior', unlocked: { warrior: true } }, abilities: { learned: { whirlwind: true, shockwave: true, berserk: true } } }, NOW);
    assert.deepEqual(W.abilityKit(t), ['whirlwind', 'shockwave', 'berserk'], 'the same keys as before');
    assert.deepEqual(W.validate(t), []);
});

test('the reworked Rogue: old skills become their replacements, wherever a save keeps them', () => {
    const old = { v: 1, classes: { active: 'rogue', unlocked: { warrior: true, rogue: true },
        loadout: { rogue: ['envenom', 'fan_of_knives', 'blink'] } },
        skills: { learned: { blink: true, envenom: true, fan_of_knives: true, caltrops: true, quick_hands: true, light_feet: true } } };
    const s = W.migrate(old, NOW);
    assert.deepEqual(s.skills.learned, { grapple: true, riposte: true, quick_cut: true, deadly_throw: true, opportunist: true, light_feet: true });
    assert.deepEqual(W.abilityKit(s), ['riposte', 'quick_cut', 'grapple']);
    assert.deepEqual(W.validate(s), []);
    for (const id of ['blink', 'envenom', 'fan_of_knives', 'caltrops', 'quick_hands']) assert.ok(!D.ABILITIES[id] && !D.PERKS[id], id + ' is gone');
    assert.equal(D.ABILITIES.grapple.charges, 2);
    assert.equal(D.ABILITIES.quick_cut.charges, 3);
    assert.equal(D.ABILITIES.riposte.kind, 'parry');
});

test('material tooltips: every material and supply says where it comes from', () => {
    for (const m of D.MATERIALS.concat(D.CONSUMABLES)) assert.ok(W.materialSources(m.id).length, m.id + ' has a source');
    assert.deepEqual(W.materialSources('copper_bar'), [{ kind: 'craft', name: 'Forge', station: 'forge', inputs: { copper_ore: 2, coal: 1 }, n: 1 }]);
    const ore = W.materialSources('copper_ore');
    assert.equal(ore[0].kind, 'node', 'gathering comes first');
    assert.ok(ore.some(x => x.zone === 'greenwood') && ore.every(x => D.ZONES[x.zone]));
    assert.deepEqual(W.materialSources('hidden_shard'), [{ kind: 'boss', name: 'Frozen WH', zone: 'frost', chance: 0.1 }]);
    assert.deepEqual(W.materialSources('sigil_greenwood'), [{ kind: 'boss', name: 'The Overgrown', zone: 'greenwood', chance: 1, first: true }]);
    const hide = W.materialSources('boar_hide').filter(x => x.kind === 'monster');
    assert.ok(hide.length >= 2 && hide[0].chance >= hide[1].chance, 'likelier drops first');
    assert.ok(W.materialSources('coal').some(x => x.kind === 'trader' && x.price > 0));
    assert.deepEqual(W.materialSources('nope'), []);
});

test('every class has a tree of three branches, four skills deep, and every skill is sound', () => {
    const seen = new Set();
    const bossAt = (b) => (b ? D.ZONE_ORDER.indexOf(D.BOSSES[b].zone) : -1);
    const KINDS = ['nova', 'cone', 'blink', 'charge', 'volley', 'shot', 'chain', 'smoke', 'heal', 'buff', 'leap', 'line', 'field', 'step', 'hook', 'parry'];
    const BONUS = ['maxHp', 'armor', 'speed', 'crit', 'dmg', 'blockStam', 'arrowSave', 'abilityCd', 'abilityDmg', 'abilityStam', 'stamRegen', 'lifesteal',
        'dashCd', 'dashStam', 'momentum', 'backstab', 'regen', 'pierce', 'thorns', 'dodge', 'fireResist', 'stunnedDmg'];
    const stats = W.freshState(NOW).stats;
    for (const id of D.ABILITY_ORDER) assert.ok(!D.PERKS[id], id + ' is both an ability and a perk');
    for (const c of D.CLASS_ORDER) {
        const k = D.CLASSES[c];
        assert.ok(k.name && k.icon && k.passive && k.desc && k.bonus, c);
        for (const key in k.bonus) assert.ok(BONUS.includes(key), c + ' bonus ' + key);
        if (k.unlock && k.unlock.boss) assert.ok(D.BOSSES[k.unlock.boss], c);
        if (k.unlock && k.unlock.stat) assert.ok(k.unlock.stat in stats, c + ' counts a real stat');
        assert.equal(k.branches.length, 3, c);
        let abilities = 0;
        k.branches.forEach((br, b) => {
            assert.ok(br.name, c + ' branch name');
            assert.equal(br.skills.length, 4, c + ' ' + br.name);
            let gate = -1;
            br.skills.forEach((id, row) => {
                const sk = D.ABILITIES[id] || D.PERKS[id];
                assert.ok(sk, id);
                assert.ok(!seen.has(id), id + ' is in two trees');
                seen.add(id);
                assert.equal(sk.cls, c); assert.equal(sk.branch, b); assert.equal(sk.row, row);
                assert.equal(sk.req, row ? br.skills[row - 1] : null);
                assert.ok(sk.name && sk.icon && sk.desc && sk.cost > 0, id);
                if (row === 0) assert.equal(sk.boss, null, id + ': the top of a branch needs no boss');
                if (sk.boss) { assert.ok(D.BOSSES[sk.boss], id); assert.ok(bossAt(sk.boss) >= gate, id + ' needs an earlier boss than the skill above it'); gate = bossAt(sk.boss); }
                if (sk.type === 'ability') {
                    abilities++;
                    assert.ok(KINDS.includes(sk.kind), id + ' kind ' + sk.kind);
                    assert.ok(sk.cd > 0 && sk.stam >= 0 && sk.color, id);
                    if (sk.kind === 'field') assert.ok(sk.r > 0 && sk.tick > 0 && sk.time > (sk.delay || 0) && (sk.at === 'self' || sk.range > 0), id);
                    if (sk.kind === 'line') assert.ok(sk.len > 0 && sk.width > 0, id);
                    if (sk.kind === 'leap') assert.ok(sk.dist > 0 && sk.radius > 0, id);
                    if (sk.kind === 'step') assert.ok(sk.range > 0, id);
                    if (sk.kind === 'buff') assert.ok(sk.time > 0, id);
                    if (sk.kind === 'hook') assert.ok(sk.range > 0 && sk.stun > 0, id);
                    if (sk.kind === 'parry') assert.ok(sk.window > 0 && sk.stun > 0 && sk.exhaust > 0, id);
                    if (sk.charges !== undefined) assert.ok(Number.isInteger(sk.charges) && sk.charges >= 1, id + ' charges');
                } else {
                    assert.equal(sk.type, 'perk', id);
                    assert.ok(Object.keys(sk.bonus).length, id);
                    for (const key in sk.bonus) assert.ok(BONUS.includes(key), id + ' bonus ' + key);
                }
            });
        });
        assert.ok(abilities > D.ABILITY_KEYS.length, c + ' has more abilities than keys, so the loadout is a choice');
    }
    assert.equal(seen.size, D.ABILITY_ORDER.length + D.PERK_ORDER.length, 'no skill outside a tree');
    assert.equal(D.CLASSES[D.STARTER_CLASS].unlock, null);
    assert.ok(D.CLASSES.lancer, 'the spear class');
});

test('the world save remembers the last rubies entry it collected from the game', () => {
    const s = W.freshState(NOW);
    assert.equal(s.inAck, 0);
    s.inAck = 12;
    assert.equal(W.migrate(JSON.parse(W.serialize(s, NOW, 0)), NOW).inAck, 12);
    assert.equal(W.migrate({ v: 1, inAck: 'x' }, NOW).inAck, 0);
    assert.equal(W.migrate({ v: 1 }, NOW).inAck, 0, 'saves from before the inbox start at 0');
});
