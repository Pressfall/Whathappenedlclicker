/**
 * Clans in a real browser (npm run test:browser): the clan page (clan.html: clan-page.js, clan-events-tab.js) and the
 * game page's clan code (clan-game.js), against an in-memory Firestore (tests/browser/fake-firestore.js) and a stand-in
 * for Firebase Auth, so nothing reaches the real database. Every write to a clan document is checked against the rules'
 * spec (core/clan-roles.js), as the chat test does.
 *
 * CHROME_PATH   path to chrome / chromium (default: the usual Windows, macOS and Linux locations)
 * SHOTS_DIR     if set, screenshots of the clan page's tabs are saved there
 */
const { spawn, execFileSync } = require('child_process');
const fs = require('fs');
const os = require('os');
const path = require('path');

const ROOT = path.resolve(__dirname, '..', '..');
const PROFILE = fs.mkdtempSync(path.join(os.tmpdir(), 'wh-clans-profile-'));
const PORT = 8128, DEBUG = 9338;
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
const FAKE_AUTH = Buffer.from(`
const cur = () => { try { const v = JSON.parse(localStorage.getItem('__fake_auth') || 'null'); return v ? { uid: v.uid, isAnonymous: !!v.anon } : null; } catch (e) { return null; } };
export function getAuth() { return { get currentUser() { return cur(); } }; }
export function onAuthStateChanged(a, cb) { setTimeout(() => cb(cur()), 0); return () => {}; }
export async function signInAnonymously() { localStorage.setItem('__fake_auth', JSON.stringify({ uid: 'anon' + Math.random().toString(36).slice(2, 10), anon: true })); return { user: cur() }; }
`);
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

const DAY = 864e5;
function seedData(now) {
    const bfStart = now - DAY, ppStart = now - 6 * DAY, conStart = now - 11 * DAY;
    return {
        'clans/testclan': { name: 'Test Clan', owner: 'Me', members: ['Me', 'Pal'], leaders: ['Me'], clanXp: 600, createdAt: { __ms: now - 30 * DAY }, maxMembers: 30,
            ownerUid: 'uidMe', roles: { uidMe: 'leader', uidPal: 'member' }, names: { uidMe: 'Me', uidPal: 'Pal' }, acct: { uidMe: true, uidPal: false }, kicks: {} },
        'clans/otherclan': { name: 'Other Clan', owner: 'Zed', members: ['Zed'], leaders: ['Zed'], clanXp: 0, ownerUid: 'uidZed', roles: { uidZed: 'leader' }, names: { uidZed: 'Zed' }, acct: { uidZed: true } },
        'clans/testclan/members/Me': { lastCps: 1234, lastClickPower: 50, lastUpdate: now, gpoints: 12 },
        'clans/testclan/members/Pal': { lastCps: 99, lastUpdate: now - 3 * 3600e3, wildsAt: now - 30000, wilds: { cls: 'gunslinger', r: 1234, wb: 12, k: 456 } },
        'profiles/Me': { clanId: 'testclan', clanRole: 'leader', title: '' },
        'profiles/Pal': { clanId: 'testclan', clanRole: 'member' },
        'events/config': { types: ['Bossfight', 'prestige party'] },
        'events/state': { upcoming: [
            { name: 'Bossfight', start: bfStart, end: bfStart + 3 * DAY, isDowntime: false },
            { name: 'DOWNTIME', start: bfStart + 3 * DAY, end: bfStart + 5 * DAY, isDowntime: true },
            { name: 'prestige party', start: bfStart + 5 * DAY, end: bfStart + 8 * DAY, isDowntime: false },
            { name: 'DOWNTIME', start: bfStart + 8 * DAY, end: bfStart + 10 * DAY, isDowntime: true },
            { name: 'Bossfight', start: bfStart + 10 * DAY, end: bfStart + 13 * DAY, isDowntime: false },
            { name: 'DOWNTIME', start: bfStart + 13 * DAY, end: bfStart + 15 * DAY, isDowntime: true },
            { name: 'prestige party', start: bfStart + 15 * DAY, end: bfStart + 18 * DAY, isDowntime: false },
            { name: 'DOWNTIME', start: bfStart + 18 * DAY, end: bfStart + 20 * DAY, isDowntime: true },
        ] },
        'events/bossfight_meta': { events: { [bfStart]: { totalHp: 1e6, phaseHps: [2.5e5, 5e5, 7.5e5, 1e6], gimmicks: [{ id: 'shield' }, { id: 'enrage' }, { id: 'armor' }, { id: 'chaos' }] } } },
        'events/bossfight_progress': { events: { [bfStart]: { testclan: { total: 200000, members: { Me: 150000, Pal: 50000 } } } } },
        // two events ended while nobody looked: both must be paid
        'events/last_ended_event': { recent: [
            { name: 'construction event', start: conStart, end: conStart + 3 * DAY, type: 'construction' },
            { name: 'prestige party', start: ppStart, end: ppStart + 3 * DAY, type: 'prestige_party' },
        ] },
        'events/construction_progress': { events: { [conStart]: { testclan: { total: 160, members: { Me: { points: 160, completedCount: 6 } } } } } },
        'events/prestige_party_progress': { events: { [ppStart]: { testclan: { total: 42, members: { Me: 30, Pal: 12 } } } } },
    };
}

async function main() {
    const server = spawn(process.execPath, [path.join(ROOT, 'server.js')], { env: { ...process.env, PORT: String(PORT) }, stdio: 'ignore' });
    const chrome = spawn(CHROME, ['--headless=new', `--remote-debugging-port=${DEBUG}`, `--user-data-dir=${PROFILE}`, '--no-first-run', '--no-default-browser-check',
        '--disk-cache-size=1048576', '--disable-component-update', '--disable-background-networking', '--safebrowsing-disable-auto-update',
        '--disable-features=BackForwardCache', '--window-size=1280,1000', 'about:blank'], { stdio: 'ignore' });
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
        const send = (method, params = {}) => new Promise((res) => {
            const i = ++id;
            const timer = setTimeout(() => { if (pending.delete(i)) { console.log('(no answer from the browser to ' + method + ' after 60 s)'); res({ error: { message: 'timeout' } }); } }, 60000);
            pending.set(i, (msg) => { clearTimeout(timer); res(msg); });
            ws.send(JSON.stringify({ id: i, method, params }));
        });
        const evalJs = async (expression) => { const r = await send('Runtime.evaluate', { expression, awaitPromise: true, returnByValue: true }); return r.result && r.result.result ? r.result.result.value : undefined; };
        const waitFor = async (expr, ms = 20000) => { const t = Date.now(); while (Date.now() - t < ms) { if (await evalJs(expr) === true) return true; await sleep(200); } return false; };
        const shot = async (name) => {
            if (!process.env.SHOTS_DIR) return;
            const r = await send('Page.captureScreenshot', { format: 'png', captureBeyondViewport: true });
            if (r.result && r.result.data) fs.writeFileSync(path.join(process.env.SHOTS_DIR, name + '.png'), Buffer.from(r.result.data, 'base64'));
        };
        await send('Page.enable'); await send('Runtime.enable');
        await send('Network.enable'); await send('Network.setCacheDisabled', { cacheDisabled: true });
        await send('Page.addScriptToEvaluateOnNewDocument', { source: GUARD });
        await send('Fetch.enable', { patterns: [{ urlPattern: '*' }] });
        const blockRe = /googlesyndication|doubleclick|google-analytics|googletagmanager|analytics\.google|firestore\.googleapis|identitytoolkit|securetoken|firebaseinstallations|firebase\.googleapis|google\.com\/pagead/;
        const js = (body) => ({ responseCode: 200, responseHeaders: [{ name: 'Content-Type', value: 'application/javascript' }, { name: 'Access-Control-Allow-Origin', value: '*' }], body: body.toString('base64') });
        const pump = setInterval(() => {
            for (let i = 0; i < events.length; i++) {
                const e = events[i];
                if (e.method !== 'Fetch.requestPaused') continue;
                events.splice(i, 1); i--;
                const url = e.params.request.url;
                if (/firebasejs\/[\d.]+\/firebase-auth\.js/.test(url)) send('Fetch.fulfillRequest', Object.assign({ requestId: e.params.requestId }, js(FAKE_AUTH)));
                else if (/firebasejs\/[\d.]+\/firebase-firestore\.js/.test(url)) send('Fetch.fulfillRequest', Object.assign({ requestId: e.params.requestId }, js(FAKE_FS)));
                else if (blockRe.test(url)) send('Fetch.failRequest', { requestId: e.params.requestId, errorReason: 'BlockedByClient' });
                else send('Fetch.continueRequest', { requestId: e.params.requestId });
            }
        }, 20);
        const navigate = async (url, ready) => { await send('Page.navigate', { url }); await sleep(1200); return waitFor(ready || 'document.readyState === "complete"'); };
        const save = (o) => JSON.stringify(Object.assign({ version: 3, count: 1000, diamonds: 100, clanPoints: 2000, goldenWhat: 20, prestigeTimes: 2 }, o || {}));

        // ---- the clan page: a leader with an account opens it ----
        await navigate(`http://localhost:${PORT}/about.html`);
        const NOW = Date.now();
        await evalJs(`(() => { localStorage.clear(); localStorage.setItem('__fake_fs_seed', ${JSON.stringify(JSON.stringify(seedData(NOW)))});
            localStorage.setItem('__fake_auth', JSON.stringify({ uid: 'uidMe', anon: false })); localStorage.setItem('__denied', '[]');
            localStorage.setItem('player_username', 'Me'); localStorage.setItem('player_clanId', 'testclan'); localStorage.setItem('player_clanName', 'Test Clan');
            localStorage.setItem('player_clanRole', 'member'); localStorage.setItem('whathappened_prestige_times', '2');
            localStorage.setItem('whathappened_save', ${JSON.stringify(save())}); return true; })()`);
        await navigate(`http://localhost:${PORT}/clan.html`, '!!window.__fakeFS && !!window.WHClanPage && !!document.querySelector(".banner-title")');
        check('clan page: your clan shows, from the new modules', await waitFor('document.querySelector(".banner-title h2") && document.querySelector(".banner-title h2").textContent === "Test Clan"'));
        check('clan page: the members list shows both members, the leader first', await waitFor('document.querySelectorAll("#membersList .member").length === 2')
            && await evalJs('document.querySelector("#membersList .member").dataset.name === "Me"'));
        check('clan page: the role in the clan document reaches the game (achievements read it)', await waitFor('localStorage.getItem("player_clanRole") === "leader"'));

        // both events that ended while nobody looked are paid, into the save, with a note for an open game tab
        const saveNow = 'JSON.parse(localStorage.getItem("whathappened_save"))';
        check('events: two events that ended while nobody looked are both paid', await waitFor(`!!localStorage.getItem('whathappened_pp_claimed_${NOW - 6 * DAY}') && !!localStorage.getItem('whathappened_con_claimed_${NOW - 11 * DAY}')`, 30000),
            await evalJs('Object.keys(localStorage).filter(k => k.includes("claimed")).join()'));
        const after = await evalJs(saveNow);
        // pp 42: tiers 20+40 = 15 gems (+15 top bonus), 35 CP (+10); con 160: 15 gems, 30 CP; level 3 clan: no event bonus yet
        check('events: the right gems and Clan Points', after.diamonds === 100 + 15 + 15 + 15 && after.clanPoints === 2000 + 35 + 10 + 30, after);
        check('events: the clan got both events\' XP once', await evalJs('window.__fakeFS.docs["clans/testclan"].clanXp') === 600 + 150 + 150, await evalJs('window.__fakeFS.docs["clans/testclan"].clanXp'));
        check('events: an open game tab is told what changed', await evalJs('(JSON.parse(localStorage.getItem("whathappened_clan_delta") || "{}").diamonds || 0) > 0'));

        // the Events tab
        await evalJs('document.getElementById("tabEventsBtn").click()');
        check('events tab: the bossfight running now, with its health, phase twist and contributors', await waitFor('!!document.querySelector(".ev-hero.ev-bf .boss-hp") && /Shield/.test(document.getElementById("evLive").textContent) && /Me/.test((document.getElementById("evPeople") || {}).textContent || "")'),
            await evalJs('document.getElementById("tabEvents").textContent.slice(0, 400)'));
        check('events tab: coming up and recent results', await waitFor('/Coming up/.test(document.getElementById("tabEvents").textContent) && /Collected/.test((document.getElementById("evRecent") || {}).textContent || "")'),
            await evalJs('(document.getElementById("evRecent") || {}).textContent'));
        await shot('clan-events');
        // a new player's clicks: progress shows live
        await evalJs(`(async () => { await setDoc(doc(db, 'events', 'bossfight_progress'), { events: { ['${NOW - DAY}']: { testclan: { total: firestoreIncrement(300000), members: { Me: firestoreIncrement(300000) } } } } }, { merge: true }); return true; })()`);
        check('events tab: progress updates live (into phase 3, with a new twist)', await waitFor('/Armor/.test(document.getElementById("evLive").textContent)'));

        // the shop: a buff
        await evalJs('document.getElementById("tabShopBtn").click()');
        await waitFor('!!document.querySelector(".chip-btn.fill")');
        await shot('clan-shop');
        const cpBefore = (await evalJs(saveNow)).clanPoints;
        await evalJs('document.querySelector(".chip-btn.fill[data-buff=\\"click_double_30m\\"]").click()');
        check('shop: filling a buff starts it for the whole clan', await waitFor('!!(window.__fakeFS.docs["clans/testclan"].activeBuffs || {}).click_double_30m'));
        check('shop: and costs exactly its Clan Points', await waitFor(`${saveNow}.clanPoints === ${cpBefore} - 500`), (await evalJs(saveNow)).clanPoints);

        // the daily check-in
        await evalJs('document.getElementById("tabClansBtn").click()');
        await waitFor('!!document.getElementById("checkinBtn")');
        const cp2 = (await evalJs(saveNow)).clanPoints, xp2 = await evalJs('window.__fakeFS.docs["clans/testclan"].clanXp');
        await evalJs('document.getElementById("checkinBtn").click()');
        check('check-in: +25 clan XP and Clan Points for me', await waitFor(`window.__fakeFS.docs["clans/testclan"].clanXp === ${xp2} + 25 && ${saveNow}.clanPoints === ${cp2} + 5`));
        // the overhaul: this week's board, the stats strip, a clanmate in the Wilds with their Wilds card
        check('overhaul: the check-in counts on the weekly board', await waitFor('/Me/.test(document.getElementById("weekCard").textContent) && /25 XP/.test(document.getElementById("weekCard").textContent)'),
            await evalJs('document.getElementById("weekCard").textContent'));
        check('overhaul: the stats strip under the banner', await waitFor('document.querySelectorAll("#clanStats .cs-chip").length === 5'));
        check('overhaul: a clanmate playing the Wilds shows as In the Wilds, with class and rating', await waitFor('/In the Wilds/.test(document.querySelector("#membersList .member[data-name=Pal]").textContent) && /Gunslinger/.test(document.querySelector("#membersList .member[data-name=Pal]").textContent) && /1.23K rating/.test(document.querySelector("#membersList .member[data-name=Pal]").textContent)'),
            await evalJs('document.querySelector("#membersList .member[data-name=Pal]").textContent'));
        check('overhaul: the game page learns the sign-in id the clan knows me by', await evalJs('localStorage.getItem("whathappened_clan_uid") === "uidMe"'));
        // Manage: close the clan and ask for 3 prestiges
        await evalJs('document.getElementById("manageClanBtn").click()');
        await waitFor('!!document.getElementById("joinModeSelect")');
        await evalJs('(() => { document.getElementById("joinModeSelect").value = "closed"; document.getElementById("minPrestigeInput").value = "3"; document.getElementById("saveDescBtn").click(); return true; })()');
        check('overhaul: a leader closes the clan and sets a prestige requirement', await waitFor('window.__fakeFS.docs["clans/testclan"].joinMode === "closed" && window.__fakeFS.docs["clans/testclan"].minPrestige === 3'));
        check('overhaul: the banner says so', await waitFor('/Closed/.test(document.querySelector(".banner-title").textContent) && document.querySelector(".banner-title").textContent.includes("3+ prestiges")'));
        // the in-page dialog instead of confirm(): Leave asks first, and Cancel keeps you in
        await evalJs('document.getElementById("leaveClanBtn").click()');
        check('overhaul: leaving asks in a dialog on the page', await waitFor('!!document.querySelector(".dlg-wrap .dlg") && /Leave Test Clan/.test(document.querySelector(".dlg").textContent)'));
        await shot('clan-dialog');
        await evalJs('document.querySelector(".dlg [data-r=no]").click()');
        check('overhaul: Cancel keeps you in the clan', await waitFor('!document.querySelector(".dlg-wrap")') && await evalJs('localStorage.getItem("player_clanId") === "testclan"'));
        await shot('clan-page');
        // a Wilds Hunt running: its card in the Events tab
        await evalJs(`(() => { const d = window.__fakeFS.docs; d['events/state'].upcoming[0].name = 'Wilds Hunt';
            d['events/wilds_hunt_progress'] = { events: { ['${NOW - DAY}']: { testclan: { total: 420, members: { Me: 300, Pal: 120 } } } } };
            window.__fakeFS.subs.forEach((s) => s()); return true; })()`);
        await evalJs('document.getElementById("tabEventsBtn").click()');
        check('overhaul: a Wilds Hunt shows its monsters, tiers and hunters', await waitFor('!!document.querySelector(".ev-hero.ev-wh") && /420/.test(document.getElementById("evLive").textContent) && /monsters defeated in the Wilds/.test(document.getElementById("evLive").textContent) && /Pal/.test((document.getElementById("evPeople") || {}).textContent || "")'),
            await evalJs('(document.getElementById("evLive") || {}).textContent'));
        await shot('clan-hunt');
        // back to the bossfight for the game page's checks below
        await evalJs("(() => { window.__fakeFS.docs['events/state'].upcoming[0].name = 'Bossfight'; window.__fakeFS.subs.forEach((s) => s()); return true; })()");
        await evalJs('document.getElementById("tabClansBtn").click()');
        const log = await evalJs('JSON.parse(localStorage.getItem("__denied") || "[]")');
        check('clan page: every write it sent is one the rules allow', log.length > 0 && !log.some((l) => /DENY/.test(l)), log);

        // ---- the game page pays an event by itself (the clan page is never opened) ----
        const ebStart = NOW - 4 * DAY;
        await evalJs(`(() => { const d = window.__fakeFS.docs;
            d['events/last_ended_event'].recent.push({ name: 'Endless boss', start: ${ebStart}, end: ${ebStart + 3 * DAY}, type: 'endless_boss' });
            d['events/endless_boss_meta'] = { events: { ['${ebStart}']: { baseHp: 1000 } } };
            d['events/endless_boss_progress'] = { events: { ['${ebStart}']: { testclan: { total: 5000, members: { Me: 5000 } } } } };
            localStorage.setItem('__fake_fs_seed', JSON.stringify(d)); return true; })()`);
        const gemsBefore = (await evalJs(saveNow)).diamonds;
        await navigate(`http://localhost:${PORT}/index.html`, 'window._saveLoaded === true && !!window.WHClanGame');
        check('game page: an event that ended is paid in the game itself', await waitFor(`!!localStorage.getItem('whathappened_eb_claimed_${ebStart}')`, 30000));
        check('game page: into the running game and its save', await waitFor(`diamonds === ${gemsBefore} + 12 && ${saveNow}.diamonds === ${gemsBefore} + 12`), [await evalJs('diamonds'), gemsBefore]);
        check('game page: the clan\'s buff and level perks are on', await waitFor('window.clanBuffClickMult === 2 && getClanLevelPerk().cps > 0'));
        // clicks during the bossfight reach its progress, as damage
        const dmgBefore = await evalJs(`window.__fakeFS.docs['events/bossfight_progress'].events['${NOW - DAY}'].testclan.total`);
        await evalJs('(() => { const b = document.querySelector(".main-image-btn") || document.getElementById("mainImage"); for (let i = 0; i < 5; i++) b.click(); return true; })()');
        check('game page: clicks in a bossfight are sent as damage', await waitFor(`window.__fakeFS.docs['events/bossfight_progress'].events['${NOW - DAY}'].testclan.total > ${dmgBefore}`, 15000));
        // kicked while the game is open: it notices
        // (changed behind the rules' back, then the page's live listeners are told, as Firestore would after a real kick)
        await evalJs(`(() => { const c = window.__fakeFS.docs['clans/testclan']; delete c.roles.uidMe; delete c.names.uidMe; c.members = ['Pal']; c.ownerUid = 'uidPal'; window.__fakeFS.subs.forEach((s) => s()); return true; })()`);
        check('game page: a player no longer in the clan loses its perks and buffs at once', await waitFor('!localStorage.getItem("player_clanId") && window.clanBuffClickMult === 1 && getClanLevelPerk().cps === 0'));

        // ---- the Wilds (clan-wilds.js): monsters for a Wilds Hunt, and "In the Wilds" on the clan page ----
        await evalJs(`(() => { const d = window.__fakeFS.docs; d['events/state'].upcoming[0].name = 'Wilds Hunt'; delete d['events/wilds_hunt_progress'];
            localStorage.setItem('__fake_fs_seed', JSON.stringify(d)); localStorage.setItem('player_clanId', 'testclan'); localStorage.setItem('player_clanName', 'Test Clan');
            localStorage.removeItem('whathappened_clan_wilds_mark'); return true; })()`);
        await navigate(`http://localhost:${PORT}/world.html?whdebug`, 'typeof window.WHWorldDebug === "object" && window._saveLoaded === true && !!window.WHClanWilds');
        check('wilds: the clan module knows a Wilds Hunt is on', await waitFor('!!WHClanWilds.hunt()', 20000));
        await evalJs('WHClanWilds.send()'); // the first look only marks where the counter is
        await evalJs('(async () => { WHWorldDebug.state().stats.kills += 7; await WHClanWilds.send(); return true; })()');
        const hunt = await evalJs(`(() => { const p = window.__fakeFS.docs['events/wilds_hunt_progress']; const b = p && p.events['${NOW - DAY}']; return b && b.testclan; })()`);
        check('wilds: monsters defeated during the hunt reach the clan\'s total, with my share', !!hunt && hunt.total === 7 && hunt.members.Me === 7, hunt);
        await evalJs('WHClanWilds.send()');
        check('wilds: and are never counted twice', await evalJs(`window.__fakeFS.docs['events/wilds_hunt_progress'].events['${NOW - DAY}'].testclan.total`) === 7);
        await evalJs('WHClanWilds.beat()');
        check('wilds: a heartbeat with my Wilds card for the clan page', await waitFor('!!window.__fakeFS.docs["clans/testclan/members/Me"] && window.__fakeFS.docs["clans/testclan/members/Me"].wildsAt > 0 && !!window.__fakeFS.docs["clans/testclan/members/Me"].wilds'),
            await evalJs('window.__fakeFS.docs["clans/testclan/members/Me"]'));

        const errs = events.filter((e) => e.method === 'Runtime.exceptionThrown').map((e) => (e.params.exceptionDetails.exception && e.params.exceptionDetails.exception.description) || e.params.exceptionDetails.text)
            .filter((e) => !/Failed to fetch|firebase|ERR_BLOCKED|Load failed|NetworkError|net::/i.test(e));
        check('no uncaught page errors', errs.length === 0, errs);
        clearInterval(pump);
        ws.close();
    } finally {
        cleanup();
    }
    const failed = results.filter((r) => !r.ok);
    console.log(`\n${results.length - failed.length}/${results.length} clan checks passed`);
    process.exitCode = failed.length ? 1 : 0;
}
main().catch((e) => { console.error('clan test crashed:', e); process.exitCode = 2; });
