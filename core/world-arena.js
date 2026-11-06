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
    // rubies: for the Wilds. gems / golden: sent to the game, and still inside the Wilds' daily caps (core/world-data.js
    // CAPS), like the Trader's exchange. pack: a follower pack (followers-data.js PACKS) to open free on the game's
    // Followers page. guild: a Guild Chest, one hero guild at random (core/world-guilds.js). perWeek: how many a week.
    const SHOP = [
        { id: 'potion_big', name: '2 Big Potions', glory: 60, give: { potion_big: 2 } },
        { id: 'potion_max', name: 'Max Potion', glory: 90, give: { potion_max: 1 } },
        { id: 'arrows', name: '40 Arrows', glory: 40, give: { arrow: 40 } },
        { id: 'rubies_s', name: '♦ 2,000 rubies', glory: 200, rubies: 2000 },
        { id: 'rubies_l', name: '♦ 12,000 rubies', glory: 1000, rubies: 12000 },
        { id: 'gems', name: '3 gems for your game', glory: 600, gems: 3, perWeek: 2 },
        { id: 'golden', name: '1 Golden What Happened for your game', glory: 2500, golden: 1, perWeek: 1 },
        { id: 'pack_sack', name: 'Scrappy Sack (follower pack)', glory: 400, pack: 'sack', perWeek: 3 },
        { id: 'pack_clicker', name: 'Clicker Crate (follower pack)', glory: 1500, pack: 'clicker', perWeek: 1 },
        { id: 'pack_idler', name: 'Idler Crate (follower pack)', glory: 1500, pack: 'idler', perWeek: 1 },
        { id: 'pack_oddity', name: 'Oddity Crate (follower pack)', glory: 1800, pack: 'oddity', perWeek: 1 },
        { id: 'pack_royal', name: 'Royal Chest (follower pack)', glory: 3500, pack: 'royal', perWeek: 1 },
        { id: 'pack_celestial', name: 'Celestial Relic (follower pack)', glory: 8000, pack: 'celestial', perWeek: 1 },
        { id: 'guild_chest', name: 'Guild Chest (a random hero guild)', glory: 15000, guild: true },
        { id: 'title_brawler', name: 'Title: Brawler', glory: 100, title: 'Brawler' },
        { id: 'title_gladiator', name: 'Title: Gladiator', glory: 400, title: 'Gladiator' },
        { id: 'title_warlord', name: 'Title: Warlord', glory: 1200, title: 'Warlord' },
        { id: 'title_legend', name: 'Title: Legend of the Sand', glory: 3000, title: 'Legend of the Sand' },
        { id: 'coffer', name: "Champion's Coffer (a Golden Chest for your game)", glory: 500, coffer: 2, weekly: true },
    ];
    const SHOP_BY_ID = Object.fromEntries(SHOP.map(x => [x.id, x]));
    // Seasons: one calendar month in UTC (the same for everyone, like the board). At the turn every rating moves halfway back
    // to the start (softReset), and a player who played minGames rated matches or more claims a reward for the best rank they
    // reached that season: Glory (outside the daily caps, once a season) and, from Gold up, a title for that season.
    const SEASON = {
        minGames: 5,
        rewards: { bronze: { glory: 100 }, silver: { glory: 250 }, gold: { glory: 500, title: true }, platinum: { glory: 800, title: true },
            diamond: { glory: 1200, title: true }, champion: { glory: 2000, title: true } },
    };
    const SEASON_RE = /^20\d{2}-(0[1-9]|1[0-2])$/;
    const SEASON_TITLE_RE = /^(gold|platinum|diamond|champion):(20\d{2}-(0[1-9]|1[0-2]))$/;
    const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
    const UID_RE = /^[A-Za-z0-9_-]{4,64}$/;
    const NAME_RE = /^[A-Za-z0-9 _.\-]{1,16}$/;
    const MID_RE = /^[A-Za-z0-9]{4,24}$/;
    const TOUR_TAG_RE = /^[A-Za-z0-9]{8,12}~\d{1,2}~\d$/;
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
    // cap (the captain's uid), a: [{ u, n, r }], b: [...], tour (a tournament duel's tag, or '') }. me: this page's uid.
    function newMatch(ask, me) {
        const m = { id: ask.id, mode: ask.mode, stake: ask.stake, ring: ask.ring, cap: ask.cap, tour: ask.tour || '', teams: { a: ask.a.slice(), b: ask.b.slice() },
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
        return [ask.mode, ask.stake, ask.ring, Math.round(ask.t0), ask.cap, team(ask.a), team(ask.b)].concat(ask.tour ? [ask.tour] : []).join('|');
    }
    function unpackAsk(id, x) {
        if (!MID_RE.test(String(id || '')) || typeof x !== 'string' || x.length > 400) return null;
        const f = x.split('|');
        if ((f.length !== 7 && f.length !== 8) || !MODES[f[0]]) return null;
        // an 8th field: a tournament's duel (core/world-tour.js tag: tid~slot~gear tier), never staked
        const tour = f.length === 8 && TOUR_TAG_RE.test(f[7]) ? f[7] : '';
        if (f.length === 8 && (!tour || f[0] !== 'duel' || Number(f[1]) !== 0)) return null;
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
        return Object.assign({ id, mode: f[0], stake, ring, t0, cap: f[4], a, b }, tour ? { tour } : {});
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

    // ---------------- seasons ----------------
    function seasonOf(now) { const d = new Date(now); return d.getUTCFullYear() + '-' + String(d.getUTCMonth() + 1).padStart(2, '0'); }
    function seasonEndsAt(now) { const d = new Date(now); return Date.UTC(d.getUTCFullYear(), d.getUTCMonth() + 1, 1); }
    function prevSeason(id) { const [y, m] = id.split('-').map(Number); return m === 1 ? (y - 1) + '-12' : y + '-' + String(m - 1).padStart(2, '0'); }
    // the season's board under wilds/v1/arena/season/ (database keys can't start with a digit in the rules' regex)
    function seasonKey(id) { return 's' + id; }
    function seasonLabel(id) { const [y, m] = id.split('-'); return MONTHS[Number(m) - 1] + " '" + y.slice(2); }
    function softReset(r) { return clampRating(Math.round(RULES.elo.start + (clampRating(r) - RULES.elo.start) / 2)); }
    function rankById(id) { return RANKS.find(r => r.id === id) || null; }
    function seasonTitle(rankId, id) { const r = rankById(rankId); return r ? r.name + ' · ' + seasonLabel(id) : ''; }
    function freshSeason(id, rating) { return { id, peak: clampRating(rating), w: 0, l: 0, d: 0 }; }
    // A new month: the season that ended becomes seasonLast (when it had a match), the rating is softly reset, and the new
    // season starts from it. The first time a save sees seasons it just joins the current one. A clock that went back is
    // ignored. Returns true when it turned.
    function rollSeason(a, now) {
        const id = seasonOf(now), cur = a.season && a.season.id;
        if (cur === id || (cur && cur > id)) return false;
        if (cur) {
            const games = a.season.w + a.season.l + a.season.d;
            if (games > 0) {
                const rank = rankFor(a.season.peak);
                a.seasonLast = { id: cur, peak: a.season.peak, rank: rank.id, games, claimed: false };
                if (games >= SEASON.minGames) a.seasonBest = Math.max(a.seasonBest || 0, RANKS.indexOf(rank) + 1);
            }
            a.rating = softReset(a.rating);
        }
        a.season = freshSeason(id, a.rating);
        return true;
    }
    // A rated match finished (core/world-logic.js arenaResult)
    function seasonGame(a, o) {
        const s = a.season;
        if (o.won) s.w++; else if (o.lost) s.l++; else s.d++;
        s.peak = Math.max(s.peak, a.rating);
    }
    // The ended season's reward. Returns { ok, reason?, glory, title }
    function claimSeason(a) {
        const last = a.seasonLast;
        if (!last) return { ok: false, reason: 'none' };
        if (last.claimed) return { ok: false, reason: 'claimed' };
        if (last.games < SEASON.minGames) return { ok: false, reason: 'games' };
        const pay = SEASON.rewards[last.rank] || SEASON.rewards.bronze;
        last.claimed = true;
        a.glory += pay.glory; a.gloryTotal += pay.glory;
        let title = '';
        if (pay.title) { a.seasonTitles[last.rank + ':' + last.id] = true; title = seasonTitle(last.rank, last.id); a.title = title; }
        return { ok: true, glory: pay.glory, title };
    }

    // ---------------- the save ----------------
    function freshArena() {
        return { glory: 0, gloryTotal: 0, rating: RULES.elo.start, peak: RULES.elo.start, w: 0, l: 0, d: 0, teamW: 0, teamL: 0,
            pitKO: 0, pitDown: 0, waveBest: 0, wagerWins: 0, wagerNet: 0, titles: {}, title: '', coffer: '',
            bought: { week: '', n: {} }, // this week's count of each Glory shop item that has a weekly limit (perWeek)
            tourWins: 0, tourPlayed: 0, tourPrize: 0, tours: {}, // tournaments: s.arena.tours is cleaned by core/world-logic.js migrate (core/world-tour.js)
            // seasons: this one (id '' until the save first sees seasons), the one that ended, the season titles won, and the
            // best rank a finished season reached (RANKS index + 1; 0 for none)
            season: { id: '', peak: RULES.elo.start, w: 0, l: 0, d: 0 }, seasonLast: null, seasonTitles: {}, seasonBest: 0,
            day: { key: '', match: 0, pit: 0, waves: 0, rubyWins: 0, vs: {} }, live: null };
    }
    function cleanArena(raw) {
        const a = freshArena();
        if (!isObj(raw)) return a;
        for (const k of ['glory', 'gloryTotal', 'w', 'l', 'd', 'teamW', 'teamL', 'pitKO', 'pitDown', 'waveBest', 'wagerWins', 'tourWins', 'tourPlayed', 'tourPrize']) a[k] = int(raw[k], 0, 1e9);
        a.wagerNet = int(raw.wagerNet, -1e9, 1e9);
        a.rating = clampRating(raw.rating === undefined ? RULES.elo.start : raw.rating);
        a.peak = Math.max(a.rating, clampRating(raw.peak === undefined ? a.rating : raw.peak));
        if (isObj(raw.titles)) for (const t in raw.titles) if (raw.titles[t] && (SHOP.some(x => x.title === t) || (D.VAULT_SHOP || []).some(x => x.title === t))) a.titles[t] = true;
        if (isObj(raw.seasonTitles)) for (const k in raw.seasonTitles) if (raw.seasonTitles[k] === true && SEASON_TITLE_RE.test(k)) a.seasonTitles[k] = true;
        const se = isObj(raw.season) ? raw.season : {};
        a.season = { id: typeof se.id === 'string' && SEASON_RE.test(se.id) ? se.id : '', peak: clampRating(se.peak === undefined ? a.rating : se.peak),
            w: int(se.w, 0, 1e6), l: int(se.l, 0, 1e6), d: int(se.d, 0, 1e6) };
        a.season.peak = Math.max(a.season.peak, a.rating);
        const sl = isObj(raw.seasonLast) ? raw.seasonLast : null;
        a.seasonLast = sl && typeof sl.id === 'string' && SEASON_RE.test(sl.id) && rankById(sl.rank)
            ? { id: sl.id, peak: clampRating(sl.peak), rank: sl.rank, games: int(sl.games, 0, 1e6), claimed: sl.claimed === true } : null;
        a.seasonBest = int(raw.seasonBest, 0, RANKS.length);
        a.title = typeof raw.title === 'string' && titlesOf(a).includes(raw.title) ? raw.title : '';
        a.coffer = typeof raw.coffer === 'string' ? raw.coffer.slice(0, 12) : '';
        const b = isObj(raw.bought) ? raw.bought : {};
        a.bought = { week: typeof b.week === 'string' ? b.week.slice(0, 12) : '', n: {} };
        if (isObj(b.n)) for (const k in b.n) if (SHOP_BY_ID[k] && SHOP_BY_ID[k].perWeek) { const v = int(b.n[k], 0, 1e6); if (v) a.bought.n[k] = v; }
        const d = isObj(raw.day) ? raw.day : {};
        a.day = { key: typeof d.key === 'string' ? d.key.slice(0, 12) : '', match: int(d.match, 0, 1e6), pit: int(d.pit, 0, 1e6), waves: int(d.waves, 0, 1e6), rubyWins: int(d.rubyWins, 0, 1e6), vs: {} };
        if (isObj(d.vs)) for (const k of Object.keys(d.vs).slice(0, 50)) if (k.length <= 200) a.day.vs[k] = int(d.vs[k], 0, 1e6);
        if (isObj(raw.live) && MID_RE.test(String(raw.live.mid || ''))) a.live = { mid: raw.live.mid, stake: RULES.stakes.includes(raw.live.stake) ? raw.live.stake : 0, delta: int(raw.live.delta, -1000, 0), at: Number(raw.live.at) || 0 };
        return a;
    }
    // every title this player may show: those bought, and the rank titles up to their best rating
    function titlesOf(a) {
        const season = Object.keys(a.seasonTitles || {}).map(k => SEASON_TITLE_RE.exec(k)).filter(Boolean).map(m => seasonTitle(m[1], m[2]));
        return Object.keys(a.titles || {}).filter(t => a.titles[t]).concat(RANKS.filter(r => r.min > 0 && (a.peak || 0) >= r.min).map(r => r.name), season);
    }
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
        return { n: raw.n, r: clampRating(raw.r), w: int(raw.w, 0, 1e6), l: int(raw.l, 0, 1e6), g: int(raw.g, 0, 1e6), ti: typeof raw.ti === 'string' ? raw.ti.slice(0, 24) : '', t: Number(raw.t) || 0 };
    }
    // wilds/v1/arena/season/s{YYYY-MM}/{uid}: the season's board, the same records with this season's games (g) and record
    function seasonRecord(name, a, now) {
        const se = a.season || freshSeason('', a.rating);
        return { n: String(name || 'Player').slice(0, 16), r: clampRating(a.rating), w: int(se.w, 0, 1e6), l: int(se.l, 0, 1e6), g: int(se.w + se.l + se.d, 0, 1e6), ti: String(a.title || '').slice(0, 24), t: Math.round(now) };
    }
    // the best n of a { uid: record } tree, highest rating first
    function topList(tree, n = 20) {
        const out = [];
        if (isObj(tree)) for (const uid in tree) { const r = sanitizeTop(tree[uid]); if (r && UID_RE.test(uid)) out.push(Object.assign({ uid }, r)); }
        return out.sort((a, b) => b.r - a.r || b.w - a.w || (a.uid < b.uid ? -1 : 1)).slice(0, n);
    }

    // wilds/v1/arena/waves/{uid}: { n, w (best wave), p (players in that run), ti, t }, the Proving Grounds' board, each player
    // writing their own when they reach a new best (self-reported, like the rating board)
    function wavesRecord(name, a, players, now) { return { n: String(name || 'Player').slice(0, 16), w: int(a.waveBest, 0, 9999), p: int(players, 1, 8), ti: String(a.title || '').slice(0, 24), t: Math.round(now) }; }
    function sanitizeWaves(raw) {
        if (!isObj(raw) || typeof raw.n !== 'string' || !NAME_RE.test(raw.n)) return null;
        const w = int(raw.w, 0, 9999);
        return w > 0 ? { n: raw.n, w, p: int(raw.p, 1, 8), ti: typeof raw.ti === 'string' ? raw.ti.slice(0, 24) : '', t: Number(raw.t) || 0 } : null;
    }
    // the best n by wave (reached first breaks a tie: an earlier record ranks higher)
    function wavesList(tree, n = 20) {
        const out = [];
        if (isObj(tree)) for (const uid in tree) { const r = sanitizeWaves(tree[uid]); if (r && UID_RE.test(uid)) out.push(Object.assign({ uid }, r)); }
        return out.sort((a, b) => b.w - a.w || a.t - b.t || (a.uid < b.uid ? -1 : 1)).slice(0, n);
    }
    // a player's place on a full board (1 = top), or 0 when they aren't on it
    function placeOn(tree, uid, kind) {
        const list = kind === 'waves' ? wavesList(tree, Infinity) : topList(tree, Infinity);
        return list.findIndex(r => r.uid === uid) + 1;
    }

    return { MODES, RULES, GLORY, RANKS, SHOP, SHOP_BY_ID, inCircle, hitAllowed, clampRating, expected, elo, teamRating, rankFor,
        teamOf, members, newMatch, reduce, outcome, vsKey, canStake, packAsk, unpackAsk, cleanMsg, KINDS, matchmaker, pickMatches,
        freshArena, cleanArena, titlesOf, refreshDay, giveGlory, topRecord, sanitizeTop, topList, wavesRecord, sanitizeWaves, wavesList, placeOn,
        SEASON, seasonOf, seasonEndsAt, prevSeason, seasonKey, seasonLabel, softReset, seasonTitle, rollSeason, seasonGame, claimSeason, seasonRecord };
}));
