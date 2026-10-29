'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const D = require('../core/world-data');
const W = require('../core/world-logic');

const NOW = new Date(2026, 9, 28, 12, 0, 0).getTime();
const DAY = 24 * 3600 * 1000;
const KINDS = ['kill', 'boss', 'rival', 'harvest', 'craft', 'box', 'deliver', 'visit', 'god'];

test('every quest giver has a story and daily quests (wanderers only talk), and every quest asks for things that exist', () => {
    const seen = new Set();
    for (const id of D.NPC_ORDER) {
        const npc = D.NPCS[id];
        assert.ok(npc.name && npc.role && npc.greet && npc.face && D.ZONES[npc.zone], id);
        if (npc.lines) { assert.ok(npc.lines.length >= 3 && !npc.chain.length && !npc.daily.length, id + ' only talks'); continue; }
        assert.ok(npc.chain.length >= (npc.zone === 'town' ? 6 : 3) && npc.daily.length >= 1, id);
        // out in a zone, that zone is open: you are standing in it
        assert.ok(npc.daily.some(q => !D.QUESTS[q].need || D.QUESTS[q].need.zone === npc.zone), id + ' always has a daily quest on offer');
        let zone = -1;
        for (const q of npc.chain) {
            assert.ok(!D.QUESTS[q].daily, q + ' is a story quest');
            if (!D.QUESTS[q].need) continue; // the quests before it already got you this far
            const need = D.ZONE_ORDER.indexOf(D.QUESTS[q].need.zone);
            assert.ok(need >= zone, q + ' needs an earlier zone than a quest before it');
            zone = need;
        }
        for (const q of npc.daily) assert.ok(D.QUESTS[q].daily, q + ' is a daily quest');
        for (const q of npc.chain.concat(npc.daily)) { assert.ok(!seen.has(q), q + ' belongs to two people'); seen.add(q); }
    }
    assert.equal(seen.size, Object.keys(D.QUESTS).length, 'no quest without a giver');
    for (const [id, q] of Object.entries(D.QUESTS)) {
        const g = q.goal;
        assert.ok(q.title && q.text && q.rubies > 0 && q.id === id && D.NPCS[q.npc], id);
        assert.ok(KINDS.includes(g.kind), id + ' kind ' + g.kind);
        if (g.kind !== 'deliver' && g.kind !== 'visit') assert.ok(g.n >= 1, id + ' counts something');
        if (g.monster) assert.ok(D.MONSTERS[g.monster] && !D.MONSTERS[g.monster].dummy, id);
        if (g.boss) assert.ok(D.BOSSES[g.boss], id);
        if (g.zone) assert.ok(D.ZONES[g.zone], id);
        if (g.mats) for (const m in g.mats) assert.ok(D.MATERIALS_BY_ID[m] && g.mats[m] > 0, id + ' ' + m);
        if (q.need) assert.ok(D.ZONE_ORDER.includes(q.need.zone), id);
        if (q.cons) for (const c in q.cons) assert.ok(D.CONSUMABLES_BY_ID[c], id + ' ' + c);
    }
});

test('a story quest: offered, accepted, counted, handed in for rubies; then the next one', () => {
    const s = W.freshState(NOW);
    const o = W.questOffer(s, 'brannoc', NOW);
    assert.equal(o.id, 'brannoc_slimes');
    assert.equal(o.active, undefined);
    W.monsterLoot(s, 'slime', () => 0.99, NOW, { zone: 'greenwood' });
    assert.deepEqual(W.activeQuests(s), [], 'nothing counts before you accept');
    assert.deepEqual(W.acceptQuest(s, 'brannoc', NOW), { ok: true, id: 'brannoc_slimes' });
    assert.equal(W.acceptQuest(s, 'brannoc', NOW).reason, 'active');
    W.monsterLoot(s, 'boar', () => 0.99, NOW, { zone: 'greenwood' });
    for (let i = 0; i < 5; i++) W.monsterLoot(s, 'slime', () => 0.99, NOW, { zone: 'greenwood' });
    assert.deepEqual(W.questProgress(s, 'brannoc'), { have: 5, need: 6, done: false }, 'only slimes count');
    assert.equal(W.turnInQuest(s, 'brannoc', NOW).reason, 'unfinished');
    W.monsterLoot(s, 'slime', () => 0.99, NOW, { zone: 'greenwood' });
    W.monsterLoot(s, 'slime', () => 0.99, NOW, { zone: 'greenwood' });
    assert.deepEqual(W.questProgress(s, 'brannoc'), { have: 6, need: 6, done: true }, 'progress stops at the goal');
    const rubies = s.rubies;
    assert.deepEqual(W.turnInQuest(s, 'brannoc', NOW), { ok: true, id: 'brannoc_slimes', rubies: 60, cons: null });
    assert.equal(s.rubies, rubies + 60);
    assert.equal(s.stats.questsDone, 1);
    assert.equal(W.questOffer(s, 'brannoc', NOW).id, 'brannoc_boars');
    // the next one gives potions too
    W.acceptQuest(s, 'brannoc', NOW);
    for (let i = 0; i < 5; i++) W.monsterLoot(s, 'boar', () => 0.99, NOW, { zone: 'greenwood' });
    const pots = s.cons.potion_small;
    assert.ok(W.turnInQuest(s, 'brannoc', NOW).ok);
    assert.equal(s.cons.potion_small, pots + 2);
    assert.deepEqual(W.validate(s), []);
});

test('deliveries count what you carry and take it when you hand in; quests further out wait for their zone', () => {
    const s = W.freshState(NOW);
    s.quests.marla = { step: 1, active: null, dailyDone: '' };
    W.acceptQuest(s, 'marla', NOW);
    W.give(s, 'copper_ore', 4, false); W.give(s, 'coal', 9, true);
    assert.deepEqual(W.questProgress(s, 'marla'), { have: 8, need: 10, done: false });
    W.give(s, 'copper_ore', 3, false);
    assert.ok(W.questProgress(s, 'marla').done);
    assert.ok(W.turnInQuest(s, 'marla', NOW).ok);
    assert.equal(W.count(s, 'copper_ore'), 1);
    assert.equal(W.count(s, 'coal'), 5);
    const o = W.questOffer(s, 'marla', NOW);
    assert.equal(o.id, 'marla_mines');
    assert.deepEqual(o.locked, { zone: 'mines' });
    assert.equal(W.acceptQuest(s, 'marla', NOW).reason, 'locked');
    s.unlocked.zones.mines = true;
    assert.ok(W.acceptQuest(s, 'marla', NOW).ok);
    W.nodeLoot(s, 'iron', () => 0.99, NOW, { zone: 'greenwood' });
    W.nodeLoot(s, 'tree_oak', () => 0.99, NOW, { zone: 'mines' });
    W.nodeLoot(s, 'iron', () => 0.99, NOW, { zone: 'mines' });
    assert.equal(W.questProgress(s, 'marla').have, 1, 'only pickaxe work in the mines counts');
    assert.ok(W.abandonQuest(s, 'marla'));
    assert.equal(W.questOffer(s, 'marla', NOW).id, 'marla_mines', 'giving up keeps your place in the story');
    assert.equal(W.abandonQuest(s, 'marla'), false);
});

test('crafting, lootboxes, bosses, rivals, the Hall and the statues all count for the quests that ask', () => {
    const s = W.freshState(NOW);
    s.rubies = 99999;
    s.quests.hilde = { step: 1, active: { id: 'hilde_fine', prog: 0 }, dailyDone: '' };
    s.quests.vey = { step: 2, active: { id: 'vey_overgrown', prog: 0 }, dailyDone: '' };
    s.quests.brannoc = { step: 9, active: { id: 'daily_rival', prog: 0 }, dailyDone: '' };
    s.pendingCraft = { kind: 'gear', id: 'sword_1', mats: {}, fee: 0, at: NOW };
    W.finishCraft(s, 40, Math.random, NOW, 0);
    assert.equal(W.questProgress(s, 'hilde').have, 0, 'Common is not Fine');
    s.pendingCraft = { kind: 'gear', id: 'sword_1', mats: {}, fee: 0, at: NOW };
    W.finishCraft(s, 60, Math.random, NOW, 0);
    assert.ok(W.questProgress(s, 'hilde').done);
    W.bossLoot(s, 'gilded', () => 0.99, NOW, 0);
    assert.equal(W.questProgress(s, 'vey').have, 0, 'the wrong boss');
    W.bossLoot(s, 'overgrown', () => 0.99, NOW, 0);
    assert.ok(W.questProgress(s, 'vey').done);
    W.rivalLoot(s, 'greenwood', () => 0.99, NOW);
    assert.ok(W.questProgress(s, 'brannoc').done);
    // the Hall: going in, then raising a statue
    const t = W.freshState(NOW);
    W.acceptQuest(t, 'vey', NOW);
    W.questEvent(t, { kind: 'visit', zone: 'town' });
    assert.equal(W.questProgress(t, 'vey').done, false);
    W.questEvent(t, { kind: 'visit', zone: 'hall' });
    assert.ok(W.turnInQuest(t, 'vey', NOW).ok);
    W.acceptQuest(t, 'vey', NOW);
    t.rubies = 1000; W.give(t, 'oak_plank', 4, true); W.give(t, 'copper_bar', 2, true);
    W.upgradeGod(t, 'aurum');
    assert.ok(W.questProgress(t, 'vey').done);
});

test('after the story, one daily quest a day: the same all day, paid by how far you have got', () => {
    const s = W.freshState(NOW);
    s.quests.hilde = { step: D.NPCS.hilde.chain.length, active: null, dailyDone: '' };
    const o = W.questOffer(s, 'hilde', NOW);
    assert.ok(o.daily && D.NPCS.hilde.daily.includes(o.id));
    assert.notEqual(o.id, 'daily_iron', 'the iron one waits for the mines');
    assert.equal(W.questOffer(s, 'hilde', NOW + 3600 * 1000).id, o.id, 'the same one all day');
    const days = new Set();
    for (let d = 0; d < 20; d++) days.add(W.questOffer(s, 'hilde', NOW + d * DAY).id);
    assert.ok(days.size > 1, 'it changes from day to day');
    // finish it, then nothing more until tomorrow
    s.quests.hilde.active = { id: 'daily_craft', prog: 2 };
    const r = W.turnInQuest(s, 'hilde', NOW);
    assert.equal(r.rubies, D.QUESTS.daily_craft.rubies, 'tier 1: the base pay');
    assert.equal(s.quests.hilde.step, D.NPCS.hilde.chain.length);
    assert.deepEqual(W.questOffer(s, 'hilde', NOW), { doneToday: true });
    assert.equal(W.acceptQuest(s, 'hilde', NOW).reason, 'none');
    assert.ok(W.questOffer(s, 'hilde', NOW + DAY).daily, 'a new one tomorrow');
    s.unlocked.zones.mines = s.unlocked.zones.ember = true;
    assert.equal(W.questOffer(s, 'hilde', NOW + DAY).rubies, D.QUESTS[W.questOffer(s, 'hilde', NOW + DAY).id].rubies * 3, 'tier 3 pays three times as much');
});

test('quests survive a save; damaged quest data is cleaned', () => {
    const s = W.freshState(NOW);
    W.acceptQuest(s, 'brannoc', NOW);
    W.monsterLoot(s, 'slime', () => 0.99, NOW, {});
    const back = W.migrate(JSON.parse(W.serialize(s, NOW, 0)), NOW);
    assert.deepEqual(back.quests, s.quests);
    const bad = W.migrate({ v: 1, quests: {
        brannoc: { step: 99, active: { id: 'marla_trees', prog: 3 }, dailyDone: 7 },
        marla: { step: -2, active: { id: 'marla_trees', prog: 999 } },
        hilde: { active: { id: 'constructor' } },
        nobody: { step: 1 }, vey: 'x' } }, NOW);
    assert.deepEqual(bad.quests, {
        brannoc: { step: D.NPCS.brannoc.chain.length, active: null, dailyDone: '' },
        marla: { step: 0, active: { id: 'marla_trees', prog: 5 }, dailyDone: '' },
        hilde: { step: 0, active: null, dailyDone: '' },
    });
    assert.deepEqual(W.validate(bad), []);
    assert.deepEqual(W.migrate({ v: 1, quests: 7 }, NOW).quests, {});
});
