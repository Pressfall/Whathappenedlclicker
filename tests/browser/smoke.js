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
        check('wilds: a quest giver waits at the Greenwood camp', await evalJs('WHW.game.map.npcs.some(n => n.id === "fenna")'));
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
        check('wilds: K opens the skill tree on the Warrior', await evalJs('WHW.ui.isOpen() && !!document.querySelector("[data-learn=whirlwind]") && document.querySelectorAll(".w-branch").length === 3 && document.querySelectorAll(".w-node").length === 12'));
        await evalJs('document.querySelector("[data-tab=rogue]").click()');
        check('wilds: a locked class shows its challenge', await evalJs('/Land 10 backstabs/.test(document.getElementById("wModalBody").textContent) && !!document.querySelector("[data-unlock=rogue][disabled]")'));
        await evalJs('document.querySelector("[data-tab=lancer]").click()');
        check('wilds: the Lancer is there with its spear challenge', await evalJs('/charging spear thrusts/.test(document.getElementById("wModalBody").textContent) && !!document.querySelector("[data-unlock=lancer][disabled]")'));
        await evalJs('document.querySelector("[data-tab=warrior]").click()');
        check('wilds: only the top of each branch can be learned at first', await evalJs('!document.querySelector("[data-learn=honed_edge]") && /Learn Whirlwind first/.test(document.getElementById("wModalBody").textContent)'));
        await evalJs('document.querySelector("[data-learn=whirlwind]").click()');
        await sleep(100);
        check('wilds: learning Whirlwind puts it on R', (await evalJs('WHWorld.abilityKit(WHWorldDebug.state())[0]')) === 'whirlwind');
        check('wilds: the next skill in its branch opens up', await evalJs('!!document.querySelector("[data-learn=honed_edge]:not([disabled])")'));
        await evalJs('document.querySelector("[data-learn=honed_edge]").click()');
        await sleep(100);
        check('wilds: a perk changes your stats', (await evalJs('WHW.game.pstats.dmgBy.sword')) > 1.2);
        await evalJs('document.querySelector("[data-equip=whirlwind][data-slot=\'2\']").click()');
        await sleep(100);
        check('wilds: the key buttons move an ability to C', (await evalJs('WHWorld.abilityKit(WHWorldDebug.state()).join()')) === ',,whirlwind');
        await evalJs('document.querySelector("[data-equip=whirlwind][data-slot=\'0\']").click()');
        await sleep(100);
        await evalJs('WHW.ui.closeModal()');
        await sleep(200);
        await evalJs('(() => { const d = WHW.game.actors.find(a => a.id === ' + JSON.stringify(dummy) + '); d.x = WHW.game.player.x + 40; d.y = WHW.game.player.y; d.hp = d.maxHp; })()');
        const hpA = await evalJs(`WHWorldDebug.actorHp(${JSON.stringify(dummy)})`);
        await press('r', 'KeyR', 90); await sleep(150);
        check('wilds: Whirlwind (R) hurts the monster next to you', (await evalJs(`WHWorldDebug.actorHp(${JSON.stringify(dummy)})`)) < hpA);
        check('wilds: the ability goes on cooldown', (await evalJs('document.querySelector(".w-abil .cd") && !document.querySelector(".w-abil .cd").hidden')) === true);
        // Z drinks a potion (Q is an ability key now)
        await evalJs('(() => { const g = WHW.game; g.state.cons.potion_small = 2; g.player.hp = 20; g.potionCd = 0; return true; })()');
        await press('q', 'KeyQ', 81); await sleep(100);
        const potQ = await evalJs('WHW.game.state.cons.potion_small');
        await press('z', 'KeyZ', 90); await sleep(150);
        check('wilds: Z drinks a potion, Q does not', potQ === 2 && (await evalJs('WHW.game.state.cons.potion_small === 1 && WHW.game.player.hp > 20')), potQ);
        await evalJs('WHW.game.player.hp = 20'); await press('z', 'KeyZ', 90); await sleep(150);
        check('wilds: then potions wait for their cooldown, shown on the button', (await evalJs('WHW.game.state.cons.potion_small === 1 && WHW.game.player.hp < 30 && !document.querySelector("[data-potion] .cd").hidden')) === true);
        await evalJs('(() => { const p = WHW.game.player; p.hp = p.maxHp; return true; })()');
        // every ability of every class casts without errors and does its job; aim to the right, where the monster stands
        await mouseTo(0, 90); await sleep(50);
        const cast = await evalJs(`(() => {
            const D = WHWorldData, W = WHWorld, g = WHW.game, p = g.player, s = g.state, T = WHW.engine.time, out = {}, hurt = {}, bad = [];
            const d = g.actors.find(a => a.id === ${JSON.stringify(dummy)});
            const x0 = p.x, y0 = p.y;
            for (const c of D.CLASS_ORDER) {
                s.classes.unlocked[c] = true; W.setClass(s, c); g.pstats = W.playerStats(s);
                for (const br of D.CLASSES[c].branches) for (const id of br.skills) {
                    if (!D.ABILITIES[id]) continue;
                    s.skills.learned[id] = true; W.equipAbility(s, id, 0);
                    p.x = x0; p.y = y0; p.abCharges = {}; p.buffs = {}; p.stam.val = 100; p.hp = 40; p.pull = null; p.riposteUntil = 0; p.iframes = 0;
                    d.dead = false; d.hp = d.maxHp; d.x = p.x + 40; d.y = p.y; d.status.stunUntil = 0;
                    const shots = g.projectiles.length, fields = g.fields.length;
                    out[id] = WHW.actors.castAbility(0);
                    hurt[id] = d.hp < d.maxHp;
                    const a = D.ABILITIES[id];
                    if (a.kind === 'heal' && !(p.hp > 40)) bad.push(id + ' heal');
                    if (a.kind === 'buff' && !WHW.actors.buffOn(p, id)) bad.push(id + ' buff');
                    if (a.kind === 'hook' && !(d.status.stunUntil > T)) bad.push(id + ' hook stun');
                    if (a.kind === 'parry' && !(p.riposteUntil > T)) bad.push(id + ' guard');
                    if (a.kind === 'volley' && g.projectiles.length - shots !== a.count) bad.push(id + ' volley');
                    if (a.kind === 'shot' && g.projectiles.length - shots !== 1) bad.push(id + ' shot');
                    if (a.kind === 'field' && g.fields.length - fields !== 1) bad.push(id + ' field');
                    if (a.kind === 'smoke' && !(d.status.stunUntil > T)) bad.push(id + ' stun');
                    // every charge casts, then it waits
                    for (let k = 1; k < (a.charges || 1); k++) { p.pull = null; p.stam.val = 100; if (!WHW.actors.castAbility(0)) bad.push(id + ' charge ' + (k + 1)); }
                    p.pull = null; p.stam.val = 100;
                    if (WHW.actors.castAbility(0)) bad.push(id + ' ignored its cooldown');
                }
            }
            p.x = x0; p.y = y0; p.buffs = {}; p.pull = null; p.riposteUntil = 0; g.fields = []; g.projectiles = [];
            W.setClass(s, 'warrior'); g.pstats = W.playerStats(s);
            const instant = ['nova', 'cone', 'charge', 'leap', 'line', 'chain', 'step', 'hook'];
            return { ok: out, bad, missed: D.ABILITY_ORDER.filter(id => instant.includes(D.ABILITIES[id].kind) && !hurt[id]) };
        })()`);
        check('wilds: all 36 abilities can be cast', Object.values(cast.ok).length === 36 && Object.values(cast.ok).every(Boolean), cast.ok);
        check('wilds: novas, cones, charges, leaps, lines, lightning, hooks and Shadowstep hurt a monster in front of you', cast.missed.length === 0, cast.missed);
        check('wilds: heals, buffs, volleys, shots, areas, smoke, the Riposte guard, charges and cooldowns work', cast.bad.length === 0, cast.bad);
        // an area keeps hurting what stands in it
        await evalJs(`(() => { const D = WHWorldData, W = WHWorld, g = WHW.game, p = g.player, s = g.state, d = g.actors.find(a => a.id === ${JSON.stringify(dummy)});
            s.classes.unlocked.mystic = true; W.setClass(s, 'mystic'); g.pstats = W.playerStats(s); s.skills.learned.blizzard = true; W.equipAbility(s, 'blizzard', 0);
            p.abCharges = {}; p.stam.val = 100; d.dead = false; d.hp = d.maxHp; d.x = p.x + 70; d.y = p.y; WHW.actors.castAbility(0); return true; })()`);
        await sleep(700);
        check('wilds: Blizzard hurts a monster standing in it over time', (await evalJs(`WHWorldDebug.actorHp(${JSON.stringify(dummy)})`)) < (await evalJs(`WHW.game.actors.find(a => a.id === ${JSON.stringify(dummy)}).maxHp`)));
        await evalJs('(() => { const W = WHWorld, g = WHW.game; g.fields = []; W.setClass(g.state, "warrior"); g.pstats = W.playerStats(g.state); return true; })()');
        // the Rogue: the Grappling Hook pulls you to a monster and stuns it, and holds two charges
        const hook = await evalJs(`(() => { const W = WHWorld, g = WHW.game, p = g.player, s = g.state, T = WHW.engine.time, d = g.actors.find(a => a.id === ${JSON.stringify(dummy)});
            s.classes.unlocked.rogue = true; W.setClass(s, 'rogue'); g.pstats = W.playerStats(s);
            s.skills.learned.grapple = true; s.skills.learned.riposte = true; W.equipAbility(s, 'grapple', 0); W.equipAbility(s, 'riposte', 1); WHW.ui.renderHotbar();
            p.abCharges = {}; p.stam.val = 100; p.pull = null; p.iframes = 0; p.riposteUntil = 0;
            d.dead = false; d.hp = d.maxHp; d.x = p.x + 150; d.y = p.y; d.status.stunUntil = 0;
            const ok = WHW.actors.castAbility(0);
            return { ok, pulling: !!p.pull, hurt: d.hp < d.maxHp, stunned: d.status.stunUntil > T, left: WHW.actors.abilityCharges(p, 'grapple'), gap0: Math.round(d.x - p.x) };
        })()`);
        await sleep(400);
        const hooked = await evalJs(`(() => { const p = WHW.game.player, d = WHW.game.actors.find(a => a.id === ${JSON.stringify(dummy)}); return { done: !p.pull, gap: Math.round(Math.hypot(d.x - p.x, d.y - p.y) - d.r - p.r), badge: (document.querySelector('.w-abil[data-abil="0"] .ch') || {}).textContent }; })()`);
        check('wilds: the Grappling Hook catches a monster, hurts and stuns it', hook.ok && hook.hurt && hook.stunned, hook);
        check('wilds: ...and pulls you up to it', hook.pulling && hooked.done && hooked.gap < 20, [hook, hooked]);
        check('wilds: one of its two charges is left, and the hotbar shows it', hook.left === 1 && hooked.badge === '1', [hook, hooked]);
        // Riposte: a hit inside the guard does nothing, and the monster that threw it is cut and stunned; a hit after it lands
        const rip = await evalJs(`(() => { const g = WHW.game, p = g.player, T = WHW.engine.time, d = g.actors.find(a => a.id === ${JSON.stringify(dummy)});
            p.iframes = 0; p.hp = p.maxHp; p.stam.val = 100; d.hp = d.maxHp; d.status.stunUntil = 0;
            const cast = WHW.actors.castAbility(1), guard = p.riposteUntil > T;
            const taken = WHW.actors.hurtPlayer(25, { from: d });
            const out = { cast, guard, taken, unhurt: p.hp === p.maxHp, cut: d.hp < d.maxHp, stunned: d.status.stunUntil > T, spent: !(p.riposteUntil > T) };
            p.iframes = 0;
            out.late = WHW.actors.hurtPlayer(10, { from: d });
            return out;
        })()`);
        check('wilds: a Riposte catches the hit, then cuts and stuns the monster', rip.cast && rip.guard && rip.taken === 0 && rip.unhurt && rip.cut && rip.stunned, rip);
        check('wilds: the guard is used up: the next hit lands', rip.spent && rip.late > 0, rip);
        await evalJs('(() => { const W = WHWorld, g = WHW.game; g.player.hp = g.player.maxHp; W.setClass(g.state, "warrior"); g.pstats = W.playerStats(g.state); WHW.ui.renderHotbar(); return true; })()');
        // quests: a quest giver in town offers one, it shows in the tracker
        await evalJs('WHWorldDebug.travel("town")');
        await sleep(400);
        check('town: the Hall of Gods and four quest givers are there', await evalJs('!!WHW.game.map.hall && WHW.game.map.npcs.length === 4'));
        await evalJs('WHW.ui.openNpc("brannoc")');
        await sleep(150);
        check('quests: Captain Brannoc offers his first quest', await evalJs('/Slime Season/.test(document.getElementById("wModalBody").textContent) && !!document.querySelector("[data-qaccept]")'));
        await evalJs('document.querySelector("[data-qaccept]").click()');
        await sleep(150);
        check('quests: accepting it puts it in the tracker', await evalJs('WHWorld.activeQuests(WHWorldDebug.state()).length === 1 && !document.getElementById("questTracker").hidden && /Slime Season/.test(document.getElementById("questTracker").textContent)'));
        await evalJs('WHW.ui.closeModal()');
        if (SCRATCH) {
            await evalJs('(() => { const h = WHW.game.map.hall; WHWorldDebug.teleport(h.door.x, h.door.y + 90); return true; })()');
            await sleep(500);
            fs.writeFileSync(path.join(SCRATCH, 'shot-hall-outside.png'), Buffer.from((await send('Page.captureScreenshot', { format: 'png' })).result.data, 'base64'));
        }
        // the Hall of Gods: walk in, raise a statue
        await evalJs('WHWorldDebug.travel("hall")');
        await sleep(600);
        check('hall: you can go inside, and nobody else is there', await evalJs('WHW.game.zoneId === "hall" && WHW.game.map.statues.length === 6 && WHW.game.actors.length === 0'));
        if (SCRATCH) {
            for (const [name, row] of [['shot-hall-statues.png', 33], ['shot-hall-far-end.png', 15]]) {
                await evalJs(`WHWorldDebug.teleport(13 * 32, ${row} * 32 + 16)`);
                await sleep(700);
                fs.writeFileSync(path.join(SCRATCH, name), Buffer.from((await send('Page.captureScreenshot', { format: 'png' })).result.data, 'base64'));
            }
        }
        await evalJs('(() => { WHWorldDebug.rubies(1000); WHWorldDebug.give("oak_plank", 4); WHWorldDebug.give("copper_bar", 2); WHW.ui.openStatue("solarus"); return true; })()');
        await sleep(150);
        check('hall: a statue shows its offering', await evalJs('/Offering for level 1/.test(document.getElementById("wModalBody").textContent) && !!document.querySelector("[data-raise]:not([disabled])")'));
        await evalJs('document.querySelector("[data-raise]").click()');
        await sleep(150);
        check('hall: making the offering raises the statue', (await evalJs('WHWorldDebug.state().gods.solarus')) === 1);
        await evalJs('WHW.ui.closeModal()');
        // the secret: the pilgrim hints, Enter lets you speak, and the word opens the far wall
        check('hall: the hooded pilgrim talks in riddles', await evalJs('(WHW.ui.openNpc("pilgrim"), /far wall/i.test(document.getElementById("wModalBody").textContent))'));
        await evalJs('WHW.ui.closeModal()');
        await sleep(150);
        // a real Enter key (no typed character), then type the word and press Enter in the box, as a player would
        const enter = async (typed) => { await send('Input.dispatchKeyEvent', Object.assign({ type: typed ? 'keyDown' : 'rawKeyDown', key: 'Enter', code: 'Enter', windowsVirtualKeyCode: 13 }, typed ? { text: String.fromCharCode(13) } : {})); await send('Input.dispatchKeyEvent', { type: 'keyUp', key: 'Enter', code: 'Enter', windowsVirtualKeyCode: 13 }); };
        await enter(false); await sleep(250);
        check('hall: Enter lets you speak out loud here (offline)', await evalJs('!document.getElementById("chatBar").hidden && document.getElementById("chatBar").dataset.local === "1"'));
        await send('Input.insertText', { text: Buffer.from('QnJpbGV5aXNt', 'base64').toString() });
        await enter(true);
        await sleep(400);
        check('hall: saying the word opens the far wall', await evalJs('WHWorldDebug.state().secrets.hallDoor === true && WHW.game.map.secret.open && WHW.game.map.altars.length === 1 && WHW.game.map.statues.length === 7'));
        if (SCRATCH) {
            await evalJs('WHWorldDebug.teleport(13 * 32, 6 * 32 + 16)');
            await sleep(800);
            fs.writeFileSync(path.join(SCRATCH, 'shot-hidden-room.png'), Buffer.from((await send('Page.captureScreenshot', { format: 'png' })).result.data, 'base64'));
        }
        await evalJs('WHW.ui.openAltar("autoClicker")');
        await sleep(150);
        check('hidden room: the altar offers the Auto Clicker at its price', await evalJs('(() => { const t = document.getElementById("wModalBody").textContent; return /5,000/.test(t) && /500/.test(t) && /Shard of the Hidden/.test(t) && !!document.querySelector("[data-hbuy][disabled]"); })()'));
        await evalJs('WHW.ui.closeModal()');
        await evalJs('WHWorldDebug.travel("town")');
        await sleep(300);
        check('hall: leaving puts you back at its door in town', await evalJs('WHW.game.zoneId === "town" && Math.hypot(WHW.game.player.x - WHW.game.map.hall.door.x, WHW.game.player.y - WHW.game.map.hall.door.y) < 80'));
        // performance settings: they apply straight away and are remembered on this device
        await evalJs('WHW.ui.openSettings()');
        await sleep(150);
        check('settings: the Performance section is there', await evalJs('!!document.getElementById("setGfx") && !!document.getElementById("setRes") && !!document.getElementById("setFps") && !!document.getElementById("setShowFps")'));
        const fullW = await evalJs('WHW.engine.canvas.width');
        await evalJs(`(() => { const set = (id, v) => { const el = document.getElementById(id); el.value = v; el.dispatchEvent(new Event('change')); };
            set('setGfx', 'low'); set('setRes', '0.5'); set('setFps', '30');
            const c = document.getElementById('setShowFps'); c.checked = true; c.dispatchEvent(new Event('change')); return true; })()`);
        const gfx = await evalJs('({ perf: WHW.engine.perf, low: document.body.classList.contains("w-low"), w: WHW.engine.canvas.width, cssW: WHW.engine.w, cap: WHW.engine.fpsCap, saved: JSON.parse(localStorage.getItem("whathappened_world_settings")) })');
        check('settings: Low graphics, 50% resolution and 30 fps apply at once', gfx.perf === 'low' && gfx.low && Math.abs(gfx.w - gfx.cssW * 0.5) <= 1 && gfx.w < fullW && gfx.cap === 30, [fullW, gfx]);
        check('settings: they are saved on this device', gfx.saved.graphics === 'low' && gfx.saved.resolution === '0.5' && gfx.saved.fpsCap === 30 && gfx.saved.showFps === true, gfx.saved);
        await evalJs('WHW.ui.closeModal()');
        const f0 = await evalJs('WHW.engine.frames');
        await sleep(1500);
        const f1 = await evalJs('WHW.engine.frames');
        check('settings: the 30 fps limit holds', (f1 - f0) / 1.5 <= 36 && (f1 - f0) / 1.5 >= 10, (f1 - f0) / 1.5);
        check('settings: the frame counter reads', (await evalJs('WHW.engine.fps')) > 0);
        await evalJs(`(() => { Object.assign(WHW.settings, { graphics: 'auto', resolution: 'auto', fpsCap: 60, showFps: false }); WHW.saveSettings(); WHW.applyGraphics(); return true; })()`);
        check('settings: back to Auto', await evalJs('WHW.engine.perf === "high" && !document.body.classList.contains("w-low") && WHW.engine.canvas.width >= ' + fullW));
        // the bag: what you wear and hold up top, the backpack below with filters and sorting
        await evalJs(`(() => { const W = WHWorld, s = WHW.game.state, t = Date.now();
            W.addGear(s, 'helmet_1', 80, [], t); W.addGear(s, 'sword_1', 95, [], t); W.addGear(s, 'chest_1', 40, [], t);
            W.give(s, 'copper_ore', 12, true); W.give(s, 'boar_hide', 3, true); W.give(s, 'heartwood_seed', 1, true);
            WHW.ui.openBag('gear'); return true; })()`);
        await sleep(200);
        const bag = await evalJs(`(() => { const s = WHW.game.state, W = WHWorld;
            const pack = s.gear.filter(it => !W.isEquipped(s, it.uid));
            return { rows: document.querySelectorAll('.w-equip .w-slotrow').length, cards: document.querySelectorAll('.w-item').length, pack: pack.length,
                cmp: !!document.querySelector('.w-item .w-cmp'), totals: !!document.querySelector('.w-totals') }; })()`);
        check('bag: armor slots and the hotbar have their own panels', bag.rows === 5 + 5 && bag.totals, bag);
        check('bag: the backpack holds everything not on you, each compared with what you have on', bag.cards === bag.pack && bag.pack >= 3 && bag.cmp, bag);
        if (SCRATCH) { const sh = await send('Page.captureScreenshot', { format: 'png' }); fs.writeFileSync(path.join(SCRATCH, 'shot-bag-gear.png'), Buffer.from(sh.result.data, 'base64')); }
        await evalJs('document.querySelector("[data-filter=armor]").click()');
        await sleep(100);
        const armorOnly = await evalJs(`[...document.querySelectorAll('.w-item .w-card-name')].map(e => e.textContent)`);
        check('bag: the Armor filter shows only armor', armorOnly.length >= 2 && armorOnly.every(n => /Helmet|Chestplate|Boots|Tunic|Cap|Hood|Armor/i.test(n)), armorOnly);
        await evalJs('(() => { const el = document.getElementById("gearSort"); el.value = "newest"; el.dispatchEvent(new Event("change")); return true; })()');
        await sleep(100);
        check('bag: sorting by newest puts the last piece first', /Copper Chestplate/.test(await evalJs('document.querySelector(".w-item .w-card-name").textContent')));
        await evalJs('document.querySelector(".w-item [data-equip]").click()');
        await sleep(150);
        check('bag: wearing it moves it to the armor panel', /Copper Chestplate/.test(await evalJs('document.querySelector(".w-equip").textContent')) && await evalJs('!!WHWorld.findGear(WHW.game.state, WHW.game.state.equip.chest)'));
        // materials: hover one to see where it comes from
        await evalJs('document.querySelector("[data-tab=materials]").click()');
        await sleep(150);
        await evalJs('document.querySelector(".w-mat[data-mat=copper_ore]").dispatchEvent(new MouseEvent("mouseover", { bubbles: true }))');
        await sleep(100);
        const tip = await evalJs('(() => { const t = document.getElementById("wTip"); return t && !t.hidden ? t.textContent : ""; })()');
        check('bag: hovering a material says where to get it', /Where to get it/.test(tip) && /Mine Copper Ore/.test(tip) && /Greenwood/.test(tip), tip);
        if (SCRATCH) { const sh = await send('Page.captureScreenshot', { format: 'png' }); fs.writeFileSync(path.join(SCRATCH, 'shot-bag-mats.png'), Buffer.from(sh.result.data, 'base64')); }
        await evalJs('document.querySelector(".w-mat[data-mat=heartwood_seed]").dispatchEvent(new MouseEvent("mouseover", { bubbles: true }))');
        await sleep(100);
        check('bag: a boss trophy names its boss and the chance', /The Overgrown/.test(await evalJs('document.getElementById("wTip").textContent')) && /35% chance/.test(await evalJs('document.getElementById("wTip").textContent')));
        await evalJs('(() => { const el = document.getElementById("matSort"); el.value = "amount"; el.dispatchEvent(new Event("change")); return true; })()');
        await sleep(100);
        check('bag: materials sort by amount', (await evalJs('document.getElementById("wTip").hidden')) === true && await evalJs('(() => { const n = [...document.querySelectorAll(".w-mats")[0].querySelectorAll(".w-mat b")].map(b => Number(b.textContent.replace(/[^0-9]/g, ""))); return n.length > 1 && n.every((v, i) => !i || n[i - 1] >= v); })()'));
        // skins unlocked in the game can be worn here
        await evalJs(`(() => { const k = localStorage.getItem('whathappened_save') ? 'whathappened_save' : 'whathappened_save_v1'; const ms = JSON.parse(localStorage.getItem(k) || '{}');
            ms.shopGoldPurchased = true; localStorage.setItem('whathappened_save', JSON.stringify(ms)); document.querySelector('[data-tab=skins]').click(); return true; })()`);
        await sleep(150);
        const skins = await evalJs('({ owned: document.querySelectorAll(".w-skin:not(.is-locked)").length, locked: document.querySelectorAll(".w-skin.is-locked").length, gold: !!document.querySelector(".w-skin[data-skin=\\"mainimage/goldwh.png\\"]:not(:disabled)") })');
        check('skins: the unlocked ones can be picked, the rest are shown locked', skins.gold && skins.owned >= 3 && skins.locked >= 1, skins);
        await evalJs('document.querySelector(".w-skin[data-skin=\\"mainimage/goldwh.png\\"]").click()');
        await sleep(150);
        check('skins: picking one puts it on your character', await evalJs('WHW.game.faceSrc === "mainimage/thumbs/goldwh.webp" && WHW.game.state.skin === "mainimage/goldwh.png" && document.querySelector(".w-skin.is-on").dataset.skin === "mainimage/goldwh.png"'));
        if (SCRATCH) { const sh = await send('Page.captureScreenshot', { format: 'png' }); fs.writeFileSync(path.join(SCRATCH, 'shot-bag-skins.png'), Buffer.from(sh.result.data, 'base64')); }
        await evalJs('document.querySelector(".w-skin[data-skin=game]").click()');
        await sleep(100);
        check('skins: "Same as the game" goes back to the game\'s skin', await evalJs('WHW.game.state.skin === null && WHW.game.faceSrc !== "mainimage/thumbs/goldwh.webp"'));
        // achievements in the Bag's Stats tab, and the banner when one unlocks here
        await evalJs('document.querySelector("[data-tab=stats]").click()');
        await sleep(150);
        const achTab = await evalJs('({ next: document.querySelectorAll(".w-ach-next > div").length, head: (document.querySelector(".w-ach-bar") && document.querySelector(".w-ach-bar").closest(".w-section").querySelector("h3").textContent) || "", link: !!document.querySelector("a[href=\\"achievements.html#cat-the-wilds\\"]") })');
        check('achievements: the Stats tab shows Wilds progress and the three closest', achTab.next === 3 && /\d+ \/ \d+ in the Wilds/.test(achTab.head) && achTab.link, achTab);
        await evalJs('(() => { WHW.ui.closeModal(); WHW.ui.showAchievements([WHA.BY_KEY.w_kill1, WHA.BY_KEY.w_door]); return true; })()');
        // (achievements unlocked earlier in this run may be queued first: wait for these to come round)
        check('achievements: unlocking one here shows a banner', await waitFor('[...document.querySelectorAll(".w-ach")].some(e => /Achievement unlocked/.test(e.textContent) && /First Blood/.test(e.textContent))', 40000));
        check('achievements: a hidden one says so when it pops', await waitFor('[...document.querySelectorAll(".w-ach.is-hidden")].some(e => /Hidden achievement unlocked/.test(e.textContent) && /Open Sesame/.test(e.textContent))', 40000));
        // and in a recipe
        await evalJs('(() => { WHW.ui.closeModal(); WHW.ui.openStation("forge"); return true; })()');
        await sleep(150);
        await evalJs('document.querySelector(".w-need [data-mat]").dispatchEvent(new MouseEvent("mouseover", { bubbles: true }))');
        await sleep(100);
        check('recipes: hovering a material in a recipe says where to get it', /Where to get it/.test(await evalJs('(() => { const t = document.getElementById("wTip"); return t && !t.hidden ? t.textContent : ""; })()')));
        await evalJs('WHW.ui.closeModal()');
        check('the tooltip goes away with the window', await evalJs('document.getElementById("wTip").hidden'));
        await evalJs('WHWorldDebug.grant({ gems: 2, boxes: [0, 1, 0, 0, 0] })');
        const rubiesBefore = await evalJs('WHWorldDebug.state().rubies');
        await navigate(`http://localhost:${PORT}/index.html`, 'window._saveLoaded === true');
        await sleep(600);
        check('wilds: gems sent home arrive in the game', (await evalJs('getGems()')) >= 2);
        check('wilds: lootboxes sent home arrive in Items', (await evalJs('JSON.parse(localStorage.getItem("whathappened_items")).boxes[1]')) >= 1);
        check('wilds: the game acknowledged them', Number(await evalJs('localStorage.getItem("whathappened_world_ack")')) >= 1);
        check('wilds: menu button present', await evalJs('!!document.getElementById("worldTopBtn")'));
        // Golden -> rubies: traded in the Divine menu, collected by the Wilds when it opens
        await evalJs('(() => { goldenWhat = 3; divineUnlocked = true; window.confirm = () => true; showDivineMenu(); return true; })()');
        check('golden trade: the Divine menu has the trade row', await evalJs('!!document.querySelector("#divineLeftBar #goldenTradeBtn") && document.getElementById("goldenTradeBtn").textContent.trim() === "Trade"'));
        check('golden trade: trading 1 Golden works', (await evalJs('tradeGoldenForRubies(1)')) === true && (await evalJs('goldenWhat')) === 2);
        const rate = await evalJs('WHWorldBridge.GOLDEN_RUBIES');
        check('golden trade: the menu says the rubies are waiting', new RegExp(rate.toLocaleString('en-US') + ' rubies are waiting').test(await evalJs('document.getElementById("goldenTradeNote").textContent')));
        check('hall of gods: the statue raised in the Wilds blesses the game', (await evalJs('getGodBonuses().cps')) === 5 && /Solarus \(level 1\)/.test(await evalJs('document.getElementById("godBlessings").textContent')));
        // achievements: the hidden "Hands Off" is ??? on the achievements page until the Auto Clicker is unlocked
        await navigate(`http://localhost:${PORT}/achievements.html`, 'typeof WHA === "object" && document.querySelectorAll(".ach").length > 20');
        const veiled = await evalJs(`(() => { const cards = [...document.querySelectorAll('.ach')]; const q = cards.filter(c => c.classList.contains('is-hidden'));
            return { hiddenCards: q.length, text: q.map(c => c.querySelector('.name').textContent + '|' + c.querySelector('.desc').textContent + '|' + c.querySelector('.t').textContent), leaks: /Hands Off|Unlock the Auto Clicker|Hands-Free/.test(document.getElementById('achList').textContent), sesame: /Open Sesame/.test(document.getElementById('achList').textContent),
                wilds: !!document.getElementById('cat-the-wilds') }; })()`);
        // (the hidden room was opened earlier in this run, so Open Sesame is already unlocked and shown; Hands Off is the one still veiled)
        check('achievements: a hidden one shows ??? for name, description and title, until it is unlocked', veiled.hiddenCards === 1 && veiled.text.every((t) => t === '???|???|???') && !veiled.leaks && veiled.sesame && veiled.wilds, veiled);
        await evalJs('(() => { const el = document.getElementById("achSearch"); el.value = "hands"; el.dispatchEvent(new Event("input")); return true; })()');
        check('achievements: searching does not give a hidden one away', (await evalJs('document.querySelectorAll(".ach.is-hidden").length')) === 0);
        await evalJs('(() => { const el = document.getElementById("achSearch"); el.value = ""; el.dispatchEvent(new Event("input")); return true; })()');
        check('achievements: the Wilds have their own section', (await evalJs('document.querySelectorAll("#cat-the-wilds .ach").length')) >= 30);
        check('achievements: hidden cards hint at a secret, without telling', /A secret. It shows itself once you find it./.test(await evalJs('(document.querySelector(".ach.is-hidden") || {}).textContent || ""')));
        await navigate(`http://localhost:${PORT}/achievements.html#cat-the-wilds`, 'typeof WHA === "object" && document.querySelectorAll(".ach").length > 20');
        check('achievements: the link from the Wilds lands on its section', (await evalJs('Math.abs(document.getElementById("cat-the-wilds").getBoundingClientRect().top) < 400')) === true);
        await navigate(`http://localhost:${PORT}/index.html`, 'window._saveLoaded === true');
        await sleep(600);
        // the Auto Clicker charm: equipped and put on the image, it clicks about 10 times a second by itself
        await evalJs('(() => { showNormalMenu(); WHI.grantSpecial("autoClicker"); WHI.toggleEquip("autoClicker"); window.__autoN = 0; window.__autoT0 = performance.now(); const inc = increment; increment = function (o) { if (o && o.auto) window.__autoN++; return inc.apply(this, arguments); }; setAutoTarget("image"); return true; })()');
        await sleep(1500);
        // timed by the page's own clock: a busy machine can stretch the wait between the test's messages
        const auto = await evalJs('({ n: window.__autoN, s: (performance.now() - window.__autoT0) / 1000 })');
        check('auto clicker: on the image, it clicks about 10 times a second', auto.n >= 10 && auto.n / auto.s >= 7 && auto.n / auto.s <= 12, auto);
        check('auto clicker: its bar and the clicker on the image show', await evalJs('!document.getElementById("autoClicker").hidden && !document.getElementById("autoClickerBadge").hidden'));
        if (SCRATCH) fs.writeFileSync(path.join(SCRATCH, 'shot-auto-clicker.png'), Buffer.from((await send('Page.captureScreenshot', { format: 'png' })).result.data, 'base64'));
        // ...and unlocking it unlocks Hands Off, which then shows its real name
        await evalJs('checkDataAchievements(true)');
        check('achievements: unlocking the Auto Clicker unlocks Hands Off', (await evalJs('localStorage.getItem("ach_w_hands_off")')) === '1');
        await evalJs('setAutoTarget(null)');
        await navigate(`http://localhost:${PORT}/achievements.html`, 'typeof WHA === "object" && document.querySelectorAll(".ach").length > 20');
        const revealed = await evalJs(`(() => { const c = [...document.querySelectorAll('.ach.done')].find(x => /Hands Off/.test(x.textContent)); return c ? { name: c.querySelector('.name').textContent.replace('NEW', '').trim(), desc: c.querySelector('.desc').textContent, title: c.querySelector('.t').textContent, hiddenLeft: document.querySelectorAll('.ach.is-hidden').length, equip: !!c.querySelector('[data-equip]') } : null; })()`);
        check('achievements: once unlocked it shows its name, description and title', revealed && revealed.name === 'Hands Off' && /Auto Clicker/.test(revealed.desc) && revealed.title === 'Hands-Free' && revealed.hiddenLeft === 0 && revealed.equip, revealed);
        if (SCRATCH) fs.writeFileSync(path.join(SCRATCH, 'shot-achievements.png'), Buffer.from((await send('Page.captureScreenshot', { format: 'png' })).result.data, 'base64'));
        await navigate(`http://localhost:${PORT}/world.html?whdebug`, 'typeof window.WHWorldDebug === "object" && WHWorldDebug.frames() > 30');
        await sleep(500);
        check('golden trade: the Wilds collects the rubies when it opens', (await evalJs('WHWorldDebug.state().rubies')) === rubiesBefore + rate && (await evalJs('WHWorldDebug.state().inAck')) >= 1,
            [rubiesBefore, await evalJs('WHWorldDebug.state().rubies')]);
        check('golden trade: the game then sees nothing waiting', (await evalJs('WHWorldBridge.rubiesWaiting(localStorage)')) === 0);

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
