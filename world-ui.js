/**
 * The Wilds: the DOM side. HUD (health, stamina, rubies, hotbar, swing meter, boss bar, prompts, toasts) and the
 * modals: bag and gear, the crafting stations, the trader, travel, help, settings and the knocked-out screen.
 * Buttons call WHW.actions (world.js), which change the save and then ask for a redraw.
 */
(function () {
    'use strict';
    const D = window.WHWorldData, W = window.WHWorld, Bridge = window.WHWorldBridge;
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
        E.paused = true;
        E.keys.clear();
        if (E.mouse.down) { E.mouse.down = false; if (WHW.onRelease) WHW.onRelease(); }
        setTimeout(() => { const f = body.querySelector('button, [tabindex]'); if (f && !opts.game) f.focus({ preventScroll: true }); }, 0);
        return body;
    }
    function closeModal() {
        const fn = modalClose;
        modalClose = null; modalRender = null;
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
        if (k === 'z' || k === 'x' || k === 'c') { WHW.actions.castAbility('zxc'.indexOf(k)); return true; }
        if (k === 'q') { WHW.actions.usePotion(); return true; }
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
        const on = WHW.online;
        if (!on || on.status !== 'online') { toast(on && on.status === 'off' ? 'Chat needs online play (turn it on with the 🌐 button).' : 'Not connected yet.'); return; }
        $('chatBar').hidden = false;
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
            if (v.trim()) WHW.online.say(v, false);
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
    function renderHud() {
        const g = game();
        if (!g || !g.player) return;
        const p = g.player, s = g.state;
        $('hpFill').style.width = (100 * Math.max(0, p.hp) / p.maxHp).toFixed(1) + '%';
        $('hpText').textContent = `${Math.ceil(Math.max(0, p.hp))} / ${p.maxHp}`;
        $('stFill').style.width = (100 * p.stam.val / D.COMBAT.stamina.max).toFixed(1) + '%';
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
        html += `<button class="w-slot w-slot--cons" data-potion="1" title="Drink a potion (Q)" aria-label="Drink a potion, ${potions} left"><span class="k">Q</span>${D.CONSUMABLES_BY_ID[pot].icon}<span class="n">${potions}</span></button>`;
        const cls = W.classOf(s);
        W.abilityKit(s).forEach((id, i) => {
            const a = D.ABILITIES[id], k = D.ABILITY_KEYS[i];
            html += a ? `<button class="w-slot w-slot--cons w-abil" data-abil="${i}" title="${esc(a.name)} (${k}): ${esc(a.desc)}" aria-label="${esc(a.name)}, key ${k}"><span class="k">${k}</span>${a.icon}<span class="cd" hidden></span></button>`
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
            const c = b.querySelector('.cd');
            c.hidden = cd <= 0;
            if (cd > 0) c.textContent = cd >= 10 ? Math.ceil(cd) : cd.toFixed(1);
            b.classList.toggle('is-on', !!id && WHW.actors.buffOn(p, id));
        });
        for (let i = 0; i < D.ABILITY_KEYS.length; i++) {
            const t = $('tAb' + i);
            if (!t) continue;
            const id = kit[i], a = D.ABILITIES[id];
            t.hidden = !a;
            if (a) { t.textContent = a.icon; t.classList.toggle('is-cd', WHW.actors.abilityCd(p, id) > 0); }
        }
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
        html += `<p class="w-note">Every class has its own skill tree. Learn skills with rubies from the top of a branch down. <b>Abilities</b> (square icons) go on <kbd>Z</kbd> <kbd>X</kbd> <kbd>C</kbd>: up to three equipped at a time. <b>Perks</b> (round icons) are passive bonuses that work while you are that class. Change class in town. Abilities use your weapon's damage, and outside town they hit other players too (at PvP strength, with shorter stuns).</p>`;
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
        const kind = isAb ? `Ability · ${sk.cd}s cooldown${sk.stam ? ' · ' + sk.stam + ' stamina' : ''}` : 'Perk · always on';
        return `<div class="w-node ${state}${sk.req && s.skills.learned[sk.req] ? ' is-linked' : ''}${isAb ? ' is-ability' : ''}">
            <div class="w-node-top"><span class="w-node-ico" style="border-color:${isAb ? sk.color : 'var(--border-strong)'}">${sk.icon}</span><div><div class="w-card-name">${esc(sk.name)}</div><div class="w-node-kind">${kind}</div></div></div>
            <div class="w-card-sub">${esc(sk.desc)}</div><div class="w-card-actions">${act}</div></div>`;
    }
    // swing meter, every frame
    function renderPower(p) {
        const f = $('powerFill');
        if (!f || !p) return;
        const b = W.baseOf(W.findGear(game().state, p.weaponUid));
        const meter = $('powerMeter');
        if (!b) { meter.hidden = true; return; }
        meter.hidden = false;
        const P = D.WEAPON_CLASSES[b.cls];
        let minMark, fullMark;
        if (b.cls === 'bow') { minMark = P.minDraw; fullMark = 0.95; }
        else { minMark = P.vMin / P.vFull; fullMark = (P.vMin + (P.vFull - P.vMin) * D.COMBAT.perfect.at) / P.vFull; }
        meter.querySelector('.w-power-min').style.left = (minMark * 100) + '%';
        meter.querySelector('.w-power-full').style.left = (Math.min(1, fullMark) * 100) + '%';
        p.powerShown = Math.max(p.power, (p.powerShown || 0) * 0.9);
        f.style.width = Math.min(100, p.powerShown * 100).toFixed(1) + '%';
        f.className = p.powerPerfect ? 'is-perfect' : p.powerHit ? 'is-hit' : '';
    }
    function setPrompt(html) {
        const el = $('prompt');
        if (!html) { el.hidden = true; return; }
        if (el.innerHTML !== html) el.innerHTML = html;
        el.hidden = false;
    }
    function setZone(name, sub) { $('zoneName').innerHTML = esc(name) + (sub ? `<small>${esc(sub)}</small>` : ''); }

    // ---------------- shared pieces ----------------
    function matName(id) { return (D.MATERIALS_BY_ID[id] || D.CONSUMABLES_BY_ID[id] || { name: id }).name; }
    function matColor(id) { return (D.MATERIALS_BY_ID[id] || D.CONSUMABLES_BY_ID[id] || { color: '#888' }).color; }
    function needHtml(s, inputs, fee, times = 1) {
        const parts = Object.entries(inputs).map(([id, n]) => {
            const have = W.count(s, id), need = n * times;
            return `<span class="${have < need ? 'is-short' : ''}" title="You have ${have}"><i class="w-dot" style="display:inline-block;width:8px;height:8px;margin-right:4px;background:${matColor(id)}"></i>${need} ${esc(matName(id))} <small class="muted">(${have})</small></span>`;
        });
        if (fee) parts.push(`<span class="is-fee ${s.rubies < fee ? 'is-short' : ''}">♦ ${fmt(fee)} rubies</span>`);
        return `<div class="w-need">${parts.join('')}</div>`;
    }
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
    let bagTab = 'gear', confirmSalvage = 0;
    function openBag(tab) {
        if (tab) bagTab = tab;
        const body = modal('Bag', '', { wide: true, render: renderBagBody });
        renderBagBody(body);
    }
    function renderBagBody() {
        const body = $('wModalBody');
        const g = game(), s = g.state;
        let html = tabs(['gear', 'materials', 'stats'], bagTab, null, { gear: `Gear (${s.gear.length}/${D.RULES.maxGear})`, materials: 'Materials', stats: 'Stats & rewards' });
        if (bagTab === 'gear') {
            const eq = W.SLOTS.map(slot => { const it = W.findGear(s, s.equip[slot]); return `<span>${ICONS[slot]} <b>${it ? esc(W.gearName(it)) : '—'}</b></span>`; }).join('');
            html += `<div class="w-section"><h3>Wearing</h3><div class="w-card-stats" style="font-size:13px">${eq}</div></div>`;
            const order = (it) => (W.isEquipped(s, it.uid) ? 0 : 1) * 1000 - W.baseOf(it).tier * 10 - it.score / 100;
            const list = s.gear.slice().sort((a, b) => order(a) - order(b));
            html += `<div class="w-grid">${list.map(it => {
                const b = W.baseOf(it), q = W.qualityOf(it.score), on = W.isEquipped(s, it.uid);
                const weapon = b.slot === 'weapon';
                const slotNo = s.hotbar.indexOf(it.uid);
                return `<div class="w-card${on ? ' is-equipped' : ''}">
                    ${on ? `<span class="tag">${weapon ? 'Slot ' + (slotNo + 1) : 'Worn'}</span>` : ''}
                    <div class="w-card-top"><div class="w-card-ico" style="border-color:${q.color}">${ICONS[b.cls]}</div>
                    <div><div class="w-card-name" style="color:${q.color}">${esc(W.gearName(it))}</div><div class="w-card-sub">${esc(q.name)} · score ${it.score} · tier ${b.tier}</div></div></div>
                    ${statLine(b, it)}
                    <div class="w-card-actions">
                        <button class="btn btn-sm ${on ? 'btn-ghost' : 'btn-primary'}" data-equip="${it.uid}">${on ? (weapon ? 'Off hotbar' : 'Take off') : (weapon ? 'To hotbar' : 'Wear')}</button>
                        <button class="btn btn-sm btn-danger" data-salvage="${it.uid}">${confirmSalvage === it.uid ? 'Sure? Salvage' : 'Salvage'}</button>
                    </div></div>`;
            }).join('')}</div>`;
        } else if (bagTab === 'materials') {
            const ids = Object.keys(Object.assign({}, s.mats, s.bag));
            const known = D.MATERIALS.filter(m => ids.includes(m.id));
            html += `<p class="w-note">Materials marked <b style="color:#ffd27a">carried</b> were picked up since your last visit to town. Part of them drops if you are knocked out; they are safe once you walk back into town.</p>`;
            html += known.length ? `<div class="w-mats">${known.map(m => `<div class="w-mat"><i class="w-dot" style="background:${m.color}"></i>${esc(m.name)}${s.bag[m.id] ? ` <span class="bag">${s.bag[m.id]} carried</span>` : ''}<b>${fmt(W.count(s, m.id))}</b></div>`).join('')}</div>` : '<p class="muted">Nothing yet. Chop trees, mine rocks and defeat monsters.</p>';
            html += `<div class="w-section" style="margin-top:14px"><h3>Supplies</h3><div class="w-mats">${D.CONSUMABLES.map(c => `<div class="w-mat">${c.icon} ${esc(c.name)}<b>${fmt(s.cons[c.id] || 0)}</b></div>`).join('')}</div></div>`;
        } else {
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
            html += `<p class="w-note">The Trader pays rubies for materials. Keep what you need for crafting!</p>`;
            html += ids.length ? `<div class="w-grid">${ids.map(m => `<div class="w-card"><div class="w-card-top"><i class="w-dot" style="width:18px;height:18px;background:${m.color}"></i><div><div class="w-card-name">${esc(m.name)}</div><div class="w-card-sub">You have ${fmt(W.count(s, m.id))} · ♦ ${m.sell} each</div></div></div>
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
                Today: gems <b>${s.caps.gems}/${D.CAPS.gemsPerDay}</b>, Golden What Happened <b>${s.caps.golden}/${D.CAPS.goldenPerDay}</b> from the Wilds.</p>`;
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
            <p><kbd>W</kbd><kbd>A</kbd><kbd>S</kbd><kbd>D</kbd> to move, <kbd>Space</kbd> or <kbd>Shift</kbd> to dash (you can't be hit during a dash), <kbd>1</kbd>–<kbd>5</kbd> or the mouse wheel to switch what you hold, <kbd>Q</kbd> for a potion, <kbd>E</kbd> to use things, <kbd>I</kbd> for your bag, <kbd>M</kbd> for the map.</p>
            <p><b>Your weapon follows the mouse.</b> To hit hard you have to <b>swing</b>: move the mouse quickly across the target, like the real thing. A slow drag just bumps it. The swing meter under your hotbar shows how fast your blade is moving: past the first mark it hurts, past the second it's a <b style="color:#ffc83d">Perfect</b> hit. Slashing back and forth builds a combo; the tip of the blade hits harder than the hilt. Heavy weapons like axes turn slower but hit harder.</p>
            <ul><li><b>Shields</b>: hold <kbd>right-click</kbd> (or <kbd>F</kbd>) to raise your shield toward the mouse. Hits from in front are mostly blocked but cost stamina; if you run out, your guard breaks. Raise it <i>just</i> as a hit lands to <b style="color:#ffc83d">parry</b>: no damage, the attacker is stunned and projectiles fly back. You can't attack with your weapon while blocking. Falling rocks and meteors can't be blocked.</li>
            <li><b>Classes</b> (<kbd>K</kbd>): you start as a Warrior. Unlock the Guardian, Rogue, Ranger, Lancer and Mystic by completing their challenges, and change class in town. Each class has a bonus and its own skill tree of abilities and perks, learned with rubies from the top of each branch down (some after beating a boss). Equip up to three abilities on <kbd>Z</kbd> <kbd>X</kbd> <kbd>C</kbd>; an ability you equip outside town starts on its cooldown. Abilities hurt monsters, bosses and rivals, and other players outside town (at PvP strength; stuns on players are shorter).</li>
            <li><b>Spears</b>: flick the mouse outward from your character to thrust, then pull back. A thrust hits harder the faster you are moving toward the target: dash into it for up to +90%. The Lancer class builds on this.</li>
            <li><b>Bows</b>: press anywhere, pull the mouse <i>away</i> from where you want to shoot, and let go. Hold a full draw briefly for a steady shot. They need arrows.</li>
            <li><b>Daggers</b> are quick and hit much harder from behind.</li></ul>
            <h3>Gathering</h3>
            <p>Swing an <b>axe</b> at trees and a <b>pickaxe</b> at rocks and ores. Each zone has its own materials, and the best ores sit deeper in. Hit the <b style="color:#ffe14d">glowing crack</b> for double progress and a chance of extra. Better tools are needed for harder ores. Pick herbs and fiber by holding <kbd>E</kbd>.</p>
            <h3>Crafting</h3>
            <p>Smelt ore into bars at the Forge, cut planks and leather at the Workbench, then craft gear. Every piece of gear is made with a <b>minigame</b>: the better you play, the better its quality, from Crude to <b style="color:#ffc83d">Legendary</b> (up to 1.75× the stats, plus bonus traits). Use <b>Practice</b> to learn the minigames for free.</p>
            <h3>Rubies and your game</h3>
            <p>Rubies are the money of the Wilds: earn them from monsters, ruby veins, bosses and the Trader, and spend them on crafting fees and supplies. You can also send treasures home: <b>lootboxes</b> crafted at the Rune Altar, plus <b>gems</b> and <b>Golden What Happened</b> from bosses, elites, ruby veins and the Trader's weekly exchange. They arrive the next time you open the game.</p>
            <h3>Online</h3>
            <p>Other players in the same zone appear live (🌐 at the top shows how many). Press <kbd>Enter</kbd> to chat or send an emote. <b>Outside town, players can fight each other</b> with the same swings, shields and parries; you're protected for a few seconds after arriving. A player knocked out by another drops part of what they carry: the winner gets first pick, then anyone can grab it. Bosses are shared: everyone in the arena fights the same one, and everyone who did enough damage gets the reward. Monsters are your own. You can play offline from the 🌐 menu.</p>
            <h3>Danger</h3>
            <p>Watch for <b style="color:#ff6b7a">red shapes</b>: that's where an attack is about to land. Dash out of them. If you're knocked out, part of what you've carried since leaving town drops where you fell; go back and pick it up. Rubies and gear are never lost. Rival adventurers roam each zone and fight with the same weapons you do.</p>
        </div>`, { wide: true });
    }
    function openSettings() {
        const S = WHW.settings;
        const body = modal('Settings', `
            <label class="w-setting"><span>Assisted swings<small>Click to swing automatically (70% damage). For trackpads and touch screens.</small></span><input type="checkbox" id="setAssist" ${S.assist ? 'checked' : ''}></label>
            <label class="w-setting"><span>Damage numbers</span><input type="checkbox" id="setNums" ${S.dmgNumbers ? 'checked' : ''}></label>
            <label class="w-setting"><span>Screen shake and hit pause</span><input type="checkbox" id="setShake" ${S.shake ? 'checked' : ''}></label>
            <label class="w-setting"><span>Sound volume<small>Also follows the game's sound settings.</small></span><input type="range" id="setVol" min="0" max="1" step="0.05" value="${S.volume}"></label>
            <div class="w-row" style="margin-top:14px"><a class="btn btn-ghost" href="index.html">Back to the clicker</a><button class="btn btn-ghost" id="setHelp">How to play</button></div>`);
        const save = () => { WHW.saveSettings(); };
        body.querySelector('#setAssist').addEventListener('change', (e) => { S.assist = e.target.checked; save(); });
        body.querySelector('#setNums').addEventListener('change', (e) => { S.dmgNumbers = e.target.checked; save(); });
        body.querySelector('#setShake').addEventListener('change', (e) => { S.shake = e.target.checked; save(); });
        body.querySelector('#setVol').addEventListener('input', (e) => { S.volume = Number(e.target.value); save(); });
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
    WHW.ui = { modal, closeModal, isOpen, refresh, handleKey, renderHud, renderHotbar, renderPower, setPrompt, setZone, openBag, openSkills, renderAbilities, openStation, openTrader, openPortal, openMap, openHelp, openSettings, openDeath, showResult, setOnline, openOnline, openChat, chatLogChanged, ICONS, esc };
})();
