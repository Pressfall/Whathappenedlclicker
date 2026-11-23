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
 * - Looks: the theme and click-number style are classes on <body> (premium.css), and the click-number look's burst is
 *   clickFx (main.js spawnClickFloat calls it where you click); the Wilds trail is drawn by drawTrail,
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
        boostCache = null;
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

    // ---------------- codes (main.js redeemSecretCode, for a Settings > Codes code of type 'holy') ----------------
    // pays `n` earned Holy What Happeneds for `code`, once (core/premium.js grantCode keeps it as grant code:<CODE>, which syncs
    // with the account); resolves to { ok: true, n, name (the currency's, for n) } or { ok: false, reason: 'used' (already paid) |
    // 'bad' (no code or amount) }
    function grantCode(code, n, why) {
        return withLock(() => {
            const paid = mutate((s) => P.grantCode(s, code, n, Date.now(), why) || false);
            if (paid) { bumpChip(); return { ok: true, n: paid, name: P.plural(paid) }; }
            return { ok: false, reason: P.codeGrantId(code) && Math.floor(Number(n)) > 0 ? 'used' : 'bad' };
        });
    }

    // ---------------- buying ----------------
    // gems, Golden, timelapses and boosts live in the game's saves, so they can only be bought on the game page (main.js and
    // items.js are there). it: one item, or none for "can this page hand over gems, Golden and boosts at all".
    function canTrade(it) {
        const fn = (name) => typeof window[name] === 'function';
        const items = !!(window.WHI && typeof window.WHI.grantItems === 'function');
        if (!it) return fn('addGems') && fn('addGolden') && items;
        if (it.kind === 'bundle') return items;
        if (it.kind === 'gems') return fn('addGems');
        if (it.kind === 'golden') return fn('addGolden') && fn('getPotentialPrestigeAwards');
        if (it.kind === 'timelapse') return fn('addCpsSeconds');
        if (it.kind === 'buff') return true; // kept in this state, so either page
        return false;
    }
    // what the game makes per second now (main.js's cps without the Divine Combo Man combo, which lasts seconds; 0 off the game page)
    function cpsNow() {
        let c = 0;
        try { c = typeof window.cpsWithoutCombo === 'function' ? Number(window.cpsWithoutCombo()) : Number(typeof cps !== 'undefined' ? cps : 0); } catch (e) { c = 0; } // eslint-disable-line no-undef
        return Number.isFinite(c) && c > 0 ? c : 0;
    }
    // what one of a repeat item gives right now: { n, text } (n: gems, Golden or What Happeneds; text for the shop)
    function gives(it) {
        if (!it) return { n: 0, text: '' };
        if (it.kind === 'gems') return { n: it.gems, text: it.gems.toLocaleString('en-US') + ' gems' };
        if (it.kind === 'golden') {
            let next = 0;
            try { next = Number(window.getPotentialPrestigeAwards()) || 0; } catch (e) { next = 0; }
            const n = P.goldenFor(next);
            return { n, next, text: n.toLocaleString('en-US') + ' Golden What Happened' + (n === 1 ? '' : 's') };
        }
        if (it.kind === 'timelapse') {
            const n = cpsNow() * it.sec;
            let f = '';
            try { f = typeof window.formatNumber === 'function' ? window.formatNumber(n) : Math.floor(n).toLocaleString('en-US'); } catch (e) { f = String(Math.floor(n)); }
            return { n, text: f + ' What Happeneds' };
        }
        if (it.kind === 'buff') return { n: it.days, text: it.days + ' days of ' + buffText(it) };
        return { n: 0, text: it.name };
    }
    // what a buff does, in words: "2× click power", "+10% crit chance", "2× clicks, CPS and offline earnings"
    function buffText(it) {
        if (!it || it.kind !== 'buff') return '';
        if (it.buff === 'all') return P.BUFF_EFFECT.click.mult + '× clicks, CPS and offline earnings';
        if (it.buff === 'crit') return '+' + P.BUFF_EFFECT.crit.pp + '% crit chance';
        return P.BUFF_EFFECT[it.buff].mult + '× ' + ({ click: 'click power', cps: 'CPS', offline: 'offline earnings' })[it.buff];
    }
    // hand a repeat item over to the game (it is already paid for and saved); what: gives(it) worked out before paying
    function deliver(it, what) {
        try {
            if (it.kind === 'gems') window.addGems(it.gems);
            else if (it.kind === 'golden') window.addGolden(what.n);
            else if (it.kind === 'timelapse') {
                window.addCpsSeconds(it.sec);
                // the followers' timers move on as far: eggs in the nursery and the packs' cooldowns (followers-data.js)
                try { if (window.WHF && typeof window.WHF.skipTime === 'function') window.WHF.skipTime(it.sec * 1000); } catch (e) {}
            }
            else if (it.kind === 'buff') { /* nothing to hand over: completeExchange already set it running in this state */ }
            else if (it.items && !window.WHI.grantItems(it.items)) console.warn('Holy What Happeneds: the boosts could not be added', it.id);
        } catch (e) { console.warn('Holy What Happeneds: handing over', it.id, e); }
    }
    // Returns { ok, reason?: 'unknown' | 'owned' | 'game-only' | 'no-cps' | 'short' | 'signin' | 'rules' | 'network', short? }
    async function buy(id) {
        const it = P.BY_ID[id];
        const chk = P.canBuy(read(), id);
        if (!chk.ok) return chk;
        if (P.isRepeat(it) && !canTrade(it)) return { ok: false, reason: 'game-only' };
        // a timelapse pays the income the game makes now: nothing at all before the crew earns anything
        if (it.kind === 'timelapse' && !(cpsNow() > 0)) return { ok: false, reason: 'no-cps' };
        return withLock(async () => {
            const s = read();
            const again = P.canBuy(s, id); // another tab may have bought it meanwhile
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
                // what it gives is fixed now, before paying (the Golden follows the next prestige, a timelapse the income)
                const what = gives(it);
                // saved first, then handed over: the game page saves its own saves at once (addGems / addGolden / grantItems)
                let ok = mutate((st) => P.completeExchange(st, id, plan.fromEarned, Date.now(), spendId, what.text));
                // the account already paid its part: what this device still has of the earned part is taken, and it goes through
                if (!ok && spendId) ok = mutate((st) => P.completeExchange(st, id, Math.min(plan.fromEarned, st.earned), Date.now(), spendId, what.text));
                if (!ok) return { ok: false, reason: 'short' };
                deliver(it, what);
                try { if (typeof window.playSfx === 'function') window.playSfx('audio/purchase.wav'); } catch (e) {}
                return { ok: true, item: it, gave: what, fromEarned: plan.fromEarned, fromPaid: plan.fromPaid };
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
        const key = s.equip.theme + '|' + s.equip.pop + '|' + s.equip.aura + '|' + s.equip.hat + '|' + s.equip.accessory;
        if (key === shownLooks) return;
        shownLooks = key;
        for (const c of [...b.classList]) if (/^bn-(theme|pop|aura|acc)-/.test(c)) b.classList.remove(c);
        if (!isWilds && s.equip.theme) b.classList.add('bn-theme-' + s.equip.theme.replace(/^th_/, ''));
        if (s.equip.pop) b.classList.add('bn-pop-' + s.equip.pop.replace(/^pop_/, ''));
        wornPop = !isWilds && s.equip.pop ? s.equip.pop.replace(/^pop_/, '') : ''; // clickFx's burst
        if (!isWilds && s.equip.aura) b.classList.add('bn-aura-' + s.equip.aura.replace(/^au_/, ''));
        if (!isWilds) { showWorn('hat', s.equip.hat); showWorn('accessory', s.equip.accessory); }
    }
    // ---------------- clicker hats and accessories: worn by the What Happened you click ----------------
    // one hat and one accessory at a time, each its own picture in .main-image-btn (premium.css .bn-acc places them, the hat
    // over the accessory); ACCESSORY_SVG (the hats' too) is also the shop's preview
    function grapeBunch(cx, cy) {
        return [[0, 0], [11, 0], [5.5, 9], [-5.5, 9], [16.5, 9], [5.5, 18]].map(([dx, dy]) => '<circle cx="' + (cx + dx - 5.5) + '" cy="' + (cy + dy) + '" r="6" fill="#8a4fd6" stroke="#5a2a9a" stroke-width="1"/>').join('');
    }
    const ACCESSORY_SVG = {
        ht_crown: '<svg viewBox="0 0 100 64"><path d="M8 58 L4 16 L28 36 L50 6 L72 36 L96 16 L92 58 Z" fill="#ffd24d" stroke="#a8730f" stroke-width="3" stroke-linejoin="round"/><rect x="8" y="48" width="84" height="10" fill="#e8b832" stroke="#a8730f" stroke-width="3"/><circle cx="50" cy="38" r="6" fill="#e0302f"/><circle cx="26" cy="44" r="4" fill="#3dd6ff"/><circle cx="74" cy="44" r="4" fill="#3dd6ff"/><circle cx="4" cy="16" r="4" fill="#fff3c4"/><circle cx="50" cy="6" r="4" fill="#fff3c4"/><circle cx="96" cy="16" r="4" fill="#fff3c4"/></svg>',
        ac_shades: '<svg viewBox="0 0 120 40"><path d="M6 8 H54 V20 Q54 36 32 36 Q8 36 6 20 Z M66 8 H114 V20 Q112 36 88 36 Q66 36 66 20 Z" fill="#121216" stroke="#000" stroke-width="2"/><path d="M54 12 Q60 8 66 12" stroke="#121216" stroke-width="5" fill="none"/><path d="M12 13 L26 13 M72 13 L86 13" stroke="#5fb4ff" stroke-width="3" stroke-linecap="round" opacity=".8"/></svg>',
        ht_partyhat: '<svg viewBox="0 0 60 84"><path d="M30 8 L54 78 Q30 86 6 78 Z" fill="#ff6b8a" stroke="#c23a5a" stroke-width="2"/><path d="M22 32 L38 32 M16 50 L44 50 M11 66 L49 66" stroke="#ffd24d" stroke-width="5" stroke-linecap="round"/><circle cx="30" cy="8" r="7" fill="#ffd24d"/></svg>',
        ht_tophat: '<svg viewBox="0 0 100 80"><rect x="24" y="4" width="52" height="58" rx="4" fill="#222" stroke="#000" stroke-width="2"/><rect x="24" y="44" width="52" height="10" fill="#c0392b"/><ellipse cx="50" cy="66" rx="46" ry="10" fill="#222" stroke="#000" stroke-width="2"/></svg>',
        ht_horns: '<svg viewBox="0 0 160 70"><defs><linearGradient id="bnAccHorn" x1="0" y1="1" x2="0" y2="0"><stop offset="0" stop-color="#e0302f"/><stop offset="1" stop-color="#3a0507"/></linearGradient></defs><path d="M30 68 Q16 30 4 6 Q30 22 46 62 Z M130 68 Q144 30 156 6 Q130 22 114 62 Z" fill="url(#bnAccHorn)" stroke="#2a0508" stroke-width="2"/></svg>',
        ht_pirate: '<svg viewBox="0 0 120 60"><path d="M4 44 Q14 10 60 12 Q106 10 116 44 Q92 32 60 36 Q28 32 4 44 Z" fill="#1a1a1a" stroke="#c9a24a" stroke-width="3" stroke-linejoin="round"/><circle cx="60" cy="23" r="7.5" fill="#e8d9b0"/><rect x="56" y="28" width="8" height="5" rx="1" fill="#e8d9b0"/><circle cx="57.3" cy="22.5" r="2" fill="#1a1a1a"/><circle cx="62.7" cy="22.5" r="2" fill="#1a1a1a"/></svg>',
        ht_grapes: '<svg viewBox="0 0 140 64"><path d="M6 48 Q70 22 134 48" fill="none" stroke="#5a3a1a" stroke-width="5" stroke-linecap="round"/><path d="M22 40 q-14 -14 6 -20 q6 10 -6 20 Z M118 40 q14 -14 -6 -20 q-6 10 6 20 Z M66 30 q-8 -16 10 -18 q2 12 -10 18 Z" fill="#5fbf4a" stroke="#2f7a2a" stroke-width="1.5"/>' + grapeBunch(42, 34) + grapeBunch(96, 34) + grapeBunch(70, 22) + '</svg>',
        ht_bread: '<svg viewBox="0 0 120 70"><path d="M8 62 Q8 14 60 12 Q112 14 112 62 Z" fill="#d9a35a" stroke="#8a5a2a" stroke-width="3" stroke-linejoin="round"/><path d="M36 28 l-8 16 M62 22 l-8 16 M88 28 l-8 16" stroke="#a8702e" stroke-width="5" stroke-linecap="round"/><path d="M10 56 H110" stroke="#b07a3a" stroke-width="4"/></svg>',
        ac_eyepatch: '<svg viewBox="0 0 160 60"><path d="M2 12 L158 42" stroke="#111" stroke-width="4"/><path d="M40 14 Q72 10 76 30 Q68 52 46 48 Q28 42 40 14 Z" fill="#111" stroke="#000" stroke-width="2"/></svg>',
        ac_cane: '<svg viewBox="0 0 50 170"><rect x="21" y="42" width="8" height="124" rx="3" fill="#1a1a1a"/><rect x="19" y="150" width="12" height="16" rx="3" fill="#c9a24a"/><circle cx="25" cy="26" r="21" fill="#ffd24d" stroke="#a8730f" stroke-width="3"/><path d="M33 16 Q25 10 18 15 Q13 22 25 26 Q37 30 32 37 Q25 42 16 36 M25 8 V44" fill="none" stroke="#8a5a0f" stroke-width="4" stroke-linecap="round"/></svg>',
        ac_headphones: '<svg viewBox="0 0 160 110"><path d="M18 78 Q18 8 80 8 Q142 8 142 78" fill="none" stroke="#2b2b33" stroke-width="10" stroke-linecap="round"/><rect x="2" y="62" width="30" height="44" rx="12" fill="#2b2b33"/><rect x="128" y="62" width="30" height="44" rx="12" fill="#2b2b33"/><rect x="8" y="70" width="10" height="28" rx="5" fill="#3dfcff"/><rect x="142" y="70" width="10" height="28" rx="5" fill="#3dfcff"/></svg>',
        // Skippie Toilet's blue gaming headset: a boom mic from the left cup, a yellow note on the right
        ac_skippie: '<svg viewBox="0 0 160 124"><path d="M19 80 Q19 9 80 9 Q141 9 141 80" fill="none" stroke="#1f5f96" stroke-width="12" stroke-linecap="round"/><path d="M19 80 Q19 9 80 9 Q141 9 141 80" fill="none" stroke="#6cc4ff" stroke-width="4" stroke-linecap="round"/><path d="M22 100 Q30 120 56 114" fill="none" stroke="#1f2a36" stroke-width="5" stroke-linecap="round"/><rect x="52" y="107" width="18" height="13" rx="6.5" fill="#1f2a36"/><rect x="1" y="62" width="34" height="48" rx="14" fill="#4aa8e8" stroke="#1f5f96" stroke-width="3"/><rect x="125" y="62" width="34" height="48" rx="14" fill="#4aa8e8" stroke="#1f5f96" stroke-width="3"/><ellipse cx="18" cy="86" rx="8" ry="13" fill="#2b5f8a"/><ellipse cx="142" cy="86" rx="8" ry="13" fill="#2b5f8a"/><g fill="#ffd24d"><ellipse cx="139" cy="94" rx="4.6" ry="3.4" transform="rotate(-22 139 94)"/><rect x="142.3" y="76" width="2.2" height="18"/><path d="M144.5 76 q8 3 6 11 q-1.5 -5.5 -6 -6.5 z"/></g></svg>',
    };
    // slot: 'hat' or 'accessory'; id: what is worn there ('' for nothing)
    function showWorn(slot, id) {
        const btn = document.querySelector('.main-image-btn');
        if (!btn) return;
        let el = btn.querySelector('.bn-acc[data-slot="' + slot + '"]');
        const svg = ACCESSORY_SVG[id];
        if (!svg) { if (el) el.remove(); }
        else {
            if (!el) { el = document.createElement('span'); el.setAttribute('aria-hidden', 'true'); el.dataset.slot = slot; btn.appendChild(el); }
            el.className = 'bn-acc bn-acc--' + id.replace(/^(ac|ht)_/, '') + ' bn-acc-slot-' + slot;
            el.innerHTML = svg;
        }
        document.body.classList.toggle('bn-acc-on', !!btn.querySelector('.bn-acc'));
    }

    // ---------------- click bursts: where you click the What Happened, in the worn click-number look's colours ----------------
    // main.js spawnClickFloat calls clickFx(x, y, crit) for your own clicks (never the Auto Clicker's), under the "+N", whose
    // glow premium.css matches. Each look has its own pieces (premium.css .bn-cfx-<kind>): rings that open out, and bits that
    // fly, drift, rise or tumble to (dx, dy). Only transform and opacity animate. Performance Medium gets half the bits and one
    // ring, Low none (main.js shows no click numbers there either); reduced motion gets a soft glow that fades where you
    // clicked, with nothing moving. Nothing at all happens without a look worn. The shop plays the same bursts on its cards.
    let wornPop = '';
    // rings: how many (ring: their kind, gap: ms between them); bits: how many (bit: their kind, or kinds in turn), dist: how far
    // they go (px), arc: the spread they fly in (deg around straight up; 360 = all round), spin: their turn (deg either way),
    // ms: how long they fly, glyphs: text for bits of that kind
    const POP_FX = {
        feather: { rings: 1, ring: 'puff', bits: 5, bit: 'feather', dist: [30, 52], arc: 360, spin: 70, ms: [1150, 1500] },
        halo: { rings: 1, ring: 'halo', bits: 6, bit: 'spark', dist: [30, 54], arc: 360, spin: 120, ms: [520, 720] },
        choir: { rings: 3, ring: 'ripple', gap: 120, bits: 3, bit: 'note', dist: [50, 72], arc: 80, spin: 18, ms: [1000, 1300], glyphs: { note: ['♪', '♫', '♩', '♬'] } },
        phonk: { rings: 2, ring: 'thump', gap: 90, bits: 6, bit: 'shard', dist: [38, 66], arc: 360, spin: 160, ms: [380, 520] },
        money: { rings: 1, ring: 'flash', bits: 6, bit: ['bill', 'coin'], dist: [34, 58], arc: 150, spin: 300, ms: [850, 1100], glyphs: { bill: ['$'] } },
        hacker: { rings: 1, ring: 'lock', bits: 6, bit: 'digit', dist: [30, 60], arc: 360, spin: 0, ms: [560, 760], glyphs: { digit: ['0', '1'] } },
    };
    const RING_MS = 760; // the longest a ring takes (premium.css)
    const rnd = (a, b) => a + Math.random() * (b - a);
    // one burst's pieces, as HTML (only numbers and the glyphs above go in, so nothing needs escaping)
    // o: { crit (bigger, more bits), lite (Medium: fewer), still (reduced motion: one fading glow) }
    function popFxHtml(name, o) {
        const fx = POP_FX[name];
        if (!fx) return '';
        if (o.still) return '<i class="bn-cfx-still"></i>';
        const k = o.crit ? 1.45 : 1;
        let html = '';
        for (let i = 0, n = o.lite ? 1 : fx.rings; i < n; i++) html += '<i class="bn-cfx-ring bn-cfx-' + fx.ring + '" style="--d:' + i * (fx.gap || 110) + 'ms"></i>';
        const n = Math.max(2, Math.round(fx.bits * (o.crit ? 1.5 : 1) * (o.lite ? 0.5 : 1)));
        for (let i = 0; i < n; i++) {
            const deg = fx.arc >= 360 ? (i + rnd(0.15, 0.85)) / n * 360 : -fx.arc / 2 + fx.arc * (i + rnd(0.15, 0.85)) / n;
            const a = deg * Math.PI / 180, d = rnd(fx.dist[0], fx.dist[1]) * k;
            const kind = Array.isArray(fx.bit) ? fx.bit[i % fx.bit.length] : fx.bit;
            const g = fx.glyphs && fx.glyphs[kind];
            html += '<i class="bn-cfx-bit bn-cfx-' + kind + '" style="--dx:' + (Math.sin(a) * d).toFixed(1) + 'px;--dy:' + (-Math.cos(a) * d).toFixed(1) +
                'px;--r:' + Math.round(rnd(-fx.spin, fx.spin)) + 'deg;--t:' + Math.round(rnd(fx.ms[0], fx.ms[1])) + 'ms;--d:' + Math.round(rnd(0, 60)) + 'ms">' +
                (g ? g[Math.floor(Math.random() * g.length)] : '') + '</i>';
        }
        return html;
    }
    // how long a burst's pieces take, so it can go once they are done
    const popFxLife = (fx, still) => (still ? 700 : Math.max(fx.ms[1] + 60, ((fx.rings || 1) - 1) * (fx.gap || 110) + RING_MS) + 80);
    const reduceMotion = () => { try { return !!(window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches); } catch (e) { return false; } };
    // main.js keeps the Performance setting here (high, medium or low)
    const perfMode = () => { try { return localStorage.getItem('whathappened_performance') || 'high'; } catch (e) { return 'high'; } };
    let lastFx = 0;
    // a burst at (x, y) on the page; true if one was shown
    function clickFx(x, y, crit) {
        const fx = POP_FX[wornPop], b = document.body;
        if (!fx || !b || !isFinite(x) || !isFinite(y)) return false;
        const perf = perfMode();
        if (perf === 'low' || b.classList.contains('perf-low')) return false;
        const lite = perf === 'medium', now = Date.now();
        // a fast clicker gets one burst every 45 ms (70 on Medium; a crit always shows) and only so many on screen at once
        if (!crit && now - lastFx < (lite ? 70 : 45) && now >= lastFx) return false;
        lastFx = now;
        let layer = $('bnClickFx');
        if (!layer) { layer = document.createElement('div'); layer.id = 'bnClickFx'; layer.setAttribute('aria-hidden', 'true'); b.appendChild(layer); }
        while (layer.childElementCount >= (lite ? 4 : 8)) layer.firstElementChild.remove();
        const still = reduceMotion(), el = document.createElement('div');
        el.className = 'bn-cfx bn-cfx--' + wornPop + (crit ? ' is-crit' : '') + (still ? ' is-still' : '');
        el.style.left = Math.round(x) + 'px';
        el.style.top = Math.round(y) + 'px';
        el.innerHTML = popFxHtml(wornPop, { crit: !!crit, lite, still });
        layer.appendChild(el);
        setTimeout(() => el.remove(), popFxLife(fx, still));
        return true;
    }
    // the shop's card: plays the look's burst in the middle of `host` (again each time it's called, unless one is still going)
    function popPreview(host, id) {
        const name = String(id || '').replace(/^pop_/, ''), fx = POP_FX[name];
        if (!fx || !host || host.querySelector('.bn-cfx')) return false;
        const still = reduceMotion() || perfMode() === 'low', el = document.createElement('div');
        el.className = 'bn-cfx bn-cfx--' + name + (still ? ' is-still' : '');
        el.setAttribute('aria-hidden', 'true');
        el.innerHTML = popFxHtml(name, { still });
        host.insertBefore(el, host.firstChild);
        if (!still) setTimeout(() => el.remove(), popFxLife(fx, false)); // the still glow stays on the card
        return true;
    }

    // ---------------- the monthly buffs (main.js multiplies CPS and click power by boosts()) ----------------
    let boostCache = null;
    // { click, cps } multipliers now (1 for none), and until when; worked out at most once a second, and again on any change
    function boosts() {
        const now = Date.now();
        if (boostCache && now < boostCache.next) return boostCache.b;
        const b = P.buffMults(read(), now);
        b.offlineBuffMult = P.BUFF_EFFECT.offline.mult; // what the offline buff multiplies by while it runs
        let next = now + 1000;
        for (const k of P.BUFF_KEYS) if (b.until[k] > now) next = Math.min(next, b.until[k]);
        boostCache = { b, next };
        return b;
    }

    // ---------------- chat effects (index.html sends the worn one's id with each message, and shows anyone's) ----------------
    function chatFx() { const id = read().equip.chatfx; return id && P.BY_ID[id] && P.BY_ID[id].kind === 'chatfx' ? id : ''; }
    // the class for a message sent with effect `id`, or '' for none or an id this page doesn't know
    function chatFxClass(id) { return typeof id === 'string' && P.BY_ID[id] && P.BY_ID[id].kind === 'chatfx' ? 'bn-chatfx bn-chatfx-' + id.replace(/^cf_/, '') : ''; }

    // ---------------- the Wilds: looks drawn on a player ----------------
    // world-actors.js calls drawTrail (under) and drawOver (on top) for you, from your own state, and drawLooksOf /
    // drawLooksOver for each other player, from what their page shares (core/world-online.js packLooks). Under the body: the
    // trail, wings and tail; on top of it: the outfit, then headwear.
    const NO_LOOKS = { weapon: '', trail: '', head: '', back: '', tail: '', outfit: '' };
    let mine = NO_LOOKS, mineCheck = -1;
    function myWildsLooks() {
        const now = performance.now() / 1000;
        if (now - mineCheck > 1) { mineCheck = now; mine = P.wildsLooks(read()); }
        return mine;
    }
    const lookOf = (id, kind) => { const it = P.BY_ID[id]; return it && it.kind === kind ? it : null; };
    const perfLow = () => { const E = window.WHW && window.WHW.engine; return !!(E && E.perf === 'low'); };
    // each drawn player's trail bits, last position and heading; a WeakMap, so a player who leaves takes theirs along
    const tracks = new WeakMap();
    function track(p) {
        let tk = tracks.get(p);
        if (!tk) { tk = { puffs: [], last: null, moveT: 0, dir: Math.PI / 2 }; tracks.set(p, tk); }
        return tk;
    }
    function drawLooksOf(ctx, p, looks) {
        if (!p) return;
        const tk = track(p), l = looks || NO_LOOKS;
        const now = performance.now() / 1000, low = perfLow();
        if (tk.last) {
            const dx = p.x - tk.last.x, dy = p.y - tk.last.y;
            if (Math.hypot(dx, dy) > 1) { tk.moveT = now; tk.dir = Math.atan2(dy, dx); }
        }
        const moving = now - tk.moveT < 0.25;
        const tail = lookOf(l.tail, 'tail');
        if (tail) drawTail(ctx, p, tail.id, now, tk.dir, moving);
        const back = lookOf(l.back, 'back');
        if (back) { if (back.id === 'bk_cloak') drawCloak(ctx, p, now, tk.dir, moving); else drawWings(ctx, p, back.id, now, moving); }
        const t = lookOf(l.trail, 'trail');
        const puffs = tk.puffs;
        if (!t) { puffs.length = 0; tk.last = { x: p.x, y: p.y }; return; }
        if (tk.last && Math.hypot(p.x - tk.last.x, p.y - tk.last.y) > (low ? 14 : 6) && puffs.length < (low ? 10 : 40)) {
            puffs.push({ x: p.x + (Math.random() - 0.5) * 10, y: p.y + (p.r || 14) * 0.6 + (Math.random() - 0.5) * 6, t: now, c: t.colors[puffs.length % t.colors.length], rot: Math.random() * Math.PI * 2, v: Math.random() });
            tk.last = { x: p.x, y: p.y };
        } else if (!tk.last) tk.last = { x: p.x, y: p.y };
        const life = t.shape === 'smoke' ? 1.1 : t.shape === 'crystal' ? 1 : 0.75;
        ctx.save();
        for (let i = puffs.length - 1; i >= 0; i--) {
            const q = puffs[i], age = now - q.t;
            if (age > life) { puffs.splice(i, 1); continue; }
            const k = age / life;
            ctx.globalAlpha = t.shape === 'crystal' ? Math.min(1, (1 - k) * 1.6) : 1 - k;
            ctx.fillStyle = q.c;
            drawBit(ctx, t.shape, q.x, q.y - k * t.rise, k, q.rot + k * 2, q.v);
        }
        ctx.restore();
    }
    // one bit of a trail at its age k (0..1); v (0..1, fixed for the bit's life) picks between a shape's kinds of bit
    function drawBit(ctx, shape, x, y, k, rot, v) {
        const sz = 2.5 + k * 4;
        ctx.beginPath();
        if (shape === 'feather') { ctx.ellipse(x, y, sz * 1.5, sz * 0.55, rot, 0, Math.PI * 2); }
        else if (shape === 'spark') { const s = 3.2 - k * 1.5; ctx.moveTo(x, y - s * 1.6); ctx.lineTo(x + s, y); ctx.lineTo(x, y + s * 1.6); ctx.lineTo(x - s, y); }
        else if (shape === 'flame') { const s = 5 - k * 3; ctx.moveTo(x, y - s * 2.2); ctx.quadraticCurveTo(x + s * 1.2, y - s * 0.2, x, y + s); ctx.quadraticCurveTo(x - s * 1.2, y - s * 0.2, x, y - s * 2.2); }
        else if (shape === 'crystal') { const s = 3.5; ctx.moveTo(x, y - s * 1.9); ctx.lineTo(x + s * 0.8, y); ctx.lineTo(x, y + s * 1.9); ctx.lineTo(x - s * 0.8, y); ctx.closePath(); ctx.fill(); ctx.strokeStyle = 'rgba(255,255,255,0.8)'; ctx.lineWidth = 0.8; ctx.stroke(); return; }
        else if (shape === 'smoke') { ctx.arc(x, y, 3 + k * 7, 0, Math.PI * 2); }
        else if (shape === 'bill') {
            ctx.save(); ctx.translate(x, y); ctx.rotate(rot * 0.6); ctx.fillRect(-4.5, -2.6, 9, 5.2);
            ctx.fillStyle = 'rgba(20, 70, 30, 0.6)'; ctx.fillRect(-1.2, -1.6, 2.4, 3.2); ctx.restore(); return;
        }
        else if (shape === 'grape') { const g = 2.3; ctx.arc(x - g, y, g, 0, Math.PI * 2); ctx.arc(x + g, y, g, 0, Math.PI * 2); ctx.moveTo(x + g, y + g * 1.7); ctx.arc(x, y + g * 1.7, g, 0, Math.PI * 2); }
        else if (shape === 'bubble') {
            ctx.strokeStyle = ctx.fillStyle; ctx.lineWidth = 1.1; ctx.arc(x, y, 2 + k * 3.5, 0, Math.PI * 2); ctx.stroke();
            ctx.beginPath(); ctx.arc(x - 1, y - 1.2, 0.8, 0, Math.PI * 2); ctx.fill(); return;
        }
        else if (shape === 'tune') {
            // Toilet Tunes (Skippie Toilet): music notes, swaying as they rise, and now and then a pale blue bubble
            if (v > 0.7) {
                ctx.strokeStyle = 'rgba(170, 225, 255, 0.95)'; ctx.lineWidth = 1.1; ctx.arc(x, y, 2 + k * 3, 0, Math.PI * 2); ctx.stroke();
                ctx.fillStyle = 'rgba(235, 250, 255, 0.95)'; ctx.beginPath(); ctx.arc(x - 1, y - 1.1, 0.8, 0, Math.PI * 2); ctx.fill(); return;
            }
            ctx.save(); ctx.translate(x, y); ctx.rotate(Math.sin(rot * 2) * 0.35);
            ctx.ellipse(-1.6, 2.6, 2.3, 1.7, -0.35, 0, Math.PI * 2); ctx.fill();
            ctx.fillRect(0.3, -4.6, 1.2, 7.4);
            if (v > 0.3) { ctx.beginPath(); ctx.moveTo(1.5, -4.6); ctx.quadraticCurveTo(5, -3, 4, 0.2); ctx.quadraticCurveTo(3.6, -2, 1.5, -2.4); ctx.closePath(); ctx.fill(); }
            ctx.restore(); return;
        }
        else if (shape === 'pixel') { const q = 3; ctx.fillRect(Math.round(x) - q / 2, Math.round(y) - q / 2, q, q); if (rot % 2 > 1) ctx.fillRect(Math.round(x) - q / 2, Math.round(y) - q * 2, q, q); return; }
        else if (shape === 'leaf') {
            ctx.save(); ctx.translate(x, y); ctx.rotate(rot); ctx.moveTo(-4.5, 0); ctx.quadraticCurveTo(0, -3.2, 4.5, 0); ctx.quadraticCurveTo(0, 3.2, -4.5, 0); ctx.fill();
            ctx.strokeStyle = 'rgba(40, 80, 20, 0.6)'; ctx.lineWidth = 0.6; ctx.beginPath(); ctx.moveTo(-4, 0); ctx.lineTo(4, 0); ctx.stroke(); ctx.restore(); return;
        }
        else if (shape === 'star') {
            const s = 4 - k * 2.5;
            for (let i = 0; i < 8; i++) { const a = rot + i * Math.PI / 4, rr = i % 2 ? s * 0.35 : s * 1.2; ctx.lineTo(x + Math.cos(a) * rr, y + Math.sin(a) * rr); }
            ctx.closePath();
        } else ctx.arc(x, y, sz, 0, Math.PI * 2);
        ctx.fill();
    }
    // on top of the body, after the face and the armour's helm: the outfit, then headwear
    function drawLooksOver(ctx, p, looks) {
        if (!p) return;
        const l = looks || NO_LOOKS, now = performance.now() / 1000;
        const outfit = lookOf(l.outfit, 'outfit');
        if (outfit) drawOutfit(ctx, p, outfit.id, now);
        const head = lookOf(l.head, 'head');
        if (head) drawHead(ctx, p, head.id, now, perfLow());
    }
    // The shop's picture of a Wilds look (premium-panel.js), drawn by the same code as in the Wilds, on a plain head
    function drawPreview(ctx, id, w, h) {
        const it = P.BY_ID[id];
        if (!it) return;
        const r = Math.min(w, h) * 0.22, p = { x: w / 2, y: h / 2 + r * 0.3, r }, now = 0.45;
        const body = () => {
            ctx.fillStyle = '#3a4a66'; ctx.beginPath(); ctx.arc(p.x, p.y, r + 2, 0, Math.PI * 2); ctx.fill();
            const g = ctx.createRadialGradient(p.x - r * 0.3, p.y - r * 0.4, r * 0.2, p.x, p.y, r);
            g.addColorStop(0, '#f6e7c8'); g.addColorStop(1, '#d6bf93');
            ctx.fillStyle = g; ctx.beginPath(); ctx.arc(p.x, p.y - 1, r - 1, 0, Math.PI * 2); ctx.fill();
        };
        ctx.save();
        if (it.kind === 'trail') {
            p.x = w * 0.72;
            for (let i = 0; i < 7; i++) {
                const k = (7 - i) / 8;
                ctx.globalAlpha = 1 - k * 0.85;
                ctx.fillStyle = it.colors[i % it.colors.length];
                drawBit(ctx, it.shape, w * 0.12 + i * w * 0.075, p.y + r * 0.6 - k * it.rise * 0.6, k, i * 0.9, (i * 0.37) % 1);
            }
            ctx.globalAlpha = 1;
            body();
        } else if (it.kind === 'back') { if (id === 'bk_cloak') drawCloak(ctx, p, now, -Math.PI / 2, false); else drawWings(ctx, p, id, now, false); body(); }
        else if (it.kind === 'tail') { drawTail(ctx, p, id, now, -Math.PI * 0.72, false); body(); }
        else if (it.kind === 'head') { body(); drawHead(ctx, p, id, now, false); }
        else if (it.kind === 'outfit') { body(); drawOutfit(ctx, p, id, now); }
        ctx.restore();
    }
    function drawTrail(ctx, p) { drawLooksOf(ctx, p, myWildsLooks()); }
    function drawOver(ctx, p) { drawLooksOver(ctx, p, myWildsLooks()); }
    // a weapon skin's colours, glow and hit for world-actors.js drawWeapon / skinHitFx: yours (no id), or another player's shared one
    function weaponSkin(id) { return lookOf(id === undefined ? myWildsLooks().weapon : id, 'weapon'); }

    // wings (angel or demon), beating faster while moving
    function drawWings(ctx, p, id, now, moving) {
        const r = p.r || 14, flap = Math.sin(now * (moving ? 14 : 3)) * (moving ? 0.28 : 0.08), demon = id === 'bk_demon', voidw = id === 'bk_void', hyper = id === 'bk_hypergamy';
        ctx.save();
        ctx.fillStyle = demon ? 'rgba(90, 13, 18, 0.95)' : voidw ? 'rgba(42, 10, 74, 0.92)' : 'rgba(255, 255, 255, 0.92)';
        ctx.strokeStyle = demon ? 'rgba(224, 48, 47, 0.95)' : voidw ? 'rgba(180, 140, 255, 0.95)' : 'rgba(170, 186, 220, 0.9)';
        ctx.lineWidth = 1.5;
        for (const side of [-1, 1]) {
            ctx.save();
            ctx.translate(p.x + side * r * 0.45, p.y - r * 0.15);
            ctx.rotate(side * (0.25 + flap));
            ctx.beginPath();
            ctx.moveTo(0, 0);
            if (demon) {
                // a bat's wing: three bony points, scalloped between them
                ctx.lineTo(side * r * 1.2, -r * 1.55);
                ctx.lineTo(side * r * 2.0, -r * 0.6);
                ctx.quadraticCurveTo(side * r * 1.55, -r * 0.35, side * r * 1.65, r * 0.05);
                ctx.quadraticCurveTo(side * r * 1.15, -r * 0.05, side * r * 1.15, r * 0.35);
                ctx.quadraticCurveTo(side * r * 0.65, r * 0.15, 0, r * 0.25);
            } else {
                ctx.quadraticCurveTo(side * r * 1.5, -r * 1.5, side * r * 1.9, -r * 0.35);
                ctx.quadraticCurveTo(side * r * 1.35, -r * 0.05, side * r * 1.5, r * 0.35);
                ctx.quadraticCurveTo(side * r * 0.8, r * 0.3, 0, r * 0.25);
            }
            ctx.closePath();
            if (hyper) { ctx.fillStyle = 'rgba(255, 255, 255, 0.95)'; ctx.strokeStyle = side < 0 ? '#d23a4a' : '#2fb2e0'; }
            ctx.fill();
            ctx.stroke();
            if (hyper) {
                // Hypergomus Wings (Hypergamy): the diagram drawn inside each wing, between a row of points near the body and
                // one out along the wing: the red criss-cross (each to its neighbours) on one, the blue fan (all to the top two) on the other
                ctx.save();
                ctx.clip();
                ctx.lineWidth = Math.max(0.6, r * 0.055);
                ctx.globalAlpha = 0.9;
                const inner = [], outer = [];
                for (let i = 0; i < 5; i++) { const y = -r * 1.05 + i * r * 0.32; inner.push([side * r * 0.35, y + r * 0.1]); outer.push([side * r * (1.75 - i * 0.07), y - r * 0.05]); }
                ctx.beginPath();
                for (let i = 0; i < 5; i++) {
                    const targets = side < 0 ? [i - 1, i, i + 1] : [0, 1];
                    for (const j of targets) {
                        if (j < 0 || j > 4) continue;
                        const a = side < 0 ? inner[i] : outer[i], b = side < 0 ? outer[j] : inner[j];
                        ctx.moveTo(a[0], a[1]); ctx.lineTo(b[0], b[1]);
                    }
                }
                ctx.stroke();
                ctx.restore();
            }
            ctx.restore();
        }
        ctx.restore();
    }
    // a cloak from the shoulders, sweeping out behind (away from where they are heading), dark with a crimson lining
    function drawCloak(ctx, p, now, dir, moving) {
        const r = p.r || 14, back = dir + Math.PI, side = dir + Math.PI / 2, sway = Math.sin(now * (moving ? 8 : 2)) * (moving ? 0.22 : 0.08);
        const len = r * (moving ? 1.75 : 1.4), spread = r * 1.25;
        const sx = Math.cos(side), sy = Math.sin(side), bx = Math.cos(back + sway), by = Math.sin(back + sway);
        const l1x = p.x + sx * r * 0.8, l1y = p.y + sy * r * 0.8, r1x = p.x - sx * r * 0.8, r1y = p.y - sy * r * 0.8;
        const l2x = p.x + bx * len + sx * spread, l2y = p.y + by * len + sy * spread, r2x = p.x + bx * len - sx * spread, r2y = p.y + by * len - sy * spread;
        ctx.save();
        ctx.fillStyle = '#1a1424'; ctx.strokeStyle = '#d01030'; ctx.lineWidth = 1.6; ctx.lineJoin = 'round';
        ctx.beginPath(); ctx.moveTo(l1x, l1y);
        ctx.quadraticCurveTo(p.x + bx * len * 0.5 + sx * spread * 1.1, p.y + by * len * 0.5 + sy * spread * 1.1, l2x, l2y);
        ctx.quadraticCurveTo(p.x + bx * len * 1.15, p.y + by * len * 1.15, r2x, r2y);
        ctx.quadraticCurveTo(p.x + bx * len * 0.5 - sx * spread * 1.1, p.y + by * len * 0.5 - sy * spread * 1.1, r1x, r1y);
        ctx.closePath(); ctx.fill(); ctx.stroke();
        ctx.restore();
    }
    // a tail, from behind (away from where they are heading), swishing
    function drawTail(ctx, p, id, now, dir, moving) {
        const r = p.r || 14, back = dir + Math.PI, sw = Math.sin(now * (moving ? 9 : 2.5)) * 0.45;
        const bx = p.x + Math.cos(back) * r * 0.7, by = p.y + Math.sin(back) * r * 0.7;
        const mx = bx + Math.cos(back + sw) * r * 0.9, my = by + Math.sin(back + sw) * r * 0.9;
        const ex = bx + Math.cos(back - sw * 0.8) * r * 1.8, ey = by + Math.sin(back - sw * 0.8) * r * 1.8;
        ctx.save();
        ctx.lineCap = 'round';
        if (id === 'ta_argonian') {
            const N = 10;
            let px = bx, py = by;
            for (let i = 1; i <= N; i++) {
                const t = i / N, u = 1 - t;
                const qx = u * u * bx + 2 * u * t * mx + t * t * ex, qy = u * u * by + 2 * u * t * my + t * t * ey;
                ctx.strokeStyle = i % 2 ? '#6fa86a' : '#4f8a4a'; ctx.lineWidth = Math.max(1.5, r * 0.6 * (1 - t * 0.85));
                ctx.beginPath(); ctx.moveTo(px, py); ctx.lineTo(qx, qy); ctx.stroke();
                px = qx; py = qy;
            }
        } else if (id === 'ta_fox') {
            ctx.strokeStyle = '#ff9a3d'; ctx.lineWidth = r * 0.55;
            ctx.beginPath(); ctx.moveTo(bx, by); ctx.quadraticCurveTo(mx, my, ex, ey); ctx.stroke();
            ctx.fillStyle = '#ffffff'; ctx.beginPath(); ctx.arc(ex, ey, r * 0.3, 0, Math.PI * 2); ctx.fill();
        } else {
            ctx.strokeStyle = '#c0392b'; ctx.lineWidth = 2.5;
            ctx.beginPath(); ctx.moveTo(bx, by); ctx.quadraticCurveTo(mx, my, ex, ey); ctx.stroke();
            // the spade at its end
            const a = Math.atan2(ey - my, ex - mx), s = r * 0.32;
            ctx.translate(ex, ey); ctx.rotate(a);
            ctx.fillStyle = '#2a0508'; ctx.strokeStyle = '#e0302f'; ctx.lineWidth = 1;
            ctx.beginPath(); ctx.moveTo(s * 1.4, 0); ctx.lineTo(-s * 0.2, -s); ctx.quadraticCurveTo(s * 0.2, 0, -s * 0.2, s); ctx.closePath(); ctx.fill(); ctx.stroke();
        }
        ctx.restore();
    }
    // headwear over the face
    function drawHead(ctx, p, id, now, low) {
        const r = p.r || 14, x = p.x, y = p.y;
        ctx.save();
        ctx.lineJoin = 'round';
        if (id === 'hd_halo') {
            const hy = y - r * 1.55 + Math.sin(now * 2.2) * 1.5;
            ctx.strokeStyle = '#ffe27a'; ctx.lineWidth = 3;
            if (!low) { ctx.shadowColor = 'rgba(255, 214, 90, 0.9)'; ctx.shadowBlur = 8; }
            ctx.beginPath(); ctx.ellipse(x, hy, r * 0.62, r * 0.22, 0, 0, Math.PI * 2); ctx.stroke();
        } else if (id === 'hd_horns') {
            for (const side of [-1, 1]) {
                ctx.beginPath();
                ctx.moveTo(x + side * r * 0.35, y - r * 0.82);
                ctx.quadraticCurveTo(x + side * r * 0.75, y - r * 1.25, x + side * r * 1.05, y - r * 1.6);
                ctx.quadraticCurveTo(x + side * r * 0.9, y - r * 1.05, x + side * r * 0.72, y - r * 0.62);
                ctx.closePath();
                const g = ctx.createLinearGradient(x, y - r * 0.6, x + side * r, y - r * 1.6);
                g.addColorStop(0, '#d23a2c'); g.addColorStop(1, '#2a0508');
                ctx.fillStyle = g; ctx.fill();
                ctx.strokeStyle = 'rgba(20, 0, 2, 0.8)'; ctx.lineWidth = 1; ctx.stroke();
            }
        } else if (id === 'hd_magehat') {
            ctx.fillStyle = '#4a33b8'; ctx.strokeStyle = '#241866'; ctx.lineWidth = 1.2;
            ctx.beginPath(); ctx.ellipse(x, y - r * 0.68, r * 1.05, r * 0.3, 0, 0, Math.PI * 2); ctx.fill(); ctx.stroke();
            ctx.beginPath(); ctx.moveTo(x - r * 0.62, y - r * 0.72);
            ctx.quadraticCurveTo(x - r * 0.1, y - r * 1.6, x + r * 0.55, y - r * 2.35);
            ctx.quadraticCurveTo(x + r * 0.2, y - r * 1.5, x + r * 0.62, y - r * 0.72); ctx.closePath(); ctx.fill(); ctx.stroke();
            ctx.fillStyle = '#ffd24d'; ctx.fillRect(x - r * 0.6, y - r * 0.92, r * 1.2, r * 0.16);
            star(ctx, x + r * 0.05, y - r * 1.32, r * 0.22, '#ffd24d');
        } else if (id === 'hd_warhelm') {
            const g = ctx.createLinearGradient(x, y - r, x, y);
            g.addColorStop(0, '#e6edf3'); g.addColorStop(1, '#8a96a3');
            ctx.fillStyle = g; ctx.strokeStyle = '#4b5560'; ctx.lineWidth = 1.2;
            ctx.beginPath(); ctx.arc(x, y - r * 0.05, r * 1.02, Math.PI, Math.PI * 2); ctx.lineTo(x + r * 1.02, y + r * 0.05); ctx.lineTo(x - r * 1.02, y + r * 0.05); ctx.closePath(); ctx.fill(); ctx.stroke();
            ctx.fillStyle = '#6f7a86'; ctx.fillRect(x - r * 1.04, y - r * 0.12, r * 2.08, r * 0.2);
            ctx.fillStyle = '#9aa5b1'; ctx.fillRect(x - r * 0.09, y - r * 0.1, r * 0.18, r * 0.62); // the nose guard
            ctx.strokeStyle = '#c0392b'; ctx.lineWidth = r * 0.28; ctx.lineCap = 'round';
            ctx.beginPath(); ctx.moveTo(x, y - r * 1.02); ctx.quadraticCurveTo(x - r * 0.2, y - r * 1.6, x - r * 0.9, y - r * 1.5); ctx.stroke(); // the plume
        } else if (id === 'hd_pirate') {
            ctx.fillStyle = '#1a1a1a'; ctx.strokeStyle = '#c9a24a'; ctx.lineWidth = 1.4;
            ctx.beginPath(); ctx.moveTo(x - r * 1.2, y - r * 0.55);
            ctx.quadraticCurveTo(x - r * 0.9, y - r * 1.5, x, y - r * 1.4); ctx.quadraticCurveTo(x + r * 0.9, y - r * 1.5, x + r * 1.2, y - r * 0.55);
            ctx.quadraticCurveTo(x, y - r * 0.95, x - r * 1.2, y - r * 0.55); ctx.closePath(); ctx.fill(); ctx.stroke();
            ctx.fillStyle = '#e8d9b0'; ctx.beginPath(); ctx.arc(x, y - r * 1.08, r * 0.17, 0, Math.PI * 2); ctx.fill();
            ctx.fillStyle = '#1a1a1a'; ctx.beginPath(); ctx.arc(x - r * 0.06, y - r * 1.1, r * 0.045, 0, Math.PI * 2); ctx.arc(x + r * 0.06, y - r * 1.1, r * 0.045, 0, Math.PI * 2); ctx.fill();
        } else if (id === 'hd_grapes') {
            ctx.strokeStyle = '#5a3a1a'; ctx.lineWidth = r * 0.16;
            ctx.beginPath(); ctx.arc(x, y - r * 0.1, r * 0.95, Math.PI * 1.08, Math.PI * 1.92); ctx.stroke();
            ctx.fillStyle = '#5fbf4a';
            for (const a of [1.12, 1.5, 1.88]) { const lx = x + Math.cos(a * Math.PI) * r * 0.98, ly = y - r * 0.1 + Math.sin(a * Math.PI) * r * 0.98; ctx.beginPath(); ctx.ellipse(lx, ly - r * 0.12, r * 0.28, r * 0.15, a * Math.PI, 0, Math.PI * 2); ctx.fill(); }
            ctx.fillStyle = '#8a4fd6';
            for (const a of [1.25, 1.75]) {
                const gx = x + Math.cos(a * Math.PI) * r * 0.95, gy = y - r * 0.1 + Math.sin(a * Math.PI) * r * 0.95;
                for (const [dx, dy] of [[-0.12, 0], [0.12, 0], [0, 0.2], [-0.12, 0.2], [0.12, 0.2], [0, 0.4]]) { ctx.beginPath(); ctx.arc(gx + dx * r, gy + dy * r, r * 0.11, 0, Math.PI * 2); ctx.fill(); }
            }
        } else if (id === 'hd_tribal') {
            const cols = ['#e0302f', '#ffd24d', '#2f8fd6', '#5fbf4a', '#ffd24d', '#e0302f', '#2f8fd6'];
            for (let i = 0; i < 7; i++) {
                const a = Math.PI * (1.18 + i * 0.107), fx = x + Math.cos(a) * r * 0.7, fy = y - r * 0.1 + Math.sin(a) * r * 0.7;
                ctx.save(); ctx.translate(fx, fy); ctx.rotate(a + Math.PI / 2);
                ctx.fillStyle = cols[i]; ctx.beginPath(); ctx.ellipse(0, -r * 0.55, r * 0.17, r * 0.6, 0, 0, Math.PI * 2); ctx.fill();
                ctx.fillStyle = '#ffffff'; ctx.beginPath(); ctx.ellipse(0, -r * 1.02, r * 0.1, r * 0.16, 0, 0, Math.PI * 2); ctx.fill();
                ctx.restore();
            }
            ctx.fillStyle = '#7a4a22'; ctx.fillRect(x - r * 0.95, y - r * 0.72, r * 1.9, r * 0.24);
            ctx.fillStyle = '#ffd24d'; for (const dx of [-0.6, -0.2, 0.2, 0.6]) { ctx.beginPath(); ctx.arc(x + dx * r, y - r * 0.6, r * 0.06, 0, Math.PI * 2); ctx.fill(); }
        } else if (id === 'hd_bread') {
            ctx.fillStyle = '#d9a35a'; ctx.strokeStyle = '#8a5a2a'; ctx.lineWidth = 1.2;
            ctx.beginPath(); ctx.moveTo(x - r * 0.85, y - r * 0.62); ctx.quadraticCurveTo(x - r * 0.85, y - r * 1.5, x, y - r * 1.5);
            ctx.quadraticCurveTo(x + r * 0.85, y - r * 1.5, x + r * 0.85, y - r * 0.62); ctx.closePath(); ctx.fill(); ctx.stroke();
            ctx.strokeStyle = '#a8702e'; ctx.lineWidth = r * 0.1; ctx.lineCap = 'round';
            for (const dx of [-0.38, 0, 0.38]) { ctx.beginPath(); ctx.moveTo(x + dx * r + r * 0.12, y - r * 1.3); ctx.lineTo(x + dx * r - r * 0.12, y - r * 0.95); ctx.stroke(); }
        } else if (id === 'hd_crown') {
            const by = y - r * 0.82, w = r * 0.85;
            ctx.fillStyle = '#ffd24d'; ctx.strokeStyle = '#a8730f'; ctx.lineWidth = 1;
            ctx.beginPath(); ctx.moveTo(x - w, by); ctx.lineTo(x - w, by - r * 0.5); ctx.lineTo(x - w * 0.5, by - r * 0.22); ctx.lineTo(x, by - r * 0.72);
            ctx.lineTo(x + w * 0.5, by - r * 0.22); ctx.lineTo(x + w, by - r * 0.5); ctx.lineTo(x + w, by); ctx.closePath(); ctx.fill(); ctx.stroke();
            ctx.fillStyle = '#e0302f';
            for (const dx of [-0.5, 0, 0.5]) { ctx.beginPath(); ctx.arc(x + w * dx, by - r * 0.12, r * 0.09, 0, Math.PI * 2); ctx.fill(); }
        }
        ctx.restore();
    }
    function star(ctx, x, y, s, color) {
        ctx.fillStyle = color;
        ctx.beginPath();
        for (let i = 0; i < 10; i++) { const a = -Math.PI / 2 + i * Math.PI / 5, rr = i % 2 ? s * 0.45 : s; ctx.lineTo(x + Math.cos(a) * rr, y + Math.sin(a) * rr); }
        ctx.closePath(); ctx.fill();
    }
    // an outfit: over the armour's ring, around the face
    function drawOutfit(ctx, p, id, now) {
        const r = p.r || 14, x = p.x, y = p.y;
        ctx.save();
        if (id === 'of_easton') {
            // the brown jacket, open over a grey tee, the pendant on its cord, black glasses and messy brown hair
            ctx.strokeStyle = '#6b4226'; ctx.lineWidth = 4.5;
            ctx.beginPath(); ctx.arc(x, y, r + 0.5, 0, Math.PI * 2); ctx.stroke();
            ctx.fillStyle = '#9aa0a6';
            ctx.beginPath(); ctx.moveTo(x - r * 0.55, y + r * 0.82); ctx.quadraticCurveTo(x, y + r * 0.45, x + r * 0.55, y + r * 0.82); ctx.arc(x, y, r - 0.5, 0.33 * Math.PI, 0.67 * Math.PI); ctx.closePath(); ctx.fill();
            ctx.strokeStyle = '#3a2a1a'; ctx.lineWidth = 0.8;
            ctx.beginPath(); ctx.moveTo(x - r * 0.42, y + r * 0.42); ctx.quadraticCurveTo(x, y + r * 0.82, x + r * 0.42, y + r * 0.42); ctx.stroke();
            ctx.fillStyle = '#d9b44a'; ctx.fillRect(x - r * 0.08, y + r * 0.6, r * 0.16, r * 0.2);
            ctx.strokeStyle = '#111'; ctx.lineWidth = 1.6; ctx.lineJoin = 'round';
            const gy = y - r * 0.12, gw = r * 0.46, gh = r * 0.3;
            ctx.strokeRect(x - r * 0.08 - gw, gy - gh / 2, gw, gh);
            ctx.strokeRect(x + r * 0.08, gy - gh / 2, gw, gh);
            ctx.beginPath(); ctx.moveTo(x - r * 0.08, gy - gh * 0.2); ctx.lineTo(x + r * 0.08, gy - gh * 0.2); ctx.stroke();
            ctx.fillStyle = '#4a2e1a';
            for (let i = 0; i < 9; i++) {
                const a = Math.PI * (1.08 + i * 0.105), rr = r * (0.92 + (i % 2) * 0.12);
                ctx.beginPath(); ctx.ellipse(x + Math.cos(a) * rr * 0.92, y + Math.sin(a) * rr * 0.92, r * 0.26, r * 0.17, a + 0.6, 0, Math.PI * 2); ctx.fill();
            }
        } else if (id === 'of_hitman') {
            // a shaggy white fur coat all round, and the long white beak over the face
            ctx.lineCap = 'round';
            for (let i = 0; i < 30; i++) {
                const a = i * Math.PI * 2 / 30 + Math.sin(i * 7.3) * 0.08, l = r + 2.2 + (i % 3) * 1.1;
                ctx.strokeStyle = i % 2 ? '#f0f2f5' : '#c9d0d8'; ctx.lineWidth = 2.4;
                ctx.beginPath(); ctx.moveTo(x + Math.cos(a) * (r - 1.5), y + Math.sin(a) * (r - 1.5)); ctx.lineTo(x + Math.cos(a + 0.12) * l, y + Math.sin(a + 0.12) * l); ctx.stroke();
            }
            ctx.fillStyle = '#f4f6f8'; ctx.strokeStyle = '#9aa5b1'; ctx.lineWidth = 1;
            ctx.beginPath(); ctx.moveTo(x - r * 0.2, y - r * 0.32); ctx.quadraticCurveTo(x, y - r * 0.5, x + r * 0.2, y - r * 0.32);
            ctx.quadraticCurveTo(x + r * 0.1, y + r * 0.3, x, y + r * 0.88); ctx.quadraticCurveTo(x - r * 0.1, y + r * 0.3, x - r * 0.2, y - r * 0.32); ctx.closePath(); ctx.fill(); ctx.stroke();
            ctx.fillStyle = '#2a2f36';
            for (const sx of [-1, 1]) { ctx.beginPath(); ctx.ellipse(x + sx * r * 0.34, y - r * 0.38, r * 0.11, r * 0.05, sx * 0.3, 0, Math.PI * 2); ctx.fill(); }
        } else if (id === 'of_moneyman') {
            // a black suit, white shirt, red tie, a gold dollar pin and black shades
            ctx.strokeStyle = '#1a1a1a'; ctx.lineWidth = 4.5;
            ctx.beginPath(); ctx.arc(x, y, r + 0.5, 0, Math.PI * 2); ctx.stroke();
            ctx.fillStyle = '#f4f4f4';
            ctx.beginPath(); ctx.moveTo(x - r * 0.45, y + r * 0.86); ctx.lineTo(x, y + r * 0.42); ctx.lineTo(x + r * 0.45, y + r * 0.86); ctx.arc(x, y, r - 0.5, 0.36 * Math.PI, 0.64 * Math.PI); ctx.closePath(); ctx.fill();
            ctx.fillStyle = '#c0392b';
            ctx.beginPath(); ctx.moveTo(x, y + r * 0.48); ctx.lineTo(x + r * 0.11, y + r * 0.68); ctx.lineTo(x, y + r * 0.98); ctx.lineTo(x - r * 0.11, y + r * 0.68); ctx.closePath(); ctx.fill();
            ctx.fillStyle = '#ffd24d'; ctx.beginPath(); ctx.arc(x - r * 0.62, y + r * 0.62, r * 0.12, 0, Math.PI * 2); ctx.fill();
            ctx.fillStyle = '#0d0d10';
            for (const sx of [-1, 1]) { ctx.beginPath(); ctx.ellipse(x + sx * r * 0.33, y - r * 0.12, r * 0.27, r * 0.17, 0, 0, Math.PI * 2); ctx.fill(); }
            ctx.strokeStyle = '#0d0d10'; ctx.lineWidth = 1.4; ctx.beginPath(); ctx.moveTo(x - r * 0.08, y - r * 0.18); ctx.lineTo(x + r * 0.08, y - r * 0.18); ctx.stroke();
        } else if (id === 'of_skippie') {
            // Skippie Toilet: the blue lid standing up behind the head (clipped to outside it), a white porcelain bowl all round
            // with the blue seat, Skippie's blue headset with its boom mic, and red boots
            ctx.save();
            ctx.beginPath(); ctx.rect(x - r * 3, y - r * 3, r * 6, r * 6); ctx.arc(x, y, r + 2, 0, Math.PI * 2, true); ctx.clip();
            ctx.fillStyle = '#4aa8e8'; ctx.strokeStyle = '#1f5f96'; ctx.lineWidth = 1.4;
            ctx.beginPath(); ctx.ellipse(x, y - r * 0.75, r * 0.95, r * 1.15, 0, 0, Math.PI * 2); ctx.fill(); ctx.stroke();
            ctx.strokeStyle = '#8fd3ff'; ctx.lineWidth = 1.2;
            ctx.beginPath(); ctx.ellipse(x, y - r * 0.75, r * 0.72, r * 0.9, 0, Math.PI * 1.1, Math.PI * 1.9); ctx.stroke();
            ctx.restore();
            ctx.strokeStyle = '#9fb0bf'; ctx.lineWidth = 1;
            ctx.beginPath(); ctx.arc(x, y, r + 3.6, 0, Math.PI * 2); ctx.stroke();
            ctx.strokeStyle = '#f4f8fb'; ctx.lineWidth = 4.5;
            ctx.beginPath(); ctx.arc(x, y, r + 1.2, 0, Math.PI * 2); ctx.stroke();
            ctx.strokeStyle = '#4aa8e8'; ctx.lineWidth = 2;
            ctx.beginPath(); ctx.arc(x, y, r - 0.8, 0, Math.PI * 2); ctx.stroke();
            ctx.lineCap = 'round';
            ctx.strokeStyle = '#1f5f96'; ctx.lineWidth = r * 0.2;
            ctx.beginPath(); ctx.arc(x, y, r * 0.9, Math.PI * 1.15, Math.PI * 1.85); ctx.stroke();
            ctx.strokeStyle = '#6cc4ff'; ctx.lineWidth = r * 0.07;
            ctx.beginPath(); ctx.arc(x, y, r * 0.9, Math.PI * 1.2, Math.PI * 1.8); ctx.stroke();
            ctx.strokeStyle = '#1f2a36'; ctx.lineWidth = r * 0.09;
            ctx.beginPath(); ctx.moveTo(x - r * 0.85, y + r * 0.2); ctx.quadraticCurveTo(x - r * 0.75, y + r * 0.6, x - r * 0.3, y + r * 0.52); ctx.stroke();
            ctx.fillStyle = '#1f2a36'; ctx.beginPath(); ctx.arc(x - r * 0.26, y + r * 0.52, r * 0.11, 0, Math.PI * 2); ctx.fill();
            ctx.fillStyle = '#4aa8e8'; ctx.strokeStyle = '#1f5f96'; ctx.lineWidth = 1;
            for (const sx of [-1, 1]) { ctx.beginPath(); ctx.ellipse(x + sx * r * 0.88, y - r * 0.05, r * 0.2, r * 0.3, 0, 0, Math.PI * 2); ctx.fill(); ctx.stroke(); }
            ctx.fillStyle = '#e0302f'; ctx.strokeStyle = '#7a1414';
            for (const sx of [-1, 1]) { ctx.beginPath(); ctx.ellipse(x + sx * r * 0.5, y + r + 2.6, r * 0.27, r * 0.17, 0, 0, Math.PI * 2); ctx.fill(); ctx.stroke(); }
        } else if (id === 'of_mage') {
            ctx.strokeStyle = '#3b2a8a'; ctx.lineWidth = 4.5;
            ctx.beginPath(); ctx.arc(x, y, r + 0.5, 0, Math.PI * 2); ctx.stroke();
            for (let i = 0; i < 6; i++) { const a = now * 0.6 + i * Math.PI / 3; star(ctx, x + Math.cos(a) * (r + 0.5), y + Math.sin(a) * (r + 0.5), 1.8, '#ffd24d'); }
            ctx.fillStyle = '#ffd24d'; ctx.beginPath(); ctx.arc(x, y + r + 0.5, 2.2, 0, Math.PI * 2); ctx.fill();
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
    window.WHBeans = { read, mutate, scan, grantCode, buy, restore, equip, paid, total, canTrade, gives, buffText, cpsNow, boosts, chatFx, chatFxClass, ACCESSORY_SVG, clickFx, popPreview, POP_FX, giveTitles, wearTitle, wornTitle, drawTrail, drawOver, drawLooksOf, drawLooksOver, drawPreview, weaponSkin, myWildsLooks, applyLooks, renderChip,
        onChange: (fn) => { listeners.add(fn); return () => listeners.delete(fn); }, isWilds };
    if (document.readyState === 'loading') {
        document.addEventListener('readystatechange', () => { if (document.readyState !== 'loading') start(); });
        document.addEventListener('DOMContentLoaded', start);
    } else start();
})();
