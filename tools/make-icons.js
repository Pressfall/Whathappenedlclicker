/**
 * Makes the app icons for manifest.webmanifest from the favicon (mainimage/upgrades/argoonion.png, 172x181, not square):
 *   mainimage/icons/icon-192.png, icon-512.png  rounded corners, for "any"
 *   mainimage/icons/maskable-512.png            full bleed (the platform cuts its own shape; the face sits in the safe zone)
 *   mainimage/icons/apple-180.png               full bleed, for iOS home screens (they round it themselves)
 * Run once with `node tools/make-icons.js` (needs Chrome; draws on a canvas in a headless one). The output is committed, so
 * nothing needs running on deploy.
 */
const { spawn, execFileSync } = require('child_process');
const fs = require('fs');
const os = require('os');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');
const SRC = path.join(ROOT, 'mainimage', 'upgrades', 'argoonion.png');
const OUT = path.join(ROOT, 'mainimage', 'icons');
const DEBUG = 9341;
const CHROME = [process.env.CHROME_PATH, 'C:/Program Files/Google/Chrome/Application/chrome.exe', 'C:/Program Files (x86)/Google/Chrome/Application/chrome.exe',
    '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome', '/usr/bin/google-chrome', '/usr/bin/chromium'].filter(Boolean).find((p) => fs.existsSync(p));
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// the square of the photo to use: the face, without the corner of the "W" at the bottom right
const CROP = { x: 8, y: 0, size: 156 };
const ICONS = [
    { file: 'icon-192.png', size: 192, round: true },
    { file: 'icon-512.png', size: 512, round: true },
    { file: 'maskable-512.png', size: 512, round: false },
    { file: 'apple-180.png', size: 180, round: false },
];

async function main() {
    if (!CHROME) throw new Error('Chrome not found (set CHROME_PATH)');
    fs.mkdirSync(OUT, { recursive: true });
    const profile = fs.mkdtempSync(path.join(os.tmpdir(), 'wh-icons-'));
    const chrome = spawn(CHROME, ['--headless=new', `--remote-debugging-port=${DEBUG}`, `--user-data-dir=${profile}`, '--no-first-run', '--disk-cache-size=1048576', 'about:blank'], { stdio: 'ignore' });
    try {
        let targets = null;
        for (let i = 0; i < 60 && !targets; i++) { try { targets = await (await fetch(`http://127.0.0.1:${DEBUG}/json`)).json(); } catch (e) { await sleep(1000); } }
        if (!targets) throw new Error('Chrome never opened the debugging port');
        const ws = new WebSocket(targets.find((t) => t.type === 'page').webSocketDebuggerUrl);
        await new Promise((r) => ws.addEventListener('open', r));
        let id = 0; const pending = new Map();
        ws.addEventListener('message', (m) => { const msg = JSON.parse(m.data); if (msg.id && pending.has(msg.id)) { pending.get(msg.id)(msg); pending.delete(msg.id); } });
        const send = (method, params = {}) => new Promise((res) => { const i = ++id; pending.set(i, res); ws.send(JSON.stringify({ id: i, method, params })); });
        const src = 'data:image/png;base64,' + fs.readFileSync(SRC).toString('base64');
        for (const icon of ICONS) {
            const expr = `(async () => {
                const img = new Image(); img.src = ${JSON.stringify(src)}; await img.decode();
                const n = ${icon.size}, c = document.createElement('canvas'); c.width = c.height = n;
                const g = c.getContext('2d'); g.imageSmoothingEnabled = true; g.imageSmoothingQuality = 'high';
                if (${icon.round}) { const r = n * 0.22; g.beginPath(); g.moveTo(r, 0); g.arcTo(n, 0, n, n, r); g.arcTo(n, n, 0, n, r); g.arcTo(0, n, 0, 0, r); g.arcTo(0, 0, n, 0, r); g.closePath(); g.clip(); }
                g.fillStyle = '#0b0d13'; g.fillRect(0, 0, n, n);
                g.drawImage(img, ${CROP.x}, ${CROP.y}, ${CROP.size}, ${CROP.size}, 0, 0, n, n);
                return c.toDataURL('image/png').split(',')[1];
            })()`;
            const r = await send('Runtime.evaluate', { expression: expr, awaitPromise: true, returnByValue: true });
            const b64 = r.result && r.result.result && r.result.result.value;
            if (!b64) throw new Error('drawing ' + icon.file + ' failed: ' + JSON.stringify(r.result || r.error));
            fs.writeFileSync(path.join(OUT, icon.file), Buffer.from(b64, 'base64'));
            console.log('wrote mainimage/icons/' + icon.file);
        }
        ws.close();
    } finally {
        try { if (process.platform === 'win32') execFileSync('taskkill', ['/PID', String(chrome.pid), '/T', '/F'], { stdio: 'ignore' }); else chrome.kill('SIGKILL'); } catch (e) {}
        setTimeout(() => { try { fs.rmSync(profile, { recursive: true, force: true }); } catch (e) {} }, 2000);
    }
}
main().catch((e) => { console.error(e); process.exit(1); });
