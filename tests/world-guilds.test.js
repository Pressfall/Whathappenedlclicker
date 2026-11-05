'use strict';
// Hero guilds (core/world-guilds.js): the Guildmaster's stock and contracts in the Wilds, the Glory shop's Guild Chest and
// its other new wares, and what guilds do in the game (main.js: +25% to their upgrade, the button's look). Also the potion
// limit in arena matches and waves, and the sword's flatter swing curve.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const G = require('../core/world-guilds');
const D = require('../core/world-data');
const W = require('../core/world-logic');
const C = require('../core/world-combat');
const Ar = require('../core/world-arena');
const Bridge = require('../core/world-bridge');
const { loadGame, ROOT } = require('./helpers/game-harness');

const NOW = new Date(2026, 10, 5, 9, 0, 0).getTime(); // a morning: the "a" stock
const HOUR = 3600 * 1000;
const opened = () => { const s = W.freshState(NOW); D.ZONE_ORDER.forEach(z => { s.unlocked.zones[z] = true; }); return s; };
const payFor = (s, up) => { const p = G.priceOf(up); s.rubies += p.rubies; for (const id in p.mats) W.give(s, id, p.mats[id], true); };

test('a guild for every hero of the game, with its name, a contract in its own zone and a price that grows with the hero', () => {
    const src = fs.readFileSync(path.join(ROOT, 'main.js'), 'utf8');
    const names = [null].concat(/const UPGRADE_NAMES = \[null,([^\]]*)\]/.exec(src)[1].match(/'(?:[^'\\]|\\.)*'|"[^"]*"/g).map(x => x.slice(1, -1).replace(/\\'/g, "'")));
    assert.equal(G.GUILDS.length, names.length - 1, 'one guild per upgrade');
    let lastRubies = 0;
    for (const g of G.GUILDS) {
        assert.equal(g.hero, names[g.up], g.up + ': the game\'s name');
        assert.ok(g.name && g.crest && /^#[0-9a-f]{6}$/i.test(g.color), g.up);
        const p = G.priceOf(g.up), c = G.contractOf(g.up);
        assert.ok(p.rubies >= lastRubies && p.rubies >= 3000, g.up + ' is expensive, and later heroes cost more');
        lastRubies = p.rubies;
        for (const id in p.mats) assert.ok(D.MATERIALS_BY_ID[id] && p.mats[id] > 0, g.up + ' ' + id);
        assert.ok(D.ZONE_ORDER.includes(c.need.zone) && c.goal.n >= 1 && c.title && c.text, g.up);
        if (c.goal.zone) assert.equal(c.goal.zone, c.need.zone);
        if (c.goal.boss) assert.equal(D.BOSSES[c.goal.boss].zone, c.need.zone, g.up + ': its zone\'s own boss');
    }
});

test('six guilds in stock, the same for everyone, and new stock every two days', () => {
    const a = G.stockFor(G.periodOf(NOW));
    assert.equal(a.length, G.STOCK_SIZE);
    assert.equal(new Set(a).size, 6);
    assert.ok(a.every(up => G.BY_UP[up]));
    assert.deepEqual(G.stockFor(G.periodOf(NOW + HOUR)), a, 'all morning');
    // a block is two local days: the stock holds until local midnight, changes then, and holds for two days
    const nextAt = G.nextRestockAt(NOW);
    assert.equal(G.periodOf(nextAt - 1000), G.periodOf(NOW), 'holds until the restock');
    assert.notEqual(G.periodOf(nextAt), G.periodOf(NOW), 'changes at the restock');
    assert.equal(new Date(nextAt).getHours(), 0, 'at local midnight');
    const after = G.nextRestockAt(nextAt);
    assert.equal(after - nextAt, new Date(nextAt).setDate(new Date(nextAt).getDate() + 2) - nextAt, 'two days later, then again');
    assert.equal(G.periodOf(after - 1000), G.periodOf(nextAt), 'holds for two days');
    assert.notEqual(G.periodOf(after), G.periodOf(nextAt));
    assert.ok(nextAt - NOW <= 48 * HOUR && nextAt > NOW);
    // over a few weeks every guild comes up
    const seen = new Set();
    for (let i = 0; i < 60; i++) G.stockFor(G.periodOf(NOW + i * 48 * HOUR)).forEach(up => seen.add(up));
    assert.equal(seen.size, G.GUILDS.length);
});

test('a guild is bought by finishing its contract and paying, then it is sold out until the next stock', () => {
    const s = opened();
    const [up, other] = W.guildStock(s, NOW).items.map(i => i.up);
    assert.equal(W.buyGuild(s, up, NOW).reason, 'contract', 'no contract, no charter');
    assert.equal(W.takeGuildContract(s, up, NOW).ok, true);
    assert.equal(W.takeGuildContract(s, other, NOW).reason, 'busy', 'one contract at a time');
    assert.equal(W.buyGuild(s, up, NOW).reason, 'unfinished');
    const goal = G.contractOf(up).goal;
    for (let i = 0; i < goal.n; i++) W.questEvent(s, { kind: goal.kind, zone: goal.zone, elite: true, boss: goal.boss, tool: 'pickaxe' });
    assert.deepEqual(W.guildContractProgress(s), { have: goal.n, need: goal.n, done: true });
    assert.ok(W.activeQuests(s).some(a => a.npc === 'guildmaster' && a.progress.done), 'it shows in the quest tracker');
    assert.equal(W.buyGuild(s, up, NOW).reason, 'rubies');
    payFor(s, up);
    const r = W.buyGuild(s, up, NOW);
    assert.deepEqual([r.ok, r.owned], [true, 1]);
    assert.equal(s.rubies, 0, 'the price is paid');
    assert.equal(W.takeGuildContract(s, up, NOW).reason, 'soldout');
    assert.ok(W.guildStock(s, NOW).items.find(i => i.up === up).sold);
    // as many as you like: once it is back in stock, again
    const later = NOW + 48 * HOUR * 30;
    let p = G.periodOf(later), t = later;
    for (let i = 0; !G.stockFor(p).includes(up); i++) { t += 48 * HOUR; p = G.periodOf(t); }
    assert.equal(W.takeGuildContract(s, up, t).ok, true);
    s.guilds.contract.prog = 1e6;
    payFor(s, up);
    assert.equal(W.buyGuild(s, up, t).owned, 2);
    assert.deepEqual(W.validate(s), []);
});

test('a contract taken stays yours when the stock changes; a guild in a closed zone waits', () => {
    const fresh = W.freshState(NOW);
    const locked = W.guildStock(fresh, NOW).items.find(i => i.locked);
    if (locked) assert.equal(W.takeGuildContract(fresh, locked.up, NOW).reason, 'locked');
    const s = opened();
    const up = W.guildStock(s, NOW).items[0].up;
    W.takeGuildContract(s, up, NOW);
    let t = NOW + 48 * HOUR;
    while (G.stockFor(G.periodOf(t)).includes(up)) t += 48 * HOUR;
    const gs = W.guildStock(s, t);
    assert.equal(gs.contract.up, up, 'still yours');
    s.guilds.contract.prog = 1e6; payFor(s, up);
    assert.equal(W.buyGuild(s, up, t).ok, true);
    assert.equal(W.dropGuildContract(s), false);
    W.takeGuildContract(s, gs.items[0].up, t);
    assert.equal(W.dropGuildContract(s), true);
    assert.equal(s.guilds.contract, null);
});

test('guild records in an old or damaged save are cleaned on load', () => {
    const raw = JSON.parse(W.serialize(W.freshState(NOW), NOW, 0));
    raw.guilds = { owned: { 2: 3, 99: 4, 5: -1, 7: 'x' }, sold: { period: '2026-11-05a', ups: { 2: true, 77: true } }, contract: { up: 6, prog: 1e9 } };
    const s = W.migrate(raw, NOW);
    assert.deepEqual(s.guilds.owned, { 2: 3 });
    assert.deepEqual(s.guilds.sold.ups, { 2: true });
    assert.deepEqual(s.guilds.contract, { up: 6, prog: G.contractOf(6).goal.n });
    delete raw.guilds;
    assert.deepEqual(W.migrate(raw, NOW).guilds, { owned: {}, sold: { period: '', ups: {} }, contract: null });
});

test('the Glory shop: rubies, gems and Golden inside the daily caps, follower packs for the game, and a Guild Chest for 15,000', () => {
    const s = W.freshState(NOW);
    s.arena.glory = 1e6;
    assert.equal(Ar.SHOP_BY_ID.guild_chest.glory, 15000);
    const r = W.arenaBuy(s, 'guild_chest', NOW, 0, () => 0.999);
    assert.equal(r.guild, 29);
    assert.equal(s.guilds.owned[29], 1);
    assert.equal(W.arenaBuy(s, 'guild_chest', NOW, 0, () => 0).guild, 1, 'any guild can come out');
    const before = s.rubies;
    W.arenaBuy(s, 'rubies_l', NOW, 0);
    assert.equal(s.rubies, before + 12000);
    assert.equal(W.arenaBuy(s, 'gems', NOW, 0).gems, 3);
    assert.equal(W.arenaBuy(s, 'gems', NOW, 0).reason, 'cap', 'three more would pass today\'s 5');
    assert.equal(W.arenaBuy(s, 'golden', NOW, 0).golden, 1);
    assert.equal(W.arenaBuy(s, 'golden', NOW + 24 * HOUR, 0).reason, 'week', 'one a week');
    assert.equal(W.arenaBuy(s, 'pack_celestial', NOW, 0).ok, true);
    assert.equal(W.arenaBuy(s, 'pack_celestial', NOW, 0).reason, 'week');
    assert.equal(W.arenaBuy(s, 'pack_celestial', NOW + 7 * 24 * HOUR, 0).ok, true, 'a new week');
    const store = { getItem: (k) => (k === Bridge.WORLD_KEY ? W.serialize(s, NOW, 0) : null) };
    const t = Bridge.pending(store).totals;
    assert.deepEqual([t.gems, t.golden, t.packs], [3, 1, { celestial: 2 }]);
    assert.match(Bridge.describe(t), /2 Celestial Relics .*Followers page/);
    for (const it of Ar.SHOP) {
        if (it.pack) assert.ok(Bridge.isPack(it.pack), it.id);
        if (it.gems || it.golden) assert.ok(it.perWeek >= 1, it.id + ' has a weekly limit');
    }
    const back = W.migrate(JSON.parse(W.serialize(s, NOW, 0)), NOW);
    assert.deepEqual(back.arena.bought.n, s.arena.bought.n);
    assert.deepEqual(W.validate(back), []);
});

test('potions: 3 a fight in arena matches, the Pit and the waves; anywhere else as many as you have', () => {
    let t = null;
    assert.equal(W.potionsLeft(t, null), Infinity);
    for (let i = 0; i < D.RULES.potionsPerMatch; i++) { assert.ok(W.potionsLeft(t, 'match:a') > 0); t = W.notePotion(t, 'match:a'); }
    assert.equal(W.potionsLeft(t, 'match:a'), 0);
    assert.equal(W.potionsLeft(t, 'match:b'), D.RULES.potionsPerMatch, 'the next match starts again');
    assert.equal(W.potionsLeft(t, null), Infinity);
    assert.equal(D.RULES.potionsPerMatch, 3);
});

test('a sword gains less from swing speed than other weapons; a slow swing is unchanged', () => {
    const sword = D.WEAPON_CLASSES.sword, axe = D.WEAPON_CLASSES.axe;
    assert.equal(C.hitDamage(10, 0, 0, 1, sword).dmg, C.hitDamage(10, 0, 0, 1, axe).dmg);
    const ratio = (s) => C.hitDamage(10, s, 0, 1, sword).dmg / C.hitDamage(10, 0, 0, 1, sword).dmg;
    const ratioAxe = (s) => C.hitDamage(10, s, 0, 1, axe).dmg / C.hitDamage(10, 0, 0, 1, axe).dmg;
    assert.ok(ratio(0.5) < ratioAxe(0.5) && ratio(1) < ratioAxe(1), 'flatter');
    assert.ok(C.hitDamage(10, 1, 0, 1, sword).dmg < C.hitDamage(10, 1, 0, 1).dmg * 0.8, 'a perfect sword swing is down by over a fifth');
    assert.equal(C.hitDamage(10, 1, 0, 1, axe).dmg, C.hitDamage(10, 1, 0).dmg, 'other weapons keep their curve');
});

// ---------------- the game's side ----------------
const worldWith = (owned) => { const s = W.freshState(NOW); s.guilds.owned = owned; return W.serialize(s, NOW, 0); };

test('in the game every guild adds 25% to its own upgrade, and only to that one', () => {
    const play = (owned) => {
        const g = loadGame({ now: NOW, noRenown: true, storage: owned ? { [Bridge.WORLD_KEY]: worldWith(owned) } : {} });
        // (the Pirate's CPS is kept in pirateCps as it is bought, so set both)
        g.eval('upgrade2Level = 40; pirateCps = 40 * UPGRADE_CPS[2]; updateDisplays();');
        const pirate = Number(g.eval('cps'));
        g.eval('upgrade2Level = 0; pirateCps = 0; upgrade3Level = 40; updateDisplays();');
        const goon = Number(g.eval('cps'));
        g.eval('upgrade3Level = 0; upgrade1Level = 30; updateDisplays();');
        const click = Number(g.eval('clickPower'));
        g.close();
        return { pirate, goon, click };
    };
    const base = play(null), withGuilds = play({ 2: 2, 1: 1 });
    assert.ok(Math.abs(withGuilds.pirate / base.pirate - 1.5) < 1e-9, 'two Black Sail guilds: +50% Somalian Pirate');
    assert.ok(Math.abs(withGuilds.goon / base.goon - 1) < 1e-9, 'Goonsaw Man has none');
    // OP mouse: its own 30 levels of click power, +25% (the base click of 1 is not OP mouse's)
    assert.ok(Math.abs((withGuilds.click - 1) / (base.click - 1) - 1.25) < 1e-9, 'OP mouse: +25% of what it gives');
});

test('a guild dresses up its upgrade\'s button, more with more guilds', () => {
    const g = loadGame({ now: NOW, storage: { [Bridge.WORLD_KEY]: worldWith({ 2: 1, 3: 5 }) } });
    g.eval('_guildLookKey = ""; renderGuildLooks();');
    const look = (i) => g.eval(`(() => { const b = document.getElementById('upgrade${i}'), c = b.querySelector('.guild-crest'); return { has: b.classList.contains('has-guild'), shimmer: b.classList.contains('guild-shimmer'), crest: c && !c.hidden ? c.textContent : '', color: b.style.getPropertyValue('--guild-color') }; })()`);
    assert.deepEqual(JSON.parse(JSON.stringify(look(2))), { has: true, shimmer: false, crest: G.BY_UP[2].crest, color: G.BY_UP[2].color });
    assert.deepEqual(JSON.parse(JSON.stringify(look(3))), { has: true, shimmer: true, crest: G.BY_UP[3].crest + ' ×5', color: G.BY_UP[3].color });
    assert.equal(look(4).has, false);
    // and the guild achievements count them
    const snap = g.eval('WHA.snapshot()');
    assert.deepEqual([snap.wildsGuilds, snap.wildsGuildTop], [6, 5]);
    g.eval('WHA.checkAll()');
    assert.deepEqual(['w_guild1', 'w_guild10', 'w_guild_one5'].map(k => g.storage.getItem('ach_' + k)), ['1', null, '1']);
    g.close();
});

test('follower packs from the Glory shop wait on the Followers page, to open free', () => {
    const s = W.freshState(NOW);
    s.arena.glory = 1e5;
    W.arenaBuy(s, 'pack_sack', NOW, 0);
    W.arenaBuy(s, 'pack_royal', NOW, 0);
    const g = loadGame({ now: NOW, storage: { [Bridge.WORLD_KEY]: W.serialize(s, NOW, 0) } });
    g.eval('applyWorldRewards()');
    const f = JSON.parse(g.storage.getItem('whathappened_followers'));
    assert.deepEqual(f.freePacks, { sack: 1, royal: 1 });
    // opening one free costs no Golden and starts no cooldown
    const golden = Number(g.eval('goldenWhat'));
    const got = g.eval('(() => { const st = WHF.loadState(); st.freePacks.royal--; const out = WHF.openPack(st, "royal", { free: true }); WHF.saveState(st); return { n: out.length, wait: WHF.packWait(st, "royal") }; })()');
    assert.deepEqual(JSON.parse(JSON.stringify(got)), { n: 3, wait: 0 });
    assert.equal(Number(g.eval('goldenWhat')), golden);
    g.close();
});
