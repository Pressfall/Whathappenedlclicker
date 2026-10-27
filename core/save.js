/**
 * The main save (localStorage "whathappened_save"): versions and migrations, reading a save safely, checking a save a
 * player imports, and what a prestige keeps. Pure functions, no page needed.
 *
 * Works in a browser (<script src="core/save.js"> sets window.WHSave) and in Node (require).
 */
(function (root, factory) {
    if (typeof module === 'object' && module.exports) module.exports = factory();
    else root.WHSave = factory();
}(typeof self !== 'undefined' ? self : this, function () {
    'use strict';

    const SAVE_KEY = 'whathappened_save';
    const SAVE_KEY_LEGACY = 'whathappened_save_v1';
    const SAVE_VERSION = 3;

    // ---------- migrations ----------
    // MIGRATIONS[n] upgrades a version-n save to version n+1, filling in only fields that are missing.
    const MIGRATIONS = {
        // v2 added the SCP upgrade and its specials
        1(s) {
            if (typeof s.upgrade17Level === 'undefined') s.upgrade17Level = 0;
            if (typeof s.upgrade17Cost === 'undefined') s.upgrade17Cost = 700000000000;
            for (const f of ['scp1Purchased', 'scp2Purchased', 'scp3Purchased', 'scp4Purchased']) if (typeof s[f] === 'undefined') s[f] = false;
            if (typeof s.scpMultiplier === 'undefined') s.scpMultiplier = 1;
        },
        // v3 changed no stored fields (prices are recomputed from levels when a save loads)
        2() {},
    };

    function isPlainObject(v) { return v !== null && typeof v === 'object' && !Array.isArray(v); }

    // A copy of `save` brought up to SAVE_VERSION. A save with no version is version 1. Never throws; a save from a
    // newer game is returned as it is (its version is left alone).
    function migrateSave(save) {
        const s = Object.assign({}, save);
        let v = Number(s.version);
        if (!Number.isInteger(v) || v < 1) v = 1;
        if (v >= SAVE_VERSION) { s.version = v; return s; }
        for (; v < SAVE_VERSION; v++) {
            try { if (MIGRATIONS[v]) MIGRATIONS[v](s); } catch (e) { /* keep going: a missing default beats a lost save */ }
        }
        s.version = SAVE_VERSION;
        return s;
    }

    // Read the text of a stored save. { ok: true, save } or { ok: false, reason: 'empty' | 'unreadable' | 'not-a-save' }.
    function parseSave(raw) {
        if (raw === null || raw === undefined || raw === '') return { ok: false, reason: 'empty' };
        let obj;
        try { obj = JSON.parse(raw); } catch (e) { return { ok: false, reason: 'unreadable' }; }
        if (!isPlainObject(obj)) return { ok: false, reason: 'not-a-save' };
        return { ok: true, save: obj };
    }

    // ---------- checking an imported save ----------
    const NUMBER_FIELDS = /^(count|baseClickPower|clickMultiplier|goldenWhat|totalGoldenEver|prestigeTimes|diamonds|clanPoints|upgrade\d+Level|divine\w+Level)$/;
    const COST_FIELDS = /^(upgrade\d+Cost|divine\w+Cost)$/;
    const FLAG_FIELDS = /Purchased$/;
    // a stored number is a finite number, or a string holding one ("1.5e+30")
    function isNumeric(v) {
        if (typeof v === 'number') return Number.isFinite(v);
        if (typeof v === 'string' && v.trim() !== '') return Number.isFinite(Number(v));
        return false;
    }

    // { ok, errors, warnings } for a parsed main save. Errors mean "do not import this"; warnings are worth showing.
    function validateSave(save) {
        const errors = [], warnings = [];
        if (!isPlainObject(save)) return { ok: false, errors: ['This is not a game save.'], warnings };
        const version = save.version === undefined ? 1 : save.version;
        if (!Number.isInteger(version) || version < 1) errors.push('The save has an invalid version number.');
        else if (version > SAVE_VERSION) errors.push('This save is from a newer version of the game. Update the game first.');
        for (const k of Object.keys(save)) {
            const v = save[k];
            if (NUMBER_FIELDS.test(k)) {
                if (!isNumeric(v)) errors.push(`"${k}" is not a number.`);
                else if (Number(v) < 0) errors.push(`"${k}" is negative.`);
            } else if (COST_FIELDS.test(k)) {
                if (!isNumeric(v)) warnings.push(`"${k}" is not a number; the game will recalculate it.`);
            } else if (FLAG_FIELDS.test(k) && typeof v !== 'boolean') {
                warnings.push(`"${k}" should be true or false.`);
            }
            if (errors.length >= 10) { errors.push('...and more.'); break; }
        }
        if (!('count' in save) && !Object.keys(save).some((k) => /^upgrade\d+Level$/.test(k))) errors.push('This does not look like a game save (no count or upgrades).');
        return { ok: errors.length === 0, errors, warnings };
    }

    // ---------- prestige ----------
    // What a prestige carries over. Everything else in the save (count, upgrade levels and prices, specials, multipliers)
    // starts again. Progress kept in other localStorage keys (followers, items, achievements, titles) is not part of the
    // main save and is never touched.
    const PRESTIGE_KEEP = [
        'goldenWhat', 'prestigeTimes', 'totalGoldenEver', 'goldenThreshold', 'divineUnlocked',
        'divineArgonLevel', 'divineArgonCost', 'divineArgonPercent',
        'divineSomalianLevel', 'divineSomalianCost',
        'divineCollectorLevel', 'divineCollectorCost',
        'divineAssassinLevel', 'divineAssassinCost',
        'divineMoneyManLevel', 'divineMoneyManCost',
        'divineSpiritLevel', 'divineSpiritCost',
        'divineSimpleVillagerLevel', 'divineSimpleVillagerCost',
        'divineBrileyismLevel', 'divineBrileyismCost',
        'diamonds', 'clanPoints',
        'musicVolume', 'musicMuted', 'sfxVolume', 'sfxMuted', 'musicOwned', 'currentMusicTrack',
        'shopDivinePurchased', 'shopPlatinumPurchased', 'shopDivineWHPurchased', 'shopWHVrillPurchased', 'shopWHNaturePurchased',
        'shopVoidWHPurchased', 'shopFireWHPurchased', 'shopIceWHPurchased', 'shopWHhackerPurchased', 'shopWHchadPurchased',
        'shopWHbreadPurchased', 'shopWHlightningPurchased', 'shopSilverPurchased', 'shopGoldPurchased',
        'shopMobileManPurchased', 'shopCasinoDealerPurchased', 'shopBgPurchased', 'shopCollectionBgPurchased', 'shopWHBWPurchased',
        'equippedShopImage', 'equippedBgImage',
        // owned by the casino page: dropping them let players re-spin the same day
        'casinoSpin', 'casino_total_wins',
    ];

    // The save to store when prestiging: the kept fields of `current` (the save as it is now), plus the new Golden.
    // The page reloads and loads this; `prestige: true` tells loadGame to pay Divine Money Man's head start.
    function buildPrestigeSave(current, awards, now) {
        const cur = isPlainObject(current) ? current : {};
        const out = { version: SAVE_VERSION };
        for (const k of PRESTIGE_KEEP) if (cur[k] !== undefined) out[k] = cur[k];
        const golden = (Number(cur.goldenWhat) || 0) + awards;
        out.goldenWhat = golden;
        out.prestigeTimes = (Number(cur.prestigeTimes) || 0) + 1;
        out.totalGoldenEver = (Number(cur.totalGoldenEver) || 0) + awards;
        if (golden >= 1) out.divineUnlocked = true;
        out.prestige = true;
        out.lastSaved = now;
        return out;
    }

    return { SAVE_KEY, SAVE_KEY_LEGACY, SAVE_VERSION, migrateSave, parseSave, validateSave, PRESTIGE_KEEP, buildPrestigeSave, isPlainObject };
}));
