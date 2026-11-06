// Installing the game as an app: the manifest, its icons, every page linking it, and which requests the service worker
// (sw.js) handles. The worker itself runs in the browser smoke test (tests/browser/smoke.js).
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');
const read = (f) => fs.readFileSync(path.join(ROOT, f), 'utf8');
const SW = require('../sw.js');
const O = 'https://whathappened.example';

function pngSize(file) {
    const b = fs.readFileSync(path.join(ROOT, file));
    assert.equal(b.toString('ascii', 1, 4), 'PNG', file + ' is a PNG');
    return { w: b.readUInt32BE(16), h: b.readUInt32BE(20) };
}

test('the manifest names the game, opens the clicker full screen and has square icons of the sizes it claims', () => {
    const m = JSON.parse(read('manifest.webmanifest'));
    assert.equal(m.display, 'standalone');
    assert.equal(m.start_url, './index.html');
    assert.equal(m.scope, './');
    assert.ok(m.name && m.short_name && m.short_name.length <= 15, 'a short name that fits under an icon');
    assert.match(m.theme_color, /^#[0-9a-f]{6}$/i);
    assert.match(m.background_color, /^#[0-9a-f]{6}$/i);
    const sizes = new Set();
    for (const icon of m.icons) {
        const { w, h } = pngSize(icon.src);
        assert.equal(w, h, icon.src + ' is square');
        assert.equal(icon.sizes, w + 'x' + h, icon.src + ' is the size the manifest says');
        sizes.add(icon.sizes + ':' + icon.purpose);
    }
    for (const need of ['192x192:any', '512x512:any', '512x512:maskable']) assert.ok(sizes.has(need), 'has ' + need);
    for (const s of m.shortcuts || []) assert.ok(fs.existsSync(path.join(ROOT, s.url)), 'shortcut ' + s.url + ' exists');
});

test('every page links the manifest and the theme colour, and the iPhone icon is the square one', () => {
    const m = JSON.parse(read('manifest.webmanifest'));
    const pages = fs.readdirSync(ROOT).filter((f) => f.endsWith('.html'));
    assert.ok(pages.length >= 14);
    for (const f of pages) {
        const html = read(f);
        assert.match(html, /<link rel="manifest" href="manifest\.webmanifest">/, f);
        assert.ok(html.includes(`<meta name="theme-color" content="${m.theme_color}">`), f + ': theme colour matches the manifest');
        assert.match(html, /<link rel="apple-touch-icon" href="mainimage\/icons\/apple-180\.png">/, f);
    }
    assert.deepEqual(pngSize('mainimage/icons/apple-180.png'), { w: 180, h: 180 });
});

test('the game and the Wilds load pwa.js; the game has the Install row in Settings', () => {
    for (const f of ['index.html', 'world.html']) assert.match(read(f), /<script src="pwa\.js"><\/script>/, f);
    const html = read('index.html');
    assert.match(html, /id="installAppRow" hidden/);
    assert.match(html, /id="installAppBtn"[^>]*hidden/);
    assert.match(read('_headers'), /\/sw\.js\s*\n\s*Cache-Control: no-cache/, 'the worker itself is never cached by the host');
});

test('the service worker leaves other sites, writes and the local relay alone', () => {
    for (const url of [
        'https://www.gstatic.com/firebasejs/12.8.0/firebase-app.js',
        'https://firestore.googleapis.com/v1/projects/x',
        'https://pagead2.googlesyndication.com/pagead/js/adsbygoogle.js',
        'https://fonts.googleapis.com/css2?family=Bungee',
        'https://fonts.gstatic.com/s/inter/v1/a.woff2',
        'https://example-default-rtdb.firebaseio.com/.json',
    ]) assert.equal(SW.strategyFor(url, 'GET', O), null, url);
    assert.equal(SW.strategyFor(O + '/index.html', 'POST', O), null, 'only GET');
    assert.equal(SW.strategyFor(O + '/__net/stream?uid=abc', 'GET', O), null, 'the relay stream');
    assert.equal(SW.strategyFor(O + '/__net/op', 'GET', O), null);
    assert.equal(SW.strategyFor(O + '/sw.js', 'GET', O), null, 'the worker file itself');
    assert.equal(SW.strategyFor('not a url', 'GET', O), null);
});

test('the service worker takes pages and code from the network first, and images and sounds from what it kept', () => {
    for (const p of ['/', '/index.html', '/world.html?whdebug', '/account', '/main.js', '/core/world-data.js', '/styles.css', '/manifest.webmanifest', '/codes-seed.json'])
        assert.equal(SW.strategyFor(O + p, 'GET', O), 'network', p);
    for (const p of ['/mainimage/gem.png', '/bgimages/thumbs/stonghengebg.webp', '/audio/purchase.wav', '/mainimage/icons/icon-512.png', '/PNG-cards-1.3/2_of_clubs.png', '/mainimage/WHboss.png'])
        assert.equal(SW.strategyFor(O + p, 'GET', O), 'media', p);
    assert.equal(SW.strategyFor(O + '/node_modules/x/archive.zip', 'GET', O), null, 'unknown kinds are left alone');
    assert.ok(SW.MEDIA_MAX >= 100);
    assert.notEqual(SW.PAGES, SW.MEDIA);
});

test('the files a page hands over are filtered the same way, and bounded', () => {
    const list = SW.keepList([O + '/index.html#top', O + '/main.js', O + '/mainimage/gem.png', 'https://www.gstatic.com/x.js', 42, O + '/__net/stream'], O);
    assert.deepEqual(list, [{ url: O + '/index.html', kind: 'network' }, { url: O + '/main.js', kind: 'network' }, { url: O + '/mainimage/gem.png', kind: 'media' }]);
    assert.equal(SW.keepList(Array.from({ length: 1000 }, (_, i) => O + '/a' + i + '.js'), O).length, 300);
    assert.deepEqual(SW.keepList(null, O), []);
});
