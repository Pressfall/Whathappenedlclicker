'use strict';
// The Wilds' music (core/world-music.js, played by world-music.js): a tune for every place, the same for everyone
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const D = require('../core/world-data');
const M = require('../core/world-music');

const VOICES = new Set(['lead', 'bass', 'arp', 'pad', 'bell', 'kick', 'snare', 'hat']);
const DRUM = new Set(['kick', 'snare', 'hat']);

test('every place in the Wilds has a tune: its own, the dungeons\' shared one, and the boss theme in a boss fight', () => {
    for (const id of Object.keys(D.ZONES)) {
        const z = D.ZONES[id];
        const theme = M.themeFor(id, { dungeon: !!z.dungeon });
        assert.ok(theme && M.song(theme), id + ' has music');
        if (z.dungeon) assert.equal(theme, 'dungeon', id);
        else assert.equal(theme, id, id + ' has its own tune');
        assert.equal(M.themeFor(id, { boss: true, dungeon: !!z.dungeon }), 'boss', id + ': a boss fight');
    }
    assert.equal(M.themeFor('nowhere'), null);
});

test('songs are well formed: notes inside the loop, in order, in a sane range, on known voices', () => {
    for (const id of Object.keys(M.THEMES)) {
        const s = M.song(id), th = M.THEMES[id];
        assert.equal(s.steps, th.chords.length * 2 * 16, id + ' loops over its chords twice');
        assert.ok(s.bpm >= 60 && s.bpm <= 170 && s.swing >= 0 && s.swing <= 0.3, id);
        assert.ok(M.SCALES[th.scale] && M.DRUMS[th.drums], id + ' scale and drums');
        let prev = -1;
        for (const n of s.notes) {
            assert.ok(VOICES.has(n.v), id + ': voice ' + n.v);
            assert.ok(n.t >= prev && n.t < s.steps && n.len > 0, id + ' at ' + n.t);
            assert.ok(n.g > 0 && n.g <= 1, id + ' loudness');
            if (!DRUM.has(n.v)) assert.ok(Number.isInteger(n.m) && n.m >= 24 && n.m <= 100, id + ' ' + n.v + ' note ' + n.m);
            prev = n.t;
        }
        // the tune starts the loop and comes back
        assert.ok(s.notes.some(n => n.v === 'lead' && n.t === 0), id + ': the tune starts on the first beat');
        assert.ok(s.notes.filter(n => n.v === 'lead').length >= th.chords.length * 2, id + ': a note a bar at least');
        // the tune stays in its key
        const sc = M.SCALES[th.scale];
        for (const n of s.notes.filter(x => x.v === 'lead')) assert.ok(sc.includes((((n.m - th.root) % 12) + 12) % 12), id + ': ' + n.m + ' is in ' + th.scale);
    }
    assert.ok(Math.abs(M.hz(69) - 440) < 1e-9 && Math.abs(M.hz(81) - 880) < 1e-9);
    assert.ok(Math.abs(M.stepSec(120) - 0.125) < 1e-9);
});

test('a tune is the same every time (seeded), and the zones don\'t share one', () => {
    const a = JSON.stringify(M.song('sky'));
    delete require.cache[require.resolve('../core/world-music')];
    const fresh = require('../core/world-music');
    assert.equal(JSON.stringify(fresh.song('sky')), a);
    const tunes = new Set(Object.keys(M.THEMES).map(id => M.song(id).notes.filter(n => n.v === 'lead').map(n => n.t + ':' + n.m).join(',')));
    assert.equal(tunes.size, Object.keys(M.THEMES).length);
});

test('world.html loads the music after the game it listens to', () => {
    const html = fs.readFileSync(path.join(__dirname, '..', 'world.html'), 'utf8');
    const at = (src) => html.indexOf('<script src="' + src + '"></script>');
    assert.ok(at('core/world-music.js') > 0 && at('world-music.js') > at('world.js'), 'core/world-music.js, then world.js, then world-music.js');
});
