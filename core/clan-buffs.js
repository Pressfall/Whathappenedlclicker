/**
 * Clan buffs (bought with Clan Points in the clan shop): what each one does, and which of a clan's buffs are running.
 *
 * The clan document in Firestore says WHICH buffs are active and until when. It is written by every member's browser, so
 * what a buff DOES (its multipliers) and how long one can run must never be read from it: a forged "cpsMult: 1e30" would
 * otherwise multiply the income of everyone in the clan. The numbers come from the table below, whatever the document says.
 *
 * Works in a browser (<script src="core/clan-buffs.js"> sets window.WHClanBuffs) and in Node (require).
 */
(function (root, factory) {
    if (typeof module === 'object' && module.exports) module.exports = factory();
    else root.WHClanBuffs = factory();
}(typeof self !== 'undefined' ? self : this, function () {
    'use strict';

    // Keep in step with CLAN_BUFFS in clan.html (tests/clan-buffs.test.js checks they agree).
    const BUFFS = [
        { id: 'cps_double_1h', name: 'Double CPS', cpCost: 800, durationMs: 60 * 60 * 1000, cpsMult: 2, clickMult: 1 },
        { id: 'click_double_30m', name: 'Double Click Power', cpCost: 500, durationMs: 30 * 60 * 1000, cpsMult: 1, clickMult: 2 },
        { id: 'both_triple_20m', name: 'Triple Everything', cpCost: 1200, durationMs: 20 * 60 * 1000, cpsMult: 3, clickMult: 3 },
    ];
    const BY_ID = {};
    BUFFS.forEach((b) => { BY_ID[b.id] = b; });
    // Refilling a running buff adds its duration on top, so several can queue up; a day is far beyond any real chain.
    const MAX_REMAINING_MS = 24 * 60 * 60 * 1000;

    const toMs = (v) => (typeof v === 'number' ? v : (v && typeof v.toMillis === 'function' ? v.toMillis() : 0));

    // The buffs running at `now`, from a clan document: [{ id, name, cpsMult, clickMult, expiresAt }].
    // Unknown ids are ignored; the end time is taken from the document but never trusted past MAX_REMAINING_MS.
    function resolveActive(clanDoc, now) {
        const out = [];
        if (!clanDoc || typeof clanDoc !== 'object') return out;
        const seen = {};
        const add = (id, entry) => {
            const def = Object.prototype.hasOwnProperty.call(BY_ID, id) ? BY_ID[id] : null;
            if (!def || seen[id] || !entry || typeof entry !== 'object') return;
            const expiresAt = Math.min(toMs(entry.expiresAt), now + MAX_REMAINING_MS);
            if (!(expiresAt > now)) return;
            seen[id] = true;
            out.push({ id, name: def.name, cpsMult: def.cpsMult, clickMult: def.clickMult, expiresAt });
        };
        const map = (clanDoc.activeBuffs && typeof clanDoc.activeBuffs === 'object') ? clanDoc.activeBuffs : {};
        for (const id of Object.keys(map)) add(id, map[id]);
        // clans that have not bought a buff since activeBuffs was added only have the single activeBuff field
        const legacy = clanDoc.activeBuff;
        if (legacy && typeof legacy === 'object' && typeof legacy.id === 'string') add(legacy.id, legacy);
        return out;
    }

    return { BUFFS, MAX_REMAINING_MS, resolveActive };
}));
