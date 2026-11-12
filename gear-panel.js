/**
 * Gear for the game (the clicker): pieces forged in the Wilds' Crucible (core/world-relics.js) arrive over the reward bridge
 * (main.js applyWorldRewards -> receive) and are worn in five slots here. Their boosts (core/gear.js bonuses) are one more
 * multiplier in main.js (getGearBonuses): income, click power, crits, offline earnings, gem find and the lootbox rate.
 * A piece can be sent back to the Wilds (main.js queueWorldGear: the inbox, which only main.js writes) to trade it or put it
 * up for auction there.
 *
 * Saved in localStorage 'whathappened_gear' (this file is its only writer; a prestige never touches it):
 * { v: 1, pieces: [core/gear.js pieces], equipped: { slot: piece id }, nextId }
 * The Gear tab of the Items menu (items.js) shows it: WHGearPanel.html() / onClick(e).
 */
(function () {
    'use strict';
    const Gr = window.WHGear;
    if (!Gr) return;
    const KEY = 'whathappened_gear';
    const esc = (s) => String(s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);

    let state = null, ver = 0, cache = null, sending = false;
    function fresh() { return { v: 1, pieces: [], equipped: {}, nextId: 1 }; }
    function load() {
        let raw = null;
        try { raw = JSON.parse(localStorage.getItem(KEY) || 'null'); } catch (e) { raw = null; }
        const s = fresh();
        if (!raw || typeof raw !== 'object') return s;
        const seen = new Set();
        s.nextId = Math.max(1, Math.floor(Number(raw.nextId) || 1));
        for (const x of Array.isArray(raw.pieces) ? raw.pieces : []) {
            const p = Gr.cleanPiece(x);
            if (!p) continue;
            if (!p.id || seen.has(p.id)) p.id = s.nextId++;
            seen.add(p.id);
            if (p.id >= s.nextId) s.nextId = p.id + 1;
            s.pieces.push(p);
            if (s.pieces.length >= Gr.MAX_PIECES) break;
        }
        const eq = raw.equipped && typeof raw.equipped === 'object' ? raw.equipped : {};
        for (const sl of Gr.SLOTS) { const p = s.pieces.find(x => x.id === Number(eq[sl])); if (p && p.s === sl) s.equipped[sl] = p.id; }
        return s;
    }
    function st() { if (!state) state = load(); return state; }
    function blocked() { try { return typeof suppressAutosave !== 'undefined' && !!suppressAutosave; } catch (e) { return false; } }
    function save() {
        ver++; cache = null;
        if (blocked()) return false;
        try { localStorage.setItem(KEY, JSON.stringify(st())); return true; } catch (e) { return false; }
    }
    function refresh() {
        try { if (typeof updateDisplays === 'function') updateDisplays(); } catch (e) {}
        try { if (window.WHI && window.WHI.menuOpen && window.WHI.menuOpen()) window.WHI.renderInventory(); } catch (e) {}
    }
    const worn = () => Gr.SLOTS.map(sl => st().pieces.find(p => p.id === st().equipped[sl])).filter(Boolean);

    // ---------------- read by main.js ----------------
    function bonuses() {
        if (cache && cache.ver === ver) return cache.b;
        const b = Gr.bonuses(worn());
        cache = { ver, b };
        return b;
    }
    // pieces arriving from the Wilds (already checked by core/world-bridge.js). Returns how many were kept.
    function receive(list) {
        const s = st();
        let n = 0;
        for (const raw of list || []) {
            const p = Gr.cleanPiece(raw);
            if (!p || s.pieces.length >= Gr.MAX_PIECES) continue;
            p.id = s.nextId++;
            s.pieces.push(p); n++;
            // an empty slot: worn at once
            if (!s.equipped[p.s]) s.equipped[p.s] = p.id;
        }
        if (n) { save(); refresh(); }
        return n;
    }

    // ---------------- actions ----------------
    function wear(id) {
        const s = st(), p = s.pieces.find(x => x.id === id);
        if (!p) return;
        s.equipped[p.s] = s.equipped[p.s] === id ? undefined : id;
        if (!s.equipped[p.s]) delete s.equipped[p.s];
        save(); refresh();
    }
    // back to the Wilds' Relic Satchel: taken off here only once main.js has queued it
    function sendBack(id) {
        const s = st(), p = s.pieces.find(x => x.id === id);
        if (!p || sending || typeof window.queueWorldGear !== 'function') return;
        sending = true;
        window.queueWorldGear([p], 'gear').then((ok) => {
            sending = false;
            if (!ok) { try { notify('Could not send it: too much is already waiting for the Wilds. Open the Wilds first.', 4000); } catch (e) {} return; }
            state = null; // another tab may have changed it meanwhile
            const t = st();
            t.pieces = t.pieces.filter(x => x.id !== id);
            for (const sl in t.equipped) if (t.equipped[sl] === id) delete t.equipped[sl];
            save(); refresh();
            try { notify(Gr.pieceName(p) + ' is on its way to the Wilds: it waits in the Relic Satchel at the Crucible.', 5000); } catch (e) {}
        });
    }

    // ---------------- the Gear tab ----------------
    let sortBy = 'best', confirmSend = 0;
    function pieceHtml(p, on) {
        const t = Gr.TIERS[p.t], u = p.q && Gr.UNIQUES_BY_ID[p.q];
        return `<div class="gear-card${on ? ' is-on' : ''}" style="--gc:${t.color}">
            <div class="gear-card-top"><div class="gear-pic">${Gr.pieceSvg(p)}</div>
            <div><div class="gear-name" style="color:${t.color}">${esc(Gr.pieceName(p))}${p.lv ? ' +' + p.lv : ''}${on ? ' <span class="gear-worn">Worn</span>' : ''}</div>
            <div class="gear-sub">${esc(t.name)} ${esc(Gr.SLOT_NAMES[p.s])}${p.by ? ' · forged by ' + esc(p.by) : ''}${p.n ? ' · traded ' + p.n + '×' : ''}</div></div></div>
            ${u ? `<p class="gear-desc">“${esc(u.desc)}”</p>` : ''}
            <ul class="gear-lines">${p.l.map(([a, r], i) => `<li${i === 0 ? ' class="is-main"' : ''}>${esc(Gr.lineText(a, p.t, r, p.lv))}</li>`).join('')}</ul>
            <div class="gear-actions"><button type="button" class="btn btn-sm ${on ? 'btn-ghost' : 'btn-primary'}" data-gact="wear" data-gid="${p.id}">${on ? 'Take off' : 'Wear'}</button>
            <button type="button" class="btn btn-sm btn-ghost" data-gact="send" data-gid="${p.id}">${confirmSend === p.id ? 'Sure? Send it' : 'Send to the Wilds'}</button></div></div>`;
    }
    function html() {
        const s = st(), b = bonuses(), att = Gr.attunement(worn());
        const total = Object.entries(b).filter(([, v]) => v > 0).map(([k, v]) => `<span>+${v}${k === 'critChance' ? ' pts' : '%'} ${esc(Gr.BONUS_LABELS[k])}</span>`);
        let h = `<div class="gear-intro"><b>Gear</b> is forged in the Wilds' <b>Crucible</b> from essences (mined from stone and ore, and found in the hidden dungeons), then sent here. Wear one piece in each slot. Three or five worn pieces sharing a main aspect are <b>attuned</b>: +${Gr.ATTUNE[3] * 100}% / +${Gr.ATTUNE[5] * 100}% to it.</div>`;
        h += `<div class="gear-slots">${Gr.SLOTS.map(sl => {
            const p = s.pieces.find(x => x.id === s.equipped[sl]);
            return `<div class="gear-slot${p ? ' is-full' : ''}" style="--gc:${p ? Gr.TIERS[p.t].color : 'rgba(255,255,255,0.15)'}" title="${esc(p ? Gr.pieceName(p) : 'Empty ' + Gr.SLOT_NAMES[sl])}">
                ${p ? Gr.pieceSvg(p) : `<span class="gear-slot-ghost">${Gr.iconSvg({ shape: sl, tier: 0, main: '#3a4155', trim: '#2a2f3c', uid: 'e' + sl })}</span>`}<small>${esc(Gr.SLOT_NAMES[sl])}</small>
                <em class="gear-slot-tier">${p ? esc(Gr.TIERS[p.t].name) + (p.lv ? ' +' + p.lv : '') : 'empty'}</em></div>`;
        }).join('')}</div>`;
        h += `<div class="gear-total">${total.length ? total.join('') : '<span class="muted">Nothing worn yet.</span>'}${att.map(a => `<span class="gear-attune">✨ Attuned ${esc(Gr.ASPECT_NAMES[a.aspect])} ×${a.n}: +${a.bonus * 100}%</span>`).join('')}</div>`;
        if (!s.pieces.length) return h + '<p class="gear-empty">No gear yet. In the Wilds, forge "Gear for the game" at the Crucible in Wildgate, then send it home from the Relic Satchel.</p>';
        const list = s.pieces.slice();
        if (sortBy === 'best') list.sort((a, c) => Gr.score(c) - Gr.score(a));
        else if (sortBy === 'slot') list.sort((a, c) => Gr.SLOTS.indexOf(a.s) - Gr.SLOTS.indexOf(c.s) || Gr.score(c) - Gr.score(a));
        else list.sort((a, c) => c.id - a.id);
        h += `<div class="gear-tools"><span>${s.pieces.length} piece${s.pieces.length > 1 ? 's' : ''}</span><label>Sort <select data-gsort>${[['best', 'Best first'], ['slot', 'Slot'], ['new', 'Newest']].map(([k, l]) => `<option value="${k}" ${sortBy === k ? 'selected' : ''}>${l}</option>`).join('')}</select></label></div>`;
        h += `<div class="gear-grid">${list.map(p => pieceHtml(p, s.equipped[p.s] === p.id)).join('')}</div>`;
        return h;
    }
    function onClick(e) {
        const b = e.target.closest('[data-gact]');
        if (!b) return false;
        const id = Number(b.dataset.gid);
        if (b.dataset.gact === 'wear') { confirmSend = 0; wear(id); }
        else if (b.dataset.gact === 'send') {
            if (confirmSend !== id) { confirmSend = id; refresh(); }
            else { confirmSend = 0; sendBack(id); }
        }
        return true;
    }
    // the sort control (a change, not a click)
    document.addEventListener('change', (e) => { if (e.target && e.target.matches && e.target.matches('[data-gsort]')) { sortBy = e.target.value; refresh(); } });
    // another tab changed it (or a cloud load): read it again
    window.addEventListener('storage', (e) => { if (e.key === KEY) { state = null; ver++; cache = null; refresh(); } });

    window.WHGearPanel = { KEY, bonuses, receive, wear, sendBack, html, onClick, count: () => st().pieces.length, pieces: () => st().pieces.slice(), worn };
})();
