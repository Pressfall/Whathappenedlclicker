/**
 * The Wilds online: other players in the same zone, live. Everyone shares the zone's players, loot bags and boss
 * through a small realtime database (Firebase Realtime Database in production via world-net-rtdb.js; the server.js relay
 * on localhost via world-net-dev.js). Monsters stay on each player's own page.
 * - Presence: each page writes its position (~10 a second) and its look; leaving or closing the page removes them.
 * - PvP (everywhere but town): a hit on another player is sent to them; their page checks it (core/world-online.js
 *   validateHit) and takes it with its own shield and armor. Abilities hit players too: the hit names the ability, and the
 *   player hit applies its effects from the game's own table. Each player's last cast rides along with their position, so
 *   everyone sees it. A player knocked out by another drops part of what they carry as a loot bag; the winner gets first pick.
 * - Chat: a short line or an emote shown above the speaker.
 * - Shared bosses: one health bar for everyone in the arena. One page (the host: lowest id in the arena) runs the boss and
 *   shares where it is and what it does; the others replay that. Everyone who did enough damage gets the reward.
 * Data layout under wilds/v1/zones/{zone}: p/{uid} position, i/{uid} look and chat, h/{uid}/{id} hits for that player,
 * l/{id} loot bags, b the boss. Rules: database.rules.json.
 */
(function () {
    'use strict';
    const D = window.WHWorldData, W = window.WHWorld, C = window.WHWorldCombat, O = window.WHWorldOnline;
    const WHW = window.WHW;
    const E = WHW.engine, A = WHW.actors;
    const F = O.FLAGS;
    const NAME_KEY = 'whathappened_world_name';
    const BOSS_RESPAWN = 90; // seconds; same as the boss respawn in world-actors.js (kill)
    const game = () => WHW.game;
    const isLocal = /^(localhost|127\.0\.0\.1|\[::1\])$/.test(location.hostname);

    const ON = WHW.online = {
        status: 'off', error: '', db: null, uid: null, zone: null, wantZone: null, connectedOnce: false,
        remotes: new Map(), loot: new Map(), log: [], subs: [],
        lastSent: '', sendT: 0, infoKey: '', infoT: 0, chipT: 0,
        lastHitAt: {}, abRate: {}, sayAt: -99, myBubble: null, seenKills: new Set(), claiming: new Set(), lockHintAt: 0,
        boss: null, bossPending: 0, bossGen: '', rewardedGen: '', bossT: 0, hostT: 0, followSeq: -1, hostSeenAt: 0, lastHost: null, resetAt: -9,
        isHost: false, hostUid: null,
    };

    // ---------------- who I am ----------------
    function myName() {
        let n = null;
        try { n = O.sanitizeName(localStorage.getItem(NAME_KEY)) || O.sanitizeName(localStorage.getItem('player_username')); } catch (e) {}
        if (!n) {
            n = 'Adventurer' + Math.floor(1000 + Math.random() * 9000);
            try { localStorage.setItem(NAME_KEY, n); } catch (e) {}
        }
        return n;
    }
    ON.name = myName;
    ON.setName = function (n) {
        const s = O.sanitizeName(n);
        if (!s) return false;
        try { localStorage.setItem(NAME_KEY, s); } catch (e) {}
        ON.infoKey = '';
        return true;
    };
    function safeMode() { try { return localStorage.getItem('chat_safe_mode') === '1'; } catch (e) { return false; } }
    const Z = (sub) => O.ROOT + '/' + ON.zone + (sub ? '/' + sub : '');

    // ---------------- connecting ----------------
    function setStatus(s, err) {
        ON.status = s;
        ON.error = err || '';
        if (WHW.ui && WHW.ui.setOnline) WHW.ui.setOnline();
    }
    // ?whnet=dev|rtdb|off picks one; otherwise the local relay on localhost and Realtime Database everywhere else
    function transport() {
        const m = /[?&]whnet=(dev|rtdb|off)\b/.exec(location.search);
        if (m) return m[1];
        return isLocal ? 'dev' : 'rtdb';
    }
    ON.start = async function () {
        if (ON.db || ON.status === 'connecting') return;
        if (!WHW.settings.online) { setStatus('off'); return; }
        const t = transport();
        if (t === 'off') { setStatus('off'); return; }
        setStatus('connecting');
        try {
            let mod = window.WHNetDev;
            if (t === 'rtdb') { await import('./world-net-rtdb.js'); mod = window.WHNetRTDB; }
            const db = await mod.connect();
            ON.db = db;
            ON.uid = db.uid;
            db.onStatus((up) => {
                if (ON.db !== db) return;
                if (up && !ON.connectedOnce) { ON.connectedOnce = true; }
                else if (up && ON.wantZone) join(ON.wantZone, true); // reconnected: presence was dropped meanwhile
                setStatus(up ? 'online' : ON.connectedOnce ? 'reconnecting' : 'connecting');
            });
            ON.wantZone = game().zoneId;
            join(ON.wantZone);
            // Realtime Database keeps retrying quietly when it can't connect (most likely: not created yet in the console)
            setTimeout(() => {
                if (ON.db === db && !ON.connectedOnce) setStatus('error', 'Online play isn\'t set up yet: the Realtime Database could not be reached. It keeps trying in the background.');
            }, 12000);
        } catch (e) {
            ON.db = null;
            setStatus('error', (e && e.message) || 'Could not connect');
        }
    };
    ON.stop = function () {
        leave();
        if (ON.db) ON.db.close();
        ON.db = null; ON.uid = null; ON.connectedOnce = false;
        setStatus('off');
    };
    ON.zoneChanged = function (zone) { ON.wantZone = zone; if (ON.db) join(zone); };
    // a hidden page stops sending; after a while it leaves so others don't see a statue
    ON.visibility = function (hidden) {
        if (!ON.db) return;
        if (hidden) {
            clearTimeout(ON.hideTimer);
            ON.hideTimer = setTimeout(() => leave(), O.RATE.hiddenLeaveSec * 1000);
        } else {
            clearTimeout(ON.hideTimer);
            if (!ON.zone && ON.wantZone) join(ON.wantZone);
        }
    };

    function join(zone, force) {
        const db = ON.db;
        if (!db) return;
        // inside a building (the Hall of Gods) you are out of sight: leave the zone you were in, join none
        if (D.ZONES[zone] && D.ZONES[zone].interior) { leave(); ON.wantZone = zone; return; }
        if (ON.zone === zone && !force) return;
        leave();
        ON.zone = zone;
        ON.wantZone = zone;
        const me = ON.uid;
        for (const p of ['p/' + me, 'i/' + me, 'h/' + me]) db.onDisconnectRemove(Z(p));
        db.remove(Z('h/' + me)); // hits sent while we were away
        ON.lastSent = ''; ON.infoKey = ''; ON.sendT = 0;
        sendInfo(true);
        ON.subs.push(db.onChild(Z('p'), { add: onPos, change: onPos, remove: dropRemote }));
        ON.subs.push(db.onChild(Z('i'), { add: onInfo, change: onInfo, remove: dropRemote }));
        ON.subs.push(db.onChild(Z('h/' + me), { add: onHit }));
        ON.subs.push(db.onChild(Z('l'), { add: onLoot, change: onLoot, remove: (k) => ON.loot.delete(k) }));
        if (zone !== 'town') ON.subs.push(db.onValue(Z('b'), onBoss));
    }
    function leave() {
        ON.subs.forEach((u) => { try { u(); } catch (e) {} });
        ON.subs = [];
        if (ON.db && ON.zone) {
            for (const p of ['p/' + ON.uid, 'i/' + ON.uid]) { ON.db.remove(Z(p)); ON.db.cancelOnDisconnect(Z(p)); }
        }
        ON.remotes.clear(); ON.loot.clear();
        ON.boss = null; ON.bossPending = 0; ON.bossGen = ''; ON.isHost = false; ON.hostUid = null; ON.followSeq = -1;
        ON.zone = null;
    }

    // ---------------- other players ----------------
    function remote(uid) {
        let r = ON.remotes.get(uid);
        if (!r) {
            r = { uid, id: 'r' + uid, kind: 'remote', team: 'remote', x: 0, y: 0, vx: 0, vy: 0, r: 13, facing: 0, mass: 1, hp: 100, maxHp: 100, armor: 0,
                status: { burnUntil: 0, burnDps: 0, chillUntil: 0, stunUntil: 0 }, info: null, buf: [], last: 0, fl: 0, shot: -1, cs: -1,
                weapon: C.newWeapon('sword', 0), shield: { theta: 0, up: false }, trail: [], flash: 0, dead: false, protected: false, stale: true, bubble: null, sayT: 0 };
            ON.remotes.set(uid, r);
        }
        return r;
    }
    function dropRemote(uid) { ON.remotes.delete(uid); }
    function onPos(uid, val) {
        if (uid === ON.uid) return;
        const u = O.unpackPos(val);
        if (!u) return;
        const r = remote(uid);
        u.at = performance.now();
        r.buf.push(u);
        if (r.buf.length > 12) r.buf.shift();
        r.last = u.at;
        if (u.hp < r.hp) r.flash = 0.12;
        r.hp = u.hp; r.maxHp = u.mhp; r.fl = u.fl;
        // they shot an arrow: show it flying (their page sends the hit if it lands on someone)
        // (a staff's spell instead: an odd shot number is a bolt, an even one a wave)
        if (r.shot >= 0 && u.shot > r.shot && ON.zone) {
            const wb = r.info && D.GEAR_BY_ID[r.info.w], sm = wb && D.STAFF_MAGIC[wb.magic], P = game().projectiles;
            if (!sm) P.push({ kind: 'arrow', team: 'fx', x: u.x, y: u.y, vx: Math.cos(u.a) * 900, vy: Math.sin(u.a) * 900, r: 4, life: 0.9, hit: new Set() });
            else if (u.shot % 2) P.push({ kind: 'bolt', team: 'fx', x: u.x, y: u.y, vx: Math.cos(u.a) * sm.thrust.speed, vy: Math.sin(u.a) * sm.thrust.speed, r: sm.thrust.r, life: sm.thrust.life, color: sm.color, look: sm.thrust.look, hit: new Set() });
            else P.push({ kind: 'wave', team: 'fx', ox: u.x, oy: u.y, dir: u.a, arc: (sm.swing.arcMin + sm.swing.arcMax) / 2, rad: 20, speed: sm.swing.speed, band: sm.swing.band, x: u.x, y: u.y, vx: 0, vy: 0, r: 0, life: sm.swing.life, color: sm.color, look: sm.swing.look, hit: new Set() });
        }
        r.shot = u.shot;
        // they cast an ability: show it (their page sends the hits)
        const cs = u.cs || 0;
        if (r.cs >= 0 && cs > r.cs && ON.zone) A.remoteCast(u.x, u.y, u.ci, u.cx, u.cy);
        r.cs = cs;
    }
    function onInfo(uid, val) {
        if (uid === ON.uid) return;
        const info = O.sanitizeInfo(val);
        if (!info) return;
        const r = remote(uid);
        const prevW = r.info && r.info.w;
        r.info = info;
        if (prevW !== info.w) r.weapon = C.newWeapon(D.GEAR_BY_ID[info.w].cls, r.weapon.theta);
        if (info.say && info.say.t !== r.sayT) {
            const fresh = !r.sayT || (ON.db && ON.db.serverNow() - info.say.t < 15000);
            r.sayT = info.say.t;
            if (fresh) {
                const m = safeMode() ? O.censor(info.say.m) : info.say.m;
                r.bubble = { m, e: info.say.e, until: E.time + O.CHAT.bubbleSec };
                logLine(info.n, m, false);
            }
        }
    }
    function myPos() {
        const p = game().player, w = p.weapon;
        let r = 0;
        if (w && C.hasReach(w.cls)) r = w.r; else if (w && w.cls === 'bow') r = w.draw * 100;
        let fl = 0;
        if (p.shield.up) fl |= F.shield;
        if (p.dead) fl |= F.dead;
        if (p.dashT > 0) fl |= F.dash;
        if (p.protectedUntil > E.time) fl |= F.protect;
        if (w && w.drawing) fl |= F.draw;
        const c = p.cast || {};
        return O.packPos({ x: p.x, y: p.y, a: w ? w.theta : p.facing, r, sa: p.shield.theta, fl, hp: p.hp, mhp: p.maxHp, shot: p.shotSeq || 0, k: Math.floor(ON.db.serverNow() / 1000) % 1e6,
            cs: c.seq, ci: c.id, cx: c.x, cy: c.y });
    }
    function sendPos() {
        const str = myPos();
        if (str !== ON.lastSent) { ON.db.set(Z('p/' + ON.uid), str); ON.lastSent = str; }
    }
    // the game stops stepping while a menu is open; keep saying we're here (the heartbeat changes once a second)
    setInterval(() => { if (ON.db && ON.zone && E.paused && !document.hidden && game().player) sendPos(); }, 1000);
    function sendInfo(force) {
        if (!ON.db || !ON.zone) return;
        const info = O.infoFor(game().state, myName(), game().faceSrc);
        const key = JSON.stringify(info);
        if (!force && key === ON.infoKey) return;
        ON.infoKey = key;
        ON.db.update(Z('i/' + ON.uid), Object.assign(info, { t: ON.db.serverNow() }));
    }
    function trail(r, P) {
        const len = C.hasReach(r.weapon.cls) ? r.weapon.r : P.len || 0;
        if (!len || r.weapon.cls === 'bow') { r.trail = []; return; }
        const v = Math.abs(r.weapon.omega) * len;
        r.trail.push({ x: r.x + Math.cos(r.weapon.theta) * len, y: r.y + Math.sin(r.weapon.theta) * len, kind: v >= (P.vFull || 1e9) * 0.97 ? 'perfect' : v >= (P.vMin || 1e9) ? 'hit' : 'slow' });
        if (r.trail.length > 9) r.trail.shift();
    }

    // ---------------- each step ----------------
    ON.update = function (dt) {
        if (!ON.db || !ON.zone) return;
        const t = performance.now();
        for (const r of ON.remotes.values()) {
            r.stale = !r.buf.length || t - r.last > O.RATE.staleSec * 1000;
            const s = O.interpolate(r.buf, t - O.RATE.interpMs);
            if (!s) continue;
            r.vx = (s.x - r.x) / dt; r.vy = (s.y - r.y) / dt;
            if (Math.abs(r.vx) > 2000 || Math.abs(r.vy) > 2000) r.vx = r.vy = 0;
            r.x = s.x; r.y = s.y;
            const w = r.weapon;
            w.prevTheta = w.theta; w.theta = s.a; w.omega = C.wrap(s.a - w.prevTheta) / dt;
            if (C.hasReach(w.cls)) w.r = Math.max(D.WEAPON_CLASSES[w.cls].reachMin, s.r);
            if (w.cls === 'bow') { w.draw = s.r / 100; w.drawing = !!(s.fl & F.draw); }
            r.facing = s.a;
            r.shield.theta = s.sa; r.shield.up = !!(s.fl & F.shield);
            r.dead = !!(s.fl & F.dead); r.protected = !!(s.fl & F.protect);
            r.flash = Math.max(0, r.flash - dt);
            trail(r, D.WEAPON_CLASSES[w.cls] || {});
        }
        ON.sendT -= dt;
        if (ON.sendT <= 0) { ON.sendT = 1 / O.RATE.sendHz; sendPos(); }
        ON.infoT -= dt;
        if (ON.infoT <= 0) { ON.infoT = 0.5; sendInfo(false); }
        lootTick();
        if (ON.zone !== 'town') bossTick(dt);
        ON.chipT -= dt;
        if (ON.chipT <= 0) { ON.chipT = 0.5; if (WHW.ui.setOnline) WHW.ui.setOnline(); }
    };
    ON.here = function () { return [...ON.remotes.values()].filter(r => !r.stale && r.info); };
    // other players my weapons can hit right now
    ON.targets = function () {
        if (!ON.db || !ON.zone || ON.zone === 'town' || ON.status !== 'online') return [];
        const out = [];
        for (const r of ON.remotes.values()) if (!r.stale && !r.dead && !r.protected && r.info) out.push(r);
        return out;
    };

    // ---------------- PvP ----------------
    ON.hitRemote = function (r, h) {
        const g = game(), p = g.player;
        const it = W.findGear(g.state, p.weaponUid);
        const w = h.w || (it && it.base);
        if (!w || !ON.db) return;
        p.protectedUntil = 0; // attacking ends your own arrival protection
        const hit = O.makeHit(w, h.kind, h.dmg, h.ang, h.perfect);
        hit.from = ON.uid;
        hit.t = ON.db.serverNow();
        ON.db.push(Z('h/' + r.uid), hit);
        r.flash = 0.12;
        if (WHW.settings.dmgNumbers && h.dmg > 0) E.floatText(r.x, r.y - r.r - 6, Math.round(h.dmg * O.PVP.mult), h.perfect ? '#ffc83d' : '#ffd0d5', h.perfect ? 17 : 13);
    };
    function onHit(key, raw) {
        ON.db.remove(Z('h/' + ON.uid + '/' + key)); // each hit is used once
        if (!raw || typeof raw !== 'object' || typeof raw.from !== 'string') return;
        const g = game(), p = g.player;
        if (p.dead) return;
        if (raw.t && ON.db.serverNow() - Number(raw.t) > 3000) return; // too old to have been fair
        const r = ON.remotes.get(raw.from);
        const last = r && r.buf.length ? r.buf[r.buf.length - 1] : null;
        const rateKey = raw.from + '|' + raw.w;
        const v = O.validateHit(raw, { zone: ON.zone, attacker: last, me: { x: p.x, y: p.y, protected: p.protectedUntil > E.time }, now: E.time, lastAt: ON.lastHitAt[raw.from],
            weapon: r && r.info ? r.info.w : null, abRate: ON.abRate[rateKey] });
        if (!v.ok) return;
        if (raw.k === 'ab') { ON.abRate[rateKey] = v.rate; takeAbility(raw, v, r, last); return; }
        if (raw.k === 'parry') {
            // they parried us: knocked off balance for a moment
            p.staggerUntil = E.time + 0.6;
            E.floatText(p.x, p.y - 30, 'PARRIED', '#ff9a3d', 14);
            WHW.sfx('clash');
            return;
        }
        ON.lastHitAt[raw.from] = E.time;
        g.lastPvp = { uid: raw.from, name: r.info ? r.info.n : 'Someone', at: E.time };
        p.protectedUntil = 0;
        // a staff's spell burns or builds frost as its magic does (from the game's table, not from what they sent)
        const sm = raw.k === 'spell' ? D.STAFF_MAGIC[D.GEAR_BY_ID[raw.w].magic] : null;
        const burn = !!(sm && (sm.thrust.burn || sm.swing.burn));
        const landed = A.hurtPlayer(v.dmg, {
            burn, fire: burn, fromAngle: sm && Number.isFinite(+raw.ang) ? +raw.ang + Math.PI : undefined,
            from: { x: last.x, y: last.y }, kb: 160, remote: r, // a Riposte up just then sends it back at them
            onParry: () => ON.db.push(Z('h/' + raw.from), { from: ON.uid, k: 'parry', t: ON.db.serverNow() }),
        });
        if (landed > 0 && sm && sm.frost) A.frostPlayer(sm.frost);
    }
    // Another player's ability hit me. Its effects come from the game's table (v.ability), not from what they sent.
    function takeAbility(raw, v, r, last) {
        const g = game(), p = g.player, a = v.ability;
        g.lastPvp = { uid: raw.from, name: r && r.info ? r.info.n : 'Someone', at: E.time };
        p.protectedUntil = 0;
        // ang is the way the hit pushes; it comes from the other side, so that is where a shield must face
        const ang = Number(raw.ang) || 0;
        const from = { x: p.x - Math.cos(ang) * 40, y: p.y - Math.sin(ang) * 40 };
        let landed = 1;
        if (v.dmg > 0) {
            landed = A.hurtPlayer(v.dmg, {
                from, kb: Math.min(350, (a.pull || a.kb || 0) * 0.5), burn: a.burn, chill: a.chill, fire: !!a.burn,
                // areas fall from above, lightning arcs round a shield, and a riposte can't be blocked or riposted back
                unblockable: a.kind === 'field' || a.kind === 'chain' || a.kind === 'parry', remote: r,
                onParry: () => ON.db.push(Z('h/' + raw.from), { from: ON.uid, k: 'parry', t: ON.db.serverNow() }),
            });
        }
        // a riposte disarms a player by exhausting them; other stuns are shorter on players than on monsters
        if (landed > 0 && a.exhaust) A.exhaustPlayer(a.exhaust);
        else if (landed > 0 && a.stun) A.stunPlayer(O.playerStun(a.stun));
        if (v.rate.n === 1) E.floatText(p.x, p.y - 46, a.icon + ' ' + a.name, '#ffd0d5', 12, 0.9);
    }
    // Was I just knocked out by another player?
    ON.pvpKiller = function () { const l = game().lastPvp; return l && E.time - l.at < 6 ? l : null; };
    // Drop what a knocked-out player carried where they fell, for anyone to grab (the winner first)
    ON.dropLoot = function (mats, killer) {
        if (!ON.db || !ON.zone || ON.status !== 'online' || !mats || !Object.keys(mats).length) return false;
        const p = game().player;
        ON.db.push(Z('l'), { x: Math.round(p.x), y: Math.round(p.y), m: mats, by: myName(), k: killer ? killer.uid : '', o: ON.uid, t: ON.db.serverNow() });
        return true;
    };

    // ---------------- loot bags ----------------
    function onLoot(id, raw) {
        const bag = O.sanitizeLoot(raw);
        if (!bag) { if (raw && ON.db) ON.db.remove(Z('l/' + id)); return; }
        ON.loot.set(id, bag);
        if (bag.k === ON.uid && !ON.seenKills.has(id)) {
            ON.seenKills.add(id);
            const s = game().state;
            s.stats.pvpWins = (s.stats.pvpWins || 0) + 1;
            WHW.toast(`You knocked out ${bag.by}! Their loot is yours for ${O.LOOT.ownerSec} seconds.`, 'gold');
            WHW.sfx('boss');
        }
    }
    function lootTick() {
        const g = game(), p = g.player, now = ON.db.serverNow();
        for (const [id, bag] of ON.loot) {
            if (O.lootExpired(bag, now)) { ON.loot.delete(id); ON.db.remove(Z('l/' + id)); continue; }
            if (p.dead || ON.claiming.has(id) || Math.hypot(p.x - bag.x, p.y - bag.y) > O.LOOT.pickR) continue;
            if (!O.canClaim(bag, ON.uid, now)) {
                if (E.time - ON.lockHintAt > 3) { ON.lockHintAt = E.time; WHW.toast(`The winner gets first pick of ${bag.by}'s loot for a few seconds.`); }
                continue;
            }
            ON.claiming.add(id);
            ON.db.take(Z('l/' + id)).then((val) => {
                ON.claiming.delete(id);
                const b = O.sanitizeLoot(val);
                if (!b) return;
                W.giveAll(g.state, b.m, g.inTown);
                WHW.showLoot(g.player.x, g.player.y, { mats: b.m });
                WHW.toast(b.o === ON.uid ? 'You got your dropped loot back.' : `You grabbed ${b.by}'s loot.`, 'gold');
                WHW.sfx('gather');
                WHW.save();
            });
        }
    }

    // ---------------- chat ----------------
    function logLine(name, m, mine) {
        ON.log.push({ name, m, mine, at: Date.now() });
        if (ON.log.length > O.CHAT.logMax) ON.log.shift();
        if (WHW.ui.chatLogChanged) WHW.ui.chatLogChanged();
    }
    ON.say = function (text, emote) {
        if (!ON.db || !ON.zone) { WHW.toast('Chat works when you are online.'); return false; }
        if (E.time - ON.sayAt < O.CHAT.gapSec) return false;
        const m = emote ? (O.EMOTES.includes(text) ? text : null) : O.cleanChat(text);
        if (!m) return false;
        ON.sayAt = E.time;
        ON.db.update(Z('i/' + ON.uid), { say: { m, t: ON.db.serverNow(), e: !!emote } });
        const shown = safeMode() ? O.censor(m) : m;
        ON.myBubble = { m: shown, e: !!emote, until: E.time + O.CHAT.bubbleSec };
        logLine(myName(), shown, true);
        return true;
    };

    // ---------------- the shared boss ----------------
    function localBoss() { return game().actors.find(a => a.kind === 'boss' && !a.dead) || null; }
    function inArena(x, y) { const ar = game().map && game().map.boss; return !!ar && Math.hypot(x - ar.x, y - ar.y) < ar.r + 10; }
    function fighters() {
        const g = game(), p = g.player, out = [];
        if (!p.dead && inArena(p.x, p.y)) out.push({ uid: ON.uid, x: p.x, y: p.y, vx: p.vx, vy: p.vy, r: p.r });
        for (const r of ON.remotes.values()) if (!r.stale && !r.dead && inArena(r.x, r.y)) out.push({ uid: r.uid, x: r.x, y: r.y, vx: r.vx, vy: r.vy, r: r.r });
        return out;
    }
    // another page has been running the boss recently (its heartbeat arrived, even if our own write landed after it)
    const hostFresh = () => !!(ON.boss && ON.boss.h && performance.now() - ON.hostSeenAt < 1500);
    // Is this boss's fight shared right now?
    ON.bossShared = (b) => !!(b && b.kind === 'boss' && ON.db && ON.status === 'online' && ON.zone && ON.zone !== 'town' && ON.boss && ON.boss.gen && !ON.boss.killedAt);
    // The host's boss aims at the nearest player in the arena (could be someone else)
    ON.bossAim = function (b) {
        if (!ON.bossShared(b) || !ON.isHost) return null;
        let best = null, bd = Infinity;
        for (const f of fighters()) { const d = Math.hypot(f.x - b.x, f.y - b.y); if (d < bd) { bd = d; best = f; } }
        return best;
    };
    ON.bossFollower = (b) => ON.bossShared(b) && !ON.isHost && hostFresh() && inArena(game().player.x, game().player.y);
    // Outside the arena while others fight: just show the boss where the host has it
    ON.bossSpectate = function (b, dt) {
        if (!ON.bossShared(b) || inArena(game().player.x, game().player.y) || !hostFresh()) return false;
        const h = ON.boss.h, f = 1 - Math.exp(-10 * dt);
        b.x += (h.x - b.x) * f; b.y += (h.y - b.y) * f; b.facing = h.fa;
        return true;
    };
    ON.bossFollow = function (b, dt) {
        const h = ON.boss.h;
        if (!h) return;
        const f = 1 - Math.exp(-12 * dt);
        b.x += (h.x - b.x) * f; b.y += (h.y - b.y) * f;
        b.facing = h.fa;
        if (h.s !== ON.followSeq) {
            const first = ON.followSeq < 0;
            ON.followSeq = h.s;
            const move = A.BOSS_MOVES[h.a];
            if (move && !first) {
                const target = h.tg === ON.uid ? game().player : ON.remotes.get(h.tg);
                const at = target ? { x: target.x, y: target.y, vx: target.vx || 0, vy: target.vy || 0, r: 13 } : { x: h.tx, y: h.ty, vx: 0, vy: 0, r: 13 };
                b.atk = { a: move, name: h.a, t: 0, phase: 'windup', dir: h.d, tx: at.x, ty: at.y, hit: false, follow: true, aimPt: at };
            }
        }
    };
    ON.bossDamage = function (b, dmg) { if (ON.bossShared(b)) ON.bossPending += dmg; };
    function onBoss(raw) {
        const sb = O.sanitizeBoss(raw);
        const prevH = ON.boss && ON.boss.h;
        ON.boss = sb;
        if (!sb) return;
        // the host's heartbeat (n counts its updates): a boss standing still still shows the host is there
        if (sb.h && sb.h.u !== ON.uid && (!prevH || prevH.n !== sb.h.n || prevH.u !== sb.h.u)) ON.hostSeenAt = performance.now();
        const g = game(), b = localBoss(), now = ON.db.serverNow();
        if (O.bossDeadFor(sb, now, BOSS_RESPAWN)) {
            if (sb.gen && sb.gen !== ON.rewardedGen) {
                ON.rewardedGen = sb.gen;
                if (b && b.active) finishBoss(b, sb);
                else if (b) { b.dead = true; g.bossDeadUntil[g.zoneId] = E.time + Math.max(5, (BOSS_RESPAWN * 1000 - (now - sb.killedAt)) / 1000); }
            }
            return;
        }
        if (!b || sb.killedAt || O.bossNeedsReset(sb, now, BOSS_RESPAWN)) return;
        // our copy of the boss follows everyone's damage
        b.maxHp = sb.max;
        const shared = sb.hp - ON.bossPending;
        b.hp = sb.gen !== ON.bossGen ? Math.max(1, shared) : Math.max(1, Math.min(b.hp, shared));
        ON.bossGen = sb.gen;
        if (sb.hp <= 0) ON.db.update(Z('b'), { killedAt: now }); // the last hit: everyone gets told it's over
    }
    function finishBoss(b, sb) {
        const g = game();
        g.actors.filter(a => a.kind === 'clone' || a.summoned).forEach(a => { a.dead = true; });
        if (O.earnedReward(sb, ON.uid)) { b.hp = 0; A.kill(b, g.player); }
        else {
            b.dead = true;
            g.bossDeadUntil[g.zoneId] = E.time + BOSS_RESPAWN;
            WHW.toast(`${b.def.name} was defeated by other players. Deal more damage to share the reward next time.`);
        }
    }
    function flushBoss() {
        if (ON.bossPending <= 0) return;
        const n = Math.round(ON.bossPending * 10) / 10;
        ON.bossPending = 0;
        ON.db.update(Z('b'), { hp: ON.db.INC(-n), t: ON.db.serverNow(), ['f/' + ON.uid]: ON.db.INC(n) });
    }
    function bossTick(dt) {
        const g = game(), p = g.player, b = localBoss();
        if (!b) { ON.isHost = false; return; }
        const now = ON.db.serverNow();
        const meIn = !p.dead && inArena(p.x, p.y);
        // the host: lowest id in the arena (every page works out the same one)
        const fs = fighters();
        ON.hostUid = O.hostOf(fs.map(f => f.uid));
        // starting a fight: the host makes a fresh shared one when there is none (or the last is over)
        if (meIn && b.active && ON.status === 'online' && ON.hostUid === ON.uid && (!ON.boss || O.bossNeedsReset(ON.boss, now, BOSS_RESPAWN)) && E.time - ON.resetAt > 2) {
            ON.resetAt = E.time;
            const max = b.def.hp;
            ON.db.set(Z('b'), { hp: max, max, gen: Math.random().toString(36).slice(2, 10), t: now, killedAt: 0 });
        }
        if (!ON.bossShared(b)) { ON.isHost = false; return; }
        ON.bossT -= dt;
        if (ON.bossPending > 0 && (ON.bossT <= 0 || b.hp <= 1)) { ON.bossT = O.BOSS.flushSec; flushBoss(); }
        // run the boss if we are the host, or if whoever was running it has gone quiet (their tab hidden, say)
        ON.isHost = meIn && (ON.hostUid === ON.uid || !hostFresh());
        if (ON.isHost) {
            ON.hostT -= dt;
            if (ON.hostT <= 0) {
                ON.hostT = 1 / O.BOSS.hostHz;
                const k = b.atk;
                if (k && k.name) ON.lastHost = { a: k.name, d: k.dir, tg: k.aimUid || ON.uid, tx: k.tx, ty: k.ty };
                const last = ON.lastHost || { a: '', d: 0, tg: '', tx: 0, ty: 0 };
                ON.db.update(Z('b'), { h: { u: ON.uid, x: Math.round(b.x), y: Math.round(b.y), fa: Math.round(b.facing * 100) / 100, s: b.atkSeq || 0, a: last.a, d: Math.round(last.d * 100) / 100, tg: last.tg, tx: Math.round(last.tx), ty: Math.round(last.ty), ph: b.phase || 0, n: (ON.hostN = (ON.hostN || 0) + 1) } });
            }
        }
    }

    // ---------------- drawing ----------------
    // remote players go into the y-sorted draw list (world.js); loot bags lie on the ground; bubbles go on top
    ON.drawables = function () { return ON.zone ? [...ON.remotes.values()].filter(r => !r.stale && r.info) : []; };
    ON.drawGround = function (ctx) {
        if (!ON.db) return;
        const now = ON.db.serverNow();
        for (const bag of ON.loot.values()) A.drawLootBag(ctx, bag, !O.canClaim(bag, ON.uid, now));
    };
    ON.drawTop = function (ctx) {
        const p = game().player;
        for (const r of ON.remotes.values()) if (r.bubble && r.bubble.until > E.time && !r.stale) A.drawBubble(ctx, r.x, r.y - r.r - 26, r.bubble.m, r.bubble.e, r.bubble.until - E.time);
        if (ON.myBubble && ON.myBubble.until > E.time) A.drawBubble(ctx, p.x, p.y - p.r - 26, ON.myBubble.m, ON.myBubble.e, ON.myBubble.until - E.time);
    };
})();
