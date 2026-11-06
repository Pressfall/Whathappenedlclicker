/**
 * Who may change what in a clan (clan.html): the ranks, and the check every change to a clan document has to pass. The
 * Firestore rules for clans (firestore-social.rules) say the same thing, so this file is their spec: classifyClanUpdate
 * is what the rules allow, worked out in JavaScript, and the page checks a change with it before sending it.
 *
 * Since this update a clan is held by Firebase sign-in ids (uid), not by names anyone can type:
 *  - ownerUid: the owner. roles: { uid: role }. names: { uid: username } (for showing). acct: { uid: true } for members
 *    signed in to an account (not anonymous); each member writes their own, and the rules check it against their sign-in.
 *    kicks: { uid: { reason, at } } so a kicked player's page can tell them.
 *  - Owning a clan, creating one, or being co-leader needs an account, so a leader survives a new device.
 *  - The old fields (owner, members, leaders: names) are still written alongside for older pages; once a clan has an
 *    ownerUid nothing reads them to decide anything.
 *  - A clan from before (no ownerUid) is claimed by its owner signing in to an account and opening the clan page. Until
 *    then it can't be managed. A claim matches the old owner name, so whoever claims first wins during the switch-over.
 * Pure. Works in a browser (<script src="core/clan-roles.js"> sets window.WHClanRoles) and in Node.
 */
(function (root, factory) {
    if (typeof module === 'object' && module.exports) module.exports = factory();
    else root.WHClanRoles = factory();
}(typeof self !== 'undefined' ? self : this, function () {
    'use strict';

    // stored role keys stay as they are in existing data ('eleite member' is an old typo kept for those clans)
    const RANK_PRIORITY = { 'leader': 5, 'co-leader': 4, 'elder': 3, 'eleite member': 2, 'member': 1 };
    const ROLES = Object.keys(RANK_PRIORITY);
    // what any member may change (shared progress; the numbers are still whatever the browser says, see
    // docs/trust-boundaries.md): XP and the daily check-in (clan.html clanCheckIn), the buffs bought with clan points and
    // what was given toward them (contributeClanBuff), the shop's icons, and which events' XP was paid (awardClanEventXp)
    const MEMBER_FIELDS = ['clanXp', 'checkin', 'activeBuffs', 'activeBuff', 'buffProgress', 'cpDonated', 'clanShopIconsUnlocked', 'eventXpAwarded'];
    // what co-leaders and up may change
    const MANAGE_FIELDS = ['description', 'clanIcon', 'clanCustomLogoUrl', 'maxMembers'];
    const MAP_FIELDS = ['roles', 'names', 'acct', 'kicks'];
    // a kick or a role change also writes act: { by, kind: 'kick' | 'role', target }: the rules can't pick the one changed
    // key out of a set, so the writer names it, and the rules check it is the one that changed
    const LEGACY = ['owner', 'members', 'leaders'];

    const isObj = (v) => !!v && typeof v === 'object' && !Array.isArray(v);
    function rank(role) { return RANK_PRIORITY[String(role || 'member').toLowerCase()] || 1; }
    // the role a uid has in a clan document: its roles entry ('leader' for the owner), or null for a non-member
    function roleOf(c, uid) {
        if (!c || !uid) return null;
        if (c.ownerUid === uid) return 'leader';
        const r = isObj(c.roles) ? c.roles[uid] : null;
        return r && RANK_PRIORITY[r] ? r : null;
    }
    function claimed(c) { return !!(c && typeof c.ownerUid === 'string' && c.ownerUid); }
    function uidOfName(c, name) { if (!c || !isObj(c.names)) return null; for (const u in c.names) if (c.names[u] === name) return u; return null; }
    function canAssignRole(actorRole, targetNewRole) { const a = rank(actorRole); return a >= rank('leader') || a > rank(targetNewRole); }
    function canKick(actorRole, targetRole, isTargetOwner) {
        const a = rank(actorRole), t = rank(targetRole);
        if (isTargetOwner) return false; // the owner hands the clan over or deletes it; nobody kicks them
        return a >= rank('leader') || a > t;
    }
    function canEditDescription(actorRole) { return rank(actorRole) >= rank('co-leader'); }
    function canChangeName(actorRole) { return rank(actorRole) >= rank('leader'); }
    function canTransferOwnership(actorRole) { return rank(actorRole) >= rank('leader'); }
    function canPinMessages(actorRole) { return rank(actorRole) >= rank('elder'); }
    function size(c) { return isObj(c && c.roles) ? Object.keys(c.roles).length : 0; }

    // the keys of a and b whose values differ (JSON-equal counts as the same)
    function changedKeys(a, b) {
        const out = [], A = isObj(a) ? a : {}, B = isObj(b) ? b : {};
        for (const k of new Set(Object.keys(A).concat(Object.keys(B)))) if (JSON.stringify(A[k]) !== JSON.stringify(B[k])) out.push(k);
        return out;
    }

    // What a change to a clan document is, and whether this player may make it. before/after: the whole document;
    // uid: who writes; account: whether they are signed in to an account. Returns { ok, action, reason? }.
    // Actions: create, claim, join, leave, kick, role, transfer, manage, rename, progress, delete.
    function classifyClanUpdate(before, after, uid, account) {
        const no = (action, reason) => ({ ok: false, action, reason });
        if (!uid) return no('?', 'signin');
        if (!before && after) {
            const roles = isObj(after.roles) ? after.roles : {};
            if (!account) return no('create', 'account');
            if (after.ownerUid !== uid || Object.keys(roles).length !== 1 || roles[uid] !== 'leader') return no('create', 'shape');
            if (!isObj(after.names) || typeof after.names[uid] !== 'string' || !isObj(after.acct) || after.acct[uid] !== true) return no('create', 'shape');
            if ((Number(after.clanXp) || 0) !== 0) return no('create', 'shape');
            return { ok: true, action: 'create' };
        }
        if (before && !after) return claimed(before) && before.ownerUid === uid ? { ok: true, action: 'delete' } : no('delete', 'owner');
        const keys = changedKeys(before, after);
        const touches = (list) => keys.some(k => list.includes(k));
        const mine = roleOf(before, uid);
        // an old clan (no ownerUid): its owner claims it; its members re-join; nothing else but shared progress
        if (!claimed(before)) {
            if (keys.includes('ownerUid')) {
                if (!account) return no('claim', 'account');
                const name = isObj(after.names) ? after.names[uid] : null;
                if (after.ownerUid !== uid || !name || name !== before.owner) return no('claim', 'owner');
                const r = changedKeys(before.roles, after.roles);
                if (r.length !== 1 || r[0] !== uid || after.roles[uid] !== 'leader') return no('claim', 'shape');
                if (touches(MANAGE_FIELDS.concat(MEMBER_FIELDS, ['name']))) return no('claim', 'shape');
                return { ok: true, action: 'claim' };
            }
            if (touches(MAP_FIELDS)) return selfEntry(before, after, uid, account, keys, true);
            if (touches(MANAGE_FIELDS.concat(['name']))) return no('manage', 'unclaimed');
            if (touches(LEGACY)) return no('legacy', 'unclaimed');
            return keys.every(k => MEMBER_FIELDS.includes(k)) ? { ok: true, action: 'progress' } : no('progress', 'field');
        }
        if (keys.includes('ownerUid')) {
            if (before.ownerUid !== uid) return no('transfer', 'owner');
            const to = after.ownerUid;
            if (!roleOf(before, to) || !isObj(before.acct) || before.acct[to] !== true) return no('transfer', 'target');
            if (!isObj(after.roles) || after.roles[to] !== 'leader' || after.roles[uid] !== 'co-leader') return no('transfer', 'shape');
            return { ok: true, action: 'transfer' };
        }
        if (keys.includes('name')) return rank(mine) >= rank('leader') ? { ok: true, action: 'rename' } : no('rename', 'rank');
        if (touches(MAP_FIELDS)) {
            const r = changedKeys(before.roles, after.roles);
            // joining or leaving: only my own entry
            if (r.length === 1 && r[0] === uid) return selfEntry(before, after, uid, account, keys, false);
            if (!mine) return no('role', 'member');
            if (r.length !== 1) return no('role', 'shape');
            const t = r[0], was = (before.roles || {})[t], now = isObj(after.roles) ? after.roles[t] : undefined;
            if (t === before.ownerUid) return no('kick', 'owner');
            const act = isObj(after.act) ? after.act : {};
            if (act.by !== uid || act.target !== t || act.kind !== (now === undefined ? 'kick' : 'role')) return no(now === undefined ? 'kick' : 'role', 'act');
            if (!keys.every(k => MAP_FIELDS.concat(['members', 'leaders', 'act']).includes(k))) return no(now === undefined ? 'kick' : 'role', 'field');
            if (now !== undefined && !keys.every(k => ['roles', 'leaders', 'act'].includes(k))) return no('role', 'field');
            if (now === undefined) {
                // a kick: their entry goes (names and acct with it), a notice may be left
                if (!was) return no('kick', 'member');
                if (!canKick(mine, was, false)) return no('kick', 'rank');
                return { ok: true, action: 'kick' };
            }
            if (!RANK_PRIORITY[now] || now === 'leader') return no('role', 'shape');
            if (!was) return no('role', 'member');
            if (!canAssignRole(mine, now) || !canAssignRole(mine, was)) return no('role', 'rank');
            if (rank(now) >= rank('co-leader') && !(isObj(before.acct) && before.acct[t] === true)) return no('role', 'account');
            return { ok: true, action: 'role' };
        }
        if (touches(MANAGE_FIELDS)) return canEditDescription(mine) && keys.every(k => MANAGE_FIELDS.includes(k)) ? { ok: true, action: 'manage' } : no('manage', 'rank');
        if (!mine) return no('progress', 'member');
        // shared progress only: nothing else (the old owner / members / leaders fields included) changes on its own
        return keys.every(k => MEMBER_FIELDS.includes(k)) ? { ok: true, action: 'progress' } : no('progress', 'field');
    }
    // joining (my entry appears, as a member) or leaving (it goes); acct must say what my sign-in is
    function selfEntry(before, after, uid, account, keys, legacy) {
        const was = (before.roles || {})[uid], now = isObj(after.roles) ? after.roles[uid] : undefined;
        if (!was && now !== undefined) {
            if (now !== 'member') return { ok: false, action: 'join', reason: 'shape' };
            if (!isObj(after.names) || typeof after.names[uid] !== 'string') return { ok: false, action: 'join', reason: 'shape' };
            if (!!(isObj(after.acct) && after.acct[uid]) !== !!account) return { ok: false, action: 'join', reason: 'acct' };
            if (!legacy && size(after) > (Number(before.maxMembers) || 30)) return { ok: false, action: 'join', reason: 'full' };
            return { ok: true, action: 'join' };
        }
        if (was && now === undefined) {
            if (before.ownerUid === uid) return { ok: false, action: 'leave', reason: 'owner' };
            return { ok: true, action: 'leave' };
        }
        return { ok: false, action: 'self', reason: 'shape' };
    }

    return { RANK_PRIORITY, ROLES, MEMBER_FIELDS, MANAGE_FIELDS, rank, roleOf, claimed, uidOfName, canAssignRole, canKick, canEditDescription, canChangeName,
        canTransferOwnership, canPinMessages, size, changedKeys, classifyClanUpdate };
}));
