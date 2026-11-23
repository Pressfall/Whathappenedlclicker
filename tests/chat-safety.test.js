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

// Reported 2026-11-22 ("my message didn't appear", sending "test" with a chat effect on, on localhost): the player's last
// line in global chat, two days before, was also "test", so the new one folded into it (a "×2" and no new line).
test('a repeat folds only when sent close to the copy before; one said again later, or still sending, gets its own line', () => {
    const DAY = 864e5, now = 1795000000000, get = (r) => ({ name: r.name, message: r.message, t: r.t });
    assert.equal(CS.FOLD_MS, CS.LIMITS.repeatMs, 'the same window the send limiter refuses repeats in');
    const later = CS.collapse([{ name: 'tuff', message: 'test', t: now - 2 * DAY }, { name: 'tuff', message: 'test', t: now }], get);
    assert.deepEqual(later.map(x => [x.repeat, x.item.t]), [[1, now - 2 * DAY], [1, now]], 'two days apart: two lines');
    // a flood folds, however long it goes on, as long as each copy follows the one before closely
    const flood = Array.from({ length: 30 }, (_, i) => ({ name: 'S', message: 'buy now', t: now + i * 5000 }));
    assert.deepEqual(CS.collapse(flood, get).map(x => x.repeat), [30]);
    assert.deepEqual(CS.collapse([{ name: 'A', message: 'hi', t: now }, { name: 'A', message: 'hi', t: now + CS.FOLD_MS + 1 }], get).map(x => x.repeat), [1, 1]);
    // a message just sent has no server time yet (null): it never folds into the line before
    assert.deepEqual(CS.collapse([{ name: 'A', message: 'hi', t: now }, { name: 'A', message: 'hi', t: null }], get).map(x => x.repeat), [1, 1]);
    // both chat pages hand collapse the message's time
    assert.match(read('index.html'), /CHAT_SAFETY\.collapse\(list, d => \(\{ name: d && d\.name, message: d && d\.message, t: chatMillis\(d\) \}\)\)/);
    assert.match(read('clan-page.js'), /CHAT_SAFETY\.collapse\(list, \(m\) => \(\{ name: [^}]*, t: \(m && m\.createdAt && toMillis\(m\.createdAt\)\) \|\| null \}\)\)/);
});

// The other half of the same report: global chat is trimmed to 100 messages, and every view read the OLDEST 100, so in a
// full chat a new message (the sender's own too) stayed off screen until the oldest was deleted, or for good if that failed.
test('global chat views read the newest messages and show them oldest-first', () => {
    const index = read('index.html');
    assert.match(index, /function globalChatQuery\(\)\{ return query\(collection\(db,'global_chat'\), orderBy\('createdAt','desc'\), limit\(100\)\); \}/);
    assert.match(index, /function oldestFirst\(snap\)\{ const out = \[\]; snap\.forEach\(s => out\.push\(s\)\); return out\.reverse\(\); \}/);
    assert.equal((index.match(/onSnapshot\(globalChatQuery\(\)/g) || []).length, 3, 'the quick box, the side panel and the unread badge listen to the newest');
    assert.equal((index.match(/getDocs\(globalChatQuery\(\)\)/g) || []).length, 2, 'both one-off loads read the newest');
    assert.equal((index.match(/oldestFirst\(snap\)\.forEach/g) || []).length, 4, 'every view that draws lines puts them back in time order');
    // only the trim reads the chat oldest-first (to delete the oldest)
    assert.deepEqual(index.match(/orderBy\('createdAt',\s*'asc'\)[^;]*/g), ["orderBy('createdAt','asc'))"]);
    assert.match(index, /const qAll = query\(colRef, orderBy\('createdAt','asc'\)\);/);
});

// Every place a chat message or a chatter's name is put on screen goes through the filter (these pages need Firebase,
// so tests/browser/chat.js checks them working; this keeps a new render path from skipping the filter)
test('every chat render path uses the filter, and nothing reads the setting its own way', () => {
    // the clan page's script is clan-page.js (clan.html loads it)
    const index = read('index.html'), clan = read('clan.html') + read('clan-page.js');
    for (const [name, src] of [['index.html', index], ['clan page', clan]]) {
        assert.ok(src.includes('<script src="core/chat-safety.js"></script>'), name + ' loads the filter');
        assert.deepEqual(src.match(/(escapeHtml|esc)\([^)]*\.message/g) || [], [], name + ': a message shown without the filter');
        assert.deepEqual(src.match(/(escapeHtml|esc)\((nameRaw|name|who|m\.name[^)]*)\)\}?<\/(b|span)>/g) || [], [], name + ': a chatter name shown without the filter');
    }
    assert.ok(/chatName\(who\)/.test(clan) && /chatText\(m\.message\)/.test(clan), 'clan page: names and messages go through the filter');
    assert.equal((index.match(/chatText\(d\.message\)/g) || []).length, 7, 'index.html: 4 global + 3 clan render paths (the clan\'s system lines too)');
    assert.equal((index.match(/chatAllowed\('(global|clan)', txt\)/g) || []).length, 3, 'index.html: every send is limited');
    assert.ok(/chatAllowed\(txt\)/.test(clan), 'clan.html: sending is limited');
    assert.ok(/CS\.display\(l\.m, safe\)/.test(read('world-ui.js')), 'Wilds chat log');
    assert.ok(/text = CS\.display\(text, CS\.isOn\(localStorage\)\)/.test(read('world-actors.js')), 'Wilds speech bubbles (all of them)');
    assert.ok(/chatLimits\.check\(/.test(read('world-online.js')), 'Wilds sending is limited');
    // the setting is only ever read through core/chat-safety.js (so the default is the same everywhere)
    for (const f of ['index.html', 'clan.html', 'clan-page.js', 'main.js', 'world-online.js', 'world-ui.js', 'world-actors.js', 'world.js'])
        assert.ok(!/getItem\(\s*['"]chat_safe_mode['"]\s*\)/.test(read(f)), f + ' reads chat_safe_mode directly');
});

// A message is refused whole if it carries a field the rules don't list, and the page only finds out in a catch: the chat
// effect's `fx` (core/premium.js cf_*) went into both chats but only clan_chat's list, so publishing the draft rules would
// have refused every global message (fx is sent as null without an effect, and a null field is still a field).
test('every field a page writes to a chat is one the chat rules allow, a chat effect\'s fx included', () => {
    const rules = read('firestore-social.rules').replace(/\/\/[^\n]*/g, '');
    const allowed = (col) => {
        const block = rules.slice(rules.indexOf('match /' + col + '/{id} {'));
        const m = /allow create: if validChat\(\[([^\]]*)\]\)/.exec(block);
        assert.ok(m, col + ' has a create rule');
        return m[1].split(',').map((s) => s.trim().replace(/^'|'$/g, ''));
    };
    // the keys of an object literal written out in the source (shorthand `clanId` and `name: x` alike)
    const keysOf = (obj) => {
        let s = obj;
        for (let i = 0; i < 5; i++) s = s.replace(/\([^()]*\)|`[^`]*`|'[^']*'/g, '');
        return s.split(',').map((p) => p.split(':')[0].trim()).filter(Boolean);
    };
    // template strings blanked first: the braces of their ${} aren't the object's
    const code = (f) => read(f).replace(/`(?:\\.|[^`\\])*`/g, '``');
    const writes = { global_chat: [], clan_chat: [] };
    for (const f of ['index.html', 'clan-page.js', 'clan-game.js']) {
        const src = code(f);
        const re = /addDoc\((?:F\.)?collection\((?:F\.)?db,\s*'(global_chat|clan_chat)'\),\s*(?:Object\.assign\()?\{([^{}]*)\}/g;
        for (let m; (m = re.exec(src));) writes[m[1]].push({ f, keys: keysOf(m[2]) });
    }
    assert.equal(writes.global_chat.length, 2, 'index.html: both global chat boxes');
    assert.equal(writes.clan_chat.length, 4, 'index.html side panel, clan page (players and SYSTEM lines), clan-game.js level-ups');
    // the extra fields the clan page adds to its SYSTEM lines
    for (const m of code('clan-page.js').matchAll(/clanSystemMessage\([^;]*?\{([^{}]*)\}\);/g)) writes.clan_chat.push({ f: 'clan-page.js', keys: keysOf(m[1]) });
    for (const col of Object.keys(writes)) {
        const ok = allowed(col);
        for (const w of writes[col]) for (const k of w.keys) assert.ok(ok.includes(k), `${w.f} writes ${col}.${k}, which firestore-social.rules refuses`);
        assert.ok(writes[col].some((w) => w.keys.includes('fx')), col + ': messages carry the sender\'s chat effect');
    }
    // fx is checked the same way in both chats: null, or a short id
    assert.match(rules, /function validChat\(allowed\) \{[\s\S]*?\(!\('fx' in d\) \|\| d\.fx == null \|\| \(d\.fx is string && d\.fx\.size\(\) <= 32\)\)/);
    const longest = Math.max(...require('../core/premium').CATALOG.filter((c) => c.kind === 'chatfx').map((c) => c.id.length));
    assert.ok(longest <= 32, 'every chat effect id fits the rule');
});
