'use strict';
// The first-run guide card on the real game page (guide.js + core/guide.js + specials.js).
const test = require('node:test');
const assert = require('node:assert/strict');
const { loadGame } = require('./helpers/game-harness');

const NOW = 1_700_000_000_000;
const el = (g, id) => g.window.document.getElementById(id);
const visible = (g) => !el(g, 'guideCard').hidden;
const steps = (g) => Array.from(el(g, 'guideSteps').children);
const refresh = (g) => { g.window.WHGuideUI.update(); return g; };
const game = (opts) => loadGame({ now: NOW, ...opts });

test('a new player sees a five-step checklist with the first step highlighted', () => {
    const g = refresh(game());
    assert.equal(visible(g), true);
    assert.equal(steps(g).length, 5);
    assert.match(steps(g)[0].textContent, /Click the image/);
    assert.equal(steps(g)[0].classList.contains('is-current'), true);
    assert.equal(steps(g).filter((li) => li.classList.contains('is-done')).length, 0);
});

test('the banner shows just the current step and the progress, with the full list on request', () => {
    const g = refresh(game());
    assert.match(el(g, 'guideCurrent').textContent, /^Step 1: Click the image to earn What Happeneds\.$/);
    assert.equal(el(g, 'guideProgress').textContent, '0/5');
    assert.equal(el(g, 'guideSteps').hidden, true, 'the checklist starts collapsed');
    const toggle = el(g, 'guideToggle');
    assert.equal(toggle.getAttribute('aria-expanded'), 'false');
    toggle.click();
    assert.equal(el(g, 'guideSteps').hidden, false);
    assert.equal(toggle.getAttribute('aria-expanded'), 'true');
    assert.equal(toggle.textContent, 'Hide steps');
    toggle.click();
    assert.equal(el(g, 'guideSteps').hidden, true);
    assert.equal(toggle.textContent, 'All steps');
});

test('the current step and the count move on as the player buys things', () => {
    const g = game();
    g.eval('count = 1000; buyUpgrade1(); updateDisplays()');
    refresh(g);
    assert.match(el(g, 'guideCurrent').textContent, /^Step 3: Buy a Somalian Pirate/);
    assert.equal(el(g, 'guideProgress').textContent, '2/5');
});

test('with nothing bought it points at the first upgrade to buy', () => {
    const g = refresh(game());
    assert.match(el(g, 'guideUpgrade').textContent, /Next new upgrade: OP mouse, 100 What Happeneds/);
    assert.equal(el(g, 'guideNext').hidden, true, 'no special to chase yet');
});

test('steps tick off and the highlight moves on as the player buys things', () => {
    const g = game();
    g.eval('count = 1000; setBulkPurchase(1); buyUpgrade1(); updateDisplays()');
    refresh(g);
    assert.equal(steps(g)[0].classList.contains('is-done'), true);
    assert.equal(steps(g)[1].classList.contains('is-done'), true);
    assert.equal(steps(g)[2].classList.contains('is-current'), true);
    g.eval('buyUpgrade2(); updateDisplays()');
    refresh(g);
    assert.equal(steps(g)[2].classList.contains('is-done'), true);
    assert.equal(steps(g)[3].classList.contains('is-current'), true);
});

test('it names the next special to unlock and how many levels away it is', () => {
    const g = game();
    g.eval('count = 1e6; upgrade1Level = 3; upgrade2Level = 1');
    refresh(g);
    assert.match(el(g, 'guideNext').textContent, /Next unlock: Mousepad of Destiny\. Raise OP mouse to level 10 \(7 more levels\)\./);
    g.eval('upgrade1Level = 9');
    refresh(g);
    assert.match(el(g, 'guideNext').textContent, /\(1 more level\)\./);
});

test('it says when you can already afford the next new upgrade', () => {
    const g = game();
    g.eval('count = 1e6; upgrade1Level = 1');
    refresh(g);
    assert.match(el(g, 'guideUpgrade').textContent, /Somalian Pirate, 500 What Happeneds \(you can afford it now\)/);
    g.eval('count = 20');
    refresh(g);
    assert.doesNotMatch(el(g, 'guideUpgrade').textContent, /afford/);
});

test('after the checklist is done the card shrinks to the next-unlock line', () => {
    const g = game();
    g.eval('count = 1e12; upgrade1Level = 12; upgrade2Level = 3; upgrade3Level = 2; special1Purchased = true');
    refresh(g);
    assert.equal(visible(g), true);
    assert.equal(el(g, 'guideCard').classList.contains('is-compact'), true);
    assert.match(el(g, 'guideNext').textContent, /Next unlock:/);
    assert.equal(el(g, 'guideCurrent').hidden, true, 'no step left to show');
    assert.equal(el(g, 'guideToggle').hidden, true);
    assert.equal(el(g, 'guideSteps').hidden, true);
});

test('closing the guide hides it, and it stays hidden after a reload', () => {
    const g = refresh(game());
    el(g, 'guideClose').click();
    assert.equal(visible(g), false);
    assert.equal(g.storage.getItem('whathappened_guide'), 'dismissed');
    assert.equal(visible(refresh(g.reload())), false);
});

test('Settings can bring a closed guide back', () => {
    const g = refresh(game());
    el(g, 'guideClose').click();
    el(g, 'guideShowBtn').click();
    assert.equal(visible(g), true);
    assert.equal(g.storage.getItem('whathappened_guide'), 'pinned');
});

test('a veteran who loads a save on a new device never sees the first-run guide', () => {
    for (const veteran of [
        { version: 3, count: 5e9, goldenWhat: 3, prestigeTimes: 1 },
        { version: 3, count: 5e9, upgrade1Level: 900, upgrade2Level: 700 },
    ]) {
        const g = refresh(game({ storage: { whathappened_save: JSON.stringify(veteran) } }));
        assert.equal(visible(g), false);
    }
});

test('a pinned guide shows even for a veteran', () => {
    const g = refresh(game({ storage: { whathappened_save: JSON.stringify({ version: 3, goldenWhat: 3, prestigeTimes: 2 }), whathappened_guide: 'pinned' } }));
    assert.equal(visible(g), true);
});

test('Reset progress brings the guide back for the fresh start', () => {
    const g = game({ storage: { whathappened_guide: 'dismissed' } });
    g.eval('resetGame()');
    assert.equal(g.storage.getItem('whathappened_guide'), null);
    assert.equal(g.storage.getItem('whathappened_save'), null);
});

test('the guide draws nothing it was not given: names come from the game, text from textContent', () => {
    const g = refresh(game());
    assert.equal(el(g, 'guideCard').querySelectorAll('script, img, a').length, 0);
});
