/**
 * Clan levels and the daily check-in: the XP curve (level 2 at 200 XP, each further level 1.55x the one before, up to 20),
 * the perks each level gives, and the check-in's Clan Points. One table for both pages: main.js applies the perks to CPS,
 * click power and event gems, the clan page shows them. (Before this file each page had its own copy.)
 *
 * A clan's XP is written by its members' browsers (docs/trust-boundaries.md), so a forged number can only move a clan along
 * this fixed table: never past level 20, never to a perk that isn't in it.
 *
 * Works in a browser (<script src="core/clan-levels.js"> sets window.WHClanLevels) and in Node (require).
 */
(function (root, factory) {
    if (typeof module === 'object' && module.exports) module.exports = factory();
    else root.WHClanLevels = factory();
}(typeof self !== 'undefined' ? self : this, function () {
    'use strict';

    const MAX_LEVEL = 20, XP_BASE = 200, XP_GROWTH = 1.55;
    // TOTAL[L]: the XP a clan needs to be level L (TOTAL[1] = 0)
    const TOTAL = [0, 0];
    for (let L = 1; L < MAX_LEVEL; L++) TOTAL[L + 1] = TOTAL[L] + XP_BASE * Math.pow(XP_GROWTH, L - 1);

    // { level, xpInLevel, xpForNext (0 at the top), pct (0-100 of the way to the next level) } for an XP total
    function levelInfo(xp) {
        const x = Math.max(0, Number(xp) || 0);
        let level = 1;
        while (level < MAX_LEVEL && x >= TOTAL[level + 1]) level++;
        const xpInLevel = x - TOTAL[level], xpForNext = level < MAX_LEVEL ? TOTAL[level + 1] - TOTAL[level] : 0;
        return { level, xpInLevel, xpForNext, pct: xpForNext ? Math.min(100, xpInLevel / xpForNext * 100) : 100 };
    }
    function levelFromXp(xp) { return levelInfo(xp).level; }
    function xpForLevel(level) { return TOTAL[Math.max(1, Math.min(MAX_LEVEL, Math.floor(Number(level) || 1)))]; }

    // % CPS, % click power and % event gems, by level (index = level)
    const PERKS = [
        null,
        { cps: 0, click: 0, event: 0 }, { cps: 2, click: 0, event: 0 }, { cps: 2, click: 2, event: 0 }, { cps: 4, click: 2, event: 1 },
        { cps: 5, click: 2, event: 1 }, { cps: 6, click: 3, event: 2 }, { cps: 8, click: 4, event: 2 }, { cps: 10, click: 5, event: 3 },
        { cps: 12, click: 6, event: 3 }, { cps: 15, click: 8, event: 5 }, { cps: 18, click: 10, event: 5 }, { cps: 20, click: 12, event: 6 },
        { cps: 24, click: 14, event: 6 }, { cps: 28, click: 16, event: 8 }, { cps: 32, click: 18, event: 8 }, { cps: 36, click: 20, event: 10 },
        { cps: 40, click: 22, event: 10 }, { cps: 45, click: 25, event: 12 }, { cps: 50, click: 28, event: 12 }, { cps: 55, click: 30, event: 15 },
    ];
    function perk(level) { return PERKS[Math.max(1, Math.min(MAX_LEVEL, Math.floor(Number(level) || 1)))]; }
    function perkParts(p) {
        const out = [];
        if (p && p.cps) out.push('+' + p.cps + '% CPS');
        if (p && p.click) out.push('+' + p.click + '% click power');
        if (p && p.event) out.push('+' + p.event + '% event gems');
        return out;
    }
    function perkText(p) { return perkParts(p).join(', ') || 'No bonus yet'; }
    // event gems with the clan's level bonus on top
    function eventGems(gems, level) { const g = Math.max(0, Number(gems) || 0); return g ? Math.round(g * (1 + perk(level).event / 100)) : 0; }

    // ---- the daily check-in (days are UTC, so the whole clan shares the same day) ----
    const CHECKIN_XP = 25;
    const CHECKIN_CP_BASE = 5, CHECKIN_CP_STEP = 2, CHECKIN_STREAK_CAP = 6;
    // Clan Points for a check-in on day `streak` of a streak: 5, then +2 a day, up to 15 from day 6
    function checkinReward(streak) { return CHECKIN_CP_BASE + CHECKIN_CP_STEP * Math.min(Math.max(0, (Number(streak) || 1) - 1), CHECKIN_STREAK_CAP - 1); }
    function utcDay(ms, offsetDays) { return new Date(Number(ms) + (offsetDays || 0) * 864e5).toISOString().slice(0, 10); }
    // the streak a check-in today makes, from the stored { day, streak, best } (whathappened_clan_checkin)
    function nextStreak(state, now) {
        const st = state && typeof state === 'object' ? state : {};
        const today = utcDay(now), yesterday = utcDay(now, -1);
        if (st.day === today) return Math.max(1, Number(st.streak) || 1);
        return st.day === yesterday ? (Number(st.streak) || 0) + 1 : 1;
    }
    // the streak shown today (0 when it has lapsed)
    function currentStreak(state, now) {
        const st = state && typeof state === 'object' ? state : {};
        return st.day === utcDay(now) || st.day === utcDay(now, -1) ? (Number(st.streak) || 0) : 0;
    }

    return { MAX_LEVEL, XP_BASE, XP_GROWTH, PERKS, levelInfo, levelFromXp, xpForLevel, perk, perkParts, perkText, eventGems,
        CHECKIN_XP, checkinReward, utcDay, nextStreak, currentStreak };
}));
