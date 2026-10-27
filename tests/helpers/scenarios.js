'use strict';
/** Reusable game states for tests. Each takes a game from loadGame() and sets variables the way play would. */

/** A mid-game save worth prestiging: CR lurker 150, 3050 total upgrade levels, plus things prestige must keep or clear. */
function midGame(g) {
    g.eval(`
        count = 5e9;
        upgrade12Level = 150; upgrade1Level = 1400; upgrade2Level = 1500;
        special1Purchased = true; special2Purchased = true; clickMultiplier = 3;
        goldenWhat = 3; prestigeTimes = 1; totalGoldenEver = 3;
        divineArgonLevel = 2; divineSomalianLevel = 1; divineCollectorLevel = 0; divineMoneyManLevel = 1;
        diamonds = 42; clanPoints = 7;
        shopWHBWPurchased = true; shopDivineWHPurchased = true; equippedShopImage = 'mainimage/FireWH.png';
        musicOwned = { mainTheme: true, BassInsanity: true }; currentMusicTrack = 'BassInsanity';
        musicVolume = 0.3; sfxMuted = true;
    `);
    g.eval('syncDivineCostsFromLevels(); updateDisplays(); saveGame();');
    // separate-key progress written by other pages
    g.storage.setItem('whathappened_followers', JSON.stringify({ list: [{ id: 'f1' }], nursery: [] }));
    g.storage.setItem('whathappened_items', JSON.stringify({ boxes: 3 }));
    g.storage.setItem('ach_firstClick', '1');
    g.storage.setItem('unlocked_titles', JSON.stringify([{ id: 't1' }]));
    return g;
}

module.exports = { midGame };
