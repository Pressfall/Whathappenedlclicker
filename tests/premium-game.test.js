'use strict';
// Holy What Happeneds 👼 on the real game page (premium.js + premium-panel.js + main.js in jsdom): the chip, earning from the saves,
// buying with earned Holy What Happeneds and with bought ones (a fake account in place of premium-cloud.js), getting a purchase back
// from the account, the looks switching on, and the panel.
const test = require('node:test');
const assert = require('node:assert/strict');
const { loadGame } = require('./helpers/game-harness');

const NOW = new Date(2026, 10, 9, 12, 0, 0).getTime();
const KEY = 'whathappened_premium';
const state = (game) => JSON.parse(game.storage.getItem(KEY) || 'null');
const chip = (game) => game.window.document.querySelector('#beanChip [data-bean-short]').textContent;
const seed = (o) => ({ [KEY]: JSON.stringify(Object.assign({ v: 1, started: 1, earned: 0, earnedTotal: 0, owned: {}, equip: {}, grants: {}, log: [] }, o)) });

// an account with bought Holy What Happeneds, standing in for premium-cloud.js
function fakeAccount(game, balance, spendResult) {
    const calls = [];
    const acct = { ready: true, user: { uid: 'u1' }, live: true, balance, link: 'ready', linkCode: 'WH-AAAA-BBBB-CCCC', error: '',
        spend: async (item, cost) => { calls.push([item, cost]); const r = spendResult || { ok: true, id: 'spend' + calls.length + 'abcdef' }; if (r.ok) acct.balance -= cost; return r; },
        ensureLink: async () => 'ready', history: async () => [], claim: async () => ({ ok: false, message: 'x' }) };
    game.window.WHBeansCloud = acct;
    game.window.dispatchEvent(new game.window.Event('whbeans-cloud'));
    return calls;
}

test('the chip shows the balance; the first check pays a capped thank-you for what was already done, then nothing twice', async () => {
    const g0 = loadGame({ now: NOW, noRenown: true });
    const legendary = g0.window.WHA.ACHIEVEMENTS.filter((a) => a.rarity === 'legendary').slice(0, 15).map((a) => a.key);
    const storage = {};
    for (const k of legendary) storage['ach_' + k] = '1';
    const game = loadGame({ now: NOW, noRenown: true, storage });
    assert.equal(chip(game), '0');
    await game.window.WHBeans.scan();
    const P = game.window.WHPremium;
    assert.equal(state(game).earned, P.EARN.retroCap);
    assert.equal(chip(game), String(P.EARN.retroCap));
    await game.window.WHBeans.scan();
    assert.equal(state(game).earned, P.EARN.retroCap, 'not twice');
    // a new achievement after that pays its own amount
    const epic = game.window.WHA.ACHIEVEMENTS.find((a) => a.rarity === 'epic' && !legendary.includes(a.key));
    game.storage.setItem('ach_' + epic.key, '1');
    await game.window.WHBeans.scan();
    assert.equal(state(game).earned, P.EARN.retroCap + P.EARN.achievement.epic);
});

test('buying with earned Holy What Happeneds: the theme and click numbers switch on, a title joins the game\'s titles', async () => {
    const game = loadGame({ now: NOW, noRenown: true, storage: seed({ earned: 700, earnedTotal: 700 }) });
    const B = game.window.WHBeans, body = game.window.document.body;
    const r = await B.buy('th_mocha');
    assert.equal(r.ok, true);
    assert.equal(r.fromPaid, 0);
    assert.ok(body.classList.contains('bn-theme-mocha'));
    assert.equal((await B.buy('pop_neon')).ok, true);
    assert.ok(body.classList.contains('bn-pop-neon'));
    assert.equal((await B.buy('t_bean_counter')).ok, true);
    const titles = JSON.parse(game.storage.getItem('unlocked_titles'));
    assert.ok(titles.some((t) => t.name === 'Bean Counter' && t.rarity === 'rare'));
    assert.equal(game.eval('TITLE_RARITIES["Bean Counter"]'), 'rare', 'other players see the title in its colour');
    assert.equal(state(game).earned, 700 - 350 - 200 - 100);
    // not enough for the next one: nothing changes
    const short = await B.buy('t_espresso');
    assert.equal(short.ok, false);
    assert.equal(short.reason, 'short');
    assert.equal(state(game).earned, 50);
    assert.equal((await B.buy('th_mocha')).reason, 'owned');
    // switch the theme off and on
    B.equip('th_mocha');
    assert.ok(!body.classList.contains('bn-theme-mocha'));
    B.equip('th_mocha');
    assert.ok(body.classList.contains('bn-theme-mocha'));
});

test('buying with bought Holy What Happeneds: earned ones first, the rest taken from the account first; a refusal costs nothing', async () => {
    const game = loadGame({ now: NOW, noRenown: true, storage: seed({ earned: 100, earnedTotal: 100 }) });
    const B = game.window.WHBeans;
    const calls = fakeAccount(game, 300);
    assert.equal(chip(game), '400');
    const r = await B.buy('th_midnight');
    assert.equal(r.ok, true);
    assert.deepEqual(calls, [['th_midnight', 250]]);
    const s = state(game);
    assert.equal(s.earned, 0);
    assert.equal(s.owned.th_midnight, true);
    assert.deepEqual(s.applied, ['spend1abcdef']);
    assert.equal(s.paid.balance, 300, 'the last balance seen is kept for showing (the account itself says 50 now)');

    const refused = loadGame({ now: NOW, noRenown: true, storage: seed({ earned: 100, earnedTotal: 100 }) });
    fakeAccount(refused, 300, { ok: false, reason: 'rules' });
    const r2 = await refused.window.WHBeans.buy('th_midnight');
    assert.deepEqual([r2.ok, r2.reason], [false, 'rules']);
    assert.equal(state(refused).earned, 100);
    assert.equal(state(refused).owned.th_midnight, undefined);
});

test('signed out, bought Holy What Happeneds can\'t be spent; a purchase logged in the account comes back on a new device', async () => {
    const game = loadGame({ now: NOW, noRenown: true, storage: seed({ earned: 20 }) });
    const B = game.window.WHBeans;
    game.window.WHBeansCloud = { ready: true, user: null, live: false, balance: 0 };
    const r = await B.buy('pop_latte');
    assert.deepEqual([r.ok, r.reason], [false, 'short']);
    const back = B.restore([{ id: 'spendold0001', item: 'pop_latte' }, { id: 'spendold0002', item: 't_night_roaster' }]);
    assert.equal(back.map((x) => x.id).join(','), 'pop_latte,t_night_roaster'); // (arrays from the page's realm: compare as text)
    assert.ok(JSON.parse(game.storage.getItem('unlocked_titles')).some((t) => t.name === 'Night Roaster'));
    assert.equal(B.restore([{ id: 'spendold0001', item: 'pop_latte' }]).length, 0);
});

test('the panel: shop, earn and Get more tabs; buying from it asks first; buying stays closed while the config is placeholders', async () => {
    const game = loadGame({ now: NOW, noRenown: true, storage: seed({ earned: 500, earnedTotal: 500 }) });
    const doc = game.window.document;
    game.window.document.getElementById('beanChip').click();
    const overlay = doc.querySelector('.bn-overlay');
    assert.ok(overlay && !overlay.hidden);
    assert.equal(doc.querySelectorAll('.bn-card').length, game.window.WHPremium.CATALOG.length);
    assert.match(doc.querySelector('.bn-fine').textContent, /never buy gems, rubies, Golden, lootboxes/);
    doc.querySelector('[data-bnbuy="pop_ember"]').click();
    assert.ok(doc.querySelector('[data-bnyes="pop_ember"]'), 'asks before spending');
    assert.equal(state(game).owned.pop_ember, undefined);
    doc.querySelector('[data-bnyes="pop_ember"]').click();
    for (let i = 0; i < 5; i++) await new Promise((r) => setImmediate(r));
    assert.equal(state(game).owned.pop_ember, true);
    assert.match(doc.querySelector('.bn-msg').textContent, /Bought Ember/);
    doc.querySelector('[data-bntab="earn"]').click();
    assert.ok(doc.querySelectorAll('.bn-row').length >= 6);
    doc.querySelector('[data-bntab="get"]').click();
    assert.match(doc.querySelector('.bn-tabbody').textContent, /isn't open yet/);
    // Escape closes it
    overlay.dispatchEvent(new game.window.KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
    assert.ok(overlay.hidden);
});

test('Get more once the owner filled in the config: sign in first; then the link code, the packs on Ko-fi, history and claiming', async () => {
    const game = loadGame({ now: NOW, noRenown: true, storage: seed({ earned: 5 }) });
    const w = game.window, doc = w.document, C = w.WHPremiumConfig;
    Object.assign(C, { kofiPage: 'https://ko-fi.com/whtest', workerUrl: 'https://wh-kofi.test.workers.dev',
        packs: [{ code: 'beanbag1', beans: 500, name: 'Bag of Holy What Happeneds', price: '$5' }, { code: 'OWNER_SHOP_ITEM_CODE_2', beans: 0, name: 'x', price: 'x' }] });
    const tick = async () => { for (let i = 0; i < 6; i++) await new Promise((r) => setImmediate(r)); };
    // signed out: asked to sign in, nothing else
    w.WHBeansCloud = { ready: true, user: null, live: false, balance: 0 };
    w.WHBeansPanel.open('get');
    assert.match(doc.querySelector('.bn-tabbody').textContent, /Sign in to your account first/);
    assert.ok(doc.querySelector('.bn-tabbody a[href="account.html"]'));
    // signed in
    const claims = [];
    fakeAccount(game, 0);
    Object.assign(w.WHBeansCloud, { link: 'none', ensureLink: async () => { w.WHBeansCloud.link = 'ready'; return 'ready'; },
        history: async () => [{ beans: 500, kind: 'Shop Order', at: NOW }],
        claim: async (txid, email) => { claims.push([txid, email]); return { ok: true, beans: 120 }; } });
    doc.querySelector('[data-bntab="get"]').click(); // opening the tab loads the history again
    await tick();
    const body = () => doc.querySelector('.bn-tabbody');
    assert.match(body().textContent, /Ask a parent or guardian/);
    assert.equal(doc.getElementById('bnCode').textContent, 'WH-AAAA-BBBB-CCCC');
    const links = [...body().querySelectorAll('a[target="_blank"]')].map((a) => a.getAttribute('href'));
    assert.equal(links.join(), 'https://ko-fi.com/s/beanbag1', 'only filled-in packs, each linking to its Ko-fi item');
    assert.match(body().textContent, /\+500 Shop Order/);
    const form = doc.getElementById('bnClaim');
    form.elements.namedItem('txid').value = 'aaaa-bbbb-cccc'; form.elements.namedItem('email').value = 'me@example.com';
    form.dispatchEvent(new w.Event('submit', { bubbles: true, cancelable: true }));
    await tick();
    assert.deepEqual(claims, [['aaaa-bbbb-cccc', 'me@example.com']]);
    assert.match(doc.querySelector('.bn-claim .bn-msg').textContent, /Claimed: 120 Holy What Happeneds/);
});

test('the earned-Holy What Happeneds state is part of the progress that syncs and exports', () => {
    const game = loadGame({ now: NOW, noRenown: true, storage: seed({ earned: 42 }) });
    assert.equal(game.window.WHProgress.isSyncKey(KEY), true);
});
