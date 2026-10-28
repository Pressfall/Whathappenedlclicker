'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const S = require('../core/world-craft-score');
const W = require('../core/world-logic');

const seq = (vals) => { let i = 0; return () => vals[i++ % vals.length]; };

test('forge: perfect play scores 100 and the worst scores 0', () => {
    const cfg = S.difficulty('forge', 3);
    const strikes = Array.from({ length: cfg.strikes }, (_, i) => S.strikeScore(0, i, 0.8, cfg));
    const H = S.heatScore(4, 0, 4), M = S.hammerScore(strikes), Q = S.quenchScore(0, cfg.quenchWindow);
    assert.equal(S.forgeScore(H, M, Q), 100);
    const bad = Array.from({ length: cfg.strikes }, (_, i) => S.strikeScore(1, i, 3, cfg));
    assert.equal(S.forgeScore(S.heatScore(0, 0, 4), S.hammerScore(bad), S.quenchScore(1, cfg.quenchWindow)), 0);
});

test('forge: strikes score by zone, the zones shrink every strike, and waiting cools the metal', () => {
    const cfg = S.difficulty('forge', 1);
    assert.equal(S.strikeScore(0.05, 0, 0.5, cfg), 100);
    assert.equal(S.strikeScore(cfg.zones.g, 0, 0.5, cfg), 60);
    assert.equal(S.strikeScore(cfg.zones.o, 0, 0.5, cfg), 0);
    assert.ok(S.strikeScore(0.059, 8, 0.5, cfg) < 100, 'the perfect zone is smaller by the 9th strike');
    assert.equal(S.strikeScore(0, 0, 2.5, cfg), 90);
    assert.ok(S.difficulty('forge', 6).strikes > S.difficulty('forge', 1).strikes);
    assert.ok(S.difficulty('forge', 6).heatHalf < S.difficulty('forge', 1).heatHalf);
});

test('forge: the bellows needle rises while held and falls when let go', () => {
    const h = { v: 0, x: 0.3 };
    for (let i = 0; i < 60; i++) S.heatStep(h, true, 1 / 60);
    assert.ok(h.x > 0.45);
    const top = h.x;
    for (let i = 0; i < 120; i++) S.heatStep(h, false, 1 / 60);
    assert.ok(h.x < top);
    const cfg = S.difficulty('forge', 1);
    assert.ok(Math.abs(S.heatBand(0, cfg) - 0.62) < 1e-9);
});

test('a better input always scores at least as well, and higher tiers are harder for the same input', () => {
    for (let T = 1; T <= 6; T++) {
        const cfg = S.difficulty('forge', T);
        let prev = 101;
        for (let off = 0; off <= 1; off += 0.02) { const s = S.strikeScore(off, 0, 1, cfg); assert.ok(s <= prev); prev = s; }
    }
    const lo = S.difficulty('forge', 1), hi = S.difficulty('forge', 6);
    assert.ok(S.strikeScore(0.1, 3, 1, hi) < S.strikeScore(0.1, 3, 1, lo));
    assert.ok(S.quenchScore(0.1, hi.quenchWindow) < S.quenchScore(0.1, lo.quenchWindow));
    assert.ok(S.difficulty('workbench', 6).tol < S.difficulty('workbench', 1).tol);
    assert.ok(S.difficulty('altar', 6).period < S.difficulty('altar', 1).period);
});

test('workbench: tracing the path exactly scores 100; it cannot be skipped and slips cost points', () => {
    const path = S.makePath([{ x: 40, y: 100 }, { x: 200, y: 60 }, { x: 360, y: 140 }, { x: 520, y: 80 }]);
    const exact = S.createTracer(path, 10);
    for (const p of path.pts) exact.update(p.x, p.y);
    assert.equal(exact.done, true);
    assert.ok(exact.accuracy() > 0.999);
    const ref = path.length / 320;
    assert.equal(Math.round(S.carveScore({ accuracy: exact.accuracy(), coverage: exact.coverage(), time: ref, length: path.length, slips: 0 })), 100);
    // jumping straight to the end does nothing
    const cheat = S.createTracer(path, 10);
    cheat.update(path.pts[0].x, path.pts[0].y);
    cheat.update(path.pts[path.pts.length - 1].x, path.pts[path.pts.length - 1].y);
    assert.ok(cheat.coverage() < 0.15, 'coverage ' + cheat.coverage());
    // nothing counts before the start dot
    const late = S.createTracer(path, 10);
    late.update(path.pts[50].x, path.pts[50].y);
    assert.equal(late.started, false);
    // wobbling off the line lowers accuracy and adds slips
    const shaky = S.createTracer(path, 10);
    path.pts.forEach((p, i) => shaky.update(p.x, p.y + (i % 20 === 10 ? 40 : 6)));
    assert.ok(shaky.slips > 0 && shaky.accuracy() < 0.6);
    const slow = S.carveScore({ accuracy: 1, coverage: 1, time: ref * 5, length: path.length, slips: 0 });
    assert.equal(Math.round(slow), 70);
});

test('workbench: string draws score by the mark; bows mix carve and string', () => {
    assert.equal(S.stringScore(0.7, 0.7, 0.05), 100);
    assert.equal(S.stringScore(0.85, 0.7, 0.05), 0);
    assert.ok(Math.abs(S.stringScore(0.8, 0.7, 0.05) - 50) < 1e-6);
    assert.equal(S.workbenchScore(80, null), 80);
    assert.equal(S.workbenchScore(80, 40), 70);
});

test('rune altar: presses score by how close the needle was; stray presses cost points', () => {
    assert.equal(S.runePressScore(3), 100);
    assert.equal(S.runePressScore(-9), 80);
    assert.equal(S.runePressScore(15), 50);
    assert.equal(S.runePressScore(25), 0);
    assert.equal(S.runeScore([100, 100, 100], 0), 100);
    assert.equal(S.runeScore([100, 100, 100], 2), 84);
    assert.equal(S.runeScore([0, 0], 5), 0);
    const angles = S.runeAngles(seq([0.1, 0.12, 0.5, 0.52, 0.8, 0.3, 0.95, 0.65]), 5, 35);
    for (let i = 0; i < angles.length; i++) for (let j = i + 1; j < angles.length; j++) {
        const d = Math.abs(((angles[i] - angles[j] + 540) % 360) - 180);
        assert.ok(d >= 35);
    }
});

test('quality tiers have exact boundaries and the multiplier rises with every point', () => {
    const at = (s) => W.qualityOf(s).id;
    assert.equal(at(29), 'crude'); assert.equal(at(30), 'common');
    assert.equal(at(54), 'common'); assert.equal(at(55), 'fine');
    assert.equal(at(74), 'fine'); assert.equal(at(75), 'superior');
    assert.equal(at(89), 'superior'); assert.equal(at(90), 'masterwork');
    assert.equal(at(97), 'masterwork'); assert.equal(at(98), 'legendary');
    let prev = 0;
    for (let s = 0; s <= 100; s++) { const m = W.qualityMult(s); assert.ok(m > prev, 'score ' + s); prev = m; }
    assert.equal(W.qualityMult(0), 0.8);
    assert.equal(W.qualityMult(30), 1);
    assert.equal(W.qualityMult(98), 1.75);
});

test('lootbox tier shift: great scores can bump the tier, very poor ones drop it', () => {
    assert.equal(W.boxTierShift(96, () => 0.4), 1);
    assert.equal(W.boxTierShift(96, () => 0.6), 0);
    assert.equal(W.boxTierShift(88, () => 0.1), 1);
    assert.equal(W.boxTierShift(88, () => 0.3), 0);
    assert.equal(W.boxTierShift(60, () => 0), 0);
    assert.equal(W.boxTierShift(10, () => 0), -1);
});
