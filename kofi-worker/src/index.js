/**
 * The Ko-fi webhook for What Happened Clicker: a Cloudflare Worker that credits Beans ☕ when someone pays on Ko-fi.
 * Setup, secrets and deploying: docs/kofi-setup.md. Tests: tests/kofi-worker.test.js (fake Ko-fi, fake Google).
 *
 * Routes
 *   POST /kofi            Ko-fi's webhook. Answers 200 once the payment is safely handled (credited, kept as unmatched, a
 *                         duplicate, a test, or not worth Beans); anything else makes Ko-fi try again later.
 *   POST /claim           a signed-in player claims a payment that came without a link code: { txid, email }, with their
 *                         Firebase ID token as "Authorization: Bearer ...". Only from the game's own site (ALLOWED_ORIGINS).
 *   POST /admin/resolve   the owner gives an unmatched payment to a player: { txid, code: 'WH-XXXX-XXXX-XXXX' }, with
 *                         "Authorization: Bearer <ADMIN_TOKEN>".
 *   GET  /                says it's running.
 *
 * Secrets (wrangler secret put ..., never in the repo): KOFI_VERIFICATION_TOKEN, GCP_SERVICE_ACCOUNT, EMAIL_PEPPER, ADMIN_TOKEN.
 * Plain settings (wrangler.toml [vars]): FIREBASE_PROJECT_ID, ALLOWED_ORIGINS.
 *
 * What is kept about a payment (kofi_payments/{kofi_transaction_id}): its type, amount, currency, time, the shop items and
 * Beans, the link code and account it went to, and for a payment nobody has claimed yet a keyed hash of the payer's email.
 * Never the name, the email itself or the message. Payments worth no Beans (a plain tip) are not stored at all.
 */
import Config from '../../core/premium-config.js';
import Kofi from '../../core/kofi.js';
import { createFirestore, verifyIdToken } from './google.js';

const MAX_BODY = 100000;
const json = (status, body, headers) => new Response(JSON.stringify(body), {
    status, headers: Object.assign({ 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' }, headers || {}),
});

export default {
    fetch(request, env) { return handle(request, env); },
};

// deps (tests): { fetch, now, config }
export async function handle(request, env, deps = {}) {
    const url = new URL(request.url);
    const path = url.pathname.replace(/\/+$/, '') || '/';
    try {
        if (path === '/kofi') return request.method === 'POST' ? await webhook(request, env, deps) : json(405, { error: 'POST only' });
        if (path === '/claim') return await claim(request, env, deps);
        if (path === '/admin/resolve') return request.method === 'POST' ? await resolve(request, env, deps) : json(405, { error: 'POST only' });
        if (path === '/' && request.method === 'GET') return new Response('What Happened Clicker: Ko-fi webhook. Ko-fi posts payments to /kofi.\n', { status: 200 });
        return json(404, { error: 'not found' });
    } catch (e) {
        // never the payload: it holds the payer's name and email
        console.error('kofi-worker:', path, e && e.message);
        return json(500, { error: 'server error, try again later' });
    }
}

async function readBody(request) {
    const len = Number(request.headers.get('content-length') || 0);
    if (len > MAX_BODY) return null;
    const text = await request.text();
    return text.length > MAX_BODY ? null : text;
}
// Ko-fi posts application/x-www-form-urlencoded with the payment as JSON in the field `data`. Also takes the JSON on its own
// (handy for curl tests) and multipart forms.
async function readData(request) {
    const type = (request.headers.get('content-type') || '').toLowerCase();
    if (type.includes('multipart/form-data')) {
        const form = await request.formData();
        const d = form.get('data');
        return typeof d === 'string' ? d : '';
    }
    const text = await readBody(request);
    if (text === null) return null;
    if (type.includes('application/json')) return text;
    const d = new URLSearchParams(text).get('data');
    return d !== null ? d : text;
}

// ---------------- POST /kofi ----------------
async function webhook(request, env, deps) {
    const cfg = deps.config || Config;
    if (!env.KOFI_VERIFICATION_TOKEN) {
        console.error('kofi-worker: KOFI_VERIFICATION_TOKEN is not set');
        return json(500, { error: 'not configured' }); // Ko-fi keeps the payment and retries once the secret is in
    }
    const data = await readData(request);
    if (data === null) return json(413, { error: 'too big' });
    const parsed = Kofi.parseData(data);
    if (!parsed.ok) return json(400, { error: 'bad payload' });
    if (!Kofi.sameSecret(String(parsed.payload.verification_token || ''), env.KOFI_VERIFICATION_TOKEN)) return json(401, { error: 'bad verification token' });
    const n = Kofi.normalize(parsed.payload);
    if (!n.ok) return json(400, { error: n.reason });
    if (n.isTest) return json(200, { ok: true, test: true });

    const credit = Kofi.creditFor(n, cfg);
    if (credit.beans <= 0) return json(200, { ok: true, ignored: credit.reason });

    const db = createFirestore(env, deps);
    const linkId = Kofi.findLinkCode(n.message);
    let uid = '';
    if (linkId) {
        const link = await db.getDoc('kofi_links/' + linkId);
        if (link && typeof link.fields.uid === 'string' && link.fields.uid) uid = link.fields.uid;
    }
    const record = {
        status: uid ? 'credited' : 'unmatched', type: n.type, beans: credit.beans, amount: n.amountText, currency: n.currency,
        paidAt: n.timestamp, items: credit.lines, linkId, tier: n.type === 'Subscription' ? n.tier : '',
    };
    if (uid) record.uid = uid;
    else {
        record.why = linkId ? 'unknown-code' : 'no-code';
        if (n.email && env.EMAIL_PEPPER) record.emailHash = await Kofi.emailHash(n.email, env.EMAIL_PEPPER);
    }
    const writes = [db.create('kofi_payments/' + n.txid, record, ['receivedAt'])];
    if (uid) writes.push(...creditWrites(db, uid, n.txid, credit.beans, n.type, credit.lines));
    const r = await db.commit(writes);
    if (!r.ok) {
        // already handled (Ko-fi retried, or two deliveries crossed): that's a success for Ko-fi
        if (await db.getDoc('kofi_payments/' + n.txid)) return json(200, { ok: true, duplicate: true });
        throw new Error('commit failed (' + r.status + ' ' + r.error + ')');
    }
    console.log('kofi-worker: payment', uid ? 'credited' : 'kept as unmatched', credit.beans, 'Beans');
    return json(200, { ok: true, beans: credit.beans, matched: !!uid });
}

// the wallet goes up, and the payment is noted in the player's own history; the credit's id is the transaction id, so the
// same payment can never be credited twice even if two writes race
function creditWrites(db, uid, txid, beans, kind, items) {
    return [
        db.increment('wallets/' + uid, { balance: beans, total: beans }, ['updatedAt']),
        db.create('wallets/' + uid + '/credits/' + txid, { beans, kind, items }, ['at']),
    ];
}

// An unmatched payment goes to `uid`. by: 'claim' (the player) or 'owner'. Returns a Response-ready { status, body }.
async function giveUnmatched(db, txid, pay, uid, by) {
    const f = pay.fields;
    const writes = [
        db.patch('kofi_payments/' + txid, { status: 'credited', uid, by }, ['status', 'uid', 'by', 'emailHash'], { ifUpdateTime: pay.updateTime, timeFields: ['claimedAt'] }),
        ...creditWrites(db, uid, txid, Number(f.beans) || 0, f.type || 'Payment', Array.isArray(f.items) ? f.items : []),
    ];
    const r = await db.commit(writes);
    if (!r.ok) return { status: 409, body: { error: 'That payment was just claimed or changed. Check your Beans, then try again if they are missing.' } };
    return { status: 200, body: { ok: true, beans: Number(f.beans) || 0 } };
}

// ---------------- POST /claim (from the game) ----------------
function corsFor(request, env) {
    const origin = request.headers.get('origin') || '';
    const allowed = String(env.ALLOWED_ORIGINS || '').split(',').map((s) => s.trim()).filter(Boolean);
    if (!origin || !allowed.includes(origin)) return null;
    return { 'access-control-allow-origin': origin, 'access-control-allow-methods': 'POST, OPTIONS', 'access-control-allow-headers': 'authorization, content-type', 'access-control-max-age': '86400', vary: 'Origin' };
}
async function claim(request, env, deps) {
    const cors = corsFor(request, env);
    if (request.method === 'OPTIONS') return new Response(null, { status: cors ? 204 : 403, headers: cors || {} });
    if (request.method !== 'POST') return json(405, { error: 'POST only' }, cors);
    if (!cors) return json(403, { error: 'This site may not claim payments.' });
    if (!env.EMAIL_PEPPER) return json(503, { error: 'Claiming is not set up yet.' }, cors);
    const token = (request.headers.get('authorization') || '').replace(/^Bearer\s+/i, '');
    let who;
    try { who = await verifyIdToken(token, env.FIREBASE_PROJECT_ID, deps); } catch (e) { return json(401, { error: 'Sign in again, then try once more.' }, cors); }
    if (!who.provider || who.provider === 'anonymous') return json(403, { error: 'Sign in to an account first.' }, cors);
    let body = null;
    try { const t = await readBody(request); body = t ? JSON.parse(t) : null; } catch (e) { body = null; }
    const txid = body && typeof body.txid === 'string' ? body.txid.trim() : '';
    const email = body && typeof body.email === 'string' ? body.email.trim().toLowerCase() : '';
    if (!Kofi.TXID_RE.test(txid) || !/^[^@\s]{1,128}@[^@\s]{1,128}$/.test(email)) return json(400, { error: 'Enter the transaction ID and the email you paid with.' }, cors);
    const db = createFirestore(env, deps);
    const pay = await db.getDoc('kofi_payments/' + txid);
    const hash = await Kofi.emailHash(email, env.EMAIL_PEPPER);
    // one answer for "no such payment", "already claimed" and "wrong email", so the form can't be used to probe
    if (!pay || pay.fields.status !== 'unmatched' || !Kofi.sameSecret(String(pay.fields.emailHash || ''), hash))
        return json(404, { error: 'No unclaimed payment matches that transaction ID and email.' }, cors);
    const r = await giveUnmatched(db, txid, pay, who.uid, 'claim');
    return json(r.status, r.body, cors);
}

// ---------------- POST /admin/resolve (the owner) ----------------
async function resolve(request, env, deps) {
    const token = (request.headers.get('authorization') || '').replace(/^Bearer\s+/i, '');
    if (!env.ADMIN_TOKEN || !Kofi.sameSecret(token, env.ADMIN_TOKEN)) return json(401, { error: 'bad admin token' });
    let body = null;
    try { const t = await readBody(request); body = t ? JSON.parse(t) : null; } catch (e) { body = null; }
    const txid = body && typeof body.txid === 'string' ? body.txid.trim() : '';
    const code = body && typeof body.code === 'string' ? body.code : '';
    // beans: only for a payment the worker never stored (an item missing from the packs table, a tip before a rate was set)
    const beans = body && Number.isInteger(body.beans) ? body.beans : 0;
    const linkId = Kofi.findLinkCode(code) || Kofi.linkIdFromHex(code.replace(/[\s-]/g, ''));
    if (!Kofi.TXID_RE.test(txid) || !linkId) return json(400, { error: 'send { "txid": "...", "code": "WH-XXXX-XXXX-XXXX" } (and "beans": N for a payment that was not stored)' });
    const db = createFirestore(env, deps);
    const link = await db.getDoc('kofi_links/' + linkId);
    if (!link || typeof link.fields.uid !== 'string') return json(404, { error: 'no player has that link code (they must open Get Beans once while signed in)' });
    const uid = link.fields.uid;
    const pay = await db.getDoc('kofi_payments/' + txid);
    if (!pay) {
        const max = (deps.config || Config).maxBeansPerPayment || 100000;
        if (!(beans > 0 && beans <= max)) return json(404, { error: 'no stored payment with that transaction id; to credit it anyway, add "beans": N' });
        const record = { status: 'credited', type: 'Manual', beans, amount: '', currency: '', paidAt: '', items: [], linkId, tier: '', uid, by: 'owner' };
        const r = await db.commit([db.create('kofi_payments/' + txid, record, ['receivedAt']), ...creditWrites(db, uid, txid, beans, 'Manual', [])]);
        return r.ok ? json(200, { ok: true, beans }) : json(409, { error: 'that transaction id was just used; check kofi_payments' });
    }
    if (pay.fields.status !== 'unmatched') return json(409, { error: 'that payment is already ' + pay.fields.status });
    const r = await giveUnmatched(db, txid, pay, uid, 'owner');
    return json(r.status, r.body);
}
