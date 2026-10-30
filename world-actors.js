/**
 * The Wilds: everything that moves or can be hit. The player, monsters, elites, bosses, rival adventurers, the training
 * dummy, gatherable nodes, projectiles and telegraphed attacks, plus how each is drawn. Every combatant has a team;
 * damage only crosses teams (WHWorldCombat.canDamage). The player and rivals swing weapons with the same physics.
 */
(function () {
    'use strict';
    const D = window.WHWorldData, W = window.WHWorld, C = window.WHWorldCombat, G = window.WHWorldGen;
    const WHW = window.WHW;
    const E = WHW.engine;
    const A = WHW.actors = {};
    const TAU = Math.PI * 2;
    const game = () => WHW.game;
    const now = () => Date.now();
    const rnd = () => Math.random();
    const dist = (a, b) => Math.hypot(a.x - b.x, a.y - b.y);
    const angTo = (a, b) => Math.atan2(b.y - a.y, b.x - a.x);
    let nextId = 1;

    // ---------------- creation ----------------
    function base(kind, team, x, y, r) {
        return { id: 'a' + (nextId++), kind, team, x, y, r, vx: 0, vy: 0, kbx: 0, kby: 0, facing: Math.PI / 2, flash: 0, dead: false,
            status: { burnUntil: 0, burnDps: 0, chillUntil: 0, stunUntil: 0 }, cds: [], atk: null, mass: r / 14 };
    }
    A.makePlayer = function (x, y) {
        const p = base('player', 'player', x, y, D.COMBAT.player.r || D.COMBAT.player.radius);
        Object.assign(p, { hp: 100, maxHp: 100, weapon: null, weaponUid: null, stam: { val: D.COMBAT.stamina.max, idle: 0, winded: false },
            dashT: 0, dashCd: 0, dashX: 0, dashY: 0, iframes: 0, lastHurt: -99, combo: {}, trail: [], power: 0, powerHit: false, perfectFlash: 0,
            aimHold: 0, slow: 0, lavaT: 0, mass: 1, abCharges: {}, buffs: {}, riposteUntil: 0, exhaustUntil: 0, pull: null, hookFx: null,
            ignite: null, igDrain: 0, mana: { val: D.COMBAT.mana.max, idle: 0 }, manaFlash: 0, stillT: 0, beam: null, overSlow: null });
        // the shield turns toward the mouse like a weapon; up while the block button is held
        p.shield = Object.assign(C.newWeapon('shield', Math.PI / 2), { up: false, raisedAt: -9, brokenUntil: 0 });
        return p;
    };
    A.makeMonster = function (type, x, y, opts = {}) {
        const def = D.MONSTERS[type];
        const z = D.ZONES[game().zoneId] || {};
        const m = base('monster', 'monster', x, y, def.r);
        Object.assign(m, { type, def, name: def.name, hp: def.hp * (z.hpMult || 1), maxHp: def.hp * (z.hpMult || 1), dmg: def.dmg * (z.dmgMult || 1),
            armor: def.armor || 0, baseArmor: def.armor || 0, speed: def.speed, elite: !!def.elite, home: { x, y }, aggro: false, spawn: opts.spawn, eliteSpawn: opts.eliteSpawn,
            cds: def.attacks.map(() => 0), hopT: rnd(), wanderT: rnd() * 3, wander: null, flank: opts.flank || 0, summoned: !!opts.summoned, mass: def.r / 14 });
        if (def.dummy) Object.assign(m, { kind: 'dummy', hp: def.hp, maxHp: def.hp, solid: true, mass: 99, lastDmg: 0, dmgLog: [] });
        return m;
    };
    A.makeBoss = function (id, x, y, opts = {}) {
        const def = D.BOSSES[id];
        const b = base(opts.clone ? 'clone' : 'boss', 'monster', x, y, opts.clone ? def.r * 0.8 : def.r);
        Object.assign(b, { type: id, def, name: def.name, hp: def.hp * (opts.clone ? 0.12 : 1), maxHp: def.hp * (opts.clone ? 0.12 : 1),
            dmg: def.dmg * (opts.clone ? 0.5 : 1), armor: def.armor || 0, baseArmor: def.armor || 0, speed: def.speed, home: { x, y }, active: !!opts.clone,
            phase: 0, plan: [], planI: 0, nextAtk: 0, exposedUntil: 0, armorBrokenUntil: 0, leaveT: 0, mass: 6, face: def.face });
        return b;
    };
    A.makeRival = function (zoneId, x, y) {
        const rt = D.RIVAL_TIERS[zoneId], rv = D.RIVALS[rt.rival];
        const gear = D.GEAR_BY_ID[rv.cls + '_' + rt.tier];
        const r = base('rival', 'rival', x, y, 13);
        Object.assign(r, { name: rv.name, face: rv.face, color: rv.color, cls: rv.cls, tier: rt.tier, rt, weapon: C.newWeapon(rv.cls, 0), hp: rt.hp, maxHp: rt.hp,
            armor: rt.tier * 12, baseArmor: rt.tier * 12, dmg: gear.dmg * 0.9, speed: 135, home: { x, y }, aggro: false, mass: 1,
            ai: { next: 0, attackUntil: 0, aimX: x, aimY: y, strafe: rnd() < 0.5 ? 1 : -1, strafeT: 0, dodgeCd: 0, staggerUntil: 0, iframes: 0, drawing: false }, combo: {} });
        return r;
    };
    A.makeNode = function (n) {
        const def = D.NODES[n.type];
        return { id: 'n' + n.key, key: n.key, type: n.type, def, x: n.x, y: n.y, r: def.r, solid: !!def.solid, work: 0, readyAt: 0, crack: rnd() * TAU, shake: 0, hint: 0 };
    };
    A.nodeAlive = (n) => now() >= n.readyAt;

    // ---------------- helpers ----------------
    function pvpTargets() { return WHW.online ? WHW.online.targets() : []; }
    function weaponItem() { const g = game(); return W.findGear(g.state, g.player.weaponUid); }
    function solidsNear(x, y, r) { return E.nodesNear(x, y, r).filter(n => n.solid && A.nodeAlive(n)); }
    function hostileTo(team) { return game().actors.filter(a => !a.dead && C.canDamage(team, a.team)); }
    A.solidsNear = solidsNear;

    // ---------------- damage ----------------
    A.hurtPlayer = function (dmg, opts = {}) {
        const g = game(), p = g.player;
        if (p.dead || p.iframes > 0 || g.inTown) return 0;
        const st = g.pstats;
        // Riposte: a hit from someone, inside the guard window, does nothing, and whoever threw it is disarmed. opts.remote:
        // the other player behind a PvP hit (world-online.js)
        if (p.riposteUntil > E.time && !opts.unblockable) {
            const src = opts.from, actor = src && !src.dead && (src.kind === 'monster' || src.kind === 'boss' || src.kind === 'clone' || src.kind === 'rival');
            // a boss's shockwave counts too (from: the wave): it's cancelled, there's just nobody in it to cut
            if (actor || opts.remote || src) { riposted(p, actor ? src : null, opts.remote); return 0; }
        }
        if (st.dodge && !opts.unblockable && rnd() < st.dodge) { p.iframes = 0.25; E.floatText(p.x, p.y - 30, 'DODGE', '#9ad7ff', 14); WHW.sfx('dash'); return 0; }
        if (opts.projectile && buffOn(p, 'reflect')) {
            const pr = opts.projectile;
            reflectProjectile(pr, pr.x, pr.y, Math.atan2(-pr.vy, -pr.vx));
            p.iframes = 0.15; E.floatText(p.x, p.y - 30, 'REFLECT', '#bfe3ff', 14); WHW.sfx('parry');
            return 0;
        }
        // Spiked Shield: whoever hits you up close takes part of the hit back (never another player: theirs has no kind)
        const src = opts.from;
        if (st.thorns && src && !opts.projectile && !src.dead && (src.kind === 'monster' || src.kind === 'boss' || src.kind === 'clone' || src.kind === 'rival')) {
            A.damage(src, dmg * st.thorns, { from: p, text: 'THORNS' });
        }
        if (p.shield.up && !opts.unblockable) {
            const fromAngle = opts.fromAngle !== undefined ? opts.fromAngle : opts.from ? angTo(p, opts.from) : null;
            const r = fromAngle === null ? null : C.blockHit(p.shield, shieldStats(), fromAngle, dmg, E.time, p.stam.val);
            if (r && r.blocked) {
                p.stam.val = Math.max(0, p.stam.val - r.stamCost * g.pstats.blockStam); p.stam.idle = 0;
                g.state.stats.blocks++;
                const bx = p.x + Math.cos(p.shield.theta) * 20, by = p.y + Math.sin(p.shield.theta) * 20;
                if (r.parry) { parried(p, opts, bx, by); return 0; }
                E.burst(bx, by, '#e6ebf2', 8, 150, { angle: p.shield.theta, spread: 1.6, life: 0.3 });
                if (r.broken) {
                    p.shield.up = false; p.shield.brokenUntil = E.time + D.COMBAT.shield.breakStun;
                    E.floatText(p.x, p.y - 30, 'GUARD BROKEN', '#ff9a3d', 14, 1.1);
                    WHW.sfx('clash');
                } else WHW.sfx('block');
                if (opts.kb) opts = Object.assign({}, opts, { kb: opts.kb * 0.4 });
                dmg = r.taken;
                if (dmg < 0.5) { p.iframes = 0.15; return 0; }
            }
        }
        let d = C.mitigate(dmg, st.armor);
        if (opts.fire) d *= 1 - st.fireResist;
        d *= 1 - buffMax(p, 'reduce');
        if (buffOn(p, 'noKb')) opts = Object.assign({}, opts, { kb: 0 });
        d = Math.max(1, d);
        p.hp -= d;
        p.iframes = 0.35;
        p.lastHurt = E.time;
        p.flash = 0.15;
        if (opts.burn) { p.status.burnUntil = E.time + 3; p.status.burnDps = Math.max(p.status.burnDps, dmg * 0.08); }
        if (opts.chill) p.status.chillUntil = E.time + 2;
        if (opts.drain) p.stam.val = Math.max(0, p.stam.val - opts.drain);
        if (opts.kb && opts.from) {
            const a = angTo(opts.from, p);
            p.kbx += Math.cos(a) * opts.kb; p.kby += Math.sin(a) * opts.kb;
        }
        if (WHW.settings.dmgNumbers) E.floatText(p.x, p.y - 22, '-' + Math.round(d), '#ff6b7a', 15);
        E.addShake(4 + d / 8);
        WHW.sfx('hurt');
        if (p.hp <= 0) { p.hp = 0; p.dead = true; WHW.onPlayerDeath && WHW.onPlayerDeath(); }
        return d;
    };
    function shieldItem() { const g = game(); return W.findGear(g.state, g.state.equip.offhand); }
    function shieldStats() { const it = shieldItem(); return it ? W.gearStats(it) : null; }
    A.shieldStats = shieldStats;
    // A perfectly timed block: nothing gets through, the attacker reels and projectiles fly back
    function parried(p, opts, bx, by) {
        const S = D.COMBAT.shield;
        const a = opts.from;
        E.burst(bx, by, '#ffe14d', 16, 220, { angle: p.shield.theta, spread: 1.8, life: 0.4 });
        E.floatText(p.x, p.y - 30, 'PARRY!', '#ffc83d', 17, 1);
        E.addHitStop(0.06);
        WHW.sfx('parry');
        p.iframes = 0.2;
        if (a && a.kind === 'monster') { a.status.stunUntil = E.time + S.parryStun; a.atk = null; }
        else if (a && (a.kind === 'boss' || a.kind === 'clone')) { a.status.stunUntil = E.time + S.bossParryStun; a.atk = null; }
        else if (a && a.kind === 'rival') a.ai.staggerUntil = E.time + S.rivalStagger;
        if (opts.onParry) opts.onParry();
        if (opts.projectile) reflectProjectile(opts.projectile, bx, by, p.shield.theta);
    }
    // an enemy projectile sent back the way it came (parries and Mirror Guard)
    function reflectProjectile(pr, x, y, ang) {
        const sp = Math.hypot(pr.vx, pr.vy);
        game().projectiles.push({ kind: pr.kind, team: 'player', x, y, vx: Math.cos(ang) * sp, vy: Math.sin(ang) * sp, r: pr.r, life: 1.2,
            dmg: pr.dmg * D.COMBAT.shield.reflectMult, color: pr.color, burn: pr.burn, chill: pr.chill, kb: 120, hit: new Set(), reflected: true });
    }

    // Damage any non-player combatant. info: { from, kbAngle, kb, s, perfect, crit, burn, chill, text }
    A.damage = function (t, dmg, info = {}) {
        if (t.dead) return;
        if (t.kind === 'rival' && t.ai.iframes > 0) { E.floatText(t.x, t.y - 20, 'DODGE', '#9ad7ff', 12); return; }
        // an opening: the player's hits on a stunned enemy (Opportunist; Deadly Throw's stunnedMult)
        const pl = game().player;
        if (info.from && info.from === pl && isStunned(t)) {
            const m = (game().pstats.stunnedDmg || 1) * (info.stunnedMult || 1);
            if (m > 1) { dmg *= m; info = Object.assign({}, info, { text: info.text || 'OPENING' }); }
        }
        t.hp -= dmg;
        t.flash = 0.12;
        t.lastHit = E.time;
        if (t.kind === 'monster' || t.kind === 'rival') t.aggro = true;
        if ((t.kind === 'boss') && !t.active) t.active = true;
        if (info.kb) {
            const k = C.knockback(info.kb, info.s || 0, t.mass);
            t.kbx += Math.cos(info.kbAngle) * k; t.kby += Math.sin(info.kbAngle) * k;
        }
        if (info.burn) { t.status.burnUntil = E.time + 3; t.status.burnDps = Math.max(t.status.burnDps, dmg * 0.15); }
        // the Frozen WH's frost armor melts under fire
        if (info.burn && t.kind === 'boss' && t.def.emberStrips) t.armorBrokenUntil = E.time + 4;
        if (info.chill) t.status.chillUntil = E.time + 2;
        if (WHW.settings.dmgNumbers) {
            const col = info.perfect ? '#ffc83d' : info.crit ? '#ff9a3d' : '#ffffff';
            E.floatText(t.x + (rnd() - 0.5) * 10, t.y - t.r - 6, Math.round(dmg) + (info.perfect ? '!' : ''), col, info.perfect ? 18 : 14);
        }
        if (info.text) E.floatText(t.x, t.y - t.r - 24, info.text, '#ffe7a3', 12, 1.1);
        if (t.kind === 'dummy') { t.hp = t.maxHp; t.dmgLog.push({ at: E.time, dmg }); return; }
        if (t.kind === 'boss' && WHW.online && WHW.online.bossShared(t)) {
            WHW.online.bossDamage(t, dmg);
            if (t.hp <= 0) t.hp = 1; // waits for the shared health to reach 0
            return;
        }
        if (t.hp <= 0) A.kill(t, info.from);
    };

    function isStunned(t) { return (t.status && t.status.stunUntil > E.time) || (t.kind === 'rival' && t.ai.staggerUntil > E.time); }
    A.kill = function (t, by) {
        const g = game();
        t.dead = true;
        E.burst(t.x, t.y, t.def && t.def.color ? t.def.color : '#fff', 18, 180, { life: 0.7, size: 4 });
        const at = now();
        if (t.kind === 'monster') {
            const loot = W.monsterLoot(g.state, t.type, Math.random, at, { ack: g.ack, zone: g.zoneId });
            WHW.showLoot(t.x, t.y, loot);
            if (!t.summoned && t.spawn !== undefined) {
                const sec = t.elite ? D.ELITE_RESPAWN_SEC : D.MONSTER_RESPAWN_SEC;
                g.respawns.push({ spawn: t.spawn, elite: t.elite, at: E.time + sec });
                if (t.elite) W.noteNode(g.state, 'elite:' + g.zoneId + ':' + t.spawn, sec, at);
            }
            WHW.sfx('kill');
        } else if (t.kind === 'rival') {
            const r = W.rivalLoot(g.state, g.zoneId, Math.random, at);
            WHW.showLoot(t.x, t.y, { rubies: r.rubies, mats: {} });
            WHW.toast(`${t.name} is beaten!` + (r.item ? ` They dropped ${W.gearName(r.item)}.` : ''), r.item ? 'gold' : '');
            WHW.sfx('boss');
            WHW.save();
        } else if (t.kind === 'boss') {
            const r = W.bossLoot(g.state, t.type, Math.random, at, g.ack);
            g.bossDeadUntil[g.zoneId] = E.time + 90;
            g.actors.filter(a => a.kind === 'clone' || a.summoned).forEach(a => { a.dead = true; });
            g.hazards.length = 0;
            WHW.onBossKilled && WHW.onBossKilled(t, r);
            WHW.sfx('boss');
            WHW.save();
        } else if (t.kind === 'clone') {
            E.floatText(t.x, t.y - 30, 'Just a copy!', '#ffe7a3', 14);
        }
    };

    // ---------------- the player ----------------
    A.tryDash = function (p, mv) {
        const S = D.COMBAT.stamina, DA = D.COMBAT.dash, ps = game().pstats;
        const cost = S.dash * ps.dashStam;
        if (p.pull || p.dashCd > 0 || p.dashT > 0 || p.stam.val < cost) return;
        let dx = mv.x, dy = mv.y;
        if (!dx && !dy) { const aim = E.aimPoint(p.x, p.y); if (aim) { const a = angTo(p, aim); dx = Math.cos(a); dy = Math.sin(a); } else { dx = 0; dy = 1; } }
        const l = Math.hypot(dx, dy) || 1;
        p.dashX = dx / l; p.dashY = dy / l;
        p.dashT = DA.time; p.dashCd = DA.cooldown * ps.dashCd; p.iframes = Math.max(p.iframes, DA.iframes);
        p.stam.val -= cost; p.stam.idle = 0;
        E.burst(p.x, p.y + 8, 'rgba(255,255,255,0.6)', 6, 60, { life: 0.3 });
        WHW.sfx('dash');
    };
    // ---------------- abilities ----------------
    // R, Q and C cast the abilities on the active class's loadout. They hurt monsters, bosses and rivals, and other players
    // outside town: a hit on a player is sent to them (world-online.js), and their page applies it.
    // Every ability holds a.charges casts (one by default). A used charge comes back a.cd seconds later, one at a time.
    // p.abCharges[id]: { n: charges ready, next: when the next one comes back }
    function charges(p, id) {
        const a = D.ABILITIES[id], max = a.charges || 1;
        const c = p.abCharges[id] || (p.abCharges[id] = { n: max, next: 0 });
        while (c.n < max && E.time >= c.next) { c.n++; if (c.n < max) c.next += a.cd * game().pstats.abilityCd; }
        return c;
    }
    function spendCharge(p, id) {
        const a = D.ABILITIES[id], c = charges(p, id);
        if (c.n === (a.charges || 1)) c.next = E.time + a.cd * game().pstats.abilityCd; // a full one starts recharging now
        c.n--;
    }
    // seconds until the ability can be cast (0 while a charge is ready), and how many charges are ready
    // (none while Burning Stick burns: its cooldown starts over when the fire goes out)
    A.abilityCd = function (p, id) { if ((p.ignite && p.ignite.id === id) || (p.beam && p.beam.id === id)) return 0; const c = charges(p, id); return c.n > 0 ? 0 : Math.max(0, c.next - E.time); };
    A.abilityCharges = (p, id) => charges(p, id).n;
    // every charge used up, all coming back from now (equipping one outside town)
    A.startCooldown = function (p, id) { const c = charges(p, id); c.n = 0; c.next = E.time + D.ABILITIES[id].cd * game().pstats.abilityCd; };
    // lit on the hotbar: a running buff, the Riposte guard, a hook pulling you
    A.abilityActive = (p, id) => A.buffOn(p, id) || (D.ABILITIES[id].kind === 'parry' && p.riposteUntil > E.time) || (D.ABILITIES[id].kind === 'hook' && !!p.pull)
        || (!!p.ignite && p.ignite.id === id) || (!!p.beam && p.beam.id === id);
    // buffs running now (Berserk, Stoneskin, Hunter's Mark...) and what they add up to
    function activeBuffs(p) { const out = []; for (const id in p.buffs) if (p.buffs[id] > E.time) out.push(D.ABILITIES[id]); return out; }
    function buffMult(p, key) { let m = 1; for (const a of activeBuffs(p)) if (a[key]) m *= a[key]; return m; }
    function buffSum(p, key) { let n = 0; for (const a of activeBuffs(p)) if (typeof a[key] === 'number') n += a[key]; return n; }
    function buffMax(p, key) { let n = 0; for (const a of activeBuffs(p)) if (a[key] > n) n = a[key]; return n; }
    function buffOn(p, key) { return activeBuffs(p).some(a => a[key]); }
    function dmgBuff(p) { return buffMult(p, 'dmgMult'); }
    A.buffOn = (p, id) => (p.buffs[id] || 0) > E.time;
    function abilityTargets() { return game().actors.filter(t => !t.dead && C.canDamage('player', t.team)).concat(pvpTargets()); }
    // Singularity: fire, frost and lightning hurt anything inside a rift more. The biggest amp t stands in (1 for none)
    function elemAmp(t) {
        let m = 1;
        for (const f of game().fields) {
            if (f.fx || !f.a.amp || f.t < (f.a.delay || 0) || f.t >= f.a.time) continue;
            if (Math.hypot(t.x - f.x, t.y - f.y) <= f.a.r + (t.r || 0) && f.a.amp > m) m = f.a.amp;
        }
        return m;
    }
    function abilityHit(p, t, a, base, angle, opts = {}) {
        let dmg = base * (opts.dmg !== undefined ? opts.dmg : a.dmg);
        let text = opts.text;
        if (a.execute && t.hp <= t.maxHp * a.execute) { dmg *= 2; text = 'EXECUTE'; }
        if (a.elem) { const amp = elemAmp(t); if (amp > 1) { dmg *= amp; text = text || 'AMPLIFIED'; } }
        // another player: their page checks it and takes it with their own shield and armor
        if (t.kind === 'remote') { WHW.online.hitRemote(t, { kind: 'ab', w: a.id, dmg, ang: angle, perfect: false }); return; }
        if (t.def && t.def.resist) dmg *= 1 - t.def.resist * 0.5; // abilities cut through resistance better than weapons do
        dmg = C.mitigate(dmg, t.armorBrokenUntil > E.time ? 0 : t.armor);
        A.damage(t, dmg, { from: p, kbAngle: angle, kb: opts.kb !== undefined ? opts.kb : a.kb || 0, s: 1, burn: a.burn, chill: a.chill, text });
        if (a.stun) stun(t, a.stun);
    }
    function stun(t, sec) {
        if (!t.status || t.kind === 'dummy' || t.dead) return;
        t.status.stunUntil = Math.max(t.status.stunUntil, E.time + (t.kind === 'boss' ? sec * 0.4 : sec));
        if (t.kind === 'rival') t.ai.staggerUntil = Math.max(t.ai.staggerUntil, E.time + sec); // rivals stagger instead
        t.atk = null;
    }
    // slide the player along a line, stopping at walls; returns the points passed through
    function slide(p, ang, dist) {
        const step = dist / 10, solids = solidsNear(p.x, p.y, dist + 40), path = [{ x: p.x, y: p.y }];
        for (let i = 0; i < 10; i++) {
            const bx = p.x, by = p.y;
            E.move(p, Math.cos(ang) * step, Math.sin(ang) * step, solids);
            path.push({ x: p.x, y: p.y });
            if (Math.hypot(p.x - bx, p.y - by) < step * 0.4) break;
        }
        p.vx = p.vy = 0; p.kbx = p.kby = 0;
        return path;
    }
    function segDist(px, py, a, b) {
        const dx = b.x - a.x, dy = b.y - a.y, l2 = dx * dx + dy * dy;
        const u = l2 ? Math.max(0, Math.min(1, ((px - a.x) * dx + (py - a.y) * dy) / l2)) : 0;
        return Math.hypot(px - (a.x + dx * u), py - (a.y + dy * u));
    }
    function ringFx(x, y, r, color) {
        for (let i = 0; i < 28; i++) { const aa = i / 28 * Math.PI * 2; E.burst(x + Math.cos(aa) * r, y + Math.sin(aa) * r, color, 1, 40, { angle: aa, spread: 0.2, life: 0.35 }); }
    }
    function boltFx(a, b, color) {
        const n = Math.max(3, Math.round(Math.hypot(b.x - a.x, b.y - a.y) / 14));
        for (let i = 0; i <= n; i++) {
            const f = i / n, j = i && i < n ? (rnd() - 0.5) * 14 : 0;
            E.burst(a.x + (b.x - a.x) * f + j, a.y + (b.y - a.y) * f + j, color, 1, 20, { life: 0.25, size: 3 });
        }
    }
    function abilityShot(p, a, ang, base, extra) {
        game().projectiles.push(Object.assign({ kind: 'arrow', team: 'player', x: p.x + Math.cos(ang) * 16, y: p.y + Math.sin(ang) * 16, vx: Math.cos(ang) * a.speed, vy: Math.sin(ang) * a.speed,
            r: 4, life: a.life, dmg: base * a.dmg, kb: 110, hit: new Set(), ability: true, abil: a.id, color: a.color }, extra));
    }
    // A player stunned by another player's ability: can't move, attack, block or cast for a moment
    A.stunPlayer = function (sec) {
        const p = game().player;
        p.stunUntil = Math.max(p.stunUntil || 0, E.time + sec);
        p.staggerUntil = Math.max(p.staggerUntil || 0, p.stunUntil);
        p.shield.up = false;
        if (p.weapon && p.weapon.drawing) { p.weapon.drawing = false; p.weapon.draw = 0; }
        E.floatText(p.x, p.y - 30, 'STUNNED', '#ffe14d', 14);
    };
    // Another player cast an ability: show it. x, y: where they are now; tx, ty: where they aimed (or the area's centre).
    // Only for show: their page sends any hits.
    A.remoteCast = function (x, y, id, tx, ty) {
        const a = D.ABILITIES[id], g = game();
        if (!a) return;
        const ang = Math.atan2(ty - y, tx - x);
        const fxShot = (aa, kind, extra) => g.projectiles.push(Object.assign({ kind, team: 'fx', x: x + Math.cos(aa) * 16, y: y + Math.sin(aa) * 16, vx: Math.cos(aa) * a.speed, vy: Math.sin(aa) * a.speed,
            r: 4, life: a.life, hit: new Set(), ability: true, color: a.color }, extra));
        if (a.kind === 'nova' || a.kind === 'smoke') { ringFx(x, y, a.radius, a.color); E.burst(x, y, a.color, 20, a.radius * 2, { life: 0.5, size: a.kind === 'smoke' ? 7 : 4 }); }
        else if (a.kind === 'cone') { for (let i = 0; i < 18; i++) { const aa = ang + (i / 17 - 0.5) * a.arc; E.burst(x + Math.cos(aa) * a.range * 0.7, y + Math.sin(aa) * a.range * 0.7, a.color, 2, 90, { angle: aa, spread: 0.3, life: 0.4 }); } }
        else if (a.kind === 'leap') { ringFx(x, y, a.radius, a.color); E.burst(x, y + 6, '#cbb89a', 18, 160, { life: 0.5 }); }
        else if (a.kind === 'line' || a.kind === 'beam') { for (let d = 10; d <= a.len; d += 12) E.burst(x + Math.cos(ang) * d, y + Math.sin(ang) * d, a.color, 2, 70, { angle: ang, spread: 0.6, life: 0.4 }); }
        else if (a.kind === 'hook') boltFx({ x, y }, { x: tx, y: ty }, a.color);
        else if (a.kind === 'volley') { for (let i = 0; i < a.count; i++) fxShot(ang + (i / (a.count - 1) - 0.5) * a.spread, 'arrow'); }
        else if (a.kind === 'shot') fxShot(ang, a.look === 'spear' ? 'javelin' : a.look === 'knife' ? 'knife' : a.stun ? 'net' : 'arrow', { big: !!a.big });
        else if (a.kind === 'chain') boltFx({ x, y }, { x: tx, y: ty }, a.color);
        else if (a.kind === 'field') g.fields.push({ id, a, x: tx, y: ty, t: 0, next: a.delay || 0, base: 0, fx: true });
        else E.burst(x, y, a.color, 14, 100, { life: 0.5 }); // blinks, charges, steps, parries, heals and buffs: a flash where they are
        if (a.kind === 'buff' || a.kind === 'heal') E.floatText(x, y - 30, a.name.toUpperCase(), a.color, 13, 0.9);
    };
    // what an ability's dmg multiplies: the weapon in hand, damage buffs and ability perks
    function abilityBase(p) {
        const wst = W.gearStats(weaponItem());
        return (wst ? wst.dmg : 8) * dmgBuff(p) * game().pstats.abilityDmg;
    }
    // Where a hook fired from p along ang stops: the first enemy, wall or solid node within range. { kind, x, y, t? }
    function hookCast(p, ang, range) {
        const cx = Math.cos(ang), cy = Math.sin(ang), targets = abilityTargets(), nodes = solidsNear(p.x, p.y, range + 40);
        for (let d = p.r + 4; d <= range; d += 6) {
            const x = p.x + cx * d, y = p.y + cy * d;
            const t = targets.find(e => Math.hypot(e.x - x, e.y - y) <= e.r + 4);
            if (t) return { kind: 'enemy', x: t.x, y: t.y, t };
            const tile = E.tileAt(x, y);
            if (tile === G.T.WALL || tile === G.T.BUILDING || nodes.some(n => Math.hypot(n.x - x, n.y - y) <= n.r)) return { kind: 'wall', x, y };
        }
        return { kind: 'miss', x: p.x + cx * range, y: p.y + cy * range };
    }
    // Being pulled along a hook's line (see castAbility 'hook'); stops on arrival or against something solid
    function pullStep(p, dt) {
        const pl = p.pull, dx = pl.x - p.x, dy = pl.y - p.y, d = Math.hypot(dx, dy), step = pl.speed * dt, bx = p.x, by = p.y;
        if (d <= step) E.move(p, dx, dy, solidsNear(p.x, p.y, 80));
        else E.move(p, dx / d * step, dy / d * step, solidsNear(p.x, p.y, 80));
        p.vx = p.vy = 0; p.kbx = p.kby = 0;
        if (d <= step || E.time > pl.until || Math.hypot(p.x - bx, p.y - by) < Math.min(step, d) * 0.3) p.pull = null;
        if (E.perf !== 'low') E.burst(p.x, p.y + 8, 'rgba(255,255,255,0.5)', 1, 30, { life: 0.25 });
    }
    // A Riposte that caught a hit: the attacker (t, or another player) is cut and disarmed
    function riposted(p, t, remote) {
        const a = D.ABILITIES.riposte, base = abilityBase(p);
        p.riposteUntil = 0;
        p.iframes = Math.max(p.iframes, 0.35);
        if (remote) WHW.online.hitRemote(remote, { kind: 'ab', w: a.id, dmg: base * a.dmg, ang: angTo(p, remote) });
        else if (t) abilityHit(p, t, a, base, angTo(p, t), { text: 'DISARMED' });
        E.burst(p.x, p.y - 6, '#ffe14d', 22, 220, { life: 0.45 });
        E.floatText(p.x, p.y - 34, 'RIPOSTE!', '#ffc83d', 18, 1);
        E.addHitStop(0.08); E.addShake(5);
        WHW.sfx('parry');
    }
    // A player whose attack another player riposted: out of stamina, and none comes back for sec seconds
    A.exhaustPlayer = function (sec) {
        const p = game().player;
        p.stam.val = 0; p.stam.idle = 0;
        p.exhaustUntil = Math.max(p.exhaustUntil || 0, E.time + sec);
        E.floatText(p.x, p.y - 30, 'DISARMED', '#ff9a3d', 14);
    };
    A.castAbility = function (key) {
        const g = game(), p = g.player, s = g.state;
        if (!p || p.dead || p.stunUntil > E.time || p.pull) return false;
        const id = W.abilityKit(s)[key], a = D.ABILITIES[id];
        if (!a) { WHW.hint('Nothing on ' + D.ABILITY_KEYS[key] + ': learn abilities and equip them in the Classes menu (K).'); return false; }
        // Ice Beam holds you: nothing else while it lasts, and its own key stops it once the first moment has passed
        if (p.beam) {
            if (p.beam.id === id && E.time - p.beam.at >= a.minTime) { endBeam(p); return true; }
            return false;
        }
        if (A.abilityCd(p, id) > 0) return false;
        const ps = g.pstats;
        // what it costs: mana for a class with mana (the Mystic), stamina for the rest
        const stam = a.stam * ps.abilityStam, pool = ps.usesMana ? p.mana : p.stam;
        if (pool.val < stam) { WHW.hint('Not enough ' + (ps.usesMana ? 'mana' : 'stamina') + ' for ' + a.name + '.'); return false; }
        const aim = E.aimPoint(p.x, p.y);
        const ang = aim && Math.hypot(aim.x - p.x, aim.y - p.y) > 8 ? angTo(p, aim) : p.facing;
        // Shadowstep needs someone to step behind; with nobody in reach nothing is spent
        let prey = null;
        if (a.kind === 'step') {
            const at = aim || { x: p.x + Math.cos(ang) * 100, y: p.y + Math.sin(ang) * 100 };
            prey = abilityTargets().filter(t => dist(p, t) <= a.range + t.r && !E.wallBetween(p.x, p.y, t.x, t.y)).sort((u, v) => dist(u, at) - dist(v, at))[0];
            if (!prey) { WHW.hint('No enemy close enough to ' + a.name + ' to.'); return false; }
        }
        // Burning Stick sets the weapon in hand on fire: it needs one that can hit, and only one fire at a time
        if (a.kind === 'ignite') {
            if (p.ignite) return false;
            const wb = W.baseOf(weaponItem());
            if (!wb || wb.cls === 'bow') { WHW.hint('Hold a staff or another melee weapon to set it on fire.'); return false; }
        }
        // momentum abilities hit harder the faster you are moving toward where you aim, like a spear thrust
        const mom = a.momentum === true ? C.momentumMult(p.vx * Math.cos(ang) + p.vy * Math.sin(ang), ps.momentum + buffSum(p, 'momentum')) : 1;
        const momText = mom >= 1.25 ? 'CHARGE x' + mom.toFixed(1) : '';
        // desperate abilities (Chain Lightning) hit harder the lower your health
        const desp = a.desperate ? C.desperation(a.desperate, p.hp, p.maxHp) : 1;
        const base = abilityBase(p) * mom * desp;
        if (desp >= 1.5) E.floatText(p.x, p.y - 44, 'DESPERATE x' + desp.toFixed(1), '#ff9a3d', 13, 0.9);
        spendCharge(p, id);
        pool.val -= stam; if (stam) pool.idle = 0;
        // what other players are told (world-online.js): which ability, and where it was aimed (an area changes it to its centre)
        p.cast = { seq: (p.cast ? p.cast.seq : 0) + 1, id, x: aim ? aim.x : p.x + Math.cos(ang) * 100, y: aim ? aim.y : p.y + Math.sin(ang) * 100 };
        const near = (r) => abilityTargets().filter(t => Math.hypot(t.x - p.x, t.y - p.y) <= r + t.r && !E.wallBetween(p.x, p.y, t.x, t.y));
        if (a.kind === 'nova') {
            const hit = near(a.radius);
            for (const t of hit) abilityHit(p, t, a, base, angTo(p, t));
            ringFx(p.x, p.y, a.radius, a.color);
            E.burst(p.x, p.y, a.color, 26, a.radius * 2.2, { life: 0.5, size: 4 });
            E.addShake(3 + Math.min(4, hit.length));
            WHW.sfx(a.burn ? 'boss' : 'perfect');
        } else if (a.kind === 'cone') {
            for (const t of near(a.range)) {
                const off = Math.abs(((angTo(p, t) - ang + Math.PI * 3) % (Math.PI * 2)) - Math.PI);
                if (off <= a.arc / 2) abilityHit(p, t, a, base, ang);
            }
            for (let i = 0; i < 18; i++) { const aa = ang + (i / 17 - 0.5) * a.arc; E.burst(p.x + Math.cos(aa) * a.range * 0.7, p.y + Math.sin(aa) * a.range * 0.7, a.color, 2, 90, { angle: aa, spread: 0.3, life: 0.4 }); }
            E.addShake(7); E.addHitStop(0.05);
            WHW.sfx('boss');
        } else if (a.kind === 'blink') {
            // Disengage kicks everything close away first, then leaps the other way
            if (a.back) { for (const t of near(a.radius)) abilityHit(p, t, a, base, angTo(p, t)); ringFx(p.x, p.y, a.radius, a.color); }
            const x0 = p.x, y0 = p.y;
            slide(p, a.back ? ang + Math.PI : ang, a.dist);
            p.iframes = Math.max(p.iframes, a.iframes);
            E.burst(x0, y0, a.color, 14, 100, { life: 0.4 });
            E.burst(p.x, p.y, a.color, 14, 100, { life: 0.4 });
            WHW.sfx('dash');
        } else if (a.kind === 'charge') {
            const path = slide(p, ang, a.dist);
            p.iframes = Math.max(p.iframes, a.iframes);
            for (const t of abilityTargets()) {
                let d = Infinity;
                for (let i = 1; i < path.length; i++) d = Math.min(d, segDist(t.x, t.y, path[i - 1], path[i]));
                if (d <= a.width + t.r) abilityHit(p, t, a, base, ang, { text: momText || 'CHARGED' });
            }
            for (const pt of path) E.burst(pt.x, pt.y + 8, a.color, 2, 60, { life: 0.35 });
            E.addShake(6);
            WHW.sfx('clash');
        } else if (a.kind === 'leap') {
            // up to dist toward the cursor (not past it), then a crash where you land
            const x0 = p.x, y0 = p.y;
            slide(p, ang, aim ? Math.min(a.dist, Math.max(20, Math.hypot(aim.x - p.x, aim.y - p.y))) : a.dist);
            p.iframes = Math.max(p.iframes, a.iframes);
            for (let i = 0; i <= 8; i++) { const f = i / 8; E.burst(x0 + (p.x - x0) * f, y0 + (p.y - y0) * f - Math.sin(f * Math.PI) * 30, a.color, 1, 30, { life: 0.35 }); }
            for (const t of near(a.radius)) abilityHit(p, t, a, base, angTo(p, t));
            ringFx(p.x, p.y, a.radius, a.color);
            E.burst(p.x, p.y + 6, '#cbb89a', 18, 160, { life: 0.5 });
            E.addShake(6);
            WHW.sfx('boss');
        } else if (a.kind === 'line') {
            // everything in a band len long toward the cursor, cut short by walls
            const cx = Math.cos(ang), cy = Math.sin(ang);
            let len = 0;
            while (len < a.len) { const tt = E.tileAt(p.x + cx * (len + 8), p.y + cy * (len + 8)); if (tt === G.T.WALL || tt === G.T.BUILDING) break; len += 8; }
            for (const t of abilityTargets()) {
                const dx = t.x - p.x, dy = t.y - p.y, along = dx * cx + dy * cy, off = Math.abs(dx * cy - dy * cx);
                if (along >= -t.r && along <= len + t.r && off <= a.width + t.r) abilityHit(p, t, a, base, ang, { text: momText || undefined });
            }
            for (let d = 10; d <= len; d += 12) E.burst(p.x + cx * d + (rnd() - 0.5) * a.width, p.y + cy * d + (rnd() - 0.5) * a.width, a.color, 2, 70, { angle: ang, spread: 0.6, life: 0.4 });
            E.addShake(5); E.addHitStop(0.04);
            WHW.sfx('boss');
        } else if (a.kind === 'hook') {
            // the hook catches the first enemy, wall or solid thing along the aim, then pulls you to it
            const hit = hookCast(p, ang, a.range);
            p.cast.x = hit.x; p.cast.y = hit.y;
            if (hit.t) abilityHit(p, hit.t, a, base, ang, { text: 'HOOKED' });
            if (hit.kind !== 'miss') {
                const dx = hit.x - p.x, dy = hit.y - p.y, len = Math.hypot(dx, dy) || 1;
                const go = Math.max(0, len - (hit.t ? hit.t.r + p.r + 4 : p.r + 2)), time = go / 1100;
                p.pull = { x: p.x + dx / len * go, y: p.y + dy / len * go, speed: 1100, until: E.time + time + 0.2 };
                p.dashT = 0;
                p.iframes = Math.max(p.iframes, time + 0.1);
            }
            p.hookFx = { x: hit.x, y: hit.y, until: E.time + (hit.kind === 'miss' ? 0.18 : 0.45) };
            E.burst(hit.x, hit.y, a.color, hit.kind === 'miss' ? 3 : 10, 120, { life: 0.3 });
            WHW.sfx(hit.kind === 'miss' ? 'dash' : 'clash');
        } else if (a.kind === 'parry') {
            // a short guard: a hit landing in it is cancelled and riposted (hurtPlayer)
            p.riposteUntil = E.time + a.window;
            E.burst(p.x, p.y, a.color, 10, 80, { life: 0.3 });
            WHW.sfx('block');
        } else if (a.kind === 'volley') {
            for (let i = 0; i < a.count; i++) abilityShot(p, a, ang + (i / (a.count - 1) - 0.5) * a.spread, base);
            WHW.sfx('bow');
        } else if (a.kind === 'shot') {
            abilityShot(p, a, ang, base, { kind: a.look === 'spear' ? 'javelin' : a.look === 'knife' ? 'knife' : a.stun ? 'net' : 'arrow', r: a.big ? 6 : 5, pierce: a.pierce || 0, kb: a.kb || 260,
                big: !!a.big, stun: a.stun || 0, stunnedMult: a.stunnedMult, text: momText || undefined });
            E.addShake(3);
            WHW.sfx('bow');
        } else if (a.kind === 'chain') {
            const from = aim || { x: p.x + Math.cos(ang) * 120, y: p.y + Math.sin(ang) * 120 };
            const pool = abilityTargets().filter(t => Math.hypot(t.x - p.x, t.y - p.y) <= a.range + t.r && !E.wallBetween(p.x, p.y, t.x, t.y));
            let cur = pool.slice().sort((u, v) => Math.hypot(u.x - from.x, u.y - from.y) - Math.hypot(v.x - from.x, v.y - from.y))[0];
            let prev = { x: p.x, y: p.y }, mult = a.dmg;
            const done = new Set();
            for (let n = 0; cur && n <= a.jumps; n++) {
                done.add(cur.id);
                boltFx(prev, cur, a.color);
                abilityHit(p, cur, a, base, angTo(prev, cur), { dmg: mult, kb: 80 });
                prev = cur; mult *= a.falloff;
                const c0 = cur;
                cur = abilityTargets().filter(t => !done.has(t.id) && Math.hypot(t.x - c0.x, t.y - c0.y) <= a.jump + t.r)
                    .sort((u, v) => Math.hypot(u.x - c0.x, u.y - c0.y) - Math.hypot(v.x - c0.x, v.y - c0.y))[0];
            }
            if (!done.size) boltFx(p, from, a.color); // nothing in range: a harmless flash, the cooldown still runs
            WHW.sfx('perfect');
        } else if (a.kind === 'step') {
            // reappear just behind the target (the side it isn't facing) and stab
            const t = prey, x0 = p.x, y0 = p.y, back = t.r + p.r + 4;
            const spot = { x: t.x - Math.cos(t.facing) * back, y: t.y - Math.sin(t.facing) * back };
            slide(p, angTo(p, spot), dist(p, spot));
            p.iframes = Math.max(p.iframes, a.iframes);
            p.facing = p.aimHold = angTo(p, t);
            abilityHit(p, t, a, base, angTo(p, t), { text: 'SHADOWSTEP' });
            E.burst(x0, y0, a.color, 16, 90, { life: 0.5 });
            E.burst(p.x, p.y, a.color, 16, 120, { life: 0.4 });
            WHW.sfx('perfect');
        } else if (a.kind === 'field') {
            let fx = p.x, fy = p.y;
            if (a.at === 'cursor') {
                const d = aim ? Math.min(a.range, Math.hypot(aim.x - p.x, aim.y - p.y)) : a.range / 2;
                fx = p.x + Math.cos(ang) * d; fy = p.y + Math.sin(ang) * d;
            }
            g.fields.push({ id, a, x: fx, y: fy, t: 0, next: a.delay || 0, base });
            p.cast.x = fx; p.cast.y = fy;
            WHW.sfx(a.delay ? 'dash' : 'perfect');
        } else if (a.kind === 'smoke') {
            for (const t of near(a.radius)) {
                if (t.kind === 'remote') { WHW.online.hitRemote(t, { kind: 'ab', w: id, dmg: 0, ang: angTo(p, t) }); continue; }
                stun(t, a.stun);
                if (t.kind === 'monster' || t.kind === 'rival') t.aggro = false;
            }
            p.iframes = Math.max(p.iframes, a.iframes);
            for (let i = 0; i < 40; i++) { const aa = rnd() * Math.PI * 2, r = rnd() * a.radius; E.burst(p.x + Math.cos(aa) * r, p.y + Math.sin(aa) * r, a.color, 1, 25, { life: 1.1, size: 7, grav: -20 }); }
            WHW.sfx('dash');
        } else if (a.kind === 'heal') {
            const before = p.hp;
            p.hp = Math.min(p.maxHp, p.hp + p.maxHp * a.heal);
            E.floatText(p.x, p.y - 30, '+' + Math.round(p.hp - before), '#7dff9a', 16);
            E.burst(p.x, p.y, a.color, 18, 90, { life: 0.8, grav: -70 });
            WHW.sfx('drink');
        } else if (a.kind === 'beam') {
            // you stand and pour it out (beamTick) until you stop it, the mana runs out or it reaches its longest
            p.beam = { id, at: E.time, ang, next: 0, len: a.len };
            p.shield.up = false; p.dashT = 0; p.vx = p.vy = 0;
            if (p.weapon) { p.weapon.charge = 0; p.weapon.over = 0; }
            E.burst(p.x, p.y, a.color, 16, 100, { life: 0.4 });
            WHW.sfx('perfect');
        } else if (a.kind === 'ignite') {
            // burns until the weapon hits someone (igniteTick, igniteStrike); the cooldown starts again when it goes out
            p.ignite = { id, at: E.time, emptyAt: null };
            if (p.weapon) p.weapon.charge = 0;
            E.floatText(p.x, p.y - 30, a.name.toUpperCase(), a.color, 15, 1);
            E.burst(p.x, p.y, a.color, 22, 140, { life: 0.5, grav: -80 });
            E.addShake(2);
            WHW.sfx('boss');
        } else if (a.kind === 'buff') {
            p.buffs[id] = E.time + a.time;
            E.floatText(p.x, p.y - 30, a.name.toUpperCase(), a.color, 15, 1);
            E.burst(p.x, p.y, a.color, 16, 110, { life: 0.6 });
            WHW.sfx('perfect');
        }
        if (WHW.ui && WHW.ui.renderAbilities) WHW.ui.renderAbilities();
        return true;
    };
    // Burning Stick, each step: the fire eats mana faster and faster, then health once the mana is gone (and keeps the
    // mana at 0). Returns the mana it eats per second. Town puts it out; so does being knocked out.
    function igniteTick(p, dt) {
        const ig = p.ignite;
        if (!ig) return 0;
        const g = game(), a = D.ABILITIES[ig.id];
        if (g.inTown || p.dead) { extinguish(p); return 0; }
        const t = E.time - ig.at;
        if (ig.emptyAt === null && p.mana.val <= 0.5) { ig.emptyAt = t; E.floatText(p.x, p.y - 30, 'BURNING YOU!', '#ff6b3a', 14, 1); }
        const d = C.igniteDrain(a, t, ig.emptyAt);
        if (E.perf !== 'low' && rnd() < dt * (14 + t * 4)) {
            const tip = weaponTip(p);
            E.burst(tip.x, tip.y, rnd() < 0.5 ? '#ffb347' : a.color, 1, 30, { life: 0.45, grav: -90, size: 3 });
        }
        if (ig.emptyAt === null) return d.mana * g.pstats.abilityStam;
        p.mana.val = 0; p.mana.idle = 0;
        p.hp -= d.hp * (1 - g.pstats.fireResist) * dt;
        p.lastHurt = E.time;
        if (p.hp <= 0 && !p.dead) {
            p.hp = 0; p.dead = true; p.ignite = null;
            E.floatText(p.x, p.y - 30, 'BURNED OUT', '#ff6b3a', 16, 1.2);
            WHW.onPlayerDeath();
        }
        return 0;
    }
    // Ice Beam, each step: it turns slowly toward the cursor, hits everything along it every tick, and eats mana.
    // Returns the mana it eats per second.
    function beamTick(p, dt) {
        const bm = p.beam;
        if (!bm) return 0;
        const g = game(), a = D.ABILITIES[bm.id], t = E.time - bm.at;
        if (g.inTown || p.dead || p.stunUntil > E.time || t >= a.maxTime || (p.mana.val <= 0 && t > 0.1)) { endBeam(p); return 0; }
        const aim = E.aimPoint(p.x, p.y);
        if (aim && Math.hypot(aim.x - p.x, aim.y - p.y) > 8) {
            const err = C.wrap(angTo(p, aim) - bm.ang);
            bm.ang = C.wrap(bm.ang + Math.max(-a.turn * dt, Math.min(a.turn * dt, err)));
        }
        p.facing = bm.ang;
        // it stops at the first wall
        const cx = Math.cos(bm.ang), cy = Math.sin(bm.ang);
        let len = 0;
        while (len < a.len) { const tt = E.tileAt(p.x + cx * (len + 8), p.y + cy * (len + 8)); if (tt === G.T.WALL || tt === G.T.BUILDING) break; len += 8; }
        bm.len = len;
        bm.next -= dt;
        if (bm.next <= 0) {
            bm.next += a.tick;
            const base = abilityBase(p);
            for (const e of abilityTargets()) {
                const dx = e.x - p.x, dy = e.y - p.y, along = dx * cx + dy * cy, off = Math.abs(dx * cy - dy * cx);
                if (along >= -e.r && along <= len + e.r && off <= a.width + e.r) abilityHit(p, e, a, base, bm.ang, { kb: 30 });
            }
        }
        if (E.perf !== 'low' && rnd() < dt * 40) { const d = rnd() * len; E.burst(p.x + cx * d, p.y + cy * d, rnd() < 0.5 ? '#ffffff' : a.color, 1, 40, { life: 0.4, size: 3 }); }
        return a.drain * g.pstats.abilityStam;
    }
    function endBeam(p) {
        const bm = p.beam;
        if (!bm) return;
        p.beam = null;
        A.startCooldown(p, bm.id);
        if (WHW.ui && WHW.ui.renderAbilities) WHW.ui.renderAbilities();
    }
    // where the end of the weapon in hand is now (world px)
    function weaponTip(p) {
        const w = p.weapon;
        if (!w) return { x: p.x, y: p.y };
        const P = D.WEAPON_CLASSES[w.cls] || {}, len = C.hasReach(w.cls) ? w.r : (P.len || 30);
        return { x: p.x + Math.cos(w.theta) * len, y: p.y + Math.sin(w.theta) * len };
    }
    function extinguish(p) {
        const ig = p.ignite;
        if (!ig) return;
        p.ignite = null;
        A.startCooldown(p, ig.id);
        if (WHW.ui && WHW.ui.renderAbilities) WHW.ui.renderAbilities();
    }
    // Burning Stick: the first weapon blow that lands while it burns puts the fire out with a huge hit on t
    function igniteStrike(p, t, angle) {
        const ig = p.ignite;
        if (!ig || t.dead) return;
        const a = D.ABILITIES[ig.id], b = C.igniteBlow(a, E.time - ig.at);
        extinguish(p);
        abilityHit(p, t, Object.assign({}, a, { stun: b.stun }), abilityBase(p), angle, { dmg: b.dmg, kb: b.kb, text: 'BURNING STICK x' + b.dmg.toFixed(1) });
        const big = b.sec / a.maxSec;
        E.burst(t.x, t.y, a.color, 20 + Math.round(30 * big), 160 + 200 * big, { life: 0.6, size: 4 });
        E.burst(t.x, t.y, '#ffe14d', 10 + Math.round(10 * big), 120 + 120 * big, { life: 0.4 });
        ringFx(t.x, t.y, t.r + 20 + 40 * big, a.color);
        E.addHitStop(0.06 + 0.08 * big); E.addShake(5 + 8 * big);
        WHW.sfx('boss');
    }

    // Ability areas on the ground (Sanctuary, Rain of Arrows, Singularity, Meteor, Blizzard): after the
    // delay they hit every tick seconds until their time runs out
    A.updateFields = function (dt) {
        const g = game(), p = g.player;
        for (const f of g.fields) {
            const a = f.a;
            f.t += dt;
            while (f.t >= f.next && f.next <= a.time) {
                const first = f.next === (a.delay || 0);
                f.next += a.tick;
                if (first && a.delay) { E.burst(f.x, f.y, a.color, 40, a.r * 2.4, { life: 0.6, size: 5 }); ringFx(f.x, f.y, a.r, a.color); E.addShake(f.fx ? 3 : 8); WHW.sfx('boss'); }
                if (f.fx) continue;
                // Meteor doesn't care who is under it: you take part of the blow, and burn (a dash can still get you out)
                if (first && a.selfHit && !p.dead && !g.inTown && Math.hypot(p.x - f.x, p.y - f.y) <= a.r + p.r) {
                    if (A.hurtPlayer(f.base * a.dmg * a.selfHit, { from: { x: f.x, y: f.y }, kb: 300, burn: !!a.burn, fire: !!a.burn, unblockable: true }) > 0) E.floatText(p.x, p.y - 44, 'CAUGHT IN IT!', '#ff7b3a', 14, 1);
                }
                for (const t of abilityTargets()) {
                    const d = Math.hypot(t.x - f.x, t.y - f.y);
                    if (d > a.r + t.r || E.wallBetween(f.x, f.y, t.x, t.y)) continue;
                    // a rift pulls toward its centre, harder at the edge; anything else pushes out
                    const inward = Math.atan2(f.y - t.y, f.x - t.x);
                    abilityHit(p, t, a, f.base, a.pull ? inward : inward + Math.PI, { kb: a.pull ? a.pull * Math.min(1, d / a.r) : a.kb || 0 });
                }
                if (a.heal && !p.dead && Math.hypot(p.x - f.x, p.y - f.y) <= a.r + p.r) {
                    const before = p.hp;
                    p.hp = Math.min(p.maxHp, p.hp + p.maxHp * a.heal);
                    if (p.hp - before >= 1) E.floatText(p.x, p.y - 28, '+' + Math.round(p.hp - before), '#7dff9a', 12, 0.6);
                }
            }
            // after it lands the ground burns: whoever stands in it (enemies, and you) catches fire
            if (a.groundBurn && !f.fx && f.t >= (a.delay || 0) && f.t < a.time) {
                const dps = f.base * a.groundBurn;
                for (const t of g.actors) {
                    if (t.dead || !t.status || !C.canDamage('player', t.team) || Math.hypot(t.x - f.x, t.y - f.y) > a.r + t.r) continue;
                    t.status.burnUntil = Math.max(t.status.burnUntil, E.time + 1); t.status.burnDps = Math.max(t.status.burnDps, dps);
                }
                if (!p.dead && !g.inTown && Math.hypot(p.x - f.x, p.y - f.y) <= a.r + p.r) {
                    p.status.burnUntil = Math.max(p.status.burnUntil, E.time + 1.5); p.status.burnDps = Math.max(p.status.burnDps, dps * 0.5);
                }
            }
            if (E.perf !== 'low' && f.t >= (a.delay || 0)) fieldFx(f, dt);
            if (f.t >= a.time) f.gone = true;
        }
        g.fields = g.fields.filter(f => !f.gone);
    };
    // what each area looks like while it lasts
    function fieldFx(f, dt) {
        const a = f.a, at = () => { const aa = rnd() * TAU, rr = Math.sqrt(rnd()) * a.r; return { x: f.x + Math.cos(aa) * rr, y: f.y + Math.sin(aa) * rr }; };
        if (f.id === 'rain_of_arrows') { for (let i = 0; i < 3; i++) { const q = at(); E.burst(q.x, q.y - 26, a.color, 1, 260, { angle: Math.PI / 2, spread: 0.05, life: 0.1, size: 2 }); } }
        else if (f.id === 'blizzard') { if (rnd() < dt * 40) { const q = at(); E.burst(q.x, q.y, '#ffffff', 1, 40, { angle: 0.6, spread: 0.4, life: 0.6, size: 3 }); } }
        else if (f.id === 'singularity') { if (rnd() < dt * 30) { const aa = rnd() * TAU; E.burst(f.x + Math.cos(aa) * a.r, f.y + Math.sin(aa) * a.r, a.color, 1, a.r * 1.6, { angle: aa + Math.PI, spread: 0.1, life: 0.5, size: 3 }); } }
        else if (f.id === 'meteor') { if (rnd() < dt * 25) { const q = at(); E.burst(q.x, q.y, rnd() < 0.5 ? '#ffb347' : a.color, 1, 30, { life: 0.6, grav: -70, size: 3 }); } }
        else if (f.id === 'sanctuary') { if (rnd() < dt * 18) { const q = at(); E.burst(q.x, q.y, a.color, 1, 20, { life: 0.9, grav: -60, size: 3 }); } }
    }
    A.drawFields = function (ctx) {
        for (const f of game().fields) {
            const a = f.a;
            ctx.save();
            if (a.delay && f.t < a.delay) {
                // where it will land, filling up until it does
                const k = f.t / a.delay;
                ctx.globalAlpha = 0.18 + 0.2 * k; ctx.fillStyle = a.color;
                ctx.beginPath(); ctx.arc(f.x, f.y, a.r * k, 0, TAU); ctx.fill();
                ctx.globalAlpha = 0.85; ctx.strokeStyle = a.color; ctx.lineWidth = 2; ctx.setLineDash([8, 6]);
                ctx.beginPath(); ctx.arc(f.x, f.y, a.r, 0, TAU); ctx.stroke();
                if (a.selfHit) {
                    // where it lands, plainly (it hurts you too), and the rock on its way down
                    ctx.setLineDash([]); ctx.globalAlpha = 0.9; ctx.strokeStyle = '#ff4d2b'; ctx.lineWidth = 3;
                    ctx.beginPath(); ctx.arc(f.x, f.y, a.r, 0, TAU); ctx.stroke();
                    ctx.beginPath(); ctx.moveTo(f.x - 12, f.y); ctx.lineTo(f.x + 12, f.y); ctx.moveTo(f.x, f.y - 12); ctx.lineTo(f.x, f.y + 12); ctx.stroke();
                    const mx = f.x + (1 - k) * 90, my = f.y - (1 - k) * 280, mr = 9 + 9 * k;
                    ctx.globalAlpha = 0.45; ctx.fillStyle = '#ffb347';
                    ctx.beginPath(); ctx.moveTo(mx + 70 * (1 - k) + 40, my - 120 * (1 - k) - 60); ctx.lineTo(mx - mr, my); ctx.lineTo(mx + mr, my); ctx.closePath(); ctx.fill();
                    ctx.globalAlpha = 1; ctx.fillStyle = '#5a3a2a'; ctx.beginPath(); ctx.arc(mx, my, mr, 0, TAU); ctx.fill();
                    ctx.strokeStyle = '#ff7b3a'; ctx.lineWidth = 3; ctx.beginPath(); ctx.arc(mx, my, mr, 0, TAU); ctx.stroke();
                }
            } else {
                const fade = Math.max(0, Math.min(1, (a.time - f.t) / 0.35));
                ctx.globalAlpha = (0.14 + Math.sin(E.time * 6) * 0.04) * fade; ctx.fillStyle = a.color;
                ctx.beginPath(); ctx.arc(f.x, f.y, a.r, 0, TAU); ctx.fill();
                ctx.globalAlpha = 0.6 * fade; ctx.strokeStyle = a.color; ctx.lineWidth = 2;
                ctx.beginPath(); ctx.arc(f.x, f.y, a.r, 0, TAU); ctx.stroke();
                if (a.pull) {
                    ctx.beginPath();
                    for (let i = 0; i < 3; i++) for (let j = 0; j <= 20; j++) { const u = j / 20, aa = E.time * -4 + i * TAU / 3 + u * 3, rr = a.r * (1 - u); const x = f.x + Math.cos(aa) * rr, y = f.y + Math.sin(aa) * rr; if (j) ctx.lineTo(x, y); else ctx.moveTo(x, y); }
                    ctx.stroke();
                }
            }
            ctx.restore();
        }
    };

    A.updatePlayer = function (p, dt) {
        const g = game(), st = g.pstats, T = G.T;
        const stunned = p.stunUntil > E.time;
        const mv = stunned || p.beam ? { x: 0, y: 0 } : E.moveInput(); // Ice Beam roots you
        const tile = E.tileAt(p.x, p.y);
        if ((E.consumeKey(' ') || E.consumeKey('Shift')) && !stunned && !p.beam) A.tryDash(p, mv);
        let speed = D.COMBAT.player.speed * st.speed;
        const w = p.weapon;
        if (w && w.cls === 'bow' && w.drawing) speed *= D.WEAPON_CLASSES.bow.moveMult;
        const sh = p.shield;
        const want = !stunned && !p.beam && !!(WHW.shieldWanted && WHW.shieldWanted()) && !!shieldItem() && E.time >= sh.brokenUntil;
        if (want && !sh.up) {
            sh.up = true; sh.raisedAt = E.time;
            if (w && w.drawing) { w.drawing = false; w.draw = 0; w.fullFor = 0; } // can't hold a bow string and a shield
        } else if (!want && sh.up) sh.up = false;
        C.track(sh, p.aimHold, dt, D.COMBAT.shield);
        if (sh.up) speed *= D.COMBAT.shield.moveMult;
        if (E.time < p.status.chillUntil) speed *= 0.7;
        if (p.slow) speed *= 1 - p.slow;
        if (p.overSlow && p.overSlow.until > E.time) speed *= 1 - p.overSlow.amt; // an overcharged frost staff
        speed *= buffMult(p, 'speedMult');
        if (p.pull) pullStep(p, dt);
        else {
            if (p.dashT > 0) {
                p.dashT -= dt;
                p.vx = p.dashX * D.COMBAT.player.speed * D.COMBAT.dash.speedMult;
                p.vy = p.dashY * D.COMBAT.player.speed * D.COMBAT.dash.speedMult;
            } else {
                const accel = tile === T.ICE ? 2.2 : 16;
                const f = Math.min(1, accel * dt);
                p.vx += (mv.x * speed - p.vx) * f; p.vy += (mv.y * speed - p.vy) * f;
            }
            E.move(p, (p.vx + p.kbx) * dt, (p.vy + p.kby) * dt, solidsNear(p.x, p.y, 80));
        }
        const kd = Math.exp(-9 * dt); p.kbx *= kd; p.kby *= kd;
        p.dashCd = Math.max(0, p.dashCd - dt);
        p.iframes = Math.max(0, p.iframes - dt);
        p.flash = Math.max(0, p.flash - dt);
        p.perfectFlash = Math.max(0, p.perfectFlash - dt);
        // hazards underfoot
        if (tile === T.LAVA && p.dashT <= 0) {
            const z = D.ZONES[g.zoneId];
            p.hp -= (z.lavaDps || 10) * (1 - st.fireResist) * dt;
            p.lavaT += dt;
            if (p.lavaT > 0.25) { p.lavaT = 0; E.burst(p.x, p.y + 10, '#ff8a3d', 3, 50, { life: 0.4, grav: -60 }); }
            if (p.hp <= 0 && !p.dead) { p.hp = 0; p.dead = true; WHW.onPlayerDeath(); return; }
        }
        if (E.time < p.status.burnUntil) {
            p.hp -= p.status.burnDps * (1 - st.fireResist) * dt;
            if (p.hp <= 0 && !p.dead) { p.hp = 0; p.dead = true; WHW.onPlayerDeath(); return; }
        } else p.status.burnDps = 0;
        // regen: fast in town, slow once out of a fight for a while
        if (g.inTown) p.hp = Math.min(p.maxHp, p.hp + D.COMBAT.player.regenTown * dt);
        else p.hp = Math.min(p.maxHp, p.hp + ((E.time - p.lastHurt > 6 ? 1.5 : 0) + st.regen) * dt);
        p.igDrain = igniteTick(p, dt);
        if (p.dead) return;
        // mana (the Mystic's): Burning Stick eats it; otherwise it comes back, much faster standing still
        const beamDrain = beamTick(p, dt);
        if (p.dead) return;
        p.stillT = !p.beam && !mv.x && !mv.y && Math.hypot(p.vx, p.vy) < D.COMBAT.mana.stillSpeed ? p.stillT + dt : 0;
        if (st.usesMana) C.manaStep(p.mana, p.igDrain + beamDrain, dt, st.manaRegen, p.stillT);
        p.manaFlash = Math.max(0, p.manaFlash - dt);
        A.updatePlayerWeapon(p, dt);
    };

    function trailPush(owner, x, y, kind) {
        owner.trail.push({ x, y, kind, t: E.time });
        if (owner.trail.length > 9) owner.trail.shift();
    }
    A.updatePlayerWeapon = function (p, dt) {
        const g = game();
        // pouring out Ice Beam: no weapon at all
        if (p.beam) { p.power = 0; p.powerMode = null; C.staminaStep(p.stam, 0, dt, g.pstats.stamRegen); return; }
        const it = weaponItem();
        const b = W.baseOf(it);
        if (!b) { p.weapon = null; return; }
        if (!p.weapon || p.weapon.cls !== b.cls) p.weapon = C.newWeapon(b.cls, p.weapon ? p.weapon.theta : p.facing);
        const w = p.weapon, P = D.WEAPON_CLASSES[b.cls];
        const st = W.gearStats(it);
        const mods = { wMult: st.wMult, aMult: st.aMult, winded: p.stam.winded };
        const aim = E.aimPoint(p.x, p.y);
        let target = p.aimHold;
        if (aim && Math.hypot(aim.x - p.x, aim.y - p.y) > 24) target = p.aimHold = angTo(p, aim);
        let drain = 0;
        if (b.cls === 'bow') {
            if (w.drawing) {
                const pull = E.mouse.type === 'touch' ? C.bowPull(E.touch.ax0, E.touch.ay0, E.touch.ax, E.touch.ay, P) : C.bowPull(w.anchorX, w.anchorY, E.mouse.sx, E.mouse.sy, P);
                if (pull) { target = pull.angle; C.bowStep(w, pull.target, dt, P); } else C.bowStep(w, 0, dt, P);
                if (w.draw >= 0.95) drain = 6;
            }
            C.track(w, target, dt, P, mods);
            p.facing = w.theta;
            p.power = w.draw; p.powerHit = w.draw >= P.minDraw; p.powerPerfect = w.draw >= 0.95 && w.fullFor >= P.steadyFrom && w.fullFor <= P.steadyTo;
        } else {
            const assist = C.assistTarget(w, dt);
            if (assist !== null) target = assist;
            C.track(w, target, dt, P, mods);
            p.facing = w.theta;
            const tipV = Math.abs(w.omega) * P.len;
            if (b.cls === 'staff') {
                C.spearStep(w, aim ? Math.hypot(aim.x - p.x, aim.y - p.y) : 40, dt, P);
                drain = staffStep(p, w, P, st, b, dt, C.radialSpeed(w, dt));
            } else if (b.cls === 'spear') {
                const ad = aim ? Math.hypot(aim.x - p.x, aim.y - p.y) : 40;
                C.spearStep(w, ad, dt, P);
                const vr = C.radialSpeed(w, dt);
                if (vr >= P.vMin || tipV >= P.bashV) drain = P.stam;
                p.power = Math.max(0, vr) / P.vFull;
                p.powerHit = vr >= P.vMin; p.powerPerfect = vr >= P.vFull * 0.97;
                if (!p.shield.up && !(p.staggerUntil > E.time)) spearHits(p, w, P, st, b, dt, vr);
                trailPush(p, p.x + Math.cos(w.theta) * w.r, p.y + Math.sin(w.theta) * w.r, vr >= P.vMin ? (vr >= P.vFull * 0.97 ? 'perfect' : 'hit') : 'slow');
            } else {
                if (tipV >= P.vMin) drain = P.stam;
                p.power = tipV / P.vFull;
                p.powerHit = tipV >= P.vMin; p.powerPerfect = tipV >= P.vMin + (P.vFull - P.vMin) * D.COMBAT.perfect.at;
                if (!p.shield.up && !(p.staggerUntil > E.time)) meleeHits(p, w, P, st, b, dt);
                trailPush(p, p.x + Math.cos(w.theta) * P.len, p.y + Math.sin(w.theta) * P.len, p.powerPerfect ? 'perfect' : p.powerHit ? 'hit' : 'slow');
            }
        }
        // Burning Stick: show how long the fire has burned (how big the blow will be) on the swing meter
        if (p.ignite) {
            const a = D.ABILITIES[p.ignite.id], k = Math.min(1, (E.time - p.ignite.at) / a.maxSec);
            p.power = k; p.powerHit = true; p.powerPerfect = k >= 1; p.powerMode = 'fire';
        } else if (p.powerMode === 'fire') p.powerMode = null;
        C.staminaStep(p.stam, drain, dt, g.pstats.stamRegen * (p.shield.up ? D.COMBAT.shield.regenMult : 1) * (p.exhaustUntil > E.time ? 0 : 1));
    };
    // Called by world.js when the button goes down / up
    A.press = function (p) {
        const w = p.weapon, b = W.baseOf(weaponItem());
        if (!w || !b || p.stunUntil > E.time) return;
        if (b.cls === 'bow') {
            if (p.shield.up) return;
            if ((game().state.cons.arrow || 0) <= 0) { WHW.toast('Out of arrows. Make them at the Workbench or buy them from the Trader.', 'bad'); return; }
            w.drawing = true; w.anchorX = E.mouse.sx; w.anchorY = E.mouse.sy; w.draw = 0; w.fullFor = 0;
        } else if (WHW.settings.assist) {
            C.assistStart(w, p.aimHold);
        }
    };
    A.release = function (p) {
        const w = p.weapon;
        if (!w || w.cls !== 'bow' || !w.drawing) return;
        w.drawing = false;
        const P = D.WEAPON_CLASSES.bow;
        const shot = C.bowRelease(w, P, Math.random);
        if (!shot) return;
        const g = game();
        if ((g.state.cons.arrow || 0) <= 0) return;
        if (rnd() >= g.pstats.arrowSave) g.state.cons.arrow--;
        p.shotSeq = (p.shotSeq || 0) + 1;
        const st = W.gearStats(weaponItem());
        const a = w.theta + shot.angleOff;
        g.projectiles.push({ kind: 'arrow', team: 'player', x: p.x + Math.cos(a) * 16, y: p.y + Math.sin(a) * 16, vx: Math.cos(a) * shot.speed, vy: Math.sin(a) * shot.speed,
            r: 4, life: P.life, dmg: st.dmg * shot.dmgMult * dmgBuff(p) * (g.pstats.dmgBy.bow || 1), steady: shot.steady, w: weaponItem().base, kb: P.kb, chill: st.chill, burn: st.burn,
            crit: st.crit + g.pstats.crit + buffSum(p, 'crit'), lifesteal: (st.lifesteal || 0) + g.pstats.lifesteal, hit: new Set() });
        if (shot.steady) { E.floatText(p.x, p.y - 30, 'STEADY', '#ffc83d', 12); }
        WHW.sfx('bow');
    };

    function contactPoint(px, py, angle, r) { return { x: px + Math.cos(angle) * r, y: py + Math.sin(angle) * r }; }
    // A player weapon struck a combatant
    function strike(p, t, info) {
        const g = game();
        const { s, cls, angle, dir, st, assist, swingId, cx, cy } = info;
        const P = D.WEAPON_CLASSES[cls];
        if (p.ignite) igniteStrike(p, t, angle + dir * Math.PI / 2 * 0.7);
        const combo = C.comboHit(p.combo, dir, E.time, swingId);
        // a spear thrust gains damage from the speed you are moving toward the target (dash into it for the most)
        const mom = cls === 'spear' ? C.momentumMult(p.vx * Math.cos(angle) + p.vy * Math.sin(angle), g.pstats.momentum + buffSum(p, 'momentum')) : 1;
        const hd = C.hitDamage(info.baseDmg, s, combo, (assist ? D.COMBAT.assist.mult : 1) * mom * dmgBuff(p) * (g.pstats.dmgBy[cls] || 1));
        const critChance = st.crit + g.pstats.crit + buffSum(p, 'crit');
        const charge = mom >= 1.25 ? 'CHARGE x' + mom.toFixed(1) : '';
        if (t.kind === 'remote') {
            // another player: they check the hit and take it on their own page (shield, armor and all)
            let m = 1;
            if (P.backstab && C.fromBehind(angle, t.facing)) m *= P.backstab;
            if (rnd() < critChance) m *= 1.5;
            WHW.online.hitRemote(t, { kind: C.hasReach(cls) ? 'thrust' : 'melee', dmg: hd.dmg * m, ang: angle + dir * Math.PI / 2 * 0.7, perfect: hd.perfect, x: cx, y: cy });
            E.burst(cx, cy, hd.perfect ? '#ffc83d' : '#ffffff', hd.perfect ? 12 : 7, 160, { angle: angle + dir * Math.PI / 2, spread: 1.4, life: 0.35 });
            E.addHitStop(D.COMBAT.hitStop * (0.5 + s));
            WHW.sfx(hd.perfect ? 'perfect' : 'hit');
            return;
        }
        let mult = 1, text = '';
        if (P.armored && t.armor > 0) mult *= P.armored;
        if (P.backstab && C.fromBehind(angle, t.facing) && t.kind !== 'dummy') { mult *= P.backstab + g.pstats.backstab; text = 'BACKSTAB'; g.state.stats.backstabs++; }
        if (mom >= 1.25 && t.kind !== 'dummy') g.state.stats.rushHits++; // the Lancer's challenge
        const crit = rnd() < critChance;
        if (crit) mult *= 1.5;
        if (t.def && t.def.shell && !C.fromBehind(angle, t.facing)) { mult *= t.def.shell; text = 'SHELL'; }
        if (t.def && t.def.resist) { const tier = W.baseOf(weaponItem()).tier; if (!t.def.resistBy.includes(tier)) { mult *= 1 - t.def.resist; text = text || 'RESISTS'; } }
        if (t.kind === 'boss' && t.exposedUntil > E.time) { mult *= t.def.exposeMult || 2; text = 'CORE HIT'; }
        if (t.kind === 'boss' && t.def.axeBonus && cls === 'axe') mult *= t.def.axeBonus;
        const armor = t.armorBrokenUntil > E.time ? 0 : t.armor;
        const dmg = C.mitigate(hd.dmg * mult, armor);
        if (combo >= 2 && !text) text = 'COMBO x' + (combo + 1);
        if (charge) text = charge;
        A.damage(t, dmg, { from: p, kbAngle: angle + dir * Math.PI / 2 * 0.7, kb: P.kb * st.kbMult, s, perfect: hd.perfect, crit, burn: st.burn, chill: st.chill, text });
        const steal = (st.lifesteal || 0) + g.pstats.lifesteal;
        if (steal) p.hp = Math.min(p.maxHp, p.hp + dmg * steal);
        E.burst(cx, cy, hd.perfect ? '#ffc83d' : '#ffffff', hd.perfect ? 12 : 7, 160, { angle: angle + dir * Math.PI / 2, spread: 1.4, life: 0.35 });
        if (hd.perfect) p.perfectFlash = 0.25;
        E.addHitStop(D.COMBAT.hitStop * (0.5 + s));
        E.addShake(1 + 3 * s);
        WHW.sfx(hd.perfect ? 'perfect' : 'hit');
    }
    function tink(p, x, y, msg) {
        E.burst(x, y, '#d9dde6', 4, 90, { life: 0.25, size: 2 });
        WHW.sfx('tink');
        if (msg) WHW.hint(msg);
    }
    function meleeHits(p, w, P, st, b, dt) {
        const g = game();
        const reach = P.len + 40;
        const assist = w.assistT >= 0;
        for (const t of g.actors.concat(pvpTargets())) {
            if (t.dead || !C.canDamage('player', t.team) || Math.abs(t.x - p.x) > reach + t.r || Math.abs(t.y - p.y) > reach + t.r) continue;
            const h = C.sweepHit(p.x, p.y, w.prevTheta, w.theta, P.r0, P.len, t.x, t.y, t.r);
            if (!h) continue;
            const cp = contactPoint(p.x, p.y, h.phi, h.contact);
            if (E.wallBetween(p.x, p.y, cp.x, cp.y)) continue;
            if ((w.hitCd.get(t.id) || 0) > E.time) continue;
            const v = C.contactSpeed(w, dt, h.contact);
            const s = C.swingPower(v, P.vMin, P.vFull);
            if (s < 0) {
                if (v > D.COMBAT.tinkSpeed) { w.hitCd.set(t.id, E.time + 0.2); tink(p, cp.x, cp.y, t.kind === 'dummy' ? 'Too slow! Swing the mouse faster across the target.' : null); }
                continue;
            }
            w.hitCd.set(t.id, E.time + P.cd);
            strike(p, t, { s, cls: b.cls, angle: h.phi, dir: Math.sign(w.omega) || 1, st, assist, swingId: w.swingId, cx: cp.x, cy: cp.y, baseDmg: st.dmg });
            if (t.kind === 'rival') clashCheck(p, t);
        }
        // tools on nodes
        for (const n of E.nodesNear(p.x, p.y, reach)) {
            if (!A.nodeAlive(n) || n.def.tool === 'hand') continue;
            const h = C.sweepHit(p.x, p.y, w.prevTheta, w.theta, P.r0, P.len, n.x, n.y, n.r);
            if (!h) continue;
            if ((w.hitCd.get(n.id) || 0) > E.time) continue;
            const v = C.contactSpeed(w, dt, h.contact);
            const s = C.swingPower(v, P.vMin, P.vFull);
            const cp = contactPoint(p.x, p.y, h.phi, h.contact);
            if (s < 0) { if (v > D.COMBAT.tinkSpeed) { w.hitCd.set(n.id, E.time + 0.25); tink(p, cp.x, cp.y); } continue; }
            w.hitCd.set(n.id, E.time + P.cd);
            hitNode(p, n, s, cp, W.baseOf(weaponItem()));
        }
    }
    function spearHits(p, w, P, st, b, dt, vr) {
        const g = game();
        const assist = w.assistT >= 0;
        const targets = g.actors.concat(pvpTargets()).filter(t => !t.dead && C.canDamage('player', t.team) && Math.abs(t.x - p.x) < 140 && Math.abs(t.y - p.y) < 140);
        if (w.armed && vr >= P.vMin) {
            let pierced = w.pierced || 0;
            const pierce = P.pierce + g.pstats.pierce;
            for (const t of targets) {
                if (pierced >= pierce) break;
                if ((w.hitCd.get(t.id) || 0) > E.time) continue;
                const h = C.thrustHit(p.x, p.y, w.theta, w.rPrev, w.r, t.x, t.y, t.r, P.tipLen, P.hitWidth);
                if (!h) continue;
                const cp = contactPoint(p.x, p.y, w.theta, h.along);
                if (E.wallBetween(p.x, p.y, cp.x, cp.y)) continue;
                w.hitCd.set(t.id, E.time + P.cd);
                const s = C.swingPower(vr, P.vMin, P.vFull);
                strike(p, t, { s, cls: 'spear', angle: w.theta, dir: 0, st, assist, swingId: w.swingId + 1000 * (w.thrusts || 0), cx: cp.x, cy: cp.y, baseDmg: st.dmg });
                pierced++;
            }
            w.pierced = pierced;
            if (pierced >= pierce || w.r >= P.reachMax - 0.5) { w.armed = false; w.thrusts = (w.thrusts || 0) + 1; w.pierced = 0; }
        }
        if (w.r < P.reachMin + (P.reachMax - P.reachMin) * 0.5) w.pierced = 0;
        // a fast sideways sweep bashes with the shaft
        const tipV = Math.abs(w.omega) * w.r;
        if (tipV >= P.bashV) for (const t of targets) bashHit(p, w, P, st, t);
    }
    // A blow with the shaft of a spear or staff swept sideways; true if it landed
    function bashHit(p, w, P, st, t) {
        if ((w.hitCd.get(t.id) || 0) > E.time) return false;
        const h = C.sweepHit(p.x, p.y, w.prevTheta, w.theta, P.r0, w.r, t.x, t.y, t.r + (P.hitWidth || 0));
        if (!h || E.wallBetween(p.x, p.y, t.x, t.y)) return false;
        w.hitCd.set(t.id, E.time + P.bashCd);
        const dir = Math.sign(w.omega) || 1, ang = h.phi + dir * Math.PI / 2;
        if (p.ignite) igniteStrike(p, t, ang);
        if (t.kind === 'remote') { WHW.online.hitRemote(t, { kind: 'bash', dmg: st.dmg * P.bashDmg, ang, perfect: false }); WHW.sfx('hit'); return true; }
        const dmg = C.mitigate(st.dmg * P.bashDmg * dmgBuff(p) * (game().pstats.dmgBy[w.cls] || 1), t.armor);
        A.damage(t, dmg, { from: p, kbAngle: ang, kb: P.bashKb * st.kbMult, s: 1, text: 'BASH' });
        WHW.sfx('hit');
        return true;
    }

    // ---------------- staffs ----------------
    // A staff moves like a spear. Its own blows are weak; what it is for is magic: in the hands of a class its magic names
    // (D.STAFF_MAGIC users), a thrust or a swing that touches nobody casts that magic's spell, as strong as the charge built
    // by holding the staff drawn back. The staff's magic for the player now, or null (wrong class, or Burning Stick lit).
    function staffMagic(b) {
        const sm = b && D.STAFF_MAGIC[b.magic];
        return sm && sm.users.includes(W.classId(game().state)) && !game().player.ignite ? sm : null;
    }
    // A plain staff blow (no Burning Stick behind it) gives a class with mana some back
    function staffMana(p) {
        if (!game().pstats.usesMana) return;
        p.mana.val = Math.min(D.COMBAT.mana.max, p.mana.val + D.COMBAT.mana.hitGain);
        p.manaFlash = 0.3;
    }
    // One step of a staff in hand: charge, thrusts, swings, and the spells of the ones that missed. Returns stamina drain/s.
    // Sweeping the staff round from the charge position pushes the tip out too, so a sweep wins over a thrust: a thrust only
    // starts while the staff turns slowly, becomes a swing if it starts sweeping, and its spell waits a moment (w.pending)
    // in case it does. After a swing the tip still moving out is no thrust (w.lock, until it stops).
    function staffStep(p, w, P, st, b, dt, vr) {
        const g = game(), sm = staffMagic(b);
        const free = !p.shield.up && !(p.staggerUntil > E.time) && !(p.stunUntil > E.time);
        if (sm) {
            // past a full charge it overcharges: a little more damage, and past the safe part it turns on you (overTick)
            const back = w.r <= P.reachMin + (P.reachMax - P.reachMin) * P.chargeBelow;
            if (back && w.charge >= 1) w.over = (w.over || 0) + dt;
            C.staffCharge(w, dt, P);
            if (w.charge >= 1 && w.over > 0) overTick(p, w, sm);
        } else { w.charge = 0; w.over = 0; }
        const targets = g.actors.concat(pvpTargets()).filter(t => !t.dead && C.canDamage('player', t.team) && Math.abs(t.x - p.x) < 140 && Math.abs(t.y - p.y) < 140);
        const om = Math.abs(w.omega), dir = Math.sign(w.omega);
        let drain = 0;
        if (w.lock && !w.swing && vr < P.vMin * 0.5) w.lock = false;
        if (w.thrust && !w.thrust.hit && om >= P.swingW) { w.thrust = null; w.armed = false; }
        if (w.pending && (om >= P.swingW || Math.abs(C.wrap(w.theta - w.pending.ang)) > P.thrustDrift)) w.pending = null;
        // a thrust: the tip flicked outward. It ends once the tip stops, reaches full length or lands
        if (!w.thrust && !w.swing && !w.lock && w.armed && vr >= P.vMin && om < P.swingW * P.thrustTurn && free) w.thrust = { hit: 0 };
        if (w.thrust) {
            drain = P.stam;
            const th = w.thrust, pierce = P.pierce + g.pstats.pierce;
            for (const t of targets) {
                if (th.hit >= pierce || !free) break;
                if ((w.hitCd.get(t.id) || 0) > E.time) continue;
                const h = C.thrustHit(p.x, p.y, w.theta, w.rPrev, w.r, t.x, t.y, t.r, P.tipLen, P.hitWidth);
                if (!h) continue;
                const cp = contactPoint(p.x, p.y, w.theta, h.along);
                if (E.wallBetween(p.x, p.y, cp.x, cp.y)) continue;
                w.hitCd.set(t.id, E.time + P.cd);
                const lit = !!p.ignite;
                strike(p, t, { s: C.swingPower(Math.max(vr, P.vMin), P.vMin, P.vFull), cls: 'staff', angle: w.theta, dir: 0, st, assist: false,
                    swingId: w.swingId + 1000 * (w.thrusts || 0), cx: cp.x, cy: cp.y, baseDmg: st.dmg * P.melee });
                th.hit++;
                if (!lit) staffMana(p);
            }
            if (th.hit >= pierce || vr < P.vMin * 0.5 || w.r >= P.reachMax - 0.5) {
                w.armed = false; w.thrusts = (w.thrusts || 0) + 1; w.thrust = null;
                if (!th.hit && sm && free) w.pending = { at: E.time, ang: w.theta };
                else if (!th.hit && !sm && !p.ignite && D.STAFF_MAGIC[b.magic]) WHW.hint('Only a ' + D.STAFF_MAGIC[b.magic].users.map(c => D.CLASSES[c].name).join(' or ') + ' can cast spells with a staff.');
            }
        }
        // the missed thrust's spell, once it is clear the staff isn't sweeping
        if (w.pending && E.time - w.pending.at >= P.thrustHold) { const pd = w.pending; w.pending = null; if (sm && free) castSpell(p, w, sm, 'thrust', pd.ang, 0); }
        // a swing: the staff swept round fast. It ends when it slows down or turns back
        if (!w.thrust && !w.swing && om >= P.swingW && free) { w.swing = { dir, swept: 0, hit: false }; w.lock = true; w.pending = null; }
        if (w.swing) {
            const sw = w.swing;
            drain = P.stam;
            if (dir === sw.dir && om >= P.swingW * 0.6) {
                sw.swept += Math.abs(C.wrap(w.theta - w.prevTheta));
                if (free && !sw.hit) for (const t of targets) { const lit = !!p.ignite; if (bashHit(p, w, P, st, t)) { sw.hit = true; if (!lit) staffMana(p); } }
            } else {
                w.swing = null;
                if (!sw.hit && sm && free && sw.swept >= P.swingArc) castSpell(p, w, sm, 'swing', w.prevTheta - sw.dir * sw.swept / 2, sw.swept);
            }
        }
        // the swing meter shows the charge to a caster, and how fast the tip moves to anyone else
        if (sm) { p.power = w.charge; p.powerHit = w.charge > 0; p.powerPerfect = w.charge >= 1; p.powerMode = 'charge'; }
        else { p.power = Math.max(0, vr) / P.vFull; p.powerHit = vr >= P.vMin; p.powerPerfect = vr >= P.vFull * 0.97; p.powerMode = null; }
        trailPush(p, p.x + Math.cos(w.theta) * w.r, p.y + Math.sin(w.theta) * w.r, w.thrust || w.swing ? (sm && w.charge >= 1 ? 'perfect' : 'hit') : 'slow');
        return drain;
    }
    // An overcharged staff turns on its holder, by its magic (STAFF_MAGIC over): fire burns you, harder the longer;
    // frost slows you (and keeps slowing you a while after the spell); lightning goes off by itself at the top
    function overTick(p, w, sm) {
        const ov = sm.over, O = D.STAFF_OVER, pen = C.overPenalty(ov, w.over);
        if (!pen.past) return;
        if (!w.overSaid) { w.overSaid = true; E.floatText(p.x, p.y - 44, 'OVERCHARGED', '#ff6b6b', 13, 0.9); }
        if (pen.burnDps) { p.status.burnUntil = Math.max(p.status.burnUntil, E.time + ov.linger); p.status.burnDps = Math.max(p.status.burnDps, pen.burnDps); }
        if (pen.slow) p.overSlow = { amt: pen.slow, until: E.time + ov.linger };
        if (ov.kind === 'shock' && w.over >= O.max) {
            w.charge = 0; w.over = 0; w.overSaid = false;
            E.floatText(p.x, p.y - 44, 'OVERLOAD!', '#ffe66b', 15, 1);
            boltFx({ x: p.x, y: p.y - 40 }, p, sm.color);
            A.stunPlayer(pen.stun);
            WHW.sfx('hurt');
        } else if (E.perf !== 'low' && rnd() < 0.3) { const tip = weaponTip(p); E.burst(tip.x, tip.y, sm.color, 1, 60, { life: 0.3, size: 3 }); }
    }
    // Cast a staff's spell (which: 'thrust' or 'swing') toward ang; arc: how far the swing swept. Spends the charge.
    function castSpell(p, w, sm, which, ang, arc) {
        const g = game(), sp = sm[which], P = D.WEAPON_CLASSES.staff;
        if (E.time - w.shotAt < P.shotCd) return;
        const tip = weaponTip(p), ps = g.pstats, pool = ps.usesMana ? p.mana : p.stam, cost = C.spellCost(sp.mana, w.charge) * ps.abilityStam; // a weak spell costs less
        if (pool.val < cost) { // fizzles
            E.burst(tip.x, tip.y, '#8a8f9c', 5, 50, { life: 0.4, grav: -40 });
            if (ps.usesMana) WHW.hint('Out of mana. It comes back faster standing still, and each staff blow that lands gives some.');
            return;
        }
        pool.val -= cost; pool.idle = 0;
        const it = weaponItem(), b = W.baseOf(it), st = W.gearStats(it), charge = w.charge || 0, full = charge >= 1;
        const over = full ? (w.over || 0) : 0, pen = C.overPenalty(sm.over, over), overMult = C.overBonus(over);
        w.charge = 0; w.shotAt = E.time; w.over = 0; w.overSaid = false;
        const dmg = st.dmg * sp.dmg * C.chargeMult(charge, sm.charge) * overMult * dmgBuff(p) * (g.pstats.dmgBy.staff || 1);
        // an overcharged lightning staff jolts you as it lets go
        if (pen.stun) { E.floatText(p.x, p.y - 58, 'ZAPPED', '#ffe66b', 13, 0.9); A.stunPlayer(pen.stun); }
        // other players see it fly (world-online.js): an odd shot number is a bolt, an even one a wave
        p.shotSeq = (p.shotSeq || 0) + 1;
        if ((p.shotSeq % 2 === 1) !== (sp.kind === 'bolt')) p.shotSeq++;
        const pr = { team: 'player', life: sp.life, dmg, kb: sp.kb, burn: !!sp.burn, frost: !!sp.frost, chain: sp.chain || null, look: sp.look, color: sm.color,
            spell: true, magic: b.magic, tier: b.tier, w: it.base, steady: full, pierce: sp.pierce || 0,
            crit: st.crit + g.pstats.crit + buffSum(p, 'crit'), lifesteal: (st.lifesteal || 0) + g.pstats.lifesteal, hit: new Set(), charge };
        if (sp.kind === 'bolt') {
            const v = sp.speed * (0.85 + 0.25 * charge);
            g.projectiles.push(Object.assign(pr, { kind: 'bolt', x: tip.x, y: tip.y, vx: Math.cos(ang) * v, vy: Math.sin(ang) * v, r: sp.r * (0.7 + 0.6 * charge) }));
        } else {
            g.projectiles.push(Object.assign(pr, { kind: 'wave', ox: p.x, oy: p.y, dir: ang, arc: Math.max(sp.arcMin, Math.min(sp.arcMax, arc)), rad: P.reachMin, speed: sp.speed,
                band: sp.band * (0.8 + 0.4 * charge), x: p.x + Math.cos(ang) * P.reachMin, y: p.y + Math.sin(ang) * P.reachMin, vx: 0, vy: 0, r: 0, pierce: 999 }));
        }
        if (full) E.floatText(p.x, p.y - 30, sp.name.toUpperCase() + (over > 0.05 ? ' x' + overMult.toFixed(2) : '') + '!', over > D.STAFF_OVER.safe ? '#ff9a6b' : '#ffc83d', 13, 0.8);
        E.burst(tip.x, tip.y, sm.color, 6 + Math.round(8 * charge), 90, { life: 0.35 });
        E.addShake(1 + 2 * charge);
        WHW.sfx(full ? 'perfect' : 'bow');
    }

    // A staff spell landing on t (a monster, boss, rival or another player): damage, burn and frost stacks
    function spellHit(p, pr, t, dmg, ang) {
        const amp = elemAmp(t); // spells are all fire, frost or lightning
        dmg *= amp;
        if (t.kind === 'remote') {
            // their page checks it and applies the burn and frost from its own copy of the staff's magic
            WHW.online.hitRemote(t, { kind: 'spell', w: pr.w, dmg: dmg * (rnd() < (pr.crit || 0) ? 1.5 : 1), ang, perfect: pr.steady });
            WHW.sfx('hit');
            return;
        }
        let mult = 1, text = amp > 1 ? 'AMPLIFIED' : '';
        if (t.def && t.def.shell && !C.fromBehind(ang, t.facing)) { mult *= t.def.shell; text = 'SHELL'; }
        if (t.kind === 'boss' && t.exposedUntil > E.time) { mult *= t.def.exposeMult || 2; text = 'CORE HIT'; }
        if (t.def && t.def.resist && !t.def.resistBy.includes(pr.tier)) mult *= 1 - t.def.resist;
        const crit = rnd() < (pr.crit || 0);
        if (crit) mult *= 1.5;
        const d = C.mitigate(dmg * mult, t.armorBrokenUntil > E.time ? 0 : t.armor);
        A.damage(t, d, { from: p, kbAngle: ang, kb: pr.kb || 90, s: pr.steady ? 1 : 0.6, perfect: pr.steady, crit, burn: pr.burn, text });
        const sm = D.STAFF_MAGIC[pr.magic];
        if (pr.frost && sm && sm.frost && !t.dead) frostOn(t, sm.frost);
        if (pr.lifesteal) p.hp = Math.min(p.maxHp, p.hp + d * pr.lifesteal);
        WHW.sfx('hit');
    }
    // one more frost stack on t (a combatant, or the player); every few, it is slowed
    function frostOn(t, F) {
        const r = C.frostStack(t, F, E.time);
        if (r.slowed) { E.floatText(t.x, t.y - t.r - 38, 'SLOWED', '#8fe3ff', 13, 1); E.burst(t.x, t.y, '#cfefff', 12, 80, { life: 0.5 }); }
        else E.floatText(t.x, t.y - t.r - 38, '❄'.repeat(r.n), '#bfefff', 11, 0.6);
    }
    A.frostPlayer = (F) => frostOn(game().player, F);
    // a chaining bolt jumps on from the first one it hit to the nearest ones it hasn't, weaker each jump
    function chainFrom(p, pr, first) {
        const ch = pr.chain;
        let cur = first, dmg = pr.dmg;
        for (let n = 0; n < ch.jumps; n++) {
            const c0 = cur;
            const next = abilityTargets().filter(t => !pr.hit.has(t.id) && Math.hypot(t.x - c0.x, t.y - c0.y) <= ch.range + t.r && !E.wallBetween(c0.x, c0.y, t.x, t.y))
                .sort((u, v) => Math.hypot(u.x - c0.x, u.y - c0.y) - Math.hypot(v.x - c0.x, v.y - c0.y))[0];
            if (!next) break;
            dmg *= ch.falloff;
            pr.hit.add(next.id);
            boltFx(c0, next, pr.color);
            spellHit(p, pr, next, dmg, angTo(c0, next));
            cur = next;
        }
    }

    function hitNode(p, n, s, cp, b) {
        const g = game();
        const power = W.toolPower(weaponItem(), n.def);
        if (!power) {
            const need = n.def.tool === 'axe' ? 'an axe' : 'a pickaxe';
            const tierName = D.TIERS[Math.max(0, n.def.tier - 1)].name;
            const msg = b.cls !== n.def.tool ? `Use ${need} on ${n.def.name}.` : `${n.def.name} needs a ${tierName} ${n.def.tool === 'axe' ? 'Axe' : 'Pickaxe'} or better.`;
            tink(p, cp.x, cp.y, msg);
            return;
        }
        const a = Math.atan2(cp.y - n.y, cp.x - n.x);
        const crackHit = Math.abs(C.wrap(a - n.crack)) < 25 * Math.PI / 180;
        n.work += power * (0.5 + 0.5 * s) * (crackHit ? 2 : 1);
        n.shake = 0.15;
        E.burst(cp.x, cp.y, n.def.color, crackHit ? 10 : 5, 140, { life: 0.4, grav: 200 });
        if (crackHit) { E.floatText(n.x, n.y - n.r - 10, 'CRACK!', '#ffe14d', 12, 0.7); WHW.sfx('crack'); } else WHW.sfx(n.def.tool === 'axe' ? 'chop' : 'mine');
        // the crack moves to a new spot on the side facing the player
        n.crack = angTo(n, p) + (rnd() - 0.5) * 2 * (100 * Math.PI / 180);
        E.addShake(1 + s);
        if (n.work >= n.def.work) A.harvest(n, crackHit);
    }
    A.harvest = function (n, bonus) {
        const g = game();
        const it = weaponItem();
        const st = it ? W.gearStats(it) : null;
        const loot = W.nodeLoot(g.state, n.type, Math.random, now(), { bonus, ack: g.ack, toolYield: st ? st.yield : 0, inTown: g.inTown, zone: g.zoneId });
        WHW.showLoot(n.x, n.y, loot);
        n.work = 0;
        n.readyAt = now() + n.def.respawn * 1000;
        W.noteNode(g.state, n.key, n.def.respawn, now());
        E.burst(n.x, n.y, n.def.color, 16, 160, { life: 0.6, grav: 160 });
        WHW.sfx('gather');
    };

    // Rivals and the player crossing fast blades: both pushed apart, the slower one staggers
    function clashCheck(p, r) {
        if (!p.weapon || !r.weapon || p.weapon.cls === 'bow' || r.weapon.cls === 'bow') return;
        const P1 = D.WEAPON_CLASSES[p.weapon.cls], P2 = D.WEAPON_CLASSES[r.weapon.cls];
        const s1 = C.bladeSegment(p.x, p.y, p.weapon.theta, P1.r0, C.hasReach(p.weapon.cls) ? p.weapon.r : P1.len);
        const s2 = C.bladeSegment(r.x, r.y, r.weapon.theta, P2.r0, C.hasReach(r.weapon.cls) ? r.weapon.r : P2.len);
        if (!C.segmentsCross(...s1, ...s2)) return false;
        const v1 = Math.abs(p.weapon.omega) * P1.len, v2 = Math.abs(r.weapon.omega) * P2.len;
        if (v1 < P1.vMin || v2 < P2.vMin) return false;
        const a = angTo(r, p);
        p.kbx += Math.cos(a) * 220; p.kby += Math.sin(a) * 220;
        r.kbx -= Math.cos(a) * 220; r.kby -= Math.sin(a) * 220;
        if (v1 >= v2) r.ai.staggerUntil = E.time + 0.4; else p.stam.val = Math.max(0, p.stam.val - 20);
        const mx = (s1[2] + s2[2]) / 2, my = (s1[3] + s2[3]) / 2;
        E.burst(mx, my, '#fff6cf', 14, 220, { life: 0.35 });
        E.floatText(mx, my - 10, 'CLASH', '#fff6cf', 13);
        WHW.sfx('clash');
        return true;
    }

    // ---------------- monsters ----------------
    function moveActor(m, dx, dy) {
        return E.move(m, dx, dy, solidsNear(m.x, m.y, 60));
    }
    function startAttack(m, i, target) {
        const a = m.def.attacks ? m.def.attacks[i] : null;
        m.atk = { a, i, t: 0, phase: 'windup', dir: angTo(m, target), tx: target.x, ty: target.y, hit: false, sx: m.x, sy: m.y };
        m.facing = m.atk.dir;
    }
    function inSector(m, target, dir, reach, arc) {
        const d = dist(m, target);
        if (d > reach + target.r) return false;
        return Math.abs(C.wrap(angTo(m, target) - dir)) <= arc / 2 + Math.asin(Math.min(1, target.r / Math.max(d, 1)));
    }
    function shoot(m, angle, a, extra = {}) {
        const g = game();
        g.projectiles.push(Object.assign({ kind: 'orb', team: m.team, x: m.x + Math.cos(angle) * m.r, y: m.y + Math.sin(angle) * m.r,
            vx: Math.cos(angle) * a.speed, vy: Math.sin(angle) * a.speed, r: a.pr || 7, life: 2.2, dmg: m.dmg * (a.dmg || 1), color: m.def.color,
            burn: a.burn || m.def.burn, chill: a.chill, owner: m.id }, extra));
    }
    // An attack's windup is over: it lands (or starts moving). target: who it was aimed at (a shared boss may aim at another
    // player); damage is only ever checked against the player on this page.
    function attackBegin(m, k, target) {
        const a = k.a;
        const me = game().player;
        const fire = !!(a.burn || (m.def && m.def.burn));
        if (a.type === 'slam' || a.type === 'nova') {
            if (dist(m, me) <= a.radius + me.r) A.hurtPlayer(m.dmg * (a.dmg || 1), { from: m, kb: 260, burn: a.burn, chill: a.chill, fire, drain: m.def.drain });
            E.burst(m.x, m.y, a.chill ? '#bfefff' : '#d9c6a5', 22, 220, { life: 0.5 });
            E.addShake(5);
            WHW.sfx('slam');
            if (m.kind === 'boss' && m.def.exposeAfterSlam) { m.exposedUntil = E.time + m.def.exposeAfterSlam; E.floatText(m.x, m.y - m.r - 20, 'CORE EXPOSED!', '#ffe14d', 15, 1.4); }
        } else if (a.type === 'arc') {
            if (inSector(m, me, k.dir, a.reach, a.arc)) A.hurtPlayer(m.dmg * (a.dmg || 1), { from: m, kb: 180, fire });
            WHW.sfx('swoosh');
        } else if (a.type === 'shoot') {
            const lead = m.elite || m.kind === 'boss' ? 0.25 : 0;
            const tx = target.x + (target.vx || 0) * lead, ty = target.y + (target.vy || 0) * lead;
            shoot(m, Math.atan2(ty - m.y, tx - m.x), a);
        } else if (a.type === 'ring') {
            const n = a.count + (m.phase || 0) * 4;
            const off = rnd() * TAU;
            for (let i = 0; i < n; i++) shoot(m, off + i * TAU / n, a);
        } else if (a.type === 'lunge' || a.type === 'charge') {
            m.vx = Math.cos(k.dir) * a.speed; m.vy = Math.sin(k.dir) * a.speed;
            WHW.sfx('swoosh');
        }
    }
    function attackActive(m, k, target, dt) {
        const a = k.a;
        const me = game().player;
        if (a.type === 'lunge' || a.type === 'charge') {
            // a shared boss followed from another player's page moves where that page says (k.follow)
            const hitWall = k.follow ? false : moveActor(m, Math.cos(k.dir) * a.speed * dt, Math.sin(k.dir) * a.speed * dt);
            // the charge stops on impact (it doesn't carry the player along)
            if (!k.hit && dist(m, me) <= m.r + me.r + 4) { k.hit = true; A.hurtPlayer(m.dmg * (a.dmg || 1), { from: m, kb: 300 }); return true; }
            if (hitWall && a.stunOnWall) { m.status.stunUntil = E.time + a.stunOnWall; E.floatText(m.x, m.y - m.r - 12, 'STUNNED', '#ffe7a3', 12); E.addShake(4); return true; }
        } else if (a.type === 'cone') {
            if (a.track) k.dir += Math.max(-a.track * dt, Math.min(a.track * dt, C.wrap(angTo(m, target) - k.dir)));
            k.tick = (k.tick || 0) - dt;
            if (k.tick <= 0) {
                k.tick = a.tick || 0.25;
                if (inSector(m, me, k.dir, a.reach, a.arc)) A.hurtPlayer(m.dmg * (a.dmg || 0.35), { from: m, burn: a.burn, fire: true });
                if (E.perf !== 'low') for (let i = 0; i < 4; i++) E.burst(m.x + Math.cos(k.dir) * m.r, m.y + Math.sin(k.dir) * m.r, i % 2 ? '#ff9a3d' : '#ffd24d', 1, a.reach * 1.6, { angle: k.dir, spread: a.arc, life: 0.45, size: 5 });
            }
        } else if (a.type === 'sweep') {
            const f = Math.min(1, k.t / a.active);
            k.cur = k.from + k.span * f;
            const hit = C.sweepHit(m.x, m.y, k.prev === undefined ? k.from : k.prev, k.cur, m.r, a.reach, me.x, me.y, me.r);
            k.prev = k.cur;
            if (hit && !k.hit) { k.hit = true; A.hurtPlayer(m.dmg * (a.dmg || 1), { from: m, kb: 260 }); }
        }
        return false;
    }

    // Which attack a monster can use now (in range, off cooldown)
    function pickAttack(m, d) {
        for (let i = 0; i < m.def.attacks.length; i++) if (m.cds[i] <= E.time && d <= m.def.attacks[i].range + m.r) return i;
        return -1;
    }
    A.updateMonster = function (m, dt) {
        const g = game(), p = g.player;
        statusTick(m, dt);
        if (m.dead) return;
        m.flash = Math.max(0, m.flash - dt);
        const d = dist(m, p);
        const def = m.def;
        if (m.kind === 'dummy') return;
        // knockback drift
        if (m.kbx || m.kby) { moveActor(m, m.kbx * dt, m.kby * dt); const kd = Math.exp(-8 * dt); m.kbx *= kd; m.kby *= kd; if (Math.abs(m.kbx) + Math.abs(m.kby) < 2) m.kbx = m.kby = 0; }
        if (E.time < m.status.stunUntil) { m.atk = null; return; }
        const slow = E.time < m.status.chillUntil ? 0.6 : 1;
        // aggro and leash
        const aggroR = m.elite ? 340 : 280;
        if (!p.dead && !g.inTown && d < aggroR) m.aggro = true;
        if (m.aggro && (p.dead || Math.hypot(m.x - m.home.x, m.y - m.home.y) > 700 || d > 600)) { m.aggro = false; m.atk = null; m.returning = true; }
        if (m.returning) {
            const hd = Math.hypot(m.home.x - m.x, m.home.y - m.y);
            if (hd < 12) { m.returning = false; m.hp = m.maxHp; }
            else { const a = Math.atan2(m.home.y - m.y, m.home.x - m.x); moveActor(m, Math.cos(a) * m.speed * 1.4 * dt, Math.sin(a) * m.speed * 1.4 * dt); m.hp = Math.min(m.maxHp, m.hp + m.maxHp * 0.3 * dt); }
            return;
        }
        if (m.atk) {
            const k = m.atk;
            k.t += dt;
            if (k.phase === 'windup') {
                if (k.a.type === 'shoot' || k.a.type === 'arc') k.dir = angTo(m, p);
                if (k.t >= k.a.windup) { k.phase = 'active'; k.t = 0; attackBegin(m, k, p); }
            } else {
                const stop = attackActive(m, k, p, dt);
                if (stop || k.t >= (k.a.active || 0.1)) { m.cds[k.i] = E.time + k.a.cooldown; m.atk = null; }
            }
            return;
        }
        if (!m.aggro) {
            // wander near home
            m.wanderT -= dt;
            if (m.wanderT <= 0) { m.wanderT = 2 + rnd() * 3; m.wander = rnd() < 0.5 ? null : { x: m.home.x + (rnd() - 0.5) * 160, y: m.home.y + (rnd() - 0.5) * 160 }; }
            if (m.wander && def.move !== 'still') {
                const a = angTo(m, m.wander);
                if (dist(m, m.wander) > 6) { moveActor(m, Math.cos(a) * m.speed * 0.35 * dt, Math.sin(a) * m.speed * 0.35 * dt); m.facing = a; }
            }
            return;
        }
        const i = pickAttack(m, d);
        if (i >= 0 && !E.wallBetween(m.x, m.y, p.x, p.y)) { startAttack(m, i, p); return; }
        // movement styles
        const toP = angTo(m, p);
        let mx = 0, my = 0, sp = m.speed * slow;
        if (def.move === 'chase') { if (d > m.r + p.r + 6) { mx = Math.cos(toP); my = Math.sin(toP); } }
        else if (def.move === 'kite') {
            const [lo, hi] = def.keep;
            if (d < lo) { mx = -Math.cos(toP); my = -Math.sin(toP); }
            else if (d > hi) { mx = Math.cos(toP); my = Math.sin(toP); }
            else { mx = Math.cos(toP + Math.PI / 2) * 0.6; my = Math.sin(toP + Math.PI / 2) * 0.6; }
            if (def.blink && d < lo * 0.6 && (m.blinkAt || 0) < E.time) {
                m.blinkAt = E.time + def.blink;
                E.burst(m.x, m.y, def.color, 10, 120, { life: 0.4 });
                const a = toP + Math.PI + (rnd() - 0.5);
                const old = { x: m.x, y: m.y };
                moveActor(m, Math.cos(a) * 140, Math.sin(a) * 140);
                if (old.x === m.x && old.y === m.y) {} else E.burst(m.x, m.y, def.color, 10, 120, { life: 0.4 });
            }
        } else if (def.move === 'hop') {
            m.hopT -= dt;
            if (m.hopT <= 0) { m.hopT = 0.9 + rnd() * 0.4; m.hopVx = Math.cos(toP) * sp * 2.6; m.hopVy = Math.sin(toP) * sp * 2.6; m.hopLeft = 0.28; }
            if (m.hopLeft > 0) { m.hopLeft -= dt; moveActor(m, m.hopVx * dt, m.hopVy * dt); }
        } else if (def.move === 'erratic') {
            const wob = Math.sin(E.time * 5 + m.hopT * 10) * 1.2;
            mx = Math.cos(toP + wob); my = Math.sin(toP + wob);
        } else if (def.move === 'flank') {
            const a = toP + m.flank * 0.9 * (d > 90 ? 1 : 0);
            mx = Math.cos(a); my = Math.sin(a);
        }
        if (mx || my) { moveActor(m, mx * sp * dt, my * sp * dt); m.facing = toP; }
    };
    function statusTick(t, dt) {
        if (t.dead) return;
        if (E.time < t.status.burnUntil && t.status.burnDps) {
            t.hp -= t.status.burnDps * elemAmp(t) * dt; // burns are fire: a rift makes them worse
            if (E.perf !== 'low' && rnd() < dt * 8) E.burst(t.x, t.y - t.r * 0.5, '#ff9a3d', 1, 40, { life: 0.5, grav: -80 });
            if (t.hp <= 0 && t.kind !== 'dummy') A.kill(t, game().player);
            if (t.kind === 'dummy') t.hp = t.maxHp;
        } else t.status.burnDps = 0;
    }

    // ---------------- bosses ----------------
    const BOSS_MOVES = {
        sweep: { type: 'sweep', windup: 0.75, active: 0.9, reach: 230, arc: 2.6 },
        ring: { type: 'ring', windup: 0.6, active: 0.1, count: 12, speed: 210, pr: 8 },
        charge: { type: 'charge', windup: 0.75, active: 0.75, speed: 470, stunOnWall: 1.4 },
        summon: { type: 'summon', windup: 0.9, active: 0.2, count: 3 },
        roots: { type: 'wave', windup: 0.6, active: 0.2, speed: 230, width: 22, dmg: 0.8 },
        boulders: { type: 'targets', windup: 0.4, active: 0.2, count: 3, radius: 60, spread: 80, delay: 1.0, around: 'player', dmg: 1.1 },
        slam: { type: 'slam', windup: 0.95, active: 0.2, radius: 125 },
        stalactites: { type: 'targets', windup: 0.4, active: 0.2, count: 8, radius: 46, delay: 1.1, around: 'arena', dmg: 0.9 },
        breath: { type: 'cone', windup: 0.7, active: 1.8, reach: 250, arc: 0.85, track: 1.1, tick: 0.2, dmg: 0.3, burn: true },
        meteors: { type: 'targets', windup: 0.4, active: 0.2, count: 5, radius: 58, delay: 1.0, stagger: 0.25, around: 'player', spread: 120, burn: true, dmg: 1 },
        clone: { type: 'clone', windup: 0.8, active: 0.2 },
        spikes: { type: 'spikes', windup: 0.4, active: 0.6, count: 9, gap: 44, radius: 26, delay: 0.75, dmg: 1 },
    };
    A.BOSS_MOVES = BOSS_MOVES;
    function bossPhase(b) { const f = b.hp / b.maxHp; return f > 0.66 ? 0 : f > 0.33 ? 1 : 2; }
    function nextBossMove(b) {
        const list = b.def.phases[b.phase].filter(n => !(b.kind === 'clone' && (n === 'summon' || n === 'clone')));
        if (b.planI >= b.plan.length) { b.plan = list.slice().sort(() => rnd() - 0.5); b.planI = 0; }
        return b.plan[b.planI++];
    }
    function hazard(h) { game().hazards.push(Object.assign({ t: 0 }, h)); }
    function bossBegin(b, k, p) {
        const a = k.a, g = game();
        const scale = 1 + b.phase * 0.15;
        if (a.type === 'summon') {
            const alive = g.actors.filter(x => x.summoned && !x.dead).length;
            for (let i = 0; i < a.count + b.phase && alive + i < 5; i++) {
                const ang = rnd() * TAU;
                const m = A.makeMonster(b.def.summon, b.x + Math.cos(ang) * 80, b.y + Math.sin(ang) * 80, { summoned: true });
                m.aggro = true;
                E.collideTiles(m);
                g.actors.push(m);
            }
            E.burst(b.x, b.y, '#9cff9c', 20, 160);
        } else if (a.type === 'wave') {
            hazard({ kind: 'wave', x: b.x, y: b.y, r: b.r, speed: a.speed * scale, width: a.width, max: 420, dmg: b.dmg * (a.dmg || 1), owner: b.id });
        } else if (a.type === 'targets') {
            const n = a.count + b.phase * 2;
            for (let i = 0; i < n; i++) {
                let x, y;
                if (a.around === 'arena') { const ang = rnd() * TAU, rr = Math.sqrt(rnd()) * (g.map.boss.r - 40); x = g.map.boss.x + Math.cos(ang) * rr; y = g.map.boss.y + Math.sin(ang) * rr; }
                else { const ang = rnd() * TAU, rr = i === 0 ? 0 : rnd() * (a.spread || 80); x = p.x + (p.vx || 0) * 0.3 + Math.cos(ang) * rr; y = p.y + (p.vy || 0) * 0.3 + Math.sin(ang) * rr; }
                hazard({ kind: 'circle', x, y, r: a.radius, windup: a.delay + (a.stagger || 0) * i, dmg: b.dmg * (a.dmg || 1), burn: a.burn, owner: b.id, lingering: a.burn && b.def.burn ? 3 : 0 });
            }
        } else if (a.type === 'spikes') {
            const ang = angTo(b, p);
            for (let i = 1; i <= a.count; i++) hazard({ kind: 'circle', x: b.x + Math.cos(ang) * (b.r + i * a.gap), y: b.y + Math.sin(ang) * (b.r + i * a.gap), r: a.radius, windup: a.delay + i * 0.06, dmg: b.dmg * (a.dmg || 1), chill: true, owner: b.id, ice: true });
            if (b.phase >= 1) for (const off of [-0.5, 0.5]) for (let i = 1; i <= a.count - 2; i++) hazard({ kind: 'circle', x: b.x + Math.cos(ang + off) * (b.r + i * a.gap), y: b.y + Math.sin(ang + off) * (b.r + i * a.gap), r: a.radius, windup: a.delay + 0.3 + i * 0.06, dmg: b.dmg * (a.dmg || 1), chill: true, owner: b.id, ice: true });
        } else if (a.type === 'clone') {
            if (!g.actors.some(x => x.kind === 'clone' && !x.dead)) {
                const ang = rnd() * TAU;
                const c = A.makeBoss(b.type, b.x + Math.cos(ang) * 120, b.y + Math.sin(ang) * 120, { clone: true });
                c.phase = b.phase;
                E.collideTiles(c);
                g.actors.push(c);
                E.burst(c.x, c.y, b.def.color, 24, 200);
            }
        } else if (a.type === 'sweep') {
            const toP = angTo(b, p);
            const dir = rnd() < 0.5 ? 1 : -1;
            k.from = toP - dir * a.arc / 2; k.span = dir * a.arc; k.prev = undefined;
        } else {
            attackBegin(b, k, p);
        }
    }
    A.updateBoss = function (b, dt) {
        const g = game(), p = g.player;
        statusTick(b, dt);
        if (b.dead) return;
        b.flash = Math.max(0, b.flash - dt);
        // online: one page runs a shared boss (the host) and the others follow it (world-online.js)
        const net = b.kind === 'boss' ? WHW.online : null;
        if (net && net.bossSpectate(b, dt)) return;
        const follower = !!(net && net.bossFollower(b));
        const aim = (net && !follower && net.bossAim(b)) || p;
        const arena = g.map.boss;
        const fromArena = Math.hypot(p.x - arena.x, p.y - arena.y);
        const inArena = fromArena < arena.r + 10;
        if (b.kind === 'boss') {
            if (!b.active) { if (inArena && !p.dead) { b.active = true; WHW.onBossWake && WHW.onBossWake(b); } else return; }
            // getting knocked out of the arena doesn't reset the fight: only walking well away for a while does
            if (fromArena > arena.r + 120 || p.dead) {
                b.leaveT += dt;
                if (b.leaveT > (p.dead ? 2 : 6)) {
                    // the player left: reset the fight
                    b.active = false; b.hp = b.maxHp; b.atk = null; b.x = b.home.x; b.y = b.home.y; b.leaveT = 0; b.phase = 0;
                    g.actors.filter(a => a.kind === 'clone' || a.summoned).forEach(a => { a.dead = true; });
                    g.hazards.length = 0;
                    WHW.onBossReset && WHW.onBossReset(b);
                    return;
                }
            } else b.leaveT = 0;
        }
        const ph = bossPhase(b);
        if (ph !== b.phase && b.kind === 'boss') { b.phase = ph; b.plan = []; E.floatText(b.x, b.y - b.r - 30, ph === 1 ? 'ENRAGED' : 'FURIOUS', '#ff6b7a', 18, 1.6); E.addShake(8); }
        // the Frozen WH's cold aura slows anyone close
        if (b.def.aura) p.slow = dist(b, p) < b.def.aura.radius ? b.def.aura.slow : 0;
        if (b.kbx || b.kby) { E.move(b, b.kbx * dt * 0.3, b.kby * dt * 0.3); const kd = Math.exp(-10 * dt); b.kbx *= kd; b.kby *= kd; }
        if (E.time < b.status.stunUntil) { b.atk = null; return; }
        // following another page's boss: its position and attacks come from there; the attacks still play out here
        if (follower) net.bossFollow(b, dt);
        if (b.atk) {
            const k = b.atk;
            k.t += dt;
            const at = k.aimPt || aim;
            if (k.phase === 'windup') {
                if (k.a.type === 'charge' && !k.follow) k.dir = angTo(b, at);
                if (k.t >= k.a.windup) { k.phase = 'active'; k.t = 0; bossBegin(b, k, at); }
            } else {
                const stop = attackActive(b, k, at, dt);
                if (stop || k.t >= k.a.active) {
                    b.atk = null;
                    b.nextAtk = E.time + Math.max(0.35, 1.0 - b.phase * 0.25) * (b.kind === 'clone' ? 1.6 : 1);
                }
            }
            return;
        }
        if (follower) return;
        // drift toward the player, staying in the arena
        const toP = angTo(b, aim);
        if (dist(b, aim) > b.r + 50) E.move(b, Math.cos(toP) * b.speed * dt, Math.sin(toP) * b.speed * dt);
        const fromC = Math.hypot(b.x - arena.x, b.y - arena.y);
        if (fromC > arena.r - b.r) { const a = Math.atan2(b.y - arena.y, b.x - arena.x); b.x = arena.x + Math.cos(a) * (arena.r - b.r); b.y = arena.y + Math.sin(a) * (arena.r - b.r); }
        b.facing = toP;
        if (E.time >= b.nextAtk) {
            const name = nextBossMove(b);
            const a = BOSS_MOVES[name];
            b.atkSeq = (b.atkSeq || 0) + 1;
            b.atk = { a, name, t: 0, phase: 'windup', dir: toP, tx: aim.x, ty: aim.y, hit: false, aimUid: aim.uid || '' };
        }
    };

    // ---------------- rivals: AI with the player's weapon rules ----------------
    A.updateRival = function (r, dt) {
        const g = game(), p = g.player;
        statusTick(r, dt);
        if (r.dead) return;
        r.flash = Math.max(0, r.flash - dt);
        const ai = r.ai, rt = r.rt;
        ai.iframes = Math.max(0, ai.iframes - dt);
        if (r.kbx || r.kby) { E.move(r, r.kbx * dt, r.kby * dt, solidsNear(r.x, r.y, 60)); const kd = Math.exp(-9 * dt); r.kbx *= kd; r.kby *= kd; }
        const d = dist(r, p);
        if (!p.dead && !g.inTown && d < 360) r.aggro = true;
        if (r.aggro && (p.dead || d > 700)) { r.aggro = false; r.hp = Math.min(r.maxHp, r.hp + r.maxHp * 0.5); }
        const P = D.WEAPON_CLASSES[r.cls];
        const w = r.weapon;
        // reaction delay: the rival aims at where the player was a moment ago
        const f = 1 - Math.exp(-dt / rt.react);
        ai.aimX += (p.x - ai.aimX) * f; ai.aimY += (p.y - ai.aimY) * f;
        const toP = Math.atan2(ai.aimY - r.y, ai.aimX - r.x);
        if (!r.aggro) {
            C.track(w, r.facing, dt, P);
            if (r.cls === 'spear') C.spearStep(w, 30, dt, P);
            return;
        }
        const staggered = E.time < ai.staggerUntil;
        // dodge a fast blade
        const pw = p.weapon;
        if (pw && pw.cls !== 'bow' && ai.dodgeCd <= 0 && d < 80) {
            const PP = D.WEAPON_CLASSES[pw.cls];
            if (Math.abs(pw.omega) * PP.len > PP.vMin && rnd() < rt.dodge * dt * 8) {
                ai.dodgeCd = 1.6; ai.iframes = 0.2;
                const a = angTo(p, r) + (rnd() - 0.5);
                E.move(r, Math.cos(a) * 70, Math.sin(a) * 70, solidsNear(r.x, r.y, 100));
                E.burst(r.x, r.y + 8, 'rgba(255,255,255,0.6)', 6, 60, { life: 0.3 });
            }
        }
        ai.dodgeCd -= dt;
        // keep a fighting distance and circle the player
        const want = { sword: 40, dagger: 30, spear: 88, bow: 230 }[r.cls];
        ai.strafeT -= dt;
        if (ai.strafeT <= 0) { ai.strafeT = 1 + rnd() * 2; ai.strafe = -ai.strafe; }
        let mx = 0, my = 0;
        if (d > want + 20) { mx = Math.cos(toP); my = Math.sin(toP); }
        else if (d < want - 15) { mx = -Math.cos(toP); my = -Math.sin(toP); }
        mx += Math.cos(toP + Math.PI / 2) * ai.strafe * 0.55; my += Math.sin(toP + Math.PI / 2) * ai.strafe * 0.55;
        const sp = r.speed * (E.time < r.status.chillUntil ? 0.6 : 1) * (staggered ? 0.3 : 1) * (r.cls === 'bow' && ai.drawing ? 0.6 : 1);
        const ml = Math.hypot(mx, my) || 1;
        E.move(r, mx / ml * sp * dt, my / ml * sp * dt, solidsNear(r.x, r.y, 60));
        r.facing = toP;
        // attack windows
        if (!staggered && E.time >= ai.next && d < want + 60) { ai.attackUntil = E.time + (r.cls === 'bow' ? 0.75 : 0.85); ai.next = E.time + 1.0 + rnd() * 0.9; ai.phase0 = E.time; }
        const attacking = E.time < ai.attackUntil && !staggered;
        if (r.cls === 'bow') {
            C.track(w, toP, dt, P);
            if (attacking) { ai.drawing = true; w.draw = Math.min(1, w.draw + dt / 0.6); }
            else if (ai.drawing) {
                ai.drawing = false;
                const lead = d / 800;
                const a = Math.atan2(p.y + p.vy * lead - r.y, p.x + p.vx * lead - r.x) + (rnd() - 0.5) * 0.08;
                g.projectiles.push({ kind: 'arrow', team: 'rival', x: r.x, y: r.y, vx: Math.cos(a) * 800, vy: Math.sin(a) * 800, r: 4, life: 0.9, dmg: r.dmg * (0.4 + 0.6 * w.draw), owner: r.id, hit: new Set() });
                w.draw = 0;
                WHW.sfx('bow');
            }
            return;
        }
        let target = toP;
        if (attacking && r.cls !== 'spear') target = toP + Math.sin((E.time - ai.phase0) * TAU * rt.sweepHz) * 1.25;
        C.track(w, target, dt, P);
        if (r.cls === 'spear') {
            const jab = attacking && Math.sin((E.time - ai.phase0) * TAU * 1.7) > 0;
            C.spearStep(w, jab ? 170 : 34, dt, P);
            const vr = C.radialSpeed(w, dt);
            if (w.armed && vr >= P.vMin && (w.hitCd.get('player') || 0) <= E.time && C.thrustHit(r.x, r.y, w.theta, w.rPrev, w.r, p.x, p.y, p.r)) {
                w.hitCd.set('player', E.time + P.cd); w.armed = false;
                A.hurtPlayer(r.dmg * (0.5 + 0.5 * C.swingPower(vr, P.vMin, P.vFull)), { from: r, kb: 160 });
            }
            if (w.r >= P.reachMax - 0.5) w.armed = false;
            return;
        }
        const h = C.sweepHit(r.x, r.y, w.prevTheta, w.theta, P.r0, P.len, p.x, p.y, p.r);
        if (h && (w.hitCd.get('player') || 0) <= E.time) {
            const s = C.swingPower(C.contactSpeed(w, dt, h.contact), P.vMin, P.vFull);
            if (s >= 0) { w.hitCd.set('player', E.time + P.cd); A.hurtPlayer(r.dmg * (0.5 + 0.5 * s), { from: r, kb: P.kb }); }
        }
        if (pw && pw.cls !== 'bow' && d < 110) clashCheck(p, r);
    };

    // ---------------- projectiles and hazards ----------------
    A.updateProjectiles = function (dt) {
        const g = game(), p = g.player;
        for (const pr of g.projectiles) {
            pr.life -= dt;
            if (pr.kind === 'wave') {
                // a wave grows outward from where it was cast; walls shelter what is behind them (checked per target)
                pr.rad += pr.speed * dt;
                pr.x = pr.ox + Math.cos(pr.dir) * pr.rad; pr.y = pr.oy + Math.sin(pr.dir) * pr.rad;
            } else {
                pr.x += pr.vx * dt; pr.y += pr.vy * dt;
                const t = E.tileAt(pr.x, pr.y);
                if (t === G.T.WALL || t === G.T.BUILDING) { pr.life = 0; E.burst(pr.x, pr.y, pr.kind === 'bolt' ? pr.color : '#c9b38f', pr.kind === 'bolt' ? 8 : 3, 60, { life: 0.3 }); continue; }
            }
            if (pr.team === 'fx') continue; // another player's arrow, only for show: its hit arrives from their page
            if (pr.team === 'player') {
                for (const a of g.actors.concat(pr.reflected ? [] : pvpTargets())) {
                    if (a.dead || !C.canDamage('player', a.team) || pr.hit.has(a.id)) continue;
                    if (pr.kind === 'wave') {
                        if (!C.waveHit(pr.ox, pr.oy, pr.dir, pr.arc, pr.rad, pr.band, a.x, a.y, a.r) || E.wallBetween(pr.ox, pr.oy, a.x, a.y)) continue;
                    } else if (Math.hypot(a.x - pr.x, a.y - pr.y) > a.r + pr.r) continue;
                    pr.hit.add(a.id);
                    const ang = pr.kind === 'wave' ? Math.atan2(a.y - pr.oy, a.x - pr.ox) : Math.atan2(pr.vy, pr.vx);
                    if (pr.spell) {
                        if (pr.kind === 'bolt') E.burst(pr.x, pr.y, pr.color, 10 + Math.round(12 * pr.charge), 140, { life: 0.4 });
                        spellHit(p, pr, a, pr.dmg, ang);
                        if (pr.chain) chainFrom(p, pr, a);
                        if (pr.pierce > 0) { pr.pierce--; continue; }
                        pr.life = 0;
                        break;
                    }
                    if (a.kind === 'remote') {
                        if (pr.ability) WHW.online.hitRemote(a, { kind: 'ab', w: pr.abil, dmg: pr.dmg, ang });
                        else WHW.online.hitRemote(a, { kind: 'arrow', w: pr.w, dmg: pr.dmg * (rnd() < (pr.crit || 0) ? 1.5 : 1), ang, perfect: pr.steady, x: pr.x, y: pr.y });
                        E.burst(pr.x, pr.y, '#ffffff', 6, 120, { life: 0.3 });
                        WHW.sfx('hit');
                        if (pr.ability && pr.pierce > 0) { pr.pierce--; continue; }
                        pr.life = 0;
                        break;
                    }
                    let mult = 1, text = pr.text || '';
                    if (a.def && a.def.shell && !C.fromBehind(ang, a.facing)) { mult *= a.def.shell; text = 'SHELL'; }
                    if (a.kind === 'boss' && a.exposedUntil > E.time) { mult *= a.def.exposeMult || 2; text = 'CORE HIT'; }
                    if (a.def && a.def.resist && !a.def.resistBy.includes(W.baseOf(weaponItem()) ? W.baseOf(weaponItem()).tier : 0)) mult *= 1 - a.def.resist;
                    const crit = rnd() < (pr.crit || 0);
                    if (crit) mult *= 1.5;
                    const dmg = C.mitigate(pr.dmg * mult, a.armorBrokenUntil > E.time ? 0 : a.armor);
                    A.damage(a, dmg, { from: p, kbAngle: ang, kb: pr.kb || 90, s: pr.steady ? 1 : 0.5, perfect: pr.steady, crit, burn: pr.burn, chill: pr.chill, stunnedMult: pr.stunnedMult, text });
                    if (pr.stun) stun(a, pr.stun);
                    if (pr.lifesteal) p.hp = Math.min(p.maxHp, p.hp + dmg * pr.lifesteal);
                    if (pr.kind === 'arrow' && !pr.ability && !pr.reflected && a.kind !== 'dummy') g.state.stats.arrowHits++;
                    WHW.sfx('hit');
                    if (pr.pierce > 0) { pr.pierce--; continue; }
                    pr.life = 0;
                    break;
                }
            } else if (!p.dead && Math.hypot(p.x - pr.x, p.y - pr.y) <= p.r + pr.r) {
                if (p.iframes > 0) continue;
                const from = g.actors.find(a => a.id === pr.owner) || pr;
                A.hurtPlayer(pr.dmg, { from, kb: 120, burn: pr.burn, chill: pr.chill, fire: !!pr.burn, fromAngle: Math.atan2(-pr.vy, -pr.vx), projectile: pr });
                pr.life = 0;
            }
        }
        g.projectiles = g.projectiles.filter(pr => pr.life > 0);
    };
    A.updateHazards = function (dt) {
        const g = game(), p = g.player;
        for (const h of g.hazards) {
            h.t += dt;
            if (h.kind === 'circle') {
                if (!h.done && h.t >= h.windup) {
                    h.done = true;
                    if (Math.hypot(p.x - h.x, p.y - h.y) <= h.r + p.r) A.hurtPlayer(h.dmg, { from: h, kb: 200, burn: h.burn, chill: h.chill, fire: !!h.burn, unblockable: true });
                    E.burst(h.x, h.y, h.ice ? '#bfefff' : h.burn ? '#ff9a3d' : '#cbb89a', 12, 180, { life: 0.45 });
                    E.addShake(3);
                }
                if (h.done && h.lingering) {
                    // lava pools keep burning for a while
                    if (h.t - h.windup < h.lingering) { if (Math.hypot(p.x - h.x, p.y - h.y) <= h.r * 0.8) { p.hp -= 12 * (1 - g.pstats.fireResist) * dt; if (p.hp <= 0 && !p.dead) { p.hp = 0; p.dead = true; WHW.onPlayerDeath(); } } }
                    else h.gone = true;
                } else if (h.done && h.t > h.windup + 0.25) h.gone = true;
            } else if (h.kind === 'wave') {
                const prev = h.r;
                h.r += h.speed * dt;
                const pd = Math.hypot(p.x - h.x, p.y - h.y);
                if (!h.hit && pd + p.r >= prev - h.width / 2 && pd - p.r <= h.r + h.width / 2 && p.iframes <= 0) { h.hit = true; A.hurtPlayer(h.dmg, { from: h, kb: 220 }); }
                if (h.r > h.max) h.gone = true;
            }
        }
        g.hazards = g.hazards.filter(h => !h.gone);
    };

    // ---------------- drawing ----------------
    function shadow(ctx, x, y, r) {
        ctx.fillStyle = 'rgba(0,0,0,0.25)';
        ctx.beginPath(); ctx.ellipse(x, y + r * 0.75, r * 0.95, r * 0.4, 0, 0, TAU); ctx.fill();
    }
    function circle(ctx, x, y, r, fill, stroke, lw = 2) {
        ctx.beginPath(); ctx.arc(x, y, r, 0, TAU);
        if (fill) { ctx.fillStyle = fill; ctx.fill(); }
        if (stroke) { ctx.strokeStyle = stroke; ctx.lineWidth = lw; ctx.stroke(); }
    }
    // Faces (players, townsfolk, bosses, statues) are cut into a circle once for each size on screen and kept, instead
    // of clipping and shrinking the whole picture every frame. stone: the statues' grey, carved look.
    const faceCache = new Map();
    function faceSprite(src, r, stone) {
        const im = E.img(src);
        if (!im) return null;
        const px = Math.max(4, Math.ceil(r * 2 * E.dpr * E.zoom));
        const key = src + '|' + px + (stone ? '|stone' : '');
        let cv = faceCache.get(key);
        if (!cv) {
            if (faceCache.size > 120) faceCache.clear(); // sizes change with the window and the graphics settings
            cv = document.createElement('canvas');
            cv.width = cv.height = px;
            const c = cv.getContext('2d');
            c.beginPath(); c.arc(px / 2, px / 2, px / 2, 0, TAU); c.clip();
            if (stone) c.filter = 'grayscale(1) brightness(0.72) contrast(1.15)';
            const s = Math.max(px / im.naturalWidth, px / im.naturalHeight);
            c.drawImage(im, (px - im.naturalWidth * s) / 2, (px - im.naturalHeight * s) / 2, im.naturalWidth * s, im.naturalHeight * s);
            faceCache.set(key, cv);
        }
        return cv;
    }
    function faceImg(ctx, src, x, y, r, alpha = 1, stone = false) {
        const sp = faceSprite(src, r, stone);
        if (!sp) { circle(ctx, x, y, r, stone ? '#8a8790' : '#e8d7b0'); return; }
        const a = ctx.globalAlpha;
        ctx.globalAlpha = a * alpha;
        ctx.drawImage(sp, x - r, y - r, r * 2, r * 2);
        ctx.globalAlpha = a;
    }
    function hpBar(ctx, a, w = 34, y = -8) {
        if (a.hp >= a.maxHp || a.kind === 'boss' || a.kind === 'dummy') return;
        const x = a.x - w / 2, yy = a.y - a.r + y - 6;
        ctx.fillStyle = 'rgba(0,0,0,0.6)'; ctx.fillRect(x - 1, yy - 1, w + 2, 6);
        ctx.fillStyle = a.team === 'rival' ? '#ff9a3d' : '#ff5b6b'; ctx.fillRect(x, yy, w * Math.max(0, a.hp / a.maxHp), 4);
    }

    // Tier colour of a weapon / armour piece
    const tierColor = (t) => (D.TIERS[t] ? D.TIERS[t].color : '#aaa');
    A.drawWeapon = function (ctx, x, y, w, cls, tier, opts = {}) {
        if (!w) return;
        const P = D.WEAPON_CLASSES[cls];
        const col = tierColor(tier);
        const th = w.theta;
        ctx.save();
        ctx.translate(x, y);
        ctx.rotate(th);
        ctx.lineCap = 'round';
        const wood = '#7a5230';
        if (cls === 'bow') {
            const pull = (w.draw || 0) * 14;
            ctx.strokeStyle = col; ctx.lineWidth = 3.5;
            ctx.beginPath(); ctx.arc(10, 0, 18, -1.15, 1.15); ctx.stroke();
            const ex = 10 + 18 * Math.cos(1.15), ey = 18 * Math.sin(1.15);
            ctx.strokeStyle = '#efe6cc'; ctx.lineWidth = 1.2;
            ctx.beginPath(); ctx.moveTo(ex, -ey); ctx.lineTo(10 + 4 - pull, 0); ctx.lineTo(ex, ey); ctx.stroke();
            if (w.drawing || (opts.rival && w.draw > 0)) {
                ctx.strokeStyle = '#d8c7a0'; ctx.lineWidth = 2;
                ctx.beginPath(); ctx.moveTo(14 - pull, 0); ctx.lineTo(40 - pull, 0); ctx.stroke();
                ctx.fillStyle = '#cfd6e0'; ctx.beginPath(); ctx.moveTo(44 - pull, 0); ctx.lineTo(37 - pull, -3); ctx.lineTo(37 - pull, 3); ctx.fill();
            }
        } else if (cls === 'spear') {
            const tip = w.r;
            ctx.strokeStyle = wood; ctx.lineWidth = 3.5;
            ctx.beginPath(); ctx.moveTo(tip - 66, 0); ctx.lineTo(tip - 8, 0); ctx.stroke();
            ctx.fillStyle = col;
            ctx.beginPath(); ctx.moveTo(tip + 6, 0); ctx.lineTo(tip - 10, -5); ctx.lineTo(tip - 10, 5); ctx.closePath(); ctx.fill();
        } else if (cls === 'staff') {
            // a gnarled shaft with a metal collar and an orb in its magic's colour that swells as it charges
            const tip = w.r, sm = D.STAFF_MAGIC[opts.magic], glow = sm ? sm.color : '#bfe3ff', ch = w.charge || 0;
            ctx.strokeStyle = '#6b4a2e'; ctx.lineWidth = 3.5;
            ctx.beginPath(); ctx.moveTo(tip - 62, 1); ctx.quadraticCurveTo(tip - 34, -2, tip - 9, 0); ctx.stroke();
            ctx.strokeStyle = col; ctx.lineWidth = 2;
            ctx.beginPath(); ctx.moveTo(tip - 9, -5); ctx.quadraticCurveTo(tip - 2, -7, tip + 1, -3); ctx.moveTo(tip - 9, 5); ctx.quadraticCurveTo(tip - 2, 7, tip + 1, 3); ctx.stroke();
            if (ch > 0) { ctx.globalAlpha = 0.25 + 0.3 * ch; ctx.fillStyle = glow; ctx.beginPath(); ctx.arc(tip - 2, 0, 6 + 9 * ch + (ch >= 1 ? Math.sin(E.time * 18) * 1.5 : 0), 0, TAU); ctx.fill(); ctx.globalAlpha = 1; }
            ctx.fillStyle = glow; ctx.beginPath(); ctx.arc(tip - 2, 0, 4 + 1.5 * ch, 0, TAU); ctx.fill();
            ctx.fillStyle = 'rgba(255,255,255,0.75)'; ctx.beginPath(); ctx.arc(tip - 3.5, -1.5, 1.5, 0, TAU); ctx.fill();
            if ((w.over || 0) > D.STAFF_OVER.safe) { ctx.strokeStyle = Math.floor(E.time * 16) % 2 ? '#ffffff' : '#ff4d4d'; ctx.lineWidth = 2; ctx.beginPath(); ctx.arc(tip - 2, 0, 11 + Math.random() * 4, 0, TAU); ctx.stroke(); }
        } else {
            const len = P.len;
            if (cls === 'sword' || cls === 'dagger') {
                ctx.strokeStyle = '#5a3d22'; ctx.lineWidth = 4;
                ctx.beginPath(); ctx.moveTo(2, 0); ctx.lineTo(P.r0, 0); ctx.stroke();
                ctx.strokeStyle = '#8a7a5a'; ctx.lineWidth = 3;
                ctx.beginPath(); ctx.moveTo(P.r0, -6); ctx.lineTo(P.r0, 6); ctx.stroke();
                ctx.fillStyle = col;
                const bw = cls === 'dagger' ? 3 : 4;
                ctx.beginPath(); ctx.moveTo(P.r0 + 1, -bw); ctx.lineTo(len - 6, -bw * 0.7); ctx.lineTo(len, 0); ctx.lineTo(len - 6, bw * 0.7); ctx.lineTo(P.r0 + 1, bw); ctx.closePath(); ctx.fill();
                ctx.strokeStyle = 'rgba(255,255,255,0.5)'; ctx.lineWidth = 1;
                ctx.beginPath(); ctx.moveTo(P.r0 + 3, 0); ctx.lineTo(len - 6, 0); ctx.stroke();
            } else if (cls === 'axe') {
                ctx.strokeStyle = wood; ctx.lineWidth = 4;
                ctx.beginPath(); ctx.moveTo(4, 0); ctx.lineTo(len, 0); ctx.stroke();
                ctx.fillStyle = col;
                ctx.beginPath(); ctx.moveTo(len - 14, -2); ctx.quadraticCurveTo(len - 4, -16, len + 4, -14); ctx.lineTo(len - 2, 2); ctx.closePath(); ctx.fill();
                ctx.beginPath(); ctx.moveTo(len - 14, 2); ctx.quadraticCurveTo(len - 6, 12, len + 1, 12); ctx.lineTo(len - 3, 0); ctx.closePath(); ctx.fill();
            } else if (cls === 'pickaxe') {
                ctx.strokeStyle = wood; ctx.lineWidth = 4;
                ctx.beginPath(); ctx.moveTo(4, 0); ctx.lineTo(len, 0); ctx.stroke();
                ctx.strokeStyle = col; ctx.lineWidth = 5;
                ctx.beginPath(); ctx.moveTo(len - 2, -16); ctx.quadraticCurveTo(len + 6, 0, len - 2, 16); ctx.stroke();
            }
        }
        // Burning Stick: the whole weapon in flames
        if (opts.fire && cls !== 'bow') {
            const end = C.hasReach(cls) ? w.r + 4 : P.len + 2, from = C.hasReach(cls) ? w.r - 60 : 6;
            ctx.globalAlpha = 0.45 + Math.sin(E.time * 23) * 0.1; ctx.strokeStyle = '#ff7b3a'; ctx.lineWidth = 9;
            ctx.beginPath(); ctx.moveTo(from, 0); ctx.lineTo(end, 0); ctx.stroke();
            ctx.globalAlpha = 0.8; ctx.strokeStyle = '#ffd36b'; ctx.lineWidth = 3;
            ctx.beginPath(); ctx.moveTo(from + 4, 0); ctx.lineTo(end - 2, 0); ctx.stroke();
            ctx.globalAlpha = 1;
        }
        ctx.restore();
    };
    function drawTrail(ctx, owner) {
        const tr = owner.trail;
        if (!tr || tr.length < 2) return;
        for (let i = 1; i < tr.length; i++) {
            const a = tr[i - 1], b = tr[i];
            if (b.kind === 'slow') continue;
            ctx.strokeStyle = b.kind === 'perfect' ? 'rgba(255,200,61,' : 'rgba(255,255,255,';
            ctx.strokeStyle += (i / tr.length * 0.7).toFixed(2) + ')';
            ctx.lineWidth = 2 + i * 0.5;
            ctx.beginPath(); ctx.moveTo(a.x, a.y); ctx.lineTo(b.x, b.y); ctx.stroke();
        }
    }
    A.drawPlayer = function (ctx, p) {
        const g = game();
        const it = weaponItem(), b = W.baseOf(it);
        const chest = W.baseOf(W.findGear(g.state, g.state.equip.chest));
        const helm = W.baseOf(W.findGear(g.state, g.state.equip.helmet));
        const boots = W.baseOf(W.findGear(g.state, g.state.equip.boots));
        shadow(ctx, p.x, p.y, p.r);
        if (p.iframes > 0 && p.dashT <= 0 && Math.floor(E.time * 20) % 2) ctx.globalAlpha = 0.6;
        if (boots) { circle(ctx, p.x - 6, p.y + 11, 4, tierColor(boots.tier)); circle(ctx, p.x + 6, p.y + 11, 4, tierColor(boots.tier)); }
        circle(ctx, p.x, p.y, p.r + 2, chest ? tierColor(chest.tier) : '#3a4a66', 'rgba(0,0,0,0.5)', 1.5);
        faceImg(ctx, g.faceSrc, p.x, p.y - 1, p.r - 1);
        if (helm) {
            ctx.strokeStyle = tierColor(helm.tier); ctx.lineWidth = 5;
            ctx.beginPath(); ctx.arc(p.x, p.y - 1, p.r - 1, Math.PI * 1.08, Math.PI * 1.92); ctx.stroke();
        }
        if (p.flash > 0) circle(ctx, p.x, p.y, p.r + 2, 'rgba(255,80,90,0.45)');
        for (const a of activeBuffs(p)) {
            if (a.reduce) circle(ctx, p.x, p.y, p.r + 5, 'rgba(185,169,138,0.22)', 'rgba(210,195,160,0.9)', 2.5);
            else circle(ctx, p.x, p.y, p.r + 6 + Math.sin(E.time * 14) * 1.5, null, a.color, 2);
        }
        if (p.protectedUntil > E.time && !g.inTown) circle(ctx, p.x, p.y, p.r + 7, 'rgba(120,200,255,0.12)', 'rgba(150,215,255,0.6)', 1.5);
        if (p.beam) {
            const a = D.ABILITIES[p.beam.id], ex = p.x + Math.cos(p.beam.ang) * p.beam.len, ey = p.y + Math.sin(p.beam.ang) * p.beam.len;
            ctx.save(); ctx.lineCap = 'round';
            ctx.globalAlpha = 0.3 + Math.sin(E.time * 30) * 0.06; ctx.strokeStyle = a.color; ctx.lineWidth = a.width * 2;
            ctx.beginPath(); ctx.moveTo(p.x, p.y); ctx.lineTo(ex, ey); ctx.stroke();
            ctx.globalAlpha = 0.9; ctx.strokeStyle = '#eaf8ff'; ctx.lineWidth = 4 + Math.random() * 2;
            ctx.beginPath(); ctx.moveTo(p.x, p.y); ctx.lineTo(ex, ey); ctx.stroke();
            ctx.restore();
        }
        if (p.ignite) circle(ctx, p.x, p.y, p.r + 4 + Math.sin(E.time * 20) * 1.5, null, p.ignite.emptyAt === null ? 'rgba(255,123,58,0.7)' : 'rgba(255,60,40,0.95)', 2);
        if (p.riposteUntil > E.time) { ctx.setLineDash([4, 4]); circle(ctx, p.x, p.y, p.r + 9, 'rgba(255,231,163,0.12)', '#ffe7a3', 2.5); ctx.setLineDash([]); }
        if (p.hookFx && (p.hookFx.until > E.time || p.pull)) {
            const h = p.hookFx;
            ctx.strokeStyle = '#8a6a44'; ctx.lineWidth = 2;
            ctx.beginPath(); ctx.moveTo(p.x, p.y); ctx.lineTo(h.x, h.y); ctx.stroke();
            ctx.strokeStyle = '#d9dde6'; ctx.lineWidth = 2.5;
            const ha = Math.atan2(h.y - p.y, h.x - p.x);
            ctx.beginPath(); ctx.arc(h.x - Math.cos(ha) * 4, h.y - Math.sin(ha) * 4, 5, ha - 1.2, ha + 1.2); ctx.stroke();
        }
        if (p.stunUntil > E.time) { ctx.fillStyle = '#ffe14d'; for (let i = 0; i < 3; i++) { const a = E.time * 5 + i * TAU / 3; ctx.fillRect(p.x + Math.cos(a) * p.r * 0.8 - 2, p.y - p.r - 8 + Math.sin(a) * 3, 4, 4); } }
        ctx.globalAlpha = 1;
        if (b) {
            drawTrail(ctx, p);
            A.drawWeapon(ctx, p.x, p.y, p.weapon, b.cls, b.tier, { magic: b.magic, fire: !!p.ignite });
        }
        const shb = W.baseOf(shieldItem());
        if (shb) A.drawShield(ctx, p.x, p.y, p.shield.theta, p.shield.up, shb.tier, p.shield.brokenUntil > E.time);
    };
    // A shield: held out in front toward the mouse when raised, slung at the side when not
    A.drawShield = function (ctx, x, y, theta, up, tier, broken) {
        const col = tier === 0 ? '#9a7a55' : tierColor(tier);
        ctx.save();
        ctx.translate(x, y);
        if (up) {
            ctx.rotate(theta);
            ctx.lineCap = 'round';
            ctx.strokeStyle = 'rgba(0,0,0,0.45)'; ctx.lineWidth = 9;
            ctx.beginPath(); ctx.arc(0, 0, 19, -0.75, 0.75); ctx.stroke();
            ctx.strokeStyle = col; ctx.lineWidth = 6;
            ctx.beginPath(); ctx.arc(0, 0, 19, -0.75, 0.75); ctx.stroke();
            ctx.strokeStyle = 'rgba(255,255,255,0.55)'; ctx.lineWidth = 1.5;
            ctx.beginPath(); ctx.arc(0, 0, 21.5, -0.6, 0.6); ctx.stroke();
            ctx.fillStyle = '#ffe7a3'; ctx.beginPath(); ctx.arc(19, 0, 2.2, 0, TAU); ctx.fill();
        } else {
            ctx.rotate(theta + Math.PI * 0.62);
            ctx.globalAlpha = broken ? 0.45 : 1;
            ctx.fillStyle = col; ctx.strokeStyle = 'rgba(0,0,0,0.5)'; ctx.lineWidth = 1.5;
            ctx.beginPath(); ctx.ellipse(13, 0, 5, 8, 0, 0, TAU); ctx.fill(); ctx.stroke();
        }
        ctx.restore();
    };
    // Another player (world-online.js): same look as the player, from what their page shares
    A.drawRemote = function (ctx, rp, hostile) {
        const info = rp.info || {};
        const tc = (t) => (t ? tierColor(t) : null);
        shadow(ctx, rp.x, rp.y, rp.r);
        if (rp.dead) ctx.globalAlpha = 0.35;
        if (info.b) { circle(ctx, rp.x - 6, rp.y + 11, 4, tc(info.b)); circle(ctx, rp.x + 6, rp.y + 11, 4, tc(info.b)); }
        circle(ctx, rp.x, rp.y, rp.r + 2, tc(info.c) || '#3a4a66', hostile ? 'rgba(255,90,100,0.85)' : 'rgba(0,0,0,0.5)', hostile ? 2 : 1.5);
        faceImg(ctx, info.f || 'mainimage/whathappened.jpeg', rp.x, rp.y - 1, rp.r - 1);
        if (info.h) { ctx.strokeStyle = tierColor(info.h); ctx.lineWidth = 5; ctx.beginPath(); ctx.arc(rp.x, rp.y - 1, rp.r - 1, Math.PI * 1.08, Math.PI * 1.92); ctx.stroke(); }
        if (rp.flash > 0) circle(ctx, rp.x, rp.y, rp.r + 2, 'rgba(255,255,255,0.5)');
        if (rp.protected && hostile) circle(ctx, rp.x, rp.y, rp.r + 7, 'rgba(120,200,255,0.12)', 'rgba(150,215,255,0.6)', 1.5);
        const wb = D.GEAR_BY_ID[info.w];
        if (wb && !rp.dead) {
            drawTrail(ctx, rp);
            A.drawWeapon(ctx, rp.x, rp.y, rp.weapon, wb.cls, wb.tier, { rival: true, magic: wb.magic });
        }
        const sb = D.GEAR_BY_ID[info.sh];
        if (sb && !rp.dead) A.drawShield(ctx, rp.x, rp.y, rp.shield.theta, rp.shield.up, sb.tier, false);
        ctx.globalAlpha = 1;
        E.label(ctx, info.n || 'Adventurer', rp.x, rp.y - rp.r - 16, { font: '700 11px Inter, sans-serif', fill: hostile ? '#ffb3bb' : '#e6f0ff', stroke: 'rgba(0,0,0,0.75)' });
        const w = 40, x = rp.x - w / 2, y = rp.y - rp.r - 12;
        ctx.fillStyle = 'rgba(0,0,0,0.6)'; ctx.fillRect(x - 1, y - 1, w + 2, 5);
        ctx.fillStyle = hostile ? '#ff5b6b' : '#5fd068'; ctx.fillRect(x, y, w * Math.max(0, Math.min(1, rp.hp / rp.maxHp)), 3);
    };
    // A speech bubble (chat) or a big emote above someone
    A.drawBubble = function (ctx, x, y, text, emote, alpha) {
        ctx.save();
        ctx.globalAlpha = Math.max(0, Math.min(1, alpha));
        ctx.font = emote ? '26px sans-serif' : '600 12px Inter, sans-serif';
        ctx.textAlign = 'center';
        if (emote) { ctx.fillText(text, x, y - 6); ctx.restore(); return; }
        const w = Math.min(220, ctx.measureText(text).width + 16), h = 22;
        ctx.fillStyle = 'rgba(15,18,27,0.9)'; ctx.strokeStyle = 'rgba(255,255,255,0.25)'; ctx.lineWidth = 1;
        ctx.beginPath(); ctx.roundRect ? ctx.roundRect(x - w / 2, y - h - 6, w, h, 8) : ctx.rect(x - w / 2, y - h - 6, w, h); ctx.fill(); ctx.stroke();
        ctx.beginPath(); ctx.moveTo(x - 5, y - 6); ctx.lineTo(x, y); ctx.lineTo(x + 5, y - 6); ctx.fill();
        ctx.fillStyle = '#f3f5fa';
        ctx.fillText(text.length > 34 ? text.slice(0, 33) + '…' : text, x, y - 13);
        ctx.restore();
    };
    // A knocked-out player's dropped loot; locked for everyone but the winner for a few seconds
    A.drawLootBag = function (ctx, bag, locked) {
        const bob = Math.sin(E.time * 3 + bag.x) * 2;
        shadow(ctx, bag.x, bag.y, 11);
        ctx.fillStyle = '#7a4a2a'; ctx.beginPath(); ctx.ellipse(bag.x, bag.y + bob, 12, 10, 0, 0, TAU); ctx.fill();
        ctx.fillStyle = '#ffc83d'; ctx.fillRect(bag.x - 6, bag.y - 11 + bob, 12, 4);
        circle(ctx, bag.x, bag.y + bob, 17, null, locked ? 'rgba(255,255,255,0.35)' : 'rgba(255,200,61,0.8)', 2);
        ctx.font = '700 10px Inter, sans-serif'; ctx.textAlign = 'center'; ctx.fillStyle = '#ffe7a3';
        ctx.fillText((locked ? '🔒 ' : '') + bag.by + "'s loot", bag.x, bag.y - 22 + bob);
    };
    // ---------------- townsfolk and the Hall of Gods ----------------
    const rgba = (hex, a) => { const n = parseInt(hex.slice(1), 16); return 'rgba(' + (n >> 16) + ',' + ((n >> 8) & 255) + ',' + (n & 255) + ',' + a + ')'; };
    // A quest giver. mark: 'new' (a quest to take), 'ready' (one to hand in), 'busy' (one under way) or null
    A.drawNpc = function (ctx, n, def, mark) {
        const x = n.x, y = n.y, r = 14, bob = Math.sin(E.time * 2 + x) * 1.2;
        shadow(ctx, x, y, r);
        circle(ctx, x, y + 3, r + 3, def.color, 'rgba(0,0,0,0.55)', 1.5);
        faceImg(ctx, def.face, x, y - 4 + bob, r - 2);
        circle(ctx, x, y - 4 + bob, r - 2, null, 'rgba(0,0,0,0.45)', 1.5);
        if (def.hooded) {
            // a deep hood: only the lower half of the face shows
            ctx.fillStyle = '#17121e';
            ctx.beginPath(); ctx.arc(x, y - 4 + bob, r + 1, Math.PI * 1.02, Math.PI * 1.98); ctx.lineTo(x + r - 2, y - 6 + bob); ctx.quadraticCurveTo(x, y - 12 + bob, x - r + 2, y - 6 + bob); ctx.closePath(); ctx.fill();
        }
        E.label(ctx, def.name, x, y - r - 12, { font: '700 11px Inter, sans-serif', fill: '#ffe7a3', stroke: 'rgba(0,0,0,0.75)' });
        if (mark) E.label(ctx, mark === 'new' ? '!' : '?', x, y - r - 28 + Math.sin(E.time * 4) * 2.5, { font: '900 20px Inter, sans-serif', fill: mark === 'busy' ? '#b4bccd' : '#ffc83d', stroke: 'rgba(0,0,0,0.75)' });
    };
    // A god's statue on its pedestal: grey stone carved with the god's face, glowing in its colour the higher it is raised
    A.drawStatue = function (ctx, st, god, level) {
        const x = st.x, y = st.y;
        if (level > 0) {
            const R = 44 + level * 3, a = 0.05 + 0.035 * level + Math.sin(E.time * 2 + x) * 0.02;
            const grad = ctx.createRadialGradient(x, y - 36, 4, x, y - 36, R);
            grad.addColorStop(0, rgba(god.color, a)); grad.addColorStop(1, rgba(god.color, 0));
            ctx.fillStyle = grad; ctx.beginPath(); ctx.arc(x, y - 36, R, 0, TAU); ctx.fill();
        }
        shadow(ctx, x, y + 6, 20);
        ctx.fillStyle = '#3a3546'; ctx.fillRect(x - 22, y - 10, 44, 6);
        ctx.fillStyle = '#2a2633'; ctx.fillRect(x - 20, y - 4, 40, 18);
        if (level > 0) E.label(ctx, level, x, y + 9, { font: '800 10px Inter, sans-serif', fill: god.color });
        // robe and folded arms
        ctx.fillStyle = '#57525f';
        ctx.beginPath(); ctx.moveTo(x - 15, y - 10); ctx.lineTo(x - 9, y - 46); ctx.lineTo(x + 9, y - 46); ctx.lineTo(x + 15, y - 10); ctx.closePath(); ctx.fill();
        ctx.fillStyle = 'rgba(0,0,0,0.22)'; for (const dx of [-6, 0, 6]) ctx.fillRect(x + dx - 1, y - 40, 2, 28);
        ctx.fillStyle = '#625d6b'; ctx.fillRect(x - 12, y - 36, 24, 7);
        // the face, in stone
        faceImg(ctx, god.face, x, y - 56, 11, 1, true);
        circle(ctx, x, y - 56, 11, null, '#3a3546', 2);
        if (level > 0) { ctx.fillStyle = god.color; ctx.globalAlpha = 0.6 + Math.sin(E.time * 3) * 0.3; ctx.fillRect(x - 5, y - 58, 3, 2); ctx.fillRect(x + 2, y - 58, 3, 2); ctx.globalAlpha = 1; }
    };
    A.drawPillar = function (ctx, p) {
        const x = p.x, y = p.y;
        shadow(ctx, x, y + 6, 14);
        ctx.fillStyle = '#2f2b38'; ctx.fillRect(x - 12, y - 6, 24, 16);
        ctx.fillStyle = '#3c3747'; ctx.fillRect(x - 9, y - 74, 18, 70);
        ctx.fillStyle = 'rgba(255,255,255,0.06)'; ctx.fillRect(x - 9, y - 74, 5, 70);
        ctx.fillStyle = 'rgba(0,0,0,0.3)'; ctx.fillRect(x + 4, y - 74, 5, 70);
        ctx.fillStyle = '#2f2b38'; ctx.fillRect(x - 13, y - 82, 26, 10);
    };
    A.drawBrazier = function (ctx, b) {
        const x = b.x, y = b.y;
        shadow(ctx, x, y + 4, 12);
        ctx.fillStyle = '#1d1a22'; ctx.fillRect(x - 3, y - 14, 6, 20);
        ctx.fillStyle = '#2d2834'; ctx.beginPath(); ctx.moveTo(x - 14, y - 22); ctx.lineTo(x + 14, y - 22); ctx.lineTo(x + 8, y - 12); ctx.lineTo(x - 8, y - 12); ctx.closePath(); ctx.fill();
        const cols = b.cold ? ['rgba(90,50,220,0.85)', 'rgba(61,200,255,0.85)', 'rgba(210,255,240,0.9)'] : ['rgba(255,80,30,0.85)', 'rgba(255,165,60,0.85)', 'rgba(255,240,170,0.9)'];
        for (let i = 0; i < 3; i++) {
            const f = Math.sin(E.time * (9 + i * 3) + x + i) * 0.5 + 0.5;
            ctx.fillStyle = cols[i];
            ctx.beginPath(); ctx.ellipse(x + (i - 1) * 2, y - 27 - f * 4 - i * 2, 8 - i * 2.5, 11 - i * 3 + f * 3, 0, 0, TAU); ctx.fill();
        }
    };

    // The hidden room's altar: a black stone table with what it offers floating over it (nothing, once it is taken)
    A.drawAltar = function (ctx, al, offer, taken) {
        const x = al.x, y = al.y;
        shadow(ctx, x, y + 6, 18);
        ctx.fillStyle = '#231e2b'; ctx.fillRect(x - 21, y - 14, 42, 6);
        ctx.fillStyle = '#15121b'; ctx.fillRect(x - 18, y - 8, 36, 20);
        ctx.strokeStyle = 'rgba(61,255,180,0.45)'; ctx.lineWidth = 1; ctx.strokeRect(x - 17.5, y - 7.5, 35, 19);
        if (taken || !offer) return;
        const f = Math.sin(E.time * 2.2) * 3, gy = y - 34 + f;
        const grad = ctx.createRadialGradient(x, gy, 2, x, gy, 30);
        grad.addColorStop(0, 'rgba(61,255,180,0.45)'); grad.addColorStop(1, 'rgba(61,255,180,0)');
        ctx.fillStyle = grad; ctx.beginPath(); ctx.arc(x, gy, 30, 0, TAU); ctx.fill();
        E.label(ctx, offer.icon, x, gy + 8, { font: '24px serif', fill: '#fff' });
    };

    A.drawRival = function (ctx, r) {
        shadow(ctx, r.x, r.y, r.r);
        if (r.ai.iframes > 0) ctx.globalAlpha = 0.5;
        circle(ctx, r.x, r.y, r.r + 2, r.color, 'rgba(0,0,0,0.6)', 1.5);
        faceImg(ctx, r.face, r.x, r.y - 1, r.r - 1);
        if (r.flash > 0) circle(ctx, r.x, r.y, r.r + 2, 'rgba(255,255,255,0.5)');
        ctx.globalAlpha = 1;
        A.drawWeapon(ctx, r.x, r.y, r.weapon, r.cls, r.tier, { rival: true });
        E.label(ctx, r.name, r.x, r.y - r.r - 16, { font: '700 11px Inter, sans-serif', fill: r.color, stroke: 'rgba(0,0,0,0.7)' });
        const w = 40, x = r.x - w / 2, y = r.y - r.r - 12;
        ctx.fillStyle = 'rgba(0,0,0,0.6)'; ctx.fillRect(x - 1, y - 1, w + 2, 5);
        ctx.fillStyle = '#ff9a3d'; ctx.fillRect(x, y, w * Math.max(0, r.hp / r.maxHp), 3);
    };
    A.drawMonster = function (ctx, m) {
        const d = m.def, x = m.x, y = m.y, r = m.r;
        shadow(ctx, x, y, r);
        const col = m.flash > 0 ? '#ffffff' : d.color;
        const dark = E.shadeHex(d.color, 0.6);
        const fx = Math.cos(m.facing), fy = Math.sin(m.facing);
        const eyes = (ex = 0.45, size = 2.6, colr = '#111') => {
            const px = -fy, py = fx;
            circle(ctx, x + fx * r * ex + px * r * 0.3, y + fy * r * ex + py * r * 0.3 - 2, size, colr);
            circle(ctx, x + fx * r * ex - px * r * 0.3, y + fy * r * ex - py * r * 0.3 - 2, size, colr);
        };
        if (m.elite) { ctx.strokeStyle = 'rgba(255,200,61,0.7)'; ctx.lineWidth = 3; ctx.beginPath(); ctx.arc(x, y, r + 5 + Math.sin(E.time * 4) * 1.5, 0, TAU); ctx.stroke(); }
        switch (m.type) {
            case 'slime': {
                const sq = m.hopLeft > 0 ? 0.85 : 1 + Math.sin(E.time * 6 + m.hopT) * 0.05;
                ctx.fillStyle = col; ctx.globalAlpha = 0.9;
                ctx.beginPath(); ctx.ellipse(x, y + r * (1 - sq) * 0.5, r * (2 - sq), r * sq, 0, 0, TAU); ctx.fill(); ctx.globalAlpha = 1;
                circle(ctx, x - r * 0.35, y - r * 0.35, r * 0.25, 'rgba(255,255,255,0.4)');
                eyes(0.2, 2.4); break;
            }
            case 'bat': {
                const flap = Math.sin(E.time * 18 + m.hopT * 9) * 0.6;
                ctx.fillStyle = dark;
                for (const s of [-1, 1]) { ctx.beginPath(); ctx.moveTo(x, y); ctx.lineTo(x + s * r * 2, y - r * (0.6 + flap)); ctx.lineTo(x + s * r * 1.4, y + r * 0.4); ctx.closePath(); ctx.fill(); }
                circle(ctx, x, y, r * 0.8, col); eyes(0.3, 2, '#ff4d4d'); break;
            }
            case 'golem': case 'crystal_golem': case 'ember_brute': case 'frost_giant': case 'yeti': {
                ctx.fillStyle = col;
                ctx.beginPath(); ctx.roundRect ? ctx.roundRect(x - r, y - r, r * 2, r * 2, r * 0.45) : ctx.rect(x - r, y - r, r * 2, r * 2); ctx.fill();
                ctx.fillStyle = dark; ctx.fillRect(x - r * 0.7, y + r * 0.2, r * 1.4, r * 0.25);
                if (m.type === 'crystal_golem' || m.type === 'frost_giant') { ctx.fillStyle = 'rgba(255,255,255,0.55)'; ctx.beginPath(); ctx.moveTo(x - r * 0.4, y - r); ctx.lineTo(x - r * 0.2, y - r * 1.5); ctx.lineTo(x, y - r); ctx.fill(); ctx.beginPath(); ctx.moveTo(x + r * 0.1, y - r); ctx.lineTo(x + r * 0.35, y - r * 1.4); ctx.lineTo(x + r * 0.55, y - r); ctx.fill(); }
                if (m.type === 'ember_brute') { ctx.fillStyle = '#ffd24d'; ctx.fillRect(x - r * 0.5, y - r * 0.1, r, 3); }
                eyes(0.35, 3, m.type === 'ember_brute' ? '#ffd24d' : '#ffe14d'); break;
            }
            case 'boar': case 'wolf': case 'hound': {
                ctx.save(); ctx.translate(x, y); ctx.rotate(m.facing);
                ctx.fillStyle = col; ctx.beginPath(); ctx.ellipse(0, 0, r * 1.25, r * 0.85, 0, 0, TAU); ctx.fill();
                ctx.fillStyle = dark; ctx.beginPath(); ctx.ellipse(r * 1.05, 0, r * 0.5, r * 0.45, 0, 0, TAU); ctx.fill();
                if (m.type === 'boar') { ctx.strokeStyle = '#f5ecd5'; ctx.lineWidth = 2.5; ctx.beginPath(); ctx.moveTo(r * 1.3, -r * 0.3); ctx.lineTo(r * 1.7, -r * 0.55); ctx.moveTo(r * 1.3, r * 0.3); ctx.lineTo(r * 1.7, r * 0.55); ctx.stroke(); }
                else { ctx.fillStyle = dark; ctx.beginPath(); ctx.moveTo(r * 0.7, -r * 0.5); ctx.lineTo(r * 0.9, -r * 1.0); ctx.lineTo(r * 1.1, -r * 0.45); ctx.fill(); ctx.beginPath(); ctx.moveTo(r * 0.7, r * 0.5); ctx.lineTo(r * 0.9, r * 1.0); ctx.lineTo(r * 1.1, r * 0.45); ctx.fill(); }
                circle(ctx, r * 1.15, -r * 0.2, 2, m.type === 'boar' ? '#111' : '#7fe3ff'); circle(ctx, r * 1.15, r * 0.2, 2, m.type === 'boar' ? '#111' : '#7fe3ff');
                ctx.restore(); break;
            }
            case 'sprite': case 'imp': {
                const bob = Math.sin(E.time * 5 + m.hopT * 7) * 3;
                circle(ctx, x, y + bob, r, col);
                ctx.fillStyle = dark;
                if (m.type === 'imp') { ctx.beginPath(); ctx.moveTo(x - r * 0.6, y - r * 0.6 + bob); ctx.lineTo(x - r * 0.5, y - r * 1.4 + bob); ctx.lineTo(x - r * 0.2, y - r * 0.8 + bob); ctx.fill(); ctx.beginPath(); ctx.moveTo(x + r * 0.6, y - r * 0.6 + bob); ctx.lineTo(x + r * 0.5, y - r * 1.4 + bob); ctx.lineTo(x + r * 0.2, y - r * 0.8 + bob); ctx.fill(); }
                else { for (let i = 0; i < 5; i++) { const a = i / 5 * TAU + E.time; ctx.beginPath(); ctx.moveTo(x + Math.cos(a) * r, y + Math.sin(a) * r + bob); ctx.lineTo(x + Math.cos(a) * r * 1.5, y + Math.sin(a) * r * 1.5 + bob); ctx.lineWidth = 2; ctx.strokeStyle = dark; ctx.stroke(); } }
                eyes(0.2, 2, m.type === 'imp' ? '#ffe14d' : '#14310a'); break;
            }
            case 'skeleton': {
                circle(ctx, x, y, r, col, '#9b937f', 2);
                ctx.fillStyle = '#2a2622'; circle(ctx, x - 4, y - 3, 3, '#2a2622'); circle(ctx, x + 4, y - 3, 3, '#2a2622');
                ctx.fillRect(x - 4, y + 4, 8, 2);
                ctx.save(); ctx.translate(x, y); ctx.rotate(m.facing); ctx.strokeStyle = '#6b4423'; ctx.lineWidth = 3; ctx.beginPath(); ctx.moveTo(r * 0.6, 0); ctx.lineTo(r * 1.9, 0); ctx.stroke(); ctx.strokeStyle = '#9aa0a8'; ctx.lineWidth = 4; ctx.beginPath(); ctx.moveTo(r * 1.8, -8); ctx.quadraticCurveTo(r * 2.2, 0, r * 1.8, 8); ctx.stroke(); ctx.restore();
                break;
            }
            case 'crab': {
                ctx.save(); ctx.translate(x, y); ctx.rotate(m.facing);
                ctx.fillStyle = dark; ctx.beginPath(); ctx.arc(0, 0, r, 0, TAU); ctx.fill();
                ctx.fillStyle = col; ctx.beginPath(); ctx.arc(-r * 0.15, 0, r * 1.05, Math.PI * 0.5, Math.PI * 1.5); ctx.fill();
                ctx.fillStyle = '#ffb347'; ctx.beginPath(); ctx.arc(-r * 0.4, 0, r * 0.3, 0, TAU); ctx.fill();
                ctx.strokeStyle = col; ctx.lineWidth = 4; ctx.beginPath(); ctx.arc(r * 1.1, -r * 0.6, 6, 0, Math.PI * 1.6); ctx.stroke(); ctx.beginPath(); ctx.arc(r * 1.1, r * 0.6, 6, Math.PI * 0.4, TAU); ctx.stroke();
                ctx.restore(); break;
            }
            case 'wraith': {
                const bob = Math.sin(E.time * 3 + m.hopT * 5) * 3;
                ctx.globalAlpha = 0.75; ctx.fillStyle = col;
                ctx.beginPath(); ctx.arc(x, y - 4 + bob, r, Math.PI, 0); ctx.lineTo(x + r, y + r + bob); for (let i = 0; i < 4; i++) ctx.lineTo(x + r - (i + 0.5) * r / 2, y + r * (i % 2 ? 1 : 0.6) + bob); ctx.lineTo(x - r, y + r + bob); ctx.closePath(); ctx.fill();
                ctx.globalAlpha = 1; eyes(0.1, 2.6, '#2b1a5c'); break;
            }
            case 'dummy': {
                ctx.strokeStyle = '#6b4423'; ctx.lineWidth = 5; ctx.beginPath(); ctx.moveTo(x, y + r); ctx.lineTo(x, y - r); ctx.moveTo(x - r, y - r * 0.2); ctx.lineTo(x + r, y - r * 0.2); ctx.stroke();
                circle(ctx, x, y - r * 0.6, r * 0.6, m.flash > 0 ? '#fff' : '#d9b98a', '#6b4423', 2);
                circle(ctx, x, y - r * 0.6, r * 0.3, null, '#b0413e', 2);
                break;
            }
            default:
                circle(ctx, x, y, r, col); eyes();
        }
        if (m.status.burnUntil > E.time) circle(ctx, x, y, r + 2, null, 'rgba(255,140,40,0.6)', 2);
        if (m.status.chillUntil > E.time) circle(ctx, x, y, r + 2, 'rgba(160,220,255,0.25)');
        if (m.status.stunUntil > E.time) { ctx.fillStyle = '#ffe14d'; for (let i = 0; i < 3; i++) { const a = E.time * 5 + i * TAU / 3; ctx.fillRect(x + Math.cos(a) * r * 0.8 - 2, y - r - 6 + Math.sin(a) * 3, 4, 4); } }
        hpBar(ctx, m);
        if (m.elite) E.label(ctx, d.name, x, y - r - 18, { font: '700 11px Inter, sans-serif', fill: '#ffe7a3', stroke: 'rgba(0,0,0,0.7)' });
        if (m.kind === 'dummy' && m.dmgLog.length) {
            const recent = m.dmgLog.filter(e => E.time - e.at < 3);
            m.dmgLog = recent;
            const dps = recent.reduce((a, e) => a + e.dmg, 0) / 3;
            ctx.font = '700 11px Inter, sans-serif'; ctx.textAlign = 'center'; ctx.fillStyle = '#ffe7a3';
            ctx.fillText(Math.round(dps) + ' dmg/s', x, y - r - 14);
        }
    };
    A.drawBoss = function (ctx, b) {
        const x = b.x, y = b.y, r = b.r;
        shadow(ctx, x, y, r);
        if (b.exposedUntil > E.time) { circle(ctx, x, y, r + 10 + Math.sin(E.time * 10) * 3, 'rgba(255,225,77,0.25)'); }
        if (b.def.aura) { circle(ctx, x, y, b.def.aura.radius, 'rgba(160,220,255,0.08)', 'rgba(160,220,255,0.25)', 1); }
        circle(ctx, x, y, r + 4, b.flash > 0 ? '#fff' : b.def.color, 'rgba(0,0,0,0.6)', 3);
        faceImg(ctx, b.face, x, y, r - 2, b.kind === 'clone' ? 0.75 : 1);
        if (b.kind === 'boss') {
            // a crown marks the real one
            ctx.fillStyle = '#ffc83d';
            ctx.beginPath(); ctx.moveTo(x - 16, y - r - 2); ctx.lineTo(x - 16, y - r - 14); ctx.lineTo(x - 8, y - r - 7); ctx.lineTo(x, y - r - 17); ctx.lineTo(x + 8, y - r - 7); ctx.lineTo(x + 16, y - r - 14); ctx.lineTo(x + 16, y - r - 2); ctx.closePath(); ctx.fill();
        }
        if (b.armorBrokenUntil > E.time) circle(ctx, x, y, r + 7, null, 'rgba(255,140,40,0.7)', 2);
        if (b.status.stunUntil > E.time) { ctx.fillStyle = '#ffe14d'; ctx.font = '800 14px Inter'; ctx.textAlign = 'center'; ctx.fillText('STUNNED', x, y - r - 22); }
        if (b.kind === 'clone') hpBar(ctx, Object.assign({}, b, { kind: 'monster' }), 50);
    };
    // Telegraphs: where an attack will land, filling up as it winds up
    A.drawTelegraphs = function (ctx) {
        const g = game();
        ctx.save();
        for (const a of g.actors) {
            const k = a.atk;
            if (a.dead || !k || !k.a) continue;
            const at = k.a;
            const f = k.phase === 'windup' ? Math.min(1, k.t / at.windup) : 1;
            ctx.fillStyle = `rgba(255,60,70,${0.12 + 0.2 * f})`;
            ctx.strokeStyle = 'rgba(255,90,100,0.7)'; ctx.lineWidth = 1.5;
            if (k.phase === 'windup' && (at.type === 'lunge' || at.type === 'charge')) {
                const len = at.type === 'charge' ? at.speed * at.active : at.speed * at.active;
                ctx.save(); ctx.translate(a.x, a.y); ctx.rotate(k.dir);
                ctx.fillRect(0, -a.r, len * f, a.r * 2); ctx.strokeRect(0, -a.r, len, a.r * 2);
                ctx.restore();
            } else if ((at.type === 'slam' || at.type === 'nova') && k.phase === 'windup') {
                ctx.beginPath(); ctx.arc(a.x, a.y, at.radius * f, 0, TAU); ctx.fill();
                ctx.beginPath(); ctx.arc(a.x, a.y, at.radius, 0, TAU); ctx.stroke();
            } else if ((at.type === 'arc' || at.type === 'cone') && (k.phase === 'windup' || at.type === 'cone')) {
                const reach = at.reach;
                ctx.beginPath(); ctx.moveTo(a.x, a.y); ctx.arc(a.x, a.y, k.phase === 'windup' ? reach * f : reach, k.dir - at.arc / 2, k.dir + at.arc / 2); ctx.closePath();
                if (k.phase === 'active') ctx.fillStyle = 'rgba(255,140,40,0.28)';
                ctx.fill();
                ctx.beginPath(); ctx.moveTo(a.x, a.y); ctx.arc(a.x, a.y, reach, k.dir - at.arc / 2, k.dir + at.arc / 2); ctx.closePath(); ctx.stroke();
            } else if (at.type === 'sweep') {
                if (k.phase === 'windup') {
                    ctx.beginPath(); ctx.moveTo(a.x, a.y); ctx.arc(a.x, a.y, at.reach, angTo(a, g.player) - at.arc / 2, angTo(a, g.player) + at.arc / 2); ctx.closePath();
                    ctx.globalAlpha = 0.5 * f; ctx.fill(); ctx.globalAlpha = 1;
                } else if (k.cur !== undefined) {
                    ctx.strokeStyle = '#7fd36b'; ctx.lineWidth = 10; ctx.lineCap = 'round';
                    ctx.beginPath(); ctx.moveTo(a.x + Math.cos(k.cur) * a.r, a.y + Math.sin(k.cur) * a.r); ctx.lineTo(a.x + Math.cos(k.cur) * at.reach, a.y + Math.sin(k.cur) * at.reach); ctx.stroke();
                }
            } else if (k.phase === 'windup' && (at.type === 'shoot' || at.type === 'ring' || at.type === 'summon' || at.type === 'clone' || at.type === 'wave' || at.type === 'targets' || at.type === 'spikes')) {
                circle(ctx, a.x, a.y, a.r + 6 + 6 * f, null, `rgba(255,200,80,${0.3 + 0.5 * f})`, 3);
            }
        }
        for (const h of g.hazards) {
            if (h.kind === 'circle') {
                if (!h.done) {
                    const f = Math.min(1, h.t / h.windup);
                    ctx.fillStyle = h.ice ? `rgba(140,220,255,${0.15 + 0.25 * f})` : `rgba(255,60,70,${0.12 + 0.25 * f})`;
                    ctx.beginPath(); ctx.arc(h.x, h.y, h.r * f, 0, TAU); ctx.fill();
                    ctx.strokeStyle = h.ice ? 'rgba(180,240,255,0.8)' : 'rgba(255,90,100,0.8)'; ctx.lineWidth = 1.5;
                    ctx.beginPath(); ctx.arc(h.x, h.y, h.r, 0, TAU); ctx.stroke();
                } else if (h.lingering) {
                    ctx.fillStyle = `rgba(255,110,30,${0.35 + Math.sin(E.time * 8) * 0.08})`;
                    ctx.beginPath(); ctx.arc(h.x, h.y, h.r * 0.8, 0, TAU); ctx.fill();
                } else {
                    ctx.fillStyle = h.ice ? 'rgba(220,250,255,0.7)' : 'rgba(255,230,200,0.5)';
                    ctx.beginPath(); ctx.arc(h.x, h.y, h.r, 0, TAU); ctx.fill();
                }
            } else if (h.kind === 'wave') {
                ctx.strokeStyle = 'rgba(120,200,90,0.85)'; ctx.lineWidth = h.width;
                ctx.beginPath(); ctx.arc(h.x, h.y, h.r, 0, TAU); ctx.stroke();
            }
        }
        ctx.restore();
    };
    A.drawProjectiles = function (ctx) {
        for (const pr of game().projectiles) {
            if (pr.kind === 'knife') {
                const a = Math.atan2(pr.vy, pr.vx) + E.time * 30;
                ctx.save(); ctx.translate(pr.x, pr.y); ctx.rotate(a);
                ctx.fillStyle = '#d9dde6'; ctx.beginPath(); ctx.moveTo(8, 0); ctx.lineTo(-4, -3); ctx.lineTo(-4, 3); ctx.fill();
                ctx.fillStyle = '#6b4423'; ctx.fillRect(-8, -1.5, 4, 3);
                ctx.restore();
            } else if (pr.kind === 'javelin') {
                const a = Math.atan2(pr.vy, pr.vx);
                ctx.save(); ctx.translate(pr.x, pr.y); ctx.rotate(a);
                ctx.strokeStyle = '#a8763e'; ctx.lineWidth = 3;
                ctx.beginPath(); ctx.moveTo(-26, 0); ctx.lineTo(4, 0); ctx.stroke();
                ctx.fillStyle = '#dfe6ee'; ctx.beginPath(); ctx.moveTo(12, 0); ctx.lineTo(2, -4); ctx.lineTo(2, 4); ctx.fill();
                ctx.restore();
            } else if (pr.kind === 'net') {
                ctx.save(); ctx.translate(pr.x, pr.y); ctx.rotate(E.time * 6);
                ctx.strokeStyle = '#e9e2c8'; ctx.lineWidth = 1.5;
                for (let i = 0; i < 4; i++) { ctx.beginPath(); ctx.moveTo(-9, 0); ctx.lineTo(9, 0); ctx.stroke(); ctx.rotate(Math.PI / 4); }
                ctx.beginPath(); ctx.arc(0, 0, 6, 0, TAU); ctx.stroke();
                ctx.restore();
            } else if (pr.kind === 'bolt') {
                const a = Math.atan2(pr.vy, pr.vx), col = pr.color || '#ff7b3a', r = pr.r;
                ctx.save(); ctx.translate(pr.x, pr.y); ctx.rotate(a);
                if (pr.look === 'shard') {
                    // an ice lance: a long pale crystal
                    ctx.globalAlpha = 0.3; ctx.fillStyle = col; ctx.beginPath(); ctx.arc(0, 0, r * 1.6, 0, TAU); ctx.fill();
                    ctx.globalAlpha = 1; ctx.beginPath(); ctx.moveTo(r * 2.4, 0); ctx.lineTo(0, -r * 0.75); ctx.lineTo(-r * 1.8, 0); ctx.lineTo(0, r * 0.75); ctx.closePath(); ctx.fill();
                    ctx.fillStyle = '#ffffff'; ctx.beginPath(); ctx.moveTo(r * 2, 0); ctx.lineTo(0, -r * 0.25); ctx.lineTo(-r, 0); ctx.closePath(); ctx.fill();
                } else if (pr.look === 'spark') {
                    // a ball of lightning: a white core with arcs flickering off it
                    ctx.globalAlpha = 0.35; ctx.fillStyle = col; ctx.beginPath(); ctx.arc(0, 0, r * 1.9, 0, TAU); ctx.fill();
                    ctx.globalAlpha = 1; ctx.strokeStyle = col; ctx.lineWidth = 1.5; ctx.beginPath();
                    for (let i = 0; i < 4; i++) { const aa = Math.random() * TAU; ctx.moveTo(0, 0); ctx.lineTo(Math.cos(aa) * r * 1.4 + (Math.random() - 0.5) * 4, Math.sin(aa) * r * 1.4); ctx.lineTo(Math.cos(aa + 0.4) * r * 2.4, Math.sin(aa + 0.4) * r * 2.4); }
                    ctx.stroke();
                    ctx.fillStyle = '#fffbe0'; ctx.beginPath(); ctx.arc(0, 0, r * 0.8, 0, TAU); ctx.fill();
                } else {
                    // a fireball: a hot core in a glow, with a short tail
                    ctx.globalAlpha = 0.35; ctx.fillStyle = col;
                    ctx.beginPath(); ctx.moveTo(-r * 3.2, 0); ctx.lineTo(0, -r); ctx.lineTo(0, r); ctx.closePath(); ctx.fill();
                    ctx.beginPath(); ctx.arc(0, 0, r * 1.7, 0, TAU); ctx.fill();
                    ctx.globalAlpha = 1; ctx.beginPath(); ctx.arc(0, 0, r, 0, TAU); ctx.fill();
                    ctx.fillStyle = '#fff3c4'; ctx.beginPath(); ctx.arc(r * 0.2, 0, r * 0.5, 0, TAU); ctx.fill();
                }
                ctx.restore();
                if (E.perf !== 'low' && pr.team !== 'fx' && Math.random() < 0.5) E.burst(pr.x, pr.y, col, 1, 25, { life: 0.3, size: 3 });
            } else if (pr.kind === 'wave') {
                // a flame wave: a thick arc that thins out as it spreads
                const k = Math.max(0, Math.min(1, pr.life / 0.25)), col = pr.color || '#ff7b3a';
                ctx.save(); ctx.lineCap = 'round';
                ctx.globalAlpha = 0.35 * k; ctx.strokeStyle = col; ctx.lineWidth = pr.band;
                ctx.beginPath(); ctx.arc(pr.ox, pr.oy, pr.rad, pr.dir - pr.arc / 2, pr.dir + pr.arc / 2); ctx.stroke();
                if (pr.look === 'jagged') {
                    // a thunderclap crackles along its front
                    ctx.globalAlpha = k; ctx.strokeStyle = '#fffbe0'; ctx.lineWidth = 1.5; ctx.beginPath();
                    const n = Math.max(6, Math.round(pr.arc * pr.rad / 14));
                    for (let i = 0; i <= n; i++) { const aa = pr.dir - pr.arc / 2 + pr.arc * i / n, rr = pr.rad + pr.band * 0.3 + (Math.random() - 0.5) * pr.band * 0.6; const x = pr.ox + Math.cos(aa) * rr, y = pr.oy + Math.sin(aa) * rr; if (i) ctx.lineTo(x, y); else ctx.moveTo(x, y); }
                    ctx.stroke();
                }
                ctx.globalAlpha = 0.9 * k; ctx.strokeStyle = '#ffd36b'; ctx.lineWidth = Math.max(2, pr.band * 0.25);
                ctx.beginPath(); ctx.arc(pr.ox, pr.oy, pr.rad + pr.band * 0.2, pr.dir - pr.arc / 2, pr.dir + pr.arc / 2); ctx.stroke();
                ctx.restore();
            } else if (pr.kind === 'arrow') {
                const a = Math.atan2(pr.vy, pr.vx);
                ctx.save(); ctx.translate(pr.x, pr.y); ctx.rotate(a);
                if (pr.big) { ctx.shadowColor = pr.color; ctx.shadowBlur = 12; ctx.scale(1.6, 1.6); }
                ctx.strokeStyle = pr.team === 'player' ? (pr.ability ? pr.color : '#e9e2c8') : '#3dff9a'; ctx.lineWidth = 2;
                ctx.beginPath(); ctx.moveTo(-14, 0); ctx.lineTo(4, 0); ctx.stroke();
                ctx.fillStyle = '#cfd6e0'; ctx.beginPath(); ctx.moveTo(8, 0); ctx.lineTo(2, -3); ctx.lineTo(2, 3); ctx.fill();
                ctx.restore();
            } else {
                circle(ctx, pr.x, pr.y, pr.r + 3, pr.burn ? 'rgba(255,140,40,0.35)' : pr.chill ? 'rgba(160,220,255,0.35)' : 'rgba(255,255,255,0.15)');
                circle(ctx, pr.x, pr.y, pr.r, pr.burn ? '#ff9a3d' : pr.chill ? '#bfefff' : (pr.color || '#ff6b7a'));
            }
        }
    };
    // Nodes: trees, rocks and ores, bushes. The glowing crack shows where a hit counts double.
    // Every node of a type looks the same (scattered crystals come in four variations), so each look is drawn once into
    // a small picture at the current sharpness and stamped: there are a lot of trees and rocks on screen at once
    const nodeCache = new Map();
    function nodeSprite(ctx, n, alive) {
        if (n.variant === undefined) n.variant = (((Math.floor(n.x) * 73856093) ^ (Math.floor(n.y) * 19349663)) >>> 0) % 4;
        const t = ctx.getTransform(), scale = Math.hypot(t.a, t.b);
        const key = n.type + '|' + (alive ? n.variant : 'gone') + '|' + scale.toFixed(2);
        let sp = nodeCache.get(key);
        if (!sp) {
            if (nodeCache.size > 160) nodeCache.clear();
            const r = n.r, left = r * 1.6 + 10, top = r * 1.4 + 52, bottom = r * 1.3 + 12;
            const cv = document.createElement('canvas');
            cv.width = Math.ceil(left * 2 * scale); cv.height = Math.ceil((top + bottom) * scale);
            const c = cv.getContext('2d');
            c.setTransform(scale, 0, 0, scale, left * scale, top * scale);
            drawNodeBody(c, n, 0, 0, alive, n.variant);
            sp = { cv, left, top, w: left * 2, h: top + bottom };
            nodeCache.set(key, sp);
        }
        return sp;
    }
    A.drawNode = function (ctx, n, showCrack) {
        const d = n.def, x = n.x + (n.shake > 0 ? (Math.random() - 0.5) * 3 : 0), y = n.y, r = n.r, alive = A.nodeAlive(n);
        const sp = nodeSprite(ctx, n, alive);
        ctx.drawImage(sp.cv, x - sp.left, y - sp.top, sp.w, sp.h);
        if (!alive) return;
        if (n.type === 'sulfur' && E.perf !== 'low' && Math.random() < 0.02) E.burst(x, y - r, 'rgba(230,217,74,0.6)', 1, 20, { life: 1, grav: -30 });
        if (showCrack && d.tool !== 'hand') {
            const a = n.crack;
            ctx.strokeStyle = `rgba(255,225,77,${0.65 + Math.sin(E.time * 8) * 0.25})`; ctx.lineWidth = 3;
            const cy = d.tool === 'axe' ? y : y - 2;
            ctx.beginPath(); ctx.arc(x, cy, r + 2, a - 0.32, a + 0.32); ctx.stroke();
        }
        if (n.work > 0) {
            const w = 28;
            ctx.fillStyle = 'rgba(0,0,0,0.6)'; ctx.fillRect(x - w / 2 - 1, y + r + 4, w + 2, 5);
            ctx.fillStyle = '#ffe14d'; ctx.fillRect(x - w / 2, y + r + 5, w * Math.min(1, n.work / d.work), 3);
        }
    };
    // A node's look at (x, y): a stump or hollow once harvested. v: which variation of scattered crystals.
    function drawNodeBody(ctx, n, x, y, alive, v) {
        const d = n.def, r = n.r;
        if (!alive) {
            if (d.tool === 'axe') { circle(ctx, x, y + 4, 7, d.trunk || '#6b4423'); }
            else if (d.tool === 'pickaxe') { ctx.fillStyle = 'rgba(0,0,0,0.25)'; ctx.beginPath(); ctx.ellipse(x, y + 6, r * 0.8, r * 0.35, 0, 0, TAU); ctx.fill(); }
            return;
        }
        if (d.tool === 'axe') {
            shadow(ctx, x, y + 6, r);
            ctx.fillStyle = d.trunk || '#6b4423'; ctx.fillRect(x - 4, y - 2, 8, 14);
            if (n.type === 'tree_frost') {
                ctx.fillStyle = d.color;
                for (let i = 0; i < 3; i++) { const w = r * (1.3 - i * 0.3), yy = y - 4 - i * 11; ctx.beginPath(); ctx.moveTo(x - w, yy); ctx.lineTo(x, yy - 18); ctx.lineTo(x + w, yy); ctx.closePath(); ctx.fill(); }
                ctx.fillStyle = 'rgba(255,255,255,0.8)'; ctx.beginPath(); ctx.moveTo(x - 6, y - 33); ctx.lineTo(x, y - 40); ctx.lineTo(x + 6, y - 33); ctx.fill();
            } else {
                circle(ctx, x, y - 12, r * 1.15, d.color);
                circle(ctx, x - r * 0.5, y - 8, r * 0.75, E.shadeHex(d.color, 0.85));
                circle(ctx, x + r * 0.45, y - 16, r * 0.6, E.shadeHex(d.color, 1.18));
                if (n.type === 'tree_ash') { circle(ctx, x + 3, y - 14, 2.5, '#ff8a3d'); circle(ctx, x - 6, y - 6, 2, '#ff8a3d'); }
            }
        } else if (d.tool === 'pickaxe') {
            shadow(ctx, x, y + 2, r);
            const rock = n.type === 'ruby_vein' || n.type === 'gold' || n.type === 'copper' || n.type === 'iron' || n.type === 'silver' || n.type === 'mithril' || n.type === 'ember' ? '#7c7f87' : n.type === 'obsidian' ? '#3a3046' : n.type === 'frost_crystal' ? '#9fb7c6' : d.color;
            ctx.fillStyle = rock;
            ctx.beginPath(); ctx.moveTo(x - r, y + r * 0.5); ctx.lineTo(x - r * 0.8, y - r * 0.4); ctx.lineTo(x - r * 0.1, y - r * 0.9); ctx.lineTo(x + r * 0.8, y - r * 0.5); ctx.lineTo(x + r, y + r * 0.5); ctx.closePath(); ctx.fill();
            ctx.fillStyle = 'rgba(255,255,255,0.12)'; ctx.beginPath(); ctx.moveTo(x - r * 0.8, y - r * 0.4); ctx.lineTo(x - r * 0.1, y - r * 0.9); ctx.lineTo(x + r * 0.1, y - r * 0.2); ctx.closePath(); ctx.fill();
            if (rock !== d.color) {
                ctx.fillStyle = d.color;
                const crystals = n.type === 'ruby_vein' || n.type === 'frost_crystal' || n.type === 'ember';
                for (let i = 0; i < 4; i++) {
                    const ox = Math.cos(i * 1.7 + v * 1.9) * r * 0.5, oy = Math.sin(i * 2.3 + v * 2.7) * r * 0.3 - 2;
                    if (crystals) { ctx.beginPath(); ctx.moveTo(x + ox - 3, y + oy + 3); ctx.lineTo(x + ox, y + oy - 7); ctx.lineTo(x + ox + 3, y + oy + 3); ctx.fill(); }
                    else ctx.fillRect(x + ox - 2.5, y + oy - 2.5, 5, 5);
                }
                if (n.type === 'ruby_vein' || n.type === 'ember' || n.type === 'frost_crystal') circle(ctx, x, y - 2, r + 4, n.type === 'frost_crystal' ? 'rgba(140,230,255,0.12)' : 'rgba(255,60,80,0.12)');
            }
        } else {
            // bushes and herbs
            if (n.type === 'herb') {
                ctx.strokeStyle = '#2f7d3a'; ctx.lineWidth = 2;
                for (let i = -1; i <= 1; i++) { ctx.beginPath(); ctx.moveTo(x, y + 6); ctx.quadraticCurveTo(x + i * 6, y - 2, x + i * 9, y - 6); ctx.stroke(); }
                circle(ctx, x - 6, y - 5, 3, d.color); circle(ctx, x + 6, y - 6, 3, d.color); circle(ctx, x, y - 9, 3, '#ff6b8a');
            } else {
                circle(ctx, x, y, r, d.color); circle(ctx, x - 5, y - 3, r * 0.6, E.shadeHex(d.color, 1.15)); circle(ctx, x + 5, y + 1, r * 0.55, E.shadeHex(d.color, 0.85));
                ctx.strokeStyle = '#e8e1a8'; ctx.lineWidth = 1; for (let i = 0; i < 3; i++) { ctx.beginPath(); ctx.moveTo(x - 4 + i * 4, y - 2); ctx.lineTo(x - 5 + i * 4, y - r - 4); ctx.stroke(); }
            }
        }
    }
    A.drawGrave = function (ctx, gr) {
        const bob = Math.sin(E.time * 3) * 2;
        shadow(ctx, gr.x, gr.y, 10);
        ctx.fillStyle = '#8d5a3b'; ctx.beginPath(); ctx.ellipse(gr.x, gr.y + bob, 11, 9, 0, 0, TAU); ctx.fill();
        ctx.fillStyle = '#c4935f'; ctx.fillRect(gr.x - 6, gr.y - 10 + bob, 12, 4);
        circle(ctx, gr.x, gr.y + bob, 16, null, 'rgba(255,225,77,0.6)', 2);
    };
})();
