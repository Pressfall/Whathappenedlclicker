'use strict';
// Beans ☕: the pure rules (core/premium.js, core/premium-config.js, core/kofi.js) and the lines they must never cross:
// cosmetics only, never anything random, never the casino, never a paywall on what is free, and no browser write that adds
// bought Beans (the spend rule in firestore-premium.rules, written out as checkWalletSpend).
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const { webcrypto, createHash } = require('node:crypto');

const ROOT = path.resolve(__dirname, '..');
const read = (f) => fs.readFileSync(path.join(ROOT, f), 'utf8');
const P = require('../core/premium.js');
const Config = require('../core/premium-config.js');
const Kofi = require('../core/kofi.js');
const Progress = require('../core/progress.js');
const Arena = require('../core/world-arena.js');
const D = require('../core/world-data.js');
const Bridge = require('../core/world-bridge.js');

const NOW = Date.UTC(2026, 10, 9, 12);
const DAY = 86400000;

// ---------------- what Beans buy ----------------
test('the shop sells looks only: titles, themes, click numbers, trails; nothing that gives a currency, a box or a pack', () => {
    assert.deepEqual(P.KINDS, ['title', 'theme', 'pop', 'trail']);
    const ids = new Set();
    for (const it of P.CATALOG) {
        assert.ok(P.KINDS.includes(it.kind), it.id + ' kind');
        assert.ok(Number.isInteger(it.cost) && it.cost > 0, it.id + ' cost');
        assert.ok(!ids.has(it.id), 'unique id ' + it.id); ids.add(it.id);
        const allowed = ['id', 'kind', 'name', 'cost', 'rarity', 'desc', 'swatch', 'colors', 'rise'];
        for (const k of Object.keys(it)) assert.ok(allowed.includes(k), it.id + ' has only look fields, not "' + k + '"');
    }
});

test('Beans can\'t be used in the casino, and no other game code reads what Beans bought (nothing free gets locked behind them)', () => {
    for (const f of ['gamba.js', 'gamba.html']) assert.ok(!/WHBeans|WHPremium|whathappened_premium|premium\.js|Beans/i.test(read(f)), f + ' knows nothing of Beans');
    // only these files touch the Beans state or API; main.js only colours the bought titles, the Wilds only draw the trail and
    // ask for an earnings check after a Glory purchase
    const allowed = new Set(['premium.js', 'premium-panel.js', 'premium-cloud.js', 'world-actors.js', 'world-arena.js', 'main.js']);
    for (const f of fs.readdirSync(ROOT).filter((x) => /\.(js|html)$/.test(x))) {
        const src = read(f);
        if (/WHBeans|WHPremium\b|whathappened_premium/.test(src) && !allowed.has(f) && !/^(index|world)\.html$/.test(f)) assert.fail(f + ' uses Beans');
    }
    assert.match(read('world-actors.js'), /window\.WHBeans\.drawTrail\(ctx, p\)/);
    const mainUse = read('main.js').split('\n').filter((l) => /WHPremium|WHBeans/.test(l));
    assert.equal(mainUse.length, 1, 'main.js: one line, the title colours');
    assert.match(mainUse[0], /TITLE_RARITIES\[c\.name\] = c\.rarity/);
});

test('bought titles don\'t reuse a name the game already gives for free', () => {
    global.window = {}; global.localStorage = { getItem: () => null, setItem() {}, removeItem() {} };
    delete require.cache[require.resolve('../achievements-data.js')];
    require('../achievements-data.js');
    const free = new Set(global.window.WHA.ACHIEVEMENTS.map((a) => a.title).filter(Boolean));
    for (const it of Arena.SHOP) if (it.title) free.add(it.title);
    for (const m of read('main.js').matchAll(/^\s*'([^']+)': '(common|uncommon|rare|epic|legendary|mythic)'/gm)) free.add(m[1]);
    for (const it of P.CATALOG.filter((c) => c.kind === 'title')) assert.ok(!free.has(it.name), it.name + ' is not a free title');
    delete global.window; delete global.localStorage;
});

// ---------------- how Beans are earned ----------------
const ach = (key, rarity) => ({ key, rarity, name: key });
function view(over) {
    return Object.assign({ achievements: [], world: null, challenges: null, bossNames: { tidal: 'Tidal Wyrm' } }, over);
}

test('sources: achievements by rarity, first boss wins, the week\'s challenge bonus, every 7th day, Arena seasons, Glory', () => {
    const wk = Bridge.weekKey(NOW);
    const list = P.sources(view({
        achievements: [ach('a1', 'common'), ach('a2', 'uncommon'), ach('a3', 'rare'), ach('a4', 'epic'), ach('a5', 'legendary'), ach('a6', 'mythic')],
        world: { bosses: { tidal: { kills: 2, lastKillDay: '2026-11-08' }, overgrown: { kills: 0 }, frozen: 3 }, arena: { seasonLast: { id: '2026-10', rank: 'gold', games: 7, claimed: true }, bought: { week: wk, n: { beans: 1 } } } },
        challenges: { week: { key: wk, bonus: true }, streak: { n: 14, last: '2026-11-09' } },
    }), NOW);
    const by = Object.fromEntries(list.map((x) => [x.id, x.n]));
    assert.deepEqual(by, {
        'ach:a2': 1, 'ach:a3': 1, 'ach:a4': 2, 'ach:a5': 4, 'ach:a6': 8,
        'boss:tidal': P.EARN.boss, ['season:2026-10']: P.EARN.season.gold, ['glory:' + wk + ':1']: P.EARN.glory,
        ['wk:' + wk]: P.EARN.weekly, 'streak:2026-11-09': P.EARN.streak,
    });
    // what does not count: a season not claimed or with too few games, a streak that isn't a multiple of 7, old periods
    const none = P.sources(view({
        world: { bosses: {}, arena: { seasonLast: { id: '2026-10', rank: 'gold', games: 4, claimed: true }, bought: { week: '2025-W01', n: { beans: 1 } } } },
        challenges: { week: { key: '2025-W40', bonus: true }, streak: { n: 13, last: '2026-11-09' } },
    }), NOW);
    assert.deepEqual(none, []);
    assert.deepEqual(P.sources(view({ world: { arena: { seasonLast: { id: '2026-10', rank: 'gold', games: 9, claimed: false } } } }), NOW), []);
});

test('sources read the real Wilds save: a boss beaten through bossLoot, saved and read back, counts', () => {
    const W = require('../core/world-logic.js');
    const s = W.freshState(NOW);
    assert.deepEqual(P.sources(view({ world: JSON.parse(W.serialize(s, NOW, 0)) }), NOW), []);
    W.bossLoot(s, 'overgrown', () => 0.5, NOW, 0);
    const list = P.sources(view({ world: JSON.parse(W.serialize(s, NOW, 0)), bossNames: { overgrown: D.BOSSES.overgrown.name } }), NOW);
    assert.deepEqual(list.map((x) => [x.id, x.n]), [['boss:overgrown', P.EARN.boss]]);
    assert.match(list[0].why, new RegExp(D.BOSSES.overgrown.name));
});

test('the first check pays what was already done once, capped; after that each reward is paid exactly once', () => {
    const s = P.fresh();
    const lots = Array.from({ length: 30 }, (_, i) => ach('x' + i, 'legendary'));
    const first = P.applyEarnings(s, P.sources(view({ achievements: lots }), NOW), NOW);
    assert.equal(first.retro, true);
    assert.equal(first.paid, P.EARN.retroCap);
    assert.equal(s.earned, P.EARN.retroCap);
    assert.equal(Object.keys(s.grants).length, 31); // 30 achievements noted + the thank-you
    // nothing new: nothing paid
    assert.equal(P.applyEarnings(s, P.sources(view({ achievements: lots }), NOW), NOW).paid, 0);
    // a new epic and the weekly bonus: paid once each
    const wk = Bridge.weekKey(NOW);
    const more = view({ achievements: lots.concat(ach('new', 'epic')), challenges: { week: { key: wk, bonus: true } } });
    assert.equal(P.applyEarnings(s, P.sources(more, NOW), NOW).paid, 2 + P.EARN.weekly);
    assert.equal(P.applyEarnings(s, P.sources(more, NOW), NOW).paid, 0);
    assert.equal(s.earned, P.EARN.retroCap + 2 + P.EARN.weekly);
    assert.equal(s.earnedTotal, s.earned);
    assert.equal(s.log.length, 3);
});

test('old week, day and season grant ids are dropped only once they can no longer be earned again', () => {
    const s = P.fresh();
    s.started = 1;
    const wk = Bridge.weekKey(NOW);
    const v = view({ challenges: { week: { key: wk, bonus: true }, streak: { n: 7, last: '2026-11-09' } } });
    P.applyEarnings(s, P.sources(v, NOW), NOW);
    assert.ok(('wk:' + wk) in s.grants);
    const later = NOW + (P.PRUNE_DAYS + 10) * DAY;
    // the same (stale) challenge state seen much later: not paid again, and the old ids are pruned
    assert.equal(P.applyEarnings(s, P.sources(v, later), later).paid, 0);
    assert.ok(!(('wk:' + wk) in s.grants));
    assert.ok(P.DERIVE_DAYS < P.PRUNE_DAYS);
    assert.equal(P.periodStart('2026-W01'), Date.UTC(2025, 11, 29)); // ISO week 1 of 2026 starts Monday 29 Dec 2025
    assert.equal(P.periodStart(Bridge.weekKey(NOW)) <= NOW, true);
});

test('earning stays small: the most a player can earn in a month from repeating rewards', () => {
    const month = 5 * P.EARN.weekly + 5 * P.EARN.streak + 5 * P.EARN.glory + P.EARN.season.champion;
    assert.ok(month <= 80, 'at most 80 a month, got ' + month);
    const cheapest = Math.min(...P.CATALOG.map((c) => c.cost));
    assert.ok(cheapest >= 2 * (P.EARN.weekly + P.EARN.glory), 'even the cheapest item takes more than one week of everything');
    // the Glory item and EARN agree, and it is limited to once a week
    const g = Arena.SHOP_BY_ID.beans;
    assert.equal(g.beans, P.EARN.glory);
    assert.equal(g.perWeek, 1);
    assert.equal(g.glory, 1500);
    assert.deepEqual(Object.keys(P.EARN.season), Arena.RANKS.map((r) => r.id));
    assert.equal(Arena.SEASON.minGames, 5);
});

// ---------------- spending ----------------
test('a purchase takes earned Beans first, then bought ones', () => {
    assert.deepEqual(P.planSpend(500, 0, 350), { ok: true, fromEarned: 350, fromPaid: 0, short: 0 });
    assert.deepEqual(P.planSpend(100, 1000, 350), { ok: true, fromEarned: 100, fromPaid: 250, short: 0 });
    assert.deepEqual(P.planSpend(100, 200, 350), { ok: false, fromEarned: 100, fromPaid: 250, short: 50 });
});

test('buying, wearing, and getting a purchase back from the account', () => {
    const s = P.fresh();
    s.earned = 400;
    assert.equal(P.completePurchase(s, 'th_mocha', 350, NOW), true);
    assert.equal(s.earned, 50);
    assert.equal(s.equip.theme, 'th_mocha');
    assert.equal(P.canBuy(s, 'th_mocha').reason, 'owned');
    assert.equal(P.completePurchase(s, 'th_mocha', 0, NOW), false, 'not twice');
    assert.equal(P.completePurchase(s, 'pop_neon', 200, NOW), false, 'not with Beans it doesn\'t have');
    assert.equal(P.canBuy(s, 'nope').reason, 'unknown');
    P.equip(s, 'th_mocha');
    assert.equal(s.equip.theme, '', 'equip again takes it off');
    assert.equal(P.equip(s, 'pop_neon'), false, 'not owned');
    const back = P.restoreFromSpends(s, [{ id: 'spend0001', item: 'pop_neon' }, { id: 'spend0002', item: 'th_mocha' }, { id: 'spend0003', item: 'gone' }]);
    assert.deepEqual(back.map((x) => x.id), ['pop_neon']);
    assert.deepEqual(P.restoreFromSpends(s, [{ id: 'spend0001', item: 'pop_neon' }]), [], 'each spend once');
});

test('a stored state is cleaned: unknown items, looks not owned and nonsense numbers are dropped', () => {
    const s = P.clean({ earned: -5, earnedTotal: 'x', owned: { th_mocha: true, gems_100: true, pop_neon: 'yes' }, equip: { theme: 'th_mocha', pop: 'pop_neon', trail: 'th_mocha' },
        grants: { 'ach:a': 2, evil: 5, 'wk:2026-W46': 4 }, log: [{ t: 1, n: 5, why: 'ok' }, { n: 'x' }], applied: ['spend0001', 'bad id!'], paid: { uid: 'u', balance: 9 } });
    assert.equal(s.earned, 0);
    assert.deepEqual(s.owned, { th_mocha: true });
    assert.deepEqual(s.equip, { theme: 'th_mocha', pop: '', trail: '' });
    assert.deepEqual(s.grants, { 'ach:a': 2, 'wk:2026-W46': 4 });
    assert.equal(s.log.length, 1);
    assert.deepEqual(s.applied, ['spend0001']);
    assert.deepEqual(P.clean('garbage'), P.fresh());
});

// ---------------- the spend rule (firestore-premium.rules) ----------------
test('the account\'s balance can only go down, by exactly the logged spend; nothing a browser writes can add Beans', () => {
    const before = { balance: 500, total: 500, updatedAt: 't' };
    const ok = (after, spend, id, existed) => P.checkWalletSpend(before, after, spend, id || 'spend0001', !!existed);
    const spend = (cost, extra) => Object.assign({ item: 'th_mocha', cost, at: 'request.time' }, extra);
    assert.equal(ok({ balance: 150, total: 500, updatedAt: 't', spent: 350, lastSpend: 'spend0001' }, spend(350)), true);
    assert.equal(ok({ balance: 900, total: 500, updatedAt: 't', spent: -400, lastSpend: 'spend0001' }, spend(-400)), false, 'no raising the balance');
    assert.equal(ok({ balance: 500, total: 900, updatedAt: 't', spent: 0, lastSpend: 'spend0001' }, spend(1)), false, 'no touching total');
    assert.equal(ok({ balance: 150, total: 500, updatedAt: 't', spent: 350, lastSpend: 'spend0001' }, spend(100)), false, 'the log must match');
    assert.equal(ok({ balance: 150, total: 500, updatedAt: 't', spent: 350, lastSpend: 'spend0001' }, spend(350), 'spend0001', true), false, 'a spend id once');
    assert.equal(ok({ balance: -10, total: 500, updatedAt: 't', spent: 510, lastSpend: 'spend0001' }, spend(510)), false, 'never below zero');
    assert.equal(ok({ balance: 150, total: 500, updatedAt: 't', spent: 0, lastSpend: 'spend0001' }, spend(350)), false, 'spent counts up with it');
    assert.equal(ok({ balance: 150, total: 500, updatedAt: 't', spent: 350, lastSpend: 'spend0001' }, spend(350, { gift: 1 })), false, 'only item, cost, at');
    // the rules file says the same things
    const rules = read('firestore-premium.rules');
    for (const must of ["hasOnly(['balance', 'spent', 'lastSpend'])", 'request.resource.data.balance < resource.data.balance', "keys().hasOnly(['item', 'cost', 'at'])",
        'match /kofi_payments/{txid}', 'allow read, write: if false', "allow create, update, delete: if false", "hashing.sha256('kofi-link:' + uid)", "code + '[0-9A-F]{52}'"])
        assert.ok(rules.includes(must), 'rules: ' + must);
    assert.ok(!/allow (create|write)[^;]*wallets/.test(rules));
});

// ---------------- config and link codes ----------------
test('the shipped config is all placeholders, so buying is off until the owner fills it in', () => {
    assert.equal(Config.buyingOpen(), false);
    assert.deepEqual(Config.activePacks(), []);
    assert.ok(Config.isPlaceholder(Config.kofiPage) && Config.isPlaceholder(Config.workerUrl));
    assert.deepEqual(Config.donationRate, {});
    const filled = Object.assign({}, Config, { kofiPage: 'https://ko-fi.com/whathappened', workerUrl: 'https://wh-kofi.x.workers.dev',
        packs: [{ code: 'abc123', beans: 100, name: 'n', price: 'p' }, { code: 'OWNER_X', beans: 5 }, { code: 'zz', beans: 1.5 }] });
    assert.equal(Config.buyingOpen(filled), true);
    assert.deepEqual(Config.activePacks(filled).map((p) => p.code), ['abc123']);
    assert.equal(Config.packByCode('ABC123', filled).beans, 100);
    assert.equal(Config.shopItemUrl('abc123'), 'https://ko-fi.com/s/abc123');
    // the Ko-fi link and prices live in this one file: no page hard-codes a Ko-fi address
    for (const f of fs.readdirSync(ROOT).filter((x) => /\.(js|html)$/.test(x))) assert.ok(!/ko-fi\.com\//i.test(read(f)) || f === 'premium-panel.js' && !/https:\/\/ko-fi\.com\/[A-Za-z]/.test(read(f)), f + ' has no Ko-fi address of its own');
});

test('link codes: the same code for an account everywhere, the same hash the rules check, found in any message', async () => {
    const id = await Kofi.linkIdForUid('Abc123uid', webcrypto.subtle);
    const want = createHash('sha256').update('kofi-link:Abc123uid').digest('hex').toUpperCase().slice(0, 12);
    assert.equal(id, want);
    const code = Kofi.formatLinkCode(id);
    assert.match(code, /^WH-[0-9A-F]{4}-[0-9A-F]{4}-[0-9A-F]{4}$/);
    for (const msg of [code, 'hi! ' + code.toLowerCase() + ' thanks', code.replace(/-/g, ''), code.replace(/-/g, ' '), 'code:' + code + '.'])
        assert.equal(Kofi.findLinkCode(msg), id, msg);
    for (const msg of ['', 'no code here', 'WH-12', 'WH-ZZZZ-ZZZZ-ZZZZ', code + 'F']) assert.equal(Kofi.findLinkCode(msg), msg === code + 'F' ? '' : '', msg);
});

test('Ko-fi payloads: normalised, test payment spotted, Beans worked out from the table', () => {
    const cfg = Object.assign({}, Config, { packs: [{ code: 'p1', beans: 120 }], donationRate: { USD: 100 }, subscriptionTiers: { Club: 300 } });
    const n = Kofi.normalize({ kofi_transaction_id: 'tx-1234-abcd', type: 'Shop Order', amount: '5.00', currency: 'usd', message: 'm', email: 'A@B.C ',
        shop_items: [{ direct_link_code: 'P1', quantity: 2 }, { direct_link_code: 'other' }, 'junk'] });
    assert.equal(n.ok, true);
    assert.equal(n.currency, 'USD');
    assert.equal(n.email, 'a@b.c');
    assert.deepEqual(n.items, [{ code: 'P1', qty: 2 }, { code: 'other', qty: 1 }]);
    assert.equal(Kofi.creditFor(n, cfg).beans, 240);
    assert.equal(Kofi.normalize({ type: 'Donation' }).ok, false);
    assert.equal(Kofi.normalize({ kofi_transaction_id: Kofi.TEST_TXID }).isTest, true);
    assert.equal(Kofi.creditFor(Kofi.normalize({ kofi_transaction_id: 'tx-2222-abcd', type: 'Donation', amount: '2.999', currency: 'USD' }), cfg).beans, 299);
    assert.equal(Kofi.creditFor(Kofi.normalize({ kofi_transaction_id: 'tx-3333-abcd', type: 'Donation', amount: 'lots', currency: 'USD' }), cfg).beans, 0);
    assert.equal(Kofi.creditFor(Kofi.normalize({ kofi_transaction_id: 'tx-4444-abcd', type: 'Subscription', tier_name: 'Club' }), cfg).beans, 300);
    assert.deepEqual(Kofi.parseData('nope'), { ok: false, reason: 'not-json' });
    assert.equal(Kofi.sameSecret('abc', 'abc'), true);
    assert.equal(Kofi.sameSecret('abc', 'abd'), false);
    assert.equal(Kofi.sameSecret('', ''), false);
});

test('the earned-Beans state syncs with the account like other progress', () => {
    assert.ok(Progress.SYNC_KEYS.has('whathappened_premium'));
    assert.equal(Progress.isSyncKey('whathappened_premium'), true);
});
