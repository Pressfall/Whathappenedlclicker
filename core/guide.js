/**
 * The first-run guide: what a new player should do next, worked out from their progress. Pure: guide.js reads the
 * game and draws the card, this decides what it says.
 *
 * Works in a browser (<script src="core/guide.js"> sets window.WHGuide) and in Node (require).
 */
(function (root, factory) {
    if (typeof module === 'object' && module.exports) module.exports = factory();
    else root.WHGuide = factory();
}(typeof self !== 'undefined' ? self : this, function () {
    'use strict';

    const VETERAN_LEVELS = 1500;  // total upgrade levels worth one Golden: by then the player knows their way around
    const PRESTIGE_UPGRADE = 12;  // CR lurker
    const PRESTIGE_LEVEL = 150;   // CR lurker level that unlocks Prestige

    /**
     * @param {object} s
     * @param {number[]} s.levels        level of each upgrade, indexed by upgrade number (index 0 unused)
     * @param {string[]} s.names         name of each upgrade, same indexing
     * @param {Array<number|string>} [s.costs]  price of the next level of each upgrade, same indexing
     * @param {{name,upgrade,upgradeName,level,owned}[]} s.specials   every special: the upgrade it belongs to, the level that unlocks it
     * @param {number} s.count            What Happeneds now
     * @param {number} s.clicks           lifetime clicks
     * @param {number} s.prestiges        times prestiged
     * @param {number} s.golden           Golden now
     * @param {number} s.prestigeAwards   Golden a prestige would give right now
     * @param {boolean} s.dismissed       the player closed the guide
     */
    function plan(s) {
        const level = (i) => Number(s.levels && s.levels[i]) || 0;
        const totalLevels = (s.levels || []).reduce((a, v) => a + (Number(v) || 0), 0);
        const specials = Array.isArray(s.specials) ? s.specials : [];
        const ownedSpecials = specials.filter((sp) => sp.owned).length;
        const firstOpSpecial = Math.min(...specials.filter((sp) => sp.upgrade === 1).map((sp) => sp.level), 10);

        const steps = [
            { id: 'click', label: 'Click the image to earn What Happeneds', done: (s.clicks || 0) > 0 || (Number(s.count) || 0) > 0 || totalLevels > 0 },
            { id: 'mouse', label: 'Buy your first OP mouse upgrade (more per click)', done: level(1) >= 1 },
            { id: 'pirate', label: 'Buy a Somalian Pirate, so you earn while you are not clicking', done: level(2) >= 1 },
            { id: 'level', label: `Raise OP mouse to level ${firstOpSpecial} to unlock your first special`, done: level(1) >= firstOpSpecial },
            { id: 'special', label: 'Open Specials and buy one', done: ownedSpecials >= 1 },
        ];
        const current = steps.findIndex((st) => !st.done);
        steps.forEach((st, i) => { st.current = i === current; });

        // the special you are closest to unlocking, among upgrades you already own
        let nextSpecial = null;
        for (const sp of specials) {
            if (sp.owned || level(sp.upgrade) < 1 || level(sp.upgrade) >= sp.level) continue;
            const remaining = sp.level - level(sp.upgrade);
            if (!nextSpecial || remaining < nextSpecial.remaining || (remaining === nextSpecial.remaining && sp.upgrade < nextSpecial.upgrade)) {
                nextSpecial = { kind: 'special', name: sp.name, upgrade: sp.upgrade, upgradeName: sp.upgradeName, level: sp.level, remaining };
            }
        }
        let nextUnlock = nextSpecial;
        if (level(PRESTIGE_UPGRADE) >= PRESTIGE_LEVEL && (s.prestigeAwards || 0) > 0) nextUnlock = { kind: 'prestige-ready', awards: s.prestigeAwards };
        else if (!nextUnlock && level(PRESTIGE_UPGRADE) >= 1) nextUnlock = { kind: 'prestige', upgradeName: (s.names || [])[PRESTIGE_UPGRADE] || 'CR lurker', level: PRESTIGE_LEVEL, remaining: Math.max(0, PRESTIGE_LEVEL - level(PRESTIGE_UPGRADE)) };

        // the first upgrade you have not bought yet
        let nextUpgrade = null;
        const names = s.names || [];
        for (let i = 1; i < names.length; i++) {
            if (level(i) === 0) { nextUpgrade = { kind: 'upgrade', upgrade: i, name: names[i], cost: s.costs ? s.costs[i] : undefined }; break; }
        }

        const veteran = totalLevels >= VETERAN_LEVELS || (s.prestiges || 0) > 0 || (s.golden || 0) > 0;
        return {
            visible: !s.dismissed && !veteran,
            veteran,
            steps,
            allDone: current === -1,
            nextUnlock,
            nextUpgrade,
        };
    }

    return { plan, VETERAN_LEVELS };
}));
