/**
 * Relic gear's shared rules: the seven relic tiers, gear for the game (the clicker: five slots, boosts per tier), the unique
 * pieces' names, shapes, outlines and words, and the pictures (iconSvg) both pages draw. A relic is forged in the Wilds'
 * Crucible (core/world-relics.js) from essences; gear for the game travels to the clicker over the reward bridge
 * (core/world-bridge.js `gear`) and lives there in localStorage 'whathappened_gear' (gear-panel.js, its only writer).
 *
 * A piece for the game: { id, s (slot), t (tier 0-6), l: [[aspect, roll 0.85-1.15], ...] (its boosts, never the same aspect
 * twice; the first is its main aspect), c: [main colour, trim colour] (from the essences it was made of), q (unique id or ''),
 * by (who forged it), n (times it changed hands), lv (upgrade level 0-5), at }. Boost values are worked out from the tier,
 * the roll and the level (lineValue), never saved, so a damaged or edited save can't claim more than the tables give.
 *
 * Works in a browser (<script src="core/gear.js"> sets window.WHGear) and in Node (require).
 */
(function (root, factory) {
    if (typeof module === 'object' && module.exports) module.exports = factory();
    else root.WHGear = factory();
}(typeof self !== 'undefined' ? self : this, function () {
    'use strict';

    // ---------------- tiers ----------------
    // wilds: stat multiplier for a Wilds relic; lines: how many boosts a piece has; outline: how its picture is edged
    const TIERS = [
        { id: 'common', name: 'Common', color: '#b4bccd', wilds: 1.00, lines: 1, outline: 'none' },
        { id: 'uncommon', name: 'Uncommon', color: '#4fd27a', wilds: 1.06, lines: 1, outline: 'thin' },
        { id: 'rare', name: 'Rare', color: '#4fa8ff', wilds: 1.12, lines: 2, outline: 'double' },
        { id: 'epic', name: 'Epic', color: '#b07dff', wilds: 1.19, lines: 2, outline: 'dashed' },
        { id: 'legendary', name: 'Legendary', color: '#ffc83d', wilds: 1.27, lines: 3, outline: 'gold' },
        { id: 'mythic', name: 'Mythic', color: '#ff4d6d', wilds: 1.36, lines: 3, outline: 'pulse' },
        { id: 'primordial', name: 'Primordial', color: '#7df9ff', wilds: 1.45, lines: 4, outline: 'prism' },
    ];
    const MAX_TIER = TIERS.length - 1;
    const MAX_LEVEL = 5, LEVEL_STEP = 0.08; // each upgrade level: +8% to a piece's boosts
    // ---------------- gear for the game ----------------
    const SLOTS = ['cursor', 'crown', 'cloak', 'ring', 'relic'];
    const SLOT_NAMES = { cursor: 'Cursor', crown: 'Crown', cloak: 'Cloak', ring: 'Ring', relic: 'Relic' };
    // a boost's size by tier (percent; crit chance in points): the weakest ~5%, every tier better, the rarest massive
    const MAIN = [5, 8, 12, 20, 35, 75, 200];
    const CRIT = [1, 1.5, 2, 3, 4, 6, 10];
    const MINOR = [2, 3, 4, 6, 8, 12, 20];
    const SCALE = { click: MAIN, cps: MAIN, offline: MAIN, critDmg: MAIN, critChance: CRIT, gems: MINOR, boxRate: MINOR };
    // what each aspect does in the game: [bonus key, share of the tier's value]
    const ASPECT_GAME = {
        might: [['click', 1]], swift: [['cps', 1]], ward: [['offline', 1]], keen: [['critChance', 1]],
        vigor: [['cps', 0.5], ['click', 0.5]], fortune: [['gems', 1], ['boxRate', 1]], ember: [['critDmg', 1]], frost: [['offline', 0.5], ['cps', 0.5]],
    };
    const ASPECT_IDS = Object.keys(ASPECT_GAME);
    const ASPECT_NAMES = { might: 'Might', swift: 'Swift', ward: 'Ward', keen: 'Keen', vigor: 'Vigor', fortune: 'Fortune', ember: 'Ember', frost: 'Frost' };
    const BONUS_LABELS = { click: 'click power', cps: 'income per second', offline: 'offline earnings', critChance: 'critical click chance', critDmg: 'critical click damage', gems: 'gem find', boxRate: 'lootbox rate' };
    // Attunement: 3 (or 5) pieces worn with the same main aspect raise that aspect's boosts by this much
    const ATTUNE = { 3: 0.10, 5: 0.25 };
    const CRIT_CAP = 25; // gear's crit chance, in points, all together
    const ROLL = { lo: 0.85, hi: 1.15 };
    const MAX_PIECES = 120;

    // ---------------- the unique pieces ----------------
    // kind: 'wilds' (weapon or armor: cls / slot) or 'game' (s: slot). shape: its own picture; outline: its own edge; sig:
    // its signature boosts [aspect, ...] (always among its lines); need: the dungeon Heart that must be among the essences
    // (core/world-data.js DUNGEONS), or null. Only a Legendary or better forge can make one.
    const UNIQUES = [
        // the Wilds
        { id: 'wyrmtongue', kind: 'wilds', cls: 'sword', name: 'Wyrmtongue', shape: 'flamberge', outline: 'flames', sig: ['ember', 'might'], need: 'heart_crypt',
            desc: 'Its wavy blade was cooled in the Cinder Lich\'s own ashes. Every cut keeps on burning.' },
        { id: 'glacier_edge', kind: 'wilds', cls: 'sword', name: "Glacier's Edge", shape: 'crystal', outline: 'frost', sig: ['frost', 'ward'], need: 'heart_tomb',
            desc: 'A blade of ice that never melts, chipped from the Glacier Queen\'s throne.' },
        { id: 'verdant_oath', kind: 'wilds', cls: 'sword', name: 'Verdant Oath', shape: 'leafblade', outline: 'thorns', sig: ['vigor', 'swift'], need: 'heart_roots',
            desc: 'Shaped like a leaf and just as light. It drinks a little from everything it cuts.' },
        { id: 'first_spark', kind: 'wilds', cls: 'sword', name: 'The First Spark', shape: 'runeblade', outline: 'runes', sig: ['might', 'keen'], need: null,
            desc: 'Runes nobody can read run down its fuller. They glow brighter just before a killing blow.' },
        { id: 'midas_fang', kind: 'wilds', cls: 'dagger', name: 'Midas Fang', shape: 'fang', outline: 'gold', sig: ['fortune', 'keen'], need: 'heart_deep',
            desc: 'A curved gold tooth from the Gold Tyrant\'s hoard. Strange how much more you find with it.' },
        { id: 'whisper_ink', kind: 'wilds', cls: 'dagger', name: 'Whisper of Ink', shape: 'kris', outline: 'runes', sig: ['keen', 'swift'], need: 'heart_archive',
            desc: 'Written, not forged: a sentence from the Buried Archive that cuts.' },
        { id: 'tide_trident', kind: 'wilds', cls: 'spear', name: "Tidecaller's Trident", shape: 'trident', outline: 'waves', sig: ['ward', 'might'], need: 'heart_vault',
            desc: 'Three prongs, and the sea behind each of them. The Drowned King held it before you.' },
        { id: 'stormpiercer', kind: 'wilds', cls: 'spear', name: 'Stormpiercer', shape: 'bolt', outline: 'storm', sig: ['swift', 'might'], need: 'heart_forge',
            desc: 'Its head is a bolt of lightning the Stormforge caught and hammered straight. Almost straight.' },
        { id: 'seraph_arc', kind: 'wilds', cls: 'bow', name: "Seraph's Arc", shape: 'hornbow', outline: 'stars', sig: ['might', 'keen'], need: 'heart_cistern',
            desc: 'Strung with a feather from the Fallen Seraph. Arrows from it leave a trail of stars.' },
        { id: 'starweave', kind: 'wilds', cls: 'staff', name: 'Starweave Staff', shape: 'forked', outline: 'stars', sig: ['keen', 'fortune'], need: 'heart_cistern',
            desc: 'Two branches that never quite meet, with a night sky held between them.' },
        { id: 'thorn_crown', kind: 'wilds', slot: 'helmet', name: 'Crown of Thorns', shape: 'thorncrown', outline: 'thorns', sig: ['vigor', 'ward'], need: 'heart_roots',
            desc: 'It grew around the Root Mother\'s brow. It still grows, slowly, around yours.' },
        { id: 'deep_helm', kind: 'wilds', slot: 'helmet', name: 'Horned Helm of the Deep', shape: 'hornhelm', outline: 'gold', sig: ['ward', 'fortune'], need: 'heart_deep',
            desc: 'Two gilded horns and a visor that smells of old coins.' },
        { id: 'drowned_mail', kind: 'wilds', slot: 'chest', name: 'Drowned Mail', shape: 'scales', outline: 'waves', sig: ['ward', 'vigor'], need: 'heart_vault',
            desc: 'Scale armor that is always a little damp. Blows slide off it like water.' },
        { id: 'ashen_mantle', kind: 'wilds', slot: 'chest', name: 'Ashen Mantle', shape: 'spikes', outline: 'flames', sig: ['ember', 'ward'], need: 'heart_archive',
            desc: 'Spiked plate from the Cinder Capital\'s last knight. The ash on it is warm.' },
        { id: 'windwalkers', kind: 'wilds', slot: 'boots', name: 'Windwalkers', shape: 'wings', outline: 'storm', sig: ['swift', 'vigor'], need: 'heart_forge',
            desc: 'Little wings at the heels. You don\'t walk so much as get blown along.' },
        { id: 'frostprints', kind: 'wilds', slot: 'boots', name: 'Frostprints', shape: 'frosted', outline: 'frost', sig: ['frost', 'swift'], need: 'heart_tomb',
            desc: 'Every step leaves a footprint of frost that takes a day to melt.' },
        { id: 'dawn_aegis', kind: 'wilds', slot: 'offhand', name: 'Aegis of Dawn', shape: 'sun', outline: 'gold', sig: ['ward', 'might'], need: null,
            desc: 'A shield with a sunrise on it. Facing it, enemies squint.' },
        // the game
        { id: 'golden_pointer', kind: 'game', s: 'cursor', name: 'The Golden Pointer', shape: 'goldpointer', outline: 'gold', sig: ['might', 'keen'], need: null,
            desc: 'A solid gold cursor. Every click lands like a coin dropped on marble.' },
        { id: 'echo_cursor', kind: 'game', s: 'cursor', name: 'Echoing Cursor', shape: 'echo', outline: 'storm', sig: ['swift', 'might'], need: 'heart_forge',
            desc: 'It clicks once, and the click keeps going somewhere after you stop.' },
        { id: 'endless_crown', kind: 'game', s: 'crown', name: 'Crown of Endless Clicks', shape: 'tallcrown', outline: 'stars', sig: ['might', 'swift'], need: 'heart_cistern',
            desc: 'Forged from the Star Cistern\'s light. It is heavy, and it is worth it.' },
        { id: 'thorn_diadem', kind: 'game', s: 'crown', name: 'Thorn Diadem', shape: 'thorncrown', outline: 'thorns', sig: ['vigor', 'fortune'], need: 'heart_roots',
            desc: 'A circlet of living thorns. Your followers seem to work harder near it.' },
        { id: 'still_cloak', kind: 'game', s: 'cloak', name: 'Cloak of Still Hours', shape: 'stillcloak', outline: 'frost', sig: ['ward', 'frost'], need: 'heart_tomb',
            desc: 'Time moves slower under it. While you\'re away, it keeps the clock running for you.' },
        { id: 'ember_shroud', kind: 'game', s: 'cloak', name: 'Ember Shroud', shape: 'embercloak', outline: 'flames', sig: ['ember', 'keen'], need: 'heart_crypt',
            desc: 'Its hem is always smouldering. Critical clicks come out scorched.' },
        { id: 'hoard_ring', kind: 'game', s: 'ring', name: 'Ring of the Deep Hoard', shape: 'hoardring', outline: 'gold', sig: ['fortune', 'might'], need: 'heart_deep',
            desc: 'The Gold Tyrant wore it on his little finger. Gems find their way to whoever wears it now.' },
        { id: 'tide_band', kind: 'game', s: 'ring', name: 'Tidebound Band', shape: 'tidering', outline: 'waves', sig: ['ward', 'swift'], need: 'heart_vault',
            desc: 'It comes and goes like the tide, and so do your earnings, mostly coming.' },
        { id: 'storm_bottle', kind: 'game', s: 'relic', name: 'Storm in a Bottle', shape: 'bottle', outline: 'storm', sig: ['swift', 'keen'], need: 'heart_forge',
            desc: 'A tiny thunderstorm, corked. Don\'t shake it.' },
        { id: 'archive_key', kind: 'game', s: 'relic', name: 'Key to the Archive', shape: 'key', outline: 'runes', sig: ['keen', 'ember'], need: 'heart_archive',
            desc: 'It opens the Sealed Index, and apparently your luck as well.' },
    ];
    const UNIQUES_BY_ID = Object.fromEntries(UNIQUES.map(u => [u.id, u]));

    const isObj = (v) => !!v && typeof v === 'object' && !Array.isArray(v);
    const HEX = /^#[0-9a-f]{6}$/i;
    const int = (v, lo, hi) => Math.max(lo, Math.min(hi, Math.floor(Number(v) || 0)));
    const clampRoll = (v) => { const n = Number(v); return Number.isFinite(n) ? Math.max(ROLL.lo, Math.min(ROLL.hi, Math.round(n * 1000) / 1000)) : 1; };
    const safeName = (v) => (typeof v === 'string' ? v.replace(/[<>&"'`]/g, '').slice(0, 16) : '');

    // One boost of a game piece: { key: value } (percent; crit chance in points) for aspect at tier t, roll r, level lv
    function lineValues(aspect, t, r, lv) {
        const out = {}, k = clampRoll(r) * (1 + LEVEL_STEP * int(lv, 0, MAX_LEVEL));
        for (const [key, share] of ASPECT_GAME[aspect] || []) out[key] = Math.round(SCALE[key][int(t, 0, MAX_TIER)] * share * k * 10) / 10;
        return out;
    }
    // A piece as saved, made safe: null when it isn't one. idOk: keep its id (else 0, for the caller to number)
    function cleanPiece(raw) {
        if (!isObj(raw)) return null;
        const s = SLOTS.includes(raw.s) ? raw.s : null;
        if (!s) return null;
        const t = int(raw.t, 0, MAX_TIER);
        const seen = new Set(), l = [];
        for (const x of Array.isArray(raw.l) ? raw.l : []) {
            if (!Array.isArray(x) || !ASPECT_GAME[x[0]] || seen.has(x[0])) continue;
            seen.add(x[0]); l.push([x[0], clampRoll(x[1])]);
            if (l.length >= TIERS[t].lines + 1) break; // a unique carries one more
        }
        if (!l.length) return null;
        const u = UNIQUES_BY_ID[raw.q];
        const q = u && u.kind === 'game' && u.s === s && t >= 4 ? u.id : '';
        if (!q && l.length > TIERS[t].lines) l.length = TIERS[t].lines;
        const c = Array.isArray(raw.c) && HEX.test(raw.c[0]) && HEX.test(raw.c[1]) ? [raw.c[0].toLowerCase(), raw.c[1].toLowerCase()] : [TIERS[t].color, TIERS[t].color];
        return { id: int(raw.id, 0, 1e9), s, t, l, c, q, by: safeName(raw.by), n: int(raw.n, 0, 999), lv: int(raw.lv, 0, MAX_LEVEL), at: Number(raw.at) > 0 ? Number(raw.at) : 0 };
    }
    // The boosts of a set of worn pieces, in items.js's shape (percent): { cps, click, offline, critChance, critDmg, gems,
    // boxRate }, with attunement (3 or 5 pieces of one main aspect) and the crit chance cap
    function bonuses(pieces) {
        const out = { cps: 0, click: 0, offline: 0, critChance: 0, critDmg: 0, gems: 0, boxRate: 0 };
        const list = (pieces || []).filter(Boolean);
        const mains = {};
        for (const p of list) mains[p.l[0][0]] = (mains[p.l[0][0]] || 0) + 1;
        const attune = (a) => (mains[a] >= 5 ? ATTUNE[5] : mains[a] >= 3 ? ATTUNE[3] : 0);
        for (const p of list) for (const [a, r] of p.l) {
            const v = lineValues(a, p.t, r, p.lv), k = 1 + attune(a);
            for (const key in v) out[key] += v[key] * k;
        }
        out.critChance = Math.min(CRIT_CAP, out.critChance);
        for (const k in out) out[k] = Math.round(out[k] * 10) / 10;
        return out;
    }
    function attunement(pieces) {
        const mains = {};
        for (const p of (pieces || []).filter(Boolean)) mains[p.l[0][0]] = (mains[p.l[0][0]] || 0) + 1;
        return Object.entries(mains).filter(([, n]) => n >= 3).map(([a, n]) => ({ aspect: a, n, bonus: n >= 5 ? ATTUNE[5] : ATTUNE[3] }));
    }
    function pieceName(p) {
        if (p.q && UNIQUES_BY_ID[p.q]) return UNIQUES_BY_ID[p.q].name;
        return TIERS[p.t].name + ' ' + ASPECT_NAMES[p.l[0][0]] + ' ' + SLOT_NAMES[p.s];
    }
    function lineText(a, t, r, lv) {
        const v = lineValues(a, t, r, lv);
        return Object.keys(v).map(k => '+' + v[k] + (k === 'critChance' ? ' points of ' : '% ') + BONUS_LABELS[k]).join(', ');
    }
    // the worth of a piece, for sorting and the Auction Hall's suggested price
    function score(p) { return Math.pow(3, p.t) * (1 + LEVEL_STEP * p.lv) * p.l.length * (p.q ? 2 : 1); }

    // ---------------- pictures ----------------
    // An SVG picture of a piece (64 x 64): its shape (the slot's or a unique's own), filled with the colours of the essences it
    // was made of, edged by its tier (or the unique's own outline). look: { shape, main, trim, tier (0-6), outline, uid (for
    // the gradient ids) }. Used by the clicker (gear for the game) and the Wilds (relic weapons and armor).
    const SHAPES = {
        cursor: 'M20 8 L20 52 L31 41 L38 57 L45 54 L38 38 L53 38 Z',
        goldpointer: 'M18 6 L18 54 L30 42 L38 58 L47 54 L39 38 L56 38 Z M24 18 L24 40',
        echo: 'M22 10 L22 48 L31 39 L37 52 L43 49 L37 36 L49 36 Z M12 22 A20 20 0 0 0 12 42 M6 16 A28 28 0 0 0 6 48',
        crown: 'M10 46 L12 20 L22 32 L32 14 L42 32 L52 20 L54 46 Z M12 50 L52 50 L52 56 L12 56 Z',
        tallcrown: 'M10 48 L10 14 L20 28 L26 6 L32 24 L38 6 L44 28 L54 14 L54 48 Z M10 52 L54 52 L54 58 L10 58 Z',
        thorncrown: 'M8 40 Q32 26 56 40 Q32 54 8 40 Z M12 38 L8 28 L16 35 M22 33 L20 22 L26 31 M32 31 L32 19 L36 30 M42 33 L46 22 L44 32 M52 38 L57 28 L50 36',
        cloak: 'M22 8 L42 8 L48 20 L56 58 L40 52 L32 58 L24 52 L8 58 L16 20 Z',
        stillcloak: 'M22 6 L42 6 L48 18 L56 58 L44 54 L32 60 L20 54 L8 58 L16 18 Z M26 24 A7 7 0 1 0 38 24 A7 7 0 1 0 26 24',
        embercloak: 'M22 8 L42 8 L50 22 L56 58 L48 50 L42 58 L36 50 L32 58 L28 50 L22 58 L16 50 L8 58 L14 22 Z',
        ring: 'M32 14 A18 18 0 1 0 32.01 14 Z M32 22 A10 10 0 1 1 31.99 22 Z',
        hoardring: 'M32 18 A16 16 0 1 0 32.01 18 Z M32 25 A9 9 0 1 1 31.99 25 Z M24 6 L40 6 L36 16 L28 16 Z',
        tidering: 'M32 14 A18 18 0 1 0 32.01 14 Z M32 22 A10 10 0 1 1 31.99 22 Z M12 30 Q18 24 24 30 M40 34 Q46 28 52 34',
        relic: 'M32 6 L52 22 L46 50 L32 58 L18 50 L12 22 Z M32 18 L42 26 L38 44 L32 48 L26 44 L22 26 Z',
        bottle: 'M26 6 L38 6 L38 16 L48 28 L48 54 Q48 58 44 58 L20 58 Q16 58 16 54 L16 28 L26 16 Z M28 34 L36 34 L30 44 L38 44 L28 54',
        key: 'M20 10 A10 10 0 1 0 20.01 10 Z M20 16 A4 4 0 1 1 19.99 16 Z M27 24 L56 50 L50 56 L46 52 L42 56 L38 52 L42 48 L23 30 Z',
        sword: 'M30 4 L34 4 L35 40 L29 40 Z M20 40 L44 40 L44 44 L20 44 Z M30 44 L34 44 L34 56 L30 56 Z M28 56 L36 56 L36 60 L28 60 Z',
        flamberge: 'M32 2 Q37 8 33 14 Q38 20 33 26 Q38 32 34 40 L30 40 Q26 32 31 26 Q26 20 31 14 Q27 8 32 2 Z M20 40 L44 40 L44 44 L20 44 Z M30 44 L34 44 L34 58 L30 58 Z',
        crystal: 'M32 2 L38 14 L35 22 L39 30 L34 40 L30 40 L25 30 L29 22 L26 14 Z M18 40 L46 40 L42 45 L22 45 Z M30 45 L34 45 L34 58 L30 58 Z',
        leafblade: 'M32 2 Q44 20 34 40 L30 40 Q20 20 32 2 Z M32 8 L32 38 M22 40 L42 40 L42 44 L22 44 Z M30 44 L34 44 L34 58 L30 58 Z',
        runeblade: 'M29 4 L35 4 L36 40 L28 40 Z M31 10 L33 14 L31 18 L33 22 L31 26 L33 30 M16 40 L48 40 L44 46 L20 46 Z M30 46 L34 46 L34 58 L30 58 Z',
        dagger: 'M31 12 L33 12 L35 38 L29 38 Z M22 38 L42 38 L42 42 L22 42 Z M30 42 L34 42 L34 54 L30 54 Z',
        fang: 'M28 10 Q44 22 36 40 L30 40 Q36 26 28 10 Z M22 40 L42 40 L42 44 L22 44 Z M30 44 L34 44 L34 56 L30 56 Z',
        kris: 'M32 8 Q36 14 32 20 Q36 26 32 32 L34 38 L30 38 Q28 32 30 28 Q26 22 30 18 Q27 12 32 8 Z M22 38 L42 38 L42 42 L22 42 Z M30 42 L34 42 L34 54 L30 54 Z',
        spear: 'M32 2 L38 16 L33 16 L33 60 L31 60 L31 16 L26 16 Z',
        trident: 'M31 18 L33 18 L33 60 L31 60 Z M22 4 L24 18 L40 18 L42 4 L38 12 L35 4 L33 14 L31 14 L29 4 L26 12 Z',
        bolt: 'M34 2 L26 14 L33 14 L27 26 L38 12 L31 12 Z M31 26 L33 26 L33 60 L31 60 Z',
        bow: 'M24 4 Q52 32 24 60 L27 60 Q55 32 27 4 Z M25 4 L25 60',
        hornbow: 'M20 4 Q10 10 18 14 Q52 32 18 50 Q10 54 20 60 L24 58 Q56 32 24 6 Z M22 6 L22 58 M12 28 L4 24 M12 36 L4 40',
        staff: 'M31 18 L33 18 L34 60 L30 60 Z M32 4 A8 8 0 1 0 32.01 4 Z',
        forked: 'M31 26 L33 26 L34 60 L30 60 Z M31 26 Q20 16 22 4 L25 5 Q24 15 32 22 Q40 15 39 5 L42 4 Q44 16 33 26 Z M32 10 A3 3 0 1 0 32.01 10 Z',
        helmet: 'M12 36 Q12 10 32 8 Q52 10 52 36 L52 46 L42 46 L42 36 L22 36 L22 46 L12 46 Z',
        hornhelm: 'M14 38 Q14 14 32 12 Q50 14 50 38 L50 48 L40 48 L40 38 L24 38 L24 48 L14 48 Z M16 20 Q4 14 6 2 Q10 14 20 16 Z M48 20 Q60 14 58 2 Q54 14 44 16 Z',
        chest: 'M16 10 L26 10 Q32 16 38 10 L48 10 L58 22 L50 28 L48 58 L16 58 L14 28 L6 22 Z',
        scales: 'M16 10 L26 10 Q32 16 38 10 L48 10 L58 22 L50 28 L48 58 L16 58 L14 28 L6 22 Z M20 32 Q24 36 28 32 Q32 36 36 32 Q40 36 44 32 M20 42 Q24 46 28 42 Q32 46 36 42 Q40 46 44 42',
        spikes: 'M16 12 L26 12 Q32 18 38 12 L48 12 L58 24 L50 30 L48 58 L16 58 L14 30 L6 24 Z M10 16 L4 6 L16 12 M54 16 L60 6 L48 12 M32 26 L28 36 L36 36 Z',
        boots: 'M18 6 L32 6 L32 40 L54 46 L54 56 L18 56 Z',
        wings: 'M20 10 L32 10 L32 40 L52 46 L52 56 L20 56 Z M20 20 Q6 12 4 2 Q14 10 20 12 M20 28 Q4 24 2 14 Q12 22 20 22',
        frosted: 'M18 6 L32 6 L32 40 L54 46 L54 56 L18 56 Z M14 60 L22 60 M28 60 L36 60 M42 60 L50 60 M24 20 L28 24 M24 24 L28 20',
        shield: 'M32 4 L54 12 Q54 44 32 60 Q10 44 10 12 Z',
        sun: 'M32 8 L52 14 Q52 42 32 56 Q12 42 12 14 Z M32 22 A7 7 0 1 0 32.01 22 Z M32 12 L32 16 M44 18 L41 21 M20 18 L23 21 M48 30 L44 30 M16 30 L20 30',
    };
    // a slot's or class's own shape (pieces without a unique shape)
    const BASE_SHAPE = { cursor: 'cursor', crown: 'crown', cloak: 'cloak', ring: 'ring', relic: 'relic', sword: 'sword', dagger: 'dagger', spear: 'spear', bow: 'bow',
        staff: 'staff', axe: 'sword', pickaxe: 'sword', helmet: 'helmet', chest: 'chest', boots: 'boots', offhand: 'shield' };
    // the edge drawn round a picture: [stroke width, dash, extra]
    const OUTLINES = {
        none: { w: 1.5, dash: '', col: 'rgba(0,0,0,0.55)' }, thin: { w: 2 }, double: { w: 2, double: true }, dashed: { w: 2.2, dash: '4 3' },
        gold: { w: 2.6, glow: 3 }, pulse: { w: 2.8, glow: 4, pulse: true }, prism: { w: 3, glow: 5, prism: true },
        flames: { w: 2.6, dash: '2 3', glow: 4, col: '#ff7b3a' }, frost: { w: 2.4, dash: '1 2', glow: 3, col: '#dff4ff' }, thorns: { w: 2.4, dash: '6 2', col: '#5fd068' },
        waves: { w: 2.4, dash: '8 3 2 3', glow: 3, col: '#4fd8d0' }, storm: { w: 2.4, dash: '3 2', glow: 4, col: '#c7d4ff' }, stars: { w: 2.4, dash: '1 4', glow: 5, col: '#fff2a8' },
        runes: { w: 2.4, dash: '5 2 1 2', glow: 3, col: '#c9a2ff' },
    };
    function iconSvg(look) {
        const t = int(look.tier, 0, MAX_TIER), tier = TIERS[t];
        const d = SHAPES[look.shape] || SHAPES[BASE_SHAPE[look.shape]] || SHAPES.relic;
        const o = Object.assign({ col: tier.color, dash: '' }, OUTLINES[look.outline || tier.outline] || OUTLINES.none);
        const main = HEX.test(look.main || '') ? look.main : tier.color, trim = HEX.test(look.trim || '') ? look.trim : main;
        const id = 'g' + String(look.uid || Math.floor(Math.random() * 1e9)).replace(/[^A-Za-z0-9]/g, '');
        const glow = o.glow ? `<filter id="${id}f" x="-30%" y="-30%" width="160%" height="160%"><feGaussianBlur stdDeviation="${o.glow / 2}" result="b"/><feMerge><feMergeNode in="b"/><feMergeNode in="SourceGraphic"/></feMerge></filter>` : '';
        const prism = o.prism ? `<linearGradient id="${id}p" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="#ff4d6d"/><stop offset="0.33" stop-color="#ffe14d"/><stop offset="0.66" stop-color="#4fd27a"/><stop offset="1" stop-color="#7df9ff"/>` +
            '<animateTransform attributeName="gradientTransform" type="rotate" from="0 .5 .5" to="360 .5 .5" dur="4s" repeatCount="indefinite"/></linearGradient>' : '';
        const stroke = o.prism ? `url(#${id}p)` : o.col;
        const pulse = o.pulse ? '<animate attributeName="stroke-opacity" values="1;0.35;1" dur="1.6s" repeatCount="indefinite"/>' : '';
        return `<svg viewBox="0 0 64 64" width="64" height="64" aria-hidden="true" class="gear-svg"><defs>${glow}${prism}<linearGradient id="${id}m" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="${main}"/><stop offset="1" stop-color="${trim}"/></linearGradient></defs>` +
            (o.double ? `<path d="${d}" fill="none" stroke="rgba(0,0,0,0.6)" stroke-width="${o.w + 3}" stroke-linejoin="round"/>` : '') +
            `<path d="${d}" fill="url(#${id}m)" fill-rule="evenodd" stroke="${stroke}" stroke-width="${o.w}" stroke-linejoin="round" stroke-dasharray="${o.dash}"${o.glow ? ` filter="url(#${id}f)"` : ''}>${pulse}</path>` +
            `<path d="${d}" fill="none" stroke="${trim}" stroke-opacity="0.55" stroke-width="0.8"/></svg>`;
    }
    // the picture of a piece for the game
    function pieceSvg(p) {
        const u = p.q && UNIQUES_BY_ID[p.q];
        return iconSvg({ shape: u ? u.shape : p.s, main: p.c[0], trim: p.c[1], tier: p.t, outline: u ? u.outline : null, uid: 'p' + p.id });
    }

    return { TIERS, MAX_TIER, MAX_LEVEL, LEVEL_STEP, SLOTS, SLOT_NAMES, MAIN, CRIT, MINOR, ASPECT_GAME, ASPECT_IDS, ASPECT_NAMES, BONUS_LABELS, ATTUNE, CRIT_CAP, ROLL,
        MAX_PIECES, UNIQUES, UNIQUES_BY_ID, SHAPES, BASE_SHAPE, OUTLINES, lineValues, cleanPiece, bonuses, attunement, pieceName, lineText, score, iconSvg, pieceSvg };
}));
