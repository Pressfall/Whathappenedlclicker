/**
 * The Crucible (The Wilds): essences (core/world-data.js ESSENCES, from stone and ore and the hidden dungeons) are forged
 * into relics, set into gear's sockets, and spent to upgrade relics.
 * - Forge: 3 to 8 essences and a ruby fee, then the Crucible's minigame (world-craft.js). You choose Wilds gear (a random
 *   weapon or armor piece at your own gear tier) or gear for the game (a random slot; it waits in your Relic Satchel until
 *   sent home). Its relic tier (core/gear.js TIERS, Common to Primordial) is rolled from forgeOdds: the essences' rarity
 *   counts most, then how many (each one counts a little less), the minigame score, luck, Resonance (every essence of one
 *   aspect), a Catalyst (never Common) and pity (each forge without a Legendary or better helps a little, up to a cap).
 *   Mythic and Primordial are capped (CAPS) whatever goes in. Which boosts it gets follows the aspects put in.
 * - Uniques (core/gear.js UNIQUES): a Legendary or better forge may make one, if its dungeon's Heart was among the essences.
 * - A relic's colours are its essences' colours, blended by rarity (the rarest one is its trim); its edge is its tier's.
 * - Infuse: any Wilds gear has sockets (1 to 4: better quality and relic tier, more); an essence in one adds its aspect,
 *   sized by its rarity and a short minigame. Pairs of aspects in one piece make a combo (COMBOS).
 * - Upgrade: a relic goes from +0 to +5 for essences of its own rarity band and rubies; each level, +8% to its boosts.
 * Pure: callers pass `rng`.
 *
 * Works in a browser (<script src="core/world-relics.js"> after world-data.js and gear.js sets window.WHWorldRelics) and in Node.
 */
(function (root, factory) {
    if (typeof module === 'object' && module.exports) module.exports = factory(require('./world-data'), require('./gear'));
    else root.WHWorldRelics = factory(root.WHWorldData, root.WHGear);
}(typeof self !== 'undefined' ? self : this, function (D, Gear) {
    'use strict';

    const T = Gear.TIERS;
    // potency of one essence by rarity (common .. mythic)
    const PTS = [1, 2.5, 6, 15, 40];
    // the forge's odds. base: each tier's weight with nothing special put in; k: how hard potency pushes toward the top
    // (weight x (1 + potency)^(k x tier)); dim: each further essence (rarest first) counts this much less than the one before;
    // caps: the most a forge can give each top tier, whatever goes in. Tuned with tools/simulate-relics.js so a regular
    // mid-game player forges a first Rare in about a week, Epic in 1-2 weeks, Legendary in 3-4, Mythic in 2-3 months, and
    // Primordial only after many months.
    const FORGE = {
        min: 3, max: 8, base: [100, 16, 1.2, 0.25, 0.04, 0.004, 0.00015], k: 0.36, dim: 0.85,
        caps: { 5: 0.03, 6: 0.005 }, resonance: 0.1, luckMax: 0.5, pityStep: 0.02, pityMax: 0.4, uniqueChance: 0.3, fee: 50,
    };
    // a Wilds relic's boost per line at each tier (percent), and a socketed essence's by rarity
    const WILDS_LINE = [4, 6, 8, 11, 15, 20, 28];
    const SOCKET_VALUE = [3, 5, 8, 12, 18];
    const MAX_SOCKETS = 4;
    // two aspects together in one piece's sockets (or lines): a named bonus, in the aspects' own points
    const COMBOS = [
        { a: 'might', b: 'ember', name: 'Wildfire', bonus: { might: 4, ember: 4 } },
        { a: 'might', b: 'keen', name: 'Executioner', bonus: { keen: 5 } },
        { a: 'swift', b: 'keen', name: 'Duelist', bonus: { swift: 4, keen: 3 } },
        { a: 'ward', b: 'vigor', name: 'Bulwark', bonus: { ward: 5 } },
        { a: 'vigor', b: 'frost', name: 'Evergreen', bonus: { vigor: 4, frost: 2 } },
        { a: 'fortune', b: 'keen', name: "Gambler's Eye", bonus: { fortune: 6 } },
        { a: 'frost', b: 'ward', name: 'Glacier', bonus: { ward: 4, frost: 3 } },
        { a: 'swift', b: 'ember', name: 'Comet', bonus: { swift: 5 } },
    ];
    // what a forge of Wilds gear can turn out: [class or slot, how it's named in GEAR]. You choose a weapon or armor (a shield
    // counts as armor); which one of those is random.
    const WEAPON_BASES = ['sword', 'dagger', 'spear', 'bow', 'gun', 'firestaff', 'lightningstaff', 'froststaff'];
    const ARMOR_BASES = ['helmet', 'chest', 'boots', 'shield'];
    const PARTS = { weapon: WEAPON_BASES, armor: ARMOR_BASES };
    const RELIC_BASES = WEAPON_BASES.concat(ARMOR_BASES);
    // Blueprints: without one, a forge makes at most a Rare (BASE_MAX); each one, bought for good and in order, lets every
    // forge after it reach one tier higher. Epic and Legendary cost rubies (at the Crucible), Mythic and Primordial Glory.
    // A tier the forge would have rolled above what you can make comes out as the best tier you can.
    // (2026-11-22: the Glory ones were 12,000 and 40,000, months of the Arena's daily Glory caps; now a few hours of play each,
    // measured against those caps: about 600 Glory a day from matches, the Pit and waves, about 200 from waves alone. A blueprint
    // only opens the chance: Mythic and Primordial stay capped per forge, and fusing never makes them.)
    const BASE_MAX = 2;
    const BLUEPRINTS = [
        { tier: 3, rubies: 20000 },
        { tier: 4, rubies: 75000 },
        { tier: 5, glory: 1200 },
        { tier: 6, glory: 3000 },
    ];
    const BLUEPRINT_BY_TIER = Object.fromEntries(BLUEPRINTS.map(b => [b.tier, b]));
    const isObj = (v) => !!v && typeof v === 'object' && !Array.isArray(v);
    const int = (v, lo, hi) => Math.max(lo, Math.min(hi, Math.floor(Number(v) || 0)));
    const ess = (id) => { const m = D.MATERIALS_BY_ID[id]; return m && m.kind === 'essence' ? m : null; };

    // ---------------- the odds ----------------
    // How much the essences push toward the top: their potency, rarest first, each further one counting dim x less
    function potency(ids) {
        const pts = ids.map(id => ess(id)).filter(Boolean).map(e => PTS[e.rar]).sort((a, b) => b - a);
        return pts.reduce((a, p, i) => a + p * Math.pow(FORGE.dim, i), 0);
    }
    function aspectPoints(ids) {
        const out = {};
        for (const id of ids) { const e = ess(id); if (e) out[e.asp] = (out[e.asp] || 0) + PTS[e.rar]; }
        return out;
    }
    const resonant = (ids) => ids.length >= FORGE.min && new Set(ids.map(id => ess(id) && ess(id).asp)).size === 1;
    // The chance of each relic tier (0 Common .. 6 Primordial) for a forge. o: { ess: [essence ids], score (0-100), luck,
    // catalyst (bool), pity (forges since the last Legendary or better), maxTier (the best your blueprints allow; none: any) }
    function forgeOdds(o) {
        const ids = (o.ess || []).filter(ess);
        let p = potency(ids);
        p *= 0.7 + 0.6 * Math.max(0, Math.min(100, Number(o.score) || 0)) / 100;
        p *= 1 + Math.max(0, Math.min(FORGE.luckMax, Number(o.luck) || 0));
        if (resonant(ids)) p *= 1 + FORGE.resonance;
        p *= 1 + Math.min(FORGE.pityMax, FORGE.pityStep * Math.max(0, Math.floor(Number(o.pity) || 0)));
        const m = Math.pow(1 + p, FORGE.k);
        const w = FORGE.base.map((b, t) => b * Math.pow(m, t));
        if (o.catalyst) w[0] = 0;
        const total = w.reduce((a, b) => a + b, 0);
        const out = w.map(x => x / total);
        // the caps: anything over goes to Legendary
        for (const t of [6, 5]) { const cap = FORGE.caps[t]; if (out[t] > cap) { out[4] += out[t] - cap; out[t] = cap; } }
        // blueprints: whatever is above the best tier you can make comes out as that tier
        const max = o.maxTier == null ? T.length - 1 : int(o.maxTier, 0, T.length - 1);
        for (let t = T.length - 1; t > max; t--) { out[max] += out[t]; out[t] = 0; }
        return out;
    }
    function rollTier(odds, rng) {
        let x = rng();
        for (let t = odds.length - 1; t >= 1; t--) { if (x < odds[t]) return t; x -= odds[t]; }
        return 0;
    }

    // ---------------- what a forge makes ----------------
    // boosts: the aspects put in, drawn by their points (never the same twice); the first is the main one. sig: a unique's
    // own, always first. Each line: [aspect, roll] (roll 0.85-1.15: chance and the minigame score)
    function pickLines(ids, n, rng, score, sig) {
        const pts = aspectPoints(ids), out = [];
        const roll = () => Math.round((Gear.ROLL.lo + (Gear.ROLL.hi - Gear.ROLL.lo) * (0.5 * rng() + 0.5 * Math.max(0, Math.min(100, score || 0)) / 100)) * 1000) / 1000;
        for (const a of sig || []) if (out.length < n && !out.some(l => l[0] === a)) out.push([a, roll()]);
        while (out.length < n) {
            const left = Object.keys(pts).filter(a => !out.some(l => l[0] === a));
            let a;
            if (left.length) { const tot = left.reduce((s, x) => s + pts[x], 0); let x = rng() * tot; a = left.find(k => (x -= pts[k]) < 0) || left[left.length - 1]; }
            else { const rest = Gear.ASPECT_IDS.filter(x => !out.some(l => l[0] === x)); a = rest[Math.floor(rng() * rest.length) % rest.length]; }
            out.push([a, roll()]);
        }
        return out;
    }
    // [main, trim]: the essences' colours blended by potency (the main), and the rarest one's (the trim)
    function colorsOf(ids) {
        const list = ids.map(ess).filter(Boolean);
        if (!list.length) return ['#b4bccd', '#b4bccd'];
        const rgb = (h) => [1, 3, 5].map(i => parseInt(h.slice(i, i + 2), 16));
        let r = 0, g = 0, b = 0, w = 0;
        for (const e of list) { const c = rgb(e.color), k = PTS[e.rar]; r += c[0] * c[0] * k; g += c[1] * c[1] * k; b += c[2] * c[2] * k; w += k; }
        const hex = (v) => Math.round(Math.sqrt(v / w)).toString(16).padStart(2, '0');
        const rarest = list.slice().sort((a, x) => x.rar - a.rar)[0];
        return ['#' + hex(r) + hex(g) + hex(b), rarest.color.toLowerCase()];
    }
    // the uniques a forge of this kind could make with these essences (each needs its dungeon's Heart, if it names one).
    // part ('weapon' | 'armor'): only that kind of Wilds gear (a weapon unique has a class, armor a slot)
    function uniquesFor(kind, ids, part) {
        return Gear.UNIQUES.filter(u => u.kind === kind && (!u.need || ids.includes(u.need)) && (!PARTS[part] || (part === 'weapon') === !!u.cls));
    }
    // the gear id for a relic base at a gear tier (the nearest tier that exists, for staffs that stop early)
    function baseIdFor(base, tier) {
        const name = (t) => (/staff$/.test(base) ? base + '_' + t : base === 'shield' ? 'shield_' + t : base + '_' + t);
        for (let t = Math.max(0, tier); t >= 0; t--) if (D.GEAR_BY_ID[name(t)]) return name(t);
        for (let t = tier + 1; t <= D.MAX_TIER; t++) if (D.GEAR_BY_ID[name(t)]) return name(t);
        return null;
    }
    // the base for a unique: its class or slot
    function uniqueBase(u) { return u.cls === 'staff' ? 'firestaff' : u.cls || (u.slot === 'offhand' ? 'shield' : u.slot); }
    // The Crucible's work. o: { kind: 'wilds' | 'game', part ('weapon' | 'armor'; none: either, for Wilds gear), ess: [ids],
    // score, luck, catalyst, pity, maxTier (blueprints), gearTier (for Wilds gear), by }.
    // Returns { tier, unique (or null), lines, colors, base (a GEAR id, Wilds), slot (the game's) }
    function forge(o, rng) {
        const ids = (o.ess || []).filter(ess);
        const odds = forgeOdds(o), tier = rollTier(odds, rng);
        const part = o.kind === 'wilds' && PARTS[o.part] ? o.part : null;
        let unique = null;
        if (tier >= 4 && rng() < FORGE.uniqueChance) { const list = uniquesFor(o.kind, ids, part); if (list.length) unique = list[Math.floor(rng() * list.length) % list.length]; }
        const n = T[tier].lines + (unique ? 1 : 0);
        const lines = pickLines(ids, n, rng, o.score, unique ? unique.sig : null);
        const colors = colorsOf(ids);
        if (o.kind === 'game') return { tier, unique, lines, colors, slot: unique ? unique.s : Gear.SLOTS[Math.floor(rng() * Gear.SLOTS.length) % Gear.SLOTS.length], odds };
        const pool = part ? PARTS[part] : RELIC_BASES;
        const base = baseIdFor(unique ? uniqueBase(unique) : pool[Math.floor(rng() * pool.length) % pool.length], int(o.gearTier, 0, D.MAX_TIER));
        return { tier, unique, lines, colors, base, odds };
    }
    // the ruby fee for a forge of n essences at a gear tier
    function forgeFee(n, gearTier) { return FORGE.fee * Math.max(FORGE.min, n) * (1 + int(gearTier, 0, D.MAX_TIER)); }

    // ---------------- a Wilds relic (gear item field r) and sockets (field k) ----------------
    // r: { t, l: [[aspect, roll]], m: [essence ids], c: [main, trim], q: unique id or '', by, n (times traded), lv }
    function cleanRelic(raw, baseId) {
        if (!isObj(raw)) return null;
        const b = D.GEAR_BY_ID[baseId];
        const t = int(raw.t, 0, Gear.MAX_TIER);
        const u = Gear.UNIQUES_BY_ID[raw.q];
        const uok = u && u.kind === 'wilds' && t >= 4 && b && (u.cls ? b.cls === u.cls : b.slot === u.slot);
        const max = T[t].lines + (uok ? 1 : 0), seen = new Set(), l = [];
        for (const x of Array.isArray(raw.l) ? raw.l : []) {
            if (!Array.isArray(x) || !Gear.ASPECT_GAME[x[0]] || seen.has(x[0]) || l.length >= max) continue;
            seen.add(x[0]); l.push([x[0], Math.max(Gear.ROLL.lo, Math.min(Gear.ROLL.hi, Math.round((Number(x[1]) || 1) * 1000) / 1000))]);
        }
        if (!l.length) return null;
        const m = (Array.isArray(raw.m) ? raw.m : []).filter(id => ess(id)).slice(0, FORGE.max);
        const HEX = /^#[0-9a-f]{6}$/i;
        const c = Array.isArray(raw.c) && HEX.test(raw.c[0]) && HEX.test(raw.c[1]) ? [raw.c[0].toLowerCase(), raw.c[1].toLowerCase()] : colorsOf(m);
        return { t, l, m, c, q: uok ? u.id : '', by: typeof raw.by === 'string' ? raw.by.replace(/[<>&"'`]/g, '').slice(0, 16) : '', n: int(raw.n, 0, 999), lv: int(raw.lv, 0, Gear.MAX_LEVEL) };
    }
    // how many sockets a piece has: 1, one more at Fine (55) and at Masterwork (90), and a relic at least 1 + half its tier
    function socketCount(it) {
        const q = Number(it && it.score) || 0;
        let n = 1 + (q >= 55 ? 1 : 0) + (q >= 90 ? 1 : 0);
        if (it && it.r) n = Math.max(n, 1 + Math.floor(it.r.t / 2));
        return Math.min(MAX_SOCKETS, n);
    }
    // k: [[essence id, value] or null] (the value: its percent, fixed when set)
    function cleanSockets(raw, n) {
        const out = [];
        for (let i = 0; i < n; i++) {
            const x = Array.isArray(raw) ? raw[i] : null, e = Array.isArray(x) && ess(x[0]);
            out.push(e ? [x[0], Math.max(0, Math.min(SOCKET_VALUE[e.rar] * 1.3, Math.round((Number(x[1]) || 0) * 10) / 10))] : null);
        }
        return out.some(Boolean) ? out : [];
    }
    // an essence set into a socket: its value for a minigame score
    function socketValue(id, score) { const e = ess(id); return e ? Math.round(SOCKET_VALUE[e.rar] * (0.7 + 0.6 * Math.max(0, Math.min(100, Number(score) || 0)) / 100) * 10) / 10 : 0; }
    // Every aspect a piece of Wilds gear carries, in percent: its relic lines, its sockets and their combos. Returns
    // { aspects: { might: 12, ... }, combos: [names] }
    function wildsAspects(it) {
        const out = {}, add = (a, v) => { out[a] = (out[a] || 0) + v; };
        if (it && it.r) for (const [a, roll] of it.r.l) add(a, WILDS_LINE[it.r.t] * roll * (1 + Gear.LEVEL_STEP * it.r.lv));
        const inSockets = new Set();
        for (const k of (it && it.k) || []) if (k) { const e = ess(k[0]); add(e.asp, k[1]); inSockets.add(e.asp); }
        const combos = [];
        for (const c of COMBOS) if (inSockets.has(c.a) && inSockets.has(c.b)) { combos.push(c.name); for (const a in c.bonus) add(a, c.bonus[a]); }
        for (const a in out) out[a] = Math.round(out[a] * 10) / 10;
        return { aspects: out, combos };
    }
    // Apply a piece's aspects to its numbers (core/world-logic.js gearStats). slot: its base's slot.
    function applyAspects(st, it, slot) {
        const { aspects } = wildsAspects(it);
        if (it && it.r) { const k = T[it.r.t].wilds; st.dmg *= k; st.armor *= k; st.hp *= k; }
        const v = (a) => (aspects[a] || 0) / 100;
        const weapon = slot === 'weapon';
        st.dmg *= 1 + v('might');
        if (weapon) st.wMult *= 1 + v('swift') / 2; else st.speed += v('swift') / 4;
        st.armor *= 1 + v('ward'); st.hp *= 1 + v('ward');
        if (!weapon && v('ward') && !st.armor) st.hp += v('ward') * 40; // a ring: a little health instead
        st.crit += v('keen') / 2;
        st.lifesteal += v('vigor') / 10; st.stamRegen += v('vigor') / 2;
        st.luck += v('fortune'); st.yield += v('fortune') / 2;
        if (aspects.ember) { st.burn = st.burn || weapon; st.dmg *= 1 + v('ember') / 3; st.fireResist += weapon ? 0 : v('ember') / 2; }
        if (aspects.frost) { st.chill = st.chill || weapon; st.armor *= 1 + v('frost') / 3; }
        st.aspects = aspects;
        return st;
    }

    // ---------------- upgrades ----------------
    // A relic's next level: { ok, rar (the essence rarity it takes), n (how many), rubies } or { ok: false } at the top.
    // tier: the relic's tier, lv: its level now
    function upgradeCost(tier, lv) {
        if (lv >= Gear.MAX_LEVEL) return { ok: false };
        return { ok: true, rar: Math.max(0, Math.min(4, tier - 2)), n: 2 + lv, rubies: 250 * (tier + 1) * (lv + 1) };
    }

    // the name of a Wilds relic (its unique's, or its tier and the base's)
    function relicName(it) {
        const b = D.GEAR_BY_ID[it.base];
        if (!it.r || !b) return b ? b.name : 'Unknown';
        if (it.r.q && Gear.UNIQUES_BY_ID[it.r.q]) return Gear.UNIQUES_BY_ID[it.r.q].name;
        return T[it.r.t].name + ' ' + b.name;
    }
    // the picture's look of a Wilds piece: { shape, main, trim, tier, outline } (or null for plain gear)
    function lookOf(it) {
        if (!it || !it.r) return null;
        const b = D.GEAR_BY_ID[it.base], u = it.r.q && Gear.UNIQUES_BY_ID[it.r.q];
        return { shape: u ? u.shape : (b.slot === 'weapon' ? b.cls : b.slot), main: it.r.c[0], trim: it.r.c[1], tier: it.r.t, outline: u ? u.outline : null, glow: T[it.r.t].color, uid: 'w' + it.uid };
    }

    return { PTS, FORGE, WILDS_LINE, SOCKET_VALUE, MAX_SOCKETS, COMBOS, RELIC_BASES, WEAPON_BASES, ARMOR_BASES, PARTS, BASE_MAX, BLUEPRINTS, BLUEPRINT_BY_TIER, potency, aspectPoints, resonant, forgeOdds, rollTier, pickLines, colorsOf,
        uniquesFor, baseIdFor, uniqueBase, forge, forgeFee, cleanRelic, socketCount, cleanSockets, socketValue, wildsAspects, applyAspects, upgradeCost, relicName, lookOf };
}));
