'use strict';
// The Far Reaches are meant to take longer than the first four zones. These checks work it out from the tables alone, so a
// later tweak to a monster, a recipe or a node can't quietly undo it. "On-tier" gear for a zone of tier z is gear tier z + 1
// (Frostveil, tier 4, is Mithril, tier 5): a Common sword with a decent swing (80% swing speed, a 2-hit combo, worked out
// with the sword's own curve in core/world-combat.js hitDamage) and a full Common armor set.
const test = require('node:test');
const assert = require('node:assert/strict');
const D = require('../core/world-data');
const C = require('../core/world-combat');
const SWING = C.hitDamage(1, 0.8, 2, 1, D.WEAPON_CLASSES.sword).dmg;

const FAR = D.ZONE_ORDER.filter(z => D.ZONES[z].via === 'waystone');
const KIT = ['sword', 'helmet', 'chest', 'boots', 'shield', 'pickaxe', 'axe'];
const ARMOR = ['helmet', 'chest', 'boots'];

function gear(zone, behind = 0) {
    const t = D.ZONES[zone].tier + 1 - behind;
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
    for (const z of FAR) {
        const n = kitSweeps(z);
        assert.ok(n >= 2.5 && n >= frost * 2.5, z + ': ' + n.toFixed(2) + ' sweeps (Frostveil ' + frost.toFixed(2) + ')');
    }
});

test('Far Reaches monsters are built for their own zone\'s gear', () => {
    for (const z of FAR) {
        const g = gear(z), E = D.MONSTERS[D.ZONES[z].elite], B = D.BOSSES[D.ZONES[z].boss];
        const rh = avg(regulars(z), m => hits(m, g)), rs = avg(regulars(z), m => share(m, g));
        assert.ok(rh >= 4 && rh <= 9, z + ' regulars die in ' + rh.toFixed(1) + ' hits');
        assert.ok(rs >= 0.055 && rs <= 0.09, z + ' regulars take ' + (rs * 100).toFixed(1) + '% a hit');
        assert.ok(hits(E, g) >= 45 && hits(E, g) <= 80, z + ' elite: ' + hits(E, g).toFixed(0) + ' hits');
        assert.ok(share(E, g) >= 0.09 && share(E, g) <= 0.13, z + ' elite hits for ' + (share(E, g) * 100).toFixed(1) + '%');
        assert.ok(share(B, g) >= 0.09 && share(B, g) <= 0.13, z + ' boss hits for ' + (share(B, g) * 100).toFixed(1) + '%');
    }
});

test('they hit harder and last longer than Frostveil, and one tier behind is a wall', () => {
    const fg = gear('frost'), frostShare = avg(regulars('frost'), m => share(m, fg)), frozen = hits(D.BOSSES.frozen, fg);
    for (const z of FAR) {
        const g = gear(z), old = gear(z, 1);
        assert.ok(avg(regulars(z), m => share(m, g)) > frostShare, z + ' regulars hurt more than Frostveil\'s');
        assert.ok(hits(D.BOSSES[D.ZONES[z].boss], g) >= frozen * 1.3, z + ' boss outlasts Frozen WH');
        // with the previous zone's gear: slower to kill and much more painful
        assert.ok(avg(regulars(z), m => hits(m, old)) >= avg(regulars(z), m => hits(m, g)) * 1.35, z + ' kills slower a tier behind');
        assert.ok(avg(regulars(z), m => share(m, old)) >= avg(regulars(z), m => share(m, g)) * 1.5, z + ' hurts more a tier behind');
    }
});

test('each zone\'s best ore needs the pickaxe from the zone before it', () => {
    for (const z of FAR) {
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
    // the Burden (world-actors.js BOSS_MOVES.burden dmg 8.5): near-lethal alone, bearable for two, light for four
    const burden = share(K, g) * 8.5;
    assert.ok(burden >= 0.7 && burden < 1, 'alone: ' + (burden * 100).toFixed(0) + '%');
    assert.ok(burden / 2 <= 0.45 && burden / 4 <= 0.25, 'shared: ' + (burden * 50).toFixed(0) + '% for two');
    // what the help and the guide say of it alone, with gear made for the zone above each dungeon: most of your health under
    // the first four zones; under the Far Reaches (not the Vault, tuned above) enough to knock you out even at full health
    for (const id of V.IDS.filter(x => x !== 'vault')) {
        const dd = D.DUNGEONS[id], alone = share(D.BOSSES[dd.boss], gear(dd.zone)) * 8.5;
        if (D.ZONES[dd.zone].via === 'waystone') assert.ok(alone >= 1, id + ': ' + (alone * 100).toFixed(0) + '% (the guide: knocks you out alone)');
        else assert.ok(alone >= 0.5 && alone < 1, id + ': ' + (alone * 100).toFixed(0) + '% (the guide: most of your health)');
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
