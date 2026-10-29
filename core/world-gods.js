/**
 * The Hall of Gods (The Wilds): the god statues, what each level costs, and the blessings they give back in the clicker.
 * Statues are raised in world.html (core/world-logic.js upgradeGod) with rubies and Wilds materials, boss trophies
 * included at some levels. Their levels live in the Wilds save (`gods`); the game (main.js getGodBonuses) only reads them,
 * so this file is loaded by both pages and both agree on what a level is worth.
 * Blessings are percentages like the followers' (crit chance in percentage points). Statues have no top level: every
 * level costs more than the one before.
 *
 * Works in a browser (<script src="core/world-gods.js"> sets window.WHWorldGods) and in Node (require).
 */
(function (root, factory) {
    if (typeof module === 'object' && module.exports) module.exports = factory();
    else root.WHWorldGods = factory();
}(typeof self !== 'undefined' ? self : this, function () {
    'use strict';

    // Not a game rule (statues have no top level): only what a damaged or edited save is cut down to
    const LEVEL_CAP = 999;
    // per: blessing per level. offering: the god's own material, asked for from level 3 on (2 per level).
    // face: the portrait carved into the statue.
    const GODS = {
        solarus: { name: 'Solarus', title: 'the Undying Sun', icon: '☀️', color: '#ffc83d', face: 'mainimage/thumbs/divinewh.webp',
            per: { cps: 5 }, offering: 'herb', lore: 'Its light never set on the old kingdom. Everything that grows still leans toward it.' },
        vulkar: { name: 'Vulkar', title: 'the Hammer Below', icon: '🔨', color: '#ff7b3a', face: 'mainimage/thumbs/divinesomalian.webp',
            per: { click: 8 }, offering: 'coal', lore: 'The first smith. Every strike of every hammer is a prayer to it, whether the smith knows it or not.' },
        fortuna: { name: 'Fortuna', title: 'the Weighted Die', icon: '🎲', color: '#4fd27a', face: 'mainimage/thumbs/divineassassin.webp',
            per: { critChance: 0.4, critDmg: 6 }, offering: 'bone', lore: 'She throws dice carved from the bones of the unlucky. She never loses.' },
        chronos: { name: 'Chronos', title: 'the Patient Stone', icon: '⏳', color: '#7fd4ff', face: 'mainimage/thumbs/divinespirit.webp',
            per: { offline: 10 }, offering: 'stone', lore: 'It does nothing, forever, and is never late. Time works for those who wait.' },
        aurum: { name: 'Aurum', title: 'the Hoard-Keeper', icon: '💎', color: '#5ee7ff', face: 'mainimage/thumbs/moneyman.webp',
            per: { gems: 5 }, offering: 'gold_ore', lore: 'Every gem lost in the world rolls downhill toward its hoard.' },
        nyx: { name: 'Nyx', title: 'the Night Between', icon: '🌙', color: '#b07dff', face: 'mainimage/thumbs/divinecollector.webp',
            per: { golden: 2 }, offering: 'bat_wing', lore: 'Between one prestige and the next there is a dark moment. She keeps it, and one door with it.' },
        // The hidden god, in the room behind the Hall's far wall. It blesses nothing on its own: it makes every Divine upgrade
        // (divine, added to the Divine Prophit's boost in main.js) and every other god (gods) stronger. Every level needs
        // Shards of the Hidden, which Frozen WH drops now and then (hiddenCost).
        briley: { name: 'Briley', title: 'the Hidden Prophet', icon: '👁️', color: '#3dffb4', face: 'mainimage/thumbs/brileyism.webp', hidden: true,
            per: { divine: 5, gods: 5 }, lore: 'He was a prophet before he was a god, and his faith outlived his name. Every power the faithful honour grows a little when he does.' },
    };
    const GOD_ORDER = Object.keys(GODS);
    // the six statues in the Hall itself (the hidden one has its own room)
    const HALL_GODS = GOD_ORDER.filter(id => !GODS[id].hidden);
    const EFFECTS = {
        cps: '% CPS', click: '% click power', critChance: '% critical click chance', critDmg: '% critical click damage',
        offline: '% offline earnings', gems: '% chance to find gems', golden: '% Golden What Happened from prestige',
        divine: '% to every Divine upgrade', gods: '% to every other god\'s blessing',
    };
    // the effects that amplify others; the other gods' blessings are multiplied by (1 + gods / 100)
    const AMPLIFIERS = { divine: true, gods: true };

    // What every statue needs to reach each level (index = that level), on top of rubies and its offering. The boss trophies
    // come from The Overgrown (5), Gilded Golem (7), Inferno WH (9) and Frozen WH (10). Past 10, lateMats.
    const LEVEL_MATS = [
        null,
        { oak_plank: 4, copper_bar: 2 },
        { oak_plank: 6, copper_bar: 4 },
        { iron_bar: 4, leather: 2 },
        { iron_bar: 6, golem_core: 1 },
        { silver_bar: 3, heartwood_seed: 1 },
        { ember_bar: 2, obsidian: 4 },
        { ember_bar: 4, gilded_heart: 1 },
        { mithril_bar: 2, frost_crystal: 3 },
        { mithril_bar: 3, inferno_horn: 1 },
        { mithril_bar: 4, frozen_tear: 1, star_fragment: 1 },
    ];
    // past level 10: more of Frostveil's best each level, and a Frozen Tear every other level
    function lateMats(level) {
        const k = level - 10;
        return { mithril_bar: 4 + k, frozen_tear: 1 + Math.floor(k / 2), star_fragment: 1 + Math.floor(k / 4) };
    }
    const RUBIES = { base: 250, growth: 1.5 };
    // the hidden god: dearer from the start, and Shards of the Hidden every level (1, 1, 2, 2, 3, 3...)
    function hiddenCost(level) {
        return {
            rubies: Math.round(3000 * Math.pow(1.6, level - 1) / 100) * 100,
            mats: Object.assign({ hidden_shard: Math.ceil(level / 2), star_fragment: 1 + Math.floor(level / 2), mithril_bar: 1 + level }, level >= 3 ? { frozen_tear: level - 2 } : {}),
        };
    }

    const clampLevel = (v) => Math.max(0, Math.min(LEVEL_CAP, Math.floor(Number(v) || 0)));
    // The cost of raising a statue to a level (1 and up): { rubies, mats }, or null for an unknown god or level
    function costFor(id, level) {
        const g = GODS[id];
        if (!g || !(level >= 1 && level <= LEVEL_CAP) || Math.floor(level) !== level) return null;
        if (g.hidden) return hiddenCost(level);
        const mats = Object.assign({}, level <= 10 ? LEVEL_MATS[level] : lateMats(level));
        if (level >= 3) mats[g.offering] = (mats[g.offering] || 0) + 2 * level;
        return { rubies: Math.round(RUBIES.base * Math.pow(RUBIES.growth, level - 1) / 10) * 10, mats };
    }
    // Statue levels from a Wilds save (or anything: unknown gods and junk become 0)
    function levelsFrom(world) {
        const raw = world && typeof world === 'object' && world.gods && typeof world.gods === 'object' ? world.gods : {};
        const out = {};
        for (const id of GOD_ORDER) out[id] = clampLevel(raw[id]);
        return out;
    }
    // How much the amplifying gods raise the others' blessings (1 = not at all)
    function godsAmp(levels) {
        let amp = 1;
        for (const id of GOD_ORDER) amp += (GODS[id].per.gods || 0) * clampLevel(levels && levels[id]) / 100;
        return amp;
    }
    // Every blessing the statues give together: { cps, click, critChance, critDmg, offline, gems, golden, divine, gods }.
    // The other gods' blessings already include the amplifying gods' share.
    function bonuses(levels) {
        const out = {}, amp = godsAmp(levels);
        for (const k in EFFECTS) out[k] = 0;
        for (const id of GOD_ORDER) {
            const lv = clampLevel(levels && levels[id]);
            for (const k in GODS[id].per) out[k] += GODS[id].per[k] * lv * (AMPLIFIERS[k] ? 1 : amp);
        }
        return out;
    }
    // "+15% CPS" for a god at a level ('' at level 0). levels: every statue's level, to count the amplifying gods in.
    function describe(id, level, levels) {
        const g = GODS[id], lv = clampLevel(level);
        if (!g || !lv) return '';
        const amp = levels ? godsAmp(levels) : 1;
        return Object.keys(g.per).map(k => '+' + Math.round(g.per[k] * lv * (AMPLIFIERS[k] ? 1 : amp) * 10) / 10 + EFFECTS[k]).join(', ');
    }

    return { LEVEL_CAP, GODS, GOD_ORDER, HALL_GODS, EFFECTS, LEVEL_MATS, RUBIES, costFor, levelsFrom, godsAmp, bonuses, describe };
}));
