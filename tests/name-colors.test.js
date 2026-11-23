// The colour your name shows in chat (core/name-colors.js; the owner's ask 2026-11-22): chosen in Settings > Profile, sent
// with each global and clan chat message as nameColor, shown to everyone, and never more than a palette colour.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const NC = require('../core/name-colors');
const { loadGame } = require('./helpers/game-harness');

const read = (f) => fs.readFileSync(path.join(__dirname, '..', f), 'utf8');
const store = (init = {}) => {
    const m = new Map(Object.entries(init));
    return { getItem: (k) => (m.has(k) ? m.get(k) : null), setItem: (k, v) => m.set(k, String(v)), removeItem: (k) => m.delete(k), m };
};
// WCAG contrast of a #rrggbb colour against another
const lum = (hex) => {
    const c = [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16) / 255).map((v) => (v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4));
    return 0.2126 * c[0] + 0.7152 * c[1] + 0.0722 * c[2];
};
const contrast = (a, b) => { const [x, y] = [lum(a), lum(b)].sort((p, q) => q - p); return (x + 0.05) / (y + 0.05); };

test('the palette: unique ids, plain colours, all easy to read on the chats\' dark backgrounds, the old blue first', () => {
    assert.ok(NC.COLORS.length >= 8);
    assert.equal(new Set(NC.COLORS.map((c) => c.id)).size, NC.COLORS.length);
    assert.equal(NC.COLORS[0].id, NC.DEFAULT);
    assert.equal(NC.hexOf(NC.DEFAULT), '#99ccff', 'the default is the blue every name had (#9cf)');
    for (const c of NC.COLORS) {
        assert.match(c.id, /^[a-z]{2,16}$/, c.id + ' fits the rules (string, at most 16)');
        assert.match(c.hex, /^#[0-9a-f]{6}$/);
        assert.ok(c.name && c.name.length <= 16);
        // the side panel's log (#0b0d13 under rgba(0,0,0,0.3)) and the clan page's cards (about #1a2058 at the lightest theme)
        for (const bg of ['#0b0d13', '#1a2058']) assert.ok(contrast(c.hex, bg) >= 4.5, `${c.id} on ${bg}: ${contrast(c.hex, bg).toFixed(2)}`);
    }
});

test('only a palette id ever becomes a colour: anything a message carries otherwise shows the default', () => {
    const def = NC.hexOf(NC.DEFAULT);
    assert.equal(NC.hexOf('gold'), '#ffd76a');
    for (const bad of [undefined, null, '', 'GOLD', 'nope', '#ff0000', 'red;background:url(x)', 'red" onmouseover="x', 'constructor', '__proto__', 'toString', 5, {}, ['gold']]) {
        assert.equal(NC.clean(bad), '', JSON.stringify(bad));
        assert.equal(NC.hexOf(bad), def, JSON.stringify(bad));
    }
});

test('the choice is kept on the device (the default as nothing), and a message carries it, or null for the default', () => {
    const s = store();
    assert.equal(NC.get(s), 'sky');
    assert.equal(NC.forMessage(s), null);
    assert.equal(NC.set(s, 'violet'), 'violet');
    assert.equal(s.getItem(NC.KEY), 'violet');
    assert.equal(NC.forMessage(s), 'violet');
    assert.equal(NC.set(s, 'not-a-colour'), 'sky', 'an unknown choice falls back to the default');
    assert.equal(s.m.has(NC.KEY), false, 'the default is stored as nothing');
    assert.equal(NC.get(store({ [NC.KEY]: 'junk' })), 'sky', 'a stored value that is not a palette id reads as the default');
    assert.equal(NC.get({ getItem() { throw new Error('blocked'); } }), 'sky');
    // it travels with the cloud save, like the title
    assert.ok(require('../core/progress').SYNC_KEYS.has(NC.KEY));
});

test('Settings > Profile: pick a colour, see it, keep it; the default again clears it', () => {
    const game = loadGame({ noRenown: true, storage: { player_username: 'Tuff' } });
    const doc = game.window.document;
    const swatches = () => [...doc.querySelectorAll('#nameColorPicker .name-color-swatch')];
    assert.equal(swatches().length, NC.COLORS.length, 'one swatch per colour');
    assert.deepEqual(swatches().map((b) => b.getAttribute('aria-label')), NC.COLORS.map((c) => c.name));
    const on = () => swatches().filter((b) => b.getAttribute('aria-pressed') === 'true').map((b) => b.dataset.nameColor);
    assert.deepEqual(on(), ['sky']);
    assert.equal(doc.getElementById('nameColorValue').textContent, 'Sky');
    swatches().find((b) => b.dataset.nameColor === 'gold').click();
    assert.equal(game.storage.getItem(NC.KEY), 'gold');
    assert.deepEqual(on(), ['gold']);
    assert.equal(doc.getElementById('nameColorValue').textContent, 'Gold');
    const who = doc.querySelector('#nameColorPreview b');
    assert.equal(who.textContent, 'Tuff', 'the preview uses the chat name');
    assert.equal(who.style.color, 'rgb(255, 215, 106)');
    // kept across a reload
    const again = game.reload();
    assert.deepEqual([...again.window.document.querySelectorAll('#nameColorPicker [aria-pressed="true"]')].map((b) => b.dataset.nameColor), ['gold']);
    again.window.document.querySelector('#nameColorPicker [data-name-color="sky"]').click();
    assert.equal(again.storage.getItem(NC.KEY), null);
    // a name typed into the page is text, never markup
    const odd = loadGame({ noRenown: true, storage: { player_username: '<img src=x onerror=alert(1)>' } });
    assert.equal(odd.window.document.querySelector('#nameColorPreview img'), null);
});

test('every chat sends the sender\'s colour and draws each name in the colour its message carries', () => {
    const index = read('index.html'), clanPage = read('clan-page.js');
    for (const [name, src] of [['index.html', index], ['clan.html', read('clan.html')]])
        assert.ok(src.includes('<script src="core/name-colors.js"></script>'), name + ' loads the palette');
    assert.ok(index.indexOf('core/name-colors.js') < index.indexOf('<script src="main.js">'), 'before main.js (Settings)');
    // sending: both global chat boxes and the side panel's clan chat; the clan page
    assert.equal((index.match(/fx: myChatFx\(\), nameColor: myNameColor\(\), createdAt: serverTimestamp\(\)/g) || []).length, 3);
    assert.match(index, /function myNameColor\(\)\{ try\{ return window\.WHNameColors\.forMessage\(localStorage\); \}/);
    assert.match(clanPage, /fx: myChatFx\(\), nameColor: myNameColor\(\), createdAt: serverTimestamp\(\)/);
    // showing: every name in index.html's chats (4 global views and 2 clan ones), from the palette only
    assert.equal((index.match(/<span style="color:\$\{chatNameColor\(d\)\};font-weight:700">/g) || []).length, 6);
    assert.doesNotMatch(index, /color:#9cf;font-weight:700/, 'no name left in the fixed blue');
    assert.match(index, /function chatNameColor\(d\)\{ try\{ return window\.WHNameColors\.hexOf\(d && d\.nameColor\); \}/);
    // the clan page: messages and pinned ones; no colour chosen keeps the page's own (gold for your own messages)
    assert.equal((clanPage.match(/<b\$\{nameColorAttr\(m\)\}>\$\{chatName\(/g) || []).length, 2);
    assert.match(clanPage, /const NC = window\.WHNameColors, id = NC\.clean\(m && m\.nameColor\); return id \? ` style="color:\$\{NC\.hexOf\(id\)\}"` : ''/);
});
