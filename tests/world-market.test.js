'use strict';
// Trading and the Auction Hall (core/world-market.js, core/world-logic.js, database.rules.json): items travel packed and
// arrive cleaned; offers set items aside; a change to either offer needs accepting again; both confirming the same deal
// freezes it and each side gets exactly the other's offer; calling it off gives everything back; bids beat the top one by
// 5%, the winner claims once and the seller is paid once; the limits; and the rules say what the module says.
const test = require('node:test');
const assert = require('node:assert/strict');
const D = require('../core/world-data');
const W = require('../core/world-logic');
const M = require('../core/world-market');
const Gr = require('../core/gear');

const NOW = new Date(2026, 10, 10, 12, 0, 0).getTime();
const reload = (s) => W.migrate(JSON.parse(W.serialize(s)), NOW);
const rules = JSON.parse(require('fs').readFileSync(require('path').join(__dirname, '..', 'database.rules.json'), 'utf8')).rules.wilds.v1;
function player(rubies) {
    const s = W.freshState(NOW);
    s.rubies = rubies || 10000;
    const sword = W.addGear(s, 'sword_4', 92, ['keen'], NOW, { r: { t: 5, l: [['might', 1.1], ['keen', 1], ['ember', 0.9]], m: ['titan_ruby', 'heartstone'], c: ['#ff3b6b', '#ffe14d'], q: '', by: 'Smith', n: 0, lv: 2 }, k: [['sunstone', 9.5]] });
    const helm = W.addGear(s, 'helmet_3', 60, [], NOW);
    s.satchel.push(Gr.cleanPiece({ id: s.relics.nextPid++, s: 'crown', t: 4, l: [['swift', 1], ['might', 1], ['ward', 1]], c: ['#ffffff', '#000000'], by: 'Smith' }));
    return { s, sword, helm, piece: s.satchel[0] };
}

test('an item travels as a string and arrives cleaned: nothing made up, its maker kept, one more change of hands', () => {
    const { sword, piece } = player();
    const str = M.packItem({ kind: 'w', item: sword });
    assert.ok(str.length <= M.AUCTION.maxItemLen, str.length + ' characters');
    const x = M.unpackItem(str, true);
    assert.equal(x.kind, 'w');
    assert.deepEqual(x.item.r.l, sword.r.l);
    assert.equal(x.item.r.by, 'Smith');
    assert.equal(x.item.r.n, 1, 'changed hands once');
    assert.deepEqual(x.item.k, sword.k);
    const g = M.unpackItem(M.packItem({ kind: 'g', piece }), true);
    assert.equal(g.piece.n, 1);
    // forged on the way: the cleaning takes it back to what the tables allow
    const evil = JSON.parse(str);
    evil.r.t = 99; evil.r.l = [['might', 50], ['might', 9], ['godmode', 1]]; evil.s = 999; evil.a = ['keen', 'swift', 'lucky', 'x']; evil.x = [['heartstone', 1e6]];
    const y = M.unpackItem(JSON.stringify(evil), true);
    assert.equal(y.item.r.t, Gr.MAX_TIER);
    assert.deepEqual(y.item.r.l, [['might', Gr.ROLL.hi]]);
    assert.equal(y.item.score, 100);
    assert.equal(y.item.aff.length, 2);
    assert.ok(y.item.k[0][1] <= 18 * 1.3);
    for (const bad of ['', 'x', '{}', JSON.stringify({ k: 'w', b: 'nope' }), 'a'.repeat(5000), JSON.stringify({ k: 'g', p: { s: 'hat' } })]) assert.equal(M.unpackItem(bad), null, bad.slice(0, 30));
    // the starter kit stays with you
    const fresh = W.freshState(NOW);
    assert.equal(M.tradeable(fresh.gear[0]), false);
});

test('a trade: offers set items aside, the deal both confirm goes through, and each side gets exactly the other\'s offer', () => {
    const A = player(5000), B = player(3000);
    W.tradeStart(A.s, 'tradeAAAA1', 'uidB', 'Bee', NOW);
    W.tradeStart(B.s, 'tradeAAAA1', 'uidA', 'Ay', NOW);
    assert.equal(W.tradeSetOffer(A.s, [{ kind: 'w', uid: A.sword.uid }], 500).ok, true);
    assert.ok(!A.s.gear.some(g => g.uid === A.sword.uid), 'set aside');
    assert.equal(A.s.rubies, 4500, 'rubies set aside');
    const offerB = W.tradeSetOffer(B.s, [{ kind: 'g', id: B.piece.id }], 0).offer;
    // the database record, both accepted and confirmed the same deal
    const node = { a: 'uidA', b: 'uidB', an: 'Ay', bn: 'Bee', t: NOW, s: { uidA: { o: JSON.stringify(A.s.market.trade.held), r: 500 }, uidB: { o: JSON.stringify(offerB.o), r: 0 } } };
    const h = M.dealHash(node);
    node.s.uidA.ok = node.s.uidB.ok = h;
    assert.equal(M.tradeView(node, 'uidA', NOW).final, false, 'accepting is not enough');
    node.s.uidA.c = node.s.uidB.c = h;
    const va = M.tradeView(node, 'uidA', NOW), vb = M.tradeView(node, 'uidB', NOW);
    assert.ok(va.final && vb.final);
    assert.equal(M.allowedSideWrite(node, 'uidA'), false, 'frozen once both confirmed the same deal');
    assert.ok(W.heldMatches(A.s, va.mine));
    W.tradeSettle(A.s, va.theirs, NOW);
    W.tradeSettle(B.s, vb.theirs, NOW);
    assert.equal(A.s.satchel.filter(p => p.s === 'crown').length, 2, 'A got B\'s crown');
    assert.equal(B.s.rubies, 3500, 'B got A\'s rubies');
    const got = B.s.gear.find(g => g.r && g.r.by === 'Smith' && g.base === 'sword_4' && g.r.n === 1);
    assert.ok(got, 'B got A\'s sword, its maker and its trade count with it');
    assert.equal(A.s.market.trade, null);
    assert.equal(A.s.market.trades, 1);
    assert.equal(W.tradesLeft(A.s, NOW), M.TRADE.perDay - 1);
});

test('changing either offer means accepting again; a trade called off gives everything back; a reload keeps what is set aside', () => {
    const A = player(5000);
    W.tradeStart(A.s, 'tradeBBBB2', 'uidB', 'Bee', NOW);
    W.tradeSetOffer(A.s, [{ kind: 'w', uid: A.sword.uid }, { kind: 'g', id: A.piece.id }], 1000);
    const node = { a: 'uidA', b: 'uidB', t: NOW, s: { uidA: { o: JSON.stringify(A.s.market.trade.held), r: 1000 }, uidB: { o: '[]', r: 0 } } };
    const h0 = M.dealHash(node);
    node.s.uidA.ok = node.s.uidB.ok = h0;
    node.s.uidB.r = 50; // B adds rubies
    const v = M.tradeView(node, 'uidA', NOW);
    assert.equal(v.accepted.me, false, 'the deal changed: my acceptance is stale');
    assert.equal(M.allowedSideWrite(node, 'uidA'), true);
    // one confirmed, the other not: still free to change (no freeze)
    node.s.uidA.c = M.dealHash(node);
    assert.equal(M.allowedSideWrite(node, 'uidA'), true);
    assert.equal(M.allowedSideWrite(node, 'uidC'), false, 'not my trade');
    // a reload in the middle: what is set aside is still set aside
    const back = reload(A.s);
    assert.equal(back.market.trade.held.length, 2);
    assert.equal(back.market.trade.r, 1000);
    // taking one back
    W.tradeSetOffer(back, [{ held: 1 }], 0);
    assert.equal(back.market.trade.held.length, 1);
    assert.ok(back.gear.some(g => g.base === 'sword_4'), 'the sword came back');
    assert.equal(back.rubies, 5000);
    // called off: everything back
    W.tradeCancel(back);
    assert.equal(back.market.trade, null);
    assert.equal(back.satchel.length, 1);
    assert.equal(back.rubies, 5000);
    // expiry
    assert.equal(M.tradeView({ a: 'x', b: 'y', t: NOW, s: {} }, 'x', NOW + M.TRADE.expireMs + 1).expired, true);
});

test('what is set aside is made to match the deal the database shows, exactly', () => {
    const A = player(5000);
    W.tradeStart(A.s, 'tradeCCCC3', 'uidB', 'Bee', NOW);
    const swordStr = M.packItem({ kind: 'w', item: A.sword });
    // the database says I offer the sword and 200 rubies, but the save set aside the helmet
    W.tradeSetOffer(A.s, [{ kind: 'w', uid: A.helm.uid }], 0);
    assert.equal(W.heldMatches(A.s, { o: JSON.stringify([swordStr]), r: 200 }), false);
    assert.equal(W.tradeReconcile(A.s, { o: JSON.stringify([swordStr]), r: 200 }), true);
    assert.deepEqual(A.s.market.trade.held, [swordStr]);
    assert.equal(A.s.market.trade.r, 200);
    assert.ok(A.s.gear.some(g => g.base === 'helmet_3'), 'the helmet came back');
    assert.ok(!A.s.gear.some(g => g.base === 'sword_4'), 'the sword is set aside');
    assert.equal(A.s.rubies, 4800);
    // something I no longer have: it can't match, and the trade should be called off
    assert.equal(W.tradeReconcile(A.s, { o: JSON.stringify([M.packItem({ kind: 'w', item: { base: 'bow_9', score: 99, aff: [] } })]), r: 0 }), false);
});

test('the Auction Hall: listing sets the item aside; a bid must beat the top by 5%; rubies are set aside while leading', () => {
    const S = player(), Bd = player(20000);
    const r = W.auctionList(S.s, { kind: 'w', uid: S.sword.uid }, 'lstAAAAAA1', { uid: 'uidS', name: 'Seller', min: 1000, buy: 5000, hours: 24 }, NOW);
    assert.equal(r.ok, true);
    assert.ok(!S.s.gear.some(g => g.uid === S.sword.uid));
    const l = r.listing;
    assert.equal(l.end, NOW + 24 * 3600000);
    assert.ok(M.allowedAuctionWrite(null, l, 'uidS', NOW), 'the seller may list it');
    assert.equal(M.allowedAuctionWrite(null, l, 'uidX', NOW), false, 'nobody else for them');
    assert.equal(M.minBid(l), 1000);
    const bid = (u, v, at) => Object.assign({}, l, { b: { u, n: u, v, t: at || NOW } });
    assert.ok(M.allowedAuctionWrite(l, bid('uidB', 1000), 'uidB', NOW));
    assert.equal(M.allowedAuctionWrite(l, bid('uidB', 999), 'uidB', NOW), false, 'under the starting price');
    assert.equal(M.allowedAuctionWrite(l, bid('uidS', 2000), 'uidS', NOW), false, 'not on your own');
    assert.equal(M.allowedAuctionWrite(l, bid('uidX', 2000), 'uidB', NOW), false, 'only as yourself');
    const l1 = bid('uidB', 1000);
    assert.equal(M.minBid(l1), 1050);
    assert.equal(M.allowedAuctionWrite(l1, Object.assign({}, l1, { b: { u: 'uidC', v: 1049, t: NOW } }), 'uidC', NOW), false, 'under 5% more');
    assert.ok(M.allowedAuctionWrite(l1, Object.assign({}, l1, { b: { u: 'uidC', v: 1050, t: NOW } }), 'uidC', NOW));
    assert.equal(M.allowedAuctionWrite(l1, Object.assign({}, l1, { b: { u: 'uidC', v: 5000, t: l.end } }), 'uidC', l.end), false, 'not once it has ended');
    assert.equal(M.allowedAuctionWrite(l1, Object.assign({}, l1, { end: l.end + 1e9 }), 'uidS', NOW), false, 'its end never moves');
    // the bidder's side
    assert.equal(W.auctionHold(Bd.s, 'lstAAAAAA1', 1000).ok, true);
    assert.equal(Bd.s.rubies, 19000);
    assert.equal(W.auctionHold(Bd.s, 'lstAAAAAA1', 1100).ok, true, 'raising: only the difference');
    assert.equal(Bd.s.rubies, 18900);
    assert.equal(W.auctionRelease(Bd.s, 'lstAAAAAA1'), 1100, 'outbid: all back');
    assert.equal(Bd.s.rubies, 20000);
    assert.equal(W.auctionHold(Bd.s, 'x', 1e9).ok, false);
    // a reload keeps the listing and the bid
    W.auctionHold(Bd.s, 'lstAAAAAA1', 1100);
    assert.equal(reload(S.s).market.listed.lstAAAAAA1.it, S.s.market.listed.lstAAAAAA1.it);
    assert.equal(reload(Bd.s).market.bids.lstAAAAAA1, 1100);
});

test('the Auction Hall: the winner claims once, the seller is paid once less the fee, unsold items come back', () => {
    const S = player(), Bd = player(20000);
    const l = W.auctionList(S.s, { kind: 'w', uid: S.sword.uid }, 'lstBBBBBB2', { uid: 'uidS', name: 'S', min: 1000, buy: 4000, hours: 1 }, NOW).listing;
    W.auctionHold(Bd.s, 'lstBBBBBB2', 1500);
    const won = Object.assign({}, l, { b: { u: 'uidB', n: 'B', v: 1500, t: NOW } });
    const after = l.end + 1;
    let v = M.auctionView(won, 'uidB', after);
    assert.ok(v.ended && v.canClaim && v.winner === 'uidB');
    assert.equal(M.auctionView(won, 'uidB', NOW).canClaim, false, 'not before it ends');
    assert.ok(M.allowedAuctionWrite(won, Object.assign({}, won, { cl: 'uidB' }), 'uidB', after));
    assert.equal(M.allowedAuctionWrite(won, Object.assign({}, won, { cl: 'uidC' }), 'uidC', after), false, 'only the winner');
    assert.equal(M.allowedAuctionWrite(won, Object.assign({}, won, { pd: true }), 'uidS', after), false, 'paid only once it is claimed');
    const claimed = Object.assign({}, won, { cl: 'uidB' });
    assert.equal(M.allowedAuctionWrite(claimed, Object.assign({}, claimed, { cl: 'uidB2' }), 'uidB', after), false, 'claimed once');
    assert.ok(M.allowedAuctionWrite(claimed, Object.assign({}, claimed, { pd: true }), 'uidS', after));
    const x = W.auctionWon(Bd.s, 'lstBBBBBB2', claimed.it);
    assert.ok(x && x.item.r.n === 1);
    assert.equal(Bd.s.market.bids.lstBBBBBB2, undefined);
    assert.equal(Bd.s.rubies, 18500, 'the price was set aside when bidding');
    assert.equal(W.auctionPaid(S.s, 'lstBBBBBB2', 1500), M.sellerTakes(1500));
    assert.equal(M.sellerTakes(1500), 1425, 'the Hall keeps 5%');
    assert.equal(W.auctionPaid(S.s, 'lstBBBBBB2', 1500), 0, 'paid once');
    // buy now: a bid at the price, then bought out (ends it at once)
    const b2 = Object.assign({}, l, { b: { u: 'uidB', v: 4000, t: NOW } });
    assert.ok(M.allowedAuctionWrite(b2, Object.assign({}, b2, { bo: 'uidB' }), 'uidB', NOW));
    assert.ok(M.auctionView(Object.assign({}, b2, { bo: 'uidB' }), 'uidB', NOW).canClaim);
    // no bids: back to the seller; won but unclaimed: back after 3 days
    const S2 = player();
    const l2 = W.auctionList(S2.s, { kind: 'g', id: S2.piece.id }, 'lstCCCCCC3', { uid: 'uidS', min: 10, hours: 1 }, NOW).listing;
    assert.equal(S2.s.satchel.length, 0);
    assert.ok(M.auctionView(l2, 'uidS', l2.end + 1).canReturn);
    assert.ok(M.allowedAuctionWrite(l2, Object.assign({}, l2, { rt: true }), 'uidS', l2.end + 1));
    assert.ok(W.auctionReturn(S2.s, 'lstCCCCCC3'));
    assert.equal(S2.s.satchel.length, 1);
    const w2 = Object.assign({}, l2, { b: { u: 'uidB', v: 10, t: NOW } });
    assert.equal(M.allowedAuctionWrite(w2, Object.assign({}, w2, { rt: true }), 'uidS', l2.end + 1), false, 'the winner has 3 days');
    assert.ok(M.allowedAuctionWrite(w2, Object.assign({}, w2, { rt: true }), 'uidS', l2.end + M.AUCTION.claimMs + 1));
    // removing a listing: the seller once it's settled, anyone after two weeks
    assert.ok(M.allowedAuctionWrite(Object.assign({}, claimed, { pd: true }), null, 'uidS', after));
    assert.equal(M.allowedAuctionWrite(claimed, null, 'uidS', after), false);
    assert.ok(M.allowedAuctionWrite(claimed, null, 'uidX', l.end + M.AUCTION.keepMs + 1));
});

test('limits: 5 listings at once, 10 trades a day, 100,000 rubies in a trade, 4 items a side', () => {
    const S = player(1e9);
    for (let i = 0; i < 6; i++) W.addGear(S.s, 'bow_3', 50, [], NOW);
    const bows = S.s.gear.filter(g => g.base === 'bow_3');
    for (let i = 0; i < M.AUCTION.maxListings; i++) assert.equal(W.auctionList(S.s, { kind: 'w', uid: bows[i].uid }, 'lstDDDDDD' + i, { min: 5, hours: 6 }, NOW).ok, true);
    assert.equal(W.auctionList(S.s, { kind: 'w', uid: bows[5].uid }, 'lstEEEEEE1', { min: 5, hours: 6 }, NOW).reason, 'listings');
    assert.equal(W.auctionList(S.s, { kind: 'w', uid: S.s.hotbar[0] }, 'lstEEEEEE2', { min: 5 }, NOW).reason, 'listings');
    const T = player(1e9);
    T.s.market.trades = M.TRADE.perDay; T.s.market.day = W.dayKey(NOW);
    assert.equal(W.tradeStart(T.s, 'tradeDDDD4', 'u', 'n', NOW).reason, 'day');
    assert.ok(W.tradeStart(T.s, 'tradeDDDD4', 'u', 'n', NOW + 86400000).ok, 'a new day');
    W.tradeSetOffer(T.s, [], 1e9);
    assert.equal(T.s.market.trade.r, M.TRADE.maxRubies);
    for (let i = 0; i < 5; i++) W.addGear(T.s, 'dagger_2', 50, [], NOW);
    const daggers = T.s.gear.filter(g => g.base === 'dagger_2').map(g => ({ kind: 'w', uid: g.uid }));
    assert.equal(W.tradeSetOffer(T.s, daggers, 0).reason, 'count');
    const eq = player(); W.tradeStart(eq.s, 'tradeEEEE5', 'u', 'n', NOW);
    assert.equal(W.tradeSetOffer(eq.s, [{ kind: 'w', uid: eq.s.hotbar[0] }], 0).reason, 'equipped', 'what you hold stays with you');
});

test('the database rules match: who may write each part of a trade and a listing, and the limits', () => {
    const t = rules.trade.$tid, ah = rules.market.ah.$lid;
    assert.match(t['.validate'], /\^\[A-Za-z0-9\]\{8,12\}\$/);
    assert.ok(t.s.$uid['.write'].includes("data.child('c').val() !== data.parent()"), 'a side is frozen once both confirmed the same deal');
    assert.match(t.s.$uid.r['.validate'], new RegExp('<= ' + M.TRADE.maxRubies));
    assert.ok(t.done.$uid['.write'].includes('!data.exists()'), 'done once');
    assert.match(ah.it['.validate'], new RegExp('<= ' + M.AUCTION.maxItemLen));
    assert.match(ah.min['.validate'], new RegExp('<= ' + M.AUCTION.maxPrice));
    assert.match(ah.b['.validate'], new RegExp('\\* ' + M.AUCTION.step.toString().replace('.', '\\.')), 'bids beat the top by the step');
    assert.match(ah.end['.validate'], new RegExp('now \\+ ' + (M.AUCTION.maxHours * 3600000 + 10000)));
    assert.match(ah.rt['.write'], new RegExp(String(M.AUCTION.claimMs)), 'three days to claim');
    for (const k of ['cl', 'pd', 'rt', 'bo']) assert.ok(ah[k]['.write'].includes('!data.exists()'), k + ' is written once');
    assert.ok(ah['.write'].includes(String(M.AUCTION.keepMs)), 'cleared after two weeks');
    assert.equal(M.TRADE_ROOT, 'wilds/v1/trade');
    assert.equal(M.AH_ROOT, 'wilds/v1/market/ah');
    // a trade invitation is a message kind the arena's message cleaner keeps
    const Ar = require('../core/world-arena');
    for (const m of ['trade', 'tyes', 'tno']) assert.ok(Ar.cleanMsg({ from: 'uid1234', m, id: 'x', t: 1 }), m);
});
