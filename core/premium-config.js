/**
 * Holy What Happeneds 👼 and Ko-fi: THE ONE PLACE THE OWNER EDITS. Everything marked OWNER below is a placeholder until you fill it in.
 *
 * Read by the game (index.html and world.html: <script src="core/premium-config.js"> sets window.WHPremiumConfig) and by
 * the Ko-fi webhook worker (kofi-worker/, which bundles this file), so the price table and the Ko-fi link can never
 * disagree between the two. After changing it: redeploy the site AND the worker (docs/kofi-setup.md, step 6).
 *
 * While anything needed is still a placeholder, buying is switched off by itself: the game's Get more tab says "not open
 * yet", and the worker credits nothing for a Ko-fi item that isn't in `packs` (and stores nothing about it: Ko-fi's own
 * dashboard still lists the payment, and /admin/resolve can credit it by hand, docs/kofi-setup.md "Fixing a payment").
 */
(function (root, factory) {
    if (typeof module === 'object' && module.exports) module.exports = factory();
    else root.WHPremiumConfig = factory();
}(typeof self !== 'undefined' ? self : this, function () {
    'use strict';

    const CONFIG = {
        // The currency's name in every message. Change it here and in the help pages if you rename it.
        currency: { one: 'Holy What Happened', many: 'Holy What Happeneds', icon: '👼' },

        // OWNER: your Ko-fi page, e.g. 'https://ko-fi.com/whathappened'.
        kofiPage: 'https://ko-fi.com/OWNER_KOFI_NAME',

        // OWNER: the address of the deployed worker (docs/kofi-setup.md, step 4), e.g. 'https://wh-kofi.yourname.workers.dev'.
        // The game sends "claim a payment" requests here. No trailing slash.
        workerUrl: 'https://OWNER-WORKER.workers.dev',

        // OWNER: the price-to-Holy What Happeneds table. One row per Ko-fi Shop item that sells Holy What Happeneds.
        //   code:  the item's code, the part after ko-fi.com/s/ in its link (Ko-fi sends it as shop_items[].direct_link_code)
        //   beans: how many Holy What Happeneds ONE of that item gives (a quantity of 2 gives twice as many)
        //   name, price: what the game's Get more tab shows. The price is only a label: Ko-fi charges what the item costs there.
        // A row whose code or beans is still a placeholder is ignored by the game and the worker alike.
        packs: [
            { code: 'OWNER_SHOP_ITEM_CODE_1', beans: 0, name: 'OWNER: pack name', price: 'OWNER: price' },
            { code: 'OWNER_SHOP_ITEM_CODE_2', beans: 0, name: 'OWNER: pack name', price: 'OWNER: price' },
            { code: 'OWNER_SHOP_ITEM_CODE_3', beans: 0, name: 'OWNER: pack name', price: 'OWNER: price' },
        ],

        // OWNER (optional): Holy What Happeneds for a plain Ko-fi tip ("Donation") that has a link code in its message, per 1 unit of each
        // currency, e.g. { USD: 100, EUR: 100, GBP: 120 }. Left empty, a tip stays a tip: it gives no Holy What Happeneds and nothing is stored.
        donationRate: {},

        // OWNER (optional): Holy What Happeneds for each Ko-fi membership payment ("Subscription"), by the tier's exact name on Ko-fi,
        // e.g. { 'Holy Club': 300 }. Empty: memberships give no Holy What Happeneds.
        subscriptionTiers: {},

        // Safety net: no single payment credits more than this (a typo in a rate can't flood an account).
        maxBeansPerPayment: 100000,
    };

    // ---------------- helpers (shared by the game and the worker) ----------------
    // Without a `cfg`, they read the exported object itself (so the values seen are always the ones exported).
    const API = Object.assign({}, CONFIG);
    const PLACEHOLDER = /OWNER/;
    const isPlaceholder = (v) => typeof v !== 'string' || v.trim() === '' || PLACEHOLDER.test(v);
    const posInt = (v) => Number.isInteger(v) && v > 0;
    // the packs that are filled in: a real code and a whole number of Holy What Happeneds
    function activePacks(cfg) {
        const c = cfg || API;
        return (Array.isArray(c.packs) ? c.packs : []).filter((p) => p && !isPlaceholder(p.code) && /^[A-Za-z0-9_-]{1,64}$/.test(p.code) && posInt(p.beans));
    }
    function packByCode(code, cfg) {
        const want = String(code || '').toLowerCase();
        return activePacks(cfg).find((p) => p.code.toLowerCase() === want) || null;
    }
    const rates = (m) => Object.entries(m && typeof m === 'object' ? m : {}).filter(([k, v]) => k && Number.isFinite(v) && v > 0);
    // buying is open once the Ko-fi page and the worker are set and there is at least one way to get Holy What Happeneds for money
    function buyingOpen(cfg) {
        const c = cfg || API;
        return !isPlaceholder(c.kofiPage) && /^https:\/\/ko-fi\.com\/[A-Za-z0-9_]+\/?$/.test(c.kofiPage)
            && !isPlaceholder(c.workerUrl) && /^https:\/\//.test(c.workerUrl)
            && (activePacks(c).length > 0 || rates(c.donationRate).length > 0 || rates(c.subscriptionTiers).length > 0);
    }
    function shopItemUrl(code) { return 'https://ko-fi.com/s/' + encodeURIComponent(code); }

    return Object.assign(API, { CONFIG, isPlaceholder, activePacks, packByCode, buyingOpen, shopItemUrl, rates });
}));
