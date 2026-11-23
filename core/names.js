/**
 * One name for chat and the Wilds (the owner's ask, 2026-11-20). The chat name (localStorage player_username: global chat,
 * clans, the leaderboard, the profile) and the Wilds' name (whathappened_world_name: what other players see over your head)
 * are kept the same. When both are there and differ, the Wilds' name wins; an automatic Wilds name ("Adventurer1234",
 * given before you chose one) never does. A name has to fit the Wilds' rules to be both: 2-16 letters, digits, spaces,
 * _ . or - (core/world-online.js sanitizeName). An older chat name that doesn't fit stays your chat name until a Wilds name
 * replaces it.
 *
 * Loaded by index.html, world.html and clan.html (window.WHNames); works in Node too. store: localStorage, or anything with
 * getItem / setItem.
 */
(function (root, factory) {
    if (typeof module === 'object' && module.exports) module.exports = factory();
    else root.WHNames = factory();
}(typeof self !== 'undefined' ? self : this, function () {
    'use strict';
    const WILDS_KEY = 'whathappened_world_name';
    const CHAT_KEY = 'player_username';
    const AUTO_RE = /^Adventurer\d{4}$/;
    // a name both can use, or null
    function clean(name) {
        const s = String(name == null ? '' : name).replace(/\s+/g, ' ').trim();
        if (s.length < 2 || s.length > 16 || !/^[A-Za-z0-9 _.\-]+$/.test(s)) return null;
        return s;
    }
    const isAuto = (n) => AUTO_RE.test(String(n || ''));
    const get = (store, k) => { try { return store.getItem(k) || ''; } catch (e) { return ''; } };
    const put = (store, k, v) => { try { store.setItem(k, v); } catch (e) {} };
    // Makes the two the same where they can be, and returns the name to use ('' when there is none yet).
    function sync(store) {
        const w = clean(get(store, WILDS_KEY));
        const chatRaw = String(get(store, CHAT_KEY)).trim(), c = clean(chatRaw);
        // a chosen Wilds name wins
        if (w && !isAuto(w)) { if (chatRaw !== w) put(store, CHAT_KEY, w); return w; }
        // a chat name that fits becomes the Wilds' name too (over an automatic one)
        if (c) { if (w !== c) put(store, WILDS_KEY, c); if (chatRaw !== c) put(store, CHAT_KEY, c); return c; }
        // an automatic Wilds name and no chat name: both use it, until the player picks one
        if (w) { if (!chatRaw) put(store, CHAT_KEY, w); return chatRaw || w; }
        return chatRaw; // an older chat name that doesn't fit the Wilds (or nothing)
    }
    // Sets the name for both. Returns it, or '' when it doesn't fit.
    function set(store, name) {
        const n = clean(name);
        if (!n) return '';
        put(store, WILDS_KEY, n);
        put(store, CHAT_KEY, n);
        return n;
    }
    const RULES = '2 to 16 letters, numbers, spaces, _ . or -';
    return { WILDS_KEY, CHAT_KEY, RULES, clean, isAuto, sync, set };
}));
