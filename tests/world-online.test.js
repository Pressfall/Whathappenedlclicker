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

test('staffs: weak blows up close, spells from afar, and only a staff casts them', () => {
    assert.equal(O.validateHit(O.makeHit('firestaff_1', 'thrust', 5, 0), ctx()).ok, true);
    assert.equal(O.validateHit(O.makeHit('firestaff_1', 'bash', 2, 0), ctx()).ok, true);
    assert.equal(O.validateHit(O.makeHit('firestaff_1', 'melee', 5, 0), ctx()).reason, 'weapon', 'a staff thrusts and bashes like a spear');
    assert.ok(O.maxHit('firestaff_1', 'thrust') < O.maxHit('spear_1', 'thrust'), 'its own blows are weak');
    const far = ctx({ me: { x: 500, y: 100 } });
    assert.equal(O.validateHit(O.makeHit('firestaff_1', 'spell', 30, 0), far).ok, true);
    assert.equal(O.validateHit(O.makeHit('sword_1', 'spell', 30, 0), far).reason, 'weapon', 'a sword casts nothing');
    assert.equal(O.validateHit(O.makeHit('firestaff_1', 'spell', 30, 0), ctx({ me: { x: 2000, y: 100 } })).reason, 'range');
    assert.ok(O.maxHit('firestaff_1', 'spell') > O.maxHit('firestaff_1', 'thrust') * 3, 'spells are what a staff is for');
    assert.equal(O.validateHit(O.makeHit('firestaff_1', 'spell', 1e9, 0), far).dmg, O.maxHit('firestaff_1', 'spell') * O.PVP.mult);
    // a lightning bolt can jump on to players further away; frost and lightning staffs cast too
    assert.ok(O.reachFor('lightningstaff_1', 'spell') > O.reachFor('firestaff_1', 'spell'));
    assert.equal(O.validateHit(O.makeHit('froststaff_3', 'spell', 30, 0), far).ok, true);
    assert.equal(O.validateHit(O.makeHit('lightningstaff_3', 'spell', 30, 0), ctx({ me: { x: 1000, y: 100 } })).ok, true);
});

test('Ice Beam may hit a player many times in one go, but only along its length', () => {
    const a = D.ABILITIES.ice_beam;
    let rate;
    for (let i = 0; i < 20; i++) { const r = ab('ice_beam', 10, { now: 10 + i * a.tick, abRate: rate }); assert.equal(r.ok, true, 'tick ' + i); rate = r.rate; }
    assert.equal(ab('ice_beam', 10, { me: { x: 100 + a.len + 600, y: 100 } }).reason, 'range');
    assert.ok(O.abilityMaxHit(D.ABILITIES.chain_lightning, 'sword_1') > D.GEAR_BY_ID.sword_1.dmg * D.ABILITIES.chain_lightning.dmg * 4.5 * 2, 'desperate and amplified hits fit under the cap');
});

test('Burning Stick reaches as far as a weapon blow, and may hit as hard as its longest burn', () => {
    const a = D.ABILITIES.burning_stick;
    assert.equal(ab('burning_stick', 50).ok, true);
    assert.equal(ab('burning_stick', 50, { me: { x: 600, y: 100 } }).reason, 'range');
    assert.ok(O.abilityMaxHit(a, 'sword_1') >= D.GEAR_BY_ID.sword_1.dmg * (a.dmg + a.perSec * a.maxSec));
});

test('a parry notice needs only to come from nearby', () => {
    assert.deepEqual(O.validateHit({ k: 'parry' }, ctx()), { ok: true, dmg: 0 });
    assert.equal(O.validateHit({ k: 'parry' }, ctx({ me: { x: 900, y: 100 } })).reason, 'range');
});

// ---------- PvP: abilities ----------

const ab = (id, dmg, over) => O.validateHit(O.makeHit(id, 'ab', dmg, 0, false), ctx(Object.assign({ weapon: 'sword_1' }, over)));

test('an ability hit is taken at PvP strength, its damage capped by the weapon the caster shows', () => {
    const r = ab('whirlwind', 20);
    assert.equal(r.ok, true);
    assert.equal(r.dmg, 20 * O.PVP.mult);
    assert.equal(r.ability, D.ABILITIES.whirlwind, 'the effects come from the game table');
    assert.deepEqual(r.rate, { start: 10, n: 1 });
    const huge = ab('whirlwind', 1e9);
    assert.equal(huge.dmg, O.abilityMaxHit(D.ABILITIES.whirlwind, 'sword_1') * O.PVP.mult);
    assert.ok(ab('whirlwind', 1e9, { weapon: 'sword_5' }).dmg > huge.dmg, 'better weapons hit harder');
    assert.ok(O.abilityMaxHit(D.ABILITIES.lunge, 'spear_1') > O.abilityMaxHit(D.ABILITIES.sweep, 'spear_1') * 2, 'momentum abilities may hit much harder');
    assert.ok(D.ABILITY_ORDER.every(id => id.length <= 24), 'every id fits the hit rule for w');
});

test('ability hits are refused for unknown or harmless abilities, from too far, in town, or with no damage', () => {
    assert.equal(ab('nope', 5).reason, 'ability');
    assert.equal(ab('constructor', 5).reason, 'ability', 'no prototype keys');
    assert.equal(ab('second_wind', 5).reason, 'ability', 'a heal hurts nobody');
    assert.equal(ab('berserk', 5).reason, 'ability');
    assert.equal(ab('whirlwind', 5, { me: { x: 100 + O.abilityReach(D.ABILITIES.whirlwind) + 5, y: 100 } }).reason, 'range');
    assert.equal(ab('chain_lightning', 5, { me: { x: 900, y: 100 } }).ok, true, 'lightning jumps far');
    assert.equal(ab('whirlwind', 5, { zone: 'town' }).reason, 'town');
    assert.equal(ab('whirlwind', 0).reason, 'dmg');
    assert.equal(ab('whirlwind', 5, { me: { x: 140, y: 100, protected: true } }).reason, 'protected');
    assert.deepEqual([ab('smoke_bomb', 0).ok, ab('smoke_bomb', 0).dmg], [true, 0], 'Smoke Bomb only dazes');
    assert.equal(ab('smoke_bomb', 50).reason, 'dmg');
    assert.ok(O.playerStun(2.2) < 2.2 && O.playerStun(99) === O.PVP.stunMax, 'stuns hold players for less time');
});

test('one cast hits a player at most as often as it could: once, once per knife or arrow, once per tick of an area', () => {
    const run = (id, times) => { let rate; return times.map((t) => { const r = ab(id, 5, { now: t, abRate: rate }); if (r.ok) rate = r.rate; return r.ok; }); };
    assert.deepEqual(run('whirlwind', [10, 10.1]), [true, false]);
    const cd = D.ABILITIES.whirlwind.cd;
    assert.deepEqual(run('whirlwind', [10, 10 + cd * 0.3, 10 + cd * 0.5]), [true, false, true], 'the next cast only after its cooldown (perks cut it to 40%)');
    const volley = D.ABILITIES.arrow_volley;
    assert.deepEqual(run('arrow_volley', Array(volley.count + 1).fill(10)), [...Array(volley.count).fill(true), false]);
    const rain = D.ABILITIES.rain_of_arrows, ticks = O.abilityBurst(rain).n;
    assert.equal(ticks, 9);
    const times = Array.from({ length: ticks + 1 }, (_, i) => 10 + rain.delay + i * rain.tick);
    assert.deepEqual(run('rain_of_arrows', times), [...Array(ticks).fill(true), false]);
});

test('a cast rides along with the position; short positions still read; junk casts are refused', () => {
    const base = { x: 100, y: 200, a: 0, r: 0, sa: 0, fl: 0, hp: 50, mhp: 100, shot: 0, k: 1 };
    assert.equal(O.packPos(base).split(',').length, 10, 'no cast yet: the short form');
    const s = O.packPos(Object.assign({ cs: 3, ci: 'chain_lightning', cx: 3150.4, cy: 99 }, base));
    const u = O.unpackPos(s);
    assert.deepEqual([u.cs, u.ci, u.cx, u.cy, u.hp], [3, 'chain_lightning', 3150, 99, 50]);
    assert.equal(O.packPos(Object.assign({ cs: 3, ci: 'nope' }, base)).split(',').length, 10);
    assert.equal(O.unpackPos(O.packPos(base) + ',3,nope,1,1'), null);
    assert.equal(O.unpackPos(O.packPos(base) + ',3,whirlwind,x,1'), null);
    assert.equal(O.unpackPos(O.packPos(base) + ',3,whirlwind'), null);
    // the longest id at the far corner still fits the database's 120 characters
    const longest = D.ABILITY_ORDER.reduce((a, b) => (b.length > a.length ? b : a));
    const worst = O.packPos({ x: 99999, y: 99999, a: -3.14, r: 200, sa: -3.14, fl: 255, hp: 99999, mhp: 99999, shot: 999999999, k: 999999, cs: 999999999, ci: longest, cx: 99999, cy: 99999 });
    assert.ok(worst.length <= 120, worst.length + ' characters');
    assert.ok(O.unpackPos(worst));
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
    // every zone players meet in (inside a building, like the Hall of Gods, nobody is online)
    for (const z of Object.keys(D.ZONES).filter(id => !D.ZONES[id].interior)) assert.ok(new RegExp(zone['.validate'].match(/\/(.*)\//)[1]).test(z), 'zone ' + z + ' allowed');
});
