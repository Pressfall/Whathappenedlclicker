'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const D = require('../core/world-data');
const W = require('../core/world-logic');
const O = require('../core/world-online');
const T = require('../core/world-net-tree');

// ---------- the shared tree ----------

test('tree: set, get, delete with null, and empty parents disappear', () => {
    let t = null;
    t = T.set(t, 'a/b/c', 1);
    t = T.set(t, 'a/b/d', { x: 2, y: null, z: {} });
    assert.deepEqual(t, { a: { b: { c: 1, d: { x: 2 } } } });
    assert.equal(T.get(t, 'a/b/d/x'), 2);
    assert.equal(T.get(t, 'a/nope/x'), null);
    t = T.set(t, 'a/b/c', null);
    t = T.set(t, 'a/b/d', null);
    assert.equal(t, null, 'nothing left');
    assert.deepEqual(T.childDiff({ a: 1, b: 2 }, { b: 3, c: 4 }), { added: ['c'], changed: ['b'], removed: ['a'] });
    assert.equal(T.overlaps('wilds/v1/zones/mines/p/u1', 'wilds/v1/zones/mines/p'), true);
    assert.equal(T.overlaps('wilds/v1/zones/mines', 'wilds/v1/zones/mines/p'), true);
    assert.equal(T.overlaps('wilds/v1/zones/frost/p', 'wilds/v1/zones/mines/p'), false);
    assert.equal(T.applyInc(5, { '.inc': -2 }), 3);
    assert.equal(T.applyInc(null, { '.inc': 4 }), 4);
    assert.equal(T.applyInc(5, 'x'), 'x');
});

// ---------- positions and identity ----------

test('positions pack into a short string and back; junk is refused', () => {
    const p = { x: 1234.6, y: 88.2, a: -1.234, r: 64, sa: 3.1, fl: O.FLAGS.shield | O.FLAGS.protect, hp: 97.2, mhp: 140, shot: 12, k: 5 };
    const s = O.packPos(p);
    assert.ok(s.length < 60, s);
    const u = O.unpackPos(s);
    assert.deepEqual([u.x, u.y, u.a, u.r, u.sa, u.fl, u.hp, u.mhp, u.shot, u.k], [1235, 88, -1.23, 64, 3.1, 9, 98, 140, 12, 5]);
    for (const bad of [null, 42, 'a,b,c', '1,2,3', '1,2,3,4,5,6,7,8,9,x', '1,2,3,4,5,6,7,8,9', 'x'.repeat(200)]) assert.equal(O.unpackPos(bad), null, String(bad));
});

test('names, chat and faces are cleaned; the swear filter matches the game chat', () => {
    assert.equal(O.sanitizeName('  Big   Chad '), 'Big Chad');
    assert.equal(O.sanitizeName('x'), null);
    assert.equal(O.sanitizeName('<script>'), null);
    assert.equal(O.cleanChat('  hi\u0007 there  '), 'hi there');
    assert.equal(O.cleanChat('a'.repeat(100)).length, O.CHAT.maxLen);
    assert.equal(O.cleanChat('   '), null);
    assert.equal(O.censor('what the hell, shitty boss'), 'what the ***, *** boss');
    assert.equal(O.censor('hello shell'), 'hello shell', 'whole words only');
    const info = O.sanitizeInfo({ n: 'Ok Name', f: 'https://evil.example/x.png', w: 'nope', sh: 'sword_1', c: 99, say: { m: ' gg ', t: 5 } });
    assert.deepEqual([info.n, info.f, info.w, info.sh, info.c, info.say.m], ['Ok Name', 'mainimage/whathappened.jpeg', 'sword_0', '', 5, 'gg']);
    assert.equal(O.sanitizeInfo({ f: 'mainimage/thumbs/WHchad.webp' }).f, 'mainimage/thumbs/WHchad.webp');
    const s = W.freshState(0);
    const me = O.infoFor(s, 'Me', 'mainimage/whathappened.jpeg');
    assert.equal(me.w, 'sword_0');
    assert.equal(me.sh, 'shield_0');
});

// ---------- PvP ----------

const at = (x, y, fl = 0) => ({ x, y, fl });
const ctx = (over = {}) => Object.assign({ zone: 'greenwood', attacker: at(100, 100), me: { x: 140, y: 100, protected: false }, now: 10, lastAt: undefined }, over);

test('a fair hit is taken at PvP strength', () => {
    const r = O.validateHit(O.makeHit('sword_1', 'melee', 20, 0, false), ctx());
    assert.deepEqual(r, { ok: true, dmg: 20 * O.PVP.mult });
});

test('hits are refused in town, from too far, too often, from the dead, or on a protected player', () => {
    const hit = O.makeHit('sword_1', 'melee', 20, 0, false);
    assert.equal(O.validateHit(hit, ctx({ zone: 'town' })).reason, 'town');
    assert.equal(O.validateHit(hit, ctx({ me: { x: 600, y: 100 } })).reason, 'range');
    assert.equal(O.validateHit(hit, ctx({ lastAt: 9.99 })).reason, 'rate');
    assert.equal(O.validateHit(hit, ctx({ attacker: at(100, 100, O.FLAGS.dead) })).reason, 'attacker');
    assert.equal(O.validateHit(hit, ctx({ me: { x: 140, y: 100, protected: true } })).reason, 'protected');
    assert.equal(O.validateHit({ w: 'sword_1', k: 'laser', dmg: 1 }, ctx()).reason, 'kind');
    assert.equal(O.validateHit(O.makeHit('bow_1', 'melee', 5, 0), ctx()).reason, 'weapon', 'a bow does not slash');
    assert.equal(O.validateHit(O.makeHit('sword_1', 'arrow', 5, 0), ctx()).reason, 'weapon', 'a sword does not shoot');
    assert.equal(O.validateHit('nope', ctx()).reason, 'shape');
});

test('arrows reach far; damage is capped by what the weapon could ever do', () => {
    const far = ctx({ me: { x: 900, y: 100 } });
    assert.equal(O.validateHit(O.makeHit('bow_1', 'arrow', 10, 0), far).ok, true);
    const r = O.validateHit(O.makeHit('sword_1', 'melee', 1e9, 0), ctx());
    assert.equal(r.dmg, O.maxHit('sword_1', 'melee') * O.PVP.mult);
    assert.ok(O.maxHit('sword_5') > O.maxHit('sword_1'));
    assert.ok(O.reachFor('spear_1', 'thrust') > O.reachFor('dagger_1', 'melee'));
});

test('a parry notice needs only to come from nearby', () => {
    assert.deepEqual(O.validateHit({ k: 'parry' }, ctx()), { ok: true, dmg: 0 });
    assert.equal(O.validateHit({ k: 'parry' }, ctx({ me: { x: 900, y: 100 } })).reason, 'range');
});

// ---------- loot ----------

test('loot bags: only real, droppable materials; the killer gets first pick; old bags expire', () => {
    const bag = O.sanitizeLoot({ x: 10, y: 20, t: 1000, m: { iron_ore: 3, sigil_greenwood: 1, fake: 9, copper_ore: 1e6 }, by: 'Bob', k: 'killer01', o: 'victim01' });
    assert.deepEqual(bag.m, { iron_ore: 3, copper_ore: O.LOOT.maxEach });
    assert.equal(O.sanitizeLoot({ x: 1, y: 1, t: 1, m: { sigil_mines: 1 } }), null, 'keys never drop');
    assert.equal(O.sanitizeLoot({ x: 'a', y: 1, t: 1, m: { stone: 1 } }), null);
    assert.equal(O.canClaim(bag, 'someone', 1000 + 5000), false);
    assert.equal(O.canClaim(bag, 'killer01', 1000 + 5000), true);
    assert.equal(O.canClaim(bag, 'someone', 1000 + O.LOOT.ownerSec * 1000), true);
    assert.equal(O.lootExpired(bag, 1000 + O.LOOT.lifeSec * 1000 + 1), true);
});

// ---------- the shared boss ----------

test('shared boss: when a new fight starts, who earned the reward, who runs it', () => {
    const now = 1e6;
    assert.equal(O.bossNeedsReset(null, now, 90), true);
    const live = O.sanitizeBoss({ hp: 500, max: 900, gen: 'g1', t: now - 1000, f: { aaaa1: 30, bbbb2: 5, 'bad id!': 99 } });
    assert.deepEqual(Object.keys(live.f), ['aaaa1', 'bbbb2']);
    assert.equal(O.bossNeedsReset(live, now, 90), false);
    assert.equal(O.bossNeedsReset(Object.assign({}, live, { t: now - 61000 }), now, 90), true, 'nobody fighting for a minute');
    const dead = Object.assign({}, live, { killedAt: now - 30000 });
    assert.equal(O.bossDeadFor(dead, now, 90), true);
    assert.equal(O.bossNeedsReset(dead, now, 90), false);
    assert.equal(O.bossNeedsReset(dead, now + 61000, 90), true);
    assert.equal(O.earnedReward(live, 'aaaa1'), true, '30 of 900 is over 3%');
    assert.equal(O.earnedReward(live, 'bbbb2'), false);
    assert.equal(O.hostOf(['zzzz9', 'aaaa1', 'mmmm5']), 'aaaa1');
    assert.equal(O.sanitizeBoss({ hp: 1, max: 0 }), null);
});

test('remote players move smoothly between updates', () => {
    const buf = [{ at: 0, x: 0, y: 0, a: 3, sa: 0, r: 0 }, { at: 100, x: 100, y: 50, a: -3, sa: 1, r: 40 }];
    const m = O.interpolate(buf, 50);
    assert.deepEqual([m.x, m.y, m.r], [50, 25, 20]);
    assert.ok(Math.abs(Math.abs(m.a) - Math.PI) < 0.2, 'angles take the short way round');
    assert.equal(O.interpolate(buf, 500).x, 100);
    assert.equal(O.interpolate([], 0), null);
});

test('database.rules.json is valid and covers every place the game writes', () => {
    const rules = JSON.parse(require('fs').readFileSync(require('path').join(__dirname, '..', 'database.rules.json'), 'utf8')).rules;
    assert.equal(rules['.read'], false);
    assert.equal(rules['.write'], false);
    const zone = rules.wilds.v1.zones.$zone;
    for (const k of ['p', 'i', 'h', 'l', 'b']) assert.ok(zone[k], 'rule for ' + k);
    assert.match(zone.p.$uid['.write'], /auth\.uid === \$uid/, 'only you write your position');
    assert.match(zone.h.$victim['.read'], /auth\.uid === \$victim/, 'only the target reads its hits');
    assert.match(zone.h.$victim.$hid['.write'], /newData\.child\('from'\)\.val\(\) === auth\.uid/, 'hits are signed by their sender');
    assert.equal(O.ROOT, 'wilds/v1/zones');
    for (const z of Object.keys(D.ZONES)) assert.ok(new RegExp(zone['.validate'].match(/\/(.*)\//)[1]).test(z), 'zone ' + z + ' allowed');
});
