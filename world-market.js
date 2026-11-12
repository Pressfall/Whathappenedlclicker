/**
 * Trading and the Auction Hall (The Wilds), the page side. The rules are core/world-market.js; the save changes are
 * core/world-logic.js (tradeStart / tradeSetOffer / tradeSettle / tradeCancel, auctionList / auctionHold / auctionRelease /
 * auctionWon / auctionPaid / auctionReturn); the database shapes and rules are database.rules.json `trade` and `market`.
 *
 * - A trade starts from a player's card (E next to them: world-party.js openPlayer): a 'trade' message invites them, the
 *   trade lives at wilds/v1/trade/{tid}. Each side sets its offer (what it offers is set aside in its own save), accepts the
 *   deal, then confirms it. Once both have confirmed the same deal it is frozen and each page settles its own side.
 * - The Auction Hall is the Auctioneer's (an NPC on the plaza): list an item with a starting price, an optional buyout and a
 *   length; bid on others' (your rubies are set aside while you lead); the winner claims the item, then the seller is paid.
 * - A loop (every few seconds while online) watches the trade you are in and the listings you sell or bid on, and settles
 *   whatever is due, so nothing waits on a screen being open. Every write that pays or gives something is a db.commit, and
 *   nothing is paid until the database has taken it.
 * WHW.market = { inviteTrade, onMessage, openTrade, openAuction, tick }
 */
(function () {
    'use strict';
    const D = window.WHWorldData, W = window.WHWorld, M = window.WHWorldMarket, Gr = window.WHGear;
    const WHW = window.WHW;
    const UI = () => WHW.ui;
    const game = () => WHW.game;
    const net = () => WHW.online;
    const esc = (s) => UI().esc(s);
    const fmt = (n) => Math.round(n).toLocaleString('en-US');
    const online = () => !!(net() && net().db && net().status === 'online' && typeof net().db.commit === 'function');
    const me = () => net().uid;
    const sNow = () => net().db.serverNow();
    const myName = () => (net() && net().name ? net().name() : 'Adventurer');

    const MK = WHW.market = { trade: null, tradeOff: null, tradeTid: '', invite: null, ah: null, ahOff: null, busy: false };

    // ---------------- what can be offered or listed ----------------
    // [{ ref, label, svg }]: gear not worn (not the starter kit) and gear for the game in the satchel
    function myItems(s) {
        const out = [];
        for (const it of s.gear) {
            if (W.isEquipped(s, it.uid) || !M.tradeable(it)) continue;
            const x = { kind: 'w', item: it };
            out.push({ ref: { kind: 'w', uid: it.uid }, item: it, label: M.itemLabel(x), svg: UI().iconFor(W.baseOf(it), it) });
        }
        for (const p of s.satchel) out.push({ ref: { kind: 'g', id: p.id }, piece: p, label: M.itemLabel({ kind: 'g', piece: p }), svg: Gr.pieceSvg(p) });
        return out;
    }
    // a packed item's card: picture, name in its rarity's colour, who made it
    function itemCard(str, extra) {
        const x = M.unpackItem(str, false);
        if (!x) return '<div class="w-card is-locked"><div class="w-card-name">Something unreadable</div></div>';
        const l = M.itemLabel(x);
        const svg = x.kind === 'g' ? Gr.pieceSvg(x.piece) : UI().iconFor(D.GEAR_BY_ID[x.item.base], Object.assign({ uid: 0 }, x.item));
        const stats = x.kind === 'g' ? `<div class="w-card-stats">${x.piece.l.map(([a, r]) => `<span>${D.ASPECTS[a].icon} ${esc(Gr.lineText(a, x.piece.t, r, x.piece.lv))}</span>`).join('')}</div>`
            : UI().statLine(D.GEAR_BY_ID[x.item.base], Object.assign({ uid: 0, at: 0 }, x.item));
        return `<div class="w-card w-market-item"><div class="w-card-top"><div class="w-card-ico" style="border-color:${l.color}">${svg}</div>
            <div><div class="w-card-name" style="color:${l.color}">${esc(l.name)}</div>${sub(x, l)}</div></div>${stats}${extra || ''}</div>`;
    }
    // who made it and how often it changed hands (a Wilds relic's own line already says so, under its stats)
    function sub(x, l) {
        if (x.kind === 'w' && x.item.r) return '';
        const bits = [l.by ? 'forged by ' + esc(l.by) : '', l.n ? 'changed hands ' + l.n + '×' : ''].filter(Boolean);
        return bits.length ? `<div class="w-card-sub">${bits.join(' · ')}</div>` : '';
    }
    // an item I could offer or list: its card with its numbers, so you can see what you are giving up
    function myItemCard(it, actions) {
        const stats = it.ref.kind === 'g' ? `<div class="w-card-stats">${it.piece.l.map(([a, r]) => `<span>${D.ASPECTS[a].icon} ${esc(Gr.lineText(a, it.piece.t, r, it.piece.lv))}</span>`).join('')}</div>`
            : UI().statLine(W.baseOf(it.item), it.item);
        return `<div class="w-card w-market-item"><div class="w-card-top"><div class="w-card-ico" style="border-color:${it.label.color}">${it.svg}</div><div><div class="w-card-name" style="color:${it.label.color}">${esc(it.label.name)}</div></div></div>${stats}<div class="w-card-actions">${actions}</div></div>`;
    }

    // ================= direct trade =================
    MK.inviteTrade = function (r) {
        const s = game().state;
        if (!online()) { WHW.toast('Trading needs online play.', 'bad'); return; }
        if (s.market.trade) { WHW.toast('Finish the trade you are in first.', 'bad'); MK.openTrade(); return; }
        if (!W.tradesLeft(s, Date.now())) { WHW.toast('That is all the trading for today (' + M.TRADE.perDay + ' a day).', 'bad'); return; }
        const tid = M.newId(Math.random), name = (r.info && r.info.n) || 'Adventurer';
        W.tradeStart(s, tid, r.uid, name, Date.now());
        WHW.save();
        net().db.commit(M.tradePath(tid), { a: me(), b: r.uid, an: myName(), bn: name.slice(0, 16), t: sNow() }).then((ok) => {
            if (!ok) { W.tradeCancel(s); WHW.save(); WHW.toast("The trade couldn't start (the database refused it: its rules may need publishing).", 'bad'); return; }
            net().send(r.uid, 'trade', tid, myName());
            WHW.toast('🤝 Trade offered to ' + name + '. Waiting for them to open it…');
            watch(tid);
            MK.openTrade();
        });
    };
    MK.onMessage = function (msg) {
        const s = game().state;
        const r = net().remotes.get(msg.from), name = (r && r.info && r.info.n) || (msg.x && msg.x.slice(0, 16)) || 'Someone';
        if (msg.m === 'trade') {
            if (!M.ID_RE.test(msg.id)) return;
            if (s.market.trade || !W.tradesLeft(s, Date.now())) { net().send(msg.from, 'tno', msg.id, ''); return; }
            MK.invite = { from: msg.from, tid: msg.id, name };
            const body = UI().modal('🤝 A trade', `<p><b>${esc(name)}</b> wants to trade with you: gear, relics, gear for the game and rubies. Nothing changes hands until you both confirm the same deal.</p>
                <div class="w-row" style="justify-content:center"><button class="btn btn-gold" id="tYes">Open the trade</button><button class="btn btn-ghost" id="tNo">No thanks</button></div>`);
            body.querySelector('#tYes').addEventListener('click', () => answer(true));
            body.querySelector('#tNo').addEventListener('click', () => answer(false));
            WHW.sfx && WHW.sfx('craft');
        } else if (msg.m === 'tyes') {
            if (s.market.trade && s.market.trade.tid === msg.id) WHW.toast(name + ' opened the trade.', 'gold');
        } else if (msg.m === 'tno') {
            if (s.market.trade && s.market.trade.tid === msg.id) { cancelTrade(); WHW.toast(name + " doesn't want to trade right now."); }
        }
    };
    function answer(yes) {
        const inv = MK.invite, s = game().state;
        MK.invite = null;
        UI().closeModal();
        if (!inv) return;
        if (!yes) { net().send(inv.from, 'tno', inv.tid, ''); return; }
        const r = W.tradeStart(s, inv.tid, inv.from, inv.name, Date.now());
        if (!r.ok) { net().send(inv.from, 'tno', inv.tid, ''); WHW.toast(r.reason === 'day' ? "That's all the trading for today." : 'Finish your other trade first.', 'bad'); return; }
        WHW.save();
        net().send(inv.from, 'tyes', inv.tid, '');
        watch(inv.tid);
        MK.openTrade();
    }
    // follow the trade's record in the database
    function watch(tid) {
        if (MK.tradeTid === tid && MK.tradeOff) return;
        if (MK.tradeOff) MK.tradeOff();
        MK.tradeTid = tid; MK.trade = undefined; MK.seenNode = false;
        MK.tradeOff = net().db.onValue(M.tradePath(tid), (v) => { MK.trade = v; if (v) MK.seenNode = true; onTrade(); });
    }
    function unwatch() { if (MK.tradeOff) MK.tradeOff(); MK.tradeOff = null; MK.tradeTid = ''; MK.trade = null; renderChip(); }
    // the trade's record changed (or is gone): settle, call off, or redraw
    function onTrade() {
        const s = game().state, t = s.market.trade;
        if (!t || t.tid !== MK.tradeTid || MK.busy) { renderTrade(); return; }
        const node = MK.trade;
        if (node === null) {
            // not there yet (just made, still on its way here): wait a little before deciding it's gone
            if (!MK.seenNode && Date.now() - t.at < 20000) return;
            // gone: it went through (we saw both confirm) or was called off. (The rules only let it be removed once both
            // sides are done, once a side called it off, or after two weeks.)
            if (t.theirs) settle(t.theirs, false); else { W.tradeCancel(s); WHW.save(); WHW.refreshPlayer(); WHW.toast('The trade was called off. What you offered is back.'); unwatch(); }
            closeTradeWindow();
            return;
        }
        if (node === undefined) return;
        const v = M.tradeView(node, me(), sNow());
        if (!v.ok) return;
        if (v.final) {
            // frozen: what I give is exactly what the deal says (the save is made to match it first)
            if (!t.theirs) { W.tradeReconcile(s, v.mine); W.tradeConfirmed(s, v.hash, v.theirs); WHW.save(); }
            if (!v.done.me) { settle(v.theirs, true); return; }
        } else if (v.cancelled || v.expired) {
            // say so first (it may have been confirmed by both in the very same moment: then that write is refused, and
            // the trade goes through instead)
            net().db.commit(M.tradePath(t.tid, 's/' + me()), { o: JSON.stringify(v.mine.o), r: v.mine.r, x: true }).then((ok) => {
                if (!ok || !s.market.trade || s.market.trade.tid !== t.tid) return;
                W.tradeCancel(s); WHW.save(); WHW.refreshPlayer();
                WHW.toast(v.expired ? 'The trade ran out of time. What you offered is back.' : 'The trade was called off. What you offered is back.');
                net().db.commit(M.tradePath(t.tid), null);
                unwatch(); closeTradeWindow();
            });
            return;
        }
        renderTrade();
    }
    function settle(theirs, mark) {
        const s = game().state, t = s.market.trade, tid = t.tid;
        MK.busy = true;
        const res = W.tradeSettle(s, theirs, Date.now());
        WHW.save(); WHW.refreshPlayer();
        const got = res.got.map(x => M.itemLabel(x).name);
        WHW.toast('🤝 Trade done! You got ' + (got.length ? got.join(', ') : 'no items') + (res.rubies ? ' and ♦ ' + fmt(res.rubies) : '') + '.' + (res.waiting ? ' (' + res.waiting + ' waiting for room in your bag.)' : ''), 'gold');
        WHW.sfx('boss');
        const after = () => { MK.busy = false; unwatch(); closeTradeWindow(); };
        if (!mark) { after(); return; }
        net().db.commit(M.tradePath(tid, 'done/' + me()), true).then(() => {
            // the second one done tidies up
            const node = MK.trade;
            const v = node && M.tradeView(node, me(), sNow());
            if (v && v.ok && v.done.them) net().db.commit(M.tradePath(tid), null);
            after();
        });
    }
    function cancelTrade() {
        const s = game().state, t = s.market.trade;
        if (!t) return;
        const node = MK.trade, v = node ? M.tradeView(node, me(), sNow()) : null;
        if (v && v.ok && v.final) { WHW.toast('Too late: you both confirmed. It is going through.', 'bad'); return; }
        const back = () => { W.tradeCancel(s); WHW.save(); WHW.refreshPlayer(); unwatch(); closeTradeWindow(); WHW.toast('Trade called off. What you offered is back.'); };
        // never started in the database (or offline): nothing to tell anyone
        if (!online() || !node) { back(); return; }
        // the database first: if both had just confirmed, it refuses, and the trade goes through instead
        net().db.commit(M.tradePath(t.tid, 's/' + me()), { o: JSON.stringify(v.mine.o), r: v.mine.r, x: true }).then((ok) => {
            if (!ok) { WHW.toast("It couldn't be called off: you may both have just confirmed.", 'bad'); return; }
            back();
            net().db.commit(M.tradePath(t.tid), null);
        });
    }
    // before accepting or confirming: the save sets aside exactly what the database shows I offer
    function matchOffer(v) {
        const s = game().state;
        if (W.heldMatches(s, v.mine)) return true;
        const ok = W.tradeReconcile(s, v.mine);
        WHW.save(); WHW.refreshPlayer();
        if (!ok) { WHW.toast("Your offer doesn't match what you have any more: change it, then accept.", 'bad'); renderTrade(); }
        return ok;
    }
    // my offer: set it aside in the save, then say it in the database (both acceptances lapse, as the deal changed)
    function setOffer(refs, rubies) {
        const s = game().state, t = s.market.trade;
        const r = W.tradeSetOffer(s, refs, rubies);
        if (!r.ok) { WHW.toast({ rubies: 'Not enough rubies.', count: 'At most ' + M.TRADE.maxItems + ' items.', equipped: 'Take it off first.', starter: 'The starter kit stays with you.' }[r.reason] || "Can't offer that.", 'bad'); return; }
        WHW.save(); WHW.refreshPlayer();
        net().db.commit(M.tradePath(t.tid, 's/' + me()), { o: JSON.stringify(r.offer.o), r: r.offer.r, ok: '', c: '' }).then((ok) => { if (!ok) WHW.toast("The offer didn't go through: it may be frozen (both confirmed).", 'bad'); });
    }
    let tradeOpen = false;
    MK.openTrade = function () {
        if (!game().state.market.trade) { WHW.toast('No trade going.'); return; }
        tradeOpen = true;
        UI().modal('🤝 Trade with ' + game().state.market.trade.wn, '', { wide: true, render: renderTrade, onClose: () => { tradeOpen = false; renderChip(); } });
        renderTrade();
        renderChip();
    };
    function closeTradeWindow() { if (tradeOpen) { tradeOpen = false; UI().closeModal(); } renderChip(); }
    function renderTrade() {
        renderChip();
        if (!tradeOpen) return;
        const body = document.getElementById('wModalBody'), s = game().state, t = s.market.trade;
        if (!body || !t) return;
        const node = MK.trade, v = node ? M.tradeView(node, me(), sNow()) : null;
        if (!v || !v.ok) { body.innerHTML = '<p class="w-note">Opening the trade…</p>'; return; }
        // where each side stands, as a pill by its name
        const status = (side) => (v.confirmed[side] ? '<span class="w-tstat is-done">✅ Confirmed</span>' : v.accepted[side] ? '<span class="w-tstat is-ok">👍 Accepted</span>' : '<span class="w-tstat">Deciding…</span>');
        const offerCol = (who, offer, mine) => `<section class="w-panel"><h3><span>${esc(who)}</span>${status(mine ? 'me' : 'them')}</h3>
            ${offer.o.length ? offer.o.map((str, i) => itemCard(str, mine && !v.final && !v.confirmed.me ? `<div class="w-card-actions"><button class="btn btn-sm btn-ghost" data-tdrop="${i}">Take back</button></div>` : '')).join('') : `<p class="muted">${mine ? 'No items yet: add some below.' : 'No items.'}</p>`}
            <p class="w-trade-rubies">${offer.r ? `♦ <b>${fmt(offer.r)}</b> rubies` : '<span class="muted">No rubies</span>'}</p></section>`;
        // the three steps, the one the deal is at lit
        const step = v.final ? 3 : v.accepted.me && v.accepted.them ? 2 : 1;
        let html = `<details class="w-how"><summary>Put in what you offer, <b>Accept</b> when the deal looks right, then <b>Confirm</b> once you both have.</summary>
            <p>Any change to either side means accepting again. Once you both confirm the same deal, it goes through on both sides. What you offer is set aside until then (a reload keeps it safe) and comes back if the trade is called off. Up to ${M.TRADE.maxItems} items and ♦ ${fmt(M.TRADE.maxRubies)} each; ${W.tradesLeft(s, Date.now())} trades left today.</p></details>
            <div class="w-trade-steps" aria-label="Where the trade is"><span class="${step === 1 ? 'is-on' : ''}">1 · Make offers, accept</span><span class="${step === 2 ? 'is-on' : ''}">2 · Both confirm</span><span class="${step === 3 ? 'is-on' : ''}">3 · Done</span></div>
            <div class="w-trade">${offerCol('You offer', v.mine, true)}${offerCol(v.otherName || t.wn, v.theirs, false)}</div>`;
        if (!v.final && v.confirmed.me) {
            // confirmed: the offer is fixed now (calling it off is the way to change it)
            html += `<p class="w-note" style="text-align:center"><b>You confirmed.</b> Waiting for ${esc(v.otherName || t.wn)} to confirm the same deal.</p>
                <div class="w-row" style="justify-content:center"><button class="btn btn-danger" id="tCancel">Call it off</button></div>`;
        } else if (!v.final) {
            const items = myItems(s);
            html += `<div class="w-section"><h3>Add to your offer <span class="muted">${v.mine.o.length} / ${M.TRADE.maxItems} items</span></h3><div class="w-row"><label class="w-sort">Rubies <input type="number" id="tRubies" min="0" max="${Math.min(M.TRADE.maxRubies, s.rubies + v.mine.r)}" value="${v.mine.r}" style="width:110px"></label><button class="btn btn-sm btn-ghost" id="tSetR">Set rubies</button><span class="muted" style="font-size:12px">you have ♦ ${fmt(s.rubies)}</span></div>
                <div class="w-grid">${items.length ? items.slice(0, 60).map((it, i) => myItemCard(it, `<button class="btn btn-sm btn-primary" data-tadd="${i}" ${v.mine.o.length >= M.TRADE.maxItems ? 'disabled' : ''}>Offer</button>`)).join('') : '<p class="muted">Nothing to offer: worn gear and the starter kit stay with you.</p>'}</div></div>`;
            html += `<div class="w-row" style="justify-content:center;margin-top:10px">
                <button class="btn btn-primary" id="tAccept" ${v.accepted.me ? 'disabled' : ''}>${v.accepted.me ? 'Accepted' : 'Accept this deal'}</button>
                <button class="btn btn-gold" id="tConfirm" ${v.accepted.me && v.accepted.them && !v.confirmed.me ? '' : 'disabled'}>${v.confirmed.me ? 'Confirmed: waiting for them' : 'Confirm'}</button>
                <button class="btn btn-danger" id="tCancel">Call it off</button></div>`;
        } else html += '<p class="w-note" style="text-align:center"><b>Both confirmed.</b> Going through…</p>';
        body.innerHTML = html;
        const on = (sel, fn) => UI().on(body, sel, fn);
        const heldRefs = () => v.mine.o.map((_, i) => ({ held: i }));
        on('[data-tdrop]', (d) => setOffer(heldRefs().filter((_, i) => i !== Number(d.tdrop)), v.mine.r));
        const items = myItems(s);
        on('[data-tadd]', (d) => { const it = items[Number(d.tadd)]; if (it) setOffer(heldRefs().concat([it.ref]), v.mine.r); });
        const sr = body.querySelector('#tSetR');
        if (sr) sr.addEventListener('click', () => setOffer(heldRefs(), Number(body.querySelector('#tRubies').value) || 0));
        const acc = body.querySelector('#tAccept');
        if (acc) acc.addEventListener('click', () => MK.accept(false));
        const cf = body.querySelector('#tConfirm');
        if (cf) cf.addEventListener('click', () => MK.accept(true));
        const cx = body.querySelector('#tCancel');
        if (cx) cx.addEventListener('click', cancelTrade);
    }
    // a little reminder in the corner while a trade is going and its window is shut
    function renderChip() {
        let e = document.getElementById('tradeChip');
        const t = game() && game().state && game().state.market.trade;
        if (!e) { if (!t) return; e = document.createElement('button'); e.id = 'tradeChip'; e.className = 'btn btn-gold btn-sm w-trade-chip'; e.addEventListener('click', () => MK.openTrade()); const hud = document.getElementById('wHud'); if (!hud) return; hud.appendChild(e); }
        e.hidden = !t || tradeOpen;
        if (t) e.textContent = '🤝 Trade with ' + t.wn;
    }

    // ================= the Auction Hall =================
    let ahTab = 'browse', ahFilter = 'all', sellMin = 500, sellBuy = 0, sellHours = 24;
    MK.openAuction = function (tab) {
        if (tab) ahTab = tab;
        if (!online()) { WHW.toast('The Auction Hall needs online play.', 'bad'); return; }
        UI().modal('🔨 The Auction Hall', '<p class="w-note">Opening the Hall…</p>', { wide: true, render: renderAuction, onClose: () => { if (MK.ahOff) MK.ahOff(); MK.ahOff = null; } });
        if (!MK.ahOff) MK.ahOff = net().db.onValue(M.AH_ROOT, (v) => { MK.ah = v || {}; renderAuction(); });
        renderAuction();
    };
    function listings() { const all = MK.ah || {}; return Object.keys(all).filter(id => M.ID_RE.test(id) && all[id] && typeof all[id] === 'object').map(id => Object.assign({ id }, all[id])); }
    function renderAuction() {
        const body = document.getElementById('wModalBody');
        if (!body || !MK.ahOff) return;
        const s = game().state, now = sNow();
        const left = (ms) => { const m = Math.max(0, Math.ceil(ms / 60000)); return m >= 120 ? Math.floor(m / 60) + 'h' : m >= 60 ? '1h ' + (m - 60) + 'm' : m + 'm'; };
        let html = UI().tabs(['browse', 'sell', 'mine'], ahTab, null, { browse: 'Browse', sell: 'Sell', mine: 'Yours (' + (Object.keys(s.market.listed).length + Object.keys(s.market.bids).length) + ')' });
        html += `<details class="w-how"><summary>Bid on what others sell, or sell your own. You have <b>♦ ${fmt(s.rubies)}</b>.</summary>
            <p>Bids must beat the top one by ${Math.round((M.AUCTION.step - 1) * 100)}%. Your rubies are set aside while you lead and come back if you are outbid. When it ends, the winner claims it and the seller is paid (the Hall keeps ${Math.round(M.AUCTION.fee * 100)}%). A winner who doesn't claim within ${M.AUCTION.claimMs / 86400000} days loses it back to the seller. Every piece shows who made it and how often it changed hands.</p></details>`;
        const all = listings();
        if (ahTab === 'browse') {
            html += `<div class="w-chips" role="group">${[['all', 'Everything'], ['w', 'Wilds gear'], ['g', 'Gear for the game']].map(([k, l]) => `<button class="w-chip${ahFilter === k ? ' is-on' : ''}" data-ahf="${k}">${l}</button>`).join('')}</div>`;
            const open = all.filter(l => !M.auctionView(l, me(), now).ended).filter(l => { const x = M.unpackItem(l.it, false); return x && (ahFilter === 'all' || x.kind === ahFilter); }).sort((a, b) => a.end - b.end);
            html += open.length ? `<div class="w-grid">${open.map(l => {
                const v = M.auctionView(l, me(), now);
                const price = `<p>${v.top ? 'Top bid <b>♦ ' + fmt(v.top.v) + '</b> by ' + esc(v.top.n || 'someone') + (v.leading ? ' (you)' : '') : 'Starts at <b>♦ ' + fmt(l.min) + '</b>'}${l.buy ? ' · buy now <b>♦ ' + fmt(l.buy) + '</b>' : ''} · ends in ${left(v.left)} · from ${esc(l.sn || 'someone')}</p>`;
                const act = v.mine ? '<span class="muted">Yours</span>' : `<button class="btn btn-sm btn-primary" data-bid="${l.id}" ${v.canBid && !v.leading && s.rubies + (s.market.bids[l.id] || 0) >= v.minNext ? '' : 'disabled'}>Bid ♦ ${fmt(v.minNext)}</button>${v.canBuy ? `<button class="btn btn-sm btn-gold" data-buy="${l.id}" ${s.rubies + (s.market.bids[l.id] || 0) >= l.buy ? '' : 'disabled'}>Buy now</button>` : ''}`;
                return itemCard(l.it, price + `<div class="w-card-actions">${act}</div>`);
            }).join('')}</div>` : '<p class="w-empty">Nothing on sale right now. Be the first: the Sell tab.</p>';
        } else if (ahTab === 'sell') {
            const items = myItems(s), full = Object.keys(s.market.listed).length >= M.AUCTION.maxListings;
            const nListed = Object.keys(s.market.listed).length;
            html += `<div class="w-ah-form"><label class="w-sort">Starting price ♦ <input type="number" id="ahMin" min="1" max="${M.AUCTION.maxPrice}" value="${sellMin}" style="width:100px"></label>
                <label class="w-sort">Buy now ♦ <input type="number" id="ahBuy" min="0" max="${M.AUCTION.maxPrice}" value="${sellBuy || ''}" placeholder="none" style="width:100px"></label>
                <label class="w-sort">For <select id="ahHours">${M.AUCTION.hours.map(h => `<option value="${h}" ${h === sellHours ? 'selected' : ''}>${h} hour${h > 1 ? 's' : ''}</option>`).join('')}</select></label>
                <span class="muted" style="font-size:12px">${nListed} of ${M.AUCTION.maxListings} listings used</span></div>
                <p class="w-note">${full ? '<b>You have ' + M.AUCTION.maxListings + ' listings already</b>: wait for one to end.' : 'Set the price, then pick what to sell. It leaves your bag now and comes back if nobody buys it.'}</p>
                <div class="w-grid">${items.length ? items.slice(0, 60).map((it, i) => myItemCard(it, `<button class="btn btn-sm btn-gold" data-list="${i}" ${full ? 'disabled' : ''}>List it</button>`)).join('') : '<p class="muted">Nothing to sell: worn gear and the starter kit stay with you.</p>'}</div>`;
        } else {
            const byId = Object.fromEntries(all.map(l => [l.id, l]));
            const rows = [];
            for (const lid in s.market.listed) {
                const l = byId[lid], v = l ? M.auctionView(l, me(), now) : null;
                const st = !l ? 'Waiting for the Hall…' : v.claimed ? 'Sold for ♦ ' + fmt(v.top.v) + ': collecting…' : v.ended ? (v.top ? 'Won by ' + esc(v.top.n || 'someone') + ' for ♦ ' + fmt(v.top.v) + ': waiting for them to claim it' + (v.canReturn ? ' (you can take it back now)' : '') : 'No bids: coming back to you') : (v.top ? 'Top bid ♦ ' + fmt(v.top.v) : 'No bids yet') + ' · ends in ' + left(v.left);
                rows.push(itemCard(s.market.listed[lid].it, `<p><b>Selling</b> · ${st}</p>${v && v.canReturn ? `<div class="w-card-actions"><button class="btn btn-sm btn-ghost" data-ret="${lid}">Take it back</button></div>` : ''}`));
            }
            for (const lid in s.market.bids) {
                const l = byId[lid], v = l ? M.auctionView(l, me(), now) : null;
                const st = !l ? 'Gone from the Hall: your rubies come back' : v.leading ? (v.ended ? 'You won! Claiming…' : 'You lead with ♦ ' + fmt(v.top.v) + ' · ends in ' + left(v.left)) : 'Outbid: your rubies come back';
                rows.push(l ? itemCard(l.it, `<p><b>Bidding</b> · ♦ ${fmt(s.market.bids[lid])} set aside · ${st}</p>`) : `<div class="w-card"><p>${st}</p></div>`);
            }
            html += rows.length ? `<div class="w-grid">${rows.join('')}</div>` : '<p class="w-empty">You are not selling or bidding on anything.</p>';
            html += `<p class="w-note">Sold ${fmt(s.market.sold)} · bought ${fmt(s.market.bought)} · traded ${fmt(s.market.traded)}</p>`;
        }
        body.innerHTML = html;
        UI().wireTabs(body, (t) => { ahTab = t; renderAuction(); });
        const on = (sel, fn) => UI().on(body, sel, fn);
        on('[data-ahf]', (d) => { ahFilter = d.ahf; renderAuction(); });
        on('[data-bid]', (d) => { const l = listings().find(x => x.id === d.bid); if (l) bid(l, M.auctionView(l, me(), sNow()).minNext, false); });
        on('[data-buy]', (d) => { const l = listings().find(x => x.id === d.buy); if (l) bid(l, l.buy, true); });
        on('[data-ret]', (d) => tick());
        const items = myItems(s);
        // the price stays as set while the list redraws (each listing, a bid elsewhere...)
        const keep = () => { const mn = body.querySelector('#ahMin'), by = body.querySelector('#ahBuy'), hr = body.querySelector('#ahHours'); if (mn) sellMin = Number(mn.value) || 0; if (by) sellBuy = Number(by.value) || 0; if (hr) sellHours = Number(hr.value) || 24; };
        body.querySelectorAll('#ahMin, #ahBuy, #ahHours').forEach(el => el.addEventListener('change', keep));
        on('[data-list]', (d) => {
            const it = items[Number(d.list)];
            if (!it) return;
            keep();
            list(it.ref, { min: sellMin, buy: sellBuy, hours: sellHours });
        });
    }
    function list(ref, opts) {
        const s = game().state, lid = M.newId(Math.random);
        const r = W.auctionList(s, ref, lid, Object.assign({ uid: me(), name: myName() }, opts), sNow());
        if (!r.ok) { WHW.toast({ listings: 'You have ' + M.AUCTION.maxListings + ' listings already.', price: 'Set a starting price.', buyout: 'Buy now must be at least the starting price.', equipped: 'Take it off first.', starter: 'The starter kit stays with you.' }[r.reason] || "Can't list that.", 'bad'); return; }
        WHW.save(); WHW.refreshPlayer();
        net().db.commit(M.ahPath(lid), r.listing).then((ok) => {
            if (!ok) { W.auctionReturn(s, lid); WHW.save(); WHW.toast("It couldn't be listed (the database refused it: its rules may need publishing). It's back in your bag.", 'bad'); renderAuction(); return; }
            WHW.toast('🔨 Listed! It ends in ' + opts.hours + 'h.', 'gold'); ahTab = 'mine'; renderAuction();
        });
    }
    function bid(l, v, buyout) {
        const s = game().state, prev = s.market.bids[l.id] || 0;
        const h = W.auctionHold(s, l.id, v);
        if (!h.ok) { WHW.toast(h.reason === 'rubies' ? 'Not enough rubies.' : 'Bid more than before.', 'bad'); return; }
        WHW.save();
        net().db.commit(M.ahPath(l.id, 'b'), { u: me(), n: myName(), v, t: sNow() }).then((ok) => {
            if (!ok) {
                // refused (outbid a moment ago, or it ended): what was set aside comes back
                s.rubies += v - prev; if (prev) s.market.bids[l.id] = prev; else delete s.market.bids[l.id];
                WHW.save(); WHW.toast('Your bid didn\'t go through: someone may have bid first.', 'bad'); renderAuction(); return;
            }
            if (!buyout) { WHW.toast('Bid placed: ♦ ' + fmt(v) + '.', 'gold'); renderAuction(); return; }
            net().db.commit(M.ahPath(l.id, 'bo'), me()).then(() => { WHW.toast('Bought! Claiming it…', 'gold'); tick(); });
        });
    }

    // ================= the loop: settle whatever is due =================
    let ticking = false;
    function tick() {
        if (ticking || !online() || !game() || !game().state || !game().canSave) return;
        const s = game().state;
        // a trade from before a reload: follow it again
        if (s.market.trade && MK.tradeTid !== s.market.trade.tid) watch(s.market.trade.tid);
        if (s.market.pending.length && W.collectPending(s)) { WHW.save(); WHW.toast('Gear you traded for found room in your bag.', 'gold'); }
        const lids = [...new Set(Object.keys(s.market.listed).concat(Object.keys(s.market.bids)))];
        if (!lids.length) { renderChip(); return; }
        ticking = true;
        Promise.all(lids.map(lid => net().db.once(M.ahPath(lid)).then(l => settleListing(lid, l)))).catch(() => {}).then(() => { ticking = false; renderAuction(); });
    }
    MK.tick = tick;
    // one listing I sell or bid on: what is due now. Every step is written to the database first and only then paid here,
    // and a step that was written but not yet paid (a reload in between) is paid the next time round.
    function settleListing(lid, l) {
        const s = game().state, now = sNow(), uid = me();
        const commit = (sub, v) => net().db.commit(M.ahPath(lid, sub), v);
        const done = () => { WHW.save(); WHW.refreshPlayer(); };
        if (s.market.bids[lid]) {
            if (!l || l.rt || (l.b && l.b.u !== uid)) { const back = W.auctionRelease(s, lid); done(); if (back) WHW.toast((l && l.rt ? 'An auction you won went back to its seller' : 'Outbid') + ': ♦ ' + fmt(back) + ' back.'); return null; }
            const v = M.auctionView(l, uid, now);
            if (l.cl === uid) { const x = W.auctionWon(s, lid, l.it); if (x) { done(); WHW.toast('🔨 Won: ' + M.itemLabel(x).name + '!', 'gold'); } return null; }
            if (v.canClaim) {
                const x0 = M.unpackItem(l.it, true);
                if (!x0 || (x0.kind === 'g' ? !W.satchelRoom(s, 1) : s.gear.length >= D.RULES.maxGear + 10)) { WHW.toast('You won an auction: make room in your bag or the Relic Satchel to claim it.', 'bad'); return null; }
                return commit('cl', uid).then((ok) => { if (!ok) return; const x = W.auctionWon(s, lid, l.it); done(); if (x) { WHW.toast('🔨 Won: ' + M.itemLabel(x).name + '!', 'gold'); WHW.sfx('boss'); } });
            }
        }
        if (s.market.listed[lid]) {
            if (!l) { const x = W.auctionReturn(s, lid); if (x) { done(); WHW.toast('A listing is gone from the Hall: ' + M.itemLabel(x).name + ' is back.'); } return null; }
            const v = M.auctionView(l, uid, now);
            const tidy = () => commit('', null);
            if (l.pd) { const got = W.auctionPaid(s, lid, v.top ? v.top.v : 0); done(); if (got) WHW.toast('🔨 Sold! ♦ ' + fmt(got) + ' paid.', 'gold'); return tidy(); }
            if (l.rt) { const x = W.auctionReturn(s, lid); if (x) { done(); WHW.toast(M.itemLabel(x).name + ' is back from the Hall.'); } return tidy(); }
            if (v.canPay) return commit('pd', true).then((ok) => { if (!ok) return; const got = W.auctionPaid(s, lid, v.top.v); done(); WHW.toast('🔨 Sold for ♦ ' + fmt(v.top.v) + ': ♦ ' + fmt(got) + ' paid.', 'gold'); WHW.sfx('gem'); return tidy(); });
            if (v.canReturn) return commit('rt', true).then((ok) => { if (!ok) return; const x = W.auctionReturn(s, lid); done(); if (x) WHW.toast(M.itemLabel(x).name + (v.top ? ' wasn\'t claimed in time: it' : ' found no buyer: it') + ' is back.'); return tidy(); });
        }
        return null;
    }
    // what the buttons do, also for the browser tests (tests/browser/online.js)
    MK.setOffer = setOffer;
    MK.accept = (confirm) => {
        const t = game().state.market.trade, v = MK.trade && M.tradeView(MK.trade, me(), sNow());
        if (!t || !v || !v.ok || !matchOffer(v)) return Promise.resolve(false);
        return net().db.commit(M.tradePath(t.tid, 's/' + me()), Object.assign({ o: JSON.stringify(v.mine.o), r: v.mine.r, ok: v.hash }, confirm ? { c: v.hash } : {}));
    };
    MK.cancel = cancelTrade;
    MK.list = list;
    MK.bid = bid;
    setInterval(tick, 8000);
    window.addEventListener('whnet-online', tick);
})();
