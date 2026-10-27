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

test('the table in core/clan-buffs.js matches the shop in clan.html', () => {
    const html = fs.readFileSync(path.join(__dirname, '..', 'clan.html'), 'utf8');
    const block = html.slice(html.indexOf('const CLAN_BUFFS = ['), html.indexOf('];', html.indexOf('const CLAN_BUFFS = [')));
    const shop = [...block.matchAll(/\{ id: '([^']+)'.*?cpCost: (\d+), durationMs: ([^,]+), cpsMult: (\d+), clickMult: (\d+) \}/g)]
        .map((m) => ({ id: m[1], cpCost: Number(m[2]), durationMs: Function('return ' + m[3])(), cpsMult: Number(m[4]), clickMult: Number(m[5]) }));
    assert.equal(shop.length, BUFFS.length);
    assert.deepEqual(shop, BUFFS.map(({ id, cpCost, durationMs, cpsMult, clickMult }) => ({ id, cpCost, durationMs, cpsMult, clickMult })));
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
