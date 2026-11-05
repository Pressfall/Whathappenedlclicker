/**
 * The crew: characters from the clicker's upgrades who move to Wildgate (the Wilds' town) once you have reached them in the
 * game. Loaded by both pages:
 * - world.html: core/world-data.js puts CREW into its NPCS (they stand in the Depot's yard) and QUESTS into its quests;
 *   the page shows a crew member only once they have arrived.
 * - index.html: main.js says when someone leaves for Wildgate, marks their upgrade, and shows what the Wilds asks of the
 *   game (a crew quest's "clicker" goal) on that upgrade.
 * How far you got in the game is a "view" (clickerView / readView) of what main.js keeps: the main save, the lifetime best
 * level of every upgrade (whathappened_upgrade_best, written only by main.js so it survives prestige) and the lifetime
 * stat keys. The Wilds only reads them.
 *
 * Quest goals of kind 'clicker' are counted from that view, not from events: { stat: 'upgrade', up, n } (best level of an
 * upgrade), or stat 'prestiges' | 'goldenEver' | 'clicks' | 'followersSeen' | 'renown' with n.
 * A story quest may also carry `clicker`: consumables for the game (core/world-bridge.js ITEMS only: timed boosts and
 * saved-up time, never gems, Golden or lootboxes), sent through the outbox when it is handed in.
 *
 * Works in a browser (<script src="core/world-crew.js"> sets window.WHCrew) and in Node (require).
 */
(function (root, factory) {
    if (typeof module === 'object' && module.exports) module.exports = factory();
    else root.WHCrew = factory();
}(typeof self !== 'undefined' ? self : this, function () {
    'use strict';

    const BEST_KEY = 'whathappened_upgrade_best';
    const UPGRADES = 29;

    // spot: tiles from the town's centre (the Depot's yard is south-east of the plaza, core/world-gen.js buildTown).
    // arrive: the best level of their upgrade, ever, that brings them to Wildgate. service: what they do besides quests
    // ('shop' | 'trade' | 'jukebox' | 'ledger'), or none.
    const CREW = [
        { id: 'jonathan', up: 11, arrive: 10, name: 'Jonathan', role: 'Keeper of the Ledger', service: 'ledger',
            face: 'mainimage/upgrades/thumbs/jonathan.webp', color: '#6d8fb5', spot: [5, 13],
            greet: 'I am a normal guy with a spreadsheet. The spreadsheet says you work two jobs. I keep the books for both.',
            blurb: 'keeps the books for both of your jobs at the Depot: your Renown',
            chain: ['jonathan_sheet', 'jonathan_audit', 'jonathan_month'], daily: ['jonathan_daily'] },
        { id: 'pirate', up: 2, arrive: 25, name: 'Somalian Pirate', role: 'Smuggler', service: 'shop',
            face: 'mainimage/upgrades/thumbs/somaliflag.webp', color: '#3fa9f5', spot: [2, 13],
            greet: 'The factory ran out of things worth stealing, so I came where the rubies are. Need ore? Ore fell off a boat. Many boats.',
            blurb: 'runs a smuggler\'s stall in the Depot yard: ore from the zones you have opened',
            chain: ['pirate_speedboat', 'pirate_insurance', 'pirate_hat'], daily: ['pirate_daily'] },
        { id: 'villager', up: 16, arrive: 25, name: 'ez villager', role: 'Trading Hall', service: 'trade',
            face: 'mainimage/upgrades/thumbs/ezvillager.webp', color: '#7a9a3c', spot: [8, 13],
            greet: 'Hrmm. Hrmm hrmm. (He holds up a contract. It says: fair trades, every day, no refunds.)',
            blurb: 'opened a Trading Hall in the Depot yard: daily material swaps',
            chain: ['villager_contract', 'villager_golem', 'villager_hall'], daily: ['villager_daily'] },
        { id: 'grape', up: 6, arrive: 25, name: 'Grape God', role: 'Vintner', service: 'shop',
            face: 'mainimage/upgrades/thumbs/grapegod.webp', color: '#8e44ad', spot: [11, 13],
            greet: 'Every vine in Wildgate tithes to me now. The grapes did not agree to this. The grapes are not consulted.',
            blurb: 'sells potions a little cheaper than the Trader, in the Depot yard',
            chain: ['grape_tithe', 'grape_ferment', 'grape_harvest'], daily: ['grape_daily'] },
        { id: 'goonsaw', up: 3, arrive: 25, name: 'Goonsaw Man', role: 'Lumberjack (two chainsaws)', service: null,
            face: 'mainimage/upgrades/thumbs/goonsawman.webp', color: '#c0662f', spot: [3, 16],
            greet: 'Two chainsaws and no trees left at the factory. Wildgate has trees. Wildgate has SO many trees.',
            blurb: 'went to Wildgate for the trees, and has work for you',
            chain: ['goonsaw_second', 'goonsaw_choir', 'goonsaw_mossback'], daily: ['goonsaw_daily'] },
        { id: 'tribal', up: 9, arrive: 25, name: 'Tribal Camp', role: 'Totem Carver', service: null,
            face: 'mainimage/upgrades/thumbs/tribalcamp.webp', color: '#b5733a', spot: [12, 16],
            greet: 'The bonfire is lit and the drums are tuned. The spirits wanted a town to watch over, and this one looks like it needs it.',
            blurb: 'carves totems in Wildgate, and the spirits have tasks',
            chain: ['tribal_totem', 'tribal_drums', 'tribal_spirits'], daily: ['tribal_daily'] },
        { id: 'phonk', up: 10, arrive: 25, name: 'The Phonk Man', role: 'DJ of Wildgate', service: 'jukebox',
            face: 'mainimage/upgrades/thumbs/phonkman.webp', color: '#9b59ff', spot: [6, 16],
            greet: 'Memphis tapes, purple shades, and a town square with real acoustics. I play whatever music you own back in the game.',
            blurb: 'plays the music you own in the game, all over Wildgate',
            chain: ['phonk_tapes', 'phonk_drift', 'phonk_shades'], daily: ['phonk_daily'] },
        { id: 'hitman', up: 29, arrive: 10, name: 'Siberian Hitman', role: 'Bounty Hunter', service: null,
            face: 'mainimage/siberianHitman.webp', color: '#9fb4c7', spot: [9, 16],
            greet: 'I took one last contract. Then another. The Wilds are full of contracts, mostly on rivals who talk too much.',
            blurb: 'hunts bounties out of Wildgate, and is hiring',
            chain: ['hitman_winter', 'hitman_cold', 'hitman_last'], daily: ['hitman_daily'] },
    ];
    const CREW_BY_ID = Object.fromEntries(CREW.map(c => [c.id, c]));
    const CREW_BY_UP = Object.fromEntries(CREW.map(c => [c.up, c]));

    // Their quests, in the same shape as core/world-data.js QUESTS. clicker: consumables sent to the game when handed in.
    const QUESTS = {
        // Jonathan
        jonathan_sheet: { title: 'The Spreadsheet', text: 'Every column needs a number. Craft two pieces of gear so I can fill in "Production".', goal: { kind: 'craft', n: 2 }, rubies: 120 },
        jonathan_audit: { title: 'Audit', text: 'The audit wants proof of clicking. Ten thousand clicks in the game, lifetime. I will know.', goal: { kind: 'clicker', stat: 'clicks', n: 10000 }, rubies: 250 },
        jonathan_month: { title: 'Employee of the Month', text: 'Employee of the Month goes by Renown, and Renown counts both of your jobs. Reach Renown 20.', goal: { kind: 'clicker', stat: 'renown', n: 20 }, rubies: 600, clicker: { pocketWatch: 2 } },
        jonathan_daily: { title: 'Paperwork', text: 'Craft one piece of gear today. For the records.', goal: { kind: 'craft', n: 1 }, rubies: 80, daily: true },
        // Somalian Pirate
        pirate_speedboat: { title: 'Bigger Speedboat', text: 'The speedboat is fine. A bigger one is finer. Chop me ten trees for the hull.', goal: { kind: 'harvest', tool: 'axe', n: 10 }, rubies: 120 },
        pirate_insurance: { title: 'Plunder Insurance', text: 'Every crew needs insurance. Mine is you being very good at my day job: back in the game, get the Somalian Pirate to level 100.', goal: { kind: 'clicker', stat: 'upgrade', up: 2, n: 100 }, rubies: 300 },
        pirate_hat: { title: 'The Captain\'s Hat', text: 'A captain on the Saltspray Coast lost her hat to the drowned. A pirate respects a hat. Sink eight Drowned Sailors and see what washes up.', goal: { kind: 'kill', monster: 'drowned', n: 8 }, need: { zone: 'coast' }, rubies: 2400, clicker: { spareBattery: 3 } },
        pirate_daily: { title: 'Ransom Run', text: 'One of those rival adventurers owes me money. Remind them.', goal: { kind: 'rival', n: 1 }, rubies: 120, daily: true },
        // ez villager
        villager_contract: { title: 'Hrmm Contract', text: 'Hrmm. (He points at gold ore, then at himself, then holds up six fingers.)', goal: { kind: 'deliver', mats: { gold_ore: 6 } }, need: { zone: 'mines' }, rubies: 450 },
        villager_golem: { title: 'Iron Golem Supervisor', text: 'Hrmm! (He mimes a huge iron golem, then a factory.) In the game: ez villager, level 100.', goal: { kind: 'clicker', stat: 'upgrade', up: 16, n: 100 }, rubies: 600 },
        villager_hall: { title: 'Trading Hall', text: 'Hrmm hrmm. (A Trading Hall needs iron. Lots of iron.) Ten iron bars.', goal: { kind: 'deliver', mats: { iron_bar: 10 } }, need: { zone: 'mines' }, rubies: 700, clicker: { hourglass: 1 } },
        villager_daily: { title: 'Daily Deal', text: 'Hrmm. (Four copper bars. He taps the contract. Every day.)', goal: { kind: 'deliver', mats: { copper_bar: 4 } }, rubies: 80, daily: true },
        // Grape God
        grape_tithe: { title: 'Vineyard Tithe', text: 'A god needs a tithe. Ten healing herbs will do. They are not grapes, but I am flexible.', goal: { kind: 'deliver', mats: { herb: 10 } }, rubies: 130 },
        grape_ferment: { title: 'Fermentation', text: 'Slime gel ferments beautifully. Do not ask how I know. Six gel and six more herbs.', goal: { kind: 'deliver', mats: { slime_gel: 6, herb: 6 } }, rubies: 220, cons: { potion_big: 1 } },
        grape_harvest: { title: 'Divine Harvest', text: 'My vineyard back in the factory has gone quiet. Get the Grape God to level 100 in the game and the harvest comes in.', goal: { kind: 'clicker', stat: 'upgrade', up: 6, n: 100 }, rubies: 400, clicker: { frenzyPotion: 1 } },
        grape_daily: { title: 'Grape Stomp', text: 'Stomp on fifteen things today. Monsters count. Grapes would be better.', goal: { kind: 'kill', n: 15 }, rubies: 90, daily: true },
        // Goonsaw Man
        goonsaw_second: { title: 'Second Chainsaw', text: 'One chainsaw is a tool. Two is a lifestyle. Chop fifteen trees, any kind, and feel the lifestyle.', goal: { kind: 'harvest', tool: 'axe', n: 15 }, rubies: 150 },
        goonsaw_choir: { title: 'Chainsaw Choir', text: 'I am starting a choir. Chainsaws only. Back in the game, get Goonsaw Man to level 100 so the choir has its lead.', goal: { kind: 'clicker', stat: 'upgrade', up: 3, n: 100 }, rubies: 350 },
        goonsaw_mossback: { title: 'Timber!', text: 'The Mossback in Greenwood is mostly tree. I want to hear it fall.', goal: { kind: 'kill', elite: true, zone: 'greenwood', n: 1 }, rubies: 450, clicker: { energyDrink: 3 } },
        goonsaw_daily: { title: 'Lumber Run', text: 'Ten trees today. The saws get bored.', goal: { kind: 'harvest', tool: 'axe', n: 10 }, rubies: 70, daily: true },
        // Tribal Camp
        tribal_totem: { title: 'Totem Carving', text: 'Every totem starts as rock. Mine twelve rocks or ore veins and I will find the faces inside.', goal: { kind: 'harvest', tool: 'pickaxe', n: 12 }, rubies: 160 },
        tribal_drums: { title: 'War Drums', text: 'The war drums want a war. Bring down three elite beasts, anywhere.', goal: { kind: 'kill', elite: true, n: 3 }, rubies: 500 },
        tribal_spirits: { title: 'Ancestral Spirits', text: 'The ancestors only speak to those who have started over. Prestige once in the game, then come back to the fire.', goal: { kind: 'clicker', stat: 'prestiges', n: 1 }, rubies: 600, clicker: { loadedDice: 2 } },
        tribal_daily: { title: 'Bonfire Ritual', text: 'The bonfire is hungry. Fifteen things gathered today: ore, wood or plants.', goal: { kind: 'harvest', n: 15 }, rubies: 70, daily: true },
        // The Phonk Man
        phonk_tapes: { title: 'Memphis Tapes', text: 'Bats know bass. Eight Cave Bats from the Stonepeak Mines and I can sample the screech.', goal: { kind: 'kill', monster: 'bat', n: 8 }, need: { zone: 'mines' }, rubies: 320 },
        phonk_drift: { title: 'Drift Edit', text: 'Every drift needs an edit. Get The Phonk Man to level 100 in the game.', goal: { kind: 'clicker', stat: 'upgrade', up: 10, n: 100 }, rubies: 450 },
        phonk_shades: { title: 'Purple Shades', text: 'The Ember Wastes glow purple at night, if your shades are right. Go and see it.', goal: { kind: 'visit', zone: 'ember' }, need: { zone: 'ember' }, rubies: 700, clicker: { overclockChip: 1 } },
        phonk_daily: { title: 'Crowd Control', text: 'Twelve monsters today. The crowd gets rowdy.', goal: { kind: 'kill', n: 12 }, rubies: 80, daily: true },
        // Siberian Hitman
        hitman_winter: { title: 'Winter Operations', text: 'Three rival adventurers. Nothing personal. Somebody paid.', goal: { kind: 'rival', n: 3 }, rubies: 400 },
        hitman_cold: { title: 'Cold Contract', text: 'The Frost Giant in Frostveil has a price on its head. Big head, big price.', goal: { kind: 'kill', elite: true, zone: 'frost', n: 1 }, need: { zone: 'frost' }, rubies: 2000 },
        hitman_last: { title: 'The Last Contract', text: 'The last contract is always the hardest. Prestige three times in the game. Then we talk about retirement.', goal: { kind: 'clicker', stat: 'prestiges', n: 3 }, rubies: 2500, clicker: { timeMachine: 1 } },
        hitman_daily: { title: 'Bounty', text: 'One elite beast, today. The client is impatient.', goal: { kind: 'kill', elite: true, n: 1 }, rubies: 160, daily: true },
    };

    // ---------------- services (the Wilds only) ----------------
    // Shops: { id, price (rubies), give (materials or potions), need (a zone that must be open), limit (per day) }.
    // The Pirate's ore comes only from the first four zones, at about three times what the Trader pays for it, so it is
    // never a way past the Far Reaches' gear walls (tests/world-pace.test.js).
    const SHOPS = {
        pirate: [
            { id: 'smug_iron', price: 30, give: { iron_ore: 2 }, need: 'mines', limit: 5 },
            { id: 'smug_silver', price: 60, give: { silver_ore: 2 }, need: 'mines', limit: 3 },
            { id: 'smug_gold', price: 75, give: { gold_ore: 2 }, need: 'mines', limit: 3 },
            { id: 'smug_obsidian', price: 75, give: { obsidian: 2 }, need: 'ember', limit: 3 },
            { id: 'smug_crystal', price: 150, give: { frost_crystal: 2 }, need: 'frost', limit: 2 },
        ],
        grape: [
            { id: 'wine_small', price: 12, give: { potion_small: 1 }, limit: 10 },
            { id: 'wine_big', price: 34, give: { potion_big: 1 }, limit: 5 },
            { id: 'wine_max', price: 90, give: { potion_max: 1 }, limit: 2 },
            { id: 'wine_herbs', price: 10, give: { herb: 3 }, limit: 5 },
        ],
    };
    // ez villager's swaps: never worth more (at the Trader's prices) than what you give, so they can't be turned into rubies
    const TRADES = {
        villager: [
            { id: 'tr_iron', give: { stone: 12 }, get: { iron_ore: 2 }, need: 'mines', limit: 3 },
            { id: 'tr_silver', give: { bone: 8 }, get: { silver_ore: 2 }, need: 'mines', limit: 3 },
            { id: 'tr_gold', give: { bat_wing: 6 }, get: { gold_ore: 2 }, need: 'mines', limit: 3 },
            { id: 'tr_obsidian', give: { sulfur: 6 }, get: { obsidian: 2 }, need: 'ember', limit: 3 },
            { id: 'tr_ember', give: { imp_horn: 4 }, get: { ember_ore: 2 }, need: 'ember', limit: 3 },
            { id: 'tr_crystal', give: { wolf_pelt: 4 }, get: { frost_crystal: 2 }, need: 'frost', limit: 3 },
            { id: 'tr_mithril', give: { wraith_essence: 6 }, get: { mithril_ore: 3 }, need: 'frost', limit: 3 },
        ],
    };
    // The game's music (main.js MUSIC_TRACKS; tests/world-crew.test.js keeps the two lists the same), for the jukebox.
    // owned: the main save's musicOwned flags (the default theme is always owned).
    const MUSIC = [
        { id: 'mainTheme', name: 'Default Theme', file: 'maintheme.mp3' },
        { id: 'BassInsanity', name: 'Bass Insanity', file: 'bassinsanity.mp3' },
        { id: 'MaximumAgro', name: 'Maximum Agro', file: 'maximumagro.mp3' },
        { id: 'MetalSlam', name: 'Metal Slam', file: 'metalslam.mp3' },
        { id: 'UltraTwang', name: 'Ultra Twang', file: 'ultratwang.mp3' },
        { id: 'ThroatSing', name: 'Throat Sing', file: 'throatsing.mp3' },
        { id: 'Hardstyle_whathappened', name: 'Hardstyle — What Happened', file: 'HardstyleWhat Happened.mp3' },
        { id: 'EDMWhatHappened', name: 'EDM — What Happened', file: 'EDMWhatHappened.mp3' },
        { id: 'SimpleAndEasy', name: 'Simple and Easy', file: 'Simple and Easy.mp3' },
    ];
    function ownedMusic(mainSave) {
        const own = mainSave && typeof mainSave.musicOwned === 'object' && mainSave.musicOwned ? mainSave.musicOwned : {};
        return MUSIC.filter(t => t.id === 'mainTheme' || own[t.id] === true);
    }

    // ---------------- how far you got in the game ----------------
    const num = (v) => { const n = Number(v); return Number.isFinite(n) && n > 0 ? n : 0; };
    const whole = (v, max) => Math.min(max, Math.floor(num(v)));
    const LEVEL_MAX = 1e9; // a damaged or edited value is cut down to this
    // Best level of every upgrade, from the stored best levels and the current run's (index 0 unused)
    function bestLevels(best, mainSave) {
        const out = [0];
        const b = best && typeof best === 'object' ? best : {}, s = mainSave && typeof mainSave === 'object' ? mainSave : {};
        for (let i = 1; i <= UPGRADES; i++) out.push(Math.max(whole(b[i], LEVEL_MAX), whole(s['upgrade' + i + 'Level'], LEVEL_MAX)));
        return out;
    }
    // { save, best, clicks, prestiges, goldenEver, followersSeen, renown } -> the view quests and the Depot read
    function clickerView(src) {
        const o = src || {}, s = o.save && typeof o.save === 'object' ? o.save : {};
        return {
            best: bestLevels(o.best, s),
            prestiges: Math.max(whole(s.prestigeTimes, LEVEL_MAX), whole(o.prestiges, LEVEL_MAX)),
            goldenEver: Math.max(num(s.totalGoldenEver), num(o.goldenEver)),
            clicks: num(o.clicks),
            followersSeen: whole(o.followersSeen, LEVEL_MAX),
            renown: whole(o.renown, LEVEL_MAX),
        };
    }
    const EMPTY_VIEW = clickerView({});
    function readJSON(store, key) { try { return JSON.parse(store.getItem(key) || 'null'); } catch (e) { return null; } }
    function readNum(store, key) { try { return Number(store.getItem(key)) || 0; } catch (e) { return 0; } }
    // The view from storage (both pages): renown is filled in by the caller (core/renown.js needs the whole snapshot)
    function readView(store, renown) {
        const f = readJSON(store, 'whathappened_followers') || {};
        return clickerView({
            save: readJSON(store, 'whathappened_save') || readJSON(store, 'whathappened_save_v1') || {},
            best: readJSON(store, BEST_KEY) || {},
            clicks: readNum(store, 'whathappened_lifetime_clicks'),
            prestiges: readNum(store, 'whathappened_prestige_times'),
            goldenEver: readNum(store, 'whathappened_total_golden'),
            followersSeen: f && typeof f.seen === 'object' && f.seen ? Object.keys(f.seen).length : 0,
            renown,
        });
    }
    function arrived(id, view) { const c = CREW_BY_ID[id]; return !!c && (view || EMPTY_VIEW).best[c.up] >= c.arrive; }
    // their upgrade has been bought at least once: the Depot names them (until then they are "???")
    function discovered(id, view) { const c = CREW_BY_ID[id]; return !!c && (view || EMPTY_VIEW).best[c.up] >= 1; }
    function goalHave(goal, view) {
        const v = view || EMPTY_VIEW;
        if (!goal || goal.kind !== 'clicker') return 0;
        switch (goal.stat) {
            case 'upgrade': return v.best[goal.up] || 0;
            case 'prestiges': return v.prestiges;
            case 'goldenEver': return v.goldenEver;
            case 'clicks': return v.clicks;
            case 'followersSeen': return v.followersSeen;
            case 'renown': return v.renown;
        }
        return 0;
    }
    const STATS = ['upgrade', 'prestiges', 'goldenEver', 'clicks', 'followersSeen', 'renown'];
    const fmt = (n) => Math.floor(n).toLocaleString('en-US');
    // "In the game: reach Somalian Pirate level 100" (both pages say it the same way)
    function goalText(goal) {
        const n = goal.n || 1;
        switch (goal.stat) {
            case 'upgrade': return 'In the game: get ' + ((CREW_BY_UP[goal.up] || {}).name || 'upgrade ' + goal.up) + ' to level ' + fmt(n);
            case 'prestiges': return 'In the game: prestige ' + (n === 1 ? 'once' : fmt(n) + ' times') + ' (all time)';
            case 'goldenEver': return 'In the game: earn ' + fmt(n) + ' Golden What Happened (all time)';
            case 'clicks': return 'In the game: click ' + fmt(n) + ' times (all time)';
            case 'followersSeen': return 'In the game: discover ' + fmt(n) + ' kinds of follower';
            case 'renown': return 'Reach Renown ' + fmt(n) + ' (it counts the game and the Wilds)';
        }
        return '';
    }
    // The game's side: what the Wilds' accepted crew quests ask of each upgrade. worldSave: the parsed Wilds save.
    // -> { [upgrade index]: { crew, quest, have, need } } (only goals on an upgrade's level)
    function asksOf(worldSave, view) {
        const out = {}, q = worldSave && typeof worldSave.quests === 'object' && worldSave.quests ? worldSave.quests : {};
        for (const c of CREW) {
            const a = q[c.id] && q[c.id].active, def = a && Object.prototype.hasOwnProperty.call(QUESTS, a.id) ? QUESTS[a.id] : null;
            if (!def || def.goal.kind !== 'clicker' || def.goal.stat !== 'upgrade') continue;
            out[def.goal.up] = { crew: c.id, quest: a.id, title: def.title, have: Math.min(def.goal.n, goalHave(def.goal, view)), need: def.goal.n };
        }
        return out;
    }
    // Who just reached Wildgate: crew whose upgrade went from below their level to at or above it
    function newArrivals(before, after) {
        return CREW.filter(c => (before[c.up] || 0) < c.arrive && (after[c.up] || 0) >= c.arrive).map(c => c.id);
    }

    return {
        BEST_KEY, UPGRADES, CREW, CREW_BY_ID, CREW_BY_UP, QUESTS, SHOPS, TRADES, MUSIC, STATS,
        ownedMusic, bestLevels, clickerView, readView, arrived, discovered, goalHave, goalText, asksOf, newArrivals,
    };
}));
