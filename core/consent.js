/**
 * Consent for ads and measurement. Nothing from Google AdSense or Google Analytics loads until the player says yes:
 *  - no choice yet  -> no ads, no analytics, and a notice with Accept / Decline of equal weight;
 *  - "granted"      -> AdSense is loaded and the ad slot shown; Analytics starts (wh:consent event);
 *  - "denied"       -> nothing loads, no ad space is reserved.
 * The choice is kept in this browser (localStorage "wh_ad_consent") and can be changed any time from Settings > Ad &
 * cookie choices, or the link at the bottom of the other pages. The old notice stored "wh_cookie_consent = accepted"
 * after an explicit click on text that mentioned third-party ads and cookies; that is still honoured.
 *
 * The game save is not covered by this: it is stored in the browser because the game cannot work without it.
 *
 * Works in a browser (<script src="core/consent.js"> starts it, window.WHConsent) and in Node (require, then create()).
 * Note for the site owner: this is a simple notice, not a Google-certified CMP. For visitors in the EEA, UK and
 * Switzerland Google requires its own certified consent message (AdSense > Privacy & messaging) before it will serve ads.
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
    const LEGACY_KEY = 'wh_cookie_consent';
    const ADSENSE_SRC = 'https://pagead2.googlesyndication.com/pagead/js/adsbygoogle.js?client=ca-pub-7259344384263515';

    function create({ store, window: win, document: doc }) {
        let adsLoaded = false;
        let memory = null; // the choice for this page only, when the browser blocks storage

        // 'granted', 'denied' or null (not chosen yet)
        function choice() {
            if (memory) return memory; // set only when storage refused the newest choice, so it wins
            try {
                const v = store.getItem(KEY);
                if (v === 'granted' || v === 'denied') return v;
                if (store.getItem(LEGACY_KEY) === 'accepted') return 'granted';
            } catch (e) { /* storage unreadable: no saved choice */ }
            return null;
        }
        const allowed = () => choice() === 'granted';

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
            const c = choice();
            if (c === 'granted') return 'Ads and visit counting are on. Choose Decline to turn them off.';
            if (c === 'denied') return 'Ads and visit counting are off. Nothing from Google is loaded.';
            return 'You have not chosen yet, so no ads or visit counting are loaded.';
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
                if (wrapper) wrapper.hidden = false;
                loadAds();
                fillSlots();
            } else if (wrapper) {
                wrapper.hidden = true; // no empty ad space for someone who has not agreed to ads
            }
            updateStatus();
        }

        function set(value) {
            if (value !== 'granted' && value !== 'denied') throw new Error('consent must be "granted" or "denied"');
            const before = choice();
            try { store.setItem(KEY, value); } catch (e) { memory = value; }
            hideBanner();
            apply();
            try { win.dispatchEvent(new win.CustomEvent('wh:consent', { detail: value })); } catch (e) {}
            if (before === 'granted' && value === 'denied') {
                const el = doc.getElementById('adChoicesStatus');
                if (el) el.textContent = 'Ads and visit counting are off. Ads already on this page go away when you reload it.';
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
            const p = el('p', { id: 'whConsentText' }, 'This site shows ads from Google AdSense and counts visits with Google Analytics. Both use cookies or similar technology, and the ads can be personalized. They only load if you accept. Your game save stays in your browser either way: the game needs it. ');
            const link = el('a', { href: 'privacy.html', target: '_blank', rel: 'noopener' }, 'Privacy policy');
            p.appendChild(link);
            copy.appendChild(p);
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
            box.addEventListener('keydown', (e) => { if (e.key === 'Escape' && choice()) hideBanner(); });
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
            if (!choice()) showBanner();
            const btn = doc.getElementById('adChoicesBtn');
            if (btn) btn.addEventListener('click', showBanner);
            ensureChoicesLink();
        }

        return { choice, allowed, set, apply, init, open: showBanner, statusText, ADSENSE_SRC };
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

    return { create, start, KEY, LEGACY_KEY, ADSENSE_SRC };
}));
