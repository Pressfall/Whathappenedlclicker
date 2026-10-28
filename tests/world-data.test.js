'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const D = require('../core/world-data');

const known = (id) => !!(D.MATERIALS_BY_ID[id] || D.CONSUMABLES_BY_ID[id]);

test('every recipe, drop and stock item names a real material', () => {
    const check = (ids, where) => ids.forEach(id => assert.ok(known(id), where + ': ' + id));
    for (const g of D.GEAR) if (g.recipe) check(Object.keys(g.recipe.in), g.id);
    for (const r of D.BASIC_RECIPES) { check(Object.keys(r.in), r.id); check(Object.keys(r.out), r.id); }
    for (const r of D.BOX_RECIPES) check(Object.keys(r.in), r.id);
    for (const [id, n] of Object.entries(D.NODES)) check(n.drops.map(d => d[0]), id);
    for (const [id, m] of Object.entries(D.MONSTERS)) check(m.drops.map(d => d[0]), id);
    for (const [id, b] of Object.entries(D.BOSSES)) { check(b.drops.map(d => d[0]), id); check([b.sigil], id); }
    for (const s of D.TRADER_STOCK) { if (s.give) check(Object.keys(s.give), s.id); if (s.gear) assert.ok(D.GEAR_BY_ID[s.gear], s.id); }
    for (const z of Object.values(D.ZONES)) {
        for (const t of Object.keys(z.nodes || {})) assert.ok(D.NODES[t], z.id + ' node ' + t);
        for (const [m] of z.spawns || []) assert.ok(D.MONSTERS[m], z.id + ' monster ' + m);
        if (z.elite) assert.ok(D.MONSTERS[z.elite].elite, z.id + ' elite');
        if (z.boss) assert.equal(D.BOSSES[z.boss].zone, z.id);
        if (z.gate) assert.ok(D.MATERIALS_BY_ID[z.gate], z.id + ' gate');
    }
    assert.equal(D.BOX_NAMES.length, 5, 'items.js has 5 lootbox tiers');
});

// Start with the rusty kit in Greenwood and keep doing everything currently possible. Every tier, every box and every
// zone must become reachable: no dead ends in the recipe tree.
test('progression: from the starter kit, every gear tier, lootbox and zone can be reached', () => {
    const have = new Set();
    const zones = new Set(['greenwood']);
    let pick = 1, axe = 1; // rusty tools work tier 1 nodes
    const gear = new Set([...D.STARTER_KIT, D.STARTER_OFFHAND]);
    for (const s of D.TRADER_STOCK) if (s.give) Object.keys(s.give).forEach(id => have.add(id));
    let changed = true, rounds = 0;
    while (changed && rounds++ < 50) {
        changed = false;
        const add = (id) => { if (!have.has(id)) { have.add(id); changed = true; } };
        for (const z of zones) {
            const def = D.ZONES[z];
            for (const t of Object.keys(def.nodes)) {
                const n = D.NODES[t];
                const tool = n.tool === 'hand' ? 99 : n.tool === 'axe' ? axe : pick;
                if (tool >= n.tier) { n.drops.forEach(d => add(d[0])); if (n.rubies) add('rubies'); }
            }
            for (const [m] of def.spawns) D.MONSTERS[m].drops.forEach(d => add(d[0]));
            D.MONSTERS[def.elite].drops.forEach(d => add(d[0]));
            const b = D.BOSSES[def.boss];
            b.drops.forEach(d => add(d[0])); add(b.sigil);
        }
        for (const z of D.ZONE_ORDER) { const g = D.ZONES[z].gate; if (!zones.has(z) && (!g || have.has(g))) { zones.add(z); changed = true; } }
        for (const r of D.BASIC_RECIPES) if (Object.keys(r.in).every(id => have.has(id))) Object.keys(r.out).forEach(add);
        for (const g of D.GEAR) {
            if (!g.recipe || gear.has(g.id) || !Object.keys(g.recipe.in).every(id => have.has(id))) continue;
            gear.add(g.id); changed = true;
            if (g.cls === 'pickaxe') pick = Math.max(pick, g.tool);
            if (g.cls === 'axe') axe = Math.max(axe, g.tool);
        }
    }
    const unreachable = D.GEAR.filter(g => !gear.has(g.id)).map(g => g.id);
    assert.deepEqual(unreachable, []);
    for (const r of D.BOX_RECIPES) assert.ok(Object.keys(r.in).every(id => have.has(id)), r.id);
    assert.deepEqual([...zones].sort(), [...D.ZONE_ORDER].sort());
});

test('each gear tier is stronger than the last, and quality tiers line up with items.js rarity colours', () => {
    for (const cls of ['sword', 'axe', 'pickaxe', 'spear', 'bow', 'dagger']) {
        const list = D.GEAR.filter(g => g.cls === cls).sort((a, b) => a.tier - b.tier);
        for (let i = 1; i < list.length; i++) assert.ok(list[i].dmg > list[i - 1].dmg, cls);
    }
    for (const slot of ['helmet', 'chest', 'boots']) {
        const list = D.GEAR.filter(g => g.slot === slot).sort((a, b) => a.tier - b.tier);
        for (let i = 1; i < list.length; i++) assert.ok(list[i].armor > list[i - 1].armor, slot);
    }
    assert.deepEqual(D.QUALITY.map(q => q.min), [0, 30, 55, 75, 90, 98]);
});

test('crafted lootboxes are worth their allowance points (3 merge into the next tier)', () => {
    for (const r of D.BOX_RECIPES) assert.equal(r.pts, D.BOX_POINTS[r.tier], r.id);
    assert.ok(!D.BOX_RECIPES.some(r => r.tier === 4), 'Mythic Vaults are never crafted');
    assert.ok(D.CAPS.boxPointsPerWeek < 81, 'a week of crafting cannot merge up to a Mythic Vault');
});
