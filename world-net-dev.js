/**
 * The Wilds online, development transport: talks to the stand-in database in server.js (npm start) over server-sent
 * events, so online play can be tried and tested without Firebase. Same interface as world-net-rtdb.js:
 *   uid, serverNow(), INC(n), set/update/remove(path...), push(path, value) -> key, take(path) -> value or null (atomic
 *   remove-and-return), onChild(path, { add, change, remove }), onValue(path, cb), onDisconnectRemove(path),
 *   cancelOnDisconnect(path), onStatus(cb), close().
 */
(function () {
    'use strict';
    const T = window.WHNetTree;
    const randomId = () => Math.random().toString(36).slice(2, 10) + Date.now().toString(36).slice(-4);
    let pushN = 0;
    const pushKey = () => Date.now().toString(36).padStart(9, '0') + (pushN++ % 1296).toString(36).padStart(2, '0') + Math.random().toString(36).slice(2, 6);

    function connect(opts = {}) {
        const base = opts.base || '/__net';
        const uid = opts.uid || 'dev' + randomId();
        let tree = null, offset = 0, connected = false;
        const subs = new Set();
        const statusCbs = new Set();
        const setConnected = (v) => { if (v === connected) return; connected = v; statusCbs.forEach(cb => { try { cb(v); } catch (e) {} }); };
        function fire(s, before) {
            const after = T.get(tree, s.path);
            if (s.kind === 'value') { if (JSON.stringify(before) !== JSON.stringify(after)) s.cb(T.clone(after)); return; }
            const d = T.childDiff(before, after);
            for (const k of d.added) if (s.cbs.add) s.cbs.add(k, T.clone(after[k]));
            for (const k of d.changed) if (s.cbs.change) s.cbs.change(k, T.clone(after[k]));
            for (const k of d.removed) if (s.cbs.remove) s.cbs.remove(k, T.clone(before[k]));
        }
        function apply(path, value) {
            const watching = [...subs].filter(s => T.overlaps(path, s.path)).map(s => ({ s, before: T.clone(T.get(tree, s.path)) }));
            tree = T.set(tree, path, value);
            for (const { s, before } of watching) { try { fire(s, before); } catch (e) { console.error(e); } }
        }
        // Writes go out in order, a batch per request with one request at a time (like a single Realtime Database
        // connection): many small requests in parallel would queue in the browser and could arrive out of order.
        const queue = [];
        let sending = false;
        function pump() {
            if (sending || !queue.length) return;
            sending = true;
            const batch = queue.splice(0, 50);
            fetch(base + '/op?uid=' + uid, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ ops: batch.map(b => b.body) }) })
                .then(r => r.json()).catch(() => null)
                .then((res) => {
                    batch.forEach((b, i) => b.resolve(res && Array.isArray(res.results) ? res.results[i] : { ok: false }));
                    sending = false;
                    pump();
                });
        }
        const op = (body) => new Promise((resolve) => { queue.push({ body, resolve }); pump(); });
        const db = {
            kind: 'dev', uid,
            serverNow: () => Date.now() + offset,
            INC: (n) => ({ '.inc': n }),
            set: (path, value) => op({ op: 'set', path, value }),
            update: (path, value) => op({ op: 'update', path, value }),
            remove: (path) => op({ op: 'remove', path }),
            push: (path, value) => { const key = pushKey(); return op({ op: 'set', path: path + '/' + key, value }).then(() => key); },
            take: (path) => op({ op: 'take', path }).then(r => (r && r.ok ? r.value : null)),
            onChild(path, cbs) { const s = { kind: 'child', path, cbs }; subs.add(s); fire(s, null); return () => subs.delete(s); },
            onValue(path, cb) { const s = { kind: 'value', path, cb }; subs.add(s); cb(T.clone(T.get(tree, path))); return () => subs.delete(s); },
            onDisconnectRemove: (path) => op({ op: 'onDisconnect', path }),
            cancelOnDisconnect: (path) => op({ op: 'cancelDisconnect', path }),
            onStatus(cb) { statusCbs.add(cb); cb(connected); return () => statusCbs.delete(cb); },
            close() { try { es.close(); } catch (e) {} setConnected(false); },
        };
        let es;
        return new Promise((resolve, reject) => {
            let settled = false;
            es = new EventSource(base + '/stream?uid=' + uid);
            es.onmessage = (ev) => {
                let msg;
                try { msg = JSON.parse(ev.data); } catch (e) { return; }
                if (msg.type === 'hello') {
                    // (re)connected: the relay sends everything; replace the mirror and tell listeners what changed
                    offset = msg.now - Date.now();
                    const watching = [...subs].map(s => ({ s, before: T.clone(T.get(tree, s.path)) }));
                    tree = msg.tree;
                    for (const { s, before } of watching) fire(s, before);
                    setConnected(true);
                    if (!settled) { settled = true; resolve(db); }
                } else if (msg.type === 'set') apply(msg.path, msg.value);
            };
            es.onerror = () => {
                setConnected(false);
                if (!settled) { settled = true; es.close(); reject(new Error('The local online relay is not running. Stop the server (Ctrl+C) and start it again with npm start: an older server does not have it. Or add ?whnet=rtdb to the address to use Firebase.')); }
            };
        });
    }
    window.WHNetDev = { connect };
})();
