/**
 * Parties (world.html): up to four players together in any zone. The rules and the data's shape are core/world-party.js.
 * - Inviting: walk up to another player and press E (or E in the Arena's lobby), then "Invite to your party". The invitation
 *   travels like the arena's (world-online.js ON.send, a 'party' message); after that the party works across zones.
 * - Party members can't hurt each other: ON.targets leaves them out, and the victim's page refuses their hits (core
 *   world-online.js validateHit 'party'). In an arena match a party member on the other team is a foe like any other.
 * - The party's chat: lines starting /p, or the chat bar's Party channel. Shown to every member, wherever they are.
 * - The party HUD (top left) shows each member and where they are. P opens the party panel.
 * The party's id is kept in localStorage (not the save: it isn't progress), so a reload rejoins it.
 */
(function () {
    'use strict';
    const Pt = window.WHWorldParty, O = window.WHWorldOnline, D = window.WHWorldData, CS = window.WHChatSafety;
    const WHW = window.WHW, E = WHW.engine;
    const game = () => WHW.game;
    const net = () => WHW.online;
    const esc = (s) => WHW.ui.esc(s);
    const KEY = 'whathappened_world_party';
    const PARTY = Pt.PARTY;

    const P = WHW.party = {
        id: null,             // my party's id, or null
        members: new Map(),   // uid -> { n, z, t }: members playing now (me too)
        tickets: [],          // everyone with a ticket (members away for now too)
        invite: null,         // an invitation I got: { from, id, name, at }
        chan: 'zone',         // the chat bar's channel: 'zone' or 'party'
        subs: [], db: null, ticketSeen: false, chatKeys: [], attachedAt: 0, sayAt: -99,
    };
    const limits = CS.limiter();
    const me = () => net() && net().uid;
    const up = () => !!(net() && net().db && net().status === 'online');
    const sNow = () => (net() && net().db ? net().db.serverNow() : Date.now());
    const pp = (sub) => Pt.path(P.id, sub);

    function savedId() { try { const v = localStorage.getItem(KEY); return Pt.validPid(v) ? v : null; } catch (e) { return null; } }
    function remember(id) { try { if (id) localStorage.setItem(KEY, id); else localStorage.removeItem(KEY); } catch (e) {} }
    function unsub() { P.subs.forEach(u => { try { u(); } catch (e) {} }); P.subs = []; }

    // ---------------- joining and leaving (world-online.js calls online / offline) ----------------
    // Each time this page joins a zone (also after connecting or reconnecting): back into my party, and say where I am
    P.online = function (zone) {
        const db = net().db;
        if (P.db !== db) { unsub(); P.db = db; }
        if (!P.id) { const id = savedId(); if (id) attach(id); }
        else if (!P.subs.length) attach(P.id);
        if (P.id) writeMe(zone);
    };
    // gone offline: the party is kept (online again rejoins it), but nobody is shown
    P.offline = function () { unsub(); P.db = null; P.members.clear(); P.tickets = []; P.invite = null; renderInvite(); renderHud(); };
    function attach(id) {
        unsub();
        P.id = id; P.ticketSeen = false; P.chatKeys = []; P.attachedAt = sNow();
        remember(id);
        const db = net().db;
        P.subs.push(db.onValue(pp('m'), (v) => { P.members = Pt.sanitizeMembers(v); renderHud(); renderMembers(); }));
        P.subs.push(db.onValue(pp('inv'), (v) => {
            P.tickets = Pt.tickets(v);
            const mine = P.tickets.includes(me());
            if (mine) P.ticketSeen = true;
            // my ticket was there and now isn't: the party is gone for me (left on another tab, say)
            else if (P.ticketSeen) dropLocal('You are no longer in the party.');
        }));
        P.subs.push(db.onChild(pp('c'), { add: onChat, remove: (k) => { P.chatKeys = P.chatKeys.filter(x => x !== k); } }));
        net().infoKey = ''; // show my party to others (info pt)
    }
    function writeMe(zone) {
        const db = net().db;
        if (!db || !P.id) return;
        db.set(pp('m/' + me()), Pt.member(net().name(), zone || game().zoneId, sNow()));
        db.onDisconnectRemove(pp('m/' + me()));
    }
    function dropLocal(why) {
        unsub();
        P.id = null; P.members.clear(); P.tickets = []; P.chatKeys = []; P.ticketSeen = false;
        if (P.chan === 'party') P.chan = 'zone';
        remember(null);
        if (net()) net().infoKey = '';
        if (why) WHW.toast(why);
        renderHud();
        if (document.getElementById('ptMembers')) renderMenu();
    }
    function create() {
        const db = net().db, id = Pt.newPid();
        db.set(Pt.path(id, 'inv/' + me()), me()); // the founder's ticket first: the rules let only ticket holders be members
        attach(id);
        writeMe(game().zoneId);
    }
    // Leave the party. The last one out clears its chat.
    P.leave = function (quiet) {
        if (!P.id) return;
        const db = net() && net().db, id = P.id, uid = me();
        if (db) {
            if (!P.tickets.some(u => u !== uid)) db.remove(Pt.path(id, 'c'));
            db.cancelOnDisconnect(Pt.path(id, 'm/' + uid));
            db.remove(Pt.path(id, 'm/' + uid));
            db.remove(Pt.path(id, 'inv/' + uid));
        }
        dropLocal(quiet ? '' : 'You left the party.');
    };

    // ---------------- invitations ----------------
    P.inviteOk = function (r) { return !!r && !(P.id && P.members.has(r.uid)); };
    P.invitePlayer = function (r) {
        if (!up() || !net().zone) { WHW.toast('Parties need online play (the 🌐 menu).', 'bad'); return; }
        if (P.id && P.members.has(r.uid)) { WHW.toast(r.info.n + ' is in your party already.'); return; }
        if (P.id && !Pt.hasRoom(P.tickets, r.uid)) { WHW.toast('A party has at most ' + PARTY.max + ' players.', 'bad'); return; }
        if (!P.id) create();
        net().db.set(pp('inv/' + r.uid), me()); // their ticket, so they can join
        net().send(r.uid, 'party', P.id, net().name());
        WHW.toast('Party invitation sent to ' + r.info.n + '.');
    };
    P.answer = function (yes) {
        const inv = P.invite;
        P.invite = null;
        renderInvite();
        if (!inv || !up()) return;
        if (!yes) { net().send(inv.from, 'pno', inv.id, ''); return; }
        if (P.id && P.id !== inv.id) P.leave(true);
        attach(inv.id);
        writeMe(game().zoneId);
        net().send(inv.from, 'pyes', inv.id, '');
        WHW.toast('You joined ' + inv.name + "'s party. Type /p to talk to it.", 'gold');
    };
    // a party message (world-online.js passes them on, in any zone)
    P.onMessage = function (msg) {
        const r = net().remotes.get(msg.from), name = r && r.info ? r.info.n : 'Someone';
        if (msg.m === 'party') {
            if (!Pt.validPid(msg.id) || msg.id === P.id) return;
            const busy = WHW.arena && WHW.arena.match;
            if (busy || (P.invite && P.invite.from !== msg.from)) { net().send(msg.from, 'pno', msg.id, ''); return; }
            P.invite = { from: msg.from, id: msg.id, name: (O.sanitizeName(msg.x) || name), at: E.time };
            renderInvite();
            WHW.sfx && WHW.sfx('craft');
        } else if (msg.m === 'pyes') {
            if (msg.id === P.id) WHW.toast(name + ' joined your party.', 'gold');
        } else if (msg.m === 'pno') {
            if (msg.id !== P.id) return;
            WHW.toast(name + " didn't join your party.");
            // their ticket goes; a party left with only me in it isn't one
            net().db.remove(pp('inv/' + msg.from));
            if (!P.tickets.some(u => u !== me() && u !== msg.from)) P.leave(true);
        }
    };

    // ---------------- who is a party member ----------------
    P.isMate = function (uid) { return !!P.id && uid !== me() && P.members.has(uid); };
    P.infoExtra = function () { return { pt: P.id || '' }; };
    // party members in this zone, as the arena's teams want them: [{ u, n, r }], me first
    P.here = function () {
        if (!net()) return [];
        return [...net().remotes.values()].filter(r => !r.stale && r.info && P.isMate(r.uid));
    };

    // ---------------- the party's chat ----------------
    P.say = function (text) {
        if (!P.id) { WHW.toast('You are not in a party. Walk up to a player and press E to invite them.'); return false; }
        if (!up()) { WHW.toast('Not connected.'); return false; }
        if (E.time - P.sayAt < O.CHAT.gapSec) return false;
        const line = Pt.chatLine(me(), net().name(), text, sNow());
        if (!line) return false;
        const now = Date.now(), lim = limits.check('say', line.m, now);
        if (!lim.ok) { WHW.toast(lim.message); return false; }
        limits.note('say', line.m, now);
        P.sayAt = E.time;
        net().db.push(pp('c'), line);
        // keep the chat short: the oldest lines go once there are more than chatKeep
        for (const k of Pt.chatOverflow(P.chatKeys.concat(['~']), PARTY.chatKeep)) if (k !== '~') net().db.remove(pp('c/' + k));
        return true;
    };
    function onChat(key, raw) {
        const line = Pt.sanitizeChat(raw);
        if (!line) return;
        if (!P.chatKeys.includes(key)) P.chatKeys.push(key);
        const mine = line.u === me();
        // what was said before I joined (or reloaded) goes in the log quietly
        const fresh = line.t >= P.attachedAt - 2000;
        net().logLine(line.n, line.m, mine, 'party');
        renderLog();
        if (!fresh || mine) return;
        const safe = CS.isOn(localStorage), shown = CS.display(line.m, safe);
        WHW.toast('👥 ' + line.n + ': ' + shown, 'party');
        const r = net().remotes.get(line.u);
        if (r) r.bubble = { m: line.m, e: false, until: E.time + O.CHAT.bubbleSec, party: true };
    }

    // ---------------- each step ----------------
    P.update = function () {
        if (P.invite && E.time - P.invite.at > PARTY.inviteSec) P.answer(false);
        hudT -= 1;
        if (hudT <= 0) { hudT = 15; renderHud(); }
    };
    let hudT = 0;

    // ---------------- the HUD, the invitation, the panel ----------------
    function zoneName(z) { return D.ZONES[z] ? D.ZONES[z].name : 'somewhere'; }
    let hudKey = '';
    function renderHud() {
        let e = document.getElementById('partyHud');
        if (!e) {
            const tl = document.querySelector('.w-hud-tl');
            if (!tl) return;
            e = document.createElement('button'); e.id = 'partyHud'; e.type = 'button'; e.className = 'w-party'; e.title = 'Your party (P)';
            e.addEventListener('click', () => P.openMenu());
            tl.appendChild(e);
        }
        let html = '';
        if (P.id && net() && net().db) {
            const here = game().zoneId, leader = Pt.leaderOf(P.members);
            const rows = [...P.members].filter(([u]) => u !== me()).map(([u, m]) => {
                const r = net().remotes.get(u), same = m.z === here && r && !r.stale;
                const where = same ? (r.dead ? 'knocked out' : Math.ceil(r.hp) + ' HP') : zoneName(m.z);
                return `<div class="${same ? 'is-here' : ''}"><b>${u === leader ? '★ ' : ''}${esc(m.n)}</b><span>${esc(where)}</span></div>`;
            });
            const away = P.tickets.filter(u => u !== me() && !P.members.has(u)).length;
            html = `<div class="w-party-head">👥 Party${rows.length ? '' : ' · just you'}</div>${rows.join('')}${away ? `<div class="muted"><span>${away} away</span></div>` : ''}`;
        }
        if (html === hudKey) return;
        hudKey = html;
        e.hidden = !html;
        e.innerHTML = html;
    }
    function renderInvite() {
        let e = document.getElementById('partyInvite');
        if (!e) { e = document.createElement('div'); e.id = 'partyInvite'; e.className = 'w-arena-invite w-party-invite'; const hud = document.getElementById('wHud'); if (!hud) return; hud.appendChild(e); }
        const inv = P.invite;
        if (!inv) { e.hidden = true; e.innerHTML = ''; return; }
        e.hidden = false;
        e.innerHTML = `<div class="w-card-name">👥 ${esc(inv.name)} invites you to their party</div>
            <div class="w-card-sub">Party members can't hurt each other, see where each other are and have their own chat${P.id ? '. Joining leaves your party' : ''}.</div>
            <div class="w-card-actions"><button class="btn btn-sm btn-gold" id="ptYes">Join</button><button class="btn btn-sm btn-ghost" id="ptNo">No thanks</button></div>`;
        e.querySelector('#ptYes').addEventListener('click', () => P.answer(true));
        e.querySelector('#ptNo').addEventListener('click', () => P.answer(false));
    }
    // Another player, anywhere: invite them to your party (the Arena's lobby has its own card, with challenges too)
    P.openPlayer = function (r) {
        const mate = P.isMate(r.uid);
        const body = WHW.ui.modal('👤 ' + r.info.n, `<p>${r.info.ti ? esc(r.info.ti) + ' · ' : ''}Rating <b>${r.info.r || 1000}</b>${r.info.wb ? ' · best wave <b>' + r.info.wb + '</b>' : ''}</p>
            <div class="w-section"><h3>Party</h3>${mate ? '<p class="muted">In your party.</p>' : `<p class="muted">Party members can't hurt each other, see where each other are and have their own chat.</p><button class="btn btn-primary" id="ptInvite">Invite to your party</button>`}</div>`);
        const b = body.querySelector('#ptInvite');
        if (b) b.addEventListener('click', () => { WHW.ui.closeModal(); P.invitePlayer(r); });
    };
    P.openMenu = function () { WHW.ui.modal('👥 Party', '', { render: renderMenu }); renderMenu(); };
    function membersHtml() {
        const leader = Pt.leaderOf(P.members);
        const rows = P.tickets.map(u => {
            const m = P.members.get(u), you = u === me();
            return `<span>${u === leader ? '★ ' : ''}${esc(m ? m.n : 'A party member')}${you ? ' (you)' : ''}<b>${m ? esc(zoneName(m.z)) : 'away'}</b></span>`;
        }).join('');
        return `<h3>Members (${P.tickets.length} of ${PARTY.max})</h3><div class="w-players">${rows}</div><p class="muted">Invite more: walk up to a player and press <kbd>E</kbd>.</p>`;
    }
    function logHtml() {
        const safe = CS.isOn(localStorage), log = net() ? net().log.filter(l => l.ch === 'party') : [];
        return log.length ? log.map(l => `<div class="${l.mine ? 'mine' : ''}"><b>${esc(l.name)}:</b> ${esc(CS.display(l.m, safe))}</div>`).join('')
            : '<span class="muted">Nothing said yet. In the game, start a line with /p (or pick Party in the chat bar) to say it to the party.</span>';
    }
    // a member came or went, or a line was said, while the panel is open: only that part changes (what you are typing stays)
    function renderMembers() { const e = document.getElementById('ptMembers'); if (e) e.innerHTML = membersHtml(); }
    function renderLog() { const e = document.getElementById('ptLog'); if (e) { e.innerHTML = logHtml(); e.scrollTop = e.scrollHeight; } }
    function renderMenu() {
        const body = document.getElementById('wModalBody');
        if (!body) return;
        let html;
        if (!up()) html = '<p class="w-note">Parties need online play: turn it on in the 🌐 menu.</p>';
        else if (!P.id) html = `<p class="w-note">You aren't in a party. Walk up to another player and press <kbd>E</kbd> to invite them (up to ${PARTY.max} in a party).</p>
            <p class="muted">Party members can't hurt each other, see where each other are, and have their own chat. In the Arena a party fights 2v2 and 3v3 battles together.</p>`;
        else html = `<div class="w-section" id="ptMembers">${membersHtml()}</div>
                <div class="w-section"><h3>Party chat</h3><div class="w-log" id="ptLog">${logHtml()}</div>
                <form class="w-row" id="ptForm" autocomplete="off"><input id="ptInput" maxlength="${O.CHAT.maxLen}" placeholder="Say something to the party" aria-label="Party chat message"><button class="btn btn-sm btn-primary">Send</button></form></div>
                <div class="w-card-actions"><button class="btn btn-ghost" id="ptLeave">Leave the party</button></div>`;
        body.innerHTML = html;
        const lg = body.querySelector('#ptLog'); if (lg) lg.scrollTop = lg.scrollHeight;
        const f = body.querySelector('#ptForm');
        if (f) f.addEventListener('submit', (ev) => { ev.preventDefault(); const i = body.querySelector('#ptInput'); if (i.value.trim() && P.say(i.value)) i.value = ''; });
        const lv = body.querySelector('#ptLeave'); if (lv) lv.addEventListener('click', () => { P.leave(); renderMenu(); });
    }
})();
