'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const D = require('../core/world-data');
const G = require('../core/world-gen');

const ZONES = Object.keys(D.ZONES);
const maps = Object.fromEntries(ZONES.map(z => [z, G.generateZone(z)]));
// sealed lairs (the Far Reaches), opened: what a player who broke every ward walks through
const opened = Object.fromEntries(ZONES.map(z => [z, G.openLair(G.generateZone(z))]));
const tileOf = (m, p) => ({ x: Math.floor(p.x / D.TILE), y: Math.floor(p.y / D.TILE) });

test('every zone is the same for every player (fixed seed)', () => {
    for (const z of ZONES) assert.equal(G.mapHash(G.generateZone(z)), G.mapHash(maps[z]), z);
    assert.notEqual(G.mapHash(maps.greenwood), G.mapHash(maps.mines));
});

test('the entry, camp, boss arena, exit, nodes, spawns and rival can all be reached', () => {
    for (const z of ZONES) {
        const m = opened[z];
        const e = tileOf(m, m.entry);
        const seen = G.flood(m, e.x, e.y);
        const reach = (p, what) => {
            const t = tileOf(m, p);
            // the point itself, or a neighbour for things that block their own tile
            const ok = [[0, 0], [1, 0], [-1, 0], [0, 1], [0, -1]].some(([dx, dy]) => seen[(t.y + dy) * m.w + t.x + dx]);
            assert.ok(ok, z + ': ' + what + ' at ' + t.x + ',' + t.y);
        };
        if (m.camp) reach(m.camp, 'camp');
        if (m.boss) reach(m.boss, 'boss');
        if (m.exit) reach({ x: m.exit.x, y: m.exit.y - 20 }, 'exit');
        if (m.rival) reach(m.rival, 'rival');
        m.nodes.forEach(n => reach(n, n.type));
        m.spawns.forEach(p => reach(p, 'spawn'));
        m.elites.forEach(p => reach(p, 'elite'));
        for (const s of m.stations) reach(s.door, s.id + ' door');
        for (const p of m.portals) reach({ x: p.x + (p.side === 'w' ? 32 : p.side === 'e' ? -32 : 0), y: p.y + (p.side === 'n' ? 32 : p.side === 's' ? -32 : 0) }, 'portal ' + p.to);
        for (const w of m.wards || []) reach(w, 'ward ' + w.i);
        if (m.waystone) reach(m.waystone, 'waystone');
        if (m.arena) reach(m.arena.door, 'arena door');
    }
});

test('a sealed lair: the boss arena is out of reach until its wards are broken, then open; wards sit far apart', () => {
    for (const z of D.ZONE_ORDER.filter(id => D.ZONES[id].wards)) {
        const sealed = maps[z], open = opened[z];
        const e = tileOf(sealed, sealed.entry), b = tileOf(sealed, sealed.boss);
        assert.equal(G.flood(sealed, e.x, e.y)[b.y * sealed.w + b.x], 0, z + ': the arena is sealed');
        assert.equal(G.flood(open, e.x, e.y)[b.y * open.w + b.x], 1, z + ': and opens');
        assert.equal(sealed.wards.length, D.ZONES[z].wards, z + ' wards');
        for (const w of sealed.wards) assert.ok(Math.hypot(w.x - sealed.entry.x, w.y - sealed.entry.y) > 25 * D.TILE, z + ' ward ' + w.i + ' is far from the entry');
        assert.ok(G.isSolid(G.tileAt(sealed, sealed.lair.at.x, sealed.lair.at.y)) && !G.isSolid(G.tileAt(open, open.lair.at.x, open.lair.at.y)), z + ' barrier');
    }
});

test('nodes stand on open ground, have stable unique keys, and every zone has what its table asks for', () => {
    for (const z of ZONES) {
        const m = maps[z];
        const keys = new Set(m.nodes.map(n => n.key));
        assert.equal(keys.size, m.nodes.length, z);
        for (const n of m.nodes) assert.ok(!G.isSolid(G.tileAt(m, n.x, n.y)), z + ' ' + n.key);
        const def = D.ZONES[z];
        for (const type of Object.keys(def.nodes || {})) {
            const have = m.nodes.filter(n => n.type === type).length;
            assert.ok(have >= def.nodes[type] * 0.8, z + ' ' + type + ': ' + have + ' of ' + def.nodes[type]);
        }
        if (def.elites) assert.equal(m.elites.length, def.elites, z + ' elites');
    }
    assert.equal(maps.town.stations.length, Object.keys(D.STATIONS).length);
    // the first four zones have gates; the Far Reaches are reached through the Waystone
    assert.deepEqual(maps.town.portals.map(p => p.to).sort(), D.ZONE_ORDER.filter(z => !D.ZONES[z].via).sort());
    assert.ok(maps.town.waystone && D.ZONE_ORDER.filter(z => D.ZONES[z].via === 'waystone').length === 4);
});

test('harder ores sit deeper in a zone than easier ones', () => {
    const m = maps.mines;
    const dist = (type) => {
        const ns = m.nodes.filter(n => n.type === type);
        return ns.reduce((a, n) => a + Math.hypot(n.x - m.entry.x, n.y - m.entry.y), 0) / ns.length;
    };
    assert.ok(dist('gold') > dist('iron'), 'gold ' + dist('gold') + ' iron ' + dist('iron'));
});
