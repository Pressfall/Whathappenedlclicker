/**
 * The Wilds' music: plays core/world-music.js's themes with the Web Audio API (no sound files). Every zone has its own
 * tune; walking somewhere else crossfades to that place's, and a boss fight (or a ward guardian's) crossfades to the boss
 * theme until it ends. Quiet while the Phonk Man's jukebox plays in town, while the tab is hidden, when Settings > Music is
 * off, and when the game's music is muted. Its volume is the game's music volume times the Wilds' volume (Settings).
 *
 * WHW.music: { sync() (settings or volume changed), now() (the theme playing, or null), playing() }
 */
(function () {
    'use strict';
    const M = window.WHWorldMusic, D = window.WHWorldData, WHW = window.WHW;
    if (!M || !D || !WHW) return;
    const LOOKAHEAD = 0.4;  // seconds of notes scheduled ahead
    const TICK_MS = 100;
    const FADE = 1.4;       // crossfade, seconds
    const LEVEL = 0.55;     // the whole mix, at full volume
    let ctx = null, out = null, noiseBuf = null;
    let cur = null;         // { id, song, wave, gain, i (next note), loopAt (ctx time the loop began) }
    let vol = 0, volAt = -1e9;

    function mainSave() { try { return JSON.parse(localStorage.getItem('whathappened_save') || localStorage.getItem('whathappened_save_v1') || '{}') || {}; } catch (e) { return {}; } }
    // the game's music volume (its own setting, in its save) times the Wilds' volume; 0 when either is off
    function readVolume() {
        const S = WHW.settings || {};
        if (S.music === false) return 0;
        const ms = mainSave();
        if (ms.musicMuted === true || ms.musicMuted === 'true') return 0;
        const v = Number(ms.musicVolume);
        const game = Number.isFinite(v) && ms.musicVolume !== null && ms.musicVolume !== '' ? Math.max(0, Math.min(1, v)) : 0.5;
        return game * (typeof S.volume === 'number' ? S.volume : 0.8);
    }
    // the save is a big string: read it now and then, not on every tick
    function volume() {
        const t = performance.now();
        if (t - volAt > 3000) { vol = readVolume(); volAt = t; }
        return vol;
    }

    // ---------------- the audio system ----------------
    // Browsers only let sound start after a click or a key press, so it starts on the first one (and not at all while the
    // music is off: it may be turned on later, and the next press starts it then)
    function start() {
        try {
            if (!ctx) {
                if (volume() <= 0) return;
                const AC = window.AudioContext || window.webkitAudioContext;
                if (!AC) return;
                ctx = new AC();
                out = ctx.createGain();
                out.gain.value = 0;
                // a gentle low-pass takes the edge off the square and saw waves
                const soft = ctx.createBiquadFilter();
                soft.type = 'lowpass'; soft.frequency.value = 5200;
                out.connect(soft); soft.connect(ctx.destination);
                noiseBuf = ctx.createBuffer(1, Math.floor(ctx.sampleRate * 0.5), ctx.sampleRate);
                const d = noiseBuf.getChannelData(0);
                for (let i = 0; i < d.length; i++) d[i] = Math.random() * 2 - 1;
                setInterval(tick, TICK_MS);
            }
            if (ctx.state === 'suspended' && document.visibilityState !== 'hidden') ctx.resume().catch(() => {});
        } catch (e) {}
    }
    for (const ev of ['pointerdown', 'keydown', 'touchstart']) window.addEventListener(ev, start, { capture: true, passive: true });
    // a hidden tab is quiet (and costs nothing); coming back picks up where it was
    document.addEventListener('visibilitychange', () => {
        if (!ctx) return;
        if (document.visibilityState === 'hidden') ctx.suspend().catch(() => {});
        else ctx.resume().catch(() => {});
    });

    // ---------------- what should be playing ----------------
    function wanted() {
        const g = WHW.game;
        if (!g || !g.player || !g.map || volume() <= 0) return null;
        // the Phonk Man's jukebox has the floor in town
        if (WHW.jukebox && WHW.jukebox.playing && WHW.jukebox.playing()) return null;
        const z = D.ZONES[g.zoneId] || {};
        const p = g.player, ar = g.map.boss;
        const bossFight = !!ar && g.actors.some(a => a.kind === 'boss' && a.active && !a.dead) && Math.hypot(p.x - ar.x, p.y - ar.y) < ar.r + 320;
        const guardian = !!g.wardFight && g.actors.some(a => a.guardian && !a.dead);
        return M.themeFor(g.zoneId, { boss: bossFight || guardian, dungeon: !!z.dungeon });
    }
    function switchTo(id) {
        const t = ctx.currentTime;
        if (cur) {
            const old = cur.gain;
            old.gain.cancelScheduledValues(t);
            old.gain.setValueAtTime(old.gain.value, t);
            old.gain.linearRampToValueAtTime(0, t + FADE);
            setTimeout(() => { try { old.disconnect(); } catch (e) {} }, (FADE + 4) * 1000);
            cur = null;
        }
        const song = id && M.song(id);
        if (!song) return;
        const gain = ctx.createGain();
        gain.gain.setValueAtTime(0, t);
        gain.gain.linearRampToValueAtTime(1, t + FADE);
        gain.connect(out);
        cur = { id, song, wave: M.THEMES[id].lead, gain, i: 0, loopAt: t + 0.15 };
    }
    function tick() {
        if (!ctx || ctx.state !== 'running') return;
        const t = ctx.currentTime;
        // the master level follows the volume, smoothly
        const level = volume() * LEVEL;
        if (Math.abs(out.gain.value - level) > 0.001) { out.gain.cancelScheduledValues(t); out.gain.setValueAtTime(out.gain.value, t); out.gain.linearRampToValueAtTime(level, t + 0.3); }
        const id = wanted();
        if (id !== (cur ? cur.id : null)) switchTo(id);
        if (!cur) return;
        const s = cur.song, sp = M.stepSec(s.bpm), until = t + LOOKAHEAD;
        const when = (n) => cur.loopAt + (n.t + (n.t % 2 ? s.swing : 0)) * sp;
        // fell far behind (a long stall): carry on from here rather than racing through what was missed
        if (when(s.notes[cur.i]) < t - 1) { cur.loopAt = t + 0.05 - s.notes[cur.i].t * sp; }
        for (let guard = 0; guard < 400; guard++) {
            const n = s.notes[cur.i], at = when(n);
            if (at > until) break;
            if (at >= t - 0.02) play(n, at, n.len * sp, cur);
            if (++cur.i >= s.notes.length) { cur.i = 0; cur.loopAt += s.steps * sp; }
        }
    }

    // ---------------- the instruments ----------------
    // a note with an attack/decay/release shape: peak at `at`, sustain `sus` of the peak, gone at at + len + rel
    function tone(type, freq, at, len, peak, dest, opts = {}) {
        const o = ctx.createOscillator(), g = ctx.createGain();
        o.type = type;
        o.frequency.setValueAtTime(freq, at);
        if (opts.slideTo) o.frequency.exponentialRampToValueAtTime(opts.slideTo, at + (opts.slideSec || 0.1));
        const atk = opts.atk || 0.008, rel = opts.rel || 0.06, sus = opts.sus === undefined ? 0.7 : opts.sus;
        g.gain.setValueAtTime(0.0001, at);
        g.gain.exponentialRampToValueAtTime(peak, at + atk);
        g.gain.exponentialRampToValueAtTime(Math.max(0.0001, peak * sus), at + Math.max(atk + 0.01, Math.min(len, 0.12)));
        g.gain.setValueAtTime(Math.max(0.0001, peak * sus), at + Math.max(atk + 0.02, len));
        g.gain.exponentialRampToValueAtTime(0.0001, at + Math.max(atk + 0.03, len) + rel);
        o.connect(g); g.connect(dest);
        o.start(at); o.stop(at + len + rel + 0.05);
        o.onended = () => { o.disconnect(); g.disconnect(); };
    }
    function hit(at, peak, freq, len, dest) {
        const src = ctx.createBufferSource(), f = ctx.createBiquadFilter(), g = ctx.createGain();
        src.buffer = noiseBuf;
        f.type = 'highpass'; f.frequency.value = freq;
        g.gain.setValueAtTime(peak, at);
        g.gain.exponentialRampToValueAtTime(0.0001, at + len);
        src.connect(f); f.connect(g); g.connect(dest);
        src.start(at, Math.random() * 0.3); src.stop(at + len + 0.02);
        src.onended = () => { src.disconnect(); f.disconnect(); g.disconnect(); };
    }
    const low = () => !!(WHW.engine && WHW.engine.perf === 'low');
    function play(n, at, len, c) {
        const dest = c.gain, g = n.g || 0.5;
        switch (n.v) {
            case 'lead': {
                const loud = c.wave === 'square' || c.wave === 'sawtooth' ? 0.09 : 0.2;
                tone(c.wave, M.hz(n.m), at, len * 0.92, loud * g, dest, { rel: 0.08 });
                break;
            }
            case 'bass': tone('triangle', M.hz(n.m), at, len * 0.9, 0.32 * g, dest, { rel: 0.05, sus: 0.8 }); break;
            case 'arp': if (!low()) tone('square', M.hz(n.m), at, len * 0.6, 0.025 * g, dest, { rel: 0.03, sus: 0.4 }); break;
            case 'pad': if (!low()) tone('triangle', M.hz(n.m), at, len, 0.06 * g, dest, { atk: 0.35, rel: 0.5, sus: 0.85 }); break;
            case 'bell': tone('sine', M.hz(n.m), at, 0.05, 0.08 * g, dest, { rel: 0.7, sus: 0.6 }); break;
            case 'kick': tone('sine', 150, at, 0.02, 0.55 * g, dest, { slideTo: 42, slideSec: 0.12, rel: 0.16, sus: 0.9 }); break;
            case 'snare': hit(at, 0.16 * g, 1500, 0.13, dest); break;
            case 'hat': if (!low()) hit(at, 0.05 * g, 7000, 0.04, dest); break;
        }
    }

    WHW.music = {
        // the volume or Settings > Music changed: hear it at once
        sync() { volAt = -1e9; if (volume() > 0) start(); },
        now: () => (cur ? cur.id : null),
        playing: () => !!(ctx && ctx.state === 'running' && cur),
    };
    // the game's music volume changed in another tab
    window.addEventListener('storage', (e) => { if (!e.key || e.key.startsWith('whathappened_save')) volAt = -1e9; });
})();
