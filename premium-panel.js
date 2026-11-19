/**
 * Holy What Happeneds 👼: the panel (index.html and world.html). Three tabs: Shop (looks bought with Holy What Happeneds), Earn (how to get them by
 * playing, and what you got lately), Get more (buying them on Ko-fi with your link code, and claiming a payment sent
 * without it). In the game it is its own overlay; in the Wilds it opens in the Wilds' own window, which pauses the game.
 * Opened by the 👼 chip (premium.js) as window.WHBeansPanel.open(tab).
 */
(function () {
    'use strict';
    const P = window.WHPremium, C = window.WHPremiumConfig, Kofi = window.WHKofi;
    if (!P || !C || !window.WHBeans || window.WHBeansPanel) return;
    const B = window.WHBeans;
    const CUR = C.currency;
    const esc = (v) => String(v).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
    const fmt = (n) => Math.floor(Number(n) || 0).toLocaleString('en-US');
    const bean = (n) => '<span class="bn-amt">' + CUR.icon + ' ' + fmt(n) + '</span>';
    const cloud = () => window.WHBeansCloud || null;
    const SECTIONS = [
        { kinds: ['exchange', 'bundle'], head: 'For your game', sub: 'Gems, Golden and boosts, a few times a week. Gems and Golden work like ones earned in the game, so they can go on lootboxes (which have random contents) and on casino bets. Boosts wait in Items until you use them.' },
        { kinds: ['title'], head: 'Titles', sub: 'Shown next to your name in chat, on the leaderboard and on your profile.' },
        { kinds: ['theme'], head: 'Game page themes', sub: 'New colours for the clicker page.' },
        { kinds: ['aura'], head: 'Clicker auras', sub: 'Around the What Happened you click.' },
        { kinds: ['pop'], head: 'Click numbers', sub: 'How the +N looks when you click.' },
        { kinds: ['trail'], head: 'Wilds trails', sub: 'Follows you as you walk in the Wilds. Only you see it.' },
        { kinds: ['mark'], head: 'Wilds halo and wings', sub: 'On your character in the Wilds. Only you see them.' },
    ];
    // a bundle shows the Items icon of its first boost
    const ITEM_ICONS = { hourglass: '⏳', energyDrink: '🥤', spareBattery: '🔋', loadedDice: '🎲', pocketWatch: '⏱️' };

    let tab = 'shop', confirmId = '', msg = null, histList = null, claimMsg = null, busy = false, pendingRender = false;
    let overlay = null, inWilds = false;

    // ---------------- opening and closing ----------------
    function open(which) {
        if (which) tab = which;
        confirmId = ''; msg = null;
        const W = window.WHW;
        if (B.isWilds && W && W.ui && typeof W.ui.modal === 'function') {
            inWilds = true;
            W.ui.modal(TITLE, '', { wide: true, render, onClose: () => { inWilds = false; } });
            render();
            return;
        }
        if (!overlay) build();
        overlay.hidden = false;
        document.body.classList.add('bn-open');
        render();
        setTimeout(() => { try { overlay.querySelector('.bn-close').focus({ preventScroll: true }); } catch (e) {} }, 0);
    }
    function close() {
        if (inWilds) { if (wildsShowing() && window.WHW && window.WHW.ui) window.WHW.ui.closeModal(); inWilds = false; return; }
        if (!overlay) return;
        overlay.hidden = true;
        document.body.classList.remove('bn-open');
        try { const chip = document.getElementById('beanChip'); if (chip) chip.focus({ preventScroll: true }); } catch (e) {}
    }
    // in the Wilds, only while the Wilds' window still shows this panel (another window, e.g. the knocked-out screen, may replace it)
    const TITLE = CUR.icon + ' ' + CUR.many;
    function wildsShowing() {
        const m = document.getElementById('wModal'), t = document.getElementById('wModalTitle');
        return !!m && !m.hidden && !!t && t.textContent === TITLE;
    }
    const isOpen = () => (inWilds ? (wildsShowing() || (inWilds = false)) : !!overlay && !overlay.hidden);
    function build() {
        overlay = document.createElement('div');
        overlay.className = 'bn-overlay';
        overlay.hidden = true;
        overlay.innerHTML = `<div class="bn-panel" role="dialog" aria-modal="true" aria-labelledby="bnTitle">
            <div class="bn-head"><h3 id="bnTitle">${CUR.icon} ${esc(CUR.many)}</h3><button type="button" class="modal-close bn-close" aria-label="Close">✕</button></div>
            <div class="bn-body" id="bnBody"></div></div>`;
        document.body.appendChild(overlay);
        overlay.addEventListener('click', (e) => { if (e.target === overlay || e.target.closest('.bn-close')) close(); });
        overlay.addEventListener('keydown', (e) => { if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); close(); } });
    }
    function body() { return inWilds ? document.getElementById('wModalBody') : document.getElementById('bnBody'); }

    // ---------------- the parts ----------------
    function balanceHtml() {
        const s = B.read(), pd = B.paid();
        const parts = [fmt(s.earned) + ' earned by playing'];
        if (pd.signedIn) parts.push(fmt(pd.balance) + ' bought' + (pd.live ? '' : ' (checking…)'));
        else if (pd.balance) parts.push(fmt(pd.balance) + ' bought (sign in to use them)');
        return `<div class="bn-balance"><div class="bn-big">${bean(s.earned + (pd.signedIn ? pd.balance : 0))}</div><div class="bn-split">${esc(parts.join(' · '))}</div></div>`;
    }
    function tabsHtml() {
        const t = (id, label) => `<button type="button" class="bn-tab${tab === id ? ' is-on' : ''}" data-bntab="${id}" aria-pressed="${tab === id}">${label}</button>`;
        return `<div class="bn-tabs" role="group" aria-label="Holy What Happeneds">${t('shop', 'Shop')}${t('earn', 'Earn')}${t('get', 'Get more')}</div>`;
    }
    function swatch(it) {
        if (it.kind === 'title') return '<span class="bn-sw bn-sw--title" aria-hidden="true">🏷️</span>';
        if (it.kind === 'exchange') return `<span class="bn-sw bn-sw--title" aria-hidden="true"><img src="${it.gems ? 'mainimage/gem.png' : 'mainimage/thumbs/goldwh.webp'}" alt="" width="28" height="28"></span>`;
        if (it.kind === 'bundle') {
            const first = Object.keys(it.items)[0], I = window.WHI && window.WHI.ITEMS_BY_ID && window.WHI.ITEMS_BY_ID[first];
            return `<span class="bn-sw bn-sw--title" aria-hidden="true">${esc((I && I.icon) || ITEM_ICONS[first] || '✨')}</span>`;
        }
        const c = it.swatch || it.colors || ['#888', '#444'];
        return `<span class="bn-sw" aria-hidden="true" style="background:linear-gradient(135deg, ${esc(c[0])}, ${esc(c[1])})"></span>`;
    }
    function actionHtml(it, s, have) {
        if (s.owned[it.id]) {
            if (it.kind === 'title') {
                const worn = B.wornTitle() === it.name;
                return `<button type="button" class="btn btn-sm ${worn ? 'btn-ghost' : 'btn-primary'}" data-bnwear="${it.id}">${worn ? 'Take off' : 'Wear'}</button>${worn ? '<span class="bn-on">Worn</span>' : ''}`;
            }
            const on = s.equip[it.kind] === it.id;
            return `<button type="button" class="btn btn-sm ${on ? 'btn-ghost' : 'btn-primary'}" data-bnequip="${it.id}">${on ? 'Turn off' : 'Use'}</button>${on ? '<span class="bn-on">In use</span>' : ''}`;
        }
        if (confirmId === it.id) {
            const pd = B.paid(), plan = P.planSpend(s.earned, pd.signedIn ? pd.balance : 0, it.cost);
            const how = plan.fromPaid ? ` (${fmt(plan.fromEarned)} earned + ${fmt(plan.fromPaid)} bought)` : '';
            return `<div class="bn-confirm" role="group" aria-label="Confirm"><span>Spend ${bean(it.cost)} on ${esc(it.name)}?${esc(how)}</span>
                <button type="button" class="btn btn-sm btn-gold" data-bnyes="${it.id}" ${busy ? 'disabled' : ''}>${busy ? 'Buying…' : 'Buy'}</button>
                <button type="button" class="btn btn-sm btn-ghost" data-bnno="1">Cancel</button></div>`;
        }
        const short = it.cost - have;
        let note = short > 0 ? `<span class="bn-need">${fmt(short)} more</span>` : '';
        if (P.isRepeat(it)) {
            const left = P.weekLeft(s, it.id, Date.now());
            if (!B.canTrade(it)) return `<span class="bn-need">${it.kind === 'bundle' ? 'Buy it' : 'Trade for it'} on the game page</span>`;
            if (left <= 0) return `<button type="button" class="btn btn-sm btn-ghost" disabled>All ${it.perWeek} used this week</button>`;
            note += `<span class="bn-need">${left} of ${it.perWeek} left this week</span>`;
        }
        return `<button type="button" class="btn btn-sm btn-gold" data-bnbuy="${it.id}" ${short > 0 ? 'aria-disabled="true"' : ''}>${CUR.icon} ${fmt(it.cost)}</button>` + note;
    }
    function shopHtml() {
        const s = B.read(), pd = B.paid(), have = s.earned + (pd.signedIn ? pd.balance : 0);
        const secs = SECTIONS.map((sec) => {
            const items = P.CATALOG.filter((c) => sec.kinds.includes(c.kind));
            return `<section class="bn-sec"><h4>${esc(sec.head)}</h4><p class="bn-sub">${esc(sec.sub)}</p><div class="bn-grid">${items.map((it) => `
                <div class="bn-card${s.owned[it.id] ? ' is-owned' : ''}">${swatch(it)}<div class="bn-card-main"><div class="bn-name">${esc(it.name)}</div>
                <div class="bn-desc">${esc(it.desc)}</div><div class="bn-act">${actionHtml(it, s, have)}</div></div></div>`).join('')}</div></section>`;
        }).join('');
        return secs + `<p class="bn-fine">${esc(CUR.many)} buy looks, and gems, Golden What Happeneds and boosts up to a weekly limit. They never buy lootboxes, follower packs or rubies themselves, and the casino doesn't take them.</p>`;
    }
    function earnHtml() {
        const s = B.read(), now = Date.now();
        const Br = window.WHWorldBridge;
        const wk = Br ? Br.weekKey(now) : '';
        const has = (id) => id in s.grants;
        const count = (pre) => Object.keys(s.grants).filter((k) => k.startsWith(pre)).length;
        const ch = (() => { try { return JSON.parse(localStorage.getItem('whathappened_challenges') || 'null'); } catch (e) { return null; } })();
        const streak = ch && ch.streak ? Number(ch.streak.n) || 0 : 0;
        const every = window.WHChallenges ? window.WHChallenges.STREAK_EVERY : 7;
        const D = window.WHWorldData, bosses = D && D.BOSSES ? Object.keys(D.BOSSES).length : 9;
        const E = P.EARN, A = E.achievement;
        const row = (ico, what, amt, status, done) => `<li class="bn-row${done ? ' is-done' : ''}"><span class="bn-ico" aria-hidden="true">${ico}</span><div><div class="bn-what">${what}</div><div class="bn-status">${status}</div></div><div class="bn-pay">${amt}</div></li>`;
        const rows = [
            row('📋', 'Claim all three weekly challenges', '+' + E.weekly + ' a week', has('wk:' + wk) ? '✓ Done this week' : 'Not yet this week (📋 in the game\'s top bar)', has('wk:' + wk)),
            row('🔥', 'Every ' + every + 'th day in a row with all three dailies', '+' + E.streak, 'Streak now: ' + streak + ' day' + (streak === 1 ? '' : 's'), false),
            row('🏆', 'Achievements, once each', 'up to +' + A.mythic, `Rare and uncommon +${A.rare}, epic +${A.epic}, legendary +${A.legendary}, mythic +${A.mythic} · ${count('ach:')} counted so far`, false),
            row('🐉', 'Beat each Wilds boss for the first time', '+' + E.boss + ' each', count('boss:') + ' of ' + bosses + ' counted', count('boss:') >= bosses),
            row('🏟️', 'Finish an Arena season with 5+ rated games', '+' + E.season.bronze + ' to +' + E.season.champion, 'By the best rank you reached (Gold +' + E.season.gold + ', Champion +' + E.season.champion + '). Claim it from the Arena Master.', false),
            row('⚔️', 'Varro\'s shop in the Arena: 1,500 Glory', '+' + E.glory + ' a week', has('glory:' + wk + ':1') ? '✓ Bought this week' : 'Once a week', has('glory:' + wk + ':1')),
        ].join('');
        const log = s.log.slice().reverse().slice(0, 12).map((e) => `<li><span class="${e.n >= 0 ? 'bn-plus' : 'bn-minus'}">${e.n >= 0 ? '+' : '−'}${fmt(Math.abs(e.n))}</span> ${esc(e.why)} <time>${esc(new Date(e.t).toLocaleDateString())}</time></li>`).join('');
        return `<ul class="bn-rows">${rows}</ul><p class="bn-fine">Earned ${esc(CUR.many)} are saved with your progress (and in your account when you're signed in).</p>
            <h4>Lately</h4>${log ? `<ul class="bn-log">${log}</ul>` : '<p class="bn-sub">Nothing yet.</p>'}`;
    }
    function getHtml() {
        if (!C.buyingOpen()) return `<div class="bn-note">Buying ${esc(CUR.many)} isn't open yet. Everything in the shop can be earned by playing: see the Earn tab.</div>`;
        const c = cloud();
        if (!c || !c.ready) return '<p class="bn-sub">Checking your account…</p>';
        if (!c.user) return `<div class="bn-note">Sign in to your account first. Bought ${esc(CUR.many)} are kept in your account, so they're never lost and work on every device.</div>
            <p><a class="btn btn-primary" href="account.html">Sign in or make an account</a></p>`;
        const packs = C.activePacks();
        const code = c.linkCode;
        const codeHtml = c.link === 'ready' ? `<div class="bn-code"><code id="bnCode">${esc(code)}</code><button type="button" class="btn btn-sm btn-primary" data-bncopy="1">Copy</button></div>`
            : c.link === 'error' ? `<div class="bn-note bn-note--warn">Your link code couldn't be set up${c.error === 'rules' ? ' (the server isn\'t ready for it yet)' : ''}. Try again later.</div>`
            : '<p class="bn-sub">Getting your link code…</p>';
        const rates = C.rates(C.donationRate);
        const tips = rates.length ? `<p class="bn-sub">Or send a tip on <a href="${esc(C.kofiPage)}" target="_blank" rel="noopener">Ko-fi</a> with your code in the message: ${esc(rates.map(([cur, r]) => fmt(r) + ' ' + CUR.many + ' per 1 ' + cur).join(', '))}.</p>` : '';
        const hist = histList === null ? '<p class="bn-sub">Loading…</p>' : histList.length
            ? '<ul class="bn-log">' + histList.map((h) => `<li><span class="bn-plus">+${fmt(h.beans)}</span> ${esc(h.kind || 'Ko-fi')} <time>${h.at ? esc(new Date(h.at).toLocaleDateString()) : ''}</time></li>`).join('') + '</ul>'
            : '<p class="bn-sub">None yet.</p>';
        return `<div class="bn-note bn-note--parent">Under 18? Ask a parent or guardian before buying anything.</div>
            <h4>1. Copy your link code</h4>${codeHtml}
            <h4>2. Pick ${esc(CUR.many)} on Ko-fi and paste the code in the message box before you pay</h4>
            <div class="bn-grid">${packs.map((p) => `<div class="bn-card"><span class="bn-sw bn-sw--title" aria-hidden="true">${CUR.icon}</span><div class="bn-card-main">
                <div class="bn-name">${esc(p.name)}</div><div class="bn-desc">${bean(p.beans)} · ${esc(p.price)}</div>
                <div class="bn-act"><a class="btn btn-sm btn-gold" href="${esc(C.shopItemUrl(p.code))}" target="_blank" rel="noopener">Open on Ko-fi ↗</a></div></div></div>`).join('')}</div>
            ${tips}
            <p class="bn-sub">They arrive within a minute or two of paying. Bought ${esc(CUR.many)} are for this game only and can't be turned back into money.</p>
            <h4>Your Ko-fi purchases</h4>${hist}
            <details class="bn-claim"><summary>Paid without your code?</summary>
                <p class="bn-sub">Enter the transaction ID from your Ko-fi receipt and the email you paid with. If you can't find it, ask us (Settings, Help &amp; privacy).</p>
                <form id="bnClaim" autocomplete="off"><label>Transaction ID <input name="txid" maxlength="64" required></label>
                <label>Email you paid with <input name="email" type="email" maxlength="254" required></label>
                <button type="submit" class="btn btn-sm btn-primary" ${busy ? 'disabled' : ''}>Claim</button></form>
                ${claimMsg ? `<p class="bn-msg ${claimMsg.ok ? 'is-ok' : 'is-bad'}" role="status">${esc(claimMsg.text)}</p>` : ''}</details>`;
    }

    // ---------------- render and actions ----------------
    function render() {
        const el = body();
        if (!el || !isOpen()) return;
        // never redraw under someone typing in the claim form (one arriving would wipe what they typed)
        const a = document.activeElement;
        if (a && el.contains(a) && a.tagName === 'INPUT' && !busy) { pendingRender = true; return; }
        pendingRender = false;
        const keepScroll = el.scrollTop;
        const main = tab === 'earn' ? earnHtml() : tab === 'get' ? getHtml() : shopHtml();
        el.innerHTML = `<div class="bn-root">${balanceHtml()}${tabsHtml()}${msg ? `<p class="bn-msg ${msg.ok ? 'is-ok' : 'is-bad'}" role="status">${esc(msg.text)}</p>` : ''}<div class="bn-tabbody">${main}</div></div>`;
        el.scrollTop = keepScroll;
        if (tab === 'get') loadGet();
    }
    let loadingGet = false;
    function loadGet() {
        const c = cloud();
        if (!c || !c.user || loadingGet || !C.buyingOpen()) return;
        if (c.link === 'none') { loadingGet = true; c.ensureLink().finally(() => { loadingGet = false; render(); }); }
        if (histList === null) { histList = []; c.history().then((h) => { histList = h; render(); }); }
    }
    const REASONS = {
        short: 'Not enough ' + CUR.many + ' yet.', signin: 'Sign in to use the ' + CUR.many + ' you bought.', owned: 'You already have it.',
        rules: 'The server refused the purchase. Nothing was taken. Try again later.', network: 'Couldn\'t reach the server. Nothing was taken. Try again.',
        unknown: 'That item isn\'t in the shop any more.',
        week: 'That\'s all of those for this week. More from Monday.', 'game-only': 'Buy gems, Golden and boosts on the game page.',
    };
    async function doBuy(id) {
        if (busy) return;
        busy = true; render();
        const r = await B.buy(id);
        busy = false; confirmId = '';
        if (r.ok) msg = { ok: true, text: r.item.kind === 'exchange' ? 'Traded: ' + r.item.name + ' added to your game.'
            : r.item.kind === 'bundle' ? 'Bought ' + r.item.name + '. It\'s in Items, ready to use.'
            : 'Bought ' + r.item.name + (r.item.kind === 'title' ? '. Wear it below or in Settings > Title.' : r.item.kind === 'mark' || r.item.kind === 'trail' ? '. You\'ll see it in the Wilds.' : '. It\'s on now.') };
        else msg = { ok: false, text: REASONS[r.reason] || REASONS.network };
        if (r.ok && r.item.kind === 'title' && !B.wornTitle()) B.wearTitle(r.item.name);
        render();
    }
    function onClick(e) {
        const t = e.target.closest('button, a');
        if (!t || !isOpen()) return;
        const el = body();
        if (!el || !el.contains(t)) return;
        const d = t.dataset;
        if (d.bntab) { tab = d.bntab; confirmId = ''; msg = null; claimMsg = null; if (tab === 'get') histList = null; render(); return; }
        if (d.bnbuy) {
            const s = B.read(), pd = B.paid(), it = P.BY_ID[d.bnbuy];
            const have = s.earned + (pd.signedIn ? pd.balance : 0);
            if (it && have < it.cost) { msg = { ok: false, text: 'You need ' + fmt(it.cost - have) + ' more ' + CUR.many + (pd.signedIn || !pd.balance ? '.' : '. Sign in to use the ones you bought.') }; render(); return; }
            confirmId = d.bnbuy; msg = null; render(); return;
        }
        if (d.bnyes) { doBuy(d.bnyes); return; }
        if (d.bnno) { confirmId = ''; render(); return; }
        if (d.bnequip) { B.equip(d.bnequip); render(); return; }
        if (d.bnwear) { const it = P.BY_ID[d.bnwear]; if (it) B.wearTitle(B.wornTitle() === it.name ? '' : it.name); render(); return; }
        if (d.bncopy) {
            const c = cloud(), code = c ? c.linkCode : '';
            const done = () => { msg = { ok: true, text: 'Copied ' + code + '. Paste it in the message box on Ko-fi.' }; render(); };
            try { navigator.clipboard.writeText(code).then(done, () => selectCode()); } catch (err) { selectCode(); }
        }
    }
    function selectCode() {
        const el = document.getElementById('bnCode');
        if (!el) return;
        const r = document.createRange(); r.selectNodeContents(el);
        const sel = window.getSelection(); sel.removeAllRanges(); sel.addRange(r);
        msg = { ok: true, text: 'Press Ctrl+C (or hold and Copy) to copy your code.' };
    }
    async function onSubmit(e) {
        if (!e.target || e.target.id !== 'bnClaim') return;
        e.preventDefault();
        const c = cloud();
        if (!c || busy) return;
        const f = e.target;
        busy = true; claimMsg = null; render();
        const field = (n) => { const el = f.elements.namedItem(n); return el && 'value' in el ? el.value : ''; };
        const r = await c.claim(field('txid'), field('email'));
        busy = false;
        claimMsg = r.ok ? { ok: true, text: 'Claimed: ' + fmt(r.beans) + ' ' + CUR.many + ' added to your account.' } : { ok: false, text: r.message };
        if (r.ok) histList = null;
        render();
        const d = body() && body().querySelector('.bn-claim');
        if (d) d.open = true;
    }
    document.addEventListener('click', onClick);
    document.addEventListener('submit', onSubmit);
    // a redraw skipped while someone was typing happens once they leave the field
    document.addEventListener('focusout', () => { if (pendingRender) setTimeout(() => { if (pendingRender) render(); }, 0); });
    // live: Holy What Happeneds earned or arriving while the panel is open
    B.onChange(() => { if (isOpen() && !busy) render(); });

    window.WHBeansPanel = { open, close, isOpen, render };
})();
