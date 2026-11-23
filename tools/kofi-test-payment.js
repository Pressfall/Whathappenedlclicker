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
 *   node tools/kofi-test-payment.js --type "Shop Order" --item f2573687e6 --amount 2 --no-code --email you@example.com
 *                                     a Small Shop pack paid with that email: credited at once if it is the verified sign-in
 *                                     email of an account that has opened Get more, else kept until that account does
 *   node tools/kofi-test-payment.js --dry --code WH-...                         print what would be sent, send nothing
 *   node tools/kofi-test-payment.js --check                                     can the worker be reached? (no token, no payment)
 *
 * It uses a proxy named in HTTPS_PROXY and trusts the certificates Windows trusts, like a browser; see "reaching the worker"
 * below. A school or work web filter that blocks workers.dev addresses blocks this too: run it from another network then.
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
// A web filter's block page instead of the worker's answer. Some filters (the school district's ContentKeeper, 2026-11-21)
// answer a blocked address with their own page and a 200, so a status alone says nothing: look at what came back.
function isFilterPage(text) {
    return /CK-BLOCK|ContentKeeper|Content Filtering|Web Filter|has been blocked|Access Denied|Blocked Site/i.test(String(text || '').slice(0, 4000));
}
// the worker's front page (GET /) says this
const FRONT_PAGE = /What Happened Clicker: Ko-fi webhook/;
const FILTERED = 'A web filter answered instead of the worker (its block page), so this never reached the worker and nothing was'
    + ' credited. Run test payments from another network, such as home. Ko-fi\'s own payments are not affected: they reach the'
    + ' worker from Ko-fi\'s servers.';

// What the worker's answer means, in a sentence
function explain(status, body, payload) {
    if (status === 401) return 'Refused: the verification token doesn\'t match the worker\'s KOFI_VERIFICATION_TOKEN secret.';
    if (status === 500 && body && body.error === 'not configured') return 'The worker has no KOFI_VERIFICATION_TOKEN secret yet (docs/kofi-setup.md, step 4).';
    if (status >= 500) return 'The worker failed (Ko-fi would try again later). See `npx wrangler tail` in kofi-worker/ for why.';
    if (status !== 200 || !body) return 'Unexpected answer ' + status + '.';
    if (body.test) return 'Treated as Ko-fi\'s own test payment: nothing credited.';
    if (body.duplicate) return 'Already handled before (the same transaction id): nothing credited again. That is the protection against Ko-fi\'s retries.';
    if (body.ignored) return 'Not worth Holy What Happeneds (' + body.ignored + '): nothing credited, nothing stored. Check the amount, the currency or the item.';
    if (body.matched) return 'Credited ' + body.beans + ' Holy What Happeneds to the account with that link code, or whose verified sign-in email paid. The 👼 chip in the game should go up within a few seconds.';
    return 'Kept as unmatched (' + body.beans + ' Holy What Happeneds waiting). If ' + payload.email + ' is the email of a game account, opening 👼 > Get more there'
        + ' (or pressing Check now) collects it. Otherwise claim it: 👼 > Get more > "Paid with another email, or without your code?", transaction ID '
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
        if (a === '--twice' || a === '--dry' || a === '--no-code' || a === '--check' || a === '--help' || a === '-h') { o[a.replace(/^-+/, '')] = true; continue; }
        const m = /^--([a-z]+)(?:=(.*))?$/.exec(a);
        if (!m) throw new Error('unknown argument ' + a + ' (try --help)');
        o[m[1]] = m[2] !== undefined ? m[2] : argv[++i];
    }
    return o;
}
async function main() {
    const o = parseArgs(process.argv.slice(2));
    if (o.help || o.h) { console.log(fs.readFileSync(__filename, 'utf8').split('*/')[0].replace(/^#!.*\n\/\*\*\n/, '').replace(/^ \* ?/gm, '')); return 0; }
    if (o.check) {
        const w = o.worker || (Config.isPlaceholder(Config.workerUrl) ? '' : Config.workerUrl);
        if (!w) throw new Error('no worker address: pass --worker https://... or fill in workerUrl in core/premium-config.js');
        return check(w);
    }
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
        const text = await res.text().catch(() => '');
        let body = null;
        try { body = JSON.parse(text); } catch (e) { body = null; }
        if (body === null && isFilterPage(text)) { console.log(res.status + ' ' + FILTERED); return 1; }
        console.log((o.twice ? '#' + (i + 1) + ' ' : '') + res.status + ' ' + JSON.stringify(body));
        console.log('   ' + explain(res.status, body, payload));
    }
    return 0;
}

// ---------------- reaching the worker ----------------
// Node's fetch ignores HTTPS_PROXY unless NODE_USE_ENV_PROXY=1 was set when it started, and trusts only its own list of
// certificates, not Windows'. Both differ from a browser, and either one can end in "fetch failed" on a network a browser
// gets through. So the script starts Node again, once, with the proxy (when HTTPS_PROXY names one) and Windows' certificates.
// A web filter that blocks the address itself (as a school district's may block every workers.dev address) still wins:
// that shows as SELF_SIGNED_CERT_IN_CHAIN, ECONNRESET or a timeout, and only another network helps.

// how to start Node again: { args, env, proxy } (args go before the script's own)
function relaunch(env, allowed) {
    const out = Object.assign({}, env, { WH_KOFI_TEST_RELAUNCHED: '1' });
    const proxy = env.HTTPS_PROXY || env.https_proxy || env.HTTP_PROXY || env.http_proxy || '';
    if (proxy) {
        if (!env.HTTPS_PROXY && !env.https_proxy) out.HTTPS_PROXY = proxy;
        if (!env.NO_PROXY && !env.no_proxy) out.NO_PROXY = 'localhost,127.0.0.1,::1'; // wrangler dev stays direct
        out.NODE_USE_ENV_PROXY = '1';
    }
    const args = [];
    if (proxy && allowed.has('--disable-warning')) args.push('--disable-warning=UNDICI-EHPA'); // "EnvHttpProxyAgent is experimental"
    if (allowed.has('--use-system-ca')) args.push('--use-system-ca');
    return { args, env: out, proxy };
}

// --check: can the worker be reached at all (a GET of its front page: no token, no payment). Only the worker's own front
// page counts: a filter's block page can come with a 200 too.
async function check(worker) {
    const url = webhookUrl(worker).replace(/\/kofi$/, '/');
    const res = await fetch(url);
    const text = await res.text().catch(() => '');
    const r = checkResult(res.status, text);
    console.log(url + ': ' + r.text);
    return r.ok ? 0 : 1;
}
function checkResult(status, text) {
    if (isFilterPage(text)) return { ok: false, text: 'blocked. ' + FILTERED };
    if (status === 200 && FRONT_PAGE.test(text)) return { ok: true, text: 'the worker answered. Test payments will get through.' };
    return { ok: false, text: status + ', but the answer isn\'t the worker\'s front page. Check the --worker address.' };
}

if (require.main === module) {
    if (process.env.WH_KOFI_TEST_RELAUNCHED !== '1') {
        const { spawnSync } = require('child_process');
        const r = relaunch(process.env, process.allowedNodeEnvironmentFlags);
        const child = spawnSync(process.execPath, r.args.concat(__filename, process.argv.slice(2)), { stdio: 'inherit', env: r.env });
        process.exit(child.status === null ? 1 : child.status);
    }
    main().then((c) => process.exit(c), (e) => {
        const cause = e && e.cause && (e.cause.code || e.cause.message);
        const filtered = /SELF_SIGNED_CERT_IN_CHAIN|ECONNRESET|UND_ERR_CONNECT_TIMEOUT|ETIMEDOUT/.test(String(cause));
        console.error('kofi-test-payment: ' + e.message + (cause ? ' (' + cause + ')' : '')
            + (!/fetch failed/.test(e.message) ? ''
                : filtered ? '\n  The worker could not be reached from this network. A school or work web filter that blocks workers.dev addresses'
                    + '\n  looks like this (open the worker address in a browser: a block page says so). Run this from another network.'
                    + '\n  Ko-fi itself is not affected: its payments reach the worker from Ko-fi\'s servers.'
                : '\n  The worker could not be reached. Check the --worker address and your connection; `--check` tests just that.'));
        process.exit(1);
    });
}
module.exports = { buildPayload, formBody, webhookUrl, explain, parseArgs, relaunch, isFilterPage, checkResult };
