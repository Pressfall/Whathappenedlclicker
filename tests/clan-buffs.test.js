'use strict';
// Clan buffs: the clan document says which are on; it must never decide how strong they are (core/clan-buffs.js).
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const { BUFFS, MAX_REMAINING_MS, resolveActive } = require('../core/clan-buffs');
const { loadGame } = require('./helpers/game-harness');

const NOW = 1_700_000_000_000;
const HOUR = 3600 * 1000;

test('a running buff gets its multipliers from the table', () => {
    const out = resolveActive({ activeBuffs: { cps_double_1h: { expiresAt: NOW + HOUR, cpsMult: 2, clickMult: 1 } } }, NOW);
    assert.deepEqual(out, [{ id: 'cps_double_1h', name: 'Double CPS', cpsMult: 2, clickMult: 1, expiresAt: NOW + HOUR }]);
});

test('multipliers written into the clan document are ignored', () => {
    const forged = { activeBuffs: {
        cps_double_1h: { expiresAt: NOW + HOUR, cpsMult: 1e30, clickMult: 1e30 },
        both_triple_20m: { expiresAt: NOW + HOUR, cpsMult: 'Infinity', clickMult: -5 },
    } };
    const out = resolveActive(forged, NOW);
    assert.equal(out.length, 2);
    assert.deepEqual(out.map((b) => [b.id, b.cpsMult, b.clickMult]), [['cps_double_1h', 2, 1], ['both_triple_20m', 3, 3]]);
});

test('buffs that are not in the table are ignored, including prototype names', () => {
    const out = resolveActive({ activeBuffs: {
        free_money: { expiresAt: NOW + HOUR, cpsMult: 9 },
        __proto__: { expiresAt: NOW + HOUR },
        constructor: { expiresAt: NOW + HOUR },
        toString: { expiresAt: NOW + HOUR },
        hasOwnProperty: { expiresAt: NOW + HOUR },
    }, activeBuff: { id: 'valueOf', expiresAt: NOW + HOUR } }, NOW);
    assert.deepEqual(out, []);
});

test('expired buffs are dropped and the end time is capped at a day', () => {
    const out = resolveActive({ activeBuffs: {
        cps_double_1h: { expiresAt: NOW - 1 },
        click_double_30m: { expiresAt: NOW + 400 * 24 * HOUR },
    } }, NOW);
    assert.deepEqual(out.map((b) => b.id), ['click_double_30m']);
    assert.equal(out[0].expiresAt, NOW + MAX_REMAINING_MS);
});

test('a refill that queues several hours of a buff still counts', () => {
    const out = resolveActive({ activeBuffs: { cps_double_1h: { expiresAt: NOW + 5 * HOUR } } }, NOW);
    assert.equal(out[0].expiresAt, NOW + 5 * HOUR);
});

test('Firestore timestamps work, and so do clans that only have the old single activeBuff field', () => {
    const ts = (ms) => ({ toMillis: () => ms });
    assert.equal(resolveActive({ activeBuffs: { cps_double_1h: { expiresAt: ts(NOW + HOUR) } } }, NOW)[0].expiresAt, NOW + HOUR);
    const legacy = resolveActive({ activeBuff: { id: 'click_double_30m', expiresAt: NOW + HOUR, clickMult: 99 } }, NOW);
    assert.deepEqual(legacy.map((b) => [b.id, b.clickMult]), [['click_double_30m', 2]]);
});

test('the same buff in both fields is listed once', () => {
    const out = resolveActive({ activeBuffs: { cps_double_1h: { expiresAt: NOW + HOUR } }, activeBuff: { id: 'cps_double_1h', expiresAt: NOW + 2 * HOUR } }, NOW);
    assert.equal(out.length, 1);
});

test('missing or junk documents give no buffs and never throw', () => {
    for (const doc of [null, undefined, 5, 'x', [], {}, { activeBuffs: 5 }, { activeBuffs: { cps_double_1h: null } }, { activeBuff: 'x' }, { activeBuffs: { cps_double_1h: { expiresAt: 'soon' } } }]) {
        assert.deepEqual(resolveActive(doc, NOW), [], JSON.stringify(doc));
    }
});

test('the clan shop shows this table: it keeps no copy of its own', () => {
    const page = fs.readFileSync(path.join(__dirname, '..', 'clan-page.js'), 'utf8');
    assert.match(page, /Buffs\.BUFFS/);
    assert.ok(!/cpCost:\s*800/.test(page), 'no buff prices written in the page');
    assert.ok(BUFFS.every((b) => b.icon && b.description), 'every buff has what the shop shows');
});

test('putting Clan Points in: the bar fills, the buff starts (or runs longer), donors are counted', () => {
    const { contribute } = require('../core/clan-buffs');
    const half = contribute({}, 'cps_double_1h', 500, 'Ann', NOW);
    assert.equal(half.ok, true);
    assert.equal(half.activated, false);
    assert.deepEqual(half.updates, { buffProgress: { cps_double_1h: 500 }, cpDonated: { Ann: 500 } });
    const doc = Object.assign({}, half.updates);
    const full = contribute(doc, 'cps_double_1h', 400, 'Bo', NOW);
    assert.equal(full.activated, true);
    assert.equal(full.updates.buffProgress.cps_double_1h, 100, 'what spills over starts the next bar');
    assert.equal(full.updates.activeBuffs.cps_double_1h.expiresAt, NOW + HOUR);
    assert.deepEqual(full.updates.cpDonated, { Ann: 500, Bo: 400 });
    const again = contribute(Object.assign({}, doc, full.updates, { buffProgress: { cps_double_1h: 700 } }), 'cps_double_1h', 100, 'Ann', NOW + 1000);
    assert.equal(again.updates.activeBuffs.cps_double_1h.expiresAt, NOW + 2 * HOUR, 'a running buff gets its hour added on top');
});

test('a buff can not be queued past a day ahead, and junk is refused', () => {
    const { contribute, roomToQueue } = require('../core/clan-buffs');
    const doc = { activeBuffs: { cps_double_1h: { expiresAt: NOW + 23.5 * HOUR } }, buffProgress: { cps_double_1h: 799 } };
    assert.equal(roomToQueue(doc, 'cps_double_1h', NOW), false);
    assert.equal(contribute(doc, 'cps_double_1h', 1, 'A', NOW).reason, 'queue');
    assert.equal(contribute(doc, 'click_double_30m', 1, 'A', NOW).ok, true, 'another buff still can');
    assert.equal(contribute({}, 'free_money', 10, 'A', NOW).reason, 'buff');
    assert.equal(contribute({}, 'cps_double_1h', 0, 'A', NOW).reason, 'amount');
    assert.equal(contribute({}, 'cps_double_1h', 'lots', 'A', NOW).reason, 'amount');
    // a forged running buff with a huge multiplier is copied without it
    const forged = contribute({ activeBuffs: { both_triple_20m: { expiresAt: NOW + HOUR, cpsMult: 1e30 } }, buffProgress: { cps_double_1h: 799 } }, 'cps_double_1h', 1, 'A', NOW);
    assert.deepEqual(forged.updates.activeBuffs.both_triple_20m, { expiresAt: NOW + HOUR });
});

// ---- on the real game page ----
async function pageWithClanDoc(doc) {
    const g = loadGame({ now: NOW, storage: { player_clanId: 'clan1', whathappened_save: JSON.stringify({ version: 3, count: 5 }) } });
    g.eval(`window.db = {}; window.doc = () => ({}); window.getDoc = async () => ({ exists: () => true, data: () => (${JSON.stringify(doc)}) });`);
    await g.eval('refreshClanBuff()');
    return g;
}

test('the game page applies the table\'s multipliers even when the clan document claims more', async () => {
    const g = await pageWithClanDoc({ clanXp: 0, activeBuffs: { cps_double_1h: { expiresAt: NOW + HOUR, cpsMult: 1e30, clickMult: 1e9 } } });
    assert.equal(g.window.clanBuffCpsMult, 2);
    assert.equal(g.window.clanBuffClickMult, 1);
});

test('the game page ignores an unknown buff in the clan document', async () => {
    const g = await pageWithClanDoc({ clanXp: 0, activeBuffs: { mega: { expiresAt: NOW + HOUR, cpsMult: 1e30, clickMult: 1e30 } } });
    assert.equal(g.window.clanBuffCpsMult, 1);
    assert.equal(g.window.clanBuffClickMult, 1);
});
