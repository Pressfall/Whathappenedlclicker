/**
 * Renown in the game (index.html): the ⭐ chip in the top bar and its panel.
 * - Renown is one rank for the game and the Wilds together (core/renown.js, worked out by main.js readRenown from
 *   achievements-data.js snapshot(), which reads both saves). Both pages show the same level.
 * - Every 5 levels is a milestone with two halves: this page pays the game's half (consumables, items.js grantItems) and
 *   notes it in localStorage whathappened_renown, which only this page writes. The Wilds pays and notes its own half in
 *   its save, so neither page writes the other's key.
 * - The panel also lists the crew (core/world-crew.js): who has moved to Wildgate, and who is still on the way.
 */
(function () {
    'use strict';
    const R = window.WHRenown, C = window.WHCrew;
    if (!R) return;
    const $ = (id) => document.getElementById(id);
    const esc = (v) => String(v).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
    const fmt = (n) => (typeof window.formatNumber === 'function' ? window.formatNumber(n) : Math.floor(n).toLocaleString('en-US'));
    const say = (msg, ms) => { try { (window.notify || (() => {}))(msg, ms); } catch (e) {} };

    function readJSON(key) { try { return JSON.parse(localStorage.getItem(key) || 'null'); } catch (e) { return null; } }
    function claimedHere() { return R.cleanClaimed(readJSON(R.CLAIMED_KEY)); }
    function claimedInWilds() { const w = readJSON('whathappened_world'); return R.cleanClaimed(w && w.renown && w.renown.claimed); }
    function rank() {
        const G = window.WHGame;
        try { return (G && G.readRenown && G.readRenown()) || R.rank(window.WHA ? window.WHA.snapshot() : {}); } catch (e) { return R.rank({}); }
    }
    const itemText = (items) => Object.entries(items || {}).map(([id, n]) => {
        const it = window.WHI && window.WHI.ITEMS_BY_ID[id];
        return n + ' × ' + (it ? (it.icon ? it.icon + ' ' : '') + it.name : id);
    }).join(', ');
    const potionNames = { potion_small: 'Small Potion', potion_big: 'Big Potion', potion_max: 'Max Potion' };
    const wildsText = (w) => '♦ ' + fmt(w.rubies) + ' rubies' + Object.entries(w.cons || {}).map(([id, n]) => ', ' + n + ' × ' + (potionNames[id] || id)).join('');

    // ---------------- the game's half of a milestone ----------------
    // quiet: no notice (claimAll says it once for all of them)
    function claimNow(level, quiet) {
        const m = R.MILESTONE_BY_LEVEL[level], r = rank();
        if (!m || !r || r.level < level) return false;
        const claimed = claimedHere();
        if (claimed.includes(level) || !(window.WHI && typeof window.WHI.grantItems === 'function')) return false;
        // noted first, so it can never be paid twice; taken back if nothing could be given
        try { localStorage.setItem(R.CLAIMED_KEY, JSON.stringify({ claimed: R.cleanClaimed(claimed.concat([level])) })); } catch (e) { return false; }
        const n = window.WHI.grantItems(m.clicker.items);
        if (!n) {
            try { localStorage.setItem(R.CLAIMED_KEY, JSON.stringify({ claimed })); } catch (e) {}
            return false;
        }
        if (!quiet) say('⭐ Renown ' + level + ': ' + itemText(m.clicker.items) + ' added to your Items.', 6000);
        return true;
    }
    // every milestone waiting on this side, with one notice
    function claimAllNow() {
        const got = {}, levels = [];
        for (const m of R.claimable(rank().level, claimedHere())) {
            if (!claimNow(m.level, true)) continue;
            levels.push(m.level);
            for (const id in m.clicker.items) got[id] = (got[id] || 0) + m.clicker.items[id];
        }
        if (levels.length) say('⭐ Renown ' + levels.join(', ') + ': ' + itemText(got) + ' added to your Items.', 7000);
        return levels.length;
    }
    // two game tabs take turns, so a milestone is only paid once
    // level: one milestone, or 'all'
    function claim(level) {
        const done = () => { render(); updateChip(); };
        const run = () => { if (level === 'all') claimAllNow(); else claimNow(level); done(); };
        if (navigator.locks && typeof navigator.locks.request === 'function') {
            navigator.locks.request('whathappened_renown', run).catch(() => {});
            return;
        }
        run();
    }

    // ---------------- the top-bar chip ----------------
    function updateChip() {
        const chip = $('renownChip');
        if (!chip) return;
        const r = rank(), ready = R.claimable(r.level, claimedHere()).length;
        const lv = $('renownChipLevel');
        if (lv) lv.textContent = String(r.level);
        chip.classList.toggle('has-claim', ready > 0);
        chip.title = 'Renown ' + r.level + ': one rank for the game and the Wilds together' + (ready ? '. A reward is waiting!' : '');
    }

    // ---------------- the panel ----------------
    let panel = null;
    function build() {
        panel = document.createElement('div');
        panel.id = 'renownPanel';
        panel.className = 'rn-overlay';
        panel.hidden = true;
        panel.innerHTML = '<div class="rn-panel" role="dialog" aria-modal="true" aria-labelledby="rnTitle"><div class="rn-head"><h3 id="rnTitle">⭐ Renown</h3>' +
            '<button type="button" class="modal-close rn-close" aria-label="Close Renown">✕</button></div><div class="rn-body" id="rnBody"></div></div>';
        document.body.appendChild(panel);
        panel.addEventListener('click', (ev) => {
            if (ev.target === panel || ev.target.closest('.rn-close')) { close(); return; }
            if (ev.target.closest('[data-rnclaimall]')) { claim('all'); return; }
            const b = ev.target.closest('[data-rnclaim]');
            if (b) claim(Number(b.dataset.rnclaim));
        });
    }
    function sourceRows(r, game) {
        return r.parts.filter(p => p.game === game).map(p => {
            const full = p.pts >= p.cap - 1e-9;
            return `<li class="${full ? 'is-full' : ''}"><div class="rn-src-top"><span>${esc(p.label)}</span><b>${fmt(Math.floor(p.pts))} / ${p.cap}</b></div>` +
                `<div class="rn-mini"><i style="width:${(100 * p.pts / p.cap).toFixed(1)}%"></i></div>` +
                `<div class="rn-hint">${full ? 'Maxed out' : esc(p.hint)}</div></li>`;
        }).join('');
    }
    function milestoneRows(r) {
        const here = claimedHere(), wilds = claimedInWilds();
        // what is waiting, then the next two to come
        // reached ones with either half still to claim (so "claim it in the Wilds" stays in view), then the next two
        const ready = R.claimable(r.level, here);
        const open = R.MILESTONES.filter(m => m.level <= r.level && (!here.includes(m.level) || !wilds.includes(m.level)));
        const upcoming = R.MILESTONES.filter(m => m.level > r.level).slice(0, 2);
        const rows = open.concat(upcoming).map(m => {
            const reached = m.level <= r.level;
            const gameSide = here.includes(m.level) ? '<span class="rn-done">✓ Claimed</span>'
                : reached ? `<button type="button" class="btn btn-gold btn-sm" data-rnclaim="${m.level}">Claim</button>` : '<span class="rn-lock">🔒</span>';
            const wildSide = wilds.includes(m.level) ? '<span class="rn-done">✓ Claimed in the Wilds</span>'
                : reached ? '<span class="rn-elsewhere">Claim it in the Wilds</span>' : '<span class="rn-lock">🔒</span>';
            return `<div class="rn-ms ${reached ? 'is-reached' : ''}"><div class="rn-ms-lv">${m.level}</div>` +
                `<div class="rn-ms-half"><div class="rn-ms-where">🖱️ Here</div><div>${esc(itemText(m.clicker.items))}</div>${gameSide}</div>` +
                `<div class="rn-ms-half"><div class="rn-ms-where">⚔️ The Wilds</div><div>${esc(wildsText(m.wilds))}</div>${wildSide}</div></div>`;
        });
        const doneCount = here.length;
        const all = ready.length > 1 ? `<div class="rn-claimall"><button type="button" class="btn btn-gold" data-rnclaimall>Claim all ${ready.length} here</button></div>` : '';
        return all + (rows.length ? rows.join('') : '<p class="rn-note">Every milestone is claimed. You reached the top.</p>') +
            (doneCount ? `<p class="rn-note">${doneCount} of ${R.MILESTONES.length} milestones claimed here.</p>` : '');
    }
    function crewRows() {
        if (!C) return '';
        const view = C.readView(localStorage, 0);
        return C.CREW.map(c => {
            const known = C.discovered(c.id, view), here = C.arrived(c.id, view);
            const status = here ? '<b class="rn-crew-here">In Wildgate</b>' : known ? `Moves there at level ${c.arrive} (best ${fmt(view.best[c.up])})` : 'Not met yet';
            return `<li class="${here ? 'is-here' : ''}"><img src="${esc(known ? c.face : 'mainimage/whathappened.jpeg')}" alt="" width="36" height="36" class="${known ? '' : 'rn-unknown'}">` +
                `<div><div class="rn-crew-name">${esc(known ? c.name : '???')}</div><div class="rn-crew-status">${status}</div>` +
                `${here ? `<div class="rn-hint">${esc(c.blurb)}</div>` : ''}</div></li>`;
        }).join('');
    }
    function render() {
        if (!panel || panel.hidden) return;
        const r = rank(), b = R.bonus(r.level), body = $('rnBody');
        const top = r.level >= R.MAX_LEVEL;
        const split = r.total > 0 ? (100 * r.clicker / r.total) : 50;
        body.innerHTML = `<div class="rn-level"><div class="rn-big">${r.level}</div><div class="rn-level-info">` +
            `<div class="rn-bar"><i style="width:${(100 * r.frac).toFixed(1)}%"></i></div>` +
            `<div class="rn-sub">${top ? 'The top: Renown ' + R.MAX_LEVEL : fmt(Math.floor(r.total)) + ' / ' + fmt(Math.ceil(r.next)) + ' points to Renown ' + (r.level + 1)}</div></div></div>` +
            `<p class="rn-lead">One rank for both of your jobs: what you did <b>here</b> and in <b>The Wilds</b> both count. One alone gets you to about Renown 70; the top needs both.</p>` +
            `<div class="rn-split" aria-label="Where your points come from"><i class="rn-split-game" style="width:${split.toFixed(1)}%"></i><i class="rn-split-wilds" style="width:${(100 - split).toFixed(1)}%"></i></div>` +
            `<div class="rn-split-key"><span>🖱️ The game: ${fmt(Math.floor(r.clicker))}</span><span>⚔️ The Wilds: ${fmt(Math.floor(r.wilds))}</span></div>` +
            `<div class="rn-boost">Renown ${r.level} gives <b>+${b.cps}% CPS and click power</b> here and <b>+${b.rubies}% rubies</b> in the Wilds.</div>` +
            `<h4>Milestones</h4><div class="rn-ms-list">${milestoneRows(r)}</div>` +
            `<div class="rn-cols"><div><h4>🖱️ From the game</h4><ul class="rn-src">${sourceRows(r, 'clicker')}</ul></div>` +
            `<div><h4>⚔️ From the Wilds</h4><ul class="rn-src">${sourceRows(r, 'wilds')}</ul></div></div>` +
            (C ? `<h4>Your crew in Wildgate</h4><p class="rn-note">Get an upgrade far enough and its character moves to Wildgate, the Wilds' town, with quests and services for you.</p><ul class="rn-crew">${crewRows()}</ul>` : '') +
            '<div class="rn-actions"><a class="btn btn-primary" href="world.html">⚔️ Go to The Wilds</a></div>';
    }
    function open() {
        if (!panel) build();
        if (window.WHGame && window.WHGame.resetRenown) window.WHGame.resetRenown();
        panel.hidden = false;
        render();
        const btn = panel.querySelector('.rn-close');
        if (btn) btn.focus();
    }
    function close() { if (panel) panel.hidden = true; updateChip(); }
    function isOpen() { return !!panel && !panel.hidden; }

    document.addEventListener('keydown', (ev) => { if (ev.key === 'Escape' && isOpen()) { ev.stopPropagation(); close(); } }, true);
    // Renown counts the Wilds, followers and achievements too: refresh when another tab changes them
    window.addEventListener('storage', (ev) => {
        if (!ev.key || /^(whathappened_(world|followers|renown|upgrade_best|save)|ach_)/.test(ev.key)) {
            if (window.WHGame && window.WHGame.resetRenown) window.WHGame.resetRenown();
            updateChip();
            render();
        }
    });
    function start() {
        const chip = $('renownChip');
        if (chip) chip.addEventListener('click', open);
        updateChip();
        setInterval(() => { updateChip(); if (isOpen()) render(); }, 4000);
    }
    if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', start);
    else start();

    window.WHRenownPanel = { open, close, isOpen, claim: claimNow, claimAll: claimAllNow, render, updateChip };
})();
