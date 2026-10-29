/**
 * The Wilds (world.html): every table the adventure runs on. Materials, zones, gatherable nodes, monsters, bosses,
 * rivals, weapon handling, gear, recipes, the trader and the caps that keep gems and Golden scarce. No logic here
 * beyond building the gear list from the tier table. Balance notes:
 * - Gems and Golden come only through CAPS (per day / per week). Crafted lootboxes use a weekly allowance counted in
 *   Wooden Crate equivalents (3 boxes merge into the next tier in items.js, so a box of tier t is worth 3^t).
 * - Gear tier t needs materials from zone t (zone 1 = Greenwood), so each boss opens the next tier.
 *
 * Works in a browser (<script src="core/world-data.js"> sets window.WHWorldData) and in Node (require).
 */
(function (root, factory) {
    if (typeof module === 'object' && module.exports) module.exports = factory();
    else root.WHWorldData = factory();
}(typeof self !== 'undefined' ? self : this, function () {
    'use strict';

    const TILE = 32;
    const WORLD_SEED = 'what-happened-wilds-1';

    // ---------------- materials ----------------
    // sell: rubies the Trader pays for one. kind: raw | bar | plank | part | key
    const MATERIALS = [
        // Greenwood
        { id: 'oak_log', name: 'Oak Log', color: '#a86f3a', icon: '🪵', sell: 1, kind: 'raw' },
        { id: 'fiber', name: 'Plant Fiber', color: '#9ccc65', icon: '🌾', sell: 1, kind: 'raw' },
        { id: 'herb', name: 'Healing Herb', color: '#43c46b', icon: '🌿', sell: 2, kind: 'raw' },
        { id: 'stone', name: 'Stone', color: '#9aa0a8', icon: '🪨', sell: 1, kind: 'raw' },
        { id: 'coal', name: 'Coal', color: '#3b3f46', icon: '⚫', sell: 1, kind: 'raw' },
        { id: 'copper_ore', name: 'Copper Ore', color: '#d9824b', icon: '🟠', sell: 2, kind: 'raw' },
        { id: 'slime_gel', name: 'Slime Gel', color: '#6fe08a', icon: '🟢', sell: 2, kind: 'part' },
        { id: 'boar_hide', name: 'Boar Hide', color: '#8d5a3b', icon: '🟫', sell: 3, kind: 'part' },
        { id: 'thorn', name: 'Sprite Thorn', color: '#b5e655', icon: '🌵', sell: 3, kind: 'part' },
        // Stonepeak Mines
        { id: 'iron_ore', name: 'Iron Ore', color: '#b9b2a8', icon: '⚪', sell: 5, kind: 'raw' },
        { id: 'silver_ore', name: 'Silver Ore', color: '#dfe6ee', icon: '🔘', sell: 10, kind: 'raw' },
        { id: 'gold_ore', name: 'Gold Ore', color: '#ffcf4a', icon: '🟡', sell: 12, kind: 'raw' },
        { id: 'ruby_cluster', name: 'Ruby Cluster', color: '#ff3d5e', icon: '💠', sell: 60, kind: 'part' },
        { id: 'bat_wing', name: 'Bat Wing', color: '#6b4f7a', icon: '🦇', sell: 4, kind: 'part' },
        { id: 'golem_core', name: 'Golem Core', color: '#d2a24c', icon: '🔶', sell: 15, kind: 'part' },
        { id: 'bone', name: 'Old Bone', color: '#e8e1cf', icon: '🦴', sell: 3, kind: 'part' },
        // Ember Wastes
        { id: 'ashwood_log', name: 'Ashwood Log', color: '#5d4a44', icon: '🪵', sell: 4, kind: 'raw' },
        { id: 'obsidian', name: 'Obsidian', color: '#2b1f3a', icon: '⬛', sell: 12, kind: 'raw' },
        { id: 'ember_ore', name: 'Ember Ore', color: '#ff6a2b', icon: '🔥', sell: 20, kind: 'raw' },
        { id: 'sulfur', name: 'Sulfur', color: '#e6d94a', icon: '🟨', sell: 6, kind: 'raw' },
        { id: 'imp_horn', name: 'Imp Horn', color: '#c2453a', icon: '🔺', sell: 10, kind: 'part' },
        { id: 'magma_shell', name: 'Magma Shell', color: '#a83a1a', icon: '🐚', sell: 14, kind: 'part' },
        // Frostveil
        { id: 'frostpine_log', name: 'Frostpine Log', color: '#7fa3b5', icon: '🪵', sell: 8, kind: 'raw' },
        { id: 'frost_crystal', name: 'Frost Crystal', color: '#8fe3ff', icon: '❄️', sell: 25, kind: 'raw' },
        { id: 'mithril_ore', name: 'Mithril Ore', color: '#a9c8ff', icon: '🔷', sell: 40, kind: 'raw' },
        { id: 'wolf_pelt', name: 'Wolf Pelt', color: '#d7dde6', icon: '🐺', sell: 15, kind: 'part' },
        { id: 'wraith_essence', name: 'Wraith Essence', color: '#b8a9ff', icon: '👻', sell: 22, kind: 'part' },
        { id: 'star_fragment', name: 'Star Fragment', color: '#fff3a8', icon: '⭐', sell: 120, kind: 'part' },
        // processed (instant recipes)
        { id: 'copper_bar', name: 'Copper Bar', color: '#e08a50', icon: '🟧', sell: 6, kind: 'bar' },
        { id: 'iron_bar', name: 'Iron Bar', color: '#c8c3bb', icon: '⬜', sell: 13, kind: 'bar' },
        { id: 'silver_bar', name: 'Silver Bar', color: '#eef3f8', icon: '⬜', sell: 24, kind: 'bar' },
        { id: 'gold_bar', name: 'Gold Bar', color: '#ffd24d', icon: '🟨', sell: 28, kind: 'bar' },
        { id: 'ember_bar', name: 'Ember Bar', color: '#ff7b3a', icon: '🟥', sell: 50, kind: 'bar' },
        { id: 'mithril_bar', name: 'Mithril Bar', color: '#b3d1ff', icon: '🟦', sell: 110, kind: 'bar' },
        { id: 'oak_plank', name: 'Oak Plank', color: '#c48a52', icon: '🟫', sell: 3, kind: 'plank' },
        { id: 'ashwood_plank', name: 'Ashwood Plank', color: '#6f5a52', icon: '🟫', sell: 9, kind: 'plank' },
        { id: 'frostpine_plank', name: 'Frostpine Plank', color: '#93b7c9', icon: '🟦', sell: 18, kind: 'plank' },
        { id: 'leather', name: 'Leather', color: '#9a6a44', icon: '🟤', sell: 8, kind: 'part' },
        { id: 'string', name: 'Bowstring', color: '#e9e2c8', icon: '🧵', sell: 4, kind: 'part' },
        // boss keys: open the next zone's gate (never sold, never dropped on death)
        { id: 'sigil_greenwood', name: 'Verdant Sigil', color: '#5fd068', icon: '🍃', sell: 0, kind: 'key' },
        { id: 'sigil_mines', name: 'Gilded Sigil', color: '#ffcf4a', icon: '⚜️', sell: 0, kind: 'key' },
        { id: 'sigil_ember', name: 'Inferno Sigil', color: '#ff6a2b', icon: '🔥', sell: 0, kind: 'key' },
        { id: 'sigil_frost', name: 'Frozen Sigil', color: '#8fe3ff', icon: '❄️', sell: 0, kind: 'key' },
        // boss trophies: each boss's own drops. They sell well; the Hall of Gods asks for the common one of each boss.
        { id: 'heartwood_seed', name: 'Heartwood Seed', color: '#7fd36b', icon: '🌰', sell: 160, kind: 'trophy' },
        { id: 'verdant_crown', name: 'Verdant Crown', color: '#4fd27a', icon: '👑', sell: 1200, kind: 'trophy' },
        { id: 'gilded_heart', name: 'Gilded Heart', color: '#ffcf4a', icon: '💛', sell: 320, kind: 'trophy' },
        { id: 'midas_eye', name: 'Eye of Midas', color: '#ffe14d', icon: '👁️', sell: 2500, kind: 'trophy' },
        { id: 'inferno_horn', name: 'Inferno Horn', color: '#ff6a2b', icon: '📯', sell: 550, kind: 'trophy' },
        { id: 'phoenix_feather', name: 'Phoenix Feather', color: '#ff9a3d', icon: '🪶', sell: 4000, kind: 'trophy' },
        { id: 'frozen_tear', name: 'Frozen Tear', color: '#bfefff', icon: '💧', sell: 900, kind: 'trophy' },
        { id: 'crown_of_winter', name: 'Crown of Winter', color: '#e8f7ff', icon: '👑', sell: 7000, kind: 'trophy' },
        // Frozen WH's rarest drop, for the hidden god and the hidden room: can't be sold, never lost on death
        { id: 'hidden_shard', name: 'Shard of the Hidden', color: '#3dffb4', icon: '🌑', sell: 0, kind: 'key' },
    ];
    const MATERIALS_BY_ID = Object.fromEntries(MATERIALS.map(m => [m.id, m]));

    // consumables (kept in state.cons)
    const CONSUMABLES = [
        // cd: seconds before any potion can be drunk again (one cooldown for all of them; stronger ones set a longer one)
        { id: 'potion_small', name: 'Small Potion', icon: '🧪', heal: 40, cd: 6, color: '#ff6b8a' },
        { id: 'potion_big', name: 'Big Potion', icon: '⚗️', heal: 110, cd: 10, color: '#ff3d6e' },
        { id: 'potion_max', name: 'Max Potion', icon: '💖', heal: 9999, cd: 20, color: '#ff9fe6' },
        { id: 'arrow', name: 'Arrow', icon: '➶', color: '#e9e2c8' },
    ];
    const CONSUMABLES_BY_ID = Object.fromEntries(CONSUMABLES.map(c => [c.id, c]));

    // ---------------- weapon handling (every number the swing physics uses) ----------------
    // Angles in radians, distances in world px, speeds in px/s. See core/world-combat.js.
    // r0..len: the part of the weapon that hits. k: how hard it chases the mouse, wMax: top turn speed (rad/s),
    // aMax: angular acceleration (its weight). vMin: slowest contact speed that does damage, vFull: full power.
    // cd: seconds before the same target can be hit again. stam: stamina per second while swinging fast.
    // kb: knockback. dmg: damage multiplier for the class.
    const WEAPON_CLASSES = {
        sword: { name: 'Sword', r0: 10, len: 46, k: 25, wMax: 22, aMax: 230, vMin: 260, vFull: 700, cd: 0.22, stam: 9, kb: 160, dmg: 1 },
        axe: { name: 'Axe', r0: 10, len: 42, k: 12, wMax: 14, aMax: 95, vMin: 200, vFull: 520, cd: 0.35, stam: 12, kb: 260, dmg: 1.3, chop: true, armored: 1.5 },
        pickaxe: { name: 'Pickaxe', r0: 10, len: 38, k: 16, wMax: 16, aMax: 120, vMin: 200, vFull: 500, cd: 0.3, stam: 10, kb: 120, dmg: 0.6, mine: true },
        dagger: { name: 'Dagger', r0: 8, len: 30, k: 35, wMax: 30, aMax: 420, vMin: 220, vFull: 560, cd: 0.12, stam: 6, kb: 80, dmg: 0.6, backstab: 1.5 },
        // spear: angle tracking plus a tip that reaches toward the cursor; damage from how fast the tip moves outward
        spear: { name: 'Spear', r0: 16, len: 76, k: 14, wMax: 12, aMax: 110, reachMin: 24, reachMax: 76, aimNear: 40, aimFar: 150,
            extendV: 900, retractV: 600, tipAccel: 9000, vMin: 260, vFull: 650, cd: 0.25, stam: 8, kb: 140, dmg: 1.1, pierce: 2,
            bashV: 300, bashDmg: 0.25, bashKb: 300, bashCd: 0.4,
            // momentum: a thrust is worth more the faster you are moving toward the target (a dash is about 480 px/s)
            momentum: { ref: 480, max: 0.9 } },
        // bow: press, pull the mouse away from the target, release
        bow: { name: 'Bow', k: 30, wMax: 26, aMax: 400, fullPull: 120, drawRate: 2.5, minDraw: 0.2, speedMin: 320, speedMax: 680,
            life: 0.9, steadyFrom: 0.15, steadyTo: 0.6, steadyMult: 1.35, shakeAfter: 1.5, spreadDeg: 6, shakeDeg: 10, moveMult: 0.6, dmg: 1, kb: 90 },
    };
    const COMBAT = {
        combo: { window: 0.7, max: 3, step: 0.1 },
        perfect: { at: 0.95, mult: 1.25 },
        stamina: { max: 100, regen: 28, delay: 0.35, windedMult: 0.5, recoverAt: 30, dash: 25 },
        dash: { time: 0.18, speedMult: 3.2, iframes: 0.15, cooldown: 0.6 },
        player: { hp: 100, speed: 150, radius: 13, regenTown: 25 },
        hitStop: 0.04,
        assist: { arc: 2.1, time: 0.18, mult: 0.7 },
        tinkSpeed: 60,   // contact this slow makes no spark at all
        // shields: hold to raise toward the mouse. Hits from inside the arc are blocked for stamina; raising one just before a
        // hit lands (parryWindow s) is a parry: no damage, no stamina, the attacker is stunned and projectiles fly back.
        shield: { k: 30, wMax: 18, aMax: 320, moveMult: 0.55, parryWindow: 0.18, stamPerDmg: 1.0, breakStun: 1.2, regenMult: 0.4,
            parryStun: 1.0, bossParryStun: 0.5, rivalStagger: 0.9, reflectMult: 1.5, maxBlock: 0.92 },
    };

    // ---------------- gear ----------------
    const QUALITY = [
        { id: 'crude', name: 'Crude', min: 0, mult: 0.8, color: '#8a8f9c', affix: 0 },
        { id: 'common', name: 'Common', min: 30, mult: 1.0, color: '#b4bccd', affix: 0 },
        { id: 'fine', name: 'Fine', min: 55, mult: 1.15, color: '#4fd27a', affix: 0 },
        { id: 'superior', name: 'Superior', min: 75, mult: 1.3, color: '#4fa8ff', affix: 0.1 },
        { id: 'masterwork', name: 'Masterwork', min: 90, mult: 1.5, color: '#b07dff', affix: 0.35 },
        { id: 'legendary', name: 'Legendary', min: 98, mult: 1.75, color: '#ffc83d', affix: 1, second: 0.5 },
    ];
    const AFFIXES = {
        keen: { name: 'Keen', desc: '10% chance to crit for 1.5x', slots: ['weapon'] },
        swift: { name: 'Swift', desc: '+8% swing speed', slots: ['weapon', 'tool'] },
        weighty: { name: 'Weighty', desc: '+40% knockback', slots: ['weapon'] },
        vampiric: { name: 'Vampiric', desc: 'Heal 2% of damage dealt', slots: ['weapon'] },
        featherweight: { name: 'Featherweight', desc: '+15% swing acceleration', slots: ['weapon', 'tool'] },
        prospector: { name: 'Prospector', desc: '+15% ore, wood and rubies', slots: ['tool', 'armor'] },
        lucky: { name: 'Lucky', desc: '+10% drop luck', slots: ['armor'] },
        sturdy: { name: 'Sturdy', desc: '+10% armor', slots: ['armor'] },
    };

    // Tier table. bar/plank: what that tier's gear is made of. extra: a monster part each tier's better pieces need.
    const TIERS = [
        { tier: 0, name: 'Rusty', color: '#8b6f5a' },
        { tier: 1, name: 'Copper', color: '#e08a50', bar: 'copper_bar', plank: 'oak_plank', extra: 'boar_hide', fee: 20, swordDmg: 12, armor: 15, hp: 20 },
        { tier: 2, name: 'Iron', color: '#c8c3bb', bar: 'iron_bar', plank: 'oak_plank', extra: 'bat_wing', fee: 60, swordDmg: 19, armor: 30, hp: 45 },
        { tier: 3, name: 'Silver', color: '#eef3f8', bar: 'silver_bar', plank: 'ashwood_plank', extra: 'golem_core', fee: 150, swordDmg: 30, armor: 50, hp: 80, alt: { axe: 'obsidian', pickaxe: 'obsidian' } },
        { tier: 4, name: 'Ember', color: '#ff7b3a', bar: 'ember_bar', plank: 'ashwood_plank', extra: 'magma_shell', fee: 350, swordDmg: 46, armor: 75, hp: 120, burn: true },
        { tier: 5, name: 'Mithril', color: '#b3d1ff', bar: 'mithril_bar', plank: 'frostpine_plank', extra: 'wolf_pelt', fee: 800, swordDmg: 70, armor: 110, hp: 180, chill: true },
    ];
    // armor split between the three pieces; boots also add move speed
    const ARMOR_SPLIT = { helmet: 0.3, chest: 0.5, boots: 0.2 };
    const BOOTS_SPEED = [0, 0.05, 0.07, 0.1, 0.12, 0.15];

    // station: forge | workbench | altar. Each recipe: inputs {mat: n}.
    function gearRecipe(cls, t) {
        const T = TIERS[t];
        const extraFor = (n) => (t >= 2 ? { [T.extra]: n } : {});
        switch (cls) {
            case 'sword': return { station: 'forge', in: { [T.bar]: 3, [T.plank]: 1, ...extraFor(1) } };
            case 'axe': return { station: 'forge', in: { [T.bar]: 2, [T.plank]: 2, ...(T.alt ? { [T.alt.axe]: 3 } : {}) } };
            case 'pickaxe': return { station: 'forge', in: { [T.bar]: 3, [T.plank]: 2, ...(T.alt ? { [T.alt.pickaxe]: 3 } : {}) } };
            case 'dagger': return { station: 'forge', in: { [T.bar]: 2, leather: 1 } };
            case 'spear': return { station: 'workbench', in: { [T.plank]: 3, [T.bar]: 1, ...extraFor(1) } };
            case 'bow': return { station: 'workbench', in: { [T.plank]: 4, string: 2, ...extraFor(1) } };
            case 'helmet': return { station: 'forge', in: { [T.bar]: 4 } };
            case 'chest': return { station: 'forge', in: { [T.bar]: 7, leather: 2, ...extraFor(2) } };
            case 'boots': return { station: 'workbench', in: { leather: 3, [T.bar]: 2 } };
            case 'shield': return { station: 'forge', in: { [T.bar]: 4, [T.plank]: 2, leather: 1, ...extraFor(1) } };
        }
        return null;
    }
    const WEAPON_NAMES = { sword: 'Sword', axe: 'Axe', pickaxe: 'Pickaxe', dagger: 'Dagger', spear: 'Spear', bow: 'Bow' };
    const ARMOR_NAMES = { helmet: 'Helmet', chest: 'Chestplate', boots: 'Boots' };
    // shields by tier: share of a blocked hit stopped, arc covered (degrees), stability (stamina efficiency)
    const SHIELD_STATS = [
        { block: 0.45, arc: 90, stab: 0.8 },
        { block: 0.55, arc: 100, stab: 1.0 },
        { block: 0.62, arc: 105, stab: 1.2 },
        { block: 0.68, arc: 110, stab: 1.45 },
        { block: 0.74, arc: 115, stab: 1.7 },
        { block: 0.8, arc: 120, stab: 2.0 },
    ];
    const WOOD_NAMES = ['', 'Oak', 'Oak', 'Ashwood', 'Ashwood', 'Frostpine'];
    // base: { id, name, slot ('weapon' | 'helmet' | 'chest' | 'boots' | 'ring'), cls, tier, dmg, armor, hp, speed, tool, recipe }
    const GEAR = [];
    for (const T of TIERS) {
        const t = T.tier;
        for (const cls of Object.keys(WEAPON_NAMES)) {
            if (t === 0 && !['sword', 'axe', 'pickaxe'].includes(cls)) continue;
            const wood = cls === 'spear' || cls === 'bow';
            const name = t === 0 ? 'Rusty ' + (cls === 'axe' ? 'Hatchet' : WEAPON_NAMES[cls]) : (wood ? WOOD_NAMES[t] + ' ' : T.name + ' ') + WEAPON_NAMES[cls];
            const swordDmg = t === 0 ? 8 : T.swordDmg;
            GEAR.push({
                id: cls + '_' + t, name, slot: 'weapon', cls, tier: t,
                dmg: Math.round(swordDmg * WEAPON_CLASSES[cls].dmg * 10) / 10,
                tool: (cls === 'axe' || cls === 'pickaxe') ? t + 1 : 0, // highest node tier it can work
                burn: !!T.burn, chill: !!T.chill,
                recipe: t === 0 ? null : gearRecipe(cls, t),
            });
        }
        GEAR.push(Object.assign({ id: 'shield_' + t, name: t === 0 ? 'Old Buckler' : T.name + ' Shield', slot: 'offhand', cls: 'shield', tier: t, armor: 0, hp: 0,
            recipe: t === 0 ? null : gearRecipe('shield', t) }, SHIELD_STATS[t]));
        if (t === 0) continue;
        for (const slot of Object.keys(ARMOR_NAMES)) {
            GEAR.push({
                id: slot + '_' + t, name: T.name + ' ' + ARMOR_NAMES[slot], slot, cls: slot, tier: t,
                armor: Math.round(T.armor * ARMOR_SPLIT[slot]), hp: Math.round(T.hp * ARMOR_SPLIT[slot]),
                speed: slot === 'boots' ? BOOTS_SPEED[t] : 0, fireResist: t >= 4 ? 0.3 : 0,
                recipe: gearRecipe(slot, t),
            });
        }
    }
    // rings: made at the Rune Altar
    const RINGS = [
        { id: 'ring_copper', name: 'Copper Band', tier: 1, rubies: 0.05, desc: '+5% rubies', recipe: { station: 'altar', in: { copper_bar: 2, thorn: 2 } } },
        { id: 'ring_gold', name: 'Gold Ring', tier: 2, hp: 15, desc: '+15 max HP', recipe: { station: 'altar', in: { gold_bar: 2, bat_wing: 2 } } },
        { id: 'ring_silver', name: 'Silver Ring', tier: 3, luck: 0.1, desc: '+10% drop luck', recipe: { station: 'altar', in: { silver_bar: 3, bone: 4 } } },
        { id: 'ring_ruby', name: 'Ruby Ring', tier: 3, rubies: 0.2, desc: '+20% rubies', recipe: { station: 'altar', in: { gold_bar: 2, ruby_cluster: 1 } } },
        { id: 'ring_ember', name: 'Ember Signet', tier: 4, fireResist: 0.5, desc: 'Halves lava and fire damage', recipe: { station: 'altar', in: { ember_bar: 2, imp_horn: 3 } } },
        { id: 'ring_frost', name: 'Frost Signet', tier: 5, stamRegen: 0.3, desc: '+30% stamina regen', recipe: { station: 'altar', in: { mithril_bar: 1, frost_crystal: 2, wraith_essence: 2 } } },
    ];
    for (const r of RINGS) GEAR.push(Object.assign({ slot: 'ring', cls: 'ring', armor: 0, hp: r.hp || 0 }, r));
    for (const g of GEAR) if (g.recipe) g.recipe.fee = TIERS[g.tier].fee || 0;
    const GEAR_BY_ID = Object.fromEntries(GEAR.map(g => [g.id, g]));
    const STARTER_KIT = ['sword_0', 'pickaxe_0', 'axe_0'];
    const STARTER_OFFHAND = 'shield_0';

    // ---------------- instant recipes (no minigame) ----------------
    // out: { mat | cons: n }
    const BASIC_RECIPES = [
        { id: 'copper_bar', station: 'forge', in: { copper_ore: 2, coal: 1 }, out: { copper_bar: 1 } },
        { id: 'iron_bar', station: 'forge', in: { iron_ore: 2, coal: 1 }, out: { iron_bar: 1 } },
        { id: 'silver_bar', station: 'forge', in: { silver_ore: 2, coal: 1 }, out: { silver_bar: 1 } },
        { id: 'gold_bar', station: 'forge', in: { gold_ore: 2, coal: 1 }, out: { gold_bar: 1 } },
        { id: 'ember_bar', station: 'forge', in: { ember_ore: 2, sulfur: 1 }, out: { ember_bar: 1 } },
        { id: 'mithril_bar', station: 'forge', in: { mithril_ore: 3, frost_crystal: 1 }, out: { mithril_bar: 1 } },
        { id: 'oak_plank', station: 'workbench', in: { oak_log: 2 }, out: { oak_plank: 1 } },
        { id: 'ashwood_plank', station: 'workbench', in: { ashwood_log: 2 }, out: { ashwood_plank: 1 } },
        { id: 'frostpine_plank', station: 'workbench', in: { frostpine_log: 2 }, out: { frostpine_plank: 1 } },
        { id: 'leather', station: 'workbench', in: { boar_hide: 2, fiber: 1 }, out: { leather: 1 } },
        { id: 'leather_pelt', station: 'workbench', in: { wolf_pelt: 1, fiber: 1 }, out: { leather: 2 } },
        { id: 'string', station: 'workbench', in: { fiber: 3 }, out: { string: 1 } },
        { id: 'arrows', station: 'workbench', in: { oak_plank: 1, stone: 2 }, out: { arrow: 10 } },
        { id: 'potion_small', station: 'altar', in: { herb: 2, slime_gel: 1 }, out: { potion_small: 1 } },
        { id: 'potion_big', station: 'altar', in: { herb: 3, bat_wing: 1, sulfur: 1 }, out: { potion_big: 1 } },
        { id: 'potion_max', station: 'altar', in: { herb: 3, wraith_essence: 1, frost_crystal: 1 }, out: { potion_max: 1 } },
    ];
    const BASIC_BY_ID = Object.fromEntries(BASIC_RECIPES.map(r => [r.id, r]));

    // ---------------- lootboxes for the main game (Rune Altar minigame; items.js tiers) ----------------
    // pts: weekly allowance cost (Wooden Crate equivalents)
    const BOX_RECIPES = [
        { id: 'box_wood', tier: 0, name: 'Wooden Crate', fee: 120, in: { oak_plank: 8, fiber: 4 }, pts: 1, color: '#d0915a' },
        { id: 'box_iron', tier: 1, name: 'Iron Chest', fee: 400, in: { iron_bar: 6, golem_core: 1 }, pts: 3, color: '#c9d1dc' },
        { id: 'box_gold', tier: 2, name: 'Golden Chest', fee: 1500, in: { gold_bar: 5, ruby_cluster: 1 }, pts: 9, color: '#ffc83d' },
        { id: 'box_diamond', tier: 3, name: 'Diamond Chest', fee: 5000, in: { frost_crystal: 3, mithril_bar: 2, star_fragment: 1 }, pts: 27, color: '#5ee7ff' },
    ];
    const BOX_NAMES = ['Wooden Crate', 'Iron Chest', 'Golden Chest', 'Diamond Chest', 'Mythic Vault'];
    const BOX_POINTS = [1, 3, 9, 27, 81];
    const BOX_COLORS = ['#d0915a', '#c9d1dc', '#ffc83d', '#5ee7ff', '#ff5bd0'];

    // ---------------- caps (everything that reaches the main game) ----------------
    const CAPS = {
        gemsPerDay: 5,
        goldenPerDay: 1,
        boxPointsPerWeek: 60,
        // Trader exchanges, once per week each
        exchange: {
            gems: { cost: 2500, gems: 3 },
            golden: { cost: 6000, golden: 1 },
        },
        overCapRubies: { gem: 150, golden: 600 }, // a gem or Golden past the cap pays this many rubies instead
    };

    // ---------------- gatherable nodes ----------------
    // tool: 'pickaxe' | 'axe' | 'hand'. tier: lowest tool tier that works it (tool gear has tool = tier + 1).
    // work: progress needed. drops: [mat, min, max, chance]. respawn: seconds. r: collision radius.
    const NODES = {
        tree_oak: { name: 'Oak Tree', tool: 'axe', tier: 1, work: 5, r: 16, solid: true, drops: [['oak_log', 2, 3, 1], ['fiber', 0, 1, 0.3]], respawn: 60, color: '#2f7d3a', trunk: '#6b4423' },
        bush_fiber: { name: 'Fiber Bush', tool: 'hand', tier: 0, work: 0.6, r: 12, drops: [['fiber', 1, 3, 1]], respawn: 40, color: '#8fc95a' },
        herb: { name: 'Healing Herb', tool: 'hand', tier: 0, work: 0.6, r: 10, drops: [['herb', 1, 2, 1]], respawn: 60, color: '#43c46b' },
        rock: { name: 'Rock', tool: 'pickaxe', tier: 1, work: 3, r: 15, solid: true, drops: [['stone', 2, 3, 1]], respawn: 45, color: '#8b9099' },
        coal: { name: 'Coal Seam', tool: 'pickaxe', tier: 1, work: 4, r: 15, solid: true, drops: [['coal', 2, 3, 1]], respawn: 60, color: '#3b3f46' },
        copper: { name: 'Copper Ore', tool: 'pickaxe', tier: 1, work: 5, r: 15, solid: true, drops: [['copper_ore', 2, 3, 1]], respawn: 60, color: '#d9824b' },
        iron: { name: 'Iron Ore', tool: 'pickaxe', tier: 2, work: 6, r: 15, solid: true, drops: [['iron_ore', 2, 3, 1]], respawn: 90, color: '#b9b2a8' },
        ruby_vein: { name: 'Ruby Vein', tool: 'pickaxe', tier: 2, work: 7, r: 15, solid: true, drops: [['ruby_cluster', 1, 1, 0.06]], rubies: [15, 30], gem: 0.01, respawn: 600, color: '#ff3d5e' },
        silver: { name: 'Silver Ore', tool: 'pickaxe', tier: 3, work: 7, r: 15, solid: true, drops: [['silver_ore', 2, 3, 1]], respawn: 150, color: '#dfe6ee' },
        gold: { name: 'Gold Ore', tool: 'pickaxe', tier: 3, work: 8, r: 15, solid: true, drops: [['gold_ore', 1, 2, 1]], respawn: 150, color: '#ffcf4a' },
        tree_ash: { name: 'Ashwood Tree', tool: 'axe', tier: 2, work: 7, r: 16, solid: true, drops: [['ashwood_log', 2, 3, 1]], respawn: 90, color: '#4a3b36', trunk: '#2b201c' },
        obsidian: { name: 'Obsidian', tool: 'pickaxe', tier: 3, work: 9, r: 15, solid: true, drops: [['obsidian', 1, 2, 1]], respawn: 150, color: '#2b1f3a' },
        ember: { name: 'Ember Ore', tool: 'pickaxe', tier: 4, work: 10, r: 15, solid: true, drops: [['ember_ore', 2, 3, 1]], respawn: 200, color: '#ff6a2b' },
        sulfur: { name: 'Sulfur Vent', tool: 'pickaxe', tier: 1, work: 4, r: 14, solid: true, drops: [['sulfur', 1, 3, 1]], respawn: 90, color: '#e6d94a' },
        tree_frost: { name: 'Frostpine', tool: 'axe', tier: 3, work: 9, r: 16, solid: true, drops: [['frostpine_log', 2, 3, 1]], respawn: 120, color: '#5f8fa3', trunk: '#3d4f5a' },
        frost_crystal: { name: 'Frost Crystal', tool: 'pickaxe', tier: 4, work: 10, r: 14, solid: true, drops: [['frost_crystal', 1, 2, 1], ['star_fragment', 1, 1, 0.02]], respawn: 200, color: '#8fe3ff' },
        mithril: { name: 'Mithril Ore', tool: 'pickaxe', tier: 5, work: 12, r: 15, solid: true, drops: [['mithril_ore', 2, 3, 1]], respawn: 300, color: '#a9c8ff' },
    };
    const SAVED_RESPAWN_SEC = 150; // node timers this long or longer are saved, so reloading can't farm them

    // ---------------- monsters ----------------
    // move: chase | kite | hop | erratic | flank. attacks: { type, range, windup, active, cooldown, dmg (x monster dmg), ... }
    // drops: [mat, min, max, chance]. rubies: [min, max].
    const MONSTERS = {
        slime: { name: 'Slime', hp: 30, dmg: 6, speed: 70, r: 13, color: '#6fe08a', move: 'hop', attacks: [{ type: 'lunge', range: 120, windup: 0.45, active: 0.35, cooldown: 1.1, speed: 300 }], rubies: [1, 3], drops: [['slime_gel', 1, 2, 0.7]] },
        boar: { name: 'Boar', hp: 60, dmg: 12, speed: 95, r: 16, color: '#8d5a3b', move: 'chase', attacks: [{ type: 'charge', range: 230, windup: 0.6, active: 0.55, cooldown: 2.2, speed: 430, stunOnWall: 1.2 }], rubies: [2, 4], drops: [['boar_hide', 1, 2, 0.75]] },
        sprite: { name: 'Thorn Sprite', hp: 25, dmg: 7, speed: 85, r: 11, color: '#b5e655', move: 'kite', keep: [140, 230], attacks: [{ type: 'shoot', range: 300, windup: 0.4, active: 0.1, cooldown: 1.8, speed: 260, pr: 6 }], rubies: [2, 4], drops: [['thorn', 1, 1, 0.6], ['fiber', 1, 2, 0.3]] },
        mossback: { name: 'Mossback', elite: true, hp: 240, dmg: 18, speed: 70, r: 22, color: '#3f8a4c', move: 'chase', attacks: [{ type: 'slam', range: 80, windup: 0.8, active: 0.15, cooldown: 2.0, radius: 85 }, { type: 'charge', range: 260, windup: 0.7, active: 0.6, cooldown: 4.0, speed: 380, stunOnWall: 1.5 }], rubies: [10, 18], drops: [['boar_hide', 2, 3, 1], ['oak_log', 3, 5, 1], ['thorn', 2, 3, 0.8]] },

        bat: { name: 'Cave Bat', hp: 35, dmg: 9, speed: 140, r: 11, color: '#6b4f7a', move: 'erratic', attacks: [{ type: 'lunge', range: 150, windup: 0.3, active: 0.3, cooldown: 1.4, speed: 420 }], rubies: [3, 6], drops: [['bat_wing', 1, 1, 0.6]] },
        golem: { name: 'Rock Golem', hp: 220, dmg: 22, speed: 55, r: 22, armor: 40, color: '#8b8278', move: 'chase', attacks: [{ type: 'slam', range: 70, windup: 1.0, active: 0.15, cooldown: 2.2, radius: 72 }], rubies: [6, 12], drops: [['stone', 2, 4, 1], ['golem_core', 1, 1, 0.25], ['iron_ore', 1, 2, 0.4]] },
        skeleton: { name: 'Skeleton Miner', hp: 110, dmg: 16, speed: 90, r: 14, color: '#e8e1cf', move: 'chase', attacks: [{ type: 'arc', range: 52, windup: 0.5, active: 0.12, cooldown: 1.3, arc: 1.75, reach: 58 }], rubies: [5, 9], drops: [['bone', 1, 2, 0.7], ['coal', 1, 2, 0.4], ['silver_ore', 1, 1, 0.15]] },
        crystal_golem: { name: 'Crystal Golem', elite: true, hp: 700, dmg: 28, speed: 55, r: 26, armor: 50, color: '#d58ef0', move: 'chase', attacks: [{ type: 'slam', range: 80, windup: 0.9, active: 0.15, cooldown: 2.0, radius: 95 }, { type: 'ring', range: 260, windup: 0.8, active: 0.1, cooldown: 4.5, count: 10, speed: 220, pr: 7 }], rubies: [30, 50], drops: [['golem_core', 1, 2, 1], ['gold_ore', 2, 3, 1], ['ruby_cluster', 1, 1, 0.2]] },

        imp: { name: 'Imp', hp: 120, dmg: 18, speed: 110, r: 13, color: '#e0503a', move: 'kite', keep: [150, 240], blink: 4.5, attacks: [{ type: 'shoot', range: 320, windup: 0.45, active: 0.1, cooldown: 1.6, speed: 300, pr: 8, burn: true }], rubies: [8, 14], drops: [['imp_horn', 1, 1, 0.5], ['sulfur', 1, 2, 0.4]] },
        crab: { name: 'Magma Crab', hp: 260, dmg: 26, speed: 70, r: 20, armor: 30, shell: 0.15, color: '#a83a1a', move: 'chase', attacks: [{ type: 'arc', range: 56, windup: 0.6, active: 0.12, cooldown: 1.5, arc: 1.6, reach: 64 }], rubies: [10, 18], drops: [['magma_shell', 1, 1, 0.45], ['obsidian', 1, 1, 0.3]] },
        hound: { name: 'Ash Hound', hp: 150, dmg: 20, speed: 150, r: 14, color: '#5d4a44', move: 'flank', group: 2, attacks: [{ type: 'lunge', range: 110, windup: 0.35, active: 0.25, cooldown: 1.2, speed: 460 }], rubies: [8, 14], drops: [['ashwood_log', 1, 2, 0.4], ['boar_hide', 1, 2, 0.4]] },
        ember_brute: { name: 'Ember Brute', elite: true, hp: 1200, dmg: 34, speed: 70, r: 28, armor: 40, color: '#ff6a2b', move: 'chase', attacks: [{ type: 'slam', range: 90, windup: 0.9, active: 0.15, cooldown: 2.0, radius: 100, burn: true }, { type: 'cone', range: 160, windup: 0.8, active: 0.8, cooldown: 4.0, arc: 0.9, reach: 170, burn: true }], rubies: [50, 80], drops: [['ember_ore', 2, 3, 1], ['magma_shell', 1, 2, 1], ['imp_horn', 1, 2, 0.6]] },

        wolf: { name: 'Ice Wolf', hp: 200, dmg: 28, speed: 165, r: 15, color: '#d7dde6', move: 'flank', group: 3, attacks: [{ type: 'lunge', range: 120, windup: 0.35, active: 0.25, cooldown: 1.3, speed: 480 }], rubies: [12, 20], drops: [['wolf_pelt', 1, 1, 0.55]] },
        wraith: { name: 'Frost Wraith', hp: 260, dmg: 24, speed: 95, r: 15, color: '#b8a9ff', move: 'erratic', resist: 0.5, resistBy: [3, 5], drain: 25, attacks: [{ type: 'nova', range: 90, windup: 0.7, active: 0.15, cooldown: 2.2, radius: 95, chill: true }], rubies: [14, 22], drops: [['wraith_essence', 1, 1, 0.5]] },
        yeti: { name: 'Yeti', hp: 600, dmg: 40, speed: 80, r: 24, armor: 30, color: '#eef3f8', move: 'chase', attacks: [{ type: 'slam', range: 80, windup: 0.85, active: 0.15, cooldown: 2.0, radius: 90 }, { type: 'shoot', range: 300, windup: 0.7, active: 0.1, cooldown: 3.5, speed: 280, pr: 11, chill: true }], rubies: [20, 35], drops: [['wolf_pelt', 1, 2, 0.6], ['frost_crystal', 1, 1, 0.3]] },
        frost_giant: { name: 'Frost Giant', elite: true, hp: 2400, dmg: 46, speed: 65, r: 30, armor: 50, color: '#8fe3ff', move: 'chase', attacks: [{ type: 'slam', range: 95, windup: 0.9, active: 0.15, cooldown: 2.0, radius: 110, chill: true }, { type: 'spikes', range: 340, windup: 0.8, active: 0.5, cooldown: 4.0, count: 7, gap: 42, radius: 22 }], rubies: [80, 120], drops: [['frost_crystal', 2, 3, 1], ['mithril_ore', 2, 3, 1], ['star_fragment', 1, 1, 0.15]] },
        // the Forge's practice target (never spawns in zones)
        dummy: { name: 'Training Dummy', hp: 999999, dmg: 0, speed: 0, r: 16, color: '#c49a6c', move: 'still', attacks: [], rubies: [0, 0], drops: [], dummy: true },
    };
    const ELITE_GEM_CHANCE = 0.03;

    // ---------------- bosses ----------------
    // phases at 66% and 33% of HP. attacks per phase cycle in order with small random picks (world-actors.js).
    const BOSSES = {
        overgrown: {
            name: 'The Overgrown', zone: 'greenwood', face: 'mainimage/thumbs/whnature.webp', hp: 900, dmg: 16, r: 40, speed: 60, armor: 0, color: '#3f8a4c',
            phases: [
                ['sweep', 'ring', 'charge'],
                ['sweep', 'ring', 'summon', 'roots'],
                ['sweep', 'ring', 'roots', 'charge', 'summon'],
            ],
            summon: 'slime', axeBonus: 1.25,
            sigil: 'sigil_greenwood', rubiesFirst: 300, rubies: [60, 90], gems: [1, 2], golden: 0.15,
            drops: [['oak_log', 6, 10, 1], ['thorn', 3, 5, 1], ['copper_ore', 4, 6, 1], ['herb', 3, 5, 1], ['heartwood_seed', 1, 1, 0.35], ['verdant_crown', 1, 1, 0.04]],
        },
        gilded: {
            name: 'Gilded Golem', zone: 'mines', face: 'mainimage/thumbs/goldwh.webp', hp: 2200, dmg: 26, r: 44, speed: 45, armor: 40, color: '#ffcf4a',
            phases: [
                ['boulders', 'slam'],
                ['boulders', 'slam', 'stalactites'],
                ['boulders', 'slam', 'stalactites', 'charge'],
            ],
            exposeAfterSlam: 4, exposeMult: 2,
            sigil: 'sigil_mines', rubiesFirst: 600, rubies: [120, 180], gems: [1, 3], golden: 0.3,
            drops: [['gold_ore', 4, 6, 1], ['iron_ore', 5, 8, 1], ['golem_core', 1, 2, 1], ['ruby_cluster', 1, 1, 0.5], ['gilded_heart', 1, 1, 0.35], ['midas_eye', 1, 1, 0.04]],
        },
        inferno: {
            name: 'Inferno WH', zone: 'ember', face: 'mainimage/thumbs/FireWH.webp', hp: 5000, dmg: 34, r: 42, speed: 70, armor: 30, color: '#ff6a2b',
            phases: [
                ['breath', 'meteors', 'ring'],
                ['breath', 'meteors', 'clone', 'ring'],
                ['breath', 'meteors', 'ring', 'charge', 'clone'],
            ],
            burn: true,
            sigil: 'sigil_ember', rubiesFirst: 1000, rubies: [200, 300], gems: [2, 3], golden: 0.15,
            drops: [['ember_ore', 4, 6, 1], ['obsidian', 3, 5, 1], ['magma_shell', 2, 3, 1], ['imp_horn', 2, 3, 1], ['inferno_horn', 1, 1, 0.35], ['phoenix_feather', 1, 1, 0.04]],
        },
        frozen: {
            name: 'Frozen WH', zone: 'frost', face: 'mainimage/thumbs/WHice.webp', hp: 10000, dmg: 44, r: 44, speed: 70, armor: 50, color: '#8fe3ff',
            phases: [
                ['spikes', 'ring', 'slam'],
                ['spikes', 'ring', 'summon', 'slam'],
                ['spikes', 'ring', 'summon', 'charge', 'slam'],
            ],
            aura: { radius: 140, slow: 0.35 }, summon: 'wolf', emberStrips: true,
            sigil: 'sigil_frost', rubiesFirst: 1500, rubies: [300, 450], gems: [2, 3], golden: 0.15, mythicWeekly: true,
            drops: [['mithril_ore', 4, 6, 1], ['frost_crystal', 3, 5, 1], ['wolf_pelt', 2, 3, 1], ['star_fragment', 1, 2, 1], ['frozen_tear', 1, 1, 0.35], ['crown_of_winter', 1, 1, 0.04], ['hidden_shard', 1, 1, 0.1, 'fixed']],
        },
    };

    // ---------------- rivals: AI adventurers who fight with the player's own weapon rules ----------------
    const RIVALS = {
        chad: { name: 'WH Chad', face: 'mainimage/thumbs/WHchad.webp', cls: 'sword', color: '#ff8a3d' },
        hacker: { name: 'WH Hacker', face: 'mainimage/thumbs/WHhacker.webp', cls: 'bow', color: '#3dff9a' },
        bread: { name: 'WH Bread', face: 'mainimage/thumbs/WHbread.webp', cls: 'spear', color: '#e8c27a' },
        lightning: { name: 'WH Lightning', face: 'mainimage/thumbs/WHlightning.webp', cls: 'dagger', color: '#ffe14d' },
    };
    // per zone: which rival roams there and how tough
    const RIVAL_TIERS = {
        greenwood: { rival: 'chad', tier: 1, hp: 140, sweepHz: 1.4, react: 0.45, dodge: 0.1, rubies: 30 },
        mines: { rival: 'hacker', tier: 2, hp: 300, sweepHz: 1.7, react: 0.38, dodge: 0.18, rubies: 60 },
        ember: { rival: 'bread', tier: 3, hp: 620, sweepHz: 2.0, react: 0.3, dodge: 0.25, rubies: 120 },
        frost: { rival: 'lightning', tier: 4, hp: 1100, sweepHz: 2.3, react: 0.24, dodge: 0.32, rubies: 220 },
    };
    const RIVAL_RESPAWN_SEC = 420;
    const RIVAL_WEAPON_DROP = 0.15;

    // ---------------- zones ----------------
    // gen: town | meadow | cave | wastes | tundra. w/h in tiles. nodes: { type: count }. spawns: [[monster, weight]].
    // gate: material needed to enter. dmgMult/hpMult/rubyMult: scaling per zone.
    const ZONES = {
        town: { id: 'town', name: 'Wildgate Town', gen: 'town', w: 46, h: 34, safe: true, bg: 'bgimages/thumbs/stonghengebg.webp',
            palette: { floor: '#5b6b4f', floor2: '#55654a', path: '#9c8d72', wall: '#3c4a35', plaza: '#a49a86', water: '#2c6f9e' } },
        greenwood: { id: 'greenwood', name: 'Greenwood', gen: 'meadow', w: 96, h: 96, tier: 1, gate: null, bg: 'bgimages/thumbs/grassyfieldbg.webp',
            palette: { floor: '#4f8a3c', floor2: '#477f36', path: '#8a7a55', wall: '#23502a', water: '#2f78b8', hazard: null },
            nodes: { tree_oak: 70, bush_fiber: 40, herb: 30, rock: 30, coal: 18, copper: 26 },
            spawns: [['slime', 5], ['boar', 3], ['sprite', 3]], density: 26, elite: 'mossback', elites: 2, boss: 'overgrown',
            hpMult: 1, dmgMult: 1, rubyMult: 1 },
        mines: { id: 'mines', name: 'Stonepeak Mines', gen: 'cave', w: 84, h: 100, tier: 2, gate: 'sigil_greenwood', dark: 230, bg: 'bgimages/thumbs/mountainsbg.webp',
            palette: { floor: '#4a4540', floor2: '#433e3a', path: '#5c554e', wall: '#221f1d', water: '#1f4d73', hazard: null },
            nodes: { rock: 30, coal: 24, iron: 34, ruby_vein: 10, silver: 18, gold: 14, copper: 10 },
            spawns: [['bat', 4], ['golem', 2], ['skeleton', 3]], density: 30, elite: 'crystal_golem', elites: 2, boss: 'gilded',
            hpMult: 1, dmgMult: 1, rubyMult: 1 },
        ember: { id: 'ember', name: 'Ember Wastes', gen: 'wastes', w: 100, h: 100, tier: 3, gate: 'sigil_mines', lavaDps: 10, bg: 'bgimages/thumbs/volcanobg.webp',
            palette: { floor: '#5a3b30', floor2: '#523529', path: '#7a5848', wall: '#2a1a16', water: null, hazard: '#ff5a1f' },
            nodes: { tree_ash: 40, obsidian: 26, ember: 26, sulfur: 22, ruby_vein: 10, coal: 12, iron: 10 },
            spawns: [['imp', 3], ['crab', 2], ['hound', 3]], density: 30, elite: 'ember_brute', elites: 2, boss: 'inferno',
            hpMult: 1, dmgMult: 1, rubyMult: 1 },
        frost: { id: 'frost', name: 'Frostveil', gen: 'tundra', w: 100, h: 100, tier: 4, gate: 'sigil_ember', ice: true, blizzard: true, bg: 'bgimages/thumbs/blizardbg.webp',
            palette: { floor: '#d9e4ec', floor2: '#cfdbe5', path: '#b8c6d1', wall: '#6f8796', water: '#7fb6d6', ice: '#a9dcf5', hazard: null },
            nodes: { tree_frost: 44, frost_crystal: 26, mithril: 22, rock: 14, herb: 16, silver: 10 },
            spawns: [['wolf', 3], ['wraith', 3], ['yeti', 1]], density: 30, elite: 'frost_giant', elites: 2, boss: 'frozen',
            hpMult: 1, dmgMult: 1, rubyMult: 1 },
        // inside the Hall of Gods, a building in town (world-gen.js buildHall). interior: entered by its door, no monsters, and
        // nobody else online in there. dark: how far the player's own light reaches; the braziers light the rest.
        hall: { id: 'hall', name: 'Hall of Gods', gen: 'hall', w: 26, h: 56, safe: true, interior: true, dark: 170,
            sub: 'Sacred ground', banner: 'Something old is watching you',
            palette: { floor: '#16131d', floor2: '#1a1622', path: '#2b1a24', wall: '#0b090f', plaza: '#2b1a24' } },
    };
    const ZONE_ORDER = ['greenwood', 'mines', 'ember', 'frost'];
    const MONSTER_RESPAWN_SEC = 35;
    const ELITE_RESPAWN_SEC = 300;

    // town buildings: station id -> label and what it does
    const STATIONS = {
        forge: { name: 'Forge', icon: '🔥', desc: 'Smelt bars and forge metal weapons and armor', color: '#ff7b3a' },
        workbench: { name: 'Workbench', icon: '🪚', desc: 'Planks, leather, bows, spears and boots', color: '#c48a52' },
        altar: { name: 'Rune Altar', icon: '🔮', desc: 'Potions, rings and lootboxes for the main game', color: '#b07dff' },
        trader: { name: 'Trader', icon: '💰', desc: 'Sell materials, buy supplies, exchange rubies', color: '#ff3d5e' },
        board: { name: 'Notice Board', icon: '📜', desc: 'How the Wilds work', color: '#d8c79a' },
    };

    // ---------------- townsfolk, wanderers and their quests ----------------
    // Each NPC stands in a zone (zone, default town) at spot: tiles from the town centre in town, from the camp in a wild
    // zone, and the tile itself in the Hall of Gods. They give their chain of quests in order, then one daily quest a day
    // from their daily list. rumor: something they let slip; lines: what someone with no quests says, one per talk. Goals (kind): kill (monster, elite, zone: all optional), boss (boss optional), rival,
    // harvest (tool, zone optional), craft (gear; minScore optional), box (a lootbox at the Rune Altar), deliver (mats,
    // taken when you hand the quest in), visit (zone), god (raise statues in the Hall of Gods). n: how many.
    // need: what must be open before it is offered ({ zone }). Daily quests pay rubies x the tier of the furthest zone open.
    const NPCS = {
        brannoc: { name: 'Captain Brannoc', role: 'Warden of Wildgate', face: 'mainimage/thumbs/WHboss.webp', color: '#b5483a', spot: [-7, -3],
            greet: 'Monsters at every gate and only one of me. You look like you can swing a blade.',
            chain: ['brannoc_slimes', 'brannoc_boars', 'brannoc_elite', 'brannoc_skeletons', 'brannoc_hounds', 'brannoc_wolves'],
            daily: ['daily_cull', 'daily_elite', 'daily_rival'] },
        marla: { name: 'Old Marla', role: 'Prospector', face: 'mainimage/thumbs/mobilemanskin.webp', color: '#8d6e4a', spot: [-7, 4],
            greet: 'Forty years I dug these hills. My back says no more, so you dig and I pay.',
            chain: ['marla_trees', 'marla_copper', 'marla_mines', 'marla_shiny', 'marla_obsidian', 'marla_star'],
            daily: ['daily_harvest', 'daily_herbs', 'daily_timber'] },
        hilde: { name: 'Hilde', role: 'Master Smith', face: 'mainimage/thumbs/platinumwh.webp', color: '#7c8a99', spot: [8, 4],
            greet: 'Anyone can hit metal. Hitting it right is the trick. Show me what your hands can do.',
            chain: ['hilde_first', 'hilde_fine', 'hilde_crate', 'hilde_master', 'hilde_ember', 'hilde_legend'],
            daily: ['daily_iron', 'daily_craft', 'daily_strings'] },
        vey: { name: 'Sister Vey', role: 'Keeper of the Hall of Gods', face: 'mainimage/thumbs/voidWH.webp', color: '#5b3f8c', spot: [-2, -8],
            greet: 'The old gods sleep in the Hall behind me. Feed them, and they will remember you.',
            chain: ['vey_hall', 'vey_offering', 'vey_overgrown', 'vey_gilded', 'vey_inferno', 'vey_frozen'],
            daily: ['daily_boss', 'daily_purge'],
            rumor: 'On quiet nights I hear something behind the far wall of the Hall. Not one of our gods. Something older, waiting for the right word.' },
        // at the camps out in the wilds
        fenna: { name: 'Fenna', role: 'Forester', zone: 'greenwood', face: 'mainimage/thumbs/whnature.webp', color: '#4f8a3c', spot: [3, -1],
            greet: 'Quiet out here, until it isn\'t. Mind the sprites: they shoot first.',
            chain: ['fenna_sprites', 'fenna_herbs', 'fenna_mossback'], daily: ['fenna_daily'],
            rumor: 'There is a hooded stranger who sits in the dark of the Hall of Gods and talks to the far wall. Some say the wall listens.' },
        durgan: { name: 'Durgan', role: 'Deep Delver', zone: 'mines', face: 'mainimage/thumbs/silverwh.webp', color: '#8b8278', spot: [3, -1],
            greet: 'Stonepeak gives and Stonepeak takes. Mostly it takes. Lamp on, head down.',
            chain: ['durgan_bats', 'durgan_gold', 'durgan_crystal'], daily: ['durgan_daily'],
            rumor: 'Down here we say the old Prophet\'s faith was never written down, only spoken. Say it in the right place and the stone moves.' },
        ashlyn: { name: 'Ashlyn', role: 'Firewalker', zone: 'ember', face: 'mainimage/thumbs/FireWH.webp', color: '#c2453a', spot: [3, -1],
            greet: 'You get used to the heat. You never get used to the imps.',
            chain: ['ashlyn_imps', 'ashlyn_shells', 'ashlyn_brute'], daily: ['ashlyn_daily'],
            rumor: 'Every faith ends the same way, doesn\'t it? A prophet\'s name, then the little bit on the end. Funny what sticks in your head out here.' },
        hrolf: { name: 'Old Hrolf', role: 'Frostveil Scout', zone: 'frost', face: 'mainimage/thumbs/WHice.webp', color: '#7fa3b5', spot: [3, -1],
            greet: 'Cold enough to freeze your thoughts. Keep moving and keep your sword warm.',
            chain: ['hrolf_wraiths', 'hrolf_pelts', 'hrolf_giant'], daily: ['hrolf_daily'],
            rumor: 'When Frozen WH falls, sometimes a black shard falls with it. One time in ten, maybe. It hums when you carry it near the Hall of Gods.' },
        // inside the Hall of Gods, near the far end: no quests, only riddles
        pilgrim: { name: 'Hooded Pilgrim', role: 'Keeps watch by the far wall', zone: 'hall', hooded: true, face: 'mainimage/thumbs/whblackandwhite.webp', color: '#2b2433', spot: [16, 21],
            greet: '...', chain: [], daily: [],
            lines: [
                'You hear it too, don\'t you? The far wall. It is not a wall. It is a mouth that has not been answered.',
                'The gods in this hall are young. Behind the stone sleeps one who was a prophet before he was ever a god.',
                'His name you already know. You honour him among the divine, in your other life, and you paid gold for it.',
                'Do not say his name. Say his faith: the word his followers use for what they believe.',
                'Words are spoken here as anywhere: press Enter and say it aloud. The stone is listening.',
            ],
            opened: 'So. You said it, and it heard you. Go in. He has waited a long time.' },
    };
    const NPC_ORDER = Object.keys(NPCS);
    const QUESTS = {
        // Captain Brannoc: hunting
        brannoc_slimes: { title: 'Slime Season', text: 'Slimes are eating the herb gardens again. Thin them out in Greenwood.', goal: { kind: 'kill', monster: 'slime', n: 6 }, rubies: 60 },
        brannoc_boars: { title: 'Boar Hunt', text: 'The boars charge anything that moves. Bring down five before they flatten a farmer.', goal: { kind: 'kill', monster: 'boar', n: 5 }, rubies: 110, cons: { potion_small: 2 } },
        brannoc_elite: { title: 'Something Bigger', text: 'Scouts saw a hulking beast out there. Elites hit hard and take a beating: bring one down.', goal: { kind: 'kill', elite: true, n: 1 }, rubies: 250 },
        brannoc_skeletons: { title: 'Bones in the Dark', text: 'The old miners never left Stonepeak. Put eight of them back to rest.', goal: { kind: 'kill', monster: 'skeleton', n: 8 }, need: { zone: 'mines' }, rubies: 450 },
        brannoc_hounds: { title: 'Hounds of Ash', text: 'Ash Hounds hunt in pairs out in the Ember Wastes. Break up the pack.', goal: { kind: 'kill', monster: 'hound', n: 6 }, need: { zone: 'ember' }, rubies: 850, cons: { potion_big: 2 } },
        brannoc_wolves: { title: 'Ice and Teeth', text: 'Frostveil wolves came right up to the south gate last night. Take the fight to them.', goal: { kind: 'kill', monster: 'wolf', n: 6 }, need: { zone: 'frost' }, rubies: 1500 },
        // Old Marla: gathering
        marla_trees: { title: 'Firewood', text: 'Chop me some trees, would you? Any trees. My stove is cold.', goal: { kind: 'harvest', tool: 'axe', n: 5 }, rubies: 50 },
        marla_copper: { title: 'Copper and Coal', text: 'Bring me copper ore and coal. I still know a thing or two about smelting.', goal: { kind: 'deliver', mats: { copper_ore: 6, coal: 4 } }, rubies: 130 },
        marla_mines: { title: 'Deep Work', text: 'Stonepeak is where the real ore is. Break ten veins down there.', goal: { kind: 'harvest', tool: 'pickaxe', zone: 'mines', n: 10 }, need: { zone: 'mines' }, rubies: 320 },
        marla_shiny: { title: 'Shiny Things', text: 'Silver and gold from deep in the mines. I want to hold some again.', goal: { kind: 'deliver', mats: { silver_ore: 4, gold_ore: 4 } }, need: { zone: 'mines' }, rubies: 550 },
        marla_obsidian: { title: 'Glass from Fire', text: 'Obsidian and sulfur from the Ember Wastes. Do not ask what for.', goal: { kind: 'deliver', mats: { obsidian: 5, sulfur: 4 } }, need: { zone: 'ember' }, rubies: 950 },
        marla_star: { title: 'A Fallen Star', text: 'They say stars fall on Frostveil and freeze inside the crystals. Find me one.', goal: { kind: 'deliver', mats: { star_fragment: 1, frost_crystal: 4 } }, need: { zone: 'frost' }, rubies: 2000 },
        // Hilde: crafting
        hilde_first: { title: 'First Forging', text: 'Make something at the Forge or the Workbench. Anything. Let me see how you work.', goal: { kind: 'craft', n: 1 }, rubies: 80 },
        hilde_fine: { title: 'Fine Work', text: 'Now make it properly: a piece of Fine quality or better.', goal: { kind: 'craft', minScore: 55, n: 1 }, rubies: 160 },
        hilde_crate: { title: 'A Crate for the Road', text: 'Craft a lootbox at the Rune Altar. People back home pay well for them.', goal: { kind: 'box', n: 1 }, rubies: 260 },
        hilde_master: { title: 'Masterwork', text: 'A Masterwork piece: ninety or better at the station. No shortcuts.', goal: { kind: 'craft', minScore: 90, n: 1 }, rubies: 650 },
        hilde_ember: { title: 'Ember Steel', text: 'Bring me Ember Bars. I want to try something new on my anvil.', goal: { kind: 'deliver', mats: { ember_bar: 4 } }, need: { zone: 'ember' }, rubies: 900 },
        hilde_legend: { title: 'Legendary', text: 'Only a handful of smiths ever made a Legendary piece. Be one of them.', goal: { kind: 'craft', minScore: 98, n: 1 }, rubies: 2200 },
        // Sister Vey: the gods and the bosses
        vey_hall: { title: 'The Hall of Gods', text: 'Step inside the Hall behind me. Let the gods see your face.', goal: { kind: 'visit', zone: 'hall' }, rubies: 50 },
        vey_offering: { title: 'A First Offering', text: 'Raise any statue in the Hall by one level. The gods answer offerings, not prayers.', goal: { kind: 'god', n: 1 }, rubies: 200 },
        vey_overgrown: { title: 'The Overgrown', text: "The thing at the heart of Greenwood was a god's gardener once. Put it to rest.", goal: { kind: 'boss', boss: 'overgrown', n: 1 }, rubies: 400 },
        vey_gilded: { title: 'The Golden Guardian', text: 'The Gilded Golem guards the deep mine. Its heart beats with stolen gold.', goal: { kind: 'boss', boss: 'gilded', n: 1 }, need: { zone: 'mines' }, rubies: 800 },
        vey_inferno: { title: 'Trial by Fire', text: 'Inferno WH burns in the Wastes. The gods want that fire brought low.', goal: { kind: 'boss', boss: 'inferno', n: 1 }, need: { zone: 'ember' }, rubies: 1500 },
        vey_frozen: { title: 'The Frozen Throne', text: 'Last of all, Frozen WH. When it falls, something in the Hall will stir.', goal: { kind: 'boss', boss: 'frozen', n: 1 }, need: { zone: 'frost' }, rubies: 3000 },
        // daily quests
        daily_cull: { title: 'Cull the Wilds', text: 'Fifteen monsters, any zone. Keep the roads safe today.', goal: { kind: 'kill', n: 15 }, rubies: 90, daily: true },
        daily_elite: { title: 'Elite Hunt', text: 'Bring down one elite beast today.', goal: { kind: 'kill', elite: true, n: 1 }, rubies: 150, daily: true },
        daily_rival: { title: 'Show-off', text: 'One of those rival adventurers is boasting again. Beat them.', goal: { kind: 'rival', n: 1 }, rubies: 130, daily: true },
        daily_harvest: { title: "A Day's Work", text: 'Twenty things gathered: ore, wood or plants, I am not fussy.', goal: { kind: 'harvest', n: 20 }, rubies: 70, daily: true },
        daily_herbs: { title: 'Herbalist', text: 'Bring me healing herbs. My knees, you understand.', goal: { kind: 'deliver', mats: { herb: 6 } }, rubies: 70, daily: true },
        daily_timber: { title: 'Timber!', text: 'Chop eight trees today.', goal: { kind: 'harvest', tool: 'axe', n: 8 }, rubies: 70, daily: true },
        daily_iron: { title: 'Iron for the Guard', text: 'Five iron bars. The guard needs new swords.', goal: { kind: 'deliver', mats: { iron_bar: 5 } }, need: { zone: 'mines' }, rubies: 120, daily: true },
        daily_craft: { title: 'Practice', text: 'Craft two pieces of gear today. Practice keeps the hands honest.', goal: { kind: 'craft', n: 2 }, rubies: 110, daily: true },
        daily_strings: { title: 'Bowstrings', text: 'Four bowstrings for the archers on the wall.', goal: { kind: 'deliver', mats: { string: 4 } }, rubies: 60, daily: true },
        daily_boss: { title: 'A Trial a Day', text: 'Beat any of the four great bosses today.', goal: { kind: 'boss', n: 1 }, rubies: 250, daily: true },
        daily_purge: { title: 'Purge', text: 'Twenty-five monsters in any zone. The gods like a tidy world.', goal: { kind: 'kill', n: 25 }, rubies: 110, daily: true },
        // Fenna, in Greenwood
        fenna_sprites: { title: 'Thorny Neighbours', text: 'The thorn sprites have been shooting at my traps. Six of them, please.', goal: { kind: 'kill', monster: 'sprite', n: 6 }, rubies: 90 },
        fenna_herbs: { title: 'Medicine Run', text: 'The camp is out of salve. Herbs and slime gel, and I can make more.', goal: { kind: 'deliver', mats: { herb: 8, slime_gel: 4 } }, rubies: 150, cons: { potion_small: 2 } },
        fenna_mossback: { title: 'The Old Mossback', text: 'The big mossy one tore up half my snares. Show it who the forest belongs to.', goal: { kind: 'kill', elite: true, zone: 'greenwood', n: 1 }, rubies: 300 },
        fenna_daily: { title: 'Clear the Paths', text: 'Twelve monsters in Greenwood, so the gatherers can work.', goal: { kind: 'kill', zone: 'greenwood', n: 12 }, rubies: 60, daily: true },
        // Durgan, in the Stonepeak Mines
        durgan_bats: { title: 'Bats in the Shaft', text: 'Eight bats. They nest in my lamp oil.', goal: { kind: 'kill', monster: 'bat', n: 8 }, need: { zone: 'mines' }, rubies: 300 },
        durgan_gold: { title: 'Fool\'s Errand', text: 'Bring me gold ore. I want to be sure it is the real thing.', goal: { kind: 'deliver', mats: { gold_ore: 6 } }, need: { zone: 'mines' }, rubies: 480 },
        durgan_crystal: { title: 'The Crystal Golem', text: 'Something made of glass and hate walks the deep tunnels. Break it.', goal: { kind: 'kill', elite: true, zone: 'mines', n: 1 }, need: { zone: 'mines' }, rubies: 750 },
        durgan_daily: { title: 'Pick and Shovel', text: 'Twelve veins or rocks in Stonepeak today.', goal: { kind: 'harvest', tool: 'pickaxe', zone: 'mines', n: 12 }, need: { zone: 'mines' }, rubies: 70, daily: true },
        // Ashlyn, in the Ember Wastes
        ashlyn_imps: { title: 'Imp Hunt', text: 'Imps blink right next to you and laugh. Make eight of them stop laughing.', goal: { kind: 'kill', monster: 'imp', n: 8 }, need: { zone: 'ember' }, rubies: 650 },
        ashlyn_shells: { title: 'Hard Shells', text: 'Magma shells make the best boots out here. Bring four.', goal: { kind: 'deliver', mats: { magma_shell: 4 } }, need: { zone: 'ember' }, rubies: 850 },
        ashlyn_brute: { title: 'The Ember Brute', text: 'A brute made of burning rock guards the hot springs. I would like a bath.', goal: { kind: 'kill', elite: true, zone: 'ember', n: 1 }, need: { zone: 'ember' }, rubies: 1150 },
        ashlyn_daily: { title: 'Walk the Fire', text: 'Twelve monsters in the Wastes today.', goal: { kind: 'kill', zone: 'ember', n: 12 }, need: { zone: 'ember' }, rubies: 80, daily: true },
        // Old Hrolf, in Frostveil
        hrolf_wraiths: { title: 'Restless Dead', text: 'The frost wraiths drink the warmth out of you. Six of them, and silver helps.', goal: { kind: 'kill', monster: 'wraith', n: 6 }, need: { zone: 'frost' }, rubies: 1000 },
        hrolf_pelts: { title: 'A Warm Coat', text: 'Six wolf pelts. Do not ask how many coats I have.', goal: { kind: 'deliver', mats: { wolf_pelt: 6 } }, need: { zone: 'frost' }, rubies: 1250 },
        hrolf_giant: { title: 'The Frost Giant', text: 'The giant walks the ridge every night. One night, it should not walk back.', goal: { kind: 'kill', elite: true, zone: 'frost', n: 1 }, need: { zone: 'frost' }, rubies: 1900 },
        hrolf_daily: { title: 'Hold the Line', text: 'Fifteen monsters in Frostveil today.', goal: { kind: 'kill', zone: 'frost', n: 15 }, need: { zone: 'frost' }, rubies: 100, daily: true },
    };
    for (const id of NPC_ORDER) NPCS[id].zone = NPCS[id].zone || 'town';
    for (const id in QUESTS) QUESTS[id].id = id;

    // ---------------- the room behind the Hall's far wall ----------------
    // One-time purchases. rubies and mats are paid in the Wilds; each one's gems and Golden (core/world-bridge.js BUYS) are
    // taken in the game, which then adds the item.
    const HIDDEN_SHOP = {
        autoClicker: { name: 'The Auto Clicker', icon: '🖲️', rubies: 15000,
            mats: { hidden_shard: 3, verdant_crown: 1, midas_eye: 1, phoenix_feather: 1, crown_of_winter: 1, star_fragment: 5 },
            desc: 'A charm of the Hidden rarity. Equip it in the game, put it on the What Happened image or an upgrade, and it clicks it 10 times a second for as long as the game is open.' },
    };
    for (const id of NPC_ORDER) for (const q of NPCS[id].chain.concat(NPCS[id].daily)) QUESTS[q].npc = id;


    // ---------------- classes and skill trees ----------------
    // A class has an innate bonus ("bonus", on while you are that class) and a skill tree of three branches, four skills
    // deep. A skill is an ability (equipped on the R / Q / C loadout, up to three at a time) or a perk (a passive bonus,
    // on while you are that class). A skill costs rubies and needs the one above it in its branch; some also need the
    // boss named in "boss" beaten. The Warrior is free; the other classes unlock once their challenge ("unlock") is done
    // and the rubies are paid.
    // Bonus keys (innate and perks) add up, except the multipliers dmg {weapon class: mult}, blockStam, abilityCd,
    // abilityDmg, abilityStam, dashCd and dashStam. The others: maxHp, armor, speed (+share), crit (+chance), arrowSave
    // (chance a shot keeps its arrow), stamRegen (+share), lifesteal (share of weapon damage healed), momentum (+ the spear
    // momentum bonus at full speed), backstab (+ backstab mult), regen (HP per second, even mid-fight), pierce (+ enemies a
    // thrust goes through), thorns (share of a melee hit sent back), dodge (chance to avoid a hit), fireResist,
    // stunnedDmg (a multiplier: damage to stunned enemies).
    const STARTER_CLASS = 'warrior';
    const CLASSES = {
        warrior: { name: 'Warrior', icon: '⚔️', color: '#ff7b3a', cost: 0, unlock: null,
            desc: 'A sturdy all-rounder who wades into the fight.',
            passive: '+10% damage with swords and axes, +10 max health.',
            bonus: { maxHp: 10, dmg: { sword: 1.1, axe: 1.1 } },
            branches: [
                { name: 'Blade', skills: ['whirlwind', 'honed_edge', 'execute', 'deep_cuts'] },
                { name: 'Fury', skills: ['war_cry', 'bloodthirst', 'berserk', 'relentless'] },
                { name: 'Earth', skills: ['thick_skin', 'shockwave', 'iron_body', 'earthsplitter'] },
            ] },
        guardian: { name: 'Guardian', icon: '🛡️', color: '#9fc3ff', cost: 250, unlock: { stat: 'blocks', n: 25, text: 'Block 25 attacks with your shield' },
            desc: 'A wall of steel that outlasts anything.',
            passive: '+15 max health, +4 armor.',
            bonus: { maxHp: 15, armor: 4 },
            branches: [
                { name: 'Bulwark', skills: ['shield_slam', 'steady_guard', 'shield_charge', 'spiked_shield'] },
                { name: 'Endurance', skills: ['second_wind', 'vigor', 'stoneskin', 'regeneration'] },
                { name: 'Sanctuary', skills: ['tough', 'mirror_guard', 'iron_will', 'sanctuary'] },
            ] },
        // agile, and patient: it makes a small opening (a stun, a parry, a hook) and turns it into one big hit
        rogue: { name: 'Rogue', icon: '🗡️', color: '#c58bff', cost: 300, unlock: { stat: 'backstabs', n: 10, text: 'Land 10 backstabs with a dagger' },
            desc: 'Fast and slippery. It waits for an opening, then makes it count.',
            passive: '+20% dagger damage, +8% move speed, and your dash recharges 15% faster.',
            bonus: { speed: 0.08, dashCd: 0.85, dmg: { dagger: 1.2 } },
            branches: [
                { name: 'Shadow', skills: ['grapple', 'light_feet', 'shadowstep', 'phantom'] },
                { name: 'Counter', skills: ['riposte', 'vicious', 'quick_cut', 'assassin'] },
                { name: 'Execution', skills: ['opportunist', 'deadly_throw', 'cunning', 'smoke_bomb'] },
            ] },
        ranger: { name: 'Ranger', icon: '🏹', color: '#9be37d', cost: 300, unlock: { stat: 'arrowHits', n: 30, text: 'Hit 30 arrows on enemies' },
            desc: 'Keeps its distance and never runs dry.',
            passive: '+15% bow damage, 15% of shots keep their arrow.',
            bonus: { arrowSave: 0.15, dmg: { bow: 1.15 } },
            branches: [
                { name: 'Marksman', skills: ['eagle_eye', 'net_shot', 'deadeye', 'piercing_shot'] },
                { name: 'Volley', skills: ['arrow_volley', 'quiver', 'rain_of_arrows', 'barrage'] },
                { name: 'Survival', skills: ['disengage', 'trailblazer', 'hunters_mark', 'survivalist'] },
            ] },
        lancer: { name: 'Lancer', icon: '🔱', color: '#e8c27a', cost: 400, unlock: { stat: 'rushHits', n: 20, text: 'Land 20 charging spear thrusts (thrust while moving toward the enemy)' },
            desc: 'Turns speed into damage: the faster you go, the harder the spear hits.',
            passive: '+15% spear damage, +20% momentum bonus at full speed.',
            bonus: { momentum: 0.2, dmg: { spear: 1.15 } },
            branches: [
                { name: 'Charge', skills: ['lunge', 'gathering_speed', 'pole_vault', 'unstoppable'] },
                { name: 'Point', skills: ['javelin', 'skewer', 'impale', 'lethal_point'] },
                { name: 'Warden', skills: ['sweep', 'footwork', 'fervor', 'dragoon'] },
            ] },
        mystic: { name: 'Mystic', icon: '🔮', color: '#7fd4ff', cost: 500, unlock: { boss: 'overgrown', text: 'Beat The Overgrown' },
            desc: 'Bends fire, frost and lightning, but bruises easily.',
            passive: 'Abilities hit 15% harder and recharge 10% faster, -10 max health.',
            bonus: { maxHp: -10, abilityDmg: 1.15, abilityCd: 0.9 },
            branches: [
                { name: 'Storm', skills: ['chain_lightning', 'conduit', 'singularity', 'overcharge'] },
                { name: 'Fire', skills: ['fire_nova', 'kindling', 'meteor', 'ember_soul'] },
                { name: 'Frost', skills: ['frost_armor', 'blizzard', 'clarity', 'frost_nova'] },
            ] },
    };
    const CLASS_ORDER = Object.keys(CLASSES);
    // Abilities. kind decides what the rest means (world-actors.js castAbility):
    // nova (radius around you), cone (range, arc in front), blink (dist; back: kick, then leap away from the cursor),
    // charge (dash dist, hitting a band width wide), volley (projectiles), shot (one projectile; pierce, stun),
    // chain (lightning that jumps), smoke, heal (share of max health), buff (time plus its effects: dmgMult, speedMult,
    // reduce (damage taken), noKb, reflect (projectiles), crit, momentum), leap (jump up to dist toward
    // the cursor, then a nova), line (len x width toward the cursor), field (an area for time s at the cursor or on you,
    // hitting every tick s after delay; pull, heal, chill, burn, stun), step (appear behind the enemy nearest the cursor),
    // hook (a hook out to range px: it pulls you to the wall or enemy it catches; an enemy is hurt and stunned), parry (a
    // guard window s long: the next hit in it is cancelled and its attacker is hurt; stunned if a monster, out of stamina
    // and unable to recover it for exhaust s if a player).
    // momentum: true scales the hit with how fast you were moving toward the target, like a spear thrust.
    // charges: how many casts it holds; each comes back cd s after it was used, one at a time (default 1).
    // stunnedMult: extra damage multiplier against a stunned enemy.
    const ABILITIES = {
        // Warrior
        whirlwind:   { name: 'Whirlwind',   icon: '🌀', kind: 'nova',   cost: 150,  boss: null,        cd: 7,  stam: 25, radius: 82,  dmg: 1.3, kb: 420, color: '#dfe6f2',
            desc: 'Spin and cut everything around you.' },
        war_cry:     { name: 'War Cry',     icon: '📣', kind: 'nova',   cost: 200,  boss: null,        cd: 14, stam: 15, radius: 150, dmg: 0.4, kb: 300, stun: 1.4, color: '#ffb36b',
            desc: 'Roar: enemies around you are shoved back and stunned.' },
        execute:     { name: 'Execute',     icon: '💀', kind: 'cone',   cost: 650,  boss: 'overgrown', cd: 8,  stam: 20, range: 95, arc: 1.0, dmg: 2.2, kb: 200, execute: 0.35, color: '#ff4d6d',
            desc: 'A brutal chop in front of you that deals double damage to enemies under 35% health.' },
        shockwave:   { name: 'Shockwave',   icon: '💥', kind: 'cone',   cost: 500,  boss: 'gilded',    cd: 11, stam: 30, range: 170, arc: 1.9, dmg: 1.9, kb: 640, stun: 1.2, color: '#ffc83d',
            desc: 'Slam the ground in front of you: heavy damage, a big shove and a stun.' },
        berserk:     { name: 'Berserk',     icon: '😤', kind: 'buff',   cost: 1000, boss: 'inferno',   cd: 36, stam: 0,  time: 7, dmgMult: 1.35, speedMult: 1.25, color: '#ff4d4d',
            desc: 'For 7 seconds you hit 35% harder and move 25% faster.' },
        earthsplitter: { name: 'Earthsplitter', icon: '⛰️', kind: 'line', cost: 1500, boss: 'frozen', cd: 16, stam: 30, len: 320, width: 26, dmg: 2.2, kb: 300, stun: 1.0, color: '#c9a36b',
            desc: 'Split the ground in a long line toward your cursor, stunning everything along it.' },
        // Guardian
        shield_slam: { name: 'Shield Slam', icon: '🔨', kind: 'cone',   cost: 150,  boss: null,        cd: 7,  stam: 18, range: 80, arc: 1.6, dmg: 1.1, kb: 520, stun: 1.4, color: '#cfd8e6',
            desc: 'Bash with your shield: a short shove that stuns whatever is in front of you.' },
        shield_charge: { name: 'Shield Charge', icon: '🐂', kind: 'charge', cost: 700, boss: 'gilded', cd: 9,  stam: 25, dist: 170, width: 24, dmg: 1.4, kb: 560, stun: 1.0, iframes: 0.2, color: '#9fc3ff',
            desc: 'Charge forward behind your shield, flattening and stunning everything in the way.' },
        second_wind: { name: 'Second Wind', icon: '💚', kind: 'heal',   cost: 200,  boss: null,        cd: 40, stam: 0,  heal: 0.4, color: '#7dff9a',
            desc: 'Recover 40% of your health at once.' },
        stoneskin:   { name: 'Stoneskin',   icon: '🪨', kind: 'buff',   cost: 650,  boss: 'overgrown', cd: 26, stam: 20, time: 6, reduce: 0.5, noKb: true, color: '#b9a98a',
            desc: 'Take half damage and ignore knockback for 6 seconds.' },
        mirror_guard: { name: 'Mirror Guard', icon: '🪞', kind: 'buff', cost: 600,  boss: 'overgrown', cd: 22, stam: 15, time: 5, reflect: true, color: '#bfe3ff',
            desc: 'For 5 seconds, projectiles that hit you fly straight back at whoever shot them.' },
        sanctuary:   { name: 'Sanctuary',   icon: '🔆', kind: 'field',  cost: 1600, boss: 'inferno',   cd: 30, stam: 20, at: 'self', r: 110, tick: 0.5, time: 6, dmg: 0.25, heal: 0.025, color: '#ffe9a3',
            desc: 'Bless the ground around you for 6 seconds: you heal while you stand in it, and enemies in it are hurt by the light.' },
        // Rogue
        grapple:     { name: 'Grappling Hook', icon: '🪝', kind: 'hook', cost: 200,  boss: null,        cd: 7,  charges: 2, stam: 10, range: 340, dmg: 1.2, stun: 0.9, color: '#c9b38f',
            desc: 'Fire a hook toward your cursor. It pulls you to the wall it bites or to the enemy it catches, which is hurt and stunned for a moment. Holds 2 charges.' },
        shadowstep:  { name: 'Shadowstep',  icon: '👤', kind: 'step',   cost: 700,  boss: 'gilded',    cd: 9,  stam: 20, range: 220, dmg: 2.4, iframes: 0.3, color: '#9b7dff',
            desc: 'Vanish and reappear behind the enemy nearest your cursor with a heavy stab.' },
        riposte:     { name: 'Riposte',     icon: '🤺', kind: 'parry',  cost: 250,  boss: null,        cd: 8,  stam: 10, window: 0.45, range: 1100, dmg: 1.8, stun: 2.0, exhaust: 3, color: '#ffe7a3',
            desc: 'Raise your guard for a split second. A hit that lands in it does nothing, and its attacker is disarmed and cut: a monster is stunned, a player loses all their stamina and can\'t recover it for 3 seconds.' },
        quick_cut:   { name: 'Quick Cut',   icon: '⚡', kind: 'charge', cost: 600,  boss: 'overgrown', cd: 6,  charges: 3, stam: 12, dist: 110, width: 20, dmg: 1.1, kb: 200, iframes: 0.15, color: '#d9dde6',
            desc: 'A short dash that cuts everything you pass through. Holds 3 charges.' },
        deadly_throw: { name: 'Deadly Throw', icon: '🔪', kind: 'shot', cost: 500, boss: 'overgrown', cd: 10, stam: 18, speed: 1100, life: 0.5, dmg: 3.2, pierce: 0, kb: 220, look: 'knife', stunnedMult: 2, color: '#e8e0ff',
            desc: 'Hurl a weighted dagger: one heavy hit, twice as heavy on a stunned enemy. Uses no daggers.' },
        smoke_bomb:  { name: 'Smoke Bomb',  icon: '💨', kind: 'smoke',  cost: 1200, boss: 'inferno',   cd: 18, stam: 20, radius: 125, stun: 2.2, iframes: 0.6, color: '#8a8f9c',
            desc: 'Vanish in smoke: enemies around you are dazed and lose track of you.' },
        // Ranger
        net_shot:    { name: 'Net Shot',    icon: '🕸️', kind: 'shot',   cost: 450,  boss: 'overgrown', cd: 10, stam: 15, speed: 900, life: 0.7, dmg: 0.6, pierce: 0, stun: 2.0, color: '#e9e2c8',
            desc: 'Fire a weighted net that pins the first enemy it hits for 2 seconds. Uses no arrows.' },
        piercing_shot: { name: 'Piercing Shot', icon: '☄️', kind: 'shot', cost: 1300, boss: 'inferno', cd: 10, stam: 25, speed: 1150, life: 0.9, dmg: 3.2, pierce: 99, big: true, color: '#ffc83d',
            desc: 'A heavy shot that goes through every enemy in a line. Uses no arrows.' },
        arrow_volley: { name: 'Arrow Volley', icon: '🎯', kind: 'volley', cost: 200, boss: null,     cd: 9,  stam: 25, count: 7, spread: 0.9, speed: 820, life: 0.8, dmg: 0.9, color: '#e9e2c8',
            desc: 'Loose a fan of 7 arrows toward your cursor. Uses no arrows.' },
        rain_of_arrows: { name: 'Rain of Arrows', icon: '🌧️', kind: 'field', cost: 800, boss: 'gilded', cd: 15, stam: 25, at: 'cursor', range: 320, r: 90, delay: 0.4, tick: 0.25, time: 2.4, dmg: 0.35, color: '#e9e2c8',
            desc: 'Arrows rain on a spot near your cursor for 2 seconds. Uses no arrows.' },
        disengage:   { name: 'Disengage',   icon: '🦘', kind: 'blink',  cost: 200,  boss: null,        cd: 6,  stam: 15, dist: 150, iframes: 0.25, back: true, radius: 70, dmg: 0.4, kb: 520, color: '#9be37d',
            desc: 'Kick nearby enemies away and leap back, away from your cursor.' },
        hunters_mark: { name: "Hunter's Mark", icon: '👁️', kind: 'buff', cost: 700, boss: 'overgrown', cd: 28, stam: 10, time: 8, crit: 0.25, dmgMult: 1.15, color: '#ffd36b',
            desc: 'For 8 seconds: +25% critical chance and 15% more weapon damage.' },
        // Lancer
        lunge:       { name: 'Lunge',       icon: '🏇', kind: 'charge', cost: 200,  boss: null,        cd: 6,  stam: 20, dist: 160, width: 22, dmg: 1.5, kb: 380, iframes: 0.2, momentum: true, color: '#e8c27a',
            desc: 'Lunge forward spear-first through everything in your path. Hits harder the faster you were moving.' },
        pole_vault:  { name: 'Pole Vault',  icon: '🤸', kind: 'leap',   cost: 750,  boss: 'gilded',    cd: 10, stam: 25, dist: 230, radius: 80, dmg: 1.4, kb: 380, stun: 0.8, iframes: 0.35, color: '#ffd27a',
            desc: 'Vault toward your cursor and land with a crash that stuns everything nearby.' },
        javelin:     { name: 'Javelin',     icon: '📍', kind: 'shot',   cost: 250,  boss: null,        cd: 7,  stam: 18, speed: 950, life: 0.75, dmg: 2.0, pierce: 3, kb: 300, momentum: true, look: 'spear', color: '#e8c27a',
            desc: 'Hurl a spare spear that goes through 3 enemies. Hits harder the faster you were moving.' },
        impale:      { name: 'Impale',      icon: '💢', kind: 'line',   cost: 800,  boss: 'overgrown', cd: 9,  stam: 22, len: 230, width: 18, dmg: 2.6, kb: 260, momentum: true, color: '#ffcf8a',
            desc: 'A lightning-fast thrust that strikes every enemy in a long line. Hits harder the faster you were moving.' },
        sweep:       { name: 'Sweep',       icon: '🌊', kind: 'nova',   cost: 200,  boss: null,        cd: 7,  stam: 18, radius: 95, dmg: 0.9, kb: 700, color: '#f2dfb3',
            desc: 'Swing the shaft in a full circle, hurling everything around you away.' },
        fervor:      { name: 'Fervor',      icon: '🐉', kind: 'buff',   cost: 900,  boss: 'inferno',   cd: 30, stam: 10, time: 8, speedMult: 1.3, momentum: 0.6, color: '#ffb347',
            desc: 'For 8 seconds you move 30% faster and gain a much bigger momentum bonus.' },
        // Mystic
        chain_lightning: { name: 'Chain Lightning', icon: '⚡', kind: 'chain', cost: 250, boss: null, cd: 6, stam: 20, range: 280, jump: 150, jumps: 4, dmg: 1.5, falloff: 0.8, stun: 0.3, color: '#bfe3ff',
            desc: 'Lightning strikes the enemy nearest your cursor and jumps to 4 more.' },
        singularity: { name: 'Singularity', icon: '🕳️', kind: 'field',  cost: 900,  boss: 'gilded',    cd: 16, stam: 25, at: 'cursor', range: 300, r: 150, tick: 0.2, time: 2, dmg: 0.12, pull: 280, color: '#b48bff',
            desc: 'Open a rift near your cursor that drags enemies into its centre for 2 seconds.' },
        fire_nova:   { name: 'Fire Nova',   icon: '🔥', kind: 'nova',   cost: 300,  boss: null,        cd: 10, stam: 30, radius: 125, dmg: 1.6, kb: 360, burn: true, color: '#ff7b3a',
            desc: 'A ring of fire that burns everything it touches.' },
        meteor:      { name: 'Meteor',      icon: '🌠', kind: 'field',  cost: 1000, boss: 'inferno',   cd: 18, stam: 30, at: 'cursor', range: 320, r: 95, delay: 1.1, tick: 9, time: 1.15, dmg: 4.0, kb: 450, burn: true, stun: 1.0, color: '#ff7b3a',
            desc: 'Call down a meteor near your cursor. It lands a second later: huge damage, burns and stuns.' },
        blizzard:    { name: 'Blizzard',    icon: '🌨️', kind: 'field',  cost: 700,  boss: 'gilded',    cd: 15, stam: 25, at: 'cursor', range: 300, r: 120, tick: 0.5, time: 4, dmg: 0.4, chill: true, color: '#cfefff',
            desc: 'A freezing storm near your cursor for 4 seconds that chills and hurts everything inside.' },
        frost_nova:  { name: 'Frost Nova',  icon: '❄️', kind: 'nova',   cost: 1500, boss: 'frozen',    cd: 14, stam: 30, radius: 140, dmg: 1.3, kb: 200, chill: true, stun: 0.8, color: '#9ad7ff',
            desc: 'A burst of ice that chills and briefly freezes enemies around you.' },
    };
    // Perks: passive bonuses (keys as for class bonuses above), on while you are their class
    const PERKS = {
        // Warrior
        honed_edge:   { name: 'Honed Edge',   icon: '🔪', cost: 300,  boss: null,     bonus: { dmg: { sword: 1.1, axe: 1.1 } }, desc: '+10% damage with swords and axes.' },
        deep_cuts:    { name: 'Deep Cuts',    icon: '🩸', cost: 1300, boss: 'gilded', bonus: { crit: 0.08 }, desc: '+8% critical chance.' },
        bloodthirst:  { name: 'Bloodthirst',  icon: '🧛', cost: 350,  boss: null,     bonus: { lifesteal: 0.03 }, desc: 'Heal 3% of the weapon damage you deal.' },
        relentless:   { name: 'Relentless',   icon: '🔁', cost: 1400, boss: null,     bonus: { stamRegen: 0.25, dashCd: 0.75 }, desc: '+25% stamina regen, and your dash recharges 25% faster.' },
        thick_skin:   { name: 'Thick Skin',   icon: '💪', cost: 200,  boss: null,     bonus: { maxHp: 20 }, desc: '+20 max health.' },
        iron_body:    { name: 'Iron Body',    icon: '⚙️', cost: 700,  boss: null,     bonus: { armor: 6, maxHp: 10 }, desc: '+6 armor and +10 max health.' },
        // Guardian
        steady_guard: { name: 'Steady Guard', icon: '⚓', cost: 300,  boss: null,     bonus: { blockStam: 0.65 }, desc: 'Blocking costs 35% less stamina.' },
        spiked_shield: { name: 'Spiked Shield', icon: '🌵', cost: 1300, boss: 'inferno', bonus: { thorns: 0.3 }, desc: 'Enemies that hit you up close take 30% of the hit back.' },
        vigor:        { name: 'Vigor',        icon: '❤️', cost: 350,  boss: null,     bonus: { maxHp: 25 }, desc: '+25 max health.' },
        regeneration: { name: 'Regeneration', icon: '🌱', cost: 1500, boss: 'frozen', bonus: { regen: 2 }, desc: 'Regenerate 2 health every second, even mid-fight.' },
        tough:        { name: 'Tough as Nails', icon: '🪖', cost: 250, boss: null,    bonus: { armor: 6 }, desc: '+6 armor.' },
        iron_will:    { name: 'Iron Will',    icon: '⏳', cost: 900,  boss: 'gilded', bonus: { abilityCd: 0.85 }, desc: 'Abilities recharge 15% faster.' },
        // Rogue
        light_feet:   { name: 'Light Feet',   icon: '👟', cost: 300,  boss: null,     bonus: { speed: 0.08, dashCd: 0.7 }, desc: '+8% move speed, and your dash recharges 30% faster.' },
        phantom:      { name: 'Phantom',      icon: '👻', cost: 1400, boss: 'inferno', bonus: { dodge: 0.12 }, desc: '12% chance to dodge a hit completely.' },
        vicious:      { name: 'Vicious',      icon: '😈', cost: 400,  boss: null,     bonus: { backstab: 0.5 }, desc: 'Backstabs deal x2 damage instead of x1.5.' },
        assassin:     { name: 'Assassin',     icon: '🥷', cost: 1300, boss: 'gilded', bonus: { crit: 0.08 }, desc: '+8% critical chance.' },
        opportunist:  { name: 'Opportunist',  icon: '👀', cost: 200,  boss: null,     bonus: { stunnedDmg: 1.4, stamRegen: 0.1 }, desc: 'Every hit on a stunned enemy deals 40% more damage. +10% stamina regen.' },
        cunning:      { name: 'Cunning',      icon: '🃏', cost: 900,  boss: 'gilded', bonus: { abilityStam: 0.7, abilityCd: 0.9 }, desc: 'Abilities cost 30% less stamina and recharge 10% faster.' },
        // Ranger
        eagle_eye:    { name: 'Eagle Eye',    icon: '🦅', cost: 200,  boss: null,     bonus: { dmg: { bow: 1.1 } }, desc: '+10% bow damage.' },
        deadeye:      { name: 'Deadeye',      icon: '🔭', cost: 900,  boss: 'gilded', bonus: { crit: 0.1 }, desc: '+10% critical chance.' },
        quiver:       { name: 'Deep Quiver',  icon: '🪶', cost: 350,  boss: null,     bonus: { arrowSave: 0.15 }, desc: '15% more of your shots keep their arrow.' },
        barrage:      { name: 'Barrage',      icon: '🎆', cost: 1400, boss: 'frozen', bonus: { abilityDmg: 1.15 }, desc: 'Abilities hit 15% harder.' },
        trailblazer:  { name: 'Trailblazer',  icon: '🧭', cost: 300,  boss: null,     bonus: { speed: 0.08, stamRegen: 0.15 }, desc: '+8% move speed and +15% stamina regen.' },
        survivalist:  { name: 'Survivalist',  icon: '🏕️', cost: 1200, boss: null,     bonus: { maxHp: 20, regen: 1 }, desc: '+20 max health, and regenerate 1 health every second.' },
        // Lancer
        gathering_speed: { name: 'Gathering Speed', icon: '📈', cost: 350, boss: null, bonus: { momentum: 0.3 }, desc: '+30% more momentum bonus at full speed.' },
        unstoppable:  { name: 'Unstoppable',  icon: '🚀', cost: 1300, boss: null,     bonus: { dashCd: 0.65, dashStam: 0.6 }, desc: 'Your dash recharges 35% faster and costs 40% less stamina.' },
        skewer:       { name: 'Skewer',       icon: '🍢', cost: 400,  boss: null,     bonus: { pierce: 1 }, desc: 'Spear thrusts go through one more enemy.' },
        lethal_point: { name: 'Lethal Point', icon: '✴️', cost: 1400, boss: 'frozen', bonus: { crit: 0.08, dmg: { spear: 1.1 } }, desc: '+8% critical chance and +10% spear damage.' },
        footwork:     { name: 'Footwork',     icon: '👣', cost: 300,  boss: null,     bonus: { speed: 0.1 }, desc: '+10% move speed (more speed, more momentum).' },
        dragoon:      { name: 'Dragoon',      icon: '🐲', cost: 1200, boss: null,     bonus: { maxHp: 20, abilityDmg: 1.1 }, desc: '+20 max health, and abilities hit 10% harder.' },
        // Mystic
        conduit:      { name: 'Conduit',      icon: '🔋', cost: 400,  boss: null,     bonus: { abilityCd: 0.85 }, desc: 'Abilities recharge 15% faster.' },
        overcharge:   { name: 'Overcharge',   icon: '💫', cost: 1500, boss: 'frozen', bonus: { abilityDmg: 1.15 }, desc: 'Abilities hit 15% harder.' },
        kindling:     { name: 'Kindling',     icon: '🕯️', cost: 400,  boss: null,     bonus: { abilityStam: 0.75 }, desc: 'Abilities cost 25% less stamina.' },
        ember_soul:   { name: 'Ember Soul',   icon: '❤️‍🔥', cost: 1300, boss: null,   bonus: { fireResist: 0.3, maxHp: 15 }, desc: 'Take 30% less fire and lava damage, +15 max health.' },
        frost_armor:  { name: 'Frost Armor',  icon: '🧊', cost: 250,  boss: null,     bonus: { armor: 6, maxHp: 15 }, desc: '+6 armor and +15 max health.' },
        clarity:      { name: 'Clarity',      icon: '🌙', cost: 900,  boss: null,     bonus: { stamRegen: 0.25, abilityStam: 0.8 }, desc: '+25% stamina regen, and abilities cost 20% less stamina.' },
    };
    // every skill knows its id, class, branch, row and the skill it needs (the one above it)
    for (const c of CLASS_ORDER) CLASSES[c].branches.forEach((br, b) => br.skills.forEach((id, row) => {
        const sk = ABILITIES[id] || PERKS[id];
        Object.assign(sk, { id, cls: c, branch: b, row, req: row ? br.skills[row - 1] : null, type: ABILITIES[id] ? 'ability' : 'perk' });
    }));
    const ABILITY_KEYS = ['R', 'Q', 'C'];
    const ABILITY_ORDER = Object.keys(ABILITIES);
    const PERK_ORDER = Object.keys(PERKS);

    // ---------------- trader ----------------
    const TRADER_STOCK = [
        { id: 'potion_small', price: 15, give: { potion_small: 1 } },
        { id: 'potion_big', price: 40, give: { potion_big: 1 } },
        { id: 'potion_max', price: 100, give: { potion_max: 1 } },
        { id: 'arrows', price: 30, give: { arrow: 20 } },
        { id: 'coal', price: 6, give: { coal: 2 } },
        { id: 'fiber', price: 6, give: { fiber: 3 } },
        { id: 'sword_0', price: 10, gear: 'sword_0' },
        { id: 'pickaxe_0', price: 10, gear: 'pickaxe_0' },
        { id: 'axe_0', price: 10, gear: 'axe_0' },
        { id: 'shield_0', price: 15, gear: 'shield_0' },
    ];

    // ---------------- misc rules ----------------
    const RULES = {
        maxGear: 80,
        graveShare: 0.3,       // share of each carried stack dropped on death
        reforgeShare: 0.5,     // share of materials a reforge costs again
        salvageShare: 0.4,     // share of materials salvaging gear returns
        hotbarSlots: 5,
        zoneScale: { hp: 1.7, dmg: 1.5, rubies: 1.8 }, // already built into the monster numbers above, kept for reference
        tierShift: { up95: 0.5, up85: 0.2, downBelow: 25 },
    };

    return {
        TILE, WORLD_SEED, MATERIALS, MATERIALS_BY_ID, CONSUMABLES, CONSUMABLES_BY_ID, WEAPON_CLASSES, COMBAT,
        QUALITY, AFFIXES, TIERS, GEAR, GEAR_BY_ID, RINGS, STARTER_KIT, STARTER_OFFHAND, SHIELD_STATS, BASIC_RECIPES, BASIC_BY_ID,
        BOX_RECIPES, BOX_NAMES, BOX_POINTS, BOX_COLORS, CAPS, NODES, SAVED_RESPAWN_SEC, MONSTERS, ELITE_GEM_CHANCE,
        BOSSES, RIVALS, RIVAL_TIERS, RIVAL_RESPAWN_SEC, RIVAL_WEAPON_DROP, ZONES, ZONE_ORDER, MONSTER_RESPAWN_SEC,
        ELITE_RESPAWN_SEC, STATIONS, STARTER_CLASS, CLASSES, CLASS_ORDER, ABILITIES, ABILITY_ORDER, ABILITY_KEYS, PERKS, PERK_ORDER, NPCS, NPC_ORDER, QUESTS, HIDDEN_SHOP, TRADER_STOCK, RULES,
    };
}));
