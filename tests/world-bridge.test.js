'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const Bridge = require('../core/world-bridge');
const { loadGame } = require('./helpers/game-harness');

const NOW = 1_700_000_000_000;
const { WORLD_KEY, ACK_KEY } = Bridge;

function memStore(init = {}) {
    const m = new Map(Object.entries(init));
    return { getItem: (k) => (m.has(k) ? m.get(k) : null), setItem: (k, v) => m.set(k, String(v)), removeItem: (k) => m.delete(k) };
}
const box = (tier, n = 1) => { const b = [0, 0, 0, 0, 0]; b[tier] = n; return b; };
function worldWith(rewards) {
    const s = { v: 1, rubies: 10, stats: { kills: 3 }, outSeq: 0, outbox: [] };
    for (const r of rewards) Bridge.push(s, r, 0, NOW);
    return s;
}

// ---------- the module ----------

test('push numbers entries from the highest of outSeq and the ack, and never merges them', () => {
    const s = { outSeq: 0, outbox: [] };
    assert.equal(Bridge.push(s, { gems: 2 }, 0, NOW).seq, 1);
    assert.equal(Bridge.push(s, { gems: 1 }, 0, NOW).seq, 2);
    // the game applied up to 7 (e.g. this world save was replaced by an older copy): never reuse 3..7
    assert.equal(Bridge.push(s, { golden: 1 }, 7, NOW).seq, 8);
    assert.equal(s.outbox.length, 3);
    assert.equal(Bridge.push(s, { gems: 0, boxes: [0, 0, 0, 0, 0] }, 0, NOW), null, 'empty rewards are not queued');
});

test('pending lists entries above the ack, oldest first, with totals', () => {
    const w = worldWith([{ gems: 2 }, { golden: 1, boxes: box(1, 2) }, { gems: 3, boxes: box(0) }]);
    w.outbox.reverse();
    const store = memStore({ [WORLD_KEY]: JSON.stringify(w), [ACK_KEY]: '1' });
    const p = Bridge.pending(store);
    assert.deepEqual(p.entries.map(e => e.seq), [2, 3]);
    assert.deepEqual(p.totals, { gems: 3, golden: 1, boxes: [1, 2, 0, 0, 0] });
    assert.equal(p.lastSeq, 3);
    assert.equal(Bridge.pending(store, 3).entries.length, 0, 'minAck hides what this page already applied');
});

test('entries are clamped to whole numbers within the limits; junk is ignored', () => {
    const e = Bridge.clampEntry({ seq: 4.7, gems: 1e9, golden: -3, boxes: [2.9, 'x', 99, null, 1], src: 'boss' });
    assert.deepEqual(e, { seq: 4, gems: Bridge.LIMITS.gems, golden: 0, boxes: [2, 0, Bridge.LIMITS.box, 0, 1], src: 'boss', at: 0 });
    assert.equal(Bridge.clampEntry({ seq: 0, gems: 1 }), null);
    assert.equal(Bridge.clampEntry('nope'), null);
    const store = memStore({ [WORLD_KEY]: '{not json' });
    assert.deepEqual(Bridge.pending(store).entries, []);
});

test('prune forgets applied entries and moves held-back rewards in when there is room', () => {
    const s = { outSeq: 0, outbox: [] };
    for (let i = 0; i < Bridge.MAX_OUTBOX; i++) Bridge.push(s, { gems: 1 }, 0, NOW);
    assert.equal(Bridge.push(s, { gems: 70, boxes: box(2, 3) }, 0, NOW), null, 'full: held back');
    assert.deepEqual(s.overflow, { gems: 70, golden: 0, boxes: [0, 0, 3, 0, 0] });
    Bridge.prune(s, Bridge.MAX_OUTBOX, NOW);
    // 70 gems is more than one entry may carry, so it arrives as two entries and nothing is cut off
    assert.deepEqual(s.outbox.map(e => [e.seq, e.gems, e.boxes[2]]), [[Bridge.MAX_OUTBOX + 1, 50, 3], [Bridge.MAX_OUTBOX + 2, 20, 0]]);
    assert.equal(s.overflow, null);
});

test('describe reads naturally', () => {
    assert.equal(Bridge.describe({ gems: 3, golden: 1, boxes: [0, 2, 0, 0, 0] }), 'From the Wilds: +3 gems, +1 Golden What Happened and 2 Iron Chests');
    assert.equal(Bridge.describe({ gems: 1, golden: 0, boxes: [0, 0, 0, 0, 0] }), 'From the Wilds: +1 gem');
    assert.equal(Bridge.describe({ gems: 0, golden: 0, boxes: [0, 0, 0, 0, 0] }), '');
});

// ---------- the real game (main.js + items.js) ----------

function gameWithRewards(rewards, extra = {}) {
    const w = worldWith(rewards);
    return loadGame({ now: NOW, storage: { [WORLD_KEY]: JSON.stringify(w), ...extra.storage }, beforeInit: extra.beforeInit });
}
const items = (g) => JSON.parse(g.storage.getItem('whathappened_items') || 'null');

test('opening the game applies rewards sent from the Wilds, saves them, and moves the ack', () => {
    const g = gameWithRewards([{ gems: 2, src: 'boss' }, { golden: 1 }, { boxes: box(1, 2), gems: 1 }]);
    assert.equal(g.eval('getGems()'), 3);
    assert.equal(g.eval('goldenWhat'), 1);
    assert.equal(g.eval('totalGoldenEver'), 1);
    assert.equal(g.eval('divineUnlocked'), true);
    assert.equal(g.savedState().diamonds, 3, 'saved, so the next autosave keeps it');
    assert.equal(g.savedState().goldenWhat, 1);
    assert.deepEqual(items(g).boxes, [0, 2, 0, 0, 0]);
    assert.equal(items(g).stats.fromWorld, 2);
    assert.equal(g.storage.getItem(ACK_KEY), '3');
    g.close();
});

test('reloading does not pay the same rewards twice', () => {
    const g = gameWithRewards([{ gems: 4, boxes: box(0, 1) }]);
    const g2 = g.reload();
    assert.equal(g2.eval('getGems()'), 4);
    assert.deepEqual(items(g2).boxes, [1, 0, 0, 0, 0]);
    g.close(); g2.close();
});

test('nothing is applied while a prestige or reset is about to reload the page', () => {
    const g = gameWithRewards([{ gems: 5 }], { beforeInit: (w) => w.eval('suppressAutosave = true') });
    assert.equal(g.eval('getGems()'), 0);
    assert.equal(g.storage.getItem(ACK_KEY), null, 'the rewards wait for the next load');
    g.close();
});

test('a failed save rolls the rewards back and leaves the ack alone', () => {
    const g = gameWithRewards([]);
    g.eval('diamonds = 7; goldenWhat = 2;');
    const w = worldWith([{ gems: 5, golden: 1 }]);
    g.storage.setItem(WORLD_KEY, JSON.stringify(w));
    g.eval('window.__realSave = saveGame; saveGame = () => false;');
    assert.equal(g.eval('applyWorldRewards()'), false);
    assert.equal(g.eval('getGems()'), 7);
    assert.equal(g.eval('goldenWhat'), 2);
    assert.equal(g.storage.getItem(ACK_KEY), null);
    g.eval('saveGame = window.__realSave;');
    assert.equal(g.eval('applyWorldRewards()'), true);
    assert.equal(g.eval('getGems()'), 12);
    g.close();
});

test('rewards from the Wilds open in another tab arrive through a storage event', () => {
    const g = gameWithRewards([]);
    const w = worldWith([{ gems: 2 }, { boxes: box(3, 1) }]);
    const raw = JSON.stringify(w);
    g.storage.setItem(WORLD_KEY, raw);
    g.window.dispatchEvent(new g.window.StorageEvent('storage', { key: WORLD_KEY, newValue: raw }));
    assert.equal(g.eval('getGems()'), 2);
    assert.deepEqual(items(g).boxes, [0, 0, 0, 1, 0]);
    assert.equal(g.storage.getItem(ACK_KEY), '2');
    g.close();
});

test('gems from the Wilds survive a prestige', () => {
    const g = gameWithRewards([{ gems: 6 }]);
    g.eval('upgrade12Level = 150; upgrade1Level = 1400');
    g.eval('buyPrestige()');
    g.runTimeouts();
    const g2 = g.reload();
    assert.equal(g2.eval('getGems()'), 6);
    assert.equal(g2.storage.getItem(ACK_KEY), '1');
    g.close(); g2.close();
});

test('reset removes the world save and the ack together', () => {
    const g = gameWithRewards([{ gems: 1 }]);
    g.eval('resetGame()');
    assert.equal(g.storage.getItem(WORLD_KEY), null);
    assert.equal(g.storage.getItem(ACK_KEY), null);
    g.close();
});
