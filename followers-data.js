/**
 * What Happened followers: species, rarities, packs, breeding/levelling rules, buff math and art.
 * Shared by followers.html (collection, packs, breeding) and index.html (main.js applies equipped buffs).
 * Follower data lives in its own localStorage key so prestige and the main autosave never touch it.
 */
(function () {
    'use strict';

    const STORAGE_KEY = 'whathappened_followers';
    // Written whenever the followers page spends Golden, so a main-game tab that is open at the same
    // time can apply the same change instead of saving its stale Golden count over it.
    const GOLDEN_DELTA_KEY = 'whathappened_golden_delta';
    const SAVE_KEY = 'whathappened_save';
    const SAVE_KEY_LEGACY = 'whathappened_save_v1';

    const START_SLOTS = 2;
    const MAX_SLOTS = 8;
    const SLOT_COSTS = [2, 5, 10, 20, 40, 80]; // Golden for slots 3..8
    const INVENTORY_CAP = 200;
    const BREEDS_PER_FOLLOWER = 3;
    const PITY_LIMIT = 60; // followers rolled without a Legendary+ before one is guaranteed
    const NURSERY_SLOTS = 3; // eggs that can incubate at once
    const MINUTE = 60 * 1000, HOUR = 60 * MINUTE;
    // Hatch time is the sum of both parents' times, so Common + Common = 5 min and Mythic + Mythic = 12 h
    const HATCH_TIME_BY_RARITY = [2.5 * MINUTE, 7.5 * MINUTE, 20 * MINUTE, HOUR, 3 * HOUR, 6 * HOUR];
    const SHINY_MULT = 1.25;

    const RARITIES = [
        { id: 'common', name: 'Common', color: '#b4bccd', maxLevel: 10, feedXp: 20 },
        { id: 'uncommon', name: 'Uncommon', color: '#4fd27a', maxLevel: 15, feedXp: 50 },
        { id: 'rare', name: 'Rare', color: '#4fa8ff', maxLevel: 20, feedXp: 120 },
        { id: 'epic', name: 'Epic', color: '#b07dff', maxLevel: 25, feedXp: 300 },
        { id: 'legendary', name: 'Legendary', color: '#ffc83d', maxLevel: 30, feedXp: 800 },
        { id: 'mythic', name: 'Mythic', color: '#ff5bd0', maxLevel: 40, feedXp: 2400 },
    ];

    // Buff values are percentages at level 1, indexed by rarity. Crit chance is in percentage points.
    // growth = extra fraction of the base gained per level (0.2 -> level 10 is 2.8x level 1).
    const BUFFS = {
        cps: { label: 'CPS', base: [15, 30, 60, 120, 250, 600], growth: 0.2 },
        click: { label: 'Click power', base: [20, 40, 80, 160, 330, 800], growth: 0.2 },
        both: { label: 'CPS & click', base: [10, 20, 40, 80, 165, 400], growth: 0.2 },
        offline: { label: 'Offline earnings', base: [20, 40, 75, 125, 200, 450], growth: 0.2 },
        critChance: { label: 'Crit chance', base: [0.5, 1, 1.5, 2.5, 4, 6], growth: 0.06, points: true },
        critDmg: { label: 'Crit damage', base: [25, 50, 100, 200, 400, 900], growth: 0.2 },
        gems: { label: 'Gem drop rate', base: [25, 50, 100, 175, 300, 700], growth: 0.15 },
        golden: { label: 'Golden from prestige', base: [2, 3, 5, 8, 12, 20], growth: 0.1 },
    };
    const SECONDARY_BUFF_STRENGTH = 0.5; // Legendary/Mythic second buff
    const SYNERGY_PER_MATE = 0.1; // +10% per other equipped follower of the same family
    const BLOODLINE_PER_GEN = 0.03; // bred followers: +3% per generation after the first
    const BLOODLINE_MAX = 0.3;

    const FAMILIES = {
        swamp: { name: 'Swamp', icon: '🌿', bg: ['#3f9a55', '#0b2715'], blurb: 'Bog dwellers that keep the What Happeneds flowing while you idle.' },
        ember: { name: 'Ember', icon: '🔥', bg: ['#ff7a2f', '#3a0b05'], blurb: 'Hot-headed clickers. Click power and crit damage.' },
        frost: { name: 'Frost', icon: '❄️', bg: ['#7ad6ff', '#0c2843'], blurb: 'Patient and cold. Big offline earnings.' },
        storm: { name: 'Storm', icon: '⚡', bg: ['#8b6bff', '#150b3b'], blurb: 'Crackling with crit chance.' },
        void: { name: 'Void', icon: '🌌', bg: ['#62309f', '#05010e'], blurb: 'From beyond. More Golden every prestige.' },
        glitch: { name: 'Glitch', icon: '👾', bg: ['#14c47c', '#03140d'], blurb: 'Corrupted code that finds gems.' },
        chad: { name: 'Chad', icon: '💪', bg: ['#ffcf5a', '#3a2604'], blurb: 'Unbothered. Moisturised. Huge crits.' },
        bakery: { name: 'Bakery', icon: '🥖', bg: ['#f2a85a', '#4a2408'], blurb: 'Freshly baked boosts to CPS and clicks.' },
    };
    const FAMILY_IDS = Object.keys(FAMILIES);

    // [name, family, rarity, buffs, skin, belly, accent, eye, outfit, head, eyes, mouth, horns, accessory, pattern]
    const SPECIES_TABLE = [
        // ---- Swamp ----
        ['Puddle Pete', 'swamp', 0, ['cps'], '#5fb85a', '#d8efb0', '#3d7a3a', '#1b1b1b', '#4b6b8a', 'round', 'round', 'shock', 'nubs', 'none', 'spots'],
        ['Mossy Mike', 'swamp', 0, ['offline'], '#6f9e3c', '#cde39a', '#3f5e1f', '#1b1b1b', '#6b4a2a', 'wide', 'sleepy', 'smirk', 'none', 'flower', 'stripes'],
        ['Bog Bartholomew', 'swamp', 1, ['cps'], '#4c8a68', '#bfe0c0', '#2d5a40', '#1b1b1b', '#2e3b55', 'round', 'big', 'grin', 'spikes', 'tophat', 'scales'],
        ['Lily Lurker', 'swamp', 1, ['offline'], '#7cc47a', '#eaf7c9', '#e86fa8', '#1b1b1b', '#3f7a8c', 'tall', 'round', 'o', 'crest', 'bowtie', 'spots'],
        ['Marsh Marauder', 'swamp', 2, ['cps'], '#3f7a46', '#c8dca0', '#8a5a2b', '#1b1b1b', '#5a3a1a', 'wide', 'angry', 'fangs', 'horns', 'bandana', 'none'],
        ['Reed Whisperer', 'swamp', 2, ['offline'], '#8ab866', '#f0f5d0', '#c9a64a', '#226644', '#4a6b3a', 'tall', 'sleepy', 'smirk', 'dreads', 'scarf', 'stripes'],
        ['Swampy Steve, Esq.', 'swamp', 3, ['cps'], '#5aa05a', '#e1f0c0', '#2b5d2b', '#1b1b1b', '#1d1d2b', 'round', 'round', 'grin', 'nubs', 'monocle', 'scales'],
        ['The Bogfather', 'swamp', 4, ['cps', 'offline'], '#40704a', '#c6d8b0', '#2a2a2a', '#1b1b1b', '#151515', 'wide', 'angry', 'smirk', 'spikes', 'fedora', 'scales'],
        ['Hist Ascendant', 'swamp', 5, ['cps', 'offline'], '#2fd07a', '#eafff0', '#ffd84d', '#7dfcff', '#0e5a3a', 'tall', 'glow', 'shock', 'dreads', 'halo', 'scales'],
        // ---- Ember ----
        ['Ashy Andy', 'ember', 0, ['click'], '#d0643a', '#ffd0a8', '#6b2a14', '#1b1b1b', '#4a2a2a', 'round', 'round', 'shock', 'nubs', 'none', 'spots'],
        ['Spark Plug', 'ember', 0, ['critDmg'], '#ff8a3d', '#ffe1b8', '#ffd23d', '#1b1b1b', '#3a3a3a', 'wide', 'big', 'grin', 'crest', 'none', 'stripes'],
        ['Cinder Sally', 'ember', 1, ['click'], '#c4462c', '#ffc7a0', '#ffb13d', '#1b1b1b', '#7a1f1f', 'round', 'sleepy', 'blep', 'horns', 'flower', 'none'],
        ['Toasty Tim', 'ember', 1, ['critDmg'], '#e07b39', '#ffe0b0', '#8a3a1a', '#1b1b1b', '#c94a2a', 'wide', 'round', 'o', 'spikes', 'beanie', 'spots'],
        ['Magma Marv', 'ember', 2, ['click'], '#8f2a1c', '#ff9a4d', '#ffcf3d', '#ffde59', '#2a0d08', 'wide', 'glow', 'fangs', 'horns', 'none', 'cracks'],
        ['Blaze Bandit', 'ember', 2, ['critDmg'], '#d94f2b', '#ffcca3', '#2a2a2a', '#1b1b1b', '#2a2a2a', 'round', 'angry', 'smirk', 'spikes', 'bandana', 'stripes'],
        ['Inferno Ingrid', 'ember', 3, ['click'], '#ff5a2a', '#ffd9a8', '#ffd23d', '#fff2a8', '#5a0f0a', 'tall', 'star', 'grin', 'frill', 'scarf', 'none'],
        ['Pyro Pharaoh', 'ember', 4, ['click', 'critDmg'], '#b8361f', '#ffbf7a', '#ffcf3d', '#ffde59', '#1f3a8a', 'tall', 'glow', 'smirk', 'none', 'pharaoh', 'cracks'],
        ['The Eternal Ember', 'ember', 5, ['click', 'critDmg'], '#ff4d1f', '#fff0c0', '#ffe066', '#ffffff', '#ff9a1f', 'round', 'glow', 'shock', 'frill', 'halo', 'cracks'],
        // ---- Frost ----
        ['Chilly Chuck', 'frost', 0, ['offline'], '#8fd3f0', '#f0fbff', '#4a8fb8', '#1b1b1b', '#3a5a8a', 'round', 'round', 'o', 'nubs', 'beanie', 'spots'],
        ['Sleet Sid', 'frost', 0, ['cps'], '#a6c8e0', '#ffffff', '#5a7a9a', '#1b1b1b', '#5a6b7a', 'wide', 'sleepy', 'smirk', 'spikes', 'scarf', 'none'],
        ['Frostbite Fran', 'frost', 1, ['offline'], '#6fc0e8', '#e8f8ff', '#ffffff', '#1b1b1b', '#b84a6b', 'tall', 'big', 'blep', 'crest', 'earmuffs', 'none'],
        ['Icicle Ike', 'frost', 1, ['cps'], '#58a8d8', '#dff4ff', '#bfefff', '#1b1b1b', '#2a4a6a', 'round', 'angry', 'fangs', 'antlers', 'none', 'stripes'],
        ['Glacier Gus', 'frost', 2, ['offline'], '#3f8fc0', '#d0eeff', '#e8fbff', '#0a3a5a', '#1a3050', 'wide', 'sleepy', 'grin', 'horns', 'none', 'scales'],
        ['Blizzard Bea', 'frost', 2, ['cps'], '#9ad8f5', '#ffffff', '#5ac8ff', '#3a7aff', '#5a9ad8', 'tall', 'star', 'shock', 'frill', 'tiara', 'none'],
        ['Permafrost Paul', 'frost', 3, ['offline'], '#2f6f9a', '#bfe6ff', '#e0f7ff', '#99aaff', '#0d2a40', 'round', 'glow', 'fangs', 'horns', 'helmet', 'scales'],
        ['The Snow Sovereign', 'frost', 4, ['offline', 'cps'], '#bfe9ff', '#ffffff', '#7fd0ff', '#3a8fff', '#3a5aa8', 'tall', 'round', 'smirk', 'spikes', 'crown', 'none'],
        ['Absolute Zero', 'frost', 5, ['offline', 'cps'], '#e8f8ff', '#ffffff', '#7ff0ff', '#00e5ff', '#a8e8ff', 'round', 'glow', 'o', 'frill', 'halo', 'spots'],
        // ---- Storm ----
        ['Static Stan', 'storm', 0, ['critChance'], '#8a7ad8', '#e6defc', '#ffe14d', '#1b1b1b', '#4a3a8a', 'round', 'big', 'shock', 'crest', 'none', 'stripes'],
        ['Drizzle Dan', 'storm', 0, ['click'], '#6a8ac8', '#dfe8fa', '#4a6aa8', '#1b1b1b', '#2a3a6a', 'wide', 'sleepy', 'smirk', 'nubs', 'umbrella', 'none'],
        ['Thunder Theo', 'storm', 1, ['critChance'], '#7a5ae0', '#e2d8ff', '#ffe14d', '#1b1b1b', '#2a1a5a', 'round', 'angry', 'grin', 'horns', 'headband', 'none'],
        ['Gusty Gwen', 'storm', 1, ['click'], '#9ab0f0', '#eef2ff', '#ffffff', '#1b1b1b', '#6a5ab8', 'tall', 'round', 'blep', 'dreads', 'flower', 'none'],
        ['Volt Viper', 'storm', 2, ['critChance'], '#5a3ab8', '#c8b8ff', '#ffe14d', '#ffe14d', '#1a0d40', 'tall', 'glow', 'fangs', 'spikes', 'none', 'stripes'],
        ['Cyclone Cyrus', 'storm', 2, ['click'], '#6ab0d8', '#e0f4ff', '#3a6aa8', '#1b1b1b', '#3a3a6a', 'wide', 'spiral', 'o', 'crest', 'headphones', 'spots'],
        ['Tempest Tara', 'storm', 3, ['critChance'], '#8a5ae8', '#ece0ff', '#ffe14d', '#ffe14d', '#3a1a7a', 'tall', 'star', 'smirk', 'frill', 'tiara', 'stripes'],
        ['Thunderlord Zappius', 'storm', 4, ['critChance', 'click'], '#5a4ad0', '#d8d0ff', '#ffe14d', '#fff7a8', '#ffffff', 'wide', 'glow', 'grin', 'horns', 'laurel', 'none'],
        ['The Living Storm', 'storm', 5, ['critChance', 'critDmg'], '#3a2a8a', '#a89aff', '#ffe14d', '#ffffff', '#1a103a', 'round', 'glow', 'shock', 'dreads', 'none', 'cracks'],
        // ---- Void ----
        ['Gloom Gary', 'void', 0, ['golden'], '#4a3a6a', '#b8a8d8', '#2a1a40', '#1b1b1b', '#2a2a3a', 'round', 'sleepy', 'smirk', 'nubs', 'beanie', 'none'],
        ['Shade Shelby', 'void', 0, ['cps'], '#3a2a5a', '#9a88c8', '#7a5ab8', '#c8a8ff', '#1a1030', 'tall', 'glow', 'o', 'crest', 'hood', 'none'],
        ['Nebula Ned', 'void', 1, ['golden'], '#6a3ab8', '#e0c8ff', '#ff7ad8', '#1b1b1b', '#3a1a6a', 'round', 'star', 'grin', 'antlers', 'none', 'spots'],
        ['Eclipse Eve', 'void', 1, ['cps'], '#2a1a4a', '#8a78b8', '#ffcf3d', '#ffcf3d', '#0d0820', 'wide', 'glow', 'smirk', 'horns', 'tiara', 'stripes'],
        ['Star Eater Stu', 'void', 2, ['golden'], '#5a2a8a', '#d8b8ff', '#ffffff', '#1b1b1b', '#2a0d4a', 'wide', 'spiral', 'shock', 'spikes', 'none', 'spots'],
        ['Abyss Abby', 'void', 2, ['cps'], '#1f1440', '#7a68b0', '#38f8ff', '#38f8ff', '#05030d', 'tall', 'glow', 'fangs', 'dreads', 'hood', 'none'],
        ['Oblivion Otto', 'void', 3, ['golden'], '#3a1a6a', '#b8a0e8', '#ff4df2', '#ff4df2', '#14082a', 'round', 'spiral', 'o', 'frill', 'wizard', 'stripes'],
        ['The Void Emperor', 'void', 4, ['golden', 'cps'], '#140a2a', '#6a58a8', '#a77dff', '#d8b8ff', '#2a0d4a', 'tall', 'glow', 'smirk', 'horns', 'crown', 'scales'],
        ['Primordial What', 'void', 5, ['golden', 'cps'], '#0d0620', '#5a4a9a', '#ffffff', '#ffffff', '#1a0d3a', 'round', 'spiral', 'shock', 'frill', 'halo', 'spots'],
        // ---- Glitch ----
        ['Lag Larry', 'glitch', 0, ['gems'], '#4ac08a', '#d8ffe8', '#2a7a5a', '#1b1b1b', '#2a3a3a', 'round', 'sleepy', 'o', 'nubs', 'headphones', 'none'],
        ['Pixel Pam', 'glitch', 0, ['critChance'], '#38f8a8', '#e8fff4', '#ff3df2', '#1b1b1b', '#3a1a5a', 'round', 'big', 'grin', 'antenna', 'bowtie', 'spots'],
        ['Buffer Bob', 'glitch', 1, ['gems'], '#5ad8a8', '#e0fff0', '#2a8a6a', '#1b1b1b', '#1a3a5a', 'wide', 'round', 'smirk', 'none', 'shades', 'stripes'],
        ['Cache Kat', 'glitch', 1, ['critChance'], '#2ab88a', '#c8ffe8', '#ff3df2', '#ff3df2', '#2a0d3a', 'tall', 'visor', 'blep', 'crest', 'none', 'scales'],
        ['Null Pointer Nick', 'glitch', 2, ['gems'], '#1a8a6a', '#a8f0d8', '#38f8ff', '#38f8ff', '#0d1a1a', 'round', 'glow', 'fangs', 'antenna', 'none', 'stripes'],
        ['Firewall Fiona', 'glitch', 2, ['critChance'], '#ff6a3d', '#ffe0c8', '#38f8ff', '#38f8ff', '#1a1a3a', 'tall', 'visor', 'smirk', 'spikes', 'headphones', 'none'],
        ['Root Access Rex', 'glitch', 3, ['gems'], '#0d5a40', '#7ae8b8', '#38f8ff', '#38f8ff', '#050505', 'wide', 'visor', 'grin', 'horns', 'hood', 'scales'],
        ['The Mainframe', 'glitch', 4, ['gems', 'critChance'], '#2a3a4a', '#a8c8d8', '#38f8a8', '#38f8a8', '#1a2a3a', 'wide', 'glow', 'o', 'antenna', 'monocle', 'cracks'],
        ['WHAT.EXE', 'glitch', 5, ['gems', 'critChance'], '#ff3df2', '#ffd0f8', '#38f8ff', '#38f8ff', '#1a0d2a', 'round', 'visor', 'shock', 'crest', 'halo', 'spots'],
        // ---- Chad ----
        ['Gym Greg', 'chad', 0, ['critDmg'], '#d8a06a', '#ffe8c8', '#8a5a2a', '#1b1b1b', '#c83a3a', 'round', 'round', 'grin', 'nubs', 'headband', 'none'],
        ['Protein Pat', 'chad', 0, ['click'], '#e0b070', '#fff0d0', '#6a4a2a', '#1b1b1b', '#3a7ac8', 'wide', 'big', 'o', 'none', 'cap', 'spots'],
        ['Bench Press Brad', 'chad', 1, ['critDmg'], '#c8905a', '#ffe0b8', '#2a2a2a', '#1b1b1b', '#2a2a2a', 'wide', 'angry', 'grin', 'spikes', 'headband', 'stripes'],
        ['Flex Felix', 'chad', 1, ['click'], '#f0b878', '#fff4dc', '#8a5a2a', '#1b1b1b', '#ff9a1f', 'round', 'sleepy', 'smirk', 'crest', 'shades', 'none'],
        ['Sigma Sam', 'chad', 2, ['critDmg'], '#b88a5a', '#f0d8b8', '#1a1a1a', '#1b1b1b', '#1a1a1a', 'tall', 'tiny', 'smirk', 'none', 'chain', 'none'],
        ['Jawline Jared', 'chad', 2, ['click'], '#d0a070', '#ffecd0', '#3a2a1a', '#1b1b1b', '#3a5a8a', 'wide', 'round', 'grin', 'nubs', 'cap', 'scales'],
        ['Gigachad Gerald', 'chad', 3, ['critDmg'], '#a87a4a', '#e8c8a0', '#1a1a1a', '#1b1b1b', '#1a1a1a', 'wide', 'tiny', 'smirk', 'crest', 'chain', 'stripes'],
        ['The Unbothered', 'chad', 4, ['critDmg', 'click'], '#c89a6a', '#f8e4c8', '#ffd23d', '#1b1b1b', '#f5f5f5', 'round', 'sleepy', 'smirk', 'none', 'shades', 'scales'],
        ['Ascended Sigma', 'chad', 5, ['critDmg', 'critChance'], '#ffd23d', '#fff4c8', '#ffffff', '#ffffff', '#ffcf3d', 'wide', 'glow', 'smirk', 'crest', 'halo', 'none'],
        // ---- Bakery ----
        ['Crusty Carl', 'bakery', 0, ['both'], '#d89a5a', '#f8e0b8', '#8a4a1a', '#1b1b1b', '#f5f5f5', 'round', 'round', 'grin', 'nubs', 'chef', 'spots'],
        ['Bagel Bill', 'bakery', 0, ['offline'], '#c8843a', '#f0d0a0', '#6a3a10', '#1b1b1b', '#3a6ac8', 'round', 'sleepy', 'o', 'none', 'beanie', 'spots'],
        ['Sourdough Sue', 'bakery', 1, ['both'], '#e8b878', '#fff4dc', '#a86a2a', '#1b1b1b', '#c84a6a', 'tall', 'big', 'blep', 'crest', 'flower', 'stripes'],
        ['Croissant Cosmo', 'bakery', 1, ['offline'], '#e0a050', '#ffe8b8', '#b86a1a', '#1b1b1b', '#3a3a3a', 'wide', 'round', 'smirk', 'horns', 'beret', 'stripes'],
        ['Baguette Baron', 'bakery', 2, ['both'], '#d8a060', '#fff0d0', '#8a5a2a', '#1b1b1b', '#1a1a3a', 'tall', 'round', 'smirk', 'none', 'tophat', 'scales'],
        ['Muffin Max', 'bakery', 2, ['offline'], '#a8603a', '#f8d8b0', '#ff7aa8', '#1b1b1b', '#7a4aa8', 'round', 'big', 'grin', 'spikes', 'party', 'spots'],
        ['Pretzel Prophet', 'bakery', 3, ['both'], '#b8763a', '#f0d0a0', '#ffffff', '#7a3a10', '#5a3a1a', 'tall', 'star', 'o', 'antlers', 'wizard', 'spots'],
        ['The Grand Loaf', 'bakery', 4, ['both', 'offline'], '#e0a050', '#fff0d0', '#ffd23d', '#1b1b1b', '#f5f5f5', 'wide', 'sleepy', 'grin', 'none', 'crown', 'stripes'],
        ['Infinite Bakery', 'bakery', 5, ['both', 'golden'], '#ffcf8a', '#fffaf0', '#ffd23d', '#ffffff', '#ffffff', 'round', 'glow', 'shock', 'frill', 'halo', 'spots'],
    ];

    function slug(name) { return name.toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/^_|_$/g, ''); }

    const SPECIES = SPECIES_TABLE.map((row, index) => ({
        id: slug(row[0]), index, name: row[0], family: row[1], rarity: row[2], buffs: row[3],
        skin: row[4], belly: row[5], accent: row[6], eye: row[7], outfit: row[8],
        head: row[9], eyes: row[10], mouth: row[11], horns: row[12], acc: row[13], pattern: row[14],
        img: null, // set to an image path to replace the drawn art with a picture
    }));
    const SPECIES_BY_ID = {};
    SPECIES.forEach(s => { SPECIES_BY_ID[s.id] = s; });

    const PACKS = [
        { id: 'sack', name: 'Scrappy Sack', icon: '👜', cost: 1, count: 1, cooldown: 10 * MINUTE, weights: [64, 27, 7, 1.7, 0.3, 0], families: null,
            colors: ['#a07a52', '#3a2814'], desc: 'One follower from any family. The cheap way to start a team or get level-up fodder.' },
        { id: 'clicker', name: 'Clicker Crate', icon: '👆', cost: 4, count: 3, cooldown: 2 * HOUR, weights: [45, 33, 16, 5, 1, 0], families: ['ember', 'storm', 'chad'], guarantee: 1,
            colors: ['#ff7a2f', '#5a1a08'], desc: 'Ember, Storm and Chad followers: click power, crit chance and crit damage. At least one Uncommon or better.' },
        { id: 'idler', name: 'Idler Crate', icon: '💤', cost: 4, count: 3, cooldown: 2 * HOUR, weights: [45, 33, 16, 5, 1, 0], families: ['swamp', 'frost', 'bakery'], guarantee: 1,
            colors: ['#3f9a55', '#0b2715'], desc: 'Swamp, Frost and Bakery followers: CPS and offline earnings. At least one Uncommon or better.' },
        { id: 'oddity', name: 'Oddity Crate', icon: '🔮', cost: 5, count: 3, cooldown: 3 * HOUR, weights: [45, 33, 16, 5, 1, 0], families: ['void', 'glitch'], guarantee: 1,
            colors: ['#7a3ad0', '#0d0420'], desc: 'Void and Glitch followers: extra Golden from prestige and gem drops. At least one Uncommon or better.' },
        { id: 'royal', name: 'Royal Chest', icon: '👑', cost: 10, count: 3, cooldown: 12 * HOUR, weights: [0, 0, 72, 22, 5.5, 0.5], families: null,
            colors: ['#ffc83d', '#6a3a00'], desc: 'Three followers from any family, every one Rare or better.' },
        { id: 'celestial', name: 'Celestial Relic', icon: '🌠', cost: 25, count: 2, cooldown: 48 * HOUR, weights: [0, 0, 0, 78, 20, 2], families: null,
            colors: ['#ff5bd0', '#2a0638'], desc: 'Two followers, Epic or better, with the best Mythic odds of any pack.' },
    ];
    const PACKS_BY_ID = {};
    PACKS.forEach(p => { PACKS_BY_ID[p.id] = p; });

    // ---------------- state ----------------
    function defaultState() {
        return { v: 1, nextId: 1, nextEggId: 1, slots: START_SLOTS, equipped: [null, null], list: [], pity: 0, opened: 0, bred: 0, seen: {}, packReadyAt: {}, nursery: [] };
    }
    function loadState() {
        let s = null;
        try { s = JSON.parse(localStorage.getItem(STORAGE_KEY) || 'null'); } catch (e) { s = null; }
        if (!s || typeof s !== 'object') s = defaultState();
        const d = defaultState();
        for (const k in d) if (s[k] === undefined) s[k] = d[k];
        if (!Array.isArray(s.list)) s.list = [];
        s.list = s.list.filter(f => f && SPECIES_BY_ID[f.sp]);
        s.slots = Math.max(START_SLOTS, Math.min(MAX_SLOTS, Number(s.slots) || START_SLOTS));
        if (!Array.isArray(s.equipped)) s.equipped = [];
        const ids = new Set(s.list.map(f => f.id));
        const used = new Set();
        s.equipped = Array.from({ length: s.slots }, (_, i) => {
            const id = s.equipped[i];
            if (id == null || !ids.has(id) || used.has(id)) return null;
            used.add(id);
            return id;
        });
        // timers: drop broken entries, and pull anything further out than its full duration back in
        // (protects against a clock that was set far ahead and then corrected)
        const now = Date.now();
        if (!s.packReadyAt || typeof s.packReadyAt !== 'object') s.packReadyAt = {};
        for (const id in s.packReadyAt) {
            const pack = PACKS_BY_ID[id], t = Number(s.packReadyAt[id]);
            if (!pack || !isFinite(t)) delete s.packReadyAt[id];
            else if (t > now + pack.cooldown) s.packReadyAt[id] = now + pack.cooldown;
        }
        if (!Array.isArray(s.nursery)) s.nursery = [];
        s.nursery = s.nursery.filter(e => e && e.child && SPECIES_BY_ID[e.child.sp] && isFinite(Number(e.readyAt)));
        s.nursery.forEach(e => { const dur = Number(e.duration) || 0; if (e.readyAt > now + dur) e.readyAt = now + dur; });
        s.nextEggId = Math.max(Number(s.nextEggId) || 1, ...s.nursery.map(e => (Number(e.id) || 0) + 1), 1);
        return s;
    }
    function saveState(s) {
        try { localStorage.setItem(STORAGE_KEY, JSON.stringify(s)); } catch (e) {}
    }
    function findFollower(s, id) { return s.list.find(f => f.id === id) || null; }
    function isEquipped(s, id) { return s.equipped.indexOf(id) !== -1; }

    // ---------------- main-save Golden helpers ----------------
    function readMainSave() {
        try {
            const raw = localStorage.getItem(SAVE_KEY) || localStorage.getItem(SAVE_KEY_LEGACY);
            return raw ? JSON.parse(raw) : null;
        } catch (e) { return null; }
    }
    function getGolden() {
        const s = readMainSave();
        return s ? Math.max(0, Math.floor(Number(s.goldenWhat) || 0)) : 0;
    }
    // Spend Golden from the main save. Returns false (and changes nothing) if the player can't afford it.
    function spendGolden(amount) {
        const s = readMainSave();
        if (!s) return false;
        const have = Math.floor(Number(s.goldenWhat) || 0);
        if (have < amount) return false;
        s.goldenWhat = have - amount;
        const payload = JSON.stringify(s);
        try {
            localStorage.setItem(SAVE_KEY, payload);
            try { localStorage.setItem(SAVE_KEY_LEGACY, payload); } catch (e) {}
            localStorage.setItem(GOLDEN_DELTA_KEY, JSON.stringify({ id: Date.now() + '-' + Math.random().toString(36).slice(2), delta: -amount }));
        } catch (e) { return false; }
        return true;
    }

    // ---------------- levelling ----------------
    function maxLevel(f) { return RARITIES[SPECIES_BY_ID[f.sp].rarity].maxLevel; }
    // XP needed to go from `lvl` to `lvl + 1`
    function xpForLevel(lvl, rarity) { return Math.round((4 + 2 * lvl) * (1 + 0.5 * rarity)); }
    function investedXp(f) {
        const r = SPECIES_BY_ID[f.sp].rarity;
        let t = Number(f.xp) || 0;
        for (let l = 1; l < f.lvl; l++) t += xpForLevel(l, r);
        return t;
    }
    // XP a target gains from sacrificing `fodder`: rarity base + 60% of what was invested in the fodder,
    // x1.5 for the same species (x1.2 same family), x2 for shiny fodder.
    function feedValue(fodder, target) {
        const fs = SPECIES_BY_ID[fodder.sp], ts = SPECIES_BY_ID[target.sp];
        let xp = RARITIES[fs.rarity].feedXp + Math.floor(0.6 * investedXp(fodder));
        if (fs.id === ts.id) xp *= 1.5; else if (fs.family === ts.family) xp *= 1.2;
        if (fodder.shiny) xp *= 2;
        return Math.floor(xp);
    }
    // Level/XP a follower would end at after gaining `xp` (capped at max level; leftover is wasted)
    function previewLevel(f, xp) {
        const r = SPECIES_BY_ID[f.sp].rarity, max = maxLevel(f);
        let lvl = f.lvl, cur = (Number(f.xp) || 0) + xp, wasted = 0;
        while (lvl < max && cur >= xpForLevel(lvl, r)) { cur -= xpForLevel(lvl, r); lvl++; }
        if (lvl >= max) { wasted = cur; cur = 0; }
        return { lvl, xp: cur, wasted };
    }

    // ---------------- buffs ----------------
    function bloodline(f) { return Math.min(BLOODLINE_MAX, BLOODLINE_PER_GEN * Math.max(0, (Number(f.gen) || 1) - 1)); }
    // [{type, value}] for one follower; `synergy` = number of other equipped followers from the same family
    function followerBuffs(f, synergy) {
        const sp = SPECIES_BY_ID[f.sp];
        const mult = (f.shiny ? SHINY_MULT : 1) * (1 + bloodline(f)) * (1 + SYNERGY_PER_MATE * (synergy || 0));
        return sp.buffs.map((type, i) => {
            const b = BUFFS[type];
            const v = b.base[sp.rarity] * (1 + b.growth * (Math.max(1, f.lvl) - 1)) * mult * (i === 0 ? 1 : SECONDARY_BUFF_STRENGTH);
            return { type, value: v };
        });
    }
    function equippedFollowers(s) { return s.equipped.map(id => (id == null ? null : findFollower(s, id))).filter(Boolean); }
    function synergyFor(s, f) {
        const fam = SPECIES_BY_ID[f.sp].family;
        return equippedFollowers(s).filter(o => o.id !== f.id && SPECIES_BY_ID[o.sp].family === fam).length;
    }
    // Totals the main game applies. All values are percentages (crit chance in percentage points).
    function computeBonuses(s) {
        const t = { cps: 0, click: 0, offline: 0, critChance: 0, critDmg: 0, gems: 0, golden: 0, count: 0 };
        const eq = equippedFollowers(s);
        eq.forEach(f => {
            followerBuffs(f, synergyFor(s, f)).forEach(b => {
                if (b.type === 'both') { t.cps += b.value; t.click += b.value; } else t[b.type] += b.value;
            });
        });
        t.count = eq.length;
        return t;
    }
    function fmtBuff(type, value) {
        const b = BUFFS[type];
        const v = b.points ? (Math.round(value * 10) / 10) : Math.round(value);
        return '+' + v.toLocaleString() + '% ' + b.label;
    }

    // ---------------- rolling ----------------
    function pickWeighted(weights, rng) {
        const total = weights.reduce((a, w) => a + w, 0);
        let x = (rng || Math.random)() * total;
        for (let i = 0; i < weights.length; i++) { x -= weights[i]; if (x < 0 && weights[i] > 0) return i; }
        for (let i = weights.length - 1; i >= 0; i--) if (weights[i] > 0) return i;
        return 0;
    }
    function speciesPool(rarity, families) {
        return SPECIES.filter(sp => sp.rarity === rarity && (!families || families.indexOf(sp.family) !== -1));
    }
    function newFollower(s, spId, extra) {
        const f = Object.assign({ id: s.nextId++, sp: spId, lvl: 1, xp: 0, shiny: false, gen: 1, breeds: BREEDS_PER_FOLLOWER, locked: false, parents: null, got: Date.now() }, extra || {});
        s.list.push(f);
        s.seen[spId] = true;
        return f;
    }
    // ms until `packId` can be opened again (0 = ready)
    function packWait(s, packId) { return Math.max(0, (Number(s.packReadyAt && s.packReadyAt[packId]) || 0) - Date.now()); }
    // Open a pack into state `s` (caller has already paid and checked packWait). Starts the pack's cooldown.
    // Returns the new followers, each with an isNew flag.
    function openPack(s, packId) {
        const pack = PACKS_BY_ID[packId];
        if (!s.packReadyAt) s.packReadyAt = {};
        s.packReadyAt[packId] = Date.now() + pack.cooldown;
        const out = [];
        for (let i = 0; i < pack.count; i++) {
            let weights = pack.weights.slice();
            // the guarantee applies to the last card if nothing Uncommon+ has shown up yet
            if (pack.guarantee && i === pack.count - 1 && !out.some(f => SPECIES_BY_ID[f.sp].rarity >= pack.guarantee)) {
                weights = weights.map((w, r) => (r >= pack.guarantee ? w : 0));
            }
            // pity: a Legendary is guaranteed (Mythic keeps the pack's own odds, so it's only possible where the pack allows it)
            if (s.pity >= PITY_LIMIT - 1) weights = weights.map((w, r) => (r < 4 ? 0 : (r === 4 ? Math.max(w, 1) : w)));
            const rarity = pickWeighted(weights);
            s.pity = rarity >= 4 ? 0 : s.pity + 1;
            const pool = speciesPool(rarity, pack.families);
            const sp = pool[Math.floor(Math.random() * pool.length)];
            const isNew = !s.seen[sp.id];
            const f = newFollower(s, sp.id, { shiny: Math.random() < 0.02 });
            out.push(Object.assign({}, f, { isNew }));
        }
        s.opened = (Number(s.opened) || 0) + 1;
        return out;
    }

    // ---------------- breeding ----------------
    const BREED_COSTS = [1, 2, 3, 5, 8, 12]; // Golden, by the parents' average rarity (rounded down)
    function breedCost(a, b) { return BREED_COSTS[Math.floor((SPECIES_BY_ID[a.sp].rarity + SPECIES_BY_ID[b.sp].rarity) / 2)]; }
    // Odds for a pairing: {rarity: [p per rarity], family: {famId: p}, shiny, cost, sameSpecies}
    // The baby's rarity is the parents' average (a half rounds either way 50/50), then it may go one higher.
    // Basing it on the average (not the rarer parent) stops a Legendary + Common from mass-producing Legendaries.
    function breedOdds(a, b) {
        const sa = SPECIES_BY_ID[a.sp], sb = SPECIES_BY_ID[b.sp];
        const sameSpecies = sa.id === sb.id, sameFamily = sa.family === sb.family;
        const lvlFrac = (a.lvl / RARITIES[sa.rarity].maxLevel + b.lvl / RARITIES[sb.rarity].maxLevel) / 2;
        const pUp = 0.12 + (sameSpecies ? 0.12 : (sameFamily ? 0.05 : 0)) + 0.1 * lvlFrac;
        const avg = (sa.rarity + sb.rarity) / 2, base = Math.floor(avg), half = avg - base;
        const rarity = [0, 0, 0, 0, 0, 0];
        const addTier = (t, p) => {
            if (t >= 5) { rarity[5] += p; return; }
            rarity[t] += p * (1 - pUp);
            rarity[t + 1] += p * pUp;
        };
        addTier(base, 1 - half);
        if (half) addTier(base + 1, half);
        const family = {};
        const mutation = 0.1, others = FAMILY_IDS.filter(fm => fm !== sa.family && fm !== sb.family);
        if (sameFamily) family[sa.family] = 1 - mutation;
        else { family[sa.family] = (1 - mutation) / 2; family[sb.family] = (1 - mutation) / 2; }
        others.forEach(fm => { family[fm] = mutation / others.length; });
        const shiny = 0.03 + ((a.shiny || b.shiny) ? 0.07 : 0);
        return { rarity, family, shiny, cost: breedCost(a, b), sameSpecies };
    }
    function hatchTime(a, b) { return HATCH_TIME_BY_RARITY[SPECIES_BY_ID[a.sp].rarity] + HATCH_TIME_BY_RARITY[SPECIES_BY_ID[b.sp].rarity]; }
    function eggFor(s, followerId) { return (s.nursery || []).find(e => e.a === followerId || e.b === followerId) || null; }
    function eggReady(e) { return Date.now() >= Number(e.readyAt); }
    // Put an egg from a and b in the nursery (caller has already paid). The baby is decided now, so
    // reloading the page can't re-roll it. Returns the egg.
    function startBreed(s, a, b) {
        const child = rollChild(a, b);
        a.breeds = Math.max(0, (Number(a.breeds) || 0) - 1);
        b.breeds = Math.max(0, (Number(b.breeds) || 0) - 1);
        const duration = hatchTime(a, b), now = Date.now();
        const egg = { id: s.nextEggId++, a: a.id, b: b.id, spA: a.sp, spB: b.sp, startedAt: now, duration, readyAt: now + duration, child };
        s.nursery.push(egg);
        s.bred = (Number(s.bred) || 0) + 1;
        return egg;
    }
    // Hatch a finished egg into the collection. Returns the new follower (with isNew), or null if it isn't ready.
    function claimEgg(s, eggId) {
        const egg = s.nursery.find(e => e.id === eggId);
        if (!egg || !eggReady(egg)) return null;
        s.nursery = s.nursery.filter(e => e !== egg);
        const isNew = !s.seen[egg.child.sp];
        const f = newFollower(s, egg.child.sp, { shiny: !!egg.child.shiny, gen: egg.child.gen, parents: egg.child.parents });
        return Object.assign({}, f, { isNew });
    }
    // Decide the baby for a and b: {sp, shiny, gen, parents}
    function rollChild(a, b) {
        const odds = breedOdds(a, b);
        const r = pickWeighted(odds.rarity);
        const fams = Object.keys(odds.family);
        const fam = fams[pickWeighted(fams.map(k => odds.family[k]))];
        let sp;
        // a pair of the same species usually passes the species on when the rarity stays the same
        if (odds.sameSpecies && SPECIES_BY_ID[a.sp].rarity === r && SPECIES_BY_ID[a.sp].family === fam && Math.random() < 0.5) sp = SPECIES_BY_ID[a.sp];
        else {
            const pool = speciesPool(r, [fam]);
            sp = pool[Math.floor(Math.random() * pool.length)];
        }
        return {
            sp: sp.id,
            shiny: Math.random() < odds.shiny,
            gen: Math.max(Number(a.gen) || 1, Number(b.gen) || 1) + 1,
            parents: [a.sp, b.sp],
        };
    }

    // "1h 05m", "4m 09s", "2d 3h"
    function fmtDuration(ms) {
        const t = Math.max(0, Math.ceil(ms / 1000));
        const d = Math.floor(t / 86400), h = Math.floor((t % 86400) / 3600), m = Math.floor((t % 3600) / 60), sec = t % 60;
        const p2 = n => String(n).padStart(2, '0');
        if (d > 0) return `${d}d ${h}h`;
        if (h > 0) return `${h}h ${p2(m)}m`;
        if (m > 0) return `${m}m ${p2(sec)}s`;
        return `${sec}s`;
    }
    // "10 min", "2 hours", "48 hours" for fixed durations
    function fmtSpan(ms) {
        if (ms % HOUR === 0) { const h = ms / HOUR; return h + (h === 1 ? ' hour' : ' hours'); }
        if (ms >= HOUR) return fmtDuration(ms);
        const m = ms / MINUTE;
        return (Number.isInteger(m) ? m : m.toFixed(1)) + ' min';
    }

    // ---------------- art ----------------
    function hex6(c) { return c.length === 4 ? '#' + c[1] + c[1] + c[2] + c[2] + c[3] + c[3] : c; }
    // amt in -1..1: negative darkens toward black, positive lightens toward white
    function shade(c, amt) {
        const n = parseInt(hex6(c).slice(1), 16);
        let r = n >> 16, g = (n >> 8) & 255, b = n & 255;
        const t = amt < 0 ? 0 : 255, p = Math.abs(amt);
        r = Math.round(r + (t - r) * p); g = Math.round(g + (t - g) * p); b = Math.round(b + (t - b) * p);
        return '#' + ((1 << 24) | (r << 16) | (g << 8) | b).toString(16).slice(1);
    }
    function mulberry32(seed) {
        return function () {
            seed |= 0; seed = (seed + 0x6D2B79F5) | 0;
            let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
            t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
            return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
        };
    }
    const f1 = n => Math.round(n * 10) / 10;
    function sparkle(x, y, s, fill, op) {
        return `<path d="M${f1(x)} ${f1(y - s)}Q${f1(x)} ${f1(y)} ${f1(x + s)} ${f1(y)}Q${f1(x)} ${f1(y)} ${f1(x)} ${f1(y + s)}Q${f1(x)} ${f1(y)} ${f1(x - s)} ${f1(y)}Q${f1(x)} ${f1(y)} ${f1(x)} ${f1(y - s)}Z" fill="${fill}" opacity="${op}"/>`;
    }
    function starPoly(cx, cy, ro, ri, n) {
        const pts = [];
        for (let i = 0; i < n * 2; i++) {
            const a = -Math.PI / 2 + i * Math.PI / n, r = i % 2 ? ri : ro;
            pts.push(f1(cx + Math.cos(a) * r) + ',' + f1(cy + Math.sin(a) * r));
        }
        return pts.join(' ');
    }

    const HEADS = { round: { cy: 60, rx: 32, ry: 29 }, wide: { cy: 62, rx: 37, ry: 26 }, tall: { cy: 58, rx: 28, ry: 33 } };

    function motif(fam, rnd) {
        const o = [];
        if (fam === 'swamp') {
            o.push('<ellipse cx="60" cy="116" rx="72" ry="16" fill="#0f3d22" opacity=".7"/>');
            for (const [x, y, r] of [[14, 104, 9], [106, 108, 8]]) o.push(`<path d="M${x} ${y}m-${r} 0a${r} ${r * 0.55} 0 1 0 ${r * 2} 0a${r} ${r * 0.55} 0 1 0 -${r * 2} 0" fill="#2f8f45"/><path d="M${x} ${y}l${r} -2" stroke="#0f3d22" stroke-width="1.5"/>`);
            for (const x of [6, 12, 110, 116]) o.push(`<path d="M${x} 120Q${x - 2} 70 ${x + 3} ${40 + rnd() * 20}" stroke="#2d7a3c" stroke-width="2.5" fill="none" stroke-linecap="round"/>`);
            for (let i = 0; i < 6; i++) o.push(`<circle cx="${f1(10 + rnd() * 100)}" cy="${f1(10 + rnd() * 50)}" r="${f1(1.5 + rnd() * 2.5)}" fill="none" stroke="#c8ffd8" stroke-width="1" opacity=".35"/>`);
        } else if (fam === 'ember') {
            for (const [x, y, s] of [[18, 112, 1.2], [102, 114, 1.3], [34, 100, 0.8], [88, 100, 0.85]]) {
                o.push(`<path d="M${x} ${y}q${-12 * s} ${-16 * s} ${0} ${-40 * s}q${12 * s} ${24 * s} 0 ${40 * s}z" fill="#ff9a1f" opacity=".55"/>`);
                o.push(`<path d="M${x} ${y}q${-6 * s} ${-9 * s} 0 ${-22 * s}q${6 * s} ${13 * s} 0 ${22 * s}z" fill="#ffe066" opacity=".7"/>`);
            }
            for (let i = 0; i < 8; i++) o.push(`<circle cx="${f1(8 + rnd() * 104)}" cy="${f1(6 + rnd() * 60)}" r="${f1(0.8 + rnd() * 1.4)}" fill="#ffd27a" opacity=".8"/>`);
        } else if (fam === 'frost') {
            for (let i = 0; i < 7; i++) {
                const x = 8 + rnd() * 104, y = 6 + rnd() * 70, s = 3 + rnd() * 4;
                let d = '';
                for (let k = 0; k < 3; k++) { const a = k * Math.PI / 3; d += `M${f1(x - Math.cos(a) * s)} ${f1(y - Math.sin(a) * s)}L${f1(x + Math.cos(a) * s)} ${f1(y + Math.sin(a) * s)}`; }
                o.push(`<path d="${d}" stroke="#ffffff" stroke-width="1.2" opacity=".55" stroke-linecap="round"/>`);
            }
            o.push('<path d="M0 120L8 92L16 120ZM104 120L112 88L120 120ZM10 120L20 100L28 120Z" fill="#d8f6ff" opacity=".5"/>');
        } else if (fam === 'storm') {
            o.push('<path d="M14 18L26 18L18 36L28 36L10 64L16 42L6 42Z" fill="#ffe14d" opacity=".85"/>');
            o.push('<path d="M98 30L110 30L103 46L112 46L95 72L100 52L91 52Z" fill="#ffe14d" opacity=".75"/>');
            o.push('<ellipse cx="30" cy="10" rx="26" ry="9" fill="#ffffff" opacity=".12"/><ellipse cx="92" cy="12" rx="30" ry="10" fill="#ffffff" opacity=".1"/>');
        } else if (fam === 'void') {
            for (let i = 0; i < 26; i++) o.push(`<circle cx="${f1(rnd() * 120)}" cy="${f1(rnd() * 120)}" r="${f1(0.4 + rnd() * 1.1)}" fill="#ffffff" opacity="${f1(0.3 + rnd() * 0.6)}"/>`);
            o.push('<circle cx="60" cy="58" r="49" fill="none" stroke="#c8a8ff" stroke-width="2" opacity=".25" stroke-dasharray="3 5"/>');
            o.push(sparkle(18, 22, 4, '#ffffff', 0.8) + sparkle(100, 92, 3, '#ffffff', 0.7));
        } else if (fam === 'glitch') {
            for (let y = 2; y < 120; y += 5) o.push(`<rect x="0" y="${y}" width="120" height="1.2" fill="#38f8ff" opacity=".06"/>`);
            for (let i = 0; i < 12; i++) {
                const s = 3 + Math.floor(rnd() * 5);
                o.push(`<rect x="${Math.floor(rnd() * 114)}" y="${Math.floor(rnd() * 114)}" width="${s}" height="${s}" fill="${i % 2 ? '#ff3df2' : '#38f8ff'}" opacity=".45"/>`);
            }
            o.push('<rect x="0" y="34" width="22" height="3" fill="#ff3df2" opacity=".5"/><rect x="96" y="70" width="24" height="3" fill="#38f8ff" opacity=".5"/>');
        } else if (fam === 'chad') {
            for (let i = 0; i < 6; i++) { const a = -Math.PI / 2 + (i - 2.5) * 0.45; o.push(`<path d="M60 70L${f1(60 + Math.cos(a - 0.08) * 90)} ${f1(70 + Math.sin(a - 0.08) * 90)}L${f1(60 + Math.cos(a + 0.08) * 90)} ${f1(70 + Math.sin(a + 0.08) * 90)}Z" fill="#fff6d0" opacity=".12"/>`); }
            o.push(sparkle(16, 20, 6, '#fff3b0', 0.9) + sparkle(104, 28, 4.5, '#fff3b0', 0.8) + sparkle(100, 96, 3.5, '#fff3b0', 0.7) + sparkle(14, 88, 3, '#fff3b0', 0.6));
        } else if (fam === 'bakery') {
            for (const x of [10, 110]) {
                o.push(`<path d="M${x} 120L${x} 52" stroke="#e8c070" stroke-width="2"/>`);
                for (let k = 0; k < 5; k++) o.push(`<ellipse cx="${x - 3}" cy="${58 + k * 9}" rx="3" ry="5" fill="#f0c870" transform="rotate(-25 ${x - 3} ${58 + k * 9})"/><ellipse cx="${x + 3}" cy="${62 + k * 9}" rx="3" ry="5" fill="#e0b058" transform="rotate(25 ${x + 3} ${62 + k * 9})"/>`);
            }
            for (let i = 0; i < 9; i++) o.push(`<ellipse cx="${f1(20 + rnd() * 80)}" cy="${f1(6 + rnd() * 30)}" rx="${f1(1 + rnd() * 1.5)}" ry="${f1(0.8 + rnd())}" fill="#ffe0a8" opacity=".7"/>`);
        }
        return o.join('');
    }

    function eyesSvg(kind, h, S, E, dark, u) {
        const ey = h.cy - h.ry * 0.28, ex = h.rx * 0.44, o = [];
        if (kind === 'visor') {
            const x0 = 60 - ex - 11, w = 2 * ex + 22;
            o.push(`<rect x="${f1(x0)}" y="${f1(ey - 7)}" width="${f1(w)}" height="14" rx="7" fill="#101418" stroke="${dark}" stroke-width="1.5"/>`);
            o.push(`<rect x="${f1(x0 + 4)}" y="${f1(ey - 3)}" width="${f1(w - 8)}" height="6" rx="3" fill="${E}" opacity=".95"/>`);
            o.push(`<rect x="${f1(x0 + 6)}" y="${f1(ey - 2.4)}" width="${f1(w * 0.3)}" height="1.6" rx="0.8" fill="#ffffff" opacity=".8"/>`);
            return o.join('');
        }
        for (const s of [-1, 1]) {
            const x = 60 + s * ex;
            if (kind === 'tiny') {
                o.push(`<circle cx="${f1(x)}" cy="${f1(ey)}" r="2.8" fill="#111"/><circle cx="${f1(x + 0.8)}" cy="${f1(ey - 0.8)}" r="0.8" fill="#fff"/>`);
                o.push(`<path d="M${f1(x - 6)} ${f1(ey - 6)}L${f1(x + 6)} ${f1(ey - 6)}" stroke="${dark}" stroke-width="2.4" stroke-linecap="round"/>`);
                continue;
            }
            if (kind === 'glow') {
                o.push(`<circle cx="${f1(x)}" cy="${f1(ey)}" r="11" fill="${E}" opacity=".22"/><circle cx="${f1(x)}" cy="${f1(ey)}" r="7.5" fill="${E}" stroke="${dark}" stroke-width="1.5"/><circle cx="${f1(x)}" cy="${f1(ey)}" r="3.6" fill="#ffffff" opacity=".85"/>`);
                continue;
            }
            if (kind === 'spiral') {
                o.push(`<circle cx="${f1(x)}" cy="${f1(ey)}" r="8" fill="#0b0b12" stroke="${dark}" stroke-width="1.5"/>`);
                o.push(`<path d="M${f1(x)} ${f1(ey)}m0 -1a1 1 0 1 1 -1 1a2.4 2.4 0 1 1 2.4 2.4a4 4 0 1 1 -4 -4a5.6 5.6 0 1 1 5.6 5.6" fill="none" stroke="${E}" stroke-width="1.3"/>`);
                continue;
            }
            const big = kind === 'big', r = big ? 9.5 : 7.5;
            o.push(`<circle cx="${f1(x)}" cy="${f1(ey)}" r="${r}" fill="#ffffff" stroke="${dark}" stroke-width="1.5"/>`);
            if (kind === 'star') {
                o.push(`<polygon points="${starPoly(x, ey, 5, 2.2, 5)}" fill="${E}"/>`);
            } else {
                const py = kind === 'sleepy' ? ey + 2.2 : (big ? ey - 1.2 : ey);
                const pr = big ? 5 : (kind === 'sleepy' ? 3.4 : 3.8);
                o.push(`<circle cx="${f1(x - s * 1.2)}" cy="${f1(py)}" r="${pr}" fill="${E}"/><circle cx="${f1(x - s * 1.2 + 1.4)}" cy="${f1(py - 1.5)}" r="${big ? 1.8 : 1.2}" fill="#ffffff"/>`);
            }
            if (kind === 'sleepy') o.push(`<path d="M${f1(x - 8.2)} ${f1(ey + 0.5)}A8.2 8.2 0 0 1 ${f1(x + 8.2)} ${f1(ey + 0.5)}Z" fill="${S}" stroke="${dark}" stroke-width="1.5"/>`);
            if (kind === 'angry') o.push(`<path d="M${f1(x + s * 9)} ${f1(ey - 12)}L${f1(x - s * 7)} ${f1(ey - 6.5)}" stroke="${dark}" stroke-width="3.4" stroke-linecap="round"/>`);
        }
        return o.join('');
    }

    function mouthSvg(kind, h, dark, u) {
        const my = h.cy + h.ry * 0.42, mw = h.rx * 0.5, o = [];
        const inside = '#3b0a14', tongue = '#e8687a';
        if (kind === 'shock') {
            const mry = h.ry * 0.22, cy = my + 1.5;
            o.push(`<clipPath id="${u}m"><ellipse cx="60" cy="${f1(cy)}" rx="${f1(mw)}" ry="${f1(mry)}"/></clipPath>`);
            o.push(`<ellipse cx="60" cy="${f1(cy)}" rx="${f1(mw)}" ry="${f1(mry)}" fill="${inside}"/>`);
            o.push(`<g clip-path="url(#${u}m)">`);
            for (let i = -3; i <= 3; i++) { const x = 60 + i * mw * 0.3, top = cy - mry; o.push(`<path d="M${f1(x - 2.6)} ${f1(top)}L${f1(x + 2.6)} ${f1(top)}L${f1(x)} ${f1(top + 4.6)}Z" fill="#ffffff"/>`); }
            o.push(`<ellipse cx="60" cy="${f1(cy + mry * 0.85)}" rx="${f1(mw * 0.55)}" ry="${f1(mry * 0.5)}" fill="${tongue}"/></g>`);
            o.push(`<ellipse cx="60" cy="${f1(cy)}" rx="${f1(mw)}" ry="${f1(mry)}" fill="none" stroke="${dark}" stroke-width="1.6"/>`);
        } else if (kind === 'grin') {
            const d = `M${f1(60 - mw)} ${f1(my - 1)}Q60 ${f1(my + h.ry * 0.42)} ${f1(60 + mw)} ${f1(my - 1)}Z`;
            o.push(`<clipPath id="${u}m"><path d="${d}"/></clipPath><path d="${d}" fill="${inside}"/>`);
            o.push(`<g clip-path="url(#${u}m)"><rect x="${f1(60 - mw)}" y="${f1(my - 1)}" width="${f1(mw * 2)}" height="4.5" fill="#ffffff"/>`);
            for (let i = -2; i <= 2; i++) o.push(`<path d="M${f1(60 + i * mw * 0.32)} ${f1(my - 1)}v4.5" stroke="#cfcfcf" stroke-width=".8"/>`);
            o.push(`<ellipse cx="60" cy="${f1(my + h.ry * 0.2)}" rx="${f1(mw * 0.45)}" ry="3" fill="${tongue}"/></g><path d="${d}" fill="none" stroke="${dark}" stroke-width="1.6" stroke-linejoin="round"/>`);
        } else if (kind === 'smirk') {
            o.push(`<path d="M${f1(60 - mw * 0.75)} ${f1(my + 1)}Q${f1(60 + mw * 0.1)} ${f1(my + 5)} ${f1(60 + mw * 0.85)} ${f1(my - 3.5)}" fill="none" stroke="${dark}" stroke-width="2.6" stroke-linecap="round"/>`);
        } else if (kind === 'o') {
            o.push(`<ellipse cx="60" cy="${f1(my + 2)}" rx="4.6" ry="5.8" fill="${inside}" stroke="${dark}" stroke-width="1.5"/><ellipse cx="60" cy="${f1(my + 5)}" rx="2.6" ry="1.8" fill="${tongue}"/>`);
        } else if (kind === 'fangs') {
            o.push(`<path d="M${f1(60 - mw)} ${f1(my)}Q60 ${f1(my + 5)} ${f1(60 + mw)} ${f1(my)}" fill="none" stroke="${dark}" stroke-width="2.4" stroke-linecap="round"/>`);
            for (const s of [-1, 1]) { const x = 60 + s * mw * 0.48, y = my + 2.4; o.push(`<path d="M${f1(x - 2.4)} ${f1(y - 0.6)}L${f1(x + 2.4)} ${f1(y - 0.6)}L${f1(x)} ${f1(y + 5)}Z" fill="#ffffff" stroke="${dark}" stroke-width=".8" stroke-linejoin="round"/>`); }
        } else if (kind === 'blep') {
            o.push(`<path d="M${f1(60 + 1)} ${f1(my + 2)}q3 9 8 1" fill="${tongue}" stroke="${dark}" stroke-width="1.2"/>`);
            o.push(`<path d="M${f1(60 - mw)} ${f1(my)}Q60 ${f1(my + 5)} ${f1(60 + mw)} ${f1(my)}" fill="none" stroke="${dark}" stroke-width="2.4" stroke-linecap="round"/>`);
        }
        return o.join('');
    }

    function backHornsSvg(kind, h, A) {
        const o = [], c = h.cy, A2 = shade(A, -0.3);
        if (kind === 'frill') {
            for (let k = 0; k < 12; k++) {
                const a = (165 + k * 19) * Math.PI / 180, w = 0.13, r1 = Math.max(h.rx, h.ry) * 0.85, r2 = Math.max(h.rx, h.ry) + 17;
                const p = [[60 + Math.cos(a - w) * r1, c + Math.sin(a - w) * r1 * (h.ry / h.rx)], [60 + Math.cos(a) * r2, c + Math.sin(a) * r2], [60 + Math.cos(a + w) * r1, c + Math.sin(a + w) * r1 * (h.ry / h.rx)]];
                o.push(`<polygon points="${p.map(q => f1(q[0]) + ',' + f1(q[1])).join(' ')}" fill="${k % 2 ? A : shade(A, 0.15)}" stroke="${A2}" stroke-width="1.2" stroke-linejoin="round"/>`);
            }
        } else if (kind === 'dreads') {
            for (let i = 0; i < 8; i++) {
                const side = i < 4 ? -1 : 1, j = i < 4 ? i : i - 4;
                const sx = 60 + side * (6 + j * 6), sy = c - h.ry + 4 + j * 3;
                const ex = 60 + side * (h.rx + 9 + j * 3), ey = c + 16 + j * 5;
                const cx = 60 + side * (h.rx + 18), cy = sy - 4;
                o.push(`<path d="M${f1(sx)} ${f1(sy)}Q${f1(cx)} ${f1(cy)} ${f1(ex)} ${f1(ey)}" fill="none" stroke="${A2}" stroke-width="7.5" stroke-linecap="round"/>`);
                o.push(`<path d="M${f1(sx)} ${f1(sy)}Q${f1(cx)} ${f1(cy)} ${f1(ex)} ${f1(ey)}" fill="none" stroke="${A}" stroke-width="5" stroke-linecap="round"/>`);
                o.push(`<circle cx="${f1(ex)}" cy="${f1(ey)}" r="2.8" fill="${shade(A, 0.35)}" stroke="${A2}" stroke-width=".8"/>`);
            }
        }
        return o.join('');
    }

    function frontHornsSvg(kind, h, A) {
        const y0 = h.cy - h.ry, rx = h.rx, o = [], A2 = shade(A, -0.3);
        if (kind === 'nubs') {
            for (const s of [-1, 1]) o.push(`<ellipse cx="${f1(60 + s * rx * 0.45)}" cy="${f1(y0 + 4)}" rx="4.5" ry="5.5" fill="${A}" stroke="${A2}" stroke-width="1.2"/>`);
        } else if (kind === 'spikes') {
            [[-12, 7], [0, 12], [12, 7]].forEach(([dx, hgt]) => {
                const yb = y0 + 4 + Math.abs(dx) * 0.15;
                o.push(`<path d="M${60 + dx - 6} ${f1(yb + 2)}L${60 + dx} ${f1(yb - hgt)}L${60 + dx + 6} ${f1(yb + 2)}Z" fill="${A}" stroke="${A2}" stroke-width="1.2" stroke-linejoin="round"/>`);
            });
        } else if (kind === 'crest') {
            o.push(`<path d="M48 ${f1(y0 + 6)}Q52 ${f1(y0 - 20)} 68 ${f1(y0 - 16)}Q62 ${f1(y0 - 6)} 73 ${f1(y0 + 6)}Z" fill="${A}" stroke="${A2}" stroke-width="1.3" stroke-linejoin="round"/>`);
            o.push(`<path d="M55 ${f1(y0 + 2)}Q58 ${f1(y0 - 10)} 64 ${f1(y0 - 12)}" fill="none" stroke="${A2}" stroke-width="1" opacity=".6"/>`);
        } else if (kind === 'horns') {
            for (const s of [-1, 1]) o.push(`<path d="M${f1(60 + s * rx * 0.5)} ${f1(y0 + 9)}Q${f1(60 + s * rx * 0.95)} ${f1(y0 - 2)} ${f1(60 + s * rx * 1.08)} ${f1(y0 - 17)}Q${f1(60 + s * rx * 0.62)} ${f1(y0 - 6)} ${f1(60 + s * rx * 0.2)} ${f1(y0 + 6)}Z" fill="${A}" stroke="${A2}" stroke-width="1.3" stroke-linejoin="round"/>`);
        } else if (kind === 'antlers') {
            for (const s of [-1, 1]) {
                const bx = 60 + s * rx * 0.4, by = y0 + 6;
                o.push(`<path d="M${f1(bx)} ${f1(by)}L${f1(bx + s * 10)} ${f1(by - 18)}M${f1(bx + s * 5)} ${f1(by - 9)}L${f1(bx + s * 15)} ${f1(by - 11)}M${f1(bx + s * 8)} ${f1(by - 14)}L${f1(bx + s * 5)} ${f1(by - 24)}" stroke="${A2}" stroke-width="5.5" stroke-linecap="round" fill="none"/>`);
                o.push(`<path d="M${f1(bx)} ${f1(by)}L${f1(bx + s * 10)} ${f1(by - 18)}M${f1(bx + s * 5)} ${f1(by - 9)}L${f1(bx + s * 15)} ${f1(by - 11)}M${f1(bx + s * 8)} ${f1(by - 14)}L${f1(bx + s * 5)} ${f1(by - 24)}" stroke="${A}" stroke-width="3.5" stroke-linecap="round" fill="none"/>`);
            }
        } else if (kind === 'antenna') {
            o.push(`<path d="M60 ${f1(y0 + 2)}L64 ${f1(y0 - 15)}" stroke="#2a2a2a" stroke-width="2.4" stroke-linecap="round"/><circle cx="64" cy="${f1(y0 - 17)}" r="7" fill="${A}" opacity=".25"/><circle cx="64" cy="${f1(y0 - 17)}" r="4.2" fill="${A}" stroke="${A2}" stroke-width="1"/>`);
        }
        return o.join('');
    }

    // accessories drawn behind the head
    function backAccSvg(kind, h, O) {
        if (kind === 'hood') return `<ellipse cx="60" cy="${f1(h.cy - 2)}" rx="${f1(h.rx + 10)}" ry="${f1(h.ry + 10)}" fill="${O}" stroke="${shade(O, -0.4)}" stroke-width="1.5"/>`;
        return '';
    }
    function accSvg(kind, h, A, O, dark) {
        const y0 = h.cy - h.ry, rx = h.rx, cy = h.cy, ry = h.ry, o = [];
        const ey = cy - ry * 0.28, ex = rx * 0.44;
        switch (kind) {
            case 'crown':
                o.push(`<path d="M42 ${f1(y0 + 5)}L42 ${f1(y0 - 12)}L51 ${f1(y0 - 3)}L60 ${f1(y0 - 17)}L69 ${f1(y0 - 3)}L78 ${f1(y0 - 12)}L78 ${f1(y0 + 5)}Z" fill="#ffc83d" stroke="#a86a00" stroke-width="1.5" stroke-linejoin="round"/>`);
                o.push(`<circle cx="60" cy="${f1(y0 - 1)}" r="2.6" fill="#ff4d6a"/><circle cx="49" cy="${f1(y0 + 1)}" r="2" fill="#4fa8ff"/><circle cx="71" cy="${f1(y0 + 1)}" r="2" fill="#4fd27a"/>`);
                break;
            case 'tiara':
                o.push(`<path d="M46 ${f1(y0 + 6)}Q60 ${f1(y0 - 2)} 74 ${f1(y0 + 6)}L72 ${f1(y0 + 2)}L66 ${f1(y0 - 2)}L60 ${f1(y0 - 9)}L54 ${f1(y0 - 2)}L48 ${f1(y0 + 2)}Z" fill="#e8f0ff" stroke="#8aa0c8" stroke-width="1.2" stroke-linejoin="round"/><circle cx="60" cy="${f1(y0 - 3)}" r="2.4" fill="${A}"/>`);
                break;
            case 'tophat':
                o.push(`<ellipse cx="60" cy="${f1(y0 + 2)}" rx="24" ry="4.5" fill="#151515"/><rect x="47" y="${f1(y0 - 24)}" width="26" height="26" rx="2" fill="#1b1b1b" stroke="#000" stroke-width="1"/><rect x="47" y="${f1(y0 - 6)}" width="26" height="5" fill="${A === '#2a2a2a' ? '#c83a3a' : A}"/>`);
                break;
            case 'fedora':
                o.push(`<ellipse cx="60" cy="${f1(y0 + 3)}" rx="30" ry="6" fill="#262626" stroke="#000" stroke-width="1"/><path d="M45 ${f1(y0 + 3)}Q44 ${f1(y0 - 16)} 60 ${f1(y0 - 14)}Q76 ${f1(y0 - 16)} 75 ${f1(y0 + 3)}Z" fill="#303030" stroke="#000" stroke-width="1"/><path d="M55 ${f1(y0 - 13)}Q60 ${f1(y0 - 8)} 65 ${f1(y0 - 13)}" stroke="#1a1a1a" stroke-width="1.5" fill="none"/><rect x="45" y="${f1(y0 - 4)}" width="30" height="4" fill="#8a1f1f"/>`);
                break;
            case 'beanie':
                o.push(`<path d="M${f1(60 - rx * 0.88)} ${f1(y0 + 12)}Q${f1(60 - rx * 0.9)} ${f1(y0 - 14)} 60 ${f1(y0 - 14)}Q${f1(60 + rx * 0.9)} ${f1(y0 - 14)} ${f1(60 + rx * 0.88)} ${f1(y0 + 12)}Z" fill="${O}" stroke="${shade(O, -0.4)}" stroke-width="1.3"/>`);
                o.push(`<rect x="${f1(60 - rx * 0.92)}" y="${f1(y0 + 5)}" width="${f1(rx * 1.84)}" height="8" rx="4" fill="${shade(O, -0.2)}"/><circle cx="60" cy="${f1(y0 - 15)}" r="5" fill="${shade(O, 0.4)}"/>`);
                break;
            case 'cap':
                o.push(`<path d="M${f1(60 - rx * 0.85)} ${f1(y0 + 10)}Q60 ${f1(y0 - 16)} ${f1(60 + rx * 0.85)} ${f1(y0 + 10)}Z" fill="${O}" stroke="${shade(O, -0.4)}" stroke-width="1.3"/><path d="M${f1(60 + rx * 0.2)} ${f1(y0 + 6)}Q${f1(60 + rx + 8)} ${f1(y0)} ${f1(60 + rx + 12)} ${f1(y0 + 9)}Q${f1(60 + rx * 0.6)} ${f1(y0 + 12)} ${f1(60 + rx * 0.2)} ${f1(y0 + 10)}Z" fill="${shade(O, -0.25)}"/><circle cx="60" cy="${f1(y0 - 3)}" r="2" fill="${shade(O, 0.4)}"/>`);
                break;
            case 'chef':
                o.push(`<circle cx="50" cy="${f1(y0 - 8)}" r="9" fill="#ffffff" stroke="#c8c8c8"/><circle cx="70" cy="${f1(y0 - 8)}" r="9" fill="#ffffff" stroke="#c8c8c8"/><circle cx="60" cy="${f1(y0 - 14)}" r="10" fill="#ffffff" stroke="#c8c8c8"/><rect x="45" y="${f1(y0 - 6)}" width="30" height="11" rx="2" fill="#ffffff" stroke="#c8c8c8"/>`);
                break;
            case 'beret':
                o.push(`<ellipse cx="56" cy="${f1(y0 + 1)}" rx="26" ry="9" fill="#b8283a" stroke="#6a1020" stroke-width="1.2" transform="rotate(-10 56 ${f1(y0 + 1)})"/><path d="M58 ${f1(y0 - 7)}l2 -5" stroke="#6a1020" stroke-width="2.5" stroke-linecap="round"/>`);
                break;
            case 'party':
                o.push(`<path d="M50 ${f1(y0 + 5)}L62 ${f1(y0 - 24)}L72 ${f1(y0 + 5)}Z" fill="#ff7aa8" stroke="#a8306a" stroke-width="1.2" stroke-linejoin="round"/><path d="M53 ${f1(y0 - 2)}L69 ${f1(y0 - 2)}M56.5 ${f1(y0 - 10)}L66 ${f1(y0 - 10)}" stroke="#ffe14d" stroke-width="2.5"/><circle cx="62" cy="${f1(y0 - 25)}" r="3.5" fill="#ffe14d"/>`);
                break;
            case 'wizard':
                o.push(`<ellipse cx="60" cy="${f1(y0 + 4)}" rx="28" ry="6" fill="#3a1a7a"/><path d="M44 ${f1(y0 + 4)}L66 ${f1(y0 - 30)}L76 ${f1(y0 + 4)}Z" fill="#5a2aa8" stroke="#24104a" stroke-width="1.2" stroke-linejoin="round"/><polygon points="${starPoly(60, y0 - 6, 4, 1.7, 5)}" fill="#ffe14d"/><circle cx="66" cy="${f1(y0 - 18)}" r="1.4" fill="#ffe14d"/>`);
                break;
            case 'pharaoh':
                o.push(`<path d="M${f1(60 - rx - 6)} ${f1(cy + 18)}L${f1(60 - rx * 0.9)} ${f1(y0 + 6)}Q60 ${f1(y0 - 12)} ${f1(60 + rx * 0.9)} ${f1(y0 + 6)}L${f1(60 + rx + 6)} ${f1(cy + 18)}L${f1(60 + rx - 2)} ${f1(cy + 18)}L${f1(60 + rx * 0.7)} ${f1(y0 + 14)}Q60 ${f1(y0 + 2)} ${f1(60 - rx * 0.7)} ${f1(y0 + 14)}L${f1(60 - rx + 2)} ${f1(cy + 18)}Z" fill="#2a4ab8" stroke="#ffc83d" stroke-width="1.5" stroke-linejoin="round"/>`);
                for (let i = 0; i < 4; i++) o.push(`<path d="M${f1(60 - rx * 0.9 + i * 2)} ${f1(y0 + 14 + i * 9)}l-6 0M${f1(60 + rx * 0.9 - i * 2)} ${f1(y0 + 14 + i * 9)}l6 0" stroke="#ffc83d" stroke-width="2"/>`);
                o.push(`<circle cx="60" cy="${f1(y0 + 3)}" r="3.5" fill="#ffc83d"/>`);
                break;
            case 'helmet':
                o.push(`<path d="M${f1(60 - rx * 0.92)} ${f1(y0 + 13)}Q60 ${f1(y0 - 16)} ${f1(60 + rx * 0.92)} ${f1(y0 + 13)}Z" fill="#9aa4b0" stroke="#4a525c" stroke-width="1.3"/><rect x="${f1(60 - rx * 0.95)}" y="${f1(y0 + 9)}" width="${f1(rx * 1.9)}" height="5" rx="2" fill="#7a848f"/>`);
                for (const s of [-1, 1]) o.push(`<path d="M${f1(60 + s * rx * 0.8)} ${f1(y0 + 4)}Q${f1(60 + s * (rx + 12))} ${f1(y0 + 2)} ${f1(60 + s * (rx + 10))} ${f1(y0 - 16)}Q${f1(60 + s * (rx + 2))} ${f1(y0 - 2)} ${f1(60 + s * rx * 0.6)} ${f1(y0 - 2)}Z" fill="#f4ecd8" stroke="#8a7a5a" stroke-width="1.2"/>`);
                break;
            case 'hood':
                o.push(`<path d="M${f1(60 - rx - 3)} ${f1(cy - ry * 0.25)}Q60 ${f1(y0 - 16)} ${f1(60 + rx + 3)} ${f1(cy - ry * 0.25)}Q60 ${f1(y0 + 2)} ${f1(60 - rx - 3)} ${f1(cy - ry * 0.25)}Z" fill="${O}" stroke="${shade(O, -0.4)}" stroke-width="1.3"/>`);
                break;
            case 'halo':
                o.push(`<ellipse cx="60" cy="${f1(y0 - 9)}" rx="21" ry="5.5" fill="none" stroke="#fff3a0" stroke-width="7" opacity=".25"/><ellipse cx="60" cy="${f1(y0 - 9)}" rx="21" ry="5.5" fill="none" stroke="#ffe066" stroke-width="3"/>`);
                break;
            case 'laurel':
                for (const s of [-1, 1]) for (let k = 0; k < 5; k++) {
                    const a = Math.PI + (s < 0 ? 0.25 + k * 0.22 : -(0.25 + k * 0.22));
                    const x = 60 + s * Math.abs(Math.cos(a)) * (rx * 0.85), y = y0 + 10 - Math.abs(Math.sin(a)) * 12 - k * 1.2;
                    o.push(`<ellipse cx="${f1(x)}" cy="${f1(y)}" rx="4.5" ry="2.2" fill="#ffd23d" stroke="#a87a00" stroke-width=".8" transform="rotate(${s * (20 + k * 12)} ${f1(x)} ${f1(y)})"/>`);
                }
                break;
            case 'headband':
                o.push(`<path d="M${f1(60 - rx * 0.98)} ${f1(ey - 12)}Q60 ${f1(ey - 17)} ${f1(60 + rx * 0.98)} ${f1(ey - 12)}L${f1(60 + rx * 0.96)} ${f1(ey - 5.5)}Q60 ${f1(ey - 10.5)} ${f1(60 - rx * 0.96)} ${f1(ey - 5.5)}Z" fill="#e8343a" stroke="#8a1018" stroke-width="1"/><path d="M${f1(60 + rx * 0.95)} ${f1(ey - 9)}l9 6l-2 -9z" fill="#e8343a"/>`);
                break;
            case 'bandana':
                o.push(`<path d="M${f1(60 - rx * 0.97)} ${f1(ey - 8)}Q60 ${f1(y0 - 12)} ${f1(60 + rx * 0.97)} ${f1(ey - 8)}Q60 ${f1(ey - 14)} ${f1(60 - rx * 0.97)} ${f1(ey - 8)}Z" fill="#c8283a" stroke="#6a0d18" stroke-width="1.2"/><circle cx="52" cy="${f1(y0 + 2)}" r="1.3" fill="#fff"/><circle cx="64" cy="${f1(y0 - 1)}" r="1.3" fill="#fff"/><path d="M${f1(60 - rx * 0.95)} ${f1(ey - 9)}l-9 3l4 6z" fill="#c8283a"/>`);
                break;
            case 'headphones':
            case 'earmuffs': {
                const band = kind === 'earmuffs' ? '#e8e8f0' : '#1f1f24', cup = kind === 'earmuffs' ? '#ffffff' : A;
                o.push(`<path d="M${f1(60 - rx - 2)} ${f1(cy - 4)}Q${f1(60 - rx)} ${f1(y0 - 12)} 60 ${f1(y0 - 12)}Q${f1(60 + rx)} ${f1(y0 - 12)} ${f1(60 + rx + 2)} ${f1(cy - 4)}" fill="none" stroke="${band}" stroke-width="4.5" stroke-linecap="round"/>`);
                for (const s of [-1, 1]) o.push(kind === 'earmuffs'
                    ? `<circle cx="${f1(60 + s * (rx + 2))}" cy="${f1(cy - 2)}" r="9" fill="${cup}" stroke="#c8c8d8" stroke-width="1.5"/>`
                    : `<rect x="${f1(60 + s * (rx + 2) - 5)}" y="${f1(cy - 12)}" width="10" height="18" rx="4" fill="${cup}" stroke="#111" stroke-width="1.3"/>`);
                break;
            }
            case 'umbrella':
                o.push(`<path d="M60 ${f1(y0 - 14)}L60 ${f1(y0 + 2)}" stroke="#333" stroke-width="2"/><path d="M34 ${f1(y0 - 12)}Q60 ${f1(y0 - 38)} 86 ${f1(y0 - 12)}Q79.5 ${f1(y0 - 17)} 73 ${f1(y0 - 12)}Q66.5 ${f1(y0 - 17)} 60 ${f1(y0 - 12)}Q53.5 ${f1(y0 - 17)} 47 ${f1(y0 - 12)}Q40.5 ${f1(y0 - 17)} 34 ${f1(y0 - 12)}Z" fill="#ffe14d" stroke="#a88a00" stroke-width="1.2" stroke-linejoin="round"/><path d="M60 ${f1(y0 - 25)}Q55 ${f1(y0 - 18)} 54 ${f1(y0 - 13)}M60 ${f1(y0 - 25)}Q65 ${f1(y0 - 18)} 66 ${f1(y0 - 13)}" stroke="#a88a00" stroke-width="1" fill="none"/>`);
                break;
            case 'flower': {
                const fx = 60 + rx * 0.62, fy = y0 + 7;
                for (let k = 0; k < 5; k++) { const a = k * 2 * Math.PI / 5; o.push(`<circle cx="${f1(fx + Math.cos(a) * 4.5)}" cy="${f1(fy + Math.sin(a) * 4.5)}" r="3.8" fill="${A === '#ffffff' ? '#ff9ac8' : '#ff7ab8'}" stroke="#b03a78" stroke-width=".8"/>`); }
                o.push(`<circle cx="${f1(fx)}" cy="${f1(fy)}" r="3" fill="#ffe14d"/>`);
                break;
            }
            case 'shades':
                o.push(`<path d="M${f1(60 - ex - 10)} ${f1(ey - 6)}L${f1(60 + ex + 10)} ${f1(ey - 6)}" stroke="#111" stroke-width="2.4"/>`);
                for (const s of [-1, 1]) o.push(`<path d="M${f1(60 + s * ex - 10)} ${f1(ey - 6)}L${f1(60 + s * ex + 10)} ${f1(ey - 6)}L${f1(60 + s * ex + 8)} ${f1(ey + 4)}Q${f1(60 + s * ex)} ${f1(ey + 8)} ${f1(60 + s * ex - 8)} ${f1(ey + 4)}Z" fill="#111"/><path d="M${f1(60 + s * ex - 6)} ${f1(ey - 3)}l5 0" stroke="#ffffff" stroke-width="1.5" opacity=".6" stroke-linecap="round"/>`);
                break;
            case 'monocle': {
                const mx = 60 + ex;
                o.push(`<circle cx="${f1(mx)}" cy="${f1(ey)}" r="10" fill="#ffffff" fill-opacity=".12" stroke="#ffc83d" stroke-width="2"/><path d="M${f1(mx + 9)} ${f1(ey + 4)}Q${f1(mx + 14)} ${f1(ey + 22)} ${f1(mx + 4)} ${f1(cy + ry + 6)}" fill="none" stroke="#ffc83d" stroke-width="1" stroke-dasharray="1.5 1.5"/>`);
                break;
            }
            case 'bowtie': {
                const by = cy + ry + 3;
                o.push(`<path d="M60 ${f1(by)}L50 ${f1(by - 6)}L50 ${f1(by + 6)}ZM60 ${f1(by)}L70 ${f1(by - 6)}L70 ${f1(by + 6)}Z" fill="${A}" stroke="${shade(A, -0.4)}" stroke-width="1.2" stroke-linejoin="round"/><circle cx="60" cy="${f1(by)}" r="2.6" fill="${shade(A, -0.2)}"/>`);
                break;
            }
            case 'scarf': {
                const sy = cy + ry - 2;
                o.push(`<path d="M${f1(60 - 20)} ${f1(sy)}Q60 ${f1(sy + 10)} ${f1(60 + 20)} ${f1(sy)}L${f1(60 + 21)} ${f1(sy + 7)}Q60 ${f1(sy + 17)} ${f1(60 - 21)} ${f1(sy + 7)}Z" fill="${A}" stroke="${shade(A, -0.4)}" stroke-width="1.2"/><path d="M${f1(60 + 10)} ${f1(sy + 9)}l3 18l8 -2l-4 -17z" fill="${shade(A, -0.1)}" stroke="${shade(A, -0.4)}" stroke-width="1.1"/>`);
                break;
            }
            case 'chain': {
                const cyy = cy + ry + 4;
                o.push(`<path d="M44 ${f1(cyy)}Q60 ${f1(cyy + 16)} 76 ${f1(cyy)}" fill="none" stroke="#ffc83d" stroke-width="3.2" stroke-dasharray="3.5 1.5"/><circle cx="60" cy="${f1(cyy + 12)}" r="5" fill="#ffc83d" stroke="#a86a00" stroke-width="1"/><text x="60" y="${f1(cyy + 14.5)}" text-anchor="middle" font-size="7" font-weight="900" font-family="Arial,sans-serif" fill="#6a4000">$</text>`);
                break;
            }
        }
        return o.join('');
    }

    function patternSvg(kind, h, dark, A, rnd) {
        const o = [];
        if (kind === 'spots') {
            for (let i = 0; i < 7; i++) o.push(`<circle cx="${f1(60 + (rnd() * 2 - 1) * h.rx * 0.85)}" cy="${f1(h.cy - h.ry * 0.85 + rnd() * h.ry * 0.9)}" r="${f1(2 + rnd() * 2.6)}" fill="${dark}" opacity=".3"/>`);
        } else if (kind === 'stripes') {
            for (let i = 0; i < 3; i++) { const y = h.cy - h.ry * 0.78 + i * 6.5; o.push(`<path d="M${f1(60 - h.rx * 0.5)} ${f1(y + 3)}Q60 ${f1(y - 5)} ${f1(60 + h.rx * 0.5)} ${f1(y + 3)}" fill="none" stroke="${dark}" stroke-width="3.2" stroke-linecap="round" opacity=".32"/>`); }
        } else if (kind === 'scales') {
            for (let row = 0; row < 3; row++) for (let x = 60 - h.rx + (row % 2) * 4; x < 60 + h.rx; x += 8) {
                const y = h.cy - h.ry * 0.88 + row * 6;
                o.push(`<path d="M${f1(x - 4)} ${f1(y)}Q${f1(x)} ${f1(y + 4.5)} ${f1(x + 4)} ${f1(y)}" fill="none" stroke="${dark}" stroke-width="1.2" opacity=".35"/>`);
            }
        } else if (kind === 'cracks') {
            for (let i = 0; i < 4; i++) {
                const side = i % 2 ? 1 : -1;
                let x = 60 + side * h.rx, y = h.cy - h.ry * 0.6 + i * 6, d = `M${f1(x)} ${f1(y)}`;
                for (let k = 0; k < 3; k++) { x -= side * (4 + rnd() * 5); y += (rnd() * 2 - 1) * 5; d += `L${f1(x)} ${f1(y)}`; }
                o.push(`<path d="${d}" fill="none" stroke="${A}" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" opacity=".9"/>`);
            }
        }
        return o.join('');
    }

    const _artCache = {};
    let _artSeq = 0;
    // SVG markup for a species. Gradient/clip ids are made unique per call so many cards can share a page.
    // opts.shiny adds the shiny sheen; opts.silhouette draws an undiscovered follower as a dark shape.
    function art(spId, opts) {
        const sp = SPECIES_BY_ID[spId];
        if (!sp) return '';
        opts = opts || {};
        if (sp.img) return `<img src="${sp.img}" alt="${opts.silhouette ? 'Undiscovered follower' : sp.name}" class="wf-art"${opts.silhouette ? ' style="filter:brightness(0) opacity(.6)"' : ''}>`;
        const key = spId + (opts.silhouette ? ':sil' : (opts.shiny ? ':s' : ''));
        if (!_artCache[key]) _artCache[key] = buildArt(sp, !!opts.shiny && !opts.silhouette, !!opts.silhouette);
        const u = 'wf' + (++_artSeq) + '_';
        return _artCache[key].replace(/__U__/g, u);
    }
    function buildArt(sp, shiny, silhouette) {
        const u = '__U__';
        const h = HEADS[sp.head] || HEADS.round;
        const S = hex6(sp.skin), B = hex6(sp.belly), A = hex6(sp.accent), E = hex6(sp.eye), O = hex6(sp.outfit);
        const dark = shade(S, -0.55);
        const rnd = mulberry32(sp.index * 7919 + 13);
        const fam = FAMILIES[sp.family];
        const headShape = `<ellipse cx="60" cy="${h.cy}" rx="${h.rx}" ry="${h.ry}"/>`;
        let defs = `<radialGradient id="${u}bg" cx="50%" cy="38%" r="78%"><stop offset="0" stop-color="${fam.bg[0]}"/><stop offset="1" stop-color="${fam.bg[1]}"/></radialGradient>` +
            `<radialGradient id="${u}sk" cx="42%" cy="30%" r="80%"><stop offset="0" stop-color="${shade(S, 0.18)}"/><stop offset="1" stop-color="${shade(S, -0.15)}"/></radialGradient>` +
            `<clipPath id="${u}h">${headShape}</clipPath>`;
        if (silhouette) {
            defs += `<filter id="${u}sil"><feColorMatrix type="matrix" values="0 0 0 0 .05 0 0 0 0 .06 0 0 0 0 .09 0 0 0 1 0"/></filter>` +
                `<filter id="${u}dim"><feColorMatrix type="saturate" values="0"/><feComponentTransfer><feFuncR type="linear" slope=".4"/><feFuncG type="linear" slope=".4"/><feFuncB type="linear" slope=".45"/></feComponentTransfer></filter>`;
        }
        const bg = [];
        bg.push(`<rect width="120" height="120" fill="url(#${u}bg)"/>`);
        if (sp.rarity >= 3) {
            const rayCol = ['', '', '', '#e0c8ff', '#ffe08a', '#ffb0ee'][sp.rarity], op = [0, 0, 0, 0.1, 0.15, 0.18][sp.rarity];
            for (let i = 0; i < 12; i++) {
                const a0 = i * Math.PI / 6, a1 = a0 + 0.22;
                bg.push(`<path d="M60 58L${f1(60 + Math.cos(a0) * 100)} ${f1(58 + Math.sin(a0) * 100)}L${f1(60 + Math.cos(a1) * 100)} ${f1(58 + Math.sin(a1) * 100)}Z" fill="${rayCol}" opacity="${op}"/>`);
            }
        }
        bg.push(motif(sp.family, rnd));
        if (sp.rarity === 5) bg.push('<circle cx="60" cy="58" r="44" fill="none" stroke="#ffffff" stroke-width="1.5" opacity=".25"/><circle cx="60" cy="58" r="52" fill="none" stroke="#ffb0ee" stroke-width="1" opacity=".3" stroke-dasharray="2 4"/>');
        // everything from here on is the follower itself
        const p = [];
        p.push(backAccSvg(sp.acc, h, O));
        p.push(backHornsSvg(sp.horns, h, A));
        // neck + shoulders
        p.push(`<rect x="47" y="${h.cy + h.ry - 8}" width="26" height="${f1(100 - (h.cy + h.ry - 8))}" fill="${shade(S, -0.1)}"/>`);
        p.push(`<path d="M12 122C14 100 34 92 60 92C86 92 106 100 108 122Z" fill="${O}" stroke="${shade(O, -0.45)}" stroke-width="1.5"/>`);
        p.push(`<path d="M48 93Q60 102 72 93" fill="none" stroke="${shade(O, -0.3)}" stroke-width="1.5"/>`);
        // head
        p.push(`<ellipse cx="60" cy="${h.cy}" rx="${h.rx}" ry="${h.ry}" fill="url(#${u}sk)"/>`);
        p.push(`<g clip-path="url(#${u}h)">`);
        p.push(patternSvg(sp.pattern, h, dark, A, rnd));
        p.push(`<ellipse cx="60" cy="${f1(h.cy + h.ry * 0.5)}" rx="${f1(h.rx * 0.8)}" ry="${f1(h.ry * 0.52)}" fill="${B}"/>`);
        p.push(`<ellipse cx="${f1(60 - h.rx * 0.35)}" cy="${f1(h.cy - h.ry * 0.62)}" rx="${f1(h.rx * 0.3)}" ry="${f1(h.ry * 0.14)}" fill="#ffffff" opacity=".18"/>`);
        p.push('</g>');
        p.push(`<ellipse cx="60" cy="${h.cy}" rx="${h.rx}" ry="${h.ry}" fill="none" stroke="${dark}" stroke-width="2"/>`);
        // cheeks + nostrils
        for (const s of [-1, 1]) p.push(`<ellipse cx="${f1(60 + s * h.rx * 0.62)}" cy="${f1(h.cy + h.ry * 0.18)}" rx="4.5" ry="2.6" fill="#ff7a8a" opacity=".28"/>`);
        p.push(`<ellipse cx="56" cy="${f1(h.cy + h.ry * 0.12)}" rx="1.4" ry="1" fill="${dark}"/><ellipse cx="64" cy="${f1(h.cy + h.ry * 0.12)}" rx="1.4" ry="1" fill="${dark}"/>`);
        p.push(mouthSvg(sp.mouth, h, dark, u));
        p.push(eyesSvg(sp.eyes, h, S, E, dark, u));
        p.push(frontHornsSvg(sp.horns, h, A));
        p.push(accSvg(sp.acc, h, A, O, dark));
        let over = '';
        if (shiny) {
            defs += `<linearGradient id="${u}sh" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="#ff7ad8"/><stop offset=".35" stop-color="#ffe066"/><stop offset=".65" stop-color="#7dfcff"/><stop offset="1" stop-color="#a77dff"/></linearGradient>`;
            over = `<rect width="120" height="120" fill="url(#${u}sh)" opacity=".22"/>` +
                sparkle(16, 16, 6, '#fffbe0', 0.95) + sparkle(104, 22, 4.5, '#fffbe0', 0.9) + sparkle(102, 100, 5, '#fffbe0', 0.9) + sparkle(18, 98, 3.5, '#fffbe0', 0.85);
        }
        const label = silhouette ? 'Undiscovered follower' : sp.name;
        return `<svg class="wf-art" viewBox="0 0 120 120" xmlns="http://www.w3.org/2000/svg" role="img" aria-label="${label}"><defs>${defs}</defs>` +
            `<g${silhouette ? ` filter="url(#${u}dim)"` : ''}>${bg.join('')}</g>` +
            `<g${silhouette ? ` filter="url(#${u}sil)"` : ''}>${p.join('')}</g>${over}</svg>`;
    }

    window.WHF = {
        STORAGE_KEY, GOLDEN_DELTA_KEY, START_SLOTS, MAX_SLOTS, SLOT_COSTS, INVENTORY_CAP, BREEDS_PER_FOLLOWER, PITY_LIMIT, SHINY_MULT,
        SYNERGY_PER_MATE, BLOODLINE_PER_GEN, BLOODLINE_MAX, SECONDARY_BUFF_STRENGTH,
        RARITIES, BUFFS, FAMILIES, FAMILY_IDS, SPECIES, SPECIES_BY_ID, PACKS, PACKS_BY_ID,
        loadState, saveState, findFollower, isEquipped, equippedFollowers, synergyFor,
        getGolden, spendGolden,
        maxLevel, xpForLevel, investedXp, feedValue, previewLevel,
        bloodline, followerBuffs, computeBonuses, fmtBuff,
        NURSERY_SLOTS, HATCH_TIME_BY_RARITY,
        openPack, packWait, breedCost, breedOdds, hatchTime, eggFor, eggReady, startBreed, claimEgg,
        fmtDuration, fmtSpan,
        art,
    };
})();
