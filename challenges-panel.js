/**
 * Daily and weekly challenges in the game (index.html): the 📋 chip in the top bar and its panel. The rules are in
 * core/challenges.js; this page keeps the state in localStorage whathappened_challenges (only this page writes it), measures
 * progress on main.js WHGame.liveSnapshot() (achievements-data.js snapshot() with the page's live numbers), and pays:
 * boosts through items.js WHI.grantItems, chests through WHI.grantBoxes, gems through main.js addGems.
 * A claim is noted in the saved state before anything is given, and two game tabs take turns (navigator.locks), so nothing
 * is paid twice.
 */
(function () {
    'use strict';
    const C = window.WHChallenges, Bridge = window.WHWorldBridge;
    if (!C) return;
    const $ = (id) => document.getElementById(id);
    const esc = (v) => String(v).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
    const say = (msg, ms) => { try { (window.notify || (() => {}))(msg, ms); } catch (e) {} };
    const fmt = (n) => (typeof window.formatNumber === 'function' ? window.formatNumber(n) : Math.floor(n).toLocaleString('en-US'));

    function load() { try { return C.clean(JSON.parse(localStorage.getItem(C.KEY) || 'null')); } catch (e) { return C.fresh(); } }
    function save(s) { try { localStorage.setItem(C.KEY, JSON.stringify(s)); return true; } catch (e) { return false; } }
    function snap() {
        try { return (window.WHGame && window.WHGame.liveSnapshot && window.WHGame.liveSnapshot()) || (window.WHA ? window.WHA.snapshot() : {}); } catch (e) { return {}; }
    }
    // read, change and save the state, one tab at a time
    function withState(fn) {
        const run = () => { const s = load(); const out = fn(s); return out; };
        if (navigator.locks && typeof navigator.locks.request === 'function') return navigator.locks.request('whathappened_challenges', run);
        return Promise.resolve(run());
    }

    // ---------------- rewards ----------------
    const boxNames = (Bridge && Bridge.BOX_NAMES) || ['Wooden Crate', 'Iron Chest', 'Golden Chest', 'Diamond Chest', 'Mythic Vault'];
    const PLURALS = { spareBattery: 'Spare Batteries', pocketWatch: 'Pocket Watches', loadedDice: 'Loaded Dice', hourglass: 'Hourglasses' };
    function itemName(id, n) {
        const it = window.WHI && window.WHI.ITEMS_BY_ID && window.WHI.ITEMS_BY_ID[id];
        const name = it ? it.name : id;
        const plural = PLURALS[id] || name + 's';
        return (it && it.icon ? it.icon + ' ' : '') + (n === 1 ? name : plural);
    }
    function rewardText(r) {
        const parts = [];
        if (r.gems) parts.push(r.gems + (r.gems === 1 ? ' gem' : ' gems'));
        for (const id in r.items || {}) parts.push(r.items[id] + ' ' + itemName(id, r.items[id]));
        for (const t in r.boxes || {}) parts.push(r.boxes[t] + ' ' + boxNames[t] + (r.boxes[t] > 1 ? 's' : ''));
        return parts.join(', ');
    }
    function give(r) {
        const I = window.WHI;
        if (r.items && I && typeof I.grantItems === 'function') I.grantItems(r.items, { quiet: true });
        if (r.boxes && I && typeof I.grantBoxes === 'function') {
            const counts = boxNames.map((_, i) => r.boxes[i] || 0);
            I.grantBoxes(counts, { notWorld: true });
        }
        if (r.gems && typeof window.addGems === 'function') window.addGems(r.gems, chipPoint());
    }
    function chipPoint() {
        const el = $('challengeChip');
        try { const b = el.getBoundingClientRect(); if (b.width) return { x: b.left + b.width / 2, y: b.top + b.height / 2 }; } catch (e) {}
        return null;
    }

    // ids: one challenge id, or 'all' for everything finished. Returns a promise of what was paid.
    function claim(ids) {
        return withState((s) => {
            const now = Date.now(), sn = snap();
            C.observe(s, sn, now);
            const list = ids === 'all' ? ['day', 'week'].flatMap((p) => C.list(s, p, sn).filter((v) => v.done && !v.claimed).map((v) => v.id)) : [ids];
            const total = {}, notes = [];
            for (const id of list) {
                const r = C.claim(s, id, sn, now);
                if (!r.ok) continue;
                C.merge(total, r.reward);
                if (r.bonus) notes.push(C.BY_ID[id].period === 'day' ? 'all three dailies' : 'all three weeklies');
                if (r.streakPaid) notes.push(r.streak + '-day streak');
            }
            state = s;
            if (!Object.keys(total).length) { render(); updateChip(); return null; }
            // noted first: if the save can't be written, nothing is given (and it can be claimed again)
            if (!save(s)) { say('Could not save. Nothing was claimed; try again.'); return null; }
            give(total);
            say('📋 ' + (notes.length ? 'Done ' + notes.join(' and ') + '! ' : 'Challenge done! ') + '+' + rewardText(total), 6000);
            render(); updateChip();
            return total;
        });
    }
    function reroll(id) {
        return withState((s) => {
            const now = Date.now(), sn = snap();
            C.observe(s, sn, now);
            const r = C.reroll(s, id, sn, now);
            state = s;
            if (r.ok) save(s);
            else if (r.reason === 'used') say('You already swapped a daily today.');
            render(); updateChip();
            return r;
        });
    }

    // ---------------- the top-bar chip ----------------
    let state = load();
    function tick() {
        return withState((s) => {
            const sn = snap();
            if (C.observe(s, sn, Date.now())) save(s);
            state = s;
            updateChip(sn);
            if (isOpen()) render(sn);
        });
    }
    function updateChip(sn) {
        const chip = $('challengeChip');
        if (!chip) return;
        const ready = C.claimable(state, sn || snap());
        const n = $('challengeChipCount');
        if (n) { n.textContent = String(ready); n.hidden = !ready; }
        chip.classList.toggle('has-claim', ready > 0);
        chip.title = ready ? ready + ' challenge' + (ready > 1 ? 's' : '') + ' ready to claim' : 'Daily and weekly challenges';
    }

    // ---------------- the panel ----------------
    let panel = null;
    function left(ms) {
        const m = Math.max(1, Math.ceil(ms / 60000));
        if (m >= 1440) return Math.floor(m / 1440) + 'd ' + Math.floor((m % 1440) / 60) + 'h';
        return m >= 60 ? Math.floor(m / 60) + 'h ' + (m % 60) + 'm' : m + 'm';
    }
    function build() {
        panel = document.createElement('div');
        panel.id = 'challengePanel';
        panel.className = 'rn-overlay ch-overlay';
        panel.hidden = true;
        panel.innerHTML = '<div class="rn-panel ch-panel" role="dialog" aria-modal="true" aria-labelledby="chTitle"><div class="rn-head"><h3 id="chTitle">📋 Challenges</h3>' +
            '<button type="button" class="modal-close ch-close" aria-label="Close challenges">✕</button></div><div class="rn-body" id="chBody"></div></div>';
        document.body.appendChild(panel);
        panel.addEventListener('click', (ev) => {
            if (ev.target === panel || ev.target.closest('.ch-close')) { close(); return; }
            if (ev.target.closest('[data-chall]')) { claim('all'); return; }
            const b = ev.target.closest('[data-chclaim]');
            if (b) { claim(b.dataset.chclaim); return; }
            const r = ev.target.closest('[data-chreroll]');
            if (r) reroll(r.dataset.chreroll);
        });
    }
    function rows(list, canReroll) {
        return list.map((v) => {
            const pct = (100 * v.progress / v.target).toFixed(1);
            const action = v.claimed ? '<span class="rn-done">✓ Claimed</span>'
                : v.done ? `<button type="button" class="btn btn-gold btn-sm" data-chclaim="${esc(v.id)}">Claim</button>`
                    : canReroll ? `<button type="button" class="btn btn-ghost btn-sm ch-reroll" data-chreroll="${esc(v.id)}" title="Swap this one for another (once a day)">🎲 Swap</button>` : '';
            return `<li class="ch-row${v.claimed ? ' is-claimed' : v.done ? ' is-done' : ''}"><span class="ch-ico" aria-hidden="true">${v.icon}</span>` +
                `<div class="ch-main"><div class="ch-text">${esc(v.text)}</div><div class="rn-mini" role="progressbar" aria-valuemin="0" aria-valuemax="${v.target}" aria-valuenow="${v.progress}"><i style="width:${pct}%"></i></div>` +
                `<div class="ch-sub"><span>${fmt(v.progress)} / ${fmt(v.target)}</span><span class="ch-reward">${esc(rewardText(v.reward))}</span></div></div>` +
                `<div class="ch-act">${action}</div></li>`;
        }).join('');
    }
    function section(title, period, list, sn, now) {
        const p = state[period], bonus = C.BONUS[period];
        const claimed = list.filter((v) => v.claimed).length;
        const canReroll = period === 'day' && p && !p.rerolled;
        return `<section class="ch-sec"><div class="ch-sec-head"><h4>${title}</h4><span class="ch-reset">New ${period === 'day' ? 'ones' : 'week'} in ${left(C.endsAt(period, now) - now)}</span></div>` +
            `<ul class="ch-list">${rows(list, canReroll)}</ul>` +
            `<div class="ch-bonus${p && p.bonus ? ' is-claimed' : ''}">${p && p.bonus ? '✓' : '🏁'} All three (${claimed}/${list.length}): <b>${esc(rewardText(bonus))}</b></div></section>`;
    }
    function render(sn) {
        if (!panel || panel.hidden) return;
        sn = sn || snap();
        const now = Date.now(), body = $('chBody');
        const day = C.list(state, 'day', sn), week = C.list(state, 'week', sn);
        const ready = day.concat(week).filter((v) => v.done && !v.claimed).length;
        const st = C.streakState(state, now);
        body.innerHTML = (ready > 1 ? `<div class="rn-claimall"><button type="button" class="btn btn-gold" data-chall>Claim all ${ready}</button></div>` : '') +
            section('Today', 'day', day, sn, now) +
            `<div class="ch-streak">🔥 <b>${st.n}</b> day${st.n === 1 ? '' : 's'} in a row with all three dailies${st.today ? ' (today counted)' : ''}. ` +
            `${st.next === C.STREAK_EVERY && st.n ? 'A Golden Chest came with today\'s! ' : ''}Every ${C.STREAK_EVERY}th day in a row adds ${esc(rewardText(C.STREAK_PAY))}.</div>` +
            section('This week', 'week', week, sn, now) +
            '<p class="rn-note">Progress counts from the start of the day or week, here and in the Wilds. Gems only come from the weeklies.</p>';
    }
    function open() {
        if (!panel) build();
        panel.hidden = false;
        tick();
        render();
        const btn = panel.querySelector('.ch-close');
        if (btn) btn.focus();
    }
    function close() { if (panel) panel.hidden = true; updateChip(); }
    function isOpen() { return !!panel && !panel.hidden; }

    document.addEventListener('keydown', (ev) => { if (ev.key === 'Escape' && isOpen()) { ev.stopPropagation(); close(); } }, true);
    window.addEventListener('storage', (ev) => { if (!ev.key || ev.key === C.KEY) { state = load(); updateChip(); render(); } });
    let started = false;
    function start() {
        if (started) return; // once, even if the ready event comes twice
        started = true;
        const chip = $('challengeChip');
        if (chip) chip.addEventListener('click', open);
        // after the game has loaded its save, so the first baseline is the real one
        const begin = () => { tick(); setInterval(tick, 2000); };
        if (window._saveLoaded) begin(); else setTimeout(function wait() { if (window._saveLoaded) begin(); else setTimeout(wait, 500); }, 500);
    }
    if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', start);
    else start();

    window.WHChallengePanel = { open, close, isOpen, claim, reroll, tick, state: () => state, render, updateChip };
})();
