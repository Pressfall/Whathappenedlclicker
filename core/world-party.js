/**
 * Parties (The Wilds): a few players who play together, in any zone. Party members can't hurt each other (the victim's page
 * refuses the hit, core/world-online.js validateHit 'party'), see where each other are, and have a chat of their own.
 *
 * Data under wilds/v1/party/{pid} (database.rules.json):
 *  - inv/{uid}: a ticket, the uid of whoever invited them (the founder's names themself). Only ticket holders can read the
 *    party or join it, and the ticket stays when a page closes, so a reload rejoins. Leaving removes it.
 *  - m/{uid}: { n, z, t }, the members playing now: name, zone, when it was written. Removed when their page closes.
 *  - c/{id}: { u, n, m, t }, the party's chat: each line once, the last chatKeep kept.
 * Invitations travel like the arena's (the zone's d/{uid} messages: 'party', answered 'pyes' / 'pno'), so you invite
 * someone standing next to you; after that the party works across zones. Pure.
 *
 * Works in a browser (<script src="core/world-party.js"> sets window.WHWorldParty, after world-online.js) and in Node.
 */
(function (root, factory) {
    if (typeof module === 'object' && module.exports) module.exports = factory(require('./world-online'));
    else root.WHWorldParty = factory(root.WHWorldOnline);
}(typeof self !== 'undefined' ? self : this, function (O) {
    'use strict';

    // max: players in a party; chatKeep: lines kept in the database; inviteSec: how long an invitation can be answered
    const PARTY = { max: 4, chatKeep: 30, inviteSec: 30, root: 'wilds/v1/party' };
    const PID_RE = /^[A-Za-z0-9]{8,12}$/;
    const UID_RE = /^[A-Za-z0-9_-]{4,64}$/;
    const ZONE_RE = /^[a-z]{2,12}$/;
    const isObj = (v) => !!v && typeof v === 'object' && !Array.isArray(v);

    function newPid(rnd = Math.random) { let s = ''; const A = 'abcdefghijkmnpqrstuvwxyz23456789'; for (let i = 0; i < 10; i++) s += A[Math.floor(rnd() * A.length)]; return s; }
    function validPid(id) { return PID_RE.test(String(id || '')); }
    function path(pid, sub) { return PARTY.root + '/' + pid + (sub ? '/' + sub : ''); }

    // ---------------- members ----------------
    function member(name, zone, now) { return { n: O.sanitizeName(name) || 'Adventurer', z: ZONE_RE.test(String(zone || '')) ? zone : '', t: Math.round(now) }; }
    // m/: { uid: { n, z, t } } -> Map(uid -> { n, z, t }), at most PARTY.max (the first to join, if a party ever got bigger)
    function sanitizeMembers(tree) {
        const out = [];
        if (isObj(tree)) for (const uid in tree) {
            const v = tree[uid];
            if (!UID_RE.test(uid) || !isObj(v)) continue;
            out.push([uid, { n: O.sanitizeName(v.n) || 'Adventurer', z: ZONE_RE.test(String(v.z || '')) ? v.z : '', t: Number(v.t) || 0 }]);
        }
        return new Map(out.sort((a, b) => a[1].t - b[1].t || (a[0] < b[0] ? -1 : 1)).slice(0, PARTY.max));
    }
    // inv/: { uid: inviter } -> the uids holding a ticket
    function tickets(tree) { return isObj(tree) ? Object.keys(tree).filter(u => UID_RE.test(u) && typeof tree[u] === 'string') : []; }
    // Is there room for one more? Counts everyone with a ticket (members away for now keep their place).
    function hasRoom(ticketUids, uid) { return ticketUids.includes(uid) || ticketUids.length < PARTY.max; }
    // the leader: whoever has been a member longest (every page works out the same one)
    function leaderOf(members) { const first = members && members.keys().next(); return first && !first.done ? first.value : null; }

    // ---------------- chat ----------------
    function chatLine(uid, name, text, now) {
        const m = O.cleanChat(text);
        return m ? { u: uid, n: O.sanitizeName(name) || 'Adventurer', m, t: Math.round(now) } : null;
    }
    function sanitizeChat(raw) {
        if (!isObj(raw) || !UID_RE.test(String(raw.u || ''))) return null;
        const m = O.cleanChat(raw.m);
        if (!m) return null;
        return { u: raw.u, n: O.sanitizeName(raw.n) || 'Adventurer', m, t: Number(raw.t) || 0 };
    }
    // the chat's keys (push keys sort by time) -> those to delete so only the last `keep` stay
    function chatOverflow(keys, keep = PARTY.chatKeep) { const k = keys.slice().sort(); return k.length > keep ? k.slice(0, k.length - keep) : []; }

    return { PARTY, PID_RE, newPid, validPid, path, member, sanitizeMembers, tickets, hasRoom, leaderOf, chatLine, sanitizeChat, chatOverflow };
}));
