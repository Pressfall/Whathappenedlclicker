'use strict';
// The Far Reaches are meant to take longer than the first four zones, but to climb from Frostveil a step at a time, never
// in a cliff (2026-11-22: players found the coast, the capital and the arcade far too steep, and the zones were eased into
// one curve). These checks work it out from the tables alone, so a
// later tweak to a monster, a recipe or a node can't quietly undo it. "On-tier" gear for a zone of tier z is gear tier z + 1
// (Frostveil, tier 4, is Mithril, tier 5): a Common sword with a decent swing (80% swing speed, a 2-hit combo, worked out
// with the sword's own curve in core/world-combat.js hitDamage) and a full Common armor set.
const test = require('node:test');
const assert = require('node:assert/strict');
const D = require('../core/world-data');
const C = require('../core/world-combat');
const SWING = C.hitDamage(1, 0.8, 2, 1, D.WEAPON_CLASSES.sword).dmg;

const FAR = D.ZONE_ORDER.filter(z => D.ZONES[z].via === 'waystone');
// the zones that bring a metal of their own (the Neon Arcade has none: it is built for Starmetal, the top tier)
const METAL = FAR.filter(z => D.TIERS[D.ZONES[z].tier + 1]);
const KIT = ['sword', 'helmet', 'chest', 'boots', 'shield', 'pickaxe', 'axe'];
const ARMOR = ['helmet', 'chest', 'boots'];

function gear(zone, behind = 0) {
    // (past the isles there is no better metal: the Neon Arcade, tier 9, is built for Starmetal too, the top tier)
    const t = Math.min(D.MAX_TIER, D.ZONES[zone].tier + 1) - behind;
    return {
        hit: SWING * D.GEAR_BY_ID['sword_' + t].dmg,
        hp: 100 + 20 + ARMOR.reduce((a, s) => a + D.GEAR_BY_ID[s + '_' + t].hp, 0),
        armor: ARMOR.reduce((a, s) => a + D.GEAR_BY_ID[s + '_' + t].armor, 0),
    };
}
const hits = (m, g) => m.hp * (100 + (m.armor || 0)) / 100 / g.hit;
const share = (m, g) => m.dmg * 100 / (100 + g.armor) / g.hp;
const avg = (list, f) => list.reduce((a, x) => a + f(x), 0) / list.length;
const regulars = (z) => D.ZONES[z].spawns.map(([m]) => D.MONSTERS[m]);

// how many full sweeps of a zone's ore nodes one on-tier kit takes
function kitSweeps(zone) {
    const t = D.ZONES[zone].tier + 1, bar = D.TIERS[t].bar;
    const r = D.BASIC_RECIPES.find(x => x.out[bar]);
    const ore = Object.keys(r.in).find(k => /_ore$/.test(k));
    const orePerBar = r.in[ore] / r.out[bar];
    const need = KIT.reduce((a, c) => a + (D.GEAR_BY_ID[c + '_' + t].recipe.in[bar] || 0) * orePerBar, 0);
    let sweep = 0;
    for (const n in D.ZONES[zone].nodes) { const d = D.NODES[n].drops.find(x => x[0] === ore); if (d) sweep += D.ZONES[zone].nodes[n] * (d[1] + d[2]) / 2 * d[3]; }
    return need / sweep;
}

test('a full kit of Far Reaches gear takes several sweeps of its zone, far more than Mithril does in Frostveil', () => {
    const frost = kitSweeps('frost');
    for (const z of METAL) {
        const n = kitSweeps(z);
        assert.ok(n >= 2.5 && n >= frost * 2.5, z + ': ' + n.toFixed(2) + ' sweeps (Frostveil ' + frost.toFixed(2) + ')');
    }
});

test('Far Reaches monsters are built for their own zone\'s gear', () => {
    for (const z of FAR) {
        const g = gear(z), E = D.MONSTERS[D.ZONES[z].elite], B = D.BOSSES[D.ZONES[z].boss];
        const rh = avg(regulars(z), m => hits(m, g)), rs = avg(regulars(z), m => share(m, g));
        assert.ok(rh >= 4 && rh <= 9, z + ' regulars die in ' + rh.toFixed(1) + ' hits');
        assert.ok(rs >= 0.045 && rs <= 0.08, z + ' regulars take ' + (rs * 100).toFixed(1) + '% a hit');
        assert.ok(hits(E, g) >= 45 && hits(E, g) <= 80, z + ' elite: ' + hits(E, g).toFixed(0) + ' hits');
        assert.ok(share(E, g) >= 0.075 && share(E, g) <= 0.12, z + ' elite hits for ' + (share(E, g) * 100).toFixed(1) + '%');
        assert.ok(share(B, g) >= 0.075 && share(B, g) <= 0.12, z + ' boss hits for ' + (share(B, g) * 100).toFixed(1) + '%');
    }
});

test('they hit harder and last longer than Frostveil, and one tier behind is a wall', () => {
    const fg = gear('frost'), frostShare = avg(regulars('frost'), m => share(m, fg)), frozen = hits(D.BOSSES.frozen, fg);
    for (const z of FAR) {
        const g = gear(z), old = gear(z, 1);
        assert.ok(avg(regulars(z), m => share(m, g)) > frostShare, z + ' regulars hurt more than Frostveil\'s');
        assert.ok(hits(D.BOSSES[D.ZONES[z].boss], g) >= frozen * 1.1, z + ' boss outlasts Frozen WH');
        // with the previous zone's gear: slower to kill and much more painful
        assert.ok(avg(regulars(z), m => hits(m, old)) >= avg(regulars(z), m => hits(m, g)) * 1.35, z + ' kills slower a tier behind');
        assert.ok(avg(regulars(z), m => share(m, old)) >= avg(regulars(z), m => share(m, g)) * 1.5, z + ' hurts more a tier behind');
    }
});

// What a zone's monsters cost you, counting their packs: a pack of n is cleared one at a time while the rest keep hitting,
// so it costs hits x share x (n + (n - 1) + ... + 1). Weighted by how often each one spawns. That is the health a meeting
// takes off you if you stand and trade (dodging and blocking take it down from there), so it is only for comparing zones.
function encounterCost(z, g) {
    const sp = D.ZONES[z].spawns, total = sp.reduce((a, s) => a + s[1], 0);
    return sp.reduce((a, [id, w]) => { const m = D.MONSTERS[id], n = m.group || 1; return a + w / total * hits(m, g) * share(m, g) * n * (n + 1) / 2; }, 0);
}

test('from Frostveil on, every zone is a step up from the last, never a cliff', () => {
    const LATE = D.ZONE_ORDER.slice(D.ZONE_ORDER.indexOf('frost'));
    for (let i = 1; i < LATE.length; i++) {
        const z = LATE[i], was = LATE[i - 1], g = gear(z), pg = gear(was);
        const step = encounterCost(z, g) / encounterCost(was, pg);
        assert.ok(step <= 1.3, z + ': its monsters cost ' + step.toFixed(2) + 'x those of ' + was + ', each with its own gear');
        const E = D.MONSTERS[D.ZONES[z].elite], pE = D.MONSTERS[D.ZONES[was].elite], B = D.BOSSES[D.ZONES[z].boss], pB = D.BOSSES[D.ZONES[was].boss];
        const eStep = hits(E, g) / hits(pE, pg), bStep = hits(B, g) / hits(pB, pg);
        assert.ok(eStep >= 1 && eStep <= 1.2, z + ' elite: ' + eStep.toFixed(2) + 'x as long as ' + was + '\'s');
        assert.ok(bStep >= 1 && bStep <= 1.25, z + ' boss: ' + bStep.toFixed(2) + 'x as long as ' + was + '\'s');
        // and none of them knocks you out in fewer hits than the zone before's did, less one
        assert.ok(1 / share(E, g) >= 1 / share(pE, pg) - 1.5, z + ' elite knocks you out in ' + (1 / share(E, g)).toFixed(1) + ' hits');
        assert.ok(1 / share(B, g) >= 1 / share(pB, pg) - 1.5, z + ' boss knocks you out in ' + (1 / share(B, g)).toFixed(1) + ' hits');
    }
    // the Neon Arcade, with no better metal than the isles, is still a step harder for Starmetal gear
    assert.ok(encounterCost('arcade', gear('arcade')) > encounterCost('sky', gear('sky')), 'the arcade is harder than the isles');
});

test('each zone\'s best ore needs the pickaxe from the zone before it', () => {
    for (const z of METAL) {
        const t = D.ZONES[z].tier + 1, r = D.BASIC_RECIPES.find(x => x.out[D.TIERS[t].bar]);
        const ore = Object.keys(r.in).find(k => /_ore$/.test(k));
        const node = Object.keys(D.ZONES[z].nodes).map(n => D.NODES[n]).find(n => n.drops.some(d => d[0] === ore));
        assert.equal(node.tier, t, z + ' ore needs tool tier ' + t);
        assert.equal(D.GEAR_BY_ID['pickaxe_' + (t - 1)].tool, t, 'the tier ' + (t - 1) + ' pickaxe mines it');
        assert.ok(node.respawn >= D.SAVED_RESPAWN_SEC, z + ' ore timer is saved');
    }
});

test('the Drowned King: about as long for each player in a party as Vrill alone, and the Shared Burden needs company', () => {
    const V = require('../core/world-dungeons');
    const g = gear('sky'), K = D.BOSSES.drowned_king, vrill = hits(D.BOSSES.vrill, g);
    for (let n = 2; n <= V.PARTY.max; n++) {
        const each = hits(Object.assign({}, K, { hp: V.bossHp(K.hp, n) }), g) / n;
        assert.ok(each >= vrill * 0.9 && each <= vrill * 1.4, n + ' players: ' + each.toFixed(0) + ' hits each (Vrill alone ' + vrill.toFixed(0) + ')');
    }
    assert.ok(share(K, g) >= 0.08 && share(K, g) <= 0.13, 'the King hits for ' + (share(K, g) * 100).toFixed(1) + '%');
    // the Burden (world-actors.js BOSS_MOVES.burden dmg 6, was 8.5 until 2026-11-20): heavy alone, bearable for two, light
    // for four; never a knockout at full health alone (a dash in its last moments dodges it besides)
    const BURDEN = 6;
    const burden = share(K, g) * BURDEN;
    assert.ok(burden >= 0.45 && burden < 0.75, 'alone: ' + (burden * 100).toFixed(0) + '%');
    assert.ok(burden / 2 <= 0.35 && burden / 4 <= 0.2, 'shared: ' + (burden * 50).toFixed(0) + '% for two');
    // what the help and the guide say of it alone, with gear made for the zone above each dungeon: about half your health
    // under the first four zones; under the Far Reaches (not the Vault, tuned above) most of it, but not a knockout
    for (const id of V.IDS.filter(x => x !== 'vault' && D.BOSSES[D.DUNGEONS[x].boss].phases.flat().includes('burden'))) {
        const dd = D.DUNGEONS[id], alone = share(D.BOSSES[dd.boss], gear(dd.zone)) * BURDEN;
        if (D.ZONES[dd.zone].via === 'waystone') assert.ok(alone >= 0.6 && alone < 0.85, id + ': ' + (alone * 100).toFixed(0) + '% (the guide: most of your health)');
        else assert.ok(alone >= 0.4 && alone < 0.65, id + ': ' + (alone * 100).toFixed(0) + '% (the guide: about half your health)');
    }
    // and the rooms' monsters stay those of their zones, scaled up a little with the party
    assert.ok(V.SCALE.hp <= 0.4 && V.SCALE.dmg <= 0.1);
});

test('every other dungeon boss is a step up from its zone\'s boss, for that zone\'s gear, alone or in a party', () => {
    const V = require('../core/world-dungeons');
    for (const id of V.IDS.filter(x => x !== 'vault')) {
        const dd = D.DUNGEONS[id], zone = dd.zone, g = gear(zone), B = D.BOSSES[dd.boss], zb = D.BOSSES[D.ZONES[zone].boss];
        const solo = hits(B, g), zoneBoss = hits(zb, g);
        assert.ok(solo >= zoneBoss * 1.6 && solo <= zoneBoss * 3.2, id + ': ' + solo.toFixed(0) + ' hits alone (' + zb.name + ' ' + zoneBoss.toFixed(0) + ')');
        for (let n = 2; n <= V.PARTY.max; n++) {
            const each = hits(Object.assign({}, B, { hp: V.bossHp(B.hp, n) }), g) / n;
            assert.ok(each < solo, id + ': ' + n + ' players finish it sooner each');
        }
        // it hits about as hard as its zone's boss, a little harder
        assert.ok(share(B, g) >= share(zb, g) * 0.95 && share(B, g) <= share(zb, g) * 1.4, id + ' hits for ' + (share(B, g) * 100).toFixed(1) + '%');
    }
});
