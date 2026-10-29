'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const D = require('../core/world-data');
const W = require('../core/world-logic');
const G = require('../core/world-gods');
const Gen = require('../core/world-gen');
const { loadGame } = require('./helpers/game-harness');

const NOW = 1_700_000_000_000;

// ---------- the gods and what they cost ----------

test('every statue level costs more rubies than the one before, with no top level, in materials that exist, with boss trophies at 5, 7, 9 and 10', () => {
    const trophies = { 5: 'heartwood_seed', 7: 'gilded_heart', 9: 'inferno_horn', 10: 'frozen_tear' };
    for (const id of G.HALL_GODS) {
        let prev = 0;
        for (let lv = 1; lv <= 30; lv++) {
            const c = G.costFor(id, lv);
            assert.ok(c.rubies > prev, id + ' level ' + lv);
            prev = c.rubies;
            for (const m in c.mats) assert.ok(D.MATERIALS_BY_ID[m], id + ' asks for ' + m);
            if (trophies[lv]) {
                assert.equal(c.mats[trophies[lv]], 1, id + ' level ' + lv + ' needs its boss trophy');
                assert.equal(D.MATERIALS_BY_ID[trophies[lv]].kind, 'trophy');
            }
            if (lv >= 3) assert.ok(c.mats[G.GODS[id].offering] >= 2 * lv, id + ' offering at ' + lv);
            if (lv > 10) assert.ok(c.mats.mithril_bar > G.costFor(id, 10).mats.mithril_bar && c.mats.frozen_tear >= 1, id + ' asks for more past level 10');
        }
        assert.equal(G.costFor(id, 0), null);
        assert.equal(G.costFor(id, 2.5), null);
        assert.ok(G.GODS[id].name && G.GODS[id].icon && G.GODS[id].lore && /^#[0-9a-f]{6}$/i.test(G.GODS[id].color), id);
        for (const k in G.GODS[id].per) assert.ok(G.EFFECTS[k], id + ' blesses ' + k);
    }
    assert.equal(G.costFor('nope', 1), null);
});

test('blessings add up per level, with no top level; damaged levels count as 0', () => {
    assert.deepEqual(G.bonuses({}), { cps: 0, click: 0, critChance: 0, critDmg: 0, offline: 0, gems: 0, golden: 0, divine: 0, gods: 0 });
    const b = G.bonuses({ solarus: 3, fortuna: 2, nyx: 99, aurum: 'x', vulkar: -4, fake: 10 });
    assert.equal(b.cps, 15);
    assert.equal(b.critChance, 0.8);
    assert.equal(b.critDmg, 12);
    assert.equal(b.golden, 2 * 99, 'level 99 counts in full');
    assert.equal(G.levelsFrom({ gods: { nyx: 1e9 } }).nyx, G.LEVEL_CAP, 'only a damaged save is cut down');
    assert.equal(b.gems, 0);
    assert.equal(b.click, 0);
    assert.deepEqual(G.levelsFrom({ gods: { solarus: 2.9, chronos: 'junk' } }), { solarus: 2, vulkar: 0, fortuna: 0, chronos: 0, aurum: 0, nyx: 0, briley: 0 });
    assert.deepEqual(G.levelsFrom(null), G.levelsFrom({}));
    assert.equal(G.describe('fortuna', 2), '+0.8% critical click chance, +12% critical click damage');
    assert.equal(G.describe('solarus', 0), '');
});

// ---------- raising a statue ----------

const beat = (s, ...ids) => { for (const id of ids) s.bosses[id] = { kills: 1, lastKillDay: '', lastKillWeek: '', mythicWeek: '' }; };
function stocked(s, level) {
    const c = G.costFor('solarus', level);
    s.rubies += c.rubies;
    for (const m in c.mats) W.give(s, m, c.mats[m], true);
    return c;
}

test('a statue takes its rubies and materials and rises one level at a time, past 10 and on', () => {
    const s = W.freshState(NOW);
    assert.deepEqual(W.godState(s, 'solarus'), { ok: false, reason: 'rubies', level: 0, cost: G.costFor('solarus', 1) });
    s.rubies = 10000;
    assert.equal(W.godState(s, 'solarus').reason, 'materials');
    stocked(s, 1);
    const before = s.rubies;
    assert.deepEqual(W.upgradeGod(s, 'solarus'), { ok: true, level: 1 });
    assert.equal(s.rubies, before - G.costFor('solarus', 1).rubies);
    assert.equal(W.count(s, 'oak_plank'), 0, 'the materials are used up');
    for (let lv = 2; lv <= 14; lv++) { stocked(s, lv); assert.ok(W.upgradeGod(s, 'solarus').ok, 'level ' + lv); }
    assert.equal(s.gods.solarus, 14);
    assert.equal(W.godState(s, 'solarus').reason, 'rubies', 'level 15 just needs its own offering');
    assert.equal(W.upgradeGod(s, 'nope').reason, 'unknown');
    assert.deepEqual(W.validate(s), []);
    // the levels survive a save, and junk is cleaned
    const back = W.migrate(JSON.parse(W.serialize(s, NOW, 0)), NOW);
    assert.deepEqual(back.gods, { solarus: 14 });
    assert.deepEqual(W.migrate({ v: 1, gods: { solarus: 99, fake: 3, nyx: -1, aurum: 2 } }, NOW).gods, { solarus: 99, aurum: 2 });
});

test('bosses drop their own trophies, and the Trader buys them for a good price', () => {
    for (const [boss, common, rare] of [['overgrown', 'heartwood_seed', 'verdant_crown'], ['gilded', 'gilded_heart', 'midas_eye'], ['inferno', 'inferno_horn', 'phoenix_feather'], ['frozen', 'frozen_tear', 'crown_of_winter']]) {
        const drops = Object.fromEntries(D.BOSSES[boss].drops.map(d => [d[0], d[3]]));
        assert.ok(drops[common] > drops[rare] && drops[rare] > 0, boss);
        assert.ok(D.MATERIALS_BY_ID[rare].sell > D.MATERIALS_BY_ID[common].sell * 3, boss + ': the rare one is worth far more');
        assert.ok(D.MATERIALS_BY_ID[common].sell >= D.BOSSES[boss].rubies[1], boss + ': worth more than a kill pays in rubies');
    }
    const s = W.freshState(NOW);
    W.give(s, 'midas_eye', 1, true);
    assert.equal(W.sell(s, 'midas_eye', 1), D.MATERIALS_BY_ID.midas_eye.sell);
    // a lucky roll: every drop lands
    W.bossLoot(s, 'overgrown', () => 0, NOW, 0);
    assert.ok(W.count(s, 'heartwood_seed') >= 1 && W.count(s, 'verdant_crown') >= 1);
});

// ---------- the Hall itself ----------

test('the Hall of Gods: reached from a door in town; inside, a statue per god, a lit pathway, an empty far end and room kept for a secret chamber', () => {
    const town = Gen.generateZone('town'), hall = Gen.generateZone('hall');
    const tile = (m, p) => ({ x: Math.floor(p.x / D.TILE), y: Math.floor(p.y / D.TILE) });
    const reach = (m, from, p) => { const seen = Gen.flood(m, from.x, from.y), t = tile(m, p); return [[0, 0], [1, 0], [-1, 0], [0, 1], [0, -1]].some(([dx, dy]) => seen[(t.y + dy) * m.w + t.x + dx]); };
    const tEntry = tile(town, town.entry);
    assert.ok(reach(town, tEntry, town.hall.door), 'the Hall door can be walked to');
    for (const n of town.npcs) { assert.ok(!Gen.isSolid(Gen.tileAt(town, n.x, n.y)), n.id); assert.ok(reach(town, tEntry, n), n.id + ' can be walked to'); }
    assert.deepEqual(town.npcs.map(n => n.id), D.NPC_ORDER.filter(id => D.NPCS[id].zone === 'town'));
    const hEntry = tile(hall, hall.entry);
    assert.equal(hall.statues.length, G.HALL_GODS.length, 'a statue for every god but the hidden one');
    for (const st of hall.statues) {
        assert.ok(Gen.isSolid(Gen.tileAt(hall, st.x, st.y)), 'statue ' + st.slot + ' blocks its tile');
        assert.ok(reach(hall, hEntry, st), 'statue ' + st.slot + ' can be walked up to');
    }
    for (const b of hall.braziers.concat(hall.pillars)) assert.ok(Gen.isSolid(Gen.tileAt(hall, b.x, b.y)));
    assert.ok(hall.lights.length >= hall.braziers.length, 'every brazier is a light');
    assert.equal(Gen.tileAt(hall, hall.exit.x, hall.exit.y), Gen.T.PATH, 'the door is on the pathway');
    // the far end: open floor with nothing standing in it, up to the far wall
    const things = hall.statues.concat(hall.pillars, hall.braziers);
    const firstThing = Math.min(...things.map(t => tile(hall, t).y));
    const farWall = hall.secret.at.y / D.TILE - 1;
    assert.ok(firstThing - farWall >= 6, 'at least 6 empty rows at the far end');
    for (let y = farWall + 1; y < firstThing; y++) assert.ok(reach(hall, hEntry, { x: hall.secret.at.x, y: (y + 0.5) * D.TILE }), 'far end row ' + y + ' is open');
    // the secret chamber's space is solid rock for now, and behind the far wall
    const r = hall.secret.room;
    for (let y = r.y; y < r.y + r.h; y++) for (let x = r.x; x < r.x + r.w; x++) assert.equal(Gen.get(hall, x, y), Gen.T.WALL, 'secret room ' + x + ',' + y);
    assert.ok(r.y + r.h <= hall.secret.door.y && hall.secret.door.y + hall.secret.door.h <= farWall + 1, 'the doorway would go through the far wall');
    assert.ok(D.ZONES.hall.interior && !D.ZONE_ORDER.includes('hall'), 'not a travel destination');
});

// ---------- the blessings in the clicker (the real main.js) ----------

const worldWithGods = (gods) => JSON.stringify({ v: 1, rubies: 0, gods, outbox: [] });

test('statues raised in the Wilds bless the clicker: CPS, click power, crits, gems, Golden and offline', () => {
    const plain = loadGame({ now: NOW });
    plain.eval('upgrade2Level = 50; upgrade3Level = 30; upgrade5Level = 12; updateDisplays();');
    const blessed = loadGame({ now: NOW, storage: { whathappened_world: worldWithGods({ solarus: 4, vulkar: 2, fortuna: 5, chronos: 3, aurum: 2, nyx: 5 }) } });
    blessed.eval('upgrade2Level = 50; upgrade3Level = 30; upgrade5Level = 12; updateDisplays();');
    assert.deepEqual(JSON.parse(JSON.stringify(blessed.eval('getGodBonuses()'))), { cps: 20, click: 16, critChance: 2, critDmg: 30, offline: 30, gems: 10, golden: 10, divine: 0, gods: 0 });
    assert.deepEqual(JSON.parse(JSON.stringify(plain.eval('getGodBonuses()'))), { cps: 0, click: 0, critChance: 0, critDmg: 0, offline: 0, gems: 0, golden: 0, divine: 0, gods: 0 });
    const cps0 = Number(plain.eval('cps')), cps1 = Number(blessed.eval('cps'));
    assert.ok(cps0 > 0 && Math.abs(cps1 / cps0 - 1.2) < 1e-9, 'Solarus 4: +20% CPS (' + cps0 + ' -> ' + cps1 + ')');
    assert.ok(Math.abs(Number(blessed.eval('clickPower')) / Number(plain.eval('clickPower')) - 1.16) < 1e-9, 'Vulkar 2: +16% click power');
    assert.ok(Math.abs(plain.eval('getLevelsPerGolden()') / blessed.eval('getLevelsPerGolden()') - 1.1) < 1e-9, 'Nyx 5: +10% Golden');
    plain.close(); blessed.close();
});

test('Chronos raises what you earn while away', () => {
    const away = (gods) => {
        const g = loadGame({ now: NOW, storage: gods ? { whathappened_world: worldWithGods(gods) } : {} });
        g.eval('count = 1000; upgrade2Level = 50; upgrade3Level = 30; upgrade5Level = 12; updateDisplays(); saveGame();');
        g.advance(3600 * 1000);
        const back = g.reload();
        const gained = Number(back.eval('count')) - 1000;
        g.close(); back.close();
        return gained;
    };
    const plain = away(null), blessed = away({ chronos: 3 });
    assert.ok(plain > 0 && Math.abs(blessed / plain - 1.3) < 1e-6, 'Chronos 3: +30% offline (' + plain + ' -> ' + blessed + ')');
});

test('a statue raised in another tab counts at once, and the Divine menu lists the blessings', () => {
    const g = loadGame({ now: NOW });
    assert.match(g.eval('renderGodBlessings(), document.getElementById("godBlessings").textContent'), /Raise the god statues/);
    const raw = worldWithGods({ fortuna: 1 });
    g.storage.setItem('whathappened_world', raw);
    g.window.dispatchEvent(new g.window.StorageEvent('storage', { key: 'whathappened_world', newValue: raw }));
    assert.equal(g.eval('getGodBonuses().critChance'), 0.4);
    assert.match(g.eval('document.getElementById("godBlessings").textContent'), /Fortuna \(level 1\): \+0\.4% critical click chance/);
    g.close();
});
