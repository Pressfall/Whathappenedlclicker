'use strict';
// The Hall of Gods' secret: the word that opens its far wall, the hidden room, the hidden god, and the Auto Clicker
// bought there (paid partly in the Wilds, partly in the game) and what it does in the clicker.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const D = require('../core/world-data');
const W = require('../core/world-logic');
const G = require('../core/world-gods');
const Gen = require('../core/world-gen');
const Bridge = require('../core/world-bridge');
const { loadGame } = require('./helpers/game-harness');

const NOW = 1_700_000_000_000;
// the word, not written out here either, so searching the project for it finds nothing that gives it away
const WORD = Buffer.from('YnJpbGV5aXNt', 'base64').toString();
const rich = () => { const s = W.freshState(NOW); s.rubies = 1e7; return s; };
const stock = (s, mats, k = 1) => { for (const m in mats) W.give(s, m, mats[m] * k, true); };

// ---------- the word ----------

test('the word opens the far wall, only inside the Hall, once; nothing the game says ever spells it out', () => {
    for (const ok of [WORD, WORD[0].toUpperCase() + WORD.slice(1), WORD.toUpperCase() + '!', 'i say ' + WORD + ' to the wall']) assert.ok(W.isHallWord(ok), ok);
    for (const no of [WORD.slice(0, 6), WORD.slice(0, -1), WORD + 's', WORD.replace('ey', 'y'), '', 'open sesame']) assert.ok(!W.isHallWord(no), no);
    const s = W.freshState(NOW);
    assert.deepEqual(W.speak(s, 'town', WORD), { opened: false }, 'not in town');
    assert.deepEqual(W.speak(s, 'hall', 'hello?'), { opened: false });
    assert.equal(s.secrets.hallDoor, false);
    assert.deepEqual(W.speak(s, 'hall', WORD), { opened: true });
    assert.deepEqual(W.speak(s, 'hall', WORD), { opened: false }, 'it is already open');
    assert.equal(W.migrate(JSON.parse(W.serialize(s, NOW, 0)), NOW).secrets.hallDoor, true, 'it stays open');
    // the hints hint; they never say it
    const said = JSON.stringify([D.NPCS, D.QUESTS, D.HIDDEN_SHOP, G.HALL_GODS.map(id => G.GODS[id].lore)]).toLowerCase();
    assert.ok(!said.includes(WORD));
    for (const f of ['world-ui.js', 'world.js', 'core/world-logic.js', 'core/world-data.js']) assert.ok(!fs.readFileSync(path.join(__dirname, '..', f), 'utf8').toLowerCase().includes(WORD), f + ' does not contain it');
    assert.ok(D.NPCS.pilgrim.lines.length >= 3 && D.NPC_ORDER.filter(id => D.NPCS[id].rumor).length >= 4, 'a wanderer and rumours point the way');
});

// ---------- the hidden room on the map ----------

test('the hidden room is solid rock until it opens; then it can be walked into and holds the hidden god and the altar', () => {
    const hall = Gen.generateZone('hall');
    const tile = (p) => ({ x: Math.floor(p.x / D.TILE), y: Math.floor(p.y / D.TILE) });
    const reach = (m, p) => { const e = tile(m.entry), seen = Gen.flood(m, e.x, e.y), t = tile(p); return [[0, 0], [1, 0], [-1, 0], [0, 1], [0, -1]].some(([dx, dy]) => seen[(t.y + dy) * m.w + t.x + dx]); };
    const sec = hall.secret;
    assert.ok(!reach(hall, sec.statue) && !reach(hall, sec.altar), 'sealed');
    assert.ok(!hall.statues.some(st => st.god === 'briley') && hall.altars.length === 0);
    const lights = hall.lights.length;
    Gen.openSecret(hall);
    assert.ok(reach(hall, sec.statue) && reach(hall, sec.altar), 'open: both can be walked up to');
    assert.ok(Gen.isSolid(Gen.tileAt(hall, sec.altar.x, sec.altar.y)));
    assert.ok(hall.statues.some(st => st.god === 'briley') && hall.altars.length === 1 && hall.lights.length > lights);
    Gen.openSecret(hall);
    assert.equal(hall.altars.length, 1, 'opening twice adds nothing');
    // the hint-giver waits in the Hall, and every zone out in the wilds has someone at its camp
    for (const z of ['hall', ...D.ZONE_ORDER]) {
        const m = Gen.generateZone(z);
        assert.ok(m.npcs.length >= 1, z + ' has someone in it');
        for (const n of m.npcs) assert.ok(reach(m, n), z + ': ' + n.id + ' can be walked to');
    }
});

// ---------- the hidden god and its shards ----------

test('Frozen WH drops a Shard of the Hidden exactly one time in ten, luck or no luck; it is never sold or lost', () => {
    const drop = D.BOSSES.frozen.drops.find(d => d[0] === 'hidden_shard');
    assert.deepEqual(drop, ['hidden_shard', 1, 1, 0.1, 'fixed']);
    const roll = (r, luck) => { let i = 0; return W.rollLoot([drop], () => (i++ ? 0.99 : r), luck).hidden_shard || 0; };
    assert.equal(roll(0.099, 0), 1);
    assert.equal(roll(0.1, 0), 0);
    assert.equal(roll(0.15, 5), 0, 'luck does not raise it');
    assert.equal(D.MATERIALS_BY_ID.hidden_shard.kind, 'key', 'keys are never dropped on death or sold');
    assert.equal(D.MATERIALS_BY_ID.hidden_shard.sell, 0);
    assert.ok(!Object.values(D.BOSSES).some(b => b !== D.BOSSES.frozen && b.drops.some(d => d[0] === 'hidden_shard')), 'only the strongest boss');
});

test('the hidden god waits behind the wall, then rises on shards, rubies and materials, with no top level', () => {
    const s = rich();
    assert.equal(W.godState(s, 'briley').reason, 'hidden');
    W.speak(s, 'hall', WORD);
    assert.equal(W.godState(s, 'briley').reason, 'materials');
    let shards = 0, prev = 0;
    for (let lv = 1; lv <= 7; lv++) {
        const c = G.costFor('briley', lv);
        assert.ok(c.mats.hidden_shard >= 1 && c.rubies > prev, 'level ' + lv + ' needs shards, and more rubies than the last');
        shards += c.mats.hidden_shard; prev = c.rubies;
        stock(s, c.mats);
        assert.deepEqual(W.upgradeGod(s, 'briley'), { ok: true, level: lv });
    }
    assert.ok(shards >= 14, 'shards add up: one in ten Frozen WH kills');
    assert.ok(G.costFor('briley', 40), 'there is always a next level');
    assert.deepEqual(W.validate(s), []);
});

test('the hidden god strengthens every other god and every Divine upgrade', () => {
    const b = G.bonuses({ briley: 2, solarus: 4, fortuna: 1 });
    assert.equal(b.divine, 10);
    assert.equal(b.gods, 10);
    assert.ok(Math.abs(b.cps - 4 * 5 * 1.1) < 1e-9, 'Solarus 4: +20% CPS becomes +22%');
    assert.ok(Math.abs(b.critDmg - 6 * 1.1) < 1e-9);
    assert.equal(G.bonuses({ briley: 3 }).cps, 0, 'it blesses nothing by itself');
    assert.equal(G.describe('solarus', 4, { solarus: 4, briley: 2 }), '+22% CPS');
    // in the game: the Divine upgrades get its share on top of the Divine Prophit's
    const world = (gods) => ({ [Bridge.WORLD_KEY]: JSON.stringify({ v: 1, gods }) });
    const plain = loadGame({ now: NOW }), blessed = loadGame({ now: NOW, storage: world({ briley: 2 }) });
    for (const g of [plain, blessed]) g.eval('divineArgonLevel = 1; divineAssassinLevel = 2;');
    assert.equal(blessed.eval('getBrileyismBoost()'), 1.1);
    assert.ok(Math.abs((blessed.eval('getDivineCpsMult()') - 1) / (plain.eval('getDivineCpsMult()') - 1) - 1.1) < 1e-9, 'the Divine Argonian bonus is 10% bigger');
    assert.ok(Math.abs(blessed.eval('getDivineCritChance()') / plain.eval('getDivineCritChance()') - 1.1) < 1e-9, 'and the Divine Assassin bonus too');
    plain.close(); blessed.close();
});

// ---------- the Auto Clicker: bought in the hidden room ----------

const AC = 'autoClicker';
const enough = { gems: 5000, golden: 500 };

test('the Auto Clicker: behind the wall, once, for rubies and rare treasures here and gems and Golden in the game', () => {
    const s = rich();
    const cost = D.HIDDEN_SHOP[AC];
    assert.equal(W.hiddenShopState(s, AC, enough).reason, 'hidden');
    W.speak(s, 'hall', WORD);
    assert.equal(W.hiddenShopState(s, AC, enough).reason, 'materials');
    for (const rare of ['verdant_crown', 'midas_eye', 'phoenix_feather', 'crown_of_winter', 'hidden_shard']) assert.ok(cost.mats[rare] >= 1, 'asks for ' + rare);
    assert.ok(cost.rubies >= 15000 && Bridge.BUYS[AC].gems >= 5000 && Bridge.BUYS[AC].golden >= 500, 'expensive');
    stock(s, cost.mats);
    assert.equal(W.hiddenShopState(s, AC, { gems: 4999, golden: 500 }).reason, 'gems');
    assert.equal(W.hiddenShopState(s, AC, { gems: 5000, golden: 499 }).reason, 'golden');
    s.rubies = cost.rubies - 1;
    assert.equal(W.hiddenShopState(s, AC, enough).reason, 'rubies');
    s.rubies = cost.rubies + 7;
    const r = W.buyHidden(s, AC, enough, 0, NOW);
    assert.ok(r.ok);
    assert.equal(s.rubies, 7);
    assert.equal(W.count(s, 'midas_eye'), 0);
    assert.equal(s.secrets.autoClicker, true);
    assert.deepEqual(s.outbox.map(e => e.buy), [AC], 'the game is told');
    assert.equal(W.buyHidden(s, AC, enough, 0, NOW).reason, 'owned', 'once, ever');
    const back = W.migrate(JSON.parse(W.serialize(s, NOW, 0)), NOW);
    assert.deepEqual(back.secrets, { hallDoor: true, autoClicker: true });
    assert.equal(back.outbox[0].buy, AC);
    assert.deepEqual(W.migrate({ v: 1, secrets: { hallDoor: 'yes', autoClicker: 1 } }, NOW).secrets, { hallDoor: false, autoClicker: false });
});

test('the bridge carries a purchase as its own entry and drops ones it does not know', () => {
    assert.equal(Bridge.clampEntry({ seq: 3, buy: AC }).buy, AC);
    assert.equal(Bridge.clampEntry({ seq: 3, buy: 'freeGems' }).buy, undefined);
    assert.equal(Bridge.clampEntry({ seq: 3, buy: 'constructor' }).buy, undefined);
    assert.ok(!Bridge.isEmpty({ buy: AC }));
    const state = { outSeq: 4, outbox: [] };
    assert.equal(Bridge.push(state, { buy: AC, src: 'hidden' }, 0, NOW).seq, 5);
    const store = new Map([[Bridge.WORLD_KEY, JSON.stringify(state)], ['whathappened_save', JSON.stringify({ diamonds: 6123, goldenWhat: 512.5 })]]);
    const st = { getItem: (k) => (store.has(k) ? store.get(k) : null) };
    assert.deepEqual(Bridge.pending(st).totals.buys, [AC]);
    assert.deepEqual(Bridge.mainBalance(st), { gems: 6123, golden: 512.5 });
    assert.deepEqual(Bridge.mainBalance({ getItem: () => null }), { gems: 0, golden: 0 });
});

// ---------- in the game (the real main.js and items.js) ----------

function gameAfterBuying(gems, golden) {
    const s = rich();
    W.speak(s, 'hall', WORD); stock(s, D.HIDDEN_SHOP[AC].mats);
    W.buyHidden(s, AC, enough, 0, NOW);
    return loadGame({ now: NOW, storage: { [Bridge.WORLD_KEY]: JSON.stringify(s), whathappened_save: JSON.stringify({ version: 3, count: 0, diamonds: gems, goldenWhat: golden }) } });
}

test('in the game: the gems and Golden are taken and the Auto Clicker arrives as a Hidden charm, never paid for twice', () => {
    const g = gameAfterBuying(6000, 600);
    assert.equal(g.eval('getGems()'), 1000);
    assert.equal(g.eval('goldenWhat'), 100);
    assert.equal(g.savedState().diamonds, 1000, 'saved');
    assert.equal(g.eval('WHI.hasItem("autoClicker")'), true);
    assert.equal(g.eval('WHI.RARITIES[WHI.ITEMS_BY_ID.autoClicker.rarity].name'), 'Hidden');
    assert.equal(g.storage.getItem('whathappened_world_owed'), null, 'nothing left owing');
    const g2 = g.reload();
    assert.equal(g2.eval('getGems()'), 1000, 'not charged again');
    g.close(); g2.close();
});

test('without enough gems or Golden it waits, untouched, and arrives once they are there', () => {
    const g = gameAfterBuying(4000, 600);
    assert.equal(g.eval('getGems()'), 4000);
    assert.equal(g.eval('goldenWhat'), 600);
    assert.equal(g.eval('WHI.hasItem("autoClicker")'), false);
    assert.equal(g.storage.getItem('whathappened_world_owed'), JSON.stringify([AC]));
    g.eval('diamonds = 5500; settleWorldPurchases(false)');
    assert.equal(g.eval('getGems()'), 500);
    assert.equal(g.eval('goldenWhat'), 100);
    assert.equal(g.eval('WHI.hasItem("autoClicker")'), true);
    // a second copy owed by mistake is never charged
    g.storage.setItem('whathappened_world_owed', JSON.stringify([AC]));
    g.eval('diamonds = 9999; goldenWhat = 999; settleWorldPurchases(false)');
    assert.equal(g.eval('getGems()'), 9999);
    g.close();
});

test('the Hidden charm is never found in lootboxes and does not count toward the collection', () => {
    const g = loadGame({ now: NOW });
    assert.equal(g.eval('WHI.ITEMS_BY_ID.autoClicker.unique'), true);
    assert.equal(g.eval('WHI.BOXES.every(b => b.weights.length === 6)'), true, 'no box weighs the Hidden rarity');
    const before = g.eval('WHI.summary().charmsTotal');
    assert.equal(g.eval('WHI.grantSpecial("autoClicker")'), true);
    assert.equal(g.eval('WHI.grantSpecial("autoClicker")'), false, 'one of a kind');
    assert.equal(g.eval('WHI.summary().charmsTotal'), before);
    assert.equal(g.eval('WHI.sellValue(WHI.ITEMS_BY_ID.autoClicker)'), 0, 'it cannot be sold');
    g.close();
});

// jsdom's page counts as hidden, and the Auto Clicker rests on a hidden page; these tests look at a page that is showing
function clickerGame() {
    const g = loadGame({ now: NOW });
    g.eval('Object.defineProperty(document, "hidden", { configurable: true, get: () => window.__hidden === true })');
    g.eval('WHI.grantSpecial("autoClicker"); WHI.toggleEquip("autoClicker"); upgrade2Level = 50; upgrade3Level = 30; upgrade5Level = 12; updateDisplays();');
    return g;
}

test('equipped and put on the image, it clicks 10 times a second: earnings, but no gems, click stats or clan clicks', () => {
    const g = clickerGame();
    assert.equal(g.eval('WHI.autoClicks()'), 10);
    assert.equal(g.eval('autoClickTick()'), false, 'not placed yet');
    g.eval('setAutoTarget("image"); count = 0; diamonds = 0; Math.random = () => 0;');
    const per = g.eval('Number(clickPower) * Number(goldenMultiplier)');
    const clicks0 = g.eval('_memLifetimeClicks');
    for (let i = 0; i < 10; i++) assert.equal(g.eval('autoClickTick()'), true);
    assert.ok(Math.abs(Number(g.eval('count')) - 10 * per) < 1e-9 * per, '10 clicks of earnings');
    assert.equal(g.eval('getGems()'), 0, 'no gem finds, even with every roll lucky');
    assert.equal(g.eval('_memLifetimeClicks'), clicks0, 'not counted as your clicks');
    assert.equal(g.eval('window._pendingClanClicks || 0'), 0);
    assert.equal(g.storage.getItem('whathappened_autoclicker'), JSON.stringify({ target: 'image' }), 'this device remembers where it is');
    // the bar under the image says what it is doing
    assert.equal(g.eval('document.getElementById("autoClicker").hidden'), false);
    assert.match(g.eval('document.getElementById("autoClickerState").textContent'), /Clicking the What Happened image, 10 times a second/);
    // a page in the background rests; unequipped, it stops
    g.eval('window.__hidden = true');
    assert.equal(g.eval('autoClickTick()'), false);
    g.eval('window.__hidden = false; WHI.toggleEquip("autoClicker")');
    assert.equal(g.eval('autoClickTick()'), false);
    assert.equal(g.eval('document.getElementById("autoClicker").hidden'), true);
    g.close();
});

test('put on an upgrade, it clicks that upgrade instead', () => {
    const g = clickerGame();
    g.eval('window.__ups = 0; document.getElementById("upgrade1").addEventListener("click", () => window.__ups++); setAutoTarget("upgrade1"); count = 0;');
    for (let i = 0; i < 10; i++) g.eval('autoClickTick()');
    assert.equal(g.eval('window.__ups'), 10);
    assert.equal(Number(g.eval('count')), 0, 'it does not click the image too');
    g.close();
});

test('time away earns the same with or without the Auto Clicker: it is not part of offline earnings', () => {
    const away = (withClicker) => {
        const g = withClicker ? clickerGame() : loadGame({ now: NOW });
        if (withClicker) g.eval('setAutoTarget("image")'); else g.eval('upgrade2Level = 50; upgrade3Level = 30; upgrade5Level = 12; updateDisplays();');
        g.eval('count = 1000; updateDisplays(); saveGame();');
        const cps = Number(g.eval('cps'));
        g.advance(3600 * 1000);
        const back = g.reload();
        const gained = Number(back.eval('count')) - 1000;
        g.close(); back.close();
        return { gained, cps };
    };
    const plain = away(false), clicker = away(true);
    assert.equal(clicker.cps, plain.cps, 'CPS does not include it');
    assert.ok(plain.gained > 0 && Math.abs(clicker.gained - plain.gained) < 1e-9 * plain.gained, plain.gained + ' vs ' + clicker.gained);
});
