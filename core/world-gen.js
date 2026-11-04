/**
 * The Wilds: map generation. Every zone is built from a fixed seed, so every player gets the same world and the same
 * node ids (saved respawn timers keep matching their nodes). Pure: tiles in a Uint8Array, positions in world px.
 *
 * Works in a browser (<script src="core/world-gen.js"> sets window.WHWorldGen, after world-data.js) and in Node.
 */
(function (root, factory) {
    if (typeof module === 'object' && module.exports) module.exports = factory(require('./world-data'));
    else root.WHWorldGen = factory(root.WHWorldData);
}(typeof self !== 'undefined' ? self : this, function (D) {
    'use strict';

    const TILE = D.TILE;
    // tile types
    // SHALLOW: tide flats you wade through slowly. VOID: the open sky under the Skyreach Isles: monsters won't step on it,
    // and a player who does falls (world-actors.js), so for reaching places it counts as a wall.
    const T = { FLOOR: 0, FLOOR2: 1, PATH: 2, WALL: 3, WATER: 4, LAVA: 5, ICE: 6, PLAZA: 7, BUILDING: 8, ARENA: 9, SHALLOW: 10, VOID: 11 };
    const SOLID = new Set([T.WALL, T.WATER, T.BUILDING]);
    const isSolid = (t) => SOLID.has(t);
    const blocksWalk = (t) => SOLID.has(t) || t === T.VOID;

    // ---------------- seeded randomness ----------------
    // one value in [0, 1) per city block
    function valueBlock(seed, bx, by) { let h = hashStr(seed + ':block:' + bx + ',' + by); h ^= h >>> 13; h = Math.imul(h, 0x5bd1e995) >>> 0; return (h >>> 8) / 16777216; }
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
    // Smooth value noise in [0, 1): two octaves over a random lattice
    function valueNoise(seed, scale) {
        const rnd = (x, y) => { let h = hashStr(seed + ':' + x + ',' + y); h ^= h >>> 13; h = Math.imul(h, 0x5bd1e995) >>> 0; return (h >>> 8) / 16777216; };
        const smooth = (t) => t * t * (3 - 2 * t);
        const layer = (x, y) => {
            const x0 = Math.floor(x), y0 = Math.floor(y), fx = smooth(x - x0), fy = smooth(y - y0);
            const a = rnd(x0, y0), b = rnd(x0 + 1, y0), c = rnd(x0, y0 + 1), d = rnd(x0 + 1, y0 + 1);
            return a + (b - a) * fx + (c - a) * fy + (a - b - c + d) * fx * fy;
        };
        return (x, y) => (layer(x / scale, y / scale) * 0.7 + layer(x / (scale / 2.3) + 97, y / (scale / 2.3) + 31) * 0.3);
    }

    // ---------------- grid helpers ----------------
    function grid(w, h, fill) { const g = new Uint8Array(w * h); g.fill(fill); return g; }
    function inside(m, x, y) { return x >= 0 && y >= 0 && x < m.w && y < m.h; }
    function get(m, x, y) { return inside(m, x, y) ? m.tiles[y * m.w + x] : T.WALL; }
    function set(m, x, y, t) { if (inside(m, x, y)) m.tiles[y * m.w + x] = t; }
    function disc(m, cx, cy, r, t, keepBorder = 2) {
        for (let y = Math.floor(cy - r); y <= Math.ceil(cy + r); y++) for (let x = Math.floor(cx - r); x <= Math.ceil(cx + r); x++) {
            if (x < keepBorder || y < keepBorder || x >= m.w - keepBorder || y >= m.h - keepBorder) continue;
            if ((x - cx) * (x - cx) + (y - cy) * (y - cy) <= r * r) set(m, x, y, t);
        }
    }
    // A wandering corridor from a to b (tile coords)
    function carve(m, a, b, r, t, noise, wobble = 5) {
        const len = Math.hypot(b.x - a.x, b.y - a.y);
        const steps = Math.max(1, Math.ceil(len * 2));
        const nx = -(b.y - a.y) / (len || 1), ny = (b.x - a.x) / (len || 1);
        for (let i = 0; i <= steps; i++) {
            const f = i / steps;
            const off = (noise(i * 0.35, 7) - 0.5) * 2 * wobble * Math.sin(Math.PI * f);
            disc(m, a.x + (b.x - a.x) * f + nx * off, a.y + (b.y - a.y) * f + ny * off, r, t);
        }
    }
    function border(m, n) {
        for (let y = 0; y < m.h; y++) for (let x = 0; x < m.w; x++) if (x < n || y < n || x >= m.w - n || y >= m.h - n) set(m, x, y, T.WALL);
    }
    // Every tile reachable from (sx, sy) without crossing solid tiles
    function flood(m, sx, sy) {
        const seen = new Uint8Array(m.w * m.h);
        const q = [sy * m.w + sx];
        if (blocksWalk(get(m, sx, sy))) return seen;
        seen[q[0]] = 1;
        while (q.length) {
            const i = q.pop(), x = i % m.w, y = (i / m.w) | 0;
            for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
                const X = x + dx, Y = y + dy;
                if (!inside(m, X, Y)) continue;
                const j = Y * m.w + X;
                if (seen[j] || blocksWalk(m.tiles[j])) continue;
                seen[j] = 1; q.push(j);
            }
        }
        return seen;
    }
    // Walls (or open sky, fill) in every pocket the player couldn't reach
    function sealUnreachable(m, from, fill = T.WALL) {
        const seen = flood(m, from.x, from.y);
        for (let i = 0; i < m.tiles.length; i++) if (!seen[i] && !blocksWalk(m.tiles[i])) m.tiles[i] = fill;
        return seen;
    }
    const px = (t) => (t + 0.5) * TILE;

    // Place things on free floor, spaced out, away from the given keep-out circles (tile coords)
    // near: optional { x, y, r } to place around (clusters), minDist: optional { x, y, d } to stay at least d away from
    function scatter(m, rng, n, opts) {
        const out = [];
        const { minGap = 1.4, takenGap = 1.3, avoid = [], allow = (t) => t === T.FLOOR || t === T.FLOOR2, taken = [], near = null, minDist = null } = opts;
        let tries = 0;
        while (out.length < n && tries < n * 80) {
            tries++;
            let x, y;
            if (near) {
                const a = rng() * Math.PI * 2, d = Math.sqrt(rng()) * near.r;
                x = Math.round(near.x + Math.cos(a) * d); y = Math.round(near.y + Math.sin(a) * d);
            } else { x = 3 + Math.floor(rng() * (m.w - 6)); y = 3 + Math.floor(rng() * (m.h - 6)); }
            if (!allow(get(m, x, y))) continue;
            if (avoid.some(a => (a.x - x) ** 2 + (a.y - y) ** 2 < a.r * a.r)) continue;
            if (minDist && (minDist.x - x) ** 2 + (minDist.y - y) ** 2 < minDist.d * minDist.d) continue;
            if (out.some(p => (p.tx - x) ** 2 + (p.ty - y) ** 2 < minGap * minGap)) continue;
            if (taken.some(p => (p.tx - x) ** 2 + (p.ty - y) ** 2 < takenGap * takenGap)) continue;
            out.push({ tx: x, ty: y });
        }
        return out;
    }

    // ---------------- town ----------------
    function buildTown(def) {
        const m = { id: def.id, w: def.w, h: def.h, tiles: grid(def.w, def.h, T.FLOOR) };
        const rng = mulberry32(hashStr(D.WORLD_SEED + ':town'));
        const n = valueNoise(D.WORLD_SEED + ':town:n', 6);
        for (let y = 0; y < m.h; y++) for (let x = 0; x < m.w; x++) if (n(x, y) > 0.55) set(m, x, y, T.FLOOR2);
        border(m, 1);
        const cx = Math.floor(m.w / 2), cy = Math.floor(m.h / 2);
        // plaza and the roads to the four gates
        for (let x = 1; x < m.w - 1; x++) { set(m, x, cy, T.PATH); set(m, x, cy + 1, T.PATH); }
        for (let y = 1; y < m.h - 1; y++) { set(m, cx, y, T.PATH); set(m, cx + 1, y, T.PATH); }
        for (let y = cy - 5; y <= cy + 5; y++) for (let x = cx - 8; x <= cx + 8; x++) set(m, x, y, T.PLAZA);
        // a little pond, out west by the trees
        disc(m, 5, cy - 7, 2.6, T.WATER);
        // buildings: { id, x, y, w, h } in tiles; the door is the middle of the bottom edge
        const B = [
            { id: 'forge', x: cx - 17, y: cy - 11, w: 7, h: 5 },
            { id: 'workbench', x: cx - 17, y: cy + 5, w: 7, h: 5 },
            { id: 'altar', x: cx + 11, y: cy + 5, w: 7, h: 5 },
            { id: 'trader', x: cx + 4, y: cy - 12, w: 6, h: 4 },
            { id: 'board', x: cx + 10, y: cy - 5, w: 3, h: 2 },
        ];
        const stations = [];
        for (const b of B) {
            for (let y = b.y; y < b.y + b.h; y++) for (let x = b.x; x < b.x + b.w; x++) set(m, x, y, T.BUILDING);
            const doorX = b.x + Math.floor(b.w / 2), doorY = b.y + b.h;
            set(m, doorX, doorY, T.PATH);
            stations.push({ id: b.id, x: b.x * TILE, y: b.y * TILE, w: b.w * TILE, h: b.h * TILE, door: { x: px(doorX), y: px(doorY) } });
        }
        // the Hall of Gods: a building you walk into (the 'hall' zone), with a path from its door down to the plaza
        const H = { x: cx - 9, y: 2, w: 8, h: 6 };
        for (let y = H.y; y < H.y + H.h; y++) for (let x = H.x; x < H.x + H.w; x++) set(m, x, y, T.BUILDING);
        const hdx = H.x + Math.floor(H.w / 2), hdy = H.y + H.h;
        for (let y = hdy; y < cy - 5; y++) { set(m, hdx - 1, y, T.PATH); set(m, hdx, y, T.PATH); }
        m.hall = { x: H.x * TILE, y: H.y * TILE, w: H.w * TILE, h: H.h * TILE, door: { x: hdx * TILE, y: px(hdy) } };
        // the Arena: a round-walled building north-east of the plaza, its door leading into the 'arena' zone
        const AR = { x: cx + 12, y: 2, w: 10, h: 7 };
        for (let y = AR.y; y < AR.y + AR.h; y++) for (let x = AR.x; x < AR.x + AR.w; x++) set(m, x, y, T.BUILDING);
        const adx = AR.x + Math.floor(AR.w / 2), ady = AR.y + AR.h;
        for (let y = ady; y < cy; y++) { set(m, adx - 1, y, T.PATH); set(m, adx, y, T.PATH); }
        m.arena = { x: AR.x * TILE, y: AR.y * TILE, w: AR.w * TILE, h: AR.h * TILE, door: { x: adx * TILE, y: px(ady) } };
        // the Waystone, south of the plaza: a standing stone in a ring of flagstones. It carries you to the Far Reaches.
        const ws = { x: cx - 5, y: cy + 9 };
        for (let y = ws.y - 2; y <= ws.y + 2; y++) for (let x = ws.x - 2; x <= ws.x + 2; x++) if ((x - ws.x) ** 2 + (y - ws.y) ** 2 <= 5) set(m, x, y, T.PLAZA);
        set(m, ws.x, ws.y, T.BUILDING);
        m.waystone = { x: px(ws.x), y: px(ws.y) };
        // where the quest givers stand
        m.npcs = npcsIn(def.id, cx, cy);
        const portals = [
            { to: 'greenwood', x: px(1), y: (cy + 1) * TILE, side: 'w' },
            { to: 'mines', x: (cx + 1) * TILE, y: px(1), side: 'n' },
            { to: 'ember', x: px(m.w - 2), y: (cy + 1) * TILE, side: 'e' },
            { to: 'frost', x: (cx + 1) * TILE, y: px(m.h - 2), side: 's' },
        ];
        // trees around the edges for looks (not choppable)
        const deco = scatter(m, rng, 40, { minGap: 2.2, avoid: [{ x: cx, y: cy, r: 12 }], allow: (t) => t === T.FLOOR || t === T.FLOOR2 })
            .filter(p => p.tx < 6 || p.ty < 5 || p.tx > m.w - 7 || p.ty > m.h - 6)
            .map(p => ({ x: px(p.tx), y: px(p.ty), kind: 'tree' }));
        m.stations = stations;
        m.portals = portals;
        m.deco = deco;
        m.nodes = [];
        m.spawns = []; m.elites = [];
        m.entry = { x: (cx + 1) * TILE, y: (cy + 1) * TILE + 8 };
        m.camp = null; m.boss = null; m.rival = null; m.exit = null;
        m.dummy = { x: (cx - 12) * TILE, y: (cy - 2) * TILE };
        return m;
    }

    // The NPCs who stand in a zone, placed from (ox, oy): the town centre, a camp, or 0,0 for spots that are the tile itself
    function npcsIn(zoneId, ox, oy) {
        return D.NPC_ORDER.filter(id => D.NPCS[id].zone === zoneId).map(id => ({ id, x: px(ox + D.NPCS[id].spot[0]), y: px(oy + D.NPCS[id].spot[1]) }));
    }

    // ---------------- inside the Hall of Gods ----------------
    // A long dark hall, entered from the bottom: a pathway runs up the middle to the far wall, the statues stand in pairs
    // along it (slot 0 and 1 nearest the door, then 2 and 3, then 4 and 5) with pillars between the pairs and a brazier
    // beside each statue. The far end is left empty on purpose. Behind its wall is the hidden room (m.secret): solid rock
    // until openSecret() carves secret.room and its doorway (secret.door, tiles) and stands up what is inside. secret.at is
    // where the far wall meets the floor, in the middle (px).
    function buildHall(def) {
        const m = { id: def.id, w: def.w, h: def.h, tiles: grid(def.w, def.h, T.WALL) };
        const left = 4, right = def.w - 5;       // floor columns
        const far = 11, near = def.h - 6;        // floor rows; the far wall is row far - 1, the door is in row near + 1
        const mid = Math.floor(def.w / 2);       // the pathway is the 4 columns mid - 2 .. mid + 1
        for (let y = far; y <= near; y++) for (let x = left; x <= right; x++) set(m, x, y, T.FLOOR);
        for (let y = far; y <= near + 1; y++) for (let x = mid - 2; x <= mid + 1; x++) set(m, x, y, y > near && (x < mid - 1 || x > mid) ? T.WALL : T.PATH);
        const statueRows = [near - 11, near - 19, near - 27];
        const statues = [], braziers = [], pillars = [];
        statueRows.forEach((y, i) => {
            for (const [sx, bx] of [[left + 1, mid - 5], [right - 1, mid + 4]]) {
                set(m, sx, y, T.BUILDING); set(m, bx, y, T.BUILDING);
                statues.push({ slot: statues.length, x: px(sx), y: px(y), side: sx < mid ? 'left' : 'right' });
                braziers.push({ x: px(bx), y: px(y) });
            }
        });
        for (const y of [near - 7, near - 15, near - 23, near - 31]) for (const x of [mid - 4, mid + 3]) { set(m, x, y, T.BUILDING); pillars.push({ x: px(x), y: px(y) }); }
        const runes = [];
        for (let y = near - 3; y > far + 3; y -= 4) runes.push({ x: mid * TILE, y: px(y) });
        m.statues = statues;
        m.braziers = braziers;
        m.pillars = pillars;
        m.runes = runes;
        // light in the dark: the braziers, a faint glow at each statue, and the grey daylight at the door
        m.lights = braziers.map(b => ({ x: b.x, y: b.y, r: 170, flicker: true }))
            .concat(statues.map(st => ({ x: st.x, y: st.y - 20, r: 90 })))
            .concat([{ x: mid * TILE, y: px(near + 1), r: 150 }]);
        m.secret = { room: { x: mid - 7, y: 1, w: 14, h: far - 3 }, door: { x: mid - 1, y: far - 2, w: 2, h: 2 }, at: { x: mid * TILE, y: far * TILE } };
        // inside: the hidden god at the back, the altar of the one-time purchases on the right, two braziers of cold fire
        const ry = m.secret.room.y;
        m.secret.statue = { god: 'briley', x: mid * TILE, y: px(ry + 2), tiles: [[mid - 1, ry + 2], [mid, ry + 2]] };
        m.secret.altar = { id: 'autoClicker', x: px(mid + 4), y: px(ry + 5), tiles: [[mid + 4, ry + 5]] };
        m.secret.braziers = [{ x: px(mid - 5), y: px(ry + 1), cold: true }, { x: px(mid + 4), y: px(ry + 1), cold: true }];
        m.secret.lights = m.secret.braziers.map(b => ({ x: b.x, y: b.y, r: 150, flicker: true, cold: true }))
            .concat([{ x: m.secret.statue.x, y: m.secret.statue.y - 20, r: 120 }, { x: m.secret.altar.x, y: m.secret.altar.y, r: 100 }]);
        m.entry = { x: mid * TILE, y: px(near - 2) };
        m.exit = { x: mid * TILE, y: px(near + 1), to: 'town' };
        m.nodes = []; m.spawns = []; m.elites = []; m.stations = []; m.portals = []; m.deco = []; m.altars = [];
        m.npcs = npcsIn(def.id, 0, 0);
        m.camp = null; m.boss = null; m.rival = null;
        return m;
    }
    // Open the Hall's hidden room: the doorway and the room become floor, and its statue, altar and braziers stand up.
    // Calling it again does nothing.
    function openSecret(m) {
        const sec = m.secret;
        if (!sec || sec.open) return m;
        sec.open = true;
        const r = sec.room, d = sec.door;
        for (let y = r.y; y < r.y + r.h; y++) for (let x = r.x; x < r.x + r.w; x++) set(m, x, y, T.FLOOR);
        for (let y = d.y; y < d.y + d.h; y++) for (let x = d.x; x < d.x + d.w; x++) set(m, x, y, T.PATH);
        for (const [x, y] of sec.statue.tiles.concat(sec.altar.tiles)) set(m, x, y, T.BUILDING);
        for (const b of sec.braziers) set(m, Math.floor(b.x / TILE), Math.floor(b.y / TILE), T.BUILDING);
        m.statues.push(sec.statue);
        m.braziers.push(...sec.braziers);
        m.lights.push(...sec.lights);
        m.altars.push(sec.altar);
        return m;
    }

    // ---------------- wild zones ----------------
    function buildWild(def) {
        const seed = D.WORLD_SEED + ':' + def.id;
        const rng = mulberry32(hashStr(seed));
        const m = { id: def.id, w: def.w, h: def.h, tiles: grid(def.w, def.h, T.FLOOR) };
        const nA = valueNoise(seed + ':a', 13), nB = valueNoise(seed + ':b', 8), nC = valueNoise(seed + ':c', 5), wob = valueNoise(seed + ':w', 3);
        const entry = { x: Math.floor(m.w / 2), y: m.h - 5 };
        const camp = { x: Math.floor(m.w / 2) + Math.floor((rng() - 0.5) * m.w * 0.3), y: Math.floor(m.h * 0.55) };
        const boss = { x: Math.floor(m.w / 2) + Math.floor((rng() - 0.5) * m.w * 0.3), y: 13 };
        const side1 = { x: 12 + Math.floor(rng() * 10), y: Math.floor(m.h * 0.35) };
        const side2 = { x: m.w - 22 + Math.floor(rng() * 10), y: Math.floor(m.h * 0.7) };
        if (def.gen === 'coast') side2.x = Math.floor(m.w * 0.58); // the sea is out east

        if (def.gen === 'cave') {
            // cellular automaton caves
            for (let i = 0; i < m.tiles.length; i++) m.tiles[i] = rng() < 0.47 ? T.WALL : T.FLOOR;
            border(m, 2);
            for (let it = 0; it < 5; it++) {
                const next = new Uint8Array(m.tiles);
                for (let y = 1; y < m.h - 1; y++) for (let x = 1; x < m.w - 1; x++) {
                    let walls = 0;
                    for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) if ((dx || dy) && get(m, x + dx, y + dy) === T.WALL) walls++;
                    next[y * m.w + x] = walls >= 5 ? T.WALL : walls <= 3 ? T.FLOOR : m.tiles[y * m.w + x];
                }
                m.tiles = next;
            }
            for (let y = 0; y < m.h; y++) for (let x = 0; x < m.w; x++) if (get(m, x, y) === T.FLOOR && nC(x, y) > 0.6) set(m, x, y, T.FLOOR2);
            // a few underground pools
            for (let y = 0; y < m.h; y++) for (let x = 0; x < m.w; x++) if (get(m, x, y) !== T.WALL && nA(x, y) < 0.2) set(m, x, y, T.WATER);
        } else {
            for (let y = 0; y < m.h; y++) for (let x = 0; x < m.w; x++) {
                const a = nA(x, y), b = nB(x, y);
                let t = nC(x, y) > 0.55 ? T.FLOOR2 : T.FLOOR;
                if (def.gen === 'meadow') { if (a < 0.27) t = T.WATER; else if (b > 0.74) t = T.WALL; }
                else if (def.gen === 'wastes') { if (a < 0.26) t = T.LAVA; else if (b > 0.72) t = T.WALL; }
                else if (def.gen === 'tundra') { if (a < 0.17) t = T.WATER; else if (a < 0.33) t = T.ICE; else if (b > 0.75) t = T.WALL; }
                else if (def.gen === 'coast') {
                    // the sea along the east edge, tide flats along the shore and in pools, rocks on the beach
                    const shore = m.w * 0.68 + (a - 0.5) * 22;
                    if (x > shore + 3) t = T.WATER;
                    else if (x > shore - 2 || nC(x, y) < 0.13) t = T.SHALLOW;
                    else if (b > 0.77) t = T.WALL;
                }
                else if (def.gen === 'peaks') { if (b > 0.64 || a < 0.15) t = T.WALL; else if (a < 0.19) t = T.WATER; }
                else if (def.gen === 'city') {
                    // city blocks 8 tiles square with 3-tile streets; the buildings are hollow, broken in places, some
                    // collapsed to rubble; fires burn in the streets
                    const bx = x % 11, by = y % 11, inBlock = bx >= 1 && bx <= 8 && by >= 1 && by <= 8;
                    const standing = valueBlock(seed, Math.floor(x / 11), Math.floor(y / 11)) > 0.28;
                    if (inBlock && standing && (bx === 1 || bx === 8 || by === 1 || by === 8) && wob(x * 3, y * 3) < 0.62) t = T.WALL;
                    else if (inBlock) t = T.FLOOR2;
                    else t = T.FLOOR;
                    if (t !== T.WALL && a < 0.15) t = T.LAVA;
                }
                else if (def.gen === 'isles') { if (a * 0.75 + b * 0.25 < 0.4) t = T.VOID; else if (nC(x, y) > 0.82) t = T.WALL; }
                set(m, x, y, t);
            }
            border(m, 3);
            if (def.gen === 'isles') for (let i = 0; i < m.tiles.length; i++) { const x = i % m.w, y = (i / m.w) | 0; if (x < 3 || y < 3 || x >= m.w - 3 || y >= m.h - 3) m.tiles[i] = T.VOID; }
        }
        // roads between the key points (lava and water under a road become floor)
        const road = def.gen === 'cave' ? T.FLOOR : T.PATH;
        const r = def.gen === 'cave' ? 1.8 : 1.3;
        carve(m, entry, camp, r, road, wob, 7);
        carve(m, camp, boss, r, road, wob, 7);
        carve(m, camp, side1, r, road, wob, 5);
        carve(m, camp, side2, r, road, wob, 5);
        disc(m, entry.x, entry.y, 3.2, road);
        disc(m, camp.x, camp.y, 3.5, T.PATH);
        // boss arena: clear floor in a circle with a ring of wall around it, open toward the road
        disc(m, boss.x, boss.y, 10.5, T.WALL);
        disc(m, boss.x, boss.y, 9, T.ARENA);
        carve(m, { x: boss.x, y: boss.y + 8 }, { x: boss.x, y: boss.y + 13 }, 1.6, road, wob, 0);
        sealUnreachable(m, entry, def.gen === 'isles' ? T.VOID : T.WALL);

        const avoid = [{ x: entry.x, y: entry.y, r: 7 }, { x: camp.x, y: camp.y, r: 5 }, { x: boss.x, y: boss.y, r: 11 }];
        const nodes = [];
        const isFree = (t) => t === T.FLOOR || t === T.FLOOR2;
        // Ores come in veins and trees in groves, so each material has its places. Harder ores sit deeper in the zone.
        const types = Object.keys(def.nodes || {});
        const tiers = types.map(t => D.NODES[t].tier).filter(t => t > 0);
        const lo = Math.min(...tiers), hi = Math.max(...tiers);
        const reach = Math.hypot(m.w, m.h) * 0.55;
        for (const type of types) {
            const node = D.NODES[type];
            const want = def.nodes[type];
            if (node.tool === 'hand') {
                for (const p of scatter(m, rng, want, { minGap: 1.2, avoid, allow: isFree, taken: nodes })) nodes.push(Object.assign(p, { type }));
                continue;
            }
            const deep = hi > lo ? (node.tier - lo) / (hi - lo) : 0;
            const minDist = { x: entry.x, y: entry.y, d: 10 + deep * reach * 0.55 };
            const per = node.tool === 'axe' ? 8 : 5;
            const clusters = Math.max(2, Math.ceil(want / per));
            const centers = scatter(m, rng, clusters, { minGap: 9, avoid, allow: isFree, minDist });
            let placed = 0;
            for (let c = 0; c < centers.length && placed < want; c++) {
                const n = Math.ceil((want - placed) / (centers.length - c));
                const pts = scatter(m, rng, n, { minGap: 1.6, avoid, allow: isFree, taken: nodes, near: { x: centers[c].tx, y: centers[c].ty, r: node.tool === 'axe' ? 7 : 4.5 } });
                for (const p of pts) nodes.push(Object.assign(p, { type }));
                placed += pts.length;
            }
        }
        m.nodes = nodes.map((p, i) => ({ key: def.id + ':' + i, type: p.type, x: px(p.tx) + Math.round((rng() - 0.5) * 10), y: px(p.ty) + Math.round((rng() - 0.5) * 10) }));
        // node tiles: nothing else may stand there
        const spawnAvoid = avoid.concat([{ x: entry.x, y: entry.y, r: 14 }]);
        m.spawns = scatter(m, rng, def.density, { minGap: 4, avoid: spawnAvoid, allow: (t) => isFree(t) || t === T.ICE, taken: nodes }).map(p => ({ x: px(p.tx), y: px(p.ty) }));
        m.elites = scatter(m, rng, def.elites || 0, { minGap: 18, takenGap: 1.5, avoid: spawnAvoid.concat([{ x: entry.x, y: entry.y, r: 30 }]), taken: nodes }).map(p => ({ x: px(p.tx), y: px(p.ty) }));
        const rv = scatter(m, rng, 1, { minGap: 2, avoid: spawnAvoid.concat([{ x: entry.x, y: entry.y, r: 22 }]), taken: nodes });
        m.rival = rv.length ? { x: px(rv[0].tx), y: px(rv[0].ty) } : { x: px(camp.x + 4), y: px(camp.y) };
        m.entry = { x: px(entry.x), y: px(entry.y) - 40 };
        m.exit = { x: px(entry.x), y: px(entry.y) + 30, to: 'town' };
        m.camp = { x: px(camp.x), y: px(camp.y) };
        m.boss = { x: px(boss.x), y: px(boss.y), r: 9 * TILE };
        m.keyTiles = { entry, camp, boss, side1, side2 };
        m.stations = []; m.portals = []; m.deco = [];
        m.npcs = npcsIn(def.id, camp.x, camp.y);
        if (def.wards) placeWards(m, def, rng, { entry, camp, boss }, nodes);
        return m;
    }
    // A sealed lair (the Far Reaches): ward stones spread far apart across the zone, and a barrier across the arena's mouth
    // (m.lair.tiles) until openLair. Placed last, so the zone's other rolls don't depend on it.
    function placeWards(m, def, rng, key, nodes) {
        const avoid = [{ x: key.entry.x, y: key.entry.y, r: 30 }, { x: key.boss.x, y: key.boss.y, r: 18 }, { x: key.camp.x, y: key.camp.y, r: 8 }];
        const isFree = (t) => t === T.FLOOR || t === T.FLOOR2;
        let pts = [];
        for (let gap = 34; gap >= 10 && pts.length < def.wards; gap -= 4) pts = scatter(m, rng, def.wards, { minGap: gap, takenGap: 2.5, avoid, allow: isFree, taken: nodes });
        m.wards = pts.slice(0, def.wards).map((p, i) => { set(m, p.tx, p.ty, T.BUILDING); return { i, x: px(p.tx), y: px(p.ty) }; });
        // the barrier: every open tile across the ring's opening (inside the ring's wall, where nothing else stands)
        const tiles = [], nodeAt = new Set(nodes.map(n => n.tx + ',' + n.ty));
        for (let y = key.boss.y + 9; y <= key.boss.y + 10; y++) for (let x = key.boss.x - 4; x <= key.boss.x + 4; x++) {
            const t = get(m, x, y);
            if (!isSolid(t) && t !== T.VOID && !nodeAt.has(x + ',' + y)) { tiles.push([x, y, t]); set(m, x, y, T.BUILDING); }
        }
        m.lair = { tiles, open: false, at: { x: px(key.boss.x), y: px(key.boss.y + 10) } };
    }
    // Break the seal on a lair: the barrier goes and the arena can be walked into. Calling it again does nothing.
    function openLair(m) {
        if (!m.lair || m.lair.open) return m;
        m.lair.open = true;
        for (const [x, y, t] of m.lair.tiles) set(m, x, y, t);
        return m;
    }

    // ---------------- the Arena ----------------
    // A walled yard: the lobby along the bottom (the door to town, the Arena Master, the ranking board, the gate to the
    // Proving Grounds), the Pit in the middle (one opening, toward the lobby) and four sealed rings for matches, which
    // players are brought into. m.rings[i].spots: where each team stands at the start of a round.
    function buildArena(def) {
        const m = { id: def.id, w: def.w, h: def.h, tiles: grid(def.w, def.h, T.WALL) };
        const n = valueNoise(D.WORLD_SEED + ':arena:n', 5);
        for (let y = 2; y < m.h - 2; y++) for (let x = 2; x < m.w - 2; x++) set(m, x, y, n(x, y) > 0.56 ? T.FLOOR2 : T.FLOOR);
        const cx = Math.floor(m.w / 2), lobbyY = m.h - 9, pitY = 21;
        for (let y = m.h - 13; y < m.h - 3; y++) for (let x = 3; x < m.w - 3; x++) set(m, x, y, T.PLAZA);
        disc(m, cx, pitY, 12.6, T.WALL, 0);
        disc(m, cx, pitY, 11, T.ARENA, 0);
        for (let y = pitY + 10; y <= pitY + 15; y++) for (let x = cx - 1; x <= cx + 1; x++) set(m, x, y, y <= pitY + 11 ? T.ARENA : T.PATH);
        const centres = [{ x: 10, y: 10 }, { x: m.w - 11, y: 10 }, { x: 10, y: 30 }, { x: m.w - 11, y: 30 }];
        m.rings = centres.map((c, i) => {
            disc(m, c.x, c.y, 7, T.WALL, 0);
            disc(m, c.x, c.y, 5.5, T.ARENA, 0);
            const R = 5.5 * TILE, spot = (side, k) => { const a = (side < 0 ? Math.PI : 0) + (k - 1) * 0.55 * side; return { x: px(c.x) + Math.cos(a) * R * 0.6, y: px(c.y) + Math.sin(a) * R * 0.6 }; };
            return { i, x: px(c.x), y: px(c.y), r: R, spots: { a: [0, 1, 2].map(k => spot(-1, k)), b: [0, 1, 2].map(k => spot(1, k)) } };
        });
        m.pit = { x: px(cx), y: px(pitY), r: 11 * TILE };
        m.pitGate = { x: px(cx), y: px(pitY + 15) };
        m.board = { x: px(m.w - 10), y: px(lobbyY) };
        m.trialsGate = { x: px(8), y: px(lobbyY) };
        m.lobby = { y0: (m.h - 13) * TILE, y1: (m.h - 3) * TILE };
        m.entry = { x: px(cx), y: px(m.h - 6) };
        m.exit = { x: px(cx), y: px(m.h - 4), to: 'town' };
        m.npcs = npcsIn(def.id, cx, lobbyY);
        m.nodes = []; m.spawns = []; m.elites = []; m.stations = []; m.portals = []; m.deco = [];
        m.camp = null; m.boss = null; m.rival = null;
        return m;
    }
    // ---------------- the Proving Grounds ----------------
    // A round floor walled in, its six gates where the waves come from, and a small room by the door with the ready circle
    function buildTrials(def) {
        const m = { id: def.id, w: def.w, h: def.h, tiles: grid(def.w, def.h, T.WALL) };
        const cx = Math.floor(m.w / 2), cy = 20, R = 15;
        disc(m, cx, cy, R, T.ARENA, 0);
        for (let y = cy + R - 1; y <= cy + R + 3; y++) for (let x = cx - 1; x <= cx + 1; x++) set(m, x, y, T.PATH);
        for (let y = cy + R + 3; y < m.h - 2; y++) for (let x = cx - 8; x <= cx + 8; x++) set(m, x, y, T.PLAZA);
        m.floor = { x: px(cx), y: px(cy), r: R * TILE };
        m.ready = { x: px(cx), y: px(cy + R + 4), r: 2.4 * TILE };
        m.gates = [Math.PI, -2.4, -1.9, -1.25, -0.6, 0].map((a, i) => ({ i, x: px(cx) + Math.cos(a) * (R - 1.5) * TILE, y: px(cy) + Math.sin(a) * (R - 1.5) * TILE }));
        m.entry = { x: px(cx), y: px(cy + R + 5) };
        m.exit = { x: px(cx), y: px(m.h - 3), to: 'arena' };
        m.npcs = npcsIn(def.id, cx, cy + R + 5);
        m.nodes = []; m.spawns = []; m.elites = []; m.stations = []; m.portals = []; m.deco = [];
        m.camp = null; m.boss = null; m.rival = null;
        return m;
    }

    function generateZone(zoneId) {
        const def = D.ZONES[zoneId];
        if (!def) throw new Error('unknown zone ' + zoneId);
        return def.gen === 'town' ? buildTown(def) : def.gen === 'hall' ? buildHall(def) : def.gen === 'arena' ? buildArena(def) : def.gen === 'trials' ? buildTrials(def) : buildWild(def);
    }
    // A fingerprint of a map (for the determinism test)
    function mapHash(m) {
        let h = 2166136261 >>> 0;
        for (let i = 0; i < m.tiles.length; i++) { h ^= m.tiles[i]; h = Math.imul(h, 16777619) >>> 0; }
        for (const n of m.nodes) { h ^= hashStr(n.key + n.type + n.x + ',' + n.y); h = Math.imul(h, 16777619) >>> 0; }
        return h >>> 0;
    }
    function tileAt(m, wx, wy) { return get(m, Math.floor(wx / TILE), Math.floor(wy / TILE)); }

    return { T, SOLID, isSolid, blocksWalk, hashStr, mulberry32, valueNoise, generateZone, openSecret, openLair, flood, mapHash, tileAt, get };
}));
