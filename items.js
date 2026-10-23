/**
 * Items, lootboxes and gems on the main game page (index.html, after main.js).
 * - Lootboxes appear on the screen every few minutes. Click one before it vanishes and it goes into your Items.
 * - Items (🎒): open lootboxes for items, merge 3 lootboxes of a tier into 1 of the next tier, equip charms
 *   (permanent bonuses while equipped) and use consumables (timed boosts and instant rewards).
 * - Gems (main.js `diamonds`) are the premium currency. This file draws the gem counter in the top bar, the gem burst
 *   when you find some, the purchase dialog every gem purchase goes through (main.js spendGems) and the shop's
 *   Treasury tab.
 * Item data lives in its own localStorage key, so prestige and the main autosave never touch it.
 * main.js applies WHI.bonuses() in updateDisplays, increment and the offline-gains calculation.
 */
(function () {
    'use strict';

    const STORAGE_KEY = 'whathappened_items';
    const GEM_IMG = 'mainimage/gem.png';
    const MERGE_COUNT = 3;              // lootboxes of one tier that merge into one of the next
    const MAX_STARS = 5;                // every copy of a charm adds a star, up to 5
    const STAR_STEP = 0.5;              // each star after the first adds half the base bonus (5 stars = 3x)
    const START_SLOTS = 3;
    const MAX_SLOTS = 5;
    const SLOT_COSTS = { 4: 40, 5: 120 }; // gems for the 4th and 5th charm slot
    const DROP_LIFETIME_MS = 14000;     // how long a lootbox stays on screen
    const SPAWN_SEC = [300, 600];       // seconds of visible tab time between lootboxes (charms and the lure shorten it)
    const FIRST_SPAWN_SEC = [90, 150];  // a new player's first lootbox comes sooner
    const MAX_RATE_MULT = 8;            // cap on how much charms + lure speed lootboxes up
    const LURE = { cost: 15, ms: 15 * 60000, mult: 3 };
    const BOOST_CAP_MS = 30 * 60000;    // using a boost that is already running adds its time, up to 30 minutes left
    // a charm copy past 5 stars turns into something else: Common/Uncommon into seconds of CPS, Rare and up into gems
    const DUP_CPS_SEC = [120, 300];
    const DUP_GEMS = [0, 0, 1, 2, 5, 12];

    // same rarity colors as followers
    const RARITIES = [
        { id: 'common', name: 'Common', color: '#b4bccd' },
        { id: 'uncommon', name: 'Uncommon', color: '#4fd27a' },
        { id: 'rare', name: 'Rare', color: '#4fa8ff' },
        { id: 'epic', name: 'Epic', color: '#b07dff' },
        { id: 'legendary', name: 'Legendary', color: '#ffc83d' },
        { id: 'mythic', name: 'Mythic', color: '#ff5bd0' },
    ];

    // weights: chance of each rarity per item rolled. guarantee: the last item is at least this rarity if nothing
    // else was. gems: bonus gems (chance, min, max). price: gems in the Treasury. spawn: weight when one appears on screen.
    // paint: chest art gradients (top, bottom).
    const BOXES = [
        { id: 'wood', name: 'Wooden Crate', short: 'Wooden', color: '#d0915a', rolls: 2, weights: [62, 28, 9, 1, 0, 0], guarantee: null, gems: null, price: null, spawn: 80,
            paint: { body: ['#b57538', '#6e3d1b'], lid: ['#c6844a', '#83512a'], trim: ['#7a7e89', '#30333b'] } },
        { id: 'iron', name: 'Iron Chest', short: 'Iron', color: '#c9d1dc', rolls: 3, weights: [38, 37, 20, 5, 0, 0], guarantee: null, gems: null, price: 50, spawn: 17,
            paint: { body: ['#8f99aa', '#4c5464'], lid: ['#a7b0c0', '#5f6878'], trim: ['#f0f3f7', '#9aa3b3'] } },
        { id: 'gold', name: 'Golden Chest', short: 'Golden', color: '#ffc83d', rolls: 3, weights: [15, 34, 34, 16, 1, 0], guarantee: 1, gems: { chance: 0.4, min: 1, max: 2 }, price: 200, spawn: 3,
            paint: { body: ['#ffcc3f', '#c97a0c'], lid: ['#ffe07a', '#e09218'], trim: ['#fff6cf', '#d29a2c'] } },
        { id: 'diamond', name: 'Diamond Chest', short: 'Diamond', color: '#5ee7ff', rolls: 4, weights: [0, 15, 43, 37, 4, 1], guarantee: 2, gems: { chance: 1, min: 2, max: 5 }, price: 500, spawn: 0,
            paint: { body: ['#6fdcff', '#2563c9'], lid: ['#a5f0ff', '#3a86e0'], trim: ['#ffffff', '#9adff7'] } },
        { id: 'mythic', name: 'Mythic Vault', short: 'Mythic', color: '#ff5bd0', rolls: 5, weights: [0, 0, 35, 53, 10, 2], guarantee: 3, gems: { chance: 1, min: 8, max: 16 }, price: 1000, spawn: 0,
            paint: { body: ['#ff6bd6', '#5a1fc0'], lid: ['#ff9fe6', '#8336e0'], trim: ['#fff0fb', '#e0a0ff'] } },
    ];

    // kind 'use' (consumables). effect.type: click / cps / both = timed multiplier, crit = timed crit chance (points),
    // time = instantly earn `sec` seconds of CPS, gems / golden = instant currency.
    // kind 'charm': equip for `bonus` (percent; critChance in percentage points), scaled by stars.
    const ITEMS = [
        { id: 'energyDrink', kind: 'use', rarity: 0, icon: '🥤', name: 'Energy Drink', effect: { type: 'click', mult: 2, sec: 60 }, flavor: 'Tastes like a battery. Your fingers have never been more awake.' },
        { id: 'spareBattery', kind: 'use', rarity: 0, icon: '🔋', name: 'Spare Battery', effect: { type: 'cps', mult: 2, sec: 60 }, flavor: 'The whole crew runs on double-A.' },
        { id: 'pocketWatch', kind: 'use', rarity: 1, icon: '⏱️', name: 'Pocket Watch', effect: { type: 'time', sec: 600 }, flavor: 'Wind it forward ten minutes. Nobody will notice.' },
        { id: 'loadedDice', kind: 'use', rarity: 1, icon: '🎲', name: 'Loaded Dice', effect: { type: 'crit', pp: 10, sec: 120 }, flavor: 'Every roll is a six. Every click might be a crit.' },
        { id: 'overclockChip', kind: 'use', rarity: 2, icon: '💾', name: 'Overclock Chip', effect: { type: 'cps', mult: 5, sec: 60 }, flavor: 'Voids the warranty on the entire crew.' },
        { id: 'hourglass', kind: 'use', rarity: 2, icon: '⏳', name: 'Hourglass', effect: { type: 'time', sec: 3600 }, flavor: 'Flip it over and an hour of What Happeneds pours out.' },
        { id: 'gemPouch', kind: 'use', rarity: 2, icon: '👝', name: 'Gem Pouch', effect: { type: 'gems', n: 2 }, flavor: 'Something in here is shining.' },
        { id: 'frenzyPotion', kind: 'use', rarity: 3, icon: '🧪', name: 'Frenzy Potion', effect: { type: 'click', mult: 10, sec: 30 }, flavor: 'Side effects include: clicking.' },
        { id: 'timeMachine', kind: 'use', rarity: 3, icon: '🕰️', name: 'Time Machine', effect: { type: 'time', sec: 8 * 3600 }, flavor: 'Skip to tomorrow and keep the earnings.' },
        { id: 'goldenTicket', kind: 'use', rarity: 4, icon: '🎫', name: 'Golden Ticket', effect: { type: 'golden', n: 1 }, flavor: 'Redeemable for one Golden What Happened. No refunds.' },
        { id: 'gemGeode', kind: 'use', rarity: 4, img: GEM_IMG, name: 'Gem Geode', effect: { type: 'gems', n: 10 }, flavor: 'Crack it open. It\'s gems all the way down.' },
        { id: 'singularity', kind: 'use', rarity: 5, icon: '🌀', name: 'Singularity', effect: { type: 'both', mult: 25, sec: 60 }, flavor: 'For one minute, everything happens at once.' },

        { id: 'luckyPenny', kind: 'charm', rarity: 0, icon: '🪙', name: 'Lucky Penny', bonus: { cps: 10 }, flavor: 'Found heads-up on the floor of the What Happened factory.' },
        { id: 'stickyMouse', kind: 'charm', rarity: 0, icon: '🖱️', name: 'Sticky Mouse', bonus: { click: 15 }, flavor: 'Nobody knows what it\'s sticky with. It clicks harder, though.' },
        { id: 'rabbitFoot', kind: 'charm', rarity: 1, icon: '🐾', name: 'Rabbit\'s Foot', bonus: { critChance: 1 }, flavor: 'Less lucky for the rabbit.' },
        { id: 'magnifier', kind: 'charm', rarity: 1, icon: '🔍', name: 'Magnifying Glass', bonus: { boxRate: 20 }, flavor: 'The lootboxes were there all along. You just had to look.' },
        { id: 'cozyBlanket', kind: 'charm', rarity: 1, icon: '🧣', name: 'Cozy Blanket', bonus: { offline: 30 }, flavor: 'The crew works overtime while you nap.' },
        { id: 'sharpCursor', kind: 'charm', rarity: 2, icon: '🗡️', name: 'Sharpened Cursor', bonus: { critDmg: 50 }, flavor: 'Careful. It\'s pointy on the clicky end.' },
        { id: 'prospectorPick', kind: 'charm', rarity: 2, icon: '⛏️', name: 'Prospector\'s Pick', bonus: { gems: 40 }, flavor: 'There\'s gems in them there clicks.' },
        { id: 'turboFan', kind: 'charm', rarity: 2, icon: '💨', name: 'Turbo Fan', bonus: { cps: 40 }, flavor: 'Keeps the crew cool enough to work faster.' },
        { id: 'goldenGauntlet', kind: 'charm', rarity: 3, icon: '🧤', name: 'Golden Gauntlet', bonus: { click: 100 }, flavor: 'Heavy, shiny, and extremely clicky.' },
        { id: 'treasureMap', kind: 'charm', rarity: 3, icon: '🗺️', name: 'Treasure Map', bonus: { boxRate: 50 }, flavor: 'X marks the spot. Every spot.' },
        { id: 'ancientIdol', kind: 'charm', rarity: 3, icon: '🗿', name: 'Ancient Idol', bonus: { cps: 80 }, flavor: 'It stares. The crew works harder when it stares.' },
        { id: 'crownOfWH', kind: 'charm', rarity: 4, icon: '👑', name: 'Crown of What Happened', bonus: { cps: 150, click: 150 }, flavor: 'Heavy is the head that clicks.' },
        { id: 'dragonEye', kind: 'charm', rarity: 4, icon: '🐉', name: 'Dragon Eye', bonus: { critChance: 3, critDmg: 150 }, flavor: 'It sees the weak points in the button itself.' },
        { id: 'infinityClicker', kind: 'charm', rarity: 5, icon: '♾️', name: 'Infinity Clicker', bonus: { cps: 400, click: 400 }, flavor: 'One click. Infinite What Happeneds. Roughly.' },
        { id: 'philosopherStone', kind: 'charm', rarity: 5, icon: '🔮', name: 'Philosopher\'s Stone', bonus: { gems: 150, boxRate: 100 }, flavor: 'Turns clicks into gems and luck into lootboxes.' },
    ];
    const ITEMS_BY_ID = {};
    ITEMS.forEach(it => { ITEMS_BY_ID[it.id] = it; });
    const CHARMS = ITEMS.filter(it => it.kind === 'charm');
    const USABLES = ITEMS.filter(it => it.kind === 'use');
    const BONUS_LABELS = { cps: 'CPS', click: 'click power', critChance: 'crit chance', critDmg: 'crit damage', gems: 'gem find rate', boxRate: 'lootbox rate', offline: 'offline earnings' };

    // ---------------- helpers (main.js globals are read through these so a missing one never breaks the page) ----------------
    function esc(s) { return String(s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', '\'': '&#39;' })[c]); }
    function rand(a, b) { return a + Math.random() * (b - a); }
    function randInt(a, b) { return Math.floor(rand(a, b + 1)); }
    function fmt(n) { try { return formatNumber(n); } catch (e) { return String(n); } }
    function pct(v) { return (Math.round(v * 10) / 10).toLocaleString(); }
    function gemsNow() { try { return getGems(); } catch (e) { return 0; } }
    function gemPrice(n) { try { return gemPriceHtml(n); } catch (e) { return fmt(n) + ' gems'; } }
    function toast(msg) { try { notify(msg); } catch (e) {} }
    function refreshGame() { try { updateDisplays(); } catch (e) {} }
    function lowPerf() { return window._perfCritIndicator === false; }
    function reducedMotion() { try { return window.matchMedia('(prefers-reduced-motion: reduce)').matches; } catch (e) { return false; } }
    function centerOf(el) { const r = el.getBoundingClientRect(); return { x: r.left + r.width / 2, y: r.top + r.height / 2 }; }
    function plural(name, n) { return n === 1 ? name : name + 's'; }
    function aOrAn(name) { return (/^[aeiou]/i.test(name) ? 'an ' : 'a ') + name; }
    function pickWeighted(w) {
        const total = w.reduce((a, x) => a + x, 0);
        let x = Math.random() * total;
        for (let i = 0; i < w.length; i++) { x -= w[i]; if (x < 0 && w[i] > 0) return i; }
        for (let i = w.length - 1; i >= 0; i--) if (w[i] > 0) return i;
        return 0;
    }
    function dur(sec) {
        if (sec >= 3600) return (sec / 3600) + (sec === 3600 ? ' hour' : ' hours');
        if (sec >= 60) return (sec / 60) + ' min';
        return sec + 's';
    }
    function clock(ms) {
        const s = Math.max(0, Math.ceil(ms / 1000)), h = Math.floor(s / 3600), m = Math.floor((s % 3600) / 60);
        if (h) return `${h}h ${String(m).padStart(2, '0')}m`;
        return `${m}:${String(s % 60).padStart(2, '0')}`;
    }

    // ---------------- state ----------------
    let state = null;
    let ver = 0; // bumped on every change so bonuses() knows its cache is stale
    function freshState() {
        return {
            v: 1,
            boxes: BOXES.map(() => 0),
            items: {},          // id -> copies owned (consumables are used up, charms are kept)
            seen: {},           // id -> true once found
            slots: START_SLOTS,
            equipped: Array(START_SLOTS).fill(null),
            boosts: [],         // running consumables: { id, until, total }
            spawnIn: rand(FIRST_SPAWN_SEC[0], FIRST_SPAWN_SEC[1]),
            lureUntil: 0,
            stats: { collected: 0, opened: 0, merged: 0, missed: 0, bought: 0, bestTier: 0, gemsFound: 0, charmsSeen: 0 },
        };
    }
    function load() {
        let s = null;
        try { s = JSON.parse(localStorage.getItem(STORAGE_KEY) || 'null'); } catch (e) { s = null; }
        const f = freshState();
        if (!s || typeof s !== 'object') return f;
        const count = v => Math.max(0, Math.floor(Number(v) || 0));
        f.boxes = BOXES.map((_, i) => count(s.boxes && s.boxes[i]));
        if (s.items && typeof s.items === 'object') for (const id in s.items) if (ITEMS_BY_ID[id]) f.items[id] = count(s.items[id]);
        if (s.seen && typeof s.seen === 'object') for (const id in s.seen) if (ITEMS_BY_ID[id] && s.seen[id]) f.seen[id] = true;
        f.slots = Math.max(START_SLOTS, Math.min(MAX_SLOTS, count(s.slots) || START_SLOTS));
        const eq = Array.isArray(s.equipped) ? s.equipped : [];
        f.equipped = Array(f.slots).fill(null);
        eq.slice(0, f.slots).forEach((id, i) => {
            const it = ITEMS_BY_ID[id];
            if (it && it.kind === 'charm' && f.items[id] > 0 && f.equipped.indexOf(id) === -1) f.equipped[i] = id;
        });
        const now = Date.now();
        if (Array.isArray(s.boosts)) f.boosts = s.boosts.filter(b => b && ITEMS_BY_ID[b.id] && Number(b.until) > now).map(b => ({ id: b.id, until: Number(b.until), total: Number(b.total) || 60000 }));
        if (Number.isFinite(Number(s.spawnIn))) f.spawnIn = Math.min(SPAWN_SEC[1], Number(s.spawnIn));
        f.lureUntil = Number(s.lureUntil) || 0;
        if (s.stats && typeof s.stats === 'object') for (const k in f.stats) f.stats[k] = count(s.stats[k]);
        return f;
    }
    function st() { if (!state) state = load(); return state; }
    // resetGame / prestige set main.js suppressAutosave right before reloading: don't write the items back then
    function saveBlocked() { try { return typeof suppressAutosave !== 'undefined' && !!suppressAutosave; } catch (e) { return false; } }
    function save() {
        const s = st();
        ver++;
        const now = Date.now();
        s.boosts = s.boosts.filter(b => b.until > now);
        s.stats.charmsSeen = CHARMS.filter(c => s.seen[c.id]).length;
        if (saveBlocked()) return;
        try { localStorage.setItem(STORAGE_KEY, JSON.stringify(s)); } catch (e) {}
    }
    function totalBoxes() { return st().boxes.reduce((a, n) => a + n, 0); }
    function totalUsables() { const s = st(); return USABLES.reduce((a, it) => a + (s.items[it.id] || 0), 0); }
    function stars(id) { return Math.min(MAX_STARS, st().items[id] || 0); }
    function starMult(n) { return 1 + STAR_STEP * (Math.max(1, n) - 1); }
    function noteTier(t) { const s = st(); s.stats.bestTier = Math.max(s.stats.bestTier || 0, t + 1); }
    // tell main.js (displays, achievements) and any open inventory that something changed
    function afterChange() {
        bonusCache = null;
        renderHud();
        if (menuOpen()) renderInventory();
        refreshGame();
        try { checkDataAchievements(true); } catch (e) {}
    }

    // ---------------- bonuses (read by main.js) ----------------
    const NO_BONUS = () => ({ cps: 0, click: 0, critChance: 0, critDmg: 0, gems: 0, boxRate: 0, offline: 0, cpsMult: 1, clickMult: 1 });
    let bonusCache = null;
    function charmTotals() {
        const s = st(), t = {};
        s.equipped.forEach(id => {
            const it = id && ITEMS_BY_ID[id];
            if (!it) return;
            const k = starMult(stars(id));
            for (const key in it.bonus) t[key] = (t[key] || 0) + it.bonus[key] * k;
        });
        return t;
    }
    // Percent bonuses from equipped charms (+ crit chance from Loaded Dice), and multipliers from running boosts.
    // main.js multiplies CPS by (1 + cps/100) * cpsMult and click power by (1 + click/100) * clickMult.
    function bonuses() {
        const now = Date.now();
        if (bonusCache && bonusCache.ver === ver && now < bonusCache.until) return bonusCache.b;
        const b = NO_BONUS(), t = charmTotals();
        for (const k in t) b[k] += t[k];
        let nextChange = now + 1000;
        st().boosts.forEach(x => {
            if (x.until <= now) return;
            nextChange = Math.min(nextChange, x.until);
            const e = ITEMS_BY_ID[x.id].effect;
            if (e.type === 'cps' || e.type === 'both') b.cpsMult *= e.mult;
            if (e.type === 'click' || e.type === 'both') b.clickMult *= e.mult;
            if (e.type === 'crit') b.critChance += e.pp;
        });
        bonusCache = { ver, b, until: nextChange };
        return b;
    }
    function rateMult() {
        let m = 1 + (bonuses().boxRate || 0) / 100;
        if (st().lureUntil > Date.now()) m *= LURE.mult;
        return Math.min(MAX_RATE_MULT, m);
    }

    // ---------------- text ----------------
    function bonusText(bonus, k) { return Object.keys(bonus).map(t => `+${pct(bonus[t] * k)}% ${BONUS_LABELS[t]}`).join(', '); }
    function effectText(it, starCount) {
        if (it.kind === 'charm') return bonusText(it.bonus, starMult(starCount || 1));
        const e = it.effect;
        switch (e.type) {
            case 'click': return `Click power ×${e.mult} for ${dur(e.sec)}`;
            case 'cps': return `CPS ×${e.mult} for ${dur(e.sec)}`;
            case 'both': return `CPS and click power ×${e.mult} for ${dur(e.sec)}`;
            case 'crit': return `+${e.pp}% crit chance for ${dur(e.sec)}`;
            case 'time': return `Instantly earn ${dur(e.sec)} of CPS`;
            case 'gems': return `+${e.n} gems`;
            case 'golden': return `+${e.n} Golden What Happened`;
        }
        return '';
    }
    function boostLabel(it) {
        const e = it.effect;
        if (e.type === 'crit') return `+${e.pp}% crit`;
        return `${e.type === 'both' ? 'Everything' : e.type === 'cps' ? 'CPS' : 'Click'} ×${e.mult}`;
    }
    function dupText(it) { return it.rarity >= 2 ? `${DUP_GEMS[it.rarity]} gem${DUP_GEMS[it.rarity] > 1 ? 's' : ''}` : `${dur(DUP_CPS_SEC[it.rarity])} of CPS`; }
    function boxDesc(b) {
        let d = `${b.rolls} items`;
        if (b.guarantee != null) d += `, ${RARITIES[b.guarantee].name} or better guaranteed`;
        if (b.gems) d += b.gems.chance >= 1 ? `, plus ${b.gems.min}–${b.gems.max} gems` : `, ${Math.round(b.gems.chance * 100)}% chance of gems`;
        return d;
    }
    function oddsText(b) {
        const tot = b.weights.reduce((a, x) => a + x, 0);
        return b.weights.map((w, r) => (w ? `${RARITIES[r].name} ${Math.round(w / tot * 1000) / 10}%` : '')).filter(Boolean).join(' · ');
    }

    // ---------------- art ----------------
    let svgUid = 0;
    // A chest drawn in the tier's colors (ids are unique per call so gradients don't clash on the page)
    function boxSvg(tier) {
        const t = Math.max(0, Math.min(BOXES.length - 1, tier)), p = BOXES[t].paint, u = 'whb' + (++svgUid);
        const grad = (id, c) => `<linearGradient id="${u}${id}" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="${c[0]}"/><stop offset="1" stop-color="${c[1]}"/></linearGradient>`;
        const aura = t === 4 ? `<radialGradient id="${u}a"><stop offset="0" stop-color="#ff7ae0" stop-opacity=".55"/><stop offset="1" stop-color="#ff7ae0" stop-opacity="0"/></radialGradient>` : '';
        const planks = t === 0 ? '<path d="M14 59H86M14 72H86M15 39Q16 27 50 26Q84 27 85 39" stroke="rgba(0,0,0,.28)" stroke-width="1.6" fill="none"/>' : '';
        const sparkle = t >= 3 ? '<path d="M72 25l2 5 5 2-5 2-2 5-2-5-5-2 5-2zM29 31l1.4 3.4 3.4 1.4-3.4 1.4-1.4 3.4-1.4-3.4-3.4-1.4 3.4-1.4z" fill="#fff" opacity=".95"/>' : '';
        return `<svg class="box-svg" viewBox="0 0 100 100" aria-hidden="true" focusable="false"><defs>${grad('b', p.body)}${grad('l', p.lid)}${grad('t', p.trim)}${aura}` +
            `<clipPath id="${u}c"><path d="M12 48V36Q12 18 50 18Q88 18 88 36V48Z"/><rect x="14" y="46" width="72" height="40" rx="6"/></clipPath></defs>` +
            (aura ? `<circle cx="50" cy="52" r="48" fill="url(#${u}a)"/>` : '') +
            '<ellipse cx="50" cy="89" rx="36" ry="5" fill="rgba(0,0,0,.35)"/>' +
            `<rect x="14" y="46" width="72" height="40" rx="6" fill="url(#${u}b)"/>` +
            `<path d="M12 48V36Q12 18 50 18Q88 18 88 36V48Z" fill="url(#${u}l)"/>` + planks +
            `<g clip-path="url(#${u}c)" fill="url(#${u}t)"><rect x="23" y="10" width="8" height="80"/><rect x="69" y="10" width="8" height="80"/></g>` +
            `<rect x="10" y="44" width="80" height="8" rx="3" fill="url(#${u}t)"/>` +
            `<rect x="41" y="40" width="18" height="20" rx="4" fill="url(#${u}t)" stroke="rgba(0,0,0,.25)"/>` +
            '<circle cx="50" cy="48" r="2.8" fill="rgba(0,0,0,.55)"/><rect x="49" y="49" width="2" height="6" rx="1" fill="rgba(0,0,0,.55)"/>' +
            '<path d="M19 36Q21 24 50 23" stroke="rgba(255,255,255,.4)" stroke-width="3" stroke-linecap="round" fill="none"/>' + sparkle + '</svg>';
    }
    function artHtml(it, size) {
        const inner = it.img ? `<img src="${it.img}" alt="">` : `<span aria-hidden="true">${it.icon}</span>`;
        return `<span class="item-art${size ? ' item-art--' + size : ''}" style="--rc:${RARITIES[it.rarity].color}">${inner}</span>`;
    }
    function starsHtml(n) {
        return `<span class="stars" role="img" aria-label="${n} of ${MAX_STARS} stars"><span class="stars-on">${'★'.repeat(n)}</span>${'★'.repeat(Math.max(0, MAX_STARS - n))}</span>`;
    }
    function oddsBar(b) {
        const t = oddsText(b);
        return `<div class="odds-bar" role="img" aria-label="Item odds: ${t}" title="Odds per item: ${t}">` +
            b.weights.map((w, r) => (w ? `<i style="flex:${w};background:${RARITIES[r].color}"></i>` : '')).join('') + '</div>';
    }

    // ---------------- sound (synthesized, respects the SFX volume and mute in settings) ----------------
    // [frequency Hz, start s, length s, wave]
    const SOUNDS = {
        gem: [[1568, 0, 0.18], [2093, 0.07, 0.28], [3136, 0.14, 0.4, 'triangle']],
        spawn: [[784, 0, 0.14, 'triangle'], [1047, 0.08, 0.14, 'triangle'], [1319, 0.16, 0.14, 'triangle'], [1568, 0.24, 0.32, 'triangle']],
        grab: [[523, 0, 0.08, 'square'], [1047, 0.05, 0.18, 'triangle']],
        shake: [[196, 0, 0.07, 'triangle'], [220, 0.25, 0.07, 'triangle'], [247, 0.5, 0.07, 'triangle'], [277, 0.7, 0.07, 'triangle'], [311, 0.86, 0.1, 'triangle']],
        open: [[392, 0, 0.12, 'triangle'], [523, 0.06, 0.12, 'triangle'], [659, 0.12, 0.26, 'triangle']],
        rare: [[523, 0, 0.12], [659, 0.08, 0.12], [784, 0.16, 0.12], [1047, 0.24, 0.5, 'triangle'], [1319, 0.24, 0.5]],
        merge: [[330, 0, 0.1, 'triangle'], [440, 0.12, 0.1, 'triangle'], [554, 0.24, 0.1, 'triangle'], [880, 0.62, 0.4, 'triangle'], [1109, 0.62, 0.4]],
    };
    let actx = null;
    function sfx(kind) {
        try {
            if (typeof sfxMuted !== 'undefined' && sfxMuted) return;
            const vol = (typeof sfxVolume === 'number' ? sfxVolume : 0.8) * 0.2;
            const notes = SOUNDS[kind];
            if (!notes || vol <= 0) return;
            if (!actx) { const AC = window.AudioContext || window.webkitAudioContext; if (!AC) return; actx = new AC(); }
            if (actx.state === 'suspended') actx.resume().catch(() => {});
            const t0 = actx.currentTime + 0.01;
            const master = actx.createGain();
            master.gain.value = vol;
            master.connect(actx.destination);
            notes.forEach(([f, at, len, type]) => {
                const o = actx.createOscillator(), g = actx.createGain();
                o.type = type || 'sine';
                o.frequency.setValueAtTime(f, t0 + at);
                const peak = o.type === 'square' ? 0.4 : 1;
                g.gain.setValueAtTime(0.0001, t0 + at);
                g.gain.exponentialRampToValueAtTime(peak, t0 + at + 0.012);
                g.gain.exponentialRampToValueAtTime(0.0001, t0 + at + len);
                o.connect(g); g.connect(master);
                o.start(t0 + at); o.stop(t0 + at + len + 0.05);
            });
        } catch (e) {}
    }

    // ---------------- gems: counter, burst, purchase dialog ----------------
    let heldGems = 0; // gems already credited but still flying to the counter (the counter shows them on arrival)
    function renderHud() {
        const shown = fmt(Math.max(0, gemsNow() - heldGems));
        document.querySelectorAll('[data-gem-balance]').forEach(el => { if (el.textContent !== shown) el.textContent = shown; });
        const btn = document.getElementById('itemsTopBtn');
        if (btn) {
            const n = totalBoxes();
            let b = btn.querySelector('.nav-count');
            if (n > 0) {
                if (!b) { b = document.createElement('span'); b.className = 'nav-count'; btn.appendChild(b); }
                const txt = n > 99 ? '99+' : String(n);
                if (b.textContent !== txt) b.textContent = txt;
                btn.title = `Items: ${n} ${n === 1 ? 'lootbox' : 'lootboxes'} to open`;
            } else if (b) { b.remove(); btn.title = 'Items'; }
        }
    }
    function fxLayer() {
        let l = document.getElementById('gemFxLayer');
        if (!l) { l = document.createElement('div'); l.id = 'gemFxLayer'; l.setAttribute('aria-hidden', 'true'); document.body.appendChild(l); }
        return l;
    }
    // where the player last clicked the main image, or its center
    function defaultPoint() {
        const p = window._lastClickPoint;
        if (p && Date.now() - p.t < 600) return { x: p.x, y: p.y };
        const btn = document.querySelector('.main-image-btn');
        if (btn) { const r = btn.getBoundingClientRect(); if (r.width) return { x: r.left + r.width / 2, y: r.top + r.height / 2 }; }
        return { x: innerWidth / 2, y: innerHeight / 2 };
    }
    function chipTarget() {
        const chip = document.getElementById('gemChip');
        if (!chip) return null;
        const r = chip.getBoundingClientRect();
        if (!r.width || r.bottom < 0 || r.top > innerHeight) return null;
        const ico = chip.querySelector('.gem-ico');
        return ico ? centerOf(ico) : centerOf(chip);
    }
    function floatText(p, text, gem) {
        if (lowPerf()) return;
        const el = document.createElement('div');
        el.className = 'gem-float' + (gem ? '' : ' gem-float--wh');
        el.innerHTML = (gem ? `<img src="${GEM_IMG}" alt="">` : '') + esc(text);
        el.style.left = p.x + 'px';
        el.style.top = p.y + 'px';
        fxLayer().appendChild(el);
        setTimeout(() => el.remove(), 1300);
    }
    function bump(el, cls) { if (!el) return; el.classList.remove(cls); void el.offsetWidth; el.classList.add(cls); }
    function shakeChip() { bump(document.getElementById('gemChip'), 'is-shake'); }
    // Gems fly from `from` (default: the last click) into the top-bar counter, which ticks up when they land.
    // `alreadyHeld`: the caller already added n to heldGems when it credited them.
    function gemBurst(n, from, alreadyHeld) {
        n = Math.max(0, Math.floor(Number(n) || 0));
        if (!n) return;
        if (!alreadyHeld) heldGems += n;
        const start = from || defaultPoint();
        let released = false;
        const release = () => {
            if (released) return;
            released = true;
            heldGems = Math.max(0, heldGems - n);
            renderHud();
            bump(document.getElementById('gemChip'), 'is-bump');
        };
        sfx('gem');
        floatText(start, '+' + fmt(n), true);
        const target = chipTarget();
        if (!target || lowPerf() || reducedMotion() || typeof Element.prototype.animate !== 'function') { setTimeout(release, 300); return; }
        const layer = fxLayer();
        const pieces = Math.min(8, n);
        let landed = 0;
        for (let i = 0; i < pieces; i++) {
            const g = document.createElement('img');
            g.src = GEM_IMG; g.alt = ''; g.className = 'gem-fly';
            g.style.left = start.x + 'px'; g.style.top = start.y + 'px';
            layer.appendChild(g);
            const ang = (Math.PI * 2 * i) / pieces + rand(-0.5, 0.5), r = rand(34, 78);
            const mx = Math.cos(ang) * r, my = Math.sin(ang) * r - 26;
            const dx = target.x - start.x, dy = target.y - start.y;
            const a = g.animate([
                { transform: 'translate(0px, 0px) scale(0.2)', opacity: 0 },
                { transform: `translate(${mx}px, ${my}px) scale(1.15)`, opacity: 1, offset: 0.3 },
                { transform: `translate(${mx * 0.85}px, ${my * 0.85 - 10}px) scale(1)`, opacity: 1, offset: 0.45 },
                { transform: `translate(${dx}px, ${dy}px) scale(0.45)`, opacity: 0.85 },
            ], { duration: 950 + i * 70, easing: 'cubic-bezier(.55,0,.25,1)', fill: 'forwards' });
            a.onfinish = () => { g.remove(); if (++landed === pieces) release(); };
        }
        for (let i = 0; i < 8; i++) {
            const s = document.createElement('i');
            s.className = 'gem-spark';
            s.style.left = start.x + 'px'; s.style.top = start.y + 'px';
            layer.appendChild(s);
            const ang = rand(0, Math.PI * 2), r = rand(40, 95);
            const a = s.animate([
                { transform: 'translate(0, 0) scale(1)', opacity: 1 },
                { transform: `translate(${Math.cos(ang) * r}px, ${Math.sin(ang) * r}px) scale(0)`, opacity: 0 },
            ], { duration: rand(450, 750), easing: 'cubic-bezier(.2,.7,.3,1)', fill: 'forwards' });
            a.onfinish = () => s.remove();
        }
        setTimeout(release, 2400); // in case an animation never finishes (tab hidden)
    }

    // The dialog every gem purchase goes through (main.js spendGems). o: { cost, title, desc, art (html), img (url) }.
    // Resolves true when the player confirms.
    let confirmState = null;
    function closeConfirm(ok) { if (confirmState) confirmState.finish(ok); }
    function confirmSpend(o) {
        closeConfirm(false);
        return new Promise(resolve => {
            const have = gemsNow(), cost = Math.max(0, Math.floor(Number(o.cost) || 0));
            const art = o.art ? (/^</.test(o.art) ? o.art : `<span class="gc-emoji" aria-hidden="true">${o.art}</span>`) : `<img src="${esc(o.img || GEM_IMG)}" alt="">`;
            const wrap = document.createElement('div');
            wrap.className = 'gem-confirm-wrap';
            wrap.innerHTML = `<div class="gem-confirm-backdrop" data-gc="no"></div>
                <div class="gem-confirm" role="dialog" aria-modal="true" aria-labelledby="gcTitle"${o.desc ? ' aria-describedby="gcDesc"' : ''}>
                    <div class="gc-art">${art}</div>
                    <div class="gc-kicker">Spend gems</div>
                    <h3 id="gcTitle" class="gc-title">${esc(o.title || 'Purchase')}</h3>
                    ${o.desc ? `<p id="gcDesc" class="gc-desc">${esc(o.desc)}</p>` : ''}
                    <dl class="gc-ledger">
                        <div><dt>Your gems</dt><dd>${gemPrice(have)}</dd></div>
                        <div class="gc-minus"><dt>Price</dt><dd>−${gemPrice(cost)}</dd></div>
                        <div class="gc-after"><dt>After</dt><dd>${gemPrice(have - cost)}</dd></div>
                    </dl>
                    <div class="gc-actions">
                        <button type="button" class="btn btn-ghost" data-gc="no">Cancel</button>
                        <button type="button" class="btn btn-gem" data-gc="yes">Buy for ${gemPrice(cost)}</button>
                    </div>
                </div>`;
            document.body.appendChild(wrap);
            const prevFocus = document.activeElement;
            const finish = ok => {
                if (!confirmState || confirmState.wrap !== wrap) return;
                confirmState = null;
                wrap.classList.add('is-out');
                setTimeout(() => wrap.remove(), 160);
                try { if (prevFocus && document.contains(prevFocus)) prevFocus.focus({ preventScroll: true }); } catch (e) {}
                resolve(ok);
            };
            confirmState = { wrap, finish };
            wrap.addEventListener('click', e => { const b = e.target.closest('[data-gc]'); if (b) finish(b.dataset.gc === 'yes'); });
            // keep Tab inside the dialog
            wrap.addEventListener('keydown', e => {
                if (e.key !== 'Tab') return;
                const btns = wrap.querySelectorAll('button');
                const first = btns[0], last = btns[btns.length - 1];
                if (e.shiftKey && document.activeElement === first) { e.preventDefault(); last.focus(); }
                else if (!e.shiftKey && document.activeElement === last) { e.preventDefault(); first.focus(); }
            });
            try { wrap.querySelector('[data-gc="yes"]').focus({ preventScroll: true }); } catch (e) {}
        });
    }

    // ---------------- lootboxes on the screen ----------------
    let drop = null, tickN = 0;
    function dropSpot(size) {
        const bar = document.getElementById('topBar');
        const mc = document.getElementById('mainContent');
        const top = (bar ? bar.getBoundingClientRect().bottom : 64) + 24;
        const mr = mc ? mc.getBoundingClientRect() : { left: 0, right: innerWidth };
        const minX = Math.max(16, mr.left + 16), maxX = Math.min(innerWidth, mr.right) - size - 16;
        const maxY = innerHeight - size - 110; // stay clear of the chat button
        return { x: minX + Math.random() * Math.max(0, maxX - minX), y: top + Math.random() * Math.max(0, maxY - top) };
    }
    function spawnDrop() {
        if (drop) return;
        const t = pickWeighted(BOXES.map(b => b.spawn)), b = BOXES[t];
        const el = document.createElement('button');
        el.type = 'button';
        el.className = 'loot-drop' + (lowPerf() ? ' is-lite' : '');
        el.style.setProperty('--lc', b.color);
        el.setAttribute('aria-label', `Grab the ${b.name} before it vanishes`);
        el.innerHTML = `<span class="loot-drop-rays" aria-hidden="true"></span>${boxSvg(t)}<span class="loot-drop-tag">${b.name}</span>`;
        const p = dropSpot(innerWidth <= 760 ? 80 : 96);
        el.style.left = p.x + 'px';
        el.style.top = p.y + 'px';
        el.addEventListener('click', grabDrop);
        document.body.appendChild(el);
        drop = { el, tier: t, timers: [setTimeout(() => el.classList.add('is-leaving'), DROP_LIFETIME_MS - 3500), setTimeout(missDrop, DROP_LIFETIME_MS)] };
        sfx('spawn');
    }
    function grabDrop(ev) {
        if (ev) { ev.preventDefault(); ev.stopPropagation(); }
        const d = drop;
        if (!d) return;
        drop = null;
        d.timers.forEach(clearTimeout);
        const s = st();
        s.boxes[d.tier]++;
        s.stats.collected++;
        noteTier(d.tier);
        save();
        sfx('grab');
        toast(`${BOXES[d.tier].name} added to your Items`);
        flyToItems(d.el);
        afterChange();
    }
    function missDrop() {
        const d = drop;
        if (!d) return;
        drop = null;
        d.timers.forEach(clearTimeout);
        d.el.disabled = true;
        d.el.classList.remove('is-leaving');
        d.el.classList.add('is-gone');
        setTimeout(() => d.el.remove(), 400);
        st().stats.missed++;
        save();
    }
    function flyToItems(el) {
        el.disabled = true;
        el.classList.remove('is-leaving');
        const btn = document.getElementById('itemsTopBtn');
        const from = centerOf(el);
        let to = { x: innerWidth - 60, y: 24 };
        if (btn) { const br = btn.getBoundingClientRect(); if (br.width && br.right > 0 && br.left < innerWidth) to = centerOf(btn); }
        const done = () => { el.remove(); bump(btn, 'is-bump'); };
        if (typeof el.animate !== 'function' || reducedMotion()) { done(); return; }
        el.style.animation = 'none';
        const dx = to.x - from.x, dy = to.y - from.y;
        el.animate([
            { transform: 'translate(0, 0) scale(1)', opacity: 1 },
            { transform: `translate(${dx * 0.15}px, ${dy * 0.15 - 50}px) scale(1.2)`, opacity: 1, offset: 0.3 },
            { transform: `translate(${dx}px, ${dy}px) scale(0.25)`, opacity: 0.4 },
        ], { duration: 720, easing: 'cubic-bezier(.5,0,.3,1)', fill: 'forwards' }).onfinish = done;
    }
    function tick() {
        const s = st(), now = Date.now();
        if (s.boosts.some(b => b.until <= now)) { save(); afterChange(); }
        if (menuOpen()) renderBoosts();
        if (document.visibilityState !== 'visible' || drop || reveal) return;
        const lo = document.getElementById('loadingOverlay');
        if (lo && lo.style.display !== 'none') return;
        s.spawnIn -= rateMult();
        if (s.spawnIn <= 0) { s.spawnIn = rand(SPAWN_SEC[0], SPAWN_SEC[1]); spawnDrop(); save(); }
        else if (++tickN % 15 === 0) save();
    }

    // ---------------- opening, merging, using ----------------
    function rollBox(tier) {
        const box = BOXES[tier], out = [];
        for (let i = 0; i < box.rolls; i++) {
            let w = box.weights;
            if (box.guarantee != null && i === box.rolls - 1 && !out.some(it => it.rarity >= box.guarantee)) w = w.map((x, r) => (r >= box.guarantee ? x : 0));
            const r = pickWeighted(w);
            const pool = ITEMS.filter(it => it.rarity === r);
            out.push(pool[Math.floor(Math.random() * pool.length)]);
        }
        const gems = (box.gems && Math.random() < box.gems.chance) ? randInt(box.gems.min, box.gems.max) : 0;
        return { items: out, gems };
    }
    // Add one copy. A charm already at max stars turns into gems (Rare+) or seconds of CPS instead.
    function grantItem(it) {
        const s = st();
        const isNew = !s.seen[it.id];
        s.seen[it.id] = true;
        const had = s.items[it.id] || 0;
        if (it.kind === 'charm' && had >= MAX_STARS) {
            return it.rarity >= 2 ? { isNew, dupGems: DUP_GEMS[it.rarity], dupSec: 0 } : { isNew, dupGems: 0, dupSec: DUP_CPS_SEC[it.rarity] };
        }
        s.items[it.id] = had + 1;
        return { isNew, dupGems: 0, dupSec: 0 };
    }
    function openBoxes(tier, count) {
        const s = st();
        count = Math.min(Math.floor(count) || 0, s.boxes[tier]);
        if (count <= 0) return;
        s.boxes[tier] -= count;
        s.stats.opened += count;
        const agg = new Map();
        let gems = 0, dupGems = 0, dupSec = 0;
        for (let i = 0; i < count; i++) {
            const roll = rollBox(tier);
            gems += roll.gems;
            roll.items.forEach(it => {
                const g = grantItem(it);
                dupGems += g.dupGems;
                dupSec += g.dupSec;
                const c = agg.get(it.id);
                if (c) { c.count++; c.isNew = c.isNew || g.isNew; c.maxed = c.maxed || !!(g.dupGems || g.dupSec); }
                else agg.set(it.id, { kind: 'item', item: it, rarity: it.rarity, count: 1, isNew: g.isNew, maxed: !!(g.dupGems || g.dupSec) });
            });
        }
        const total = gems + dupGems;
        s.stats.gemsFound += total;
        save();
        const cards = Array.from(agg.values()).sort((a, b) => a.rarity - b.rarity);
        cards.forEach(c => { if (c.item.kind === 'charm') c.stars = stars(c.item.id); });
        if (dupSec > 0) {
            let gain = 0;
            try { gain = addCpsSeconds(dupSec); } catch (e) {}
            if (Number(gain) > 0) cards.push({ kind: 'cps', rarity: 1, amount: gain });
        }
        if (total > 0) {
            heldGems += total;
            try { addGems(total, null, true); } catch (e) { heldGems -= total; }
            cards.push({ kind: 'gems', rarity: 2, n: total, dup: dupGems });
        }
        showOpenReveal(tier, count, cards, total);
        afterChange();
    }
    function mergeBoxes(tier) {
        const s = st();
        if (tier >= BOXES.length - 1 || s.boxes[tier] < MERGE_COUNT) return;
        s.boxes[tier] -= MERGE_COUNT;
        s.boxes[tier + 1]++;
        s.stats.merged++;
        noteTier(tier + 1);
        save();
        showMergeReveal(tier);
        afterChange();
    }
    // merge every full set, bottom tier first, so new boxes can merge again further up
    function mergeAll() {
        const s = st(), before = s.boxes.slice();
        let merges = 0;
        for (let t = 0; t < BOXES.length - 1; t++) {
            const n = Math.floor(s.boxes[t] / MERGE_COUNT);
            if (!n) continue;
            s.boxes[t] -= n * MERGE_COUNT;
            s.boxes[t + 1] += n;
            merges += n;
        }
        if (!merges) return;
        s.stats.merged += merges;
        const gained = s.boxes.map((n, t) => Math.max(0, n - before[t]));
        let top = 0;
        gained.forEach((n, t) => { if (n) { top = t; noteTier(t); } });
        save();
        showMergeAllReveal(gained, top, merges);
        afterChange();
    }
    function useItem(id, btn) {
        const s = st(), it = ITEMS_BY_ID[id];
        if (!it || it.kind !== 'use' || !(s.items[id] > 0)) return;
        const e = it.effect;
        if (e.type === 'time' && !(Number(typeof cps !== 'undefined' ? cps : 0) > 0)) { toast('You have no CPS yet. Save this until your crew is earning.'); return; }
        const at = btn ? centerOf(btn) : defaultPoint();
        s.items[id]--;
        if (e.type === 'click' || e.type === 'cps' || e.type === 'both' || e.type === 'crit') {
            const now = Date.now();
            const cur = s.boosts.find(b => b.id === id && b.until > now);
            if (cur) { cur.until = Math.min(now + BOOST_CAP_MS, cur.until + e.sec * 1000); cur.total = cur.until - now; }
            else s.boosts.push({ id, until: now + e.sec * 1000, total: e.sec * 1000 });
            save();
            sfx('open');
            toast(`${it.name}: ${boostLabel(it)} for ${clock((cur ? cur.until : now + e.sec * 1000) - now)}`);
        } else if (e.type === 'time') {
            save();
            let gain = 0;
            try { gain = addCpsSeconds(e.sec); } catch (err) {}
            sfx('open');
            floatText(at, '+' + fmt(gain), false);
            toast(`${it.name}: +${fmt(gain)} What Happeneds`);
        } else if (e.type === 'gems') {
            save();
            try { addGems(e.n, at); } catch (err) {}
        } else if (e.type === 'golden') {
            save();
            try { addGolden(e.n); } catch (err) {}
            sfx('rare');
            toast(`${it.name}: +${e.n} Golden What Happened`);
        }
        afterChange();
    }
    function toggleEquip(id) {
        const s = st(), it = ITEMS_BY_ID[id];
        if (!it || it.kind !== 'charm') return;
        const at = s.equipped.indexOf(id);
        if (at !== -1) s.equipped[at] = null;
        else {
            if (!(s.items[id] > 0)) return;
            const free = s.equipped.indexOf(null);
            if (free === -1) { toast(s.slots < MAX_SLOTS ? 'All charm slots are full. Unequip one, or unlock another slot with gems.' : 'All charm slots are full. Unequip one first.'); return; }
            s.equipped[free] = id;
            sfx('grab');
        }
        save();
        afterChange();
    }

    // ---------------- gem purchases (Treasury and the locked charm slot) ----------------
    function pay(cost, details) {
        if (typeof spendGems !== 'function') return Promise.resolve(false);
        return spendGems(cost, details);
    }
    function refreshShop() { try { updateShopUI(); } catch (e) {} }
    function buyBox(tier) {
        const b = BOXES[tier];
        if (!b || !b.price) return;
        pay(b.price, { title: b.name, desc: boxDesc(b) + '.', art: boxSvg(tier) }).then(ok => {
            if (!ok) return;
            const s = st();
            s.boxes[tier]++;
            s.stats.bought++;
            noteTier(tier);
            save();
            refreshShop();
            showGotReveal(tier);
            afterChange();
        });
    }
    function buyLure() {
        pay(LURE.cost, { title: 'Lootbox Lure', desc: `Lootboxes show up ${LURE.mult}× as often for ${dur(LURE.ms / 1000)}.`, art: '🧲' }).then(ok => {
            if (!ok) return;
            const s = st();
            s.lureUntil = Math.max(Date.now(), s.lureUntil) + LURE.ms;
            s.spawnIn = Math.min(s.spawnIn, 20); // the first one shows up right away
            save();
            refreshShop();
            toast('Lootbox Lure active. Keep your eyes open!');
            afterChange();
        });
    }
    function buySlot() {
        const s = st(), next = s.slots + 1, cost = SLOT_COSTS[next];
        if (!cost) return;
        pay(cost, { title: `Charm slot ${next}`, desc: 'Equip one more charm at the same time. Yours to keep, even through prestige.', art: '🧿' }).then(ok => {
            if (!ok) return;
            s.slots = next;
            while (s.equipped.length < s.slots) s.equipped.push(null);
            save();
            refreshShop();
            sfx('rare');
            toast(`Charm slot ${next} unlocked`);
            afterChange();
        });
    }

    // ---------------- Treasury tab in the shop ----------------
    function renderTreasury(el) {
        if (!el) return;
        const s = st(), have = gemsNow(), now = Date.now();
        const buyBtn = (cost, attrs, label) => `<button type="button" class="btn btn-gem${have < cost ? ' is-poor' : ''}" ${attrs}>${label ? label + ' ' : ''}${gemPrice(cost)}</button>`;
        const boxes = BOXES.map((b, t) => (b.price ? `
            <div class="tr-card" style="--tc:${b.color}">
                <div class="tr-art">${boxSvg(t)}</div>
                <div class="tr-name">${b.name}</div>
                <div class="tr-desc">${esc(boxDesc(b))}</div>
                ${oddsBar(b)}
                ${buyBtn(b.price, `data-tbuy="box" data-tier="${t}" aria-label="Buy ${b.name} for ${b.price} gems"`)}
            </div>` : '')).join('');
        const lureLeft = s.lureUntil - now, next = s.slots + 1, slotCost = SLOT_COSTS[next];
        el.innerHTML = `<div class="treasury">
            <div class="treasury-hero">
                <img src="${GEM_IMG}" alt="" class="treasury-gem">
                <div class="treasury-hero-text">
                    <h4>Treasury</h4>
                    <p>Gems are the rarest thing in the game. Spend them here on lootboxes and upgrades, or on skins, backgrounds and music in the other tabs.</p>
                    <ul class="treasury-sources" aria-label="Where gems come from">
                        <li>👆 1 in 2,500 clicks</li><li>🎁 Golden, Diamond and Mythic lootboxes</li><li>🎰 The casino's daily spin</li>
                    </ul>
                </div>
                <div class="treasury-balance">${gemPrice(have)}<span>your gems</span></div>
            </div>
            <h5 class="items-section-h">Lootboxes</h5>
            <div class="treasury-grid">${boxes}</div>
            <h5 class="items-section-h">Upgrades</h5>
            <div class="treasury-grid">
                <div class="tr-card" style="--tc:#ff6b8a">
                    <div class="tr-art" aria-hidden="true">🧲</div>
                    <div class="tr-name">Lootbox Lure</div>
                    <div class="tr-desc">Lootboxes show up ${LURE.mult}× as often for ${dur(LURE.ms / 1000)}. Buying again adds time.</div>
                    ${lureLeft > 0 ? `<div class="tr-status">Active · ${clock(lureLeft)} left</div>` : ''}
                    ${buyBtn(LURE.cost, 'data-tbuy="lure" aria-label="Buy Lootbox Lure for ' + LURE.cost + ' gems"', lureLeft > 0 ? 'Extend' : '')}
                </div>
                <div class="tr-card" style="--tc:#b07dff">
                    <div class="tr-art" aria-hidden="true">🧿</div>
                    <div class="tr-name">${slotCost ? `Charm slot ${next}` : 'Charm slots'}</div>
                    <div class="tr-desc">${slotCost ? `Equip ${next} charms at once instead of ${s.slots}. Permanent.` : `All ${MAX_SLOTS} charm slots are unlocked.`}</div>
                    ${slotCost ? buyBtn(slotCost, `data-tbuy="slot" aria-label="Unlock charm slot ${next} for ${slotCost} gems"`) : '<div class="tr-status">Maxed</div>'}
                </div>
            </div>
        </div>`;
        el.onclick = e => {
            const b = e.target.closest('[data-tbuy]');
            if (!b) return;
            if (b.dataset.tbuy === 'box') buyBox(Number(b.dataset.tier));
            else if (b.dataset.tbuy === 'lure') buyLure();
            else if (b.dataset.tbuy === 'slot') buySlot();
        };
    }
    function openTreasury() {
        closeInventory();
        try { openShop('treasury'); } catch (e) { try { toggleShopMenu(); } catch (e2) {} }
    }

    // ---------------- inventory ----------------
    let menu = null, overlayEl = null, curTab = 'boxes', menuOpener = null;
    function ensureMenu() {
        if (menu) return;
        overlayEl = document.createElement('div');
        overlayEl.className = 'shop-overlay items-overlay';
        overlayEl.addEventListener('click', closeInventory);
        menu = document.createElement('div');
        menu.className = 'shop-menu items-menu';
        menu.setAttribute('role', 'dialog');
        menu.setAttribute('aria-modal', 'true');
        menu.setAttribute('aria-labelledby', 'itemsTitle');
        menu.innerHTML = `<div class="shop-header">
                <div class="shop-left">
                    <h3 id="itemsTitle" class="items-title"><span aria-hidden="true">🎒</span> Items</h3>
                    <div class="shop-tabs" role="tablist">
                        <button type="button" class="shop-tab-btn" role="tab" data-itab="boxes">Lootboxes<span class="items-tab-count" data-count="boxes"></span></button>
                        <button type="button" class="shop-tab-btn" role="tab" data-itab="charms">Charms</button>
                        <button type="button" class="shop-tab-btn" role="tab" data-itab="use">Consumables<span class="items-tab-count" data-count="use"></span></button>
                    </div>
                </div>
                <div class="items-head-right">
                    <button type="button" class="gem-chip gem-chip--sm" data-act="treasury" title="Open the Treasury">
                        <img src="${GEM_IMG}" alt="" class="gem-ico"><span data-gem-balance>0</span><span class="sr-only"> gems, open the Treasury</span><span class="gem-chip-plus" aria-hidden="true">+</span>
                    </button>
                    <button type="button" class="modal-close" data-act="close" aria-label="Close items">✕</button>
                </div>
            </div>
            <div class="items-boosts" aria-label="Active boosts"></div>
            <div class="shop-content items-content"></div>`;
        menu.addEventListener('click', onMenuClick);
        document.body.appendChild(overlayEl);
        document.body.appendChild(menu);
    }
    function menuOpen() { return !!menu && menu.classList.contains('open'); }
    function openInventory(tab) {
        ensureMenu();
        if (tab) curTab = tab;
        if (menuOpen()) { renderInventory(); return; }
        menuOpener = document.activeElement;
        menu.classList.add('open');
        overlayEl.classList.add('open');
        renderInventory();
        const btn = document.getElementById('itemsTopBtn');
        if (btn) btn.classList.add('active');
        try { menu.querySelector('.modal-close').focus({ preventScroll: true }); } catch (e) {}
    }
    function closeInventory() {
        if (!menuOpen()) return;
        menu.classList.remove('open');
        overlayEl.classList.remove('open');
        const btn = document.getElementById('itemsTopBtn');
        if (btn) btn.classList.remove('active');
        try { if (menuOpener && document.contains(menuOpener)) menuOpener.focus({ preventScroll: true }); } catch (e) {}
    }
    function onMenuClick(e) {
        const tabBtn = e.target.closest('[data-itab]');
        if (tabBtn) { curTab = tabBtn.dataset.itab; renderInventory(); menu.querySelector('.items-content').scrollTop = 0; return; }
        const b = e.target.closest('[data-act]');
        if (!b || b.disabled) return;
        const tier = Number(b.dataset.tier), id = b.dataset.id;
        switch (b.dataset.act) {
            case 'close': closeInventory(); break;
            case 'treasury': openTreasury(); break;
            case 'open': openBoxes(tier, 1); break;
            case 'openAll': openBoxes(tier, st().boxes[tier]); break;
            case 'merge': mergeBoxes(tier); break;
            case 'mergeAll': mergeAll(); break;
            case 'equip': toggleEquip(id); break;
            case 'use': useItem(id, b); break;
            case 'buySlot': buySlot(); break;
        }
    }
    function renderInventory() {
        if (!menu) return;
        menu.querySelectorAll('[data-itab]').forEach(b => {
            const on = b.dataset.itab === curTab;
            b.classList.toggle('active', on);
            b.setAttribute('aria-selected', on ? 'true' : 'false');
        });
        const counts = { boxes: totalBoxes(), use: totalUsables() };
        menu.querySelectorAll('[data-count]').forEach(el => { const n = counts[el.dataset.count]; el.textContent = n ? String(n) : ''; });
        menu.querySelector('.items-content').innerHTML = curTab === 'charms' ? charmsTabHtml() : curTab === 'use' ? useTabHtml() : boxesTabHtml();
        renderBoosts();
        renderHud();
    }
    function boostsHtml() {
        const s = st(), now = Date.now();
        let h = s.boosts.filter(b => b.until > now).map(b => {
            const it = ITEMS_BY_ID[b.id], left = b.until - now;
            return `<div class="boost-pill" style="--rc:${RARITIES[it.rarity].color}" title="${esc(it.name)}"><span aria-hidden="true">${it.icon}</span><b>${boostLabel(it)}</b><span>${clock(left)}</span><i style="width:${Math.max(0, Math.min(100, left / b.total * 100))}%"></i></div>`;
        }).join('');
        if (s.lureUntil > now) h += `<div class="boost-pill" style="--rc:#ff6b8a" title="Lootbox Lure"><span aria-hidden="true">🧲</span><b>Lootboxes ×${LURE.mult}</b><span>${clock(s.lureUntil - now)}</span></div>`;
        return h;
    }
    function renderBoosts() {
        const el = menu && menu.querySelector('.items-boosts');
        if (el) el.innerHTML = boostsHtml();
    }
    function boxesTabHtml() {
        const s = st();
        const canMerge = s.boxes.some((n, t) => t < BOXES.length - 1 && n >= MERGE_COUNT);
        let h = `<div class="items-toolbar">
            <p class="items-hint">Lootboxes pop up on the main screen every few minutes. Grab them before they vanish! Merge ${MERGE_COUNT} of a kind into the next tier for better loot.</p>
            <button type="button" class="btn btn-ghost btn-sm" data-act="mergeAll"${canMerge ? '' : ' disabled'}>Merge all</button>
        </div><div class="box-ladder">`;
        BOXES.forEach((b, t) => {
            const n = s.boxes[t], next = BOXES[t + 1];
            const dots = Array.from({ length: MERGE_COUNT }, (_, i) => `<i${i < n ? ' class="on"' : ''}></i>`).join('');
            h += `<div class="box-card${n ? '' : ' is-empty'}" style="--tc:${b.color}">
                <div class="box-card-art">${boxSvg(t)}${n ? `<span class="box-count">×${n}</span>` : ''}</div>
                <div class="box-card-name">${b.name}</div>
                <div class="box-card-sub">${esc(boxDesc(b))}</div>
                ${oddsBar(b)}
                <div class="box-card-actions">
                    <button type="button" class="btn btn-sm btn-open" data-act="open" data-tier="${t}"${n ? '' : ' disabled'}>Open</button>
                    ${n > 1 ? `<button type="button" class="btn btn-ghost btn-sm" data-act="openAll" data-tier="${t}">All ${n}</button>` : ''}
                </div>
                ${next ? `<button type="button" class="box-merge${n >= MERGE_COUNT ? ' is-ready' : ''}" data-act="merge" data-tier="${t}"${n >= MERGE_COUNT ? '' : ' disabled'} aria-label="Merge ${MERGE_COUNT} ${plural(b.name)} into ${aOrAn(next.name)}"><span class="merge-dots" aria-hidden="true">${dots}</span>${MERGE_COUNT} → 1 ${next.short}</button>`
                    : '<div class="box-merge box-merge--top">Top tier</div>'}
            </div>`;
        });
        const st8 = s.stats, lure = s.lureUntil - Date.now();
        h += `</div><div class="items-foot">
            <span>Grabbed ${fmt(st8.collected)} · Opened ${fmt(st8.opened)} · Merged ${fmt(st8.merged)} · Got away ${fmt(st8.missed)}${lure > 0 ? ` · <b class="items-lure">🧲 Lure ${clock(lure)}</b>` : ''}</span>
            <button type="button" class="btn btn-gem btn-sm" data-act="treasury">Get more in the Treasury</button>
        </div>`;
        return h;
    }
    function unknownCard(it) {
        return `<div class="item-card is-unknown" style="--rc:${RARITIES[it.rarity].color}">
            <div class="item-card-head"><span class="item-art is-unknown" aria-hidden="true">?</span><div><div class="item-name">???</div><div class="item-rarity">${RARITIES[it.rarity].name}</div></div></div>
            <p class="item-flavor">Not found yet. Open lootboxes to discover it.</p>
        </div>`;
    }
    function charmsTabHtml() {
        const s = st();
        let slots = '';
        for (let i = 0; i < MAX_SLOTS; i++) {
            if (i < s.slots) {
                const it = s.equipped[i] && ITEMS_BY_ID[s.equipped[i]];
                slots += it ? `<button type="button" class="charm-slot is-filled" style="--rc:${RARITIES[it.rarity].color}" data-act="equip" data-id="${it.id}" title="Unequip ${esc(it.name)}">${artHtml(it)}${starsHtml(stars(it.id))}</button>`
                    : '<div class="charm-slot">Empty</div>';
            } else if (i === s.slots) {
                slots += `<button type="button" class="charm-slot is-locked" data-act="buySlot" title="Unlock charm slot ${i + 1}"><span aria-hidden="true">🔒</span>${gemPrice(SLOT_COSTS[i + 1])}</button>`;
            } else slots += '<div class="charm-slot is-far" aria-hidden="true">🔒</div>';
        }
        const tot = charmTotals();
        const parts = Object.keys(BONUS_LABELS).filter(k => tot[k]).map(k => `+${pct(tot[k])}% ${BONUS_LABELS[k]}`);
        const used = s.equipped.filter(Boolean).length, found = CHARMS.filter(c => s.seen[c.id]).length;
        let h = `<h5 class="items-section-h">Equipped <span>${used} / ${s.slots}</span></h5>
            <div class="charm-slots">${slots}</div>
            <p class="charm-summary">${parts.length ? 'From charms: <b>' + parts.join(' · ') + '</b>' : 'Equip charms for bonuses that last as long as they are equipped.'}</p>
            <h5 class="items-section-h">Collection <span>${found} / ${CHARMS.length}</span></h5>
            <p class="items-hint">Every copy of a charm adds a star (up to ${MAX_STARS}), and each star adds half its base bonus. Copies past ${MAX_STARS} stars turn into What Happeneds or gems.</p>
            <div class="item-grid">`;
        CHARMS.forEach(it => {
            if (!s.seen[it.id]) { h += unknownCard(it); return; }
            const n = s.items[it.id] || 0, sc = stars(it.id), eq = s.equipped.indexOf(it.id) !== -1, r = RARITIES[it.rarity];
            h += `<div class="item-card${eq ? ' is-equipped' : ''}" style="--rc:${r.color}">
                <div class="item-card-head">${artHtml(it)}<div><div class="item-name">${esc(it.name)}</div><div class="item-rarity">${r.name}</div></div></div>
                ${starsHtml(sc)}
                <div class="item-effect">${esc(effectText(it, sc))}</div>
                <div class="item-next">${sc < MAX_STARS ? `Next star: ${esc(effectText(it, sc + 1))}` : `Max stars. Copies turn into ${dupText(it)}.`}</div>
                <p class="item-flavor">${esc(it.flavor)}</p>
                <div class="item-foot"><span class="item-copies">×${n}</span>
                    <button type="button" class="btn btn-sm ${eq ? 'btn-ghost' : 'btn-primary'}" data-act="equip" data-id="${it.id}">${eq ? 'Unequip' : 'Equip'}</button></div>
            </div>`;
        });
        return h + '</div>';
    }
    function useTabHtml() {
        const s = st();
        let h = `<p class="items-hint">Consumables come from lootboxes. Different boosts stack, and using one that is already running adds to its time.</p><div class="item-grid">`;
        USABLES.forEach(it => {
            if (!s.seen[it.id]) { h += unknownCard(it); return; }
            const n = s.items[it.id] || 0, r = RARITIES[it.rarity];
            h += `<div class="item-card${n ? '' : ' is-out'}" style="--rc:${r.color}">
                <div class="item-card-head">${artHtml(it)}<div><div class="item-name">${esc(it.name)}</div><div class="item-rarity">${r.name}</div></div></div>
                <div class="item-effect">${esc(effectText(it))}</div>
                <p class="item-flavor">${esc(it.flavor)}</p>
                <div class="item-foot"><span class="item-copies">×${n}</span>
                    <button type="button" class="btn btn-primary btn-sm" data-act="use" data-id="${it.id}"${n ? '' : ' disabled'}>Use</button></div>
            </div>`;
        });
        return h + '</div>';
    }

    // ---------------- reveal (opening, merging, buying) ----------------
    let reveal = null;
    function flash(color) {
        if (lowPerf() || reducedMotion()) return;
        const f = document.createElement('div');
        f.className = 'lr-flash';
        f.style.setProperty('--best', color);
        document.body.appendChild(f);
        setTimeout(() => f.remove(), 700);
    }
    // o: { title, kicker, color, best, stage }
    function buildReveal(o) {
        closeReveal();
        const el = document.createElement('div');
        el.className = 'loot-reveal';
        el.setAttribute('role', 'dialog');
        el.setAttribute('aria-modal', 'true');
        el.setAttribute('aria-label', o.title);
        el.tabIndex = -1;
        el.style.setProperty('--tc', o.color);
        el.style.setProperty('--best', o.best || o.color);
        el.innerHTML = `<div class="lr-glow" aria-hidden="true"></div>
            <div class="lr-head"><div class="lr-kicker">${esc(o.kicker)}</div><div class="lr-title">${esc(o.title)}</div></div>
            <div class="lr-stage">${o.stage || ''}</div>
            <p class="lr-sub" hidden></p>
            <div class="lr-cards" aria-live="polite"></div>
            <div class="lr-actions" hidden></div>
            <div class="lr-hint">Click to skip</div>`;
        document.body.appendChild(el);
        const r = { el, timers: [], heldGems: 0, prevFocus: document.activeElement, done: false, skip: null, actions: {} };
        reveal = r;
        el.addEventListener('click', e => {
            if (reveal !== r) return;
            const b = e.target.closest('[data-lr]');
            if (b) { const fn = r.actions[b.dataset.lr]; if (fn) fn(); return; }
            if (!r.done) { if (r.skip) r.skip(); }
            else if (!e.target.closest('.lr-card, .lr-stage, .lr-head')) closeReveal();
        });
        try { el.focus({ preventScroll: true }); } catch (e) {}
        return r;
    }
    // buttons: [{ id, label (html), cls }]; the last one gets focus
    function revealDone(r, sub, buttons) {
        if (r !== reveal || r.done) return;
        r.done = true;
        r.timers.forEach(clearTimeout);
        r.el.classList.add('is-done');
        if (sub) { const p = r.el.querySelector('.lr-sub'); p.textContent = sub; p.hidden = false; }
        const a = r.el.querySelector('.lr-actions');
        a.innerHTML = buttons.map(b => `<button type="button" class="btn ${b.cls || 'btn-ghost'}" data-lr="${b.id}">${b.label}</button>`).join('');
        a.hidden = false;
        try { a.lastElementChild.focus({ preventScroll: true }); } catch (e) {}
    }
    function closeReveal() {
        const r = reveal;
        if (!r) return;
        reveal = null;
        r.timers.forEach(clearTimeout);
        const gc = r.el.querySelector('.lr-card--gems');
        const from = gc ? centerOf(gc) : null;
        r.el.classList.add('is-out');
        setTimeout(() => r.el.remove(), 200);
        if (r.heldGems) gemBurst(r.heldGems, from, true);
        if (menuOpen()) renderInventory();
        try { if (r.prevFocus && document.contains(r.prevFocus)) r.prevFocus.focus({ preventScroll: true }); } catch (e) {}
    }
    function cardHtml(c, i) {
        const d = `--d:${Math.min(i, 14) * 110}ms`;
        if (c.kind === 'gems') {
            return `<div class="lr-card lr-card--gems is-shiny" style="--rc:var(--gem);${d}"><span class="item-art item-art--lg"><img src="${GEM_IMG}" alt=""></span><b>+${fmt(c.n)} Gems</b><span class="lr-rarity">Premium</span>${c.dup ? `<span class="lr-note">${c.dup} from maxed charms</span>` : ''}</div>`;
        }
        if (c.kind === 'cps') {
            return `<div class="lr-card" style="--rc:#2fd07a;${d}"><span class="item-art item-art--lg" style="--rc:#2fd07a"><span aria-hidden="true">💰</span></span><b>+${fmt(c.amount)}</b><span class="lr-rarity">What Happeneds</span><span class="lr-note">From maxed charms</span></div>`;
        }
        if (c.kind === 'box') {
            const b = BOXES[c.tier];
            return `<div class="lr-card" style="--rc:${b.color};${d}"><span class="lr-qty">×${c.count}</span><span class="lr-box">${boxSvg(c.tier)}</span><b>${b.name}</b></div>`;
        }
        const it = c.item, r = RARITIES[it.rarity];
        const note = it.kind === 'charm' ? starsHtml(c.stars) + (c.maxed ? '<span class="lr-note">Maxed copies cashed in</span>' : '') : `<span class="lr-note">${esc(effectText(it))}</span>`;
        return `<div class="lr-card${it.rarity >= 3 ? ' is-shiny' : ''}" style="--rc:${r.color};${d}">${c.isNew ? '<span class="lr-new">New!</span>' : ''}${c.count > 1 ? `<span class="lr-qty">×${c.count}</span>` : ''}` +
            `${artHtml(it, 'lg')}<b>${esc(it.name)}</b><span class="lr-rarity">${r.name} ${it.kind === 'charm' ? 'charm' : 'item'}</span>${note}</div>`;
    }
    function showOpenReveal(tier, count, cards, gems) {
        const b = BOXES[tier];
        const best = cards.reduce((m, c) => Math.max(m, c.kind === 'item' ? c.rarity : 0), 0);
        const bestColor = RARITIES[best].color;
        const r = buildReveal({ title: count > 1 ? `${count} × ${b.name}` : b.name, kicker: count > 1 ? 'Opening all' : 'Opening', color: b.color, best: bestColor,
            stage: `<div class="lr-chest is-shaking" style="--glow:${bestColor}">${boxSvg(tier)}</div>` });
        r.heldGems = gems;
        sfx('shake');
        const complete = () => {
            const left = st().boxes[tier];
            const btns = [];
            if (left > 0) btns.push({ id: 'again', label: `Open another <span class="btn-chip">${left} left</span>` });
            btns.push({ id: 'close', label: 'Collect', cls: 'btn-primary' });
            r.actions = { again: () => openBoxes(tier, 1), close: closeReveal };
            revealDone(r, null, btns);
        };
        const burst = () => {
            if (r !== reveal || r.burst) return;
            r.burst = true;
            r.timers.forEach(clearTimeout);
            r.timers = [];
            const chest = r.el.querySelector('.lr-chest');
            if (chest) { chest.classList.remove('is-shaking'); chest.classList.add('is-burst'); }
            flash(bestColor);
            if (best >= 3) r.el.classList.add('is-epic');
            r.timers.push(setTimeout(() => { const stage = r.el.querySelector('.lr-stage'); if (stage) stage.classList.add('is-collapsed'); }, 260));
            r.el.querySelector('.lr-cards').innerHTML = cards.map(cardHtml).join('');
            sfx(best >= 3 ? 'rare' : 'open');
            r.timers.push(setTimeout(complete, reducedMotion() ? 0 : Math.min(cards.length, 14) * 110 + 420));
        };
        // first click skips the shake, a second one skips the cards dealing out
        r.skip = () => { if (!r.burst) burst(); else { r.el.classList.add('is-instant'); complete(); } };
        r.timers.push(setTimeout(burst, reducedMotion() ? 150 : 1050));
    }
    function showMergeReveal(tier) {
        const from = BOXES[tier], to = BOXES[tier + 1];
        const mini = `<span class="lr-mini">${boxSvg(tier)}</span>`;
        const r = buildReveal({ title: to.name, kicker: 'Merged', color: to.color,
            stage: `<div class="lr-merge">${mini}${mini}${mini}<div class="lr-chest lr-chest--new">${boxSvg(tier + 1)}</div></div>` });
        sfx('merge');
        r.timers.push(setTimeout(() => flash(to.color), reducedMotion() ? 0 : 620));
        const complete = () => {
            const btns = [];
            if (st().boxes[tier] >= MERGE_COUNT) btns.push({ id: 'again', label: 'Merge again' });
            btns.push({ id: 'close', label: 'Done' });
            btns.push({ id: 'open', label: 'Open it', cls: 'btn-primary' });
            r.actions = { again: () => mergeBoxes(tier), close: closeReveal, open: () => openBoxes(tier + 1, 1) };
            revealDone(r, `${MERGE_COUNT} ${plural(from.name)} fused into ${aOrAn(to.name)}.`, btns);
        };
        r.skip = () => { r.el.classList.add('is-instant'); complete(); };
        r.timers.push(setTimeout(complete, reducedMotion() ? 0 : 1350));
    }
    function showMergeAllReveal(gained, top, merges) {
        const r = buildReveal({ title: 'Merge complete', kicker: `${merges} ${plural('merge', merges)}`, color: BOXES[top].color,
            stage: `<div class="lr-chest lr-chest--pop">${boxSvg(top)}</div>` });
        sfx('merge');
        flash(BOXES[top].color);
        const cards = [];
        gained.forEach((n, t) => { if (n) cards.push({ kind: 'box', tier: t, count: n }); });
        r.el.querySelector('.lr-cards').innerHTML = cards.map(cardHtml).join('');
        r.actions = { close: closeReveal };
        const complete = () => revealDone(r, 'New lootboxes are waiting in your Items.', [{ id: 'close', label: 'Done', cls: 'btn-primary' }]);
        r.skip = () => { r.el.classList.add('is-instant'); complete(); };
        r.timers.push(setTimeout(complete, reducedMotion() ? 0 : 700 + cards.length * 110));
    }
    function showGotReveal(tier) {
        const b = BOXES[tier];
        const r = buildReveal({ title: b.name, kicker: 'Added to your Items', color: b.color, stage: `<div class="lr-chest is-drop">${boxSvg(tier)}</div>` });
        r.actions = { keep: closeReveal, open: () => openBoxes(tier, 1) };
        const complete = () => revealDone(r, null, [{ id: 'keep', label: 'Keep it' }, { id: 'open', label: 'Open now', cls: 'btn-primary' }]);
        r.skip = complete;
        r.timers.push(setTimeout(complete, reducedMotion() ? 0 : 650));
    }

    // ---------------- page hooks ----------------
    // Esc: the purchase dialog, then the reveal, then the inventory. Returns true when it closed something.
    function handleEscape() {
        if (confirmState) { closeConfirm(false); return true; }
        if (reveal) { if (reveal.done) closeReveal(); else if (reveal.skip) reveal.skip(); return true; }
        if (menuOpen()) { closeInventory(); return true; }
        return false;
    }
    // running boosts and the lure, for the Active Buffs panel: [{ label, until }]
    function boostLines() {
        const s = st(), now = Date.now(), out = [];
        s.boosts.forEach(b => { if (b.until > now) { const it = ITEMS_BY_ID[b.id]; out.push({ label: `${it.icon} ${it.name}: ${boostLabel(it)}`, until: b.until }); } });
        if (s.lureUntil > now) out.push({ label: '🧲 Lootbox Lure', until: s.lureUntil });
        return out;
    }
    function summary() {
        const s = st();
        return { boxes: totalBoxes(), opened: s.stats.opened, collected: s.stats.collected, charms: CHARMS.filter(c => s.seen[c.id]).length, charmsTotal: CHARMS.length };
    }

    function init() {
        if (init.done) return;
        init.done = true;
        st();
        setInterval(tick, 1000);
        document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'hidden') save(); });
        window.addEventListener('beforeunload', save);
        // the game open in another tab changed the items
        window.addEventListener('storage', ev => {
            if (ev.key !== STORAGE_KEY) return;
            state = load();
            ver++;
            renderHud();
            if (menuOpen()) renderInventory();
            refreshGame();
        });
        renderHud();
    }
    if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init);
    else init();

    window.WHI = {
        STORAGE_KEY, RARITIES, BOXES, ITEMS, ITEMS_BY_ID,
        bonuses, renderHud, gemBurst, shakeChip, confirmSpend, renderTreasury,
        openInventory, closeInventory, openTreasury, handleEscape, boostLines, summary,
    };
})();
