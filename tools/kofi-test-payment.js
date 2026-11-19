#!/usr/bin/env node
/**
 * Send a pretend Ko-fi payment to the Ko-fi worker, to test buying Holy What Happeneds without spending money.
 *
 * It posts exactly what Ko-fi posts (form field `data` holding the payment as JSON), signed with YOUR verification token,
 * so it goes through the real worker, the real Firestore and the real game. What it credits is real, on the account whose
 * link code you give: spend it, or lower that wallet's balance in the Firebase console afterwards. Its transaction ids
 * start with TEST- so they are easy to find in kofi_payments.
 *
 * The token is read from the environment (KOFI_VERIFICATION_TOKEN) or from kofi-worker/.dev.vars (wrangler's local secrets
 * file, never committed: a line KOFI_VERIFICATION_TOKEN=...). Never share it: anyone holding it can do what this script does.
 *
 *   node tools/kofi-test-payment.js --code WH-XXXX-XXXX-XXXX --amount 5         a $5 tip with your link code (550 now)
 *   node tools/kofi-test-payment.js --code WH-XXXX-XXXX-XXXX --amount 5 --twice the same payment twice: credited once
 *   node tools/kofi-test-payment.js --no-code --amount 2 --email you@example.com a tip without a code: kept to be claimed
 *   node tools/kofi-test-payment.js --dry --code WH-...                         print what would be sent, send nothing
 *
 * Other options: --worker https://... (default: workerUrl in core/premium-config.js), --currency USD, --txid TEST-...,
 * --type "Donation" | "Shop Order" | "Subscription", --item <shop item code> (Shop Order), --tier <name> (Subscription),
 * --message "..." (instead of the code). For `npx wrangler dev`, use --worker http://localhost:8787.
 */
'use strict';
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const ROOT = path.resolve(__dirname, '..');
const Config = require(path.join(ROOT, 'core/premium-config.js'));
const Kofi = require(path.join(ROOT, 'core/kofi.js'));

// ---------------- the payment ----------------
// A payment shaped like Ko-fi's (help.ko-fi.com, "Does Ko-fi have an API or webhook?"), with the test's values
function buildPayload(o) {
    const type = o.type || 'Donation';
    const amount = Number(o.amount === undefined ? 5 : o.amount);
    if (!(amount > 0)) throw new Error('--amount must be more than 0');
    const code = o.code ? Kofi.formatLinkCode(Kofi.findLinkCode(o.code)) : '';
    if (o.code && !code) throw new Error('--code must look like WH-XXXX-XXXX-XXXX (the player\'s link code from Get more)');
    const txid = o.txid || 'TEST-' + crypto.randomUUID();
    if (!Kofi.TXID_RE.test(txid)) throw new Error('--txid may use letters, digits and dashes, 8 to 64 of them');
    return {
        verification_token: o.token || '',
        message_id: crypto.randomUUID(),
        timestamp: new Date(o.now || Date.now()).toISOString().replace(/\.\d+Z$/, 'Z'),
        type,
        is_public: false,
        from_name: 'Test payment',
        message: o.message !== undefined ? String(o.message) : code ? code + ' (test payment)' : 'test payment without a link code',
        amount: amount.toFixed(2),
        url: '',
        email: o.email || 'test@example.com',
        currency: o.currency || Config.tipCurrency || 'USD',
        is_subscription_payment: type === 'Subscription',
        is_first_subscription_payment: type === 'Subscription',
        kofi_transaction_id: txid,
        shop_items: type === 'Shop Order' ? [{ direct_link_code: o.item || '', variation_name: '', quantity: 1 }] : null,
        tier_name: type === 'Subscription' ? (o.tier || '') : null,
        shipping: null,
    };
}
// what Ko-fi sends: application/x-www-form-urlencoded, the JSON in `data`
function formBody(payload) { return new URLSearchParams({ data: JSON.stringify(payload) }).toString(); }
function webhookUrl(worker) {
    const base = String(worker || '').trim().replace(/\/+$/, '');
    if (!/^https:\/\//.test(base) && !/^http:\/\/(localhost|127\.0\.0\.1)(:\d+)?$/.test(base)) throw new Error('--worker must be the worker\'s https:// address (or http://localhost:8787 for wrangler dev)');
    return /\/kofi$/.test(base) ? base : base + '/kofi';
}
// What the worker's answer means, in a sentence
function explain(status, body, payload) {
    if (status === 401) return 'Refused: the verification token doesn\'t match the worker\'s KOFI_VERIFICATION_TOKEN secret.';
    if (status === 500 && body && body.error === 'not configured') return 'The worker has no KOFI_VERIFICATION_TOKEN secret yet (docs/kofi-setup.md, step 4).';
    if (status >= 500) return 'The worker failed (Ko-fi would try again later). See `npx wrangler tail` in kofi-worker/ for why.';
    if (status !== 200 || !body) return 'Unexpected answer ' + status + '.';
    if (body.test) return 'Treated as Ko-fi\'s own test payment: nothing credited.';
    if (body.duplicate) return 'Already handled before (the same transaction id): nothing credited again. That is the protection against Ko-fi\'s retries.';
    if (body.ignored) return 'Not worth Holy What Happeneds (' + body.ignored + '): nothing credited, nothing stored. Check the amount, the currency or the item.';
    if (body.matched) return 'Credited ' + body.beans + ' Holy What Happeneds to the account with that link code. The 👼 chip in the game should go up within a few seconds.';
    return 'Kept as unmatched (' + body.beans + ' Holy What Happeneds waiting). Claim it in the game: 👼 > Get more > "Paid without your code?", transaction ID '
        + payload.kofi_transaction_id + ', email ' + payload.email + '.';
}

// ---------------- running it ----------------
function readToken() {
    if (process.env.KOFI_VERIFICATION_TOKEN) return process.env.KOFI_VERIFICATION_TOKEN.trim();
    try {
        const vars = fs.readFileSync(path.join(ROOT, 'kofi-worker/.dev.vars'), 'utf8');
        const m = /^\s*KOFI_VERIFICATION_TOKEN\s*=\s*"?([^"\r\n]+)"?\s*$/m.exec(vars);
        if (m) return m[1].trim();
    } catch (e) { /* no file */ }
    return '';
}
function parseArgs(argv) {
    const o = {};
    for (let i = 0; i < argv.length; i++) {
        const a = argv[i];
        if (a === '--twice' || a === '--dry' || a === '--no-code' || a === '--help' || a === '-h') { o[a.replace(/^-+/, '')] = true; continue; }
        const m = /^--([a-z]+)(?:=(.*))?$/.exec(a);
        if (!m) throw new Error('unknown argument ' + a + ' (try --help)');
        o[m[1]] = m[2] !== undefined ? m[2] : argv[++i];
    }
    return o;
}
async function main() {
    const o = parseArgs(process.argv.slice(2));
    if (o.help || o.h) { console.log(fs.readFileSync(__filename, 'utf8').split('*/')[0].replace(/^#!.*\n\/\*\*\n/, '').replace(/^ \* ?/gm, '')); return 0; }
    if (!o.code && !o['no-code'] && !o.message) throw new Error('give --code WH-XXXX-XXXX-XXXX (your link code from Get more), or --no-code to test claiming');
    const token = readToken();
    if (!token && !o.dry) throw new Error('no verification token: set KOFI_VERIFICATION_TOKEN, or put KOFI_VERIFICATION_TOKEN=... in kofi-worker/.dev.vars');
    const worker = o.worker || (Config.isPlaceholder(Config.workerUrl) ? '' : Config.workerUrl);
    if (!worker && !o.dry) throw new Error('no worker address: pass --worker https://... or fill in workerUrl in core/premium-config.js');
    const payload = buildPayload({ token, code: o.code, amount: o.amount, currency: o.currency, txid: o.txid, type: o.type, item: o.item, tier: o.tier, email: o.email, message: o.message });
    if (o.dry) {
        console.log(JSON.stringify(Object.assign({}, payload, { verification_token: payload.verification_token ? '(your token)' : '(none)' }), null, 2));
        return 0;
    }
    const url = webhookUrl(worker);
    console.log('Sending a test ' + payload.type + ' of ' + payload.amount + ' ' + payload.currency + ' (' + payload.kofi_transaction_id + ') to ' + url);
    for (let i = 0; i < (o.twice ? 2 : 1); i++) {
        const res = await fetch(url, { method: 'POST', headers: { 'content-type': 'application/x-www-form-urlencoded' }, body: formBody(payload) });
        let body = null;
        try { body = await res.json(); } catch (e) { body = null; }
        console.log((o.twice ? '#' + (i + 1) + ' ' : '') + res.status + ' ' + JSON.stringify(body));
        console.log('   ' + explain(res.status, body, payload));
    }
    return 0;
}

if (require.main === module) {
    main().then((c) => process.exit(c), (e) => { console.error('kofi-test-payment: ' + e.message); process.exit(1); });
}
module.exports = { buildPayload, formBody, webhookUrl, explain, parseArgs };
