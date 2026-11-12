/**
 * Trading and the Auction Hall (The Wilds): players swap gear (Wilds gear, relics, and gear for the game from the Relic
 * Satchel) and rubies, face to face or by auction. There is no server: each page keeps its own save, so this file holds the
 * rules every page follows and the shapes in the database (database.rules.json `trade` and `market`), and the rules there
 * enforce the parts that can be enforced (who may write what, when, bids only going up, write-once claims and payouts).
 *
 * - An item travels as a short string (packItem): its base, score, affixes, relic and sockets, or a game piece. The page
 *   that receives one rebuilds it through the same cleaning as a save load (unpackItem), so nothing can be made stronger
 *   than the tables allow. Who forged it and how often it changed hands travel with it.
 * - Direct trade (wilds/v1/trade/{tid}): { a, b (the two players), an, bn (names), t, s: { uid: { o (packed items, JSON),
 *   r (rubies), ok (the deal hash they accepted), c (the hash they confirmed), x (cancelled) } }, done: { uid: true } }.
 *   Each side writes only its own s/{uid}. dealHash covers both offers, so changing either makes old acceptances stale. Once
 *   both have confirmed the same hash, the rules freeze both offers and each page settles its own side: its offer leaves
 *   (it was set aside in the save when offered), the other's arrives. tradeView works out where a trade stands.
 * - Auction Hall (wilds/v1/market/ah/{lid}): { s (seller), sn, it (packed item), min, buy (0: none), end, t, b: { u, n, v, t }
 *   (the top bid), bo (bought out by), cl (claimed by the winner), pd (seller paid), rt (returned to the seller) }. A bid
 *   must beat the top one by AUCTION.step; the bidder's rubies are set aside while they lead. auctionView works out where a
 *   listing stands; allowedAuctionWrite says what the rules allow (tests check the two agree).
 * Pure: callers pass `now` (server time, ms) and `rng`.
 *
 * Works in a browser (<script src="core/world-market.js"> after world-data.js, gear.js and world-relics.js sets
 * window.WHWorldMarket) and in Node.
 */
(function (root, factory) {
    if (typeof module === 'object' && module.exports) module.exports = factory(require('./world-data'), require('./gear'), require('./world-relics'));
    else root.WHWorldMarket = factory(root.WHWorldData, root.WHGear, root.WHWorldRelics);
}(typeof self !== 'undefined' ? self : this, function (D, Gr, R) {
    'use strict';

    const TRADE_ROOT = 'wilds/v1/trade';
    const AH_ROOT = 'wilds/v1/market/ah';
    const TRADE = { maxItems: 4, maxRubies: 100000, perDay: 10, expireMs: 30 * 60 * 1000, keepMs: 14 * 86400000 };
    const AUCTION = { maxListings: 5, minHours: 1, maxHours: 48, hours: [1, 6, 12, 24, 48], step: 1.05, fee: 0.05, minPrice: 1, maxPrice: 100000, claimMs: 3 * 86400000, keepMs: 14 * 86400000, maxItemLen: 900 };
    const ID_RE = /^[A-Za-z0-9]{8,12}$/;
    const isObj = (v) => !!v && typeof v === 'object' && !Array.isArray(v);
    const int = (v, lo, hi) => Math.max(lo, Math.min(hi, Math.floor(Number(v) || 0)));
    const name16 = (v) => (typeof v === 'string' ? v.replace(/[<>&"'`]/g, '').slice(0, 16) : '');

    function newId(rng) { let s = ''; for (let i = 0; i < 10; i++) s += 'abcdefghijkmnopqrstuvwxyzABCDEFGHJKLMNPQRSTUVWXYZ23456789'[Math.floor(rng() * 56) % 56]; return s; }
    const tradePath = (tid, sub) => TRADE_ROOT + '/' + tid + (sub ? '/' + sub : '');
    const ahPath = (lid, sub) => AH_ROOT + (lid ? '/' + lid : '') + (sub ? '/' + sub : '');

    // ---------------- items ----------------
    // what may be traded: any Wilds gear but the starter kit (its plain pieces), and any game piece
    function tradeable(it) {
        if (!it || !D.GEAR_BY_ID[it.base]) return false;
        return !(it.score === 40 && !it.r && !it.k && (D.STARTER_KIT.includes(it.base) || it.base === D.STARTER_OFFHAND));
    }
    // A piece of Wilds gear ({ base, score, aff, r, k }) or a game piece, as one string
    function packItem(x) {
        if (x && x.kind === 'g') { const p = Gr.cleanPiece(x.piece); return p ? JSON.stringify({ k: 'g', p: Object.assign({}, p, { id: 0 }) }) : ''; }
        const it = x && x.item;
        if (!it || !D.GEAR_BY_ID[it.base]) return '';
        const out = { k: 'w', b: it.base, s: int(it.score, 0, 100), a: (it.aff || []).slice(0, 2) };
        if (it.r) out.r = it.r;
        if (it.k && it.k.length) out.x = it.k;
        return JSON.stringify(out);
    }
    // A string from another player, made safe: { kind: 'w', item: { base, score, aff, r?, k? } } or { kind: 'g', piece }, or null.
    // traded: count one more change of hands
    function unpackItem(str, traded) {
        if (typeof str !== 'string' || !str || str.length > AUCTION.maxItemLen) return null;
        let o;
        try { o = JSON.parse(str); } catch (e) { return null; }
        if (!isObj(o)) return null;
        const bump = traded ? 1 : 0;
        if (o.k === 'g') {
            const p = Gr.cleanPiece(o.p);
            if (!p) return null;
            p.id = 0; p.n = Math.min(999, p.n + bump);
            return { kind: 'g', piece: p };
        }
        if (o.k !== 'w' || !D.GEAR_BY_ID[o.b]) return null;
        const item = { base: o.b, score: int(o.s, 0, 100), aff: (Array.isArray(o.a) ? o.a : []).filter(a => D.AFFIXES[a]).slice(0, 2) };
        const r = R.cleanRelic(o.r, o.b);
        if (r) { r.n = Math.min(999, r.n + bump); item.r = r; }
        const k = R.cleanSockets(o.x, R.socketCount(item));
        if (k.length) item.k = k;
        return { kind: 'w', item };
    }
    // its name, the colour of its rarity, and who made it
    function itemLabel(x) {
        if (!x) return { name: 'Something', color: '#b4bccd', by: '', n: 0 };
        if (x.kind === 'g') return { name: Gr.pieceName(x.piece) + ' (for the game)', color: Gr.TIERS[x.piece.t].color, by: x.piece.by, n: x.piece.n };
        const it = x.item, b = D.GEAR_BY_ID[it.base];
        if (it.r) return { name: R.relicName(Object.assign({ uid: 0 }, it)), color: Gr.TIERS[it.r.t].color, by: it.r.by, n: it.r.n };
        const q = D.QUALITY.slice().reverse().find(t => it.score >= t.min) || D.QUALITY[0];
        return { name: b.name + (q.id === 'common' ? '' : ' (' + q.name + ')'), color: q.color, by: '', n: 0 };
    }

    // ---------------- direct trade ----------------
    function hashStr(str) { let h = 2166136261 >>> 0; for (let i = 0; i < str.length; i++) { h ^= str.charCodeAt(i); h = Math.imul(h, 16777619) >>> 0; } return h.toString(36); }
    // an offer: { o: [packed items], r: rubies }, cleaned
    function cleanOffer(raw) {
        if (!isObj(raw)) return { o: [], r: 0 };
        let list = [];
        try { list = typeof raw.o === 'string' ? JSON.parse(raw.o) : Array.isArray(raw.o) ? raw.o : []; } catch (e) { list = []; }
        return { o: (Array.isArray(list) ? list : []).filter(s => typeof s === 'string' && s.length <= AUCTION.maxItemLen).slice(0, TRADE.maxItems), r: int(raw.r, 0, TRADE.maxRubies) };
    }
    // the deal both sides agree to: both offers, in the order of the players' ids
    function dealHash(trade) {
        const a = cleanOffer(trade.s && trade.s[trade.a]), b = cleanOffer(trade.s && trade.s[trade.b]);
        return hashStr(JSON.stringify([trade.a, a.o, a.r, trade.b, b.o, b.r]));
    }
    // Where a trade stands, for player me: { ok (it is a trade I'm in), other, mine, theirs (offers), hash, accepted:
    // { me, them }, confirmed: { me, them }, final (both confirmed this very deal), cancelled, expired }
    function tradeView(trade, me, now) {
        if (!isObj(trade) || !trade.a || !trade.b || (me !== trade.a && me !== trade.b)) return { ok: false };
        const other = me === trade.a ? trade.b : trade.a, s = isObj(trade.s) ? trade.s : {};
        const my = isObj(s[me]) ? s[me] : {}, th = isObj(s[other]) ? s[other] : {};
        const hash = dealHash(trade);
        const final = !!my.c && my.c === th.c && my.c === hash;
        return {
            ok: true, other, otherName: name16(me === trade.a ? trade.bn : trade.an), mine: cleanOffer(my), theirs: cleanOffer(th), hash,
            accepted: { me: my.ok === hash, them: th.ok === hash }, confirmed: { me: my.c === hash, them: th.c === hash }, final,
            cancelled: !final && (!!my.x || !!th.x), expired: !final && now - (Number(trade.t) || 0) > TRADE.expireMs,
            done: { me: !!(trade.done && trade.done[me]), them: !!(trade.done && trade.done[other]) },
        };
    }
    // What the rules let player uid write to their own side s/{uid} (mirrors database.rules.json): only in a trade they're in,
    // and never once both sides have confirmed the same deal (it is frozen then)
    function allowedSideWrite(trade, uid) {
        if (!isObj(trade) || (uid !== trade.a && uid !== trade.b)) return false;
        const other = uid === trade.a ? trade.b : trade.a, s = isObj(trade.s) ? trade.s : {};
        const mine = isObj(s[uid]) ? s[uid].c : undefined, theirs = isObj(s[other]) ? s[other].c : undefined;
        return !mine || mine !== theirs;
    }

    // ---------------- the Auction Hall ----------------
    // the least the next bid may be
    function minBid(l) { return l && l.b && l.b.v ? Math.ceil(l.b.v * AUCTION.step) : Math.max(AUCTION.minPrice, int(l && l.min, 0, AUCTION.maxPrice)); }
    // what the seller gets for a sale (the Auction Hall keeps its fee)
    function sellerTakes(v) { return Math.floor(int(v, 0, AUCTION.maxPrice) * (1 - AUCTION.fee)); }
    // Where a listing stands at time now, for player me: { ended, top (bid), winner (uid or null), minNext, canBid, canBuy,
    // canClaim, canPay, canReturn, mine (I sell it), leading (my bid is on top) }
    function auctionView(l, me, now) {
        if (!isObj(l)) return { ok: false };
        const top = isObj(l.b) && l.b.v > 0 ? { u: String(l.b.u || ''), n: name16(l.b.n), v: int(l.b.v, 0, AUCTION.maxPrice) } : null;
        const ended = now >= Number(l.end) || !!l.bo;
        const mine = l.s === me;
        const winner = ended && top ? top.u : null;
        return {
            ok: true, ended, top, winner, mine, leading: !!top && top.u === me, minNext: minBid(l), left: Math.max(0, Number(l.end) - now),
            canBid: !ended && !mine && !!me, canBuy: !ended && !mine && l.buy > 0 && (!top || top.v < l.buy),
            canClaim: !!winner && winner === me && !l.cl && !l.rt,
            canPay: mine && !!l.cl && !l.pd,
            canReturn: mine && ended && !l.cl && !l.rt && (!top || now >= Number(l.end) + AUCTION.claimMs),
            claimed: !!l.cl, paid: !!l.pd, returned: !!l.rt,
        };
    }
    // a new listing's fields (the page writes them). hours: AUCTION.hours
    function makeListing(o, now) {
        const min = int(o.min, AUCTION.minPrice, AUCTION.maxPrice), buy = o.buy ? int(o.buy, 0, AUCTION.maxPrice) : 0;
        const hours = AUCTION.hours.includes(Number(o.hours)) ? Number(o.hours) : 24;
        return { s: o.uid, sn: name16(o.name), it: o.it, min, buy: buy && buy >= min ? buy : 0, end: now + hours * 3600000, t: now };
    }
    // What the rules let player uid do to listing before (null: none yet) to make it after (null: removed) at time now. The
    // database's rules say the same (database.rules.json market/ah); a test checks the two on the same cases.
    function allowedAuctionWrite(before, after, uid, now) {
        if (!uid) return false;
        if (!before) {
            if (!isObj(after)) return false;
            return after.s === uid && typeof after.it === 'string' && after.it.length <= AUCTION.maxItemLen && after.min >= AUCTION.minPrice && after.min <= AUCTION.maxPrice
                && (!after.buy || (after.buy >= 0 && after.buy <= AUCTION.maxPrice)) && Math.abs(after.t - now) <= 10000
                && after.end >= now + AUCTION.minHours * 3600000 - 100000 && after.end <= now + AUCTION.maxHours * 3600000 + 10000
                && !after.b && !after.bo && !after.cl && !after.pd && !after.rt;
        }
        if (!after) return (before.s === uid && (!!before.pd || !!before.rt)) || now > before.end + AUCTION.keepMs;
        for (const k of ['s', 'sn', 'it', 'min', 'buy', 'end', 't']) if (after[k] !== before[k]) return false;
        const changed = ['b', 'bo', 'cl', 'pd', 'rt'].filter(k => JSON.stringify(after[k]) !== JSON.stringify(before[k]));
        if (changed.length !== 1) return false;
        const k = changed[0], ended = now >= before.end || !!before.bo;
        if (k === 'b') {
            const b = after.b;
            return isObj(b) && uid !== before.s && !ended && b.u === uid && b.v >= before.min && b.v <= AUCTION.maxPrice
                && (!before.b || b.v >= before.b.v * AUCTION.step) && Math.abs(b.t - now) <= 10000;
        }
        if (before[k]) return false; // the rest are written once
        if (k === 'bo') return after.bo === uid && before.buy > 0 && !!before.b && before.b.u === uid && before.b.v >= before.buy;
        if (k === 'cl') return after.cl === uid && !!before.b && before.b.u === uid && ended && !before.rt;
        if (k === 'pd') return after.pd === true && before.s === uid && !!before.cl;
        if (k === 'rt') return after.rt === true && before.s === uid && !before.cl && now >= before.end && (!before.b || now >= before.end + AUCTION.claimMs);
        return false;
    }

    return { TRADE_ROOT, AH_ROOT, TRADE, AUCTION, ID_RE, newId, tradePath, ahPath, tradeable, packItem, unpackItem, itemLabel, cleanOffer, dealHash, tradeView,
        allowedSideWrite, minBid, sellerTakes, auctionView, makeListing, allowedAuctionWrite };
}));
