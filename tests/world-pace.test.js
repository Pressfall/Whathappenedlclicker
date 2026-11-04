'use strict';
// The Far Reaches are meant to take longer than the first four zones. These checks work it out from the tables alone, so a
// later tweak to a monster, a recipe or a node can't quietly undo it. "On-tier" gear for a zone of tier z is gear tier z + 1
// (Frostveil, tier 4, is Mithril, tier 5): a Common sword with a decent swing (x1.08) and a full Common armor set.
const test = require('node:test');
const assert = require('node:assert/strict');
const D = require('../core/world-data');

const FAR = D.ZONE_ORDER.filter(z => D.ZONES[z].via === 'waystone');
const KIT = ['sword', 'helmet', 'chest', 'boots', 'shield', 'pickaxe', 'axe'];
const ARMOR = ['helmet', 'chest', 'boots'];

function gear(zone, behind = 0) {
    const t = D.ZONES[zone].tier + 1 - behind;
    return {
        hit: 1.08 * D.GEAR_BY_ID['sword_' + t].dmg,
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
