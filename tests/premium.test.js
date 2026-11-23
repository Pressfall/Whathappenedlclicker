'use strict';
// Holy What Happeneds 👼: the pure rules (core/premium.js, core/premium-config.js, core/kofi.js) and the lines they must never cross:
// looks, plus gems, Golden, timelapses and boosts with no limit (the owner's choices, 2026-11-10 and 2026-11-20); never a lootbox, pack or anything random
// directly, never casino chips, never a paywall on what is free, and no browser write that adds bought Holy What Happeneds
// (the spend rule in firestore-premium.rules, written out as checkWalletSpend).
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

// ---------------- what Holy What Happeneds buy ----------------
test('the shop sells looks, gem packs, Golden, timelapses, buffs and boosts, with no limit; nothing that gives a box, a pack, rubies or Glory', () => {
    assert.deepEqual(P.KINDS, ['gems', 'golden', 'timelapse', 'bundle', 'buff', 'title', 'theme', 'aura', 'pop', 'hat', 'accessory', 'chatfx', 'weapon', 'trail', 'head', 'back', 'tail', 'outfit']);
    assert.deepEqual(P.REPEAT_KINDS, ['gems', 'golden', 'timelapse', 'bundle', 'buff']);
    const ids = new Set();
    const FIELDS = {
        gems: ['id', 'kind', 'name', 'cost', 'desc', 'gems'],
        golden: ['id', 'kind', 'name', 'cost', 'desc'],
        timelapse: ['id', 'kind', 'name', 'cost', 'desc', 'sec'],
        bundle: ['id', 'kind', 'name', 'cost', 'desc', 'items'],
        buff: ['id', 'kind', 'name', 'cost', 'desc', 'buff', 'days'],
        weapon: ['id', 'kind', 'name', 'cost', 'desc', 'main', 'trim', 'glow', 'fx', 'hit'],
        trail: ['id', 'kind', 'name', 'cost', 'desc', 'colors', 'rise', 'shape'],
        look: ['id', 'kind', 'name', 'cost', 'rarity', 'desc', 'swatch'],
    };
    for (const k in FIELDS) FIELDS[k].push('ref'); // what a look comes from in the game (checked below)
    // each kind's id prefix (the Wilds' ones say their slot when shared online: core/world-online.js)
    const PREFIX = { gems: 'g_', golden: 'x_', timelapse: 'tl_', bundle: 'b_', buff: 'bf_', title: 't_', theme: 'th_', aura: 'au_', pop: 'pop_', hat: 'ht_', accessory: 'ac_',
        chatfx: 'cf_', weapon: 'ws_', trail: 'tr_', head: 'hd_', back: 'bk_', tail: 'ta_', outfit: 'of_' };
    for (const it of P.CATALOG) {
        assert.ok(P.KINDS.includes(it.kind), it.id + ' kind');
        assert.ok(it.id.startsWith(PREFIX[it.kind]), it.id + ' starts with ' + PREFIX[it.kind]);
        assert.ok(Number.isInteger(it.cost) && it.cost > 0, it.id + ' cost');
        assert.ok(!ids.has(it.id), 'unique id ' + it.id); ids.add(it.id);
        const allowed = FIELDS[it.kind] || FIELDS.look;
        for (const k of Object.keys(it)) assert.ok(allowed.includes(k), it.id + ' has no "' + k + '"');
        assert.equal(it.perWeek, undefined, it.id + ': no weekly limit any more (the owner, 2026-11-20)');
        if (it.kind === 'bundle') {
            // only the timed boosts the game takes from anywhere outside it (never a Gem Pouch, a Geode or a Golden Ticket)
            for (const [id, n] of Object.entries(it.items)) {
                assert.ok(Bridge.isItem(id), it.id + ': ' + id + ' is a boost the bridge allows');
                assert.ok(Number.isInteger(n) && n > 0 && n <= 5, it.id + ': a few of ' + id);
            }
        }
        if (it.kind === 'weapon') {
            for (const k of ['main', 'trim']) assert.match(it[k], /^#[0-9a-f]{6}$/, it.id + ' ' + k);
            assert.match(it.glow, /^rgba\(/, it.id + ' glow');
            assert.ok([undefined, 'pulse', 'prism'].includes(it.fx), it.id + ' fx');
            // its hit: a few small bursts, never a screenful (E.burst caps particles too)
            assert.ok(Array.isArray(it.hit) && it.hit.length >= 1 && it.hit.length <= 4, it.id + ' hit');
            let total = 0;
            for (const h of it.hit) {
                assert.equal(h.length, 6, it.id + ' hit part');
                assert.match(h[0], /^#[0-9a-f]{6}$/, it.id + ' hit colour');
                assert.ok(h[1] >= 1 && h[2] > 0 && h[3] > 0 && h[3] <= 1 && h[4] > 0 && h[4] <= 8 && Math.abs(h[5]) <= 400, it.id + ' hit numbers');
                total += h[1];
            }
            assert.ok(total <= 40, it.id + ': ' + total + ' particles a hit');
        }
        if (it.kind === 'trail') assert.ok(['puff', 'feather', 'spark', 'flame', 'crystal', 'smoke', 'star', 'bill', 'grape', 'bubble', 'pixel', 'leaf', 'tune'].includes(it.shape), it.id + ' shape');
        if (it.kind === 'buff') assert.ok([...P.BUFF_KEYS, 'all'].includes(it.buff) && [7, 30].includes(it.days), it.id + ': a buff for a week or a month');
        // what the Wilds share online (core/world-online.js): ids that fit its pattern
        if (P.WILDS_KINDS.includes(it.kind)) assert.match(it.id, /^(ws|tr|hd|bk|ta|of)_[a-z0-9_]{2,16}$/, it.id + ' can be shared online');
    }
    assert.deepEqual(P.CATALOG.filter(P.isExchange).map((c) => c.id), ['g_handful', 'g_stack', 'g_pile', 'g_hoard', 'g_mountain', 'x_golden']);
    assert.equal(P.CATALOG.filter((c) => c.kind === 'bundle')[0].id, 'b_rush');
    // the owner's ask: a monthly 2x click and a monthly 2x CPS, 250 each
    assert.deepEqual([P.BY_ID.bf_click.buff, P.BY_ID.bf_click.days, P.BY_ID.bf_click.cost], ['click', 30, 250]);
    assert.deepEqual([P.BY_ID.bf_cps.buff, P.BY_ID.bf_cps.days, P.BY_ID.bf_cps.cost], ['cps', 30, 250]);
    assert.deepEqual(P.BUFF_EFFECT, { click: { mult: 2 }, cps: { mult: 2 }, offline: { mult: 2 }, crit: { pp: 10 } });
    // "2x Everything" costs less than the three it runs, for as long
    assert.ok(P.BY_ID.bf_all.cost < P.BY_ID.bf_click.cost + P.BY_ID.bf_cps.cost + P.BY_ID.bf_offline.cost);
    assert.ok(P.CATALOG.filter((c) => c.kind === 'bundle').length >= 5, 'item bundles');
    for (const k of ['aura', 'hat', 'accessory', 'chatfx', 'weapon', 'trail', 'head', 'back', 'tail', 'outfit']) assert.ok(P.EQUIP_KINDS.includes(k), k + ' is worn like the other looks');
    assert.deepEqual(P.WILDS_KINDS, ['weapon', 'trail', 'head', 'back', 'tail', 'outfit']);
    // the owner's asks of 2026-11-20
    for (const id of ['hd_horns', 'ta_demon', 'of_easton', 'hd_magehat', 'hd_warhelm', 'tr_demonic', 'tr_ice', 'tr_fire', 'tr_magic']) assert.ok(P.BY_ID[id], id);
    assert.ok(P.CATALOG.filter((c) => c.kind === 'weapon').length >= 10, 'weapon skins for the Wilds');
    assert.ok(P.CATALOG.filter((c) => c.kind === 'theme').length >= 9, 'page themes');
    assert.ok(P.CATALOG.filter((c) => c.kind === 'hat').length >= 4, 'clicker hats');
    assert.ok(P.CATALOG.filter((c) => c.kind === 'accessory').length >= 2, 'clicker accessories');
    // hats are only hats: the shades and headphones are accessories, worn with one
    assert.deepEqual(P.CATALOG.filter((c) => c.kind === 'accessory').map((c) => c.id), ['ac_shades', 'ac_headphones', 'ac_eyepatch', 'ac_cane', 'ac_skippie']);
    assert.ok(P.CATALOG.filter((c) => c.kind === 'chatfx').length >= 5, 'chat effects');
});

test('looks that come from the game: each names a real upgrade, Divine upgrade or skin, and every kind of look has some', () => {
    const html = read('index.html');
    const upgrades = new Set([...html.matchAll(/class="upgrade-label">([^(<]+)/g)].map((m) => m[1].trim()));
    const divine = new Set([...html.matchAll(/divine-name[^>]*>([^<]+)/g)].map((m) => m[1].trim()));
    const skins = new Set(require('../core/skins.js').SKINS.map((k) => k.title));
    assert.ok(upgrades.size >= 30 && divine.size >= 7 && skins.size >= 15, 'read the game\'s names');
    const refs = P.CATALOG.filter((c) => c.ref);
    assert.ok(refs.length >= 40, refs.length + ' looks from the game');
    for (const it of refs) {
        const m = /^(.+?) \((upgrades?|Divine upgrade|skin)\)$/.exec(it.ref);
        assert.ok(m, it.id + ': "' + it.ref + '" says what it comes from');
        const names = m[1].split(' and ');
        const pool = m[2] === 'skin' ? skins : m[2] === 'Divine upgrade' ? divine : upgrades;
        for (const n of names) assert.ok(pool.has(n), it.id + ': "' + n + '" is a ' + m[2].replace(/s$/, '') + ' in the game');
        assert.ok(!P.isRepeat(it), it.id + ' is a look');
    }
    for (const k of ['title', 'theme', 'hat', 'accessory', 'aura', 'pop', 'chatfx', 'weapon', 'trail', 'head', 'back', 'tail', 'outfit'])
        assert.ok(refs.some((c) => c.kind === k), 'a ' + k + ' from the game');
    // upgrades, Divine upgrades and skins all appear
    for (const what of ['(upgrade)', '(Divine upgrade)', '(skin)']) assert.ok(refs.some((c) => c.ref.endsWith(what)), what);
});

test('a Holy code (Settings > Codes, type holy) pays its earned Holy What Happeneds once, kept for good, capped', () => {
    const s = P.clean({ started: 1 });
    assert.equal(P.codeGrantId(' holy-50 '), 'code:HOLY-50');
    assert.equal(P.codeGrantId('a.b c'), 'code:A_B_C', 'what a grant id can\'t hold becomes _');
    assert.equal(P.codeGrantId(''), '');
    assert.equal(P.codeGrantId('...'), '', 'no letters or numbers: no code');
    assert.equal(P.grantCode(s, 'HOLY50', 50, NOW), 50);
    assert.equal(s.earned, 50);
    assert.equal(s.grants['code:HOLY50'], 50);
    assert.match(s.log[s.log.length - 1].why, /HOLY50/);
    assert.equal(P.grantCode(s, 'holy50', 50, NOW), 0, 'once, whatever the case');
    assert.equal(s.earned, 50);
    assert.equal(P.grantCode(s, 'ZERO', 0, NOW), 0);
    assert.equal(P.grantCode(s, 'HUGE', 1e9, NOW), P.CODE_MAX, 'never more than CODE_MAX');
    // kept through a save, a sync and the pruning of old weeks (a code has no date)
    const back = P.clean(JSON.parse(JSON.stringify(s)));
    assert.equal(back.grants['code:HOLY50'], 50);
    P.prune(back, NOW + 400 * 86400000);
    assert.equal(back.grants['code:HOLY50'], 50);
    assert.equal(P.grantCode(back, 'HOLY50', 50, NOW), 0, 'still once on the other device');
});

test('the halo and wings moved from the one "mark" slot to head and back: old saves and old spends keep them, worn', () => {
    assert.deepEqual(P.RENAMED, { mk_halo: 'hd_halo', mk_wings: 'bk_wings' });
    const s = P.clean({ owned: { mk_halo: true, mk_wings: true, au_halo: true }, equip: { mark: 'mk_wings', aura: 'au_halo' } });
    assert.deepEqual(s.owned, { hd_halo: true, bk_wings: true, au_halo: true });
    assert.equal(s.equip.back, 'bk_wings', 'still worn, now on the back');
    assert.equal(s.equip.head, '');
    assert.equal(s.equip.mark, undefined);
    const h = P.clean({ owned: { mk_halo: true }, equip: { mark: 'mk_halo' } });
    assert.equal(h.equip.head, 'hd_halo');
    // a spend logged in the account with the old id brings back the new one
    assert.deepEqual(P.restoreFromSpends(P.fresh(), [{ id: 'spendold001', item: 'mk_wings' }]).map((x) => x.id), ['bk_wings']);
});

test('monthly buffs: 30 days from now, or on from when the running one ends; at most a year ahead; buffMults says what runs', () => {
    const s = P.fresh();
    s.earned = 100000;
    assert.deepEqual(P.buffMults(s, NOW), { click: 1, cps: 1, offline: 1, crit: 0, until: { click: 0, cps: 0, offline: 0, crit: 0 } });
    assert.equal(P.completeExchange(s, 'bf_cps', 250, NOW), true);
    assert.equal(s.buffs.cps, NOW + 30 * DAY);
    assert.equal(P.buffMults(s, NOW + DAY).cps, 2);
    assert.equal(P.buffMults(s, NOW + DAY).click, 1, 'only the one bought');
    assert.equal(P.completeExchange(s, 'bf_cps', 250, NOW + DAY), true);
    assert.equal(s.buffs.cps, NOW + 60 * DAY, 'added on to the end');
    assert.equal(P.buffMults(s, NOW + 61 * DAY).cps, 1, 'and it ends');
    // bought after it ran out: 30 days from then
    assert.equal(P.completeExchange(s, 'bf_click', 250, NOW + 100 * DAY), true);
    assert.equal(s.buffs.click, NOW + 130 * DAY);
    for (let i = 0; i < 20; i++) P.completeExchange(s, 'bf_click', 250, NOW + 100 * DAY);
    assert.equal(s.buffs.click, NOW + 100 * DAY + P.BUFF_MAX_DAYS * DAY, 'never more than a year ahead');
    assert.equal(s.owned.bf_click, undefined, 'a buff is never owned');
    assert.deepEqual(P.clean({ buffs: { click: 'x', cps: NOW, evil: 9 } }).buffs, { click: 0, cps: NOW, offline: 0, crit: 0 });
    // a weekly one adds 7 days to the same timer
    const w = P.fresh(); w.earned = 1000;
    P.completeExchange(w, 'bf_cps', 250, NOW); P.completeExchange(w, 'bf_cps_w', 75, NOW);
    assert.equal(w.buffs.cps, NOW + 37 * DAY);
    // 2x Everything runs clicks, CPS and offline; the Lucky Streak adds crit chance
    const e = P.fresh(); e.earned = 1000;
    P.completeExchange(e, 'bf_all', 550, NOW); P.completeExchange(e, 'bf_crit', 200, NOW);
    assert.deepEqual(P.buffMults(e, NOW + DAY), { click: 2, cps: 2, offline: 2, crit: 10, until: { click: NOW + 30 * DAY, cps: NOW + 30 * DAY, offline: NOW + 30 * DAY, crit: NOW + 30 * DAY } });
    assert.equal(P.buffUntil(e, P.BY_ID.bf_all, NOW), NOW + 30 * DAY);
    P.completeExchange(e, 'bf_click_w', 75, NOW);
    assert.equal(P.buffUntil(e, P.BY_ID.bf_all, NOW), NOW + 30 * DAY, 'the soonest of its three');
    assert.equal(P.buffUntil(e, P.BY_ID.bf_click, NOW), NOW + 37 * DAY);
    assert.deepEqual(P.restoreFromSpends(P.fresh(), [{ id: 'spendbf0001', item: 'bf_cps' }]), [], 'never handed out again from the log');
});

test('gem packs: 10 gems for each Holy What Happened, and the bigger the pack the bigger the bonus', () => {
    const packs = P.CATALOG.filter((c) => c.kind === 'gems');
    assert.equal(P.GEM_RATE, 10);
    assert.equal(packs[0].gems, packs[0].cost * 10, 'the smallest pack is exactly 10 gems each');
    for (const p of packs) assert.ok(p.gems >= p.cost * 10, p.id + ' never below the rate');
    assert.deepEqual(packs.map(P.gemBonus), [0, 10, 20, 30, 40], 'each bigger pack a bigger bonus');
    assert.deepEqual(packs.map((p) => p.cost), packs.map((p) => p.cost).slice().sort((a, b) => a - b), 'smallest first');
    assert.equal(P.gemBonus(P.BY_ID.x_golden), 0, 'only gem packs have a gem bonus');
});

test('Golden: 3 times the next prestige, never fewer than 15', () => {
    assert.deepEqual(P.GOLDEN, { mult: 3, min: 15 });
    assert.equal(P.goldenFor(0), 15);
    assert.equal(P.goldenFor(4), 15, '3 x 4 = 12, so the minimum');
    assert.equal(P.goldenFor(5), 15);
    assert.equal(P.goldenFor(6), 18);
    assert.equal(P.goldenFor(40.9), 120, 'whole awards only');
    assert.equal(P.goldenFor(-3), 15);
    assert.equal(P.goldenFor('junk'), 15);
});

test('repeat items: no limit, the earned part taken, never owned, never handed out again from the account log', () => {
    const s = P.fresh();
    s.earned = 5000;
    for (let i = 0; i < 12; i++) assert.equal(P.completeExchange(s, 'g_handful', 5, NOW), true, 'gem pack ' + (i + 1));
    for (let i = 0; i < 6; i++) assert.equal(P.completeExchange(s, 'x_golden', 40, NOW, 'spendxx000' + i, '45 Golden What Happeneds'), true);
    for (let i = 0; i < 6; i++) assert.equal(P.completeExchange(s, 'tl_4h', 35, NOW), true);
    for (let i = 0; i < 6; i++) assert.equal(P.completeExchange(s, 'b_rush', 10, NOW), true);
    assert.equal(s.earned, 5000 - 12 * 5 - 6 * 40 - 6 * 35 - 6 * 10);
    for (const id of ['g_handful', 'x_golden', 'tl_4h', 'b_rush']) {
        assert.equal(P.canBuy(s, id).ok, true, id + ' can always be bought again');
        assert.equal(s.owned[id], undefined, id + ' is never owned');
    }
    assert.equal(s.week, undefined, 'no weekly counts are kept');
    assert.equal(s.log[s.log.length - 1].why, 'Bought Holy Rush');
    assert.equal(s.log.find((e) => /Golden/.test(e.why)).why, 'Traded for 45 Golden What Happeneds', 'the log says what the trade gave');
    // the account log can bring looks back to a new device, never gems, Golden, timelapses or boosts
    const t = P.fresh();
    assert.deepEqual(P.restoreFromSpends(t, [{ id: 'spendxx0002', item: 'g_pile' }, { id: 'spendxx0003', item: 'x_golden' }, { id: 'spendxx0004', item: 'tl_24h' }, { id: 'spendxx0005', item: 'b_rush' }]), []);
    assert.deepEqual(t.applied, ['spendxx0002', 'spendxx0003', 'spendxx0004', 'spendxx0005']);
    // not with Holy What Happeneds it doesn't have, and a stored state can't claim a trade is owned
    const u = P.fresh();
    assert.equal(P.completeExchange(u, 'x_golden', 40, NOW), false);
    assert.deepEqual(P.clean({ owned: { g_handful: true, tl_1h: true } }).owned, {});
    assert.equal(P.completePurchase(P.fresh(), 'g_handful', 0, NOW), false, 'trades go through completeExchange only');
    // a save from before the limits went keeps working; its weekly counts are dropped
    const old = P.clean({ earned: 30, owned: { au_halo: true }, week: { id: '2026-W46', n: { x_gems: 3 } }, equip: { aura: 'au_halo' } });
    assert.equal(old.week, undefined);
    assert.equal(old.earned, 30);
    assert.equal(old.equip.aura, 'au_halo');
});

test('weapon skins are worn like the other looks, and the Wilds looks are what is shared', () => {
    const s = P.fresh();
    s.earned = 2000;
    assert.equal(P.completePurchase(s, 'ws_gilded', 250, NOW), true);
    assert.equal(s.equip.weapon, 'ws_gilded', 'on as soon as it is bought');
    assert.equal(P.completePurchase(s, 'bk_wings', 500, NOW), true);
    assert.equal(P.completePurchase(s, 'hd_horns', 350, NOW), true);
    assert.deepEqual(P.wildsLooks(s), { weapon: 'ws_gilded', trail: '', head: 'hd_horns', back: 'bk_wings', tail: '', outfit: '' });
    assert.equal(P.equip(s, 'ws_gilded'), true);
    assert.equal(s.equip.weapon, '', 'switched off');
    assert.equal(P.equip(s, 'ws_prism'), false, 'not owned');
    assert.deepEqual(P.clean({ owned: { ws_gilded: true }, equip: { weapon: 'ws_gilded', trail: 'ws_gilded' } }).equip,
        { theme: '', pop: '', aura: '', hat: '', accessory: '', chatfx: '', weapon: 'ws_gilded', trail: '', head: '', back: '', tail: '', outfit: '' });
    assert.deepEqual(P.wildsLooks(null), { weapon: '', trail: '', head: '', back: '', tail: '', outfit: '' });
});

test('the casino doesn\'t take Holy What Happeneds, and no other game code reads what they bought (nothing free gets locked behind them)', () => {
    for (const f of ['gamba.js', 'gamba.html']) assert.ok(!/WHBeans|WHPremium|whathappened_premium|premium\.js|Holy What Happeneds/i.test(read(f)), f + ' knows nothing of Holy What Happeneds');
    // only these files touch the Holy What Happeneds state or API; main.js only colours the bought titles, the Wilds only draw the
    // looks (yours and other players'), share yours online, and ask for an earnings check after a Glory purchase
    // clan-page.js shows chat effects and sends the one worn; main.js also applies the monthly buffs (getHolyBoosts) and asks
    // for the worn click effect's burst where you click (spawnClickFloat; never for the Auto Clicker)
    const allowed = new Set(['premium.js', 'premium-panel.js', 'premium-cloud.js', 'world-actors.js', 'world-arena.js', 'world-online.js', 'main.js', 'clan-page.js']);
    for (const f of fs.readdirSync(ROOT).filter((x) => /\.(js|html)$/.test(x))) {
        const src = read(f);
        if (/WHBeans|WHPremium\b|whathappened_premium/.test(src) && !allowed.has(f) && !/^(index|world|clan)\.html$/.test(f)) assert.fail(f + ' uses Holy What Happeneds');
    }
    assert.match(read('world-actors.js'), /window\.WHBeans\.drawTrail\(ctx, p\)/);
    const mainUse = read('main.js').split('\n').filter((l) => /WHPremium|WHBeans/.test(l));
    assert.equal(mainUse.length, 4, 'main.js: four lines, the title colours, the monthly buffs, the click burst and a Holy code');
    assert.match(mainUse[0], /TITLE_RARITIES\[c\.name\] = c\.rarity/);
    assert.match(mainUse[1], /window\.WHBeans\.boosts\(\)/);
    assert.match(mainUse[2], /if \(!auto && window\.WHBeans && typeof window\.WHBeans\.clickFx === 'function'\) \{ try \{ window\.WHBeans\.clickFx\(x, y, crit\); \} catch \(e\) \{\} \}/);
    assert.match(mainUse[3], /const r = window\.WHBeans && typeof window\.WHBeans\.grantCode === 'function' \? await window\.WHBeans\.grantCode\(code, amt\) : null;/);
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

// ---------------- how Holy What Happeneds are earned ----------------
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
    const cheapest = Math.min(...P.CATALOG.filter((c) => !P.isRepeat(c)).map((c) => c.cost));
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
test('a purchase takes earned Holy What Happeneds first, then bought ones', () => {
    assert.deepEqual(P.planSpend(500, 0, 350), { ok: true, fromEarned: 350, fromPaid: 0, short: 0 });
    assert.deepEqual(P.planSpend(100, 1000, 350), { ok: true, fromEarned: 100, fromPaid: 250, short: 0 });
    assert.deepEqual(P.planSpend(100, 200, 350), { ok: false, fromEarned: 100, fromPaid: 250, short: 50 });
});

test('buying, wearing, and getting a purchase back from the account', () => {
    const s = P.fresh();
    s.earned = 400;
    assert.equal(P.completePurchase(s, 'th_heaven', 350, NOW), true);
    assert.equal(s.earned, 50);
    assert.equal(s.equip.theme, 'th_heaven');
    assert.equal(P.canBuy(s, 'th_heaven').reason, 'owned');
    assert.equal(P.completePurchase(s, 'th_heaven', 0, NOW), false, 'not twice');
    assert.equal(P.completePurchase(s, 'pop_halo', 200, NOW), false, 'not with Holy What Happeneds it doesn\'t have');
    assert.equal(P.canBuy(s, 'nope').reason, 'unknown');
    P.equip(s, 'th_heaven');
    assert.equal(s.equip.theme, '', 'equip again takes it off');
    assert.equal(P.equip(s, 'pop_halo'), false, 'not owned');
    const back = P.restoreFromSpends(s, [{ id: 'spend0001', item: 'pop_halo' }, { id: 'spend0002', item: 'th_heaven' }, { id: 'spend0003', item: 'gone' }]);
    assert.deepEqual(back.map((x) => x.id), ['pop_halo']);
    assert.deepEqual(P.restoreFromSpends(s, [{ id: 'spend0001', item: 'pop_halo' }]), [], 'each spend once');
});

test('a stored state is cleaned: unknown items, looks not owned and nonsense numbers are dropped', () => {
    const s = P.clean({ earned: -5, earnedTotal: 'x', owned: { th_heaven: true, gems_100: true, pop_halo: 'yes' }, equip: { theme: 'th_heaven', pop: 'pop_halo', trail: 'th_heaven' },
        grants: { 'ach:a': 2, evil: 5, 'wk:2026-W46': 4 }, log: [{ t: 1, n: 5, why: 'ok' }, { n: 'x' }], applied: ['spend0001', 'bad id!'], paid: { uid: 'u', balance: 9 } });
    assert.equal(s.earned, 0);
    assert.deepEqual(s.owned, { th_heaven: true });
    assert.deepEqual(s.equip, { theme: 'th_heaven', pop: '', aura: '', hat: '', accessory: '', chatfx: '', weapon: '', trail: '', head: '', back: '', tail: '', outfit: '' });
    assert.deepEqual(s.grants, { 'ach:a': 2, 'wk:2026-W46': 4 });
    assert.equal(s.log.length, 1);
    assert.deepEqual(s.applied, ['spend0001']);
    assert.deepEqual(P.clean('garbage'), P.fresh());
});

// ---------------- the spend rule (firestore-premium.rules) ----------------
test('the account\'s balance can only go down, by exactly the logged spend; nothing a browser writes can add Holy What Happeneds', () => {
    const before = { balance: 500, total: 500, updatedAt: 't' };
    const ok = (after, spend, id, existed) => P.checkWalletSpend(before, after, spend, id || 'spend0001', !!existed);
    const spend = (cost, extra) => Object.assign({ item: 'th_heaven', cost, at: 'request.time' }, extra);
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
test('buying opens only once the Ko-fi page, the worker and a way to buy are all filled in', () => {
    // whatever the owner has filled in so far, the switch follows the rule (and the page is a real Ko-fi address)
    const ways = Config.activeTipPacks().length + Config.activePacks().length + Config.rates(Config.donationRate).length + Config.rates(Config.subscriptionTiers).length;
    assert.equal(Config.buyingOpen(), !Config.isPlaceholder(Config.kofiPage) && !Config.isPlaceholder(Config.workerUrl) && ways > 0);
    assert.match(Config.kofiPage, /^https:\/\/ko-fi\.com\/[A-Za-z0-9_]+$/);
    // a page alone, with the worker still a placeholder and nothing to sell, keeps it closed
    const half = Object.assign({}, Config, { workerUrl: 'https://OWNER-WORKER.workers.dev', tipPacks: [], packs: [], donationRate: {}, subscriptionTiers: {} });
    assert.equal(Config.buyingOpen(half), false);
    const filled = Object.assign({}, Config, { kofiPage: 'https://ko-fi.com/whathappened', workerUrl: 'https://wh-kofi.x.workers.dev',
        packs: [{ code: 'abc123', beans: 100, name: 'n', price: 'p' }, { code: 'OWNER_X', beans: 5 }, { code: 'zz', beans: 1.5 }] });
    assert.equal(Config.buyingOpen(filled), true);
    assert.deepEqual(Config.activePacks(filled).map((p) => p.code), ['abc123']);
    assert.equal(Config.packByCode('ABC123', filled).beans, 100);
    assert.equal(Config.shopItemUrl('abc123'), 'https://ko-fi.com/s/abc123');
    // the Ko-fi link and prices live in this one file: no page hard-codes a Ko-fi address
    for (const f of fs.readdirSync(ROOT).filter((x) => /\.(js|html)$/.test(x))) assert.ok(!/ko-fi\.com\//i.test(read(f)) || f === 'premium-panel.js' && !/https:\/\/ko-fi\.com\/[A-Za-z]/.test(read(f)), f + ' has no Ko-fi address of its own');
});

test('tip packs: each pack\'s amount gives that pack, a bigger tip never gets a worse rate, other currencies get nothing', () => {
    const packs = Config.activeTipPacks();
    assert.ok(packs.length > 0, 'packs are set');
    assert.match(Config.tipCurrency, /^[A-Z]{3}$/);
    let rate = 0;
    for (const p of packs) {
        assert.ok(p.dollars >= 1, p.name + ': at least the $1 Ko-fi allows');
        assert.equal(Config.tipBeans(p.dollars, Config.tipCurrency), p.beans, p.name);
        assert.ok(p.beans / p.dollars >= rate, p.name + ': the rate never drops for a bigger pack');
        rate = p.beans / p.dollars;
    }
    // every amount from $1 to past the biggest pack: more money never gives fewer
    let last = 0;
    for (let cents = 100; cents <= (packs[packs.length - 1].dollars + 10) * 100; cents += 25) {
        const b = Config.tipBeans(cents / 100, Config.tipCurrency);
        assert.ok(b >= last, '$' + cents / 100 + ' gives at least as many as a little less');
        last = b;
    }
    assert.equal(Config.tipBeans(5, Config.tipCurrency === 'EUR' ? 'USD' : 'EUR'), 0);
    assert.equal(Config.tipBeans(0, Config.tipCurrency), 0);
    // the most one tip can give stays under the safety cap at a few hundred dollars
    assert.ok(Config.tipBeans(500, Config.tipCurrency) <= Config.maxBeansPerPayment);
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

test('Ko-fi payloads: normalised, test payment spotted, Holy What Happeneds worked out from the table', () => {
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

test('the earned-Holy What Happeneds state syncs with the account like other progress', () => {
    assert.ok(Progress.SYNC_KEYS.has('whathappened_premium'));
    assert.equal(Progress.isSyncKey('whathappened_premium'), true);
});

test('firestore.rules (the full rules to publish): every collection the game uses has a rule, and money is never on the open list', () => {
    const noComments = (s) => s.split('\n').filter((l) => !/^\s*\/\//.test(l)).join('\n');
    const rules = noComments(read('firestore.rules')); // the rules, not the comments
    assert.ok(!/match \/\{document=\*\*\}/.test(rules), 'no catch-all');
    const open = (/coll in \[([^\]]*)\]/.exec(rules) || [])[1];
    assert.ok(open, 'the open list is there');
    const openList = open.split(',').map((x) => x.trim().replace(/'/g, ''));
    for (const closed of ['wallets', 'kofi_links', 'kofi_payments', 'saves', 'codes']) {
        assert.ok(!openList.includes(closed), closed + ' is not open');
        assert.ok(new RegExp('match /' + closed + '/\\{').test(rules), closed + ' has its own rule');
    }
    // every top-level collection named in the game's code
    const used = new Set();
    const files = fs.readdirSync(ROOT).filter((f) => /\.(js|html)$/.test(f));
    for (const f of files) for (const m of read(f).matchAll(/(?:collection|doc)\(\s*[A-Za-z_.]*db\s*,\s*['"]([A-Za-z_]+)['"]/g)) used.add(m[1]);
    assert.ok(used.size >= 8, 'found the collections: ' + [...used].join(', '));
    for (const c of used) assert.ok(openList.includes(c) || new RegExp('match /' + c + '/\\{').test(rules), c + ' (used in the code) has a rule in firestore.rules');
    // the Holy What Happeneds part is the same as firestore-premium.rules
    const body = (s) => s.slice(s.indexOf('match /wallets/{uid}'), s.indexOf('match /kofi_payments/{txid}')).replace(/\s+/g, ' ');
    assert.equal(body(rules), body(noComments(read('firestore-premium.rules'))));
});
