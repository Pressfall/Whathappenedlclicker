/**
 * Game calculations that need no page: price curves, bulk buying, level milestones, Divine costs, prestige awards and
 * offline earnings. main.js calls these (it keeps thin wrappers with the old names); tests/ run them on their own.
 *
 * Works in a browser (<script src="core/calc.js"> sets window.WHCalc) and in Node (require).
 * WHCalc.create(Decimal) returns the functions. The live site passes nothing and runs on plain Numbers (index.html
 * loads no big-number library); pass a Decimal class to get the same functions on Decimal values.
 */
(function (root, factory) {
    if (typeof module === 'object' && module.exports) module.exports = factory();
    else root.WHCalc = factory();
}(typeof self !== 'undefined' ? self : this, function () {
    'use strict';

    function create(DecimalLib) {
        const hasDecimal = typeof DecimalLib === 'function';
        const D = (v) => (hasDecimal ? new DecimalLib(v) : Number(v));
        const isDecimalInstance = (x) => hasDecimal && x instanceof DecimalLib;

        // A Number or Decimal for `n`; `fallback` when it is not finite.
        function safeNum(n, fallback = 0) {
            if (hasDecimal) {
                try {
                    const cand = isDecimalInstance(n) ? n : D(n);
                    if (cand && typeof cand.isFinite === 'function') return cand.isFinite() ? cand : (isDecimalInstance(fallback) ? fallback : D(fallback));
                    return cand;
                } catch (e) {
                    return isDecimalInstance(fallback) ? fallback : D(fallback);
                }
            }
            const num = Number(n);
            return Number.isFinite(num) ? num : fallback;
        }
        const toNumber = (v) => Number(isDecimalInstance(v) ? v.toNumber() : safeNum(v, 0)) || 0;

        // ---------- prices ----------
        // The next level's price: this one x rate, rounded up. The one definition of the price curve.
        function stepCost(cost, rate) {
            return hasDecimal ? D(cost).times(D(rate)).ceil() : Math.ceil(Number(cost) * Number(rate));
        }
        // Price of the next level of an upgrade at `level`: its base price stepped once per level.
        function costAtLevel(baseCost, rate, level) {
            let c = baseCost;
            const L = Math.floor(toNumber(level));
            for (let n = 0; n < L && isFinite(c); n++) c = Math.ceil(c * rate);
            return hasDecimal ? D(c) : c;
        }
        // Total price of `batch` levels starting at currentCost (before any Divine Simple Villager discount).
        function computeBatchCost(currentCost, batch, rate) {
            const b = Math.max(1, Math.floor(safeNum(batch, 1)));
            if (hasDecimal) {
                let total = D(0);
                let temp = D(safeNum(currentCost, 0));
                const r = D(safeNum(rate, 1.1));
                for (let i = 0; i < b; i++) {
                    total = total.plus(temp);
                    temp = temp.times(r).ceil();
                }
                return total;
            }
            let total = 0;
            let temp = safeNum(currentCost, 0);
            const r = safeNum(rate, 1.1);
            for (let i = 0; i < b; i++) {
                total += temp;
                temp = Math.ceil(temp * r);
            }
            return total;
        }
        // How many levels `have` pays for (Max mode), with prices multiplied by `discount`. Stops at `cap`.
        function maxAffordableLevels(currentCost, rate, have, discount = 1, cap = 1000) {
            const money = Number(have) || 0;
            let n = 0, total = 0, temp = Number(currentCost) || 0;
            while (n < cap) {
                total += temp * discount;
                if (total > money) break;
                temp = Math.ceil(temp * rate);
                n++;
            }
            return n;
        }

        // ---------- level milestones ----------
        // Multiplier an upgrade gets from its level. Past 500: x2 per 25 levels, x4 per 100 (beyond 500), x10 per 1000.
        function computeLevelMultiplier(level) {
            const lv = toNumber(level);
            if (lv <= 500) return 1;
            const n25 = Math.floor((lv - 500) / 25);
            const n100 = Math.max(0, Math.floor(lv / 100) - 5);
            const n1000 = Math.floor(lv / 1000);
            return Math.pow(2, n25) * Math.pow(4, n100) * Math.pow(10, n1000);
        }
        // The next level (above `level`) that adds a milestone multiplier, and that multiplier: { level, boost } or null.
        function getNextMilestone(level) {
            const lv = toNumber(level);
            if (lv < 500) return null;
            const next25 = 500 + (Math.floor((lv - 500) / 25) + 1) * 25;
            const next100 = (Math.floor(lv / 100) + 1) * 100;
            const next1000 = (Math.floor(lv / 1000) + 1) * 1000;
            const candidates = [next25, next100, next1000].filter((n) => n > lv);
            if (candidates.length === 0) return null;
            const next = Math.min(...candidates);
            if (next % 1000 === 0) return { level: next, boost: 10 };
            if (next % 100 === 0) return { level: next, boost: 4 };
            if (next % 25 === 0) return { level: next, boost: 2 };
            return null;
        }

        // ---------- Divine ----------
        function fibNumber(n) {
            const nn = Math.max(1, Math.floor(n));
            let a = hasDecimal ? D(1) : 1, b = hasDecimal ? D(2) : 2;
            if (nn === 1) return a;
            if (nn === 2) return b;
            for (let i = 3; i <= nn; i++) {
                const c = hasDecimal ? a.plus(b) : a + b;
                a = b; b = c;
            }
            return b;
        }
        // Golden price of the next level of a Divine upgrade.
        //  Argonian / Somalian: x3 per level. Assassin: 1, 2, 3... Collector / Simple Villager: x1.6 per level.
        //  Money Man: 1, 2, 3, 5, 9, 17... Spirit: Fibonacci 1, 2, 3, 5, 8... Brileyism: 2, 4, 6, 9, 14, 21... (x1.6 per level)
        function divineCostFor(kind, level) {
            const L = Math.max(0, Math.floor(Number(level) || 0));
            switch (kind) {
                case 'argon': case 'somalian': return Math.pow(3, L);
                case 'assassin': return L + 1;
                case 'collector': case 'villager': return Math.ceil(Math.pow(1.6, L));
                case 'moneyMan': return L === 0 ? 1 : Math.pow(2, L - 1) + 1;
                case 'spirit': return fibNumber(L + 1);
                case 'brileyism': return Math.ceil(2 * Math.pow(1.6, L));
                default: return 1;
            }
        }

        // ---------- prestige ----------
        // Upgrade levels needed per Golden. Divine Collector and Void followers shrink it before rounding down, so a
        // 25% bonus is worth something even when you'd only earn one Golden.
        function levelsPerGolden(baseLevels, collectorBonus, followerGoldenPercent, godGoldenPercent) {
            let mult = 1 + (Number(collectorBonus) || 0);
            mult *= 1 + (Number(followerGoldenPercent) || 0) / 100;
            mult *= 1 + (Number(godGoldenPercent) || 0) / 100;
            return baseLevels / mult;
        }
        // Golden for prestiging now. The tiny epsilon keeps e.g. 1200 levels x 1.25 from floating down to 0.9999.
        function prestigeAwards(totalLevels, perGolden) {
            return Math.floor(totalLevels / perGolden + 1e-9);
        }

        // ---------- offline earnings ----------
        const MAX_OFFLINE_SECONDS = 60 * 60 * 24;
        // Whole seconds to pay for after being away, capped at 24 hours. 0 when lastSaved is missing, invalid or in the future.
        function offlineSeconds(lastSaved, now, cap = MAX_OFFLINE_SECONDS) {
            const last = lastSaved ? Number(lastSaved) : null;
            if (!last || isNaN(last)) return 0;
            const elapsed = Math.floor((now - last) / 1000);
            return Math.max(0, Math.min(elapsed, cap));
        }
        // CPS to pay while away (plain Numbers). It is the live CPS formula without temporary boosts (casino, clan shop,
        // consumables), plus the clan level perk and the offline bonus from followers and charms.
        function offlineCps(p) {
            const one = (v) => (v === undefined ? 1 : v);
            const other = p.otherEffective * (p.diddyOther || 1) * (p.argonOther || 1) * (p.grapeOther || 1) * (p.skippieOther || 1) * (p.islandOther || 1) * (p.tribalOther || 1)
                + p.jonathanEffective * (p.jonathanOther || 1)
                + p.crEffective * (p.crOther || 1)
                + (p.phonkBaseCps || 0) * (p.phonkOther || 1);
            // multiplied one at a time, in this order, so the result matches the original floating-point arithmetic exactly
            let cps = p.pirateEffective * (p.pirateMultiplier || 1) + other * one(p.goonMultiplier);
            for (const m of [p.diddyMultiplier, p.argonMultiplier, p.grapeMultiplier, p.skippieMultiplier, p.islandMultiplier, p.tribalMultiplier, p.phonkMultiplier]) cps = cps * one(m);
            cps = cps * (1 + (p.golden || 0) * 0.1) * (p.divineCpsMult === undefined ? 1 : p.divineCpsMult);
            cps = cps * (1 + (p.clanPerkPercent || 0) / 100);
            cps = cps * (1 + (p.followerCpsPercent || 0) / 100) * (1 + (p.followerOfflinePercent || 0) / 100);
            cps = cps * (1 + (p.itemCpsPercent || 0) / 100) * (1 + (p.itemOfflinePercent || 0) / 100);
            if (p.godCpsPercent || p.godOfflinePercent) cps = cps * (1 + (p.godCpsPercent || 0) / 100) * (1 + (p.godOfflinePercent || 0) / 100);
            return cps;
        }

        return {
            hasDecimal, safeNum, stepCost, costAtLevel, computeBatchCost, maxAffordableLevels,
            computeLevelMultiplier, getNextMilestone, fibNumber, divineCostFor,
            levelsPerGolden, prestigeAwards, MAX_OFFLINE_SECONDS, offlineSeconds, offlineCps,
        };
    }

    return { create };
}));
