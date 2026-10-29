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
    assert.deepEqual(p.totals, { gems: 3, golden: 1, boxes: [1, 2, 0, 0, 0], buys: [] });
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

test('a purchase on top of a full outbox survives reloading the save, and so does the oldest reward', () => {
    const W = require('../core/world-logic');
    const s = W.freshState(NOW);
    for (let i = 0; i < Bridge.MAX_OUTBOX; i++) Bridge.push(s, { gems: 1, src: 't' }, 0, NOW);
    assert.equal(s.outbox.length, Bridge.MAX_OUTBOX);
    Bridge.push(s, { buy: 'autoClicker', src: 'hidden' }, 0, NOW);
    const back = W.migrate(JSON.parse(W.serialize(s, NOW, 0)), NOW);
    assert.equal(back.outbox.length, Bridge.MAX_OUTBOX + 1);
    assert.equal(back.outbox[0].seq, 1, 'the oldest reward is still there');
    assert.equal(back.outbox[back.outbox.length - 1].buy, 'autoClicker');
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

test('reset removes the world save, the ack and the rubies inbox together', () => {
    const g = gameWithRewards([{ gems: 1 }]);
    g.storage.setItem(Bridge.INBOX_KEY, JSON.stringify({ seq: 1, entries: [{ seq: 1, rubies: 5 }] }));
    g.eval('resetGame()');
    assert.equal(g.storage.getItem(WORLD_KEY), null);
    assert.equal(g.storage.getItem(ACK_KEY), null);
    assert.equal(g.storage.getItem(Bridge.INBOX_KEY), null);
    g.close();
});

// ---------- the other way: rubies from the game to the Wilds ----------

const { INBOX_KEY } = Bridge;
const inboxOf = (store) => JSON.parse(store.getItem(INBOX_KEY) || 'null');
const fullInbox = () => JSON.stringify({ seq: Bridge.MAX_INBOX, entries: Array.from({ length: Bridge.MAX_INBOX }, (_, i) => ({ seq: i + 1, rubies: 1 })) });

test('sendRubies numbers entries above the world\'s ack, never merges them, and forgets collected ones', () => {
    const store = memStore({ [WORLD_KEY]: JSON.stringify({ v: 1, inAck: 0 }) });
    assert.equal(Bridge.sendRubies(store, 100, 'golden', NOW).seq, 1);
    assert.equal(Bridge.sendRubies(store, 50.9, 'code', NOW).seq, 2);
    assert.deepEqual(Bridge.inbox(store, 0), { entries: [{ seq: 1, rubies: 100, src: 'golden', at: NOW }, { seq: 2, rubies: 50, src: 'code', at: NOW }], rubies: 150, lastSeq: 2 });
    // the world collected the first one and saved its ack
    store.setItem(WORLD_KEY, JSON.stringify({ v: 1, inAck: 1 }));
    assert.equal(Bridge.rubiesWaiting(store), 50);
    Bridge.sendRubies(store, 10, 'code', NOW);
    assert.deepEqual(inboxOf(store).entries.map(e => e.seq), [2, 3], 'collected entries are forgotten when the game writes next');
    assert.deepEqual(Bridge.inbox(store, 2), { entries: [{ seq: 3, rubies: 10, src: 'code', at: NOW }], rubies: 10, lastSeq: 3 });
    assert.equal(Bridge.sendRubies(store, 0, 'code', NOW), null);
    assert.equal(Bridge.sendRubies(store, -5, 'code', NOW), null);
    // the inbox was cleared (e.g. by hand) but the world remembers 7: never reuse a number
    store.removeItem(INBOX_KEY);
    store.setItem(WORLD_KEY, JSON.stringify({ v: 1, inAck: 7 }));
    assert.equal(Bridge.sendRubies(store, 1, 'code', NOW).seq, 8);
});

test('a big amount is split over several entries; a full inbox refuses everything; junk is ignored', () => {
    const store = memStore();
    Bridge.sendRubies(store, Bridge.MAX_RUBIES * 2 + 5, 'golden', NOW);
    assert.deepEqual(inboxOf(store).entries.map(e => e.rubies), [Bridge.MAX_RUBIES, Bridge.MAX_RUBIES, 5]);
    assert.equal(Bridge.inbox(store, 0).rubies, Bridge.MAX_RUBIES * 2 + 5, 'nothing is cut off');
    const full = memStore({ [INBOX_KEY]: fullInbox() });
    const before = full.getItem(INBOX_KEY);
    assert.equal(Bridge.sendRubies(full, 10, 'code', NOW), null);
    assert.equal(full.getItem(INBOX_KEY), before, 'nothing was written');
    const junk = memStore({ [INBOX_KEY]: JSON.stringify({ seq: 'x', entries: [{ seq: 0, rubies: 5 }, { seq: 2, rubies: -1 }, 'nope', { seq: 3, rubies: 1e12, src: 'code' }] }) });
    assert.deepEqual(Bridge.inbox(junk, 0).entries, [{ seq: 3, rubies: Bridge.MAX_RUBIES, src: 'code', at: 0 }]);
    assert.deepEqual(Bridge.inbox(memStore({ [INBOX_KEY]: '{not json' }), 0).entries, []);
});

test('trading Golden in the Divine menu takes and saves the Golden, then queues the rubies for the Wilds', async () => {
    const g = gameWithRewards([]);
    g.eval('goldenWhat = 5; divineUnlocked = true; saveGame();');
    assert.equal(await g.eval('tradeGoldenForRubies(2)'), true);
    assert.equal(g.eval('goldenWhat'), 3);
    assert.equal(g.savedState().goldenWhat, 3, 'saved before the rubies were queued');
    assert.deepEqual(Bridge.inbox(g.storage, 0).entries.map(e => [e.rubies, e.src]), [[2 * Bridge.GOLDEN_RUBIES, 'golden']]);
    assert.equal(await g.eval('tradeGoldenForRubies(4)'), false, 'more than you have');
    assert.equal(await g.eval('tradeGoldenForRubies(0)'), false);
    assert.equal(g.eval('goldenWhat'), 3);
    // the box in the menu: it trades what it says, and the note tells what is waiting
    g.eval('document.getElementById("goldenTradeInput").value = "1"');
    assert.equal(await g.eval('tradeGoldenForRubies()'), true);
    g.eval('renderGoldenTrade()');
    assert.match(g.eval('document.getElementById("goldenTradeNote").textContent'), new RegExp((3 * Bridge.GOLDEN_RUBIES).toLocaleString() + ' rubies are waiting'));
    g.close();
    const no = loadGame({ now: NOW, confirm: false });
    no.eval('goldenWhat = 5;');
    assert.equal(await no.eval('tradeGoldenForRubies(1)'), false, 'cancelled');
    assert.equal(no.eval('goldenWhat'), 5);
    assert.equal(no.storage.getItem(INBOX_KEY), null);
    no.close();
});

test('at most 4 Golden a week can be traded; the count starts again on Monday', async () => {
    assert.equal(Bridge.GOLDEN_TRADE_WEEKLY, 4);
    const g = gameWithRewards([]);
    const t = g.eval('Date.now()');
    g.eval('goldenWhat = 20; divineUnlocked = true; saveGame();');
    assert.equal(await g.eval('tradeGoldenForRubies(3)'), true);
    assert.equal(await g.eval('tradeGoldenForRubies(2)'), false, 'only 1 left this week');
    assert.equal(g.eval('goldenWhat'), 17);
    g.eval('renderGoldenTrade()');
    assert.match(g.eval('document.getElementById("goldenTradeNote").textContent'), /1 of 4 left to trade this week/);
    assert.equal(await g.eval('tradeGoldenForRubies(1)'), true);
    assert.equal(await g.eval('tradeGoldenForRubies(1)'), false, 'used up');
    assert.equal(g.eval('goldenWhat'), 16);
    assert.deepEqual(Bridge.inbox(g.storage, 0).entries.map(e => e.rubies), [3 * Bridge.GOLDEN_RUBIES, Bridge.GOLDEN_RUBIES]);
    g.eval('renderGoldenTrade()');
    assert.equal(g.eval('document.getElementById("goldenTradeBtn").disabled'), true);
    assert.match(g.eval('document.getElementById("goldenTradeNote").textContent'), /More can be traded on Monday/);
    assert.equal(Bridge.goldenTradeLeft(g.storage, t), 0);
    assert.equal(Bridge.goldenTradeLeft(g.storage, Bridge.nextWeekAt(t) - 1), 0, 'still this week until Monday');
    assert.equal(Bridge.goldenTradeLeft(g.storage, Bridge.nextWeekAt(t)), 4, 'a new week');
    assert.ok(JSON.parse(g.storage.getItem(Bridge.GOLDEN_TRADES_KEY)).week === Bridge.weekKey(t));
    g.close();
    // junk in the key counts as nothing traded; a count from another week too
    assert.equal(Bridge.goldenTradeLeft(memStore({ [Bridge.GOLDEN_TRADES_KEY]: '{oops' }), t), 4);
    assert.equal(Bridge.goldenTradeLeft(memStore({ [Bridge.GOLDEN_TRADES_KEY]: JSON.stringify({ week: '2001-W01', n: 4 }) }), t), 4);
    assert.equal(Bridge.goldenTradeLeft(memStore({ [Bridge.GOLDEN_TRADES_KEY]: JSON.stringify({ week: Bridge.weekKey(t), n: 99 }) }), t), 0);
    // weeks start on Monday, local time
    assert.equal(Bridge.weekKey(new Date(2026, 9, 25, 23).getTime()), Bridge.weekKey(new Date(2026, 9, 19, 0, 1).getTime()), 'Sunday is the end of the week that began on Monday');
    assert.notEqual(Bridge.weekKey(new Date(2026, 9, 26, 0, 1).getTime()), Bridge.weekKey(new Date(2026, 9, 25, 23).getTime()));
    assert.equal(new Date(Bridge.nextWeekAt(new Date(2026, 9, 29, 15).getTime())).getDay(), 1);
});

test('if the rubies cannot be queued, the Golden comes back', async () => {
    const g = gameWithRewards([], { storage: { [INBOX_KEY]: fullInbox() } });
    g.eval('goldenWhat = 4; saveGame();');
    assert.equal(await g.eval('tradeGoldenForRubies(2)'), false);
    assert.equal(g.eval('goldenWhat'), 4);
    assert.equal(g.savedState().goldenWhat, 4);
    assert.equal(Bridge.goldenTradeLeft(g.storage, g.eval('Date.now()')), 4, 'and it does not count toward the week');
    g.close();
});

// codes come from Firestore: a stand-in that knows one rubies code and one gems code
function withCodes(g) {
    g.eval(`window.db = {}; window.doc = (db, col, id) => id;
        window.getDoc = async (id) => { const codes = { WILDRUBIES: { type: 'rubies', amount: 5000 }, GEMS: { type: 'diamonds', amount: 3 } }; return { exists: () => !!codes[id], data: () => codes[id] }; };`);
    return async (code) => {
        g.eval(`document.getElementById('secretCodeInput').value = ${JSON.stringify(code)}`);
        await g.eval('redeemSecretCode()');
        return g.eval("document.getElementById('secretCodeStatus').innerText");
    };
}

test('a rubies code sends its rubies to the Wilds, once', async () => {
    const g = gameWithRewards([]);
    const redeem = withCodes(g);
    assert.match(await redeem('wildrubies'), /5,000 rubies/);
    assert.deepEqual(Bridge.inbox(g.storage, 0).entries.map(e => [e.rubies, e.src]), [[5000, 'code']]);
    assert.match(await redeem('WILDRUBIES'), /already redeemed/);
    assert.equal(Bridge.inbox(g.storage, 0).rubies, 5000);
    assert.match(await redeem('GEMS'), /3 gems/, 'the other code types still work');
    g.close();
});

test('a rubies code that cannot be stored can be tried again', async () => {
    const g = gameWithRewards([], { storage: { [INBOX_KEY]: fullInbox() } });
    const redeem = withCodes(g);
    assert.match(await redeem('WILDRUBIES'), /Couldn't store/);
    assert.equal(g.eval('getRedeemedCodes().includes("WILDRUBIES")'), false);
    g.storage.setItem(WORLD_KEY, JSON.stringify({ v: 1, inAck: Bridge.MAX_INBOX })); // the Wilds collected what was waiting
    assert.match(await redeem('WILDRUBIES'), /5,000 rubies/);
    g.close();
});
