/**
 * Hero guilds: one for each of the clicker's 29 upgrades ("heroes"), only to be had in the Wilds. Loaded by both pages:
 * - world.html: the Guildmaster by the Rune Altar has 6 guilds in stock, a new stock every two days (at local
 *   midnight). Each guild costs a lot (rubies and its zone's materials) and has a contract (a quest) that must be taken and
 *   finished before it can be bought. Once bought, that guild is out of stock until the stock changes. There is no limit
 *   on how many of one guild you own. The Arena's Glory shop also sells a Guild Chest: one guild at random.
 *   The count of each guild lives in the Wilds save (`guilds.owned`), written only by world.html.
 * - index.html: main.js reads those counts (like the Hall of Gods' statues): every guild adds 25% to its own upgrade's
 *   CPS (OP mouse: its click power), and the upgrade's button takes on the guild's colours and crest.
 *
 * Works in a browser (<script src="core/world-guilds.js"> sets window.WHGuilds) and in Node (require).
 */
(function (root, factory) {
    if (typeof module === 'object' && module.exports) module.exports = factory();
    else root.WHGuilds = factory();
}(typeof self !== 'undefined' ? self : this, function () {
    'use strict';

    const PER_GUILD = 0.25;      // +25% to the upgrade's own CPS per guild owned
    const STOCK_SIZE = 6;        // guilds in stock at once
    const PERIOD_DAYS = 2;       // a new stock every two days, at local midnight
    const OWN_MAX = 999;         // only what a damaged or edited save is cut down to
    const ZONES = ['greenwood', 'mines', 'ember', 'frost', 'coast', 'storm', 'ruins', 'sky'];

    // up: the clicker upgrade (1..29) and hero: its name there (main.js UPGRADE_NAMES; tests/world-guilds.test.js keeps
    // them the same). crest: the emblem on its button. color: the button's trim.
    const GUILDS = [
        { up: 1, hero: 'OP mouse', name: 'Guild of the Final Click', crest: '🖱️', color: '#5ee7ff' },
        { up: 2, hero: 'Somalian Pirate', name: 'Black Sail Brotherhood', crest: '🏴‍☠️', color: '#3fa9f5' },
        { up: 3, hero: 'Goonsaw Man', name: 'Chainsaw Choir Lodge', crest: '🪚', color: '#ff7a2f' },
        { up: 4, hero: 'Diddy blud', name: 'Order of the Blud', crest: '🧢', color: '#a77dff' },
        { up: 5, hero: 'Argonian Autist', name: 'Hist-Sap Covenant', crest: '🦎', color: '#43c46b' },
        { up: 6, hero: 'Grape God', name: 'Vineyard Synod', crest: '🍇', color: '#8e44ad' },
        { up: 7, hero: 'Skippie Toilet', name: 'Order of the Golden Throne', crest: '🚽', color: '#ffc83d' },
        { up: 8, hero: 'Mysterious Island', name: 'Castaway Compact', crest: '🏝️', color: '#2ec4b6' },
        { up: 9, hero: 'Tribal Camp', name: 'Totem Circle', crest: '🪵', color: '#b5733a' },
        { up: 10, hero: 'The Phonk Man', name: 'Memphis Collective', crest: '🎧', color: '#9b59ff' },
        { up: 11, hero: 'Jonathan', name: 'Spreadsheet Society', crest: '📊', color: '#6d8fb5' },
        { up: 12, hero: 'CR lurker', name: 'Army of Lurkers', crest: '👀', color: '#7f8c8d' },
        { up: 13, hero: 'ropingnecurse', name: 'Knot of Binding', crest: '🪢', color: '#c0392b' },
        { up: 14, hero: 'skibbidi scimitar', name: 'Fellowship of the Scimitar', crest: '⚔️', color: '#d4a24a' },
        { up: 15, hero: 'What Happened Beats', name: "Beatmakers' Guild", crest: '🥁', color: '#ff5bd0' },
        { up: 16, hero: 'ez villager', name: 'Emerald Trading Hall', crest: '💚', color: '#2fd07a' },
        { up: 17, hero: 'scp wish I knew.', name: 'Containment Cell Nine', crest: '🧪', color: '#e74c3c' },
        { up: 18, hero: 'The Goatis', name: 'Order of the Goatis', crest: '🐐', color: '#e0c38c' },
        { up: 19, hero: 'goatises raw liver', name: 'Raw Liver Lodge', crest: '🥩', color: '#b03a48' },
        { up: 20, hero: 'The Landon Stream', name: 'Respectful Congregation', crest: '🙏', color: '#f5e6c8' },
        { up: 21, hero: 'The Bass', name: 'Kings of the Lake', crest: '🐟', color: '#3f86c8' },
        { up: 22, hero: 'Good Noodles', name: 'Noodle Brotherhood', crest: '🍜', color: '#f0b429' },
        { up: 23, hero: 'Mobile Man 38', name: 'Tower 38 Syndicate', crest: '📱', color: '#95a5a6' },
        { up: 24, hero: 'Easton Bundy', name: 'The Bundy Empire', crest: '🏛️', color: '#c9a34a' },
        { up: 25, hero: 'Tom Pearl', name: 'Order of the Pearl', crest: '🦪', color: '#e8f4ff' },
        { up: 26, hero: 'Hypergamy', name: 'Circle of the Diagram', crest: '📈', color: '#ff9a1f' },
        { up: 27, hero: 'Evil Somalian Pirate', name: 'Scourge of the Gulf', crest: '☠️', color: '#5a1a1a' },
        { up: 28, hero: "O'algo", name: 'Philosopher Kings', crest: '🎓', color: '#7b5cff' },
        { up: 29, hero: 'Siberian Hitman', name: 'Last Contract Bureau', crest: '🎯', color: '#9fb4c7' },
    ];
    const BY_UP = Object.fromEntries(GUILDS.map(g => [g.up, g]));
    const UPS = GUILDS.map(g => g.up);

    // ---------------- what a guild takes ----------------
    // A guild's tier (1..8) follows its upgrade: the later the hero, the further out its zone, the dearer it is
    function tierOf(up) { return Math.max(1, Math.min(8, Math.ceil(up / 29 * 8))); }
    function zoneOf(up) { return ZONES[tierOf(up) - 1]; }
    // rubies by tier, and two of the zone's own materials
    const RUBIES = [0, 3000, 5000, 8000, 12000, 18000, 26000, 36000, 50000];
    const ZONE_MATS = {
        greenwood: { oak_plank: 20, slime_gel: 10 }, mines: { iron_bar: 12, bat_wing: 10 }, ember: { obsidian: 10, magma_shell: 6 },
        frost: { frost_crystal: 8, wolf_pelt: 8 }, coast: { coral: 10, pearl: 3 }, storm: { storm_glass: 10, volt_core: 4 },
        ruins: { ash_stone: 10, knight_crest: 4 }, sky: { celestite: 10, cloud_silk: 8 },
    };
    function priceOf(up) { const t = tierOf(up); return { rubies: RUBIES[t], mats: Object.assign({}, ZONE_MATS[ZONES[t - 1]]) }; }
    // A guild's contract: one of four kinds (by the upgrade), always in its own zone, which must be open to take it
    const BOSS_OF = { greenwood: 'overgrown', mines: 'gilded', ember: 'inferno', frost: 'frozen', coast: 'tidal', storm: 'tempest', ruins: 'void_wh', sky: 'vrill' };
    function contractOf(up) {
        const g = BY_UP[up], z = zoneOf(up), t = tierOf(up);
        if (!g) return null;
        const kinds = [
            { goal: { kind: 'kill', zone: z, n: 30 + 5 * t }, text: 'Show the guild you can hold a road: clear out monsters in its zone.' },
            { goal: { kind: 'kill', elite: true, zone: z, n: 2 + Math.floor(t / 3) }, text: 'The guild only takes members who have brought down the big ones.' },
            { goal: { kind: 'boss', boss: BOSS_OF[z], n: 1 }, text: 'Every member has stood in front of the zone\'s great boss and walked away. Your turn.' },
            { goal: { kind: 'harvest', zone: z, n: 25 + 5 * t }, text: 'The guild hall needs building: gather in its zone, ore, wood or plants.' },
        ];
        const k = kinds[up % kinds.length];
        return { up, title: 'Contract: ' + g.name, text: k.text, goal: k.goal, need: { zone: z } };
    }

    // ---------------- the stock ----------------
    function hashStr(str) { let h = 2166136261 >>> 0; for (let i = 0; i < str.length; i++) { h ^= str.charCodeAt(i); h = Math.imul(h, 16777619) >>> 0; } return h; }
    function mulberry32(a) { return function () { a |= 0; a = a + 0x6D2B79F5 | 0; let t = Math.imul(a ^ a >>> 15, 1 | a); t = t + Math.imul(t ^ t >>> 7, 61 | t) ^ t; return ((t ^ t >>> 14) >>> 0) / 4294967296; }; }
    // Which stock it is: a block of two local days, counted from the start of the calendar (the same for everyone in a
    // time zone). Two days at a time, so it changes at local midnight every second day.
    function dayNumber(d) { return Math.round(Date.UTC(d.getFullYear(), d.getMonth(), d.getDate()) / 86400000); }
    function periodOf(now) { return 'd' + Math.floor(dayNumber(new Date(now)) / PERIOD_DAYS); }
    // when the stock changes next (local midnight, one or two days on)
    function nextRestockAt(now) {
        const d = new Date(now), n = dayNumber(d);
        const left = (Math.floor(n / PERIOD_DAYS) + 1) * PERIOD_DAYS - n;
        return new Date(d.getFullYear(), d.getMonth(), d.getDate() + left, 0, 0, 0, 0).getTime();
    }
    // The 6 guilds in stock for a period: the same for everyone, picked at random from all 29 (seeded by the period)
    const stockCache = new Map(); // the page asks every frame (the Guildmaster's mark)
    function stockFor(period) {
        if (stockCache.has(period)) return stockCache.get(period).slice();
        const rng = mulberry32(hashStr('wh-guilds:' + period));
        const pool = UPS.slice();
        for (let i = pool.length - 1; i > 0; i--) { const j = Math.floor(rng() * (i + 1)); [pool[i], pool[j]] = [pool[j], pool[i]]; }
        const out = pool.slice(0, STOCK_SIZE).sort((a, b) => a - b);
        if (stockCache.size > 8) stockCache.clear();
        stockCache.set(period, out);
        return out.slice();
    }

    // ---------------- owning them ----------------
    const whole = (v) => Math.max(0, Math.min(OWN_MAX, Math.floor(Number(v) || 0)));
    // { [up]: count } from anything stored: only real guilds, whole counts
    function cleanOwned(raw) {
        const out = {};
        if (!raw || typeof raw !== 'object') return out;
        for (const k in raw) { const up = Number(k); if (BY_UP[up]) { const n = whole(raw[k]); if (n) out[up] = n; } }
        return out;
    }
    // the counts from a parsed Wilds save (the game reads it this way)
    function ownedFrom(worldSave) { return cleanOwned(worldSave && worldSave.guilds && worldSave.guilds.owned); }
    // what an upgrade's CPS (OP mouse: click power) is multiplied by
    function multFor(owned, up) { return 1 + PER_GUILD * whole(owned && owned[up]); }
    function total(owned) { return Object.keys(owned || {}).reduce((a, k) => a + whole(owned[k]), 0); }

    return { PER_GUILD, STOCK_SIZE, PERIOD_DAYS, OWN_MAX, GUILDS, BY_UP, UPS, ZONE_MATS, RUBIES,
        tierOf, zoneOf, priceOf, contractOf, periodOf, nextRestockAt, stockFor, cleanOwned, ownedFrom, multFor, total };
}));
