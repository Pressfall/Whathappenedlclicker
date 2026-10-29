'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { loadGame } = require('./helpers/game-harness');

const NOW = 1_700_000_000_000;

// codes come from Firestore, clans too: stand-ins that know a few codes and keep one clan document in memory
function withCodes(g) {
    g.eval(`window.__clan = { clanXp: 100 }; window.__txFails = false;
        window.db = {}; window.doc = (db, col, id) => ({ col, id });
        window.getDoc = async (ref) => { const codes = { CPCODE: { type: 'clanPoints', amount: 250 }, XPCODE: { type: 'clanXp', amount: 400, message: 'Your clan grew!' } }; const c = codes[ref.id]; return { exists: () => !!c, data: () => c }; };
        window.runTransaction = async (db, fn) => {
            if (window.__txFails) throw new Error('offline');
            const tx = { get: async () => ({ exists: () => true, data: () => window.__clan }), update: (ref, patch) => { window.__clan = Object.assign({}, window.__clan, patch); } };
            return fn(tx);
        };`);
    return async (code) => {
        g.eval(`document.getElementById('secretCodeInput').value = ${JSON.stringify(code)}`);
        await g.eval('redeemSecretCode()');
        return g.eval("document.getElementById('secretCodeStatus').innerText");
    };
}

test('a clanPoints code adds Clan Points to the save, once', async () => {
    const g = loadGame({ now: NOW });
    const redeem = withCodes(g);
    const before = g.eval('clanPoints');
    assert.match(await redeem('cpcode'), /250 Clan Points/);
    assert.equal(g.eval('clanPoints'), before + 250);
    assert.equal(g.savedState().clanPoints, before + 250, 'saved, so the next autosave keeps it');
    assert.match(await redeem('CPCODE'), /already redeemed/);
    assert.equal(g.eval('clanPoints'), before + 250);
    g.close();
});

test('a clanXp code adds XP to the player\'s clan, once', async () => {
    const g = loadGame({ now: NOW, storage: { player_clanId: 'clan123' } });
    const redeem = withCodes(g);
    assert.equal(await redeem('XPCODE'), 'Your clan grew!');
    assert.equal(g.eval('window.__clan.clanXp'), 500);
    assert.match(await redeem('XPCODE'), /already redeemed/);
    assert.equal(g.eval('window.__clan.clanXp'), 500);
    g.close();
});

test('a clanXp code needs a clan and is not used up without one', async () => {
    const g = loadGame({ now: NOW });
    const redeem = withCodes(g);
    assert.match(await redeem('XPCODE'), /join a clan/i);
    assert.equal(g.eval('getRedeemedCodes().includes("XPCODE")'), false);
    assert.equal(g.eval('window.__clan.clanXp'), 100);
    g.storage.setItem('player_clanId', 'clan123');
    assert.equal(await redeem('XPCODE'), 'Your clan grew!');
    g.close();
});

test('a clanXp code that cannot reach the clan can be tried again', async () => {
    const g = loadGame({ now: NOW, storage: { player_clanId: 'clan123' } });
    const redeem = withCodes(g);
    g.eval('window.__txFails = true');
    assert.match(await redeem('XPCODE'), /Couldn't add the Clan XP/);
    assert.equal(g.eval('getRedeemedCodes().includes("XPCODE")'), false);
    g.eval('window.__txFails = false');
    assert.equal(await redeem('XPCODE'), 'Your clan grew!');
    assert.equal(g.eval('window.__clan.clanXp'), 500);
    g.close();
});
