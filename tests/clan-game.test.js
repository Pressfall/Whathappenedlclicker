'use strict';
// The clan on the game page (clan-game.js), on the real main.js: noticing a kick, sending event clicks, damage and
// prestiges, paying event rewards in the background, and taking in what the clan page changed in the save.
const test = require('node:test');
const assert = require('node:assert/strict');
const { loadGame } = require('./helpers/game-harness');

const DAY = 864e5, NOW = 1_700_000_000_000;
const SAVE = JSON.stringify({ version: 3, count: 5, diamonds: 10, clanPoints: 5 });

// Firestore stand-ins: documents by "col/id", every setDoc recorded, transactions run against the same documents
function page(docs, storage) {
    const g = loadGame({ now: NOW, noRenown: true, storage: Object.assign({ whathappened_save: SAVE, player_username: 'Me', player_clanId: 'c1' }, storage || {}) });
    g.window.__docs = JSON.parse(JSON.stringify(docs || {}));
    g.eval(`window.__sets = [];
        window.db = {}; window.doc = (db, col, id) => ({ path: col + '/' + id });
        window.getDoc = async (ref) => { const d = window.__docs[ref.path]; return { exists: () => d !== undefined, data: () => d }; };
        window.setDoc = async (ref, data, opts) => { window.__sets.push({ path: ref.path, data: JSON.parse(JSON.stringify(data)), merge: !!(opts && opts.merge) }); };
        window.firestoreIncrement = (n) => ({ inc: n });
        window.runTransaction = async (db, fn) => fn({
            get: window.getDoc,
            update: (ref, patch) => { window.__docs[ref.path] = Object.assign({}, window.__docs[ref.path], patch); },
        });`);
    return g;
}
const sets = (g, path) => JSON.parse(JSON.stringify(g.window.__sets)).filter((s) => !path || s.path === path);
const clanDoc = (over) => Object.assign({ name: 'Testers', clanXp: 20000, ownerUid: 'u0', roles: { u0: 'leader', u1: 'co-leader' }, names: { u0: 'Olive', u1: 'Me' }, members: ['Olive', 'Me'] }, over);

test('a member: the clan\'s level, name and role (a promotion made by someone else) reach the game', async () => {
    const g = page({ 'clans/c1': clanDoc({ activeBuffs: { cps_double_1h: { expiresAt: NOW + 3600e3, cpsMult: 1e9 } } }) }, { player_clanRole: 'member' });
    await g.eval('refreshClanBuff()');
    assert.equal(g.storage.getItem('player_clanRole'), 'co-leader');
    assert.equal(g.storage.getItem('whathappened_clan_level'), String(require('../core/clan-levels').levelFromXp(20000)));
    assert.equal(g.window.clanBuffCpsMult, 2, 'the table decides the buff');
    assert.equal(g.eval('WHClanGame.member()'), true);
    g.close();
});

test('kicked: the clan, its perks and its buffs stop at once, and the player is told', async () => {
    const g = page({ 'clans/c1': clanDoc({ names: { u0: 'Olive' }, roles: { u0: 'leader' }, members: ['Olive'], activeBuffs: { cps_double_1h: { expiresAt: NOW + 3600e3 } } }) },
        { whathappened_clan_level: '12', player_clanName: 'Testers' });
    await g.eval('refreshClanBuff()');
    assert.equal(g.storage.getItem('player_clanId'), null);
    assert.equal(g.storage.getItem('whathappened_clan_level'), null);
    assert.deepEqual(JSON.parse(g.eval('JSON.stringify(getClanLevelPerk())')), { cps: 0, click: 0, event: 0 });
    assert.equal(g.window.clanBuffCpsMult, 1);
    assert.equal(g.eval('WHClanGame.member()'), false);
    assert.ok(sets(g, 'profiles/Me').some((s) => s.data.clanId === null), 'the profile stops naming the clan');
    assert.match(g.eval("document.body.textContent"), /no longer in Testers/);
    g.close();
});

test('a deleted clan is let go of too; a clan document that lists nobody is no reason to', async () => {
    const gone = page({});
    await gone.eval('refreshClanBuff()');
    assert.equal(gone.storage.getItem('player_clanId'), null);
    gone.close();
    const unknown = page({ 'clans/c1': { clanXp: 0 } });
    await unknown.eval('refreshClanBuff()');
    assert.equal(unknown.storage.getItem('player_clanId'), 'c1');
    unknown.close();
});

const schedule = (name, over) => ({ 'events/state': { upcoming: [Object.assign({ name, start: NOW - DAY, end: NOW + 2 * DAY }, over)] } });
test('clicks in a Clan v Clan go to that event, with the player\'s share', async () => {
    const g = page(Object.assign({ 'clans/c1': clanDoc() }, schedule('ClanVClan clicks')));
    await g.eval('refreshClanBuff()');
    g.eval('for (let i = 0; i < 7; i++) WHClanGame.noteClick()');
    await g.eval('WHClanGame.flush()');
    const [s] = sets(g, 'events/cvc_progress');
    assert.ok(s && s.merge);
    assert.deepEqual(s.data, { events: { [NOW - DAY]: { c1: { total: { inc: 7 }, members: { Me: { inc: 7 } } } } } });
    g.close();
});

test('clicks in a Bossfight are damage, changed by the phase\'s twist; with no event running they are dropped', async () => {
    const meta = { totalHp: 1e9, phaseHps: [2.5e8, 5e8, 7.5e8, 1e9], gimmicks: [{ id: 'shield' }, { id: 'enrage' }, { id: 'armor' }, { id: 'chaos' }] };
    const g = page(Object.assign({ 'clans/c1': clanDoc(), 'events/bossfight_meta': { events: { [NOW - DAY]: meta } } }, schedule('Bossfight')));
    await g.eval('refreshClanBuff()');
    g.eval('clickPower = 9; cps = 100; for (let i = 0; i < 10; i++) WHClanGame.noteClick()');
    await g.eval('WHClanGame.flush()');
    const [s] = sets(g, 'events/bossfight_progress');
    assert.deepEqual(s.data.events[NOW - DAY].c1.total, { inc: Math.floor((10 * 10 + 300) * 0.7) }, 'phase 1 has a shield');
    const quiet = page(Object.assign({ 'clans/c1': clanDoc() }, schedule('DOWNTIME', { isDowntime: true })));
    quiet.eval('for (let i = 0; i < 10; i++) WHClanGame.noteClick()');
    await quiet.eval('WHClanGame.flush()');
    assert.equal(sets(quiet).length, 0);
    assert.equal(quiet.eval('WHClanGame._state.clicks'), 0, 'not saved up for a later event');
    g.close(); quiet.close();
});

test('prestiges noted before the reload are sent into the Prestige Party they happened in', async () => {
    const g = page(Object.assign({ 'clans/c1': clanDoc() }, schedule('prestige party')),
        { whathappened_prestige_party_pending: JSON.stringify([NOW - 60000, NOW - 30000]) });
    await g.eval('WHClanGame.flushPrestiges()');
    const [s] = sets(g, 'events/prestige_party_progress');
    assert.deepEqual(s.data.events[NOW - DAY].c1, { total: { inc: 2 }, members: { Me: { inc: 2 } } });
    assert.equal(g.storage.getItem('whathappened_prestige_party_pending'), null);
    g.close();
});

test('a finished event is paid in the game itself, into the running game and the save', async () => {
    const start = NOW - 4 * DAY;
    const g = page({ 'clans/c1': clanDoc({ clanXp: 0 }), 'events/last_ended_event': { recent: [{ name: 'prestige party', start, end: start + 3 * DAY, type: 'prestige_party' }] },
        'events/prestige_party_progress': { events: { [start]: { c1: { total: 25, members: { Me: 25 } } } } } });
    await g.eval('refreshClanBuff()');
    const before = g.eval('diamonds');
    const paid = await g.eval('WHClanGame.pay()');
    assert.equal(paid.length, 1);
    assert.equal(g.eval('diamonds'), before + 5 + 15, 'tier and top contributor');
    assert.equal(g.savedState().clanPoints, 5 + 10 + 10);
    assert.equal(g.window.__docs['clans/c1'].clanXp, 50);
    assert.equal(g.storage.getItem('whathappened_pp_claimed_' + start), '1');
    assert.equal((await g.eval('WHClanGame.pay()')).length, 0);
    g.close();
});

test('what the clan page changed in the save while the game was open reaches the game, once', () => {
    const g = page({});
    const before = { d: g.eval('diamonds'), cp: g.eval('clanPoints'), gw: g.eval('goldenWhat') };
    const fire = (v) => g.window.dispatchEvent(new g.window.StorageEvent('storage', { key: 'whathappened_clan_delta', newValue: JSON.stringify(v) }));
    fire({ id: 'a1', at: NOW + 1000, diamonds: 15, clanPoints: -200, goldenWhat: 3, totalGoldenEver: 3 });
    fire({ id: 'a1', at: NOW + 1000, diamonds: 15 });
    assert.equal(g.eval('diamonds'), before.d + 15);
    assert.equal(g.eval('clanPoints'), Math.max(0, before.cp - 200));
    assert.equal(g.eval('goldenWhat'), before.gw + 3);
    fire({ id: 'old', at: NOW - 1000, diamonds: 99 });
    assert.equal(g.eval('diamonds'), before.d + 15, 'a change the loaded save already had');
    g.close();
});
