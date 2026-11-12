'use strict';
// Gear for the game on the real page (main.js + items.js + gear-panel.js): it arrives once from the Wilds, is worn at once
// in an empty slot, raises income and click power by exactly its boosts, survives a prestige and a reload, can go back to
// the Wilds through the inbox (only main.js writes it), and the bridge carries it both ways.
const test = require('node:test');
const assert = require('node:assert/strict');
const Bridge = require('../core/world-bridge');
const Gr = require('../core/gear');
const W = require('../core/world-logic');
const { loadGame } = require('./helpers/game-harness');

const NOW = new Date(2026, 10, 10, 12, 0, 0).getTime();
const { WORLD_KEY, ACK_KEY, INBOX_KEY } = Bridge;
const piece = (o) => Gr.cleanPiece(Object.assign({ id: 7, s: 'cursor', t: 3, l: [['swift', 1], ['might', 1]], c: ['#ff3b6b', '#ffe14d'], by: 'Tester' }, o));
function worldSending(pieces) {
    const s = W.freshState(NOW);
    s.satchel = pieces.map((p, i) => Object.assign({}, p, { id: i + 1 }));
    s.relics.nextPid = pieces.length + 1;
    W.sendToGame(s, s.satchel.map(p => p.id), 0, NOW);
    return JSON.parse(W.serialize(s));
}
const gearSave = (g) => JSON.parse(g.storage.getItem('whathappened_gear') || 'null');
const setUp = (g) => g.eval('upgrade2Level = 50; upgrade3Level = 30; upgrade5Level = 12; updateDisplays();');

test('the bridge carries gear: checked, ten an entry, never merged; junk is dropped', () => {
    const s = { outSeq: 0, outbox: [] };
    const list = Array.from({ length: 23 }, (_, i) => piece({ id: i + 1 }));
    Bridge.push(s, { gear: list.concat([{ s: 'hat' }, 'x']) }, 0, NOW);
    assert.deepEqual(s.outbox.map(e => e.gear.length), [10, 10, 3]);
    const m = new Map([[WORLD_KEY, JSON.stringify(s)]]);
    const store = { getItem: (k) => (m.has(k) ? m.get(k) : null), setItem: (k, v) => m.set(k, String(v)), removeItem: (k) => m.delete(k) };
    const plan = Bridge.pending(store, 0);
    assert.equal(plan.totals.gear.length, 23);
    assert.match(Bridge.describe(plan.totals), /23 pieces of gear/);
    // a forged piece in the outbox can't claim more than the tables allow
    s.outbox[0].gear[0] = Object.assign({}, s.outbox[0].gear[0], { t: 99, l: [['might', 50]] });
    assert.deepEqual(Bridge.clampEntry(s.outbox[0]).gear[0].l, [['might', Gr.ROLL.hi]]);
    // a full outbox holds gear back, and a reload of the Wilds save keeps it waiting
    const full = { outSeq: 0, outbox: Array.from({ length: Bridge.MAX_OUTBOX }, (_, i) => ({ seq: i + 1, gems: 1, golden: 0, boxes: [0, 0, 0, 0, 0] })) };
    Bridge.push(full, { gear: [piece()] }, 0, NOW);
    assert.equal(full.overflow.gear.length, 1);
    const back = W.migrate(JSON.parse(JSON.stringify(Object.assign(W.freshState(NOW), { outbox: full.outbox, outSeq: full.outSeq, overflow: full.overflow }))), NOW);
    assert.equal(back.overflow.gear.length, 1, 'held-back gear survives a reload');
});

test('sent from the Wilds: it arrives once, an empty slot wears it, and its boosts raise income and click power exactly', () => {
    const plain = loadGame({ now: NOW, noRenown: true });
    const g = loadGame({ now: NOW, noRenown: true, storage: { [WORLD_KEY]: JSON.stringify(worldSending([piece()])) } });
    for (const x of [plain, g]) setUp(x);
    const saved = gearSave(g);
    assert.equal(saved.pieces.length, 1);
    assert.equal(saved.equipped.cursor, saved.pieces[0].id, 'worn at once');
    assert.equal(g.storage.getItem(ACK_KEY), '1');
    const v = Gr.lineValues('swift', 3, 1, 0).cps, c = Gr.lineValues('might', 3, 1, 0).click;
    assert.ok(Math.abs(Number(g.eval('cps')) / Number(plain.eval('cps')) - (1 + v / 100)) < 1e-9, 'income');
    assert.ok(Math.abs(Number(g.eval('clickPower')) / Number(plain.eval('clickPower')) - (1 + c / 100)) < 1e-9, 'click power');
    // a reload doesn't bring it twice
    const g2 = g.reload();
    assert.equal(gearSave(g2).pieces.length, 1);
    // taking it off: back to plain
    g2.eval('WHGearPanel.wear(' + saved.pieces[0].id + '); updateDisplays();');
    setUp(g2);
    assert.ok(Math.abs(Number(g2.eval('cps')) - Number(plain.eval('cps'))) < 1e-6);
    plain.close(); g.close(); g2.close();
});

test('gear survives a prestige', () => {
    const g = loadGame({ now: NOW, noRenown: true, storage: { [WORLD_KEY]: JSON.stringify(worldSending([piece()])) } });
    g.eval('upgrade12Level = 150; upgrade1Level = 1400');
    g.eval('buyPrestige()');
    g.runTimeouts();
    const g2 = g.reload();
    assert.equal(gearSave(g2).pieces.length, 1);
    assert.equal(g2.eval('getGearBonuses().cps'), Gr.lineValues('swift', 3, 1, 0).cps);
    g.close(); g2.close();
});

test('crit chance, crit damage, gem find, offline earnings and the lootbox rate all take gear into account', () => {
    const set = [piece({ id: 1, s: 'cursor', l: [['keen', 1]] }), piece({ id: 2, s: 'crown', l: [['ember', 1]] }), piece({ id: 3, s: 'cloak', l: [['ward', 1]] }), piece({ id: 4, s: 'ring', l: [['fortune', 1]] })];
    const g = loadGame({ now: NOW, noRenown: true, storage: { [WORLD_KEY]: JSON.stringify(worldSending(set)) } });
    const b = g.eval('getGearBonuses()');
    assert.equal(b.critChance, Gr.CRIT[3]);
    assert.equal(b.critDmg, Gr.MAIN[3]);
    assert.equal(b.offline, Gr.MAIN[3]);
    assert.equal(b.gems, Gr.MINOR[3]);
    assert.equal(b.boxRate, Gr.MINOR[3]);
    const src = require('fs').readFileSync(require('path').join(__dirname, '..', 'main.js'), 'utf8');
    for (const where of ['getGearBonuses().critChance', 'getGearBonuses().critDmg', 'getGearBonuses().gems', 'gear.offline', 'gearOfflinePercent']) assert.ok(src.includes(where), 'main.js reads ' + where);
    assert.ok(require('fs').readFileSync(require('path').join(__dirname, '..', 'items.js'), 'utf8').includes('WHGearPanel.bonuses().boxRate'), 'the lootbox rate');
    const calc = require('../core/calc').create();
    const base = { pirateEffective: 10, otherEffective: 0, jonathanEffective: 0, crEffective: 0 };
    assert.ok(Math.abs(calc.offlineCps(Object.assign({ gearCpsPercent: 50, gearOfflinePercent: 100 }, base)) - calc.offlineCps(base) * 3) < 1e-9, 'offline earnings');
    g.close();
});

test('sent back to the Wilds: queued in the inbox by main.js, taken off here, and collected into the Relic Satchel', async () => {
    const g = loadGame({ now: NOW, noRenown: true, storage: { [WORLD_KEY]: JSON.stringify(worldSending([piece()])) } });
    const id = gearSave(g).pieces[0].id;
    g.eval('WHGearPanel.sendBack(' + id + ')');
    await new Promise(r => setImmediate(r)); // the queueing promise settles
    assert.equal(gearSave(g).pieces.length, 0, 'taken off here');
    const inbox = JSON.parse(g.storage.getItem(INBOX_KEY));
    assert.equal(inbox.entries.length, 1);
    assert.equal(inbox.entries[0].gear.length, 1);
    // the Wilds collects it
    const store = g.storage, s = W.freshState(NOW);
    const got = Bridge.inbox(store, s.inAck);
    assert.equal(got.gear.length, 1);
    assert.equal(W.receivePieces(s, got.gear), 1);
    assert.equal(s.satchel[0].by, 'Tester', 'who forged it travels with it');
    g.close();
});

test('the gear save is synced to the account and removed by a reset', () => {
    const P = require('../core/progress');
    assert.ok(P.SYNC_KEYS.has('whathappened_gear'));
    const src = require('fs').readFileSync(require('path').join(__dirname, '..', 'main.js'), 'utf8');
    assert.ok(/removeItem\('whathappened_gear'\)/.test(src));
});
