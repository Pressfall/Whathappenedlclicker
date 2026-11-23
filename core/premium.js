/**
 * Holy What Happeneds 👼: the premium currency, the pure part (no page, no Firebase). premium.js and premium-panel.js are the pages' side,
 * premium-cloud.js the account's side, kofi-worker/ the server that credits bought Holy What Happeneds.
 *
 * TWO POOLS, ONE NAME
 * - Earned Holy What Happeneds come from playing (EARN below). They live in localStorage whathappened_premium with the rest of this
 *   state, synced to the account like every other progress key (core/progress.js SYNC_KEYS). Like gems, the browser is
 *   trusted with them: a player who edits their storage only changes their own game.
 * - Bought Holy What Happeneds come only from a Ko-fi payment, credited by the worker into Firestore wallets/{uid}. No browser can add
 *   to that balance (firestore-premium.rules): it can only take Holy What Happeneds off it, in the same write that logs what they paid
 *   for (wallets/{uid}/spends). checkWalletSpend() below is that rule, written out so it can be tested here.
 * - The balance shown is the two together. A purchase takes earned Holy What Happeneds first and the rest from the account; the
 *   account's part is taken first (a Firestore transaction), and only then the earned part and the item, so a failed
 *   or refused write costs nothing. A purchase that used bought Holy What Happeneds is in the account's spends log, so it comes back
 *   on any device signed in to the account (restoreFromSpends).
 *
 * WHAT THEY BUY (CATALOG): looks (titles, themes, click numbers, clicker auras; in the Wilds weapon skins, trails, a halo or
 * wings, which everyone there sees), and, with no limit (the owner's choice on 2026-11-20), gem packs, Golden What Happeneds,
 * timelapses (hours of income at once) and boost bundles from the Items menu (no random ones). The owner chose on 2026-11-10
 * that bought ones may trade for gems and Golden too, knowing gems and Golden can then be spent on lootboxes (random
 * contents) and in the casino. Never lootboxes, follower packs, rubies or Glory directly, and never anything the game gives
 * for free today. tests/premium.test.js holds that line.
 *
 * WHERE EARNED ONES COME FROM (EARN): worked out from the saves the game already keeps, never from a hook in the code
 * that pays them, so each one is paid once whichever page notices first (grant ids, e.g. 'ach:x_golden_10', 'boss:tidal',
 * 'wk:2026-W46'). The first time a save sees Holy What Happeneds, what it had already done pays at most EARN.retroCap.
 *
 * Works in a browser (<script src="core/premium.js"> after core/premium-config.js sets window.WHPremium) and in Node.
 */
(function (root, factory) {
    if (typeof module === 'object' && module.exports) module.exports = factory(require('./premium-config'));
    else root.WHPremium = factory(root.WHPremiumConfig);
}(typeof self !== 'undefined' ? self : this, function (Config) {
    'use strict';

    const KEY = 'whathappened_premium';
    const CUR = Config.currency;
    const LOG_MAX = 30, APPLIED_MAX = 200, EARNED_MAX = 1e7;

    // ---------------- what Holy What Happeneds buy ----------------
    // Owned once and switched on and off freely (looks), one of each kind at a time:
    // - the game page: title (added to the game's titles; next to your name in chat and on the leaderboard), theme (the page's
    //   colours), aura (around the What Happened you click), pop (a burst where you click, and the look of the "+N" that floats up), hat and accessory
    //   (worn by the What Happened you click: one of each at a time, together), chatfx (how your chat messages look, to everyone: index.html sends its id with each one)
    // - the Wilds, seen by everyone there (core/world-online.js packLooks shares them): weapon (a skin on whatever weapon you
    //   hold, with its own effect where it hits), trail (behind you), head (a halo, horns, a hat or a helmet), back (wings),
    //   tail, outfit (over your armour)
    // Bought again and again, with no limit (the owner's choice, 2026-11-20). Only on the game page, since they go into its
    // saves: gems (packs, bigger ones with a bonus: main.js addGems), golden (Golden What Happeneds: GOLDEN.mult times what
    // the next prestige would give, at least GOLDEN.min: main.js getPotentialPrestigeAwards / addGolden), timelapse (hours of
    // the income at once, main.js addCpsSeconds, and the follower nursery's eggs and pack cooldowns move on as far:
    // followers-data.js skipTime) and bundle (timed boosts for the Items menu, items.js grantItems; only ids
    // core/world-bridge.js ITEMS allows, which are never gems, Golden or lootboxes). And on either page: buff (2x click power,
    // 2x CPS, 2x offline earnings or +10% crit chance for `days` days, kept in this state; buying it again adds the days;
    // main.js applies buffMults through getHolyBoosts).
    const KINDS = ['gems', 'golden', 'timelapse', 'bundle', 'buff', 'title', 'theme', 'aura', 'pop', 'hat', 'accessory', 'chatfx', 'weapon', 'trail', 'head', 'back', 'tail', 'outfit'];
    const REPEAT_KINDS = ['gems', 'golden', 'timelapse', 'bundle', 'buff'];
    const GEM_RATE = 10;                    // gems for one Holy What Happened in the smallest pack; bigger packs add a bonus
    const GOLDEN = { mult: 3, min: 15 };    // Golden: 3x the next prestige's, never fewer than 15
    const BUFF_MAX_DAYS = 366;              // a buff bought again and again runs at most this far ahead
    // what each buff does while it runs; an item's buff is one of these, or 'all' (click, cps and offline together)
    const BUFF_EFFECT = { click: { mult: 2 }, cps: { mult: 2 }, offline: { mult: 2 }, crit: { pp: 10 } };
    const BUFF_KEYS = Object.keys(BUFF_EFFECT);
    const buffKeys = (it) => (it && it.kind === 'buff' ? (it.buff === 'all' ? ['click', 'cps', 'offline'] : [it.buff]) : []);
    const HOUR = 3600;
    // A weapon skin's hit: bursts of particles where it lands, [colour, count, speed, life (s), size, gravity] each
    // (world-actors.js skinHitFx; other players see yours where you hit them).
    const CATALOG = [
        { id: 'g_handful', kind: 'gems', name: 'Handful of Gems', cost: 5, gems: 50, desc: 'For the Treasury, skins, music and everything else gems buy.' },
        { id: 'g_stack', kind: 'gems', name: 'Stack of Gems', cost: 25, gems: 275, desc: 'A stack for the Treasury, with 25 bonus gems.' },
        { id: 'g_pile', kind: 'gems', name: 'Pile of Gems', cost: 50, gems: 600, desc: 'A pile for the Treasury, with 100 bonus gems.' },
        { id: 'g_hoard', kind: 'gems', name: 'Hoard of Gems', cost: 100, gems: 1300, desc: 'A hoard for the Treasury, with 300 bonus gems.' },
        { id: 'g_mountain', kind: 'gems', name: 'Mountain of Gems', cost: 250, gems: 3500, desc: 'The best value: 1,000 bonus gems.' },
        { id: 'x_golden', kind: 'golden', name: 'Golden What Happeneds', cost: 40, desc: 'For Divine upgrades, followers and everything else Golden buys.' },
        { id: 'tl_1h', kind: 'timelapse', name: '1 Hour Timelapse', cost: 10, sec: HOUR, desc: 'Skip ahead an hour: its income now, and eggs and pack cooldowns an hour on.' },
        { id: 'tl_4h', kind: 'timelapse', name: '4 Hour Timelapse', cost: 35, sec: 4 * HOUR, desc: 'Skip ahead four hours: income, eggs and pack cooldowns.' },
        { id: 'tl_12h', kind: 'timelapse', name: '12 Hour Timelapse', cost: 90, sec: 12 * HOUR, desc: 'Skip ahead half a day: income, eggs and pack cooldowns.' },
        { id: 'tl_24h', kind: 'timelapse', name: '24 Hour Timelapse', cost: 160, sec: 24 * HOUR, desc: 'Skip ahead a whole day: income, eggs and pack cooldowns.' },
        { id: 'bf_click', kind: 'buff', name: 'Monthly 2× Clicks', cost: 250, buff: 'click', days: 30, desc: 'Double click power for 30 days.' },
        { id: 'bf_cps', kind: 'buff', name: 'Monthly 2× CPS', cost: 250, buff: 'cps', days: 30, desc: 'Double What Happeneds per second for 30 days.' },
        { id: 'bf_offline', kind: 'buff', name: 'Monthly 2× Offline', cost: 150, buff: 'offline', days: 30, desc: 'Double what the crew earns while you are away, for 30 days.' },
        { id: 'bf_crit', kind: 'buff', name: 'Monthly Lucky Streak', cost: 200, buff: 'crit', days: 30, desc: '+10% crit chance on every click for 30 days.' },
        { id: 'bf_all', kind: 'buff', name: 'Monthly 2× Everything', cost: 550, buff: 'all', days: 30, desc: 'Double clicks, CPS and offline earnings for 30 days. Cheaper than all three.' },
        { id: 'bf_click_w', kind: 'buff', name: 'Weekly 2× Clicks', cost: 75, buff: 'click', days: 7, desc: 'Double click power for a week.' },
        { id: 'bf_cps_w', kind: 'buff', name: 'Weekly 2× CPS', cost: 75, buff: 'cps', days: 7, desc: 'Double What Happeneds per second for a week.' },
        { id: 'b_rush', kind: 'bundle', name: 'Holy Rush', cost: 10, items: { energyDrink: 2, spareBattery: 2, loadedDice: 1 }, desc: '2 Energy Drinks, 2 Spare Batteries and a Loaded Dice: short bursts of double clicks, double income and crits.' },
        { id: 'b_lucky', kind: 'bundle', name: 'Lucky Dice', cost: 15, items: { loadedDice: 5 }, desc: '5 Loaded Dice: two minutes of +10% crit chance each.' },
        { id: 'b_time', kind: 'bundle', name: 'Time Traveler', cost: 22, items: { hourglass: 2, pocketWatch: 3 }, desc: '2 Hourglasses and 3 Pocket Watches: hours of income, whenever you like.' },
        { id: 'b_frenzy', kind: 'bundle', name: 'Frenzy Pack', cost: 25, items: { frenzyPotion: 3, overclockChip: 2 }, desc: '3 Frenzy Potions (10× clicks) and 2 Overclock Chips (5× CPS).' },
        { id: 'b_singularity', kind: 'bundle', name: 'Singularity', cost: 30, items: { singularity: 1 }, desc: 'One minute of 25× clicks and CPS at once.' },
        { id: 'b_mega', kind: 'bundle', name: 'Mega Rush', cost: 40, items: { energyDrink: 5, spareBattery: 5, overclockChip: 2, frenzyPotion: 2 }, desc: 'A big box of boosts: 5 Energy Drinks, 5 Spare Batteries, 2 Overclock Chips, 2 Frenzy Potions.' },
        { id: 't_acolyte', kind: 'title', name: 'Acolyte of What', cost: 100, rarity: 'rare', desc: 'A title. Every saint starts by clicking.' },
        { id: 't_haloed', kind: 'title', name: 'Haloed', cost: 250, rarity: 'epic', desc: 'A title. Your name, lit from above.' },
        { id: 't_saint', kind: 'title', name: 'Saint of the Click', cost: 400, rarity: 'epic', desc: 'A title for the most faithful clicker.' },
        { id: 't_archangel', kind: 'title', name: 'Archangel of What', cost: 600, rarity: 'legendary', desc: 'A title. The highest choir sings your name.' },
        { id: 'th_heaven', kind: 'theme', name: 'Heavenly', cost: 350, swatch: ['#fff1b8', '#c9a24a'], desc: 'The game page in soft gold and sky.' },
        { id: 'th_sanctum', kind: 'theme', name: 'Sanctum', cost: 350, swatch: ['#b48cff', '#ffd27a'], desc: 'The game page in temple violet and gold.' },
        { id: 'th_dawn', kind: 'theme', name: 'First Light', cost: 350, swatch: ['#ffd1b3', '#e07a52'], desc: 'The game page in the colours of dawn.' },
        { id: 'th_stained', kind: 'theme', name: 'Stained Glass', cost: 350, swatch: ['#5fb4ff', '#ff6b8a'], desc: 'The game page in cathedral blues and reds.' },
        { id: 'th_inferno', kind: 'theme', name: 'Inferno', cost: 350, swatch: ['#ff6a2a', '#5a0d0d'], desc: 'The game page in embers and smoke.' },
        { id: 'th_frost', kind: 'theme', name: 'Frostbound', cost: 350, swatch: ['#bfe9ff', '#2f6f9f'], desc: 'The game page in ice and winter sky.' },
        { id: 'th_void', kind: 'theme', name: 'Void', cost: 350, swatch: ['#8a5cff', '#0a0614'], desc: 'The game page in the deep violet dark.' },
        { id: 'th_neon', kind: 'theme', name: 'Neon Night', cost: 350, swatch: ['#3dfcff', '#ff3dd8'], desc: 'The game page in city lights.' },
        { id: 'th_verdant', kind: 'theme', name: 'Verdant', cost: 350, swatch: ['#7ee08a', '#1f4d2b'], desc: 'The game page in forest greens.' },
        { id: 'pop_feather', kind: 'pop', name: 'Feather', cost: 200, swatch: ['#ffffff', '#b9a77a'], desc: 'Feathers puff out where you click and drift down, and your click numbers glow soft white.' },
        { id: 'pop_halo', kind: 'pop', name: 'Halo', cost: 200, swatch: ['#ffe9a3', '#ffcf3a'], desc: 'A golden halo and sparkles where you click, and your click numbers glow gold.' },
        { id: 'pop_choir', kind: 'pop', name: 'Choir', cost: 200, swatch: ['#e8f4ff', '#b48cff'], desc: 'Ripples of song and rising notes where you click, and your click numbers glow like a hymn.' },
        { id: 'au_halo', kind: 'aura', name: 'Halo', cost: 300, swatch: ['#fff3b0', '#e6b93a'], desc: 'A golden halo floats over the What Happened you click.' },
        { id: 'au_glow', kind: 'aura', name: 'Holy Glow', cost: 300, swatch: ['#fffbe0', '#ffd66e'], desc: 'Soft holy light breathes around the What Happened you click.' },
        { id: 'au_rays', kind: 'aura', name: 'Heaven\'s Rays', cost: 450, swatch: ['#fff1b8', '#9fc7ff'], desc: 'Rays of light turn slowly behind the What Happened you click.' },
        // on the What Happened you click: one hat and one accessory at a time, together (premium.js showWorn)
        { id: 'ht_crown', kind: 'hat', name: 'Royal Crown', cost: 300, swatch: ['#ffd24d', '#c98a1a'], desc: 'A gold crown for the What Happened you click.' },
        { id: 'ht_partyhat', kind: 'hat', name: 'Party Hat', cost: 250, swatch: ['#ff6b8a', '#ffd24d'], desc: 'Every click is a celebration.' },
        { id: 'ht_tophat', kind: 'hat', name: 'Top Hat', cost: 300, swatch: ['#222222', '#c0392b'], desc: 'A tall black hat with a red band.' },
        { id: 'ht_horns', kind: 'hat', name: 'Devil Horns', cost: 300, swatch: ['#e0302f', '#5a0d0d'], desc: 'A little mischief on top.' },
        { id: 'ac_shades', kind: 'accessory', name: 'Cool Shades', cost: 250, swatch: ['#1a1a1a', '#5fb4ff'], desc: 'Sunglasses. It has never looked cooler.' },
        { id: 'ac_headphones', kind: 'accessory', name: 'Headphones', cost: 300, swatch: ['#2b2b33', '#3dfcff'], desc: 'Big headphones with a glow.' },
        { id: 'cf_gold', kind: 'chatfx', name: 'Golden Words', cost: 200, swatch: ['#ffe39a', '#c98a1a'], desc: 'Your chat messages in shining gold.' },
        { id: 'cf_holy', kind: 'chatfx', name: 'Holy Glow', cost: 300, swatch: ['#fffbe8', '#ffd66e'], desc: 'Your chat messages glow with holy light.' },
        { id: 'cf_fire', kind: 'chatfx', name: 'Inferno', cost: 300, swatch: ['#ffd36b', '#ff4a1a'], desc: 'Your chat messages burn.' },
        { id: 'cf_ice', kind: 'chatfx', name: 'Frost', cost: 300, swatch: ['#e8f8ff', '#5fc8ff'], desc: 'Your chat messages, frozen solid.' },
        { id: 'cf_shadow', kind: 'chatfx', name: 'Shadow', cost: 250, swatch: ['#c9b6ff', '#2a1a40'], desc: 'Your chat messages, dark and smoky.' },
        { id: 'cf_rainbow', kind: 'chatfx', name: 'Rainbow', cost: 400, swatch: ['#ff7a9a', '#7fb2ff'], desc: 'Your chat messages in every colour.' },
        // weapon skins: the colours (main: blade or head, trim: grip and edge), a glow, fx 'pulse' (the glow breathes) or 'prism'
        // (the colours run through the rainbow), and its hit. On any weapon, a relic's shape too; a look only, never its reach or hit.
        { id: 'ws_gilded', kind: 'weapon', name: 'Gilded', cost: 250, main: '#f2c94c', trim: '#fff6d5', glow: 'rgba(255,214,90,0.8)', hit: [['#ffe39a', 10, 170, 0.4, 3, 0], ['#ffffff', 5, 110, 0.3, 3, 0]], desc: 'Polished gold that hits with a flash of light.' },
        { id: 'ws_rose', kind: 'weapon', name: 'Rose Gold', cost: 250, main: '#f0a39a', trim: '#ffe3d6', glow: 'rgba(255,170,160,0.7)', hit: [['#ff9fb4', 10, 140, 0.6, 4, 60], ['#ffe3d6', 5, 100, 0.5, 3, 40]], desc: 'Warm rose gold that scatters petals.' },
        { id: 'ws_obsidian', kind: 'weapon', name: 'Obsidian', cost: 300, main: '#2a2238', trim: '#b48cff', glow: 'rgba(160,110,255,0.75)', hit: [['#b48cff', 12, 220, 0.35, 3, 0], ['#1a1424', 6, 160, 0.4, 4, 0]], desc: 'Black glass that breaks into violet shards.' },
        { id: 'ws_celestial', kind: 'weapon', name: 'Celestial', cost: 450, main: '#7fb2ff', trim: '#e8f1ff', glow: 'rgba(140,180,255,0.9)', fx: 'pulse', hit: [['#e8f1ff', 12, 150, 0.6, 3, 0], ['#7fb2ff', 8, 220, 0.4, 2, 0]], desc: 'Night-sky blue that hits with a spray of stars.' },
        { id: 'ws_seraph', kind: 'weapon', name: 'Seraph\'s Light', cost: 450, main: '#fffbe8', trim: '#ffd66e', glow: 'rgba(255,240,170,0.95)', fx: 'pulse', hit: [['#ffffff', 18, 260, 0.35, 4, 0], ['#ffe39a', 14, 150, 0.55, 5, 0], ['#fff6c8', 6, 60, 0.6, 7, 0]], desc: 'Holy white and gold: every hit a burst of light.' },
        { id: 'ws_infernal', kind: 'weapon', name: 'Infernal', cost: 450, main: '#ff6a2a', trim: '#ffd36b', glow: 'rgba(255,110,40,0.9)', fx: 'pulse', hit: [['#ff9a3d', 14, 260, 0.5, 3, 320], ['#ffd24d', 8, 200, 0.4, 2, 320], ['#5a2a1a', 4, 80, 0.7, 5, -60]], desc: 'Burning steel that throws sparks where it hits.' },
        { id: 'ws_frost', kind: 'weapon', name: 'Frostbite', cost: 450, main: '#bfe9ff', trim: '#ffffff', glow: 'rgba(150,220,255,0.85)', hit: [['#e8f8ff', 12, 200, 0.5, 3, 120], ['#7fd4ff', 8, 140, 0.6, 4, 60]], desc: 'Ice-cold blue that shatters into frost.' },
        { id: 'ws_demon', kind: 'weapon', name: 'Hellforged', cost: 500, main: '#7a0f1c', trim: '#ff3b3b', glow: 'rgba(255,40,40,0.85)', fx: 'pulse', hit: [['#ff3b3b', 14, 220, 0.45, 3, -40], ['#2a0508', 8, 120, 0.7, 5, -80]], desc: 'Forged below: hits in red fire and black smoke.' },
        { id: 'ws_arcane', kind: 'weapon', name: 'Arcane', cost: 500, main: '#8a5cff', trim: '#e6d4ff', glow: 'rgba(170,120,255,0.9)', fx: 'pulse', hit: [['#d59bff', 12, 180, 0.6, 3, -60], ['#7fb2ff', 8, 120, 0.7, 2, -60]], desc: 'Living magic that sparkles where it lands.' },
        { id: 'ws_storm', kind: 'weapon', name: 'Stormcaller', cost: 500, main: '#ffe14d', trim: '#e8f4ff', glow: 'rgba(255,240,120,0.9)', hit: [['#fff6a8', 10, 320, 0.25, 2, 0], ['#ffffff', 6, 260, 0.2, 3, 0]], desc: 'Crackling yellow that strikes like lightning.' },
        { id: 'ws_prism', kind: 'weapon', name: 'Prismatic', cost: 600, main: '#9fd8ff', trim: '#ffffff', glow: 'rgba(200,170,255,0.9)', fx: 'prism', hit: [['#ff7a9a', 5, 200, 0.5, 3, 80], ['#ffd36b', 5, 200, 0.5, 3, 80], ['#7dffb2', 5, 200, 0.5, 3, 80], ['#7fb2ff', 5, 200, 0.5, 3, 80]], desc: 'Every colour of the rainbow, and confetti where it hits.' },
        // trails: colours, rise (how the bits drift: up is positive), shape: puff, feather, spark, flame, crystal, smoke or star
        { id: 'tr_feathers', kind: 'trail', name: 'Falling Feathers', cost: 300, colors: ['rgba(255,255,255,0.85)', 'rgba(230,236,255,0.6)'], rise: -10, shape: 'feather', desc: 'Feathers drift down behind you as you walk.' },
        { id: 'tr_light', kind: 'trail', name: 'Holy Light', cost: 300, colors: ['rgba(255,230,140,0.9)', 'rgba(255,250,210,0.7)'], rise: 22, shape: 'puff', desc: 'A trail of holy light follows you.' },
        { id: 'tr_divine', kind: 'trail', name: 'Divine Embers', cost: 300, colors: ['rgba(190,150,255,0.85)', 'rgba(255,210,120,0.75)'], rise: 16, shape: 'spark', desc: 'Violet and gold sparks rise behind you.' },
        { id: 'tr_fire', kind: 'trail', name: 'Fire Trail', cost: 350, colors: ['rgba(255,140,40,0.9)', 'rgba(255,210,80,0.85)', 'rgba(255,80,30,0.8)'], rise: 26, shape: 'flame', desc: 'Flames lick up from every step.' },
        { id: 'tr_ice', kind: 'trail', name: 'Ice Trail', cost: 350, colors: ['rgba(200,240,255,0.9)', 'rgba(130,210,255,0.8)'], rise: 4, shape: 'crystal', desc: 'Ice crystals form where you walk.' },
        { id: 'tr_demonic', kind: 'trail', name: 'Demonic Trail', cost: 400, colors: ['rgba(200,20,30,0.85)', 'rgba(40,0,6,0.75)', 'rgba(255,70,40,0.8)'], rise: 18, shape: 'smoke', desc: 'Red fire and black smoke follow you.' },
        { id: 'tr_magic', kind: 'trail', name: 'Magic Trail', cost: 350, colors: ['rgba(200,150,255,0.95)', 'rgba(120,190,255,0.9)', 'rgba(255,255,255,0.9)'], rise: 12, shape: 'star', desc: 'Twinkling stars of magic in your wake.' },
        // worn in the Wilds (premium.js draws them on you and on other players): head over the face, back and tail behind
        // you, outfit over your armour
        { id: 'hd_halo', kind: 'head', name: 'Halo', cost: 350, swatch: ['#fff3b0', '#e6b93a'], desc: 'A golden halo floats over your head.' },
        { id: 'hd_horns', kind: 'head', name: 'Demon Horns', cost: 350, swatch: ['#c0392b', '#2a0508'], desc: 'Curved horns, red at the root and black at the tip.' },
        { id: 'hd_magehat', kind: 'head', name: 'Mage Hat', cost: 400, swatch: ['#5b3fd1', '#ffd24d'], desc: 'A tall pointed hat with a golden star.' },
        { id: 'hd_warhelm', kind: 'head', name: 'Warrior Helmet', cost: 400, swatch: ['#b8c2cc', '#c0392b'], desc: 'A steel helmet with a red plume.' },
        { id: 'hd_crown', kind: 'head', name: 'Royal Crown', cost: 500, swatch: ['#ffd24d', '#e0302f'], desc: 'A gold crown set with rubies.' },
        { id: 'bk_wings', kind: 'back', name: 'Angel Wings', cost: 500, swatch: ['#ffffff', '#c9d6f2'], desc: 'White wings on your back, beating as you run.' },
        { id: 'bk_demon', kind: 'back', name: 'Demon Wings', cost: 500, swatch: ['#5a0d0d', '#e0302f'], desc: 'Leathery red-black wings, beating as you run.' },
        { id: 'ta_demon', kind: 'tail', name: 'Demon Tail', cost: 350, swatch: ['#c0392b', '#2a0508'], desc: 'A swishing red tail with a spade at the end.' },
        { id: 'ta_fox', kind: 'tail', name: 'Fox Tail', cost: 300, swatch: ['#ff9a3d', '#ffffff'], desc: 'A fluffy orange tail with a white tip.' },
        { id: 'of_easton', kind: 'outfit', name: 'Easton Bundy', cost: 600, swatch: ['#6b4226', '#9aa0a6'], desc: 'His brown jacket, grey tee, pendant, glasses and messy hair.' },
        { id: 'of_mage', kind: 'outfit', name: 'Archmage Robes', cost: 450, swatch: ['#3b2a8a', '#ffd24d'], desc: 'Deep violet robes stitched with gold stars.' },
        // ---- references to the game's own upgrades, Divine upgrades and skins (the owner's ask, 2026-11-20). ref: what it
        // comes from, shown on its card in the shop ----
        { id: 't_pirateking', kind: 'title', name: 'Pirate King', cost: 300, rarity: 'epic', ref: 'Somalian Pirate (upgrade)', desc: 'A title for whoever rules the waves.' },
        { id: 't_grapechosen', kind: 'title', name: 'Chosen of the Grape', cost: 300, rarity: 'epic', ref: 'Grape God (upgrade)', desc: 'A title. The vine has picked you.' },
        { id: 't_phonklord', kind: 'title', name: 'Phonk Lord', cost: 300, rarity: 'epic', ref: 'The Phonk Man (upgrade)', desc: 'A title with the bass turned all the way up.' },
        { id: 't_lurker', kind: 'title', name: 'Eternal Lurker', cost: 150, rarity: 'rare', ref: 'CR lurker (upgrade)', desc: 'A title. Always watching, rarely posting.' },
        { id: 't_goodnoodle', kind: 'title', name: 'Good Noodle', cost: 150, rarity: 'rare', ref: 'Good Noodles (upgrade)', desc: 'A title for the best noodle of all.' },
        { id: 't_villager', kind: 'title', name: 'Simple Villager', cost: 150, rarity: 'rare', ref: 'Divine Simple Villager (Divine upgrade)', desc: 'A title. Simple, humble, very rich.' },
        { id: 't_bigmoney', kind: 'title', name: 'Big Money', cost: 500, rarity: 'legendary', ref: 'Divine Money Man (Divine upgrade)', desc: 'A title dripping in gold.' },
        { id: 't_collector', kind: 'title', name: 'The Collector', cost: 500, rarity: 'legendary', ref: 'Divine Collector (Divine upgrade)', desc: 'A title for one who has them all.' },
        { id: 'th_vrill', kind: 'theme', name: 'Vrill Cosmos', cost: 350, swatch: ['#8a7dff', '#0b0e2e'], ref: 'WH Vrill (skin)', desc: 'The game page among the stars.' },
        { id: 'th_hacker', kind: 'theme', name: 'Hacker Terminal', cost: 350, swatch: ['#3dff7a', '#020a04'], ref: 'WH Hacker (skin)', desc: 'The game page in green on black.' },
        { id: 'th_grape', kind: 'theme', name: 'Grape God', cost: 350, swatch: ['#a066ff', '#5fbf4a'], ref: 'Grape God (upgrade)', desc: 'The game page in grape and vine.' },
        { id: 'th_island', kind: 'theme', name: 'Mysterious Island', cost: 350, swatch: ['#3fd0c9', '#e8d29a'], ref: 'Mysterious Island (upgrade)', desc: 'The game page in sea and sand.' },
        { id: 'th_money', kind: 'theme', name: 'Money Man', cost: 350, swatch: ['#5fbf6a', '#d4a830'], ref: 'Divine Money Man (Divine upgrade)', desc: 'The game page in cash green and gold.' },
        { id: 'ht_pirate', kind: 'hat', name: 'Pirate Tricorn', cost: 300, swatch: ['#1a1a1a', '#e8d9b0'], ref: 'Somalian Pirate (upgrade)', desc: 'A black tricorn with a skull on the front.' },
        { id: 'ht_grapes', kind: 'hat', name: 'Grape Crown', cost: 300, swatch: ['#8a4fd6', '#5fbf4a'], ref: 'Grape God (upgrade)', desc: 'A wreath of vines heavy with grapes.' },
        { id: 'ht_bread', kind: 'hat', name: 'Loaf of Bread', cost: 250, swatch: ['#d9a35a', '#8a5a2a'], ref: 'WH Bread (skin)', desc: 'A fresh loaf, worn proudly.' },
        { id: 'ac_eyepatch', kind: 'accessory', name: 'Eye Patch', cost: 250, swatch: ['#111111', '#7a5a3a'], ref: 'Somalian Pirate (upgrade)', desc: 'Arr. One eye is plenty.' },
        { id: 'ac_cane', kind: 'accessory', name: 'Gold Dollar Cane', cost: 300, swatch: ['#ffd24d', '#1a1a1a'], ref: 'Divine Money Man (Divine upgrade)', desc: 'A black cane topped with a gold dollar sign.' },
        { id: 'ac_skippie', kind: 'accessory', name: 'Skippie Headset', cost: 300, swatch: ['#4aa8e8', '#1f2a36'], ref: 'Skippie Toilet (upgrade)', desc: 'Skippie\'s blue gaming headset, mic and all. Toilet tunes on.' },
        { id: 'au_spirit', kind: 'aura', name: 'Divine Spirit', cost: 400, swatch: ['#bfe3ff', '#7fb2ff'], ref: 'Divine Spirit of What Happened (Divine upgrade)', desc: 'Blue spirit light rises around the What Happened you click.' },
        { id: 'au_vrill', kind: 'aura', name: 'Vrill Starfield', cost: 450, swatch: ['#c9b6ff', '#3a3fd6'], ref: 'WH Vrill (skin)', desc: 'Stars twinkle around the What Happened you click.' },
        { id: 'pop_phonk', kind: 'pop', name: 'Phonk', cost: 200, swatch: ['#b48cff', '#2a0a40'], ref: 'The Phonk Man (upgrade)', desc: 'A violet bass thump and flying shards where you click, and your click numbers dark and loud.' },
        { id: 'pop_money', kind: 'pop', name: 'Cash', cost: 200, swatch: ['#7dff8a', '#d4a830'], ref: 'Divine Money Man (Divine upgrade)', desc: 'Bills and coins fly where you click, and your click numbers glow cash green.' },
        { id: 'pop_hacker', kind: 'pop', name: 'Hacker', cost: 200, swatch: ['#3dff7a', '#0b2a12'], ref: 'WH Hacker (skin)', desc: 'A target lock and scattering 0s and 1s where you click, and your click numbers in terminal green.' },
        { id: 'cf_hacker', kind: 'chatfx', name: 'Hacker', cost: 250, swatch: ['#3dff7a', '#020a04'], ref: 'WH Hacker (skin)', desc: 'Your chat messages typed straight into the terminal.' },
        { id: 'cf_phonk', kind: 'chatfx', name: 'Phonk', cost: 300, swatch: ['#b48cff', '#2a0a40'], ref: 'The Phonk Man (upgrade)', desc: 'Your chat messages with the bass boosted.' },
        { id: 'cf_money', kind: 'chatfx', name: 'Big Money', cost: 300, swatch: ['#7dff8a', '#d4a830'], ref: 'Divine Money Man (Divine upgrade)', desc: 'Your chat messages in cash and gold.' },
        { id: 'cf_vrill', kind: 'chatfx', name: 'Vrill', cost: 350, swatch: ['#c9b6ff', '#3a3fd6'], ref: 'WH Vrill (skin)', desc: 'Your chat messages, written in the stars.' },
        { id: 'ws_goonsaw', kind: 'weapon', name: 'Goonsaw', cost: 400, main: '#e8742a', trim: '#cfd5dc', glow: 'rgba(255,140,60,0.75)', ref: 'Goonsaw Man (upgrade)', hit: [['#ffb347', 14, 280, 0.4, 3, 300], ['#c8a070', 8, 120, 0.7, 4, 200], ['#d0d6de', 4, 200, 0.3, 2, 0]], desc: 'Chainsaw orange and steel: sparks and sawdust on every hit.' },
        { id: 'ws_scimitar', kind: 'weapon', name: 'Skibbidi Scimitar', cost: 400, main: '#f4f8fb', trim: '#6fc3ff', glow: 'rgba(150,210,255,0.8)', ref: 'skibbidi scimitar (upgrade)', hit: [['#bfe9ff', 12, 200, 0.55, 3, 300], ['#ffffff', 8, 140, 0.5, 4, 250]], desc: 'Porcelain white and blue, and a splash where it hits.' },
        { id: 'ws_mince', kind: 'weapon', name: 'Mincecraft Diamond', cost: 450, main: '#4fe3e0', trim: '#1f7a78', glow: 'rgba(80,230,225,0.8)', ref: 'Mincecraft Man (upgrade)', hit: [['#4fe3e0', 10, 200, 0.5, 5, 280], ['#2fa8a6', 6, 150, 0.6, 6, 280]], desc: 'Diamond blue that breaks off in blocks.' },
        { id: 'ws_assassin', kind: 'weapon', name: 'Divine Assassin', cost: 500, main: '#16121c', trim: '#d01030', glow: 'rgba(210,16,48,0.85)', fx: 'pulse', ref: 'Divine Assassin (Divine upgrade)', hit: [['#d01030', 14, 320, 0.3, 2, 0], ['#1a0508', 6, 120, 0.5, 4, 0]], desc: 'Black steel with a crimson edge: a red slash on every hit.' },
        { id: 'ws_vrill', kind: 'weapon', name: 'Vrill Starblade', cost: 500, main: '#3a3fd6', trim: '#d9c9ff', glow: 'rgba(150,130,255,0.9)', fx: 'pulse', ref: 'WH Vrill (skin)', hit: [['#c9b6ff', 12, 180, 0.6, 3, -40], ['#7f9bff', 8, 240, 0.4, 2, 0], ['#ffffff', 4, 90, 0.7, 4, 0]], desc: 'Deep space blue that hits with a burst of stars.' },
        { id: 'ws_platinum', kind: 'weapon', name: 'Platinum', cost: 350, main: '#e6eef5', trim: '#9fb4c8', glow: 'rgba(220,235,255,0.85)', ref: 'Platinum WH (skin)', hit: [['#f4f8ff', 12, 220, 0.35, 3, 0], ['#bcd0e0', 6, 140, 0.45, 3, 0]], desc: 'Polished platinum that flashes white.' },
        { id: 'ws_hacker', kind: 'weapon', name: 'Glitch', cost: 400, main: '#0b1a10', trim: '#3dff7a', glow: 'rgba(61,255,122,0.85)', fx: 'pulse', ref: 'WH Hacker (skin)', hit: [['#3dff7a', 14, 200, 0.5, 3, 120], ['#0d3a1a', 6, 120, 0.6, 4, 120]], desc: 'Black and terminal green; hits scatter into code.' },
        { id: 'tr_money', kind: 'trail', name: 'Money Rain', cost: 400, colors: ['rgba(95,191,106,0.95)', 'rgba(140,210,140,0.9)'], rise: -14, shape: 'bill', ref: 'Divine Money Man (Divine upgrade)', desc: 'Bills flutter down wherever you walk.' },
        { id: 'tr_grapes', kind: 'trail', name: 'Grape Vine', cost: 350, colors: ['rgba(150,90,220,0.95)', 'rgba(120,60,190,0.9)', 'rgba(110,190,80,0.9)'], rise: 4, shape: 'grape', ref: 'Grape God (upgrade)', desc: 'Grapes and leaves spill out behind you.' },
        { id: 'tr_bubbles', kind: 'trail', name: 'Sea Bass Bubbles', cost: 300, colors: ['rgba(160,220,255,0.9)', 'rgba(220,245,255,0.85)'], rise: 24, shape: 'bubble', ref: 'The Bass (upgrade)', desc: 'Bubbles float up as you go.' },
        { id: 'tr_code', kind: 'trail', name: 'Code Rain', cost: 350, colors: ['rgba(61,255,122,0.95)', 'rgba(30,180,80,0.85)'], rise: -12, shape: 'pixel', ref: 'WH Hacker (skin)', desc: 'Green code trickles down behind you.' },
        { id: 'tr_leaves', kind: 'trail', name: 'Nature\'s Path', cost: 300, colors: ['rgba(110,190,80,0.95)', 'rgba(180,210,90,0.9)', 'rgba(80,150,60,0.9)'], rise: -6, shape: 'leaf', ref: 'WH Nature (skin)', desc: 'Leaves drift down in your footsteps.' },
        { id: 'tr_tunes', kind: 'trail', name: 'Toilet Tunes', cost: 350, colors: ['rgba(255,92,154,0.95)', 'rgba(255,210,77,0.95)', 'rgba(90,180,255,0.95)'], rise: 20, shape: 'tune', ref: 'Skippie Toilet (upgrade)', desc: 'Music notes and bubbles bob up behind you, the Skippie way.' },
        { id: 'hd_pirate', kind: 'head', name: 'Pirate Tricorn', cost: 400, swatch: ['#1a1a1a', '#e8d9b0'], ref: 'Somalian Pirate (upgrade)', desc: 'A captain\'s black tricorn with a skull.' },
        { id: 'hd_grapes', kind: 'head', name: 'Grape Crown', cost: 400, swatch: ['#8a4fd6', '#5fbf4a'], ref: 'Grape God (upgrade)', desc: 'A wreath of vines heavy with grapes.' },
        { id: 'hd_tribal', kind: 'head', name: 'Tribal Headdress', cost: 450, swatch: ['#e0302f', '#ffd24d'], ref: 'Tribal Camp (upgrade)', desc: 'A fan of bright feathers.' },
        { id: 'hd_bread', kind: 'head', name: 'Loaf of Bread', cost: 300, swatch: ['#d9a35a', '#8a5a2a'], ref: 'WH Bread (skin)', desc: 'A fresh loaf, worn proudly.' },
        { id: 'bk_cloak', kind: 'back', name: 'Assassin\'s Cloak', cost: 450, swatch: ['#1a1424', '#d01030'], ref: 'Divine Assassin (Divine upgrade)', desc: 'A dark cloak with a crimson lining, sweeping as you run.' },
        { id: 'bk_hypergamy', kind: 'back', name: 'Hypergomus Wings', cost: 500, swatch: ['#d23a4a', '#2fb2e0'], ref: 'Hypergamy (upgrade)', desc: 'White wings drawn with the diagram: the red criss-cross on one, the blue fan on the other, beating as you run.' },
        { id: 'bk_void', kind: 'back', name: 'Void Wings', cost: 500, swatch: ['#2a0a4a', '#b48cff'], ref: 'Void WH (skin)', desc: 'Wings of the violet void, beating as you run.' },
        { id: 'ta_argonian', kind: 'tail', name: 'Argonian Tail', cost: 400, swatch: ['#6fa86a', '#3f6a3a'], ref: 'Argonian Autist (upgrade)', desc: 'A long scaly lizard tail, banded green, as the Argonians wear them.' },
        { id: 'of_hitman', kind: 'outfit', name: 'Siberian Hitman', cost: 600, swatch: ['#f0f2f5', '#9aa5b1'], ref: 'Siberian Hitman (upgrade)', desc: 'A shaggy white fur coat and the long white beak.' },
        { id: 'of_moneyman', kind: 'outfit', name: 'Money Man', cost: 600, swatch: ['#1a1a1a', '#c0392b'], ref: 'Divine Money Man (Divine upgrade)', desc: 'A sharp black suit, red tie, shades and a gold dollar pin.' },
        { id: 'of_skippie', kind: 'outfit', name: 'Skippie Toilet', cost: 600, swatch: ['#4aa8e8', '#f4f8fb'], ref: 'Skippie Toilet (upgrade)', desc: 'Pop out of a white porcelain bowl under the blue lid, in Skippie\'s headset, mic and red boots.' },
    ];
    // Ids that changed: a save or the account's spends log with the old one gets the new one (the halo and wings were one
    // "mark" slot until 2026-11-20; now the halo is headwear and the wings go on your back)
    const RENAMED = { mk_halo: 'hd_halo', mk_wings: 'bk_wings' };
    const renamed = (id) => (typeof id === 'string' && RENAMED[id]) || id;
    const BY_ID = Object.fromEntries(CATALOG.map((c) => [c.id, c]));
    const EQUIP_KINDS = ['theme', 'pop', 'aura', 'hat', 'accessory', 'chatfx', 'weapon', 'trail', 'head', 'back', 'tail', 'outfit'];
    const WILDS_KINDS = ['weapon', 'trail', 'head', 'back', 'tail', 'outfit'];
    const isExchange = (it) => !!it && (it.kind === 'gems' || it.kind === 'golden');
    // bought again and again instead of owned once
    const isRepeat = (it) => !!it && REPEAT_KINDS.includes(it.kind);
    // a gem pack's bonus over the smallest pack's rate, in percent (0 for the smallest)
    const gemBonus = (it) => (it && it.kind === 'gems' ? Math.round((it.gems / (it.cost * GEM_RATE) - 1) * 100) : 0);
    // the Golden What Happeneds a trade gives when the next prestige would give `nextAwards`
    const goldenFor = (nextAwards) => Math.max(GOLDEN.min, GOLDEN.mult * Math.max(0, Math.floor(Number(nextAwards) || 0)));
    // the Wilds looks this state has on, as shared online: { weapon, trail, head, back, tail, outfit } ('' for none)
    function wildsLooks(s) {
        const out = {};
        for (const k of WILDS_KINDS) { const id = s && s.equip ? s.equip[k] : ''; out[k] = id && BY_ID[id] && BY_ID[id].kind === k ? id : ''; }
        return out;
    }
    // the buffs running at `now`: { click, cps, offline } multipliers (1 when off), crit (percentage points, 0 when off), and
    // until: when each runs out (0 for never bought; a time already past for one that ended: the offline buff still counts
    // for the part of a time away it ran, main.js holyOfflineMult)
    function buffMults(s, now) {
        const out = { click: 1, cps: 1, offline: 1, crit: 0, until: { click: 0, cps: 0, offline: 0, crit: 0 } };
        const b = s && isObj(s.buffs) ? s.buffs : {};
        for (const k of BUFF_KEYS) {
            const t = Number(b[k]) || 0;
            out.until[k] = t;
            if (t > now) { if (k === 'crit') out.crit = BUFF_EFFECT.crit.pp; else out[k] = BUFF_EFFECT[k].mult; }
        }
        return out;
    }
    // how long an item's buff still runs (the soonest of its keys for 'all'), 0 when it isn't running
    function buffUntil(s, it, now) {
        const m = buffMults(s, now), keys = buffKeys(it);
        return keys.length ? Math.min(...keys.map((k) => m.until[k])) : 0;
    }

    // ---------------- how Holy What Happeneds are earned ----------------
    // Small on purpose (tools/simulate-beans.js prints what each kind of player earns a month against the prices above).
    const EARN = {
        // each achievement, once, by rarity
        achievement: { common: 0, uncommon: 1, rare: 1, epic: 2, legendary: 4, mythic: 8 },
        boss: 5,          // the first time each Wilds boss falls to you
        weekly: 4,        // all three weekly challenges claimed (the week's bonus)
        streak: 2,        // every 7th day in a row with all three dailies
        // a finished Arena season you played 5+ rated games in, by the best rank you reached; once a season
        season: { bronze: 2, silver: 4, gold: 6, platinum: 8, diamond: 10, champion: 15 },
        glory: 5,         // Varro's shop in the Arena (core/world-arena.js SHOP 'beans'): 1,500 Glory, once a week
        retroCap: 40,     // the first time a save sees Holy What Happeneds: what it had already done pays this much at most
    };
    // how far back a weekly/daily/season reward still counts, and how long its grant id is kept after that
    const DERIVE_DAYS = 70, PRUNE_DAYS = 120;
    const DAY = 86400000;

    // ---------------- the state ----------------
    function fresh() {
        const equip = {};
        for (const k of EQUIP_KINDS) equip[k] = '';
        return { v: 1, earned: 0, earnedTotal: 0, started: 0, owned: {}, equip, buffs: { click: 0, cps: 0, offline: 0, crit: 0 }, grants: {}, log: [],
            applied: [], paid: { uid: '', balance: 0, at: 0 } };
    }
    const isObj = (v) => v !== null && typeof v === 'object' && !Array.isArray(v);
    const int = (v, lo, hi) => { const n = Math.floor(Number(v)); return Number.isFinite(n) ? Math.max(lo, Math.min(hi, n)) : lo; };
    // code:<CODE> is a redeemed Settings > Codes code of type 'holy' (grantCode): kept for good, so it pays once on every device
    const GRANT_RE = /^(ach|boss|wk|streak|season|glory|retro|code):[A-Za-z0-9_:-]{1,60}$/;
    function clean(raw) {
        const s = fresh();
        if (!isObj(raw)) return s;
        s.earned = int(raw.earned, 0, EARNED_MAX);
        s.earnedTotal = Math.max(s.earned, int(raw.earnedTotal, 0, 1e9));
        s.started = int(raw.started, 0, 1e15);
        // (saves from before 2026-11-20 also hold `week`, the weekly limits' counts: there are no limits now, so it is dropped)
        if (isObj(raw.owned)) for (const raw_id in raw.owned) {
            const id = renamed(raw_id);
            if (BY_ID[id] && !isRepeat(BY_ID[id]) && raw.owned[raw_id] === true) s.owned[id] = true;
        }
        // each worn look in its kind's slot (an old save's mark: 'mk_wings' lands in back: 'bk_wings')
        if (isObj(raw.equip)) for (const slot in raw.equip) {
            const id = renamed(raw.equip[slot]), it = BY_ID[id];
            if (typeof id === 'string' && it && EQUIP_KINDS.includes(it.kind) && s.owned[id] && (slot === it.kind || !raw.equip[it.kind])) s.equip[it.kind] = id;
        }
        if (isObj(raw.buffs)) for (const k of BUFF_KEYS) s.buffs[k] = int(raw.buffs[k], 0, 1e15);
        if (isObj(raw.grants)) for (const id in raw.grants) if (GRANT_RE.test(id)) s.grants[id] = int(raw.grants[id], 0, 1e6);
        if (Array.isArray(raw.log)) s.log = raw.log.filter((e) => isObj(e) && Number.isFinite(e.n) && typeof e.why === 'string')
            .slice(-LOG_MAX).map((e) => ({ t: int(e.t, 0, 1e15), n: int(e.n, -1e7, 1e7), why: e.why.slice(0, 80) }));
        if (Array.isArray(raw.applied)) s.applied = raw.applied.filter((x) => typeof x === 'string' && /^[A-Za-z0-9_-]{4,40}$/.test(x)).slice(-APPLIED_MAX);
        if (isObj(raw.paid)) s.paid = { uid: typeof raw.paid.uid === 'string' ? raw.paid.uid.slice(0, 128) : '', balance: int(raw.paid.balance, 0, 1e9), at: int(raw.paid.at, 0, 1e15) };
        return s;
    }
    function note(s, t, n, why) {
        s.log.push({ t, n, why: String(why).slice(0, 80) });
        if (s.log.length > LOG_MAX) s.log.splice(0, s.log.length - LOG_MAX);
    }

    // ---------------- earning ----------------
    // When a period id began (ms), or null: 'YYYY-Www' (ISO week, as core/world-bridge.js weekKey), 'YYYY-MM-DD', 'YYYY-MM'
    function periodStart(id) {
        let m = /^(\d{4})-W(\d{2})$/.exec(id);
        if (m) {
            const jan4 = Date.UTC(+m[1], 0, 4), dow = new Date(jan4).getUTCDay() || 7;
            return jan4 - (dow - 1) * DAY + (+m[2] - 1) * 7 * DAY;
        }
        m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(id);
        if (m) return Date.UTC(+m[1], +m[2] - 1, +m[3]);
        m = /^(\d{4})-(\d{2})$/.exec(id);
        if (m) return Date.UTC(+m[1], +m[2] - 1, 1);
        return null;
    }
    const recent = (id, now) => { const t = periodStart(id); return t !== null && now - t <= DERIVE_DAYS * DAY && t <= now + 8 * DAY; };

    // Every reward the saves say was earned: [{ id, n, why }]. view = {
    //   achievements: [{ key, rarity, name }] unlocked,  world: the Wilds save (or null),  challenges: core/challenges.js state }
    function sources(view, now) {
        const out = [];
        const v = view || {};
        for (const a of v.achievements || []) {
            const n = EARN.achievement[a && a.rarity] || 0;
            if (n > 0 && a.key && /^[A-Za-z0-9_]{1,60}$/.test(a.key)) out.push({ id: 'ach:' + a.key, n, why: 'Achievement: ' + (a.name || a.key) });
        }
        const w = isObj(v.world) ? v.world : null;
        if (w) {
            const names = v.bossNames || {};
            // the Wilds save keeps each boss as { kills, lastKillDay, ... } (core/world-logic.js)
            if (isObj(w.bosses)) for (const id in w.bosses) {
                const b = w.bosses[id], kills = isObj(b) ? Number(b.kills) : 0;
                if (/^[a-z0-9_]{1,40}$/.test(id) && kills > 0) out.push({ id: 'boss:' + id, n: EARN.boss, why: 'First win: ' + (names[id] || id) });
            }
            const a = isObj(w.arena) ? w.arena : null;
            const last = a && isObj(a.seasonLast) ? a.seasonLast : null;
            if (last && last.claimed === true && typeof last.id === 'string' && Number(last.games) >= (v.seasonMinGames || 5) && EARN.season[last.rank] && recent(last.id, now))
                out.push({ id: 'season:' + last.id, n: EARN.season[last.rank], why: 'Arena season ' + last.id + ' (' + last.rank + ')' });
            const b = a && isObj(a.bought) ? a.bought : null;
            if (b && typeof b.week === 'string' && isObj(b.n) && recent(b.week, now)) {
                const k = int(b.n.beans, 0, 7);
                for (let i = 1; i <= k; i++) out.push({ id: 'glory:' + b.week + ':' + i, n: EARN.glory, why: 'Bought with Glory' });
            }
        }
        const c = isObj(v.challenges) ? v.challenges : null;
        if (c) {
            if (isObj(c.week) && c.week.bonus === true && typeof c.week.key === 'string' && recent(c.week.key, now)) out.push({ id: 'wk:' + c.week.key, n: EARN.weekly, why: 'All three weekly challenges' });
            const st = isObj(c.streak) ? c.streak : null;
            if (st && Number(st.n) > 0 && Number(st.n) % (v.streakEvery || 7) === 0 && typeof st.last === 'string' && recent(st.last, now))
                out.push({ id: 'streak:' + st.last, n: EARN.streak, why: st.n + ' days in a row of dailies' });
        }
        return out.filter((x) => GRANT_RE.test(x.id));
    }

    // Pay what `list` (sources()) holds that this state hasn't paid. The first time, it all counts as one thank-you of at most
    // EARN.retroCap. Returns { paid, items: [{ id, n, why }], retro }.
    function applyEarnings(s, list, now) {
        const items = [];
        let paid = 0;
        if (!s.started) {
            let sum = 0;
            for (const x of list) if (!(x.id in s.grants)) { s.grants[x.id] = 0; sum += x.n; }
            const n = Math.min(sum, EARN.retroCap);
            s.started = now;
            if (n > 0) { s.grants['retro:first'] = n; credit(s, n, now, 'For what you had already done'); items.push({ id: 'retro:first', n, why: 'For what you had already done' }); }
            return { paid: n, items, retro: true };
        }
        for (const x of list) {
            if (x.id in s.grants) continue;
            s.grants[x.id] = x.n;
            credit(s, x.n, now, x.why);
            paid += x.n;
            items.push(x);
        }
        prune(s, now);
        return { paid, items, retro: false };
    }
    function credit(s, n, now, why) {
        const amt = int(n, 0, 1e6);
        if (!amt) return 0;
        s.earned = Math.min(EARNED_MAX, s.earned + amt);
        s.earnedTotal += amt;
        note(s, now, amt, why);
        return amt;
    }
    // drop grant ids of weeks, days and seasons long gone (sources() no longer offers them)
    function prune(s, now) {
        for (const id of Object.keys(s.grants)) {
            const m = /^(?:wk|streak|season|glory):([0-9W-]+)/.exec(id);
            if (!m) continue;
            const t = periodStart(m[1]);
            if (t !== null && now - t > PRUNE_DAYS * DAY) delete s.grants[id];
        }
    }

    // ---------------- codes ----------------
    // A Settings > Codes code of type 'holy' (main.js redeemSecretCode): `n` earned Holy What Happeneds, once per code for this
    // state (which syncs with the account), whatever the device. Returns what it paid: 0 if the code was already paid or is no code.
    const CODE_MAX = 100000; // a code never gives more than this, whatever its document says
    const codeGrantId = (code) => {
        const c = String(code || '').trim().toUpperCase().replace(/[^A-Z0-9_-]/g, '_').slice(0, 55);
        return c && /[A-Z0-9]/.test(c) ? 'code:' + c : '';
    };
    function grantCode(s, code, n, now, why) {
        const id = codeGrantId(code), amt = int(n, 0, CODE_MAX);
        if (!id || !amt || id in s.grants) return 0;
        s.grants[id] = amt;
        return credit(s, amt, now, why || 'Code ' + id.slice(5));
    }

    // ---------------- spending ----------------
    // Earned first, the rest from the account. ok: whether both together cover it.
    function planSpend(earned, paid, cost) {
        const e = Math.max(0, Math.floor(earned) || 0), p = Math.max(0, Math.floor(paid) || 0), c = Math.max(0, Math.floor(cost) || 0);
        const fromEarned = Math.min(e, c);
        return { ok: e + p >= c, fromEarned, fromPaid: c - fromEarned, short: Math.max(0, c - e - p) };
    }
    // { ok, reason?: 'unknown' | 'owned', item }. Repeat items (gems, Golden, timelapses, boosts) have no limit.
    function canBuy(s, id) {
        const it = BY_ID[id];
        if (!it) return { ok: false, reason: 'unknown' };
        if (isRepeat(it)) return { ok: true, item: it };
        if (s.owned[id]) return { ok: false, reason: 'owned' };
        return { ok: true, item: it };
    }
    // A repeat item: the earned part is taken. The caller then hands over the gems, Golden, income or boosts (main.js
    // addGems / addGolden / addCpsSeconds, items.js grantItems), straight after this is saved. what: how the log names it
    // (e.g. '45 Golden What Happeneds'), the item's name if not given.
    function completeExchange(s, id, fromEarned, now, spendId, what) {
        const it = BY_ID[id];
        if (!isRepeat(it)) return false;
        const e = int(fromEarned, 0, EARNED_MAX);
        if (e > s.earned) return false;
        s.earned -= e;
        // a buff runs from now, or on from when the one running ends (each of its keys on its own)
        if (it.kind === 'buff') {
            if (!isObj(s.buffs)) s.buffs = {};
            for (const k of buffKeys(it)) {
                const from = Math.max(now, Number(s.buffs[k]) || 0);
                s.buffs[k] = Math.min(now + BUFF_MAX_DAYS * DAY, from + it.days * DAY);
            }
        }
        if (spendId) markApplied(s, spendId);
        note(s, now, -it.cost, (isExchange(it) ? 'Traded for ' : 'Bought ') + (what ? String(what) : it.name));
        return true;
    }
    // The item arrives and the earned part is taken (the account's part was already taken by the caller).
    function completePurchase(s, id, fromEarned, now, spendId) {
        const it = BY_ID[id];
        if (!it || isRepeat(it) || s.owned[id]) return false;
        const e = int(fromEarned, 0, EARNED_MAX);
        if (e > s.earned) return false;
        s.earned -= e;
        s.owned[id] = true;
        if (EQUIP_KINDS.includes(it.kind)) s.equip[it.kind] = id;
        if (spendId) markApplied(s, spendId);
        note(s, now, -it.cost, 'Bought ' + it.name);
        return true;
    }
    function markApplied(s, spendId) {
        if (typeof spendId !== 'string' || s.applied.includes(spendId)) return;
        s.applied.push(spendId);
        if (s.applied.length > APPLIED_MAX) s.applied.splice(0, s.applied.length - APPLIED_MAX);
    }
    function equip(s, id) {
        const it = BY_ID[id];
        if (!it || !s.owned[id] || !EQUIP_KINDS.includes(it.kind)) return false;
        s.equip[it.kind] = s.equip[it.kind] === id ? '' : id;
        return true;
    }
    // Looks bought with the account's Holy What Happeneds (wallets/{uid}/spends: [{ id, item }]) that this device doesn't have
    // yet. Returns the items given back. Gems, Golden and boosts are never handed out again from the log: the device that
    // bought them already did, and the log can't tell whether this device's save has them.
    function restoreFromSpends(s, spends) {
        const back = [];
        for (const sp of spends || []) {
            if (!sp || typeof sp.id !== 'string' || s.applied.includes(sp.id)) continue;
            markApplied(s, sp.id);
            const id = renamed(sp.item), it = BY_ID[id];
            if (it && !isRepeat(it) && !s.owned[id]) { s.owned[id] = true; back.push(it); }
        }
        return back;
    }

    // ---------------- the account's balance: the spend rule (firestore-premium.rules, written out) ----------------
    // before/after: wallets/{uid} before and after the write; spend: the spends/{spendId} document written with it;
    // spendExisted: whether that spend id was already taken. True when the rules would allow the pair of writes.
    const WALLET_CLIENT_KEYS = ['balance', 'spent', 'lastSpend'];
    function checkWalletSpend(before, after, spend, spendId, spendExisted) {
        if (!isObj(before) || !isObj(after) || !isObj(spend)) return false;
        const changed = Object.keys(Object.assign({}, before, after)).filter((k) => JSON.stringify(before[k]) !== JSON.stringify(after[k]));
        if (!changed.every((k) => WALLET_CLIENT_KEYS.includes(k))) return false;
        const cost = (before.balance || 0) - after.balance;
        if (!Number.isInteger(after.balance) || after.balance < 0 || !(cost > 0)) return false;
        if (after.spent !== (Number.isInteger(before.spent) ? before.spent : 0) + cost) return false;
        if (after.lastSpend !== spendId || spendExisted) return false;
        if (!/^[A-Za-z0-9_-]{4,40}$/.test(String(spendId))) return false;
        const keys = Object.keys(spend);
        if (!keys.every((k) => ['item', 'cost', 'at'].includes(k)) || keys.length !== 3) return false;
        return spend.cost === cost && typeof spend.item === 'string' && spend.item.length >= 1 && spend.item.length <= 40 && spend.at === 'request.time';
    }

    // ---------------- showing amounts ----------------
    const amount = (n) => CUR.icon + ' ' + Math.floor(Number(n) || 0).toLocaleString('en-US');
    const plural = (n) => (Math.floor(n) === 1 ? CUR.one : CUR.many);

    return { KEY, CUR, KINDS, REPEAT_KINDS, CATALOG, BY_ID, RENAMED, EQUIP_KINDS, WILDS_KINDS, GEM_RATE, GOLDEN, BUFF_MAX_DAYS, BUFF_EFFECT, BUFF_KEYS, EARN, DERIVE_DAYS, PRUNE_DAYS, fresh, clean, periodStart, sources, applyEarnings,
        credit, prune, planSpend, canBuy, isExchange, isRepeat, gemBonus, goldenFor, wildsLooks, buffMults, buffUntil, buffKeys, completePurchase, completeExchange, markApplied, equip, restoreFromSpends,
        checkWalletSpend, WALLET_CLIENT_KEYS, amount, plural, grantCode, codeGrantId, CODE_MAX };
}));
