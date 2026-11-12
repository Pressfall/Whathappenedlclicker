/**
 * The Crucible's screens (The Wilds, a station in town): forge relics from essences, infuse gear's sockets, upgrade relics,
 * and the Relic Satchel (gear for the game, waiting to be sent home). The rules are core/world-relics.js and core/gear.js;
 * the save changes go through core/world-logic.js (beginForge, finishCraft, beginInfuse, upgradeRelic, scrapPiece,
 * sendToGame). The forge and infusing play the Crucible minigame (world-craft.js station 'crucible').
 * WHW.relics = { open(tab), forge(kind, ids, catalyst), ... }
 */
(function () {
    'use strict';
    const D = window.WHWorldData, W = window.WHWorld, R = window.WHWorldRelics, Gr = window.WHGear;
    const WHW = window.WHW;
    const UI = () => WHW.ui;
    const game = () => WHW.game;
    const esc = (s) => UI().esc(s);
    const fmt = (n) => Math.round(n).toLocaleString('en-US');
    const ess = (id) => D.MATERIALS_BY_ID[id];

    let tab = 'forge', kind = 'wilds', picked = [], useCat = false, infuseUid = 0;
    const TABS = { forge: 'Forge', infuse: 'Infuse', upgrade: 'Upgrade', satchel: 'Relic Satchel' };
    const reasonText = { busy: 'Finish your other craft first.', count: 'Put in ' + R.FORGE.min + ' to ' + R.FORGE.max + ' essences.', materials: "You don't have those essences.",
        catalyst: 'You have no Catalyst.', rubies: 'Not enough rubies.', full: 'No room: ', unknown: "That can't go in.", socket: 'No such socket.', max: 'Already +' + Gr.MAX_LEVEL + '.' };

    function open(t) {
        if (t) tab = t;
        UI().modal('⚗️ The Crucible', '', { wide: true, render });
        render();
    }
    function render() {
        const body = document.getElementById('wModalBody');
        if (!body) return;
        const s = game().state;
        let html = UI().tabs(Object.keys(TABS), tab, null, Object.assign({}, TABS, { satchel: 'Relic Satchel (' + s.satchel.length + ')' }));
        html += tab === 'forge' ? forgeHtml(s) : tab === 'infuse' ? infuseHtml(s) : tab === 'upgrade' ? upgradeHtml(s) : satchelHtml(s);
        body.innerHTML = html;
        UI().wireTabs(body, (t) => { tab = t; render(); });
        wire(body, s);
    }

    // ---------------- forge ----------------
    const owned = (s) => D.ESSENCE_IDS.filter(id => W.count(s, id) > 0);
    const pickedCount = (id) => picked.filter(x => x === id).length;
    function oddsBars(o) {
        return `<div class="w-odds">${o.map((p, t) => `<div class="w-odds-row"><span style="color:${Gr.TIERS[t].color}">${esc(Gr.TIERS[t].name)}</span>
            <i><b style="width:${Math.max(p > 0 ? 1 : 0, Math.min(100, p * 100)).toFixed(1)}%;background:${Gr.TIERS[t].color}"></b></i><em>${p >= 0.1 ? (p * 100).toFixed(0) : p >= 0.01 ? (p * 100).toFixed(1) : p > 0 ? (p * 100).toFixed(2) : '0'}%</em></div>`).join('')}</div>`;
    }
    function forgeHtml(s) {
        const list = owned(s), luck = W.playerStats(s).luck, cat = W.count(s, 'catalyst');
        if (useCat && !cat) useCat = false;
        picked = picked.filter(id => pickedCount(id) <= W.count(s, id));
        const c = W.canForge(s, kind, picked, useCat);
        const odds = R.forgeOdds({ ess: picked, score: 70, luck, catalyst: useCat, pity: s.relics.pity });
        const reso = R.resonant(picked);
        let html = `<details class="w-how"><summary>Put in <b>${R.FORGE.min} to ${R.FORGE.max} essences</b>, choose what to make, and play the Crucible: out comes one random relic.</summary>
            <p>Its <b>relic tier</b>, from Common to Primordial, comes from the essences' rarity most of all, then how many you put in (each counts a little less), your score, your luck, <b>Resonance</b> (every essence of one aspect), a <b>Catalyst</b> (never Common) and your bad luck so far (each forge without a Legendary helps the next a little). Its boosts follow the aspects you put in, and its colours are your essences'. <b>Mythic and Primordial stay rare whatever you put in</b>: at most ${R.FORGE.caps[5] * 100}% and ${R.FORGE.caps[6] * 100}% a forge.</p></details>
            <div class="w-chips" role="group" aria-label="Make">
                <button class="w-chip${kind === 'wilds' ? ' is-on' : ''}" data-kind="wilds" aria-pressed="${kind === 'wilds'}">⚔️ Wilds gear <small>a weapon or armor at gear tier ${W.relicGearTier(s)}</small></button>
                <button class="w-chip${kind === 'game' ? ' is-on' : ''}" data-kind="game" aria-pressed="${kind === 'game'}">🖱️ Gear for the game <small>a cursor, crown, cloak, ring or relic for the clicker</small></button>
            </div>`;
        html += `<div class="w-forge"><section class="w-panel"><h3>Your essences</h3>`;
        if (!list.length) html += '<p class="w-empty">None yet. Mine stone and ore (rarely), and clear rooms in the hidden dungeons under each zone (their way down opens once the zone\'s boss is beaten).</p>';
        for (let r = 4; r >= 0; r--) {
            const ids = list.filter(id => ess(id).rar === r);
            if (!ids.length) continue;
            html += `<h4 style="color:${D.ESSENCE_RARITY[r].color}">${esc(D.ESSENCE_RARITY[r].name)}</h4><div class="w-ess-grid">${ids.map(id => {
                const m = ess(id), n = W.count(s, id), k = pickedCount(id);
                return `<button class="w-ess${k ? ' is-on' : ''}" data-add="${id}" data-mat="${id}" style="--c:${m.color}" ${k >= n || picked.length >= R.FORGE.max ? 'disabled' : ''}>
                    <span class="w-ess-dot"></span><span>${m.icon} ${esc(m.name)}</span><small>${D.ASPECTS[m.asp].name} · ${n - k} left</small></button>`;
            }).join('')}</div>`;
        }
        html += `</section><section class="w-panel"><h3>In the Crucible <span class="muted">${picked.length} / ${R.FORGE.max}</span></h3>
            <div class="w-ess-picked">${picked.map((id, i) => `<button class="w-ess is-on" data-del="${i}" style="--c:${ess(id).color}" title="Take it out"><span class="w-ess-dot"></span>${ess(id).icon} ${esc(ess(id).name)} ✕</button>`).join('') || '<span class="muted">Empty. Pick essences from your list to put them in.</span>'}</div>
            ${cat ? `<label class="w-check"><input type="checkbox" id="useCat" ${useCat ? 'checked' : ''}> ⚗️ Add a Crucible Catalyst (you have ${cat}): never Common</label>` : ''}
            <p class="w-note" style="margin:6px 0">${reso ? '✨ <b>Resonance</b>: every essence shares one aspect. ' : ''}${s.relics.pity ? `🍀 ${s.relics.pity} forge${s.relics.pity > 1 ? 's' : ''} since your last Legendary: the next is a little luckier. ` : ''}Odds with a good game (score 70):</p>
            ${oddsBars(odds)}
            ${picked.length ? `<p class="w-note">Boosts it can get: ${Object.entries(R.aspectPoints(picked)).sort((a, b) => b[1] - a[1]).map(([a]) => D.ASPECTS[a].icon + ' ' + esc(D.ASPECTS[a].name) + ' <small>(' + esc(kind === 'game' ? D.ASPECTS[a].game : D.ASPECTS[a].wilds) + ')</small>').join(', ')}</p>` : ''}
            <div class="w-card-actions"><button class="btn btn-gold" id="doForge" ${c.ok ? '' : 'disabled'}>Forge · ♦ ${fmt(c.fee)}</button><button class="btn btn-ghost btn-sm" id="practice">Practice</button>${picked.length ? '<button class="btn btn-ghost btn-sm" id="clearPick">Empty it</button>' : ''}</div>
            ${!c.ok && picked.length ? `<p class="w-note" style="color:#ffb3bb">${esc(reasonText[c.reason] || '')}${c.reason === 'full' ? (kind === 'wilds' ? 'your backpack is full.' : 'the Relic Satchel is full: send pieces home first.') : ''}</p>` : ''}
            <p class="w-note">Forged so far: <b>${fmt(s.relics.forged)}</b>${s.relics.best >= 0 ? ` · best <b style="color:${Gr.TIERS[s.relics.best].color}">${esc(Gr.TIERS[s.relics.best].name)}</b>` : ''}${s.relics.uniques ? ` · uniques <b>${s.relics.uniques}</b>` : ''}</p>
            ${uniqueHints(kind, picked)}</section></div>`;
        // on a phone the panels stack, the Forge button far below the essences: this bar keeps it at hand
        const legend = odds.slice(4).reduce((a, p) => a + p, 0);
        html += `<div class="w-forge-bar"><span><b>${picked.length} / ${R.FORGE.max}</b> in${picked.length ? ` · <b style="color:${Gr.TIERS[4].color}">Legendary+</b> ${legend >= 0.1 ? Math.round(legend * 100) : (legend * 100).toFixed(1)}%` : ''}</span>
            <button class="btn btn-gold btn-sm" data-forge-go ${c.ok ? '' : 'disabled'}>Forge · ♦ ${fmt(c.fee)}</button></div>`;
        return html;
    }
    // which uniques these essences could make (on a Legendary or better forge)
    function uniqueHints(k, ids) {
        const list = R.uniquesFor(k, ids);
        if (!list.length) return '';
        return `<details class="w-uniques"><summary>Uniques these essences could make (Legendary or better, ${Math.round(R.FORGE.uniqueChance * 100)}% of those)</summary><div class="w-grid">${list.map(u => `<div class="w-card"><div class="w-card-top"><div class="w-card-ico">${Gr.iconSvg({ shape: u.shape, tier: 4, outline: u.outline, main: '#d9c27a', trim: '#8a7a5a', uid: 'h' + u.id })}</div><div><div class="w-card-name">${esc(u.name)}</div><div class="w-card-sub">${esc(u.desc)}</div></div></div></div>`).join('')}</div></details>`;
    }

    // ---------------- infuse ----------------
    function infuseHtml(s) {
        const gear = s.gear.slice().sort((a, b) => (W.isEquipped(s, b.uid) ? 1 : 0) - (W.isEquipped(s, a.uid) ? 1 : 0) || (b.r ? b.r.t + 1 : 0) - (a.r ? a.r.t + 1 : 0));
        if (!gear.some(g => g.uid === infuseUid)) infuseUid = gear.length ? gear[0].uid : 0;
        const it = W.findGear(s, infuseUid);
        let html = `<details class="w-how"><summary>Set an essence in one of a piece's <b>sockets</b> to add its aspect to it; a short Crucible game sizes the boost.</summary>
            <p>Every piece of gear has one socket, another at Fine quality and at Masterwork, and a relic at least one more for every two tiers (up to ${R.MAX_SOCKETS}). Rarer essences and a better game add more. A new essence replaces the one there (that one is gone). <b>Two aspects together</b> make a combo: ${R.COMBOS.map(c => esc(c.name) + ' (' + D.ASPECTS[c.a].icon + D.ASPECTS[c.b].icon + ')').join(', ')}.</p></details>
            <label class="w-sort">Gear <select id="infuseGear">${gear.map(g => `<option value="${g.uid}" ${g.uid === infuseUid ? 'selected' : ''}>${W.isEquipped(s, g.uid) ? '★ ' : ''}${esc(W.gearName(g))}</option>`).join('')}</select></label>`;
        if (!it) return html + '<p class="w-empty">No gear.</p>';
        const b = W.baseOf(it), n = R.socketCount(it);
        html += `<div class="w-card" style="margin-top:10px"><div class="w-card-top"><div class="w-card-ico">${UI().iconFor(b, it)}</div><div><div class="w-card-name" style="color:${UI().nameColor(it)}">${esc(W.gearName(it))}</div><div class="w-card-sub">${n} socket${n > 1 ? 's' : ''}</div></div></div>${UI().statLine(b, it)}</div>`;
        const list = owned(s);
        html += `<div class="w-grid">${Array.from({ length: n }, (_, i) => {
            const k = it.k && it.k[i];
            return `<div class="w-card"><div class="w-card-name">Socket ${i + 1}: ${k ? ess(k[0]).icon + ' ' + esc(ess(k[0]).name) + ' (+' + k[1] + '% ' + esc(D.ASPECTS[ess(k[0]).asp].name) + ')' : '<span class="muted">empty</span>'}</div>
                <div class="w-card-actions"><select data-sockpick="${i}" aria-label="Essence for socket ${i + 1}">${list.map(id => `<option value="${id}">${ess(id).icon} ${esc(ess(id).name)} ×${W.count(s, id)} · ${esc(D.ASPECTS[ess(id).asp].name)} up to +${Math.round(R.SOCKET_VALUE[ess(id).rar] * 1.3 * 10) / 10}%</option>`).join('')}</select>
                <button class="btn btn-sm btn-primary" data-infuse="${i}" ${list.length ? '' : 'disabled'}>${k ? 'Replace' : 'Infuse'}</button></div></div>`;
        }).join('')}</div>`;
        if (!list.length) html += '<p class="w-empty">You have no essences to set.</p>';
        return html;
    }

    // ---------------- upgrade ----------------
    function upgradeHtml(s) {
        const rows = [];
        for (const it of s.gear) if (it.r) rows.push({ where: 'gear', id: it.uid, t: it.r.t, lv: it.r.lv, name: W.gearName(it), icon: UI().iconFor(W.baseOf(it), it) });
        for (const p of s.satchel) rows.push({ where: 'satchel', id: p.id, t: p.t, lv: p.lv, name: Gr.pieceName(p) + ' (for the game)', icon: Gr.pieceSvg(p) });
        let html = `<details class="w-how"><summary>Raise a relic up to +${Gr.MAX_LEVEL}: each level adds <b>${Math.round(Gr.LEVEL_STEP * 100)}%</b> to its boosts.</summary>
            <p>It takes essences of a rarity that matches the relic's tier (the ones you have most of are used) and rubies. Gear for the game is upgraded here, before you send it home.</p></details>`;
        if (!rows.length) return html + '<p class="w-empty">No relics yet: forge one first.</p>';
        html += `<div class="w-grid">${rows.sort((a, b) => b.t - a.t || b.lv - a.lv).map(r => {
            const c = R.upgradeCost(r.t, r.lv);
            const have = c.ok ? D.ESSENCE_IDS.filter(e => ess(e).rar === c.rar).reduce((a, e) => a + W.count(s, e), 0) : 0;
            return `<div class="w-card"><div class="w-card-top"><div class="w-card-ico">${r.icon}</div><div><div class="w-card-name" style="color:${Gr.TIERS[r.t].color}">${esc(r.name)}${r.lv ? ' +' + r.lv : ''}</div>
                <div class="w-card-sub">${c.ok ? `<span class="w-up-gain">Boosts +${Math.round(r.lv * Gr.LEVEL_STEP * 100)}% → +${Math.round((r.lv + 1) * Gr.LEVEL_STEP * 100)}%</span><br>Costs ${c.n} ${esc(D.ESSENCE_RARITY[c.rar].name)} essences (you have ${have}) and ♦ ${fmt(c.rubies)}` : `At its best: +${Gr.MAX_LEVEL} (boosts +${Math.round(Gr.MAX_LEVEL * Gr.LEVEL_STEP * 100)}%)`}</div></div></div>
                <div class="w-card-actions"><button class="btn btn-sm btn-gold" data-up="${r.where}:${r.id}" ${c.ok && have >= c.n && s.rubies >= c.rubies ? '' : 'disabled'}>Upgrade</button></div></div>`;
        }).join('')}</div>`;
        return html;
    }

    // ---------------- the satchel ----------------
    function pieceCard(p, actions) {
        const u = p.q && Gr.UNIQUES_BY_ID[p.q];
        return `<div class="w-card w-gear-piece" style="--q:${Gr.TIERS[p.t].color}"><div class="w-card-top"><div class="w-card-ico">${Gr.pieceSvg(p)}</div>
            <div><div class="w-card-name" style="color:${Gr.TIERS[p.t].color}">${esc(Gr.pieceName(p))}${p.lv ? ' +' + p.lv : ''}</div>
            <div class="w-card-sub">${esc(Gr.TIERS[p.t].name)} ${esc(Gr.SLOT_NAMES[p.s])}${p.by ? ' · forged by ' + esc(p.by) : ''}${p.n ? ' · traded ' + p.n + 'x' : ''}</div></div></div>
            ${u ? `<p class="w-relic-desc">“${esc(u.desc)}”</p>` : ''}
            <div class="w-card-stats">${p.l.map(([a, r]) => `<span>${D.ASPECTS[a].icon} ${esc(Gr.lineText(a, p.t, r, p.lv))}</span>`).join('')}</div>
            ${actions ? `<div class="w-card-actions">${actions}</div>` : ''}</div>`;
    }
    function satchelHtml(s) {
        let html = `<details class="w-how"><summary>Gear for the game waits here (${s.satchel.length} of ${W.SATCHEL_MAX}) until you send it home.</summary>
            <p>In the game, open <b>Items › Gear</b> to wear it: five slots (${Gr.SLOTS.map(x => Gr.SLOT_NAMES[x]).join(', ')}). Three or five pieces sharing a main aspect are <b>attuned</b> (+${Gr.ATTUNE[3] * 100}% / +${Gr.ATTUNE[5] * 100}% to it). Scrapping a piece pays rubies, more for a higher tier.</p></details>`;
        if (!s.satchel.length) return html + '<p class="w-empty">Empty. Forge gear for the game in the Forge tab.</p>';
        const canSend = typeof W.sendToGame === 'function';
        html += `<div class="w-row" style="margin-bottom:8px">${canSend ? '<button class="btn btn-gold btn-sm" id="sendAll">Send everything home</button>' : ''}</div>`;
        html += `<div class="w-grid">${s.satchel.slice().sort((a, b) => Gr.score(b) - Gr.score(a)).map(p => pieceCard(p,
            (canSend ? `<button class="btn btn-sm btn-primary" data-send="${p.id}">Send to the game</button>` : '') + `<button class="btn btn-sm btn-danger" data-scrap="${p.id}">Scrap ♦ ${fmt(60 * (p.t + 1) * (p.t + 1))}</button>`)).join('')}</div>`;
        return html;
    }

    // ---------------- wiring ----------------
    let confirmScrap = 0;
    function wire(body, s) {
        const on = (sel, fn) => UI().on(body, sel, fn);
        on('[data-kind]', (d) => { kind = d.kind; render(); });
        on('[data-add]', (d) => { if (picked.length < R.FORGE.max && pickedCount(d.add) < W.count(s, d.add)) picked.push(d.add); render(); });
        on('[data-del]', (d) => { picked.splice(Number(d.del), 1); render(); });
        const cat = body.querySelector('#useCat');
        if (cat) cat.addEventListener('change', () => { useCat = cat.checked; render(); });
        const clr = body.querySelector('#clearPick');
        if (clr) clr.addEventListener('click', () => { picked = []; render(); });
        const go = body.querySelector('#doForge');
        if (go) go.addEventListener('click', () => forge(kind, picked.slice(), useCat));
        on('[data-forge-go]', () => forge(kind, picked.slice(), useCat));
        const pr = body.querySelector('#practice');
        if (pr) pr.addEventListener('click', practice);
        const sel = body.querySelector('#infuseGear');
        if (sel) sel.addEventListener('change', () => { infuseUid = Number(sel.value); render(); });
        on('[data-infuse]', (d) => { const p = body.querySelector(`[data-sockpick="${d.infuse}"]`); if (p) infuse(infuseUid, Number(d.infuse), p.value); });
        on('[data-up]', (d) => {
            const [where, id] = d.up.split(':');
            const r = W.upgradeRelic(s, where, Number(id));
            if (!r.ok) { WHW.toast(reasonText[r.reason] || "Can't upgrade that.", 'bad'); return; }
            WHW.toast('Upgraded to +' + r.lv + '!', 'gold'); WHW.sfx('craft'); WHW.save(); WHW.refreshPlayer(); render();
        });
        on('[data-scrap]', (d) => {
            const id = Number(d.scrap);
            if (confirmScrap !== id) { confirmScrap = id; const b = body.querySelector(`[data-scrap="${id}"]`); if (b) b.textContent = 'Sure? Scrap it'; return; }
            confirmScrap = 0;
            const got = W.scrapPiece(s, id);
            WHW.toast('Scrapped for ' + fmt(got) + ' rubies.'); WHW.save(); render();
        });
        on('[data-send]', (d) => send([Number(d.send)]));
        const all = body.querySelector('#sendAll');
        if (all) all.addEventListener('click', () => send(s.satchel.map(p => p.id)));
    }
    function send(ids) {
        const g = game(), r = W.sendToGame(g.state, ids, g.ack, Date.now());
        if (!r.ok) { WHW.toast(r.reason === 'none' ? 'Nothing to send.' : "Couldn't send that.", 'bad'); return; }
        WHW.toast('📦 ' + r.n + ' piece' + (r.n > 1 ? 's' : '') + ' on the way to your game: open Items › Gear there.', 'gold');
        WHW.sfx('craft'); WHW.save(); render();
    }

    // Forge: pay, play the Crucible, then show what came out
    function forge(k, ids, catalyst) {
        const g = game(), s = g.state;
        const name = WHW.online && WHW.online.name ? WHW.online.name() : '';
        const c = W.beginForge(s, k, ids, catalyst, Date.now(), name);
        if (!c.ok) { WHW.toast((reasonText[c.reason] || "Can't forge that.") + (c.reason === 'full' ? (k === 'wilds' ? 'your backpack is full.' : 'the Relic Satchel is full.') : ''), 'bad'); return; }
        WHW.save();
        picked = []; useCat = false;
        WHW.craft.open({
            station: 'crucible', tier: ids.length, title: '⚗️ The Crucible', ess: ids.map(id => ({ name: ess(id).name, color: ess(id).color, icon: ess(id).icon })),
            onDone: (score) => {
                const res = W.finishCraft(s, score, Math.random, Date.now(), g.ack);
                WHW.save(); WHW.refreshPlayer();
                if (res && res.item && W.baseOf(res.item).slot === 'weapon' && s.hotbar.includes(null)) { W.equip(s, res.item.uid); WHW.refreshPlayer(); }
                showForged(res, score);
            },
            onCancel: () => { W.abortCraft(s); WHW.save(); WHW.toast('The Crucible cools. Your essences are back; the fee is spent.', 'bad'); },
        });
    }
    function practice() {
        const ids = picked.length ? picked.slice() : ['flint_shard', 'quartz_dust', 'lucky_pebble'];
        WHW.craft.open({ station: 'crucible', tier: ids.length, title: '⚗️ Practice', practice: true, ess: ids.map(id => ({ name: ess(id).name, color: ess(id).color, icon: ess(id).icon })),
            onDone: (score) => { const body = UI().modal('Practice', `<div class="w-result"><div class="score">${score}</div></div><p class="w-note" style="text-align:center">Practice only. With these essences, a real forge at this score would have these odds:</p>${oddsBars(R.forgeOdds({ ess: ids, score, luck: W.playerStats(game().state).luck, pity: game().state.relics.pity }))}<div class="w-row" style="justify-content:center"><button class="btn btn-primary" id="resOk">Back to the Crucible</button></div>`); body.querySelector('#resOk').addEventListener('click', () => open('forge')); },
            onCancel: () => {} });
    }
    const s = () => game().state;
    function showForged(res, score) {
        let html = `<div class="w-result"><div class="score">${score}</div></div>`;
        if (res && res.kind === 'relic') {
            const t = Gr.TIERS[res.tier];
            // the tier springs up in its colour, and the piece glows with it (Legendary and up: bigger)
            html += `<p class="w-forged${res.tier >= 4 ? ' is-high' : ''}" style="--c:${t.color}"><b>${res.tier >= 4 ? '✨ ' : ''}${esc(t.name)}${res.unique ? ' · Unique' : ''}${res.tier >= 4 ? ' ✨' : ''}</b></p>`;
            if (res.item) { const b = W.baseOf(res.item), held = s().hotbar.includes(res.item.uid); html += `<div class="w-card w-forged-card" style="--c:${t.color}"><div class="w-card-top"><div class="w-card-ico">${UI().iconFor(b, res.item)}</div><div><div class="w-card-name" style="color:${t.color}">${esc(W.gearName(res.item))}</div><div class="w-card-sub">${esc(b.name)} · ${held ? 'on your hotbar' : "it's in your backpack"}</div></div></div>${UI().statLine(b, res.item)}</div>`; }
            else if (res.piece) html += `<div class="w-forged-card" style="--c:${t.color}">${pieceCard(res.piece)}</div><p class="w-note" style="text-align:center">It's in your Relic Satchel: send it home from there.</p>`;
            if (res.tier >= 4) { WHW.sfx('boss'); WHW.toast('⚗️ ' + t.name + '!', 'gold'); }
        } else if (res && res.kind === 'infuse') {
            html += res.item ? `<p class="w-note" style="text-align:center">Set: <b>+${res.value}%</b>.${res.combos && res.combos.length ? ' Combo: <b>' + res.combos.map(esc).join(', ') + '</b>!' : ''}</p>` : '<p class="w-note">The piece is gone; your essence is back.</p>';
        }
        html += '<div class="w-row" style="justify-content:center;margin-top:12px"><button class="btn btn-primary" id="resOk">Back to the Crucible</button></div>';
        const body = UI().modal(res && res.kind === 'infuse' ? 'Infused' : 'Forged', html);
        body.querySelector('#resOk').addEventListener('click', () => open());
    }
    // Infuse socket i of a piece with an essence: a short Crucible game sizes it
    function infuse(uid, i, id) {
        const g = game(), s = g.state;
        const r = W.beginInfuse(s, uid, i, id);
        if (!r.ok) { WHW.toast(reasonText[r.reason] || "Can't infuse that.", 'bad'); return; }
        WHW.save();
        WHW.craft.open({ station: 'crucible', tier: 1, title: '⚗️ Infuse', ess: [{ name: ess(id).name, color: ess(id).color, icon: ess(id).icon }],
            onDone: (score) => { const res = W.finishCraft(s, score, Math.random, Date.now(), g.ack); WHW.save(); WHW.refreshPlayer(); showForged(res, score); },
            onCancel: () => { W.abortCraft(s); WHW.save(); WHW.toast('Cancelled: your essence is back.', 'bad'); } });
    }

    WHW.relics = { open, forge, infuse, send, pieceCard, oddsBars, state: () => ({ tab, kind, picked: picked.slice() }) };
})();
