'use strict';
// Local save export / import (core/progress.js): progress as a file the player keeps.
const test = require('node:test');
const assert = require('node:assert/strict');
const Progress = require('../core/progress');
const { FakeAccountStore, makeDevice } = require('./helpers/fake-cloud');

const PLAY = { whathappened_playtime_seconds: '4000', ach_firstClick: '1', whathappened_followers: JSON.stringify({ list: [{ id: 'a' }] }) };
const device = () => makeDevice(new FakeAccountStore(), 'u1');
const played = (d, count = 8e6) => { d.play({ count, goldenWhat: 3, prestigeTimes: 2, upgrade1Level: 40 }, PLAY); return d; };
const asFile = (obj) => JSON.stringify(obj);

test('export writes one JSON file with the progress and a readable summary', () => {
    const d = played(device());
    const out = d.engine.exportProgress();
    assert.match(out.filename, /^whathappened-save-\d{4}-\d{2}-\d{2}\.json$/);
    const file = JSON.parse(out.text);
    assert.equal(file.format, Progress.EXPORT_FORMAT);
    assert.equal(file.version, 1);
    assert.ok(!Number.isNaN(Date.parse(file.exportedAt)));
    assert.equal(file.summary.prestiges, 2);
    assert.equal(JSON.parse(file.data.whathappened_save).count, 8e6);
    assert.equal(file.data.ach_firstClick, '1');
    assert.equal(out.summary.golden, 3);
});

test('export leaves device settings, the sync record and the backup out', () => {
    const d = played(device());
    d.store.setItem('whathappened_bulk', '25');
    d.store.setItem('whathappened_cloud_meta', '{"uid":"u1"}');
    d.store.setItem('whathappened_cloud_backup', '{"payload":"x"}');
    const file = JSON.parse(d.engine.exportProgress().text);
    assert.deepEqual(Object.keys(file.data).filter((k) => /bulk|cloud/.test(k)), []);
});

test('export does not change anything on the device', () => {
    const d = played(device());
    const before = JSON.stringify([...d.store.map]);
    d.engine.exportProgress();
    assert.equal(JSON.stringify([...d.store.map]), before);
});

test('exporting with no progress says so', () => {
    assert.throws(() => device().engine.exportProgress(), { code: 'export/nothing' });
});

test('a file exported from one device imports onto another', () => {
    const a = played(device());
    const b = device();
    const res = b.engine.importProgress(a.engine.exportProgress().text);
    assert.equal(res.summary.prestiges, 2);
    assert.equal(b.save().count, 8e6);
    assert.equal(b.store.getItem('ach_firstClick'), '1');
    assert.equal(b.store.getItem('whathappened_save_v1'), b.store.getItem('whathappened_save'), 'legacy copy follows');
    assert.equal(b.events.includes('beforeReplace'), true, 'the open game is told to stop saving');
});

test('the same device round-trips exactly', () => {
    const a = played(device());
    const before = a.engine.collectLocal();
    const file = a.engine.exportProgress().text;
    a.play({ count: 1 }); // lose progress
    a.engine.importProgress(file);
    assert.equal(a.engine.collectLocal().hash, before.hash);
});

test('importing keeps the progress it replaces as the backup', () => {
    const a = played(device(), 9e9);
    const b = played(device(), 5e6);
    const res = b.engine.importProgress(a.engine.exportProgress().text);
    assert.equal(res.backedUp, true);
    const backup = b.engine.readBackup();
    assert.equal(backup.kind, 'import');
    assert.equal(JSON.parse(JSON.parse(backup.payload).whathappened_save).count, 5e6);
    // and the backup can be restored
    return b.engine.restoreBackup(null).then(() => assert.equal(b.save().count, 5e6));
});

test('importing onto a device with nothing worth keeping makes no backup', () => {
    const a = played(device());
    const b = device();
    b.play({ count: 12 });
    assert.equal(b.engine.importProgress(a.engine.exportProgress().text).backedUp, false);
    assert.equal(b.engine.readBackup(), null);
});

test('importing removes progress keys the file lacks and keeps device settings', () => {
    const a = played(device());
    const b = played(device());
    b.store.setItem('ach_onlyHere', '1');
    b.store.setItem('whathappened_bulk', '50');
    b.engine.importProgress(a.engine.exportProgress().text);
    assert.equal(b.store.getItem('ach_onlyHere'), null);
    assert.equal(b.store.getItem('whathappened_bulk'), '50');
});

test('after an import a signed-in account is asked which side to keep, not overwritten', async () => {
    const account = new FakeAccountStore();
    const phone = makeDevice(account, 'u1');
    played(phone, 5000);
    await phone.reconcile(); // account holds the phone's progress, rev 1
    const file = played(makeDevice(new FakeAccountStore(), 'u9'), 7e6).engine.exportProgress().text;
    phone.engine.importProgress(file);
    assert.equal(phone.engine.readMeta().uid, '', 'the sync record is cleared');
    const res = await phone.reconcile('later');
    assert.equal(res.state, 'conflict');
    assert.equal(res.asked.length, 1);
    assert.equal(account.peek('u1').rev, 1, 'the account is untouched');
});

// ---------- bad files ----------
test('files that are not saves are refused with a message, and nothing changes', () => {
    const d = played(device());
    const before = JSON.stringify([...d.store.map]);
    const good = JSON.parse(played(device()).engine.exportProgress().text);
    const cases = {
        'empty': '',
        'spaces': '   ',
        'not JSON': 'hello',
        'cut off': asFile(good).slice(0, 200),
        'an array': '[1,2,3]',
        'null': 'null',
        'a bare game save': asFile({ version: 3, count: 100 }),
        'wrong format': asFile({ ...good, format: 'something-else' }),
        'no version': asFile({ format: good.format, data: good.data }),
        'newer file version': asFile({ ...good, version: 2 }),
        'no data': asFile({ format: good.format, version: 1 }),
        'data is a list': asFile({ ...good, data: [] }),
        'no main save': asFile({ ...good, data: { ach_x: '1' } }),
        'main save is not JSON': asFile({ ...good, data: { whathappened_save: 'oops' } }),
        'main save is not a save': asFile({ ...good, data: { whathappened_save: '"hi"' } }),
        'negative count': asFile({ ...good, data: { whathappened_save: JSON.stringify({ version: 3, count: -5 }) } }),
        'count is text': asFile({ ...good, data: { whathappened_save: JSON.stringify({ version: 3, count: 'lots' }) } }),
        'from a newer game': asFile({ ...good, data: { whathappened_save: JSON.stringify({ version: 99, count: 5 }) } }),
        'too big': 'x'.repeat(4_000_001),
    };
    for (const [name, text] of Object.entries(cases)) {
        assert.throws(() => d.engine.importProgress(text), (e) => e.code === 'import/invalid' && e.message.length > 10, name);
    }
    assert.equal(JSON.stringify([...d.store.map]), before, 'nothing was touched, no backup was made');
});

test('previewImport reads a file without touching anything', () => {
    const a = played(device());
    const b = played(device(), 111);
    const before = JSON.stringify([...b.store.map]);
    const p = b.engine.previewImport(a.engine.exportProgress().text);
    assert.equal(p.summary.prestiges, 2);
    assert.ok(p.exportedAt);
    assert.equal(JSON.stringify([...b.store.map]), before);
});

test('an imported file cannot smuggle in non-progress keys or non-string values', () => {
    const a = played(device());
    const file = JSON.parse(a.engine.exportProgress().text);
    file.data.whathappened_cloud_meta = '{"uid":"u1","rev":99,"hash":"x"}';
    file.data.whathappened_bulk = '9999';
    file.data.ach_number = 7;
    file.data.player_username = { evil: true };
    const b = device();
    b.engine.importProgress(JSON.stringify(file));
    assert.equal(b.store.getItem('whathappened_cloud_meta'), null);
    assert.equal(b.store.getItem('whathappened_bulk'), null);
    assert.equal(b.store.getItem('ach_number'), null);
    assert.equal(b.store.getItem('player_username'), null);
});

test('an export of a very large save can still be imported', () => {
    const a = played(device());
    a.store.setItem('whathappened_followers', JSON.stringify({ list: [], pad: 'x'.repeat(1_000_000) }));
    const text = a.engine.exportProgress().text;
    assert.ok(text.length > 1_000_000);
    const b = device();
    b.engine.importProgress(text);
    assert.equal(b.save().count, 8e6);
});
