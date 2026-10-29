'use strict';
// Cloud-save conflicts: several devices syncing against one account (core/progress.js, with fakes for storage and Firestore).
const test = require('node:test');
const assert = require('node:assert/strict');
const Progress = require('../core/progress');
const { FakeAccountStore, makeDevice, MemoryStorage } = require('./helpers/fake-cloud');

const PLAY = { whathappened_playtime_seconds: '1000' };
const setup = () => {
    const account = new FakeAccountStore();
    return { account, phone: makeDevice(account, 'u1', { label: 'Chrome on Android' }), pc: makeDevice(account, 'u1', { label: 'Chrome on Windows' }) };
};
const count = (d) => d.save().count;

// ---------- first sign-in ----------
test('the first sign-in uploads this device\'s progress as revision 1', async () => {
    const { account, pc } = setup();
    pc.play({ count: 5000, prestigeTimes: 1, goldenWhat: 2 }, PLAY);
    const res = await pc.reconcile();
    assert.equal(res.state, 'uploaded');
    assert.equal(account.peek('u1').rev, 1);
    assert.equal(account.peek('u1').device, 'Chrome on Windows');
    assert.equal(account.peek('u1').summary.prestiges, 1);
    const meta = pc.engine.readMeta();
    assert.deepEqual([meta.uid, meta.rev], ['u1', 1]);
});

test('a second, empty device just loads the account\'s progress', async () => {
    const { pc, phone } = setup();
    pc.play({ count: 5000, goldenWhat: 2 }, PLAY);
    await pc.reconcile();
    const res = await phone.reconcile();
    assert.equal(res.state, 'loaded');
    assert.equal(res.backedUp, false, 'nothing of the phone\'s was worth keeping');
    assert.equal(res.asked.length, 0);
    assert.equal(count(phone), 5000);
    assert.equal(phone.engine.readMeta().rev, 1);
});

test('a device with only trivial progress takes the account\'s without asking, but keeps no backup', async () => {
    const { pc, phone } = setup();
    pc.play({ count: 5e6, goldenWhat: 1 }, PLAY);
    await pc.reconcile();
    phone.play({ count: 40 }); // a few clicks on a fresh install
    const res = await phone.reconcile();
    assert.equal(res.state, 'loaded');
    assert.equal(res.backedUp, false);
    assert.equal(count(phone), 5e6);
});

// ---------- keeping in step ----------
test('nothing changed anywhere: reconcile does nothing', async () => {
    const { account, pc } = setup();
    pc.play({ count: 5000, goldenWhat: 1 }, PLAY);
    await pc.reconcile();
    const writes = account.writes.length;
    const res = await pc.reconcile();
    assert.equal(res.state, 'synced');
    assert.equal(account.writes.length, writes);
});

test('only this device changed: the change is uploaded as the next revision', async () => {
    const { account, pc } = setup();
    pc.play({ count: 5000, goldenWhat: 1 }, PLAY);
    await pc.reconcile();
    pc.play({ count: 90000 });
    const res = await pc.reconcile();
    assert.equal(res.state, 'uploaded');
    assert.equal(account.peek('u1').rev, 2);
    assert.equal(JSON.parse(JSON.parse(account.peek('u1').payload).whathappened_save).count, 90000);
});

test('only the account changed (another device saved): this device loads it without asking and keeps its own as a backup', async () => {
    const { pc, phone } = setup();
    pc.play({ count: 5000, goldenWhat: 1 }, PLAY);
    await pc.reconcile();
    await phone.reconcile();
    pc.play({ count: 700000, goldenWhat: 1 });
    await pc.reconcile(); // rev 2
    const res = await phone.reconcile();
    assert.equal(res.state, 'loaded');
    assert.equal(res.asked.length, 0);
    assert.equal(count(phone), 700000);
    assert.equal(res.backedUp, true, 'the phone had progress, so it is kept');
    assert.equal(phone.engine.readBackup().kind, 'device');
    assert.equal(JSON.parse(JSON.parse(phone.engine.readBackup().payload).whathappened_save).count, 5000);
    assert.equal(phone.engine.readMeta().rev, 2);
});

test('this device was barely played since it last synced: the account\'s newer progress loads without asking', async () => {
    const { pc, phone } = setup();
    pc.play({ count: 5000, goldenWhat: 1 }, PLAY);
    await pc.reconcile();
    await phone.reconcile();
    phone.play({ count: 5100 }, { whathappened_playtime_seconds: '1120' }); // 2 minutes, e.g. opening the game
    pc.play({ count: 900000, goldenWhat: 1 }, { whathappened_playtime_seconds: '5000' });
    await pc.reconcile();
    const res = await phone.reconcile();
    assert.equal(res.state, 'loaded');
    assert.equal(res.asked.length, 0);
    assert.equal(count(phone), 900000);
    assert.equal(res.backedUp, true);
});

test('both sides were played: the player is asked, with both sides\' numbers', async () => {
    const { pc, phone } = setup();
    pc.play({ count: 5000, goldenWhat: 1 }, PLAY);
    await pc.reconcile();
    await phone.reconcile();
    phone.play({ count: 20000 }, { whathappened_playtime_seconds: '1900' }); // 15 minutes
    pc.play({ count: 900000 }, { whathappened_playtime_seconds: '5000' });
    await pc.reconcile();
    const res = await phone.reconcile('later');
    assert.equal(res.state, 'conflict');
    assert.equal(res.asked.length, 1);
    assert.equal(res.asked[0].local.count, '20000');
    assert.equal(res.asked[0].cloud.summary.count, '900000');
    assert.equal(count(phone), 20000, 'deciding later changes nothing');
    assert.equal(phone.engine.readBackup(), null, 'and no backup is made until something is replaced');
});

test('a prestige counts as real play: even a short session is asked about', async () => {
    const { pc, phone } = setup();
    pc.play({ count: 5000, goldenWhat: 1, prestigeTimes: 1 }, PLAY);
    await pc.reconcile();
    await phone.reconcile();
    phone.play({ count: 100, goldenWhat: 4, prestigeTimes: 2 }, { whathappened_playtime_seconds: '1050' });
    pc.play({ count: 900000 }, { whathappened_playtime_seconds: '5000' });
    await pc.reconcile();
    const res = await phone.reconcile('later');
    assert.equal(res.state, 'conflict');
});

test('choosing the account\'s progress loads it and backs up this device', async () => {
    const { pc, phone } = setup();
    pc.play({ count: 5000, goldenWhat: 1 }, PLAY);
    await pc.reconcile();
    await phone.reconcile();
    phone.play({ count: 20000 }, { whathappened_playtime_seconds: '1900' });
    pc.play({ count: 900000 }, { whathappened_playtime_seconds: '5000' });
    await pc.reconcile();
    const res = await phone.reconcile('cloud');
    assert.equal(res.state, 'loaded');
    assert.equal(count(phone), 900000);
    assert.equal(JSON.parse(JSON.parse(phone.engine.readBackup().payload).whathappened_save).count, 20000);
});

test('choosing this device\'s progress overwrites the account and backs the account\'s up on this device', async () => {
    const { account, pc, phone } = setup();
    pc.play({ count: 5000, goldenWhat: 1 }, PLAY);
    await pc.reconcile();
    await phone.reconcile();
    phone.play({ count: 20000 }, { whathappened_playtime_seconds: '1900' });
    pc.play({ count: 900000 }, { whathappened_playtime_seconds: '5000' });
    await pc.reconcile();
    const res = await phone.reconcile('local');
    assert.equal(res.state, 'uploaded');
    assert.equal(account.peek('u1').rev, 3);
    assert.equal(JSON.parse(JSON.parse(account.peek('u1').payload).whathappened_save).count, 20000);
    const backup = phone.engine.readBackup();
    assert.equal(backup.kind, 'account');
    assert.equal(JSON.parse(JSON.parse(backup.payload).whathappened_save).count, 900000);
});

test('a device that never synced, with real progress, is asked rather than overwritten', async () => {
    const { pc, phone } = setup();
    pc.play({ count: 5000, goldenWhat: 1 }, PLAY);
    await pc.reconcile();
    phone.play({ count: 8e6, goldenWhat: 2, prestigeTimes: 1 }, PLAY); // played offline for a long time
    const res = await phone.reconcile('later');
    assert.equal(res.state, 'conflict');
    assert.equal(res.asked.length, 1);
    assert.equal(count(phone), 8e6);
});

test('identical progress on both sides is recorded without asking', async () => {
    const { account, pc, phone } = setup();
    pc.play({ count: 5000, goldenWhat: 1 }, PLAY);
    await pc.reconcile();
    // the phone holds exactly the same progress (e.g. signing back in after clearing the sync record)
    for (const [k, v] of pc.store.map) if (k !== 'whathappened_cloud_meta') phone.store.setItem(k, v);
    const writes = account.writes.length;
    const res = await phone.reconcile();
    assert.equal(res.state, 'synced');
    assert.equal(res.asked.length, 0);
    assert.equal(account.writes.length, writes);
    assert.equal(phone.engine.readMeta().rev, 1);
});

test('a device last synced to a different account never overwrites the new account silently', async () => {
    const account = new FakeAccountStore();
    const a = makeDevice(account, 'alice');
    a.play({ count: 9e6, goldenWhat: 3 }, PLAY);
    await a.reconcile();
    const b = makeDevice(account, 'bob');
    b.play({ count: 7e6, goldenWhat: 2 }, PLAY);
    await b.reconcile(); // bob's own account, rev 1
    // bob's device is now used to sign in to alice's account
    b.signInAs('alice');
    const res = await b.reconcile('later');
    assert.equal(res.state, 'conflict');
    assert.equal(account.peek('alice').rev, 1, 'alice\'s save was not touched');
});

// ---------- stale uploads ----------
test('an upload from a device that missed another device\'s save is refused', async () => {
    const { account, pc, phone } = setup();
    pc.play({ count: 5000, goldenWhat: 1 }, PLAY);
    await pc.reconcile();
    await phone.reconcile();
    pc.play({ count: 900000 });
    await pc.engine.uploadLocal(pc.user); // rev 2
    phone.play({ count: 6000 });
    await assert.rejects(() => phone.engine.uploadLocal(phone.user), (e) => e instanceof Progress.SyncConflict && e.code === 'sync/conflict' && e.cloud.rev === 2);
    assert.equal(account.peek('u1').rev, 2, 'the account is unchanged');
    assert.equal(JSON.parse(JSON.parse(account.peek('u1').payload).whathappened_save).count, 900000);
});

test('forcing an upload (the player chose this device) writes the next revision', async () => {
    const { account, pc, phone } = setup();
    pc.play({ count: 5000, goldenWhat: 1 }, PLAY);
    await pc.reconcile();
    await phone.reconcile();
    pc.play({ count: 900000 });
    await pc.engine.uploadLocal(pc.user);
    phone.play({ count: 6000 });
    const res = await phone.engine.uploadLocal(phone.user, { force: true });
    assert.equal(res.rev, 3);
    assert.equal(account.peek('u1').rev, 3);
});

test('a save that lands between reconcile reading and writing leads to a fresh look, not an overwrite', async () => {
    const { account, pc, phone } = setup();
    pc.play({ count: 5000, goldenWhat: 1 }, PLAY);
    await pc.reconcile();
    await phone.reconcile();
    phone.play({ count: 7000 }, { whathappened_playtime_seconds: '1100' }); // changed, so it will try to upload
    // the PC saves right after the phone has looked at the account
    let raced = false;
    const remote = account.remoteFor('u1');
    const racing = Progress.create({
        store: phone.store, now: () => 0, deviceLabel: () => 'x',
        remote: { transaction: remote.transaction, fetch: async (u) => { const cloud = await remote.fetch(u); if (!raced) { raced = true; pc.play({ count: 900000, goldenWhat: 1 }, { whathappened_playtime_seconds: '5000' }); await pc.engine.uploadLocal(pc.user); } return cloud; } },
    });
    const res = await racing.reconcile(phone.user, async () => 'later');
    assert.notEqual(res.state, 'uploaded', 'the phone must not overwrite the PC\'s newer save');
    assert.equal(account.peek('u1').rev, 2);
    assert.equal(JSON.parse(JSON.parse(account.peek('u1').payload).whathappened_save).count, 900000);
});

test('the fake enforces the real rules: a write with the wrong revision is denied', async () => {
    const account = new FakeAccountStore();
    const remote = account.remoteFor('u1');
    const doc = (rev) => ({ v: 1, rev, payload: '{}', summary: {}, device: 'x' });
    await assert.rejects(() => remote.transaction('u1', () => doc(2)), { code: 'permission-denied' });
    await remote.transaction('u1', () => doc(1));
    await assert.rejects(() => remote.transaction('u1', () => doc(1)), { code: 'permission-denied' });
    await assert.rejects(() => remote.transaction('u1', () => doc(3)), { code: 'permission-denied' });
    await assert.rejects(() => remote.transaction('someone-else', () => doc(1)), { code: 'permission-denied' });
    await assert.rejects(() => remote.transaction('u1', () => ({ ...doc(2), extra: 1 })), { code: 'permission-denied' });
});

test('progress too large for an account save is refused before anything is sent', async () => {
    const { account, pc } = setup();
    pc.play({ count: 5 }, { whathappened_followers: 'x'.repeat(950000) });
    await assert.rejects(() => pc.engine.uploadLocal(pc.user), { code: 'sync/too-large' });
    assert.equal(account.writes.length, 0);
});

// ---------- planReconcile (the decision on its own) ----------
test('planReconcile covers every branch', () => {
    const { pc } = setup();
    // 1000 s of play now against 100 s when last synced: well past the "barely played" allowance
    const mk = (over = {}) => ({ data: { whathappened_save: JSON.stringify({ count: 5e6, goldenWhat: 1 }), whathappened_playtime_seconds: '1000' }, hash: 'h1', ...over });
    const meta = { uid: 'u1', rev: 3, hash: 'h1', play: 100, prestiges: 0 };
    const cloud = (over = {}) => ({ rev: 3, payload: 'cloud-json', ...over });
    const plan = (l, m, c) => pc.engine.planReconcile({ uid: 'u1' }, l, m, c);
    assert.equal(plan(mk(), meta, null), 'upload-new');
    assert.equal(plan(mk(), meta, cloud()), 'synced');
    assert.equal(plan(mk({ hash: 'h2' }), meta, cloud()), 'upload');
    assert.equal(plan(mk(), meta, cloud({ rev: 4 })), 'load', 'untouched here, account moved on');
    assert.equal(plan(mk({ hash: 'h2' }), meta, cloud({ rev: 4 })), 'ask');
    assert.equal(plan(mk({ hash: 'h2' }), { ...meta, uid: 'other' }, cloud({ rev: 4 })), 'ask', 'last synced to a different account');
    assert.equal(plan(mk({ hash: 'h2', data: {} }), meta, cloud({ rev: 4 })), 'load', 'nothing here worth keeping');
    assert.equal(plan(mk({ hash: 'h2' }), { ...meta, rev: 5 }, cloud({ rev: 4 })), 'ask', 'the account is somehow behind this device');
    assert.equal(plan(mk({ hash: Progress.hash('cloud-json') }), { ...meta, rev: 1 }, cloud()), 'record', 'same progress both sides');
});

// ---------- backups ----------
test('restoring the backup puts the replaced progress back and keeps the other as the new backup', async () => {
    const { pc, phone } = setup();
    pc.play({ count: 5000, goldenWhat: 1 }, PLAY);
    await pc.reconcile();
    await phone.reconcile();
    pc.play({ count: 900000 });
    await pc.reconcile();
    await phone.reconcile(); // loads 900000, backs up the phone's 5000
    assert.equal(count(phone), 900000);
    await phone.engine.restoreBackup(phone.user);
    assert.equal(count(phone), 5000);
    const backup = phone.engine.readBackup();
    assert.equal(JSON.parse(JSON.parse(backup.payload).whathappened_save).count, 900000, 'the progress it replaced is the new backup');
    assert.equal(phone.engine.readMeta().rev, 2, 'in step with the account, so the next sync uploads the restored progress');
    const res = await phone.reconcile();
    assert.equal(res.state, 'uploaded');
});

test('restoring with no backup says so', async () => {
    const { phone } = setup();
    await assert.rejects(() => phone.engine.restoreBackup(null), { code: 'sync/no-backup' });
});

// ---------- applying progress ----------
test('loading progress replaces progress keys, removes ones the account lacks, and leaves device settings alone', async () => {
    const { pc, phone } = setup();
    pc.play({ count: 5000, goldenWhat: 1 }, { ...PLAY, ach_firstClick: '1' });
    await pc.reconcile();
    phone.play({ count: 10 }, { ach_oldOne: '1', whathappened_bulk: '25', whathappened_performance: 'low' });
    await phone.reconcile();
    assert.equal(phone.store.getItem('ach_firstClick'), '1');
    assert.equal(phone.store.getItem('ach_oldOne'), null, 'a progress key the account does not have is removed');
    assert.equal(phone.store.getItem('whathappened_bulk'), '25', 'device settings stay');
    assert.equal(phone.store.getItem('whathappened_performance'), 'low');
    assert.equal(phone.store.getItem('whathappened_save_v1'), phone.store.getItem('whathappened_save'), 'the legacy copy follows');
});

test('the game is told to stop saving before progress is replaced', async () => {
    const { pc, phone } = setup();
    pc.play({ count: 5000, goldenWhat: 1 }, PLAY);
    await pc.reconcile();
    await phone.reconcile();
    assert.deepEqual(phone.events, ['beforeReplace']);
});

test('progress the account holds that cannot be read changes nothing on this device', async () => {
    const { account, phone } = setup();
    account.docs.set('u1', { v: 1, rev: 1, payload: '{"whathappened_save":"not json"}', summary: {}, device: 'x', updatedAt: 1 });
    phone.play({ count: 10 });
    await assert.rejects(() => phone.reconcile(), { code: 'sync/bad-data' });
    assert.equal(count(phone), 10);
});

test('parsePayload keeps only progress keys with string values', () => {
    const out = Progress.parsePayload(JSON.stringify({
        whathappened_save: '{"count":1}', ach_x: '1', whathappened_bulk: '5', player_username: 7, '__proto__': 'x', constructor: 'y',
    }));
    assert.deepEqual(Object.keys(out).sort(), ['ach_x', 'whathappened_save']);
    for (const bad of ['', 'nope', '[]', 'null', '"x"', null, undefined, 5]) assert.throws(() => Progress.parsePayload(bad), { code: 'sync/bad-data' }, String(bad));
    assert.throws(() => Progress.parsePayload('x'.repeat(900001)), { code: 'sync/bad-data' });
});

test('wipeDevice removes progress, the sync record and the backup, but not settings', async () => {
    const { pc } = setup();
    pc.play({ count: 5000, goldenWhat: 1 }, { ...PLAY, whathappened_bulk: '10' });
    await pc.reconcile();
    pc.engine.wipeDevice();
    assert.equal(pc.store.getItem('whathappened_save'), null);
    assert.equal(pc.store.getItem('whathappened_cloud_meta'), null);
    assert.equal(pc.store.getItem('whathappened_bulk'), '10');
});

// ---------- comparing progress ----------
test('furtherAhead ranks prestiges, then total Golden, then count, then play time', () => {
    const s = (o) => ({ prestiges: 0, totalGolden: 0, count: '0', playSeconds: 0, ...o });
    assert.equal(Progress.furtherAhead(s({ prestiges: 2 }), s({ prestiges: 1, totalGolden: 99, count: '1e50' })), true);
    assert.equal(Progress.furtherAhead(s({ totalGolden: 5 }), s({ totalGolden: 4, count: '1e50' })), true);
    assert.equal(Progress.furtherAhead(s({ count: '1.5e+40' }), s({ count: '9e39' })), true);
    assert.equal(Progress.furtherAhead(s({ count: '5000' }), s({ count: '40000' })), false);
    assert.equal(Progress.furtherAhead(s({ playSeconds: 10 }), s({ playSeconds: 5 })), true);
    assert.equal(Progress.furtherAhead(s(), s()), false);
});

test('summarize reads the headline numbers, tolerating junk', () => {
    const data = {
        whathappened_save: JSON.stringify({ count: '1.5e+30', goldenWhat: 3, totalGoldenEver: 9, prestigeTimes: 2, diamonds: 8 }),
        whathappened_followers: JSON.stringify({ list: [{}, {}] }),
        whathappened_playtime_seconds: '3600', whathappened_prestige_times: '4', ach_a: '1', ach_b: '0', ach_clicks: '1',
    };
    assert.deepEqual(Progress.summarize(data), { count: '1.5e+30', golden: 3, totalGolden: 9, prestiges: 4, gems: 8, playSeconds: 3600, achievements: 1, followers: 2 });
    assert.equal(Progress.summarize({ whathappened_save: 'garbage' }).count, '0');
    assert.equal(Progress.summarize({}).prestiges, 0);
});

test('hasProgress ignores a fresh install and notices real progress', () => {
    const d = (s) => ({ whathappened_save: JSON.stringify(s) });
    assert.equal(Progress.hasProgress({}), false);
    assert.equal(Progress.hasProgress(d({ count: 40 })), false);
    assert.equal(Progress.hasProgress(d({ count: 999 })), false);
    assert.equal(Progress.hasProgress(d({ count: 1000 })), true);
    assert.equal(Progress.hasProgress(d({ count: 1, goldenWhat: 1 })), true);
    assert.equal(Progress.hasProgress(d({ count: 1, diamonds: 3 })), true);
    assert.equal(Progress.hasProgress({ ...d({ count: 1 }), whathappened_prestige_times: '2' }), true);
});

test('isSyncKey: progress, achievements and claimed rewards sync; settings and chat do not', () => {
    for (const k of ['whathappened_save', 'whathappened_followers', 'ach_x', 'whathappened_pp_claimed_2024', 'player_clanId', 'whathappened_world', 'whathappened_world_ack', 'whathappened_world_inbox']) assert.equal(Progress.isSyncKey(k), true, k);
    for (const k of ['whathappened_bulk', 'whathappened_performance', 'whathappened_cloud_meta', 'whathappened_cloud_backup', 'whathappened_world_settings', 'whathappened_world_damaged', 'chat_seen', '', 'ach_' + 'x'.repeat(130)]) assert.equal(Progress.isSyncKey(k), false, k);
    assert.equal(Progress.isSyncKey(null), false);
});

test('hash is stable and notices any change', () => {
    assert.equal(Progress.hash('abc'), Progress.hash('abc'));
    assert.notEqual(Progress.hash('abc'), Progress.hash('abd'));
    assert.notEqual(Progress.hash(''), Progress.hash(' '));
});

test('collectLocal falls back to the legacy save key and sorts keys', () => {
    const store = new MemoryStorage({ whathappened_save_v1: '{"count":1}', ach_z: '1', ach_a: '1' });
    const engine = Progress.create({ store });
    const { data } = engine.collectLocal();
    assert.deepEqual(Object.keys(data), ['ach_a', 'ach_z', 'whathappened_save']);
    assert.equal(data.whathappened_save, '{"count":1}');
});
