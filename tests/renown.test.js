'use strict';
// Renown (core/renown.js): one rank for the game and the Wilds together, its passive boost on both sides, and the two
// halves of its milestones (each paid and noted by its own page).
const test = require('node:test');
const assert = require('node:assert/strict');
const R = require('../core/renown');
const Crew = require('../core/world-crew');
const D = require('../core/world-data');
const W = require('../core/world-logic');
const Bridge = require('../core/world-bridge');
const { loadGame } = require('./helpers/game-harness');

const NOW = new Date(2026, 10, 4, 12, 0, 0).getTime();
test.afterEach(() => W.setClickerView(null));

const clickerVet = { prestiges: 3, goldenEver: 50, clicks: 2e5, upgradesEver: 29, divineTotal: 8, followersSeen: 15 };
const wildsZone4 = { wildsZones: 5, wildsBosses: 3, wildsGodLevels: 6, wildsQuests: 20, wildsClasses: 2, wildsTopTier: 5 };
const maxClicker = { prestiges: 1e4, goldenEver: 1e12, clicks: 1e12, upgradesEver: 29, divineTotal: 500, followersSeen: 72 };
const maxWilds = { wildsZones: 9, wildsBosses: 8, wildsGodLevels: 500, wildsQuests: 1e4, wildsClasses: 5, wildsTopTier: 9, wildsArenaWins: 500, wildsTeamWins: 50, wildsWaveBest: 60 };

test('a fresh player has Renown 0, and the level curve is points = 0.1 x level squared', () => {
    assert.equal(R.rank({}).level, 0);
    assert.equal(R.levelFor(9.99), 9);
    assert.equal(R.levelFor(10), 10);
    assert.equal(R.levelFor(250), 50);
    assert.equal(R.levelFor(1e9), R.MAX_LEVEL);
    const r = R.rank({ wildsZones: 2 });
    assert.equal(r.level, 12, 'stepping into the Wilds (Greenwood open) is worth a start');
    assert.ok(r.frac >= 0 && r.frac < 1 && r.next > r.at);
});

test('either game alone gets to about Renown 50 at a solid point, around 70 at most, and only both reach the top', () => {
    const lv = (s) => R.rank(s).level;
    assert.ok(Math.abs(lv(clickerVet) - 50) <= 3, 'three prestiges: ' + lv(clickerVet));
    assert.ok(Math.abs(lv(wildsZone4) - 50) <= 3, 'four zones into the Wilds: ' + lv(wildsZone4));
    assert.ok(lv(maxClicker) <= 72 && lv(maxClicker) >= 65, 'everything in the game alone: ' + lv(maxClicker));
    assert.ok(lv(maxWilds) <= 72 && lv(maxWilds) >= 65, 'everything in the Wilds alone: ' + lv(maxWilds));
    assert.equal(lv(Object.assign({}, maxClicker, maxWilds)), R.MAX_LEVEL);
    const both = R.rank(Object.assign({}, clickerVet, wildsZone4));
    assert.ok(both.level > lv(clickerVet) + 15, 'playing both counts for a lot more');
    assert.equal(both.clicker + both.wilds, both.total);
});

test('more progress never lowers Renown, every source has a cap, and junk is ignored', () => {
    const fields = Object.keys(Object.assign({}, maxClicker, maxWilds));
    for (const f of fields) {
        let last = -1;
        for (const v of [0, 1, 2, 5, 10, 100, 1e4, 1e9]) {
            const p = R.points({ [f]: v }).total;
            assert.ok(p >= last, f + ' at ' + v);
            last = p;
        }
    }
    for (const part of R.points(Object.assign({}, maxClicker, maxWilds)).parts) assert.equal(part.pts, part.cap, part.id + ' is capped');
    assert.equal(R.points({ prestiges: -5, clicks: 'lots', wildsZones: NaN }).total, 0);
    for (const src of R.SOURCES) assert.ok(src.label && src.hint && ['clicker', 'wilds'].includes(src.game), src.id);
});

test('milestones every 5 levels: rubies and potions in the Wilds, boosts in the game, never gems, Golden or lootboxes', () => {
    assert.equal(R.MILESTONES.length, R.MAX_LEVEL / 5);
    for (const m of R.MILESTONES) {
        assert.equal(m.level % 5, 0);
        assert.deepEqual(Object.keys(m.wilds).filter(k => k !== 'rubies' && k !== 'cons'), [], m.level + ': rubies and potions only');
        assert.ok(m.wilds.rubies > 0);
        for (const id in m.wilds.cons || {}) assert.ok(D.CONSUMABLES_BY_ID[id] && id !== 'arrow', m.level + ' ' + id);
        assert.deepEqual(Object.keys(m.clicker), ['items'], m.level + ': consumables only, in the game');
        assert.ok(Object.keys(m.clicker.items).length, m.level);
        for (const id in m.clicker.items) assert.ok(Bridge.isItem(id) && m.clicker.items[id] >= 1, m.level + ' ' + id);
    }
    assert.deepEqual(R.cleanClaimed([10, '5', 10, 7, 'x', 500]), [5, 10]);
    assert.deepEqual(R.cleanClaimed({ claimed: [15] }), [15]);
    assert.deepEqual(R.claimable(17, [5]).map(m => m.level), [10, 15]);
    assert.equal(R.nextMilestone(17).level, 20);
    assert.equal(R.nextMilestone(100), null);
});

test('in the Wilds: Renown adds rubies from monsters, and its half of a milestone is claimed once', () => {
    const s = W.freshState(NOW);
    const base = W.playerStats(s).rubies;
    W.setClickerView(Crew.clickerView({ renown: 40 }));
    assert.ok(Math.abs(W.playerStats(s).rubies - base - 0.2) < 1e-9, 'Renown 40: +20% rubies');
    assert.deepEqual(W.renownClaimable(s).map(m => m.level), [5, 10, 15, 20, 25, 30, 35, 40]);
    const before = s.rubies;
    const r = W.claimRenown(s, 10);
    assert.ok(r.ok);
    assert.equal(s.rubies, before + 1000);
    assert.equal(s.cons.potion_big, 2);
    assert.equal(W.claimRenown(s, 10).reason, 'claimed');
    assert.equal(W.claimRenown(s, 45).reason, 'level');
    assert.equal(W.claimRenown(s, 12).reason, 'unknown');
    assert.equal(s.outbox.length, 0, 'nothing for the game: it pays its own half');
    const back = W.migrate(JSON.parse(W.serialize(s, NOW, 0)), NOW);
    assert.deepEqual(back.renown.claimed, [10]);
    assert.deepEqual(W.validate(back), []);
});

// ---------------- the game's side ----------------
const worldSave = (fn) => { const s = W.freshState(NOW); fn(s); return W.serialize(s, NOW, 0); };
const farInWilds = worldSave((s) => {
    for (const z of ['mines', 'ember', 'frost']) s.unlocked.zones[z] = true;
    s.bosses.overgrown = { kills: 1, lastKillDay: '', lastKillWeek: '', mythicWeek: '' };
    s.bosses.gilded = { kills: 2, lastKillDay: '', lastKillWeek: '', mythicWeek: '' };
    s.stats.questsDone = 12;
});

test('the game works Renown out from both saves, shows it in its top bar, and it raises CPS and click power', () => {
    const plain = loadGame({ now: NOW });
    const far = loadGame({ now: NOW, storage: { [Bridge.WORLD_KEY]: farInWilds } });
    for (const g of [plain, far]) g.eval('upgrade2Level = 50; upgrade3Level = 30; upgrade5Level = 12; _renownCache.at = 0; updateDisplays();');
    const l0 = plain.eval('getRenownLevel()'), l1 = far.eval('getRenownLevel()');
    assert.ok(l1 > l0 + 10, 'the Wilds count: ' + l0 + ' -> ' + l1);
    assert.equal(far.eval('WHA.snapshot().renownLevel'), l1, 'achievements see the same level');
    const ratio = Number(far.eval('cps')) / Number(plain.eval('cps'));
    assert.ok(Math.abs(ratio - (1 + l1 / 100) / (1 + l0 / 100)) < 1e-9, '+1% CPS per level (' + ratio + ')');
    const cr = Number(far.eval('clickPower')) / Number(plain.eval('clickPower'));
    assert.ok(Math.abs(cr - (1 + l1 / 100) / (1 + l0 / 100)) < 1e-9, '+1% click power per level');
    far.eval('WHRenownPanel.updateChip()');
    assert.equal(far.eval('document.getElementById("renownChipLevel").textContent'), String(l1));
    assert.equal(far.eval('document.getElementById("renownChip").classList.contains("has-claim")'), true, 'a milestone is waiting');
    plain.close(); far.close();
});

test('the game pays its own half of a milestone once, into Items, and notes it where only it writes', () => {
    const g = loadGame({ now: NOW, storage: { [Bridge.WORLD_KEY]: farInWilds } });
    const lv = g.eval('getRenownLevel()');
    assert.ok(lv >= 10, 'level ' + lv);
    const gems = g.eval('getGems()'), golden = Number(g.eval('goldenWhat'));
    assert.equal(g.eval('WHRenownPanel.claim(5)'), true);
    assert.equal(g.eval('WHRenownPanel.claim(5)'), false, 'once');
    const items = JSON.parse(g.storage.getItem('whathappened_items')).items;
    assert.equal(items.energyDrink, 2);
    assert.equal(items.spareBattery, 2);
    assert.deepEqual(JSON.parse(g.storage.getItem(R.CLAIMED_KEY)).claimed, [5]);
    assert.equal(g.eval('WHRenownPanel.claim(' + (Math.floor(lv / 5) * 5 + 5) + ')'), false, 'not reached yet');
    // claim all: every other milestone reached, at once
    const left = R.claimable(lv, [5]).length;
    assert.equal(g.eval('WHRenownPanel.claimAll()'), left);
    assert.deepEqual(JSON.parse(g.storage.getItem(R.CLAIMED_KEY)).claimed, R.MILESTONES.filter(m => m.level <= lv).map(m => m.level));
    assert.equal(g.eval('WHRenownPanel.claimAll()'), 0, 'nothing twice');
    assert.equal(g.eval('getGems()'), gems);
    assert.equal(Number(g.eval('goldenWhat')), golden);
    // the panel opens, lists both halves and the crew
    g.eval('WHRenownPanel.open()');
    const text = g.eval('document.getElementById("rnBody").textContent');
    assert.match(text, /Milestones/);
    assert.match(text, /Claim it in the Wilds/);
    assert.match(text, /Your crew in Wildgate/);
    g.close();
});

test('Renown titles unlock from the shared rank', () => {
    const g = loadGame({ now: NOW, storage: { [Bridge.WORLD_KEY]: farInWilds } });
    g.eval('WHA.checkAll()');
    assert.equal(g.storage.getItem('ach_x_renown10'), '1');
    assert.equal(g.storage.getItem('ach_x_renown100'), null);
    g.close();
});
