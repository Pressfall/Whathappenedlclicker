/**
 * Shared monsters (world.html): the zone's monsters are the same for everyone in it. The rules and the wire format are
 * core/world-mobs.js; this file connects them to the monsters on this page.
 *
 * Every page builds its own monsters (same places, same kinds, from the zone's seed). What is shared is small:
 *  - k/<id>: the server time a monster fell. Every page's copy dies and comes back on that clock.
 *  - m/<uid>: only the monsters this player is fighting: who runs each one's AI, where it is, its latest attack and the damage
 *    dealt to it. The player who woke a monster runs it (the lowest id if two did); the others see it where that player has it,
 *    carried on at its last speed between reports, and replay its attacks against their own player.
 *  - A monster's health is its maximum less everyone's damage. Whoever fought it shares the loot when it falls.
 * Nothing is sent while you are alone in a zone or nobody fights.
 */
(function () {
    'use strict';
    const D = window.WHWorldData, Mb = window.WHWorldMobs, O = window.WHWorldOnline;
    const WHW = window.WHW, E = WHW.engine, A = WHW.actors;
    const game = () => WHW.game;
    const net = () => WHW.online;
    const R = Mb.RATE;

    const M = WHW.mobs = { kills: new Map(), peers: new Map(), sendT: 0, n: 0, sentAny: false, path: null, zone: null };

    // is the zone I am in shared with others right now?
    function connected() { const o = net(); return !!(o && o.db && o.status === 'online' && o.zone && o.zone === game().zoneId); }
    // online at all (a zone's monsters are built before the page has joined it: they are made the shared way, and the kills
    // the database knows of are taken into account once they arrive)
    function onlineAtAll() { const o = net(); return !!(o && o.db && o.status === 'online'); }
    const known = () => M.zone === game().zoneId; // the kills I hold are this zone's
    function others() { return connected() ? net().here().length : 0; }
    const sNow = () => (connected() ? net().db.serverNow() : Date.now());
    M.live = () => connected() && others() > 0;

    // ---------------- joining and leaving a zone (world-online.js) ----------------
    M.join = function (db, path, subs) {
        M.reset();
        M.path = path;
        M.zone = net().zone;
        subs.push(db.onChild(path('k'), { add: onKill, change: onKill }));
        subs.push(db.onChild(path('m'), { add: onPeer, change: onPeer, remove: (uid) => M.peers.delete(uid) }));
    };
    M.reset = function () { M.kills.clear(); M.peers.clear(); M.sendT = 0; M.sentAny = false; M.path = null; M.zone = null; };

    // ---------------- spawning (world.js) ----------------
    // the kind of monster a spawn point makes now: the same on every page online, random otherwise
    M.kindFor = function (zoneId, spawn, member) {
        if (!onlineAtAll()) return null;
        return Mb.pickType(zoneId, spawn, known() ? M.kills.get(Mb.sid(spawn, member)) || 0 : 0);
    };
    M.genOf = (id) => (onlineAtAll() && known() ? M.kills.get(id) || 0 : 0);
    // a kill still inside its respawn window: the monster is not there yet (seconds left, or 0)
    M.waitFor = function (id, elite) {
        const t = M.kills.get(id);
        if (!connected() || !Mb.killFresh(t, sNow(), elite)) return 0;
        return Math.max(0, (t + Mb.respawnSec(elite) * 1000 - sNow()) / 1000);
    };

    // ---------------- damage and kills (world-actors.js) ----------------
    M.damaged = function (t, dmg) { if (t.sid) { t.myDmg = (t.myDmg || 0) + dmg; t.mineAt = E.time; } };
    // does the player get this monster's loot? Online with others there: only those who fought it
    M.paysOut = function (t, by) { return !M.live() || (t.myDmg || 0) > 0 || by === game().player; };
    // A monster fell on this page. Tells the others when I fought it, and says how many seconds until it is back.
    M.killed = function (t, by) {
        const elite = !!t.elite, sec = Mb.respawnSec(elite);
        if (!t.sid || !connected()) return sec;
        if (t.remoteKill) return Math.max(1, M.waitFor(t.sid, elite) || sec);
        if (M.live() && M.paysOut(t, by)) {
            const T = net().db.serverNow();
            M.kills.set(t.sid, T);
            net().db.update(M.path(''), { ['k/' + t.sid]: T });
            M.sendT = 0; // my report no longer lists it: send that soon
        }
        return sec;
    };
    function onKill(id, raw) {
        if (!Mb.validSid(id)) return;
        const T = Mb.sanitizeKill(raw);
        if (!T) return;
        const g = game(), now = sNow();
        // a long-dead record: take it away so the list stays short
        if (Mb.killStale(T, now)) { if (connected() && net().db) net().db.remove(M.path('k/' + id)); }
        if ((M.kills.get(id) || 0) >= T) return;
        M.kills.set(id, T);
        for (const m of g.actors) {
            if (m.dead || m.sid !== id || (m.gen || 0) >= T) continue;
            if (Mb.killFresh(T, now, m.elite)) {
                // someone else brought it down: it falls here too (the loot is for those who fought it)
                m.remoteKill = true; m.hp = 0;
                A.kill(m, null);
            } else if (!m.aggro && !(m.myDmg > 0)) {
                // its record is old: it has already come back, as another kind
                m.dead = true;
                g.respawns.push({ spawn: m.spawn, member: m.member, elite: m.elite, at: E.time });
            }
        }
    }
    function onPeer(uid, val) {
        if (uid === net().uid) return;
        const rec = Mb.unpack(val);
        if (!rec) { M.peers.delete(uid); return; }
        const at = performance.now(), prev = M.peers.get(uid);
        net().net.inN++; net().net.inBytes += String(val).length + 60;
        // each monster's speed between two reports, to carry it on in between
        for (const it of rec.items.values()) {
            const old = prev && prev.items.get(it.sid);
            it.vx = it.vy = 0;
            if (old && old.d && it.d) {
                const dt = (at - prev.at) / 1000;
                if (dt > 0.05 && dt < 1.5) { it.vx = (it.x - old.x) / dt; it.vy = (it.y - old.y) / dt; if (Math.hypot(it.vx, it.vy) > 400) it.vx = it.vy = 0; }
            }
        }
        M.peers.set(uid, { uid, at, n: rec.n, items: rec.items });
    }

    // ---------------- each step ----------------
    M.update = function (dt) {
        const g = game(), p = g.player;
        if (!connected() || !p || g.inTown) return;
        const now = performance.now(), peers = [];
        for (const [uid, pe] of M.peers) {
            pe.fresh = now - pe.at < R.freshMs;
            if (pe.fresh || now - pe.at < 10000) peers.push(pe); else M.peers.delete(uid);
        }
        const me = net().uid;
        for (const m of g.actors) {
            if (m.dead || !m.sid || m.kind !== 'monster') continue;
            const mine = m.aggro && !m.follow && !m.returning;
            const st = Mb.standing(m.sid, peers, mine, me);
            if (st.driver && st.driver !== me) follow(m, peers.find(q => q.uid === st.driver), now);
            else if (m.follow) release(m);
            // health: everyone's damage together
            if (!m.returning && (m.aggro || m.follow) && (st.others > 0 || m.myDmg > 0)) {
                m.hp = Mb.pooledHp(m.hp, m.maxHp, m.myDmg || 0, st.others);
                if (m.hp <= 0) { m.hp = 0; A.kill(m, null); }
            } else if (!(m.myDmg > 0) || m.returning || (!m.aggro && !m.follow && E.time - (m.mineAt || 0) > R.engagedSec)) m.myDmg = 0;
        }
        M.sendT -= dt;
        if (M.sendT <= 0) { M.sendT = 1 / R.sendHz; send(); }
    };
    // this monster is run by another player: it goes where they have it, and its attacks play out here
    function follow(m, pe, now) {
        const it = pe && pe.items.get(m.sid);
        if (!it) return;
        const ahead = Math.min(R.extrapolateSec, (now - pe.at) / 1000);
        if (!m.follow) { m.follow = true; m.aggro = true; m.returning = false; m.lastAs = it.as; }
        m.netX = it.x + (it.vx || 0) * ahead; m.netY = it.y + (it.vy || 0) * ahead; m.netFa = it.fa;
        if (it.as !== m.lastAs) {
            m.lastAs = it.as;
            const a = m.def.attacks[it.ai];
            if (a) m.atk = { a, i: it.ai, t: 0, phase: 'windup', dir: Math.atan2(it.ty - m.y, it.tx - m.x), tx: it.tx, ty: it.ty, hit: false, follow: true, aimPt: { x: it.tx, y: it.ty, vx: 0, vy: 0, r: 13 } };
        }
        // one nobody is near on this page isn't stepped: put it where it is
        const p = game().player;
        if (Math.abs(m.x - p.x) > 1100 || Math.abs(m.y - p.y) > 900) { m.x = m.netX; m.y = m.netY; }
    }
    // the player who ran it is gone (or done): it carries on from here, heading home if nobody here is fighting it
    function release(m) {
        m.follow = false; m.netX = undefined; m.atk = null;
        if (Math.hypot(m.x - m.home.x, m.y - m.home.y) > 30) { m.aggro = false; m.returning = true; }
    }
    function send() {
        const o = net(), g = game();
        const key = (id) => O.ROOT + '/' + o.zone + '/m/' + id;
        const list = [];
        if (M.live()) {
            const p = g.player;
            for (const m of g.actors) {
                if (m.dead || !m.sid || m.kind !== 'monster') continue;
                const driving = m.aggro && !m.follow && !m.returning, dmg = Math.round(m.myDmg || 0);
                if (!driving && !(dmg > 0 && (m.follow || E.time - (m.mineAt || 0) < R.engagedSec))) continue;
                list.push({ sid: m.sid, d: driving ? 1 : 0, x: m.x, y: m.y, fa: m.facing || 0, as: m.atkSeq || 0, ai: m.atkI || 0, tx: m.atkTx || 0, ty: m.atkTy || 0, dmg, near: Math.hypot(m.x - p.x, m.y - p.y) });
            }
            list.sort((a, b) => a.near - b.near);
        }
        if (!list.length) {
            if (M.sentAny && o.db) { o.db.remove(key(o.uid)); M.sentAny = false; }
            return;
        }
        const str = Mb.pack(++M.n, list);
        o.db.set(key(o.uid), str);
        M.sentAny = true;
        o.net.outBytes += str.length + 60;
    }
})();
