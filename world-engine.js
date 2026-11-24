/**
 * The Wilds: engine. Canvas and camera, a fixed-step loop (120 steps a second so fast swings are sampled finely),
 * input (keyboard, mouse, touch), the tile map (drawn once into cached chunks), collisions, particles and floating
 * text. Game rules live in core/world-*.js; actors in world-actors.js; the page wiring in world.js.
 */
(function () {
    'use strict';
    const D = window.WHWorldData, G = window.WHWorldGen;
    const WHW = window.WHW = window.WHW || {};
    const TILE = D.TILE;
    const DT = 1 / 120;
    const CHUNK = 16; // tiles per cached ground chunk
    // At most this many steps per frame: a slow frame then slows the game down for a moment instead of making the next
    // frame do even more catching up (which on a slow device snowballed into seconds-long stalls)
    const MAX_STEPS = 10;
    // Resolution 'auto' keeps the canvas under this many pixels (a big high-DPI screen at full sharpness is 4x the work)
    const AUTO_MAX_PIXELS = 4.2e6;

    function readSetting(key, fallback) { try { const v = localStorage.getItem(key); return v === null ? fallback : v; } catch (e) { return fallback; } }
    const reducedMotion = (() => { try { return window.matchMedia('(prefers-reduced-motion: reduce)').matches; } catch (e) { return false; } })();

    const E = WHW.engine = {
        DT, TILE, canvas: null, ctx: null, w: 0, h: 0, dpr: 1, zoom: 1,
        // graphics: perf (detail: high / medium / low), resolution ('auto', 'full' or a scale like '0.75'), fpsCap (0 = the
        // screen's rate); set with applyGraphics. fps: frames drawn in the last second.
        perf: readSetting('whathappened_performance', 'high'), resolution: 'auto', fpsCap: 60, fps: 0, reducedMotion,
        cam: { x: 0, y: 0 }, shake: 0, shakeX: 0, shakeY: 0,
        mouse: { sx: 0, sy: 0, x: 0, y: 0, down: false, rmb: false, pressed: false, released: false, moved: false, type: 'mouse' },
        keys: new Set(), pressedKeys: new Set(),
        // lefty: the controls mirrored (the stick on the right); max: how far the stick's knob travels (px)
        touch: { stickId: null, sx0: 0, sy0: 0, mx: 0, my: 0, max: 50, lefty: false, aimId: null, ax0: 0, ay0: 0, ax: 0, ay: 0, active: false },
        isTouch: false,
        particles: [], texts: [],
        time: 0, hitStop: 0, paused: false, frames: 0,
        map: null, chunks: new Map(), minimapCache: null,
        images: new Map(),
    };

    // ---------------- canvas ----------------
    function resize() {
        const c = E.canvas;
        const maxDpr = E.perf === 'low' ? 1 : E.perf === 'medium' ? 1.5 : 2;
        E.w = window.innerWidth; E.h = window.innerHeight;
        let dpr = Math.min(maxDpr, window.devicePixelRatio || 1);
        if (E.resolution === 'auto') dpr = Math.min(dpr, Math.sqrt(AUTO_MAX_PIXELS / Math.max(1, E.w * E.h)));
        else if (E.resolution !== 'full') dpr *= Number(E.resolution) || 1;
        E.dpr = Math.max(0.35, dpr);
        // small screens see more of the world, either way up (a phone held sideways is wide but short); a phone held upright
        // a little more again, or there is little to see either side of you
        E.zoom = E.w < 500 && E.h > E.w ? 0.78 : E.w < 700 || E.h < 500 ? 0.85 : E.w < 1100 ? 1.1 : 1.25;
        c.width = Math.round(E.w * E.dpr); c.height = Math.round(E.h * E.dpr);
        c.style.width = E.w + 'px'; c.style.height = E.h + 'px';
    }
    const viewW = () => E.w / E.zoom, viewH = () => E.h / E.zoom;
    function screenToWorld(sx, sy) { return { x: E.cam.x + sx / E.zoom, y: E.cam.y + sy / E.zoom }; }
    function worldToScreen(x, y) { return { x: (x - E.cam.x) * E.zoom, y: (y - E.cam.y) * E.zoom }; }

    function img(src) {
        if (!src) return null;
        let im = E.images.get(src);
        if (!im) { im = new Image(); im.decoding = 'async'; im.src = src; E.images.set(src, im); }
        return im.complete && im.naturalWidth ? im : null;
    }

    // ---------------- input ----------------
    function onKey(down) {
        return (ev) => {
            if (WHW.ui && WHW.ui.handleKey && WHW.ui.handleKey(ev, down)) return;
            const k = ev.key.length === 1 ? ev.key.toLowerCase() : ev.key;
            if (down) { if (!E.keys.has(k)) E.pressedKeys.add(k); E.keys.add(k); }
            else E.keys.delete(k);
            if ([' ', 'ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight', 'Tab'].includes(ev.key)) ev.preventDefault();
        };
    }
    function bindInput() {
        window.addEventListener('keydown', onKey(true));
        window.addEventListener('keyup', onKey(false));
        window.addEventListener('blur', () => { E.keys.clear(); E.mouse.down = false; E.mouse.rmb = false; if (E.touch.stickId !== null) stickEnd(); if (WHW.onRelease) WHW.onRelease(); });
        const c = E.canvas;
        c.addEventListener('contextmenu', (ev) => ev.preventDefault());
        c.addEventListener('pointerdown', (ev) => {
            if (ev.pointerType === 'touch') { touchDown(ev); return; }
            E.mouse.type = ev.pointerType;
            if (ev.button === 2) { E.mouse.rmb = true; try { c.setPointerCapture(ev.pointerId); } catch (e) {} return; }
            if (ev.button !== 0) return;
            E.mouse.sx = ev.clientX; E.mouse.sy = ev.clientY;
            E.mouse.down = true; E.mouse.pressed = true;
            try { c.setPointerCapture(ev.pointerId); } catch (e) {}
            if (WHW.onPress) WHW.onPress();
        });
        c.addEventListener('pointermove', (ev) => {
            if (ev.pointerType === 'touch') { touchMove(ev); return; }
            E.mouse.sx = ev.clientX; E.mouse.sy = ev.clientY; E.mouse.moved = true; E.mouse.type = ev.pointerType; // a mouse again (a laptop with a touch screen)
        });
        const up = (ev) => {
            if (ev.pointerType === 'touch') { touchUp(ev); return; }
            if (ev.button === 2 || ev.type === 'pointercancel') E.mouse.rmb = false;
            if (ev.button !== 0 && ev.type === 'pointerup') return;
            if (E.mouse.down) { E.mouse.down = false; E.mouse.released = true; if (WHW.onRelease) WHW.onRelease(); }
        };
        c.addEventListener('pointerup', up);
        c.addEventListener('pointercancel', up);
        c.addEventListener('wheel', (ev) => { ev.preventDefault(); if (WHW.onWheel) WHW.onWheel(Math.sign(ev.deltaY)); }, { passive: false });
        window.addEventListener('resize', () => { resize(); });
    }
    // The stick: a thumb landing on the lower part of its side of the screen (the left, or the right with the controls
    // mirrored) brings the stick there and steers from that spot; where it rests otherwise is only a hint
    function stickZone(x, y) { return y > E.h * 0.3 && (E.touch.lefty ? x > E.w * 0.55 : x < E.w * 0.45); }
    function stickStart(ev) {
        const st = document.getElementById('touchStick');
        E.touch.stickId = ev.pointerId;
        E.touch.sx0 = ev.clientX; E.touch.sy0 = ev.clientY;
        E.touch.max = st ? st.offsetWidth * 0.4 : 50;
        if (st) {
            const r = st.offsetWidth / 2;
            Object.assign(st.style, { left: (ev.clientX - r) + 'px', top: (ev.clientY - r) + 'px', right: 'auto', bottom: 'auto' });
            st.classList.add('is-on');
        }
        try { E.canvas.setPointerCapture(ev.pointerId); } catch (e) {}
        stickMove(ev);
    }
    function stickEnd() {
        E.touch.stickId = null; E.touch.mx = E.touch.my = 0; knob(0, 0);
        const st = document.getElementById('touchStick');
        if (st) { st.style.left = st.style.top = st.style.right = st.style.bottom = ''; st.classList.remove('is-on'); }
    }
    function knob(x, y) { const k = document.getElementById('touchKnob'); if (k) k.style.transform = `translate(${x}px, ${y}px)`; }
    function stickMove(ev) {
        const dx = ev.clientX - E.touch.sx0, dy = ev.clientY - E.touch.sy0;
        const len = Math.hypot(dx, dy), max = E.touch.max || 50;
        const f = len > max ? max / len : 1;
        E.touch.mx = dx * f / max; E.touch.my = dy * f / max;
        knob(dx * f, dy * f);
    }
    // anywhere else on the screen: drag to aim (weapons point along the drag; the bow pulls back with it)
    function touchDown(ev) {
        setTouch(true);
        E.mouse.type = 'touch'; // the stick too: until a mouse is used again, nothing aims at where a mouse last was
        if (E.touch.stickId === null && stickZone(ev.clientX, ev.clientY)) { stickStart(ev); return; }
        if (E.touch.aimId !== null) return;
        E.touch.aimId = ev.pointerId;
        E.touch.ax0 = E.touch.ax = ev.clientX; E.touch.ay0 = E.touch.ay = ev.clientY;
        E.touch.active = true;
        E.mouse.down = true; E.mouse.pressed = true; E.mouse.type = 'touch';
        E.mouse.sx = ev.clientX; E.mouse.sy = ev.clientY;
        try { E.canvas.setPointerCapture(ev.pointerId); } catch (e) {}
        if (WHW.onPress) WHW.onPress();
    }
    function touchMove(ev) {
        if (ev.pointerId === E.touch.stickId) { stickMove(ev); return; }
        if (ev.pointerId !== E.touch.aimId) return;
        E.touch.ax = ev.clientX; E.touch.ay = ev.clientY; E.mouse.sx = ev.clientX; E.mouse.sy = ev.clientY;
    }
    function touchUp(ev) {
        if (ev.pointerId === E.touch.stickId) { stickEnd(); return; }
        if (ev.pointerId !== E.touch.aimId) return;
        E.touch.aimId = null; E.touch.active = false;
        E.mouse.down = false; E.mouse.released = true;
        if (WHW.onRelease) WHW.onRelease();
    }
    function setTouch(on) {
        if (E.isTouch === on) return;
        E.isTouch = on;
        // a phone has no mouse: aim by touch from the start (otherwise the weapon pointed at the screen's corner, where the
        // never-moved mouse "was", until a finger dragged on the screen)
        if (on && E.mouse.type === 'mouse' && !E.mouse.moved) E.mouse.type = 'touch';
        const ui = document.getElementById('touchUi');
        if (ui) ui.hidden = !on;
        document.body.classList.toggle('is-touch', on); // world.css lays the HUD out around the touch controls
    }
    // Where the weapon should point (world px). On touch the drag from where the finger landed sets it.
    function aimPoint(px, py) {
        if (E.mouse.type === 'touch') {
            if (!E.touch.active) return null;
            return { x: px + (E.touch.ax - E.touch.ax0) * 2.5 / E.zoom, y: py + (E.touch.ay - E.touch.ay0) * 2.5 / E.zoom };
        }
        return screenToWorld(E.mouse.sx, E.mouse.sy);
    }
    function moveInput() {
        let x = 0, y = 0;
        const k = E.keys;
        if (k.has('a') || k.has('ArrowLeft')) x -= 1;
        if (k.has('d') || k.has('ArrowRight')) x += 1;
        if (k.has('w') || k.has('ArrowUp')) y -= 1;
        if (k.has('s') || k.has('ArrowDown')) y += 1;
        if (E.touch.stickId !== null) { x = E.touch.mx; y = E.touch.my; if (Math.hypot(x, y) < 0.15) x = y = 0; }
        const len = Math.hypot(x, y);
        return len > 1 ? { x: x / len, y: y / len } : { x, y };
    }
    function consumeKey(k) { if (E.pressedKeys.has(k)) { E.pressedKeys.delete(k); return true; } return false; }

    // ---------------- map ----------------
    function setMap(m) {
        if (E.chunks.size) dropChunks(true); // the last zone's ground: its memory back now, not whenever the browser gets to it
        E.map = m;
        E.chunks = new Map();
        E.minimapCache = null;
        E.nodeGrid = null;
    }
    const tileAt = (wx, wy) => G.get(E.map, Math.floor(wx / TILE), Math.floor(wy / TILE));
    // open sky (the Skyreach Isles) stops everything but the player, who can step off and fall (world-actors.js)
    const blocksMove = (t, e) => G.isSolid(t) || (t === G.T.VOID && !(e && e.kind === 'player'));
    const blocksSight = (t) => t === G.T.WALL || t === G.T.BUILDING;
    // Push a circle out of solid tiles (and out of the map)
    function collideTiles(e) {
        const m = E.map;
        if (!m) return false;
        let hit = false;
        for (let pass = 0; pass < 2; pass++) {
            const x0 = Math.floor((e.x - e.r) / TILE), x1 = Math.floor((e.x + e.r) / TILE);
            const y0 = Math.floor((e.y - e.r) / TILE), y1 = Math.floor((e.y + e.r) / TILE);
            for (let ty = y0; ty <= y1; ty++) for (let tx = x0; tx <= x1; tx++) {
                if (!blocksMove(G.get(m, tx, ty), e)) continue;
                const nx = Math.max(tx * TILE, Math.min(e.x, tx * TILE + TILE));
                const ny = Math.max(ty * TILE, Math.min(e.y, ty * TILE + TILE));
                let dx = e.x - nx, dy = e.y - ny;
                let d = Math.hypot(dx, dy);
                if (d >= e.r) continue;
                hit = true;
                if (d < 0.001) { dx = e.x - (tx + 0.5) * TILE; dy = e.y - (ty + 0.5) * TILE; d = Math.hypot(dx, dy) || 1; e.x += dx / d * e.r; e.y += dy / d * e.r; continue; }
                e.x = nx + dx / d * e.r; e.y = ny + dy / d * e.r;
            }
        }
        e.x = Math.max(e.r, Math.min(m.w * TILE - e.r, e.x));
        e.y = Math.max(e.r, Math.min(m.h * TILE - e.r, e.y));
        return hit;
    }
    function collideCircles(e, list) {
        let hit = false;
        for (const o of list) {
            if (o === e || !o.solid) continue;
            const dx = e.x - o.x, dy = e.y - o.y, rr = e.r + o.r;
            const d2 = dx * dx + dy * dy;
            if (d2 >= rr * rr) continue;
            const d = Math.sqrt(d2) || 1;
            e.x = o.x + dx / d * rr; e.y = o.y + dy / d * rr;
            hit = true;
        }
        return hit;
    }
    // Move e by (dx, dy), stopping at walls and solid things. Returns true when something blocked it.
    function move(e, dx, dy, solids) {
        const steps = Math.max(1, Math.ceil(Math.hypot(dx, dy) / (e.r * 0.8)));
        let hit = false;
        for (let i = 0; i < steps; i++) {
            e.x += dx / steps; e.y += dy / steps;
            if (solids) hit = collideCircles(e, solids) || hit;
            hit = collideTiles(e) || hit;
        }
        return hit;
    }
    // Is there a wall between two points? (water doesn't block sight or hits)
    function wallBetween(x0, y0, x1, y1) {
        const len = Math.hypot(x1 - x0, y1 - y0);
        const n = Math.ceil(len / 8);
        for (let i = 1; i < n; i++) {
            const f = i / n;
            if (blocksSight(tileAt(x0 + (x1 - x0) * f, y0 + (y1 - y0) * f))) return true;
        }
        return false;
    }
    // Static things (nodes) by grid cell, for fast "what's near me" (asked many times a step, so the keys are numbers)
    const cellKey = (gx, gy) => gy * 4096 + gx;
    function buildNodeGrid(nodes) {
        const g = new Map();
        for (const n of nodes) {
            const k = cellKey(Math.max(0, Math.floor(n.x / 128)), Math.max(0, Math.floor(n.y / 128)));
            if (!g.has(k)) g.set(k, []);
            g.get(k).push(n);
        }
        E.nodeGrid = g;
    }
    function nodesNear(x, y, r) {
        const out = [];
        if (!E.nodeGrid) return out;
        const x0 = Math.max(0, Math.floor((x - r) / 128)), x1 = Math.floor((x + r) / 128), y0 = Math.max(0, Math.floor((y - r) / 128)), y1 = Math.floor((y + r) / 128);
        for (let gy = y0; gy <= y1; gy++) for (let gx = x0; gx <= x1; gx++) { const l = E.nodeGrid.get(cellKey(gx, gy)); if (l) for (const n of l) out.push(n); }
        return out;
    }

    // ---------------- ground chunks ----------------
    // Change the graphics settings (any of perf, resolution, fpsCap) and redraw what depends on them
    function applyGraphics(opts) {
        const perf = ['high', 'medium', 'low'].includes(opts.perf) ? opts.perf : E.perf;
        if (perf !== E.perf) { E.perf = perf; dropChunks(true); E.chunks = new Map(); } // the ground's detail depends on it
        if (opts.resolution !== undefined) E.resolution = opts.resolution;
        if (opts.fpsCap !== undefined) E.fpsCap = Number(opts.fpsCap) || 0;
        if (E.canvas) resize();
    }
    function shade(hex, f) {
        const n = parseInt(hex.slice(1), 16);
        const c = (v) => Math.max(0, Math.min(255, Math.round(v * f)));
        return `rgb(${c(n >> 16)},${c((n >> 8) & 255)},${c(n & 255)})`;
    }
    function tileHash(x, y, s = 0) { let h = (x * 374761393 + y * 668265263 + s * 2147483647) | 0; h = (h ^ (h >>> 13)) * 1274126177; return ((h ^ (h >>> 16)) >>> 0) / 4294967296; }
    // A ground chunk is drawn a few rows at a time: { cv, g, row (next row to draw), done }. Chunks just off screen are drawn
    // ahead in the time a frame has to spare (prewarmGround), so walking on doesn't stall a frame on a whole new chunk.
    function newChunk() {
        const cv = document.createElement('canvas');
        cv.width = CHUNK * TILE; cv.height = CHUNK * TILE;
        return { cv, g: cv.getContext('2d'), row: 0, done: false, used: 0 };
    }
    function drawChunk(ch, cx, cy, rows) {
        const m = E.map;
        const zone = D.ZONES[m.id];
        const P = zone.palette;
        const g = ch.g;
        const T = G.T;
        const colors = {
            [T.FLOOR]: P.floor, [T.FLOOR2]: P.floor2, [T.PATH]: P.path, [T.WALL]: P.wall, [T.WATER]: P.water || P.wall,
            [T.LAVA]: P.hazard || '#ff5a1f', [T.ICE]: P.ice || '#a9dcf5', [T.PLAZA]: P.plaza || P.path, [T.BUILDING]: zone.gen === 'hall' ? P.floor : '#2a2420', [T.ARENA]: shade(P.floor, 0.82),
            [T.SHALLOW]: P.shallow || P.water || '#4fa3bd', [T.VOID]: P.void || '#0b0d18',
        };
        const colorOf = (t) => colors[t];
        const detail = E.perf !== 'low';
        const yEnd = Math.min(CHUNK, ch.row + rows);
        for (let y = ch.row; y < yEnd; y++) for (let x = 0; x < CHUNK; x++) {
            const tx = cx * CHUNK + x, ty = cy * CHUNK + y;
            if (tx >= m.w || ty >= m.h) continue;
            // a hidden dungeon's way down stands on solid ground: drawn as the floor around it (world.js draws the stone)
            const t = m.dungeon && tx === m.dungeon.tx && ty === m.dungeon.ty ? T.FLOOR : G.get(m, tx, ty);
            const X = x * TILE, Y = y * TILE;
            g.fillStyle = colorOf(t);
            g.fillRect(X, Y, TILE, TILE);
            const r1 = tileHash(tx, ty), r2 = tileHash(tx, ty, 1);
            if (t === T.WALL) {
                const below = G.get(m, tx, ty + 1);
                if (zone.gen === 'meadow' || m.id === 'town') {
                    // forest edge: canopies
                    g.fillStyle = shade(P.wall, 0.75);
                    g.fillRect(X, Y, TILE, TILE);
                    for (let i = 0; i < 2; i++) {
                        g.fillStyle = shade(P.wall, 1 + tileHash(tx, ty, 3 + i) * 0.5);
                        g.beginPath(); g.arc(X + 8 + tileHash(tx, ty, 5 + i) * 16, Y + 8 + tileHash(tx, ty, 7 + i) * 16, 12 + tileHash(tx, ty, 9 + i) * 6, 0, Math.PI * 2); g.fill();
                    }
                } else if (zone.gen === 'arcade') {
                    // the Neon Arcade: a cabinet on every tile, its screen lit in one of a few neon colours, a marquee on top
                    const NEON = ['#ff4fd8', '#5ee7ff', '#f8b800', '#3dff9a', '#ff6a3a'];
                    g.fillStyle = shade(P.wall, 2.2); g.fillRect(X + 2, Y, TILE - 4, TILE - (below !== T.WALL ? 8 : 0));
                    const neon = NEON[Math.floor(r1 * NEON.length) % NEON.length];
                    g.fillStyle = neon; g.fillRect(X + 4, Y + 2, TILE - 8, 3);
                    g.fillStyle = '#05040a'; g.fillRect(X + 6, Y + 7, TILE - 12, 11);
                    g.fillStyle = neon; g.globalAlpha = 0.55 + r2 * 0.35; g.fillRect(X + 7, Y + 8, TILE - 14, 9); g.globalAlpha = 1;
                    if (detail) { g.fillStyle = 'rgba(0,0,0,0.45)'; for (let i = 0; i < 3; i++) g.fillRect(X + 8, Y + 9 + i * 3, TILE - 16, 1); g.fillStyle = '#d8d8e0'; g.fillRect(X + 10, Y + 21, 3, 3); g.fillStyle = neon; g.fillRect(X + 18, Y + 21, 3, 3); }
                } else {
                    g.fillStyle = shade(P.wall, 1.25 + r1 * 0.2);
                    g.fillRect(X, Y, TILE, TILE - (below !== T.WALL ? 10 : 0));
                    if (zone.gen === 'tundra') { g.fillStyle = 'rgba(255,255,255,0.75)'; g.fillRect(X, Y, TILE, 7 + r2 * 5); }
                    if (zone.gen === 'hall') { g.fillStyle = 'rgba(255,255,255,0.035)'; g.fillRect(X, Y + 10, TILE, 1); g.fillRect(X + ((ty % 2) ? 8 : 22), Y, 1, 10); g.fillRect(X + ((ty % 2) ? 22 : 8), Y + 11, 1, 11); }
                    if (detail) { g.fillStyle = 'rgba(0,0,0,0.18)'; g.fillRect(X + r1 * 20, Y + r2 * 16, 6, 4); }
                }
                if (below !== T.WALL && below !== T.BUILDING) { g.fillStyle = 'rgba(0,0,0,0.35)'; g.fillRect(X, Y + TILE - 6, TILE, 6); }
            } else if (t === T.WATER) {
                if (detail) { g.strokeStyle = 'rgba(255,255,255,0.18)'; g.lineWidth = 2; g.beginPath(); g.moveTo(X + 4 + r1 * 10, Y + 10 + r2 * 12); g.lineTo(X + 14 + r1 * 10, Y + 10 + r2 * 12); g.stroke(); }
                if (G.get(m, tx, ty - 1) !== T.WATER) { g.fillStyle = 'rgba(0,0,0,0.25)'; g.fillRect(X, Y, TILE, 5); }
            } else if (t === T.LAVA) {
                g.fillStyle = '#ffb347'; g.globalAlpha = 0.35 + r1 * 0.3;
                g.beginPath(); g.arc(X + 6 + r1 * 20, Y + 6 + r2 * 20, 4 + r2 * 5, 0, Math.PI * 2); g.fill();
                g.globalAlpha = 1;
            } else if (t === T.ICE) {
                if (detail) { g.strokeStyle = 'rgba(255,255,255,0.45)'; g.lineWidth = 1.5; g.beginPath(); g.moveTo(X + r1 * 24, Y + 4); g.lineTo(X + 4 + r2 * 24, Y + 26); g.stroke(); }
            } else if (t === T.SHALLOW) {
                // tide flats: sand showing through, ripples on top
                g.fillStyle = 'rgba(230,214,170,0.18)'; g.fillRect(X + r1 * 18, Y + r2 * 18, 10, 8);
                if (detail) { g.strokeStyle = 'rgba(255,255,255,0.28)'; g.lineWidth = 1.5; g.beginPath(); g.arc(X + 8 + r1 * 16, Y + 8 + r2 * 16, 4 + r1 * 3, 0.2, 2.6); g.stroke(); }
            } else if (t === T.VOID) {
                // open sky below the isles: far stars, and the cliff edge's shadow under land
                if (detail && r1 < 0.35) { g.fillStyle = 'rgba(255,255,255,' + (0.25 + r2 * 0.5) + ')'; g.fillRect(X + r2 * 30, Y + r1 * 80 % 30, 1.5, 1.5); }
                const up = G.get(m, tx, ty - 1);
                if (up !== T.VOID) { g.fillStyle = shade(P.wall, 0.8); g.fillRect(X, Y, TILE, 10); g.fillStyle = 'rgba(0,0,0,0.35)'; g.fillRect(X, Y + 10, TILE, 6); }
            } else if (t === T.ARENA) {
                if ((tx + ty) % 2 === 0) { g.fillStyle = 'rgba(255,255,255,0.03)'; g.fillRect(X, Y, TILE, TILE); }
            } else if (zone.gen === 'hall') {
                // the Hall of Gods: cracked flagstones, and a dark runner with a worn gold edge along the pathway
                if (t === T.PATH) {
                    g.fillStyle = 'rgba(201,162,58,0.28)';
                    if (G.get(m, tx - 1, ty) !== T.PATH) g.fillRect(X, Y, 2, TILE);
                    if (G.get(m, tx + 1, ty) !== T.PATH) g.fillRect(X + TILE - 2, Y, 2, TILE);
                } else {
                    g.strokeStyle = 'rgba(0,0,0,0.45)'; g.lineWidth = 1; g.strokeRect(X + 0.5, Y + 0.5, TILE - 1, TILE - 1);
                    if (detail && r1 < 0.18) { g.strokeStyle = 'rgba(255,255,255,0.05)'; g.beginPath(); g.moveTo(X + r2 * 24, Y + 4); g.lineTo(X + 8 + r1 * 40, Y + 18); g.lineTo(X + 4 + r2 * 20, Y + 30); g.stroke(); }
                }
            } else if (zone.gen === 'arcade') {
                // the Neon Arcade's carpet: little neon shapes; its aisles (paths) edged in light
                if (t === T.PATH) {
                    g.fillStyle = 'rgba(255,79,216,0.45)';
                    if (G.get(m, tx - 1, ty) !== T.PATH) g.fillRect(X, Y, 2, TILE);
                    if (G.get(m, tx + 1, ty) !== T.PATH) g.fillRect(X + TILE - 2, Y, 2, TILE);
                    if (G.get(m, tx, ty - 1) !== T.PATH) g.fillRect(X, Y, TILE, 2);
                    if (G.get(m, tx, ty + 1) !== T.PATH) g.fillRect(X, Y + TILE - 2, TILE, 2);
                } else if (detail && r1 < 0.45) {
                    g.fillStyle = ['rgba(94,231,255,0.35)', 'rgba(255,79,216,0.35)', 'rgba(248,184,0,0.35)'][Math.floor(r2 * 3) % 3];
                    const sx = X + 6 + tileHash(tx, ty, 11) * 18, sy = Y + 6 + tileHash(tx, ty, 12) * 18;
                    if (r1 < 0.15) { g.fillRect(sx, sy, 5, 2); g.fillRect(sx + 1.5, sy - 1.5, 2, 5); } else if (r1 < 0.3) g.fillRect(sx, sy, 3, 3); else { g.beginPath(); g.arc(sx, sy, 2, 0, Math.PI * 2); g.fill(); }
                }
            } else if (detail) {
                // speckles: grass tufts, pebbles, ash or snow
                g.fillStyle = t === T.PATH || t === T.PLAZA ? 'rgba(0,0,0,0.12)' : zone.gen === 'tundra' ? 'rgba(120,150,170,0.25)' : 'rgba(255,255,255,0.07)';
                for (let i = 0; i < 3; i++) g.fillRect(X + tileHash(tx, ty, 11 + i) * 28, Y + tileHash(tx, ty, 21 + i) * 28, 3, 2);
                if (t === T.PLAZA) { g.strokeStyle = 'rgba(0,0,0,0.14)'; g.lineWidth = 1; g.strokeRect(X + 0.5, Y + 0.5, TILE - 1, TILE - 1); }
            }
        }
        ch.row = yEnd;
        ch.done = ch.row >= CHUNK;
    }
    // Each chunk is a 1 MB picture: a zone walked end to end would keep 40-70 of them. The ones furthest from the camera go
    // past this many (and their memory is handed back at once: phones, Safari above all, reload a tab that holds too much).
    // (never fewer than the screen and the band drawn ahead around it need, or a big screen would draw the same chunks again
    // and again)
    function chunkCap() {
        const r = chunkRange(CHUNK * TILE * 0.75);
        return Math.max(E.perf === 'low' || E.w * E.h < 600000 ? 24 : 40, (r.x1 - r.x0 + 2) * (r.y1 - r.y0 + 2));
    }
    function freeCanvas(cv) { try { cv.width = 0; cv.height = 0; } catch (e) {} }
    function dropChunks(all) {
        if (!all && E.chunks.size <= chunkCap()) return;
        const cs = CHUNK * TILE, mx = (E.cam.x + viewW() / 2) / cs, my = (E.cam.y + viewH() / 2) / cs;
        const list = [...E.chunks].map(([k, ch]) => { const [x, y] = k.split(',').map(Number); return { k, ch, d: Math.hypot(x + 0.5 - mx, y + 0.5 - my) }; });
        list.sort((a, b) => b.d - a.d);
        for (const it of list) {
            if (!all && E.chunks.size <= chunkCap()) break;
            if (!all && it.ch.used === E.frames) continue; // on screen this frame
            freeCanvas(it.ch.cv);
            E.chunks.delete(it.k);
        }
    }
    function chunkRange(pad) {
        const cs = CHUNK * TILE, m = E.map;
        return { x0: Math.max(0, Math.floor((E.cam.x - pad) / cs)), y0: Math.max(0, Math.floor((E.cam.y - pad) / cs)),
            x1: Math.min(Math.ceil(m.w / CHUNK) - 1, Math.floor((E.cam.x + viewW() + pad) / cs)), y1: Math.min(Math.ceil(m.h / CHUNK) - 1, Math.floor((E.cam.y + viewH() + pad) / cs)) };
    }
    // Some tiles of this map changed (a door opened, a lair's wall fell): the ground is drawn again over the old picture, a few
    // rows a frame, instead of being thrown away and redrawn all at once (a stall the moment a dungeon room was cleared)
    function invalidateGround() {
        for (const ch of E.chunks.values()) { if (ch.row > 0) ch.stale = true; ch.row = 0; ch.done = false; }
        E.minimapCache = null;
    }
    function drawGround(ctx) {
        const r = chunkRange(0);
        for (let cy = r.y0; cy <= r.y1; cy++) for (let cx = r.x0; cx <= r.x1; cx++) {
            const key = cx + ',' + cy;
            let ch = E.chunks.get(key);
            if (!ch) { ch = newChunk(); E.chunks.set(key, ch); }
            // on screen: the rest of it now (one being redrawn over its old picture: four rows a frame)
            if (!ch.done) { drawChunk(ch, cx, cy, ch.stale ? 4 : CHUNK); if (ch.done) ch.stale = false; }
            ch.used = E.frames;
            ctx.drawImage(ch.cv, cx * CHUNK * TILE, cy * CHUNK * TILE);
        }
    }
    // Chunks within a chunk's width of the screen, drawn a few rows at a time while this frame is still under budget: the
    // nearest first, and those the player is walking towards before those behind.
    function prewarmGround(frameStart) {
        if (!E.map) return;
        const budget = E.perf === 'low' ? 3 : 5; // ms of the frame
        if (performance.now() - frameStart > 12) return;
        const cs = CHUNK * TILE, r = chunkRange(cs * 0.75);
        const p = WHW.game && WHW.game.player, vx = p ? p.vx || 0 : 0, vy = p ? p.vy || 0 : 0;
        const mx = (E.cam.x + viewW() / 2) / cs, my = (E.cam.y + viewH() / 2) / cs;
        const todo = [];
        for (let cy = r.y0; cy <= r.y1; cy++) for (let cx = r.x0; cx <= r.x1; cx++) {
            const ch = E.chunks.get(cx + ',' + cy);
            if (ch && ch.done) continue;
            const dx = cx + 0.5 - mx, dy = cy + 0.5 - my;
            todo.push({ cx, cy, ch, d: Math.hypot(dx, dy) - (dx * vx + dy * vy > 0 ? 0.75 : 0) });
        }
        if (!todo.length) return;
        todo.sort((a, b) => a.d - b.d);
        const until = performance.now() + budget;
        for (const t of todo) {
            if (!t.ch) { t.ch = newChunk(); E.chunks.set(t.cx + ',' + t.cy, t.ch); }
            while (!t.ch.done) {
                drawChunk(t.ch, t.cx, t.cy, 2);
                if (t.ch.done) t.ch.stale = false;
                if (performance.now() > until) { dropChunks(false); return; }
            }
        }
        dropChunks(false);
    }
    // A tiny picture of the whole map for the minimap (one pixel per tile)
    function minimapBase() {
        if (E.minimapCache) return E.minimapCache;
        const m = E.map, P = D.ZONES[m.id].palette, T = G.T;
        const cv = document.createElement('canvas');
        cv.width = m.w; cv.height = m.h;
        const g = cv.getContext('2d');
        const data = g.createImageData(m.w, m.h);
        const rgb = (hex) => { const n = parseInt((hex || '#000000').slice(1), 16); return [n >> 16, (n >> 8) & 255, n & 255]; };
        const cols = { [T.FLOOR]: rgb(P.floor), [T.FLOOR2]: rgb(P.floor2), [T.PATH]: rgb(P.path), [T.WALL]: rgb(shadeHex(P.wall, 0.6)), [T.WATER]: rgb(P.water || P.wall),
            [T.LAVA]: rgb(P.hazard || '#ff5a1f'), [T.ICE]: rgb(P.ice || '#a9dcf5'), [T.PLAZA]: rgb(P.plaza || P.path), [T.BUILDING]: [70, 60, 50], [T.ARENA]: [120, 40, 50],
            [T.SHALLOW]: rgb(P.shallow || P.water || '#4fa3bd'), [T.VOID]: rgb(P.void || '#0b0d18') };
        for (let i = 0; i < m.tiles.length; i++) { const c = cols[m.tiles[i]] || [0, 0, 0]; data.data.set([c[0], c[1], c[2], 255], i * 4); }
        g.putImageData(data, 0, 0);
        E.minimapCache = cv;
        return cv;
    }
    function shadeHex(hex, f) { const n = parseInt(hex.slice(1), 16); const c = (v) => Math.max(0, Math.min(255, Math.round(v * f))); return '#' + [c(n >> 16), c((n >> 8) & 255), c(n & 255)].map(v => v.toString(16).padStart(2, '0')).join(''); }

    // ---------------- effects ----------------
    function burst(x, y, color, n = 8, speed = 120, opts = {}) {
        if (E.perf === 'low') n = Math.ceil(n / 3);
        for (let i = 0; i < n; i++) {
            const a = (opts.angle !== undefined ? opts.angle + (Math.random() - 0.5) * (opts.spread || 1.2) : Math.random() * Math.PI * 2);
            const v = speed * (0.4 + Math.random() * 0.8);
            E.particles.push({ x, y, vx: Math.cos(a) * v, vy: Math.sin(a) * v, life: opts.life || 0.5, max: opts.life || 0.5, color, size: opts.size || 3, grav: opts.grav || 0 });
        }
        const max = E.perf === 'low' ? 200 : E.perf === 'medium' ? 400 : 600;
        if (E.particles.length > max) E.particles.splice(0, E.particles.length - max);
    }
    // Text is slow to draw on a canvas (outlined text most of all), and the same names and signs are drawn every frame:
    // each label is drawn once into a small picture at the current sharpness, then stamped.
    // o: { font, fill, stroke (outline colour, optional), lw (outline width, 3), align ('center', 'left' or 'right') }.
    // Drawn with the baseline at y, like fillText.
    const labelCache = new Map();
    let measureCtx = null;
    // part: '' (outline and fill), 'stroke' (only the outline) or 'fill' (only the fill: numbers, below)
    function labelSprite(text, o, scale, part) {
        const lw = o.stroke ? (o.lw || 3) : 0, align = o.align || 'center';
        const key = text + '\u0001' + o.font + '\u0001' + (part === 'stroke' ? '' : o.fill) + '\u0001' + (o.stroke || '') + lw + align + '\u0001' + scale.toFixed(2) + (part || '');
        let sp = labelCache.get(key);
        if (sp) { labelCache.delete(key); labelCache.set(key, sp); } // the most recently used last: those go last
        else {
            // past 400, forget the hundred used longest ago (and hand back their memory)
            if (labelCache.size > 400) { let n = 0; for (const [k, old] of labelCache) { freeCanvas(old.cv); labelCache.delete(k); if (++n >= 100) break; } }
            if (!measureCtx) measureCtx = document.createElement('canvas').getContext('2d');
            measureCtx.font = o.font;
            const size = Number((o.font.match(/(\d+(?:\.\d+)?)px/) || [0, 14])[1]);
            const pad = lw + 2, asc = Math.ceil(size * 1.15), adv = measureCtx.measureText(text).width;
            const w = Math.ceil(adv) + pad * 2, h = Math.ceil(size * 1.55) + pad * 2;
            const cv = document.createElement('canvas');
            cv.width = Math.max(1, Math.ceil(w * scale)); cv.height = Math.max(1, Math.ceil(h * scale));
            const c = cv.getContext('2d');
            c.scale(scale, scale);
            c.font = o.font; c.textAlign = 'left';
            if (lw && part !== 'fill') { c.lineWidth = lw; c.strokeStyle = o.stroke; c.strokeText(text, pad, pad + asc); }
            if (part !== 'stroke') { c.fillStyle = o.fill; c.fillText(text, pad, pad + asc); }
            sp = { cv, w, h, pad, adv, ax: align === 'left' ? pad : align === 'right' ? w - pad : w / 2, ay: pad + asc };
            labelCache.set(key, sp);
        }
        return sp;
    }
    function label(ctx, text, x, y, o) {
        text = String(text);
        const m = ctx.getTransform(), scale = Math.hypot(m.a, m.b);
        const sp = labelSprite(text, o, scale, '');
        ctx.drawImage(sp.cv, x - sp.ax, y - sp.ay, sp.w, sp.h);
    }
    // A number that floats up (damage, healing): nearly every one is different, and drawing each into a picture of its own
    // made a new canvas for almost every hit (a big part of a busy fight's frame on a phone). These are put together from
    // pictures of single characters instead: every outline first, then every fill, so no outline crosses a neighbour.
    const NUMBER_RE = /^[-+]?\d{1,9}!?$/;
    function labelNumber(ctx, text, x, y, o) {
        const m = ctx.getTransform(), scale = Math.hypot(m.a, m.b);
        let w = 0;
        for (let i = 0; i < text.length; i++) w += labelSprite(text[i], o, scale, 'fill').adv;
        for (const part of o.stroke ? ['stroke', 'fill'] : ['fill']) {
            let cx = x - w / 2;
            for (let i = 0; i < text.length; i++) {
                const sp = labelSprite(text[i], o, scale, part);
                ctx.drawImage(sp.cv, cx - sp.pad, y - sp.ay, sp.w, sp.h);
                cx += sp.adv;
            }
        }
    }
    // labels drawn before the page's font arrived would keep the fallback font
    try { document.fonts.addEventListener('loadingdone', () => { for (const sp of labelCache.values()) freeCanvas(sp.cv); labelCache.clear(); }); } catch (e) {}
    function floatText(x, y, text, color = '#fff', size = 14, life = 0.9) {
        E.texts.push({ x, y, text: String(text), color, size, life, max: life, vy: -38 });
        if (E.texts.length > 80) E.texts.shift();
    }
    function addShake(n) { if (!E.reducedMotion && WHW.settings && WHW.settings.shake) E.shake = Math.min(14, E.shake + n); }
    function addHitStop(s) { if (!E.reducedMotion && WHW.settings && WHW.settings.shake) E.hitStop = Math.max(E.hitStop, s); }
    // Once a frame, for the game time that frame stepped through (the slowing is per 1/120 s step, as before)
    function stepEffects(dt) {
        const pf = Math.pow(0.96, dt / DT), tf = Math.pow(0.97, dt / DT);
        let n = 0;
        for (const p of E.particles) {
            p.x += p.vx * dt; p.y += p.vy * dt; p.vy += p.grav * dt; p.vx *= pf; p.vy *= pf; p.life -= dt;
            if (p.life > 0) E.particles[n++] = p;
        }
        E.particles.length = n;
        n = 0;
        for (const t of E.texts) { t.y += t.vy * dt; t.vy *= tf; t.life -= dt; if (t.life > 0) E.texts[n++] = t; }
        E.texts.length = n;
    }
    function drawEffects(ctx) {
        for (const p of E.particles) {
            ctx.globalAlpha = Math.max(0, p.life / p.max);
            ctx.fillStyle = p.color;
            ctx.fillRect(p.x - p.size / 2, p.y - p.size / 2, p.size, p.size);
        }
        ctx.globalAlpha = 1;
        for (const t of E.texts) {
            ctx.globalAlpha = Math.min(1, t.life / t.max * 2);
            const o = { font: `800 ${t.size}px Inter, system-ui, sans-serif`, fill: t.color, stroke: 'rgba(0,0,0,0.7)' };
            if (NUMBER_RE.test(t.text)) labelNumber(ctx, t.text, t.x, t.y, o);
            else label(ctx, t.text, t.x, t.y, o);
        }
        ctx.globalAlpha = 1;
    }

    // ---------------- loop ----------------
    let last = 0, acc = 0;
    // A phone held upright has its thumb controls over the bottom of the screen: the camera keeps you a little above the
    // middle, in the part you can see
    const camLift = () => (E.isTouch && E.h > E.w * 1.2 ? viewH() * 0.09 : 0);
    // ...and may go past a map's bottom edge by about the height the controls cover: otherwise, near that edge (where you
    // arrive in the Greenwood, say) the camera stopped and you stood under your own Attack and ability buttons
    const camBottomRoom = () => (E.isTouch && E.h > E.w * 1.2 ? viewH() * 0.35 : 0);
    function updateCamera(dt) {
        const p = WHW.game && WHW.game.player;
        if (!p || !E.map) return;
        const tx = p.x - viewW() / 2, ty = p.y - viewH() / 2 + camLift();
        const f = 1 - Math.exp(-10 * dt);
        E.cam.x += (tx - E.cam.x) * f; E.cam.y += (ty - E.cam.y) * f;
        const mw = E.map.w * TILE, mh = E.map.h * TILE;
        E.cam.x = mw <= viewW() ? (mw - viewW()) / 2 : Math.max(0, Math.min(mw - viewW(), E.cam.x));
        E.cam.y = mh <= viewH() ? (mh - viewH()) / 2 : Math.max(0, Math.min(mh - viewH() + camBottomRoom(), E.cam.y));
        E.shake *= Math.exp(-12 * dt);
        if (E.shake < 0.2) E.shake = 0;
    }
    function snapCamera() {
        const p = WHW.game && WHW.game.player;
        if (!p) return;
        E.cam.x = p.x - viewW() / 2; E.cam.y = p.y - viewH() / 2 + camLift();
        updateCamera(1);
    }
    let fpsCount = 0, fpsAt = 0;
    function frame(ts) {
        requestAnimationFrame(frame);
        const frameStart = performance.now();
        // the frame-rate limit (a little early is fine: a 144 Hz screen limited to 60 draws every other refresh)
        const since = ts - last;
        if (E.fpsCap && since < 1000 / E.fpsCap - 3) return;
        // behind a menu the game is paused: a few frames a second is plenty for the picture under it
        if (E.paused && since < 100) return;
        const dt = Math.min(0.25, Math.max(0, since / 1000));
        last = ts;
        if (!E.paused && !document.hidden && WHW.step) {
            acc = Math.min(acc + dt, MAX_STEPS * DT);
            let stepped = 0;
            while (acc >= DT) {
                if (E.hitStop > 0) E.hitStop -= DT;
                else { E.mouse.world = null; WHW.step(DT); E.time += DT; stepped += DT; }
                updateCamera(DT);
                acc -= DT;
            }
            if (stepped) stepEffects(stepped);
            E.mouse.pressed = false; E.mouse.released = false; E.pressedKeys.clear();
        } else acc = 0;
        render();
        if (!E.paused) prewarmGround(frameStart);
        E.frames++;
        fpsCount++;
        if (ts - fpsAt >= 1000) { E.fps = Math.round(fpsCount * 1000 / (ts - fpsAt)); fpsCount = 0; fpsAt = ts; }
    }
    function render() {
        const ctx = E.ctx;
        ctx.setTransform(1, 0, 0, 1, 0, 0);
        ctx.fillStyle = '#07090c';
        ctx.fillRect(0, 0, E.canvas.width, E.canvas.height);
        if (!E.map) return;
        E.shakeX = E.shake ? (Math.random() - 0.5) * E.shake : 0;
        E.shakeY = E.shake ? (Math.random() - 0.5) * E.shake : 0;
        const s = E.dpr * E.zoom;
        ctx.setTransform(s, 0, 0, s, -(E.cam.x + E.shakeX) * s, -(E.cam.y + E.shakeY) * s);
        drawGround(ctx);
        if (WHW.drawWorld) WHW.drawWorld(ctx);
        drawEffects(ctx);
        ctx.setTransform(E.dpr, 0, 0, E.dpr, 0, 0);
        if (WHW.drawOverlay) WHW.drawOverlay(ctx);
    }
    function start() {
        E.canvas = document.getElementById('wCanvas');
        E.ctx = E.canvas.getContext('2d');
        resize();
        bindInput();
        if (window.matchMedia && window.matchMedia('(pointer: coarse)').matches) setTouch(true);
        requestAnimationFrame((ts) => { last = ts - 1000 / 60; fpsAt = ts; frame(ts); });
    }

    Object.assign(E, {
        start, resize, img, screenToWorld, worldToScreen, viewW, viewH, aimPoint, moveInput, consumeKey,
        setMap, invalidateGround, tileAt, collideTiles, collideCircles, move, wallBetween, buildNodeGrid, nodesNear, minimapBase, shadeHex,
        burst, floatText, label, addShake, addHitStop, snapCamera, readSetting, applyGraphics,
    });
})();
