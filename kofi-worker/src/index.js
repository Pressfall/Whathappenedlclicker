/**
 * The Ko-fi webhook for What Happened Clicker: a Cloudflare Worker that credits Holy What Happeneds 👼 when someone pays on Ko-fi.
 * Setup, secrets and deploying: docs/kofi-setup.md. Tests: tests/kofi-worker.test.js (fake Ko-fi, fake Google).
 *
 * Whose a payment is, in order: the link code in its message; the account noted for the payer's email (kofi_emails); the
 * one game account that signs in with that email and has verified it (Firebase Authentication, looked up by the worker).
 * So a Shop order (no message) paid with the player's sign-in email is credited at once, and nothing needs the player's
 * browser to reach this worker: school networks block *.workers.dev, and most players play at school.
 *
 * Every minute (Cron Trigger, wrangler.toml) the worker also answers the game's requests in Firestore kofi_requests/{uid}:
 * "collect" (hand over payments made with my verified email before my account existed or was verified) and "claim" (a
 * payment made with another email: { txid, email }). The game writes them straight to Firestore, which school networks
 * allow, and reads the answer there.
 *
 * Routes
 *   POST /kofi            Ko-fi's webhook. Answers 200 once the payment is safely handled (credited, kept as unmatched, a
 *                         duplicate, a test, or not worth Holy What Happeneds); anything else makes Ko-fi try again later.
 *   POST /collect         the same as a "collect" request, straight away, for a browser that can reach the worker: a
 *                         signed-in player whose sign-in email is verified. Notes the email (kofi_emails/<keyed hash> -> uid)
 *                         and hands over any payment still waiting. Firebase ID token as "Authorization: Bearer ...".
 *   POST /claim           a signed-in player claims a payment that came without a link code: { txid, email }, with their
 *                         Firebase ID token as "Authorization: Bearer ...". /collect and /claim: only from the game's own
 *                         site (ALLOWED_ORIGINS).
 *   POST /admin/resolve   the owner gives an unmatched payment to a player: { txid, code: 'WH-XXXX-XXXX-XXXX' }, with
 *                         "Authorization: Bearer <ADMIN_TOKEN>".
 *   GET  /                says it's running.
 *
 * Secrets (wrangler secret put ..., never in the repo): KOFI_VERIFICATION_TOKEN, GCP_SERVICE_ACCOUNT, EMAIL_PEPPER, ADMIN_TOKEN.
 * Plain settings (wrangler.toml [vars]): FIREBASE_PROJECT_ID, ALLOWED_ORIGINS.
 *
 * What is kept about a payment (kofi_payments/{kofi_transaction_id}): its type, amount, currency, time, the shop items and
 * Holy What Happeneds, the link code and account it went to, and for a payment nobody has claimed yet a keyed hash of the payer's email.
 * Never the name, the email itself or the message. Payments worth no Holy What Happeneds (a plain tip) are not stored at all.
 * kofi_emails/{keyed hash of an email}: { uid, at }, written by a collect for an account's own verified sign-in email.
 * kofi_requests/{uid}: the player's latest request; the answer replaces it (the email typed for a claim goes with it).
 */
import Config from '../../core/premium-config.js';
import Kofi from '../../core/kofi.js';
import { createFirestore, createAuthReader, verifyIdToken } from './google.js';

const MAX_BODY = 100000;
const json = (status, body, headers) => new Response(JSON.stringify(body), {
    status, headers: Object.assign({ 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' }, headers || {}),
});

export default {
    fetch(request, env) { return handle(request, env); },
    // the Cron Trigger (wrangler.toml): the game's collect and claim requests
    scheduled(event, env, ctx) {
        ctx.waitUntil(runRequests(env).catch((e) => console.error('kofi-worker: requests', e && e.message)));
    },
};

// deps (tests): { fetch, now, config }
export async function handle(request, env, deps = {}) {
    const url = new URL(request.url);
    const path = url.pathname.replace(/\/+$/, '') || '/';
    try {
        if (path === '/kofi') return request.method === 'POST' ? await webhook(request, env, deps) : json(405, { error: 'POST only' });
        if (path === '/claim') return await claim(request, env, deps);
        if (path === '/collect') return await collect(request, env, deps);
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
    // whose: the link code in the message, else the account whose verified sign-in email paid (a Shop order has no message)
    const linkId = Kofi.findLinkCode(n.message);
    let uid = '', by = '';
    if (linkId) {
        const link = await db.getDoc('kofi_links/' + linkId);
        if (link && typeof link.fields.uid === 'string' && link.fields.uid) { uid = link.fields.uid; by = 'code'; }
    }
    const emailHash = n.email && env.EMAIL_PEPPER ? await Kofi.emailHash(n.email, env.EMAIL_PEPPER) : '';
    if (!uid && emailHash) {
        const known = await db.getDoc('kofi_emails/' + emailHash);
        if (known && typeof known.fields.uid === 'string' && known.fields.uid) { uid = known.fields.uid; by = 'email'; }
    }
    if (!uid && n.email) {
        // the game account that signs in with this email (verified). A failed lookup only leaves the payment unmatched:
        // the player's next collect, or a claim, still finds it
        try {
            const found = await createAuthReader(env, deps).uidForEmail(n.email);
            if (found.uid) { uid = found.uid; by = 'account'; }
            else if (found.denied) console.error('kofi-worker: Firebase Auth refused the lookup: give the service account the "Firebase Authentication Viewer" role (docs/kofi-setup.md)');
        } catch (e) { console.error('kofi-worker: account lookup failed', e && e.message); }
    }
    const record = {
        status: uid ? 'credited' : 'unmatched', type: n.type, beans: credit.beans, amount: n.amountText, currency: n.currency,
        paidAt: n.timestamp, items: credit.lines, linkId, tier: n.type === 'Subscription' ? n.tier : '',
    };
    if (uid) { record.uid = uid; record.by = by; }
    else {
        record.why = linkId ? 'unknown-code' : 'no-code';
        if (emailHash) record.emailHash = emailHash;
    }
    const writes = [db.create('kofi_payments/' + n.txid, record, ['receivedAt'])];
    if (uid) writes.push(...creditWrites(db, uid, n.txid, credit.beans, n.type, credit.lines));
    const r = await db.commit(writes);
    if (!r.ok) {
        // already handled (Ko-fi retried, or two deliveries crossed): that's a success for Ko-fi
        if (await db.getDoc('kofi_payments/' + n.txid)) return json(200, { ok: true, duplicate: true });
        throw new Error('commit failed (' + r.status + ' ' + r.error + ')');
    }
    console.log('kofi-worker: payment', uid ? 'credited' : 'kept as unmatched', credit.beans, 'Holy What Happeneds');
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
    if (!r.ok) return { status: 409, body: { error: 'That payment was just claimed or changed. Check your Holy What Happeneds, then try again if they are missing.' } };
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
    const r = await claimFor(createFirestore(env, deps), env, who.uid, txid, email);
    return json(r.status, r.body, cors);
}
// A payment made with `email` (and no code that matched) goes to `uid`: { status, body }
async function claimFor(db, env, uid, txid, email) {
    const pay = await db.getDoc('kofi_payments/' + txid);
    const hash = await Kofi.emailHash(email, env.EMAIL_PEPPER);
    // one answer for "no such payment", "already claimed" and "wrong email", so the form can't be used to probe
    if (!pay || pay.fields.status !== 'unmatched' || !Kofi.sameSecret(String(pay.fields.emailHash || ''), hash))
        return { status: 404, body: { error: 'No unclaimed payment matches that transaction ID and email.' } };
    return giveUnmatched(db, txid, pay, uid, 'claim');
}

// ---------------- POST /collect (from the game) ----------------
// The player's account says which email is theirs (Google checked it, or they clicked the verification link), so Ko-fi
// payments made with that email are theirs. Safe to call often: it reads two things and writes only what changed.
async function collect(request, env, deps) {
    const cors = corsFor(request, env);
    if (request.method === 'OPTIONS') return new Response(null, { status: cors ? 204 : 403, headers: cors || {} });
    if (request.method !== 'POST') return json(405, { error: 'POST only' }, cors);
    if (!cors) return json(403, { error: 'This site may not collect payments.' });
    if (!env.EMAIL_PEPPER) return json(503, { error: 'Collecting is not set up yet.' }, cors);
    const token = (request.headers.get('authorization') || '').replace(/^Bearer\s+/i, '');
    let who;
    try { who = await verifyIdToken(token, env.FIREBASE_PROJECT_ID, deps); } catch (e) { return json(401, { error: 'Sign in again, then try once more.' }, cors); }
    if (!who.provider || who.provider === 'anonymous') return json(403, { error: 'Sign in to an account first.' }, cors);
    if (!who.emailVerified) return json(403, { error: 'Verify your account\'s email first (on the Account page), or claim with the transaction ID.', reason: 'unverified' }, cors);
    const r = await collectFor(createFirestore(env, deps), env, who.uid, who.email);
    return json(200, { ok: true, beans: r.beans, count: r.count }, cors);
}
// `email` is `uid`'s verified sign-in email: note it, and hand over the payments made with it that are still waiting
async function collectFor(db, env, uid, email) {
    const hash = await Kofi.emailHash(email, env.EMAIL_PEPPER);
    const known = await db.getDoc('kofi_emails/' + hash);
    if (!known || known.fields.uid !== uid) {
        const r = await db.commit([db.set('kofi_emails/' + hash, { uid }, ['at'])]);
        if (!r.ok) throw new Error('commit failed (' + r.status + ' ' + r.error + ')');
    }
    // payments made with this email before the account was noted (or while it belonged to no account)
    const waiting = (await db.where('kofi_payments', 'emailHash', hash)).filter((p) => p.fields.status === 'unmatched');
    let beans = 0, count = 0;
    for (const pay of waiting) {
        const r = await giveUnmatched(db, pay.id, pay, uid, 'email');
        if (r.status === 200) { beans += r.body.beans; count++; }
    }
    return { beans, count };
}

// ---------------- the game's requests (Firestore kofi_requests/{uid}, every minute) ----------------
// The game writes { kind: 'collect' | 'claim', status: 'pending', at, txid?, email? } as the signed-in player (the rules let
// an account write only its own, and only a pending one). The answer replaces the request: { kind, status: 'done' | 'failed',
// beans, count, error, reason, doneAt }. Returns how many were answered.
export async function runRequests(env, deps = {}) {
    if (!env.EMAIL_PEPPER) return 0;
    const db = createFirestore(env, deps), auth = createAuthReader(env, deps);
    const list = await db.where('kofi_requests', 'status', 'pending', 25);
    let done = 0;
    for (const req of list) {
        let answer;
        try { answer = await answerRequest(db, auth, env, req.id, req.fields); }
        catch (e) {
            console.error('kofi-worker: request failed', e && e.message);
            answer = { status: 'failed', error: 'The server had a problem. Try again in a minute.' };
        }
        // unless the player asked again meanwhile (then that one is answered next time)
        const r = await db.commit([db.set('kofi_requests/' + req.id, Object.assign({ kind: String(req.fields.kind || '') }, answer), ['doneAt'], { ifUpdateTime: req.updateTime })]);
        if (r.ok) done++;
    }
    return done;
}
async function answerRequest(db, auth, env, uid, f) {
    const acct = await auth.account(uid);
    if (acct.denied) {
        console.error('kofi-worker: Firebase Auth refused the lookup: give the service account the "Firebase Authentication Viewer" role (docs/kofi-setup.md)');
        return { status: 'failed', error: 'The server can\'t check accounts yet. Try again later.' };
    }
    const u = acct.user;
    if (!u || u.disabled || !u.providers.length) return { status: 'failed', error: 'Sign in to an account first.' };
    if (f.kind === 'collect') {
        if (!u.email || !u.emailVerified) return { status: 'failed', reason: 'unverified', error: 'Verify your account\'s email first (on the Account page), or claim with the transaction ID.' };
        const r = await collectFor(db, env, uid, u.email);
        return { status: 'done', beans: r.beans, count: r.count };
    }
    if (f.kind === 'claim') {
        const txid = typeof f.txid === 'string' ? f.txid.trim() : '', email = typeof f.email === 'string' ? f.email.trim().toLowerCase() : '';
        if (!Kofi.TXID_RE.test(txid) || !/^[^@\s]{1,128}@[^@\s]{1,128}$/.test(email)) return { status: 'failed', error: 'Enter the transaction ID and the email you paid with.' };
        const r = await claimFor(db, env, uid, txid, email);
        return r.status === 200 ? { status: 'done', beans: r.body.beans, count: 1 } : { status: 'failed', error: r.body.error };
    }
    return { status: 'failed', error: 'Unknown request.' };
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
    if (!link || typeof link.fields.uid !== 'string') return json(404, { error: 'no player has that link code (they must open Get more once while signed in)' });
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
