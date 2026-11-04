'use strict';
// Ads and visit counting only load after the player says yes (core/consent.js), and no page loads them any other way.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const { JSDOM } = require('jsdom');
const Consent = require('../core/consent');

const ROOT = path.join(__dirname, '..');
const PAGE = '<!doctype html><html><head></head><body><div id="adWrapper"><ins class="adsbygoogle"></ins></div><button id="adChoicesBtn"></button><div id="adChoicesStatus"></div></body></html>';

function page(opts = {}) {
    const dom = new JSDOM(opts.html || PAGE, { url: 'https://example.test/', pretendToBeVisual: true });
    const w = dom.window;
    for (const [k, v] of Object.entries(opts.storage || {})) w.localStorage.setItem(k, v);
    const consent = Consent.create({ store: opts.store || w.localStorage, window: w, document: w.document });
    const events = [];
    w.addEventListener('wh:consent', (e) => events.push(e.detail));
    return {
        w, consent, events, doc: w.document, storage: w.localStorage,
        adScripts: () => Array.from(w.document.querySelectorAll('script')).filter((s) => /googlesyndication/.test(s.src)),
        banner: () => w.document.getElementById('whConsent'),
        wrapper: () => w.document.getElementById('adWrapper'),
        click: (value) => w.document.querySelector(`#whConsent [data-consent="${value}"]`).click(),
    };
}

test('with no choice yet: no ad script, no ad space, and a notice with Accept and Decline', () => {
    const p = page();
    p.consent.init();
    assert.equal(p.consent.choice(), null);
    assert.equal(p.adScripts().length, 0);
    assert.equal(p.wrapper().hidden, true);
    assert.ok(p.banner());
    assert.equal(p.doc.querySelectorAll('#whConsent .wh-consent-actions button').length, 2, 'Decline and Accept side by side');
    assert.match(p.banner().textContent, /Google AdSense/);
    assert.match(p.banner().textContent, /Google Analytics/);
    assert.match(p.banner().textContent, /only load if you accept/);
    assert.equal(p.banner().getAttribute('role'), 'dialog');
});

test('Accept and Decline are the same size and style', () => {
    const p = page();
    p.consent.init();
    const [a, b] = p.doc.querySelectorAll('#whConsent .wh-consent-actions button');
    assert.equal(a.className, b.className);
});

test('Accept loads AdSense once, shows the ad space, fills the slot and tells the page', () => {
    const p = page();
    p.consent.init();
    p.click('granted');
    assert.equal(p.consent.choice(), 'granted');
    assert.equal(p.storage.getItem('wh_ad_consent'), 'granted');
    assert.equal(p.adScripts().length, 1);
    assert.equal(p.adScripts()[0].src, Consent.ADSENSE_SRC);
    assert.match(p.adScripts()[0].src, /client=ca-pub-7259344384263515/);
    assert.equal(p.wrapper().hidden, false);
    assert.equal(p.w.adsbygoogle.length, 1, 'the slot was queued for filling');
    assert.equal(p.banner(), null);
    assert.deepEqual(p.events, ['granted']);
    p.consent.apply();
    p.consent.apply();
    assert.equal(p.adScripts().length, 1, 'applying again adds no second script');
    assert.equal(p.w.adsbygoogle.length, 1, 'and does not fill the slot twice');
});

test('Decline loads nothing, reserves no ad space, and remembers', () => {
    const p = page();
    p.consent.init();
    p.click('denied');
    assert.equal(p.consent.choice(), 'denied');
    assert.equal(p.adScripts().length, 0);
    assert.equal(p.wrapper().hidden, true);
    assert.equal(p.banner(), null);
    assert.deepEqual(p.events, ['denied']);
    assert.equal(p.w.adsbygoogle, undefined);
});

test('a returning player who accepted gets ads without being asked again', () => {
    const p = page({ storage: { wh_ad_consent: 'granted' } });
    p.consent.init();
    assert.equal(p.banner(), null);
    assert.equal(p.adScripts().length, 1);
    assert.equal(p.wrapper().hidden, false);
});

test('a returning player who declined gets nothing and is not asked again', () => {
    const p = page({ storage: { wh_ad_consent: 'denied' } });
    p.consent.init();
    assert.equal(p.banner(), null);
    assert.equal(p.adScripts().length, 0);
    assert.equal(p.wrapper().hidden, true);
});

test('the old notice\'s "accepted" still counts, but an explicit decline overrides it', () => {
    const old = page({ storage: { wh_cookie_consent: 'accepted' } });
    old.consent.init();
    assert.equal(old.consent.choice(), 'granted');
    assert.equal(old.adScripts().length, 1);
    const both = page({ storage: { wh_cookie_consent: 'accepted', wh_ad_consent: 'denied' } });
    both.consent.init();
    assert.equal(both.consent.choice(), 'denied');
    assert.equal(both.adScripts().length, 0);
});

test('junk in storage counts as no choice', () => {
    for (const junk of ['yes', 'GRANTED', '', '1', 'true']) {
        const p = page({ storage: { wh_ad_consent: junk } });
        p.consent.init();
        assert.equal(p.consent.choice(), null, junk);
        assert.equal(p.adScripts().length, 0, junk);
        assert.ok(p.banner(), junk);
    }
});

test('the choice can be changed later from the Settings button, and the status text follows', () => {
    const p = page({ storage: { wh_ad_consent: 'granted' } });
    p.consent.init();
    assert.match(p.doc.getElementById('adChoicesStatus').textContent, /are on/);
    p.doc.getElementById('adChoicesBtn').click();
    assert.ok(p.banner(), 'the notice opens again');
    p.click('denied');
    assert.equal(p.consent.choice(), 'denied');
    assert.equal(p.wrapper().hidden, true);
    assert.match(p.doc.getElementById('adChoicesStatus').textContent, /go away when you reload/);
});

test('withdrawing consent stops Analytics too: the page is told', () => {
    const p = page({ storage: { wh_ad_consent: 'granted' } });
    p.consent.init();
    p.doc.getElementById('adChoicesBtn').click();
    p.click('denied');
    assert.deepEqual(p.events, ['denied']);
    assert.equal(p.consent.allowed(), false);
});

test('a page without Settings gets a small "Ad & cookie choices" link', () => {
    const p = page({ html: '<!doctype html><html><head></head><body><p>hi</p></body></html>' });
    p.consent.init();
    const link = p.doc.getElementById('whConsentLink');
    assert.ok(link);
    p.click('denied');
    link.click();
    assert.ok(p.banner(), 'the link reopens the notice');
});

test('a page that already has the Settings button gets no extra link', () => {
    const p = page();
    p.consent.init();
    assert.equal(p.doc.getElementById('whConsentLink'), null);
});

test('a page without an ad slot still loads the script after Accept (for Auto ads)', () => {
    const p = page({ html: '<!doctype html><html><head></head><body></body></html>' });
    p.consent.init();
    p.click('granted');
    assert.equal(p.adScripts().length, 1);
});

test('blocked storage: the choice lasts for the page and the notice does not come straight back', () => {
    const blocked = { getItem() { throw new Error('blocked'); }, setItem() { throw new Error('blocked'); } };
    const p = page({ store: blocked });
    p.consent.init();
    assert.ok(p.banner());
    p.click('granted');
    assert.equal(p.consent.choice(), 'granted');
    assert.equal(p.adScripts().length, 1);
    assert.equal(p.banner(), null);
});

test('only "granted" and "denied" can be stored', () => {
    const p = page();
    assert.throws(() => p.consent.set('maybe'));
    assert.equal(p.consent.choice(), null);
});

test('Accept and Decline answer both; each is stored under its own key', () => {
    const p = page();
    p.consent.init();
    p.click('granted');
    assert.equal(p.storage.getItem('wh_ad_consent'), 'granted');
    assert.equal(p.storage.getItem('wh_analytics_consent'), 'granted');
    assert.equal(p.consent.analyticsAllowed(), true);
    const d = page();
    d.consent.init();
    d.click('denied');
    assert.equal(d.storage.getItem('wh_analytics_consent'), 'denied');
    assert.equal(d.consent.analyticsAllowed(), false);
});

test('Choose: one tick box per purpose, nothing ticked in advance, and ads can be allowed without visit counting', () => {
    const p = page();
    p.consent.init();
    const pick = p.doc.getElementById('whConsentPick');
    assert.equal(pick.hidden, true, 'closed until asked for');
    p.doc.querySelector('#whConsent .wh-consent-more').click();
    assert.equal(pick.hidden, false);
    const boxes = [...pick.querySelectorAll('input[type=checkbox]')];
    assert.deepEqual(boxes.map((b) => [b.dataset.purpose, b.checked]), [['ads', false], ['analytics', false]], 'not pre-ticked');
    boxes[0].checked = true;
    p.click('save');
    assert.equal(p.consent.choice(), 'granted');
    assert.equal(p.consent.analyticsChoice(), 'denied');
    assert.equal(p.adScripts().length, 1, 'ads load');
    assert.equal(p.consent.analyticsAllowed(), false, 'visit counting does not');
    assert.equal(p.banner(), null);
    assert.match(p.doc.getElementById('adChoicesStatus').textContent, /Ads are on and visit counting is off/);
});

test('visit counting can be allowed without ads: no ad script and no ad space', () => {
    const p = page();
    p.consent.init();
    p.doc.querySelector('#whConsent .wh-consent-more').click();
    p.doc.querySelector('#whConsentPick [data-purpose=analytics]').checked = true;
    p.click('save');
    assert.equal(p.consent.analyticsAllowed(), true);
    assert.equal(p.consent.allowed(), false);
    assert.equal(p.adScripts().length, 0);
    assert.equal(p.wrapper().hidden, true);
    assert.deepEqual(p.events, ['denied'], 'the event says what happened to ads; the page asks analyticsAllowed() itself');
});

test('reopening the choices shows what was chosen, and withdrawing only visit counting keeps the ads', () => {
    const p = page({ storage: { wh_ad_consent: 'granted', wh_analytics_consent: 'granted' } });
    p.consent.init();
    p.doc.getElementById('adChoicesBtn').click();
    const boxes = [...p.doc.querySelectorAll('#whConsentPick input')];
    assert.deepEqual(boxes.map((b) => b.checked), [true, true]);
    boxes[1].checked = false;
    p.click('save');
    assert.equal(p.consent.allowed(), true);
    assert.equal(p.consent.analyticsAllowed(), false);
    assert.equal(p.adScripts().length, 1);
    assert.match(p.doc.getElementById('adChoicesStatus').textContent, /visit counting is off/);
});

test('one answer from before the choices were separate still counts for both, and nobody is asked again', () => {
    for (const v of ['granted', 'denied']) {
        const p = page({ storage: { wh_ad_consent: v } });
        p.consent.init();
        assert.equal(p.consent.analyticsChoice(), v, v);
        assert.equal(p.banner(), null, v);
    }
});

test('the oldest notice never mentioned visit counting: it counts for ads only, and the player is asked', () => {
    const p = page({ storage: { wh_cookie_consent: 'accepted' } });
    p.consent.init();
    assert.equal(p.consent.allowed(), true, 'ads, as before');
    assert.equal(p.adScripts().length, 1);
    assert.equal(p.consent.analyticsChoice(), null);
    assert.equal(p.consent.analyticsAllowed(), false, 'no Analytics without asking');
    assert.ok(p.banner(), 'asked once');
});

test('the notice tells visitors where Google may ask again', () => {
    const p = page();
    p.consent.init();
    assert.match(p.banner().textContent, /allow one without the other/);
    assert.match(p.banner().textContent, /EEA, the UK or Switzerland, Google may then ask you/);
});

test('the game page fills its slot with the same publisher as the AdSense script, and hides a slot left unfilled', () => {
    const html = read('index.html');
    const ins = html.slice(html.indexOf('<ins class="adsbygoogle"'), html.indexOf('</ins>'));
    const client = Consent.ADSENSE_SRC.match(/client=(ca-pub-\d+)/)[1];
    assert.ok(ins.includes(`data-ad-client="${client}"`), 'data-ad-client matches');
    assert.ok(ins.includes('data-ad-slot="1234567890"'), 'the slot id is still the placeholder to replace');
    assert.match(fs.readFileSync(path.join(ROOT, 'styles.css'), 'utf8'), /ins\.adsbygoogle\[data-ad-status="unfilled"\] \{ display: none !important; \}/);
});

test('the notice is built from text nodes, not markup', () => {
    const p = page();
    p.consent.init();
    assert.equal(p.banner().querySelectorAll('script, img, iframe').length, 0);
});

// ----- every page, as shipped -----
const pages = fs.readdirSync(ROOT).filter((f) => f.endsWith('.html'));
const read = (f) => fs.readFileSync(path.join(ROOT, f), 'utf8');

test('no page loads Google AdSense by itself: only core/consent.js does, after consent', () => {
    for (const f of pages) assert.doesNotMatch(read(f), /googlesyndication\.com\/pagead\/js\/adsbygoogle\.js/, f);
    assert.match(fs.readFileSync(path.join(ROOT, 'core', 'consent.js'), 'utf8'), /pagead2\.googlesyndication\.com\/pagead\/js\/adsbygoogle\.js/);
});

test('every page that showed ads, and the privacy page, loads the consent code', () => {
    for (const f of ['index.html', 'achievements.html', 'gamba.html', 'leaderboard.html', 'privacy.html']) {
        assert.match(read(f), /<script src="core\/consent\.js"><\/script>/, f);
        assert.match(read(f), /href="consent\.css"/, f);
    }
});

test('the game page does not start Google Analytics without consent', () => {
    const html = read('index.html');
    assert.doesNotMatch(html, /import \{ getAnalytics \}/, 'no static import: that would load the module for everyone');
    const first = html.indexOf('firebase-analytics.js');
    const gate = html.indexOf('WHConsent.analyticsAllowed()');
    assert.ok(first > 0 && gate > 0);
    assert.equal((html.match(/firebase-analytics\.js/g) || []).length, 1, 'loaded in one place only');
    const fn = html.slice(html.indexOf('function startAnalytics'), html.indexOf('window.addEventListener(\'wh:consent\''));
    assert.match(fn, /import\("https:\/\/www\.gstatic\.com\/firebasejs\/[\d.]+\/firebase-analytics\.js"\)/);
});

test('the ad slot on the game page starts hidden', () => {
    assert.match(read('index.html'), /<div id="adWrapper"[^>]*\bhidden\b/);
});

test('no page keeps the old notice or its code', () => {
    for (const f of pages) assert.doesNotMatch(read(f), /cookie-consent-banner/, f);
    assert.doesNotMatch(read('main.js'), /initCookieConsent|acceptCookies/);
});

test('the privacy policy describes what the code does', () => {
    const text = read('privacy.html').replace(/<[^>]+>/g, ' ').replace(/&amp;/g, '&').replace(/\s+/g, ' ');
    assert.match(text, /Google Analytics/);
    assert.match(text, /loaded only (if|after) you (choose Accept|accept)/i);
    assert.match(text, /Neither is loaded until you choose Accept/);
    assert.match(text, /Decline/);
    assert.match(text, /Ad & cookie choices/);
    assert.match(text, /ca-pub-7259344384263515/);
});
