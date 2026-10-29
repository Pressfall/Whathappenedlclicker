/**
 * The Wilds: the DOM side. HUD (health, stamina, rubies, hotbar, swing meter, boss bar, prompts, toasts) and the
 * modals: bag and gear, the crafting stations, the trader, travel, help, settings and the knocked-out screen.
 * Buttons call WHW.actions (world.js), which change the save and then ask for a redraw.
 */
(function () {
    'use strict';
    const D = window.WHWorldData, W = window.WHWorld, Bridge = window.WHWorldBridge, Gods = window.WHWorldGods;
    const WHW = window.WHW;
    const E = WHW.engine;
    const $ = (id) => document.getElementById(id);
    const esc = (s) => String(s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', '\'': '&#39;' })[c]);
    const fmt = (n) => Math.floor(Number(n) || 0).toLocaleString();
    const game = () => WHW.game;
    const ICONS = { sword: '🗡️', axe: '🪓', pickaxe: '⛏️', dagger: '🔪', spear: '🔱', bow: '🏹', helmet: '⛑️', chest: '🦺', boots: '🥾', ring: '💍', shield: '🛡️', offhand: '🛡️' };
    const STATION_TABS = { forge: ['craft', 'basic', 'reforge'], workbench: ['craft', 'basic', 'reforge'], altar: ['boxes', 'craft', 'basic', 'reforge'] };

    // ---------------- modal ----------------
    let modalClose = null, modalRender = null;
    function modal(title, html, opts = {}) {
        const m = $('wModal'), panel = $('wModalPanel');
        $('wModalTitle').textContent = title;
        const body = $('wModalBody');
        body.innerHTML = html || '';
        panel.classList.toggle('is-wide', !!opts.wide);
        panel.classList.toggle('is-game', !!opts.game);
        m.hidden = false;
        modalClose = opts.onClose || null;
        modalRender = opts.render || null;
        hideTip();
        E.paused = true;
        E.keys.clear();
        if (E.mouse.down) { E.mouse.down = false; if (WHW.onRelease) WHW.onRelease(); }
        setTimeout(() => { const f = body.querySelector('button, [tabindex]'); if (f && !opts.game) f.focus({ preventScroll: true }); }, 0);
        return body;
    }
    function closeModal() {
        const fn = modalClose;
        modalClose = null; modalRender = null;
        hideTip();
        $('wModal').hidden = true;
        E.paused = false;
        if (fn) fn();
        try { $('wCanvas').focus(); } catch (e) {}
    }
    const isOpen = () => !$('wModal').hidden;
    // re-render the open modal (after an action changed the save)
    function refresh() { if (isOpen() && modalRender) modalRender(); }

    // keys while playing: inventory, map, potion, hotbar; while a modal is open everything but Escape is swallowed
    function handleKey(ev, down) {
        // typing in the chat box (or a name field) never moves the character
        const typing = document.activeElement && /^(INPUT|TEXTAREA)$/.test(document.activeElement.tagName);
        if (typing) return true;
        if (!down) return isOpen();
        if (isOpen()) {
            if (ev.key === 'Escape' || ((ev.key === 'i' || ev.key === 'I' || ev.key === 'Tab') && modalRender === renderBagBody)) { ev.preventDefault(); closeModal(); }
            return true;
        }
        if ($('tabLock') && !$('tabLock').hidden) return true;
        const k = ev.key.toLowerCase();
        if (k === 'i' || ev.key === 'Tab') { ev.preventDefault(); openBag(); return true; }
        if (k === 'm') { openMap(); return true; }
        if (k === 'k') { openSkills(); return true; }
        const ab = D.ABILITY_KEYS.findIndex(key => key.toLowerCase() === k);
        if (ab >= 0) { WHW.actions.castAbility(ab); return true; }
        if (k === 'z') { WHW.actions.usePotion(); return true; }
        if (k >= '1' && k <= '5') { WHW.actions.selectSlot(Number(k) - 1); return true; }
        if (ev.key === 'Escape') { openSettings(); return true; }
        if (ev.key === 'Enter') { ev.preventDefault(); openChat(); return true; }
        return false;
    }

    // ---------------- online: the chip, the panel, chat ----------------
    function setOnline() {
        const on = WHW.online;
        const btn = $('btnOnline');
        if (!btn || !on) return;
        const here = on.status === 'online' ? on.here().length + 1 : 0;
        const label = { off: 'Off', connecting: '…', reconnecting: '…', error: '!', online: String(here) }[on.status] || '…';
        $('onlineCount').textContent = label;
        btn.classList.toggle('is-online', on.status === 'online');
        btn.classList.toggle('is-error', on.status === 'error');
        btn.title = on.status === 'online' ? (here === 1 ? 'Online: nobody else here yet' : 'Online: ' + here + ' players in this zone')
            : on.status === 'error' ? 'Online play: ' + on.error : on.status === 'off' ? 'Playing offline' : 'Connecting…';
        if (isOpen() && modalRender === renderOnline) renderOnline();
    }
    function openOnline() {
        modal('🌐 Online', '', { render: renderOnline });
        renderOnline();
    }
    function renderOnline() {
        const body = $('wModalBody');
        const on = WHW.online;
        const S = WHW.settings;
        const here = on.here();
        const statusText = { online: 'Connected', connecting: 'Connecting…', reconnecting: 'Reconnecting…', off: 'Offline', error: 'Could not connect' }[on.status] || on.status;
        const pvpNote = game().zoneId === 'town' ? 'Town is safe: nobody can be hurt here.'
            : '<b style="color:#ff8a95">PvP is on in this zone.</b> Other players can attack you, and you them. Knocked-out players drop part of what they carry.';
        const err = on.status === 'error' ? '<br><span style="color:#ffb3bb">' + esc(on.error) + '</span><br><button class="btn btn-sm btn-ghost" id="onRetry" style="margin-top:8px">Try again</button>' : '';
        let html = '<p class="w-note">Status: <b>' + esc(statusText) + '</b>' + err + (on.status === 'online' ? '<br>' + pvpNote : '') + '</p>';
        html += '<div class="w-section"><h3>Your name</h3><div class="w-row"><input id="onName" maxlength="16" value="' + esc(on.name()) + '" aria-label="Your name online">' +
            '<button class="btn btn-sm btn-primary" id="onNameSave">Save</button></div><p class="muted" style="margin:6px 0 0">2 to 16 letters, numbers and spaces.</p></div>';
        if (on.status === 'online') {
            const list = here.length ? '<div class="w-players">' + here.map(r => '<span>' + esc(r.info.n) + '<b>' + (r.dead ? 'knocked out' : Math.ceil(r.hp) + ' HP') + '</b></span>').join('') + '</div>'
                : '<p class="muted">Nobody else in this zone right now.</p>';
            html += '<div class="w-section"><h3>Here with you (' + here.length + ')</h3>' + list + '</div>';
            const log = on.log.length ? on.log.map(l => '<div class="' + (l.mine ? 'mine' : '') + '"><b>' + esc(l.name) + ':</b> ' + esc(l.m) + '</div>').join('')
                : '<span class="muted">Press Enter in the game to say something.</span>';
            html += '<div class="w-section"><h3>Chat</h3><div class="w-log" id="onLog">' + log + '</div></div>';
        }
        html += '<label class="w-setting"><span>Play online<small>See and meet other players. Turn off to play alone.</small></span><input type="checkbox" id="onToggle" ' + (S.online ? 'checked' : '') + '></label>' +
            '<label class="w-setting"><span>Swear filter<small>Hides rude words in chat (the same setting as the game\'s chat).</small></span><input type="checkbox" id="onSafe" ' + (localStorage.getItem('chat_safe_mode') === '1' ? 'checked' : '') + '></label>';
        body.innerHTML = html;
        const retry = body.querySelector('#onRetry');
        if (retry) retry.addEventListener('click', () => { on.stop(); WHW.settings.online = true; WHW.saveSettings(); on.start(); renderOnline(); });
        const logEl = body.querySelector('#onLog');
        if (logEl) logEl.scrollTop = logEl.scrollHeight;
        body.querySelector('#onNameSave').addEventListener('click', () => {
            const ok = on.setName(body.querySelector('#onName').value);
            toast(ok ? 'Name saved.' : 'Names are 2 to 16 letters, numbers and spaces.', ok ? '' : 'bad');
        });
        body.querySelector('#onToggle').addEventListener('change', (e) => {
            S.online = e.target.checked;
            WHW.saveSettings();
            if (S.online) on.start(); else on.stop();
            renderOnline();
        });
        body.querySelector('#onSafe').addEventListener('change', (e) => { try { localStorage.setItem('chat_safe_mode', e.target.checked ? '1' : '0'); } catch (err2) {} });
    }
    function chatLogChanged() { if (isOpen() && modalRender === renderOnline) renderOnline(); }
    function openChat() {
        const on = WHW.online, bar = $('chatBar');
        // inside a building nobody online can hear you, but you can still say things out loud
        const local = !!D.ZONES[game().zoneId].interior;
        if (!local && (!on || on.status !== 'online')) { toast(on && on.status === 'off' ? 'Chat needs online play (turn it on with the 🌐 button).' : 'Not connected yet.'); return; }
        bar.dataset.local = local ? '1' : '';
        $('emotes').hidden = local;
        $('chatInput').placeholder = local ? 'Say something out loud (Enter to say it, Esc to close)' : 'Say something (Enter to send, Esc to close)';
        bar.hidden = false;
        $('chatInput').value = '';
        $('chatInput').focus();
    }
    function closeChat() { $('chatBar').hidden = true; try { $('chatInput').blur(); } catch (e) {} }
    function bindChat() {
        const bar = $('chatBar');
        if (!bar || bar.dataset.bound) return;
        bar.dataset.bound = '1';
        $('emotes').innerHTML = window.WHWorldOnline.EMOTES.map(e => '<button type="button" data-emote="' + esc(e) + '" aria-label="Emote ' + esc(e) + '">' + esc(e) + '</button>').join('');
        bar.addEventListener('submit', (ev) => {
            ev.preventDefault();
            const v = $('chatInput').value;
            if (v.trim()) { if (bar.dataset.local) WHW.actions.speak(v); else WHW.online.say(v, false); }
            closeChat();
        });
        $('chatInput').addEventListener('keydown', (ev) => { if (ev.key === 'Escape') { ev.preventDefault(); closeChat(); } });
        bar.querySelectorAll('[data-emote]').forEach(b => b.addEventListener('click', () => { WHW.online.say(b.dataset.emote, true); closeChat(); }));
        $('btnChat').addEventListener('click', () => (bar.hidden ? openChat() : closeChat()));
        $('btnOnline').addEventListener('click', openOnline);
    }
    if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', bindChat); else bindChat();

    // ---------------- toasts, hints, banners ----------------
    function toast(msg, kind) {
        const box = $('toasts');
        const el = document.createElement('div');
        el.className = 'w-toast' + (kind ? ' w-toast--' + kind : '');
        el.textContent = msg;
        box.appendChild(el);
        while (box.children.length > 4) box.firstChild.remove();
        setTimeout(() => { el.classList.add('is-out'); setTimeout(() => el.remove(), 420); }, kind === 'gem' || kind === 'gold' ? 4200 : 2800);
    }
    const hintAt = new Map();
    function hint(msg) { const t = hintAt.get(msg) || 0; if (performance.now() - t < 4000) return; hintAt.set(msg, performance.now()); toast(msg, 'bad'); }
    function banner(title, sub) {
        const b = $('banner');
        b.hidden = true; void b.offsetWidth;
        b.innerHTML = `<b>${esc(title)}</b>${sub ? `<span>${esc(sub)}</span>` : ''}`;
        b.hidden = false;
        clearTimeout(banner.t); banner.t = setTimeout(() => { b.hidden = true; }, 2700);
    }

    // ---------------- HUD ----------------
    let lastRubies = -1, hotbarKey = '';
    // Parts of the HUD change every frame: write to the page only when what it shows really changed (each write costs a
    // restyle of the page on top of drawing the game)
    function setText(el, v) { v = String(v); if (el._v !== v) { el._v = v; el.textContent = v; } }
    function setStyle(el, prop, v) { const k = '_s' + prop; if (el[k] !== v) { el[k] = v; el.style[prop] = v; } }
    function renderHud() {
        const g = game();
        if (!g || !g.player) return;
        const p = g.player, s = g.state;
        setStyle($('hpFill'), 'width', (100 * Math.max(0, p.hp) / p.maxHp).toFixed(1) + '%');
        setText($('hpText'), `${Math.ceil(Math.max(0, p.hp))} / ${p.maxHp}`);
        setStyle($('stFill'), 'width', (100 * p.stam.val / D.COMBAT.stamina.max).toFixed(1) + '%');
        $('stBar').classList.toggle('is-winded', p.stam.winded);
        if (s.rubies !== lastRubies) {
            const el = $('rubyCount');
            el.textContent = fmt(s.rubies);
            if (lastRubies >= 0 && s.rubies > lastRubies && !E.reducedMotion) { const pill = el.parentElement; pill.classList.remove('is-bump'); void pill.offsetWidth; pill.classList.add('is-bump'); }
            lastRubies = s.rubies;
        }
        const sl = $('shieldSlot');
        if (sl) { sl.classList.toggle('is-sel', p.shield.up); sl.classList.toggle('is-broken', p.shield.brokenUntil > E.time); }
        const key = s.equip.offhand + '|' + s.hotbar.join(',') + '|' + s.sel + '|' + s.cons.potion_small + s.cons.potion_big + s.cons.potion_max + '|' + s.cons.arrow + '|' + s.gear.length + '|' + s.classes.active + W.abilityKit(s).join(',');
        if (key !== hotbarKey) { hotbarKey = key; renderHotbar(); }
        renderQuests();
        // boss bar
        const boss = g.actors.find(a => a.kind === 'boss' && !a.dead && a.active);
        const bb = $('bossBar');
        if (boss) {
            bb.hidden = false;
            $('bossName').textContent = boss.def.name + (boss.phase ? ' · ' + (boss.phase === 1 ? 'Enraged' : 'Furious') : '');
            $('bossFill').style.width = (100 * Math.max(0, boss.hp) / boss.maxHp).toFixed(1) + '%';
            bb.classList.toggle('is-exposed', boss.exposedUntil > E.time);
        } else bb.hidden = true;
    }
    function bestPotion(s) { return ['potion_small', 'potion_big', 'potion_max'].find(id => s.cons[id] > 0) || 'potion_small'; }
    function renderHotbar() {
        const g = game(), s = g.state;
        const el = $('hotbar');
        let html = '';
        for (let i = 0; i < D.RULES.hotbarSlots; i++) {
            const it = W.findGear(s, s.hotbar[i]), b = W.baseOf(it);
            const q = it ? W.qualityOf(it.score) : null;
            const extra = b && b.cls === 'bow' ? `<span class="n">${fmt(s.cons.arrow)}</span>` : '';
            html += `<button class="w-slot${i === s.sel ? ' is-sel' : ''}" data-slot="${i}" title="${b ? esc(W.gearName(it)) : 'Empty slot'}" aria-label="Slot ${i + 1}: ${b ? esc(W.gearName(it)) : 'empty'}">
                <span class="k">${i + 1}</span>${b ? ICONS[b.cls] : ''}${extra}${q ? `<i class="q" style="background:${q.color}"></i>` : ''}</button>`;
        }
        const pot = bestPotion(s);
        const potions = (s.cons.potion_small || 0) + (s.cons.potion_big || 0) + (s.cons.potion_max || 0);
        const shield = W.findGear(s, s.equip.offhand);
        if (shield) html += `<span class="w-slot w-slot--cons w-slot--shield" id="shieldSlot" title="${esc(W.gearName(shield))}: hold right-click or F to block" aria-label="Shield: hold right-click or F to block"><span class="k">RMB</span>🛡️<i class="q" style="background:${W.qualityOf(shield.score).color}"></i></span>`;
        html += `<button class="w-slot w-slot--cons" data-potion="1" title="Drink a potion (Z). Small, Big and Max potions need 6, 10 and 20 seconds before the next." aria-label="Drink a potion, ${potions} left"><span class="k">Z</span>${D.CONSUMABLES_BY_ID[pot].icon}<span class="n">${potions}</span><span class="cd" hidden></span></button>`;
        const cls = W.classOf(s);
        W.abilityKit(s).forEach((id, i) => {
            const a = D.ABILITIES[id], k = D.ABILITY_KEYS[i];
            html += a ? `<button class="w-slot w-slot--cons w-abil" data-abil="${i}" title="${esc(a.name)} (${k}): ${esc(a.desc)}" aria-label="${esc(a.name)}, key ${k}"><span class="k">${k}</span>${a.icon}<span class="cd" hidden></span>${a.charges > 1 ? '<span class="ch"></span>' : ''}</button>`
                : `<button class="w-slot w-slot--cons w-abil is-empty" data-abil="${i}" title="Nothing on ${k}: learn and equip abilities in the Classes menu (K)" aria-label="Key ${k}: no ability. Open the Classes menu"><span class="k">${k}</span>+</button>`;
        });
        el.innerHTML = html;
        const sb = $('btnSkills');
        if (sb) { sb.textContent = cls.icon; sb.title = cls.name + ': classes and skills (K)'; }
        el.querySelectorAll('[data-abil]').forEach(b => b.addEventListener('click', () => (b.classList.contains('is-empty') ? openSkills() : WHW.actions.castAbility(Number(b.dataset.abil)))));
        el.querySelectorAll('[data-slot]').forEach(b => b.addEventListener('click', () => WHW.actions.selectSlot(Number(b.dataset.slot))));
        el.querySelector('[data-potion]').addEventListener('click', () => WHW.actions.usePotion());
    }
    // ability cooldowns and active buffs, every frame
    function renderAbilities() {
        const g = game(), p = g.player;
        if (!p) return;
        const kit = W.abilityKit(g.state);
        document.querySelectorAll('.w-abil:not(.is-empty)').forEach((b) => {
            const id = kit[Number(b.dataset.abil)];
            const cd = id ? WHW.actors.abilityCd(p, id) : 0;
            const c = b.querySelector('.cd'), ch = b.querySelector('.ch');
            if (c.hidden !== cd <= 0) c.hidden = cd <= 0;
            if (cd > 0) setText(c, cd >= 10 ? Math.ceil(cd) : cd.toFixed(1));
            if (ch && id) setText(ch, WHW.actors.abilityCharges(p, id)); // charges ready
            b.classList.toggle('is-on', !!id && WHW.actors.abilityActive(p, id));
        });
        for (let i = 0; i < D.ABILITY_KEYS.length; i++) {
            const t = $('tAb' + i);
            if (!t) continue;
            const id = kit[i], a = D.ABILITIES[id];
            if (t.hidden !== !a) t.hidden = !a;
            if (a) { setText(t, a.icon); t.classList.toggle('is-cd', WHW.actors.abilityCd(p, id) > 0); }
        }
        // the potion cooldown, the same way
        const pw = Math.max(0, (g.potionCd || 0) - E.time), pb = document.querySelector('[data-potion]'), pc = pb && pb.querySelector('.cd');
        if (pc) {
            if (pc.hidden !== pw <= 0) pc.hidden = pw <= 0;
            if (pw > 0) setText(pc, pw >= 10 ? Math.ceil(pw) : pw.toFixed(1));
        }
        const tp = $('tPotion');
        if (tp) tp.classList.toggle('is-cd', pw > 0);
    }
    // ---------------- classes and skill trees ----------------
    let classTab = null;
    function openSkills(tab) {
        classTab = tab || classTab || game().state.classes.active;
        modal('Classes & skills', '', { wide: true, render: renderSkills });
        renderSkills();
    }
    function renderSkills() {
        const body = $('wModalBody');
        const g = game(), s = g.state;
        const id = classTab, c = D.CLASSES[id];
        const active = s.classes.active === id, unlocked = !!s.classes.unlocked[id];
        const labels = {};
        for (const k of D.CLASS_ORDER) labels[k] = (s.classes.unlocked[k] ? D.CLASSES[k].icon : '🔒') + ' ' + D.CLASSES[k].name;
        let html = tabs(D.CLASS_ORDER, id, null, labels);
        html += `<p class="w-note">Every class has its own skill tree. Learn skills with rubies from the top of a branch down. <b>Abilities</b> (square icons) go on <kbd>R</kbd> <kbd>Q</kbd> <kbd>C</kbd>: up to three equipped at a time. <b>Perks</b> (round icons) are passive bonuses that work while you are that class. Change class in town. Abilities use your weapon's damage, and outside town they hit other players too (at PvP strength, with shorter stuns).</p>`;
        let action;
        if (active) action = '<span class="w-class-on">Your class</span>';
        else if (unlocked) action = g.inTown ? `<button class="btn btn-sm btn-primary" data-become="${id}">Become a ${esc(c.name)}</button>` : '<span class="muted">Change class in town</span>';
        else {
            const pr = W.classProgress(s, id), st = W.classState(s, id);
            action = `<div class="w-class-req"><span>${pr.done ? '✅' : '🔒'} ${esc(c.unlock.text)}${c.unlock.boss ? '' : ` · <b>${pr.have}/${pr.need}</b>`}</span>
                ${c.unlock.boss ? '' : `<i class="w-class-bar"><b style="width:${(100 * pr.have / pr.need).toFixed(0)}%"></b></i>`}</div>
                <button class="btn btn-sm btn-primary" data-unlock="${id}" ${st.ok ? '' : 'disabled'}>Unlock · ${fmt(c.cost)} rubies</button>`;
        }
        html += `<div class="w-class" style="border-color:${c.color}"><div class="w-class-ico" style="border-color:${c.color}">${c.icon}</div>
            <div class="w-class-text"><div class="w-card-name">${esc(c.name)}</div><div class="w-card-sub">${esc(c.desc)}</div><div class="w-class-passive"><b>Class bonus:</b> ${esc(c.passive)}</div></div>
            <div class="w-class-act">${action}</div></div>`;
        if (unlocked) {
            const lo = s.classes.loadout[id] || [];
            html += `<div class="w-loadout"><span class="w-loadout-label">Loadout${active ? '' : ' as a ' + esc(c.name)}</span>` + D.ABILITY_KEYS.map((k, i) => {
                const a = D.ABILITIES[lo[i]];
                return a ? `<button class="w-load is-set" data-unequip="${i}" title="Take ${esc(a.name)} off ${k}" aria-label="${k}: ${esc(a.name)}. Take it off"><kbd>${k}</kbd><span>${a.icon} ${esc(a.name)}</span><i aria-hidden="true">×</i></button>`
                    : `<span class="w-load"><kbd>${k}</kbd><span class="muted">Empty</span></span>`;
            }).join('') + '</div>';
        }
        html += '<div class="w-tree">' + c.branches.map(br => `<div class="w-branch"><h4>${esc(br.name)}</h4>${br.skills.map(sid => skillNode(s, id, sid, active)).join('')}</div>`).join('') + '</div>';
        body.innerHTML = html;
        wireTabs(body, (t) => { classTab = t; renderSkills(); });
        on(body, '[data-learn]', (d) => WHW.actions.learnSkill(d.learn));
        on(body, '[data-equip]', (d) => WHW.actions.equipAbility(d.equip, Number(d.slot)));
        on(body, '[data-unequip]', (d) => WHW.actions.unequipAbility(id, Number(d.unequip)));
        on(body, '[data-unlock]', (d) => WHW.actions.unlockClass(d.unlock));
        on(body, '[data-become]', (d) => WHW.actions.setClass(d.become));
    }
    // One skill in the tree: what it does and what you can do with it (learn it, or put an ability on a key)
    function skillNode(s, cls, sid, active) {
        const sk = W.skillDef(sid), known = !!s.skills.learned[sid], isAb = sk.type === 'ability';
        const st = W.skillState(s, sid);
        const cost = `<span class="w-node-cost">${fmt(sk.cost)} rubies</span>`;
        let act;
        if (known && isAb) {
            const on = (s.classes.loadout[cls] || []).indexOf(sid);
            act = '<span class="w-node-keys" role="group" aria-label="Equip on a key">' + D.ABILITY_KEYS.map((k, i) => (on === i
                ? `<button class="w-key is-on" data-unequip="${i}" aria-pressed="true" title="On ${k}: click to take it off" aria-label="${esc(sk.name)} is on ${k}: take it off">${k}</button>`
                : `<button class="w-key" data-equip="${sid}" data-slot="${i}" aria-pressed="false" title="Put it on ${k}" aria-label="Put ${esc(sk.name)} on ${k}">${k}</button>`)).join('') + '</span>';
        } else if (known) act = `<span class="w-class-on">✓ ${active ? 'Active' : 'Learned'}</span>`;
        else if (st.reason === 'class') act = (sk.boss ? `<span class="lock">Needs ${esc(D.BOSSES[sk.boss].name)} beaten</span>` : '') + cost;
        else if (st.reason === 'req') act = `<span class="lock">🔒 Learn ${esc(W.skillDef(st.need).name)} first</span>` + cost;
        else if (st.reason === 'boss') act = `<span class="lock">🔒 Beat ${esc(D.BOSSES[sk.boss].name)}</span>` + cost;
        else act = `<button class="btn btn-sm btn-primary" data-learn="${sid}" ${st.ok ? '' : 'disabled'}>Learn · ${fmt(sk.cost)} rubies</button>`;
        const state = known ? 'is-known' : (st.ok || st.reason === 'rubies') ? 'is-open' : 'is-locked';
        const kind = isAb ? `Ability · ${sk.cd}s cooldown${sk.charges > 1 ? ' · ' + sk.charges + ' charges' : ''}${sk.stam ? ' · ' + sk.stam + ' stamina' : ''}` : 'Perk · always on';
        return `<div class="w-node ${state}${sk.req && s.skills.learned[sk.req] ? ' is-linked' : ''}${isAb ? ' is-ability' : ''}">
            <div class="w-node-top"><span class="w-node-ico" style="border-color:${isAb ? sk.color : 'var(--border-strong)'}">${sk.icon}</span><div><div class="w-card-name">${esc(sk.name)}</div><div class="w-node-kind">${kind}</div></div></div>
            <div class="w-card-sub">${esc(sk.desc)}</div><div class="w-card-actions">${act}</div></div>`;
    }
    // ---------------- quests ----------------
    function plural(n, word) { return n === 1 ? word : /f$/.test(word) ? word.slice(0, -1) + 'ves' : word + 's'; }
    // "Defeat 6 Slimes", "Bring 6 Copper Ore and 4 Coal"...
    function goalText(goal) {
        const n = goal.n || 1, zone = goal.zone && goal.kind !== 'visit' ? ' in ' + D.ZONES[goal.zone].name : '';
        switch (goal.kind) {
            case 'kill': return 'Defeat ' + n + ' ' + plural(n, goal.monster ? D.MONSTERS[goal.monster].name : goal.elite ? 'elite' : 'monster') + zone;
            case 'boss': return goal.boss ? 'Beat ' + D.BOSSES[goal.boss].name : 'Beat any of the four great bosses';
            case 'rival': return 'Beat ' + n + ' ' + plural(n, 'rival adventurer');
            case 'harvest': return (goal.tool === 'axe' ? 'Chop ' + n + ' ' + plural(n, 'tree') : goal.tool === 'pickaxe' ? 'Mine ' + n + (n === 1 ? ' rock or ore vein' : ' rocks or ore veins') : 'Gather ' + n + ' times (ore, wood or plants)') + zone;
            case 'craft': return 'Craft ' + n + ' ' + plural(n, 'piece') + ' of gear' + (goal.minScore ? ' of ' + W.qualityOf(goal.minScore).name + ' quality or better' : '');
            case 'box': return 'Craft a lootbox at the Rune Altar';
            case 'deliver': return 'Bring ' + Object.entries(goal.mats).map(([id, k]) => k + ' ' + matName(id)).join(' and ');
            case 'visit': return 'Step inside the ' + D.ZONES[goal.zone].name;
            case 'god': return 'Raise any statue in the Hall of Gods';
        }
        return '';
    }
    // the accepted quests, under the zone name
    let questKey = '';
    function renderQuests() {
        const el = $('questTracker');
        if (!el) return;
        const list = W.activeQuests(game().state);
        const key = list.map(a => a.id + ':' + a.progress.have + ':' + a.progress.done).join('|');
        if (key === questKey) return;
        questKey = key;
        el.hidden = !list.length;
        el.innerHTML = list.map(a => `<div class="${a.progress.done ? 'is-done' : ''}"><b>${esc(a.quest.title)}</b><span>${a.progress.done ? '✓ back to ' + esc(D.NPCS[a.npc].name) : a.progress.have + ' / ' + a.progress.need}</span></div>`).join('');
    }
    let npcOpen = null;
    const npcLine = {}; // which of a wanderer's lines was said last (this visit only)
    function openNpc(id) {
        npcOpen = id;
        modal(D.NPCS[id].name, '', { render: renderNpc });
        renderNpc();
    }
    function renderNpc() {
        const body = $('wModalBody'), s = game().state, id = npcOpen, npc = D.NPCS[id];
        const o = W.questOffer(s, id, Date.now()), rec = s.quests[id] || { step: 0 };
        let html = `<div class="w-npc"><img class="w-npc-face" src="${npc.face}" alt="" style="border-color:${npc.color}"><div><div class="w-card-name">${esc(npc.name)}</div><div class="w-card-sub">${esc(npc.role)}</div><p class="w-npc-say">"${esc(npc.greet)}"</p></div></div>`;
        if (npc.rumor) html += `<p class="w-npc-rumor"><b>They mention:</b> "${esc(npc.rumor)}"</p>`;
        if (npc.lines) {
            const line = s.secrets.hallDoor && npc.opened ? npc.opened : npc.lines[(npcLine[id] = ((npcLine[id] === undefined ? -1 : npcLine[id]) + 1) % npc.lines.length)];
            html = `<div class="w-npc"><img class="w-npc-face" src="${npc.face}" alt="" style="border-color:${npc.color}"><div><div class="w-card-name">${esc(npc.name)}</div><div class="w-card-sub">${esc(npc.role)}</div><p class="w-npc-say">"${esc(line)}"</p></div></div>`;
            if (!s.secrets.hallDoor) html += '<p class="w-note">They fall silent again. Talk to them once more and they may say something else.</p>';
        } else if (o.doneToday) html += '<p class="w-note">"That is all I have for you today. Come back tomorrow."</p>';
        else {
            const q = o.quest;
            const kicker = q.daily ? 'Daily quest' : 'Story ' + (Math.min(rec.step, npc.chain.length) + 1) + ' of ' + npc.chain.length;
            const potions = q.cons ? Object.entries(q.cons).map(([c, n]) => ' + ' + n + ' ' + D.CONSUMABLES_BY_ID[c].name + (n > 1 ? 's' : '')).join('') : '';
            let prog = '', act;
            if (o.active) {
                const p = o.progress;
                prog = `<div class="w-quest-prog" role="progressbar" aria-valuemin="0" aria-valuemax="${p.need}" aria-valuenow="${p.have}"><i style="width:${(100 * p.have / p.need).toFixed(0)}%"></i><span>${p.have} / ${p.need}</span></div>`;
                if (q.goal.kind === 'deliver') prog += needHtml(s, q.goal.mats, 0);
                act = `<button class="btn btn-primary" data-qturnin ${p.done ? '' : 'disabled'}>${p.done ? 'Hand in' : 'Not done yet'}</button><button class="btn btn-ghost btn-sm" data-qquit>Give up</button>`;
            } else if (o.locked) act = `<span class="lock">🔒 Come back once you can reach ${esc(D.ZONES[o.locked.zone].name)}.</span>`;
            else act = '<button class="btn btn-primary" data-qaccept>Accept</button>';
            html += `<div class="w-quest"><div class="w-quest-kicker">${kicker}</div><div class="w-quest-title">${esc(q.title)}</div><p class="w-quest-text">"${esc(q.text)}"</p>
                <div class="w-quest-goal"><b>Goal:</b> ${esc(goalText(q.goal))}</div>${prog}
                <div class="w-quest-reward"><b>Reward:</b> ♦ ${fmt(o.rubies)} rubies${esc(potions)}${q.daily ? ' <span class="muted">(more once you reach further zones)</span>' : ''}</div>
                <div class="w-card-actions">${act}</div></div>`;
        }
        body.innerHTML = html;
        on(body, '[data-qaccept]', () => WHW.actions.acceptQuest(id));
        on(body, '[data-qturnin]', () => WHW.actions.turnInQuest(id));
        on(body, '[data-qquit]', () => WHW.actions.abandonQuest(id));
    }

    // ---------------- the Hall of Gods: its far wall, and the hidden room's altar ----------------
    function openCarving() {
        modal('The far wall', `<div class="w-carving"><p>Carved deep into the stone, in letters worn almost smooth:</p>
            <blockquote>HERE THE PROPHET'S FAITH IS SPOKEN,<br>AND THE STONE REMEMBERS.</blockquote>
            <p class="muted">Below it, someone has scratched a little eye.</p></div>`);
    }
    let altarOpen = null, altarConfirm = 0;
    function openAltar(id) {
        altarOpen = id; altarConfirm = 0;
        const it = D.HIDDEN_SHOP[id];
        modal(it.icon + ' ' + it.name, '', { render: renderAltar });
        renderAltar();
    }
    function renderAltar() {
        const body = $('wModalBody'), s = game().state, id = altarOpen, it = D.HIDDEN_SHOP[id];
        const bal = Bridge.mainBalance(localStorage), st = W.hiddenShopState(s, id, bal), c = st.cost;
        let html = `<p class="w-note">${esc(it.desc)}</p>`;
        if (s.secrets[id]) html += '<p class="w-note"><b>It is yours.</b> If it is not in your game yet, open the game: the gems and Golden are taken there, and then it is in Items (🎒), ready to equip as a charm.</p>';
        else {
            const row = (label, have, need) => `<div class="${have < need ? 'is-short' : ''}"><span>${label}</span><b>${fmt(need)} <small class="muted">(you have ${fmt(have)})</small></b></div>`;
            html += `<h3 class="w-god-h">The price</h3>${needHtml(s, c.mats, c.rubies)}
                <div class="w-god-rows w-altar-rows">${row('💎 Gems, from your game', bal.gems, c.gems)}${row('✨ Golden What Happened, from your game', Math.floor(bal.golden), c.golden)}</div>
                <p class="muted">Bought once, ever. The rubies and the treasures are taken here; the gems and Golden are taken in your game.</p>
                <div class="w-card-actions"><button class="btn btn-gold" data-hbuy ${st.ok ? '' : 'disabled'}>${altarConfirm ? 'Click again to buy it' : 'Buy ' + esc(it.name)}</button></div>`;
        }
        body.innerHTML = html;
        on(body, '[data-hbuy]', () => {
            if (!altarConfirm) { altarConfirm = 1; renderAltar(); return; }
            altarConfirm = 0;
            WHW.actions.buyHidden(id);
        });
    }

    // ---------------- the Hall of Gods: a statue ----------------
    let statueOpen = null;
    function openStatue(id) {
        statueOpen = id;
        const god = Gods.GODS[id];
        modal(god.icon + ' ' + god.name, '', { render: renderStatue });
        renderStatue();
    }
    function renderStatue() {
        const body = $('wModalBody'), s = game().state, id = statueOpen, god = Gods.GODS[id];
        const lv = s.gods[id] || 0, st = W.godState(s, id), cost = Gods.costFor(id, lv + 1);
        // the next level's blessing, counting the hidden god's boost (raising the hidden god itself raises that boost)
        const next = Object.assign({}, s.gods, { [id]: lv + 1 });
        let html = `<div class="w-god" style="--god:${god.color}"><img class="w-god-face" src="${god.face}" alt="">
            <div><div class="w-card-name">${esc(god.name)}, ${esc(god.title)}</div><p class="w-god-lore">${esc(god.lore)}</p>
            <div class="w-god-level">Level <b>${lv}</b></div></div></div>`;
        html += `<div class="w-god-rows"><div><span>Blessing now</span><b>${lv ? esc(Gods.describe(id, lv, s.gods)) : 'None yet'}</b></div>
            <div><span>At level ${lv + 1}</span><b>${esc(Gods.describe(id, lv + 1, next))}</b></div></div>`;
        if (cost) html += `<h3 class="w-god-h">Offering for level ${lv + 1}</h3>${needHtml(s, cost.mats, cost.rubies)}
                <div class="w-card-actions"><button class="btn btn-gold" data-raise ${st.ok ? '' : 'disabled'}>Make the offering</button></div>`;
        html += '<p class="w-note">There is no top level: every offering raises the blessing, and asks for more than the last. Blessings work back in the clicker straight away, on top of your Divine upgrades, followers and charms.</p>';
        body.innerHTML = html;
        on(body, '[data-raise]', () => WHW.actions.upgradeGod(id));
    }

    // swing meter, every frame
    function renderPower(p) {
        const f = $('powerFill');
        if (!f || !p) return;
        const b = W.baseOf(W.findGear(game().state, p.weaponUid));
        const meter = $('powerMeter');
        if (!b) { if (!meter.hidden) meter.hidden = true; return; }
        if (meter.hidden) meter.hidden = false;
        const P = D.WEAPON_CLASSES[b.cls];
        let minMark, fullMark;
        if (b.cls === 'bow') { minMark = P.minDraw; fullMark = 0.95; }
        else { minMark = P.vMin / P.vFull; fullMark = (P.vMin + (P.vFull - P.vMin) * D.COMBAT.perfect.at) / P.vFull; }
        if (meter._cls !== b.cls) {
            meter._cls = b.cls;
            meter.querySelector('.w-power-min').style.left = (minMark * 100) + '%';
            meter.querySelector('.w-power-full').style.left = (Math.min(1, fullMark) * 100) + '%';
        }
        p.powerShown = Math.max(p.power, (p.powerShown || 0) * 0.9);
        setStyle(f, 'width', Math.min(100, p.powerShown * 100).toFixed(1) + '%');
        const cls = p.powerPerfect ? 'is-perfect' : p.powerHit ? 'is-hit' : '';
        if (f.className !== cls) f.className = cls;
    }
    let promptHtml = null;
    function setPrompt(html) {
        const el = $('prompt');
        if (!html) { if (!el.hidden) el.hidden = true; return; }
        if (promptHtml !== html) { promptHtml = html; el.innerHTML = html; }
        if (el.hidden) el.hidden = false;
    }
    function setZone(name, sub) { $('zoneName').innerHTML = esc(name) + (sub ? `<small>${esc(sub)}</small>` : ''); }

    // ---------------- shared pieces ----------------
    function matName(id) { return (D.MATERIALS_BY_ID[id] || D.CONSUMABLES_BY_ID[id] || { name: id }).name; }
    function matColor(id) { return (D.MATERIALS_BY_ID[id] || D.CONSUMABLES_BY_ID[id] || { color: '#888' }).color; }
    function needHtml(s, inputs, fee, times = 1) {
        const parts = Object.entries(inputs).map(([id, n]) => {
            const have = W.count(s, id), need = n * times;
            return `<span class="${have < need ? 'is-short' : ''}" data-mat="${id}" tabindex="0"><i class="w-dot" style="display:inline-block;width:8px;height:8px;margin-right:4px;background:${matColor(id)}"></i>${need} ${esc(matName(id))} <small class="muted">(${have})</small></span>`;
        });
        if (fee) parts.push(`<span class="is-fee ${s.rubies < fee ? 'is-short' : ''}">♦ ${fmt(fee)} rubies</span>`);
        return `<div class="w-need">${parts.join('')}</div>`;
    }
    // ---------------- material tooltips: where to get it ----------------
    // Any element with data-mat="<material id>" shows one on hover, keyboard focus or a tap.
    const SOURCE_ICON = { axe: '🪓', pickaxe: '⛏️', hand: '🌿', monster: '⚔️', elite: '⭐', boss: '👑', trader: '💰' };
    // the first tool good enough for a node ("Copper Pickaxe")
    function toolFor(tool, tier) {
        const g = D.GEAR.filter(x => x.cls === tool && x.tool >= tier).sort((a, b) => a.tier - b.tier)[0];
        return g ? g.name : '';
    }
    function sourceLines(id) {
        const s = game().state, groups = [];
        for (const src of W.materialSources(id)) {
            const same = src.zone && groups.find(x => x.kind === src.kind && x.name === src.name && x.chance === src.chance && x.zones);
            if (same) { same.zones.push(src.zone); continue; }
            groups.push(Object.assign({}, src, { zones: src.zone ? [src.zone] : null }));
        }
        const where = (zones) => (zones ? zones.map(z => (s.unlocked.zones[z] ? '' : '🔒 ') + D.ZONES[z].name).join(', ') : '');
        const pct = (c) => (c >= 1 ? '' : ' · ' + (c >= 0.1 ? Math.round(c * 100) : Math.round(c * 1000) / 10) + '% chance');
        return groups.slice(0, 7).map((src) => {
            if (src.kind === 'node') {
                const verb = src.tool === 'axe' ? 'Chop' : src.tool === 'pickaxe' ? 'Mine' : 'Pick';
                const need = src.tool !== 'hand' && src.tier > 1 ? toolFor(src.tool, src.tier) : '';
                return [SOURCE_ICON[src.tool] || '🌿', verb + ' ' + src.name + (need ? ' (' + need + ' or better)' : ''), where(src.zones)];
            }
            if (src.kind === 'monster') return [SOURCE_ICON.monster, 'Defeat a ' + src.name + pct(src.chance), where(src.zones)];
            if (src.kind === 'elite') return [SOURCE_ICON.elite, src.name + ', an elite' + pct(src.chance), where(src.zones)];
            if (src.kind === 'boss') return [SOURCE_ICON.boss, src.name + (src.first ? ', the first time you beat it' : pct(src.chance)), where(src.zones) + ' boss'];
            if (src.kind === 'craft') return [D.STATIONS[src.station].icon, src.name + ': ' + Object.entries(src.inputs).map(([k, n]) => n + ' ' + matName(k)).join(' + ') + (src.n > 1 ? ' makes ' + src.n : ''), 'in town'];
            return [SOURCE_ICON.trader, 'Buy ' + src.n + ' for ♦ ' + fmt(src.price), 'the Trader, in town'];
        });
    }
    function matTipHtml(id) {
        const s = game().state, m = D.MATERIALS_BY_ID[id] || D.CONSUMABLES_BY_ID[id];
        if (!m) return '';
        const kind = { raw: 'Gathered', part: 'Part', bar: 'Bar', plank: 'Plank', key: 'Key', trophy: 'Boss trophy' }[m.kind] || 'Supply';
        const have = W.count(s, id), carried = (s.bag && s.bag[id]) || 0;
        const lines = sourceLines(id);
        return `<div class="w-tip-head"><span class="w-mat-ico" style="--c:${m.color || '#888'}">${m.icon || ''}</span><div><b>${esc(m.name)}</b><small>${kind}</small></div></div>
            <div class="w-tip-have">You have <b>${fmt(have)}</b>${carried ? ` (${fmt(carried)} carried)` : ''}</div>
            <div class="w-tip-h">Where to get it</div>
            ${lines.length ? `<ul>${lines.map(([ico, what, at]) => `<li><span>${ico}</span><span>${esc(what)}${at ? `<small>${esc(at)}</small>` : ''}</span></li>`).join('')}</ul>` : '<p class="muted">Nowhere yet.</p>'}
            ${m.sell ? `<div class="w-tip-foot">The Trader pays ♦ ${fmt(m.sell)} each</div>` : ''}`;
    }
    let tipEl = null, tipFor = null;
    function showTip(el) {
        const html = matTipHtml(el.dataset.mat);
        if (!html) return;
        if (!tipEl) { tipEl = document.createElement('div'); tipEl.className = 'w-tip'; tipEl.id = 'wTip'; tipEl.setAttribute('role', 'tooltip'); document.body.appendChild(tipEl); }
        if (tipFor && tipFor !== el) tipFor.removeAttribute('aria-describedby');
        tipFor = el;
        el.setAttribute('aria-describedby', 'wTip');
        tipEl.innerHTML = html;
        tipEl.hidden = false;
        const r = el.getBoundingClientRect(), tw = tipEl.offsetWidth, th = tipEl.offsetHeight;
        let y = r.top - th - 8;
        if (y < 8) y = Math.min(window.innerHeight - th - 8, r.bottom + 8);
        tipEl.style.left = Math.max(8, Math.min(window.innerWidth - tw - 8, r.left + r.width / 2 - tw / 2)) + 'px';
        tipEl.style.top = Math.max(8, y) + 'px';
    }
    function hideTip() {
        if (tipEl) tipEl.hidden = true;
        if (tipFor) tipFor.removeAttribute('aria-describedby');
        tipFor = null;
    }
    const matEl = (ev) => (ev.target && ev.target.closest ? ev.target.closest('[data-mat]') : null);
    document.addEventListener('mouseover', (ev) => { const el = matEl(ev); if (el) { if (el !== tipFor) showTip(el); } else if (tipFor) hideTip(); });
    document.addEventListener('focusin', (ev) => { const el = matEl(ev); if (el) showTip(el); else if (tipFor) hideTip(); });
    // a tap shows it (there is no hover on touch screens); any other press hides it
    document.addEventListener('pointerdown', (ev) => { const el = matEl(ev); if (el && ev.pointerType !== 'mouse' && el !== tipFor) showTip(el); else hideTip(); }, true);
    document.addEventListener('keydown', (ev) => { if (ev.key === 'Escape') hideTip(); }, true);
    function statLine(base, it) {
        const st = it ? W.gearStats(it) : null;
        const out = [];
        if (base.slot === 'weapon') {
            out.push(`<span>Damage <b>${(st ? st.dmg : base.dmg).toFixed(1)}</b></span>`);
            if (base.tool) out.push(`<span>${base.cls === 'axe' ? 'Chops' : 'Mines'} tier <b>${base.tool}</b></span>`);
            if (base.burn) out.push('<span>Burns</span>'); if (base.chill) out.push('<span>Chills</span>');
        } else if (base.slot === 'ring') {
            out.push(`<span>${esc(base.desc)}</span>`);
        } else if (base.slot === 'offhand') {
            const ss = st || W.gearStats({ base: base.id, score: 40, aff: [] });
            out.push(`<span>Blocks <b>${Math.round(ss.block * 100)}%</b></span>`, `<span>Covers <b>${Math.round(ss.arc * 180 / Math.PI)}°</b></span>`, `<span>Stability <b>${ss.stab.toFixed(2)}</b></span>`, `<span>Parry window <b>${Math.round(ss.parry * 1000)} ms</b></span>`);
        } else {
            out.push(`<span>Armor <b>${Math.round(st ? st.armor : base.armor)}</b></span>`, `<span>HP <b>+${Math.round(st ? st.hp : base.hp)}</b></span>`);
            if (base.speed) out.push(`<span>Speed <b>+${Math.round((st ? st.speed : base.speed) * 100)}%</b></span>`);
            if (base.fireResist) out.push('<span>Fire resist</span>');
        }
        if (it && it.aff && it.aff.length) out.push(...it.aff.map(a => `<span style="color:#ffe7a3">${esc(D.AFFIXES[a].name)}: ${esc(D.AFFIXES[a].desc)}</span>`));
        return `<div class="w-card-stats">${out.join('')}</div>`;
    }
    function tabs(list, cur, onPick, labels) {
        return `<div class="w-tabs" role="tablist">${list.map(t => `<button class="w-tab${t === cur ? ' is-on' : ''}" role="tab" aria-selected="${t === cur}" data-tab="${t}">${esc(labels[t] || t)}</button>`).join('')}</div>`;
    }
    function wireTabs(body, onPick) { body.querySelectorAll('[data-tab]').forEach(b => b.addEventListener('click', () => onPick(b.dataset.tab))); }
    function on(body, sel, fn) { body.querySelectorAll(sel).forEach(el => el.addEventListener('click', (ev) => fn(el.dataset, el, ev))); }
    function maxZoneTier(s) { return Math.max(1, ...D.ZONE_ORDER.filter(z => s.unlocked.zones[z]).map(z => D.ZONES[z].tier)); }

    // ---------------- bag ----------------
    // Gear: what you wear and hold up top, the rest in the backpack below (filtered and sorted). Materials: grouped or
    // sorted tiles; hovering one (or any material in a recipe) says where it comes from (matTip).
    let bagTab = 'gear', confirmSalvage = 0, gearSort = 'best', gearFilter = 'all', matSort = 'kind';
    const SLOT_NAMES = { helmet: 'Helmet', chest: 'Chest', boots: 'Boots', ring: 'Ring', offhand: 'Shield' };
    const GEAR_FILTERS = { all: 'All', weapon: 'Weapons', tool: 'Tools', armor: 'Armor', offhand: 'Shields', ring: 'Rings' };
    const GEAR_SORTS = { best: 'Best first', quality: 'Quality', newest: 'Newest', type: 'Type', name: 'Name' };
    const TYPE_ORDER = ['sword', 'dagger', 'spear', 'bow', 'axe', 'pickaxe', 'helmet', 'chest', 'boots', 'offhand', 'ring'];
    const MAT_SORTS = { kind: 'Kind', amount: 'Amount', name: 'Name', value: 'Sell value' };
    const MAT_KINDS = { raw: 'Gathered', bar: 'Bars', plank: 'Planks', part: 'Monster parts and crafted parts', trophy: 'Boss trophies (the Trader pays well)', key: 'Keys' };
    const gearGroup = (b) => (b.slot === 'weapon' ? (b.cls === 'axe' || b.cls === 'pickaxe' ? 'tool' : 'weapon') : b.slot === 'helmet' || b.slot === 'chest' || b.slot === 'boots' ? 'armor' : b.slot);
    const typeKey = (b) => (b.slot === 'weapon' ? b.cls : b.slot);
    function sortGear(list, by) {
        const out = list.slice();
        if (by === 'name') return out.sort((a, b) => W.gearName(a).localeCompare(W.gearName(b)));
        const key = {
            best: (it) => -(W.baseOf(it).tier * 1000 + it.score),
            quality: (it) => -(it.score * 100 + W.baseOf(it).tier),
            newest: (it) => -it.uid,
            type: (it) => TYPE_ORDER.indexOf(typeKey(W.baseOf(it))) * 100000 - W.baseOf(it).tier * 1000 - it.score,
        }[by] || ((it) => 0);
        return out.sort((a, b) => key(a) - key(b));
    }
    // How a backpack piece compares with what you have on: armor and shields against the one worn in that slot, weapons
    // and tools against the best of the same kind on the hotbar
    function compareHtml(s, it) {
        const b = W.baseOf(it), st = W.gearStats(it);
        const chip = (d, what, digits = 0) => {
            const v = Number(d.toFixed(digits));
            if (!v) return `<span class="w-cmp is-same">= same ${what}</span>`;
            return `<span class="w-cmp ${v > 0 ? 'is-up' : 'is-down'}">${v > 0 ? '▲ +' : '▼ '}${v} ${what}</span>`;
        };
        if (b.slot === 'weapon') {
            const same = s.hotbar.map(u => W.findGear(s, u)).filter(x => x && W.baseOf(x).cls === b.cls);
            if (!same.length) return `<span class="w-cmp is-new">No ${esc(b.cls)} on your hotbar</span>`;
            return chip(st.dmg - Math.max(...same.map(x => W.gearStats(x).dmg)), 'damage', 1);
        }
        if (b.slot === 'ring') return '';
        const worn = W.findGear(s, s.equip[b.slot]);
        if (!worn) return `<span class="w-cmp is-new">Nothing worn there</span>`;
        const ws = W.gearStats(worn);
        if (b.slot === 'offhand') return chip((st.block - ws.block) * 100, '% block');
        return chip(st.armor - ws.armor, 'armor') + (Math.round(st.hp - ws.hp) ? chip(st.hp - ws.hp, 'HP') : '');
    }
    function slotRow(s, slot) {
        const it = W.findGear(s, s.equip[slot]), b = W.baseOf(it), q = it ? W.qualityOf(it.score) : null;
        return `<div class="w-slotrow${it ? '' : ' is-empty'}" style="--q:${q ? q.color : 'var(--border-strong)'}">
            <div class="w-slotrow-ico">${it ? ICONS[b.cls] : `<span class="ghost">${ICONS[slot]}</span>`}</div>
            <div class="w-slotrow-main"><small>${SLOT_NAMES[slot]}</small>${it ? `<b style="color:${q.color}">${esc(W.gearName(it))}</b>${statLine(b, it)}` : '<span class="muted">Empty</span>'}</div>
            ${it ? `<button class="btn btn-sm btn-ghost" data-equip="${it.uid}">Take off</button>`
                : `<button class="btn btn-sm btn-ghost" data-show="${slot === 'offhand' || slot === 'ring' ? slot : 'armor'}">Find one</button>`}
        </div>`;
    }
    function hotbarRow(s, i) {
        const it = W.findGear(s, s.hotbar[i]), b = W.baseOf(it), q = it ? W.qualityOf(it.score) : null;
        return `<div class="w-slotrow${it ? '' : ' is-empty'}${s.sel === i ? ' is-sel' : ''}" style="--q:${q ? q.color : 'var(--border-strong)'}">
            <div class="w-slotrow-ico"><span class="k">${i + 1}</span>${it ? ICONS[b.cls] : ''}</div>
            <div class="w-slotrow-main"><small>Slot ${i + 1}${s.sel === i ? ' · in hand' : ''}</small>${it ? `<b style="color:${q.color}">${esc(W.gearName(it))}</b>${statLine(b, it)}` : '<span class="muted">Empty</span>'}</div>
            ${it ? `<button class="btn btn-sm btn-ghost" data-equip="${it.uid}">Off hotbar</button>` : ''}
        </div>`;
    }
    function gearTabHtml(g, s) {
        const ps = g.pstats;
        let html = `<div class="w-equip">
            <section class="w-panel"><h3>Armor <span>${ICONS.chest}</span></h3>${W.SLOTS.map(sl => slotRow(s, sl)).join('')}
                <div class="w-totals"><span>Armor <b>${ps.armor}</b> (${Math.round(100 - 100 * 100 / (100 + ps.armor))}% less damage)</span><span>Max HP <b>${ps.maxHp}</b></span><span>Speed <b>${Math.round(ps.speed * 100)}%</b></span></div></section>
            <section class="w-panel"><h3>Hotbar <span class="muted">keys 1–${D.RULES.hotbarSlots}</span></h3>${s.hotbar.map((_, i) => hotbarRow(s, i)).join('')}</section>
        </div>`;
        const pack = s.gear.filter(it => !W.isEquipped(s, it.uid));
        const counts = {};
        for (const it of pack) { const k = gearGroup(W.baseOf(it)); counts[k] = (counts[k] || 0) + 1; }
        counts.all = pack.length;
        const shown = sortGear(pack.filter(it => gearFilter === 'all' || gearGroup(W.baseOf(it)) === gearFilter), gearSort);
        html += `<div class="w-bag-head"><h3>Backpack <span class="muted">${s.gear.length} / ${D.RULES.maxGear} pieces</span></h3>
            <div class="w-bag-tools"><div class="w-chips" role="group" aria-label="Show">${Object.entries(GEAR_FILTERS).map(([k, label]) =>
                `<button class="w-chip${gearFilter === k ? ' is-on' : ''}" data-filter="${k}" aria-pressed="${gearFilter === k}">${label}<small>${counts[k] || 0}</small></button>`).join('')}</div>
            <label class="w-sort">Sort <select id="gearSort">${Object.entries(GEAR_SORTS).map(([k, label]) => `<option value="${k}" ${gearSort === k ? 'selected' : ''}>${label}</option>`).join('')}</select></label></div></div>`;
        if (!shown.length) html += `<p class="w-empty">${pack.length ? 'Nothing of that kind in your backpack.' : 'Your backpack is empty: everything you own is on you. Craft gear at the Forge and Workbench.'}</p>`;
        html += `<div class="w-grid">${shown.map(it => {
            const b = W.baseOf(it), q = W.qualityOf(it.score), weapon = b.slot === 'weapon';
            return `<div class="w-card w-item" style="--q:${q.color}">
                <div class="w-card-top"><div class="w-card-ico">${ICONS[b.cls]}</div>
                <div><div class="w-card-name" style="color:${q.color}">${esc(W.gearName(it))}</div><div class="w-card-sub"><span class="w-qual">${esc(q.name)}</span> · tier ${b.tier} · score ${it.score}</div></div></div>
                ${statLine(b, it)}
                <div class="w-cmps">${compareHtml(s, it)}</div>
                <div class="w-card-actions">
                    <button class="btn btn-sm btn-primary" data-equip="${it.uid}">${weapon ? 'To hotbar' : 'Wear'}</button>
                    <button class="btn btn-sm btn-danger" data-salvage="${it.uid}">${confirmSalvage === it.uid ? 'Sure? Salvage' : 'Salvage'}</button>
                </div></div>`;
        }).join('')}</div>`;
        return html;
    }
    function matTile(s, m, n, extra) {
        const carried = s.bag[m.id] || 0;
        const sub = carried ? `<small class="bag">${fmt(carried)} carried</small>` : m.sell ? `<small>♦ ${fmt(m.sell)} each</small>` : extra ? `<small>${extra}</small>` : '';
        return `<div class="w-mat" data-mat="${m.id}" tabindex="0" style="--c:${m.color || '#888'}"><span class="w-mat-ico">${m.icon || ''}</span>
            <span class="w-mat-name">${esc(m.name)}${sub}</span><b>${fmt(n)}</b></div>`;
    }
    function matsTabHtml(s) {
        const ids = new Set(Object.keys(Object.assign({}, s.mats, s.bag)));
        const owned = D.MATERIALS.filter(m => ids.has(m.id) && W.count(s, m.id) > 0);
        let html = `<div class="w-bag-tools"><p class="w-note" style="margin:0">Hover over a material to see where it comes from. <b style="color:#ffd27a">Carried</b> ones were picked up since you were last in town: part of them drops if you are knocked out.</p>
            <label class="w-sort">Sort <select id="matSort">${Object.entries(MAT_SORTS).map(([k, label]) => `<option value="${k}" ${matSort === k ? 'selected' : ''}>${label}</option>`).join('')}</select></label></div>`;
        if (!owned.length) html += '<p class="w-empty">Nothing yet. Chop trees, mine rocks and defeat monsters.</p>';
        else if (matSort === 'kind') {
            for (const kind of Object.keys(MAT_KINDS)) {
                const list = owned.filter(m => m.kind === kind);
                if (list.length) html += `<div class="w-mat-group"><h4>${MAT_KINDS[kind]}</h4><div class="w-mats">${list.map(m => matTile(s, m, W.count(s, m.id))).join('')}</div></div>`;
            }
        } else {
            const key = { amount: (m) => -W.count(s, m.id), name: null, value: (m) => -(m.sell || 0) * W.count(s, m.id) }[matSort];
            const list = key ? owned.slice().sort((a, b) => key(a) - key(b) || a.name.localeCompare(b.name)) : owned.slice().sort((a, b) => a.name.localeCompare(b.name));
            html += `<div class="w-mats">${list.map(m => matTile(s, m, W.count(s, m.id), matSort === 'value' && m.sell ? '♦ ' + fmt(m.sell * W.count(s, m.id)) + ' in all' : '')).join('')}</div>`;
        }
        html += `<div class="w-mat-group"><h4>Supplies</h4><div class="w-mats">${D.CONSUMABLES.map(c => matTile(s, c, s.cons[c.id] || 0, c.heal ? (c.heal >= 999 ? 'heals fully' : 'heals ' + c.heal) : '')).join('')}</div></div>`;
        return html;
    }
    // Skins: any main-image skin unlocked in the game, worn here (and seen by other players online)
    function skinsTabHtml(s) {
        const Skins = window.WHSkins, ms = WHW.mainSave(), worn = WHW.wornSkin();
        const gameSkin = String(ms.equippedShopImage || Skins.DEFAULT);
        const following = !s.skin || !Skins.owns(ms, s.skin);
        const nameOf = (path) => (Skins.byPath(path) || { title: 'What Happened' }).title;
        const card = (key, path, title, sub, on, locked) => `<button type="button" class="w-skin${on ? ' is-on' : ''}${locked ? ' is-locked' : ''}" data-skin="${key}" ${locked ? 'disabled' : ''} aria-pressed="${on}">
            <img src="${Skins.thumb(path)}" alt="" loading="lazy"><b>${esc(title)}</b><small>${sub}</small></button>`;
        const owned = Skins.SKINS.filter(k => Skins.owns(ms, k.path)), locked = Skins.SKINS.filter(k => !Skins.owns(ms, k.path));
        let html = `<p class="w-note">Wear any skin you have unlocked in the game. Other players see it too. Unlock more in the game's shop.</p><div class="w-skins">`;
        html += card('game', gameSkin, 'Same as the game', 'Now: ' + esc(nameOf(gameSkin)), following, false);
        html += card(Skins.DEFAULT, Skins.DEFAULT, 'What Happened', !following && worn === Skins.DEFAULT ? 'Wearing' : 'The original', !following && s.skin === Skins.DEFAULT, false);
        for (const k of owned) html += card(k.path, k.path, k.title, !following && worn === k.path ? 'Wearing' : 'Unlocked', !following && worn === k.path, false);
        html += '</div>';
        if (locked.length) html += `<div class="w-mat-group" style="margin-top:14px"><h4>Not unlocked yet (${locked.length})</h4><div class="w-skins">${locked.map(k =>
            card(k.path, k.path, k.title, k.cost === null ? esc(k.unlockText || 'Unlocked in the game') : '💎 ' + k.cost + ' gems in the shop', false, true)).join('')}</div></div>`;
        return html;
    }
    function openBag(tab) {
        if (tab) bagTab = tab;
        const body = modal('Bag', '', { wide: true, render: renderBagBody });
        renderBagBody(body);
    }
    function renderBagBody() {
        const body = $('wModalBody');
        const g = game(), s = g.state;
        hideTip();
        let html = tabs(['gear', 'materials', 'skins', 'stats'], bagTab, null, { gear: `Gear (${s.gear.length}/${D.RULES.maxGear})`, materials: 'Materials', skins: 'Skins', stats: 'Stats & rewards' });
        if (bagTab === 'gear') html += gearTabHtml(g, s);
        else if (bagTab === 'materials') html += matsTabHtml(s);
        else if (bagTab === 'skins') html += skinsTabHtml(s);
        else {
            const ps = g.pstats, now = Date.now();
            W.refreshCaps(s, now);
            const pend = Bridge.pending(localStorage, 0);
            const st = s.stats;
            html += `<div class="w-section"><h3>You</h3><div class="w-card-stats" style="font-size:14px">
                <span>Max HP <b>${ps.maxHp}</b></span><span>Armor <b>${ps.armor}</b> (${Math.round(100 - 100 * 100 / (100 + ps.armor))}% less damage)</span>
                <span>Speed <b>${Math.round(ps.speed * 100)}%</b></span><span>Ruby bonus <b>+${Math.round(ps.rubies * 100)}%</b></span><span>Luck <b>+${Math.round(ps.luck * 100)}%</b></span></div></div>
                <div class="w-section"><h3>Rewards for your game</h3><p class="w-note">
                Gems sent today: <b>${s.caps.gems} / ${D.CAPS.gemsPerDay}</b> · Golden What Happened today: <b>${s.caps.golden} / ${D.CAPS.goldenPerDay}</b><br>
                Lootbox crafting this week: <b>${s.caps.boxPts} / ${D.CAPS.boxPointsPerWeek}</b> points (Wooden 1, Iron 3, Golden 9, Diamond 27)<br>
                ${pend.entries.length ? `Waiting to be collected: <b>${esc(Bridge.describe(pend.totals).replace('From the Wilds: ', ''))}</b>. They arrive the next time you open the game.` : 'Everything you earned has reached your game.'}
                </p></div>
                <div class="w-section"><h3>Journey</h3><div class="w-card-stats" style="font-size:13px">
                <span>Monsters <b>${fmt(st.kills)}</b></span><span>Elites <b>${fmt(st.elites)}</b></span><span>Bosses <b>${fmt(st.bossKills)}</b></span><span>Rivals beaten <b>${fmt(st.rivalsBeaten)}</b></span>
                <span>Ore mined <b>${fmt(st.mined)}</b></span><span>Trees chopped <b>${fmt(st.chopped)}</b></span><span>Things crafted <b>${fmt(st.crafted)}</b></span><span>Best craft <b>${st.bestScore}</b></span>
                <span>Legendaries <b>${fmt(st.legendaries)}</b></span><span>Rubies earned <b>${fmt(st.rubiesEarned)}</b></span><span>Knocked out <b>${fmt(st.deaths)}</b></span><span>Gems sent home <b>${fmt(st.gemsSent)}</b></span><span>Players beaten <b>${fmt(st.pvpWins || 0)}</b></span><span>Beaten by players <b>${fmt(st.pvpLosses || 0)}</b></span></div></div>`;
        }
        body.innerHTML = html;
        wireTabs(body, (t) => { bagTab = t; confirmSalvage = 0; renderBagBody(); });
        on(body, '[data-equip]', (d) => { WHW.actions.equip(Number(d.equip)); renderBagBody(); });
        on(body, '[data-salvage]', (d) => {
            const uid = Number(d.salvage);
            if (confirmSalvage !== uid) { confirmSalvage = uid; renderBagBody(); return; }
            confirmSalvage = 0;
            WHW.actions.salvage(uid);
            renderBagBody();
        });
        on(body, '[data-filter]', (d) => { gearFilter = d.filter; renderBagBody(); });
        on(body, '[data-skin]', (d) => { WHW.actions.setSkin(d.skin === 'game' ? null : d.skin); renderBagBody(); });
        on(body, '[data-show]', (d) => { gearFilter = d.show; renderBagBody(); const head = $('wModalBody').querySelector('.w-bag-head'); if (head) head.scrollIntoView({ block: 'start', behavior: 'smooth' }); });
        const gs = body.querySelector('#gearSort');
        if (gs) gs.addEventListener('change', () => { gearSort = gs.value; renderBagBody(); });
        const ms = body.querySelector('#matSort');
        if (ms) ms.addEventListener('change', () => { matSort = ms.value; renderBagBody(); });
    }

    // ---------------- stations ----------------
    let stationTab = {};
    function openStation(id) {
        if (id === 'trader') return openTrader();
        if (id === 'board') return openHelp();
        const st = D.STATIONS[id];
        stationTab[id] = stationTab[id] || STATION_TABS[id][0];
        const render = () => renderStation(id);
        modal(st.icon + ' ' + st.name, '', { wide: true, render });
        render();
    }
    function renderStation(id) {
        const body = $('wModalBody');
        const g = game(), s = g.state, now = Date.now();
        const tab = stationTab[id];
        const labels = { craft: id === 'altar' ? 'Rings' : 'Gear', basic: id === 'forge' ? 'Smelting' : id === 'altar' ? 'Potions' : 'Materials', reforge: 'Reforge', boxes: 'Lootboxes' };
        let html = tabs(STATION_TABS[id], tab, null, labels);
        html += `<p class="w-note">${esc(D.STATIONS[id].desc)}. ${tab === 'craft' || tab === 'boxes' || tab === 'reforge' ? 'Crafting plays a minigame: <b>the better you play, the better it turns out.</b> Materials and the ruby fee are paid when you start; quitting gives the materials back but not the fee. Try it free with <b>Practice</b>.' : 'Instant: no minigame.'}</p>`;
        if (tab === 'basic') {
            const list = D.BASIC_RECIPES.filter(r => r.station === id);
            html += `<div class="w-grid">${list.map(r => {
                const outId = Object.keys(r.out)[0];
                const can = W.has(s, r.in);
                let max = 0; while (max < 999 && W.has(s, r.in, max + 1)) max++;
                return `<div class="w-card"><div class="w-card-top"><div class="w-card-ico" style="border-color:${matColor(outId)}">${(D.CONSUMABLES_BY_ID[outId] || {}).icon || '<i class="w-dot" style="width:18px;height:18px;background:' + matColor(outId) + '"></i>'}</div>
                    <div><div class="w-card-name">${r.out[outId]} × ${esc(matName(outId))}</div><div class="w-card-sub">You have ${fmt(W.count(s, outId))}</div></div></div>
                    ${needHtml(s, r.in, 0)}
                    <div class="w-card-actions"><button class="btn btn-sm btn-primary" data-basic="${r.id}" data-times="1" ${can ? '' : 'disabled'}>Make 1</button>
                    <button class="btn btn-sm btn-ghost" data-basic="${r.id}" data-times="5" ${max >= 5 ? '' : 'disabled'}>Make 5</button>
                    <button class="btn btn-sm btn-ghost" data-basic="${r.id}" data-times="${max}" ${max > 1 ? '' : 'disabled'}>All (${max})</button></div></div>`;
            }).join('')}</div>`;
        } else if (tab === 'craft') {
            const top = maxZoneTier(s) + 1;
            const list = D.GEAR.filter(b => b.recipe && b.recipe.station === id && b.tier <= top).sort((a, b) => a.tier - b.tier || a.cls.localeCompare(b.cls));
            const hidden = D.GEAR.filter(b => b.recipe && b.recipe.station === id && b.tier > top).length;
            const card = (b) => {
                const c = W.canCraft(s, 'gear', b.id, now);
                const why = c.ok ? '' : c.reason === 'busy' ? 'Finish your other craft first' : c.reason === 'full' ? 'Your bag of gear is full' : '';
                return `<div class="w-card"><div class="w-card-top"><div class="w-card-ico" style="border-color:${D.TIERS[b.tier].color}">${ICONS[b.cls]}</div>
                    <div><div class="w-card-name">${esc(b.name)}</div><div class="w-card-sub">Tier ${b.tier} ${esc(b.slot === 'weapon' ? D.WEAPON_CLASSES[b.cls].name : b.slot)}</div></div></div>
                    ${statLine(b, null)}
                    ${needHtml(s, b.recipe.in, b.recipe.fee)}
                    ${why ? `<div class="w-card-sub" style="color:#ffb3bb">${esc(why)}</div>` : ''}
                    <div class="w-card-actions"><button class="btn btn-sm btn-gold" data-craft="${b.id}" ${c.ok ? '' : 'disabled'}>Craft</button>
                    <button class="btn btn-sm btn-ghost" data-practice="${b.tier}" data-bow="${b.cls === 'bow' ? 1 : ''}">Practice</button></div></div>`;
            };
            html += '<p class="w-note">Stats shown are for Common quality; a great minigame makes gear up to 1.75× stronger.</p>';
            for (let t = 1; t <= top; t++) {
                const tier = list.filter(b => b.tier === t);
                if (tier.length) html += `<div class="w-section"><h3 style="color:${D.TIERS[t].color}">Tier ${t} · ${esc(D.TIERS[t].name)}</h3><div class="w-grid">${tier.map(card).join('')}</div></div>`;
            }
            if (hidden) html += `<p class="muted">${hidden} more recipe${hidden > 1 ? 's' : ''} appear as you open new zones.</p>`;
        } else if (tab === 'boxes') {
            const left = W.boxAllowanceLeft(s, now);
            html += `<p class="w-note">Lootboxes made here go straight into <b>Items &amp; Charms</b> in your game. This week's lootbox allowance: <b>${left} / ${D.CAPS.boxPointsPerWeek}</b> points left (it resets on Monday). A score of 85+ can upgrade the box a tier; a very poor score drops it a tier.</p>`;
            html += `<div class="w-grid">${D.BOX_RECIPES.map(r => {
                const c = W.canCraft(s, 'box', r.id, now);
                const why = c.ok ? '' : c.reason === 'allowance' ? 'Not enough allowance left this week' : c.reason === 'busy' ? 'Finish your other craft first' : '';
                return `<div class="w-card"><div class="w-card-top"><div class="w-card-ico" style="border-color:${r.color}">🎁</div>
                    <div><div class="w-card-name" style="color:${r.color}">${esc(r.name)}</div><div class="w-card-sub">${r.pts} allowance point${r.pts > 1 ? 's' : ''}</div></div></div>
                    ${needHtml(s, r.in, r.fee)}
                    ${why ? `<div class="w-card-sub" style="color:#ffb3bb">${esc(why)}</div>` : ''}
                    <div class="w-card-actions"><button class="btn btn-sm btn-gold" data-box="${r.id}" ${c.ok ? '' : 'disabled'}>Craft</button>
                    <button class="btn btn-sm btn-ghost" data-practice="${r.tier + 1}">Practice</button></div></div>`;
            }).join('')}</div>`;
        } else if (tab === 'reforge') {
            const list = s.gear.filter(it => { const b = W.baseOf(it); return b.recipe && b.recipe.station === id; });
            html += `<p class="w-note">Play the minigame again for the ruby fee plus half the materials. You keep whichever score is better.</p>`;
            html += list.length ? `<div class="w-grid">${list.map(it => {
                const b = W.baseOf(it), q = W.qualityOf(it.score);
                const part = {}; for (const k in b.recipe.in) part[k] = Math.max(1, Math.ceil(b.recipe.in[k] * D.RULES.reforgeShare));
                const ok = !s.pendingCraft && s.rubies >= b.recipe.fee && W.has(s, part);
                return `<div class="w-card"><div class="w-card-top"><div class="w-card-ico" style="border-color:${q.color}">${ICONS[b.cls]}</div>
                    <div><div class="w-card-name" style="color:${q.color}">${esc(W.gearName(it))}</div><div class="w-card-sub">score ${it.score}</div></div></div>
                    ${needHtml(s, part, b.recipe.fee)}
                    <div class="w-card-actions"><button class="btn btn-sm btn-gold" data-reforge="${it.uid}" ${ok ? '' : 'disabled'}>Reforge</button></div></div>`;
            }).join('')}</div>` : '<p class="muted">Nothing from this station to reforge yet.</p>';
        }
        body.innerHTML = html;
        wireTabs(body, (t) => { stationTab[id] = t; renderStation(id); });
        on(body, '[data-basic]', (d) => { WHW.actions.craftBasic(d.basic, Number(d.times)); renderStation(id); });
        on(body, '[data-craft]', (d) => WHW.actions.startCraft('gear', d.craft));
        on(body, '[data-box]', (d) => WHW.actions.startCraft('box', d.box));
        on(body, '[data-reforge]', (d) => WHW.actions.reforge(Number(d.reforge)));
        on(body, '[data-practice]', (d) => WHW.actions.practice(id, Number(d.practice), !!d.bow));
    }
    // After a minigame: what came out
    function showResult(res, again) {
        const s = game().state;
        let html = '';
        const q = W.qualityOf(res.score);
        html += `<div class="w-result"><div class="score" style="color:${q.color}">${res.score}</div><div class="quality" style="color:${q.color}">${esc(q.name)}</div></div>`;
        if (res.kind === 'practice') {
            html += `<p class="w-note" style="text-align:center">Practice only: a real craft with this score would be <b style="color:${q.color}">${esc(q.name)}</b> (stats ×${W.qualityMult(res.score).toFixed(2)}).</p>`;
        } else if (res.kind === 'gear' && res.item) {
            const b = W.baseOf(res.item);
            html += `<div class="w-card" style="max-width:420px;margin:0 auto"><div class="w-card-top"><div class="w-card-ico" style="border-color:${q.color}">${ICONS[b.cls]}</div>
                <div><div class="w-card-name" style="color:${q.color}">${esc(W.gearName(res.item))}</div><div class="w-card-sub">Stats ×${W.qualityMult(res.score).toFixed(2)}</div></div></div>${statLine(b, res.item)}</div>`;
        } else if (res.kind === 'reforge') {
            html += `<p class="w-note" style="text-align:center">${res.improved ? `Better! <b>${esc(W.gearName(res.item))}</b> is now score ${res.item.score}.` : `Not better than the score it had (${res.item ? res.item.score : '?'}), so it stays as it was.`}</p>`;
        } else if (res.kind === 'box') {
            const shifted = res.tier - res.baseTier;
            html += `<p class="w-note" style="text-align:center">${shifted > 0 ? '<b style="color:#ffc83d">Masterful!</b> It came out a tier better: ' : shifted < 0 ? 'A rough job: it came out a tier lower: ' : ''}<b style="color:${D.BOX_COLORS[res.tier]}">${esc(D.BOX_NAMES[res.tier])}</b> is on its way to your game's Items.</p>`;
        }
        html += `<div class="w-row" style="justify-content:center;margin-top:12px">${again ? '<button class="btn btn-ghost" id="resAgain">Practice again</button>' : ''}<button class="btn btn-primary" id="resOk">Done</button></div>`;
        const body = modal(res.kind === 'practice' ? 'Practice' : 'Crafted', html, { onClose: res.onClose });
        body.querySelector('#resOk').addEventListener('click', () => closeModal());
        if (again) body.querySelector('#resAgain').addEventListener('click', again);
    }

    // ---------------- trader ----------------
    let traderTab = 'sell';
    function openTrader(tab) {
        if (tab) traderTab = tab;
        modal('💰 Trader', '', { wide: true, render: renderTrader });
        renderTrader();
    }
    function renderTrader() {
        const body = $('wModalBody');
        const g = game(), s = g.state, now = Date.now();
        W.refreshCaps(s, now);
        let html = tabs(['sell', 'buy', 'exchange'], traderTab, null, { sell: 'Sell', buy: 'Buy', exchange: 'Exchange' });
        if (traderTab === 'sell') {
            const ids = D.MATERIALS.filter(m => m.sell && W.count(s, m.id) > 0);
            const label = (m) => (m.kind === 'trophy' ? '🏆 ' : '') + esc(m.name);
            html += `<p class="w-note">The Trader pays rubies for materials. Keep what you need for crafting!</p>`;
            html += ids.length ? `<div class="w-grid">${ids.map(m => `<div class="w-card"><div class="w-card-top" data-mat="${m.id}" tabindex="0"><span class="w-mat-ico" style="--c:${m.color}">${m.icon || ''}</span><div><div class="w-card-name">${label(m)}</div><div class="w-card-sub">You have ${fmt(W.count(s, m.id))} · ♦ ${m.sell} each</div></div></div>
                <div class="w-card-actions"><button class="btn btn-sm btn-ghost" data-sell="${m.id}" data-n="1">Sell 1</button><button class="btn btn-sm btn-ghost" data-sell="${m.id}" data-n="10">Sell 10</button><button class="btn btn-sm btn-gold" data-sell="${m.id}" data-n="${W.count(s, m.id)}">Sell all (♦ ${fmt(m.sell * W.count(s, m.id))})</button></div></div>`).join('')}</div>` : '<p class="muted">You have nothing to sell.</p>';
        } else if (traderTab === 'buy') {
            html += `<div class="w-grid">${D.TRADER_STOCK.map(it => {
                const name = it.gear ? D.GEAR_BY_ID[it.gear].name : Object.entries(it.give).map(([id, n]) => `${n} × ${matName(id)}`).join(', ');
                const icon = it.gear ? ICONS[D.GEAR_BY_ID[it.gear].cls] : (D.CONSUMABLES_BY_ID[Object.keys(it.give)[0]] || {}).icon || '📦';
                return `<div class="w-card"><div class="w-card-top"><div class="w-card-ico">${icon}</div><div><div class="w-card-name">${esc(name)}</div><div class="w-card-sub">♦ ${fmt(it.price)}</div></div></div>
                    <div class="w-card-actions"><button class="btn btn-sm btn-primary" data-buy="${it.id}" ${s.rubies >= it.price ? '' : 'disabled'}>Buy</button></div></div>`;
            }).join('')}</div>`;
        } else {
            const ex = D.CAPS.exchange;
            const row = (kind, label, cost, used, capOk) => `<div class="w-card"><div class="w-card-top"><div class="w-card-ico">${kind === 'gems' ? '<img src="mainimage/gem.png" alt="" width="24" height="24">' : '<img src="mainimage/thumbs/goldwh.webp" alt="" width="28" height="28" style="border-radius:50%">'}</div>
                <div><div class="w-card-name">${esc(label)}</div><div class="w-card-sub">♦ ${fmt(cost)} · once a week</div></div></div>
                <div class="w-card-actions"><button class="btn btn-sm btn-gold" data-ex="${kind}" ${!used && capOk && s.rubies >= cost ? '' : 'disabled'}>${used ? 'Done this week' : !capOk ? "Today's limit reached" : 'Exchange'}</button></div></div>`;
            html += `<p class="w-note">Rubies can buy a little of the main game's treasures. Whatever you get here arrives in your game the next time you open it.<br>
                Today: gems <b>${s.caps.gems}/${D.CAPS.gemsPerDay}</b>, Golden What Happened <b>${s.caps.golden}/${D.CAPS.goldenPerDay}</b> from the Wilds.<br>
                The other way round: trade Golden What Happened for rubies in the game's <b>Divine</b> menu (1 Golden = ♦ ${fmt(Bridge.GOLDEN_RUBIES)}). They arrive here straight away.</p>`;
            html += `<div class="w-grid">${row('gems', ex.gems.gems + ' gems', ex.gems.cost, !!s.caps.exGems, W.gemsLeftToday(s, now) >= ex.gems.gems)}${row('golden', ex.golden.golden + ' Golden What Happened', ex.golden.cost, !!s.caps.exGolden, W.goldenLeftToday(s, now) >= ex.golden.golden)}</div>`;
        }
        body.innerHTML = html;
        wireTabs(body, (t) => { traderTab = t; renderTrader(); });
        on(body, '[data-sell]', (d) => { WHW.actions.sell(d.sell, Number(d.n)); renderTrader(); });
        on(body, '[data-buy]', (d) => { WHW.actions.buy(d.buy); renderTrader(); });
        on(body, '[data-ex]', (d) => { WHW.actions.exchange(d.ex); renderTrader(); });
    }

    // ---------------- travel ----------------
    function openPortal(zoneId) {
        const g = game(), s = g.state, z = D.ZONES[zoneId];
        const open = !!s.unlocked.zones[zoneId];
        const gateMat = z.gate ? D.MATERIALS_BY_ID[z.gate] : null;
        const prevBoss = z.gate ? Object.values(D.BOSSES).find(b => b.sigil === z.gate) : null;
        const camp = !!s.unlocked.camps[zoneId];
        const html = `<div class="w-zone-card"><img src="${z.bg}" alt=""><div>
            <div class="w-card-name">${esc(z.name)}</div><div class="w-card-sub">Tier ${z.tier} zone · Boss: ${esc(D.BOSSES[z.boss].name)}</div>
            <div class="w-card-stats">${Object.keys(z.nodes).map(n => `<span>${esc(D.NODES[n].name)}</span>`).join('')}</div></div></div>
            ${open ? '' : `<p class="w-note" style="color:#ffb3bb">Locked. The gate opens with the <b>${esc(gateMat.name)}</b>, dropped by ${esc(prevBoss.name)}.</p>`}
            <div class="w-row" style="margin-top:12px"><button class="btn btn-primary" id="goGate" ${open ? '' : 'disabled'}>Enter</button>
            ${camp ? '<button class="btn btn-ghost" id="goCamp">Enter at the camp</button>' : ''}</div>`;
        const body = modal('Travel', html);
        const go = body.querySelector('#goGate');
        if (go) go.addEventListener('click', () => { closeModal(); WHW.actions.travel(zoneId, false); });
        const gc = body.querySelector('#goCamp');
        if (gc) gc.addEventListener('click', () => { closeModal(); WHW.actions.travel(zoneId, true); });
    }
    function openMap() {
        const g = game(), s = g.state;
        const zones = D.ZONE_ORDER.map(id => {
            const z = D.ZONES[id], open = !!s.unlocked.zones[id];
            const boss = s.bosses[z.boss];
            return `<div class="w-card${open ? '' : ' is-locked'}"><div class="w-zone-card"><img src="${z.bg}" alt=""><div><div class="w-card-name">${open ? '' : '🔒 '}${esc(z.name)}</div>
                <div class="w-card-sub">Tier ${z.tier} · ${boss && boss.kills ? '✅ ' + esc(D.BOSSES[z.boss].name) + ' defeated' : esc(D.BOSSES[z.boss].name) + ' awaits'}${s.unlocked.camps[id] ? ' · camp found' : ''}</div>
                <div class="w-card-stats">${Object.keys(z.nodes).map(n => `<span>${esc(D.NODES[n].name)}</span>`).join('')}</div></div></div></div>`;
        }).join('');
        const body = modal('Map', `<div class="w-row" style="align-items:flex-start;gap:16px"><canvas id="bigMap" width="320" height="320" style="border-radius:12px;border:1px solid var(--border-strong);image-rendering:pixelated;max-width:100%"></canvas>
            <div style="flex:1;min-width:240px;display:flex;flex-direction:column;gap:8px">${zones}</div></div>
            <p class="w-note">Every zone is reached through Wildgate Town's gates. Each boss drops the sigil that opens the next gate. Find a zone's camp once to travel straight to it.</p>`, { wide: true });
        WHW.drawMinimap && WHW.drawMinimap(body.querySelector('#bigMap'), true);
    }

    // ---------------- help, settings, death ----------------
    function openHelp() {
        modal('📜 How the Wilds work', `<div class="w-help">
            <h3>Moving and fighting</h3>
            <p><kbd>W</kbd><kbd>A</kbd><kbd>S</kbd><kbd>D</kbd> to move, <kbd>Space</kbd> or <kbd>Shift</kbd> to dash (you can't be hit during a dash), <kbd>1</kbd>–<kbd>5</kbd> or the mouse wheel to switch what you hold, <kbd>Z</kbd> for a potion (then a short wait before the next: longer after stronger ones), <kbd>E</kbd> to use things, <kbd>I</kbd> for your bag, <kbd>M</kbd> for the map.</p>
            <p><b>Your weapon follows the mouse.</b> To hit hard you have to <b>swing</b>: move the mouse quickly across the target, like the real thing. A slow drag just bumps it. The swing meter under your hotbar shows how fast your blade is moving: past the first mark it hurts, past the second it's a <b style="color:#ffc83d">Perfect</b> hit. Slashing back and forth builds a combo; the tip of the blade hits harder than the hilt. Heavy weapons like axes turn slower but hit harder.</p>
            <ul><li><b>Shields</b>: hold <kbd>right-click</kbd> (or <kbd>F</kbd>) to raise your shield toward the mouse. Hits from in front are mostly blocked but cost stamina; if you run out, your guard breaks. Raise it <i>just</i> as a hit lands to <b style="color:#ffc83d">parry</b>: no damage, the attacker is stunned and projectiles fly back. You can't attack with your weapon while blocking. Falling rocks and meteors can't be blocked.</li>
            <li><b>Quests</b>: four townsfolk stand around the plaza. Talk to them (<kbd>E</kbd>) for quests that pay rubies: a story for each, then a new daily quest every day. A <b style="color:#ffc83d">!</b> over someone's head means a new quest, a <b style="color:#ffc83d">?</b> means one is ready to hand in.</li>
            <li><b>The Hall of Gods</b>: the dark temple north of the plaza. Its six statues take offerings of rubies and materials (boss trophies too, at some levels), and each level blesses your clicker game: more CPS, click power, crits, offline earnings, gems or Golden. Bosses also drop trophies the Trader pays well for.</li>
            <li><b>Classes</b> (<kbd>K</kbd>): you start as a Warrior. Unlock the Guardian, Rogue, Ranger, Lancer and Mystic by completing their challenges, and change class in town. Each class has a bonus and its own skill tree of abilities and perks, learned with rubies from the top of each branch down (some after beating a boss). Equip up to three abilities on <kbd>R</kbd> <kbd>Q</kbd> <kbd>C</kbd>; an ability you equip outside town starts on its cooldown. Abilities hurt monsters, bosses and rivals, and other players outside town (at PvP strength; stuns on players are shorter).</li>
            <li><b>Spears</b>: flick the mouse outward from your character to thrust, then pull back. A thrust hits harder the faster you are moving toward the target: dash into it for up to +90%. The Lancer class builds on this.</li>
            <li><b>Bows</b>: press anywhere, pull the mouse <i>away</i> from where you want to shoot, and let go. Hold a full draw briefly for a steady shot. They need arrows.</li>
            <li><b>Daggers</b> are quick and hit much harder from behind.</li></ul>
            <h3>Gathering</h3>
            <p>Swing an <b>axe</b> at trees and a <b>pickaxe</b> at rocks and ores. Each zone has its own materials, and the best ores sit deeper in. Hit the <b style="color:#ffe14d">glowing crack</b> for double progress and a chance of extra. Better tools are needed for harder ores. Pick herbs and fiber by holding <kbd>E</kbd>.</p>
            <h3>Crafting</h3>
            <p>Smelt ore into bars at the Forge, cut planks and leather at the Workbench, then craft gear. Every piece of gear is made with a <b>minigame</b>: the better you play, the better its quality, from Crude to <b style="color:#ffc83d">Legendary</b> (up to 1.75× the stats, plus bonus traits). Use <b>Practice</b> to learn the minigames for free.</p>
            <h3>Rubies and your game</h3>
            <p>Rubies are the money of the Wilds: earn them from monsters, ruby veins, bosses and the Trader, and spend them on crafting fees and supplies. You can also send treasures home: <b>lootboxes</b> crafted at the Rune Altar, plus <b>gems</b> and <b>Golden What Happened</b> from bosses, elites, ruby veins and the Trader's weekly exchange. They arrive the next time you open the game. Rubies can come the other way too: trade Golden What Happened in the game's Divine menu, or redeem a rubies code in its Settings.</p>
            <h3>Online</h3>
            <p>Other players in the same zone appear live (🌐 at the top shows how many). Press <kbd>Enter</kbd> to chat or send an emote. <b>Outside town, players can fight each other</b> with the same swings, shields and parries; you're protected for a few seconds after arriving. A player knocked out by another drops part of what they carry: the winner gets first pick, then anyone can grab it. Bosses are shared: everyone in the arena fights the same one, and everyone who did enough damage gets the reward. Monsters are your own. You can play offline from the 🌐 menu.</p>
            <h3>Danger</h3>
            <p>Watch for <b style="color:#ff6b7a">red shapes</b>: that's where an attack is about to land. Dash out of them. If you're knocked out, part of what you've carried since leaving town drops where you fell; go back and pick it up. Rubies and gear are never lost. Rival adventurers roam each zone and fight with the same weapons you do.</p>
        </div>`, { wide: true });
    }
    function openSettings() {
        const S = WHW.settings;
        const opts = (list, cur) => list.map(([v, label]) => `<option value="${v}" ${v === cur ? 'selected' : ''}>${esc(label)}</option>`).join('');
        const cap = (w) => w.charAt(0).toUpperCase() + w.slice(1);
        const body = modal('Settings', `
            <label class="w-setting"><span>Assisted swings<small>Click to swing automatically (70% damage). For trackpads and touch screens.</small></span><input type="checkbox" id="setAssist" ${S.assist ? 'checked' : ''}></label>
            <label class="w-setting"><span>Damage numbers</span><input type="checkbox" id="setNums" ${S.dmgNumbers ? 'checked' : ''}></label>
            <label class="w-setting"><span>Screen shake and hit pause</span><input type="checkbox" id="setShake" ${S.shake ? 'checked' : ''}></label>
            <label class="w-setting"><span>Sound volume<small>Also follows the game's sound settings.</small></span><input type="range" id="setVol" min="0" max="1" step="0.05" value="${S.volume}"></label>
            <h3 class="w-setting-h">Performance</h3>
            <label class="w-setting"><span>Graphics<small>Lower draws fewer particles, less ground detail and lighting, and a less sharp picture.</small></span>
                <select id="setGfx">${opts([['auto', 'Auto (game setting: ' + cap(WHW.gamePerformance()) + ')'], ['high', 'High'], ['medium', 'Medium'], ['low', 'Low']], S.graphics)}</select></label>
            <label class="w-setting"><span>Resolution<small>How sharp the picture is. Lower is much faster, especially on big or high-resolution screens.</small></span>
                <select id="setRes">${opts([['auto', 'Auto'], ['full', 'Full'], ['0.75', '75%'], ['0.5', '50%']], S.resolution)}</select></label>
            <label class="w-setting"><span>Frame rate limit<small>Higher is smoother on fast screens but works your device harder.</small></span>
                <select id="setFps">${opts([['30', '30 fps'], ['60', '60 fps'], ['0', 'Screen rate']], String(S.fpsCap))}</select></label>
            <label class="w-setting"><span>Show frame rate</span><input type="checkbox" id="setShowFps" ${S.showFps ? 'checked' : ''}></label>
            <div class="w-row" style="margin-top:14px"><a class="btn btn-ghost" href="index.html">Back to the clicker</a><button class="btn btn-ghost" id="setHelp">How to play</button></div>`);
        const save = () => { WHW.saveSettings(); };
        body.querySelector('#setAssist').addEventListener('change', (e) => { S.assist = e.target.checked; save(); });
        body.querySelector('#setNums').addEventListener('change', (e) => { S.dmgNumbers = e.target.checked; save(); });
        body.querySelector('#setShake').addEventListener('change', (e) => { S.shake = e.target.checked; save(); });
        body.querySelector('#setVol').addEventListener('input', (e) => { S.volume = Number(e.target.value); save(); });
        const gfx = (key, val) => { S[key] = val; save(); WHW.applyGraphics(); };
        body.querySelector('#setGfx').addEventListener('change', (e) => gfx('graphics', e.target.value));
        body.querySelector('#setRes').addEventListener('change', (e) => gfx('resolution', e.target.value));
        body.querySelector('#setFps').addEventListener('change', (e) => gfx('fpsCap', Number(e.target.value)));
        body.querySelector('#setShowFps').addEventListener('change', (e) => { S.showFps = e.target.checked; save(); });
        body.querySelector('#setHelp').addEventListener('click', openHelp);
    }
    function openDeath(drop, killer, onRespawn) {
        const items = Object.entries(drop || {}).map(([id, n]) => `${n} × ${esc(matName(id))}`).join(', ');
        let what;
        if (killer) what = items ? `<b>${esc(killer.name)}</b> knocked you out. You dropped <b>${items}</b> as loot: they get first pick, then anyone can grab it (you too, if you hurry back).`
            : `<b>${esc(killer.name)}</b> knocked you out. You weren't carrying anything, so they got nothing.`;
        else what = items ? `You dropped <b>${items}</b> where you fell. Go back for the bag to get it all back (you can only pick it up once).` : 'You weren\'t carrying anything, so nothing was dropped.';
        const body = modal('Knocked out!', `<p class="w-note">${what}</p>
            <p class="w-note">Your rubies, gear and banked materials are safe.</p>
            <div class="w-row" style="margin-top:12px"><button class="btn btn-primary" id="respawn">Wake up in town</button></div>`, { onClose: onRespawn });
        body.querySelector('#respawn').addEventListener('click', () => closeModal());
    }

    WHW.toast = toast;
    WHW.hint = hint;
    WHW.banner = banner;
    WHW.ui = { modal, closeModal, isOpen, refresh, handleKey, renderHud, renderHotbar, renderPower, setPrompt, setZone, openBag, openSkills, renderAbilities, openNpc, openStatue, openAltar, openCarving, goalText, openStation, openTrader, openPortal, openMap, openHelp, openSettings, openDeath, showResult, setOnline, openOnline, openChat, chatLogChanged, ICONS, esc };
})();
