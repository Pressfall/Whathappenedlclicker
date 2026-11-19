/**
 * Holy What Happeneds 👼 on the page (index.html and world.html): the balance chip, paying earned Holy What Happeneds, buying and wearing cosmetics.
 * The rules are in core/premium.js; the account's bought Holy What Happeneds in premium-cloud.js (window.WHBeansCloud, loaded as a
 * module once Firebase is there); the panel in premium-panel.js.
 *
 * - The state is localStorage whathappened_premium. Both pages write it, always read fresh and written straight back in one
 *   go (mutate), so neither page ever writes an old copy over the other's; purchases and the earning check also take a
 *   Web Lock, so two tabs take turns.
 * - Earned Holy What Happeneds are worked out from the saves every few seconds (core/premium.js sources), so nothing in main.js or the
 *   Wilds has to report them, and each is paid once whichever page sees it first.
 * - Looks: the theme and click-number style are classes on <body> (premium.css); the Wilds trail is drawn by drawTrail,
 *   called from world-actors.js drawPlayer.
 */
(function () {
    'use strict';
    const P = window.WHPremium, C = window.WHPremiumConfig;
    if (!P || !C || window.WHBeans) return;
    const KEY = P.KEY;
    const isWilds = !!document.getElementById('wCanvas');
    const listeners = new Set();
    const $ = (id) => document.getElementById(id);
    const say = (msg, ms) => { try { if (typeof window.notify === 'function') window.notify(msg, ms || 4500); } catch (e) {} };
    const readJSON = (k) => { try { return JSON.parse(localStorage.getItem(k) || 'null'); } catch (e) { return null; } };

    // ---------------- state ----------------
    function read() { return P.clean(readJSON(KEY)); }
    function write(s) { try { localStorage.setItem(KEY, JSON.stringify(s)); return true; } catch (e) { return false; } }
    // read, change, write back at once. fn returns false to write nothing.
    function mutate(fn) {
        const s = read();
        const r = fn(s);
        if (r !== false) { write(s); changed(); }
        return r;
    }
    function withLock(fn) {
        if (navigator.locks && typeof navigator.locks.request === 'function') return navigator.locks.request('whathappened_premium', () => fn());
        return Promise.resolve().then(fn);
    }
    function changed() {
        applyLooks();
        renderChip();
        for (const fn of listeners) { try { fn(); } catch (e) {} }
    }

    // ---------------- the account's bought Holy What Happeneds (premium-cloud.js) ----------------
    const cloud = () => window.WHBeansCloud || null;
    // { signedIn, live, balance }: live is the account's own number; until it arrives, the last one this device saw for that
    // account (shown, never spent: spending always asks the account)
    function paid() {
        const c = cloud();
        if (c && c.user) {
            if (c.live) return { signedIn: true, live: true, balance: c.balance };
            const s = read();
            return { signedIn: true, live: false, balance: s.paid.uid === c.user.uid ? s.paid.balance : 0 };
        }
        if (c && c.ready) return { signedIn: false, live: false, balance: 0 }; // signed out (or an anonymous Wilds sign-in)
        const s = read();
        return { signedIn: false, live: false, balance: s.paid.balance }; // the module hasn't loaded yet
    }
    function total() { return read().earned + paid().balance; }
    // keep the last known account balance, so the chip shows it straight away next time
    window.addEventListener('whbeans-cloud', () => {
        const c = cloud();
        if (c && c.user && c.live) {
            const s = read();
            if (s.paid.uid !== c.user.uid || s.paid.balance !== c.balance) { mutate((st) => { st.paid = { uid: c.user.uid, balance: c.balance, at: Date.now() }; }); return; }
        }
        changed();
    });

    // ---------------- earning ----------------
    function view() {
        const ach = [];
        const A = window.WHA;
        if (A && Array.isArray(A.ACHIEVEMENTS)) for (const a of A.ACHIEVEMENTS) { try { if (A.isUnlocked(a)) ach.push({ key: a.key, rarity: a.rarity, name: a.name }); } catch (e) {} }
        let world = null;
        try { world = isWilds && window.WHW && window.WHW.game && window.WHW.game.state ? window.WHW.game.state : readJSON('whathappened_world'); } catch (e) { world = null; }
        const bossNames = {};
        const D = window.WHWorldData;
        if (D && D.BOSSES) for (const id in D.BOSSES) bossNames[id] = D.BOSSES[id].name;
        return {
            achievements: ach, world, challenges: readJSON('whathappened_challenges'), bossNames,
            seasonMinGames: window.WHWorldArena && window.WHWorldArena.SEASON ? window.WHWorldArena.SEASON.minGames : 5,
            streakEvery: window.WHChallenges ? window.WHChallenges.STREAK_EVERY : 7,
        };
    }
    function scan() {
        return withLock(() => {
            const now = Date.now();
            const list = P.sources(view(), now);
            const r = mutate((s) => {
                const before = JSON.stringify(s.grants) + s.started;
                const out = P.applyEarnings(s, list, now);
                return (out.paid || JSON.stringify(s.grants) + s.started !== before) ? out : false;
            });
            if (r && r.paid) {
                const why = r.items.length === 1 ? r.items[0].why : r.items.length + ' things you did';
                say(C.currency.icon + ' +' + r.paid + ' ' + P.plural(r.paid) + ': ' + why, 5500);
                bumpChip();
            }
            return r;
        }).catch(() => null);
    }

    // ---------------- buying ----------------
    // gems, Golden and boosts live in the game's saves, so they can only be bought on the game page (main.js and items.js are
    // there). it: one item, or none for "can this page hand over gems, Golden and boosts at all".
    function canTrade(it) {
        const gems = typeof window.addGems === 'function' && typeof window.addGolden === 'function';
        const items = !!(window.WHI && typeof window.WHI.grantItems === 'function');
        if (!it) return gems && items;
        return it.kind === 'bundle' ? items : gems;
    }
    // hand a repeat item over to the game (it is already paid for and saved)
    function deliver(it) {
        try {
            if (it.gems) window.addGems(it.gems);
            if (it.golden) window.addGolden(it.golden);
            if (it.items && !window.WHI.grantItems(it.items)) console.warn('Holy What Happeneds: the boosts could not be added', it.id);
        } catch (e) { console.warn('Holy What Happeneds: handing over', it.id, e); }
    }
    // Returns { ok, reason?: 'unknown' | 'owned' | 'week' | 'game-only' | 'short' | 'signin' | 'rules' | 'network', short? }
    async function buy(id) {
        const it = P.BY_ID[id];
        const chk = P.canBuy(read(), id, Date.now());
        if (!chk.ok) return chk;
        if (P.isRepeat(it) && !canTrade(it)) return { ok: false, reason: 'game-only' };
        return withLock(async () => {
            const s = read();
            const again = P.canBuy(s, id, Date.now()); // another tab may have bought it, or used up the week, meanwhile
            if (!again.ok) return again;
            const pd = paid();
            const plan = P.planSpend(s.earned, pd.signedIn ? pd.balance : 0, it.cost);
            if (!plan.ok) return { ok: false, reason: 'short', short: plan.short, signedIn: pd.signedIn };
            let spendId = '';
            if (plan.fromPaid > 0) {
                const c = cloud();
                if (!c || !c.user) return { ok: false, reason: 'signin' };
                const r = await c.spend(it.id, plan.fromPaid);
                if (!r.ok) return r;
                spendId = r.id;
            }
            if (P.isRepeat(it)) {
                // saved first, then handed over: the game page saves its own saves at once (addGems / addGolden / grantItems)
                let ok = mutate((st) => P.completeExchange(st, id, plan.fromEarned, Date.now(), spendId));
                // the account already paid its part: what this device still has of the earned part is taken, and it goes through
                if (!ok && spendId) ok = mutate((st) => P.completeExchange(st, id, Math.min(plan.fromEarned, st.earned), Date.now(), spendId));
                if (!ok) return { ok: false, reason: 'short' };
                deliver(it);
                try { if (typeof window.playSfx === 'function') window.playSfx('audio/purchase.wav'); } catch (e) {}
                return { ok: true, item: it, fromEarned: plan.fromEarned, fromPaid: plan.fromPaid };
            }
            let done = mutate((st) => P.completePurchase(st, id, plan.fromEarned, Date.now(), spendId));
            // the account already paid but this device's earned Holy What Happeneds changed meanwhile: the item still arrives (it is logged)
            if (!done && spendId) done = mutate((st) => P.restoreFromSpends(st, [{ id: spendId, item: id }]).length > 0);
            if (!done) return { ok: false, reason: 'short' };
            giveTitles();
            try { if (typeof window.playSfx === 'function') window.playSfx('audio/purchase.wav'); } catch (e) {}
            return { ok: true, item: it, fromEarned: plan.fromEarned, fromPaid: plan.fromPaid };
        });
    }
    // purchases logged in the account that this device doesn't have (a new device, or a tab that closed mid-purchase)
    function restore(spends) {
        let back = [];
        mutate((s) => { back = P.restoreFromSpends(s, spends); return true; });
        if (back.length) { giveTitles(); say(C.currency.icon + ' Restored from your account: ' + back.map((x) => x.name).join(', '), 6000); }
        return back;
    }
    function equip(id) { return mutate((s) => P.equip(s, id)); }

    // ---------------- looks ----------------
    // bought titles join the game's titles (localStorage unlocked_titles: main.js shows them in Settings > Title and in chat)
    function giveTitles() {
        const s = read();
        const want = P.CATALOG.filter((c) => c.kind === 'title' && s.owned[c.id]);
        if (!want.length) return;
        if (typeof window.addUnlockedTitle === 'function') { for (const c of want) { try { window.addUnlockedTitle({ name: c.name, rarity: c.rarity }); } catch (e) {} } return; }
        let list = readJSON('unlocked_titles');
        if (!Array.isArray(list)) list = [];
        const names = new Set(list.map((x) => (typeof x === 'string' ? x : x && x.name)));
        let add = false;
        for (const c of want) if (!names.has(c.name)) { list.push({ name: c.name, rarity: c.rarity }); add = true; }
        if (add) try { localStorage.setItem('unlocked_titles', JSON.stringify(list)); } catch (e) {}
    }
    function wearTitle(name) {
        if (typeof window.setEquippedTitle === 'function') { window.setEquippedTitle(name); return; }
        try { if (name) localStorage.setItem('equipped_title', name); else localStorage.removeItem('equipped_title'); } catch (e) {}
    }
    function wornTitle() { try { return localStorage.getItem('equipped_title') || ''; } catch (e) { return ''; } }
    let shownLooks = '';
    function applyLooks() {
        const b = document.body;
        if (!b) return;
        const s = read();
        const key = s.equip.theme + '|' + s.equip.pop + '|' + s.equip.aura;
        if (key === shownLooks) return;
        shownLooks = key;
        for (const c of [...b.classList]) if (/^bn-(theme|pop|aura)-/.test(c)) b.classList.remove(c);
        if (!isWilds && s.equip.theme) b.classList.add('bn-theme-' + s.equip.theme.replace(/^th_/, ''));
        if (s.equip.pop) b.classList.add('bn-pop-' + s.equip.pop.replace(/^pop_/, ''));
        if (!isWilds && s.equip.aura) b.classList.add('bn-aura-' + s.equip.aura.replace(/^au_/, ''));
    }

    // the Wilds: a trail behind the player, and a halo or wings on them (world-actors.js drawPlayer calls this before drawing
    // the player, so wings sit behind the body and the halo floats over the head)
    const puffs = [];
    let lastPos = null, trailId = '', markId = '', trailCheck = 0, moveT = 0;
    function drawTrail(ctx, p) {
        const now = performance.now() / 1000;
        if (now - trailCheck > 1) { trailCheck = now; const e = read().equip; trailId = e.trail; markId = e.mark; }
        if (!p) { puffs.length = 0; return; }
        const E = window.WHW && window.WHW.engine;
        const low = E && E.perf === 'low';
        if (lastPos && Math.hypot(p.x - lastPos.x, p.y - lastPos.y) > 1) moveT = now;
        if (markId) drawMark(ctx, p, markId, now, low, now - moveT < 0.25);
        const t = P.BY_ID[trailId];
        if (!t) { puffs.length = 0; lastPos = { x: p.x, y: p.y }; return; }
        if (lastPos && Math.hypot(p.x - lastPos.x, p.y - lastPos.y) > (low ? 14 : 6) && puffs.length < (low ? 10 : 40)) {
            puffs.push({ x: p.x + (Math.random() - 0.5) * 10, y: p.y + (p.r || 14) * 0.6 + (Math.random() - 0.5) * 6, t: now, c: t.colors[puffs.length % t.colors.length] });
            lastPos = { x: p.x, y: p.y };
        } else if (!lastPos) lastPos = { x: p.x, y: p.y };
        const life = 0.75;
        ctx.save();
        for (let i = puffs.length - 1; i >= 0; i--) {
            const q = puffs[i], age = now - q.t;
            if (age > life) { puffs.splice(i, 1); continue; }
            const k = age / life;
            ctx.globalAlpha = 1 - k;
            ctx.fillStyle = q.c;
            ctx.beginPath();
            ctx.arc(q.x, q.y - k * t.rise, 2.5 + k * 4, 0, Math.PI * 2);
            ctx.fill();
        }
        ctx.restore();
    }
    // a halo (a golden ring bobbing over the head) or wings (beating faster while moving)
    function drawMark(ctx, p, id, now, low, moving) {
        const r = p.r || 14;
        ctx.save();
        if (id === 'mk_halo') {
            const y = p.y - r * 1.55 + Math.sin(now * 2.2) * 1.5;
            ctx.strokeStyle = '#ffe27a';
            ctx.lineWidth = 3;
            if (!low) { ctx.shadowColor = 'rgba(255, 214, 90, 0.9)'; ctx.shadowBlur = 8; }
            ctx.beginPath();
            ctx.ellipse(p.x, y, r * 0.62, r * 0.22, 0, 0, Math.PI * 2);
            ctx.stroke();
        } else if (id === 'mk_wings') {
            const flap = Math.sin(now * (moving ? 14 : 3)) * (moving ? 0.28 : 0.08);
            ctx.fillStyle = 'rgba(255, 255, 255, 0.92)';
            ctx.strokeStyle = 'rgba(170, 186, 220, 0.9)';
            ctx.lineWidth = 1.5;
            for (const side of [-1, 1]) {
                ctx.save();
                ctx.translate(p.x + side * r * 0.45, p.y - r * 0.15);
                ctx.rotate(side * (0.25 + flap));
                ctx.beginPath();
                ctx.moveTo(0, 0);
                ctx.quadraticCurveTo(side * r * 1.5, -r * 1.5, side * r * 1.9, -r * 0.35);
                ctx.quadraticCurveTo(side * r * 1.35, -r * 0.05, side * r * 1.5, r * 0.35);
                ctx.quadraticCurveTo(side * r * 0.8, r * 0.3, 0, r * 0.25);
                ctx.closePath();
                ctx.fill();
                ctx.stroke();
                ctx.restore();
            }
        }
        ctx.restore();
    }

    // ---------------- the chip ----------------
    // the chips show a short number (1.2K), the menu and the panel the whole one
    function short(n) {
        if (n < 1000) return String(n);
        if (n < 1e6) return (n < 1e4 ? (Math.floor(n / 100) / 10).toFixed(1) : String(Math.floor(n / 1000))) + 'K';
        return (Math.floor(n / 1e5) / 10).toFixed(1) + 'M';
    }
    function renderChip() {
        const n = total(), full = n.toLocaleString('en-US');
        for (const el of document.querySelectorAll('[data-bean-balance]')) el.textContent = full;
        for (const el of document.querySelectorAll('[data-bean-short]')) el.textContent = short(n);
        const chip = $('beanChip');
        if (chip) chip.title = full + ' ' + P.plural(n) + ': earned by playing or bought, for looks, gems and Golden';
    }
    // the animation starts again on the next frame: reading offsetWidth to restart it made the browser lay out the whole page
    // there and then (150 ms on a slow phone, in the middle of a fight in the Wilds)
    function bumpChip() {
        const chip = $('beanChip');
        if (!chip) return;
        chip.classList.remove('is-bump');
        requestAnimationFrame(() => requestAnimationFrame(() => chip.classList.add('is-bump')));
    }

    // ---------------- start ----------------
    function start() {
        if (start.done) return;
        start.done = true;
        applyLooks();
        renderChip();
        giveTitles();
        const chip = $('beanChip');
        if (chip) chip.addEventListener('click', () => { if (window.WHBeansPanel) window.WHBeansPanel.open(); });
        // a first check soon after the page settles, then every few seconds (the Wilds keep their save in memory)
        setTimeout(scan, 2500);
        setInterval(() => { if (document.visibilityState === 'visible') scan(); }, isWilds ? 5000 : 8000);
        window.addEventListener('storage', (e) => { if (!e.key || e.key === KEY) { shownLooks = ''; changed(); } });
    }
    window.WHBeans = { read, mutate, scan, buy, restore, equip, paid, total, canTrade, giveTitles, wearTitle, wornTitle, drawTrail, applyLooks, renderChip,
        onChange: (fn) => { listeners.add(fn); return () => listeners.delete(fn); }, isWilds };
    if (document.readyState === 'loading') {
        document.addEventListener('readystatechange', () => { if (document.readyState !== 'loading') start(); });
        document.addEventListener('DOMContentLoaded', start);
    } else start();
})();
