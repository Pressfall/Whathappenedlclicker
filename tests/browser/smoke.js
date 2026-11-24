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
        // a call the browser never answers gives up after a minute (so a stuck run fails its checks instead of hanging)
        const send = (method, params = {}) => new Promise((res) => {
            const i = ++id;
            const timer = setTimeout(() => { if (pending.delete(i)) { console.log('(no answer from the browser to ' + method + ' after 60 s)'); res({ error: { message: 'timeout' } }); } }, 60000);
            pending.set(i, (msg) => { clearTimeout(timer); res(msg); });
            ws.send(JSON.stringify({ id: i, method, params }));
        });
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
        check('guide shows the way to the first OP mouse and what it unlocks', await evalJs(`!document.getElementById('guideBarWrap').hidden &&
            /^\\d+ \\/ 100 What Happeneds for your first OP mouse\\.$/.test(document.getElementById('guideBarText').textContent) &&
            /level 10 it unlocks the Mousepad of Destiny special/.test(document.getElementById('guideBarWhat').textContent) &&
            document.getElementById('guideBar').getBoundingClientRect().width > 100`));
        check('no save reminder for a brand-new player', await evalJs('document.getElementById("saveReminder").hidden'));
        check('consent notice shown with Decline and Accept side by side', (await evalJs('document.querySelectorAll("#whConsent .wh-consent-actions button").length')) === 2);
        check('consent notice: Choose opens two unticked boxes', (await evalJs('(() => { document.querySelector("#whConsent .wh-consent-more").click(); const b = [...document.querySelectorAll("#whConsentPick input")]; const ok = !document.getElementById("whConsentPick").hidden && b.length === 2 && b.every(x => !x.checked); document.querySelector("#whConsent .wh-consent-more").click(); return ok; })()')) === true);
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

        // ---- 4. Accept ----
        await evalJs('document.querySelector("#whConsent [data-consent=granted]").click()');
        await sleep(2500);
        check('AdSense script added after Accept', (await evalJs('[...document.scripts].filter(s=>/googlesyndication/.test(s.src)).length')) === 1);
        check('ad slot visible after Accept', !(await evalJs('document.getElementById("adWrapper").hidden')));
        // the ad code itself: the AdSense script for this publisher, the slot queued once with the same publisher, and room to render
        // (AdSense refuses a slot with no width). The request is blocked here, so the slot stays queued in window.adsbygoogle.
        const ad = await evalJs(`(() => { const ins = document.querySelector('#adWrapper ins.adsbygoogle'); const s = [...document.scripts].find(x => /googlesyndication/.test(x.src));
            return { src: s && s.src, client: ins.getAttribute('data-ad-client'), slot: ins.getAttribute('data-ad-slot'), filled: ins.dataset.whFilled, queued: Array.isArray(window.adsbygoogle) ? window.adsbygoogle.length : -1,
                width: ins.getBoundingClientRect().width, async: s && s.async, cors: s && s.crossOrigin }; })()`);
        check('ad code: AdSense script for the right publisher, slot queued once with the same publisher and a width',
            ad && /adsbygoogle\.js\?client=ca-pub-7259344384263515$/.test(ad.src) && ad.client === 'ca-pub-7259344384263515' && ad.slot === '1234567890' &&
            ad.filled === '1' && ad.queued === 1 && ad.width > 300 && ad.async === true && ad.cors === 'anonymous', ad);
        check('AdSense request was made (and blocked by this test)', seen.some((u) => /pagead2\.googlesyndication\.com\/pagead\/js\/adsbygoogle\.js\?client=ca-pub-7259344384263515/.test(u)));
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
            if (p === 'leaderboard.html') {
                // the tabs explain themselves (Firestore is blocked here, so the board itself shows an error)
                const lb = await evalJs(`(() => { const e = () => document.getElementById('lbExplain').textContent; const m = e();
                    document.getElementById('alltimeTab').click(); const a = e(); const pressed = document.getElementById('alltimeTab').getAttribute('aria-pressed');
                    document.getElementById('monthlyTab').click(); return { m, a, pressed, back: document.getElementById('monthlyTab').getAttribute('aria-pressed') }; })()`);
                check('leaderboard: each tab says what it shows (UTC month, names are not accounts)', lb && /^This month \(\w+ \d{4}\): .*00:00 UTC.*your time\)\. .*not an account/.test(lb.m) &&
                    /^All time: the best score each name has ever submitted/.test(lb.a) && lb.pressed === 'true' && lb.back === 'true', lb);
                if (SCRATCH) { const s = await send('Page.captureScreenshot', { format: 'png' }); fs.writeFileSync(path.join(SCRATCH, 'shot-leaderboard.png'), Buffer.from(s.result.data, 'base64')); }
            }
        }
        // ---- 7a. the one-time save reminder: shown once there is progress, in the page (not over the game), and only once ----
        await evalJs(`(() => { suppressAutosave = true; const s = JSON.parse(localStorage.getItem('whathappened_save') || '{}'); s.upgrade1Level = 30;
            localStorage.setItem('whathappened_save', JSON.stringify(s)); localStorage.removeItem('whathappened_save_reminder'); return true; })()`);
        await navigate(`http://localhost:${PORT}/index.html`, 'window._saveLoaded === true');
        await waitFor('!document.getElementById("saveReminder").hidden', 5000);
        const rem = await evalJs(`(() => { const r = document.getElementById('saveReminder'); const b = r.getBoundingClientRect(); const g = document.querySelector('.main-image-wrap').getBoundingClientRect();
            return { shown: !r.hidden, text: document.getElementById('saveReminderText').textContent, inFlow: getComputedStyle(r).position === 'static', above: b.bottom <= g.top + 1, stored: localStorage.getItem('whathappened_save_reminder') }; })()`);
        check('save reminder shows once there is progress, in the page flow above the image', rem && rem.shown && rem.inFlow && rem.above && rem.stored === 'shown' &&
            rem.text === "Save to account or download a save file so you don't lose progress on this browser.", rem);
        if (SCRATCH) { const s = await send('Page.captureScreenshot', { format: 'png' }); fs.writeFileSync(path.join(SCRATCH, 'shot-save-reminder.png'), Buffer.from(s.result.data, 'base64')); }
        await navigate(`http://localhost:${PORT}/index.html`, 'window._saveLoaded === true');
        await sleep(1500);
        check('save reminder does not come back after a reload', await evalJs('document.getElementById("saveReminder").hidden'));

        // ---- 7a. Holy What Happeneds: the chip, the shop, buying a look with earned Holy What Happeneds; buying for money needs an account ----
        await evalJs(`(() => { localStorage.setItem('whathappened_premium', JSON.stringify({ v: 1, started: 1, earned: 500, earnedTotal: 500 })); WHBeans.renderChip(); document.getElementById('beanChip').click(); return true; })()`);
        const bn = await evalJs(`(() => { const o = document.querySelector('.bn-overlay'), h = document.querySelector('.bn-sec h4'); return { chip: document.querySelector('#beanChip [data-bean-short]').textContent, open: !!o && !o.hidden, cards: document.querySelectorAll('.bn-card').length, section: h && h.textContent }; })()`);
        check('beans: the chip shows the balance and opens the Holy What Happeneds shop on its first section', bn && Number(bn.chip) >= 500 && bn.open && bn.cards > 0 && bn.section === 'Currency', bn);
        await evalJs(`(() => { document.querySelector('[data-bncat="clicker"]').click(); document.querySelector('[data-bnbuy="th_sanctum"]').click(); document.querySelector('[data-bnyes="th_sanctum"]').click(); return true; })()`);
        await sleep(600);
        const bought = await evalJs(`({ cls: document.body.classList.contains('bn-theme-sanctum'), primary: getComputedStyle(document.body).getPropertyValue('--primary').trim(), owned: WHBeans.read().owned.th_sanctum === true, earned: WHBeans.read().earned })`);
        check('beans: buying a theme with earned Holy What Happeneds recolours the page and takes the Holy What Happeneds', bought && bought.cls && bought.primary === '#b48cff' && bought.owned && bought.earned < 500, bought);
        await evalJs(`(() => { document.querySelector('[data-bntab="get"]').click(); return true; })()`);
        // (signed out here, and Firebase is blocked: the account check never finishes or finds no one)
        check('beans: Get more asks for an account before anything can be bought', /Sign in to your account first|Checking your account/.test(await evalJs('document.querySelector(".bn-tabbody").textContent')));
        // an aura on the real page: the main image's button draws Heaven's Rays behind the image, turning
        await evalJs(`(() => { WHBeans.mutate((s) => { s.owned.au_rays = true; s.equip.aura = 'au_rays'; }); return true; })()`);
        const aura = await evalJs(`(() => { const b = document.querySelector('.main-image-btn'), st = getComputedStyle(b, '::before'); return { cls: document.body.classList.contains('bn-aura-rays'), anim: st.animationName, z: st.zIndex, overflow: document.documentElement.scrollWidth - document.documentElement.clientWidth }; })()`);
        check('beans: an aura draws around the main image without widening the page', aura && aura.cls && aura.anim === 'bn-rays' && aura.z === '-1' && aura.overflow <= 0, aura);
        if (SCRATCH) { await evalJs('(() => { WHBeansPanel.close(); document.querySelector(".main-image-btn").scrollIntoView({ block: "center" }); return true; })()'); await sleep(400);
            fs.writeFileSync(path.join(SCRATCH, 'shot-aura.png'), Buffer.from((await send('Page.captureScreenshot', { format: 'png' })).result.data, 'base64')); }
        if (SCRATCH) { const s = await send('Page.captureScreenshot', { format: 'png' }); fs.writeFileSync(path.join(SCRATCH, 'shot-beans.png'), Buffer.from(s.result.data, 'base64')); }
        await evalJs(`(() => { WHBeansPanel.close(); localStorage.removeItem('whathappened_premium'); document.body.classList.remove('bn-theme-sanctum', 'bn-aura-rays'); return true; })()`);

        // ---- 7b. help pages: readable with JavaScript off, on a computer and a phone, and they load nothing from Google ads ----
        check('game footer links the help pages', /^how-to-play\.html,wilds-guide\.html,upgrades-followers-gems\.html,faq\.html,about\.html,privacy\.html$/.test(
            await evalJs('[...document.querySelectorAll(".site-footer a")].map(a => a.getAttribute("href")).join()')));
        await send('Emulation.setScriptExecutionDisabled', { value: true });
        for (const [w, h, label] of [[1280, 1400, 'desktop'], [390, 844, 'phone']]) {
            await send('Emulation.setDeviceMetricsOverride', { width: w, height: h, deviceScaleFactor: 1, mobile: label === 'phone' });
            for (const p of ['how-to-play.html', 'wilds-guide.html', 'upgrades-followers-gems.html', 'faq.html', 'about.html']) {
                const before = seen.length;
                await navigate(`http://localhost:${PORT}/${p}`);
                const info = await evalJs(`({ text: document.querySelector('main').innerText.length, h1: getComputedStyle(document.querySelector('h1')).color,
                    overflow: document.documentElement.scrollWidth - document.documentElement.clientWidth, links: document.querySelectorAll('.info-footer a').length,
                    rows: document.querySelectorAll('#upgradeTable tbody tr').length })`);
                check(`${p} (${label}, no JavaScript): readable`, info && info.text > 1500 && info.h1 === 'rgb(255, 200, 61)' && info.links === 7 && info.overflow <= 0, info);
                if (p === 'upgrades-followers-gems.html') check(`${p}: all 31 upgrades listed`, info.rows === 31, info);
                check(`${p} (${label}): nothing from Google ads or analytics requested`, !seen.slice(before).some((u) => /googlesyndication|google-analytics|googletagmanager|consent\.js/.test(u)));
                if (SCRATCH) { const s = await send('Page.captureScreenshot', { format: 'png' }); fs.writeFileSync(path.join(SCRATCH, `shot-${label}-${p}.png`), Buffer.from(s.result.data, 'base64')); }
            }
        }
        await send('Emulation.clearDeviceMetricsOverride');
        await send('Emulation.setScriptExecutionDisabled', { value: false });

        // ---- 8. account page loads its modules with the shared core ----
        await navigate(`http://localhost:${PORT}/account.html`);
        check('account page: no script errors', errors().filter((e) => /progress|WHProgress|cloud|account/i.test(e)).length === 0, errors());
        check('account page rendered', (await evalJs('document.body.innerText.length')) > 200);

        // ---- 9. the Wilds: moving, swinging, and rewards reaching the game ----
        await navigate(`http://localhost:${PORT}/world.html?whdebug`, 'typeof window.WHWorldDebug === "object" && WHWorldDebug.frames() > 30');
        check('wilds: game loop running', (await evalJs('WHWorldDebug.frames()')) > 30);
        // accounts: the Wilds sync to the account like the game does (cloud.js), next to online play's own Firebase app
        await waitFor('typeof window.WHCloud === "object" && window._saveLoaded === true', 20000);
        const acct = await evalJs(`(() => { const b = document.getElementById('cloudBtn');
            return { sync: typeof window.WHCloud === 'object' && typeof window.WHCloud.saveNow === 'function', loaded: window._saveLoaded === true,
                btn: !!b && b.getAttribute('href') === 'account.html' && b.textContent.trim() === '☁️' && /Save to account/.test(b.getAttribute('aria-label') || '') && b.classList.contains('is-off'),
                hooks: typeof window.saveGame === 'function' && typeof window.freezeSavesForReload === 'function' && typeof window.notify === 'function' }; })()`);
        check('wilds: connected to accounts (the ☁️ button, signed out here)', acct.sync && acct.loaded && acct.btn && acct.hooks, acct);
        check('wilds: saving for the account writes the Wilds save now', await evalJs('(() => { const s = WHWorldDebug.state(); s.stats.kills += 7; const want = s.stats.kills; window.saveGame(); return JSON.parse(localStorage.getItem("whathappened_world")).stats.kills === want; })()'));
        await evalJs('WHW.ui.closeModal()');
        // the crew from the game: Jonathan and the Somalian Pirate have come to Wildgate (their upgrades' best levels, which
        // the game writes), the Grape God has not
        await evalJs('localStorage.setItem("whathappened_upgrade_best", JSON.stringify({ 2: 30, 6: 3, 11: 12 })); WHW.refreshClickerView(); WHWorldDebug.travel("town"); true');
        await sleep(400);
        const crew = await evalJs(`(() => ({ here: WHWorldDebug.crewHere(), depot: WHW.game.map.stations.some(s => s.id === 'depot'), renown: document.getElementById('renownCount').textContent, lv: WHWorldDebug.clickerView().renown }))()`);
        check('wilds: the crew from the game stand at the WH Depot once they have arrived', crew.depot && crew.here.includes('pirate') && crew.here.includes('jonathan') && !crew.here.includes('grape'), crew);
        check('wilds: the Renown chip shows the shared rank', crew.renown === String(crew.lv), crew);
        await evalJs('WHW.ui.openStation("depot")');
        check('wilds: the Depot lists who has come and who is on the way', /2 of 8/.test(await evalJs('document.getElementById("wModalBody").textContent')) && /Grape God reaches level 25/.test(await evalJs('document.getElementById("wModalBody").textContent')));
        await evalJs('WHW.ui.openNpc("pirate")');
        check('wilds: the Somalian Pirate gives a quest and runs a stall', await evalJs('!!document.querySelector("#wModalBody [data-qaccept]") && !!document.querySelector("#wModalBody [data-crewsvc=shop]")'));
        await evalJs('document.querySelector("#wModalBody [data-crewsvc=shop]").click()');
        check('wilds: his stall opens', /left today/.test(await evalJs('document.getElementById("wModalBody").textContent')));
        await evalJs('WHW.ui.openRenown()');
        const rn = await evalJs('document.getElementById("wModalBody").textContent');
        check('wilds: the Renown panel counts both games', /From the game/.test(rn) && /From the Wilds/.test(rn) && /Milestones/.test(rn), rn.slice(0, 200));
        if (SCRATCH) fs.writeFileSync(path.join(SCRATCH, 'shot-wilds-renown.png'), Buffer.from((await send('Page.captureScreenshot', { format: 'png' })).result.data, 'base64'));
        // hero guilds: the Guildmaster by the Rune Altar shows his six charters
        await evalJs('WHW.ui.openNpc("guildmaster")');
        const gm = await evalJs('({ text: document.getElementById("wModalBody").textContent, cards: document.querySelectorAll("#wModalBody .w-guild-card").length, here: WHW.game.map.npcs.some(n => n.id === "guildmaster") })');
        check('wilds: the Guildmaster stands in town with six guild charters', gm.here && gm.cards === 6 && /On the table now/.test(gm.text), { cards: gm.cards, here: gm.here });
        if (SCRATCH) fs.writeFileSync(path.join(SCRATCH, 'shot-wilds-guilds.png'), Buffer.from((await send('Page.captureScreenshot', { format: 'png' })).result.data, 'base64'));
        await evalJs('WHW.ui.closeModal()');
        // Holy What Happeneds in the Wilds: the HUD chip opens the Holy What Happeneds shop in the Wilds' own window (which pauses the game); a bought trail is worn
        await evalJs(`(() => { localStorage.setItem('whathappened_premium', JSON.stringify({ v: 1, started: 1, earned: 7, owned: { tr_light: true, mk_wings: true }, equip: { trail: 'tr_light', mark: 'mk_wings' } })); WHBeans.renderChip(); document.getElementById('beanChip').click(); return true; })()`);
        const wb = await evalJs(`({ open: WHW.ui.isOpen(), title: document.getElementById('wModalTitle').textContent, cards: document.querySelectorAll('#wModalBody .bn-card').length, chip: document.querySelector('#beanChip [data-bean-short]').textContent, paused: WHW.engine.paused })`);
        check('wilds: the 👼 chip shows Holy What Happeneds and opens the Holy What Happeneds shop in the Wilds window, pausing the game', wb && wb.open && /Holy What Happeneds/.test(wb.title) && wb.cards > 0 && Number(wb.chip) >= 7 && wb.paused, wb);
        await evalJs('WHW.ui.closeModal()');
        // the game has hardly run unpaused yet: its first frames draw everything for the first time and come slowly on a slow
        // machine (a step covers at most 1/12 s, so a few frames in 500 ms walked under 20 px). Let it warm up first.
        const framesAtClose = await evalJs('WHWorldDebug.frames()');
        await waitFor(`WHWorldDebug.frames() > ${framesAtClose} + 20`, 15000);
        const errsBeforeWalk = errors().length;
        const key = (type) => send('Input.dispatchKeyEvent', { type, key: 'd', code: 'KeyD', text: type === 'keyDown' ? 'd' : undefined, windowsVirtualKeyCode: 68 });
        const x0 = await evalJs('WHWorldDebug.player().x');
        await key('keyDown'); await sleep(500); await key('keyUp');
        check('wilds: holding D walks right', (await evalJs('WHWorldDebug.player().x')) > x0 + 20);
        check('wilds: walking with a Holy What Happeneds trail on draws without errors', errors().length === errsBeforeWalk, errors().slice(errsBeforeWalk));
        if (SCRATCH) fs.writeFileSync(path.join(SCRATCH, 'shot-wilds-wings.png'), Buffer.from((await send('Page.captureScreenshot', { format: 'png' })).result.data, 'base64'));
        await evalJs('localStorage.removeItem("whathappened_premium"); true');
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
                    p.x = x0; p.y = y0; p.abCharges = {}; p.buffs = {}; p.stam.val = 100; p.mana.val = 100; p.hp = 40; p.pull = null; p.riposteUntil = 0; p.iframes = 0; p.ignite = null; p.beam = null;
                    d.dead = false; d.hp = d.maxHp; d.x = p.x + 40; d.y = p.y; d.status.stunUntil = 0;
                    const shots = g.projectiles.length, fields = g.fields.length;
                    // Fan the Hammer empties the revolver in hand: hold one for it
                    const held = p.weaponUid;
                    if (D.ABILITIES[id].kind === 'fan') p.weaponUid = W.addGear(s, 'gun_1', 100, [], 0).uid;
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
                    if (a.kind === 'ignite' && !(p.ignite && p.ignite.id === id)) bad.push(id + ' ignite');
                    if (a.kind === 'beam' && !(p.beam && p.beam.id === id)) bad.push(id + ' beam');
                    // every charge casts, then it waits
                    for (let k = 1; k < (a.charges || 1); k++) { p.pull = null; p.stam.val = 100; p.mana.val = 100; if (!WHW.actors.castAbility(0)) bad.push(id + ' charge ' + (k + 1)); }
                    p.pull = null; p.stam.val = 100; p.mana.val = 100;
                    if (WHW.actors.castAbility(0)) bad.push(id + ' ignored its cooldown');
                    p.weaponUid = held;
                }
            }
            p.x = x0; p.y = y0; p.buffs = {}; p.pull = null; p.riposteUntil = 0; p.ignite = null; p.beam = null; g.fields = []; g.projectiles = [];
            W.setClass(s, 'warrior'); g.pstats = W.playerStats(s);
            const instant = ['nova', 'cone', 'charge', 'leap', 'line', 'chain', 'step', 'hook'];
            return { ok: out, bad, missed: D.ABILITY_ORDER.filter(id => instant.includes(D.ABILITIES[id].kind) && !hurt[id]) };
        })()`);
        const abilityCount = await evalJs('WHWorldData.ABILITY_ORDER.length');
        check(`wilds: all ${abilityCount} abilities can be cast`, Object.values(cast.ok).length === abilityCount && Object.values(cast.ok).every(Boolean), cast.ok);
        check('wilds: novas, cones, charges, leaps, lines, lightning, hooks and Shadowstep hurt a monster in front of you', cast.missed.length === 0, cast.missed);
        check('wilds: heals, buffs, volleys, shots, areas, smoke, the Riposte guard, charges and cooldowns work', cast.bad.length === 0, cast.bad);
        // an area keeps hurting what stands in it
        await evalJs(`(() => { const D = WHWorldData, W = WHWorld, g = WHW.game, p = g.player, s = g.state, d = g.actors.find(a => a.id === ${JSON.stringify(dummy)});
            s.classes.unlocked.mystic = true; W.setClass(s, 'mystic'); g.pstats = W.playerStats(s); s.skills.learned.blizzard = true; W.equipAbility(s, 'blizzard', 0);
            p.abCharges = {}; p.stam.val = 100; p.mana.val = 100; d.dead = false; d.hp = d.maxHp; d.x = p.x + 70; d.y = p.y; WHW.actors.castAbility(0); return true; })()`);
        await sleep(700);
        check('wilds: Blizzard hurts a monster standing in it over time', (await evalJs(`WHWorldDebug.actorHp(${JSON.stringify(dummy)})`)) < (await evalJs(`WHW.game.actors.find(a => a.id === ${JSON.stringify(dummy)}).maxHp`)));
        await evalJs('(() => { const W = WHWorld, g = WHW.game; g.fields = []; W.setClass(g.state, "warrior"); g.pstats = W.playerStats(g.state); return true; })()');
        // the Mystic's fire staff: hold it drawn back to charge, flick it out at a monster too far to reach and a fireball flies
        const staffSlot = await evalJs(`(() => { const W = WHWorld, g = WHW.game, p = g.player, s = g.state, d = g.actors.find(a => a.id === ${JSON.stringify(dummy)});
            s.classes.unlocked.mystic = true; W.setClass(s, 'mystic'); g.pstats = W.playerStats(s);
            const it = W.addGear(s, 'firestaff_1', 60, [], Date.now()), i = s.hotbar.indexOf(null) >= 0 ? s.hotbar.indexOf(null) : 4;
            s.hotbar[i] = it.uid; WHW.actions.selectSlot(i);
            p.stam.val = 100; p.mana.val = 100; p.hp = p.maxHp; d.dead = false; d.hp = d.maxHp; d.x = p.x + 240; d.y = p.y; d.status.stunUntil = 0; g.projectiles = [];
            return i; })()`);
        await mouseTo(0, 34); await sleep(1300);
        const charged = await evalJs('WHW.game.player.weapon.charge'), shot0 = await evalJs('WHW.game.player.shotSeq || 0');
        await mouseTo(0, 170);
        // a cast bumps the shot number (odd: a bolt); counting casts can't miss a fireball that is already gone
        let bolt = false;
        for (let i = 0; i < 40 && !bolt; i++) { await sleep(25); bolt = await evalJs(`(() => { const n = WHW.game.player.shotSeq || 0; return n > ${shot0} && n % 2 === 1; })()`); }
        await sleep(600);
        check('wilds: a Mystic charges a fire staff by holding it back, and a thrust at nothing shoots a fireball that lands', charged === 1 && bolt
            && (await evalJs(`WHWorldDebug.actorHp(${JSON.stringify(dummy)})`)) < (await evalJs(`WHW.game.actors.find(a => a.id === ${JSON.stringify(dummy)}).maxHp`)), { charged, bolt });
        check('wilds: the Mystic has a mana bar, and the fireball spent mana from it', await evalJs('!document.getElementById("mpBar").hidden && WHW.game.player.mana.val < 100 && WHW.game.player.stam.val > 0'));
        // Burning Stick: the staff burns (eating mana) until it hits the monster, which takes a heavy, stunning blow
        const lit = await evalJs(`(() => { const W = WHWorld, g = WHW.game, p = g.player, s = g.state, d = g.actors.find(a => a.id === ${JSON.stringify(dummy)});
            s.skills.learned.burning_stick = true; W.equipAbility(s, 'burning_stick', 0); p.abCharges = {}; p.stam.val = 100; p.mana.val = 100;
            d.hp = d.maxHp = 5000; d.x = p.x + 60; d.y = p.y; return WHW.actors.castAbility(0) && !!p.ignite; })()`);
        await mouseTo(0, 34); await sleep(1200);
        const burnt = await evalJs('WHW.game.player.mana.val');
        await mouseTo(0, 170); await sleep(150);
        const blow = await evalJs(`(() => { const p = WHW.game.player, d = WHW.game.actors.find(a => a.id === ${JSON.stringify(dummy)});
            return { out: !p.ignite, hurt: d.maxHp - d.hp, stunned: d.status.stunUntil > WHW.engine.time }; })()`);
        check('wilds: Burning Stick eats mana, then a blow with the burning staff puts it out: heavy damage and a stun', lit && burnt < 90 && blow.out && blow.hurt > 50 && blow.stunned, { lit, burnt, blow });
        await evalJs(`(() => { const W = WHWorld, g = WHW.game, s = g.state, d = g.actors.find(a => a.id === ${JSON.stringify(dummy)}); g.player.ignite = null; g.player.abCharges = {};
            s.hotbar[${staffSlot}] = null; WHW.actions.selectSlot(0); d.hp = d.maxHp = 500; d.status.stunUntil = 0; d.kbx = d.kby = 0;
            W.setClass(s, 'warrior'); g.pstats = W.playerStats(s); return true; })()`);
        // a boss comes back on its timer even while you wait in its arena (it used to need you to walk away), and pays again
        const boss2 = await evalJs(`(() => { const g = WHW.game, W = WHWorld, s = g.state; window.__pos0 = { x: g.player.x, y: g.player.y }; let paid = 0; const orig = WHW.onBossKilled; WHW.onBossKilled = function (b, r) { paid++; return orig.apply(this, arguments); };
            const kill = () => { const b = g.actors.find(a => a.kind === 'boss' && !a.dead); if (!b) return false; WHWorldDebug.teleport(g.map.boss.x - 60, g.map.boss.y); WHW.actors.damage(b, 1e7, { from: g.player, kbAngle: 0, kb: 0, s: 1 }); return true; };
            const out = { first: kill() }; g.bossDeadUntil[g.zoneId] = WHW.engine.time + 1; window.__bossPaid = () => paid; return out; })()`);
        await sleep(2500);
        const boss2b = await evalJs(`(() => { const g = WHW.game, b = g.actors.find(a => a.kind === 'boss' && !a.dead); const near = Math.hypot(g.player.x - g.map.boss.x, g.player.y - g.map.boss.y) < g.map.boss.r + 300;
            const net = WHW.online ? { status: WHW.online.status, shared: !!(b && WHW.online.bossShared(b)) } : null;
            return { back: !!b, near, net, again: b ? (WHWorldDebug.teleport(g.map.boss.x - 60, g.map.boss.y), WHW.actors.damage(b, 1e7, { from: g.player, kbAngle: 0, kb: 0, s: 1 }), true) : false, paid: window.__bossPaid() }; })()`);
        // online (the local relay), a returning boss can be a shared one: then the last hit goes round the relay before it
        // pays, so wait for the payout instead of a fixed moment
        const paidAgain = await waitFor('window.__bossPaid() === 2', 15000);
        check('wilds: a boss returns while you wait in its arena, and its drops are paid again', boss2.first && boss2b.back && boss2b.near && boss2b.again && paidAgain, { boss2, boss2b, paid: await evalJs('window.__bossPaid()') });
        await evalJs('(() => { const g = WHW.game; g.bossDeadUntil[g.zoneId] = 0; g.actors = g.actors.filter(a => a.kind !== "boss"); WHWorldDebug.teleport(window.__pos0.x, window.__pos0.y); WHW.engine.snapCamera(); return true; })()'); await sleep(300); // the camera follows the player: the cursor aims through it
        // the Rogue: the Grappling Hook pulls you to a monster and stuns it, and holds two charges
        const hook = await evalJs(`(() => { const W = WHWorld, g = WHW.game, p = g.player, s = g.state, T = WHW.engine.time, d = g.actors.find(a => a.id === ${JSON.stringify(dummy)});
            s.classes.unlocked.rogue = true; W.setClass(s, 'rogue'); g.pstats = W.playerStats(s);
            s.skills.learned.grapple = true; s.skills.learned.riposte = true; W.equipAbility(s, 'grapple', 0); W.equipAbility(s, 'riposte', 1); WHW.ui.renderHotbar();
            p.abCharges = {}; p.stam.val = 100; p.mana.val = 100; p.pull = null; p.iframes = 0; p.riposteUntil = 0;
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
            p.iframes = 0; p.hp = p.maxHp; p.stam.val = 100; p.mana.val = 100; d.hp = d.maxHp; d.status.stunUntil = 0;
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
        check('town: the Hall of Gods, four quest givers and the Auctioneer are there', await evalJs('!!WHW.game.map.hall && WHW.game.map.npcs.filter(n => !WHWorldData.NPCS[n.id].crew && !WHWorldData.NPCS[n.id].guild && !WHWorldData.NPCS[n.id].auction).length === 4 && WHW.game.map.npcs.some(n => n.id === "auctioneer")'));
        await evalJs('WHW.ui.openNpc("brannoc")');
        await sleep(150);
        check('quests: Captain Brannoc offers his first quest', await evalJs('/Slime Season/.test(document.getElementById("wModalBody").textContent) && !!document.querySelector("[data-qaccept]")'));
        await evalJs('document.querySelector("[data-qaccept]").click()');
        await sleep(150);
        check('quests: accepting it puts it in the tracker', await evalJs('WHWorld.activeQuests(WHWorldDebug.state()).length === 1 && !document.getElementById("questTracker").hidden && /Slime Season/.test(document.getElementById("questTracker").textContent)'));
        await evalJs('WHW.ui.closeModal()');
        await evalJs('WHW.ui.closeModal()');
        // Burning Stick and Ice Beam work in town, so they can be tried on the training dummy
        const townFx = await evalJs(`(() => { const W = WHWorld, g = WHW.game, p = g.player, s = g.state, dm = g.map.dummy;
            s.classes.unlocked.mystic = true; W.setClass(s, 'mystic'); g.pstats = W.playerStats(s);
            s.skills.learned.burning_stick = true; s.skills.learned.ice_beam = true; W.equipAbility(s, 'burning_stick', 0); W.equipAbility(s, 'ice_beam', 1);
            const it = W.addGear(s, 'firestaff_1', 60, [], Date.now()), i = s.hotbar.indexOf(null) >= 0 ? s.hotbar.indexOf(null) : 4;
            s.hotbar[i] = it.uid; WHW.actions.selectSlot(i);
            p.x = dm.x - 130; p.y = dm.y; WHW.engine.snapCamera(); p.hp = p.maxHp; p.abCharges = {}; p.stam.val = 100; p.mana.val = 100; p.facing = 0;
            return { slot: i, lit: WHW.actors.castAbility(0) && !!p.ignite }; })()`);
        await mouseTo(0, 170); await sleep(700);
        const townBurn = await evalJs('(() => { const p = WHW.game.player; return { burning: !!p.ignite, mana: p.mana.val, hp: p.hp === p.maxHp }; })()');
        check('town: Burning Stick keeps burning (and eats mana) so it can be tried on the dummy', townFx.lit && townBurn.burning && townBurn.mana < 100 && townBurn.hp, { townFx, townBurn });
        const beam = await evalJs(`(() => { const g = WHW.game, p = g.player, d = g.actors.find(a => a.kind === 'dummy'); p.ignite = null; p.abCharges = {}; p.mana.val = 100; p.stunUntil = 0;
            window.__aim = WHW.engine.aimPoint; WHW.engine.aimPoint = () => ({ x: p.x + 170, y: p.y }); // (town is small: the camera stops at its edge, so the cursor is not where it was)
            const before = d.dmgLog.length; return { cast: WHW.actors.castAbility(1), on: !!p.beam, before }; })()`);
        await sleep(900);
        const beamAfter = await evalJs(`(() => { const g = WHW.game, p = g.player, d = g.actors.find(a => a.kind === 'dummy'); return { on: !!p.beam, hits: d.dmgLog.length }; })()`);
        check('town: Ice Beam holds and hurts the training dummy', beam.cast && beam.on && beamAfter.on && beamAfter.hits > beam.before, { beam, beamAfter });
        await evalJs(`(() => { const W = WHWorld, g = WHW.game, s = g.state, p = g.player; p.beam = null; p.ignite = null; p.abCharges = {}; WHW.engine.aimPoint = window.__aim; s.hotbar[${townFx.slot}] = null; WHW.actions.selectSlot(0); W.setClass(s, 'warrior'); g.pstats = W.playerStats(s); return true; })()`);
        // a camp is safe ground: monsters ignore you, nothing hurts you, and hitting something from it lifts that for a moment
        await evalJs('WHWorldDebug.travel("greenwood"); WHW.game.actors.forEach(a => { a.dead = true; })');
        const camp = await evalJs(`(() => { const g = WHW.game, A = WHW.actors, p = g.player, c = g.map.camp, D = WHWorldData;
            p.x = c.x; p.y = c.y + 20; p.iframes = 0; p.protectedUntil = 0; p.hp = p.maxHp; p.dead = false; p.campLockUntil = 0;
            const m = A.makeMonster('slime', c.x + 120, c.y); m.speed = 0; g.actors.push(m);
            const safe = A.playerSafe(), hurt = A.hurtPlayer(50, {});
            return { safe, hurt, id: m.id, r: D.CAMP.r }; })()`);
        await sleep(1200);
        const asleep = await evalJs(`(() => { const m = WHW.game.actors.find(a => a.id === ${JSON.stringify(camp.id)}); return { aggro: m.aggro, hp: WHW.game.player.hp === WHW.game.player.maxHp }; })()`);
        check('camps: standing in a camp nothing hurts you and monsters ignore you', camp.safe && camp.hurt === 0 && !asleep.aggro && asleep.hp, { camp, asleep });
        const lock = await evalJs(`(() => { const g = WHW.game, A = WHW.actors, p = g.player, m = g.actors.find(a => a.id === ${JSON.stringify(camp.id)});
            A.damage(m, 1, { from: p }); const lifted = !A.playerSafe(); const hurt = (p.iframes = 0, A.hurtPlayer(5, {}));
            p.campLockUntil = 0; p.x = g.map.camp.x; p.y = g.map.camp.y + WHWorldData.CAMP.r + 60; p.iframes = 0; const out = A.playerSafe();
            return { lifted, hurt, out }; })()`);
        check('camps: hitting something from the camp lifts its protection, and outside the ring you are fair game', lock.lifted && lock.hurt > 0 && !lock.out, lock);
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
        // ---- the Far Reaches: the Waystone, a sealed lair and its wards, the void ----
        const shot = async (name) => { if (SCRATCH) fs.writeFileSync(path.join(SCRATCH, name), Buffer.from((await send('Page.captureScreenshot', { format: 'png' })).result.data, 'base64')); };
        if (SCRATCH) { await evalJs('(() => { const w = WHW.game.map.waystone; WHWorldDebug.teleport(w.x + 60, w.y + 40); WHW.engine.snapCamera(); return true; })()'); await sleep(500); await shot('shot-town-waystone.png'); }
        check('waystone: it stands in town, asleep until Frozen WH falls', await evalJs('!!WHW.game.map.waystone && !WHWorldDebug.state().unlocked.zones.coast'));
        await evalJs('(() => { WHWorldDebug.unlockAll(); WHW.ui.openWaystone(); return true; })()');
        await sleep(150);
        check('waystone: it lists the Far Reaches and the Neon Arcade, open once unlocked', await evalJs('(() => { const n = WHWorldData.ZONE_ORDER.filter(z => WHWorldData.ZONES[z].via === "waystone").length; return n === 5 && document.querySelectorAll("[data-go]").length === n && document.querySelectorAll("[data-go]:not([disabled])").length === n && /Saltspray Coast/.test(document.getElementById("wModalBody").textContent) && /Neon Arcade/.test(document.getElementById("wModalBody").textContent); })()'));
        await evalJs('document.querySelector("[data-go=coast]").click()');
        await sleep(500);
        check('waystone: it carries you to Saltspray Coast', await evalJs('WHW.game.zoneId === "coast" && !!WHW.game.map.wards && WHW.game.map.wards.length === 3'));
        if (SCRATCH) { await evalJs('(() => { const w = WHW.game.map.wards[0]; WHWorldDebug.teleport(w.x, w.y + 90); WHW.engine.snapCamera(); return true; })()'); await sleep(600); await shot('shot-coast-ward.png'); }
        check('coast: the lair is sealed and its boss asleep', await evalJs('WHW.game.map.lair && !WHW.game.map.lair.open && !WHW.game.actors.some(a => a.kind === "boss")'));
        // (the guardians, and the boss once the lair opens, fight back: a sturdy player, so nobody is knocked out before the
        // fall check in the sky, which a knocked-out player can't do; it goes back to normal there)
        const ward = await evalJs(`(() => { const g = WHW.game, W = WHWorld;
            g.player.maxHp = g.player.hp = 1e6;
            WHWorldDebug.give('key_coast', 3);
            const w = g.map.wards[0]; WHWorldDebug.teleport(w.x, w.y + 50);
            WHW.actions.wakeWard(0);
            const gd = g.actors.find(a => a.guardian && !a.dead);
            const keys = W.count(g.state, 'key_coast');
            if (gd) WHW.actors.damage(gd, 1e9, { from: g.player, kbAngle: 0, kb: 0, s: 1 });
            return { guardian: !!gd, name: gd && gd.name, keysWhileAwake: keys, broken: W.wardBroken(g.state, 'coast', 0), keysAfter: W.count(g.state, 'key_coast') }; })()`);
        check('wards: waking one brings its guardian, and the key is kept until it falls', ward.guardian && ward.keysWhileAwake === 3, ward);
        check('wards: beating the guardian breaks the ward and spends one key', ward.broken && ward.keysAfter === 2, ward);
        const lair = await evalJs(`(() => { const g = WHW.game, W = WHWorld;
            for (const i of [1, 2]) { WHWorldDebug.teleport(g.map.wards[i].x, g.map.wards[i].y + 50); WHW.actions.wakeWard(i); const gd = g.actors.find(a => a.guardian && !a.dead); if (gd) WHW.actors.damage(gd, 1e9, { from: g.player, kbAngle: 0, kb: 0, s: 1 }); }
            return { open: g.map.lair.open, saved: W.lairOpen(g.state, 'coast'), boss: g.actors.some(a => a.kind === 'boss' && !a.dead) }; })()`);
        check('wards: the last one opens the lair for good, and the boss is there', lair.open && lair.saved && lair.boss, lair);
        await evalJs('WHWorldDebug.travel("sky")');
        await sleep(400);
        // (the coast's boss was awake a moment ago: if he knocked the player out, nothing moves them any more, falls included;
        // a knocked-out player can't travel in the game, only through this debug hook, so stand them up again first; the
        // knocked-out screen pauses the game, and closing it wakes them in town, so then come back)
        if (await evalJs('!!WHW.game.player.dead && WHW.ui.isOpen()')) {
            await evalJs('(() => { window.__wasDown = true; WHW.ui.closeModal(); return true; })()');
            await sleep(400);
            await evalJs('WHWorldDebug.travel("sky")');
            await sleep(400);
        }
        const fall = await evalJs(`(() => { const g = WHW.game, G = WHWorldGen, p = g.player, m = g.map;
            window.__wasDown = window.__wasDown || !!p.dead; p.dead = false; p.maxHp = g.pstats.maxHp; p.hp = p.maxHp;
            g.actors.forEach(a => { a.dead = true; }); g.hazards.length = 0; g.gustT = 999;
            // find open sky right next to an island, and step off
            for (let y = 6; y < m.h - 6; y++) for (let x = 6; x < m.w - 6; x++) if (G.get(m, x, y) === G.T.VOID && G.get(m, x - 1, y) === G.T.FLOOR && G.get(m, x - 2, y) === G.T.FLOOR) {
                WHWorldDebug.teleport((x - 2) * 32 + 16, y * 32 + 16); p.hp = p.maxHp; window.__safe = { x: p.x, y: p.y };
                setTimeout(() => { p.x = x * 32 + 16; p.y = y * 32 + 16; p.dashT = 0; }, 150);
                return { x, y };
            }
            return null; })()`);
        await sleep(700);
        const fell = await evalJs('(() => { const p = WHW.game.player; return { hp: p.hp / p.maxHp, onVoid: WHWorldGen.tileAt(WHW.game.map, p.x, p.y) === WHWorldGen.T.VOID, wasDown: window.__wasDown }; })()');
        await shot('shot-sky.png');
        if (SCRATCH) await evalJs('(() => { WHW.ui.closeModal(); return true; })()');
        if (SCRATCH) for (const z of ['storm', 'ruins']) { await evalJs('WHWorldDebug.travel("' + z + '")'); await evalJs('(() => { const c = WHW.game.map.camp, p = WHW.game.player; WHWorldDebug.teleport(c.x + 200, c.y - 150); p.maxHp = p.hp = 1e6; WHW.engine.snapCamera(); return true; })()'); await sleep(900); await shot('shot-' + z + '.png'); }
        if (SCRATCH) await evalJs('(() => { WHW.ui.closeModal(); const g = WHW.game, p = g.player; p.dead = false; p.maxHp = g.pstats.maxHp; p.hp = p.maxHp; return true; })()');
        check('sky: stepping off an island drops you back on solid ground, a fifth of your health lighter', !!fall && !fell.onVoid && fell.hp > 0.7 && fell.hp < 0.85, { fall, fell });
        // ---- the Arena and the Proving Grounds ----
        await evalJs('WHWorldDebug.travel("town")');
        await sleep(300);
        check('arena: its building stands in town with a door', await evalJs('!!WHW.game.map.arena && !!WHW.game.map.arena.door'));
        await evalJs('WHWorldDebug.travel("arena")');
        await sleep(400);
        check('arena: inside, the Pit, four rings and Varro the Arena Master', await evalJs('WHW.game.zoneId === "arena" && !!WHW.game.map.pit && WHW.game.map.rings.length === 4 && WHW.game.map.npcs.some(n => n.id === "varro")'));
        if (SCRATCH) { await evalJs('(() => { const p = WHW.game.map.pit; WHWorldDebug.teleport(p.x, p.y + p.r + 120); WHW.engine.snapCamera(); return true; })()'); await sleep(600); await shot('shot-arena.png'); }
        await evalJs('WHW.ui.openNpc("varro")');
        await sleep(150);
        await evalJs('document.querySelector("[data-arenamenu]").click()');
        await sleep(150);
        check('arena: Varro opens the Arena menu', await evalJs('/The queue/.test(document.getElementById("wModalBody").textContent) && /rating/.test(document.getElementById("wModalBody").textContent)'));
        await evalJs('document.querySelector("[data-artab=shop]").click()');
        await sleep(150);
        check('arena: the Glory shop lists its wares', await evalJs('document.querySelectorAll("[data-arbuy]").length === WHWorldArena.SHOP.length'));
        // seasons: the menu says which season it is and when it ends; an ended season's result can be claimed once
        const season = await evalJs(`(() => { const a = WHW.game.state.arena;
            a.seasonLast = { id: WHWorldArena.prevSeason(a.season.id), peak: 1420, rank: 'platinum', games: 9, claimed: false };
            document.querySelector('[data-artab=rank]').click();
            const body = document.getElementById('wModalBody');
            const line = (body.querySelector('.w-arena-season') || {}).textContent || '';
            const btn = body.querySelector('[data-arseason]'), glory = a.glory;
            const boards = [...body.querySelectorAll('[data-arboard]')].map(b => b.dataset.arboard).join();
            if (btn) btn.click();
            return { line, had: !!btn, boards, paid: a.glory - glory, want: WHWorldArena.SEASON.rewards.platinum.glory, title: a.title, again: !!document.querySelector('[data-arseason]') }; })()`);
        check('arena: the menu shows the season and when it ends', /^Season \w{3} '\d\d: ends in \d+[dh]/.test(season.line) && season.boards === 'season,last,waves', season);
        check('arena: an ended season\'s reward is claimed once, with its title worn', season.had && season.paid === season.want && /^Platinum · /.test(season.title) && !season.again, season);
        if (SCRATCH) await shot('shot-arena-season.png');
        await evalJs('WHW.ui.closeModal()');
        await evalJs('WHWorldDebug.travel("trials")');
        await sleep(400);
        await shot('shot-trials.png');
        const waves = await evalJs(`(async () => { const g = WHW.game, s = g.state, rub = s.rubies;
            WHWorldDebug.teleport(g.map.ready.x, g.map.ready.y);
            WHW.waves.start();
            await new Promise(r => setTimeout(r, 6200)); // the ready countdown
            const wave = WHW.waves.run && WHW.waves.run.wave, st = WHW.waves.run && WHW.waves.run.st;
            // clear it
            for (let i = 0; i < 20 && WHW.waves.run && WHW.waves.run.st === 'fight'; i++) {
                for (const a of g.actors) if (a.wave && !a.dead) WHW.actors.damage(a, 1e9, { from: g.player, kbAngle: 0, kb: 0, s: 1 });
                await new Promise(r => setTimeout(r, 400));
            }
            return { wave, st, after: WHW.waves.run.st, best: s.arena.waveBest, paid: s.rubies - rub, glory: s.arena.glory, loot: Object.keys(s.bag).length }; })()`);
        check('waves: a run starts at wave 1 and its first wave is fought', waves.wave === 1 && waves.st === 'fight', waves);
        check('waves: clearing it pays rubies and Glory, and nothing else drops', waves.after === 'break' && waves.best === 1 && waves.paid > 0 && waves.glory > 0 && waves.loot === 0, waves);
        await evalJs('WHWorldDebug.travel("town")');
        await sleep(300);
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
        // ---- the Crucible: forge gear for the game from essences, play its minigame, send it home ----
        await evalJs('(() => { const s = WHW.game.state; for (const id of ["sunstone", "quicksilver", "titan_ruby", "flint_shard"]) s.mats[id] = 5; s.rubies += 20000; WHW.ui.openStation("crucible"); return true; })()');
        await sleep(200);
        check('crucible: it opens from town, with the essences you have and the odds', await evalJs('!!document.querySelector("#wModalBody .w-odds") && document.querySelectorAll("#wModalBody [data-add]").length >= 4'));
        await evalJs('(() => { document.querySelector("[data-kind=game]").click(); for (const id of ["titan_ruby", "sunstone", "quicksilver", "flint_shard"]) document.querySelector("[data-add=" + id + "]").click(); return true; })()');
        await sleep(100);
        if (SCRATCH) await shot('shot-crucible.png');
        await evalJs('document.getElementById("doForge").click()');
        await sleep(500);
        check('crucible: forging plays its minigame', await evalJs('WHW.craft.isOpen() && WHW.craft.current().opts.station === "crucible"'));
        if (SCRATCH) { await evalJs('(() => { const r = WHW.craft.current(); r.down = true; return true; })()'); await sleep(900); await shot('shot-crucible-game.png'); }
        await evalJs('(() => { const r = WHW.craft.current(); r.finished = true; r.opts.onDone(85); return true; })()');
        await sleep(300);
        check('crucible: a piece of gear for the game comes out, into the Relic Satchel', await evalJs('WHW.game.state.satchel.length === 1 && WHW.game.state.relics.forged === 1 && /Forged/.test(document.getElementById("wModalTitle") ? document.getElementById("wModalTitle").textContent : document.body.textContent)'));
        if (SCRATCH) await shot('shot-crucible-result.png');
        // and a Wilds relic in hand, drawn in its essences' colours
        await evalJs('(() => { const s = WHW.game.state; const it = WHWorld.addGear(s, "sword_3", 90, [], Date.now(), { r: { t: 6, l: [["ember", 1], ["might", 1], ["keen", 1], ["swift", 1], ["vigor", 1]], m: ["heart_crypt", "titan_ruby"], c: ["#ff3b1f", "#ffe14d"], q: "wyrmtongue", by: "Smoke", n: 0, lv: 3 } }); s.hotbar[0] = it.uid; s.sel = 0; WHW.refreshPlayer(); WHW.ui.closeModal(); return true; })()');
        check('relics: a unique keeps its name and shape', await evalJs('WHWorld.gearName(WHW.game.state.gear.find(g => g.r && g.r.q === "wyrmtongue")) === "Wyrmtongue" && WHW.actors.myLooks().w.shape === "flamberge"'));
        if (SCRATCH) { await evalJs('WHW.engine.snapCamera()'); await sleep(500); await shot('shot-relic-in-hand.png'); await evalJs('WHW.ui.openBag()'); await sleep(300); await shot('shot-bag-relic.png'); await evalJs('WHW.ui.closeModal()'); }
        await evalJs('(() => { WHW.relics.open("satchel"); return true; })()');
        await sleep(150);
        await evalJs('document.getElementById("sendAll").click()');
        await sleep(150);
        check('crucible: sent home from the satchel', await evalJs('WHW.game.state.satchel.length === 0 && WHW.game.state.outbox.some(e => e.gear && e.gear.length === 1)'));
        await evalJs('WHW.ui.closeModal()');

        // ---- a reload in a hidden dungeon (a browser may reload a tab on its own): still in it, the rooms cleared still cleared ----
        await evalJs(`(() => { const s = WHW.game.state, b = WHWorldData.ZONES.greenwood.boss; s.bosses[b] = Object.assign(s.bosses[b] || {}, { kills: Math.max(1, (s.bosses[b] || {}).kills || 0) }); WHW.actions.enterDungeon('roots'); WHW.ui.closeModal(); const rc = WHW.waves.vaultReady(); WHWorldDebug.teleport(rc.x, rc.y); WHW.waves.start(); return true; })()`);
        await evalJs(`(() => { const g = WHW.game, p = g.player; window.__k = setInterval(() => { p.hp = p.maxHp; for (const a of g.actors) if (a.wave && !a.dead) WHW.actors.damage(a, 1e6, { from: p, kbAngle: 0, kb: 0, s: 1 }); }, 200); return true; })()`);
        await waitFor('WHW.waves.run && WHW.waves.run.st === "break" && WHW.waves.run.wave === 1', 40000);
        await evalJs('(() => { clearInterval(window.__k); const rc = WHW.waves.vaultReady(); WHWorldDebug.teleport(rc.x, rc.y); WHW.waves.start(); window.saveGame(); return true; })()'); // room 2 about to start
        await send('Page.reload');
        await sleep(1500);
        await waitFor('typeof window.WHWorldDebug === "object" && WHWorldDebug.frames() > 30');
        await waitFor('window._saveLoaded === true', 15000); // this tab plays (and saves) again before anything else happens
        await sleep(500);
        const back = await evalJs('({ zone: WHW.game.zoneId, run: WHW.waves.run && WHW.waves.run.st + WHW.waves.run.wave, toasts: document.getElementById("toasts").textContent })');
        check('dungeon: after a reload you are still in it, with room 1 cleared and room 2 to start again', back.zone === 'roots' && back.run === 'break1' && /still cleared/.test(back.toasts) && !/closed by your browser/.test(back.toasts), back);
        await evalJs('(() => { WHW.ui.closeModal(); WHW.actions.leaveDungeon(); WHWorldDebug.travel("town"); return WHW.game.state.dungeons.run === null; })()');
        await evalJs('WHWorldDebug.grant({ gems: 2, boxes: [0, 1, 0, 0, 0] })');
        const rubiesBefore = await evalJs('WHWorldDebug.state().rubies');
        await navigate(`http://localhost:${PORT}/index.html`, 'window._saveLoaded === true');
        await sleep(600);
        check('gear: the forged piece arrives in the game and is worn at once', await evalJs('WHGearPanel.count() === 1 && WHGearPanel.worn().length === 1 && Object.values(getGearBonuses()).some(v => v > 0)'));
        await evalJs('WHI.openInventory("gear")');
        await sleep(400);
        check('gear: the Items menu has a Gear tab showing it, with its picture', await evalJs('!!document.querySelector(".items-content .gear-card .gear-svg") && document.querySelectorAll(".gear-slot").length === 5'));
        if (SCRATCH) await shot('shot-clicker-gear.png');
        await evalJs('WHI.closeInventory()');
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
        // Renown and the crew, seen from the game
        check('renown: the ⭐ chip in the top bar opens its panel, with the crew', await evalJs('(() => { document.getElementById("renownChip").click(); const ok = !document.getElementById("renownPanel").hidden && /Your crew in Wildgate/.test(document.getElementById("rnBody").textContent) && /In Wildgate/.test(document.getElementById("rnBody").textContent); return ok; })()'));
        if (SCRATCH) fs.writeFileSync(path.join(SCRATCH, 'shot-renown.png'), Buffer.from((await send('Page.captureScreenshot', { format: 'png' })).result.data, 'base64'));
        await evalJs('WHRenownPanel.close()');
        // daily and weekly challenges: the 📋 chip opens three of each, with what they pay
        check('challenges: the 📋 chip opens three dailies and three weeklies', await evalJs('(() => { document.getElementById("challengeChip").click(); const p = document.getElementById("challengePanel"); const ok = !!p && !p.hidden && p.querySelectorAll(".ch-row").length === 6 && /New ones in/.test(p.textContent) && /gem/.test(p.textContent); return ok; })()'));
        if (SCRATCH) fs.writeFileSync(path.join(SCRATCH, 'shot-challenges.png'), Buffer.from((await send('Page.captureScreenshot', { format: 'png' })).result.data, 'base64'));
        await evalJs('WHChallengePanel.close()');
        check('crew: the Somalian Pirate\'s upgrade shows he is in Wildgate', await evalJs('(() => { _crewTagKey = ""; renderCrewTags(); const t = document.querySelector("#upgrade2 .crew-tag"); return !!t && !t.hidden && t.textContent === "🏕️"; })()'));
        await navigate(`http://localhost:${PORT}/achievements.html`, 'typeof WHA === "object" && document.querySelectorAll(".ach").length > 20');
        const revealed = await evalJs(`(() => { const c = [...document.querySelectorAll('.ach.done')].find(x => /Hands Off/.test(x.textContent)); return c ? { name: c.querySelector('.name').textContent.replace('NEW', '').trim(), desc: c.querySelector('.desc').textContent, title: c.querySelector('.t').textContent, hiddenLeft: document.querySelectorAll('.ach.is-hidden').length, equip: !!c.querySelector('[data-equip]') } : null; })()`);
        check('achievements: once unlocked it shows its name, description and title', revealed && revealed.name === 'Hands Off' && /Auto Clicker/.test(revealed.desc) && revealed.title === 'Hands-Free' && revealed.hiddenLeft === 0 && revealed.equip, revealed);
        if (SCRATCH) fs.writeFileSync(path.join(SCRATCH, 'shot-achievements.png'), Buffer.from((await send('Page.captureScreenshot', { format: 'png' })).result.data, 'base64'));
        await navigate(`http://localhost:${PORT}/world.html?whdebug`, 'typeof window.WHWorldDebug === "object" && WHWorldDebug.frames() > 30');
        await sleep(500);
        check('golden trade: the Wilds collects the rubies when it opens', (await evalJs('WHWorldDebug.state().rubies')) === rubiesBefore + rate && (await evalJs('WHWorldDebug.state().inAck')) >= 1,
            [rubiesBefore, await evalJs('WHWorldDebug.state().rubies')]);
        check('golden trade: the game then sees nothing waiting', (await evalJs('WHWorldBridge.rubiesWaiting(localStorage)')) === 0);

        // ---- the Wilds on a phone held upright: touch controls, a menu that fills the screen, and the Attack button ----
        await send('Emulation.setDeviceMetricsOverride', { width: 390, height: 844, deviceScaleFactor: 2, mobile: true });
        await send('Emulation.setTouchEmulationEnabled', { enabled: true, maxTouchPoints: 5 });
        await navigate(`http://localhost:${PORT}/world.html?whdebug`, 'typeof window.WHWorldDebug === "object" && WHWorldDebug.frames() > 30');
        await evalJs('WHW.ui.closeModal(); WHWorldDebug.travel("greenwood"); true');
        await sleep(600);
        const phone = await evalJs(`(() => { const r = (id) => { const e = document.getElementById(id); const b = e.getBoundingClientRect(); return { l: b.left, t: b.top, r: b.right, b: b.bottom, w: b.width, on: !e.hidden && b.width > 0 }; };
            const atk = r('tAtk'), dash = r('tDash'), bar = r('hotbar'), hp = r('hpBar'), mm = r('minimap');
            const apart = (a, b) => a.r <= b.l || b.r <= a.l || a.b <= b.t || b.b <= a.t;
            return { touch: WHW.engine.isTouch && !document.getElementById('touchUi').hidden, atk, apart: apart(atk, bar) && apart(dash, bar) && apart(atk, mm) && apart(atk, hp),
                icon: document.querySelector('#tAtk .ic').innerHTML.trim().length > 0, type: WHW.engine.mouse.type,
                py: WHW.engine.worldToScreen(WHW.game.player.x, WHW.game.player.y).y, bottomGap: WHW.game.map.h * 32 - WHW.game.player.y,
                pills: !!document.querySelector('#partyHud:not([hidden]):empty, #tourHud:not([hidden]):empty') }; })()`);
        check('wilds on a phone: touch controls with a thumb-sized Attack button showing what you hold, clear of the hotbar, minimap and health', phone && phone.touch && phone.atk.on && phone.atk.w >= 70 && phone.apart && phone.icon, phone);
        check('wilds on a phone: aimed by touch from the start, and no empty party or tournament pill', phone && phone.type === 'touch' && !phone.pills, phone);
        // arriving at the Greenwood's south edge, the camera goes past the map's edge so you stand above the thumb buttons
        check('wilds on a phone: by the bottom of the map you still stand above the Attack button', phone && phone.py < phone.atk.t - 20, { py: phone && phone.py, atkTop: phone && phone.atk.t, bottomGap: phone && phone.bottomGap });
        await evalJs('document.getElementById("btnBag").click(); true');
        const sheet = await evalJs(`(() => { const b = document.getElementById('wModalPanel').getBoundingClientRect(); const t = document.querySelector('#wModalBody .w-tabs'); return { w: b.width, h: b.height, oneRow: !t || getComputedStyle(t).flexWrap === 'nowrap' }; })()`);
        check('wilds on a phone: a menu fills the screen with its tabs on one line', sheet && sheet.w === 390 && sheet.h > 700 && sheet.oneRow, sheet);
        await evalJs('WHW.ui.closeModal(); true');
        // a dummy below the player: the aim turns to it by itself (without hitting it), and a tap on Attack swings into it
        await evalJs(`(() => { WHW.game.actors.length = 0; const id = WHWorldDebug.spawnDummy(); const d = WHW.game.actors.find(a => a.id === id); d.x = WHW.game.player.x; d.y = WHW.game.player.y + 40; window._dummy = id; return true; })()`);
        // (it turns slowly on purpose, and a headless browser may run the game slowly: wait for it, up to a few seconds)
        await waitFor('Math.abs(WHW.game.player.aimHold - Math.PI / 2) < 0.2', 6000);
        const aimed = await evalJs('({ hp: WHWorldDebug.actorHp(window._dummy), aim: WHW.game.player.aimHold })');
        check('wilds on a phone: the weapon turns to the nearest enemy by itself, without hurting it', aimed && aimed.hp === 500 && Math.abs(aimed.aim - Math.PI / 2) < 0.2, aimed);
        const ab = await evalJs('(() => { const b = document.getElementById("tAtk").getBoundingClientRect(); return { x: b.left + b.width / 2, y: b.top + b.height / 2 }; })()');
        await send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ x: ab.x, y: ab.y, id: 1 }] });
        await sleep(120);
        await send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
        await sleep(400);
        check('wilds on a phone: a tap on Attack swings into it', (await evalJs('WHWorldDebug.actorHp(window._dummy)')) < 500);
        // Settings > Touch controls can turn it off: no Attack button, dash back in the corner, no auto-aim; and on again
        const classic = await evalJs(`(() => {
            WHW.settings.touchAttack = false; WHW.applyTouch(); WHW.game.player.aimHold = 0;
            const atk = document.getElementById('tAtk').getBoundingClientRect(), dash = document.getElementById('tDash').getBoundingClientRect();
            return { atk: atk.width, dashRight: Math.round(innerWidth - dash.right), dashW: Math.round(dash.width) }; })()`);
        await sleep(600);
        const classicAim = await evalJs('WHW.game.player.aimHold');
        await evalJs('WHW.settings.touchAttack = true; WHW.applyTouch(); true');
        check('wilds on a phone: Settings can switch back to the earlier touch controls (no Attack button, dash in the corner, no auto-aim)',
            classic && classic.atk === 0 && classic.dashW === 70 && classic.dashRight < 30 && classicAim === 0 && !(await evalJs('document.body.classList.contains("w-touch-classic")')), { classic, classicAim });
        if (SCRATCH) fs.writeFileSync(path.join(SCRATCH, 'shot-wilds-phone.png'), Buffer.from((await send('Page.captureScreenshot', { format: 'png' })).result.data, 'base64'));
        await send('Emulation.setTouchEmulationEnabled', { enabled: false });
        await send('Emulation.clearDeviceMetricsOverride');

        const bad = errors().filter((e) => !/Failed to fetch|firebase|Firestore|ERR_BLOCKED|Load failed|NetworkError|net::/i.test(e));
        check('no uncaught page errors on any page (network noise excluded)', bad.length === 0, bad);

        // ---- installing as an app (pwa.js, sw.js): last, because it stops the server to play offline ----
        await navigate(`http://localhost:${PORT}/index.html`, 'window._saveLoaded === true');
        check('app: the service worker takes charge of the game', await waitFor('!!(navigator.serviceWorker && navigator.serviceWorker.controller)', 30000));
        check('app: the Install row in Settings says something', await evalJs('!document.getElementById("installAppRow").hidden && document.getElementById("installAppHelp").textContent.length > 20'));
        check('app: the files of the first visit are kept', await waitFor(`(async () => { const c = await caches.open('wh-pages-v1'); return !!(await c.match(location.origin + '/main.js')) && !!(await c.match(location.origin + '/core/world-data.js')); })()`, 30000));
        const cachedMedia = await evalJs(`(async () => (await (await caches.open('wh-media-v1')).keys()).length)()`);
        check('app: images are kept too', cachedMedia > 3, cachedMedia);
        check('app: nothing from Google or Firebase was kept', await evalJs(`(async () => { for (const n of await caches.keys()) for (const r of await (await caches.open(n)).keys()) if (new URL(r.url).origin !== location.origin) return false; return true; })()`));
        const errsBeforeOffline = errors().length;
        try { server.kill(); } catch (e) {}
        await sleep(800);
        await send('Page.navigate', { url: `http://localhost:${PORT}/index.html` });
        check('app: with the server gone, the game still opens from what was kept', await waitFor('window._saveLoaded === true && typeof buyUpgrade1 === "function"', 30000));
        check('app: and it plays', await evalJs('(() => { const before = Number(upgrade1Level); count = 1e6; buyUpgrade1(); return Number(upgrade1Level) > before; })()'));
        const offlineBad = errors().slice(errsBeforeOffline).filter((e) => !/Failed to fetch|firebase|Firestore|ERR_BLOCKED|Load failed|NetworkError|net::|ERR_CONNECTION_REFUSED|ERR_INTERNET/i.test(e));
        check('app: no page errors offline (network noise excluded)', offlineBad.length === 0, offlineBad);
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
