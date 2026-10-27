'use strict';
/**
 * Loads the real game scripts (followers-data, achievements-data, main, specials, items) into a jsdom copy of
 * index.html so tests can drive the same code the browser runs: saveGame / loadGame / buyPrestige / buy functions.
 *
 * - Scripts are evaluated with vm so main.js's top-level `let` state stays reachable via game.eval().
 * - Timers are captured instead of run (no autosave, no CPS tick); call game.runTimeouts() to flush one-shots.
 * - Like production, no Decimal library is loaded unless { decimal: true } is passed (index.html never loads one).
 * - Firebase is absent (window.db undefined), so every cloud feature takes its offline path.
 */
const fs = require('fs');
const path = require('path');
const vm = require('vm');
const { JSDOM } = require('jsdom');

const ROOT = path.resolve(__dirname, '..', '..');
const SCRIPTS = ['core/calc.js', 'core/save.js', 'core/progress.js', 'core/guide.js', 'core/clan-buffs.js', 'followers-data.js', 'achievements-data.js', 'main.js', 'specials.js', 'items.js', 'guide.js', 'save-tools.js'];

const read = (f) => fs.readFileSync(path.join(ROOT, f), 'utf8');
let cache = null;
function sources() {
    if (!cache) {
        // compile once: a vm.Script can run in any number of contexts, and main.js is ~450 KB
        // scripts never run from the markup (runScripts is 'outside-only'); dropping them just makes parsing faster
        cache = { html: read('index.html').replace(/<script[\s\S]*?<\/script>/g, ''), scripts: SCRIPTS.map((f) => new vm.Script(read(f), { filename: f })) };
    }
    return cache;
}

/**
 * @param {object} [opts]
 * @param {object} [opts.storage]   localStorage contents to start with ({ key: string })
 * @param {number} [opts.now]       fake Date.now() (ms)
 * @param {boolean} [opts.decimal]  load decimal.js first (not what production does)
 * @param {boolean} [opts.confirm]  what window.confirm answers (default true)
 * @param {Function} [opts.beforeInit]  called with the window once all scripts are loaded, before the game reads its save
 */
function loadGame(opts = {}) {
    const { html, scripts } = sources();
    const dom = new JSDOM(html, { url: 'http://localhost/', runScripts: 'outside-only', pretendToBeVisual: false });
    const w = dom.window;
    const ctx = dom.getInternalVMContext();

    // --- storage ---
    for (const [k, v] of Object.entries(opts.storage || {})) w.localStorage.setItem(k, v);

    // --- clock ---
    let now = opts.now === undefined ? Date.now() : opts.now;
    const RealDate = w.Date;
    class FakeDate extends RealDate {
        constructor(...a) { if (a.length) super(...a); else super(now); }
        static now() { return now; }
    }
    w.Date = FakeDate;

    // --- timers: record, never run on their own ---
    const timeouts = [];
    w.setTimeout = (fn, ms) => { timeouts.push({ fn, ms }); return timeouts.length; };
    w.clearTimeout = () => {};
    w.setInterval = () => 0;
    w.clearInterval = () => {};
    w.requestAnimationFrame = () => 0;

    // --- browser APIs jsdom lacks ---
    w.confirm = () => opts.confirm !== false;
    w.alert = () => {};
    w.Audio = class { play() { return Promise.resolve(); } pause() {} load() {} addEventListener() {} set volume(v) {} };
    w.HTMLMediaElement.prototype.play = () => Promise.resolve();
    w.HTMLMediaElement.prototype.pause = () => {};
    w.HTMLMediaElement.prototype.load = () => {};
    w.matchMedia = w.matchMedia || (() => ({ matches: false, addEventListener() {}, addListener() {} }));
    w.scrollTo = () => {};
    w.AudioContext = undefined;
    // keep game console chatter out of the test report; tests can read game.logs
    const logs = [];
    for (const level of ['log', 'info', 'debug', 'warn', 'error']) w.console[level] = (...a) => logs.push([level, ...a]);

    // In a browser these scripts run while the parser is still going (readyState 'loading'), so main.js waits for
    // DOMContentLoaded before initApp(). Do the same: load everything first, then fire the ready events below.
    let readyState = 'loading';
    Object.defineProperty(w.document, 'readyState', { configurable: true, get: () => readyState });

    if (opts.decimal) {
        const decimalSrc = fs.readFileSync(require.resolve('decimal.js/decimal.js'), 'utf8');
        new vm.Script(decimalSrc, { filename: 'decimal.js' }).runInContext(ctx);
    }
    for (const s of scripts) s.runInContext(ctx);
    if (opts.beforeInit) opts.beforeInit(w); // after every script has loaded, before initApp() reads the save
    readyState = 'complete';
    w.document.dispatchEvent(new w.Event('readystatechange'));
    w.document.dispatchEvent(new w.Event('DOMContentLoaded'));

    const game = {
        window: w,
        storage: w.localStorage,
        logs,
        /** evaluate an expression/statement inside the game's global scope (sees main.js's top-level let/const) */
        eval: (code) => new vm.Script(code).runInContext(ctx),
        /** run (and clear) the setTimeout callbacks captured so far, e.g. the post-prestige reload */
        runTimeouts() { const t = timeouts.splice(0); for (const { fn } of t) fn(); return t.length; },
        pendingTimeouts: () => timeouts.length,
        setNow(ms) { now = ms; },
        advance(ms) { now += ms; },
        /** the parsed main save currently in localStorage */
        savedState(key = 'whathappened_save') { const raw = w.localStorage.getItem(key); return raw ? JSON.parse(raw) : null; },
        /** every localStorage entry, to carry over into the next page load */
        dumpStorage() { const o = {}; for (let i = 0; i < w.localStorage.length; i++) { const k = w.localStorage.key(i); o[k] = w.localStorage.getItem(k); } return o; },
        /** a fresh page load of the same browser profile (same storage, same clock) */
        reload(extra = {}) { return loadGame(Object.assign({ storage: game.dumpStorage(), now, decimal: opts.decimal, confirm: opts.confirm, beforeInit: opts.beforeInit }, extra)); },
        close() { w.close(); },
    };
    return game;
}

module.exports = { loadGame, ROOT };
