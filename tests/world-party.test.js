'use strict';
// Parties: who is in one, its chat, no hurting each other; and the Proving Grounds' leaderboard
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const Pt = require('../core/world-party');
const O = require('../core/world-online');
const Ar = require('../core/world-arena');

test('members: the first to join lead, a party has room for PARTY.max, junk is dropped', () => {
    const tree = { ubbbbb: { n: 'Bea', z: 'mines', t: 20 }, uaaaaa: { n: 'Al', z: 'town', t: 10 }, 'bad id!': { n: 'X', z: 'town', t: 1 }, ucccccc: 'nope' };
    const m = Pt.sanitizeMembers(tree);
    assert.deepEqual([...m.keys()], ['uaaaaa', 'ubbbbb']);
    assert.equal(Pt.leaderOf(m), 'uaaaaa');
    assert.equal(m.get('ubbbbb').z, 'mines');
    const many = {};
    for (let i = 0; i < 9; i++) many['user0' + i] = { n: 'P' + i, z: 'town', t: i };
    assert.equal(Pt.sanitizeMembers(many).size, Pt.PARTY.max);
    assert.equal(Pt.leaderOf(new Map()), null);
    const t = Pt.tickets({ uaaaaa: 'uaaaaa', ubbbbb: 'uaaaaa', 'x/y': 'z' });
    assert.deepEqual(t, ['uaaaaa', 'ubbbbb']);
    assert.ok(Pt.hasRoom(t, 'ucccccc'));
    assert.ok(!Pt.hasRoom(['u1aaaa', 'u2aaaa', 'u3aaaa', 'u4aaaa'], 'u5aaaa'));
    assert.ok(Pt.hasRoom(['u1aaaa', 'u2aaaa', 'u3aaaa', 'u4aaaa'], 'u4aaaa'), 'a member coming back');
    assert.ok(Pt.validPid(Pt.newPid()));
    assert.equal(Pt.member('Al', 'nowhere!', 5).z, '');
});

test('the party\'s chat: cleaned like zone chat, only the last lines kept', () => {
    assert.deepEqual(Pt.chatLine('uaaaaa', 'Al', '  hello\u0007   there ', 7), { u: 'uaaaaa', n: 'Al', m: 'hello there', t: 7 });
    assert.equal(Pt.chatLine('uaaaaa', 'Al', '   ', 7), null);
    assert.equal(Pt.chatLine('uaaaaa', 'Al', 'x'.repeat(200), 7).m.length, O.CHAT.maxLen);
    assert.equal(Pt.sanitizeChat({ u: 'no', n: 'Al', m: 'hi', t: 1 }), null);
    const keys = Array.from({ length: Pt.PARTY.chatKeep + 3 }, (_, i) => 'k' + String(i).padStart(3, '0'));
    assert.deepEqual(Pt.chatOverflow(keys.slice().reverse()), ['k000', 'k001', 'k002'], 'the oldest go');
    assert.deepEqual(Pt.chatOverflow(['a', 'b']), []);
});

test('party members can\'t hurt each other (but everyone else still can)', () => {
    const base = { zone: 'mines', attacker: { x: 100, y: 100, fl: 0 }, me: { x: 140, y: 100, protected: false, safe: false }, now: 100, weapon: 'sword_1' };
    const hit = O.makeHit('sword_1', 'melee', 20, 0, false);
    assert.equal(O.validateHit(hit, Object.assign({}, base, { mate: true })).reason, 'party');
    assert.equal(O.validateHit(O.makeHit('firestaff_2', 'spell', 30, 0, false), Object.assign({}, base, { mate: true })).reason, 'party');
    assert.equal(O.validateHit(hit, base).ok, true);
    // the info field that shows a party fits its id
    assert.equal(O.sanitizeInfo({ n: 'Al', pt: Pt.newPid() }).pt.length, 10);
});

test('the rules: only ticket holders read or join a party; chat lines are signed by a member', () => {
    const rules = JSON.parse(fs.readFileSync(path.join(__dirname, '..', 'database.rules.json'), 'utf8')).rules;
    const p = rules.wilds.v1.party.$pid;
    assert.equal(Pt.PARTY.root, 'wilds/v1/party');
    assert.match(p['.read'], /child\('inv'\)\.child\(auth\.uid\)\.exists\(\)/);
    assert.match(p.m.$uid['.write'], /auth\.uid === \$uid && .*inv\/' \+ \$uid\)\.exists\(\)/, 'a member only with a ticket');
    assert.match(p.inv.$uid['.write'], /m\/' \+ auth\.uid\)\.exists\(\)/, 'members give tickets');
    assert.match(p.inv.$uid['.write'], /!data\.parent\(\)\.exists\(\)/, 'the founder takes the first');
    assert.match(p.c.$cid['.write'], /newData\.child\('u'\)\.val\(\) === auth\.uid/);
    assert.ok(new RegExp(p['.validate'].match(/matches\(\/(.*?)\/\)/)[1]).test(Pt.newPid()));
    assert.equal(Number(p.c.$cid.m['.validate'].match(/<= (\d+)/)[1]), O.CHAT.maxLen);
});

test('the waves leaderboard: highest wave first, the earlier record breaks a tie', () => {
    const tree = {
        uaaaaa: { n: 'Al', w: 12, p: 2, t: 50 }, ubbbbb: { n: 'Bea', w: 20, p: 1, t: 90 }, uccccc: { n: 'Cy', w: 20, p: 3, t: 10 },
        udddddd: { n: 'Dee', w: 0, t: 1 }, 'bad!': { n: 'X', w: 99, t: 1 }, ueeeee: { n: 'bad name!!', w: 50, t: 1 },
    };
    const list = Ar.wavesList(tree, 20);
    assert.deepEqual(list.map(r => r.uid), ['uccccc', 'ubbbbb', 'uaaaaa']);
    assert.equal(Ar.placeOn(tree, 'ubbbbb', 'waves'), 2);
    assert.equal(Ar.placeOn(tree, 'nobody', 'waves'), 0);
    const a = Ar.freshArena(); a.waveBest = 17; a.title = 'Gladiator';
    assert.deepEqual(Ar.sanitizeWaves(Ar.wavesRecord('Al', a, 3, 99)), { n: 'Al', w: 17, p: 3, ti: 'Gladiator', t: 99 });
    // the rating board ranks the same way it always did
    assert.equal(Ar.placeOn({ uaaaaa: { n: 'Al', r: 1100, w: 1, l: 0, t: 1 }, ubbbbb: { n: 'Bea', r: 1300, w: 2, l: 0, t: 1 } }, 'uaaaaa', 'top'), 2);
});
