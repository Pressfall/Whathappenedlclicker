// Challenges on the real game page (challenges-panel.js + main.js + items.js in jsdom): progress from what the page does,
// rewards landing in the Items save and the gem count, nothing paid twice, and the state surviving a reload.
const test = require('node:test');
const assert = require('node:assert/strict');
const { loadGame } = require('./helpers/game-harness');

const NOW = new Date(2026, 10, 5, 12, 0, 0).getTime();
const KEY = 'whathappened_challenges';

function setIds(game, period, ids) {
    const s = JSON.parse(game.storage.getItem(KEY));
    s[period].ids = ids;
    game.storage.setItem(KEY, JSON.stringify(s));
}
const items = (game) => { const o = JSON.parse(game.storage.getItem('whathappened_items') || '{}'); return { items: o.items || {}, boxes: o.boxes || [] }; };

test('dailies: clicks, levels and minutes played count from the start of the day, and pay boosts plus an Iron Chest', () => {
    const game = loadGame({ now: NOW, noRenown: true });
    game.eval('WHChallengePanel.tick()');
    const s0 = JSON.parse(game.storage.getItem(KEY));
    assert.equal(s0.day.ids.length, 3);
    assert.equal(s0.week.ids.length, 3);
    setIds(game, 'day', ['d_clicks', 'd_levels', 'd_play']);

    // play: 1,600 clicks, 120 upgrade levels, 21 minutes
    game.eval('_ensureClickCountersLoaded(); _memLifetimeClicks += 1600; _memAchClicks += 1600;');
    game.eval('count = 1e60; purchaseBatch = 120; buyUpgrade1();');
    game.storage.setItem('whathappened_playtime_seconds', String(21 * 60));
    game.eval('WHChallengePanel.tick()');
    const st = JSON.parse(game.storage.getItem(KEY));
    assert.ok(st.levels.total >= 120, 'levels bought counted: ' + st.levels.total);

    const before = items(game), gemsBefore = game.eval('getGems()');
    const n = (o, id) => o.items[id] || 0;
    game.eval('WHChallengePanel.claim("all")');
    const it = items(game);
    assert.equal(n(it, 'energyDrink') - n(before, 'energyDrink'), 2 + 1, 'Click: 2 Energy Drinks, Play: 1');
    assert.equal(n(it, 'spareBattery') - n(before, 'spareBattery'), 2 + 1, 'Levels: 2 Spare Batteries, Play: 1');
    assert.equal((it.boxes[1] || 0) - (before.boxes[1] || 0), 1, 'all three: an Iron Chest');
    assert.equal(game.eval('getGems()'), gemsBefore, 'dailies pay no gems');

    // claiming again pays nothing
    game.eval('WHChallengePanel.claim("all")');
    assert.equal(n(items(game), 'energyDrink'), n(it, 'energyDrink'));
    const after = JSON.parse(game.storage.getItem(KEY));
    assert.equal(after.done, 3);
    assert.equal(after.day.bonus, true);
    assert.equal(after.streak.n, 1);

    // the snapshot (achievements) sees the count
    assert.equal(game.eval('WHA.snapshot().challengesDone'), 3);
    game.close();
});

test('weeklies pay the gems (5 for all three) and a Golden Chest; a prestige does not take levels back', () => {
    const game = loadGame({ now: NOW, noRenown: true });
    game.eval('WHChallengePanel.tick()');
    setIds(game, 'week', ['w_clicks', 'w_levels', 'w_play']);
    game.eval('_ensureClickCountersLoaded(); _memLifetimeClicks += 15000; _memAchClicks += 15000;');
    game.eval('count = 1e90; purchaseBatch = 600; buyUpgrade1();');
    game.eval('WHChallengePanel.tick()');
    game.eval('upgrade1Level = 0; WHChallengePanel.tick()'); // the levels go (as in a prestige): nothing is taken back
    game.eval('count = 1e90; purchaseBatch = 450; buyUpgrade1(); WHChallengePanel.tick()');
    game.storage.setItem('whathappened_playtime_seconds', String(181 * 60));
    game.eval('WHChallengePanel.tick()');
    const goldBefore = items(game).boxes[2] || 0, glassBefore = items(game).items.hourglass || 0, gemsBefore = game.eval('getGems()');
    game.eval('WHChallengePanel.claim("all")');
    assert.equal(game.eval('getGems()') - gemsBefore, 5);
    assert.equal((items(game).items.hourglass || 0) - glassBefore, 3);
    assert.equal((items(game).boxes[2] || 0) - goldBefore, 1);

    // a reload keeps it all
    const next = game.reload();
    next.eval('WHChallengePanel.tick()');
    const s = JSON.parse(next.storage.getItem(KEY));
    assert.equal(s.week.bonus, true);
    assert.equal(s.done, 6, 'the three weeklies, and the three dailies the same play finished ("Claim all" takes both)');
    assert.equal(next.eval('getGems()'), gemsBefore + 5);
    next.close();
});

test('a damaged challenges save does not break the page', () => {
    const game = loadGame({ now: NOW, storage: { [KEY]: '{not json' } });
    game.eval('WHChallengePanel.tick()');
    const s = JSON.parse(game.storage.getItem(KEY));
    assert.equal(s.day.ids.length, 3);
    assert.equal(game.eval('typeof WHChallengePanel.open'), 'function');
    game.eval('WHChallengePanel.open()');
    assert.ok(game.window.document.querySelectorAll('#challengePanel .ch-row').length === 6, 'six challenges listed');
    assert.equal(game.window.document.getElementById('challengeChipCount').hidden, true, 'nothing to claim yet');
    game.close();
});
