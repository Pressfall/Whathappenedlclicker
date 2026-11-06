/**
 * The Proving Grounds (world.html, zone 'trials'): co-op waves of monsters, harder with every player in the room. The rules
 * and the shared run's shape are core/world-waves.js; rewards change the save through core/world-logic.js waveCleared.
 * Online, one page (the host: the lowest id in the room, replaced when it goes quiet) runs the wave: it spawns the monsters,
 * runs their AI (they chase whoever is nearest, on any page) and shares a snapshot of where they are and what they attack
 * a few times a second (w/h). Every other page builds the same monsters from the same composition, moves them to where
 * the snapshot says and replays their attacks, which only ever hurt that page's own player. Damage to monsters is added up
 * for everyone (w/m, like a shared boss), stuns travel as small events (w/x), and knockback stays on the page that dealt it.
 * Alone or offline, this page is the host and nothing is sent.
 *
 * The Sunken Vault (zone 'vault', core/world-vault.js) runs its rooms the same way: a room is one "wave" (its monsters from
 * roomComposition), started from its ready circle, sealed while it is fought; clearing it opens the next door (syncDoors),
 * and once the third is clear the Drowned King wakes in his chamber. A wipe sends the party back to before that room.
 */
(function () {
    'use strict';
    const D = window.WHWorldData, W = window.WHWorld, Wv = window.WHWorldWaves, O = window.WHWorldOnline, Vt = window.WHWorldVault, G = window.WHWorldGen;
    const WHW = window.WHW, E = WHW.engine, A = WHW.actors;
    const game = () => WHW.game;
    const net = () => WHW.online;
    // the co-op zone this page is in: the Proving Grounds ('trials') or the Sunken Vault ('vault')
    const coopZone = () => { const z = game() && game().zoneId; return z && D.ZONES[z] && D.ZONES[z].coop ? z : 'trials'; };
    const isVault = () => !!(game() && game().zoneId === 'vault');
    const shared = () => !!(net() && net().db && net().status === 'online' && net().zone === coopZone());
    const me = () => (shared() ? net().uid : 'me');
    const sNow = () => (net() && net().db ? net().db.serverNow() : Date.now());
    const Z = (sub) => (net() && net().Z ? net().Z(sub) : O.ROOT + '/trials' + (sub ? '/' + sub : ''));
    const needsReset = (r, now) => (isVault() ? Vt.runNeedsReset(r, now) : Wv.runNeedsReset(r, now));
    // where this run's monsters come in, and where a player gets back up
    function gatesOf(r) { const g = game(); return isVault() ? (g.map.rooms[(r.wave || 1) - 1] || g.map.rooms[0]).gates : g.map.gates; }
    function upSpot() { const g = game(); return isVault() ? g.map.entry : g.map.ready; }
    const fmt = (n) => Math.round(n).toLocaleString('en-US');
    const R = Wv.RATE;

    const WV = WHW.waves = {
        run: null, comp: [], compKey: '', spawned: new Set(), dead: new Set(), seen: new Set(), snap: new Map(),
        pending: {}, flushT: 0, hostT: 0, hostN: 0, hostSeenAt: 0, lastHostN: -1, isHost: true, wasHost: true,
        paid: '', eligibleFrom: 0, eligibleGen: '', upAt: 0, prevSt: '', prevWave: 0,
    };

    // ---------------- who is in the room ----------------
    function others() { return shared() ? [...net().remotes.values()].filter(r => !r.stale && r.info) : []; }
    function present() { return [me()].concat(others().map(r => r.uid)).slice(0, R.maxPlayers); }
    WV.players = () => present().length;
    // a wave monster's target (on the host): whoever in the room is nearest and still standing
    WV.targetFor = function (m) {
        const p = game().player;
        let best = p.dead ? null : p, bd = p.dead ? Infinity : Math.hypot(p.x - m.x, p.y - m.y);
        for (const r of others()) { if (r.dead) continue; const d = Math.hypot(r.x - m.x, r.y - m.y); if (d < bd) { bd = d; best = r; } }
        return best || p;
    };
    function waveActors() { return game().actors.filter(a => a.wave && !a.dead); }
    function byMid(mid) { return game().actors.find(a => a.wave && a.wave.mid === mid && !a.dead) || null; }

    // ---------------- the run ----------------
    WV.onRun = function (raw) {
        const r = Wv.sanitizeRun(raw);
        if (r && r.h && r.h.u !== me() && r.h.n !== WV.lastHostN) { WV.lastHostN = r.h.n; WV.hostSeenAt = performance.now(); WV.snap = Wv.unpackSnap(r.h.s); }
        if (r && WV.isHost && r.x.length) {
            // stuns other players dealt: the host's monsters feel them too
            for (const e of r.x) { const m = byMid(e.mid); if (m) m.status.stunUntil = Math.max(m.status.stunUntil, E.time + e.st); if (net() && net().db) net().db.remove(Z('w/x/' + e.id)); }
        }
        setRun(r);
    };
    function setRun(r) {
        const prev = WV.run;
        if (!r) { if (prev) clearMonsters(); WV.run = null; return; }
        if (!prev || prev.gen !== r.gen) {
            clearMonsters();
            // joining a wave already being fought: paid from the next one
            WV.eligibleGen = r.gen; WV.eligibleFrom = r.st === 'fight' ? r.wave + 1 : r.wave;
            WV.prevSt = ''; WV.prevWave = 0;
        }
        WV.run = r;
        // everyone's copies follow the shared damage
        for (const m of waveActors()) {
            const max = m.maxHp, target = max - (r.m[m.wave.mid] || 0) - (WV.pending[m.wave.mid] || 0);
            m.hp = Math.min(m.hp, target);
            if (!WV.isHost) m.hp = Math.max(1, m.hp);
        }
        changed();
    }
    // the run moved on (a wave started, was cleared, or the run ended): what each page does about it
    function changed() {
        const r = WV.run, g = game(), p = g.player, s = g.state;
        if (!r || (r.st === WV.prevSt && r.wave === WV.prevWave)) return;
        const was = WV.prevSt, wasWave = WV.prevWave;
        WV.prevSt = r.st; WV.prevWave = r.wave;
        if (isVault()) syncDoors();
        if (r.st === 'fight') {
            WV.comp = isVault() ? Vt.roomComposition(r.seed, r.wave, r.n) : Wv.composition(r.seed, r.wave, r.n);
            WV.spawned = new Set(); WV.dead = new Set(); WV.seen = new Set();
            if (isVault()) {
                const room = g.map.rooms[r.wave - 1];
                WHW.banner(Vt.ROOMS[r.wave - 1].name, 'Room ' + r.wave + ' of ' + Vt.ROOMS.length + (r.n > 1 ? ' · ' + r.n + ' players' : ''));
                // the room seals: anyone not inside is brought in
                if (room && !p.dead && Math.hypot(p.x - room.floor.x, p.y - room.floor.y) > room.floor.r - 20) { p.x = room.floor.x; p.y = room.floor.y + room.floor.r * 0.55; E.snapCamera(); }
            } else WHW.banner('Wave ' + r.wave, (r.n > 1 ? r.n + ' players · ' : '') + D.ZONES[Wv.zoneFor(r.wave)].name + "'s monsters");
        } else if (isVault() && r.st === 'break' && was === 'fight' && r.wave < wasWave) {
            // everyone went down: that room again, when the party is ready
            clearMonsters();
            WHW.banner('The room is lost', Vt.ROOMS[wasWave - 1].name + ' again from its ready circle');
            if (p.dead) WV.upAt = E.time + 3;
        } else if (isVault() && r.st === 'break' && was === 'fight') {
            const w = r.wave, key = r.gen + ':' + w;
            if (WV.paid !== key && r.gen === WV.eligibleGen && w >= WV.eligibleFrom) {
                WV.paid = key;
                const got = W.vaultRoomCleared(s, w, sNow());
                WHW.banner(Vt.ROOMS[w - 1].name + ' cleared!', (got.rubies ? '+' + fmt(got.rubies) + ' rubies · ' : '') + (w < Vt.ROOMS.length ? 'the way on is open' : "the King's chamber is open"));
                WHW.save();
            } else WHW.banner(Vt.ROOMS[w - 1].name + ' cleared!', w < Vt.ROOMS.length ? 'The way on is open' : "The King's chamber is open");
            if (p.dead) up(0.5);
        } else if (r.st === 'break' && was === 'fight') {
            const w = r.wave, key = r.gen + ':' + w;
            if (WV.paid !== key && r.gen === WV.eligibleGen && w >= WV.eligibleFrom) {
                WV.paid = key;
                const got = W.waveCleared(s, w, sNow());
                WHW.banner('Wave ' + w + ' cleared!', '+' + fmt(got.rubies) + ' rubies' + (got.glory ? ', +' + got.glory + ' Glory' : '') + (got.milestone ? ' · a milestone!' : ''));
                if (got.best && w >= 5) WHW.toast('New best wave: ' + w + '!', 'gold');
                // the Proving Grounds' leaderboard (world-arena.js Leaderboards tab)
                if (got.best && net() && net().db) net().writeBoard('waves', window.WHWorldArena.wavesRecord(net().name(), s.arena, r.n || 1, sNow()));
                WHW.save();
            } else WHW.banner('Wave ' + w + ' cleared!', 'Next wave soon');
            if (p.dead) up(0.5);
        } else if (r.st === 'over' && isVault()) {
            clearMonsters();
        } else if (r.st === 'over') {
            clearMonsters();
            WHW.banner('The run is over', 'You held out until wave ' + (was === 'fight' ? wasWave : r.wave));
            if (p.dead) WV.upAt = E.time + 2.5;
        }
    }
    // The Vault's doors follow the run (core/world-vault.js doorOpen), and the King wakes once the third room is clear
    WV.syncDoors = syncDoors;
    function syncDoors() {
        const g = game();
        if (!isVault() || !g.map || !g.map.rooms) return;
        let changedTiles = false;
        for (let i = 1; i <= Vt.KING_ROOM; i++) changedTiles = G.setVaultDoor(g.map, i, Vt.doorOpen(WV.run, i)) || changedTiles;
        if (changedTiles) { E.setMap(g.map); E.buildNodeGrid(g.nodes); }
        if (Vt.kingOpen(WV.run) && !g.actors.some(a => a.kind === 'boss' && !a.dead) && E.time >= (g.bossDeadUntil.vault || 0)) g.actors.push(A.makeBoss(Vt.BOSS, g.map.boss.x, g.map.boss.y));
    }
    // the Drowned King fell (world-actors.js): the run is done; a new one can start from the first room
    WV.kingDown = function () {
        if (!isVault() || !WV.run || WV.run.st === 'over') return;
        setState({ st: 'over', wave: Vt.KING_ROOM });
        WHW.banner('The Drowned King is beaten!', 'The Vault is yours. Start over from the first room any time.');
    };
    function clearMonsters() { for (const m of game().actors) if (m.wave) m.dead = true; WV.snap = new Map(); WV.pending = {}; }
    // a change of the run's state, written by the host (shared: to the database; alone: here)
    function setState(patch) {
        patch.t = sNow();
        if (shared()) net().db.update(Z('w'), patch);
        setRun(Object.assign({}, WV.run, patch));
    }
    // Start a run from the ready circle (or a new one, when the last is over)
    WV.start = function () {
        const now = sNow();
        if (isVault()) return startRoom(now);
        if (WV.run && !Wv.runNeedsReset(WV.run, now)) { WHW.toast('A run is already going: get in the ring!'); return; }
        const start = Wv.startWave(); // every run starts at wave 1
        const run = { gen: Math.random().toString(36).slice(2, 10), seed: Math.floor(Math.random() * 1e9), start, wave: start, st: 'ready', n: WV.players(), at: now + R.readySec * 1000, t: now };
        if (shared()) net().db.set(Z('w'), run);
        setRun(Object.assign({ m: {}, x: [], h: null }, run));
        WHW.toast('The waves are coming, from wave 1. Hold the ring! (' + D.RULES.potionsPerMatch + ' potions per run)');
    };
    // The Vault: start the next room (a fresh run when there is none, it went quiet, or the King is already down)
    function startRoom(now) {
        const r = WV.run, fresh = !r || Vt.runNeedsReset(r, now) || r.st === 'over';
        const next = fresh ? 1 : Vt.nextRoom(r);
        if (!next) { WHW.toast(r.st === 'fight' || r.st === 'ready' ? 'A room is already going.' : 'Every room is clear: the Drowned King waits at the far end.'); return; }
        const at = now + Vt.RUN.readySec * 1000;
        if (fresh) {
            const run = Object.assign(Vt.newRun(now), { st: 'ready', wave: 1, n: WV.players(), at });
            if (shared()) net().db.set(Z('w'), run);
            setRun(Object.assign({ m: {}, x: [], h: null }, run));
        } else setState({ st: 'ready', wave: next, n: WV.players(), at });
        WHW.toast(Vt.ROOMS[next - 1].name + ': get ready! (' + D.RULES.potionsPerMatch + ' potions per room)');
    }
    // the ready circle the Vault's next room starts from (null when there is none to start)
    WV.vaultReady = function () {
        const g = game(), r = WV.run, now = sNow();
        if (!isVault() || !g.map.rooms) return null;
        const next = !r || Vt.runNeedsReset(r, now) || r.st === 'over' ? 1 : Vt.nextRoom(r);
        if (next) return g.map.rooms[next - 1].ready;
        if (r && r.st === 'ready') return g.map.rooms[r.wave - 1].ready;
        return null;
    };
    WV.promptText = function () {
        const r = WV.run, now = sNow();
        if (isVault()) {
            if (r && r.st === 'ready' && !needsReset(r, now)) return { text: Vt.ROOMS[r.wave - 1].name + ' in ' + Math.max(0, Math.ceil((r.at - now) / 1000)) + 's: get in!', can: false };
            const next = !r || needsReset(r, now) || r.st === 'over' ? 1 : Vt.nextRoom(r);
            return { text: '<kbd>E</kbd>🔱 Start ' + Vt.ROOMS[next - 1].name + (WV.players() > 1 ? ' with ' + (WV.players() - 1) + ' other' + (WV.players() > 2 ? 's' : '') : ''), can: true };
        }
        if (!r || Wv.runNeedsReset(r, now)) return { text: '<kbd>E</kbd>⚔️ Start the waves' + (WV.players() > 1 ? ' with ' + (WV.players() - 1) + ' other' + (WV.players() > 2 ? 's' : '') : ''), can: true };
        if (r.st === 'ready') return { text: 'Starting in ' + Math.max(0, Math.ceil((r.at - now) / 1000)) + 's: get in the ring!', can: false };
        if (r.st === 'break') return { text: 'Wave ' + (r.wave + 1) + ' in ' + Math.max(0, Math.ceil((r.at - now) / 1000)) + 's', can: false };
        if (r.st === 'over') return { text: 'The run is over. Start a new one in a moment.', can: false };
        return { text: 'Wave ' + r.wave + ' is on: get in there!', can: false };
    };
    // knocked out in the Proving Grounds: out until the wave is cleared (if anyone is still standing)
    WV.knockedOut = function () {
        const p = game().player;
        p.dead = true;
        // the Vault outside a room's fight (the King, or walking): back up at the entrance in a moment
        if (isVault() && !(WV.run && WV.run.st === 'fight')) { WV.upAt = E.time + 4; WHW.toast('Down! Back on your feet at the entrance in a moment. Nothing is lost in the Vault.', 'bad'); return; }
        if (isVault()) { WHW.toast(WV.players() > 1 ? 'Down! You get back up when your party clears the room.' : 'Down! The room is lost.', 'bad'); return; }
        WHW.toast(WV.players() > 1 ? 'Down! You get back up when your team clears the wave.' : 'Down! The run is over.', 'bad');
    };
    function up(share) {
        const g = game(), p = g.player;
        p.dead = false; p.hp = Math.max(1, g.pstats.maxHp * share); p.status.burnUntil = 0; p.stunUntil = 0; p.slow = 0;
        p.stam.val = D.COMBAT.stamina.max; p.stam.winded = false; p.iframes = 1;
    }
    WV.zoneEntered = function (from, to) {
        const coop = (z) => !!(D.ZONES[z] && D.ZONES[z].coop);
        if (coop(from) && to !== from) { if (!shared() && WV.run) WV.run = null; WV.prevSt = ''; WV.comp = []; WV.snap = new Map(); if (from === 'vault') WV.run = null; }
        if (coop(to) && !shared()) WV.run = null;
        if (to === 'vault') syncDoors();
    };

    // ---------------- damage, kills and stuns (hooks from world-actors.js) ----------------
    // Damage to a wave monster. Returns true when this page must not kill it itself (the host does)
    WV.shareDamage = function (t, dmg) {
        if (shared()) WV.pending[t.wave.mid] = (WV.pending[t.wave.mid] || 0) + dmg;
        return !WV.isHost;
    };
    WV.mayKill = () => WV.isHost;
    WV.killed = function (t) { WV.dead.add(t.wave.mid); };
    function flush() {
        const ks = Object.keys(WV.pending);
        if (!ks.length || !shared()) { WV.pending = {}; return; }
        const up = {};
        let total = 0;
        for (const k of ks) { const n = Math.round(WV.pending[k] * 10) / 10; if (n > 0) { up['m/' + k] = net().db.INC(n); total += n; } }
        WV.pending = {};
        if (total) { up['f/' + net().uid] = net().db.INC(total); net().db.update(Z('w'), up); }
    }

    // ---------------- each step ----------------
    WV.update = function (dt) {
        const g = game(), p = g.player;
        if (!D.ZONES[g.zoneId] || !D.ZONES[g.zoneId].coop) { renderHud(); return; }
        const r = WV.run, now = sNow();
        if (WV.upAt && E.time >= WV.upAt) { WV.upAt = 0; up(1); const rc = upSpot(); p.x = rc.x; p.y = rc.y; E.snapCamera(); }
        // the Vault is a party's: without one (it broke up, or this page lost it) it is back to town
        if (isVault() && !(WHW.party && WHW.party.id)) { WHW.toast('Your party is gone, so the Vault closes behind you.', 'bad'); WHW.actions.leaveVault(); return; }
        // who runs the waves: the lowest id here; if they go quiet (a hidden tab, a paused page), the next lowest
        const hostUid = Wv.hostOf(present());
        let host = !shared() || hostUid === me();
        if (!host && r && performance.now() - WV.hostSeenAt > R.hostQuietMs) host = present().filter(u => u !== hostUid).sort()[0] === me();
        WV.isHost = host;
        if (WV.isHost && !WV.wasHost) takeOver();
        else if (!WV.isHost && WV.wasHost) demote();
        WV.wasHost = WV.isHost;
        WV.flushT -= dt;
        if (WV.flushT <= 0) { WV.flushT = R.flushSec; flush(); }
        if (r) {
            if (WV.isHost) hostStep(r, now, dt);
            else followStep(dt);
        }
        renderHud();
    };
    function hostStep(r, now, dt) {
        const g = game(), p = g.player;
        if (r.st === 'ready' && now >= r.at) setState({ st: 'fight', wave: r.wave, n: WV.players(), at: now });
        else if (r.st === 'break' && now >= r.at && !isVault()) {
            // last wave's damage tallies are done with
            if (shared()) { const old = {}; for (const k in r.m) old['m/' + k] = null; if (Object.keys(old).length) net().db.update(Z('w'), old); }
            setState({ st: 'fight', wave: r.wave + 1, n: WV.players(), at: now });
        } else if (r.st === 'fight') {
            const alive = waveActors();
            // the wave's monsters arrive in batches through the six gates
            for (const c of WV.comp) {
                if (WV.spawned.has(c.mid) || now < r.at + c.delay * 1000 || alive.length >= Wv.WAVES.maxAlive) continue;
                const gates = gatesOf(r);
                spawn(c, gates[c.gate % gates.length]);
                alive.push(1);
            }
            for (const m of waveActors()) if (m.hp <= 0) A.kill(m, null);
            if (WV.comp.length && WV.comp.every(c => WV.dead.has(c.mid))) setState({ st: 'break', at: now + R.breakSec * 1000 });
            // everyone down: the run is over (the Vault: that room is lost, the ones before stay cleared)
            else if (p.dead && others().every(o => o.dead)) setState(isVault() ? Vt.wiped(r) : { st: 'over', at: now });
        }
        // the snapshot for everyone else
        WV.hostT -= dt;
        if (shared() && WV.hostT <= 0) {
            WV.hostT = 1 / R.hostHz;
            const list = waveActors().sort((a, b) => (b.elite ? 1 : 0) - (a.elite ? 1 : 0)).map(m => ({ mid: m.wave.mid, x: m.x, y: m.y, fa: m.facing, as: m.atkSeq || 0, ai: m.atkI || 0, tx: m.atkTx, ty: m.atkTy }));
            net().db.update(Z('w'), { h: { u: net().uid, n: (WV.hostN = WV.hostN + 1), s: Wv.packSnap(list) } });
        }
    }
    function spawn(c, gate, at) {
        const g = game(), def = D.MONSTERS[c.type];
        const m = A.makeMonster(c.type, (at || gate).x, (at || gate).y, { hpMult: c.hpMult, dmgMult: c.dmgMult, champion: c.champion, name: c.champion ? 'Champion ' + def.name : undefined, summoned: true });
        m.wave = { mid: c.mid }; m.aggro = true; m.home = { x: m.x, y: m.y };
        const done = WV.run && WV.run.m[c.mid];
        if (done) m.hp = Math.max(1, m.maxHp - done);
        E.collideTiles(m);
        g.actors.push(m);
        WV.spawned.add(c.mid);
        if (!at) E.burst(m.x, m.y, '#ff9a3d', 14, 160, { life: 0.5 });
        return m;
    }
    // A follower: the monsters are where the host's snapshot says; new ones appear, gone ones fell
    function followStep(dt) {
        const fresh = performance.now() - WV.hostSeenAt < 3000;
        if (!fresh || !WV.run || WV.run.st !== 'fight') return;
        for (const [mid, sn] of WV.snap) {
            let m = byMid(mid);
            if (!m && !WV.seen.has(mid)) {
                const c = WV.comp.find(x => x.mid === mid);
                if (!c) continue;
                m = spawn(c, null, sn);
                m.follow = true;
                m.netX = sn.x; m.netY = sn.y; m.lastAs = sn.as;
            }
            WV.seen.add(mid);
            if (!m) continue;
            m.follow = true;
            m.netX = sn.x; m.netY = sn.y; m.netFa = sn.fa;
            if (sn.as !== m.lastAs) {
                m.lastAs = sn.as;
                const a = m.def.attacks[sn.ai];
                if (a) m.atk = { a, i: sn.ai, t: 0, phase: 'windup', dir: Math.atan2(sn.ty - m.y, sn.tx - m.x), tx: sn.tx, ty: sn.ty, hit: false, follow: true, aimPt: { x: sn.tx, y: sn.ty, vx: 0, vy: 0, r: 13 } };
            }
            // a stun dealt here reaches the host's monster too
            if (m.status.stunUntil > E.time && m.status.stunUntil > (m.stunSent || 0) + 0.1) {
                m.stunSent = m.status.stunUntil;
                net().db.push(Z('w/x'), { from: net().uid, mid, st: Math.min(3, Math.round((m.status.stunUntil - E.time) * 10) / 10), t: sNow() });
            }
        }
        for (const m of waveActors()) if (WV.seen.has(m.wave.mid) && !WV.snap.has(m.wave.mid)) { m.dead = true; E.burst(m.x, m.y, m.def.color, 18, 180, { life: 0.7, size: 4 }); WV.dead.add(m.wave.mid); }
    }
    // someone else runs the waves again: keep only the monsters their snapshot has
    function demote() {
        for (const m of waveActors()) { if (WV.snap.has(m.wave.mid)) m.follow = true; else m.dead = true; }
    }
    // the host went quiet and this page runs the waves now: its copies become the real monsters
    function takeOver() {
        for (const m of waveActors()) { m.follow = false; m.atk = null; WV.spawned.add(m.wave.mid); }
        for (const mid of WV.seen) if (!byMid(mid)) { WV.spawned.add(mid); WV.dead.add(mid); }
    }

    // ---------------- the HUD ----------------
    let hudKey = '';
    function renderHud() {
        const g = game(), r = WV.run;
        let html = '';
        if (isVault() && r && !needsReset(r, sNow())) {
            const left = r.st === 'fight' ? Math.max(0, WV.comp.length - WV.dead.size) : 0, secs = Math.max(0, Math.ceil((r.at - sNow()) / 1000));
            const where = r.st === 'over' ? 'the Drowned King is beaten' : Vt.kingOpen(r) ? "the King's chamber is open" : r.st === 'fight' ? Vt.ROOMS[r.wave - 1].name + ' · ' + left + ' left'
                : r.st === 'ready' ? Vt.ROOMS[r.wave - 1].name + ' in ' + secs + 's' : 'rooms cleared: ' + Vt.cleared(r) + ' of ' + Vt.ROOMS.length;
            html = `🔱 ${where} · ${WV.players()} in the party here${WV.isHost && shared() && WV.players() > 1 ? ' · you run it' : ''}`;
        } else if (g.zoneId === 'trials' && r && !Wv.runNeedsReset(r, sNow())) {
            const left = r.st === 'fight' ? Math.max(0, WV.comp.length - WV.dead.size) : 0;
            const secs = Math.max(0, Math.ceil((r.at - sNow()) / 1000));
            const what = r.st === 'fight' ? left + ' left' : r.st === 'ready' ? 'starting in ' + secs + 's' : r.st === 'break' ? 'next wave in ' + secs + 's' : 'over';
            html = `Wave <b>${r.st === 'break' ? r.wave + 1 : r.wave}</b> · ${what} · ${WV.players()} player${WV.players() > 1 ? 's' : ''}${WV.isHost && shared() && WV.players() > 1 ? ' · you run it' : ''}`;
        }
        if (html === hudKey) return;
        hudKey = html;
        let e = document.getElementById('wavesHud');
        if (!e) { e = document.createElement('div'); e.id = 'wavesHud'; e.className = 'w-waves-hud'; document.getElementById('wHud').appendChild(e); }
        e.hidden = !html;
        e.innerHTML = html;
    }
})();
