/**
 * The Wilds' music: an original chiptune theme for every zone, the town, the Arena, the Hall, the dungeons and boss fights.
 * Nothing here is a sound file: each theme is a few numbers (tempo, key, mode, chords, which instruments) and its tune is
 * written from them with a seeded random walk, so every player hears the same tune in the same zone, every time.
 * world-music.js plays it with the Web Audio API.
 *
 * Pure. Works in a browser (<script src="core/world-music.js"> sets window.WHWorldMusic) and in Node (tests).
 *
 * song(id) -> { id, bpm, steps (16th notes in one loop), swing, notes: [{ t, len (both in 16ths), v (voice), m (MIDI note,
 * not for drums), g (0-1 loudness) }] } sorted by t. Voices: lead, bass, arp, pad, bell, kick, snare, hat.
 */
(function (root, factory) {
    if (typeof module === 'object' && module.exports) module.exports = factory();
    else root.WHWorldMusic = factory();
}(typeof self !== 'undefined' ? self : this, function () {
    'use strict';

    const SCALES = {
        major: [0, 2, 4, 5, 7, 9, 11], minor: [0, 2, 3, 5, 7, 8, 10], dorian: [0, 2, 3, 5, 7, 9, 10], phrygian: [0, 1, 3, 5, 7, 8, 10],
        lydian: [0, 2, 4, 6, 7, 9, 11], mixolydian: [0, 2, 4, 5, 7, 9, 10], harmonic: [0, 2, 3, 5, 7, 8, 11],
    };
    // root: the bass's tonic (MIDI). chords: the scale degree each bar is built on (0 = the tonic). lead: its wave.
    // drums: a pattern from DRUMS. arp: a quiet broken chord in 16ths; pad: the chord held under it; bells: a high echo of
    // the tune. energy 0-1: how busy the tune is. swing: how late the off 16ths fall (0-0.3).
    const THEMES = {
        town:      { name: 'Wildgate',          bpm: 96,  root: 48, scale: 'major',      chords: [0, 5, 3, 4],             lead: 'square',   drums: 'soft',   energy: 0.4, pad: true },
        greenwood: { name: 'Greenwood',         bpm: 112, root: 50, scale: 'major',      chords: [0, 3, 4, 0, 5, 3, 1, 4], lead: 'square',   drums: 'walk',   energy: 0.55, arp: true },
        mines:     { name: 'Stonepeak Mines',   bpm: 88,  root: 45, scale: 'dorian',     chords: [0, 0, 6, 4],             lead: 'triangle', drums: 'sparse', energy: 0.35, pad: true },
        ember:     { name: 'Ember Wastes',      bpm: 128, root: 40, scale: 'phrygian',   chords: [0, 1, 0, 6],             lead: 'sawtooth', drums: 'drive',  energy: 0.7, arp: true },
        frost:     { name: 'Frostveil',         bpm: 80,  root: 47, scale: 'minor',      chords: [0, 5, 2, 6],             lead: 'triangle', drums: 'sparse', energy: 0.3, bells: true, pad: true },
        coast:     { name: 'Saltspray Coast',   bpm: 104, root: 43, scale: 'mixolydian', chords: [0, 6, 3, 0],             lead: 'square',   drums: 'walk',   energy: 0.5, swing: 0.18, arp: true },
        storm:     { name: 'Stormspire',        bpm: 140, root: 42, scale: 'minor',      chords: [0, 5, 6, 4],             lead: 'sawtooth', drums: 'drive',  energy: 0.75, arp: true },
        ruins:     { name: 'The Cinder Capital', bpm: 100, root: 41, scale: 'harmonic',  chords: [0, 3, 4, 4],             lead: 'square',   drums: 'march',  energy: 0.5, pad: true },
        sky:       { name: 'Skyreach',          bpm: 92,  root: 53, scale: 'lydian',     chords: [0, 1, 0, 4],             lead: 'triangle', drums: 'soft',   energy: 0.4, bells: true, arp: true },
        arcade:    { name: 'Insert Coin',       bpm: 144, root: 45, scale: 'major',      chords: [0, 5, 3, 4, 0, 5, 1, 4], lead: 'square',   drums: 'drive',  energy: 0.8, arp: true, bells: true },
        arena:     { name: 'The Arena',         bpm: 132, root: 45, scale: 'minor',      chords: [0, 5, 3, 4],             lead: 'square',   drums: 'drive',  energy: 0.7, arp: true },
        trials:    { name: 'Proving Grounds',   bpm: 136, root: 43, scale: 'dorian',     chords: [0, 6, 5, 6],             lead: 'square',   drums: 'drive',  energy: 0.7 },
        hall:      { name: 'Hall of Gods',      bpm: 66,  root: 38, scale: 'minor',      chords: [0, 5, 0, 6],             lead: 'sine',     drums: 'none',   energy: 0.2, pad: true, bells: true },
        dungeon:   { name: 'The Deep',          bpm: 84,  root: 40, scale: 'harmonic',   chords: [0, 0, 5, 4],             lead: 'triangle', drums: 'sparse', energy: 0.35, pad: true },
        boss:      { name: 'A Great Foe',       bpm: 152, root: 40, scale: 'harmonic',   chords: [0, 5, 3, 4],             lead: 'sawtooth', drums: 'boss',   energy: 0.85, arp: true },
    };
    // 16 steps a bar: [kick steps, snare steps, hat steps]
    const DRUMS = {
        none:   [[], [], []],
        soft:   [[0, 8], [], [4, 12]],
        sparse: [[0], [], [10]],
        walk:   [[0, 8, 10], [4, 12], [0, 2, 4, 6, 8, 10, 12, 14]],
        march:  [[0, 8], [4, 12, 14], [2, 6, 10, 14]],
        drive:  [[0, 4, 8, 12], [4, 12], [2, 6, 10, 14]],
        boss:   [[0, 3, 8, 11], [4, 12], [0, 2, 4, 6, 8, 10, 12, 14, 15]],
    };
    // where a bar's notes start (1 = a note), from calm to busy; each runs until the next
    const RHYTHMS = [
        '1000000010000000', '1000001000100000', '1000100010001000', '1000001010000010',
        '1010001000101000', '1000101000101010', '1010101010001000', '1011001010110010',
    ];

    function hashStr(str) {
        let h = 2166136261 >>> 0;
        for (let i = 0; i < str.length; i++) { h ^= str.charCodeAt(i); h = Math.imul(h, 16777619) >>> 0; }
        return h >>> 0;
    }
    function mulberry32(seed) {
        let a = seed >>> 0;
        return function () {
            a = (a + 0x6D2B79F5) >>> 0;
            let t = a;
            t = Math.imul(t ^ (t >>> 15), t | 1);
            t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
            return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
        };
    }

    // The theme a place plays: a zone's own, the dungeons share one, a boss fight has its own. null: nothing (unknown)
    function themeFor(zoneId, opts = {}) {
        if (opts.boss) return 'boss';
        if (opts.dungeon) return 'dungeon';
        return THEMES[zoneId] ? zoneId : null;
    }

    const cache = new Map();
    function song(id) {
        if (cache.has(id)) return cache.get(id);
        const th = THEMES[id];
        if (!th) return null;
        const rng = mulberry32(hashStr('wh-music:' + id));
        const sc = SCALES[th.scale];
        // a scale degree (any whole number, negative too) as a MIDI note above base
        const note = (deg, base) => base + sc[((deg % 7) + 7) % 7] + 12 * Math.floor(deg / 7);
        const bars = th.chords.length;
        const notes = [];
        const add = (t, len, v, m, g) => notes.push(m === undefined ? { t, len, v, g } : { t, len, v, m, g });
        // two passes of the chords: the tune, then the same tune answered (its second half written again)
        const loopBars = bars * 2;
        const leadBase = th.root + 12;
        const tune = []; // per bar of the first pass: [step, len, degree]
        let deg = 7 + Math.floor(rng() * 3); // around the octave above the tonic
        const rhythmFor = () => {
            const top = Math.max(1, Math.round(th.energy * RHYTHMS.length));
            return RHYTHMS[Math.floor(rng() * top)];
        };
        const writeBar = (b) => {
            const ch = th.chords[b % bars], r = rhythmFor(), out = [];
            const onsets = [];
            for (let s = 0; s < 16; s++) if (r[s] === '1') onsets.push(s);
            onsets.forEach((s, i) => {
                const end = i + 1 < onsets.length ? onsets[i + 1] : 16;
                // strong beats land on the chord (its root, third or fifth); the rest step or skip along the scale
                if (s % 8 === 0) {
                    const tones = [ch, ch + 2, ch + 4, ch + 7, ch + 9];
                    deg = tones.reduce((best, t) => (Math.abs(t - deg) < Math.abs(best - deg) ? t : best), tones[0]);
                } else {
                    const stepBy = [-2, -1, -1, 1, 1, 2, 0, 3, -3][Math.floor(rng() * 9)];
                    deg += stepBy;
                }
                deg = Math.max(4, Math.min(16, deg));
                // a short rest now and then, so the tune breathes
                const len = end - s > 2 && rng() < 0.2 ? end - s - 1 : end - s;
                out.push([s, len, deg]);
            });
            return out;
        };
        for (let b = 0; b < bars; b++) tune.push(writeBar(b));
        const answer = tune.map((bar, b) => (b >= bars / 2 ? writeBar(b) : bar));
        // the last bar of each pass comes home to the tonic
        const home = (bar) => { if (bar.length) { const l = bar[bar.length - 1]; bar[bar.length - 1] = [l[0], Math.max(l[1], 4), Math.round(l[2] / 7) * 7 || 7]; } };
        home(answer[answer.length - 1]);
        const swing = th.swing || 0;
        for (let b = 0; b < loopBars; b++) {
            const at = b * 16, ch = th.chords[b % bars], pass = b < bars ? tune[b] : answer[b - bars];
            // the tune
            for (const [s, len, d] of pass) {
                add(at + s, len, 'lead', note(d, leadBase), 0.55 + (s % 4 === 0 ? 0.2 : 0));
                if (th.bells && s % 8 === 0) add(at + s + 3, 2, 'bell', note(d, leadBase + 12), 0.35);
            }
            // the bass: busier the more energy
            const bassRoot = note(ch, th.root - 12);
            if (th.energy >= 0.7) for (let s = 0; s < 16; s += 2) add(at + s, 2, 'bass', s % 8 === 6 ? note(ch + 4, th.root - 12) : bassRoot, s % 4 === 0 ? 0.9 : 0.65);
            else if (th.energy >= 0.45) { add(at, 6, 'bass', bassRoot, 0.9); add(at + 6, 2, 'bass', bassRoot, 0.6); add(at + 8, 6, 'bass', note(ch + 4, th.root - 12), 0.8); add(at + 14, 2, 'bass', note(ch + 2, th.root - 12), 0.6); }
            else { add(at, 12, 'bass', bassRoot, 0.85); if (b % 2) add(at + 12, 4, 'bass', note(ch + 4, th.root - 12), 0.6); }
            // the broken chord and the held chord
            if (th.arp) for (let s = 0; s < 16; s += th.energy >= 0.7 ? 1 : 2) add(at + s, 1, 'arp', note(ch + [0, 2, 4, 7][(s / (th.energy >= 0.7 ? 1 : 2)) % 4], th.root + 12), 0.5);
            if (th.pad) for (const k of [0, 2, 4]) add(at, 16, 'pad', note(ch + k, th.root), 0.4);
            // the drums (a fill of extra snares in the last bar of the loop)
            const [kick, snare, hat] = DRUMS[th.drums] || DRUMS.none;
            for (const s of kick) add(at + s, 1, 'kick', undefined, 1);
            for (const s of snare) add(at + s, 1, 'snare', undefined, 0.8);
            if (b === loopBars - 1 && snare.length) for (const s of [13, 14, 15]) add(at + s, 1, 'snare', undefined, 0.5);
            for (const s of hat) add(at + s, 1, 'hat', undefined, s % 4 === 0 ? 0.6 : 0.4);
        }
        notes.sort((a, b) => a.t - b.t);
        const out = { id, name: th.name, bpm: th.bpm, steps: loopBars * 16, swing, notes };
        cache.set(id, out);
        return out;
    }
    // seconds per 16th note
    const stepSec = (bpm) => 60 / bpm / 4;
    // MIDI note to Hz
    const hz = (m) => 440 * Math.pow(2, (m - 69) / 12);

    return { THEMES, SCALES, DRUMS, themeFor, song, stepSec, hz };
}));
