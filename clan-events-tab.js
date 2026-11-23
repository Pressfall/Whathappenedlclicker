/**
 * The clan page's Events tab (clan.html; started by clan-page.js).
 *
 * - Keeps the schedule moving: any visitor rolls events/state forward in one transaction, and every event that ended goes
 *   into events/last_ended_event (with who met whom, for Clan v Clan and the race), so nobody misses a payout because two
 *   events ended while nobody looked.
 * - Pays this player for events that are over (core/clan-events.js payEnded; the game page does the same in the background,
 *   and whichever looks first pays, once).
 * - Shows the event running now with its live progress, the clan's contributors, what is coming up and recent results, and
 *   runs the challenge events (Construction, Clan Race): pick a challenge, finish it in the game, claim its points here.
 * The rules and numbers are in core/clan-events.js and core/clan-levels.js.
 */
const EV = window.WHClanEvents, Levels = window.WHClanLevels;
const JOINED_KEY = 'whathappened_clan_joined';
const BOSS_IMAGE = 'mainimage/WHboss.png';

export function startEventsTab(ctx) {
    const { db, fs: F, notify, esc, fmtShort, fmtLeft, timeAgo, lockedPanel, readSave, changeSave, myClanId, playerName, skeleton } = ctx;
    const $id = (id) => document.getElementById(id);
    const num = (v) => { const n = Number(v); return Number.isFinite(n) ? n : 0; };
    const ref = (name) => F.doc(db, 'events', name);
    async function read(name) { const s = await F.getDoc(ref(name)); return s.exists() ? (s.data() || {}) : null; }
    const st = {
        shown: false, state: null, stateUnsub: null,
        live: null,         // the event shown now: { key, ev, kind, start, doc, meta, pairing, unsub }
        progress: {},       // the latest copy of each <kind>_progress document
        choices: null,      // challenges offered to pick from (con / race)
        ticking: false, lastTick: 0, curKey: null, pruned: false, paidNow: {}, recentAt: 0,
        admin: (() => { try { return sessionStorage.getItem('wh_events_admin_unlocked_v1') === '1'; } catch (e) { return false; } })(),
    };
    const fmtN = (n) => Math.round(num(n)).toLocaleString();
    const rewardText = (r) => [r.gems ? `+${r.gems} gems` : '', r.clanXp ? `${r.clanXp} clan XP` : '', r.clanPoints ? `${r.clanPoints} CP` : ''].filter(Boolean).join(' · ');
    function clock(ms) {
        let s = Math.max(0, Math.floor(ms / 1000));
        const d = Math.floor(s / 86400); s -= d * 86400;
        const h = Math.floor(s / 3600); s -= h * 3600;
        const m = Math.floor(s / 60); s -= m * 60;
        return (d ? d + 'd ' : '') + (d || h ? h + 'h ' : '') + m + 'm ' + s + 's';
    }
    const joinedAt = (clanId) => { try { const j = JSON.parse(localStorage.getItem(JOINED_KEY) || 'null'); return j && j.clanId === clanId ? num(j.at) : 0; } catch (e) { return 0; } };

    // ------------------------------------------------------------ the schedule
    // Move the schedule on to now (core/clan-events.js upkeepTx, in one transaction, so two visitors can't both roll it; the
    // game page runs the same). True when an event ended.
    async function upkeep() {
        let ended = [];
        try { ended = await F.runTransaction(db, (tx) => EV.upkeepTx(tx, ref, Date.now(), F.serverTimestamp())); }
        catch (e) { console.warn('event schedule upkeep failed', e); }
        return Array.isArray(ended) && ended.length > 0;
    }
    // drop event progress older than a month from the shared documents (they would otherwise grow forever)
    async function prune() {
        if (st.pruned) return;
        st.pruned = true;
        const docs = Object.values(EV.KINDS).map((k) => k.doc).concat(['bossfight_meta', 'endless_boss_meta']);
        for (const name of docs) {
            try {
                const keys = EV.staleKeys(await read(name), Date.now());
                if (!keys.length) continue;
                const patch = {};
                keys.forEach((k) => { patch['events.' + k] = F.deleteField(); });
                await F.updateDoc(ref(name), patch);
            } catch (e) {}
        }
    }
    // the pairing for the Clan v Clan / race running now: drawn up by the first visitor; a clan that is missing joins it
    async function ensurePairing(ev, kind) {
        let p = EV.pairingFor(ev, await read('pairings'));
        const clanId = myClanId();
        if (p && (!clanId || EV.clansIn(p).includes(clanId))) return p;
        const clans = await ctx.listClans();
        const mine = clans.find((c) => c.id === clanId);
        const made = p || Object.assign({ eventName: ev.name, eventStart: EV.toMs(ev.start), type: EV.KINDS[kind].type },
            kind === 'cvc' ? EV.pairClans(clans.map(info)) : EV.groupClans(clans.map(info), 4));
        const next = mine ? (EV.addToPairing(made, mine) || made) : made;
        let out = next;
        try {
            await F.runTransaction(db, async (tx) => {
                const s = await tx.get(ref('pairings'));
                const cur = EV.pairingFor(ev, s.exists() ? s.data() : null);
                if (cur && (!mine || EV.clansIn(cur).includes(clanId))) { out = cur; return; }
                const base = cur || next;
                out = mine ? (EV.addToPairing(base, mine) || base) : base;
                tx.set(ref('pairings'), { last: Object.assign({}, out, { updatedAt: F.serverTimestamp() }) });
            });
        } catch (e) { console.warn('saving the pairing failed', e); }
        return out;
    }
    const info = (c) => ({ id: c.id, name: c.name, level: Levels.levelFromXp(c.clanXp), size: Array.isArray(c.members) ? c.members.length : 0 });
    // every clan's strength (click power + 5 x CPS of each member), for a boss's health
    async function totalStrength() {
        let total = 0;
        for (const c of await ctx.listClans()) {
            try { (await F.getDocs(F.collection(db, 'clans', c.id, 'members'))).forEach((d) => { total += EV.memberStrength(d.data()); }); } catch (e) {}
        }
        return total;
    }
    async function ensureMeta(ev, kind) {
        const name = EV.KINDS[kind].meta, key = String(EV.toMs(ev.start));
        const have = await read(name);
        const ok = (m) => m && (kind === 'bf' ? m.totalHp : m.baseHp);
        if (have && have.events && ok(have.events[key])) return have.events[key];
        const strength = await totalStrength();
        let out = kind === 'bf' ? EV.makeBossMeta(strength) : EV.makeEndlessMeta(strength);
        try {
            await F.runTransaction(db, async (tx) => {
                const s = await tx.get(ref(name)), cur = s.exists() && s.data().events ? s.data().events[key] : null;
                if (ok(cur)) { out = cur; return; }
                tx.set(ref(name), { events: { [key]: out } }, { merge: true });
            });
        } catch (e) { console.warn('saving the event meta failed', e); }
        return out;
    }

    // ------------------------------------------------------------ paying
    async function awardClanXp(clanId, key, xp) {
        try {
            const cref = F.doc(db, 'clans', clanId);
            await F.runTransaction(db, async (tx) => {
                const snap = await tx.get(cref);
                if (!snap.exists()) throw new Error('no clan');
                const d = snap.data() || {}, done = d.eventXpAwarded && typeof d.eventXpAwarded === 'object' ? d.eventXpAwarded : {};
                if (done[key]) return;
                tx.update(cref, { clanXp: num(d.clanXp) + xp, eventXpAwarded: EV.withXpAwarded(done, key) });
            });
            return true;
        } catch (e) { console.warn('Clan XP for the event could not be added', e); return false; }
    }
    function withLock(fn) {
        try { if (navigator.locks && typeof navigator.locks.request === 'function') return navigator.locks.request('whathappened-clan-pay', fn); } catch (e) {}
        return fn();
    }
    async function payNow() {
        const clanId = myClanId();
        if (!clanId) return [];
        await ctx.authReady();
        const paid = await EV.payEnded({
            now: () => Date.now(), store: localStorage, clanId, username: playerName(), joinedAt: joinedAt(clanId),
            read, readClan: async () => { const s = await F.getDoc(F.doc(db, 'clans', clanId)); return s.exists() ? s.data() : null; },
            levelOf: (c) => Levels.levelFromXp(c && c.clanXp), eventGems: Levels.eventGems,
            credit: async (r) => !!changeSave((s) => { s.diamonds = num(s.diamonds) + num(r.gems); s.clanPoints = num(s.clanPoints) + num(r.clanPoints); }),
            awardClanXp: (key, xp) => awardClanXp(clanId, key, xp),
            lock: withLock,
        });
        paid.forEach((p, i) => {
            st.paidNow[p.kind + '_' + p.record.start] = p.reward;
            setTimeout(() => notify(`🏆 ${EV.KINDS[p.kind].name} is over! ${p.reward.text}\nYou got ${rewardText(p.reward)}.`
                + (p.reward.bonusGems ? `\n(Top contributor bonus: +${p.reward.bonusGems} gems, +${p.reward.bonusCP} CP)` : '')
                + (p.xpOk ? '' : '\n(Your clan\'s XP couldn\'t be added just now: it will be tried again.)'), 'gold'), i * 900);
        });
        if (paid.length) { st.recentAt = 0; renderRecent(); }
        return paid;
    }
    async function tick() {
        if (st.ticking) return;
        st.ticking = true;
        st.lastTick = Date.now();
        try {
            await upkeep();
            await payNow();
            prune();
        } catch (e) { console.warn('events tick failed', e); }
        finally { st.ticking = false; }
    }

    // ------------------------------------------------------------ the tab
    const tiles = (list) => `<div class="ev-tiers">${list.map((t) => `<div class="ev-tier${t.done ? ' done' : t.next ? ' next' : ''}"><b>${t.done ? '✓ ' : ''}${esc(t.label)}</b><span>${esc(t.reward)}</span></div>`).join('')}</div>`;
    const meter = (pct, cls, marks, label) => `<div class="meter ${cls || ''}" role="progressbar" aria-label="${esc(label || 'Progress')}" aria-valuemin="0" aria-valuemax="100" aria-valuenow="${Math.round(pct)}"><i style="width:${Math.max(0, Math.min(100, pct))}%"></i>${(marks || []).map((m) => `<span class="mark" style="left:${m}%"></span>`).join('')}</div>`;
    function hero(cur, upcoming, now) {
        const kind = EV.kindOf(cur);
        if (kind) {
            const K = EV.KINDS[kind];
            return `<section class="card ev-hero ev-${kind}">
              <div class="ev-hero-row">
                <div class="ev-badge" aria-hidden="true">${K.icon}</div>
                <div class="ev-hero-text"><div class="ev-kicker">Clan event · running now</div><h2>${esc(K.name)}</h2><p class="muted">${esc(K.how)}</p></div>
                <div class="ev-clock"><span>Ends in</span><b data-until="${EV.toMs(cur.end)}">${clock(EV.toMs(cur.end) - now)}</b></div>
              </div>
              <div id="evLive" class="ev-live">${skeleton('rows', 3)}</div>
            </section>`;
        }
        const next = EV.nextEvent(upcoming, now), nk = EV.kindOf(next);
        return `<section class="card ev-hero ev-rest">
          <div class="ev-hero-row">
            <div class="ev-badge" aria-hidden="true">😴</div>
            <div class="ev-hero-text"><div class="ev-kicker">Between events</div><h2>${next ? 'Next up: ' + esc(EV.displayName(next)) : 'No event scheduled'}</h2>
              <p class="muted">${nk ? esc(EV.KINDS[nk].how) : 'Events run for 3 days with 2 days of rest in between. Check in daily and fill clan buffs meanwhile.'}</p></div>
            ${next ? `<div class="ev-clock"><span>Starts in</span><b data-until="${EV.toMs(next.start)}">${clock(EV.toMs(next.start) - now)}</b></div>` : ''}
          </div>
          ${nk ? `<div class="ev-live">${rewardsPreview(nk)}</div>` : ''}
        </section>`;
    }
    function rewardsPreview(kind) {
        const R = EV.REWARDS, line = (t) => rewardText(t);
        let list = [];
        if (kind === 'pp') list = R.pp.map((t) => ({ label: t.at + ' prestiges', reward: line(t) }));
        else if (kind === 'bf') list = R.bfPhase.map((t) => ({ label: 'Phase ' + t.at, reward: line(t) }));
        else if (kind === 'eb') list = R.eb.map((t) => ({ label: t.at + ' boss' + (t.at === 1 ? '' : 'es'), reward: line(t) }));
        else if (kind === 'con') list = R.con.map((t) => ({ label: t.at + ' points', reward: line(t) }));
        else if (kind === 'cvc') list = [{ label: 'Win', reward: line(R.cvc.win) }, { label: 'Lose', reward: line(R.cvc.lose) }, { label: 'Draw', reward: line(R.cvc.draw) }];
        else if (kind === 'race') list = R.race.map((t) => ({ label: EV.ordinal(t.place) + ' place', reward: line(t) }));
        else if (kind === 'wh') list = R.wh.map((t) => ({ label: fmtN(t.at) + ' monsters', reward: line(t) }));
        return `<div class="ev-sub">Rewards</div>${tiles(list)}`;
    }
    function comingUp(upcoming, now, cur) {
        const list = upcoming.filter((it) => it !== cur && EV.toMs(it.start) > now).slice(0, 4);
        if (!list.length) return '';
        return `<section class="card"><h2>Coming up</h2><div class="ev-list">${list.map((it) => {
            const k = EV.kindOf(it);
            return `<div class="ev-row"><span class="ev-row-icon" aria-hidden="true">${k ? EV.KINDS[k].icon : '😴'}</span><b>${esc(EV.displayName(it))}</b><span class="muted">starts in <span data-until="${EV.toMs(it.start)}">${clock(EV.toMs(it.start) - now)}</span> · ${it.isDowntime ? '2 days' : '3 days'}</span></div>`;
        }).join('')}</div></section>`;
    }
    async function render() {
        const area = $id('tabEvents');
        if (!st.shown || !area) return;
        if (!myClanId()) { stopLive(); area.innerHTML = lockedPanel('🏆', 'Join a clan to take part in events', 'Events run all week: boss fights, races, construction and more. They pay out Gems, Clan XP and Clan Points.'); return; }
        if (!st.state) { area.innerHTML = '<div class="card">' + skeleton('panel', 5) + '</div>'; return; }
        const now = Date.now(), upcoming = Array.isArray(st.state.upcoming) ? st.state.upcoming : [];
        const cur = EV.current(upcoming, now);
        st.curKey = cur ? EV.toMs(cur.start) : 0;
        // the same event (start and kind) for the same clan: keep its listener
        const keep = st.live && cur && st.live.key === EV.toMs(cur.start) + ':' + EV.kindOf(cur) + ':' + myClanId();
        area.innerHTML = hero(cur, upcoming, now)
            + (EV.kindOf(cur) ? '<section class="card" id="evPeople"></section>' : '')
            + comingUp(upcoming, now, cur)
            + '<section class="card" id="evRecent"><h2>Recent events</h2>' + skeleton('rows', 3) + '</section>'
            + (st.admin ? adminCard(upcoming, now) : '');
        if (EV.kindOf(cur)) { if (keep) renderLive(); else startLive(cur); } else stopLive();
        st.recentAt = 0;
        renderRecent();
    }

    // ---- the event running now ----
    function stopLive() { try { if (st.live && st.live.unsub) st.live.unsub(); } catch (e) {} st.live = null; st.choices = null; }
    async function startLive(ev) {
        stopLive();
        const kind = EV.kindOf(ev), clanId = myClanId();
        const live = { key: EV.toMs(ev.start) + ':' + kind + ':' + clanId, ev, kind, start: EV.toMs(ev.start), doc: EV.KINDS[kind].doc, meta: null, pairing: null, unsub: null };
        st.live = live;
        live.unsub = F.onSnapshot(ref(live.doc), (snap) => { st.progress[live.doc] = snap.exists() ? (snap.data() || {}) : {}; if (st.live === live) renderLive(); },
            (err) => console.warn('event progress listener failed', err));
        try {
            if (kind === 'bf' || kind === 'eb') live.meta = await ensureMeta(ev, kind);
            if (kind === 'cvc' || kind === 'race') live.pairing = await ensurePairing(ev, kind);
        } catch (e) { console.warn('preparing the event failed', e); }
        if (st.live === live) renderLive();
    }
    function renderLive() {
        const live = st.live, box = $id('evLive');
        if (!live || !box) return;
        const prog = st.progress[live.doc];
        if (!prog) return;
        const clanId = myClanId(), me = playerName(), block = EV.blockOf(prog, live.start, clanId);
        let html = '';
        if (live.kind === 'bf') html = bossBody(live, block);
        else if (live.kind === 'eb') html = endlessBody(live, block);
        else if (live.kind === 'pp') html = partyBody(block);
        else if (live.kind === 'cvc') html = versusBody(live, prog, clanId);
        else if (live.kind === 'con') html = buildBody(block) + challengeCard(live, block, me);
        else if (live.kind === 'race') html = raceBody(live, prog, clanId) + challengeCard(live, block, me);
        else if (live.kind === 'wh') html = huntBody(block, me);
        box.innerHTML = html;
        renderPeople(live, block, prog, me);
    }
    function bossBody(live, block) {
        const m = live.meta;
        if (!m || !m.totalHp) return `<p class="muted">Setting up the boss…</p>`;
        const dmg = block.total, left = Math.max(0, m.totalHp - dmg), phase = EV.phaseOf(dmg, m.phaseHps);
        const twist = EV.currentGimmick(m, dmg);
        const tiers = EV.REWARDS.bfPhase.map((t, i) => ({ label: `Phase ${t.at}${m.gimmicks && m.gimmicks[i] ? ' · ' + (EV.gimmick(m.gimmicks[i]) || {}).name : ''}`, reward: rewardText(t), done: phase >= t.at, next: phase + 1 === t.at }));
        return `<div class="boss">
            <img class="boss-img" src="${BOSS_IMAGE}" alt="" onerror="this.hidden=true">
            <div class="boss-info">
              <div class="ev-stat-row"><b>Boss health</b><span>${fmtShort(left)} / ${fmtShort(m.totalHp)}</span></div>
              ${meter(left / m.totalHp * 100, 'boss-hp', [25, 50, 75], 'Boss health')}
              <div class="ev-stat-row muted small"><span>Your clan has dealt ${fmtShort(dmg)} damage</span><span>${phase >= 4 ? 'Boss defeated!' : 'Phase ' + (phase + 1) + ' of 4'}</span></div>
              ${twist && phase < 4 ? `<div class="twist"><b>Phase twist: ${esc(twist.name)}</b><span>${esc(twist.desc)}</span></div>` : ''}
            </div>
          </div>
          <div class="ev-sub">Rewards (by the phase your clan reaches; the top 3 damage dealers get a bonus)</div>${tiles(tiers)}`;
    }
    function endlessBody(live, block) {
        const e = EV.endless(block.total, live.meta && live.meta.baseHp);
        const tiers = EV.REWARDS.eb.map((t) => ({ label: t.at + ' boss' + (t.at === 1 ? '' : 'es'), reward: rewardText(t), done: e.defeated >= t.at }));
        const nxt = tiers.find((t) => !t.done); if (nxt) nxt.next = true;
        return `<div class="boss">
            <img class="boss-img endless" src="${BOSS_IMAGE}" alt="" onerror="this.hidden=true">
            <div class="boss-info">
              <div class="ev-big"><b>${e.defeated}</b><span>boss${e.defeated === 1 ? '' : 'es'} beaten</span></div>
              <div class="ev-stat-row"><b>Boss ${e.defeated + 1}</b><span>${fmtShort(e.remainingHp)} / ${fmtShort(e.currentHp)}</span></div>
              ${meter(e.remainingHp / e.currentHp * 100, 'boss-hp', null, 'Boss health')}
              <div class="muted small">Each boss has ${Math.round((EV.ENDLESS_SCALE - 1) * 100)}% more health than the one before.</div>
            </div>
          </div>
          <div class="ev-sub">Rewards (by bosses beaten)</div>${tiles(tiers)}`;
    }
    function partyBody(block) {
        const total = block.total, goal = EV.PP_GOAL;
        const tiers = EV.REWARDS.pp.map((t) => ({ label: t.at + ' prestiges', reward: rewardText(t), done: total >= t.at }));
        const nxt = tiers.find((t) => !t.done); if (nxt) nxt.next = true;
        return `<div class="ev-big"><b>${fmtN(total)}</b><span>prestige${total === 1 ? '' : 's'} by your clan</span></div>
          ${meter(total / goal * 100, 'party', EV.REWARDS.pp.map((t) => t.at / goal * 100), 'Clan prestiges')}
          <div class="ev-sub">Rewards (every tier reached pays; the top 3 get a bonus)</div>${tiles(tiers)}`;
    }
    function buildBody(block) {
        const total = block.total, top = EV.REWARDS.con[EV.REWARDS.con.length - 1].at;
        const tiers = EV.REWARDS.con.map((t) => ({ label: t.at + ' points', reward: rewardText(t), done: total >= t.at }));
        const nxt = tiers.find((t) => !t.done); if (nxt) nxt.next = true;
        return `<div class="ev-big"><b>${fmtN(total)}</b><span>points built by your clan</span></div>
          ${meter(total / top * 100, 'build', EV.REWARDS.con.map((t) => t.at / top * 100), 'Construction points')}
          <div class="ev-sub">Rewards (the highest tier reached)</div>${tiles(tiers)}`;
    }
    function huntBody(block, me) {
        const total = block.total, top = EV.REWARDS.wh[EV.REWARDS.wh.length - 1].at, mine = num(block.members[me]);
        const tiers = EV.REWARDS.wh.map((t) => ({ label: fmtN(t.at) + ' monsters', reward: rewardText(t), done: total >= t.at }));
        const nxt = tiers.find((t) => !t.done); if (nxt) nxt.next = true;
        return `<div class="ev-big"><b>${fmtN(total)}</b><span>monster${total === 1 ? '' : 's'} defeated in the Wilds by your clan</span></div>
          ${meter(total / top * 100, 'hunt', EV.REWARDS.wh.map((t) => t.at / top * 100), 'Monsters defeated')}
          <div class="ev-stat-row"><span class="muted small">${mine ? 'You have added ' + fmtN(mine) + '.' : 'Only monsters defeated while the hunt runs count.'}</span>
            <a class="btn btn-gold btn-sm" href="world.html">🌲 Go to the Wilds</a></div>
          <div class="ev-sub">Rewards (the highest tier reached; the top 3 hunters get a bonus)</div>${tiles(tiers)}`;
    }
    function versusBody(live, prog, clanId) {
        const p = live.pairing;
        if (!p) return '<p class="muted">Drawing up the matchups…</p>';
        const pair = EV.pairsOf(p).find((x) => String(x[0].id) === clanId || String(x[1].id) === clanId);
        if (!pair) return '<p class="muted">Your clan isn\'t in this round\'s matchups.</p>';
        const mine = String(pair[0].id) === clanId ? pair[0] : pair[1], opp = mine === pair[0] ? pair[1] : pair[0];
        const totals = EV.totalsOf(prog, live.start), a = num(totals[clanId]), b = EV.isBot(opp) ? 0 : num(totals[String(opp.id)]);
        const pct = a + b > 0 ? a / (a + b) * 100 : 50;
        const lead = a > b ? 'Your clan is ahead' : a < b ? esc(opp.name) + ' is ahead' : 'Neck and neck';
        const R = EV.REWARDS.cvc;
        return `<div class="versus">
            <div class="vs-side mine"><span>Your clan</span><b>${esc(mine.name)}</b><em>${fmtN(a)} clicks</em></div>
            <div class="vs-mid">VS</div>
            <div class="vs-side theirs"><span>${EV.isBot(opp) ? 'No clan to meet: a bot stands in' : 'Opponent'}</span><b>${esc(opp.name)}</b><em>${fmtN(b)} clicks</em></div>
          </div>
          <div class="tug" role="img" aria-label="${esc(lead)}"><i style="width:${pct}%"></i></div>
          <div class="ev-stat-row muted small"><span>${lead}</span><span>Every click in the game counts while the event runs.</span></div>
          <div class="ev-sub">Rewards</div>${tiles([{ label: 'Win', reward: rewardText(R.win), next: a > b }, { label: 'Lose', reward: rewardText(R.lose) }, { label: 'Draw', reward: rewardText(R.draw) }])}`;
    }
    function raceBody(live, prog, clanId) {
        const p = live.pairing;
        if (!p) return '<p class="muted">Drawing up the race groups…</p>';
        const group = EV.groupsOf(p).find((g) => g.some((c) => String(c.id) === clanId));
        if (!group) return '<p class="muted">Your clan isn\'t in this race.</p>';
        const totals = EV.totalsOf(prog, live.start), goal = EV.RACE_GOAL;
        const lanes = group.map((c) => ({ c, t: EV.isBot(c) ? 0 : num(totals[String(c.id)]) })).sort((x, y) => y.t - x.t);
        const lanesHtml = lanes.map((l, i) => {
            const you = String(l.c.id) === clanId;
            return `<div class="lane${you ? ' you' : ''}${EV.isBot(l.c) ? ' bot' : ''}"><div class="ev-stat-row"><span>${['🥇', '🥈', '🥉'][i] || '▸'} <b>${esc(l.c.name)}</b>${you ? ' (you)' : ''}</span><span>${fmtN(l.t)} / ${goal}${l.t >= goal ? ' 🏁' : ''}</span></div>${meter(l.t / goal * 100, you ? 'lane-you' : 'lane', null, l.c.name)}</div>`;
        }).join('');
        return `<div class="ev-sub">Your race group (places at the end decide the rewards)</div><div class="lanes">${lanesHtml}</div>
          <div class="ev-sub">Rewards</div>${tiles(EV.REWARDS.race.map((t) => ({ label: EV.ordinal(t.place) + ' place', reward: rewardText(t) })))}`;
    }
    function challengeCard(live, block, me) {
        const mine = block.members[me] && typeof block.members[me] === 'object' ? block.members[me] : {};
        const ch = mine.currentChallenge, stats = EV.statsFrom(readSave(), localStorage);
        const done = num(mine.completedCount);
        if (ch && ch.target != null) {
            const pr = EV.challengeProgress(ch, stats), pts = EV.challengePoints(ch);
            return `<div class="challenge">
                <div class="ev-stat-row"><b>Your challenge: ${esc(ch.name || '')}</b><span class="tag">${pts} pts</span></div>
                <p>${esc(ch.desc || '')}</p>
                ${meter(pr.progress / pr.target * 100, 'challenge-bar', null, 'Challenge progress')}
                <div class="ev-stat-row"><span class="muted small">${fmtN(pr.progress)} / ${fmtN(pr.target)}${pr.done ? '' : ' · progress comes from your saved game, so it can lag the game by a few seconds'}</span>
                <button type="button" class="btn ${pr.done ? 'btn-gold' : 'btn-ghost'} btn-sm" data-ev="claim"${pr.done ? '' : ' disabled'}>${pr.done ? 'Claim ' + pts + ' points' : 'Not done yet'}</button></div>
              </div>`;
        }
        const choices = st.choices && st.choices.key === live.key ? st.choices.list : null;
        return `<div class="challenge">
            <div class="ev-stat-row"><b>Challenges</b><span class="muted small">${done ? `You finished ${done} · ${fmtN(mine.points)} points` : 'Each finished challenge adds its points to your clan'}</span></div>
            ${choices ? `<p class="muted">Choose one (no rerolls):</p><div class="ch-choices">${choices.map((c, i) => `<div class="ch-choice"><div><b>${esc(c.name)}</b><span>${esc(c.desc)}</span></div><button type="button" class="btn btn-primary btn-sm" data-ev="choose" data-i="${i}">${c.points} pts · Choose</button></div>`).join('')}</div>`
                : '<button type="button" class="btn btn-gold" data-ev="pick">Pick a challenge</button>'}
          </div>`;
    }
    function renderPeople(live, block, prog, me) {
        const box = $id('evPeople');
        if (!box) return;
        const K = EV.KINDS[live.kind], rank = EV.ranking(block.members), myPos = rank.findIndex((e) => e[0] === me);
        const bonus = EV.TOP3[live.kind];
        const row = (e, i) => `<div class="ev-person${e[0] === me ? ' you' : ''}"><span class="pos">${['🥇', '🥈', '🥉'][i] || i + 1}</span><b>${esc(e[0])}</b>${e[0] === me ? '<span class="muted small">(you)</span>' : ''}<span class="amt">${fmtShort(e[1])} ${esc(K.unit)}</span></div>`;
        let html = `<div class="sec-head"><h2>Your clan's contributors</h2>${bonus ? `<span class="muted small">Top 3 bonus: ${bonus.map((b, i) => EV.ordinal(i + 1) + ' +' + b.gems + ' gems').join(' · ')}</span>` : ''}</div>`;
        html += rank.length ? `<div class="ev-people">${rank.slice(0, 10).map(row).join('')}${myPos >= 10 ? row(rank[myPos], myPos) : ''}</div>`
            : `<p class="muted">Nobody has added anything yet. ${live.kind === 'con' || live.kind === 'race' ? 'Pick a challenge above to start.' : live.kind === 'wh' ? 'Head into the Wilds to start.' : 'Play the game to start.'}</p>`;
        if (myPos < 0 && rank.length) html += `<p class="muted small">You haven't added anything yet.</p>`;
        box.innerHTML = html;
    }

    // ---- challenges (Construction and the Clan Race) ----
    async function onEventsClick(e) {
        const btn = e.target.closest('[data-ev]');
        if (!btn || !st.live) return;
        const live = st.live, act = btn.dataset.ev, clanId = myClanId(), me = playerName();
        if (!clanId || !me) { notify('Pick a username and join a clan first.', 'bad'); return; }
        if (act === 'pick') { st.choices = { key: live.key, list: EV.pickChallenges(EV.statsFrom(readSave(), localStorage)) }; renderLive(); return; }
        btn.disabled = true;
        const key = String(live.start), dref = ref(live.doc);
        try {
            if (act === 'choose') {
                const ch = st.choices && st.choices.list[Number(btn.dataset.i)];
                if (!ch) return;
                await F.runTransaction(db, async (tx) => {
                    const s = await tx.get(dref), mine = EV.blockOf(s.exists() ? s.data() : null, key, clanId).members[me];
                    if (mine && mine.currentChallenge) throw new Error('you already have a challenge');
                    tx.set(dref, { events: { [key]: { [clanId]: { members: { [me]: { currentChallenge: ch } } } } } }, { merge: true });
                });
                st.choices = null;
                notify(`Challenge picked: ${ch.name}. Play the game to finish it, then claim its points here.`, 'good');
            } else if (act === 'claim') {
                const stats = EV.statsFrom(readSave(), localStorage);
                let pts = 0;
                await F.runTransaction(db, async (tx) => {
                    const s = await tx.get(dref), mine = EV.blockOf(s.exists() ? s.data() : null, key, clanId).members[me];
                    const ch = mine && mine.currentChallenge;
                    if (!ch) throw new Error('no challenge to claim');
                    if (!EV.challengeProgress(ch, stats).done) throw new Error('not finished yet');
                    pts = EV.challengePoints(ch);
                    tx.set(dref, { events: { [key]: { [clanId]: { total: F.increment(pts), members: { [me]: { points: F.increment(pts), completedCount: F.increment(1), currentChallenge: null } } } } } }, { merge: true });
                });
                notify(`+${pts} points for your clan! Pick another challenge to keep going.`, 'good');
            }
        } catch (err) { notify('That didn\'t work: ' + (err.message || 'try again'), 'bad'); btn.disabled = false; }
    }
    // the challenge's progress comes from the saved game: look again every 15 s while the tab is open
    setInterval(() => { if (st.shown && st.live && (st.live.kind === 'con' || st.live.kind === 'race') && !document.hidden) renderLive(); }, 15000);

    // ---- recent events ----
    async function renderRecent() {
        const box = $id('evRecent'), clanId = myClanId();
        if (!box || !clanId) return;
        if (Date.now() - st.recentAt < 30000) return;
        st.recentAt = Date.now();
        let hist = [];
        try { hist = EV.history(await read('last_ended_event')).slice(-5).reverse(); } catch (e) {}
        if (!hist.length) { box.innerHTML = '<h2>Recent events</h2><p class="muted">No events have finished yet.</p>'; return; }
        const docs = {}, readOnce = (n) => (n in docs ? docs[n] : (docs[n] = read(n).catch(() => null)));
        const joined = joinedAt(clanId), now = Date.now();
        const rows = await Promise.all(hist.map(async (rec) => {
            const kind = EV.kindOf(rec), K = EV.KINDS[kind], claim = EV.claimState(localStorage, kind, rec.start);
            let r = st.paidNow[kind + '_' + rec.start] || null;
            if (!r) {
                try {
                    const meta = K.meta ? ((await readOnce(K.meta)) || {}).events : null;
                    r = EV.rewardFor(kind, rec, { clanId, username: playerName(), progress: await readOnce(K.doc), meta: meta ? meta[String(rec.start)] : null,
                        pairing: kind === 'cvc' || kind === 'race' ? EV.pairingFor(rec, await readOnce('pairings')) : null, clanLevel: Levels.levelFromXp((ctx.clanDoc() || {}).clanXp), eventGems: Levels.eventGems });
                } catch (e) { r = null; }
            }
            const status = joined && joined > rec.end ? '<span class="tag">Before you joined</span>'
                : claim.paid ? (localStorage.getItem(EV.claimKey(kind, rec.start)) === '0' ? '<span class="tag">Nothing earned</span>' : '<span class="tag good">✓ Collected</span>')
                : now - rec.end > EV.PAY_WINDOW_MS ? '<span class="tag">Expired</span>'
                : r ? '<span class="tag gold">Collecting…</span>' : '<span class="tag">Nothing earned</span>';
            return `<div class="ev-row"><span class="ev-row-icon" aria-hidden="true">${K.icon}</span><div class="ev-row-main"><b>${esc(K.name)}</b><span class="muted small">ended ${timeAgo(rec.end)}</span>
              ${r ? `<span class="small">${esc(r.text)}</span>${!(joined && joined > rec.end) ? `<span class="small ev-reward">${esc(rewardText(r))}</span>` : ''}` : ''}</div>${status}</div>`;
        }));
        box.innerHTML = '<div class="sec-head"><h2>Recent events</h2><span class="muted small">Rewards arrive by themselves within a few minutes of an event ending, in the game or here.</span></div><div class="ev-list">' + rows.join('') + '</div>';
    }

    // ---- admin (Ctrl+Alt+G with the password) ----
    function adminCard(upcoming, now) {
        return `<section class="card ev-admin"><div class="sec-head"><h2>🛠️ Events admin</h2><span class="muted small">Only on this browser, this session</span></div>
          <div class="ev-list">${upcoming.slice(0, 8).map((it, i) => `<div class="ev-row"><span class="ev-row-icon">${i}</span><div class="ev-row-main"><b>${esc(it.isDowntime ? 'Downtime' : it.name)}</b><span class="muted small">${new Date(EV.toMs(it.start)).toLocaleString()} → ${new Date(EV.toMs(it.end)).toLocaleString()}</span></div>${EV.toMs(it.start) <= now && EV.toMs(it.end) > now ? '<span class="tag good">now</span>' : ''}</div>`).join('')}</div>
          <div class="row-gap" style="margin-top:10px"><button type="button" class="btn btn-sm" data-admin="skip">End this slot, start the next</button><button type="button" class="btn btn-sm" data-admin="pick">Start a chosen slot now…</button><button type="button" class="btn btn-sm btn-danger" data-admin="regen">New schedule from now</button></div></section>`;
    }
    async function adminStart(index, fresh) {
        const now = Date.now();
        try {
            await F.runTransaction(db, async (tx) => {
                const s = await tx.get(ref('state')), c = await tx.get(ref('config')), e = await tx.get(ref('last_ended_event')), p = await tx.get(ref('pairings'));
                const types = EV.typesFrom(c.exists() ? (c.data() || {}) : {}).types;
                const upcoming = s.exists() ? (s.data() || {}).upcoming || [] : [];
                const r = fresh ? { upcoming: EV.rollSchedule([], now, types).upcoming, ended: EV.skipSchedule(upcoming, now, 0, types).ended } : EV.skipSchedule(upcoming, now, index, types);
                const ended = r.ended.map((ev) => EV.attachResult(ev, p.exists() ? p.data() : null));
                tx.set(ref('state'), { upcoming: r.upcoming, updatedAt: F.serverTimestamp() });
                if (ended.length) tx.set(ref('last_ended_event'), EV.withEnded(e.exists() ? e.data() : null, ended, now));
            });
            notify('Schedule changed. Rewards for the event that ended can be collected in about 2 minutes.', 'good');
            setTimeout(() => tick(), EV.SETTLE_MS + 5000);
        } catch (e) { notify('Changing the schedule failed: ' + (e.message || e), 'bad'); }
    }
    function onAdminClick(e) {
        const b = e.target.closest('[data-admin]');
        if (!b || !st.admin) return;
        const upcoming = (st.state && st.state.upcoming) || [];
        if (b.dataset.admin === 'skip') { if (confirm('End the slot running now for everyone and start the next one?')) adminStart(-1); }
        else if (b.dataset.admin === 'regen') { if (confirm('Throw away the schedule and start a new one from now?')) adminStart(0, true); }
        else if (b.dataset.admin === 'pick') {
            const sel = prompt('Which slot should start now? Type its number:\n' + upcoming.slice(0, 8).map((it, i) => `${i}: ${it.isDowntime ? 'Downtime' : it.name}`).join('\n'), '1');
            const i = parseInt(sel, 10);
            if (sel !== null && i >= 0 && i < upcoming.length) adminStart(i);
        }
    }
    window.addEventListener('keydown', (ev) => {
        if (!(ev.ctrlKey && ev.altKey && String(ev.key || '').toLowerCase() === 'g')) return;
        if (st.admin) { st.admin = false; try { sessionStorage.setItem('wh_events_admin_unlocked_v1', '0'); } catch (e) {} render(); return; }
        const attempt = prompt('Enter admin password to show the Events admin tools:', '');
        if (attempt === null) return;
        st.admin = attempt === 'V7k9R2xB4qZ1';
        try { sessionStorage.setItem('wh_events_admin_unlocked_v1', st.admin ? '1' : '0'); } catch (e) {}
        notify(st.admin ? 'Events admin tools on (Ctrl+Alt+G again turns them off).' : 'Incorrect password.', st.admin ? 'good' : 'bad');
        render();
    });

    // ------------------------------------------------------------ running
    const area = $id('tabEvents');
    if (area) { area.addEventListener('click', onEventsClick); area.addEventListener('click', onAdminClick); }
    // the countdowns tick every second
    setInterval(() => {
        const now = Date.now();
        document.querySelectorAll('#tabEvents [data-until]').forEach((el) => { el.textContent = clock(num(el.dataset.until) - now); });
        // the slot running now (an event, or the rest between) just ended: roll on, pay, show the next
        if (!st.state) return;
        const cur = EV.current(st.state.upcoming, now), key = cur ? EV.toMs(cur.start) : 0;
        if (key !== st.curKey && !st.ticking && now - st.lastTick > 15000) { st.curKey = key; tick().then(render); }
    }, 1000);
    setInterval(() => { if (!document.hidden) tick(); }, 5 * 60 * 1000);
    (async () => {
        await ctx.authReady();
        st.stateUnsub = F.onSnapshot(ref('state'), (snap) => {
            st.state = snap.exists() ? (snap.data() || {}) : { upcoming: [] };
            const cur = EV.current(st.state.upcoming, Date.now());
            st.curKey = cur ? EV.toMs(cur.start) : 0; // the once-a-second check only acts when this changes
            if (!snap.exists() || !cur) tick();
            render();
        }, (err) => console.warn('event state listener failed', err));
        await tick();
    })();

    return {
        show() { st.shown = true; render(); },
        // the player joined, left or changed clan
        refresh() { stopLive(); st.paidNow = {}; st.recentAt = 0; render(); payNow().catch(() => {}); },
        tick, payNow, _state: st,
    };
}
