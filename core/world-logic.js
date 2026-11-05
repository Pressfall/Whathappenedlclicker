/**
 * The Wilds: the player's adventure save and every rule that changes it (inventory, crafting, quality, caps, death,
 * trading, rewards for the main game). Pure: no page, no clock, no Math.random. Callers pass `now` (ms) and `rng`
 * (a function returning [0, 1)). world.html keeps the state in localStorage 'whathappened_world'; the main game only
 * ever reads its outbox (core/world-bridge.js).
 *
 * Works in a browser (<script src="core/world-logic.js"> sets window.WHWorld, after world-data.js and world-bridge.js)
 * and in Node (require).
 */
(function (root, factory) {
    if (typeof module === 'object' && module.exports) module.exports = factory(require('./world-data'), require('./world-bridge'), require('./world-gods'), require('./world-arena'), require('./world-waves'), require('./world-tour'), require('./world-crew'), require('./renown'), require('./world-guilds'));
    else root.WHWorld = factory(root.WHWorldData, root.WHWorldBridge, root.WHWorldGods, root.WHWorldArena, root.WHWorldWaves, root.WHWorldTour, root.WHCrew, root.WHRenown, root.WHGuilds);
}(typeof self !== 'undefined' ? self : this, function (D, Bridge, Gods, Arena, Waves, Tour, Crew, Renown, Guilds) {
    'use strict';

    const WORLD_VERSION = 1;
    const SLOTS = ['helmet', 'chest', 'boots', 'ring', 'offhand'];
    const int = (v, max = Number.MAX_SAFE_INTEGER) => Math.max(0, Math.min(max, Math.floor(Number(v) || 0)));
    const isObj = (v) => !!v && typeof v === 'object' && !Array.isArray(v);

    // ---------------- what you did in the game (the clicker) ----------------
    // core/world-crew.js clickerView: best upgrade levels, prestiges, lifetime clicks... and the Renown level. The page
    // builds it from the game's storage (world.js) and sets it here; it is never saved in the Wilds save. Crew arrivals,
    // 'clicker' quest goals, crew services and the Renown boost read it. Tests set it directly.
    let clickerView = Crew.clickerView({});
    function setClickerView(v) { clickerView = v && Array.isArray(v.best) ? v : Crew.clickerView({}); return clickerView; }
    function getClickerView() { return clickerView; }

    // ---------------- calendar (local day; ISO week, so a week always starts on Monday) ----------------
    function dayKey(now) {
        const d = new Date(now);
        return d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0');
    }
    // the bridge's, so the Wilds' weekly caps and the game's weekly Golden trade limit turn over together
    const weekKey = Bridge.weekKey;

    // ---------------- state ----------------
    function freshCaps(now) {
        return { day: dayKey(now), gems: 0, golden: 0, week: weekKey(now), boxPts: 0, exGems: 0, exGolden: 0, mythic: 0 };
    }
    function freshStats() {
        return { kills: 0, elites: 0, deaths: 0, crafted: 0, bestScore: 0, legendaries: 0, mined: 0, chopped: 0, gathered: 0,
            rubiesEarned: 0, playSec: 0, bossKills: 0, rivalsBeaten: 0, boxesCrafted: 0, gemsSent: 0, goldenSent: 0, lostGear: 0, pvpWins: 0, pvpLosses: 0,
            blocks: 0, backstabs: 0, arrowHits: 0, rushHits: 0, questsDone: 0, guildsGot: 0 };
    }
    function freshGuilds() { return { owned: {}, sold: { period: '', ups: {} }, contract: null }; }
    function cleanGuilds(raw) {
        const out = freshGuilds();
        if (!isObj(raw)) return out;
        out.owned = Guilds.cleanOwned(raw.owned);
        const sd = isObj(raw.sold) ? raw.sold : {};
        out.sold = { period: typeof sd.period === 'string' ? sd.period.slice(0, 12) : '', ups: {} };
        if (isObj(sd.ups)) for (const k in sd.ups) if (Guilds.BY_UP[Number(k)] && sd.ups[k]) out.sold.ups[Number(k)] = true;
        const c = raw.contract;
        if (isObj(c) && Guilds.BY_UP[Number(c.up)]) {
            const def = Guilds.contractOf(Number(c.up));
            out.contract = { up: Number(c.up), prog: int(c.prog, def.goal.n || 1) };
        }
        return out;
    }
    function freshCrew() { return { seen: {}, shop: { day: '', used: {} }, trade: { day: '', used: {} } }; }
    // a stored crew record -> a usable one: only real crew ids, today's counts per known stock or trade
    function cleanCrew(raw) {
        const out = freshCrew();
        if (!isObj(raw)) return out;
        out.seen = filterFlags(raw.seen, Crew.CREW_BY_ID);
        const known = (lists) => Object.fromEntries(Object.values(lists).flat().map(x => [x.id, true]));
        for (const [k, lists] of [['shop', Crew.SHOPS], ['trade', Crew.TRADES]]) {
            const r = isObj(raw[k]) ? raw[k] : {};
            out[k] = { day: typeof r.day === 'string' ? r.day.slice(0, 12) : '', used: cleanCounts(r.used, known(lists)) };
        }
        return out;
    }
    function freshState(now) {
        const s = {
            v: WORLD_VERSION, createdAt: now, savedAt: now, writer: '',
            rubies: 0, mats: {}, bag: {},
            gear: [], nextUid: 1,
            equip: { helmet: null, chest: null, boots: null, ring: null, offhand: null },
            hotbar: [null, null, null, null, null], sel: 0,
            cons: { potion_small: 3, potion_big: 0, potion_max: 0, arrow: 0 },
            zone: 'town', pos: null, hp: D.COMBAT.player.hp,
            unlocked: { zones: { town: true, greenwood: true }, camps: {} },
            bosses: {}, rivals: {}, nodes: {},
            seals: {},  // per Far Reaches zone: the wards broken there, as a bitmask (bit i = ward i)
            arena: Arena.freshArena(), // the Arena: rating, record, Glory and its daily caps, titles, a match in progress
            grave: null, pendingCraft: null,
            caps: freshCaps(now),
            outSeq: 0, outbox: [], overflow: null,
            inAck: 0, // the last rubies entry from the game applied (core/world-bridge.js inbox)
            tutorial: { buckler: true },
            skin: null, // the game skin worn here (a mainimage path); null: whatever the game has equipped
            classes: { active: D.STARTER_CLASS, unlocked: { [D.STARTER_CLASS]: true }, loadout: {} },
            skills: { learned: {} },
            gods: {},   // Hall of Gods statue levels (core/world-gods.js); the game reads them for its blessings
            quests: {}, // per NPC: { step, active: { id, prog } or null, dailyDone }
            secrets: { hallDoor: false, autoClicker: false }, // the Hall's far wall opened; the hidden room's Auto Clicker bought
            // the crew from the game (core/world-crew.js): who has been greeted in town, and today's shop and trade counts
            crew: freshCrew(),
            renown: { claimed: [] }, // Renown milestones whose Wilds half was claimed here (core/renown.js)
            // hero guilds (core/world-guilds.js): how many of each you own (the game reads these), which of this stock you
            // bought (sold out until the stock changes), and the one contract you are working on
            guilds: freshGuilds(),
            stats: freshStats(),
        };
        const shield = addGear(s, D.STARTER_OFFHAND, 40, [], now);
        if (shield) s.equip.offhand = shield.uid;
        D.STARTER_KIT.forEach((base, i) => {
            const it = addGear(s, base, 40, [], now);
            if (it) s.hotbar[i] = it.uid;
        });
        return s;
    }

    function cleanCounts(obj, known) {
        const out = {};
        if (!isObj(obj)) return out;
        for (const k in obj) {
            if (k.length > 40 || (known && !known[k])) continue;
            const n = int(obj[k]);
            if (n) out[k] = n;
        }
        return out;
    }
    // Any stored value (missing, damaged, older or newer) -> a usable state. Never throws.
    function migrate(raw, now) {
        if (!isObj(raw)) return freshState(now);
        const s = freshState(now);
        s.gear = []; s.hotbar = [null, null, null, null, null];
        s.createdAt = Number(raw.createdAt) || now;
        s.savedAt = Number(raw.savedAt) || now;
        s.rubies = int(raw.rubies);
        // unknown material ids are kept (a renamed one can be mapped later); only junk is dropped
        s.mats = cleanCounts(raw.mats);
        s.bag = cleanCounts(raw.bag);
        s.cons = Object.assign({ potion_small: 0, potion_big: 0, potion_max: 0, arrow: 0 }, cleanCounts(raw.cons, D.CONSUMABLES_BY_ID));
        s.nextUid = Math.max(1, int(raw.nextUid));
        s.stats = Object.assign(freshStats(), cleanCounts(raw.stats));
        const seen = new Set();
        for (const g of (Array.isArray(raw.gear) ? raw.gear : [])) {
            if (!isObj(g)) continue;
            const uid = int(g.uid);
            if (!uid || seen.has(uid)) continue;
            if (!D.GEAR_BY_ID[g.base]) { s.stats.lostGear++; continue; }
            seen.add(uid);
            const aff = (Array.isArray(g.aff) ? g.aff : []).filter(a => D.AFFIXES[a]).slice(0, 2);
            s.gear.push({ uid, base: g.base, score: int(g.score, 100), aff, at: Number(g.at) || 0 });
            if (uid >= s.nextUid) s.nextUid = uid + 1;
        }
        s.gear = s.gear.slice(0, D.RULES.maxGear + 10);
        const owned = (uid, ok) => { const g = s.gear.find(x => x.uid === uid); return g && ok(D.GEAR_BY_ID[g.base]) ? uid : null; };
        const eq = isObj(raw.equip) ? raw.equip : {};
        for (const slot of SLOTS) s.equip[slot] = owned(int(eq[slot]), b => b.slot === slot);
        const hb = Array.isArray(raw.hotbar) ? raw.hotbar : [];
        const used = new Set();
        for (let i = 0; i < D.RULES.hotbarSlots; i++) {
            const uid = owned(int(hb[i]), b => b.slot === 'weapon');
            if (uid && !used.has(uid)) { s.hotbar[i] = uid; used.add(uid); }
        }
        s.sel = int(raw.sel, D.RULES.hotbarSlots - 1);
        s.zone = D.ZONES[raw.zone] ? raw.zone : 'town';
        s.pos = isObj(raw.pos) && Number.isFinite(Number(raw.pos.x)) && Number.isFinite(Number(raw.pos.y)) ? { x: Number(raw.pos.x), y: Number(raw.pos.y) } : null;
        s.hp = Number.isFinite(Number(raw.hp)) ? Math.max(1, Number(raw.hp)) : D.COMBAT.player.hp;
        const un = isObj(raw.unlocked) ? raw.unlocked : {};
        s.unlocked = { zones: Object.assign({ town: true, greenwood: true }, filterFlags(un.zones, D.ZONES)), camps: filterFlags(un.camps, D.ZONES) };
        s.bosses = {};
        if (isObj(raw.bosses)) for (const id in raw.bosses) {
            if (!D.BOSSES[id] || !isObj(raw.bosses[id])) continue;
            const b = raw.bosses[id];
            s.bosses[id] = { kills: int(b.kills), lastKillDay: String(b.lastKillDay || ''), lastKillWeek: String(b.lastKillWeek || ''), mythicWeek: String(b.mythicWeek || '') };
        }
        // a boss already beaten opens the zone after it, even one added since (Frozen WH and the Far Reaches)
        for (const id in s.bosses) if (s.bosses[id].kills > 0) { const next = nextZoneAfter(D.BOSSES[id].zone); if (next) s.unlocked.zones[next] = true; }
        s.seals = {};
        if (isObj(raw.seals)) for (const z in raw.seals) { const n = wardCount(z), v = int(raw.seals[z], (1 << n) - 1); if (n && v) s.seals[z] = v; }
        s.arena = Arena.cleanArena(raw.arena);
        s.arena.tours = Tour.cleanTours(raw.arena && raw.arena.tours);
        // a match was still on when this save was last written (the page closed or reloaded mid-match): that is a forfeit,
        // so leaving can't dodge a loss. The stake was already paid.
        if (s.arena.live) { s.arena.rating = Arena.clampRating(s.arena.rating + s.arena.live.delta); s.arena.l++; s.arena.live = null; }
        s.rivals = {};
        if (isObj(raw.rivals)) for (const z in raw.rivals) {
            if (!D.RIVAL_TIERS[z] || !isObj(raw.rivals[z])) continue;
            const r = raw.rivals[z];
            s.rivals[z] = { defeats: int(r.defeats), lastDay: String(r.lastDay || ''), respawnAt: Number(r.respawnAt) || 0 };
        }
        s.nodes = {};
        if (isObj(raw.nodes)) for (const k in raw.nodes) { const t = Number(raw.nodes[k]); if (k.length <= 60 && t > now) s.nodes[k] = t; }
        if (isObj(raw.grave) && D.ZONES[raw.grave.zone]) {
            const g = raw.grave;
            s.grave = { zone: g.zone, x: Number(g.x) || 0, y: Number(g.y) || 0, mats: cleanCounts(g.mats), at: Number(g.at) || 0 };
            if (!Object.keys(s.grave.mats).length) s.grave = null;
        }
        if (isObj(raw.pendingCraft) && isObj(raw.pendingCraft.mats)) {
            const p = raw.pendingCraft;
            s.pendingCraft = { kind: String(p.kind || ''), id: String(p.id || ''), mats: cleanCounts(p.mats), fee: int(p.fee), uid: int(p.uid), at: Number(p.at) || 0 };
        }
        const c = isObj(raw.caps) ? raw.caps : {};
        s.caps = { day: String(c.day || dayKey(now)), gems: int(c.gems), golden: int(c.golden), week: String(c.week || weekKey(now)), boxPts: int(c.boxPts), exGems: int(c.exGems), exGolden: int(c.exGolden), mythic: int(c.mythic) };
        s.outSeq = int(raw.outSeq);
        s.inAck = int(raw.inAck);
        // a full outbox can also hold each one-time purchase on top (Bridge.push never holds a purchase back), so keep room for
        // those: cutting to MAX_OUTBOX would drop the oldest reward the game hasn't collected yet
        s.outbox = (Array.isArray(raw.outbox) ? raw.outbox : []).map(Bridge.clampEntry).filter(Boolean).slice(-(Bridge.MAX_OUTBOX + Object.keys(Bridge.BUYS).length));
        for (const e of s.outbox) if (e.seq > s.outSeq) s.outSeq = e.seq;
        if (isObj(raw.overflow)) {
            const o = raw.overflow;
            s.overflow = { gems: int(o.gems), golden: int(o.golden), boxes: D.BOX_NAMES.map((_, i) => int(Array.isArray(o.boxes) ? o.boxes[i] : 0)) };
            for (const k of Bridge.MAP_KINDS) { const m = Bridge.cleanMap(k, o[k], Number.MAX_SAFE_INTEGER); if (Object.keys(m).length) s.overflow[k] = m; }
            if (Bridge.isEmpty(s.overflow)) s.overflow = null;
        }
        s.tutorial = filterFlags(raw.tutorial);
        s.skills = cleanSkills(raw.skills, raw.abilities);
        s.gods = cleanGods(raw.gods);
        s.quests = cleanQuests(raw.quests);
        s.crew = cleanCrew(raw.crew);
        s.renown = { claimed: Renown.cleanClaimed(isObj(raw.renown) ? raw.renown.claimed : null) };
        s.guilds = cleanGuilds(raw.guilds);
        const sec = isObj(raw.secrets) ? raw.secrets : {};
        s.secrets = { hallDoor: sec.hallDoor === true, autoClicker: sec.autoClicker === true };
        s.skin = cleanSkin(raw.skin);
        s.classes = cleanClasses(raw.classes, raw.abilities, s.skills);
        // saves from before shields existed get the starter buckler once
        if (!s.tutorial.buckler) {
            s.tutorial.buckler = true;
            if (!s.gear.some(g => D.GEAR_BY_ID[g.base].slot === 'offhand')) { const it = addGear(s, D.STARTER_OFFHAND, 40, [], now); if (it && !s.equip.offhand) s.equip.offhand = it.uid; }
        }
        s.writer = typeof raw.writer === 'string' ? raw.writer.slice(0, 40) : '';
        refreshCaps(s, now);
        // a save with no weapon at all (everything salvaged or lost) gets the starter kit back
        if (!s.gear.some(g => D.GEAR_BY_ID[g.base].slot === 'weapon')) {
            D.STARTER_KIT.forEach((base, i) => { const it = addGear(s, base, 40, [], now); if (it) s.hotbar[i] = it.uid; });
        }
        return s;
    }
    // Saves from before skill trees kept learned abilities in "abilities"; their ids are still skills of the same class
    // Skills that were replaced keep their place in the tree: a save that learned the old one has the new one
    const RENAMED = { blink: 'grapple', envenom: 'riposte', fan_of_knives: 'quick_cut', caltrops: 'deadly_throw', quick_hands: 'opportunist', fire_nova: 'burning_stick', frost_armor: 'ice_beam' };
    const renamed = (id) => (Object.prototype.hasOwnProperty.call(RENAMED, id) ? RENAMED[id] : id);
    function cleanSkills(raw, legacy) {
        const out = { learned: {} };
        for (const src of [legacy, raw]) if (isObj(src) && isObj(src.learned)) for (const id in src.learned) if (skillDef(renamed(id)) && src.learned[id]) out.learned[renamed(id)] = true;
        return out;
    }
    // rawAbilities may be from before classes, when any ability could go in any slot: the class of every skill already
    // learned is unlocked for free, and the class of the first slotted one becomes the active class. A class with no
    // stored loadout (saves from before loadouts) gets its learned abilities in tree order.
    function cleanClasses(raw, rawAbilities, skills) {
        const n = D.ABILITY_KEYS.length;
        const out = { active: D.STARTER_CLASS, unlocked: { [D.STARTER_CLASS]: true }, loadout: {} };
        if (isObj(raw) && isObj(raw.unlocked)) for (const id in raw.unlocked) if (D.CLASSES[id] && raw.unlocked[id]) out.unlocked[id] = true;
        for (const id in skills.learned) out.unlocked[skillDef(id).cls] = true;
        if (isObj(raw) && out.unlocked[raw.active]) out.active = raw.active;
        else if (isObj(rawAbilities) && Array.isArray(rawAbilities.slots)) {
            const first = rawAbilities.slots.map(renamed).find(id => skills.learned[id]);
            if (first) out.active = skillDef(first).cls;
        }
        const rawLo = isObj(raw) && isObj(raw.loadout) ? raw.loadout : {};
        for (const c of D.CLASS_ORDER) {
            const stored = Array.isArray(rawLo[c]);
            const list = stored ? rawLo[c].slice(0, n).map(renamed) : treeOrder(c).filter(id => D.ABILITIES[id]).filter(id => skills.learned[id]).slice(0, n);
            const clean = [];
            for (let i = 0; i < n; i++) {
                const id = list[i];
                clean.push(D.ABILITIES[id] && D.ABILITIES[id].cls === c && skills.learned[id] && !clean.includes(id) ? id : null);
            }
            if (stored || clean.some(Boolean)) out.loadout[c] = clean;
        }
        return out;
    }
    function cleanGods(raw) {
        const out = {}, lv = Gods.levelsFrom({ gods: raw });
        for (const id in lv) if (lv[id]) out[id] = lv[id];
        return out;
    }
    function cleanQuests(raw) {
        const out = {};
        if (!isObj(raw)) return out;
        for (const id in raw) {
            const npc = D.NPCS[id], r = raw[id];
            if (!npc || !isObj(r)) continue;
            const rec = { step: int(r.step, npc.chain.length), active: null, dailyDone: typeof r.dailyDone === 'string' ? r.dailyDone.slice(0, 12) : '' };
            const a = r.active, q = isObj(a) && Object.prototype.hasOwnProperty.call(D.QUESTS, a.id) ? D.QUESTS[a.id] : null;
            if (q && q.npc === id) {
                rec.active = { id: q.id, prog: int(a.prog, q.goal.n || 1) };
                if (q.daily && typeof a.day === 'string') rec.active.day = a.day.slice(0, 12);
            }
            out[id] = rec;
        }
        return out;
    }
    // a class's skills row by row (the first row of every branch, then the second...)
    function treeOrder(c) {
        const out = [], br = D.CLASSES[c].branches;
        for (let row = 0; br.some(b => b.skills[row]); row++) for (const b of br) if (b.skills[row]) out.push(b.skills[row]);
        return out;
    }
    function filterFlags(obj, known) {
        const out = {};
        if (!isObj(obj)) return out;
        for (const k in obj) if (obj[k] && k.length <= 40 && (!known || known[k])) out[k] = true;
        return out;
    }
    // Problems with a state (empty when it is sound). Used by tests and the debug overlay.
    // a skin path from the save: only a picture in mainimage/ (whether it is still owned is checked against the game's save)
    function cleanSkin(v) { return typeof v === 'string' && v.length <= 80 && /^mainimage\/[\w.-]+\.(png|jpe?g|webp)$/i.test(v) ? v : null; }
    function validate(s) {
        const p = [];
        if (s.skin !== null && cleanSkin(s.skin) !== s.skin) p.push('skin');
        if (!isObj(s) || s.v !== WORLD_VERSION) p.push('version');
        if (!Number.isInteger(s.rubies) || s.rubies < 0) p.push('rubies');
        for (const bag of ['mats', 'bag']) for (const k in s[bag]) if (!Number.isInteger(s[bag][k]) || s[bag][k] <= 0) p.push(bag + '.' + k);
        const uids = new Set();
        for (const g of s.gear) {
            if (!D.GEAR_BY_ID[g.base]) p.push('gear.base ' + g.base);
            if (uids.has(g.uid)) p.push('gear.uid ' + g.uid);
            uids.add(g.uid);
        }
        for (const slot of SLOTS) if (s.equip[slot] && !uids.has(s.equip[slot])) p.push('equip.' + slot);
        s.hotbar.forEach((u, i) => { if (u && !uids.has(u)) p.push('hotbar.' + i); });
        if (!s.classes || !s.classes.unlocked[s.classes.active] || !D.CLASSES[s.classes.active]) p.push('classes.active');
        for (const id in s.skills.learned) if (!skillDef(id)) p.push('skills.' + id);
        for (const id in s.gods) if (!Gods.GODS[id] || !(s.gods[id] >= 1 && s.gods[id] <= Gods.LEVEL_CAP)) p.push('gods.' + id);
        for (const id in s.quests) if (!D.NPCS[id]) p.push('quests.' + id);
        for (const id in (s.crew && s.crew.seen) || {}) if (!Crew.CREW_BY_ID[id]) p.push('crew.' + id);
        if (!s.renown || Renown.cleanClaimed(s.renown.claimed).length !== (s.renown.claimed || []).length) p.push('renown');
        for (const k in (s.guilds && s.guilds.owned) || {}) if (!Guilds.BY_UP[Number(k)] || !(s.guilds.owned[k] >= 1)) p.push('guilds.' + k);
        if (s.guilds && s.guilds.contract && !Guilds.BY_UP[s.guilds.contract.up]) p.push('guilds.contract');
        for (const z in s.seals) if (!wardCount(z) || !(s.seals[z] > 0 && s.seals[z] < (1 << wardCount(z)))) p.push('seals.' + z);
        for (const c in s.classes.loadout) {
            const lo = s.classes.loadout[c];
            if (!D.CLASSES[c] || !Array.isArray(lo) || lo.length !== D.ABILITY_KEYS.length) { p.push('loadout.' + c); continue; }
            lo.forEach((id, i) => { if (id && (!D.ABILITIES[id] || D.ABILITIES[id].cls !== c || !s.skills.learned[id] || lo.indexOf(id) !== i)) p.push('loadout.' + c + '.' + i); });
        }
        return p;
    }

    // ---------------- inventory ----------------
    function count(s, id) {
        if (D.CONSUMABLES_BY_ID[id]) return s.cons[id] || 0;
        return (s.mats[id] || 0) + (s.bag[id] || 0);
    }
    function has(s, inputs, times = 1) {
        for (const id in inputs) if (count(s, id) < inputs[id] * times) return false;
        return true;
    }
    function missing(s, inputs, times = 1) {
        const out = {};
        for (const id in inputs) { const need = inputs[id] * times - count(s, id); if (need > 0) out[id] = need; }
        return out;
    }
    // Take inputs, all or nothing. Banked materials first, then what's being carried.
    function take(s, inputs, times = 1) {
        if (!has(s, inputs, times)) return false;
        for (const id in inputs) {
            let need = inputs[id] * times;
            if (D.CONSUMABLES_BY_ID[id]) { s.cons[id] -= need; continue; }
            for (const bag of ['mats', 'bag']) {
                const n = Math.min(need, s[bag][id] || 0);
                if (!n) continue;
                s[bag][id] -= n; need -= n;
                if (!s[bag][id]) delete s[bag][id];
            }
        }
        return true;
    }
    // Add materials. Outside town they go into the bag (part of it drops on death); in town they're banked at once.
    function give(s, id, n, inTown) {
        n = int(n);
        if (!n) return 0;
        if (D.CONSUMABLES_BY_ID[id]) { s.cons[id] = (s.cons[id] || 0) + n; return n; }
        const bag = (inTown || D.MATERIALS_BY_ID[id] && D.MATERIALS_BY_ID[id].kind === 'key') ? 'mats' : 'bag';
        s[bag][id] = (s[bag][id] || 0) + n;
        return n;
    }
    function giveAll(s, mats, inTown) { for (const id in mats) give(s, id, mats[id], inTown); }
    // Entering town: everything carried is safe from now on
    function bank(s) {
        for (const id in s.bag) s.mats[id] = (s.mats[id] || 0) + s.bag[id];
        const banked = s.bag;
        s.bag = {};
        return banked;
    }
    function addRubies(s, n) {
        n = int(n);
        s.rubies += n;
        s.stats.rubiesEarned += n;
        return n;
    }

    // ---------------- gear ----------------
    const QUALITY_ANCHORS = [[0, 0.8], [30, 1.0], [55, 1.15], [75, 1.3], [90, 1.5], [98, 1.75], [100, 1.8]];
    function qualityOf(score) {
        const sc = Math.max(0, Math.min(100, Number(score) || 0));
        let q = D.QUALITY[0];
        for (const t of D.QUALITY) if (sc >= t.min) q = t;
        return q;
    }
    // Stat multiplier for a score: straight lines between the tier anchors, so every point counts
    function qualityMult(score) {
        const sc = Math.max(0, Math.min(100, Number(score) || 0));
        for (let i = 1; i < QUALITY_ANCHORS.length; i++) {
            const [x1, y1] = QUALITY_ANCHORS[i];
            const [x0, y0] = QUALITY_ANCHORS[i - 1];
            if (sc <= x1) return y0 + (y1 - y0) * (sc - x0) / (x1 - x0);
        }
        return QUALITY_ANCHORS[QUALITY_ANCHORS.length - 1][1];
    }
    function affixGroup(base) {
        if (base.slot === 'weapon') return (base.cls === 'axe' || base.cls === 'pickaxe') ? 'tool' : 'weapon';
        if (base.slot === 'ring' || base.slot === 'offhand') return null;
        return 'armor';
    }
    function rollAffixes(base, score, rng) {
        const group = affixGroup(base);
        if (!group) return [];
        const q = qualityOf(score);
        const pool = Object.keys(D.AFFIXES).filter(a => D.AFFIXES[a].slots.includes(group));
        const out = [];
        const pick = () => { const left = pool.filter(a => !out.includes(a)); if (left.length) out.push(left[Math.floor(rng() * left.length) % left.length]); };
        if (q.affix >= 1 || rng() < q.affix) pick();
        if (q.second && rng() < q.second) pick();
        return out;
    }
    function gearCount(s) { return s.gear.length; }
    function addGear(s, baseId, score, aff, now) {
        const base = D.GEAR_BY_ID[baseId];
        if (!base || (s.lent ? s.lent.gear : s.gear).length >= D.RULES.maxGear) return null;
        const it = { uid: s.nextUid++, base: baseId, score: int(score, 100), aff: (aff || []).filter(a => D.AFFIXES[a]), at: now || 0 };
        (s.lent ? s.lent.gear : s.gear).push(it); // made during a tournament duel with a lent kit: it is yours, kept aside with your gear
        return it;
    }
    function findGear(s, uid) { return s.gear.find(g => g.uid === uid) || null; }
    function baseOf(it) { return it ? D.GEAR_BY_ID[it.base] : null; }
    // The numbers one piece of gear gives, after quality and affixes
    function gearStats(it) {
        const b = baseOf(it);
        if (!b) return null;
        const m = qualityMult(it.score);
        const a = new Set(it.aff || []);
        const out = { dmg: (b.dmg || 0) * m, armor: (b.armor || 0) * m * (a.has('sturdy') ? 1.1 : 1), hp: (b.hp || 0) * m, speed: (b.speed || 0) * m,
            tool: b.tool || 0, toolPower: m, crit: a.has('keen') ? 0.1 : 0, wMult: a.has('swift') ? 1.08 : 1, aMult: a.has('featherweight') ? 1.15 : 1,
            kbMult: a.has('weighty') ? 1.4 : 1, lifesteal: a.has('vampiric') ? 0.02 : 0, yield: a.has('prospector') ? 0.15 : 0, luck: a.has('lucky') ? 0.1 : 0,
            rubies: b.rubies || 0, fireResist: b.fireResist || 0, stamRegen: b.stamRegen || 0, burn: !!b.burn, chill: !!b.chill };
        if (b.luck) out.luck += b.luck;
        if (b.slot === 'offhand') {
            // better quality: blocks a little more, costs less stamina, and parries are easier to time
            out.block = Math.min(D.COMBAT.shield.maxBlock, b.block + (m - 1) * 0.12);
            out.arc = b.arc * Math.PI / 180;
            out.stab = b.stab * m;
            out.parry = D.COMBAT.shield.parryWindow * (0.75 + 0.25 * m);
        }
        return out;
    }
    function gearName(it) {
        const b = baseOf(it);
        if (!b) return 'Unknown';
        const q = qualityOf(it.score);
        const aff = (it.aff || []).map(x => D.AFFIXES[x].name);
        return (aff.length ? aff.join(' ') + ' ' : '') + b.name + (q.id === 'common' ? '' : ' (' + q.name + ')');
    }
    // Everything the equipped armor and ring, the class and its learned perks add up to
    function classId(s) { return D.CLASSES[s.classes && s.classes.active] ? s.classes.active : D.STARTER_CLASS; }
    function classOf(s) { return D.CLASSES[classId(s)]; }
    // bonus keys that multiply (the rest add up); dmg multiplies per weapon class
    const MULT_BONUS = { blockStam: 1, abilityCd: 1, abilityDmg: 1, abilityStam: 1, dashCd: 1, dashStam: 1, stunnedDmg: 1 };
    function addBonus(out, b) {
        for (const k in b) {
            if (k === 'dmg') { for (const w in b.dmg) out.dmgBy[w] = (out.dmgBy[w] || 1) * b.dmg[w]; }
            else if (k in MULT_BONUS) out[k] *= b[k];
            else out[k] = (out[k] || 0) + b[k];
        }
    }
    function playerStats(s) {
        const out = { maxHp: D.COMBAT.player.hp, armor: 0, speed: 1, rubies: 0, luck: 0, yield: 0, fireResist: 0, stamRegen: 1, manaRegen: 1 };
        for (const slot of SLOTS) {
            const st = gearStats(findGear(s, s.equip[slot]));
            if (!st) continue;
            out.maxHp += st.hp; out.armor += st.armor; out.speed += st.speed; out.rubies += st.rubies;
            out.luck += st.luck; out.yield += st.yield; out.fireResist += st.fireResist; out.stamRegen += st.stamRegen;
        }
        // Renown (core/renown.js), counted from both games: a little more rubies from monsters, bosses and veins
        out.rubies += Renown.bonus(clickerView.renown).rubies / 100;
        Object.assign(out, { crit: 0, dmgBy: {}, arrowSave: 0, lifesteal: 0, momentum: 0, backstab: 0, regen: 0, pierce: 0, thorns: 0, dodge: 0 }, MULT_BONUS);
        const cid = classId(s);
        out.usesMana = !!D.CLASSES[cid].mana; // abilities and staff spells cost mana, not stamina
        addBonus(out, D.CLASSES[cid].bonus);
        for (const id in s.skills.learned) { const pk = D.PERKS[id]; if (pk && pk.cls === cid) addBonus(out, pk.bonus); }
        out.maxHp = Math.round(out.maxHp);
        out.armor = Math.round(out.armor);
        out.fireResist = Math.min(0.8, out.fireResist);
        out.dodge = Math.min(0.5, out.dodge);
        out.arrowSave = Math.min(0.9, out.arrowSave);
        out.abilityCd = Math.max(0.4, out.abilityCd);
        return out;
    }
    function equip(s, uid) {
        const it = findGear(s, uid), b = baseOf(it);
        if (!b) return false;
        if (b.slot === 'weapon') {
            if (s.hotbar.includes(uid)) return true;
            const free = s.hotbar.indexOf(null);
            s.hotbar[free >= 0 ? free : s.sel] = uid;
            return true;
        }
        s.equip[b.slot] = s.equip[b.slot] === uid ? null : uid; // equipping what's already on takes it off
        return true;
    }
    function unequip(s, uid) {
        for (const slot of SLOTS) if (s.equip[slot] === uid) s.equip[slot] = null;
        s.hotbar = s.hotbar.map(u => (u === uid ? null : u));
    }
    function isEquipped(s, uid) { return SLOTS.some(sl => s.equip[sl] === uid) || s.hotbar.includes(uid); }
    // Break gear down for part of its materials. The last weapon can't be salvaged.
    function salvage(s, uid) {
        const it = findGear(s, uid), b = baseOf(it);
        if (!b) return null;
        const weapons = s.gear.filter(g => baseOf(g).slot === 'weapon');
        if (b.slot === 'weapon' && weapons.length <= 1) return null;
        unequip(s, uid);
        s.gear = s.gear.filter(g => g.uid !== uid);
        const back = {};
        if (b.recipe) for (const id in b.recipe.in) { const n = Math.floor(b.recipe.in[id] * D.RULES.salvageShare); if (n) back[id] = n; }
        giveAll(s, back, true);
        return back;
    }
    // Tool power against a node, or 0 when the tool is too weak (or the wrong tool)
    function toolPower(it, node) {
        const b = baseOf(it), st = gearStats(it);
        if (!b || !node) return 0;
        if (node.tool === 'hand') return 1;
        if (b.cls !== node.tool) return 0;
        if (b.tool < node.tier) return 0;
        return (1 + 0.5 * (b.tool - node.tier)) * st.toolPower;
    }

    // ---------------- recipes ----------------
    function recipeFor(kind, id) {
        if (kind === 'gear') { const b = D.GEAR_BY_ID[id]; return b && b.recipe ? { station: b.recipe.station, in: b.recipe.in, fee: b.recipe.fee, tier: b.tier, name: b.name } : null; }
        if (kind === 'box') { const r = D.BOX_RECIPES.find(x => x.id === id); return r ? { station: 'altar', in: r.in, fee: r.fee, tier: r.tier + 1, name: r.name, pts: r.pts, boxTier: r.tier } : null; }
        if (kind === 'basic') { const r = D.BASIC_BY_ID[id]; return r ? { station: r.station, in: r.in, out: r.out, fee: 0, tier: 0, name: id } : null; }
        return null;
    }
    // Instant recipes (bars, planks, potions...). Returns how many were made.
    function craftBasic(s, id, times = 1) {
        const r = D.BASIC_BY_ID[id];
        if (!r) return 0;
        let made = 0;
        while (made < times && take(s, r.in)) { giveAll(s, r.out, true); made++; }
        return made;
    }
    function boxAllowanceLeft(s, now) {
        refreshCaps(s, now);
        return Math.max(0, D.CAPS.boxPointsPerWeek - s.caps.boxPts);
    }
    function canCraft(s, kind, id, now) {
        const r = recipeFor(kind, id);
        if (!r) return { ok: false, reason: 'unknown' };
        if (s.pendingCraft) return { ok: false, reason: 'busy' };
        if (kind === 'gear' && s.gear.length >= D.RULES.maxGear) return { ok: false, reason: 'full' };
        if (kind === 'box' && boxAllowanceLeft(s, now) < r.pts) return { ok: false, reason: 'allowance' };
        if (s.rubies < r.fee) return { ok: false, reason: 'rubies', need: r.fee - s.rubies };
        if (!has(s, r.in)) return { ok: false, reason: 'materials', missing: missing(s, r.in) };
        return { ok: true, recipe: r };
    }
    // Pay for a craft before the minigame starts. Quitting (or reloading) refunds the materials but not the fee, so
    // replaying until the score is good always costs something.
    function beginCraft(s, kind, id, now) {
        const c = canCraft(s, kind, id, now);
        if (!c.ok) return c;
        const r = c.recipe;
        take(s, r.in);
        s.rubies -= r.fee;
        if (kind === 'box') s.caps.boxPts += r.pts; // held while crafting; given back if the craft is abandoned
        s.pendingCraft = { kind, id, mats: Object.assign({}, r.in), fee: r.fee, uid: 0, at: now };
        return { ok: true, recipe: r };
    }
    // Reforge: replay a piece's minigame for the fee plus half its materials; the better score is kept
    function beginReforge(s, uid, now) {
        const it = findGear(s, uid), b = baseOf(it);
        if (!b || !b.recipe) return { ok: false, reason: 'unknown' };
        if (s.pendingCraft) return { ok: false, reason: 'busy' };
        const part = {};
        for (const id in b.recipe.in) part[id] = Math.max(1, Math.ceil(b.recipe.in[id] * D.RULES.reforgeShare));
        if (s.rubies < b.recipe.fee) return { ok: false, reason: 'rubies', need: b.recipe.fee - s.rubies };
        if (!has(s, part)) return { ok: false, reason: 'materials', missing: missing(s, part) };
        take(s, part);
        s.rubies -= b.recipe.fee;
        s.pendingCraft = { kind: 'reforge', id: it.base, mats: part, fee: b.recipe.fee, uid, at: now };
        return { ok: true, recipe: { station: b.recipe.station, in: part, fee: b.recipe.fee, tier: b.tier, name: b.name } };
    }
    function abortCraft(s) {
        const p = s.pendingCraft;
        if (!p) return null;
        giveAll(s, p.mats, true);
        if (p.kind === 'box') { const r = recipeFor('box', p.id); if (r) s.caps.boxPts = Math.max(0, s.caps.boxPts - r.pts); }
        s.pendingCraft = null;
        return p.mats;
    }
    // Box tier after the Rune Altar: a great score can bump it up a tier, a very poor one down a tier
    function boxTierShift(score, rng) {
        const T = D.RULES.tierShift;
        if (score >= 95) return rng() < T.up95 ? 1 : 0;
        if (score >= 85) return rng() < T.up85 ? 1 : 0;
        if (score < T.downBelow) return -1;
        return 0;
    }
    // The minigame is over: make the thing. Returns { kind, item?, tier?, improved? }.
    function finishCraft(s, score, rng, now, ack) {
        const p = s.pendingCraft;
        if (!p) return null;
        const sc = int(score, 100);
        s.pendingCraft = null;
        s.stats.crafted++;
        s.stats.bestScore = Math.max(s.stats.bestScore, sc);
        if (p.kind === 'gear') {
            const b = D.GEAR_BY_ID[p.id];
            const it = addGear(s, p.id, sc, rollAffixes(b, sc, rng), now);
            if (qualityOf(sc).id === 'legendary') s.stats.legendaries++;
            questEvent(s, { kind: 'craft', score: sc, tier: b.tier });
            return { kind: 'gear', item: it, score: sc };
        }
        if (p.kind === 'reforge') {
            const it = findGear(s, p.uid);
            if (!it) return { kind: 'reforge', item: null, score: sc };
            const improved = sc > it.score;
            if (improved) {
                it.score = sc;
                const fresh = rollAffixes(baseOf(it), sc, rng);
                if (fresh.length > it.aff.length) it.aff = fresh; // never lose affixes to a reforge
                if (qualityOf(sc).id === 'legendary') s.stats.legendaries++;
            }
            return { kind: 'reforge', item: it, score: sc, improved };
        }
        if (p.kind === 'box') {
            const r = recipeFor('box', p.id);
            const tier = Math.max(0, Math.min(D.BOX_NAMES.length - 1, r.boxTier + boxTierShift(sc, rng)));
            const boxes = D.BOX_NAMES.map(() => 0);
            boxes[tier] = 1;
            Bridge.push(s, { boxes, src: 'craft' }, ack, now);
            s.stats.boxesCrafted++;
            questEvent(s, { kind: 'box' });
            return { kind: 'box', tier, baseTier: r.boxTier, score: sc };
        }
        return null;
    }

    // ---------------- caps and rewards for the main game ----------------
    function refreshCaps(s, now) {
        const d = dayKey(now), w = weekKey(now);
        if (s.caps.day !== d) { s.caps.day = d; s.caps.gems = 0; s.caps.golden = 0; }
        if (s.caps.week !== w) { s.caps.week = w; s.caps.boxPts = 0; s.caps.exGems = 0; s.caps.exGolden = 0; s.caps.mythic = 0; }
        return s.caps;
    }
    function gemsLeftToday(s, now) { refreshCaps(s, now); return Math.max(0, D.CAPS.gemsPerDay - s.caps.gems); }
    function goldenLeftToday(s, now) { refreshCaps(s, now); return Math.max(0, D.CAPS.goldenPerDay - s.caps.golden); }
    // Send gems to the main game, up to today's cap; the rest pays rubies. Returns { gems, rubies }.
    function grantGems(s, n, now, src, ack) {
        n = int(n);
        const ok = Math.min(n, gemsLeftToday(s, now));
        const over = n - ok;
        if (ok) { s.caps.gems += ok; s.stats.gemsSent += ok; Bridge.push(s, { gems: ok, src }, ack, now); }
        const rubies = over ? addRubies(s, over * D.CAPS.overCapRubies.gem) : 0;
        return { gems: ok, rubies };
    }
    function grantGolden(s, n, now, src, ack) {
        n = int(n);
        const ok = Math.min(n, goldenLeftToday(s, now));
        const over = n - ok;
        if (ok) { s.caps.golden += ok; s.stats.goldenSent += ok; Bridge.push(s, { golden: ok, src }, ack, now); }
        const rubies = over ? addRubies(s, over * D.CAPS.overCapRubies.golden) : 0;
        return { golden: ok, rubies };
    }

    // ---------------- loot ----------------
    function randInt(rng, a, b) { return a + Math.floor(rng() * (b - a + 1)); }
    // drops: [[mat, min, max, chance, 'fixed'?]]. luck raises chances (never past 1) unless the chance is 'fixed'.
    // mult scales amounts (prospector, rings).
    function rollLoot(drops, rng, luck = 0, mult = 1) {
        const out = {};
        for (const [id, min, max, chance, fixed] of drops || []) {
            const p = chance >= 1 ? 1 : fixed ? chance : Math.min(1, chance * (1 + luck));
            if (rng() >= p) continue;
            let n = randInt(rng, min, max);
            if (mult > 1) { const extra = n * (mult - 1); n += Math.floor(extra) + (rng() < extra % 1 ? 1 : 0); }
            if (n > 0) out[id] = (out[id] || 0) + n;
        }
        return out;
    }
    function rollRubies(range, rng, mult = 1) {
        if (!range) return 0;
        const base = randInt(rng, range[0], range[1]);
        const x = base * mult;
        return Math.floor(x) + (rng() < x % 1 ? 1 : 0);
    }
    // A monster died. Returns { mats, rubies, gems, goldenRubies } and applies it all. opts: { ack, zone }
    function monsterLoot(s, monsterId, rng, now, opts = {}) {
        const m = D.MONSTERS[monsterId];
        if (!m || m.dummy) return { mats: {}, rubies: 0, gems: 0 };
        const ps = playerStats(s);
        const mats = rollLoot(m.drops, rng, ps.luck);
        giveAll(s, mats, false);
        const rubies = addRubies(s, rollRubies(m.rubies, rng, 1 + ps.rubies));
        let gems = 0, extraRubies = 0;
        s.stats.kills++;
        questEvent(s, { kind: 'kill', monster: monsterId, elite: !!m.elite, zone: opts.zone });
        if (m.elite) {
            s.stats.elites++;
            if (rng() < D.ELITE_GEM_CHANCE * (1 + ps.luck)) { const g = grantGems(s, 1, now, 'elite', opts.ack); gems = g.gems; extraRubies = g.rubies; }
        }
        return { mats, rubies: rubies + extraRubies, gems };
    }
    // A node was worked to the end. opts: { bonus (the last hit landed on the crack: an extra roll), ack, toolYield, inTown, zone }
    // Everywhere a material (or supply) comes from, for the "where do I find this?" tooltips:
    // [{ kind: 'node' | 'monster' | 'elite' | 'boss' | 'craft' | 'trader', name, zone (id), chance (0-1), tool, tier,
    //    station, inputs, price, n }], best sources first (gathering and crafting, then drops by chance)
    const sourcesCache = new Map();
    function materialSources(id) {
        if (sourcesCache.has(id)) return sourcesCache.get(id);
        const out = [], seen = new Set();
        const add = (src) => { const k = src.kind + '|' + src.name + '|' + (src.zone || ''); if (!seen.has(k)) { seen.add(k); out.push(src); } };
        const chanceIn = (drops) => { const d = (drops || []).find(x => x[0] === id); return d ? d[3] : 0; };
        for (const z of D.ZONE_ORDER) {
            const zone = D.ZONES[z];
            for (const type in zone.nodes || {}) {
                const n = D.NODES[type], c = n && chanceIn(n.drops);
                if (c) add({ kind: 'node', name: n.name, zone: z, chance: c, tool: n.tool, tier: n.tier || 0 });
            }
            for (const [m] of zone.spawns || []) { const c = D.MONSTERS[m] && chanceIn(D.MONSTERS[m].drops); if (c) add({ kind: 'monster', name: D.MONSTERS[m].name, zone: z, chance: c }); }
            if (zone.elite && D.MONSTERS[zone.elite]) { const c = chanceIn(D.MONSTERS[zone.elite].drops); if (c) add({ kind: 'elite', name: D.MONSTERS[zone.elite].name, zone: z, chance: c }); }
            if (zone.boss && D.BOSSES[zone.boss]) {
                const b = D.BOSSES[zone.boss], c = chanceIn(b.drops);
                if (c) add({ kind: 'boss', name: b.name, zone: z, chance: c });
                if (b.sigil === id) add({ kind: 'boss', name: b.name, zone: z, chance: 1, first: !b.sigilEvery }); // its sigil: the first time it falls, or every time (sigilEvery)
            }
        }
        for (const r of D.BASIC_RECIPES) if (r.out[id]) add({ kind: 'craft', name: D.STATIONS[r.station].name, station: r.station, inputs: r.in, n: r.out[id] });
        for (const t of D.TRADER_STOCK) if (t.give && t.give[id]) add({ kind: 'trader', name: 'Trader', price: t.price, n: t.give[id] });
        const rank = { node: 0, craft: 1, trader: 2, monster: 3, elite: 4, boss: 5 };
        out.sort((a, b) => (a.chance >= 1 ? 0 : 1) - (b.chance >= 1 ? 0 : 1) || rank[a.kind] - rank[b.kind] || (b.chance || 1) - (a.chance || 1));
        sourcesCache.set(id, out);
        return out;
    }
    function nodeLoot(s, nodeType, rng, now, opts = {}) {
        const n = D.NODES[nodeType];
        if (!n) return { mats: {}, rubies: 0, gems: 0 };
        const ps = playerStats(s);
        const mult = 1 + ps.yield + (opts.toolYield || 0);
        const mats = rollLoot(n.drops, rng, ps.luck, mult);
        if (opts.bonus) {
            const more = rollLoot(n.drops.map(d => [d[0], 1, 1, d[3] >= 1 ? 0.6 : d[3] * 2]), rng, ps.luck);
            for (const k in more) mats[k] = (mats[k] || 0) + more[k];
        }
        giveAll(s, mats, !!opts.inTown);
        let rubies = n.rubies ? addRubies(s, rollRubies(n.rubies, rng, 1 + ps.rubies + ps.yield)) : 0;
        let gems = 0;
        if (n.gem && rng() < n.gem * (1 + ps.luck)) { const g = grantGems(s, 1, now, 'vein', opts.ack); gems = g.gems; rubies += g.rubies; }
        questEvent(s, { kind: 'harvest', node: nodeType, tool: n.tool, zone: opts.zone });
        if (n.tool === 'pickaxe') s.stats.mined++;
        else if (n.tool === 'axe') s.stats.chopped++;
        else s.stats.gathered++;
        return { mats, rubies, gems };
    }
    // Boss reward. The first kill of the day pays the most and can send gems and Golden home.
    function bossLoot(s, bossId, rng, now, ack) {
        const b = D.BOSSES[bossId];
        if (!b) return null;
        refreshCaps(s, now);
        const rec = s.bosses[bossId] || (s.bosses[bossId] = { kills: 0, lastKillDay: '', lastKillWeek: '', mythicWeek: '' });
        const day = dayKey(now), week = weekKey(now);
        const firstToday = rec.lastKillDay !== day;
        const firstEver = rec.kills === 0;
        rec.kills++; rec.lastKillDay = day; rec.lastKillWeek = week;
        s.stats.bossKills++;
        questEvent(s, { kind: 'boss', boss: bossId });
        const ps = playerStats(s);
        const mats = rollLoot(b.drops, rng, ps.luck);
        // a sigil is given once (one is enough to open the way), except where the boss says every kill drops one (sigilEvery)
        if (b.sigil && (b.sigilEvery || !count(s, b.sigil))) mats[b.sigil] = 1;
        giveAll(s, mats, false);
        let rubies = addRubies(s, firstToday ? b.rubiesFirst : rollRubies(b.rubies, rng, 1 + ps.rubies));
        let gems = 0, golden = 0, mythic = false;
        if (firstToday) {
            const g = grantGems(s, randInt(rng, b.gems[0], b.gems[1]), now, 'boss', ack);
            gems = g.gems; rubies += g.rubies;
            if (rng() < b.golden) { const gg = grantGolden(s, 1, now, 'boss', ack); golden = gg.golden; rubies += gg.rubies; }
        }
        if (b.mythicWeekly && rec.mythicWeek !== week) {
            rec.mythicWeek = week;
            Bridge.push(s, { boxes: [0, 0, 0, 0, 1], src: 'boss' }, ack, now);
            mythic = true;
        }
        // the next zone opens
        const next = nextZoneAfter(b.zone);
        if (next) s.unlocked.zones[next] = true;
        return { mats, rubies, gems, golden, mythic, firstToday, firstEver, unlocked: next || null };
    }
    // A rival adventurer was beaten
    function rivalLoot(s, zoneId, rng, now) {
        const rt = D.RIVAL_TIERS[zoneId];
        if (!rt) return null;
        const rec = s.rivals[zoneId] || (s.rivals[zoneId] = { defeats: 0, lastDay: '', respawnAt: 0 });
        const day = dayKey(now);
        const firstToday = rec.lastDay !== day;
        rec.defeats++; rec.lastDay = day; rec.respawnAt = now + D.RIVAL_RESPAWN_SEC * 1000;
        s.stats.rivalsBeaten++;
        questEvent(s, { kind: 'rival', zone: zoneId });
        const ps = playerStats(s);
        const rubies = addRubies(s, Math.round(rt.rubies * (firstToday ? 2 : 1) * (1 + ps.rubies)));
        let item = null;
        if (rng() < D.RIVAL_WEAPON_DROP * (1 + ps.luck) || (firstToday && rec.defeats === 1)) {
            const cls = D.RIVALS[rt.rival].cls;
            const base = D.GEAR_BY_ID[cls + '_' + rt.tier];
            if (base) {
                const sc = randInt(rng, 40, 85);
                item = addGear(s, base.id, sc, rollAffixes(base, sc, rng), now);
            }
        }
        return { rubies, item, firstToday };
    }

    // ---------------- the Arena ----------------
    // A match is about to start (its 'go'): the stake is paid now, and what losing would cost is noted in the save, so a page
    // closed mid-match counts it as lost (migrate). Returns false when the stake can't be paid.
    function arenaEscrow(s, m) {
        if (m.stake && s.rubies < m.stake) return false;
        s.rubies -= m.stake;
        const lose = Arena.outcome(Object.assign({}, m, { result: m.team === 'a' ? 'b' : 'a' }), s.arena.rating, s.arena.day.vs[Arena.vsKey(m)] || 0).ratingDelta;
        s.arena.live = { mid: m.id, stake: m.stake, delta: Math.min(0, lose), at: 0 };
        return true;
    }
    // A finished match: rating, record, Glory, the day's first-win rubies and the wager. Returns what it came to.
    function arenaResult(s, m, now) {
        const a = s.arena, day = Arena.refreshDay(a, dayKey(now)), key = Arena.vsKey(m);
        const o = Arena.outcome(m, a.rating, day.vs[key] || 0);
        day.vs[key] = (day.vs[key] || 0) + 1;
        a.live = null;
        a.rating = o.newRating; a.peak = Math.max(a.peak, a.rating);
        if (o.won) { a.w++; if (o.team) a.teamW++; } else if (o.lost) { a.l++; if (o.team) a.teamL++; } else a.d++;
        let glory = 0, rubies = 0;
        if (o.counts) {
            const myRounds = m.history.filter(h => h === m.team).length;
            glory = Arena.giveGlory(a, 'match', (o.won ? Arena.GLORY.win : Arena.GLORY.loss) + myRounds * Arena.GLORY.roundWin, dayKey(now));
            if (o.won && day.rubyWins < Arena.RULES.rubyWins) { day.rubyWins++; rubies = addRubies(s, Arena.RULES.rubyWin * furthestTier(s)); }
        }
        if (o.payout) s.rubies += o.payout; // the pot: rubies that were already the players', so not "earned" for the stat
        if (m.stake) { a.wagerNet += o.payout - m.stake; if (o.won) a.wagerWins++; }
        if (o.won) questEvent(s, { kind: 'arena' });
        return Object.assign(o, { glory, rubies });
    }
    // Knocked someone out in the Pit (their page told us), or got knocked out there
    function pitKO(s, now) { s.arena.pitKO++; s.stats.pvpWins++; questEvent(s, { kind: 'pitko' }); return Arena.giveGlory(s.arena, 'pit', Arena.GLORY.pitKO, dayKey(now)); }
    function pitDown(s) { s.arena.pitDown++; }
    // The Arena Master's shop (Glory). Returns { ok, reason?, item }
    // How many more of a Glory shop item can be bought this week (Infinity when it has no weekly limit)
    function arenaWeekLeft(s, id, now) {
        const it = Arena.SHOP_BY_ID[id];
        if (!it || !it.perWeek) return Infinity;
        const b = s.arena.bought, wk = weekKey(now);
        if (b.week !== wk) { b.week = wk; b.n = {}; }
        return Math.max(0, it.perWeek - (b.n[id] || 0));
    }
    // rng: for the Guild Chest's pick (the page passes Math.random)
    function arenaBuy(s, id, now, ack, rng) {
        const it = Arena.SHOP_BY_ID[id];
        if (!it) return { ok: false, reason: 'unknown' };
        const a = s.arena;
        if (it.title && a.titles[it.title]) return { ok: false, reason: 'owned' };
        if (it.weekly && a.coffer === weekKey(now)) return { ok: false, reason: 'week' };
        if (!arenaWeekLeft(s, id, now)) return { ok: false, reason: 'week' };
        if (it.coffer !== undefined && boxAllowanceLeft(s, now) < D.BOX_POINTS[it.coffer]) return { ok: false, reason: 'allowance' };
        // gems and Golden for the game still come out of today's caps, like the Trader's exchange
        if (it.gems && gemsLeftToday(s, now) < it.gems) return { ok: false, reason: 'cap' };
        if (it.golden && goldenLeftToday(s, now) < it.golden) return { ok: false, reason: 'cap' };
        if (a.glory < it.glory) return { ok: false, reason: 'glory' };
        a.glory -= it.glory;
        if (it.perWeek) a.bought.n[id] = (a.bought.n[id] || 0) + 1;
        const out = { ok: true, item: it };
        if (it.give) giveAll(s, it.give, true);
        if (it.title) { a.titles[it.title] = true; a.title = it.title; }
        if (it.coffer !== undefined) {
            a.coffer = weekKey(now);
            s.caps.boxPts += D.BOX_POINTS[it.coffer];
            const boxes = D.BOX_NAMES.map(() => 0); boxes[it.coffer] = 1;
            Bridge.push(s, { boxes, src: 'arena' }, ack, now);
        }
        if (it.rubies) out.rubies = addRubies(s, it.rubies);
        if (it.gems) out.gems = grantGems(s, it.gems, now, 'arena', ack).gems;
        if (it.golden) out.golden = grantGolden(s, it.golden, now, 'arena', ack).golden;
        if (it.pack) Bridge.push(s, { packs: { [it.pack]: 1 }, src: 'arena' }, ack, now);
        if (it.guild) {
            const r = typeof rng === 'function' ? rng() : 0;
            out.guild = Guilds.UPS[Math.min(Guilds.UPS.length - 1, Math.floor(Math.max(0, r) * Guilds.UPS.length))];
            out.owned = grantGuild(s, out.guild);
        }
        return out;
    }
    // A wave of the Proving Grounds was cleared with this player in it: rubies, Glory (inside today's cap, a one-time bonus
    // at waves 10, 20, 30 and 40), and their best wave. Returns { rubies, glory, milestone, best }
    function waveCleared(s, wave, now) {
        const a = s.arena, first = wave > a.waveBest;
        const r = Waves.rewardFor(wave, first);
        const rubies = addRubies(s, r.rubies);
        let glory = Arena.giveGlory(a, 'waves', r.glory, dayKey(now));
        if (r.bonusGlory) { a.glory += r.bonusGlory; a.gloryTotal += r.bonusGlory; glory += r.bonusGlory; }
        a.waveBest = Math.max(a.waveBest, wave);
        questEvent(s, { kind: 'wave' });
        return { rubies, glory, milestone: r.milestone, best: first };
    }
    function setTitle(s, title) {
        if (title && !Arena.titlesOf(s.arena).includes(title)) return false;
        s.arena.title = title || '';
        return true;
    }

    // ---------------- tournaments (core/world-tour.js) ----------------
    // Signing up: the fee is paid now, and noted, so it comes back if the tournament is called off
    function tourJoin(s, tour, now) {
        const a = s.arena;
        if (a.tours[tour.id]) return { ok: false, reason: 'joined' };
        if (Tour.status(tour, now) !== 'open') return { ok: false, reason: 'closed' };
        if (s.rubies < tour.fee) return { ok: false, reason: 'rubies' };
        s.rubies -= tour.fee;
        a.tours[tour.id] = { fee: tour.fee, st: 'in', t: now, paid: 0, place: 0 };
        return { ok: true };
    }
    // Withdrawing before it starts: the fee back. Returns the rubies given back.
    function tourLeave(s, tid) {
        const r = s.arena.tours[tid];
        if (!r || r.st !== 'in') return 0;
        s.rubies += r.fee;
        delete s.arena.tours[tid];
        return r.fee;
    }
    // A tournament this player signed up for, as the database has it now (tour: sanitized, or null when it is gone). Gives the
    // fee back when it was called off (or the player didn't make the bracket), and pays their prize once every place is
    // decided for good, once. -> { kind: 'off' | 'cut' | 'gone' | 'started' | 'paid', rubies, place } or null (nothing new)
    function tourSeen(s, tour, tid, uid, now) {
        const a = s.arena, r = a.tours[tid];
        if (!r || r.st === 'done') return null;
        const refund = (kind) => { s.rubies += r.fee; delete a.tours[tid]; return { kind, rubies: r.fee, place: 0 }; };
        // gone before it started (the host took it down): the fee back; gone later (deleted after keepDays): nothing known
        if (!tour) { if (r.st === 'in') return refund('off'); delete a.tours[tid]; return { kind: 'gone', rubies: 0, place: 0 }; }
        const st = Tour.status(tour, now);
        if (st === 'off') return refund('off');
        if (st === 'open' || st === 'starting') return null;
        if (!tour.seeds.includes(uid)) return refund('cut');
        if (r.st === 'in') { r.st = 'run'; a.tourPlayed++; if (st === 'run') return { kind: 'started', rubies: 0, place: 0 }; }
        if (st !== 'done') return null;
        const br = Tour.bracket(tour, now), pay = Tour.payouts(tour, br)[uid] || 0, place = Tour.placeOf(br, uid);
        r.st = 'done'; r.paid = pay; r.place = place;
        s.rubies += pay; // the pot: rubies that were already the players', like a wager's
        a.tourPrize += pay;
        if (place === 1) a.tourWins++;
        return { kind: 'paid', rubies: pay, place };
    }
    function tourPrune(s, now) { for (const tid in s.arena.tours) { const r = s.arena.tours[tid]; if (r.st === 'done' && Tour.expired(r.t, now)) delete s.arena.tours[tid]; } }

    // A tournament with gear locked to a tier: for its duels every player fights with the same kit. Their own kinds of weapons
    // (the hotbar's, at that tier), that tier's helmet, chest, boots and shield, all Common with no affixes, and no ring. Their
    // own gear is put aside (serialize still saves it, never the kit) until returnKit. Classes and perks stay their own.
    function kitWeapon(b, tier) {
        const id = b.cls === 'staff' ? b.magic + 'staff_' + tier : b.cls + '_' + tier;
        return D.GEAR_BY_ID[id] ? id : null;
    }
    function lendKit(s, tier) {
        if (s.lent) return false;
        const t = int(tier, D.MAX_TIER);
        if (t < 1) return false;
        const real = { gear: s.gear, equip: s.equip, hotbar: s.hotbar, sel: s.sel };
        const gear = [], score = Tour.TOUR.kitScore;
        let n = 0;
        const make = (id, uid) => { gear.push({ uid, base: id, score, aff: [], at: 0 }); return uid; };
        // the hotbar keeps its slots (and its weapons' ids, so the selection holds); the rest get ids no real gear has
        const hotbar = real.hotbar.map(u => { const it = findGear(s, u), b = baseOf(it), id = b && kitWeapon(b, t); return id ? make(id, u) : null; });
        if (!hotbar.some(Boolean)) hotbar[0] = make('sword_' + t, -(++n));
        const equip = { helmet: null, chest: null, boots: null, ring: null, offhand: null };
        for (const slot of ['helmet', 'chest', 'boots']) equip[slot] = make(slot + '_' + t, -(++n));
        equip.offhand = make('shield_' + t, -(++n));
        Object.defineProperty(s, 'lent', { value: real, enumerable: false, configurable: true, writable: true });
        s.gear = gear; s.equip = equip; s.hotbar = hotbar;
        if (!s.hotbar[s.sel]) s.sel = s.hotbar.findIndex(Boolean);
        return true;
    }
    function returnKit(s) {
        const r = s.lent;
        if (!r) return false;
        s.gear = r.gear; s.equip = r.equip; s.hotbar = r.hotbar; s.sel = r.sel;
        delete s.lent;
        return true;
    }

    function nextZoneAfter(zoneId) { const i = D.ZONE_ORDER.indexOf(zoneId); return i >= 0 ? D.ZONE_ORDER[i + 1] || null : null; }

    // ---------------- wards (the Far Reaches' sealed lairs) ----------------
    // A zone's boss lair opens once all its ward stones are broken. Waking a ward needs its zone's Ward Key, which is only
    // spent when the ward's guardian is beaten (dying or walking away keeps it).
    function wardCount(zoneId) { const z = D.ZONES[zoneId]; return z && z.wards ? z.wards : 0; }
    function wardBroken(s, zoneId, i) { return !!((s.seals[zoneId] || 0) & (1 << i)); }
    function wardsBroken(s, zoneId) { let n = 0; for (let i = 0; i < wardCount(zoneId); i++) if (wardBroken(s, zoneId, i)) n++; return n; }
    // Is this zone's lair open? (zones without wards always are)
    function lairOpen(s, zoneId) { return wardsBroken(s, zoneId) >= wardCount(zoneId); }
    // Can ward i of a zone be woken now? Returns { ok, reason? ('unknown' | 'broken' | 'key'), key }
    function wardState(s, zoneId, i) {
        const z = D.ZONES[zoneId];
        if (!z || !(i >= 0 && i < wardCount(zoneId))) return { ok: false, reason: 'unknown' };
        if (wardBroken(s, zoneId, i)) return { ok: false, reason: 'broken', key: z.wardKey };
        if (!count(s, z.wardKey)) return { ok: false, reason: 'key', key: z.wardKey };
        return { ok: true, key: z.wardKey };
    }
    // The guardian of ward i was beaten: the key is spent and the ward stays broken. Returns { ok, lairOpen, broken, of }
    function breakWard(s, zoneId, i) {
        const r = wardState(s, zoneId, i);
        if (!r.ok) return r;
        take(s, { [r.key]: 1 });
        s.seals[zoneId] = (s.seals[zoneId] || 0) | (1 << i);
        return { ok: true, lairOpen: lairOpen(s, zoneId), broken: wardsBroken(s, zoneId), of: wardCount(zoneId) };
    }
    // How much a potion heals someone with this much max health
    function potionHeal(id, maxHp) {
        const c = D.CONSUMABLES_BY_ID[id];
        return c ? Math.max(c.heal || 0, (c.healPct || 0) * (maxHp || 0)) : 0;
    }

    // ---------------- death ----------------
    // Part of every carried stack drops where you fell; you can pick it up once. A new death replaces the old bag.
    function die(s, zone, x, y, now) {
        const drop = {};
        for (const id in s.bag) {
            const n = Math.floor(s.bag[id] * D.RULES.graveShare);
            if (!n) continue;
            drop[id] = n;
            s.bag[id] -= n;
            if (!s.bag[id]) delete s.bag[id];
        }
        s.grave = Object.keys(drop).length ? { zone, x, y, mats: drop, at: now } : null;
        s.stats.deaths++;
        s.hp = playerStats(s).maxHp;
        s.zone = 'town';
        s.pos = null;
        return drop;
    }
    function recoverGrave(s) {
        const g = s.grave;
        if (!g) return null;
        giveAll(s, g.mats, false);
        s.grave = null;
        return g.mats;
    }

    // ---------------- trader ----------------
    function sell(s, id, n) {
        const m = D.MATERIALS_BY_ID[id];
        if (!m || !m.sell) return 0;
        n = Math.min(int(n), count(s, id));
        if (!n || !take(s, { [id]: n })) return 0;
        const r = m.sell * n;
        s.rubies += r; // selling isn't "earning" for the stat
        return r;
    }
    function buy(s, stockId, now) {
        const it = D.TRADER_STOCK.find(x => x.id === stockId);
        if (!it) return { ok: false, reason: 'unknown' };
        if (s.rubies < it.price) return { ok: false, reason: 'rubies', need: it.price - s.rubies };
        if (it.gear && s.gear.length >= D.RULES.maxGear) return { ok: false, reason: 'full' };
        s.rubies -= it.price;
        if (it.gear) return { ok: true, item: addGear(s, it.gear, 30, [], now) };
        giveAll(s, it.give, true);
        return { ok: true };
    }
    // Weekly exchanges: rubies for gems or Golden (still within the daily caps)
    function exchange(s, kind, now, ack) {
        refreshCaps(s, now);
        const ex = D.CAPS.exchange[kind];
        if (!ex) return { ok: false, reason: 'unknown' };
        const usedKey = kind === 'gems' ? 'exGems' : 'exGolden';
        if (s.caps[usedKey]) return { ok: false, reason: 'week' };
        if (s.rubies < ex.cost) return { ok: false, reason: 'rubies', need: ex.cost - s.rubies };
        if (kind === 'gems' && gemsLeftToday(s, now) < ex.gems) return { ok: false, reason: 'cap' };
        if (kind === 'golden' && goldenLeftToday(s, now) < ex.golden) return { ok: false, reason: 'cap' };
        s.rubies -= ex.cost;
        s.caps[usedKey] = 1;
        if (kind === 'gems') grantGems(s, ex.gems, now, 'trade', ack);
        else grantGolden(s, ex.golden, now, 'trade', ack);
        return { ok: true };
    }

    // ---------------- classes and abilities ----------------
    // How far along a class's unlock challenge is: { have, need, done }
    function classProgress(s, id) {
        const u = D.CLASSES[id] && D.CLASSES[id].unlock;
        if (!u) return { have: 1, need: 1, done: true };
        if (u.boss) { const k = s.bosses[u.boss] && s.bosses[u.boss].kills > 0 ? 1 : 0; return { have: k, need: 1, done: !!k }; }
        const have = Math.min(u.n, int(s.stats[u.stat]));
        return { have, need: u.n, done: have >= u.n };
    }
    function classState(s, id) {
        const c = D.CLASSES[id];
        if (!c) return { ok: false, reason: 'unknown' };
        if (s.classes.unlocked[id]) return { ok: false, reason: 'known' };
        const progress = classProgress(s, id);
        if (!progress.done) return { ok: false, reason: 'req', progress };
        if (s.rubies < c.cost) return { ok: false, reason: 'rubies', need: c.cost - s.rubies };
        return { ok: true };
    }
    function unlockClass(s, id) {
        const r = classState(s, id);
        if (!r.ok) return r;
        s.rubies -= D.CLASSES[id].cost;
        s.classes.unlocked[id] = true;
        return { ok: true };
    }
    function setClass(s, id) {
        if (!s.classes.unlocked[id]) return false;
        s.classes.active = id;
        return true;
    }
    // Skills (abilities and perks) come from the class's tree
    function skillDef(id) { return D.ABILITIES[id] || D.PERKS[id] || null; }
    // Learning needs the skill's class unlocked, the skill above it in its branch, its boss beaten (if any) and the rubies.
    function skillState(s, id) {
        const sk = skillDef(id);
        if (!sk) return { ok: false, reason: 'unknown' };
        if (s.skills.learned[id]) return { ok: false, reason: 'known' };
        if (!s.classes.unlocked[sk.cls]) return { ok: false, reason: 'class' };
        if (sk.req && !s.skills.learned[sk.req]) return { ok: false, reason: 'req', need: sk.req };
        if (sk.boss && !(s.bosses[sk.boss] && s.bosses[sk.boss].kills > 0)) return { ok: false, reason: 'boss' };
        if (s.rubies < sk.cost) return { ok: false, reason: 'rubies', need: sk.cost - s.rubies };
        return { ok: true };
    }
    // A new ability goes onto a free key of its class's loadout, if there is one (slot: which, or -1)
    function learnSkill(s, id) {
        const r = skillState(s, id);
        if (!r.ok) return r;
        const sk = skillDef(id);
        s.rubies -= sk.cost;
        s.skills.learned[id] = true;
        let slot = -1;
        if (sk.type === 'ability') { const lo = loadoutOf(s, sk.cls); slot = lo.indexOf(null); if (slot >= 0) lo[slot] = id; }
        return { ok: true, slot };
    }
    // Each class keeps its own R / Q / C loadout, so switching class brings it back
    function loadoutOf(s, cls) {
        if (!Array.isArray(s.classes.loadout[cls])) s.classes.loadout[cls] = D.ABILITY_KEYS.map(() => null);
        return s.classes.loadout[cls];
    }
    // Put a learned ability on a key (slot 0..2) of its class's loadout. Already on another key: the two swap.
    // fresh: it wasn't on any key before.
    function equipAbility(s, id, slot) {
        const a = D.ABILITIES[id];
        if (!a || !s.skills.learned[id] || !(slot >= 0 && slot < D.ABILITY_KEYS.length)) return { ok: false };
        const lo = loadoutOf(s, a.cls);
        const was = lo.indexOf(id);
        if (was >= 0) lo[was] = lo[slot];
        lo[slot] = id;
        return { ok: true, fresh: was < 0 };
    }
    function unequipAbility(s, cls, slot) {
        const lo = s.classes.loadout[cls];
        if (!lo || !lo[slot]) return false;
        lo[slot] = null;
        return true;
    }
    // What R, Q and C cast right now: the active class's loadout, null for an empty key
    function abilityKit(s) {
        const lo = s.classes.loadout[classId(s)];
        return D.ABILITY_KEYS.map((_, i) => (lo && lo[i]) || null);
    }

    // ---------------- the Hall of Gods ----------------
    // Statues go up one level at a time for rubies and materials (core/world-gods.js costFor). Returns { ok, reason?, level, cost? }
    function godState(s, id) {
        if (!Gods.GODS[id]) return { ok: false, reason: 'unknown' };
        if (Gods.GODS[id].hidden && !s.secrets.hallDoor) return { ok: false, reason: 'hidden' };
        const level = s.gods[id] || 0;
        if (level >= Gods.LEVEL_CAP) return { ok: false, reason: 'max', level }; // only a damaged save gets here: there is no top level
        const cost = Gods.costFor(id, level + 1);
        if (s.rubies < cost.rubies) return { ok: false, reason: 'rubies', level, cost };
        if (!has(s, cost.mats)) return { ok: false, reason: 'materials', level, cost };
        return { ok: true, level, cost };
    }
    function upgradeGod(s, id) {
        const r = godState(s, id);
        if (!r.ok) return r;
        take(s, r.cost.mats);
        s.rubies -= r.cost.rubies;
        s.gods[id] = r.level + 1;
        questEvent(s, { kind: 'god', god: id });
        return { ok: true, level: r.level + 1 };
    }

    // ---------------- the Hall's secret ----------------
    // The far wall opens when the Prophet's faith is spoken inside the Hall. The word itself isn't written here, so reading
    // the code doesn't give it away: only its hash (hashStr below); tests/world-secret.test.js checks it.
    const HALL_WORD = 2132288841;
    function isHallWord(text) { return (String(text || '').toLowerCase().match(/[a-z]+/g) || []).some(w => hashStr(w) === HALL_WORD); }
    // Something said out loud. Returns { opened: true } when it opened the Hall's far wall just now.
    function speak(s, zoneId, text) {
        if (zoneId !== 'hall' || s.secrets.hallDoor || !isHallWord(text)) return { opened: false };
        s.secrets.hallDoor = true;
        return { opened: true };
    }
    // The hidden room's one-time purchases. balance: the game's gems and Golden (Bridge.mainBalance), which pay their part
    // in the game. Returns { ok, reason?, cost }.
    function hiddenCost(id) {
        const it = D.HIDDEN_SHOP[id], buy = Bridge.BUYS[id];
        return it && buy ? { rubies: it.rubies, mats: it.mats, gems: buy.gems, golden: buy.golden } : null;
    }
    function hiddenShopState(s, id, balance) {
        const cost = hiddenCost(id);
        if (!cost) return { ok: false, reason: 'unknown' };
        if (!s.secrets.hallDoor) return { ok: false, reason: 'hidden', cost };
        if (s.secrets[id]) return { ok: false, reason: 'owned', cost };
        if (s.rubies < cost.rubies) return { ok: false, reason: 'rubies', cost };
        if (!has(s, cost.mats)) return { ok: false, reason: 'materials', cost };
        const b = balance || { gems: 0, golden: 0 };
        if (b.gems < cost.gems) return { ok: false, reason: 'gems', cost };
        if (b.golden < cost.golden) return { ok: false, reason: 'golden', cost };
        return { ok: true, cost };
    }
    // Pays the rubies and materials here and tells the game (outbox { buy }), which takes the gems and Golden and adds the item
    function buyHidden(s, id, balance, ack, now) {
        const r = hiddenShopState(s, id, balance);
        if (!r.ok) return r;
        take(s, r.cost.mats);
        s.rubies -= r.cost.rubies;
        s.secrets[id] = true;
        Bridge.push(s, { buy: id, src: 'hidden' }, ack, now);
        return { ok: true, cost: r.cost };
    }

    // ---------------- quests ----------------
    function questRec(s, npcId) { return s.quests[npcId] || (s.quests[npcId] = { step: 0, active: null, dailyDone: '' }); }
    function needMet(s, need) { return !need || !need.zone || !!s.unlocked.zones[need.zone]; }
    function furthestTier(s) { let t = 1; for (const z of D.ZONE_ORDER) if (s.unlocked.zones[z]) t = Math.max(t, D.ZONES[z].tier); return t; }
    // what a quest pays: daily quests grow with the furthest zone you have opened
    function questRubies(s, q) { return q.daily ? q.rubies * furthestTier(s) : q.rubies; }
    function hashStr(str) { let h = 2166136261 >>> 0; for (let i = 0; i < str.length; i++) { h ^= str.charCodeAt(i); h = Math.imul(h, 16777619) >>> 0; } return h; }
    // An NPC's daily quest: the same one all day, picked from those whose zone is open
    function dailyFor(s, npcId, now) {
        const open = D.NPCS[npcId].daily.filter(id => needMet(s, D.QUESTS[id].need));
        return open.length ? open[hashStr(dayKey(now) + ':' + npcId) % open.length] : null;
    }
    // What an NPC has for you now: { id, quest, rubies, active?, progress?, locked? (its need), daily? } or { doneToday }
    function questOffer(s, npcId, now) {
        const npc = D.NPCS[npcId];
        if (!npc) return null;
        const rec = s.quests[npcId] || { step: 0, active: null, dailyDone: '' };
        if (rec.active) {
            const q = D.QUESTS[rec.active.id];
            return { id: q.id, quest: q, rubies: questRubies(s, q), active: true, daily: !!q.daily, progress: questProgress(s, npcId) };
        }
        if (rec.step < npc.chain.length) {
            const q = D.QUESTS[npc.chain[rec.step]];
            return { id: q.id, quest: q, rubies: questRubies(s, q), locked: needMet(s, q.need) ? null : q.need };
        }
        const id = rec.dailyDone === dayKey(now) ? null : dailyFor(s, npcId, now);
        return id ? { id, quest: D.QUESTS[id], rubies: questRubies(s, D.QUESTS[id]), daily: true } : { doneToday: true };
    }
    // How far an NPC's accepted quest is: { have, need, done } (deliveries count what you carry)
    function questProgress(s, npcId) {
        const rec = s.quests[npcId];
        if (!rec || !rec.active) return null;
        const g = D.QUESTS[rec.active.id].goal;
        if (g.kind === 'deliver') {
            let have = 0, need = 0;
            for (const id in g.mats) { need += g.mats[id]; have += Math.min(g.mats[id], count(s, id)); }
            return { have, need, done: has(s, g.mats) };
        }
        if (g.kind === 'ward') { const need = g.n || 1, have = Math.min(need, wardsBroken(s, g.zone)); return { have, need, done: have >= need }; }
        // something done in the game: counted from what it saved, so it is never missed and can't be farmed here
        if (g.kind === 'clicker') { const need = g.n || 1, have = Math.min(need, Math.floor(Crew.goalHave(g, clickerView))); return { have, need, done: have >= need }; }
        const need = g.n || 1, have = Math.min(need, rec.active.prog);
        return { have, need, done: have >= need };
    }
    function acceptQuest(s, npcId, now) {
        if (D.NPCS[npcId] && D.NPCS[npcId].crew && !Crew.arrived(npcId, clickerView)) return { ok: false, reason: 'away' };
        const o = questOffer(s, npcId, now);
        if (!o || o.doneToday) return { ok: false, reason: 'none' };
        if (o.active) return { ok: false, reason: 'active' };
        if (o.locked) return { ok: false, reason: 'locked' };
        // a daily remembers the day it was for, so finishing it after midnight doesn't use up the next day's
        questRec(s, npcId).active = o.daily ? { id: o.id, prog: 0, day: dayKey(now) } : { id: o.id, prog: 0 };
        return { ok: true, id: o.id };
    }
    // Hand a finished quest in: deliveries are taken, the rubies (and any potions) paid, and the NPC moves on. A crew
    // story quest's `clicker` consumables go to the game through the outbox (ack: what the game already applied).
    function turnInQuest(s, npcId, now, ack) {
        const rec = s.quests[npcId];
        if (!rec || !rec.active) return { ok: false, reason: 'none' };
        const q = D.QUESTS[rec.active.id];
        if (!questProgress(s, npcId).done) return { ok: false, reason: 'unfinished' };
        if (q.goal.kind === 'deliver' && !take(s, q.goal.mats)) return { ok: false, reason: 'materials' };
        const rubies = addRubies(s, questRubies(s, q));
        if (q.cons) for (const id in q.cons) s.cons[id] = (s.cons[id] || 0) + q.cons[id];
        const story = !q.daily && D.NPCS[npcId].chain[rec.step] === q.id;
        let clicker = null;
        if (q.clicker && story) {
            clicker = Bridge.cleanItems(q.clicker, Bridge.LIMITS.item);
            if (Object.keys(clicker).length) Bridge.push(s, { items: clicker, src: 'crew' }, ack, now);
            else clicker = null;
        }
        if (q.daily) rec.dailyDone = rec.active.day || dayKey(now);
        else if (story) rec.step++;
        rec.active = null;
        s.stats.questsDone++;
        const out = { ok: true, id: q.id, rubies, cons: q.cons || null };
        if (clicker) out.clicker = clicker; // consumables sent to the game
        return out;
    }
    function abandonQuest(s, npcId) {
        const rec = s.quests[npcId];
        if (!rec || !rec.active) return false;
        rec.active = null;
        return true;
    }
    function goalMatches(g, ev) {
        if (g.kind !== ev.kind) return false;
        if (g.monster && g.monster !== ev.monster) return false;
        if (g.elite && !ev.elite) return false;
        if (g.zone && g.zone !== ev.zone) return false;
        if (g.boss && g.boss !== ev.boss) return false;
        if (g.tool && g.tool !== ev.tool) return false;
        if (g.minScore && !(ev.score >= g.minScore)) return false;
        if (g.tier && ev.tier !== g.tier) return false;
        return true;
    }
    // Something quests may count happened (a kill, a harvest, a craft...). ev: { kind, monster, elite, zone, boss, tool, score }.
    // Only accepted quests count. Returns true when any progress was made.
    function questEvent(s, ev) {
        let changed = false;
        for (const npcId in s.quests) {
            const a = s.quests[npcId].active;
            if (!a) continue;
            const g = D.QUESTS[a.id].goal;
            if (g.kind === 'deliver' || g.kind === 'ward' || g.kind === 'clicker' || a.prog >= (g.n || 1) || !goalMatches(g, ev)) continue;
            a.prog++;
            changed = true;
        }
        // the hero guild contract being worked on (core/world-guilds.js)
        const gc = s.guilds && s.guilds.contract;
        if (gc) {
            const g = Guilds.contractOf(gc.up).goal;
            if (gc.prog < (g.n || 1) && goalMatches(g, ev)) { gc.prog++; changed = true; }
        }
        return changed;
    }
    // Every accepted quest, for the tracker: [{ npc, id, quest, progress }]
    function activeQuests(s) {
        const out = D.NPC_ORDER.filter(n => s.quests[n] && s.quests[n].active)
            .map(n => ({ npc: n, id: s.quests[n].active.id, quest: D.QUESTS[s.quests[n].active.id], progress: questProgress(s, n) }));
        // a hero guild contract shows in the tracker too
        const gc = s.guilds && s.guilds.contract;
        if (gc) out.push({ npc: 'guildmaster', id: 'guild:' + gc.up, quest: Guilds.contractOf(gc.up), progress: guildContractProgress(s), guild: gc.up });
        return out;
    }

    // ---------------- the crew from the game (core/world-crew.js) ----------------
    function crewHere(id) { return Crew.arrived(id, clickerView); }
    // Crew who have come to Wildgate since the last time this was asked: marks them greeted (the page says hello once)
    function greetCrew(s) {
        const out = [];
        for (const c of Crew.CREW) if (crewHere(c.id) && !s.crew.seen[c.id]) { s.crew.seen[c.id] = true; out.push(c.id); }
        return out;
    }
    // today's per-day counts for shops or trades (a new day starts them over)
    function crewDay(s, kind, now) {
        const rec = s.crew[kind], d = dayKey(now);
        if (rec.day !== d) { rec.day = d; rec.used = {}; }
        return rec;
    }
    // A crew shop: [{ ...stock, left, locked (a zone that isn't open yet) }], or null when they have no shop or aren't here
    function crewShop(s, crewId, now) {
        const list = Crew.SHOPS[crewId];
        if (!list || !crewHere(crewId)) return null;
        const rec = crewDay(s, 'shop', now);
        return list.map(it => Object.assign({}, it, { left: Math.max(0, it.limit - (rec.used[it.id] || 0)), locked: it.need && !s.unlocked.zones[it.need] ? it.need : null }));
    }
    function crewBuy(s, crewId, stockId, now) {
        const list = crewShop(s, crewId, now);
        if (!list) return { ok: false, reason: 'away' };
        const it = list.find(x => x.id === stockId);
        if (!it) return { ok: false, reason: 'unknown' };
        if (it.locked) return { ok: false, reason: 'locked' };
        if (!it.left) return { ok: false, reason: 'soldout' };
        if (s.rubies < it.price) return { ok: false, reason: 'rubies', need: it.price - s.rubies };
        s.rubies -= it.price;
        giveAll(s, it.give, true);
        const rec = s.crew.shop;
        rec.used[it.id] = (rec.used[it.id] || 0) + 1;
        return { ok: true, give: it.give };
    }
    // ez villager's Trading Hall: [{ ...trade, left, locked, can (you have what it takes) }]
    function crewTrades(s, crewId, now) {
        const list = Crew.TRADES[crewId];
        if (!list || !crewHere(crewId)) return null;
        const rec = crewDay(s, 'trade', now);
        return list.map(t => Object.assign({}, t, { left: Math.max(0, t.limit - (rec.used[t.id] || 0)), locked: t.need && !s.unlocked.zones[t.need] ? t.need : null, can: has(s, t.give) }));
    }
    function crewTrade(s, crewId, tradeId, now) {
        const list = crewTrades(s, crewId, now);
        if (!list) return { ok: false, reason: 'away' };
        const t = list.find(x => x.id === tradeId);
        if (!t) return { ok: false, reason: 'unknown' };
        if (t.locked) return { ok: false, reason: 'locked' };
        if (!t.left) return { ok: false, reason: 'soldout' };
        if (!take(s, t.give)) return { ok: false, reason: 'materials' };
        giveAll(s, t.get, true);
        const rec = s.crew.trade;
        rec.used[t.id] = (rec.used[t.id] || 0) + 1;
        return { ok: true, get: t.get };
    }

    // ---------------- Renown (core/renown.js): the Wilds half of each milestone ----------------
    // The level comes from the clicker view (the page works it out from both games and puts it there)
    function renownClaimable(s) { return Renown.claimable(clickerView.renown, s.renown.claimed); }
    // ---------------- potions in arena matches, the Pit and the waves ----------------
    // key: which limited fight you are in (a match, a stay in the Pit, a wave run), or null for none. tracker: { key, used },
    // kept by the page for the fight in progress. Returns how many potions you may still drink there.
    function potionsLeft(tracker, key) {
        if (!key) return Infinity;
        return tracker && tracker.key === key ? Math.max(0, D.RULES.potionsPerMatch - tracker.used) : D.RULES.potionsPerMatch;
    }
    // one potion drunk in that fight: the tracker to keep (a new fight starts the count again)
    function notePotion(tracker, key) {
        if (!key) return tracker || null;
        if (!tracker || tracker.key !== key) return { key, used: 1 };
        return { key, used: tracker.used + 1 };
    }

    // ---------------- hero guilds (core/world-guilds.js): the Guildmaster by the Rune Altar ----------------
    // this stock's "bought" list, started over when the stock changes
    function guildSold(s, now) {
        const period = Guilds.periodOf(now);
        if (s.guilds.sold.period !== period) s.guilds.sold = { period, ups: {} };
        return s.guilds.sold;
    }
    function guildContractProgress(s) {
        const gc = s.guilds.contract;
        if (!gc) return null;
        const need = Guilds.contractOf(gc.up).goal.n || 1, have = Math.min(need, gc.prog);
        return { have, need, done: have >= need };
    }
    // What the Guildmaster has now: { period, restockAt, items: [{ up, guild, price, contract, sold, mine (your contract),
    // progress, locked (a zone that must be open first), owned }], contract (yours, which may be from an earlier stock) }
    function guildStock(s, now) {
        const period = Guilds.periodOf(now), sold = guildSold(s, now), gc = s.guilds.contract;
        const items = Guilds.stockFor(period).map(up => {
            const contract = Guilds.contractOf(up);
            return { up, guild: Guilds.BY_UP[up], price: Guilds.priceOf(up), contract, sold: !!sold.ups[up], mine: !!gc && gc.up === up,
                progress: gc && gc.up === up ? guildContractProgress(s) : null, locked: needMet(s, contract.need) ? null : contract.need, owned: s.guilds.owned[up] || 0 };
        });
        return { period, restockAt: Guilds.nextRestockAt(now), items, contract: gc ? { up: gc.up, guild: Guilds.BY_UP[gc.up], contract: Guilds.contractOf(gc.up), progress: guildContractProgress(s), price: Guilds.priceOf(gc.up) } : null };
    }
    // Take a guild's contract: it has to be in stock (not sold out this stock), its zone open, and no other contract on
    function takeGuildContract(s, up, now) {
        if (!Guilds.BY_UP[up]) return { ok: false, reason: 'unknown' };
        if (s.guilds.contract) return { ok: false, reason: 'busy' };
        if (!Guilds.stockFor(Guilds.periodOf(now)).includes(up)) return { ok: false, reason: 'stock' };
        if (guildSold(s, now).ups[up]) return { ok: false, reason: 'soldout' };
        if (!needMet(s, Guilds.contractOf(up).need)) return { ok: false, reason: 'locked' };
        s.guilds.contract = { up, prog: 0 };
        return { ok: true, up };
    }
    function dropGuildContract(s) {
        if (!s.guilds.contract) return false;
        s.guilds.contract = null;
        return true;
    }
    // Buy the guild whose contract is done. The contract stays yours even if the stock changed since you took it; buying
    // sells that guild out until the next stock.
    function buyGuild(s, up, now) {
        const gc = s.guilds.contract;
        if (!gc || gc.up !== up) return { ok: false, reason: 'contract' };
        if (!guildContractProgress(s).done) return { ok: false, reason: 'unfinished' };
        const price = Guilds.priceOf(up);
        if (s.rubies < price.rubies) return { ok: false, reason: 'rubies', need: price.rubies - s.rubies };
        if (!has(s, price.mats)) return { ok: false, reason: 'materials' };
        take(s, price.mats);
        s.rubies -= price.rubies;
        s.guilds.contract = null;
        guildSold(s, now).ups[up] = true;
        return { ok: true, up, owned: grantGuild(s, up) };
    }
    // one more of a guild (bought, or from a Guild Chest). Returns how many you own now.
    function grantGuild(s, up) {
        s.guilds.owned[up] = Math.min(Guilds.OWN_MAX, (s.guilds.owned[up] || 0) + 1);
        s.stats.guildsGot = (s.stats.guildsGot || 0) + 1;
        return s.guilds.owned[up];
    }

    function claimRenown(s, level) {
        const m = Renown.MILESTONE_BY_LEVEL[level];
        if (!m) return { ok: false, reason: 'unknown' };
        if (clickerView.renown < level) return { ok: false, reason: 'level' };
        if (s.renown.claimed.includes(level)) return { ok: false, reason: 'claimed' };
        s.renown.claimed = Renown.cleanClaimed(s.renown.claimed.concat([level]));
        const rubies = addRubies(s, m.wilds.rubies);
        if (m.wilds.cons) for (const id in m.wilds.cons) give(s, id, m.wilds.cons[id], true);
        return { ok: true, rubies, cons: m.wilds.cons || null };
    }

    // ---------------- nodes ----------------
    // Long respawn timers are saved, so reloading the page can't reset an ore vein
    function noteNode(s, key, respawnSec, now) {
        if (respawnSec >= D.SAVED_RESPAWN_SEC) s.nodes[key] = now + respawnSec * 1000;
    }
    function nodeReadyAt(s, key) { return s.nodes[key] || 0; }
    function pruneNodes(s, now) { for (const k in s.nodes) if (s.nodes[k] <= now) delete s.nodes[k]; }

    // The string that goes into localStorage. ack: what the game already applied (those entries are dropped).
    function serialize(s, now, ack) {
        s.savedAt = now;
        pruneNodes(s, now);
        Bridge.prune(s, ack, now);
        // during a tournament duel with a lent kit (lendKit), the save keeps the player's own gear, never the kit
        return JSON.stringify(s.lent ? Object.assign({}, s, s.lent) : s);
    }

    return {
        WORLD_VERSION, SLOTS, dayKey, weekKey, freshState, migrate, validate,
        count, has, missing, take, give, giveAll, bank, addRubies,
        tourJoin, tourLeave, tourSeen, tourPrune, lendKit, returnKit,
        qualityOf, qualityMult, rollAffixes, addGear, findGear, baseOf, gearStats, gearName, gearCount, playerStats, materialSources,
        equip, unequip, isEquipped, salvage, toolPower,
        recipeFor, craftBasic, canCraft, beginCraft, beginReforge, abortCraft, finishCraft, boxTierShift, boxAllowanceLeft,
        refreshCaps, gemsLeftToday, goldenLeftToday, grantGems, grantGolden,
        rollLoot, rollRubies, monsterLoot, nodeLoot, bossLoot, rivalLoot, die, recoverGrave, nextZoneAfter,
        wardCount, wardBroken, wardsBroken, lairOpen, wardState, breakWard, potionHeal,
        arenaEscrow, arenaResult, pitKO, pitDown, arenaBuy, arenaWeekLeft, setTitle, waveCleared,
        sell, buy, exchange, classId, classOf, classProgress, classState, unlockClass, setClass, skillDef, skillState, learnSkill, loadoutOf, equipAbility, unequipAbility, abilityKit, treeOrder,
        godState, upgradeGod, isHallWord, speak, hiddenShopState, buyHidden, questOffer, questProgress, acceptQuest, turnInQuest, abandonQuest, questEvent, activeQuests, furthestTier, noteNode, nodeReadyAt, pruneNodes, serialize,
        setClickerView, getClickerView, crewHere, greetCrew, crewShop, crewBuy, crewTrades, crewTrade, renownClaimable, claimRenown,
        guildStock, takeGuildContract, dropGuildContract, guildContractProgress, buyGuild, grantGuild, potionsLeft, notePotion,
    };
}));
