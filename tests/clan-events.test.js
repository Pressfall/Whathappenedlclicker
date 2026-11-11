'use strict';
// Clan events (core/clan-events.js): the schedule, what each event counts, and what a player gets when one is over.
const test = require('node:test');
const assert = require('node:assert/strict');
const EV = require('../core/clan-events');
const L = require('../core/clan-levels');

const DAY = 864e5, START = 1_700_000_000_000;
const inc = (n) => ({ inc: n });
const seq = (...xs) => { let i = 0; return () => xs[i++ % xs.length]; };
const prog = (start, byClan) => ({ events: { [start]: byClan } });

test('events are recognised by name or type; downtime never', () => {
    const kinds = [['Bossfight', 'bf'], ['Endless boss', 'eb'], ['ClanVClan clicks', 'cvc'], ['Clan Race', 'race'], ['prestige party', 'pp'], ['construction event', 'con']];
    for (const [name, kind] of kinds) assert.equal(EV.kindOf({ name }), kind, name);
    assert.equal(EV.kindOf({ name: 'x', type: 'clan_race' }), 'race');
    assert.equal(EV.kindOf({ name: 'DOWNTIME', isDowntime: true }), null);
    assert.equal(EV.kindOf({ name: 'Mystery' }), null);
    for (const t of EV.DEFAULT_TYPES) assert.ok(EV.kindOf({ name: t }), 'every default type is an event: ' + t);
});

// ---- the schedule ----
test('a fresh schedule: 8 slots from now, events and downtime in turn, never the same event twice in a row', () => {
    const r = EV.rollSchedule([], START, EV.DEFAULT_TYPES, seq(0.1, 0.5, 0.9, 0.3));
    assert.equal(r.upcoming.length, EV.SCHEDULE_LEN);
    assert.equal(r.upcoming[0].start, START);
    r.upcoming.forEach((it, i) => {
        assert.equal(!!it.isDowntime, i % 2 === 1);
        assert.equal(it.end - it.start, it.isDowntime ? 2 * DAY : 3 * DAY);
        if (i) assert.equal(it.start, r.upcoming[i - 1].end, 'no gaps');
    });
    const events = r.upcoming.filter((it) => !it.isDowntime).map((it) => EV.kindOf(it));
    for (let i = 1; i < events.length; i++) assert.notEqual(events[i], events[i - 1]);
});

test('rolling on: every event that ended is reported, even several at once, and the schedule refills from where it was', () => {
    const first = EV.rollSchedule([], START, EV.DEFAULT_TYPES, seq(0.2)).upcoming;
    const later = START + 11 * DAY; // two events and two rests are over
    const r = EV.rollSchedule(first, later, EV.DEFAULT_TYPES, seq(0.7));
    assert.equal(r.ended.length, 2, 'both events, not just the first');
    assert.ok(r.ended.every((e) => !e.isDowntime));
    assert.ok(r.changed);
    assert.equal(r.upcoming[0].start, first[4].start, 'what is still to come keeps its times');
    assert.equal(r.upcoming.length, EV.SCHEDULE_LEN);
    assert.equal(EV.rollSchedule(r.upcoming, later, EV.DEFAULT_TYPES).changed, false, 'nothing more to do');
    const gone = EV.rollSchedule(first, START + 100 * DAY, EV.DEFAULT_TYPES);
    assert.equal(gone.upcoming[0].start, START + 100 * DAY, 'a schedule that ran out starts again now');
    assert.equal(gone.ended.length, 4);
});

test('an admin skip ends the event now and starts the chosen slot now', () => {
    const up = EV.rollSchedule([], START, EV.DEFAULT_TYPES, seq(0.1)).upcoming;
    const now = START + DAY;
    const r = EV.skipSchedule(up, now, 2, EV.DEFAULT_TYPES);
    assert.equal(r.ended.length, 1);
    assert.equal(r.ended[0].end, now);
    assert.equal(r.upcoming[0].start, now);
    assert.equal(r.upcoming[0].name, up[2].name);
    const next = EV.skipSchedule(up, now, -1, EV.DEFAULT_TYPES);
    assert.ok(next.upcoming[0].isDowntime, 'by default the next slot (the rest) starts');
});

test('ended events are kept as a short history (older documents held only one)', () => {
    const legacy = { name: 'Bossfight', start: START, end: START + 3 * DAY, type: 'bossfight' };
    assert.deepEqual(EV.history(legacy).map((r) => r.start), [START]);
    let doc = legacy;
    for (let i = 1; i <= 12; i++) doc = EV.withEnded(doc, [{ name: 'Clan Race', start: START + i * 5 * DAY, end: START + i * 5 * DAY + 3 * DAY, result: { groups: [] } }], START + 100 * DAY);
    const h = EV.history(doc);
    assert.equal(h.length, EV.HISTORY_MAX);
    assert.equal(h[h.length - 1].start, START + 60 * DAY);
    assert.equal(doc.start, START + 60 * DAY, 'the newest is also at the top, for older pages');
    assert.deepEqual(h[h.length - 1].result, { groups: [] });
    const early = EV.withEnded(null, [{ name: 'Bossfight', start: START, end: START + 3 * DAY }], START + DAY);
    assert.equal(early.recent[0].end, START + DAY, 'ended early: over now, not at its old end');
    assert.deepEqual(EV.withEnded(early, [{ name: 'Bossfight', start: START, end: START + 3 * DAY }], START + DAY).recent.length, 1, 'never twice');
});

// ---- rewards ----
const base = { clanId: 'c1', username: 'me', clanLevel: 1, eventGems: L.eventGems };
const ev = { start: START };
test('Prestige Party: every tier reached pays, and the top three get a bonus', () => {
    const r = EV.rewardFor('pp', ev, Object.assign({}, base, { progress: prog(START, { c1: { total: 45, members: { me: 20, a: 15, b: 10 } } }) }));
    assert.deepEqual([r.gems, r.clanXp, r.clanPoints], [5 + 10 + 15, 150, 35 + 10]);
    assert.equal(r.bonusGems, 15);
    assert.equal(EV.rewardFor('pp', ev, Object.assign({}, base, { progress: prog(START, { c1: { total: 19, members: {} } }) })), null, 'below the first tier: nothing');
    assert.equal(EV.rewardFor('pp', ev, Object.assign({}, base, { progress: prog(START, { c1: 25 }) })).gems, 5, 'older documents stored a bare number');
});

test('Bossfight: by the phase reached, or by damage when no phases were recorded; never for no damage', () => {
    const meta = { totalHp: 1000, phaseHps: [250, 500, 750, 1000] };
    const at = (dmg, m) => EV.rewardFor('bf', ev, Object.assign({}, base, { username: 'x', meta: m, progress: prog(START, { c1: { total: dmg, members: {} } }) }));
    assert.equal(at(600, meta).gems, 12, 'phase 2');
    assert.equal(at(1000, meta).gems, 45, 'beaten');
    assert.equal(at(100, meta).gems, 3, 'not even phase 1: the damage tiers');
    assert.equal(at(2e7, null).gems, 15);
    assert.equal(at(0, meta), null);
});

test('Endless Boss and Construction pay their highest tier; clan level raises the gems', () => {
    const e = EV.rewardFor('eb', ev, Object.assign({}, base, { meta: { baseHp: 100 }, progress: prog(START, { c1: { total: 100 + 145 + 210.25 + 1, members: {} } }) }));
    assert.match(e.text, /3 bosses/);
    assert.equal(e.gems, 12);
    const c = EV.rewardFor('con', ev, Object.assign({}, base, { clanLevel: 20, progress: prog(START, { c1: { total: 310, members: { me: { points: 310 } } } }) }));
    assert.equal(c.gems, Math.round(25 * 1.15), 'level 20: +15% event gems');
    assert.equal(c.clanPoints, 55);
});

test('Clan v Clan: the winner, the loser, a draw, and a clan that met the Bot Clan', () => {
    const pairing = { pairs: [[{ id: 'c1', name: 'One' }, { id: 'c2', name: 'Two' }], [{ id: 'c3', name: 'Three' }, EV.BOT]] };
    const p = prog(START, { c1: { total: 900, members: {} }, c2: { total: 500, members: {} }, c3: { total: 1, members: {} } });
    const for_ = (clanId, progress) => EV.rewardFor('cvc', ev, Object.assign({}, base, { clanId, pairing, progress: progress || p }));
    assert.equal(for_('c1').result, 'win');
    assert.equal(for_('c2').result, 'lose');
    assert.equal(for_('c3').result, 'win', 'any click beats the bot');
    assert.equal(for_('c3', prog(START, {})).result, 'draw');
    assert.equal(for_('c9').result, 'draw', 'not in the pairing: the small reward for taking part');
    assert.equal(EV.rewardFor('cvc', ev, Object.assign({}, base, { pairing: null, progress: p })), null, 'no pairing: nothing');
    // a pairing from before the per-event counts kept its own totals
    const old = { pairs: pairing.pairs, totals: { c1: 3, c2: 9 } };
    assert.equal(EV.rewardFor('cvc', ev, Object.assign({}, base, { pairing: old, progress: null })).result, 'lose');
});

test('Clan Race: the place in the group decides, bots are not counted', () => {
    const pairing = { groups: [[{ id: 'c1' }, { id: 'c2' }, { id: 'c3' }, EV.BOT]] };
    const p = prog(START, { c1: { total: 120, members: {} }, c2: { total: 400, members: {} }, c3: { total: 50, members: {} } });
    const r = EV.rewardFor('race', ev, Object.assign({}, base, { pairing, progress: p }));
    assert.equal(r.place, 2);
    assert.equal(r.gems, 25);
    assert.equal(EV.rewardFor('race', ev, Object.assign({}, base, { clanId: 'c3', pairing, progress: p })).place, 3);
});

// ---- pairing ----
test('pairing: clans of a similar level meet, empty clans sit out, the odd one meets the bot', () => {
    const clans = [{ id: 'a', level: 1, size: 3 }, { id: 'b', level: 9, size: 5 }, { id: 'c', level: 8, size: 2 }, { id: 'd', level: 2, size: 1 }, { id: 'e', level: 5, size: 0 }, { id: 'f', level: 4, size: 4 }];
    const { pairs } = EV.pairClans(clans);
    assert.deepEqual(pairs.map((p) => p.map((c) => c.id)), [['b', 'c'], ['f', 'd'], ['a', EV.BOT_ID]]);
    const { groups } = EV.groupClans(clans, 4);
    assert.deepEqual(groups.map((g) => g.map((c) => c.id)), [['b', 'c', 'f', 'd'], ['a', EV.BOT_ID, EV.BOT_ID, EV.BOT_ID]]);
});

test('a clan made after the pairing takes a bot\'s place, or meets one', () => {
    const p = { pairs: [[{ id: 'a' }, { id: 'b' }], [{ id: 'c' }, EV.BOT]] };
    assert.deepEqual(EV.addToPairing(p, { id: 'z', name: 'Zed' }).pairs.map((x) => x.map((c) => c.id)), [['a', 'b'], ['c', 'z']]);
    assert.deepEqual(EV.addToPairing({ pairs: [[{ id: 'a' }, { id: 'b' }]] }, { id: 'z' }).pairs.map((x) => x.map((c) => c.id)), [['a', 'b'], ['z', EV.BOT_ID]]);
    assert.equal(EV.addToPairing(p, { id: 'a' }), null, 'already in it');
    const g = EV.addToPairing({ groups: [[{ id: 'a' }, EV.BOT, EV.BOT, EV.BOT]] }, { id: 'z' });
    assert.deepEqual(g.groups[0].map((c) => c.id), ['a', 'z', EV.BOT_ID, EV.BOT_ID]);
});

test('an ended event keeps its pairing; the pairings document only counts while it is still that event\'s', () => {
    const rec = { name: 'ClanVClan clicks', start: START };
    const doc = { last: { eventStart: START, type: 'clan_v_clan', pairs: [[{ id: 'a' }, { id: 'b' }]] } };
    assert.ok(EV.pairingFor(rec, doc));
    assert.equal(EV.pairingFor(rec, { last: Object.assign({}, doc.last, { eventStart: START + 1 }) }), null);
    assert.equal(EV.pairingFor(rec, { last: Object.assign({}, doc.last, { type: 'clan_race' }) }), null);
    assert.deepEqual(EV.pairingFor(Object.assign({ result: { pairs: [] } }, rec), null), { pairs: [] });
    assert.deepEqual(EV.resultOf(doc.last), { pairs: [[{ id: 'a', name: undefined, isBot: false }, { id: 'b', name: undefined, isBot: false }]] });
});

// ---- what pages send ----
test('a contribution adds to the clan\'s total and the player\'s share (increments, so nobody overwrites anybody)', () => {
    assert.deepEqual(EV.contributionPatch(START, 'c1', 'Me.Name', 7, inc), { events: { [START]: { c1: { total: { inc: 7 }, members: { 'Me.Name': { inc: 7 } } } } } });
    const doc = prog(START, { c1: { total: 10, members: { me: 4, you: { points: 6 } } } });
    assert.deepEqual(EV.blockOf(doc, START, 'c1'), { total: 10, members: { me: 4, you: { points: 6 } } });
    assert.deepEqual(EV.ranking(doc.events[START].c1.members), [['you', 6], ['me', 4]]);
    assert.deepEqual(EV.staleKeys({ events: { [START]: {}, [START + 40 * DAY]: {}, x: {} } }, START + 45 * DAY), [String(START)]);
});

test('boss damage: clicks times click power plus CPS, changed by the phase\'s twist (from the table, not the document)', () => {
    assert.equal(EV.bossDamage(10, 99, 1000, null), 10 * 100 + 3000);
    assert.equal(EV.bossDamage(0, 99, 1000, null), 0, 'CPS only counts while clicking');
    assert.equal(EV.bossDamage(10, 1e9, 0, null), 10 * (1 + 1e5), 'click power is capped');
    assert.equal(EV.bossDamage(10, 99, 1000, { id: 'shield', click: 50 }), Math.floor((1000 + 3000) * 0.7), 'the document only names the twist');
    assert.equal(EV.bossDamage(10, 99, 1000, 'weak_cps'), 1000 + 1500);
    assert.equal(EV.bossDamage(10, 99, 1000, 'chaos', () => 0), Math.floor(4000 * 0.5));
    assert.equal(EV.bossDamage(10, 99, 1000, 'made_up'), 4000);
    const meta = EV.makeBossMeta(1e6, seq(0.3, 0.6, 0.9));
    assert.equal(meta.totalHp, 2.2e8);
    assert.deepEqual(meta.phaseHps, [5.5e7, 1.1e8, 1.65e8, 2.2e8]);
    assert.equal(meta.gimmicks.length, 4);
    assert.equal(EV.currentGimmick(meta, 0).id, meta.gimmicks[0].id);
    assert.equal(EV.currentGimmick(meta, 1.2e8).id, meta.gimmicks[2].id);
    assert.equal(EV.currentGimmick(meta, 1e12).id, meta.gimmicks[3].id);
    assert.equal(EV.makeBossMeta(0).totalHp, 5e7, 'never below the base');
});

test('prestiges are placed in the Prestige Party they happened in', () => {
    const slots = [{ name: 'prestige party', start: START, end: START + 3 * DAY }, { name: 'DOWNTIME', isDowntime: true, start: START + 3 * DAY, end: START + 5 * DAY },
        { name: 'Bossfight', start: START + 5 * DAY, end: START + 8 * DAY }];
    const now = START + 3 * DAY + 10 * 60000;
    const r = EV.placePending([START + 1000, START + 2 * DAY, START + 4 * DAY, START + 6 * DAY, START + 20 * DAY], slots, START + 21 * DAY);
    assert.deepEqual(r.counts, {}, 'too late: the party ended long ago');
    const soon = EV.placePending([START + 1000, START + 2 * DAY, START + 4 * DAY, now + 9 * DAY], slots, now);
    assert.deepEqual(soon.counts, { [START]: 2 });
    assert.deepEqual(soon.keep, [now + 9 * DAY], 'outside every known slot: kept for later');
    const store = new Map(), ls = { getItem: (k) => (store.has(k) ? store.get(k) : null), setItem: (k, v) => store.set(k, String(v)) };
    ls.setItem(EV.PENDING_KEY, '3');
    assert.deepEqual(EV.readPending(ls), [], 'an old bare count can\'t be placed');
    EV.notePrestige(ls, START);
    EV.notePrestige(ls, START + 5);
    assert.deepEqual(EV.readPending(ls), [START, START + 5]);
});

test('challenges: targets fixed when picked, progress from then on, points from the table', () => {
    const stats = { count: 1000, goldenWhat: 10, prestigeTimes: 2, totalLevels: 100, divineTotalLevels: 0, casinoTotalWins: 0, cps: 50, clickPower: 20 };
    const picks = EV.pickChallenges(stats, seq(0.1, 0.4, 0.8));
    assert.equal(picks.length, 3);
    assert.equal(new Set(picks.map((c) => c.id)).size, 3);
    const ch = EV.challengeFor(EV.CHALLENGES.find((c) => c.id === 'c7'), stats);
    assert.equal(ch.target, 2);
    assert.equal(ch.desc, 'Earn 2 more Golden What Happeneds.');
    assert.deepEqual(EV.challengeProgress(ch, Object.assign({}, stats, { goldenWhat: 11 })), { progress: 1, target: 2, done: false });
    assert.equal(EV.challengeProgress(ch, Object.assign({}, stats, { goldenWhat: 15 })).done, true);
    const reach = EV.challengeFor(EV.CHALLENGES.find((c) => c.id === 'c6'), stats);
    assert.equal(EV.challengeProgress(reach, Object.assign({}, stats, { prestigeTimes: 3 })).done, true);
    assert.equal(EV.challengePoints(Object.assign({}, ch, { points: 9999 })), 25, 'a stored challenge can\'t claim more than the table');
    assert.equal(EV.challengePoints({ id: 'nope', points: 50 }), 0);
    const s = EV.statsFrom({ count: 5, upgrade1Level: 3, upgrade2: 4, divineArgonLevel: 2, prestigeTimes: 1 }, { getItem: (k) => ({ whathappened_current_cps: '12', gamba_total_wins: '3' })[k] || null });
    assert.deepEqual([s.count, s.totalLevels, s.divineTotalLevels, s.prestigeTimes, s.cps, s.casinoTotalWins], [5, 7, 2, 1, 12, 3]);
});

test('moving the schedule on in a transaction: the first page in records what ended (with its pairing); the next finds nothing to do', async () => {
    const docs = {
        state: { upcoming: EV.rollSchedule([], START, EV.DEFAULT_TYPES, seq(0.4)).upcoming.map((it, i) => (i === 0 ? Object.assign({}, it, { name: 'ClanVClan clicks' }) : it)) },
        pairings: { last: { eventStart: START, type: 'clan_v_clan', pairs: [[{ id: 'a', name: 'A' }, { id: 'b', name: 'B' }]] } },
    };
    const ref = (name) => name;
    const tx = { get: async (n) => ({ exists: () => docs[n] !== undefined, data: () => docs[n] }), set: (n, d) => { docs[n] = d; } };
    const now = START + 4 * DAY;
    const ended = await EV.upkeepTx(tx, ref, now, 'stamp');
    assert.equal(ended.length, 1);
    assert.deepEqual(docs.last_ended_event.recent[0].result.pairs.map((p) => p.map((c) => c.id)), [['a', 'b']]);
    assert.equal(docs.state.updatedAt, 'stamp');
    assert.ok(EV.current(docs.state.upcoming, now), 'something is running now');
    assert.deepEqual(docs.config, { types: EV.DEFAULT_TYPES }, 'a missing config is written once');
    assert.deepEqual(await EV.upkeepTx(tx, ref, now + 1000, 'stamp'), [], 'the second page finds it done');
});
