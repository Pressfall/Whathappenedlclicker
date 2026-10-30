/**
 * The Wilds: weapon physics. Weapons follow the mouse with weight (a turn-speed and an acceleration limit), and a hit
 * only does damage when the blade is actually moving fast where it touches, so the player has to swing the mouse like
 * the weapon. Same rules for the player and the AI rivals. Pure: angles in radians, distances in world px, time in s.
 * See WEAPON_CLASSES in core/world-data.js for every constant.
 *
 * Works in a browser (<script src="core/world-combat.js"> sets window.WHWorldCombat, after world-data.js) and in Node.
 */
(function (root, factory) {
    if (typeof module === 'object' && module.exports) module.exports = factory(require('./world-data'));
    else root.WHWorldCombat = factory(root.WHWorldData);
}(typeof self !== 'undefined' ? self : this, function (D) {
    'use strict';

    const TAU = Math.PI * 2;
    const C = D.COMBAT;
    const clamp = (v, a, b) => (v < a ? a : v > b ? b : v);
    function wrap(a) { a = (a + Math.PI) % TAU; if (a < 0) a += TAU; return a - Math.PI; }

    // weapons with a reach (spear, staff): the tip moves in and out along the angle
    function hasReach(cls) { const P = D.WEAPON_CLASSES[cls]; return !!(P && P.reachMax); }
    function newWeapon(cls, theta = 0) {
        const r = (hasReach(cls) ? D.WEAPON_CLASSES[cls] : D.WEAPON_CLASSES.spear).reachMin;
        return {
            cls, theta, prevTheta: theta, omega: 0,
            swingId: 0, lastSign: 0,
            // spear and staff
            r, rPrev: r, vr: 0, armed: true,
            // staff: charge 0..1, the thrust or swing in progress (see world-actors.js staffHits)
            charge: 0, thrust: null, swing: null, shotAt: -9,
            // bow
            drawing: false, anchorX: 0, anchorY: 0, draw: 0, fullFor: 0,
            // assisted swings
            assistT: -1, assistDir: 1, assistFrom: 0,
            hitCd: new Map(), // target id -> time it may be hit again
        };
    }

    // One step of the weapon chasing the mouse. mods: { wMult, aMult, winded }
    function track(w, targetAngle, dt, P, mods = {}) {
        const wMax = P.wMax * (mods.wMult || 1) * (mods.winded ? C.stamina.windedMult : 1);
        const aMax = P.aMax * (mods.aMult || 1);
        const err = wrap(targetAngle - w.theta);
        const want = clamp(err * P.k, -wMax, wMax);
        w.omega += clamp(want - w.omega, -aMax * dt, aMax * dt);
        w.omega = clamp(w.omega, -wMax, wMax);
        w.prevTheta = w.theta;
        w.theta = wrap(w.theta + w.omega * dt);
        // a new swing starts whenever the blade changes direction (used by combos)
        const sign = Math.abs(w.omega) > 1.5 ? Math.sign(w.omega) : 0;
        if (sign && sign !== w.lastSign) { w.swingId++; w.lastSign = sign; }
        return w;
    }

    // Did the blade (radii r0..len around (px, py)) sweep through the circle (tx, ty, tr) going from a0 to a1?
    // Tests the whole swept sector, so a fast swing can't pass through a target between frames.
    function sweepHit(px, py, a0, a1, r0, len, tx, ty, tr) {
        const dx = tx - px, dy = ty - py;
        const d = Math.hypot(dx, dy);
        if (d - tr > len || d + tr < r0) return null;
        const phi = Math.atan2(dy, dx);
        const widen = d <= tr ? Math.PI : Math.asin(Math.min(1, tr / d));
        const sweep = wrap(a1 - a0);
        const rel = wrap(phi - a0);
        const hit = sweep >= 0 ? (rel >= -widen && rel <= sweep + widen) : (rel <= widen && rel >= sweep - widen);
        if (!hit) return null;
        return { d, phi, contact: clamp(d, r0, len) };
    }
    // Contact speed: the blade's angular speed times how far out it touched (the tip hits harder than the hilt)
    function contactSpeed(w, dt, contact) { return Math.abs(wrap(w.theta - w.prevTheta)) / dt * contact; }

    // 0..1 power for a contact speed, or -1 when it's too slow to do damage
    function swingPower(v, vMin, vFull) {
        if (v < vMin) return -1;
        return clamp((v - vMin) / (vFull - vMin), 0, 1);
    }
    function hitDamage(base, s, combo, mult = 1) {
        let m = 0.5 + 0.5 * s;
        const perfect = s >= C.perfect.at;
        if (perfect) m *= C.perfect.mult;
        m *= 1 + C.combo.step * Math.min(C.combo.max, combo || 0);
        return { dmg: base * m * mult, perfect };
    }
    // Damage after armor: 100 armor halves it
    function mitigate(dmg, armor, pen = 0) { return dmg * 100 / (100 + Math.max(0, (armor || 0) * (1 - pen))); }

    // Combos reward slashing back and forth: a hit swinging the other way soon after the last one adds 1.
    // c: { combo, lastDir, lastAt, lastSwing }
    function comboHit(c, dir, t, swingId) {
        if (c.lastAt !== undefined && swingId === c.lastSwing && t - c.lastAt < 0.25) { c.lastAt = t; return c.combo; } // same swing, several targets
        if (c.lastAt !== undefined && dir !== c.lastDir && t - c.lastAt <= C.combo.window) c.combo = Math.min(C.combo.max, (c.combo || 0) + 1);
        else c.combo = 0;
        c.lastDir = dir; c.lastAt = t; c.lastSwing = swingId;
        return c.combo;
    }

    // Stamina drains while swinging fast and comes back after a short rest. st: { val, idle, winded }
    function staminaStep(st, drainPerSec, dt, regenMult = 1) {
        const S = C.stamina;
        if (drainPerSec > 0) { st.val = Math.max(0, st.val - drainPerSec * dt); st.idle = 0; }
        else { st.idle += dt; if (st.idle >= S.delay) st.val = Math.min(S.max, st.val + S.regen * regenMult * dt); }
        if (st.val <= 0) st.winded = true;
        else if (st.winded && st.val >= S.recoverAt) st.winded = false;
        return st;
    }

    // ---- spear: the tip reaches toward the cursor; damage comes from how fast it moves outward ----
    function spearStep(w, aimDist, dt, P) {
        const et = clamp((aimDist - P.aimNear) / (P.aimFar - P.aimNear), 0, 1);
        const target = P.reachMin + (P.reachMax - P.reachMin) * et;
        const want = clamp((target - w.r) * 30, -P.retractV, P.extendV);
        w.vr += clamp(want - w.vr, -P.tipAccel * dt, P.tipAccel * dt);
        w.rPrev = w.r;
        w.r = clamp(w.r + w.vr * dt, P.reachMin, P.reachMax);
        if ((w.r === P.reachMax && w.vr > 0) || (w.r === P.reachMin && w.vr < 0)) w.vr = 0;
        // a new thrust is allowed once the tip is pulled back past half way
        if (w.r < P.reachMin + (P.reachMax - P.reachMin) * 0.5) w.armed = true;
        return w;
    }
    function radialSpeed(w, dt) { return (w.r - w.rPrev) / dt; }
    // Does the front of the spear (the last tipLen px, from where the tip was to where it is) come within width px of the circle?
    function thrustHit(px, py, theta, rFrom, rTo, tx, ty, tr, tipLen = 16, width = 0) {
        const a = Math.min(rFrom, rTo - tipLen), b = rTo;
        const ux = Math.cos(theta), uy = Math.sin(theta);
        const rx = tx - px, ry = ty - py;
        const along = clamp(rx * ux + ry * uy, a, b);
        const cx = ux * along - rx, cy = uy * along - ry;
        return Math.hypot(cx, cy) <= tr + width ? { along } : null;
    }

    // Mana (classes that have it) comes back slowly after a rest, faster once you have stood still for a while.
    // m: { val, idle }; stillSec: how long you have been standing still
    function manaStep(m, drainPerSec, dt, regenMult = 1, stillSec = 0) {
        const M = C.mana;
        if (drainPerSec > 0) { m.val = Math.max(0, m.val - drainPerSec * dt); m.idle = 0; }
        else { m.idle += dt; if (m.idle >= M.delay) m.val = Math.min(M.max, m.val + M.regen * (stillSec >= M.stillAfter ? M.stillMult : 1) * regenMult * dt); }
        return m;
    }
    // Damage multiplier as your health runs out: 1 at full health, 1 + desperate near 0
    function desperation(desperate, hp, maxHp) { return 1 + (desperate || 0) * clamp(1 - hp / Math.max(1, maxHp), 0, 1); }

    // ---- staff: spells, and the charge for them ----
    // Frost stacks on t ({ frost?, status }): spell hits within F.keep s add up, and every F.stacks-th slows (chills) t for
    // F.slow s. Returns how many stacks t has now (0 right after the one that slowed it) and whether it was just slowed.
    function frostStack(t, F, now) {
        const fr = t.frost && now - t.frost.at <= F.keep ? t.frost : { n: 0, at: now };
        fr.n++; fr.at = now; t.frost = fr;
        if (fr.n < F.stacks) return { n: fr.n, slowed: false };
        fr.n = 0;
        if (t.status) t.status.chillUntil = Math.max(t.status.chillUntil || 0, now + F.slow);
        return { n: 0, slowed: true };
    }
    // Holding the staff drawn back (tip within chargeBelow of its reach) charges it over chargeTime s. Returns the charge 0..1.
    function staffCharge(w, dt, P) {
        if (w.r <= P.reachMin + (P.reachMax - P.reachMin) * P.chargeBelow) w.charge = Math.min(1, (w.charge || 0) + dt / P.chargeTime);
        return w.charge || 0;
    }
    // A spell's damage multiplier for a charge 0..1 (ch: a STAFF_MAGIC charge): little uncharged, a bonus when full
    function chargeMult(c, ch) {
        c = clamp(c || 0, 0, 1);
        const m = ch.min + (1 - ch.min) * Math.pow(c, 1.5);
        return c >= 1 ? m * ch.full : m;
    }
    // Overcharge: held over s past a full charge. The spell's extra damage, and (ov: the staff magic's over) what it does to
    // you: { past: s past the safe part, burnDps, slow, stun } (each 0 when it isn't that kind or still safe)
    function overBonus(over) { const O = D.STAFF_OVER; return 1 + O.bonus * clamp((over || 0) / O.max, 0, 1); }
    function overPenalty(ov, over) {
        const past = Math.max(0, (over || 0) - D.STAFF_OVER.safe), out = { past, burnDps: 0, slow: 0, stun: 0 };
        if (!ov || past <= 0) return out;
        if (ov.kind === 'burn') out.burnDps = ov.dps + ov.grow * past;
        else if (ov.kind === 'chill') out.slow = Math.min(ov.max, ov.slow + ov.grow * past);
        else if (ov.kind === 'shock') out.stun = Math.min(ov.max, ov.stun + ov.grow * past);
        return out;
    }
    // What a spell costs at a charge 0..1: a share of its full price, the rest growing with the charge
    function spellCost(mana, c) { return mana * (D.STAFF_MANA_MIN + (1 - D.STAFF_MANA_MIN) * clamp(c || 0, 0, 1)); }
    // Is the circle inside a wave: an arc arc rad wide centred on dir, now rad px from its origin and band px thick?
    function waveHit(ox, oy, dir, arc, rad, band, tx, ty, tr) {
        const d = Math.hypot(tx - ox, ty - oy);
        if (Math.abs(d - rad) > band / 2 + tr) return false;
        const widen = d > tr ? Math.asin(Math.min(1, tr / d)) : Math.PI;
        return Math.abs(wrap(Math.atan2(ty - oy, tx - ox) - dir)) <= arc / 2 + widen;
    }

    // ---- ignite (Burning Stick): a weapon on fire ----
    // What the fire eats per second, t s after it was lit; emptyAt: when the mana ran out (null while some is left)
    function igniteDrain(a, t, emptyAt) {
        const d = a.drain;
        if (emptyAt === null || emptyAt === undefined) return { mana: d.mana + d.manaGrow * t, hp: 0 };
        return { mana: 0, hp: d.hp + d.hpGrow * Math.max(0, t - emptyAt) };
    }
    // The blow that puts the fire out, after it burned sec s: damage multiplier, knockback and stun
    function igniteBlow(a, sec) {
        const s = clamp(sec, 0, a.maxSec);
        return { sec: s, dmg: a.dmg + a.perSec * s, kb: a.kb + a.kbPerSec * s, stun: a.stunBase + a.stunPerSec * s };
    }

    // ---- bow: press, pull the mouse away from the target, release ----
    // Returns the aim (opposite the pull) and how far drawn the pull asks for, or null for a pull too short to count
    function bowPull(anchorX, anchorY, mx, my, P) {
        const dx = anchorX - mx, dy = anchorY - my;
        const len = Math.hypot(dx, dy);
        if (len < 12) return null;
        return { angle: Math.atan2(dy, dx), target: clamp(len / P.fullPull, 0, 1) };
    }
    // The string comes back at a limited rate (no instant full draws), lets go at once
    function bowStep(w, target, dt, P) {
        if (target > w.draw) w.draw = Math.min(target, w.draw + P.drawRate * dt);
        else w.draw = target;
        if (w.draw >= 0.95) w.fullFor += dt; else w.fullFor = 0;
        return w;
    }
    // Let go: { speed, dmgMult, angleOff, steady } or null when the draw was too weak (cancelled)
    function bowRelease(w, P, rng) {
        const draw = w.draw;
        w.draw = 0;
        const held = w.fullFor;
        w.fullFor = 0;
        if (draw < P.minDraw) return null;
        const steady = draw >= 0.95 && held >= P.steadyFrom && held <= P.steadyTo;
        let spread = (1 - draw) * P.spreadDeg;
        if (held > P.shakeAfter) spread = Math.min(P.shakeDeg, (held - P.shakeAfter) * 8 + 1);
        const angleOff = steady ? 0 : (rng() * 2 - 1) * spread * Math.PI / 180;
        return { speed: P.speedMin + P.speedMax * draw, dmgMult: (0.3 + 0.7 * Math.pow(draw, 1.3)) * (steady ? P.steadyMult : 1), angleOff, steady, draw };
    }
    function bowShaking(w, P) { return w.fullFor > P.shakeAfter; }

    // ---- assisted swings (setting for trackpads and motor accessibility): a click plays a scripted sweep ----
    function assistStart(w, aimAngle) {
        w.assistDir = -w.assistDir;
        w.assistFrom = aimAngle - w.assistDir * C.assist.arc / 2;
        w.assistT = 0;
    }
    // The angle the weapon should chase during an assisted swing, or null when none is playing
    function assistTarget(w, dt) {
        if (w.assistT < 0) return null;
        w.assistT += dt;
        const f = Math.min(1, w.assistT / C.assist.time);
        if (f >= 1) w.assistT = -1;
        return w.assistFrom + w.assistDir * C.assist.arc * f;
    }

    // ---- blade clash: two fast blades crossing push the fighters apart ----
    function segmentsCross(ax, ay, bx, by, cx, cy, dx, dy) {
        const d = (bx - ax) * (dy - cy) - (by - ay) * (dx - cx);
        if (Math.abs(d) < 1e-9) return false;
        const u = ((cx - ax) * (dy - cy) - (cy - ay) * (dx - cx)) / d;
        const v = ((cx - ax) * (by - ay) - (cy - ay) * (bx - ax)) / d;
        return u >= 0 && u <= 1 && v >= 0 && v <= 1;
    }
    function bladeSegment(px, py, theta, r0, len) {
        return [px + Math.cos(theta) * r0, py + Math.sin(theta) * r0, px + Math.cos(theta) * len, py + Math.sin(theta) * len];
    }

    // ---- shields ----
    // Does a raised shield stop a hit? sh: { up, theta, raisedAt }; st: the shield's gearStats (block, arc, stab, parry);
    // fromAngle: the direction the hit comes from (defender -> attacker). Raised within the parry window: a parry (nothing gets
    // through, no stamina). Otherwise the shield stops its share for stamina; without enough stamina the guard breaks.
    function blockHit(sh, st, fromAngle, dmg, now, stamina) {
        const none = { blocked: false, parry: false, taken: dmg, stamCost: 0, broken: false };
        if (!sh || !sh.up || !st || !st.arc) return none;
        if (Math.abs(wrap(fromAngle - sh.theta)) > st.arc / 2) return none;
        if (now - sh.raisedAt <= st.parry) return { blocked: true, parry: true, taken: 0, stamCost: 0, broken: false };
        const stopped = dmg * st.block;
        const cost = stopped * C.shield.stamPerDmg / st.stab;
        if (cost <= stamina) return { blocked: true, parry: false, taken: dmg - stopped, stamCost: cost, broken: false };
        const share = Math.max(0, stamina) / cost;
        return { blocked: true, parry: false, taken: dmg - stopped * share, stamCost: Math.max(0, stamina), broken: true };
    }

    // Teams: players and rivals are different teams, monsters are their own; nobody hits their own team
    function canDamage(teamA, teamB) { return !!teamA && !!teamB && teamA !== teamB; }
    // Knockback impulse (px/s) along the swing, scaled by power and the target's mass
    function knockback(kb, s, mass, mult = 1) { return kb * (0.4 + 0.6 * Math.max(0, s)) * mult / Math.max(0.5, mass || 1); }

    // Spear momentum: damage multiplier from how fast the thrower moves along the thrust (px/s). 1 when standing or retreating.
    // extra: added to the bonus at full speed (Lancer perks and buffs).
    function momentumMult(forwardSpeed, extra = 0) {
        const M = D.WEAPON_CLASSES.spear.momentum;
        return 1 + (M.max + extra) * clamp(Math.max(0, forwardSpeed) / M.ref, 0, 1);
    }

    // Is the hit coming from behind? (daggers backstab, crabs block from the front)
    function fromBehind(attackAngle, facing) { return Math.abs(wrap(attackAngle - facing)) < Math.PI / 2; }

    return {
        TAU, wrap, clamp, newWeapon, track, sweepHit, contactSpeed, swingPower, hitDamage, mitigate, comboHit, staminaStep,
        hasReach, spearStep, radialSpeed, thrustHit, staffCharge, chargeMult, waveHit, frostStack, manaStep, desperation, overBonus, overPenalty, spellCost, igniteDrain, igniteBlow, bowPull, bowStep, bowRelease, bowShaking, assistStart, assistTarget,
        segmentsCross, bladeSegment, canDamage, knockback, fromBehind, blockHit, momentumMult,
    };
}));
