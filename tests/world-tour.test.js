'use strict';
// Tournaments: the bracket every page works out alike, fees and prizes through the save, and locked-tier kits
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const D = require('../core/world-data');
const T = require('../core/world-tour');
const Ar = require('../core/world-arena');
const W = require('../core/world-logic');

const NOW = 1.8e12, MIN = 60000, TID = 'cup2345678';
const U = ['uaaaaa', 'ubbbbb', 'uccccc', 'uddddd', 'ueeeee', 'ufffff', 'ugggggg', 'uhhhhh'];
// a record as the database holds it: n players signed up (the first has the best rating), started at NOW
function raw(n, opts = {}) {
    const r = Object.assign({ h: 'hostzz', hn: 'Host', n: 'Test Cup', fee: 100, size: 8, p2: 0, p3: 0, g: 0, t: NOW - 10 * MIN, at: NOW - MIN, st: 'run', go: NOW, e: {}, r: {} }, opts);
    U.slice(0, n).forEach((u, i) => { r.e[u] = { n: 'P' + i, r: 2000 - i * 10, t: NOW - 5 * MIN + i }; });
    if (r.st === 'run' && r.s === undefined) r.s = T.seedList(T.sanitizeTour(TID, r)).join(',');
    return r;
}
const tour = (r) => T.sanitizeTour(TID, r);
const say = (r, uid, slot, x, t) => { (r.r[uid] || (r.r[uid] = {}))[slot + (x === 'o' ? 'o' : 'v')] = { x, t }; };
const W_SEC = T.TOUR.windowSec * 1000, DSP = T.TOUR.disputeSec * 1000;

test('a host\'s choices: prizes go down from 1st to 3rd, fees and gear from the lists', () => {
    const ok = { n: 'Friday Cup', fee: 250, size: 8, p2: 20, p3: 10, g: 0, start: 5 };
    assert.ok(T.cleanOptions(ok));
    assert.ok(T.cleanOptions(Object.assign({}, ok, { g: 9 })), 'any tier can be locked');
    for (const bad of [{ p3: 30 }, { p2: 10, p3: 15 }, { fee: 123 }, { size: 6 }, { g: 10 }, { n: 'x' }, { start: 3 }]) assert.equal(T.cleanOptions(Object.assign({}, ok, bad)), null, JSON.stringify(bad));
    assert.deepEqual(T.shares(20, 10), [70, 20, 10]);
    for (const p2 of T.TOUR.second) for (const p3 of T.TOUR.third) if (p3 <= p2 && p2 + p3 <= 50) { const sh = T.shares(p2, p3); assert.ok(sh[0] >= sh[1] && sh[1] >= sh[2]); }
    const rec = T.newTour(ok, 'hostzz', 'Host', NOW);
    assert.equal(rec.st, 'open');
    assert.equal(rec.at, NOW + 5 * MIN);
});

test('seeding: best rating first, the top seeds get the byes and only meet late', () => {
    assert.deepEqual(T.positions(8), [1, 8, 4, 5, 2, 7, 3, 6]);
    const t = tour(raw(5));
    assert.deepEqual(t.seeds, U.slice(0, 5));
    const br = T.bracket(t, NOW + 1000);
    assert.equal(br.S, 8);
    // seeds 1-3 have byes; 4 v 5 plays
    const first = br.slots.slice(0, 4);
    assert.deepEqual(first.map(s => s.state), ['done', 'ready', 'done', 'done']);
    assert.deepEqual([first[1].a, first[1].b], [U[3], U[4]]);
    // seed 2 v 3 can play the semi at once; seed 1 waits for 4 v 5
    assert.equal(br.slots[5].state, 'ready');
    assert.equal(br.slots[4].state, 'wait');
    const p = T.myPairing(t, br, U[4]);
    assert.equal(p.foe, U[3]);
    assert.equal(p.captain, U[3], 'the better seed sends the invitation');
    // only the first `size` to sign up make it
    const full = tour(Object.assign(raw(8, { st: 'open' }), { size: 4 }));
    assert.equal(T.seedList(full).length, 4);
    assert.ok(T.seedList(full).every(u => U.slice(0, 4).includes(u)));
});

test('a pairing is decided by the earliest of: a loss, a dispute, a walkover nobody answered, its deadline', () => {
    const at = (r, now, slot = 0) => T.bracket(tour(r), now).slots[slot];
    // 2 players: one pairing, the final, ready at NOW
    let r = raw(2);
    assert.equal(at(r, NOW + 1000).state, 'ready');
    say(r, U[1], 0, 'l', NOW + 60000);
    let s = at(r, NOW + 61000);
    assert.equal(s.win, U[0]); assert.equal(s.how, 'played');
    assert.equal(s.settled, false, 'not final the moment it happens');
    assert.equal(at(r, NOW + 60000 + T.TOUR.settleSec * 1000).settled, true);
    // both say they won: both are out
    r = raw(2); say(r, U[0], 0, 'w', NOW + 60000); say(r, U[1], 0, 'w', NOW + 61000);
    s = at(r, NOW + 70000);
    assert.equal(s.state, 'void'); assert.equal(s.how, 'disputed');
    // a lone win stands only at the deadline (the loser's page may still say)
    r = raw(2); say(r, U[0], 0, 'w', NOW + 60000);
    assert.equal(at(r, NOW + 120000).state, 'ready');
    assert.equal(at(r, NOW + W_SEC).win, U[0]);
    // a walkover claim stands after the dispute time...
    r = raw(2); say(r, U[0], 0, 'o', NOW + 160000);
    assert.equal(at(r, NOW + 160000 + DSP - 1).state, 'ready');
    assert.equal(at(r, NOW + 160000 + DSP).win, U[0]);
    assert.equal(at(r, NOW + 160000 + DSP).how, 'walkover');
    // ...unless the other player answers in time ("I'm here"): then they play
    say(r, U[1], 0, 'o', NOW + 170000);
    assert.equal(at(r, NOW + 200000).state, 'ready');
    say(r, U[0], 0, 'l', NOW + 300000);
    assert.equal(at(r, NOW + 301000).win, U[1]);
    // an answer after the claim stood changes nothing
    r = raw(2); say(r, U[0], 0, 'o', NOW + 160000); say(r, U[1], 0, 'o', NOW + 160000 + DSP + 5000);
    assert.equal(at(r, NOW + 400000).win, U[0]);
    // nobody did anything: both are out at the deadline; results stamped outside the pairing don't count
    r = raw(2); say(r, U[1], 0, 'l', NOW - 5000); say(r, U[0], 0, 'l', NOW + W_SEC + 5000);
    s = at(r, NOW + W_SEC + 10000);
    assert.equal(s.state, 'void'); assert.equal(s.how, 'timeout');
});

test('a decision depends only on records stamped before it, so a late one can\'t undo a settled result', () => {
    const r = raw(4);
    say(r, U[3], 0, 'l', NOW + 50000);
    const before = T.bracket(tour(r), NOW + 50000 + T.TOUR.settleSec * 1000).slots[0];
    assert.equal(before.win, U[0]); assert.ok(before.settled);
    // anything written later (the rules keep a record's time within clockSlackMs of the server's) can't change it
    say(r, U[0], 0, 'w', NOW + 50000 + T.TOUR.settleSec * 1000 - T.TOUR.clockSlackMs + 1);
    say(r, U[3], 0, 'o', NOW + 50000 + T.TOUR.settleSec * 1000 - T.TOUR.clockSlackMs + 1);
    assert.equal(T.bracket(tour(r), NOW + 10 * MIN).slots[0].win, U[0]);
    assert.ok(T.TOUR.settleSec * 1000 > T.TOUR.clockSlackMs, 'settling waits out the clock slack');
});

test('a whole tournament: the winner takes the pot, or it is split; nobody is paid more than the pot', () => {
    // 4 players, 2nd 20%, 3rd 10% (a bronze match)
    const r = raw(4, { p2: 20, p3: 10, fee: 1000 });
    let t = tour(r), now = NOW + 1000;
    const br0 = T.bracket(t, now);
    assert.equal(br0.bronze, true);
    assert.equal(T.roundName(br0.S, 0, 0), 'Semi-final');
    assert.equal(T.roundName(br0.S, 1, 2), 'Final');
    assert.equal(T.roundName(br0.S, 1, 3), 'Bronze match');
    // semis: 1 beats 4, 2 beats 3
    say(r, U[3], 0, 'l', NOW + 60000); say(r, U[0], 0, 'w', NOW + 60000);
    say(r, U[2], 1, 'l', NOW + 70000); say(r, U[1], 1, 'w', NOW + 70000);
    t = tour(r);
    let br = T.bracket(t, NOW + 80000);
    assert.deepEqual([br.slots[2].a, br.slots[2].b], [U[0], U[1]]);
    assert.deepEqual([br.slots[3].a, br.slots[3].b], [U[3], U[2]], 'the semi-final losers play for 3rd');
    assert.equal(T.status(t, NOW + 80000), 'run');
    assert.ok(T.stillIn(t, br, U[3]), 'a semi-final loser still has the bronze match');
    // final: 2 wins; bronze: 4 wins
    say(r, U[0], 2, 'l', NOW + 200000); say(r, U[2], 3, 'l', NOW + 210000);
    t = tour(r); now = NOW + 210000 + T.TOUR.settleSec * 1000;
    br = T.bracket(t, now);
    assert.equal(br.done, true);
    assert.deepEqual([br.first, br.second, br.third], [U[1], U[0], U[3]]);
    assert.equal(T.status(t, now), 'done');
    const pay = T.payouts(t, br);
    assert.deepEqual(pay, { [U[1]]: 2800, [U[0]]: 800, [U[3]]: 400 });
    // winner takes all; and a final both missed gives everyone an equal part back
    const r2 = raw(2, { fee: 500 }), t2 = tour(r2), b2 = T.bracket(t2, NOW + W_SEC + 60000);
    assert.equal(b2.done, true); assert.equal(b2.first, null);
    assert.deepEqual(T.payouts(t2, b2), { [U[0]]: 500, [U[1]]: 500 });
    for (const n of [2, 3, 5, 7, 8]) {
        const rr = raw(n, { p2: 30, p3: 15, fee: 2500 }), tt = tour(rr), bb = T.bracket(tt, NOW + 10 * W_SEC);
        const total = Object.values(T.payouts(tt, bb)).reduce((a, v) => a + v, 0);
        assert.ok(total <= 2500 * n, 'never more than the pot (' + n + ')');
        assert.ok(bb.done);
    }
});

test('starting: the host once there are two, anyone signed up a minute after signups close; an old open one is off', () => {
    const r = raw(3, { st: 'open', at: NOW + 2 * MIN });
    delete r.s; delete r.go;
    const t = tour(r);
    assert.equal(T.status(t, NOW), 'open');
    assert.ok(T.canStart(t, 'hostzz', NOW));
    assert.ok(!T.canStart(t, U[1], NOW), 'not before signups close');
    assert.ok(!T.canStart(t, U[1], NOW + 2 * MIN + 30000));
    assert.ok(T.canStart(t, U[1], NOW + 2 * MIN + T.TOUR.lateStartSec * 1000 + 1));
    assert.ok(!T.canStart(t, 'someone', NOW + 10 * MIN), 'only entrants');
    assert.equal(T.status(t, NOW + 2 * MIN + T.TOUR.openMaxSec * 1000 + 1), 'off');
    assert.ok(!T.canStart(tour(raw(1, { st: 'open' })), 'hostzz', NOW), 'one player is no tournament');
    assert.equal(T.status(tour(raw(1)), NOW), 'off', 'started with one: off');
});

test('a tournament duel\'s invitation carries its pairing, never a stake', () => {
    assert.equal(T.tag(TID, 5, 3), TID + '~5~3');
    assert.deepEqual(T.parseTag(TID + '~5~3'), { tid: TID, slot: 5, g: 3 });
    for (const bad of ['', 'x~1~2', TID + '~1', TID + '~123~0']) assert.equal(T.parseTag(bad), null, bad);
    const ask = { id: 'abcd1234', mode: 'duel', stake: 0, ring: 1, t0: 5, cap: U[0], a: [{ u: U[0], n: 'A', r: 1000 }], b: [{ u: U[1], n: 'B', r: 1000 }], tour: T.tag(TID, 2, 0) };
    assert.deepEqual(Ar.unpackAsk('abcd1234', Ar.packAsk(ask)), ask);
    assert.equal(Ar.newMatch(ask, U[0]).tour, ask.tour);
    assert.equal(Ar.unpackAsk('abcd1234', Ar.packAsk(Object.assign({}, ask, { stake: 100 }))), null, 'no stake on a tournament duel');
    assert.ok(Ar.packAsk(ask).length <= 400);
});

test('the save: the fee is paid on signing up, back if it is called off or full, the prize paid once', () => {
    const fresh = () => { const s = W.freshState(NOW); s.rubies = 5000; return s; };
    const open = tour(Object.assign(raw(3, { st: 'open', at: NOW + MIN }), { s: undefined }));
    let s = fresh();
    assert.equal(W.tourJoin(s, open, NOW).ok, true);
    assert.equal(s.rubies, 4900);
    assert.equal(W.tourJoin(s, open, NOW).reason, 'joined');
    assert.equal(W.tourLeave(s, open.id), 100);
    assert.equal(s.rubies, 5000);
    s.rubies = 50;
    assert.equal(W.tourJoin(s, open, NOW).reason, 'rubies');
    // called off: the fee back
    s = fresh(); W.tourJoin(s, open, NOW);
    assert.deepEqual(W.tourSeen(s, tour(Object.assign(raw(3, { st: 'off' }), {})), TID, U[0], NOW), { kind: 'off', rubies: 100, place: 0 });
    assert.equal(s.rubies, 5000); assert.equal(s.arena.tours[TID], undefined);
    // signed up too late (not in the bracket): the fee back
    s = fresh(); W.tourJoin(s, open, NOW);
    const r = raw(2); r.e.ulateuu = { n: 'Late', r: 1, t: NOW };
    assert.equal(W.tourSeen(s, tour(r), TID, 'ulateuu', NOW + 1000).kind, 'cut');
    assert.equal(s.rubies, 5000);
    // in it: started, then paid once
    s = fresh(); W.tourJoin(s, open, NOW);
    const r4 = raw(4, { fee: 100 });
    assert.equal(W.tourSeen(s, tour(r4), TID, U[0], NOW + 1000).kind, 'started');
    assert.equal(W.tourSeen(s, tour(r4), TID, U[0], NOW + 2000), null, 'nothing new');
    say(r4, U[3], 0, 'l', NOW + 5000); say(r4, U[2], 1, 'l', NOW + 6000); say(r4, U[1], 2, 'l', NOW + 9000);
    const done = NOW + 9000 + T.TOUR.settleSec * 1000;
    const got = W.tourSeen(s, tour(r4), TID, U[0], done);
    assert.deepEqual(got, { kind: 'paid', rubies: 400, place: 1 });
    assert.equal(s.rubies, 4900 + 400);
    assert.equal(W.tourSeen(s, tour(r4), TID, U[0], done + 1000), null, 'paid once');
    assert.deepEqual([s.arena.tourPlayed, s.arena.tourWins, s.arena.tourPrize], [1, 1, 400]);
    // it survives a reload
    const back = W.migrate(JSON.parse(W.serialize(s, done, null)), done);
    assert.equal(back.arena.tours[TID].st, 'done');
    assert.equal(W.tourSeen(back, tour(r4), TID, U[0], done + 2000), null);
    // a record that is gone: the fee back if it never started, nothing if it did
    s = fresh(); W.tourJoin(s, open, NOW);
    assert.equal(W.tourSeen(s, null, TID, U[0], NOW).kind, 'off');
    s = fresh(); W.tourJoin(s, open, NOW); W.tourSeen(s, tour(raw(4)), TID, U[0], NOW + 1000);
    assert.equal(W.tourSeen(s, null, TID, U[0], NOW + 2000).kind, 'gone');
    assert.equal(s.rubies, 4900);
});

test('a locked-tier kit: everyone fights with the same gear, and their own comes back untouched', () => {
    const s1 = W.freshState(NOW), s2 = W.freshState(NOW);
    // s2 has much better gear of its own
    const sw = W.addGear(s2, 'sword_8', 100, ['keen'], NOW); s2.hotbar[0] = sw.uid;
    const ch = W.addGear(s2, 'chest_9', 100, [], NOW); s2.equip.chest = ch.uid;
    const rg = W.addGear(s2, 'ring_star', 100, [], NOW); s2.equip.ring = rg.uid;
    const own = JSON.stringify({ g: s2.gear, e: s2.equip, h: s2.hotbar, sel: s2.sel });
    assert.ok(W.lendKit(s1, 6) && W.lendKit(s2, 6));
    assert.equal(W.lendKit(s2, 6), false, 'once');
    const st1 = W.playerStats(s1), st2 = W.playerStats(s2);
    assert.equal(st1.maxHp, st2.maxHp); assert.equal(st1.armor, st2.armor);
    assert.equal(W.findGear(s2, s2.hotbar[0]).base, 'sword_6');
    assert.deepEqual(W.findGear(s2, s2.hotbar[0]).aff, []);
    assert.equal(s2.equip.ring, null);
    assert.equal(W.gearStats(W.findGear(s2, s2.hotbar[0])).dmg, W.gearStats(W.findGear(s1, s1.hotbar[0])).dmg);
    // the save keeps their own gear, never the kit
    const saved = JSON.parse(W.serialize(s2, NOW, null));
    assert.equal(JSON.stringify({ g: saved.gear, e: saved.equip, h: saved.hotbar, sel: saved.sel }), own);
    // something made meanwhile is theirs
    const made = W.addGear(s2, 'boots_2', 60, [], NOW);
    assert.ok(made && !s2.gear.includes(made));
    assert.ok(W.returnKit(s2));
    assert.ok(s2.gear.includes(made));
    assert.equal(W.findGear(s2, s2.hotbar[0]).base, 'sword_8');
    assert.equal(W.returnKit(s2), false);
    // every class's weapon has a kit at every tier
    for (let t = 1; t <= D.MAX_TIER; t++) for (const b of D.GEAR.filter(x => x.slot === 'weapon' && x.tier === 1)) {
        const s = W.freshState(NOW), it = W.addGear(s, b.id, 50, [], NOW); s.hotbar = [it.uid, null, null, null, null]; s.sel = 0;
        W.lendKit(s, t);
        assert.equal(D.GEAR_BY_ID[W.findGear(s, s.hotbar[0]).base].cls, b.cls, b.id + ' at tier ' + t);
    }
});

test('the rules: tournaments, results written once by their own player, stamped with the server\'s time', () => {
    const rules = JSON.parse(fs.readFileSync(path.join(__dirname, '..', 'database.rules.json'), 'utf8')).rules;
    const tr = rules.wilds.v1.arena.tour;
    assert.equal(T.TOUR.root, 'wilds/v1/arena/tour');
    assert.match(tr.$tid['.write'], /newData\.child\('h'\)\.val\(\) === auth\.uid/, 'opened only in your own name');
    assert.match(tr.$tid['.write'], /1209600000/, 'anyone may tidy one away after keepDays');
    assert.equal(1209600000, T.TOUR.keepDays * 86400000);
    const rk = tr.$tid.r.$uid.$key;
    assert.match(rk['.write'], /auth\.uid === \$uid && !data\.exists\(\)/, 'your own, once');
    assert.match(rk['.validate'], new RegExp('now \\+ ' + T.TOUR.clockSlackMs + ' && .*now - ' + T.TOUR.clockSlackMs));
    for (const k of ['0v', '14o', '3v']) assert.ok(/^[0-9]{1,2}(v|o)$/.test(k) && T.resultKey(Number(k.slice(0, -1)), k.slice(-1)) === k);
    assert.match(tr.$tid.e.$uid['.write'], /auth\.uid === \$uid && .*'open'/, 'sign yourself up, while it is open');
    assert.ok(new RegExp(tr.$tid['.validate'].match(/matches\(\/(.*?)\/\)/)[1]).test(T.newTid()));
    // what the rules allow covers what the game writes
    const fee = Number(tr.$tid.fee['.validate'].match(/<= (\d+)/)[1]);
    assert.equal(fee, Math.max(...T.TOUR.fees));
    assert.equal(Number(tr.$tid.size['.validate'].match(/<= (\d+)/)[1]), Math.max(...T.TOUR.sizes));
    assert.equal(Number(tr.$tid.g['.validate'].match(/<= (\d+)/)[1]), D.MAX_TIER);
    const sMax = Number(tr.$tid.s['.validate'].match(/<= (\d+)/)[1]);
    assert.ok(sMax >= Math.max(...T.TOUR.sizes) * 65, 'room for a full seeding of the longest ids');
    // the waves board: your own record
    assert.match(rules.wilds.v1.arena.waves.$uid['.write'], /auth\.uid === \$uid/);
});

test('a start seen in parts (st first, the seeding a moment later) refunds nobody', () => {
    const s = W.freshState(NOW); s.rubies = 1000;
    const open = tour(Object.assign(raw(2, { st: 'open', at: NOW + MIN }), { s: undefined }));
    W.tourJoin(s, open, NOW);
    const half = raw(2, { st: 'run' }); delete half.s; delete half.go;
    assert.equal(T.status(tour(half), NOW), 'starting');
    assert.equal(W.tourSeen(s, tour(half), TID, U[0], NOW), null, 'no refund for a start not fully seen');
    assert.equal(s.rubies, 900);
    assert.equal(W.tourSeen(s, tour(raw(2)), TID, U[0], NOW + 1000).kind, 'started');
    // one stuck like that for good is off, like an open one never started
    assert.equal(T.status(tour(half), half.at + T.TOUR.openMaxSec * 1000 + 1), 'off');
});
