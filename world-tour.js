/**
 * Tournaments (world.html): the page side of core/world-tour.js. Opened, joined and played in the Arena; the fee, the
 * refund and the prize go through the save (core/world-logic.js tourJoin / tourLeave / tourSeen).
 * - Every tournament this player signed up for is watched (wilds/v1/arena/tour/{tid}) wherever they are, so a fee comes back
 *   or a prize arrives even outside the Arena.
 * - In the Arena, with a pairing ready: the better seed sends the duel's invitation (world-arena.js tourChallenge) and the
 *   other page accepts it (expects). When the duel ends each page writes its own result (duelOver); a draw is played again.
 *   An opponent who isn't in the Arena noShowSec after the pairing was ready loses by walkover (a claim they can answer).
 * - The Arena Master's Tournaments tab lists them (read while it is open), opens new ones and shows the brackets.
 */
(function () {
    'use strict';
    const D = window.WHWorldData, W = window.WHWorld, T = window.WHWorldTour, CS = window.WHChatSafety;
    const WHW = window.WHW, E = WHW.engine;
    const TOUR = T.TOUR;
    const game = () => WHW.game;
    const net = () => WHW.online;
    const up = () => !!(net() && net().db && net().status === 'online');
    const me = () => net() && net().uid;
    const sNow = () => (net() && net().db ? net().db.serverNow() : Date.now());
    const esc = (s) => WHW.ui.esc(s);
    const fmt = (n) => Math.round(n).toLocaleString('en-US');
    const tp = (tid, sub) => TOUR.root + '/' + tid + (sub ? '/' + sub : '');
    const clock = (t) => { const d = new Date(t); return String(d.getHours()).padStart(2, '0') + ':' + String(d.getMinutes()).padStart(2, '0'); };

    const TR = WHW.tour = {
        mine: new Map(),     // tid -> the tournament as last seen (sanitized; null: gone), for every one I'm in or host
        subs: new Map(),     // tid -> unsubscribe
        all: new Map(),      // every tournament, while the Tournaments tab is open
        allSub: null, db: null,
        hosting: new Set(),  // the ones I opened this session (watched so I can start them on time)
        seen: new Set(),     // ones the database has shown me (a missing record only means "gone" after that)
        wrote: new Set(),    // results written: tid/slot+kind
        askAt: 0, toldSlot: '', t: 0,
    };

    // ---------------- watching ----------------
    // each time world-online.js joins a zone (and so after connecting): watch every tournament in my save
    TR.online = function () {
        const db = net().db;
        if (TR.db !== db) { TR.offline(); TR.db = db; }
        W.tourPrune(game().state, Date.now());
        for (const tid in game().state.arena.tours) watch(tid);
        for (const tid of TR.hosting) watch(tid);
    };
    TR.offline = function () { for (const u of TR.subs.values()) { try { u(); } catch (e) {} } TR.subs.clear(); TR.mine.clear(); stopList(); TR.db = null; };
    function watch(tid) {
        if (TR.subs.has(tid) || !up()) return;
        TR.subs.set(tid, net().db.onValue(tp(tid), (v) => {
            // nothing there: gone, if it was there before (or my signup is so old it must have been tidied away); otherwise
            // it just hasn't arrived yet (one I opened a moment ago)
            const rec = game().state.arena.tours[tid];
            if (!v && !TR.seen.has(tid) && !(rec && T.expired(rec.t, Date.now()))) return;
            if (v) TR.seen.add(tid);
            TR.mine.set(tid, v ? T.sanitizeTour(tid, v) : null);
            settle(tid);
            renderOpen();
        }));
    }
    function unwatch(tid) { const u = TR.subs.get(tid); if (u) { try { u(); } catch (e) {} } TR.subs.delete(tid); TR.mine.delete(tid); }
    // the fee back, or the prize, when the record says so (each once: the save remembers)
    function settle(tid) {
        const s = game().state, tour = TR.mine.get(tid);
        if (!s.arena.tours[tid]) return;
        const got = W.tourSeen(s, tour || null, tid, me(), sNow());
        if (!got) return;
        const name = tour ? '"' + tour.n + '"' : 'A tournament';
        if (got.kind === 'off') WHW.toast(`🏆 ${name} was called off: your ${fmt(got.rubies)} rubies are back.`);
        else if (got.kind === 'cut') WHW.toast(`🏆 ${name} was full when it started: your ${fmt(got.rubies)} rubies are back.`);
        else if (got.kind === 'started') WHW.toast(`🏆 ${name} has started! Stay in the Arena for your duels.`, 'gold');
        else if (got.kind === 'paid') {
            const place = got.place ? ['', '1st', '2nd', '3rd'][got.place] + ' place' : '';
            WHW.toast(`🏆 ${name} is over${place ? ': you took ' + place : ''}${got.rubies ? '. +' + fmt(got.rubies) + ' rubies' : '.'}`, got.place === 1 ? 'gold' : '');
            if (got.place === 1) { WHW.banner('Tournament champion!', tour ? tour.n : ''); WHW.sfx('boss'); }
        }
        WHW.save();
        if (got.kind !== 'started' && !TR.hosting.has(tid)) unwatch(tid);
    }

    // ---------------- playing ----------------
    // the tournaments I'm playing in right now, with my pairing in each
    function playing() {
        const out = [];
        for (const [tid, tour] of TR.mine) {
            if (!tour || !tour.seeds.includes(me()) || T.status(tour, sNow()) !== 'run') continue;
            const br = T.bracket(tour, sNow());
            out.push({ tid, tour, br, pair: T.myPairing(tour, br, me()) });
        }
        return out;
    }
    TR.tagOf = (s) => T.parseTag(s);
    // is one of my tournament duels due now? (other challenges wait till it's played)
    TR.due = function () { return playing().some(x => x.pair); };
    TR.duelName = function (tg) { const tour = TR.mine.get(tg.tid); if (!tour) return 'Tournament duel'; const br = T.bracket(tour, sNow()), sl = br.slots[tg.slot]; return tour.n + ' · ' + (sl ? T.roundName(br.S, sl.round, sl.i) : 'duel'); };
    // a tournament duel's invitation: is it the pairing I'm due to play, from the player who sends it?
    TR.expects = function (ask) {
        const tg = T.parseTag(ask.tour), tour = tg && TR.mine.get(tg.tid);
        if (!tour) return false;
        const pair = T.myPairing(tour, T.bracket(tour, sNow()), me());
        const all = ask.a.concat(ask.b).map(p => p.u);
        return !!pair && pair.slot === tg.slot && ask.cap === pair.captain && all.includes(pair.foe) && all.includes(me()) && tg.g === tour.g;
    };
    function write(tid, slot, kind, x) {
        const key = tid + '/' + T.resultKey(slot, kind);
        if (TR.wrote.has(key) || !up()) return;
        TR.wrote.add(key);
        net().db.set(tp(tid, 'r/' + me() + '/' + T.resultKey(slot, kind)), kind === 'o' ? { x: 'o', t: sNow() } : { x, t: sNow() });
    }
    // a tournament duel is over (world-arena.js): my page says how it went for me; a draw is played again
    TR.duelOver = function (m, r) {
        const tg = T.parseTag(m.tour);
        if (!tg || r.draw) { if (tg) WHW.toast('A draw: the duel will be played again.'); TR.askAt = E.time; return; }
        write(tg.tid, tg.slot, 'v', r.won ? 'w' : 'l');
        WHW.toast(r.won ? '🏆 You go through!' : '🏆 You are out of the tournament.', r.won ? 'gold' : '');
    };
    TR.update = function (dt) {
        TR.t -= dt;
        if (TR.t > 0 || !up()) return;
        TR.t = 1;
        const now = sNow(), g = game();
        // the host starts it when signups close (or calls it off with nobody to play), and so may an entrant a minute later
        for (const [tid, tour] of TR.mine) {
            if (!tour || T.status(tour, now) !== 'open' || now < tour.at) continue;
            if (tour.entries.length < TOUR.minPlayers) { if (tour.h === me()) net().db.update(tp(tid), { st: 'off' }); }
            else if (T.canStart(tour, me(), now)) TR.start(tour);
        }
        for (const tid of TR.mine.keys()) settle(tid);
        const list = playing();
        for (const { tid, tour, pair } of list) {
            if (!pair) continue;
            const slotKey = tid + '/' + pair.slot;
            if (TR.toldSlot !== slotKey) {
                TR.toldSlot = slotKey;
                const foe = tour.entries.find(e => e.u === pair.foe);
                WHW.toast(`🏆 ${tour.n}: your ${pair.name} against ${foe ? foe.n : 'your opponent'} is up${g.zoneId === 'arena' ? '' : ': go to the Arena'}!`, 'gold');
                WHW.sfx && WHW.sfx('craft');
            }
            if (g.zoneId !== 'arena' || net().zone !== 'arena') continue;
            const r = net().remotes.get(pair.foe), here = !!(r && !r.stale && r.info);
            const res = tour.res[me()] || {}, theirs = tour.res[pair.foe] || {};
            if (res[T.resultKey(pair.slot, 'v')]) continue; // I've said how it went
            // they claim I never came, but I'm here: say so (the claim then doesn't stand, and we play)
            if (theirs[T.resultKey(pair.slot, 'o')] && !res[T.resultKey(pair.slot, 'o')]) { write(tid, pair.slot, 'o'); continue; }
            if (here && pair.captain === me() && !WHW.arena.busy() && !r.info.am && E.time - TR.askAt > TOUR.replaySec) {
                if (WHW.arena.tourChallenge(r, T.tag(tid, pair.slot, tour.g))) TR.askAt = E.time;
            }
            // they never came
            if (!here && now - pair.readyAt > TOUR.noShowSec * 1000 && !res[T.resultKey(pair.slot, 'o')]) {
                write(tid, pair.slot, 'o');
                WHW.toast(`🏆 ${tour.n}: your opponent hasn't come. You win by walkover in ${TOUR.disputeSec} seconds unless they turn up.`);
            }
        }
        renderHud(list);
    };

    // ---------------- opening, joining, starting ----------------
    TR.create = function (opts, enter) {
        if (!up()) { WHW.toast('Tournaments need online play (the 🌐 menu).', 'bad'); return false; }
        const s = game().state, rec = T.newTour(opts, me(), net().name(), sNow());
        if (!rec) { WHW.toast("Those settings don't work together.", 'bad'); return false; }
        if (enter && s.rubies < rec.fee) { WHW.toast("You can't cover your own entry fee.", 'bad'); return false; }
        const tid = T.newTid();
        net().db.set(tp(tid), rec);
        TR.hosting.add(tid);
        if (enter) { const tour = T.sanitizeTour(tid, Object.assign({ e: {} }, rec)); TR.join(tour); }
        watch(tid);
        WHW.toast(`🏆 "${rec.n}" is open: signups close at ${clock(rec.at)}.`, 'gold');
        return true;
    };
    TR.join = function (tour) {
        const s = game().state, r = W.tourJoin(s, tour, sNow());
        if (!r.ok) { WHW.toast({ rubies: "You can't cover the entry fee.", joined: "You're signed up already.", closed: 'Signups are closed.' }[r.reason] || "Can't join.", 'bad'); return; }
        net().db.set(tp(tour.id, 'e/' + me()), T.entry(net().name(), s.arena.rating, sNow()));
        watch(tour.id);
        WHW.save();
        WHW.toast(`🏆 Signed up for "${tour.n}"${tour.fee ? ' (' + fmt(tour.fee) + ' rubies)' : ''}. It starts at ${clock(tour.at)}: be in the Arena.`, 'gold');
    };
    TR.withdraw = function (tour) {
        const back = W.tourLeave(game().state, tour.id);
        net().db.remove(tp(tour.id, 'e/' + me()));
        WHW.save();
        WHW.toast('You left "' + tour.n + '"' + (back ? ': ' + fmt(back) + ' rubies back.' : '.'));
    };
    TR.start = function (tour) {
        if (!T.canStart(tour, me(), sNow())) return;
        net().db.update(tp(tour.id), { st: 'run', s: T.seedList(tour).join(','), go: sNow() });
    };
    TR.callOff = function (tour) { if (tour.h === me() && tour.st === 'open') net().db.update(tp(tour.id), { st: 'off' }); };

    // ---------------- the HUD ----------------
    let hudKey = '';
    function renderHud(list) {
        let e = document.getElementById('tourHud');
        if (!e) { const hud = document.getElementById('wHud'); if (!hud) return; e = document.createElement('div'); e.id = 'tourHud'; e.className = 'w-tour-hud'; hud.appendChild(e); }
        let html = '';
        const now = sNow();
        for (const { tour, br, pair } of list || []) {
            if (pair) {
                const foe = tour.entries.find(x => x.u === pair.foe), left = Math.max(0, Math.ceil((pair.deadline - now) / 1000));
                html += `<div>🏆 <b>${esc(tour.n)}</b>: ${esc(pair.name)} vs ${esc(foe ? foe.n : '?')} · ${Math.floor(left / 60)}:${String(left % 60).padStart(2, '0')} left</div>`;
            } else if (T.stillIn(tour, br, me())) html += `<div>🏆 <b>${esc(tour.n)}</b>: waiting for the next round</div>`;
        }
        if (html === hudKey) return;
        hudKey = html;
        e.hidden = !html || !!(WHW.arena && WHW.arena.match);
        e.innerHTML = html;
    }

    // ---------------- the Tournaments tab (world-arena.js menu) ----------------
    function startList() {
        if (TR.allSub || !up()) return;
        TR.allSub = net().db.onValue(TOUR.root, (tree) => {
            TR.all.clear();
            const now = sNow();
            if (tree && typeof tree === 'object') for (const tid in tree) {
                const t = T.sanitizeTour(tid, tree[tid]);
                // long over: tidy it away (anyone may)
                if (tree[tid] && typeof tree[tid] === 'object' && T.expired(Number(tree[tid].t) || 0, now)) { net().db.remove(tp(tid)); continue; }
                if (t) TR.all.set(tid, t);
            }
            renderOpen();
        });
    }
    function stopList() { if (TR.allSub) { try { TR.allSub(); } catch (e) {} } TR.allSub = null; TR.all.clear(); }
    let view = { el: null, mode: 'list', tid: null };
    TR.renderTab = function (el) { view = { el, mode: view.el === el ? view.mode : 'list', tid: view.tid }; startList(); renderOpen(); };
    function renderOpen() {
        const el = view.el;
        if (!el) return;
        if (!el.isConnected) { view.el = null; stopList(); return; }
        if (!up()) { el.innerHTML = '<p class="muted">Tournaments need online play: turn it on in the 🌐 menu.</p>'; return; }
        if (view.mode === 'new') return renderNew(el);
        if (view.mode === 'bracket') return renderBracket(el, TR.all.get(view.tid) || TR.mine.get(view.tid));
        renderList(el);
    }
    function prizeText(tour, n) {
        const pot = tour.fee * n, sh = T.shares(tour.p2, tour.p3);
        if (!tour.fee) return 'For glory (no fee)';
        return ['1st', '2nd', '3rd'].map((p, i) => sh[i] ? `${p} ${fmt(Math.floor(pot * sh[i] / 100))}` : '').filter(Boolean).join(' · ') + ' rubies';
    }
    const gearText = (g) => (g ? 'Everyone gets a ' + D.TIERS[g].name + ' kit (tier ' + g + ')' : 'Own gear');
    function renderList(el) {
        const s = game().state, now = sNow();
        const list = [...TR.all.values()].map(t => ({ t, st: T.status(t, now) })).filter(x => x.st !== 'off' && (x.st !== 'done' || now - x.t.go < 86400000))
            .sort((a, b) => ['starting', 'run', 'open', 'done'].indexOf(a.st) - ['starting', 'run', 'open', 'done'].indexOf(b.st) || b.t.t - a.t.t);
        const safe = CS.isOn(localStorage);
        const card = ({ t, st }) => {
            const inIt = !!s.arena.tours[t.id], n = st === 'open' ? t.entries.length : t.seeds.length, host = t.h === me();
            let what, acts = '';
            if (st === 'open') {
                what = `Signups close at <b>${clock(t.at)}</b> · ${n} of ${t.size} players`;
                if (inIt) acts += `<button class="btn btn-sm btn-ghost" data-tleave="${t.id}">Leave (fee back)</button>`;
                else acts += `<button class="btn btn-sm btn-gold" data-tjoin="${t.id}" ${s.rubies < t.fee || n >= t.size ? 'disabled' : ''}>${n >= t.size ? 'Full' : 'Join' + (t.fee ? ' · ' + fmt(t.fee) + ' rubies' : '')}</button>`;
                if (T.canStart(t, me(), now)) acts += `<button class="btn btn-sm btn-primary" data-tstart="${t.id}">Start now</button>`;
                if (host) acts += `<button class="btn btn-sm btn-ghost" data-toff="${t.id}">Call off</button>`;
            } else if (st === 'starting') {
                what = 'Starting…';
            } else if (st === 'run') {
                const br = T.bracket(t, now), pair = T.myPairing(t, br, me());
                what = pair ? `<b>Your ${esc(pair.name)} is up!</b>` : t.seeds.includes(me()) ? (T.stillIn(t, br, me()) ? 'You are through: waiting for the next round' : 'You are out') : 'Under way';
            } else {
                const br = T.bracket(t, now), champ = t.entries.find(e => e.u === br.first);
                what = champ ? `Won by <b>${esc(champ.n)}</b>` : 'Over';
            }
            acts += `<button class="btn btn-sm btn-ghost" data-tbr="${t.id}">Bracket</button>`;
            return `<div class="w-card"><div class="w-card-name">${esc(CS.display(t.n, safe))}${inIt ? ' <span class="muted">· you are in</span>' : ''}</div>
                <div class="w-card-sub">by ${esc(t.hn)} · ${t.fee ? fmt(t.fee) + ' rubies to enter' : 'free to enter'} · ${esc(prizeText(t, n))} · ${esc(gearText(t.g))}</div>
                <div class="w-card-sub">${what}</div><div class="w-card-actions">${acts}</div></div>`;
        };
        el.innerHTML = `<p class="w-note"><b>Tournaments</b>: a knockout of duels. Everyone pays the entry fee; the winner takes the pot, or its host gives part of it to 2nd and 3rd place. Stay in the Arena while it runs: your duels start on their own, and an opponent who doesn't come loses by walkover.</p>
            <div class="w-card-actions"><button class="btn btn-primary" id="tNew">Open a tournament</button></div>
            ${list.length ? '<div class="w-grid">' + list.map(card).join('') + '</div>' : '<p class="muted">No tournaments right now. Open one!</p>'}`;
        el.querySelector('#tNew').addEventListener('click', () => { view.mode = 'new'; renderOpen(); });
        const byId = (id) => TR.all.get(id);
        el.querySelectorAll('[data-tjoin]').forEach(b => b.addEventListener('click', () => { const t = byId(b.dataset.tjoin); if (t) TR.join(t); renderOpen(); }));
        el.querySelectorAll('[data-tleave]').forEach(b => b.addEventListener('click', () => { const t = byId(b.dataset.tleave); if (t) TR.withdraw(t); renderOpen(); }));
        el.querySelectorAll('[data-tstart]').forEach(b => b.addEventListener('click', () => { const t = byId(b.dataset.tstart); if (t) TR.start(t); }));
        el.querySelectorAll('[data-toff]').forEach(b => b.addEventListener('click', () => { const t = byId(b.dataset.toff); if (t && confirm('Call off "' + t.n + '"? Everyone gets their fee back.')) TR.callOff(t); }));
        el.querySelectorAll('[data-tbr]').forEach(b => b.addEventListener('click', () => { view.mode = 'bracket'; view.tid = b.dataset.tbr; renderOpen(); }));
    }
    function renderNew(el) {
        const opt = (list, f, sel) => list.map(v => `<option value="${v}" ${v === sel ? 'selected' : ''}>${f(v)}</option>`).join('');
        const tiers = Array.from({ length: D.MAX_TIER + 1 }, (_, i) => i);
        el.innerHTML = `<form class="w-tour-form" id="tForm" autocomplete="off">
            <label>Name <input id="tName" maxlength="24" placeholder="e.g. Friday Night Cup" required></label>
            <label>Entry fee <select id="tFee">${opt(TOUR.fees, v => (v ? fmt(v) + ' rubies' : 'Free'), 250)}</select></label>
            <label>Most players <select id="tSize">${opt(TOUR.sizes, v => v, 8)}</select></label>
            <label>2nd place gets <select id="tP2">${opt(TOUR.second, v => (v ? v + '% of the pot' : 'nothing'), 0)}</select></label>
            <label>3rd place gets <select id="tP3">${opt(TOUR.third, v => (v ? v + '% of the pot' : 'nothing (no bronze match)'), 0)}</select></label>
            <label>Gear <select id="tGear">${opt(tiers, v => (v ? 'Locked: everyone gets a ' + D.TIERS[v].name + ' kit (tier ' + v + ')' : "Everyone's own gear"), 0)}</select></label>
            <label>Signups close in <select id="tStart">${opt(TOUR.startMin, v => v + ' minutes', 5)}</select></label>
            <label class="w-setting"><span>Enter it myself<small>You pay the fee like everyone else.</small></span><input type="checkbox" id="tEnter" checked></label>
            <p class="muted" id="tSplit"></p>
            <div class="w-card-actions"><button class="btn btn-gold">Open it</button><button type="button" class="btn btn-ghost" id="tBack">Back</button></div></form>`;
        const f = el.querySelector('#tForm'), v = (id) => f.querySelector(id).value;
        const opts = () => ({ n: v('#tName'), fee: Number(v('#tFee')), size: Number(v('#tSize')), p2: Number(v('#tP2')), p3: Number(v('#tP3')), g: Number(v('#tGear')), start: Number(v('#tStart')) });
        const split = () => {
            const o = opts(), sh = T.shares(o.p2, o.p3), bad = o.p3 > o.p2 || o.p2 + o.p3 > 50;
            f.querySelector('#tSplit').textContent = bad ? '3rd place can\'t get more than 2nd, and 1st always gets at least half.'
                : `With ${o.size} players the pot is ${fmt(o.fee * o.size)} rubies: 1st gets ${sh[0]}%` + (sh[1] ? `, 2nd ${sh[1]}%` : '') + (sh[2] ? `, 3rd ${sh[2]}% (the semi-final losers play for it)` : '') + '.';
        };
        f.addEventListener('change', split); split();
        f.addEventListener('submit', (ev) => {
            ev.preventDefault();
            const o = opts();
            if (!T.cleanTitle(o.n)) { WHW.toast('Names are 3 to 24 letters, numbers and simple punctuation.', 'bad'); return; }
            if (!T.cleanOptions(o)) { WHW.toast("Those prizes don't work: 3rd can't get more than 2nd, and 1st gets at least half.", 'bad'); return; }
            if (TR.create(o, f.querySelector('#tEnter').checked)) { view.mode = 'list'; renderOpen(); }
        });
        f.querySelector('#tBack').addEventListener('click', () => { view.mode = 'list'; renderOpen(); });
    }
    function renderBracket(el, tour) {
        if (!tour) { el.innerHTML = '<p class="muted">That tournament is gone.</p><button class="btn btn-ghost" id="tBack">Back</button>'; el.querySelector('#tBack').addEventListener('click', () => { view.mode = 'list'; renderOpen(); }); return; }
        const now = sNow(), st = T.status(tour, now), name = (u) => { const e = tour.entries.find(x => x.u === u); return e ? esc(e.n) : '—'; };
        let html = `<div class="w-card-name">${esc(CS.display(tour.n, CS.isOn(localStorage)))}</div><p class="muted">${esc(prizeText(tour, st === 'open' ? tour.entries.length : tour.seeds.length))} · ${esc(gearText(tour.g))}</p>`;
        if (st === 'open' || !tour.seeds.length) {
            html += `<div class="w-players">${tour.entries.map(e => `<span>${esc(e.n)}<b>${e.r}</b></span>`).join('') || '<span class="muted">Nobody yet</span>'}</div>`;
        } else {
            const br = T.bracket(tour, now), cols = [];
            const slot = (x) => {
                if (!x) return '';
                const cls = (u) => (x.win && x.win === u ? 'is-win' : x.state === 'done' || x.state === 'void' ? 'is-out' : '');
                const how = { walkover: 'walkover', disputed: 'disputed: both out', timeout: 'not played: both out', bye: 'bye' }[x.how] || (x.state === 'ready' ? 'playing now' : '');
                return `<div class="w-tour-slot${x.state === 'ready' ? ' is-live' : ''}"><span class="${cls(x.a)}">${x.a ? name(x.a) : (x.state === 'wait' ? '…' : 'bye')}</span><span class="${cls(x.b)}">${x.b ? name(x.b) : (x.state === 'wait' ? '…' : 'bye')}</span>${how ? `<small>${how}</small>` : ''}</div>`;
            };
            for (let r = 0; r < br.rounds; r++) {
                const n = br.S >> (r + 1), base = br.S - (br.S >> r);
                cols.push(`<div class="w-tour-col"><h4>${esc(T.roundName(br.S, r, base))}</h4>${br.slots.slice(base, base + n).map(slot).join('')}${r === br.rounds - 1 && br.bronze ? '<h4>Bronze match</h4>' + slot(br.slots[br.S - 1]) : ''}</div>`);
            }
            html += `<div class="w-tour-bracket">${cols.join('')}</div>`;
            if (st === 'done') html += `<p>🥇 ${name(br.first)}${br.second ? ' · 🥈 ' + name(br.second) : ''}${br.third ? ' · 🥉 ' + name(br.third) : ''}</p>`;
        }
        html += '<div class="w-card-actions"><button class="btn btn-ghost" id="tBack">Back</button></div>';
        el.innerHTML = html;
        el.querySelector('#tBack').addEventListener('click', () => { view.mode = 'list'; renderOpen(); });
    }
})();
