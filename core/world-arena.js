/**
 * The Arena (The Wilds): the rules of duels, team battles (2v2, 3v3) and the Pit, with no server. Every page in a match
 * runs its own copy of the match (newMatch / reduce) from the same inputs: the invitation (the roster, everyone's rating at
 * that moment, the stake, the start time) and each player's own signed reports that they were knocked out ('down') or left
 * ('quit'). Nobody can report anyone else down, so a cheater can only lie about themselves: never going down makes a round
 * time out, and a match that never ends counts as a draw (stakes back), never as a loss for the honest side.
 * Also: who may hit whom in the arena zone, Elo ratings and ranks, Glory (the arena's currency) under daily caps, wagers,
 * the queue's matchmaker, the message format and the leaderboard's records. Pure: callers pass `now` (ms, server time).
 *
 * Works in a browser (<script src="core/world-arena.js"> sets window.WHWorldArena, after world-data.js) and in Node.
 */
(function (root, factory) {
    if (typeof module === 'object' && module.exports) module.exports = factory(require('./world-data'));
    else root.WHWorldArena = factory(root.WHWorldData);
}(typeof self !== 'undefined' ? self : this, function (D) {
    'use strict';

    const MODES = { duel: { size: 1, name: 'Duel' }, t2: { size: 2, name: '2v2' }, t3: { size: 3, name: '3v3' } };
    const RULES = {
        winsNeeded: 2,          // best of three
        maxRounds: 5,           // drawn rounds don't count; after this many, the score decides (level: a draw)
        roundSec: 90, countdownSec: 3, breakSec: 4, graceSec: 1.5,
        staleDownSec: 8,        // a participant not heard from this long is down for the round
        forfeitSec: 25,         // ...and this long (or leaving the arena) has forfeited the match
        inviteSec: 20, readySec: 6,
        pitRespawnSec: 3,
        stakes: [0, 100, 250, 500, 1000, 2500, 5000],
        elo: { k: 32, start: 1000, min: 100, max: 4000 },
        repeatLimit: 3,         // matches with the same opponents in a day that still count
        rubyWins: 5, rubyWin: 150, // the first wins of a day also pay rubies (x the furthest zone's tier)
    };
    // Glory: earned in the arena and the Proving Grounds, each source with its own daily cap
    const GLORY = { win: 30, loss: 8, roundWin: 4, pitKO: 5, wave: 2, cap: { match: 300, pit: 100, waves: 200 } };
    const RANKS = [
        { id: 'bronze', name: 'Bronze', min: 0, color: '#cd8a4f' },
        { id: 'silver', name: 'Silver', min: 1100, color: '#c9d1dc' },
        { id: 'gold', name: 'Gold', min: 1250, color: '#ffc83d' },
        { id: 'platinum', name: 'Platinum', min: 1400, color: '#7fe3d6' },
        { id: 'diamond', name: 'Diamond', min: 1550, color: '#5ee7ff' },
        { id: 'champion', name: 'Champion', min: 1700, color: '#ff5bd0' },
    ];
    // the Arena Master's shop, paid in Glory. title: shown under your name to other players. coffer: once a week, a
    // lootbox for the game, counted in the week's lootbox allowance like a crafted one (so the caps still hold).
    const SHOP = [
        { id: 'potion_big', name: '2 Big Potions', glory: 60, give: { potion_big: 2 } },
        { id: 'potion_max', name: 'Max Potion', glory: 90, give: { potion_max: 1 } },
        { id: 'arrows', name: '40 Arrows', glory: 40, give: { arrow: 40 } },
        { id: 'title_brawler', name: 'Title: Brawler', glory: 100, title: 'Brawler' },
        { id: 'title_gladiator', name: 'Title: Gladiator', glory: 400, title: 'Gladiator' },
        { id: 'title_warlord', name: 'Title: Warlord', glory: 1200, title: 'Warlord' },
        { id: 'title_legend', name: 'Title: Legend of the Sand', glory: 3000, title: 'Legend of the Sand' },
        { id: 'coffer', name: "Champion's Coffer (a Golden Chest for your game)", glory: 500, coffer: 2, weekly: true },
    ];
    const SHOP_BY_ID = Object.fromEntries(SHOP.map(x => [x.id, x]));
    const UID_RE = /^[A-Za-z0-9_-]{4,64}$/;
    const NAME_RE = /^[A-Za-z0-9 _.\-]{1,16}$/;
    const MID_RE = /^[A-Za-z0-9]{4,24}$/;
    const int = (v, lo, hi) => Math.max(lo, Math.min(hi, Math.round(Number(v) || 0)));
    const isObj = (v) => !!v && typeof v === 'object' && !Array.isArray(v);

    // ---------------- who may hit whom ----------------
    function inCircle(p, c) { return !!(p && c) && Math.hypot(p.x - c.x, p.y - c.y) <= c.r; }
    // In the arena zone a hit counts only between opposing players of a live match round, or between two players both
    // standing in the Pit (neither of them in a match). ctx: { map, match (mine or null), me: { uid, x, y },
    // them: { uid, x, y, inMatch } }. The same check runs on the attacker's page (before swinging) and the victim's.
    function hitAllowed(ctx) {
        const m = ctx.match && !ctx.match.result ? ctx.match : null;
        if (m) {
            const a = teamOf(m, ctx.me.uid), b = teamOf(m, ctx.them.uid);
            return !!a && !!b && a !== b && m.state === 'live' && !m.down[ctx.them.uid] && !m.gone[ctx.them.uid];
        }
        if (ctx.them.inMatch) return false;
        const pit = ctx.map && ctx.map.pit;
        return inCircle(ctx.me, pit) && inCircle(ctx.them, pit);
    }

    // ---------------- ratings ----------------
    function clampRating(r) { return int(r, RULES.elo.min, RULES.elo.max); }
    function expected(ra, rb) { return 1 / (1 + Math.pow(10, (rb - ra) / 400)); }
    // a rating change: score 1 for a win, 0.5 a draw, 0 a loss
    function elo(ra, rb, score, k = RULES.elo.k) { return Math.round(k * (score - expected(ra, rb))); }
    function teamRating(list) { return list.length ? list.reduce((a, p) => a + clampRating(p.r), 0) / list.length : RULES.elo.start; }
    function rankFor(r) { let out = RANKS[0]; for (const x of RANKS) if (r >= x.min) out = x; return out; }

    // ---------------- matches ----------------
    function teamOf(m, uid) { return m.teams.a.some(p => p.u === uid) ? 'a' : m.teams.b.some(p => p.u === uid) ? 'b' : null; }
    function members(m) { return m.teams.a.concat(m.teams.b).map(p => p.u); }
    // A match as every page sees it, from the invitation. ask: { id, mode, stake, ring, t0 (when round 1 starts),
    // cap (the captain's uid), a: [{ u, n, r }], b: [...] }. me: this page's uid.
    function newMatch(ask, me) {
        const m = { id: ask.id, mode: ask.mode, stake: ask.stake, ring: ask.ring, cap: ask.cap, teams: { a: ask.a.slice(), b: ask.b.slice() },
            me, team: null, round: 1, wins: { a: 0, b: 0 }, played: 0, state: 'countdown', liveAt: ask.t0, down: {}, gone: {}, result: null, history: [] };
        m.team = teamOf(m, me);
        return m;
    }
    function standing(m, team) { return m.teams[team].filter(p => !m.down[p.u] && !m.gone[p.u]).length; }
    // Feed the match something that happened; returns what follows from it: [{ type: 'live' | 'roundEnd' | 'end', ... }].
    // ev: { type: 'tick', now } | { type: 'down', uid, round, t } | { type: 'quit', uid, t }
    function reduce(m, ev) {
        const out = [];
        if (m.result) return out;
        if (ev.type === 'down') {
            // counted for the round it names, if it came after that round started (a page's clock may be a little ahead)
            if (teamOf(m, ev.uid) && ev.round === m.round && !m.down[ev.uid] && Number(ev.t) >= m.liveAt - 1000) m.down[ev.uid] = Number(ev.t) || m.liveAt;
            return out;
        }
        if (ev.type === 'quit') {
            if (teamOf(m, ev.uid) && !m.gone[ev.uid]) { m.gone[ev.uid] = Number(ev.t) || m.liveAt; if (!m.down[ev.uid]) m.down[ev.uid] = m.gone[ev.uid]; }
            return out;
        }
        if (ev.type !== 'tick') return out;
        const now = ev.now;
        // a team that has all left loses (both: a draw)
        const goneA = m.teams.a.every(p => m.gone[p.u]), goneB = m.teams.b.every(p => m.gone[p.u]);
        if (goneA || goneB) { finish(m, goneA && goneB ? 'draw' : goneA ? 'b' : 'a', out); return out; }
        if (m.state === 'break' && now >= m.liveAt - RULES.countdownSec * 1000) m.state = 'countdown';
        if (m.state === 'countdown' && now >= m.liveAt) { m.state = 'live'; out.push({ type: 'live', round: m.round }); }
        if (m.state !== 'live') return out;
        const sa = standing(m, 'a'), sb = standing(m, 'b');
        if (!sa || !sb) {
            // the wipe was decided by the last knockout of the beaten side: every page has that same time from its message
            const lost = !sa && !sb ? null : !sa ? 'a' : 'b';
            const times = (lost ? m.teams[lost] : members(m).map(u => ({ u }))).map(p => m.down[p.u] || m.gone[p.u] || m.liveAt);
            endRound(m, lost ? (lost === 'a' ? 'b' : 'a') : null, Math.max(...times), out);
        } else if (now >= m.liveAt + (RULES.roundSec + RULES.graceSec) * 1000) {
            endRound(m, sa > sb ? 'a' : sb > sa ? 'b' : null, m.liveAt + RULES.roundSec * 1000, out);
        }
        return out;
    }
    function endRound(m, winner, at, out) {
        m.played++;
        if (winner) m.wins[winner]++;
        m.history.push(winner || 'draw');
        out.push({ type: 'roundEnd', round: m.round, winner, at });
        if (winner && m.wins[winner] >= RULES.winsNeeded) { finish(m, winner, out); return; }
        if (m.played >= RULES.maxRounds) { finish(m, m.wins.a > m.wins.b ? 'a' : m.wins.b > m.wins.a ? 'b' : 'draw', out); return; }
        m.round++;
        m.down = {};
        for (const u in m.gone) m.down[u] = m.gone[u]; // whoever left stays out
        m.state = 'break';
        m.liveAt = at + (RULES.breakSec + RULES.countdownSec) * 1000;
    }
    function finish(m, result, out) { m.result = result; m.state = 'done'; out.push({ type: 'end', result }); }
    // What the finished match means for this page's player: { won, draw, ratingDelta, payout (rubies back: 2x stake for a
    // win, the stake for a draw, 0 for a loss), counts (false past the day's repeat limit against these opponents) }
    function outcome(m, myRating, repeats) {
        const mine = m.team, theirs = mine === 'a' ? 'b' : 'a';
        const draw = m.result === 'draw', won = !draw && m.result === mine;
        const counts = (repeats || 0) < RULES.repeatLimit;
        const delta = counts ? elo(teamRating(m.teams[mine]), teamRating(m.teams[theirs]), won ? 1 : draw ? 0.5 : 0) : 0;
        return { won, draw, lost: !won && !draw, ratingDelta: delta, newRating: clampRating((myRating || RULES.elo.start) + delta),
            payout: m.stake ? (won ? m.stake * 2 : draw ? m.stake : 0) : 0, counts, team: m.mode !== 'duel' };
    }
    // the opponents, as one key (for the repeat limit)
    function vsKey(m) { return (m.team === 'a' ? m.teams.b : m.teams.a).map(p => p.u).sort().join('+').slice(0, 200); }

    // ---------------- wagers ----------------
    function canStake(rubies, stake) { return RULES.stakes.includes(stake) && rubies >= stake; }

    // ---------------- messages ----------------
    // The invitation's payload (d/{uid}/*.x): mode|stake|ring|t0|cap|a team|b team, a team being uid~name~rating, ...
    function packAsk(ask) {
        const team = (list) => list.map(p => p.u + '~' + p.n + '~' + clampRating(p.r)).join(',');
        return [ask.mode, ask.stake, ask.ring, Math.round(ask.t0), ask.cap, team(ask.a), team(ask.b)].join('|');
    }
    function unpackAsk(id, x) {
        if (!MID_RE.test(String(id || '')) || typeof x !== 'string' || x.length > 400) return null;
        const f = x.split('|');
        if (f.length !== 7 || !MODES[f[0]]) return null;
        const size = MODES[f[0]].size;
        const team = (str) => {
            const list = String(str).split(',').map(s => s.split('~')).filter(p => p.length === 3 && UID_RE.test(p[0]) && NAME_RE.test(p[1]))
                .map(p => ({ u: p[0], n: p[1], r: clampRating(p[2]) }));
            return list.length === size ? list : null;
        };
        const a = team(f[5]), b = team(f[6]), stake = Number(f[1]), ring = int(f[2], 0, 9), t0 = Number(f[3]);
        if (!a || !b || !RULES.stakes.includes(stake) || !Number.isFinite(t0) || !UID_RE.test(f[4])) return null;
        const all = a.concat(b).map(p => p.u);
        if (new Set(all).size !== all.length || !all.includes(f[4])) return null;
        return { id, mode: f[0], stake, ring, t0, cap: f[4], a, b };
    }
    // a message as it arrives: { from, m (kind), id, x, t }, or null
    const KINDS = ['ask', 'yes', 'no', 'busy', 'cancel', 'go', 'down', 'quit', 'party', 'pyes', 'pno', 'pleave', 'ko'];
    function cleanMsg(raw) {
        if (!isObj(raw) || !UID_RE.test(String(raw.from || '')) || !KINDS.includes(raw.m)) return null;
        return { from: raw.from, m: raw.m, id: typeof raw.id === 'string' ? raw.id.slice(0, 24) : '', x: typeof raw.x === 'string' ? raw.x.slice(0, 400) : '', t: Number(raw.t) || 0 };
    }

    // ---------------- the queue ----------------
    // Players waiting for a match publish what they want (aq: 'duel' | 't2' | 't3'), their party (pt: its id, every member
    // the same) and their rating. The lowest uid in the queue makes the matches, so every page agrees who does.
    // queue: [{ uid, n, r, aq, pt }] -> [{ mode, a: [...], b: [...] }]: closest ratings together, parties kept whole.
    function matchmaker(queue) { return queue.map(q => q.uid).filter(u => UID_RE.test(u)).sort()[0] || null; }
    function pickMatches(queue) {
        const out = [];
        for (const mode of Object.keys(MODES)) {
            const size = MODES[mode].size;
            // units: a party queues together; solo players are a party of one
            const byParty = new Map();
            for (const q of queue.filter(x => x.aq === mode)) { const k = q.pt || q.uid; if (!byParty.has(k)) byParty.set(k, []); byParty.get(k).push(q); }
            let units = [...byParty.values()].filter(u => u.length <= size).map(u => u.sort((a, b) => (a.uid < b.uid ? -1 : 1)))
                .sort((a, b) => teamRating(b) - teamRating(a) || (a[0].uid < b[0].uid ? -1 : 1));
            // fill teams greedily, biggest parties first, strongest first
            const teams = [];
            units = units.sort((a, b) => b.length - a.length || teamRating(b) - teamRating(a));
            const used = new Set();
            for (let i = 0; i < units.length; i++) {
                if (used.has(i)) continue;
                const team = units[i].slice(); used.add(i);
                for (let j = i + 1; j < units.length && team.length < size; j++) if (!used.has(j) && team.length + units[j].length <= size) { team.push(...units[j]); used.add(j); }
                if (team.length === size) teams.push(team);
            }
            teams.sort((a, b) => teamRating(b) - teamRating(a));
            for (let i = 0; i + 1 < teams.length; i += 2) out.push({ mode, a: teams[i].map(toPlayer), b: teams[i + 1].map(toPlayer) });
        }
        return out;
    }
    const toPlayer = (q) => ({ u: q.uid, n: q.n, r: clampRating(q.r) });

    // ---------------- the save ----------------
    function freshArena() {
        return { glory: 0, gloryTotal: 0, rating: RULES.elo.start, peak: RULES.elo.start, w: 0, l: 0, d: 0, teamW: 0, teamL: 0,
            pitKO: 0, pitDown: 0, waveBest: 0, wagerWins: 0, wagerNet: 0, titles: {}, title: '', coffer: '',
            day: { key: '', match: 0, pit: 0, waves: 0, rubyWins: 0, vs: {} }, live: null };
    }
    function cleanArena(raw) {
        const a = freshArena();
        if (!isObj(raw)) return a;
        for (const k of ['glory', 'gloryTotal', 'w', 'l', 'd', 'teamW', 'teamL', 'pitKO', 'pitDown', 'waveBest', 'wagerWins']) a[k] = int(raw[k], 0, 1e9);
        a.wagerNet = int(raw.wagerNet, -1e9, 1e9);
        a.rating = clampRating(raw.rating === undefined ? RULES.elo.start : raw.rating);
        a.peak = Math.max(a.rating, clampRating(raw.peak === undefined ? a.rating : raw.peak));
        if (isObj(raw.titles)) for (const t in raw.titles) if (raw.titles[t] && SHOP.some(x => x.title === t)) a.titles[t] = true;
        a.title = typeof raw.title === 'string' && titlesOf(a).includes(raw.title) ? raw.title : '';
        a.coffer = typeof raw.coffer === 'string' ? raw.coffer.slice(0, 12) : '';
        const d = isObj(raw.day) ? raw.day : {};
        a.day = { key: typeof d.key === 'string' ? d.key.slice(0, 12) : '', match: int(d.match, 0, 1e6), pit: int(d.pit, 0, 1e6), waves: int(d.waves, 0, 1e6), rubyWins: int(d.rubyWins, 0, 1e6), vs: {} };
        if (isObj(d.vs)) for (const k of Object.keys(d.vs).slice(0, 50)) if (k.length <= 200) a.day.vs[k] = int(d.vs[k], 0, 1e6);
        if (isObj(raw.live) && MID_RE.test(String(raw.live.mid || ''))) a.live = { mid: raw.live.mid, stake: RULES.stakes.includes(raw.live.stake) ? raw.live.stake : 0, delta: int(raw.live.delta, -1000, 0), at: Number(raw.live.at) || 0 };
        return a;
    }
    // every title this player may show: those bought, and the rank titles up to their best rating
    function titlesOf(a) { return Object.keys(a.titles || {}).filter(t => a.titles[t]).concat(RANKS.filter(r => r.min > 0 && (a.peak || 0) >= r.min).map(r => r.name)); }
    // A new day starts the caps again (dayKey: the local day, the way the rest of the Wilds counts days)
    function refreshDay(a, dayKey) { if (a.day.key !== dayKey) a.day = { key: dayKey, match: 0, pit: 0, waves: 0, rubyWins: 0, vs: {} }; return a.day; }
    // Glory for something, inside today's cap for its kind ('match' | 'pit' | 'waves'). Returns what was given.
    function giveGlory(a, kind, n, dayKey) {
        const day = refreshDay(a, dayKey);
        const left = Math.max(0, GLORY.cap[kind] - day[kind]), got = Math.max(0, Math.min(left, Math.floor(n)));
        day[kind] += got; a.glory += got; a.gloryTotal += got;
        return got;
    }

    // ---------------- the leaderboard ----------------
    // wilds/v1/arena/top/{uid}: { n, r, w, l, ti, t }, each player writing their own (so it is "for fun", like the game's)
    function topRecord(name, a, now) { return { n: String(name || 'Player').slice(0, 16), r: clampRating(a.rating), w: int(a.w, 0, 1e6), l: int(a.l, 0, 1e6), ti: String(a.title || '').slice(0, 24), t: Math.round(now) }; }
    function sanitizeTop(raw) {
        if (!isObj(raw) || typeof raw.n !== 'string' || !NAME_RE.test(raw.n)) return null;
        return { n: raw.n, r: clampRating(raw.r), w: int(raw.w, 0, 1e6), l: int(raw.l, 0, 1e6), ti: typeof raw.ti === 'string' ? raw.ti.slice(0, 24) : '', t: Number(raw.t) || 0 };
    }
    // the best n of a { uid: record } tree, highest rating first
    function topList(tree, n = 20) {
        const out = [];
        if (isObj(tree)) for (const uid in tree) { const r = sanitizeTop(tree[uid]); if (r && UID_RE.test(uid)) out.push(Object.assign({ uid }, r)); }
        return out.sort((a, b) => b.r - a.r || b.w - a.w || (a.uid < b.uid ? -1 : 1)).slice(0, n);
    }

    return { MODES, RULES, GLORY, RANKS, SHOP, SHOP_BY_ID, inCircle, hitAllowed, clampRating, expected, elo, teamRating, rankFor,
        teamOf, members, newMatch, reduce, outcome, vsKey, canStake, packAsk, unpackAsk, cleanMsg, KINDS, matchmaker, pickMatches,
        freshArena, cleanArena, titlesOf, refreshDay, giveGlory, topRecord, sanitizeTop, topList };
}));
