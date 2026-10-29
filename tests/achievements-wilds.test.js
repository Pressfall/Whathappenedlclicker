// Achievements for The Wilds, and the hidden ones ("Hands Off" for the Auto Clicker, "Open Sesame" for the hidden room)
const test = require('node:test');
const assert = require('node:assert/strict');
const D = require('../core/world-data');
const W = require('../core/world-logic');
const Bridge = require('../core/world-bridge');
const { loadGame } = require('./helpers/game-harness');

const NOW = 1_700_000_000_000;
const worldStorage = (s) => ({ [Bridge.WORLD_KEY]: W.serialize(s, NOW, 0) });
const wilds = (g) => g.window.WHA.ACHIEVEMENTS.filter((a) => a.cat === 'The Wilds');
// (arrays made inside the simulated page are not Node arrays, so copy them before deep-comparing)
const unlockedKeys = (g) => Array.from(g.window.WHA.ACHIEVEMENTS.filter((a) => g.window.WHA.isUnlocked(a)).map((a) => a.key));

test('every Wilds achievement reads a number the snapshot really has, and can be reached', () => {
    const g = loadGame({ now: NOW });
    const snap = g.window.WHA.snapshot();
    for (const a of wilds(g)) {
        assert.ok(a.name && a.desc && a.title && a.badge && a.rarity, a.key);
        assert.ok(a.stat in snap, a.key + ' reads ' + a.stat);
        assert.equal(snap[a.stat], 0, a.key + ' starts locked');
    }
    // targets that count "all of something" match what the Wilds really has
    const target = (key) => g.window.WHA.BY_KEY[key].target;
    assert.equal(target('w_skills_all'), D.ABILITY_ORDER.length + D.PERK_ORDER.length, 'every skill of every class');
    assert.equal(target('w_class5'), D.CLASS_ORDER.length - 1, 'every class besides the Warrior you start as');
    assert.equal(target('w_boss4'), Object.keys(D.BOSSES).length);
    assert.equal(target('w_frost'), D.ZONE_ORDER.length + 1, 'town and every zone');
    assert.equal(target('w_god6'), require('../core/world-gods').HALL_GODS.length);
    g.close();
});

test('they unlock from a real Wilds save, and nothing unlocks from a fresh one', () => {
    const fresh = loadGame({ now: NOW, storage: worldStorage(W.freshState(NOW)) });
    assert.deepEqual(unlockedKeys(fresh).filter((k) => k.startsWith('w_')), ['w_start'], 'only having a save counts');
    fresh.close();

    const s = W.freshState(NOW);
    Object.assign(s.stats, { kills: 1000, elites: 25, rivalsBeaten: 1, mined: 300, chopped: 150, gathered: 50, crafted: 3, bestScore: 92, legendaries: 0,
        boxesCrafted: 1, rubiesEarned: 150000, questsDone: 12, pvpWins: 1, deaths: 10, gemsSent: 10, playSec: 11 * 3600 });
    s.bosses.overgrown = { kills: 2 }; s.bosses.gilded = { kills: 1 };
    s.unlocked.zones = { town: true, greenwood: true, mines: true, ember: true, frost: true };
    s.classes.unlocked = { warrior: true, rogue: true };
    for (const id of D.ABILITY_ORDER.slice(0, 12).concat(D.PERK_ORDER.slice(0, 10))) s.skills.learned[id] = true;
    s.gods = { solarus: 12, vulkar: 1 };
    const g = loadGame({ now: NOW, storage: worldStorage(s) });
    const got = unlockedKeys(g).filter((k) => k.startsWith('w_')).sort();
    assert.deepEqual(got, ['w_boss1', 'w_box1', 'w_class1', 'w_craft1', 'w_death10', 'w_elite25', 'w_frost', 'w_gather500', 'w_gems10', 'w_god1', 'w_god10', 'w_hours10',
        'w_kill1', 'w_kill100', 'w_kill1000', 'w_master', 'w_pvp1', 'w_quest10', 'w_rival1', 'w_rubies100k', 'w_rubies10k', 'w_skills20', 'w_start'].sort());
    // and a second look unlocks nothing new
    assert.equal(g.window.WHA.checkAll().length, 0);
    // the title comes with it
    assert.ok(JSON.parse(g.storage.getItem('unlocked_titles')).some((t) => t.name === 'Elite Hunter' && t.rarity === 'rare'));
    g.close();
});

test('Hands Off is hidden, mythic, and unlocks only when the Auto Clicker is owned', () => {
    const g = loadGame({ now: NOW });
    const a = g.window.WHA.BY_KEY.w_hands_off;
    assert.equal(a.name, 'Hands Off');
    assert.equal(a.hidden, true);
    assert.equal(a.rarity, 'mythic');
    assert.equal(g.window.WHA.isUnlocked(a), false);
    g.eval('checkDataAchievements(true)');
    assert.equal(g.window.WHA.isUnlocked(a), false, 'not without the Auto Clicker');
    g.eval('WHI.grantSpecial("autoClicker")');
    assert.equal(g.window.WHA.snapshot().autoClicker, 1);
    g.eval('checkDataAchievements(true)');
    assert.equal(g.window.WHA.isUnlocked(a), true);
    assert.ok(JSON.parse(g.storage.getItem('unlocked_titles')).some((t) => t.name === a.title && t.rarity === 'mythic'));
    g.close();
});

test('Open Sesame is hidden too, and comes from opening the hidden room', () => {
    const s = W.freshState(NOW);
    const closed = loadGame({ now: NOW, storage: worldStorage(s) });
    assert.equal(closed.window.WHA.BY_KEY.w_door.hidden, true);
    assert.ok(!unlockedKeys(closed).includes('w_door'));
    closed.close();
    s.secrets.hallDoor = true;
    const open = loadGame({ now: NOW, storage: worldStorage(s) });
    assert.ok(unlockedKeys(open).includes('w_door'));
    open.close();
});

test('only those two are hidden, and the secret word is nowhere in them', () => {
    const g = loadGame({ now: NOW });
    const hidden = g.window.WHA.ACHIEVEMENTS.filter((a) => a.hidden);
    assert.deepEqual(Array.from(hidden.map((a) => a.key)).sort(), ['w_door', 'w_hands_off']);
    for (const a of hidden) assert.ok(!/briley/i.test(JSON.stringify(a)), a.key);
    g.close();
});
