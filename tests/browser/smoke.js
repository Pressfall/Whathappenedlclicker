/**
 * Real-browser smoke test (npm run test:browser). Not part of `npm test`: it needs Chrome.
 *
 * Serves the project with server.js, opens it in a throwaway headless Chrome profile over the DevTools protocol and checks
 * what the unit tests cannot: that the pages load their scripts and modules, that nothing from Google ads or analytics is
 * requested before consent, and that the first-run guide, Settings and consent notice work in a real browser.
 * Requests to ad, analytics, Firestore and Auth hosts are blocked, so nothing reaches production services.
 *
 * CHROME_PATH   path to chrome / chromium (default: the usual Windows, macOS and Linux locations)
 * SMOKE_SHOTS   a folder to save screenshots into
 */
const { spawn, execFileSync } = require('child_process');
const fs = require('fs');
const os = require('os');
const path = require('path');

const ROOT = path.resolve(__dirname, '..', '..');
const SCRATCH = process.env.SMOKE_SHOTS || '';
const PROFILE = fs.mkdtempSync(path.join(os.tmpdir(), 'wh-smoke-profile-'));
const PORT = 8123, DEBUG = 9333;
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
const check = (name, ok, extra) => { results.push({ name, ok: !!ok, extra }); console.log((ok ? 'PASS ' : 'FAIL ') + name + (extra && !ok ? '  -> ' + JSON.stringify(extra) : '')); };

async function main() {
    // static server (the project's own server.js)
    const server = spawn(process.execPath, [path.join(ROOT, 'server.js')], { env: { ...process.env, PORT: String(PORT) }, stdio: 'ignore' });
    const chrome = spawn(CHROME, [
        '--headless=new', `--remote-debugging-port=${DEBUG}`, `--user-data-dir=${PROFILE}`, '--no-first-run', '--no-default-browser-check',
        '--disk-cache-size=1048576', '--disable-component-update', '--disable-background-networking', '--safebrowsing-disable-auto-update',
        '--window-size=1280,1400', 'about:blank',
    ], { stdio: 'ignore' });
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
        // wait for the debug port (slow on managed machines)
        let targets = null;
        for (let i = 0; i < 60 && !targets; i++) {
            try { targets = await (await fetch(`http://127.0.0.1:${DEBUG}/json`)).json(); } catch (e) { await sleep(1000); }
        }
        if (!targets) throw new Error('Chrome never opened the debugging port');
        const page = targets.find((t) => t.type === 'page');
        const ws = new WebSocket(page.webSocketDebuggerUrl);
        await new Promise((r) => ws.addEventListener('open', r));
        let id = 0; const pending = new Map(); const events = [];
        ws.addEventListener('message', (m) => {
            const msg = JSON.parse(m.data);
            if (msg.id && pending.has(msg.id)) { pending.get(msg.id)(msg); pending.delete(msg.id); } else events.push(msg);
        });
        const send = (method, params = {}) => new Promise((res) => { const i = ++id; pending.set(i, res); ws.send(JSON.stringify({ id: i, method, params })); });
        const evalJs = async (expression) => { const r = await send('Runtime.evaluate', { expression, awaitPromise: true, returnByValue: true }); return r.result && r.result.result ? r.result.result.value : undefined; };

        await send('Page.enable'); await send('Runtime.enable'); await send('Log.enable');
        await send('Fetch.enable', { patterns: [{ urlPattern: '*' }] });
        const blocked = [], seen = [];
        const blockRe = /googlesyndication|doubleclick|google-analytics|googletagmanager|analytics\.google|firestore\.googleapis|identitytoolkit|securetoken|firebaseinstallations|firebase\.googleapis|google\.com\/pagead/;
        const handleFetch = async () => {
            for (let i = 0; i < events.length; i++) {
                const e = events[i];
                if (e.method === 'Fetch.requestPaused') {
                    events.splice(i, 1); i--;
                    const url = e.params.request.url; seen.push(url);
                    if (blockRe.test(url)) { blocked.push(url); send('Fetch.failRequest', { requestId: e.params.requestId, errorReason: 'BlockedByClient' }); }
                    else send('Fetch.continueRequest', { requestId: e.params.requestId });
                }
            }
        };
        const pump = setInterval(handleFetch, 25);

        const waitFor = async (expr, ms = 40000) => { const t = Date.now(); while (Date.now() - t < ms) { if (await evalJs(expr)) return true; await sleep(250); } return false; };
        const navigate = async (url, readyExpr) => { await send('Page.navigate', { url }); await sleep(1500); await waitFor(readyExpr || 'document.readyState === "complete"'); await sleep(800); };
        const errors = () => events.filter((e) => e.method === 'Runtime.exceptionThrown').map((e) => (e.params.exceptionDetails.exception && e.params.exceptionDetails.exception.description) || e.params.exceptionDetails.text);

        // ---- 1. first visit ----
        await navigate(`http://localhost:${PORT}/index.html`, 'window._saveLoaded === true');
        await waitFor('typeof window.WHCloud === "object"', 30000);
        check('page title loads', /WHAT HAPPENED/i.test(await evalJs('document.title') || ''));
        check('guide card visible for a new player', await evalJs('!document.getElementById("guideCard").hidden'));
        check('guide shows 5 steps', (await evalJs('document.querySelectorAll("#guideSteps li").length')) === 5);
        check('consent notice shown with 2 buttons', (await evalJs('document.querySelectorAll("#whConsent button").length')) === 2);
        check('no AdSense script before consent', (await evalJs('[...document.scripts].filter(s=>/googlesyndication/.test(s.src)).length')) === 0);
        check('no AdSense request was even attempted before consent', !seen.some((u) => /googlesyndication/.test(u)));
        check('ad slot hidden before consent', await evalJs('document.getElementById("adWrapper").hidden'));
        check('no Analytics request before consent', !seen.some((u) => /google-analytics|googletagmanager|firebase-analytics/.test(u)));
        check('cloud.js module loaded (WHCloud exists)', await evalJs('typeof window.WHCloud === "object" && typeof window.WHCloud.saveNow === "function"'));
        check('game finished loading (overlay gone)', await evalJs('getComputedStyle(document.getElementById("loadingOverlay")).display === "none" || !document.getElementById("loadingOverlay")'));
        const shot1 = await send('Page.captureScreenshot', { format: 'png' });
        if (SCRATCH) fs.writeFileSync(path.join(SCRATCH, 'shot-first-visit.png'), Buffer.from(shot1.result.data, 'base64'));

        // ---- 2. play a little: guide follows ----
        await evalJs('(() => { count = 1000; buyUpgrade1(); updateDisplays(); window.WHGuideUI.update(); })()');
        check('guide step 2 done after buying OP mouse', await evalJs('document.querySelectorAll("#guideSteps li.is-done").length') >= 2);
        check('guide names the next special', /Mousepad of Destiny/.test(await evalJs('document.getElementById("guideNext").textContent') || ''));

        // ---- 3. settings: save backup + export ----
        await evalJs('document.getElementById("settingsMenu").classList.contains("open") || toggleSettingsMenu()');
        await waitFor('document.getElementById("settingsMenu").classList.contains("open") && document.getElementById("settingsMenu").getBoundingClientRect().right > 100', 10000);
        await sleep(800);
        check('Save backup section exists in Settings', await evalJs('!!document.getElementById("exportSaveBtn") && !!document.getElementById("importSaveInput")'));
        check('hidden Settings rows are really hidden by the stylesheet', (await evalJs('["restoreBackupRow","damagedSaveRow"].map(id => getComputedStyle(document.getElementById(id)).display).join()')) === 'none,none');
        await evalJs('document.getElementById("exportSaveBtn").click()');
        await sleep(400);
        check('export reports a download', /Downloaded whathappened-save-/.test(await evalJs('document.getElementById("saveToolsStatus").textContent') || ''), await evalJs('document.getElementById("saveToolsStatus").textContent'));
        await evalJs('document.getElementById("saveBackupGroup").scrollIntoView({block:"start"})');
        await sleep(300);
        const shot2 = await send('Page.captureScreenshot', { format: 'png' });
        if (SCRATCH) fs.writeFileSync(path.join(SCRATCH, 'shot-settings.png'), Buffer.from(shot2.result.data, 'base64'));
        await evalJs('toggleSettingsMenu()');

        // ---- 4. Accept ----
        await evalJs('document.querySelector("#whConsent [data-consent=granted]").click()');
        await sleep(2500);
        check('AdSense script added after Accept', (await evalJs('[...document.scripts].filter(s=>/googlesyndication/.test(s.src)).length')) === 1);
        check('ad slot visible after Accept', !(await evalJs('document.getElementById("adWrapper").hidden')));
        check('consent notice gone after Accept', !(await evalJs('!!document.getElementById("whConsent")')));
        check('Analytics module requested only after Accept', seen.some((u) => /firebase-analytics/.test(u)));

        // ---- 5. reload: remembered ----
        await evalJs('suppressAutosave = false; saveGame()');
        await navigate(`http://localhost:${PORT}/index.html`, 'window._saveLoaded === true');
        check('choice remembered after reload (no notice)', !(await evalJs('!!document.getElementById("whConsent")')));
        check('AdSense script present after reload', (await evalJs('[...document.scripts].filter(s=>/googlesyndication/.test(s.src)).length')) === 1);
        check('progress survived the reload', (await evalJs('Number(upgrade1Level)')) === 1);

        // ---- 6. decline from settings ----
        await evalJs('document.getElementById("adChoicesBtn").click()');
        await evalJs('document.querySelector("#whConsent [data-consent=denied]").click()');
        check('Decline stored', (await evalJs('localStorage.getItem("wh_ad_consent")')) === 'denied');
        check('ad slot hidden after Decline', await evalJs('document.getElementById("adWrapper").hidden'));

        // ---- 7. other pages: no ads without consent, link present ----
        await evalJs('localStorage.removeItem("wh_ad_consent")');
        for (const p of ['leaderboard.html', 'gamba.html', 'achievements.html', 'privacy.html']) {
            await navigate(`http://localhost:${PORT}/${p}`);
            check(`${p}: no AdSense script before consent`, (await evalJs('[...document.scripts].filter(s=>/googlesyndication/.test(s.src)).length')) === 0);
            check(`${p}: consent notice present`, !!(await evalJs('!!document.getElementById("whConsent")')));
        }
        // ---- 8. account page loads its modules with the shared core ----
        await navigate(`http://localhost:${PORT}/account.html`);
        check('account page: no script errors', errors().filter((e) => /progress|WHProgress|cloud|account/i.test(e)).length === 0, errors());
        check('account page rendered', (await evalJs('document.body.innerText.length')) > 200);

        // ---- 9. the Wilds: moving, swinging, and rewards reaching the game ----
        await navigate(`http://localhost:${PORT}/world.html?whdebug`, 'typeof window.WHWorldDebug === "object" && WHWorldDebug.frames() > 30');
        check('wilds: game loop running', (await evalJs('WHWorldDebug.frames()')) > 30);
        await evalJs('WHW.ui.closeModal()');
        const key = (type) => send('Input.dispatchKeyEvent', { type, key: 'd', code: 'KeyD', text: type === 'keyDown' ? 'd' : undefined, windowsVirtualKeyCode: 68 });
        const x0 = await evalJs('WHWorldDebug.player().x');
        await key('keyDown'); await sleep(500); await key('keyUp');
        check('wilds: holding D walks right', (await evalJs('WHWorldDebug.player().x')) > x0 + 20);
        await evalJs('WHWorldDebug.travel("greenwood"); WHW.game.actors.forEach(a => { if (a.kind !== "boss") a.dead = true; })');
        await sleep(400);
        const dummy = await evalJs('WHWorldDebug.spawnDummy()');
        const pp = await evalJs('(() => { const p = WHW.game.player; return WHW.engine.worldToScreen(p.x, p.y); })()');
        const mouseTo = (a, r) => send('Input.dispatchMouseEvent', { type: 'mouseMoved', x: pp.x + Math.cos(a) * r, y: pp.y + Math.sin(a) * r, button: 'none', buttons: 0 });
        const hp0 = await evalJs(`WHWorldDebug.actorHp(${JSON.stringify(dummy)})`);
        for (let i = 0; i <= 50; i++) { await mouseTo(-1 + i / 50 * 2, 90); await sleep(25); }
        check('wilds: a slow drag through a monster does no damage', (await evalJs(`WHWorldDebug.actorHp(${JSON.stringify(dummy)})`)) === hp0);
        let maxOmega = 0;
        for (let k = 0; k < 6; k++) {
            for (let i = 0; i <= 6; i++) { await mouseTo((k % 2 ? 1 : -1) * (-1.2 + i / 6 * 2.4), 90); await sleep(8); maxOmega = Math.max(maxOmega, Math.abs(await evalJs('WHWorldDebug.weaponOmega()'))); }
            await sleep(120);
        }
        check('wilds: the weapon follows the mouse', maxOmega > 5, maxOmega);
        check('wilds: fast swings hurt it', (await evalJs(`WHWorldDebug.actorHp(${JSON.stringify(dummy)})`)) < hp0);
        // abilities: learn Whirlwind in the menu, cast it with Z, and see it hurt the nearby monster and go on cooldown
        const press = async (k, code, vk) => { await send('Input.dispatchKeyEvent', { type: 'keyDown', key: k, code, text: k, windowsVirtualKeyCode: vk }); await send('Input.dispatchKeyEvent', { type: 'keyUp', key: k, code, windowsVirtualKeyCode: vk }); };
        await evalJs('WHWorldDebug.rubies(500)');
        await press('k', 'KeyK', 75); await sleep(200);
        check('wilds: K opens the classes menu on the Warrior', await evalJs('WHW.ui.isOpen() && !!document.querySelector("[data-learn=whirlwind]")'));
        await evalJs('document.querySelector("[data-tab=rogue]").click()');
        check('wilds: a locked class shows its challenge', await evalJs('/Land 10 backstabs/.test(document.getElementById("wModalBody").textContent) && !!document.querySelector("[data-unlock=rogue][disabled]")'));
        await evalJs('document.querySelector("[data-tab=warrior]").click()');
        await evalJs('document.querySelector("[data-learn=whirlwind]").click()');
        await sleep(100);
        check('wilds: learning Whirlwind puts it on Z', (await evalJs('WHWorld.abilityKit(WHWorldDebug.state())[0]')) === 'whirlwind');
        await evalJs('WHW.ui.closeModal()');
        await sleep(200);
        await evalJs('(() => { const d = WHW.game.actors.find(a => a.id === ' + JSON.stringify(dummy) + '); d.x = WHW.game.player.x + 40; d.y = WHW.game.player.y; d.hp = d.maxHp; })()');
        const hpA = await evalJs(`WHWorldDebug.actorHp(${JSON.stringify(dummy)})`);
        await press('z', 'KeyZ', 90); await sleep(150);
        check('wilds: Whirlwind (Z) hurts the monster next to you', (await evalJs(`WHWorldDebug.actorHp(${JSON.stringify(dummy)})`)) < hpA);
        check('wilds: the ability goes on cooldown', (await evalJs('document.querySelector(".w-abil .cd") && !document.querySelector(".w-abil .cd").hidden')) === true);
        // every class's abilities cast without errors and do their job
        const cast = await evalJs(`(() => {
            const D = WHWorldData, W = WHWorld, g = WHW.game, p = g.player, s = g.state, out = {}, hurt = {}, bad = [];
            const d = g.actors.find(a => a.id === ${JSON.stringify(dummy)});
            for (const c of D.CLASS_ORDER) {
                s.classes.unlocked[c] = true; W.setClass(s, c); g.pstats = W.playerStats(s);
                D.CLASSES[c].abilities.forEach((id, key) => {
                    s.abilities.learned[id] = true;
                    p.abCd = {}; p.stam.val = 100; p.hp = 40; p.skinUntil = p.berserkUntil = 0;
                    d.dead = false; d.hp = d.maxHp; d.x = p.x + 40; d.y = p.y;
                    const shots = g.projectiles.length;
                    out[id] = WHW.actors.castAbility(key);
                    hurt[id] = d.hp < d.maxHp;
                    if (id === 'second_wind' && !(p.hp > 40)) bad.push('second_wind heal');
                    if (id === 'stoneskin' && !(p.skinUntil > WHW.engine.time)) bad.push('stoneskin');
                    if (id === 'berserk' && !(p.berserkUntil > WHW.engine.time)) bad.push('berserk');
                    if (id === 'fan_of_knives' && g.projectiles.length - shots !== 12) bad.push('knives');
                    if (id === 'arrow_volley' && g.projectiles.length - shots !== 7) bad.push('volley');
                    if (id === 'smoke_bomb' && !(d.status.stunUntil > WHW.engine.time)) bad.push('smoke stun');
                    if (WHW.actors.castAbility(key)) bad.push(id + ' ignored its cooldown');
                });
            }
            W.setClass(s, 'warrior'); g.pstats = W.playerStats(s);
            return { ok: out, bad, novas: ['whirlwind', 'fire_nova', 'frost_nova', 'chain_lightning', 'disengage'].filter(id => !hurt[id]) };
        })()`);
        check('wilds: every class ability can be cast', Object.values(cast.ok).length === 15 && Object.values(cast.ok).every(Boolean), cast);
        check('wilds: novas and chain lightning hurt a monster next to you', cast.novas.length === 0, cast.novas);
        check('wilds: heals, buffs, knives, volley, smoke and cooldowns work', cast.bad.length === 0, cast.bad);
        await evalJs('WHWorldDebug.grant({ gems: 2, boxes: [0, 1, 0, 0, 0] })');
        await navigate(`http://localhost:${PORT}/index.html`, 'window._saveLoaded === true');
        await sleep(600);
        check('wilds: gems sent home arrive in the game', (await evalJs('getGems()')) >= 2);
        check('wilds: lootboxes sent home arrive in Items', (await evalJs('JSON.parse(localStorage.getItem("whathappened_items")).boxes[1]')) >= 1);
        check('wilds: the game acknowledged them', Number(await evalJs('localStorage.getItem("whathappened_world_ack")')) >= 1);
        check('wilds: menu button present', await evalJs('!!document.getElementById("worldTopBtn")'));

        const bad = errors().filter((e) => !/Failed to fetch|firebase|Firestore|ERR_BLOCKED|Load failed|NetworkError|net::/i.test(e));
        check('no uncaught page errors on any page (network noise excluded)', bad.length === 0, bad);
        clearInterval(pump);
        console.log('blocked requests:', [...new Set(blocked.map((u) => new URL(u).host))].join(', '));
        ws.close();
    } finally {
        cleanup();
    }
    const failed = results.filter((r) => !r.ok);
    console.log(`\n${results.length - failed.length}/${results.length} browser checks passed`);
    process.exitCode = failed.length ? 1 : 0;
}
main().catch((e) => { console.error('smoke test crashed:', e); process.exitCode = 2; });
