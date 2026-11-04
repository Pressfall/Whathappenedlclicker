const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');

const CS = require('../core/chat-safety');
const O = require('../core/world-online');

const store = (init = {}) => { const m = new Map(Object.entries(init)); return { getItem: (k) => (m.has(k) ? m.get(k) : null), setItem: (k, v) => m.set(k, String(v)), m }; };
const read = (f) => fs.readFileSync(path.join(__dirname, '..', f), 'utf8');

test('the swear filter is on for a new visitor, and a deliberate choice is kept', () => {
    assert.equal(CS.isOn(store()), true, 'unset: on');
    assert.equal(CS.isOn(store({ chat_safe_mode: '1' })), true);
    assert.equal(CS.isOn(store({ chat_safe_mode: '0' })), false, 'turned off before: stays off');
    const s = store();
    CS.isOn(s);
    assert.equal(s.m.size, 0, 'reading the setting writes nothing');
    CS.setOn(s, false);
    assert.equal(s.getItem('chat_safe_mode'), '0');
    assert.equal(CS.isOn(s), false);
    CS.setOn(s, true);
    assert.equal(s.getItem('chat_safe_mode'), '1');
    assert.equal(CS.isOn({ getItem() { throw new Error('blocked'); } }), true, 'storage unavailable: on');
    assert.equal(CS.KEY, 'chat_safe_mode', 'the same localStorage key as before');
});

test('what a message shows: swear words hidden when on, walls squashed always, nothing else changed', () => {
    assert.equal(CS.display('what the hell, SHITTY boss', true), 'what the ***, *** boss');
    assert.equal(CS.display('what the hell', false), 'what the hell');
    assert.equal(CS.display('hello shell, class assignment', true), 'hello shell, class assignment', 'whole words only');
    assert.equal(CS.display('a'.repeat(50), false), 'aaa…');
    assert.equal(CS.display('lol'.repeat(20) + '!', true), 'lollollol…!');
    assert.equal(CS.display('🔥'.repeat(12), false), '🔥🔥🔥…');
    for (const ok of ['gg wp', 'I have 1,000,000 clicks', 'level 1000000', 'aaaaaaa', '!!!', 'hahahaha'])
        assert.equal(CS.display(ok, true), ok, ok);
    assert.equal(CS.display(null, true), '');
    assert.equal(O.censor('what the hell'), CS.censor('what the hell'), 'the Wilds uses the same filter');
    assert.equal(O.SAFE_WORDS, CS.WORDS);
});

test('send limits: a short gap, a burst cap, no repeating yourself; channels apart; a failed send is taken back', () => {
    const L = CS.limiter(), G = CS.LIMITS;
    let t = 1e6;
    assert.equal(L.check('global', 'hi', t).ok, true);
    L.note('global', 'hi', t);
    assert.equal(L.check('global', 'other', t + 200).reason, 'fast');
    assert.equal(L.check('clan', 'hi', t + 200).ok, true, 'another channel has its own limits');
    t += G.gapMs;
    assert.equal(L.check('global', '  HI ', t).reason, 'repeat', 'case and spacing do not make it new');
    assert.equal(L.check('global', 'hi there', t).ok, true);
    assert.equal(L.check('global', 'hi', 1e6 + G.repeatMs + 1).ok, true, 'the same line is fine again a minute later');
    // a burst: at most G.burst messages in G.burstMs
    const B = CS.limiter();
    for (let i = 0; i < G.burst; i++) { const r = B.check('g', 'm' + i, i * G.gapMs); assert.equal(r.ok, true, 'msg ' + i); B.note('g', 'm' + i, i * G.gapMs); }
    const blocked = B.check('g', 'one more', G.burst * G.gapMs);
    assert.equal(blocked.reason, 'burst');
    assert.ok(blocked.waitMs > 0 && blocked.message);
    assert.equal(B.check('g', 'one more', G.burstMs + 1).ok, true, 'and it lets up');
    // a send that failed doesn't count
    const U = CS.limiter();
    U.note('g', 'lost', 0); U.undo('g');
    assert.equal(U.check('g', 'lost', 10).ok, true);
});

test('repeats in a row from one sender show once with a count; the newest copy is kept', () => {
    const rows = [{ name: 'A', message: 'spam', t: 1 }, { name: 'A', message: 'SPAM ', t: 2 }, { name: 'A', message: 'spam', t: 3 },
        { name: 'B', message: 'spam', t: 4 }, { name: 'A', message: 'spam', t: 5 }, { name: 'A', message: 'hi', t: 6 }];
    const out = CS.collapse(rows);
    assert.deepEqual(out.map(x => [x.item.name, x.repeat, x.item.t]), [['A', 3, 3], ['B', 1, 4], ['A', 1, 5], ['A', 1, 6]]);
    assert.deepEqual(CS.collapse([]), []);
    assert.deepEqual(CS.collapse(rows, r => ({ name: 'same', message: 'same' })).map(x => x.repeat), [6]);
});

// Every place a chat message or a chatter's name is put on screen goes through the filter (these pages need Firebase,
// so tests/browser/chat.js checks them working; this keeps a new render path from skipping the filter)
test('every chat render path uses the filter, and nothing reads the setting its own way', () => {
    const index = read('index.html'), clan = read('clan.html');
    for (const [name, src] of [['index.html', index], ['clan.html', clan]]) {
        assert.ok(src.includes('<script src="core/chat-safety.js"></script>'), name + ' loads the filter');
        assert.deepEqual(src.match(/escapeHtml\([^)]*\.message/g) || [], [], name + ': a message shown without the filter');
        assert.deepEqual(src.match(/escapeHtml\((nameRaw|name|m\.name[^)]*)\)\}?<\/(b|span)>/g) || [], [], name + ': a chatter name shown without the filter');
    }
    assert.equal((index.match(/chatText\(d\.message\)/g) || []).length, 6, 'index.html: 4 global + 2 clan render paths');
    assert.equal((index.match(/chatAllowed\('(global|clan)', txt\)/g) || []).length, 3, 'index.html: every send is limited');
    assert.ok(/chatAllowed\(txt\)/.test(clan), 'clan.html: sending is limited');
    assert.ok(/CS\.display\(l\.m, safe\)/.test(read('world-ui.js')), 'Wilds chat log');
    assert.ok(/text = CS\.display\(text, CS\.isOn\(localStorage\)\)/.test(read('world-actors.js')), 'Wilds speech bubbles (all of them)');
    assert.ok(/chatLimits\.check\(/.test(read('world-online.js')), 'Wilds sending is limited');
    // the setting is only ever read through core/chat-safety.js (so the default is the same everywhere)
    for (const f of ['index.html', 'clan.html', 'main.js', 'world-online.js', 'world-ui.js', 'world-actors.js', 'world.js'])
        assert.ok(!/getItem\(\s*['"]chat_safe_mode['"]\s*\)/.test(read(f)), f + ' reads chat_safe_mode directly');
});
