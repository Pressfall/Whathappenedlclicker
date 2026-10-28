/**
 * Shared bits for every page: the navigation bar on the secondary pages, and the "something is waiting for you"
 * alerts (new achievements, eggs ready to hatch, the daily spin, the clan check-in) that the main game's nav
 * buttons and the secondary pages' nav bar both show. Everything is read from localStorage, so each page sees what
 * the others did.
 */
(function () {
    'use strict';

    const PAGES = [
        { href: 'index.html', label: 'Game', icon: '🎮' },
        { href: 'achievements.html', label: 'Achievements', icon: '🎖️', alert: 'achievements' },
        { href: 'followers.html', label: 'Followers', icon: '🦎', alert: 'followers' },
        { href: 'world.html', label: 'The Wilds', icon: '⚔️', alert: 'world' },
        { href: 'gamba.html', label: 'Casino', icon: '🎰', alert: 'casino' },
        { href: 'clan.html', label: 'Clans', icon: '🛡️', alert: 'clan' },
        { href: 'leaderboard.html', label: 'Leaderboard', icon: '🏆' },
        { href: 'account.html', label: 'Account', icon: '☁️' },
    ];

    function readJSON(key) { try { return JSON.parse(localStorage.getItem(key) || 'null'); } catch (e) { return null; } }
    function localDay() { const d = new Date(); return d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0'); }

    // { key: { count, text } } for everything that wants the player's attention
    function alerts() {
        const out = {};
        // achievements unlocked since the achievements page was last opened
        const fresh = (window.WHA && window.WHA.newKeys) ? window.WHA.newKeys() : (readJSON('whathappened_ach_new') || []);
        if (fresh.length) out.achievements = { count: fresh.length, text: `${fresh.length} new achievement${fresh.length > 1 ? 's' : ''}` };
        // eggs that have finished hatching
        const f = readJSON('whathappened_followers');
        const eggs = (f && Array.isArray(f.nursery)) ? f.nursery.filter(e => e && Number(e.readyAt) <= Date.now()).length : 0;
        if (eggs) out.followers = { count: eggs, text: `${eggs} egg${eggs > 1 ? 's' : ''} ready to hatch` };
        // casino: daily spin not used yet today, or a rocket still flying
        const save = readJSON('whathappened_save') || readJSON('whathappened_save_v1') || {};
        if (localStorage.getItem('whathappened_rocket_round')) out.casino = { count: 0, text: 'Your rocket is still flying' };
        else if (!save.casinoSpin || save.casinoSpin.lastSpinDate !== localDay()) out.casino = { count: 0, text: 'Your daily spin is ready' };
        // clan: today's check-in (days are UTC on the clan page)
        const cid = localStorage.getItem('player_clanId');
        const checkin = readJSON('whathappened_clan_checkin') || {};
        if (cid && cid !== 'undefined' && checkin.day !== new Date().toISOString().slice(0, 10)) out.clan = { count: 0, text: 'Check in with your clan today' };
        // the Wilds: the bag dropped on the last death is still out there
        const world = readJSON('whathappened_world');
        if (world && world.grave) out.world = { count: 0, text: 'Your dropped bag is waiting in the Wilds' };
        return out;
    }

    // Put a count bubble or a dot on a button. `alert` is one entry from alerts() (or undefined to clear).
    function setBadge(el, alert) {
        if (!el) return;
        let b = el.querySelector(':scope > .site-badge');
        if (!alert) { if (b) b.remove(); el.classList.remove('has-site-alert'); el.removeAttribute('data-alert'); return; }
        if (!b) { b = document.createElement('span'); b.className = 'site-badge'; el.appendChild(b); }
        b.textContent = alert.count ? String(alert.count > 99 ? '99+' : alert.count) : '';
        b.classList.toggle('dot', !alert.count);
        el.classList.add('has-site-alert');
        el.setAttribute('data-alert', alert.text);
        el.title = alert.text;
    }

    // Main game: badges on the existing nav buttons. map = { alertKey: buttonId }
    function applyNavBadges(map) {
        const a = alerts();
        for (const key in map) setBadge(document.getElementById(map[key]), a[key]);
    }

    // Secondary pages: replace the "Back to game" pill with a full nav bar
    function renderSiteNav() {
        const here = (location.pathname.split('/').pop() || 'index.html').toLowerCase();
        const nav = document.createElement('nav');
        nav.className = 'site-nav';
        nav.setAttribute('aria-label', 'Game pages');
        nav.innerHTML = PAGES.map(p => {
            const cur = p.href === here;
            return `<a href="${p.href}" class="site-nav-link${cur ? ' current' : ''}${p.href === 'index.html' ? ' home' : ''}"${cur ? ' aria-current="page"' : ''} data-alert-key="${p.alert || ''}">` +
                `<span class="sn-ico" aria-hidden="true">${p.icon}</span><span class="sn-txt">${p.label}</span></a>`;
        }).join('');
        document.querySelectorAll('.page-back').forEach(el => el.remove());
        document.body.prepend(nav);
        document.body.classList.add('has-site-nav');
        refreshSiteNav();
        const cur = nav.querySelector('.current');
        if (cur && cur.scrollIntoView) { try { cur.scrollIntoView({ block: 'nearest', inline: 'center' }); } catch (e) {} }
    }
    function refreshSiteNav() {
        const a = alerts();
        document.querySelectorAll('.site-nav-link[data-alert-key]').forEach(el => {
            const key = el.dataset.alertKey;
            // no badge for the page you're on
            setBadge(el, key && !el.classList.contains('current') ? a[key] : undefined);
        });
    }

    // Skeleton placeholders for the parts of a page that wait on the database. Styles are in theme.css.
    // Each returns markup to drop into innerHTML; screen readers get one "Loading" status instead of the grey boxes.
    const sk = (cls, extra) => '<div class="sk ' + cls + '"' + (extra || '') + '></div>';
    const WHSk = {
        // a list of rows: avatar, two text lines and a button, like members or chat
        rows(n) { return '<div class="sk-list" role="status" aria-label="Loading">' + Array.from({ length: n || 5 }, () => '<div class="sk-item">' + sk('sk-avatar') + '<div class="sk-stack">' + sk('sk-line w60') + sk('sk-line w40') + '</div>' + sk('sk-btn') + '</div>').join('') + '</div>'; },
        // a grid of cards, like the clan browser
        cards(n) { return '<div class="sk-grid" role="status" aria-label="Loading">' + Array.from({ length: n || 6 }, () => '<div class="sk-block">' + sk('sk-line w60') + sk('sk-line') + sk('sk-line w80') + sk('sk-btn') + '</div>').join('') + '</div>'; },
        // one card with a heading and some lines
        panel(lines) { return '<div class="sk-block" role="status" aria-label="Loading">' + sk('sk-head') + Array.from({ length: lines || 4 }, (_, i) => sk('sk-line' + (i % 3 === 2 ? ' w60' : i % 3 === 1 ? ' w80' : ''))).join('') + '</div>'; },
        // table body rows
        tableRows(n, cols) { const widths = ['w40', 'w80', 'w60', 'w40', 'w60']; return Array.from({ length: n || 8 }, () => '<tr class="sk-tr" aria-hidden="true">' + Array.from({ length: cols || 4 }, (_, c) => '<td>' + sk('sk-line ' + widths[c % widths.length]) + '</td>').join('') + '</tr>').join(''); },
    };
    window.WHSk = WHSk;

    window.WHSite = { alerts, applyNavBadges, refreshSiteNav, setBadge, PAGES };

    function init() {
        if (document.body && document.body.dataset.siteNav !== 'off' && document.querySelector('.page-back')) renderSiteNav();
        setInterval(refreshSiteNav, 5000);
        window.addEventListener('storage', refreshSiteNav);
        window.addEventListener('wh:achievements', refreshSiteNav);
    }
    if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init); else init();
})();
