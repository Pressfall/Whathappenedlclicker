'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const { loadGame } = require('./helpers/game-harness');
const { midGame } = require('./helpers/scenarios');

const NOW = 1_700_000_000_000;
const fresh = (opts) => loadGame({ now: NOW, ...opts });
// record notify() messages so refusals can be asserted
const spyNotify = (g) => g.eval('window.__notes = []; notify = (m) => { window.__notes.push(String(m)); };');
const notes = (g) => Array.from(g.window.__notes);

test('prestige is refused until CR lurker reaches level 150', () => {
    const g = fresh();
    spyNotify(g);
    g.eval('upgrade12Level = 149; upgrade1Level = 5000');
    const queued = g.pendingTimeouts();
    g.eval('buyPrestige()');
    assert.match(notes(g)[0], /CR lurker reaches level 150/);
    assert.equal(g.pendingTimeouts(), queued, 'no reload was scheduled');
    assert.equal(g.savedState(), null, 'nothing was written');
});

test('prestige is refused when the upgrade levels are worth no Golden', () => {
    const g = fresh();
    spyNotify(g);
    g.eval('upgrade12Level = 150'); // 150 total levels, needs 1500
    g.eval('buyPrestige()');
    assert.match(notes(g)[0], /1500 total upgrade levels/);
    assert.equal(g.savedState(), null);
});

test('Golden awarded = total upgrade levels / 1500, rounded down', () => {
    const g = fresh();
    g.eval('upgrade12Level = 150; upgrade1Level = 1349'); // 1499
    assert.equal(g.eval('getPotentialPrestigeAwards()'), 0);
    g.eval('upgrade1Level = 1350'); // 1500
    assert.equal(g.eval('getPotentialPrestigeAwards()'), 1);
    g.eval('upgrade1Level = 4349'); // 4499
    assert.equal(g.eval('getPotentialPrestigeAwards()'), 2);
    g.eval('upgrade1Level = 4350'); // 4500
    assert.equal(g.eval('getPotentialPrestigeAwards()'), 3);
});

test('Divine Collector raises the Golden earned (+25% per level, before rounding)', () => {
    const g = fresh();
    g.eval('upgrade12Level = 150; upgrade1Level = 2850; divineCollectorLevel = 2'); // 3000 levels, 1500 / 1.5 = 1000 per Golden
    assert.equal(g.eval('getPotentialPrestigeAwards()'), 3);
    assert.equal(g.eval('Math.ceil(getLevelsPerGolden())'), 1000);
});

test('cancelling the confirmation leaves everything alone', () => {
    const g = midGame(fresh({ confirm: false }));
    const before = JSON.stringify(g.savedState());
    const queued = g.pendingTimeouts();
    g.eval('buyPrestige()');
    assert.equal(JSON.stringify(g.savedState()), before);
    assert.equal(g.pendingTimeouts(), queued);
});

test('prestige keeps Golden, Divine upgrades, gems, clan points, shop and settings; clears the run', () => {
    const g = midGame(fresh());
    g.eval('buyPrestige()');
    assert.equal(g.runTimeouts() > 0, true, 'a page reload is scheduled');
    const s = g.savedState();

    // stored for the next page load
    assert.equal(s.prestige, true);
    assert.equal(s.goldenWhat, 3 + 2, 'Golden: 3 + 2 awarded');
    assert.equal(s.prestigeTimes, 2);
    assert.equal(s.totalGoldenEver, 5);
    assert.equal(s.divineUnlocked, true);

    const next = g.reload();
    // kept
    assert.equal(next.eval('goldenWhat'), 5);
    assert.equal(next.eval('prestigeTimes'), 2);
    assert.equal(next.eval('divineArgonLevel'), 2);
    assert.equal(next.eval('divineSomalianLevel'), 1);
    assert.equal(next.eval('divineMoneyManLevel'), 1);
    assert.equal(next.eval('diamonds'), 42);
    assert.equal(next.eval('clanPoints'), 7);
    assert.equal(next.eval('shopWHBWPurchased'), true);
    assert.equal(next.eval('shopDivineWHPurchased'), true);
    assert.equal(next.eval('equippedShopImage'), 'mainimage/FireWH.png');
    assert.equal(next.eval('musicOwned.BassInsanity'), true);
    assert.equal(next.eval('currentMusicTrack'), 'BassInsanity');
    assert.equal(next.eval('musicVolume'), 0.3);
    assert.equal(next.eval('sfxMuted'), true);
    // cleared (apart from Divine Money Man's head start)
    assert.equal(next.eval('count'), 100000);
    assert.equal(next.eval('upgrade1Level'), 0);
    assert.equal(next.eval('upgrade2Level'), 0);
    assert.equal(next.eval('upgrade12Level'), 0);
    assert.equal(next.eval('upgrade1Cost'), 100);
    assert.equal(next.eval('special1Purchased'), false);
    assert.equal(next.eval('special2Purchased'), false);
    assert.equal(next.eval('clickMultiplier'), 1);
});

test('progress stored outside the main save survives a prestige', () => {
    const g = midGame(fresh());
    const keep = ['whathappened_followers', 'whathappened_items', 'ach_firstClick'];
    const before = Object.fromEntries(keep.map((k) => [k, g.storage.getItem(k)]));
    g.eval('buyPrestige()');
    g.runTimeouts();
    const next = g.reload();
    for (const k of keep) assert.equal(next.storage.getItem(k), before[k], k);
    // titles can grow (achievements award them) but never lose what was there
    assert.ok(JSON.parse(next.storage.getItem('unlocked_titles')).some((t) => t.id === 't1'));
});

test('the casino daily spin and win count survive a prestige (they cannot be re-spun)', () => {
    const g = midGame(fresh());
    const save = g.savedState();
    save.casinoSpin = { lastSpinDate: '2023-11-14', buff: { type: 'cpsBoost', mult: 5, expiresAt: NOW + 60000 } };
    save.casino_total_wins = 7;
    g.storage.setItem('whathappened_save', JSON.stringify(save));
    g.eval('buyPrestige()');
    const after = g.savedState();
    assert.deepEqual(after.casinoSpin, save.casinoSpin);
    assert.equal(after.casino_total_wins, 7);
});

test('prestige in a clan queues one Prestige Party credit, and none without a clan', () => {
    const solo = midGame(fresh());
    solo.eval('buyPrestige()');
    assert.equal(solo.storage.getItem('whathappened_prestige_party_pending'), null);

    const clan = midGame(fresh({ storage: { player_clanId: 'clan123', whathappened_prestige_party_pending: '2' } }));
    clan.eval('buyPrestige()');
    assert.equal(clan.storage.getItem('whathappened_prestige_party_pending'), '3');
});

test('prestige resets the per-run counters', () => {
    const g = midGame(fresh({ storage: { whathappened_clicks_since_prestige: '999' } }));
    g.eval('buyPrestige()');
    assert.equal(g.storage.getItem('whathappened_clicks_since_prestige'), '0');
    assert.equal(g.storage.getItem('whathappened_prestige_times'), '2');
    assert.equal(g.storage.getItem('whathappened_total_golden'), '5');
    assert.equal(g.storage.getItem('whathappened_last_prestige_ts'), String(NOW));
});

test('Divine Money Man pays its head start once per prestige, not once per page load', () => {
    const g = midGame(fresh());
    g.eval('divineMoneyManLevel = 2'); // 100K x 10
    g.eval('saveGame()');
    g.eval('buyPrestige()');
    const first = g.reload();
    assert.equal(first.eval('count'), 1_000_000);
    // closing the tab saves without the prestige flag
    first.window.dispatchEvent(new first.window.Event('beforeunload'));
    assert.equal(first.savedState().prestige, undefined);
    const second = first.reload();
    assert.equal(second.eval('count'), 1_000_000, 'the second visit starts from the saved count, with no second bonus');
});

// ----- golden master: the complete state after a prestige and reload, captured before the prestige code was refactored -----
const GOLDEN = path.join(__dirname, 'fixtures', 'post-prestige-state.json');
test('the state after prestige + reload matches the recorded golden master', () => {
    const g = midGame(fresh());
    g.eval('buyPrestige()');
    const next = g.reload();
    next.eval('saveGame()');
    const actual = next.savedState();
    if (process.env.UPDATE_GOLDEN) {
        fs.mkdirSync(path.dirname(GOLDEN), { recursive: true });
        fs.writeFileSync(GOLDEN, JSON.stringify(actual, null, 1) + '\n');
    }
    const expected = JSON.parse(fs.readFileSync(GOLDEN, 'utf8'));
    assert.deepEqual(actual, expected);
});
