'use strict';
// The clans overhaul (2026-11-21): renames that follow the player (core/clan-roles.js renameSelf, memberIn), open / closed
// clans and a prestige requirement, this week's contributors and clan XP from challenges (core/clan-levels.js), and the Wilds
// Hunt event with its kill counting and member cards (core/clan-events.js).
const test = require('node:test');
const assert = require('node:assert/strict');
const R = require('../core/clan-roles');
const L = require('../core/clan-levels');
const EV = require('../core/clan-events');

const DAY = 864e5;
const clan = (over) => Object.assign({ name: 'Testers', ownerUid: 'u0', roles: { u0: 'leader', u1: 'co-leader', u2: 'member' }, names: { u0: 'Olive', u1: 'Pat', u2: 'Me' },
    acct: { u0: true, u1: true, u2: false }, members: ['Olive', 'Pat', 'Me'], leaders: ['Olive', 'Pat'], owner: 'Olive', kicks: {}, clanXp: 100 }, over);
const withPatch = (c, patch) => {
    const out = JSON.parse(JSON.stringify(c));
    for (const k of Object.keys(patch)) {
        const path = k.split('.'), last = path.pop();
        let o = out;
        for (const p of path) o = o[p] = Object.assign({}, o[p]);
        o[last] = patch[k];
    }
    return out;
};

// ---------------------------------------------------------------- renames
test('a member may carry their own new name over to the clan, and nothing else with it', () => {
    const c = clan();
    const ok = R.classifyClanUpdate(c, withPatch(c, { 'names.u2': 'NewMe', members: ['Olive', 'Pat', 'NewMe'] }), 'u2', false);
    assert.deepEqual(ok, { ok: true, action: 'nameself' });
    // the owner's `owner` field follows their name, and only theirs
    const own = R.classifyClanUpdate(c, withPatch(c, { 'names.u0': 'Olivia', owner: 'Olivia', members: ['Olivia', 'Pat', 'Me'], leaders: ['Olivia', 'Pat'] }), 'u0', true);
    assert.equal(own.ok, true);
    assert.equal(R.classifyClanUpdate(c, withPatch(c, { 'names.u2': 'NewMe', owner: 'NewMe' }), 'u2', false).reason, 'owner');
    // someone else's name, or a sneaky XP change alongside, or an outsider: refused
    assert.equal(R.classifyClanUpdate(c, withPatch(c, { 'names.u1': 'Rat' }), 'u2', false).ok, false);
    assert.equal(R.classifyClanUpdate(c, withPatch(c, { 'names.u2': 'NewMe', clanXp: 1e9 }), 'u2', false).reason, 'field');
    assert.equal(R.classifyClanUpdate(c, withPatch(c, { 'names.zz': 'Ghost' }), 'zz', false).ok, false);
    assert.equal(R.classifyClanUpdate(c, withPatch(c, { 'names.u2': '' }), 'u2', false).reason, 'shape');
    assert.equal(R.classifyClanUpdate(c, withPatch(c, { 'names.u2': 'x'.repeat(33) }), 'u2', false).reason, 'shape');
});

test('membership by sign-in id survives a new name; by name for older clans', () => {
    const c = clan();
    assert.equal(R.memberIn(c, { uid: 'u2', names: ['Renamed'] }), true, 'the id still has a role');
    assert.equal(R.memberIn(c, { uid: '', names: ['Me'] }), true);
    assert.equal(R.memberIn(c, { uid: 'u9', names: ['Renamed'] }), false);
    assert.equal(R.memberIn({ clanXp: 0 }, { uid: 'u2', names: ['Me'] }), null, 'a document that lists nobody: can\'t tell');
    assert.equal(R.memberIn({ owner: 'Old', members: ['Old', 'Me'] }, { names: ['Me'] }), true);
});

// ---------------------------------------------------------------- open / closed and the prestige requirement
test('co-leaders open or close the clan and set the prestiges it asks for; a closed claimed clan takes nobody new', () => {
    const c = clan();
    assert.deepEqual(R.classifyClanUpdate(c, Object.assign({}, c, { joinMode: 'closed', minPrestige: 5 }), 'u1', true), { ok: true, action: 'manage' });
    assert.equal(R.classifyClanUpdate(c, Object.assign({}, c, { joinMode: 'closed' }), 'u2', false).ok, false, 'a member can\'t');
    const closed = clan({ joinMode: 'closed' });
    const join = withPatch(closed, { 'roles.u7': 'member', 'names.u7': 'Newbie', 'acct.u7': false, members: closed.members.concat('Newbie') });
    assert.deepEqual(R.classifyClanUpdate(closed, join, 'u7', false), { ok: false, action: 'join', reason: 'closed' });
    const open = clan();
    assert.equal(R.classifyClanUpdate(open, withPatch(open, { 'roles.u7': 'member', 'names.u7': 'Newbie', 'acct.u7': false }), 'u7', false).ok, true);
    // leaving a closed clan still works
    const leave = JSON.parse(JSON.stringify(closed)); delete leave.roles.u2; delete leave.names.u2; delete leave.acct.u2;
    assert.equal(R.classifyClanUpdate(closed, leave, 'u2', false).action, 'leave');
});

test('renaming the clan is for the leader, and a rename changes the name only', () => {
    const c = clan();
    assert.deepEqual(R.classifyClanUpdate(c, Object.assign({}, c, { name: 'New Name' }), 'u0', true), { ok: true, action: 'rename' });
    assert.equal(R.classifyClanUpdate(c, Object.assign({}, c, { name: 'New Name' }), 'u1', true).ok, false);
    assert.equal(R.classifyClanUpdate(c, Object.assign({}, c, { name: 'New Name', clanXp: 1e9 }), 'u0', true).ok, false);
});

test('this week\'s contributions are shared progress any member may add to', () => {
    const c = clan();
    const after = Object.assign({}, c, { clanXp: 125, contrib: L.addContribution(null, 'Me', 25, Date.UTC(2026, 10, 18)) });
    assert.deepEqual(R.classifyClanUpdate(c, after, 'u2', false), { ok: true, action: 'progress' });
});

// ---------------------------------------------------------------- weekly contributors
test('weeks start on Monday (UTC); a new week starts the board over', () => {
    assert.equal(L.weekKey(Date.UTC(2026, 10, 16, 0, 0)), '2026-11-16'); // a Monday
    assert.equal(L.weekKey(Date.UTC(2026, 10, 22, 23, 59)), '2026-11-16'); // that Sunday
    assert.equal(L.weekKey(Date.UTC(2026, 10, 23, 0, 0)), '2026-11-23');
    assert.equal(L.weekEndsAt(Date.UTC(2026, 10, 18)), Date.UTC(2026, 10, 23));
    const wed = Date.UTC(2026, 10, 18), nextMon = Date.UTC(2026, 10, 23, 1);
    let c = L.addContribution(null, 'Me', 25, wed);
    c = L.addContribution(c, 'Pat', 40, wed);
    c = L.addContribution(c, 'Me', 30, wed);
    assert.deepEqual(L.contributors(c, wed), [['Me', 55], ['Pat', 40]]);
    assert.deepEqual(L.contributors(c, nextMon), [], 'last week\'s board is not this week\'s');
    assert.deepEqual(L.addContribution(c, 'Pat', 10, nextMon), { week: '2026-11-23', by: { Pat: 10 } });
});

test('the board stays small, and junk in the document is cleaned', () => {
    const wed = Date.UTC(2026, 10, 18);
    let c = null;
    for (let i = 0; i < L.CONTRIB_MAX + 15; i++) c = L.addContribution(c, 'p' + i, i + 1, wed);
    assert.equal(Object.keys(c.by).length, L.CONTRIB_MAX);
    assert.ok(c.by['p' + (L.CONTRIB_MAX + 14)], 'the newest stays');
    assert.ok(!c.by.p0, 'the smallest go');
    const dirty = { week: L.weekKey(wed), by: { a: -5, b: 'x', c: 12.7 } };
    assert.deepEqual(L.addContribution(dirty, 'd', 0, wed).by, { c: 12 });
});

// ---------------------------------------------------------------- clan XP from challenges
test('claimed daily and weekly challenges give the clan XP once each', () => {
    const st = { day: { key: '2026-11-21', ids: ['d_clicks', 'd_levels', 'd_play'], claimed: { d_clicks: true, d_play: true } },
        week: { key: '2026-W47', ids: ['w_boxes', 'w_play', 'w_kills'], claimed: { w_kills: true } } };
    const owed = L.questXpOwed(st, []);
    assert.deepEqual(owed.map((o) => [o.key, o.xp]), [['2026-11-21:d_clicks', 10], ['2026-11-21:d_play', 10], ['2026-W47:w_kills', 30]]);
    const given = L.withQuestsGiven([], owed.map((o) => o.key));
    assert.deepEqual(L.questXpOwed(st, given), []);
    // the same challenge on another day counts again; unclaimed ones and junk never
    const tomorrow = { day: { key: '2026-11-22', ids: ['d_clicks'], claimed: { d_clicks: true } } };
    assert.equal(L.questXpOwed(tomorrow, given).length, 1);
    assert.deepEqual(L.questXpOwed({ day: { key: 'k', ids: ['a'], claimed: { a: 'yes' } } }, []), []);
    assert.deepEqual(L.questXpOwed(null, null), []);
    assert.deepEqual(L.questXpOwed({ day: { key: 'k', ids: ['a', 'b', 'c', 'd'], claimed: { a: true, b: true, c: true, d: true } } }, []).length, 3, 'three a period at most');
    // the list of what was given doesn't grow forever
    assert.equal(L.withQuestsGiven(Array.from({ length: 100 }, (_, i) => 'k' + i), ['new']).length, 60);
});

// ---------------------------------------------------------------- the Wilds Hunt
test('the Wilds Hunt is a kind of event with tier rewards and a top-three bonus', () => {
    assert.equal(EV.kindOf({ name: 'Wilds Hunt' }), 'wh');
    assert.equal(EV.kindOf({ type: 'wilds_hunt' }), 'wh');
    assert.equal(EV.displayName({ name: 'Wilds Hunt' }), 'Wilds Hunt');
    assert.ok(EV.DEFAULT_TYPES.includes('Wilds Hunt'));
    // the other kinds still read as before
    assert.deepEqual(EV.DEFAULT_TYPES.map((n) => EV.kindOf({ name: n })), ['bf', 'cvc', 'race', 'pp', 'con', 'eb', 'wh']);
    const prog = (total, members) => ({ events: { 1000: { c1: { total, members } } } });
    assert.equal(EV.rewardFor('wh', { start: 1000 }, { clanId: 'c1', username: 'Me', progress: prog(40, { Me: 40 }) }), null, 'under the first tier: nothing');
    const r = EV.rewardFor('wh', { start: 1000 }, { clanId: 'c1', username: 'Me', progress: prog(820, { Me: 500, Pat: 320 }), clanLevel: 1, eventGems: L.eventGems });
    assert.deepEqual([r.gems, r.clanXp, r.clanPoints, r.bonusGems], [25 + 15, 300, 55 + 10, 15]);
    assert.match(r.text, /820 monsters/);
    const p2 = EV.rewardFor('wh', { start: 1000 }, { clanId: 'c1', username: 'Pat', progress: prog(820, { Me: 500, Pat: 320 }) });
    assert.equal(p2.bonusGems, 8);
});

test('a config still holding the old default list gets the Wilds Hunt added; a hand-made list is left alone', async () => {
    const OLD = EV.OLD_DEFAULT_TYPES[0];
    assert.deepEqual(EV.typesFrom({ types: OLD.slice().reverse() }), { types: EV.DEFAULT_TYPES, upgrade: true });
    assert.deepEqual(EV.typesFrom({ types: ['Bossfight', 'prestige party'] }), { types: ['Bossfight', 'prestige party'], upgrade: false });
    assert.deepEqual(EV.typesFrom({}), { types: EV.DEFAULT_TYPES, upgrade: false });
    // in the transaction: the config is rewritten even when the schedule has nothing to roll
    const now = 5e12, docs = {
        state: { upcoming: EV.rollSchedule([], now, OLD).upcoming },
        config: { types: OLD.slice(), note: 'kept' },
    };
    const tx = { get: async (r) => ({ exists: () => docs[r] !== undefined, data: () => docs[r] }), set: (r, d) => { docs[r] = d; } };
    await EV.upkeepTx(tx, (n) => n, now + 1000, 'stamp');
    assert.deepEqual(docs.config, { types: EV.DEFAULT_TYPES, note: 'kept' });
});

test('monsters sent from the Wilds: only the rise since the last send, capped', () => {
    assert.deepEqual(EV.wildsKillDelta(100, 112), { send: 12, mark: 112 });
    assert.deepEqual(EV.wildsKillDelta(100, 100), { send: 0, mark: 100 });
    assert.deepEqual(EV.wildsKillDelta(100, 90), { send: 0, mark: 90 }, 'a counter that went down starts over');
    assert.deepEqual(EV.wildsKillDelta(100, 5000), { send: EV.WILDS_SEND_MAX, mark: 5000 }, 'a jump sends no more than the cap');
    assert.deepEqual(EV.wildsKillDelta(undefined, 50), { send: 0, mark: 50 }, 'no mark yet: nothing to send');
    const ev = { start: 1000 };
    assert.deepEqual(EV.contributionPatch(ev.start, 'c1', 'Me', 12, (n) => ({ inc: n })), { events: { 1000: { c1: { total: { inc: 12 }, members: { Me: { inc: 12 } } } } } });
});

test('a member\'s Wilds card: class, rating, best wave and monsters, bounded', () => {
    assert.equal(EV.wildsCard(null), null);
    assert.deepEqual(EV.wildsCard({ classes: { active: 'gunslinger' }, arena: { rating: 1234.6, waveBest: 17 }, stats: { kills: 4321 } }), { cls: 'gunslinger', r: 1234, wb: 17, k: 4321 });
    assert.deepEqual(EV.wildsCard({ classes: { active: '<b>bad</b>' }, arena: { rating: 1e12, waveBest: -4 }, stats: { kills: 'x' } }), { cls: 'warrior', r: 99999, wb: 0, k: 0 });
    assert.equal(EV.wildsCard({}).r, 1000, 'a new adventurer shows the starting rating');
});

test('a Wilds Hunt is paid like every other event, and its claims sync between devices', async () => {
    const P = require('../core/progress');
    assert.ok(P.isSyncKey('whathappened_wh_claimed_123'));
    for (const k of ['whathappened_clan_quests', 'whathappened_clan_uid', 'whathappened_clan_quest_xp', 'whathappened_clan_hunted']) assert.ok(P.isSyncKey(k), k);
    const now = 10 * DAY, start = now - 4 * DAY, store = new Map();
    const storage = { getItem: (k) => (store.has(k) ? store.get(k) : null), setItem: (k, v) => store.set(k, String(v)) };
    const docs = {
        last_ended_event: { recent: [{ name: 'Wilds Hunt', start, end: start + 3 * DAY, type: 'wilds_hunt' }] },
        wilds_hunt_progress: { events: { [start]: { c1: { total: 160, members: { Me: 100, Pat: 60 } } } } },
    };
    let credited = null;
    const paid = await EV.payEnded({ now: () => now, store: storage, clanId: 'c1', username: 'Me', joinedAt: 0, read: async (n) => docs[n] || null,
        readClan: async () => ({ clanXp: 0 }), levelOf: () => 1, eventGems: L.eventGems, credit: async (r) => { credited = r; return true; }, awardClanXp: async () => true });
    assert.equal(paid.length, 1);
    assert.deepEqual(credited, { gems: 8 + 15, clanPoints: 15 + 10 });
    assert.equal(storage.getItem('whathappened_wh_claimed_' + start), '1');
});
