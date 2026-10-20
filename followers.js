// followers.js — Followers page: team, collection, packs, breeding, levelling and the Followerdex.
// Rules, data and art live in followers-data.js (window.WHF), which the main game also loads to apply buffs.
(function () {
    'use strict';
    const W = window.WHF;
    const R = W.RARITIES;
    const $ = id => document.getElementById(id);

    let state = W.loadState();
    let tab = 'team';
    const filters = { family: 'all', rarity: 'all', sort: 'rarity' };
    const breedPick = [null, null];
    let modalCtx = null; // what the open modal is showing, so it can re-render after changes

    // ---------------- helpers ----------------
    function esc(s) { return String(s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c])); }
    function spOf(f) { return W.SPECIES_BY_ID[f.sp]; }
    function fmt(n) { return Math.round(Number(n) || 0).toLocaleString(); }
    function pct(p) { const v = p * 100; return (v >= 10 || v === 0 ? Math.round(v) : v < 1 ? v.toFixed(2) : v.toFixed(1)) + '%'; }
    function refresh() { state = W.loadState(); }
    // every change re-reads storage first, so a second open tab can't be overwritten with stale data
    function mutate(fn) {
        refresh();
        const result = fn(state);
        if (result !== false) W.saveState(state);
        renderAll();
        return result;
    }
    function toast(msg, kind) {
        const el = document.createElement('div');
        el.className = 'toast' + (kind ? ' toast--' + kind : '');
        el.textContent = msg;
        $('flToast').appendChild(el);
        setTimeout(() => el.remove(), 3200);
    }
    function sortByRarity(a, b) {
        const sa = spOf(a), sb = spOf(b);
        return (sb.rarity - sa.rarity) || (b.lvl - a.lvl) || (Number(b.shiny) - Number(a.shiny)) || (sa.index - sb.index) || (a.id - b.id);
    }
    function buffList(f, withSynergy) {
        const syn = withSynergy ? W.synergyFor(state, f) : 0;
        return W.followerBuffs(f, syn).map(b => W.fmtBuff(b.type, b.value));
    }

    // ---------------- cards ----------------
    function cardHtml(f, opts) {
        opts = opts || {};
        const sp = spOf(f), r = R[sp.rarity];
        const eq = W.isEquipped(state, f.id);
        const badges = (f.shiny ? '<span class="b-shiny" title="Shiny: +25% to buffs">✦ Shiny</span>' : '') +
            (eq ? '<span class="b-eq">Team</span>' : '') +
            (f.locked ? '<span title="Locked: can\'t be sacrificed">🔒</span>' : '') +
            (f.gen > 1 ? `<span class="b-gen" title="Generation ${f.gen}">G${f.gen}</span>` : '');
        return `<button type="button" class="fcard r${sp.rarity}${f.shiny ? ' shiny' : ''}${opts.selected ? ' selected' : ''}" data-id="${f.id}"${opts.disabled ? ' disabled' : ''}>
            <span class="fcard-art">${W.art(f.sp, { shiny: f.shiny })}</span>
            <span class="badges">${badges}</span>
            <span class="fcard-name">${esc(sp.name)}</span>
            <span class="fcard-meta"><span class="rar">${r.name}</span><span class="lv">Lv ${f.lvl}</span></span>
        </button>`;
    }

    // ---------------- header ----------------
    function renderHeader() {
        $('flGolden').textContent = fmt(W.getGolden());
        $('flCount').textContent = `${state.list.length} / ${W.INVENTORY_CAP}`;
        $('flDex').textContent = `${Object.keys(state.seen).length} / ${W.SPECIES.length}`;
        const ready = state.nursery.filter(W.eggReady).length;
        $('breedBadge').hidden = !ready;
        $('breedBadge').textContent = ready;
    }
    // live countdown: text (data-cd="text", data-prefix) or progress bar (data-cd="bar", data-total), both with data-until
    function countdown(until, total, prefix) {
        return {
            text: `<span data-cd="text" data-until="${until}" data-prefix="${esc(prefix || '')}">${esc(prefix || '')}${W.fmtDuration(until - Date.now())}</span>`,
            bar: `<div class="cd-bar"><i data-cd="bar" data-until="${until}" data-total="${total}" style="width:${Math.max(0, Math.min(100, (1 - (until - Date.now()) / total) * 100))}%"></i></div>`,
        };
    }

    // ---------------- team ----------------
    function renderTeam() {
        const html = [];
        for (let i = 0; i < W.MAX_SLOTS; i++) {
            if (i < state.slots) {
                const f = state.equipped[i] != null ? W.findFollower(state, state.equipped[i]) : null;
                if (!f) { html.push(`<button type="button" class="slot" data-slot="${i}"><span class="slot-plus">+</span>Add a follower</button>`); continue; }
                const sp = spOf(f), syn = W.synergyFor(state, f);
                html.push(`<div class="slot-filled r${sp.rarity}">
                    <span class="fcard-art" data-id="${f.id}" title="Details">${W.art(f.sp, { shiny: f.shiny })}</span>
                    <div>
                        <div class="slot-name">${esc(sp.name)}</div>
                        <div style="font-size:12px"><span class="rar-text">${R[sp.rarity].name}</span> · Lv ${f.lvl}${f.shiny ? ' · <span style="color:#ffe066">✦</span>' : ''}</div>
                        <ul class="buff-lines">${buffList(f, true).map(t => `<li>${t}</li>`).join('')}${syn ? `<li class="syn">family bonus +${Math.round(syn * W.SYNERGY_PER_MATE * 100)}%</li>` : ''}</ul>
                        <button type="button" class="btn btn-ghost btn-sm" data-unequip="${i}">Remove</button>
                    </div>
                </div>`);
            } else if (i === state.slots) {
                const cost = W.SLOT_COSTS[i - W.START_SLOTS];
                html.push(`<button type="button" class="slot slot--buy" id="buySlotBtn"><span class="slot-plus">🔓</span>Unlock slot ${i + 1}<span>${cost} Golden</span></button>`);
            } else {
                html.push(`<div class="slot slot--locked"><span class="slot-plus">🔒</span>Slot ${i + 1}</div>`);
            }
        }
        $('teamSlots').innerHTML = html.join('');
        const t = W.computeBonuses(state);
        const chips = [];
        if (t.cps) chips.push(`+${fmt(t.cps)}% CPS`);
        if (t.click) chips.push(`+${fmt(t.click)}% click power`);
        if (t.offline) chips.push(`+${fmt(t.offline)}% offline earnings`);
        if (t.critChance) chips.push(`+${(Math.round(t.critChance * 10) / 10)}% crit chance`);
        if (t.critDmg) chips.push(`+${fmt(t.critDmg)}% crit damage`);
        if (t.gems) chips.push(`+${fmt(t.gems)}% gem drop rate`);
        if (t.golden) chips.push(`+${fmt(t.golden)}% Golden from prestige`);
        $('teamTotals').innerHTML = chips.length
            ? '<span class="panel-note" style="align-self:center">Team total:</span>' + chips.map(c => `<span class="total-chip">${c}</span>`).join('')
            : '<span class="panel-note">No followers equipped yet. Open a pack, then add followers to your team.</span>';
    }

    function renderFilters() {
        const fam = $('fltFamily'), rar = $('fltRarity');
        if (!fam.options.length) {
            fam.innerHTML = '<option value="all">All families</option>' + W.FAMILY_IDS.map(id => `<option value="${id}">${W.FAMILIES[id].icon} ${W.FAMILIES[id].name}</option>`).join('');
            rar.innerHTML = '<option value="all">All rarities</option>' + R.map((r, i) => `<option value="${i}">${r.name}</option>`).join('');
        }
        fam.value = filters.family; rar.value = filters.rarity; $('fltSort').value = filters.sort;
    }
    function filteredList(list, f) {
        f = f || filters;
        let out = list.filter(x => (f.family === 'all' || spOf(x).family === f.family) && (f.rarity === 'all' || String(spOf(x).rarity) === String(f.rarity)));
        if (f.sort === 'level') out.sort((a, b) => (b.lvl - a.lvl) || sortByRarity(a, b));
        else if (f.sort === 'newest') out.sort((a, b) => b.id - a.id);
        else if (f.sort === 'family') out.sort((a, b) => (W.FAMILY_IDS.indexOf(spOf(a).family) - W.FAMILY_IDS.indexOf(spOf(b).family)) || sortByRarity(a, b));
        else out.sort(sortByRarity);
        return out;
    }
    function renderCollection() {
        renderFilters();
        if (!state.list.length) {
            $('collection').innerHTML = `<div class="empty" style="grid-column:1/-1">You don't have any followers yet. <button type="button" class="btn btn-gold btn-sm" data-goto="packs">Open a pack</button></div>`;
            return;
        }
        const list = filteredList(state.list);
        $('collection').innerHTML = list.length ? list.map(f => cardHtml(f)).join('') : '<div class="empty" style="grid-column:1/-1">No followers match these filters.</div>';
    }

    // ---------------- packs ----------------
    function renderPacks() {
        const golden = W.getGolden();
        $('packNote').innerHTML = `You have <b>${fmt(golden)} Golden</b>. Get more by prestiging in the main game. Each Golden you hold adds +10% CPS, so spending it here trades some of that bonus for followers. ` +
            `Pity: a Legendary is guaranteed within <b>${W.PITY_LIMIT - state.pity}</b> more followers.`;
        $('packGrid').innerHTML = W.PACKS.map(p => {
            const total = p.weights.reduce((a, w) => a + w, 0);
            const odds = p.weights.map((w, i) => w > 0 ? `<span class="odd r${i}"><span class="rar-text">${R[i].name}</span> <b>${pct(w / total)}</b></span>` : '').join('');
            const fams = p.families ? p.families.map(id => `${W.FAMILIES[id].icon} ${W.FAMILIES[id].name}`).join(' · ') : 'All families';
            const extras = [`${p.count} follower${p.count > 1 ? 's' : ''}`];
            if (p.guarantee) extras.push(`${R[p.guarantee].name}+ guaranteed`);
            const wait = W.packWait(state, p.id);
            let action;
            if (wait > 0) {
                const cd = countdown(state.packReadyAt[p.id], p.cooldown, 'Ready in ');
                action = `<div class="pack-timer"><button type="button" class="btn btn-ghost btn-block" disabled>${cd.text}</button>${cd.bar}</div>`;
            } else {
                action = `<button type="button" class="btn btn-gold btn-block" data-pack="${p.id}"${golden < p.cost ? ' disabled' : ''}>${golden < p.cost ? `Need ${p.cost} Golden` : `Open for ${p.cost} Golden`}</button>`;
            }
            return `<div class="pack glass-panel">
                <div class="pack-top">
                    <div class="pack-box" style="--p1:${p.colors[0]};--p2:${p.colors[1]}">${p.icon}</div>
                    <div><h3>${esc(p.name)}</h3><div class="pack-fams">${extras.join(' · ')}</div><div class="pack-fams">${fams}</div><div class="pack-cd">⏱ One every ${W.fmtSpan(p.cooldown)}</div></div>
                </div>
                <p class="pack-desc">${esc(p.desc)}</p>
                <div class="odds">${odds}</div>
                ${action}
            </div>`;
        }).join('');
    }
    function buyPack(id) {
        const pack = W.PACKS_BY_ID[id];
        refresh();
        const wait = W.packWait(state, id);
        if (wait > 0) { toast(`${pack.name} can be opened again in ${W.fmtDuration(wait)}.`, 'bad'); renderAll(); return; }
        if (state.list.length + state.nursery.length + pack.count > W.INVENTORY_CAP) { toast(`Your collection is full (${W.INVENTORY_CAP}). Sacrifice some followers to make room.`, 'bad'); return; }
        if (!W.spendGolden(pack.cost)) { toast(`Not enough Golden — ${pack.name} costs ${pack.cost}.`, 'bad'); renderAll(); return; }
        const got = W.openPack(state, id);
        W.saveState(state);
        renderAll();
        showReveal(pack.name, got, { colors: pack.colors });
    }

    // ---------------- reveal overlay ----------------
    function showReveal(title, followers, opts) {
        opts = opts || {};
        $('revealTitle').textContent = title;
        const back = opts.egg ? '🥚' : '?!';
        $('revealCards').innerHTML = followers.map((f, i) => {
            const sp = spOf(f);
            return `<button type="button" class="rcard r${sp.rarity}" data-i="${i}" style="--p1:${(opts.colors || [])[0] || '#5a3ab8'};--p2:${(opts.colors || [])[1] || '#140a2a'}" aria-label="Reveal follower">
                <span class="rface rback">${back}</span>
                <span class="rface rfront">
                    <span class="fcard-art">${W.art(f.sp, { shiny: f.shiny })}</span>
                    <b>${esc(sp.name)}</b>
                    <span class="rar-text">${R[sp.rarity].name}</span>
                    <span style="font-size:12px;color:var(--primary);font-weight:700">${buffList(f, false).join('<br>')}</span>
                    ${f.isNew ? '<span class="new-badge">NEW</span>' : ''}${f.shiny ? '<span class="shiny-badge">✦ SHINY</span>' : ''}
                </span>
            </button>`;
        }).join('');
        $('revealDone').hidden = true;
        $('revealAll').hidden = false;
        $('reveal').hidden = false;
        updateRevealButtons();
    }
    function flip(card) {
        if (!card || card.classList.contains('flipped')) return;
        card.classList.add('flipped');
        updateRevealButtons();
    }
    function updateRevealButtons() {
        const left = document.querySelectorAll('#revealCards .rcard:not(.flipped)').length;
        $('revealAll').hidden = left === 0;
        $('revealDone').hidden = left !== 0;
    }
    function closeReveal() { $('reveal').hidden = true; $('revealCards').innerHTML = ''; }

    // ---------------- breeding ----------------
    function renderNursery() {
        const eggs = state.nursery.slice().sort((x, y) => x.readyAt - y.readyAt);
        const ready = eggs.filter(W.eggReady);
        $('claimAllBtn').hidden = ready.length < 2;
        $('claimAllBtn').textContent = `Claim all (${ready.length})`;
        const nests = [];
        for (let i = 0; i < W.NURSERY_SLOTS; i++) {
            const e = eggs[i];
            if (!e) { nests.push('<div class="nest nest--empty">Empty nest</div>'); continue; }
            const ra = W.SPECIES_BY_ID[e.spA], rb = W.SPECIES_BY_ID[e.spB];
            const tint = Math.round((ra.rarity + rb.rarity) / 2);
            const isReady = W.eggReady(e);
            const cd = isReady ? null : countdown(e.readyAt, e.duration, 'Hatches in ');
            nests.push(`<div class="nest r${tint}${isReady ? ' ready' : ''}">
                <div class="egg-shape" aria-hidden="true"></div>
                <div>
                    <div class="nest-title">${esc(ra.name)} × ${esc(rb.name)}</div>
                    <div class="nest-parents"><span class="fcard-art">${W.art(e.spA)}</span><span class="fcard-art">${W.art(e.spB)}</span></div>
                    ${isReady ? `<button type="button" class="btn btn-gold btn-sm" data-claim="${e.id}">🐣 Claim</button>`
                        : `${cd.bar}<div class="panel-note" style="margin-top:4px">${cd.text}</div>`}
                </div>
            </div>`);
        }
        $('nursery').innerHTML = nests.join('');
    }
    function claimEggs(ids) {
        refresh();
        const room = W.INVENTORY_CAP - state.list.length;
        if (room <= 0) { toast('Your collection is full. Sacrifice some followers to make room.', 'bad'); return; }
        const babies = [];
        ids.slice(0, room).forEach(id => { const c = W.claimEgg(state, id); if (c) babies.push(c); });
        if (!babies.length) { renderAll(); return; }
        W.saveState(state);
        renderAll();
        showReveal(babies.length > 1 ? 'Your eggs hatched!' : 'Your egg hatched!', babies, { egg: true, colors: ['#fff3d6', '#c8a060'] });
    }
    function renderBreed() {
        renderNursery();
        // drop picks that no longer exist or can't breed any more
        for (let i = 0; i < 2; i++) {
            const f = breedPick[i] != null ? W.findFollower(state, breedPick[i]) : null;
            if (!f || f.breeds <= 0 || W.eggFor(state, f.id)) breedPick[i] = null;
        }
        document.querySelectorAll('.parent-slot').forEach(el => {
            const i = Number(el.dataset.parent);
            const f = breedPick[i] != null ? W.findFollower(state, breedPick[i]) : null;
            if (!f) {
                el.className = 'parent-slot';
                el.innerHTML = `<span class="slot-plus">+</span><span>Choose parent ${i ? 'B' : 'A'}</span>`;
                return;
            }
            const sp = spOf(f);
            el.className = `parent-slot filled r${sp.rarity}`;
            el.innerHTML = `<span class="fcard-art">${W.art(f.sp, { shiny: f.shiny })}</span><b>${esc(sp.name)}</b>
                <span><span class="rar-text">${R[sp.rarity].name}</span> · Lv ${f.lvl} · G${f.gen}</span>
                <span class="panel-note">${f.breeds} breed${f.breeds === 1 ? '' : 's'} left · click to change</span>`;
        });
        const a = breedPick[0] != null ? W.findFollower(state, breedPick[0]) : null;
        const b = breedPick[1] != null ? W.findFollower(state, breedPick[1]) : null;
        if (!a || !b) {
            $('breedMid').innerHTML = `<h3>Baby odds</h3><p class="panel-note">Choose two parents to see what they could make.</p>
                <p class="panel-note">Followers that can breed: <b>${state.list.filter(f => f.breeds > 0).length}</b></p>`;
            return;
        }
        const odds = W.breedOdds(a, b);
        const golden = W.getGolden();
        const rows = odds.rarity.map((p, i) => p > 0 ? `<div class="bar-row r${i}"><span class="rar-text">${R[i].name}</span><span class="bar"><i style="width:${Math.round(p * 100)}%"></i></span><b>${pct(p)}</b></div>` : '').join('');
        const fams = Object.keys(odds.family).sort((x, y) => odds.family[y] - odds.family[x])
            .map(id => `<span>${W.FAMILIES[id].icon} ${W.FAMILIES[id].name} ${pct(odds.family[id])}</span>`).join('');
        const hatch = W.hatchTime(a, b);
        const full = state.nursery.length >= W.NURSERY_SLOTS;
        const label = full ? 'Nursery full — claim or wait for an egg' : (golden < odds.cost ? `Need ${odds.cost} Golden` : `Breed for ${odds.cost} Golden`);
        $('breedMid').innerHTML = `<h3>Baby rarity</h3>${rows}
            <h3>Baby family</h3><div class="fam-odds">${fams}</div>
            <div class="panel-note">Shiny chance ${pct(odds.shiny)} · Generation ${Math.max(a.gen, b.gen) + 1} (+${Math.round(Math.min(W.BLOODLINE_MAX, W.BLOODLINE_PER_GEN * Math.max(a.gen, b.gen)) * 100)}% bloodline)${odds.sameSpecies ? ' · same species bonus' : ''}</div>
            <div class="hatch-time">⏱ Hatches in <b>${W.fmtSpan(hatch)}</b></div>
            <button type="button" class="btn btn-gold btn-block" id="breedBtn"${golden < odds.cost || full ? ' disabled' : ''}>${label}</button>`;
    }
    function doBreed() {
        refresh();
        const a = breedPick[0] != null ? W.findFollower(state, breedPick[0]) : null;
        const b = breedPick[1] != null ? W.findFollower(state, breedPick[1]) : null;
        if (!a || !b || a.id === b.id) { toast('Choose two different parents.', 'bad'); return; }
        if (a.breeds <= 0 || b.breeds <= 0) { toast('One of the parents has no breeds left.', 'bad'); renderAll(); return; }
        if (W.eggFor(state, a.id) || W.eggFor(state, b.id)) { toast('One of the parents is already in the nursery.', 'bad'); renderAll(); return; }
        if (state.nursery.length >= W.NURSERY_SLOTS) { toast(`The nursery holds ${W.NURSERY_SLOTS} eggs. Claim one first.`, 'bad'); return; }
        if (state.list.length + state.nursery.length >= W.INVENTORY_CAP) { toast('Your collection is full. Sacrifice some followers to make room.', 'bad'); return; }
        const cost = W.breedCost(a, b);
        if (!W.spendGolden(cost)) { toast(`Not enough Golden — breeding these costs ${cost}.`, 'bad'); renderAll(); return; }
        const egg = W.startBreed(state, a, b);
        W.saveState(state);
        breedPick[0] = breedPick[1] = null;
        renderAll();
        toast(`Egg placed in the nursery — it hatches in ${W.fmtSpan(egg.duration)}.`, 'good');
    }

    // ---------------- Followerdex ----------------
    function renderDex() {
        const owned = {};
        state.list.forEach(f => { owned[f.sp] = (owned[f.sp] || 0) + 1; });
        const seen = Object.keys(state.seen).length;
        $('dexNote').textContent = `${seen} of ${W.SPECIES.length} discovered. Undiscovered followers show as silhouettes. Mythics only come from the Celestial Relic or from breeding.`;
        $('dexBody').innerHTML = W.FAMILY_IDS.map(fid => {
            const fam = W.FAMILIES[fid];
            const list = W.SPECIES.filter(s => s.family === fid);
            const found = list.filter(s => state.seen[s.id]).length;
            return `<div class="dex-family"><h3>${fam.icon} ${fam.name} <span class="panel-note">${found}/${list.length}</span></h3><p>${esc(fam.blurb)}</p>
                <div class="dex-grid">${list.map(s => {
                    const known = !!state.seen[s.id];
                    return `<button type="button" class="dex-tile r${s.rarity}${known ? '' : ' unknown'}" data-species="${s.id}">
                        <span class="fcard-art">${W.art(s.id, { silhouette: !known })}</span>
                        <b>${known ? esc(s.name) : '???'}</b>
                        <span class="rar-text">${R[s.rarity].name}</span>
                        ${owned[s.id] ? `<span class="panel-note">Owned ×${owned[s.id]}</span>` : ''}
                    </button>`;
                }).join('')}</div></div>`;
        }).join('');
    }

    // ---------------- modal ----------------
    function openModal(ctx) { modalCtx = ctx; renderModal(); $('modal').hidden = false; }
    function closeModal() { modalCtx = null; $('modal').hidden = true; $('modalBody').innerHTML = ''; }
    function renderModal() {
        if (!modalCtx) return;
        if (modalCtx.type === 'detail') return renderDetail();
        if (modalCtx.type === 'feed') return renderFeed();
        if (modalCtx.type === 'pick') return renderPicker();
        if (modalCtx.type === 'species') return renderSpecies();
    }

    function renderDetail() {
        const f = W.findFollower(state, modalCtx.id);
        if (!f) { closeModal(); return; }
        const sp = spOf(f), r = R[sp.rarity], max = W.maxLevel(f);
        const eq = W.isEquipped(state, f.id);
        const need = f.lvl < max ? W.xpForLevel(f.lvl, sp.rarity) : 0;
        const next = f.lvl < max ? W.followerBuffs(Object.assign({}, f, { lvl: f.lvl + 1 }), eq ? W.synergyFor(state, f) : 0).map(b => W.fmtBuff(b.type, b.value)) : null;
        const parents = f.parents ? f.parents.map(id => esc(W.SPECIES_BY_ID[id] ? W.SPECIES_BY_ID[id].name : '?')).join(' × ') : 'Opened from a pack';
        const full = state.equipped.every(id => id != null);
        const egg = W.eggFor(state, f.id);
        let replace = '';
        if (modalCtx.replacing) {
            replace = `<div class="replace-row"><b>Your team is full.</b> Replace which follower?<div class="actions">${state.equipped.map((id, i) => {
                const o = W.findFollower(state, id);
                return o ? `<button type="button" class="btn btn-ghost btn-sm" data-replace="${i}">${esc(spOf(o).name)} (Lv ${o.lvl})</button>` : '';
            }).join('')}</div></div>`;
        }
        $('modalBody').innerHTML = `<div class="detail r${sp.rarity}">
            <div><span class="fcard-art">${W.art(f.sp, { shiny: f.shiny })}</span></div>
            <div>
                <h2 id="modalTitle">${esc(sp.name)}</h2>
                <div class="tagline"><span class="rar-text">${r.name}</span><span>${W.FAMILIES[sp.family].icon} ${W.FAMILIES[sp.family].name}</span>${f.shiny ? '<span style="color:#ffe066">✦ Shiny (+25%)</span>' : ''}${eq ? '<span style="color:var(--primary)">On your team</span>' : ''}</div>
                <div><b>Level ${f.lvl}</b> / ${max}${f.lvl < max ? ` · ${fmt(f.xp)} / ${fmt(need)} XP` : ' · Max level'}</div>
                <div class="xpbar"><i style="width:${f.lvl < max ? Math.min(100, Math.round(f.xp / need * 100)) : 100}%"></i></div>
                <ul class="buff-lines">${buffList(f, eq).map(t => `<li>${t}</li>`).join('')}</ul>
                ${next ? `<div class="panel-note">Next level: ${next.join(', ')}</div>` : ''}
                <dl class="kv">
                    <dt>Generation</dt><dd>${f.gen}${f.gen > 1 ? ` (+${Math.round(W.bloodline(f) * 100)}% bloodline)` : ''}</dd>
                    <dt>Breeds left</dt><dd>${f.breeds} / ${W.BREEDS_PER_FOLLOWER}${egg ? (W.eggReady(egg) ? ' · egg ready to claim!' : ' · egg ' + countdown(egg.readyAt, egg.duration, 'hatches in ').text) : ''}</dd>
                    <dt>Parents</dt><dd>${parents}</dd>
                    <dt>Sacrifice value</dt><dd>${fmt(R[sp.rarity].feedXp + Math.floor(0.6 * W.investedXp(f)))} XP</dd>
                </dl>
                <div class="actions">
                    ${eq ? `<button type="button" class="btn btn-ghost" data-act="unequip">Remove from team</button>`
                        : `<button type="button" class="btn btn-primary" data-act="equip">${full ? 'Add to team…' : 'Add to team'}</button>`}
                    <button type="button" class="btn btn-gold" data-act="feed"${f.lvl >= max ? ' disabled' : ''}>Level up</button>
                    <button type="button" class="btn btn-ghost" data-act="breed"${f.breeds <= 0 || egg ? ' disabled' : ''}>Breed</button>
                    <button type="button" class="btn btn-ghost" data-act="lock">${f.locked ? '🔓 Unlock' : '🔒 Lock'}</button>
                </div>
                ${replace}
            </div>
        </div>`;
    }

    function equip(id, slotIndex) {
        mutate(s => {
            if (W.isEquipped(s, id)) return false;
            let i = slotIndex != null ? slotIndex : s.equipped.indexOf(null);
            if (i < 0 || i >= s.slots) return false;
            s.equipped[i] = id;
        });
        const f = W.findFollower(state, id);
        if (f) toast(`${spOf(f).name} joined your team.`, 'good');
    }
    function unequip(id) { mutate(s => { const i = s.equipped.indexOf(id); if (i < 0) return false; s.equipped[i] = null; }); }

    // feed (sacrifice) modal
    function feedCandidates(target) {
        return state.list.filter(o => o.id !== target.id && !o.locked && !W.isEquipped(state, o.id))
            .sort((a, b) => (spOf(a).rarity - spOf(b).rarity) || (a.lvl - b.lvl) || (a.id - b.id));
    }
    function renderFeed() {
        const target = W.findFollower(state, modalCtx.id);
        if (!target) { closeModal(); return; }
        const sel = modalCtx.selected;
        const cands = feedCandidates(target);
        // drop selections that are no longer valid
        Array.from(sel).forEach(id => { if (!cands.some(c => c.id === id)) sel.delete(id); });
        const chosen = cands.filter(c => sel.has(c.id));
        const xp = chosen.reduce((t, c) => t + W.feedValue(c, target), 0);
        const pv = W.previewLevel(target, xp);
        const sp = spOf(target);
        const preview = chosen.length
            ? `+${fmt(xp)} XP → <b>Lv ${pv.lvl}</b>${pv.lvl >= W.maxLevel(target) ? ' (max)' : ''}${pv.wasted > 0 ? ` <span style="color:var(--danger)">· ${fmt(pv.wasted)} XP wasted</span>` : ''}`
            : 'Choose followers to sacrifice.';
        $('modalBody').innerHTML = `<h2 id="modalTitle" style="margin:0 0 12px">Level up</h2>
            <div class="feed-head r${sp.rarity}">
                <span class="fcard-art">${W.art(target.sp, { shiny: target.shiny })}</span>
                <div><b>${esc(sp.name)}</b> · Lv ${target.lvl} / ${W.maxLevel(target)}<div class="feed-preview">${preview}</div>
                <div class="panel-note">Sacrificed followers are gone for good. Same species gives ×1.5 XP, same family ×1.2, shiny ×2. Team members and locked followers can't be sacrificed.</div></div>
            </div>
            <div class="feed-tools">
                <button type="button" class="btn btn-ghost btn-sm" data-feedsel="dupes">Same species</button>
                <button type="button" class="btn btn-ghost btn-sm" data-feedsel="0">All Common</button>
                <button type="button" class="btn btn-ghost btn-sm" data-feedsel="1">All Uncommon</button>
                <button type="button" class="btn btn-ghost btn-sm" data-feedsel="2">All Rare</button>
                <button type="button" class="btn btn-ghost btn-sm" data-feedsel="clear">Clear</button>
            </div>
            <div class="feed-grid fgrid">${cands.length ? cands.map(c => cardHtml(c, { selected: sel.has(c.id) })).join('') : '<div class="empty" style="grid-column:1/-1">No followers available to sacrifice. Open some packs first.</div>'}</div>
            <div class="modal-foot">
                <button type="button" class="btn btn-ghost" data-act="back">Back</button>
                <button type="button" class="btn btn-danger" data-act="sacrifice"${chosen.length ? '' : ' disabled'}>Sacrifice ${chosen.length || ''} follower${chosen.length === 1 ? '' : 's'}</button>
            </div>`;
    }
    function doSacrifice() {
        const target = W.findFollower(state, modalCtx.id);
        if (!target) return;
        const ids = Array.from(modalCtx.selected);
        const rare = ids.map(id => W.findFollower(state, id)).filter(f => f && (spOf(f).rarity >= 3 || f.shiny));
        if (rare.length && !confirm(`This includes ${rare.length} Epic, Legendary, Mythic or shiny follower${rare.length > 1 ? 's' : ''}. Sacrifice anyway?`)) return;
        let result = null;
        mutate(s => {
            const t = W.findFollower(s, target.id);
            if (!t) return false;
            const fodder = ids.map(id => W.findFollower(s, id)).filter(f => f && f.id !== t.id && !f.locked && !W.isEquipped(s, f.id));
            if (!fodder.length) return false;
            const xp = fodder.reduce((sum, f) => sum + W.feedValue(f, t), 0);
            const before = t.lvl;
            const pv = W.previewLevel(t, xp);
            t.lvl = pv.lvl; t.xp = pv.xp;
            const gone = new Set(fodder.map(f => f.id));
            s.list = s.list.filter(f => !gone.has(f.id));
            breedPick.forEach((id, i) => { if (gone.has(id)) breedPick[i] = null; });
            result = { before, after: t.lvl, n: fodder.length, name: spOf(t).name };
        });
        if (result) {
            toast(result.after > result.before ? `${result.name} reached level ${result.after}!` : `${result.name} gained XP from ${result.n} follower${result.n > 1 ? 's' : ''}.`, 'good');
            modalCtx = { type: 'detail', id: target.id };
            renderModal();
        }
    }

    // picker modal (team slot or breeding parent)
    function renderPicker() {
        const ctx = modalCtx;
        let list = state.list.slice();
        let title, note;
        if (ctx.purpose === 'slot') {
            list = list.filter(f => !W.isEquipped(state, f.id));
            title = 'Add to team';
            note = 'Pick a follower for this slot.';
        } else {
            const other = breedPick[ctx.parent ? 0 : 1];
            list = list.filter(f => f.breeds > 0 && f.id !== other && !W.eggFor(state, f.id));
            title = `Choose parent ${ctx.parent ? 'B' : 'A'}`;
            note = 'Only followers with breeds left that aren\'t already in the nursery are shown. Parents are kept after breeding.';
        }
        list = filteredList(list, ctx.filters);
        $('modalBody').innerHTML = `<h2 id="modalTitle" style="margin:0 0 4px">${title}</h2><p class="panel-note" style="margin:0 0 12px">${note}</p>
            <div class="filters" style="margin-bottom:12px">
                <select data-pf="family" aria-label="Filter by family"><option value="all">All families</option>${W.FAMILY_IDS.map(id => `<option value="${id}"${ctx.filters.family === id ? ' selected' : ''}>${W.FAMILIES[id].icon} ${W.FAMILIES[id].name}</option>`).join('')}</select>
                <select data-pf="rarity" aria-label="Filter by rarity"><option value="all">All rarities</option>${R.map((r, i) => `<option value="${i}"${String(ctx.filters.rarity) === String(i) ? ' selected' : ''}>${r.name}</option>`).join('')}</select>
            </div>
            <div class="feed-grid fgrid">${list.length ? list.map(f => cardHtml(f)).join('') : '<div class="empty" style="grid-column:1/-1">No followers available. Open a pack first.</div>'}</div>`;
    }

    function renderSpecies() {
        const sp = W.SPECIES_BY_ID[modalCtx.species];
        const known = !!state.seen[sp.id];
        const r = R[sp.rarity];
        const lv1 = W.followerBuffs({ sp: sp.id, lvl: 1, gen: 1 }, 0).map(b => W.fmtBuff(b.type, b.value));
        const lvMax = W.followerBuffs({ sp: sp.id, lvl: r.maxLevel, gen: 1 }, 0).map(b => W.fmtBuff(b.type, b.value));
        const where = W.PACKS.filter(p => p.weights[sp.rarity] > 0 && (!p.families || p.families.indexOf(sp.family) !== -1)).map(p => p.name);
        $('modalBody').innerHTML = `<div class="detail r${sp.rarity}${known ? '' : ' unknown'}">
            <div><span class="fcard-art">${W.art(sp.id, { silhouette: !known })}</span></div>
            <div>
                <h2 id="modalTitle">${known ? esc(sp.name) : '???'}</h2>
                <div class="tagline"><span class="rar-text">${r.name}</span><span>${W.FAMILIES[sp.family].icon} ${W.FAMILIES[sp.family].name}</span></div>
                <dl class="kv">
                    <dt>Level 1</dt><dd style="color:var(--primary)">${lv1.join('<br>')}</dd>
                    <dt>Level ${r.maxLevel}</dt><dd style="color:var(--primary)">${lvMax.join('<br>')}</dd>
                    <dt>Found in</dt><dd>${where.length ? where.join(', ') : 'Breeding only'}${sp.rarity === 5 ? ' (or breed two Legendaries)' : ''}</dd>
                </dl>
                ${known ? '' : '<p class="panel-note">Get one from a pack or by breeding to reveal it.</p>'}
            </div>
        </div>`;
    }

    // follower achievements (achievements-data.js) can unlock from here too
    function checkAchievements() {
        if (!window.WHA) return;
        try { window.WHA.checkAll(window.WHA.snapshot()).forEach((a, i) => setTimeout(() => toast(`🏆 ${a.name} — Title: ${a.title}`, 'good'), 400 + i * 700)); } catch (e) {}
    }

    // ---------------- render ----------------
    function renderAll() {
        checkAchievements();
        renderHeader();
        if (tab === 'team') { renderTeam(); renderCollection(); }
        if (tab === 'packs') renderPacks();
        if (tab === 'breed') renderBreed();
        if (tab === 'dex') renderDex();
        if (modalCtx) renderModal();
    }
    function setTab(t) {
        tab = t;
        document.querySelectorAll('.fl-tab').forEach(b => b.classList.toggle('active', b.dataset.tab === t));
        ['team', 'packs', 'breed', 'dex'].forEach(id => { $('tab-' + id).hidden = id !== t; });
        try { localStorage.setItem('whathappened_followers_tab', t); } catch (e) {}
        renderAll();
    }

    // ---------------- events ----------------
    document.querySelector('.fl-tabs').addEventListener('click', e => { const b = e.target.closest('.fl-tab'); if (b) setTab(b.dataset.tab); });
    ['fltFamily', 'fltRarity', 'fltSort'].forEach(id => $(id).addEventListener('change', () => {
        filters.family = $('fltFamily').value; filters.rarity = $('fltRarity').value; filters.sort = $('fltSort').value;
        renderCollection();
    }));

    document.querySelector('main').addEventListener('click', e => {
        const go = e.target.closest('[data-goto]');
        if (go) { setTab(go.dataset.goto); return; }
        const card = e.target.closest('.fcard, .slot-filled .fcard-art');
        if (card && card.dataset.id) { openModal({ type: 'detail', id: Number(card.dataset.id) }); return; }
        const un = e.target.closest('[data-unequip]');
        if (un) { const i = Number(un.dataset.unequip); mutate(s => { s.equipped[i] = null; }); return; }
        const slot = e.target.closest('.slot[data-slot]');
        if (slot) { openModal({ type: 'pick', purpose: 'slot', slot: Number(slot.dataset.slot), filters: { family: 'all', rarity: 'all', sort: 'rarity' } }); return; }
        if (e.target.closest('#buySlotBtn')) {
            refresh();
            const cost = W.SLOT_COSTS[state.slots - W.START_SLOTS];
            if (cost == null) return;
            if (!confirm(`Unlock team slot ${state.slots + 1} for ${cost} Golden?`)) return;
            if (!W.spendGolden(cost)) { toast(`Not enough Golden — the next slot costs ${cost}.`, 'bad'); renderAll(); return; }
            mutate(s => { s.slots = Math.min(W.MAX_SLOTS, s.slots + 1); s.equipped.push(null); });
            toast(`Slot ${state.slots} unlocked!`, 'good');
            return;
        }
        const pack = e.target.closest('[data-pack]');
        if (pack && !pack.disabled) { buyPack(pack.dataset.pack); return; }
        const parent = e.target.closest('.parent-slot');
        if (parent) { openModal({ type: 'pick', purpose: 'parent', parent: Number(parent.dataset.parent), filters: { family: 'all', rarity: 'all', sort: 'rarity' } }); return; }
        if (e.target.closest('#breedBtn')) { doBreed(); return; }
        const claim = e.target.closest('[data-claim]');
        if (claim) { claimEggs([Number(claim.dataset.claim)]); return; }
        if (e.target.closest('#claimAllBtn')) { refresh(); claimEggs(state.nursery.filter(W.eggReady).map(x => x.id)); return; }
        const dex = e.target.closest('.dex-tile');
        if (dex) { openModal({ type: 'species', species: dex.dataset.species }); return; }
    });

    $('modalBody').addEventListener('change', e => {
        const sel = e.target.closest('[data-pf]');
        if (sel && modalCtx && modalCtx.type === 'pick') { modalCtx.filters[sel.dataset.pf] = sel.value; renderPicker(); }
    });
    $('modalBody').addEventListener('click', e => {
        if (!modalCtx) return;
        const ctx = modalCtx;
        const act = e.target.closest('[data-act]');
        if (ctx.type === 'detail' && act) {
            const id = ctx.id;
            const a = act.dataset.act;
            if (a === 'equip') {
                if (state.equipped.indexOf(null) === -1) { ctx.replacing = true; renderDetail(); }
                else equip(id);
            } else if (a === 'unequip') unequip(id);
            else if (a === 'feed') openModal({ type: 'feed', id, selected: new Set() });
            else if (a === 'breed') {
                if (breedPick[0] == null || breedPick[0] === id) breedPick[0] = id;
                else breedPick[1] = id;
                closeModal(); setTab('breed');
            } else if (a === 'lock') mutate(s => { const f = W.findFollower(s, id); if (!f) return false; f.locked = !f.locked; });
            return;
        }
        const rep = e.target.closest('[data-replace]');
        if (ctx.type === 'detail' && rep) { ctx.replacing = false; mutate(s => { s.equipped[Number(rep.dataset.replace)] = ctx.id; }); toast('Team updated.', 'good'); return; }
        if (ctx.type === 'feed') {
            if (act && act.dataset.act === 'back') { openModal({ type: 'detail', id: ctx.id }); return; }
            if (act && act.dataset.act === 'sacrifice') { doSacrifice(); return; }
            const tool = e.target.closest('[data-feedsel]');
            if (tool) {
                const target = W.findFollower(state, ctx.id);
                const cands = feedCandidates(target);
                const v = tool.dataset.feedsel;
                if (v === 'clear') ctx.selected.clear();
                else if (v === 'dupes') cands.filter(c => c.sp === target.sp).forEach(c => ctx.selected.add(c.id));
                else cands.filter(c => spOf(c).rarity === Number(v) && !c.shiny).forEach(c => ctx.selected.add(c.id));
                renderFeed();
                return;
            }
            const card = e.target.closest('.fcard');
            if (card) { const id = Number(card.dataset.id); if (ctx.selected.has(id)) ctx.selected.delete(id); else ctx.selected.add(id); renderFeed(); }
            return;
        }
        if (ctx.type === 'pick') {
            const card = e.target.closest('.fcard');
            if (!card) return;
            const id = Number(card.dataset.id);
            if (ctx.purpose === 'slot') { closeModal(); equip(id, ctx.slot); }
            else { breedPick[ctx.parent] = id; closeModal(); renderBreed(); }
        }
    });
    $('modalClose').addEventListener('click', closeModal);
    $('modal').addEventListener('click', e => { if (e.target === $('modal')) closeModal(); });

    $('revealCards').addEventListener('click', e => flip(e.target.closest('.rcard')));
    $('revealAll').addEventListener('click', () => {
        document.querySelectorAll('#revealCards .rcard:not(.flipped)').forEach((c, i) => setTimeout(() => flip(c), i * 180));
    });
    $('revealDone').addEventListener('click', closeReveal);

    document.addEventListener('keydown', e => {
        if (e.key !== 'Escape') return;
        if (!$('reveal').hidden) { if ($('revealDone').hidden) $('revealAll').click(); else closeReveal(); }
        else if (!$('modal').hidden) closeModal();
    });
    // another tab (or the main game) changed the save or followers: show the new data
    window.addEventListener('storage', e => {
        if (e.key === W.STORAGE_KEY || (e.key && e.key.indexOf('whathappened_save') === 0)) { refresh(); renderAll(); }
    });
    window.addEventListener('pageshow', e => { if (e.persisted) { refresh(); renderAll(); } });

    // one ticker drives every countdown; when a timer finishes, re-render so Claim/Open buttons appear
    function tick() {
        if (document.hidden) return;
        const now = Date.now();
        let finished = false;
        document.querySelectorAll('[data-cd]').forEach(el => {
            const left = Number(el.dataset.until) - now;
            if (left <= 0) { finished = true; return; }
            if (el.dataset.cd === 'bar') el.style.width = Math.max(0, Math.min(100, (1 - left / Number(el.dataset.total)) * 100)) + '%';
            else el.textContent = (el.dataset.prefix || '') + W.fmtDuration(left);
        });
        if (finished) { refresh(); renderAll(); }
        else renderHeader(); // keeps the ready-egg badge current on other tabs
    }
    setInterval(tick, 1000);
    document.addEventListener('visibilitychange', tick);

    // remembered tab (falls back to Packs for brand-new players)
    let startTab = 'team';
    try { startTab = localStorage.getItem('whathappened_followers_tab') || (state.list.length ? 'team' : 'packs'); } catch (e) {}
    if (['team', 'packs', 'breed', 'dex'].indexOf(startTab) === -1) startTab = 'team';
    setTab(startTab);
})();
