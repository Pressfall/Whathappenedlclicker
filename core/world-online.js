/**
 * The Wilds online: the rules for playing together, with no network code. What a player's position update looks like,
 * how a PvP hit is checked by the player it hits (range, rate and damage caps), loot bags dropped by knocked-out
 * players, chat, and the shared boss. world-online.js does the talking (Realtime Database in production, the server.js
 * relay in development).
 *
 * Trust: every page is a client of a shared database, so nothing here is authoritative. A hit is only applied if the
 * player it hits agrees it was possible; the rest is bounded so one modified page can't do unlimited harm (see
 * docs/trust-boundaries.md).
 *
 * Works in a browser (<script src="core/world-online.js"> sets window.WHWorldOnline, after world-data.js) and in Node.
 */
(function (root, factory) {
    if (typeof module === 'object' && module.exports) module.exports = factory(require('./world-data'));
    else root.WHWorldOnline = factory(root.WHWorldData);
}(typeof self !== 'undefined' ? self : this, function (D) {
    'use strict';

    const ROOT = 'wilds/v1/zones';
    const RATE = { sendHz: 10, staleSec: 6, hiddenLeaveSec: 20, interpMs: 120 };
    const PVP = {
        mult: 0.5,          // players hit each other at half strength (gear makes one-shots too easy otherwise)
        protectSec: 5,      // after arriving in a zone or waking up
        lag: 140,           // extra reach allowed for network delay (px)
        arrowRange: 1100,
        capMult: 9,       // most a hit can be worth: best quality x Perfect x 3-combo x crit x backstab
        minGapMult: 0.6,    // hits from one attacker at least this share of the weapon's hit cooldown apart
        arrowGap: 0.15,
        hitR: 13,
    };
    const LOOT = { share: 0.3, ownerSec: 10, lifeSec: 300, maxTypes: 12, maxEach: 999, pickR: 30 };
    const BOSS = { idleResetSec: 60, minShare: 0.03, hostHz: 8, flushSec: 0.25, confirmSec: 4 };
    const CHAT = { maxLen: 60, bubbleSec: 6, gapSec: 1.2, logMax: 40 };
    const EMOTES = ['👋', '😂', '😮', '😡', '❤️', '👍', '🔥', 'GG'];
    const FLAGS = { shield: 1, dead: 2, dash: 4, protect: 8, draw: 16 };
    // same list as the game's chat safe mode (index.html censorForSafeMode)
    const SAFE_WORDS = ['damn', 'hell', 'crap', 'ass', 'bastard', 'bitch', 'shit', 'shitty', 'fuck', 'fucking', 'fucker', 'fucked', 'wtf', 'stfu',
        'dick', 'dumbass', 'bullshit', 'piss', 'pissed', 'slut', 'whore', 'cunt', 'nigger', 'nigga', 'fag', 'faggot', 'retard', 'retarded', 'rape', 'raped'];
    const FACE_RE = /^mainimage\/(thumbs\/)?[A-Za-z0-9_'-]{1,40}\.(webp|png|jpe?g)$/;
    const UID_RE = /^[A-Za-z0-9_-]{4,64}$/;

    const num = (v, lo, hi, dflt = 0) => { const n = Number(v); return Number.isFinite(n) ? Math.max(lo, Math.min(hi, n)) : dflt; };
    const int = (v, lo, hi, dflt = 0) => Math.round(num(v, lo, hi, dflt));
    const isObj = (v) => !!v && typeof v === 'object' && !Array.isArray(v);

    // ---------------- position updates ----------------
    // x, y, weapon angle, reach/draw, shield angle, flags, hp, max hp, shot counter, heartbeat: one short string, sent ~10 times
    // a second while anything changes. The heartbeat (k) changes every second, because the database tells nobody about a write
    // that changes nothing, and a player standing still must still look present.
    function packPos(o) {
        return [Math.round(o.x), Math.round(o.y), Math.round((o.a || 0) * 100), Math.round(o.r || 0), Math.round((o.sa || 0) * 100),
            o.fl | 0, Math.ceil(o.hp || 0), Math.round(o.mhp || 0), o.shot | 0, o.k | 0].join(',');
    }
    function unpackPos(str) {
        if (typeof str !== 'string' || str.length > 120) return null;
        const p = str.split(',');
        if (p.length !== 10) return null;
        const n = p.map(Number);
        if (n.some(v => !Number.isFinite(v))) return null;
        return { x: num(n[0], 0, 1e5), y: num(n[1], 0, 1e5), a: num(n[2] / 100, -7, 7), r: num(n[3], 0, 200), sa: num(n[4] / 100, -7, 7),
            fl: int(n[5], 0, 255), hp: int(n[6], 0, 1e5), mhp: int(n[7], 1, 1e5, 100), shot: int(n[8], 0, 1e9), k: int(n[9], 0, 1e9) };
    }

    // ---------------- who a player is ----------------
    function sanitizeName(name) {
        const s = String(name || '').replace(/\s+/g, ' ').trim();
        if (s.length < 2 || s.length > 16 || !/^[A-Za-z0-9 _.\-]+$/.test(s)) return null;
        return s;
    }
    function cleanChat(text) {
        const s = String(text || '').replace(/[\u0000-\u001f\u007f]/g, '').replace(/\s+/g, ' ').trim().slice(0, CHAT.maxLen);
        return s || null;
    }
    function censor(text) {
        let out = String(text);
        for (const w of SAFE_WORDS) out = out.replace(new RegExp('\\b' + w + '\\b', 'gi'), '***');
        return out;
    }
    const tierOf = (id, slot) => { const b = D.GEAR_BY_ID[id]; return b && b.slot === slot ? b.tier : 0; };
    // A player's look and gear as shown to others: { n, f, w, q, sh, c, h, b, say }
    function sanitizeInfo(raw) {
        if (!isObj(raw)) return null;
        const w = D.GEAR_BY_ID[raw.w] && D.GEAR_BY_ID[raw.w].slot === 'weapon' ? raw.w : 'sword_0';
        const sh = D.GEAR_BY_ID[raw.sh] && D.GEAR_BY_ID[raw.sh].slot === 'offhand' ? raw.sh : '';
        let say = null;
        if (isObj(raw.say)) { const m = cleanChat(raw.say.m); if (m) say = { m, t: num(raw.say.t, 0, 1e15), e: !!raw.say.e }; }
        return {
            n: sanitizeName(raw.n) || 'Adventurer', f: FACE_RE.test(String(raw.f || '')) ? raw.f : 'mainimage/whathappened.jpeg',
            w, q: int(raw.q, 0, D.QUALITY.length - 1), sh, c: int(raw.c, 0, 5), h: int(raw.h, 0, 5), b: int(raw.b, 0, 5), say,
        };
    }
    function infoFor(state, name, face) {
        const s = state, find = (u) => s.gear.find(g => g.uid === u);
        const wpn = find(s.hotbar[s.sel]), q = wpn ? D.QUALITY.indexOf(D.QUALITY.slice().reverse().find(t => wpn.score >= t.min)) : 0;
        const tier = (slot) => { const it = find(s.equip[slot]); return it ? D.GEAR_BY_ID[it.base].tier : 0; };
        const shield = find(s.equip.offhand);
        return { n: name, f: face, w: wpn ? wpn.base : 'sword_0', q: Math.max(0, q), sh: shield ? shield.base : '', c: tier('chest'), h: tier('helmet'), b: tier('boots') };
    }

    // ---------------- PvP ----------------
    function maxHit(weaponId, kind) {
        const b = D.GEAR_BY_ID[weaponId];
        if (!b || b.slot !== 'weapon') return 0;
        const cap = b.dmg * PVP.capMult;
        return kind === 'bash' ? cap * D.WEAPON_CLASSES.spear.bashDmg * 2 : cap;
    }
    function reachFor(weaponId, kind) {
        const b = D.GEAR_BY_ID[weaponId];
        if (kind === 'arrow') return PVP.arrowRange;
        if (kind === 'parry') return 260;
        if (!b) return 0;
        const P = D.WEAPON_CLASSES[b.cls];
        return (b.cls === 'spear' ? P.reachMax : (P.len || 0)) + PVP.hitR + PVP.lag;
    }
    // A hit someone sent us. Returns { ok: true, dmg } with the damage to take (PvP strength), or { ok: false, reason }.
    // ctx: { zone, attacker: unpacked position, me: { x, y, protected }, now (s), lastAt (s, this attacker's last hit) }
    function validateHit(hit, ctx) {
        if (!isObj(hit)) return { ok: false, reason: 'shape' };
        if (ctx.zone === 'town' || !D.ZONES[ctx.zone]) return { ok: false, reason: 'town' };
        const kind = ['melee', 'thrust', 'bash', 'arrow', 'parry'].includes(hit.k) ? hit.k : null;
        if (!kind) return { ok: false, reason: 'kind' };
        const a = ctx.attacker;
        if (!a || (a.fl & FLAGS.dead)) return { ok: false, reason: 'attacker' };
        if (kind !== 'parry' && ctx.me.protected) return { ok: false, reason: 'protected' };
        const b = D.GEAR_BY_ID[hit.w];
        if (kind !== 'parry' && (!b || b.slot !== 'weapon')) return { ok: false, reason: 'weapon' };
        if (kind === 'arrow' && b.cls !== 'bow') return { ok: false, reason: 'weapon' };
        if ((kind === 'thrust' || kind === 'bash') && b.cls !== 'spear') return { ok: false, reason: 'weapon' };
        if (kind === 'melee' && (b.cls === 'bow' || b.cls === 'spear')) return { ok: false, reason: 'weapon' };
        const d = Math.hypot(a.x - ctx.me.x, a.y - ctx.me.y);
        if (d > reachFor(hit.w, kind)) return { ok: false, reason: 'range' };
        if (kind === 'parry') return { ok: true, dmg: 0 };
        const gap = kind === 'arrow' ? PVP.arrowGap : D.WEAPON_CLASSES[b.cls].cd * PVP.minGapMult;
        if (ctx.lastAt !== undefined && ctx.now - ctx.lastAt < gap) return { ok: false, reason: 'rate' };
        const dmg = Number(hit.dmg);
        if (!Number.isFinite(dmg) || dmg <= 0) return { ok: false, reason: 'dmg' };
        return { ok: true, dmg: Math.min(dmg, maxHit(hit.w, kind)) * PVP.mult };
    }
    // A hit to send: { w, k, dmg, ang (direction it pushes), pf (Perfect) }
    function makeHit(weaponId, kind, dmg, ang, perfect) {
        return { w: weaponId, k: kind, dmg: Math.round(dmg * 10) / 10, ang: Math.round(ang * 100) / 100, pf: !!perfect };
    }

    // ---------------- loot bags ----------------
    // What a knocked-out player drops: 30% of each carried stack (the same share as a grave)
    function sanitizeLoot(raw) {
        if (!isObj(raw) || !isObj(raw.m)) return null;
        const m = {};
        let types = 0;
        for (const id in raw.m) {
            if (!D.MATERIALS_BY_ID[id] || D.MATERIALS_BY_ID[id].kind === 'key') continue;
            const n = int(raw.m[id], 0, LOOT.maxEach);
            if (n > 0 && types < LOOT.maxTypes) { m[id] = n; types++; }
        }
        if (!types) return null;
        const x = Number(raw.x), y = Number(raw.y), t = Number(raw.t);
        if (![x, y, t].every(Number.isFinite)) return null;
        return { x, y, t, m, by: sanitizeName(raw.by) || 'Someone', k: UID_RE.test(String(raw.k || '')) ? raw.k : '', o: UID_RE.test(String(raw.o || '')) ? raw.o : '' };
    }
    // The killer gets the first few seconds; after that anyone may grab it
    function canClaim(bag, uid, now) { return !bag.k || bag.k === uid || now - bag.t >= LOOT.ownerSec * 1000; }
    function lootExpired(bag, now) { return now - bag.t > LOOT.lifeSec * 1000; }

    // ---------------- the shared boss ----------------
    // { hp, max, gen, t (last change), killedAt, f: { uid: damage }, h: host's view }
    function sanitizeBoss(raw) {
        if (!isObj(raw)) return null;
        const max = num(raw.max, 0, 1e7);
        if (!(max > 0)) return null;
        const f = {};
        if (isObj(raw.f)) for (const k in raw.f) if (UID_RE.test(k)) f[k] = num(raw.f[k], 0, 1e7);
        return { hp: num(raw.hp, -1e7, max), max, gen: String(raw.gen || '').slice(0, 24), t: num(raw.t, 0, 1e15), killedAt: num(raw.killedAt, 0, 1e15), f, h: sanitizeHost(raw.h) };
    }
    // A fresh fight is needed when there is none, the last one ended long enough ago, or nobody has hit it for a minute
    function bossNeedsReset(b, now, respawnSec) {
        if (!b) return true;
        if (b.killedAt) return now - b.killedAt > respawnSec * 1000;
        return now - b.t > BOSS.idleResetSec * 1000;
    }
    function bossDeadFor(b, now, respawnSec) { return !!(b && b.killedAt && now - b.killedAt <= respawnSec * 1000); }
    // Enough of the damage to earn the reward
    function earnedReward(b, uid) { return !!b && b.max > 0 && (b.f[uid] || 0) >= b.max * BOSS.minShare; }
    // The player who runs the boss: the lowest id among those in the arena (every page works this out the same way)
    function hostOf(uids) { return uids.filter(u => UID_RE.test(String(u))).sort()[0] || null; }
    function sanitizeHost(raw) {
        if (!isObj(raw) || !UID_RE.test(String(raw.u || ''))) return null;
        return { u: raw.u, x: num(raw.x, 0, 1e5), y: num(raw.y, 0, 1e5), fa: num(raw.fa, -7, 7), s: int(raw.s, 0, 1e9), a: String(raw.a || '').slice(0, 16),
            d: num(raw.d, -7, 7), tg: UID_RE.test(String(raw.tg || '')) ? raw.tg : '', tx: num(raw.tx, 0, 1e5), ty: num(raw.ty, 0, 1e5), ph: int(raw.ph, 0, 2), st: num(raw.st, 0, 5), n: int(raw.n, 0, 1e9) };
    }

    // ---------------- smoothing ----------------
    function lerpAngle(a, b, f) { let d = (b - a) % (Math.PI * 2); if (d > Math.PI) d -= Math.PI * 2; if (d < -Math.PI) d += Math.PI * 2; return a + d * f; }
    // Where a remote player is at time t, between the updates around it (buf: [{ at, x, y, a, r, sa }], oldest first)
    function interpolate(buf, t) {
        if (!buf.length) return null;
        if (t <= buf[0].at) return buf[0];
        for (let i = 1; i < buf.length; i++) {
            const b = buf[i];
            if (t <= b.at) {
                const a = buf[i - 1], f = (t - a.at) / Math.max(1, b.at - a.at);
                return Object.assign({}, b, { x: a.x + (b.x - a.x) * f, y: a.y + (b.y - a.y) * f, a: lerpAngle(a.a, b.a, f), sa: lerpAngle(a.sa, b.sa, f), r: a.r + (b.r - a.r) * f });
            }
        }
        return buf[buf.length - 1];
    }

    return {
        ROOT, RATE, PVP, LOOT, BOSS, CHAT, EMOTES, FLAGS, SAFE_WORDS,
        packPos, unpackPos, sanitizeName, cleanChat, censor, sanitizeInfo, infoFor,
        maxHit, reachFor, validateHit, makeHit, sanitizeLoot, canClaim, lootExpired,
        sanitizeBoss, bossNeedsReset, bossDeadFor, earnedReward, hostOf, sanitizeHost, lerpAngle, interpolate,
    };
}));
