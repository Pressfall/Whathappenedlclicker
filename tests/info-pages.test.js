// The help and info pages (how-to-play, wilds-guide, upgrades-followers-gems, faq, about): static, readable without
// JavaScript, linked from the game's footer and the sitemap, and their tables match the game's own data.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const ROOT = path.join(__dirname, '..');
const read = (f) => fs.readFileSync(path.join(ROOT, f), 'utf8');
const PAGES = ['how-to-play.html', 'wilds-guide.html', 'upgrades-followers-gems.html', 'faq.html', 'about.html'];
const SITE = 'https://whathappenedclicker.netlify.app/';
const text = (html) => html.replace(/<[^>]+>/g, ' ').replace(/&amp;/g, '&').replace(/&#39;/g, "'").replace(/\s+/g, ' ').trim();
const cells = (row) => [...row.matchAll(/<td[^>]*>([\s\S]*?)<\/td>/g)].map((m) => text(m[1]));
const rows = (html, tableId) => {
    const t = html.slice(html.indexOf(`<table id="${tableId}"`));
    return [...t.slice(0, t.indexOf('</table>')).matchAll(/<tr>([\s\S]*?)<\/tr>/g)].map((m) => cells(m[1])).filter((c) => c.length);
};
// an array literal from main.js, e.g. UPGRADE_NAMES
function mainArray(name) {
    const src = read('main.js');
    const start = src.indexOf(`const ${name} = [`) + `const ${name} = `.length;
    return vm.runInNewContext(src.slice(start, src.indexOf('];', start) + 1));
}

test('each page is plain HTML: a title, a description, real text, no scripts and nothing from Google ads', () => {
    for (const f of PAGES) {
        const html = read(f);
        assert.match(html, /<title>[^<]+— WHAT HAPPENED clicker<\/title>/, f);
        assert.match(html, /<meta name="description" content="[^"]{60,}">/, f);
        assert.ok(html.includes(`<link rel="canonical" href="${SITE}${f}">`), f + ' canonical');
        assert.match(html, /<h1>[^<]+<\/h1>/, f);
        assert.doesNotMatch(html, /<script/i, f + ': readable with JavaScript off, and loads nothing');
        assert.doesNotMatch(html, /adsbygoogle|consent\.js|googlesyndication/, f + ': no ads on the help pages');
        assert.doesNotMatch(html, /<form|mailto:/i, f + ': no contact form or invented email');
        const words = text(html.slice(html.indexOf('<main>'), html.indexOf('</main>'))).split(' ').length;
        assert.ok(words > 300, `${f}: ${words} words of content`);
        // the shared footer links every page, and marks this one
        for (const p of PAGES.concat('privacy.html')) assert.ok(html.includes(`<a href="${p}"`), `${f} links ${p}`);
        assert.ok(html.includes(`<a href="${f}" aria-current="page">`), f + ' marks itself');
    }
});

test('every link on the help pages goes to a file that exists (or an https site)', () => {
    for (const f of PAGES) {
        for (const [, href] of read(f).matchAll(/href="([^"]+)"/g)) {
            if (/^https:\/\//.test(href)) continue;
            const file = href.split('#')[0];
            if (!file) continue;
            assert.ok(fs.existsSync(path.join(ROOT, file)), `${f}: ${href}`);
        }
        // links to a part of a page go to an id that is there
        for (const [, file, id] of read(f).matchAll(/href="([\w-]*\.html)?#([\w-]+)"/g)) {
            assert.ok(read(file || f).includes(`id="${id}"`), `${f}: #${id} in ${file || f}`);
        }
    }
});

test('the game page footer links the help pages and the privacy policy, outside the ad area', () => {
    const html = read('index.html');
    const footer = html.slice(html.indexOf('<footer class="site-footer">'), html.indexOf('</footer>'));
    for (const p of PAGES.concat('privacy.html')) assert.ok(footer.includes(`<a href="${p}">`), 'footer links ' + p);
    const ad = html.slice(html.indexOf('<div id="adWrapper"'), html.indexOf('</div>', html.indexOf('<div id="adWrapper"')));
    for (const p of PAGES) assert.ok(!ad.includes(p), p + ' not inside the ad area');
    // the ad slot itself is untouched
    assert.equal((html.match(/<ins class="adsbygoogle"/g) || []).length, 1, 'still the one ad slot');
    assert.ok(html.includes('data-ad-slot="1234567890"'));
});

test('sitemap.xml lists every public page, each one exists, and robots.txt points to it', () => {
    const xml = read('sitemap.xml');
    const locs = [...xml.matchAll(/<loc>([^<]+)<\/loc>/g)].map((m) => m[1]);
    for (const p of PAGES.concat('privacy.html')) assert.ok(locs.includes(SITE + p), 'sitemap has ' + p);
    assert.ok(locs.includes(SITE), 'sitemap has the game');
    for (const loc of locs) {
        assert.ok(loc.startsWith(SITE), loc);
        const file = loc.slice(SITE.length) || 'index.html';
        assert.ok(fs.existsSync(path.join(ROOT, file)), loc);
    }
    assert.match(read('robots.txt'), new RegExp('^Sitemap: ' + SITE + 'sitemap\\.xml$', 'm'));
    assert.doesNotMatch(read('robots.txt'), /^Disallow: \/$/m, 'the site is not hidden');
});

test('the upgrade table matches the game: names, first-level prices and income per level', () => {
    const names = mainArray('UPGRADE_NAMES'), costs = mainArray('UPGRADE_BASE_COSTS'), cps = mainArray('UPGRADE_CPS'), S = mainArray('NUMBER_SUFFIXES');
    const fmt = (n) => {
        if (n < 1000) return Math.round(n).toLocaleString('en-US');
        const e = Math.floor(Math.log10(n) + 1e-9), i = Math.floor(e / 3) - 1;
        return +(n / Math.pow(10, 3 * (i + 1))).toPrecision(3) + S[i];
    };
    const table = rows(read('upgrades-followers-gems.html'), 'upgradeTable');
    assert.equal(table.length, names.length - 1, 'one row per upgrade');
    table.forEach((r, k) => {
        const i = k + 1;
        assert.deepEqual(r, [String(i), names[i], fmt(costs[i]), fmt(cps[i]) + (i === 1 ? ' click power' : ' CPS'), i <= 10 ? '10%' : '15%'], 'upgrade ' + i);
    });
});

test('the follower pack and lootbox tables match the game', () => {
    const w = { localStorage: { getItem: () => null, setItem() {} } };
    w.window = w;
    vm.createContext(w);
    vm.runInContext(read('followers-data.js'), w);
    const html = read('upgrades-followers-gems.html');
    const packs = rows(html, 'packTable');
    const dur = (ms) => (ms < 3600000 ? ms / 60000 + ' min' : ms / 3600000 + ' h');
    assert.equal(packs.length, w.WHF.PACKS.length);
    w.WHF.PACKS.forEach((p, i) => assert.deepEqual(packs[i], [p.icon + ' ' + p.name, String(p.cost), String(p.count), dur(p.cooldown), p.desc], p.name));
    assert.ok(text(html).includes(w.WHF.SLOT_COSTS.slice(0, -1).join(', ') + ' and ' + w.WHF.SLOT_COSTS.slice(-1) + ' Golden'), 'team slot prices');
    assert.ok(text(html).includes(`open ${w.WHF.PITY_LIMIT} followers in a row`), 'pity');

    const items = read('items.js');
    const block = items.slice(items.indexOf('const BOXES = ['), items.indexOf('];', items.indexOf('const BOXES = [')));
    const boxes = [...block.matchAll(/^\s*\{ id: '\w+', name: '([^']+)'.*?rolls: (\d+).*?price: (null|\d+)/gm)].map((m) => ({ name: m[1], rolls: m[2], price: m[3] }));
    const table = rows(html, 'boxTable');
    assert.equal(table.length, boxes.length);
    boxes.forEach((b, i) => {
        assert.equal(table[i][0], b.name);
        assert.equal(table[i][1], b.rolls, b.name + ' items');
        assert.equal(table[i][3], b.price === 'null' ? 'Not sold' : Number(b.price).toLocaleString('en-US'), b.name + ' price');
    });
    assert.match(items, /SLOT_COSTS = \{ 4: 40, 5: 120 \}/, 'charm slot prices on the page');
    assert.match(items, /LURE = \{ cost: 15, ms: 15 \* 60000, mult: 3 \}/, 'lure on the page');
});

test('the pages say what they must: no real-money purchase, Discord as the contact, the Wilds limits', () => {
    const t = (f) => text(read(f));
    assert.match(t('upgrades-followers-gems.html'), /There is no real-money purchase anywhere in the game\./);
    assert.match(t('faq.html'), /There are no real-money purchases/);
    const invite = read('index.html').match(/https:\/\/discord\.gg\/\w+/)[0];
    for (const f of ['about.html', 'faq.html']) assert.ok(read(f).includes(`href="${invite}"`), f + ' uses the Discord invite from Settings');
    const D = require('../core/world-data');
    const g = t('wilds-guide.html');
    assert.ok(g.includes(`at most ${D.CAPS.gemsPerDay} gems and ${D.CAPS.goldenPerDay} Golden What Happened a day`), 'daily caps');
    assert.ok(g.includes(`${D.CAPS.exchange.gems.cost.toLocaleString('en-US')} rubies for ${D.CAPS.exchange.gems.gems} gems`), 'gem exchange');
    assert.ok(g.includes(`${D.CAPS.exchange.golden.cost.toLocaleString('en-US')} rubies for ${D.CAPS.exchange.golden.golden} Golden`), 'Golden exchange');
    for (const [id, c] of Object.entries(D.CLASSES)) {
        assert.ok(g.includes(c.name), c.name);
        if (c.unlock && c.unlock.text) assert.ok(g.includes(c.unlock.text), c.name + ' challenge');
    }
    // the zones table: every zone in order, with its tier and boss
    const zones = rows(read('wilds-guide.html'), 'zones-table');
    assert.deepEqual(zones.map(r => [r[0], Number(r[1]), r[2]]), D.ZONE_ORDER.map(z => [D.ZONES[z].name, D.ZONES[z].tier, D.BOSSES[D.ZONES[z].boss].name]));
    for (const z of D.ZONE_ORDER) assert.ok(/the (west|north|east|south) gate|the Waystone/.test(zones[D.ZONE_ORDER.indexOf(z)][3]) && (D.ZONES[z].via === 'waystone') === /Waystone/.test(zones[D.ZONE_ORDER.indexOf(z)][3]), z + ' says how to get in');
    // the Arena's ranks and stakes
    const Ar = require('../core/world-arena');
    assert.deepEqual(rows(read('wilds-guide.html'), 'ranks-table').map(r => [r[0], Number(r[1].replace(/,/g, ''))]), Ar.RANKS.map(r => [r.name, r.min]));
    const stakes = Ar.RULES.stakes.filter(Boolean);
    assert.ok(g.includes(`${stakes[0].toLocaleString('en-US')} to ${stakes.at(-1).toLocaleString('en-US')} rubies each`), 'stakes');
    for (const z of D.ZONE_ORDER.filter(id => D.ZONES[id].wards)) assert.ok(g.includes(D.TIERS[D.ZONES[z].tier + 1].name), D.TIERS[D.ZONES[z].tier + 1].name + ' gear is named');
    // the crew from the clicker: who, from which level of their upgrade; and what Renown counts
    const Crew = require('../core/world-crew'), Ren = require('../core/renown');
    assert.deepEqual(rows(read('wilds-guide.html'), 'crew-table').map(r => [r[0], Number(r[1])]), Crew.CREW.map(c => [c.name, c.arrive]));
    for (const r of rows(read('wilds-guide.html'), 'crew-table')) assert.equal(/Quests only/.test(r[2]), !Crew.CREW.find(c => c.name === r[0]).service, r[0] + ': service');
    assert.deepEqual(rows(read('wilds-guide.html'), 'renown-table').map(r => [r[0] === 'Clicker' ? 'clicker' : 'wilds', r[1], Number(r[2])]), Ren.SOURCES.map(s => [s.game, s.label, s.cap]));
    assert.ok(g.includes(`+${Ren.PER_LEVEL.cps}% CPS and click power`) && g.includes(`+${Ren.PER_LEVEL.rubies}% rubies`), 'what a level of Renown gives');
    assert.ok(g.includes('Renown ' + Ren.MAX_LEVEL) && g.includes('Every ' + (Ren.MILESTONES[1].level - Ren.MILESTONES[0].level) + ' levels'), 'the top and the milestones');
    // hero guilds and the Glory shop's Guild Chest
    const Gu = require('../core/world-guilds');
    assert.ok(g.includes(`${Gu.STOCK_SIZE} guild charters`) && g.includes(`+${Gu.PER_GUILD * 100}%`) && g.includes(`all ${Gu.GUILDS.length} upgrades`), 'guilds');
    assert.ok(g.includes(`${Ar.SHOP_BY_ID.guild_chest.glory.toLocaleString('en-US')} Glory`), 'the Guild Chest');
    assert.ok(g.includes(`at most ${D.RULES.potionsPerMatch} potions per match`), 'the potion limit');
    // the hidden room in the Hall of Gods stays a secret
    const WORD = Buffer.from('YnJpbGV5aXNt', 'base64').toString();
    assert.ok(!g.toLowerCase().includes(WORD), 'the Wilds guide does not give away the secret');
});

test('the privacy policy says where ads can appear, as the code does', () => {
    const t = text(read('privacy.html'));
    assert.doesNotMatch(t, /on the game, achievements, casino and leaderboard pages/, 'the old claim of ads on four pages');
    assert.match(t, /There is one place for an ad: a banner on the game page\./);
    // pages that load consent.js are the ones that can load the AdSense code after Accept
    const withConsent = fs.readdirSync(ROOT).filter((f) => f.endsWith('.html') && read(f).includes('<script src="core/consent.js">'));
    assert.deepEqual(withConsent.sort(), ['achievements.html', 'gamba.html', 'index.html', 'leaderboard.html', 'privacy.html']);
    assert.match(t, /the AdSense code is also loaded on the achievements, casino and leaderboard pages and on this page/);
});

test('no tip links for now (Ko-fi was taken out until there is a real page), and no placeholder left behind', () => {
    const html = read('index.html');
    assert.ok(!/ko-fi\.com/i.test(html), 'no Ko-fi link on the game page');
    for (const f of PAGES.concat('index.html', 'privacy.html')) assert.ok(!read(f).includes('YOUR_KOFI_NAME'), f + ': no placeholder address');
    // tips unlock nothing: no game code knows about them
    for (const f of ['main.js', 'items.js', 'followers.js', 'gamba.js', 'world.js', 'world-ui.js', 'clan.html', 'world.html'])
        assert.ok(!/ko-?fi|support the game/i.test(read(f)), f + ' does not mention tips'); // ("donated" in clan.html is clan points)
});
