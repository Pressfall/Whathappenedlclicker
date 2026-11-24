/**
 * Two-player browser test for the Wilds online (npm run test:browser runs it after smoke.js). Needs Chrome.
 *
 * Serves the project with server.js, whose local relay stands in for Firebase Realtime Database, and opens world.html in
 * two isolated browser contexts (separate storage: two different players) of one headless Chrome. Checks presence, chat,
 * PvP hits, shields, a knockout's loot bag, a shared boss, the position-update throttle and the "full" message (the relay is
 * capped at two players here, like the database plan's limit). Nothing reaches Firebase.
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
    const server = spawn(process.execPath, [path.join(ROOT, 'server.js')], { env: { ...process.env, PORT: String(PORT), WH_NET_MAX: '2' }, stdio: 'ignore' });
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
        // a call the browser never answers gives up after a minute (so a stuck run fails its checks instead of hanging)
        const send = (method, params = {}, sessionId) => new Promise((res) => {
            const i = ++id;
            const timer = setTimeout(() => { if (pending.delete(i)) { console.log('(no answer from the browser to ' + method + ' after 60 s)'); res({ error: { message: 'timeout' } }); } }, 60000);
            pending.set(i, (msg) => { clearTimeout(timer); res(msg); });
            ws.send(JSON.stringify({ id: i, method, params, sessionId }));
        });
        // one player: an isolated browser context (its own storage) with one page
        async function player(name, opts = {}) {
            const ctx = (await send('Target.createBrowserContext', {})).result.browserContextId;
            const target = (await send('Target.createTarget', { url: 'about:blank', browserContextId: ctx })).result.targetId;
            const sid = (await send('Target.attachToTarget', { targetId: target, flatten: true })).result.sessionId;
            const s = (m, p) => send(m, p, sid);
            await s('Page.enable'); await s('Runtime.enable');
            await s('Emulation.setDeviceMetricsOverride', { width: 1100, height: 700, deviceScaleFactor: 1, mobile: false });
            const evalJs = async (expression) => { const r = await s('Runtime.evaluate', { expression, awaitPromise: true, returnByValue: true }); return r.result && r.result.result ? r.result.result.value : undefined; };
            const waitFor = async (expr, ms = 30000) => { const t0 = Date.now(); while (Date.now() - t0 < ms) { if (await evalJs(expr) === true) return true; await sleep(200); } return false; };
            // ONLINE_SHOTS=<folder>: p.shot('name') saves a screenshot of this player's page there
            const shot = async (file) => { if (!process.env.ONLINE_SHOTS) return; const r = await s('Page.captureScreenshot', { format: 'png' }); if (r.result) require('fs').writeFileSync(require('path').join(process.env.ONLINE_SHOTS, name + '-' + file + '.png'), Buffer.from(r.result.data, 'base64')); };
            const p = {
                name, evalJs, waitFor, shot,
                mouse: (x, y) => s('Input.dispatchMouseEvent', { type: 'mouseMoved', x, y, button: 'none', buttons: 0 }),
                errors: () => events.filter((e) => e.sessionId === sid && e.method === 'Runtime.exceptionThrown').map((e) => (e.params.exceptionDetails.exception && e.params.exceptionDetails.exception.description) || e.params.exceptionDetails.text),
            };
            // (a player who is expected not to get online: wait only for the game itself)
            const ready = 'typeof window.WHWorldDebug === "object" && WHWorldDebug.frames() > 20' + (opts.offline ? '' : ' && WHW.online.status === "online"');
            for (let i = 0; i < 3; i++) {
                await s('Page.navigate', { url: `http://localhost:${PORT}/world.html?whdebug` });
                await sleep(1000);
                if (await waitFor(ready)) break;
            }
            if (!opts.offline) await evalJs(`WHW.ui.closeModal(); WHW.online.setName(${JSON.stringify(name)})`);
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
        // ---- the clan badge: two players in the same clan (the game's player_clanId) see each other as clanmates ----
        await a.evalJs('localStorage.setItem("player_clanId", "clanAbc123")'); await b.evalJs('localStorage.setItem("player_clanId", "clanAbc123")');
        check('clan: someone in your clan gets the badge, both ways', await b.waitFor('[...WHW.online.remotes.values()].some(r => r.info && r.info.n === "Alice" && WHW.online.clanmate(r))', 8000)
            && await a.waitFor('[...WHW.online.remotes.values()].some(r => WHW.online.clanmate(r))', 8000));
        await a.evalJs('localStorage.setItem("player_clanId", "otherClan9")');
        check('clan: and loses it once they are in another clan', await b.waitFor('![...WHW.online.remotes.values()].some(r => WHW.online.clanmate(r))', 8000));
        await a.evalJs('localStorage.removeItem("player_clanId")'); await b.evalJs('localStorage.removeItem("player_clanId")');
        // chat safety: a new visitor (nothing stored) sees rude words hidden in bubbles and in the chat log; the toggle shows them
        const drawn = (p) => p.evalJs(`new Promise(r => { const C = CanvasRenderingContext2D.prototype, f = C.fillText, seen = []; C.fillText = function (t) { seen.push(String(t)); return f.apply(this, arguments); };
            setTimeout(() => { C.fillText = f; r(seen.filter(s => /what the/.test(s))); }, 400); })`);
        await sleep(1600);
        check('chat: a line goes out', await a.evalJs('WHW.online.say("what the hell", false)') === true);
        await b.waitFor('WHWorldDebug.online().players.some(p => p.bubble === "what the hell")', 5000);
        const seenB = await drawn(b), seenA = await drawn(a);
        check('chat: the swear filter is on for a new visitor, in the other player\'s bubble and your own', await b.evalJs('localStorage.getItem("chat_safe_mode") === null')
            && seenB.length > 0 && seenB.every(s => s === 'what the ***') && seenA.length > 0 && seenA.every(s => s === 'what the ***'), { seenA, seenB });
        await b.evalJs('WHW.ui.openOnline()');
        const logB = () => b.evalJs('document.getElementById("onLog").textContent');
        check('chat: and in the chat log', (await logB()).includes('what the ***') && !(await logB()).includes('the hell'), await logB());
        await b.evalJs('(() => { const c = document.getElementById("onSafe"); c.checked = false; c.dispatchEvent(new Event("change")); return true; })()');
        check('chat: turning the filter off shows the words, in the log and the bubble', (await logB()).includes('what the hell') && (await drawn(b)).includes('what the hell')
            && await b.evalJs('localStorage.getItem("chat_safe_mode") === "0"'));
        await b.evalJs('(() => { const c = document.getElementById("onSafe"); c.checked = true; c.dispatchEvent(new Event("change")); return true; })()');
        check('chat: and back on hides them', (await logB()).includes('what the ***'));
        await b.evalJs('WHW.ui.closeModal()');
        await sleep(1600);
        check('chat: saying the same line again right after is refused', await a.evalJs('WHW.online.say("What  the hell", false)') === false);
        // standing still sends only the heartbeat (every 2.5 s), not ~10 updates a second (the rate the ?whdebug overlay shows,
        // over the last few seconds)
        await sleep(7000);
        const idle = await a.evalJs('WHWorldDebug.online().net');
        check('a player standing still sends only a heartbeat', !!idle && idle.outPerSec > 0.15 && idle.outPerSec < 0.7 && idle.inPerSec < 0.7, idle);
        // a third player can't get in (the relay takes two here): they are told it's full instead of a silent failure
        const c = await player('Carol', { offline: true });
        check('a player who cannot get in is told the Wilds is full', await c.waitFor('WHW.online.status === "error" && WHW.online.error === WHW.online.FULL_MSG', 15000),
            await c.evalJs('[typeof WHW, location.href, typeof WHW === "object" && WHW.online && [WHW.online.status, WHW.online.error]]'));
        check('the full player still plays offline', await c.evalJs('(() => { const f = WHWorldDebug.frames(); return new Promise(r => setTimeout(() => r(WHWorldDebug.frames() > f), 500)); })()'));
        await c.evalJs('WHW.online.stop(); true');

        // ---- PvP in Greenwood ----
        for (const p of [a, b]) await p.evalJs('WHWorldDebug.travel("greenwood")');
        await sleep(600);
        const place = (dx) => `(() => { const g = WHW.game; g.actors.forEach(x => { if (x.kind !== 'boss') x.dead = true; }); const c = g.map.camp; WHWorldDebug.teleport(c.x + ${dx}, c.y + 300); /* (outside the camp's ring: nobody can be hurt inside it) */ g.player.protectedUntil = 0; g.player.maxHp = 300; g.player.hp = 300; })()`;
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
            s.skills.learned.${id} = true; W.equipAbility(s, '${id}', 0); p.abCharges = {}; p.stam.val = 100; return WHW.actors.castAbility(0); })()`;
        check('the attacker casts Whirlwind next to them', await a.evalJs(castOn('warrior', 'whirlwind')) === true);
        check('Whirlwind hurts the other player (on their page)', await b.waitFor('WHW.game.player.hp < 300', 5000), await b.evalJs('WHW.game.player.hp'));
        check('they see the Whirlwind being cast', await b.waitFor('window.__casts.includes("whirlwind")', 3000), await b.evalJs('window.__casts'));
        await b.evalJs('(() => { const p = WHW.game.player; p.hp = 300; p.iframes = 0; })()');
        await sleep(400);
        check('the attacker fires a Net Shot at them', await a.evalJs(castOn('ranger', 'net_shot')) === true);
        check('a Net Shot stuns the other player, for less time than a monster', await b.waitFor('WHW.game.player.stunUntil > WHW.engine.time', 5000) &&
            await b.evalJs('WHW.game.player.stunUntil - WHW.engine.time <= WHWorldOnline.playerStun(WHWorldData.ABILITIES.net_shot.stun)'),
            await b.evalJs('({ got: window.__got.slice(-4), stun: WHW.game.player.stunUntil - WHW.engine.time, at: [WHW.game.player.x, WHW.game.player.y] })'));
        await a.evalJs('(() => { const W = WHWorld, g = WHW.game; W.setClass(g.state, "warrior"); g.pstats = W.playerStats(g.state); })()');
        await sleep(1300);
        // a Riposte against a player: their hit does nothing, and they are left with no stamina, none coming back for a while
        await b.evalJs('(() => { const p = WHW.game.player; p.hp = 300; p.iframes = 0; p.stunUntil = 0; })()');
        await a.evalJs('(() => { const p = WHW.game.player; p.stam.val = 100; p.exhaustUntil = 0; })()');
        check('the defender raises a Riposte', await b.evalJs(castOn('rogue', 'riposte')) === true);
        await b.evalJs('WHW.game.player.riposteUntil = WHW.engine.time + 5'); // a wide window, so the network delay can't miss it
        await a.evalJs('WHW.online.hitRemote(WHW.online.here()[0], { kind: "melee", dmg: 20, ang: 0, perfect: false })');
        check('the riposted attacker is disarmed: no stamina, and none coming back', await a.waitFor('WHW.game.player.exhaustUntil > WHW.engine.time', 5000) &&
            await a.evalJs('WHW.game.player.stam.val < 5'), await a.evalJs('({ ex: WHW.game.player.exhaustUntil - WHW.engine.time, stam: WHW.game.player.stam.val })'));
        check('the defender takes nothing', await b.evalJs('WHW.game.player.hp') === 300);
        await b.evalJs('(() => { const W = WHWorld, g = WHW.game; g.player.riposteUntil = 0; W.setClass(g.state, "warrior"); g.pstats = W.playerStats(g.state); })()');
        await a.evalJs('(() => { const p = WHW.game.player; p.exhaustUntil = 0; p.stam.val = 100; })()');
        await sleep(600);
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
        const hostView = (p) => p.evalJs('({ host: WHW.online.isHost, elected: WHW.online.hostUid, me: WHW.online.uid, fresh: WHW.online.boss && WHW.online.boss.h && WHW.online.boss.h.u, seen: WHW.online.here().map(r => [r.uid, Math.round(r.x), Math.round(r.y), r.stale]), at: [Math.round(WHW.game.player.x), Math.round(WHW.game.player.y)], sent: WHW.online.lastSent, paused: WHW.engine.paused })');
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

        // ---- shared monsters: the same ones, kills and damage shared, fights followed ----
        for (const p of [a, b]) await p.evalJs('(() => { WHWorldDebug.travel("town"); return true; })()');
        await sleep(500);
        for (const p of [a, b]) await p.evalJs('(() => { WHWorldDebug.travel("greenwood"); const g = WHW.game; g.player.maxHp = 1e6; g.player.hp = 1e6; g.player.protectedUntil = 0; WHWorldDebug.teleport(g.map.entry.x, g.map.entry.y); return true; })()');
        await a.waitFor('WHW.online.here().length === 1', 8000);
        await sleep(2000);
        const mobs = (p) => p.evalJs('WHW.game.actors.filter(x => x.sid && !x.dead).map(x => x.sid + ":" + x.type).sort().join(",")');
        const mobsA = await mobs(a), mobsB = await mobs(b);
        check('monsters: both pages have the same monsters in the same places', mobsA.length > 100 && mobsA === mobsB, { a: mobsA.slice(0, 120), b: mobsB.slice(0, 120) });
        const pick = await a.evalJs('(() => { const ms = WHW.game.actors.filter(x => x.sid && !x.dead && !x.elite && !x.aggro); return ms.slice(0, 3).map(x => x.sid); })()');
        const [k1, k2, k3] = pick;
        // a kill: gone from the other page too, and only the one who fought it is paid
        const kills0 = [await a.evalJs('WHW.game.state.stats.kills'), await b.evalJs('WHW.game.state.stats.kills')];
        await a.evalJs(`(() => { const m = WHW.game.actors.find(x => x.sid === "${k1}"); WHW.actors.damage(m, 1e9, { from: WHW.game.player, kbAngle: 0, kb: 0, s: 1 }); return true; })()`);
        check('monsters: a kill falls on the other page too', await b.waitFor(`!WHW.game.actors.some(x => x.sid === "${k1}" && !x.dead)`, 6000));
        await sleep(300);
        check('monsters: the one who fought it is paid, the other is not', await a.evalJs('WHW.game.state.stats.kills') === kills0[0] + 1 && await b.evalJs('WHW.game.state.stats.kills') === kills0[1]);
        // damage adds up: each deals 120 to a monster with 200 health
        await a.evalJs(`(() => { const m = WHW.game.actors.find(x => x.sid === "${k2}"); m.maxHp = m.hp = 200; WHW.actors.damage(m, 120, { from: WHW.game.player, kbAngle: 0, kb: 0, s: 1 }); return true; })()`);
        await b.evalJs(`(() => { const m = WHW.game.actors.find(x => x.sid === "${k2}"); m.maxHp = m.hp = 200; WHW.actors.damage(m, 120, { from: WHW.game.player, kbAngle: 0, kb: 0, s: 1 }); return true; })()`);
        check('monsters: two players\' damage adds up, and both are paid when it falls', await a.waitFor(`!WHW.game.actors.some(x => x.sid === "${k2}" && !x.dead)`, 6000) && await b.waitFor(`!WHW.game.actors.some(x => x.sid === "${k2}" && !x.dead)`, 6000)
            && await a.evalJs('WHW.game.state.stats.kills') === kills0[0] + 2 && await b.evalJs('WHW.game.state.stats.kills') === kills0[1] + 1,
            { a: await a.evalJs('WHW.game.state.stats.kills'), b: await b.evalJs('WHW.game.state.stats.kills'), kills0 });
        // a monster one player woke is where they have it for the other
        await a.evalJs(`(() => { const g = WHW.game, m = g.actors.find(x => x.sid === "${k3}"); m.aggro = true; WHWorldDebug.teleport(m.x + 60, m.y); return true; })()`);
        check('monsters: the one a player woke is followed on the other page', await b.waitFor(`(() => { const m = WHW.game.actors.find(x => x.sid === "${k3}"); return !!m && m.follow === true; })()`, 6000));
        await sleep(1200);
        const near = await b.evalJs(`(() => { const m = WHW.game.actors.find(x => x.sid === "${k3}"); return { x: m.x, y: m.y }; })()`), at = await a.evalJs(`(() => { const m = WHW.game.actors.find(x => x.sid === "${k3}"); return { x: m.x, y: m.y }; })()`);
        check('monsters: and it is in about the same place', Math.hypot(near.x - at.x, near.y - at.y) < 90, { near, at });
        const rate = await a.evalJs('WHWorldDebug.online().net');
        check('monsters: a fight stays cheap for the database', !rate || rate.outBytesPerSec < 1500, rate);
        // when its player lets go, the follower's copy carries on by itself
        await a.evalJs(`(() => { const g = WHW.game, m = g.actors.find(x => x.sid === "${k3}"); m.dead = true; g.actors.forEach(x => { if (x.kind !== 'boss') x.dead = true; }); return true; })()`); // (the entry has monsters of its own that wake)
        check('monsters: with nobody fighting, nothing is sent', await a.waitFor('!WHW.mobs.sentAny', 4000));

        // ---- the Arena: a duel, a wager, the Pit ----
        for (const p of [a, b]) await p.evalJs('(() => { WHWorldDebug.travel("arena"); const g = WHW.game; g.player.maxHp = 300; g.player.hp = 300; return true; })()');
        await sleep(800);
        await a.evalJs('WHWorldDebug.teleport(WHW.game.map.entry.x - 30, WHW.game.map.entry.y)'); await b.evalJs('WHWorldDebug.teleport(WHW.game.map.entry.x + 30, WHW.game.map.entry.y)');
        await a.waitFor('WHW.online.here().length === 1 && !!WHW.online.here()[0].info', 8000);
        check('arena: the lobby is safe', await b.evalJs('WHWorldOnline.validateHit({ w: "sword_1", k: "melee", dmg: 5, t: 1 }, { zone: "arena", attacker: { x: 0, y: 0, fl: 0 }, me: { x: 10, y: 0 }, now: 1, arenaOk: WHW.arena.hitFrom(WHW.online.here()[0].uid, { x: WHW.game.player.x + 10, y: WHW.game.player.y }, WHW.online.here()[0]) }).ok') === false);
        // knock the other one out in a live round: one direct hit on a player left with 1 health
        const koRound = async () => {
            await b.waitFor('!!WHW.arena.match && WHW.arena.match.state === "live"', 15000);
            await a.waitFor('!!WHW.arena.match && WHW.arena.match.state === "live"', 15000);
            await b.evalJs('(() => { const p = WHW.game.player; p.hp = 1; p.iframes = 0; p.protectedUntil = 0; WHW.shieldWanted = () => false; p.shield.up = false; })()');
            for (let i = 0; i < 6 && !(await b.evalJs('WHW.game.player.dead')); i++) {
                await a.evalJs('(() => { const r = WHW.online.here()[0]; WHWorldDebug.teleport(r.x - 30, r.y); })()');
                await sleep(350);
                await a.evalJs('WHW.online.hitRemote(WHW.online.here()[0], { kind: "melee", dmg: 40, ang: 0, perfect: false })');
                await sleep(500);
            }
        };
        const duel = async (stake) => {
            await a.evalJs(`WHW.arena.challenge(WHW.online.here()[0], "duel", ${stake})`);
            check('arena: the challenge arrives' + (stake ? ' (with a stake)' : ''), await b.waitFor('!!WHW.arena.invite && !document.getElementById("arenaInvite").hidden', 8000));
            await b.evalJs('WHW.arena.respond(true)');
            check('arena: accepted, both are put in the same ring' + (stake ? ' (with a stake)' : ''), await a.waitFor('!!WHW.arena.match', 8000) && await b.waitFor('!!WHW.arena.match', 8000) &&
                await a.evalJs('WHW.arena.match.ring') === await b.evalJs('WHW.arena.match.ring'));
            await koRound();
            check('arena: round one goes to the one who did the knocking out' + (stake ? ' (with a stake)' : ''), await a.waitFor('WHW.arena.match && WHW.arena.match.wins.a === 1', 8000) && await b.waitFor('WHW.arena.match && WHW.arena.match.wins.a === 1', 8000));
            await koRound();
            check('arena: two rounds won is the match, on both pages' + (stake ? ' (with a stake)' : ''), await a.waitFor('!WHW.arena.match || WHW.arena.match.result === "a"', 10000) && await b.waitFor('!WHW.arena.match || WHW.arena.match.result === "a"', 10000));
            await sleep(3500);
        };
        await duel(0);
        const ra = await a.evalJs('WHW.game.state.arena'), rb = await b.evalJs('WHW.game.state.arena');
        check('arena: the winner gains rating, the loser loses as much', ra.rating === 1016 && rb.rating === 984 && ra.w === 1 && rb.l === 1, { a: ra.rating, b: rb.rating });
        check('arena: a knockout there drops nothing', await b.evalJs('WHW.game.state.grave === null && WHW.online.loot.size === 0 && WHW.game.state.stats.pvpLosses === 1'));
        await a.evalJs('WHW.game.state.rubies = 1000'); await b.evalJs('WHW.game.state.rubies = 1000');
        await duel(250);
        const wa = await a.evalJs('WHW.game.state.arena'), wb = await b.evalJs('WHW.game.state.arena');
        check('arena: the wager\'s pot goes to the winner', wa.wagerWins === 1 && wa.wagerNet === 250 && wb.wagerNet === -250 && await b.evalJs('WHW.game.state.rubies') === 750, { a: wa.wagerNet, b: wb.wagerNet, bRubies: await b.evalJs('WHW.game.state.rubies') });
        // the Pit: anyone in it fights anyone else in it
        await a.evalJs('(() => { const pit = WHW.game.map.pit; WHWorldDebug.teleport(pit.x - 30, pit.y); WHW.game.player.protectedUntil = 0; })()');
        await b.evalJs('(() => { const pit = WHW.game.map.pit, p = WHW.game.player; WHWorldDebug.teleport(pit.x + 30, pit.y); p.protectedUntil = 0; p.hp = 1; p.iframes = 0; })()');
        await sleep(800);
        for (let i = 0; i < 6 && !(await b.evalJs('WHW.game.player.dead')); i++) {
            await a.evalJs('WHW.online.hitRemote(WHW.online.here()[0], { kind: "melee", dmg: 40, ang: 0, perfect: false })');
            await sleep(500);
        }
        check('pit: a knockout there is credited to the winner, with Glory', await a.waitFor('WHW.game.state.arena.pitKO === 1', 5000), await a.evalJs('WHW.game.state.arena'));
        check('pit: the loser is back on their feet at the gate soon after', await b.waitFor('!WHW.game.player.dead && Math.hypot(WHW.game.player.x - WHW.game.map.pitGate.x, WHW.game.player.y - WHW.game.map.pitGate.y) < 60', 6000));

        // ---- the queue, from the Arena panel (retest 2026-11-07: connected in town, its Play tab said online play was off) ----
        for (const p of [a, b]) await p.evalJs('WHWorldDebug.travel("town")');
        await sleep(600);
        const queueTab = (p) => p.evalJs('(() => { WHW.arena.openMenu("play"); const box = document.querySelector("#wModalBody [data-argate]"); return { gate: box && box.dataset.argate, text: box ? box.textContent : "", buttons: box ? box.querySelectorAll("[data-arq]").length : 0, status: WHW.online.status }; })()');
        const inTown = await queueTab(a);
        check('arena queue: connected in town, the Play tab offers the queue and doesn\'t say online play is off', inTown.status === 'online' && inTown.gate === 'go:' && inTown.buttons === 3 && !/need online play/i.test(inTown.text), inTown);
        await a.evalJs('document.querySelector("#wModalBody [data-arq=duel]").click()');
        check('arena queue: picking Duel there takes the player into the Arena and the queue, menu closed', await a.waitFor('WHW.game.zoneId === "arena" && WHW.online.zone === "arena" && WHW.arena.queue === "duel" && document.getElementById("wModal").hidden', 5000));
        await sleep(800);
        const alone = await queueTab(a);
        check('arena queue: with nobody else in the Arena it says nobody is available, not that online play is off', alone.gate === 'alone:duel' && /Nobody else is in the Arena right now/.test(alone.text) && !/need online play/i.test(alone.text), alone);
        await a.evalJs('WHW.ui.closeModal()');
        // the other player queues the same way: the queue pairs them on its own
        await queueTab(b);
        await b.evalJs('document.querySelector("#wModalBody [data-arq=duel]").click()');
        check('arena queue: two connected players in the queue are matched by it', await a.waitFor('!!WHW.arena.match', 15000) && await b.waitFor('!!WHW.arena.match', 8000) &&
            await a.evalJs('WHW.arena.match.id') === await b.evalJs('WHW.arena.match.id'));
        // ended at once (a forfeit), so nothing after this depends on a fight here
        await a.evalJs('WHW.arena.forfeit()');
        await b.waitFor('!WHW.arena.match || !!WHW.arena.match.result', 8000);

        // ---- the Proving Grounds: one wave, together ----
        for (const p of [a, b]) await p.evalJs('(() => { WHWorldDebug.travel("trials"); const g = WHW.game; WHWorldDebug.teleport(g.map.ready.x, g.map.ready.y); g.player.maxHp = 1e6; g.player.hp = 1e6; return true; })()');
        await a.waitFor('WHW.online.here().length === 1', 8000);
        await sleep(600);
        await a.evalJs('WHW.waves.start()');
        check('waves: the run is shared, counting both players', await b.waitFor('!!WHW.waves.run && WHW.waves.run.st === "fight"', 12000) && await b.evalJs('WHW.waves.run.n') === 2, await b.evalJs('WHW.waves.run'));
        await sleep(2500);
        const mids = (p) => p.evalJs('WHW.game.actors.filter(x => x.wave && !x.dead).map(x => x.wave.mid).sort().join(",")');
        const ma = await mids(a), mb = await mids(b);
        check('waves: both pages have the same monsters', ma.length > 0 && ma === mb, { a: ma, b: mb });
        const hostIsA = await a.evalJs('WHW.waves.isHost'), host = hostIsA ? a : b, other = hostIsA ? b : a;
        check('waves: exactly one page runs them', hostIsA !== await b.evalJs('WHW.waves.isHost'));
        const target = await other.evalJs('(() => { const m = WHW.game.actors.find(x => x.wave && !x.dead); WHW.actors.damage(m, 30, { from: WHW.game.player, kbAngle: 0, kb: 0, s: 1 }); return m.wave.mid; })()');
        check("waves: one player's damage shows on the other's monster", await host.waitFor(`(() => { const m = WHW.game.actors.find(x => x.wave && x.wave.mid === "${target}"); return !!m && m.maxHp - m.hp >= 29; })()`, 5000));
        for (let i = 0; i < 15 && await host.evalJs('WHW.waves.run.st') === 'fight'; i++) {
            await host.evalJs('WHW.game.actors.filter(x => x.wave && !x.dead).forEach(x => WHW.actors.damage(x, 1e9, { from: WHW.game.player, kbAngle: 0, kb: 0, s: 1 }))');
            await sleep(600);
        }
        check('waves: clearing it pays both players', await a.waitFor('WHW.game.state.arena.waveBest >= 1', 8000) && await b.waitFor('WHW.game.state.arena.waveBest >= 1', 8000),
            { a: await a.evalJs('WHW.waves.run && WHW.waves.run.st'), b: await b.evalJs('WHW.waves.run && WHW.waves.run.st') });
        // the old glitch: the page that doesn't run the wave kept the last monsters, frozen at no health and unkillable
        check('waves: no monster is left standing on the page that does not run them', await other.waitFor('WHW.game.actors.filter(x => x.wave && !x.dead).length === 0', 4000),
            await other.evalJs('WHW.game.actors.filter(x => x.wave && !x.dead).map(x => x.wave.mid + ":" + Math.round(x.hp)).join(",")'));
        check('waves: and none carry over into the next wave', await other.waitFor('!!WHW.waves.run && WHW.waves.run.st === "fight" && WHW.waves.run.wave === 2', 15000) &&
            await other.evalJs('WHW.game.actors.filter(x => x.wave && !x.dead).every(x => x.wave.mid.startsWith("w2_"))'));
        check('waves: during the fight both pages send at the co-op rate', await a.evalJs('WHW.online.sendMode()') === 'coop' && await b.evalJs('WHW.online.sendMode()') === 'coop');

        // ---- the leaderboards ----
        const board = (p, kind) => p.evalJs(`new Promise(r => WHW.online.readBoard("${kind}", t => r(Object.keys(t || {}).sort().join(","))))`);
        const uids = [await a.evalJs('WHW.online.uid'), await b.evalJs('WHW.online.uid')].sort().join(',');
        check('boards: both players are on this season\'s rating board, with their season\'s matches', await board(a, 'season') === uids &&
            await a.evalJs('new Promise(r => WHW.online.readBoard("season", t => r(WHWorldArena.topList(t).every(x => x.g >= 1))))'), await board(a, 'season'));
        check('boards: the season board is this month\'s (UTC), and last month\'s is a different one', await a.evalJs(`(() => { const id = WHWorldArena.seasonOf(WHW.online.db.serverNow()); return WHW.game.state.arena.season.id === id && WHWorldArena.prevSeason(id) !== id; })()`));
        await b.waitFor(`new Promise(r => WHW.online.readBoard("waves", t => r(Object.keys(t || {}).length === 2)))`, 5000);
        check('boards: both players are on the waves board, with their best wave', await board(b, 'waves') === uids &&
            await a.evalJs('new Promise(r => WHW.online.readBoard("waves", t => r(WHWorldArena.wavesList(t)[0].w >= 1)))'), await board(b, 'waves'));

        // ---- a party: in any zone, its own chat, no hurting each other ----
        for (const p of [a, b]) await p.evalJs('WHWorldDebug.travel("greenwood")');
        await sleep(600);
        await a.evalJs(place(-25)); await b.evalJs(place(25));
        await a.waitFor('WHW.online.here().length === 1 && !!WHW.online.here()[0].info', 8000);
        await a.evalJs('WHW.party.invitePlayer(WHW.online.here()[0])');
        check('party: the invitation arrives', await b.waitFor('!!WHW.party.invite && !document.getElementById("partyInvite").hidden', 8000));
        await b.evalJs('WHW.party.answer(true)');
        check('party: both are in it', await a.waitFor('WHW.party.members.size === 2', 6000) && await b.waitFor('WHW.party.members.size === 2', 6000) &&
            await a.evalJs('WHW.party.id') === await b.evalJs('WHW.party.id'));
        check('party: it shows in the corner, with the other member', await a.waitFor('!document.getElementById("partyHud").hidden && document.getElementById("partyHud").textContent.includes("Bobby")', 4000));
        check('party: a member is no target', await a.evalJs('WHW.online.targets().length') === 0 && await b.evalJs('WHW.online.targets().length') === 0);
        await b.evalJs('window.__got = []; WHW.game.player.hp = 300; WHW.game.player.protectedUntil = 0');
        await a.evalJs('WHW.online.hitRemote(WHW.online.here()[0], { kind: "melee", dmg: 40, ang: 0, perfect: false })');
        check("party: a member's hit is refused by the one hit", await b.waitFor('window.__got.includes("melee party")', 4000) && await b.evalJs('WHW.game.player.hp') === 300, await b.evalJs('window.__got'));
        await a.evalJs('WHW.engine.time += 5; WHW.party.say("meet me at the camp")');
        check('party: its chat reaches the other member', await b.waitFor('WHW.online.log.some(l => l.ch === "party" && l.m === "meet me at the camp")', 5000));
        await b.evalJs('WHWorldDebug.travel("town")');
        check('party: it works across zones (where each member is)', await a.waitFor('[...WHW.party.members].some(([u, m]) => u !== WHW.online.uid && m.z === "town")', 6000));
        await b.evalJs('WHW.engine.time += 5; WHW.party.say("in town now")');
        check('party: and its chat too', await a.waitFor('WHW.online.log.some(l => l.ch === "party" && l.m === "in town now")', 5000));

        // ---- the Sunken Vault (the coast's hidden dungeon): the party's own copy, a room fought together, the King's health for two ----
        for (const p of [a, b]) await p.evalJs('(() => { const s = WHW.game.state; s.unlocked.zones.coast = true; s.bosses.tidal = { kills: 1, lastKillDay: "", lastKillWeek: "", mythicWeek: "" }; WHWorldDebug.travel("coast"); WHW.actions.enterDungeon("vault"); return true; })()');
        check('vault: both go in, into the party\'s own copy (vault_ and the party id)', await a.waitFor('WHW.game.zoneId === "vault" && WHW.online.zone === "vault" && WHW.online.key === "vault_" + WHW.party.id', 8000) &&
            await b.waitFor('WHW.game.zoneId === "vault" && WHW.online.key === "vault_" + WHW.party.id', 8000), await a.evalJs('[WHW.game.zoneId, WHW.online.key, WHW.party.id]'));
        // the first time down a dungeon, how dungeons work opens (the Shared Burden among it); once, then not again
        check('vault: the first time down, how dungeons work is explained (the Shared Burden too)', await a.evalJs('WHW.ui.isOpen() && /Shared Burden/.test(document.getElementById("wModalBody").textContent) && WHW.game.state.tutorial.dungeons === true'));
        for (const p of [a, b]) await p.evalJs('WHW.ui.closeModal(); true');
        check('vault: they see each other there', await a.waitFor('WHW.online.here().length === 1', 8000) && await b.waitFor('WHW.online.here().length === 1', 8000));
        check('vault: only the first door is open', await a.evalJs('(() => { const m = WHW.game.map; return !!m.rooms && m.rooms[0].door.open && !m.rooms[1].door.open && !m.rooms[2].door.open && !m.kingDoor.open; })()'));
        await a.evalJs('(() => { const r = WHW.waves.vaultReady(); WHWorldDebug.teleport(r.x, r.y); WHW.waves.start(); return true; })()');
        check('vault: the first room starts on both pages, sealed', await a.waitFor('!!WHW.waves.run && WHW.waves.run.st === "fight" && WHW.waves.run.wave === 1', 12000) &&
            await b.waitFor('!!WHW.waves.run && WHW.waves.run.st === "fight" && !WHW.game.map.rooms[0].door.open', 12000), await b.evalJs('WHW.waves.run && [WHW.waves.run.st, WHW.waves.run.wave]'));
        await a.shot('vault-room');
        check('vault: both were brought into the room', await b.evalJs('(() => { const f = WHW.game.map.rooms[0].floor, p = WHW.game.player; return Math.hypot(p.x - f.x, p.y - f.y) < f.r; })()'));
        for (let i = 0; i < 30 && await a.evalJs('WHW.waves.run && WHW.waves.run.st') === 'fight'; i++) {
            for (const p of [a, b]) await p.evalJs('WHW.game.actors.filter(x => x.wave && !x.dead).forEach(x => WHW.actors.damage(x, 1e9, { from: WHW.game.player, kbAngle: 0, kb: 0, s: 1 }))');
            await sleep(700);
        }
        check('vault: clearing it pays both (rubies and a chest of essences) and opens the next door on both pages', await a.waitFor('WHW.waves.run.st === "break" && WHW.game.map.rooms[1].door.open && WHW.game.state.dungeons.rooms === 1 && WHW.game.state.dungeons.ess === 1', 10000) &&
            await b.waitFor('WHW.game.map.rooms[1].door.open && WHW.game.state.dungeons.rooms === 1', 10000), await a.evalJs('[WHW.waves.run.st, WHW.waves.run.wave, WHW.game.state.dungeons.rooms]'));
        check('vault: no room monster is left standing on either page', await a.waitFor('WHW.game.actors.filter(x => x.wave && !x.dead).length === 0', 4000) && await b.waitFor('WHW.game.actors.filter(x => x.wave && !x.dead).length === 0', 4000));
        // the King: as if the other two rooms were cleared too
        await a.evalJs('WHW.online.db.update(WHW.online.Z("w"), { st: "break", wave: 3, t: WHW.online.db.serverNow() })');
        check("vault: after the third room the King's chamber opens and he is there", await a.waitFor('WHW.game.map.kingDoor.open && WHW.game.actors.some(x => x.kind === "boss" && x.type === "drowned_king" && !x.dead)', 8000) &&
            await b.waitFor('WHW.game.map.kingDoor.open', 8000));
        await a.evalJs('(() => { const k = WHW.game.map.boss; WHWorldDebug.teleport(k.x - 40, k.y + k.r - 70); return true; })()');
        await b.evalJs('(() => { const k = WHW.game.map.boss; WHWorldDebug.teleport(k.x + 40, k.y + k.r - 70); return true; })()');
        await sleep(1500); await a.shot('vault-king');
        check('vault: his health is for a party of two', await a.waitFor('(() => { const s = WHW.online.boss; return !!s && s.max === WHWorldDungeons.bossHp(WHWorldData.BOSSES.drowned_king.hp, 2); })()', 15000), await a.evalJs('WHW.online.boss && WHW.online.boss.max'));
        // both hit him, in rounds of 30% of his health each (each needs a share of the damage to be paid, so no single hit may
        // fell him before the other's damage has reached the shared record)
        for (let i = 0; i < 6 && await a.evalJs('WHW.game.actors.some(x => x.kind === "boss" && !x.dead)'); i++) {
            for (const p of [a, b]) await p.evalJs('(() => { const k = WHW.game.actors.find(x => x.kind === "boss" && !x.dead); if (k) WHW.actors.damage(k, Math.ceil(WHW.online.boss.max * 0.3), { from: WHW.game.player, kbAngle: 0, kb: 0, s: 1 }); return !!k; })()');
            await sleep(900);
        }
        check("vault: the King falls and pays both their week's reward (3 Vault Seals and his Heart)", await a.waitFor('WHWorld.count(WHW.game.state, "vault_seal") === 3 && WHW.game.state.raid.kills === 1 && WHWorld.count(WHW.game.state, "heart_vault") === 1', 15000) &&
            await b.waitFor('WHWorld.count(WHW.game.state, "vault_seal") === 3', 15000), [await a.evalJs('WHWorld.count(WHW.game.state, "vault_seal")'), await b.evalJs('WHWorld.count(WHW.game.state, "vault_seal")')]);
        check('vault: the run is done', await a.waitFor('!!WHW.waves.run && WHW.waves.run.st === "over"', 8000));
        for (const p of [a, b]) await p.evalJs('WHW.actions.leaveDungeon()');
        check('vault: back up on the coast, by the way down', await a.waitFor('WHW.game.zoneId === "coast" && WHW.online.key === "coast" && Math.hypot(WHW.game.player.x - WHW.game.map.dungeon.x, WHW.game.player.y - WHW.game.map.dungeon.y) < 80', 6000) && await b.waitFor('WHW.game.zoneId === "coast"', 6000));

        // ---- a trade, face to face: a relic for rubies ----
        for (const p of [a, b]) await p.evalJs('WHWorldDebug.travel("town")');
        await sleep(600);
        const townSpot = (dx) => `(() => { const e = WHW.game.map.entry; WHWorldDebug.teleport(e.x + ${dx}, e.y); return true; })()`;
        await a.evalJs(townSpot(-25)); await b.evalJs(townSpot(25));
        await a.waitFor('WHW.online.here().length === 1 && !!WHW.online.here()[0].info', 8000);
        await a.evalJs(`(() => { const s = WHW.game.state; window.__relic = WHWorld.addGear(s, 'sword_3', 88, [], Date.now(), { r: { t: 4, l: [['might', 1], ['keen', 1], ['ember', 1]], m: ['titan_ruby'], c: ['#ff2d55', '#ffe14d'], q: '', by: 'Ann', n: 0, lv: 0 } }); return window.__relic.uid; })()`);
        await b.evalJs('WHW.game.state.rubies = 5000');
        const rubiesA0 = await a.evalJs('WHW.game.state.rubies');
        await a.evalJs('WHW.market.inviteTrade(WHW.online.here()[0])');
        check('trade: the invitation arrives', await b.waitFor('!!WHW.market.invite', 8000));
        await b.shot('trade-invite');
        await b.evalJs('document.getElementById("tYes").click()');
        check('trade: both are in it', await a.waitFor('!!WHW.game.state.market.trade && !!WHW.market.trade', 8000) && await b.waitFor('!!WHW.game.state.market.trade && !!WHW.market.trade', 8000));
        await a.evalJs('WHW.market.setOffer([{ kind: "w", uid: window.__relic.uid }], 0)');
        await b.evalJs('WHW.market.setOffer([], 1200)');
        check('trade: what is offered is set aside', await a.waitFor('!WHW.game.state.gear.some(g => g.uid === window.__relic.uid)', 3000) && await b.evalJs('WHW.game.state.rubies') === 3800);
        check('trade: each sees the other\'s offer', await a.waitFor('WHWorldMarket.tradeView(WHW.market.trade, WHW.online.uid, WHW.online.db.serverNow()).theirs.r === 1200', 8000) &&
            await b.waitFor('WHWorldMarket.tradeView(WHW.market.trade, WHW.online.uid, WHW.online.db.serverNow()).theirs.o.length === 1', 8000));
        await sleep(400); await a.shot('trade'); await b.shot('trade');
        for (const p of [a, b]) await p.evalJs('WHW.market.accept(false)');
        await sleep(600); await a.shot('trade-accepted');
        await a.waitFor('(() => { const v = WHWorldMarket.tradeView(WHW.market.trade, WHW.online.uid, WHW.online.db.serverNow()); return v.accepted.me && v.accepted.them; })()', 8000);
        await b.waitFor('(() => { const v = WHWorldMarket.tradeView(WHW.market.trade, WHW.online.uid, WHW.online.db.serverNow()); return v.accepted.me && v.accepted.them; })()', 8000);
        for (const p of [a, b]) await p.evalJs('WHW.market.accept(true)');
        check('trade: once both confirm, each gets exactly the other\'s offer', await b.waitFor('WHW.game.state.gear.some(g => g.r && g.r.by === "Ann" && g.r.n === 1 && g.base === "sword_3")', 10000) &&
            await a.waitFor(`WHW.game.state.rubies === ${rubiesA0} + 1200`, 10000), { a: await a.evalJs('WHW.game.state.rubies'), aWas: rubiesA0, b: await b.evalJs('WHW.game.state.gear.filter(g => g.r).map(g => g.r.by)') });
        check('trade: it is over on both pages, and counted', await a.waitFor('!WHW.game.state.market.trade && WHW.game.state.market.traded === 1', 6000) && await b.waitFor('!WHW.game.state.market.trade && WHW.game.state.market.traded === 1', 6000));

        // ---- the Auction Hall: list, bid, the winner claims, the seller is paid ----
        await b.evalJs('(() => { const it = WHW.game.state.gear.find(g => g.r && g.r.by === "Ann"); window.__lid = null; WHW.market.list({ kind: "w", uid: it.uid }, { min: 300, buy: 0, hours: 1 }); return true; })()');
        check('auction: the item is listed and set aside', await b.waitFor('Object.keys(WHW.game.state.market.listed).length === 1 && !WHW.game.state.gear.some(g => g.r && g.r.by === "Ann")', 8000));
        const lid = await b.evalJs('Object.keys(WHW.game.state.market.listed)[0]');
        await a.waitFor(`new Promise(r => WHW.online.db.once(WHWorldMarket.ahPath("${lid}")).then(l => r(!!l)))`, 8000);
        const aRubies = await a.evalJs('WHW.game.state.rubies');
        if (process.env.ONLINE_SHOTS) { await a.evalJs('WHW.market.openAuction(); true'); await sleep(1500); await a.shot('auction-browse'); await a.evalJs('WHW.ui.closeModal(); true'); }
        await a.evalJs(`WHW.online.db.once(WHWorldMarket.ahPath("${lid}")).then(l => WHW.market.bid(Object.assign({ id: "${lid}" }, l), 300, false))`);
        if (process.env.ONLINE_SHOTS) { await sleep(800); await b.evalJs('WHW.market.openAuction(); true'); await sleep(1500); await b.evalJs('(() => { const t = document.querySelector("#wModalBody [data-tab=mine]"); if (t) t.click(); return true; })()'); await sleep(600); await b.shot('auction-mine'); await b.evalJs('WHW.ui.closeModal(); true'); }
        check('auction: the bid sets the rubies aside', await a.waitFor(`WHW.game.state.market.bids["${lid}"] === 300 && WHW.game.state.rubies === ${aRubies} - 300`, 8000));
        // (the seller's page may settle on its own loop before the test asks it to: what it had before the sale counts)
        const bRubies = await b.evalJs('WHW.game.state.rubies');
        // (a test-only shortcut: the listing ends now; the local relay checks no rules)
        await b.evalJs(`WHW.online.db.commit(WHWorldMarket.ahPath("${lid}"), { end: WHW.online.db.serverNow() + 1500 })`);
        await sleep(2500);
        await a.evalJs('WHW.market.tick()');
        check('auction: the winner claims it', await a.waitFor('WHW.game.state.gear.some(g => g.r && g.r.by === "Ann" && g.r.n === 2)', 10000), await a.evalJs('JSON.stringify(WHW.game.state.market)'));
        await sleep(600);
        await b.evalJs('WHW.market.tick()');
        check('auction: the seller is paid, less the Hall\'s fee', await b.waitFor(`WHW.game.state.rubies === ${bRubies} + WHWorldMarket.sellerTakes(300) && Object.keys(WHW.game.state.market.listed).length === 0`, 10000), { was: bRubies, now: await b.evalJs('WHW.game.state.rubies') });
        check('auction: the listing is cleared away', await b.waitFor(`new Promise(r => WHW.online.db.once(WHWorldMarket.ahPath("${lid}")).then(l => r(!l)))`, 8000));

        // ---- a tournament: entry fees, a locked-tier kit, the winner takes the pot ----
        for (const p of [a, b]) await p.evalJs('(() => { WHWorldDebug.travel("arena"); const g = WHW.game; g.state.rubies = 1000; return true; })()');
        await sleep(800);
        await a.evalJs('WHWorldDebug.teleport(WHW.game.map.entry.x - 30, WHW.game.map.entry.y)'); await b.evalJs('WHWorldDebug.teleport(WHW.game.map.entry.x + 30, WHW.game.map.entry.y)');
        await a.waitFor('WHW.online.here().length === 1 && !!WHW.online.here()[0].info', 8000);
        const ownA = await a.evalJs('JSON.stringify(WHW.game.state.gear)');
        await a.evalJs('WHW.tour.create({ n: "Test Cup", fee: 100, size: 4, p2: 0, p3: 0, g: 3, start: 2 }, true)');
        check('tournament: opened, and the host paid their fee', await a.waitFor('WHW.tour.mine.size === 1 && WHW.game.state.rubies === 900', 5000));
        const tid = await a.evalJs('[...WHW.tour.mine.keys()][0]');
        // the other player finds it in the Arena Master's list and signs up
        await b.evalJs('WHW.arena.openMenu("tour")');
        check('tournament: it is listed for the other player', await b.waitFor(`WHW.tour.all.has("${tid}") && !!document.querySelector('[data-tjoin="${tid}"]')`, 6000));
        await b.evalJs(`document.querySelector('[data-tjoin="${tid}"]').click(); WHW.ui.closeModal(); true`);
        check('tournament: the other player signs up and pays', await b.waitFor('WHW.game.state.rubies === 900 && !!WHW.game.state.arena.tours["' + tid + '"]', 5000));
        await a.waitFor(`WHW.tour.mine.get("${tid}") && WHW.tour.mine.get("${tid}").entries.length === 2`, 5000);
        await a.evalJs(`WHW.tour.start(WHW.tour.mine.get("${tid}"))`);
        check('tournament: it starts, and the duel begins on its own', await a.waitFor('!!WHW.arena.match && !!WHW.arena.match.tour', 12000) && await b.waitFor('!!WHW.arena.match && !!WHW.arena.match.tour', 8000));
        check('tournament: locked to tier 3, both fight with the same kit', await a.evalJs('(() => { const s = WHW.game.state; return !!s.lent && WHWorld.findGear(s, s.hotbar[s.sel]).base.endsWith("_3") && s.equip.ring === null; })()') &&
            await b.evalJs('(() => { const s = WHW.game.state; return !!s.lent && WHWorld.findGear(s, s.hotbar[s.sel]).base.endsWith("_3"); })()') &&
            await a.evalJs('WHW.game.pstats.maxHp') === await b.evalJs('WHW.game.pstats.maxHp'));
        check('tournament: a party member on the other side can be fought', await a.waitFor('!!WHW.arena.match && WHW.arena.match.state === "live" && WHW.online.targets().length === 1', 15000));
        await koRound();
        await koRound();
        check('tournament: the duel ends, and each page says how it went', await a.waitFor('!WHW.arena.match || !!WHW.arena.match.result', 10000) &&
            await a.waitFor(`(() => { const t = WHW.tour.mine.get("${tid}"); return !!t && Object.keys(t.res).length === 2; })()`, 8000));
        await a.waitFor('!WHW.arena.match', 6000);
        const rubiesA = await a.evalJs('WHW.game.state.rubies'); // (a duel's own first-wins-of-the-day rubies are paid already)
        check('tournament: the kit goes back, and the save never held it', await a.waitFor('!WHW.game.state.lent', 5000) && await a.evalJs('JSON.stringify(WHW.game.state.gear)') === ownA &&
            await a.evalJs('JSON.parse(localStorage.getItem("whathappened_world")).gear.length') === JSON.parse(ownA).length);
        check('tournament: once settled, the winner gets the whole pot', await a.waitFor('WHW.game.state.rubies === ' + (rubiesA + 200), 30000) && await b.evalJs('WHW.game.state.rubies') === 900,
            { a: await a.evalJs('WHW.game.state.rubies'), b: await b.evalJs('WHW.game.state.rubies'), ta: await a.evalJs('WHW.game.state.arena.tours') });
        check('tournament: and it counts as a tournament win', await a.evalJs('WHW.game.state.arena.tourWins') === 1 && await b.waitFor('WHW.game.state.arena.tourPlayed === 1', 5000));
        await a.evalJs('WHW.party.leave()');
        check('party: leaving it', await b.waitFor('WHW.party.members.size === 1', 5000));

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
