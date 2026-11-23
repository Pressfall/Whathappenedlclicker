/**
 * Holy What Happeneds 👼: the panel (index.html and world.html). Three tabs: Shop (what Holy What Happeneds buy, in sections:
 * gem packs, Golden, timelapses, boosts, titles, clicker looks, Wilds looks), Earn (how to get them by playing, and what you
 * got lately), Get more (buying them on Ko-fi with your link code, and claiming a payment sent without it). In the game it
 * is its own overlay; in the Wilds it opens in the Wilds' own window, which pauses the game.
 * Opened by the 👼 chip (premium.js) as window.WHBeansPanel.open(tab, section).
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
    const GEM_IMG = 'mainimage/gem.png', GOLDEN_IMG = 'mainimage/thumbs/goldwh.webp';

    // The shop's sections, in the order of the side menu. groups: a section with more than one kind shows each under its own
    // heading. Every kind in core/premium.js KINDS is in exactly one (tests/premium-game.test.js).
    const SECTIONS = [
        { id: 'currency', label: 'Currency', icon: '💰', head: 'Currency',
            sub: 'Gems and Golden What Happeneds for your game. They work like ones earned in the game, so they can also go on lootboxes (which have random contents) and casino bets.',
            groups: [{ kinds: ['gems'], head: 'Gem packs', sub: P.GEM_RATE + ' gems for every ' + CUR.one + ', and the bigger the pack, the bigger the bonus.' },
                { kinds: ['golden'], head: 'Golden What Happeneds', sub: P.GOLDEN.mult + ' times what your next prestige would give you, and never fewer than ' + P.GOLDEN.min + '.' }] },
        { id: 'time', label: 'Timelapses', icon: '⏳', groups: [{ kinds: ['timelapse'] }], head: 'Timelapses',
            sub: 'Skip ahead and collect hours of your income at once. The amount follows what you make per second right now, so the bigger your crew, the more you get.' },
        { id: 'boosts', label: 'Boosts', icon: '⚡', head: 'Boosts', sub: 'Make the game page faster: buffs that run for weeks, and bundles of boosts to use when you like.',
            groups: [{ kinds: ['buff'], head: 'Buffs', sub: 'They run on every device you play on, from the moment you buy them. Buying one that is already running adds its days on top.' },
                { kinds: ['bundle'], head: 'Item bundles', sub: 'Timed boosts that wait in Items until you use them.' }] },
        { id: 'titles', label: 'Titles', icon: '🏷️', groups: [{ kinds: ['title'] }], head: 'Titles', sub: 'Shown next to your name in chat, on the leaderboard and on your profile.' },
        { id: 'clicker', label: 'Clicker looks', icon: '✨', head: 'Clicker looks', sub: 'For the game page. Buy once, switch on and off whenever you like.',
            groups: [{ kinds: ['theme'], head: 'Page themes' },
                { kinds: ['hat'], head: 'Hats', sub: 'Worn by the What Happened you click. One hat at a time, with an accessory if you like.' },
                { kinds: ['accessory'], head: 'Accessories', sub: 'Worn by the What Happened you click. One accessory at a time, with a hat if you like.' },
                { kinds: ['aura'], head: 'Auras', sub: 'Around the What Happened you click.' }, { kinds: ['pop'], head: 'Click effects', sub: 'A burst where you click the What Happened, and a glow to match on the +N. Point at one to see it.' }] },
        { id: 'chat', label: 'Chat effects', icon: '💬', groups: [{ kinds: ['chatfx'] }], head: 'Chat effects',
            sub: 'How your messages look in global chat and clan chat, to everyone. One at a time; switch it off whenever you like.' },
        { id: 'wilds', label: 'Wilds looks', icon: '⚔️', head: 'Wilds looks', sub: 'For your character in the Wilds. Everyone there sees them. Buy once, switch on and off whenever you like.',
            groups: [{ kinds: ['weapon'], head: 'Weapon skins', sub: 'On whatever weapon you hold, relics too, each with its own effect where it hits.' }, { kinds: ['trail'], head: 'Trails' },
                { kinds: ['head'], head: 'Headwear' }, { kinds: ['back'], head: 'Wings' }, { kinds: ['tail'], head: 'Tails' }, { kinds: ['outfit'], head: 'Outfits', sub: 'Over your armour.' }] },
    ];
    // the sections that became Currency (old links and tests ask for them by these names)
    const SECTION_ALIAS = { gems: 'currency', golden: 'currency' };
    const SECTION_OF = {};
    for (const s of SECTIONS) for (const g of s.groups) for (const k of g.kinds) SECTION_OF[k] = s.id;
    // a bundle shows the Items icons of its boosts
    const ITEM_ICONS = { hourglass: '⏳', energyDrink: '🥤', spareBattery: '🔋', loadedDice: '🎲', pocketWatch: '⏱️', overclockChip: '💾', frenzyPotion: '🧪', timeMachine: '🕰️', singularity: '🌀' };
    const BUFF_ICONS = { click: '👆', cps: '⚙️', offline: '🌙', crit: '🎯', all: '✨' };
    const DAY = 86400000;
    const RARITY = { rare: '#6cb8ff', epic: '#c39bff', legendary: '#ffbe55', mythic: '#ff6f91' };

    let tab = 'shop', section = '', confirmId = '', msg = null, histList = null, claimMsg = null, busy = false, pendingRender = false;
    // Get more: the folded parts left open (a redraw rebuilds them), and whether the player pressed "Check now" (the check
    // made on opening the tab only speaks up when it found something)
    let tipOpen = false, claimOpen = false, collectAsked = false;
    // the shop's search and "hide owned" switch, the section last shown (a new one fades in) and the card just bought (it pulses)
    let query = '', hideOwned = false, shownSection = '', justBought = '', justBoughtAt = 0;
    let overlay = null, inWilds = false;

    // ---------------- opening and closing ----------------
    function open(which, sec) {
        if (which) tab = which;
        if (sec) sec = SECTION_ALIAS[sec] || sec;
        if (sec && SECTIONS.some((s) => s.id === sec)) section = sec;
        if (!section) section = B.isWilds ? 'wilds' : 'currency';
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
            <div class="bn-head"><h3 id="bnTitle"><span class="bn-head-ico" aria-hidden="true">${CUR.icon}</span>${esc(CUR.many)}</h3><button type="button" class="modal-close bn-close" aria-label="Close">✕</button></div>
            <div class="bn-body" id="bnBody"></div></div>`;
        document.body.appendChild(overlay);
        overlay.addEventListener('click', (e) => { if (e.target === overlay || e.target.closest('.bn-close')) close(); });
        overlay.addEventListener('keydown', (e) => { if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); close(); } });
    }
    function body() { return inWilds ? document.getElementById('wModalBody') : document.getElementById('bnBody'); }

    // ---------------- the top: balance and tabs ----------------
    function balanceHtml() {
        const s = B.read(), pd = B.paid();
        const bought = pd.signedIn ? fmt(pd.balance) + ' bought' + (pd.live ? '' : ' (checking…)') : pd.balance ? fmt(pd.balance) + ' bought (sign in to use them)' : 'Sign in to use bought ones';
        return `<div class="bn-balance">
            <div class="bn-bal-main"><div class="bn-bal-label">Your balance</div><div class="bn-big">${bean(s.earned + (pd.signedIn ? pd.balance : 0))}</div></div>
            <div class="bn-bal-split"><span><b>${fmt(s.earned)}</b> earned by playing</span><span>${esc(bought)}</span></div>
            ${tab !== 'get' ? '<button type="button" class="btn btn-sm btn-gold bn-getmore" data-bntab="get">Get more</button>' : ''}
        </div>`;
    }
    function tabsHtml() {
        const t = (id, label) => `<button type="button" class="bn-tab${tab === id ? ' is-on' : ''}" data-bntab="${id}" aria-pressed="${tab === id}">${label}</button>`;
        return `<div class="bn-tabs" role="group" aria-label="${esc(CUR.many)}">${t('shop', 'Shop')}${t('earn', 'Earn')}${t('get', 'Get more')}</div>`;
    }

    // ---------------- the shop ----------------
    // a picture of the item at the top of its card
    function artHtml(it) {
        const c = it.swatch || it.colors || [it.main || '#888', it.trim || '#444'];
        switch (it.kind) {
            case 'gems': return `<div class="bn-art bn-art--gems"><img src="${GEM_IMG}" alt="" width="40" height="40"><span class="bn-art-num">${fmt(it.gems)}</span></div>`;
            case 'golden': { const g = B.gives(it); return `<div class="bn-art bn-art--golden"><img src="${GOLDEN_IMG}" alt="" width="44" height="44"><span class="bn-art-num">×${fmt(g.n)}</span></div>`; }
            case 'timelapse': return `<div class="bn-art bn-art--time"><span class="bn-art-clock" aria-hidden="true">⏳</span><span class="bn-art-num">${it.sec / 3600}h</span></div>`;
            case 'bundle': return `<div class="bn-art bn-art--bundle">${Object.keys(it.items).map((k) => {
                const I = window.WHI && window.WHI.ITEMS_BY_ID && window.WHI.ITEMS_BY_ID[k];
                return `<span class="bn-art-item">${esc((I && I.icon) || ITEM_ICONS[k] || '✨')}<small>×${it.items[k]}</small></span>`;
            }).join('')}</div>`;
            case 'title': return `<div class="bn-art bn-art--title"><span class="bn-title-pill" style="--rc:${esc(RARITY[it.rarity] || '#cfd6e0')}">${esc(it.name)}</span></div>`;
            case 'theme': return `<div class="bn-art bn-art--theme" style="--a:${esc(c[0])};--b:${esc(c[1])}"><span class="bn-mini"><i></i><i></i><i></i></span></div>`;
            case 'aura': return `<div class="bn-art bn-art--aura bn-aura-${esc(it.id.replace(/^au_/, ''))}" style="--a:${esc(c[0])};--b:${esc(c[1])}"><span class="bn-aura-core">WH</span></div>`;
            // the burst (premium.js popPreview) plays behind the number after each render, and again when you point at it
            case 'pop': return `<div class="bn-art bn-art--pop" data-bnpop="${esc(it.id)}" style="--a:${esc(c[0])};--b:${esc(c[1])}"><span>+1,234</span></div>`;
            case 'weapon': return `<div class="bn-art bn-art--weapon${it.fx ? ' bn-fx-' + esc(it.fx) : ''}">${weaponSvg(it)}</div>`;
            // the Wilds' own drawing, on a canvas filled in after each render (drawPreviews)
            case 'trail': case 'head': case 'back': case 'tail': case 'outfit':
                return `<div class="bn-art bn-art--look" style="--a:${esc(c[0])}"><canvas class="bn-look" data-bnlook="${esc(it.id)}" width="200" height="104" aria-hidden="true"></canvas></div>`;
            case 'buff': return `<div class="bn-art bn-art--buff bn-art--buff-${esc(it.buff)}"><span class="bn-art-clock" aria-hidden="true">${BUFF_ICONS[it.buff] || '✨'}</span><span class="bn-art-num">${it.buff === 'crit' ? '+' + P.BUFF_EFFECT.crit.pp + '%' : '2×'}</span><small class="bn-art-days">${it.days} days</small></div>`;
            case 'hat': case 'accessory': return `<div class="bn-art bn-art--acc" style="--a:${esc(c[0])}"><span class="bn-acc-tile"><img src="mainimage/whathappened.jpeg" alt="" width="110" height="74"><span class="bn-acc bn-acc--${esc(it.id.replace(/^(ac|ht)_/, ''))}">${(B.ACCESSORY_SVG && B.ACCESSORY_SVG[it.id]) || ''}</span></span></div>`;
            case 'chatfx': return `<div class="bn-art bn-art--chat"><span class="bn-chat-sample"><b>You:</b> <span class="bn-chatfx bn-chatfx-${esc(it.id.replace(/^cf_/, ''))}">GG everyone!</span></span></div>`;
            default: return `<div class="bn-art" style="--a:${esc(c[0])};--b:${esc(c[1])}"></div>`;
        }
    }
    // a sword in the skin's colours (the Wilds draw it on every weapon kind)
    function weaponSvg(it) {
        const id = 'bnws_' + it.id, prism = it.fx === 'prism';
        const blade = prism ? `url(#${id}_g)` : esc(it.main);
        return `<svg viewBox="0 0 140 56" class="bn-svg" aria-hidden="true"><defs>
            <filter id="${id}_f" x="-30%" y="-80%" width="160%" height="260%"><feGaussianBlur stdDeviation="3.2"/></filter>
            ${prism ? `<linearGradient id="${id}_g" x1="0" x2="1"><stop offset="0" stop-color="#ff7a9a"/><stop offset=".25" stop-color="#ffd36b"/><stop offset=".5" stop-color="#7dffb2"/><stop offset=".75" stop-color="#7fb2ff"/><stop offset="1" stop-color="#d59bff"/></linearGradient>` : ''}</defs>
            <g transform="rotate(-18 70 28)">
            <path class="bn-sw-glow" d="M44 22 L114 24 L128 28 L114 32 L44 34 Z" fill="${prism ? '#c9b6ff' : esc(it.glow)}" filter="url(#${id}_f)"/>
            <rect x="14" y="24.5" width="26" height="7" rx="3.5" fill="#5a3d22"/><circle cx="13" cy="28" r="4.2" fill="${esc(it.trim)}"/>
            <rect x="38" y="15" width="6" height="26" rx="2.5" fill="${esc(it.trim)}"/>
            <path d="M44 22.5 L114 24.2 L128 28 L114 31.8 L44 33.5 Z" fill="${blade}"/>
            <path d="M47 28 L118 28" stroke="${esc(it.trim)}" stroke-width="1.3" stroke-linecap="round" opacity=".85"/></g></svg>`;
    }
    // the Wilds looks' pictures: drawn by premium.js with the Wilds' own code, sharp on any screen
    function drawPreviews(root) {
        if (!root || !B.drawPreview) return;
        const dpr = Math.min(3, window.devicePixelRatio || 1);
        for (const cv of root.querySelectorAll('canvas[data-bnlook]')) {
            const w = 200, h = 104;
            if (cv.width !== w * dpr) { cv.width = w * dpr; cv.height = h * dpr; }
            const ctx = cv.getContext && cv.getContext('2d');
            if (!ctx) continue;
            ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
            ctx.clearRect(0, 0, w, h);
            try { B.drawPreview(ctx, cv.dataset.bnlook, w, h); } catch (e) {}
        }
        if (B.popPreview) for (const a of root.querySelectorAll('[data-bnpop]')) { try { B.popPreview(a, a.dataset.bnpop); } catch (e) {} }
    }
    // the corner badge: a gem pack's bonus, or owned / in use
    function badgeHtml(it, s) {
        if (s.owned[it.id]) {
            const on = it.kind === 'title' ? B.wornTitle() === it.name : s.equip[it.kind] === it.id;
            return `<span class="bn-badge ${on ? 'bn-badge--on' : 'bn-badge--owned'}">✓ ${on ? (it.kind === 'title' ? 'Worn' : 'In use') : 'Owned'}</span>`;
        }
        if (it.kind === 'gems') {
            const b = P.gemBonus(it);
            const best = P.CATALOG.filter((c) => c.kind === 'gems').reduce((m, c) => Math.max(m, P.gemBonus(c)), 0);
            if (b > 0) return `<span class="bn-badge ${b === best ? 'bn-badge--best' : 'bn-badge--deal'}">${b === best ? 'Best value · ' : ''}+${b}% gems</span>`;
        }
        if (it.kind === 'buff' && it.buff === 'all') {
            // what the three on their own would cost for as long
            const each = (k) => { const one = P.CATALOG.find((c) => c.kind === 'buff' && c.buff === k && c.days === it.days); return one ? one.cost : 0; };
            const save = each('click') + each('cps') + each('offline') - it.cost;
            if (save > 0) return `<span class="bn-badge bn-badge--best">Save ${CUR.icon} ${fmt(save)}</span>`;
        }
        if (it.kind === 'timelapse') {
            const base = P.CATALOG.find((c) => c.kind === 'timelapse');
            const off = base ? Math.round((1 - (it.cost / (it.sec / base.sec)) / base.cost) * 100) : 0;
            if (off > 0) return `<span class="bn-badge bn-badge--deal">${off}% off</span>`;
        }
        return '';
    }
    // what a repeat item gives now, under its description
    function givesHtml(it) {
        if (it.kind === 'golden') {
            if (!B.canTrade(it)) return '';
            const g = B.gives(it);
            const why = P.GOLDEN.mult * Math.floor(g.next || 0) >= P.GOLDEN.min ? `${P.GOLDEN.mult} × ${fmt(g.next)} from your next prestige` : `the least it gives (your next prestige: ${fmt(g.next)})`;
            return `<p class="bn-gives">You get <b>${fmt(g.n)}</b> now: ${esc(why)}</p>`;
        }
        if (it.kind === 'timelapse') {
            if (!B.canTrade(it)) return '';
            return B.cpsNow() > 0 ? `<p class="bn-gives">You get <b>${esc(B.gives(it).text)}</b> now</p>` : '<p class="bn-gives bn-gives--off">You don\'t make anything per second yet</p>';
        }
        if (it.kind === 'buff') {
            const now = Date.now(), until = P.buffUntil(B.read(), it, now);
            if (until <= now) return `<p class="bn-gives bn-gives--off">${esc(B.buffText ? B.buffText(it) : '')} · not running</p>`;
            const left = until - now, days = Math.ceil(left / DAY), pct = Math.max(3, Math.min(100, Math.round(left / (30 * DAY) * 100)));
            return `<p class="bn-gives">Running: <b>${days} day${days === 1 ? '' : 's'}</b> left, until ${esc(new Date(until).toLocaleDateString())}</p>
                <div class="bn-meter" role="img" aria-label="${days} days left"><i style="width:${pct}%"></i></div>`;
        }
        return '';
    }
    function actionHtml(it, s, have) {
        if (s.owned[it.id]) {
            if (it.kind === 'title') {
                const worn = B.wornTitle() === it.name;
                return `<button type="button" class="btn btn-sm ${worn ? 'btn-ghost' : 'btn-primary'} bn-wide" data-bnwear="${it.id}">${worn ? 'Take off' : 'Wear'}</button>`;
            }
            const on = s.equip[it.kind] === it.id;
            return `<button type="button" class="btn btn-sm ${on ? 'btn-ghost' : 'btn-primary'} bn-wide" data-bnequip="${it.id}">${on ? 'Turn off' : 'Use'}</button>`;
        }
        if (confirmId === it.id) {
            const pd = B.paid(), plan = P.planSpend(s.earned, pd.signedIn ? pd.balance : 0, it.cost);
            const how = plan.fromPaid ? ` (${fmt(plan.fromEarned)} earned + ${fmt(plan.fromPaid)} bought)` : '';
            const what = P.isRepeat(it) && it.kind !== 'bundle' ? B.gives(it).text : it.name;
            return `<div class="bn-confirm" role="group" aria-label="Confirm"><span>Spend ${bean(it.cost)} on ${esc(what)}?${esc(how)}</span>
                <div class="bn-confirm-btns"><button type="button" class="btn btn-sm btn-gold" data-bnyes="${it.id}" ${busy ? 'disabled' : ''}>${busy ? 'Buying…' : 'Buy'}</button>
                <button type="button" class="btn btn-sm btn-ghost" data-bnno="1">Cancel</button></div></div>`;
        }
        if (P.isRepeat(it) && !B.canTrade(it)) return `<span class="bn-need">${it.kind === 'gems' || it.kind === 'golden' ? 'Trade for it' : 'Buy it'} on the game page</span>`;
        if (it.kind === 'timelapse' && !(B.cpsNow() > 0)) return '<span class="bn-need">Buy a few upgrades first</span>';
        const short = it.cost - have;
        return `<button type="button" class="btn btn-sm btn-gold bn-wide bn-price" data-bnbuy="${it.id}" ${short > 0 ? 'aria-disabled="true"' : ''}>${CUR.icon} ${fmt(it.cost)}</button>`
            + (short > 0 ? `<span class="bn-need">${fmt(short)} more needed</span>` : '');
    }
    function cardHtml(it, s, have) {
        const pulse = it.id === justBought && Date.now() - justBoughtAt < 1500 ? ' is-bought' : '';
        return `<article class="bn-card bn-card--${esc(it.kind)}${s.owned[it.id] ? ' is-owned' : ''}${pulse}" data-bnid="${esc(it.id)}">${artHtml(it)}${badgeHtml(it, s)}
            <div class="bn-info"><h5 class="bn-name">${esc(it.name)}</h5><p class="bn-desc">${esc(it.desc)}</p>${it.ref ? `<p class="bn-ref">From ${esc(it.ref)}</p>` : ""}${givesHtml(it)}</div>
            <div class="bn-foot">${actionHtml(it, s, have)}</div></article>`;
    }
    // does an item match the search? (its name, what it is, where it comes from)
    function matches(it, q) {
        if (!q) return true;
        const hay = (it.name + ' ' + it.desc + ' ' + (it.ref || '') + ' ' + it.kind).toLowerCase();
        return q.toLowerCase().split(/\s+/).filter(Boolean).every((w) => hay.includes(w));
    }
    const shown = (it, s) => !(hideOwned && s.owned[it.id]);
    function shopHtml() {
        const s = B.read();
        const sec = SECTIONS.find((x) => x.id === section) || SECTIONS[0];
        const nav = SECTIONS.map((x) => {
            const items = P.CATALOG.filter((c) => SECTION_OF[c.kind] === x.id);
            const looks = items.filter((c) => !P.isRepeat(c));
            const count = looks.length ? `<small>${looks.filter((c) => s.owned[c.id]).length}/${looks.length}</small>` : '';
            const on = x.id === sec.id && !query;
            return `<button type="button" class="bn-cat${on ? ' is-on' : ''}" data-bncat="${x.id}" aria-pressed="${on}"><span class="bn-cat-ico" aria-hidden="true">${x.icon}</span><span class="bn-cat-label">${esc(x.label)}</span>${count}</button>`;
        }).join('');
        const tools = `<div class="bn-tools"><label class="bn-search"><span aria-hidden="true">🔍</span><input id="bnSearch" type="search" placeholder="Search the shop" autocomplete="off" value="${esc(query)}" aria-label="Search the shop"></label>
            <label class="bn-toggle"><input type="checkbox" data-bnhide="1" ${hideOwned ? 'checked' : ''}> Hide owned</label></div>`;
        return `<div class="bn-shop"><nav class="bn-cats" aria-label="Shop sections">${nav}</nav><div class="bn-main">${tools}<div class="bn-main-body">${mainHtml()}</div></div></div>`;
    }
    // the shop's right side: the section, or what the search found
    function mainHtml() {
        const s = B.read(), pd = B.paid(), have = s.earned + (pd.signedIn ? pd.balance : 0);
        const fine = `<p class="bn-fine">${esc(CUR.many)} never buy lootboxes, follower packs or rubies themselves, and the casino doesn't take them.</p>`;
        if (query) {
            const found = P.CATALOG.filter((it) => matches(it, query) && shown(it, s));
            return `<section class="bn-sec" aria-label="Search results"><header class="bn-sec-head"><h4>Results for “${esc(query)}”</h4>
                <p class="bn-sub">${found.length ? found.length + ' item' + (found.length === 1 ? '' : 's') + ' across the shop.' : 'Nothing matches. Try another word, like “hat”, “trail” or an upgrade\'s name.'}</p></header>
                ${found.length ? `<div class="bn-grid">${found.map((it) => cardHtml(it, s, have)).join('')}</div>` : ''}${fine}</section>`;
        }
        const sec = SECTIONS.find((x) => x.id === section) || SECTIONS[0];
        const all = P.CATALOG.filter((c) => SECTION_OF[c.kind] === sec.id), looks = all.filter((c) => !P.isRepeat(c));
        const counts = looks.length ? `${looks.length} looks · ${looks.filter((c) => s.owned[c.id]).length} owned` : `${all.length} items`;
        const groups = sec.groups.map((g) => {
            const items = P.CATALOG.filter((c) => g.kinds.includes(c.kind) && shown(c, s));
            if (!items.length) return '';
            return `${g.head ? `<h5 class="bn-group">${esc(g.head)}</h5>` : ''}${g.sub ? `<p class="bn-sub">${esc(g.sub)}</p>` : ''}<div class="bn-grid">${items.map((it) => cardHtml(it, s, have)).join('')}</div>`;
        }).join('');
        const enter = shownSection !== sec.id ? ' bn-sec--enter' : '';
        shownSection = sec.id;
        return `<section class="bn-sec${enter}" aria-label="${esc(sec.head)}"><header class="bn-sec-head"><div class="bn-sec-title"><h4>${esc(sec.head)}</h4><span class="bn-count">${counts}</span></div><p class="bn-sub">${esc(sec.sub)}</p></header>
            ${groups || '<p class="bn-empty">You own everything here. Switch off “Hide owned” to see it all.</p>'}${fine}</section>`;
    }

    // ---------------- earning ----------------
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

    // ---------------- getting more on Ko-fi ----------------
    // what each kind of Ko-fi payment is called in "Your Ko-fi purchases" (the worker stores Ko-fi's own names)
    const KIND_NAMES = { 'Shop Order': 'Shop pack', Donation: 'Tip', Subscription: 'Membership', Manual: 'Added by the game' };
    function getHtml() {
        if (!C.buyingOpen()) return `<div class="bn-note">Buying ${esc(CUR.many)} isn't open yet. Everything in the shop can be earned by playing: see the Earn tab.</div>`;
        const c = cloud();
        if (!c || !c.ready) return '<p class="bn-sub">Checking your account…</p>';
        if (!c.user) return `<div class="bn-note">Sign in to your account first. Bought ${esc(CUR.many)} are kept in your account, so they're never lost and work on every device.</div>
            <p><a class="btn btn-primary" href="account.html">Sign in or make an account</a></p>`;
        const packs = C.activePacks();
        const code = c.linkCode;
        const art = (n) => `<div class="bn-art bn-art--pack"><span class="bn-art-clock" aria-hidden="true">${CUR.icon}</span><span class="bn-art-num">${fmt(n)}</span></div>`;
        // the packs sold in the Ko-fi Shop: bought like anything in a shop; whose they are comes from the email paid with
        const dollarsOf = (s) => { const m = /\d+(?:\.\d+)?/.exec(String(s || '')); return m ? Number(m[0]) : 0; };
        const shopBase = packs.length && dollarsOf(packs[0].price) ? packs[0].beans / dollarsOf(packs[0].price) : 0;
        const shopHtml = packs.length ? `<div class="bn-grid bn-grid--packs">${packs.map((p) => {
            const d = dollarsOf(p.price), bonus = shopBase && d ? Math.round((p.beans / d / shopBase - 1) * 100) : 0;
            return `<article class="bn-card bn-card--pack">${art(p.beans)}${bonus > 0 ? `<span class="bn-badge bn-badge--deal">+${bonus}% more</span>` : ''}
                <div class="bn-info"><h5 class="bn-name">${esc(p.name)}</h5><p class="bn-desc">${bean(p.beans)} · ${esc(p.price)}</p></div>
                <div class="bn-foot"><a class="btn btn-sm btn-gold bn-wide" href="${esc(C.shopItemUrl(p.code))}" target="_blank" rel="noopener">Buy on Ko-fi ↗</a></div></article>`;
        }).join('')}</div>` : '';
        // "cp•••8@gmail.com": enough to recognise, not the whole address on screen
        const masked = (() => { const m = /^([^@]*)(@.*)$/.exec(c.email || ''); if (!m) return ''; const l = m[1]; return (l.length > 3 ? l.slice(0, 2) + '•••' + l.slice(-1) : l.slice(0, 1) + '•••') + m[2]; })();
        const got = c.collected;
        const gotHtml = c.collectState === 'busy' ? '<p class="bn-sub" role="status">Checking for purchases… The server looks every minute.</p>'
            : got && got.ok && got.count ? `<p class="bn-msg is-ok" role="status">Found ${got.count === 1 ? 'a purchase' : got.count + ' purchases'}: ${fmt(got.beans)} ${esc(CUR.many)} added to your account.</p>`
            : got && got.ok && collectAsked ? '<p class="bn-msg is-ok" role="status">Nothing waiting. A purchase usually arrives within a minute or two of paying.</p>'
            : got && !got.ok && collectAsked ? `<p class="${got.reason === 'waiting' ? 'bn-sub' : 'bn-msg is-bad'}" role="status">${esc(got.message)}</p>` : '';
        const emailHtml = !packs.length ? ''
            : !c.email ? '<div class="bn-note bn-note--warn">Your account has no email address, so a Ko-fi purchase can\'t find it by itself. After paying, claim it below with the transaction ID from your receipt.</div>'
            : !c.emailVerified ? `<div class="bn-note bn-note--warn">Verify your email (<b>${esc(masked)}</b>) on the <a href="account.html">Account page</a> first, so Ko-fi purchases made with it find your account. Paid already? Claim it below with the transaction ID from your receipt.</div>`
            : `<div class="bn-note">Pay on Ko-fi with <b>${esc(masked)}</b>, the email you sign in with here, and they're added to your account by themselves, usually within a minute or two.
                <button type="button" class="btn btn-sm btn-primary" data-bncollect="1" ${c.collectState === 'busy' ? 'disabled' : ''}>Check now</button></div>${gotHtml}`;
        const codeHtml = c.link === 'ready' ? `<div class="bn-code"><code id="bnCode">${esc(code)}</code><button type="button" class="btn btn-sm btn-primary" data-bncopy="1">Copy</button></div>`
            : c.link === 'error' ? `<div class="bn-note bn-note--warn">Your link code couldn't be set up${c.error === 'rules' ? ' (the server isn\'t ready for it yet)' : ''}. Try again later.</div>`
            : '<p class="bn-sub">Getting your link code…</p>';
        const rates = C.rates(C.donationRate);
        const tips = rates.length ? `<p class="bn-sub">Or send a tip on <a href="${esc(C.kofiPage)}" target="_blank" rel="noopener">Ko-fi</a> with your code in the message: ${esc(rates.map(([cur, r]) => fmt(r) + ' ' + CUR.many + ' per 1 ' + cur).join(', '))}.</p>` : '';
        // the packs, paid as tips: the amount picks the pack (any amount works, at the rate of the biggest pack it reaches)
        const tipPacks = C.activeTipPacks ? C.activeTipPacks() : [];
        const money = (d) => (C.tipCurrency === 'USD' ? '$' : '') + (Number.isInteger(d) ? d : d.toFixed(2)) + (C.tipCurrency === 'USD' ? '' : ' ' + C.tipCurrency);
        const baseRate = tipPacks.length ? tipPacks[0].beans / tipPacks[0].dollars : 0;
        const tipHtml = tipPacks.length ? `<div class="bn-grid bn-grid--packs">${tipPacks.map((p) => {
            const bonus = baseRate ? Math.round((p.beans / p.dollars / baseRate - 1) * 100) : 0;
            return `<article class="bn-card bn-card--pack"><div class="bn-art bn-art--pack"><span class="bn-art-clock" aria-hidden="true">${CUR.icon}</span><span class="bn-art-num">${fmt(p.beans)}</span></div>
                ${bonus > 0 ? `<span class="bn-badge bn-badge--deal">+${bonus}% more</span>` : ''}
                <div class="bn-info"><h5 class="bn-name">${esc(p.name)}</h5><p class="bn-desc">${bean(p.beans)} for a ${esc(money(p.dollars))} tip</p></div>
                <div class="bn-foot"><a class="btn btn-sm btn-gold bn-wide" href="${esc(C.kofiPage)}" target="_blank" rel="noopener">Tip ${esc(money(p.dollars))} on Ko-fi ↗</a></div></article>`;
        }).join('')}</div>
            <p class="bn-sub">Any amount from ${esc(money(1))} works: in between packs you get the rate of the biggest pack you reached.</p>` : '';
        const step2 = tipPacks.length
            ? `On Ko-fi, type the amount, paste your code in <b>Your message</b> (you can tick <b>Private message</b>), and pay`
            : `Pick ${esc(CUR.many)} on Ko-fi and paste the code in the message box before you pay`;
        const hist = histList === null ? '<p class="bn-sub">Loading…</p>' : histList.length
            ? '<ul class="bn-log">' + histList.map((h) => `<li><span class="bn-plus">+${fmt(h.beans)}</span> ${esc(KIND_NAMES[h.kind] || h.kind || 'Ko-fi')} <time>${h.at ? esc(new Date(h.at).toLocaleDateString()) : ''}</time></li>`).join('') + '</ul>'
            : '<p class="bn-sub">None yet.</p>';
        // tipping with the link code in the message: the only way before the Shop packs, and still there for any amount
        const tipWay = `<ol class="bn-steps"><li><h4>Copy your link code</h4>${codeHtml}</li>
            <li><h4>${step2}</h4></li></ol>
            ${tipHtml}
            ${tips}
            <p class="bn-sub">Your code only says whose account the ${esc(CUR.many)} go to. It works for every purchase you make, and sharing it can't cost you anything: someone else using it would only be buying ${esc(CUR.many)} for you.</p>
            <p class="bn-sub">They arrive within a minute or two of paying.</p>`;
        const hasTips = tipPacks.length > 0 || rates.length > 0;
        return `<div class="bn-note bn-note--parent">Under 18? Ask a parent or guardian before buying anything.</div>
            ${packs.length ? `<h4>Buy a pack</h4>${shopHtml}${emailHtml}
                ${hasTips ? `<details class="bn-tipway"${tipOpen ? ' open' : ''}><summary>Or send a tip with your link code</summary>${tipWay}</details>` : ''}` : tipWay}
            <p class="bn-sub">Bought ${esc(CUR.many)} are for this game only and can't be turned back into money.</p>
            <h4>Your Ko-fi purchases</h4>${hist}
            <details class="bn-claim"${claimOpen ? ' open' : ''}><summary>${packs.length ? 'Paid with another email, or without your code?' : 'Paid without your code?'}</summary>
                <p class="bn-sub">Enter the transaction ID from your Ko-fi receipt and the email you paid with. If you can't find it, ask us (Settings, Help &amp; privacy).</p>
                <form id="bnClaim" autocomplete="off"><label>Transaction ID <input name="txid" maxlength="64" required></label>
                <label>Email you paid with <input name="email" type="email" maxlength="254" required></label>
                <button type="submit" class="btn btn-sm btn-primary" ${busy ? 'disabled' : ''}>Claim</button></form>
                ${busy ? '<p class="bn-sub" role="status">Checking with the server… It looks every minute.</p>' : ''}
                ${claimMsg ? `<p class="bn-msg ${claimMsg.ok ? 'is-ok' : 'is-bad'}" role="status">${esc(claimMsg.text)}</p>` : ''}</details>`;
    }

    // ---------------- render and actions ----------------
    function render() {
        const el = body();
        if (!el || !isOpen()) return;
        // never redraw under someone typing in the claim form (one arriving would wipe what they typed)
        const a = document.activeElement;
        if (a && el.contains(a) && a.tagName === 'INPUT' && a.closest('#bnClaim') && !busy) { pendingRender = true; return; }
        const searching = a && a.id === 'bnSearch' && el.contains(a) ? { start: a.selectionStart, end: a.selectionEnd } : null;
        pendingRender = false;
        const keepScroll = el.scrollTop;
        const main = tab === 'earn' ? earnHtml() : tab === 'get' ? getHtml() : shopHtml();
        el.innerHTML = `<div class="bn-root"><div class="bn-top">${balanceHtml()}${tabsHtml()}${msg ? `<p class="bn-msg ${msg.ok ? 'is-ok' : 'is-bad'}" role="status">${esc(msg.text)}</p>` : ''}</div><div class="bn-tabbody">${main}</div></div>`;
        el.scrollTop = keepScroll;
        drawPreviews(el);
        // the side menu sticks just below the top (balance and tabs), which sticks too
        try { const top = el.querySelector('.bn-top'); if (top) el.style.setProperty('--bn-top-h', top.offsetHeight + 'px'); } catch (e) {}
        if (searching) { const inp = document.getElementById('bnSearch'); if (inp) { inp.focus({ preventScroll: true }); try { inp.setSelectionRange(searching.start, searching.end); } catch (e) {} } }
        if (tab === 'get') loadGet();
    }
    let loadingGet = false;
    function loadGet() {
        const c = cloud();
        if (!c || !c.user || loadingGet || !C.buyingOpen()) return;
        if (c.link === 'none') { loadingGet = true; c.ensureLink().finally(() => { loadingGet = false; render(); }); }
        if (histList === null) { histList = []; c.history().then((h) => { histList = h; render(); }); }
        // purchases made with the account's email: once a page load, then on "Check now"
        if (C.activePacks().length && typeof c.collect === 'function' && c.emailVerified && c.collectState === 'none') collectNow(false);
    }
    function collectNow(asked) {
        const c = cloud();
        if (!c || typeof c.collect !== 'function' || c.collectState === 'busy') return;
        collectAsked = asked;
        c.collect().then((r) => { if (r && r.ok && r.count) histList = null; render(); });
    }
    const REASONS = {
        short: 'Not enough ' + CUR.many + ' yet.', signin: 'Sign in to use the ' + CUR.many + ' you bought.', owned: 'You already have it.',
        rules: 'The server refused the purchase. Nothing was taken. Try again later.', network: 'Couldn\'t reach the server. Nothing was taken. Try again.',
        unknown: 'That item isn\'t in the shop any more.',
        'game-only': 'Buy gems, Golden, timelapses and boosts on the game page.',
        'no-cps': 'A timelapse pays what you make per second, and you don\'t make anything yet. Buy a few upgrades first.',
    };
    function boughtText(r) {
        const it = r.item;
        if (it.kind === 'gems' || it.kind === 'golden') return 'Added ' + r.gave.text + ' to your game.';
        if (it.kind === 'timelapse') return it.name + ': +' + r.gave.text + '.';
        if (it.kind === 'bundle') return 'Bought ' + it.name + '. It\'s in Items, ready to use.';
        if (it.kind === 'buff') return it.name + ': ' + (B.buffText ? B.buffText(it) : '') + ' until ' + new Date(P.buffUntil(B.read(), it, Date.now())).toLocaleDateString() + '.';
        if (it.kind === 'chatfx') return 'Bought ' + it.name + '. Your chat messages show it now.';
        if (it.kind === 'accessory' || it.kind === 'hat') return 'Bought ' + it.name + '. The What Happened is wearing it now' + (it.kind === 'hat' ? ', in place of any other hat.' : ', in place of any other accessory.');
        if (it.kind === 'title') return 'Bought ' + it.name + '. Wear it here or in Settings > Title.';
        if (P.WILDS_KINDS.includes(it.kind)) return 'Bought ' + it.name + '. It\'s on in the Wilds, and everyone there sees it.';
        return 'Bought ' + it.name + '. It\'s on now.';
    }
    async function doBuy(id) {
        if (busy) return;
        busy = true; render();
        const r = await B.buy(id);
        busy = false; confirmId = '';
        msg = r.ok ? { ok: true, text: boughtText(r) } : { ok: false, text: REASONS[r.reason] || REASONS.network };
        if (r.ok) { justBought = id; justBoughtAt = Date.now(); }
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
        if (d.bncat) { section = d.bncat; tab = 'shop'; confirmId = ''; msg = null; query = ''; render(); const s = el.querySelector('.bn-sec'); if (s && s.scrollIntoView && el.scrollTop > s.offsetTop) s.scrollIntoView({ block: 'start' }); return; }
        if (d.bnbuy) {
            const s = B.read(), pd = B.paid(), it = P.BY_ID[d.bnbuy];
            const have = s.earned + (pd.signedIn ? pd.balance : 0);
            if (it && have < it.cost) { msg = { ok: false, text: 'You need ' + fmt(it.cost - have) + ' more ' + CUR.many + (pd.signedIn || !pd.balance ? '.' : '. Sign in to use the ones you bought.') }; render(); return; }
            confirmId = d.bnbuy; msg = null; render(); return;
        }
        if (d.bnyes) { doBuy(d.bnyes); return; }
        if (d.bnno) { confirmId = ''; render(); return; }
        if (d.bncollect) { collectNow(true); return; }
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
    // the search updates the right side as you type (the field itself stays, so it keeps focus); Escape clears it
    function refreshMain() {
        const el = body(), host = el && el.querySelector('.bn-main-body');
        if (!host) { render(); return; }
        host.innerHTML = mainHtml();
        for (const b of el.querySelectorAll('[data-bncat]')) { const on = b.dataset.bncat === section && !query; b.classList.toggle('is-on', on); b.setAttribute('aria-pressed', String(on)); }
        drawPreviews(host);
    }
    function onInput(e) {
        const t = e.target;
        if (!t || !isOpen() || !body() || !body().contains(t)) return;
        if (t.id === 'bnSearch') { query = t.value.trim().slice(0, 40); confirmId = ''; refreshMain(); }
        else if (t.dataset && t.dataset.bnhide) { hideOwned = !!t.checked; refreshMain(); }
    }
    document.addEventListener('input', onInput);
    document.addEventListener('change', (e) => { if (e.target && e.target.dataset && e.target.dataset.bnhide) onInput(e); });
    document.addEventListener('keydown', (e) => {
        if (e.key === 'Escape' && e.target && e.target.id === 'bnSearch' && e.target.value) { e.preventDefault(); e.stopPropagation(); e.target.value = ''; query = ''; refreshMain(); }
    }, true);
    document.addEventListener('click', onClick);
    // pointing at a click-number card plays its burst again (premium.js skips it while one is still going)
    document.addEventListener('pointerover', (e) => {
        const a = e.target && e.target.closest && e.target.closest('[data-bnpop]');
        if (a && B.popPreview && isOpen()) { try { B.popPreview(a, a.dataset.bnpop); } catch (err) {} }
    });
    document.addEventListener('submit', onSubmit);
    // a redraw skipped while someone was typing happens once they leave the field
    document.addEventListener('focusout', () => { if (pendingRender) setTimeout(() => { if (pendingRender) render(); }, 0); });
    // live: Holy What Happeneds earned or arriving while the panel is open
    B.onChange(() => { if (isOpen() && !busy) render(); });

    // the folded parts of Get more stay as the player left them
    document.addEventListener('toggle', (e) => {
        const t = e.target;
        if (!t || !t.classList) return;
        if (t.classList.contains('bn-tipway')) tipOpen = t.open;
        else if (t.classList.contains('bn-claim')) claimOpen = t.open;
    }, true);

    window.WHBeansPanel = { open, close, isOpen, render, SECTIONS };

    // Ko-fi sends a buyer back here after paying (the shop items link to the game with ?holy=get): open Get more, which
    // collects the purchase. The parameter is taken off the address so a reload doesn't open it again.
    try {
        if (/[?&]holy=get(&|$)/.test(location.search) && !B.isWilds) {
            const rest = location.search.replace(/([?&])holy=get(&|$)/, (m, a, b) => (b ? a : '')).replace(/^\?$/, '');
            try { history.replaceState(history.state, '', location.pathname + rest + location.hash); } catch (e) {}
            setTimeout(() => open('get'), 300);
        }
    } catch (e) {}
})();
