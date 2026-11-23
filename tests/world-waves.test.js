'use strict';
// The Proving Grounds: co-op waves that every page builds the same way, harder with more players, paid per wave
const test = require('node:test');
const assert = require('node:assert/strict');
const D = require('../core/world-data');
const Wv = require('../core/world-waves');
const W = require('../core/world-logic');
const A = require('../core/world-arena');

const NOW = new Date(2026, 10, 3, 12, 0, 0).getTime();

test('every page builds the same wave from the same seed, wave and player count', () => {
    const a = Wv.composition(12345, 7, 3), b = Wv.composition(12345, 7, 3);
    assert.deepEqual(a, b);
    assert.notDeepEqual(Wv.composition(12346, 7, 3).map(m => m.type + m.gate), a.map(m => m.type + m.gate), 'another seed, another wave');
    const ids = a.map(m => m.mid);
    assert.equal(new Set(ids).size, ids.length, 'ids are unique');
    for (const m of Wv.composition(1, 999, 8)) assert.ok(/^w\d{1,3}_\d{1,3}$/.test(m.mid) && m.mid.length <= 8, m.mid + ' fits the database rule');
    for (const m of a) assert.ok(D.MONSTERS[m.type] && m.gate >= 0 && m.gate < 6 && m.delay >= 0, m.mid);
});

test('waves march through the zones, five each, with elites every fifth and a champion every tenth', () => {
    assert.equal(Wv.zoneFor(1), 'greenwood');
    assert.equal(Wv.zoneFor(6), 'mines');
    assert.equal(Wv.zoneFor(36), 'sky');
    assert.equal(Wv.zoneFor(41), 'arcade');
    assert.equal(Wv.zoneFor(400), D.ZONE_ORDER[D.ZONE_ORDER.length - 1]);
    const w4 = Wv.composition(1, 4, 1), w5 = Wv.composition(1, 5, 1), w10 = Wv.composition(1, 10, 1);
    assert.ok(w4.every(m => !m.elite));
    assert.ok(w5.some(m => m.elite) && !w5.some(m => m.champion));
    assert.equal(w10.filter(m => m.champion).length, 1);
    for (const m of Wv.composition(1, 7, 1)) assert.ok(D.ZONES.mines.spawns.some(([id]) => id === m.type) || m.type === D.ZONES.mines.elite, m.type + ' is a Mines monster');
    assert.ok(w10.length > w4.length);
});

test('more players: more monsters, and each one tougher', () => {
    const solo = Wv.composition(9, 8, 1), four = Wv.composition(9, 8, 4);
    assert.ok(four.length >= Math.round(solo.length * (1 + Wv.SCALE.count * 3)) - 1, four.length + ' vs ' + solo.length);
    assert.ok(four[0].hpMult > solo[0].hpMult * 1.8 && four[0].dmgMult > solo[0].dmgMult);
    assert.equal(Wv.composition(9, 8, 99).length, Wv.composition(9, 8, Wv.RATE.maxPlayers).length, 'capped');
});

test('a run always starts at wave 1, however far anyone got before', () => {
    assert.equal(Wv.startWave(), 1);
    assert.equal(Wv.startWave([12, 17]), 1);
    assert.equal(Wv.startWave([25]), 1);
});

test('the snapshot goes there and back, and never grows past the database limit', () => {
    const list = Array.from({ length: 40 }, (_, i) => ({ mid: 'w12_' + i, x: 1000 + i, y: 2000 - i, fa: 1.23, as: i, ai: i % 3, tx: 1500, ty: 1600 }));
    const s = Wv.packSnap(list);
    assert.ok(s.length <= Wv.RATE.maxSnap);
    const back = Wv.unpackSnap(s);
    assert.ok(back.size >= Wv.WAVES.maxAlive, 'room for every monster alive at once');
    assert.deepEqual(back.get('w12_3'), { mid: 'w12_3', x: 1003, y: 1997, fa: 1.2, as: 3, ai: 0, tx: 1500, ty: 1600 });
    assert.equal(Wv.unpackSnap('junk;w1_1,a,b,c,d,e,f,g;' + 'x'.repeat(5000)).size, 0);
});

test('the shared run: cleaned on arrival, and replaceable once nobody is playing it', () => {
    const r = Wv.sanitizeRun({ gen: 'abc12345', seed: 5, start: 1, wave: 3, st: 'fight', n: 2, at: NOW, t: NOW, m: { w3_0: 50, bad: 9 }, x: { e1: { from: 'u', mid: 'w3_0', st: 9, t: 1 } }, h: { u: 'uidA', n: 4, s: 'w3_0,1,2,3,4,0,5,6' } });
    assert.deepEqual(r.m, { w3_0: 50 });
    assert.equal(r.x[0].st, 3, 'stuns are capped');
    assert.equal(Wv.sanitizeRun({ gen: '' }), null);
    assert.equal(Wv.sanitizeRun({ gen: 'x', st: 'party' }).st, 'over');
    assert.equal(Wv.runNeedsReset(null, NOW), true);
    assert.equal(Wv.runNeedsReset(r, NOW + 1000), false);
    assert.equal(Wv.runNeedsReset(r, NOW + Wv.RATE.idleResetSec * 1000 + 1), true);
    assert.equal(Wv.runNeedsReset(Object.assign({}, r, { st: 'over' }), NOW + Wv.RATE.overResetSec * 1000 + 1), true);
    assert.equal(Wv.hostOf(['uidC', 'uidA', 'uidB']), 'uidA');
});

test('a cleared wave leaves no monsters behind on pages that do not run it', () => {
    // the host kills the last monsters and ends the wave in the same step, so a follower's last snapshot still has them
    const mids = ['w3_0', 'w3_1', 'w3_7'];
    for (const st of ['break', 'over', 'ready']) assert.deepEqual(Wv.staleMids({ st, wave: 3 }, mids), mids, st + ': every one of them goes');
    assert.deepEqual(Wv.staleMids(null, mids), mids, 'no run: none belong');
    assert.deepEqual(Wv.staleMids({ st: 'fight', wave: 3 }, mids), [], 'the wave being fought keeps its monsters');
    // a new wave: anything left from an earlier one goes, and ids that only start alike are not mixed up
    assert.deepEqual(Wv.staleMids({ st: 'fight', wave: 4 }, ['w3_0', 'w4_0', 'w4_12']), ['w3_0']);
    assert.deepEqual(Wv.staleMids({ st: 'fight', wave: 1 }, ['w1_0', 'w10_0', 'w12_3']), ['w10_0', 'w12_3']);
    assert.deepEqual(Wv.staleMids({ st: 'fight', wave: 2 }, []), []);
});

test('who runs the waves: the lowest id; a quiet one is passed over, and the next if it is quiet too', () => {
    const uids = ['uidC', 'uidA', 'uidB'], Q = Wv.RATE.hostQuietMs;
    // every page agrees while the lowest is sending
    for (const me of uids) assert.equal(Wv.hostAmong(uids, me, { uidA: 100, uidB: 100, uidC: 100 }), 'uidA', me);
    // the lowest never hears its own snapshots: it still runs them (the bug this replaced: it stepped down)
    assert.equal(Wv.hostAmong(uids, 'uidA', { uidB: 9999, uidC: 9999 }), 'uidA');
    assert.equal(Wv.hostAmong(uids, 'uidB', { uidA: Q }), 'uidA', 'not before the host has been quiet long enough');
    assert.equal(Wv.hostAmong(uids, 'uidB', { uidA: Q + 1 }), 'uidB', 'A went quiet: B takes over');
    assert.equal(Wv.hostAmong(uids, 'uidC', { uidA: Q + 1, uidB: 100 }), 'uidB', 'and C agrees once B sends');
    assert.equal(Wv.hostAmong(uids, 'uidC', { uidA: Q * 3, uidB: Q * 2 }), 'uidC', 'both quiet (menus open): C');
    assert.equal(Wv.hostAmong(uids, 'uidB', { uidA: 100, uidC: 100 }), 'uidA', 'A is back: B steps down');
    assert.equal(Wv.hostAmong([], 'x', {}), null);
});

test('the snapshot and damage go fast during a fight and slow between waves', () => {
    const R = Wv.RATE;
    assert.equal(Wv.hostRate('fight'), R.hostHz);
    assert.ok(Wv.hostRate('break') < Wv.hostRate('fight') && Wv.hostRate('ready') === Wv.hostRate('break'));
    // the idle snapshot is still the host's heartbeat: it must come more often than a host counts as quiet
    assert.ok(1000 / Wv.hostRate('break') < R.hostQuietMs);
    assert.ok(Wv.flushRate('fight') < Wv.flushRate('break'));
    assert.ok(R.touchSec * 1000 < R.idleResetSec * 1000, 'a long fight is refreshed before it could look idle');
});

test('clearing a wave pays rubies and Glory (capped daily), with a one-time bonus at the milestones', () => {
    const s = W.freshState(NOW);
    const r9 = W.waveCleared(s, 9, NOW);
    assert.equal(r9.milestone, 0);
    assert.ok(r9.rubies > 0 && r9.glory > 0);
    const r10 = W.waveCleared(s, 10, NOW);
    assert.equal(r10.milestone, 10);
    assert.ok(r10.rubies > r9.rubies + 900, 'the milestone pays well');
    assert.equal(s.arena.waveBest, 10);
    const again = W.waveCleared(s, 10, NOW);
    assert.equal(again.milestone, 0, 'only the first time');
    for (let i = 0; i < 200; i++) W.waveCleared(s, 3, NOW);
    assert.equal(s.arena.day.waves, A.GLORY.cap.waves, 'the day\'s cap');
    // the Varro quests count waves
    s.quests.varro = { step: 0, active: null, dailyDone: '' };
    W.acceptQuest(s, 'varro', NOW);
    for (let i = 0; i < 3; i++) W.waveCleared(s, 1, NOW);
    assert.equal(W.questProgress(s, 'varro').done, true);
});
