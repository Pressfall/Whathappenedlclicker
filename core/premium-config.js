/**
 * Holy What Happeneds 👼 and Ko-fi: THE ONE PLACE THE OWNER EDITS. Everything marked OWNER below is a placeholder until you fill it in.
 *
 * Read by the game (index.html and world.html: <script src="core/premium-config.js"> sets window.WHPremiumConfig) and by
 * the Ko-fi webhook worker (kofi-worker/, which bundles this file), so the price table and the Ko-fi link can never
 * disagree between the two. After changing it: redeploy the site AND the worker (docs/kofi-setup.md, step 6).
 *
 * While anything needed is still a placeholder, buying is switched off by itself: the game's Get more tab says "not open
 * yet". The worker credits nothing for a payment the tables below don't price (a Shop item not in `packs`, a tip in another
 * currency with no rate) and stores nothing about it: Ko-fi's own dashboard still lists the payment, and /admin/resolve can
 * credit it by hand (docs/kofi-setup.md "Fixing a payment").
 */
(function (root, factory) {
    if (typeof module === 'object' && module.exports) module.exports = factory();
    else root.WHPremiumConfig = factory();
}(typeof self !== 'undefined' ? self : this, function () {
    'use strict';

    const CONFIG = {
        // The currency's name in every message. Change it here and in the help pages if you rename it.
        currency: { one: 'Holy What Happened', many: 'Holy What Happeneds', icon: '👼' },

        // Your Ko-fi page.
        kofiPage: 'https://ko-fi.com/whathappenedclicker',

        // The deployed worker (docs/kofi-setup.md, step 4). The game sends "claim a payment" requests here. No trailing slash.
        // Setting it is what opens buying in the game (with the Ko-fi page and the tip packs), so publish it only once tested.
        workerUrl: 'https://wh-kofi.lincolnstracker.workers.dev',

        // Packs paid as Ko-fi tips (folded under the Shop packs in the game). The player tips the pack's amount on your Ko-fi
        // page (any amount from $1 works there) with their link code in the tip's message, and gets that pack. An amount
        // between packs is paid at the rate of the biggest pack it reaches (e.g. $7 at the $5 pack's rate: 770); under the
        // smallest pack, at its rate.
        //   dollars: the tip, in tipCurrency (your Ko-fi page's currency)   beans: what that tip gives   name: shown in the game
        tipCurrency: 'USD',
        tipPacks: [
            { name: 'Small', dollars: 2, beans: 200 },
            { name: 'Medium', dollars: 5, beans: 550 },
            { name: 'Large', dollars: 10, beans: 1200 },
            { name: 'Huge', dollars: 20, beans: 2600 },
        ],

        // THE SHOP PACKS: Ko-fi Shop items that sell Holy What Happeneds, shown first in the game's Get more tab. One row per item:
        //   code:  the item's code, the part after ko-fi.com/s/ in its link (Ko-fi sends it as shop_items[].direct_link_code)
        //   beans: how many Holy What Happeneds ONE of that item gives (a quantity of 2 gives twice as many)
        //   name, price: what the game's Get more tab shows. The price is only a label: Ko-fi charges what the item costs there.
        // A Shop order can't carry a link code, so the worker matches the email it was paid with to the account whose verified
        // sign-in email that is (docs/kofi-setup.md, "Shop packs and the buyer's email"). Same amounts as the tip packs.
        packs: [
            { code: 'f2573687e6', beans: 200, name: 'Small', price: '$2' },
            { code: 'dc4903b0ae', beans: 550, name: 'Medium', price: '$5' },
            { code: 'b78f4ef959', beans: 1200, name: 'Large', price: '$10' },
            { code: '3acb924dfd', beans: 2600, name: 'Huge', price: '$20' },
        ],

        // Optional: a flat rate for tips in OTHER currencies than tipCurrency, per 1 unit, e.g. { EUR: 100, GBP: 120 }.
        // Left empty, a tip in another currency gives nothing and nothing is stored.
        donationRate: {},

        // OWNER (optional): Holy What Happeneds for each Ko-fi membership payment ("Subscription"), by the tier's exact name on Ko-fi,
        // e.g. { 'Holy Club': 300 }. A monthly payment not listed here (a monthly tip, the tip box's "Make it monthly", or a
        // tier left out) pays by its amount like a tip, every month.
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
    // the tip packs that are filled in, smallest first
    function activeTipPacks(cfg) {
        const c = cfg || API;
        return (Array.isArray(c.tipPacks) ? c.tipPacks : []).filter((p) => p && Number.isFinite(p.dollars) && p.dollars > 0 && posInt(p.beans))
            .slice().sort((a, b) => a.dollars - b.dollars);
    }
    // What a tip of `amount` (in `currency`) gives under the tip packs: the rate of the biggest pack it reaches. 0 when the
    // currency isn't tipCurrency or there are no packs.
    function tipBeans(amount, currency, cfg) {
        const c = cfg || API, packs = activeTipPacks(c);
        if (!packs.length || !(amount > 0) || String(currency || '').toUpperCase() !== String(c.tipCurrency || '').toUpperCase()) return 0;
        let pack = packs[0];
        for (const p of packs) if (amount + 1e-9 >= p.dollars) pack = p;
        return Math.floor(amount * pack.beans / pack.dollars + 1e-9);
    }
    // buying is open once the Ko-fi page and the worker are set and there is at least one way to get Holy What Happeneds for money
    function buyingOpen(cfg) {
        const c = cfg || API;
        return !isPlaceholder(c.kofiPage) && /^https:\/\/ko-fi\.com\/[A-Za-z0-9_]+\/?$/.test(c.kofiPage)
            && !isPlaceholder(c.workerUrl) && /^https:\/\//.test(c.workerUrl)
            && (activeTipPacks(c).length > 0 || activePacks(c).length > 0 || rates(c.donationRate).length > 0 || rates(c.subscriptionTiers).length > 0);
    }
    function shopItemUrl(code) { return 'https://ko-fi.com/s/' + encodeURIComponent(code); }

    return Object.assign(API, { CONFIG, isPlaceholder, activePacks, activeTipPacks, tipBeans, packByCode, buyingOpen, shopItemUrl, rates });
}));
