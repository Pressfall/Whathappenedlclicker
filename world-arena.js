/**
 * The Arena (world.html): the page side of duels, team battles (2v2, 3v3) and the Pit. Its rules are core/world-arena.js
 * (every page runs its own copy of a match from the same invitation and the same signed messages); rating, Glory, the
 * wager and the shop change the save through core/world-logic.js. Messages travel through world-online.js (ON.send, and
 * onMessage here), in the arena zone only.
 * - A challenge: E near another player in the lobby. The challenger (the captain) sends 'ask' to everyone in the match;
 *   when all said 'yes' it sends 'go' with the start time, and every page starts the same match.
 * - The queue: players waiting publish aq (and their party, pt) in their info. Every queued page works out the same
 *   matches (core pickMatches) and the lowest id in each one sends its invitations; queued players accept at once.
 * - A knockout in a match: no death screen, you are out until the round ends; your page tells everyone ('down'). In the
 *   Pit: back on your feet at its gate a moment later, and the player who knocked you out is told ('ko').
 */
(function () {
    'use strict';
    const D = window.WHWorldData, W = window.WHWorld, Ar = window.WHWorldArena;
    const WHW = window.WHW, E = WHW.engine;
    const game = () => WHW.game;
    const net = () => WHW.online;
    const online = () => !!(net() && net().db && net().status === 'online' && net().zone === 'arena');
    const me = () => net() && net().uid;
    const sNow = () => (net() && net().db ? net().db.serverNow() : Date.now());
    const esc = (s) => WHW.ui.esc(s);
    const fmt = (n) => Math.round(n).toLocaleString('en-US');
    const newId = () => Math.random().toString(36).slice(2, 10).padEnd(8, '0');
    const R = Ar.RULES;

    const AR = WHW.arena = {
        match: null,     // the match I'm playing (core newMatch / reduce)
        pending: null,   // an invitation I sent: { ask, yes: Set, at }
        invite: null,    // an invitation I got: { ask, at }
        accepted: null,  // an invitation I said yes to, waiting for 'go': { ask, at }
        queue: '',       // 'duel' | 't2' | 't3' while waiting in the queue
        pitUpAt: 0, prepared: 0, missing: {}, queueT: 0, endAt: 0,
    };

    // ---------------- who is who ----------------
    function remotes() { return net() ? [...net().remotes.values()].filter(r => !r.stale && r.info) : []; }
    function remoteOf(uid) { const r = net() && net().remotes.get(uid); return r && r.info ? r : null; }
    function myRating() { return game().state.arena.rating; }
    function meAsPlayer() { return { u: me(), n: net().name(), r: myRating() }; }
    function asPlayer(r) { return { u: r.uid, n: r.info.n, r: r.info.r || R.elo.start }; }
    function busy() { return !!(AR.match || AR.pending || AR.accepted); }
    // my party (world-party.js) as a team: me and its members here in the Arena
    function partyMembers() { return [meAsPlayer()].concat(WHW.party ? WHW.party.here().map(asPlayer) : []); }
    function partyOf(r) { return r.info.pt ? [asPlayer(r)].concat(remotes().filter(x => x.uid !== r.uid && x.info.pt === r.info.pt).map(asPlayer)) : [asPlayer(r)]; }
    function sendAll(list, m, id, x) { for (const p of list) if (p.u !== me()) net().send(p.u, m, id, x); }

    // what the arena adds to my info: the match I'm in (id:ring), the queue I'm in (my party is world-party.js's)
    AR.infoExtra = function () {
        const m = AR.match && !AR.match.result ? AR.match : AR.pending ? AR.pending.ask : AR.accepted ? AR.accepted.ask : null;
        return { am: m ? m.id + ':' + m.ring : '', aq: busy() ? '' : AR.queue };
    };
    AR.busy = busy;
    // a foe in my match right now (a party member on the other team can be hit like anyone else there)
    AR.matchFoe = function (uid) { const m = AR.match; if (!m || m.result) return false; const t = Ar.teamOf(m, uid); return !!t && t !== m.team; };

    // ---------------- who may hit whom (core hitAllowed, from either side) ----------------
    AR.canHit = function (r) {
        const g = game(), p = g.player;
        return Ar.hitAllowed({ map: g.map, match: AR.match, me: { uid: me(), x: p.x, y: p.y }, them: { uid: r.uid, x: r.x, y: r.y, inMatch: !!r.info.am } });
    };
    AR.hitFrom = function (uid, pos, r) {
        const g = game(), p = g.player;
        return Ar.hitAllowed({ map: g.map, match: AR.match, me: { uid: me(), x: p.x, y: p.y }, them: { uid, x: pos.x, y: pos.y, inMatch: !!(r && r.info && r.info.am) } });
    };

    // ---------------- challenges ----------------
    // Challenge another player: a duel, or (mode t2 / t3) my party against theirs
    AR.challenge = function (r, mode, stake) {
        if (!online()) { WHW.toast('Matches need online play (the 🌐 menu).', 'bad'); return; }
        if (busy()) { WHW.toast('You are already in a match or waiting on one.', 'bad'); return; }
        if (WHW.tour && WHW.tour.due()) { WHW.toast('Your tournament duel is up: play that first.', 'bad'); return; }
        if (r.info.am) { WHW.toast(r.info.n + ' is busy with another match.', 'bad'); return; }
        const size = Ar.MODES[mode].size;
        const a = mode === 'duel' ? [meAsPlayer()] : partyMembers(), b = mode === 'duel' ? [asPlayer(r)] : partyOf(r);
        if (a.length !== size || b.length !== size) { WHW.toast(`A ${Ar.MODES[mode].name} needs a party of ${size} on each side (yours: ${a.length}, theirs: ${b.length}).`, 'bad'); return; }
        if (a.some(p => b.some(q => q.u === p.u))) { WHW.toast("You can't fight your own party.", 'bad'); return; }
        if (!Ar.canStake(game().state.rubies, stake)) { WHW.toast('You can\'t cover that stake.', 'bad'); return; }
        sendAsk({ id: newId(), mode, stake, ring: freeRing(), t0: 0, cap: me(), a, b });
        WHW.toast(`Challenge sent to ${b.map(p => p.n).join(', ')}${stake ? ` for ${fmt(stake)} rubies each` : ''}.`);
    };
    // A tournament's duel (world-tour.js): the better seed invites the other, with the pairing's tag; no stake (the entry
    // fees are the prize)
    AR.tourChallenge = function (r, tag) {
        if (!online() || busy() || r.info.am) return false;
        sendAsk({ id: newId(), mode: 'duel', stake: 0, ring: freeRing(), t0: 0, cap: me(), a: [meAsPlayer()], b: [asPlayer(r)], tour: tag });
        return true;
    };
    function freeRing() {
        const used = new Set(remotes().map(r => r.info.am).filter(Boolean).map(a => Number(a.split(':')[1])));
        const free = game().map.rings.map(x => x.i).filter(i => !used.has(i));
        return free.length ? free[Math.floor(Math.random() * free.length)] : Math.floor(Math.random() * game().map.rings.length);
    }
    function sendAsk(ask) {
        AR.pending = { ask, yes: new Set(), at: E.time };
        const x = Ar.packAsk(ask);
        sendAll(ask.a.concat(ask.b), 'ask', ask.id, x);
        net().infoKey = ''; // show I'm busy now
    }
    function cancelPending(why) {
        const p = AR.pending;
        if (!p) return;
        sendAll(p.ask.a.concat(p.ask.b), 'cancel', p.ask.id, '');
        AR.pending = null;
        net().infoKey = '';
        if (why) WHW.toast(why, 'bad');
    }
    AR.respond = function (yes) {
        const inv = AR.invite;
        AR.invite = null;
        renderInvite();
        if (!inv) return;
        if (!yes) { net().send(inv.ask.cap, 'no', inv.ask.id, ''); return; }
        if (busy()) { net().send(inv.ask.cap, 'busy', inv.ask.id, ''); return; }
        if (!Ar.canStake(game().state.rubies, inv.ask.stake)) { WHW.toast("You can't cover the stake.", 'bad'); net().send(inv.ask.cap, 'no', inv.ask.id, ''); return; }
        AR.accepted = { ask: inv.ask, at: E.time };
        AR.queue = '';
        net().send(inv.ask.cap, 'yes', inv.ask.id, '');
        net().infoKey = '';
    };
    AR.setQueue = function (mode) {
        if (mode && !online()) { WHW.toast('The queue needs online play (the 🌐 menu).', 'bad'); return; }
        if (mode && mode !== 'duel' && partyMembers().length > Ar.MODES[mode].size) { WHW.toast('Your party is too big for that.', 'bad'); return; }
        AR.queue = mode || '';
        net().infoKey = '';
        if (mode) WHW.toast('Waiting for a ' + Ar.MODES[mode].name + '. Stay in the Arena; it starts on its own.');
        WHW.ui.refresh();
    };

    // ---------------- messages ----------------
    AR.onMessage = function (msg) {
        const g = game();
        if (g.zoneId !== 'arena') return;
        switch (msg.m) {
            case 'ask': {
                const ask = Ar.unpackAsk(msg.id, msg.x);
                if (!ask || ask.cap !== msg.from || !Ar.teamOf({ teams: { a: ask.a, b: ask.b } }, me())) return;
                if (busy()) { net().send(msg.from, 'busy', ask.id, ''); return; }
                // a tournament's duel (world-tour.js): accepted at once if it is the pairing I am due to play, refused otherwise
                if (ask.tour) {
                    if (WHW.tour && WHW.tour.expects(ask)) { AR.invite = { ask, at: E.time }; AR.respond(true); }
                    else net().send(msg.from, 'no', ask.id, '');
                    return;
                }
                // my tournament duel is due: other matches wait
                if (WHW.tour && WHW.tour.due()) { net().send(msg.from, 'busy', ask.id, ''); return; }
                // queued for exactly this, with no stake: accept at once
                if (AR.queue && AR.queue === ask.mode && !ask.stake) { AR.invite = { ask, at: E.time }; AR.respond(true); return; }
                AR.invite = { ask, at: E.time };
                renderInvite();
                WHW.sfx && WHW.sfx('craft');
                return;
            }
            case 'yes': {
                const p = AR.pending;
                if (!p || p.ask.id !== msg.id) return;
                p.yes.add(msg.from);
                const all = p.ask.a.concat(p.ask.b).filter(x => x.u !== me());
                if (all.every(x => p.yes.has(x.u))) {
                    const t0 = sNow() + 2500 + R.countdownSec * 1000;
                    sendAll(all, 'go', p.ask.id, String(t0));
                    AR.pending = null;
                    begin(Object.assign({}, p.ask, { t0 }));
                }
                return;
            }
            case 'no': case 'busy':
                if (AR.pending && AR.pending.ask.id === msg.id) { const r = remoteOf(msg.from); cancelPending((r ? r.info.n : 'Someone') + (msg.m === 'no' ? ' said no.' : ' is busy.')); }
                return;
            case 'cancel':
                if (AR.invite && AR.invite.ask.id === msg.id) { AR.invite = null; renderInvite(); }
                if (AR.accepted && AR.accepted.ask.id === msg.id) { AR.accepted = null; net().infoKey = ''; WHW.toast('The match was called off.'); }
                return;
            case 'go':
                if (AR.accepted && AR.accepted.ask.id === msg.id && msg.from === AR.accepted.ask.cap && Number(msg.x) > 0) {
                    const ask = AR.accepted.ask;
                    AR.accepted = null;
                    begin(Object.assign({}, ask, { t0: Number(msg.x) }));
                }
                return;
            case 'down': case 'quit':
                if (AR.match && AR.match.id === msg.id) Ar.reduce(AR.match, { type: msg.m, uid: msg.from, round: Number(msg.x), t: msg.t });
                return;
        }
    };
    // Someone I knocked out in the Pit told me so
    AR.creditKO = function (uid, name) {
        if (AR.match) return; // a match's knockouts are its rounds
        const g = game(), glory = W.pitKO(g.state, sNow());
        WHW.toast(`You knocked out ${name} in the Pit!${glory ? ' +' + glory + ' Glory' : ''}`, 'gold');
        WHW.sfx('boss');
        WHW.save();
    };

    // ---------------- playing a match ----------------
    function begin(ask) {
        const g = game(), s = g.state;
        const m = Ar.newMatch(ask, me());
        if (!m.team) return;
        if (!W.arenaEscrow(s, m)) { sendAll(ask.a.concat(ask.b), 'quit', ask.id, ''); WHW.toast("You couldn't cover the stake, so you forfeit.", 'bad'); return; }
        AR.match = m; AR.queue = ''; AR.prepared = 0; AR.missing = {}; AR.invite = null; AR.accepted = null; AR.pending = null;
        // a tournament that locks gear to a tier: everyone fights this duel with the same kit (core/world-logic.js lendKit)
        const tg = m.tour && WHW.tour ? WHW.tour.tagOf(m.tour) : null;
        if (tg && tg.g && W.lendKit(s, tg.g)) WHW.refreshPlayer();
        net().infoKey = '';
        if (WHW.ui.isOpen()) WHW.ui.closeModal();
        renderInvite();
        WHW.save();
        const vs = (m.team === 'a' ? m.teams.b : m.teams.a).map(p => p.n).join(', ');
        WHW.banner((tg ? WHW.tour.duelName(tg) : Ar.MODES[m.mode].name) + ' vs ' + vs, (m.stake ? fmt(m.stake) + ' rubies each · ' : '') + 'Best of three' + (tg && tg.g ? ' · everyone has a ' + D.TIERS[tg.g].name + ' kit' : ''));
        prepareRound();
    }
    // the start of every round: everyone back on their feet, at their team's side of the ring
    function prepareRound() {
        const m = AR.match, g = game(), p = g.player;
        if (!m || AR.prepared === m.round) return;
        AR.prepared = m.round;
        const ring = g.map.rings[m.ring] || g.map.rings[0];
        const list = m.teams[m.team], i = Math.max(0, list.findIndex(x => x.u === me()));
        const spot = ring.spots[m.team][i] || ring;
        revive(spot.x, spot.y);
    }
    function revive(x, y) {
        const g = game(), p = g.player;
        p.dead = false; p.hp = g.pstats.maxHp; p.maxHp = g.pstats.maxHp;
        p.status.burnUntil = 0; p.slow = 0; p.stam.val = D.COMBAT.stamina.max; p.stam.winded = false; p.mana.val = D.COMBAT.mana.max;
        p.stunUntil = 0; p.beam = null; p.pull = null;
        if (x !== undefined) { p.x = x; p.y = y; p.vx = p.vy = p.kbx = p.kby = 0; E.collideTiles(p); E.snapCamera(); }
        p.iframes = 0.5;
    }
    // My page's player was knocked out in the arena (WHW.onPlayerDeath sends the 'ko' to whoever did it)
    AR.knockedOut = function () {
        const g = game(), p = g.player, m = AR.match;
        p.dead = true;
        if (m && !m.result) {
            if (m.state === 'live') {
                const t = sNow();
                Ar.reduce(m, { type: 'down', uid: me(), round: m.round, t });
                sendAll(Ar.members(m).map(u => ({ u })), 'down', m.id, String(m.round));
            }
            WHW.toast('Knocked out! You are out until the round ends.', 'bad');
            return;
        }
        W.pitDown(g.state);
        AR.pitUpAt = E.time + R.pitRespawnSec;
        WHW.toast('Knocked out! Back on your feet in a moment. Nothing is lost in the Arena.', 'bad');
    };
    function finish() {
        const m = AR.match, g = game(), s = g.state;
        const r = W.arenaResult(s, m, sNow());
        if (online()) net().writeTop(Ar.topRecord(net().name(), s.arena, sNow()));
        giveBackKit();
        if (m.tour && WHW.tour) WHW.tour.duelOver(m, r);
        const head = r.won ? '🏆 Victory!' : r.draw ? 'A draw' : 'Defeat';
        const bits = [(r.ratingDelta >= 0 ? '+' : '') + r.ratingDelta + ' rating (' + s.arena.rating + ', ' + Ar.rankFor(s.arena.rating).name + ')'];
        if (r.glory) bits.push('+' + r.glory + ' Glory');
        if (r.rubies) bits.push('+' + fmt(r.rubies) + ' rubies');
        if (r.payout) bits.push(fmt(r.payout) + ' rubies from the pot');
        if (!r.counts) bits.push('(no rating or Glory: you have fought them a lot today)');
        WHW.banner(head, Ar.MODES[m.mode].name + ' · ' + m.wins[m.team] + ' – ' + m.wins[m.team === 'a' ? 'b' : 'a']);
        WHW.toast(head + ' ' + bits.join(', ') + '.', r.won ? 'gold' : '');
        AR.endAt = E.time + 3;
        WHW.save();
    }
    // the gear a tournament lent for a duel goes back, and your own comes back
    function giveBackKit() { if (W.returnKit(game().state)) WHW.refreshPlayer(); }
    // Leaving the arena (or going offline) in a match: that is a forfeit, and a loss
    AR.leaving = function () {
        const m = AR.match;
        if (AR.pending) cancelPending();
        if (AR.invite) { if (net() && net().db) net().send(AR.invite.ask.cap, 'no', AR.invite.ask.id, ''); AR.invite = null; }
        if (AR.accepted && net() && net().db) net().send(AR.accepted.ask.cap, 'no', AR.accepted.ask.id, '');
        AR.accepted = null; AR.queue = '';
        renderInvite();
        if (!m) return;
        AR.match = null;
        if (!m.result) {
            if (net() && net().db) sendAll(Ar.members(m).map(u => ({ u })), 'quit', m.id, '');
            m.result = m.team === 'a' ? 'b' : 'a';
            const r = W.arenaResult(game().state, m, sNow());
            if (m.tour && WHW.tour) WHW.tour.duelOver(m, r);
            WHW.toast('You left the match: it counts as a loss.', 'bad');
        }
        giveBackKit();
        game().player.dead = false;
        WHW.save();
    };
    AR.zoneEntered = function (from, to) { if (from === 'arena' && to !== 'arena') AR.leaving(); };
    AR.forfeit = function () { if (AR.match && !AR.match.result) AR.leaving(); };

    // ---------------- each step ----------------
    AR.update = function (dt) {
        const g = game(), p = g.player;
        if (g.zoneId !== 'arena') { renderHud(); return; }
        // up again in the Pit
        if (AR.pitUpAt && E.time >= AR.pitUpAt) { AR.pitUpAt = 0; const gt = g.map.pitGate; revive(gt.x, gt.y); p.protectedUntil = E.time + 2; }
        if (AR.invite && E.time - AR.invite.at > R.inviteSec) AR.respond(false);
        if (AR.pending && E.time - AR.pending.at > R.inviteSec) cancelPending('No answer in time.');
        if (AR.accepted && E.time - AR.accepted.at > R.inviteSec + 8) { AR.accepted = null; net().infoKey = ''; }
        const m = AR.match;
        if (m) {
            if (!m.result) {
                // players gone quiet: down for the round, then out of the match
                const t = performance.now();
                for (const u of Ar.members(m)) {
                    if (u === me() || m.gone[u]) continue;
                    const r = net() && net().remotes.get(u);
                    const last = r && r.last ? r.last : (AR.missing[u] || (AR.missing[u] = t));
                    if (r && r.last) delete AR.missing[u];
                    const quiet = (t - last) / 1000;
                    if (quiet > R.forfeitSec) Ar.reduce(m, { type: 'quit', uid: u, t: sNow() });
                    else if (quiet > R.staleDownSec && m.state === 'live' && !m.down[u]) Ar.reduce(m, { type: 'down', uid: u, round: m.round, t: sNow() });
                }
                for (const fx of Ar.reduce(m, { type: 'tick', now: sNow() })) {
                    if (fx.type === 'live') { prepareRound(); WHW.banner('Round ' + fx.round, 'Fight!'); }
                    else if (fx.type === 'roundEnd') {
                        const mine = fx.winner === m.team;
                        WHW.banner(fx.winner ? (mine ? 'Round won' : 'Round lost') : 'Round drawn', m.wins[m.team] + ' – ' + m.wins[m.team === 'a' ? 'b' : 'a']);
                    } else if (fx.type === 'end') finish();
                }
                if (m.state === 'countdown' || m.state === 'break') { if (m.state === 'countdown') prepareRound(); }
            } else if (AR.endAt && E.time >= AR.endAt) {
                AR.endAt = 0; AR.match = null; net() && (net().infoKey = '');
                revive(g.map.entry.x, g.map.entry.y);
            }
        }
        // the queue: every queued page works out the same matches; each match's lowest id sends its invitations
        AR.queueT -= dt;
        if (AR.queue && !busy() && online() && AR.queueT <= 0) {
            AR.queueT = 3;
            const q = [{ uid: me(), n: net().name(), r: myRating(), aq: AR.queue, pt: (WHW.party && WHW.party.id) || '' }]
                .concat(remotes().filter(r => r.info.aq && !r.info.am).map(r => ({ uid: r.uid, n: r.info.n, r: r.info.r || R.elo.start, aq: r.info.aq, pt: r.info.pt })));
            const mine = Ar.pickMatches(q).find(x => x.a.concat(x.b).some(p => p.u === me()));
            if (mine && mine.a.concat(mine.b).map(p => p.u).sort()[0] === me()) sendAsk({ id: newId(), mode: mine.mode, stake: 0, ring: freeRing(), t0: 0, cap: me(), a: mine.a, b: mine.b });
        }
        renderHud();
    };

    // ---------------- the HUD and the invitation panel ----------------
    function el(id, cls) {
        let e = document.getElementById(id);
        if (!e) { e = document.createElement('div'); e.id = id; e.className = cls; document.getElementById('wHud').appendChild(e); }
        return e;
    }
    let hudKey = '';
    function renderHud() {
        const m = AR.match, g = game();
        let html = '';
        if (m && g.zoneId === 'arena') {
            const other = m.team === 'a' ? 'b' : 'a', now = sNow();
            const clock = m.state === 'live' ? Math.max(0, Math.ceil((m.liveAt + R.roundSec * 1000 - now) / 1000)) : Math.max(0, Math.ceil((m.liveAt - now) / 1000));
            const what = m.result ? (m.result === 'draw' ? 'Draw' : m.result === m.team ? 'Victory!' : 'Defeat') : m.state === 'live' ? 'Round ' + m.round + ' · ' + Math.floor(clock / 60) + ':' + String(clock % 60).padStart(2, '0') : 'Round ' + m.round + ' in ' + clock;
            const names = (t) => m.teams[t].map(p => `<span class="${m.down[p.u] ? 'is-down' : ''}">${esc(p.n)}</span>`).join(' ');
            html = `<div class="w-arena-score"><b>${m.wins[m.team]}</b> – <b>${m.wins[other]}</b></div><div class="w-arena-what">${esc(Ar.MODES[m.mode].name)} · ${esc(what)}</div>
                <div class="w-arena-teams"><div>${names(m.team)}</div><div>vs</div><div>${names(other)}</div></div>${m.result ? '' : '<button class="btn btn-sm btn-ghost" id="arForfeit">Forfeit</button>'}`;
        } else if (g.zoneId === 'arena' && (AR.queue || AR.pending || AR.accepted)) {
            html = `<div class="w-arena-what">${AR.queue ? 'In the queue for a ' + esc(Ar.MODES[AR.queue].name) : 'Waiting for the other side…'}</div>${AR.queue ? '<button class="btn btn-sm btn-ghost" id="arLeaveQ">Leave the queue</button>' : ''}`;
        }
        const key = html;
        if (key === hudKey) return;
        hudKey = key;
        const e = el('arenaHud', 'w-arena-hud');
        e.hidden = !html;
        e.innerHTML = html;
        const f = e.querySelector('#arForfeit'); if (f) f.addEventListener('click', () => { if (confirm('Forfeit this match? It counts as a loss.')) AR.forfeit(); });
        const lq = e.querySelector('#arLeaveQ'); if (lq) lq.addEventListener('click', () => AR.setQueue(''));
    }
    function renderInvite() {
        const e = el('arenaInvite', 'w-arena-invite');
        const inv = AR.invite;
        if (!inv) { e.hidden = true; e.innerHTML = ''; return; }
        e.hidden = false;
        {
            const ask = inv.ask, mine = ask.a.some(p => p.u === me()) ? 'a' : 'b', foes = ask[mine === 'a' ? 'b' : 'a'], cap = remoteOf(ask.cap);
            e.innerHTML = `<div class="w-card-name">⚔️ ${esc(cap ? cap.info.n : 'Someone')} challenges you</div>
                <div class="w-card-sub">${esc(Ar.MODES[ask.mode].name)} against ${foes.map(p => esc(p.n) + ' (' + p.r + ')').join(', ')}${ask.stake ? ` · <b>${fmt(ask.stake)} rubies each</b>, winner takes the pot` : ' · no stake'}</div>
                <div class="w-card-actions"><button class="btn btn-sm btn-gold" id="arYes">Accept</button><button class="btn btn-sm btn-ghost" id="arNo">Decline</button></div>`;
            e.querySelector('#arYes').addEventListener('click', () => AR.respond(true));
            e.querySelector('#arNo').addEventListener('click', () => AR.respond(false));
        }
    }

    // ---------------- menus ----------------
    let tab = 'play', board = 'top';
    AR.openMenu = function (which) {
        if (which) tab = which;
        WHW.ui.modal('🏟️ The Arena', '', { wide: true, render: renderMenu });
        renderMenu();
    };
    function renderMenu() {
        const g = game(), s = g.state, a = s.arena, body = document.getElementById('wModalBody');
        const rank = Ar.rankFor(a.rating), tabsHtml = ['play', 'tour', 'rank', 'shop', 'record'].map(t => `<button class="w-tab${t === tab ? ' is-on' : ''}" data-artab="${t}">${{ play: 'Play', tour: 'Tournaments', rank: 'Leaderboards', shop: 'Glory shop', record: 'Your record' }[t]}</button>`).join('');
        let html = `<div class="w-tabs">${tabsHtml}</div>
            <div class="w-arena-me"><span style="color:${rank.color}">● ${esc(rank.name)}</span> · rating <b>${a.rating}</b> · <b>${fmt(a.glory)}</b> Glory${a.title ? ' · title: <b>' + esc(a.title) + '</b>' : ''}</div>`;
        if (tab === 'play') {
            const party = partyMembers();
            html += `<p class="w-note"><b>The Pit</b>: walk into the sand circle in the middle and fight anyone else in it. <b>Nothing is ever lost in the Arena</b>: a knockout drops nothing, and you are back up at the Pit's gate a moment later. Each knockout earns Glory.</p>
                <p class="w-note"><b>Duels and team battles</b> (best of three rounds, rated): walk up to another player in the lobby and press <kbd>E</kbd> to challenge them, optionally for a ruby stake (the winner takes the pot), or wait in the queue below. For a 2v2 or 3v3, make a party first (<kbd>E</kbd> near a player, then <i>Invite to party</i>).</p>
                <p class="w-note"><b>The Proving Grounds</b> (the gate on the left): co-op waves of monsters, harder with every player who joins.</p>
                <div class="w-section"><h3>The queue</h3>${online() ? `<div class="w-row">${Object.keys(Ar.MODES).map(m => `<button class="btn btn-sm ${AR.queue === m ? 'btn-gold' : 'btn-primary'}" data-arq="${m}">${AR.queue === m ? '✓ ' : ''}${esc(Ar.MODES[m].name)}</button>`).join('')}${AR.queue ? '<button class="btn btn-sm btn-ghost" data-arq="">Leave the queue</button>' : ''}</div>` : '<p class="muted">Matches need online play: turn it on in the 🌐 menu.</p>'}</div>
                <div class="w-section"><h3>Your party here</h3><p>${party.map(p => esc(p.n)).join(', ')}${WHW.party && WHW.party.id ? ' <button class="btn btn-sm btn-ghost" data-arleave>Leave the party</button>' : ' <span class="muted">(just you: invite someone with <kbd>E</kbd>)</span>'}</p></div>`;
        } else if (tab === 'tour') {
            html += '<div id="arTour"></div>';
        } else if (tab === 'rank') {
            html += `<div class="w-row">${[['top', '⚔️ Highest rating'], ['waves', '🌊 Highest wave']].map(([k, l]) => `<button class="btn btn-sm ${board === k ? 'btn-gold' : 'btn-ghost'}" data-arboard="${k}">${l}</button>`).join('')}</div>
                <div id="arTop"><p class="muted">Loading…</p></div><p class="muted">${board === 'top' ? 'Ratings come from duels and team battles (Elo).' : 'The furthest wave reached in the Proving Grounds, with how many players were in that run.'} Each player's own game reports it, so these boards are for fun, like the game's leaderboard.</p>`;
        } else if (tab === 'shop') {
            html += `<div class="w-grid">${Ar.SHOP.map(it => {
                const owned = it.title && a.titles[it.title], week = it.weekly && a.coffer === W.weekKey(Date.now());
                return `<div class="w-card"><div class="w-card-name">${esc(it.name)}</div><div class="w-card-sub">${fmt(it.glory)} Glory${it.weekly ? ' · once a week, counts toward your lootbox allowance' : ''}</div>
                    <div class="w-card-actions"><button class="btn btn-sm btn-gold" data-arbuy="${it.id}" ${owned || week || a.glory < it.glory ? 'disabled' : ''}>${owned ? 'Owned' : week ? 'Bought this week' : 'Buy'}</button></div></div>`;
            }).join('')}</div>`;
        } else {
            const titles = Ar.titlesOf(a);
            html += `<div class="w-card-stats"><span>Tournaments ${a.tourPlayed}</span><span>Tournament wins ${a.tourWins}</span><span>Prize rubies ${fmt(a.tourPrize)}</span><span>Wins ${a.w}</span><span>Losses ${a.l}</span><span>Draws ${a.d}</span><span>Team wins ${a.teamW}</span><span>Pit knockouts ${a.pitKO}</span><span>Best wave ${a.waveBest}</span><span>Best rating ${a.peak}</span><span>Wagers won ${a.wagerWins} (${a.wagerNet >= 0 ? '+' : ''}${fmt(a.wagerNet)} rubies)</span></div>
                <div class="w-section"><h3>Title</h3><select id="arTitle"><option value="">None</option>${titles.map(t => `<option ${t === a.title ? 'selected' : ''}>${esc(t)}</option>`).join('')}</select>
                <p class="muted">Shown under your name to other players. Rank titles come with your best rating; others from the Glory shop.</p></div>`;
        }
        body.innerHTML = html;
        body.querySelectorAll('[data-artab]').forEach(b => b.addEventListener('click', () => { tab = b.dataset.artab; renderMenu(); }));
        body.querySelectorAll('[data-arboard]').forEach(b => b.addEventListener('click', () => { board = b.dataset.arboard; renderMenu(); }));
        if (tab === 'tour' && WHW.tour) WHW.tour.renderTab(body.querySelector('#arTour'));
        body.querySelectorAll('[data-arq]').forEach(b => b.addEventListener('click', () => AR.setQueue(b.dataset.arq)));
        const lp = body.querySelector('[data-arleave]'); if (lp) lp.addEventListener('click', () => { WHW.party.leave(); renderMenu(); });
        body.querySelectorAll('[data-arbuy]').forEach(b => b.addEventListener('click', () => {
            const r = W.arenaBuy(s, b.dataset.arbuy, Date.now(), g.ack);
            if (!r.ok) WHW.toast({ glory: 'Not enough Glory.', week: 'Already bought this week.', allowance: "This week's lootbox allowance is used up.", owned: 'You have it already.' }[r.reason] || "Can't do that.", 'bad');
            else { WHW.toast('Bought: ' + r.item.name + '.', 'gold'); WHW.save(); net() && (net().infoKey = ''); }
            renderMenu();
        }));
        const ts = body.querySelector('#arTitle'); if (ts) ts.addEventListener('change', () => { W.setTitle(s, ts.value); WHW.save(); if (net()) net().infoKey = ''; renderMenu(); });
        if (tab === 'rank') {
            const box = body.querySelector('#arTop');
            if (!net() || !net().db) box.innerHTML = '<p class="muted">The board needs online play.</p>';
            else {
                const kind = board;
                net().readBoard(kind, (tree) => {
                    if (!box.isConnected || kind !== board) return;
                    const waves = kind === 'waves', list = waves ? Ar.wavesList(tree, 20) : Ar.topList(tree, 20), place = Ar.placeOn(tree, me(), kind);
                    const mine = (r) => (r.uid === me() ? ' class="is-me"' : '');
                    const row = waves ? (r) => `<li${mine(r)}><b>${esc(r.n)}</b>${r.ti ? ' <span class="muted">' + esc(r.ti) + '</span>' : ''} wave <b>${r.w}</b> <span class="muted">${r.p === 1 ? 'alone' : 'with ' + r.p + ' players'}</span></li>`
                        : (r) => `<li${mine(r)}><b>${esc(r.n)}</b>${r.ti ? ' <span class="muted">' + esc(r.ti) + '</span>' : ''} <span style="color:${Ar.rankFor(r.r).color}">${r.r}</span> <span class="muted">${esc(Ar.rankFor(r.r).name)} · ${r.w}W ${r.l}L</span></li>`;
                    const you = place ? `<p>You are <b>#${place}</b>.</p>` : `<p class="muted">You aren't on this board yet: ${waves ? 'clear a wave in the Proving Grounds' : 'finish a duel or team battle'}.</p>`;
                    box.innerHTML = (list.length ? `<ol class="w-arena-top">${list.map(row).join('')}</ol>` : `<p class="muted">${waves ? 'Nobody has cleared a wave yet' : 'Nobody has fought yet'}. Be the first.</p>`) + you;
                });
            }
        }
    }
    // Another player in the lobby: challenge them, or invite them to your party
    AR.openPlayer = function (r) {
        const s = game().state;
        const stakes = R.stakes.filter(x => x <= s.rubies);
        const theirParty = partyOf(r), mine = partyMembers();
        const teamMode = mine.length === theirParty.length && mine.length >= 2 ? (mine.length === 2 ? 't2' : 't3') : '';
        const body = WHW.ui.modal('⚔️ ' + r.info.n, `<p>Rating <b>${r.info.r || R.elo.start}</b> (${esc(Ar.rankFor(r.info.r || R.elo.start).name)})${r.info.ti ? ' · ' + esc(r.info.ti) : ''}${r.info.pt ? ' · in a party of ' + theirParty.length : ''}</p>
            <div class="w-section"><h3>Challenge</h3><label>Stake (rubies each, the winner takes the pot): <select id="arStake">${stakes.map(x => `<option value="${x}">${x ? fmt(x) : 'No stake'}</option>`).join('')}</select></label>
            <div class="w-card-actions"><button class="btn btn-primary" id="arDuel">Challenge to a duel</button>
            ${teamMode ? `<button class="btn btn-primary" id="arTeam">Challenge their party (${Ar.MODES[teamMode].name})</button>` : `<span class="muted">Team battles: a party of 2 or 3 on each side.</span>`}</div></div>
            <div class="w-section"><h3>Party</h3>${WHW.party && WHW.party.isMate(r.uid) ? '<p class="muted">Already in your party.</p>' : '<button class="btn btn-ghost" id="arParty">Invite to your party</button>'}</div>`);
        const stake = () => Number(body.querySelector('#arStake').value) || 0;
        body.querySelector('#arDuel').addEventListener('click', () => { WHW.ui.closeModal(); AR.challenge(r, 'duel', stake()); });
        const tb = body.querySelector('#arTeam'); if (tb) tb.addEventListener('click', () => { WHW.ui.closeModal(); AR.challenge(r, teamMode, stake()); });
        const pb = body.querySelector('#arParty'); if (pb) pb.addEventListener('click', () => { WHW.ui.closeModal(); WHW.party.invitePlayer(r); });
    };
    // the lobby: the strip along the bottom of the arena where nobody can be hurt
    AR.inLobby = function (p) { const l = game().map.lobby; return !!l && p.y >= l.y0 && p.y <= l.y1; };
    window.addEventListener('pagehide', () => { if (AR.match && !AR.match.result && net() && net().db) sendAll(Ar.members(AR.match).map(u => ({ u })), 'quit', AR.match.id, ''); });
})();
