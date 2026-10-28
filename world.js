/**
 * The Wilds (world.html): page wiring. Loads and saves the adventure (localStorage 'whathappened_world', written only
 * by this page), keeps a single tab playing, loads zones and their monsters, runs each simulation step, handles
 * interactions (stations, gates, gathering by hand, the dropped bag) and turns the player's actions into save changes.
 * Rewards for the main game go into the save's outbox (core/world-bridge.js); the game applies them when opened.
 */
(function () {
    'use strict';
    const D = window.WHWorldData, W = window.WHWorld, C = window.WHWorldCombat, G = window.WHWorldGen, Bridge = window.WHWorldBridge, O = window.WHWorldOnline;
    const WHW = window.WHW;
    const E = WHW.engine, A = WHW.actors;
    const KEY = Bridge.WORLD_KEY;
    const SETTINGS_KEY = 'whathappened_world_settings';
    const DAMAGED_KEY = 'whathappened_world_damaged';
    const TAB_ID = Math.random().toString(36).slice(2, 10);
    const TILE = D.TILE;
    const now = () => Date.now();
    const dist = (a, b) => Math.hypot(a.x - b.x, a.y - b.y);
    const esc = (s) => WHW.ui.esc(s);

    // ---------------- settings (this device only) ----------------
    WHW.settings = Object.assign({ assist: false, dmgNumbers: true, shake: true, volume: 0.8, online: true }, (() => { try { return JSON.parse(localStorage.getItem(SETTINGS_KEY) || '{}'); } catch (e) { return {}; } })());
    WHW.saveSettings = () => { try { localStorage.setItem(SETTINGS_KEY, JSON.stringify(WHW.settings)); } catch (e) {} };
    function mainSave() { try { return JSON.parse(localStorage.getItem('whathappened_save') || localStorage.getItem('whathappened_save_v1') || '{}') || {}; } catch (e) { return {}; } }
    // the player's equipped skin from the main game, as the small thumbnail (same rule as main.js thumbFor)
    function faceFromSkin() {
        const p = String(mainSave().equippedShopImage || 'mainimage/whathappened.jpeg');
        const m = p.match(/^(mainimage)\/([^/]+)\.(png|jpe?g|webp)$/i);
        if (m && !/^(whathappened|mainbg|gem|shop|lbicon|wheel|divineargonian|divinesimplevillager)$/.test(m[2])) return `${m[1]}/thumbs/${m[2]}.webp`;
        return /^mainimage\//.test(p) ? p : 'mainimage/whathappened.jpeg';
    }

    // ---------------- sound (synthesized; follows the game's sound settings) ----------------
    const SOUNDS = {
        hit: [[180, 0, 0.08, 'square'], [110, 0.01, 0.1, 'triangle']],
        perfect: [[660, 0, 0.08, 'triangle'], [990, 0.05, 0.16, 'triangle']],
        tink: [[2200, 0, 0.05, 'triangle']],
        mine: [[900, 0, 0.05, 'square'], [1400, 0.02, 0.06, 'triangle']],
        chop: [[220, 0, 0.07, 'square'], [160, 0.03, 0.08, 'triangle']],
        crack: [[1200, 0, 0.06, 'triangle'], [1800, 0.04, 0.1, 'triangle']],
        gather: [[523, 0, 0.08, 'triangle'], [784, 0.06, 0.12, 'triangle']],
        hurt: [[200, 0, 0.12, 'sawtooth'], [140, 0.05, 0.12, 'triangle']],
        kill: [[392, 0, 0.08, 'triangle'], [262, 0.06, 0.14, 'triangle']],
        boss: [[392, 0, 0.12, 'triangle'], [523, 0.1, 0.12, 'triangle'], [659, 0.2, 0.12, 'triangle'], [784, 0.3, 0.4, 'triangle']],
        dash: [[600, 0, 0.06, 'sine'], [300, 0.03, 0.08, 'sine']],
        bow: [[300, 0, 0.05, 'triangle'], [700, 0.02, 0.07, 'sine']],
        slam: [[90, 0, 0.18, 'square'], [60, 0.04, 0.2, 'triangle']],
        swoosh: [[400, 0, 0.06, 'sine'], [250, 0.03, 0.06, 'sine']],
        clash: [[1500, 0, 0.08, 'square'], [2400, 0.02, 0.12, 'triangle']],
        craft: [[523, 0, 0.1, 'triangle'], [659, 0.08, 0.1, 'triangle'], [784, 0.16, 0.25, 'triangle']],
        quench: [[3000, 0, 0.25, 'sawtooth']],
        rune: [[880, 0, 0.1, 'sine'], [1320, 0.05, 0.14, 'sine']],
        gem: [[1568, 0, 0.18], [2093, 0.07, 0.28], [3136, 0.14, 0.4, 'triangle']],
        drink: [[440, 0, 0.08, 'sine'], [550, 0.06, 0.08, 'sine'], [660, 0.12, 0.1, 'sine']],
        block: [[160, 0, 0.09, 'square'], [520, 0.01, 0.08, 'triangle']],
        parry: [[1760, 0, 0.08, 'triangle'], [2640, 0.04, 0.2, 'triangle'], [880, 0, 0.1, 'square']],
    };
    let actx = null;
    const ms = mainSave();
    const sfxBase = typeof ms.sfxVolume === 'number' ? ms.sfxVolume : 0.8;
    const sfxMuted = !!ms.sfxMuted;
    const lastSfx = {};
    WHW.sfx = function (kind) {
        try {
            if (sfxMuted) return;
            const vol = sfxBase * WHW.settings.volume * 0.18;
            const notes = SOUNDS[kind];
            if (!notes || vol <= 0) return;
            const t = performance.now();
            if (lastSfx[kind] && t - lastSfx[kind] < 45) return;
            lastSfx[kind] = t;
            if (!actx) { const AC = window.AudioContext || window.webkitAudioContext; if (!AC) return; actx = new AC(); }
            if (actx.state === 'suspended') actx.resume().catch(() => {});
            const t0 = actx.currentTime + 0.005;
            const master = actx.createGain();
            master.gain.value = vol;
            master.connect(actx.destination);
            notes.forEach(([f, at, len, type]) => {
                const o = actx.createOscillator(), g = actx.createGain();
                o.type = type || 'sine';
                o.frequency.setValueAtTime(f, t0 + at);
                const peak = o.type === 'square' || o.type === 'sawtooth' ? 0.35 : 1;
                g.gain.setValueAtTime(0.0001, t0 + at);
                g.gain.exponentialRampToValueAtTime(peak, t0 + at + 0.01);
                g.gain.exponentialRampToValueAtTime(0.0001, t0 + at + len);
                o.connect(g); g.connect(master);
                o.start(t0 + at); o.stop(t0 + at + len + 0.05);
            });
        } catch (e) {}
    };

    // ---------------- load / save ----------------
    function loadState() {
        let raw = null;
        try { raw = localStorage.getItem(KEY); } catch (e) {}
        if (!raw) return W.freshState(now());
        try { return W.migrate(JSON.parse(raw), now()); }
        catch (e) {
            try { localStorage.setItem(DAMAGED_KEY, raw); } catch (e2) {}
            WHW.toastLater = 'Your Wilds save could not be read, so a new adventure started. The old one was kept aside.';
            return W.freshState(now());
        }
    }
    const g = WHW.game = { state: null, zoneId: 'town', map: null, player: null, actors: [], nodes: [], projectiles: [], hazards: [], respawns: [], ack: 0,
        inTown: true, pstats: null, faceSrc: 'mainimage/whathappened.jpeg', bossDeadUntil: 0, maps: {}, canSave: true, useHeld: false, usePressed: false, harvestT: 0 };
    let saveWarned = false;
    function save() {
        if (!g.canSave || !g.state) return;
        const s = g.state, p = g.player;
        g.ack = Bridge.readAck(localStorage);
        if (p && !p.dead) { s.pos = { x: Math.round(p.x), y: Math.round(p.y) }; s.hp = Math.max(1, Math.round(p.hp)); s.zone = g.zoneId; }
        s.writer = TAB_ID;
        try { localStorage.setItem(KEY, W.serialize(s, now(), g.ack)); }
        catch (e) { if (!saveWarned) { saveWarned = true; WHW.toast('Could not save the Wilds (storage full?).', 'bad'); } }
    }
    WHW.save = save;
    function stopSaving() { g.canSave = false; }

    // only one tab plays at a time: the lock is held for the page's lifetime; "Play here" steals it
    function holdLock(steal) {
        const cover = document.getElementById('tabLock');
        if (!(navigator.locks && navigator.locks.request)) return Promise.resolve(true);
        return new Promise((resolve) => {
            const opts = steal ? { steal: true } : { ifAvailable: true };
            navigator.locks.request('whathappened_world_tab', opts, (lock) => {
                if (!lock) { resolve(false); return null; }
                resolve(true);
                return new Promise(() => {}); // hold it until the page goes away (or another tab steals it)
            }).catch(() => {
                // another tab took over: stop writing and step aside
                stopSaving();
                E.paused = true;
                cover.hidden = false;
            });
        });
    }
    function lostToOtherTab() {
        stopSaving();
        E.paused = true;
        document.getElementById('tabLock').hidden = false;
    }

    // ---------------- zones ----------------
    function mapFor(id) { if (!g.maps[id]) g.maps[id] = G.generateZone(id); return g.maps[id]; }
    function weightedPick(list) {
        const total = list.reduce((a, [, w]) => a + w, 0);
        let x = Math.random() * total;
        for (const [id, w] of list) { x -= w; if (x < 0) return id; }
        return list[0][0];
    }
    function spawnAt(i) {
        const sp = g.map.spawns[i];
        if (!sp) return;
        const type = weightedPick(D.ZONES[g.zoneId].spawns);
        const n = D.MONSTERS[type].group || 1;
        for (let k = 0; k < n; k++) {
            const m = A.makeMonster(type, sp.x + (k - (n - 1) / 2) * 30, sp.y + (k % 2) * 20, { spawn: i, flank: n > 1 ? k - (n - 1) / 2 : 0 });
            E.collideTiles(m);
            g.actors.push(m);
        }
    }
    function spawnElite(i) {
        const z = D.ZONES[g.zoneId], ep = g.map.elites[i];
        if (!ep) return;
        const m = A.makeMonster(z.elite, ep.x, ep.y, { spawn: i });
        E.collideTiles(m);
        g.actors.push(m);
    }
    function populate() {
        const z = D.ZONES[g.zoneId], s = g.state, t = now();
        g.actors = []; g.respawns = [];
        if (g.zoneId === 'town') {
            const d = A.makeMonster('dummy', g.map.dummy.x, g.map.dummy.y);
            g.actors.push(d);
            return;
        }
        g.map.spawns.forEach((_, i) => spawnAt(i));
        g.map.elites.forEach((_, i) => {
            const until = s.nodes['elite:' + g.zoneId + ':' + i] || 0;
            if (until > t) g.respawns.push({ spawn: i, elite: true, at: E.time + (until - t) / 1000 });
            else spawnElite(i);
        });
        if (E.time >= g.bossDeadUntil) g.actors.push(A.makeBoss(z.boss, g.map.boss.x, g.map.boss.y));
        const rv = s.rivals[g.zoneId];
        if (!rv || rv.respawnAt <= t) g.actors.push(A.makeRival(g.zoneId, g.map.rival.x, g.map.rival.y));
        else g.rivalAt = E.time + (rv.respawnAt - t) / 1000;
    }
    function enterZone(zoneId, opts = {}) {
        const s = g.state;
        const from = g.zoneId;
        g.zoneId = zoneId;
        g.map = mapFor(zoneId);
        g.inTown = zoneId === 'town';
        E.setMap(g.map);
        const t = now();
        g.nodes = g.map.nodes.map(n => { const r = A.makeNode(n); r.readyAt = W.nodeReadyAt(s, n.key); return r; });
        E.buildNodeGrid(g.nodes);
        g.projectiles = []; g.hazards = []; g.rivalAt = 0;
        if (zoneId !== from || !g.actors.length) populate();
        const p = g.player;
        let pos = opts.pos;
        if (!pos && g.inTown) {
            const portal = g.map.portals.find(pt => pt.to === from);
            if (portal) pos = { x: portal.x + (portal.side === 'w' ? 56 : portal.side === 'e' ? -56 : 0), y: portal.y + (portal.side === 'n' ? 56 : portal.side === 's' ? -56 : 0) };
        }
        if (!pos && opts.atCamp && g.map.camp) pos = { x: g.map.camp.x, y: g.map.camp.y + 40 };
        if (!pos) pos = g.map.entry;
        p.x = pos.x; p.y = pos.y; p.vx = p.vy = p.kbx = p.kby = 0;
        E.collideTiles(p);
        p.trail = [];
        if (g.inTown) {
            const banked = W.bank(s);
            const n = Object.values(banked).reduce((a, v) => a + v, 0);
            if (n && from !== 'town') WHW.toast(`Your ${n} carried material${n > 1 ? 's are' : ' is'} safe in town now.`);
        }
        s.zone = zoneId;
        // a few seconds where other players can't hurt you, so nobody camps the gate
        p.protectedUntil = zoneId === 'town' ? 0 : E.time + O.PVP.protectSec;
        if (WHW.online) WHW.online.zoneChanged(zoneId);
        const z = D.ZONES[zoneId];
        WHW.ui.setZone(z.name, z.safe ? 'Safe' : 'Tier ' + z.tier + ' zone');
        if (!opts.silent) WHW.banner(z.name, z.safe ? 'Craft, trade and pick your next zone' : 'Tier ' + z.tier + ' · ' + D.BOSSES[z.boss].name + ' rules here');
        E.snapCamera();
        save();
    }

    // ---------------- player helpers ----------------
    function refreshPlayer() {
        const s = g.state, p = g.player;
        g.pstats = W.playerStats(s);
        p.maxHp = g.pstats.maxHp;
        p.hp = Math.min(p.hp, p.maxHp);
        if (!W.findGear(s, s.hotbar[s.sel])) {
            const i = s.hotbar.findIndex(u => u && W.findGear(s, u));
            if (i >= 0) s.sel = i;
        }
        p.weaponUid = s.hotbar[s.sel] || null;
        WHW.ui.renderHotbar();
    }

    // loot popping out of something: floating text plus toasts for treasure that goes home
    WHW.showLoot = function (x, y, loot) {
        let dy = 0;
        if (loot.rubies) { E.floatText(x, y - 10, '+' + loot.rubies + ' ♦', '#ff8da0', 15, 1.2); dy -= 16; WHW.sfx('gather'); }
        for (const id in loot.mats || {}) { E.floatText(x, y - 10 + dy, '+' + loot.mats[id] + ' ' + (D.MATERIALS_BY_ID[id] || { name: id }).name, '#e6f0ff', 12, 1.3); dy -= 14; }
        if (loot.gems) { WHW.toast(`💎 ${loot.gems === 1 ? 'A gem!' : loot.gems + ' gems!'} Sent to your game.`, 'gem'); WHW.sfx('gem'); }
    };

    // ---------------- actions (buttons and keys) ----------------
    const reasonText = { rubies: 'Not enough rubies.', materials: 'Missing materials.', busy: 'Finish your other craft first.', full: 'Your bag of gear is full: salvage something first.', allowance: "This week's lootbox allowance is used up.", week: 'Already done this week.', cap: "Today's limit from the Wilds is reached.", unknown: 'That doesn\'t exist.' };
    function craftTitle(r) { return (r.name || 'Crafting'); }
    function playCraft(recipe, station, bow, after) {
        WHW.craft.open({
            station, tier: Math.max(1, recipe.tier || 1), title: (D.STATIONS[station].icon + ' ' + craftTitle(recipe)), bow,
            onDone: (score) => {
                const res = W.finishCraft(g.state, score, Math.random, now(), g.ack);
                save();
                refreshPlayer();
                // a new weapon goes straight onto a free hotbar slot
                if (res && res.kind === 'gear' && res.item && W.baseOf(res.item).slot === 'weapon' && g.state.hotbar.includes(null)) { W.equip(g.state, res.item.uid); refreshPlayer(); }
                WHW.ui.showResult(Object.assign({ score }, res), null);
                if (after) after(res);
            },
            onCancel: () => {
                W.abortCraft(g.state);
                save();
                WHW.toast('Craft cancelled. Your materials are back; the fee is spent.', 'bad');
            },
        });
    }
    WHW.actions = {
        castAbility(slot) {
            if (!g.player || g.player.dead || WHW.ui.isOpen()) return;
            A.castAbility(slot);
        },
        learnAbility(id) {
            const r = W.learnAbility(g.state, id);
            const a = D.ABILITIES[id];
            if (!r.ok) { WHW.toast(r.reason === 'boss' ? 'Beat the boss first.' : r.reason === 'class' ? 'Unlock that class first.' : (reasonText[r.reason] || "Can't learn that."), 'bad'); return; }
            const mine = a.cls === g.state.classes.active;
            WHW.toast(a.icon + ' Learned ' + a.name + (mine ? ' (key ' + D.ABILITY_KEYS[a.key] + ')' : '') + '!', 'gold');
            WHW.sfx('craft'); save(); WHW.ui.renderHotbar(); WHW.ui.refresh();
        },
        unlockClass(id) {
            const r = W.unlockClass(g.state, id);
            if (!r.ok) { WHW.toast(r.reason === 'req' ? 'Finish the challenge first.' : (reasonText[r.reason] || "Can't unlock that."), 'bad'); return; }
            const c = D.CLASSES[id];
            WHW.toast(c.icon + ' ' + c.name + ' unlocked! Become one here while you are in town.', 'gold');
            WHW.sfx('boss'); save(); WHW.ui.refresh();
        },
        setClass(id) {
            if (!g.inTown) { WHW.toast('You can only change class in town.', 'bad'); return; }
            if (!W.setClass(g.state, id)) return;
            const c = D.CLASSES[id];
            WHW.toast(c.icon + ' You are now a ' + c.name + '.', 'gold');
            WHW.sfx('craft'); refreshPlayer(); save(); WHW.ui.refresh();
        },
        selectSlot(i) {
            const s = g.state;
            if (!W.findGear(s, s.hotbar[i])) { WHW.toast('That hotbar slot is empty. Put gear on it from your bag (I).'); return; }
            s.sel = i;
            refreshPlayer();
        },
        equip(uid) {
            const s = g.state, it = W.findGear(s, uid), b = W.baseOf(it);
            if (!b) return;
            if (b.slot === 'weapon' && s.hotbar.includes(uid)) {
                if (s.hotbar.filter(Boolean).length <= 1) { WHW.toast('Keep at least one thing on your hotbar.'); return; }
                s.hotbar = s.hotbar.map(u => (u === uid ? null : u));
            } else W.equip(s, uid);
            refreshPlayer(); save();
        },
        salvage(uid) {
            const back = W.salvage(g.state, uid);
            if (!back) { WHW.toast("You can't salvage your last weapon."); return; }
            const list = Object.entries(back).map(([id, n]) => n + ' ' + D.MATERIALS_BY_ID[id].name).join(', ');
            WHW.toast(list ? 'Salvaged: ' + list + '.' : 'Salvaged.');
            refreshPlayer(); save();
        },
        usePotion() {
            const s = g.state, p = g.player;
            if (!p || p.dead) return;
            if ((g.potionCd || 0) > E.time) return;
            const missing = p.maxHp - p.hp;
            if (missing < 1) { WHW.toast('You are already at full health.'); return; }
            const order = missing >= 90 ? ['potion_big', 'potion_max', 'potion_small'] : ['potion_small', 'potion_big', 'potion_max'];
            const id = order.find(k => s.cons[k] > 0);
            if (!id) { WHW.toast('No potions. Brew them at the Rune Altar or buy them from the Trader.', 'bad'); return; }
            s.cons[id]--;
            p.hp = Math.min(p.maxHp, p.hp + D.CONSUMABLES_BY_ID[id].heal);
            g.potionCd = E.time + 1;
            E.burst(p.x, p.y, '#ff6b8a', 12, 80, { life: 0.6, grav: -60 });
            WHW.sfx('drink');
            WHW.ui.renderHotbar();
        },
        craftBasic(id, times) {
            const n = W.craftBasic(g.state, id, Math.max(1, times || 1));
            if (!n) { WHW.toast('Missing materials.', 'bad'); return; }
            WHW.sfx('craft'); save(); WHW.ui.renderHotbar();
        },
        startCraft(kind, id) {
            const res = W.beginCraft(g.state, kind, id, now());
            if (!res.ok) { WHW.toast(reasonText[res.reason] || 'Can\'t craft that yet.', 'bad'); return; }
            save();
            const r = res.recipe;
            const bow = kind === 'gear' && D.GEAR_BY_ID[id].cls === 'bow';
            playCraft(r, r.station, bow, (out) => {
                if (out && out.kind === 'box') WHW.toast(`${D.BOX_NAMES[out.tier]} sent to your game's Items.`, 'gold');
            });
        },
        reforge(uid) {
            const res = W.beginReforge(g.state, uid, now());
            if (!res.ok) { WHW.toast(reasonText[res.reason] || 'Can\'t reforge that.', 'bad'); return; }
            save();
            const b = W.baseOf(W.findGear(g.state, uid));
            playCraft(res.recipe, res.recipe.station, b.cls === 'bow');
        },
        practice(station, tier, bow) {
            const again = () => WHW.actions.practice(station, tier, bow);
            WHW.craft.open({ station, tier, title: 'Practice · ' + D.STATIONS[station].name, bow, practice: true,
                onDone: (score) => WHW.ui.showResult({ kind: 'practice', score }, again), onCancel: () => {} });
        },
        sell(id, n) {
            const r = W.sell(g.state, id, n);
            if (r) { WHW.sfx('gather'); save(); }
        },
        buy(stockId) {
            const r = W.buy(g.state, stockId, now());
            if (!r.ok) { WHW.toast(reasonText[r.reason] || 'Can\'t buy that.', 'bad'); return; }
            WHW.sfx('craft'); save(); refreshPlayer();
        },
        exchange(kind) {
            const r = W.exchange(g.state, kind, now(), g.ack);
            if (!r.ok) { WHW.toast(reasonText[r.reason] || 'Can\'t exchange.', 'bad'); return; }
            const ex = D.CAPS.exchange[kind];
            WHW.toast(kind === 'gems' ? `💎 ${ex.gems} gems sent to your game.` : `✨ ${ex.golden} Golden What Happened sent to your game.`, kind === 'gems' ? 'gem' : 'gold');
            WHW.sfx('gem'); save();
        },
        travel(zoneId, atCamp) {
            if (zoneId !== 'town' && !g.state.unlocked.zones[zoneId]) { WHW.toast('That gate is still locked.', 'bad'); return; }
            enterZone(zoneId, { atCamp });
        },
    };

    // ---------------- events from the actors ----------------
    WHW.onPlayerDeath = function () {
        const p = g.player;
        const drop = W.die(g.state, g.zoneId, Math.round(p.x), Math.round(p.y), now());
        // knocked out by another player: what dropped becomes their loot (anyone can grab it after a few seconds)
        const killer = WHW.online && WHW.online.pvpKiller();
        if (killer) {
            g.state.stats.pvpLosses = (g.state.stats.pvpLosses || 0) + 1;
            if (g.state.grave && WHW.online.dropLoot(g.state.grave.mats, killer)) g.state.grave = null;
        }
        g.lastPvp = null;
        save();
        WHW.sfx('hurt');
        E.burst(p.x, p.y, '#ff6b7a', 24, 160, { life: 0.8 });
        setTimeout(() => WHW.ui.openDeath(drop, killer, () => {
            p.dead = false;
            p.hp = g.pstats.maxHp;
            p.status.burnUntil = 0; p.slow = 0; p.stam.val = D.COMBAT.stamina.max; p.stam.winded = false;
            enterZone('town', { silent: true });
            WHW.banner('Wildgate Town', 'You came to by the plaza');
        }), 700);
    };
    WHW.onBossWake = (b) => { WHW.banner(b.def.name, 'Watch the red shapes and dash!'); };
    WHW.onBossReset = () => WHW.toast('You left the arena. The boss recovered.', 'bad');
    WHW.onBossKilled = function (b, r) {
        WHW.banner('Victory!', b.def.name + ' is defeated');
        WHW.showLoot(b.x, b.y, { rubies: r.rubies, mats: r.mats });
        if (r.golden) WHW.toast('✨ A Golden What Happened! Sent to your game.', 'gold');
        if (r.mythic) WHW.toast('🎁 A Mythic Vault! It\'s on its way to your game\'s Items.', 'gold');
        if (r.gems) WHW.toast(`💎 ${r.gems} gem${r.gems > 1 ? 's' : ''} sent to your game.`, 'gem');
        if (r.firstToday) WHW.toast('First win today: bonus rubies!', 'gold');
        if (r.unlocked && r.firstEver) setTimeout(() => WHW.toast(`The gate to ${D.ZONES[r.unlocked].name} is open! Head back to town.`, 'gold'), 1200);
        refreshPlayer();
    };

    // ---------------- the simulation step ----------------
    function interactions(dt) {
        const p = g.player, s = g.state, map = g.map;
        const press = E.consumeKey('e') || g.usePressed;
        g.usePressed = false;
        const holding = E.keys.has('e') || g.useHeld;
        let prompt = null;
        // the dropped bag: walk over it
        if (s.grave && s.grave.zone === g.zoneId && dist(p, s.grave) < 28) {
            const got = W.recoverGrave(s);
            WHW.toast('You got your dropped bag back: ' + Object.entries(got).map(([id, n]) => n + ' ' + D.MATERIALS_BY_ID[id].name).join(', ') + '.', 'gold');
            WHW.sfx('gather');
            save();
        }
        if (g.inTown) {
            for (const st of map.stations) {
                if (dist(p, st.door) < 52) { prompt = `<kbd>E</kbd>${esc(D.STATIONS[st.id].icon + ' ' + D.STATIONS[st.id].name)}`; if (press) WHW.ui.openStation(st.id); break; }
            }
            if (!prompt) for (const pt of map.portals) {
                if (dist(p, pt) < 70) {
                    const z = D.ZONES[pt.to], open = s.unlocked.zones[pt.to];
                    prompt = `<kbd>E</kbd>${open ? '' : '🔒 '}Gate to ${esc(z.name)}`;
                    if (press) WHW.ui.openPortal(pt.to);
                    break;
                }
            }
        } else {
            if (map.exit && dist(p, map.exit) < 64) { prompt = '<kbd>E</kbd>Return to town'; if (press) enterZone('town'); }
            else if (map.camp && dist(p, map.camp) < 80) {
                if (!s.unlocked.camps[g.zoneId]) { s.unlocked.camps[g.zoneId] = true; WHW.toast('Camp found! You can now travel straight here from town.', 'gold'); save(); }
                prompt = '<kbd>E</kbd>Camp: return to town';
                if (press) enterZone('town');
            }
        }
        // picking herbs and fiber by hand
        if (!prompt) {
            let best = null, bd = 44;
            for (const n of E.nodesNear(p.x, p.y, 60)) {
                if (n.def.tool !== 'hand' || !A.nodeAlive(n)) continue;
                const d = dist(p, n);
                if (d < bd) { bd = d; best = n; }
            }
            if (best) {
                prompt = `<kbd>E</kbd>Hold to pick ${esc(best.def.name)}`;
                if (holding) {
                    if (g.harvestNode !== best) { g.harvestNode = best; g.harvestT = 0; }
                    g.harvestT += dt;
                    if (g.harvestT >= best.def.work) { g.harvestT = 0; g.harvestNode = null; A.harvest(best, false); }
                } else { g.harvestT = 0; g.harvestNode = null; }
            } else { g.harvestNode = null; g.harvestT = 0; }
        }
        WHW.ui.setPrompt(prompt);
    }
    function separate(list) {
        for (let i = 0; i < list.length; i++) for (let j = i + 1; j < list.length; j++) {
            const a = list[i], b = list[j];
            const dx = b.x - a.x, dy = b.y - a.y, rr = a.r + b.r;
            const d2 = dx * dx + dy * dy;
            if (d2 >= rr * rr || d2 < 0.01) continue;
            const d = Math.sqrt(d2), push = (rr - d) / 2;
            const ma = a.kind === 'boss' ? 0.1 : 1, mb = b.kind === 'boss' ? 0.1 : 1;
            a.x -= dx / d * push * ma; a.y -= dy / d * push * ma;
            b.x += dx / d * push * mb; b.y += dy / d * push * mb;
        }
    }
    let hudT = 0, statT = 0;
    WHW.step = function (dt) {
        const p = g.player;
        if (!p || !g.map) return;
        if (WHW.online) WHW.online.update(dt);
        if (p.dead) { A.updateProjectiles(dt); return; }
        A.updatePlayer(p, dt);
        if (p.dead) return;
        const near = [];
        for (const a of g.actors) {
            if (a.dead) continue;
            const far = Math.abs(a.x - p.x) > 1100 || Math.abs(a.y - p.y) > 900;
            if (far && !(a.kind === 'boss' && a.active)) continue;
            if (a.kind === 'monster' || a.kind === 'dummy') A.updateMonster(a, dt);
            else if (a.kind === 'boss' || a.kind === 'clone') A.updateBoss(a, dt);
            else if (a.kind === 'rival') A.updateRival(a, dt);
            if (!a.dead && a.kind !== 'dummy') near.push(a);
        }
        // bodies don't overlap; a dash slips through them
        if (p.dashT <= 0) near.push(p);
        separate(near);
        E.collideTiles(p);
        A.updateProjectiles(dt);
        A.updateHazards(dt);
        g.actors = g.actors.filter(a => !a.dead);
        // respawns, away from the player
        if (g.respawns.length) {
            g.respawns = g.respawns.filter(r => {
                if (E.time < r.at) return true;
                const pt = r.elite ? g.map.elites[r.spawn] : g.map.spawns[r.spawn];
                if (!pt || dist(p, pt) < 500) { r.at = E.time + 5; return true; }
                if (r.elite) spawnElite(r.spawn); else spawnAt(r.spawn);
                return false;
            });
        }
        if (g.rivalAt && E.time >= g.rivalAt && dist(p, g.map.rival) > 500) { g.rivalAt = 0; g.actors.push(A.makeRival(g.zoneId, g.map.rival.x, g.map.rival.y)); }
        if (!g.inTown && !g.actors.some(a => a.kind === 'boss') && E.time >= g.bossDeadUntil && g.bossDeadUntil && dist(p, g.map.boss) > g.map.boss.r + 300) {
            g.actors.push(A.makeBoss(D.ZONES[g.zoneId].boss, g.map.boss.x, g.map.boss.y)); g.bossDeadUntil = 0;
        }
        for (const n of g.nodes) if (n.shake > 0) n.shake -= dt;
        interactions(dt);
        statT += dt;
        if (statT >= 1) { g.state.stats.playSec += Math.floor(statT); statT -= Math.floor(statT); }
        hudT += dt;
        if (hudT >= 0.1) { hudT = 0; WHW.ui.renderHud(); }
    };

    // ---------------- drawing ----------------
    function inView(x, y, pad) { return x > E.cam.x - pad && y > E.cam.y - pad && x < E.cam.x + E.viewW() + pad && y < E.cam.y + E.viewH() + pad; }
    function drawStructures(ctx) {
        const map = g.map;
        for (const st of map.stations) {
            const def = D.STATIONS[st.id];
            if (!inView(st.x + st.w / 2, st.y + st.h / 2, st.w)) continue;
            // walls, roof and sign
            ctx.fillStyle = '#5b4636'; ctx.fillRect(st.x, st.y + st.h * 0.35, st.w, st.h * 0.65);
            ctx.fillStyle = E.shadeHex(def.color, 0.55);
            ctx.beginPath(); ctx.moveTo(st.x - 8, st.y + st.h * 0.42); ctx.lineTo(st.x + st.w / 2, st.y - 10); ctx.lineTo(st.x + st.w + 8, st.y + st.h * 0.42); ctx.closePath(); ctx.fill();
            ctx.fillStyle = 'rgba(255,255,255,0.08)'; ctx.fillRect(st.x, st.y + st.h * 0.35, st.w, 6);
            ctx.fillStyle = '#2c2018'; ctx.fillRect(st.door.x - 12, st.y + st.h - 26, 24, 26);
            ctx.font = '26px serif'; ctx.textAlign = 'center'; ctx.fillText(def.icon, st.x + st.w / 2, st.y + st.h * 0.72);
            ctx.font = '800 13px Inter, sans-serif'; ctx.fillStyle = '#fff3c4'; ctx.strokeStyle = 'rgba(0,0,0,0.7)'; ctx.lineWidth = 3;
            ctx.strokeText(def.name, st.x + st.w / 2, st.y - 16); ctx.fillText(def.name, st.x + st.w / 2, st.y - 16);
            if (st.id === 'forge') { const f = 0.6 + Math.sin(E.time * 9) * 0.2; ctx.fillStyle = `rgba(255,140,40,${f})`; ctx.beginPath(); ctx.arc(st.x + 18, st.y + st.h - 16, 7, 0, Math.PI * 2); ctx.fill(); }
        }
        for (const pt of map.portals) {
            if (!inView(pt.x, pt.y, 100)) continue;
            const open = g.state.unlocked.zones[pt.to];
            const z = D.ZONES[pt.to];
            ctx.save(); ctx.translate(pt.x, pt.y);
            ctx.fillStyle = open ? 'rgba(120,255,160,0.25)' : 'rgba(255,90,100,0.18)';
            ctx.beginPath(); ctx.arc(0, 0, 30 + Math.sin(E.time * 3) * 2, 0, Math.PI * 2); ctx.fill();
            ctx.strokeStyle = open ? '#7dffb0' : '#ff8a95'; ctx.lineWidth = 3; ctx.stroke();
            ctx.font = '800 12px Inter, sans-serif'; ctx.textAlign = 'center'; ctx.fillStyle = '#fff'; ctx.strokeStyle = 'rgba(0,0,0,0.75)'; ctx.lineWidth = 3;
            const label = (open ? '' : '🔒 ') + z.name;
            const ly = pt.side === 'n' ? 50 : pt.side === 's' ? -40 : -40;
            const lx = pt.side === 'w' ? 40 : pt.side === 'e' ? -40 : 0;
            ctx.textAlign = pt.side === 'w' ? 'left' : pt.side === 'e' ? 'right' : 'center';
            ctx.strokeText(label, lx, ly); ctx.fillText(label, lx, ly);
            ctx.restore();
        }
        for (const d of map.deco || []) {
            if (!inView(d.x, d.y, 40)) continue;
            ctx.fillStyle = '#5a3d22'; ctx.fillRect(d.x - 3, d.y, 6, 12);
            ctx.fillStyle = '#2f6b33'; ctx.beginPath(); ctx.arc(d.x, d.y - 6, 16, 0, Math.PI * 2); ctx.fill();
        }
        if (map.camp && inView(map.camp.x, map.camp.y, 60)) {
            const c = map.camp;
            ctx.fillStyle = '#8a6a4a'; ctx.beginPath(); ctx.moveTo(c.x - 34, c.y - 4); ctx.lineTo(c.x - 16, c.y - 34); ctx.lineTo(c.x + 2, c.y - 4); ctx.closePath(); ctx.fill();
            const f = 0.7 + Math.sin(E.time * 10) * 0.2;
            ctx.fillStyle = `rgba(255,150,40,${f})`; ctx.beginPath(); ctx.arc(c.x + 22, c.y - 8, 7, 0, Math.PI * 2); ctx.fill();
            ctx.fillStyle = '#6b4423'; ctx.fillRect(c.x + 14, c.y - 2, 16, 4);
        }
        if (map.exit && inView(map.exit.x, map.exit.y, 60)) {
            const x = map.exit.x, y = map.exit.y;
            ctx.fillStyle = 'rgba(120,255,160,0.22)'; ctx.beginPath(); ctx.arc(x, y, 28 + Math.sin(E.time * 3) * 2, 0, Math.PI * 2); ctx.fill();
            ctx.strokeStyle = '#7dffb0'; ctx.lineWidth = 3; ctx.stroke();
            ctx.font = '800 12px Inter, sans-serif'; ctx.textAlign = 'center'; ctx.fillStyle = '#fff'; ctx.strokeStyle = 'rgba(0,0,0,0.75)';
            ctx.strokeText('To town', x, y - 36); ctx.fillText('To town', x, y - 36);
        }
        if (map.boss && inView(map.boss.x, map.boss.y, map.boss.r + 40)) {
            ctx.strokeStyle = 'rgba(255,90,100,0.25)'; ctx.lineWidth = 4; ctx.setLineDash([12, 10]);
            ctx.beginPath(); ctx.arc(map.boss.x, map.boss.y, map.boss.r, 0, Math.PI * 2); ctx.stroke(); ctx.setLineDash([]);
        }
    }
    WHW.drawWorld = function (ctx) {
        const p = g.player;
        if (!p) return;
        drawStructures(ctx);
        A.drawTelegraphs(ctx);
        if (WHW.online) WHW.online.drawGround(ctx);
        if (g.state.grave && g.state.grave.zone === g.zoneId) A.drawGrave(ctx, g.state.grave);
        // y-sorted things
        const items = [];
        const vw = E.viewW(), vh = E.viewH();
        for (const n of E.nodesNear(E.cam.x + vw / 2, E.cam.y + vh / 2, Math.max(vw, vh) / 2 + 80)) items.push({ y: n.y, n });
        for (const a of g.actors) if (!a.dead && inView(a.x, a.y, 80)) items.push({ y: a.y, a });
        items.push({ y: p.y, a: p });
        if (WHW.online) for (const rp of WHW.online.drawables()) if (inView(rp.x, rp.y, 80)) items.push({ y: rp.y, rp });
        items.sort((x, y) => x.y - y.y);
        const it = W.findGear(g.state, p.weaponUid), b = W.baseOf(it);
        for (const o of items) {
            if (o.rp) { A.drawRemote(ctx, o.rp, g.zoneId !== 'town'); continue; }
            if (o.n) {
                const showCrack = b && b.cls === o.n.def.tool && Math.abs(o.n.x - p.x) < 160 && Math.abs(o.n.y - p.y) < 160;
                A.drawNode(ctx, o.n, showCrack);
                continue;
            }
            const a = o.a;
            if (a.kind === 'player') { if (!a.dead) A.drawPlayer(ctx, a); }
            else if (a.kind === 'boss' || a.kind === 'clone') A.drawBoss(ctx, a);
            else if (a.kind === 'rival') A.drawRival(ctx, a);
            else A.drawMonster(ctx, a);
        }
        A.drawProjectiles(ctx);
        if (WHW.online) WHW.online.drawTop(ctx);
        // hand picking progress
        if (g.harvestNode && g.harvestT > 0) {
            const n = g.harvestNode;
            ctx.strokeStyle = '#7dffb0'; ctx.lineWidth = 4;
            ctx.beginPath(); ctx.arc(n.x, n.y, n.r + 8, -Math.PI / 2, -Math.PI / 2 + Math.PI * 2 * Math.min(1, g.harvestT / n.def.work)); ctx.stroke();
        }
    };
    let snow = [];
    WHW.drawOverlay = function (ctx) {
        const p = g.player;
        if (!p) return;
        const z = D.ZONES[g.zoneId];
        const sp = E.worldToScreen(p.x, p.y);
        if (z.dark) {
            const r = z.dark * E.zoom;
            const grad = ctx.createRadialGradient(sp.x, sp.y, r * 0.35, sp.x, sp.y, r);
            grad.addColorStop(0, 'rgba(5,4,8,0)'); grad.addColorStop(1, 'rgba(5,4,8,0.9)');
            ctx.fillStyle = grad; ctx.fillRect(0, 0, E.w, E.h);
        }
        if (z.blizzard && E.perf !== 'low') {
            const want = E.perf === 'medium' ? 60 : 120;
            while (snow.length < want) snow.push({ x: Math.random() * E.w, y: Math.random() * E.h, v: 40 + Math.random() * 80, s: 1 + Math.random() * 2 });
            ctx.fillStyle = 'rgba(255,255,255,0.8)';
            for (const f of snow) {
                f.x += (-50 + Math.sin(E.time + f.v) * 20) / 60; f.y += f.v / 60;
                if (f.y > E.h) { f.y = -4; f.x = Math.random() * E.w; } if (f.x < 0) f.x = E.w;
                ctx.fillRect(f.x, f.y, f.s, f.s);
            }
            ctx.fillStyle = 'rgba(220,235,255,0.08)'; ctx.fillRect(0, 0, E.w, E.h);
        } else snow = [];
        if (z.lavaDps) { ctx.fillStyle = 'rgba(255,90,20,0.05)'; ctx.fillRect(0, 0, E.w, E.h); }
        // low health warning
        if (!p.dead && p.hp / p.maxHp < 0.3) {
            const grad = ctx.createRadialGradient(E.w / 2, E.h / 2, Math.min(E.w, E.h) * 0.35, E.w / 2, E.h / 2, Math.max(E.w, E.h) * 0.7);
            grad.addColorStop(0, 'rgba(255,0,30,0)'); grad.addColorStop(1, `rgba(255,0,30,${0.25 + Math.sin(E.time * 6) * 0.08})`);
            ctx.fillStyle = grad; ctx.fillRect(0, 0, E.w, E.h);
        }
        // the bow's pull line, so the slingshot aim is easy to read
        const w = p.weapon;
        if (w && w.cls === 'bow' && w.drawing && E.mouse.type !== 'touch') {
            ctx.strokeStyle = 'rgba(255,255,255,0.35)'; ctx.setLineDash([4, 5]); ctx.lineWidth = 1.5;
            ctx.beginPath(); ctx.moveTo(w.anchorX, w.anchorY); ctx.lineTo(E.mouse.sx, E.mouse.sy); ctx.stroke(); ctx.setLineDash([]);
            ctx.strokeStyle = w.draw >= 0.95 ? '#ffc83d' : '#fff'; ctx.lineWidth = 3;
            ctx.beginPath(); ctx.arc(w.anchorX, w.anchorY, 10, -Math.PI / 2, -Math.PI / 2 + Math.PI * 2 * w.draw); ctx.stroke();
        }
        WHW.ui.renderPower(p);
        WHW.ui.renderAbilities();
        minimapT -= 1;
        if (minimapT <= 0) { minimapT = 12; WHW.drawMinimap(document.getElementById('minimap'), false); }
        if (debug) {
            const P = w ? D.WEAPON_CLASSES[w.cls] : null;
            ctx.fillStyle = 'rgba(0,0,0,0.6)'; ctx.fillRect(10, E.h - 70, 260, 58);
            ctx.fillStyle = '#fff'; ctx.font = '12px monospace'; ctx.textAlign = 'left';
            if (w && P) ctx.fillText(`ω ${w.omega.toFixed(1)}  tip v ${Math.round(Math.abs(w.omega) * (P.len || 0))}  vMin ${P.vMin || '-'}`, 16, E.h - 52);
            ctx.fillText(`actors ${g.actors.length}  fps-steps ${E.frames}`, 16, E.h - 36);
            ctx.fillText(`stam ${p.stam.val.toFixed(0)}  combo ${p.combo.combo || 0}`, 16, E.h - 20);
        }
    };
    let minimapT = 0;
    WHW.drawMinimap = function (cv, big) {
        if (!cv || !g.map) return;
        const ctx = cv.getContext('2d');
        const base = E.minimapBase();
        const m = g.map;
        ctx.imageSmoothingEnabled = false;
        ctx.clearRect(0, 0, cv.width, cv.height);
        const s = Math.min(cv.width / m.w, cv.height / m.h);
        const ox = (cv.width - m.w * s) / 2, oy = (cv.height - m.h * s) / 2;
        ctx.drawImage(base, ox, oy, m.w * s, m.h * s);
        const dot = (x, y, col, r = 3) => { ctx.fillStyle = col; ctx.beginPath(); ctx.arc(ox + x / TILE * s, oy + y / TILE * s, r, 0, Math.PI * 2); ctx.fill(); };
        if (m.exit) dot(m.exit.x, m.exit.y, '#7dffb0', 3);
        if (m.camp) dot(m.camp.x, m.camp.y, g.state.unlocked.camps[g.zoneId] ? '#ffd24d' : 'rgba(255,210,77,0.4)', 3);
        if (m.boss) dot(m.boss.x, m.boss.y, '#ff5b6b', 4);
        for (const pt of m.portals) dot(pt.x, pt.y, g.state.unlocked.zones[pt.to] ? '#7dffb0' : '#ff8a95', 3);
        for (const st of m.stations) dot(st.door.x, st.door.y, D.STATIONS[st.id].color, 3);
        if (g.state.grave && g.state.grave.zone === g.zoneId) dot(g.state.grave.x, g.state.grave.y, '#ffc83d', 4);
        if (big) for (const a of g.actors) if (!a.dead && (a.elite || a.kind === 'rival')) dot(a.x, a.y, a.kind === 'rival' ? '#ff9a3d' : '#ffe14d', 2.5);
        if (WHW.online) for (const rp of WHW.online.drawables()) dot(rp.x, rp.y, g.zoneId === 'town' ? '#9ad7ff' : '#ff6b7a', big ? 3 : 2.5);
        dot(g.player.x, g.player.y, '#ffffff', big ? 4 : 3);
    };

    // ---------------- input glue ----------------
    // block with the right mouse button, F, or the touch shield button
    WHW.shieldWanted = () => E.mouse.rmb || E.keys.has('f') || g.touchShield;
    WHW.onPress = () => { if (WHW.ui.isOpen() || !g.player || g.player.dead) return; A.press(g.player); };
    WHW.onRelease = () => { if (g.player) A.release(g.player); };
    WHW.onWheel = (dir) => {
        if (WHW.ui.isOpen()) return;
        const s = g.state;
        for (let k = 1; k <= D.RULES.hotbarSlots; k++) {
            const i = (s.sel + dir * k + D.RULES.hotbarSlots * 5) % D.RULES.hotbarSlots;
            if (W.findGear(s, s.hotbar[i])) { s.sel = i; refreshPlayer(); return; }
        }
    };
    function bindButtons() {
        const on = (id, fn) => { const el = document.getElementById(id); if (el) el.addEventListener('click', fn); };
        on('btnBag', () => WHW.ui.openBag());
        on('btnMap', () => WHW.ui.openMap());
        on('btnSkills', () => WHW.ui.openSkills());
        on('btnHelp', () => WHW.ui.openHelp());
        on('btnSettings', () => WHW.ui.openSettings());
        on('wModalClose', () => WHW.ui.closeModal());
        document.getElementById('wModal').addEventListener('click', (ev) => { if (ev.target.id === 'wModal' && !(WHW.craft && WHW.craft.isOpen())) WHW.ui.closeModal(); });
        on('tabLockTake', () => {
            holdLock(true).then(() => {
                // the other tab may have played on: start from what it saved
                g.state = loadState();
                g.canSave = true;
                document.getElementById('tabLock').hidden = true;
                E.paused = false;
                refreshPlayer();
                enterZone(g.state.zone, { pos: g.state.pos, silent: true });
            });
        });
        const tb = (id, down, up) => { const el = document.getElementById(id); if (!el) return; el.addEventListener('pointerdown', (e) => { e.preventDefault(); down(); }); if (up) { el.addEventListener('pointerup', up); el.addEventListener('pointercancel', up); } };
        tb('tDash', () => g.player && A.tryDash(g.player, E.moveInput()));
        tb('tUse', () => { g.usePressed = true; g.useHeld = true; }, () => { g.useHeld = false; });
        tb('tPotion', () => WHW.actions.usePotion());
        for (let i = 0; i < D.ABILITY_KEYS.length; i++) tb('tAb' + i, () => WHW.actions.castAbility(i));
        tb('tShield', () => { g.touchShield = true; }, () => { g.touchShield = false; });
    }

    // ---------------- other tabs ----------------
    window.addEventListener('storage', (ev) => {
        if (ev.key === 'whathappened_cloud_applied' && ev.newValue) { stopSaving(); location.reload(); return; }
        if (ev.key === Bridge.ACK_KEY) { g.ack = Bridge.readAck(localStorage); return; }
        if (ev.key !== KEY) return;
        if (ev.newValue === null) { stopSaving(); location.reload(); return; } // progress was reset from the game
        let writer = '';
        try { writer = JSON.parse(ev.newValue).writer; } catch (e) {}
        if (writer && writer !== TAB_ID && g.canSave) lostToOtherTab();
    });
    window.addEventListener('pageshow', (ev) => { if (ev.persisted) { stopSaving(); location.reload(); } });
    document.addEventListener('visibilitychange', () => {
        if (document.visibilityState === 'hidden') save();
        if (WHW.online) WHW.online.visibility(document.visibilityState === 'hidden');
    });
    window.addEventListener('pagehide', save);

    // ---------------- debug hooks (tests and tuning: world.html?whdebug) ----------------
    const debug = /[?&]whdebug\b/.test(location.search);
    const localHost = /^(localhost|127\.0\.0\.1|\[::1\])$/.test(location.hostname) || location.protocol === 'file:';
    if (debug) {
        window.WHWorldDebug = {
            frames: () => E.frames,
            player: () => ({ x: g.player.x, y: g.player.y, hp: g.player.hp, zone: g.zoneId }),
            weaponOmega: () => (g.player.weapon ? g.player.weapon.omega : 0),
            spawnDummy: () => { const d = A.makeMonster('slime', g.player.x + 40, g.player.y); d.maxHp = d.hp = 500; d.speed = 0; d.def = Object.assign({}, d.def, { attacks: [] }); d.cds = []; g.actors.push(d); return d.id; },
            actorHp: (id) => { const a = g.actors.find(x => x.id === id); return a ? a.hp : null; },
            state: () => g.state,
            travel: (z) => enterZone(z),
            teleport: (x, y) => { g.player.x = x; g.player.y = y; },
            online: () => {
                const on = WHW.online;
                return { status: on.status, error: on.error, uid: on.uid, zone: on.zone, host: on.isHost, boss: on.boss && { hp: on.boss.hp, max: on.boss.max, killedAt: on.boss.killedAt },
                    players: on.here().map(r => ({ uid: r.uid, name: r.info.n, x: Math.round(r.x), y: Math.round(r.y), hp: r.hp, shield: r.shield.up, bubble: r.bubble && r.bubble.m })), loot: [...on.loot.keys()] };
            },
        };
        if (localHost) {
            window.WHWorldDebug.grant = (r) => { Bridge.push(g.state, r, g.ack, now()); save(); };
            window.WHWorldDebug.give = (id, n) => { W.give(g.state, id, n, true); save(); };
            window.WHWorldDebug.rubies = (n) => { W.addRubies(g.state, n); save(); };
            window.WHWorldDebug.unlockAll = () => { D.ZONE_ORDER.forEach(z => { g.state.unlocked.zones[z] = true; }); save(); };
        }
    }

    // ---------------- boot ----------------
    function boot() {
        if (boot.done) return;
        boot.done = true;
        g.state = loadState();
        g.ack = Bridge.readAck(localStorage);
        g.faceSrc = faceFromSkin();
        E.img(g.faceSrc);
        g.player = A.makePlayer(0, 0);
        if (g.state.pendingCraft) {
            W.abortCraft(g.state);
            WHW.toastLater = 'An unfinished craft was cancelled: your materials are back, the fee is spent.';
        }
        refreshPlayer();
        g.player.hp = Math.min(g.player.maxHp, g.state.hp || g.player.maxHp);
        bindButtons();
        E.start();
        holdLock(false).then((ok) => {
            if (!ok) { lostToOtherTab(); }
        });
        g.zoneId = g.state.zone;
        enterZone(g.state.zone, { pos: g.state.pos, silent: g.state.zone !== 'town' });
        WHW.ui.renderHud();
        if (WHW.online) WHW.online.start();
        document.getElementById('loading').hidden = true;
        if (WHW.toastLater) { WHW.toast(WHW.toastLater, 'bad'); WHW.toastLater = null; }
        if (!g.state.tutorial.welcome) {
            g.state.tutorial.welcome = true;
            save();
            setTimeout(() => WHW.ui.openHelp(), 400);
        }
        setInterval(() => { if (!document.hidden) save(); }, 10000);
    }
    if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', boot);
    else boot();
})();
