'use strict';
// The crew: characters from the game's upgrades who move to Wildgate (core/world-crew.js), their quests and services in
// the Wilds, and what the game does about them (main.js: best levels, arrival notices, tags on the upgrade buttons).
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const Crew = require('../core/world-crew');
const D = require('../core/world-data');
const W = require('../core/world-logic');
const G = require('../core/world-gen');
const Bridge = require('../core/world-bridge');
const { loadGame, ROOT } = require('./helpers/game-harness');

const NOW = new Date(2026, 10, 4, 12, 0, 0).getTime();
const DAY = 24 * 3600 * 1000;
const read = (f) => fs.readFileSync(path.join(ROOT, f), 'utf8');
const view = (best, more) => Crew.clickerView(Object.assign({ best }, more || {}));
const everyone = () => view(Object.fromEntries(Crew.CREW.map(c => [c.up, 1000])), { prestiges: 5, clicks: 1e6, renown: 60 });
test.afterEach(() => W.setClickerView(null));

test('every crew member is one of the game\'s upgrades, with its portrait and name, and stands in town', () => {
    // main.js UPGRADE_NAMES starts with null (upgrades count from 1)
    const names = [null].concat(/const UPGRADE_NAMES = \[null,([^\]]*)\]/.exec(read('main.js'))[1].match(/'(?:[^'\\]|\\.)*'|"[^"]*"/g).map(s => s.slice(1, -1).replace(/\\'/g, "'")));
    const html = read('index.html');
    const ups = new Set();
    for (const c of Crew.CREW) {
        assert.ok(c.up >= 1 && c.up <= Crew.UPGRADES && !ups.has(c.up), c.id + ': a real upgrade, one crew member each');
        ups.add(c.up);
        assert.equal(names[c.up], c.name, c.id + ' has the upgrade\'s name');
        const img = new RegExp('id="upgrade' + c.up + '"[\\s\\S]*?<img class="upgrade-img" src="([^"]+)"').exec(html);
        assert.equal(img && img[1], c.face, c.id + ' wears the upgrade\'s picture');
        assert.ok(fs.existsSync(path.join(ROOT, c.face)), c.face);
        assert.ok(c.arrive >= 1 && c.greet && c.blurb && c.role, c.id);
        const npc = D.NPCS[c.id];
        assert.ok(npc && npc.crew === c.id && npc.zone === 'town', c.id + ' is a townsperson in the Wilds');
        assert.ok(npc.chain.some(q => D.QUESTS[q].goal.kind === 'clicker'), c.id + ' asks for something in the game');
        assert.ok(npc.chain.some(q => D.QUESTS[q].clicker), c.id + ' sends something to the game');
    }
});

test('the WH Depot and its yard: every crew member has their own spot, clear of doors, paths and each other', () => {
    const m = G.generateZone('town');
    const depot = m.stations.find(s => s.id === 'depot');
    assert.ok(depot, 'the Depot is a station in town');
    const seen = G.flood(m, Math.floor(m.entry.x / D.TILE), Math.floor(m.entry.y / D.TILE));
    const spots = m.npcs.filter(n => D.NPCS[n.id].crew);
    assert.equal(spots.length, Crew.CREW.length);
    const all = m.npcs.concat(m.stations.map(s => ({ id: s.id + ' door', x: s.door.x, y: s.door.y })));
    for (const n of spots) {
        const tx = Math.floor(n.x / D.TILE), ty = Math.floor(n.y / D.TILE), t = m.tiles[ty * m.w + tx];
        assert.equal(t, G.T.PLAZA, n.id + ' stands in the yard');
        assert.ok(seen[ty * m.w + tx], n.id + ' can be walked to');
        for (const o of all) if (o.id !== n.id) assert.ok(Math.hypot(o.x - n.x, o.y - n.y) >= 64, n.id + ' is too close to ' + o.id);
        // side by side, their names (drawn over their heads) need three tiles not to run into each other
        for (const o of spots) if (o.id !== n.id && o.y === n.y) assert.ok(Math.abs(o.x - n.x) >= 3 * D.TILE, n.id + ' and ' + o.id + ': names overlap');
    }
    const door = { x: Math.floor(depot.door.x / D.TILE), y: Math.floor(depot.door.y / D.TILE) };
    assert.ok(seen[door.y * m.w + door.x], 'the Depot\'s door can be walked to');
});

test('the jukebox plays the game\'s own music list', () => {
    const src = /const MUSIC_TRACKS = \[([\s\S]*?)\];/.exec(read('main.js'))[1];
    const game = [...src.matchAll(/id: '([^']+)', name: '([^']+)', cost: \d+, file: '([^']+)'/g)].map(m => ({ id: m[1], name: m[2], file: m[3] }));
    assert.deepEqual(Crew.MUSIC, game, 'core/world-crew.js MUSIC = main.js MUSIC_TRACKS');
    for (const t of Crew.MUSIC) assert.ok(fs.existsSync(path.join(ROOT, 'audio', t.file)), t.file);
    assert.deepEqual(Crew.ownedMusic({}).map(t => t.id), ['mainTheme'], 'the default theme is always yours');
    assert.deepEqual(Crew.ownedMusic({ musicOwned: { MetalSlam: true, UltraTwang: false } }).map(t => t.id), ['mainTheme', 'MetalSlam']);
});

test('the view of the game: best levels from either the stored best or this run, prestiges, clicks', () => {
    const v = Crew.clickerView({ save: { upgrade2Level: 40, upgrade3Level: 7, prestigeTimes: 2 }, best: { 2: 30, 3: 90 }, clicks: 1234, prestiges: 1 });
    assert.equal(v.best[2], 40, 'this run is further');
    assert.equal(v.best[3], 90, 'an earlier run was further');
    assert.equal(v.prestiges, 2);
    assert.equal(v.clicks, 1234);
    const store = { data: { whathappened_save: JSON.stringify({ upgrade11Level: 12 }), [Crew.BEST_KEY]: '{"2":25}', whathappened_followers: JSON.stringify({ seen: { a: 1, b: 1 } }) }, getItem(k) { return this.data[k] === undefined ? null : this.data[k]; } };
    const r = Crew.readView(store, 7);
    assert.equal(r.best[2], 25); assert.equal(r.best[11], 12); assert.equal(r.followersSeen, 2); assert.equal(r.renown, 7);
    assert.ok(Crew.arrived('pirate', r) && Crew.arrived('jonathan', r) && !Crew.arrived('grape', r));
    assert.ok(!Crew.discovered('grape', r));
    // junk is cut down, never thrown on
    assert.equal(Crew.clickerView({ best: { 2: 'x', 3: -5, 4: 1e99 } }).best[4], 1e9);
    assert.deepEqual(Crew.newArrivals(Crew.bestLevels({ 2: 24 }), Crew.bestLevels({ 2: 25, 3: 3 })), ['pirate']);
});

test('in the Wilds a crew member only gives quests once they are in town, and their game goals count the game', () => {
    const s = W.freshState(NOW);
    assert.equal(W.acceptQuest(s, 'pirate', NOW).reason, 'away', 'not in Wildgate yet');
    W.setClickerView(view({ 2: 30 }));
    assert.deepEqual(W.greetCrew(s), ['pirate']);
    assert.deepEqual(W.greetCrew(s), [], 'greeted once');
    s.quests.pirate = { step: 1, active: null, dailyDone: '' };
    assert.equal(W.acceptQuest(s, 'pirate', NOW).id, 'pirate_insurance');
    assert.deepEqual(W.questProgress(s, 'pirate'), { have: 30, need: 100, done: false });
    W.monsterLoot(s, 'slime', () => 0.99, NOW, { zone: 'greenwood' });
    assert.equal(W.questProgress(s, 'pirate').have, 30, 'nothing done in the Wilds counts');
    W.setClickerView(view({ 2: 140 }));
    assert.deepEqual(W.questProgress(s, 'pirate'), { have: 100, need: 100, done: true }, 'the game got there');
    assert.equal(W.turnInQuest(s, 'pirate', NOW, 0).ok, true);
    assert.equal(s.outbox.length, 0, 'this one pays rubies only');
    assert.deepEqual(W.validate(s), []);
});

test('handing in a crew story quest sends its consumables to the game; its daily never does', () => {
    W.setClickerView(everyone());
    const s = W.freshState(NOW);
    s.unlocked.zones.coast = true;
    s.quests.pirate = { step: 2, active: { id: 'pirate_hat', prog: 8 }, dailyDone: '' };
    const r = W.turnInQuest(s, 'pirate', NOW, 0);
    assert.deepEqual(r.clicker, { spareBattery: 3 });
    assert.deepEqual(s.outbox.map(e => e.items), [{ spareBattery: 3 }]);
    assert.equal(s.outbox[0].gems + s.outbox[0].golden, 0, 'never gems or Golden');
    const store = { getItem: (k) => (k === Bridge.WORLD_KEY ? W.serialize(s, NOW, 0) : null) };
    assert.equal(Bridge.describe(Bridge.pending(store).totals), 'From the Wilds: 3 Spare Batteries');
    // the daily
    assert.equal(W.questOffer(s, 'pirate', NOW).id, 'pirate_daily');
    W.acceptQuest(s, 'pirate', NOW);
    W.rivalLoot(s, 'greenwood', () => 0.99, NOW);
    assert.equal(W.turnInQuest(s, 'pirate', NOW, 0).clicker, undefined);
    assert.equal(s.outbox.length, 1);
});

test('crew shops and the Trading Hall: daily limits, zones that must be open, and never a way to make rubies', () => {
    W.setClickerView(everyone());
    const s = W.freshState(NOW);
    s.rubies = 5000;
    assert.equal(W.crewBuy(s, 'pirate', 'smug_iron', NOW).reason, 'locked', 'Stonepeak is not open yet');
    s.unlocked.zones.mines = true;
    for (let i = 0; i < 5; i++) assert.ok(W.crewBuy(s, 'pirate', 'smug_iron', NOW).ok);
    assert.equal(W.crewBuy(s, 'pirate', 'smug_iron', NOW).reason, 'soldout');
    assert.equal(s.mats.iron_ore, 10);
    assert.ok(W.crewBuy(s, 'pirate', 'smug_iron', NOW + DAY).ok, 'fresh stock the next day');
    assert.ok(W.crewBuy(s, 'grape', 'wine_big', NOW).ok);
    assert.equal(s.cons.potion_big, 1);
    // trades
    assert.equal(W.crewTrade(s, 'villager', 'tr_iron', NOW).reason, 'materials');
    W.give(s, 'stone', 24, true);
    assert.ok(W.crewTrade(s, 'villager', 'tr_iron', NOW).ok);
    assert.equal(s.mats.stone, 12);
    assert.deepEqual(W.validate(s), []);
    // what they sell is from the first four zones and costs more than the Trader pays; trades never gain value
    const value = (mats) => Object.entries(mats).reduce((a, [id, n]) => a + (D.MATERIALS_BY_ID[id] ? D.MATERIALS_BY_ID[id].sell * n : 0), 0);
    for (const list of Object.values(Crew.SHOPS)) for (const it of list) {
        for (const id in it.give) assert.ok(D.MATERIALS_BY_ID[id] || D.CONSUMABLES_BY_ID[id], it.id + ' ' + id);
        assert.ok(it.price > value(it.give), it.id + ' costs more than it sells for');
        if (it.need) assert.ok(D.ZONES[it.need].tier <= 4, it.id + ' comes from the first four zones');
        const stock = D.TRADER_STOCK.find(t => JSON.stringify(t.give) === JSON.stringify(it.give));
        if (stock) assert.ok(it.price <= stock.price, it.id + ' is no dearer than the Trader');
    }
    for (const list of Object.values(Crew.TRADES)) for (const t of list) {
        for (const id in Object.assign({}, t.give, t.get)) assert.ok(D.MATERIALS_BY_ID[id], t.id + ' ' + id);
        assert.ok(value(t.get) <= value(t.give), t.id + ' never gains rubies');
        assert.ok(D.ZONES[t.need] && D.ZONES[t.need].tier <= 4, t.id);
    }
    // not in town: no shop
    W.setClickerView(null);
    assert.equal(W.crewShop(s, 'pirate', NOW), null);
});

test('crew records in an old or damaged save are cleaned on load', () => {
    const raw = JSON.parse(W.serialize(W.freshState(NOW), NOW, 0));
    raw.crew = { seen: { pirate: true, nobody: true }, shop: { day: '2026-11-04', used: { smug_iron: 3, junk: 9 } }, trade: 'x' };
    delete raw.renown;
    const s = W.migrate(raw, NOW);
    assert.deepEqual(s.crew.seen, { pirate: true });
    assert.deepEqual(s.crew.shop.used, { smug_iron: 3 });
    assert.deepEqual(s.crew.trade, { day: '', used: {} });
    assert.deepEqual(s.renown, { claimed: [] });
    assert.deepEqual(W.validate(s), []);
});

// ---------------- the game's side ----------------
test('the game keeps the best level of every upgrade through a prestige, and says who left for Wildgate', () => {
    const g = loadGame({ now: NOW });
    g.eval('window.__notes = []; notify = (m) => { window.__notes.push(String(m)); };');
    g.eval('upgrade2Level = 24; saveGame();');
    assert.deepEqual(JSON.parse(g.storage.getItem(Crew.BEST_KEY))[2], 24);
    assert.equal(g.eval('window.__notes.filter(n => n.includes("Wildgate")).length'), 0);
    g.eval('upgrade2Level = 25; saveGame();');
    assert.match(g.eval('window.__notes.join("|")'), /Somalian Pirate packed a bag for Wildgate/);
    g.eval('saveGame();');
    assert.equal(g.eval('window.__notes.filter(n => n.includes("Wildgate")).length'), 1, 'said once');
    // the tag on the button
    g.eval('_crewTagKey = ""; renderCrewTags();');
    assert.equal(g.eval('document.querySelector("#upgrade2 .crew-tag").textContent'), '🏕️');
    // a prestige keeps it
    g.eval('upgrade12Level = 150; upgrade1Level = 1600; upgrade2Level = 60');
    g.eval('buyPrestige()');
    g.runTimeouts();
    const g2 = g.reload();
    assert.equal(Number(g2.eval('upgrade2Level')), 0, 'the run starts again');
    assert.equal(JSON.parse(g2.storage.getItem(Crew.BEST_KEY))[2], 60, 'the best level stays');
    assert.equal(JSON.parse(g2.storage.getItem(Crew.BEST_KEY))[12], 150);
    g.close(); g2.close();
});

test('a save that prestiged before the crew existed counts its early upgrades as reached', () => {
    // the notice comes as the game opens, so listen from the start
    const g = loadGame({ now: NOW, storage: { whathappened_save: JSON.stringify({ prestigeTimes: 2, goldenWhat: 3, totalGoldenEver: 5, upgrade1Level: 3 }), whathappened_prestige_times: '2' },
        beforeInit: (w) => { w.__notes = []; w.notify = (m) => { w.__notes.push(String(m)); }; } });
    g.eval('saveGame();');
    const best = JSON.parse(g.storage.getItem(Crew.BEST_KEY));
    assert.equal(best[12], 150);
    assert.equal(best[2], 25);
    assert.equal(best[29], undefined, 'nothing is made up past CR lurker');
    assert.match(g.eval('window.__notes.join("|")'), /Your crew moved to Wildgate: .*Jonathan.*Somalian Pirate/, 'one notice for everyone who came');
    g.close();
});

test('consumables from the Wilds reach the game\'s Items, and nothing else comes with them', () => {
    const s = W.freshState(NOW);
    Bridge.push(s, { items: { hourglass: 2, gemPouch: 5, goldenTicket: 1 }, src: 'crew' }, 0, NOW);
    const g = loadGame({ now: NOW, storage: { [Bridge.WORLD_KEY]: W.serialize(s, NOW, 0) } });
    const gems = g.eval('getGems()');
    g.eval('applyWorldRewards()');
    const items = JSON.parse(g.storage.getItem('whathappened_items'));
    assert.equal(items.items.hourglass, 2);
    assert.equal(items.items.gemPouch || 0, 0, 'gem items never come from the Wilds');
    assert.equal(items.items.goldenTicket || 0, 0);
    assert.equal(g.eval('getGems()'), gems);
    assert.equal(g.storage.getItem(Bridge.ACK_KEY), '1');
    g.close();
});

test('an upgrade the Wilds asks about shows the quest\'s progress on its button', () => {
    W.setClickerView(view({ 2: 30 }));
    const s = W.freshState(NOW);
    s.quests.pirate = { step: 1, active: { id: 'pirate_insurance', prog: 0 }, dailyDone: '' };
    const g = loadGame({ now: NOW, storage: { [Bridge.WORLD_KEY]: W.serialize(s, NOW, 0), [Crew.BEST_KEY]: '{"2":30}' } });
    g.eval('upgrade2Level = 37; _godCache.at = 0; _crewTagKey = ""; renderCrewTags();');
    const tag = g.eval('document.querySelector("#upgrade2 .crew-tag")');
    assert.equal(tag.textContent, '📜 37/100');
    assert.match(tag.title, /Plunder Insurance/);
    g.close();
});

test('the new progress keys follow the player to other devices, and a reset removes them', () => {
    const P = require('../core/progress');
    assert.ok(P.isSyncKey(Crew.BEST_KEY) && P.isSyncKey('whathappened_renown'));
    const g = loadGame({ now: NOW, storage: { [Crew.BEST_KEY]: '{"2":40}', whathappened_renown: '{"claimed":[5]}' } });
    g.eval('resetGame()');
    assert.equal(g.storage.getItem(Crew.BEST_KEY), null);
    assert.equal(g.storage.getItem('whathappened_renown'), null);
    g.close();
});
