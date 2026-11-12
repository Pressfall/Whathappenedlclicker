'use strict';
// Gear for the game (core/gear.js): the boost table (the weakest about 5%, every tier better, the rarest massive), no
// repeated boosts, the crit cap, attunement, cleaning a damaged piece, and the pictures.
const test = require('node:test');
const assert = require('node:assert/strict');
const Gr = require('../core/gear');

const piece = (o) => Gr.cleanPiece(Object.assign({ id: 1, s: 'cursor', t: 0, l: [['might', 1]], c: ['#ff0000', '#00ff00'] }, o));

test('boosts: the weakest about 5%, better at every tier, the rarest massive', () => {
    assert.equal(Gr.lineValues('might', 0, 1, 0).click, 5);
    for (const col of [Gr.MAIN, Gr.CRIT, Gr.MINOR]) for (let t = 1; t < col.length; t++) assert.ok(col[t] > col[t - 1], 'tier ' + t + ' beats ' + (t - 1));
    assert.ok(Gr.MAIN[Gr.MAX_TIER] >= 20 * Gr.MAIN[0], 'Primordial is massive');
    assert.equal(Gr.TIERS.length, 7);
    for (let t = 1; t < Gr.TIERS.length; t++) assert.ok(Gr.TIERS[t].lines >= Gr.TIERS[t - 1].lines && Gr.TIERS[t].wilds > Gr.TIERS[t - 1].wilds);
    // the roll moves a boost a little either way, never past its bounds
    assert.ok(Gr.lineValues('swift', 3, Gr.ROLL.hi, 0).cps > Gr.lineValues('swift', 3, Gr.ROLL.lo, 0).cps);
    assert.equal(Gr.lineValues('swift', 3, 99, 0).cps, Gr.lineValues('swift', 3, Gr.ROLL.hi, 0).cps);
    // every aspect does something in the game
    for (const a of Gr.ASPECT_IDS) assert.ok(Object.values(Gr.lineValues(a, 2, 1, 0)).every(v => v > 0), a);
});

test('a worn set: boosts add up; never the same boost twice on a piece; crit chance is capped; attunement', () => {
    assert.deepEqual(piece({ l: [['might', 1], ['might', 1.1]], t: 2 }).l.map(l => l[0]), ['might']);
    const set = [piece({ t: 3, l: [['might', 1], ['keen', 1]] }), piece({ id: 2, s: 'crown', t: 3, l: [['swift', 1], ['ward', 1]] })];
    const b = Gr.bonuses(set);
    assert.equal(b.click, Gr.MAIN[3]);
    assert.equal(b.cps, Gr.MAIN[3]);
    assert.equal(b.offline, Gr.MAIN[3]);
    assert.equal(b.critChance, Gr.CRIT[3]);
    const crits = Array.from({ length: 5 }, (_, i) => piece({ id: i + 1, s: Gr.SLOTS[i], t: 6, l: [['keen', 1.15]] }));
    assert.equal(Gr.bonuses(crits).critChance, Gr.CRIT_CAP, 'capped');
    // three pieces with the same main aspect: +10%; five: +25%
    const might = (n) => Array.from({ length: n }, (_, i) => piece({ id: i + 1, s: Gr.SLOTS[i], t: 2, l: [['might', 1]] }));
    assert.ok(Math.abs(Gr.bonuses(might(3)).click - 3 * Gr.MAIN[2] * 1.1) < 0.2);
    assert.ok(Math.abs(Gr.bonuses(might(5)).click - 5 * Gr.MAIN[2] * 1.25) < 0.2);
    assert.deepEqual(Gr.attunement(might(5)), [{ aspect: 'might', n: 5, bonus: Gr.ATTUNE[5] }]);
    assert.deepEqual(Gr.bonuses([]), { cps: 0, click: 0, offline: 0, critChance: 0, critDmg: 0, gems: 0, boxRate: 0 });
});

test('a damaged or edited piece is cleaned: slot, tier, boosts, uniques, colours, level', () => {
    assert.equal(Gr.cleanPiece({ s: 'hat', t: 1, l: [['might', 1]] }), null, 'no such slot');
    assert.equal(Gr.cleanPiece({ s: 'ring', t: 1, l: [] }), null, 'no boosts');
    assert.equal(Gr.cleanPiece('x'), null);
    const p = Gr.cleanPiece({ id: 3, s: 'ring', t: 99, l: [['might', 5], ['swift', 0], ['x', 1], ['ward', 1], ['keen', 1], ['vigor', 1], ['frost', 1]], c: ['blue', '#00FF00'], q: 'golden_pointer', by: '<b>Eve</b>', n: -1, lv: 42 });
    assert.equal(p.t, Gr.MAX_TIER);
    assert.equal(p.l.length, Gr.TIERS[Gr.MAX_TIER].lines);
    assert.deepEqual(p.l[0], ['might', Gr.ROLL.hi]);
    assert.deepEqual(p.l[1], ['swift', Gr.ROLL.lo]);
    assert.equal(p.q, '', 'the Golden Pointer is a cursor, not a ring');
    assert.deepEqual(p.c, [Gr.TIERS[Gr.MAX_TIER].color, Gr.TIERS[Gr.MAX_TIER].color]);
    assert.equal(p.by, 'bEve/b');
    assert.equal(p.n, 0);
    assert.equal(p.lv, Gr.MAX_LEVEL);
    const u = Gr.cleanPiece({ s: 'cursor', t: 4, l: [['might', 1], ['keen', 1], ['swift', 1], ['ward', 1]], q: 'golden_pointer' });
    assert.equal(u.q, 'golden_pointer');
    assert.equal(u.l.length, Gr.TIERS[4].lines + 1, 'a unique carries one boost more');
    assert.equal(Gr.pieceName(u), 'The Golden Pointer');
    assert.equal(Gr.pieceName(piece({ t: 2, l: [['swift', 1]] })), 'Rare Swift Cursor');
});

test('pictures: every slot and unique has a shape; colours and the tier\'s edge are in it; nothing unsafe gets in', () => {
    for (const sl of Gr.SLOTS) assert.ok(Gr.SHAPES[Gr.BASE_SHAPE[sl]], sl);
    for (const t of Gr.TIERS) assert.ok(Gr.OUTLINES[t.outline], t.id);
    const svg = Gr.pieceSvg(piece({ t: 6, l: [['might', 1]] }));
    assert.match(svg, /^<svg[^>]*viewBox="0 0 64 64"/);
    assert.ok(svg.includes('#ff0000') && svg.includes('#00ff00'), 'the essences\' colours');
    assert.ok(svg.includes('animateTransform'), 'Primordial shimmers');
    assert.ok(!/script|onload|javascript/i.test(Gr.iconSvg({ shape: '<script>', main: '"><script>', trim: 'x', tier: 2, uid: '"><x' })), 'nothing from outside goes in as it is');
    const a = Gr.iconSvg({ shape: 'flamberge', tier: 4, outline: 'flames', main: '#ff7b3a', trim: '#ffe14d', uid: 'a' });
    assert.ok(a.includes(Gr.SHAPES.flamberge) && a.includes('#ff7b3a'), 'a unique\'s own shape and outline');
});
