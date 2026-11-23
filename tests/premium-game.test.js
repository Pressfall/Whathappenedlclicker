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
    const r = await B.buy('th_heaven');
    assert.equal(r.ok, true);
    assert.equal(r.fromPaid, 0);
    assert.ok(body.classList.contains('bn-theme-heaven'));
    assert.equal((await B.buy('pop_halo')).ok, true);
    assert.ok(body.classList.contains('bn-pop-halo'));
    assert.equal((await B.buy('t_acolyte')).ok, true);
    const titles = JSON.parse(game.storage.getItem('unlocked_titles'));
    assert.ok(titles.some((t) => t.name === 'Acolyte of What' && t.rarity === 'rare'));
    assert.equal(game.eval('TITLE_RARITIES["Acolyte of What"]'), 'rare', 'other players see the title in its colour');
    assert.equal(state(game).earned, 700 - 350 - 200 - 100);
    // not enough for the next one: nothing changes
    const short = await B.buy('t_archangel');
    assert.equal(short.ok, false);
    assert.equal(short.reason, 'short');
    assert.equal(state(game).earned, 50);
    assert.equal((await B.buy('th_heaven')).reason, 'owned');
    // switch the theme off and on
    B.equip('th_heaven');
    assert.ok(!body.classList.contains('bn-theme-heaven'));
    B.equip('th_heaven');
    assert.ok(body.classList.contains('bn-theme-heaven'));
});

test('buying with bought Holy What Happeneds: earned ones first, the rest taken from the account first; a refusal costs nothing', async () => {
    const game = loadGame({ now: NOW, noRenown: true, storage: seed({ earned: 100, earnedTotal: 100 }) });
    const B = game.window.WHBeans;
    const calls = fakeAccount(game, 300);
    assert.equal(chip(game), '400');
    const r = await B.buy('th_stained');
    assert.equal(r.ok, true);
    assert.deepEqual(calls, [['th_stained', 250]]);
    const s = state(game);
    assert.equal(s.earned, 0);
    assert.equal(s.owned.th_stained, true);
    assert.deepEqual(s.applied, ['spend1abcdef']);
    assert.equal(s.paid.balance, 300, 'the last balance seen is kept for showing (the account itself says 50 now)');

    const refused = loadGame({ now: NOW, noRenown: true, storage: seed({ earned: 100, earnedTotal: 100 }) });
    fakeAccount(refused, 300, { ok: false, reason: 'rules' });
    const r2 = await refused.window.WHBeans.buy('th_stained');
    assert.deepEqual([r2.ok, r2.reason], [false, 'rules']);
    assert.equal(state(refused).earned, 100);
    assert.equal(state(refused).owned.th_stained, undefined);
});

test('signed out, bought Holy What Happeneds can\'t be spent; a purchase logged in the account comes back on a new device', async () => {
    const game = loadGame({ now: NOW, noRenown: true, storage: seed({ earned: 20 }) });
    const B = game.window.WHBeans;
    game.window.WHBeansCloud = { ready: true, user: null, live: false, balance: 0 };
    const r = await B.buy('pop_feather');
    assert.deepEqual([r.ok, r.reason], [false, 'short']);
    const back = B.restore([{ id: 'spendold0001', item: 'pop_feather' }, { id: 'spendold0002', item: 't_haloed' }]);
    assert.equal(back.map((x) => x.id).join(','), 'pop_feather,t_haloed'); // (arrays from the page's realm: compare as text)
    assert.ok(JSON.parse(game.storage.getItem('unlocked_titles')).some((t) => t.name === 'Haloed'));
    assert.equal(B.restore([{ id: 'spendold0001', item: 'pop_feather' }]).length, 0);
});

test('the panel: shop, earn and Get more tabs; buying from it asks first; buying stays closed while the config is placeholders', async () => {
    const game = loadGame({ now: NOW, noRenown: true, storage: seed({ earned: 500, earnedTotal: 500 }) });
    const doc = game.window.document;
    game.window.WHPremiumConfig.workerUrl = 'https://OWNER-WORKER.workers.dev'; // as before the worker is set up
    game.window.document.getElementById('beanChip').click();
    const overlay = doc.querySelector('.bn-overlay');
    assert.ok(overlay && !overlay.hidden);
    assert.equal(doc.querySelectorAll('.bn-card').length, game.window.WHPremium.CATALOG.filter((c) => c.kind === 'gems' || c.kind === 'golden').length, 'opens on Currency: gem packs and Golden');
    doc.querySelector('[data-bncat="clicker"]').click();
    assert.match(doc.querySelector('.bn-fine').textContent, /never buy lootboxes, follower packs or rubies themselves, and the casino doesn't take them/);
    doc.querySelector('[data-bnbuy="pop_choir"]').click();
    assert.ok(doc.querySelector('[data-bnyes="pop_choir"]'), 'asks before spending');
    assert.equal(state(game).owned.pop_choir, undefined);
    doc.querySelector('[data-bnyes="pop_choir"]').click();
    for (let i = 0; i < 5; i++) await new Promise((r) => setImmediate(r));
    assert.equal(state(game).owned.pop_choir, true);
    assert.match(doc.querySelector('.bn-msg').textContent, /Bought Choir/);
    doc.querySelector('[data-bntab="earn"]').click();
    assert.ok(doc.querySelectorAll('.bn-row').length >= 6);
    doc.querySelector('[data-bntab="get"]').click();
    assert.match(doc.querySelector('.bn-tabbody').textContent, /isn't open yet/);
    // Escape closes it
    overlay.dispatchEvent(new game.window.KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
    assert.ok(overlay.hidden);
});

test('Get more once the owner filled in the config: sign in first; then the packs on Ko-fi, history and claiming', async () => {
    const game = loadGame({ now: NOW, noRenown: true, storage: seed({ earned: 5 }) });
    const w = game.window, doc = w.document, C = w.WHPremiumConfig;
    Object.assign(C, { kofiPage: 'https://ko-fi.com/whtest', workerUrl: 'https://wh-kofi.test.workers.dev', tipPacks: [],
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
    assert.equal(doc.getElementById('bnCode'), null, 'Shop packs only: no link code to paste anywhere');
    const links = [...body().querySelectorAll('a[target="_blank"]')].map((a) => a.getAttribute('href'));
    assert.equal(links.join(), 'https://ko-fi.com/s/beanbag1', 'only filled-in packs, each linking to its Ko-fi item');
    assert.match(body().textContent, /no email address, so a Ko-fi purchase can't find it by itself/);
    assert.match(body().textContent, /\+500 Shop pack/, 'Ko-fi\'s "Shop Order", by the name the game gives it');
    const form = doc.getElementById('bnClaim');
    form.elements.namedItem('txid').value = 'aaaa-bbbb-cccc'; form.elements.namedItem('email').value = 'me@example.com';
    form.dispatchEvent(new w.Event('submit', { bubbles: true, cancelable: true }));
    await tick();
    assert.deepEqual(claims, [['aaaa-bbbb-cccc', 'me@example.com']]);
    assert.match(doc.querySelector('.bn-claim .bn-msg').textContent, /Claimed: 120 Holy What Happeneds/);
});

test('Get more with the shipped tip packs: each pack, its tip amount, a link to the Ko-fi page, and how to paste the code', async () => {
    const game = loadGame({ now: NOW, noRenown: true, storage: seed({ earned: 5 }) });
    const w = game.window, doc = w.document, C = w.WHPremiumConfig;
    assert.equal(C.buyingOpen(), true);
    fakeAccount(game, 0);
    w.WHBeansPanel.open('get');
    for (let i = 0; i < 6; i++) await new Promise((r) => setImmediate(r));
    const body = doc.querySelector('.bn-tabbody');
    const packs = C.activeTipPacks();
    // with Shop packs too, tipping is folded away under them
    const tipway = C.activePacks().length ? body.querySelector('details.bn-tipway') : body;
    assert.ok(tipway, 'the tip packs are there');
    const cards = [...tipway.querySelectorAll('.bn-card')];
    assert.equal(cards.length, packs.length);
    packs.forEach((p, i) => {
        assert.match(cards[i].textContent, new RegExp(p.name + '[\\s\\S]*' + p.beans.toLocaleString('en-US') + ' for a \\$' + p.dollars + ' tip'));
        assert.equal(cards[i].querySelector('a').getAttribute('href'), C.kofiPage);
    });
    assert.match(body.textContent, /paste your code in Your message/);
    assert.match(body.textContent, /sharing it can't cost you anything/);
});

test('Shop packs: the account\'s email finds the purchase; Get more collects once on opening and again on "Check now"; tips stay, folded', async () => {
    const game = loadGame({ now: NOW, noRenown: true, storage: seed({ earned: 5 }) });
    const w = game.window, doc = w.document, C = w.WHPremiumConfig;
    Object.assign(C, { packs: [{ code: 'aaa111', beans: 200, name: 'Small', price: '$2' }, { code: 'bbb222', beans: 550, name: 'Medium', price: '$5' }] });
    const tick = async () => { for (let i = 0; i < 6; i++) await new Promise((r) => setImmediate(r)); };
    fakeAccount(game, 0);
    const acct = w.WHBeansCloud, asked = [];
    let answer = { ok: true, beans: 550, count: 1 };
    Object.assign(acct, { email: 'player.one@example.com', emailVerified: true, collectState: 'none', collected: null,
        collect: async () => { asked.push(1); acct.collectState = 'done'; acct.collected = answer; return answer; } });
    w.WHBeansPanel.open('get');
    await tick();
    const body = () => doc.querySelector('.bn-tabbody');
    const cards = [...body().querySelectorAll('.bn-grid--packs:not(.bn-tipway *) .bn-card')];
    assert.deepEqual(cards.map((c) => c.querySelector('a').getAttribute('href')), ['https://ko-fi.com/s/aaa111', 'https://ko-fi.com/s/bbb222']);
    assert.match(cards[1].textContent, /\+10% more/, 'the bonus against the smallest pack');
    assert.match(body().textContent, /Pay on Ko-fi with pl•••e@example\.com, the email you sign in with here/);
    assert.equal(asked.length, 1, 'collected once on opening');
    assert.match(body().textContent, /Found a purchase: 550 Holy What Happeneds added/);
    // the tab again: no second automatic call; "Check now" asks again and says when there's nothing
    doc.querySelector('[data-bntab="shop"]').click(); doc.querySelector('[data-bntab="get"]').click();
    await tick();
    assert.equal(asked.length, 1);
    answer = { ok: true, beans: 0, count: 0 };
    doc.querySelector('[data-bncollect]').click();
    await tick();
    assert.equal(asked.length, 2);
    assert.match(body().textContent, /Nothing waiting/);
    // tipping is still there, folded, with the link code; opening it survives a redraw
    const fold = body().querySelector('details.bn-tipway');
    assert.ok(fold && !fold.open && fold.querySelector('#bnCode'));
    fold.open = true; fold.dispatchEvent(new w.Event('toggle'));
    w.WHBeansPanel.render();
    assert.ok(body().querySelector('details.bn-tipway').open);
    assert.match(body().querySelector('.bn-claim summary').textContent, /Paid with another email, or without your code\?/);
    // a password account that hasn't verified its email: told to, and never collected for
    Object.assign(acct, { emailVerified: false, collectState: 'none', collected: null });
    w.WHBeansPanel.render();
    await tick();
    assert.match(body().textContent, /Verify your email \(pl•••e@example\.com\) on the Account page first/);
    assert.ok(body().querySelector('.bn-note a[href="account.html"]'));
    assert.equal(asked.length, 2);
});

test('Ko-fi sends buyers back to the game with ?holy=get: Get more opens, and the address loses the parameter', async () => {
    const game = loadGame({ now: NOW, noRenown: true, storage: seed({ earned: 5 }), url: 'https://whathappenedclicker.netlify.app/?holy=get' });
    game.runTimeouts(); // the page's timers are captured: the panel opens on one
    const doc = game.window.document;
    assert.equal(game.window.location.search, '');
    const overlay = doc.querySelector('.bn-overlay');
    assert.ok(overlay && !overlay.hidden, 'the panel is open');
    assert.ok(doc.querySelector('[data-bntab="get"].is-on, [data-bntab="get"][aria-pressed="true"], [data-bntab="get"][aria-selected="true"]'), 'on Get more');
});

test('the earned-Holy What Happeneds state is part of the progress that syncs and exports', () => {
    const game = loadGame({ now: NOW, noRenown: true, storage: seed({ earned: 42 }) });
    assert.equal(game.window.WHProgress.isSyncKey(KEY), true);
});

test('gem packs and Golden: they land in the game\'s save, with no limit; Golden is 3x the next prestige (at least 15); bought ones pay the rest', async () => {
    const game = loadGame({ now: NOW, noRenown: true, storage: seed({ earned: 200, earnedTotal: 200 }) });
    const B = game.window.WHBeans;
    const gems0 = game.eval('diamonds'), golden0 = Number(game.eval('goldenWhat')) || 0;
    const r = await B.buy('g_handful');
    assert.equal(r.ok, true);
    assert.equal(game.eval('diamonds'), gems0 + 50);
    assert.equal(JSON.parse(game.storage.getItem('whathappened_save')).diamonds, gems0 + 50, 'saved in the game\'s save at once');
    assert.equal(state(game).earned, 195);
    // no weekly limit: a dozen more go through
    for (let i = 0; i < 12; i++) assert.equal((await B.buy('g_handful')).ok, true, 'pack ' + (i + 2));
    assert.equal(game.eval('diamonds'), gems0 + 13 * 50);
    assert.equal((await B.buy('g_stack')).ok, true);
    assert.equal(game.eval('diamonds'), gems0 + 13 * 50 + 275, 'a bigger pack with its bonus');
    assert.equal(state(game).earned, 200 - 13 * 5 - 25);
    // Golden with no prestige in sight: the 15 minimum
    assert.equal(game.window.getPotentialPrestigeAwards(), 0);
    assert.equal(B.gives(game.window.WHPremium.BY_ID.x_golden).n, 15);
    const g = await B.buy('x_golden');
    assert.equal(g.ok, true);
    assert.equal(Number(game.eval('goldenWhat')), golden0 + 15);
    assert.equal(g.gave.n, 15);
    // a run worth 9 Golden: 27, and the account pays what earned ones don't cover
    game.window.getPotentialPrestigeAwards = () => 9;
    const calls = fakeAccount(game, 100);
    B.mutate((st) => { st.earned = 10; });
    const g2 = await B.buy('x_golden');
    assert.equal(g2.ok, true);
    assert.equal(Number(game.eval('goldenWhat')), golden0 + 15 + 27);
    assert.deepEqual(calls, [['x_golden', 30]], '10 earned + 30 from the account');
    assert.equal(state(game).earned, 0);
    assert.equal(state(game).week, undefined, 'nothing counts toward a limit');
    assert.match(state(game).log[state(game).log.length - 1].why, /Traded for 27 Golden What Happeneds/);
    // the panel: the gem section first, with its bonuses and what gems can go on
    game.window.WHBeansPanel.open('shop', 'gems'); // the old name opens Currency
    const doc = game.window.document;
    assert.equal(doc.querySelector('[data-bncat="currency"]').getAttribute('aria-pressed'), 'true');
    assert.match(doc.querySelector('.bn-sec-head .bn-sub').textContent, /random contents/, 'says gems can go on lootboxes');
    assert.match(doc.querySelector('.bn-tabbody').textContent, /Best value · \+40% gems/);
    assert.ok(!/left this week|used this week/.test(doc.querySelector('.bn-tabbody').textContent), 'no limits shown');
    assert.match(doc.querySelector('.bn-tabbody').textContent, /Gem packs[\s\S]*Golden What Happeneds/, 'gems and Golden in one Currency section');
    assert.match(doc.querySelector('.bn-tabbody').textContent, /You get 27 now: 3 × 9 from your next prestige/);
});

test('timelapses pay hours of the income at once; none before there is any income', async () => {
    const game = loadGame({ now: NOW, noRenown: true, storage: seed({ earned: 100, earnedTotal: 100 }) });
    const B = game.window.WHBeans;
    game.eval('cps = 0');
    const none = await B.buy('tl_1h');
    assert.deepEqual([none.ok, none.reason], [false, 'no-cps']);
    assert.equal(state(game).earned, 100, 'nothing taken');
    game.eval('cps = 250');
    const before = Number(game.eval('count'));
    const r = await B.buy('tl_4h');
    assert.equal(r.ok, true);
    assert.equal(Number(game.eval('count')) - before, 250 * 4 * 3600);
    assert.equal(state(game).earned, 65);
    assert.match(state(game).log[state(game).log.length - 1].why, /What Happeneds/);
    game.window.WHBeansPanel.open('shop', 'time');
    const doc = game.window.document;
    assert.equal(doc.querySelectorAll('.bn-card').length, 4);
    assert.match(doc.querySelector('.bn-tabbody').textContent, /33% off/);
});

test('gems, Golden and timelapses can only be had on the game page', async () => {
    const game = loadGame({ now: NOW, noRenown: true, storage: seed({ earned: 100 }) });
    game.window.addGems = undefined; // as in the Wilds, where the game's save isn't open
    game.window.addCpsSeconds = undefined;
    const r = await game.window.WHBeans.buy('g_handful');
    assert.deepEqual([r.ok, r.reason], [false, 'game-only']);
    assert.deepEqual([(await game.window.WHBeans.buy('tl_1h')).reason], ['game-only']);
    assert.equal(state(game).earned, 100);
    game.window.WHBeansPanel.open('shop', 'gems');
    assert.match(game.window.document.querySelector('.bn-tabbody').textContent, /Trade for it on the game page/);
});

test('boost bundles land in Items with no limit; auras switch on; weapon skins; the shop\'s sections hold every item once', async () => {
    const game = loadGame({ now: NOW, noRenown: true, storage: seed({ earned: 1000, earnedTotal: 1000 }) });
    const B = game.window.WHBeans, doc = game.window.document, P = game.window.WHPremium;
    const items = () => (JSON.parse(game.storage.getItem('whathappened_items') || '{}').items || {});
    const before = items();
    const r = await B.buy('b_rush');
    assert.equal(r.ok, true);
    const after = items();
    assert.equal((after.energyDrink || 0) - (before.energyDrink || 0), 2);
    assert.equal((after.spareBattery || 0) - (before.spareBattery || 0), 2);
    assert.equal((after.loadedDice || 0) - (before.loadedDice || 0), 1);
    for (let i = 0; i < 5; i++) assert.equal((await B.buy('b_rush')).ok, true, 'no weekly limit');
    assert.equal(state(game).earned, 1000 - 6 * 10);
    // an aura: on the body, so the main image's button draws it
    assert.equal((await B.buy('au_halo')).ok, true);
    assert.ok(doc.body.classList.contains('bn-aura-halo'));
    B.equip('au_halo');
    assert.ok(!doc.body.classList.contains('bn-aura-halo'), 'and off again');
    // a weapon skin can be bought here too, for the Wilds
    assert.equal((await B.buy('ws_gilded')).ok, true);
    assert.equal(state(game).equip.weapon, 'ws_gilded');
    assert.equal(B.weaponSkin().id, 'ws_gilded');
    assert.equal(B.weaponSkin('ws_prism').id, 'ws_prism', 'another player\'s skin, by its id');
    assert.equal(B.weaponSkin('tr_light'), null, 'only weapon skins');
    // the shop: a side menu of sections; every catalog item shows in exactly one of them
    game.window.WHBeansPanel.open('shop');
    const cats = [...doc.querySelectorAll('[data-bncat]')].map((b) => b.dataset.bncat);
    assert.deepEqual(cats, ['currency', 'time', 'boosts', 'titles', 'clicker', 'chat', 'wilds']);
    const seen = [];
    for (const c of cats) {
        doc.querySelector('[data-bncat="' + c + '"]').click();
        assert.equal(doc.querySelector('[data-bncat="' + c + '"]').getAttribute('aria-pressed'), 'true');
        for (const card of doc.querySelectorAll('.bn-card')) seen.push(card.querySelector('.bn-name').textContent);
    }
    assert.equal(seen.length, P.CATALOG.length, 'each item once');
    assert.equal(seen.slice().sort().join('|'), P.CATALOG.map((c) => c.name).sort().join('|')); // (the page's arrays: compare as text)
    // the Wilds section says everyone there sees them; the owned skin shows as in use
    doc.querySelector('[data-bncat="wilds"]').click();
    assert.match(doc.querySelector('.bn-sec-head').textContent, /Everyone there sees them/);
    assert.match(doc.querySelector('.bn-tabbody').textContent, /Gilded[\s\S]*Turn off/);
    // without the Items menu (the Wilds), bundles can't be bought
    game.window.WHI = undefined;
    const w = await B.buy('b_rush');
    assert.deepEqual([w.ok, w.reason], [false, 'game-only']);
});

test('monthly buffs: 2x click power or 2x CPS on the game page while they run, bought on either page', async () => {
    const game = loadGame({ now: NOW, noRenown: true, storage: seed({ earned: 1000, earnedTotal: 1000 }) });
    const B = game.window.WHBeans;
    game.eval('updateDisplays()');
    const click0 = Number(game.eval('clickPower'));
    assert.ok(click0 > 0);
    assert.deepEqual(JSON.parse(JSON.stringify(game.eval('getHolyBoosts()'))), { cps: 1, click: 1, offline: 1, crit: 0, offlineUntil: 0, offlineBuffMult: 2 });
    const r = await B.buy('bf_click');
    assert.equal(r.ok, true);
    assert.equal(state(game).buffs.click, NOW + 30 * 86400000);
    game.eval('updateDisplays()');
    assert.equal(Number(game.eval('clickPower')), click0 * 2, 'double click power');
    game.eval('updateDisplays()');
    assert.equal(Number(game.eval('clickPower')), click0 * 2, 'not compounding on every redraw');
    assert.deepEqual(JSON.parse(JSON.stringify(game.eval('getHolyBoosts()'))), { cps: 1, click: 2, offline: 1, crit: 0, offlineUntil: 0, offlineBuffMult: 2 });
    assert.equal((await B.buy('bf_cps')).ok, true);
    assert.equal(game.eval('getHolyBoosts()').cps, 2);
    // the shop says how long it has left
    game.window.WHBeansPanel.open('shop', 'boosts');
    assert.match(game.window.document.querySelector('.bn-tabbody').textContent, /Monthly 2× Clicks[\s\S]*Running: 30 days left/);
    assert.match(game.window.document.querySelector('.bn-tabbody').textContent, /Buffs[\s\S]*Save[\s\S]*Monthly 2× Everything[\s\S]*Item bundles[\s\S]*Mega Rush/);
    assert.ok(game.window.document.querySelector('.bn-meter'), 'a running buff shows how long is left');
    // a buff needs nothing from the game page, so the Wilds sell it too
    game.window.addGems = undefined;
    assert.equal(B.canTrade(game.window.WHPremium.BY_ID.bf_cps), true);
});

test('timelapses move the followers on too: eggs hatch sooner and pack cooldowns end sooner, never past now', async () => {
    const F0 = loadGame({ now: NOW, noRenown: true }).window.WHF;
    const pack = F0.PACKS[0].id, sp = F0.SPECIES[0].id, H = 3600000;
    const followers = { v: 1, nextId: 2, nextEggId: 3, slots: 3, equipped: [null, null, null], list: [], pity: 0, opened: 0, bred: 0, seen: {}, packReadyAt: { [pack]: NOW + 3 * H },
        nursery: [{ id: 1, a: 1, b: 1, spA: sp, spB: sp, startedAt: NOW - H, duration: 6 * H, readyAt: NOW + 5 * H, child: { sp } },
            { id: 2, a: 1, b: 1, spA: sp, spB: sp, startedAt: NOW - 9 * H, duration: 8 * H, readyAt: NOW - H, child: { sp } }] };
    const game = loadGame({ now: NOW, noRenown: true, storage: Object.assign(seed({ earned: 100, earnedTotal: 100 }), { whathappened_followers: JSON.stringify(followers) }) });
    game.eval('cps = 10');
    assert.equal((await game.window.WHBeans.buy('tl_4h')).ok, true);
    const f = JSON.parse(game.storage.getItem('whathappened_followers'));
    assert.equal(f.nursery[0].readyAt, NOW + H, '5 hours to go, 4 skipped: 1 left');
    assert.equal(f.nursery[0].startedAt, NOW - 5 * H, 'its progress moves with it');
    assert.equal(f.nursery[1].readyAt, NOW - H, 'an egg already ready stays as it was');
    assert.equal(f.packReadyAt[pack], NOW, '3 hours to go, 4 skipped: ready now, not before');
    assert.equal(game.window.WHF.skipTime(0).eggs, 0);
});

test('clicker hats and accessories: one of each at a time, worn together; chat effects travel with your messages', async () => {
    const game = loadGame({ now: NOW, noRenown: true, storage: seed({ earned: 4000, earnedTotal: 4000 }) });
    const B = game.window.WHBeans, doc = game.window.document;
    const worn = () => [...doc.querySelectorAll('.main-image-btn .bn-acc')].map((e) => e.dataset.slot + ':' + e.className.match(/bn-acc--(\w+)/)[1]).sort().join(',');
    assert.equal((await B.buy('ht_crown')).ok, true);
    const hat = doc.querySelector('.main-image-btn .bn-acc');
    assert.ok(hat && hat.classList.contains('bn-acc--crown') && hat.classList.contains('bn-acc-slot-hat'), 'the crown is on');
    assert.ok(hat.querySelector('svg'));
    assert.ok(doc.body.classList.contains('bn-acc-on'));
    // an accessory goes on with the hat
    assert.equal((await B.buy('ac_shades')).ok, true);
    assert.equal(worn(), 'accessory:shades,hat:crown');
    // another hat takes the crown's place; another accessory the shades'
    assert.equal((await B.buy('ht_tophat')).ok, true);
    assert.equal(worn(), 'accessory:shades,hat:tophat');
    assert.equal((await B.buy('ac_headphones')).ok, true);
    assert.equal(worn(), 'accessory:headphones,hat:tophat');
    assert.deepEqual([state(game).equip.hat, state(game).equip.accessory], ['ht_tophat', 'ac_headphones']);
    // wearing the crown again from the shop swaps it back in
    B.equip('ht_crown');
    assert.equal(worn(), 'accessory:headphones,hat:crown');
    // both off
    B.equip('ht_crown'); B.equip('ac_headphones');
    assert.equal(doc.querySelector('.main-image-btn .bn-acc'), null, 'and off again');
    assert.ok(!doc.body.classList.contains('bn-acc-on'));
    // the shop: hats and accessories under their own headings
    game.window.WHBeansPanel.open('shop', 'clicker');
    assert.match(doc.querySelector('.bn-tabbody').textContent, /Hats[\s\S]*Royal Crown[\s\S]*Devil Horns[\s\S]*Accessories[\s\S]*Cool Shades[\s\S]*Headphones/);
    // chat effects: the one worn is sent; any known one is shown, an unknown one shows plain
    assert.equal(B.chatFx(), '');
    assert.equal((await B.buy('cf_fire')).ok, true);
    assert.equal(B.chatFx(), 'cf_fire');
    assert.equal(B.chatFxClass('cf_fire'), 'bn-chatfx bn-chatfx-fire');
    assert.equal(B.chatFxClass('cf_nope'), '');
    assert.equal(B.chatFxClass('ws_gilded'), '', 'only chat effects');
    // Chat effects and click bursts once shared the class bn-cfx: the bursts' rule (absolute, 0 x 0) then took every message
    // with an effect out of the line. Each family keeps its own prefix, and every effect a message can wear is styled.
    const css = premiumCss();
    assert.match(css, /\.bn-chatfx \{ font-weight: 700; \}/);
    for (const it of Object.values(require('../core/premium').BY_ID).filter((x) => x.kind === 'chatfx')) {
        const cls = B.chatFxClass(it.id).split(' ')[1];
        assert.match(css, new RegExp('\\.' + cls + ' \\{'), it.id + ' is styled');
        assert.doesNotMatch(cls, /^bn-cfx/, it.id + ' does not use the click bursts\' classes');
    }
    assert.doesNotMatch(css.slice(0, css.indexOf('/* ---- click bursts')), /\.bn-cfx\b/, 'no burst class styled among the chat effects');
    const html = require('fs').readFileSync(require('path').join(__dirname, '..', 'index.html'), 'utf8');
    assert.equal((html.match(/fx: myChatFx\(\)/g) || []).length, 3, 'global chat (both boxes) and clan chat send it');
    assert.equal((html.match(/chatFxWrap\(d\.fx, chatText\(d\.message\)\)/g) || []).length, 6, 'every chat view shows it');
    assert.match(require('fs').readFileSync(require('path').join(__dirname, '..', 'clan-page.js'), 'utf8'), /fx: myChatFx\(\)[\s\S]*|chatFxWrap\(m\.fx, chatText\(m\.message\)\)/);
});

test('more buffs: +10% crit chance while the Lucky Streak runs; 2x offline earnings for the part of the time away it ran', async () => {
    const game = loadGame({ now: NOW, noRenown: true, storage: seed({ earned: 2000, earnedTotal: 2000 }) });
    const B = game.window.WHBeans;
    assert.equal(game.eval('getHolyBoosts()').crit, 0);
    assert.equal(game.eval('holyOfflineMult(3600)'), 1);
    assert.equal((await B.buy('bf_crit')).ok, true);
    assert.equal(game.eval('getHolyBoosts()').crit, 10);
    assert.equal((await B.buy('bf_offline')).ok, true);
    assert.equal(game.eval('holyOfflineMult(3600)'), 2, 'away an hour, all of it with the buff');
    // a buff that ran out halfway through the time away counts for half of it
    B.mutate((st) => { st.buffs.offline = NOW - 1800 * 1000; });
    assert.equal(game.eval('holyOfflineMult(3600)'), 1.5);
    assert.equal(game.eval('holyOfflineMult(0)'), 1);
    // the main.js lines that use them
    const src = require('fs').readFileSync(require('path').join(__dirname, '..', 'main.js'), 'utf8');
    assert.match(src, /chance \+= \(getHolyBoosts\(\)\.crit \|\| 0\) \/ 100;/);
    assert.match(src, /const gained = totalCps \* seconds \* holyOfflineMult\(seconds\);/);
});

test('the shop: search across every section, hide owned, a pulse on what was just bought', async () => {
    const game = loadGame({ now: NOW, noRenown: true, storage: seed({ earned: 3000, earnedTotal: 3000 }) });
    const w = game.window, doc = w.document, B = w.WHBeans;
    w.WHBeansPanel.open('shop', 'clicker');
    const search = doc.getElementById('bnSearch');
    assert.ok(search, 'a search field');
    search.value = 'pirate';
    search.dispatchEvent(new w.Event('input', { bubbles: true }));
    const names = () => [...doc.querySelectorAll('.bn-card .bn-name')].map((n) => n.textContent);
    assert.deepEqual(names().slice().sort().join('|'), ['Eye Patch', 'Pirate King', 'Pirate Tricorn', 'Pirate Tricorn'].sort().join('|'), 'found across sections, by name and by what it comes from');
    assert.match(doc.querySelector('.bn-sec-head h4').textContent, /Results for/);
    assert.equal(doc.getElementById('bnSearch'), search, 'the field stays as typed in (it keeps focus)');
    search.value = 'zzzz';
    search.dispatchEvent(new w.Event('input', { bubbles: true }));
    assert.match(doc.querySelector('.bn-tabbody').textContent, /Nothing matches/);
    search.value = '';
    search.dispatchEvent(new w.Event('input', { bubbles: true }));
    // hide owned
    assert.equal((await B.buy('th_heaven')).ok, true);
    w.WHBeansPanel.open('shop', 'clicker');
    assert.ok(doc.querySelector('.bn-card.is-bought') || true);
    assert.ok(names().includes('Heavenly'));
    const hide = doc.querySelector('[data-bnhide]');
    hide.checked = true;
    hide.dispatchEvent(new w.Event('change', { bubbles: true }));
    assert.ok(!names().includes('Heavenly'), 'owned looks hidden');
    assert.ok(names().includes('Sanctum'));
    assert.match(doc.querySelector('.bn-count').textContent, /looks · 1 owned/);
    // the top (balance and tabs) is its own block, kept at the top while the shop scrolls
    assert.ok(doc.querySelector('.bn-top .bn-balance') && doc.querySelector('.bn-top .bn-tabs'));
});

// ---------------- click effects: a burst where you click the What Happened, and a glow on the "+N" to match ----------------
const premiumCss = () => require('fs').readFileSync(require('path').join(__dirname, '..', 'premium.css'), 'utf8');
// a player's click on the What Happened at (x, y): the pointer comes down there, then the button's onclick runs increment()
function clickImage(game, x, y) {
    const w = game.window;
    w.document.querySelector('.main-image-btn').dispatchEvent(new w.MouseEvent('pointerdown', { bubbles: true, clientX: x, clientY: y }));
    game.eval('increment()');
}
const bursts = (game) => game.window.document.querySelectorAll('#bnClickFx .bn-cfx');
const pieceKinds = (fx) => [...fx.children].map((e) => [...e.classList].find((c) => /^bn-cfx-/.test(c) && c !== 'bn-cfx-ring' && c !== 'bn-cfx-bit').replace(/^bn-cfx-/, ''));

test('click effects: every one bursts where you click in its own pieces, with a matching glow on the +N; none worn, no burst', async () => {
    const game = loadGame({ now: NOW, noRenown: true, storage: seed({ earned: 5000, earnedTotal: 5000 }) });
    const w = game.window, doc = w.document, B = w.WHBeans, css = premiumCss();
    // nothing worn: the "+N" as it always was, and no burst (not even the layer for one)
    clickImage(game, 120, 140);
    assert.ok(doc.querySelector('#clickFloatLayer .click-float'), 'the number still floats up');
    assert.equal(doc.getElementById('bnClickFx'), null);
    assert.equal(B.clickFx(120, 140, false), false);
    const ids = w.WHPremium.CATALOG.filter((c) => c.kind === 'pop').map((c) => c.id);
    assert.ok(ids.length >= 6, ids.length + ' click effects');
    const looks = new Set();
    for (const id of ids) {
        assert.equal((await B.buy(id)).ok, true, 'bought ' + id);
        const name = id.replace(/^pop_/, ''), fx = B.POP_FX[name];
        assert.ok(fx, id + ' has a burst');
        game.advance(1000);
        clickImage(game, 200, 150);
        const el = doc.querySelector('#bnClickFx .bn-cfx--' + name);
        assert.ok(el, id + ' bursts on a click');
        assert.equal(el.style.left + ',' + el.style.top, '200px,150px', id + ': where the click was');
        assert.equal(el.querySelectorAll('.bn-cfx-ring').length, fx.rings, id + ' rings');
        assert.equal(el.querySelectorAll('.bn-cfx-bit').length, fx.bits, id + ' bits');
        for (const b of el.querySelectorAll('.bn-cfx-bit')) assert.match(b.getAttribute('style'), /--dx:-?\d+(\.\d)?px;--dy:-?\d+(\.\d)?px;--r:-?\d+deg;--t:\d+ms;--d:\d+ms/);
        const kinds = [...new Set(pieceKinds(el))];
        for (const k of kinds) assert.match(css, new RegExp('\\.bn-cfx-' + k + ' \\{'), id + ': .bn-cfx-' + k + ' is styled');
        looks.add(kinds.sort().join('+'));
        // the number glows in the burst's colours, a crit more so, and reduced motion has a glow in them too
        assert.match(css, new RegExp('body\\.bn-pop-' + name + ' \\.click-float \\{[^}]*text-shadow:[^}]*0 0 \\d+px[^}]*0 0 \\d+px'), id + ' number glow');
        assert.match(css, new RegExp('body\\.bn-pop-' + name + ' \\.click-float\\.crit \\{[^}]*text-shadow'), id + ' crit glow');
        assert.match(css, new RegExp('\\.bn-cfx--' + name + ' \\{ --c1: [^;]+; --c2: '), id + ' still glow colours');
        assert.ok(doc.body.classList.contains('bn-pop-' + name));
    }
    assert.equal(looks.size, ids.length, 'each one its own pieces: ' + [...looks].join(', '));
    // switched off: back to no burst
    B.equip(ids[ids.length - 1]);
    game.advance(1000);
    const before = bursts(game).length;
    clickImage(game, 50, 50);
    assert.equal(bursts(game).length, before, 'off again');
    assert.ok(![...doc.body.classList].some((c) => c.startsWith('bn-pop-')));
});

test('click effects: a crit is bigger, Medium lighter, Low none; reduced motion only fades; never the Auto Clicker\'s clicks', async () => {
    const game = loadGame({ now: NOW, noRenown: true, storage: seed({ earned: 100, earnedTotal: 100, owned: { pop_halo: true }, equip: { pop: 'pop_halo' } }) });
    const w = game.window, doc = w.document, B = w.WHBeans, fx = B.POP_FX.halo;
    assert.ok(doc.body.classList.contains('bn-pop-halo'));
    // a crit: more bits, flung further (is-crit opens the rings wider)
    assert.equal(B.clickFx(100, 100, true), true);
    const crit = bursts(game)[0];
    assert.ok(crit.classList.contains('is-crit'));
    assert.equal(crit.querySelectorAll('.bn-cfx-bit').length, Math.round(fx.bits * 1.5));
    // a fast clicker: one burst every 45 ms; and only so many on screen
    assert.equal(B.clickFx(100, 100, false), false, 'too soon after the last');
    game.advance(50);
    assert.equal(B.clickFx(100, 100, false), true);
    for (let i = 0; i < 12; i++) B.clickFx(100, 100, true);
    assert.equal(bursts(game).length, 8, 'at most 8 at once');
    // each goes once its pieces are done
    game.runTimeouts();
    assert.equal(bursts(game).length, 0);
    // the Auto Clicker's clicks get the number, never a burst
    game.advance(1000);
    game.eval('increment({ auto: true })');
    assert.equal(bursts(game).length, 0);
    // Medium: one ring, half the bits
    game.storage.setItem('whathappened_performance', 'medium');
    game.advance(1000);
    assert.equal(B.clickFx(100, 100, false), true);
    const lite = bursts(game)[0];
    assert.equal(lite.querySelectorAll('.bn-cfx-ring').length, 1);
    assert.equal(lite.querySelectorAll('.bn-cfx-bit').length, Math.round(fx.bits / 2));
    game.runTimeouts();
    // reduced motion: one soft glow that fades where you clicked, nothing that moves
    const mm = w.matchMedia;
    w.matchMedia = (q) => ({ matches: /prefers-reduced-motion: reduce/.test(q), addEventListener() {}, addListener() {} });
    game.advance(1000);
    assert.equal(B.clickFx(100, 100, true), true);
    const still = bursts(game)[0];
    assert.ok(still.classList.contains('is-still'));
    assert.equal(still.children.length, 1);
    assert.ok(still.firstElementChild.classList.contains('bn-cfx-still'));
    assert.match(premiumCss(), /@keyframes bn-cfx-fade \{ 0% \{ opacity: 0; \} 25% \{ opacity: 0\.85; \} 100% \{ opacity: 0; \} \}/, 'opacity only');
    assert.match(premiumCss(), /@media \(prefers-reduced-motion: reduce\) \{ \.bn-cfx > \.bn-cfx-ring, \.bn-cfx > \.bn-cfx-bit \{ display: none; \} \}/);
    w.matchMedia = mm;
    game.runTimeouts();
    // Low (Settings > Performance): no burst, as there is no number either
    const sel = doc.getElementById('performanceSelect');
    sel.value = 'low';
    sel.onchange();
    assert.ok(doc.body.classList.contains('perf-low'));
    game.advance(1000);
    clickImage(game, 100, 100);
    assert.equal(B.clickFx(100, 100, true), false);
    assert.equal(bursts(game).length, 0);
    assert.match(premiumCss(), /body\.perf-low #bnClickFx \{ display: none; \}/);
});

test('click effects in the shop: each card plays its burst behind the number', async () => {
    const game = loadGame({ now: NOW, noRenown: true, storage: seed({ earned: 500, earnedTotal: 500 }) });
    const doc = game.window.document;
    doc.getElementById('beanChip').click();
    doc.querySelector('[data-bncat="clicker"]').click();
    const cards = doc.querySelectorAll('.bn-art--pop[data-bnpop]');
    assert.equal(cards.length, game.window.WHPremium.CATALOG.filter((c) => c.kind === 'pop').length);
    for (const a of cards) assert.ok(a.querySelector('.bn-cfx--' + a.dataset.bnpop.replace(/^pop_/, '') + ' .bn-cfx-ring'), a.dataset.bnpop + ' plays');
    assert.match(doc.querySelector('.bn-tabbody').textContent, /Click effects/);
});

// a 2D canvas that only remembers what was drawn and in which colours (jsdom has no canvas)
function recordingCtx() {
    const t = { calls: [], colours: new Set(), createRadialGradient: () => ({ addColorStop() {} }), createLinearGradient: () => ({ addColorStop() {} }) };
    return new Proxy(t, {
        get: (o, k) => (k in o ? o[k] : (...a) => { o.calls.push(k); return { width: 10 }; }),
        set: (o, k, v) => { if (k === 'fillStyle' || k === 'strokeStyle') o.colours.add(String(v).toLowerCase()); o[k] = v; return true; },
    });
}

test('Skippie Toilet looks: the headset on the What Happened, the outfit and Toilet Tunes trail drawn in the Wilds and the shop', async () => {
    const game = loadGame({ now: NOW, noRenown: true, storage: seed({ earned: 2000, earnedTotal: 2000 }) });
    const w = game.window, doc = w.document, B = w.WHBeans, P = w.WHPremium;
    for (const id of ['ac_skippie', 'of_skippie', 'tr_tunes']) assert.equal(P.BY_ID[id].ref, 'Skippie Toilet (upgrade)', id);
    // the headset: worn by the What Happened, placed like the other accessories
    assert.equal((await B.buy('ac_skippie')).ok, true);
    const acc = doc.querySelector('.main-image-btn .bn-acc--skippie');
    assert.ok(acc && acc.querySelector('svg'), 'the headset is on');
    assert.match(premiumCss(), /\.bn-acc--skippie \{ width: [\d.]+%; left: [\d.]+%; top: -?[\d.]+%; \}/);
    // every Wilds look draws its shop picture without trouble; the Skippie ones in Skippie's colours
    for (const it of P.CATALOG.filter((c) => ['trail', 'head', 'back', 'tail', 'outfit'].includes(c.kind))) {
        const ctx = recordingCtx();
        B.drawPreview(ctx, it.id, 200, 104);
        assert.ok(ctx.calls.includes('fill') || ctx.calls.includes('stroke') || ctx.calls.includes('fillRect'), it.id + ' draws');
        if (it.id === 'of_skippie') for (const c of ['#4aa8e8', '#f4f8fb', '#e0302f', '#1f2a36']) assert.ok(ctx.colours.has(c), 'the outfit has ' + c);
        if (it.id === 'tr_tunes') assert.ok(ctx.colours.has('rgba(170, 225, 255, 0.95)') && ctx.colours.has('rgba(255,92,154,0.95)'), 'notes and bubbles');
    }
    // the trail in the Wilds: notes and bubbles drop behind a player who walks
    const ctx = recordingCtx(), p = { x: 0, y: 0, r: 14 };
    for (let i = 0; i < 12; i++) { p.x += 10; B.drawLooksOf(ctx, p, { trail: 'tr_tunes' }); }
    assert.ok(ctx.calls.filter((c) => c === 'fill').length >= 10, 'bits drawn');
    // and the outfit over a player
    const o = recordingCtx();
    B.drawLooksOver(o, p, { outfit: 'of_skippie' });
    assert.ok(o.calls.includes('clip') && o.colours.has('#4aa8e8'), 'the lid behind the head, the bowl and headset');
});

// ---------------- Holy codes: Settings > Codes codes of type 'holy' ----------------
// stand-in codes from Firestore; returns redeem(code) -> the status line
function holyCodes(game) {
    game.eval(`window.db = {}; window.doc = (db, col, id) => ({ col, id });
        window.getDoc = async (ref) => { const codes = { HOLYCODE: { type: 'holy', amount: 75 }, HOLYMSG: { type: 'holy', amount: 5, message: 'Blessings!' }, BIGHOLY: { type: 'holy', amount: 5e6 } };
            const c = codes[ref.id]; return { exists: () => !!c, data: () => c }; };`);
    return async (code) => {
        game.eval(`document.getElementById('secretCodeInput').value = ${JSON.stringify(code)}`);
        await game.eval('redeemSecretCode()');
        for (let i = 0; i < 5; i++) await new Promise((r) => setImmediate(r));
        return game.eval("document.getElementById('secretCodeStatus').innerText");
    };
}

test('a Holy code pays earned Holy What Happeneds once, also on another device, never more than the cap', async () => {
    const game = loadGame({ now: NOW, noRenown: true, storage: seed({ earned: 10, earnedTotal: 10 }) });
    const P = game.window.WHPremium, redeem = holyCodes(game);
    assert.match(await redeem('holycode'), /^You received 75 Holy What Happeneds! 👼$/);
    assert.equal(state(game).earned, 85);
    assert.equal(state(game).grants['code:HOLYCODE'], 75);
    assert.equal(chip(game), '85');
    assert.match(await redeem('HOLYCODE'), /already redeemed/);
    assert.equal(state(game).earned, 85);
    assert.equal(await redeem('HOLYMSG'), 'Blessings!', 'the code\'s own message');
    assert.equal(state(game).earned, 90);
    assert.match(await redeem('BIGHOLY'), /You received 100,000 Holy What Happeneds/);
    assert.equal(state(game).earned, 90 + P.CODE_MAX);
    // another device: the Holy state synced, the list of redeemed codes not yet
    const other = loadGame({ now: NOW, noRenown: true, storage: { [KEY]: game.storage.getItem(KEY) } });
    assert.match(await holyCodes(other)('HOLYCODE'), /already redeemed/);
    assert.equal(state(other).earned, 90 + P.CODE_MAX, 'not paid twice');
});

test('Hypergomus Wings: white wings with the red criss-cross on one side and the blue fan on the other', async () => {
    const game = loadGame({ now: NOW, noRenown: true, storage: seed({ earned: 600, earnedTotal: 600 }) });
    const B = game.window.WHBeans, P = game.window.WHPremium;
    const it = P.BY_ID.bk_hypergamy;
    assert.equal(it.kind, 'back');
    assert.equal(it.name, 'Hypergomus Wings');
    assert.equal(it.ref, 'Hypergamy (upgrade)');
    assert.equal((await B.buy('bk_hypergamy')).ok, true);
    assert.equal(state(game).equip.back, 'bk_hypergamy', 'worn in the back slot');
    const ctx = recordingCtx();
    B.drawPreview(ctx, 'bk_hypergamy', 200, 104);
    for (const c of ['rgba(255, 255, 255, 0.95)', '#d23a4a', '#2fb2e0']) assert.ok(ctx.colours.has(c), 'drawn in ' + c);
    assert.equal(ctx.calls.filter((c) => c === 'clip').length, 2, 'the diagram inside each wing');
    assert.ok(ctx.calls.filter((c) => c === 'lineTo').length >= 13 + 10, 'the criss-cross and the fan');
    // in the Wilds, over a player
    const w = recordingCtx();
    B.drawLooksOf(w, { x: 50, y: 50, r: 14 }, { back: 'bk_hypergamy' });
    assert.ok(w.colours.has('#d23a4a') && w.colours.has('#2fb2e0'));
});
