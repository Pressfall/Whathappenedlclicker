/**
 * Account page (account.html): sign in with Google or email, create an account (this device's progress is saved to
 * it straight away), reset a forgotten password, see and sync this device's progress with the account, restore the
 * backup, change the password and delete the account. Accounts and syncing live in cloud.js.
 */
import {
    auth, watchAuth, signInGoogle, signInEmail, createAccount, sendReset, resendVerification, usesPassword, usesGoogle,
    collectLocal, summarize, statsHtml, fetchCloud, readMeta, readBackup, reconcile, uploadLocal, loadCloudIntoDevice,
    restoreBackup, chooseProgress, changePassword, deleteAccount, signOutUser, errorMessage, fmtAgo, SyncConflict,
} from './cloud.js';

const $ = id => document.getElementById(id);
function esc(s) { return String(s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', '\'': '&#39;' })[c]); }
function show(el, on) { if (el) el.hidden = !on; }
// kind: '' (error), 'ok' or 'info'
function msg(el, text, kind) {
    if (!el) return;
    el.textContent = text || '';
    el.className = 'acc-msg' + (kind ? ' acc-msg--' + kind : '');
    el.hidden = !text;
}
// disable a button while its action runs, so a double click can't send it twice
async function busy(btn, label, fn) {
    const old = btn.textContent;
    btn.disabled = true;
    if (label) btn.textContent = label;
    try { return await fn(); }
    finally { btn.disabled = false; btn.textContent = old; }
}

// ---------------- passwords ----------------
// Firebase stores and hashes passwords; these rules only stop weak ones at the door
const COMMON = new Set(['password', 'password1', 'password12', 'password123', 'passw0rd', '12345678', '123456789', '1234567890',
    '87654321', '11111111', '00000000', 'qwerty12', 'qwerty123', 'qwertyuiop', '1q2w3e4r', 'q1w2e3r4', 'zaq12wsx', 'abc12345',
    'abcd1234', 'iloveyou1', 'letmein1', 'welcome1', 'trustno1', 'admin123', 'sunshine1', 'princess1', 'football1',
    'baseball1', 'dragon123', 'monkey123', 'starwars1', 'minecraft1', 'fortnite1', 'roblox123', 'whathappened',
    'whathappened1', 'whathappened123', 'clicker123']);
function passwordChecks(pw, email) {
    const local = String(email || '').split('@')[0].toLowerCase();
    return {
        length: pw.length >= 8,
        mix: /[a-z]/i.test(pw) && /\d/.test(pw),
        common: !!pw && !COMMON.has(pw.toLowerCase()) && !(local.length >= 3 && pw.toLowerCase().includes(local)),
    };
}
function passwordStrength(pw) {
    let s = 0;
    if (pw.length >= 8) s++;
    if (pw.length >= 12) s++;
    if (/[a-z]/.test(pw) && /[A-Z]/.test(pw)) s++;
    if (/\d/.test(pw) && /[^a-z0-9]/i.test(pw)) s++;
    return s; // 0..4
}
function renderRules(box, meter, pw, email) {
    const c = passwordChecks(pw, email);
    box.querySelectorAll('[data-rule]').forEach(li => li.classList.toggle('ok', !!c[li.dataset.rule] && !!pw));
    const s = pw ? passwordStrength(pw) : 0;
    meter.style.width = (s * 25) + '%';
    meter.dataset.level = String(s);
    return c.length && c.mix && c.common;
}
document.querySelectorAll('.pw-toggle').forEach(b => b.addEventListener('click', () => {
    const input = $(b.dataset.for);
    const showing = input.type === 'text';
    input.type = showing ? 'password' : 'text';
    b.textContent = showing ? 'Show' : 'Hide';
    b.setAttribute('aria-label', showing ? 'Show password' : 'Hide password');
    b.setAttribute('aria-pressed', showing ? 'false' : 'true');
}));
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;

// ---------------- signed out ----------------
let mode = 'signin';
function setMode(m) {
    mode = m;
    ['signin', 'signup'].forEach(k => {
        const tab = $(k === 'signin' ? 'tabSignin' : 'tabSignup');
        tab.setAttribute('aria-selected', k === m ? 'true' : 'false');
        tab.classList.toggle('active', k === m);
    });
    const signup = m === 'signup';
    show($('confirmRow'), signup);
    show($('pwRules'), signup);
    show($('forgotBtn'), !signup);
    $('authPassword').autocomplete = signup ? 'new-password' : 'current-password';
    $('authSubmit').textContent = signup ? 'Create account and save progress' : 'Sign in';
    msg($('authMsg'), '');
}
document.querySelectorAll('.acc-tab').forEach(t => t.addEventListener('click', () => setMode(t.dataset.mode)));
$('authPassword').addEventListener('input', () => { if (mode === 'signup') renderRules($('pwRules'), $('pwMeter'), $('authPassword').value, $('authEmail').value); });
$('authEmail').addEventListener('input', () => { if (mode === 'signup') renderRules($('pwRules'), $('pwMeter'), $('authPassword').value, $('authEmail').value); });

$('authForm').addEventListener('submit', e => {
    e.preventDefault();
    const email = $('authEmail').value.trim(), pw = $('authPassword').value;
    if (!EMAIL_RE.test(email)) { msg($('authMsg'), 'Enter a valid email address.'); $('authEmail').focus(); return; }
    if (!pw) { msg($('authMsg'), 'Enter your password.'); $('authPassword').focus(); return; }
    if (mode === 'signup') {
        if (!renderRules($('pwRules'), $('pwMeter'), pw, email)) { msg($('authMsg'), 'Choose a password that meets all three requirements.'); $('authPassword').focus(); return; }
        if (pw !== $('authConfirm').value) { msg($('authMsg'), 'The passwords don\'t match.'); $('authConfirm').focus(); return; }
    }
    msg($('authMsg'), '');
    busy($('authSubmit'), mode === 'signup' ? 'Creating account…' : 'Signing in…', async () => {
        try {
            if (mode === 'signup') await createAccount(email, pw);
            else await signInEmail(email, pw);
            $('authPassword').value = ''; $('authConfirm').value = '';
        } catch (err) { msg($('authMsg'), errorMessage(err)); }
    });
});
// signInGoogle must start inside the click (no await before it) or the browser blocks the pop-up
$('googleBtn').addEventListener('click', () => {
    msg($('authMsg'), '');
    const btn = $('googleBtn');
    btn.disabled = true;
    signInGoogle().catch(err => { const m = errorMessage(err); if (m) msg($('authMsg'), m); }).finally(() => { btn.disabled = false; });
});
$('forgotBtn').addEventListener('click', () => {
    show($('authForm'), false); show($('resetForm'), true);
    $('resetEmail').value = $('authEmail').value.trim();
    msg($('resetMsg'), '');
    $('resetEmail').focus();
});
$('resetBack').addEventListener('click', () => { show($('resetForm'), false); show($('authForm'), true); });
$('resetForm').addEventListener('submit', e => {
    e.preventDefault();
    const email = $('resetEmail').value.trim();
    if (!EMAIL_RE.test(email)) { msg($('resetMsg'), 'Enter a valid email address.'); return; }
    busy($('resetSubmit'), 'Sending…', async () => {
        try {
            await sendReset(email);
            // the same answer whether or not the email has an account
            msg($('resetMsg'), 'If there\'s an account for that email, a reset link is on its way. Check your inbox and spam folder.', 'ok');
        } catch (err) {
            const code = err && err.code;
            if (code === 'auth/user-not-found' || code === 'auth/invalid-email') msg($('resetMsg'), 'If there\'s an account for that email, a reset link is on its way. Check your inbox and spam folder.', 'ok');
            else msg($('resetMsg'), errorMessage(err));
        }
    });
});
function renderDevice() { $('deviceStats').innerHTML = statsHtml(summarize(collectLocal().data)); }

// ---------------- signed in ----------------
let user = null, cloud = null, conflict = false;
function renderProfile() {
    const name = user.displayName || (user.email ? user.email.split('@')[0] : 'Player');
    $('accName').textContent = name;
    $('accEmail').textContent = user.email || '';
    const avatar = $('accAvatar');
    avatar.textContent = '';
    if (user.photoURL && /^https:\/\/[a-z0-9.-]+\.googleusercontent\.com\//i.test(user.photoURL)) {
        const img = document.createElement('img');
        img.src = user.photoURL; img.alt = ''; img.referrerPolicy = 'no-referrer';
        avatar.appendChild(img);
    } else avatar.textContent = name.charAt(0).toUpperCase();
    const chips = [];
    if (usesGoogle(user)) chips.push('<span class="acc-chip">Google</span>');
    if (usesPassword(user)) chips.push('<span class="acc-chip">Email and password</span>');
    chips.push(user.emailVerified ? '<span class="acc-chip acc-chip--ok">✓ Email verified</span>' : '<span class="acc-chip acc-chip--warn">Email not verified</span>');
    $('accChips').innerHTML = chips.join('');
    show($('verifyBox'), usesPassword(user) && !user.emailVerified);
    show($('pwForm'), usesPassword(user));
    show($('googleNote'), !usesPassword(user) && usesGoogle(user));
    show($('deletePwRow'), usesPassword(user));
    $('pwUser').value = user.email || '';
}
function renderSync(status, kind) {
    const local = collectLocal(), meta = readMeta();
    $('localStats').innerHTML = statsHtml(summarize(local.data));
    if (cloud) {
        $('cloudStats').innerHTML = statsHtml(cloud.summary || {});
        $('cloudWhen').textContent = `Saved ${fmtAgo(cloud.updatedAt)}${cloud.device ? ' from ' + cloud.device : ''}`;
    } else {
        $('cloudStats').innerHTML = '<p class="acc-empty">Nothing saved yet.</p>';
        $('cloudWhen').textContent = '';
    }
    const inStep = !!cloud && meta.uid === user.uid && meta.rev === cloud.rev;
    const upToDate = inStep && local.hash === meta.hash;
    show($('chooseBtn'), conflict);
    show($('loadBtn'), !!cloud && !upToDate && !conflict);
    $('saveNowBtn').hidden = conflict;
    $('saveNowBtn').textContent = upToDate ? 'Saved ✓' : 'Save this device\'s progress';
    $('saveNowBtn').disabled = upToDate;
    if (status != null) { const s = $('syncStatus'); s.textContent = status; s.className = 'acc-sync-status' + (kind ? ' is-' + kind : ''); }
    const b = readBackup();
    show($('backupBox'), !!b);
    if (b) {
        $('backupWhat').textContent = (b.kind === 'account' ? 'Your account\'s progress from before this device\'s replaced it' : b.kind === 'import' ? 'This device\'s progress from before a save file was imported' : 'This device\'s progress from before your account\'s was loaded') + `, kept ${fmtAgo(b.at)}.`;
        $('backupStats').innerHTML = statsHtml(b.summary || {});
    }
}
const RESULT = {
    uploaded: ['✓ This device\'s progress is saved to your account.', 'ok'],
    loaded: ['✓ Your account\'s progress is now on this device.', 'ok'],
    synced: ['✓ This device and your account are up to date.', 'ok'],
    conflict: ['This device and your account have different progress. Choose which to keep.', 'warn'],
};
async function syncWithAccount() {
    renderSync('Checking your cloud save…', '');
    try {
        const res = await reconcile(user, chooseProgress);
        conflict = res.state === 'conflict';
        cloud = await fetchCloud(user.uid);
        const [text, kind] = RESULT[res.state];
        renderSync(res.backedUp ? text + ' This device\'s previous progress is kept as a backup below.' : text, kind);
    } catch (err) {
        console.warn('sync failed', err);
        try { cloud = await fetchCloud(user.uid); } catch (e) {}
        renderSync(errorMessage(err), 'error');
    }
}
$('saveNowBtn').addEventListener('click', () => busy($('saveNowBtn'), 'Saving…', async () => {
    msg($('syncMsg'), '');
    try { await uploadLocal(user); cloud = await fetchCloud(user.uid); renderSync(...RESULT.uploaded); }
    catch (err) {
        if (err instanceof SyncConflict) { await syncWithAccount(); return; }
        msg($('syncMsg'), errorMessage(err));
    }
}));
$('chooseBtn').addEventListener('click', () => syncWithAccount());
$('loadBtn').addEventListener('click', () => busy($('loadBtn'), 'Loading…', async () => {
    msg($('syncMsg'), '');
    if (!confirmBox('Load your account\'s progress onto this device? This device\'s current progress will be kept as a backup you can restore here.')) return;
    try {
        cloud = await fetchCloud(user.uid);
        if (!cloud) { msg($('syncMsg'), 'Your account has no saved progress yet.'); return; }
        loadCloudIntoDevice(user, cloud);
        conflict = false;
        renderSync(...RESULT.loaded);
    } catch (err) { msg($('syncMsg'), errorMessage(err)); }
}));
$('restoreBtn').addEventListener('click', () => busy($('restoreBtn'), 'Restoring…', async () => {
    msg($('syncMsg'), '');
    if (!confirmBox('Put the backup back on this device? The progress it replaces becomes the new backup.')) return;
    try {
        await restoreBackup(user);
        await uploadLocal(user);
        cloud = await fetchCloud(user.uid);
        conflict = false;
        renderSync('✓ Backup restored and saved to your account.', 'ok');
    } catch (err) {
        if (err instanceof SyncConflict) { await syncWithAccount(); return; }
        msg($('syncMsg'), errorMessage(err));
    }
}));
// a plain confirm is fine here: account.html has no game state that a blocking dialog could interrupt
function confirmBox(text) { return window.confirm(text); }

$('resendBtn').addEventListener('click', () => busy($('resendBtn'), 'Sending…', async () => {
    try { await resendVerification(); return true; }
    catch (err) { msg($('syncMsg'), errorMessage(err)); return false; }
}).then(sent => {
    if (!sent) return;
    // one email a minute is plenty (Firebase rate-limits it too)
    const btn = $('resendBtn');
    btn.textContent = 'Sent ✓';
    btn.disabled = true;
    setTimeout(() => { btn.textContent = 'Resend email'; btn.disabled = false; }, 60000);
}));
$('verifiedBtn').addEventListener('click', () => busy($('verifiedBtn'), 'Checking…', async () => {
    try { await user.reload(); user = auth.currentUser; renderProfile(); }
    catch (err) { msg($('syncMsg'), errorMessage(err)); }
}));
// shown on the signed-out view after signing out or deleting the account
let farewell = '';
$('signOutBtn').addEventListener('click', () => busy($('signOutBtn'), 'Signing out…', async () => {
    farewell = 'Signed out. Your progress stays on this device and in your account.';
    try { await signOutUser(false); } catch (err) { farewell = ''; msg($('syncMsg'), errorMessage(err)); }
}));
$('signOutClearBtn').addEventListener('click', () => busy($('signOutClearBtn'), 'Saving…', async () => {
    if (!confirmBox('Save your progress to your account, sign out, and remove the game\'s progress from this device? Sign in again to get it back.')) return;
    farewell = 'Signed out. Your progress is saved in your account and was removed from this device.';
    try { await signOutUser(true); }
    catch (err) {
        farewell = '';
        if (err instanceof SyncConflict) { msg($('syncMsg'), 'Your account was saved from another device since this one synced. Choose which progress to keep first, then sign out.'); await syncWithAccount(); return; }
        msg($('syncMsg'), errorMessage(err) + ' Nothing was removed from this device.');
    }
}));

// change password (email accounts)
$('pwNew').addEventListener('input', () => renderRules($('pwNewRules'), $('pwNewMeter'), $('pwNew').value, user && user.email));
$('pwForm').addEventListener('submit', e => {
    e.preventDefault();
    const cur = $('pwCurrent').value, next = $('pwNew').value;
    if (!cur) { msg($('pwMsg'), 'Enter your current password.'); return; }
    if (!renderRules($('pwNewRules'), $('pwNewMeter'), next, user.email)) { msg($('pwMsg'), 'Choose a new password that meets all three requirements.'); return; }
    if (next !== $('pwConfirm').value) { msg($('pwMsg'), 'The new passwords don\'t match.'); return; }
    if (next === cur) { msg($('pwMsg'), 'Choose a password you haven\'t been using.'); return; }
    busy($('pwSubmit'), 'Changing…', async () => {
        try {
            await changePassword(cur, next);
            ['pwCurrent', 'pwNew', 'pwConfirm'].forEach(id => { $(id).value = ''; });
            renderRules($('pwNewRules'), $('pwNewMeter'), '', '');
            msg($('pwMsg'), '✓ Password changed.', 'ok');
        } catch (err) { msg($('pwMsg'), errorMessage(err)); }
    });
});
// delete account (asks for the password, or a fresh Google sign-in)
$('deleteForm').addEventListener('submit', e => {
    e.preventDefault();
    if ($('deleteConfirm').value.trim() !== 'DELETE') { msg($('deleteMsg'), 'Type DELETE (in capitals) to confirm.'); return; }
    const pw = $('deletePw').value;
    if (usesPassword(user) && !pw) { msg($('deleteMsg'), 'Enter your password.'); return; }
    msg($('deleteMsg'), '');
    const btn = $('deleteSubmit');
    btn.disabled = true;
    // no await before deleteAccount: for Google accounts it opens a pop-up, which must start inside the click
    farewell = 'Your account and its cloud save were deleted. The progress on this device is still here.';
    deleteAccount(pw).then(() => { msg($('deleteMsg'), ''); }, err => { farewell = ''; throw err; })
        .catch(err => { const m = errorMessage(err); if (m) msg($('deleteMsg'), m); })
        .finally(() => { btn.disabled = false; $('deletePw').value = ''; });
});

// ---------------- page state ----------------
function render() {
    show($('accLoading'), false);
    show($('accSignedOut'), !user);
    show($('accSignedIn'), !!user);
    if (!user) {
        renderDevice();
        // back to a clean sign-in form (it may still be on "Create account" from before)
        setMode('signin');
        show($('resetForm'), false); show($('authForm'), true);
        if (farewell) { msg($('authMsg'), farewell, 'ok'); farewell = ''; }
        return;
    }
    renderProfile();
    syncWithAccount();
}
setMode('signin');
watchAuth(u => {
    const changed = (u && u.uid) !== (user && user.uid);
    user = u;
    if (changed || !u) { cloud = null; conflict = false; }
    render();
});
// the game in another tab saved: keep the numbers current
window.addEventListener('storage', ev => {
    if (!user || !ev.key || !/^whathappened_(save|cloud_meta)$/.test(ev.key)) return;
    renderSync(null);
});
