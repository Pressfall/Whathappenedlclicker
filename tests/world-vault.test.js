'use strict';
// The Sunken Vault (core/world-vault.js, core/world-logic.js): the same monsters on every page, scaling with the party, the
// rooms' doors, wipes, who may come in, and the rewards with their limits.
const test = require('node:test');
const assert = require('node:assert/strict');
const D = require('../core/world-data');
const V = require('../core/world-vault');
const W = require('../core/world-logic');
const G = require('../core/world-gen');

const NOW = new Date(2026, 10, 5, 12, 0, 0).getTime();
const DAY = 86400000;
const run = (st, wave) => ({ gen: 'g1', seed: 7, start: 1, wave, st, n: 2, at: NOW, t: NOW });

test('rooms: the same monsters for the same run on every page, from the room\'s own zones, more and tougher with more players', () => {
    for (let room = 1; room <= V.ROOMS.length; room++) {
        const a = V.roomComposition(12345, room, 2), b = V.roomComposition(12345, room, 2);
        assert.deepEqual(a, b);
        const zones = V.ROOMS[room - 1].zones;
        const allowed = new Set(zones.flatMap(z => D.ZONES[z].spawns.map(s => s[0]).concat(D.ZONES[z].elite)));
        for (const m of a) {
            assert.ok(allowed.has(m.type), room + ': ' + m.type);
            assert.match(m.mid, V.MID_RE);
            assert.ok(D.MONSTERS[m.type]);
        }
        assert.equal(new Set(a.map(m => m.mid)).size, a.length, 'ids are unique');
        const four = V.roomComposition(12345, room, 4);
        assert.ok(four.length > a.length, 'more monsters for four');
        assert.ok(four[0].hpMult > a[0].hpMult && four[0].dmgMult > a[0].dmgMult, 'tougher for four');
        assert.notDeepEqual(V.roomComposition(999, room, 2).map(m => m.type), a.map(m => m.type));
    }
    assert.ok(V.roomComposition(1, 3, 2).some(m => m.champion), 'the Sky Breach has its champion');
    assert.deepEqual(V.roomComposition(1, 4, 2), [], 'no room 4: that is the King');
    assert.ok(V.bossHp(100000, 4) > V.bossHp(100000, 2) && V.bossHp(100000, 2) > V.bossHp(100000, 1));
    assert.equal(V.bossHp(100000, 9), V.bossHp(100000, V.PARTY.max), 'at most a full party');
});

test('doors: a room seals while it is fought, the next opens once it is cleared, the King after the third', () => {
    const open = (r) => [1, 2, 3, 4].map(i => V.doorOpen(r, i) ? 1 : 0).join('');
    assert.equal(open(null), '1000');
    assert.equal(open(V.newRun(NOW, () => 0.5)), '1000');
    assert.equal(open(run('ready', 1)), '1000');
    assert.equal(open(run('fight', 1)), '0000', 'sealed in');
    assert.equal(open(run('break', 1)), '1100');
    assert.equal(open(run('fight', 2)), '1000');
    assert.equal(open(run('break', 2)), '1110');
    assert.equal(open(run('break', 3)), '1111');
    assert.equal(open(run('over', 4)), '1111');
    assert.equal(V.nextRoom(null), 1);
    assert.equal(V.nextRoom(run('break', 1)), 2);
    assert.equal(V.nextRoom(run('break', 3)), 0, 'the King next');
    assert.equal(V.nextRoom(run('fight', 2)), 0, 'not while a room is going');
    assert.equal(V.kingOpen(run('break', 3)), true);
    assert.equal(V.kingOpen(run('break', 2)), false);
    assert.equal(V.kingOpen(run('over', 4)), false, 'not again once he is down');
});

test('a wipe sends the party back to before that room only; a quiet run starts over', () => {
    assert.deepEqual(V.wiped(run('fight', 3)), { st: 'break', wave: 2 });
    assert.deepEqual(V.wiped(run('fight', 1)), { st: 'break', wave: 0 });
    assert.equal(V.runNeedsReset(run('break', 2), NOW + 10 * 60 * 1000), false, 'a ten-minute walk is fine');
    assert.equal(V.runNeedsReset(run('break', 2), NOW + V.RUN.idleResetMs + 1), true);
    assert.equal(V.runNeedsReset(null, NOW), true);
});

test('who may come in: a party of 2 to 4 that has reached the Far Reaches; one copy of the Vault per party', () => {
    assert.deepEqual(V.mayEnter(2, true), { ok: true });
    assert.deepEqual(V.mayEnter(4, true), { ok: true });
    assert.equal(V.mayEnter(0, true).reason, 'party');
    assert.equal(V.mayEnter(1, true).reason, 'party');
    assert.equal(V.mayEnter(5, true).reason, 'size');
    assert.equal(V.mayEnter(3, false).reason, 'reach');
    assert.equal(V.instanceKey('abcd2345ef'), 'vault_abcd2345ef');
    assert.equal(V.instanceKey('../x'), null);
    const s = W.freshState(NOW);
    assert.equal(W.vaultReached(s), false);
    s.unlocked.zones.coast = true;
    assert.equal(W.vaultReached(s), true);
});

test('the zone, the King and the Vault Seal are in the data, and the map has three rooms and the King\'s chamber', () => {
    const z = D.ZONES[V.ZONE];
    assert.equal(z.instance, true);
    assert.equal(z.boss, V.BOSS);
    assert.equal(z.pvp, 'off');
    const k = D.BOSSES[V.BOSS];
    assert.ok(k && k.vault && k.phases.length === 3);
    assert.ok(k.phases.flat().includes('burden'), 'the King has the Shared Burden');
    const seal = D.MATERIALS_BY_ID.vault_seal;
    assert.equal(seal.kind, 'key', 'never dropped on death or sold');
    assert.equal(seal.sell, 0);
    const m = G.generateZone(V.ZONE);
    assert.equal(m.rooms.length, V.ROOMS.length);
    for (const r of m.rooms) { assert.ok(r.ready && r.floor && r.gates.length === 4, r.i); assert.ok(r.door.tiles.length > 0, 'room ' + r.i + ' has a door'); }
    assert.ok(m.boss && m.kingDoor && m.kingDoor.tiles.length > 0);
    assert.equal(G.mapHash(G.generateZone(V.ZONE)), G.mapHash(m), 'the same map every time');
    // doors: closed by default, opened and shut again
    const t = m.rooms[1].door.tiles[0];
    G.setVaultDoor(m, 2, true);
    assert.equal(m.tiles[t[1] * m.w + t[0]], t[2], 'open: the floor is back');
    G.setVaultDoor(m, 2, false);
    assert.notEqual(m.tiles[t[1] * m.w + t[0]], t[2], 'shut again');
});

test('rewards: rubies per room up to a daily limit; the King\'s first kill of the week pays the most, later ones a little', () => {
    const s = W.freshState(NOW);
    let rubies = 0;
    for (let i = 0; i < V.REWARDS.roomPaysPerDay + 3; i++) rubies += W.vaultRoomCleared(s, 1 + (i % 3), NOW).rubies;
    assert.ok(rubies > 0);
    assert.equal(s.raid.roomsToday.n, V.REWARDS.roomPaysPerDay, 'only so many rooms a day pay');
    assert.ok(W.vaultRoomCleared(s, 1, NOW + DAY).rubies > 0, 'a new day pays again');

    const glory0 = s.arena.glory, seals0 = W.count(s, 'vault_seal');
    const first = W.vaultKingLoot(s, NOW, null, 2);
    assert.equal(first.first, true);
    assert.equal(W.count(s, 'vault_seal') - seals0, V.REWARDS.king.seals);
    assert.equal(s.arena.glory - glory0, V.REWARDS.king.glory);
    assert.ok(first.rubies >= V.REWARDS.king.rubies);
    assert.equal(s.raid.kills, 1);
    assert.equal(s.raid.duo, 1, 'with exactly two players');
    const again = W.vaultKingLoot(s, NOW + 1000, null, 3);
    assert.equal(again.first, false);
    assert.equal(W.count(s, 'vault_seal') - seals0, V.REWARDS.king.seals, 'no more seals that week');
    assert.ok(again.rubies > 0 && again.rubies < first.rubies);
    assert.equal(s.raid.kills, 2);
    const nextWeek = W.vaultKingLoot(s, NOW + 7 * DAY, null, 4);
    assert.equal(nextWeek.first, true);
    // nothing for the room monsters themselves
    assert.equal(W.sell(s, 'vault_seal', 1), 0);
});

test('the Vault save is cleaned on load', () => {
    const s = W.freshState(NOW);
    s.raid = { week: 'x'.repeat(50), cleared: 'yes', kills: -3, duo: 'q', roomsToday: { day: 7, n: 1e12 } };
    const back = W.migrate(JSON.parse(JSON.stringify(s)), NOW);
    assert.equal(back.raid.kills, 0);
    assert.equal(back.raid.duo, 0);
    assert.ok(back.raid.week.length <= 12);
    assert.ok(back.raid.roomsToday.n <= V.REWARDS.roomPaysPerDay);
});
