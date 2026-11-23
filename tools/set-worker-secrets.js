#!/usr/bin/env node
/**
 * Give the Ko-fi worker (kofi-worker/) its four secrets in one go. Run it yourself, from the project folder:
 *
 *   node tools/set-worker-secrets.js
 *
 * It asks for your Ko-fi verification token (ko-fi.com/manage/webhooks > Advanced; hidden as you type), finds the Google
 * service account key you downloaded (whleaderboard-*.json in Downloads, or asks for its path), makes the email pepper and
 * the admin token itself, and stores all four as Cloudflare secrets with `npx wrangler secret put` (you must have run
 * `npx wrangler login` once). No secret is printed. The two you may need again are saved in kofi-worker/.dev.vars, which git
 * ignores: KOFI_VERIFICATION_TOKEN (the test-payment script reads it) and ADMIN_TOKEN (for crediting a payment by hand).
 * At the end it lists the worker's secret names and offers to delete the key file.
 *
 *   --dry-run   ask everything and check it, but store nothing in Cloudflare
 * Run it again any time to replace the secrets (a new pepper means unclaimed payments can't be claimed any more, so it keeps
 * the pepper already saved in .dev.vars unless you pass --new-pepper).
 */
'use strict';
const fs = require('fs');
const os = require('os');
const path = require('path');
const crypto = require('crypto');
const readline = require('readline');
const { spawnSync } = require('child_process');

const ROOT = path.resolve(__dirname, '..');
const WORKER = path.join(ROOT, 'kofi-worker');
const DEV_VARS = process.env.WH_SECRETS_DEVVARS || path.join(WORKER, '.dev.vars');
const DOWNLOADS = process.env.WH_SECRETS_DOWNLOADS || path.join(os.homedir(), 'Downloads');
const DRY = process.argv.includes('--dry-run');
const NEW_PEPPER = process.argv.includes('--new-pepper');

// ---------------- asking ----------------
const tty = !!process.stdin.isTTY;
const rl = readline.createInterface({ input: process.stdin, output: process.stdout, terminal: tty });
let muted = false;
rl._writeToOutput = function (s) { if (muted && !/[\r\n]/.test(s)) rl.output.write('*'.repeat(s.length ? 1 : 0)); else rl.output.write(s); };
const lines = [];
let waiting = null;
if (!tty) rl.on('line', (l) => { if (waiting) { const w = waiting; waiting = null; w(l); } else lines.push(l); });
function ask(question, hidden) {
    if (!tty) {
        process.stdout.write(question + '\n');
        return new Promise((resolve) => { if (lines.length) resolve(lines.shift()); else waiting = resolve; });
    }
    return new Promise((resolve) => {
        rl.question(question, (a) => { muted = false; if (hidden) process.stdout.write('\n'); resolve(a); });
        muted = !!hidden;
    });
}

// ---------------- checks ----------------
function readKey(file) {
    let k;
    try { k = JSON.parse(fs.readFileSync(file, 'utf8')); } catch (e) { return { ok: false, why: 'it is not a JSON file' }; }
    if (!k || k.type !== 'service_account' || typeof k.client_email !== 'string' || typeof k.private_key !== 'string') return { ok: false, why: 'it is not a service account key' };
    if (k.project_id !== 'whleaderboard') return { ok: false, why: 'it is for the project "' + k.project_id + '", not whleaderboard' };
    return { ok: true, email: k.client_email };
}
// the newest key file in Downloads that looks like ours
function findKey() {
    let names = [];
    try { names = fs.readdirSync(DOWNLOADS); } catch (e) { return ''; }
    const found = names.filter((n) => /\.json$/i.test(n) && /whleaderboard/i.test(n))
        .map((n) => path.join(DOWNLOADS, n)).filter((f) => readKey(f).ok)
        .sort((a, b) => fs.statSync(b).mtimeMs - fs.statSync(a).mtimeMs);
    return found[0] || '';
}
function readDevVars() {
    const out = {};
    try { for (const l of fs.readFileSync(DEV_VARS, 'utf8').split(/\r?\n/)) { const m = /^\s*([A-Z_]+)\s*=\s*"?([^"]*)"?\s*$/.exec(l); if (m) out[m[1]] = m[2]; } } catch (e) {}
    return out;
}
function writeDevVars(vars) {
    const body = '# Local secrets for the Ko-fi worker (written by tools/set-worker-secrets.js). Never commit or share this file.\n'
        + Object.entries(vars).map(([k, v]) => k + '=' + v).join('\n') + '\n';
    fs.writeFileSync(DEV_VARS, body, { encoding: 'utf8', mode: 0o600 });
}
const random = () => crypto.randomBytes(32).toString('hex');
// Ko-fi's verification token is one code like 1a2b3c4d-5e6f-7a8b-9c0d-1e2f3a4b5c6d. When the paste carried more (a label, the
// token twice, spaces), the one code in it is used. { token, note } or { token: '', note } when there is no such code.
const KOFI_TOKEN_RE = /[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/gi;
function cleanToken(raw) {
    const s = String(raw || '').trim();
    const found = [...new Set((s.match(KOFI_TOKEN_RE) || []).map((x) => x.toLowerCase()))];
    if (found.length === 1) return { token: found[0], note: found[0].length === s.length ? '' : 'Took the token out of what you pasted (it had other text around it).' };
    if (found.length > 1) return { token: '', note: 'That paste holds more than one code; paste just the Verification Token.' };
    return { token: '', note: 'That doesn\'t look like a Ko-fi verification token (one code like 1a2b3c4d-5e6f-7a8b-9c0d-1e2f3a4b5c6d).' };
}

// ---------------- Cloudflare ----------------
function wrangler(args, input) {
    return spawnSync('npx', ['wrangler'].concat(args), {
        cwd: WORKER, input, encoding: 'utf8', shell: process.platform === 'win32',
        stdio: [input === undefined ? 'inherit' : 'pipe', 'pipe', 'pipe'],
    });
}
function putSecret(name, value) {
    if (DRY) { console.log('  (dry run) would store ' + name); return true; }
    const r = wrangler(['secret', 'put', name], value);
    if (r.status === 0) { console.log('  stored ' + name); return true; }
    console.log('  could not store ' + name + ':\n' + String(r.stderr || r.stdout || '').split('\n').filter(Boolean).slice(-4).map((l) => '    ' + l).join('\n'));
    return false;
}

async function main() {
    console.log('Setting the Ko-fi worker\'s secrets' + (DRY ? ' (dry run: nothing is stored)' : '') + '.\n');
    if (!DRY) {
        const who = wrangler(['whoami']);
        if (who.status !== 0 || /not authenticated|You are not/i.test(who.stdout + who.stderr)) {
            console.log('Wrangler is not logged in. Run this first, in kofi-worker:  npx wrangler login');
            return 1;
        }
    }
    const saved = readDevVars();

    // 1. the Ko-fi verification token
    let token = '';
    while (!token) {
        const raw = (await ask('Ko-fi verification token (ko-fi.com/manage/webhooks > Advanced; hidden as you type): ', true)).trim();
        if (!raw) { console.log('  Nothing typed; paste the token and press Enter.'); continue; }
        const c = cleanToken(raw);
        if (c.note) console.log('  ' + c.note);
        if (c.token) { token = c.token; continue; }
        const a = (await ask('  Store it exactly as typed anyway? [y/N] ')).trim().toLowerCase();
        if (a === 'y' || a === 'yes') token = raw;
    }

    // 2. the service account key. Running this again after the key file was deleted: Enter keeps the one on the worker.
    let keyFile = findKey(), keepKey = false;
    if (keyFile) {
        const a = (await ask('Use the key file ' + keyFile + '? [Y/n] ')).trim().toLowerCase();
        if (a === 'n' || a === 'no') keyFile = '';
    }
    while (!keyFile && !keepKey) {
        const p = (await ask('Path to the service account key (.json), or just Enter to keep the key already on the worker: ')).trim().replace(/^"|"$/g, '');
        if (!p) { keepKey = true; break; }
        const chk = readKey(p);
        if (chk.ok) keyFile = p; else console.log('  That file can\'t be used: ' + chk.why + '.');
    }
    if (keyFile) console.log('  Key for ' + readKey(keyFile).email);
    else console.log('  Keeping the service account key the worker already has.');

    // 3. the pepper (kept if it already exists: changing it would orphan unclaimed payments) and the admin token
    const pepper = (!NEW_PEPPER && saved.EMAIL_PEPPER) || random();
    const admin = random();

    console.log('\nStoring them in Cloudflare (worker wh-kofi):');
    const ok = [
        putSecret('KOFI_VERIFICATION_TOKEN', token),
        keepKey ? true : putSecret('GCP_SERVICE_ACCOUNT', fs.readFileSync(keyFile, 'utf8')),
        putSecret('EMAIL_PEPPER', pepper),
        putSecret('ADMIN_TOKEN', admin),
    ].every(Boolean);

    if (!ok) { console.log('\nNot all secrets were stored; nothing was saved locally. Fix the error above and run this again.'); return 1; }
    if (!DRY) writeDevVars(Object.assign({}, saved, { KOFI_VERIFICATION_TOKEN: token, EMAIL_PEPPER: pepper, ADMIN_TOKEN: admin }));
    console.log('\n' + (DRY ? 'Would save' : 'Saved') + ' KOFI_VERIFICATION_TOKEN, EMAIL_PEPPER and ADMIN_TOKEN in ' + path.relative(ROOT, DEV_VARS) + ' (git ignores it).');

    if (!DRY) {
        const list = wrangler(['secret', 'list']);
        const names = (String(list.stdout).match(/"name":\s*"([A-Z_]+)"/g) || []).map((s) => s.replace(/.*"([A-Z_]+)"$/, '$1'));
        console.log('Secrets on the worker: ' + (names.length ? names.join(', ') : '(could not read the list; run  npx wrangler secret list  in kofi-worker)'));
    }

    if (keyFile) {
        const del = (await ask('\nDelete the key file ' + keyFile + ' now (the worker has its own copy)? [y/N] ')).trim().toLowerCase();
        if ((del === 'y' || del === 'yes') && !DRY) { fs.unlinkSync(keyFile); console.log('  Deleted. Empty the Recycle Bin too if it went there.'); }
        else console.log('  Kept. Delete it yourself once you are done.');
    }
    console.log('\nDone. Next: on ko-fi.com/manage/webhooks, press "Send single tip test".');
    return 0;
}

module.exports = { readKey, findKey, readDevVars, cleanToken };
if (require.main === module) {
    main().then((c) => { rl.close(); process.exit(c); }, (e) => { rl.close(); console.error('set-worker-secrets: ' + e.message); process.exit(1); });
} else rl.close();
