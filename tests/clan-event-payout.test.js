'use strict';
// Paying a player for clan events that are over (core/clan-events.js payEnded). The game page (clan-game.js) and the clan page
// (clan-events-tab.js) both call it; here it runs against a stand-in save, clan document and event documents.
const test = require('node:test');
const assert = require('node:assert/strict');
const EV = require('../core/clan-events');
const L = require('../core/clan-levels');

const DAY = 864e5, START = 1_700_000_000_000;
const NOW = START + 3 * DAY + 10 * 60000; // ten minutes after the first event ended

function makeEnv({ save = { diamonds: 10, clanPoints: 5 }, clanXp = 100, docs = {}, username = 'me', joinedAt = 0, now = NOW } = {}) {
    const store = new Map();
    const env = {
        store, clan: { clanXp }, save: save ? Object.assign({}, save) : null, docs, txFails: false, creditFails: false, reads: 0, now,
        ls: { getItem: (k) => (store.has(k) ? store.get(k) : null), setItem: (k, v) => store.set(k, String(v)), removeItem: (k) => store.delete(k) },
    };
    // one payment at a time, like navigator.locks
    let chain = Promise.resolve();
    env.io = () => ({
        now: () => env.now, store: env.ls, clanId: 'c1', username, joinedAt,
        read: async (name) => { env.reads++; await null; return env.docs[name] || null; },
        readClan: async () => env.clan,
        levelOf: (c) => L.levelFromXp(c && c.clanXp), eventGems: L.eventGems,
        credit: async (r) => {
            if (!env.save || env.creditFails) return false;
            env.save.diamonds += r.gems; env.save.clanPoints += r.clanPoints;
            return true;
        },
        awardClanXp: async (key, xp) => {
            if (env.txFails) return false;
            const done = env.clan.eventXpAwarded || {};
            if (!done[key]) env.clan = Object.assign({}, env.clan, { clanXp: env.clan.clanXp + xp, eventXpAwarded: EV.withXpAwarded(done, key) });
            return true;
        },
        lock: (fn) => (chain = chain.then(fn, fn)),
    });
    env.pay = () => EV.payEnded(env.io());
    return env;
}
const pp = (start) => ({ name: 'prestige party', start, end: start + 3 * DAY, type: 'prestige_party' });
const ended = (...recs) => ({ recent: recs });
const ppProgress = (byStart) => ({ events: byStart });

test('a finished event pays gems and Clan Points to the player and Clan XP to the clan, once', async () => {
    const env = makeEnv({ docs: { last_ended_event: ended(pp(START)), prestige_party_progress: ppProgress({ [START]: { c1: { total: 45, members: {} } } }) } });
    const paid = await env.pay();
    assert.equal(paid.length, 1);
    assert.equal(env.save.diamonds, 10 + 15, 'both reached tiers pay');
    assert.equal(env.save.clanPoints, 5 + 35);
    assert.equal(env.clan.clanXp, 100 + 150);
    assert.deepEqual(await env.pay(), [], 'a second look pays nothing more');
    assert.equal(env.save.diamonds, 25);
    assert.equal(env.clan.clanXp, 250);
});

test('several events that ended while nobody looked are all paid (the old page only paid the last one)', async () => {
    const second = START + 5 * DAY;
    const env = makeEnv({ now: second + 3 * DAY + 600000, docs: {
        last_ended_event: ended(pp(START), { name: 'Bossfight', start: second, end: second + 3 * DAY, type: 'bossfight' }),
        prestige_party_progress: ppProgress({ [START]: { c1: { total: 25, members: {} } } }),
        bossfight_progress: { events: { [second]: { c1: { total: 600, members: {} } } } },
        bossfight_meta: { events: { [second]: { totalHp: 1000, phaseHps: [250, 500, 750, 1000] } } },
    } });
    const paid = await env.pay();
    assert.deepEqual(paid.map((p) => p.kind), ['pp', 'bf']);
    assert.equal(env.save.diamonds, 10 + 5 + 12);
});

test('two pages looking at once (the game and the clan page) pay only once', async () => {
    const env = makeEnv({ docs: { last_ended_event: ended(pp(START)), prestige_party_progress: ppProgress({ [START]: { c1: { total: 25, members: {} } } }) } });
    const io = env.io();
    await Promise.all([EV.payEnded(io), EV.payEnded(io), env.pay()]);
    assert.equal(env.save.diamonds, 15);
    assert.equal(env.save.clanPoints, 15);
    assert.equal(env.clan.clanXp, 150);
});

test('top contributors get their bonus on top of the tier rewards', async () => {
    const env = makeEnv({ docs: { last_ended_event: ended(pp(START)), prestige_party_progress: ppProgress({ [START]: { c1: { total: 25, members: { me: 20, other: 5 } } } }) } });
    const [p] = await env.pay();
    assert.equal(env.save.diamonds, 10 + 5 + 15);
    assert.equal(env.save.clanPoints, 5 + 10 + 10);
    assert.equal(p.reward.bonusGems, 15);
});

test('without a saved game nothing is marked paid, so the rewards come once there is one', async () => {
    const env = makeEnv({ save: null, docs: { last_ended_event: ended(pp(START)), prestige_party_progress: ppProgress({ [START]: { c1: { total: 25, members: {} } } }) } });
    await env.pay();
    assert.equal(env.store.get(EV.claimKey('pp', START)), undefined);
    assert.equal(env.clan.clanXp, 100, 'the clan is not paid before the player is');
    env.save = { diamonds: 0, clanPoints: 0 };
    await env.pay();
    assert.equal(env.save.diamonds, 5);
    assert.equal(env.clan.clanXp, 150);
});

test('Clan XP that could not be added is retried next time, without paying the player again', async () => {
    const env = makeEnv({ docs: { last_ended_event: ended(pp(START)), prestige_party_progress: ppProgress({ [START]: { c1: { total: 25, members: {} } } }) } });
    env.txFails = true;
    const [p] = await env.pay();
    assert.equal(p.xpOk, false);
    assert.equal(env.save.diamonds, 15);
    assert.equal(env.clan.clanXp, 100);
    env.txFails = false;
    assert.deepEqual(await env.pay(), [], 'the retry is quiet');
    assert.equal(env.clan.clanXp, 150);
    assert.equal(env.save.diamonds, 15, 'gems are not paid twice');
    await env.pay();
    assert.equal(env.clan.clanXp, 150, 'and the clan only once');
});

test('the clan gets an event\'s XP once, however many members collect', async () => {
    const docs = { last_ended_event: ended(pp(START)), prestige_party_progress: ppProgress({ [START]: { c1: { total: 25, members: {} } } }) };
    const a = makeEnv({ docs }), b = makeEnv({ docs, username: 'other' });
    await a.pay();
    b.clan = a.clan;
    await b.pay();
    assert.equal(b.clan.clanXp, 150);
    assert.equal(b.save.diamonds, 15, 'each member is paid for themselves');
});

test('when it pays: a couple of minutes after the end, for two weeks, and only for events after the player joined', async () => {
    const docs = { last_ended_event: ended(pp(START)), prestige_party_progress: ppProgress({ [START]: { c1: { total: 25, members: {} } } }) };
    assert.deepEqual(await makeEnv({ docs, now: START + 3 * DAY + 30000 }).pay(), [], 'just ended: the last sends may still be on their way');
    assert.deepEqual(await makeEnv({ docs, now: START + 3 * DAY + EV.PAY_WINDOW_MS + 1 }).pay(), [], 'too long ago');
    assert.deepEqual(await makeEnv({ docs, joinedAt: START + 3 * DAY + 1 }).pay(), [], 'joined after it ended: not theirs');
    assert.equal((await makeEnv({ docs, joinedAt: START + DAY }).pay()).length, 1, 'joined during it: theirs');
});

test('an event the clan earned nothing in is remembered, so it isn\'t read again and again', async () => {
    const env = makeEnv({ docs: { last_ended_event: ended(pp(START)), prestige_party_progress: ppProgress({ [START]: { c1: { total: 3, members: {} } } }) } });
    assert.deepEqual(await env.pay(), []);
    assert.equal(env.store.get(EV.claimKey('pp', START)), '0');
    const reads = env.reads;
    await env.pay();
    assert.equal(env.reads, reads + 1, 'only the list of ended events is read');
});

test('a read that fails leaves the event for next time', async () => {
    const env = makeEnv({ docs: { last_ended_event: ended(pp(START)) } });
    env.io = ((io) => () => Object.assign(io(), { read: async (n) => { if (n !== 'last_ended_event') throw new Error('offline'); return env.docs[n]; } }))(env.io);
    assert.deepEqual(await env.pay(), []);
    assert.equal(env.store.get(EV.claimKey('pp', START)), undefined);
});

test('older pages\' ended-event document (one event at the top level) still pays', async () => {
    const env = makeEnv({ docs: { last_ended_event: pp(START), prestige_party_progress: ppProgress({ [START]: { c1: { total: 25, members: {} } } }) } });
    assert.equal((await env.pay()).length, 1);
});

test('Clan v Clan pays from the pairing kept with the ended event, after the pairings document moved on', async () => {
    const rec = { name: 'ClanVClan clicks', start: START, end: START + 3 * DAY, type: 'clan_v_clan', result: { pairs: [[{ id: 'c1', name: 'Us' }, { id: 'c2', name: 'Them' }]] } };
    const env = makeEnv({ docs: { last_ended_event: ended(rec), pairings: { last: { eventStart: START + 5 * DAY, type: 'clan_race', groups: [] } },
        cvc_progress: { events: { [START]: { c1: { total: 50, members: { me: 50 } }, c2: { total: 20, members: {} } } } } } });
    const [p] = await env.pay();
    assert.equal(p.reward.result, 'win');
    assert.equal(env.save.diamonds, 10 + 25);
    assert.match(p.reward.text, /beat Them, 50 clicks to 20/);
});

test('the clan document\'s record of paid events stays small', () => {
    let map = {};
    for (let i = 0; i < 60; i++) map = EV.withXpAwarded(map, 'bf_' + (START + i * DAY), 40);
    assert.equal(Object.keys(map).length, 40);
    assert.ok(map['bf_' + (START + 59 * DAY)]);
    assert.ok(!map['bf_' + START], 'the oldest go first');
});
