'use strict';
// The hidden dungeons (core/world-dungeons.js, core/world-logic.js, core/world-gen.js): one under each zone, the same
// monsters on every page, scaling with the party, the rooms' doors and wipes, who may come in (alone too), the way down in
// each zone, and the rewards with their limits (which must survive a reload).
const test = require('node:test');
const assert = require('node:assert/strict');
const D = require('../core/world-data');
const V = require('../core/world-dungeons');
const W = require('../core/world-logic');
const G = require('../core/world-gen');

const NOW = new Date(2026, 10, 5, 12, 0, 0).getTime();
const DAY = 86400000;
const run = (st, wave) => ({ gen: 'g1', seed: 7, start: 1, wave, st, n: 2, at: NOW, t: NOW });
const seq = (...xs) => { let i = 0; return () => xs[i++ % xs.length]; };
const reload = (s) => W.migrate(JSON.parse(W.serialize(s)), NOW);

test('one dungeon under each zone, each with its own boss, rooms, essence and Heart', () => {
    assert.deepEqual(V.IDS.map(id => D.DUNGEONS[id].zone).sort(), D.ZONE_ORDER.slice().sort());
    for (const id of V.IDS) {
        const dd = D.DUNGEONS[id], z = D.ZONES[id];
        assert.ok(/^[a-z]{2,12}$/.test(id), id + ' fits a party member\'s zone');
        assert.equal(z.dungeon, id); assert.equal(z.instance, true); assert.equal(z.pvp, 'off'); assert.ok(z.coop);
        assert.equal(z.boss, dd.boss); assert.equal(z.from, dd.zone);
        const b = D.BOSSES[dd.boss];
        assert.ok(b && b.dungeon === id && b.partyScale && b.enrage && b.phases.length === 3, id + ' boss');
        assert.ok(b.phases.flat().includes('burden'), id + ': the boss has the Shared Burden');
        assert.equal(dd.rooms.length, V.ROOM_COUNT);
        for (const r of dd.rooms) for (const zz of r.zones) assert.ok(D.ZONES[zz].spawns, id + ' room zone ' + zz);
        const e = D.MATERIALS_BY_ID[dd.essence], h = D.MATERIALS_BY_ID[dd.heart];
        assert.ok(e.kind === 'essence' && e.rar === 2, id + ' essence is rare');
        assert.ok(h.kind === 'essence' && h.rar === 3, id + ' Heart is epic');
    }
    assert.equal(V.underZone('coast'), 'vault', 'the Sunken Vault is under the coast now');
    assert.equal(V.underZone('town'), null);
});

test('rooms: the same monsters for the same run on every page, from the room\'s own zones, more and tougher with more players', () => {
    for (const id of V.IDS) for (let room = 1; room <= V.ROOM_COUNT; room++) {
        const a = V.roomComposition(id, 12345, room, 2), b = V.roomComposition(id, 12345, room, 2);
        assert.deepEqual(a, b);
        const zones = D.DUNGEONS[id].rooms[room - 1].zones;
        const allowed = new Set(zones.flatMap(z => D.ZONES[z].spawns.map(s => s[0]).concat(D.ZONES[z].elite)));
        for (const m of a) { assert.ok(allowed.has(m.type), id + ' ' + room + ': ' + m.type); assert.match(m.mid, V.MID_RE); }
        assert.equal(new Set(a.map(m => m.mid)).size, a.length, 'ids are unique');
        const four = V.roomComposition(id, 12345, room, 4), solo = V.roomComposition(id, 12345, room, 1);
        assert.ok(four.length > a.length && a.length > solo.length, 'more monsters with more players');
        assert.ok(four[0].hpMult > a[0].hpMult && a[0].hpMult > solo[0].hpMult, 'tougher too');
    }
    assert.ok(V.roomComposition('roots', 1, 3, 1).some(m => m.champion), 'the last room has its champion');
    assert.deepEqual(V.roomComposition('roots', 1, 4, 2), [], 'no room 4: that is the boss');
    assert.deepEqual(V.roomComposition('nowhere', 1, 1, 2), []);
    assert.ok(V.bossHp(100000, 4) > V.bossHp(100000, 2) && V.bossHp(100000, 2) > V.bossHp(100000, 1));
    assert.equal(V.bossHp(100000, 1), 100000, 'alone: its own health');
    assert.equal(V.bossHp(100000, 9), V.bossHp(100000, V.PARTY.max), 'at most a full party');
});

test('doors: a room seals while it is fought, the next opens once it is cleared, the boss after the third', () => {
    const open = (r) => [1, 2, 3, 4].map(i => V.doorOpen(r, i) ? 1 : 0).join('');
    assert.equal(open(null), '1000');
    assert.equal(open(V.newRun(NOW, () => 0.5)), '1000');
    assert.equal(open(run('fight', 1)), '0000', 'sealed in');
    assert.equal(open(run('break', 1)), '1100');
    assert.equal(open(run('break', 3)), '1111');
    assert.equal(V.nextRoom(run('break', 3)), 0, 'the boss next');
    assert.equal(V.kingOpen(run('break', 3)), true);
    assert.equal(V.kingOpen(run('over', 4)), false, 'not again once it is down');
    assert.deepEqual(V.wiped(run('fight', 3)), { st: 'break', wave: 2 });
    assert.equal(V.runNeedsReset(run('break', 2), NOW + V.RUN.idleResetMs + 1), true);
});

test('who may come in: alone or a party of up to 4, once the zone\'s boss has fallen to you; one copy per party', () => {
    assert.deepEqual(V.mayEnter(0, true), { ok: true }, 'alone');
    assert.deepEqual(V.mayEnter(1, true), { ok: true });
    assert.deepEqual(V.mayEnter(4, true), { ok: true });
    assert.equal(V.mayEnter(5, true).reason, 'size');
    assert.equal(V.mayEnter(2, false).reason, 'locked');
    assert.equal(V.instanceKey('vault', 'abcd2345ef'), 'vault_abcd2345ef');
    assert.equal(V.instanceKey('roots', 'abcd2345ef'), 'roots_abcd2345ef');
    assert.equal(V.instanceKey('roots', '../x'), null);
    assert.equal(V.instanceKey('greenwood', 'abcd2345ef'), null, 'only a dungeon');
    assert.equal(V.instanceKey('roots', null), null, 'alone: no shared copy');
    const s = W.freshState(NOW);
    for (const id of V.IDS) assert.equal(W.dungeonOpen(s, id), false, id + ' sealed at first');
    s.bosses.overgrown = { kills: 1, lastKillDay: '', lastKillWeek: '', mythicWeek: '' };
    assert.equal(W.dungeonOpen(s, 'roots'), true, 'the Root Mother\'s way opens with the Overgrown');
    assert.equal(W.dungeonOpen(s, 'deep'), false);
    s.unlocked.zones.coast = true;
    assert.equal(W.dungeonOpen(s, 'vault'), false, 'reaching the coast is not enough any more: its boss must fall');
});

test('each zone hides its way down off the roads: reachable, in open ground, far from the entry, camp and boss', () => {
    for (const z of D.ZONE_ORDER) {
        const m = G.generateZone(z), dg = m.dungeon;
        assert.ok(dg && dg.id === V.underZone(z), z + ' has its dungeon');
        assert.ok(G.isSolid(G.tileAt(m, dg.x, dg.y)), z + ': a boulder you walk up to');
        const t = { x: dg.tx, y: dg.ty };
        const e = { x: Math.floor(m.entry.x / D.TILE), y: Math.floor(m.entry.y / D.TILE) };
        const seen = G.flood(G.openLair(m), e.x, e.y);
        assert.ok([[1, 0], [-1, 0], [0, 1], [0, -1]].some(([dx, dy]) => seen[(t.y + dy) * m.w + t.x + dx]), z + ': reachable');
        assert.ok(Math.hypot(dg.x - m.entry.x, dg.y - m.entry.y) > 20 * D.TILE, z + ': far from the entry');
        assert.ok(Math.hypot(dg.x - m.camp.x, dg.y - m.camp.y) > 10 * D.TILE, z + ': away from the camp');
        assert.ok(Math.hypot(dg.x - m.boss.x, dg.y - m.boss.y) > 14 * D.TILE, z + ': away from the boss');
        assert.equal(G.mapHash(G.generateZone(z)), G.mapHash(G.generateZone(z)), z + ': the same for everyone');
    }
});

test('the dungeon maps: three rooms with doors and the boss\'s chamber; the way out leads up to the zone above', () => {
    for (const id of V.IDS) {
        const m = G.generateZone(id);
        assert.equal(m.rooms.length, V.ROOM_COUNT, id);
        for (const r of m.rooms) assert.ok(r.ready && r.floor && r.gates.length === 4 && r.door.tiles.length > 0, id + ' room ' + r.i);
        assert.ok(m.boss && m.kingDoor && m.kingDoor.tiles.length > 0);
        assert.equal(m.exit.to, D.DUNGEONS[id].zone, id + ' leads back up');
    }
    // the Vault's map didn't move
    const v = G.generateZone('vault'), t = v.rooms[1].door.tiles[0];
    G.setVaultDoor(v, 2, true);
    assert.equal(v.tiles[t[1] * v.w + t[0]], t[2], 'open: the floor is back');
});

test('rooms pay rubies for 9 a day and a chest of essences for 6 a day, and those limits survive a reload', () => {
    let s = W.freshState(NOW);
    let rubies = 0, chests = 0;
    for (let i = 0; i < V.REWARDS.roomPaysPerDay + 3; i++) {
        const r = W.dungeonRoomCleared(s, 'roots', 1 + (i % 3), NOW, Math.random, 1);
        rubies += r.rubies; if (Object.keys(r.mats).length) chests++;
        if (i === 2) { s = reload(s); assert.equal(s.dungeons.rooms, 3, 'the day\'s count is kept on reload (it used to reset)'); }
    }
    assert.ok(rubies > 0);
    assert.equal(s.dungeons.rooms, V.REWARDS.roomPaysPerDay);
    assert.equal(chests, V.REWARDS.essRoomsPerDay);
    for (const id in s.mats) if (D.MATERIALS_BY_ID[id].kind === 'essence') assert.ok(s.mats[id] > 0, 'banked: ' + id);
    assert.deepEqual(s.bag, {}, 'essences are never carried, so never lost');
    const r = W.dungeonRoomCleared(s, 'roots', 1, NOW, Math.random, 1);
    assert.ok(r.capped && !r.rubies);
    assert.ok(W.dungeonRoomCleared(s, 'roots', 1, NOW + DAY, Math.random, 1).rubies > 0, 'a new day pays again');
    // deeper dungeons pay more rubies a room; the Vault as it always did
    const a = W.freshState(NOW), b = W.freshState(NOW), c = W.freshState(NOW);
    assert.ok(W.dungeonRoomCleared(b, 'cistern', 2, NOW, Math.random, 1).rubies > W.dungeonRoomCleared(a, 'roots', 2, NOW, Math.random, 1).rubies);
    assert.equal(W.dungeonRoomCleared(c, 'vault', 2, NOW, Math.random, 1).rubies, V.REWARDS.vaultRoom * 2);
});

test('the chests: deeper dungeons, later rooms, luck and a bigger party give rarer essences; mythic stays mythic', () => {
    const rare = (id, room, luck, n) => { const w = V.rarityWeights(id, room, luck, n), t = w.reduce((a, b) => a + b, 0); return (w[2] + w[3] + w[4]) / t; };
    assert.ok(rare('cistern', 1, 0, 1) > rare('roots', 1, 0, 1), 'deeper');
    assert.ok(rare('roots', 3, 0, 1) > rare('roots', 1, 0, 1), 'later room');
    assert.ok(rare('roots', 1, 0.5, 1) > rare('roots', 1, 0, 1), 'luck');
    assert.ok(rare('roots', 1, 0, 4) > rare('roots', 1, 0, 1), 'party');
    const myth = (id, luck, n) => { const w = V.rarityWeights(id, 3, luck, n); return w[4] / w.reduce((a, b) => a + b, 0); };
    assert.ok(myth('cistern', 99, 4) < 0.002, 'a mythic essence from the best chest there is: under 1 in 500 (' + myth('cistern', 99, 4).toFixed(5) + ')');
    // the room chests never hand out another dungeon's own essence or any Heart
    const own = new Set(V.IDS.flatMap(id => [D.DUNGEONS[id].essence, D.DUNGEONS[id].heart]));
    let r = 1;
    const rng = () => { r = (r * 16807) % 2147483647; return r / 2147483647; };
    for (let i = 0; i < 2000; i++) {
        const got = V.chestRoll('tomb', 1 + (i % 3), rng, 0.2, 2);
        for (const id in got) { assert.ok(D.MATERIALS_BY_ID[id].kind === 'essence', id); if (own.has(id)) assert.equal(id, 'tomb_frost', 'only its own: ' + id); }
        assert.ok(Object.values(got).reduce((a, b) => a + b, 0) >= 1);
    }
});

test('a boss\'s first kill each week pays its Heart; later kills a little; the Drowned King still pays seals, Glory and a chest', () => {
    const s = W.freshState(NOW);
    const first = W.dungeonBossLoot(s, 'roots', seq(0.9), NOW, null, 1);
    assert.equal(first.first, true);
    assert.equal(W.count(s, 'heart_roots'), 1);
    assert.equal(W.count(s, 'catalyst'), 0, 'no catalyst on a high roll');
    assert.ok(first.rubies > 0);
    const again = W.dungeonBossLoot(s, 'roots', seq(0.99), NOW + 1000, null, 1);
    assert.equal(again.first, false);
    assert.equal(W.count(s, 'heart_roots'), 1, 'one Heart a week');
    assert.ok(again.rubies > 0 && again.rubies < first.rubies);
    assert.equal(W.dungeonBossLoot(reload(s), 'roots', seq(0.9), NOW + 2000, null, 1).first, false, 'the week is kept on reload');
    const lucky = W.dungeonBossLoot(s, 'deep', seq(0.01), NOW, null, 3);
    assert.equal(lucky.mats.catalyst, 1, 'a low roll: a Catalyst');
    assert.equal(W.dungeonBossLoot(s, 'roots', seq(0.9), NOW + 7 * DAY, null, 1).first, true, 'next week again');
    assert.equal(s.dungeons.kills.roots, 3);

    const glory0 = s.arena.glory, seals0 = W.count(s, 'vault_seal');
    const king = W.dungeonBossLoot(s, 'vault', seq(0.9), NOW, null, 2);
    assert.equal(king.first, true);
    assert.equal(W.count(s, 'vault_seal') - seals0, V.REWARDS.vaultKing.seals);
    assert.equal(s.arena.glory - glory0, V.REWARDS.vaultKing.glory);
    assert.equal(W.count(s, 'heart_vault'), 1);
    assert.ok(king.rubies >= V.REWARDS.vaultKing.rubies);
    assert.equal(s.raid.kills, 1);
    assert.equal(s.raid.duo, 1, 'with exactly two players (an achievement)');
    assert.equal(W.dungeonBossLoot(s, 'vault', seq(0.9), NOW + 1000, null, 3).rubies, V.REWARDS.kingRepeat);
    assert.equal(W.sell(s, 'vault_seal', 1), 0);
    assert.equal(W.sell(s, 'heart_vault', 1), 0, 'essences are never sold');
});

test('the dungeon save is cleaned on load, and the Vault\'s old record keeps its numbers', () => {
    const s = W.freshState(NOW);
    s.raid = { week: 'x'.repeat(50), kills: 7, duo: 2, roomsToday: { day: 7, n: 1e12 }, bought: { week: '2026-W45', n: { vault_mythic: 1, junk: 5 } } };
    s.dungeons = { day: 5, rooms: 1e9, ess: -3, weeks: { roots: '2026-W45', nowhere: 'x' }, kills: { roots: 4, deep: 'q' }, found: { roots: true, deep: 'yes' } };
    const back = reload(s);
    assert.equal(back.raid.kills, 7, 'kept (they used to reset to 0)');
    assert.equal(back.raid.duo, 2);
    assert.equal(back.raid.bought.n.vault_mythic, 1, 'the weekly Mythic Vault buy is kept');
    assert.ok(back.raid.week.length <= 12);
    assert.equal(back.dungeons.rooms, V.REWARDS.roomPaysPerDay);
    assert.equal(back.dungeons.ess, 0);
    assert.deepEqual(back.dungeons.weeks, { roots: '2026-W45' });
    assert.deepEqual(back.dungeons.kills, { roots: 4 });
    assert.deepEqual(back.dungeons.found, { roots: true });
    assert.deepEqual(reload(Object.assign(W.freshState(NOW), { dungeons: null })).dungeons, { day: '', rooms: 0, ess: 0, weeks: {}, kills: {}, found: {}, run: null }, 'an old save');
});

test('a run played alone is kept through a reload, between rooms', () => {
    // between rooms: as it stands; a room being fought or about to start: back to before it (as after a wipe)
    assert.deepEqual(V.checkpoint('roots', run('break', 2)), { id: 'roots', gen: 'g1', seed: 7, wave: 2, t: NOW });
    assert.equal(V.checkpoint('roots', run('fight', 3)).wave, 2, 'room 3 starts again');
    assert.equal(V.checkpoint('roots', run('ready', 1)).wave, 0);
    assert.equal(V.checkpoint('roots', run('over', 3)), null, 'the boss is down: the next run starts fresh');
    assert.equal(V.checkpoint('greenwood', run('break', 1)), null, 'not a dungeon');
    assert.equal(V.checkpoint('roots', null), null);
    // carried on: the same rooms cleared, its doors open, the next room the one after them
    const back = V.resumeRun(V.checkpoint('roots', run('fight', 3)), 'roots', NOW + 60000);
    assert.equal(V.cleared(back), 2);
    assert.equal(V.nextRoom(back), 3);
    assert.ok(V.doorOpen(back, 3) && !V.doorOpen(back, V.KING_ROOM));
    assert.equal(back.t, NOW + 60000, 'fresh again');
    assert.ok(V.kingOpen(V.resumeRun(V.checkpoint('roots', run('break', 3)), 'roots', NOW)), 'all three cleared: the boss waits');
    // only in its own dungeon, and not once it would have started over anyway
    assert.equal(V.resumeRun(V.checkpoint('roots', run('break', 2)), 'deep', NOW), null);
    assert.equal(V.resumeRun(V.checkpoint('roots', run('break', 2)), 'roots', NOW + V.RUN.idleResetMs + 1), null);
    // kept in the save, cleaned on load
    const s = W.freshState(NOW);
    s.dungeons.run = V.checkpoint('vault', run('break', 1));
    assert.deepEqual(reload(s).dungeons.run, s.dungeons.run);
    for (const bad of [{ id: 'nowhere', gen: 'g', seed: 1, wave: 1, t: NOW }, { id: 'roots', gen: 'g', seed: 1, wave: 9, t: NOW }, { id: 'roots', gen: '<x>', seed: 1, wave: 1, t: NOW }, 'junk']) {
        s.dungeons.run = bad;
        assert.equal(reload(s).dungeons.run, null, JSON.stringify(bad));
    }
});

test('stone and ore rarely hold essences: the crack and luck help, a mythic one stays very rare', () => {
    for (const [node, list] of Object.entries(D.NODE_ESSENCES)) {
        assert.equal(D.NODES[node].tool, 'pickaxe', node + ' is stone or ore');
        assert.ok(list.length >= 2 && list.length <= 3, node + ': 2 or 3');
        for (const [id, c] of list) { assert.equal(D.MATERIALS_BY_ID[id].kind, 'essence', id); assert.ok(c > 0 && c <= 0.05, node + ' ' + id); if (D.MATERIALS_BY_ID[id].rar >= 4) assert.ok(c <= 0.0005, id + ' mythic'); }
    }
    const pickaxeNodes = Object.keys(D.NODES).filter(n => D.NODES[n].tool === 'pickaxe');
    assert.deepEqual(Object.keys(D.NODE_ESSENCES).sort(), pickaxeNodes.sort(), 'every pickaxe node has its own');
    // a roll just above the plain chance: nothing; with the crack it lands
    const c = D.NODE_ESSENCES.rock[0][1];
    assert.deepEqual(W.nodeEssences('rock', seq(c * 1.2), 0, false), {});
    assert.deepEqual(W.nodeEssences('rock', seq(c * 1.2, 1, 1), 0, true), { flint_shard: 1 });
    assert.deepEqual(W.nodeEssences('rock', seq(c * 1.2, 1, 1), 0.5, false), { flint_shard: 1 }, 'luck');
    const m = D.NODE_ESSENCES.rock[2][1];
    assert.deepEqual(W.nodeEssences('rock', seq(1, 1, m * 1.6), 9, false), {}, 'luck raises a mythic chance at most x1.5');
    // mined: banked even outside town, and named in the loot
    const s = W.freshState(NOW);
    const got = W.nodeLoot(s, 'rock', seq(0, 0, 0, 0), NOW, { inTown: false });
    assert.equal(got.mats.flint_shard, 1);
    assert.equal(s.mats.flint_shard, 1);
    assert.ok(!s.bag.flint_shard);
    // and the bag's "where from" lists the stone and the dungeons
    assert.ok(W.materialSources('flint_shard').some(x => x.kind === 'node' && x.name === 'Rock'));
    assert.ok(W.materialSources('flint_shard').some(x => x.kind === 'dungeon'));
    assert.ok(W.materialSources('heart_tomb').some(x => x.kind === 'boss' && x.name === 'The Glacier Queen'));
});
