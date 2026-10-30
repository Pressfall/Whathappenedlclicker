'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const D = require('../core/world-data');
const C = require('../core/world-combat');

const DT = 1 / 120;
const SWORD = D.WEAPON_CLASSES.sword;

// Swing a weapon from its current angle toward `to` for `sec` seconds; returns the hits on a target circle
function swing(w, P, to, sec, target) {
    const hits = [];
    for (let t = 0; t < sec; t += DT) {
        C.track(w, to, DT, P);
        const h = C.sweepHit(0, 0, w.prevTheta, w.theta, P.r0, P.len, target.x, target.y, target.r);
        if (h) hits.push({ v: C.contactSpeed(w, DT, h.contact), contact: h.contact });
    }
    return hits;
}

test('tracking settles on the mouse and never turns faster than the weapon allows', () => {
    for (const cls of ['sword', 'axe', 'pickaxe', 'dagger']) {
        const P = D.WEAPON_CLASSES[cls];
        const w = C.newWeapon(cls, 0);
        let maxW = 0, settled = -1;
        for (let i = 0; i < 240; i++) {
            C.track(w, 2, DT, P);
            maxW = Math.max(maxW, Math.abs(w.omega));
            if (settled < 0 && Math.abs(C.wrap(2 - w.theta)) < 0.02 && Math.abs(w.omega) < 0.5) settled = i * DT;
        }
        assert.ok(maxW <= P.wMax + 1e-9, cls + ' omega ' + maxW);
        assert.ok(settled > 0 && settled < 1, cls + ' settles in ' + settled + 's');
    }
    const heavy = C.newWeapon('axe', 0), light = C.newWeapon('dagger', 0);
    for (let i = 0; i < 12; i++) { C.track(heavy, 2, DT, D.WEAPON_CLASSES.axe); C.track(light, 2, DT, D.WEAPON_CLASSES.dagger); }
    assert.ok(light.theta > heavy.theta, 'a dagger whips around faster than an axe');
});

test('winded swings are capped at half speed', () => {
    const w = C.newWeapon('sword', 0);
    for (let i = 0; i < 60; i++) C.track(w, Math.PI * 0.9, DT, SWORD, { winded: true });
    const w2 = C.newWeapon('sword', 0);
    let max = 0;
    for (let i = 0; i < 60; i++) { C.track(w2, Math.PI * 0.9 * (i % 2 ? 1 : -1), DT, SWORD, { winded: true }); max = Math.max(max, Math.abs(w2.omega)); }
    assert.ok(max <= SWORD.wMax * D.COMBAT.stamina.windedMult + 1e-9);
});

test('a slow sweep touches the target but is too slow to hurt it', () => {
    const w = C.newWeapon('sword', -1);
    const target = { x: 40, y: 0, r: 14 };
    const hits = [];
    // drag the mouse slowly across: 0.3 rad/s
    for (let t = 0, aim = -1; t < 7; t += DT, aim += 0.3 * DT) {
        C.track(w, aim, DT, SWORD);
        const h = C.sweepHit(0, 0, w.prevTheta, w.theta, SWORD.r0, SWORD.len, target.x, target.y, target.r);
        if (h) hits.push(C.swingPower(C.contactSpeed(w, DT, h.contact), SWORD.vMin, SWORD.vFull));
    }
    assert.ok(hits.length > 0, 'the blade did touch');
    assert.ok(hits.every(s => s === -1), 'but never fast enough');
});

test('a fast flick hits even a target the blade passes between frames', () => {
    const w = C.newWeapon('sword', -1.5);
    // a thin target exactly between two blade positions: only the swept sector can catch it
    const hits = swing(w, SWORD, 1.5, 0.3, { x: 40, y: 0, r: 2 });
    assert.ok(hits.length >= 1);
    const s = Math.max(...hits.map(h => C.swingPower(h.v, SWORD.vMin, SWORD.vFull)));
    assert.ok(s > 0.5, 'and hard: power ' + s);
});

test('the tip hits harder than the hilt', () => {
    const w = C.newWeapon('sword', 0);
    w.prevTheta = 0; w.theta = 0.1;
    assert.ok(C.contactSpeed(w, DT, 44) > C.contactSpeed(w, DT, 14) * 3);
    const near = C.sweepHit(0, 0, 0, 0.1, SWORD.r0, SWORD.len, 12, 2, 4);
    const far = C.sweepHit(0, 0, 0, 0.1, SWORD.r0, SWORD.len, 44, 2, 4);
    assert.ok(far.contact > near.contact);
    assert.equal(C.sweepHit(0, 0, 0, 0.1, SWORD.r0, SWORD.len, 80, 0, 4), null, 'out of reach');
});

test('damage: power, Perfect, combo and armor', () => {
    assert.equal(C.hitDamage(10, 0, 0).dmg, 5);
    assert.equal(C.hitDamage(10, 0.5, 0).dmg, 7.5);
    const p = C.hitDamage(10, 1, 0);
    assert.equal(p.perfect, true);
    assert.equal(p.dmg, 12.5);
    assert.ok(Math.abs(C.hitDamage(10, 1, 3).dmg - 12.5 * 1.3) < 1e-9);
    assert.ok(Math.abs(C.hitDamage(10, 1, 9).dmg - 12.5 * 1.3) < 1e-9, 'combo caps at 3');
    assert.equal(C.mitigate(100, 100), 50);
    assert.equal(C.mitigate(100, 0), 100);
    assert.equal(C.mitigate(100, 100, 1), 100, 'full penetration ignores armor');
});

test('combos: alternating directions build it, the same direction resets it, several targets in one swing keep it', () => {
    const c = {};
    assert.equal(C.comboHit(c, 1, 0, 1), 0);
    assert.equal(C.comboHit(c, -1, 0.4, 2), 1);
    assert.equal(C.comboHit(c, -1, 0.45, 2), 1, 'second target, same swing');
    assert.equal(C.comboHit(c, 1, 0.9, 3), 2);
    assert.equal(C.comboHit(c, -1, 1.3, 4), 3);
    assert.equal(C.comboHit(c, 1, 1.7, 5), 3, 'capped');
    assert.equal(C.comboHit(c, 1, 2.0, 6), 0, 'same direction again');
    assert.equal(C.comboHit(c, -1, 3.5, 7), 0, 'too late');
});

test('stamina drains while swinging, recovers after a rest, and running dry winds you', () => {
    const st = { val: 100, idle: 0, winded: false };
    for (let i = 0; i < 1200; i++) C.staminaStep(st, 12, DT);
    assert.equal(st.val, 0);
    assert.equal(st.winded, true);
    C.staminaStep(st, 0, 0.2);
    assert.equal(st.val, 0, 'no regen before the delay');
    for (let i = 0; i < 120; i++) C.staminaStep(st, 0, DT);
    assert.ok(st.val > 20 && st.winded, 'still winded below the recovery mark');
    for (let i = 0; i < 60; i++) C.staminaStep(st, 0, DT);
    assert.equal(st.winded, false);
});

test('spear: flicking out thrusts fast, pulling back does not, and the reach follows the cursor', () => {
    const P = D.WEAPON_CLASSES.spear;
    const w = C.newWeapon('spear', 0);
    for (let i = 0; i < 60; i++) C.spearStep(w, 30, DT, P);
    assert.equal(w.r, P.reachMin);
    let maxOut = 0;
    for (let i = 0; i < 30; i++) { C.spearStep(w, 200, DT, P); maxOut = Math.max(maxOut, C.radialSpeed(w, DT)); }
    assert.ok(maxOut >= P.vMin, 'jab speed ' + maxOut);
    assert.ok(maxOut <= P.extendV + 1e-6);
    assert.equal(w.r, P.reachMax);
    let maxIn = 0;
    for (let i = 0; i < 30; i++) { C.spearStep(w, 30, DT, P); maxIn = Math.min(maxIn, C.radialSpeed(w, DT)); }
    assert.ok(maxIn < 0 && w.armed, 'retracting re-arms the next thrust');
    // a slow push outward is too slow to count
    const s = C.newWeapon('spear', 0);
    let slowMax = 0;
    for (let d = 30; d < 160; d += 0.6) { C.spearStep(s, d, DT, P); slowMax = Math.max(slowMax, C.radialSpeed(s, DT)); }
    assert.ok(slowMax < P.vMin, 'slow push ' + slowMax);
    assert.ok(C.thrustHit(0, 0, 0, 50, 70, 74, 0, 8));
    assert.equal(C.thrustHit(0, 0, 0, 50, 70, 74, 30, 8), null);
    // the spear's own hitbox: a longer tip and some leeway either side of the shaft
    assert.ok(C.thrustHit(0, 0, 0, 50, P.reachMax, P.reachMax - 20, 14, 8, P.tipLen, P.hitWidth), 'a near miss beside the tip still lands');
    assert.equal(C.thrustHit(0, 0, 0, 50, P.reachMax, P.reachMax - 20, 14, 8), null, 'it would miss with no leeway');
});

test('staff: holding it drawn back charges the next spell, and a full charge hits hardest', () => {
    const P = D.WEAPON_CLASSES.staff, ch = D.STAFF_MAGIC.fire.charge;
    const w = C.newWeapon('staff', 0);
    assert.equal(w.r, P.reachMin);
    for (let t = 0; t < P.chargeTime / 2; t += DT) { C.spearStep(w, 30, DT, P); C.staffCharge(w, DT, P); }
    assert.ok(w.charge > 0.4 && w.charge < 0.6, 'half the time, half charged: ' + w.charge);
    for (let t = 0; t < P.chargeTime; t += DT) C.staffCharge(w, DT, P);
    assert.equal(w.charge, 1);
    // reaching out does not charge it
    const out = C.newWeapon('staff', 0);
    for (let i = 0; i < 120; i++) { C.spearStep(out, 200, DT, P); C.staffCharge(out, DT, P); }
    assert.ok(out.charge < 0.15, 'only the moment before the tip left: ' + out.charge);
    assert.equal(C.chargeMult(0, ch), ch.min);
    assert.ok(C.chargeMult(0.5, ch) < 0.5, 'half a charge is worth less than half');
    assert.equal(C.chargeMult(1, ch), ch.full);
    // a full charge every 1.4 s beats spamming quarter charges every 0.55 s
    assert.ok(C.chargeMult(1, ch) / 1.4 > C.chargeMult(0.25, ch) / 0.55);
});

test('mana comes back slower than stamina, much faster standing still, and not while it is being drained', () => {
    const M = D.COMBAT.mana, S = D.COMBAT.stamina;
    assert.ok(M.regen < S.regen && M.delay >= S.delay);
    const regen = (still) => { const m = { val: 0, idle: 0 }; let s = 0; for (let t = 0; t < 4; t += DT) { s += still ? DT : 0; C.manaStep(m, 0, DT, 1, s); } return m.val; };
    const st = { val: 0, idle: 0, winded: false };
    for (let t = 0; t < 4; t += DT) C.staminaStep(st, 0, DT);
    assert.ok(regen(false) < st.val / 2, 'walking: ' + regen(false) + ' vs stamina ' + st.val);
    assert.ok(regen(true) > regen(false) * 1.8, 'standing still: ' + regen(true));
    assert.ok(regen(false) < 12, 'a slow trickle on its own: ' + regen(false));
    // the standing-still boost only starts after a while
    const m1 = { val: 0, idle: 5 }, m2 = { val: 0, idle: 5 };
    C.manaStep(m1, 0, 1, 1, M.stillAfter - 0.1); C.manaStep(m2, 0, 1, 1, M.stillAfter);
    assert.equal(m1.val, M.regen); assert.equal(m2.val, M.regen * M.stillMult);
    const m = { val: 50, idle: 5 };
    C.manaStep(m, 10, 0.5);
    assert.equal(m.val, 45); assert.equal(m.idle, 0);
    for (let t = 0; t < 60; t += DT) C.manaStep(m, 0, DT, 1, 99);
    assert.equal(m.val, M.max);
});

test('overcharge: a little more damage the longer, and past the safe part each staff turns on you its own way', () => {
    const O = D.STAFF_OVER, SM = D.STAFF_MAGIC;
    assert.equal(C.overBonus(0), 1);
    assert.ok(C.overBonus(O.max / 2) > 1 && C.overBonus(O.max / 2) < C.overBonus(O.max));
    assert.equal(C.overBonus(99), 1 + O.bonus, 'the bonus stops growing');
    for (const id in SM) assert.deepEqual(C.overPenalty(SM[id].over, O.safe), { past: 0, burnDps: 0, slow: 0, stun: 0 }, id + ' is safe at first');
    const fire = (s) => C.overPenalty(SM.fire.over, O.safe + s), frost = (s) => C.overPenalty(SM.frost.over, O.safe + s), bolt = (s) => C.overPenalty(SM.lightning.over, O.safe + s);
    assert.ok(fire(2).burnDps > fire(0.5).burnDps && fire(1).slow === 0 && fire(1).stun === 0, 'fire burns, more the longer');
    assert.ok(frost(1).slow > frost(0.2).slow && frost(99).slow === SM.frost.over.max && SM.frost.over.linger > 0, 'frost slows, up to a limit, and lingers');
    assert.ok(bolt(1).stun > bolt(0.2).stun && bolt(99).stun === SM.lightning.over.max, 'lightning stuns');
});

test('a spell costs less mana the less it was charged', () => {
    const m = D.STAFF_MAGIC.fire.thrust.mana;
    assert.equal(C.spellCost(m, 1), m);
    assert.equal(C.spellCost(m, 0), m * D.STAFF_MANA_MIN);
    assert.ok(C.spellCost(m, 0.5) > C.spellCost(m, 0.2) && C.spellCost(m, 0.5) < m);
    assert.equal(C.spellCost(m, 5), m, 'never more than full price');
});

test('desperation: Chain Lightning hits harder the lower your health', () => {
    const a = D.ABILITIES.chain_lightning;
    assert.equal(C.desperation(a.desperate, 100, 100), 1);
    assert.ok(C.desperation(a.desperate, 20, 100) > C.desperation(a.desperate, 60, 100));
    assert.equal(C.desperation(a.desperate, 0, 100), 1 + a.desperate);
    assert.equal(C.desperation(undefined, 10, 100), 1);
});

test('frost: every few spell hits in a row slows the target, and old stacks melt', () => {
    const F = D.STAFF_MAGIC.frost.frost, t = { status: { chillUntil: 0 } };
    for (let i = 1; i < F.stacks; i++) assert.deepEqual(C.frostStack(t, F, i * 0.5), { n: i, slowed: false });
    assert.deepEqual(C.frostStack(t, F, F.stacks * 0.5), { n: 0, slowed: true });
    assert.equal(t.status.chillUntil, F.stacks * 0.5 + F.slow);
    const u = { status: { chillUntil: 0 } };
    C.frostStack(u, F, 0);
    assert.equal(C.frostStack(u, F, F.keep + 1).n, 1, 'a stack too old is gone');
});

test('staff magic: fire for one target, lightning for groups, frost in between', () => {
    const SM = D.STAFF_MAGIC;
    assert.deepEqual(Object.keys(SM).sort(), ['fire', 'frost', 'lightning']);
    // what one thrust and one swing deal to a single enemy, and to five bunched up in front of you
    const single = (m) => m.thrust.dmg;
    const group = (m) => { const ch = m.thrust.chain; let bolt = m.thrust.dmg * (1 + (m.thrust.pierce || 0)); if (ch) for (let i = 1, d = m.thrust.dmg; i <= Math.min(4, ch.jumps); i++) { d *= ch.falloff; bolt += d; } return bolt + 5 * m.swing.dmg * Math.min(1, m.swing.arcMax / 2); };
    assert.ok(single(SM.fire) > single(SM.frost) && single(SM.frost) > single(SM.lightning));
    assert.ok(group(SM.lightning) > group(SM.frost) && group(SM.frost) > group(SM.fire));
    for (const id in SM) {
        const m = SM[id];
        assert.ok(m.users.every(c => D.CLASSES[c] && D.CLASSES[c].mana), id + ': its casters have mana');
        for (const sp of [m.thrust, m.swing]) assert.ok(sp.mana > 0 && sp.dmg > 0 && sp.speed > 0 && sp.life > 0, id);
        assert.ok(m.mat.slice(1).every(x => Object.keys(x).every(k => D.MATERIALS_BY_ID[k])), id + ' recipe materials');
    }
    assert.ok(SM.frost.frost && SM.frost.thrust.frost && SM.frost.swing.frost);
    for (let t = 1; t <= 5; t++) for (const id in SM) assert.ok(D.GEAR_BY_ID[id + 'staff_' + t], id + ' tier ' + t);
});

test('staff spells: a wave hits what is inside its arc at its current distance', () => {
    assert.ok(C.waveHit(0, 0, 0, 1.4, 100, 18, 100, 0, 10));
    assert.ok(C.waveHit(0, 0, 0, 1.4, 100, 18, 100 * Math.cos(0.65), 100 * Math.sin(0.65), 10), 'near the edge of the arc');
    assert.equal(C.waveHit(0, 0, 0, 1.4, 100, 18, 0, 100, 10), false, 'off to the side');
    assert.equal(C.waveHit(0, 0, 0, 1.4, 100, 18, 40, 0, 10), false, 'already passed');
    assert.equal(C.waveHit(0, 0, 0, 1.4, 100, 18, 180, 0, 10), false, 'not reached yet');
});

test('Burning Stick: the fire eats mana faster and faster, then health; the longer it burns the bigger the blow', () => {
    const a = D.ABILITIES.burning_stick;
    assert.ok(C.igniteDrain(a, 3, null).mana > C.igniteDrain(a, 1, null).mana);
    assert.equal(C.igniteDrain(a, 3, null).hp, 0, 'health is safe while there is mana');
    assert.equal(C.igniteDrain(a, 5, 4).mana, 0);
    assert.ok(C.igniteDrain(a, 6, 4).hp > C.igniteDrain(a, 4.5, 4).hp);
    // a full bar of mana lasts a few seconds; 90 health (a Mystic with no armor) a few more
    let mp = D.COMBAT.mana.max, t = 0;
    while (mp > 0) { mp -= C.igniteDrain(a, t, null).mana * DT; t += DT; }
    const empty = t;
    let hp = 90;
    while (hp > 0) { hp -= C.igniteDrain(a, t, empty).hp * DT; t += DT; }
    assert.ok(empty > 3.5 && empty < 6, 'mana lasts ' + empty);
    assert.ok(t - empty > 3.5 && t - empty < 8, 'then health ' + (t - empty));
    const quick = C.igniteBlow(a, 0.5), long = C.igniteBlow(a, empty);
    assert.ok(long.dmg > quick.dmg * 2 && long.kb > quick.kb && long.stun > quick.stun);
    assert.deepEqual(C.igniteBlow(a, 99), C.igniteBlow(a, a.maxSec), 'it stops growing at maxSec');
});

test('bow: the pull sets the aim and draw, the draw rises at a limited rate, weak draws cancel, steady shots', () => {
    const P = D.WEAPON_CLASSES.bow;
    const pull = C.bowPull(100, 100, 40, 100, P); // pulled left: aims right
    assert.ok(Math.abs(pull.angle) < 1e-9);
    assert.equal(pull.target, 0.5);
    assert.equal(C.bowPull(100, 100, 95, 100, P), null, 'too short');
    const w = C.newWeapon('bow');
    C.bowStep(w, 1, 0.1, P);
    assert.ok(Math.abs(w.draw - 0.25) < 1e-9, 'no instant full draws');
    w.draw = 0.1;
    assert.equal(C.bowRelease(w, P, () => 0.5), null);
    w.draw = 0;
    for (let i = 0; i < 60; i++) C.bowStep(w, 1, DT, P); // 0.5s: full after 0.4s, held ~0.1s
    for (let i = 0; i < 12; i++) C.bowStep(w, 1, DT, P);
    const shot = C.bowRelease(w, P, () => 0.9);
    assert.equal(shot.steady, true);
    assert.equal(shot.angleOff, 0);
    assert.ok(Math.abs(shot.dmgMult - P.steadyMult) < 1e-9);
    assert.equal(shot.speed, P.speedMin + P.speedMax);
    w.draw = 0.5; w.fullFor = 0;
    const weak = C.bowRelease(w, P, () => 1);
    assert.ok(weak.dmgMult < 0.6 && weak.angleOff > 0);
});

test('assisted swings play a sweep through the aim and alternate direction', () => {
    const w = C.newWeapon('sword', 0);
    C.assistStart(w, 1);
    const first = C.assistTarget(w, 0.0001);
    let last;
    for (let i = 0; i < 40; i++) { const a = C.assistTarget(w, DT); if (a !== null) last = a; }
    assert.ok(Math.abs(Math.abs(last - first) - D.COMBAT.assist.arc) < 0.05);
    assert.equal(C.assistTarget(w, DT), null, 'finished');
    const dir1 = Math.sign(last - first);
    C.assistStart(w, 1);
    const f2 = C.assistTarget(w, 0.0001);
    for (let i = 0; i < 40; i++) { const a = C.assistTarget(w, DT); if (a !== null) last = a; }
    assert.equal(Math.sign(last - f2), -dir1);
});

test('blades cross, teams, backstabs', () => {
    assert.equal(C.segmentsCross(0, 0, 10, 10, 0, 10, 10, 0), true);
    assert.equal(C.segmentsCross(0, 0, 10, 0, 0, 5, 10, 5), false);
    assert.equal(C.canDamage('player', 'monster'), true);
    assert.equal(C.canDamage('monster', 'monster'), false);
    assert.equal(C.fromBehind(0, 0.2), true);
    assert.equal(C.fromBehind(Math.PI, 0), false);
    assert.ok(Math.abs(C.wrap(3 * Math.PI) - Math.PI) < 1e-9 || Math.abs(C.wrap(3 * Math.PI) + Math.PI) < 1e-9);
});

test('shields: block hits from the front for stamina, not from behind; a just-raised shield parries; no stamina breaks the guard', () => {
    const W = require('../core/world-logic');
    const s = W.freshState(0);
    const st = W.gearStats(W.findGear(s, s.equip.offhand));
    assert.ok(st.block > 0 && st.arc > 0 && st.parry > 0, 'the starter buckler has block stats');
    const sh = { up: true, theta: 0, raisedAt: 0 };
    const parry = C.blockHit(sh, st, 0.1, 50, 0.05, 100);
    assert.deepEqual([parry.parry, parry.taken, parry.stamCost], [true, 0, 0]);
    const block = C.blockHit(sh, st, 0.1, 50, 2, 100);
    assert.equal(block.blocked, true);
    assert.equal(block.parry, false);
    assert.ok(Math.abs(block.taken - 50 * (1 - st.block)) < 1e-9);
    assert.ok(block.stamCost > 0);
    const behind = C.blockHit(sh, st, Math.PI, 50, 2, 100);
    assert.deepEqual([behind.blocked, behind.taken], [false, 50]);
    const lowered = C.blockHit({ up: false, theta: 0, raisedAt: 0 }, st, 0, 50, 2, 100);
    assert.equal(lowered.taken, 50);
    const broken = C.blockHit(sh, st, 0, 200, 2, 10);
    assert.equal(broken.broken, true);
    assert.equal(broken.stamCost, 10);
    assert.ok(broken.taken > 200 * (1 - st.block) && broken.taken < 200);
});

test('better shields block more and cost less stamina; quality improves both', () => {
    const W = require('../core/world-logic');
    const s = W.freshState(0);
    const at = (base, score) => W.gearStats(W.addGear(s, base, score, [], 0));
    const lo = at('shield_1', 40), hi = at('shield_5', 40), great = at('shield_1', 99);
    assert.ok(hi.block > lo.block && hi.stab > lo.stab && hi.arc > lo.arc);
    assert.ok(great.block > lo.block && great.stab > lo.stab && great.parry > lo.parry);
    assert.ok(great.block <= D.COMBAT.shield.maxBlock);
});

test('spear momentum: standing is 1x, walking a little more, a dash the most, retreating nothing', () => {
    const M = D.WEAPON_CLASSES.spear.momentum;
    assert.equal(C.momentumMult(0), 1);
    assert.equal(C.momentumMult(-300), 1);
    const walk = C.momentumMult(D.COMBAT.player.speed), dash = C.momentumMult(D.COMBAT.player.speed * D.COMBAT.dash.speedMult);
    assert.ok(walk > 1 && dash > walk);
    assert.ok(Math.abs(dash - (1 + M.max)) < 1e-9, 'a dash reaches the cap');
    assert.equal(C.momentumMult(5000), 1 + M.max);
});
