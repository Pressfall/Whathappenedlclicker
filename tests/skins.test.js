// core/skins.js: the game's skins for other pages (The Wilds lets you wear any you have unlocked)
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const Skins = require('../core/skins');
const W = require('../core/world-logic');
const { loadGame } = require('./helpers/game-harness');

test('the list matches the game shop, skin for skin, flag for flag', () => {
    const g = loadGame({ now: 1_700_000_000_000 });
    const shop = g.eval('JSON.stringify(SHOP_SKINS.map(s => [s.id, s.title, s.path, s.cost]))');
    assert.deepEqual(JSON.parse(shop), Skins.SKINS.map(s => [s.id, s.title, s.path, s.cost]));
    for (const s of Skins.SKINS) {
        // the save field named by flag is the one the shop's owned() reads, and it is saved
        assert.equal(g.eval(`(() => { ${s.flag} = true; return SHOP_SKINS.find(k => k.id === '${s.id}').owned(); })()`), true, s.id);
        g.eval('saveGame()');
        assert.equal(g.savedState()[s.flag], true, s.flag + ' is in the save');
    }
    assert.equal(g.eval('DEFAULT_SHOP_IMAGE'), Skins.DEFAULT);
    g.close();
});

test('every skin has its small picture, and ownership comes from the save', () => {
    const root = path.join(__dirname, '..');
    for (const s of Skins.SKINS) assert.ok(fs.existsSync(path.join(root, Skins.thumb(s.path))), s.id + ' thumbnail');
    assert.equal(Skins.thumb(Skins.DEFAULT), Skins.DEFAULT);
    assert.equal(Skins.thumb('mainimage/goldwh.png'), 'mainimage/thumbs/goldwh.webp');
    const save = { shopGoldPurchased: true, shopVoidWHPurchased: 'yes' };
    assert.deepEqual(Skins.owned(save).map(s => s.id), ['Gold']);
    assert.equal(Skins.owns(save, 'mainimage/goldwh.png'), true);
    assert.equal(Skins.owns(save, 'mainimage/GOLDWH.png'), true, 'old saves stored other letter case');
    assert.equal(Skins.owns(save, 'mainimage/voidWH.png'), false, 'only a real true counts');
    assert.equal(Skins.owns(save, 'mainimage/nope.png'), false);
    assert.equal(Skins.owns({}, Skins.DEFAULT), true);
    assert.deepEqual(Skins.owned(null), []);
});

test('the Wilds keeps the skin picked there; anything odd in the save is dropped', () => {
    assert.equal(W.freshState(1).skin, null, 'by default: the same as the game');
    const s = W.migrate({ v: 1, skin: 'mainimage/goldwh.png' }, 1);
    assert.equal(s.skin, 'mainimage/goldwh.png');
    assert.equal(W.migrate(JSON.parse(W.serialize(s, 1, 0)), 1).skin, 'mainimage/goldwh.png', 'it survives a save');
    for (const bad of ['javascript:alert(1)', 'https://x.io/a.png', 'mainimage/../x.png', 'mainimage/a b.png', 7, {}, 'mainimage/' + 'a'.repeat(90) + '.png']) assert.equal(W.migrate({ v: 1, skin: bad }, 1).skin, null, String(bad));
    assert.deepEqual(W.validate(s), []);
});
