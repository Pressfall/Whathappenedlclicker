'use strict';
// The leaderboard page says plainly what it is: scores are unchecked, "This month" is the UTC calendar month, and a
// name is not an account. Storage and submission are unchanged.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const read = (f) => fs.readFileSync(path.join(__dirname, '..', f), 'utf8');
const html = read('leaderboard.html');
const text = html.replace(/<script[\s\S]*?<\/script>/g, ' ').replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ');

// the explanation function, cut out of the page between its markers
function explainer() {
    const a = html.indexOf('// ---- board explanation');
    const b = html.indexOf('// ---- end board explanation ----');
    assert.ok(a > 0 && b > a, 'markers present');
    const ctx = vm.createContext({});
    vm.runInContext(html.slice(a, b) + '\nthis.boardExplain = boardExplain;', ctx);
    return ctx.boardExplain;
}

test('the warning stays, and the page claims no checking or verification', () => {
    assert.ok(html.includes("Scores are sent from players' own browsers and are not checked, so treat the top of the board as for fun."));
    assert.doesNotMatch(text, /\b(verified|verifies|verify|validated|anti-?cheat|cheat-free|legit(imate)? scores|fair scores|official)\b/i);
    assert.deepEqual(text.match(/\bchecked\b/gi), ['checked'], 'the only "checked" is in "not checked"');
    assert.match(text, /Each name's best submitted score/);
});

test('"This month" names the month, says it is UTC, and when it starts over', () => {
    const explain = explainer();
    const late = explain('monthly', new Date(Date.UTC(2026, 10, 30, 23, 30)));
    assert.match(late, /^This month \(November 2026\): the best score each name has submitted since November 1, 00:00 UTC\. It starts over on December 1, 00:00 UTC \(.+ your time\)\./);
    assert.match(explain('monthly', new Date(Date.UTC(2026, 11, 31, 12))), /\(December 2026\).*starts over on January 1, 00:00 UTC/, 'across the year');
    assert.match(explain('monthly', new Date(Date.UTC(2026, 11, 1, 0, 0, 1))), /\(December 2026\)/, 'just after midnight UTC on the 1st');
    assert.match(late, /not an account/);
    assert.equal(explain('alltime', new Date()), 'All time: the best score each name has ever submitted, from any month. A name is whatever the player typed, not an account, so the board keeps one score per name.');
});

test('the month in the words is the month the board filters on (UTC)', () => {
    assert.match(html, /function isSameMonth\(d1, d2\)\{\s*try\{ return d1\.getUTCFullYear\(\) === d2\.getUTCFullYear\(\) && d1\.getUTCMonth\(\) === d2\.getUTCMonth\(\); \}/);
});

test('the tabs say which one is showing, to screen readers too', () => {
    assert.match(html, /<button id="monthlyTab" data-type="monthly" aria-pressed="true">This month<\/button>/);
    assert.match(html, /<button id="alltimeTab" data-type="alltime" aria-pressed="false">All time<\/button>/);
    assert.match(html, /monthlyTab\.setAttribute\('aria-pressed', String\(t === 'monthly'\)\)/);
});

test('storage and submission are unchanged: two documents per submission, the same query', () => {
    const index = read('index.html');
    assert.ok(index.includes("addDoc(collection(db,'leaderboard'), { name, title, score, type: 'alltime', createdAt: serverTimestamp() })"));
    assert.ok(index.includes("addDoc(collection(db,'leaderboard'), { name, title, score, type: 'monthly', createdAt: serverTimestamp() })"));
    assert.ok(html.includes("const q = query(col, orderBy('score','desc'), limit(500));"));
});

test('the FAQ describes the boards the same way', () => {
    const faq = read('faq.html');
    assert.match(faq, /the month changes at 00:00 UTC/);
    assert.match(faq, /not checked, so treat the board as just for fun/);
});
