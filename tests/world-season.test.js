'use strict';
// Arena seasons (core/world-arena.js, core/world-logic.js): one calendar month in UTC, a soft rating reset at the turn, a
// reward for the best rank reached (5 rated matches or more), season titles, the season board's records.
const test = require('node:test');
const assert = require('node:assert/strict');
const A = require('../core/world-arena');
const W = require('../core/world-logic');

const NOV = Date.UTC(2026, 10, 15, 12, 0, 0);
const DEC = Date.UTC(2026, 11, 2, 12, 0, 0);
const P = (u, r = 1000) => ({ u, n: 'P' + u.slice(-3), r });
let mid = 0;
// a finished rated duel against a fresh opponent each time (so the daily repeat limit never kicks in)
function duel(s, won, now, oppRating = 1000) {
    const m = A.newMatch({ id: 'm' + (++mid) + 'abcd', mode: 'duel', stake: 0, ring: 1, t0: now, cap: 'uidAAAA', a: [P('uidAAAA', s.arena.rating)], b: [P('uidB' + String(mid).padStart(4, '0'), oppRating)] }, 'uidAAAA');
    m.result = won ? 'a' : 'b'; m.history = won ? ['a', 'a'] : ['b', 'b'];
    return W.arenaResult(s, m, now);
}

test('seasons are calendar months in UTC', () => {
    assert.equal(A.seasonOf(NOV), '2026-11');
    assert.equal(A.seasonOf(Date.UTC(2026, 10, 30, 23, 59, 59)), '2026-11');
    assert.equal(A.seasonOf(Date.UTC(2026, 11, 1, 0, 0, 0)), '2026-12');
    assert.equal(A.seasonEndsAt(NOV), Date.UTC(2026, 11, 1));
    assert.equal(A.seasonEndsAt(Date.UTC(2026, 11, 31, 5)), Date.UTC(2027, 0, 1), 'December turns into the next year');
    assert.equal(A.prevSeason('2027-01'), '2026-12');
    assert.equal(A.prevSeason('2026-11'), '2026-10');
    assert.equal(A.seasonKey('2026-11'), 's2026-11');
    assert.equal(A.seasonLabel('2026-11'), "Nov '26");
});

test('the soft reset moves a rating halfway back to the start', () => {
    assert.equal(A.softReset(1000), 1000);
    assert.equal(A.softReset(1600), 1300);
    assert.equal(A.softReset(800), 900);
    assert.equal(A.softReset(4000), 2500);
});

test('a season: its peak and record, then at the turn the reset, the result and one claim', () => {
    const s = W.freshState(NOV);
    for (let i = 0; i < 12; i++) duel(s, true, NOV, 1400);
    const peak = s.arena.season.peak;
    assert.equal(s.arena.season.id, '2026-11');
    assert.equal(s.arena.season.w, 12);
    assert.ok(peak >= 1250 && peak === s.arena.rating, 'climbed to at least Gold: ' + peak);
    duel(s, false, NOV, 900);
    assert.equal(s.arena.season.peak, peak, 'a loss doesn\'t lower the season\'s best');
    const before = s.arena.rating;

    assert.equal(A.rollSeason(s.arena, DEC), true);
    assert.equal(A.rollSeason(s.arena, DEC), false, 'only once');
    assert.equal(s.arena.rating, A.softReset(before));
    assert.equal(s.arena.season.id, '2026-12');
    assert.equal(s.arena.season.peak, s.arena.rating);
    assert.equal(s.arena.season.w, 0);
    const last = s.arena.seasonLast;
    assert.equal(last.id, '2026-11');
    assert.equal(last.games, 13);
    assert.equal(last.rank, A.rankFor(peak).id);
    assert.equal(last.claimed, false);

    const glory0 = s.arena.glory;
    const r = A.claimSeason(s.arena);
    assert.equal(r.ok, true);
    assert.equal(r.glory, A.SEASON.rewards[last.rank].glory);
    assert.equal(s.arena.glory, glory0 + r.glory, 'outside the daily caps');
    assert.ok(r.title && A.titlesOf(s.arena).includes(r.title), 'Gold or better: a season title');
    assert.match(r.title, /· Nov '26$/);
    assert.ok(r.title.length <= 24);
    assert.equal(s.arena.title, r.title, 'worn at once');
    assert.equal(A.claimSeason(s.arena).ok, false, 'once');
    assert.ok(s.arena.seasonBest >= A.RANKS.findIndex(x => x.id === 'gold') + 1);
});

test('fewer than 5 rated matches: no reward, but the reset still happens; a quiet month gives nothing', () => {
    const s = W.freshState(NOV);
    for (let i = 0; i < A.SEASON.minGames - 1; i++) duel(s, true, NOV, 1500);
    const r = s.arena.rating;
    A.rollSeason(s.arena, DEC);
    assert.equal(s.arena.rating, A.softReset(r));
    assert.equal(s.arena.seasonLast.games, A.SEASON.minGames - 1);
    assert.equal(A.claimSeason(s.arena).reason, 'games');
    // the next month without a match: the reset again, and nothing to claim for December
    A.rollSeason(s.arena, Date.UTC(2027, 0, 3));
    assert.equal(s.arena.seasonLast.id, '2026-11', 'an empty season leaves the last result alone');
    assert.equal(s.arena.season.id, '2027-01');
});

test('Bronze and Silver pay Glory without a title', () => {
    const s = W.freshState(NOV);
    for (let i = 0; i < 6; i++) duel(s, i % 2 === 0, NOV);
    A.rollSeason(s.arena, DEC);
    assert.ok(['bronze', 'silver'].includes(s.arena.seasonLast.rank));
    const r = A.claimSeason(s.arena);
    assert.equal(r.ok, true);
    assert.equal(r.title, '');
    assert.ok(r.glory > 0);
});

test('an existing save gets the current season and no reward; the clock going back changes nothing', () => {
    const old = W.freshState(NOV);
    old.arena.rating = 1500; old.arena.peak = 1500;
    delete old.arena.season; delete old.arena.seasonLast; delete old.arena.seasonTitles;
    const s = W.migrate(JSON.parse(JSON.stringify(old)), NOV);
    assert.equal(s.arena.season.id, '2026-11');
    assert.equal(s.arena.rating, 1500, 'no reset for the season it arrived in');
    assert.equal(s.arena.seasonLast, null);
    assert.equal(A.rollSeason(s.arena, Date.UTC(2026, 9, 1)), false, 'October after November: ignored');
    assert.equal(s.arena.season.id, '2026-11');
    // and a reload in December rolls it over
    const d = W.migrate(JSON.parse(JSON.stringify(s)), DEC);
    assert.equal(d.arena.season.id, '2026-12');
    assert.equal(d.arena.rating, A.softReset(1500));
});

test('season titles survive a reload; forged ones are dropped', () => {
    const s = W.freshState(NOV);
    s.arena.seasonTitles = { 'gold:2026-10': true, 'champion:2026-09': true };
    s.arena.title = A.seasonTitle('champion', '2026-09');
    const back = W.migrate(JSON.parse(JSON.stringify(s)), NOV);
    assert.deepEqual(Object.keys(back.arena.seasonTitles).sort(), ['champion:2026-09', 'gold:2026-10']);
    assert.equal(back.arena.title, "Champion · Sep '26");
    const forged = A.cleanArena({ seasonTitles: { 'bronze:2026-10': true, 'gold:9999-99': true, 'gold:2026-1': true, x: true }, title: 'Champion · Jan \'99' });
    assert.deepEqual(forged.seasonTitles, {});
    assert.equal(forged.title, '');
    const cleaned = A.cleanArena({ seasonLast: { id: 'nope', peak: 'x' }, season: { id: '2026-11', peak: 99999, w: -4 } });
    assert.equal(cleaned.seasonLast, null);
    assert.equal(cleaned.season.w, 0);
    assert.ok(cleaned.season.peak <= A.RULES.elo.max);
});

test('the season board: a record per player with their games, read back in rating order', () => {
    const s = W.freshState(NOV);
    for (let i = 0; i < 3; i++) duel(s, true, NOV);
    const rec = A.seasonRecord('Bobby', s.arena, NOV);
    assert.deepEqual(Object.keys(rec).sort(), ['g', 'l', 'n', 'r', 't', 'ti', 'w']);
    assert.equal(rec.g, 3);
    assert.equal(rec.r, s.arena.rating);
    const list = A.topList({ uidAAAAAA: rec, uidBBBBBB: Object.assign({}, rec, { n: 'Lower', r: 900 }), bad: { n: '<script>', r: 5 } }, 20);
    assert.deepEqual(list.map(r => r.n), ['Bobby', 'Lower']);
    assert.equal(list[0].g, 3);
});
