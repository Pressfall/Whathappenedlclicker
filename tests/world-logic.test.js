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

test('classes: you start as a Warrior with its kit on Z X C, nothing learned yet', () => {
    const s = W.freshState(NOW);
    assert.equal(s.classes.active, 'warrior');
    assert.deepEqual(Object.keys(s.classes.unlocked), ['warrior']);
    assert.deepEqual(W.abilityKit(s), [null, null, null]);
    s.rubies = 1000;
    assert.ok(W.learnAbility(s, 'whirlwind').ok);
    assert.deepEqual(W.abilityKit(s), ['whirlwind', null, null]);
    assert.equal(s.rubies, 1000 - D.ABILITIES.whirlwind.cost);
    assert.equal(W.learnAbility(s, 'whirlwind').reason, 'known');
    assert.equal(W.learnAbility(s, 'shockwave').reason, 'boss');
    assert.equal(W.learnAbility(s, 'blink').reason, 'class', "another class's ability needs that class");
    assert.equal(W.learnAbility(s, 'nope').reason, 'unknown');
});

test('classes: a challenge, then rubies, unlock a class; switching changes the kit and the bonuses', () => {
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
    const before = W.playerStats(s);
    assert.ok(W.setClass(s, 'guardian'));
    const after = W.playerStats(s);
    assert.equal(after.maxHp, before.maxHp - 15 + 25);
    assert.equal(after.armor, before.armor + 8);
    assert.equal(after.blockStam, 0.65);
    assert.deepEqual(after.dmgBy, {}, 'the Warrior sword bonus is gone');
    assert.ok(W.learnAbility(s, 'second_wind').ok);
    assert.deepEqual(W.abilityKit(s), ['second_wind', null, null]);
    assert.deepEqual(W.validate(s), []);
});

test('classes: the Mystic unlocks by beating The Overgrown', () => {
    const s = W.freshState(NOW);
    s.rubies = 5000;
    assert.equal(W.unlockClass(s, 'mystic').reason, 'req');
    s.bosses.overgrown = { kills: 1, lastKillDay: '', lastKillWeek: '', mythicWeek: '' };
    assert.ok(W.unlockClass(s, 'mystic').ok);
    W.setClass(s, 'mystic');
    const ps = W.playerStats(s);
    assert.equal(ps.abilityCd, 0.75);
    assert.equal(ps.abilityDmg, 1.25);
});

test('classes and abilities survive a save; damaged data is cleaned', () => {
    const s = W.freshState(NOW);
    s.rubies = 5000; s.stats.backstabs = 10;
    W.unlockClass(s, 'rogue'); W.setClass(s, 'rogue'); W.learnAbility(s, 'blink');
    const back = W.migrate(JSON.parse(W.serialize(s, NOW, 0)), NOW);
    assert.deepEqual(back.classes, s.classes);
    assert.deepEqual(back.abilities, s.abilities);
    assert.equal(back.stats.backstabs, 10);
    const bad = W.migrate({ v: 1, classes: { active: 'mystic', unlocked: { fake: true, ranger: true } }, abilities: { learned: { fake: true, disengage: true } } }, NOW);
    assert.deepEqual(bad.classes.unlocked, { warrior: true, ranger: true });
    assert.equal(bad.classes.active, 'warrior', 'a locked active class falls back to the Warrior');
    assert.deepEqual(bad.abilities.learned, { disengage: true });
    assert.deepEqual(W.validate(bad), []);
    assert.deepEqual(W.migrate({ v: 1, classes: 7, abilities: 7 }, NOW).classes, { active: 'warrior', unlocked: { warrior: true } });
});

test('saves from before classes keep their abilities: those classes unlock and the first slotted one is active', () => {
    const old = { v: 1, abilities: { learned: { whirlwind: true, blink: true, fire_nova: true }, slots: ['blink', 'whirlwind', null] } };
    const s = W.migrate(old, NOW);
    assert.deepEqual(s.classes.unlocked, { warrior: true, rogue: true, mystic: true });
    assert.equal(s.classes.active, 'rogue');
    assert.deepEqual(W.abilityKit(s), ['blink', null, null]);
    assert.equal(s.abilities.slots, undefined);
});

test('every class has three real abilities, each ability belongs to exactly one class', () => {
    const seen = new Set();
    for (const c of D.CLASS_ORDER) {
        const k = D.CLASSES[c];
        assert.ok(k.name && k.icon && k.passive && k.bonus, c);
        assert.equal(k.abilities.length, D.ABILITY_KEYS.length, c);
        if (k.unlock && k.unlock.boss) assert.ok(D.BOSSES[k.unlock.boss], c);
        if (k.unlock && k.unlock.stat) assert.ok(k.unlock.stat in W.freshState(NOW).stats, c + ' counts a real stat');
        k.abilities.forEach((id, i) => {
            assert.ok(D.ABILITIES[id], id);
            assert.ok(!seen.has(id), id + ' is in two classes');
            seen.add(id);
            assert.equal(D.ABILITIES[id].cls, c);
            assert.equal(D.ABILITIES[id].key, i);
        });
        assert.equal(k.abilities.map(id => D.ABILITIES[id]).filter(a => !a.boss).length >= 1, true, c + ' has one ability with no boss gate');
    }
    assert.equal(seen.size, D.ABILITY_ORDER.length, 'no ability without a class');
    assert.equal(D.CLASSES[D.STARTER_CLASS].unlock, null);
    for (const id of D.ABILITY_ORDER) {
        const a = D.ABILITIES[id];
        assert.ok(a.name && a.icon && a.desc && a.cost > 0 && a.cd > 0 && a.kind, id);
        if (a.boss) assert.ok(D.BOSSES[a.boss], id);
    }
});
