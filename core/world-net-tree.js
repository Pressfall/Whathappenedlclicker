/**
 * The Wilds online: a tiny JSON tree with Realtime-Database-like paths. The local development relay (server.js) keeps
 * the shared state in one, and the relay's browser client (world-net-dev.js) mirrors it to fire child/value events.
 * Like Firebase Realtime Database: a null value deletes, and empty objects disappear.
 *
 * Works in a browser (<script src="core/world-net-tree.js"> sets window.WHNetTree) and in Node (require).
 */
(function (root, factory) {
    if (typeof module === 'object' && module.exports) module.exports = factory();
    else root.WHNetTree = factory();
}(typeof self !== 'undefined' ? self : this, function () {
    'use strict';

    const isObj = (v) => !!v && typeof v === 'object' && !Array.isArray(v);
    function split(path) { return String(path || '').split('/').filter(Boolean); }
    function join(...parts) { return parts.map(p => split(p).join('/')).filter(Boolean).join('/'); }
    function clone(v) { return v === undefined ? null : JSON.parse(JSON.stringify(v)); }
    // null for empty objects and undefined, so the tree never stores empties
    function normalize(v) {
        if (v === undefined || v === null) return null;
        if (!isObj(v)) return v;
        const out = {};
        for (const k in v) { const c = normalize(v[k]); if (c !== null) out[k] = c; }
        return Object.keys(out).length ? out : null;
    }

    function get(tree, path) {
        let cur = tree;
        for (const k of split(path)) { if (!isObj(cur)) return null; cur = cur[k]; if (cur === undefined) return null; }
        return cur === undefined ? null : cur;
    }
    // Set a value (null removes it). Returns the new root (the root itself may become null).
    function set(tree, path, value) {
        const keys = split(path);
        const v = normalize(clone(value));
        if (!keys.length) return v;
        const rootObj = isObj(tree) ? tree : {};
        const stack = [rootObj];
        let cur = rootObj;
        for (let i = 0; i < keys.length - 1; i++) {
            if (!isObj(cur[keys[i]])) cur[keys[i]] = {};
            cur = cur[keys[i]];
            stack.push(cur);
        }
        const last = keys[keys.length - 1];
        if (v === null) delete cur[last]; else cur[last] = v;
        // remove parents that became empty
        for (let i = keys.length - 1; i > 0; i--) {
            if (Object.keys(stack[i]).length) break;
            delete stack[i - 1][keys[i - 1]];
        }
        return Object.keys(rootObj).length ? rootObj : null;
    }
    // Which children of a node were added, changed or removed between two values of it
    function childDiff(before, after) {
        const a = isObj(before) ? before : {}, b = isObj(after) ? after : {};
        const out = { added: [], changed: [], removed: [] };
        for (const k in b) {
            if (!(k in a)) out.added.push(k);
            else if (JSON.stringify(a[k]) !== JSON.stringify(b[k])) out.changed.push(k);
        }
        for (const k in a) if (!(k in b)) out.removed.push(k);
        return out;
    }
    // Does a change at `changed` affect what is stored at `watched`? (one is inside the other)
    function overlaps(changed, watched) {
        const a = split(changed), b = split(watched);
        const n = Math.min(a.length, b.length);
        for (let i = 0; i < n; i++) if (a[i] !== b[i]) return false;
        return true;
    }
    // Value of an increment sentinel ({ '.inc': n }) applied to a current value
    function applyInc(cur, v) {
        if (isObj(v) && typeof v['.inc'] === 'number') return (typeof cur === 'number' ? cur : 0) + v['.inc'];
        return v;
    }

    return { isObj, split, join, clone, normalize, get, set, childDiff, overlaps, applyInc };
}));
