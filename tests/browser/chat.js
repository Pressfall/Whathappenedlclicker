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
// For the clan ownership checks: a stand-in for Firebase Auth's module (only once those checks start, so cloud.js keeps the
// real one before): the player is whoever localStorage __fake_auth says ({ uid, anon }), anonymous sign-in makes one up.
const FAKE_AUTH = Buffer.from(`
const cur = () => { try { const v = JSON.parse(localStorage.getItem('__fake_auth') || 'null'); return v ? { uid: v.uid, isAnonymous: !!v.anon } : null; } catch (e) { return null; } };
export function getAuth() { return { get currentUser() { return cur(); } }; }
export function onAuthStateChanged(a, cb) { setTimeout(() => cb(cur()), 0); return () => {}; }
export async function signInAnonymously() { localStorage.setItem('__fake_auth', JSON.stringify({ uid: 'anon' + Math.random().toString(36).slice(2, 10), anon: true })); return { user: cur() }; }
`);
let fakeAuth = false;
// ...and every write to a clan document has to pass the rules' spec (core/clan-roles.js), as Firestore would make it
const GUARD = `window.__fakeGuard = function (path, before, after) {
    if (!(path.startsWith('clans/') && path.split('/').length === 2) || !window.WHClanRoles) return null;
    const u = JSON.parse(localStorage.getItem('__fake_auth') || 'null');
    const r = window.WHClanRoles.classifyClanUpdate(before, after, u && u.uid, !!u && !u.anon);
    const log = JSON.parse(localStorage.getItem('__denied') || '[]'); log.push(r.ok ? 'ok:' + r.action : 'DENY ' + r.action + ':' + r.reason); localStorage.setItem('__denied', JSON.stringify(log));
    return r.ok ? null : r.action + ':' + r.reason;
};`;

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
        // a call the browser never answers gives up after a minute (so a stuck run fails its checks instead of hanging)
        const send = (method, params = {}) => new Promise((res) => {
            const i = ++id;
            const timer = setTimeout(() => { if (pending.delete(i)) { console.log('(no answer from the browser to ' + method + ' after 60 s)'); res({ error: { message: 'timeout' } }); } }, 60000);
            pending.set(i, (msg) => { clearTimeout(timer); res(msg); });
            ws.send(JSON.stringify({ id: i, method, params }));
        });
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
                if (fakeAuth && /firebasejs\/[\d.]+\/firebase-auth\.js/.test(url)) {
                    send('Fetch.fulfillRequest', { requestId: e.params.requestId, responseCode: 200, responseHeaders: [{ name: 'Content-Type', value: 'application/javascript' }, { name: 'Access-Control-Allow-Origin', value: '*' }], body: FAKE_AUTH.toString('base64') });
                } else if (/firebasejs\/[\d.]+\/firebase-firestore\.js/.test(url)) {
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

        // ---- clan ownership (core/clan-roles.js; firestore-social.rules says the same): every clan write checked ----
        fakeAuth = true;
        // (no cache, so the page really fetches the Auth module, and gets the stand-in)
        await send('Network.enable'); await send('Network.setCacheDisabled', { cacheDisabled: true });
        await send('Page.addScriptToEvaluateOnNewDocument', { source: GUARD });
        const clanDoc = 'JSON.stringify(window.__fakeFS.docs["clans/testclan"] || null)';
        // the owner, signed in to an account, opens the clan page: their clan is claimed for them
        await evalJs(`(() => { localStorage.setItem('__denied', '[]'); localStorage.setItem('__fake_auth', JSON.stringify({ uid: 'uidOwnerMe', anon: false })); localStorage.setItem('player_username', 'Me'); localStorage.setItem('player_clanId', 'testclan');
            localStorage.setItem('__fake_fs_seed', JSON.stringify(JSON.parse(JSON.stringify(window.__fakeFS.docs)))); return true; })()`);
        await navigate(`http://localhost:${PORT}/clan.html`, '!!window.__fakeFS && !!window.WHClanPage');
        check('clans: the owner, signed in to an account, claims their old clan by opening it', await waitFor(`(() => { const c = window.__fakeFS.docs['clans/testclan']; return !!c && c.ownerUid === 'uidOwnerMe' && c.roles.uidOwnerMe === 'leader' && c.names.uidOwnerMe === 'Me'; })()`, 15000), await evalJs(clanDoc));
        // someone else tries the old takeover, and taking ownerUid
        const takeover = await evalJs(`(async () => { localStorage.setItem('__fake_auth', JSON.stringify({ uid: 'uidMallory', anon: true }));
            const out = [];
            for (const up of [{ owner: 'Mallory', members: [] }, { ownerUid: 'uidMallory', 'roles.uidMallory': 'leader' }, { description: 'pwned' }]) { try { await updateDoc(doc(db, 'clans', 'testclan'), up); out.push('allowed'); } catch (e) { out.push(e.code); } }
            return out.join(); })()`);
        check('clans: anyone else taking it over, emptying it or editing it is refused', takeover === 'permission-denied,permission-denied,permission-denied', takeover);
        // an anonymous player joins as a member
        // (a page keeps the sign-in it opened with, so each change of player opens the page again, with the clan as it is now)
        const as = async (auth, name, clanId) => {
            // (the chat name and the Wilds name are one name since core/names.js, and the Wilds' wins: both change)
            await evalJs(`(() => { localStorage.setItem('__fake_auth', ${JSON.stringify(JSON.stringify(auth))}); localStorage.setItem('player_username', ${JSON.stringify(name)}); localStorage.setItem('whathappened_world_name', ${JSON.stringify(name)});
                ${clanId ? `localStorage.setItem('player_clanId', '${clanId}');` : `localStorage.removeItem('player_clanId');`} localStorage.setItem('whathappened_prestige_times', '1');
                localStorage.setItem('__fake_fs_seed', JSON.stringify(window.__fakeFS.docs)); return true; })()`);
            await navigate(`http://localhost:${PORT}/clan.html`, '!!window.__fakeFS && !!window.WHClanPage');
            await sleep(500);
        };
        await as({ uid: 'uidNewbie1', anon: true }, 'Newbie', null);
        const joined = await evalJs(`(async () => { await WHClanPage.joinClan('testclan'); const c = window.__fakeFS.docs['clans/testclan'];
            return c.roles.uidNewbie1 + ':' + c.acct.uidNewbie1 + ':' + c.members.includes('Newbie'); })()`);
        check('clans: an anonymous player joins, as a member, through the rules', joined === 'member:false:true', joined);
        // the owner kicks them: their entry goes, and a notice is left in the clan
        await as({ uid: 'uidOwnerMe', anon: false }, 'Me', 'testclan');
        const kicked = await evalJs(`(async () => { await WHClanPage.kickMember('testclan', 'Newbie', 'testing'); const c = window.__fakeFS.docs['clans/testclan'];
            return (c.roles.uidNewbie1 === undefined) + ':' + (c.kicks.uidNewbie1 && c.kicks.uidNewbie1.reason) + ':' + c.members.includes('Newbie'); })()`);
        check('clans: the owner kicks them, through the rules, with a notice', kicked === 'true:testing:false', kicked);
        const log = await evalJs('JSON.parse(localStorage.getItem("__denied") || "[]").join("|")');
        check('clans: the page itself never sent a write the rules would refuse (only the three takeover tries were)', (log.match(/DENY/g) || []).length === 3 && /ok:claim/.test(log) && /ok:join/.test(log) && /ok:kick/.test(log), log);
        fakeAuth = false;

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
