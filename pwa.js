/**
 * Installing the game as an app (index.html and world.html load this).
 * - Registers the service worker (sw.js), which keeps the site's files so the game opens without a connection, and hands it
 *   the files this page loaded before it was in charge (so the first visit is enough).
 * - The Install row in the game's Settings (#installAppRow): a button where the browser offers installing
 *   (beforeinstallprompt: Chrome, Edge, Android), the "Share, then Add to Home Screen" steps on iPhone and iPad, a note
 *   when it is already installed, and the browser's own menu otherwise.
 * Nothing here runs on file:// or without service workers (old browsers, some private windows): the game works as before.
 * window.WHPwa = { installed(), canPrompt(), install(), refresh() } for the page and the tests.
 */
(function () {
    'use strict';
    let deferred = null;

    function installed() {
        try {
            return (window.matchMedia && window.matchMedia('(display-mode: standalone)').matches) || window.navigator.standalone === true;
        } catch (e) { return false; }
    }
    function isIos() {
        const ua = navigator.userAgent || '';
        return /iPad|iPhone|iPod/.test(ua) || (/Macintosh/.test(ua) && navigator.maxTouchPoints > 1);
    }

    function refresh() {
        const row = document.getElementById('installAppRow');
        if (!row) return;
        const btn = document.getElementById('installAppBtn'), help = document.getElementById('installAppHelp');
        row.hidden = false;
        if (installed()) {
            if (btn) btn.hidden = true;
            if (help) help.textContent = 'The game is installed on this device. Open it from your home screen or app list.';
        } else if (deferred) {
            if (btn) btn.hidden = false;
            if (help) help.textContent = 'Opens full screen from your home screen or app list, and still opens without a connection (online features wait until you are back).';
        } else if (isIos()) {
            if (btn) btn.hidden = true;
            if (help) help.textContent = 'On iPhone or iPad: open this page in Safari, tap Share, then Add to Home Screen.';
        } else {
            if (btn) btn.hidden = true;
            if (help) help.textContent = 'Use your browser\'s menu (Install app, or Add to Home screen) to install the game. Some browsers don\'t offer it.';
        }
    }

    async function install() {
        if (!deferred) { refresh(); return false; }
        const ev = deferred;
        deferred = null;
        try {
            ev.prompt();
            const choice = await ev.userChoice;
            refresh();
            return !!(choice && choice.outcome === 'accepted');
        } catch (e) { refresh(); return false; }
    }

    window.addEventListener('beforeinstallprompt', (ev) => { ev.preventDefault(); deferred = ev; refresh(); });
    window.addEventListener('appinstalled', () => { deferred = null; refresh(); });

    // the files this page has loaded so far, for the worker to keep
    function loadedUrls() {
        const out = [location.href];
        try { for (const e of performance.getEntriesByType('resource')) out.push(e.name); } catch (e) {}
        return out;
    }
    function register() {
        if (!('serviceWorker' in navigator) || !/^https?:$/.test(location.protocol)) return;
        navigator.serviceWorker.register('sw.js').then(() => navigator.serviceWorker.ready).then((reg) => {
            const w = reg.active || navigator.serviceWorker.controller;
            if (w) w.postMessage({ type: 'keep', urls: loadedUrls() });
        }).catch((e) => { try { console.warn('service worker not registered', e); } catch (x) {} });
    }

    function init() {
        const btn = document.getElementById('installAppBtn');
        if (btn) btn.addEventListener('click', install);
        refresh();
        // after the page has finished loading, so registering never competes with the game's own files
        if (document.readyState === 'complete') setTimeout(register, 1500);
        else window.addEventListener('load', () => setTimeout(register, 1500));
    }
    window.WHPwa = { installed, canPrompt: () => !!deferred, install, refresh };
    // once the HTML is parsed: DOMContentLoaded also waits for the game page's Firebase modules to download, which can take
    // a long while on a slow connection (the Install row stayed hidden), so like guide.js, start on readystatechange too
    if (document.readyState !== 'loading') init();
    else {
        let done = false;
        const go = () => { if (!done) { done = true; init(); } };
        document.addEventListener('readystatechange', () => { if (document.readyState !== 'loading') go(); });
        document.addEventListener('DOMContentLoaded', go);
    }
})();
