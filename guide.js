/**
 * First-run guide card on the game page (#guideCard): a short checklist for new players, a bar showing how close the
 * current step is (and what the first upgrades do), then a pointer to the next thing they can unlock. Also the one-time
 * "keep your progress safe" reminder (#saveReminder). What they say is decided in core/guide.js; this reads the game,
 * draws the cards and remembers when the player closes them. Reads main.js and specials.js globals, so it loads after them.
 */
(function () {
    'use strict';

    // Run once the HTML is parsed. DOMContentLoaded also waits for the Firebase modules to download, which can take seconds on
    // a slow connection, so (like main.js) start on readystatechange instead.
    function onReady(fn) {
        if (document.readyState !== 'loading') { fn(); return; }
        let done = false;
        const go = () => { if (!done) { done = true; fn(); } };
        document.addEventListener('readystatechange', () => { if (document.readyState !== 'loading') go(); });
        document.addEventListener('DOMContentLoaded', go);
    }

    const KEY = 'whathappened_guide'; // 'dismissed' (closed it), 'pinned' (asked for it in Settings) or absent
    const REMINDER_KEY = 'whathappened_save_reminder'; // 'shown' or 'done' (downloaded a save file): the reminder appears at most once
    const CLOUD_META_KEY = 'whathappened_cloud_meta'; // written by cloud.js once this browser has synced with an account
    const $ = (id) => document.getElementById(id);
    const stored = () => { try { return localStorage.getItem(KEY); } catch (e) { return null; } };
    const store = (v) => { try { if (v) localStorage.setItem(KEY, v); else localStorage.removeItem(KEY); } catch (e) {} };
    const fmt = (n) => { try { return formatNumber(n); } catch (e) { return String(n); } };
    const plural = (n, word) => n + ' ' + word + (n === 1 ? '' : 's');

    // everything core/guide.js needs, read from the running game
    function snapshot() {
        const levels = [0], costs = [0];
        for (let i = 1; i <= UPGRADE_COUNT; i++) {
            levels[i] = numericLevel(getUpgradeLevel(i));
            costs[i] = costForLevel(i, levels[i]);
        }
        const flag = stored();
        let clicks = 0;
        try { clicks = Number(localStorage.getItem('whathappened_lifetime_clicks')) || 0; } catch (e) {}
        return {
            levels, costs, names: UPGRADE_NAMES,
            specials: typeof window.specialsSnapshot === 'function' ? window.specialsSnapshot() : [],
            count: Number(count) || 0, clicks,
            prestiges: Number(prestigeTimes) || 0, golden: Number(goldenWhat) || 0,
            prestigeAwards: getPotentialPrestigeAwards(),
            dismissed: flag === 'dismissed',
        };
    }

    function unlockText(u) {
        if (!u) return '';
        if (u.kind === 'special') return `Next unlock: ${u.name}. Raise ${u.upgradeName} to level ${u.level} (${plural(u.remaining, 'more level')}).`;
        if (u.kind === 'prestige-ready') return `Prestige is ready: it would give you ${u.awards} Golden. Use the Prestige button under your counters.`;
        if (u.kind === 'prestige') return `Next unlock: Prestige, when ${u.upgradeName} reaches level ${u.level} (${plural(u.remaining, 'more level')}).`;
        return '';
    }
    // the bar under the current step: how close it is, and what the upgrade does
    function progressText(pr) {
        if (!pr) return ['', ''];
        if (pr.kind === 'level') {
            return [`${pr.name}: level ${pr.have} of ${pr.need}.`, pr.unlocks ? `Level ${pr.unlocks.level} unlocks the ${pr.unlocks.name} special.` : ''];
        }
        const which = pr.first ? `your first ${pr.name}` : pr.name;
        const line = pr.ready ? `You have the ${fmt(pr.need)} What Happeneds for ${which}: buy it in Upgrades.`
            : `${fmt(pr.have)} / ${fmt(pr.need)} What Happeneds for ${which}.`;
        const what = pr.upgrade === 1 ? `${pr.name} makes every click worth more` + (pr.unlocks ? `, and at level ${pr.unlocks.level} it unlocks the ${pr.unlocks.name} special.` : '.')
            : pr.upgrade === 2 ? `It earns What Happeneds every second, even while you aren't clicking.` : '';
        return [line, what];
    }
    // sameUnlock: the "Next unlock" line below already names the special the bar leads to, so the bar doesn't repeat it
    function drawProgress(pr, sameUnlock) {
        const wrap = $('guideBarWrap');
        if (!wrap) return;
        wrap.hidden = !pr;
        if (!pr) return;
        const [line, full] = progressText(pr);
        const what = sameUnlock && pr.kind === 'level' ? '' : full;
        const frac = pr.need > 0 ? Math.min(1, pr.have / pr.need) : 0;
        const bar = $('guideBar');
        bar.setAttribute('aria-valuemax', String(pr.need));
        bar.setAttribute('aria-valuenow', String(Math.min(pr.have, pr.need)));
        bar.setAttribute('aria-valuetext', line);
        bar.classList.toggle('is-ready', !!pr.ready);
        $('guideBarFill').style.width = (frac * 100).toFixed(1) + '%';
        $('guideBarText').textContent = line;
        const w = $('guideBarWhat');
        w.textContent = what;
        w.hidden = !what;
    }

    function upgradeText(u, have) {
        if (!u) return '';
        const cost = u.cost === undefined ? '' : `, ${fmt(u.cost)} What Happeneds` + (Number(have) >= Number(u.cost) ? ' (you can afford it now)' : '');
        return `Next new upgrade: ${u.name}${cost}.`;
    }

    let last = null; // what is drawn now; null forces a redraw
    function update() {
        const card = $('guideCard');
        // wait for the real save to load, or a veteran would see the guide flash up
        if (!card || !window._saveLoaded || typeof getUpgradeLevel !== 'function' || typeof WHGuide === 'undefined') return;
        let p, snap;
        try { snap = snapshot(); p = WHGuide.plan(snap); } catch (e) { return; }
        updateReminder(snap);
        const show = stored() === 'pinned' || p.visible;
        const text = show ? JSON.stringify([expanded, p.steps.map((s) => [s.label, s.done, s.current]), p.allDone, p.progress, unlockText(p.nextUnlock), upgradeText(p.nextUpgrade, Number(count) || 0)]) : 'hidden';
        if (text === last) return;
        last = text;
        card.hidden = !show;
        if (!show) return;
        card.classList.toggle('is-compact', p.allDone);
        const doneCount = p.steps.filter((st) => st.done).length;
        $('guideProgress').textContent = p.allDone ? '' : `${doneCount}/${p.steps.length}`;
        const current = p.steps.find((st) => st.current);
        const cur = $('guideCurrent');
        cur.textContent = current ? `Step ${p.steps.indexOf(current) + 1}: ${current.label}.` : '';
        cur.hidden = !current;
        const toggle = $('guideToggle');
        toggle.hidden = p.allDone;
        const list = $('guideSteps');
        list.hidden = p.allDone || !expanded;
        list.textContent = '';
        for (const s of p.steps) {
            const li = document.createElement('li');
            li.className = 'guide-step' + (s.done ? ' is-done' : '') + (s.current ? ' is-current' : '');
            li.textContent = s.label;
            if (s.done) { const sr = document.createElement('span'); sr.className = 'sr-only'; sr.textContent = ' (done)'; li.appendChild(sr); }
            list.appendChild(li);
        }
        const sameUnlock = !!(p.progress && p.progress.unlocks && p.nextUnlock && p.nextUnlock.name === p.progress.unlocks.name);
        drawProgress(p.progress, sameUnlock);
        const next = $('guideNext'), up = $('guideUpgrade');
        next.textContent = unlockText(p.nextUnlock);
        next.hidden = !next.textContent;
        up.textContent = upgradeText(p.nextUpgrade, Number(count) || 0);
        up.hidden = !up.textContent;
    }

    // the full checklist is hidden until asked for, so the banner stays small
    let expanded = false;
    function setExpanded(on) {
        expanded = on;
        const toggle = $('guideToggle');
        if (toggle) { toggle.setAttribute('aria-expanded', on ? 'true' : 'false'); toggle.textContent = on ? 'Hide steps' : 'All steps'; }
        last = null;
        update();
    }

    // ---- the one-time save reminder: shown at most once (recorded the moment it appears), never opens or downloads anything
    // by itself, and goes away for good when closed or used ----
    let reminderOpen = false;
    function updateReminder(snap) {
        const el = $('saveReminder');
        if (!el || reminderOpen) return;
        let due = false;
        try {
            due = WHGuide.saveReminderDue({ ...snap, reminder: localStorage.getItem(REMINDER_KEY), accountSynced: !!localStorage.getItem(CLOUD_META_KEY) });
            if (due) localStorage.setItem(REMINDER_KEY, 'shown'); // if this can't be stored, it would come back every visit: don't show it
        } catch (e) { due = false; }
        if (!due) return;
        reminderOpen = true;
        el.hidden = false;
    }
    function closeReminder() {
        const el = $('saveReminder');
        if (el) el.hidden = true;
    }
    function downloadFromReminder() {
        try { window.WHSaveTools.doExport(); } catch (e) { return; }
        const t = $('saveReminderText');
        if (t) t.textContent = 'Downloaded. Keep the file somewhere safe: Settings > Save backup can import it again.';
        setTimeout(closeReminder, 6000);
    }

    function dismiss() { store('dismissed'); last = null; update(); }
    function show() { store('pinned'); last = null; update(); }

    function init() {
        const close = $('guideClose'), again = $('guideShowBtn'), toggle = $('guideToggle');
        if (close) close.addEventListener('click', dismiss);
        if (toggle) toggle.addEventListener('click', () => setExpanded(!expanded));
        if (again) again.addEventListener('click', () => { show(); try { toggleSettingsMenu(); } catch (e) {} });
        const rClose = $('saveReminderClose'), rDownload = $('saveReminderDownload');
        if (rClose) rClose.addEventListener('click', closeReminder);
        if (rDownload) rDownload.addEventListener('click', downloadFromReminder);
        update();
        setInterval(update, 1000);
    }
    window.WHGuideUI = { update, dismiss, show, setExpanded, closeReminder };
    onReady(init);
})();
