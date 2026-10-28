const http = require('http');
const fs = require('fs');
const path = require('path');

const PORT = process.env.PORT || 8000;
const ROOT = __dirname;

const MIME_TYPES = {
    '.html': 'text/html; charset=utf-8',
    '.css': 'text/css; charset=utf-8',
    '.js': 'application/javascript; charset=utf-8',
    '.json': 'application/json; charset=utf-8',
    '.png': 'image/png',
    '.jpg': 'image/jpeg',
    '.jpeg': 'image/jpeg',
    '.webp': 'image/webp',
    '.svg': 'image/svg+xml',
    '.ico': 'image/x-icon',
    '.mp3': 'audio/mpeg',
    '.wav': 'audio/wav',
    '.txt': 'text/plain; charset=utf-8'
};

// The Wilds online (world.html): a local stand-in for Firebase Realtime Database, so online play can be tried and tested with
// `npm start` (world.html uses it on localhost). Shared state lives in memory and is pushed to every page over server-sent
// events. The deployed site never uses this; it talks to the real Realtime Database (world-net-rtdb.js).
const Tree = require('./core/world-net-tree');
const net = { tree: null, streams: new Map(), onDisconnect: new Map() }; // streams: response -> uid
const NET_PATH = /^wilds\/[A-Za-z0-9_\/-]{1,200}$/;
function netSet(p, value) {
    const before = JSON.stringify(Tree.get(net.tree, p));
    net.tree = Tree.set(net.tree, p, value);
    // like Firebase, a write that changes nothing tells nobody (so the pages are tested against that)
    if (JSON.stringify(Tree.get(net.tree, p)) === before) return;
    const msg = 'data: ' + JSON.stringify({ type: 'set', path: Tree.split(p).join('/'), value: Tree.get(net.tree, p) }) + '\n\n';
    for (const res of net.streams.keys()) res.write(msg);
}
function netOp(body) {
    const { op, path: p, value } = body;
    if (typeof p !== 'string' || !NET_PATH.test(p)) return { ok: false, error: 'bad path' };
    if (op === 'set') { netSet(p, value); return { ok: true }; }
    if (op === 'remove') { netSet(p, null); return { ok: true }; }
    if (op === 'update') {
        if (!Tree.isObj(value)) return { ok: false, error: 'bad value' };
        for (const k of Object.keys(value)) { const kp = Tree.join(p, k); netSet(kp, Tree.applyInc(Tree.get(net.tree, kp), value[k])); }
        return { ok: true };
    }
    if (op === 'take') { const cur = Tree.get(net.tree, p); if (cur !== null) netSet(p, null); return { ok: true, value: cur }; }
    if (op === 'onDisconnect' || op === 'cancelDisconnect') {
        if (!net.onDisconnect.has(body.uid)) net.onDisconnect.set(body.uid, new Set());
        net.onDisconnect.get(body.uid)[op === 'onDisconnect' ? 'add' : 'delete'](p);
        return { ok: true };
    }
    return { ok: false, error: 'bad op' };
}
function handleNet(req, res, url) {
    const uid = url.searchParams.get('uid') || '';
    if (!/^[A-Za-z0-9_-]{4,40}$/.test(uid)) { res.writeHead(400); res.end(); return; }
    if (url.pathname === '/__net/stream') {
        res.writeHead(200, { 'Content-Type': 'text/event-stream', 'Cache-Control': 'no-cache', Connection: 'keep-alive' });
        res.write('data: ' + JSON.stringify({ type: 'hello', now: Date.now(), tree: net.tree }) + '\n\n');
        net.streams.set(res, uid);
        const ping = setInterval(() => res.write(': ping\n\n'), 15000);
        req.on('close', () => {
            clearInterval(ping);
            net.streams.delete(res);
            // like onDisconnect() in Firebase: once the page is gone, so is everything it asked to be removed
            if (![...net.streams.values()].includes(uid)) {
                for (const p of net.onDisconnect.get(uid) || []) netSet(p, null);
                net.onDisconnect.delete(uid);
            }
        });
        return;
    }
    if (url.pathname === '/__net/op' && req.method === 'POST') {
        let raw = '';
        req.on('data', (c) => { raw += c; if (raw.length > 65536) req.destroy(); });
        req.on('end', () => {
            let out;
            // one op, or a batch applied in order ({ ops: [...] })
            try {
                const body = JSON.parse(raw);
                if (Array.isArray(body.ops)) out = { ok: true, results: body.ops.slice(0, 100).map((o) => netOp(Object.assign({}, o, { uid }))) };
                else out = netOp(Object.assign(body, { uid }));
            } catch (e) { out = { ok: false, error: 'bad json' }; }
            res.writeHead(out.ok ? 200 : 400, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify(out));
        });
        return;
    }
    res.writeHead(404); res.end();
}

const server = http.createServer((req, res) => {
    const url = new URL(req.url, 'http://localhost');
    if (url.pathname.startsWith('/__net/')) { handleNet(req, res, url); return; }
    // Parse URL
    let reqUrl = req.url.split('?')[0];
    if (reqUrl === '/') reqUrl = '/index.html';

    const safePath = path.normalize(decodeURIComponent(reqUrl)).replace(/^(\.\.[\/\\])+/, '');
    if (safePath.split(/[\\/]/).some(segment => segment.startsWith('.'))) {
        res.writeHead(404, { 'Content-Type': 'text/plain' });
        res.end('404 Not Found');
        return;
    }
    let filePath = path.join(ROOT, safePath);

    fs.stat(filePath, (err, stats) => {
        if (!err && stats.isDirectory()) {
            filePath = path.join(filePath, 'index.html');
        }

        fs.readFile(filePath, (readErr, data) => {
            if (readErr) {
                res.writeHead(404, { 'Content-Type': 'text/plain' });
                res.end('404 Not Found');
                return;
            }

            const ext = path.extname(filePath).toLowerCase();
            const mime = MIME_TYPES[ext] || 'application/octet-stream';
            res.writeHead(200, {
                'Content-Type': mime,
                'Cache-Control': 'no-cache'
            });
            res.end(data);
        });
    });
});

server.listen(PORT, () => {
    console.log(`Server running at http://localhost:${PORT}/`);
});

