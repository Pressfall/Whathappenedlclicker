/**
 * Settings > Save backup (game page): download the progress as a file, import one, restore the progress an import
 * replaced, and recover a save the game could not read. The rules (what is in the file, what is checked, what is kept as a
 * backup) are in core/progress.js; this is the buttons. It needs no account and no network.
 */
(function () {
    'use strict';

    // Run once the HTML is parsed. DOMContentLoaded also waits for the Firebase modules to download, which can take seconds on
    // a slow connection, so (like main.js) start on readystatechange instead.
    function onReady(fn) {
        if (document.readyState !== 'loading') { fn(); return; }
        let done = false;
        const go = () => { if (!done) { done = true; fn(); } };
        document.addEventListener('readystatechange', () => { if (document.readyState !== 'loading') go(); });
        document.addEventListener('DOMContentLoaded', go);
    }

    const DAMAGED_KEY = 'whathappened_save_damaged'; // written by main.js keepDamagedSave()
    const $ = (id) => document.getElementById(id);
    const fmt = (n) => { try { return formatNumber(Number(n) || 0); } catch (e) { return String(n); } };
    let engine = null;
    function getEngine() {
        if (!engine) {
            engine = WHProgress.create({
                store: localStorage,
                // the open game must not save its in-memory state over what is about to be written
                beforeReplace() { if (typeof window.freezeSavesForReload === 'function') window.freezeSavesForReload(); },
            });
        }
        return engine;
    }

    function status(text, kind) {
        const el = $('saveToolsStatus');
        if (!el) return;
        el.textContent = text;
        el.style.color = kind === 'error' ? 'var(--danger)' : kind === 'ok' ? 'var(--primary)' : '';
    }
    function summaryText(s) {
        s = s || {};
        const bits = [`${fmt(s.count)} What Happeneds`, `${s.prestiges || 0} prestige${s.prestiges === 1 ? '' : 's'}`, `${s.golden || 0} Golden`, `${s.gems || 0} gems`, `${s.achievements || 0} achievements`];
        return bits.join(', ');
    }
    function ago(ms) {
        const s = Math.max(0, Math.round((Date.now() - ms) / 1000));
        if (s < 60) return 'just now';
        if (s < 3600) return Math.round(s / 60) + ' min ago';
        if (s < 86400) return Math.round(s / 3600) + ' h ago';
        return new Date(ms).toLocaleDateString();
    }
    function download(filename, text) {
        const url = URL.createObjectURL(new Blob([text], { type: 'application/json' }));
        const a = document.createElement('a');
        a.href = url; a.download = filename;
        document.body.appendChild(a); a.click(); a.remove();
        setTimeout(() => URL.revokeObjectURL(url), 1000);
    }
    function reloadSoon() { setTimeout(() => location.reload(), 700); }

    function doExport() {
        try {
            // write the very latest progress first, so the file is not a few seconds old
            try { if (typeof saveGame === 'function') saveGame(); } catch (e) {}
            const out = getEngine().exportProgress();
            download(out.filename, out.text);
            status(`Downloaded ${out.filename}: ${summaryText(out.summary)}. Keep it somewhere safe.`, 'ok');
        } catch (e) { status(e && e.message ? e.message : 'The save file could not be created.', 'error'); }
    }

    async function doImport(file) {
        if (!file) return;
        try {
            if (file.size > 4000000) throw Object.assign(new Error('That file is too big to be a save.'), { code: 'import/invalid' });
            const text = await file.text();
            const eng = getEngine();
            const preview = eng.previewImport(text); // throws with a message the player can read
            const when = preview.exportedAt ? ` (saved ${new Date(preview.exportedAt).toLocaleString()})` : '';
            const ok = window.confirm(`Import this save${when}?\n\n${summaryText(preview.summary)}\n\nThis replaces the progress on this device. The progress it replaces is kept as a backup, so you can undo this from Settings > Save backup.`);
            if (!ok) { status('Import cancelled. Nothing was changed.'); return; }
            const res = eng.importProgress(text);
            status(res.backedUp ? 'Imported. Your previous progress was kept as a backup. Reloading…' : 'Imported. Reloading…', 'ok');
            reloadSoon();
        } catch (e) {
            status(e && e.code && e.code.indexOf('import/') === 0 ? e.message : 'That file could not be imported. Nothing was changed.', 'error');
        } finally {
            const input = $('importSaveInput');
            if (input) input.value = ''; // so the same file can be chosen again
        }
    }

    function doRestore() {
        const eng = getEngine();
        const b = eng.readBackup();
        if (!b) return;
        if (!window.confirm(`Put this backup back on this device?\n\n${summaryText(b.summary)}\n\nThe progress it replaces becomes the new backup.`)) return;
        eng.restoreBackup(null).then(() => { status('Backup restored. Reloading…', 'ok'); reloadSoon(); })
            .catch((e) => status(e && e.message ? e.message : 'The backup could not be restored.', 'error'));
    }

    function damaged() {
        try { const d = JSON.parse(localStorage.getItem(DAMAGED_KEY) || 'null'); return d && typeof d.raw === 'string' ? d : null; } catch (e) { return null; }
    }
    // show the rows that only matter when there is a backup or a damaged save
    function refresh() {
        const b = getEngine().readBackup();
        const row = $('restoreBackupRow');
        if (row) {
            row.hidden = !b;
            if (b) $('restoreBackupText').textContent = `A backup of this device's earlier progress was kept ${ago(b.at)}: ${summaryText(b.summary)}.`;
        }
        const d = damaged(), drow = $('damagedSaveRow');
        if (drow) {
            drow.hidden = !d;
            if (d) $('damagedSaveText').textContent = `A saved game that could not be read was kept ${ago(d.at)}. You can download it (for example to send to the developer) or delete it.`;
        }
    }

    function init() {
        const on = (id, fn) => { const el = $(id); if (el) el.addEventListener('click', fn); };
        on('exportSaveBtn', doExport);
        on('importSaveBtn', () => { const i = $('importSaveInput'); if (i) i.click(); });
        on('restoreBackupBtn', doRestore);
        on('damagedDownloadBtn', () => { const d = damaged(); if (d) download('whathappened-damaged-save.txt', d.raw); });
        on('damagedDeleteBtn', () => { if (window.confirm('Delete the damaged save for good?')) { try { localStorage.removeItem(DAMAGED_KEY); } catch (e) {} refresh(); } });
        const input = $('importSaveInput');
        if (input) input.addEventListener('change', () => doImport(input.files && input.files[0]));
        on('settingsToggle', () => setTimeout(refresh, 0));
        refresh();
    }
    window.WHSaveTools = { refresh, doExport, doImport, doRestore };
    onReady(init);
})();
