'use strict';
// Who may change what in a clan (core/clan-roles.js, the spec firestore-social.rules follows): every action a page takes,
// and the forged ones a hostile page might send.
const test = require('node:test');
const assert = require('node:assert/strict');
const R = require('../core/clan-roles');

const OWNER = 'uidOwner01', CO = 'uidCoLead1', ELDER = 'uidElder01', MEM = 'uidMember1', ANON = 'uidAnon001', OUT = 'uidOutside';
function clan(over = {}) {
    return Object.assign({
        name: 'Testers', owner: 'Olive', members: ['Olive', 'Cole', 'Ezra', 'Mia', 'Ann'], leaders: ['Olive', 'Cole'], maxMembers: 30, clanXp: 100, description: '',
        ownerUid: OWNER,
        roles: { [OWNER]: 'leader', [CO]: 'co-leader', [ELDER]: 'elder', [MEM]: 'member', [ANON]: 'member' },
        names: { [OWNER]: 'Olive', [CO]: 'Cole', [ELDER]: 'Ezra', [MEM]: 'Mia', [ANON]: 'Ann' },
        acct: { [OWNER]: true, [CO]: true, [ELDER]: true, [MEM]: true },
        kicks: {},
    }, over);
}
const copy = (o) => JSON.parse(JSON.stringify(o));
function edit(c, fn) { const n = copy(c); fn(n); return n; }
const check = (before, after, uid, account = true) => R.classifyClanUpdate(before, after, uid, account);
// a kick or role change names itself (act), as the page writes it
const by = (after, who, target, kind) => Object.assign(after, { act: { by: who, kind, target } });

test('ranks: leader above co-leader above elder above elite member above member', () => {
    assert.deepEqual(['leader', 'co-leader', 'elder', 'eleite member', 'member'].map(R.rank), [5, 4, 3, 2, 1]);
    assert.equal(R.rank(undefined), 1);
    assert.equal(R.roleOf(clan(), OWNER), 'leader');
    assert.equal(R.roleOf(clan(), OUT), null);
    assert.equal(R.roleOf(clan({ roles: { [MEM]: 'emperor' } }), MEM), null, 'no made-up roles');
    assert.equal(R.canKick('co-leader', 'elder', false), true);
    assert.equal(R.canKick('elder', 'elder', false), false);
    assert.equal(R.canKick('leader', 'leader', true), false, 'nobody kicks the owner');
    assert.equal(R.canAssignRole('co-leader', 'co-leader'), false);
    assert.equal(R.uidOfName(clan(), 'Ezra'), ELDER);
});

test('creating a clan: an account, and only yourself as its leader', () => {
    const fresh = { name: 'New', owner: 'Olive', members: ['Olive'], leaders: ['Olive'], clanXp: 0, ownerUid: OWNER, roles: { [OWNER]: 'leader' }, names: { [OWNER]: 'Olive' }, acct: { [OWNER]: true } };
    assert.deepEqual(check(null, fresh, OWNER), { ok: true, action: 'create' });
    assert.equal(check(null, fresh, OWNER, false).reason, 'account', 'not anonymously');
    assert.equal(check(null, Object.assign({}, fresh, { ownerUid: CO }), OWNER).ok, false, 'not for someone else');
    assert.equal(check(null, Object.assign({}, fresh, { roles: { [OWNER]: 'leader', [CO]: 'co-leader' } }), OWNER).ok, false, 'nobody else in it yet');
    assert.equal(check(null, Object.assign({}, fresh, { clanXp: 1e9 }), OWNER).ok, false, 'starting at level 1');
});

test('joining and leaving: only your own entry, as a plain member, with your real sign-in', () => {
    const c = clan();
    const join = (uid, role, acct) => edit(c, n => { n.roles[uid] = role; n.names[uid] = 'Newbie'; if (acct) n.acct[uid] = true; n.members.push('Newbie'); });
    assert.deepEqual(check(c, join(OUT, 'member', true), OUT), { ok: true, action: 'join' });
    assert.deepEqual(check(c, join(OUT, 'member', false), OUT, false), { ok: true, action: 'join' }, 'anonymous players can be members');
    assert.equal(check(c, join(OUT, 'co-leader', true), OUT).ok, false, 'not straight in as co-leader');
    assert.equal(check(c, join(OUT, 'member', true), OUT, false).reason, 'acct', 'claiming an account you are not signed in to');
    assert.equal(check(c, join('uidSomeone', 'member', true), OUT).ok, false, 'not adding someone else');
    assert.equal(check(clan({ maxMembers: 5 }), edit(clan({ maxMembers: 5 }), n => { n.roles[OUT] = 'member'; n.names[OUT] = 'X'; n.acct[OUT] = true; }), OUT).reason, 'full');
    const leave = edit(c, n => { delete n.roles[MEM]; delete n.names[MEM]; delete n.acct[MEM]; n.members = n.members.filter(x => x !== 'Mia'); });
    assert.deepEqual(check(c, leave, MEM), { ok: true, action: 'leave' });
    assert.equal(check(c, edit(c, n => { delete n.roles[OWNER]; }), OWNER).ok, false, 'the owner hands it over first');
});

test('kicking: only someone of a lower rank, never the owner, and only by a member', () => {
    const c = clan();
    const kick = (uid, who) => by(edit(c, n => { delete n.roles[uid]; delete n.names[uid]; delete n.acct[uid]; n.kicks[uid] = { reason: 'bye', at: 1 }; }), who, uid, 'kick');
    assert.deepEqual(check(c, kick(MEM, CO), CO), { ok: true, action: 'kick' });
    assert.deepEqual(check(c, kick(ELDER, OWNER), OWNER), { ok: true, action: 'kick' });
    assert.equal(check(c, kick(CO, ELDER), ELDER).reason, 'rank', 'an elder cannot kick a co-leader');
    assert.equal(check(c, kick(MEM, ANON), ANON).reason, 'rank', 'a member cannot kick a member');
    assert.equal(check(c, kick(OWNER, CO), CO).ok, false, 'nobody kicks the owner');
    assert.equal(check(c, kick(MEM, OUT), OUT).reason, 'member', 'an outsider cannot kick anyone');
    assert.equal(check(c, kick(MEM, OWNER), CO).reason, 'act', 'the act names who wrote it');
    assert.equal(check(c, by(kick(MEM, CO), CO, ANON, 'kick'), CO).reason, 'act', 'and who was kicked');
    assert.equal(check(c, edit(c, n => { delete n.roles[MEM]; delete n.roles[ANON]; }), CO).ok, false, 'one at a time');
});

test('roles: up to just below your own, co-leaders need an account, nobody makes themselves anything', () => {
    const c = clan();
    const set = (uid, role, who) => by(edit(c, n => { n.roles[uid] = role; }), who, uid, 'role');
    assert.deepEqual(check(c, set(MEM, 'elder', CO), CO), { ok: true, action: 'role' });
    assert.deepEqual(check(c, set(MEM, 'co-leader', OWNER), OWNER), { ok: true, action: 'role' });
    assert.equal(check(c, set(ANON, 'co-leader', OWNER), OWNER).reason, 'account', 'an anonymous member cannot be co-leader');
    assert.equal(check(c, set(MEM, 'co-leader', CO), CO).reason, 'rank', 'a co-leader cannot make co-leaders');
    assert.equal(check(c, set(ELDER, 'member', ELDER), ELDER).ok, false, 'an elder demoting themselves is not a role change they may make');
    assert.equal(check(c, set(MEM, 'co-leader', MEM), MEM).ok, false, 'promoting yourself');
    assert.equal(check(c, set(MEM, 'leader', OWNER), OWNER).reason, 'shape', 'leadership moves by handing the clan over');
    assert.equal(check(c, set(CO, 'member', ELDER), ELDER).reason, 'rank', 'demoting someone above you');
    assert.equal(check(c, edit(c, n => { n.roles[MEM] = 'elder'; }), CO).reason, 'act', 'a role change names itself');
});

test('handing the clan over: the owner only, to a member with an account, who becomes leader', () => {
    const c = clan();
    const to = (uid) => edit(c, n => { n.ownerUid = uid; n.owner = n.names[uid]; n.roles[uid] = 'leader'; n.roles[OWNER] = 'co-leader'; });
    assert.deepEqual(check(c, to(CO), OWNER), { ok: true, action: 'transfer' });
    assert.equal(check(c, to(ANON), OWNER).reason, 'target', 'not to an anonymous member');
    assert.equal(check(c, to(CO), CO).reason, 'owner', 'a co-leader cannot take it');
    assert.equal(check(c, edit(c, n => { n.ownerUid = OUT; n.roles[OUT] = 'leader'; }), OUT).ok, false, 'an outsider cannot take it');
});

test('managing: renaming is the leader\'s, the description and icon co-leaders\', progress any member\'s', () => {
    const c = clan();
    assert.deepEqual(check(c, edit(c, n => { n.name = 'Renamed'; }), OWNER), { ok: true, action: 'rename' });
    assert.equal(check(c, edit(c, n => { n.name = 'Renamed'; }), CO).reason, 'rank');
    assert.deepEqual(check(c, edit(c, n => { n.description = 'hi'; }), CO), { ok: true, action: 'manage' });
    assert.equal(check(c, edit(c, n => { n.description = 'hi'; }), ELDER).reason, 'rank');
    assert.deepEqual(check(c, edit(c, n => { n.clanXp = 150; n.checkin = { day: 'x', names: ['Mia'] }; }), MEM), { ok: true, action: 'progress' });
    assert.equal(check(c, edit(c, n => { n.clanXp = 150; }), OUT).reason, 'member', 'not an outsider');
    assert.equal(check(c, edit(c, n => { n.owner = 'Mia'; n.members = []; }), MEM).reason, 'field', 'the old fields on their own: no');
    assert.equal(check(c, edit(c, n => { n.ownerUidX = 1; }), MEM).reason, 'field', 'nor anything made up');
    for (const f of R.MEMBER_FIELDS) assert.equal(check(c, edit(c, n => { n[f] = { x: 1 }; }), ANON).ok, true, f + ' is shared progress');
    assert.deepEqual(check(c, null, OWNER), { ok: true, action: 'delete' });
    assert.equal(check(c, null, CO).reason, 'owner');
});

test('a clan from before: its owner claims it with an account; until then only progress and re-joining', () => {
    const old = { name: 'Old', owner: 'Olive', members: ['Olive', 'Mia'], leaders: ['Olive'], clanXp: 500, maxMembers: 30 };
    const claim = (uid, name) => edit(old, n => { n.ownerUid = uid; n.roles = { [uid]: 'leader' }; n.names = { [uid]: name }; n.acct = { [uid]: true }; });
    assert.deepEqual(check(old, claim(OWNER, 'Olive'), OWNER), { ok: true, action: 'claim' });
    assert.equal(check(old, claim(OWNER, 'Olive'), OWNER, false).reason, 'account');
    assert.equal(check(old, claim(OUT, 'Mallory'), OUT).reason, 'owner', 'only under the old owner\'s name');
    assert.equal(check(old, edit(claim(OWNER, 'Olive'), n => { n.clanXp = 1e9; }), OWNER).ok, false, 'a claim changes nothing else');
    assert.deepEqual(check(old, edit(old, n => { n.roles = { [MEM]: 'member' }; n.names = { [MEM]: 'Mia' }; n.acct = { [MEM]: true }; }), MEM), { ok: true, action: 'join' });
    assert.deepEqual(check(old, edit(old, n => { n.clanXp = 600; }), MEM), { ok: true, action: 'progress' });
    assert.equal(check(old, edit(old, n => { n.description = 'pwned'; }), MEM).reason, 'unclaimed');
    assert.equal(check(old, edit(old, n => { n.owner = 'Mallory'; }), OUT).reason, 'unclaimed', 'the old way of taking a clan is gone');
    assert.equal(check(old, edit(old, n => { n.members = []; }), OUT).reason, 'unclaimed', 'and so is emptying it');
    assert.equal(R.claimed(old), false);
    assert.equal(R.claimed(claim(OWNER, 'Olive')), true);
});
