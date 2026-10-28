'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const D = require('../core/world-data');
const G = require('../core/world-gen');

const ZONES = Object.keys(D.ZONES);
const maps = Object.fromEntries(ZONES.map(z => [z, G.generateZone(z)]));
const tileOf = (m, p) => ({ x: Math.floor(p.x / D.TILE), y: Math.floor(p.y / D.TILE) });

test('every zone is the same for every player (fixed seed)', () => {
    for (const z of ZONES) assert.equal(G.mapHash(G.generateZone(z)), G.mapHash(maps[z]), z);
    assert.notEqual(G.mapHash(maps.greenwood), G.mapHash(maps.mines));
});

test('the entry, camp, boss arena, exit, nodes, spawns and rival can all be reached', () => {
    for (const z of ZONES) {
        const m = maps[z];
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
    assert.equal(maps.town.portals.length, D.ZONE_ORDER.length);
});

test('harder ores sit deeper in a zone than easier ones', () => {
    const m = maps.mines;
    const dist = (type) => {
        const ns = m.nodes.filter(n => n.type === type);
        return ns.reduce((a, n) => a + Math.hypot(n.x - m.entry.x, n.y - m.entry.y), 0) / ns.length;
    };
    assert.ok(dist('gold') > dist('iron'), 'gold ' + dist('gold') + ' iron ' + dist('iron'));
});
