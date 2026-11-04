'use strict';
// The Arena: who may hit whom, ratings, the serverless match (every page runs its own copy), wagers, Glory and the shop
const test = require('node:test');
const assert = require('node:assert/strict');
const D = require('../core/world-data');
const A = require('../core/world-arena');
const W = require('../core/world-logic');

const NOW = new Date(2026, 10, 3, 12, 0, 0).getTime();
const P = (u, r = 1000) => ({ u, n: 'P' + u.slice(-3), r });
const ask = (over = {}) => Object.assign({ id: 'm1abc', mode: 'duel', stake: 0, ring: 1, t0: NOW, cap: 'uidAAAA', a: [P('uidAAAA')], b: [P('uidBBBB')] }, over);

test('who may hit whom: opposing players in a live round, or two players in the Pit, nobody else', () => {
    const map = { pit: { x: 0, y: 0, r: 300 } };
    const inPit = { uid: 'uidAAAA', x: 10, y: 0 }, inPit2 = { uid: 'uidBBBB', x: -10, y: 0 }, lobby = { uid: 'uidCCCC', x: 900, y: 0 };
    assert.equal(A.hitAllowed({ map, match: null, me: inPit, them: inPit2 }), true, 'both in the Pit');
    assert.equal(A.hitAllowed({ map, match: null, me: inPit, them: lobby }), false, 'one of them outside it');
    assert.equal(A.hitAllowed({ map, match: null, me: inPit, them: Object.assign({ inMatch: true }, inPit2) }), false, 'they are in a match');
    const m = A.newMatch(ask({ mode: 't2', a: [P('uidAAAA'), P('uidCCCC')], b: [P('uidBBBB'), P('uidDDDD')] }), 'uidAAAA');
    const me = { uid: 'uidAAAA', x: 5000, y: 0 };
    assert.equal(A.hitAllowed({ map, match: m, me, them: { uid: 'uidBBBB', x: 5000, y: 0 } }), false, 'not before the round starts');
    A.reduce(m, { type: 'tick', now: NOW });
    assert.equal(m.state, 'live');
    assert.equal(A.hitAllowed({ map, match: m, me, them: { uid: 'uidBBBB', x: 0, y: 0 } }), true, 'a foe, anywhere');
    assert.equal(A.hitAllowed({ map, match: m, me, them: { uid: 'uidCCCC', x: 0, y: 0 } }), false, 'never a teammate');
    assert.equal(A.hitAllowed({ map, match: m, me, them: { uid: 'uidEEEE', x: 0, y: 0 } }), false, 'nobody outside the match');
    A.reduce(m, { type: 'down', uid: 'uidBBBB', round: 1, t: NOW + 1000 });
    assert.equal(A.hitAllowed({ map, match: m, me, them: { uid: 'uidBBBB', x: 0, y: 0 } }), false, 'not someone already down');
});

test('ratings: Elo, the same change for every page, and ranks', () => {
    assert.equal(A.elo(1000, 1000, 1), 16);
    assert.equal(A.elo(1000, 1000, 0), -16);
    assert.ok(A.elo(1000, 1400, 1) > A.elo(1400, 1000, 1), 'beating someone better is worth more');
    assert.equal(A.teamRating([P('a', 1000), P('b', 1200)]), 1100);
    assert.equal(A.rankFor(1000).name, 'Bronze');
    assert.equal(A.rankFor(1400).name, 'Platinum');
    assert.equal(A.rankFor(1999).name, 'Champion');
    assert.equal(A.clampRating(99999), A.RULES.elo.max);
});

test('a duel, best of three: knockouts reported by the knocked-out page decide each round', () => {
    const m = A.newMatch(ask(), 'uidAAAA');
    assert.equal(m.team, 'a');
    let fx = A.reduce(m, { type: 'tick', now: NOW });
    assert.deepEqual(fx, [{ type: 'live', round: 1 }]);
    A.reduce(m, { type: 'down', uid: 'uidBBBB', round: 1, t: NOW + 20000 });
    fx = A.reduce(m, { type: 'tick', now: NOW + 20100 });
    assert.deepEqual(fx[0], { type: 'roundEnd', round: 1, winner: 'a', at: NOW + 20000 });
    assert.equal(m.state, 'break');
    // round 2 starts a fixed time after the knockout that ended round 1, on every page
    const next = NOW + 20000 + (A.RULES.breakSec + A.RULES.countdownSec) * 1000;
    assert.equal(m.liveAt, next);
    A.reduce(m, { type: 'down', uid: 'uidBBBB', round: 1, t: NOW + 30000 });
    assert.deepEqual(m.down, {}, 'a knockout for an old round is ignored');
    A.reduce(m, { type: 'tick', now: next });
    assert.equal(m.state, 'live');
    A.reduce(m, { type: 'down', uid: 'uidBBBB', round: 2, t: next + 5000 });
    fx = A.reduce(m, { type: 'tick', now: next + 5100 });
    assert.equal(fx.at(-1).type, 'end');
    assert.equal(m.result, 'a');
    const o = A.outcome(m, 1000, 0);
    assert.equal(o.won, true);
    assert.equal(o.ratingDelta, 16);
    // the loser's page, fed the same messages, agrees
    const b = A.newMatch(ask(), 'uidBBBB');
    for (const ev of [{ type: 'tick', now: NOW }, { type: 'down', uid: 'uidBBBB', round: 1, t: NOW + 20000 }, { type: 'tick', now: NOW + 20500 }, { type: 'tick', now: next },
        { type: 'down', uid: 'uidBBBB', round: 2, t: next + 5000 }, { type: 'tick', now: next + 9000 }]) A.reduce(b, ev);
    assert.equal(b.result, 'a');
    assert.equal(A.outcome(b, 1000, 0).ratingDelta, -16);
});

test('team battles: a round ends only when the whole team is down; a 3v3 invitation survives the trip', () => {
    const t3 = ask({ mode: 't3', a: [P('uidA001'), P('uidA002'), P('uidA003', 1200)], b: [P('uidB001'), P('uidB002'), P('uidB003')], cap: 'uidA001', stake: 250 });
    const back = A.unpackAsk('m1abc', A.packAsk(t3));
    assert.deepEqual(back, t3);
    assert.ok(A.packAsk(t3).length <= 400);
    const m = A.newMatch(back, 'uidB002');
    A.reduce(m, { type: 'tick', now: NOW });
    A.reduce(m, { type: 'down', uid: 'uidA001', round: 1, t: NOW + 1000 });
    A.reduce(m, { type: 'down', uid: 'uidA002', round: 1, t: NOW + 2000 });
    assert.deepEqual(A.reduce(m, { type: 'tick', now: NOW + 3000 }), [], 'one of them still stands');
    A.reduce(m, { type: 'down', uid: 'uidA003', round: 1, t: NOW + 4000 });
    assert.equal(A.reduce(m, { type: 'tick', now: NOW + 4100 })[0].winner, 'b');
});

test('a round nobody wins times out; a match that never ends is a draw and gives the stakes back', () => {
    const m = A.newMatch(ask({ stake: 500 }), 'uidAAAA');
    let t = NOW;
    for (let r = 0; r < A.RULES.maxRounds; r++) {
        A.reduce(m, { type: 'tick', now: m.liveAt });
        t = m.liveAt + (A.RULES.roundSec + A.RULES.graceSec) * 1000;
        A.reduce(m, { type: 'tick', now: t });
    }
    assert.equal(m.result, 'draw');
    const o = A.outcome(m, 1000, 0);
    assert.equal(o.draw, true);
    assert.equal(o.payout, 500);
    assert.equal(o.ratingDelta, 0);
});

test('leaving forfeits: a team that has all quit loses the match', () => {
    const m = A.newMatch(ask({ mode: 't2', a: [P('uidAAAA'), P('uidCCCC')], b: [P('uidBBBB'), P('uidDDDD')] }), 'uidAAAA');
    A.reduce(m, { type: 'tick', now: NOW });
    A.reduce(m, { type: 'quit', uid: 'uidBBBB', t: NOW + 500 });
    A.reduce(m, { type: 'tick', now: NOW + 600 });
    assert.equal(m.result, null, 'their teammate fights on');
    A.reduce(m, { type: 'quit', uid: 'uidDDDD', t: NOW + 900 });
    A.reduce(m, { type: 'tick', now: NOW + 1000 });
    assert.equal(m.result, 'a');
});

test('invitations that are wrong in any way are refused', () => {
    const ok = A.packAsk(ask());
    assert.ok(A.unpackAsk('m1abc', ok));
    assert.equal(A.unpackAsk('bad id!', ok), null);
    assert.equal(A.unpackAsk('m1abc', ok.replace('|0|', '|123|')), null, 'a stake that is not on the list');
    assert.equal(A.unpackAsk('m1abc', A.packAsk(ask({ b: [P('uidAAAA')] }))), null, 'the same player on both sides');
    assert.equal(A.unpackAsk('m1abc', A.packAsk(ask({ mode: 't2' }))), null, 'teams of the wrong size');
    assert.equal(A.unpackAsk('m1abc', A.packAsk(ask({ cap: 'uidZZZZ' }))), null, 'a captain who is not playing');
    assert.equal(A.cleanMsg({ from: 'uidAAAA', m: 'explode', t: 1 }), null);
    assert.deepEqual(A.cleanMsg({ from: 'uidAAAA', m: 'down', id: 'm1abc', x: '2', t: 5 }), { from: 'uidAAAA', m: 'down', id: 'm1abc', x: '2', t: 5 });
});

test('the queue: one matchmaker, closest ratings together, parties kept whole', () => {
    const q = [
        { uid: 'uid0004', n: 'D', r: 1500, aq: 'duel' }, { uid: 'uid0001', n: 'A', r: 1000, aq: 'duel' },
        { uid: 'uid0003', n: 'C', r: 1480, aq: 'duel' }, { uid: 'uid0002', n: 'B', r: 1010, aq: 'duel' },
        { uid: 'uid0010', n: 'P1', r: 1000, aq: 't2', pt: 'party1' }, { uid: 'uid0011', n: 'P2', r: 1000, aq: 't2', pt: 'party1' },
        { uid: 'uid0012', n: 'S1', r: 1000, aq: 't2' }, { uid: 'uid0013', n: 'S2', r: 1000, aq: 't2' },
    ];
    assert.equal(A.matchmaker(q), 'uid0001');
    const ms = A.pickMatches(q);
    const duels = ms.filter(m => m.mode === 'duel').map(m => [m.a[0].u, m.b[0].u].sort().join(','));
    assert.deepEqual(duels.sort(), ['uid0001,uid0002', 'uid0003,uid0004']);
    const t2 = ms.find(m => m.mode === 't2');
    const party = [t2.a, t2.b].find(team => team.some(p => p.u === 'uid0010'));
    assert.ok(party.some(p => p.u === 'uid0011'), 'the party plays together');
    assert.deepEqual(A.pickMatches(q.slice().reverse()), A.pickMatches(q), 'the same queue gives the same matches');
});

test('a wager: paid at the start, the pot to the winner, and a page closed mid-match counts as a loss', () => {
    const s = W.freshState(NOW);
    s.rubies = 1000;
    const m = A.newMatch(ask({ stake: 500 }), 'uidAAAA');
    assert.equal(W.arenaEscrow(s, m), true);
    assert.equal(s.rubies, 500);
    assert.ok(s.arena.live && s.arena.live.delta < 0);
    // closed now: reloading counts it as lost
    const re = W.migrate(JSON.parse(JSON.stringify(s)), NOW);
    assert.equal(re.arena.live, null);
    assert.equal(re.arena.l, 1);
    assert.equal(re.arena.rating, 1000 + s.arena.live.delta);
    assert.equal(re.rubies, 500, 'the stake stays paid');
    // played to the end and won instead
    m.result = 'a'; m.history = ['a', 'a'];
    const r = W.arenaResult(s, m, NOW);
    assert.equal(r.won, true);
    assert.equal(s.rubies, 500 + 1000 + A.RULES.rubyWin * W.furthestTier(s), 'the pot and the day\'s first-win rubies');
    assert.equal(s.arena.w, 1);
    assert.equal(s.arena.wagerWins, 1);
    assert.equal(s.arena.wagerNet, 500);
    assert.equal(s.arena.glory, A.GLORY.win + 2 * A.GLORY.roundWin);
    assert.equal(s.arena.live, null);
    assert.equal(W.arenaEscrow(Object.assign(W.freshState(NOW), { rubies: 10 }), m), false, "a stake you can't pay");
});

test('farming the same opponent stops paying after a few matches a day', () => {
    const s = W.freshState(NOW);
    let last;
    for (let i = 0; i < A.RULES.repeatLimit + 2; i++) {
        const m = A.newMatch(ask({ id: 'm1abc' + i }), 'uidAAAA');
        m.result = 'a'; m.history = ['a', 'a'];
        last = W.arenaResult(s, m, NOW);
    }
    assert.equal(last.counts, false);
    assert.equal(last.ratingDelta, 0);
    assert.equal(s.arena.w, A.RULES.repeatLimit + 2, 'the wins still count on the record');
    assert.ok(s.arena.rating < 1000 + 16 * (A.RULES.repeatLimit + 2));
});

test('Glory has a daily cap per source; the shop sells titles, supplies and one coffer a week inside the box allowance', () => {
    const s = W.freshState(NOW);
    for (let i = 0; i < 100; i++) W.pitKO(s, NOW);
    assert.equal(s.arena.glory, A.GLORY.cap.pit);
    assert.equal(s.arena.pitKO, 100);
    s.arena.glory = 2000;
    assert.equal(W.arenaBuy(s, 'title_gladiator', NOW).ok, true);
    assert.equal(s.arena.title, 'Gladiator');
    assert.equal(W.arenaBuy(s, 'title_gladiator', NOW).reason, 'owned');
    assert.equal(W.arenaBuy(s, 'potion_max', NOW).ok, true);
    assert.equal(s.cons.potion_max, 1);
    const before = s.outbox.length;
    assert.equal(W.arenaBuy(s, 'coffer', NOW, 0).ok, true);
    assert.equal(s.outbox.length, before + 1);
    assert.deepEqual(s.outbox.at(-1).boxes, [0, 0, 1, 0, 0]);
    assert.equal(s.caps.boxPts, D.BOX_POINTS[2]);
    assert.equal(W.arenaBuy(s, 'coffer', NOW, 0).reason, 'week');
    s.arena.glory = 0;
    assert.equal(W.arenaBuy(s, 'title_legend', NOW).reason, 'glory');
    // rank titles come from your best rating
    s.arena.peak = 1420;
    assert.ok(W.setTitle(s, 'Platinum'));
    assert.equal(W.setTitle(s, 'Champion'), false);
});

test('the leaderboard: only clean records, best first', () => {
    const top = A.topList({ uidAAAA: { n: 'Ann', r: 1300, w: 5, l: 1, ti: '', t: 1 }, uidBBBB: { n: 'Bob', r: 1500, w: 9, l: 2, t: 1 }, uidCCCC: { n: '<b>x</b>', r: 9000 }, 'bad uid': { n: 'Eve', r: 2000 } });
    assert.deepEqual(top.map(r => r.n), ['Bob', 'Ann']);
    const s = W.freshState(NOW);
    assert.deepEqual(Object.keys(A.topRecord('Me', s.arena, NOW)), ['n', 'r', 'w', 'l', 'ti', 't']);
});
