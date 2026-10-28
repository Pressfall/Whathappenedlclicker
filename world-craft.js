/**
 * The Wilds: crafting minigames, drawn on a canvas inside the modal. How well you play sets the score (0-100) and the
 * score sets the quality of the gear or lootbox (scoring in core/world-craft-score.js).
 * - Forge: pump the bellows to keep the heat in the band, strike the hammer on the beat, quench at the right glow.
 * - Workbench: carve along the line with the mouse held down; bows also get their string drawn to the mark.
 * - Rune Altar: press as the needle crosses each lit rune.
 * WHW.craft.open({ station, tier, title, bow, practice, onDone(score), onCancel() })
 */
(function () {
    'use strict';
    const S = window.WHWorldCraft, W = window.WHWorld;
    const WHW = window.WHW;
    const CW = 720, CH = 405;
    const clamp = (v, a, b) => (v < a ? a : v > b ? b : v);
    const RUNES = 'ᚠᚢᚦᚨᚱᚲᚷᚹᚺᚾᛁᛃ';

    let run = null; // the minigame being played

    function open(opts) {
        close(true);
        const cfg = S.difficulty(opts.station, opts.tier);
        const body = WHW.ui.modal(opts.title || 'Crafting', '', { game: true, onClose: () => { if (run && !run.finished) { const r = run; close(true); if (r.opts.onCancel) r.opts.onCancel(); } } });
        body.innerHTML = `<div class="w-game">
            <div class="w-game-info"><span id="cgPhase"></span><span id="cgHint"></span></div>
            <canvas id="cgCanvas" width="${CW}" height="${CH}" aria-label="Crafting minigame"></canvas>
            <div class="w-row"><span class="muted" id="cgTip"></span></div>
        </div>`;
        const canvas = body.querySelector('#cgCanvas');
        const dpr = Math.min(2, window.devicePixelRatio || 1);
        canvas.width = CW * dpr; canvas.height = CH * dpr;
        const ctx = canvas.getContext('2d');
        ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
        run = { opts, cfg, canvas, ctx, t: 0, last: performance.now(), down: false, pressed: false, released: false, mx: 0, my: 0, finished: false, raf: 0, game: null };
        const pos = (ev) => { const r = canvas.getBoundingClientRect(); run.mx = (ev.clientX - r.left) / r.width * CW; run.my = (ev.clientY - r.top) / r.height * CH; };
        // every pointer move is sampled (not just once a frame), so fast tracing is measured accurately
        const moved = () => { if (run.game && run.game.onMove) run.game.onMove(run.mx, run.my); };
        canvas.addEventListener('pointerdown', (ev) => { ev.preventDefault(); pos(ev); run.down = true; run.pressed = true; moved(); try { canvas.setPointerCapture(ev.pointerId); } catch (e) {} });
        canvas.addEventListener('pointermove', (ev) => { pos(ev); moved(); });
        const up = (ev) => { pos(ev); if (run.down) { run.down = false; run.released = true; } };
        canvas.addEventListener('pointerup', up);
        canvas.addEventListener('pointercancel', up);
        run.keyDown = (ev) => { if (ev.key === ' ' || ev.key === 'Enter') { ev.preventDefault(); if (!ev.repeat) { run.keyHeld = true; run.pressed = true; } } };
        run.keyUp = (ev) => { if (ev.key === ' ' || ev.key === 'Enter') { run.keyHeld = false; run.released = true; } };
        window.addEventListener('keydown', run.keyDown);
        window.addEventListener('keyup', run.keyUp);
        run.game = opts.station === 'forge' ? forge(run) : opts.station === 'workbench' ? workbench(run) : altar(run);
        loop();
    }
    function close(silent) {
        if (!run) return;
        cancelAnimationFrame(run.raf);
        window.removeEventListener('keydown', run.keyDown);
        window.removeEventListener('keyup', run.keyUp);
        run = null;
        if (!silent) WHW.ui.closeModal();
    }
    function loop() {
        if (!run) return;
        const nowT = performance.now();
        const dt = Math.min(0.05, (nowT - run.last) / 1000);
        run.last = nowT;
        if (!run.finished) {
            run.t += dt;
            run.game.update(dt);
            run.pressed = false; run.released = false;
        }
        const ctx = run.ctx;
        ctx.clearRect(0, 0, CW, CH);
        run.game.draw(ctx);
        run.raf = requestAnimationFrame(loop);
    }
    function held() { return run.down || run.keyHeld; }
    function setInfo(phase, hint, tip) {
        const b = run.canvas.closest('.w-game');
        if (!b) return;
        b.querySelector('#cgPhase').textContent = phase;
        b.querySelector('#cgHint').textContent = hint || '';
        if (tip !== undefined) b.querySelector('#cgTip').textContent = tip;
    }
    function finish(score) {
        if (!run || run.finished) return;
        run.finished = true;
        const sc = Math.round(clamp(score, 0, 100));
        const r = run;
        setTimeout(() => {
            if (run !== r) return;
            cancelAnimationFrame(r.raf);
            window.removeEventListener('keydown', r.keyDown);
            window.removeEventListener('keyup', r.keyUp);
            run = null;
            r.opts.onDone(sc);
        }, 650);
        WHW.sfx(sc >= 90 ? 'perfect' : sc >= 55 ? 'craft' : 'tink');
    }
    function text(ctx, s, x, y, size = 16, color = '#f3f5fa', align = 'center', weight = 800) {
        ctx.font = `${weight} ${size}px Inter, system-ui, sans-serif`;
        ctx.textAlign = align; ctx.fillStyle = color;
        ctx.fillText(s, x, y);
    }
    function scoreWord(s) { return s >= 100 ? 'PERFECT' : s >= 80 ? 'GREAT' : s >= 50 ? 'GOOD' : s > 0 ? 'OK' : 'MISS'; }
    function scoreColor(s) { return s >= 100 ? '#ffc83d' : s >= 80 ? '#4fd27a' : s >= 50 ? '#4fa8ff' : s > 0 ? '#b4bccd' : '#ff5b6b'; }
    function fadeLabels(ctx, labels) {
        for (const l of labels) { if (run.t - l.at > 0.9) continue; ctx.globalAlpha = 1 - (run.t - l.at) / 0.9; text(ctx, l.s, l.x, l.y - (run.t - l.at) * 30, 18, l.c); }
        ctx.globalAlpha = 1;
    }
    function hotColor(f) {
        // white hot -> yellow -> orange -> red -> dark
        const stops = [[255, 255, 240], [255, 230, 120], [255, 150, 40], [210, 50, 30], [70, 40, 40]];
        const x = clamp(f, 0, 1) * (stops.length - 1), i = Math.min(stops.length - 2, Math.floor(x)), u = x - i;
        const c = stops[i].map((v, k) => Math.round(v + (stops[i + 1][k] - v) * u));
        return `rgb(${c[0]},${c[1]},${c[2]})`;
    }

    // ---------------- Forge ----------------
    function forge(R) {
        const cfg = R.cfg;
        const G = { phase: 'heat', t0: 0, h: { v: 0, x: 0.25 }, inBand: 0, near: 0, H: 0, strikes: [], i: 0, lastStrike: 0, mt: 0, M: 0, Q: 0, qT: 0, qStar: 1 + Math.random(), labels: [], swing: 0 };
        G.qStar = cfg.quenchMin + Math.random() * (cfg.quenchMax - cfg.quenchMin);
        setInfo('1 / 3 · Heat', `Tier ${cfg.T}`, 'Hold the mouse button (or Space) to pump the bellows. Keep the needle inside the glowing band as it drifts.');
        const QUENCH_SPAN = 3; // seconds the glow takes to go from white hot to dark
        G.update = function (dt) {
            const t = R.t - G.t0;
            if (G.phase === 'heat') {
                S.heatStep(G.h, held(), dt);
                if (t > cfg.heatGrace) {
                    const c = S.heatBand(t, cfg), off = Math.abs(G.h.x - c);
                    if (off <= cfg.heatHalf) G.inBand += dt;
                    else if (off <= cfg.heatHalf * 1.5) G.near += dt;
                }
                if (t >= cfg.heatTime) {
                    G.H = S.heatScore(G.inBand, G.near, cfg.heatTime - cfg.heatGrace);
                    G.labels.push({ s: 'Heat ' + Math.round(G.H), x: CW / 2, y: 80, c: scoreColor(G.H), at: R.t });
                    G.phase = 'hammer'; G.t0 = R.t; G.lastStrike = R.t;
                    setInfo(`2 / 3 · Hammer (0 / ${cfg.strikes})`, `Tier ${cfg.T}`, 'Click (or Space) when the marker crosses the middle of the bar. The middle shrinks every strike, and waiting too long cools the metal.');
                }
            } else if (G.phase === 'hammer') {
                G.mt += dt;
                G.swing = Math.max(0, G.swing - dt * 4);
                if (R.pressed) {
                    const per = cfg.period(G.i);
                    const ph = (G.mt / per) % 1;
                    const pos = ph < 0.5 ? -1 + 4 * ph : 3 - 4 * ph; // triangle wave -1..1
                    const sc = S.strikeScore(pos, G.i, R.t - G.lastStrike, cfg);
                    G.strikes.push(sc);
                    G.labels.push({ s: scoreWord(sc), x: CW / 2 + pos * 250, y: 150, c: scoreColor(sc), at: R.t });
                    G.lastStrike = R.t; G.i++; G.swing = 1;
                    WHW.sfx(sc >= 100 ? 'perfect' : sc > 0 ? 'mine' : 'tink');
                    setInfo(`2 / 3 · Hammer (${G.i} / ${cfg.strikes})`, `Tier ${cfg.T}`);
                    if (G.i >= cfg.strikes) {
                        G.M = S.hammerScore(G.strikes);
                        G.phase = 'quench'; G.t0 = R.t; G.qT = 0;
                        setInfo('3 / 3 · Quench', `Tier ${cfg.T}`, 'The metal cools from white hot to dark. Click (or Space) the moment its glow matches the mark.');
                    }
                }
            } else if (G.phase === 'quench') {
                G.qT = t;
                const done = R.pressed || t > G.qStar + cfg.quenchWindow * 2 || t > QUENCH_SPAN;
                if (done) {
                    G.Q = R.pressed ? S.quenchScore(t - G.qStar, cfg.quenchWindow) : 0;
                    G.labels.push({ s: scoreWord(G.Q), x: CW / 2, y: 130, c: scoreColor(G.Q), at: R.t });
                    G.phase = 'done';
                    WHW.sfx('quench');
                    finish(S.forgeScore(G.H, G.M, G.Q));
                }
            }
        };
        G.draw = function (ctx) {
            ctx.fillStyle = '#16120f'; ctx.fillRect(0, 0, CW, CH);
            const t = R.t - G.t0;
            // anvil and ingot
            ctx.fillStyle = '#3a3f4a'; ctx.fillRect(CW / 2 - 110, 300, 220, 26); ctx.fillRect(CW / 2 - 60, 326, 120, 40);
            const glow = G.phase === 'heat' ? hotColor(1 - G.h.x) : G.phase === 'hammer' ? hotColor(0.25) : hotColor(G.qT / 3);
            ctx.fillStyle = glow; ctx.fillRect(CW / 2 - 70, 282, 140, 18);
            if (G.phase === 'heat') {
                // gauge
                const gx = CW / 2 - 18, gy = 40, gh = 220;
                ctx.fillStyle = '#0b0d13'; ctx.fillRect(gx, gy, 36, gh);
                const c = t > cfg.heatGrace ? S.heatBand(t, cfg) : S.heatBand(cfg.heatGrace, cfg);
                const by = gy + gh * (1 - c - cfg.heatHalf), bh = gh * cfg.heatHalf * 2;
                ctx.fillStyle = 'rgba(255,200,61,0.18)'; ctx.fillRect(gx - 4, gy + gh * (1 - c - cfg.heatHalf * 1.5), 44, gh * cfg.heatHalf * 3);
                ctx.fillStyle = 'rgba(255,200,61,0.55)'; ctx.fillRect(gx - 4, by, 44, bh);
                const ny = gy + gh * (1 - G.h.x);
                ctx.fillStyle = '#ff5b3d'; ctx.fillRect(gx - 12, ny - 2, 60, 4);
                text(ctx, held() ? 'PUMPING' : 'hold to pump', CW / 2, 285 - 10, 13, '#a7b0c4', 'center', 700);
                const left = Math.max(0, cfg.heatTime - t);
                text(ctx, left.toFixed(1) + 's', gx + 90, gy + 20, 18, '#f3f5fa', 'left');
                if (t < cfg.heatGrace) text(ctx, 'Get ready…', gx + 90, gy + 46, 14, '#a7b0c4', 'left', 600);
                text(ctx, 'In band ' + Math.round(G.inBand * 10) / 10 + 's', gx - 70, gy + 20, 14, '#ffd27a', 'right', 700);
            } else if (G.phase === 'hammer') {
                const z = S.strikeZones(Math.min(G.i, cfg.strikes - 1), cfg);
                const bx = CW / 2 - 250, by = 110, bw = 500, bh = 26;
                ctx.fillStyle = '#0b0d13'; ctx.fillRect(bx, by, bw, bh);
                const zone = (w, col) => { ctx.fillStyle = col; ctx.fillRect(CW / 2 - w * 250, by, w * 500, bh); };
                zone(z.o, 'rgba(79,168,255,0.35)'); zone(z.g, 'rgba(79,210,122,0.5)'); zone(z.p, 'rgba(255,200,61,0.9)');
                const per = cfg.period(G.i);
                const ph = (G.mt / per) % 1;
                const pos = ph < 0.5 ? -1 + 4 * ph : 3 - 4 * ph;
                ctx.fillStyle = '#fff'; ctx.fillRect(CW / 2 + pos * 250 - 2, by - 8, 4, bh + 16);
                const cool = R.t - G.lastStrike;
                if (cool > cfg.coolGap * 0.7) text(ctx, cool > cfg.coolGap ? 'The metal is cooling!' : 'Strike soon…', CW / 2, 92, 13, '#ff9a3d', 'center', 700);
                // hammer
                ctx.save(); ctx.translate(CW / 2 + 90, 250); ctx.rotate(-0.9 + G.swing * 0.9);
                ctx.fillStyle = '#6b4423'; ctx.fillRect(-4, -70, 8, 70); ctx.fillStyle = '#9aa0a8'; ctx.fillRect(-18, -84, 36, 18); ctx.restore();
                for (let i = 0; i < cfg.strikes; i++) { const s = G.strikes[i]; ctx.fillStyle = s === undefined ? '#2a2f3c' : scoreColor(s); ctx.beginPath(); ctx.arc(CW / 2 - (cfg.strikes - 1) * 12 + i * 24, 175, 7, 0, Math.PI * 2); ctx.fill(); }
            } else {
                const sx = CW / 2 - 250, sy = 120, sw = 500, sh = 22;
                for (let i = 0; i < sw; i++) { ctx.fillStyle = hotColor(i / sw); ctx.fillRect(sx + i, sy, 1, sh); }
                const target = G.qStar / 3;
                ctx.fillStyle = '#fff'; ctx.beginPath(); ctx.moveTo(sx + target * sw, sy - 4); ctx.lineTo(sx + target * sw - 7, sy - 14); ctx.lineTo(sx + target * sw + 7, sy - 14); ctx.fill();
                ctx.fillStyle = 'rgba(255,255,255,0.25)'; ctx.fillRect(sx + (G.qStar - cfg.quenchWindow) / 3 * sw, sy + sh, cfg.quenchWindow * 2 / 3 * sw, 4);
                const cur = Math.min(1, G.qT / 3);
                ctx.fillStyle = '#0b0d13'; ctx.fillRect(sx + cur * sw - 2, sy - 6, 4, sh + 12);
                text(ctx, 'Target glow', sx + target * sw, sy - 20, 12, '#a7b0c4', 'center', 700);
                ctx.fillStyle = 'rgba(120,180,255,0.15)'; ctx.fillRect(CW / 2 - 130, 330, 260, 50);
            }
            fadeLabels(ctx, G.labels);
            if (G.phase === 'done') text(ctx, 'Score ' + S.forgeScore(G.H, G.M, G.Q), CW / 2, 60, 26, '#ffc83d');
        };
        return G;
    }

    // ---------------- Workbench ----------------
    function workbench(R) {
        const cfg = R.cfg;
        const rng = Math.random;
        const path = S.makePath(S.randomPath(rng, CW, CH - 40, cfg.points, 60));
        const G = { phase: 'carve', path, tracer: S.createTracer(path, cfg.tol, cfg.startRadius), tStart: 0, time: 0, carve: 0, labels: [], strCenter: 0.6 + Math.random() * 0.25, pull: 0, anchor: null, str: null };
        const ref = path.length / cfg.speedRef;
        G.onMove = (x, y) => { if (G.phase === 'carve' && held()) G.tracer.update(x, y); };
        setInfo(R.opts.bow ? '1 / 2 · Carve' : 'Carve', `Tier ${cfg.T}`, 'Press on the green dot, then hold the mouse button and follow the line to the end. Stay on the line; speed helps but accuracy matters most.');
        G.update = function (dt) {
            if (G.phase === 'carve') {
                if (held() || R.pressed) G.tracer.update(R.mx, R.my);
                if (G.tracer.started) { if (!G.tStart) G.tStart = R.t; G.time = R.t - G.tStart; }
                if (G.tracer.done || (G.tracer.started && G.time > ref * 3 + 2)) {
                    G.carve = S.carveScore({ accuracy: G.tracer.accuracy(), coverage: G.tracer.coverage(), time: G.time, length: path.length, slips: G.tracer.slips }, cfg.speedRef);
                    G.labels.push({ s: 'Carve ' + Math.round(G.carve), x: CW / 2, y: 50, c: scoreColor(G.carve), at: R.t });
                    if (R.opts.bow) {
                        G.phase = 'string';
                        setInfo('2 / 2 · String', `Tier ${cfg.T}`, 'Press anywhere, pull the mouse back to draw the string, and let go when the draw is on the gold mark.');
                    } else { G.phase = 'done'; finish(S.workbenchScore(G.carve, null)); }
                }
            } else if (G.phase === 'string') {
                if (R.pressed) G.anchor = { x: R.mx, y: R.my };
                if (G.anchor && held()) G.pull = clamp(Math.hypot(R.mx - G.anchor.x, R.my - G.anchor.y) / 220, 0, 1);
                if (G.anchor && R.released) {
                    G.str = S.stringScore(G.pull, G.strCenter, cfg.stringHalf);
                    G.labels.push({ s: scoreWord(G.str), x: CW / 2, y: 80, c: scoreColor(G.str), at: R.t });
                    G.phase = 'done';
                    finish(S.workbenchScore(G.carve, G.str));
                }
            }
        };
        G.draw = function (ctx) {
            // a plank
            ctx.fillStyle = '#7a5230'; ctx.fillRect(0, 0, CW, CH);
            ctx.strokeStyle = 'rgba(0,0,0,0.12)'; ctx.lineWidth = 2;
            for (let y = 12; y < CH; y += 22) { ctx.beginPath(); ctx.moveTo(0, y); for (let x = 0; x <= CW; x += 40) ctx.lineTo(x, y + Math.sin(x / 70 + y) * 4); ctx.stroke(); }
            const pts = path.pts;
            if (G.phase === 'carve' || G.phase === 'done' && !R.opts.bow) {
                ctx.lineCap = 'round'; ctx.lineJoin = 'round';
                ctx.strokeStyle = 'rgba(255,240,200,0.18)'; ctx.lineWidth = cfg.tol * 2;
                ctx.beginPath(); pts.forEach((p, i) => (i ? ctx.lineTo(p.x, p.y) : ctx.moveTo(p.x, p.y))); ctx.stroke();
                ctx.strokeStyle = 'rgba(40,20,5,0.7)'; ctx.lineWidth = 2; ctx.setLineDash([6, 6]);
                ctx.beginPath(); pts.forEach((p, i) => (i ? ctx.lineTo(p.x, p.y) : ctx.moveTo(p.x, p.y))); ctx.stroke(); ctx.setLineDash([]);
                // carved so far
                ctx.strokeStyle = '#ffd27a'; ctx.lineWidth = 5;
                ctx.beginPath(); let started = false;
                for (const p of pts) { if (p.s > G.tracer.progress) break; if (!started) { ctx.moveTo(p.x, p.y); started = true; } else ctx.lineTo(p.x, p.y); }
                ctx.stroke();
                ctx.fillStyle = '#4fd27a'; ctx.beginPath(); ctx.arc(pts[0].x, pts[0].y, cfg.startRadius * 0.6, 0, Math.PI * 2); ctx.fill();
                ctx.fillStyle = '#ff5b6b'; ctx.beginPath(); ctx.arc(pts[pts.length - 1].x, pts[pts.length - 1].y, 7, 0, Math.PI * 2); ctx.fill();
                if (G.tracer.started && G.tracer.off) text(ctx, 'Back on the line!', R.mx, R.my - 18, 14, '#ff6b7a');
                // chisel cursor
                ctx.strokeStyle = held() ? '#fff' : 'rgba(255,255,255,0.5)'; ctx.lineWidth = 2;
                ctx.beginPath(); ctx.arc(R.mx, R.my, 5, 0, Math.PI * 2); ctx.stroke();
                text(ctx, `${Math.round(G.tracer.coverage() * 100)}% · ${G.time.toFixed(1)}s / ${(ref * 1.25).toFixed(1)}s`, CW - 12, 24, 14, '#fff', 'right', 700);
                if (G.tracer.slips) text(ctx, `Slips: ${G.tracer.slips}`, 12, 24, 14, '#ffb3bb', 'left', 700);
            } else {
                // bow string meter
                const mx = CW - 90, my = 50, mh = 300;
                ctx.fillStyle = '#0b0d13'; ctx.fillRect(mx, my, 30, mh);
                const c = G.strCenter, hw = cfg.stringHalf;
                ctx.fillStyle = 'rgba(255,200,61,0.25)'; ctx.fillRect(mx - 4, my + mh * (1 - c - hw * 3), 38, mh * hw * 6);
                ctx.fillStyle = 'rgba(255,200,61,0.85)'; ctx.fillRect(mx - 4, my + mh * (1 - c - hw), 38, mh * hw * 2);
                ctx.fillStyle = '#fff'; ctx.fillRect(mx - 10, my + mh * (1 - G.pull) - 2, 50, 4);
                // the bow
                ctx.strokeStyle = '#c48a52'; ctx.lineWidth = 8;
                ctx.beginPath(); ctx.arc(250, CH / 2, 140, -1.1, 1.1); ctx.stroke();
                const ex = 250 + 140 * Math.cos(1.1), ey = 140 * Math.sin(1.1);
                ctx.strokeStyle = '#efe6cc'; ctx.lineWidth = 2;
                ctx.beginPath(); ctx.moveTo(ex, CH / 2 - ey); ctx.lineTo(ex - G.pull * 140, CH / 2); ctx.lineTo(ex, CH / 2 + ey); ctx.stroke();
                if (G.anchor && held()) { ctx.strokeStyle = 'rgba(255,255,255,0.35)'; ctx.setLineDash([4, 4]); ctx.beginPath(); ctx.moveTo(G.anchor.x, G.anchor.y); ctx.lineTo(R.mx, R.my); ctx.stroke(); ctx.setLineDash([]); }
                if (!G.anchor) text(ctx, 'Let go, then press and pull back', 250, 50, 15, '#fff3c4');
                text(ctx, 'Draw ' + Math.round(G.pull * 100) + '%', mx + 15, my - 12, 14, '#fff', 'center', 700);
            }
            fadeLabels(ctx, G.labels);
        };
        return G;
    }

    // ---------------- Rune Altar ----------------
    function altar(R) {
        const cfg = R.cfg;
        const angles = S.runeAngles(Math.random, cfg.runes, cfg.minGapDeg).sort((a, b) => a - b);
        const glyphs = angles.map((_, i) => RUNES[(i * 5 + Math.floor(Math.random() * RUNES.length)) % RUNES.length]);
        const start = Math.max(-40, angles[0] - 60);
        const G = { k: 0, hits: [], stray: 0, labels: [], needle: start, delay: 0.8, angles };
        setInfo('Rune Altar', `Tier ${cfg.T}`, 'The needle sweeps around once. Click (or Space) as it passes over each glowing rune, in order. Pressing when no rune is near costs points.');
        const cx = CW / 2, cy = CH / 2 + 10, rad = 150;
        G.update = function (dt) {
            if (G.delay > 0) { G.delay -= dt; return; }
            G.needle += 360 / cfg.period * dt;
            if (G.k < angles.length) {
                const target = angles[G.k];
                if (R.pressed) {
                    const err = G.needle - target;
                    if (Math.abs(err) <= 18) {
                        const sc = S.runePressScore(err);
                        G.hits.push(sc); G.k++;
                        G.labels.push({ s: scoreWord(sc), x: cx + Math.sin(target * Math.PI / 180) * (rad + 40), y: cy - Math.cos(target * Math.PI / 180) * (rad + 40), c: scoreColor(sc), at: R.t });
                        WHW.sfx(sc >= 100 ? 'perfect' : 'rune');
                    } else {
                        G.stray++;
                        G.labels.push({ s: '−' + cfg.strayPenalty, x: cx, y: cy + 4, c: '#ff5b6b', at: R.t });
                        WHW.sfx('tink');
                    }
                } else if (G.needle > target + 18) {
                    G.hits.push(0); G.k++;
                    G.labels.push({ s: 'MISS', x: cx + Math.sin(target * Math.PI / 180) * (rad + 40), y: cy - Math.cos(target * Math.PI / 180) * (rad + 40), c: '#ff5b6b', at: R.t });
                }
            }
            if (G.k >= angles.length && !G.ended) { G.ended = true; finish(S.runeScore(G.hits, G.stray, cfg)); }
        };
        G.draw = function (ctx) {
            const grad = ctx.createRadialGradient(cx, cy, 20, cx, cy, 300);
            grad.addColorStop(0, '#2a1d47'); grad.addColorStop(1, '#0d0a18');
            ctx.fillStyle = grad; ctx.fillRect(0, 0, CW, CH);
            ctx.strokeStyle = 'rgba(176,125,255,0.45)'; ctx.lineWidth = 3;
            ctx.beginPath(); ctx.arc(cx, cy, rad, 0, Math.PI * 2); ctx.stroke();
            ctx.beginPath(); ctx.arc(cx, cy, rad - 30, 0, Math.PI * 2); ctx.stroke();
            angles.forEach((a, i) => {
                const r = a * Math.PI / 180;
                const x = cx + Math.sin(r) * rad, y = cy - Math.cos(r) * rad;
                const done = i < G.k, cur = i === G.k;
                ctx.fillStyle = done ? scoreColor(G.hits[i]) : cur ? '#e6d4ff' : 'rgba(176,125,255,0.45)';
                if (cur) { ctx.shadowColor = '#b07dff'; ctx.shadowBlur = 18; }
                ctx.beginPath(); ctx.arc(x, y, cur ? 20 : 16, 0, Math.PI * 2); ctx.fill();
                ctx.shadowBlur = 0;
                text(ctx, glyphs[i], x, y + 7, 20, '#1a1030');
            });
            const nr = G.needle * Math.PI / 180;
            ctx.strokeStyle = '#ffe14d'; ctx.lineWidth = 4; ctx.lineCap = 'round';
            ctx.beginPath(); ctx.moveTo(cx, cy); ctx.lineTo(cx + Math.sin(nr) * (rad + 22), cy - Math.cos(nr) * (rad + 22)); ctx.stroke();
            ctx.fillStyle = '#ffe14d'; ctx.beginPath(); ctx.arc(cx, cy, 8, 0, Math.PI * 2); ctx.fill();
            text(ctx, `${G.k} / ${angles.length}`, cx, cy + 50, 16, '#e6d4ff', 'center', 700);
            if (G.delay > 0) text(ctx, 'Ready…', cx, cy - 30, 22, '#fff');
            fadeLabels(ctx, G.labels);
        };
        return G;
    }

    // current: the minigame being played (browser tests drive it through this)
    WHW.craft = { open, close, isOpen: () => !!run, current: () => run };
})();
