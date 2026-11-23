'use strict';
// The Neon Arcade: the zone past the Skyreach Isles (claw machines, laser cabinets, the 8-Bit WH), its hidden dungeon, and
// what it gives for crafting: the add-ins (D.POWERUPS), the arcade-only affixes and the Arcade Set (D.SETS)
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const D = require('../core/world-data');
const W = require('../core/world-logic');
const G = require('../core/world-gen');
const M = require('../core/world-music');
const Dg = require('../core/world-dungeons');
const C = require('../core/world-combat');

const NOW = 1_700_000_000_000;
const seq = (...v) => { let i = 0; return () => v[i++ % v.length]; };
const fill = (s, mats) => { for (const [id, n] of Object.entries(mats)) W.give(s, id, n, true); };

test('the Arcade comes after the isles: tier 9, through the Waystone, opened by Vrill WH, with every part a zone has', () => {
    const z = D.ZONES.arcade;
    assert.equal(D.ZONE_ORDER[D.ZONE_ORDER.length - 1], 'arcade');
    assert.equal(D.ZONE_ORDER[D.ZONE_ORDER.indexOf('arcade') - 1], 'sky');
    assert.deepEqual([z.tier, z.via, z.gate, z.boss, z.elite, z.wards], [9, 'waystone', 'sigil_sky', 'wh8bit', 'crane', 4]);
    // the boss is the game's 8-Bit WH skin
    assert.equal(D.BOSSES.wh8bit.face, 'mainimage/thumbs/wh8bit.webp');
    assert.ok(fs.existsSync(path.join(__dirname, '..', D.BOSSES.wh8bit.face)));
    // a ward key it can make, a camp keeper (The Bass, from the game's upgrades), a rival, music, a hidden dungeon
    const key = D.BASIC_RECIPES.find(r => r.out[z.wardKey]);
    assert.ok(key && key.in.joystick, 'the Coin Key needs the Prize Crane\'s parts');
    assert.ok(D.MONSTERS.crane.drops.some(d => d[0] === 'joystick'));
    const bass = D.NPCS.bass;
    assert.equal(bass.zone, 'arcade');
    assert.ok(fs.existsSync(path.join(__dirname, '..', bass.face)), 'The Bass\'s portrait');
    assert.ok(D.RIVAL_TIERS.arcade && D.GEAR_BY_ID[D.RIVALS[D.RIVAL_TIERS.arcade.rival].cls + '_' + D.RIVAL_TIERS.arcade.tier]);
    assert.equal(M.themeFor('arcade'), 'arcade');
    assert.equal(Dg.underZone('arcade'), 'bonus');
    assert.equal(D.DUNGEONS.bonus.boss, 'glitch_king');
    // the online database lets players into it and into a party's copy of its dungeon
    const rules = JSON.parse(fs.readFileSync(path.join(__dirname, '..', 'database.rules.json'), 'utf8'));
    const zoneRe = new RegExp(rules.rules.wilds.v1.zones.$zone['.validate'].match(/matches\(\/(.+)\/\)/)[1]);
    assert.ok(zoneRe.test('arcade') && zoneRe.test('bonus_Ab12Cd34') && !zoneRe.test('bonus'));
});

test('beating Vrill WH opens the Arcade, and an old save that already beat it finds it open', () => {
    const s = W.freshState(NOW);
    for (const z of D.ZONE_ORDER.slice(0, -1)) s.unlocked.zones[z] = true;
    const r = W.bossLoot(s, 'vrill', () => 0.5, NOW, 0);
    assert.equal(r.unlocked, 'arcade');
    assert.ok(s.unlocked.zones.arcade);
    const old = W.freshState(NOW);
    for (const z of D.ZONE_ORDER.slice(0, -1)) old.unlocked.zones[z] = true;
    old.bosses.vrill = { kills: 3 };
    const back = W.migrate(JSON.parse(W.serialize(old, NOW, 0)), NOW);
    assert.ok(back.unlocked.zones.arcade, 'back-filled from the Vrill kill');
});

test('claw machines drag you in, cabinets fire lasers, and the 8-Bit WH has both', () => {
    const claw = D.MONSTERS.claw_machine.attacks.find(a => a.type === 'claw');
    assert.ok(claw && claw.pull > 0 && claw.pullReach > 110, 'a claw drags you further than a siren\'s pull');
    const laser = D.MONSTERS.cabinet.attacks.find(a => a.type === 'laser');
    assert.ok(laser && laser.len > 300 && laser.width > 0 && laser.windup >= 0.8, 'a laser with time to step out of it');
    assert.ok(D.MONSTERS.crane.elite && D.MONSTERS.crane.attacks.some(a => a.type === 'claw') && D.MONSTERS.crane.attacks.some(a => a.type === 'laser'));
    const moves = new Set(D.BOSSES.wh8bit.phases.flat());
    for (const m of ['lasers', 'claw', 'pixels']) assert.ok(moves.has(m), '8-Bit WH: ' + m);
    // every monster in the zone draws as itself (world-actors.js has a look for each)
    const actors = fs.readFileSync(path.join(__dirname, '..', 'world-actors.js'), 'utf8');
    for (const [id] of D.ZONES.arcade.spawns.concat([[D.ZONES.arcade.elite]])) assert.ok(actors.includes("case '" + id + "'"), id + ' has its own look');
});

test('a step harder than the isles for the same Starmetal gear, inside the Far Reaches\' bands', () => {
    const SWING = C.hitDamage(1, 0.8, 2, 1, D.WEAPON_CLASSES.sword).dmg, A = ['helmet', 'chest', 'boots'];
    const g = { hit: SWING * D.GEAR_BY_ID.sword_9.dmg, hp: 120 + A.reduce((a, s) => a + D.GEAR_BY_ID[s + '_9'].hp, 0), armor: A.reduce((a, s) => a + D.GEAR_BY_ID[s + '_9'].armor, 0) };
    const hits = (m) => m.hp * (100 + (m.armor || 0)) / 100 / g.hit, share = (m) => m.dmg * 100 / (100 + g.armor) / g.hp;
    const avg = (z, f) => D.ZONES[z].spawns.reduce((a, [m]) => a + f(D.MONSTERS[m]), 0) / D.ZONES[z].spawns.length;
    assert.ok(avg('arcade', hits) > avg('sky', hits) && avg('arcade', hits) <= 9, 'regulars last longer than the isles\' (' + avg('arcade', hits).toFixed(1) + ' hits)');
    assert.ok(avg('arcade', share) > avg('sky', share), 'and hit harder');
    assert.ok(hits(D.BOSSES.wh8bit) > hits(D.BOSSES.vrill) && share(D.BOSSES.wh8bit) <= 0.13, '8-Bit WH outlasts Vrill and hits within the band');
    // its neon needs the Starmetal pickaxe, its wood the Skywood axe
    assert.equal(D.NODES.neon_vein.tier, D.GEAR_BY_ID.pickaxe_9.tool);
    assert.ok(D.NODES.old_cabinet.tier <= D.GEAR_BY_ID.axe_9.tool && D.NODES.old_cabinet.tier > D.GEAR_BY_ID.axe_8.tool - 1);
});

test('add-ins: a token adds to the score, a chip makes sure of an affix, a cartridge gives an arcade one; quitting gives them back', () => {
    const s = W.freshState(NOW);
    s.rubies = 1e7;
    fill(s, { starmetal_bar: 40, skywood_plank: 20, seraph_feather: 20, arcade_token: 3, power_chip: 2, glitch_cartridge: 2 });
    // a Bonus Round: +6, but it never lifts a craft into Legendary on its own (97 at most); one played Legendary still gets it
    assert.ok(W.beginCraft(s, 'gear', 'sword_9', NOW, ['arcade_token']).ok);
    assert.equal(W.count(s, 'arcade_token'), 2);
    let out = W.finishCraft(s, 50, () => 0.99, NOW, 0);
    assert.deepEqual([out.played, out.score, out.item.score], [50, 56, 56]);
    W.beginCraft(s, 'gear', 'sword_9', NOW, ['arcade_token']);
    assert.equal(W.finishCraft(s, 95, () => 0.99, NOW, 0).score, 97, 'not into Legendary');
    fill(s, { arcade_token: 1 });
    W.beginCraft(s, 'gear', 'sword_9', NOW, ['arcade_token']);
    assert.equal(W.finishCraft(s, 98, () => 0.99, NOW, 0).score, 100, 'a played Legendary goes on up');
    // a Power-Up: an affix even at a score that never rolls one (Common: 0% chance)
    W.beginCraft(s, 'gear', 'sword_9', NOW, ['power_chip']);
    out = W.finishCraft(s, 40, () => 0.99, NOW, 0);
    assert.equal(out.item.aff.length, 1);
    assert.ok(!D.AFFIXES[out.item.aff[0]].arcade);
    // a Glitch: one arcade-only affix, on top of what the score rolled, never more than two in all
    W.beginCraft(s, 'gear', 'sword_9', NOW, ['glitch_cartridge']);
    out = W.finishCraft(s, 99, () => 0.1, NOW, 0);
    assert.equal(out.item.aff.length, 2);
    assert.equal(out.item.aff.filter(a => D.AFFIXES[a].arcade).length, 1);
    assert.ok(out.item.aff.every(a => D.AFFIXES[a].slots.includes('weapon')));
    // called off: the add-in comes back with the materials
    const chips = W.count(s, 'power_chip');
    W.beginCraft(s, 'gear', 'sword_9', NOW, ['power_chip', 'power_chip', 'nonsense']);
    assert.equal(W.count(s, 'power_chip'), chips - 1, 'one of each at most, unknown ones ignored');
    W.abortCraft(s);
    assert.equal(W.count(s, 'power_chip'), chips);
    // only on crafts that take it (a chip does nothing for a lootbox, so it isn't spent there)
    assert.deepEqual(W.boostsFor('box', ['power_chip', 'arcade_token']), ['arcade_token']);
    // none of it, and you can't start with an add-in you don't have
    const empty = W.freshState(NOW); empty.rubies = 1e7; fill(empty, { starmetal_bar: 10, skywood_plank: 5, seraph_feather: 5 });
    assert.equal(W.beginCraft(empty, 'gear', 'sword_9', NOW, ['glitch_cartridge']).reason, 'boost');
    assert.equal(empty.pendingCraft, null);
    // the arcade-only affixes never come on their own
    const b = D.GEAR_BY_ID.chest_9;
    let rnd = 0.001;
    for (let i = 0; i < 400; i++) { rnd = (rnd * 9301 + 49297) % 233280 / 233280; const r = rnd; assert.ok(W.rollAffixes(b, 100, () => r).every(a => !D.AFFIXES[a].arcade)); }
    assert.deepEqual(W.validate(s), []);
});

test('a reforge with a cartridge adds an arcade affix even when the score is no better; the affix survives a save', () => {
    const s = W.freshState(NOW);
    s.rubies = 1e7;
    fill(s, { starmetal_bar: 60, skywood_plank: 30, seraph_feather: 30, glitch_cartridge: 1 });
    W.beginCraft(s, 'gear', 'sword_9', NOW);
    const it = W.finishCraft(s, 92, seq(0.01, 0.5, 0.9), NOW, 0).item;
    const before = it.aff.slice();
    assert.ok(W.beginReforge(s, it.uid, NOW, ['glitch_cartridge']).ok);
    const r = W.finishCraft(s, 10, () => 0.3, NOW, 0);
    assert.equal(r.improved, false);
    assert.equal(it.score, 92, 'the better score is kept');
    assert.ok(it.aff.some(a => D.AFFIXES[a].arcade), 'the cartridge still did its work');
    assert.ok(it.aff.length <= 2 && it.aff.length >= Math.min(2, before.length));
    const back = W.migrate(JSON.parse(W.serialize(s, NOW, 0)), NOW);
    assert.deepEqual(W.findGear(back, it.uid).aff, it.aff);
});

test('the Arcade Set: an arcade affix on every piece, and its bonuses at 2, 3 and 4 worn pieces (weapons don\'t count)', () => {
    const S = D.SETS.arcade;
    assert.equal(S.pieces.length, 4);
    const pieces = D.GEAR.filter(g => g.set === 'arcade');
    assert.ok(pieces.length >= 8);
    for (const p of pieces) {
        assert.equal(p.tier, 9, p.id);
        assert.equal(p.zone, 'arcade');
        assert.ok(p.recipe && p.recipe.fee > D.TIERS[9].fee, p.id + ' costs more than Starmetal');
        const plain = D.GEAR_BY_ID[p.cls + '_9'];
        if (p.slot === 'weapon') assert.ok(p.dmg > plain.dmg, p.id + ' hits harder than Starmetal');
        else if (p.slot !== 'offhand') assert.ok(p.armor > plain.armor && p.hp > plain.hp, p.id + ' guards better than Starmetal');
        else assert.ok(p.block > plain.block && p.stab > plain.stab, p.id);
        // a piece always comes with one arcade affix
        assert.equal(W.rollAffixes(p, 40, () => 0.5).filter(a => D.AFFIXES[a].arcade).length, p.slot === 'offhand' ? 0 : 1, p.id);
    }
    for (const id of S.pieces) assert.ok(D.GEAR_BY_ID[id] && D.GEAR_BY_ID[id].slot !== 'weapon', id + ' is worn');
    // a Glitch Cartridge isn't wasted on a set piece (it has its arcade affix already); a token still goes in
    const c = W.freshState(NOW); c.rubies = 1e6; fill(c, { neon_alloy: 4, cabinet_plank: 2, claw_grip: 2, glitch_cartridge: 1, arcade_token: 1 });
    assert.deepEqual(W.beginCraft(c, 'gear', 'pixel_blade', NOW, ['glitch_cartridge', 'arcade_token']).boost, ['arcade_token']);
    assert.equal(W.count(c, 'glitch_cartridge'), 1);
    const s = W.freshState(NOW);
    const base = W.playerStats(s);
    const wear = (id) => { const it = W.addGear(s, id, 40, [], NOW); W.equip(s, it.uid); return it; };
    wear('pixel_blade');
    assert.deepEqual(W.setsWorn(s), {}, 'a weapon on the hotbar is not worn');
    wear('arcade_visor');
    assert.equal(W.playerStats(s).rubies, base.rubies, 'one piece: nothing yet');
    wear('cabinet_plate');
    const two = W.playerStats(s);
    assert.ok(Math.abs(two.rubies - base.rubies - 0.15) < 1e-9, '2: +15% rubies');
    wear('turbo_sneakers');
    const three = W.playerStats(s);
    const hpNoSet = D.COMBAT.player.hp + ['arcade_visor', 'cabinet_plate', 'turbo_sneakers'].reduce((a, id) => a + W.gearStats(s.gear.find(g => g.base === id)).hp, 0);
    assert.ok(three.maxHp > hpNoSet * 1.1, '3: more health');
    assert.equal(three.extraLife, 0);
    wear('coin_op_shield');
    assert.equal(W.playerStats(s).extraLife, 180, '4: an Extra Life every 3 minutes');
    assert.deepEqual(W.setBonuses('arcade', 4).map(b => b.on), [true, true, true]);
    // what a piece's affixes do
    const turbo = W.gearStats({ base: 'sword_9', score: 40, aff: ['turbo'] }), plain = W.gearStats({ base: 'sword_9', score: 40, aff: [] });
    assert.ok(turbo.wMult > plain.wMult && turbo.aMult > plain.aMult);
    assert.equal(W.gearStats({ base: 'chest_9', score: 40, aff: ['glitched'] }).dodge, 0.04);
    assert.equal(W.gearStats({ base: 'chest_9', score: 40, aff: ['highscore'] }).rubies, 0.12);
    // worn on all three armor pieces with the set's 2-piece bonus, rubies stay well short of a doubling, and dodge small
    assert.ok(3 * 0.12 + D.SETS.arcade.bonuses[0].bonus.rubies <= 0.55 && 3 * 0.04 <= 0.12);
    assert.deepEqual(W.validate(s), []);
});

test('the Bass\'s quests count the Arcade\'s own things, and Hilde wants a piece of the set', () => {
    const s = W.freshState(NOW);
    for (const z of D.ZONE_ORDER) s.unlocked.zones[z] = true;
    s.rubies = 1e7;
    // the add-in quest: only a craft with an add-in in it counts
    s.quests.bass = { step: D.NPCS.bass.chain.indexOf('bass_power'), active: null, dailyDone: '' };
    assert.equal(W.questOffer(s, 'bass', NOW).id, 'bass_power');
    assert.ok(W.acceptQuest(s, 'bass', NOW).ok);
    fill(s, { starmetal_bar: 40, skywood_plank: 20, seraph_feather: 20, arcade_token: 1 });
    W.beginCraft(s, 'gear', 'sword_9', NOW);
    W.finishCraft(s, 60, () => 0.5, NOW, 0);
    assert.equal(W.questProgress(s, 'bass').have, 0, 'no add-in, no count');
    W.beginCraft(s, 'gear', 'sword_9', NOW, ['arcade_token']);
    W.finishCraft(s, 60, () => 0.5, NOW, 0);
    assert.equal(W.questProgress(s, 'bass').done, true);
    // Hilde's: a piece of the Arcade Set (Starmetal gear doesn't count)
    s.quests.hilde = { step: D.NPCS.hilde.chain.indexOf('hilde_arcade'), active: null, dailyDone: '' };
    assert.equal(W.questOffer(s, 'hilde', NOW).id, 'hilde_arcade');
    W.acceptQuest(s, 'hilde', NOW);
    W.beginCraft(s, 'gear', 'sword_9', NOW);
    W.finishCraft(s, 60, () => 0.5, NOW, 0);
    assert.equal(W.questProgress(s, 'hilde').have, 0);
    fill(s, { neon_alloy: 4, cabinet_plank: 2, claw_grip: 2 });
    assert.ok(W.beginCraft(s, 'gear', 'pixel_blade', NOW).ok);
    W.finishCraft(s, 60, () => 0.5, NOW, 0);
    assert.equal(W.questProgress(s, 'hilde').done, true);
});

test('the Arcade map: cabinet rows to walk around, its camp, wards and boss reachable, the guardians on open ground', () => {
    const m = G.generateZone('arcade');
    const walls = m.tiles.filter(t => t === G.T.WALL).length / m.tiles.length;
    assert.ok(walls > 0.08 && walls < 0.35, 'cabinet rows: ' + (walls * 100).toFixed(0) + '% of the floor');
    assert.equal(m.wards.length, 4);
    assert.ok(m.dungeon && m.dungeon.id === 'bonus');
    for (const w of m.wards) assert.ok(G.openSpot(m, w.x, w.y, D.MONSTERS.crane.r, { ang: Math.PI / 2, dist: 80 }), 'ward ' + w.i + ' has room for its guardian');
});
