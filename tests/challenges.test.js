// Daily and weekly challenges (core/challenges.js): picks, progress from lifetime counters, the levels counter, claims and
// their rewards, rerolls, streaks and a damaged save.
const test = require('node:test');
const assert = require('node:assert/strict');
const C = require('../core/challenges');
const Bridge = require('../core/world-bridge');

const NOW = new Date(2026, 10, 5, 12, 0, 0).getTime(); // Thursday 5 November 2026, local noon
const DAY = 86400000;
const snapOf = (o) => Object.assign({ clicks: 0, upgradeTotal: 0, boxesOpened: 0, playHours: 0, casinoRounds: 0, followers: 0, followersBred: 0,
    prestiges: 0, wildsStarted: 0, wildsKills: 0, wildsQuests: 0, wildsArenaWins: 0 }, o);
const everyone = snapOf({ prestiges: 3, followers: 5, followersBred: 2, wildsStarted: 1, wildsArenaWins: 4 });

function started(snap, now = NOW) { const s = C.fresh(); C.observe(s, snap, now); return s; }
// finish every challenge of a period by moving its counters past the targets
function finished(snap, state, period) {
    const out = Object.assign({}, snap);
    for (const id of state[period].ids) {
        const c = C.BY_ID[id];
        if (c.stat === 'levels') state.levels.total += c.target;
        else if (c.stat === 'minutes') out.playHours = (out.playHours || 0) + c.target / 60 + 0.01;
        else out[c.stat] = (out[c.stat] || 0) + c.target;
    }
    return out;
}

test('the pool: three of each period for everyone, real rewards, and texts with their targets', () => {
    for (const period of ['day', 'week']) {
        assert.ok(C.POOL.filter((c) => c.period === period && !c.eligible).length >= C.PER + 1, period + ': a new player has a reroll left too');
    }
    for (const c of C.POOL) {
        assert.ok(C.STATS.includes(c.stat), c.id);
        assert.ok(c.target > 0 && /\S/.test(c.text), c.id);
        assert.ok(!/\{n\}/.test(c.text) || c.target > 1, c.id);
        const r = C.rewardOf(c);
        for (const id in r.items || {}) assert.ok(Bridge.isItem(id), c.id + ': ' + id + ' is a boost the game accepts');
        if (c.period === 'day') assert.ok(!r.gems, c.id + ': dailies never pay gems');
    }
});

test('picks: the same three for the same day, new ones on another day, and only what the player can do', () => {
    const fresh = snapOf({});
    assert.deepEqual(C.pick('day', '2026-11-05', everyone), C.pick('day', '2026-11-05', everyone));
    const days = new Set(Array.from({ length: 10 }, (_, i) => C.pick('day', C.dayKey(NOW + i * DAY), everyone).join()));
    assert.ok(days.size >= 5, 'the dailies change from day to day');
    for (let i = 0; i < 30; i++) {
        for (const period of ['day', 'week']) {
            const key = C.keyFor(period, NOW + i * DAY);
            const ids = C.pick(period, key, fresh);
            assert.equal(ids.length, C.PER);
            for (const id of ids) assert.ok(!C.BY_ID[id].eligible, id + ' is offered to a brand-new player');
        }
    }
});

test('days and weeks: local midnight, and the same weeks as the Wilds\' weekly limits', () => {
    assert.equal(C.dayKey(NOW), '2026-11-05');
    assert.equal(C.weekKey(NOW), Bridge.weekKey(NOW));
    assert.equal(C.endsAt('day', NOW), new Date(2026, 10, 6).getTime());
    assert.equal(C.endsAt('week', NOW), new Date(2026, 10, 9).getTime(), 'Monday');
    assert.equal(C.prevDay('2026-03-01'), '2026-02-28');
    assert.equal(C.prevDay('2026-01-01'), '2025-12-31');
});

test('progress: what was done since the period began, stopping at the target', () => {
    const snap = snapOf({ clicks: 5000, playHours: 2 });
    const s = started(snap);
    s.day.ids = ['d_clicks', 'd_play', 'd_boxes'];
    let v = C.list(s, 'day', snapOf({ clicks: 5600, playHours: 2.25, boxesOpened: 0 }));
    assert.deepEqual(v.map((x) => [x.progress, x.done]), [[600, false], [15, false], [0, false]]);
    v = C.list(s, 'day', snapOf({ clicks: 99999, playHours: 3, boxesOpened: 5 }));
    assert.deepEqual(v.map((x) => [x.progress, x.done]), [[1500, true], [20, true], [2, true]], 'a big jump finishes it, no more');
    assert.match(v[0].text, /1,500/);
});

test('levels bought: every rise counts, a prestige\'s drop does not undo anything', () => {
    const s = started(snapOf({ upgradeTotal: 400 }));
    s.day.ids = ['d_levels', 'd_clicks', 'd_play'];
    C.observe(s, snapOf({ upgradeTotal: 460 }), NOW + 1000);
    C.observe(s, snapOf({ upgradeTotal: 0 }), NOW + 2000);   // prestige
    C.observe(s, snapOf({ upgradeTotal: 50 }), NOW + 3000);
    assert.equal(s.levels.total, 110);
    assert.equal(C.list(s, 'day', snapOf({}))[0].progress, 100, 'capped at the target');
    assert.equal(C.list(s, 'day', snapOf({}))[0].done, true);
});

test('claims: each once, never unfinished, and the third pays the bonus; weeklies pay the gems', () => {
    const snap = snapOf({ wildsStarted: 0 });
    const s = started(snap);
    const ids = s.day.ids.slice();
    assert.equal(C.claim(s, ids[0], snap, NOW).reason, 'unfinished');
    const done = finished(snap, s, 'day');
    assert.equal(C.claimable(s, done), 3);
    const a = C.claim(s, ids[0], done, NOW);
    assert.equal(a.ok, true);
    assert.ok(!a.reward.gems && !a.bonus);
    assert.equal(C.claim(s, ids[0], done, NOW).reason, 'claimed');
    C.claim(s, ids[1], done, NOW);
    const last = C.claim(s, ids[2], done, NOW);
    assert.equal(last.bonus, true);
    assert.equal(last.reward.boxes[C.BOX.iron], 1, 'all three dailies: an Iron Chest');
    assert.equal(last.streak, 1);
    assert.equal(s.done, 3);
    assert.equal(C.claim(s, 'nope', done, NOW).reason, 'unknown');
    assert.equal(C.claim(s, ids[0], done, NOW + DAY).reason, 'gone', 'yesterday\'s are gone once the day turns');

    // the week: 1 gem each, 2 more and a Golden Chest for all three; 5 gems in all
    const wdone = finished(snap, s, 'week');
    let gems = 0, gold = 0;
    for (const id of s.week.ids) { const r = C.claim(s, id, wdone, NOW); gems += r.reward.gems || 0; gold += (r.reward.boxes || {})[C.BOX.gold] || 0; }
    assert.equal(gems, 5);
    assert.equal(gold, 1);
});

test('a new day starts new dailies from where the counters are; the week carries on', () => {
    const s = started(snapOf({ clicks: 100 }));
    const week = s.week.key, wk = s.week.ids.slice();
    assert.equal(C.observe(s, snapOf({ clicks: 900 }), NOW + 1000), false, 'nothing changed in the same day');
    assert.equal(C.observe(s, snapOf({ clicks: 900 }), NOW + DAY), true);
    assert.equal(s.day.key, '2026-11-06');
    assert.equal(s.day.base.clicks, 900);
    assert.equal(s.week.key, week);
    assert.deepEqual(s.week.ids, wk);
    assert.equal(s.week.base.clicks, 100, 'the week still counts from its own start');
});

test('streak: a Golden Chest on every 7th day in a row; a missed day starts again', () => {
    const s = C.fresh();
    let snap = snapOf({});
    let lastStreak = 0, chests = 0;
    const playDay = (t) => {
        C.observe(s, snap, t);
        snap = finished(snap, s, 'day');
        for (const id of s.day.ids) { const r = C.claim(s, id, snap, t); if (r.bonus) { lastStreak = r.streak; chests += (r.reward.boxes || {})[C.BOX.gold] || 0; } }
    };
    for (let d = 0; d < 7; d++) playDay(NOW + d * DAY);
    assert.equal(lastStreak, 7);
    assert.equal(chests, 1);
    assert.equal(C.streakState(s, NOW + 7 * DAY).n, 7, 'still alive the next morning');
    assert.equal(C.streakState(s, NOW + 8 * DAY).n, 0, 'a day missed');
    playDay(NOW + 9 * DAY);
    assert.equal(lastStreak, 1);
});

test('reroll: once a day, never a claimed one, and the new one is not already on the list', () => {
    const snap = snapOf({});
    const s = started(snap);
    const [first] = s.day.ids;
    const r = C.reroll(s, first, snap, NOW);
    assert.equal(r.ok, true);
    assert.ok(!s.day.ids.includes(first) && s.day.ids.includes(r.id));
    assert.equal(new Set(s.day.ids).size, C.PER);
    assert.equal(C.reroll(s, s.day.ids[1], snap, NOW).reason, 'used');
    const t = started(snap, NOW + DAY);
    const done = finished(snap, t, 'day');
    C.claim(t, t.day.ids[0], done, NOW + DAY);
    assert.equal(C.reroll(t, t.day.ids[0], done, NOW + DAY).reason, 'claimed');
});

test('How to play describes the challenges with the real numbers', () => {
    const html = require('fs').readFileSync(require('path').join(__dirname, '..', 'how-to-play.html'), 'utf8');
    const li = (html.match(/<li><b>Challenges<\/b>[\s\S]*?<\/li>/) || [''])[0];
    assert.ok(li, 'a Challenges entry');
    const weekGems = C.PER * C.WEEKLY_PAY.gems + C.BONUS.week.gems;
    assert.match(li, new RegExp('up to ' + weekGems + ' gems a week'));
    assert.match(li, new RegExp('Every ' + C.STREAK_EVERY + 'th day in a row'));
    assert.match(li, new RegExp('Each weekly pays ' + C.WEEKLY_PAY.gems + ' gem'));
    assert.match(li, /Iron Chest/);
});

test('a damaged or forged save is cleaned', () => {
    assert.deepEqual(C.clean(null), C.fresh());
    assert.deepEqual(C.clean('x'), C.fresh());
    const s = C.clean({ day: { key: '2026-11-05', ids: ['d_clicks', 'w_clicks', 'nope', 'd_clicks', 'd_play', 'd_boxes', 'd_casino'], base: { clicks: 'x', levels: 5 }, claimed: { d_clicks: true, d_zzz: true, d_play: 'yes' }, bonus: 1 },
        week: 'broken', levels: { total: -5, last: 'q' }, streak: { n: 1e12, last: 7 }, done: -3 });
    assert.deepEqual(s.day.ids, ['d_clicks', 'd_play', 'd_boxes'], 'only real dailies, no repeats, three at most');
    assert.equal(s.day.base.clicks, 0);
    assert.equal(s.day.base.levels, 5);
    assert.deepEqual(s.day.claimed, { d_clicks: true });
    assert.equal(s.day.bonus, false);
    assert.equal(s.week, null);
    assert.deepEqual(s.levels, { total: 0, last: -1 });
    assert.deepEqual(s.streak, { n: 1e6, last: '' });
    assert.equal(s.done, 0);
    // a cleaned save keeps working
    C.observe(s, snapOf({}), NOW);
    assert.equal(s.week.ids.length, C.PER);
});
