'use strict';
// Settings > Save backup on the real game page: download, import, restore, and recovering a damaged save.
const test = require('node:test');
const assert = require('node:assert/strict');
const { loadGame } = require('./helpers/game-harness');

const NOW = 1_700_000_000_000;
const $ = (g, id) => g.window.document.getElementById(id);

// capture what the page offers as a download
function capture(w, downloads) {
    // jsdom's Blob has no text(); keep what the page put in it
    w.Blob = class { constructor(parts) { this.parts = parts; } async text() { return this.parts.join(''); } };
    w.URL.createObjectURL = (blob) => { downloads.push({ blob }); return 'blob:test'; };
    w.URL.revokeObjectURL = () => {};
    w.HTMLAnchorElement.prototype.click = function () { const d = downloads[downloads.length - 1]; if (d) d.filename = this.download; };
}
function game({ downloads = [], confirm = true, storage } = {}) {
    return loadGame({ now: NOW, confirm, storage, beforeInit: (w) => capture(w, downloads) });
}
const played = (g, count = 8e6) => {
    g.eval(`count = ${count}; upgrade1Level = 40; upgrade2Level = 12; goldenWhat = 3; prestigeTimes = 2; diamonds = 5; updateDisplays(); saveGame();`);
    return g;
};
const fileOf = (text) => ({ size: text.length, text: async () => text });
const exportText = async (g, downloads) => { $(g, 'exportSaveBtn').click(); return downloads[downloads.length - 1].blob.text(); };

test('Download save file produces a dated JSON file with the current progress', async () => {
    const downloads = [];
    const g = played(game({ downloads }));
    const text = await exportText(g, downloads);
    assert.match(downloads[0].filename, /^whathappened-save-\d{4}-\d{2}-\d{2}\.json$/);
    const file = JSON.parse(text);
    assert.equal(file.format, 'whathappened-progress');
    assert.equal(JSON.parse(file.data.whathappened_save).count, 8e6);
    assert.match($(g, 'saveToolsStatus').textContent, /Downloaded whathappened-save-/);
    assert.match($(g, 'saveToolsStatus').textContent, /8M What Happeneds|8\.0M|8,000,000/);
});

test('the file holds the latest progress, not the last autosave', async () => {
    const downloads = [];
    const g = played(game({ downloads }));
    g.eval('count = 123456789');
    const file = JSON.parse(await exportText(g, downloads));
    assert.equal(JSON.parse(file.data.whathappened_save).count, 123456789);
});

test('exporting before any progress exists says there is nothing to export', async () => {
    const g = game({ storage: {} });
    g.eval('suppressAutosave = true'); // the fresh page has not saved yet
    g.storage.removeItem('whathappened_save');
    $(g, 'exportSaveBtn').click();
    assert.match($(g, 'saveToolsStatus').textContent, /no progress/i);
});

test('importing a file replaces the progress, keeps the old as a backup, and reloads', async () => {
    const downloads = [];
    const source = played(game({ downloads }), 9e9);
    const text = await exportText(source, downloads);

    const g = played(game(), 5e6);
    await g.window.WHSaveTools.doImport(fileOf(text));
    assert.equal(g.savedState().count, 9e9);
    assert.equal(JSON.parse(JSON.parse(g.storage.getItem('whathappened_cloud_backup')).payload).whathappened_save.includes('5000000'), true, 'the replaced progress is the backup');
    assert.match($(g, 'saveToolsStatus').textContent, /Imported/);
    assert.equal(g.pendingTimeouts() > 0, true, 'a reload is scheduled');
    // the open game must not save its in-memory 5M over the import when the tab goes away
    g.window.dispatchEvent(new g.window.Event('beforeunload'));
    assert.equal(g.savedState().count, 9e9);
    assert.equal(g.reload().eval('count'), 9e9);
});

test('the player is shown what is in the file before anything is replaced, and can cancel', async () => {
    const downloads = [];
    const text = await exportText(played(game({ downloads }), 9e9), downloads);
    const g = played(game({ confirm: false }), 5e6);
    let asked = '';
    g.window.confirm = (m) => { asked = m; return false; };
    const before = JSON.stringify(g.dumpStorage());
    await g.window.WHSaveTools.doImport(fileOf(text));
    assert.match(asked, /9B What Happeneds|9\.0B|9,000,000,000/);
    assert.match(asked, /2 prestiges/);
    assert.match(asked, /replaces the progress on this device/);
    assert.equal(JSON.stringify(g.dumpStorage()), before, 'cancelling changes nothing');
    assert.match($(g, 'saveToolsStatus').textContent, /cancelled/i);
});

test('a file that is not a save is refused with a reason, and nothing changes', async () => {
    const g = played(game(), 5e6);
    const before = JSON.stringify(g.dumpStorage());
    for (const [text, reason] of [['hello', /not a save/], [JSON.stringify({ format: 'nope' }), /not a save exported/], [JSON.stringify({ a: 1 }), /not a save exported/]]) {
        await g.window.WHSaveTools.doImport(fileOf(text));
        assert.match($(g, 'saveToolsStatus').textContent, reason);
        assert.equal($(g, 'saveToolsStatus').style.color, 'var(--danger)');
    }
    await g.window.WHSaveTools.doImport({ size: 9_000_000, text: async () => 'x' });
    assert.match($(g, 'saveToolsStatus').textContent, /too big/);
    assert.equal(JSON.stringify(g.dumpStorage()), before);
});

test('the Restore row appears after an import and puts the earlier progress back', async () => {
    const downloads = [];
    const text = await exportText(played(game({ downloads }), 9e9), downloads);
    const g = played(game(), 5e6);
    assert.equal($(g, 'restoreBackupRow').hidden, true);
    await g.window.WHSaveTools.doImport(fileOf(text));
    g.window.WHSaveTools.refresh();
    assert.equal($(g, 'restoreBackupRow').hidden, false);
    assert.match($(g, 'restoreBackupText').textContent, /5M What Happeneds|5\.0M|5,000,000/);
    await g.window.WHSaveTools.doRestore();
    await new Promise((r) => setImmediate(r));
    assert.equal(g.savedState().count, 5e6);
});

test('a save the game cannot read is kept, offered for download, and can be deleted', async () => {
    const raw = '{"count": 12, "upgrade1Level"';
    const downloads = [];
    const g = game({ downloads, storage: { whathappened_save: raw } });
    const kept = JSON.parse(g.storage.getItem('whathappened_save_damaged'));
    assert.equal(kept.raw, raw);
    assert.equal(kept.reason, 'unreadable');
    assert.equal($(g, 'damagedSaveRow').hidden, false);
    $(g, 'damagedDownloadBtn').click();
    assert.equal(await downloads[0].blob.text(), raw);
    assert.equal(downloads[0].filename, 'whathappened-damaged-save.txt');
    $(g, 'damagedDeleteBtn').click();
    assert.equal(g.storage.getItem('whathappened_save_damaged'), null);
    assert.equal($(g, 'damagedSaveRow').hidden, true);
});

test('the damaged save outlives the next autosave, which replaces the unreadable one', () => {
    const raw = 'not json at all';
    const g = game({ storage: { whathappened_save: raw } });
    g.eval('count = 77; saveGame()');
    assert.equal(g.savedState().count, 77);
    assert.equal(JSON.parse(g.storage.getItem('whathappened_save_damaged')).raw, raw);
});

test('a readable save leaves no damaged-save entry behind', () => {
    const g = game({ storage: { whathappened_save: JSON.stringify({ version: 3, count: 5 }) } });
    assert.equal(g.storage.getItem('whathappened_save_damaged'), null);
    assert.equal($(g, 'damagedSaveRow').hidden, true);
});

test('main.js now knows every field the prestige keeps', () => {
    // guards against a typo in core/save.js PRESTIGE_KEEP silently dropping something on prestige
    const { PRESTIGE_KEEP } = require('../core/save');
    const g = played(game());
    const saved = g.savedState();
    const missing = PRESTIGE_KEEP.filter((k) => !(k in saved) && !['casinoSpin', 'casino_total_wins'].includes(k));
    assert.deepEqual(missing, []);
});
