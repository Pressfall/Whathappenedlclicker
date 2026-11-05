'use strict';
// Shared monsters: every page makes the same ones, and only the fights travel
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const D = require('../core/world-data');
const Mb = require('../core/world-mobs');
const O = require('../core/world-online');

test('a spawn point makes the same monster on every page, and a new one after each kill', () => {
    for (const z of D.ZONE_ORDER) for (let i = 0; i < 20; i++) {
        const t = Mb.pickType(z, i, 0);
        assert.equal(Mb.pickType(z, i, 0), t);
        assert.ok(D.ZONES[z].spawns.some(([id]) => id === t), t + ' is one of ' + z + "'s");
    }
    // over many spawn points every kind the zone lists turns up, roughly by its weight
    const counts = {};
    for (let i = 0; i < 600; i++) { const t = Mb.pickType('greenwood', i, 0); counts[t] = (counts[t] || 0) + 1; }
    assert.deepEqual(Object.keys(counts).sort(), D.ZONES.greenwood.spawns.map(s => s[0]).sort());
    assert.ok(counts.slime > counts.boar && counts.slime > counts.sprite, 'slimes are the most common');
    // a different generation can make a different kind
    assert.ok(new Set(Array.from({ length: 30 }, (_, g) => Mb.pickType('greenwood', 3, 1000 + g))).size > 1);
});

test('ids fit a database key (no dots) and the rule', () => {
    assert.equal(Mb.sid(12, 1), 's12_1');
    assert.equal(Mb.sid(3, 0, true), 'e3');
    for (const id of ['s0_0', 's999_4', 'e0', 'e120']) assert.ok(Mb.validSid(id), id);
    for (const id of ['s1.2', 'x1', 's1_', 's1234_0', '', '../b']) assert.ok(!Mb.validSid(id), id);
    const rules = JSON.parse(fs.readFileSync(path.join(__dirname, '..', 'database.rules.json'), 'utf8')).rules.wilds.v1.zones.$zone;
    const v = rules.k.$sid['.validate'], re = new RegExp(v.slice(v.indexOf('matches(/') + 9, v.indexOf('/)')));
    for (const id of ['s0_0', 's999_4', 'e0']) assert.ok(re.test(id), 'rules allow ' + id);
    for (const id of ['s1.2', 'x1', '../b']) assert.ok(!re.test(id), 'rules refuse ' + id);
    assert.match(rules.m.$uid['.write'], /auth\.uid === \$uid/, 'only you write your report');
    assert.ok(Number(/<= (\d+)/.exec(rules.m.$uid['.validate'])[1]) >= Mb.RATE.maxChars, 'the rule allows a whole report');
});

test('a kill is fresh for the respawn time, and old records are cleaned away', () => {
    const now = 10_000_000;
    assert.ok(Mb.killFresh(now - 1000, now, false));
    assert.ok(!Mb.killFresh(now - (D.MONSTER_RESPAWN_SEC + 1) * 1000, now, false));
    assert.ok(Mb.killFresh(now - (D.MONSTER_RESPAWN_SEC + 1) * 1000, now, true), 'an elite stays down longer');
    assert.ok(!Mb.killStale(now - 1000, now));
    assert.ok(Mb.killStale(now - 4 * D.ELITE_RESPAWN_SEC * 1000, now));
    assert.equal(Mb.sanitizeKill('x'), 0);
    assert.equal(Mb.sanitizeKill(-5), 0);
    assert.equal(Mb.sanitizeKill(1.7e12), 1.7e12);
});

test('a report round-trips, stays inside the size the rules allow, and refuses nonsense', () => {
    const items = [
        { sid: 's4_0', d: 1, x: 812.4, y: 1500.6, fa: -1.234, as: 3, ai: 1, tx: 900, ty: 1490, dmg: 140.4 },
        { sid: 'e2', d: 0, dmg: 55 },
    ];
    const str = Mb.pack(17, items), back = Mb.unpack(str);
    assert.equal(back.n, 17);
    const a = back.items.get('s4_0');
    assert.deepEqual([a.d, a.x, a.y, a.as, a.ai, a.tx, a.ty, a.dmg], [1, 812, 1501, 3, 1, 900, 1490, 140]);
    assert.ok(Math.abs(a.fa - -1.23) < 0.01);
    assert.deepEqual([back.items.get('e2').d, back.items.get('e2').dmg], [0, 55]);
    // a full report fits
    const many = Array.from({ length: 20 }, (_, i) => ({ sid: 's' + (100 + i) + '_2', d: 1, x: 99999, y: 99999, fa: -6.99, as: 123456, ai: 3, tx: 99999, ty: 99999, dmg: 12345678 }));
    const big = Mb.pack(999999999, many);
    assert.ok(big.length <= Mb.RATE.maxChars, 'at most ' + Mb.RATE.maxChars + ' characters: ' + big.length);
    assert.ok(Mb.unpack(big).items.size <= Mb.RATE.maxItems);
    // an ordinary one is small: this is what a fight costs each other player per report
    const usual = Mb.pack(5000, [items[0], Object.assign({}, items[0], { sid: 's4_1' })]);
    assert.ok(usual.length < 90, 'two monsters in ' + usual.length + ' characters');
    for (const bad of [null, 5, 'no bar', '3|s1_0,1,2', '3|zz,1,1,1,1,1,1,1,1,1', 'x'.repeat(400)]) assert.ok(!Mb.unpack(bad) || Mb.unpack(bad).items.size === 0, String(bad).slice(0, 20));
});

test('the lowest id runs a monster two players woke, and everyone adds up the damage', () => {
    const item = (d, dmg) => ({ sid: 's1_0', d, dmg });
    const peer = (uid, it, fresh = true) => ({ uid, fresh, items: new Map(it ? [['s1_0', it]] : []) });
    // nobody else has it: I run it if I woke it
    assert.deepEqual(Mb.standing('s1_0', [], true, 'm'), { driver: 'm', others: 0 });
    assert.equal(Mb.standing('s1_0', [], false, 'm').driver, null);
    // another player woke it first: they run it, unless my id is lower
    assert.equal(Mb.standing('s1_0', [peer('z', item(1, 40))], false, 'm').driver, 'z');
    assert.equal(Mb.standing('s1_0', [peer('z', item(1, 40))], true, 'm').driver, 'm', 'both woke it: the lower id');
    assert.equal(Mb.standing('s1_0', [peer('c', item(1, 0))], true, 'm').driver, 'c');
    // a player who only hit it runs nothing, but their damage counts; stale reports count for nothing
    const st = Mb.standing('s1_0', [peer('a', item(0, 30)), peer('b', item(1, 12)), peer('c', item(1, 99), false)], false, 'm');
    assert.deepEqual(st, { driver: 'b', others: 42 });
    assert.equal(Mb.pooledHp(200, 200, 0, 50), 150);
    assert.equal(Mb.pooledHp(120, 200, 80, 50), 70, 'mine is in hp already: only the new damage lowers it');
    assert.equal(Mb.pooledHp(100, 200, 100, 0), 100);
});

test('what it costs: nothing alone, a little in a fight', () => {
    const r = Mb.RATE;
    const reportBytes = Mb.pack(5000, Array.from({ length: 3 }, (_, i) => ({ sid: 's' + i + '_0', d: 1, x: 1200, y: 1800, fa: 1, as: 4, ai: 0, tx: 1300, ty: 1800, dmg: 300 }))).length + 60;
    const perSec = r.sendHz * reportBytes;
    assert.ok(perSec < 600, 'about ' + Math.round(perSec) + ' bytes a second to each other player while three monsters are being fought');
    assert.ok(r.sendHz <= 4);
    // for comparison: the co-op waves send a thousand characters 4.5 times a second
    assert.ok(perSec < 4.5 * 1000 / 4);
    assert.ok(O.ROOT);
});
