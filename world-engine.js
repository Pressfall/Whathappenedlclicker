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

    function readSetting(key, fallback) { try { const v = localStorage.getItem(key); return v === null ? fallback : v; } catch (e) { return fallback; } }
    const reducedMotion = (() => { try { return window.matchMedia('(prefers-reduced-motion: reduce)').matches; } catch (e) { return false; } })();

    const E = WHW.engine = {
        DT, TILE, canvas: null, ctx: null, w: 0, h: 0, dpr: 1, zoom: 1,
        perf: readSetting('whathappened_performance', 'high'), reducedMotion,
        cam: { x: 0, y: 0 }, shake: 0, shakeX: 0, shakeY: 0,
        mouse: { sx: 0, sy: 0, x: 0, y: 0, down: false, rmb: false, pressed: false, released: false, moved: false, type: 'mouse' },
        keys: new Set(), pressedKeys: new Set(),
        touch: { stickId: null, sx0: 0, sy0: 0, mx: 0, my: 0, aimId: null, ax0: 0, ay0: 0, ax: 0, ay: 0, active: false },
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
        E.dpr = Math.min(maxDpr, window.devicePixelRatio || 1);
        E.w = window.innerWidth; E.h = window.innerHeight;
        E.zoom = E.w < 700 ? 0.85 : E.w < 1100 ? 1.1 : 1.25;
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
        window.addEventListener('blur', () => { E.keys.clear(); E.mouse.down = false; E.mouse.rmb = false; if (WHW.onRelease) WHW.onRelease(); });
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
            E.mouse.sx = ev.clientX; E.mouse.sy = ev.clientY; E.mouse.moved = true;
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
        // the left stick
        const stick = document.getElementById('touchStick');
        if (stick) {
            stick.addEventListener('pointerdown', (ev) => { ev.preventDefault(); E.touch.stickId = ev.pointerId; const r = stick.getBoundingClientRect(); E.touch.sx0 = r.left + r.width / 2; E.touch.sy0 = r.top + r.height / 2; stickMove(ev); try { stick.setPointerCapture(ev.pointerId); } catch (e) {} });
            stick.addEventListener('pointermove', (ev) => { if (ev.pointerId === E.touch.stickId) stickMove(ev); });
            const end = (ev) => { if (ev.pointerId === E.touch.stickId) { E.touch.stickId = null; E.touch.mx = E.touch.my = 0; knob(0, 0); } };
            stick.addEventListener('pointerup', end); stick.addEventListener('pointercancel', end);
        }
    }
    function knob(x, y) { const k = document.getElementById('touchKnob'); if (k) k.style.transform = `translate(${x}px, ${y}px)`; }
    function stickMove(ev) {
        const dx = ev.clientX - E.touch.sx0, dy = ev.clientY - E.touch.sy0;
        const len = Math.hypot(dx, dy), max = 50;
        const f = len > max ? max / len : 1;
        E.touch.mx = dx * f / max; E.touch.my = dy * f / max;
        knob(dx * f, dy * f);
    }
    // right side of the screen: drag to aim (weapons point along the drag; the bow pulls back with it)
    function touchDown(ev) {
        setTouch(true);
        if (E.touch.aimId !== null) return;
        E.touch.aimId = ev.pointerId;
        E.touch.ax0 = E.touch.ax = ev.clientX; E.touch.ay0 = E.touch.ay = ev.clientY;
        E.touch.active = true;
        E.mouse.down = true; E.mouse.pressed = true; E.mouse.type = 'touch';
        E.mouse.sx = ev.clientX; E.mouse.sy = ev.clientY;
        try { E.canvas.setPointerCapture(ev.pointerId); } catch (e) {}
        if (WHW.onPress) WHW.onPress();
    }
    function touchMove(ev) { if (ev.pointerId !== E.touch.aimId) return; E.touch.ax = ev.clientX; E.touch.ay = ev.clientY; E.mouse.sx = ev.clientX; E.mouse.sy = ev.clientY; }
    function touchUp(ev) {
        if (ev.pointerId !== E.touch.aimId) return;
        E.touch.aimId = null; E.touch.active = false;
        E.mouse.down = false; E.mouse.released = true;
        if (WHW.onRelease) WHW.onRelease();
    }
    function setTouch(on) {
        if (E.isTouch === on) return;
        E.isTouch = on;
        const ui = document.getElementById('touchUi');
        if (ui) ui.hidden = !on;
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
        E.map = m;
        E.chunks = new Map();
        E.minimapCache = null;
        E.nodeGrid = null;
    }
    const tileAt = (wx, wy) => G.get(E.map, Math.floor(wx / TILE), Math.floor(wy / TILE));
    const blocksMove = (t) => G.isSolid(t);
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
                if (!blocksMove(G.get(m, tx, ty))) continue;
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
    // Static things (nodes) by grid cell, for fast "what's near me"
    function buildNodeGrid(nodes) {
        const g = new Map();
        for (const n of nodes) {
            const k = Math.floor(n.x / 128) + ',' + Math.floor(n.y / 128);
            if (!g.has(k)) g.set(k, []);
            g.get(k).push(n);
        }
        E.nodeGrid = g;
    }
    function nodesNear(x, y, r) {
        const out = [];
        if (!E.nodeGrid) return out;
        const x0 = Math.floor((x - r) / 128), x1 = Math.floor((x + r) / 128), y0 = Math.floor((y - r) / 128), y1 = Math.floor((y + r) / 128);
        for (let gy = y0; gy <= y1; gy++) for (let gx = x0; gx <= x1; gx++) { const l = E.nodeGrid.get(gx + ',' + gy); if (l) for (const n of l) out.push(n); }
        return out;
    }

    // ---------------- ground chunks ----------------
    function shade(hex, f) {
        const n = parseInt(hex.slice(1), 16);
        const c = (v) => Math.max(0, Math.min(255, Math.round(v * f)));
        return `rgb(${c(n >> 16)},${c((n >> 8) & 255)},${c(n & 255)})`;
    }
    function tileHash(x, y, s = 0) { let h = (x * 374761393 + y * 668265263 + s * 2147483647) | 0; h = (h ^ (h >>> 13)) * 1274126177; return ((h ^ (h >>> 16)) >>> 0) / 4294967296; }
    function drawChunk(cx, cy) {
        const m = E.map;
        const zone = D.ZONES[m.id];
        const P = zone.palette;
        const cv = document.createElement('canvas');
        cv.width = CHUNK * TILE; cv.height = CHUNK * TILE;
        const g = cv.getContext('2d');
        const T = G.T;
        const colorOf = (t) => ({
            [T.FLOOR]: P.floor, [T.FLOOR2]: P.floor2, [T.PATH]: P.path, [T.WALL]: P.wall, [T.WATER]: P.water || P.wall,
            [T.LAVA]: P.hazard || '#ff5a1f', [T.ICE]: P.ice || '#a9dcf5', [T.PLAZA]: P.plaza || P.path, [T.BUILDING]: '#2a2420', [T.ARENA]: shade(P.floor, 0.82),
        })[t];
        const detail = E.perf !== 'low';
        for (let y = 0; y < CHUNK; y++) for (let x = 0; x < CHUNK; x++) {
            const tx = cx * CHUNK + x, ty = cy * CHUNK + y;
            if (tx >= m.w || ty >= m.h) continue;
            const t = G.get(m, tx, ty);
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
                } else {
                    g.fillStyle = shade(P.wall, 1.25 + r1 * 0.2);
                    g.fillRect(X, Y, TILE, TILE - (below !== T.WALL ? 10 : 0));
                    if (zone.gen === 'tundra') { g.fillStyle = 'rgba(255,255,255,0.75)'; g.fillRect(X, Y, TILE, 7 + r2 * 5); }
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
            } else if (t === T.ARENA) {
                if ((tx + ty) % 2 === 0) { g.fillStyle = 'rgba(255,255,255,0.03)'; g.fillRect(X, Y, TILE, TILE); }
            } else if (detail) {
                // speckles: grass tufts, pebbles, ash or snow
                g.fillStyle = t === T.PATH || t === T.PLAZA ? 'rgba(0,0,0,0.12)' : zone.gen === 'tundra' ? 'rgba(120,150,170,0.25)' : 'rgba(255,255,255,0.07)';
                for (let i = 0; i < 3; i++) g.fillRect(X + tileHash(tx, ty, 11 + i) * 28, Y + tileHash(tx, ty, 21 + i) * 28, 3, 2);
                if (t === T.PLAZA) { g.strokeStyle = 'rgba(0,0,0,0.14)'; g.lineWidth = 1; g.strokeRect(X + 0.5, Y + 0.5, TILE - 1, TILE - 1); }
            }
        }
        return cv;
    }
    function drawGround(ctx) {
        const m = E.map;
        const x0 = Math.max(0, Math.floor(E.cam.x / (CHUNK * TILE))), y0 = Math.max(0, Math.floor(E.cam.y / (CHUNK * TILE)));
        const x1 = Math.floor((E.cam.x + viewW()) / (CHUNK * TILE)), y1 = Math.floor((E.cam.y + viewH()) / (CHUNK * TILE));
        for (let cy = y0; cy <= y1; cy++) for (let cx = x0; cx <= x1; cx++) {
            if (cx * CHUNK >= m.w || cy * CHUNK >= m.h) continue;
            const key = cx + ',' + cy;
            let ch = E.chunks.get(key);
            if (!ch) { ch = drawChunk(cx, cy); E.chunks.set(key, ch); }
            ctx.drawImage(ch, cx * CHUNK * TILE, cy * CHUNK * TILE);
        }
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
            [T.LAVA]: rgb(P.hazard || '#ff5a1f'), [T.ICE]: rgb(P.ice || '#a9dcf5'), [T.PLAZA]: rgb(P.plaza || P.path), [T.BUILDING]: [70, 60, 50], [T.ARENA]: [120, 40, 50] };
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
        if (E.particles.length > 600) E.particles.splice(0, E.particles.length - 600);
    }
    function floatText(x, y, text, color = '#fff', size = 14, life = 0.9) {
        E.texts.push({ x, y, text: String(text), color, size, life, max: life, vy: -38 });
        if (E.texts.length > 80) E.texts.shift();
    }
    function addShake(n) { if (!E.reducedMotion && WHW.settings && WHW.settings.shake) E.shake = Math.min(14, E.shake + n); }
    function addHitStop(s) { if (!E.reducedMotion && WHW.settings && WHW.settings.shake) E.hitStop = Math.max(E.hitStop, s); }
    function stepEffects(dt) {
        for (const p of E.particles) { p.x += p.vx * dt; p.y += p.vy * dt; p.vy += p.grav * dt; p.vx *= 0.96; p.vy *= 0.96; p.life -= dt; }
        E.particles = E.particles.filter(p => p.life > 0);
        for (const t of E.texts) { t.y += t.vy * dt; t.vy *= 0.97; t.life -= dt; }
        E.texts = E.texts.filter(t => t.life > 0);
    }
    function drawEffects(ctx) {
        for (const p of E.particles) {
            ctx.globalAlpha = Math.max(0, p.life / p.max);
            ctx.fillStyle = p.color;
            ctx.fillRect(p.x - p.size / 2, p.y - p.size / 2, p.size, p.size);
        }
        ctx.globalAlpha = 1;
        ctx.textAlign = 'center';
        for (const t of E.texts) {
            ctx.globalAlpha = Math.min(1, t.life / t.max * 2);
            ctx.font = `800 ${t.size}px Inter, system-ui, sans-serif`;
            ctx.lineWidth = 3; ctx.strokeStyle = 'rgba(0,0,0,0.7)';
            ctx.strokeText(t.text, t.x, t.y);
            ctx.fillStyle = t.color;
            ctx.fillText(t.text, t.x, t.y);
        }
        ctx.globalAlpha = 1;
    }

    // ---------------- loop ----------------
    let last = 0, acc = 0;
    function updateCamera(dt) {
        const p = WHW.game && WHW.game.player;
        if (!p || !E.map) return;
        const tx = p.x - viewW() / 2, ty = p.y - viewH() / 2;
        const f = 1 - Math.exp(-10 * dt);
        E.cam.x += (tx - E.cam.x) * f; E.cam.y += (ty - E.cam.y) * f;
        const mw = E.map.w * TILE, mh = E.map.h * TILE;
        E.cam.x = mw <= viewW() ? (mw - viewW()) / 2 : Math.max(0, Math.min(mw - viewW(), E.cam.x));
        E.cam.y = mh <= viewH() ? (mh - viewH()) / 2 : Math.max(0, Math.min(mh - viewH(), E.cam.y));
        E.shake *= Math.exp(-12 * dt);
        if (E.shake < 0.2) E.shake = 0;
    }
    function snapCamera() {
        const p = WHW.game && WHW.game.player;
        if (!p) return;
        E.cam.x = p.x - viewW() / 2; E.cam.y = p.y - viewH() / 2;
        updateCamera(1);
    }
    function frame(ts) {
        const dt = Math.min(0.25, Math.max(0, (ts - last) / 1000));
        last = ts;
        if (!E.paused && !document.hidden && WHW.step) {
            acc += dt;
            while (acc >= DT) {
                if (E.hitStop > 0) E.hitStop -= DT;
                else { E.mouse.world = null; WHW.step(DT); E.time += DT; stepEffects(DT); }
                updateCamera(DT);
                acc -= DT;
            }
            E.mouse.pressed = false; E.mouse.released = false; E.pressedKeys.clear();
        } else acc = 0;
        render();
        E.frames++;
        requestAnimationFrame(frame);
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
        requestAnimationFrame((ts) => { last = ts; frame(ts); });
    }

    Object.assign(E, {
        start, resize, img, screenToWorld, worldToScreen, viewW, viewH, aimPoint, moveInput, consumeKey,
        setMap, tileAt, collideTiles, collideCircles, move, wallBetween, buildNodeGrid, nodesNear, minimapBase, shadeHex,
        burst, floatText, addShake, addHitStop, snapCamera, readSetting,
    });
})();
