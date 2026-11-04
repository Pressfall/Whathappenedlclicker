/**
 * Consent for ads and measurement. Nothing from Google AdSense or Google Analytics loads until the player says yes, and
 * each can be allowed on its own:
 *  - no choice yet  -> no ads, no analytics, and a notice: Decline / Accept of equal weight, and Choose for one of the two;
 *  - ads "granted"  -> AdSense is loaded and the ad slot shown;
 *  - visit counting "granted" -> Analytics starts (the page listens for the wh:consent event and asks analyticsAllowed());
 *  - "denied"       -> that one never loads, and no ad space is reserved.
 * Nothing is ticked in advance. The choices are kept in this browser (localStorage "wh_ad_consent" for ads,
 * "wh_analytics_consent" for visit counting) and can be changed any time from Settings > Ad & cookie choices, or the link
 * at the bottom of the other pages. Before the two were separate, one Accept/Decline in this notice answered both, so a
 * stored "wh_ad_consent" with no "wh_analytics_consent" still counts for both. The older notice stored
 * "wh_cookie_consent = accepted" after an explicit click on text that mentioned third-party ads and cookies but not visit
 * counting: it still counts for ads only, and those players are asked about visit counting.
 *
 * The game save is not covered by this: it is stored in the browser because the game cannot work without it.
 *
 * Works in a browser (<script src="core/consent.js"> starts it, window.WHConsent) and in Node (require, then create()).
 * Note for the site owner: this is a simple notice, not a Google-certified CMP. For visitors in the EEA, UK and
 * Switzerland Google requires its own certified consent message (AdSense > Privacy & messaging) before it will serve ads.
 * That message is shown by the AdSense code, which loads only after ads are accepted here, so those visitors are asked
 * here first and by Google second (the notice tells them so). Strict opt-in everywhere is kept on purpose: see README.
 */
(function (root, factory) {
    const api = factory();
    if (typeof module === 'object' && module.exports) module.exports = api;
    else {
        root.WHConsent = api.start(root);
    }
}(typeof self !== 'undefined' ? self : this, function () {
    'use strict';

    const KEY = 'wh_ad_consent';
    const ANALYTICS_KEY = 'wh_analytics_consent';
    const LEGACY_KEY = 'wh_cookie_consent';
    const ADSENSE_SRC = 'https://pagead2.googlesyndication.com/pagead/js/adsbygoogle.js?client=ca-pub-7259344384263515';
    const VALID = (v) => v === 'granted' || v === 'denied';

    function create({ store, window: win, document: doc }) {
        let adsLoaded = false;
        // the choices for this page only, when the browser blocks storage
        let memory = null, memoryAnalytics = null;

        // ads: 'granted', 'denied' or null (not chosen yet)
        function choice() {
            if (memory) return memory; // set only when storage refused the newest choice, so it wins
            try {
                const v = store.getItem(KEY);
                if (VALID(v)) return v;
                if (store.getItem(LEGACY_KEY) === 'accepted') return 'granted';
            } catch (e) { /* storage unreadable: no saved choice */ }
            return null;
        }
        // visit counting: 'granted', 'denied' or null
        function analyticsChoice() {
            if (memoryAnalytics) return memoryAnalytics;
            try {
                const v = store.getItem(ANALYTICS_KEY);
                if (VALID(v)) return v;
                // the one Accept/Decline this notice had before the choices were separate answered both
                const a = store.getItem(KEY);
                if (VALID(a)) return a;
            } catch (e) { /* storage unreadable: no saved choice */ }
            return null;
        }
        const allowed = () => choice() === 'granted';
        const analyticsAllowed = () => analyticsChoice() === 'granted';
        const needsChoice = () => !choice() || !analyticsChoice();

        function loadAds() {
            if (adsLoaded || !doc || !doc.head) return;
            adsLoaded = true;
            const s = doc.createElement('script');
            s.async = true;
            s.crossOrigin = 'anonymous';
            s.src = ADSENSE_SRC;
            doc.head.appendChild(s);
        }
        // ask AdSense to fill each ad slot once
        function fillSlots() {
            if (!doc) return;
            doc.querySelectorAll('ins.adsbygoogle').forEach((ins) => {
                if (ins.dataset.whFilled) return;
                ins.dataset.whFilled = '1';
                try { (win.adsbygoogle = win.adsbygoogle || []).push({}); } catch (e) {}
            });
        }
        function statusText() {
            const a = choice(), m = analyticsChoice();
            if (!a && !m) return 'You have not chosen yet, so no ads or visit counting are loaded.';
            if (a === 'granted' && m === 'granted') return 'Ads and visit counting are on. Choose Decline to turn them off.';
            if (a !== 'granted' && m !== 'granted') return 'Ads and visit counting are off. Nothing from Google is loaded.';
            return (a === 'granted' ? 'Ads are on' : 'Ads are off') + ' and ' + (m === 'granted' ? 'visit counting is on.' : 'visit counting is off.');
        }
        function updateStatus() {
            const el = doc && doc.getElementById('adChoicesStatus');
            if (el) el.textContent = statusText();
        }

        // make the page match the choice
        function apply() {
            if (!doc) return;
            const wrapper = doc.getElementById('adWrapper');
            if (allowed()) {
                if (wrapper) wrapper.hidden = false; // shown before filling: AdSense needs the slot's width
                loadAds();
                fillSlots();
            } else if (wrapper) {
                wrapper.hidden = true; // no empty ad space for someone who has not agreed to ads
            }
            updateStatus();
        }

        // ads and visit counting; one value sets both (Accept / Decline)
        function set(ads, analytics = ads) {
            if (!VALID(ads) || !VALID(analytics)) throw new Error('consent must be "granted" or "denied"');
            const before = choice(), beforeAnalytics = analyticsChoice();
            try { store.setItem(KEY, ads); } catch (e) { memory = ads; }
            try { store.setItem(ANALYTICS_KEY, analytics); } catch (e) { memoryAnalytics = analytics; }
            hideBanner();
            apply();
            try { win.dispatchEvent(new win.CustomEvent('wh:consent', { detail: ads })); } catch (e) {}
            const withdrew = (before === 'granted' && ads === 'denied') || (beforeAnalytics === 'granted' && analytics === 'denied');
            if (withdrew) {
                const el = doc.getElementById('adChoicesStatus');
                if (el) el.textContent = statusText() + (before === 'granted' && ads === 'denied' ? ' Ads already on this page go away when you reload it.' : '');
            }
        }

        // ---------- the notice ----------
        function hideBanner() {
            const b = doc && doc.getElementById('whConsent');
            if (b) b.remove();
        }
        function showBanner() {
            if (!doc || !doc.body || doc.getElementById('whConsent')) return;
            const el = (tag, attrs, text) => {
                const n = doc.createElement(tag);
                for (const k in attrs || {}) n.setAttribute(k, attrs[k]);
                if (text) n.textContent = text;
                return n;
            };
            const box = el('div', { id: 'whConsent', class: 'wh-consent', role: 'dialog', 'aria-labelledby': 'whConsentTitle', 'aria-describedby': 'whConsentText' });
            const inner = el('div', { class: 'wh-consent-inner' });
            const copy = el('div', { class: 'wh-consent-copy' });
            copy.appendChild(el('strong', { id: 'whConsentTitle' }, 'Ads and visit counting'));
            const p = el('p', { id: 'whConsentText' }, 'This site shows ads from Google AdSense and counts visits with Google Analytics. Both use cookies or similar technology, and the ads can be personalized. They only load if you accept, and you can allow one without the other. Your game save stays in your browser either way: the game needs it. If you allow ads and you are in the EEA, the UK or Switzerland, Google may then ask you about them in its own window. ');
            const link = el('a', { href: 'privacy.html', target: '_blank', rel: 'noopener' }, 'Privacy policy');
            p.appendChild(link);
            copy.appendChild(p);
            // Choose: one tick box per purpose, never ticked in advance (showing what was chosen before, if anything)
            const more = el('button', { type: 'button', class: 'wh-consent-more', 'aria-expanded': 'false', 'aria-controls': 'whConsentPick' }, 'Choose');
            const pick = el('div', { id: 'whConsentPick', class: 'wh-consent-pick' });
            pick.hidden = true;
            const box1 = (purpose, label, on) => {
                const l = el('label', { class: 'wh-consent-check' });
                const c = el('input', { type: 'checkbox', 'data-purpose': purpose });
                c.checked = on;
                l.appendChild(c);
                l.appendChild(doc.createTextNode(' ' + label));
                return l;
            };
            pick.appendChild(box1('ads', 'Ads (Google AdSense)', allowed()));
            pick.appendChild(box1('analytics', 'Visit counting (Google Analytics)', analyticsAllowed()));
            const save = el('button', { type: 'button', class: 'wh-consent-btn', 'data-consent': 'save' }, 'Save choices');
            save.addEventListener('click', () => {
                const on = (k) => (pick.querySelector(`[data-purpose="${k}"]`).checked ? 'granted' : 'denied');
                set(on('ads'), on('analytics'));
            });
            pick.appendChild(save);
            more.addEventListener('click', () => {
                pick.hidden = !pick.hidden;
                more.setAttribute('aria-expanded', String(!pick.hidden));
            });
            copy.appendChild(more);
            copy.appendChild(pick);
            const actions = el('div', { class: 'wh-consent-actions' });
            const decline = el('button', { type: 'button', class: 'wh-consent-btn', 'data-consent': 'denied' }, 'Decline');
            const accept = el('button', { type: 'button', class: 'wh-consent-btn', 'data-consent': 'granted' }, 'Accept');
            decline.addEventListener('click', () => set('denied'));
            accept.addEventListener('click', () => set('granted'));
            actions.appendChild(decline);
            actions.appendChild(accept);
            inner.appendChild(copy);
            inner.appendChild(actions);
            box.appendChild(inner);
            box.addEventListener('keydown', (e) => { if (e.key === 'Escape' && !needsChoice()) hideBanner(); });
            doc.body.appendChild(box);
        }

        // a way back to the choice on pages that have no Settings menu
        function ensureChoicesLink() {
            if (!doc || !doc.body || doc.getElementById('adChoicesBtn') || doc.getElementById('whConsentLink')) return;
            const b = doc.createElement('button');
            b.type = 'button';
            b.id = 'whConsentLink';
            b.className = 'wh-consent-link';
            b.textContent = 'Ad & cookie choices';
            b.addEventListener('click', showBanner);
            doc.body.appendChild(b);
        }

        function init() {
            if (!doc) return;
            apply();
            if (needsChoice()) showBanner();
            const btn = doc.getElementById('adChoicesBtn');
            if (btn) btn.addEventListener('click', showBanner);
            ensureChoicesLink();
        }

        return { choice, analyticsChoice, allowed, analyticsAllowed, set, apply, init, open: showBanner, statusText, ADSENSE_SRC };
    }

    // in a page: build it for this window and run once the document is ready
    function start(win) {
        if (!win || !win.document) return null;
        let store;
        try { store = win.localStorage; store.getItem(KEY); } catch (e) { store = { getItem: () => null, setItem: () => { throw new Error('blocked'); } }; }
        const consent = create({ store, window: win, document: win.document });
        // start as soon as the HTML is parsed: DOMContentLoaded also waits for the page's Firebase modules to download
        const doc = win.document;
        if (doc.readyState !== 'loading') consent.init();
        else {
            let done = false;
            const go = () => { if (!done) { done = true; consent.init(); } };
            doc.addEventListener('readystatechange', () => { if (doc.readyState !== 'loading') go(); });
            doc.addEventListener('DOMContentLoaded', go);
        }
        return consent;
    }

    return { create, start, KEY, ANALYTICS_KEY, LEGACY_KEY, ADSENSE_SRC };
}));
