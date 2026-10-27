/**
 * First-run guide card on the game page (#guideCard): a short checklist for new players, then a pointer to the next
 * thing they can unlock. What it says is decided in core/guide.js; this reads the game, draws the card and remembers
 * when the player closes it. Reads main.js and specials.js globals, so it loads after them.
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
        let p;
        try { p = WHGuide.plan(snapshot()); } catch (e) { return; }
        const show = stored() === 'pinned' || p.visible;
        const text = show ? JSON.stringify([expanded, p.steps.map((s) => [s.label, s.done, s.current]), p.allDone, unlockText(p.nextUnlock), upgradeText(p.nextUpgrade, Number(count) || 0)]) : 'hidden';
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

    function dismiss() { store('dismissed'); last = null; update(); }
    function show() { store('pinned'); last = null; update(); }

    function init() {
        const close = $('guideClose'), again = $('guideShowBtn'), toggle = $('guideToggle');
        if (close) close.addEventListener('click', dismiss);
        if (toggle) toggle.addEventListener('click', () => setExpanded(!expanded));
        if (again) again.addEventListener('click', () => { show(); try { toggleSettingsMenu(); } catch (e) {} });
        update();
        setInterval(update, 1000);
    }
    window.WHGuideUI = { update, dismiss, show, setExpanded };
    onReady(init);
})();
