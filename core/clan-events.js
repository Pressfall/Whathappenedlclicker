/**
 * Clan events: the weekly schedule, what each event counts, the rewards, and paying a player for events that are over.
 * Both pages use it: the game (clan-game.js) sends clicks, damage and prestiges and pays rewards in the background; the
 * clan page (clan-events-tab.js) shows the events, runs the challenge events and pays too. Whichever page looks first pays.
 *
 * Where things live in Firestore (all under events/):
 *   state                     { upcoming: [{ name, start, end, isDowntime }] }  the next 8 slots, events and downtime in turn
 *   last_ended_event          { recent: [record], and the newest record's fields at the top for older pages }
 *                             record = { name, start, end, type, result? } (result: a Clan v Clan's pairs or a race's groups)
 *   <kind>_progress           { events: { <start>: { <clanId>: { total, members: { <username>: amount | {points,...} } } } } }
 *   bossfight_meta, endless_boss_meta   { events: { <start>: { totalHp, phaseHps, gimmicks } | { baseHp } } }
 *   pairings                  { last: { eventStart, type, pairs | groups } }  for the Clan v Clan / race running now
 * Everything here is written by the players' browsers (docs/trust-boundaries.md): the numbers are self-reported, and this
 * module only makes sure every page reads them the same way and pays each player once.
 *
 * Works in a browser (<script src="core/clan-events.js"> sets window.WHClanEvents) and in Node (require).
 */
(function (root, factory) {
    if (typeof module === 'object' && module.exports) module.exports = factory();
    else root.WHClanEvents = factory();
}(typeof self !== 'undefined' ? self : this, function () {
    'use strict';

    const MIN = 60 * 1000, HOUR = 60 * MIN, DAY = 24 * HOUR;
    const EVENT_MS = 3 * DAY, DOWNTIME_MS = 2 * DAY, SCHEDULE_LEN = 8;
    const HISTORY_MAX = 10;            // ended events kept in last_ended_event.recent
    const PAY_WINDOW_MS = 14 * DAY;    // an ended event can be collected for this long
    const KEEP_PROGRESS_MS = 30 * DAY; // progress older than this is dropped from the progress documents
    const LATE_PRESTIGE_MS = HOUR;     // a prestige still reaches an event that ended this recently (the page reloads after one)
    const SETTLE_MS = 2 * MIN;         // an event is paid this long after it ends, once the last sends have landed
    const DEFAULT_TYPES = ['Bossfight', 'ClanVClan clicks', 'Clan Race', 'prestige party', 'construction event', 'Endless boss', 'Wilds Hunt'];
    // the lists events/config held by default before (written there by the first page to roll a schedule): a config that is
    // still one of these gets the new default list, so new kinds of event join the schedule without a trip to the console
    const OLD_DEFAULT_TYPES = [['Bossfight', 'ClanVClan clicks', 'Clan Race', 'prestige party', 'construction event', 'Endless boss']];
    const BOT_ID = '__bot__';
    const BOT = { id: BOT_ID, name: 'Bot Clan', isBot: true };

    const isObj = (v) => !!v && typeof v === 'object' && !Array.isArray(v);
    const toMs = (v) => { try { if (v && typeof v.toMillis === 'function') return v.toMillis(); } catch (e) {} return Number(v) || 0; };
    const num = (v) => { const n = Number(v); return Number.isFinite(n) ? n : 0; };

    // ---- the kinds of event ----
    // how: what a player does to take part (shown on the clan page)
    const KINDS = {
        bf: { type: 'bossfight', name: 'Bossfight', icon: '⚔️', doc: 'bossfight_progress', meta: 'bossfight_meta', unit: 'damage',
            how: 'Click in the game: every click (and your CPS while you click) hits the boss. Each phase has a twist that changes your damage.' },
        eb: { type: 'endless_boss', name: 'Endless Boss', icon: '♾️', doc: 'endless_boss_progress', meta: 'endless_boss_meta', unit: 'damage',
            how: 'Click in the game to hit the boss. Each boss you beat brings a tougher one; rewards go by how many fall.' },
        cvc: { type: 'clan_v_clan', name: 'Clan v Clan', icon: '🤺', doc: 'cvc_progress', unit: 'clicks',
            how: 'Your clan is paired with another. Click in the game: the clan with more clicks when the event ends wins.' },
        race: { type: 'clan_race', name: 'Clan Race', icon: '🏁', doc: 'race_progress', unit: 'points',
            how: 'Pick a challenge, finish it by playing, and claim its points here. Your clan races three others to the most points.' },
        pp: { type: 'prestige_party', name: 'Prestige Party', icon: '🎉', doc: 'prestige_party_progress', unit: 'prestiges',
            how: 'Prestige in the game. Every prestige by anyone in your clan adds to the total.' },
        con: { type: 'construction', name: 'Construction', icon: '🏗️', doc: 'construction_progress', unit: 'points',
            how: 'Pick a challenge, finish it by playing, and claim its points here. The clan\'s points build toward reward tiers.' },
        wh: { type: 'wilds_hunt', name: 'Wilds Hunt', icon: '🌲', doc: 'wilds_hunt_progress', unit: 'monsters',
            how: 'Head into the Wilds and defeat monsters: every monster anyone in your clan defeats there counts toward the clan\'s total.' },
    };
    // an event's kind ('bf', 'eb', 'cvc', 'race', 'pp', 'con') from its name or type; downtime and anything else: null
    function kindOf(ev) {
        if (!ev || ev.isDowntime) return null;
        const n = String(ev.name || '').toLowerCase(), t = String(ev.type || '').toLowerCase();
        if (n.includes('prestige party') || t === 'prestige_party') return 'pp';
        if ((n.includes('endless') && n.includes('boss')) || t === 'endless_boss') return 'eb';
        if (n.includes('bossfight') || t === 'bossfight') return 'bf';
        if (n.includes('construction') || t === 'construction') return 'con';
        if ((n.includes('clan') && n.includes('click')) || t.includes('clan_v_clan')) return 'cvc';
        if (n.includes('race') || t.includes('clan_race')) return 'race';
        if (n.includes('wilds') || n.includes('hunt') || t === 'wilds_hunt') return 'wh';
        return null;
    }
    function displayName(ev) { const k = kindOf(ev); return k ? KINDS[k].name : (ev && ev.isDowntime ? 'Downtime' : String((ev && ev.name) || 'Event')); }

    // ---- rewards (gems are raised by the clan's level perk: core/clan-levels.js eventGems) ----
    const REWARDS = {
        // every tier reached pays
        pp: [{ at: 20, gems: 5, clanXp: 50, clanPoints: 10 }, { at: 40, gems: 10, clanXp: 100, clanPoints: 25 }, { at: 60, gems: 20, clanXp: 200, clanPoints: 50 },
            { at: 80, gems: 35, clanXp: 350, clanPoints: 100 }, { at: 100, gems: 50, clanXp: 500, clanPoints: 150 }],
        // the phase reached (bossfight_meta's phaseHps); damage tiers when an event has no phases recorded
        bfPhase: [{ at: 1, gems: 5, clanXp: 50, clanPoints: 10 }, { at: 2, gems: 12, clanXp: 120, clanPoints: 25 }, { at: 3, gems: 25, clanXp: 250, clanPoints: 50 }, { at: 4, gems: 45, clanXp: 500, clanPoints: 100 }],
        bfDamage: [{ at: 0, gems: 3, clanXp: 30, clanPoints: 5 }, { at: 1e6, gems: 8, clanXp: 80, clanPoints: 15 }, { at: 1e7, gems: 15, clanXp: 150, clanPoints: 30 },
            { at: 1e8, gems: 25, clanXp: 300, clanPoints: 60 }, { at: 5e8, gems: 40, clanXp: 500, clanPoints: 100 }],
        // the highest tier reached
        eb: [{ at: 1, gems: 5, clanXp: 40, clanPoints: 8 }, { at: 3, gems: 12, clanXp: 100, clanPoints: 20 }, { at: 5, gems: 22, clanXp: 200, clanPoints: 40 },
            { at: 8, gems: 35, clanXp: 350, clanPoints: 65 }, { at: 12, gems: 50, clanXp: 500, clanPoints: 100 }],
        con: [{ at: 25, gems: 3, clanXp: 30, clanPoints: 5 }, { at: 75, gems: 8, clanXp: 80, clanPoints: 15 }, { at: 150, gems: 15, clanXp: 150, clanPoints: 30 },
            { at: 300, gems: 25, clanXp: 300, clanPoints: 55 }, { at: 500, gems: 38, clanXp: 480, clanPoints: 85 }, { at: 800, gems: 55, clanXp: 700, clanPoints: 120 },
            { at: 1200, gems: 80, clanXp: 1000, clanPoints: 180 }],
        cvc: { win: { gems: 25, clanXp: 200, clanPoints: 40 }, lose: { gems: 10, clanXp: 80, clanPoints: 15 }, draw: { gems: 5, clanXp: 30, clanPoints: 5 } },
        race: [{ place: 1, gems: 40, clanXp: 350, clanPoints: 70 }, { place: 2, gems: 25, clanXp: 200, clanPoints: 45 }, { place: 3, gems: 15, clanXp: 120, clanPoints: 25 },
            { place: 4, gems: 8, clanXp: 60, clanPoints: 12 }],
        raceJoin: { gems: 5, clanXp: 30, clanPoints: 5 },
        // monsters the clan defeated in the Wilds: the highest tier reached
        wh: [{ at: 50, gems: 3, clanXp: 30, clanPoints: 5 }, { at: 150, gems: 8, clanXp: 80, clanPoints: 15 }, { at: 400, gems: 15, clanXp: 150, clanPoints: 30 },
            { at: 800, gems: 25, clanXp: 300, clanPoints: 55 }, { at: 1500, gems: 38, clanXp: 480, clanPoints: 85 }, { at: 2500, gems: 55, clanXp: 700, clanPoints: 120 }],
    };
    // extra for the clan's top three contributors (the rest of the clan gets the tier reward only)
    const TOP3 = { pp: [{ gems: 15, cp: 10 }, { gems: 8, cp: 5 }, { gems: 3, cp: 2 }], bf: [{ gems: 20, cp: 15 }, { gems: 10, cp: 8 }, { gems: 5, cp: 3 }],
        wh: [{ gems: 15, cp: 10 }, { gems: 8, cp: 5 }, { gems: 3, cp: 2 }] };
    // monsters one send from the Wilds may add (a Wilds page sends every 15 s; more than this is a counter that jumped)
    const WILDS_SEND_MAX = 60;
    const RACE_GOAL = 500;
    const PP_GOAL = 100;

    // ---- bosses ----
    const BOSS_BASE_HP = 5e7, BOSS_HP_PER_STRENGTH = 220;
    const ENDLESS_BASE_HP = 3e6, ENDLESS_SCALE = 1.45;
    // Each bossfight phase has one twist, and it really changes the damage players send (the page that sends it applies it;
    // the multipliers come from this table, never from the meta document, which only names the twists)
    const GIMMICKS = [
        { id: 'regen', name: 'Regeneration', desc: 'The boss heals while you fight: all damage −15%.', click: 0.85, cps: 0.85 },
        { id: 'shield', name: 'Shield', desc: 'A shield soaks your hits: all damage −30%.', click: 0.7, cps: 0.7 },
        { id: 'weak_clicks', name: 'Hardened', desc: 'Clicks barely scratch it: click damage −40%. CPS hits as usual.', click: 0.6, cps: 1 },
        { id: 'weak_cps', name: 'CPS Drain', desc: 'It drains your CPS: CPS damage −50%. Clicks hit as usual.', click: 1, cps: 0.5 },
        { id: 'enrage', name: 'Enrage', desc: 'Enraged, it drops its guard: all damage +25%.', click: 1.25, cps: 1.25 },
        { id: 'split', name: 'Deflection', desc: 'Some hits glance off: all damage −15%.', click: 0.85, cps: 0.85 },
        { id: 'armor', name: 'Armor', desc: 'Heavy armor: click damage −25%, CPS damage −10%.', click: 0.75, cps: 0.9 },
        { id: 'chaos', name: 'Chaos', desc: 'Every hit lands anywhere from half to one and a half times as hard.', chaos: true },
    ];
    const GIMMICK_BY_ID = {};
    GIMMICKS.forEach((g) => { GIMMICK_BY_ID[g.id] = g; });
    const gimmick = (g) => { const id = isObj(g) ? g.id : g; return Object.prototype.hasOwnProperty.call(GIMMICK_BY_ID, id) ? GIMMICK_BY_ID[id] : null; };
    // a new bossfight's health, phase marks and twists, from the strength of everyone in a clan (click power + 5 x CPS)
    function makeBossMeta(totalStrength, rnd) {
        const r = typeof rnd === 'function' ? rnd : Math.random;
        const totalHp = Math.max(BOSS_BASE_HP, Math.floor(num(totalStrength) * BOSS_HP_PER_STRENGTH));
        const ids = GIMMICKS.map((g) => g.id);
        for (let i = ids.length - 1; i > 0; i--) { const j = Math.floor(r() * (i + 1)); [ids[i], ids[j]] = [ids[j], ids[i]]; }
        return { totalHp, phaseHps: [0.25, 0.5, 0.75, 1].map((p) => Math.floor(p * totalHp)), gimmicks: ids.slice(0, 4).map((id) => ({ id, name: GIMMICK_BY_ID[id].name })) };
    }
    function makeEndlessMeta(totalStrength) {
        return { baseHp: Math.max(ENDLESS_BASE_HP, Math.floor(ENDLESS_BASE_HP * Math.max(0.5, Math.min(2, (num(totalStrength) || 1000) / 50000)))) };
    }
    function memberStrength(m) { return num(m && (m.lastClickPower || m.clickPower)) + Math.max(0, num(m && (m.lastCps || m.cps))) * 5; }
    // phases passed (0-4) for a clan's damage
    function phaseOf(damage, phaseHps) {
        if (!Array.isArray(phaseHps) || phaseHps.length < 4) return 0;
        let phase = 0;
        for (let i = 0; i < 4; i++) if (num(damage) >= num(phaseHps[i])) phase = i + 1;
        return phase;
    }
    // the twist of the phase a clan is fighting now (after the last phase: the last one's)
    function currentGimmick(meta, damage) {
        if (!meta || !Array.isArray(meta.gimmicks) || !meta.gimmicks.length) return null;
        const i = Math.min(phaseOf(damage, meta.phaseHps), meta.gimmicks.length - 1);
        return gimmick(meta.gimmicks[i]);
    }
    // damage sent for `clicks` clicks since the last send: each click hits for 1 + click power (capped), plus 3 s of CPS
    function bossDamage(clicks, clickPower, cps, twist, rnd) {
        const n = Math.max(0, Math.floor(num(clicks)));
        if (!n) return 0;
        let c = n * (1 + Math.min(Math.max(0, num(clickPower)), 1e5)), p = Math.max(0, num(cps)) * 3;
        const g = gimmick(twist);
        if (g && g.chaos) { const m = 0.5 + (typeof rnd === 'function' ? rnd() : Math.random()); c *= m; p *= m; }
        else if (g) { c *= g.click; p *= g.cps; }
        return Math.max(0, Math.floor(c + p));
    }
    // bosses beaten in an Endless Boss event: { defeated, currentHp, intoCurrent, remainingHp }
    function endless(totalDamage, baseHp) {
        const base = num(baseHp) > 0 ? num(baseHp) : ENDLESS_BASE_HP, dmg = Math.max(0, num(totalDamage));
        let sum = 0, n = 0;
        while (n < 1000 && sum + base * Math.pow(ENDLESS_SCALE, n) <= dmg) { sum += base * Math.pow(ENDLESS_SCALE, n); n++; }
        const currentHp = base * Math.pow(ENDLESS_SCALE, n), intoCurrent = dmg - sum;
        return { defeated: n, currentHp, intoCurrent, remainingHp: Math.max(0, currentHp - intoCurrent) };
    }

    // ---- challenges (Construction and the Clan Race) ----
    // Only "gain" (counted from when you pick it) or a safe "reach" (prestiges), so nobody claims points for what they already have.
    // Targets grow with the player's strength. stat: a field of statsFrom().
    const P = (s) => num(s.prestigeTimes);
    const CHALLENGES = [
        { id: 'c1', name: 'Small click gain', desc: 'Gain {target} more clicks.', type: 'gain', stat: 'count', points: 6, scale: (s) => Math.max(200, Math.floor(300 * (1 + P(s) * 0.2) + Math.min(8000, num(s.count) * 0.015))) },
        { id: 'c2', name: 'Golden gain', desc: 'Earn {target} more Golden What Happeneds.', type: 'gain', stat: 'goldenWhat', points: 15, scale: (s) => Math.max(1, Math.floor(1 + P(s) * 0.3 + num(s.goldenWhat) * 0.15)) },
        { id: 'c3', name: 'Level grind', desc: 'Gain {target} more upgrade levels.', type: 'gain', stat: 'totalLevels', points: 14, scale: (s) => Math.max(5, Math.floor(8 + P(s) * 2 + num(s.totalLevels) * 0.08)) },
        { id: 'c4', name: 'CPS gain', desc: 'Raise your CPS by {target}.', type: 'gain', stat: 'cps', points: 18, scale: (s) => Math.max(5, Math.floor(20 * (1 + P(s) * 0.15) + Math.min(2000, num(s.cps) * 0.08))) },
        { id: 'c5', name: 'Mega clicks', desc: 'Gain {target} clicks.', type: 'gain', stat: 'count', points: 10, scale: (s) => Math.max(500, Math.floor(800 * (1 + P(s) * 0.25) + Math.min(25000, num(s.count) * 0.04))) },
        { id: 'c6', name: 'Prestige runner', desc: 'Reach {target} prestiges in total.', type: 'reach', stat: 'prestigeTimes', points: 18, scale: (s) => Math.max(1, Math.floor(P(s) + 1)) },
        { id: 'c7', name: 'Double golden', desc: 'Earn {target} more Golden What Happeneds.', type: 'gain', stat: 'goldenWhat', points: 25, scale: () => 2 },
        { id: 'c8', name: 'Level sprint', desc: 'Gain {target} upgrade levels.', type: 'gain', stat: 'totalLevels', points: 20, scale: (s) => Math.max(10, Math.floor(15 + P(s) * 3 + num(s.totalLevels) * 0.12)) },
        { id: 'c9', name: 'CPS burst', desc: 'Raise your CPS by {target}.', type: 'gain', stat: 'cps', points: 28, scale: (s) => Math.max(50, Math.floor(80 * (1 + P(s) * 0.2) + Math.min(5000, num(s.cps) * 0.1))) },
        { id: 'c10', name: 'Prestige plus one', desc: 'Reach {target} prestiges in total.', type: 'reach', stat: 'prestigeTimes', points: 12, scale: (s) => Math.max(1, P(s) + 1) },
        { id: 'd1', name: 'Divine step', desc: 'Buy {target} Divine upgrade level(s).', type: 'gain', stat: 'divineTotalLevels', points: 12, scale: (s) => Math.max(1, Math.floor(1 + P(s) * 0.2 + num(s.divineTotalLevels) * 0.1)) },
        { id: 'd2', name: 'Divine push', desc: 'Buy {target} Divine upgrade level(s).', type: 'gain', stat: 'divineTotalLevels', points: 20, scale: (s) => Math.max(2, Math.floor(2 + P(s) * 0.4 + num(s.divineTotalLevels) * 0.15)) },
        { id: 'd3', name: 'Divine grind', desc: 'Buy {target} Divine upgrade level(s).', type: 'gain', stat: 'divineTotalLevels', points: 28, scale: (s) => Math.max(3, Math.floor(3 + P(s) * 0.5 + num(s.divineTotalLevels) * 0.2)) },
        { id: 'd4', name: 'Divine dedication', desc: 'Buy {target} Divine upgrade level(s).', type: 'gain', stat: 'divineTotalLevels', points: 35, scale: (s) => Math.max(5, Math.floor(5 + P(s) * 0.6 + num(s.divineTotalLevels) * 0.25)) },
        { id: 'd5', name: 'First divine', desc: 'Buy {target} Divine upgrade level.', type: 'gain', stat: 'divineTotalLevels', points: 8, scale: () => 1 },
        { id: 'g1', name: 'Casino win', desc: 'Win {target} blackjack game(s).', type: 'gain', stat: 'casinoTotalWins', points: 10, scale: (s) => Math.max(1, Math.floor(1 + P(s) * 0.15)) },
        { id: 'g2', name: 'Casino streak', desc: 'Win {target} blackjack game(s).', type: 'gain', stat: 'casinoTotalWins', points: 18, scale: (s) => Math.max(2, Math.floor(2 + P(s) * 0.25)) },
        { id: 'g3', name: 'Casino regular', desc: 'Win {target} blackjack game(s).', type: 'gain', stat: 'casinoTotalWins', points: 25, scale: (s) => Math.max(3, Math.floor(3 + P(s) * 0.3)) },
        { id: 'g4', name: 'Casino high roller', desc: 'Win {target} blackjack game(s).', type: 'gain', stat: 'casinoTotalWins', points: 32, scale: (s) => Math.max(5, Math.floor(5 + P(s) * 0.4)) },
        { id: 'g5', name: 'First blackjack win', desc: 'Win {target} blackjack game.', type: 'gain', stat: 'casinoTotalWins', points: 6, scale: () => 1 },
        { id: 'c11', name: 'Big click gain', desc: 'Gain {target} clicks.', type: 'gain', stat: 'count', points: 14, scale: (s) => Math.max(1000, Math.floor(1500 * (1 + P(s) * 0.2) + Math.min(50000, num(s.count) * 0.06))) },
        { id: 'c12', name: 'Golden sprint', desc: 'Earn {target} more Golden What Happeneds.', type: 'gain', stat: 'goldenWhat', points: 20, scale: (s) => Math.max(2, Math.floor(3 + P(s) * 0.4 + num(s.goldenWhat) * 0.2)) },
        { id: 'c13', name: 'Level push', desc: 'Gain {target} upgrade levels.', type: 'gain', stat: 'totalLevels', points: 24, scale: (s) => Math.max(15, Math.floor(20 + P(s) * 4 + num(s.totalLevels) * 0.15)) },
        { id: 'c14', name: 'CPS climb', desc: 'Raise your CPS by {target}.', type: 'gain', stat: 'cps', points: 22, scale: (s) => Math.max(30, Math.floor(50 * (1 + P(s) * 0.2) + Math.min(4000, num(s.cps) * 0.12))) },
        { id: 'c15', name: 'Prestige two', desc: 'Reach {target} prestiges in total.', type: 'reach', stat: 'prestigeTimes', points: 16, scale: (s) => Math.max(1, P(s) + 2) },
        { id: 'c16', name: 'Click power gain', desc: 'Raise your click power by {target}.', type: 'gain', stat: 'clickPower', points: 16, scale: (s) => Math.max(10, Math.floor(15 * (1 + P(s) * 0.1) + Math.min(5000, num(s.clickPower) * 0.05))) },
    ];
    const DIVINE_KEYS = ['divineArgonLevel', 'divineSomalianLevel', 'divineAssassinLevel', 'divineCollectorLevel', 'divineMoneyManLevel', 'divineSpiritLevel', 'divineSimpleVillagerLevel', 'divineComboManLevel'];
    // what the challenges count, from the game's save and the few numbers the game keeps beside it
    function statsFrom(save, store) {
        const s = isObj(save) ? save : {};
        const get = (k) => { try { return store ? store.getItem(k) : null; } catch (e) { return null; } };
        let totalLevels = 0, divine = 0;
        for (let i = 1; i <= 24; i++) totalLevels += num(s['upgrade' + i + 'Level'] || s['upgrade' + i]);
        for (const k of DIVINE_KEYS) divine += num(s[k]);
        return {
            count: num(s.count), goldenWhat: num(s.goldenWhat), prestigeTimes: num(s.prestigeTimes) || num(get('whathappened_prestige_times')),
            totalLevels, divineTotalLevels: divine, casinoTotalWins: num(s.casino_total_wins) || num(get('gamba_total_wins')),
            cps: num(get('whathappened_current_cps')), clickPower: num(get('whathappened_current_clickpower')),
        };
    }
    // three different challenges to choose from, with targets for these stats
    function pickChallenges(stats, rnd, n) {
        const r = typeof rnd === 'function' ? rnd : Math.random, list = CHALLENGES.slice();
        for (let i = list.length - 1; i > 0; i--) { const j = Math.floor(r() * (i + 1)); [list[i], list[j]] = [list[j], list[i]]; }
        return list.slice(0, n || 3).map((c) => challengeFor(c, stats));
    }
    // a challenge as stored for a player: the target is fixed when it is picked, and so are the stats it counts from
    function challengeFor(c, stats) {
        const target = Math.max(1, Math.floor(num(c.scale(stats || {}))));
        return { id: c.id, name: c.name, desc: c.desc.replace('{target}', target.toLocaleString('en-US')), type: c.type, stat: c.stat, points: c.points, target,
            baseline: Object.assign({}, stats || {}) };
    }
    // { progress, target, done } of a stored challenge against the stats now
    function challengeProgress(ch, stats) {
        if (!isObj(ch)) return { progress: 0, target: 0, done: false };
        const target = Math.max(1, num(ch.target)), cur = num((stats || {})[ch.stat]);
        const progress = ch.type === 'reach' ? cur : cur - num((ch.baseline || {})[ch.stat]);
        return { progress: Math.max(0, Math.min(progress, target)), target, done: progress >= target };
    }
    const CHALLENGE_IDS = new Set(CHALLENGES.map((c) => c.id));
    // points a finished challenge is worth: from the table, never more than the challenge says
    function challengePoints(ch) { const c = isObj(ch) && CHALLENGE_IDS.has(ch.id) ? CHALLENGES.find((x) => x.id === ch.id) : null; return c ? c.points : 0; }

    // ---- reading progress documents ----
    // { total, members } of a clan in one event of a <kind>_progress document (older documents stored a bare number)
    function blockOf(progressDoc, eventStart, clanId) {
        const events = isObj(progressDoc) && isObj(progressDoc.events) ? progressDoc.events : {};
        const byClan = events[String(toMs(eventStart))] || {};
        const raw = isObj(byClan) ? byClan[String(clanId)] : null;
        if (typeof raw === 'number') return { total: raw, members: {} };
        if (!isObj(raw)) return { total: 0, members: {} };
        return { total: num(raw.total), members: isObj(raw.members) ? raw.members : {} };
    }
    // every clan's total in one event
    function totalsOf(progressDoc, eventStart) {
        const events = isObj(progressDoc) && isObj(progressDoc.events) ? progressDoc.events : {};
        const byClan = events[String(toMs(eventStart))], out = {};
        if (isObj(byClan)) for (const id of Object.keys(byClan)) out[id] = blockOf(progressDoc, eventStart, id).total;
        return out;
    }
    const memberValue = (v) => (isObj(v) ? num(v.points) : num(v));
    // a clan's members sorted by what they put in: [[name, amount]]
    function ranking(members) { return Object.keys(isObj(members) ? members : {}).map((n) => [n, memberValue(members[n])]).filter((e) => e[1] > 0).sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0])); }
    // the change (merged into the progress document) that adds `amount` to a clan's total and one member's share;
    // inc is Firestore's increment, so players adding at the same moment never overwrite each other
    function contributionPatch(eventStart, clanId, username, amount, inc) {
        return { events: { [String(toMs(eventStart))]: { [String(clanId)]: { total: inc(amount), members: { [String(username)]: inc(amount) } } } } };
    }
    // event keys in a progress or meta document older than KEEP_PROGRESS_MS (to delete)
    function staleKeys(doc, now) {
        const events = isObj(doc) && isObj(doc.events) ? doc.events : {};
        return Object.keys(events).filter((k) => /^\d+$/.test(k) && Number(k) < now - KEEP_PROGRESS_MS);
    }

    // ---- pairing clans (Clan v Clan in twos, the race in fours) ----
    // clans: [{ id, name, level, size }]; empty clans sit out. Clans of a similar level meet; the odd one out meets the Bot Clan.
    function eligible(clans) {
        return (Array.isArray(clans) ? clans : []).filter((c) => c && c.id && c.id !== BOT_ID && num(c.size) > 0)
            .map((c) => ({ id: String(c.id), name: String(c.name || c.id), level: num(c.level) || 1 }))
            .sort((a, b) => b.level - a.level || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
    }
    const slim = (c) => ({ id: c.id, name: c.name, isBot: !!c.isBot });
    function pairClans(clans) {
        const list = eligible(clans), pairs = [];
        for (let i = 0; i < list.length; i += 2) pairs.push([slim(list[i]), slim(list[i + 1] || BOT)]);
        return { pairs };
    }
    function groupClans(clans, size) {
        const n = size || 4, list = eligible(clans), groups = [];
        for (let i = 0; i < list.length; i += n) {
            const g = list.slice(i, i + n).map(slim);
            while (g.length < n) g.push(slim(BOT));
            groups.push(g);
        }
        return { groups };
    }
    const isBot = (c) => !!c && (String(c.id) === BOT_ID || c.isBot === true);
    // a pairing as stored ([[a, b]] or older [{ a, b }]) as [[a, b]]
    function pairsOf(p) {
        return (p && Array.isArray(p.pairs) ? p.pairs : []).map((x) => (Array.isArray(x) ? [x[0], x[1]] : (isObj(x) ? [x.a || x[0], x.b || x[1]] : [null, null])))
            .filter((x) => x[0] && x[1]);
    }
    function groupsOf(p) { return (p && Array.isArray(p.groups) ? p.groups : []).filter(Array.isArray).map((g) => g.filter((c) => c && c.id)); }
    // the clans a pairing names (bots left out)
    function clansIn(p) {
        const out = new Set();
        pairsOf(p).forEach((x) => x.forEach((c) => { if (!isBot(c)) out.add(String(c.id)); }));
        groupsOf(p).forEach((g) => g.forEach((c) => { if (!isBot(c)) out.add(String(c.id)); }));
        return [...out];
    }
    // A clan missing from a running pairing (made after it was drawn up) takes a Bot Clan's place, or meets one.
    // Returns the new pairing, or null when the clan is in it already.
    function addToPairing(p, clan) {
        if (!p || !clan || !clan.id) return null;
        const c = slim({ id: String(clan.id), name: String(clan.name || clan.id) });
        if (clansIn(p).includes(c.id)) return null;
        if (Array.isArray(p.pairs)) {
            const pairs = pairsOf(p).map((x) => x.map(slim));
            const i = pairs.findIndex((x) => isBot(x[0]) || isBot(x[1]));
            if (i >= 0) pairs[i][isBot(pairs[i][1]) ? 1 : 0] = c; else pairs.push([c, slim(BOT)]);
            return Object.assign({}, p, { pairs });
        }
        const groups = groupsOf(p).map((g) => g.map(slim));
        const i = groups.findIndex((g) => g.some(isBot));
        if (i >= 0) groups[i][groups[i].findIndex(isBot)] = c;
        else groups.push([c, slim(BOT), slim(BOT), slim(BOT)]);
        return Object.assign({}, p, { groups });
    }
    // the pairing for an ended event: what was saved with it, or the pairings document if that is still this event's
    function pairingFor(record, pairingsDoc) {
        if (record && isObj(record.result)) return record.result;
        const last = pairingsDoc && isObj(pairingsDoc.last) ? pairingsDoc.last : null;
        if (last && toMs(last.eventStart) === toMs(record && record.start) && KINDS[kindOf(record)] && String(last.type || '') === KINDS[kindOf(record)].type) return last;
        return null;
    }
    // what is kept with an ended event: only who met whom
    function resultOf(p) {
        if (!p) return null;
        if (Array.isArray(p.pairs)) return { pairs: pairsOf(p).map((x) => x.map(slim)) };
        if (Array.isArray(p.groups)) return { groups: groupsOf(p).map((g) => g.map(slim)) };
        return null;
    }

    // ---- what a player gets for an event that is over ----
    function sumTier(list, value, cumulative) {
        const r = { gems: 0, clanXp: 0, clanPoints: 0 };
        let tier = 0;
        list.forEach((t, i) => {
            if (value < t.at) return;
            tier = i + 1;
            if (cumulative) { r.gems += t.gems; r.clanXp += t.clanXp; r.clanPoints += t.clanPoints; }
            else { r.gems = t.gems; r.clanXp = t.clanXp; r.clanPoints = t.clanPoints; }
        });
        return Object.assign(r, { tier });
    }
    // inp: { clanId, username, progress (the <kind>_progress document), meta (that event's meta entry), pairing, clanLevel,
    //        eventGems (core/clan-levels.js eventGems) }. The event: { start }.
    // Returns { gems, clanXp, clanPoints, bonusGems, bonusCP, place?, text } or null when the clan earned nothing.
    function rewardFor(kind, ev, inp) {
        const i = inp || {}, clanId = String(i.clanId || ''), start = toMs(ev && ev.start);
        if (!KINDS[kind] || !clanId) return null;
        const block = blockOf(i.progress, start, clanId);
        let r = null, text = '';
        const fmt = (n) => Math.round(num(n)).toLocaleString('en-US');
        if (kind === 'pp') {
            r = sumTier(REWARDS.pp, block.total, true);
            text = 'Your clan prestiged ' + fmt(block.total) + ' time' + (block.total === 1 ? '' : 's') + '.';
        } else if (kind === 'bf') {
            const phase = phaseOf(block.total, i.meta && i.meta.phaseHps);
            if (i.meta && Array.isArray(i.meta.phaseHps) && i.meta.phaseHps.length >= 4) r = sumTier(REWARDS.bfPhase, phase, false);
            if (!r || !r.tier) r = block.total > 0 ? sumTier(REWARDS.bfDamage, block.total, false) : null;
            text = 'Your clan dealt ' + fmt(block.total) + ' damage' + (phase ? ' and reached phase ' + phase : '') + '.';
        } else if (kind === 'eb') {
            const e = endless(block.total, i.meta && i.meta.baseHp);
            r = sumTier(REWARDS.eb, e.defeated, false);
            text = 'Your clan beat ' + e.defeated + ' boss' + (e.defeated === 1 ? '' : 'es') + '.';
        } else if (kind === 'con') {
            r = sumTier(REWARDS.con, block.total, false);
            text = 'Your clan built ' + fmt(block.total) + ' points.';
        } else if (kind === 'wh') {
            r = sumTier(REWARDS.wh, block.total, false);
            text = 'Your clan defeated ' + fmt(block.total) + ' monster' + (block.total === 1 ? '' : 's') + ' in the Wilds.';
        } else if (kind === 'cvc') {
            const p = i.pairing;
            if (!p) return null;
            // totals from the event's progress; pairings from before it keep their own (older pages counted clicks there)
            const totals = Object.assign({}, isObj(p.totals) ? p.totals : {}, totalsOf(i.progress, start));
            const pair = pairsOf(p).find((x) => String(x[0].id) === clanId || String(x[1].id) === clanId);
            let res = 'draw', opp = null;
            if (pair) {
                const mine = String(pair[0].id) === clanId ? pair[0] : pair[1];
                opp = mine === pair[0] ? pair[1] : pair[0];
                const a = num(totals[clanId]), b = isBot(opp) ? 0 : num(totals[String(opp.id)]);
                res = a > b ? 'win' : a < b ? 'lose' : 'draw';
                text = res === 'win' ? 'Your clan beat ' + opp.name + ', ' + fmt(a) + ' clicks to ' + fmt(b) + '.'
                    : res === 'lose' ? opp.name + ' beat your clan, ' + fmt(b) + ' clicks to ' + fmt(a) + '.'
                    : 'Your clan and ' + opp.name + ' drew at ' + fmt(a) + ' clicks.';
            } else text = 'Your clan took part.';
            r = Object.assign({ tier: 1, result: res }, REWARDS.cvc[res]);
        } else if (kind === 'race') {
            const p = i.pairing;
            if (!p) return null;
            const totals = Object.assign({}, isObj(p.totals) ? p.totals : {}, totalsOf(i.progress, start));
            const g = groupsOf(p).find((x) => x.some((c) => String(c.id) === clanId));
            let place = 0;
            if (g) {
                const ranked = g.filter((c) => !isBot(c)).map((c) => ({ id: String(c.id), total: num(totals[String(c.id)]) }))
                    .sort((a, b) => b.total - a.total || (a.id < b.id ? -1 : 1));
                place = ranked.findIndex((c) => c.id === clanId) + 1;
            }
            const byPlace = REWARDS.race.find((x) => x.place === place);
            r = Object.assign({ tier: 1, place }, byPlace || REWARDS.raceJoin);
            text = place ? 'Your clan finished ' + ordinal(place) + ' in its race with ' + fmt(block.total) + ' points.' : 'Your clan took part.';
        }
        if (!r || !(r.gems || r.clanXp || r.clanPoints)) return null;
        let bonusGems = 0, bonusCP = 0;
        const top = TOP3[kind];
        if (top && i.username) {
            const pos = ranking(block.members).findIndex((e) => e[0] === String(i.username));
            if (pos >= 0 && pos < top.length) { bonusGems = top[pos].gems; bonusCP = top[pos].cp; }
        }
        const raise = typeof i.eventGems === 'function' ? i.eventGems : (g) => g;
        return { gems: raise(r.gems + bonusGems, i.clanLevel), clanXp: r.clanXp, clanPoints: r.clanPoints + bonusCP, bonusGems, bonusCP,
            place: r.place, result: r.result, text };
    }
    function ordinal(n) { const s = ['th', 'st', 'nd', 'rd'], v = n % 100; return n + (s[(v - 20) % 10] || s[v] || s[0]); }

    // ---- the schedule ----
    function pickType(types, prevName, rnd) {
        const list = (Array.isArray(types) && types.length ? types : DEFAULT_TYPES).map(String);
        const r = typeof rnd === 'function' ? rnd : Math.random;
        // the same kind of event twice in a row only when there is nothing else
        const fresh = list.filter((t) => kindOf({ name: t }) !== kindOf({ name: prevName }));
        const from = fresh.length ? fresh : list;
        return from[Math.floor(r() * from.length)] || 'Bossfight';
    }
    // The schedule moved on to `now`: { upcoming (8 slots from now: events and downtime in turn), ended (events that ended),
    // changed }. A schedule that ran out starts again with an event now.
    function rollSchedule(upcoming, now, types, rnd) {
        const list = (Array.isArray(upcoming) ? upcoming : []).filter((it) => it && toMs(it.end) > toMs(it.start));
        const ended = list.filter((it) => toMs(it.end) <= now);
        const keep = list.filter((it) => toMs(it.end) > now).map((it) => Object.assign({}, it, { start: toMs(it.start), end: toMs(it.end) }));
        let t = keep.length ? keep[keep.length - 1].end : now;
        let downtime = keep.length ? !keep[keep.length - 1].isDowntime : false;
        let prev = '';
        for (const it of list) if (!it.isDowntime) prev = it.name;
        while (keep.length < SCHEDULE_LEN) {
            if (downtime) keep.push({ name: 'DOWNTIME', start: t, end: t + DOWNTIME_MS, isDowntime: true });
            else { prev = pickType(types, prev, rnd); keep.push({ name: prev, start: t, end: t + EVENT_MS, isDowntime: false }); }
            t = keep[keep.length - 1].end;
            downtime = !downtime;
        }
        return { upcoming: keep, ended: ended.filter((it) => !it.isDowntime), changed: ended.length > 0 || keep.length !== list.length };
    }
    // An admin skipping ahead: the slot running now ends now, and `chosen` (an index into upcoming) starts now
    function skipSchedule(upcoming, now, chosenIndex, types, rnd) {
        const list = Array.isArray(upcoming) ? upcoming : [];
        const cur = list.find((it) => toMs(it.start) <= now && toMs(it.end) > now) || null;
        const chosen = list[chosenIndex] || list[list.indexOf(cur) + 1] || null;
        const ended = cur && !cur.isDowntime ? [Object.assign({}, cur, { end: now })] : [];
        const first = chosen ? { name: chosen.isDowntime ? 'DOWNTIME' : chosen.name, start: now, end: now + (chosen.isDowntime ? DOWNTIME_MS : EVENT_MS), isDowntime: !!chosen.isDowntime }
            : { name: pickType(types, cur && cur.name, rnd), start: now, end: now + EVENT_MS, isDowntime: false };
        return { upcoming: rollSchedule([first], now, types, rnd).upcoming, ended };
    }
    // an ended Clan v Clan or race, with who met whom kept on it (the pairings document only holds the one running now)
    function attachResult(ev, pairingsDoc) {
        const k = kindOf(ev);
        if (k !== 'cvc' && k !== 'race') return ev;
        const p = pairingFor(ev, pairingsDoc);
        return p ? Object.assign({}, ev, { result: resultOf(p) }) : ev;
    }
    /**
     * Moving the schedule on, inside one Firestore transaction (both pages run it when a slot ends; the first one in does it,
     * the rest find nothing to do). Every event that ended goes into last_ended_event, so it can be paid.
     * tx: the transaction (get / set); ref(name): the events/<name> document; stamp: serverTimestamp().
     * Returns the events that ended (none when another page got there first).
     */
    async function upkeepTx(tx, ref, now, stamp) {
        const s = await tx.get(ref('state')), c = await tx.get(ref('config'));
        const cfg = c.exists() ? (c.data() || {}) : {};
        const t = typesFrom(cfg);
        const roll = rollSchedule(s.exists() ? (s.data() || {}).upcoming : [], now, t.types);
        if (s.exists() && !roll.changed && !t.upgrade) return [];
        const e = await tx.get(ref('last_ended_event')), p = await tx.get(ref('pairings'));
        const ended = roll.ended.map((ev) => attachResult(ev, p.exists() ? p.data() : null));
        if (!c.exists() || t.upgrade) tx.set(ref('config'), Object.assign({}, cfg, { types: DEFAULT_TYPES }));
        tx.set(ref('state'), { upcoming: roll.upcoming, updatedAt: stamp });
        if (ended.length) tx.set(ref('last_ended_event'), withEnded(e.exists() ? e.data() : null, ended, now));
        return ended;
    }
    // the event types to schedule from events/config: { types, upgrade } (upgrade: the config still holds an older default list)
    function typesFrom(cfg) {
        const list = cfg && Array.isArray(cfg.types) ? cfg.types.map(String).filter(Boolean) : [];
        if (!list.length) return { types: DEFAULT_TYPES.slice(), upgrade: false };
        const same = (a, b) => a.length === b.length && a.slice().sort().join('|') === b.slice().sort().join('|');
        if (OLD_DEFAULT_TYPES.some((old) => same(old, list))) return { types: DEFAULT_TYPES.slice(), upgrade: true };
        return { types: list, upgrade: false };
    }
    // monsters to send from the Wilds: the kill counter now less the one last sent, capped (a counter that went down, or jumped,
    // sends nothing past the cap). { send, mark }: mark is the counter to compare with next time.
    function wildsKillDelta(lastMark, killsNow, cap) {
        const now = Math.max(0, Math.floor(num(killsNow))), last = Math.floor(num(lastMark));
        if (!(lastMark >= 0) || now < last) return { send: 0, mark: now };
        return { send: Math.min(now - last, cap || WILDS_SEND_MAX), mark: now };
    }
    // what a clan's member list shows of someone's Wilds (sent with their stats while they play there): class, arena rating,
    // best wave and monsters defeated, bounded; null for no Wilds save
    function wildsCard(state) {
        if (!isObj(state)) return null;
        const cls = isObj(state.classes) && typeof state.classes.active === 'string' && /^[a-z]{2,16}$/.test(state.classes.active) ? state.classes.active : 'warrior';
        const ar = isObj(state.arena) ? state.arena : {}, st = isObj(state.stats) ? state.stats : {};
        const int = (v, max) => Math.max(0, Math.min(max, Math.floor(num(v))));
        return { cls, r: int(ar.rating || 1000, 99999), wb: int(ar.waveBest, 9999), k: int(st.kills, 1e9) };
    }
    const current = (upcoming, now) => (Array.isArray(upcoming) ? upcoming : []).find((it) => it && toMs(it.start) <= now && toMs(it.end) > now) || null;
    const nextEvent = (upcoming, now) => (Array.isArray(upcoming) ? upcoming : []).find((it) => it && !it.isDowntime && toMs(it.start) > now) || null;

    // ---- ended events ----
    // what last_ended_event keeps for an event that is over (one ended early by an admin ends now, not at its old end time)
    function endedRecord(ev, now) {
        const kind = kindOf(ev);
        if (!kind) return null;
        const rec = { name: String(ev.name || KINDS[kind].name), start: toMs(ev.start), end: Math.min(toMs(ev.end) || now, now), type: KINDS[kind].type };
        if (isObj(ev.result)) rec.result = ev.result;
        return rec;
    }
    // the ended events a last_ended_event document holds, oldest first (older documents hold one, at the top level)
    function history(doc) {
        if (!isObj(doc)) return [];
        const list = Array.isArray(doc.recent) ? doc.recent.slice() : [];
        if (!list.length && doc.start) list.push({ name: doc.name, start: doc.start, end: doc.end, type: doc.type });
        return list.filter((r) => isObj(r) && kindOf(r)).map((r) => Object.assign({}, r, { start: toMs(r.start), end: toMs(r.end) })).sort((a, b) => a.start - b.start);
    }
    // the last_ended_event document with `events` (just ended) added
    function withEnded(doc, events, now) {
        const by = new Map(history(doc).map((r) => [r.start, r]));
        for (const ev of events || []) {
            const rec = endedRecord(ev, now);
            if (rec) by.set(rec.start, Object.assign({}, by.get(rec.start), rec));
        }
        const recent = [...by.values()].sort((a, b) => a.start - b.start).slice(-HISTORY_MAX);
        const top = recent[recent.length - 1];
        return Object.assign({ recent }, top ? { name: top.name, start: top.start, end: top.end, type: top.type } : {});
    }

    // ---- prestiges waiting to be counted (the game reloads straight after a prestige, so they are sent on the next load) ----
    const PENDING_KEY = 'whathappened_prestige_party_pending';
    // the waiting prestiges: their times (an older version stored a bare count, which can't be placed in an event: dropped)
    function readPending(store) {
        try { const v = JSON.parse(store.getItem(PENDING_KEY) || '[]'); return Array.isArray(v) ? v.map(Number).filter((t) => t > 0) : []; } catch (e) { return []; }
    }
    function notePrestige(store, now) {
        const list = readPending(store).filter((t) => now - t < 7 * DAY);
        list.push(now);
        try { store.setItem(PENDING_KEY, JSON.stringify(list.slice(-100))); } catch (e) {}
    }
    // Which Prestige Party each waiting prestige belongs to: { counts: { <start>: n }, keep: [times still unplaced] }.
    // slots: every schedule slot known (upcoming and ended). A prestige in a slot that isn't a Prestige Party, or in one that
    // ended over an hour ago, is dropped; one no known slot covers is kept for a while (the schedule may not be read yet).
    function placePending(times, slots, now) {
        const counts = {}, keep = [];
        for (const t of times) {
            const slot = (slots || []).find((s) => s && toMs(s.start) <= t && t < toMs(s.end));
            if (!slot) { if (now - t < 7 * DAY) keep.push(t); continue; }
            if (kindOf(slot) !== 'pp' || now - toMs(slot.end) > LATE_PRESTIGE_MS) continue;
            const k = String(toMs(slot.start));
            counts[k] = (counts[k] || 0) + 1;
        }
        return { counts, keep };
    }

    // ---- paying a player ----
    const claimKey = (kind, start) => 'whathappened_' + kind + '_claimed_' + toMs(start);
    function claimState(store, kind, start) {
        const k = claimKey(kind, start);
        let paid = null, xp = null;
        try { paid = store.getItem(k); xp = store.getItem(k + '_xp'); } catch (e) {}
        return { paid: !!paid, xp: !!xp, done: !!paid && !!xp };
    }
    // Ended events this player can still be paid for: over for a couple of minutes (the last clicks and prestiges sent in the
    // meantime still count), inside the window, not paid yet, and ended after they joined the clan.
    function collectable(doc, store, now, joinedAt) {
        return history(doc).filter((r) => r.end <= now - SETTLE_MS && now - r.end <= PAY_WINDOW_MS && !(joinedAt && joinedAt > r.end) && !claimState(store, kindOf(r), r.start).done);
    }
    /**
     * Pays this player for every ended event they haven't been paid for. Gems and Clan Points go to the player (io.credit), the
     * clan's XP to the clan once per event (io.awardClanXp, which keeps the record on the clan). A player is only marked paid
     * once the credit really happened; the XP part is retried on the next look if the clan couldn't be updated.
     * io: { now(), store (localStorage), clanId, username, joinedAt, read(name) -> events/<name> data or null,
     *       readClan() -> the clan document or null, credit({ gems, clanPoints }) -> bool, awardClanXp(key, xp) -> bool,
     *       lock(fn) (runs fn alone, across tabs), eventGems(gems, level) }
     * Returns [{ record, kind, reward, xpOk }] for what was paid now. A read that fails leaves that event for next time.
     */
    async function payEnded(io) {
        if (!io || !io.clanId) return [];
        const now = io.now(), cache = {};
        const read = (name) => (name in cache ? cache[name] : (cache[name] = Promise.resolve(io.read(name))));
        let ended;
        try { ended = await read('last_ended_event'); } catch (e) { return []; }
        const todo = collectable(ended, io.store, now, io.joinedAt);
        const out = [];
        for (const rec of todo) {
            try {
                const res = await (io.lock ? io.lock(() => payOne(io, rec, read)) : payOne(io, rec, read));
                if (res) out.push(res);
            } catch (e) { /* that event waits for the next look */ }
        }
        return out;
    }
    async function rewardOf(io, rec, read) {
        const kind = kindOf(rec), K = KINDS[kind];
        const progress = await read(K.doc);
        const metaDoc = K.meta ? await read(K.meta) : null;
        const meta = isObj(metaDoc) && isObj(metaDoc.events) ? metaDoc.events[String(rec.start)] : null;
        const pairing = kind === 'cvc' || kind === 'race' ? pairingFor(rec, await read('pairings')) : null;
        const clan = io.readClan ? await io.readClan() : null;
        const level = typeof io.levelOf === 'function' ? io.levelOf(clan) : 1;
        return rewardFor(kind, rec, { clanId: io.clanId, username: io.username, progress, meta, pairing, clanLevel: level, eventGems: io.eventGems });
    }
    async function payOne(io, rec, read) {
        const kind = kindOf(rec), key = claimKey(kind, rec.start);
        const st = claimState(io.store, kind, rec.start); // again, inside the lock: another tab may have just paid it
        if (st.done) return null;
        const reward = await rewardOf(io, rec, read);
        if (!reward) {
            // nothing earned: remember it, so the event isn't read again
            io.store.setItem(key, '0'); io.store.setItem(key + '_xp', '0');
            return null;
        }
        if (!st.paid) {
            if (!(await io.credit({ gems: reward.gems, clanPoints: reward.clanPoints }))) return null;
            io.store.setItem(key, '1');
        }
        let xpOk = true;
        if (reward.clanXp > 0) xpOk = !!(await io.awardClanXp(kind + '_' + rec.start, reward.clanXp));
        if (xpOk) io.store.setItem(key + '_xp', '1');
        if (st.paid) return null; // only the clan's XP was owed: the player heard about their part before
        return { record: rec, kind, reward, xpOk };
    }
    // the clan document's eventXpAwarded after recording `key` (old entries dropped so the map stays small)
    function withXpAwarded(map, key, keep) {
        const out = Object.assign({}, isObj(map) ? map : {}, { [key]: true });
        const keys = Object.keys(out), max = keep || 40;
        if (keys.length > max) {
            const ms = (k) => Number(String(k).split('_').pop()) || 0;
            keys.sort((a, b) => ms(a) - ms(b)).slice(0, keys.length - max).forEach((k) => { if (k !== key) delete out[k]; });
        }
        return out;
    }

    return {
        DAY, EVENT_MS, DOWNTIME_MS, SCHEDULE_LEN, HISTORY_MAX, PAY_WINDOW_MS, KEEP_PROGRESS_MS, SETTLE_MS, LATE_PRESTIGE_MS, DEFAULT_TYPES, OLD_DEFAULT_TYPES, BOT_ID, BOT, KINDS, REWARDS, TOP3,
        WILDS_SEND_MAX, typesFrom, wildsKillDelta, wildsCard,
        RACE_GOAL, PP_GOAL, GIMMICKS, CHALLENGES, PENDING_KEY, ENDLESS_SCALE, ENDLESS_BASE_HP, BOSS_BASE_HP,
        toMs, kindOf, displayName, gimmick, makeBossMeta, makeEndlessMeta, memberStrength, phaseOf, currentGimmick, bossDamage, endless,
        statsFrom, pickChallenges, challengeFor, challengeProgress, challengePoints,
        blockOf, totalsOf, ranking, contributionPatch, staleKeys,
        pairClans, groupClans, isBot, pairsOf, groupsOf, clansIn, addToPairing, pairingFor, resultOf,
        rewardFor, ordinal, pickType, rollSchedule, skipSchedule, attachResult, upkeepTx, current, nextEvent,
        endedRecord, history, withEnded, readPending, notePrestige, placePending,
        claimKey, claimState, collectable, payEnded, withXpAwarded,
    };
}));
