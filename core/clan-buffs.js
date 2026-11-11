/**
 * Clan buffs (bought with Clan Points in the clan shop): what each one does, which of a clan's buffs are running, and what
 * putting Clan Points into one changes.
 *
 * The clan document in Firestore says WHICH buffs are active and until when. It is written by every member's browser, so
 * what a buff DOES (its multipliers) and how long one can run must never be read from it: a forged "cpsMult: 1e30" would
 * otherwise multiply the income of everyone in the clan. The numbers come from the table below, whatever the document says.
 * This table is the only one: the clan shop (clan-page.js) shows it and main.js applies it.
 *
 * Works in a browser (<script src="core/clan-buffs.js"> sets window.WHClanBuffs) and in Node (require).
 */
(function (root, factory) {
    if (typeof module === 'object' && module.exports) module.exports = factory();
    else root.WHClanBuffs = factory();
}(typeof self !== 'undefined' ? self : this, function () {
    'use strict';

    const BUFFS = [
        { id: 'cps_double_1h', icon: '⚡', name: 'Double CPS', description: '2× CPS for the whole clan for 1 hour.', cpCost: 800, durationMs: 60 * 60 * 1000, cpsMult: 2, clickMult: 1 },
        { id: 'click_double_30m', icon: '👆', name: 'Double Click Power', description: '2× click power for the whole clan for 30 minutes.', cpCost: 500, durationMs: 30 * 60 * 1000, cpsMult: 1, clickMult: 2 },
        { id: 'both_triple_20m', icon: '🔥', name: 'Triple Everything', description: '3× CPS and 3× click power for the whole clan for 20 minutes.', cpCost: 1200, durationMs: 20 * 60 * 1000, cpsMult: 3, clickMult: 3 },
    ];
    const BY_ID = {};
    BUFFS.forEach((b) => { BY_ID[b.id] = b; });
    const byId = (id) => (Object.prototype.hasOwnProperty.call(BY_ID, id) ? BY_ID[id] : null);
    // Refilling a running buff adds its duration on top, so several can queue up; nothing past a day ahead counts
    const MAX_REMAINING_MS = 24 * 60 * 60 * 1000;

    const toMs = (v) => (typeof v === 'number' ? v : (v && typeof v.toMillis === 'function' ? v.toMillis() : 0));
    const isObj = (v) => !!v && typeof v === 'object' && !Array.isArray(v);

    // The buffs running at `now`, from a clan document: [{ id, name, cpsMult, clickMult, expiresAt }].
    // Unknown ids are ignored; the end time is taken from the document but never trusted past MAX_REMAINING_MS.
    function resolveActive(clanDoc, now) {
        const out = [];
        if (!clanDoc || typeof clanDoc !== 'object') return out;
        const seen = {};
        const add = (id, entry) => {
            const def = byId(id);
            if (!def || seen[id] || !entry || typeof entry !== 'object') return;
            const expiresAt = Math.min(toMs(entry.expiresAt), now + MAX_REMAINING_MS);
            if (!(expiresAt > now)) return;
            seen[id] = true;
            out.push({ id, name: def.name, cpsMult: def.cpsMult, clickMult: def.clickMult, expiresAt });
        };
        const map = isObj(clanDoc.activeBuffs) ? clanDoc.activeBuffs : {};
        for (const id of Object.keys(map)) add(id, map[id]);
        // clans that have not bought a buff since activeBuffs was added only have the single activeBuff field
        const legacy = clanDoc.activeBuff;
        if (legacy && typeof legacy === 'object' && typeof legacy.id === 'string') add(legacy.id, legacy);
        return out;
    }

    // The CPS and click multipliers of everything running at `now` (different buffs multiply together)
    function multipliers(active, now) {
        let cps = 1, click = 1;
        (Array.isArray(active) ? active : []).forEach((b) => { if (b && b.expiresAt > now) { cps *= b.cpsMult; click *= b.clickMult; } });
        return { cps, click };
    }

    // how long `buffId` still runs in a clan document (0 if it isn't), as the game would count it
    function remainingMs(clanDoc, buffId, now) {
        const b = resolveActive(clanDoc, now).find((x) => x.id === buffId);
        return b ? b.expiresAt - now : 0;
    }
    // CP still needed to fill a buff's bar in a clan document
    function stillNeeded(clanDoc, buffId) {
        const def = byId(buffId);
        if (!def) return 0;
        const have = Number(isObj(clanDoc && clanDoc.buffProgress) ? clanDoc.buffProgress[buffId] : 0) || 0;
        return Math.max(0, def.cpCost - have);
    }
    // whether filling the bar now would still count in full (a buff can't queue up more than a day ahead)
    function roomToQueue(clanDoc, buffId, now) {
        const def = byId(buffId);
        return !!def && remainingMs(clanDoc, buffId, now) + def.durationMs <= MAX_REMAINING_MS;
    }

    // Putting `amount` Clan Points into a buff, from `donor`, against the clan document as it is now (inside a transaction).
    // Returns { ok: true, updates, activated, expiresAt } (the fields to write), or { ok: false, reason }:
    // 'buff' (no such buff), 'amount' (not a whole number of CP), 'queue' (filling it would run past a day ahead).
    function contribute(clanDoc, buffId, amount, donor, now) {
        const def = byId(buffId);
        if (!def) return { ok: false, reason: 'buff' };
        const amt = Math.floor(Number(amount));
        if (!(amt >= 1)) return { ok: false, reason: 'amount' };
        const d = isObj(clanDoc) ? clanDoc : {};
        const progress = Object.assign({}, isObj(d.buffProgress) ? d.buffProgress : {});
        let next = (Number(progress[buffId]) || 0) + amt;
        const updates = {};
        let activated = false, expiresAt = 0;
        if (next >= def.cpCost) {
            if (!roomToQueue(d, buffId, now)) return { ok: false, reason: 'queue' };
            next -= def.cpCost;
            // only buffs we know and that still run are kept (the old entries' multipliers are left out on purpose)
            const map = {};
            for (const b of resolveActive({ activeBuffs: d.activeBuffs }, now)) map[b.id] = { expiresAt: b.expiresAt };
            expiresAt = Math.max(now, map[buffId] ? map[buffId].expiresAt : 0) + def.durationMs;
            map[buffId] = { expiresAt, cpsMult: def.cpsMult, clickMult: def.clickMult };
            updates.activeBuffs = map;
            // pages from before activeBuffs only read activeBuff
            updates.activeBuff = { id: buffId, expiresAt, cpsMult: def.cpsMult, clickMult: def.clickMult };
            activated = true;
        }
        progress[buffId] = next;
        updates.buffProgress = progress;
        const donated = Object.assign({}, isObj(d.cpDonated) ? d.cpDonated : {});
        const who = String(donor || 'Someone').slice(0, 32);
        donated[who] = (Number(donated[who]) || 0) + amt;
        updates.cpDonated = donated;
        return { ok: true, updates, activated, expiresAt };
    }

    return { BUFFS, MAX_REMAINING_MS, byId, resolveActive, multipliers, remainingMs, stillNeeded, roomToQueue, contribute };
}));
