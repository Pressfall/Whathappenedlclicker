/**
 * Tournaments (The Wilds' Arena): a player opens one with an entry fee, others sign up, and the entrants play a knockout
 * bracket of duels. The winner takes the pot (every fee), or the host gives part of it to 2nd and 3rd place (3rd is played
 * for by the semi-final losers). The host can also lock everyone's gear to one tier, so the duels are even.
 *
 * There is no server, so the bracket is worked out on every page from the same record (wilds/v1/arena/tour/{tid}):
 *  - the host's settings, the entries (e/{uid}, each written by its player) and, once it starts, the seeding (s) and start
 *    time (go);
 *  - each player's own results (r/{uid}/{slot}v: 'w' or 'l', after the duel, which is a normal arena match), and walkover
 *    claims (r/{uid}/{slot}o: "my opponent never came"). Each can be written once, by its own player, stamped with the
 *    server's time (the rules hold it to within a few seconds).
 * A pairing is decided by the earliest of: a player saying they lost; both saying they won (disputed: both are out); a
 * walkover claim nobody answered within disputeSec; and at its deadline, a lone win (the loser's page never said) or nothing
 * at all (both are out). Every decision depends only on records stamped before it, so once settleSec has passed it can't
 * change. A cheater can only lie about themselves: claiming a win they didn't get puts both out (they gain nothing), and a
 * draw is played again until the deadline.
 * The fees and prizes move on each player's own page, like a wager (core/world-logic.js tourJoin / tourSeen): a fee is paid
 * on signing up and given back if the tournament is called off or the player doesn't make the bracket. Pure: callers pass
 * `now` (ms, server time).
 *
 * Works in a browser (<script src="core/world-tour.js"> sets window.WHWorldTour, after world-data.js) and in Node.
 */
(function (root, factory) {
    if (typeof module === 'object' && module.exports) module.exports = factory(require('./world-data'));
    else root.WHWorldTour = factory(root.WHWorldData);
}(typeof self !== 'undefined' ? self : this, function (D) {
    'use strict';

    const TOUR = {
        sizes: [4, 8, 16],                          // most players
        fees: [0, 100, 250, 500, 1000, 2500, 5000], // rubies each
        second: [0, 10, 20, 30, 40],                // % of the pot for 2nd place
        third: [0, 5, 10, 15, 20],                  // % of the pot for 3rd place
        startMin: [2, 5, 10, 15],                   // signups close (and it starts) this many minutes after it opens
        minPlayers: 2,
        lateStartSec: 60,     // signups closed this long and the host hasn't started it: any entrant may
        openMaxSec: 3600,     // still not started this long after signups closed: it is off (fees back)
        windowSec: 600,       // how long a pairing has to be played
        noShowSec: 150,       // an opponent not in the Arena this long after the pairing is ready: claim a walkover
        disputeSec: 30,       // a walkover claim stands unless the other player answers within this
        replaySec: 6,         // a drawn duel is played again after this
        settleSec: 15,        // a decision is final this long after it (results may be stamped up to clockSlackMs early)
        clockSlackMs: 10000,
        keepDays: 14,         // old tournaments are deleted after this (anyone may)
        kitScore: 50,         // the quality of a locked-tier kit: Common
        root: 'wilds/v1/arena/tour',
    };
    const TID_RE = /^[A-Za-z0-9]{8,12}$/;
    const UID_RE = /^[A-Za-z0-9_-]{4,64}$/;
    const NAME_RE = /^[A-Za-z0-9 _.\-]{1,16}$/;
    const TITLE_RE = /^[A-Za-z0-9 '!?.,:&#\-]{3,24}$/;
    const KEY_RE = /^(\d{1,2})(v|o)$/;
    const isObj = (v) => !!v && typeof v === 'object' && !Array.isArray(v);
    const int = (v, lo, hi) => Math.max(lo, Math.min(hi, Math.round(Number(v) || 0)));

    function newTid(rnd = Math.random) { let s = ''; const A = 'abcdefghijkmnpqrstuvwxyz23456789'; for (let i = 0; i < 10; i++) s += A[Math.floor(rnd() * A.length)]; return s; }
    function cleanTitle(text) { const s = String(text || '').replace(/\s+/g, ' ').trim(); return TITLE_RE.test(s) ? s : null; }
    // the shares of the pot: [1st, 2nd, 3rd] in %
    function shares(p2, p3) { return [100 - p2 - p3, p2, p3]; }
    // a host's choices, checked: { n, fee, size, p2, p3, g (0: everyone's own gear, 1-9: a kit of that tier), start (minutes) }
    function cleanOptions(o) {
        if (!isObj(o)) return null;
        const n = cleanTitle(o.n), fee = Number(o.fee), size = Number(o.size), p2 = Number(o.p2), p3 = Number(o.p3), g = Number(o.g), start = Number(o.start);
        if (!n || !TOUR.fees.includes(fee) || !TOUR.sizes.includes(size) || !TOUR.second.includes(p2) || !TOUR.third.includes(p3)) return null;
        if (p3 > p2 || p2 + p3 > 50) return null; // 1st gets the most, then 2nd, then 3rd
        if (!Number.isInteger(g) || g < 0 || g > D.MAX_TIER || !TOUR.startMin.includes(start)) return null;
        return { n, fee, size, p2, p3, g, start };
    }
    // the record a host writes to open it
    function newTour(opts, host, hostName, now) {
        const o = cleanOptions(opts);
        if (!o || !UID_RE.test(String(host || ''))) return null;
        return { h: host, hn: NAME_RE.test(String(hostName || '')) ? hostName : 'Someone', n: o.n, fee: o.fee, size: o.size, p2: o.p2, p3: o.p3, g: o.g,
            t: Math.round(now), at: Math.round(now + o.start * 60000), st: 'open' };
    }
    function entry(name, rating, now) { return { n: NAME_RE.test(String(name || '')) ? name : 'Someone', r: int(rating, 0, 5000), t: Math.round(now) }; }

    // ---------------- reading the record ----------------
    function sanitizeTour(id, raw) {
        if (!TID_RE.test(String(id || '')) || !isObj(raw) || !UID_RE.test(String(raw.h || ''))) return null;
        const o = cleanOptions({ n: raw.n, fee: raw.fee, size: raw.size, p2: raw.p2, p3: raw.p3, g: raw.g, start: TOUR.startMin[0] });
        const t = Number(raw.t), at = Number(raw.at);
        if (!o || !Number.isFinite(t) || !Number.isFinite(at) || !['open', 'run', 'off'].includes(raw.st)) return null;
        const entries = [];
        if (isObj(raw.e)) for (const u in raw.e) {
            const e = raw.e[u];
            if (!UID_RE.test(u) || !isObj(e) || !NAME_RE.test(String(e.n || ''))) continue;
            entries.push({ u, n: e.n, r: int(e.r, 0, 5000), t: Number(e.t) || 0 });
        }
        entries.sort((a, b) => a.t - b.t || (a.u < b.u ? -1 : 1));
        const byUid = new Set(entries.map(e => e.u));
        const seeds = [];
        if (typeof raw.s === 'string') for (const u of raw.s.split(',')) if (byUid.has(u) && !seeds.includes(u) && seeds.length < o.size) seeds.push(u);
        const res = {};
        if (isObj(raw.r)) for (const u in raw.r) {
            if (!seeds.includes(u) || !isObj(raw.r[u])) continue;
            for (const k in raw.r[u]) {
                const m = KEY_RE.exec(k), v = raw.r[u][k];
                if (!m || !isObj(v) || !Number.isFinite(Number(v.t))) continue;
                const x = m[2] === 'o' ? 'o' : v.x === 'w' || v.x === 'l' ? v.x : null;
                if (x) (res[u] || (res[u] = {}))[k] = { x, t: Number(v.t) };
            }
        }
        return { id, h: raw.h, hn: NAME_RE.test(String(raw.hn || '')) ? raw.hn : 'Someone', n: o.n, fee: o.fee, size: o.size, p2: o.p2, p3: o.p3, g: o.g,
            t, at, st: raw.st, entries, seeds, go: Number(raw.go) || 0, res };
    }
    // 'open' (signing up), 'starting' (marked as running, the seeding not seen yet), 'run', 'done' (every prize decided for
    // good) or 'off' (called off: fees back)
    function status(tour, now) {
        if (!tour || tour.st === 'off') return 'off';
        if (tour.st === 'open') return now > tour.at + TOUR.openMaxSec * 1000 ? 'off' : 'open';
        // the start is one write (st, s, go), but a page may see its parts one by one: wait for the start time. One that
        // never gets it is off after the same hour an unstarted one has.
        if (!tour.go) return now > tour.at + TOUR.openMaxSec * 1000 ? 'off' : 'starting';
        if (tour.seeds.length < TOUR.minPlayers) return 'off';
        return bracket(tour, now).done ? 'done' : 'run';
    }
    // may this player start it now? The host once signups close (or earlier, with enough players); anyone signed up a minute
    // after that
    function canStart(tour, uid, now) {
        if (!tour || status(tour, now) !== 'open' || tour.entries.length < TOUR.minPlayers) return false;
        if (uid === tour.h) return true;
        return tour.entries.some(e => e.u === uid) && now > tour.at + TOUR.lateStartSec * 1000;
    }
    // The seeding the starter writes: the first `size` to sign up, best rating first
    function seedList(tour) {
        return tour.entries.slice(0, tour.size).sort((a, b) => b.r - a.r || a.t - b.t || (a.u < b.u ? -1 : 1)).map(e => e.u);
    }

    // ---------------- the bracket ----------------
    function bracketSize(n) { let S = 2; while (S < n) S *= 2; return S; }
    // where each seed starts: 1 meets the last, and the top seeds can only meet late (1 8 4 5 2 7 3 6)
    function positions(S) { let p = [1, 2]; while (p.length < S) { const n = p.length * 2 + 1; p = p.flatMap(x => [x, n - x]); } return p; }
    const roundStart = (S, r) => S - (S >> r); // the first slot of round r (0: the first round)
    function hasBronze(tour, S) { return tour.p3 > 0 && S >= 4; }
    function roundName(S, round, slot) {
        const R = Math.log2(S);
        if (slot === S - 1) return 'Bronze match';
        const left = R - round;
        return left === 1 ? 'Final' : left === 2 ? 'Semi-final' : left === 3 ? 'Quarter-final' : 'Round of ' + (S >> round);
    }
    // One player's result in a pairing, if it was stamped inside it
    function rec(tour, uid, key, from, to) { const v = tour.res[uid] && tour.res[uid][key]; return v && v.t >= from && v.t <= to ? v : null; }
    // How a pairing between a and b went (null: not decided yet). See the top of this file.
    function decide(tour, slot, a, b, readyAt, deadline, now) {
        const va = rec(tour, a, slot + 'v', readyAt, deadline), vb = rec(tour, b, slot + 'v', readyAt, deadline);
        const oa = rec(tour, a, slot + 'o', readyAt, deadline), ob = rec(tour, b, slot + 'o', readyAt, deadline);
        const D2 = TOUR.disputeSec * 1000, out = [];
        if (va && va.x === 'l') out.push({ at: va.t, win: b, lose: a, how: 'played' });
        if (vb && vb.x === 'l') out.push({ at: vb.t, win: a, lose: b, how: 'played' });
        if (va && vb && va.x === 'w' && vb.x === 'w') out.push({ at: Math.max(va.t, vb.t), win: null, lose: null, how: 'disputed' });
        // a walkover claim stands if neither player wrote anything else for this pairing before its dispute time was up
        const stands = (o, mine, theirs, theirO) => { const T = o.t + D2; return !(mine && mine.t <= T) && !(theirs && theirs.t <= T) && !(theirO && theirO.t <= T); };
        if (oa && stands(oa, va, vb, ob)) out.push({ at: oa.t + D2, win: a, lose: b, how: 'walkover' });
        if (ob && stands(ob, vb, va, oa)) out.push({ at: ob.t + D2, win: b, lose: a, how: 'walkover' });
        if (va && va.x === 'w' && !vb) out.push({ at: deadline, win: a, lose: b, how: 'played' });
        else if (vb && vb.x === 'w' && !va) out.push({ at: deadline, win: b, lose: a, how: 'played' });
        else out.push({ at: deadline, win: null, lose: null, how: 'timeout' });
        const due = out.filter(c => c.at <= now).sort((x, y) => x.at - y.at || String(x.win).localeCompare(String(y.win)));
        return due[0] || null;
    }
    function resolve(tour, i, round, a, b, known, readyAt, now) {
        const s = { i, round, a, b, readyAt, deadline: 0, state: 'wait', win: null, lose: null, at: 0, how: '', settled: false };
        if (!known) return s;
        if (!a && !b) return Object.assign(s, { state: 'void', at: readyAt, how: 'empty', settled: now - readyAt >= TOUR.settleSec * 1000 });
        if (!a || !b) return Object.assign(s, { state: 'done', win: a || b, at: readyAt, how: 'bye', settled: now - readyAt >= TOUR.settleSec * 1000 });
        s.deadline = readyAt + TOUR.windowSec * 1000;
        const d = decide(tour, i, a, b, readyAt, s.deadline, now);
        if (!d) { s.state = 'ready'; return s; }
        return Object.assign(s, { state: d.win ? 'done' : 'void', win: d.win, lose: d.lose, at: d.at, how: d.how, settled: now - d.at >= TOUR.settleSec * 1000 });
    }
    // -> { S, rounds, slots: [...], bronze, first, second, third, done }
    function bracket(tour, now) {
        const seeds = tour.seeds, S = bracketSize(seeds.length), R = Math.log2(S), pos = positions(S), slots = [];
        const decided = (x) => x.state === 'done' || x.state === 'void';
        for (let r = 0; r < R; r++) {
            const n = S >> (r + 1), base = roundStart(S, r);
            for (let k = 0; k < n; k++) {
                if (r === 0) { slots[base + k] = resolve(tour, base + k, 0, seeds[pos[2 * k] - 1] || null, seeds[pos[2 * k + 1] - 1] || null, true, tour.go, now); continue; }
                const prev = roundStart(S, r - 1), fa = slots[prev + 2 * k], fb = slots[prev + 2 * k + 1];
                slots[base + k] = resolve(tour, base + k, r, fa.win, fb.win, decided(fa) && decided(fb), Math.max(fa.at, fb.at), now);
            }
        }
        const fin = slots[S - 2], bronze = hasBronze(tour, S);
        if (bronze) {
            const sa = slots[roundStart(S, R - 2)], sb = slots[roundStart(S, R - 2) + 1];
            slots[S - 1] = resolve(tour, S - 1, R - 1, sa.lose, sb.lose, decided(sa) && decided(sb), Math.max(sa.at, sb.at), now);
        }
        const over = (x) => decided(x) && x.settled;
        const done = over(fin) && (!bronze || over(slots[S - 1]));
        return { S, rounds: R, slots, bronze, first: fin.win, second: fin.state === 'done' ? fin.lose : null, third: bronze ? slots[S - 1].win : null, done };
    }
    // The pairing this player should be playing now (or null), and who sends the invitation (the better seed)
    function myPairing(tour, br, uid) {
        const s = br.slots.find(x => x && x.state === 'ready' && (x.a === uid || x.b === uid));
        if (!s) return null;
        const foe = s.a === uid ? s.b : s.a;
        const captain = tour.seeds.indexOf(s.a) <= tour.seeds.indexOf(s.b) ? s.a : s.b;
        return { slot: s.i, foe, captain, readyAt: s.readyAt, deadline: s.deadline, name: roundName(br.S, s.round, s.i) };
    }
    // Is this player still in it (not knocked out, the bracket not over)?
    function stillIn(tour, br, uid) {
        if (!tour.seeds.includes(uid) || br.done) return false;
        const out = br.slots.find(x => x && ((x.state === 'done' && x.lose === uid) || (x.state === 'void' && (x.a === uid || x.b === uid))));
        if (!out) return true; // still winning
        // a semi-final loser has the bronze match to come
        if (br.bronze && out.state === 'done' && out.round === br.rounds - 2) { const bz = br.slots[br.S - 1]; return bz.state === 'wait' || bz.state === 'ready'; }
        return false;
    }
    // What each player is owed when it is done: their place's share of the pot, and an equal part of any share nobody won
    // (a final both missed, say). Whole rubies, never more than the pot. -> { uid: rubies }
    function payouts(tour, br) {
        const N = tour.seeds.length, pot = tour.fee * N, sh = shares(tour.p2, tour.p3), places = [br.first, br.second, br.third], out = {};
        let left = 0;
        places.forEach((u, k) => { const amt = Math.floor(pot * sh[k] / 100); if (!amt) return; if (u) out[u] = (out[u] || 0) + amt; else left += amt; });
        const each = N ? Math.floor(left / N) : 0;
        if (each) for (const u of tour.seeds) out[u] = (out[u] || 0) + each;
        return out;
    }
    function placeOf(br, uid) { return br.first === uid ? 1 : br.second === uid ? 2 : br.third === uid ? 3 : 0; }

    // ---------------- an invitation's tag ----------------
    // a tournament duel's invitation says which pairing it is and the gear rule: tid~slot~g
    function tag(tid, slot, g) { return tid + '~' + slot + '~' + g; }
    function parseTag(s) {
        const f = String(s || '').split('~');
        if (f.length !== 3 || !TID_RE.test(f[0]) || !/^\d{1,2}$/.test(f[1]) || !/^\d$/.test(f[2])) return null;
        return { tid: f[0], slot: Number(f[1]), g: Math.min(D.MAX_TIER, Number(f[2])) };
    }
    // a result to write: r/{uid}/{slot}{v|o}
    function resultKey(slot, kind) { return slot + (kind === 'o' ? 'o' : 'v'); }

    // ---------------- the save ----------------
    // s.arena.tours: { tid: { fee, st ('in': signed up, 'run': in the bracket, 'done': settled), t (signed up), paid } }
    function cleanTours(raw) {
        const out = {};
        if (!isObj(raw)) return out;
        for (const tid of Object.keys(raw).slice(0, 30)) {
            const v = raw[tid];
            if (!TID_RE.test(tid) || !isObj(v) || !['in', 'run', 'done'].includes(v.st)) continue;
            out[tid] = { fee: TOUR.fees.includes(v.fee) ? v.fee : 0, st: v.st, t: Number(v.t) || 0, paid: int(v.paid, 0, 1e7), place: int(v.place, 0, 3) };
        }
        return out;
    }
    // tournaments older than this can go from the database (and settled ones from the save)
    function expired(t, now) { return now - t > TOUR.keepDays * 86400000; }

    return { TOUR, TID_RE, newTid, cleanTitle, shares, cleanOptions, newTour, entry, sanitizeTour, status, canStart, seedList, bracketSize, positions,
        roundName, bracket, myPairing, stillIn, payouts, placeOf, tag, parseTag, resultKey, cleanTours, expired, hasBronze };
}));
