'use strict';
// core/save.js on its own: migrations, reading a save, checking an import, what a prestige keeps.
const test = require('node:test');
const assert = require('node:assert/strict');
const S = require('../core/save');

// ---------- migrateSave ----------
test('a save with no version is version 1 and gets the version-2 SCP defaults', () => {
    const out = S.migrateSave({ count: 5 });
    assert.equal(out.version, S.SAVE_VERSION);
    assert.equal(out.count, 5);
    assert.equal(out.upgrade17Level, 0);
    assert.equal(out.upgrade17Cost, 700000000000);
    assert.equal(out.scpMultiplier, 1);
    for (const f of ['scp1Purchased', 'scp2Purchased', 'scp3Purchased', 'scp4Purchased']) assert.equal(out[f], false, f);
});

test('migration fills in only what is missing; it never overwrites', () => {
    const out = S.migrateSave({ version: 1, upgrade17Level: 12, upgrade17Cost: 5, scp1Purchased: true, scpMultiplier: 4 });
    assert.equal(out.upgrade17Level, 12);
    assert.equal(out.upgrade17Cost, 5);
    assert.equal(out.scp1Purchased, true);
    assert.equal(out.scpMultiplier, 4);
    assert.equal(out.scp2Purchased, false);
});

test('a version-2 save only has its version bumped', () => {
    const save = { version: 2, count: 9, upgrade1Level: 3 };
    assert.deepEqual(S.migrateSave(save), { version: 3, count: 9, upgrade1Level: 3 });
});

test('a current save comes back unchanged', () => {
    const save = { version: 3, count: 9, upgrade17Level: 2 };
    assert.deepEqual(S.migrateSave(save), save);
});

test('a save from a newer game keeps its version and gets no defaults', () => {
    assert.deepEqual(S.migrateSave({ version: 9, count: 1 }), { version: 9, count: 1 });
});

test('migrateSave does not change its input', () => {
    const save = { version: 1, count: 1 };
    const copy = JSON.stringify(save);
    S.migrateSave(save);
    assert.equal(JSON.stringify(save), copy);
});

test('migrateSave copes with odd versions and odd input', () => {
    for (const version of ['abc', null, 0, -4, 1.5, NaN, '2']) {
        const out = S.migrateSave({ version, count: 1 });
        assert.ok(out.version >= 1, String(version));
        assert.equal(out.count, 1);
    }
    assert.equal(S.migrateSave(null).version, S.SAVE_VERSION);
    assert.equal(S.migrateSave(undefined).version, S.SAVE_VERSION);
});

// ---------- parseSave ----------
test('parseSave returns the save, or why it could not', () => {
    assert.deepEqual(S.parseSave('{"count": 3}'), { ok: true, save: { count: 3 } });
    for (const empty of [null, undefined, '']) assert.deepEqual(S.parseSave(empty), { ok: false, reason: 'empty' });
    for (const bad of ['{"count": 3', 'banana', '{', '{"a":}']) assert.deepEqual(S.parseSave(bad), { ok: false, reason: 'unreadable' }, bad);
    for (const notSave of ['42', '"hi"', 'null', '[1,2]', 'true']) assert.deepEqual(S.parseSave(notSave), { ok: false, reason: 'not-a-save' }, notSave);
});

// ---------- validateSave ----------
test('validateSave accepts a normal save', () => {
    const r = S.validateSave({ version: 3, count: 100, upgrade1Level: 4, upgrade1Cost: 146, goldenWhat: 2, special1Purchased: true });
    assert.deepEqual(r, { ok: true, errors: [], warnings: [] });
});

test('validateSave accepts numbers stored as strings (big counts) and a version-less save', () => {
    assert.equal(S.validateSave({ count: '1.5e+30', upgrade2Level: '12' }).ok, true);
});

test('validateSave rejects things that are not saves', () => {
    for (const bad of [null, 42, 'x', [], undefined]) assert.equal(S.validateSave(bad).ok, false, String(bad));
    assert.equal(S.validateSave({}).ok, false, 'an empty object');
    assert.equal(S.validateSave({ hello: 'world' }).ok, false, 'an unrelated object');
});

test('validateSave rejects a save from a newer game, and bad versions', () => {
    const newer = S.validateSave({ version: S.SAVE_VERSION + 1, count: 1 });
    assert.equal(newer.ok, false);
    assert.match(newer.errors[0], /newer version/);
    for (const version of ['x', 0, -1, 1.5]) assert.equal(S.validateSave({ version, count: 1 }).ok, false, String(version));
});

test('validateSave rejects counts and levels that are not usable numbers', () => {
    for (const bad of ['banana', NaN, null, {}, [], true, '']) {
        assert.equal(S.validateSave({ count: bad }).ok, false, `count ${JSON.stringify(bad)}`);
        assert.equal(S.validateSave({ count: 1, upgrade3Level: bad }).ok, false, `level ${JSON.stringify(bad)}`);
    }
    assert.equal(S.validateSave({ count: -1 }).ok, false);
    assert.equal(S.validateSave({ count: 1, upgrade3Level: -2 }).ok, false);
    assert.equal(S.validateSave({ count: 1, goldenWhat: -1 }).ok, false);
    assert.equal(S.validateSave({ count: 1, divineArgonLevel: 'x' }).ok, false);
});

test('validateSave only warns about prices and flags, because the game repairs them', () => {
    const r = S.validateSave({ count: 1, upgrade1Cost: 'x', special1Purchased: 'yes' });
    assert.equal(r.ok, true);
    assert.equal(r.warnings.length, 2);
});

test('validateSave stops listing after a few errors', () => {
    const bad = { count: 'x' };
    for (let i = 1; i <= 40; i++) bad['upgrade' + i + 'Level'] = 'x';
    const r = S.validateSave(bad);
    assert.equal(r.ok, false);
    assert.ok(r.errors.length <= 12);
});

// ---------- buildPrestigeSave ----------
const NOW = 1_700_000_000_000;
const running = () => ({
    version: 3, count: 5e9, upgrade1Level: 1400, upgrade1Cost: 99999, special1Purchased: true, clickMultiplier: 3, phonkBaseCps: 5,
    goldenWhat: 3, prestigeTimes: 1, totalGoldenEver: 3, goldenThreshold: 7, divineUnlocked: false,
    divineArgonLevel: 2, divineArgonCost: 9, divineArgonPercent: 600, divineMoneyManLevel: 1, divineMoneyManCost: 2, divineBrileyismLevel: 4, divineBrileyismCost: 14,
    diamonds: 42, clanPoints: 7,
    musicVolume: 0.3, musicMuted: true, sfxVolume: 0.2, sfxMuted: false, musicOwned: { mainTheme: true, BassInsanity: true }, currentMusicTrack: 'BassInsanity',
    shopWHBWPurchased: true, shopBgPurchased: { 'bgimages/a.png': true }, equippedShopImage: 'x.png', equippedBgImage: 'bgimages/a.png',
    casinoSpin: { lastSpinDate: '2023-11-14' }, casino_total_wins: 4, lastSaved: 1,
});

test('a prestige adds the new Golden and counts the prestige', () => {
    const out = S.buildPrestigeSave(running(), 2, NOW);
    assert.equal(out.goldenWhat, 5);
    assert.equal(out.prestigeTimes, 2);
    assert.equal(out.totalGoldenEver, 5);
    assert.equal(out.divineUnlocked, true);
    assert.equal(out.prestige, true, 'tells the next load to pay Divine Money Man');
    assert.equal(out.version, S.SAVE_VERSION);
    assert.equal(out.lastSaved, NOW);
});

test('a prestige keeps Divine upgrades, gems, clan points, music, shop and the casino state', () => {
    const before = running();
    const out = S.buildPrestigeSave(before, 1, NOW);
    for (const k of ['divineArgonLevel', 'divineArgonCost', 'divineArgonPercent', 'divineMoneyManLevel', 'divineMoneyManCost', 'divineBrileyismLevel',
        'diamonds', 'clanPoints', 'musicVolume', 'musicMuted', 'sfxVolume', 'sfxMuted', 'musicOwned', 'currentMusicTrack',
        'shopWHBWPurchased', 'shopBgPurchased', 'equippedShopImage', 'equippedBgImage', 'casinoSpin', 'casino_total_wins', 'goldenThreshold']) {
        assert.deepEqual(out[k], before[k], k);
    }
});

test('a prestige drops the run: count, upgrades, specials, multipliers', () => {
    const out = S.buildPrestigeSave(running(), 1, NOW);
    for (const k of ['count', 'upgrade1Level', 'upgrade1Cost', 'special1Purchased', 'clickMultiplier', 'phonkBaseCps']) assert.equal(k in out, false, k);
});

test('a prestige never invents fields that were not in the save', () => {
    const out = S.buildPrestigeSave({ goldenWhat: 0 }, 1, NOW);
    assert.deepEqual(Object.keys(out).sort(), ['divineUnlocked', 'goldenWhat', 'lastSaved', 'prestige', 'prestigeTimes', 'totalGoldenEver', 'version']);
    assert.equal(out.goldenWhat, 1);
});

test('divineUnlocked stays unlocked, and a zero-Golden result leaves it alone', () => {
    assert.equal(S.buildPrestigeSave({ goldenWhat: 0, divineUnlocked: true }, 0, NOW).divineUnlocked, true);
    assert.equal('divineUnlocked' in S.buildPrestigeSave({ goldenWhat: 0 }, 0, NOW), false);
});

test('buildPrestigeSave does not change the save it was given, and survives junk', () => {
    const before = running();
    const copy = JSON.stringify(before);
    S.buildPrestigeSave(before, 3, NOW);
    assert.equal(JSON.stringify(before), copy);
    for (const junk of [null, undefined, 'x', 5]) assert.equal(S.buildPrestigeSave(junk, 1, NOW).goldenWhat, 1);
});

test('every kept key is unique', () => {
    assert.equal(new Set(S.PRESTIGE_KEEP).size, S.PRESTIGE_KEEP.length);
});
