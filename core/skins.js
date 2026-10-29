/**
 * The main-image skins from the game's shop, for pages other than the game itself (The Wilds lets you wear any skin you
 * have unlocked). main.js keeps its own SHOP_SKINS with the ownership flags as live variables; a test checks that the two
 * lists agree, so add a new skin to both.
 *
 * flag: the main save field that is true once the skin is owned. thumb: the small picture (mainimage/thumbs).
 *
 * Works in a browser (<script src="core/skins.js"> sets window.WHSkins) and in Node (require).
 */
(function (root, factory) {
    if (typeof module === 'object' && module.exports) module.exports = factory();
    else root.WHSkins = factory();
}(typeof self !== 'undefined' ? self : this, function () {
    'use strict';

    const DEFAULT = 'mainimage/whathappened.jpeg';
    const SKINS = [
        { id: 'Divine', title: 'Divine Spirit', path: 'mainimage/divinespirit.png', cost: 20, flag: 'shopDivinePurchased' },
        { id: 'Collection', title: 'Collection Background', path: 'mainimage/collectionbg.png', cost: 20, flag: 'shopCollectionBgPurchased' },
        { id: 'WHBW', title: 'WH Black & White', path: 'mainimage/whblackandwhite.png', cost: 5, flag: 'shopWHBWPurchased' },
        { id: 'WHVrill', title: 'WH Vrill', path: 'mainimage/whvrill.png', cost: 50, flag: 'shopWHVrillPurchased' },
        { id: 'MobileMan', title: 'Mobile Man Skin', path: 'mainimage/mobilemanskin.png', cost: 50, flag: 'shopMobileManPurchased' },
        { id: 'Silver', title: 'Silver WH', path: 'mainimage/silverwh.png', cost: 100, flag: 'shopSilverPurchased' },
        { id: 'Platinum', title: 'Platinum WH', path: 'mainimage/platinumwh.png', cost: 100, flag: 'shopPlatinumPurchased' },
        { id: 'DivineWH', title: 'Divine WH', path: 'mainimage/divinewh.png', cost: 500, flag: 'shopDivineWHPurchased' },
        { id: 'Gold', title: 'Gold WH', path: 'mainimage/goldwh.png', cost: 500, flag: 'shopGoldPurchased' },
        { id: 'WHNature', title: 'WH Nature', path: 'mainimage/whnature.webp', cost: 20, flag: 'shopWHNaturePurchased' },
        { id: 'VoidWH', title: 'Void WH', path: 'mainimage/voidWH.png', cost: 75, flag: 'shopVoidWHPurchased' },
        { id: 'FireWH', title: 'Fire WH', path: 'mainimage/FireWH.png', cost: 75, flag: 'shopFireWHPurchased' },
        { id: 'IceWH', title: 'Ice WH', path: 'mainimage/WHice.png', cost: 75, flag: 'shopIceWHPurchased' },
        { id: 'WHhacker', title: 'WH Hacker', path: 'mainimage/WHhacker.png', cost: 50, flag: 'shopWHhackerPurchased' },
        { id: 'WHchad', title: 'WH Chad', path: 'mainimage/WHchad.png', cost: 50, flag: 'shopWHchadPurchased' },
        { id: 'WHbread', title: 'WH Bread', path: 'mainimage/WHbread.png', cost: 50, flag: 'shopWHbreadPurchased' },
        { id: 'WHlightning', title: 'WH Lightning', path: 'mainimage/WHlightning.png', cost: 50, flag: 'shopWHlightningPurchased' },
        { id: 'CasinoDealer', title: 'Casino Dealer', path: 'mainimage/casinoDeal.png', cost: null, unlockText: 'Win 10 blackjack hands', flag: 'shopCasinoDealerPurchased' },
    ];
    // The small picture for a skin path (the same rule as main.js thumbFor); the default has no thumbnail
    function thumb(path) {
        const m = String(path || '').match(/^mainimage\/([^/]+)\.(png|jpe?g|webp)$/i);
        return m && m[1].toLowerCase() !== 'whathappened' ? 'mainimage/thumbs/' + m[1] + '.webp' : DEFAULT;
    }
    const byPath = (path) => { const base = String(path || '').split('/').pop().toLowerCase(); return SKINS.find(s => s.path.split('/').pop().toLowerCase() === base) || null; };
    // Is this skin unlocked in that main save? (the default always is)
    function owns(save, path) {
        if (!path || path === DEFAULT) return true;
        const s = byPath(path);
        return !!s && !!save && save[s.flag] === true;
    }
    // Every skin unlocked in a main save
    function owned(save) { return SKINS.filter(s => !!save && save[s.flag] === true); }

    return { DEFAULT, SKINS, thumb, byPath, owns, owned };
}));
