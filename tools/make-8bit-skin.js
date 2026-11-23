/**
 * Makes the 8-Bit WH skin from the original picture (mainimage/whathappened.jpeg):
 *   mainimage/wh8bit.png         1536x1024, like the other skins (the shop and the clicker's main button)
 *   mainimage/thumbs/wh8bit.webp 480x320 (the shop's card and the face in the Wilds)
 * The picture is shrunk to a 96x64 grid of big pixels, its colours snapped to the NES's palette (with a light ordered
 * dither), "WHAT HAPPENED?!" written again in a pixel font (the original's letters turn to mush at that size) and the
 * "REMASTERED" tag swapped for an "8-BIT" one. Run once with `node tools/make-8bit-skin.js` (needs Chrome; it draws on a
 * canvas in a headless one). The output is committed, so nothing needs running on deploy.
 */
const { spawn, execFileSync } = require('child_process');
const fs = require('fs');
const os = require('os');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');
const SRC = path.join(ROOT, 'mainimage', 'whathappened.jpeg');
const OUT = { full: path.join(ROOT, 'mainimage', 'wh8bit.png'), thumb: path.join(ROOT, 'mainimage', 'thumbs', 'wh8bit.webp') };
const DEBUG = 9343;
const CHROME = [process.env.CHROME_PATH, 'C:/Program Files/Google/Chrome/Application/chrome.exe', 'C:/Program Files (x86)/Google/Chrome/Application/chrome.exe',
    '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome', '/usr/bin/google-chrome', '/usr/bin/chromium'].filter(Boolean).find((p) => fs.existsSync(p));
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// Everything below the line runs in the page
const DRAW = String.raw`
async (src) => {
    const W = 96, H = 64;
    // the NES's colours (the 2C02 as most emulators show it)
    const NES = ['7C7C7C','0000FC','0000BC','4428BC','940084','A80020','A81000','881400','503000','007800','006800','005800','004058','000000',
        'BCBCBC','0078F8','0058F8','6844FC','D800CC','E40058','F83800','E45C10','AC7C00','00B800','00A800','00A844','008888',
        'F8F8F8','3CBCFC','6888FC','9878F8','F878F8','F85898','F87858','FCA044','F8B800','B8F818','58D854','58F898','00E8D8','787878',
        'FCFCFC','A4E4FC','B8B8F8','D8B8F8','F8B8F8','F8A4C0','F0D0B0','FCE0A8','F8D878','D8F878','B8F8B8','B8F8D8','00FCFC','F8D8F8']
        .map(h => [parseInt(h.slice(0, 2), 16), parseInt(h.slice(2, 4), 16), parseInt(h.slice(4, 6), 16)]);
    // nearest colour by the "redmean" distance (close to how far apart colours look)
    // near-grey colours snap to the palette's greys only (between its pale blue, peach and lilac a pale face sparkled)
    const GREYS = NES.filter(c => c[0] === c[1] && c[1] === c[2]);
    const nearest = (r, g, b) => {
        let best = NES[0], bd = Infinity;
        const list = Math.max(r, g, b) - Math.min(r, g, b) < 34 ? GREYS : NES;
        for (const c of list) {
            const rm = (r + c[0]) / 2, dr = r - c[0], dg = g - c[1], db = b - c[2];
            const d = (2 + rm / 256) * dr * dr + 4 * dg * dg + (2 + (255 - rm) / 256) * db * db;
            if (d < bd) { bd = d; best = c; }
        }
        return best;
    };
    const img = new Image(); img.src = src; await img.decode();
    // the picture's middle at 3:2 (the original is a little taller), shrunk smoothly so each big pixel is the average under it
    const cropH = img.width / 1.5, cropY = (img.height - cropH) / 2;
    const c = document.createElement('canvas'); c.width = W; c.height = H;
    const g = c.getContext('2d', { willReadFrequently: true });
    g.imageSmoothingEnabled = true; g.imageSmoothingQuality = 'high';
    g.drawImage(img, 0, cropY, img.width, cropH, 0, 0, W, H);
    const px = g.getImageData(0, 0, W, H), d = px.data;
    // shadows lifted and colours made bolder first (the NES has few dark shades: the right-hand face sank into black
    // without it), then a light 4x4 ordered dither into the palette, the same amount on every channel so pale skin
    // doesn't sparkle with stray hues
    const BAYER = [0, 8, 2, 10, 12, 4, 14, 6, 3, 11, 1, 9, 15, 7, 13, 5];
    const clamp = (v) => Math.max(0, Math.min(255, v));
    for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
        const i = (y * W + x) * 4, k = (BAYER[(y % 4) * 4 + (x % 4)] / 16 - 0.5) * 16;
        const lift = (v) => 255 * Math.pow(v / 255, 0.72);
        let r = lift(d[i]), gg = lift(d[i + 1]), b = lift(d[i + 2]);
        const l = 0.3 * r + 0.59 * gg + 0.11 * b, sat = 1.45;
        r = l + (r - l) * sat; gg = l + (gg - l) * sat; b = l + (b - l) * sat;
        const [R, G, B] = nearest(clamp(r + k), clamp(gg + k), clamp(b + k));
        d[i] = R; d[i + 1] = G; d[i + 2] = B; d[i + 3] = 255;
    }
    g.putImageData(px, 0, 0);

    // ---- the words, in a pixel font ----
    const BIG = {
        W: ['10001','10001','10001','10101','10101','11011','10001'], H: ['10001','10001','10001','11111','10001','10001','10001'],
        A: ['01110','10001','10001','11111','10001','10001','10001'], T: ['11111','00100','00100','00100','00100','00100','00100'],
        P: ['11110','10001','10001','11110','10000','10000','10000'], E: ['11111','10000','10000','11110','10000','10000','11111'],
        N: ['10001','11001','10101','10011','10001','10001','10001'], D: ['11110','10001','10001','10001','10001','10001','11110'],
        '?': ['01110','10001','00001','00110','00100','00000','00100'], '!': ['1','1','1','1','1','0','1'],
    };
    const SMALL = { 8: ['111','101','111','101','111'], '-': ['000','000','111','000','000'], B: ['110','101','110','101','110'], I: ['111','010','010','010','111'], T: ['111','010','010','010','010'] };
    const width = (font, s) => [...s].reduce((a, ch) => a + font[ch][0].length + 1, -1);
    // each lit pixel of the text, at (x, y)
    const cells = (font, s, x0, y0) => {
        const out = [];
        let x = x0;
        for (const ch of s) { font[ch].forEach((row, yy) => [...row].forEach((bit, xx) => { if (bit === '1') out.push([x + xx, y0 + yy]); })); x += font[ch][0].length + 1; }
        return out;
    };
    const put = (pts, col) => { g.fillStyle = col; for (const [x, y] of pts) g.fillRect(x, y, 1, 1); };
    // a black outline all round (as in the original), and a drop shadow one pixel down
    const outlined = (pts, fill) => {
        const ring = new Set();
        for (const [x, y] of pts) for (let dy = -1; dy <= 2; dy++) for (let dx = -1; dx <= 1; dx++) ring.add((x + dx) + ',' + (y + dy));
        put([...ring].map(k => k.split(',').map(Number)), '#000000');
        put(pts, fill);
    };
    // the original's words sit across the middle, two lines; clear a dark band behind ours so its blurred letters don't show
    const line1 = 'WHAT', line2 = 'HAPPENED?!';
    const y1 = 32, y2 = 42;
    g.fillStyle = '#000000';
    const bandX = Math.floor((W - width(BIG, line2)) / 2) - 3, bandW = width(BIG, line2) + 6;
    g.fillRect(bandX, y1 - 3, bandW, (y2 + 7 + 3) - (y1 - 3));
    g.fillStyle = '#FCFCFC'; // a thin frame, like an old title card
    g.fillRect(bandX, y1 - 3, bandW, 1); g.fillRect(bandX, y2 + 10, bandW, 1);
    outlined(cells(BIG, line1, Math.floor((W - width(BIG, line1)) / 2), y1), '#FCFCFC');
    outlined(cells(BIG, line2, Math.floor((W - width(BIG, line2)) / 2), y2), '#F8B800');
    // the corner tag: "8-BIT" where the original says REMASTERED
    const tag = '8-BIT', tw = width(SMALL, tag), tx = W - tw - 4, ty = 3;
    g.fillStyle = '#FCFCFC'; g.fillRect(tx - 2, ty - 2, tw + 4, 9);
    g.fillStyle = '#A80020'; g.fillRect(tx - 1, ty - 1, tw + 2, 7);
    put(cells(SMALL, tag, tx, ty), '#FCFCFC');

    // big pixels: scaled up without smoothing
    const up = (n, type, q) => {
        const o = document.createElement('canvas'); o.width = W * n; o.height = H * n;
        const og = o.getContext('2d'); og.imageSmoothingEnabled = false;
        og.drawImage(c, 0, 0, o.width, o.height);
        return o.toDataURL(type, q).split(',')[1];
    };
    return { full: up(16, 'image/png'), thumb: up(5, 'image/webp', 1) };
}`;

async function main() {
    if (!CHROME) throw new Error('Chrome not found (set CHROME_PATH)');
    const profile = fs.mkdtempSync(path.join(os.tmpdir(), 'wh-8bit-'));
    const chrome = spawn(CHROME, ['--headless=new', `--remote-debugging-port=${DEBUG}`, `--user-data-dir=${profile}`, '--no-first-run', '--disk-cache-size=1048576',
        '--disable-component-update', '--disable-background-networking', 'about:blank'], { stdio: 'ignore' });
    try {
        let targets = null;
        for (let i = 0; i < 60 && !targets; i++) { try { targets = await (await fetch(`http://127.0.0.1:${DEBUG}/json`)).json(); } catch (e) { await sleep(1000); } }
        if (!targets) throw new Error('Chrome never opened the debugging port');
        const ws = new WebSocket(targets.find((t) => t.type === 'page').webSocketDebuggerUrl);
        await new Promise((r) => ws.addEventListener('open', r));
        let id = 0; const pending = new Map();
        ws.addEventListener('message', (m) => { const msg = JSON.parse(m.data); if (msg.id && pending.has(msg.id)) { pending.get(msg.id)(msg); pending.delete(msg.id); } });
        const send = (method, params = {}) => new Promise((res) => { const i = ++id; pending.set(i, res); ws.send(JSON.stringify({ id: i, method, params })); });
        const src = 'data:image/jpeg;base64,' + fs.readFileSync(SRC).toString('base64');
        const r = await send('Runtime.evaluate', { expression: `(${DRAW})(${JSON.stringify(src)})`, awaitPromise: true, returnByValue: true });
        const v = r.result && r.result.result && r.result.result.value;
        if (!v || !v.full) throw new Error('drawing failed: ' + JSON.stringify(r.result || r.error));
        fs.writeFileSync(OUT.full, Buffer.from(v.full, 'base64'));
        fs.writeFileSync(OUT.thumb, Buffer.from(v.thumb, 'base64'));
        console.log('wrote mainimage/wh8bit.png (' + fs.statSync(OUT.full).size + ' bytes) and mainimage/thumbs/wh8bit.webp (' + fs.statSync(OUT.thumb).size + ' bytes)');
        ws.close();
    } finally {
        // only the browser we started (never every chrome.exe: that would close the person's own windows)
        try { if (process.platform === 'win32') execFileSync('taskkill', ['/PID', String(chrome.pid), '/T', '/F'], { stdio: 'ignore' }); else chrome.kill('SIGKILL'); } catch (e) {}
        setTimeout(() => { try { fs.rmSync(profile, { recursive: true, force: true }); } catch (e) {} }, 3000);
    }
}
main().catch((e) => { console.error(e); process.exit(1); });
