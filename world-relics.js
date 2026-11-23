/**
 * The Crucible's screens (The Wilds, a station in town): forge relics from essences (a weapon, armor or gear for the game),
 * buy blueprints (each lets the forge make one rarer tier, for good), infuse gear's sockets, upgrade relics,
 * and the Relic Satchel (gear for the game, waiting to be sent home). The rules are core/world-relics.js and core/gear.js;
 * the save changes go through core/world-logic.js (beginForge, finishCraft, beginInfuse, upgradeRelic, scrapPiece,
 * sendToGame). The forge and infusing play the Crucible minigame (world-craft.js station 'crucible').
 * WHW.relics = { open(tab), forge(kind, ids, catalyst), ... }
 */
(function () {
    'use strict';
    const D = window.WHWorldData, W = window.WHWorld, R = window.WHWorldRelics, Gr = window.WHGear, Fu = window.WHWorldFuse;
    const WHW = window.WHW;
    const UI = () => WHW.ui;
    const game = () => WHW.game;
    const esc = (s) => UI().esc(s);
    const fmt = (n) => Math.round(n).toLocaleString('en-US');
    const ess = (id) => D.MATERIALS_BY_ID[id];

    let tab = 'forge', kind = 'weapon', picked = [], useCat = false, infuseUid = 0;
    // the Fuse tab: the relics chosen (uids), the essences fed in, ruby steps, a Catalyst, and the Fuse button's first press
    let fusePick = [], fuseEss = [], fuseSteps = 0, fuseCat = false, fuseArmed = false;
    const TABS = { forge: 'Forge', blueprints: 'Blueprints', infuse: 'Infuse', upgrade: 'Upgrade', fuse: 'Fuse', satchel: 'Relic Satchel' };
    const reasonText = { busy: 'Finish your other craft first.', count: 'Put in ' + R.FORGE.min + ' to ' + R.FORGE.max + ' essences.', materials: "You don't have those essences.",
        catalyst: 'You have no Catalyst.', rubies: 'Not enough rubies.', full: 'No room: ', unknown: "That can't go in.", socket: 'No such socket.', max: 'Already +' + Gr.MAX_LEVEL + '.',
        owned: 'You already have that blueprint.', order: 'Buy the blueprint before it first.', glory: 'Not enough Glory.',
        lent: 'Not while you wear a lent tournament kit.', equipped: 'Take it off first.', plain: 'Only relics fuse.', unique: "Uniques can't be fused.", kind: "Weapons and armor don't mix.",
        tier: 'All five must be one tier.', top: 'Mythic and Primordial only come from a forge.', blueprint: "Your blueprints don't reach that tier yet.", feed: 'Too many essences fed in.' };

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
        html += tab === 'forge' ? forgeHtml(s) : tab === 'blueprints' ? blueprintsHtml(s) : tab === 'infuse' ? infuseHtml(s) : tab === 'upgrade' ? upgradeHtml(s) : tab === 'fuse' ? fuseHtml(s) : satchelHtml(s);
        body.innerHTML = html;
        UI().wireTabs(body, (t) => { tab = t; render(); });
        wire(body, s);
    }

    // ---------------- forge ----------------
    const owned = (s) => D.ESSENCE_IDS.filter(id => W.count(s, id) > 0);
    const pickedCount = (id) => picked.filter(x => x === id).length;
    function oddsBars(o, maxTier = Gr.TIERS.length - 1) {
        return `<div class="w-odds">${o.map((p, t) => t > maxTier ? `<div class="w-odds-row is-locked" title="Needs its blueprint (Blueprints tab)"><span style="color:${Gr.TIERS[t].color}">${esc(Gr.TIERS[t].name)}</span><i></i><em>🔒</em></div>` : `<div class="w-odds-row"><span style="color:${Gr.TIERS[t].color}">${esc(Gr.TIERS[t].name)}</span>
            <i><b style="width:${Math.max(p > 0 ? 1 : 0, Math.min(100, p * 100)).toFixed(1)}%;background:${Gr.TIERS[t].color}"></b></i><em>${p >= 0.1 ? (p * 100).toFixed(0) : p >= 0.01 ? (p * 100).toFixed(1) : p > 0 ? (p * 100).toFixed(2) : '0'}%</em></div>`).join('')}</div>`;
    }
    function forgeHtml(s) {
        const list = owned(s), luck = W.playerStats(s).luck, cat = W.count(s, 'catalyst');
        if (useCat && !cat) useCat = false;
        picked = picked.filter(id => pickedCount(id) <= W.count(s, id));
        const c = W.canForge(s, kind, picked, useCat);
        const max = s.relics.bp;
        const odds = R.forgeOdds({ ess: picked, score: 70, luck, catalyst: useCat, pity: s.relics.pity, maxTier: max });
        const reso = R.resonant(picked);
        let html = `<details class="w-how"><summary>Put in <b>${R.FORGE.min} to ${R.FORGE.max} essences</b>, choose what to make, and play the Crucible: out comes one random relic.</summary>
            <p>Its <b>relic tier</b>, from Common to Primordial, comes from the essences' rarity most of all, then how many you put in (each counts a little less), your score, your luck, <b>Resonance</b> (every essence of one aspect), a <b>Catalyst</b> (never Common) and your bad luck so far (each forge without a Legendary helps the next a little). Its boosts follow the aspects you put in, and its colours are your essences'. <b>Mythic and Primordial stay rare whatever you put in</b>: at most ${R.FORGE.caps[5] * 100}% and ${R.FORGE.caps[6] * 100}% a forge.</p>
            <p>Without <b>blueprints</b> the Crucible makes at most a <b style="color:${Gr.TIERS[R.BASE_MAX].color}">${esc(Gr.TIERS[R.BASE_MAX].name)}</b>. Each blueprint (Blueprints tab) lets every forge after it reach one tier higher, for good; a roll above what you can make comes out as the best tier you can.</p></details>
            <div class="w-chips w-make" role="group" aria-label="Make">
                <button class="w-chip${kind === 'weapon' ? ' is-on' : ''}" data-kind="weapon" aria-pressed="${kind === 'weapon'}">⚔️ Weapon <small>a sword, dagger, spear, bow, revolver or staff at gear tier ${W.relicGearTier(s)}</small></button>
                <button class="w-chip${kind === 'armor' ? ' is-on' : ''}" data-kind="armor" aria-pressed="${kind === 'armor'}">🛡️ Armor <small>a helmet, chest, boots or shield at gear tier ${W.relicGearTier(s)}</small></button>
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
            <p class="w-note" style="margin:6px 0">${reso ? '✨ <b>Resonance</b>: every essence shares one aspect. ' : ''}${s.relics.pity ? `🍀 ${s.relics.pity} forge${s.relics.pity > 1 ? 's' : ''} since your last Legendary: the next is a little luckier. ` : ''}Odds with a good game (score 70)${max < Gr.TIERS.length - 1 ? `, up to <b style="color:${Gr.TIERS[max].color}">${esc(Gr.TIERS[max].name)}</b> with your blueprints` : ''}:</p>
            ${oddsBars(odds, max)}
            ${picked.length ? `<p class="w-note">Boosts it can get: ${Object.entries(R.aspectPoints(picked)).sort((a, b) => b[1] - a[1]).map(([a]) => D.ASPECTS[a].icon + ' ' + esc(D.ASPECTS[a].name) + ' <small>(' + esc(kind === 'game' ? D.ASPECTS[a].game : D.ASPECTS[a].wilds) + ')</small>').join(', ')}</p>` : ''}
            <div class="w-card-actions"><button class="btn btn-gold" id="doForge" ${c.ok ? '' : 'disabled'}>Forge · ♦ ${fmt(c.fee)}</button><button class="btn btn-ghost btn-sm" id="practice">Practice</button>${picked.length ? '<button class="btn btn-ghost btn-sm" id="clearPick">Empty it</button>' : ''}</div>
            ${!c.ok && picked.length ? `<p class="w-note" style="color:#ffb3bb">${esc(reasonText[c.reason] || '')}${c.reason === 'full' ? (kind !== 'game' ? 'your backpack is full.' : 'the Relic Satchel is full: send pieces home first.') : ''}</p>` : ''}
            <p class="w-note">Forged so far: <b>${fmt(s.relics.forged)}</b>${s.relics.best >= 0 ? ` · best <b style="color:${Gr.TIERS[s.relics.best].color}">${esc(Gr.TIERS[s.relics.best].name)}</b>` : ''}${s.relics.uniques ? ` · uniques <b>${s.relics.uniques}</b>` : ''}</p>
            ${uniqueHints(kind, picked, max)}</section></div>`;
        // on a phone the panels stack, the Forge button far below the essences: this bar keeps it at hand
        const legend = odds.slice(4).reduce((a, p) => a + p, 0);
        html += `<div class="w-forge-bar"><span><b>${picked.length} / ${R.FORGE.max}</b> in${picked.length ? (max >= 4 ? ` · <b style="color:${Gr.TIERS[4].color}">Legendary+</b> ${legend >= 0.1 ? Math.round(legend * 100) : (legend * 100).toFixed(1)}%` : ` · up to <b style="color:${Gr.TIERS[max].color}">${esc(Gr.TIERS[max].name)}</b>`) : ''}</span>
            <button class="btn btn-gold btn-sm" data-forge-go ${c.ok ? '' : 'disabled'}>Forge · ♦ ${fmt(c.fee)}</button></div>`;
        return html;
    }
    // which uniques these essences could make (on a Legendary or better forge, so only with the Legendary blueprint)
    function uniqueHints(k, ids, max) {
        const list = k === 'game' ? R.uniquesFor('game', ids) : R.uniquesFor('wilds', ids, k);
        if (!list.length) return '';
        return `<details class="w-uniques"><summary>Uniques these essences could make (Legendary or better, ${Math.round(R.FORGE.uniqueChance * 100)}% of those${max < 4 ? '; needs the Legendary blueprint' : ''})</summary><div class="w-grid">${list.map(u => `<div class="w-card"><div class="w-card-top"><div class="w-card-ico">${Gr.iconSvg({ shape: u.shape, tier: 4, outline: u.outline, main: '#d9c27a', trim: '#8a7a5a', uid: 'h' + u.id })}</div><div><div class="w-card-name">${esc(u.name)}</div><div class="w-card-sub">${esc(u.desc)}</div></div></div></div>`).join('')}</div></details>`;
    }

    // ---------------- blueprints ----------------
    function blueprintsHtml(s) {
        const have = s.relics.bp, next = W.nextBlueprint(s);
        // the explainer stays open until the first blueprint is bought
        let html = `<details class="w-how"${have <= R.BASE_MAX ? ' open' : ''}><summary>Blueprints let the Crucible forge rarer gear: each one, for good, raises the best tier a forge can make by one.</summary>
            <p>Without any, a forge makes at most a <b style="color:${Gr.TIERS[R.BASE_MAX].color}">${esc(Gr.TIERS[R.BASE_MAX].name)}</b>. They go in order. Epic and Legendary cost rubies; Mythic and Primordial cost <b>Glory</b> (won in the Arena, the Pit and waves). A blueprint only opens the chance: the essences, your game, luck and the rest still decide what comes out, and Mythic and Primordial stay rare. Uniques need the Legendary one. It works for weapons, armor and gear for the game alike.</p></details>
`;
        // the ladder: every tier, the ones you can already forge lit up
        html += `<ol class="w-bp-ladder" aria-label="Tiers the Crucible can forge">${Gr.TIERS.map((t, i) => {
            const st = i <= have ? 'is-on' : next && i === next.tier ? 'is-next' : 'is-off';
            return `<li class="${st}" style="--q:${t.color}">${i <= have ? '<span>✓</span>' : '<span>🔒</span>'}${esc(t.name)}</li>`;
        }).join('')}</ol>`;
        html += `<p class="w-note w-bp-wallet">You can forge up to <b style="color:${Gr.TIERS[have].color}">${esc(Gr.TIERS[have].name)}</b>${next ? '' : ': every blueprint is yours'}. <span>♦ <b>${fmt(s.rubies)}</b> rubies</span> <span>🏆 <b>${fmt(s.arena.glory)}</b> Glory</span></p>`;
        html += `<div class="w-grid w-bp-grid">${R.BLUEPRINTS.map(b => {
            const t = Gr.TIERS[b.tier], c = W.canBuyBlueprint(s, b.tier), owned = b.tier <= have;
            const price = b.rubies ? '♦ ' + fmt(b.rubies) + ' rubies' : '🏆 ' + fmt(b.glory) + ' Glory';
            let foot;
            if (owned) foot = '<span class="w-bp-owned">✓ Yours</span>';
            else if (c.reason === 'order') foot = `<span class="w-bp-price">${price}</span><span class="muted">🔒 After the ${esc(Gr.TIERS[b.tier - 1].name)} blueprint</span>`;
            else {
                // the next one: a gold button when you can pay, otherwise how close you are
                const cost = b.rubies || b.glory, got = Math.min(cost, b.rubies ? s.rubies : s.arena.glory);
                foot = `<button class="btn btn-sm${c.ok ? ' btn-gold' : ''}" data-bp="${b.tier}" ${c.ok ? '' : 'disabled'}>Buy · ${price}</button>`
                    + (c.ok ? '' : `<div class="w-bp-progress" title="${fmt(got)} / ${fmt(cost)}"><i style="width:${Math.floor(got / cost * 100)}%"></i></div><span class="muted">${b.rubies ? '♦ ' + fmt(c.need) + ' more rubies' : fmt(c.need) + ' more Glory'} to go</span>`);
            }
            const state = owned ? 'is-owned' : c.reason === 'order' ? 'is-locked' : 'is-next';
            return `<div class="w-card w-bp ${state}" style="--q:${t.color}"><div class="w-card-top"><div class="w-card-ico">📜</div><div><div class="w-card-name" style="color:${t.color}">${esc(t.name)} Blueprint</div>
                <div class="w-card-sub">Forge <b style="color:${t.color}">${esc(t.name)}</b> gear: ${t.lines} boost${t.lines > 1 ? 's' : ''}${b.tier === 4 ? ', and uniques' : ''}</div></div></div>
                <div class="w-card-actions">${foot}</div></div>`;
        }).join('')}</div>`;
        return html;
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

    // ---------------- fuse (core/world-fuse.js) ----------------
    // Five Wilds relics of one tier and kind in; one a tier higher out, or all five lost. Essences, rubies and a Catalyst fed
    // in raise the chance.
    const pct = (p) => Math.round(p * 100) + '%';
    function fuseState(s) {
        // what was chosen, kept only while it still can go in (traded away, worn, or the tab came back later)
        fusePick = fusePick.filter(uid => { const it = W.findGear(s, uid); return it && it.r && !it.r.q && Fu.partOf(it) && !W.isEquipped(s, uid); });
        const first = W.findGear(s, fusePick[0]);
        fusePick = fusePick.filter(uid => { const it = W.findGear(s, uid); return !first || (it.r.t === first.r.t && Fu.partOf(it) === Fu.partOf(first)); }).slice(0, Fu.COUNT);
        const counts = {};
        fuseEss = fuseEss.filter(id => (counts[id] = (counts[id] || 0) + 1) <= W.count(s, id)).slice(0, Fu.FEED.maxEss);
        if (fuseCat && !W.count(s, 'catalyst')) fuseCat = false;
        return first;
    }
    function fuseHtml(s) {
        const first = fuseState(s), bp = Math.min(s.relics.bp, Fu.MAX_TARGET);
        const target = first ? first.r.t + 1 : 0, items = fusePick.map(uid => W.findGear(s, uid));
        const c = W.canFuse(s, fusePick, { ess: fuseEss, steps: fuseSteps, catalyst: fuseCat });
        let html = `<details class="w-how"><summary>Put in <b>${Fu.COUNT} Wilds relics</b> of one tier and kind (weapons, or armor): they fuse into <b>one relic a tier higher</b>, or <b>all ${Fu.COUNT} are lost</b>.</summary>
            <p>The chance starts lower the rarer the result: ${Fu.BASE.slice(1).map((p, i) => `<b style="color:${Gr.TIERS[i + 1].color}">${esc(Gr.TIERS[i + 1].name)}</b> ${pct(p)}`).join(', ')}. Feed in <b>essences</b> (rarer ones count more, and each counts less the rarer the result), <b>rubies</b> (up to ${Fu.FEED.steps} steps of +${pct(Fu.FEED.step)}) and a <b>Crucible Catalyst</b> (+${pct(Fu.FEED.catalyst)}) to raise it, up to ${Fu.CAP.slice(1).map((p, i) => pct(p) + ' for ' + esc(Gr.TIERS[i + 1].name)).join(', ')}: never certain.</p>
            <p>It never makes a tier your blueprints don't reach yet, and never <b>Mythic</b> or <b>Primordial</b> (those come only from a forge). Uniques, pieces you wear and gear for the game can't go in. What comes out is one of the five's kinds at the best gear tier among them, with their average quality and boosts drawn from theirs; it starts at +0. Essences set in the five come back to you either way; upgrades are lost.</p></details>`;
        // the relics that could go in, rarest first; once one is chosen, only its tier and kind
        const all = s.gear.filter(it => it.r && Fu.partOf(it)).sort((a, b) => b.r.t - a.r.t || (Fu.partOf(a) < Fu.partOf(b) ? -1 : 1) || b.score - a.score);
        html += `<div class="w-forge"><section class="w-panel"><h3>Your Wilds relics</h3>`;
        if (!all.length) html += '<p class="w-empty">None yet. Forge a weapon or armor in the Forge tab: every relic of the same tier and kind can be fused, five at a time.</p>';
        for (let t = Gr.TIERS.length - 1; t >= 0; t--) {
            const tierList = all.filter(it => it.r.t === t);
            if (!tierList.length) continue;
            const can = t + 1 <= bp;
            html += `<h4 style="color:${Gr.TIERS[t].color}">${esc(Gr.TIERS[t].name)} <small class="muted">${can ? '→ ' + esc(Gr.TIERS[t + 1].name) : t + 1 > Fu.MAX_TARGET ? '(fusing stops at ' + esc(Gr.TIERS[Fu.MAX_TARGET].name) + ')' : '(needs the ' + esc(Gr.TIERS[t + 1].name) + ' blueprint)'}</small></h4><div class="w-grid w-fuse-grid">`;
            html += tierList.map(it => {
                const on = fusePick.includes(it.uid), worn = W.isEquipped(s, it.uid), uniq = !!it.r.q;
                const clash = first && !on && (it.r.t !== first.r.t || Fu.partOf(it) !== Fu.partOf(first));
                const why = worn ? 'worn' : uniq ? 'unique' : '';
                const off = worn || uniq || !can || clash || (!on && fusePick.length >= Fu.COUNT);
                const extra = [it.r.lv ? '+' + it.r.lv + ' (lost)' : '', it.k && it.k.some(Boolean) ? 'socketed (essences back)' : ''].filter(Boolean).join(' · ');
                return `<button class="w-card w-fuse-pick${on ? ' is-on' : ''}" data-fpick="${it.uid}" ${off && !on ? 'disabled' : ''} aria-pressed="${on}" style="--q:${Gr.TIERS[t].color}">
                    <span class="w-card-top"><span class="w-card-ico">${UI().iconFor(W.baseOf(it), it)}</span><span><span class="w-card-name" style="color:${Gr.TIERS[t].color}">${esc(W.gearName(it))}</span>
                    <span class="w-card-sub">${Fu.partOf(it) === 'weapon' ? '⚔️ Weapon' : '🛡️ Armor'} · ${esc(W.qualityOf(it.score).name)}${why ? ' · ' + why : ''}${extra ? ' · ' + extra : ''}</span></span></span></button>`;
            }).join('') + '</div>';
        }
        html += `</section><section class="w-panel"><h3>To fuse <span class="muted">${fusePick.length} / ${Fu.COUNT}</span></h3>`;
        html += `<div class="w-ess-picked">${items.map(it => `<button class="w-ess is-on" data-funpick="${it.uid}" style="--c:${Gr.TIERS[it.r.t].color}" title="Take it out"><span class="w-ess-dot"></span>${esc(W.gearName(it))} ✕</button>`).join('') || '<span class="muted">Empty. Pick five relics of one tier and kind from your list.</span>'}</div>`;
        if (!first) return html + `<p class="w-note">Pick a relic to see what the five would become, its chance and what feeding it costs.</p><p class="w-note">Fused so far: <b>${fmt(s.relics.fused)}</b> of ${fmt(s.relics.fuseTries)} tries</p></section></div>`;
        html += `<p class="w-note">${fusePick.length} ${esc(Gr.TIERS[first.r.t].name)} ${Fu.partOf(first) === 'weapon' ? 'weapons' : 'armor pieces'} → <b style="color:${(Gr.TIERS[target] || Gr.TIERS[first.r.t]).color}">${target <= Fu.MAX_TARGET ? esc(Gr.TIERS[target].name) : '—'}</b>${c.reason === 'blueprint' || c.reason === 'top' ? ` <span style="color:#ffb3bb">${esc(reasonText[c.reason])}</span>` : ''}</p>`;
        // feeding it: essences, rubies, a Catalyst (the chance shown for what these would become, even past the limits)
        const list = owned(s), tgt = Math.max(1, Math.min(Fu.MAX_TARGET, target));
        const left = (id) => W.count(s, id) - fuseEss.filter(x => x === id).length;
        html += `<h4>Feed it <small class="muted">(${fuseEss.length} / ${Fu.FEED.maxEss} essences)</small></h4>`;
        html += `<div class="w-ess-picked">${fuseEss.map((id, i) => `<button class="w-ess is-on" data-fdel="${i}" style="--c:${ess(id).color}" title="Take it out"><span class="w-ess-dot"></span>${ess(id).icon} ${esc(ess(id).name)} +${(Fu.essBoost(id, tgt) * 100).toFixed(1)}% ✕</button>`).join('') || '<span class="muted">No essences fed in.</span>'}</div>`;
        if (list.length) html += `<label class="w-sort">Add an essence <select id="fuseAdd"><option value="">Choose…</option>${list.slice().sort((a, b) => ess(b).rar - ess(a).rar).map(id => `<option value="${id}" ${left(id) <= 0 || fuseEss.length >= Fu.FEED.maxEss ? 'disabled' : ''}>${ess(id).icon} ${esc(ess(id).name)} (${esc(D.ESSENCE_RARITY[ess(id).rar].name)}) ×${left(id)} · +${(Fu.essBoost(id, tgt) * 100).toFixed(1)}%</option>`).join('')}</select></label>`;
        html += `<div class="w-row w-fuse-rubies"><span>♦ Rubies: <b>${fuseSteps}</b> / ${Fu.FEED.steps} steps (+${pct(fuseSteps * Fu.FEED.step)}) · ♦ ${fmt(Fu.rubyCost(tgt, fuseSteps))}</span>
            <button class="btn btn-ghost btn-sm" data-fsteps="-1" ${fuseSteps <= 0 ? 'disabled' : ''} aria-label="One ruby step less">−</button><button class="btn btn-ghost btn-sm" data-fsteps="1" ${fuseSteps >= Fu.FEED.steps ? 'disabled' : ''} aria-label="One ruby step more">+</button>
            <small class="muted">each step ♦ ${fmt(Fu.rubyCost(tgt, 1))}</small></div>`;
        const cat = W.count(s, 'catalyst');
        if (cat) html += `<label class="w-check"><input type="checkbox" id="fuseCat" ${fuseCat ? 'checked' : ''}> ⚗️ Feed in a Crucible Catalyst (you have ${cat}): +${pct(Fu.FEED.catalyst)}</label>`;
        // the chance, and the button (a second press to be sure: failing loses all five)
        const p = c.chance !== undefined ? c.chance : Fu.chance(tgt, { ess: fuseEss, steps: fuseSteps, catalyst: fuseCat });
        html += `<div class="w-odds"><div class="w-odds-row"><span style="color:${Gr.TIERS[tgt].color}">Fuses</span><i><b style="width:${(p * 100).toFixed(1)}%;background:${Gr.TIERS[tgt].color}"></b></i><em>${pct(p)}</em></div>
            <div class="w-odds-row"><span>All lost</span><i><b style="width:${((1 - p) * 100).toFixed(1)}%;background:#ff5a6e"></b></i><em>${pct(1 - p)}</em></div></div>`;
        html += `<div class="w-card-actions"><button class="btn ${fuseArmed ? 'btn-danger' : 'btn-gold'}" id="doFuse" ${c.ok ? '' : 'disabled'}>${fuseArmed ? 'Sure? ' + pct(1 - p) + ' to lose all ' + Fu.COUNT : 'Fuse · ' + pct(p)}</button>${fusePick.length || fuseEss.length || fuseSteps ? '<button class="btn btn-ghost btn-sm" id="fuseClear">Empty it</button>' : ''}</div>`;
        if (!c.ok && fusePick.length === Fu.COUNT && c.reason !== 'blueprint' && c.reason !== 'top') html += `<p class="w-note" style="color:#ffb3bb">${esc(reasonText[c.reason] || "Can't fuse that.")}</p>`;
        html += `<p class="w-note">Fused so far: <b>${fmt(s.relics.fused)}</b> of ${fmt(s.relics.fuseTries)} tries</p></section></div>`;
        return html;
    }
    function fuse() {
        const g = game(), s = g.state;
        const name = WHW.online && WHW.online.name ? WHW.online.name() : '';
        const r = W.fuseRelics(s, fusePick.slice(), { ess: fuseEss.slice(), steps: fuseSteps, catalyst: fuseCat }, Math.random, Date.now(), name);
        fuseArmed = false;
        if (!r.ok) { WHW.toast(reasonText[r.reason] || "Can't fuse that.", 'bad'); render(); return; }
        fusePick = []; fuseEss = []; fuseSteps = 0; fuseCat = false;
        WHW.save(); WHW.refreshPlayer();
        const back = Object.entries(r.back || {}).map(([id, n]) => (n > 1 ? n + ' ' : '') + ess(id).icon + ' ' + esc(ess(id).name)).join(', ');
        const t = Gr.TIERS[r.target];
        let html;
        if (r.fused) {
            const b = W.baseOf(r.item);
            html = `<p class="w-forged${r.target >= 4 ? ' is-high' : ''}" style="--c:${t.color}"><b>${r.target >= 4 ? '✨ ' : ''}Fused: ${esc(t.name)}${r.target >= 4 ? ' ✨' : ''}</b></p>
                <div class="w-card w-forged-card" style="--c:${t.color}"><div class="w-card-top"><div class="w-card-ico">${UI().iconFor(b, r.item)}</div><div><div class="w-card-name" style="color:${t.color}">${esc(W.gearName(r.item))}</div><div class="w-card-sub">${esc(b.name)} · it's in your backpack</div></div></div>${UI().statLine(b, r.item)}</div>`;
            WHW.sfx(r.target >= 4 ? 'boss' : 'craft');
        } else {
            html = `<p class="w-forged" style="--c:#ff5a6e"><b>The Crucible flares and goes dark</b></p><p class="w-note" style="text-align:center">The fusion failed (it had a ${pct(r.chance)} chance): all ${Fu.COUNT} relics are lost.</p>`;
            WHW.sfx('hurt');
        }
        if (back) html += `<p class="w-note" style="text-align:center">Back from their sockets: ${back}.</p>`;
        html += '<div class="w-row" style="justify-content:center;margin-top:12px"><button class="btn btn-primary" id="resOk">Back to the Crucible</button></div>';
        const body = UI().modal(r.fused ? 'Fused' : 'Lost', html);
        body.querySelector('#resOk').addEventListener('click', () => open('fuse'));
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
        on('[data-bp]', (d) => {
            const r = W.buyBlueprint(s, Number(d.bp));
            if (!r.ok) { WHW.toast(reasonText[r.reason] || "Can't buy that.", 'bad'); return; }
            const t = Gr.TIERS[Number(d.bp)];
            WHW.toast('📜 ' + t.name + ' Blueprint: the Crucible can now forge ' + t.name + ' gear.', 'gold'); WHW.sfx('craft'); WHW.save(); render();
        });
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
        // the Fuse tab
        on('[data-fpick]', (d) => { const uid = Number(d.fpick), i = fusePick.indexOf(uid); if (i >= 0) fusePick.splice(i, 1); else if (fusePick.length < Fu.COUNT) fusePick.push(uid); fuseArmed = false; render(); });
        on('[data-funpick]', (d) => { fusePick = fusePick.filter(u => u !== Number(d.funpick)); fuseArmed = false; render(); });
        on('[data-fdel]', (d) => { fuseEss.splice(Number(d.fdel), 1); fuseArmed = false; render(); });
        on('[data-fsteps]', (d) => { fuseSteps = Math.max(0, Math.min(Fu.FEED.steps, fuseSteps + Number(d.fsteps))); fuseArmed = false; render(); });
        const fAdd = body.querySelector('#fuseAdd');
        if (fAdd) fAdd.addEventListener('change', () => { if (fAdd.value && fuseEss.length < Fu.FEED.maxEss) fuseEss.push(fAdd.value); fuseArmed = false; render(); });
        const fCat = body.querySelector('#fuseCat');
        if (fCat) fCat.addEventListener('change', () => { fuseCat = fCat.checked; fuseArmed = false; render(); });
        const fClr = body.querySelector('#fuseClear');
        if (fClr) fClr.addEventListener('click', () => { fusePick = []; fuseEss = []; fuseSteps = 0; fuseCat = false; fuseArmed = false; render(); });
        const fGo = body.querySelector('#doFuse');
        if (fGo) fGo.addEventListener('click', () => { if (!fuseArmed) { fuseArmed = true; render(); return; } fuse(); });
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
        if (!c.ok) { WHW.toast((reasonText[c.reason] || "Can't forge that.") + (c.reason === 'full' ? (k !== 'game' ? 'your backpack is full.' : 'the Relic Satchel is full.') : ''), 'bad'); return; }
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
            onDone: (score) => { const body = UI().modal('Practice', `<div class="w-result"><div class="score">${score}</div></div><p class="w-note" style="text-align:center">Practice only. With these essences, a real forge at this score would have these odds:</p>${oddsBars(R.forgeOdds({ ess: ids, score, luck: W.playerStats(game().state).luck, pity: game().state.relics.pity, maxTier: game().state.relics.bp }), game().state.relics.bp)}<div class="w-row" style="justify-content:center"><button class="btn btn-primary" id="resOk">Back to the Crucible</button></div>`); body.querySelector('#resOk').addEventListener('click', () => open('forge')); },
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

    WHW.relics = { open, forge, infuse, send, pieceCard, oddsBars, state: () => ({ tab, kind, picked: picked.slice(), fusePick: fusePick.slice(), fuseEss: fuseEss.slice(), fuseSteps }) };
})();
