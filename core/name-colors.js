/**
 * The colour your name shows in chat (the owner's ask, 2026-11-22: chosen in Settings > Profile > Name color). Free for
 * everyone, from a fixed palette that reads well on the chats' dark backgrounds. The colour is sent with each message as
 * `nameColor` (its id, or null for the default), like the title and the chat effect, so everyone sees it, and a message
 * keeps the colour it was sent with. Pages only ever turn an id from this palette into a colour (hexOf), never anything a
 * message carries, so a message can't put its own CSS on anyone's screen.
 *
 * Loaded by index.html and clan.html (window.WHNameColors); works in Node too. store: localStorage, or anything with
 * getItem / setItem / removeItem. The choice is kept in KEY, which syncs with the cloud save (core/progress.js).
 */
(function (root, factory) {
    if (typeof module === 'object' && module.exports) module.exports = factory();
    else root.WHNameColors = factory();
}(typeof self !== 'undefined' ? self : this, function () {
    'use strict';
    const KEY = 'whathappened_name_color';
    const DEFAULT = 'sky'; // the light blue every name had before
    const COLORS = [
        { id: 'sky', name: 'Sky', hex: '#99ccff' },
        { id: 'ice', name: 'Ice', hex: '#7fe3f0' },
        { id: 'mint', name: 'Mint', hex: '#7dffb2' },
        { id: 'lime', name: 'Lime', hex: '#c4f07a' },
        { id: 'gold', name: 'Gold', hex: '#ffd76a' },
        { id: 'orange', name: 'Orange', hex: '#ffb36b' },
        { id: 'coral', name: 'Coral', hex: '#ff8f7a' },
        { id: 'red', name: 'Red', hex: '#ff6b7a' },
        { id: 'pink', name: 'Pink', hex: '#ff8ad8' },
        { id: 'violet', name: 'Violet', hex: '#c9a0ff' },
        { id: 'periwinkle', name: 'Periwinkle', hex: '#a7b4ff' },
        { id: 'white', name: 'White', hex: '#f2f4f8' },
    ];
    const BY_ID = new Map(COLORS.map((c) => [c.id, c]));
    // a palette id, or '' for anything else
    const clean = (id) => (typeof id === 'string' && BY_ID.has(id) ? id : '');
    // the colour to draw a name in: the palette's, or the default's for no id or one this page doesn't know
    const hexOf = (id) => BY_ID.get(clean(id) || DEFAULT).hex;
    function get(store) { try { return clean(store.getItem(KEY)) || DEFAULT; } catch (e) { return DEFAULT; } }
    // keeps the choice (the default is kept as nothing at all); returns what is in use now
    function set(store, id) {
        const c = clean(id) || DEFAULT;
        try { if (c === DEFAULT) store.removeItem(KEY); else store.setItem(KEY, c); } catch (e) {}
        return get(store);
    }
    // what a new message carries: the id, or null for the default
    function forMessage(store) { const c = get(store); return c === DEFAULT ? null : c; }
    return { KEY, DEFAULT, COLORS, clean, hexOf, get, set, forMessage };
}));
