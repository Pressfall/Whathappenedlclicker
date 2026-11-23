'use strict';
// The revolver (D.WEAPON_CLASSES.gun, core/world-combat.js gun*) and the Gunslinger: recoil and Steady shots, the hammer
// fanned, the cylinder and its reloads, ricochets and falloff, and how it measures up to the bow
const test = require('node:test');
const assert = require('node:assert/strict');
const D = require('../core/world-data');
const C = require('../core/world-combat');
const W = require('../core/world-logic');
const O = require('../core/world-online');

const P = D.WEAPON_CLASSES.gun, B = D.WEAPON_CLASSES.bow;
const NOW = 1_700_000_000_000;

test('a revolver for every tier from Copper, made at the Forge, a step behind the sword per shot', () => {
    for (let t = 1; t <= D.MAX_TIER; t++) {
        const g = D.GEAR_BY_ID['gun_' + t];
        assert.ok(g && g.cls === 'gun' && g.slot === 'weapon' && g.recipe.station === 'forge', 'gun_' + t);
        assert.equal(g.dmg, Math.round(D.TIERS[t].swordDmg * P.dmg * 10) / 10);
        assert.ok(g.name.endsWith('Revolver'));
    }
    assert.ok(!D.GEAR_BY_ID.gun_0, 'not in the starter kit');
    assert.ok(D.GEAR_BY_ID.ray_gun && D.GEAR_BY_ID.ray_gun.set === 'arcade' && D.GEAR_BY_ID.ray_gun.cls === 'gun');
});

test('recoil: the first shot is Steady, quick ones aren\'t and bloom; the barrel swings back and the next one is Steady again', () => {
    const c = C.newCylinder(P), w = C.newWeapon('gun', 0);
    const first = C.gunFire(c, w, P, 10, { rng: () => 0.9 });
    assert.ok(first.steady && first.angleOff === 0 && first.mult === P.steadyMult);
    assert.ok(Math.abs(w.omega) > P.steadyOmega, 'the kick');
    assert.equal(C.gunFire(c, w, P, 10.05), null, 'the hammer must be cocked again');
    const quick = C.gunFire(c, w, P, 10 + P.cock + 0.001, { rng: () => 1 });
    assert.ok(!quick.steady && quick.mult === 1);
    const quick2 = C.gunFire(c, w, P, 10 + (P.cock + 0.001) * 2, { rng: () => 1 });
    assert.ok(Math.abs(quick2.angleOff) > Math.abs(quick.angleOff), 'quick shots bloom');
    let t = 10 + (P.cock + 0.001) * 2;
    for (let i = 0; i < 120; i++) { C.track(w, 0, 1 / 120, P); t += 1 / 120; }
    assert.ok(Math.abs(C.wrap(w.theta)) < 0.02 && Math.abs(w.omega) < P.steadyOmega, 'the aim swung the barrel back');
    assert.ok(C.gunFire(c, w, P, t).steady);
    // a fanned shot: never Steady, wider, weaker, and no wait for the hammer
    const f = C.gunFire(c, w, P, t + 0.01, { fan: true, rng: () => 1 });
    assert.ok(f && !f.steady && f.fan && f.mult === P.fanMult && Math.abs(f.angleOff - P.fanSpread) < 1e-9);
    assert.ok(P.fanGap < P.cock, 'fanning is faster than any click');
});

test('the cylinder: six rounds; empty, the whole thing spins in; otherwise rounds trickle back after a pause; the Gunslinger is quicker', () => {
    const c = C.newCylinder(P), w = C.newWeapon('gun', 0);
    let t = 0;
    for (let i = 0; i < P.rounds; i++) { assert.ok(C.gunFire(c, w, P, t), 'shot ' + i); t += P.cock + 0.001; }
    assert.equal(C.gunFire(c, w, P, t + 1), null, 'click: empty');
    assert.equal(C.gunReload(c, P, t, 1), 'spin');
    assert.equal(C.gunFire(c, w, P, t + 0.5, { fan: true }), null, 'not mid-spin');
    assert.equal(C.gunReload(c, P, t + P.reloadEmpty - 0.01, 1), null);
    assert.equal(C.gunReload(c, P, t + P.reloadEmpty, 1), 'full');
    assert.equal(c.rounds, P.rounds);
    // two shots, then a pause: one round back every reloadRound s once reloadIdle has passed (not while the trigger is held)
    t += 5; C.gunFire(c, w, P, t); C.gunFire(c, w, P, t + P.cock + 0.001); t += P.cock + 0.001;
    assert.equal(C.gunReload(c, P, t + P.reloadIdle - 0.01, 1), null);
    assert.equal(C.gunReload(c, P, t + P.reloadIdle + 0.5, 1, true), null, 'holding the trigger');
    C.gunReload(c, P, t + P.reloadIdle + 0.0005, 1);
    assert.equal(C.gunReload(c, P, t + P.reloadIdle + P.reloadRound + 0.001, 1), 'round');
    assert.equal(c.rounds, P.rounds - 1);
    // Tumble / a dash / Quick Draw put rounds back at once and end a spin
    const e = C.newCylinder(P); e.rounds = 0; C.gunReload(e, P, 0, 1);
    assert.ok(e.reloadEnd > 0);
    C.gunLoad(e, 2);
    assert.deepEqual([e.rounds, e.reloadEnd], [2, 0]);
    C.gunLoad(e, true);
    assert.equal(e.rounds, P.rounds);
    // the Gunslinger: its class and Fast Hands make reloading 40% quicker
    const s = W.freshState(NOW);
    s.classes.unlocked.gunslinger = true; s.classes.active = 'gunslinger'; s.skills.learned.tumble = true; s.skills.learned.fast_hands = true;
    const ps = W.playerStats(s);
    assert.ok(Math.abs(ps.reload - 0.6) < 1e-9 && ps.dashReload === 1 && ps.dmgBy.gun === 1.15);
});

test('bullets lose punch at long range and ricochet off walls', () => {
    assert.equal(C.gunFalloff(0, P), 1);
    assert.equal(C.gunFalloff(P.falloffFrom, P), 1);
    assert.ok(C.gunFalloff((P.falloffFrom + P.falloffTo) / 2, P) < 1);
    assert.equal(C.gunFalloff(5000, P), P.falloffMin);
    assert.ok(P.bounce >= 1 && P.bounceMult < 1);
    // a wall to the right (x >= 100): a bullet going right and down comes back left, still going down
    const solid = (x) => x >= 100;
    const b = C.bounceOff({ x: 102, y: 52, vx: 300, vy: 100 }, 98, 50, solid);
    assert.deepEqual([b.vx, b.vy, b.x, b.y], [-300, 100, 98, 50]);
    // a corner: straight back
    const k = C.bounceOff({ x: 102, y: 102, vx: 300, vy: 300 }, 98, 98, (x, y) => x >= 100 && y >= 100);
    assert.deepEqual([k.vx, k.vy], [-300, -300]);
});

// A player tapping Steady shots, tapping as fast as they can, or fanning: damage per second (in sword-damage units)
// with the real recoil and reload code. tol: how far off (rad) the barrel can point and still hit. Quick and fanned shots
// spread at random (bloom), so those styles are averaged over the same 12 seeded runs every time (one random run put
// mashing at range anywhere from 78% to 90% of Steady, and the check failed about one run in five).
function seeded(seed) {
    let a = seed >>> 0;
    return () => { a = (a + 0x6D2B79F5) | 0; let t = Math.imul(a ^ (a >>> 15), 1 | a); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
}
function dps(style, tol, rm = 1, secs = 60) {
    if (style === 'steady') return dpsRun(style, tol, rm, secs, () => 0.5);
    let sum = 0;
    for (let s = 1; s <= 12; s++) sum += dpsRun(style, tol, rm, secs, seeded(s));
    return sum / 12;
}
function dpsRun(style, tol, rm, secs, rng) {
    const c = C.newCylinder(P), w = C.newWeapon('gun', 0), dt = 1 / 120;
    let t = 0, dmg = 0, lastTap = -9;
    while (t < secs) {
        C.track(w, 0, dt, P);
        C.gunReload(c, P, t, rm, style === 'fan' && C.gunReady(c));
        if (C.gunReady(c)) {
            let r = null;
            if (style === 'steady' && t - c.lastShot >= P.settle && Math.abs(w.omega) <= P.steadyOmega) r = C.gunFire(c, w, P, t, { rng: () => 0.5 });
            else if (style === 'spam' && t - lastTap >= 0.1) { lastTap = t; r = C.gunFire(c, w, P, t, { rng }); }
            else if (style === 'fan' && t - lastTap >= P.fanGap) { lastTap = t; r = C.gunFire(c, w, P, t, { fan: true, rng }); }
            if (r && Math.abs(C.wrap(w.theta + r.angleOff)) <= tol) dmg += r.mult;
        }
        t += dt;
    }
    return dmg / secs * P.dmg;
}

test('balance: Steady shots match the bow; mashing doesn\'t beat patience at range; fanning is a close-range burst', () => {
    const bow = B.steadyMult * B.dmg / (0.95 / B.drawRate + B.steadyFrom + 0.12); // full draw, a steady hold, re-aim
    const steady = dps('steady', 0.08), spamFar = dps('spam', 0.08), spamNear = dps('spam', 0.25), fanNear = dps('fan', 0.25), fanFar = dps('fan', 0.08);
    assert.ok(steady >= bow * 0.95 && steady <= bow * 1.2, 'Steady ' + steady.toFixed(2) + ' vs the bow ' + bow.toFixed(2));
    assert.ok(spamFar < steady * 0.85, 'mashing at range: ' + spamFar.toFixed(2));
    assert.ok(spamNear <= steady * 1.15, 'mashing up close at most a little better: ' + spamNear.toFixed(2));
    assert.ok(fanNear > fanFar * 1.8 && fanFar < steady * 0.6, 'fanning: ' + fanNear.toFixed(2) + ' near, ' + fanFar.toFixed(2) + ' far');
    // the Gunslinger's quicker reload helps, but not past a third
    assert.ok(dps('steady', 0.08, 0.6) < steady * 1.33);
});

test('the Gunslinger: unlocked by 30 revolver hits, a skill tree like the others, and its skills are sound', () => {
    const k = D.CLASSES.gunslinger;
    assert.deepEqual(k.unlock && [k.unlock.stat, k.unlock.n], ['bulletHits', 30]);
    assert.equal(W.freshState(NOW).stats.bulletHits, 0);
    assert.equal(k.branches.length, 3);
    const ids = k.branches.flatMap(b => b.skills);
    assert.equal(ids.length, 12);
    assert.equal(ids.filter(id => D.ABILITIES[id]).length, 6);
    const fan = D.ABILITIES.fan_hammer, noon = D.ABILITIES.high_noon;
    assert.ok(fan.count === P.rounds && fan.spread > 0 && fan.speed * fan.life > 300);
    assert.ok(noon.count >= 3 && noon.range > 300 && noon.arc > 0);
    assert.ok(D.ABILITIES.tumble.reload > 0 && D.ABILITIES.quick_draw.reload === true);
    // online: revolver hits are their own kind, only from a revolver, and abilities are capped like the rest
    const ctx = { zone: 'greenwood', attacker: { x: 0, y: 0, fl: 0 }, me: { x: 300, y: 0 }, now: 10 };
    assert.ok(O.validateHit(O.makeHit('gun_3', 'shot', 50, 0), ctx).ok);
    assert.equal(O.validateHit(O.makeHit('bow_3', 'shot', 50, 0), ctx).reason, 'weapon');
    assert.equal(O.validateHit(O.makeHit('gun_3', 'melee', 50, 0), ctx).reason, 'weapon');
    assert.equal(O.validateHit(O.makeHit('gun_3', 'shot', 50, 0), Object.assign({}, ctx, { me: { x: 5000, y: 0 } })).reason, 'range');
    assert.ok(O.validateHit({ w: 'high_noon', k: 'ab', dmg: 40, ang: 0 }, ctx).ok);
});
