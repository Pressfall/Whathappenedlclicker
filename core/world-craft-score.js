/**
 * The Wilds: scoring for the crafting minigames. Every score is 0-100 and the score decides the quality of what's
 * made (core/world-logic.js qualityOf / qualityMult). Recipe tier T (1-6) makes each minigame harder, so good gear
 * takes more skill. world-craft.js draws the minigames and feeds what the player did into these.
 * - Forge (metal): heat (keep the needle in a drifting band) -> hammer strikes (timing) -> quench (timing).
 * - Workbench (wood, leather): trace a carving path with the mouse; bows also get their string drawn to a mark.
 * - Rune Altar (rings, lootboxes): press as a sweeping needle crosses each lit rune.
 *
 * Works in a browser (<script src="core/world-craft-score.js"> sets window.WHWorldCraft) and in Node (require).
 */
(function (root, factory) {
    if (typeof module === 'object' && module.exports) module.exports = factory();
    else root.WHWorldCraft = factory();
}(typeof self !== 'undefined' ? self : this, function () {
    'use strict';

    const clamp = (v, a, b) => (v < a ? a : v > b ? b : v);
    const clamp100 = (v) => clamp(v, 0, 100);
    const mean = (a) => (a.length ? a.reduce((x, y) => x + y, 0) / a.length : 0);

    // How hard each station's minigame is at recipe tier T
    function difficulty(station, tier) {
        const T = clamp(Math.round(Number(tier) || 1), 1, 6);
        if (station === 'forge') return {
            T, heatTime: 5, heatGrace: 1, heatHalf: Math.max(0.045, 0.09 - 0.008 * (T - 1)), heatDriftPeriod: 3.1, heatDrift: 0.12,
            strikes: Math.min(9, 4 + T), zones: { p: 0.06 * (1 - 0.05 * (T - 1)), g: 0.15 * (1 - 0.05 * (T - 1)), o: 0.3 * (1 - 0.05 * (T - 1)) }, shrink: 0.04, coolGap: 2.0,
            period: (i) => Math.max(0.55, 1.3 - 0.06 * i - 0.05 * T),
            quenchWindow: Math.max(0.12, 0.3 - 0.03 * (T - 1)), quenchMin: 1.0, quenchMax: 2.0,
        };
        if (station === 'workbench') return {
            T, tol: Math.max(7, 16 - 1.5 * (T - 1)), points: 5 + Math.min(3, Math.floor(T / 2)), length: 600 + 50 * T, speedRef: 320,
            startRadius: 20, stringHalf: Math.max(0.025, 0.07 - 0.008 * T),
        };
        if (station === 'altar') return {
            T, period: Math.max(1.4, 2.2 - 0.12 * (T - 1)), runes: Math.min(10, 5 + T), minGapDeg: 35, strayPenalty: 8,
        };
        return { T };
    }

    // ---- Forge ----
    // inBand / nearBand: seconds the needle spent inside the band / within 1.5x of it, during scoredTime seconds
    function heatScore(inBand, nearBand, scoredTime) {
        if (!(scoredTime > 0)) return 0;
        return clamp100(100 * (inBand + 0.5 * nearBand) / scoredTime);
    }
    // One hammer strike. off: marker distance from the centre (0..1 of the bar's half width). i: strike number (0-based).
    // gap: seconds since the previous strike (the metal cools if you wait).
    function strikeScore(off, i, gap, cfg) {
        const k = Math.pow(1 - cfg.shrink, i);
        const p = cfg.zones.p * k, g = cfg.zones.g * k, o = cfg.zones.o * k;
        const x = Math.abs(off);
        let sc;
        if (x <= p) sc = 100;
        else if (x <= g) sc = 100 - 40 * (x - p) / (g - p);
        else if (x <= o) sc = 60 - 60 * (x - g) / (o - g);
        else sc = 0;
        if (gap > cfg.coolGap) sc -= 10;
        return clamp100(sc);
    }
    function strikeZones(i, cfg) {
        const k = Math.pow(1 - cfg.shrink, i);
        return { p: cfg.zones.p * k, g: cfg.zones.g * k, o: cfg.zones.o * k };
    }
    function hammerScore(strikes) { return clamp100(mean(strikes)); }
    // err: seconds between the release and the right moment
    function quenchScore(err, window) { return clamp100(100 * Math.max(0, 1 - Math.abs(err) / window)); }
    function forgeScore(H, M, Q) { return Math.round(clamp100(0.25 * H + 0.55 * M + 0.2 * Q)); }
    // The heat band's centre at time t (it drifts so the player has to keep adjusting)
    function heatBand(t, cfg) { return 0.62 + cfg.heatDrift * Math.sin(2 * Math.PI * t / cfg.heatDriftPeriod); }
    // Bellows: holding pumps the needle up, letting go lets it cool. h: { v, x }
    function heatStep(h, held, dt) {
        h.v += ((held ? 1.6 : -1.2) - 3 * h.v) * dt;
        h.x = clamp(h.x + h.v * dt, 0, 1);
        if ((h.x === 0 && h.v < 0) || (h.x === 1 && h.v > 0)) h.v = 0;
        return h;
    }

    // ---- Workbench ----
    // A smooth path (Catmull-Rom through the control points) as a dense polyline with running length
    function makePath(ctrl, perSeg = 24) {
        const pts = [];
        const P = (i) => ctrl[clamp(i, 0, ctrl.length - 1)];
        for (let i = 0; i < ctrl.length - 1; i++) {
            const p0 = P(i - 1), p1 = P(i), p2 = P(i + 1), p3 = P(i + 2);
            for (let j = 0; j < perSeg; j++) {
                const t = j / perSeg, t2 = t * t, t3 = t2 * t;
                pts.push({
                    x: 0.5 * (2 * p1.x + (-p0.x + p2.x) * t + (2 * p0.x - 5 * p1.x + 4 * p2.x - p3.x) * t2 + (-p0.x + 3 * p1.x - 3 * p2.x + p3.x) * t3),
                    y: 0.5 * (2 * p1.y + (-p0.y + p2.y) * t + (2 * p0.y - 5 * p1.y + 4 * p2.y - p3.y) * t2 + (-p0.y + 3 * p1.y - 3 * p2.y + p3.y) * t3),
                });
            }
        }
        pts.push({ x: ctrl[ctrl.length - 1].x, y: ctrl[ctrl.length - 1].y });
        let L = 0;
        pts[0].s = 0;
        for (let i = 1; i < pts.length; i++) { L += Math.hypot(pts[i].x - pts[i - 1].x, pts[i].y - pts[i - 1].y); pts[i].s = L; }
        return { pts, length: L };
    }
    // Random control points for a carving path inside a w x h box (rng: [0, 1) source)
    function randomPath(rng, w, h, n, margin = 40) {
        const ctrl = [];
        for (let i = 0; i < n; i++) {
            const x = margin + (w - 2 * margin) * (i / (n - 1));
            const y = margin + (h - 2 * margin) * (0.15 + 0.7 * rng());
            ctrl.push({ x, y });
        }
        return ctrl;
    }
    // Follows the player's cursor along the path. Progress only moves forward and only near the path (no skipping).
    function createTracer(path, tol, startRadius = 20) {
        const T = { path, tol, started: false, done: false, progress: 0, accSum: 0, accLen: 0, slips: 0, off: false, idx: 0, lastDev: 0 };
        T.update = function (x, y) {
            if (T.done) return T;
            const pts = path.pts;
            if (!T.started) {
                if (Math.hypot(x - pts[0].x, y - pts[0].y) <= startRadius) T.started = true;
                else return T;
            }
            // nearest point in a window just around and ahead of the progress so far
            let best = -1, bestD = Infinity;
            for (let i = T.idx; i < pts.length && pts[i].s <= T.progress + 60; i++) {
                const d = Math.hypot(x - pts[i].x, y - pts[i].y);
                if (d < bestD) { bestD = d; best = i; }
            }
            for (let i = T.idx - 1; i >= 0 && pts[i].s >= T.progress - 10; i--) {
                const d = Math.hypot(x - pts[i].x, y - pts[i].y);
                if (d < bestD) { bestD = d; best = i; }
            }
            T.lastDev = bestD;
            if (bestD > 2.5 * tol) { if (!T.off) { T.off = true; T.slips++; } return T; }
            if (bestD <= 2 * tol) T.off = false;
            if (best >= 0 && bestD <= 2 * tol && pts[best].s > T.progress) {
                const adv = pts[best].s - T.progress;
                T.accSum += Math.max(0, 1 - bestD / tol) * adv;
                T.accLen += adv;
                T.progress = pts[best].s;
                T.idx = best;
                if (T.progress >= path.length - 2) T.done = true;
            }
            return T;
        };
        T.accuracy = () => (T.accLen ? T.accSum / T.accLen : 0);
        T.coverage = () => clamp(T.progress / path.length, 0, 1);
        return T;
    }
    function carveScore({ accuracy, coverage, time, length, slips }, speedRef = 320) {
        const ref = length / speedRef;
        let tf = 1;
        if (time > 1.25 * ref) tf = time >= 3 * ref ? 0.7 : 1 - 0.3 * (time - 1.25 * ref) / (1.75 * ref);
        return clamp100(100 * accuracy * coverage * coverage * tf - 6 * (slips || 0));
    }
    function stringScore(draw, center, half) {
        const e = Math.abs(draw - center);
        if (e <= half) return 100;
        if (e >= 3 * half) return 0;
        return 100 * (1 - (e - half) / (2 * half));
    }
    function workbenchScore(carve, string) {
        return Math.round(clamp100(string === null || string === undefined ? carve : 0.75 * carve + 0.25 * string));
    }

    // ---- Rune Altar ----
    // Rune positions (degrees, clockwise from the top), at least minGap apart
    function runeAngles(rng, n, minGap) {
        const out = [];
        let tries = 0;
        while (out.length < n && tries < 2000) {
            tries++;
            const a = rng() * 360;
            if (out.every(b => Math.abs(((a - b + 540) % 360) - 180) >= minGap)) out.push(a);
        }
        return out;
    }
    function runePressScore(errDeg) {
        const e = Math.abs(errDeg);
        if (e <= 4) return 100;
        if (e <= 10) return 80;
        if (e <= 18) return 50;
        return 0;
    }
    // hits: one score per rune (0 for a miss); stray: presses with no rune near the needle
    function runeScore(hits, stray, cfg) { return Math.round(clamp100(mean(hits) - (cfg ? cfg.strayPenalty : 8) * (stray || 0))); }

    return {
        difficulty, heatScore, strikeScore, strikeZones, hammerScore, quenchScore, forgeScore, heatBand, heatStep,
        makePath, randomPath, createTracer, carveScore, stringScore, workbenchScore,
        runeAngles, runePressScore, runeScore,
    };
}));
