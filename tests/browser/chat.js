/**
 * Chat safety in a real browser (npm run test:browser): the main game's global and clan chat (index.html side panel) and
 * the clan page (clan.html). Firestore is replaced by an in-memory stand-in (tests/browser/fake-firestore.js) served in
 * place of the SDK module, seeded with test messages, so nothing reaches the real database; Auth, ads and analytics hosts
 * are blocked as in smoke.js. (The Wilds chat is checked in online.js.)
 *
 * CHROME_PATH   path to chrome / chromium (default: the usual Windows, macOS and Linux locations)
 */
const { spawn, execFileSync } = require('child_process');
const fs = require('fs');
const os = require('os');
const path = require('path');

const ROOT = path.resolve(__dirname, '..', '..');
const PROFILE = fs.mkdtempSync(path.join(os.tmpdir(), 'wh-chat-profile-'));
const PORT = 8127, DEBUG = 9337;
const CANDIDATES = [
    process.env.CHROME_PATH,
    'C:/Program Files/Google/Chrome/Application/chrome.exe',
    'C:/Program Files (x86)/Google/Chrome/Application/chrome.exe',
    '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
    '/usr/bin/google-chrome', '/usr/bin/chromium', '/usr/bin/chromium-browser',
].filter(Boolean);
const CHROME = CANDIDATES.find((p) => fs.existsSync(p));
if (!CHROME) { console.error('Chrome not found. Set CHROME_PATH to your chrome executable.'); process.exit(2); }
const FAKE_FS = fs.readFileSync(path.join(__dirname, 'fake-firestore.js'));

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const results = [];
const check = (name, ok, extra) => { results.push({ name, ok: !!ok }); console.log((ok ? 'PASS ' : 'FAIL ') + name + (extra !== undefined && !ok ? '  -> ' + JSON.stringify(extra) : '')); };

// test messages (made up for the test; timestamps relative to now)
function seedData(now) {
    const m = (ms) => ({ __ms: now - ms });
    return {
        'global_chat/g1': { name: 'Tester One', message: 'what the hell is this', createdAt: m(60000) },
        'global_chat/g2': { name: 'Tester Two', message: 'buy now buy now', createdAt: m(50000) },
        'global_chat/g3': { name: 'Tester Two', message: 'buy now buy now', createdAt: m(49000) },
        'global_chat/g4': { name: 'Tester Two', message: 'Buy now  buy now', createdAt: m(48000) },
        'global_chat/g5': { name: 'Tester Three', message: 'z'.repeat(40) + ' end', createdAt: m(40000) },
        'clan_chat/c1': { clanId: 'testclan', name: 'Tester One', message: 'oh shit', createdAt: m(30000) },
        'clan_chat/c2': { clanId: 'testclan', name: 'Tester Two', message: 'damn pinned', pinned: true, pinnedBy: 'Me', pinnedByRole: 'leader', createdAt: m(20000) },
        'clan_chat/c3': { clanId: 'testclan', name: 'SYSTEM', system: true, color: 'green', message: 'Tester One joined the clan!', createdAt: m(10000) },
        'clans/testclan': { name: 'Test Clan', members: ['Me', 'Tester One', 'Tester Two'], owner: 'Me', leaders: ['Me'], clanXp: 0, createdAt: m(1e6) },
        'profiles/Me': { clanId: 'testclan', clanRole: 'leader' },
    };
}

async function main() {
    const server = spawn(process.execPath, [path.join(ROOT, 'server.js')], { env: { ...process.env, PORT: String(PORT) }, stdio: 'ignore' });
    const chrome = spawn(CHROME, ['--headless=new', `--remote-debugging-port=${DEBUG}`, `--user-data-dir=${PROFILE}`, '--no-first-run', '--no-default-browser-check',
        '--disk-cache-size=1048576', '--disable-component-update', '--disable-background-networking', '--safebrowsing-disable-auto-update',
        '--window-size=1280,1000', 'about:blank'], { stdio: 'ignore' });
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
        let targets = null;
        for (let i = 0; i < 60 && !targets; i++) { try { targets = await (await fetch(`http://127.0.0.1:${DEBUG}/json`)).json(); } catch (e) { await sleep(1000); } }
        if (!targets) throw new Error('Chrome never opened the debugging port');
        const ws = new WebSocket(targets.find((t) => t.type === 'page').webSocketDebuggerUrl);
        await new Promise((r) => ws.addEventListener('open', r));
        let id = 0; const pending = new Map(); const events = [];
        ws.addEventListener('message', (m) => { const msg = JSON.parse(m.data); if (msg.id && pending.has(msg.id)) { pending.get(msg.id)(msg); pending.delete(msg.id); } else events.push(msg); });
        const send = (method, params = {}) => new Promise((res) => { const i = ++id; pending.set(i, res); ws.send(JSON.stringify({ id: i, method, params })); });
        const evalJs = async (expression) => { const r = await send('Runtime.evaluate', { expression, awaitPromise: true, returnByValue: true }); return r.result && r.result.result ? r.result.result.value : undefined; };
        const waitFor = async (expr, ms = 20000) => { const t = Date.now(); while (Date.now() - t < ms) { if (await evalJs(expr) === true) return true; await sleep(200); } return false; };
        await send('Page.enable'); await send('Runtime.enable');
        // the Firestore SDK is swapped for the stand-in; Auth, ads and analytics never load
        await send('Fetch.enable', { patterns: [{ urlPattern: '*' }] });
        const blockRe = /googlesyndication|doubleclick|google-analytics|googletagmanager|analytics\.google|firestore\.googleapis|identitytoolkit|securetoken|firebaseinstallations|firebase\.googleapis|google\.com\/pagead/;
        const pump = setInterval(() => {
            for (let i = 0; i < events.length; i++) {
                const e = events[i];
                if (e.method !== 'Fetch.requestPaused') continue;
                events.splice(i, 1); i--;
                const url = e.params.request.url;
                if (/firebasejs\/[\d.]+\/firebase-firestore\.js/.test(url)) {
                    send('Fetch.fulfillRequest', { requestId: e.params.requestId, responseCode: 200, responseHeaders: [{ name: 'Content-Type', value: 'application/javascript' }, { name: 'Access-Control-Allow-Origin', value: '*' }], body: FAKE_FS.toString('base64') });
                } else if (blockRe.test(url)) send('Fetch.failRequest', { requestId: e.params.requestId, errorReason: 'BlockedByClient' });
                else send('Fetch.continueRequest', { requestId: e.params.requestId });
            }
        }, 20);
        const navigate = async (url, ready) => { await send('Page.navigate', { url }); await sleep(1200); return waitFor(ready || 'document.readyState === "complete"'); };

        // ---- a new visitor (no chat_safe_mode stored) with some chat already there ----
        await navigate(`http://localhost:${PORT}/index.html`);
        await evalJs(`(() => { window.suppressAutosave = true; localStorage.clear(); localStorage.setItem('__fake_fs_seed', ${JSON.stringify(JSON.stringify(seedData(Date.now())))});
            localStorage.setItem('player_username', 'Me'); localStorage.setItem('player_clanId', 'testclan'); localStorage.setItem('player_clanName', 'Test Clan'); return true; })()`);
        await navigate(`http://localhost:${PORT}/index.html`, 'window._saveLoaded === true && !!window.__fakeFS && !!document.getElementById("chatToggle")');
        check('the Firestore stand-in is in use (nothing reaches the real database)', await evalJs('!!window.__fakeFS && Object.keys(window.__fakeFS.docs).length > 5'));
        await evalJs('document.getElementById("chatToggle").click()');
        const gText = 'document.getElementById("sideGlobalMessages").textContent';
        check('global chat shows the messages', await waitFor(`${gText}.includes("Tester One")`));
        const g = await evalJs(gText);
        check('new visitor: the swear filter is on by default', await evalJs('document.getElementById("chatSafeModeCheck").checked') && g.includes('what the *** is this') && !/hell/.test(g), g);
        check('new visitor: the default is not written (only a deliberate choice is stored)', await evalJs('localStorage.getItem("chat_safe_mode") === null'));
        check('the same message sent again and again in a row shows once, with a count', (g.match(/buy now\s+buy now/gi) || []).length === 1 && g.includes('×3'), g);
        check('a wall of one repeated character is squashed', !g.includes('z'.repeat(10)) && g.includes('zzz… end'), g);

        // turning it off is a deliberate choice, kept across reloads
        await evalJs('(() => { const c = document.getElementById("chatSafeModeCheck"); c.checked = false; c.dispatchEvent(new Event("change")); return true; })()');
        check('turning the filter off shows the words', await waitFor(`${gText}.includes("what the hell")`) && await evalJs('localStorage.getItem("chat_safe_mode") === "0"'));
        await navigate(`http://localhost:${PORT}/index.html`, 'window._saveLoaded === true && !!window.__fakeFS');
        await evalJs('document.getElementById("chatToggle").click()');
        check('a player who turned it off keeps it off after a reload', await waitFor(`${gText}.includes("what the hell")`) && await evalJs('!document.getElementById("chatSafeModeCheck").checked'));
        await evalJs('(() => { const c = document.getElementById("chatSafeModeCheck"); c.checked = true; c.dispatchEvent(new Event("change")); return true; })()');
        check('turning it back on hides them again', await waitFor(`${gText}.includes("what the ***")`) && await evalJs('localStorage.getItem("chat_safe_mode") === "1"'));

        // the clan tab of the same panel
        await evalJs('document.getElementById("sideTabClan").click()');
        const cText = 'document.getElementById("sideClanMessages").textContent';
        check('clan chat in the side panel is filtered too', await waitFor(`${cText}.includes("oh ***")`) && !(await evalJs(cText)).includes('shit'), await evalJs(cText));

        // send limits: a double send goes once; the same message again is refused; something new after a pause goes
        const adds = (col) => `window.__fakeFS.adds.filter(a => a.path === "${col}").length`;
        await evalJs('document.getElementById("sideTabGlobal").click()');
        await sleep(300);
        const sendGlobal = (t) => evalJs(`(() => { const i = document.getElementById("sideGlobalInput"); i.value = ${JSON.stringify(t)}; document.getElementById("sideGlobalSend").click(); return true; })()`);
        await sendGlobal('hello everyone'); await sendGlobal('hello everyone');
        await sleep(500);
        check('pressing send twice quickly sends once', await evalJs(adds('global_chat')) === 1, await evalJs(adds('global_chat')));
        await sleep(1700);
        await sendGlobal('HELLO   everyone');
        await sleep(400);
        check('the same message again soon after is refused', await evalJs(adds('global_chat')) === 1);
        await sendGlobal('something new');
        await sleep(400);
        check('a new message after a short pause goes through', await evalJs(adds('global_chat')) === 2);
        await sendGlobal('and another'); await sleep(300);
        check('sending again right away is refused', await evalJs(adds('global_chat')) === 2);

        // ---- the clan page ----
        await navigate(`http://localhost:${PORT}/clan.html`, '!!window.__fakeFS && !!document.getElementById("clanChatBox")');
        const box = 'document.getElementById("clanChatBox").textContent', pin = 'document.getElementById("clanChatPinned").textContent';
        check('clan page: chat shows the messages', await waitFor(`${box}.includes("oh")`), await evalJs('document.getElementById("clanDetailArea") && document.getElementById("clanDetailArea").textContent.slice(0, 200)'));
        check('clan page: messages and pinned messages are filtered (the setting chosen in the game)', (await evalJs(box)).includes('oh ***') && (await evalJs(pin)).includes('*** pinned')
            && await evalJs('document.getElementById("clanChatSafe").checked'), [await evalJs(box), await evalJs(pin)]);
        check('clan page: system messages still show', (await evalJs(box)).includes('Tester One joined the clan!'));
        await evalJs('(() => { const c = document.getElementById("clanChatSafe"); c.checked = false; c.dispatchEvent(new Event("change")); return true; })()');
        check('clan page: its own toggle turns the filter off', await waitFor(`${box}.includes("oh shit")`) && await evalJs('localStorage.getItem("chat_safe_mode") === "0"'));
        await evalJs('(() => { const c = document.getElementById("clanChatSafe"); c.checked = true; c.dispatchEvent(new Event("change")); return true; })()');
        await sleep(300);
        const before = await evalJs(adds('clan_chat'));
        await evalJs(`(() => { const f = document.getElementById("clanChatForm"), i = document.getElementById("clanChatInput");
            i.value = "hi clan"; f.requestSubmit(); i.value = "hi clan"; f.requestSubmit(); return true; })()`);
        await sleep(600);
        check('clan page: a double send goes once', await evalJs(adds('clan_chat')) === before + 1, [before, await evalJs(adds('clan_chat'))]);

        const errs = events.filter((e) => e.method === 'Runtime.exceptionThrown').map((e) => (e.params.exceptionDetails.exception && e.params.exceptionDetails.exception.description) || e.params.exceptionDetails.text)
            .filter((e) => !/Failed to fetch|firebase|ERR_BLOCKED|Load failed|NetworkError|net::/i.test(e));
        check('no uncaught page errors', errs.length === 0, errs);
        clearInterval(pump);
        ws.close();
    } finally {
        cleanup();
    }
    const failed = results.filter((r) => !r.ok);
    console.log(`\n${results.length - failed.length}/${results.length} chat checks passed`);
    process.exitCode = failed.length ? 1 : 0;
}
main().catch((e) => { console.error('chat test crashed:', e); process.exitCode = 2; });
