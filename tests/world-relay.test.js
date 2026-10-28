'use strict';
// The development relay in server.js (a stand-in for Firebase Realtime Database used by world.html on localhost)
const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('path');
const { spawn } = require('child_process');

const PORT = 8137;
const BASE = `http://127.0.0.1:${PORT}/__net`;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
let server;

// A minimal client: reads the event stream into a list of messages
function client(uid) {
    const ctrl = new AbortController();
    const msgs = [];
    const ready = fetch(`${BASE}/stream?uid=${uid}`, { signal: ctrl.signal }).then(async (res) => {
        const reader = res.body.getReader();
        const dec = new TextDecoder();
        let buf = '';
        (async () => {
            try {
                for (;;) {
                    const { value, done } = await reader.read();
                    if (done) break;
                    buf += dec.decode(value, { stream: true });
                    let i;
                    while ((i = buf.indexOf('\n\n')) >= 0) {
                        const chunk = buf.slice(0, i); buf = buf.slice(i + 2);
                        const line = chunk.split('\n').find((l) => l.startsWith('data: '));
                        if (line) msgs.push(JSON.parse(line.slice(6)));
                    }
                }
            } catch (e) { /* aborted */ }
        })();
    });
    const op = (body) => fetch(`${BASE}/op?uid=${uid}`, { method: 'POST', body: JSON.stringify(body) }).then((r) => r.json());
    return { msgs, ready, op, close: () => ctrl.abort() };
}

test.before(async () => {
    server = spawn(process.execPath, [path.join(__dirname, '..', 'server.js')], { env: { ...process.env, PORT: String(PORT) }, stdio: 'ignore' });
    for (let i = 0; i < 50; i++) { try { await fetch(`http://127.0.0.1:${PORT}/index.html`); return; } catch (e) { await sleep(100); } }
    throw new Error('server did not start');
});
test.after(() => { if (server) server.kill(); });

test('relay: changes reach every page; increments add up', async () => {
    const a = client('aaaa1'), b = client('bbbb2');
    await a.ready; await b.ready;
    await sleep(100);
    assert.equal(b.msgs[0].type, 'hello');
    await a.op({ op: 'set', path: 'wilds/v1/zones/mines/p/aaaa1', value: '1,2,3,4,5,6,7,8,9,10' });
    await a.op({ op: 'update', path: 'wilds/v1/zones/mines/boss', value: { hp: 900, 'f/aaaa1': { '.inc': 10 } } });
    await b.op({ op: 'update', path: 'wilds/v1/zones/mines/boss', value: { hp: { '.inc': -50 }, 'f/bbbb2': { '.inc': 7 } } });
    await sleep(150);
    const last = (p) => b.msgs.filter((m) => m.path === p).pop();
    assert.equal(last('wilds/v1/zones/mines/p/aaaa1').value, '1,2,3,4,5,6,7,8,9,10');
    assert.equal(last('wilds/v1/zones/mines/boss/hp').value, 850);
    assert.equal(last('wilds/v1/zones/mines/boss/f/bbbb2').value, 7);
    a.close(); b.close();
});

test('relay: only one page gets a loot bag, even when both grab at once', async () => {
    const a = client('cccc3'), b = client('dddd4');
    await a.ready; await b.ready;
    await a.op({ op: 'set', path: 'wilds/v1/zones/mines/loot/bag1', value: { x: 1, y: 2, m: { stone: 3 } } });
    const [ra, rb] = await Promise.all([a.op({ op: 'take', path: 'wilds/v1/zones/mines/loot/bag1' }), b.op({ op: 'take', path: 'wilds/v1/zones/mines/loot/bag1' })]);
    const got = [ra.value, rb.value].filter(Boolean);
    assert.equal(got.length, 1);
    assert.deepEqual(got[0].m, { stone: 3 });
    a.close(); b.close();
});

test('relay: a write that changes nothing is not announced (like Firebase)', async () => {
    const a = client('gggg7'), b = client('hhhh8');
    await a.ready; await b.ready;
    await a.op({ op: 'set', path: 'wilds/v1/zones/ember/p/gggg7', value: 'same' });
    await a.op({ op: 'set', path: 'wilds/v1/zones/ember/p/gggg7', value: 'same' });
    await sleep(150);
    assert.equal(b.msgs.filter((m) => m.path === 'wilds/v1/zones/ember/p/gggg7').length, 1);
    a.close(); b.close();
});

test('relay: a page that closes loses its presence; paths outside wilds/ are refused', async () => {
    const a = client('eeee5'), b = client('ffff6');
    await a.ready; await b.ready;
    await a.op({ op: 'set', path: 'wilds/v1/zones/frost/p/eeee5', value: 'x' });
    await a.op({ op: 'onDisconnect', path: 'wilds/v1/zones/frost/p/eeee5' });
    a.close();
    await sleep(300);
    const gone = b.msgs.filter((m) => m.path === 'wilds/v1/zones/frost/p/eeee5').pop();
    assert.equal(gone.value, null);
    const bad = await b.op({ op: 'set', path: 'saves/someone', value: 1 });
    assert.equal(bad.ok, false);
    b.close();
});
