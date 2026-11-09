/**
 * Ko-fi payments, the pure part: reading a webhook's payload, working out how many Beans it is worth, and the player's
 * link code. Used by the webhook worker (kofi-worker/src/index.js) and by the game (the link code it shows).
 *
 * What Ko-fi sends (help.ko-fi.com, "Does Ko-fi have an API or webhook?", read 2026-11-09): an HTTP POST to the webhook URL
 * when a payment completes, with the payment as JSON in a form field named `data`. The fields used here:
 *   verification_token  the secret shown on ko-fi.com/manage/webhooks: checked first, anything else is refused
 *   kofi_transaction_id the payment's id: the worker credits each one once (Ko-fi retries until it gets a 200, with the
 *                       same message_id, so the same payment can arrive more than once)
 *   type                'Donation' | 'Subscription' | 'Shop Order' (anything else gives no Beans)
 *   amount, currency    e.g. "3.00" (a string) and "USD"
 *   message             the supporter's message: where the player pastes their link code
 *   shop_items          for a Shop Order: [{ direct_link_code, variation_name, quantity }], else null
 *   tier_name           for a Subscription: the membership tier
 *   email               only used to let a player claim a payment that had no link code (kept as a keyed hash, never as text)
 * The payload Ko-fi's docs show as an example has kofi_transaction_id 00000000-1111-2222-3333-444444444444: that one is
 * treated as a test and credits nothing.
 *
 * Link codes: WH-XXXX-XXXX-XXXX, the first 12 hex digits of SHA-256('kofi-link:' + Firebase uid). The game works it out,
 * registers kofi_links/<12 hex> -> { uid } (firestore-premium.rules checks the hash, so nobody can register a code that
 * points at someone else), and the worker looks it up. The same account always gets the same code, on any device.
 *
 * Works in a browser (<script src="core/kofi.js"> sets window.WHKofi) and in Node / the worker (require / import).
 */
(function (root, factory) {
    if (typeof module === 'object' && module.exports) module.exports = factory();
    else root.WHKofi = factory();
}(typeof self !== 'undefined' ? self : this, function () {
    'use strict';

    const LINK_SEED = 'kofi-link:';
    const LINK_LEN = 12;
    const TEST_TXID = '00000000-1111-2222-3333-444444444444';
    const TYPES = ['Donation', 'Subscription', 'Shop Order', 'Commission'];
    const TXID_RE = /^[A-Za-z0-9-]{8,64}$/;
    // "WH-3FA9-C21B-77D0", "wh 3fa9c21b77d0", "WH3FA9C21B77D0": spaces and dashes between the groups are optional
    const LINK_RE = /\bWH[\s-]*([0-9A-F]{4})[\s-]*([0-9A-F]{4})[\s-]*([0-9A-F]{4})(?![0-9A-F])/i;

    function isObj(v) { return v !== null && typeof v === 'object' && !Array.isArray(v); }
    const str = (v, max) => (typeof v === 'string' ? v.slice(0, max) : '');

    // ---------------- link codes ----------------
    // the id stored as kofi_links/<id>: 12 upper-case hex digits
    function linkIdFromHex(hex) {
        const h = String(hex || '').toUpperCase();
        return /^[0-9A-F]{12,}$/.test(h) ? h.slice(0, LINK_LEN) : '';
    }
    function formatLinkCode(id) {
        const v = linkIdFromHex(id);
        return v ? 'WH-' + v.slice(0, 4) + '-' + v.slice(4, 8) + '-' + v.slice(8, 12) : '';
    }
    // the first link code in a message, as its id, or ''
    function findLinkCode(text) {
        const m = LINK_RE.exec(String(text || ''));
        return m ? (m[1] + m[2] + m[3]).toUpperCase() : '';
    }
    function hex(buf) { return Array.from(new Uint8Array(buf), (b) => b.toString(16).padStart(2, '0')).join(''); }
    // the link id for a Firebase uid (async: WebCrypto). The rules compute the same hash.
    async function linkIdForUid(uid, subtle) {
        const s = subtle || (globalThis.crypto && globalThis.crypto.subtle);
        const digest = await s.digest('SHA-256', new TextEncoder().encode(LINK_SEED + String(uid)));
        return linkIdFromHex(hex(digest));
    }

    // ---------------- the payload ----------------
    // The `data` field's text -> { ok, payload } | { ok: false, reason }
    function parseData(text) {
        if (typeof text !== 'string' || !text.trim()) return { ok: false, reason: 'empty' };
        if (text.length > 64000) return { ok: false, reason: 'too-big' };
        let p;
        try { p = JSON.parse(text); } catch (e) { return { ok: false, reason: 'not-json' }; }
        if (!isObj(p)) return { ok: false, reason: 'not-json' };
        return { ok: true, payload: p };
    }

    // A payload as the worker uses it, or { ok: false, reason }. Unknown fields are ignored.
    function normalize(p) {
        if (!isObj(p)) return { ok: false, reason: 'not-json' };
        const txid = str(p.kofi_transaction_id, 80).trim();
        if (!TXID_RE.test(txid)) return { ok: false, reason: 'no-transaction-id' };
        const type = str(p.type, 40);
        const amountText = str(p.amount, 24).trim();
        const amount = /^\d{1,9}(\.\d{1,4})?$/.test(amountText) ? Number(amountText) : NaN;
        const currency = str(p.currency || p.currency_code, 8).trim().toUpperCase();
        const items = [];
        if (Array.isArray(p.shop_items)) {
            for (const it of p.shop_items.slice(0, 50)) {
                if (!isObj(it)) continue;
                const code = str(it.direct_link_code, 64).trim();
                const qty = Math.floor(Number(it.quantity === undefined ? 1 : it.quantity));
                if (code && Number.isFinite(qty) && qty > 0) items.push({ code, qty: Math.min(qty, 1000) });
            }
        }
        return {
            ok: true,
            txid,
            messageId: str(p.message_id, 80),
            type: TYPES.includes(type) ? type : 'Other',
            amount: Number.isFinite(amount) ? amount : 0,
            amountText: Number.isFinite(amount) ? amountText : '',
            currency: /^[A-Z]{3}$/.test(currency) ? currency : '',
            message: str(p.message, 2000),
            email: str(p.email, 254).trim().toLowerCase(),
            items,
            tier: str(p.tier_name, 100),
            timestamp: str(p.timestamp, 40),
            isTest: txid === TEST_TXID,
        };
    }

    // How many Beans a payment is worth under `cfg` (core/premium-config.js). Returns { beans, lines, reason }: lines say where
    // they came from (one per shop item). reason when it is 0: 'tip' (a tip with no rate set), 'unknown-items',
    // 'no-tier', 'not-a-sale'.
    function creditFor(n, cfg) {
        const C = cfg;
        const max = Number.isInteger(C.maxBeansPerPayment) && C.maxBeansPerPayment > 0 ? C.maxBeansPerPayment : 100000;
        const lines = [];
        let beans = 0, reason = '';
        if (n.type === 'Shop Order') {
            for (const it of n.items) {
                const pack = C.packByCode(it.code, C);
                if (!pack) continue;
                const b = pack.beans * it.qty;
                lines.push({ code: pack.code, qty: it.qty, beans: b });
                beans += b;
            }
            if (!beans) reason = 'unknown-items';
        } else if (n.type === 'Donation') {
            const rate = Object.prototype.hasOwnProperty.call(C.donationRate || {}, n.currency) ? Number(C.donationRate[n.currency]) : 0;
            if (rate > 0 && n.amount > 0) { beans = Math.floor(n.amount * rate + 1e-9); lines.push({ code: 'tip', qty: 1, beans }); }
            if (!beans) reason = 'tip';
        } else if (n.type === 'Subscription') {
            const tiers = C.subscriptionTiers || {};
            const b = Object.prototype.hasOwnProperty.call(tiers, n.tier) ? Math.floor(Number(tiers[n.tier])) : 0;
            if (b > 0) { beans = b; lines.push({ code: 'tier', qty: 1, beans }); }
            if (!beans) reason = 'no-tier';
        } else reason = 'not-a-sale';
        if (!Number.isFinite(beans) || beans < 0) beans = 0;
        return { beans: Math.min(beans, max), lines, reason };
    }

    // Comparing secrets without giving away how much matched by how long it took
    function sameSecret(a, b) {
        if (typeof a !== 'string' || typeof b !== 'string' || !a || !b) return false;
        const x = new TextEncoder().encode(a), y = new TextEncoder().encode(b);
        let diff = x.length ^ y.length;
        for (let i = 0; i < Math.max(x.length, y.length); i++) diff |= (x[i % x.length] || 0) ^ (y[i % y.length] || 0);
        return diff === 0;
    }

    // A keyed hash of an email address (HMAC-SHA256 with a secret pepper, hex). Kept only on a payment nobody has claimed yet,
    // so its payer can prove it is theirs; without the pepper it can't be turned back into the address.
    async function emailHash(email, pepper, subtle) {
        const s = subtle || (globalThis.crypto && globalThis.crypto.subtle);
        const e = String(email || '').trim().toLowerCase();
        if (!e || !pepper) return '';
        const key = await s.importKey('raw', new TextEncoder().encode(pepper), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
        return hex(await s.sign('HMAC', key, new TextEncoder().encode(e)));
    }

    return { LINK_SEED, LINK_LEN, TEST_TXID, TYPES, TXID_RE, linkIdFromHex, formatLinkCode, findLinkCode, linkIdForUid,
        parseData, normalize, creditFor, sameSecret, emailHash };
}));
