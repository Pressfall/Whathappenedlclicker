/**
 * Two-player browser test for the Wilds online (npm run test:browser runs it after smoke.js). Needs Chrome.
 *
 * Serves the project with server.js, whose local relay stands in for Firebase Realtime Database, and opens world.html in
 * two isolated browser contexts (separate storage: two different players) of one headless Chrome. Checks presence, chat,
 * PvP hits, shields, a knockout's loot bag and a shared boss. Nothing reaches Firebase.
 *
 * CHROME_PATH   path to chrome / chromium (default: the usual Windows, macOS and Linux locations)
 */
const { spawn, execFileSync } = require('child_process');
const fs = require('fs');
const os = require('os');
const path = require('path');

const ROOT = path.resolve(__dirname, '..', '..');
const PROFILE = fs.mkdtempSync(path.join(os.tmpdir(), 'wh-online-profile-'));
const PORT = 8126, DEBUG = 9336;
const CANDIDATES = [
    process.env.CHROME_PATH,
    'C:/Program Files/Google/Chrome/Application/chrome.exe',
    'C:/Program Files (x86)/Google/Chrome/Application/chrome.exe',
    '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
    '/usr/bin/google-chrome', '/usr/bin/chromium', '/usr/bin/chromium-browser',
].filter(Boolean);
const CHROME = CANDIDATES.find((p) => fs.existsSync(p));
if (!CHROME) { console.error('Chrome not found. Set CHROME_PATH to your chrome executable.'); process.exit(2); }

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const results = [];
const check = (name, ok, extra) => { results.push({ name, ok: !!ok }); console.log((ok ? 'PASS ' : 'FAIL ') + name + (extra !== undefined && !ok ? '  -> ' + JSON.stringify(extra) : '')); };

async function main() {
    const server = spawn(process.execPath, [path.join(ROOT, 'server.js')], { env: { ...process.env, PORT: String(PORT) }, stdio: 'ignore' });
    const chrome = spawn(CHROME, ['--headless=new', `--remote-debugging-port=${DEBUG}`, `--user-data-dir=${PROFILE}`, '--no-first-run', '--no-default-browser-check',
        '--disk-cache-size=1048576', '--disable-component-update', '--disable-background-networking', '--safebrowsing-disable-auto-update',
        '--disable-renderer-backgrounding', '--disable-background-timer-throttling', '--disable-backgrounding-occluded-windows', 'about:blank'], { stdio: 'ignore' });
    const cleanup = () => {
        try { server.kill(); } catch (e) {}
        // only the browser we started (never every chrome.exe: that would close the person's own windows)
        try {
            if (process.platform === 'win32') execFileSync('taskkill', ['/PID', String(chrome.pid), '/T', '/F'], { stdio: 'ignore' });
            else chrome.kill('SIGKILL');
        } catch (e) {}
        setTimeout(() => { try { fs.rmSync(PROFILE, { recursive: true, force: true }); } catch (e) {} }, 3000);
    };
    try {
        let ver = null;
        for (let i = 0; i < 60 && !ver; i++) { try { ver = await (await fetch(`http://127.0.0.1:${DEBUG}/json/version`)).json(); } catch (e) { await sleep(1000); } }
        if (!ver) throw new Error('Chrome never opened the debugging port');
        const ws = new WebSocket(ver.webSocketDebuggerUrl);
        await new Promise((r) => ws.addEventListener('open', r));
        let id = 0; const pending = new Map(); const events = [];
        ws.addEventListener('message', (m) => { const msg = JSON.parse(m.data); if (msg.id && pending.has(msg.id)) { pending.get(msg.id)(msg); pending.delete(msg.id); } else events.push(msg); });
        const send = (method, params = {}, sessionId) => new Promise((res) => { const i = ++id; pending.set(i, res); ws.send(JSON.stringify({ id: i, method, params, sessionId })); });
        // one player: an isolated browser context (its own storage) with one page
        async function player(name) {
            const ctx = (await send('Target.createBrowserContext', {})).result.browserContextId;
            const target = (await send('Target.createTarget', { url: 'about:blank', browserContextId: ctx })).result.targetId;
            const sid = (await send('Target.attachToTarget', { targetId: target, flatten: true })).result.sessionId;
            const s = (m, p) => send(m, p, sid);
            await s('Page.enable'); await s('Runtime.enable');
            await s('Emulation.setDeviceMetricsOverride', { width: 1100, height: 700, deviceScaleFactor: 1, mobile: false });
            const evalJs = async (expression) => { const r = await s('Runtime.evaluate', { expression, awaitPromise: true, returnByValue: true }); return r.result && r.result.result ? r.result.result.value : undefined; };
            const waitFor = async (expr, ms = 30000) => { const t0 = Date.now(); while (Date.now() - t0 < ms) { if (await evalJs(expr) === true) return true; await sleep(200); } return false; };
            const p = {
                name, evalJs, waitFor,
                mouse: (x, y) => s('Input.dispatchMouseEvent', { type: 'mouseMoved', x, y, button: 'none', buttons: 0 }),
                errors: () => events.filter((e) => e.sessionId === sid && e.method === 'Runtime.exceptionThrown').map((e) => (e.params.exceptionDetails.exception && e.params.exceptionDetails.exception.description) || e.params.exceptionDetails.text),
            };
            const ready = 'typeof window.WHWorldDebug === "object" && WHWorldDebug.frames() > 20 && WHW.online.status === "online"';
            for (let i = 0; i < 3; i++) {
                await s('Page.navigate', { url: `http://localhost:${PORT}/world.html?whdebug` });
                await sleep(1000);
                if (await waitFor(ready)) break;
            }
            await evalJs(`WHW.ui.closeModal(); WHW.online.setName(${JSON.stringify(name)})`);
            return p;
        }
        const a = await player('Alice'), b = await player('Bobby');
        await a.evalJs('(() => { const h = WHW.online.hitRemote; WHW.online.hitRemote = function (r, x) { window.__sent = (window.__sent || 0) + 1; return h.apply(this, arguments); }; })()');
        await b.evalJs('(() => { window.__got = []; const v = WHWorldOnline.validateHit; WHWorldOnline.validateHit = function (hit, ctx) { const r = v(hit, ctx); window.__got.push(r.ok ? hit.k + " ok" : hit.k + " " + r.reason); return r; }; })()');
        const view = (p) => p.evalJs('WHWorldDebug.online()');

        // ---- presence and chat ----
        check('both players are online', (await view(a)).status === 'online' && (await view(b)).status === 'online');
        check('each sees the other in town', await a.waitFor('WHWorldDebug.online().players.length === 1', 10000) && await b.waitFor('WHWorldDebug.online().players.length === 1', 10000));
        await a.evalJs('WHW.online.say("hello there", false)');
        check('chat reaches the other player', await b.waitFor('WHWorldDebug.online().players.some(p => p.bubble === "hello there")', 5000));
        check('names come across', await a.waitFor('WHWorldDebug.online().players.some(p => p.name === "Bobby")', 5000));

        // ---- PvP in Greenwood ----
        for (const p of [a, b]) await p.evalJs('WHWorldDebug.travel("greenwood")');
        await sleep(600);
        const place = (dx) => `(() => { const g = WHW.game; g.actors.forEach(x => { if (x.kind !== 'boss') x.dead = true; }); const c = g.map.camp; WHWorldDebug.teleport(c.x + ${dx}, c.y + 80); g.player.protectedUntil = 0; g.player.maxHp = 300; g.player.hp = 300; })()`;
        await a.evalJs(place(-25)); await b.evalJs(place(25));
        await a.waitFor('WHWorldDebug.online().players.length === 1 && Math.abs(WHWorldDebug.online().players[0].x - WHW.game.player.x) < 80', 8000);
        const pp = await a.evalJs('(() => { const p = WHW.game.player; return WHW.engine.worldToScreen(p.x, p.y); })()');
        const swing = async (rounds, until) => {
            for (let k = 0; k < rounds; k++) {
                // step up to them, rested (a winded fighter swings too slowly to hurt, which is the game working)
                await a.evalJs('(() => { const r = WHW.online.here()[0]; if (r) WHWorldDebug.teleport(r.x - 30, r.y); const p = WHW.game.player; p.stam.val = 100; p.stam.winded = false; })()');
                await sleep(60);
                for (let i = 0; i <= 6; i++) { const ang = (k % 2 ? 1 : -1) * (-1.2 + i / 6 * 2.4); await a.mouse(pp.x + Math.cos(ang) * 90, pp.y + Math.sin(ang) * 90); await sleep(8); }
                await sleep(150);
                if (await b.evalJs('WHW.game.player.dead')) break;
                if (until && await b.evalJs(until)) break;
            }
            await sleep(500);
        };
        const hp0 = await b.evalJs('WHW.game.player.hp');
        await swing(30, 'WHW.game.player.hp < ' + hp0);
        const hp1 = await b.evalJs('WHW.game.player.hp');
        const why = await a.evalJs('(() => { const on = WHW.online; const r = on.here()[0]; const p = WHW.game.player; return { status: on.status, targets: on.targets().length, r: r && { prot: r.protected, stale: r.stale, dead: r.dead, x: Math.round(r.x), y: Math.round(r.y) }, me: { x: Math.round(p.x), y: Math.round(p.y), w: p.weapon && p.weapon.cls, stam: Math.round(p.stam.val), shield: p.shield.up, stagger: p.staggerUntil > WHW.engine.time, paused: WHW.engine.paused, modal: WHW.ui.isOpen() } }; })()');
        check('a sword swing hurts the other player (on their page)', hp1 < hp0, [hp0, hp1, why]);
        check('town is safe: no PvP there', await a.evalJs('WHWorldOnline.validateHit({ w: "sword_1", k: "melee", dmg: 5 }, { zone: "town", attacker: { x: 0, y: 0, fl: 0 }, me: { x: 10, y: 0 }, now: 1 }).ok') === false);
        // the same hit, without and then with a shield raised toward the attacker (who stands to the west)
        const oneHit = async () => {
            await b.evalJs('(() => { const p = WHW.game.player; p.hp = 300; p.iframes = 0; p.stam.val = 100; })()');
            await a.evalJs('(() => { const r = WHW.online.here()[0]; WHWorldDebug.teleport(r.x - 30, r.y); })()');
            await sleep(400);
            await a.evalJs('WHW.online.hitRemote(WHW.online.here()[0], { kind: "melee", dmg: 20, ang: 0, perfect: false })');
            await sleep(700);
            return 300 - await b.evalJs('WHW.game.player.hp');
        };
        const open = await oneHit();
        await b.evalJs('(() => { const p = WHW.game.player; p.aimHold = Math.PI; p.shield.theta = Math.PI; WHW.shieldWanted = () => true; })()');
        await sleep(500);
        await b.evalJs('WHW.game.player.shield.raisedAt = -99'); // long raised: a block, not a parry
        check('the attacker sees the raised shield', (await view(a)).players[0].shield === true);
        const shielded = await oneHit();
        check('the shield takes most of a hit', open > 0 && shielded > 0 && shielded < open * 0.7, [open, shielded]);
        // abilities: the other player sees the cast, takes the hit, and is stunned by a Net Shot
        await b.evalJs('(() => { WHW.shieldWanted = () => false; const p = WHW.game.player; p.shield.up = false; p.hp = 300; p.iframes = 0; window.__casts = []; const rc = WHW.actors.remoteCast; WHW.actors.remoteCast = function (x, y, id) { window.__casts.push(id); return rc.apply(this, arguments); }; })()');
        await a.evalJs('(() => { const r = WHW.online.here()[0]; WHWorldDebug.teleport(r.x - 30, r.y); })()');
        await a.mouse(pp.x + 90, pp.y);
        await sleep(400);
        const castOn = (cls, id) => `(() => { const W = WHWorld, g = WHW.game, s = g.state, p = g.player; s.classes.unlocked.${cls} = true; W.setClass(s, '${cls}'); g.pstats = W.playerStats(s);
            s.skills.learned.${id} = true; W.equipAbility(s, '${id}', 0); p.abCd = {}; p.stam.val = 100; return WHW.actors.castAbility(0); })()`;
        check('the attacker casts Whirlwind next to them', await a.evalJs(castOn('warrior', 'whirlwind')) === true);
        check('Whirlwind hurts the other player (on their page)', await b.waitFor('WHW.game.player.hp < 300', 5000), await b.evalJs('WHW.game.player.hp'));
        check('they see the Whirlwind being cast', await b.waitFor('window.__casts.includes("whirlwind")', 3000), await b.evalJs('window.__casts'));
        await b.evalJs('(() => { const p = WHW.game.player; p.hp = 300; p.iframes = 0; })()');
        await sleep(400);
        check('the attacker fires a Net Shot at them', await a.evalJs(castOn('ranger', 'net_shot')) === true);
        check('a Net Shot stuns the other player, for less time than a monster', await b.waitFor('WHW.game.player.stunUntil > WHW.engine.time', 5000) &&
            await b.evalJs('WHW.game.player.stunUntil - WHW.engine.time <= WHWorldOnline.playerStun(WHWorldData.ABILITIES.net_shot.stun)'));
        await a.evalJs('(() => { const W = WHWorld, g = WHW.game; W.setClass(g.state, "warrior"); g.pstats = W.playerStats(g.state); })()');
        await sleep(1300);
        // knocked out while carrying ore: it drops as loot for the winner
        await b.evalJs('(() => { const g = WHW.game; WHW.shieldWanted = () => false; g.player.shield.up = false; g.state.bag = { iron_ore: 10, copper_ore: 6 }; g.player.hp = 1; g.player.iframes = 0; })()');
        await swing(30);
        const whyKo = { a: await a.evalJs('(() => { const on = WHW.online; const r = on.here()[0]; const p = WHW.game.player; return { sent: window.__sent || 0, status: on.status, targets: on.targets().length, r: r && { prot: r.protected, stale: r.stale, dead: r.dead, dx: Math.round(r.x - p.x), dy: Math.round(r.y - p.y) }, stam: Math.round(p.stam.val), shield: p.shield.up, stagger: p.staggerUntil > WHW.engine.time }; })()'), b: await b.evalJs('(() => { const p = WHW.game.player; return { hp: p.hp, iframes: p.iframes, prot: p.protectedUntil > WHW.engine.time, shield: p.shield.up, got: window.__got || [] }; })()') };
        check('the other player is knocked out', await b.evalJs('WHW.game.player.dead'), whyKo);
        check('their carried ore dropped as loot, not a private grave', await b.evalJs('WHW.game.state.grave === null && WHW.game.state.stats.pvpLosses === 1'));
        await a.evalJs('(() => { const bag = [...WHW.online.loot.values()][0]; if (bag) WHWorldDebug.teleport(bag.x, bag.y); })()');
        await sleep(1200);
        check('the winner picks the loot up (30% of each stack)', JSON.stringify(await a.evalJs('WHW.game.state.bag')) === JSON.stringify({ iron_ore: 3, copper_ore: 1 }), await a.evalJs('WHW.game.state.bag'));
        check('the winner is credited', await a.evalJs('WHW.game.state.stats.pvpWins') === 1);
        await b.evalJs('WHW.ui.closeModal()');
        await sleep(600);

        // ---- a shared boss ----
        for (const p of [a, b]) await p.evalJs('WHWorldDebug.travel("greenwood")');
        await sleep(600);
        const arena = (dx) => `(() => { const g = WHW.game; const ar = g.map.boss; WHWorldDebug.teleport(ar.x + ${dx}, ar.y + 140); g.player.maxHp = 1e6; g.player.hp = 1e6; g.player.protectedUntil = 0; })()`;
        await a.evalJs(arena(-40)); await b.evalJs(arena(40));
        check('a shared boss fight starts', await a.waitFor('!!WHWorldDebug.online().boss && !!WHW.online.boss.gen', 10000));
        await sleep(1500);
        const hostView = (p) => p.evalJs('({ host: WHW.online.isHost, elected: WHW.online.hostUid, me: WHW.online.uid, fresh: WHW.online.boss && WHW.online.boss.h && WHW.online.boss.h.u, seen: WHW.online.here().map(r => [r.uid, Math.round(r.x), Math.round(r.y), r.stale]) })');
        await a.waitFor('true', 1);
        const ha = await hostView(a), hb = await hostView(b);
        check('exactly one page runs the boss', ha.host !== hb.host, { a: ha, b: hb });
        const hit = (p, n, amt) => p.evalJs(`(() => { const x = WHW.game.actors.find(q => q.kind === "boss"); for (let i = 0; i < ${n}; i++) WHW.actors.damage(x, ${amt}, { from: WHW.game.player, kbAngle: 0, kb: 0, s: 1 }); })()`);
        await hit(a, 6, 50);
        check("one player's damage shows on the other's boss", await b.waitFor('Math.round(WHW.game.actors.find(q => q.kind === "boss").hp) === 600', 5000), await b.evalJs('WHW.game.actors.find(q => q.kind === "boss").hp'));
        await hit(b, 4, 40);
        await sleep(600);
        await hit(a, 20, 60);
        await sleep(2000);
        check('both players who helped get the boss reward', await a.evalJs('WHW.game.state.stats.bossKills') === 1 && await b.evalJs('WHW.game.state.stats.bossKills') === 1);

        const errs = a.errors().concat(b.errors());
        check('no uncaught page errors', errs.length === 0, errs);
        ws.close();
    } finally {
        cleanup();
    }
    const failed = results.filter((r) => !r.ok);
    console.log(`\n${results.length - failed.length}/${results.length} online checks passed`);
    process.exitCode = failed.length ? 1 : 0;
}
main().catch((e) => { console.error('online test crashed:', e); process.exitCode = 2; });
