'use strict';
// One name for chat and the Wilds (core/names.js, the owner's ask of 2026-11-20): the Wilds' name wins, an automatic Wilds
// name never does, and a chat name that fits fills in.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const N = require('../core/names.js');
const O = require('../core/world-online.js');
const Progress = require('../core/progress.js');

function store(init) {
    const m = new Map(Object.entries(init || {}));
    return { getItem: (k) => (m.has(k) ? m.get(k) : null), setItem: (k, v) => m.set(k, String(v)), get: (k) => m.get(k), m };
}

test('the Wilds\' name wins when the two differ', () => {
    const s = store({ whathappened_world_name: 'Sir Clicks', player_username: 'old chat name' });
    assert.equal(N.sync(s), 'Sir Clicks');
    assert.equal(s.get('player_username'), 'Sir Clicks');
    assert.equal(s.get('whathappened_world_name'), 'Sir Clicks');
});

test('a chat name that fits becomes the Wilds\' name, over an automatic one or none', () => {
    const a = store({ whathappened_world_name: 'Adventurer4821', player_username: 'Bob' });
    assert.equal(N.sync(a), 'Bob');
    assert.equal(a.get('whathappened_world_name'), 'Bob', 'the automatic name never wins');
    const b = store({ player_username: '  Bob  the   Great ' });
    assert.equal(N.sync(b), 'Bob the Great');
    assert.equal(b.get('whathappened_world_name'), 'Bob the Great');
    assert.equal(b.get('player_username'), 'Bob the Great');
});

test('an older chat name that doesn\'t fit the Wilds stays the chat name until a Wilds name comes', () => {
    const s = store({ player_username: 'A really very long chat name!!' });
    assert.equal(N.sync(s), 'A really very long chat name!!');
    assert.equal(s.get('whathappened_world_name'), undefined);
    // an automatic Wilds name with no chat name: both use it
    const t = store({ whathappened_world_name: 'Adventurer1234' });
    assert.equal(N.sync(t), 'Adventurer1234');
    assert.equal(t.get('player_username'), 'Adventurer1234');
    assert.equal(N.sync(store()), '');
});

test('setting the name sets both; the rules are the Wilds\' own', () => {
    const s = store({ whathappened_world_name: 'Old', player_username: 'Old' });
    assert.equal(N.set(s, 'New Name'), 'New Name');
    assert.equal(s.get('whathappened_world_name'), 'New Name');
    assert.equal(s.get('player_username'), 'New Name');
    assert.equal(N.set(s, 'x'), '', 'too short');
    assert.equal(N.set(s, 'way too long for the wilds'), '');
    assert.equal(N.set(s, '<b>hi</b>'), '');
    assert.equal(s.get('player_username'), 'New Name', 'a refused name changes nothing');
    for (const n of ['Bob', 'Sir Clicks', 'a_b.c-d', 'x', 'way too long for the wilds', 'Bad!', '  spaced  out ']) assert.equal(N.clean(n), O.sanitizeName(n), 'same rules as the Wilds: ' + n);
});

test('every page that names you goes through it, and the Wilds\' name syncs with the account', () => {
    const read = (f) => fs.readFileSync(path.join(__dirname, '..', f), 'utf8');
    for (const f of ['index.html', 'world.html', 'clan.html']) assert.match(read(f), /<script src="core\/names\.js"><\/script>/, f + ' loads core/names.js');
    assert.match(read('index.html'), /N\.sync\(localStorage\)/);
    assert.match(read('clan-page.js'), /N\.sync\(localStorage\)/);
    assert.match(read('world-online.js'), /window\.WHNames\.sync\(localStorage\)/);
    assert.match(read('world-online.js'), /setItem\('player_username', s\)/, 'renaming in the Wilds renames chat too');
    assert.equal(Progress.isSyncKey('whathappened_world_name'), true);
    assert.equal(Progress.isSyncKey('player_username'), true);
});
