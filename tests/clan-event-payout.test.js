'use strict';
// The clan page's payout code lives inside clan.html's module script (it needs Firebase), so the block is cut out of the real
// file and run against a stand-in save, clan document and event progress.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const html = fs.readFileSync(path.join(__dirname, '..', 'clan.html'), 'utf8');
const start = html.indexOf('// ---- Paying out a finished event ----');
const end = html.indexOf('// live listeners opened by the previous render');
assert.ok(start > 0 && end > start, 'payout block found in clan.html');
const BLOCK = html.slice(start, end);

const START = 1_700_000_000_000;

function makeEnv({ save = { diamonds: 10, clanPoints: 5 }, clanXp = 100, progress = {}, username = 'me' } = {}) {
    const store = new Map([['player_clanId', 'c1'], ['player_username', username]]);
    if (save) store.set('whathappened_save', JSON.stringify(save));
    const env = {
        store, alerts: [], clan: { clanXp }, txFails: false, saveFails: false,
        localStorage: { getItem: (k) => (store.has(k) ? store.get(k) : null), setItem: (k, v) => { store.set(k, String(v)); }, removeItem: (k) => store.delete(k) },
    };
    const ctx = {
        console, Math, Number, Object, String, Set, Promise, JSON, Date,
        localStorage: env.localStorage,
        alert: (m) => env.alerts.push(m),
        db: {}, doc: (db, col, id) => ({ col, id }),
        runTransaction: async (db, fn) => {
            if (env.txFails) throw new Error('offline');
            const tx = { get: async () => ({ exists: () => true, data: () => env.clan }), set: (ref, patch) => { env.clan = Object.assign({}, env.clan, patch); } };
            return fn(tx);
        },
        getDoc: async () => ({ exists: () => true, data: () => ({ events: progress }) }),
        readSaveObj: () => { try { return JSON.parse(env.localStorage.getItem('whathappened_save') || 'null'); } catch (e) { return null; } },
        writeSaveObj: (s) => { if (env.saveFails) throw new Error('quota'); env.localStorage.setItem('whathappened_save', JSON.stringify(s)); },
        withClanEventBonus: async (id, gems) => gems,
        eventToMs: (v) => Number(v) || 0,
        eventClanTotal: (by, key, ms, id) => ((by[key] || {})[id] || {}).total || 0,
        eventClanMembers: (by, key, ms, id) => ((by[key] || {})[id] || {}).members || {},
        PRESTIGE_PARTY_PROGRESS_DOC: 'pp',
        PRESTIGE_PARTY_REWARDS: [{ prestiges: 20, gems: 5, clanXp: 50, clanPoints: 10 }, { prestiges: 40, gems: 10, clanXp: 100, clanPoints: 25 }],
    };
    vm.createContext(ctx);
    vm.runInContext(BLOCK + '\nthis.api = { eventKindOf, endedEventRecord, grantEventRewards, processEndedRewards };', ctx);
    env.api = ctx.api;
    env.save = () => JSON.parse(env.store.get('whathappened_save'));
    return env;
}
const ppEvent = { name: 'prestige party', start: START, end: START + 3 * 86400000 };
const ppProgress = (total, members) => ({ [START]: { c1: { total, members } } });

test('events are recognised by name or type, downtime never', () => {
    const { api } = makeEnv();
    const kinds = [['Bossfight', 'bf'], ['Endless boss', 'eb'], ['ClanVClan clicks', 'cvc'], ['Clan Race', 'race'], ['prestige party', 'pp'], ['construction event', 'con']];
    for (const [name, kind] of kinds) assert.equal(api.eventKindOf({ name }), kind, name);
    assert.equal(api.eventKindOf({ name: 'x', type: 'clan_race' }), 'race');
    assert.equal(api.eventKindOf({ name: 'DOWNTIME', isDowntime: true }), null);
});

test('an event an admin ends early is recorded as over now, so everyone is paid straight away', () => {
    const { api } = makeEnv();
    const rec = api.endedEventRecord({ name: 'Bossfight', start: START, end: Date.now() + 2 * 86400000 }, 'bf');
    assert.ok(rec.end <= Date.now());
    assert.equal(rec.type, 'bossfight');
    const natural = api.endedEventRecord({ name: 'Bossfight', start: START, end: START + 1000 }, 'bf');
    assert.equal(natural.end, START + 1000);
});

test('a finished event pays gems and Clan Points into the save and Clan XP to the clan, once', async () => {
    const env = makeEnv({ progress: ppProgress(45, {}) });
    await env.api.processEndedRewards(ppEvent);
    const s = env.save();
    assert.equal(s.diamonds, 10 + 15, 'both reached tiers pay');
    assert.equal(s.clanPoints, 5 + 35);
    assert.equal(env.clan.clanXp, 100 + 150);
    assert.equal(env.alerts.length, 1);
    await env.api.processEndedRewards(ppEvent);
    assert.equal(env.save().diamonds, 25, 'a second look pays nothing more');
    assert.equal(env.clan.clanXp, 250);
});

test('two overlapping checks (the Events tab re-rendering) pay only once', async () => {
    const env = makeEnv({ progress: ppProgress(25, {}) });
    await Promise.all([env.api.processEndedRewards(ppEvent), env.api.processEndedRewards(ppEvent), env.api.processEndedRewards(ppEvent)]);
    assert.equal(env.save().diamonds, 15);
    assert.equal(env.save().clanPoints, 15);
    assert.equal(env.clan.clanXp, 150);
});

test('top contributors get their bonus on top of the tier rewards', async () => {
    const env = makeEnv({ progress: ppProgress(25, { me: 20, other: 5 }) });
    await env.api.processEndedRewards(ppEvent);
    assert.equal(env.save().diamonds, 10 + 5 + 15);
    assert.equal(env.save().clanPoints, 5 + 10 + 10);
});

test('without a saved game nothing is marked claimed, so the rewards are paid once there is one', async () => {
    const env = makeEnv({ save: null, progress: ppProgress(25, {}) });
    await env.api.processEndedRewards(ppEvent);
    assert.equal(env.store.get('whathappened_pp_claimed_' + START), undefined);
    assert.equal(env.clan.clanXp, 100, 'the clan is not paid before the player is');
    env.store.set('whathappened_save', JSON.stringify({ diamonds: 0, clanPoints: 0 }));
    await env.api.processEndedRewards(ppEvent);
    assert.equal(env.save().diamonds, 5);
    assert.equal(env.clan.clanXp, 150);
});

test('a save that cannot be written does not use up the claim', async () => {
    const env = makeEnv({ progress: ppProgress(25, {}) });
    env.saveFails = true;
    await env.api.processEndedRewards(ppEvent);
    assert.equal(env.store.get('whathappened_pp_claimed_' + START), undefined);
    env.saveFails = false;
    await env.api.processEndedRewards(ppEvent);
    assert.equal(env.save().diamonds, 15);
});

test('Clan XP that could not be added is retried next time, without paying the player again', async () => {
    const env = makeEnv({ progress: ppProgress(25, {}) });
    env.txFails = true;
    await env.api.processEndedRewards(ppEvent);
    assert.equal(env.save().diamonds, 15);
    assert.match(env.alerts[0], /will be tried again/);
    assert.equal(env.clan.clanXp, 100);
    env.txFails = false;
    await env.api.processEndedRewards(ppEvent);
    assert.equal(env.clan.clanXp, 150);
    assert.equal(env.save().diamonds, 15, 'gems are not paid twice');
    assert.equal(env.alerts.length, 1, 'no second popup for the retry');
    await env.api.processEndedRewards(ppEvent);
    assert.equal(env.clan.clanXp, 150, 'and the clan is only paid once');
});
