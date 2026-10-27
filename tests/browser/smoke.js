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
