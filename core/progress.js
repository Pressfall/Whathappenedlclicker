/**
 * A player's progress as a whole, and keeping it in step between this device and an account.
 *
 * - Progress = every localStorage key the game keeps progress in (SYNC_KEYS / SYNC_PREFIXES), as one JSON string.
 * - Cloud sync: every upload bumps the account save's `rev`. Each device remembers the rev and a hash of what it last
 *   synced (META_KEY), so it can tell "another device saved since" from "this device changed since". Progress is never
 *   replaced silently: when both changed, the player chooses which to keep. The progress that gets replaced is kept on
 *   this device (BACKUP_KEY).
 * - Local export / import: the same progress as a file, for players who want a copy that does not depend on one
 *   browser's storage or on an account.
 *
 * No Firebase and no page in here: cloud.js supplies the Firestore `remote` and the browser's localStorage, tests
 * supply fakes. Works in a browser (<script src="core/progress.js"> sets window.WHProgress) and in Node (require).
 */
(function (root, factory) {
    if (typeof module === 'object' && module.exports) module.exports = factory(require('./save'));
    else root.WHProgress = factory(root.WHSave);
}(typeof self !== 'undefined' ? self : this, function (WHSave) {
    'use strict';

    const SAVE_KEY = 'whathappened_save', SAVE_KEY_LEGACY = 'whathappened_save_v1';
    const META_KEY = 'whathappened_cloud_meta';       // { uid, rev, hash, at }: what this device last synced
    const BACKUP_KEY = 'whathappened_cloud_backup';   // { at, kind: 'device' | 'account' | 'import', payload, summary }
    const APPLIED_KEY = 'whathappened_cloud_applied'; // written when other progress replaces this device's: open game tabs reload instead of saving over it
    const MAX_PAYLOAD = 900000;                       // Firestore caps a document at 1 MiB
    const MAX_IMPORT_FILE = 4000000;                  // characters; localStorage itself holds about 5 MB
    const EXPORT_FORMAT = 'whathappened-progress';
    // Opening the game always changes the save a little (offline earnings, timestamps), and the last save before a tab
    // closes often can't finish uploading. So when the account has newer progress and this device was only played this
    // long since it last synced (and didn't prestige), the account's progress loads without asking (this device's is
    // still kept as a backup).
    const SMALL_PLAY_SEC = 180;

    // Progress keys. Device settings, chat state, half-played casino rounds and cross-tab signals stay on the device.
    const SYNC_KEYS = new Set([
        SAVE_KEY, 'whathappened_followers', 'whathappened_items',
        'unlocked_titles', 'equipped_title', 'whathappened_ach_new',
        'whathappened_lifetime_clicks', 'whathappened_clicks_since_prestige', 'whathappened_playtime_seconds',
        'whathappened_prestige_times', 'whathappened_total_golden', 'whathappened_last_prestige_ts', 'whathappened_golden',
        'whathappened_redeemed_codes', 'whathappened_casino_stats', 'gamba_total_wins', 'shopCasinoDealerPurchased',
        'whathappened_specials_owned', 'whathappened_specials_total', 'whathappened_specials_fullsets',
        'player_username', 'player_clanId', 'player_clanName', 'player_clanRole',
        'whathappened_clan_level', 'whathappened_clan_donated', 'whathappened_clan_checkin',
        'whathappened_world', 'whathappened_world_ack', 'whathappened_world_inbox', 'whathappened_world_owed', 'whathappened_golden_trades',
    ]);
    // achievement flags (ach_<key>) and clan event rewards already claimed (so they can't be claimed again on another device)
    const SYNC_PREFIXES = ['ach_', 'whathappened_pp_claimed_', 'whathappened_bf_claimed_', 'whathappened_eb_claimed_',
        'whathappened_cvc_claimed_', 'whathappened_race_claimed_', 'whathappened_con_claimed_'];
    function isSyncKey(k) { return typeof k === 'string' && k.length <= 120 && (SYNC_KEYS.has(k) || SYNC_PREFIXES.some((p) => k.startsWith(p))); }

    function syncError(code, message) { const e = new Error(message); e.code = code; return e; }
    function readJSON(store, key) { try { return JSON.parse(store.getItem(key) || 'null'); } catch (e) { return null; } }

    // cyrb53: a fast 53-bit string hash, only used to notice that progress changed (not for security)
    function hash(str) {
        let h1 = 0xdeadbeef, h2 = 0x41c6ce57;
        for (let i = 0; i < str.length; i++) {
            const ch = str.charCodeAt(i);
            h1 = Math.imul(h1 ^ ch, 2654435761);
            h2 = Math.imul(h2 ^ ch, 1597334677);
        }
        h1 = Math.imul(h1 ^ (h1 >>> 16), 2246822507) ^ Math.imul(h2 ^ (h2 >>> 13), 3266489909);
        h2 = Math.imul(h2 ^ (h2 >>> 16), 2246822507) ^ Math.imul(h1 ^ (h1 >>> 13), 3266489909);
        return (4294967296 * (2097151 & h2) + (h1 >>> 0)).toString(36);
    }

    // ---------------- comparing progress ----------------
    // A few headline numbers, shown when choosing between saves and stored next to the cloud save
    function summarize(data) {
        let s = {};
        try { s = JSON.parse(data[SAVE_KEY] || '{}') || {}; } catch (e) { s = {}; }
        const num = (v) => Number(v) || 0;
        let followers = 0;
        try { const f = JSON.parse(data.whathappened_followers || 'null'); followers = (f && Array.isArray(f.list)) ? f.list.length : 0; } catch (e) {}
        return {
            count: String(s.count == null ? '0' : s.count).slice(0, 40),
            golden: num(s.goldenWhat),
            totalGolden: num(s.totalGoldenEver),
            prestiges: Math.max(num(s.prestigeTimes), num(data.whathappened_prestige_times)),
            gems: num(s.diamonds),
            playSeconds: num(data.whathappened_playtime_seconds),
            achievements: Object.keys(data).filter((k) => k.startsWith('ach_') && k !== 'ach_clicks' && data[k] === '1').length,
            followers,
        };
    }
    function countLog10(c) {
        const m = String(c || '0').match(/^(\d+(?:\.\d+)?)e\+?(\d+)$/i);
        if (m) return Math.log10(Number(m[1]) || 1) + Number(m[2]);
        const n = Number(c) || 0;
        return n > 0 ? Math.log10(n) : 0;
    }
    // true when a has gone further than b: prestiges first, then Golden earned, then What Happeneds, then play time
    function furtherAhead(a, b) {
        const keys = [(x) => x.prestiges || 0, (x) => x.totalGolden || 0, (x) => countLog10(x.count), (x) => x.playSeconds || 0];
        for (const k of keys) { if (k(a) !== k(b)) return k(a) > k(b); }
        return false;
    }
    // A brand-new device (nothing worth asking about) can take the account's progress without a prompt
    function hasProgress(data) {
        if (!data[SAVE_KEY]) return false;
        const s = summarize(data);
        return s.prestiges > 0 || s.totalGolden > 0 || s.golden > 0 || s.gems > 0 || s.followers > 0 || countLog10(s.count) >= 3;
    }

    class SyncConflict extends Error {
        constructor(cloud) { super('This account was saved from another device since this one last synced.'); this.code = 'sync/conflict'; this.cloud = cloud; }
    }

    // Only progress keys with string values are accepted; anything else in the payload is ignored
    function parsePayload(json, maxLength) {
        const bad = () => syncError('sync/bad-data', 'The progress could not be read.');
        if (typeof json !== 'string' || !json || json.length > (maxLength || MAX_PAYLOAD)) throw bad();
        let obj;
        try { obj = JSON.parse(json); } catch (e) { obj = null; }
        if (!obj || typeof obj !== 'object' || Array.isArray(obj)) throw bad();
        const out = {};
        for (const k of Object.keys(obj)) if (isSyncKey(k) && typeof obj[k] === 'string') out[k] = obj[k];
        if (out[SAVE_KEY]) { try { JSON.parse(out[SAVE_KEY]); } catch (e) { throw bad(); } }
        return out;
    }

    /**
     * @param {object} deps
     * @param {Storage} deps.store              localStorage, or anything with getItem / setItem / removeItem / key / length
     * @param {() => number} [deps.now]         Date.now
     * @param {() => string} [deps.deviceLabel] "Chrome on Windows": enough to recognise a device
     * @param {() => void} [deps.beforeReplace] called before other progress overwrites this device's, so an open game
     *                                          page stops saving its in-memory state over it
     * @param {object} [deps.remote]            the account's save: { fetch(uid) -> cloud | null,
     *                                          transaction(uid, decide(current | null) -> doc) -> rev }.
     *                                          A cloud is { rev, payload, summary, device, updatedAt }.
     */
    function create(deps) {
        const store = deps.store;
        const now = deps.now || Date.now;
        const deviceLabel = deps.deviceLabel || (() => '');
        const beforeReplace = deps.beforeReplace || (() => {});
        const remote = deps.remote;

        // ---------------- this device's progress ----------------
        // All progress keys, sorted so the same progress always gives the same JSON and hash
        function collectLocal() {
            const data = {};
            for (let i = 0; i < store.length; i++) {
                const k = store.key(i);
                if (isSyncKey(k)) data[k] = store.getItem(k);
            }
            if (!(SAVE_KEY in data) && store.getItem(SAVE_KEY_LEGACY) != null) data[SAVE_KEY] = store.getItem(SAVE_KEY_LEGACY);
            const sorted = {};
            Object.keys(data).sort().forEach((k) => { sorted[k] = data[k]; });
            const json = JSON.stringify(sorted);
            return { data: sorted, json, hash: hash(json) };
        }

        // ---------------- sync bookkeeping ----------------
        function readMeta() {
            const m = readJSON(store, META_KEY);
            if (!m || typeof m !== 'object') return { uid: '', rev: 0, hash: '', at: 0, play: null, prestiges: 0 };
            return { uid: String(m.uid || ''), rev: Number(m.rev) || 0, hash: String(m.hash || ''), at: Number(m.at) || 0,
                play: m.play == null ? null : Number(m.play) || 0, prestiges: Number(m.prestiges) || 0 };
        }
        // rev and hash of what was synced, plus its play time and prestiges (see SMALL_PLAY_SEC)
        function writeMeta(uid, rev, synced) {
            const s = summarize(synced.data);
            try { store.setItem(META_KEY, JSON.stringify({ uid, rev, hash: synced.hash, at: now(), play: s.playSeconds, prestiges: s.prestiges })); } catch (e) {}
        }
        function barelyPlayedSince(data, meta) {
            const s = summarize(data);
            return meta.play != null && s.prestiges <= meta.prestiges && s.playSeconds - meta.play <= SMALL_PLAY_SEC;
        }
        function clearMeta() { try { store.removeItem(META_KEY); } catch (e) {} }
        function readBackup() {
            const b = readJSON(store, BACKUP_KEY);
            return (b && typeof b.payload === 'string') ? b : null;
        }
        function writeBackup(kind, payload, summary) {
            try { store.setItem(BACKUP_KEY, JSON.stringify({ at: now(), kind, payload, summary })); }
            catch (e) { throw syncError('sync/no-space', 'Not enough browser storage to keep a backup, so nothing was replaced.'); }
        }

        // ---------------- the account's progress ----------------
        function fetchCloud(uid) { return remote.fetch(uid); }

        // Save this device's progress to the account. Refuses (SyncConflict) when another device saved since this one
        // last synced, unless force (the player chose this device's progress).
        async function uploadLocal(user, opts) {
            const force = !!(opts && opts.force);
            const local = collectLocal();
            if (local.json.length > MAX_PAYLOAD) throw syncError('sync/too-large', 'Your progress is too large to save to an account.');
            const meta = readMeta();
            const known = meta.uid === user.uid ? meta.rev : -1;
            const rev = await remote.transaction(user.uid, (current) => {
                const cur = current ? current.rev : 0;
                if (!force && current && cur !== known) throw new SyncConflict(current);
                return { v: 1, rev: cur + 1, payload: local.json, summary: summarize(local.data), device: deviceLabel() };
            });
            writeMeta(user.uid, rev, local);
            return { rev, local };
        }

        // Replace this device's progress with `json` (from the account, a backup or an import). The game page reloads afterwards.
        function applyPayload(json, maxLength) {
            const data = parsePayload(json, maxLength);
            // the game must not save its in-memory state over what we write (this tab: main.js; other tabs: the storage event)
            try { beforeReplace(); } catch (e) {}
            const remove = [];
            for (let i = 0; i < store.length; i++) { const k = store.key(i); if (isSyncKey(k) && !(k in data)) remove.push(k); }
            remove.forEach((k) => store.removeItem(k));
            try {
                for (const k in data) store.setItem(k, data[k]);
                if (data[SAVE_KEY]) store.setItem(SAVE_KEY_LEGACY, data[SAVE_KEY]);
                else store.removeItem(SAVE_KEY_LEGACY);
            } catch (e) { throw syncError('sync/no-space', 'Not enough browser storage to load your progress.'); }
            try { store.setItem(APPLIED_KEY, String(now())); } catch (e) {}
            return collectLocal();
        }
        // Load the account's progress onto this device, keeping this device's progress as a backup first.
        // Returns true when a backup was kept.
        function loadCloudIntoDevice(user, cloud) {
            const local = collectLocal();
            const backedUp = hasProgress(local.data);
            if (backedUp) writeBackup('device', local.json, summarize(local.data));
            const applied = applyPayload(cloud.payload);
            writeMeta(user.uid, cloud.rev, applied);
            return backedUp;
        }
        // Keep this device's progress: the account's progress is backed up on this device, then overwritten
        async function keepDeviceProgress(user, cloud) {
            if (cloud && cloud.payload) writeBackup('account', cloud.payload, cloud.summary);
            return uploadLocal(user, { force: true });
        }
        // Put the backed-up progress back on this device (the progress it replaces becomes the new backup).
        // When signed in, the restored progress is then saved to the account on the next sync.
        async function restoreBackup(user) {
            const b = readBackup();
            if (!b) throw syncError('sync/no-backup', 'There is no backup on this device.');
            const local = collectLocal();
            const cloud = user ? await fetchCloud(user.uid) : null;
            const applied = applyPayload(b.payload, MAX_IMPORT_FILE); // a backup made by an import can be bigger than an account save
            if (hasProgress(local.data)) writeBackup('device', local.json, summarize(local.data));
            else store.removeItem(BACKUP_KEY);
            // in step with the account's current rev, but changed: the next sync uploads the restored progress
            if (user) writeMeta(user.uid, cloud ? cloud.rev : 0, { data: applied.data, hash: 'restored' });
            else clearMeta();
            return applied;
        }

        // What reconcile() should do, given both sides. Pure: no storage or network.
        //  'upload-new'  the account has no save yet
        //  'record'      identical progress on both sides: just remember the rev
        //  'synced'      nothing changed on either side
        //  'upload'      only this device changed
        //  'load'        only the account changed (or this device has nothing worth keeping)
        //  'ask'         both changed: the player chooses
        function planReconcile(user, local, meta, cloud) {
            if (!cloud) return 'upload-new';
            const mine = meta.uid === user.uid;
            if (cloud.payload && hash(cloud.payload) === local.hash) return 'record';
            if (mine && cloud.rev === meta.rev) return local.hash === meta.hash ? 'synced' : 'upload';
            const untouched = mine && cloud.rev > meta.rev && (local.hash === meta.hash || barelyPlayedSince(local.data, meta));
            if (untouched || !hasProgress(local.data)) return 'load';
            return 'ask';
        }

        // Bring this device and the account in line after signing in or opening the game.
        // askUser(localSummary, cloud) resolves 'local', 'cloud' or 'later' when both sides changed.
        // Returns { state: 'synced' | 'uploaded' | 'loaded' | 'conflict', cloud, backedUp }.
        async function reconcile(user, askUser) {
            const local = collectLocal(), meta = readMeta();
            const cloud = await fetchCloud(user.uid);
            switch (planReconcile(user, local, meta, cloud)) {
                case 'upload-new': await uploadLocal(user); return { state: 'uploaded', cloud: null };
                case 'record': writeMeta(user.uid, cloud.rev, local); return { state: 'synced', cloud };
                case 'synced': return { state: 'synced', cloud };
                case 'upload':
                    try { await uploadLocal(user); return { state: 'uploaded', cloud }; }
                    catch (e) { if (!(e instanceof SyncConflict)) throw e; return reconcile(user, askUser); }
                case 'load': return { state: 'loaded', cloud, backedUp: loadCloudIntoDevice(user, cloud) };
                default: {
                    const choice = askUser ? await askUser(summarize(local.data), cloud) : 'later';
                    if (choice === 'cloud') return { state: 'loaded', cloud, backedUp: loadCloudIntoDevice(user, cloud) };
                    if (choice === 'local') { await keepDeviceProgress(user, cloud); return { state: 'uploaded', cloud }; }
                    return { state: 'conflict', cloud };
                }
            }
        }

        // Remove the game's progress from this device (shared computers), together with the sync record and the backup
        function wipeDevice() {
            try { beforeReplace(); } catch (e) {}
            const keys = [];
            for (let i = 0; i < store.length; i++) { const k = store.key(i); if (isSyncKey(k)) keys.push(k); }
            keys.concat([SAVE_KEY_LEGACY, BACKUP_KEY]).forEach((k) => store.removeItem(k));
            try { store.setItem(APPLIED_KEY, String(now())); } catch (e) {}
            clearMeta();
        }

        // ---------------- local export / import ----------------
        // The progress as a file the player keeps: { filename, text, summary }
        function exportProgress() {
            const local = collectLocal();
            if (!local.data[SAVE_KEY]) throw syncError('export/nothing', 'There is no progress on this device to export yet.');
            const at = new Date(now());
            const summary = summarize(local.data);
            const file = { format: EXPORT_FORMAT, version: 1, exportedAt: at.toISOString(), summary, data: local.data };
            const stamp = at.toISOString().slice(0, 10);
            return { filename: `whathappened-save-${stamp}.json`, text: JSON.stringify(file, null, 1), summary };
        }
        // Check the text of an export file without touching anything. Returns { data, summary, exportedAt, warnings }
        // or throws an Error (code 'import/...') whose message can be shown to the player.
        function previewImport(text) {
            const fail = (message) => syncError('import/invalid', message);
            if (typeof text !== 'string' || !text.trim()) throw fail('The file is empty.');
            if (text.length > MAX_IMPORT_FILE) throw fail('The file is too big to be a save.');
            let file;
            try { file = JSON.parse(text); } catch (e) { throw fail('That file is not a save: it could not be read as JSON.'); }
            if (!WHSave.isPlainObject(file) || file.format !== EXPORT_FORMAT) throw fail('That file is not a save exported from this game.');
            if (!Number.isInteger(file.version) || file.version < 1) throw fail('That save file has an invalid version.');
            if (file.version > 1) throw fail('That save file is from a newer version of the game. Update the game first.');
            if (!WHSave.isPlainObject(file.data)) throw fail('That save file has no progress in it.');
            let data;
            try { data = parsePayload(JSON.stringify(file.data), MAX_IMPORT_FILE); } catch (e) { throw fail('The progress in that file could not be read.'); }
            if (!data[SAVE_KEY]) throw fail('That save file has no main save in it.');
            const check = WHSave.validateSave(JSON.parse(data[SAVE_KEY]));
            if (!check.ok) throw fail(check.errors[0]);
            return { data, summary: summarize(data), exportedAt: typeof file.exportedAt === 'string' ? file.exportedAt : '', warnings: check.warnings };
        }
        // Replace this device's progress with an export file. This device's own progress is kept as the backup, and the
        // sync record is cleared so a signed-in account asks which side to keep instead of being overwritten silently.
        // The game page must reload afterwards. Returns { backedUp, summary }.
        function importProgress(text) {
            const preview = previewImport(text);
            const local = collectLocal();
            const backedUp = hasProgress(local.data);
            if (backedUp) writeBackup('import', local.json, summarize(local.data));
            applyPayload(JSON.stringify(preview.data), MAX_IMPORT_FILE);
            clearMeta();
            return { backedUp, summary: preview.summary };
        }

        return {
            collectLocal, readMeta, readBackup, clearMeta, fetchCloud, uploadLocal, loadCloudIntoDevice, keepDeviceProgress,
            restoreBackup, planReconcile, reconcile, wipeDevice, exportProgress, previewImport, importProgress,
        };
    }

    return {
        create, SyncConflict, SYNC_KEYS, isSyncKey, hash, summarize, countLog10, furtherAhead, hasProgress, parsePayload, syncError,
        SAVE_KEY, SAVE_KEY_LEGACY, META_KEY, BACKUP_KEY, APPLIED_KEY, MAX_PAYLOAD, SMALL_PLAY_SEC, EXPORT_FORMAT,
    };
}));
