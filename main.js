/**
 * WHAT HAPPENED clicker — main game logic (loaded by index.html)
 *
 * Sections (in order):
 * - Decimal/currency helpers, core state (count, clickPower, cps)
 * - Clan sync (syncClanStats), main image size, formatNumber
 * - Achievements, titles, batch cost, level multipliers, effective CPS
 * - Upgrade tooltips, upgrade state and buy functions (1–24, divine, specials)
 * - Prestige, save/load, increment (click handler + mainClicks for clan events)
 * - UI: falling images, displays, shop, settings, init
 */
// ========== Decimal and currency helpers ==========
// Decimal helper (use Decimal.js if available)
const hasDecimal = typeof Decimal !== 'undefined';
const hasBig = hasDecimal; // alias for legacy checks
function D(v) { return hasDecimal ? new Decimal(v) : Number(v); }
function isDecimalInstance(x) { return hasDecimal && x instanceof Decimal; }

// safe numeric conversion helper (Decimal-aware). Returns a Number or Decimal
// consistent with the current numeric mode. Falls back to `fallback` when
// the value is not finite.
// Firebase Auth import removed for file:// compatibility.
// If you run the page over HTTP and want anonymous auth, import
// firebase/auth (or initialize auth in the firebase module script) and
// call signInAnonymously there.

function safeNum(n, fallback = 0) {
    if (hasDecimal) {
        try {
            const cand = isDecimalInstance(n) ? n : D(n);
            if (cand && typeof cand.isFinite === 'function') return cand.isFinite() ? cand : (isDecimalInstance(fallback) ? fallback : D(fallback));
            return cand;
        } catch (e) {
            return isDecimalInstance(fallback) ? fallback : D(fallback);
        }
    } else {
        const num = Number(n);
      return Number.isFinite(num) ? num : fallback;
    }
}

// return a numeric JS primitive for upgrade level values (handles Decimal instances)
function numericLevel(v) { return isDecimalInstance(v) ? v.toNumber() : Number(v || 0) || 0; }
// check if the player can afford a given cost (Decimal-aware)
function canAfford(cost) {
    if (cost === undefined || cost === null) return true;
    if (hasDecimal) {
        try {
            const need = isDecimalInstance(cost) ? cost : D(cost);
            const have = isDecimalInstance(count) ? count : D(count);
            return have.gte(need);
        } catch (e) {
            return Number(count) >= Number(cost);
        }
    }
    return Number(count) >= Number(cost);
}

// Decimal-aware check for golden currency affordability
function goldenCanAfford(cost) {
    if (cost === undefined || cost === null) return true;
    if (hasDecimal) {
        try {
            const need = isDecimalInstance(cost) ? cost : D(cost);
            const have = isDecimalInstance(goldenWhat) ? goldenWhat : D(goldenWhat || 0);
            return have.gte(need);
        } catch (e) {
            return Number(goldenWhat || 0) >= Number(cost);
        }
    }
    return Number(goldenWhat || 0) >= Number(cost);
}
let count = D(0);
let clickPower = D(1);
// Base and multiplier for click power so multipliers persist
let baseClickPower = D(1);
let clickMultiplier = D(1);
let cps = D(0);
// Track pirate-specific cps separately so we can multiply it
let pirateCps = D(0);
// keep base other cps separately so multipliers apply to future gains
let baseOtherCps = D(0);
let pirateMultiplier = D(1);

function addToCount(v) {
    try {
        const inc = D(v);
        if (isDecimalInstance(count)) count = count.plus(inc);
        else if (hasDecimal) count = D(count).plus(inc);
        else count = Number(count) + Number(inc);
    } catch (e) {
        count = (typeof count === 'number' ? count : Number(count)) + Number(v);
    }
}

// ========== Clan stats sync (Firestore members + profile) ==========
// Syncs main currency and golden currency to clan member doc and player profile.
async function syncClanStats() {
    try {
        console.debug('syncClanStats: called');
        const clanId = localStorage.getItem('player_clanId');
        const username = localStorage.getItem('player_username');

        // If the player isn't in a clan, do nothing
        if (!clanId || !username || clanId === 'undefined') {
            console.debug('syncClanStats: abort — missing clanId/username', { clanId, username });
            return;
        }

        // Ensure we are sending Numbers, not Decimal objects
        const ptsValue = (typeof count !== 'undefined') ? (isDecimalInstance(count) ? count.toNumber() : Number(count)) : 0;
        const gptsValue = (typeof goldenWhat !== 'undefined') ? (isDecimalInstance(goldenWhat) ? goldenWhat.toNumber() : Number(goldenWhat)) : 0;
        const cpValue = (typeof clanPoints !== 'undefined') ? Number(clanPoints) : 0;
        let cpsVal = 0, clickPowerVal = 0;
        try { cpsVal = (typeof cps !== 'undefined' && isDecimalInstance(cps)) ? cps.toNumber() : Number(cps) || 0; } catch (e) {}
        try { clickPowerVal = (typeof clickPower !== 'undefined' && isDecimalInstance(clickPower)) ? clickPower.toNumber() : Number(clickPower) || 0; } catch (e) {}
        try { if (!cpsVal && localStorage.getItem('whathappened_current_cps')) cpsVal = Number(localStorage.getItem('whathappened_current_cps')) || 0; } catch (e) {}
        try { if (!clickPowerVal && localStorage.getItem('whathappened_current_clickpower')) clickPowerVal = Number(localStorage.getItem('whathappened_current_clickpower')) || 0; } catch (e) {}

        console.log('syncClanStats: preparing update', { clanId, username, points: ptsValue, gpoints: gptsValue });
        if (typeof doc === 'function' && typeof db !== 'undefined') {
            const memberRef = doc(db, 'clans', clanId, 'members', username);
            const payload = { points: ptsValue, gpoints: gptsValue, clanPoints: cpValue, lastCps: cpsVal, lastClickPower: clickPowerVal, lastUpdate: Date.now() };
            // Prefer setDoc with merge so the member doc is created if missing
            if (typeof setDoc === 'function') {
                await setDoc(memberRef, payload, { merge: true });
            } else if (typeof updateDoc === 'function') {
                try {
                    await updateDoc(memberRef, payload);
                } catch (e) {
                    // If update failed because the doc didn't exist, try set if available
                    if (typeof setDoc === 'function') {
                        await setDoc(memberRef, payload, { merge: true });
                    } else {
                        throw e;
                    }
                }
            } else {
                console.warn('syncClanStats: modular Firestore present but no setDoc/updateDoc available');
            }
        } else if (typeof firebase !== 'undefined' && firebase.firestore) {
            try {
                const fs = firebase.firestore();
                const memberRef = fs.collection('clans').doc(clanId).collection('members').doc(username);
                await memberRef.set({ points: ptsValue, gpoints: gptsValue, clanPoints: cpValue, lastCps: cpsVal, lastClickPower: clickPowerVal, lastUpdate: Date.now() }, { merge: true });
            } catch (e) {
                console.warn('syncClanStats: firebase.firestore fallback failed', e);
                throw e;
            }
        } else {
            console.warn('syncClanStats: no Firestore API available to write clan stats');
        }

        // Also update the player's profile document so clan pages and queries reflect the latest totals
        try {
            const profilePayload = {
                username: username,
                score: ptsValue,
                points: ptsValue,
                totalScore: ptsValue,
                golden: gptsValue,
                goldenWhat: gptsValue,
                totalGoldenEver: gptsValue,
                totalGolden: gptsValue,
                clanPoints: cpValue,
                updatedAt: (typeof serverTimestamp === 'function') ? serverTimestamp() : Date.now(),
                clanId: clanId
            };
            if (typeof doc === 'function' && typeof setDoc === 'function' && typeof db !== 'undefined') {
                const profileRef = doc(db, 'profiles', username);
                await setDoc(profileRef, profilePayload, { merge: true });
            } else if (typeof firebase !== 'undefined' && firebase.firestore) {
                const fs = firebase.firestore();
                await fs.collection('profiles').doc(username).set(profilePayload, { merge: true });
            } else {
                console.debug('syncClanStats: no Firestore API available to write profile');
            }
            console.log('syncClanStats: profile updated');
        } catch (e) {
            console.warn('syncClanStats: profile update failed', e);
        }
        
        console.log("Clan stats synced to cloud.");
    } catch (e) {
        console.warn("Clan sync failed:", e);
    }
}

// ========== Main image size (settings) ==========
// Main image max-width (px) controlled by settings slider
let mainImageMaxWidth = 700;

function applyMainImageMaxWidth() {
    const img = document.querySelector('.main-image');
    if (!img) return;
    // enforce exact pixel width so stylesheet media queries don't override
    img.style.maxWidth = mainImageMaxWidth + 'px';
    img.style.width = mainImageMaxWidth + 'px';
    const val = document.getElementById('imageSizeValue');
    if (val) val.innerText = mainImageMaxWidth;
    const slider = document.getElementById('imageSizeSlider');
    if (slider) slider.value = mainImageMaxWidth;
    console.log('applyMainImageMaxWidth applied', mainImageMaxWidth);
}

// Defer applying main image width until after the page has loaded and
// initial layout classes (leftbar state) have been applied. This prevents
// a visible left-shift that occurs when the image is resized before the
// body margin-left is set by other scripts.
function _initApplyMainImageMaxWidthAfterLoad() {
    try {
        if (document.readyState === 'complete') {
            // already loaded
            setTimeout(applyMainImageMaxWidth, 40);
        } else {
            window.addEventListener('load', function onLoad() {
                try { setTimeout(applyMainImageMaxWidth, 40); } catch (e) {}
                try { window.removeEventListener('load', onLoad); } catch (e) {}
            });
        }
    } catch (e) { try { setTimeout(applyMainImageMaxWidth, 80); } catch (e) {} }
}

_initApplyMainImageMaxWidthAfterLoad();

function setMainImageMaxWidth(px) {
    const v = Number(px) || mainImageMaxWidth;
    mainImageMaxWidth = Math.max(200, Math.min(3000, Math.round(v)));
    try { localStorage.setItem('whathappened_image_max', String(mainImageMaxWidth)); } catch (e) {}
    applyMainImageMaxWidth();
}

function formatNumber(n) {
    if (n === undefined || n === null) return '0';
    // Decimal-aware formatting
    if (hasDecimal) {
        try {
            const dec = isDecimalInstance(n) ? n : D(n);
            const abs = dec.abs();
            if (abs.lt(1000)) {
                return dec.round().toNumber().toLocaleString();
            }
            const units = ['K', 'M', 'B', 'T', 'Q', 'Qa', 'Qi', 'Sx', 'Sp', 'Oc', 'No', 'Dc'];
            let v = dec;
            let unitIndex = -1;
            while (v.gte(1000)) {
                v = v.div(1000);
                unitIndex++;
                if (unitIndex >= units.length) {
                    return (dec.toExponential ? dec.toExponential(3) : dec.toString());
                }
            }
            const decimals = v.lt(100) ? 1 : 0;
            const sign = dec.lt(0) ? '-' : '';
            return sign + v.toFixed(decimals) + (unitIndex >= 0 ? units[unitIndex] : '');
        } catch (e) {
            // fallthrough to numeric fallback
        }
    }
    if (!isFinite(n)) return '0';
    const num = Number(n);
    const abs = Math.abs(num);
    if (abs < 1000) {
        return Math.round(num).toLocaleString();
    }
    const units = ['K', 'M', 'B', 'T', 'Q', 'Qa', 'Qi', 'Sx', 'Sp', 'Oc', 'No', 'Dc'];
    const sign = num < 0 ? '-' : '';
    let v = abs;
    let unitIndex = -1;
    // divide down until under 1000, tracking unitIndex
    while (v >= 1000) {
        v = v / 1000;
        unitIndex++;
        // if we've exceeded available shorteners, show exponential
        if (unitIndex >= units.length) {
            // use 3 significant digits in exponential form
            return sign + Number(num).toExponential(3);
        }
    }
    // show one decimal if value < 100, otherwise no decimals
    const decimals = v < 100 ? 1 : 0;
    return sign + v.toFixed(decimals) + (unitIndex >= 0 ? units[unitIndex] : '');
}

// ========== Achievements (popups, playtime, CPS, click power, upgrade levels) ==========
// Show a small popup near the Achievements button when an achievement unlocks
function showAchievementPopup(title, message) {
    try {
        const containerId = 'achievementPopupContainer';
        let container = document.getElementById(containerId);
        if (!container) {
            container = document.createElement('div');
            container.id = containerId;
            container.style.position = 'fixed';
            container.style.top = '0';
            container.style.left = '0';
            container.style.pointerEvents = 'none';
            document.body.appendChild(container);
        }
        const popup = document.createElement('div');
        popup.className = 'achievement-popup';
        popup.style.position = 'absolute';
        popup.style.background = 'linear-gradient(180deg,#243,#135)';
        popup.style.color = '#fff';
        popup.style.padding = '8px 12px';
        popup.style.borderRadius = '8px';
        popup.style.boxShadow = '0 8px 24px rgba(0,0,0,0.6)';
        popup.style.opacity = '0';
        popup.style.transform = 'translateY(6px)';
        popup.style.transition = 'opacity 260ms ease, transform 260ms ease';
        popup.style.pointerEvents = 'auto';
        // color title according to rarity if known
        let titleText = String(title || '');
        try {
            const rarity = TITLE_RARITIES[titleText] || (getUnlockedTitles().find(x=>x.name===titleText) || {}).rarity || 'common';
            const color = RARITY_COLORS[rarity] || '#fff';
            titleText = `<span style="color:${color};font-weight:700">${titleText}</span>`;
        } catch (e) {}
        popup.innerHTML = `<div style="font-size:14px">${titleText}</div><div style="font-size:12px;margin-top:4px;color:#ddf">${String(message||'')}</div>`;

        // position near achievements button if available
        try {
            const btn = document.getElementById('achievementsTopBtn');
            if (btn) {
                const r = btn.getBoundingClientRect();
                // place popup above the button
                popup.style.left = (Math.max(8, r.left)) + 'px';
                popup.style.top = (Math.max(8, r.bottom + 6)) + 'px';
            } else {
                // default top-right
                popup.style.right = '12px';
                popup.style.top = '12px';
            }
        } catch (e) {
            popup.style.right = '12px';
            popup.style.top = '12px';
        }

        container.appendChild(popup);
        // animate in
        requestAnimationFrame(() => { popup.style.opacity = '1'; popup.style.transform = 'translateY(0)'; });
        // remove after timeout
        setTimeout(() => {
            try { popup.style.opacity = '0'; popup.style.transform = 'translateY(-6px)'; } catch (e) {}
            setTimeout(() => { try { popup.remove(); } catch (e) {} }, 300);
        }, 3000);
    } catch (e) { try { console.warn('showAchievementPopup failed', e); } catch (e) {} }
}

// Check and unlock playtime-based achievements
function checkPlaytimeAchievements() {
    try {
        const s = Number(localStorage.getItem('whathappened_playtime_seconds') || 0) || 0;
        // 2 hours
        if (s >= 7200 && !localStorage.getItem('ach_play_2h')) {
            try { localStorage.setItem('ach_play_2h', '1'); } catch (e) {}
            try { addUnlockedTitle('Indoor Specialist'); } catch (e) {}
            try { showAchievementPopup('Go Outside', 'Playtime 2 hours — Title: Indoor Specialist'); } catch (e) {}
        }
        // 24 hours
        if (s >= 86400 && !localStorage.getItem('ach_play_24h')) {
            try { localStorage.setItem('ach_play_24h', '1'); } catch (e) {}
            try { addUnlockedTitle('Chronically Online'); } catch (e) {}
            try { showAchievementPopup('This Is My Life Now', 'Playtime 24 hours — Title: Chronically Online'); } catch (e) {}
        }
        // 1 week (7 days)
        if (s >= 604800 && !localStorage.getItem('ach_play_1w')) {
            try { localStorage.setItem('ach_play_1w', '1'); } catch (e) {}
            try { addUnlockedTitle('Permanently Online'); } catch (e) {}
            try { showAchievementPopup('What Happened Forever', 'Playtime 1 week — Title: Permanently Online'); } catch (e) {}
        }
    } catch (e) { try { console.warn('checkPlaytimeAchievements failed', e); } catch (e) {} }
}

// Check and unlock CPS-based achievements
function checkCpsAchievements() {
    try {
        // derive numeric cps value regardless of Decimal usage
        let cpsVal = 0;
        try { cpsVal = (isDecimalInstance(cps) ? cps.toNumber() : Number(cps)) || 0; } catch (e) { cpsVal = Number(cps) || 0; }
        // 1 cps
        if (cpsVal >= 1 && !localStorage.getItem('ach_cps_1')) {
            try { localStorage.setItem('ach_cps_1', '1'); } catch (e) {}
            try { addUnlockedTitle('The Automtor'); } catch (e) {}
            try { showAchievementPopup('All Hands On Deck', 'Reach 1 CPS — Title: The Automtor'); } catch (e) {}
        }
        // 1k cps
        if (cpsVal >= 1000 && !localStorage.getItem('ach_cps_1k')) {
            try { localStorage.setItem('ach_cps_1k', '1'); } catch (e) {}
            try { addUnlockedTitle('Automation Enjoyer'); } catch (e) {}
            try { showAchievementPopup('I Swear I\'m Not Clicking', 'Reach 1,000 CPS — Title: Automation Enjoyer'); } catch (e) {}
        }
        // 1B cps
        if (cpsVal >= 1000000000 && !localStorage.getItem('ach_cps_1b')) {
            try { localStorage.setItem('ach_cps_1b', '1'); } catch (e) {}
            try { addUnlockedTitle('Observer Of Motion.'); } catch (e) {}
            try { showAchievementPopup('It Clicks Itself', 'Reach 1,000,000,000 CPS — Title: Observer Of Motion.'); } catch (e) {}
        }
    } catch (e) { try { console.warn('checkCpsAchievements failed', e); } catch (e) {} }
}

// Check and unlock Click Power-based achievements
function checkClickPowerAchievements() {
    try {
        let cpVal = 0;
        try { cpVal = (isDecimalInstance(clickPower) ? clickPower.toNumber() : Number(clickPower)) || 0; } catch (e) { cpVal = Number(clickPower) || 0; }
        // 10 click power
        if (cpVal >= 10 && !localStorage.getItem('ach_cp_10')) {
            try { localStorage.setItem('ach_cp_10', '1'); } catch (e) {}
            try { addUnlockedTitle('Manual Operator'); } catch (e) {}
            try { showAchievementPopup('Something Happened', 'Reach 10 click power — Title: Manual Operator'); } catch (e) {}
        }
        // 69 click power
        if (cpVal >= 69 && !localStorage.getItem('ach_cp_69')) {
            try { localStorage.setItem('ach_cp_69', '1'); } catch (e) {}
            try { addUnlockedTitle('Nice'); } catch (e) {}
            try { showAchievementPopup('The Funny Number', 'Reach 69 click power — Title: Nice'); } catch (e) {}
        }
        // 5,000 click power
        if (cpVal >= 5000 && !localStorage.getItem('ach_cp_5000')) {
            try { localStorage.setItem('ach_cp_5000', '1'); } catch (e) {}
            try { addUnlockedTitle('Button Breaker'); } catch (e) {}
            try { showAchievementPopup('Noticeable Impact', 'Reach 5,000 click power — Title: Button Breaker'); } catch (e) {}
        }
        // 1,000,000 click power
        if (cpVal >= 1000000 && !localStorage.getItem('ach_cp_1m')) {
            try { localStorage.setItem('ach_cp_1m', '1'); } catch (e) {}
            try { addUnlockedTitle('One Click Wonder'); } catch (e) {}
            try { showAchievementPopup('The Button Fears You', 'Reach 1,000,000 click power — Title: One Click Wonder'); } catch (e) {}
        }
    } catch (e) { try { console.warn('checkClickPowerAchievements failed', e); } catch (e) {} }
}

// Check upgrade-level achievements (e.g., reach level 1000 on specific upgrades)
function checkUpgradeLevelAchievements() {
    try {
        // Landon Stream -> upgrade 20
        const landonLvl = Number(getUpgradeLevel(20) || 0) || 0;
        if (landonLvl >= 1000 && !localStorage.getItem('ach_landon_1000')) {
            try { localStorage.setItem('ach_landon_1000', '1'); } catch (e) {}
            try { addUnlockedTitle('landon stream'); } catch (e) {}
            try { showAchievementPopup('1000 Levels of Landon', 'Get Landon Stream to level 1000 — Title: landon stream'); } catch (e) {}
        }

        // The Bass -> upgrade 21
        const bassLvl = Number(getUpgradeLevel(21) || 0) || 0;
        if (bassLvl >= 1000 && !localStorage.getItem('ach_bass_1000')) {
            try { localStorage.setItem('ach_bass_1000', '1'); } catch (e) {}
            try { addUnlockedTitle('The Bass'); } catch (e) {}
            try { showAchievementPopup('The True Bass', 'Get The Bass to level 1000 — Title: The Bass'); } catch (e) {}
        }

        // Skibbidi Scimitar -> upgrade 14
        const skibidiLvl = Number(getUpgradeLevel(14) || 0) || 0;
        if (skibidiLvl >= 1000 && !localStorage.getItem('ach_skibidi_1000')) {
            try { localStorage.setItem('ach_skibidi_1000', '1'); } catch (e) {}
            try { addUnlockedTitle('The Strongest'); } catch (e) {}
            try { showAchievementPopup('Skibbidi Man', 'Get skibbidi scimitar to level 1000 — Title: The Strongest'); } catch (e) {}
        }
        // Phonk Man -> upgrade 10
        const phonkLvl = Number(getUpgradeLevel(10) || 0) || 0;
        if (phonkLvl >= 1000 && !localStorage.getItem('ach_phonk_1000')) {
            try { localStorage.setItem('ach_phonk_1000', '1'); } catch (e) {}
            try { addUnlockedTitle('Phonk Enjoyer'); } catch (e) {}
            try { showAchievementPopup('Phonk Aura', 'Get Phonk Man to level 1000 — Title: Phonk Enjoyer'); } catch (e) {}
        }

        // Tribal Camp -> upgrade 9
        const tribalLvl = Number(getUpgradeLevel(9) || 0) || 0;
        if (tribalLvl >= 1000 && !localStorage.getItem('ach_tribal_1000')) {
            try { localStorage.setItem('ach_tribal_1000', '1'); } catch (e) {}
            try { addUnlockedTitle('Camp Cheif'); } catch (e) {}
            try { showAchievementPopup('Keeper of the Camp', 'Get Tribal Camp to level 1000 — Title: Camp Cheif'); } catch (e) {}
        }

        // Argonian Autist -> upgrade 5
        const argonLvl = Number(getUpgradeLevel(5) || 0) || 0;
        if (argonLvl >= 1000 && !localStorage.getItem('ach_argon_1000')) {
            try { localStorage.setItem('ach_argon_1000', '1'); } catch (e) {}
            try { addUnlockedTitle('Argoonion'); } catch (e) {}
            try { showAchievementPopup('1000 argonions', 'Get Argonian Autist to level 1000 — Title: Argoonion'); } catch (e) {}
        }

        // Diddy Blud -> upgrade 4
        const diddyLvl = Number(getUpgradeLevel(4) || 0) || 0;
        if (diddyLvl >= 1000 && !localStorage.getItem('ach_diddy_1000')) {
            try { localStorage.setItem('ach_diddy_1000', '1'); } catch (e) {}
            try { addUnlockedTitle('partygoer'); } catch (e) {}
            try { showAchievementPopup('so much baby oil', 'Get Diddy Blud to level 1000 — Title: partygoer'); } catch (e) {}
        }

        // Somali Pirate -> upgrade 2
        const pirateLvl = Number(getUpgradeLevel(2) || 0) || 0;
        if (pirateLvl >= 1000 && !localStorage.getItem('ach_pirate_1000')) {
            try { localStorage.setItem('ach_pirate_1000', '1'); } catch (e) {}
            try { addUnlockedTitle('Somali Captain'); } catch (e) {}
            try { showAchievementPopup('Pirates Life for me', 'Get Somali Pirate to level 1000 — Title: Somali Captain'); } catch (e) {}
        }
    } catch (e) { try { console.warn('checkUpgradeLevelAchievements failed', e); } catch (e) {} }
}

// Check and unlock clan-based achievements
function checkClanAchievements() {
    try {
        const clanId = localStorage.getItem('player_clanId') || '';
        const clanRole = (localStorage.getItem('player_clanRole') || '').toLowerCase();

        // Join a clan (have a clan ID)
        if (clanId && clanId !== 'undefined' && !localStorage.getItem('ach_clan_joined')) {
            try { localStorage.setItem('ach_clan_joined', '1'); } catch (e) {}
            try { addUnlockedTitle('Clan Recruit'); } catch (e) {}
            try { showAchievementPopup('Clan Member', 'Join or create a clan — Title: Clan Recruit'); } catch (e) {}
        }

        // Create a clan (flag set from clan.html when user creates a clan)
        if (localStorage.getItem('ach_clan_created') === '1') {
            try { addUnlockedTitle('Clan Founder'); } catch (e) {}
        }

        // Created a clan (achievement popup only once)
        if (localStorage.getItem('ach_clan_created') === '1' && !localStorage.getItem('ach_clan_created_shown')) {
            try { localStorage.setItem('ach_clan_created_shown', '1'); } catch (e) {}
            try { showAchievementPopup('Clan Founder', 'Create a clan — Title: Clan Founder'); } catch (e) {}
        }

        // Be co-leader of a clan
        if ((clanRole === 'co-leader' || clanRole === 'coleader') && !localStorage.getItem('ach_clan_coleader')) {
            try { localStorage.setItem('ach_clan_coleader', '1'); } catch (e) {}
            try { addUnlockedTitle('Lieutenant'); } catch (e) {}
            try { showAchievementPopup('Second in Command', 'Become a co-leader of a clan — Title: Lieutenant'); } catch (e) {}
        }

        // Be owner/leader of a clan
        if ((clanRole === 'owner' || clanRole === 'leader') && !localStorage.getItem('ach_clan_owner')) {
            try { localStorage.setItem('ach_clan_owner', '1'); } catch (e) {}
            try { addUnlockedTitle('Warlord'); } catch (e) {}
            try { showAchievementPopup('Warlord', 'Become the owner of a clan — Title: Warlord'); } catch (e) {}
        }
    } catch (e) { try { console.warn('checkClanAchievements failed', e); } catch (e) {} }
}

// ========== Titles (unlock, equip, display) ==========
// Titles management (stored in localStorage key 'unlocked_titles' as JSON array)
// Title rarity metadata. Assign each title a rarity key.
const TITLE_RARITIES = {
    'Indoor Specialist': 'uncommon',
    'Chronically Online': 'rare',
    'Permanently Online': 'epic',
    'Loop Initiater': 'common',
    'Pattern Recognizer': 'uncommon',
    'Loop Surviver': 'rare',
    'Keeper of the Loop': 'legendary',
    'Manual Operator': 'common',
    'Nice': 'uncommon',
    'Button Breaker': 'rare',
    'One Click Wonder': 'epic',
    'The Automtor': 'common',
    'Automation Enjoyer': 'uncommon',
    'Observer Of Motion.': 'legendary'
    ,
    'landon stream': 'epic',
    'The Bass': 'epic',
    'The Strongest': 'rare'
    ,
    'Phonk Enjoyer': 'rare',
    'Camp Cheif': 'uncommon',
    'Argoonion': 'uncommon',
    'partygoer': 'common',
    'Somali Captain': 'uncommon',
    'Clan Recruit': 'common',
    'Clan Founder': 'uncommon',
    'Lieutenant': 'uncommon',
    'Warlord': 'rare'
};

// Color map for rarities
const RARITY_COLORS = {
    common: '#bfc7c9',
    uncommon: '#6bd26b',
    rare: '#4da6ff',
    epic: '#b86cff',
    legendary: '#ffb84d'
};

function normalizeTitleObj(item) {
    // accept either a string (legacy) or an object {name,rarity}
    if (!item) return null;
    if (typeof item === 'string') {
        return { name: item, rarity: TITLE_RARITIES[item] || 'common' };
    }
    if (typeof item === 'object' && item.name) {
        return { name: item.name, rarity: item.rarity || TITLE_RARITIES[item.name] || 'common' };
    }
    return null;
}

function getUnlockedTitles() {
    try {
        const raw = localStorage.getItem('unlocked_titles');
        if (!raw) return [];
        const parsed = JSON.parse(raw);
        if (!Array.isArray(parsed)) return [];
        const out = [];
        for (const it of parsed) {
            const n = normalizeTitleObj(it);
            if (n) out.push(n);
        }
        return out;
    } catch (e) { return []; }
}

function saveUnlockedTitles(arr) {
    try {
        const normalized = (arr || []).map(a => (typeof a === 'string' ? { name: a, rarity: TITLE_RARITIES[a] || 'common' } : (a && a.name ? { name: a.name, rarity: a.rarity || TITLE_RARITIES[a.name] || 'common' } : null))).filter(Boolean);
        localStorage.setItem('unlocked_titles', JSON.stringify(normalized));
    } catch (e) {}
}

function addUnlockedTitle(title) {
    if (!title) return;
    try {
        const list = getUnlockedTitles();
        const name = (typeof title === 'string') ? title : (title.name || '');
        if (!name) return;
        if (!list.find(x => x.name === name)) {
            const obj = { name, rarity: TITLE_RARITIES[name] || (typeof title === 'object' && title.rarity) || 'common' };
            list.push(obj);
            saveUnlockedTitles(list);
            try { populateTitleSelect(); } catch (e) {}
        }
    } catch (e) {}
}
function getEquippedTitle() {
    try { return localStorage.getItem('equipped_title') || ''; } catch (e) { return ''; }
}
function setEquippedTitle(title) {
    try { if (title) localStorage.setItem('equipped_title', title); else localStorage.removeItem('equipped_title'); } catch (e) {}
    try { populateTitleSelect(); } catch (e) {}
    try { updateDisplays(); } catch (e) {}
    try { refreshEquippedTitleDisplay(); } catch (e) {}
    try{ try{ window.dispatchEvent(new Event('equippedTitleChanged')); }catch(e){} }catch(e){}
}

function populateTitleSelect() {
    try {
        const sel = document.getElementById('titleSelect');
        if (!sel) return;
        const current = getEquippedTitle();
        // clear
        sel.innerHTML = '';
        const optNone = document.createElement('option');
        optNone.value = '';
        optNone.text = '(None)';
        sel.appendChild(optNone);
        const titles = getUnlockedTitles();
        for (const t of titles) {
            const o = document.createElement('option');
            o.value = t.name;
            o.text = t.name;
            // color by rarity if supported
            try { o.style.color = RARITY_COLORS[t.rarity] || ''; } catch (e) {}
            sel.appendChild(o);
        }
        sel.value = current || '';
    } catch (e) {}
}

// populate on load and when storage changes
try { document.addEventListener('DOMContentLoaded', populateTitleSelect); } catch (e) {}
try { window.addEventListener('storage', populateTitleSelect); } catch (e) {}

function refreshEquippedTitleDisplay(){
    try {
        const el = document.getElementById('equippedTitleDisplay');
        if (!el) return;
        const t = getEquippedTitle();
        if (!t) { el.innerText = ''; return; }
        // find rarity for equipped title
        const titles = getUnlockedTitles();
        const obj = titles.find(x => x.name === t) || { name: t, rarity: TITLE_RARITIES[t] || 'common' };
        const color = RARITY_COLORS[obj.rarity] || '';
        el.innerHTML = `<span style="color:${color};font-weight:700">${obj.name}</span>`;
    } catch (e) {}
}
try { document.addEventListener('DOMContentLoaded', refreshEquippedTitleDisplay); } catch (e) {}
try { window.addEventListener('storage', refreshEquippedTitleDisplay); } catch (e) {}


// compute total cost to buy `batch` levels given current cost and multiplicative rate
function computeBatchCost(currentCost, batch, rate) {
    const b = Math.max(1, Math.floor(safeNum(batch, 1)));
    if (hasDecimal) {
        let total = D(0);
        let temp = D(safeNum(currentCost, 0));
        const r = D(safeNum(rate, 1.1));
        for (let i = 0; i < b; i++) {
            total = total.plus(temp);
            temp = temp.times(r).ceil();
        }
        return total;
    } else {
        let total = 0;
        let temp = safeNum(currentCost, 0);
        const r = safeNum(rate, 1.1);
        for (let i = 0; i < b; i++) {
            total += temp;
            temp = Math.ceil(temp * r);
        }
        return total;
    }
}
// same as computeBatchCost but with Divine Simple Villager discount applied (for normal upgrade costs)
function computeBatchCostWithSimpleVillager(currentCost, batch, rate) {
    const raw = computeBatchCost(currentCost, batch, rate);
    const mult = getSimpleVillagerMultiplier();
    if (hasDecimal && isDecimalInstance(raw)) return raw.times(mult);
    return (typeof raw === 'number' ? raw : Number(raw)) * mult;
}

// compute multiplicative bonus for an upgrade given its level
// Rules (apply after level 500):
// - every 25 levels after 500 => x2 per 25
// - every multiple of 100 (beyond 500) => x4 per 100
// - every multiple of 1000 => x10 per 1000
function computeLevelMultiplier(level) {
    const lv = Number(isDecimalInstance(level) ? level.toNumber() : safeNum(level, 0)) || 0;
    if (lv <= 500) return 1;
    const n25 = Math.floor((lv - 500) / 25);
    const n100 = Math.max(0, Math.floor(lv / 100) - 5); // multiples of 100 beyond 500
    const n1000 = Math.floor(lv / 1000);
    return Math.pow(2, n25) * Math.pow(4, n100) * Math.pow(10, n1000);
}

// Return the numeric level for a given upgrade index (1..12)
function getUpgradeLevel(idx) {
    switch (Number(safeNum(idx, 0))) {
        case 1: return upgrade1Level || 0;
        case 2: return upgrade2Level || 0;
        case 3: return upgrade3Level || 0;
        case 4: return upgrade4Level || 0;
        case 5: return upgrade5Level || 0;
        case 6: return upgrade6Level || 0;
        case 7: return upgrade7Level || 0;
        case 8: return upgrade8Level || 0;
        case 9: return upgrade9Level || 0;
        case 10: return upgrade10Level || 0;
        case 11: return upgrade11Level || 0;
        case 12: return upgrade12Level || 0;
        case 13: return upgrade13Level || 0;
        case 14: return upgrade14Level || 0;
        case 15: return upgrade15Level || 0;
        case 16: return upgrade16Level || 0;
        case 17: return upgrade17Level || 0;
        case 18: return upgrade18Level || 0;
        case 19: return upgrade19Level || 0;
        case 20: return upgrade20Level || 0;
        case 21: return upgrade21Level || 0;
        case 22: return upgrade22Level || 0;
        case 23: return upgrade23Level || 0;
        case 24: return upgrade24Level || 0;
        default: return 0;
    }
}

// Given a level >= 500, return the next milestone and its single-step boost
// e.g. { level: 525, boost: 2 } or { level: 1000, boost: 10 }
function getNextMilestone(level) {
    const lv = Number(isDecimalInstance(level) ? level.toNumber() : safeNum(level, 0)) || 0;
    if (lv < 500) return null;
    // next 25-multiple after 500
    const n25 = Math.floor((lv - 500) / 25) + 1;
    const next25 = 500 + n25 * 25;
    // next 100-multiple
    const next100 = (Math.floor(lv / 100) + 1) * 100;
    // next 1000-multiple
    const next1000 = (Math.floor(lv / 1000) + 1) * 1000;
    // pick the closest milestone greater than current level
    const candidates = [next25, next100, next1000].filter(n => n > lv);
    if (candidates.length === 0) return null;
    const next = Math.min(...candidates);
    // determine boost for that milestone (prefer largest applicable special)
    if (next % 1000 === 0) return { level: next, boost: 10 };
    if (next % 100 === 0) return { level: next, boost: 4 };
    if (next % 25 === 0) return { level: next, boost: 2 };
    return null;
}

// compute effective cps components (pirate, other, jonathan, cr) applying per-upgrade multipliers
function computeEffectiveCpsParts() {
    if (hasDecimal) {
        // per-level base contributions for normal upgrades (Decimal)
        const per = {
            2: D(1),
            3: D(5),
            4: D(20),
            5: D(100),
            6: D(500),
            7: D(5000),
            8: D(20000),
            9: D(100000),
            10: D(500000),
            11: D(1500000),
            12: D(5000000),
            13: D(20000000),
            14: D(50000000),
            15: D(500000000),
            16: D(2000000000)
        };

        // SCP specials visibility and button states (show when upgrade17 purchased at least once)
        const expectedPirate = pirateLvl.times(per[2]);
        const pirateExtra = D(typeof pirateCps !== 'undefined' ? pirateCps : 0).minus(expectedPirate);
        const pirateMult = D(computeLevelMultiplier(Number(pirateLvl)));
        const pirateEffective = expectedPirate.times(pirateMult).plus(typeof pirateExtra.isNaN === 'function' ? (pirateExtra.isNaN() ? D(0) : pirateExtra) : pirateExtra);

        // other upgrades 3..10
        let expectedOther = D(0);
        let derivedOther = D(0);
        for (let i = 3; i <= 10; i++) {
            const lvl = D(getUpgradeLevel(i));
            const base = (per[i] || D(0)).times(lvl);
            expectedOther = expectedOther.plus(base);
            const mult = D(computeLevelMultiplier(Number(lvl)));
            derivedOther = derivedOther.plus(base.times(mult));
        }
        // account for upgrade13 (ropingnecurse) separately so it can get its own multiplier
        const upgrade13Lvl = D(getUpgradeLevel(13));
        const per13 = per[13] || D(0);
        // Ropingnecurse should contribute linearly per level (like other upgrades)
        const expectedRoping = (upgrade13Lvl.gt(0) && per13.gt(0)) ? per13.times(upgrade13Lvl) : D(0);
        // baseOtherCps may include special one-off additions; exclude expectedRoping from the generic extra
        const baseOtherExtra = D(typeof baseOtherCps !== 'undefined' ? baseOtherCps : 0).minus(expectedOther).minus(expectedRoping);
        const otherBase = derivedOther.plus(baseOtherExtra.gt(0) ? baseOtherExtra : D(0));
        // compute roping contribution with its own level multiplier and roping-specific multiplier
        const ropingMult = D(computeLevelMultiplier(Number(upgrade13Lvl)));
        const ropingEffective = expectedRoping.times(ropingMult).times(D(ropingOtherMultiplier || 1));

        // account for upgrade14 (skibbidi scimitar) separately so specials multiply it
        const upgrade14Lvl = D(getUpgradeLevel(14));
        const per14 = per[14] || D(0);
        const expectedSkibidi = (upgrade14Lvl.gt(0) && per14.gt(0)) ? per14.times(upgrade14Lvl) : D(0);
        const skibidiMult = D(computeLevelMultiplier(Number(upgrade14Lvl)));
        const skibidiEffective = expectedSkibidi.times(skibidiMult).times(D(skibbidiOtherMultiplier || 1));

        // account for upgrade15 (What Happened Beats) separately so its specials multiply it
        const upgrade15Lvl = D(getUpgradeLevel(15));
        const per15 = per[15] || D(0);
        const expectedBeats = (upgrade15Lvl.gt(0) && per15.gt(0)) ? per15.times(upgrade15Lvl) : D(0);
        const beatsMult = D(computeLevelMultiplier(Number(upgrade15Lvl)));
        const beatsEffective = expectedBeats.times(beatsMult).times(D(beatsOtherMultiplier || 1));

        // account for upgrade16 (ez villager) separately so specials multiply it
        const upgrade16Lvl = D(getUpgradeLevel(16));
        const per16 = per[16] || D(0);
        const expectedEz = (upgrade16Lvl.gt(0) && per16.gt(0)) ? per16.times(upgrade16Lvl) : D(0);
        const ezMult = D(computeLevelMultiplier(Number(upgrade16Lvl)));
        const ezEffective = expectedEz.times(ezMult).times(D(ezOtherMultiplier || 1));

        // account for upgrade17 (scp wish I knew.) separately so its specials multiply it
        const upgrade17Lvl = D(getUpgradeLevel(17));
        const per17 = D(10000000000); // 10B per level
        const expectedScp = (upgrade17Lvl.gt(0) && per17.gt(0)) ? per17.times(upgrade17Lvl) : D(0);
        const scpMult = D(computeLevelMultiplier(Number(upgrade17Lvl)));
        const scpEffectiveDec = expectedScp.times(scpMult).times(D(scpMultiplier || 1));

        // account for upgrade18 (The Goatis) so its specials multiply it
        const upgrade18Lvl = D(getUpgradeLevel(18));
        const per18 = D(150000000000); // 150B per level
        const expectedGoatis = (upgrade18Lvl.gt(0) && per18.gt(0)) ? per18.times(upgrade18Lvl) : D(0);
        const goatisMultDec = D(computeLevelMultiplier(Number(upgrade18Lvl)));
        const goatisEffectiveDec = expectedGoatis.times(goatisMultDec).times(D(typeof goatisMultiplier !== 'undefined' ? goatisMultiplier : 1));

        // account for upgrade19 (goatises raw liver)
        const upgrade19Lvl = D(getUpgradeLevel(19));
        const per19 = D(2000000000000); // 2T per level
        const expectedRaw = (upgrade19Lvl.gt(0) && per19.gt(0)) ? per19.times(upgrade19Lvl) : D(0);
        const rawMultDec = D(computeLevelMultiplier(Number(upgrade19Lvl)));
        const rawEffectiveDec = expectedRaw.times(rawMultDec).times(D(typeof rawMultiplier !== 'undefined' ? rawMultiplier : 1));

        // account for upgrade20 (The Landon Stream)
        const upgrade20Lvl = D(getUpgradeLevel(20));
        const per20 = D(50000000000000); // 50T per level
        const expectedLandon = (upgrade20Lvl.gt(0) && per20.gt(0)) ? per20.times(upgrade20Lvl) : D(0);
        const landonMult = D(computeLevelMultiplier(Number(upgrade20Lvl)));
        const landonEffective = expectedLandon.times(landonMult).times(D(typeof landonMultiplier !== 'undefined' ? landonMultiplier : 1));

        // account for upgrade21 (The Bass)
        const upgrade21Lvl = D(getUpgradeLevel(21));
        const per21 = D(1000000000000000); // 1Q per level
        const expectedTheBass = (upgrade21Lvl.gt(0) && per21.gt(0)) ? per21.times(upgrade21Lvl) : D(0);
        const theBassMult = D(computeLevelMultiplier(Number(upgrade21Lvl)));
        const theBassEffective = expectedTheBass.times(theBassMult).times(D(typeof theBassMultiplier !== 'undefined' ? theBassMultiplier : 1));

        // account for upgrade22 (Good Noodles)
        const upgrade22Lvl = D(getUpgradeLevel(22));
        const per22 = D(50000000000000000); // 50Q per level
        const expectedGoodNoodles = (upgrade22Lvl.gt(0) && per22.gt(0)) ? per22.times(upgrade22Lvl) : D(0);
        const goodNoodlesMult = D(computeLevelMultiplier(Number(upgrade22Lvl)));
        const goodNoodlesEffective = expectedGoodNoodles.times(goodNoodlesMult).times(D(typeof goodNoodlesMultiplier !== 'undefined' ? goodNoodlesMultiplier : 1));

        // account for upgrade23 (Mobile Man 38)
        const upgrade23Lvl = D(getUpgradeLevel(23));
        const per23 = D(500000000000000000); // 500Q per level
        const expectedMobileMan = (upgrade23Lvl.gt(0) && per23.gt(0)) ? per23.times(upgrade23Lvl) : D(0);
        const mobileManMult = D(computeLevelMultiplier(Number(upgrade23Lvl)));
        const mobileManEffective = expectedMobileMan.times(mobileManMult).times(D(typeof mobileMan38Multiplier !== 'undefined' ? mobileMan38Multiplier : 1));

        // account for upgrade24 (Easton Bundy)
        const upgrade24Lvl = D(getUpgradeLevel(24));
        const per24 = D(1000000000000000000); // 1000Q per level
        const expectedEaston = (upgrade24Lvl.gt(0) && per24.gt(0)) ? per24.times(upgrade24Lvl) : D(0);
        const eastonMultDec = D(computeLevelMultiplier(Number(upgrade24Lvl)));
        const eastonEffective = expectedEaston.times(eastonMultDec).times(D(typeof eastonBundyMultiplier !== 'undefined' ? eastonBundyMultiplier : 1));

        const otherEffective = otherBase.plus(ropingEffective).plus(skibidiEffective).plus(beatsEffective).plus(ezEffective).plus(scpEffectiveDec).plus(goatisEffectiveDec).plus(rawEffectiveDec).plus(landonEffective).plus(theBassEffective).plus(goodNoodlesEffective).plus(mobileManEffective).plus(eastonEffective);

        // jonathan (upgrade11)
        const jonathanLvl = D(getUpgradeLevel(11));
        const expectedJonathan = jonathanLvl.times(per[11]);
        const jonathanExtra = D(typeof jonathanBaseCps !== 'undefined' ? jonathanBaseCps : 0).minus(expectedJonathan);
        const jonathanMult = D(computeLevelMultiplier(Number(jonathanLvl)));
        const jonathanEffective = expectedJonathan.times(jonathanMult).plus(typeof jonathanExtra.isNaN === 'function' ? (jonathanExtra.isNaN() ? D(0) : jonathanExtra) : jonathanExtra);

        // CR lurker (upgrade12)
        const crLvl = D(getUpgradeLevel(12));
        const expectedCr = crLvl.times(per[12]);
        const crExtra = D(typeof crBaseCps !== 'undefined' ? crBaseCps : 0).minus(expectedCr);
        const crMult = D(computeLevelMultiplier(Number(crLvl)));
        const crEffective = expectedCr.times(crMult).plus(typeof crExtra.isNaN === 'function' ? (crExtra.isNaN() ? D(0) : crExtra) : crExtra);

        return {
            pirateEffective,
            otherEffective,
            jonathanEffective,
            crEffective,
            eastonEffective
        };
    } else {
        // per-level base contributions for normal upgrades
        const per = {
            2: 1,
            3: 5,
            4: 20,
            5: 100,
            6: 500,
            7: 5000,
            8: 20000,
            9: 100000,
            10: 500000,
            11: 1500000,
            12: 5000000,
            13: 20000000,
            14: 50000000,
            15: 500000000,
            16: 2000000000
        };
        // pirate (upgrade2)
        const pirateLvl = getUpgradeLevel(2);
        const expectedPirate = pirateLvl * per[2];
        const pirateExtra = (typeof pirateCps === 'number' ? pirateCps : 0) - expectedPirate;
        const pirateMult = computeLevelMultiplier(pirateLvl);
        const pirateEffective = expectedPirate * pirateMult + (pirateExtra || 0);

        // other upgrades 3..10
        let expectedOther = 0;
        let derivedOther = 0;
        for (let i = 3; i <= 10; i++) {
            const lvl = getUpgradeLevel(i);
            const base = (per[i] || 0) * lvl;
            expectedOther += base;
            const mult = computeLevelMultiplier(lvl);
            derivedOther += base * mult;
        }
        // account for upgrade13 (ropingnecurse) separately so it can get its own multiplier
        const upgrade13Lvl = getUpgradeLevel(13);
        // Ropingnecurse increases by 10% each upgrade: cumulative geometric series
        const per13 = per[13] || 0;
        // Ropingnecurse should contribute linearly per level (like other upgrades)
        const expectedRoping = (upgrade13Lvl > 0 && per13 > 0) ? per13 * upgrade13Lvl : 0;
        // baseOtherCps may include special one-off additions; exclude expectedRoping from the generic extra
        const baseOtherExtra = (typeof baseOtherCps === 'number' ? baseOtherCps : 0) - expectedOther - expectedRoping;
        const otherBase = derivedOther + (baseOtherExtra > 0 ? baseOtherExtra : 0);
        // compute roping contribution with its own level multiplier and roping-specific multiplier
        const ropingMult = computeLevelMultiplier(upgrade13Lvl);
        const ropingEffective = expectedRoping * ropingMult * (ropingOtherMultiplier || 1);

        // account for upgrade14 (skibbidi scimitar) separately so specials multiply it
        const upgrade14Lvl = getUpgradeLevel(14);
        const per14 = per[14] || 0;
        const expectedSkibidi = (upgrade14Lvl > 0 && per14 > 0) ? per14 * upgrade14Lvl : 0;
        const skibidiMult = computeLevelMultiplier(upgrade14Lvl);
        const skibidiEffective = expectedSkibidi * skibidiMult * (skibbidiOtherMultiplier || 1);

        // account for upgrade15 (What Happened Beats) separately so its specials multiply it
        const upgrade15Lvl = getUpgradeLevel(15);
        const per15 = per[15] || 0;
        const expectedBeats = (upgrade15Lvl > 0 && per15 > 0) ? per15 * upgrade15Lvl : 0;
        const beatsMult = computeLevelMultiplier(upgrade15Lvl);
        const beatsEffective = expectedBeats * beatsMult * (beatsOtherMultiplier || 1);

        // account for upgrade16 (ez villager) separately so specials multiply it
        const upgrade16Lvl = getUpgradeLevel(16);
        const per16 = per[16] || 0;
        const expectedEz = (upgrade16Lvl > 0 && per16 > 0) ? per16 * upgrade16Lvl : 0;
        const ezMult = computeLevelMultiplier(upgrade16Lvl);
        const ezEffective = expectedEz * ezMult * (ezOtherMultiplier || 1);

        const otherEffective = otherBase + ropingEffective + skibidiEffective + beatsEffective + ezEffective;

        // account for upgrade17 (scp wish I knew.) separately so its specials multiply it
        const upgrade17Lvl = getUpgradeLevel(17);
        const per17 = 10000000000; // 10B per level
        const expectedScp = (upgrade17Lvl > 0 && per17 > 0) ? per17 * upgrade17Lvl : 0;
        const scpMult = computeLevelMultiplier(upgrade17Lvl);
        const scpEffective = expectedScp * scpMult * (scpMultiplier || 1);

        // account for upgrade18 (The Goatis)
        const upgrade18Lvl = getUpgradeLevel(18);
        const per18 = 150000000000; // 150B per level
        const expectedGoatis = (upgrade18Lvl > 0 && per18 > 0) ? per18 * upgrade18Lvl : 0;
        const goatisMult = computeLevelMultiplier(upgrade18Lvl);
        const goatisEffective = expectedGoatis * goatisMult * (goatisMultiplier || 1);

        // account for upgrade20 (The Landon Stream)
        const upgrade20Lvl = getUpgradeLevel(20);
        const per20 = 50000000000000; // 50T per level
        const expectedLandon = (upgrade20Lvl > 0 && per20 > 0) ? per20 * upgrade20Lvl : 0;
        const landonMult = computeLevelMultiplier(upgrade20Lvl);
        const landonEffective = expectedLandon * landonMult * (landonMultiplier || 1);

        // account for upgrade21 (The Bass)
        const upgrade21Lvl = getUpgradeLevel(21);
        const per21 = 1000000000000000; // 1Q per level
        const expectedTheBass = (upgrade21Lvl > 0 && per21 > 0) ? per21 * upgrade21Lvl : 0;
        const theBassMult = computeLevelMultiplier(upgrade21Lvl);
        const theBassEffective = expectedTheBass * theBassMult * (theBassMultiplier || 1);

        // account for upgrade22 (Good Noodles)
        const upgrade22Lvl = getUpgradeLevel(22);
        const per22 = 50000000000000000; // 50Q per level
        const expectedGoodNoodles = (upgrade22Lvl > 0 && per22 > 0) ? per22 * upgrade22Lvl : 0;
        const goodNoodlesMult = computeLevelMultiplier(upgrade22Lvl);
        const goodNoodlesEffective = expectedGoodNoodles * goodNoodlesMult * (goodNoodlesMultiplier || 1);

        // account for upgrade23 (Mobile Man 38)
        const upgrade23Lvl = getUpgradeLevel(23);
        const per23 = 500000000000000000; // 500Q per level
        const expectedMobileMan = (upgrade23Lvl > 0 && per23 > 0) ? per23 * upgrade23Lvl : 0;
        const mobileManMult = computeLevelMultiplier(upgrade23Lvl);
        const mobileManEffective = expectedMobileMan * mobileManMult * (mobileMan38Multiplier || 1);

        // account for upgrade24 (Easton Bundy)
        const upgrade24Lvl = getUpgradeLevel(24);
        const per24 = 1000000000000000000; // 1000Q per level
        const expectedEaston = (upgrade24Lvl > 0 && per24 > 0) ? per24 * upgrade24Lvl : 0;
        const eastonMult = computeLevelMultiplier(upgrade24Lvl);
        const eastonEffective = expectedEaston * eastonMult * (typeof eastonBundyMultiplier !== 'undefined' ? eastonBundyMultiplier : 1);

        // account for upgrade19 (goatises raw liver)
        const upgrade19Lvl = getUpgradeLevel(19);
        const per19 = 2000000000000; // 2T per level
        const expectedRaw = (upgrade19Lvl > 0 && per19 > 0) ? per19 * upgrade19Lvl : 0;
        const rawMult = computeLevelMultiplier(upgrade19Lvl);
        const rawEffective = expectedRaw * rawMult * (rawMultiplier || 1);

        const otherEffectiveFinal = otherEffective + scpEffective + goatisEffective + rawEffective + landonEffective + theBassEffective + goodNoodlesEffective + mobileManEffective + eastonEffective;

        // jonathan (upgrade11)
        const jonathanLvl = getUpgradeLevel(11);
        const expectedJonathan = jonathanLvl * per[11];
        const jonathanExtra = (typeof jonathanBaseCps === 'number' ? jonathanBaseCps : 0) - expectedJonathan;
        const jonathanMult = computeLevelMultiplier(jonathanLvl);
        const jonathanEffective = expectedJonathan * jonathanMult + (jonathanExtra || 0);

        // CR lurker (upgrade12)
        const crLvl = getUpgradeLevel(12);
        const expectedCr = crLvl * per[12];
        const crExtra = (typeof crBaseCps === 'number' ? crBaseCps : 0) - expectedCr;
        const crMult = computeLevelMultiplier(crLvl);
        const crEffective = expectedCr * crMult + (crExtra || 0);

        return {
            pirateEffective,
            otherEffective: otherEffectiveFinal,
            jonathanEffective,
            crEffective,
            eastonEffective
        };
    }
}

// Upgrade hover descriptions — edit these strings to change the tooltip text for each upgrade.
// Keys should match the button IDs (e.g. 'upgrade1', 'upgrade2', ...).
// Example: UPGRADE_DESCRIPTIONS.upgrade1 = 'OP mouse: Increases click power by 1.';
const UPGRADE_DESCRIPTIONS = {
    upgrade1: 'Is your mouse just not cutting it? Get the OP mouse to increase your click power significantly!',
    upgrade2: 'This Somali Pirate will plunder what happends for you, for a price.',
    upgrade3: 'With his chainsaws, the Goonsaw Man can cut through anything, including your cps needs',
    upgrade4: 'The Diddy Blud is here to give you a boost in cps, just like he did in the good old days.',
    upgrade5: 'The Argonian Autist brings unparalleled focus and efficiency to your cps generation.',
    upgrade6: 'While not the brightest fruit god in the bunch, the Grape God still offers a juicy boost to your cps.',
    upgrade7: 'skippie the toilet, skippie the skippie the toilet',
    upgrade8: 'Nobody knows what goes on in this island, and maybe its better that way. Best not to ask questions with the cps boost it provides.',
    upgrade9: 'The tribal camp provides a mysterious energy that enhances your cps.',
    upgrade10: 'Inspire your other units with the phonk from the phonk man',
    upgrade11: 'His name is johnathan. He seems like a normal guy, but his dedication to what happened is unmatched, boosting your cps significantly.',
    upgrade12: 'Nobody knows what "CR" stands for, but this lurker\'s obsession with what happened grants you a substantial cps increase. Get CR Lurker to level 150 to unlock prestige.'
    ,
    upgrade13: 'ropingnecurse: A cursed rope that strangely amplifies your other CPS',
    upgrade15: 'What Happened Beats: Produce massive rhythmic output'
};
UPGRADE_DESCRIPTIONS.upgrade16 = 'Make these lazy villagers do all the work for you so you can reap the cps';
UPGRADE_DESCRIPTIONS.upgrade17 = 'Wish i knew wish i knew wish i knew wish i knew wish i knew wish i knew wish i knew wish i knew';
UPGRADE_DESCRIPTIONS.upgrade18 = 'You never wanted chocolate...';
UPGRADE_DESCRIPTIONS.upgrade19 = '...you wanted raw liver.';
UPGRADE_DESCRIPTIONS.upgrade20 = 'most respectful christian main';
UPGRADE_DESCRIPTIONS.upgrade21 = "What is the cat's name?";
UPGRADE_DESCRIPTIONS.upgrade22 = 'We eating good noodles every day';
UPGRADE_DESCRIPTIONS.upgrade23 = 'Mobile Man 38: A mobile service that produces large passive output (500Q cps per level).';
UPGRADE_DESCRIPTIONS.upgrade24 = 'Easton Bundy: An exceptional operator who provides powerful passive cps generation (1,000Q cps per level).';

// currently hovered upgrade id (e.g. 'upgrade3') — used to refresh tooltip content live
let currentHoveredUpgradeId = null;

// build tooltip HTML for a given upgrade id
function getTooltipHtmlForUpgrade(id) {
    const desc = UPGRADE_DESCRIPTIONS[id] || document.getElementById(id)?.dataset?.desc || 'The Strongest';
    let cpsVal = getUpgradeCps(id);
    const unit = (id === 'upgrade1') ? 'click power' : 'cps';
    // ensure ez villager tooltip computes its CPS correctly (some branches may show 0)
    try {
        if (id === 'upgrade16') {
            if (hasDecimal) {
                const per16 = D(2000000000);
                const lvl = D(upgrade16Level || 0);
                const base = (lvl.gt(0) && per16.gt(0)) ? per16.times(lvl) : D(0);
                const eff = base.times(D(computeLevelMultiplier(Number(lvl))));
                const goon = D(typeof goonMultiplier !== 'undefined' ? goonMultiplier : 1);
                const ezMultLocal = D(typeof ezOtherMultiplier !== 'undefined' ? ezOtherMultiplier : 1);
                const globalSectionMultLocal = D(typeof diddyMultiplier !== 'undefined' ? diddyMultiplier : 1).times(D(typeof argonMultiplier !== 'undefined' ? argonMultiplier : 1)).times(D(typeof grapeMultiplier !== 'undefined' ? grapeMultiplier : 1)).times(D(typeof skippieMultiplier !== 'undefined' ? skippieMultiplier : 1)).times(D(typeof islandMultiplier !== 'undefined' ? islandMultiplier : 1)).times(D(typeof tribalMultiplier !== 'undefined' ? tribalMultiplier : 1)).times(D(typeof phonkMultiplier !== 'undefined' ? phonkMultiplier : 1)).times(D(typeof ezMultiplier !== 'undefined' ? ezMultiplier : 1));
                const goldenMultLocal = D(1).plus(D(goldenWhat || 0).times(D(0.1)));
                const divineArgonMultLocal = (typeof divineArgonLevel !== 'undefined' && divineArgonLevel > 0) ? D(1).plus(D(DIVINE_ARGON_BASE_PERCENT).times(D(2).pow(Math.max(0, (divineArgonLevel||0)-1))).div(D(100))) : D(1);
                cpsVal = eff.times(goon).times(ezMultLocal).times(globalSectionMultLocal).times(goldenMultLocal).times(divineArgonMultLocal);
            } else {
                const per16 = 2000000000;
                const lvl = upgrade16Level || 0;
                const base = (lvl > 0 && per16 > 0) ? per16 * lvl : 0;
                const eff = base * computeLevelMultiplier(lvl);
                const goon = (typeof goonMultiplier !== 'undefined' ? goonMultiplier : 1);
                const ezMultLocal = (typeof ezOtherMultiplier !== 'undefined' ? ezOtherMultiplier : 1);
                const globalSectionMultLocal = (typeof diddyMultiplier !== 'undefined' ? diddyMultiplier : 1) * (typeof argonMultiplier !== 'undefined' ? argonMultiplier : 1) * (typeof grapeMultiplier !== 'undefined' ? grapeMultiplier : 1) * (typeof skippieMultiplier !== 'undefined' ? skippieMultiplier : 1) * (typeof islandMultiplier !== 'undefined' ? islandMultiplier : 1) * (typeof tribalMultiplier !== 'undefined' ? tribalMultiplier : 1) * (typeof phonkMultiplier !== 'undefined' ? phonkMultiplier : 1) * (typeof ezMultiplier !== 'undefined' ? ezMultiplier : 1);
                const goldenMultLocal = 1 + (goldenWhat * 0.1);
                // apply Divine Argonian multiplier if purchased
                let divineArgonMultLocal = 1;
                if (typeof divineArgonLevel !== 'undefined' && divineArgonLevel > 0) {
                    const appliedPercent = DIVINE_ARGON_BASE_PERCENT * Math.pow(2, Math.max(0, divineArgonLevel - 1));
                    divineArgonMultLocal = 1 + (appliedPercent / 100);
                }
                cpsVal = eff * goon * ezMultLocal * globalSectionMultLocal * goldenMultLocal * divineArgonMultLocal;
            }
        }
    } catch (e) {}
    let cpsText;
    if (hasDecimal && isDecimalInstance(cpsVal)) cpsText = formatNumber(cpsVal) + ' ' + unit;
    else cpsText = isFinite(cpsVal) ? formatNumber(cpsVal) + ' ' + unit : '0 ' + unit;
    const idx = Number(id.replace('upgrade','')) || 0;
    let milestoneHtml = '';
    const lvl = getUpgradeLevel(idx);
    if (lvl >= 500) {
        const m = getNextMilestone(lvl);
        if (m) {
            const unitText = (id === 'upgrade1') ? 'click power' : 'cps';
            milestoneHtml = `<div style="margin-top:6px;color:#ffd;">Next milestone — At level ${m.level}: ${m.boost}X ${unitText}</div>`;
        }
    }
    // show next special countdown if available (computed in updateDisplays)
    let nextSpecialHtml = '';
    try {
        if (window.__nextSpecialFor && Object.prototype.hasOwnProperty.call(window.__nextSpecialFor, idx)) {
            const target = Number(window.__nextSpecialFor[idx]);
            const curr = numericLevel(getUpgradeLevel(idx));
            const diff = Math.max(0, target - curr);
            if (diff > 0) nextSpecialHtml = `<div style="margin-top:6px;color:#ffd;">Next special in ${diff} level${diff === 1 ? '' : 's'} (unlocks at lvl ${target})</div>`;
            else nextSpecialHtml = `<div style="margin-top:6px;color:#8f8;">Next special available at lvl ${target}</div>`;
        }
    } catch (e) { /* ignore */ }
    return `<strong>${desc}</strong><div style="margin-top:6px;">${cpsText}</div>${milestoneHtml}${nextSpecialHtml}`;
}

// Initialize hover tooltip for upgrades. Creates a small floating tooltip positioned near cursor.
function initTooltips() {
    // avoid recreating
    if (document.getElementById('upgrade-tooltip')) return;
    const tip = document.createElement('div');
    tip.id = 'upgrade-tooltip';
    tip.style.position = 'fixed';
    tip.style.pointerEvents = 'none';
    tip.style.background = 'rgba(0,0,0,0.8)';
    tip.style.color = '#fff';
    tip.style.padding = '6px 8px';
    tip.style.borderRadius = '6px';
    tip.style.fontSize = '12px';
    tip.style.maxWidth = '320px';
    tip.style.zIndex = '10000';
    tip.style.display = 'none';
    document.body.appendChild(tip);

    const showTip = (text) => {
        tip.innerHTML = text || '';
        tip.style.display = text ? 'block' : 'none';
    };

    const moveTip = (ev) => {
        const x = ev.clientX + 12;
        const y = ev.clientY + 12;
        tip.style.left = x + 'px';
        tip.style.top = y + 'px';
    };

    for (let i = 1; i <= 24; i++) {
        const id = 'upgrade' + i;
        const el = document.getElementById(id);
        if (!el) continue;
        el.addEventListener('mouseenter', (e) => {
            currentHoveredUpgradeId = id;
            const txt = getTooltipHtmlForUpgrade(id);
            showTip(txt);
        });
        el.addEventListener('mousemove', moveTip);
        el.addEventListener('mouseleave', () => { currentHoveredUpgradeId = null; showTip(''); });
    }
    // Additional tooltips for key UI elements
    const extras = [
        {id: 'goonCount', text: 'What Happeneds: your current total of the primary currency.'},
        {id: 'goldenCount', text: 'Golden What Happeneds: prestige currency used to buy Divine upgrades.'},
        {id: 'cps', text: 'CPS: What Happeneds per second (passive income).'},
        {id: 'clickPower', text: 'Click Power: how much each manual click gives you.'},
        {id: 'leaderboardTopBtn', text: 'Open the global leaderboard to view top players.'},
        {id: 'submitLeaderboardBtn', text: 'Submit your current score to the global leaderboard.'},
        {id: 'prestigeTopBtn', text: 'Claim prestige (Golden What Happeneds) when eligible.'},
        {id: 'prestigeBtnCr', text: 'Claim prestige (CR section).'},
        {id: 'achievementsTopBtn', text: 'Open the achievements screen to view unlocks.'},
        {id: 'shopToggle', text: 'Open the Shop to buy skins and items.'},
        {id: 'settingsToggle', text: 'Open Settings to change options and preferences.'}
    ];
    for (const e of extras) {
        try {
            const el = document.getElementById(e.id);
            if (!el) continue;
            // set title attribute as a fallback (mobile/tooltip fallback)
            try { el.title = e.text; } catch (err) {}
            el.addEventListener('mouseenter', () => { try { showTip(e.text); } catch (ex) {} });
            el.addEventListener('mousemove', moveTip);
            el.addEventListener('mouseleave', () => { try { showTip(''); } catch (ex) {} });
        } catch (err) {}
    }
}
function getUpgradeCps(upgradeId) {
    try {
        const per = {2:1,3:5,4:20,5:100,6:500,7:5000,8:20000,9:100000,10:500000,11:1500000,12:5000000,13:20000000,14:50000000,15:500000000,16:2000000000};
        if (hasDecimal) {
            const divineArgonMult = (typeof divineArgonLevel !== 'undefined' && divineArgonLevel > 0) ? D(1).plus(D(DIVINE_ARGON_BASE_PERCENT).times(D(2).pow(Math.max(0, (divineArgonLevel||0)-1))).div(D(100))) : D(1);
            // include ez multiplier in global section multipliers
            const globalSectionMult = D(typeof diddyMultiplier !== 'undefined' ? diddyMultiplier : 1).times(D(typeof argonMultiplier !== 'undefined' ? argonMultiplier : 1)).times(D(typeof grapeMultiplier !== 'undefined' ? grapeMultiplier : 1)).times(D(typeof skippieMultiplier !== 'undefined' ? skippieMultiplier : 1)).times(D(typeof islandMultiplier !== 'undefined' ? islandMultiplier : 1)).times(D(typeof tribalMultiplier !== 'undefined' ? tribalMultiplier : 1)).times(D(typeof phonkMultiplier !== 'undefined' ? phonkMultiplier : 1)).times(D(typeof ezMultiplier !== 'undefined' ? ezMultiplier : 1));
            const goldenMult = D(1).plus(D(goldenWhat || 0).times(D(0.1)));

            if (upgradeId === 'upgrade1') {
                const divineSomalianMultLocal = (typeof divineSomalianLevel !== 'undefined' && divineSomalianLevel > 0) ? D(11).times(D(5).pow(Math.max(0, (divineSomalianLevel||0)-1))) : D(1);
                const clickMultLocal = D(typeof clickMultiplier === 'number' ? clickMultiplier : clickMultiplier || 1).times(divineSomalianMultLocal);
                const lvl = D(upgrade1Level || 0);
                const initialBase = D(1);
                const upgradeEffective = lvl.times(D(computeLevelMultiplier(Number(lvl))));
                const effectiveBase = initialBase.plus(upgradeEffective);
                return effectiveBase.times(clickMultLocal).times(goldenMult);
            }

            if (upgradeId === 'upgrade2') {
                const lvl = D(upgrade2Level || 0);
                const base = D(per[2] || 0).times(lvl);
                const eff = base.times(D(computeLevelMultiplier(Number(lvl))));
                return eff.times(D(pirateMultiplier || 1)).times(globalSectionMult).times(goldenMult).times(divineArgonMult);
            }

            const idx = Number(upgradeId.replace('upgrade',''));
            function getUpgradeLevel(idx) {
                switch (idx) {
                    case 1: return upgrade1Level || 0;
                    case 2: return upgrade2Level || 0;
                    case 3: return upgrade3Level || 0;
                    case 4: return upgrade4Level || 0;
                    case 5: return upgrade5Level || 0;
                    case 6: return upgrade6Level || 0;
                    case 7: return upgrade7Level || 0;
                    case 8: return upgrade8Level || 0;
                    case 9: return upgrade9Level || 0;
                    case 10: return upgrade10Level || 0;
                    case 11: return upgrade11Level || 0;
                    case 12: return upgrade12Level || 0;
                    case 13: return upgrade13Level || 0;
                    case 14: return upgrade14Level || 0;
                    case 15: return upgrade15Level || 0;
                    case 16: return upgrade16Level || 0;
                    case 17: return upgrade17Level || 0;
                    case 18: return upgrade18Level || 0;
                    case 19: return upgrade19Level || 0;
                    case 20: return upgrade20Level || 0;
                    case 21: return upgrade21Level || 0;
                    default: return 0;
                }
            }
            if (idx >=3 && idx <=10) {
                const lvl = D(getUpgradeLevel(idx));
                const base = D(per[idx] || 0).times(lvl);
                const eff = base.times(D(computeLevelMultiplier(Number(lvl))));
                const goon = D(typeof goonMultiplier !== 'undefined' ? goonMultiplier : 1);
                return eff.times(goon).times(globalSectionMult).times(goldenMult).times(divineArgonMult);
            }
            if (idx === 11) {
                const lvl = D(upgrade11Level || 0);
                const base = D(per[11] || 0).times(lvl);
                const eff = base.times(D(computeLevelMultiplier(Number(lvl))));
                const jonMul = D(jonathanOtherMultiplier || 1);
                const goon = D(typeof goonMultiplier !== 'undefined' ? goonMultiplier : 1);
                return eff.times(jonMul).times(goon).times(globalSectionMult).times(goldenMult).times(divineArgonMult);
            }
            if (idx === 12) {
                const lvl = D(upgrade12Level || 0);
                const base = D(per[12] || 0).times(lvl);
                const eff = base.times(D(computeLevelMultiplier(Number(lvl))));
                const crMul = D(crOtherMultiplier || 1);
                const goon = D(typeof goonMultiplier !== 'undefined' ? goonMultiplier : 1);
                return eff.times(crMul).times(goon).times(globalSectionMult).times(goldenMult).times(divineArgonMult);
            }
            if (idx === 13) {
                const lvl = D(upgrade13Level || 0);
                const per13Local = D(per[13] || 0);
                const base = (lvl.gt(0) && per13Local.gt(0)) ? per13Local.times(lvl) : D(0);
                const eff = base.times(D(computeLevelMultiplier(Number(lvl))));
                const goon = D(typeof goonMultiplier !== 'undefined' ? goonMultiplier : 1);
                const ropingMultLocal = D(typeof ropingOtherMultiplier !== 'undefined' ? ropingOtherMultiplier : 1);
                return eff.times(goon).times(ropingMultLocal).times(globalSectionMult).times(goldenMult).times(divineArgonMult);
            }
            if (idx === 14) {
                const lvl = D(upgrade14Level || 0);
                const per14Local = D(per[14] || 0);
                const base = (lvl.gt(0) && per14Local.gt(0)) ? per14Local.times(lvl) : D(0);
                const eff = base.times(D(computeLevelMultiplier(Number(lvl))));
                const goon = D(typeof goonMultiplier !== 'undefined' ? goonMultiplier : 1);
                const skibidiMultLocal = D(typeof skibbidiOtherMultiplier !== 'undefined' ? skibbidiOtherMultiplier : 1);
                return eff.times(goon).times(skibidiMultLocal).times(globalSectionMult).times(goldenMult).times(divineArgonMult);
            }
            if (idx === 15) {
                const lvl = D(upgrade15Level || 0);
                const per15Local = D(per[15] || 0);
                const base = (lvl.gt(0) && per15Local.gt(0)) ? per15Local.times(lvl) : D(0);
                const eff = base.times(D(computeLevelMultiplier(Number(lvl))));
                const goon = D(typeof goonMultiplier !== 'undefined' ? goonMultiplier : 1);
                const beatsMultLocal = D(typeof beatsOtherMultiplier !== 'undefined' ? beatsOtherMultiplier : 1);
                return eff.times(goon).times(beatsMultLocal).times(globalSectionMult).times(goldenMult).times(divineArgonMult);
            }
            if (idx === 16) {
                const lvl = D(upgrade16Level || 0);
                const per16Local = D(per[16] || 0);
                const base = (lvl.gt(0) && per16Local.gt(0)) ? per16Local.times(lvl) : D(0);
                const eff = base.times(D(computeLevelMultiplier(Number(lvl))));
                const goon = D(typeof goonMultiplier !== 'undefined' ? goonMultiplier : 1);
                const ezMultLocal = D(typeof ezOtherMultiplier !== 'undefined' ? ezOtherMultiplier : 1);
                return eff.times(goon).times(ezMultLocal).times(globalSectionMult).times(goldenMult).times(divineArgonMult);
            }
            if (idx === 17) {
                const lvl = D(upgrade17Level || 0);
                const per17Local = D(10000000000); // 10B per level
                const base = (lvl.gt(0) && per17Local.gt(0)) ? per17Local.times(lvl) : D(0);
                const eff = base.times(D(computeLevelMultiplier(Number(lvl))));
                const scpMultLocal = D(typeof scpMultiplier !== 'undefined' ? scpMultiplier : 1);
                return eff.times(scpMultLocal).times(globalSectionMult).times(goldenMult).times(divineArgonMult);
            }
            if (idx === 18) {
                const lvl = D(upgrade18Level || 0);
                const per18Local = D(150000000000); // 150B per level
                const base = (lvl.gt(0) && per18Local.gt(0)) ? per18Local.times(lvl) : D(0);
                const eff = base.times(D(computeLevelMultiplier(Number(lvl))));
                const goon = D(typeof goonMultiplier !== 'undefined' ? goonMultiplier : 1);
                const goatisMultLocal = D(typeof goatisMultiplier !== 'undefined' ? goatisMultiplier : 1);
                return eff.times(goon).times(goatisMultLocal).times(globalSectionMult).times(goldenMult).times(divineArgonMult);
            }
            if (idx === 19) {
                const lvl = D(upgrade19Level || 0);
                const per19Local = D(2000000000000); // 2T per level
                const base = (lvl.gt(0) && per19Local.gt(0)) ? per19Local.times(lvl) : D(0);
                const eff = base.times(D(computeLevelMultiplier(Number(lvl))));
                const goon = D(typeof goonMultiplier !== 'undefined' ? goonMultiplier : 1);
                const rawMultLocal = D(typeof rawMultiplier !== 'undefined' ? rawMultiplier : 1);
                return eff.times(goon).times(rawMultLocal).times(globalSectionMult).times(goldenMult).times(divineArgonMult);
            }
            if (idx === 20) {
                const lvl = D(upgrade20Level || 0);
                const per20Local = D(50000000000000); // 50T per level
                const base = (lvl.gt(0) && per20Local.gt(0)) ? per20Local.times(lvl) : D(0);
                const eff = base.times(D(computeLevelMultiplier(Number(lvl))));
                const goon = D(typeof goonMultiplier !== 'undefined' ? goonMultiplier : 1);
                const landonMultLocal = D(typeof landonMultiplier !== 'undefined' ? landonMultiplier : 1);
                return eff.times(goon).times(landonMultLocal).times(globalSectionMult).times(goldenMult).times(divineArgonMult);
            }
            if (idx === 21) {
                const lvl = D(upgrade21Level || 0);
                const per21Local = D(1000000000000000); // 1Q per level
                const base = (lvl.gt(0) && per21Local.gt(0)) ? per21Local.times(lvl) : D(0);
                const eff = base.times(D(computeLevelMultiplier(Number(lvl))));
                const goon = D(typeof goonMultiplier !== 'undefined' ? goonMultiplier : 1);
                const theBassMultLocal = D(typeof theBassMultiplier !== 'undefined' ? theBassMultiplier : 1);
                return eff.times(goon).times(theBassMultLocal).times(globalSectionMult).times(goldenMult).times(divineArgonMult);
            }
            if (idx === 22) {
                const lvl = D(upgrade22Level || 0);
                const per22Local = D(50000000000000000); // 50Q per level
                const base = (lvl.gt(0) && per22Local.gt(0)) ? per22Local.times(lvl) : D(0);
                const eff = base.times(D(computeLevelMultiplier(Number(lvl))));
                const goon = D(typeof goonMultiplier !== 'undefined' ? goonMultiplier : 1);
                const goodNoodlesMultLocal = D(typeof goodNoodlesMultiplier !== 'undefined' ? goodNoodlesMultiplier : 1);
                return eff.times(goon).times(goodNoodlesMultLocal).times(globalSectionMult).times(goldenMult).times(divineArgonMult);
            }
            if (idx === 23) {
                const lvl = D(upgrade23Level || 0);
                const per23Local = D(500000000000000000); // 500Q per level
                const base = (lvl.gt(0) && per23Local.gt(0)) ? per23Local.times(lvl) : D(0);
                const eff = base.times(D(computeLevelMultiplier(Number(lvl))));
                const goon = D(typeof goonMultiplier !== 'undefined' ? goonMultiplier : 1);
                const mobileManMultLocal = D(typeof mobileMan38Multiplier !== 'undefined' ? mobileMan38Multiplier : 1);
                return eff.times(goon).times(mobileManMultLocal).times(globalSectionMult).times(goldenMult).times(divineArgonMult);
            }
            if (idx === 24) {
                const lvl = D(upgrade24Level || 0);
                const per24Local = D(1000000000000000000); // 1000Q per level
                const base = (lvl.gt(0) && per24Local.gt(0)) ? per24Local.times(lvl) : D(0);
                const eff = base.times(D(computeLevelMultiplier(Number(lvl))));
                const goon = D(typeof goonMultiplier !== 'undefined' ? goonMultiplier : 1);
                const eastonBundyMultLocal = D(typeof eastonBundyMultiplier !== 'undefined' ? eastonBundyMultiplier : 1);
                return eff.times(goon).times(eastonBundyMultLocal).times(globalSectionMult).times(goldenMult).times(divineArgonMult);
            }
            return D(0);
        } else {
            // original numeric branch
            const divineArgonMult = (typeof divineArgonLevel !== 'undefined' && divineArgonLevel > 0) ? (1 + (DIVINE_ARGON_BASE_PERCENT * Math.pow(2, Math.max(0, divineArgonLevel-1)))/100) : 1;
            const globalSectionMult = (typeof diddyMultiplier !== 'undefined' ? diddyMultiplier : 1) * (typeof argonMultiplier !== 'undefined' ? argonMultiplier : 1) * (typeof grapeMultiplier !== 'undefined' ? grapeMultiplier : 1) * (typeof skippieMultiplier !== 'undefined' ? skippieMultiplier : 1) * (typeof islandMultiplier !== 'undefined' ? islandMultiplier : 1) * (typeof tribalMultiplier !== 'undefined' ? tribalMultiplier : 1) * (typeof phonkMultiplier !== 'undefined' ? phonkMultiplier : 1) * (typeof ezMultiplier !== 'undefined' ? ezMultiplier : 1);
            const goldenMult = 1 + (typeof goldenWhat === 'number' ? goldenWhat * 0.1 : 0);

            if (upgradeId === 'upgrade1') {
                const divineSomalianMultLocal = (typeof divineSomalianLevel !== 'undefined' && divineSomalianLevel > 0) ? (11 * Math.pow(5, Math.max(0, divineSomalianLevel - 1))) : 1;
                const clickMultLocal = (typeof clickMultiplier === 'number' ? clickMultiplier : 1) * divineSomalianMultLocal;
                const lvl = upgrade1Level || 0;
                const initialBase = 1;
                const upgradeEffective = lvl * computeLevelMultiplier(lvl);
                const effectiveBase = initialBase + upgradeEffective;
                return effectiveBase * clickMultLocal * goldenMult;
            }
            if (upgradeId === 'upgrade2') {
                const lvl = upgrade2Level || 0;
                const base = (per[2] || 0) * lvl;
                const eff = base * computeLevelMultiplier(lvl);
                return eff * (pirateMultiplier || 1) * globalSectionMult * goldenMult * divineArgonMult;
            }
            const idx = Number(upgradeId.replace('upgrade',''));
            function getUpgradeLevel(idx) {
                switch (idx) {
                    case 1: return upgrade1Level || 0;
                    case 2: return upgrade2Level || 0;
                    case 3: return upgrade3Level || 0;
                    case 4: return upgrade4Level || 0;
                    case 5: return upgrade5Level || 0;
                    case 6: return upgrade6Level || 0;
                    case 7: return upgrade7Level || 0;
                    case 8: return upgrade8Level || 0;
                    case 9: return upgrade9Level || 0;
                    case 10: return upgrade10Level || 0;
                    case 11: return upgrade11Level || 0;
                    case 12: return upgrade12Level || 0;
                    case 13: return upgrade13Level || 0;
                    case 14: return upgrade14Level || 0;
                    case 15: return upgrade15Level || 0;
                    case 16: return upgrade16Level || 0;
                    case 17: return upgrade17Level || 0;
                    case 18: return upgrade18Level || 0;
                    case 19: return upgrade19Level || 0;
                    default: return 0;
                }
            }
            if (idx >=3 && idx <=10) {
                const lvl = getUpgradeLevel(idx);
                const base = (per[idx] || 0) * lvl;
                const eff = base * computeLevelMultiplier(lvl);
                const goon = (typeof goonMultiplier !== 'undefined' ? goonMultiplier : 1);
                return eff * goon * globalSectionMult * goldenMult * divineArgonMult;
            }
            if (idx === 11) {
                const lvl = upgrade11Level || 0;
                const base = (per[11] || 0) * lvl;
                const eff = base * computeLevelMultiplier(lvl);
                const jonMul = (jonathanOtherMultiplier || 1);
                const goon = (typeof goonMultiplier !== 'undefined' ? goonMultiplier : 1);
                return eff * jonMul * goon * globalSectionMult * goldenMult * divineArgonMult;
            }
            if (idx === 12) {
                const lvl = upgrade12Level || 0;
                const base = (per[12] || 0) * lvl;
                const eff = base * computeLevelMultiplier(lvl);
                const crMul = (crOtherMultiplier || 1);
                const goon = (typeof goonMultiplier !== 'undefined' ? goonMultiplier : 1);
                return eff * crMul * goon * globalSectionMult * goldenMult * divineArgonMult;
            }
            if (idx === 13) {
                const lvl = upgrade13Level || 0;
                const per13Local = (per[13] || 0);
                const base = (lvl > 0 && per13Local > 0) ? per13Local * lvl : 0;
                const eff = base * computeLevelMultiplier(lvl);
                const goon = (typeof goonMultiplier !== 'undefined' ? goonMultiplier : 1);
                const ropingMultLocal = (typeof ropingOtherMultiplier !== 'undefined' ? ropingOtherMultiplier : 1);
                return eff * goon * ropingMultLocal * globalSectionMult * goldenMult * divineArgonMult;
            }
            if (idx === 14) {
                const lvl = upgrade14Level || 0;
                const per14Local = (per[14] || 0);
                const base = (lvl > 0 && per14Local > 0) ? per14Local * lvl : 0;
                const eff = base * computeLevelMultiplier(lvl);
                const goon = (typeof goonMultiplier !== 'undefined' ? goonMultiplier : 1);
                const skibidiMultLocal = (typeof skibbidiOtherMultiplier !== 'undefined' ? skibbidiOtherMultiplier : 1);
                return eff * goon * skibidiMultLocal * globalSectionMult * goldenMult * divineArgonMult;
            }
            if (idx === 15) {
                const lvl = upgrade15Level || 0;
                const per15Local = (per[15] || 0);
                const base = (lvl > 0 && per15Local > 0) ? per15Local * lvl : 0;
                const eff = base * computeLevelMultiplier(lvl);
                const goon = (typeof goonMultiplier !== 'undefined' ? goonMultiplier : 1);
                const beatsMultLocal = (typeof beatsOtherMultiplier !== 'undefined' ? beatsOtherMultiplier : 1);
                return eff * goon * beatsMultLocal * globalSectionMult * goldenMult * divineArgonMult;
            }
            if (idx === 16) {
                const lvl = upgrade16Level || 0;
                const per16Local = (per[16] || 0);
                const base = (lvl > 0 && per16Local > 0) ? per16Local * lvl : 0;
                const eff = base * computeLevelMultiplier(lvl);
                const goon = (typeof goonMultiplier !== 'undefined' ? goonMultiplier : 1);
                const ezMultLocal = (typeof ezOtherMultiplier !== 'undefined' ? ezOtherMultiplier : 1);
                return eff * goon * ezMultLocal * globalSectionMult * goldenMult * divineArgonMult;
            }
            if (idx === 17) {
                const lvl = upgrade17Level || 0;
                const per17Local = 10000000000; // 10B per level
                const base = (lvl > 0 && per17Local > 0) ? per17Local * lvl : 0;
                const eff = base * computeLevelMultiplier(lvl);
                const scpMultLocal = (typeof scpMultiplier !== 'undefined' ? scpMultiplier : 1);
                return eff * scpMultLocal * globalSectionMult * goldenMult * divineArgonMult;
            }
            if (idx === 18) {
                const lvl = upgrade18Level || 0;
                const per18Local = 150000000000; // 150B per level
                const base = (lvl > 0 && per18Local > 0) ? per18Local * lvl : 0;
                const eff = base * computeLevelMultiplier(lvl);
                const goon = (typeof goonMultiplier !== 'undefined' ? goonMultiplier : 1);
                const goatisMultLocal = (typeof goatisMultiplier !== 'undefined' ? goatisMultiplier : 1);
                return eff * goon * goatisMultLocal * globalSectionMult * goldenMult * divineArgonMult;
            }
            if (idx === 19) {
                const lvl = upgrade19Level || 0;
                const per19Local = 2000000000000; // 2T per level
                const base = (lvl > 0 && per19Local > 0) ? per19Local * lvl : 0;
                const eff = base * computeLevelMultiplier(lvl);
                const goon = (typeof goonMultiplier !== 'undefined' ? goonMultiplier : 1);
                const rawMultLocal = (typeof rawMultiplier !== 'undefined' ? rawMultiplier : 1);
                return eff * goon * rawMultLocal * globalSectionMult * goldenMult * divineArgonMult;
            }
            if (idx === 20) {
                const lvl = upgrade20Level || 0;
                const per20Local = 50000000000000; // 50T per level
                const base = (lvl > 0 && per20Local > 0) ? per20Local * lvl : 0;
                const eff = base * computeLevelMultiplier(lvl);
                const goon = (typeof goonMultiplier !== 'undefined' ? goonMultiplier : 1);
                const landonMultLocal = (typeof landonMultiplier !== 'undefined' ? landonMultiplier : 1);
                return eff * goon * landonMultLocal * globalSectionMult * goldenMult * divineArgonMult;
            }
            if (idx === 21) {
                const lvl = upgrade21Level || 0;
                const per21Local = 1000000000000000; // 1Q per level
                const base = (lvl > 0 && per21Local > 0) ? per21Local * lvl : 0;
                const eff = base * computeLevelMultiplier(lvl);
                const goon = (typeof goonMultiplier !== 'undefined' ? goonMultiplier : 1);
                const theBassMultLocal = (typeof theBassMultiplier !== 'undefined' ? theBassMultiplier : 1);
                return eff * goon * theBassMultLocal * globalSectionMult * goldenMult * divineArgonMult;
            }
            if (idx === 22) {
                const lvl = upgrade22Level || 0;
                const per22Local = 50000000000000000; // 50Q per level
                const base = (lvl > 0 && per22Local > 0) ? per22Local * lvl : 0;
                const eff = base * computeLevelMultiplier(lvl);
                const goon = (typeof goonMultiplier !== 'undefined' ? goonMultiplier : 1);
                const goodNoodlesMultLocal = (typeof goodNoodlesMultiplier !== 'undefined' ? goodNoodlesMultiplier : 1);
                return eff * goon * goodNoodlesMultLocal * globalSectionMult * goldenMult * divineArgonMult;
            }
            if (idx === 23) {
                const lvl = upgrade23Level || 0;
                const per23Local = 500000000000000000; // 500Q per level
                const base = (lvl > 0 && per23Local > 0) ? per23Local * lvl : 0;
                const eff = base * computeLevelMultiplier(lvl);
                const goon = (typeof goonMultiplier !== 'undefined' ? goonMultiplier : 1);
                const mobileManMultLocal = (typeof mobileMan38Multiplier !== 'undefined' ? mobileMan38Multiplier : 1);
                return eff * goon * mobileManMultLocal * globalSectionMult * goldenMult * divineArgonMult;
            }
            if (idx === 24) {
                const lvl = upgrade24Level || 0;
                const per24Local = 1000000000000000000; // 1000Q per level
                const base = (lvl > 0 && per24Local > 0) ? per24Local * lvl : 0;
                const eff = base * computeLevelMultiplier(lvl);
                const goon = (typeof goonMultiplier !== 'undefined' ? goonMultiplier : 1);
                const eastonBundyMultLocal = (typeof eastonBundyMultiplier !== 'undefined' ? eastonBundyMultiplier : 1);
                return eff * goon * eastonBundyMultLocal * globalSectionMult * goldenMult * divineArgonMult;
            }
            return 0;
        }
    } catch (e) { return hasDecimal ? D(0) : 0; }
}

// Upgrade 1 state
let upgrade1Cost = 100;
let upgrade1Level = 0;

// Upgrade 13 (ropingnecurse)
let upgrade13Cost = 10000000000; // 10B
let upgrade13Level = 0;

// Upgrade 14 (skibbidi scimitar)
let upgrade14Cost = 25000000000; // 25B
let upgrade14Level = 0;
// What Happened Beats (upgrade15)
let upgrade15Cost = 100000000000; // 100B
let upgrade15Level = 0;

// Upgrade 16 (ez villager)
let upgrade16Cost = 250000000000; // 250B (UI default)
let upgrade16Level = 0;
// ez-specific multiplier (applies only to upgrade16 contribution)
let ezOtherMultiplier = 1;
// Upgrade 17 (scp wish I knew.)
let upgrade17Cost = 700000000000; // 700B
let upgrade17Level = 0;
// Upgrade 18 (The Goatis)
let upgrade18Cost = 5000000000000; // 5T
let upgrade18Level = 0;
// Upgrade 19 (goatises raw liver)
let upgrade19Cost = 200000000000000; // 200T
let upgrade19Level = 0;
// Upgrade 20 (The Landon Stream)
let upgrade20Cost = 1000000000000000; // 1Q
let upgrade20Level = 0;
// Upgrade 21 (The Bass)
let upgrade21Cost = 200000000000000000; // 200Q
let upgrade21Level = 0;
// Upgrade 22 (Good Noodles)
let upgrade22Cost = 1000000000000000000; // 1000Q
let upgrade22Level = 0;
// Good Noodles multiplier (specials apply here)
let goodNoodlesMultiplier = 1;
// Good Noodles specials: costs and purchased flags
let goodNoodles1Cost = 2000000000000000000; // 2000Q
let goodNoodles2Cost = 8000000000000000000; // 8000Q
let goodNoodles3Cost = 30000000000000000000; // 30000Q
let goodNoodles1Purchased = false, goodNoodles2Purchased = false, goodNoodles3Purchased = false;
let goodNoodles4Cost = 100000000000000000000; // 100000Q
let goodNoodles4Purchased = false;
// Upgrade 23 (Mobile Man 38)
let upgrade23Cost = 5000000000000000000; // 5000Q
let upgrade23Level = 0;
// Mobile Man 38 multiplier (specials apply here)
let mobileMan38Multiplier = 1;
// Mobile Man 38 specials: costs and purchased flags
let mobileMan381Cost = 10000000000000000000; // 10000Q
let mobileMan382Cost = 40000000000000000000; // 40000Q
let mobileMan383Cost = 150000000000000000000; // 150000Q
let mobileMan381Purchased = false, mobileMan382Purchased = false, mobileMan383Purchased = false;
let mobileMan384Cost = 600000000000000000000; // 600000Q
let mobileMan384Purchased = false;
// Upgrade 24 (Easton Bundy) state
let upgrade24Cost = 30000000000000000000; // 30000Q
let upgrade24Level = 0;
// Easton Bundy multiplier (specials apply here)
let eastonBundyMultiplier = 1;
// Easton Bundy specials: costs and purchased flags
let eastonBundy1Cost = 60000000000000000000; // 60000Q
let eastonBundy2Cost = 240000000000000000000; // 240000Q
let eastonBundy3Cost = 900000000000000000000; // 900000Q
let eastonBundy1Purchased = false, eastonBundy2Purchased = false, eastonBundy3Purchased = false;
let eastonBundy4Cost = 3600000000000000000000; // 3600000Q
let eastonBundy4Purchased = false;
// Landon Stream specials (one-time multipliers that apply to upgrade20 contribution)
let landon1Cost = 50000000000000; // 50T
let landon2Cost = 200000000000000; // 200T
let landon3Cost = 1000000000000000; // 1Q
let landon4Cost = 5000000000000000; // 5Q
let landon1Purchased = false;
let landon2Purchased = false;
let landon3Purchased = false;
let landon4Purchased = false;
let landonMultiplier = 1;
// The Bass specials (one-time multipliers that apply to upgrade21 contribution)
let theBass1Cost = 50000000000000; // 50T
let theBass2Cost = 200000000000000; // 200T
let theBass3Cost = 1000000000000000; // 1Q
let theBass4Cost = 5000000000000000; // 5Q
let theBass1Purchased = false;
let theBass2Purchased = false;
let theBass3Purchased = false;
let theBass4Purchased = false;
let theBassMultiplier = 1;
// SCP specials (one-time multipliers that each double SCP cps contribution)
let scp1Cost = 500000000000; // 500B
let scp2Cost = 2000000000000; // 2T
let scp3Cost = 10000000000000; // 10T
let scp4Cost = 50000000000000; // 50T
let scp1Purchased = false;
let scp2Purchased = false;
let scp3Purchased = false;
let scp4Purchased = false;
let scpMultiplier = 1;
 
// Upgrade 2 state
let upgrade2Cost = 500;
let upgrade2Level = 0;

// Upgrade 3 state
let upgrade3Cost = 1000;
let upgrade3Level = 0;
// Upgrade 4 (Diddy blud) state
let upgrade4Cost = 3000;
let upgrade4Level = 0;

//Upgrade 5 (Argonian Autist) state
let upgrade5Cost = 10000;
let upgrade5Level = 0;
// Upgrade 6 (Grape God) state
let upgrade6Cost = 250000;
let upgrade6Level = 0;

// Special upgrade: multiplier unlocked at OP mouse level 10
let special1Cost = 1000;
let special1Purchased = false;
const special1Multiplier = 1.5;
// Additional special upgrades (cps multipliers)
let special2Cost = 5000;
let special2Purchased = false;
const special2Multiplier = 2;

let special3Cost = 20000;
let special3Purchased = false;
const special3Multiplier = 2;

let special4Cost = 100000;
let special4Purchased = false;
const special4Multiplier = 2.5;

let special5Cost = 500000;
let special5Purchased = false;
const special5Multiplier = 3;

// Additional OP mouse specials (high-tier)
let special6Cost = 2000000;
let special6Purchased = false;
const special6Multiplier = 3.5;

let special7Cost = 5000000;
let special7Purchased = false;
const special7Multiplier = 3.5;

let special8Cost = 20000000;
let special8Purchased = false;
const special8Multiplier = 4;

// Ropingnecurse specials
let roping1Cost = 50000000000; // 50B
let roping1Purchased = false;
const roping1Multiplier = 1.5;

let roping2Cost = 200000000000; // 200B
let roping2Purchased = false;
const roping2Multiplier = 2;

let roping3Cost = 1000000000000; // 1T
let roping3Purchased = false;
const roping3Multiplier = 2;

let roping4Cost = 5000000000000; // 5T
let roping4Purchased = false;
const roping4Multiplier = 2.25;

// Skibbidi Scimitar specials
let skibidi1Cost = 60000000000; // 60B
let skibidi1Purchased = false;
const skibidi1Multiplier = 1.5;

let skibidi2Cost = 240000000000; // 240B
let skibidi2Purchased = false;
const skibidi2Multiplier = 2;

let skibidi3Cost = 1200000000000; // 1.2T
let skibidi3Purchased = false;
const skibidi3Multiplier = 2;

let skibidi4Cost = 6000000000000; // 6T
let skibidi4Purchased = false;
const skibidi4Multiplier = 2.25;

// per-section other-cps multipliers (apply to baseOtherCps)
let diddyOtherMultiplier = 1;
let argonOtherMultiplier = 1;
let grapeOtherMultiplier = 1;
let skippieOtherMultiplier = 1;
// Ropingnecurse specific multiplier (applies only to upgrade13 contribution)
let ropingOtherMultiplier = 1;
// Skibbidi scimitar specific multiplier (applies only to upgrade14 contribution)
let skibbidiOtherMultiplier = 1;
// What Happened Beats specials multiplier (applies only to upgrade15 contribution)
let beatsOtherMultiplier = 1;

// Beats specials
let beats1Cost = 80000000000; // 80B unlock lvl10
let beats1Purchased = false;
const beats1Multiplier = 1.5;

let beats2Cost = 300000000000; // 300B unlock lvl25
let beats2Purchased = false;
const beats2Multiplier = 2;

let beats3Cost = 1000000000000; // 1T unlock lvl50
let beats3Purchased = false;
const beats3Multiplier = 2.5;

// EZ Villager specials
let ez1Cost = 1000000000000; // 1T unlock lvl10
let ez1Purchased = false;
const ez1Multiplier = 1.5;

let ez2Cost = 4000000000000; // 4T unlock lvl25
let ez2Purchased = false;
const ez2Multiplier = 2;

let ez3Cost = 20000000000000; // 20T unlock lvl50
let ez3Purchased = false;
const ez3Multiplier = 2; // click power x2

let ez4Cost = 100000000000000; // 100T unlock lvl100
let ez4Purchased = false;
const ez4Multiplier = 2; // total cps x2

// Pirate-specific specials (unlocks at Somalian Pirate levels)
let pirateSpec1Cost = 1500; // lvl 10
let pirateSpec1Purchased = false;
const pirateSpec1Multiplier = 1.5;

let pirateSpec2Cost = 6000; // lvl 25
let pirateSpec2Purchased = false;
const pirateSpec2Multiplier = 1.5;

let pirateSpec3Cost = 25000; // lvl 50
let pirateSpec3Purchased = false;
const pirateSpec3Multiplier = 2;

let pirateSpec4Cost = 100000; // lvl 100
let pirateSpec4Purchased = false;
const pirateSpec4Multiplier = 1.25; // applies to pirate contribution

// Goonsaw-specific specials
let goonSpec1Cost = 2000; // lvl 10
let goonSpec1Purchased = false;
const goonSpec1Multiplier = 2;

let goonSpec2Cost = 8000; // lvl 25
let goonSpec2Purchased = false;
const goonSpec2Multiplier = 2;

let goonSpec3Cost = 30000; // lvl 50
let goonSpec3Purchased = false;
const goonSpec3Multiplier = 1.5;

let goonSpec4Cost = 150000; // lvl 100
let goonSpec4Purchased = false;
const goonSpec4Multiplier = 2.5;
// The Goatis specials (upgrade18)
let goatis1Cost = 50000000000; // 50B
let goatis1Purchased = false;
const goatis1Multiplier = 1.5;

let goatis2Cost = 200000000000; // 200B
let goatis2Purchased = false;
const goatis2Multiplier = 2;

let goatis3Cost = 1000000000000; // 1T
let goatis3Purchased = false;
const goatis3Multiplier = 2;

let goatis4Cost = 5000000000000; // 5T
let goatis4Purchased = false;
const goatis4Multiplier = 2.25;
// Landon Stream specials multipliers
const landon1Multiplier = 1.5;
const landon2Multiplier = 2;
const landon3Multiplier = 2;
const landon4Multiplier = 2.25;
// The Bass specials multipliers (mirror Landon)
const theBass1Multiplier = 1.5;
const theBass2Multiplier = 2;
const theBass3Multiplier = 2;
const theBass4Multiplier = 2.25;


// Goatis-specific multiplier that applies to upgrade18 contribution
let goatisMultiplier = 1;

// goatises raw liver specials (upgrade19)
let raw1Cost = 50000000000; // 50B
let raw1Purchased = false;
const raw1Multiplier = 1.5;

let raw2Cost = 200000000000; // 200B
let raw2Purchased = false;
const raw2Multiplier = 2;

let raw3Cost = 1000000000000; // 1T
let raw3Purchased = false;
const raw3Multiplier = 2;

let raw4Cost = 5000000000000; // 5T
let raw4Purchased = false;
const raw4Multiplier = 2.25;

// raw-liver-specific multiplier that applies to upgrade19 contribution
let rawMultiplier = 1;

// Diddy Blud specials
let diddy1Cost = 5000;
let diddy2Cost = 20000;
let diddy3Cost = 50000;
let diddy4Cost = 200000;
let diddy1Purchased = false;
let diddy2Purchased = false;
let diddy3Purchased = false;
let diddy4Purchased = false;

// Argonian (upgrade5) specials
let argon1Cost = 10000;
let argon2Cost = 40000;
let argon3Cost = 150000;
let argon4Cost = 500000;
let argon1Purchased = false;
let argon2Purchased = false;
let argon3Purchased = false;
let argon4Purchased = false;
const argon1Multiplier = 1.5; // click power
const argon2Multiplier = 2;   // other cps
const argon3Multiplier = 2;   // click power
const argon4Multiplier = 1.5; // total cps

// Grape God (upgrade6) specials
let grape1Cost = 250000;
let grape2Cost = 1000000;
let grape3Cost = 5000000;
let grape4Cost = 20000000;
let grape1Purchased = false;
let grape2Purchased = false;
let grape3Purchased = false;
let grape4Purchased = false;
const grape2Multiplier = 2; // other cps
const grape3Multiplier = 2; // click power
const grape4Multiplier = 2; // total cps
// Skippie Toilet (upgrade7) specials and state
let upgrade7Cost = 1000000;
let upgrade7Level = 0;

// Mysterious Island (upgrade8)
let upgrade8Cost = 5000000;
let upgrade8Level = 0;
// Tribal Camp (upgrade9)
let upgrade9Cost = 20000000;
let upgrade9Level = 0;

// The Phonk Man (upgrade10)
let upgrade10Cost = 100000000;
let upgrade10Level = 0;
// Jonathan (upgrade11)
let upgrade11Cost = 500000000; // 500M
let upgrade11Level = 0;
// CR lurker (upgrade12)
let upgrade12Cost = 2000000000; // 2B
let upgrade12Level = 0;

let skippie1Cost = 500000;
let skippie2Cost = 2000000;
let skippie3Cost = 10000000;
let skippie4Cost = 50000000;
let skippie1Purchased = false;
let skippie2Purchased = false;
let skippie3Purchased = false;
let skippie4Purchased = false;
const skippie2Multiplier = 2; // other cps multiplier
const skippie3Multiplier = 2; // click power multiplier
const skippie4Multiplier = 2; // total cps multiplier

// Mysterious Island specials
let island1Cost = 2000000;
let island2Cost = 8000000;
let island3Cost = 40000000;
let island4Cost = 200000000;
let island1Purchased = false;
let island2Purchased = false;
let island3Purchased = false;
let island4Purchased = false;
const island2Multiplier = 2;
const island3Multiplier = 2;
const island4Multiplier = 2;
let islandOtherMultiplier = 1;
let islandMultiplier = 1;
// EZ global multiplier (applies to total CPS)
let ezMultiplier = 1;

// Tribal Camp specials
let tribal1Cost = 10000000;
let tribal2Cost = 40000000;
let tribal3Cost = 200000000;
let tribal4Cost = 1000000000;
let tribal1Purchased = false;
let tribal2Purchased = false;
let tribal3Purchased = false;
let tribal4Purchased = false;
const tribal2Multiplier = 2;
const tribal3Multiplier = 2;
const tribal4Multiplier = 2;
let tribalOtherMultiplier = 1;
let tribalMultiplier = 1;
// Phonk Man specials costs and multipliers
let phonk1Cost = 10000000; // 10M
let phonk2Cost = 40000000; // 40M
let phonk3Cost = 200000000; // 200M
let phonk4Cost = 1000000000; // 1B
let phonk5Cost = 5000000000; // 5B
const phonk1Multiplier = 1.25;
const phonk2Multiplier = 1.25;
const phonk3Multiplier = 1.5;
const phonk4Multiplier = 2; // applies to Phonk's cps only
const phonk5Multiplier = 2; // applies to total cps
// Jonathan specials: costs and multipliers
let jonathan1Cost = 100000000; // 100M
let jonathan2Cost = 400000000; // 400M
let jonathan3Cost = 2000000000; // 2B
let jonathan4Cost = 10000000000; // 10B
let jonathan1Purchased = false;
let jonathan2Purchased = false;
let jonathan3Purchased = false;
let jonathan4Purchased = false;
let jonathanBaseCps = D(0);
let jonathanOtherMultiplier = 1;
const jonathan1Multiplier = 1.5;
const jonathan2Multiplier = 1.5;
const jonathan3Multiplier = 4; // click power multiplier
const jonathan4Multiplier = 2;

// CR lurker specials: costs and multipliers
let cr1Cost = 200000000; // 200M
let cr2Cost = 800000000; // 800M
let cr3Cost = 3000000000; // 3B
let cr4Cost = 10000000000; // 10B
let cr5Cost = 30000000000; // 30B
let cr1Purchased = false;
let cr2Purchased = false;
let cr3Purchased = false;
let cr4Purchased = false;
let cr5Purchased = false;
let crBaseCps = D(0);
let crOtherMultiplier = 1;
const cr1Multiplier = 1.5;
const cr2Multiplier = 1.5;
const cr3Multiplier = 3; // click power multiplier
const cr4Multiplier = 2;
const cr5Multiplier = 2; // total cps

// Prestige / Golden What Happend system
let goldenWhat = 0; // prestige currency
let goldenThreshold = 1000; // first golden awarded at 1K count
let goldenMultiplier = 1; // computed as 1 + goldenWhat * 0.1

// Diamonds: rare collectible currency (1 in 2500 chance per click)
let diamonds = 0;
// Clan Points: clan currency — main reward from clan events, spent in the clan shop
let clanPoints = 0;
// Music settings: background audio element, volume (0.0-1.0) and mute flag
let musicVolume = 0.5;
let musicMuted = false;
let bgMusicElement = null;
// currently-playing preview audio (separate from bgMusicElement)
let previewAudio = null;
// Music shop state
let musicOwned = { mainTheme: true, BassInsanity: false, MaximumAgro: false, MetalSlam: false, UltraTwang: false, ThroatSing: false, Hardstyle_whathappened: false, EDMWhatHappened: false, SimpleAndEasy: false };
let currentMusicTrack = 'mainTheme';
// backup to restore volume after muting via button
let musicVolumeBackup = null;
// SFX settings
let sfxVolume = 0.8;
let sfxMuted = false;
// helper to play short SFX (creates a one-shot Audio so overlapping is allowed)
function playSfx(src) {
    try {
        if (!src) return;
        if (sfxMuted) return;
        const finalSrc = (typeof src === 'string' && src.indexOf('/') === -1) ? ('audio/' + src) : src;
        const a = new Audio(finalSrc);
        a.volume = (typeof sfxVolume === 'number') ? Math.max(0, Math.min(1, sfxVolume)) : 0.8;
        a.muted = !!sfxMuted;
        a.play().catch(() => {});
    } catch (e) {}
}
// Shop: Divine Spirit purchase/equip state
let shopDivinePurchased = false;
// Shop: Platinum and Divine WH skins
let shopPlatinumPurchased = false;
let shopDivineWHPurchased = false;
// WH Vrill skin
let shopWHVrillPurchased = false;
// Mobile Man skin (new)
let shopMobileManPurchased = false;
// Shop: collection background purchase state (collectionbg.png)
let shopCollectionBgPurchased = false;
// Shop: WH black & white skin purchase state (WHblackandwhite.png)
let shopWHBWPurchased = false;
// Shop: Silver and Gold WH skins
let shopSilverPurchased = false;
let shopGoldPurchased = false;
// currently equipped main-image filename (defaults to original)
let equippedShopImage = 'mainimage/whathappened.jpeg';
// Background shop images (folder: bgimages)
const BG_IMAGES = [
    'cloudtreefield.png',
    'grassyfieldbg.png',
    'mountainsbg.png',
    'multipletreesbg.png',
    'oceanviewbg.png',
    'stonghengebg.png',
    'treesbg.png',
    'Vrillbg.png'
];
// purchased state for background images (keyed by filename)
let shopBgPurchased = {};
// currently equipped background image (defaults to Mainbg.png used by CSS)
let equippedBgImage = 'mainimage/Mainbg.png';

// Stats: track how many times the player has prestiged and total golden ever received
let prestigeTimes = 0;
let totalGoldenEver = 0;

// whether the Divine menu has been unlocked permanently (first golden ever)
let divineUnlocked = false;

// how many total base-upgrade levels are required per 1 Golden (easy to tweak)
const LEVELS_PER_GOLDEN = 1500;

// Divine menu toggle state
let divineMode = false;

// Divine Argonian upgrade (purchased with Golden What Happeneds)
let divineArgonLevel = 0;
let divineArgonCost = 1; // cost in golden currency, multiplies by 3 each purchase
const DIVINE_ARGON_BASE_PERCENT = 300; // base percent for first purchase
let divineArgonPercent = DIVINE_ARGON_BASE_PERCENT; // kept for backward compat but displayed/computed dynamically

// Divine Somalian upgrade (purchased with Golden What Happeneds)
let divineSomalianLevel = 0;
let divineSomalianCost = 1; // cost in golden currency; multiplies by 3 each purchase
const DIVINE_SOMALIAN_BASE_PERCENT = 1000; // base percent for level 1 (applied as +1000%)

// Divine Assassin upgrade (purchased with Golden What Happeneds)
let divineAssassinLevel = 0;
let divineAssassinCost = 1; // cost in golden currency; multiplies by 2 each purchase
const DIVINE_ASSASSIN_BASE_CHANCE = 0.05; // 5% at level 1

// Divine Collector upgrade: increases golden awarded by 25% per level
let divineCollectorLevel = 0;
let divineCollectorCost = 1; // cost in golden currency; multiplies by 2 each purchase
const DIVINE_COLLECTOR_PER_LEVEL = 0.25; // 25% per level

// Divine Money Man: grants starting What Happeneds after prestige
let divineMoneyManLevel = 0;
let divineMoneyManCost = 1; // first costs 1 golden, next 2, then cost = cost*2 - 1
const DIVINE_MONEYMAN_BASE = 100000; // starting amount at level 1 (buffed to 100k)

// Divine Spirit of What Happened: Fibonacci-style golden costs, doubles crit impact per level
let divineSpiritLevel = 0;
let divineSpiritCost = 1; // next cost in golden; follows Fibonacci-like progression 1,2,3,5,8...

// Divine Simple Villager: reduces normal prices by 10% per level, cost doubles each purchase
let divineSimpleVillagerLevel = 0;
let divineSimpleVillagerCost = 1; // cost in golden currency; doubles each purchase
// Price is divided by (1 + 10% per level), so it never goes to zero (e.g. level 10 => 1/2 price, level 90 => 1/10 price)
function getSimpleVillagerMultiplier() { const lvl = typeof divineSimpleVillagerLevel === 'number' ? divineSimpleVillagerLevel : 0; return 1 / (1 + 0.1 * Math.max(0, lvl)); }
function effectiveUpgradeCost(baseCost) {
    if (baseCost === undefined || baseCost === null) return baseCost;
    const mult = getSimpleVillagerMultiplier();
    if (hasDecimal) {
        try {
            const c = isDecimalInstance(baseCost) ? baseCost : D(baseCost);
            return c.times(mult);
        } catch (e) { return (typeof baseCost === 'number' ? baseCost : Number(baseCost)) * mult; }
    }
    return (typeof baseCost === 'number' ? baseCost : Number(baseCost)) * mult;
}

// fib helper (supports Decimal if available)
function fibNumber(n) {
    const nn = Math.max(1, Math.floor(n));
    if (hasDecimal) {
        let a = D(1), b = D(2);
        if (nn === 1) return a;
        if (nn === 2) return b;
        for (let i = 3; i <= nn; i++) {
            const c = a.plus(b);
            a = b; b = c;
        }
        return b;
    } else {
        if (nn === 1) return 1;
        if (nn === 2) return 2;
        let a = 1, b = 2;
        for (let i = 3; i <= nn; i++) {
            const c = a + b;
            a = b; b = c;
        }
        return b;
    }
}

// bulk purchase amount (1,5,10,25,50,100)
let purchaseBatch = 1;

function setBulkPurchase(v) {
    const n = Number(v) || 1;
    purchaseBatch = n;
    // reflect selection in localStorage for persistence
    try { localStorage.setItem('whathappened_bulk', String(purchaseBatch)); } catch (e) {}
    try { updateDisplays(); } catch (e) {}
    // update any bulk button UI
    try{
        const btns = document.querySelectorAll('.bulk-btn');
        btns.forEach(b=>{
            try{ b.classList.toggle('active', Number(b.dataset.value) === purchaseBatch); }catch(e){}
        });
    }catch(e){}
}

// restore bulk selection on load (if available)
try {
    const bv = localStorage.getItem('whathappened_bulk');
    if (bv) purchaseBatch = Number(bv) || 1;
} catch (e) {}

function toggleDivineMenu() {
    divineMode = !divineMode;
    updateDisplays();
}

function showDivineMenu() {
    // allow entering divine menu if it's been permanently unlocked or player currently has gold
    if (!divineUnlocked && goldenWhat < 1) return; // locked
    divineMode = true;
    updateDisplays();
}

function showNormalMenu() {
    divineMode = false;
    updateDisplays();
}

function updateDisplays() {
    // updateDisplays: UI refresh (debug logs removed)
    document.getElementById('goonCount').innerText = formatNumber(count);
    // When mystery buff is active, casino/gamba.js owns cps and clickPower; do not overwrite them
    const mysteryBuffActive = !!(window._gambaMystery && window._gambaMystery.active);
    if (!mysteryBuffActive) {
    if (hasDecimal) {
        // recompute current click power from base and multipliers using Decimal math
        // include Divine Somalian multiplier: level 0 -> x1, level1 -> x11, subsequent levels multiply by 5 each
        let divineSomalianMult = D(1);
        if (typeof divineSomalianLevel !== 'undefined' && divineSomalianLevel > 0) {
            divineSomalianMult = D(11).times(D(5).pow(Math.max(0, divineSomalianLevel - 1)));
        }
        // compute OP mouse effective base applying milestone multipliers (milestones apply to OP mouse levels)
        const opLvl = D(upgrade1Level || 0);
        const opBaseInitial = D(1);
        const opUpgradeEffective = opLvl.times(D(computeLevelMultiplier(Number(opLvl))));
        const opEffectiveBase = opBaseInitial.plus(opUpgradeEffective);
        clickPower = opEffectiveBase.times(D(clickMultiplier)).times(divineSomalianMult);

        // compute effective components applying per-upgrade multipliers
        const parts = computeEffectiveCpsParts();
        try { console.debug('Easton debug (Decimal)', { upgrade24Level: (upgrade24Level && upgrade24Level.toString ? upgrade24Level.toString() : upgrade24Level), eastonEffective: (parts.eastonEffective && parts.eastonEffective.toString ? parts.eastonEffective.toString() : parts.eastonEffective) }); } catch (e) {}
        const nonPhonkOtherBase = parts.otherEffective;
        const jonathanContribution = parts.jonathanEffective.times(D(jonathanOtherMultiplier || 1));
        const crContribution = parts.crEffective.times(D(crOtherMultiplier || 1));
        const phonkContribution = D(phonkBaseCps).times(D(phonkOtherMultiplier || 1));
        // apply section multipliers to non-phonk other
        const nonPhonkOther = nonPhonkOtherBase.times(D(diddyOtherMultiplier || 1)).times(D(argonOtherMultiplier || 1)).times(D(grapeOtherMultiplier || 1)).times(D(skippieOtherMultiplier || 1)).times(D(islandOtherMultiplier || 1)).times(D(tribalOtherMultiplier || 1));
        let otherCps = nonPhonkOther.plus(jonathanContribution).plus(crContribution).plus(phonkContribution);
        // Fallback: ensure The Goatis contribution is included (in case computeEffectiveCpsParts misses it)
        try {
            const lvl18 = D(upgrade18Level || 0);
            const per18Local = D(150000000000);
            if (lvl18.gt(0) && per18Local.gt(0)) {
                const goatisEff = per18Local.times(lvl18).times(D(computeLevelMultiplier(Number(lvl18)))).times(D(typeof goatisMultiplier !== 'undefined' ? goatisMultiplier : 1));
                otherCps = otherCps.plus(goatisEff);
                console.debug('Goatis debug (Decimal):', { lvl: lvl18.toString(), goatisEff: goatisEff.toString(), goatisMultiplier: (typeof goatisMultiplier !== 'undefined' ? goatisMultiplier : 1) });
            }
        } catch (e) {}
        // Ensure Easton Bundy contribution is present — sometimes the parts object
        // can be zeroed by save/restore bugs; compute and add it as a safety net
        try {
            const partsEaston = parts && parts.eastonEffective ? parts.eastonEffective : D(0);
            const eastonIsZero = (isDecimalInstance(partsEaston) ? (partsEaston && typeof partsEaston.eq === 'function' ? partsEaston.eq(0) : false) : Number(partsEaston) === 0);
            if (eastonIsZero) {
                const upgrade24LvlLocal = D(getUpgradeLevel(24));
                const per24Local = D(1000000000000000000);
                const expectedLocalEaston = (upgrade24LvlLocal.gt(0) && per24Local.gt(0)) ? per24Local.times(upgrade24LvlLocal) : D(0);
                if (expectedLocalEaston.gt(0)) {
                    const eastonMultLocal = D(computeLevelMultiplier(Number(upgrade24LvlLocal)));
                    const eastonEffLocal = expectedLocalEaston.times(eastonMultLocal).times(D(typeof eastonBundyMultiplier !== 'undefined' ? eastonBundyMultiplier : 1));
                    otherCps = otherCps.plus(eastonEffLocal);
                }
            }
        } catch (e) {}
        // apply prestige golden multiplier (10% per golden by default)
        goldenMultiplier = D(1).plus(D(goldenWhat || 0).times(D(0.1)));

        // recompute pirate effective value now
        const pirateEffective = parts.pirateEffective;
        // recompute total cps from pirate and other sources, then apply golden multiplier and section multipliers
        cps = pirateEffective.times(D(pirateMultiplier || 1)).plus(otherCps.times(D(typeof goonMultiplier !== 'undefined' ? goonMultiplier : 1)));
        cps = cps.times(D(typeof diddyMultiplier !== 'undefined' ? diddyMultiplier : 1)).times(D(typeof argonMultiplier !== 'undefined' ? argonMultiplier : 1)).times(D(typeof grapeMultiplier !== 'undefined' ? grapeMultiplier : 1)).times(D(typeof skippieMultiplier !== 'undefined' ? skippieMultiplier : 1)).times(D(typeof islandMultiplier !== 'undefined' ? islandMultiplier : 1)).times(D(typeof tribalMultiplier !== 'undefined' ? tribalMultiplier : 1)).times(D(typeof phonkMultiplier !== 'undefined' ? phonkMultiplier : 1));
    } else {
        // recompute current click power from base and multipliers
        // include Divine Somalian multiplier: level 0 -> x1, level1 -> x11, subsequent levels multiply by 5 each
        let divineSomalianMult = 1;
        if (typeof divineSomalianLevel !== 'undefined' && divineSomalianLevel > 0) {
            divineSomalianMult = 11 * Math.pow(5, Math.max(0, divineSomalianLevel - 1));
        }
        // compute OP mouse effective base applying milestone multipliers (milestones apply to OP mouse levels)
        const opLvl = upgrade1Level || 0;
        const opBaseInitial = 1; // starting base click power
        const opUpgradeEffective = opLvl * computeLevelMultiplier(opLvl); // applies milestone multipliers when lvl>500
        const opEffectiveBase = opBaseInitial + opUpgradeEffective;
        clickPower = opEffectiveBase * clickMultiplier * divineSomalianMult;
        // compute effective components applying per-upgrade multipliers
        const parts = computeEffectiveCpsParts();
        try { console.debug('Easton debug (numeric)', { upgrade24Level: upgrade24Level, eastonEffective: parts.eastonEffective }); } catch (e) {}
        const nonPhonkOtherBase = parts.otherEffective;
        const jonathanContribution = parts.jonathanEffective * (jonathanOtherMultiplier || 1);
        const crContribution = parts.crEffective * (crOtherMultiplier || 1);
        const phonkContribution = phonkBaseCps * phonkOtherMultiplier;
        // apply section multipliers to non-phonk other
        const nonPhonkOther = nonPhonkOtherBase * diddyOtherMultiplier * argonOtherMultiplier * grapeOtherMultiplier * skippieOtherMultiplier * islandOtherMultiplier * tribalOtherMultiplier;
        let otherCps = nonPhonkOther + jonathanContribution + crContribution + phonkContribution;
        // Fallback: ensure The Goatis contribution is included (numeric branch)
        try {
            const lvl18 = upgrade18Level || 0;
            const per18Local = 150000000000;
            if (lvl18 > 0 && per18Local > 0) {
                const goatisEff = per18Local * lvl18 * computeLevelMultiplier(lvl18) * (typeof goatisMultiplier !== 'undefined' ? goatisMultiplier : 1);
                otherCps += goatisEff;
                console.debug('Goatis debug (numeric):', { lvl: lvl18, goatisEff: goatisEff, goatisMultiplier: (typeof goatisMultiplier !== 'undefined' ? goatisMultiplier : 1) });
            }
        } catch (e) {}
        // apply prestige golden multiplier (10% per golden by default)
        goldenMultiplier = 1 + (goldenWhat * 0.1);

        // recompute pirate effective value now
        const pirateEffective = parts.pirateEffective;
        // recompute total cps from pirate and other sources, then apply golden multiplier and section multipliers
        cps = (pirateEffective * pirateMultiplier + otherCps * (typeof goonMultiplier !== 'undefined' ? goonMultiplier : 1));
        cps = cps * (typeof diddyMultiplier !== 'undefined' ? diddyMultiplier : 1) * (typeof argonMultiplier !== 'undefined' ? argonMultiplier : 1) * (typeof grapeMultiplier !== 'undefined' ? grapeMultiplier : 1) * (typeof skippieMultiplier !== 'undefined' ? skippieMultiplier : 1) * (typeof islandMultiplier !== 'undefined' ? islandMultiplier : 1) * (typeof tribalMultiplier !== 'undefined' ? tribalMultiplier : 1) * (typeof phonkMultiplier !== 'undefined' ? phonkMultiplier : 1);
    }
    // update gem display if present
    try { const gemEl = document.getElementById('gemCount'); if (gemEl) gemEl.innerText = String(diamonds || 0); } catch (e) {}
    if (hasDecimal) {
        cps = cps.times(goldenMultiplier);
        if (typeof divineArgonLevel !== 'undefined' && divineArgonLevel > 0) {
            const appliedPercent = D(DIVINE_ARGON_BASE_PERCENT).times(D(D(2).pow(Math.max(0, (divineArgonLevel||0) - 1))));
            const divineMult = D(1).plus(appliedPercent.div(D(100)));
            cps = cps.times(divineMult);
        }
    } else {
        cps = cps * goldenMultiplier;
        // apply Divine Argonian multiplier if purchased (percent is additive percentage e.g. 300 -> +300%)
        if (typeof divineArgonLevel !== 'undefined' && divineArgonLevel > 0) {
            const appliedPercent = DIVINE_ARGON_BASE_PERCENT * Math.pow(2, Math.max(0, divineArgonLevel - 1));
            const divineMult = 1 + (appliedPercent / 100);
            cps = cps * divineMult;
        }
    }
    // Clan buff: whole-clan temporary multipliers from clan shop (CPS and click power)
    try {
        const cpsMult = (typeof window.clanBuffCpsMult === 'number' && window.clanBuffCpsMult > 0) ? window.clanBuffCpsMult : 1;
        const clickMult = (typeof window.clanBuffClickMult === 'number' && window.clanBuffClickMult > 0) ? window.clanBuffClickMult : 1;
        if (hasDecimal) {
            cps = cps.times(D(cpsMult));
            clickPower = clickPower.times(D(clickMult));
        } else {
            cps = cps * cpsMult;
            clickPower = clickPower * clickMult;
        }
    } catch (e) {}
    // Casino buff: apply active spin buffs from save (clickBoost/cpsBoost) so they persist across updateDisplays
    try {
        const raw = localStorage.getItem('whathappened_save') || localStorage.getItem('whathappened_save_v1');
        if (raw) {
            let s = {};
            try { s = JSON.parse(raw); } catch (e) {}
            const spin = s.casinoSpin;
            const buff = spin && spin.buff;
            const now = Date.now();
            if (buff && buff.expiresAt && Number(buff.expiresAt) > now) {
                if (buff.type === 'crit') {
                    try { window.casinoCritBonus = buff.value || 0.15; window.casinoCritExpires = buff.expiresAt; } catch (e) {}
                } else {
                    try { window.casinoCritBonus = 0; window.casinoCritExpires = null; } catch (e) {}
                }
                if (buff.type === 'clickBoost' && buff.mult) {
                    if (hasDecimal) clickPower = (isDecimalInstance(clickPower) ? clickPower : D(clickPower)).times(D(buff.mult));
                    else clickPower = clickPower * (buff.mult || 10);
                }
                if (buff.type === 'cpsBoost' && buff.mult) {
                    if (hasDecimal) cps = (isDecimalInstance(cps) ? cps : D(cps)).times(D(buff.mult));
                    else cps = cps * (buff.mult || 10);
                }
            } else if (buff && buff.type === 'crit') {
                try { if (window.casinoCritExpires && Number(window.casinoCritExpires) <= now) { window.casinoCritBonus = 0; window.casinoCritExpires = null; } } catch (e) {}
            }
        }
    } catch (e) {}
    }
    // persist latest cps for achievements UI to read when opened in separate tab
    try { localStorage.setItem('whathappened_current_cps', String(isDecimalInstance(cps) ? cps.toNumber() : Number(cps) || 0)); } catch (e) {}
    try { checkCpsAchievements(); } catch (e) {}
    try { localStorage.setItem('whathappened_current_clickpower', String(isDecimalInstance(clickPower) ? clickPower.toNumber() : Number(clickPower) || 0)); } catch (e) {}
    try { checkClickPowerAchievements(); } catch (e) {}
    try { checkUpgradeLevelAchievements(); } catch (e) {}
    try { checkClanAchievements(); } catch (e) {}
    // ------------------ Stats panel fields ------------------
    try {
        // total playtime (seconds -> human readable)
        const playSec = Number(localStorage.getItem('whathappened_playtime_seconds')||0) || 0;
        const playEl = document.getElementById('statsTotalPlaytime');
        if (playEl) playEl.innerText = formatSecondsHuman(playSec);
        // time since last prestige
        const lastPrest = Number(localStorage.getItem('whathappened_last_prestige_ts')||0) || 0;
        const sinceEl = document.getElementById('statsSincePrestige');
        if (sinceEl) {
            if (!lastPrest) sinceEl.innerText = 'N/A';
            else {
                const delta = Math.max(0, Math.floor((Date.now() - lastPrest) / 1000));
                sinceEl.innerText = formatSecondsHuman(delta);
            }
        }
        // lifetime clicks
        const lifeClicks = Number(localStorage.getItem('whathappened_lifetime_clicks')||0) || 0;
        const lifeEl = document.getElementById('statsLifetimeClicks');
        if (lifeEl) lifeEl.innerText = String(lifeClicks.toLocaleString());
        // clicks since last prestige
        const sinceClicks = Number(localStorage.getItem('whathappened_clicks_since_prestige')||0) || 0;
        const sinceClicksEl = document.getElementById('statsClicksSincePrestige');
        if (sinceClicksEl) sinceClicksEl.innerText = String(sinceClicks.toLocaleString());
    } catch (e) {}
    // update Divine Somalian button label and cost display if present
    try {
        const somBtn = document.getElementById('divineSomalianBtn');
        if (somBtn) {
            // compute current and next multiplier locally so we don't rely on outer-scope vars
            let curMult;
            if (hasDecimal) {
                curMult = D(1);
                if (typeof divineSomalianLevel !== 'undefined' && divineSomalianLevel > 0) curMult = D(11).times(D(5).pow(Math.max(0, divineSomalianLevel - 1)));
            } else {
                curMult = 1;
                if (typeof divineSomalianLevel !== 'undefined' && divineSomalianLevel > 0) curMult = 11 * Math.pow(5, Math.max(0, divineSomalianLevel - 1));
            }
            const nextMult = (typeof divineSomalianLevel === 'number' && divineSomalianLevel > 0) ? (hasDecimal ? curMult.times(5) : curMult * 5) : (hasDecimal ? D(11) : 11);
            const labelEl = somBtn.querySelector('.upgrade-label');
            if (labelEl) labelEl.innerHTML = `Divine Somalian — lvl ${divineSomalianLevel || 0} — click x${formatNumber(curMult)} (next x${formatNumber(nextMult)}) — cost: <span id="divineSomalianCost">${divineSomalianCost || 1}</span> golden`;
            try {
                const afford = !!goldenCanAfford(divineSomalianCost);
                try { somBtn.disabled = !afford; } catch (e) {}
                if (!somBtn.disabled) {
                    somBtn.removeAttribute('disabled');
                    somBtn.style.pointerEvents = 'auto';
                    somBtn.style.opacity = '';
                    somBtn.tabIndex = 0;
                } else {
                    try { somBtn.setAttribute('disabled', 'true'); } catch (e) {}
                    somBtn.style.pointerEvents = 'auto';
                    somBtn.style.opacity = '0.6';
                }
            } catch (e) { somBtn.disabled = false; }
        }
    } catch (e) {}
    // update upgrade19 label and formatted cost like other upgrades
    try {
        const up19Btn = document.getElementById('upgrade19');
        if (up19Btn) {
            const labelEl = up19Btn.querySelector('.upgrade-label');
            const formattedCost = formatNumber(typeof upgrade19Cost !== 'undefined' ? upgrade19Cost : 200000000000000);
            if (labelEl) labelEl.innerHTML = `goatises raw liver (cost: <span id="upgrade19Cost">${formattedCost}</span>)`;
            // reveal upgrade19 when upgrade18 has been purchased at least once
            try { up19Btn.style.display = (numericLevel(upgrade18Level) >= 1) ? '' : 'none'; } catch (e) {}
        }
    } catch (e) {}
    // Reveal special sections and buttons when Special Upgrades menu is open.
    try {
        const specialMenuEl = document.getElementById('specialMenu');
        const specialsVisible = specialMenuEl && specialMenuEl.classList && specialMenuEl.classList.contains('open');
            // List of section IDs to show/hide when specials menu is toggled (include ezSection and scpSection)
            const sectionIds = ['opSection','pirateSection','goonSection','goatisSection','rawSection','diddySection','argonSection','grapeSection','skippieSection','islandSection','tribalSection','phonkSection','jonathanSection','crSection','ropingSection','skibbidiSection','beatsSection','ezSection','scpSection','landonSection','theBassSection','goodNoodlesSection','mobileMan38Section'];
        for (const sid of sectionIds) {
            try {
                const s = document.getElementById(sid);
                if (!s) continue;
                // beats and ez sections remain hidden until their base upgrades are purchased
                let show = !!specialsVisible;
                if (sid === 'beatsSection') show = show && (numericLevel(upgrade15Level) >= 1);
                if (sid === 'ezSection') show = show && (numericLevel(upgrade16Level) >= 1);
                // raw specials should remain hidden until upgrade19 (goatises raw liver) has been unlocked
                if (sid === 'rawSection') show = show && (numericLevel(upgrade19Level) >= 1);
                s.style.display = show ? '' : 'none';
            } catch (e) {}
        }

        // mapping of individual special buttons to their unlock upgrade index and required level + purchased flag name
        const specialsMap = [
            // OP mouse specials (upgrade1)
            {id:'special1', up:1, lvl:10, purchased:'special1Purchased'}, {id:'special2', up:1, lvl:25, purchased:'special2Purchased'}, {id:'special3', up:1, lvl:50, purchased:'special3Purchased'}, {id:'special4', up:1, lvl:100, purchased:'special4Purchased'}, {id:'special5', up:1, lvl:150, purchased:'special5Purchased'}, {id:'special6', up:1, lvl:200, purchased:'special6Purchased'}, {id:'special7', up:1, lvl:250, purchased:'special7Purchased'}, {id:'special8', up:1, lvl:300, purchased:'special8Purchased'},
            // Landon Stream specials (upgrade20)
            {id:'landon1', up:20, lvl:10, purchased:'landon1Purchased'}, {id:'landon2', up:20, lvl:25, purchased:'landon2Purchased'}, {id:'landon3', up:20, lvl:50, purchased:'landon3Purchased'}, {id:'landon4', up:20, lvl:100, purchased:'landon4Purchased'},
            // The Bass specials (upgrade21)
            {id:'theBass1', up:21, lvl:10, purchased:'theBass1Purchased'}, {id:'theBass2', up:21, lvl:25, purchased:'theBass2Purchased'}, {id:'theBass3', up:21, lvl:50, purchased:'theBass3Purchased'}, {id:'theBass4', up:21, lvl:100, purchased:'theBass4Purchased'},
            // Good Noodles (upgrade22)
            {id:'goodNoodles1', up:22, lvl:10, purchased:'goodNoodles1Purchased'}, {id:'goodNoodles2', up:22, lvl:25, purchased:'goodNoodles2Purchased'}, {id:'goodNoodles3', up:22, lvl:50, purchased:'goodNoodles3Purchased'}, {id:'goodNoodles4', up:22, lvl:100, purchased:'goodNoodles4Purchased'},
            // Mobile Man 38 (upgrade23)
            {id:'mobileMan381', up:23, lvl:10, purchased:'mobileMan381Purchased'}, {id:'mobileMan382', up:23, lvl:25, purchased:'mobileMan382Purchased'}, {id:'mobileMan383', up:23, lvl:50, purchased:'mobileMan383Purchased'}, {id:'mobileMan384', up:23, lvl:100, purchased:'mobileMan384Purchased'},
            // Easton Bundy (upgrade24)
            {id:'eastonBundy1', up:24, lvl:10, purchased:'eastonBundy1Purchased'}, {id:'eastonBundy2', up:24, lvl:25, purchased:'eastonBundy2Purchased'}, {id:'eastonBundy3', up:24, lvl:50, purchased:'eastonBundy3Purchased'}, {id:'eastonBundy4', up:24, lvl:100, purchased:'eastonBundy4Purchased'},
            // Pirate (upgrade2)
            {id:'pirate1', up:2, lvl:10, purchased:'pirateSpec1Purchased'}, {id:'pirate2', up:2, lvl:25, purchased:'pirateSpec2Purchased'}, {id:'pirate3', up:2, lvl:50, purchased:'pirateSpec3Purchased'}, {id:'pirate4', up:2, lvl:100, purchased:'pirateSpec4Purchased'},
            // Goonsaw (upgrade3)
            {id:'goon1', up:3, lvl:10, purchased:'goonSpec1Purchased'}, {id:'goon2', up:3, lvl:25, purchased:'goonSpec2Purchased'}, {id:'goon3', up:3, lvl:50, purchased:'goonSpec3Purchased'}, {id:'goon4', up:3, lvl:100, purchased:'goonSpec4Purchased'},
            // The Goatis (upgrade18)
            {id:'goatis1', up:18, lvl:10, purchased:'goatis1Purchased'}, {id:'goatis2', up:18, lvl:25, purchased:'goatis2Purchased'}, {id:'goatis3', up:18, lvl:50, purchased:'goatis3Purchased'}, {id:'goatis4', up:18, lvl:100, purchased:'goatis4Purchased'},
            // goatises raw liver (upgrade19)
            {id:'raw1', up:19, lvl:10, purchased:'raw1Purchased'}, {id:'raw2', up:19, lvl:25, purchased:'raw2Purchased'}, {id:'raw3', up:19, lvl:50, purchased:'raw3Purchased'}, {id:'raw4', up:19, lvl:100, purchased:'raw4Purchased'},
            // Diddy (upgrade4)
            {id:'diddy1', up:4, lvl:10, purchased:'diddy1Purchased'}, {id:'diddy2', up:4, lvl:25, purchased:'diddy2Purchased'}, {id:'diddy3', up:4, lvl:50, purchased:'diddy3Purchased'}, {id:'diddy4', up:4, lvl:100, purchased:'diddy4Purchased'},
            // Argonian (upgrade5)
            {id:'argon1', up:5, lvl:10, purchased:'argon1Purchased'}, {id:'argon2', up:5, lvl:25, purchased:'argon2Purchased'}, {id:'argon3', up:5, lvl:50, purchased:'argon3Purchased'}, {id:'argon4', up:5, lvl:100, purchased:'argon4Purchased'},
            // Grape (upgrade6)
            {id:'grape1', up:6, lvl:10, purchased:'grape1Purchased'}, {id:'grape2', up:6, lvl:25, purchased:'grape2Purchased'}, {id:'grape3', up:6, lvl:50, purchased:'grape3Purchased'}, {id:'grape4', up:6, lvl:100, purchased:'grape4Purchased'},
            // Skippie (upgrade7)
            {id:'skippie1', up:7, lvl:10, purchased:'skippie1Purchased'}, {id:'skippie2', up:7, lvl:25, purchased:'skippie2Purchased'}, {id:'skippie3', up:7, lvl:50, purchased:'skippie3Purchased'}, {id:'skippie4', up:7, lvl:100, purchased:'skippie4Purchased'},
            // Island (upgrade8)
            {id:'island1', up:8, lvl:10, purchased:'island1Purchased'}, {id:'island2', up:8, lvl:25, purchased:'island2Purchased'}, {id:'island3', up:8, lvl:50, purchased:'island3Purchased'}, {id:'island4', up:8, lvl:100, purchased:'island4Purchased'},
            // Tribal (upgrade9)
            {id:'tribal1', up:9, lvl:10, purchased:'tribal1Purchased'}, {id:'tribal2', up:9, lvl:25, purchased:'tribal2Purchased'}, {id:'tribal3', up:9, lvl:50, purchased:'tribal3Purchased'}, {id:'tribal4', up:9, lvl:100, purchased:'tribal4Purchased'},
            // Phonk (upgrade10)
            {id:'phonk1', up:10, lvl:10, purchased:'phonk1Purchased'}, {id:'phonk2', up:10, lvl:25, purchased:'phonk2Purchased'}, {id:'phonk3', up:10, lvl:50, purchased:'phonk3Purchased'}, {id:'phonk4', up:10, lvl:75, purchased:'phonk4Purchased'}, {id:'phonk5', up:10, lvl:100, purchased:'phonk5Purchased'},
            // Jonathan (upgrade11)
            {id:'jonathan1', up:11, lvl:10, purchased:'jonathan1Purchased'}, {id:'jonathan2', up:11, lvl:25, purchased:'jonathan2Purchased'}, {id:'jonathan3', up:11, lvl:50, purchased:'jonathan3Purchased'}, {id:'jonathan4', up:11, lvl:75, purchased:'jonathan4Purchased'},
            // CR (upgrade12)
            {id:'cr1', up:12, lvl:10, purchased:'cr1Purchased'}, {id:'cr2', up:12, lvl:25, purchased:'cr2Purchased'}, {id:'cr3', up:12, lvl:50, purchased:'cr3Purchased'}, {id:'cr4', up:12, lvl:75, purchased:'cr4Purchased'}, {id:'cr5', up:12, lvl:100, purchased:'cr5Purchased'},
            // Roping (upgrade13)
            {id:'roping1', up:13, lvl:10, purchased:'roping1Purchased'}, {id:'roping2', up:13, lvl:25, purchased:'roping2Purchased'}, {id:'roping3', up:13, lvl:50, purchased:'roping3Purchased'}, {id:'roping4', up:13, lvl:75, purchased:'roping4Purchased'},
            // Skibbidi (upgrade14)
            {id:'skibidi1', up:14, lvl:10, purchased:'skibidi1Purchased'}, {id:'skibidi2', up:14, lvl:25, purchased:'skibidi2Purchased'}, {id:'skibidi3', up:14, lvl:50, purchased:'skibidi3Purchased'}, {id:'skibidi4', up:14, lvl:75, purchased:'skibidi4Purchased'},
            // Beats (upgrade15)
            {id:'beats1', up:15, lvl:10, purchased:'beats1Purchased'}, {id:'beats2', up:15, lvl:25, purchased:'beats2Purchased'}, {id:'beats3', up:15, lvl:50, purchased:'beats3Purchased'},
            // EZ Villager specials (upgrade16)
            {id:'ez1', up:16, lvl:10, purchased:'ez1Purchased'}, {id:'ez2', up:16, lvl:25, purchased:'ez2Purchased'}, {id:'ez3', up:16, lvl:50, purchased:'ez3Purchased'}, {id:'ez4', up:16, lvl:100, purchased:'ez4Purchased'}
            ,
            // SCP specials (upgrade17)
            {id:'scp1', up:17, lvl:10, purchased:'scp1Purchased'}, {id:'scp2', up:17, lvl:25, purchased:'scp2Purchased'}, {id:'scp3', up:17, lvl:50, purchased:'scp3Purchased'}, {id:'scp4', up:17, lvl:75, purchased:'scp4Purchased'}
        ];

        // compute next special unlock level per upgrade (choose the next unpurchased special)
        const __ns_local = {};
        for (const s of specialsMap) {
            try {
                // attempt to read the purchased flag from global properties first
                let purchasedFlag = (typeof window[s.purchased] !== 'undefined') ? !!window[s.purchased] : false;
                // fall back to evaluating the variable name if it exists in scope (handles top-level `let` bindings)
                if (!purchasedFlag) {
                    try { purchasedFlag = !!eval(s.purchased); } catch (e) { purchasedFlag = false; }
                }
                if (purchasedFlag) continue; // already bought this special
                // pick the lowest-level unpurchased special for this upgrade (store as Number)
                const lvlNum = Number(s.lvl);
                if (!__ns_local[s.up] || lvlNum < __ns_local[s.up]) __ns_local[s.up] = lvlNum;
            } catch (e) {}
        }
        window.__nextSpecialFor = __ns_local;
        window.__nextSpecialText = upIdx => {
            try {
                if (!(window.__nextSpecialFor && Object.prototype.hasOwnProperty.call(window.__nextSpecialFor, upIdx))) return '';
                const target = Number(window.__nextSpecialFor[upIdx]);
                const curr = numericLevel(getUpgradeLevel(upIdx));
                const diff = Math.max(0, target - curr);
                if (diff > 0) return ` (next special in ${diff} level${diff === 1 ? '' : 's'})`;
                // unlocked but not purchased yet
                return ` (special available at lvl ${target})`;
            } catch (e) { return ''; }
        };

        // SCP specials visibility and button states (show when upgrade17 purchased at least once)
        try {
            const scpContent = document.getElementById('scpContent');
            const scpUnlocked = numericLevel(upgrade17Level) >= 1;
            if (scpContent) scpContent.style.display = (scpUnlocked && specialsVisible) ? '' : 'none';
            const b1 = document.getElementById('scp1'); if (b1) { b1.style.display = (specialsVisible ? '' : 'none'); b1.disabled = scp1Purchased || numericLevel(upgrade17Level) < 10; }
            const b2 = document.getElementById('scp2'); if (b2) { b2.style.display = (specialsVisible ? '' : 'none'); b2.disabled = scp2Purchased || numericLevel(upgrade17Level) < 25; }
            const b3 = document.getElementById('scp3'); if (b3) { b3.style.display = (specialsVisible ? '' : 'none'); b3.disabled = scp3Purchased || numericLevel(upgrade17Level) < 50; }
            const b4 = document.getElementById('scp4'); if (b4) { b4.style.display = (specialsVisible ? '' : 'none'); b4.disabled = scp4Purchased || numericLevel(upgrade17Level) < 75; }
        } catch (e) {}

        // Landon specials visibility and button states (show when Landon purchased at least once)
        try {
            const landonSectionEl = document.getElementById('landonSection');
            const landonContent = document.getElementById('landonContent');
            const landonUnlocked = numericLevel(upgrade20Level) >= 1;
            if (landonSectionEl) landonSectionEl.style.display = (landonUnlocked && specialsVisible) ? '' : 'none';
            if (landonContent) landonContent.style.display = (landonUnlocked && specialsVisible) ? '' : 'none';
            const ld1 = document.getElementById('landon1'); if (ld1) { ld1.style.display = (specialsVisible && landonUnlocked ? '' : 'none'); ld1.disabled = landon1Purchased || numericLevel(upgrade20Level) < 10; }
            const ld2 = document.getElementById('landon2'); if (ld2) { ld2.style.display = (specialsVisible && landonUnlocked ? '' : 'none'); ld2.disabled = landon2Purchased || numericLevel(upgrade20Level) < 25; }
            const ld3 = document.getElementById('landon3'); if (ld3) { ld3.style.display = (specialsVisible && landonUnlocked ? '' : 'none'); ld3.disabled = landon3Purchased || numericLevel(upgrade20Level) < 50; }
            const ld4 = document.getElementById('landon4'); if (ld4) { ld4.style.display = (specialsVisible && landonUnlocked ? '' : 'none'); ld4.disabled = landon4Purchased || numericLevel(upgrade20Level) < 100; }
        } catch (e) {}

        // The Bass specials visibility and button states (show when The Bass purchased at least once)
        try {
            const theBassSectionEl = document.getElementById('theBassSection');
            const theBassContent = document.getElementById('theBassContent');
            const theBassUnlocked = numericLevel(upgrade21Level) >= 1;
            if (theBassSectionEl) theBassSectionEl.style.display = (theBassUnlocked && specialsVisible) ? '' : 'none';
            if (theBassContent) theBassContent.style.display = (theBassUnlocked && specialsVisible) ? '' : 'none';
            const tb1 = document.getElementById('theBass1'); if (tb1) { tb1.style.display = (specialsVisible && theBassUnlocked ? '' : 'none'); tb1.disabled = theBass1Purchased || numericLevel(upgrade21Level) < 10; }
            const tb2 = document.getElementById('theBass2'); if (tb2) { tb2.style.display = (specialsVisible && theBassUnlocked ? '' : 'none'); tb2.disabled = theBass2Purchased || numericLevel(upgrade21Level) < 25; }
            const tb3 = document.getElementById('theBass3'); if (tb3) { tb3.style.display = (specialsVisible && theBassUnlocked ? '' : 'none'); tb3.disabled = theBass3Purchased || numericLevel(upgrade21Level) < 50; }
            const tb4 = document.getElementById('theBass4'); if (tb4) { tb4.style.display = (specialsVisible && theBassUnlocked ? '' : 'none'); tb4.disabled = theBass4Purchased || numericLevel(upgrade21Level) < 100; }
        } catch (e) {}

        // Good Noodles specials visibility and button states (show when Good Noodles purchased at least once)
        try {
            const gnSectionEl = document.getElementById('goodNoodlesSection');
            const gnContent = document.getElementById('goodNoodlesContent');
            const gnUnlocked = numericLevel(upgrade22Level) >= 1;
            if (gnSectionEl) gnSectionEl.style.display = (gnUnlocked && specialsVisible) ? '' : 'none';
            if (gnContent) gnContent.style.display = (gnUnlocked && specialsVisible) ? '' : 'none';
            const gn1 = document.getElementById('goodNoodles1'); if (gn1) { gn1.style.display = (specialsVisible && gnUnlocked ? '' : 'none'); gn1.disabled = goodNoodles1Purchased || numericLevel(upgrade22Level) < 10; document.getElementById('goodNoodles1Cost').innerText = formatNumber(goodNoodles1Cost); }
            const gn2 = document.getElementById('goodNoodles2'); if (gn2) { gn2.style.display = (specialsVisible && gnUnlocked ? '' : 'none'); gn2.disabled = goodNoodles2Purchased || numericLevel(upgrade22Level) < 25; document.getElementById('goodNoodles2Cost').innerText = formatNumber(goodNoodles2Cost); }
            const gn3 = document.getElementById('goodNoodles3'); if (gn3) { gn3.style.display = (specialsVisible && gnUnlocked ? '' : 'none'); gn3.disabled = goodNoodles3Purchased || numericLevel(upgrade22Level) < 50; document.getElementById('goodNoodles3Cost').innerText = formatNumber(goodNoodles3Cost); }
            const gn4 = document.getElementById('goodNoodles4'); if (gn4) { gn4.style.display = (specialsVisible && gnUnlocked ? '' : 'none'); gn4.disabled = goodNoodles4Purchased || numericLevel(upgrade22Level) < 100; document.getElementById('goodNoodles4Cost').innerText = formatNumber(goodNoodles4Cost); }
        } catch (e) {}

        // Mobile Man 38 specials visibility and button states (show when Mobile Man 38 purchased at least once)
        try {
            const mmSectionEl = document.getElementById('mobileMan38Section');
            const mmContent = document.getElementById('mobileMan38Content');
            const mmUnlocked = numericLevel(upgrade23Level) >= 1;
            if (mmSectionEl) mmSectionEl.style.display = (mmUnlocked && specialsVisible) ? '' : 'none';
            if (mmContent) mmContent.style.display = (mmUnlocked && specialsVisible) ? '' : 'none';
            const mm1 = document.getElementById('mobileMan381'); if (mm1) { mm1.style.display = (specialsVisible && mmUnlocked ? '' : 'none'); mm1.disabled = mobileMan381Purchased || numericLevel(upgrade23Level) < 10; document.getElementById('mobileMan381Cost').innerText = formatNumber(mobileMan381Cost); }
            const mm2 = document.getElementById('mobileMan382'); if (mm2) { mm2.style.display = (specialsVisible && mmUnlocked ? '' : 'none'); mm2.disabled = mobileMan382Purchased || numericLevel(upgrade23Level) < 25; document.getElementById('mobileMan382Cost').innerText = formatNumber(mobileMan382Cost); }
            const mm3 = document.getElementById('mobileMan383'); if (mm3) { mm3.style.display = (specialsVisible && mmUnlocked ? '' : 'none'); mm3.disabled = mobileMan383Purchased || numericLevel(upgrade23Level) < 50; document.getElementById('mobileMan383Cost').innerText = formatNumber(mobileMan383Cost); }
            const mm4 = document.getElementById('mobileMan384'); if (mm4) { mm4.style.display = (specialsVisible && mmUnlocked ? '' : 'none'); mm4.disabled = mobileMan384Purchased || numericLevel(upgrade23Level) < 100; document.getElementById('mobileMan384Cost').innerText = formatNumber(mobileMan384Cost); }
        } catch (e) {}

        try {
            const ebSectionEl = document.getElementById('eastonBundySection');
            const ebContent = document.getElementById('eastonBundyContent');
            const ebUnlocked = numericLevel(upgrade24Level) >= 1;
            if (ebSectionEl) ebSectionEl.style.display = (ebUnlocked && specialsVisible) ? '' : 'none';
            if (ebContent) ebContent.style.display = (ebUnlocked && specialsVisible) ? '' : 'none';
            const eb1 = document.getElementById('eastonBundy1'); if (eb1) { eb1.style.display = (specialsVisible && ebUnlocked ? '' : 'none'); eb1.disabled = eastonBundy1Purchased || numericLevel(upgrade24Level) < 10; document.getElementById('eastonBundy1Cost').innerText = formatNumber(eastonBundy1Cost); const eb1Effect = document.getElementById('eastonBundy1Effect'); if (eb1Effect) eb1Effect.innerHTML = 'x1.5 CPS<br>Unlocks at lvl 10<br>Cost: ' + formatNumber(eastonBundy1Cost); }
            const eb2 = document.getElementById('eastonBundy2'); if (eb2) { eb2.style.display = (specialsVisible && ebUnlocked ? '' : 'none'); eb2.disabled = eastonBundy2Purchased || numericLevel(upgrade24Level) < 25; document.getElementById('eastonBundy2Cost').innerText = formatNumber(eastonBundy2Cost); const eb2Effect = document.getElementById('eastonBundy2Effect'); if (eb2Effect) eb2Effect.innerHTML = 'x2 CPS<br>Unlocks at lvl 25<br>Cost: ' + formatNumber(eastonBundy2Cost); }
            const eb3 = document.getElementById('eastonBundy3'); if (eb3) { eb3.style.display = (specialsVisible && ebUnlocked ? '' : 'none'); eb3.disabled = eastonBundy3Purchased || numericLevel(upgrade24Level) < 50; document.getElementById('eastonBundy3Cost').innerText = formatNumber(eastonBundy3Cost); const eb3Effect = document.getElementById('eastonBundy3Effect'); if (eb3Effect) eb3Effect.innerHTML = 'x2.5 CPS<br>Unlocks at lvl 50<br>Cost: ' + formatNumber(eastonBundy3Cost); }
            const eb4 = document.getElementById('eastonBundy4'); if (eb4) { eb4.style.display = (specialsVisible && ebUnlocked ? '' : 'none'); eb4.disabled = eastonBundy4Purchased || numericLevel(upgrade24Level) < 100; document.getElementById('eastonBundy4Cost').innerText = formatNumber(eastonBundy4Cost); const eb4Effect = document.getElementById('eastonBundy4Effect'); if (eb4Effect) eb4Effect.innerHTML = 'x3 CPS<br>Unlocks at lvl 100<br>Cost: ' + formatNumber(eastonBundy4Cost); }
        } catch (e) {}

        for (const s of specialsMap) {
            try {
                const btn = document.getElementById(s.id);
                if (!btn) continue;
                // reveal the button when specials menu is visible
                btn.style.display = specialsVisible ? '' : 'none';
                // determine player's level for the associated upgrade
                const playerLvl = numericLevel(getUpgradeLevel(s.up));
                // check purchased flag dynamically
                let purchased = false;
                try { purchased = !!(eval(s.purchased)); } catch (e) { purchased = false; }
                // button enabled only if unlocked and not already purchased
                btn.disabled = !(playerLvl >= s.lvl) || purchased;
                // apply letter notation for special tiers (10->A,25->B,50->C,100->D)
                try {
                    if (!btn.dataset.letterApplied) {
                        const letterMap = {10:'A',25:'B',50:'C',100:'D'};
                        const letter = letterMap[s.lvl] || '';
                        if (letter) {
                            btn.innerHTML = `${letter}: ${btn.innerHTML}`;
                            btn.dataset.letterApplied = '1';
                        }
                    }
                } catch (e) {}
            } catch (e) {}
        }
    } catch (e) {}
    // update Divine Assassin button label and cost display if present
    try {
        const asnBtn = document.getElementById('divineAssassinBtn');
        if (asnBtn) {
            const lvl = typeof divineAssassinLevel === 'number' ? divineAssassinLevel : 0;
            const baseChance = (typeof DIVINE_ASSASSIN_BASE_CHANCE !== 'undefined') ? DIVINE_ASSASSIN_BASE_CHANCE : 0.05;
            const chance = Math.min(1, baseChance * lvl);
            const chanceStr = (chance * 100).toFixed(2);
            const labelEl2 = asnBtn.querySelector('.upgrade-label');
            if (labelEl2) {
                if (lvl >= 19) {
                    labelEl2.innerHTML = `Divine Assassin — lvl ${lvl} (MAX) — crit ${chanceStr}%`;
                } else {
                    labelEl2.innerHTML = `Divine Assassin — lvl ${lvl} — crit ${chanceStr}% — cost: <span id="divineAssassinCost">${divineAssassinCost || 1}</span> golden`;
                }
            }
            // disable button when not affordable or at max level (with visual styling)
            try {
                const afford = !!goldenCanAfford(divineAssassinCost);
                try { asnBtn.disabled = (!afford) || (lvl >= 19); } catch (e) {}
                if (!asnBtn.disabled) {
                    asnBtn.removeAttribute('disabled');
                    asnBtn.style.pointerEvents = 'auto';
                    asnBtn.style.opacity = '';
                    asnBtn.tabIndex = 0;
                } else {
                    try { asnBtn.setAttribute('disabled', 'true'); } catch (e) {}
                    asnBtn.style.pointerEvents = 'auto';
                    asnBtn.style.opacity = '0.6';
                }
            } catch (e) { asnBtn.disabled = (lvl >= 19); }
        }
    } catch (e) {}
    // update Divine Spirit button label and cost display if present
    try {
        const spBtn = document.getElementById('divineSpiritBtn');
        if (spBtn) {
            try {
                const lvl = typeof divineSpiritLevel === 'number' ? divineSpiritLevel : 0;
                const cost = typeof divineSpiritCost !== 'undefined' ? divineSpiritCost : (hasDecimal ? D(1) : 1);
                const labelEl = spBtn.querySelector('.upgrade-label');
                if (labelEl) labelEl.innerHTML = `Divine Spirit of What Happened — lvl ${lvl} — crit x${formatNumber(lvl > 0 ? (10 * Math.pow(2, Math.max(0, lvl-1))) : 0)} — cost: <span id="divineSpiritCost">${formatNumber(cost)}</span> golden`;
                // robust affordability check with logging
                try {
                    const afford = !!goldenCanAfford(divineSpiritCost);
                    try {
                        spBtn.disabled = !afford;
                        if (!spBtn.disabled) {
                            spBtn.removeAttribute('disabled');
                            spBtn.style.pointerEvents = 'auto';
                            spBtn.style.opacity = '';
                            spBtn.tabIndex = 0;
                        } else {
                            try { spBtn.setAttribute('disabled', 'true'); } catch (e) {}
                            spBtn.style.pointerEvents = 'auto';
                            spBtn.style.opacity = '0.6';
                        }
                    } catch (e) {}
                    // ensure onclick is wired
                    try { spBtn.onclick = function() { buyDivineSpirit(); }; } catch (e) {}
                } catch (e) {
                    spBtn.disabled = false;
                }
            } catch (e) { console.error('DivineSpirit button render error', e); }
        }
    } catch (e) {}
    // update Divine Collector button label and cost display if present
    try {
        const colBtn = document.getElementById('divineCollectorBtn');
        if (colBtn) {
            const lvl = typeof divineCollectorLevel === 'number' ? divineCollectorLevel : 0;
            const bonus = (lvl * DIVINE_COLLECTOR_PER_LEVEL) * 100; // percentage
            const bonusStr = bonus.toFixed(1);
            const labelEl3 = colBtn.querySelector('.upgrade-label');
            if (labelEl3) labelEl3.innerHTML = `Divine Collector — lvl ${lvl} — +${bonusStr}% golden — cost: <span id="divineCollectorCost">${divineCollectorCost || 1}</span> golden`;
            try {
                const afford = !!goldenCanAfford(divineCollectorCost);
                try { colBtn.disabled = !afford; } catch (e) {}
                if (!colBtn.disabled) {
                    colBtn.removeAttribute('disabled');
                    colBtn.style.pointerEvents = 'auto';
                    colBtn.style.opacity = '';
                    colBtn.tabIndex = 0;
                } else {
                    try { colBtn.setAttribute('disabled', 'true'); } catch (e) {}
                    colBtn.style.pointerEvents = 'auto';
                    colBtn.style.opacity = '0.6';
                }
            } catch (e) { colBtn.disabled = false; }
        }
    } catch (e) {}
    // update Divine Money Man button label and cost display if present
    try {
        const mmBtn = document.getElementById('divineMoneyManBtn');
        if (mmBtn) {
            const lvl = typeof divineMoneyManLevel === 'number' ? divineMoneyManLevel : 0;
            const startAmount = lvl > 0 ? (DIVINE_MONEYMAN_BASE * Math.pow(10, Math.max(0, lvl - 1))) : DIVINE_MONEYMAN_BASE;
            const labelEl4 = mmBtn.querySelector('.upgrade-label');
            if (labelEl4) labelEl4.innerHTML = `Divine Money Man — lvl ${lvl} — start +${formatNumber(startAmount)} after prestige — cost: <span id="divineMoneyManCost">${divineMoneyManCost || 1}</span> golden`;
            try {
                const afford = !!goldenCanAfford(divineMoneyManCost);
                try { mmBtn.disabled = !afford; } catch (e) {}
                if (!mmBtn.disabled) {
                    mmBtn.removeAttribute('disabled');
                    mmBtn.style.pointerEvents = 'auto';
                    mmBtn.style.opacity = '';
                    mmBtn.tabIndex = 0;
                } else {
                    try { mmBtn.setAttribute('disabled', 'true'); } catch (e) {}
                    mmBtn.style.pointerEvents = 'auto';
                    mmBtn.style.opacity = '0.6';
                }
            } catch (e) { mmBtn.disabled = false; }
        }
    } catch (e) {}
    // update Divine Simple Villager button label and cost display if present
    try {
        const svBtn = document.getElementById('divineSimpleVillagerBtn');
        if (svBtn) {
            const lvl = typeof divineSimpleVillagerLevel === 'number' ? divineSimpleVillagerLevel : 0;
            const labelEl = svBtn.querySelector('.upgrade-label');
            const perLevelPercent = 10;
            const currentMult = 1 / (1 + 0.1 * lvl);
            const nextMult = 1 / (1 + 0.1 * (lvl + 1));
            const currentPct = Math.round((1 - currentMult) * 100);
            const nextPct = Math.round((1 - nextMult) * 100);
            if (labelEl) labelEl.innerHTML = `Divine Simple Villager — lvl ${lvl} — price ÷ (1 + ${perLevelPercent}% per lvl); current ${currentPct}% reduction, next ${nextPct}% — cost: <span id="divineSimpleVillagerCost">${formatNumber(divineSimpleVillagerCost || 1)}</span> golden`;
            try {
                const afford = !!goldenCanAfford(divineSimpleVillagerCost);
                try { svBtn.disabled = !afford; } catch (e) {}
                if (!svBtn.disabled) {
                    svBtn.removeAttribute('disabled');
                    svBtn.style.pointerEvents = 'auto';
                    svBtn.style.opacity = '';
                    svBtn.tabIndex = 0;
                } else {
                    try { svBtn.setAttribute('disabled', 'true'); } catch (e) {}
                    svBtn.style.pointerEvents = 'auto';
                    svBtn.style.opacity = '0.6';
                }
            } catch (e) { svBtn.disabled = false; }
        }
    } catch (e) {}
    document.getElementById('cps').innerText = formatNumber(cps);
    // apply golden multiplier to click power display — use same calculation as tooltip for consistency
    try {
        const displayClick = getUpgradeCps('upgrade1');
        document.getElementById('clickPower').innerText = formatNumber(displayClick);
    } catch (e) {
        document.getElementById('clickPower').innerText = formatNumber(clickPower * goldenMultiplier);
    }
    // Upgrade button labels (preserve images inside buttons)
    const setLabel = (btnId, text) => {
        const labelEl = document.querySelector(`#${btnId} .upgrade-label`);
        if (labelEl) labelEl.innerText = text;
        else {
            const btn = document.getElementById(btnId);
            if (btn) btn.innerText = text;
        }
    };
    // show batch cost (how much needed to buy the selected `purchaseBatch` amount)
    const r110 = 1.1;
    const r115 = 1.15;
    const b = purchaseBatch || 1;
    const cost1 = computeBatchCostWithSimpleVillager(upgrade1Cost, b, r110);
    const cost2 = computeBatchCostWithSimpleVillager(upgrade2Cost, b, r110);
    const cost3 = computeBatchCostWithSimpleVillager(upgrade3Cost, b, r110);
    const cost4 = computeBatchCostWithSimpleVillager(upgrade4Cost, b, r110);
    const cost5 = computeBatchCostWithSimpleVillager(upgrade5Cost, b, r110);
    const cost6 = computeBatchCostWithSimpleVillager(upgrade6Cost, b, r110);
    const cost7 = computeBatchCostWithSimpleVillager(upgrade7Cost, b, r110);
    const cost8 = computeBatchCostWithSimpleVillager(upgrade8Cost, b, r110);
    const cost9 = computeBatchCostWithSimpleVillager(upgrade9Cost, b, r110);
    const cost10 = computeBatchCostWithSimpleVillager(upgrade10Cost, b, r110);
    const cost11 = computeBatchCostWithSimpleVillager(upgrade11Cost, b, r115);
    const cost12 = computeBatchCostWithSimpleVillager(upgrade12Cost, b, r115);
    const cost13 = computeBatchCostWithSimpleVillager(upgrade13Cost, b, r115);
    const cost14 = computeBatchCostWithSimpleVillager(upgrade14Cost, b, r115);
    const cost15 = computeBatchCostWithSimpleVillager(upgrade15Cost, b, r115);
    const cost16 = computeBatchCostWithSimpleVillager(upgrade16Cost, b, r115);
    const cost17 = computeBatchCostWithSimpleVillager(upgrade17Cost, b, r115);
    const cost18 = computeBatchCostWithSimpleVillager(upgrade18Cost, b, r115);
    const cost19 = computeBatchCostWithSimpleVillager(typeof upgrade19Cost !== 'undefined' ? upgrade19Cost : 200000000000000, b, r115);
    const cost20 = computeBatchCostWithSimpleVillager(typeof upgrade20Cost !== 'undefined' ? upgrade20Cost : 1000000000000000, b, r115);
    const cost21 = computeBatchCostWithSimpleVillager(typeof upgrade21Cost !== 'undefined' ? upgrade21Cost : 200000000000000000, b, r115);
    const cost22 = computeBatchCostWithSimpleVillager(typeof upgrade22Cost !== 'undefined' ? upgrade22Cost : 1000000000000000000, b, r115);
    const cost23 = computeBatchCostWithSimpleVillager(typeof upgrade23Cost !== 'undefined' ? upgrade23Cost : 5000000000000000000, b, r115);
    const cost24 = computeBatchCostWithSimpleVillager(typeof upgrade24Cost !== 'undefined' ? upgrade24Cost : 30000000000000000000, b, r115);

    setLabel('upgrade1', `OP mouse (cost for ${b}: ${formatNumber(cost1)})` + (upgrade1Level ? ` - lvl ${upgrade1Level}` : ''));
    setLabel('upgrade2', `Somalian Pirate (cost for ${b}: ${formatNumber(cost2)})` + (upgrade2Level ? ` - lvl ${upgrade2Level}` : ''));
    setLabel('upgrade3', `Goonsaw Man (cost for ${b}: ${formatNumber(cost3)})` + (upgrade3Level ? ` - lvl ${upgrade3Level}` : ''));
    setLabel('upgrade4', `Diddy blud (cost for ${b}: ${formatNumber(cost4)})` + (upgrade4Level ? ` - lvl ${upgrade4Level}` : ''));
    setLabel('upgrade5', `Argonian Autist (cost for ${b}: ${formatNumber(cost5)})` + (upgrade5Level ? ` - lvl ${upgrade5Level}` : ''));
    setLabel('upgrade6', `Grape God (cost for ${b}: ${formatNumber(cost6)})` + (upgrade6Level ? ` - lvl ${upgrade6Level}` : ''));
    setLabel('upgrade7', `Skippie Toilet (cost for ${b}: ${formatNumber(cost7)})` + (upgrade7Level ? ` - lvl ${upgrade7Level}` : ''));
    setLabel('upgrade8', `Mysterious Island (cost for ${b}: ${formatNumber(cost8)})` + (upgrade8Level ? ` - lvl ${upgrade8Level}` : ''));
    setLabel('upgrade9', `Tribal Camp (cost for ${b}: ${formatNumber(cost9)})` + (upgrade9Level ? ` - lvl ${upgrade9Level}` : ''));
    setLabel('upgrade10', `The Phonk Man (cost for ${b}: ${formatNumber(cost10)})` + (upgrade10Level ? ` - lvl ${upgrade10Level}` : ''));
    setLabel('upgrade11', `Jonathan (cost for ${b}: ${formatNumber(cost11)})` + (upgrade11Level ? ` - lvl ${upgrade11Level}` : ''));
    setLabel('upgrade12', `CR lurker (cost for ${b}: ${formatNumber(cost12)})` + (upgrade12Level ? ` - lvl ${upgrade12Level}` : ''));
    setLabel('upgrade13', `ropingnecurse (cost for ${b}: ${formatNumber(cost13)})` + (upgrade13Level ? ` - lvl ${upgrade13Level}` : ''));
    setLabel('upgrade14', `skibbidi scimitar (cost for ${b}: ${formatNumber(cost14)})` + (upgrade14Level ? ` - lvl ${upgrade14Level}` : ''));
    setLabel('upgrade15', `What Happened Beats (cost for ${b}: ${formatNumber(cost15)})` + (upgrade15Level ? ` - lvl ${upgrade15Level}` : ''));
    setLabel('upgrade16', `ez villager (cost for ${b}: ${formatNumber(cost16)})` + (upgrade16Level ? ` - lvl ${upgrade16Level}` : ''));
    setLabel('upgrade17', `scp wish I knew. (cost for ${b}: ${formatNumber(cost17)})` + (upgrade17Level ? ` - lvl ${upgrade17Level}` : ''));
    setLabel('upgrade18', `The Goatis (cost for ${b}: ${formatNumber(cost18)})` + (upgrade18Level ? ` - lvl ${upgrade18Level}` : ''));
    setLabel('upgrade19', `goatises raw liver (cost for ${b}: ${formatNumber(cost19)})` + (upgrade19Level ? ` - lvl ${upgrade19Level}` : ''));
    setLabel('upgrade20', `The Landon Stream (cost for ${b}: ${formatNumber(cost20)})` + (upgrade20Level ? ` - lvl ${upgrade20Level}` : ''));
    setLabel('upgrade21', `The Bass (cost for ${b}: ${formatNumber(cost21)})` + (upgrade21Level ? ` - lvl ${upgrade21Level}` : ''));
    setLabel('upgrade22', `Good Noodles (cost for ${b}: ${formatNumber(cost22)})` + (upgrade22Level ? ` - lvl ${upgrade22Level}` : ''));
    setLabel('upgrade23', `Mobile Man 38 (cost for ${b}: ${formatNumber(cost23)})` + (upgrade23Level ? ` - lvl ${upgrade23Level}` : ''));
    setLabel('upgrade24', `Easton Bundy (cost for ${b}: ${formatNumber(cost24)})` + (upgrade24Level ? ` - lvl ${upgrade24Level}` : ''));

    // no left-bar prestige info; golden count shown under click power

    // Top-row (now left-bar) upgrades visibility: only show next upgrade after previous has at least 1 level
    const leftBar = document.getElementById('leftBar');
    const divineLeftBar = document.getElementById('divineLeftBar');
    // keep menuButtons visible at all times; only hide the normal leftBar list when in divineMode
    if (divineMode) {
        if (leftBar) leftBar.style.display = 'none';
        if (divineLeftBar) divineLeftBar.style.display = 'flex';
    } else {
        if (leftBar) leftBar.style.display = 'block';
        if (divineLeftBar) divineLeftBar.style.display = 'none';
    }
    // when normal menu is visible, update the visibility of individual upgrade buttons
    if (!divineMode) {
        document.getElementById('upgrade1').style.display = 'block';
        document.getElementById('upgrade2').style.display = (upgrade1Level >= 1) ? 'block' : 'none';
        document.getElementById('upgrade3').style.display = (upgrade2Level >= 1) ? 'block' : 'none';
        document.getElementById('upgrade4').style.display = (upgrade3Level >= 1) ? 'block' : 'none';
        document.getElementById('upgrade5').style.display = (upgrade4Level >= 1) ? 'block' : 'none';
        document.getElementById('upgrade6').style.display = (upgrade5Level >= 1) ? 'block' : 'none';
        document.getElementById('upgrade7').style.display = (upgrade6Level >= 1) ? 'block' : 'none';
        document.getElementById('upgrade8').style.display = (upgrade7Level >= 1) ? 'block' : 'none';
        document.getElementById('upgrade9').style.display = (upgrade8Level >= 1) ? 'block' : 'none';
        document.getElementById('upgrade10').style.display = (upgrade9Level >= 1) ? 'block' : 'none';
        document.getElementById('upgrade11').style.display = (upgrade10Level >= 1) ? 'block' : 'none';
        document.getElementById('upgrade12').style.display = (upgrade11Level >= 1) ? 'block' : 'none';
        document.getElementById('upgrade13').style.display = (numericLevel(upgrade12Level) >= 1) ? 'block' : 'none';
        document.getElementById('upgrade14').style.display = (upgrade13Level >= 1) ? 'block' : 'none';
        document.getElementById('upgrade15').style.display = (upgrade14Level >= 1) ? 'block' : 'none';
        // reveal ez villager (upgrade16) once What Happened Beats (upgrade15) is purchased
        try { document.getElementById('upgrade16').style.display = (upgrade15Level >= 1) ? 'block' : 'none'; } catch (e) {}
        try { document.getElementById('upgrade17').style.display = (upgrade16Level >= 1) ? 'block' : 'none'; } catch (e) {}
        try { document.getElementById('upgrade18').style.display = (upgrade17Level >= 1) ? 'block' : 'none'; } catch (e) {}
        try { document.getElementById('upgrade19').style.display = (upgrade18Level >= 1) ? 'block' : 'none'; } catch (e) {}
        try { document.getElementById('upgrade20').style.display = (upgrade19Level >= 1) ? 'block' : 'none'; } catch (e) {}
        try { document.getElementById('upgrade21').style.display = (upgrade20Level >= 1) ? 'block' : 'none'; } catch (e) {}
        try { document.getElementById('upgrade22').style.display = (upgrade21Level >= 1) ? 'block' : 'none'; } catch (e) {}
        try { document.getElementById('upgrade23').style.display = (upgrade22Level >= 1) ? 'block' : 'none'; } catch (e) {}
        try { document.getElementById('upgrade24').style.display = (upgrade23Level >= 1) ? 'block' : 'none'; } catch (e) {}
    }

    // prestige UI visibility (unlocked at CR lvl 150) - top-left button
    const prestigeTopBtn = document.getElementById('prestigeTopBtn');
    if (prestigeTopBtn) {
        prestigeTopBtn.style.display = (numericLevel(upgrade12Level) >= 150) ? 'block' : 'none';
        // compute potential awards from total levels to decide if prestige can be claimed
        let totalLevelsForUI = 0;
        for (let i = 1; i <= 23; i++) {
            try { totalLevelsForUI += numericLevel(getUpgradeLevel(i)); } catch (e) { }
        }
        const potentialAwards = Math.floor(totalLevelsForUI / LEVELS_PER_GOLDEN);
        // allow the button to be clickable; `buyPrestige()` will validate and alert if not eligible
        prestigeTopBtn.disabled = false;
    }
    // CR section prestige button (mirror of top-left prestige button)
    const prestigeBtnCr = document.getElementById('prestigeBtnCr');
    if (prestigeBtnCr) {
        prestigeBtnCr.style.display = (numericLevel(upgrade12Level) >= 150) ? 'block' : 'none';
        let totalLevelsForUI2 = 0;
        for (let i = 1; i <= 23; i++) {
            try { totalLevelsForUI2 += numericLevel(getUpgradeLevel(i)); } catch (e) { }
        }
        const potentialAwards2 = Math.floor(totalLevelsForUI2 / LEVELS_PER_GOLDEN);
        // allow the CR-section prestige button to be clickable as well
        prestigeBtnCr.disabled = false;
    }

    // Divine toggle button: visible only if player has at least one golden and not in divineMode
    // Auto-unlock divine if player has any golden what happeneds
    if (Number(goldenWhat || 0) >= 1) divineUnlocked = true;
    const divineMenuBtn = document.getElementById('divineMenuBtn');
    const normalMenuBtn = document.getElementById('normalMenuBtn');
    if (divineMenuBtn) divineMenuBtn.style.display = divineUnlocked ? 'inline-block' : 'none';
    if (normalMenuBtn) normalMenuBtn.style.display = 'inline-block';
    // shading to indicate active menu
    if (normalMenuBtn) {
        normalMenuBtn.style.background = divineMode ? '#222' : '#444';
        normalMenuBtn.style.color = divineMode ? '#ccc' : '#fff';
    }
    if (divineMenuBtn) {
        divineMenuBtn.style.background = divineMode ? '#444' : '#222';
        divineMenuBtn.style.color = divineMode ? '#fff' : '#ccc';
    }
    // also update clone buttons inside divineLeftBar if present
    const normalClone = document.getElementById('normalMenuBtn_clone');
    const divineClone = document.getElementById('divineMenuBtn_clone');
    if (normalClone) {
        normalClone.style.background = divineMode ? '#222' : '#444';
        normalClone.style.color = divineMode ? '#ccc' : '#fff';
    }
    if (divineClone) {
        divineClone.style.background = divineMode ? '#444' : '#222';
        divineClone.style.color = divineMode ? '#fff' : '#ccc';
    }

    // Divine Argonian button in divine menu (cost is in goldenWhat)
    const divineArgBtn = document.getElementById('divineArgonBtn');
    if (divineArgBtn) {
        // compute applied percent (base * 2^(level-1)) and next percent for display
        let appliedPercent = 0;
        let nextPercent = DIVINE_ARGON_BASE_PERCENT;
        if (divineArgonLevel > 0) {
            appliedPercent = DIVINE_ARGON_BASE_PERCENT * Math.pow(2, Math.max(0, divineArgonLevel - 1));
            nextPercent = DIVINE_ARGON_BASE_PERCENT * Math.pow(2, divineArgonLevel);
        } else {
            appliedPercent = 0;
            nextPercent = DIVINE_ARGON_BASE_PERCENT;
        }
        // build HTML label showing level, applied percent (if any), and next cost/percent
        let html = '';
        const imgHtml = `<img class="upgrade-img" src="mainimage/DivineArgonian.png" alt="Divine Argonian" height="40" width="40" style="vertical-align:middle;margin-right:8px;">`;
        if (divineArgonLevel > 0) {
            html = imgHtml + `<span class="upgrade-label">Divine Argonian — lvl ${divineArgonLevel} (+${formatNumber(appliedPercent)}% cps) — next: ${formatNumber(divineArgonCost)} golden (+${formatNumber(nextPercent)}% cps)</span>`;
        } else {
            html = imgHtml + `<span class="upgrade-label">Divine Argonian — cost: ${formatNumber(divineArgonCost)} golden (+${formatNumber(nextPercent)}% cps)</span>`;
        }
        divineArgBtn.innerHTML = html;
        // always show the divine button inside divine menu but disable if not affordable or locked
        divineArgBtn.style.display = 'block';
        try {
            const afford = !!goldenCanAfford(divineArgonCost);
            try { divineArgBtn.disabled = !afford; } catch (e) {}
            if (!divineArgBtn.disabled) {
                divineArgBtn.removeAttribute('disabled');
                divineArgBtn.style.pointerEvents = 'auto';
                divineArgBtn.style.opacity = '';
                divineArgBtn.tabIndex = 0;
            } else {
                try { divineArgBtn.setAttribute('disabled', 'true'); } catch (e) {}
                divineArgBtn.style.pointerEvents = 'auto';
                divineArgBtn.style.opacity = '0.6';
            }
        } catch (e) { divineArgBtn.disabled = false; }
    }

    // update golden count display under click power if present
    const goldenEl = document.getElementById('goldenCount');
    if (goldenEl) goldenEl.innerText = String(goldenWhat);
    // update stats UI if present
    try {
        const pEl = document.getElementById('statsPrestigeCount');
        const gEl = document.getElementById('statsTotalGolden');
            if (pEl) pEl.innerText = String(prestigeTimes);
            if (gEl) gEl.innerText = String(totalGoldenEver);
            const nEl = document.getElementById('statsNextPrestige');
            try { if (nEl) nEl.innerText = formatNumber(getPotentialPrestigeAwards()); } catch (e) { if (nEl) nEl.innerText = String(getPotentialPrestigeAwards()); }
            // critical click stats
            const cEl = document.getElementById('statsCritChance');
            const mEl = document.getElementById('statsCritMultiplier');
            try {
                const hasAssassin = (typeof divineAssassinLevel === 'number' && divineAssassinLevel > 0);
                const chance = hasAssassin ? Math.min(1, DIVINE_ASSASSIN_BASE_CHANCE * divineAssassinLevel) : 0;
                const critMult = (hasAssassin ? (10 * Math.pow(2, Math.max(0, (typeof divineSpiritLevel === 'number' ? divineSpiritLevel : 0) - 1))) : 0);
                if (cEl) cEl.innerText = `${(chance * 100).toFixed(2)}%`;
                if (mEl) mEl.innerText = `x${formatNumber(critMult)}`;
            } catch (e) {
                if (cEl) cEl.innerText = '0%';
                if (mEl) mEl.innerText = 'x0';
            }
    } catch (e) {}

    // removed quick-buy control wiring

    // refresh tooltip content if currently hovering an upgrade so values update live
    try {
        if (currentHoveredUpgradeId) {
            const tipEl = document.getElementById('upgrade-tooltip');
            if (tipEl && tipEl.style.display !== 'none') {
                tipEl.innerHTML = getTooltipHtmlForUpgrade(currentHoveredUpgradeId);
            }
        }
    } catch (e) {}

    // apply equipped shop image to main image (if set)
    try {
        const img = document.querySelector('.main-image');
        if (img && equippedShopImage) img.src = equippedShopImage;
        const preview = document.getElementById('shopPreviewImage');
        if (preview) preview.src = 'mainimage/whathappened.jpeg';
        // apply equipped background as well
        try { applyEquippedBackground(); } catch (e) {}
    } catch (e) {}
    // Special1: unlock when OP mouse reaches level 10
    // Sections visibility: show section header when first special unlocks
    const opSection = document.getElementById('opSection');
    if (opSection) opSection.style.display = (upgrade1Level >= 10) ? 'block' : 'none';
    const pirateSection = document.getElementById('pirateSection');
    if (pirateSection) pirateSection.style.display = (upgrade2Level >= 10) ? 'block' : 'none';
    const goonSection = document.getElementById('goonSection');
    if (goonSection) goonSection.style.display = (upgrade3Level >= 10) ? 'block' : 'none';
    const goatisSection = document.getElementById('goatisSection');
    if (goatisSection) goatisSection.style.display = (numericLevel(upgrade18Level) >= 1) ? 'block' : 'none';
    const scpSection = document.getElementById('scpSection');
    if (scpSection) scpSection.style.display = (numericLevel(upgrade17Level) >= 1) ? 'block' : 'none';
    const diddySection = document.getElementById('diddySection');
    if (diddySection) diddySection.style.display = (upgrade4Level >= 1) ? 'block' : 'none';
    // Argonian and Grape sections should be hidden until the corresponding upgrade is purchased (level >= 1)
    const argonSection = document.getElementById('argonSection');
    if (argonSection) argonSection.style.display = (upgrade5Level >= 1) ? 'block' : 'none';
    const grapeSection = document.getElementById('grapeSection');
    if (grapeSection) grapeSection.style.display = (upgrade6Level >= 1) ? 'block' : 'none';
    const skippieSection = document.getElementById('skippieSection');
    if (skippieSection) skippieSection.style.display = (upgrade7Level >= 1) ? 'block' : 'none';
    const islandSection = document.getElementById('islandSection');
    if (islandSection) islandSection.style.display = (upgrade8Level >= 1) ? 'block' : 'none';
    const tribalSection = document.getElementById('tribalSection');
    if (tribalSection) tribalSection.style.display = (upgrade9Level >= 1) ? 'block' : 'none';
    const phonkSection = document.getElementById('phonkSection');
    if (phonkSection) phonkSection.style.display = (upgrade10Level >= 1) ? 'block' : 'none';
    const jonathanSection = document.getElementById('jonathanSection');
    if (jonathanSection) jonathanSection.style.display = (upgrade11Level >= 10) ? 'block' : 'none';
    const crSection = document.getElementById('crSection');
    if (crSection) crSection.style.display = (numericLevel(upgrade12Level) >= 10) ? 'block' : 'none';

    // Ropingnecurse specials: unlock based on ropingnecurse (upgrade13Level)
    const ropingSection = document.getElementById('ropingSection');
    if (ropingSection) ropingSection.style.display = (upgrade13Level >= 10) ? 'block' : 'none';

    // Skibbidi Scimitar specials: unlock based on skibbidi scimitar (upgrade14Level)
    const skibbidiSection = document.getElementById('skibbidiSection');
    if (skibbidiSection) skibbidiSection.style.display = (upgrade14Level >= 10) ? 'block' : 'none';

    // Ropingnecurse specials buttons: unlock and purchase state handling
    const r1 = document.getElementById('roping1');
    if (r1) {
        if (!roping1Purchased && upgrade13Level >= 10) {
            r1.style.display = 'block';
            document.getElementById('roping1Cost').innerText = formatNumber(roping1Cost);
            r1.disabled = !canAfford(roping1Cost);
        } else if (roping1Purchased) {
            r1.style.display = 'block';
            r1.disabled = true;
            r1.innerText = `Purchased — roping x${roping1Multiplier}`;
        } else { r1.style.display = 'none'; }
    }

    const r2 = document.getElementById('roping2');
    if (r2) {
        if (!roping2Purchased && upgrade13Level >= 25) {
            r2.style.display = 'block';
            document.getElementById('roping2Cost').innerText = formatNumber(roping2Cost);
            r2.disabled = !canAfford(roping2Cost);
        } else if (roping2Purchased) {
            r2.style.display = 'block';
            r2.disabled = true;
            r2.innerText = `Purchased — roping x${roping2Multiplier}`;
        } else { r2.style.display = 'none'; }
    }

    const r3 = document.getElementById('roping3');
    if (r3) {
        if (!roping3Purchased && upgrade13Level >= 50) {
            r3.style.display = 'block';
            document.getElementById('roping3Cost').innerText = formatNumber(roping3Cost);
            r3.disabled = !canAfford(roping3Cost);
        } else if (roping3Purchased) {
            r3.style.display = 'block';
            r3.disabled = true;
            r3.innerText = `Purchased — roping x${roping3Multiplier}`;
        } else { r3.style.display = 'none'; }
    }

    const r4 = document.getElementById('roping4');
    if (r4) {
        if (!roping4Purchased && upgrade13Level >= 75) {
            r4.style.display = 'block';
            document.getElementById('roping4Cost').innerText = formatNumber(roping4Cost);
            r4.disabled = !canAfford(roping4Cost);
        } else if (roping4Purchased) {
            r4.style.display = 'block';
            r4.disabled = true;
            r4.innerText = `Purchased — roping x${roping4Multiplier}`;
        } else { r4.style.display = 'none'; }
    }

    const s1 = document.getElementById('skibidi1');
    if (s1) {
        if (!skibidi1Purchased && upgrade14Level >= 10) {
            s1.style.display = 'block';
            document.getElementById('skibidi1Cost').innerText = formatNumber(skibidi1Cost);
            s1.disabled = !canAfford(skibidi1Cost);
        } else if (skibidi1Purchased) {
            s1.style.display = 'block';
            s1.disabled = true;
            s1.innerText = `Purchased — skibbidi x${skibidi1Multiplier}`;
        } else { s1.style.display = 'none'; }
    }

    const s2 = document.getElementById('skibidi2');
    if (s2) {
        if (!skibidi2Purchased && upgrade14Level >= 25) {
            s2.style.display = 'block';
            document.getElementById('skibidi2Cost').innerText = formatNumber(skibidi2Cost);
            s2.disabled = !canAfford(skibidi2Cost);
        } else if (skibidi2Purchased) {
            s2.style.display = 'block';
            s2.disabled = true;
            s2.innerText = `Purchased — skibbidi x${skibidi2Multiplier}`;
        } else { s2.style.display = 'none'; }
    }

    const s3 = document.getElementById('skibidi3');
    if (s3) {
        if (!skibidi3Purchased && upgrade14Level >= 50) {
            s3.style.display = 'block';
            document.getElementById('skibidi3Cost').innerText = formatNumber(skibidi3Cost);
            s3.disabled = !canAfford(skibidi3Cost);
        } else if (skibidi3Purchased) {
            s3.style.display = 'block';
            s3.disabled = true;
            s3.innerText = `Purchased — skibbidi x${skibidi3Multiplier}`;
        } else { s3.style.display = 'none'; }
    }

    const s4 = document.getElementById('skibidi4');
    if (s4) {
        if (!skibidi4Purchased && upgrade14Level >= 75) {
            s4.style.display = 'block';
            document.getElementById('skibidi4Cost').innerText = formatNumber(skibidi4Cost);
            s4.disabled = !canAfford(skibidi4Cost);
        } else if (skibidi4Purchased) {
            s4.style.display = 'block';
            s4.disabled = true;
            s4.innerText = `Purchased — skibbidi x${skibidi4Multiplier}`;
        } else { s4.style.display = 'none'; }
    }

    // Beats specials UI handling
    const b1 = document.getElementById('beats1');
    if (b1) {
        if (!beats1Purchased && upgrade15Level >= 10) {
            b1.style.display = 'block';
            document.getElementById('beats1Cost').innerText = formatNumber(beats1Cost);
            b1.disabled = !canAfford(beats1Cost);
        } else if (beats1Purchased) {
            b1.style.display = 'block';
            b1.disabled = true;
            b1.innerText = `Purchased — beats x${beats1Multiplier}`;
        } else { b1.style.display = 'none'; }
    }

    const b2 = document.getElementById('beats2');
    if (b2) {
        if (!beats2Purchased && upgrade15Level >= 25) {
            b2.style.display = 'block';
            document.getElementById('beats2Cost').innerText = formatNumber(beats2Cost);
            b2.disabled = !canAfford(beats2Cost);
        } else if (beats2Purchased) {
            b2.style.display = 'block';
            b2.disabled = true;
            b2.innerText = `Purchased — beats x${beats2Multiplier}`;
        } else { b2.style.display = 'none'; }
    }

    const b3 = document.getElementById('beats3');
    if (b3) {
        if (!beats3Purchased && upgrade15Level >= 50) {
            b3.style.display = 'block';
            document.getElementById('beats3Cost').innerText = formatNumber(beats3Cost);
            b3.disabled = !canAfford(beats3Cost);
        } else if (beats3Purchased) {
            b3.style.display = 'block';
            b3.disabled = true;
            b3.innerText = `Purchased — beats x${beats3Multiplier}`;
        } else { b3.style.display = 'none'; }
    }

    // EZ specials UI handling
    const e1 = document.getElementById('ez1');
    if (e1) {
        if (!ez1Purchased && upgrade16Level >= 10) {
            e1.style.display = 'block';
            document.getElementById('ez1Cost').innerText = formatNumber(ez1Cost);
            e1.disabled = !canAfford(ez1Cost);
        } else if (ez1Purchased) {
            e1.style.display = 'block';
            e1.disabled = true;
            e1.innerText = `Purchased — ez x${ez1Multiplier}`;
        } else { e1.style.display = 'none'; }
    }

    const e2 = document.getElementById('ez2');
    if (e2) {
        if (!ez2Purchased && upgrade16Level >= 25) {
            e2.style.display = 'block';
            document.getElementById('ez2Cost').innerText = formatNumber(ez2Cost);
            e2.disabled = !canAfford(ez2Cost);
        } else if (ez2Purchased) {
            e2.style.display = 'block';
            e2.disabled = true;
            e2.innerText = `Purchased — ez x${ez2Multiplier}`;
        } else { e2.style.display = 'none'; }
    }

    const e3 = document.getElementById('ez3');
    if (e3) {
        if (!ez3Purchased && upgrade16Level >= 50) {
            e3.style.display = 'block';
            document.getElementById('ez3Cost').innerText = formatNumber(ez3Cost);
            e3.disabled = !canAfford(ez3Cost);
        } else if (ez3Purchased) {
            e3.style.display = 'block';
            e3.disabled = true;
            e3.innerText = `Purchased — click power x${ez3Multiplier}`;
        } else { e3.style.display = 'none'; }
    }

    const e4 = document.getElementById('ez4');
    if (e4) {
        if (!ez4Purchased && upgrade16Level >= 100) {
            e4.style.display = 'block';
            document.getElementById('ez4Cost').innerText = formatNumber(ez4Cost);
            e4.disabled = !canAfford(ez4Cost);
        } else if (ez4Purchased) {
            e4.style.display = 'block';
            e4.disabled = true;
            e4.innerText = `Purchased — ez x${ez4Multiplier}`;
        } else { e4.style.display = 'none'; }
    }

    // SCP specials: unlocks at SCP (upgrade17) levels 10/25/50/75
    const scpBtn1 = document.getElementById('scp1');
    if (scpBtn1) {
        if (!scp1Purchased && upgrade17Level >= 10) {
            scpBtn1.style.display = 'block';
            document.getElementById('scp1Cost').innerText = formatNumber(scp1Cost);
            scpBtn1.disabled = !canAfford(scp1Cost);
        } else if (scp1Purchased) {
            scpBtn1.style.display = 'block';
            scpBtn1.disabled = true;
            scpBtn1.innerText = `Purchased — other cps x2`;
        } else { scpBtn1.style.display = 'none'; }
    }

    const scpBtn2 = document.getElementById('scp2');
    if (scpBtn2) {
        if (!scp2Purchased && upgrade17Level >= 25) {
            scpBtn2.style.display = 'block';
            document.getElementById('scp2Cost').innerText = formatNumber(scp2Cost);
            scpBtn2.disabled = !canAfford(scp2Cost);
        } else if (scp2Purchased) {
            scpBtn2.style.display = 'block';
            scpBtn2.disabled = true;
            scpBtn2.innerText = `Purchased — other cps x2`;
        } else { scpBtn2.style.display = 'none'; }
    }

    const scpBtn3 = document.getElementById('scp3');
    if (scpBtn3) {
        if (!scp3Purchased && upgrade17Level >= 50) {
            scpBtn3.style.display = 'block';
            document.getElementById('scp3Cost').innerText = formatNumber(scp3Cost);
            scpBtn3.disabled = !canAfford(scp3Cost);
        } else if (scp3Purchased) {
            scpBtn3.style.display = 'block';
            scpBtn3.disabled = true;
            scpBtn3.innerText = `Purchased — other cps x2`;
        } else { scpBtn3.style.display = 'none'; }
    }

    const scpBtn4 = document.getElementById('scp4');
    if (scpBtn4) {
        if (!scp4Purchased && upgrade17Level >= 75) {
            scpBtn4.style.display = 'block';
            document.getElementById('scp4Cost').innerText = formatNumber(scp4Cost);
            scpBtn4.disabled = !canAfford(scp4Cost);
        } else if (scp4Purchased) {
            scpBtn4.style.display = 'block';
            scpBtn4.disabled = true;
            scpBtn4.innerText = `Purchased — total cps x2`;
        } else { scpBtn4.style.display = 'none'; }
    }

    // The Goatis specials: unlocks at The Goatis (upgrade18) levels 10/25/50/100
    const goatisBtn1 = document.getElementById('goatis1');
    if (goatisBtn1) {
        if (!goatis1Purchased && numericLevel(upgrade18Level) >= 10) {
            goatisBtn1.style.display = 'block';
            document.getElementById('goatis1Cost').innerText = formatNumber(goatis1Cost);
            goatisBtn1.disabled = !canAfford(goatis1Cost);
        } else if (goatis1Purchased) {
            goatisBtn1.style.display = 'block';
            goatisBtn1.disabled = true;
            goatisBtn1.innerText = `Purchased — The Goatis cps x${goatis1Multiplier}`;
        } else { goatisBtn1.style.display = 'none'; }
    }

    const goatisBtn2 = document.getElementById('goatis2');
    if (goatisBtn2) {
        if (!goatis2Purchased && numericLevel(upgrade18Level) >= 25) {
            goatisBtn2.style.display = 'block';
            document.getElementById('goatis2Cost').innerText = formatNumber(goatis2Cost);
            goatisBtn2.disabled = !canAfford(goatis2Cost);
        } else if (goatis2Purchased) {
            goatisBtn2.style.display = 'block';
            goatisBtn2.disabled = true;
            goatisBtn2.innerText = `Purchased — The Goatis cps x${goatis2Multiplier}`;
        } else { goatisBtn2.style.display = 'none'; }
    }

    const goatisBtn3 = document.getElementById('goatis3');
    if (goatisBtn3) {
        if (!goatis3Purchased && numericLevel(upgrade18Level) >= 50) {
            goatisBtn3.style.display = 'block';
            document.getElementById('goatis3Cost').innerText = formatNumber(goatis3Cost);
            goatisBtn3.disabled = !canAfford(goatis3Cost);
        } else if (goatis3Purchased) {
            goatisBtn3.style.display = 'block';
            goatisBtn3.disabled = true;
            goatisBtn3.innerText = `Purchased — The Goatis cps x${goatis3Multiplier}`;
        } else { goatisBtn3.style.display = 'none'; }
    }

    // The Landon Stream specials: unlocks at The Landon Stream (upgrade20) levels 10/25/50/100
    const landonBtn1 = document.getElementById('landon1');
    if (landonBtn1) {
        if (!landon1Purchased && numericLevel(upgrade20Level) >= 10) {
            landonBtn1.style.display = 'block';
            document.getElementById('landon1Cost').innerText = formatNumber(landon1Cost);
            landonBtn1.disabled = !canAfford(landon1Cost);
        } else if (landon1Purchased) {
            landonBtn1.style.display = 'block';
            landonBtn1.disabled = true;
            landonBtn1.innerText = `Purchased — The Landon Stream cps x${landon1Multiplier}`;
        } else { landonBtn1.style.display = 'none'; }
    }

    const landonBtn2 = document.getElementById('landon2');
    if (landonBtn2) {
        if (!landon2Purchased && numericLevel(upgrade20Level) >= 25) {
            landonBtn2.style.display = 'block';
            document.getElementById('landon2Cost').innerText = formatNumber(landon2Cost);
            landonBtn2.disabled = !canAfford(landon2Cost);
        } else if (landon2Purchased) {
            landonBtn2.style.display = 'block';
            landonBtn2.disabled = true;
            landonBtn2.innerText = `Purchased — The Landon Stream cps x${landon2Multiplier}`;
        } else { landonBtn2.style.display = 'none'; }
    }

    const landonBtn3 = document.getElementById('landon3');
    if (landonBtn3) {
        if (!landon3Purchased && numericLevel(upgrade20Level) >= 50) {
            landonBtn3.style.display = 'block';
            document.getElementById('landon3Cost').innerText = formatNumber(landon3Cost);
            landonBtn3.disabled = !canAfford(landon3Cost);
        } else if (landon3Purchased) {
            landonBtn3.style.display = 'block';
            landonBtn3.disabled = true;
            landonBtn3.innerText = `Purchased — The Landon Stream cps x${landon3Multiplier}`;
        } else { landonBtn3.style.display = 'none'; }
    }

    const landonBtn4 = document.getElementById('landon4');
    if (landonBtn4) {
        if (!landon4Purchased && numericLevel(upgrade20Level) >= 100) {
            landonBtn4.style.display = 'block';
            document.getElementById('landon4Cost').innerText = formatNumber(landon4Cost);
            landonBtn4.disabled = !canAfford(landon4Cost);
        } else if (landon4Purchased) {
            landonBtn4.style.display = 'block';
            landonBtn4.disabled = true;
            landonBtn4.innerText = `Purchased — The Landon Stream cps x${landon4Multiplier}`;
        } else { landonBtn4.style.display = 'none'; }
    }

    // The Bass specials (upgrade21)
    const theBassBtn1 = document.getElementById('theBass1');
    if (theBassBtn1) {
        if (!theBass1Purchased && numericLevel(upgrade21Level) >= 10) {
            theBassBtn1.style.display = 'block';
            document.getElementById('theBass1Cost').innerText = formatNumber(theBass1Cost);
            theBassBtn1.disabled = !canAfford(theBass1Cost);
        } else if (theBass1Purchased) {
            theBassBtn1.style.display = 'block';
            theBassBtn1.disabled = true;
            theBassBtn1.innerText = `Purchased — The Bass cps x${theBass1Multiplier}`;
        } else { theBassBtn1.style.display = 'none'; }
    }

    const theBassBtn2 = document.getElementById('theBass2');
    if (theBassBtn2) {
        if (!theBass2Purchased && numericLevel(upgrade21Level) >= 25) {
            theBassBtn2.style.display = 'block';
            document.getElementById('theBass2Cost').innerText = formatNumber(theBass2Cost);
            theBassBtn2.disabled = !canAfford(theBass2Cost);
        } else if (theBass2Purchased) {
            theBassBtn2.style.display = 'block';
            theBassBtn2.disabled = true;
            theBassBtn2.innerText = `Purchased — The Bass cps x${theBass2Multiplier}`;
        } else { theBassBtn2.style.display = 'none'; }
    }

    const theBassBtn3 = document.getElementById('theBass3');
    if (theBassBtn3) {
        if (!theBass3Purchased && numericLevel(upgrade21Level) >= 50) {
            theBassBtn3.style.display = 'block';
            document.getElementById('theBass3Cost').innerText = formatNumber(theBass3Cost);
            theBassBtn3.disabled = !canAfford(theBass3Cost);
        } else if (theBass3Purchased) {
            theBassBtn3.style.display = 'block';
            theBassBtn3.disabled = true;
            theBassBtn3.innerText = `Purchased — The Bass cps x${theBass3Multiplier}`;
        } else { theBassBtn3.style.display = 'none'; }
    }

    const theBassBtn4 = document.getElementById('theBass4');
    if (theBassBtn4) {
        if (!theBass4Purchased && numericLevel(upgrade21Level) >= 100) {
            theBassBtn4.style.display = 'block';
            document.getElementById('theBass4Cost').innerText = formatNumber(theBass4Cost);
            theBassBtn4.disabled = !canAfford(theBass4Cost);
        } else if (theBass4Purchased) {
            theBassBtn4.style.display = 'block';
            theBassBtn4.disabled = true;
            theBassBtn4.innerText = `Purchased — The Bass cps x${theBass4Multiplier}`;
        } else { theBassBtn4.style.display = 'none'; }
    }

    const goatisBtn4 = document.getElementById('goatis4');
    if (goatisBtn4) {
        if (!goatis4Purchased && numericLevel(upgrade18Level) >= 100) {
            goatisBtn4.style.display = 'block';
            document.getElementById('goatis4Cost').innerText = formatNumber(goatis4Cost);
            goatisBtn4.disabled = !canAfford(goatis4Cost);
        } else if (goatis4Purchased) {
            goatisBtn4.style.display = 'block';
            goatisBtn4.disabled = true;
            goatisBtn4.innerText = `Purchased — The Goatis cps x${goatis4Multiplier}`;
        } else { goatisBtn4.style.display = 'none'; }
    }

    // Raw liver specials (upgrade19)
    const rawBtn1 = document.getElementById('raw1');
    if (rawBtn1) {
        if (!raw1Purchased && numericLevel(upgrade19Level) >= 10) {
            rawBtn1.style.display = 'block';
            document.getElementById('raw1Cost').innerText = formatNumber(raw1Cost);
            rawBtn1.disabled = !canAfford(raw1Cost);
        } else if (raw1Purchased) {
            rawBtn1.style.display = 'block';
            rawBtn1.disabled = true;
            rawBtn1.innerText = `Purchased — raw cps x${raw1Multiplier}`;
        } else { rawBtn1.style.display = 'none'; }
    }

    const rawBtn2 = document.getElementById('raw2');
    if (rawBtn2) {
        if (!raw2Purchased && numericLevel(upgrade19Level) >= 25) {
            rawBtn2.style.display = 'block';
            document.getElementById('raw2Cost').innerText = formatNumber(raw2Cost);
            rawBtn2.disabled = !canAfford(raw2Cost);
        } else if (raw2Purchased) {
            rawBtn2.style.display = 'block';
            rawBtn2.disabled = true;
            rawBtn2.innerText = `Purchased — raw cps x${raw2Multiplier}`;
        } else { rawBtn2.style.display = 'none'; }
    }

    const rawBtn3 = document.getElementById('raw3');
    if (rawBtn3) {
        if (!raw3Purchased && numericLevel(upgrade19Level) >= 50) {
            rawBtn3.style.display = 'block';
            document.getElementById('raw3Cost').innerText = formatNumber(raw3Cost);
            rawBtn3.disabled = !canAfford(raw3Cost);
        } else if (raw3Purchased) {
            rawBtn3.style.display = 'block';
            rawBtn3.disabled = true;
            rawBtn3.innerText = `Purchased — raw cps x${raw3Multiplier}`;
        } else { rawBtn3.style.display = 'none'; }
    }

    const rawBtn4 = document.getElementById('raw4');
    if (rawBtn4) {
        if (!raw4Purchased && numericLevel(upgrade19Level) >= 100) {
            rawBtn4.style.display = 'block';
            document.getElementById('raw4Cost').innerText = formatNumber(raw4Cost);
            rawBtn4.disabled = !canAfford(raw4Cost);
        } else if (raw4Purchased) {
            rawBtn4.style.display = 'block';
            rawBtn4.disabled = true;
            rawBtn4.innerText = `Purchased — raw cps x${raw4Multiplier}`;
        } else { rawBtn4.style.display = 'none'; }
    }

    const specialBtn1 = document.getElementById('special1');
    if (!special1Purchased && upgrade1Level >= 10) {
        specialBtn1.style.display = 'block';
        document.getElementById('special1Cost').innerText = formatNumber(special1Cost);
        specialBtn1.disabled = count < special1Cost;
    } else if (special1Purchased) {
        specialBtn1.style.display = 'block';
        specialBtn1.disabled = true;
        specialBtn1.innerText = `Purchased — click power x${special1Multiplier}`;
    } else {
        specialBtn1.style.display = 'none';
    }

    // ensure section toggle arrows reflect open/closed state
    const opToggle = document.getElementById('opToggle');
    if (opToggle && opSection) opToggle.innerText = opSection.classList && opSection.classList.contains('open') ? 'OP Specials ▴' : 'OP Specials ▾';

    // Special2: unlock at OP mouse level 25 (x2 cps)
    const specialBtn2 = document.getElementById('special2');
    if (!special2Purchased && upgrade1Level >= 25) {
        specialBtn2.style.display = 'block';
        document.getElementById('special2Cost').innerText = formatNumber(special2Cost);
        specialBtn2.disabled = count < special2Cost;
    } else if (special2Purchased) {
        specialBtn2.style.display = 'block';
        specialBtn2.disabled = true;
        specialBtn2.innerText = `Purchased — click power x${special2Multiplier}`;
    } else {
        specialBtn2.style.display = 'none';
    }

    // Special3: unlock at OP mouse level 50 (x2 cps)
    const specialBtn3 = document.getElementById('special3');
    if (!special3Purchased && upgrade1Level >= 50) {
        specialBtn3.style.display = 'block';
        document.getElementById('special3Cost').innerText = formatNumber(special3Cost);
        specialBtn3.disabled = count < special3Cost;
    } else if (special3Purchased) {
        specialBtn3.style.display = 'block';
        specialBtn3.disabled = true;
        specialBtn3.innerText = `Purchased — click power x${special3Multiplier}`;
    } else {
        specialBtn3.style.display = 'none';
    }

    // Special4: unlock at OP mouse level 100 (x2.5 cps)
    const specialBtn4 = document.getElementById('special4');
    if (!special4Purchased && upgrade1Level >= 100) {
        specialBtn4.style.display = 'block';
        document.getElementById('special4Cost').innerText = formatNumber(special4Cost);
        specialBtn4.disabled = count < special4Cost;
    } else if (special4Purchased) {
        specialBtn4.style.display = 'block';
        specialBtn4.disabled = true;
        specialBtn4.innerText = `Purchased — click power x${special4Multiplier}`;
    } else {
        specialBtn4.style.display = 'none';
    }

    // Special5: unlock at OP mouse level 150 (x3 cps)
    const specialBtn5 = document.getElementById('special5');
    if (!special5Purchased && upgrade1Level >= 150) {
        specialBtn5.style.display = 'block';
        document.getElementById('special5Cost').innerText = formatNumber(special5Cost);
        specialBtn5.disabled = count < special5Cost;
    } else if (special5Purchased) {
        specialBtn5.style.display = 'block';
        specialBtn5.disabled = true;
        specialBtn5.innerText = `Purchased — click power x${special5Multiplier}`;
    } else {
        specialBtn5.style.display = 'none';
    }

    // Special6: unlock at OP mouse level 200 (x3.5 cps)
    const specialBtn6 = document.getElementById('special6');
    if (specialBtn6) {
        if (!special6Purchased && upgrade1Level >= 200) {
            specialBtn6.style.display = 'block';
            document.getElementById('special6Cost').innerText = formatNumber(special6Cost);
            specialBtn6.disabled = count < special6Cost;
        } else if (special6Purchased) {
            specialBtn6.style.display = 'block';
            specialBtn6.disabled = true;
            specialBtn6.innerText = `Purchased — click power x${special6Multiplier}`;
        } else { specialBtn6.style.display = 'none'; }
    }

    // Special7: unlock at OP mouse level 250 (x3.5 cps)
    const specialBtn7 = document.getElementById('special7');
    if (specialBtn7) {
        if (!special7Purchased && upgrade1Level >= 250) {
            specialBtn7.style.display = 'block';
            document.getElementById('special7Cost').innerText = formatNumber(special7Cost);
            specialBtn7.disabled = count < special7Cost;
        } else if (special7Purchased) {
            specialBtn7.style.display = 'block';
            specialBtn7.disabled = true;
            specialBtn7.innerText = `Purchased — click power x${special7Multiplier}`;
        } else { specialBtn7.style.display = 'none'; }
    }

    // Special8: unlock at OP mouse level 300 (x4 cps)
    const specialBtn8 = document.getElementById('special8');
    if (specialBtn8) {
        if (!special8Purchased && upgrade1Level >= 300) {
            specialBtn8.style.display = 'block';
            document.getElementById('special8Cost').innerText = formatNumber(special8Cost);
            specialBtn8.disabled = count < special8Cost;
        } else if (special8Purchased) {
            specialBtn8.style.display = 'block';
            specialBtn8.disabled = true;
            specialBtn8.innerText = `Purchased — click power x${special8Multiplier}`;
        } else { specialBtn8.style.display = 'none'; }
    }

    // Pirate section arrow
    const pirateToggle = document.getElementById('pirateToggle');
    if (pirateToggle && pirateSection) pirateToggle.innerText = pirateSection.classList && pirateSection.classList.contains('open') ? 'Pirate Specials ▴' : 'Pirate Specials ▾';

    // Pirate specials: unlock based on Somalian Pirate (upgrade2Level)
    const pbtn1 = document.getElementById('pirate1');
    if (!pirateSpec1Purchased && upgrade2Level >= 10) {
        pbtn1.style.display = 'block';
        document.getElementById('pirate1Cost').innerText = formatNumber(pirateSpec1Cost);
        pbtn1.disabled = count < pirateSpec1Cost;
    } else if (pirateSpec1Purchased) {
        pbtn1.style.display = 'block';
        pbtn1.disabled = true;
        pbtn1.innerText = `Purchased — Pirate cps x${pirateSpec1Multiplier}`;
    } else { pbtn1.style.display = 'none'; }

    const pbtn2 = document.getElementById('pirate2');
    if (!pirateSpec2Purchased && upgrade2Level >= 25) {
        pbtn2.style.display = 'block';
        document.getElementById('pirate2Cost').innerText = formatNumber(pirateSpec2Cost);
        pbtn2.disabled = count < pirateSpec2Cost;
    } else if (pirateSpec2Purchased) {
        pbtn2.style.display = 'block';
        pbtn2.disabled = true;
        pbtn2.innerText = `Purchased — Pirate cps x${pirateSpec2Multiplier}`;
    } else { pbtn2.style.display = 'none'; }

    const pbtn3 = document.getElementById('pirate3');
    if (!pirateSpec3Purchased && upgrade2Level >= 50) {
        pbtn3.style.display = 'block';
        document.getElementById('pirate3Cost').innerText = formatNumber(pirateSpec3Cost);
        pbtn3.disabled = count < pirateSpec3Cost;
    } else if (pirateSpec3Purchased) {
        pbtn3.style.display = 'block';
        pbtn3.disabled = true;
        pbtn3.innerText = `Purchased — Pirate cps x${pirateSpec3Multiplier}`;
    } else { pbtn3.style.display = 'none'; }

    const pbtn4 = document.getElementById('pirate4');
    if (!pirateSpec4Purchased && upgrade2Level >= 100) {
        pbtn4.style.display = 'block';
        document.getElementById('pirate4Cost').innerText = formatNumber(pirateSpec4Cost);
        pbtn4.disabled = count < pirateSpec4Cost;
    } else if (pirateSpec4Purchased) {
        pbtn4.style.display = 'block';
        pbtn4.disabled = true;
        pbtn4.innerText = `Purchased — Pirate cps x${pirateSpec4Multiplier}`;
    } else { pbtn4.style.display = 'none'; }

    // ensure pirate section content arrow reflects state (handled after pirate buttons)

    // Goonsaw specials: unlock based on Goonsaw (upgrade3Level)
    const gbtn1 = document.getElementById('goon1');
    if (!goonSpec1Purchased && upgrade3Level >= 10) {
        gbtn1.style.display = 'block';
        document.getElementById('goon1Cost').innerText = formatNumber(goonSpec1Cost);
        gbtn1.disabled = count < goonSpec1Cost;
    } else if (goonSpec1Purchased) {
        gbtn1.style.display = 'block';
        gbtn1.disabled = true;
        gbtn1.innerText = `Purchased — Goonsaw cps x${goonSpec1Multiplier}`;
    } else { gbtn1.style.display = 'none'; }

    const gbtn2 = document.getElementById('goon2');
    if (!goonSpec2Purchased && upgrade3Level >= 25) {
        gbtn2.style.display = 'block';
        document.getElementById('goon2Cost').innerText = formatNumber(goonSpec2Cost);
        gbtn2.disabled = count < goonSpec2Cost;
    } else if (goonSpec2Purchased) {
        gbtn2.style.display = 'block';
        gbtn2.disabled = true;
        gbtn2.innerText = `Purchased — Goonsaw cps x${goonSpec2Multiplier}`;
    } else { gbtn2.style.display = 'none'; }

    const gbtn3 = document.getElementById('goon3');
    if (!goonSpec3Purchased && upgrade3Level >= 50) {
        gbtn3.style.display = 'block';
        document.getElementById('goon3Cost').innerText = formatNumber(goonSpec3Cost);
        gbtn3.disabled = count < goonSpec3Cost;
    } else if (goonSpec3Purchased) {
        gbtn3.style.display = 'block';
        gbtn3.disabled = true;
        gbtn3.innerText = `Purchased — Goonsaw cps x${goonSpec3Multiplier}`;
    } else { gbtn3.style.display = 'none'; }

    const gbtn4 = document.getElementById('goon4');
    if (!goonSpec4Purchased && upgrade3Level >= 100) {
        gbtn4.style.display = 'block';
        document.getElementById('goon4Cost').innerText = formatNumber(goonSpec4Cost);
        gbtn4.disabled = count < goonSpec4Cost;
    } else if (goonSpec4Purchased) {
        gbtn4.style.display = 'block';
        gbtn4.disabled = true;
        gbtn4.innerText = `Purchased — Goonsaw cps x${goonSpec4Multiplier}`;
    } else { gbtn4.style.display = 'none'; }

    const goonToggle = document.getElementById('goonToggle');
    if (goonToggle && goonSection) goonToggle.innerText = goonSection.classList && goonSection.classList.contains('open') ? 'Goonsaw Specials ▴' : 'Goonsaw Specials ▾';

    // Diddy Blud specials: unlock based on Diddy (upgrade4Level)
    var diddyLevel = upgrade4Level;
    const dbtn1 = document.getElementById('diddy1');
    if (!diddy1Purchased && diddyLevel >= 10) {
        dbtn1.style.display = 'block';
        document.getElementById('diddy1Cost').innerText = formatNumber(diddy1Cost);
        dbtn1.disabled = count < diddy1Cost;
    } else if (diddy1Purchased) {
        dbtn1.style.display = 'block';
        dbtn1.disabled = true;
        dbtn1.innerText = `Purchased — Diddy +50 cps`;
    } else { dbtn1.style.display = 'none'; }

    const dbtn2 = document.getElementById('diddy2');
    if (!diddy2Purchased && diddyLevel >= 25) {
        dbtn2.style.display = 'block';
        document.getElementById('diddy2Cost').innerText = formatNumber(diddy2Cost);
        dbtn2.disabled = count < diddy2Cost;
    } else if (diddy2Purchased) {
        dbtn2.style.display = 'block';
        dbtn2.disabled = true;
        dbtn2.innerText = `Purchased — other cps x2`;
    } else { dbtn2.style.display = 'none'; }

    const dbtn3 = document.getElementById('diddy3');
    if (!diddy3Purchased && diddyLevel >= 50) {
        dbtn3.style.display = 'block';
        document.getElementById('diddy3Cost').innerText = formatNumber(diddy3Cost);
        dbtn3.disabled = count < diddy3Cost;
    } else if (diddy3Purchased) {
        dbtn3.style.display = 'block';
        dbtn3.disabled = true;
        dbtn3.innerText = `Purchased — click power x1.5`;
    } else { dbtn3.style.display = 'none'; }

    const dbtn4 = document.getElementById('diddy4');
    if (!diddy4Purchased && diddyLevel >= 100) {
        dbtn4.style.display = 'block';
        document.getElementById('diddy4Cost').innerText = formatNumber(diddy4Cost);
        dbtn4.disabled = count < diddy4Cost;
    } else if (diddy4Purchased) {
        dbtn4.style.display = 'block';
        dbtn4.disabled = true;
        dbtn4.innerText = `Purchased — total cps x1.25`;
    } else { dbtn4.style.display = 'none'; }

    const diddyToggle = document.getElementById('diddyToggle');
    if (diddyToggle && diddySection) diddyToggle.innerText = diddySection.classList && diddySection.classList.contains('open') ? 'Diddy Blud Specials ▴' : 'Diddy Blud Specials ▾';

    // Argonian specials: unlock based on Argonian (upgrade5Level)
    const argonLevel = upgrade5Level;
    const abtn1 = document.getElementById('argon1');
    if (!argon1Purchased && argonLevel >= 10) {
        abtn1.style.display = 'block';
        document.getElementById('argon1Cost').innerText = formatNumber(argon1Cost);
        abtn1.disabled = count < argon1Cost;
    } else if (argon1Purchased) {
        abtn1.style.display = 'block';
        abtn1.disabled = true;
        abtn1.innerText = `Purchased — click power x${argon1Multiplier}`;
    } else { abtn1.style.display = 'none'; }

    const abtn2 = document.getElementById('argon2');
    if (!argon2Purchased && argonLevel >= 25) {
        abtn2.style.display = 'block';
        document.getElementById('argon2Cost').innerText = formatNumber(argon2Cost);
        abtn2.disabled = count < argon2Cost;
    } else if (argon2Purchased) {
        abtn2.style.display = 'block';
        abtn2.disabled = true;
        abtn2.innerText = `Purchased — other cps x${argon2Multiplier}`;
    } else { abtn2.style.display = 'none'; }

    const abtn3 = document.getElementById('argon3');
    if (!argon3Purchased && argonLevel >= 50) {
        abtn3.style.display = 'block';
        document.getElementById('argon3Cost').innerText = formatNumber(argon3Cost);
        abtn3.disabled = count < argon3Cost;
    } else if (argon3Purchased) {
        abtn3.style.display = 'block';
        abtn3.disabled = true;
        abtn3.innerText = `Purchased — click power x${argon3Multiplier}`;
    } else { abtn3.style.display = 'none'; }

    const abtn4 = document.getElementById('argon4');
    if (!argon4Purchased && argonLevel >= 100) {
        abtn4.style.display = 'block';
        document.getElementById('argon4Cost').innerText = formatNumber(argon4Cost);
        abtn4.disabled = count < argon4Cost;
    } else if (argon4Purchased) {
        abtn4.style.display = 'block';
        abtn4.disabled = true;
        abtn4.innerText = `Purchased — total cps x${argon4Multiplier}`;
    } else { abtn4.style.display = 'none'; }

    const argonToggle = document.getElementById('argonToggle');
    if (argonToggle && argonSection) argonToggle.innerText = argonSection.classList && argonSection.classList.contains('open') ? 'Argonian Specials ▴' : 'Argonian Specials ▾';

    // Grape specials: unlock based on Grape (upgrade6Level)
    const grapeLevel = upgrade6Level;
    const grbtn1 = document.getElementById('grape1');
    if (!grape1Purchased && grapeLevel >= 1) {
        grbtn1.style.display = 'block';
        document.getElementById('grape1Cost').innerText = formatNumber(grape1Cost);
        grbtn1.disabled = count < grape1Cost;
    } else if (grape1Purchased) {
        grbtn1.style.display = 'block';
        grbtn1.disabled = true;
        grbtn1.innerText = `Purchased — +1000 other cps`;
    } else { grbtn1.style.display = 'none'; }

    const grbtn2 = document.getElementById('grape2');
    if (!grape2Purchased && grapeLevel >= 5) {
        grbtn2.style.display = 'block';
        document.getElementById('grape2Cost').innerText = formatNumber(grape2Cost);
        grbtn2.disabled = count < grape2Cost;
    } else if (grape2Purchased) {
        grbtn2.style.display = 'block';
        grbtn2.disabled = true;
        grbtn2.innerText = `Purchased — other cps x${grape2Multiplier}`;
    } else { grbtn2.style.display = 'none'; }

    const grbtn3 = document.getElementById('grape3');
    if (!grape3Purchased && grapeLevel >= 10) {
        grbtn3.style.display = 'block';
        document.getElementById('grape3Cost').innerText = formatNumber(grape3Cost);
        grbtn3.disabled = count < grape3Cost;
    } else if (grape3Purchased) {
        grbtn3.style.display = 'block';
        grbtn3.disabled = true;
        grbtn3.innerText = `Purchased — click power x${grape3Multiplier}`;
    } else { grbtn3.style.display = 'none'; }

    const grbtn4 = document.getElementById('grape4');
    if (!grape4Purchased && grapeLevel >= 20) {
        grbtn4.style.display = 'block';
        document.getElementById('grape4Cost').innerText = formatNumber(grape4Cost);
        grbtn4.disabled = count < grape4Cost;
    } else if (grape4Purchased) {
        grbtn4.style.display = 'block';
        grbtn4.disabled = true;
        grbtn4.innerText = `Purchased — total cps x${grape4Multiplier}`;
    } else { grbtn4.style.display = 'none'; }

    // Skippie specials: unlock based on Skippie (upgrade7Level)
    const sbtn1 = document.getElementById('skippie1');
    if (!skippie1Purchased && upgrade7Level >= 10) {
        sbtn1.style.display = 'block';
        document.getElementById('skippie1Cost').innerText = formatNumber(skippie1Cost);
        sbtn1.disabled = count < skippie1Cost;
    } else if (skippie1Purchased) {
        sbtn1.style.display = 'block';
        sbtn1.disabled = true;
        sbtn1.innerText = `Purchased — +5000 other cps`;
    } else { sbtn1.style.display = 'none'; }

    const sbtn2 = document.getElementById('skippie2');
    if (!skippie2Purchased && upgrade7Level >= 25) {
        sbtn2.style.display = 'block';
        document.getElementById('skippie2Cost').innerText = formatNumber(skippie2Cost);
        sbtn2.disabled = count < skippie2Cost;
    } else if (skippie2Purchased) {
        sbtn2.style.display = 'block';
        sbtn2.disabled = true;
        sbtn2.innerText = `Purchased — other cps x${skippie2Multiplier}`;
    } else { sbtn2.style.display = 'none'; }

    const sbtn3 = document.getElementById('skippie3');
    if (!skippie3Purchased && upgrade7Level >= 50) {
        sbtn3.style.display = 'block';
        document.getElementById('skippie3Cost').innerText = formatNumber(skippie3Cost);
        sbtn3.disabled = count < skippie3Cost;
    } else if (skippie3Purchased) {
        sbtn3.style.display = 'block';
        sbtn3.disabled = true;
        sbtn3.innerText = `Purchased — click power x${skippie3Multiplier}`;
    } else { sbtn3.style.display = 'none'; }

    const sbtn4 = document.getElementById('skippie4');
    if (!skippie4Purchased && upgrade7Level >= 100) {
        sbtn4.style.display = 'block';
        document.getElementById('skippie4Cost').innerText = formatNumber(skippie4Cost);
        sbtn4.disabled = count < skippie4Cost;
    } else if (skippie4Purchased) {
        sbtn4.style.display = 'block';
        sbtn4.disabled = true;
        sbtn4.innerText = `Purchased — total cps x${skippie4Multiplier}`;
    } else { sbtn4.style.display = 'none'; }

    // Island specials: unlock based on Mysterious Island (upgrade8Level)
    const ibtn1 = document.getElementById('island1');
    if (!island1Purchased && upgrade8Level >= 10) {
        ibtn1.style.display = 'block';
        document.getElementById('island1Cost').innerText = formatNumber(island1Cost);
        ibtn1.disabled = count < island1Cost;
    } else if (island1Purchased) {
        ibtn1.style.display = 'block';
        ibtn1.disabled = true;
        ibtn1.innerText = `Purchased — +50000 other cps`;
    } else { ibtn1.style.display = 'none'; }

    const ibtn2 = document.getElementById('island2');
    if (!island2Purchased && upgrade8Level >= 25) {
        ibtn2.style.display = 'block';
        document.getElementById('island2Cost').innerText = formatNumber(island2Cost);
        ibtn2.disabled = count < island2Cost;
    } else if (island2Purchased) {
        ibtn2.style.display = 'block';
        ibtn2.disabled = true;
        ibtn2.innerText = `Purchased — other cps x${island2Multiplier}`;
    } else { ibtn2.style.display = 'none'; }

    const ibtn3 = document.getElementById('island3');
    if (!island3Purchased && upgrade8Level >= 50) {
        ibtn3.style.display = 'block';
        document.getElementById('island3Cost').innerText = formatNumber(island3Cost);
        ibtn3.disabled = count < island3Cost;
    } else if (island3Purchased) {
        ibtn3.style.display = 'block';
        ibtn3.disabled = true;
        ibtn3.innerText = `Purchased — click power x${island3Multiplier}`;
    } else { ibtn3.style.display = 'none'; }

    const ibtn4 = document.getElementById('island4');
    if (!island4Purchased && upgrade8Level >= 100) {
        ibtn4.style.display = 'block';
        document.getElementById('island4Cost').innerText = formatNumber(island4Cost);
        ibtn4.disabled = count < island4Cost;
    } else if (island4Purchased) {
        ibtn4.style.display = 'block';
        ibtn4.disabled = true;
        ibtn4.innerText = `Purchased — total cps x${island4Multiplier}`;
    } else { ibtn4.style.display = 'none'; }

    // Phonk specials: unlock based on Phonk Man (upgrade10Level)
    const p1 = document.getElementById('phonk1');
    if (p1) {
        const c1 = (typeof phonk1Cost !== 'undefined' && Number(phonk1Cost)) ? Number(phonk1Cost) : Number((document.getElementById('phonk1Cost')||{}).innerText.replace(/[^0-9]/g,'')) || 10000000;
        if (!phonk1Purchased && upgrade10Level >= 10) {
            p1.style.display = 'block';
            document.getElementById('phonk1Cost').innerText = formatNumber(c1);
            p1.disabled = count < c1;
        } else if (phonk1Purchased) {
            p1.style.display = 'block';
            p1.disabled = true;
            p1.innerText = `Purchased — total cps x${phonk1Multiplier}`;
        } else { p1.style.display = 'none'; }
    }

    const p2 = document.getElementById('phonk2');
    if (p2) {
        const c2 = (typeof phonk2Cost !== 'undefined' && Number(phonk2Cost)) ? Number(phonk2Cost) : Number((document.getElementById('phonk2Cost')||{}).innerText.replace(/[^0-9]/g,'')) || 40000000;
        if (!phonk2Purchased && upgrade10Level >= 25) {
            p2.style.display = 'block';
            document.getElementById('phonk2Cost').innerText = formatNumber(c2);
            p2.disabled = count < c2;
        } else if (phonk2Purchased) {
            p2.style.display = 'block';
            p2.disabled = true;
            p2.innerText = `Purchased — total cps x${phonk2Multiplier}`;
        } else { p2.style.display = 'none'; }
    }

    const p3 = document.getElementById('phonk3');
    if (p3) {
        const c3 = (typeof phonk3Cost !== 'undefined' && Number(phonk3Cost)) ? Number(phonk3Cost) : Number((document.getElementById('phonk3Cost')||{}).innerText.replace(/[^0-9]/g,'')) || 200000000;
        if (!phonk3Purchased && upgrade10Level >= 50) {
            p3.style.display = 'block';
            document.getElementById('phonk3Cost').innerText = formatNumber(c3);
            p3.disabled = count < c3;
        } else if (phonk3Purchased) {
            p3.style.display = 'block';
            p3.disabled = true;
            p3.innerText = `Purchased — total cps x${phonk3Multiplier}`;
        } else { p3.style.display = 'none'; }
    }

    const p4 = document.getElementById('phonk4');
    if (p4) {
        const c4 = (typeof phonk4Cost !== 'undefined' && Number(phonk4Cost)) ? Number(phonk4Cost) : Number((document.getElementById('phonk4Cost')||{}).innerText.replace(/[^0-9]/g,'')) || 1000000000;
        if (!phonk4Purchased && upgrade10Level >= 75) {
            p4.style.display = 'block';
            document.getElementById('phonk4Cost').innerText = formatNumber(c4);
            p4.disabled = count < c4;
        } else if (phonk4Purchased) {
            p4.style.display = 'block';
            p4.disabled = true;
            p4.innerText = `Purchased — Phonk cps x${phonk4Multiplier}`;
        } else { p4.style.display = 'none'; }
    }

    const p5 = document.getElementById('phonk5');
    if (p5) {
        const c5 = (typeof phonk5Cost !== 'undefined' && Number(phonk5Cost)) ? Number(phonk5Cost) : Number((document.getElementById('phonk5Cost')||{}).innerText.replace(/[^0-9]/g,'')) || 5000000000;
        if (!phonk5Purchased && upgrade10Level >= 100) {
            p5.style.display = 'block';
            document.getElementById('phonk5Cost').innerText = formatNumber(c5);
            p5.disabled = count < c5;
        } else if (phonk5Purchased) {
            p5.style.display = 'block';
            p5.disabled = true;
            p5.innerText = `Purchased — total cps x${phonk5Multiplier}`;
        } else { p5.style.display = 'none'; }
    }

    // Jonathan specials: unlock based on Jonathan (upgrade11Level)
    const j1 = document.getElementById('jonathan1');
    if (j1) {
        const jc1 = (typeof jonathan1Cost !== 'undefined') ? Number(jonathan1Cost) : 100000000;
        if (!jonathan1Purchased && upgrade11Level >= 10) {
            j1.style.display = 'block';
            document.getElementById('jonathan1Cost').innerText = formatNumber(jc1);
            j1.disabled = count < jc1;
        } else if (jonathan1Purchased) {
            j1.style.display = 'block';
            j1.disabled = true;
            j1.innerText = `Purchased — Jonathan cps x${jonathan1Multiplier}`;
        } else { j1.style.display = 'none'; }
    }

    const j2 = document.getElementById('jonathan2');
    if (j2) {
        const jc2 = (typeof jonathan2Cost !== 'undefined') ? Number(jonathan2Cost) : 400000000;
        if (!jonathan2Purchased && upgrade11Level >= 25) {
            j2.style.display = 'block';
            document.getElementById('jonathan2Cost').innerText = formatNumber(jc2);
            j2.disabled = count < jc2;
        } else if (jonathan2Purchased) {
            j2.style.display = 'block';
            j2.disabled = true;
            j2.innerText = `Purchased — Jonathan cps x${jonathan2Multiplier}`;
        } else { j2.style.display = 'none'; }
    }

    const j3 = document.getElementById('jonathan3');
    if (j3) {
        const jc3 = (typeof jonathan3Cost !== 'undefined') ? Number(jonathan3Cost) : 2000000000;
        if (!jonathan3Purchased && upgrade11Level >= 50) {
            j3.style.display = 'block';
            document.getElementById('jonathan3Cost').innerText = formatNumber(jc3);
            j3.disabled = count < jc3;
        } else if (jonathan3Purchased) {
            j3.style.display = 'block';
            j3.disabled = true;
            j3.innerText = `Purchased — click power x${jonathan3Multiplier}`;
        } else { j3.style.display = 'none'; }
    }

    const j4 = document.getElementById('jonathan4');
    if (j4) {
        const jc4 = (typeof jonathan4Cost !== 'undefined') ? Number(jonathan4Cost) : 10000000000;
        if (!jonathan4Purchased && upgrade11Level >= 75) {
            j4.style.display = 'block';
            document.getElementById('jonathan4Cost').innerText = formatNumber(jc4);
            j4.disabled = count < jc4;
        } else if (jonathan4Purchased) {
            j4.style.display = 'block';
            j4.disabled = true;
            j4.innerText = `Purchased — Jonathan cps x${jonathan4Multiplier}`;
        } else { j4.style.display = 'none'; }
    }

    // CR Lurker specials: unlock based on CR (upgrade12Level)
    const c1 = document.getElementById('cr1');
    if (c1) {
        const cc1 = (typeof cr1Cost !== 'undefined') ? Number(cr1Cost) : 200000000;
        if (!cr1Purchased && numericLevel(upgrade12Level) >= 10) {
            c1.style.display = 'block';
            document.getElementById('cr1Cost').innerText = formatNumber(cc1);
            c1.disabled = count < cc1;
        } else if (cr1Purchased) {
            c1.style.display = 'block';
            c1.disabled = true;
            c1.innerText = `Purchased — CR cps x${cr1Multiplier}`;
        } else { c1.style.display = 'none'; }
    }

    const c2 = document.getElementById('cr2');
    if (c2) {
        const cc2 = (typeof cr2Cost !== 'undefined') ? Number(cr2Cost) : 800000000;
        if (!cr2Purchased && numericLevel(upgrade12Level) >= 25) {
            c2.style.display = 'block';
            document.getElementById('cr2Cost').innerText = formatNumber(cc2);
            c2.disabled = count < cc2;
        } else if (cr2Purchased) {
            c2.style.display = 'block';
            c2.disabled = true;
            c2.innerText = `Purchased — CR cps x${cr2Multiplier}`;
        } else { c2.style.display = 'none'; }
    }

    const c3 = document.getElementById('cr3');
    if (c3) {
        const cc3 = (typeof cr3Cost !== 'undefined') ? Number(cr3Cost) : 3000000000;
        if (!cr3Purchased && numericLevel(upgrade12Level) >= 50) {
            c3.style.display = 'block';
            document.getElementById('cr3Cost').innerText = formatNumber(cc3);
            c3.disabled = count < cc3;
        } else if (cr3Purchased) {
            c3.style.display = 'block';
            c3.disabled = true;
            c3.innerText = `Purchased — click power x${cr3Multiplier}`;
        } else { c3.style.display = 'none'; }
    }

    const c4 = document.getElementById('cr4');
    if (c4) {
        const cc4 = (typeof cr4Cost !== 'undefined') ? Number(cr4Cost) : 10000000000;
        if (!cr4Purchased && numericLevel(upgrade12Level) >= 75) {
            c4.style.display = 'block';
            document.getElementById('cr4Cost').innerText = formatNumber(cc4);
            c4.disabled = count < cc4;
        } else if (cr4Purchased) {
            c4.style.display = 'block';
            c4.disabled = true;
            c4.innerText = `Purchased — CR cps x${cr4Multiplier}`;
        } else { c4.style.display = 'none'; }
    }

    const c5 = document.getElementById('cr5');
    if (c5) {
        const cc5 = (typeof cr5Cost !== 'undefined') ? Number(cr5Cost) : 30000000000;
        if (!cr5Purchased && numericLevel(upgrade12Level) >= 100) {
            c5.style.display = 'block';
            document.getElementById('cr5Cost').innerText = formatNumber(cc5);
            c5.disabled = count < cc5;
        } else if (cr5Purchased) {
            c5.style.display = 'block';
            c5.disabled = true;
            c5.innerText = `Purchased — total cps x${cr5Multiplier}`;
        } else { c5.style.display = 'none'; }
    }

    // Tribal specials: unlock based on Tribal (upgrade9Level)
    const tbtn1 = document.getElementById('tribal1');
    if (tbtn1) {
        if (!tribal1Purchased && upgrade9Level >= 10) {
            tbtn1.style.display = 'block';
            document.getElementById('tribal1Cost').innerText = formatNumber(tribal1Cost);
            tbtn1.disabled = count < tribal1Cost;
        } else if (tribal1Purchased) {
            tbtn1.style.display = 'block';
            tbtn1.disabled = true;
            tbtn1.innerText = `Purchased — +200000 other cps`;
        } else { tbtn1.style.display = 'none'; }
    }

    const tbtn2 = document.getElementById('tribal2');
    if (tbtn2) {
        if (!tribal2Purchased && upgrade9Level >= 25) {
            tbtn2.style.display = 'block';
            document.getElementById('tribal2Cost').innerText = formatNumber(tribal2Cost);
            tbtn2.disabled = count < tribal2Cost;
        } else if (tribal2Purchased) {
            tbtn2.style.display = 'block';
            tbtn2.disabled = true;
            tbtn2.innerText = `Purchased — other cps x${tribal2Multiplier}`;
        } else { tbtn2.style.display = 'none'; }
    }

    const tbtn3 = document.getElementById('tribal3');
    if (tbtn3) {
        if (!tribal3Purchased && upgrade9Level >= 50) {
            tbtn3.style.display = 'block';
            document.getElementById('tribal3Cost').innerText = formatNumber(tribal3Cost);
            tbtn3.disabled = count < tribal3Cost;
        } else if (tribal3Purchased) {
            tbtn3.style.display = 'block';
            tbtn3.disabled = true;
            tbtn3.innerText = `Purchased — click power x${tribal3Multiplier}`;
        } else { tbtn3.style.display = 'none'; }
    }

    const tbtn4 = document.getElementById('tribal4');
    if (tbtn4) {
        if (!tribal4Purchased && upgrade9Level >= 100) {
            tbtn4.style.display = 'block';
            document.getElementById('tribal4Cost').innerText = formatNumber(tribal4Cost);
            tbtn4.disabled = count < tribal4Cost;
        } else if (tribal4Purchased) {
            tbtn4.style.display = 'block';
            tbtn4.disabled = true;
            tbtn4.innerText = `Purchased — total cps x${tribal4Multiplier}`;
        } else { tbtn4.style.display = 'none'; }
    }

    const grapeToggle = document.getElementById('grapeToggle');
    if (grapeToggle && grapeSection) grapeToggle.innerText = grapeSection.classList && grapeSection.classList.contains('open') ? 'Grape God Specials ▴' : 'Grape God Specials ▾';
    const skippieToggle = document.getElementById('skippieToggle');
    if (skippieToggle && skippieSection) skippieToggle.innerText = skippieSection.classList && skippieSection.classList.contains('open') ? 'Skippie Toilet Specials ▴' : 'Skippie Toilet Specials ▾';
    const islandToggle = document.getElementById('islandToggle');
    if (islandToggle) islandToggle.innerText = (typeof islandSection !== 'undefined' && islandSection && islandSection.classList && islandSection.classList.contains('open')) ? 'Mysterious Island Specials ▴' : 'Mysterious Island Specials ▾';
    const tribalToggle = document.getElementById('tribalToggle');
    if (tribalToggle) tribalToggle.innerText = (typeof tribalSection !== 'undefined' && tribalSection && tribalSection.classList && tribalSection.classList.contains('open')) ? 'Tribal Camp Specials ▴' : 'Tribal Camp Specials ▾';
    const phonkToggle = document.getElementById('phonkToggle');
    if (phonkToggle) phonkToggle.innerText = (typeof phonkSection !== 'undefined' && phonkSection && phonkSection.classList && phonkSection.classList.contains('open')) ? 'Phonk Man Specials ▴' : 'Phonk Man Specials ▾';
    const ropingToggle = document.getElementById('ropingToggle');
    if (ropingToggle) ropingToggle.innerText = (typeof ropingSection !== 'undefined' && ropingSection && ropingSection.classList && ropingSection.classList.contains('open')) ? 'Ropingnecurse Specials ▴' : 'Ropingnecurse Specials ▾';
}

// small helper to format seconds to human readable H:MM:SS or Dd H:MM:SS
function formatSecondsHuman(sec) {
    try {
        sec = Number(sec) || 0;
        if (sec < 60) return sec + 's';
        const days = Math.floor(sec / 86400);
        const hours = Math.floor((sec % 86400) / 3600);
        const mins = Math.floor((sec % 3600) / 60);
        const secs = Math.floor(sec % 60);
        const pad = (n) => n.toString().padStart(2,'0');
        if (days > 0) return `${days}d ${hours}:${pad(mins)}:${pad(secs)}`;
        return `${hours}:${pad(mins)}:${pad(secs)}`;
    } catch (e) { return String(sec); }
}

// ========== Main click handler: currency, achievements, clan mainClicks ==========
function increment() {
    let critOccurred = false;
    // compute base click reward (clickPower already includes Somalian and clickMultiplier effects)
    let reward;
    if (hasDecimal) {
        const cp = isDecimalInstance(clickPower) ? clickPower : D(clickPower);
        const gm = isDecimalInstance(goldenMultiplier) ? goldenMultiplier : D(goldenMultiplier);
        reward = cp.times(gm);
    } else {
        let cp = (typeof clickPower === 'number') ? clickPower : Number(clickPower);
        let gm = (typeof goldenMultiplier === 'number') ? goldenMultiplier : Number(goldenMultiplier);
        reward = cp * gm;
    }
    // Divine Assassin + casino crit buff: chance to perform a critical click that multiplies earnings by 10
    try {
        let chance = (typeof divineAssassinLevel !== 'undefined' && divineAssassinLevel > 0) ? Math.min(1, DIVINE_ASSASSIN_BASE_CHANCE * divineAssassinLevel) : 0;
        // Casino crit buff: add bonus crit chance when active
        if (window.casinoCritExpires && window.casinoCritExpires > Date.now()) chance += (window.casinoCritBonus || 0);
        chance = Math.min(1, chance);
        if (chance > 0 && Math.random() < chance) {
                // compute crit multiplier: base 10x, scaled by Divine Spirit levels (doubles per level)
                let critMult = 10;
                if (typeof divineSpiritLevel === 'number' && divineSpiritLevel > 0) critMult = 10 * Math.pow(2, Math.max(0, divineSpiritLevel - 1));
                if (hasDecimal) reward = (isDecimalInstance(reward) ? reward : D(reward)).times(D(critMult));
                else reward *= critMult;
                // optional visual feedback: spawn extra falling image with crit effects
                try { spawnFallingImage(true); } catch (e) {}
                // show a temporary critical indicator near center of main content
                try {
                    const indicator = document.createElement('div');
                    indicator.className = 'crit-indicator';
                    indicator.innerText = 'CRIT!';
                    // position near mainContent center if available
                    const mainEl = document.getElementById('mainContent');
                    if (mainEl) {
                        const r = mainEl.getBoundingClientRect();
                        indicator.style.left = (r.left + r.width / 2) + 'px';
                        indicator.style.top = (r.top + r.height / 3) + 'px';
                    } else {
                        // default to center of viewport
                        indicator.style.left = (window.innerWidth / 2) + 'px';
                        indicator.style.top = (window.innerHeight * 0.35) + 'px';
                    }
                    document.body.appendChild(indicator);
                    setTimeout(() => { try { indicator.remove(); } catch (e) {} }, 900);
                    try {
                        critOccurred = true;
                        // mark that we've seen a crit (one-time achievement)
                        if (localStorage.getItem('ach_gotCrit') !== '1') {
                            try { localStorage.setItem('ach_gotCrit','1'); } catch (e) {}
                            try { showAchievementPopup('Achievement unlocked', "That wasn't supposed to happen — Got a critical click"); } catch (e) {}
                            try { addUnlockedTitle('Source: Trust Me'); } catch (e) {}
                            try { window.dispatchEvent(new Event('storage')); } catch (e) {}
                        }
                        // handle consecutive crits counter
                        try {
                            const lastWas = localStorage.getItem('last_was_crit') === '1';
                            const prev = Number(localStorage.getItem('consecutive_crits')||0) || 0;
                            const next = lastWas ? (prev + 1) : 1;
                            try { localStorage.setItem('consecutive_crits', String(next)); } catch (e) {}
                            try { localStorage.setItem('last_was_crit','1'); } catch (e) {}
                            // unlock statistically unlikely at 2 consecutive crits
                            if (next >= 2 && localStorage.getItem('ach_stat_unlikely') !== '1') {
                                try { localStorage.setItem('ach_stat_unlikely','1'); } catch (e) {}
                                try { showAchievementPopup('Achievement unlocked', 'Statistically Unlikely — 2 crits in a row'); } catch (e) {}
                                try { addUnlockedTitle('Probability Skeptic'); } catch (e) {}
                                try { window.dispatchEvent(new Event('storage')); } catch (e) {}
                            }
                        } catch (e) {}
                    } catch (e) {}
                } catch (e) {}
            }
    } catch (e) {}
    // reset consecutive crit counter if this click was not a crit
    try {
        if (!critOccurred) {
            try { localStorage.setItem('last_was_crit','0'); } catch (e) {}
            try { localStorage.setItem('consecutive_crits','0'); } catch (e) {}
        }
    } catch (e) {}
    if (hasDecimal) {
        try { addToCount(reward); } catch (e) { count = (typeof count === 'number' ? count : 0) + Number(reward); }
    } else {
        count = (typeof count === 'number' ? count : Number(count)) + Number(reward);
    }
    // rare diamond drop: 1 in 2500 chance per click
    try {
        if (Math.random() < (1/2500)) {
            // increment diamonds and show a small visual indicator
            diamonds = (typeof diamonds === 'number' ? diamonds : Number(diamonds) || 0) + 1;
            try { saveGame(); } catch (e) {}
            try {
                const indicator = document.createElement('div');
                indicator.className = 'crit-indicator';
                indicator.innerText = '♦ +1';
                const mainEl = document.getElementById('mainContent');
                if (mainEl) {
                    const r = mainEl.getBoundingClientRect();
                    indicator.style.left = (r.left + r.width / 2) + 'px';
                    indicator.style.top = (r.top + r.height / 3) + 'px';
                } else {
                    indicator.style.left = (window.innerWidth / 2) + 'px';
                    indicator.style.top = (window.innerHeight * 0.35) + 'px';
                }
                document.body.appendChild(indicator);
                setTimeout(() => { try { indicator.remove(); } catch (e) {} }, 1600);
            } catch (e) {}
        }
    } catch (e) {}
    updateDisplays();
    // spawn a falling image effect on each click
    try { spawnFallingImage(false); } catch (e) { /* ignore if animation fails */ }
    // visual: briefly pulsate the main image on click
    try {
        const img = document.querySelector('.main-image');
        if (img) {
            img.classList.remove('pulsate');
            // force reflow to restart animation
            void img.offsetWidth;
            img.classList.add('pulsate');
            setTimeout(() => { try { img.classList.remove('pulsate'); } catch (e) {} }, 700);
        }
    } catch (e) {}

    // Achievement: track clicks for "Getting Started" (unlock after 10 clicks)
    try {
        try { var achClicks = Number(localStorage.getItem('ach_clicks')||0); } catch (e) { achClicks = 0; }
        achClicks = achClicks + 1;
        try { localStorage.setItem('ach_clicks', String(achClicks)); } catch (e) {}
        if (achClicks >= 10) {
            try {
                if (localStorage.getItem('ach_gettingStarted') !== '1') {
                    localStorage.setItem('ach_gettingStarted', '1');
                    try { showAchievementPopup('Achievement unlocked', 'Getting Started — Clicked 10 times'); } catch (e) {}
                    try { addUnlockedTitle('What Happened Beginner'); } catch (e) {}
                    // notify other tabs/windows (best-effort)
                    try { window.dispatchEvent(new Event('storage')); } catch (e) {}
                }
            } catch (e) {}
        }

        // Additional achievement: Something Happened (1000 clicks)
        try {
            if (achClicks >= 1000) {
                try {
                    if (localStorage.getItem('ach_somethingHappened') !== '1') {
                        localStorage.setItem('ach_somethingHappened', '1');
                        try { showAchievementPopup('Achievement unlocked', 'Something Happened — 1000 clicks'); } catch (e) {}
                        try { addUnlockedTitle('Confused Observer'); } catch (e) {}
                        try { window.dispatchEvent(new Event('storage')); } catch (e) {}
                    }
                } catch (e) {}
            }
        } catch (e) {}
    } catch (e) {}

    // Track lifetime and since-prestige click counters
    try {
        try { var lifetime = Number(localStorage.getItem('whathappened_lifetime_clicks')||0); } catch (e) { lifetime = 0; }
        lifetime = lifetime + 1;
        try { localStorage.setItem('whathappened_lifetime_clicks', String(lifetime)); } catch (e) {}
    } catch (e) {}
    try {
        try { var since = Number(localStorage.getItem('whathappened_clicks_since_prestige')||0); } catch (e) { since = 0; }
        since = since + 1;
        try { localStorage.setItem('whathappened_clicks_since_prestige', String(since)); } catch (e) {}
    } catch (e) {}

    // Firestore: increment per-user main image clicks for clan events
    try{
        (async ()=>{
            try{
                const clanId = localStorage.getItem('player_clanId');
                const username = localStorage.getItem('player_username');
                if(!clanId || !username) return;
                if(typeof doc === 'function' && typeof db !== 'undefined'){
                    const memberRef = doc(db,'clans', String(clanId), 'members', String(username));
                    try{
                        // Prefer Firestore atomic increment when available. Ensure the
                        // `increment` symbol looks like Firestore's helper (accepts an
                        // argument) so we don't confuse it with the local `increment()`
                        // click function defined elsewhere in this file.
                        if (typeof window !== 'undefined' && typeof window.firestoreIncrement === 'function' && window.firestoreIncrement.length >= 1 && typeof updateDoc === 'function'){
                            try{
                                await updateDoc(memberRef, { mainClicks: window.firestoreIncrement(1) });
                            }catch(e){
                                // fallback to read-modify-write if atomic update failed
                                try{
                                    const s = await getDoc(memberRef);
                                    const cur = (s && s.exists() && s.data() && Number(s.data().mainClicks||0)) ? Number(s.data().mainClicks||0) : 0;
                                    if(typeof setDoc === 'function'){
                                        await setDoc(memberRef, { mainClicks: cur + 1 }, { merge: true });
                                    } else if(typeof updateDoc === 'function'){
                                        await updateDoc(memberRef, { mainClicks: cur + 1 });
                                    }
                                }catch(err){ console.warn('increment mainClicks fallback failed', err); }
                            }
                        } else {
                            // atomic increment not available — best-effort read-modify-write
                            try{
                                const s = await getDoc(memberRef);
                                const cur = (s && s.exists() && s.data() && Number(s.data().mainClicks||0)) ? Number(s.data().mainClicks||0) : 0;
                                if(typeof setDoc === 'function'){
                                    await setDoc(memberRef, { mainClicks: cur + 1 }, { merge: true });
                                } else if(typeof updateDoc === 'function'){
                                    await updateDoc(memberRef, { mainClicks: cur + 1 });
                                }
                            }catch(err){ console.warn('increment mainClicks failed', err); }
                        }
                    }catch(e){ console.warn('update member mainClicks failed', e); }
                }
                if (clanId) try { window._bossfightPending = (window._bossfightPending || 0) + 1; } catch (e) {}
            }catch(e){}
        })();
    }catch(e){}
}

// create a falling image from a random x at the top to the bottom, then remove it
function spawnFallingImage(isCrit = false) {
    const img = document.createElement('img');
    img.src = (typeof equippedShopImage === 'string' && equippedShopImage) ? equippedShopImage : 'mainimage/whathappened.jpeg';
    img.className = 'falling-image';
    // base size
    const baseSize = 40 + Math.floor(Math.random() * 30); // 40-70px base
    const critScale = isCrit ? (1.6 + Math.random() * 0.6) : 1;
    const size = Math.round(baseSize * critScale);
    img.style.width = size + 'px';
    img.style.left = Math.floor(Math.random() * Math.max(1, window.innerWidth - size)) + 'px';
    img.style.top = '-140px';
    img.style.opacity = '1';
    img.style.willChange = 'transform, opacity, filter';

    // crit visual augmentations
    if (isCrit) {
        img.style.zIndex = '9999';
        img.style.filter = 'drop-shadow(0 0 10px gold) saturate(1.4)';
    }

    // append into the falling images container (background)
    const container = document.getElementById('falling-container');
    if (container) container.appendChild(img);
    else document.body.appendChild(img);

    // trigger the CSS transform on next frame to animate
    requestAnimationFrame(() => {
        const travel = window.innerHeight + 240 + Math.random() * 120; // px
        // crits last slightly longer and use a smoother easing
        const duration = isCrit ? 1000 + Math.floor(Math.random() * 800) : 700 + Math.floor(Math.random() * 800);
        const easing = isCrit ? 'cubic-bezier(.2,.9,.2,1)' : 'linear';
        // add a small rotation for more visual variety
        const startRot = (Math.random() * 40 - 20).toFixed(1);
        const endRot = (parseFloat(startRot) + (Math.random() * 80 - 40)).toFixed(1);
        img.style.transition = `transform ${duration}ms ${easing}, opacity 300ms linear ${Math.max(0, duration - 400)}ms, filter ${Math.max(200, duration/3)}ms ease`;
        // initial transform (scale applied for crit already via size)
        img.style.transform = `translateY(${travel}px) rotate(${endRot}deg)`;
        // fade out near the end
        setTimeout(() => { img.style.opacity = '0'; }, duration - 300);
        // if crit, pulse the filter a bit then fade
        if (isCrit) {
            setTimeout(() => { try { img.style.filter = 'drop-shadow(0 0 18px gold) saturate(1.6)'; } catch (e) {} }, 80);
        }
    });

    // remove when transition finishes
    img.addEventListener('transitionend', () => { try { img.remove(); } catch (e) {} });
}

    // Helper: animate the last bought upgrade button (used after purchases)
    function animateLastBoughtButton() {
        try {
            const id = window.__lastBoughtButton;
            if (!id) return;
            // clear flag immediately so repeated calls don't re-trigger
            window.__lastBoughtButton = null;
            const btn = document.getElementById(id);
            if (!btn) return;
            btn.classList.remove('bought-anim');
            void btn.offsetWidth;
            btn.classList.add('bought-anim');
            btn.addEventListener('animationend', () => { try { btn.classList.remove('bought-anim'); } catch (e) {} }, { once: true });
        } catch (e) {}
    }

    // Helper: keep upgrade buttons visually in sync with their disabled state
    function updateDisabledClasses() {
        try {
            const sel = '#leftBar button, #divineLeftBar button, #specialMenu button, .section-content button, .special-menu button';
            document.querySelectorAll(sel).forEach(btn => {
                try {
                    if (btn.disabled) {
                        btn.classList.add('upgrade-disabled');
                        try { btn.style.opacity = '0.6'; } catch (e) {}
                        try { btn.style.pointerEvents = 'none'; } catch (e) {}
                    } else {
                        btn.classList.remove('upgrade-disabled');
                        try { btn.style.opacity = ''; } catch (e) {}
                        try { btn.style.pointerEvents = ''; } catch (e) {}
                    }
                } catch (e) {}
            });
        } catch (e) {}
    }
    // run periodically so UI updates (including from other tabs) reflect affordability
    setInterval(updateDisabledClasses, 300);

// Ensure `updateDisplays` always triggers a visual sync for disabled classes
try {
    if (typeof updateDisplays === 'function') {
        const __orig_updateDisplays = updateDisplays;
        updateDisplays = function() {
            try { __orig_updateDisplays.apply(this, arguments); } catch (e) { try { __orig_updateDisplays(); } catch (e2) {} }
            try { updateDisabledClasses(); } catch (e) {}
        };
    }
} catch (e) {}

// initial sync
try { updateDisabledClasses(); } catch (e) {}

// Welcome-back modal helper (used for offline gains display)
function showWelcomeBackModal(amount, seconds) {
    try {
        const modal = document.getElementById('welcomeBackModal');
        const gainedEl = document.getElementById('welcomeBackGained');
        const forEl = document.getElementById('welcomeBackFor');
        const okBtn = document.getElementById('welcomeBackOk');
        const closeBtn = document.getElementById('welcomeBackClose');
        if (!modal) return;
        const formattedAmount = (typeof formatNumber === 'function') ? formatNumber(amount) : String(amount);
        const formattedTime = (typeof formatSecondsHuman === 'function') ? formatSecondsHuman(Number(seconds || 0)) : (String(seconds) + 's');
        if (gainedEl) gainedEl.innerHTML = 'gained: <strong>' + formattedAmount + '</strong>';
        if (forEl) forEl.innerHTML = 'for: <strong>' + formattedTime + '</strong>';
        modal.style.display = 'block';
        const hide = () => { try { modal.style.display = 'none'; } catch (e) {} };
        if (okBtn) okBtn.addEventListener('click', hide, { once: true });
        if (closeBtn) closeBtn.addEventListener('click', hide, { once: true });
        // auto-hide after 6 seconds
        setTimeout(hide, 6000);
    } catch (e) {}
}

function buyUpgrade1() {
    const btn = document.getElementById('upgrade1');
    let bought = 0;
    for (let i = 0; i < purchaseBatch; i++) {
        var eff = effectiveUpgradeCost(upgrade1Cost);
        if (hasDecimal) {
            if ((isDecimalInstance(count) ? count : D(count)).gte(eff)) {
                count = (isDecimalInstance(count) ? count : D(count)).minus(eff);
                baseClickPower = (isDecimalInstance(baseClickPower) ? baseClickPower : D(baseClickPower)).plus(D(1));
                upgrade1Level = (isDecimalInstance(upgrade1Level) ? upgrade1Level : D(upgrade1Level)).plus(D(1));
                upgrade1Cost = D(upgrade1Cost).times(D(1.1)).ceil();
                bought++;
            } else break;
        } else {
            if (count >= eff) {
                count -= eff;
                baseClickPower += 1;
                upgrade1Level += 1;
                upgrade1Cost = Math.ceil(upgrade1Cost * 1.1);
                bought++;
            } else break;
        }
    }
    if (bought > 0) {
        try { playSfx('audio/purchase.wav'); } catch (e) {}
        try { window.__lastBoughtButton = 'upgrade1'; } catch (e) {}
        updateDisplays();
        try { setTimeout(animateLastBoughtButton, 40); } catch (e) {}
    }
    else alert('Not enough What Happeneds — need ' + formatNumber(computeBatchCostWithSimpleVillager(upgrade1Cost, purchaseBatch || 1, 1.1)) + '.');
}

function buyUpgrade2() {
    const btn = document.getElementById('upgrade2');
    let bought = 0;
    for (let i = 0; i < purchaseBatch; i++) {
        var eff = effectiveUpgradeCost(upgrade2Cost);
        if (hasDecimal) {
            if ((isDecimalInstance(count) ? count : D(count)).gte(eff)) {
                count = (isDecimalInstance(count) ? count : D(count)).minus(eff);
                pirateCps = (isDecimalInstance(pirateCps) ? pirateCps : D(pirateCps)).plus(D(1));
                upgrade2Level = (isDecimalInstance(upgrade2Level) ? upgrade2Level : D(upgrade2Level)).plus(D(1));
                upgrade2Cost = D(upgrade2Cost).times(D(1.1)).ceil();
                bought++;
            } else break;
        } else {
            if (count >= eff) {
                count -= eff;
                pirateCps += 1;
                upgrade2Level += 1;
                upgrade2Cost = Math.ceil(upgrade2Cost * 1.1);
                bought++;
            } else break;
        }
    }
    if (bought > 0) {
        try { playSfx('audio/purchase.wav'); } catch (e) {}
        try { window.__lastBoughtButton = 'upgrade2'; } catch (e) {}
        updateDisplays();
        try { setTimeout(animateLastBoughtButton, 40); } catch (e) {}
    }
    else alert('Not enough What Happeneds — need ' + formatNumber(computeBatchCostWithSimpleVillager(upgrade2Cost, purchaseBatch || 1, 1.1)) + '.');
}

function buyUpgrade3() {
    const btn = document.getElementById('upgrade3');
    let bought = 0;
    for (let i = 0; i < purchaseBatch; i++) {
        var eff = effectiveUpgradeCost(upgrade3Cost);
        if (hasDecimal) {
            if ((isDecimalInstance(count) ? count : D(count)).gte(eff)) {
                count = (isDecimalInstance(count) ? count : D(count)).minus(eff);
                baseOtherCps = (isDecimalInstance(baseOtherCps) ? baseOtherCps : D(baseOtherCps)).plus(D(5));
                upgrade3Level = (isDecimalInstance(upgrade3Level) ? upgrade3Level : D(upgrade3Level)).plus(D(1));
                upgrade3Cost = D(upgrade3Cost).times(D(1.1)).ceil();
                bought++;
            } else break;
        } else {
            if (count >= eff) {
                count -= eff;
                baseOtherCps += 5;
                upgrade3Level += 1;
                upgrade3Cost = Math.ceil(upgrade3Cost * 1.1);
                bought++;
            } else break;
        }
    }
    if (bought > 0) {
        try { playSfx('audio/purchase.wav'); } catch (e) {}
        try { window.__lastBoughtButton = 'upgrade3'; } catch (e) {}
        updateDisplays();
        try { setTimeout(animateLastBoughtButton, 40); } catch (e) {}
    }
    else alert('Not enough What Happeneds — need ' + formatNumber(computeBatchCostWithSimpleVillager(upgrade3Cost, purchaseBatch || 1, 1.1)) + '.');
}

function buyUpgrade4() {
    const btn = document.getElementById('upgrade4');
    let bought = 0;
    for (let i = 0; i < purchaseBatch; i++) {
        var eff = effectiveUpgradeCost(upgrade4Cost);
        if (hasDecimal) {
            if ((isDecimalInstance(count) ? count : D(count)).gte(eff)) {
                count = (isDecimalInstance(count) ? count : D(count)).minus(eff);
                baseOtherCps = (isDecimalInstance(baseOtherCps) ? baseOtherCps : D(baseOtherCps)).plus(D(20));
                upgrade4Level = (isDecimalInstance(upgrade4Level) ? upgrade4Level : D(upgrade4Level)).plus(D(1));
                upgrade4Cost = D(upgrade4Cost).times(D(1.1)).ceil();
                bought++;
            } else break;
        } else {
            if (count >= eff) {
                count -= eff;
                baseOtherCps += 20;
                upgrade4Level += 1;
                upgrade4Cost = Math.ceil(upgrade4Cost * 1.1);
                bought++;
            } else break;
        }
    }
    if (bought > 0) {
        try { playSfx('audio/purchase.wav'); } catch (e) {}
        try { window.__lastBoughtButton = 'upgrade4'; } catch (e) {}
        updateDisplays();
        try { setTimeout(animateLastBoughtButton, 40); } catch (e) {}
    }
    else alert('Not enough What Happeneds — need ' + formatNumber(computeBatchCostWithSimpleVillager(upgrade4Cost, purchaseBatch || 1, 1.1)) + '.');
}

function buyUpgrade5() {
    const btn = document.getElementById('upgrade5');
    let bought = 0;
    for (let i = 0; i < purchaseBatch; i++) {
        var eff = effectiveUpgradeCost(upgrade5Cost);
        if (hasDecimal) {
            if ((isDecimalInstance(count) ? count : D(count)).gte(eff)) {
                count = (isDecimalInstance(count) ? count : D(count)).minus(eff);
                baseOtherCps = (isDecimalInstance(baseOtherCps) ? baseOtherCps : D(baseOtherCps)).plus(D(100));
                upgrade5Level = (isDecimalInstance(upgrade5Level) ? upgrade5Level : D(upgrade5Level)).plus(D(1));
                upgrade5Cost = D(upgrade5Cost).times(D(1.1)).ceil();
                bought++;
            } else break;
        } else {
            if (count >= eff) {
                count -= eff;
                baseOtherCps += 100;
                upgrade5Level += 1;
                upgrade5Cost = Math.ceil(upgrade5Cost * 1.1);
                bought++;
            } else break;
        }
    }
    if (bought > 0) {
        try { playSfx('audio/purchase.wav'); } catch (e) {}
        try { window.__lastBoughtButton = 'upgrade5'; } catch (e) {}
        updateDisplays();
        try { setTimeout(animateLastBoughtButton, 40); } catch (e) {}
    }
    else alert('Not enough What Happeneds — need ' + formatNumber(computeBatchCostWithSimpleVillager(upgrade5Cost, purchaseBatch || 1, 1.1)) + '.');
}

function buyUpgrade6() {
    const btn = document.getElementById('upgrade6');
    let bought = 0;
    for (let i = 0; i < purchaseBatch; i++) {
        var eff = effectiveUpgradeCost(upgrade6Cost);
        if (hasDecimal) {
            if ((isDecimalInstance(count) ? count : D(count)).gte(eff)) {
                count = (isDecimalInstance(count) ? count : D(count)).minus(eff);
                baseOtherCps = (isDecimalInstance(baseOtherCps) ? baseOtherCps : D(baseOtherCps)).plus(D(500));
                upgrade6Level = (isDecimalInstance(upgrade6Level) ? upgrade6Level : D(upgrade6Level)).plus(D(1));
                upgrade6Cost = D(upgrade6Cost).times(D(1.1)).ceil();
                bought++;
            } else break;
        } else {
            if (count >= eff) {
                count -= eff;
                baseOtherCps += 500;
                upgrade6Level += 1;
                upgrade6Cost = Math.ceil(upgrade6Cost * 1.1);
                bought++;
            } else break;
        }
    }
    if (bought > 0) {
        try { playSfx('audio/purchase.wav'); } catch (e) {}
        try { window.__lastBoughtButton = 'upgrade6'; } catch (e) {}
        updateDisplays();
        try { setTimeout(animateLastBoughtButton, 40); } catch (e) {}
    }
    else alert('Not enough What Happeneds — need ' + formatNumber(computeBatchCostWithSimpleVillager(upgrade6Cost, purchaseBatch || 1, 1.1)) + '.');
}

function buyUpgrade7() {
    const btn = document.getElementById('upgrade7');
    let bought = 0;
    for (let i = 0; i < purchaseBatch; i++) {
        var eff = effectiveUpgradeCost(upgrade7Cost);
        if (hasDecimal) {
            if ((isDecimalInstance(count) ? count : D(count)).gte(eff)) {
                count = (isDecimalInstance(count) ? count : D(count)).minus(eff);
                baseOtherCps = (isDecimalInstance(baseOtherCps) ? baseOtherCps : D(baseOtherCps)).plus(D(5000));
                upgrade7Level = (isDecimalInstance(upgrade7Level) ? upgrade7Level : D(upgrade7Level)).plus(D(1));
                upgrade7Cost = D(upgrade7Cost).times(D(1.1)).ceil();
                bought++;
            } else break;
        } else {
            if (count >= eff) {
                count -= eff;
                baseOtherCps += 5000;
                upgrade7Level += 1;
                upgrade7Cost = Math.ceil(upgrade7Cost * 1.1);
                bought++;
            } else break;
        }
    }
    if (bought > 0) {
        try { playSfx('audio/purchase.wav'); } catch (e) {}
        try { window.__lastBoughtButton = 'upgrade7'; } catch (e) {}
        updateDisplays();
        try { setTimeout(animateLastBoughtButton, 40); } catch (e) {}
    }
    else alert('Not enough What Happeneds — need ' + formatNumber(computeBatchCostWithSimpleVillager(upgrade7Cost, purchaseBatch || 1, 1.1)) + '.');
}

function buyUpgrade8() {
    const btn = document.getElementById('upgrade8');
    let bought = 0;
    for (let i = 0; i < purchaseBatch; i++) {
        var eff = effectiveUpgradeCost(upgrade8Cost);
        if (hasDecimal) {
            if ((isDecimalInstance(count) ? count : D(count)).gte(eff)) {
                count = (isDecimalInstance(count) ? count : D(count)).minus(eff);
                baseOtherCps = (isDecimalInstance(baseOtherCps) ? baseOtherCps : D(baseOtherCps)).plus(D(20000));
                upgrade8Level = (isDecimalInstance(upgrade8Level) ? upgrade8Level : D(upgrade8Level)).plus(D(1));
                upgrade8Cost = D(upgrade8Cost).times(D(1.1)).ceil();
                bought++;
            } else break;
        } else {
            if (count >= eff) {
                count -= eff;
                baseOtherCps += 20000;
                upgrade8Level += 1;
                upgrade8Cost = Math.ceil(upgrade8Cost * 1.1);
                bought++;
            } else break;
        }
    }
    if (bought > 0) {
        try { playSfx('audio/purchase.wav'); } catch (e) {}
        try { window.__lastBoughtButton = 'upgrade8'; } catch (e) {}
        updateDisplays();
        try { setTimeout(animateLastBoughtButton, 40); } catch (e) {}
    }
    else alert('Not enough What Happeneds — need ' + formatNumber(computeBatchCostWithSimpleVillager(upgrade8Cost, purchaseBatch || 1, 1.1)) + '.');
}

function buyUpgrade9() {
    const btn = document.getElementById('upgrade9');
    let bought = 0;
    for (let i = 0; i < purchaseBatch; i++) {
        var eff = effectiveUpgradeCost(upgrade9Cost);
        if (hasDecimal) {
            if ((isDecimalInstance(count) ? count : D(count)).gte(eff)) {
                count = (isDecimalInstance(count) ? count : D(count)).minus(eff);
                baseOtherCps = (isDecimalInstance(baseOtherCps) ? baseOtherCps : D(baseOtherCps)).plus(D(100000));
                upgrade9Level = (isDecimalInstance(upgrade9Level) ? upgrade9Level : D(upgrade9Level)).plus(D(1));
                upgrade9Cost = D(upgrade9Cost).times(D(1.1)).ceil();
                bought++;
            } else break;
        } else {
            if (count >= eff) {
                count -= eff;
                baseOtherCps += 100000;
                upgrade9Level += 1;
                upgrade9Cost = Math.ceil(upgrade9Cost * 1.1);
                bought++;
            } else break;
        }
    }
    if (bought > 0) {
        try { playSfx('audio/purchase.wav'); } catch (e) {}
        try { window.__lastBoughtButton = 'upgrade9'; } catch (e) {}
        updateDisplays();
        try { setTimeout(animateLastBoughtButton, 40); } catch (e) {}
    }
    else alert('Not enough What Happeneds — need ' + formatNumber(computeBatchCostWithSimpleVillager(upgrade9Cost, purchaseBatch || 1, 1.1)) + '.');
}

function buyUpgrade10() {
    const btn = document.getElementById('upgrade10');
    let bought = 0;
    for (let i = 0; i < purchaseBatch; i++) {
        var eff = effectiveUpgradeCost(upgrade10Cost);
        if (hasDecimal) {
            if ((isDecimalInstance(count) ? count : D(count)).gte(eff)) {
                count = (isDecimalInstance(count) ? count : D(count)).minus(eff);
                baseOtherCps = (isDecimalInstance(baseOtherCps) ? baseOtherCps : D(baseOtherCps)).plus(D(500000));
                upgrade10Level = (isDecimalInstance(upgrade10Level) ? upgrade10Level : D(upgrade10Level)).plus(D(1));
                upgrade10Cost = D(upgrade10Cost).times(D(1.1)).ceil();
                bought++;
            } else break;
        } else {
            if (count >= eff) {
                count -= eff;
                baseOtherCps += 500000;
                upgrade10Level += 1;
                upgrade10Cost = Math.ceil(upgrade10Cost * 1.1);
                bought++;
            } else break;
        }
    }
    if (bought > 0) {
        try { playSfx('audio/purchase.wav'); } catch (e) {}
        try { window.__lastBoughtButton = 'upgrade10'; } catch (e) {}
        updateDisplays();
        try { setTimeout(animateLastBoughtButton, 40); } catch (e) {}
    }
    else alert('Not enough What Happeneds — need ' + formatNumber(computeBatchCostWithSimpleVillager(upgrade10Cost, purchaseBatch || 1, 1.1)) + '.');
}

function buyUpgrade11() {
    const btn = document.getElementById('upgrade11');
    let bought = 0;
    for (let i = 0; i < purchaseBatch; i++) {
        var eff = effectiveUpgradeCost(upgrade11Cost);
        if (hasDecimal) {
            if ((isDecimalInstance(count) ? count : D(count)).gte(eff)) {
                count = (isDecimalInstance(count) ? count : D(count)).minus(eff);
                jonathanBaseCps = (isDecimalInstance(jonathanBaseCps) ? jonathanBaseCps : D(jonathanBaseCps)).plus(D(1500000));
                upgrade11Level = (isDecimalInstance(upgrade11Level) ? upgrade11Level : D(upgrade11Level)).plus(D(1));
                upgrade11Cost = D(upgrade11Cost).times(D(1.15)).ceil();
                bought++;
            } else break;
        } else {
            if (count >= eff) {
                count -= eff;
                jonathanBaseCps += 1500000;
                upgrade11Level += 1;
                upgrade11Cost = Math.ceil(upgrade11Cost * 1.15);
                bought++;
            } else break;
        }
    }
    if (bought > 0) {
        try { playSfx('audio/purchase.wav'); } catch (e) {}
        try { window.__lastBoughtButton = 'upgrade11'; } catch (e) {}
        updateDisplays();
        try { setTimeout(animateLastBoughtButton, 40); } catch (e) {}
    }
    else alert('Not enough What Happeneds — need ' + formatNumber(computeBatchCostWithSimpleVillager(upgrade11Cost, purchaseBatch || 1, 1.15)) + '.');
}

function buyUpgrade12() {
    const btn = document.getElementById('upgrade12');
    let bought = 0;
    for (let i = 0; i < purchaseBatch; i++) {
        var eff = effectiveUpgradeCost(upgrade12Cost);
        if (hasDecimal) {
            if ((isDecimalInstance(count) ? count : D(count)).gte(eff)) {
                count = (isDecimalInstance(count) ? count : D(count)).minus(eff);
                crBaseCps = (isDecimalInstance(crBaseCps) ? crBaseCps : D(crBaseCps)).plus(D(5000000));
                upgrade12Level = (isDecimalInstance(upgrade12Level) ? upgrade12Level : D(upgrade12Level)).plus(D(1));
                upgrade12Cost = D(upgrade12Cost).times(D(1.15)).ceil();
                bought++;
            } else break;
        } else {
            if (count >= eff) {
                count -= eff;
                crBaseCps += 5000000;
                upgrade12Level += 1;
                upgrade12Cost = Math.ceil(upgrade12Cost * 1.15);
                bought++;
            } else break;
        }
    }
    if (bought > 0) {
        try { playSfx('audio/purchase.wav'); } catch (e) {}
        try { window.__lastBoughtButton = 'upgrade12'; } catch (e) {}
        updateDisplays();
        try { setTimeout(animateLastBoughtButton, 40); } catch (e) {}
    }
    else alert('Not enough What Happeneds — need ' + formatNumber(computeBatchCostWithSimpleVillager(upgrade12Cost, purchaseBatch || 1, 1.15)) + '.');
}

function buyUpgrade13() {
    const btn = document.getElementById('upgrade13');
    let bought = 0;
    for (let i = 0; i < purchaseBatch; i++) {
        var eff = effectiveUpgradeCost(upgrade13Cost);
        if (hasDecimal) {
            if ((isDecimalInstance(count) ? count : D(count)).gte(eff)) {
                count = (isDecimalInstance(count) ? count : D(count)).minus(eff);
                // ropingnecurse contribution is computed from level with 10% per-level growth;
                // do not add to `baseOtherCps` here to avoid double-counting — keep level-based contribution
                upgrade13Level = (isDecimalInstance(upgrade13Level) ? upgrade13Level : D(upgrade13Level)).plus(D(1));
                // ensure cost grows monotonically (avoid rare rounding regressions)
                const prev = D(upgrade13Cost);
                let next = prev.times(D(1.15)).ceil();
                if (next.lte(prev)) next = prev.plus(D(1));
                upgrade13Cost = next;
                bought++;
            } else break;
        } else {
            if (count >= eff) {
                count -= eff;
                // ropingnecurse contribution is computed from level with 10% per-level growth;
                // do not add to `baseOtherCps` here to avoid double-counting — keep level-based contribution
                upgrade13Level += 1;
                // ensure monotonic increase even with rounding
                const prev = Number(upgrade13Cost);
                let next = Math.ceil(prev * 1.15);
                if (next <= prev) next = prev + 1;
                upgrade13Cost = next;
                bought++;
            } else break;
        }
    }
    if (bought > 0) {
        try { playSfx('audio/purchase.wav'); } catch (e) {}
        try { window.__lastBoughtButton = 'upgrade13'; } catch (e) {}
        updateDisplays();
        try { setTimeout(animateLastBoughtButton, 40); } catch (e) {}
    }
    else alert('Not enough What Happeneds — need ' + formatNumber(computeBatchCostWithSimpleVillager(upgrade13Cost, purchaseBatch || 1, 1.15)) + '.');
}

function buyUpgrade14() {
    const btn = document.getElementById('upgrade14');
    let bought = 0;
    for (let i = 0; i < purchaseBatch; i++) {
        var eff = effectiveUpgradeCost(upgrade14Cost);
        if (hasDecimal) {
            if ((isDecimalInstance(count) ? count : D(count)).gte(eff)) {
                count = (isDecimalInstance(count) ? count : D(count)).minus(eff);
                // scimitar contribution is tracked by level; do NOT add to baseOtherCps
                upgrade14Level = (isDecimalInstance(upgrade14Level) ? upgrade14Level : D(upgrade14Level)).plus(D(1));
                upgrade14Cost = D(upgrade14Cost).times(D(1.15)).ceil();
                bought++;
            } else break;
        } else {
            if (count >= eff) {
                count -= eff;
                // scimitar contribution is tracked by level; do NOT add to baseOtherCps
                upgrade14Level += 1;
                upgrade14Cost = Math.ceil(upgrade14Cost * 1.15);
                bought++;
            } else break;
        }
    }
    if (bought > 0) {
        try { playSfx('audio/purchase.wav'); } catch (e) {}
        try { window.__lastBoughtButton = 'upgrade14'; } catch (e) {}
        updateDisplays();
        try { setTimeout(animateLastBoughtButton, 40); } catch (e) {}
    }
    else alert('Not enough What Happeneds — need ' + formatNumber(computeBatchCostWithSimpleVillager(upgrade14Cost, purchaseBatch || 1, 1.15)) + '.');
}

function buyUpgrade15() {
    const btn = document.getElementById('upgrade15');
    let bought = 0;
    for (let i = 0; i < purchaseBatch; i++) {
        var eff = effectiveUpgradeCost(upgrade15Cost);
        if (hasDecimal) {
            if ((isDecimalInstance(count) ? count : D(count)).gte(eff)) {
                count = (isDecimalInstance(count) ? count : D(count)).minus(eff);
                // Beats contribution is tracked by level; do NOT add to baseOtherCps
                upgrade15Level = (isDecimalInstance(upgrade15Level) ? upgrade15Level : D(upgrade15Level)).plus(D(1));
                upgrade15Cost = D(upgrade15Cost).times(D(1.15)).ceil();
                bought++;
            } else break;
        } else {
            if (count >= eff) {
                count -= eff;
                // Beats contribution is tracked by level; do NOT add to baseOtherCps
                upgrade15Level += 1;
                upgrade15Cost = Math.ceil(upgrade15Cost * 1.15);
                bought++;
            } else break;
        }
    }
    if (bought > 0) {
        try { playSfx('audio/purchase.wav'); } catch (e) {}
        try { window.__lastBoughtButton = 'upgrade15'; } catch (e) {}
        updateDisplays();
        try { setTimeout(animateLastBoughtButton, 40); } catch (e) {}
    }
    else alert('Not enough What Happeneds — need ' + formatNumber(computeBatchCostWithSimpleVillager(upgrade15Cost, purchaseBatch || 1, 1.15)) + '.');
}

function buyUpgrade16() {
    const btn = document.getElementById('upgrade16');
    let bought = 0;
    for (let i = 0; i < purchaseBatch; i++) {
        var eff = effectiveUpgradeCost(upgrade16Cost);
        if (hasDecimal) {
            if ((isDecimalInstance(count) ? count : D(count)).gte(eff)) {
                count = (isDecimalInstance(count) ? count : D(count)).minus(eff);
                // ez villager contribution is tracked by level; do NOT add to `baseOtherCps` here
                upgrade16Level = (isDecimalInstance(upgrade16Level) ? upgrade16Level : D(upgrade16Level)).plus(D(1));
                upgrade16Cost = D(upgrade16Cost).times(D(1.15)).ceil();
                bought++;
            } else break;
        } else {
            if (count >= eff) {
                count -= eff;
                upgrade16Level += 1;
                upgrade16Cost = Math.ceil(upgrade16Cost * 1.15);
                bought++;
            } else break;
        }
    }
    if (bought > 0) {
        try { playSfx('audio/purchase.wav'); } catch (e) {}
        try { window.__lastBoughtButton = 'upgrade16'; } catch (e) {}
        updateDisplays();
        try { setTimeout(animateLastBoughtButton, 40); } catch (e) {}
    }
    else alert('Not enough What Happeneds — need ' + formatNumber(computeBatchCostWithSimpleVillager(upgrade16Cost, purchaseBatch || 1, 1.15)) + '.');
}

function buyUpgrade17() {
    const btn = document.getElementById('upgrade17');
    let bought = 0;
    for (let i = 0; i < purchaseBatch; i++) {
        var eff = effectiveUpgradeCost(upgrade17Cost);
        if (hasDecimal) {
            if ((isDecimalInstance(count) ? count : D(count)).gte(eff)) {
                count = (isDecimalInstance(count) ? count : D(count)).minus(eff);
                // SCP contribution tracked by level
                upgrade17Level = (isDecimalInstance(upgrade17Level) ? upgrade17Level : D(upgrade17Level)).plus(D(1));
                upgrade17Cost = D(upgrade17Cost).times(D(1.15)).ceil();
                bought++;
            } else break;
        } else {
            if (count >= eff) {
                count -= eff;
                upgrade17Level += 1;
                upgrade17Cost = Math.ceil(upgrade17Cost * 1.15);
                bought++;
            } else break;
        }
    }
    if (bought > 0) {
        try { playSfx('audio/purchase.wav'); } catch (e) {}
        try { window.__lastBoughtButton = 'upgrade17'; } catch (e) {}
        updateDisplays();
        try { setTimeout(animateLastBoughtButton, 40); } catch (e) {}
    }
    else alert('Not enough What Happeneds — need ' + formatNumber(computeBatchCostWithSimpleVillager(upgrade17Cost, purchaseBatch || 1, 1.15)) + '.');
}

function buyUpgrade18() {
    const btn = document.getElementById('upgrade18');
    let bought = 0;
    for (let i = 0; i < purchaseBatch; i++) {
        var eff = effectiveUpgradeCost(upgrade18Cost);
        if (hasDecimal) {
            if ((isDecimalInstance(count) ? count : D(count)).gte(eff)) {
                count = (isDecimalInstance(count) ? count : D(count)).minus(eff);
                upgrade18Level = (isDecimalInstance(upgrade18Level) ? upgrade18Level : D(upgrade18Level)).plus(D(1));
                upgrade18Cost = D(upgrade18Cost).times(D(1.15)).ceil();
                bought++;
            } else break;
        } else {
            if (count >= eff) {
                count -= eff;
                upgrade18Level += 1;
                upgrade18Cost = Math.ceil(upgrade18Cost * 1.15);
                bought++;
            } else break;
        }
    }
    if (bought > 0) {
        try { playSfx('audio/purchase.wav'); } catch (e) {}
        try { window.__lastBoughtButton = 'upgrade18'; } catch (e) {}
        updateDisplays();
        try { setTimeout(animateLastBoughtButton, 40); } catch (e) {}
    }
    else alert('Not enough What Happeneds — need ' + formatNumber(computeBatchCostWithSimpleVillager(upgrade18Cost, purchaseBatch || 1, 1.15)) + '.');
}

function buyUpgrade19() {
    const btn = document.getElementById('upgrade19');
    let bought = 0;
    for (let i = 0; i < purchaseBatch; i++) {
        var eff = effectiveUpgradeCost(upgrade19Cost);
        if (hasDecimal) {
            if ((isDecimalInstance(count) ? count : D(count)).gte(eff)) {
                count = (isDecimalInstance(count) ? count : D(count)).minus(eff);
                upgrade19Level = (isDecimalInstance(upgrade19Level) ? upgrade19Level : D(upgrade19Level)).plus(D(1));
                upgrade19Cost = D(upgrade19Cost).times(D(1.15)).ceil();
                bought++;
            } else break;
        } else {
            if (count >= eff) {
                count -= eff;
                upgrade19Level += 1;
                upgrade19Cost = Math.ceil(upgrade19Cost * 1.15);
                bought++;
            } else break;
        }
    }
    if (bought > 0) {
        try { playSfx('audio/purchase.wav'); } catch (e) {}
        try { window.__lastBoughtButton = 'upgrade19'; } catch (e) {}
        updateDisplays();
        try { setTimeout(animateLastBoughtButton, 40); } catch (e) {}
    }
    else alert('Not enough What Happeneds — need ' + formatNumber(computeBatchCostWithSimpleVillager(typeof upgrade19Cost !== 'undefined' ? upgrade19Cost : 200000000000000, purchaseBatch || 1, 1.15)) + '.');
}

function buyUpgrade20() {
    const btn = document.getElementById('upgrade20');
    let bought = 0;
    for (let i = 0; i < purchaseBatch; i++) {
        var eff = effectiveUpgradeCost(upgrade20Cost);
        if (hasDecimal) {
            if ((isDecimalInstance(count) ? count : D(count)).gte(eff)) {
                count = (isDecimalInstance(count) ? count : D(count)).minus(eff);
                upgrade20Level = (isDecimalInstance(upgrade20Level) ? upgrade20Level : D(upgrade20Level)).plus(D(1));
                upgrade20Cost = D(upgrade20Cost).times(D(1.15)).ceil();
                bought++;
            } else break;
        } else {
            if (count >= eff) {
                count -= eff;
                upgrade20Level += 1;
                upgrade20Cost = Math.ceil(upgrade20Cost * 1.15);
                bought++;
            } else break;
        }
    }
    if (bought > 0) {
        try { playSfx('audio/purchase.wav'); } catch (e) {}
        try { window.__lastBoughtButton = 'upgrade20'; } catch (e) {}
        updateDisplays();
        try { setTimeout(animateLastBoughtButton, 40); } catch (e) {}
    }
    else alert('Not enough What Happeneds — need ' + formatNumber(computeBatchCostWithSimpleVillager(typeof upgrade20Cost !== 'undefined' ? upgrade20Cost : 1000000000000000, purchaseBatch || 1, 1.15)) + '.');
}

function buyUpgrade21() {
    const btn = document.getElementById('upgrade21');
    let bought = 0;
    for (let i = 0; i < purchaseBatch; i++) {
        var eff = effectiveUpgradeCost(upgrade21Cost);
        if (hasDecimal) {
            if ((isDecimalInstance(count) ? count : D(count)).gte(eff)) {
                count = (isDecimalInstance(count) ? count : D(count)).minus(eff);
                upgrade21Level = (isDecimalInstance(upgrade21Level) ? upgrade21Level : D(upgrade21Level)).plus(D(1));
                upgrade21Cost = D(upgrade21Cost).times(D(1.15)).ceil();
                bought++;
            } else break;
        } else {
            if (count >= eff) {
                count -= eff;
                upgrade21Level += 1;
                upgrade21Cost = Math.ceil(upgrade21Cost * 1.15);
                bought++;
            } else break;
        }
    }
    if (bought > 0) {
        try { playSfx('audio/purchase.wav'); } catch (e) {}
        try { window.__lastBoughtButton = 'upgrade21'; } catch (e) {}
        updateDisplays();
        try { setTimeout(animateLastBoughtButton, 40); } catch (e) {}
    }
    else alert('Not enough What Happeneds — need ' + formatNumber(computeBatchCostWithSimpleVillager(typeof upgrade21Cost !== 'undefined' ? upgrade21Cost : 200000000000000000, purchaseBatch || 1, 1.15)) + '.');
}

function buyUpgrade22() {
    const btn = document.getElementById('upgrade22');
    let bought = 0;
    for (let i = 0; i < purchaseBatch; i++) {
        var eff = effectiveUpgradeCost(upgrade22Cost);
        if (hasDecimal) {
            if ((isDecimalInstance(count) ? count : D(count)).gte(eff)) {
                count = (isDecimalInstance(count) ? count : D(count)).minus(eff);
                upgrade22Level = (isDecimalInstance(upgrade22Level) ? upgrade22Level : D(upgrade22Level)).plus(D(1));
                upgrade22Cost = D(upgrade22Cost).times(D(1.15)).ceil();
                bought++;
            } else break;
        } else {
            if (count >= eff) {
                count -= eff;
                upgrade22Level += 1;
                upgrade22Cost = Math.ceil(upgrade22Cost * 1.15);
                bought++;
            } else break;
        }
    }
    if (bought > 0) {
        try { playSfx('audio/purchase.wav'); } catch (e) {}
        try { window.__lastBoughtButton = 'upgrade22'; } catch (e) {}
        updateDisplays();
        try { setTimeout(animateLastBoughtButton, 40); } catch (e) {}
    }
    else alert('Not enough What Happeneds — need ' + formatNumber(computeBatchCostWithSimpleVillager(typeof upgrade22Cost !== 'undefined' ? upgrade22Cost : 1000000000000000000, purchaseBatch || 1, 1.15)) + '.');
}

function buyUpgrade23() {
    const btn = document.getElementById('upgrade23');
    let bought = 0;
    for (let i = 0; i < purchaseBatch; i++) {
        var eff = effectiveUpgradeCost(upgrade23Cost);
        if (hasDecimal) {
            if ((isDecimalInstance(count) ? count : D(count)).gte(eff)) {
                count = (isDecimalInstance(count) ? count : D(count)).minus(eff);
                upgrade23Level = (isDecimalInstance(upgrade23Level) ? upgrade23Level : D(upgrade23Level)).plus(D(1));
                upgrade23Cost = D(upgrade23Cost).times(D(1.15)).ceil();
                bought++;
            } else break;
        } else {
            if (count >= eff) {
                count -= eff;
                upgrade23Level += 1;
                upgrade23Cost = Math.ceil(upgrade23Cost * 1.15);
                bought++;
            } else break;
        }
    }
    if (bought > 0) {
        try { playSfx('audio/purchase.wav'); } catch (e) {}
        try { window.__lastBoughtButton = 'upgrade23'; } catch (e) {}
        updateDisplays();
        try { setTimeout(animateLastBoughtButton, 40); } catch (e) {}
    }
    else alert('Not enough What Happeneds — need ' + formatNumber(computeBatchCostWithSimpleVillager(typeof upgrade23Cost !== 'undefined' ? upgrade23Cost : 5000000000000000000, purchaseBatch || 1, 1.15)) + '.');
}

function buyUpgrade24() {
    const btn = document.getElementById('upgrade24');
    let bought = 0;
    for (let i = 0; i < purchaseBatch; i++) {
        var eff = effectiveUpgradeCost(upgrade24Cost);
        if (hasDecimal) {
            if ((isDecimalInstance(count) ? count : D(count)).gte(eff)) {
                count = (isDecimalInstance(count) ? count : D(count)).minus(eff);
                upgrade24Level = (isDecimalInstance(upgrade24Level) ? upgrade24Level : D(upgrade24Level)).plus(D(1));
                upgrade24Cost = D(upgrade24Cost).times(D(1.15)).ceil();
                bought++;
            } else break;
        } else {
            if (count >= eff) {
                count -= eff;
                upgrade24Level += 1;
                upgrade24Cost = Math.ceil(upgrade24Cost * 1.15);
                bought++;
            } else break;
        }
    }
    if (bought > 0) {
        try { playSfx('audio/purchase.wav'); } catch (e) {}
        try { window.__lastBoughtButton = 'upgrade24'; } catch (e) {}
        updateDisplays();
        try { setTimeout(animateLastBoughtButton, 40); } catch (e) {}
    }
    else alert('Not enough What Happeneds — need ' + formatNumber(computeBatchCostWithSimpleVillager(typeof upgrade24Cost !== 'undefined' ? upgrade24Cost : 30000000000000000000, purchaseBatch || 1, 1.15)) + '.');
}

// SCP special purchases (each doubles SCP contribution)
function buyScp1() {
    if (numericLevel(upgrade17Level) < 10) { alert('Unlocks at SCP level 10'); return; }
    if (scp1Purchased) { alert('Already purchased'); return; }
    if (hasDecimal) {
        if ((isDecimalInstance(count) ? count : D(count)).gte(D(scp1Cost))) {
            count = (isDecimalInstance(count) ? count : D(count)).minus(D(scp1Cost));
            scp1Purchased = true;
            if (hasDecimal) scpMultiplier = (isDecimalInstance(scpMultiplier) ? scpMultiplier.times(D(2)) : D(scpMultiplier).times(D(2))); else scpMultiplier = scpMultiplier * 2;
            updateDisplays();
        } else alert('Not enough What Happeneds');
    } else {
        if (count >= scp1Cost) {
            count -= scp1Cost; scp1Purchased = true; scpMultiplier = scpMultiplier * 2; updateDisplays();
        } else alert('Not enough What Happeneds');
    }
}

function buyScp2() {
    if (numericLevel(upgrade17Level) < 25) { alert('Unlocks at SCP level 25'); return; }
    if (scp2Purchased) { alert('Already purchased'); return; }
    if (hasDecimal) {
        if ((isDecimalInstance(count) ? count : D(count)).gte(D(scp2Cost))) {
            count = (isDecimalInstance(count) ? count : D(count)).minus(D(scp2Cost));
            scp2Purchased = true;
            if (hasDecimal) scpMultiplier = (isDecimalInstance(scpMultiplier) ? scpMultiplier.times(D(2)) : D(scpMultiplier).times(D(2))); else scpMultiplier = scpMultiplier * 2;
            updateDisplays();
        } else alert('Not enough What Happeneds');
    } else {
        if (count >= scp2Cost) {
            count -= scp2Cost; scp2Purchased = true; scpMultiplier = scpMultiplier * 2; updateDisplays();
        } else alert('Not enough What Happeneds');
    }
}

function buyScp3() {
    if (numericLevel(upgrade17Level) < 50) { alert('Unlocks at SCP level 50'); return; }
    if (scp3Purchased) { alert('Already purchased'); return; }
    if (hasDecimal) {
        if ((isDecimalInstance(count) ? count : D(count)).gte(D(scp3Cost))) {
            count = (isDecimalInstance(count) ? count : D(count)).minus(D(scp3Cost));
            scp3Purchased = true;
            if (hasDecimal) scpMultiplier = (isDecimalInstance(scpMultiplier) ? scpMultiplier.times(D(2)) : D(scpMultiplier).times(D(2))); else scpMultiplier = scpMultiplier * 2;
            updateDisplays();
        } else alert('Not enough What Happeneds');
    } else {
        if (count >= scp3Cost) {
            count -= scp3Cost; scp3Purchased = true; scpMultiplier = scpMultiplier * 2; updateDisplays();
        } else alert('Not enough What Happeneds');
    }
}

function buyScp4() {
    if (numericLevel(upgrade17Level) < 75) { alert('Unlocks at SCP level 75'); return; }
    if (scp4Purchased) { alert('Already purchased'); return; }
    if (hasDecimal) {
        if ((isDecimalInstance(count) ? count : D(count)).gte(D(scp4Cost))) {
            count = (isDecimalInstance(count) ? count : D(count)).minus(D(scp4Cost));
            scp4Purchased = true;
            if (hasDecimal) scpMultiplier = (isDecimalInstance(scpMultiplier) ? scpMultiplier.times(D(2)) : D(scpMultiplier).times(D(2))); else scpMultiplier = scpMultiplier * 2;
            updateDisplays();
        } else alert('Not enough What Happeneds');
    } else {
        if (count >= scp4Cost) {
            count -= scp4Cost; scp4Purchased = true; scpMultiplier = scpMultiplier * 2; updateDisplays();
        } else alert('Not enough What Happeneds');
    }
}

// Good Noodles specials (one-time multipliers applied to upgrade22 contribution)
function buyGoodNoodles1() {
    if (goodNoodles1Purchased) { alert('Already purchased.'); return; }
    if (numericLevel(upgrade22Level) < 10) { alert('Unlocks at Good Noodles lvl 10.'); return; }
    if (hasDecimal) {
        if ((isDecimalInstance(count) ? count : D(count)).lt(D(goodNoodles1Cost))) { alert('Not enough What Happeneds — need ' + formatNumber(goodNoodles1Cost) + '.'); return; }
        count = (isDecimalInstance(count) ? count : D(count)).minus(D(goodNoodles1Cost));
    } else {
        if (count < goodNoodles1Cost) { alert('Not enough What Happeneds — need ' + formatNumber(goodNoodles1Cost) + '.'); return; }
        count -= goodNoodles1Cost;
    }
    goodNoodles1Purchased = true;
    if (hasDecimal) goodNoodlesMultiplier = (isDecimalInstance(goodNoodlesMultiplier) ? goodNoodlesMultiplier : D(goodNoodlesMultiplier)).times(D(1.5));
    else goodNoodlesMultiplier *= 1.5;
    saveGame(); try { playSfx('audio/purchase.wav'); } catch (e) {} updateDisplays();
}

function buyGoodNoodles2() {
    if (goodNoodles2Purchased) { alert('Already purchased.'); return; }
    if (numericLevel(upgrade22Level) < 25) { alert('Unlocks at Good Noodles lvl 25.'); return; }
    if (hasDecimal) {
        if ((isDecimalInstance(count) ? count : D(count)).lt(D(goodNoodles2Cost))) { alert('Not enough What Happeneds — need ' + formatNumber(goodNoodles2Cost) + '.'); return; }
        count = (isDecimalInstance(count) ? count : D(count)).minus(D(goodNoodles2Cost));
    } else {
        if (count < goodNoodles2Cost) { alert('Not enough What Happeneds — need ' + formatNumber(goodNoodles2Cost) + '.'); return; }
        count -= goodNoodles2Cost;
    }
    goodNoodles2Purchased = true;
    if (hasDecimal) goodNoodlesMultiplier = (isDecimalInstance(goodNoodlesMultiplier) ? goodNoodlesMultiplier : D(goodNoodlesMultiplier)).times(D(2));
    else goodNoodlesMultiplier *= 2;
    saveGame(); try { playSfx('audio/purchase.wav'); } catch (e) {} updateDisplays();
}

function buyGoodNoodles3() {
    if (goodNoodles3Purchased) { alert('Already purchased.'); return; }
    if (numericLevel(upgrade22Level) < 50) { alert('Unlocks at Good Noodles lvl 50.'); return; }
    if (hasDecimal) {
        if ((isDecimalInstance(count) ? count : D(count)).lt(D(goodNoodles3Cost))) { alert('Not enough What Happeneds — need ' + formatNumber(goodNoodles3Cost) + '.'); return; }
        count = (isDecimalInstance(count) ? count : D(count)).minus(D(goodNoodles3Cost));
    } else {
        if (count < goodNoodles3Cost) { alert('Not enough What Happeneds — need ' + formatNumber(goodNoodles3Cost) + '.'); return; }
        count -= goodNoodles3Cost;
    }
    goodNoodles3Purchased = true;
    if (hasDecimal) goodNoodlesMultiplier = (isDecimalInstance(goodNoodlesMultiplier) ? goodNoodlesMultiplier : D(goodNoodlesMultiplier)).times(D(2.5));
    else goodNoodlesMultiplier *= 2.5;
    saveGame(); try { playSfx('audio/purchase.wav'); } catch (e) {} updateDisplays();
}

function buyGoodNoodles4() {
    if (goodNoodles4Purchased) { alert('Already purchased.'); return; }
    if (numericLevel(upgrade22Level) < 100) { alert('Unlocks at Good Noodles lvl 100.'); return; }
    if (hasDecimal) {
        if ((isDecimalInstance(count) ? count : D(count)).lt(D(goodNoodles4Cost))) { alert('Not enough What Happeneds — need ' + formatNumber(goodNoodles4Cost) + '.'); return; }
        count = (isDecimalInstance(count) ? count : D(count)).minus(D(goodNoodles4Cost));
    } else {
        if (count < goodNoodles4Cost) { alert('Not enough What Happeneds — need ' + formatNumber(goodNoodles4Cost) + '.'); return; }
        count -= goodNoodles4Cost;
    }
    goodNoodles4Purchased = true;
    if (hasDecimal) goodNoodlesMultiplier = (isDecimalInstance(goodNoodlesMultiplier) ? goodNoodlesMultiplier : D(goodNoodlesMultiplier)).times(D(3));
    else goodNoodlesMultiplier *= 3;
    saveGame(); try { playSfx('audio/purchase.wav'); } catch (e) {} updateDisplays();
}

// Mobile Man 38 specials (one-time multipliers applied to upgrade23 contribution)
function buyMobileMan381() {
    if (mobileMan381Purchased) { alert('Already purchased.'); return; }
    if (numericLevel(upgrade23Level) < 10) { alert('Unlocks at Mobile Man 38 lvl 10.'); return; }
    if (hasDecimal) {
        if ((isDecimalInstance(count) ? count : D(count)).lt(D(mobileMan381Cost))) { alert('Not enough What Happeneds — need ' + formatNumber(mobileMan381Cost) + '.'); return; }
        count = (isDecimalInstance(count) ? count : D(count)).minus(D(mobileMan381Cost));
    } else {
        if (count < mobileMan381Cost) { alert('Not enough What Happeneds — need ' + formatNumber(mobileMan381Cost) + '.'); return; }
        count -= mobileMan381Cost;
    }
    mobileMan381Purchased = true;
    if (hasDecimal) mobileMan38Multiplier = (isDecimalInstance(mobileMan38Multiplier) ? mobileMan38Multiplier : D(mobileMan38Multiplier)).times(D(1.5));
    else mobileMan38Multiplier *= 1.5;
    saveGame(); try { playSfx('audio/purchase.wav'); } catch (e) {} updateDisplays();
}

function buyMobileMan382() {
    if (mobileMan382Purchased) { alert('Already purchased.'); return; }
    if (numericLevel(upgrade23Level) < 25) { alert('Unlocks at Mobile Man 38 lvl 25.'); return; }
    if (hasDecimal) {
        if ((isDecimalInstance(count) ? count : D(count)).lt(D(mobileMan382Cost))) { alert('Not enough What Happeneds — need ' + formatNumber(mobileMan382Cost) + '.'); return; }
        count = (isDecimalInstance(count) ? count : D(count)).minus(D(mobileMan382Cost));
    } else {
        if (count < mobileMan382Cost) { alert('Not enough What Happeneds — need ' + formatNumber(mobileMan382Cost) + '.'); return; }
        count -= mobileMan382Cost;
    }
    mobileMan382Purchased = true;
    if (hasDecimal) mobileMan38Multiplier = (isDecimalInstance(mobileMan38Multiplier) ? mobileMan38Multiplier : D(mobileMan38Multiplier)).times(D(2));
    else mobileMan38Multiplier *= 2;
    saveGame(); try { playSfx('audio/purchase.wav'); } catch (e) {} updateDisplays();
}

function buyMobileMan383() {
    if (mobileMan383Purchased) { alert('Already purchased.'); return; }
    if (numericLevel(upgrade23Level) < 50) { alert('Unlocks at Mobile Man 38 lvl 50.'); return; }
    if (hasDecimal) {
        if ((isDecimalInstance(count) ? count : D(count)).lt(D(mobileMan383Cost))) { alert('Not enough What Happeneds — need ' + formatNumber(mobileMan383Cost) + '.'); return; }
        count = (isDecimalInstance(count) ? count : D(count)).minus(D(mobileMan383Cost));
    } else {
        if (count < mobileMan383Cost) { alert('Not enough What Happeneds — need ' + formatNumber(mobileMan383Cost) + '.'); return; }
        count -= mobileMan383Cost;
    }
    mobileMan383Purchased = true;
    if (hasDecimal) mobileMan38Multiplier = (isDecimalInstance(mobileMan38Multiplier) ? mobileMan38Multiplier : D(mobileMan38Multiplier)).times(D(2.5));
    else mobileMan38Multiplier *= 2.5;
    saveGame(); try { playSfx('audio/purchase.wav'); } catch (e) {} updateDisplays();
}

function buyMobileMan384() {
    if (mobileMan384Purchased) { alert('Already purchased.'); return; }
    if (numericLevel(upgrade23Level) < 100) { alert('Unlocks at Mobile Man 38 lvl 100.'); return; }
    if (hasDecimal) {
        if ((isDecimalInstance(count) ? count : D(count)).lt(D(mobileMan384Cost))) { alert('Not enough What Happeneds — need ' + formatNumber(mobileMan384Cost) + '.'); return; }
        count = (isDecimalInstance(count) ? count : D(count)).minus(D(mobileMan384Cost));
    } else {
        if (count < mobileMan384Cost) { alert('Not enough What Happeneds — need ' + formatNumber(mobileMan384Cost) + '.'); return; }
        count -= mobileMan384Cost;
    }
    mobileMan384Purchased = true;
    if (hasDecimal) mobileMan38Multiplier = (isDecimalInstance(mobileMan38Multiplier) ? mobileMan38Multiplier : D(mobileMan38Multiplier)).times(D(3));
    else mobileMan38Multiplier *= 3;
    saveGame(); try { playSfx('audio/purchase.wav'); } catch (e) {} updateDisplays();
}

// Easton Bundy special purchases (one-time multipliers applied to upgrade24 contribution)
function buyEastonBundy1() {
    if (eastonBundy1Purchased) { alert('Already purchased.'); return; }
    if (numericLevel(upgrade24Level) < 10) { alert('Unlocks at Easton Bundy level 10.'); return; }
    if (hasDecimal) {
        if ((isDecimalInstance(count) ? count : D(count)).lt(D(eastonBundy1Cost))) { alert('Not enough What Happeneds — need ' + formatNumber(eastonBundy1Cost) + '.'); return; }
        count = (isDecimalInstance(count) ? count : D(count)).minus(D(eastonBundy1Cost));
    } else {
        if (count < eastonBundy1Cost) { alert('Not enough What Happeneds — need ' + formatNumber(eastonBundy1Cost) + '.'); return; }
        count -= eastonBundy1Cost;
    }
    eastonBundy1Purchased = true;
    if (hasDecimal) eastonBundyMultiplier = (isDecimalInstance(eastonBundyMultiplier) ? eastonBundyMultiplier : D(eastonBundyMultiplier)).times(D(1.5));
    else eastonBundyMultiplier *= 1.5;
    saveGame(); try { playSfx('audio/purchase.wav'); } catch (e) {} updateDisplays();
}

function buyEastonBundy2() {
    if (eastonBundy2Purchased) { alert('Already purchased.'); return; }
    if (numericLevel(upgrade24Level) < 25) { alert('Unlocks at Easton Bundy level 25.'); return; }
    if (hasDecimal) {
        if ((isDecimalInstance(count) ? count : D(count)).lt(D(eastonBundy2Cost))) { alert('Not enough What Happeneds — need ' + formatNumber(eastonBundy2Cost) + '.'); return; }
        count = (isDecimalInstance(count) ? count : D(count)).minus(D(eastonBundy2Cost));
    } else {
        if (count < eastonBundy2Cost) { alert('Not enough What Happeneds — need ' + formatNumber(eastonBundy2Cost) + '.'); return; }
        count -= eastonBundy2Cost;
    }
    eastonBundy2Purchased = true;
    if (hasDecimal) eastonBundyMultiplier = (isDecimalInstance(eastonBundyMultiplier) ? eastonBundyMultiplier : D(eastonBundyMultiplier)).times(D(2));
    else eastonBundyMultiplier *= 2;
    saveGame(); try { playSfx('audio/purchase.wav'); } catch (e) {} updateDisplays();
}

function buyEastonBundy3() {
    if (eastonBundy3Purchased) { alert('Already purchased.'); return; }
    if (numericLevel(upgrade24Level) < 50) { alert('Unlocks at Easton Bundy level 50.'); return; }
    if (hasDecimal) {
        if ((isDecimalInstance(count) ? count : D(count)).lt(D(eastonBundy3Cost))) { alert('Not enough What Happeneds — need ' + formatNumber(eastonBundy3Cost) + '.'); return; }
        count = (isDecimalInstance(count) ? count : D(count)).minus(D(eastonBundy3Cost));
    } else {
        if (count < eastonBundy3Cost) { alert('Not enough What Happeneds — need ' + formatNumber(eastonBundy3Cost) + '.'); return; }
        count -= eastonBundy3Cost;
    }
    eastonBundy3Purchased = true;
    if (hasDecimal) eastonBundyMultiplier = (isDecimalInstance(eastonBundyMultiplier) ? eastonBundyMultiplier : D(eastonBundyMultiplier)).times(D(2.5));
    else eastonBundyMultiplier *= 2.5;
    saveGame(); try { playSfx('audio/purchase.wav'); } catch (e) {} updateDisplays();
}

function buyEastonBundy4() {
    if (eastonBundy4Purchased) { alert('Already purchased.'); return; }
    if (numericLevel(upgrade24Level) < 100) { alert('Unlocks at Easton Bundy level 100.'); return; }
    if (hasDecimal) {
        if ((isDecimalInstance(count) ? count : D(count)).lt(D(eastonBundy4Cost))) { alert('Not enough What Happeneds — need ' + formatNumber(eastonBundy4Cost) + '.'); return; }
        count = (isDecimalInstance(count) ? count : D(count)).minus(D(eastonBundy4Cost));
    } else {
        if (count < eastonBundy4Cost) { alert('Not enough What Happeneds — need ' + formatNumber(eastonBundy4Cost) + '.'); return; }
        count -= eastonBundy4Cost;
    }
    eastonBundy4Purchased = true;
    if (hasDecimal) eastonBundyMultiplier = (isDecimalInstance(eastonBundyMultiplier) ? eastonBundyMultiplier : D(eastonBundyMultiplier)).times(D(3));
    else eastonBundyMultiplier *= 3;
    saveGame(); try { playSfx('audio/purchase.wav'); } catch (e) {} updateDisplays();
}

// Ropingnecurse special purchases (one-time multipliers applied to upgrade13 contribution)
function buyRoping1() {
    if (roping1Purchased) { alert('Already purchased.'); return; }
    if (upgrade13Level < 10) { alert('Unlocks at ropingnecurse level 10.'); return; }
    if (hasDecimal) {
        if ((isDecimalInstance(count) ? count : D(count)).lt(D(roping1Cost))) { alert('Not enough What Happeneds — need ' + formatNumber(roping1Cost) + '.'); return; }
        count = (isDecimalInstance(count) ? count : D(count)).minus(D(roping1Cost));
    } else {
        if (count < roping1Cost) { alert('Not enough What Happeneds — need ' + formatNumber(roping1Cost) + '.'); return; }
        count -= roping1Cost;
    }
    roping1Purchased = true;
    if (hasDecimal) ropingOtherMultiplier = (isDecimalInstance(ropingOtherMultiplier) ? ropingOtherMultiplier : D(ropingOtherMultiplier)).times(D(roping1Multiplier));
    else {
        if (hasDecimal) ropingOtherMultiplier = (isDecimalInstance(ropingOtherMultiplier) ? ropingOtherMultiplier : D(ropingOtherMultiplier)).times(D(roping1Multiplier));
        else ropingOtherMultiplier *= roping1Multiplier;
    }
    saveGame(); try { playSfx('audio/purchase.wav'); } catch (e) {} updateDisplays();
}

// EZ specials (ez villager) — one-time multipliers applied to upgrade16 contribution
function buyEz1() {
    if (ez1Purchased) { alert('Already purchased.'); return; }
    if (upgrade16Level < 10) { alert('Unlocks at ez villager level 10.'); return; }
    if (hasDecimal) {
        if ((isDecimalInstance(count) ? count : D(count)).lt(D(ez1Cost))) { alert('Not enough What Happeneds — need ' + formatNumber(ez1Cost) + '.'); return; }
        count = (isDecimalInstance(count) ? count : D(count)).minus(D(ez1Cost));
    } else {
        if (count < ez1Cost) { alert('Not enough What Happeneds — need ' + formatNumber(ez1Cost) + '.'); return; }
        count -= ez1Cost;
    }
    ez1Purchased = true;
    if (hasDecimal) ezOtherMultiplier = (isDecimalInstance(ezOtherMultiplier) ? ezOtherMultiplier : D(ezOtherMultiplier)).times(D(ez1Multiplier));
    else {
        if (hasDecimal) ezOtherMultiplier = (isDecimalInstance(ezOtherMultiplier) ? ezOtherMultiplier : D(ezOtherMultiplier)).times(D(ez1Multiplier));
        else ezOtherMultiplier *= ez1Multiplier;
    }
    saveGame(); try { playSfx('audio/purchase.wav'); } catch (e) {} updateDisplays();
}

function buyEz2() {
    if (ez2Purchased) { alert('Already purchased.'); return; }
    if (upgrade16Level < 25) { alert('Unlocks at ez villager level 25.'); return; }
    if (hasDecimal) {
        if ((isDecimalInstance(count) ? count : D(count)).lt(D(ez2Cost))) { alert('Not enough What Happeneds — need ' + formatNumber(ez2Cost) + '.'); return; }
        count = (isDecimalInstance(count) ? count : D(count)).minus(D(ez2Cost));
    } else {
        if (count < ez2Cost) { alert('Not enough What Happeneds — need ' + formatNumber(ez2Cost) + '.'); return; }
        count -= ez2Cost;
    }
    ez2Purchased = true;
    if (hasDecimal) ezOtherMultiplier = (isDecimalInstance(ezOtherMultiplier) ? ezOtherMultiplier : D(ezOtherMultiplier)).times(D(ez2Multiplier));
    else {
        if (hasDecimal) ezOtherMultiplier = (isDecimalInstance(ezOtherMultiplier) ? ezOtherMultiplier : D(ezOtherMultiplier)).times(D(ez2Multiplier));
        else ezOtherMultiplier *= ez2Multiplier;
    }
    saveGame(); try { playSfx('purchase.wav'); } catch (e) {} updateDisplays();
}

function buyEz3() {
    if (ez3Purchased) { alert('Already purchased.'); return; }
    if (upgrade16Level < 50) { alert('Unlocks at ez villager level 50.'); return; }
    if (hasDecimal) {
        if ((isDecimalInstance(count) ? count : D(count)).lt(D(ez3Cost))) { alert('Not enough What Happeneds — need ' + formatNumber(ez3Cost) + '.'); return; }
        count = (isDecimalInstance(count) ? count : D(count)).minus(D(ez3Cost));
        ez3Purchased = true;
        ezOtherMultiplier = (isDecimalInstance(ezOtherMultiplier) ? ezOtherMultiplier : D(ezOtherMultiplier)).times(D(ez3Multiplier));
    } else {
        if (count < ez3Cost) { alert('Not enough What Happeneds — need ' + formatNumber(ez3Cost) + '.'); return; }
        count -= ez3Cost;
        ez3Purchased = true;
        if (hasDecimal) ezOtherMultiplier = (isDecimalInstance(ezOtherMultiplier) ? ezOtherMultiplier : D(ezOtherMultiplier)).times(D(ez3Multiplier));
        else ezOtherMultiplier *= ez3Multiplier;
    }
    saveGame(); try { playSfx('purchase.wav'); } catch (e) {} updateDisplays();
}

function buyEz4() {
    if (ez4Purchased) { alert('Already purchased.'); return; }
    if (upgrade16Level < 100) { alert('Unlocks at ez villager level 100.'); return; }
    if (hasDecimal) {
        if ((isDecimalInstance(count) ? count : D(count)).lt(D(ez4Cost))) { alert('Not enough What Happeneds — need ' + formatNumber(ez4Cost) + '.'); return; }
        count = (isDecimalInstance(count) ? count : D(count)).minus(D(ez4Cost));
    } else {
        if (count < ez4Cost) { alert('Not enough What Happeneds — need ' + formatNumber(ez4Cost) + '.'); return; }
        count -= ez4Cost;
    }
    ez4Purchased = true;
    if (hasDecimal) ezOtherMultiplier = (isDecimalInstance(ezOtherMultiplier) ? ezOtherMultiplier : D(ezOtherMultiplier)).times(D(ez4Multiplier));
    else {
        if (hasDecimal) ezOtherMultiplier = (isDecimalInstance(ezOtherMultiplier) ? ezOtherMultiplier : D(ezOtherMultiplier)).times(D(ez4Multiplier));
        else ezOtherMultiplier *= ez4Multiplier;
    }
    saveGame(); try { playSfx('purchase.wav'); } catch (e) {} updateDisplays();
}

function buyRoping2() {
    if (roping2Purchased) { alert('Already purchased.'); return; }
    if (upgrade13Level < 25) { alert('Unlocks at ropingnecurse level 25.'); return; }
    if (hasDecimal) {
        if ((isDecimalInstance(count) ? count : D(count)).lt(D(roping2Cost))) { alert('Not enough What Happeneds — need ' + formatNumber(roping2Cost) + '.'); return; }
        count = (isDecimalInstance(count) ? count : D(count)).minus(D(roping2Cost));
    } else {
        if (count < roping2Cost) { alert('Not enough What Happeneds — need ' + formatNumber(roping2Cost) + '.'); return; }
        count -= roping2Cost;
    }
    roping2Purchased = true;
    if (hasDecimal) ropingOtherMultiplier = (isDecimalInstance(ropingOtherMultiplier) ? ropingOtherMultiplier : D(ropingOtherMultiplier)).times(D(roping2Multiplier));
    else {
        if (hasDecimal) ropingOtherMultiplier = (isDecimalInstance(ropingOtherMultiplier) ? ropingOtherMultiplier : D(ropingOtherMultiplier)).times(D(roping2Multiplier));
        else ropingOtherMultiplier *= roping2Multiplier;
    }
    saveGame(); try { playSfx('purchase.wav'); } catch (e) {} updateDisplays();
}

function buyRoping3() {
    if (roping3Purchased) { alert('Already purchased.'); return; }
    if (upgrade13Level < 50) { alert('Unlocks at ropingnecurse level 50.'); return; }
    if (hasDecimal) {
        if ((isDecimalInstance(count) ? count : D(count)).lt(D(roping3Cost))) { alert('Not enough What Happeneds — need ' + formatNumber(roping3Cost) + '.'); return; }
        count = (isDecimalInstance(count) ? count : D(count)).minus(D(roping3Cost));
    } else {
        if (count < roping3Cost) { alert('Not enough What Happeneds — need ' + formatNumber(roping3Cost) + '.'); return; }
        count -= roping3Cost;
    }
    roping3Purchased = true;
    if (hasDecimal) ropingOtherMultiplier = (isDecimalInstance(ropingOtherMultiplier) ? ropingOtherMultiplier : D(ropingOtherMultiplier)).times(D(roping3Multiplier));
    else {
        if (hasDecimal) ropingOtherMultiplier = (isDecimalInstance(ropingOtherMultiplier) ? ropingOtherMultiplier : D(ropingOtherMultiplier)).times(D(roping3Multiplier));
        else ropingOtherMultiplier *= roping3Multiplier;
    }
    saveGame(); try { playSfx('purchase.wav'); } catch (e) {} updateDisplays();
}

function buyRoping4() {
    if (roping4Purchased) { alert('Already purchased.'); return; }
    if (upgrade13Level < 75) { alert('Unlocks at ropingnecurse level 75.'); return; }
    if (hasDecimal) {
        if ((isDecimalInstance(count) ? count : D(count)).lt(D(roping4Cost))) { alert('Not enough What Happeneds — need ' + formatNumber(roping4Cost) + '.'); return; }
        count = (isDecimalInstance(count) ? count : D(count)).minus(D(roping4Cost));
    } else {
        if (count < roping4Cost) { alert('Not enough What Happeneds — need ' + formatNumber(roping4Cost) + '.'); return; }
        count -= roping4Cost;
    }
    roping4Purchased = true;
    if (hasDecimal) ropingOtherMultiplier = (isDecimalInstance(ropingOtherMultiplier) ? ropingOtherMultiplier : D(ropingOtherMultiplier)).times(D(roping4Multiplier));
    else {
        if (hasDecimal) ropingOtherMultiplier = (isDecimalInstance(ropingOtherMultiplier) ? ropingOtherMultiplier : D(ropingOtherMultiplier)).times(D(roping4Multiplier));
        else ropingOtherMultiplier *= roping4Multiplier;
    }
    saveGame(); try { playSfx('purchase.wav'); } catch (e) {} updateDisplays();
}

// Skibbidi scimitar special purchases (one-time multipliers applied to upgrade14 contribution)
function buySkibidi1() {
    if (skibidi1Purchased) { alert('Already purchased.'); return; }
    if (upgrade14Level < 10) { alert('Unlocks at skibbidi scimitar level 10.'); return; }
    if (hasDecimal) {
        if ((isDecimalInstance(count) ? count : D(count)).lt(D(skibidi1Cost))) { alert('Not enough What Happeneds — need ' + formatNumber(skibidi1Cost) + '.'); return; }
        count = (isDecimalInstance(count) ? count : D(count)).minus(D(skibidi1Cost));
    } else {
        if (count < skibidi1Cost) { alert('Not enough What Happeneds — need ' + formatNumber(skibidi1Cost) + '.'); return; }
        count -= skibidi1Cost;
    }
    skibidi1Purchased = true;
    if (hasDecimal) skibbidiOtherMultiplier = (isDecimalInstance(skibbidiOtherMultiplier) ? skibbidiOtherMultiplier : D(skibbidiOtherMultiplier)).times(D(skibidi1Multiplier));
    else {
        if (hasDecimal) skibbidiOtherMultiplier = (isDecimalInstance(skibbidiOtherMultiplier) ? skibbidiOtherMultiplier : D(skibbidiOtherMultiplier)).times(D(skibidi1Multiplier));
        else skibbidiOtherMultiplier *= skibidi1Multiplier;
    }
    saveGame(); try { playSfx('purchase.wav'); } catch (e) {} updateDisplays();
}

function buySkibidi2() {
    if (skibidi2Purchased) { alert('Already purchased.'); return; }
    if (upgrade14Level < 25) { alert('Unlocks at skibbidi scimitar level 25.'); return; }
    if (hasDecimal) {
        if ((isDecimalInstance(count) ? count : D(count)).lt(D(skibidi2Cost))) { alert('Not enough What Happeneds — need ' + formatNumber(skibidi2Cost) + '.'); return; }
        count = (isDecimalInstance(count) ? count : D(count)).minus(D(skibidi2Cost));
    } else {
        if (count < skibidi2Cost) { alert('Not enough What Happeneds — need ' + formatNumber(skibidi2Cost) + '.'); return; }
        count -= skibidi2Cost;
    }
    skibidi2Purchased = true;
    if (hasDecimal) skibbidiOtherMultiplier = (isDecimalInstance(skibbidiOtherMultiplier) ? skibbidiOtherMultiplier : D(skibbidiOtherMultiplier)).times(D(skibidi2Multiplier));
    else {
        if (hasDecimal) skibbidiOtherMultiplier = (isDecimalInstance(skibbidiOtherMultiplier) ? skibbidiOtherMultiplier : D(skibbidiOtherMultiplier)).times(D(skibidi2Multiplier));
        else skibbidiOtherMultiplier *= skibidi2Multiplier;
    }
    saveGame(); try { playSfx('purchase.wav'); } catch (e) {} updateDisplays();
}

function buySkibidi3() {
    if (skibidi3Purchased) { alert('Already purchased.'); return; }
    if (upgrade14Level < 50) { alert('Unlocks at skibbidi scimitar level 50.'); return; }
    if (hasDecimal) {
        if ((isDecimalInstance(count) ? count : D(count)).lt(D(skibidi3Cost))) { alert('Not enough What Happeneds — need ' + formatNumber(skibidi3Cost) + '.'); return; }
        count = (isDecimalInstance(count) ? count : D(count)).minus(D(skibidi3Cost));
    } else {
        if (count < skibidi3Cost) { alert('Not enough What Happeneds — need ' + formatNumber(skibidi3Cost) + '.'); return; }
        count -= skibidi3Cost;
    }
    skibidi3Purchased = true;
    if (hasDecimal) skibbidiOtherMultiplier = (isDecimalInstance(skibbidiOtherMultiplier) ? skibbidiOtherMultiplier : D(skibbidiOtherMultiplier)).times(D(skibidi3Multiplier));
    else {
        if (hasDecimal) skibbidiOtherMultiplier = (isDecimalInstance(skibbidiOtherMultiplier) ? skibbidiOtherMultiplier : D(skibbidiOtherMultiplier)).times(D(skibidi3Multiplier));
        else skibbidiOtherMultiplier *= skibidi3Multiplier;
    }
    saveGame(); try { playSfx('purchase.wav'); } catch (e) {} updateDisplays();
}

function buySkibidi4() {
    if (skibidi4Purchased) { alert('Already purchased.'); return; }
    if (upgrade14Level < 75) { alert('Unlocks at skibbidi scimitar level 75.'); return; }
    if (hasDecimal) {
        if ((isDecimalInstance(count) ? count : D(count)).lt(D(skibidi4Cost))) { alert('Not enough What Happeneds — need ' + formatNumber(skibidi4Cost) + '.'); return; }
        count = (isDecimalInstance(count) ? count : D(count)).minus(D(skibidi4Cost));
    } else {
        if (count < skibidi4Cost) { alert('Not enough What Happeneds — need ' + formatNumber(skibidi4Cost) + '.'); return; }
        count -= skibidi4Cost;
    }
    skibidi4Purchased = true;
    if (hasDecimal) skibbidiOtherMultiplier = (isDecimalInstance(skibbidiOtherMultiplier) ? skibbidiOtherMultiplier : D(skibbidiOtherMultiplier)).times(D(skibidi4Multiplier));
    else {
        if (hasDecimal) skibbidiOtherMultiplier = (isDecimalInstance(skibbidiOtherMultiplier) ? skibbidiOtherMultiplier : D(skibbidiOtherMultiplier)).times(D(skibbidi4Multiplier));
        else skibbidiOtherMultiplier *= skibidi4Multiplier;
    }
    saveGame(); try { playSfx('purchase.wav'); } catch (e) {} updateDisplays();
}

// Beats specials (What Happened Beats) — one-time multipliers applied to upgrade15 contribution
function buyBeats1() {
    if (beats1Purchased) { alert('Already purchased.'); return; }
    if (upgrade15Level < 10) { alert('Unlocks at What Happened Beats level 10.'); return; }
    if (hasDecimal) {
        if ((isDecimalInstance(count) ? count : D(count)).lt(D(beats1Cost))) { alert('Not enough What Happeneds — need ' + formatNumber(beats1Cost) + '.'); return; }
        count = (isDecimalInstance(count) ? count : D(count)).minus(D(beats1Cost));
    } else {
        if (count < beats1Cost) { alert('Not enough What Happeneds — need ' + formatNumber(beats1Cost) + '.'); return; }
        count -= beats1Cost;
    }
    beats1Purchased = true;
    if (hasDecimal) beatsOtherMultiplier = (isDecimalInstance(beatsOtherMultiplier) ? beatsOtherMultiplier : D(beatsOtherMultiplier)).times(D(beats1Multiplier));
    else {
        if (hasDecimal) beatsOtherMultiplier = (isDecimalInstance(beatsOtherMultiplier) ? beatsOtherMultiplier : D(beatsOtherMultiplier)).times(D(beats1Multiplier));
        else beatsOtherMultiplier *= beats1Multiplier;
    }
    saveGame(); try { playSfx('purchase.wav'); } catch (e) {} updateDisplays();
}

function buyBeats2() {
    if (beats2Purchased) { alert('Already purchased.'); return; }
    if (upgrade15Level < 25) { alert('Unlocks at What Happened Beats level 25.'); return; }
    if (hasDecimal) {
        if ((isDecimalInstance(count) ? count : D(count)).lt(D(beats2Cost))) { alert('Not enough What Happeneds — need ' + formatNumber(beats2Cost) + '.'); return; }
        count = (isDecimalInstance(count) ? count : D(count)).minus(D(beats2Cost));
    } else {
        if (count < beats2Cost) { alert('Not enough What Happeneds — need ' + formatNumber(beats2Cost) + '.'); return; }
        count -= beats2Cost;
    }
    beats2Purchased = true;
    if (hasDecimal) beatsOtherMultiplier = (isDecimalInstance(beatsOtherMultiplier) ? beatsOtherMultiplier : D(beatsOtherMultiplier)).times(D(beats2Multiplier));
    else {
        if (hasDecimal) beatsOtherMultiplier = (isDecimalInstance(beatsOtherMultiplier) ? beatsOtherMultiplier : D(beatsOtherMultiplier)).times(D(beats2Multiplier));
        else beatsOtherMultiplier *= beats2Multiplier;
    }
    saveGame(); try { playSfx('purchase.wav'); } catch (e) {} updateDisplays();
}

function buyBeats3() {
    if (beats3Purchased) { alert('Already purchased.'); return; }
    if (upgrade15Level < 50) { alert('Unlocks at What Happened Beats level 50.'); return; }
    if (hasDecimal) {
        if ((isDecimalInstance(count) ? count : D(count)).lt(D(beats3Cost))) { alert('Not enough What Happeneds — need ' + formatNumber(beats3Cost) + '.'); return; }
        count = (isDecimalInstance(count) ? count : D(count)).minus(D(beats3Cost));
        beats3Purchased = true;
        beatsOtherMultiplier = (isDecimalInstance(beatsOtherMultiplier) ? beatsOtherMultiplier : D(beatsOtherMultiplier)).times(D(beats3Multiplier));
    } else {
        if (count < beats3Cost) { alert('Not enough What Happeneds — need ' + formatNumber(beats3Cost) + '.'); return; }
        count -= beats3Cost;
        beats3Purchased = true;
        if (hasDecimal) beatsOtherMultiplier = (isDecimalInstance(beatsOtherMultiplier) ? beatsOtherMultiplier : D(beatsOtherMultiplier)).times(D(beats3Multiplier));
        else beatsOtherMultiplier *= beats3Multiplier;
    }
    saveGame(); try { playSfx('purchase.wav'); } catch (e) {} updateDisplays();
}

function buyDivineArgon() {
    if (goldenWhat < divineArgonCost) {
        alert('Not enough Golden What Happeneds — need ' + divineArgonCost + '.');
        return;
    }
    // spend golden currency
    goldenWhat -= divineArgonCost;
    divineArgonLevel += 1;
    // next cost multiplies by 3
    divineArgonCost = Math.max(1, Math.ceil(divineArgonCost * 3));
    saveGame();
    updateDisplays();
    try { updateShopUI(); } catch (e) {}
}

function buyDivineSomalian() {
    if (goldenWhat < divineSomalianCost) {
        alert('Not enough Golden What Happeneds — need ' + divineSomalianCost + '.');
        return;
    }
    // spend golden currency
    goldenWhat -= divineSomalianCost;
    divineSomalianLevel += 1;
    // next cost multiplies by 3
    divineSomalianCost = Math.max(1, Math.ceil(divineSomalianCost * 3));
    saveGame();
    updateDisplays();
}

function buyDivineAssassin() {
    // enforce max level cap
    if (typeof divineAssassinLevel === 'number' && divineAssassinLevel >= 19) {
        alert('Divine Assassin is already at max level (19).');
        return;
    }
    if (goldenWhat < divineAssassinCost) {
        alert('Not enough Golden What Happeneds — need ' + divineAssassinCost + '.');
        return;
    }
    goldenWhat -= divineAssassinCost;
    divineAssassinLevel = (typeof divineAssassinLevel === 'number' ? divineAssassinLevel : 0) + 1;
    // cost doubles each purchase
    divineAssassinCost = Math.max(1, Math.ceil(divineAssassinCost * 2));
    saveGame();
    updateDisplays();
}

function buyDivineCollector() {
    if (typeof divineCollectorCost === 'undefined') divineCollectorCost = 1;
    if (goldenWhat < divineCollectorCost) {
        alert('Not enough Golden What Happeneds — need ' + divineCollectorCost + '.');
        return;
    }
    goldenWhat -= divineCollectorCost;
    divineCollectorLevel += 1;
    // cost doubles each purchase
    divineCollectorCost = Math.max(1, Math.ceil(divineCollectorCost * 2));
    saveGame();
    updateDisplays();
}

function buyDivineMoneyMan() {
    if (typeof divineMoneyManCost === 'undefined') divineMoneyManCost = 1;
    if (goldenWhat < divineMoneyManCost) {
        alert('Not enough Golden What Happeneds — need ' + divineMoneyManCost + '.');
        return;
    }
    goldenWhat -= divineMoneyManCost;
    divineMoneyManLevel += 1;
    // cost progression: first -> 1, next -> 2, after that -> prev*2 - 1
    if (divineMoneyManLevel === 1) {
        divineMoneyManCost = 2;
    } else {
        divineMoneyManCost = Math.max(1, Math.ceil(divineMoneyManCost * 2 - 1));
    }
    saveGame();
    updateDisplays();
}

function buyDivineSpirit() {
    try {
        console.log('Attempting buyDivineSpirit', { goldenWhat, divineSpiritCost, hasDecimal });
        if (typeof divineSpiritCost === 'undefined') divineSpiritCost = (hasDecimal ? D(1) : 1);
        if (!goldenCanAfford(divineSpiritCost)) {
            console.warn('buyDivineSpirit: insufficient golden', { goldenWhat, cost: divineSpiritCost });
            alert('Not enough Golden What Happeneds — need ' + (typeof divineSpiritCost === 'object' && typeof divineSpiritCost.toString === 'function' ? divineSpiritCost.toString() : String(divineSpiritCost)) + '.');
            return;
        }
        // spend golden and increase level (Decimal-aware)
        if (hasDecimal) {
            const costDec = isDecimalInstance(divineSpiritCost) ? divineSpiritCost : D(divineSpiritCost);
            if (isDecimalInstance(goldenWhat)) {
                goldenWhat = goldenWhat.minus(costDec);
            } else {
                goldenWhat = D(goldenWhat || 0).minus(costDec);
            }
        } else {
            goldenWhat = (typeof goldenWhat === 'number' ? goldenWhat : Number(goldenWhat || 0)) - Number(divineSpiritCost);
        }
        divineSpiritLevel = (typeof divineSpiritLevel === 'number' ? divineSpiritLevel : 0) + 1;
        // next cost follows Fibonacci-like sequence: fib(level+1) where fib(1)=1,fib(2)=2
        const nextIndex = (divineSpiritLevel || 0) + 1;
        const nextCost = fibNumber(nextIndex);
        divineSpiritCost = (hasDecimal ? D(nextCost) : nextCost);
        saveGame();
        updateDisplays();
        console.log('buyDivineSpirit: success', { goldenWhat, divineSpiritLevel, divineSpiritCost });
    } catch (err) {
        console.error('buyDivineSpirit error', err);
        alert('An error occurred while purchasing Divine Spirit. See console for details.');
    }
}

// shop purchase for Divine Spirit (uses gems/diamonds, not golden currency)
function buyDivineShopItem() {
    try {
        if (shopDivinePurchased) return;
        const costGems = 20;
        if ((typeof diamonds === 'undefined' ? 0 : Number(diamonds || 0)) < costGems) {
            alert('Not enough gems — need ' + costGems + '.');
            return;
        }
        diamonds = (typeof diamonds === 'number' ? diamonds : Number(diamonds || 0)) - costGems;
        shopDivinePurchased = true;
        saveGame(); try { playSfx('purchase.wav'); } catch (e) {}
        try { updateShopUI(); } catch (e) {}
        try { updateDisplays(); } catch (e) {}
    } catch (e) { console.error('buyDivineShopItem error', e); }
}

function buyDivineSimpleVillager() {
    if (typeof divineSimpleVillagerCost === 'undefined') divineSimpleVillagerCost = 1;
    if (goldenWhat < divineSimpleVillagerCost) {
        alert('Not enough Golden What Happeneds — need ' + divineSimpleVillagerCost + '.');
        return;
    }
    // spend golden and increase level
    goldenWhat -= divineSimpleVillagerCost;
    divineSimpleVillagerLevel = (typeof divineSimpleVillagerLevel === 'number' ? divineSimpleVillagerLevel : 0) + 1;
    // reduce normal prices by 10% (multiplicative), ensure minimum 1
    try {
        if (hasDecimal) {
            const p = D(0.9);
            // upgrade costs
            upgrade1Cost = (isDecimalInstance(upgrade1Cost) ? upgrade1Cost : D(upgrade1Cost)).times(p).floor(); if (upgrade1Cost.lt(1)) upgrade1Cost = D(1);
            upgrade2Cost = (isDecimalInstance(upgrade2Cost) ? upgrade2Cost : D(upgrade2Cost)).times(p).floor(); if (upgrade2Cost.lt(1)) upgrade2Cost = D(1);
            upgrade3Cost = (isDecimalInstance(upgrade3Cost) ? upgrade3Cost : D(upgrade3Cost)).times(p).floor(); if (upgrade3Cost.lt(1)) upgrade3Cost = D(1);
            upgrade4Cost = (isDecimalInstance(upgrade4Cost) ? upgrade4Cost : D(upgrade4Cost)).times(p).floor(); if (upgrade4Cost.lt(1)) upgrade4Cost = D(1);
            upgrade5Cost = (isDecimalInstance(upgrade5Cost) ? upgrade5Cost : D(upgrade5Cost)).times(p).floor(); if (upgrade5Cost.lt(1)) upgrade5Cost = D(1);
            upgrade6Cost = (isDecimalInstance(upgrade6Cost) ? upgrade6Cost : D(upgrade6Cost)).times(p).floor(); if (upgrade6Cost.lt(1)) upgrade6Cost = D(1);
            upgrade7Cost = (isDecimalInstance(upgrade7Cost) ? upgrade7Cost : D(upgrade7Cost)).times(p).floor(); if (upgrade7Cost.lt(1)) upgrade7Cost = D(1);
            upgrade8Cost = (isDecimalInstance(upgrade8Cost) ? upgrade8Cost : D(upgrade8Cost)).times(p).floor(); if (upgrade8Cost.lt(1)) upgrade8Cost = D(1);
            upgrade9Cost = (isDecimalInstance(upgrade9Cost) ? upgrade9Cost : D(upgrade9Cost)).times(p).floor(); if (upgrade9Cost.lt(1)) upgrade9Cost = D(1);
            upgrade10Cost = (isDecimalInstance(upgrade10Cost) ? upgrade10Cost : D(upgrade10Cost)).times(p).floor(); if (upgrade10Cost.lt(1)) upgrade10Cost = D(1);
            upgrade11Cost = (isDecimalInstance(upgrade11Cost) ? upgrade11Cost : D(upgrade11Cost)).times(p).floor(); if (upgrade11Cost.lt(1)) upgrade11Cost = D(1);
            upgrade12Cost = (isDecimalInstance(upgrade12Cost) ? upgrade12Cost : D(upgrade12Cost)).times(p).floor(); if (upgrade12Cost.lt(1)) upgrade12Cost = D(1);
            upgrade13Cost = (isDecimalInstance(upgrade13Cost) ? upgrade13Cost : D(upgrade13Cost)).times(p).floor(); if (upgrade13Cost.lt(1)) upgrade13Cost = D(1);
            upgrade14Cost = (isDecimalInstance(upgrade14Cost) ? upgrade14Cost : D(upgrade14Cost)).times(p).floor(); if (upgrade14Cost.lt(1)) upgrade14Cost = D(1);
            upgrade15Cost = (isDecimalInstance(upgrade15Cost) ? upgrade15Cost : D(upgrade15Cost)).times(p).floor(); if (upgrade15Cost.lt(1)) upgrade15Cost = D(1);
            upgrade16Cost = (isDecimalInstance(upgrade16Cost) ? upgrade16Cost : D(upgrade16Cost)).times(p).floor(); if (upgrade16Cost.lt(1)) upgrade16Cost = D(1);
            // specials and other costs
            special1Cost = (isDecimalInstance(special1Cost) ? special1Cost : D(special1Cost)).times(p).floor(); if (special1Cost.lt(1)) special1Cost = D(1);
            special2Cost = (isDecimalInstance(special2Cost) ? special2Cost : D(special2Cost)).times(p).floor(); if (special2Cost.lt(1)) special2Cost = D(1);
            special3Cost = (isDecimalInstance(special3Cost) ? special3Cost : D(special3Cost)).times(p).floor(); if (special3Cost.lt(1)) special3Cost = D(1);
            special4Cost = (isDecimalInstance(special4Cost) ? special4Cost : D(special4Cost)).times(p).floor(); if (special4Cost.lt(1)) special4Cost = D(1);
            special5Cost = (isDecimalInstance(special5Cost) ? special5Cost : D(special5Cost)).times(p).floor(); if (special5Cost.lt(1)) special5Cost = D(1);
            special6Cost = (isDecimalInstance(special6Cost) ? special6Cost : D(special6Cost)).times(p).floor(); if (special6Cost.lt(1)) special6Cost = D(1);
            special7Cost = (isDecimalInstance(special7Cost) ? special7Cost : D(special7Cost)).times(p).floor(); if (special7Cost.lt(1)) special7Cost = D(1);
            special8Cost = (isDecimalInstance(special8Cost) ? special8Cost : D(special8Cost)).times(p).floor(); if (special8Cost.lt(1)) special8Cost = D(1);
            roping1Cost = (isDecimalInstance(roping1Cost) ? roping1Cost : D(roping1Cost)).times(p).floor(); if (roping1Cost.lt(1)) roping1Cost = D(1);
            roping2Cost = (isDecimalInstance(roping2Cost) ? roping2Cost : D(roping2Cost)).times(p).floor(); if (roping2Cost.lt(1)) roping2Cost = D(1);
            roping3Cost = (isDecimalInstance(roping3Cost) ? roping3Cost : D(roping3Cost)).times(p).floor(); if (roping3Cost.lt(1)) roping3Cost = D(1);
            beats1Cost = (isDecimalInstance(beats1Cost) ? beats1Cost : D(beats1Cost)).times(p).floor(); if (beats1Cost.lt(1)) beats1Cost = D(1);
            beats2Cost = (isDecimalInstance(beats2Cost) ? beats2Cost : D(beats2Cost)).times(p).floor(); if (beats2Cost.lt(1)) beats2Cost = D(1);
            beats3Cost = (isDecimalInstance(beats3Cost) ? beats3Cost : D(beats3Cost)).times(p).floor(); if (beats3Cost.lt(1)) beats3Cost = D(1);
            cr1Cost = (isDecimalInstance(cr1Cost) ? cr1Cost : D(cr1Cost)).times(p).floor(); if (cr1Cost.lt(1)) cr1Cost = D(1);
            cr2Cost = (isDecimalInstance(cr2Cost) ? cr2Cost : D(cr2Cost)).times(p).floor(); if (cr2Cost.lt(1)) cr2Cost = D(1);
            cr3Cost = (isDecimalInstance(cr3Cost) ? cr3Cost : D(cr3Cost)).times(p).floor(); if (cr3Cost.lt(1)) cr3Cost = D(1);
            cr4Cost = (isDecimalInstance(cr4Cost) ? cr4Cost : D(cr4Cost)).times(p).floor(); if (cr4Cost.lt(1)) cr4Cost = D(1);
            cr5Cost = (isDecimalInstance(cr5Cost) ? cr5Cost : D(cr5Cost)).times(p).floor(); if (cr5Cost.lt(1)) cr5Cost = D(1);
            ez1Cost = (isDecimalInstance(ez1Cost) ? ez1Cost : D(ez1Cost)).times(p).floor(); if (ez1Cost.lt(1)) ez1Cost = D(1);
            ez2Cost = (isDecimalInstance(ez2Cost) ? ez2Cost : D(ez2Cost)).times(p).floor(); if (ez2Cost.lt(1)) ez2Cost = D(1);
            ez3Cost = (isDecimalInstance(ez3Cost) ? ez3Cost : D(ez3Cost)).times(p).floor(); if (ez3Cost.lt(1)) ez3Cost = D(1);
            ez4Cost = (isDecimalInstance(ez4Cost) ? ez4Cost : D(ez4Cost)).times(p).floor(); if (ez4Cost.lt(1)) ez4Cost = D(1);
        } else {
            const p = 0.9;
            upgrade1Cost = Math.max(1, Math.floor(upgrade1Cost * p));
            upgrade2Cost = Math.max(1, Math.floor(upgrade2Cost * p));
            upgrade3Cost = Math.max(1, Math.floor(upgrade3Cost * p));
            upgrade4Cost = Math.max(1, Math.floor(upgrade4Cost * p));
            upgrade5Cost = Math.max(1, Math.floor(upgrade5Cost * p));
            upgrade6Cost = Math.max(1, Math.floor(upgrade6Cost * p));
            upgrade7Cost = Math.max(1, Math.floor(upgrade7Cost * p));
            upgrade8Cost = Math.max(1, Math.floor(upgrade8Cost * p));
            upgrade9Cost = Math.max(1, Math.floor(upgrade9Cost * p));
            upgrade10Cost = Math.max(1, Math.floor(upgrade10Cost * p));
            upgrade11Cost = Math.max(1, Math.floor(upgrade11Cost * p));
            upgrade12Cost = Math.max(1, Math.floor(upgrade12Cost * p));
            upgrade13Cost = Math.max(1, Math.floor(upgrade13Cost * p));
            upgrade14Cost = Math.max(1, Math.floor(upgrade14Cost * p));
            upgrade15Cost = Math.max(1, Math.floor(upgrade15Cost * p));
            upgrade16Cost = Math.max(1, Math.floor(upgrade16Cost * p));
            special1Cost = Math.max(1, Math.floor(special1Cost * p));
            special2Cost = Math.max(1, Math.floor(special2Cost * p));
            special3Cost = Math.max(1, Math.floor(special3Cost * p));
            special4Cost = Math.max(1, Math.floor(special4Cost * p));
            special5Cost = Math.max(1, Math.floor(special5Cost * p));
            special6Cost = Math.max(1, Math.floor(special6Cost * p));
            special7Cost = Math.max(1, Math.floor(special7Cost * p));
            special8Cost = Math.max(1, Math.floor(special8Cost * p));
            roping1Cost = Math.max(1, Math.floor(roping1Cost * p));
            roping2Cost = Math.max(1, Math.floor(roping2Cost * p));
            roping3Cost = Math.max(1, Math.floor(roping3Cost * p));
            beats1Cost = Math.max(1, Math.floor(beats1Cost * p));
            beats2Cost = Math.max(1, Math.floor(beats2Cost * p));
            beats3Cost = Math.max(1, Math.floor(beats3Cost * p));
            cr1Cost = Math.max(1, Math.floor(cr1Cost * p));
            cr2Cost = Math.max(1, Math.floor(cr2Cost * p));
            cr3Cost = Math.max(1, Math.floor(cr3Cost * p));
            cr4Cost = Math.max(1, Math.floor(cr4Cost * p));
            cr5Cost = Math.max(1, Math.floor(cr5Cost * p));
            ez1Cost = Math.max(1, Math.floor(ez1Cost * p));
            ez2Cost = Math.max(1, Math.floor(ez2Cost * p));
            ez3Cost = Math.max(1, Math.floor(ez3Cost * p));
            ez4Cost = Math.max(1, Math.floor(ez4Cost * p));
        }
    } catch (e) {
        // if any cost variable is undefined, ignore and continue
        console.warn('Price reduction applied with missing variables', e);
    }
    // cost of this divine upgrade doubles each purchase
    divineSimpleVillagerCost = Math.max(1, Math.ceil(divineSimpleVillagerCost * 2));
    saveGame(); try { playSfx('purchase.wav'); } catch (e) {} updateDisplays();
}

function buySpecial1() {
    if (special1Purchased) return;
    if (upgrade1Level < 10) { alert('Unlocks at OP mouse level 10.'); return; }
    if (hasDecimal) {
        if ((isDecimalInstance(count) ? count : D(count)).gte(D(special1Cost))) {
            count = (isDecimalInstance(count) ? count : D(count)).minus(D(special1Cost));
            clickMultiplier = (isDecimalInstance(clickMultiplier) ? clickMultiplier : D(clickMultiplier)).times(D(special1Multiplier));
            special1Purchased = true;
            updateDisplays();
        } else alert('Not enough What Happeneds — need ' + formatNumber(special1Cost) + '.');
    } else {
        if (count >= special1Cost) {
            count -= special1Cost;
            if (hasDecimal) clickMultiplier = (isDecimalInstance(clickMultiplier) ? clickMultiplier : D(clickMultiplier)).times(D(special1Multiplier));
            else clickMultiplier *= special1Multiplier;
            special1Purchased = true;
            updateDisplays();
        } else alert('Not enough What Happeneds — need ' + formatNumber(special1Cost) + '.');
    }
}

function buySpecial2() {
    if (special2Purchased) return;
    if (upgrade1Level < 25) { alert('Unlocks at OP mouse level 25.'); return; }
    if (hasDecimal) {
        if ((isDecimalInstance(count) ? count : D(count)).gte(D(special2Cost))) {
            count = (isDecimalInstance(count) ? count : D(count)).minus(D(special2Cost));
            clickMultiplier = (isDecimalInstance(clickMultiplier) ? clickMultiplier : D(clickMultiplier)).times(D(special2Multiplier));
            special2Purchased = true;
            updateDisplays();
        } else alert('Not enough What Happeneds — need ' + formatNumber(special2Cost) + '.');
    } else {
        if (count >= special2Cost) {
            count -= special2Cost;
            if (hasDecimal) clickMultiplier = (isDecimalInstance(clickMultiplier) ? clickMultiplier : D(clickMultiplier)).times(D(special2Multiplier));
            else clickMultiplier *= special2Multiplier;
            special2Purchased = true;
            updateDisplays();
        } else alert('Not enough What Happeneds — need ' + formatNumber(special2Cost) + '.');
    }
}

function buySpecial3() {
    if (special3Purchased) return;
    if (upgrade1Level < 50) { alert('Unlocks at OP mouse level 50.'); return; }
    if (hasDecimal) {
        if ((isDecimalInstance(count) ? count : D(count)).gte(D(special3Cost))) {
            count = (isDecimalInstance(count) ? count : D(count)).minus(D(special3Cost));
            clickMultiplier = (isDecimalInstance(clickMultiplier) ? clickMultiplier : D(clickMultiplier)).times(D(special3Multiplier));
            special3Purchased = true;
            updateDisplays();
        } else alert('Not enough What Happeneds — need ' + formatNumber(special3Cost) + '.');
    } else {
        if (count >= special3Cost) {
            count -= special3Cost;
            if (hasDecimal) clickMultiplier = (isDecimalInstance(clickMultiplier) ? clickMultiplier : D(clickMultiplier)).times(D(special3Multiplier));
            else clickMultiplier *= special3Multiplier;
            special3Purchased = true;
            updateDisplays();
        } else alert('Not enough What Happeneds — need ' + formatNumber(special3Cost) + '.');
    }
}

function buySpecial4() {
    if (special4Purchased) return;
    if (upgrade1Level < 100) { alert('Unlocks at OP mouse level 100.'); return; }
    if (hasDecimal) {
        if ((isDecimalInstance(count) ? count : D(count)).gte(D(special4Cost))) {
            count = (isDecimalInstance(count) ? count : D(count)).minus(D(special4Cost));
            clickMultiplier = (isDecimalInstance(clickMultiplier) ? clickMultiplier : D(clickMultiplier)).times(D(special4Multiplier));
            special4Purchased = true;
            updateDisplays();
        } else alert('Not enough What Happeneds — need ' + formatNumber(special4Cost) + '.');
    } else {
        if (count >= special4Cost) {
            count -= special4Cost;
            if (hasDecimal) clickMultiplier = (isDecimalInstance(clickMultiplier) ? clickMultiplier : D(clickMultiplier)).times(D(special4Multiplier));
            else clickMultiplier *= special4Multiplier;
            special4Purchased = true;
            updateDisplays();
        } else alert('Not enough What Happeneds — need ' + formatNumber(special4Cost) + '.');
    }
}

function buySpecial5() {
    if (special5Purchased) return;
    if (upgrade1Level < 150) { alert('Unlocks at OP mouse level 150.'); return; }
    if (hasDecimal) {
        if ((isDecimalInstance(count) ? count : D(count)).gte(D(special5Cost))) {
            count = (isDecimalInstance(count) ? count : D(count)).minus(D(special5Cost));
            clickMultiplier = (isDecimalInstance(clickMultiplier) ? clickMultiplier : D(clickMultiplier)).times(D(special5Multiplier));
            special5Purchased = true;
            updateDisplays();
        } else alert('Not enough What Happeneds — need ' + formatNumber(special5Cost) + '.');
    } else {
        if (count >= special5Cost) {
            count -= special5Cost;
            if (hasDecimal) clickMultiplier = (isDecimalInstance(clickMultiplier) ? clickMultiplier : D(clickMultiplier)).times(D(special5Multiplier));
            else clickMultiplier *= special5Multiplier;
            special5Purchased = true;
            updateDisplays();
        } else alert('Not enough What Happeneds — need ' + formatNumber(special5Cost) + '.');
    }
}

function buySpecial6() {
    if (special6Purchased) return;
    if (upgrade1Level < 200) { alert('Unlocks at OP mouse level 200.'); return; }
    if (hasDecimal) {
        if ((isDecimalInstance(count) ? count : D(count)).gte(D(special6Cost))) {
            count = (isDecimalInstance(count) ? count : D(count)).minus(D(special6Cost));
            clickMultiplier = (isDecimalInstance(clickMultiplier) ? clickMultiplier : D(clickMultiplier)).times(D(special6Multiplier));
            special6Purchased = true;
            updateDisplays();
        } else { alert('Not enough What Happeneds — need ' + formatNumber(special6Cost) + '.'); }
    } else { if (count >= special6Cost) { count -= special6Cost; if (hasDecimal) clickMultiplier = (isDecimalInstance(clickMultiplier) ? clickMultiplier : D(clickMultiplier)).times(D(special6Multiplier)); else clickMultiplier *= special6Multiplier; special6Purchased = true; updateDisplays(); } else { alert('Not enough What Happeneds — need ' + formatNumber(special6Cost) + '.'); } }
}

function buySpecial7() {
    if (special7Purchased) return;
    if (upgrade1Level < 250) { alert('Unlocks at OP mouse level 250.'); return; }
    if (hasDecimal) {
        if ((isDecimalInstance(count) ? count : D(count)).gte(D(special7Cost))) {
            count = (isDecimalInstance(count) ? count : D(count)).minus(D(special7Cost));
            clickMultiplier = (isDecimalInstance(clickMultiplier) ? clickMultiplier : D(clickMultiplier)).times(D(special7Multiplier));
            special7Purchased = true;
            updateDisplays();
        } else { alert('Not enough What Happeneds — need ' + formatNumber(special7Cost) + '.'); }
    } else { if (count >= special7Cost) { count -= special7Cost; if (hasDecimal) clickMultiplier = (isDecimalInstance(clickMultiplier) ? clickMultiplier : D(clickMultiplier)).times(D(special7Multiplier)); else clickMultiplier *= special7Multiplier; special7Purchased = true; updateDisplays(); } else { alert('Not enough What Happeneds — need ' + formatNumber(special7Cost) + '.'); } }
}

function buySpecial8() {
    if (special8Purchased) return;
    if (upgrade1Level < 300) { alert('Unlocks at OP mouse level 300.'); return; }
    if (hasDecimal) {
        if ((isDecimalInstance(count) ? count : D(count)).gte(D(special8Cost))) {
            count = (isDecimalInstance(count) ? count : D(count)).minus(D(special8Cost));
            clickMultiplier = (isDecimalInstance(clickMultiplier) ? clickMultiplier : D(clickMultiplier)).times(D(special8Multiplier));
            special8Purchased = true;
            updateDisplays();
        } else { alert('Not enough What Happeneds — need ' + formatNumber(special8Cost) + '.'); }
    } else { if (count >= special8Cost) { count -= special8Cost; if (hasDecimal) clickMultiplier = (isDecimalInstance(clickMultiplier) ? clickMultiplier : D(clickMultiplier)).times(D(special8Multiplier)); else clickMultiplier *= special8Multiplier; special8Purchased = true; updateDisplays(); } else { alert('Not enough What Happeneds — need ' + formatNumber(special8Cost) + '.'); } }
}

function buyJonathan1() {
    if (jonathan1Purchased) return;
    if (upgrade11Level < 10) { alert('Unlocks at Jonathan lvl 10.'); return; }
    if (hasDecimal) {
        if ((isDecimalInstance(count) ? count : D(count)).gte(D(jonathan1Cost))) {
            count = (isDecimalInstance(count) ? count : D(count)).minus(D(jonathan1Cost));
            jonathanOtherMultiplier = (isDecimalInstance(jonathanOtherMultiplier) ? jonathanOtherMultiplier : D(jonathanOtherMultiplier)).times(D(jonathan1Multiplier));
            jonathan1Purchased = true;
            updateDisplays();
        } else { alert('Not enough What Happeneds — need ' + formatNumber(jonathan1Cost) + '.'); }
    } else {
        if (count >= jonathan1Cost) {
            count -= jonathan1Cost;
            if (hasDecimal) jonathanOtherMultiplier = (isDecimalInstance(jonathanOtherMultiplier) ? jonathanOtherMultiplier : D(jonathanOtherMultiplier)).times(D(jonathan1Multiplier));
            else jonathanOtherMultiplier *= jonathan1Multiplier;
            jonathan1Purchased = true;
            updateDisplays();
        } else { alert('Not enough What Happeneds — need ' + formatNumber(jonathan1Cost) + '.'); }
    }
}

function buyJonathan2() {
    if (jonathan2Purchased) return;
    if (upgrade11Level < 25) { alert('Unlocks at Jonathan lvl 25.'); return; }
    if (hasDecimal) {
        if ((isDecimalInstance(count) ? count : D(count)).gte(D(jonathan2Cost))) {
            count = (isDecimalInstance(count) ? count : D(count)).minus(D(jonathan2Cost));
            jonathanOtherMultiplier = (isDecimalInstance(jonathanOtherMultiplier) ? jonathanOtherMultiplier : D(jonathanOtherMultiplier)).times(D(jonathan2Multiplier));
            jonathan2Purchased = true;
            updateDisplays();
        } else { alert('Not enough What Happeneds — need ' + formatNumber(jonathan2Cost) + '.'); }
    } else {
        if (count >= jonathan2Cost) {
            count -= jonathan2Cost;
            if (hasDecimal) jonathanOtherMultiplier = (isDecimalInstance(jonathanOtherMultiplier) ? jonathanOtherMultiplier : D(jonathanOtherMultiplier)).times(D(jonathan2Multiplier));
            else jonathanOtherMultiplier *= jonathan2Multiplier;
            jonathan2Purchased = true;
            updateDisplays();
        } else { alert('Not enough What Happeneds — need ' + formatNumber(jonathan2Cost) + '.'); }
    }
}

function buyJonathan3() {
    if (jonathan3Purchased) return;
    if (upgrade11Level < 50) { alert('Unlocks at Jonathan lvl 50.'); return; }
    if (hasDecimal) {
        if ((isDecimalInstance(count) ? count : D(count)).gte(D(jonathan3Cost))) {
            count = (isDecimalInstance(count) ? count : D(count)).minus(D(jonathan3Cost));
            clickMultiplier = (isDecimalInstance(clickMultiplier) ? clickMultiplier : D(clickMultiplier)).times(D(jonathan3Multiplier));
            jonathan3Purchased = true;
            updateDisplays();
        } else { alert('Not enough What Happeneds — need ' + formatNumber(jonathan3Cost) + '.'); }
    } else {
        if (count >= jonathan3Cost) {
            count -= jonathan3Cost;
            if (hasDecimal) clickMultiplier = (isDecimalInstance(clickMultiplier) ? clickMultiplier : D(clickMultiplier)).times(D(jonathan3Multiplier));
            else clickMultiplier *= jonathan3Multiplier;
            jonathan3Purchased = true;
            updateDisplays();
        } else { alert('Not enough What Happeneds — need ' + formatNumber(jonathan3Cost) + '.'); }
    }
}

function buyJonathan4() {
    if (jonathan4Purchased) return;
    if (upgrade11Level < 75) { alert('Unlocks at Jonathan lvl 75.'); return; }
    if (hasDecimal) {
        if ((isDecimalInstance(count) ? count : D(count)).gte(D(jonathan4Cost))) {
            count = (isDecimalInstance(count) ? count : D(count)).minus(D(jonathan4Cost));
            jonathanOtherMultiplier = (isDecimalInstance(jonathanOtherMultiplier) ? jonathanOtherMultiplier : D(jonathanOtherMultiplier)).times(D(jonathan4Multiplier));
            jonathan4Purchased = true;
            updateDisplays();
        } else { alert('Not enough What Happeneds — need ' + formatNumber(jonathan4Cost) + '.'); }
    } else {
        if (count >= jonathan4Cost) {
            count -= jonathan4Cost;
            if (hasDecimal) jonathanOtherMultiplier = (isDecimalInstance(jonathanOtherMultiplier) ? jonathanOtherMultiplier : D(jonathanOtherMultiplier)).times(D(jonathan4Multiplier));
            else jonathanOtherMultiplier *= jonathan4Multiplier;
            jonathan4Purchased = true;
            updateDisplays();
        } else { alert('Not enough What Happeneds — need ' + formatNumber(jonathan4Cost) + '.'); }
    }
}

function buyCr1() {
    if (cr1Purchased) return;
    if (numericLevel(upgrade12Level) < 10) { alert('Unlocks at CR lvl 10.'); return; }
    if (count >= cr1Cost) {
        count -= cr1Cost;
        if (hasDecimal) crOtherMultiplier = (isDecimalInstance(crOtherMultiplier) ? crOtherMultiplier : D(crOtherMultiplier)).times(D(cr1Multiplier));
        else crOtherMultiplier *= cr1Multiplier;
        cr1Purchased = true;
        saveGame(); try { playSfx('purchase.wav'); } catch (e) {} updateDisplays();
    } else { alert('Not enough What Happeneds — need ' + formatNumber(cr1Cost) + '.'); }
}

function buyCr2() {
    if (cr2Purchased) return;
    if (numericLevel(upgrade12Level) < 25) { alert('Unlocks at CR lvl 25.'); return; }
    if (count >= cr2Cost) {
        count -= cr2Cost;
        if (hasDecimal) crOtherMultiplier = (isDecimalInstance(crOtherMultiplier) ? crOtherMultiplier : D(crOtherMultiplier)).times(D(cr2Multiplier));
        else crOtherMultiplier *= cr2Multiplier;
        cr2Purchased = true;
        saveGame(); try { playSfx('purchase.wav'); } catch (e) {} updateDisplays();
    } else { alert('Not enough What Happeneds — need ' + formatNumber(cr2Cost) + '.'); }
}

function buyCr3() {
    if (cr3Purchased) return;
    if (numericLevel(upgrade12Level) < 50) { alert('Unlocks at CR lvl 50.'); return; }
    if (count >= cr3Cost) {
        count -= cr3Cost;
        if (hasDecimal) clickMultiplier = (isDecimalInstance(clickMultiplier) ? clickMultiplier : D(clickMultiplier)).times(D(cr3Multiplier));
        else clickMultiplier *= cr3Multiplier;
        cr3Purchased = true;
        saveGame(); try { playSfx('purchase.wav'); } catch (e) {} updateDisplays();
    } else { alert('Not enough What Happeneds — need ' + formatNumber(cr3Cost) + '.'); }
}

function buyCr4() {
    if (cr4Purchased) return;
    if (numericLevel(upgrade12Level) < 75) { alert('Unlocks at CR lvl 75.'); return; }
    if (count >= cr4Cost) {
        count -= cr4Cost;
        if (hasDecimal) crOtherMultiplier = (isDecimalInstance(crOtherMultiplier) ? crOtherMultiplier : D(crOtherMultiplier)).times(D(cr4Multiplier));
        else crOtherMultiplier *= cr4Multiplier;
        cr4Purchased = true;
        saveGame(); try { playSfx('purchase.wav'); } catch (e) {} updateDisplays();
    } else { alert('Not enough What Happeneds — need ' + formatNumber(cr4Cost) + '.'); }
}

function buyCr5() {
    if (cr5Purchased) return;
    if (numericLevel(upgrade12Level) < 100) { alert('Unlocks at CR lvl 100.'); return; }
    if (count >= cr5Cost) {
        count -= cr5Cost;
        // apply to total cps via multiplying a global multiplier (use goonMultiplier if present)
        if (typeof goonMultiplier !== 'undefined') {
            if (hasDecimal) goonMultiplier = (isDecimalInstance(goonMultiplier) ? goonMultiplier : D(goonMultiplier)).times(D(cr5Multiplier));
            else goonMultiplier *= cr5Multiplier;
        }
        else goonMultiplier = (typeof goonMultiplier === 'number' ? goonMultiplier : 1) * cr5Multiplier;
        cr5Purchased = true;
        saveGame(); try { playSfx('purchase.wav'); } catch (e) {} updateDisplays();
    } else { alert('Not enough What Happeneds — need ' + formatNumber(cr5Cost) + '.'); }
}

// Prestige / golden claim handler
// Compute how many golden awards the player would receive if they prestiged now
function getPotentialPrestigeAwards() {
    try {
        // compute totalLevels dynamically (sum of all upgrade levels)
        let totalLevels = 0;
        for (let i = 1; i <= 23; i++) {
            try { totalLevels += numericLevel(getUpgradeLevel(i)); } catch (e) { }
        }
        let awards = Math.floor(totalLevels / LEVELS_PER_GOLDEN);
        if (typeof divineCollectorLevel !== 'undefined' && divineCollectorLevel > 0) {
            awards = Math.floor(awards * (1 + DIVINE_COLLECTOR_PER_LEVEL * divineCollectorLevel));
            if (awards < 1 && awards > 0) awards = 1;
        }
        return awards;
    } catch (e) { return 0; }
}

function buyPrestige() {
    if (numericLevel(upgrade12Level) < 150) { alert('Prestige unlocks when CR lurker reaches level 150.'); return; }

    // compute awards based on total combined levels of base upgrades
    // sum all upgrade levels dynamically so newly added upgrades count toward prestige
    let totalLevels = 0;
    try {
        for (let i = 1; i <= 23; i++) {
            try { totalLevels += numericLevel(getUpgradeLevel(i)); } catch (e) { /* ignore missing upgrade */ }
        }
    } catch (e) { totalLevels = 0; }
    const awards = Math.floor(totalLevels / LEVELS_PER_GOLDEN);
    if (awards === 0) {
        alert(`You need at least ${LEVELS_PER_GOLDEN} total upgrade levels per Golden. You have ${totalLevels}.`);
        return;
    }

    // apply Divine Collector bonus to awards (10% more per level), then compute final awards
    let finalAwards = awards;
    try {
        if (typeof divineCollectorLevel !== 'undefined' && divineCollectorLevel > 0) {
            finalAwards = Math.floor(awards * (1 + DIVINE_COLLECTOR_PER_LEVEL * divineCollectorLevel));
            if (finalAwards < 1 && awards > 0) finalAwards = 1;
        }
    } catch (e) { finalAwards = awards; }

    if (!confirm(`gain ${finalAwards} Golden What Happends for ${totalLevels} upgrades? This will reset your progress.`)) return;

    // award computed goldens and permanently unlock divine menu if applicable
    goldenWhat += finalAwards;
    // track stats
    try { prestigeTimes = (Number(prestigeTimes) || 0) + 1; } catch (e) { prestigeTimes = 1; }
    try { totalGoldenEver = (Number(totalGoldenEver) || 0) + Number(finalAwards || 0); } catch (e) { totalGoldenEver = Number(finalAwards || 0); }
    if (goldenWhat >= 1) divineUnlocked = true;

    // Prestige Party: always increment pending; clan page flushes to Firestore when you open Events (avoids Firebase timing on game page)
    try {
        var clanId = localStorage.getItem('player_clanId');
        if (clanId) {
            var pending = Math.max(0, parseInt(localStorage.getItem('whathappened_prestige_party_pending') || '0', 10)) + 1;
            try { localStorage.setItem('whathappened_prestige_party_pending', String(pending)); } catch (e) {}
        }
    } catch (e) {}

    // reset all special purchased flags and multipliers so special effects do NOT carry over
    try {
        // multipliers and derived vars
        clickMultiplier = 1;
        pirateMultiplier = 1;
        phonkMultiplier = 1;
        diddyOtherMultiplier = 1;
        argonOtherMultiplier = 1;
        grapeOtherMultiplier = 1;
        skippieOtherMultiplier = 1;
        islandOtherMultiplier = 1;
        tribalOtherMultiplier = 1;
        diddyMultiplier = 1; argonMultiplier = 1; grapeMultiplier = 1; skippieMultiplier = 1; islandMultiplier = 1; tribalMultiplier = 1;

        // special purchased flags -> reset to false
        special1Purchased = false; special2Purchased = false; special3Purchased = false; special4Purchased = false; special5Purchased = false;
        special6Purchased = false; special7Purchased = false; special8Purchased = false;
        pirateSpec1Purchased = false; pirateSpec2Purchased = false; pirateSpec3Purchased = false; pirateSpec4Purchased = false;
        goonSpec1Purchased = false; goonSpec2Purchased = false; goonSpec3Purchased = false; goonSpec4Purchased = false;
        diddy1Purchased = false; diddy2Purchased = false; diddy3Purchased = false; diddy4Purchased = false;
        argon1Purchased = false; argon2Purchased = false; argon3Purchased = false; argon4Purchased = false;
        grape1Purchased = false; grape2Purchased = false; grape3Purchased = false; grape4Purchased = false;
        skippie1Purchased = false; skippie2Purchased = false; skippie3Purchased = false; skippie4Purchased = false;
        island1Purchased = false; island2Purchased = false; island3Purchased = false; island4Purchased = false;
        tribal1Purchased = false; tribal2Purchased = false; tribal3Purchased = false; tribal4Purchased = false;
        phonk1Purchased = false; phonk2Purchased = false; phonk3Purchased = false; phonk4Purchased = false; phonk5Purchased = false;

        // Ropingnecurse specials: reset as well so they do not persist through prestige
        roping1Purchased = false; roping2Purchased = false; roping3Purchased = false; roping4Purchased = false;
        ropingOtherMultiplier = 1;
        // Skibbidi specials: reset as well so they do not persist through prestige
        skibidi1Purchased = false; skibidi2Purchased = false; skibidi3Purchased = false; skibidi4Purchased = false;
        skibbidiOtherMultiplier = 1;
        // Beats specials: reset so they do not persist through prestige
        beats1Purchased = false; beats2Purchased = false; beats3Purchased = false;
        beatsOtherMultiplier = 1;

        // also reset phonk/jonathan state that represent purchased-level effects
        phonkBaseCps = D(0); phonkOtherMultiplier = 1;
        jonathan1Purchased = false; jonathan2Purchased = false; jonathan3Purchased = false; jonathan4Purchased = false;
        jonathanBaseCps = D(0); jonathanOtherMultiplier = 1;

        // persist prestige-only save so golden and divine state survive the reset, include explicit resets
        suppressAutosave = true;
        const prestigeSave = {
            version: SAVE_VERSION,
            goldenWhat,
            // stats persisted for cross-session visibility
            prestigeTimes,
            totalGoldenEver,
            goldenThreshold,
            // preserve divine upgrades across prestige
            divineArgonLevel, divineArgonCost, divineArgonPercent,
            divineSomalianLevel, divineSomalianCost,
            divineCollectorLevel, divineCollectorCost,
            divineAssassinLevel, divineAssassinCost,
            // divine Money Man
            divineMoneyManLevel, divineMoneyManCost,
            // preserve Divine Spirit and Divine Simple Villager across prestige
            divineSpiritLevel, divineSpiritCost,
            divineSimpleVillagerLevel, divineSimpleVillagerCost,
            // mark this save as a prestige application so load can apply one-time effects
            prestige: true,
            divineUnlocked,
            // preserve diamonds across prestige
            diamonds,
            // preserve clan points across prestige
            clanPoints,
            // preserve music settings across prestige
            musicVolume, musicMuted,
            // preserve SFX settings across prestige
            sfxVolume, sfxMuted,
            // preserve music ownership and current track so purchased tracks survive prestige
            musicOwned, currentMusicTrack,
            // preserve shop state across prestige
            shopDivinePurchased,
            shopPlatinumPurchased, shopDivineWHPurchased, shopWHVrillPurchased, shopSilverPurchased, shopGoldPurchased,
            shopBgPurchased,
            shopCollectionBgPurchased,
            shopWHBWPurchased,
            equippedShopImage,
            equippedBgImage,
            // explicit resets to ensure no special effects persist
            clickMultiplier, pirateMultiplier, phonkMultiplier,
            diddyOtherMultiplier, argonOtherMultiplier, grapeOtherMultiplier, skippieOtherMultiplier, islandOtherMultiplier, tribalOtherMultiplier,
            diddyMultiplier, argonMultiplier, grapeMultiplier, skippieMultiplier, islandMultiplier, tribalMultiplier,
            special1Purchased, special2Purchased, special3Purchased, special4Purchased, special5Purchased,
            special6Purchased, special7Purchased, special8Purchased,
            pirateSpec1Purchased, pirateSpec2Purchased, pirateSpec3Purchased, pirateSpec4Purchased,
            goonSpec1Purchased, goonSpec2Purchased, goonSpec3Purchased, goonSpec4Purchased,
            diddy1Purchased, diddy2Purchased, diddy3Purchased, diddy4Purchased,
            argon1Purchased, argon2Purchased, argon3Purchased, argon4Purchased,
            grape1Purchased, grape2Purchased, grape3Purchased, grape4Purchased,
            skippie1Purchased, skippie2Purchased, skippie3Purchased, skippie4Purchased,
            island1Purchased, island2Purchased, island3Purchased, island4Purchased,
            tribal1Purchased, tribal2Purchased, tribal3Purchased, tribal4Purchased,
            phonk1Purchased, phonk2Purchased, phonk3Purchased, phonk4Purchased, phonk5Purchased,
            phonkBaseCps, phonkOtherMultiplier,
            // skibbidi purchased flags and multiplier (reset)
            skibidi1Purchased, skibidi2Purchased, skibidi3Purchased, skibidi4Purchased,
            skibbidiOtherMultiplier,
            // beats purchased flags and multiplier (reset)
            beats1Purchased, beats2Purchased, beats3Purchased,
            beatsOtherMultiplier,
            jonathan1Purchased, jonathan2Purchased, jonathan3Purchased, jonathan4Purchased,
            jonathanBaseCps, jonathanOtherMultiplier,
            // upgrade13 (ropingnecurse) does NOT persist across prestige - reset intentionally
            // ensure runtime variables for roping/upgrades are reset so saved prestige state reflects reset
            upgrade13Level: 0,
            upgrade13Cost: 10000000000,
            lastSaved: Date.now()
        };
        localStorage.setItem(SAVE_KEY, JSON.stringify(prestigeSave));
        try { localStorage.setItem('whathappened_prestige_times', String(prestigeTimes || 0)); } catch (e) {}
        try { localStorage.setItem('whathappened_total_golden', String(totalGoldenEver || 0)); } catch (e) {}
        try { localStorage.setItem('whathappened_clicks_since_prestige', '0'); } catch (e) {}
        try { localStorage.setItem('whathappened_last_prestige_ts', String(Date.now())); } catch (e) {}
    } catch (e) { console.error('Failed to persist prestige', e); }
    // unlock prestige achievements and grant titles
    try {
        const prestigeCount = Number(localStorage.getItem('whathappened_prestige_times') || prestigeTimes || 0) || 0;
        if (prestigeCount >= 1 && !localStorage.getItem('ach_prestige1')) {
            try { localStorage.setItem('ach_prestige1', '1'); } catch (e) {}
            try { addUnlockedTitle('Loop Initiater'); } catch (e) {}
            try { showAchievementPopup('Loop Initiater', 'Prestiged for the first time.'); } catch (e) {}
        }
        if (prestigeCount >= 5 && !localStorage.getItem('ach_prestige5')) {
            try { localStorage.setItem('ach_prestige5', '1'); } catch (e) {}
            try { addUnlockedTitle('Pattern Recognizer'); } catch (e) {}
            try { showAchievementPopup('Pattern Recognizer', 'Prestiged 5 times.'); } catch (e) {}
        }
        if (prestigeCount >= 10 && !localStorage.getItem('ach_prestige10')) {
            try { localStorage.setItem('ach_prestige10', '1'); } catch (e) {}
            try { addUnlockedTitle('Loop Surviver'); } catch (e) {}
            try { showAchievementPopup('Loop Surviver', 'Prestiged 10 times.'); } catch (e) {}
        }
        if (prestigeCount >= 25 && !localStorage.getItem('ach_prestige25')) {
            try { localStorage.setItem('ach_prestige25', '1'); } catch (e) {}
            try { addUnlockedTitle('Keeper of the Loop'); } catch (e) {}
            try { showAchievementPopup('Keeper of the Loop', 'Prestiged 25 times.'); } catch (e) {}
        }
    } catch (e) { console.warn('Failed setting prestige achievements', e); }

    // reload to perform a full reset (load will pick up golden keys)
    setTimeout(() => location.reload(), 100);
}

// Pirate special purchase handlers
function buyPirate1() {
    if (pirateSpec1Purchased) return;
    if (upgrade2Level < 10) { alert('Unlocks at Somalian Pirate level 10.'); return; }
    if (hasDecimal) {
        if ((isDecimalInstance(count) ? count : D(count)).gte(D(pirateSpec1Cost))) {
            count = (isDecimalInstance(count) ? count : D(count)).minus(D(pirateSpec1Cost));
            pirateMultiplier = (isDecimalInstance(pirateMultiplier) ? pirateMultiplier : D(pirateMultiplier)).times(D(pirateSpec1Multiplier));
            pirateSpec1Purchased = true;
            updateDisplays();
        } else { alert('Not enough What Happeneds — need ' + formatNumber(pirateSpec1Cost) + '.'); }
    } else {
        if (count >= pirateSpec1Cost) {
            count -= pirateSpec1Cost;
            if (hasDecimal) pirateMultiplier = (isDecimalInstance(pirateMultiplier) ? pirateMultiplier : D(pirateMultiplier)).times(D(pirateSpec1Multiplier));
            else pirateMultiplier *= pirateSpec1Multiplier;
            pirateSpec1Purchased = true;
            updateDisplays();
        } else { alert('Not enough What Happeneds — need ' + formatNumber(pirateSpec1Cost) + '.'); }
    }
}

function buyPirate2() {
    if (pirateSpec2Purchased) return;
    if (upgrade2Level < 25) { alert('Unlocks at Somalian Pirate level 25.'); return; }
    if (hasDecimal) {
        if ((isDecimalInstance(count) ? count : D(count)).gte(D(pirateSpec2Cost))) {
            count = (isDecimalInstance(count) ? count : D(count)).minus(D(pirateSpec2Cost));
            pirateMultiplier = (isDecimalInstance(pirateMultiplier) ? pirateMultiplier : D(pirateMultiplier)).times(D(pirateSpec2Multiplier));
            pirateSpec2Purchased = true;
            updateDisplays();
        } else { alert('Not enough What Happeneds — need ' + formatNumber(pirateSpec2Cost) + '.'); }
    } else {
        if (count >= pirateSpec2Cost) {
            count -= pirateSpec2Cost;
            if (hasDecimal) pirateMultiplier = (isDecimalInstance(pirateMultiplier) ? pirateMultiplier : D(pirateMultiplier)).times(D(pirateSpec2Multiplier));
            else pirateMultiplier *= pirateSpec2Multiplier;
            pirateSpec2Purchased = true;
            updateDisplays();
        } else { alert('Not enough What Happeneds — need ' + formatNumber(pirateSpec2Cost) + '.'); }
    }
}

function buyPirate3() {
    if (pirateSpec3Purchased) return;
    if (upgrade2Level < 50) { alert('Unlocks at Somalian Pirate level 50.'); return; }
    if (hasDecimal) {
        if ((isDecimalInstance(count) ? count : D(count)).gte(D(pirateSpec3Cost))) {
            count = (isDecimalInstance(count) ? count : D(count)).minus(D(pirateSpec3Cost));
            pirateMultiplier = (isDecimalInstance(pirateMultiplier) ? pirateMultiplier : D(pirateMultiplier)).times(D(pirateSpec3Multiplier));
            pirateSpec3Purchased = true;
            updateDisplays();
        } else { alert('Not enough What Happeneds — need ' + formatNumber(pirateSpec3Cost) + '.'); }
    } else {
        if (count >= pirateSpec3Cost) {
            count -= pirateSpec3Cost;
            if (hasDecimal) pirateMultiplier = (isDecimalInstance(pirateMultiplier) ? pirateMultiplier : D(pirateMultiplier)).times(D(pirateSpec3Multiplier));
            else pirateMultiplier *= pirateSpec3Multiplier;
            pirateSpec3Purchased = true;
            updateDisplays();
        } else { alert('Not enough What Happeneds — need ' + formatNumber(pirateSpec3Cost) + '.'); }
    }
}

function buyPirate4() {
    if (pirateSpec4Purchased) return;
    if (upgrade2Level < 100) { alert('Unlocks at Somalian Pirate level 100.'); return; }
    if (hasDecimal) {
        if ((isDecimalInstance(count) ? count : D(count)).gte(D(pirateSpec4Cost))) {
            count = (isDecimalInstance(count) ? count : D(count)).minus(D(pirateSpec4Cost));
            pirateMultiplier = (isDecimalInstance(pirateMultiplier) ? pirateMultiplier : D(pirateMultiplier)).times(D(pirateSpec4Multiplier));
            pirateSpec4Purchased = true;
            updateDisplays();
        } else { alert('Not enough What Happeneds — need ' + formatNumber(pirateSpec4Cost) + '.'); }
    } else {
        if (count >= pirateSpec4Cost) {
            count -= pirateSpec4Cost;
            if (hasDecimal) pirateMultiplier = (isDecimalInstance(pirateMultiplier) ? pirateMultiplier : D(pirateMultiplier)).times(D(pirateSpec4Multiplier));
            else pirateMultiplier *= pirateSpec4Multiplier;
            pirateSpec4Purchased = true;
            updateDisplays();
        } else { alert('Not enough What Happeneds — need ' + formatNumber(pirateSpec4Cost) + '.'); }
    }
}

// Goonsaw special purchase handlers
let goonMultiplier = 1;
// Diddy Blud overall cps multiplier
let diddyMultiplier = 1;
// Argonian, Grape and Skippie overall cps multipliers
let argonMultiplier = 1;
let grapeMultiplier = 1;
let skippieMultiplier = 1;
// Phonk Man specific cps (separate from other sources)
let phonkBaseCps = D(0);
let phonkOtherMultiplier = 1; // multiplies only Phonk's cps contribution
let phonkMultiplier = 1; // multiplies total cps when applied
// when true, skip autosave (used during reset to avoid recreating the save on unload)
let suppressAutosave = false;
function buyGoon1() {
    if (goonSpec1Purchased) return;
    if (upgrade3Level < 10) { alert('Unlocks at Goonsaw level 10.'); return; }
    if (hasDecimal) {
        if ((isDecimalInstance(count) ? count : D(count)).gte(D(goonSpec1Cost))) {
            count = (isDecimalInstance(count) ? count : D(count)).minus(D(goonSpec1Cost));
            goonMultiplier = (isDecimalInstance(goonMultiplier) ? goonMultiplier : D(goonMultiplier)).times(D(goonSpec1Multiplier));
            goonSpec1Purchased = true;
            updateDisplays();
        } else { alert('Not enough What Happeneds — need ' + formatNumber(goonSpec1Cost) + '.'); }
    } else {
        if (count >= goonSpec1Cost) {
            count -= goonSpec1Cost;
            if (hasDecimal) goonMultiplier = (isDecimalInstance(goonMultiplier) ? goonMultiplier : D(goonMultiplier)).times(D(goonSpec1Multiplier));
            else goonMultiplier *= goonSpec1Multiplier;
            goonSpec1Purchased = true;
            updateDisplays();
        } else { alert('Not enough What Happeneds — need ' + formatNumber(goonSpec1Cost) + '.'); }
    }
}

function buyGoon2() {
    if (goonSpec2Purchased) return;
    if (upgrade3Level < 25) { alert('Unlocks at Goonsaw level 25.'); return; }
    if (hasDecimal) {
        if ((isDecimalInstance(count) ? count : D(count)).gte(D(goonSpec2Cost))) {
            count = (isDecimalInstance(count) ? count : D(count)).minus(D(goonSpec2Cost));
            goonMultiplier = (isDecimalInstance(goonMultiplier) ? goonMultiplier : D(goonMultiplier)).times(D(goonSpec2Multiplier));
            goonSpec2Purchased = true;
            updateDisplays();
        } else { alert('Not enough What Happeneds — need ' + formatNumber(goonSpec2Cost) + '.'); }
    } else {
        if (count >= goonSpec2Cost) {
            count -= goonSpec2Cost;
            if (hasDecimal) goonMultiplier = (isDecimalInstance(goonMultiplier) ? goonMultiplier : D(goonMultiplier)).times(D(goonSpec2Multiplier));
            else goonMultiplier *= goonSpec2Multiplier;
            goonSpec2Purchased = true;
            updateDisplays();
        } else { alert('Not enough What Happeneds — need ' + formatNumber(goonSpec2Cost) + '.'); }
    }
}

function buyGoon3() {
    if (goonSpec3Purchased) return;
    if (upgrade3Level < 50) { alert('Unlocks at Goonsaw level 50.'); return; }
    if (hasDecimal) {
        if ((isDecimalInstance(count) ? count : D(count)).gte(D(goonSpec3Cost))) {
            count = (isDecimalInstance(count) ? count : D(count)).minus(D(goonSpec3Cost));
            goonMultiplier = (isDecimalInstance(goonMultiplier) ? goonMultiplier : D(goonMultiplier)).times(D(goonSpec3Multiplier));
            goonSpec3Purchased = true;
            updateDisplays();
        } else { alert('Not enough What Happeneds — need ' + formatNumber(goonSpec3Cost) + '.'); }
    } else {
        if (count >= goonSpec3Cost) {
            count -= goonSpec3Cost;
            if (hasDecimal) goonMultiplier = (isDecimalInstance(goonMultiplier) ? goonMultiplier : D(goonMultiplier)).times(D(goonSpec3Multiplier));
            else goonMultiplier *= goonSpec3Multiplier;
            goonSpec3Purchased = true;
            updateDisplays();
        } else { alert('Not enough What Happeneds — need ' + formatNumber(goonSpec3Cost) + '.'); }
    }
}

function buyGoon4() {
    if (goonSpec4Purchased) return;
    if (upgrade3Level < 100) { alert('Unlocks at Goonsaw level 100.'); return; }
    if (hasDecimal) {
        if ((isDecimalInstance(count) ? count : D(count)).gte(D(goonSpec4Cost))) {
            count = (isDecimalInstance(count) ? count : D(count)).minus(D(goonSpec4Cost));
            goonMultiplier = (isDecimalInstance(goonMultiplier) ? goonMultiplier : D(goonMultiplier)).times(D(goonSpec4Multiplier));
            goonSpec4Purchased = true;
            updateDisplays();
        } else { alert('Not enough What Happeneds — need ' + formatNumber(goonSpec4Cost) + '.'); }
    } else {
        if (count >= goonSpec4Cost) {
            count -= goonSpec4Cost;
            if (hasDecimal) goonMultiplier = (isDecimalInstance(goonMultiplier) ? goonMultiplier : D(goonMultiplier)).times(D(goonSpec4Multiplier));
            else goonMultiplier *= goonSpec4Multiplier;
            goonSpec4Purchased = true;
            updateDisplays();
        } else { alert('Not enough What Happeneds — need ' + formatNumber(goonSpec4Cost) + '.'); }
    }
}

// The Goatis purchase handlers
function buyGoatis1() {
    if (goatis1Purchased) return;
    if (upgrade18Level < 10) { alert('Unlocks at The Goatis level 10.'); return; }
    if (hasDecimal) {
        if ((isDecimalInstance(count) ? count : D(count)).gte(D(goatis1Cost))) {
            count = (isDecimalInstance(count) ? count : D(count)).minus(D(goatis1Cost));
            goatisMultiplier = (isDecimalInstance(goatisMultiplier) ? goatisMultiplier : D(goatisMultiplier)).times(D(goatis1Multiplier));
            goatis1Purchased = true;
            updateDisplays();
        } else { alert('Not enough What Happeneds — need ' + formatNumber(goatis1Cost) + '.'); }
    } else {
        if (count >= goatis1Cost) {
            count -= goatis1Cost;
            if (hasDecimal) goatisMultiplier = (isDecimalInstance(goatisMultiplier) ? goatisMultiplier : D(goatisMultiplier)).times(D(goatis1Multiplier));
            else goatisMultiplier *= goatis1Multiplier;
            goatis1Purchased = true;
            updateDisplays();
        } else { alert('Not enough What Happeneds — need ' + formatNumber(goatis1Cost) + '.'); }
    }
}

function buyGoatis2() {
    if (goatis2Purchased) return;
    if (upgrade18Level < 25) { alert('Unlocks at The Goatis level 25.'); return; }
    if (hasDecimal) {
        if ((isDecimalInstance(count) ? count : D(count)).gte(D(goatis2Cost))) {
            count = (isDecimalInstance(count) ? count : D(count)).minus(D(goatis2Cost));
            goatisMultiplier = (isDecimalInstance(goatisMultiplier) ? goatisMultiplier : D(goatisMultiplier)).times(D(goatis2Multiplier));
            goatis2Purchased = true;
            updateDisplays();
        } else { alert('Not enough What Happeneds — need ' + formatNumber(goatis2Cost) + '.'); }
    } else {
        if (count >= goatis2Cost) {
            count -= goatis2Cost;
            if (hasDecimal) goatisMultiplier = (isDecimalInstance(goatisMultiplier) ? goatisMultiplier : D(goatisMultiplier)).times(D(goatis2Multiplier));
            else goatisMultiplier *= goatis2Multiplier;
            goatis2Purchased = true;
            updateDisplays();
        } else { alert('Not enough What Happeneds — need ' + formatNumber(goatis2Cost) + '.'); }
    }
}

function buyGoatis3() {
    if (goatis3Purchased) return;
    if (upgrade18Level < 50) { alert('Unlocks at The Goatis level 50.'); return; }
    if (hasDecimal) {
        if ((isDecimalInstance(count) ? count : D(count)).gte(D(goatis3Cost))) {
            count = (isDecimalInstance(count) ? count : D(count)).minus(D(goatis3Cost));
            goatisMultiplier = (isDecimalInstance(goatisMultiplier) ? goatisMultiplier : D(goatisMultiplier)).times(D(goatis3Multiplier));
            goatis3Purchased = true;
            updateDisplays();
        } else { alert('Not enough What Happeneds — need ' + formatNumber(goatis3Cost) + '.'); }
    } else {
        if (count >= goatis3Cost) {
            count -= goatis3Cost;
            if (hasDecimal) goatisMultiplier = (isDecimalInstance(goatisMultiplier) ? goatisMultiplier : D(goatisMultiplier)).times(D(goatis3Multiplier));
            else goatisMultiplier *= goatis3Multiplier;
            goatis3Purchased = true;
            updateDisplays();
        } else { alert('Not enough What Happeneds — need ' + formatNumber(goatis3Cost) + '.'); }
    }
}

function buyGoatis4() {
    if (goatis4Purchased) return;
    if (upgrade18Level < 100) { alert('Unlocks at The Goatis level 100.'); return; }
    if (hasDecimal) {
        if ((isDecimalInstance(count) ? count : D(count)).gte(D(goatis4Cost))) {
            count = (isDecimalInstance(count) ? count : D(count)).minus(D(goatis4Cost));
            goatisMultiplier = (isDecimalInstance(goatisMultiplier) ? goatisMultiplier : D(goatisMultiplier)).times(D(goatis4Multiplier));
            goatis4Purchased = true;
            updateDisplays();
        } else { alert('Not enough What Happeneds — need ' + formatNumber(goatis4Cost) + '.'); }
    } else {
        if (count >= goatis4Cost) {
            count -= goatis4Cost;
            if (hasDecimal) goatisMultiplier = (isDecimalInstance(goatisMultiplier) ? goatisMultiplier : D(goatisMultiplier)).times(D(goatis4Multiplier));
            else goatisMultiplier *= goatis4Multiplier;
            goatis4Purchased = true;
            updateDisplays();
        } else { alert('Not enough What Happeneds — need ' + formatNumber(goatis4Cost) + '.'); }
    }
}

// goatises raw liver specials (upgrade19)
function buyRaw1() {
    if (raw1Purchased) return;
    if (upgrade19Level < 10) { alert('Unlocks at goatises raw liver level 10.'); return; }
    if (hasDecimal) {
        if ((isDecimalInstance(count) ? count : D(count)).gte(D(raw1Cost))) {
            count = (isDecimalInstance(count) ? count : D(count)).minus(D(raw1Cost));
            rawMultiplier = (isDecimalInstance(rawMultiplier) ? rawMultiplier : D(rawMultiplier)).times(D(raw1Multiplier));
            raw1Purchased = true;
            updateDisplays();
        } else { alert('Not enough What Happeneds — need ' + formatNumber(raw1Cost) + '.'); }
    } else {
        if (count >= raw1Cost) {
            count -= raw1Cost;
            rawMultiplier *= raw1Multiplier;
            raw1Purchased = true;
            updateDisplays();
        } else { alert('Not enough What Happeneds — need ' + formatNumber(raw1Cost) + '.'); }
    }
}

function buyRaw2() {
    if (raw2Purchased) return;
    if (upgrade19Level < 25) { alert('Unlocks at goatises raw liver level 25.'); return; }
    if (hasDecimal) {
        if ((isDecimalInstance(count) ? count : D(count)).gte(D(raw2Cost))) {
            count = (isDecimalInstance(count) ? count : D(count)).minus(D(raw2Cost));
            rawMultiplier = (isDecimalInstance(rawMultiplier) ? rawMultiplier : D(rawMultiplier)).times(D(raw2Multiplier));
            raw2Purchased = true;
            updateDisplays();
        } else { alert('Not enough What Happeneds — need ' + formatNumber(raw2Cost) + '.'); }
    } else {
        if (count >= raw2Cost) {
            count -= raw2Cost;
            rawMultiplier *= raw2Multiplier;
            raw2Purchased = true;
            updateDisplays();
        } else { alert('Not enough What Happeneds — need ' + formatNumber(raw2Cost) + '.'); }
    }
}

function buyRaw3() {
    if (raw3Purchased) return;
    if (upgrade19Level < 50) { alert('Unlocks at goatises raw liver level 50.'); return; }
    if (hasDecimal) {
        if ((isDecimalInstance(count) ? count : D(count)).gte(D(raw3Cost))) {
            count = (isDecimalInstance(count) ? count : D(count)).minus(D(raw3Cost));
            rawMultiplier = (isDecimalInstance(rawMultiplier) ? rawMultiplier : D(rawMultiplier)).times(D(raw3Multiplier));
            raw3Purchased = true;
            updateDisplays();
        } else { alert('Not enough What Happeneds — need ' + formatNumber(raw3Cost) + '.'); }
    } else {
        if (count >= raw3Cost) {
            count -= raw3Cost;
            rawMultiplier *= raw3Multiplier;
            raw3Purchased = true;
            updateDisplays();
        } else { alert('Not enough What Happeneds — need ' + formatNumber(raw3Cost) + '.'); }
    }
}

function buyRaw4() {
    if (raw4Purchased) return;
    if (upgrade19Level < 100) { alert('Unlocks at goatises raw liver level 100.'); return; }
    if (hasDecimal) {
        if ((isDecimalInstance(count) ? count : D(count)).gte(D(raw4Cost))) {
            count = (isDecimalInstance(count) ? count : D(count)).minus(D(raw4Cost));
            rawMultiplier = (isDecimalInstance(rawMultiplier) ? rawMultiplier : D(rawMultiplier)).times(D(raw4Multiplier));
            raw4Purchased = true;
            updateDisplays();
        } else { alert('Not enough What Happeneds — need ' + formatNumber(raw4Cost) + '.'); }
    } else {
        if (count >= raw4Cost) {
            count -= raw4Cost;
            rawMultiplier *= raw4Multiplier;
            raw4Purchased = true;
            updateDisplays();
        } else { alert('Not enough What Happeneds — need ' + formatNumber(raw4Cost) + '.'); }
    }
}

// Landon Stream specials (upgrade20)
function buyLandon1() {
    if (landon1Purchased) return;
    if (numericLevel(upgrade20Level) < 10) { alert('Unlocks at The Landon Stream level 10.'); return; }
    if (hasDecimal) {
        if ((isDecimalInstance(count) ? count : D(count)).gte(D(landon1Cost))) {
            count = (isDecimalInstance(count) ? count : D(count)).minus(D(landon1Cost));
            landonMultiplier = (isDecimalInstance(landonMultiplier) ? landonMultiplier : D(landonMultiplier)).times(D(landon1Multiplier));
            landon1Purchased = true;
            updateDisplays();
        } else { alert('Not enough What Happeneds — need ' + formatNumber(landon1Cost) + '.'); }
    } else {
        if (count >= landon1Cost) {
            count -= landon1Cost;
            if (hasDecimal) landonMultiplier = (isDecimalInstance(landonMultiplier) ? landonMultiplier : D(landonMultiplier)).times(D(landon1Multiplier));
            else landonMultiplier *= landon1Multiplier;
            landon1Purchased = true;
            updateDisplays();
        } else { alert('Not enough What Happeneds — need ' + formatNumber(landon1Cost) + '.'); }
    }
}

function buyLandon2() {
    if (landon2Purchased) return;
    if (numericLevel(upgrade20Level) < 25) { alert('Unlocks at The Landon Stream level 25.'); return; }
    if (hasDecimal) {
        if ((isDecimalInstance(count) ? count : D(count)).gte(D(landon2Cost))) {
            count = (isDecimalInstance(count) ? count : D(count)).minus(D(landon2Cost));
            landonMultiplier = (isDecimalInstance(landonMultiplier) ? landonMultiplier : D(landonMultiplier)).times(D(landon2Multiplier));
            landon2Purchased = true;
            updateDisplays();
        } else { alert('Not enough What Happeneds — need ' + formatNumber(landon2Cost) + '.'); }
    } else {
        if (count >= landon2Cost) {
            count -= landon2Cost;
            if (hasDecimal) landonMultiplier = (isDecimalInstance(landonMultiplier) ? landonMultiplier : D(landonMultiplier)).times(D(landon2Multiplier));
            else landonMultiplier *= landon2Multiplier;
            landon2Purchased = true;
            updateDisplays();
        } else { alert('Not enough What Happeneds — need ' + formatNumber(landon2Cost) + '.'); }
    }
}

function buyLandon3() {
    if (landon3Purchased) return;
    if (numericLevel(upgrade20Level) < 50) { alert('Unlocks at The Landon Stream level 50.'); return; }
    if (hasDecimal) {
        if ((isDecimalInstance(count) ? count : D(count)).gte(D(landon3Cost))) {
            count = (isDecimalInstance(count) ? count : D(count)).minus(D(landon3Cost));
            landonMultiplier = (isDecimalInstance(landonMultiplier) ? landonMultiplier : D(landonMultiplier)).times(D(landon3Multiplier));
            landon3Purchased = true;
            updateDisplays();
        } else { alert('Not enough What Happeneds — need ' + formatNumber(landon3Cost) + '.'); }
    } else {
        if (count >= landon3Cost) {
            count -= landon3Cost;
            if (hasDecimal) landonMultiplier = (isDecimalInstance(landonMultiplier) ? landonMultiplier : D(landonMultiplier)).times(D(landon3Multiplier));
            else landonMultiplier *= landon3Multiplier;
            landon3Purchased = true;
            updateDisplays();
        } else { alert('Not enough What Happeneds — need ' + formatNumber(landon3Cost) + '.'); }
    }
}

function buyLandon4() {
    if (landon4Purchased) return;
    if (numericLevel(upgrade20Level) < 100) { alert('Unlocks at The Landon Stream level 100.'); return; }
    if (hasDecimal) {
        if ((isDecimalInstance(count) ? count : D(count)).gte(D(landon4Cost))) {
            count = (isDecimalInstance(count) ? count : D(count)).minus(D(landon4Cost));
            landonMultiplier = (isDecimalInstance(landonMultiplier) ? landonMultiplier : D(landonMultiplier)).times(D(landon4Multiplier));
            landon4Purchased = true;
            updateDisplays();
        } else { alert('Not enough What Happeneds — need ' + formatNumber(landon4Cost) + '.'); }
    } else {
        if (count >= landon4Cost) {
            count -= landon4Cost;
            if (hasDecimal) landonMultiplier = (isDecimalInstance(landonMultiplier) ? landonMultiplier : D(landonMultiplier)).times(D(landon4Multiplier));
            else landonMultiplier *= landon4Multiplier;
            landon4Purchased = true;
            updateDisplays();
        } else { alert('Not enough What Happeneds — need ' + formatNumber(landon4Cost) + '.'); }
    }
}

// The Bass specials (upgrade21)
function buyTheBass1() {
    if (theBass1Purchased) return;
    if (numericLevel(upgrade21Level) < 10) { alert('Unlocks at The Bass level 10.'); return; }
    if (hasDecimal) {
        if ((isDecimalInstance(count) ? count : D(count)).gte(D(theBass1Cost))) {
            count = (isDecimalInstance(count) ? count : D(count)).minus(D(theBass1Cost));
            theBassMultiplier = (isDecimalInstance(theBassMultiplier) ? theBassMultiplier : D(theBassMultiplier)).times(D(theBass1Multiplier));
            theBass1Purchased = true;
            updateDisplays();
        } else { alert('Not enough What Happeneds — need ' + formatNumber(theBass1Cost) + '.'); }
    } else {
        if (count >= theBass1Cost) {
            count -= theBass1Cost;
            if (hasDecimal) theBassMultiplier = (isDecimalInstance(theBassMultiplier) ? theBassMultiplier : D(theBassMultiplier)).times(D(theBass1Multiplier));
            else theBassMultiplier *= theBass1Multiplier;
            theBass1Purchased = true;
            updateDisplays();
        } else { alert('Not enough What Happeneds — need ' + formatNumber(theBass1Cost) + '.'); }
    }
}

function buyTheBass2() {
    if (theBass2Purchased) return;
    if (numericLevel(upgrade21Level) < 25) { alert('Unlocks at The Bass level 25.'); return; }
    if (hasDecimal) {
        if ((isDecimalInstance(count) ? count : D(count)).gte(D(theBass2Cost))) {
            count = (isDecimalInstance(count) ? count : D(count)).minus(D(theBass2Cost));
            theBassMultiplier = (isDecimalInstance(theBassMultiplier) ? theBassMultiplier : D(theBassMultiplier)).times(D(theBass2Multiplier));
            theBass2Purchased = true;
            updateDisplays();
        } else { alert('Not enough What Happeneds — need ' + formatNumber(theBass2Cost) + '.'); }
    } else {
        if (count >= theBass2Cost) {
            count -= theBass2Cost;
            if (hasDecimal) theBassMultiplier = (isDecimalInstance(theBassMultiplier) ? theBassMultiplier : D(theBassMultiplier)).times(D(theBass2Multiplier));
            else theBassMultiplier *= theBass2Multiplier;
            theBass2Purchased = true;
            updateDisplays();
        } else { alert('Not enough What Happeneds — need ' + formatNumber(theBass2Cost) + '.'); }
    }
}

function buyTheBass3() {
    if (theBass3Purchased) return;
    if (numericLevel(upgrade21Level) < 50) { alert('Unlocks at The Bass level 50.'); return; }
    if (hasDecimal) {
        if ((isDecimalInstance(count) ? count : D(count)).gte(D(theBass3Cost))) {
            count = (isDecimalInstance(count) ? count : D(count)).minus(D(theBass3Cost));
            theBassMultiplier = (isDecimalInstance(theBassMultiplier) ? theBassMultiplier : D(theBassMultiplier)).times(D(theBass3Multiplier));
            theBass3Purchased = true;
            updateDisplays();
        } else { alert('Not enough What Happeneds — need ' + formatNumber(theBass3Cost) + '.'); }
    } else {
        if (count >= theBass3Cost) {
            count -= theBass3Cost;
            if (hasDecimal) theBassMultiplier = (isDecimalInstance(theBassMultiplier) ? theBassMultiplier : D(theBassMultiplier)).times(D(theBass3Multiplier));
            else theBassMultiplier *= theBass3Multiplier;
            theBass3Purchased = true;
            updateDisplays();
        } else { alert('Not enough What Happeneds — need ' + formatNumber(theBass3Cost) + '.'); }
    }
}

function buyTheBass4() {
    if (theBass4Purchased) return;
    if (numericLevel(upgrade21Level) < 100) { alert('Unlocks at The Bass level 100.'); return; }
    if (hasDecimal) {
        if ((isDecimalInstance(count) ? count : D(count)).gte(D(theBass4Cost))) {
            count = (isDecimalInstance(count) ? count : D(count)).minus(D(theBass4Cost));
            theBassMultiplier = (isDecimalInstance(theBassMultiplier) ? theBassMultiplier : D(theBassMultiplier)).times(D(theBass4Multiplier));
            theBass4Purchased = true;
            updateDisplays();
        } else { alert('Not enough What Happeneds — need ' + formatNumber(theBass4Cost) + '.'); }
    } else {
        if (count >= theBass4Cost) {
            count -= theBass4Cost;
            if (hasDecimal) theBassMultiplier = (isDecimalInstance(theBassMultiplier) ? theBassMultiplier : D(theBassMultiplier)).times(D(theBass4Multiplier));
            else theBassMultiplier *= theBass4Multiplier;
            theBass4Purchased = true;
            updateDisplays();
        } else { alert('Not enough What Happeneds — need ' + formatNumber(theBass4Cost) + '.'); }
    }
}

// Diddy Blud purchase handlers
function buyDiddy1() {
    if (diddy1Purchased) return;
    if (upgrade4Level < 1) { alert('Unlocks at Diddy lvl 1.'); return; }
    if (hasDecimal) {
        if ((isDecimalInstance(count) ? count : D(count)).gte(D(diddy1Cost))) {
            count = (isDecimalInstance(count) ? count : D(count)).minus(D(diddy1Cost));
            baseOtherCps = (isDecimalInstance(baseOtherCps) ? baseOtherCps : D(baseOtherCps)).plus(D(50));
            diddy1Purchased = true;
            updateDisplays();
        } else { alert('Not enough What Happeneds — need ' + formatNumber(diddy1Cost) + '.'); }
    } else {
        if (count >= diddy1Cost) {
            count -= diddy1Cost;
            baseOtherCps += 50;
            diddy1Purchased = true;
            updateDisplays();
        } else { alert('Not enough What Happeneds — need ' + formatNumber(diddy1Cost) + '.'); }
    }
}

function buyDiddy2() {
    if (diddy2Purchased) return;
    if (upgrade4Level < 5) { alert('Unlocks at Diddy lvl 5.'); return; }
    if (hasDecimal) {
        if ((isDecimalInstance(count) ? count : D(count)).gte(D(diddy2Cost))) {
            count = (isDecimalInstance(count) ? count : D(count)).minus(D(diddy2Cost));
            diddyOtherMultiplier = (isDecimalInstance(diddyOtherMultiplier) ? diddyOtherMultiplier : D(diddyOtherMultiplier)).times(D(2));
            diddy2Purchased = true;
            updateDisplays();
        } else { alert('Not enough What Happeneds — need ' + formatNumber(diddy2Cost) + '.'); }
    } else {
        if (count >= diddy2Cost) {
            count -= diddy2Cost;
            if (hasDecimal) diddyOtherMultiplier = (isDecimalInstance(diddyOtherMultiplier) ? diddyOtherMultiplier : D(diddyOtherMultiplier)).times(D(2));
            else diddyOtherMultiplier *= 2;
            diddy2Purchased = true;
            updateDisplays();
        } else { alert('Not enough What Happeneds — need ' + formatNumber(diddy2Cost) + '.'); }
    }
}

function buyDiddy3() {
    if (diddy3Purchased) return;
    if (upgrade4Level < 10) { alert('Unlocks at Diddy lvl 10.'); return; }
    if (hasDecimal) {
        if ((isDecimalInstance(count) ? count : D(count)).gte(D(diddy3Cost))) {
            count = (isDecimalInstance(count) ? count : D(count)).minus(D(diddy3Cost));
            clickMultiplier = (isDecimalInstance(clickMultiplier) ? clickMultiplier : D(clickMultiplier)).times(D(1.5));
            diddy3Purchased = true;
            updateDisplays();
        } else { alert('Not enough What Happeneds — need ' + formatNumber(diddy3Cost) + '.'); }
    } else {
        if (count >= diddy3Cost) {
            count -= diddy3Cost;
            if (hasDecimal) clickMultiplier = (isDecimalInstance(clickMultiplier) ? clickMultiplier : D(clickMultiplier)).times(D(1.5));
            else clickMultiplier *= 1.5;
            diddy3Purchased = true;
            updateDisplays();
        } else { alert('Not enough What Happeneds — need ' + formatNumber(diddy3Cost) + '.'); }
    }
}

function buyDiddy4() {
    if (diddy4Purchased) return;
    if (upgrade4Level < 20) { alert('Unlocks at Diddy lvl 20.'); return; }
    if (hasDecimal) {
        if ((isDecimalInstance(count) ? count : D(count)).gte(D(diddy4Cost))) {
            count = (isDecimalInstance(count) ? count : D(count)).minus(D(diddy4Cost));
            diddyMultiplier = (isDecimalInstance(diddyMultiplier) ? diddyMultiplier : D(diddyMultiplier)).times(D(1.25));
            diddy4Purchased = true;
            updateDisplays();
        } else { alert('Not enough What Happeneds — need ' + formatNumber(diddy4Cost) + '.'); }
    } else {
        if (count >= diddy4Cost) {
            count -= diddy4Cost;
            if (hasDecimal) diddyMultiplier = (isDecimalInstance(diddyMultiplier) ? diddyMultiplier : D(diddyMultiplier)).times(D(1.25));
            else diddyMultiplier *= 1.25;
            diddy4Purchased = true;
            updateDisplays();
        } else { alert('Not enough What Happeneds — need ' + formatNumber(diddy4Cost) + '.'); }
    }
}

// Argonian special purchase handlers
function buyArgon1() {
    if (argon1Purchased) return;
    if (upgrade5Level < 10) { alert('Unlocks at Argonian level 10.'); return; }
    if (hasDecimal) {
        if ((isDecimalInstance(count) ? count : D(count)).gte(D(argon1Cost))) {
            count = (isDecimalInstance(count) ? count : D(count)).minus(D(argon1Cost));
            clickMultiplier = (isDecimalInstance(clickMultiplier) ? clickMultiplier : D(clickMultiplier)).times(D(argon1Multiplier));
            argon1Purchased = true;
            updateDisplays();
        } else { alert('Not enough What Happeneds — need ' + formatNumber(argon1Cost) + '.'); }
    } else {
        if (count >= argon1Cost) {
            count -= argon1Cost;
            if (hasDecimal) clickMultiplier = (isDecimalInstance(clickMultiplier) ? clickMultiplier : D(clickMultiplier)).times(D(argon1Multiplier));
            else clickMultiplier *= argon1Multiplier;
            argon1Purchased = true;
            updateDisplays();
        } else { alert('Not enough What Happeneds — need ' + formatNumber(argon1Cost) + '.'); }
    }
}

function buyArgon2() {
    if (argon2Purchased) return;
    if (upgrade5Level < 25) { alert('Unlocks at Argonian level 25.'); return; }
    if (hasDecimal) {
        if ((isDecimalInstance(count) ? count : D(count)).gte(D(argon2Cost))) {
            count = (isDecimalInstance(count) ? count : D(count)).minus(D(argon2Cost));
            argonOtherMultiplier = (isDecimalInstance(argonOtherMultiplier) ? argonOtherMultiplier : D(argonOtherMultiplier)).times(D(argon2Multiplier));
            argon2Purchased = true;
            updateDisplays();
        } else { alert('Not enough What Happeneds — need ' + formatNumber(argon2Cost) + '.'); }
    } else {
        if (count >= argon2Cost) {
            count -= argon2Cost;
            if (hasDecimal) argonOtherMultiplier = (isDecimalInstance(argonOtherMultiplier) ? argonOtherMultiplier : D(argonOtherMultiplier)).times(D(argon2Multiplier));
            else argonOtherMultiplier *= argon2Multiplier;
            argon2Purchased = true;
            updateDisplays();
        } else { alert('Not enough What Happeneds — need ' + formatNumber(argon2Cost) + '.'); }
    }
}

function buyArgon3() {
    if (argon3Purchased) return;
    if (upgrade5Level < 50) { alert('Unlocks at Argonian level 50.'); return; }
    if (hasDecimal) {
        if ((isDecimalInstance(count) ? count : D(count)).gte(D(argon3Cost))) {
            count = (isDecimalInstance(count) ? count : D(count)).minus(D(argon3Cost));
            clickMultiplier = (isDecimalInstance(clickMultiplier) ? clickMultiplier : D(clickMultiplier)).times(D(argon3Multiplier));
            argon3Purchased = true;
            updateDisplays();
        } else { alert('Not enough What Happeneds — need ' + formatNumber(argon3Cost) + '.'); }
    } else {
        if (count >= argon3Cost) {
            count -= argon3Cost;
            if (hasDecimal) clickMultiplier = (isDecimalInstance(clickMultiplier) ? clickMultiplier : D(clickMultiplier)).times(D(argon3Multiplier));
            else clickMultiplier *= argon3Multiplier;
            argon3Purchased = true;
            updateDisplays();
        } else { alert('Not enough What Happeneds — need ' + formatNumber(argon3Cost) + '.'); }
    }
}

function buyArgon4() {
    if (argon4Purchased) return;
    if (upgrade5Level < 100) { alert('Unlocks at Argonian level 100.'); return; }
    if (hasDecimal) {
        if ((isDecimalInstance(count) ? count : D(count)).gte(D(argon4Cost))) {
            count = (isDecimalInstance(count) ? count : D(count)).minus(D(argon4Cost));
            argonMultiplier = (isDecimalInstance(argonMultiplier) ? argonMultiplier : D(argonMultiplier)).times(D(argon4Multiplier));
            argon4Purchased = true;
            updateDisplays();
        } else { alert('Not enough What Happeneds — need ' + formatNumber(argon4Cost) + '.'); }
    } else {
        if (count >= argon4Cost) {
            count -= argon4Cost;
            if (hasDecimal) argonMultiplier = (isDecimalInstance(argonMultiplier) ? argonMultiplier : D(argonMultiplier)).times(D(argon4Multiplier));
            else argonMultiplier *= argon4Multiplier;
            argon4Purchased = true;
            updateDisplays();
        } else { alert('Not enough What Happeneds — need ' + formatNumber(argon4Cost) + '.'); }
    }
}

// Grape special purchase handlers
function buyGrape1() {
    if (grape1Purchased) return;
    if (upgrade6Level < 1) { alert('Unlocks at Grape lvl 1.'); return; }
    if (hasDecimal) {
        if ((isDecimalInstance(count) ? count : D(count)).gte(D(grape1Cost))) {
            count = (isDecimalInstance(count) ? count : D(count)).minus(D(grape1Cost));
            baseOtherCps = (isDecimalInstance(baseOtherCps) ? baseOtherCps : D(baseOtherCps)).plus(D(1000));
            grape1Purchased = true;
            updateDisplays();
        } else { alert('Not enough What Happeneds — need ' + formatNumber(grape1Cost) + '.'); }
    } else {
        if (count >= grape1Cost) {
            count -= grape1Cost;
            baseOtherCps += 1000;
            grape1Purchased = true;
            updateDisplays();
        } else { alert('Not enough What Happeneds — need ' + formatNumber(grape1Cost) + '.'); }
    }
}

function buyGrape2() {
    if (grape2Purchased) return;
    if (upgrade6Level < 5) { alert('Unlocks at Grape lvl 5.'); return; }
    if (hasDecimal) {
        if ((isDecimalInstance(count) ? count : D(count)).gte(D(grape2Cost))) {
            count = (isDecimalInstance(count) ? count : D(count)).minus(D(grape2Cost));
            grapeOtherMultiplier = (isDecimalInstance(grapeOtherMultiplier) ? grapeOtherMultiplier : D(grapeOtherMultiplier)).times(D(grape2Multiplier));
            grape2Purchased = true;
            updateDisplays();
        } else { alert('Not enough What Happeneds — need ' + formatNumber(grape2Cost) + '.'); }
    } else {
        if (count >= grape2Cost) {
            count -= grape2Cost;
            if (hasDecimal) grapeOtherMultiplier = (isDecimalInstance(grapeOtherMultiplier) ? grapeOtherMultiplier : D(grapeOtherMultiplier)).times(D(grape2Multiplier));
            else grapeOtherMultiplier *= grape2Multiplier;
            grape2Purchased = true;
            updateDisplays();
        } else { alert('Not enough What Happeneds — need ' + formatNumber(grape2Cost) + '.'); }
    }
}

function buyGrape3() {
    if (grape3Purchased) return;
    if (upgrade6Level < 10) { alert('Unlocks at Grape lvl 10.'); return; }
    if (hasDecimal) {
        if ((isDecimalInstance(count) ? count : D(count)).gte(D(grape3Cost))) {
            count = (isDecimalInstance(count) ? count : D(count)).minus(D(grape3Cost));
            clickMultiplier = (isDecimalInstance(clickMultiplier) ? clickMultiplier : D(clickMultiplier)).times(D(grape3Multiplier));
            grape3Purchased = true;
            updateDisplays();
        } else { alert('Not enough What Happeneds — need ' + formatNumber(grape3Cost) + '.'); }
    } else {
        if (count >= grape3Cost) {
            count -= grape3Cost;
            if (hasDecimal) clickMultiplier = (isDecimalInstance(clickMultiplier) ? clickMultiplier : D(clickMultiplier)).times(D(grape3Multiplier));
            else clickMultiplier *= grape3Multiplier;
            grape3Purchased = true;
            updateDisplays();
        } else { alert('Not enough What Happeneds — need ' + formatNumber(grape3Cost) + '.'); }
    }
}

function buyGrape4() {
    if (grape4Purchased) return;
    if (upgrade6Level < 20) { alert('Unlocks at Grape lvl 20.'); return; }
    if (hasDecimal) {
        if ((isDecimalInstance(count) ? count : D(count)).gte(D(grape4Cost))) {
            count = (isDecimalInstance(count) ? count : D(count)).minus(D(grape4Cost));
            grapeMultiplier = (isDecimalInstance(grapeMultiplier) ? grapeMultiplier : D(grapeMultiplier)).times(D(grape4Multiplier));
            grape4Purchased = true;
            updateDisplays();
        } else { alert('Not enough What Happeneds — need ' + formatNumber(grape4Cost) + '.'); }
    } else {
        if (count >= grape4Cost) {
            count -= grape4Cost;
            if (hasDecimal) grapeMultiplier = (isDecimalInstance(grapeMultiplier) ? grapeMultiplier : D(grapeMultiplier)).times(D(grape4Multiplier));
            else grapeMultiplier *= grape4Multiplier;
            grape4Purchased = true;
            updateDisplays();
        } else { alert('Not enough What Happeneds — need ' + formatNumber(grape4Cost) + '.'); }
    }
}

// Skippie special purchase handlers
function buySkippie1() {
    if (skippie1Purchased) return;
    if (upgrade7Level < 1) { alert('Unlocks at Skippie lvl 1.'); return; }
    if (hasDecimal) {
        if ((isDecimalInstance(count) ? count : D(count)).gte(D(skippie1Cost))) {
            count = (isDecimalInstance(count) ? count : D(count)).minus(D(skippie1Cost));
            baseOtherCps = (isDecimalInstance(baseOtherCps) ? baseOtherCps : D(baseOtherCps)).plus(D(5000));
            skippie1Purchased = true;
            updateDisplays();
        } else { alert('Not enough What Happeneds — need ' + formatNumber(skippie1Cost) + '.'); }
    } else {
        if (count >= skippie1Cost) {
            count -= skippie1Cost;
            baseOtherCps += 5000;
            skippie1Purchased = true;
            updateDisplays();
        } else { alert('Not enough What Happeneds — need ' + formatNumber(skippie1Cost) + '.'); }
    }
}

function buySkippie2() {
    if (skippie2Purchased) return;
    if (upgrade7Level < 5) { alert('Unlocks at Skippie lvl 5.'); return; }
    if (hasDecimal) {
        if ((isDecimalInstance(count) ? count : D(count)).gte(D(skippie2Cost))) {
            count = (isDecimalInstance(count) ? count : D(count)).minus(D(skippie2Cost));
            skippieOtherMultiplier = (isDecimalInstance(skippieOtherMultiplier) ? skippieOtherMultiplier : D(skippieOtherMultiplier)).times(D(skippie2Multiplier));
            skippie2Purchased = true;
            updateDisplays();
        } else { alert('Not enough What Happeneds — need ' + formatNumber(skippie2Cost) + '.'); }
    } else {
        if (count >= skippie2Cost) {
            count -= skippie2Cost;
            if (hasDecimal) skippieOtherMultiplier = (isDecimalInstance(skippieOtherMultiplier) ? skippieOtherMultiplier : D(skippieOtherMultiplier)).times(D(skippie2Multiplier));
            else skippieOtherMultiplier *= skippie2Multiplier;
            skippie2Purchased = true;
            updateDisplays();
        } else { alert('Not enough What Happeneds — need ' + formatNumber(skippie2Cost) + '.'); }
    }
}

function buySkippie3() {
    if (skippie3Purchased) return;
    if (upgrade7Level < 10) { alert('Unlocks at Skippie lvl 10.'); return; }
    if (hasDecimal) {
        if ((isDecimalInstance(count) ? count : D(count)).gte(D(skippie3Cost))) {
            count = (isDecimalInstance(count) ? count : D(count)).minus(D(skippie3Cost));
            clickMultiplier = (isDecimalInstance(clickMultiplier) ? clickMultiplier : D(clickMultiplier)).times(D(skippie3Multiplier));
            skippie3Purchased = true;
            updateDisplays();
        } else { alert('Not enough What Happeneds — need ' + formatNumber(skippie3Cost) + '.'); }
    } else {
        if (count >= skippie3Cost) {
            count -= skippie3Cost;
            if (hasDecimal) clickMultiplier = (isDecimalInstance(clickMultiplier) ? clickMultiplier : D(clickMultiplier)).times(D(skippie3Multiplier));
            else clickMultiplier *= skippie3Multiplier;
            skippie3Purchased = true;
            updateDisplays();
        } else { alert('Not enough What Happeneds — need ' + formatNumber(skippie3Cost) + '.'); }
    }
}

function buySkippie4() {
    if (skippie4Purchased) return;
    if (upgrade7Level < 20) { alert('Unlocks at Skippie lvl 20.'); return; }
    if (hasDecimal) {
        if ((isDecimalInstance(count) ? count : D(count)).gte(D(skippie4Cost))) {
            count = (isDecimalInstance(count) ? count : D(count)).minus(D(skippie4Cost));
            skippieMultiplier = (isDecimalInstance(skippieMultiplier) ? skippieMultiplier : D(skippieMultiplier)).times(D(skippie4Multiplier));
            skippie4Purchased = true;
            updateDisplays();
        } else { alert('Not enough What Happeneds — need ' + formatNumber(skippie4Cost) + '.'); }
    } else {
        if (count >= skippie4Cost) {
            count -= skippie4Cost;
            if (hasDecimal) skippieMultiplier = (isDecimalInstance(skippieMultiplier) ? skippieMultiplier : D(skippieMultiplier)).times(D(skippie4Multiplier));
            else skippieMultiplier *= skippie4Multiplier;
            skippie4Purchased = true;
            updateDisplays();
        } else { alert('Not enough What Happeneds — need ' + formatNumber(skippie4Cost) + '.'); }
    }
}

// Island special purchase handlers
function buyIsland1() {
    if (island1Purchased) return;
    if (upgrade8Level < 1) { alert('Unlocks at Island lvl 1.'); return; }
    if (count >= island1Cost) {
        count -= island1Cost;
        baseOtherCps += 50000;
        island1Purchased = true;
        updateDisplays();
    } else { alert('Not enough What Happeneds — need ' + formatNumber(island1Cost) + '.'); }
}

function buyIsland2() {
    if (island2Purchased) return;
    if (upgrade8Level < 5) { alert('Unlocks at Island lvl 5.'); return; }
    if (count >= island2Cost) {
        count -= island2Cost;
        if (hasDecimal) islandOtherMultiplier = (isDecimalInstance(islandOtherMultiplier) ? islandOtherMultiplier : D(islandOtherMultiplier)).times(D(island2Multiplier));
        else islandOtherMultiplier *= island2Multiplier;
        island2Purchased = true;
        updateDisplays();
    } else { alert('Not enough What Happeneds — need ' + formatNumber(island2Cost) + '.'); }
}

function buyIsland3() {
    if (island3Purchased) return;
    if (upgrade8Level < 10) { alert('Unlocks at Island lvl 10.'); return; }
    if (count >= island3Cost) {
        count -= island3Cost;
        if (hasDecimal) clickMultiplier = (isDecimalInstance(clickMultiplier) ? clickMultiplier : D(clickMultiplier)).times(D(island3Multiplier));
        else clickMultiplier *= island3Multiplier;
        island3Purchased = true;
        updateDisplays();
    } else { alert('Not enough What Happeneds — need ' + formatNumber(island3Cost) + '.'); }
}

function buyIsland4() {
    if (island4Purchased) return;
    if (upgrade8Level < 20) { alert('Unlocks at Island lvl 20.'); return; }
    if (count >= island4Cost) {
        count -= island4Cost;
        if (hasDecimal) islandMultiplier = (isDecimalInstance(islandMultiplier) ? islandMultiplier : D(islandMultiplier)).times(D(island4Multiplier));
        else islandMultiplier *= island4Multiplier;
        island4Purchased = true;
        updateDisplays();
    } else { alert('Not enough What Happeneds — need ' + formatNumber(island4Cost) + '.'); }
}

// Phonk special purchase handlers
let phonk1Purchased = false;
let phonk2Purchased = false;
let phonk3Purchased = false;
let phonk4Purchased = false;
let phonk5Purchased = false;

function buyPhonk1() {
    if (phonk1Purchased) return;
    if (upgrade10Level < 10) { alert('Unlocks at Phonk lvl 10.'); return; }
    if (count >= phonk1Cost) {
        count -= phonk1Cost;
        if (hasDecimal) phonkMultiplier = (isDecimalInstance(phonkMultiplier) ? phonkMultiplier : D(phonkMultiplier)).times(D(phonk1Multiplier));
        else phonkMultiplier *= phonk1Multiplier;
        phonk1Purchased = true;
        saveGame(); try { playSfx('purchase.wav'); } catch (e) {} updateDisplays();
    } else { alert('Not enough What Happeneds — need ' + formatNumber(phonk1Cost) + '.'); }
}

function buyPhonk2() {
    if (phonk2Purchased) return;
    if (upgrade10Level < 25) { alert('Unlocks at Phonk lvl 25.'); return; }
    if (count >= phonk2Cost) {
        count -= phonk2Cost;
        if (hasDecimal) phonkMultiplier = (isDecimalInstance(phonkMultiplier) ? phonkMultiplier : D(phonkMultiplier)).times(D(phonk2Multiplier));
        else phonkMultiplier *= phonk2Multiplier;
        phonk2Purchased = true;
        saveGame(); try { playSfx('purchase.wav'); } catch (e) {} updateDisplays();
    } else { alert('Not enough What Happeneds — need ' + formatNumber(phonk2Cost) + '.'); }
}

function buyPhonk3() {
    if (phonk3Purchased) return;
    if (upgrade10Level < 50) { alert('Unlocks at Phonk lvl 50.'); return; }
    if (count >= phonk3Cost) {
        count -= phonk3Cost;
        if (hasDecimal) phonkMultiplier = (isDecimalInstance(phonkMultiplier) ? phonkMultiplier : D(phonkMultiplier)).times(D(phonk3Multiplier));
        else phonkMultiplier *= phonk3Multiplier;
        phonk3Purchased = true;
        saveGame(); try { playSfx('purchase.wav'); } catch (e) {} updateDisplays();
    } else { alert('Not enough What Happeneds — need ' + formatNumber(phonk3Cost) + '.'); }
}

function buyPhonk4() {
    if (phonk4Purchased) return;
    if (upgrade10Level < 75) { alert('Unlocks at Phonk lvl 75.'); return; }
    if (count >= phonk4Cost) {
        count -= phonk4Cost;
        if (hasDecimal) phonkOtherMultiplier = (isDecimalInstance(phonkOtherMultiplier) ? phonkOtherMultiplier : D(phonkOtherMultiplier)).times(D(phonk4Multiplier));
        else phonkOtherMultiplier *= phonk4Multiplier;
        phonk4Purchased = true;
        saveGame(); try { playSfx('purchase.wav'); } catch (e) {} updateDisplays();
    } else { alert('Not enough What Happeneds — need ' + formatNumber(phonk4Cost) + '.'); }
}

function buyPhonk5() {
    if (phonk5Purchased) return;
    if (upgrade10Level < 100) { alert('Unlocks at Phonk lvl 100.'); return; }
    if (count >= phonk5Cost) {
        count -= phonk5Cost;
        if (hasDecimal) phonkMultiplier = (isDecimalInstance(phonkMultiplier) ? phonkMultiplier : D(phonkMultiplier)).times(D(phonk5Multiplier));
        else phonkMultiplier *= phonk5Multiplier;
        phonk5Purchased = true;
        saveGame(); try { playSfx('purchase.wav'); } catch (e) {} updateDisplays();
    } else { alert('Not enough What Happeneds — need ' + formatNumber(phonk5Cost) + '.'); }
}

// Fetch active clan buff from Firestore and set window.clanBuffCpsMult / clanBuffClickMult for updateDisplays
async function refreshClanBuff() {
    try {
        var clanId = localStorage.getItem('player_clanId');
        if (!clanId) { window.clanBuffCpsMult = 1; window.clanBuffClickMult = 1; return; }
        var dbVal = typeof window !== 'undefined' && window.db;
        var docFn = typeof window !== 'undefined' && window.doc;
        var getDocFn = typeof window !== 'undefined' && window.getDoc;
        if (!dbVal || !docFn || typeof getDocFn !== 'function') return;
        var snap = await getDocFn(docFn(dbVal, 'clans', clanId));
        if (!snap.exists()) { window.clanBuffCpsMult = 1; window.clanBuffClickMult = 1; return; }
        var d = snap.data();
        var ab = d.activeBuff;
        if (!ab || !ab.expiresAt) { window.clanBuffCpsMult = 1; window.clanBuffClickMult = 1; return; }
        var exp = typeof ab.expiresAt === 'number' ? ab.expiresAt : (ab.expiresAt.toMillis ? ab.expiresAt.toMillis() : 0);
        if (exp <= Date.now()) { window.clanBuffCpsMult = 1; window.clanBuffClickMult = 1; return; }
        window.clanBuffCpsMult = typeof ab.cpsMult === 'number' ? ab.cpsMult : 1;
        window.clanBuffClickMult = typeof ab.clickMult === 'number' ? ab.clickMult : 1;
    } catch (e) { try { window.clanBuffCpsMult = 1; window.clanBuffClickMult = 1; } catch (e2) {} }
}

// Ensure buttons and displays show initial values on load
function initApp() {
    try {
        console.log('initApp: start');
    // load saved game (if any) then update displays
    loadGame();
    try { refreshClanBuff(); } catch (e) {}
    updateDisplays();
    try { updateShopUI(); } catch (e) {}
    // initialize hover tooltips for upgrades
    try { initTooltips(); } catch (e) {}
    // auto-increment by cps once per second (uses 100ms ticks)
    setInterval(() => {
        try {
            // Debugging: inspect numeric mode and cps type/value
            try { console.debug('Auto-tick', { hasDecimal: hasDecimal, hasBig: hasBig, cpsType: typeof cps, cpsValue: (isDecimalInstance(cps) ? (cps && cps.toString ? cps.toString() : String(cps)) : cps) }); } catch (e) {}
            if (hasBig) {
                const cpsVal = D(cps);
                const isPositive = (typeof cpsVal === 'number' && cpsVal > 0) || (cpsVal && typeof cpsVal.gt === 'function' ? cpsVal.gt(0) : Number(cpsVal) > 0);
                if (isPositive) {
                    const inc = (typeof cpsVal.div === 'function') ? cpsVal.div(10) : D(Number(cpsVal) / 10);
                    try { console.debug('Auto-tick (Decimal)', { inc: (inc && inc.toString ? inc.toString() : inc) }); } catch (e) {}
                    addToCount(inc);
                    updateDisplays();
                }
            } else {
                if (cps > 0) {
                    const numericInc = Number(cps) / 10;
                    try { console.debug('Auto-tick (numeric)', { numericInc: numericInc, cps: cps }); } catch (e) {}
                    count = (typeof count === 'number' ? count : Number(count)) + numericInc;
                    updateDisplays();
                }
            }
        } catch (e) { console.error('Auto-tick error', e); }
    }, 100);
    // refresh clan buff from Firestore every 60s when in a clan
    setInterval(function () { try { refreshClanBuff(); } catch (e) {} }, 60000);
    // ensure special menu state reflects initial (collapsed)
    const sm = document.getElementById('specialMenu');
    if (sm) sm.classList.remove('open');
    // restore persisted main image max width
    try {
        const saved = localStorage.getItem('whathappened_image_max');
        if (saved) mainImageMaxWidth = Number(saved) || mainImageMaxWidth;
    } catch (e) {}
    applyMainImageMaxWidth();
    // wire up settings slider
    const slider = document.getElementById('imageSizeSlider');
    if (slider) {
        slider.min = 400; slider.max = 1400; slider.step = 50;
        slider.value = mainImageMaxWidth;
        slider.addEventListener('input', (ev) => { setMainImageMaxWidth(ev.target.value); console.log('imageSizeSlider input', ev.target.value); });
        slider.addEventListener('change', (ev) => { setMainImageMaxWidth(ev.target.value); console.log('imageSizeSlider change', ev.target.value); });
    }
    // wire up background music (controls in settings)
    try {
        const audio = document.getElementById('bgMusic');
            if (audio) {
            bgMusicElement = audio;
            audio.loop = true;
            audio.volume = (typeof musicVolume === 'number') ? Math.max(0, Math.min(1, musicVolume)) : 0.5;
            audio.muted = !!musicMuted;
            try {
                // restore equipped track selection if present
                const trackFile = (typeof currentMusicTrack === 'string' && currentMusicTrack && currentMusicTrack !== 'mainTheme') ? (currentMusicTrack + '.mp3') : 'mainTheme.mp3';
                if (!audio.src || audio.src.indexOf(trackFile) === -1) audio.src = 'audio/' + trackFile;
                // try to play (may be blocked by browser autoplay); that's acceptable
                try { if (!audio.paused && audio.currentTime) {} else { audio.play().catch(()=>{}); } } catch (e) {}
            } catch (e) {}
            const volSlider = document.getElementById('musicVolumeSlider');
            const volLabel = document.getElementById('musicVolumeLabel');
            // wire up SFX controls
            try {
                const sfxSlider = document.getElementById('sfxVolumeSlider');
                const sfxLabel = document.getElementById('sfxVolumeLabel');
                const sfxBtn = document.getElementById('sfxMuteBtn');
                if (sfxSlider) {
                    sfxSlider.min = 0; sfxSlider.max = 100; sfxSlider.step = 1;
                    sfxSlider.value = Math.round((typeof sfxVolume === 'number' ? sfxVolume : 0.8) * 100);
                    sfxSlider.addEventListener('input', (ev) => {
                        const v = Math.max(0, Math.min(100, Number(ev.target.value) || 0));
                        sfxVolume = v / 100;
                        if (sfxLabel) sfxLabel.innerText = v + '%';
                        if (sfxBtn && sfxMuted && v > 0) { sfxMuted = false; sfxBtn.innerText = 'Mute SFX'; }
                    });
                    sfxSlider.addEventListener('change', (ev) => { saveGame(); });
                }
                if (sfxBtn) sfxBtn.innerText = sfxMuted ? 'Unmute SFX' : 'Mute SFX';
            } catch (e) {}
            const muteBtn = document.getElementById('musicMuteBtn');
            if (volSlider) {
                volSlider.value = Math.round(audio.volume * 100);
                volSlider.addEventListener('input', (e) => {
                    const v = Number(e.target.value) / 100;
                    audio.volume = v; musicVolume = v;
                    if (volLabel) volLabel.innerText = Math.round(v * 100) + '%';
                    saveGame();
                });
            }
            if (volLabel) volLabel.innerText = Math.round(audio.volume * 100) + '%';
            if (muteBtn) {
                muteBtn.innerText = audio.muted ? 'Unmute' : 'Mute';
                // delegate to toggleMusicMute so behavior is centralized (also updates slider)
                muteBtn.addEventListener('click', () => { try { toggleMusicMute(); } catch (e) {} });
            }
            // attempt to start music on first user interaction (autoplay policies)
            function tryStartMusic() { if (!audio.paused) return; audio.play().catch(() => {}); }
            document.addEventListener('click', tryStartMusic, { once: true });
        }
    } catch (e) { console.warn('Music init failed', e); }
    // wire main image click to play SFX (respects `sfxVolume` and `sfxMuted` via playSfx)
    try {
        const mainImg = document.querySelector('.main-image');
        if (mainImg && !mainImg.dataset.sfxWired) {
            mainImg.addEventListener('click', () => { try { playSfx('WHClick.wav'); } catch (e) {} });
            mainImg.dataset.sfxWired = '1';
        }
    } catch (e) {}

    // ensure main image shows a visible fallback if a skin PNG is missing (handles Silver/Gold placeholders)
    try {
        const mainImg = document.querySelector('.main-image');
        function skinFallbackFor(src) {
            try {
                const s = ('' + (src || '')).toLowerCase();
                if (s.indexOf('silverwh') !== -1) return "data:image/svg+xml;utf8,<svg xmlns='http://www.w3.org/2000/svg' width='512' height='512'><rect width='100%' height='100%' fill='%23C0C0C0'/><text x='50%' y='50%' font-size='40' dominant-baseline='middle' text-anchor='middle' fill='%23000'>Silver</text></svg>";
                if (s.indexOf('goldwh') !== -1) return "data:image/svg+xml;utf8,<svg xmlns='http://www.w3.org/2000/svg' width='512' height='512'><rect width='100%' height='100%' fill='%23FFD700'/><text x='50%' y='50%' font-size='40' dominant-baseline='middle' text-anchor='middle' fill='%23000'>Gold</text></svg>";
            } catch (e) {}
            return null;
        }
        if (mainImg) {
            mainImg.addEventListener('error', function () {
                try {
                    const fb = skinFallbackFor(this.src);
                    if (fb) this.src = fb;
                    else this.src = 'mainimage/whathappened.jpeg';
                } catch (e) { this.src = 'mainimage/whathappened.jpeg'; }
            });
        }
    } catch (e) {}
    // autosave every 5 seconds
    console.debug('setting autosave interval (saves every 30s)');
    setInterval(() => {
    saveGame();
    syncClanStats(); // Add this line
    console.log ('Game auto-saved');
}, 30000); // Syncs every 30 seconds
    // save on unload
    window.addEventListener('beforeunload', saveGame);
    // Bossfight event: flush pending damage to Firestore every 3s (runTransaction so we don't overwrite other clans/members)
    try {
        var runTransactionFn = typeof window !== 'undefined' && window.runTransaction;
        setInterval(async function () {
            try {
                var pending = (typeof window !== 'undefined' && window._bossfightPending) ? window._bossfightPending : 0;
                if (pending <= 0) return;
                var clanId = localStorage.getItem('player_clanId');
                var username = localStorage.getItem('player_username');
                if (!clanId || !username) return;
                var getDocFn = typeof window !== 'undefined' && window.getDoc;
                var docFn = typeof window !== 'undefined' && window.doc;
                var dbVal = typeof window !== 'undefined' && window.db;
                if (typeof getDocFn !== 'function' || !docFn || !dbVal || typeof runTransactionFn !== 'function') return;
                var stateSnap = await getDocFn(docFn(dbVal, 'events', 'state'));
                var state = stateSnap && stateSnap.exists() ? stateSnap.data() : {};
                var upcoming = state.upcoming || [];
                var now = Date.now();
                var current = upcoming.find(function (it) { return (it.start || 0) <= now && (it.end || 0) > now; });
                var nameLow = current ? String(current.name || '').toLowerCase() : '';
                var isBossfight = nameLow.indexOf('bossfight') !== -1 && nameLow.indexOf('endless') === -1;
                var isEndlessBoss = nameLow.indexOf('endless') !== -1 && nameLow.indexOf('boss') !== -1;
                if (!current || (!isBossfight && !isEndlessBoss)) return;
                window._bossfightPending = 0;
                var cpVal = 0, cpsVal = 0;
                try { cpVal = (typeof isDecimalInstance !== 'undefined' && isDecimalInstance(clickPower)) ? clickPower.toNumber() : Number(clickPower) || 0; } catch (e) {}
                try { cpsVal = (typeof isDecimalInstance !== 'undefined' && isDecimalInstance(cps)) ? cps.toNumber() : Number(cps) || 0; } catch (e) {}
                var perClick = 1 + Math.min(Math.max(0, cpVal), 100000);
                var damage = Math.floor(pending * perClick + cpsVal * 3);
                if (damage <= 0) return;
                var eventStartKey = String(Number(current.start || 0));
                var cid = String(clanId);
                var progressRef = docFn(dbVal, 'events', 'bossfight_progress');
                await runTransactionFn(dbVal, async function (tx) {
                    var bossSnap = await tx.get(progressRef);
                    var prog = bossSnap && bossSnap.exists() ? bossSnap.data() : {};
                    var eventsMap = prog.events && typeof prog.events === 'object' ? Object.assign({}, prog.events) : {};
                    if (!eventsMap[eventStartKey] || typeof eventsMap[eventStartKey] !== 'object') eventsMap[eventStartKey] = {};
                    var clanData = eventsMap[eventStartKey][cid];
                    if (typeof clanData !== 'object' || clanData === null) clanData = { total: 0, members: {} };
                    clanData = { total: (Number(clanData.total) || 0) + damage, members: Object.assign({}, clanData.members || {}) };
                    clanData.members[String(username)] = (Number(clanData.members[String(username)]) || 0) + damage;
                    eventsMap[eventStartKey] = Object.assign({}, eventsMap[eventStartKey] || {});
                    eventsMap[eventStartKey][cid] = clanData;
                    tx.set(progressRef, { events: eventsMap });
                });
                if (isEndlessBoss) {
                    var endlessRef = docFn(dbVal, 'events', 'endless_boss_progress');
                    await runTransactionFn(dbVal, async function (tx) {
                        var endlessSnap = await tx.get(endlessRef);
                        var endlessProg = endlessSnap && endlessSnap.exists() ? endlessSnap.data() : {};
                        var endlessMap = endlessProg.events && typeof endlessProg.events === 'object' ? Object.assign({}, endlessProg.events) : {};
                        if (!endlessMap[eventStartKey] || typeof endlessMap[eventStartKey] !== 'object') endlessMap[eventStartKey] = {};
                        var endlessClan = endlessMap[eventStartKey][cid];
                        if (typeof endlessClan !== 'object' || endlessClan === null) endlessClan = { total: 0, members: {} };
                        endlessClan = { total: (Number(endlessClan.total) || 0) + damage, members: Object.assign({}, endlessClan.members || {}) };
                        endlessClan.members[String(username)] = (Number(endlessClan.members[String(username)]) || 0) + damage;
                        endlessMap[eventStartKey] = Object.assign({}, endlessMap[eventStartKey] || {});
                        endlessMap[eventStartKey][cid] = endlessClan;
                        tx.set(endlessRef, { events: endlessMap });
                    });
                }
            } catch (e) {}
        }, 3000);
    } catch (e) {}
    // restore bulk select UI if present
    try {
        const sel = document.getElementById('bulkSelect');
        if (sel) sel.value = String(purchaseBatch || 1);
        // update button UI if present
        try{
            const btns = document.querySelectorAll('.bulk-btn');
            btns.forEach(b=>{ try{ b.classList.toggle('active', Number(b.dataset.value) === purchaseBatch); }catch(e){} });
        }catch(e){}
    } catch (e) {}
    // Playtime tracking: accumulate seconds played and check achievements
    try {
        const PLAY_KEY = 'whathappened_playtime_seconds';
        let lastPlayTick = Date.now();
        // ensure numeric storage exists
        try { if (!localStorage.getItem(PLAY_KEY)) localStorage.setItem(PLAY_KEY, String(0)); } catch (e) {}
        // initial check
        try { checkPlaytimeAchievements(); } catch (e) {}
        // update every 10 seconds
        setInterval(() => {
            try {
                const now = Date.now();
                const deltaSec = Math.floor((now - lastPlayTick) / 1000);
                if (deltaSec > 0) {
                    lastPlayTick = now;
                    const current = Number(localStorage.getItem(PLAY_KEY) || 0) || 0;
                    const next = current + deltaSec;
                    try { localStorage.setItem(PLAY_KEY, String(next)); } catch (e) {}
                    try { checkPlaytimeAchievements(); } catch (e) {}
                }
            } catch (e) {}
        }, 10000);
        // flush on unload
        window.addEventListener('beforeunload', () => {
            try {
                const now = Date.now();
                const deltaSec = Math.floor((now - lastPlayTick) / 1000);
                if (deltaSec > 0) {
                    const current = Number(localStorage.getItem(PLAY_KEY) || 0) || 0;
                    try { localStorage.setItem(PLAY_KEY, String(current + deltaSec)); } catch (e) {}
                }
            } catch (e) {}
        });
    } catch (e) {}

    // Ensure Divine Spirit button always has a working listener and expose a debug helper
    try {
        const sp = document.getElementById('divineSpiritBtn');
        if (sp) {
            sp.addEventListener('click', function (ev) { try { buyDivineSpirit(); } catch (e) {} });
        }
    } catch (e) {}
    // removed console-invokable debug helper
    
    } catch (e) {
        console.error('initApp failed', e);
    } finally {
        try {
            const loadingOverlay = document.getElementById('loadingOverlay');
            if (loadingOverlay) {
                loadingOverlay.style.display = 'none';
            }
        } catch (e) {}
        try {
            // enable CSS transitions after initial layout stabilizes to avoid initial jump
            setTimeout(() => { try { document.body.classList.add('transitions-enabled'); } catch (e) {} }, 120);
        } catch (e) {}
        // Update player profile in Firebase after game loads (so count and goldenWhat are loaded from save)
        try {
            if (typeof window.writeProfile === 'function') {
                setTimeout(() => { window.writeProfile().catch(() => {}); }, 500);
            }
        } catch (e) {}
        console.log('initApp: finished (overlay hidden)');
    }
}

// Leaderboard removed; initialize app
if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', initApp);
} else {
    initApp();
}

function toggleSpecialMenu() {
    const el = document.getElementById('specialMenu');
    if (!el) return;
    el.classList.toggle('open');
    el.setAttribute('aria-hidden', el.classList.contains('open') ? 'false' : 'true');
    const btn = document.getElementById('specialMenuBtn');
    if (btn) btn.title = el.classList.contains('open') ? 'Close Special Upgrades' : 'Open Special Upgrades';
    try { updateDisplays(); } catch (e) {}
}

function toggleSettingsMenu() {
    const el = document.getElementById('settingsMenu');
    if (!el) return;
    el.classList.toggle('open');
    const overlay = document.getElementById('settingsOverlay');
    if (overlay) overlay.classList.toggle('open');
    const btn = document.getElementById('settingsToggle');
    if (btn) btn.innerText = el.classList.contains('open') ? 'Settings ▴' : 'Settings ⚙';
    try {
        if (el.classList.contains('open')) document.body.classList.add('overlay-open-settings');
        else document.body.classList.remove('overlay-open-settings');
    } catch (e) {}
}

// toggle the Stats panel (modal in index.html)
function toggleStats() {
    try {
        const el = document.getElementById('statsPanel');
        if (!el) return;
        el.style.display = (el.style.display === 'none' || !el.style.display) ? 'block' : 'none';
    } catch (e) {}
}

function toggleMusicMute() {
    try {
        const audio = bgMusicElement || document.getElementById('bgMusic');
        if (!audio) return;
        // toggle mute
        audio.muted = !audio.muted;
        musicMuted = !!audio.muted;
        const btn = document.getElementById('musicMuteBtn');
        if (btn) btn.innerText = audio.muted ? 'Unmute' : 'Mute';
        // update slider/label to reflect mute state and preserve/restore volume
        try {
            const volSlider = document.getElementById('musicVolumeSlider');
            const volLabel = document.getElementById('musicVolumeLabel');
            if (audio.muted) {
                // save current volume to restore later
                if (musicVolumeBackup === null && typeof musicVolume === 'number') musicVolumeBackup = musicVolume;
                // set visible slider to 0 but keep musicVolume (backup holds previous)
                if (volSlider) volSlider.value = 0;
                if (volLabel) volLabel.innerText = '0%';
            } else {
                // restore previous volume if available
                if (musicVolumeBackup !== null) { musicVolume = musicVolumeBackup; musicVolumeBackup = null; }
                const v = Math.round((typeof musicVolume === 'number' ? musicVolume : audio.volume) * 100);
                if (volSlider) volSlider.value = v;
                if (volLabel) volLabel.innerText = v + '%';
                audio.volume = (typeof musicVolume === 'number') ? Math.max(0, Math.min(1, musicVolume)) : audio.volume;
            }
        } catch (e) {}
        saveGame();
        if (!audio.muted) audio.play().catch(() => {});
    } catch (e) { console.warn('toggleMusicMute error', e); }
}

function toggleSfxMute() {
    try {
        sfxMuted = !sfxMuted;
        const btn = document.getElementById('sfxMuteBtn');
        if (btn) btn.innerText = sfxMuted ? 'Unmute SFX' : 'Mute SFX';
        // update slider label to reflect mute state
        try {
            const volSlider = document.getElementById('sfxVolumeSlider');
            const volLabel = document.getElementById('sfxVolumeLabel');
            if (sfxMuted) {
                if (volSlider) volSlider.value = 0;
                if (volLabel) volLabel.innerText = '0%';
            } else {
                const v = Math.round((typeof sfxVolume === 'number' ? sfxVolume : 0.8) * 100);
                if (volSlider) volSlider.value = v;
                if (volLabel) volLabel.innerText = v + '%';
            }
        } catch (e) {}
        saveGame();
    } catch (e) { console.warn('toggleSfxMute error', e); }
}

// Shop menu toggle
function toggleShopMenu() {
    const menu = document.getElementById('shopMenu');
    const overlay = document.getElementById('shopOverlay');
    if (!menu || !overlay) return;
    const open = !menu.classList.contains('open');
    if (open) {
        menu.classList.add('open');
        overlay.classList.add('open');
        try { updateShopUI(); } catch (e) {}
        try { showShopTab('main'); } catch (e) {}
        try { document.body.classList.add('overlay-open-shop'); } catch (e) {}
    } else {
        menu.classList.remove('open');
        overlay.classList.remove('open');
        try { document.body.classList.remove('overlay-open-shop'); } catch (e) {}
    }
    // ensure gem count is updated when opening
    try { document.getElementById('gemCount').innerText = String(diamonds || 0); } catch (e) {}
}

// Show the requested shop tab: 'main' or 'bg'. Handles a short opacity transition.
function showShopTab(tab) {
    try {
        const main = document.getElementById('shopTabMain');
        const bg = document.getElementById('shopTabBG');
        const music = document.getElementById('shopTabMusic');
        const btnMain = document.getElementById('shopTabBtnMain');
        const btnBG = document.getElementById('shopTabBtnBG');
        const btnMusic = document.getElementById('shopTabBtnMusic');
        if (!main || !bg || !music || !btnMain || !btnBG || !btnMusic) return;
        // fast-path if already active
        if (tab === 'bg' && btnBG.classList.contains('active')) return;
        if (tab === 'main' && btnMain.classList.contains('active')) return;
        if (tab === 'music' && btnMusic.classList.contains('active')) return;

        const showEl = (tab === 'bg') ? bg : (tab === 'music' ? music : main);
        const hideEls = [main, bg, music].filter(e => e !== showEl);
        // prepare shown element
        showEl.style.display = 'block';
        showEl.style.opacity = '0';
        // start hide animation for the others
        hideEls.forEach(h => { try { h.style.opacity = '0'; } catch (e) {} });
        // toggle active button styles
        btnMain.classList.toggle('active', tab === 'main');
        btnBG.classList.toggle('active', tab === 'bg');
        btnMusic.classList.toggle('active', tab === 'music');
        // after a tick, fade in the shown element; after transition, hide the others
        requestAnimationFrame(() => { showEl.style.opacity = '1'; });
        setTimeout(() => { try { hideEls.forEach(h => h.style.display = 'none'); } catch (e) {} }, 240);
    } catch (e) { console.warn('showShopTab error', e); }
}

// Render/update shop UI controls inside the shop menu
function updateShopUI() {
    try {
        // render the main items into the main tab container
        const container = document.getElementById('shopTabMain');
        if (!container) return;
        // build shop markup: preview and Divine Spirit item
        container.innerHTML = `
            <div class="shop-items-row">
                <div class="shop-item">
                    <div class="shop-item-title">WH classic</div>
                    <img id="shopPreviewImage" src="mainimage/whathappened.jpeg" alt="Default" class="shop-item-img" />
                    <div class="shop-item-info"></div>
                    <div style="display:flex;gap:8px;align-items:center;margin-top:6px;">
                        <button id="equipDefaultBtn" style="padding:6px 8px;border-radius:6px;">Equip</button>
                        <div id="shopDefaultStatus" style="font-weight:700;color:#000;margin-left:6px;"></div>
                    </div>
                </div>
                <div class="shop-item" id="shopDivineItem">
                    <div class="shop-item-title">Divine Spirit</div>
                    <img id="shopDivineImg" src="mainimage/DivineSpirit.png" alt="Divine Spirit" class="shop-item-img" style="cursor:pointer;" />
                    <div class="shop-item-info">Cost: <strong>20</strong> gems</div>
                    <div style="display:flex;gap:8px;align-items:center;margin-top:6px;">
                        <button id="buyDivineBtn" style="padding:6px 8px;border-radius:6px;">Buy</button>
                        <button id="equipDivineBtn" style="padding:6px 8px;border-radius:6px;">Equip</button>
                        <div id="shopDivineStatus" style="font-weight:700;color:#000;margin-left:6px;"></div>
                    </div>
                </div>
                <div class="shop-item" id="shopCollectionItem">
                    <div class="shop-item-title">Collection Background</div>
                    <img id="shopCollectionImg" src="mainimage/collectionbg.png" alt="Collection BG" class="shop-item-img" style="cursor:pointer;" />
                    <div class="shop-item-info">Cost: <strong>20</strong> gems</div>
                    <div style="display:flex;gap:8px;align-items:center;margin-top:6px;">
                        <button id="buyCollectionBtn" style="padding:6px 8px;border-radius:6px;">Buy</button>
                        <button id="equipCollectionBtn" style="padding:6px 8px;border-radius:6px;">Equip</button>
                        <div id="shopCollectionStatus" style="font-weight:700;color:#000;margin-left:6px;"></div>
                    </div>
                </div>
                <div class="shop-item" id="shopWHBWItem">
                    <div class="shop-item-title">WH Black & White</div>
                    <img id="shopWHBWImg" src="mainimage/WHblackandwhite.png" alt="WH B&W" class="shop-item-img" style="cursor:pointer;" />
                    <div class="shop-item-info">Cost: <strong>5</strong> gems</div>
                    <div style="display:flex;gap:8px;align-items:center;margin-top:6px;">
                        <button id="buyWHBWBtn" style="padding:6px 8px;border-radius:6px;">Buy</button>
                        <button id="equipWHBWBtn" style="padding:6px 8px;border-radius:6px;">Equip</button>
                        <div id="shopWHBWStatus" style="font-weight:700;color:#000;margin-left:6px;"></div>
                    </div>
                </div>
                <div class="shop-item" id="shopWHVrillItem">
                    <div class="shop-item-title">WH Vrill</div>
                    <img id="shopWHVrillImg" src="mainimage/WHVrill.png" alt="WH Vrill" class="shop-item-img" style="cursor:pointer;" onerror="this.onerror=null;this.src='data:image/svg+xml;utf8,<svg xmlns=%22http://www.w3.org/2000/svg%22 width=%22256%22 height=%22256%22><rect width=%22100%25%22 height=%22100%25%22 fill=%22%2390C0FF%22/><text x=%2250%25%22 y=%2250%25%22 font-size=%2220%22 dominant-baseline=%22middle%22 text-anchor=%22middle%22 fill=%22%23000%22>WHVrill</text></svg>'" />
                    <div class="shop-item-info">Cost: <strong>50</strong> gems</div>
                    <div style="display:flex;gap:8px;align-items:center;margin-top:6px;">
                        <button id="buyWHVrillBtn" style="padding:6px 8px;border-radius:6px;">Buy</button>
                        <button id="equipWHVrillBtn" style="padding:6px 8px;border-radius:6px;">Equip</button>
                        <div id="shopWHVrillStatus" style="font-weight:700;color:#000;margin-left:6px;"></div>
                    </div>
                </div>
                <div class="shop-item" id="shopMobileManItem">
                    <div class="shop-item-title">Mobile Man Skin</div>
                    <img id="shopMobileManImg" src="mainimage/mobilemanskin.png" alt="Mobile Man Skin" class="shop-item-img" style="cursor:pointer;" onerror="this.onerror=null;this.src='data:image/svg+xml;utf8,<svg xmlns=%22http://www.w3.org/2000/svg%22 width=%22256%22 height=%22256%22><rect width=%22100%25%22 height=%22100%25%22 fill=%22%23f0f0f0%22/><text x=%2250%25%22 y=%2250%25%22 font-size=%2218%22 dominant-baseline=%22middle%22 text-anchor=%22middle%22 fill=%22%23000%22>Mobile Man</text></svg>'" />
                    <div class="shop-item-info">Cost: <strong>50</strong> gems</div>
                    <div style="display:flex;gap:8px;align-items:center;margin-top:6px;">
                        <button id="buyMobileManBtn" style="padding:6px 8px;border-radius:6px;">Buy</button>
                        <button id="equipMobileManBtn" style="padding:6px 8px;border-radius:6px;">Equip</button>
                        <div id="shopMobileManStatus" style="font-weight:700;color:#000;margin-left:6px;"></div>
                    </div>
                </div>
                <div class="shop-item" id="shopSilverItem">
                    <div class="shop-item-title">Silver WH</div>
                    <img id="shopSilverImg" src="mainimage/SilverWH.png" alt="Silver WH" class="shop-item-img" style="cursor:pointer;" onerror="this.onerror=null;this.src='data:image/svg+xml;utf8,<svg xmlns=%22http://www.w3.org/2000/svg%22 width=%22256%22 height=%22256%22><rect width=%22100%25%22 height=%22100%25%22 fill=%22%23C0C0C0%22/><text x=%2250%25%22 y=%2250%25%22 font-size=%2224%22 dominant-baseline=%22middle%22 text-anchor=%22middle%22 fill=%22%23000%22>Silver</text></svg>'" />
                    <div class="shop-item-info">Cost: <strong>100</strong> gems</div>
                    <div style="display:flex;gap:8px;align-items:center;margin-top:6px;">
                        <button id="buySilverBtn" style="padding:6px 8px;border-radius:6px;">Buy</button>
                        <button id="equipSilverBtn" style="padding:6px 8px;border-radius:6px;">Equip</button>
                        <div id="shopSilverStatus" style="font-weight:700;color:#000;margin-left:6px;"></div>
                    </div>
                </div>
                <div class="shop-item" id="shopPlatinumItem">
                    <div class="shop-item-title">Platinum WH</div>
                    <img id="shopPlatinumImg" src="mainimage/PlatinumWH.png" alt="Platinum WH" class="shop-item-img" style="cursor:pointer;" onerror="this.onerror=null;this.src='data:image/svg+xml;utf8,<svg xmlns=%22http://www.w3.org/2000/svg%22 width=%22256%22 height=%22256%22><rect width=%22100%25%22 height=%22100%25%22 fill=%22%23E5E4E2%22/><text x=%2250%25%22 y=%2250%25%22 font-size=%2224%22 dominant-baseline=%22middle%22 text-anchor=%22middle%22 fill=%22%23000%22>Platinum</text></svg>'" />
                    <div class="shop-item-info">Cost: <strong>100</strong> gems</div>
                    <div style="display:flex;gap:8px;align-items:center;margin-top:6px;">
                        <button id="buyPlatinumBtn" style="padding:6px 8px;border-radius:6px;">Buy</button>
                        <button id="equipPlatinumBtn" style="padding:6px 8px;border-radius:6px;">Equip</button>
                        <div id="shopPlatinumStatus" style="font-weight:700;color:#000;margin-left:6px;"></div>
                    </div>
                </div>
                <div class="shop-item" id="shopDivineWHItem">
                    <div class="shop-item-title">Divine WH</div>
                    <img id="shopDivineWHImg" src="mainimage/DivineWH.png" alt="Divine WH" class="shop-item-img" style="cursor:pointer;" onerror="this.onerror=null;this.src='data:image/svg+xml;utf8,<svg xmlns=%22http://www.w3.org/2000/svg%22 width=%22256%22 height=%22256%22><rect width=%22100%25%22 height=%22100%25%22 fill=%22%23FFD700%22/><text x=%2250%25%22 y=%2250%25%22 font-size=%2224%22 dominant-baseline=%22middle%22 text-anchor=%22middle%22 fill=%22%23000%22>Divine</text></svg>'" />
                    <div class="shop-item-info">Cost: <strong>500</strong> gems</div>
                    <div style="display:flex;gap:8px;align-items:center;margin-top:6px;">
                        <button id="buyDivineWHBtn" style="padding:6px 8px;border-radius:6px;">Buy</button>
                        <button id="equipDivineWHBtn" style="padding:6px 8px;border-radius:6px;">Equip</button>
                        <div id="shopDivineWHStatus" style="font-weight:700;color:#000;margin-left:6px;"></div>
                    </div>
                </div>
                <div class="shop-item" id="shopGoldItem">
                    <div class="shop-item-title">Gold WH</div>
                    <img id="shopGoldImg" src="mainimage/GoldWH.png" alt="Gold WH" class="shop-item-img" style="cursor:pointer;" onerror="this.onerror=null;this.src='data:image/svg+xml;utf8,<svg xmlns=%22http://www.w3.org/2000/svg%22 width=%22256%22 height=%22256%22><rect width=%22100%25%22 height=%22100%25%22 fill=%22%23FFD700%22/><text x=%2250%25%22 y=%2250%25%22 font-size=%2224%22 dominant-baseline=%22middle%22 text-anchor=%22middle%22 fill=%22%23000%22>Gold</text></svg>'" />
                    <div class="shop-item-info">Cost: <strong>500</strong> gems</div>
                    <div style="display:flex;gap:8px;align-items:center;margin-top:6px;">
                        <button id="buyGoldBtn" style="padding:6px 8px;border-radius:6px;">Buy</button>
                        <button id="equipGoldBtn" style="padding:6px 8px;border-radius:6px;">Equip</button>
                        <div id="shopGoldStatus" style="font-weight:700;color:#000;margin-left:6px;"></div>
                    </div>
                </div>
            </div>`;
        // attach handlers
        // Ensure WH Vrill buy button respects purchased state immediately after rendering
        try {
            const whvrillBuyInit = document.getElementById('buyWHVrillBtn');
            if (whvrillBuyInit) whvrillBuyInit.style.display = (shopWHVrillPurchased ? 'none' : 'inline-block');
        } catch (e) {}
        const buyBtn = document.getElementById('buyDivineBtn');
        const equipBtn = document.getElementById('equipDivineBtn');
        const divineImg = document.getElementById('shopDivineImg');
        const status = document.getElementById('shopDivineStatus');
        function refresh() {
            try { document.getElementById('gemCount').innerText = String(diamonds || 0); } catch (e) {}
            // default preview equip button
            const defStatus = document.getElementById('shopDefaultStatus');
            const defBtn = document.getElementById('equipDefaultBtn');
            if (equippedShopImage === 'mainimage/whathappened.jpeg' || !equippedShopImage) {
                if (defBtn) { defBtn.innerText = 'Equipped'; defBtn.disabled = true; }
                if (defStatus) defStatus.innerText = 'equipped';
            } else {
                if (defBtn) { defBtn.innerText = 'Equip'; defBtn.disabled = false; }
                if (defStatus) defStatus.innerText = '';
            }
            if (shopDivinePurchased) {
                if (buyBtn) { buyBtn.style.display = 'none'; }
                equipBtn.disabled = false; equipBtn.innerText = (equippedShopImage === 'mainimage/DivineSpirit.png') ? 'Equipped' : 'Equip';
                status.innerText = (equippedShopImage === 'mainimage/DivineSpirit.png') ? 'equipped' : '';
            } else {
                if (buyBtn) { buyBtn.style.display = 'inline-block'; buyBtn.innerText = 'Buy (20)'; buyBtn.disabled = (diamonds < 20); }
                equipBtn.disabled = true; equipBtn.innerText = 'Equip';
                status.innerText = '';
            }
        }
        buyBtn.onclick = () => { buyDivineShopItem(); refresh(); };
        // toggle equip / unequip: if already equipped, unequip back to default; otherwise equip
        equipBtn.onclick = () => {
            if (!shopDivinePurchased) { alert('You must buy this item first.'); return; }
            if (equippedShopImage === 'mainimage/DivineSpirit.png') {
                equipShopItem('mainimage/whathappened.jpeg');
            } else {
                equipShopItem('mainimage/DivineSpirit.png');
            }
            refresh();
        };
        // clicking the item image will equip if owned, or prompt to buy if not
        divineImg.onclick = () => {
            if (shopDivinePurchased) {
                // clicking image toggles equip state as well
                if (equippedShopImage === 'mainimage/DivineSpirit.png') equipShopItem('mainimage/whathappened.jpeg'); else equipShopItem('mainimage/DivineSpirit.png');
                refresh();
            } else {
                if (confirm('Buy Divine Spirit for 20 gems?')) { buyDivineShopItem(); refresh(); }
            }
        };
        // collection bg handlers
        const collectionBuyBtn = document.getElementById('buyCollectionBtn');
        const collectionEquipBtn = document.getElementById('equipCollectionBtn');
        const collectionImg = document.getElementById('shopCollectionImg');
        const collectionStatus = document.getElementById('shopCollectionStatus');
        function refreshCollection() {
            try { document.getElementById('gemCount').innerText = String(diamonds || 0); } catch (e) {}
            if (shopCollectionBgPurchased) {
                if (collectionBuyBtn) collectionBuyBtn.style.display = 'none';
                if (collectionEquipBtn) { collectionEquipBtn.disabled = false; collectionEquipBtn.innerText = (equippedShopImage === 'mainimage/collectionbg.png') ? 'Equipped' : 'Equip'; }
                if (collectionStatus) collectionStatus.innerText = (equippedShopImage === 'mainimage/collectionbg.png') ? 'equipped' : '';
            } else {
                if (collectionBuyBtn) { collectionBuyBtn.style.display = 'inline-block'; collectionBuyBtn.innerText = 'Buy (20)'; collectionBuyBtn.disabled = (diamonds < 20); }
                if (collectionEquipBtn) { collectionEquipBtn.disabled = true; collectionEquipBtn.innerText = 'Equip'; }
                if (collectionStatus) collectionStatus.innerText = '';
            }
        }
        if (collectionBuyBtn) collectionBuyBtn.onclick = () => { buyCollectionBg(); refresh(); refreshCollection(); };
        if (collectionEquipBtn) collectionEquipBtn.onclick = () => {
            if (!shopCollectionBgPurchased) { alert('You must buy this item first.'); return; }
            if (equippedShopImage === 'mainimage/collectionbg.png') equipShopItem('mainimage/whathappened.jpeg'); else equipShopItem('mainimage/collectionbg.png');
            refresh(); refreshCollection();
        };
        if (collectionImg) collectionImg.onclick = () => {
            if (shopCollectionBgPurchased) {
                if (equippedShopImage === 'mainimage/collectionbg.png') equipShopItem('mainimage/whathappened.jpeg'); else equipShopItem('mainimage/collectionbg.png');
                refresh(); refreshCollection();
            } else {
                if (confirm('Buy Collection Background for 20 gems?')) { buyCollectionBg(); refresh(); refreshCollection(); }
            }
        };
        // WH black & white skin handlers (5 gems)
        const whbwBuyBtn = document.getElementById('buyWHBWBtn');
        const whbwEquipBtn = document.getElementById('equipWHBWBtn');
        const whbwImg = document.getElementById('shopWHBWImg');
        const whbwStatus = document.getElementById('shopWHBWStatus');
        function refreshWHBW() {
            try { document.getElementById('gemCount').innerText = String(diamonds || 0); } catch (e) {}
            if (shopWHBWPurchased) {
                if (whbwBuyBtn) whbwBuyBtn.style.display = 'none';
                if (whbwEquipBtn) { whbwEquipBtn.disabled = false; whbwEquipBtn.innerText = (equippedShopImage === 'mainimage/WHblackandwhite.png') ? 'Equipped' : 'Equip'; }
                if (whbwStatus) whbwStatus.innerText = (equippedShopImage === 'mainimage/WHblackandwhite.png') ? 'equipped' : '';
            } else {
                if (whbwBuyBtn) { whbwBuyBtn.style.display = 'inline-block'; whbwBuyBtn.innerText = 'Buy (5)'; whbwBuyBtn.disabled = (diamonds < 5); }
                if (whbwEquipBtn) { whbwEquipBtn.disabled = true; whbwEquipBtn.innerText = 'Equip'; }
                if (whbwStatus) whbwStatus.innerText = '';
            }
        }
        if (whbwBuyBtn) whbwBuyBtn.onclick = () => { buyWHBW(); refresh(); refreshWHBW(); };
        if (whbwEquipBtn) whbwEquipBtn.onclick = () => {
            if (!shopWHBWPurchased) { alert('You must buy this item first.'); return; }
            if (equippedShopImage === 'mainimage/WHblackandwhite.png') equipShopItem('mainimage/whathappened.jpeg'); else equipShopItem('mainimage/WHblackandwhite.png');
            refresh(); refreshWHBW();
        };
        if (whbwImg) whbwImg.onclick = () => {
            if (shopWHBWPurchased) {
                if (equippedShopImage === 'mainimage/WHblackandwhite.png') equipShopItem('mainimage/whathappened.jpeg'); else equipShopItem('mainimage/WHblackandwhite.png');
                refresh(); refreshWHBW();
            } else {
                if (confirm('Buy WH Black & White for 5 gems?')) { buyWHBW(); refresh(); refreshWHBW(); }
            }
        };
        // WH Vrill handlers (50 gems)
        const whvrillBuyBtn = document.getElementById('buyWHVrillBtn');
        const whvrillEquipBtn = document.getElementById('equipWHVrillBtn');
        const whvrillImg = document.getElementById('shopWHVrillImg');
        const whvrillStatus = document.getElementById('shopWHVrillStatus');
        function refreshWHVrill() {
            try { document.getElementById('gemCount').innerText = String(diamonds || 0); } catch (e) {}
            if (shopWHVrillPurchased) {
                if (whvrillBuyBtn) whvrillBuyBtn.style.display = 'none';
                if (whvrillEquipBtn) { whvrillEquipBtn.disabled = false; whvrillEquipBtn.innerText = (equippedShopImage === 'mainimage/WHVrill.png') ? 'Equipped' : 'Equip'; }
                if (whvrillStatus) whvrillStatus.innerText = (equippedShopImage === 'mainimage/WHVrill.png') ? 'equipped' : '';
            } else {
                if (whvrillBuyBtn) { whvrillBuyBtn.style.display = 'inline-block'; whvrillBuyBtn.innerText = 'Buy (50)'; whvrillBuyBtn.disabled = (diamonds < 50); }
                if (whvrillEquipBtn) { whvrillEquipBtn.disabled = true; whvrillEquipBtn.innerText = 'Equip'; }
                if (whvrillStatus) whvrillStatus.innerText = '';
            }
        }
        if (whvrillBuyBtn) whvrillBuyBtn.onclick = () => { buyWHVrill(); refresh(); refreshWHVrill(); };
        if (whvrillEquipBtn) whvrillEquipBtn.onclick = () => { if (!shopWHVrillPurchased) { alert('You must buy this item first.'); return; } if (equippedShopImage === 'mainimage/WHVrill.png') equipShopItem('mainimage/whathappened.jpeg'); else equipShopItem('mainimage/WHVrill.png'); refresh(); refreshWHVrill(); };
        if (whvrillImg) whvrillImg.onclick = () => { if (shopWHVrillPurchased) { if (equippedShopImage === 'mainimage/WHVrill.png') equipShopItem('mainimage/whathappened.jpeg'); else equipShopItem('mainimage/WHVrill.png'); refresh(); refreshWHVrill(); } else { if (confirm('Buy WH Vrill for 50 gems?')) { buyWHVrill(); refresh(); refreshWHVrill(); } } };
        // Mobile Man skin handlers (50 gems)
        const mobileBuyBtn = document.getElementById('buyMobileManBtn');
        const mobileEquipBtn = document.getElementById('equipMobileManBtn');
        const mobileImg = document.getElementById('shopMobileManImg');
        const mobileStatus = document.getElementById('shopMobileManStatus');
        function refreshMobileMan() {
            try { document.getElementById('gemCount').innerText = String(diamonds || 0); } catch (e) {}
            if (shopMobileManPurchased) {
                if (mobileBuyBtn) mobileBuyBtn.style.display = 'none';
                if (mobileEquipBtn) { mobileEquipBtn.disabled = false; mobileEquipBtn.innerText = (equippedShopImage === 'mainimage/mobilemanskin.png') ? 'Equipped' : 'Equip'; }
                if (mobileStatus) mobileStatus.innerText = (equippedShopImage === 'mainimage/mobilemanskin.png') ? 'equipped' : '';
            } else {
                if (mobileBuyBtn) { mobileBuyBtn.style.display = 'inline-block'; mobileBuyBtn.innerText = 'Buy (50)'; mobileBuyBtn.disabled = (diamonds < 50); }
                if (mobileEquipBtn) { mobileEquipBtn.disabled = true; mobileEquipBtn.innerText = 'Equip'; }
                if (mobileStatus) mobileStatus.innerText = '';
            }
        }
        if (mobileBuyBtn) mobileBuyBtn.onclick = () => { buyMobileMan(); refresh(); refreshMobileMan(); };
        if (mobileEquipBtn) mobileEquipBtn.onclick = () => { if (!shopMobileManPurchased) { alert('You must buy this item first.'); return; } if (equippedShopImage === 'mainimage/mobilemanskin.png') equipShopItem('mainimage/whathappened.jpeg'); else equipShopItem('mainimage/mobilemanskin.png'); refresh(); refreshMobileMan(); };
        if (mobileImg) mobileImg.onclick = () => { if (shopMobileManPurchased) { if (equippedShopImage === 'mainimage/mobilemanskin.png') equipShopItem('mainimage/whathappened.jpeg'); else equipShopItem('mainimage/mobilemanskin.png'); refresh(); refreshMobileMan(); } else { if (confirm('Buy Mobile Man Skin for 50 gems?')) { buyMobileMan(); refresh(); refreshMobileMan(); } } };
        // Silver handlers
        const silverBuyBtn = document.getElementById('buySilverBtn');
        const silverEquipBtn = document.getElementById('equipSilverBtn');
        const silverImg = document.getElementById('shopSilverImg');
        const silverStatus = document.getElementById('shopSilverStatus');
        function refreshSilver() {
            try { document.getElementById('gemCount').innerText = String(diamonds || 0); } catch (e) {}
            if (shopSilverPurchased) {
                if (silverBuyBtn) silverBuyBtn.style.display = 'none';
                if (silverEquipBtn) { silverEquipBtn.disabled = false; silverEquipBtn.innerText = (equippedShopImage === 'mainimage/SilverWH.png') ? 'Equipped' : 'Equip'; }
                if (silverStatus) silverStatus.innerText = (equippedShopImage === 'mainimage/SilverWH.png') ? 'equipped' : '';
            } else {
                if (silverBuyBtn) { silverBuyBtn.style.display = 'inline-block'; silverBuyBtn.innerText = 'Buy (100)'; silverBuyBtn.disabled = (diamonds < 100); }
                if (silverEquipBtn) { silverEquipBtn.disabled = true; silverEquipBtn.innerText = 'Equip'; }
                if (silverStatus) silverStatus.innerText = '';
            }
        }
        if (silverBuyBtn) silverBuyBtn.onclick = () => { buySilver(); refresh(); refreshSilver(); };
        if (silverEquipBtn) silverEquipBtn.onclick = () => { if (!shopSilverPurchased) { alert('You must buy this item first.'); return; } if (equippedShopImage === 'mainimage/SilverWH.png') equipShopItem('mainimage/whathappened.jpeg'); else equipShopItem('mainimage/SilverWH.png'); refresh(); refreshSilver(); };
        if (silverImg) silverImg.onclick = () => { if (shopSilverPurchased) { if (equippedShopImage === 'mainimage/SilverWH.png') equipShopItem('mainimage/whathappened.jpeg'); else equipShopItem('mainimage/SilverWH.png'); refresh(); refreshSilver(); } else { if (confirm('Buy Silver WH for 100 gems?')) { buySilver(); refresh(); refreshSilver(); } } };
        // Gold handlers
        const goldBuyBtn = document.getElementById('buyGoldBtn');
        const goldEquipBtn = document.getElementById('equipGoldBtn');
        const goldImg = document.getElementById('shopGoldImg');
        const goldStatus = document.getElementById('shopGoldStatus');
        function refreshGold() {
            try { document.getElementById('gemCount').innerText = String(diamonds || 0); } catch (e) {}
            if (shopGoldPurchased) {
                if (goldBuyBtn) goldBuyBtn.style.display = 'none';
                if (goldEquipBtn) { goldEquipBtn.disabled = false; goldEquipBtn.innerText = (equippedShopImage === 'mainimage/GoldWH.png') ? 'Equipped' : 'Equip'; }
                if (goldStatus) goldStatus.innerText = (equippedShopImage === 'mainimage/GoldWH.png') ? 'equipped' : '';
            } else {
                if (goldBuyBtn) { goldBuyBtn.style.display = 'inline-block'; goldBuyBtn.innerText = 'Buy (500)'; goldBuyBtn.disabled = (diamonds < 500); }
                if (goldEquipBtn) { goldEquipBtn.disabled = true; goldEquipBtn.innerText = 'Equip'; }
                if (goldStatus) goldStatus.innerText = '';
            }
        }
        if (goldBuyBtn) goldBuyBtn.onclick = () => { buyGold(); refresh(); refreshGold(); };
        if (goldEquipBtn) goldEquipBtn.onclick = () => { if (!shopGoldPurchased) { alert('You must buy this item first.'); return; } if (equippedShopImage === 'mainimage/GoldWH.png') equipShopItem('mainimage/whathappened.jpeg'); else equipShopItem('mainimage/GoldWH.png'); refresh(); refreshGold(); };
        if (goldImg) goldImg.onclick = () => { if (shopGoldPurchased) { if (equippedShopImage === 'mainimage/GoldWH_fixed.png') equipShopItem('mainimage/whathappened.jpeg'); else equipShopItem('mainimage/GoldWH.png'); refresh(); refreshGold(); } else { if (confirm('Buy Gold WH for 500 gems?')) { buyGold(); refresh(); refreshGold(); } } };
        // Platinum handlers
        const platinumBuyBtn = document.getElementById('buyPlatinumBtn');
        const platinumEquipBtn = document.getElementById('equipPlatinumBtn');
        const platinumImg = document.getElementById('shopPlatinumImg');
        const platinumStatus = document.getElementById('shopPlatinumStatus');
        function refreshPlatinum() {
            try { document.getElementById('gemCount').innerText = String(diamonds || 0); } catch (e) {}
            if (shopPlatinumPurchased) {
                if (platinumBuyBtn) platinumBuyBtn.style.display = 'none';
                if (platinumEquipBtn) { platinumEquipBtn.disabled = false; platinumEquipBtn.innerText = (equippedShopImage === 'mainimage/PlatinumWH.png') ? 'Equipped' : 'Equip'; }
                if (platinumStatus) platinumStatus.innerText = (equippedShopImage === 'mainimage/PlatinumWH.png') ? 'equipped' : '';
            } else {
                if (platinumBuyBtn) { platinumBuyBtn.style.display = 'inline-block'; platinumBuyBtn.innerText = 'Buy (100)'; platinumBuyBtn.disabled = (diamonds < 100); }
                if (platinumEquipBtn) { platinumEquipBtn.disabled = true; platinumEquipBtn.innerText = 'Equip'; }
                if (platinumStatus) platinumStatus.innerText = '';
            }
        }
        if (platinumBuyBtn) platinumBuyBtn.onclick = () => { buyPlatinum(); refresh(); refreshPlatinum(); };
        if (platinumEquipBtn) platinumEquipBtn.onclick = () => { if (!shopPlatinumPurchased) { alert('You must buy this item first.'); return; } if (equippedShopImage === 'mainimage/PlatinumWH.png') equipShopItem('mainimage/whathappened.jpeg'); else equipShopItem('mainimage/PlatinumWH.png'); refresh(); refreshPlatinum(); };
        if (platinumImg) platinumImg.onclick = () => { if (shopPlatinumPurchased) { if (equippedShopImage === 'mainimage/PlatinumWH.png') equipShopItem('mainimage/whathappened.jpeg'); else equipShopItem('mainimage/PlatinumWH.png'); refresh(); refreshPlatinum(); } else { if (confirm('Buy Platinum WH for 100 gems?')) { buyPlatinum(); refresh(); refreshPlatinum(); } } };
        // Divine WH handlers
        const divineWHBuyBtn = document.getElementById('buyDivineWHBtn');
        const divineWHEquipBtn = document.getElementById('equipDivineWHBtn');
        const divineWHImg = document.getElementById('shopDivineWHImg');
        const divineWHStatus = document.getElementById('shopDivineWHStatus');
        function refreshDivineWH() {
            try { document.getElementById('gemCount').innerText = String(diamonds || 0); } catch (e) {}
            if (shopDivineWHPurchased) {
                if (divineWHBuyBtn) divineWHBuyBtn.style.display = 'none';
                if (divineWHEquipBtn) { divineWHEquipBtn.disabled = false; divineWHEquipBtn.innerText = (equippedShopImage === 'mainimage/DivineWH.png') ? 'Equipped' : 'Equip'; }
                if (divineWHStatus) divineWHStatus.innerText = (equippedShopImage === 'mainimage/DivineWH.png') ? 'equipped' : '';
            } else {
                if (divineWHBuyBtn) { divineWHBuyBtn.style.display = 'inline-block'; divineWHBuyBtn.innerText = 'Buy (500)'; divineWHBuyBtn.disabled = (diamonds < 500); }
                if (divineWHEquipBtn) { divineWHEquipBtn.disabled = true; divineWHEquipBtn.innerText = 'Equip'; }
                if (divineWHStatus) divineWHStatus.innerText = '';
            }
        }
        if (divineWHBuyBtn) divineWHBuyBtn.onclick = () => { buyDivineWH(); refresh(); refreshDivineWH(); };
        if (divineWHEquipBtn) divineWHEquipBtn.onclick = () => { if (!shopDivineWHPurchased) { alert('You must buy this item first.'); return; } if (equippedShopImage === 'mainimage/DivineWH.png') equipShopItem('mainimage/whathappened.jpeg'); else equipShopItem('mainimage/DivineWH.png'); refresh(); refreshDivineWH(); };
        if (divineWHImg) divineWHImg.onclick = () => { if (shopDivineWHPurchased) { if (equippedShopImage === 'mainimage/DivineWH.png') equipShopItem('mainimage/whathappened.jpeg'); else equipShopItem('mainimage/DivineWH.png'); refresh(); refreshDivineWH(); } else { if (confirm('Buy Divine WH for 500 gems?')) { buyDivineWH(); refresh(); refreshDivineWH(); } } };
        // clicking the preview defaults to unequip
        const previewImg = document.getElementById('shopPreviewImage');
        if (previewImg) previewImg.onclick = () => { equipShopItem('mainimage/whathappened.jpeg'); refresh(); };
        // equip-default button wiring
        const equipDefaultBtn = document.getElementById('equipDefaultBtn');
        if (equipDefaultBtn) equipDefaultBtn.onclick = () => { equipShopItem('mainimage/whathappened.jpeg'); refresh(); };
        refresh();
        try { refreshCollection(); } catch (e) {}
        try { refreshWHBW(); } catch (e) {}
        try { refreshSilver(); } catch (e) {}
        try { refreshPlatinum(); } catch (e) {}
        try { refreshDivineWH(); } catch (e) {}
        try { refreshGold(); } catch (e) {}
        try { refreshMobileMan(); } catch (e) {}
        // render background images into BG tab
        try {
            const bgContainer = document.getElementById('shopTabBG');
            if (bgContainer) {
                let html = '<div class="shop-items-row">';
                // default background preview
                html += `<div class="shop-item"><div class="shop-item-title">Default Background</div><img src="mainimage/Mainbg.png" class="shop-item-img" /><div class="shop-item-info">Cost: <strong>Free</strong></div><div style="display:flex;gap:8px;align-items:center;margin-top:6px;"><button id="equipDefaultBgBtn" style="padding:6px 8px;border-radius:6px;">Equip</button><div id="shopDefaultBgStatus" style="font-weight:700;color:#000;margin-left:6px;"></div></div></div>`;
                BG_IMAGES.forEach(fn => {
                    const id = fn.replace(/\W+/g, '_');
                    const cost = (fn === 'Vrillbg.png') ? 20 : 10;
                    const path = (fn === 'Vrillbg.png') ? ('mainimage/' + fn) : ('bgimages/' + fn);
                    // display friendly name: remove trailing 'bg.png' or just '.png'
                    let displayName = String(fn || '');
                    displayName = displayName.replace(/bg\.png$/i, '').replace(/\.png$/i, '');
                    // replace underscores with spaces and capitalise first letter
                    displayName = displayName.replace(/_/g, ' ');
                    displayName = displayName.charAt(0).toUpperCase() + displayName.slice(1);
                    html += `<div class="shop-item" id="shopBgItem_${id}">`;
                    html += `<div class="shop-item-title">${displayName}</div>`;
                    html += `<img id="shopBgImg_${id}" src="${path}" alt="${displayName}" class="shop-item-img" style="cursor:pointer;" />`;
                    html += `<div class="shop-item-info">Cost: <strong>${cost}</strong> gems</div>`;
                    html += `<div style="display:flex;gap:8px;align-items:center;margin-top:6px;">`;
                    html += `<button id="buyBg_${id}" style="padding:6px 8px;border-radius:6px;">Buy</button>`;
                    html += `<button id="equipBg_${id}" style="padding:6px 8px;border-radius:6px;">Equip</button>`;
                    html += `<div id="shopBgStatus_${id}" style="font-weight:700;color:#000;margin-left:6px;"></div>`;
                    html += `</div></div>`;
                });
                html += '</div>';
                bgContainer.innerHTML = html;
                // attach handlers for bg items
                try { document.getElementById('equipDefaultBgBtn').onclick = () => { equipBgImage('mainimage/Mainbg.png'); updateShopUI(); }; } catch (e) {}
                BG_IMAGES.forEach(fn => {
                    const id = fn.replace(/\W+/g, '_');
                    const cost = (fn === 'Vrillbg.png') ? 20 : 10;
                    const path = (fn === 'Vrillbg.png') ? ('mainimage/' + fn) : ('bgimages/' + fn);
                    const buyBtn = document.getElementById('buyBg_' + id);
                    const equipBtn = document.getElementById('equipBg_' + id);
                    const imgEl = document.getElementById('shopBgImg_' + id);
                    const statusEl = document.getElementById('shopBgStatus_' + id);
                    try {
                        if (buyBtn) buyBtn.onclick = () => { if (confirm('Buy ' + fn + ' for ' + cost + ' gems?')) { buyBgImage(path, cost); updateShopUI(); } };
                        if (equipBtn) equipBtn.onclick = () => { equipBgImage(path); updateShopUI(); };
                        if (imgEl) imgEl.onclick = () => { if (shopBgPurchased && shopBgPurchased[path]) { equipBgImage(path); updateShopUI(); } else { if (confirm('Buy ' + fn + ' for ' + cost + ' gems?')) { buyBgImage(path, cost); updateShopUI(); } } };
                        // update status and button states
                        const owned = !!(shopBgPurchased && shopBgPurchased[path]);
                        if (buyBtn) buyBtn.style.display = owned ? 'none' : 'inline-block';
                        if (buyBtn) buyBtn.disabled = (diamonds < cost);
                        if (equipBtn) { equipBtn.disabled = !owned; equipBtn.innerText = (equippedBgImage === path) ? 'Equipped' : 'Equip'; }
                        if (statusEl) statusEl.innerText = (equippedBgImage === path) ? 'equipped' : '';
                    } catch (e) {}
                });
            }
        } catch (e) { console.warn('render shop bg tab failed', e); }
        // render music shop into Music tab
        try {
            const musicContainer = document.getElementById('shopTabMusic');
            if (musicContainer) {
                let mhtml = '<div class="shop-items-row">';
                // defines the tracks available in the shop
                const tracks = [
                    {id: 'mainTheme', name: 'Default Theme', cost: 0, file: 'mainTheme.mp3'},
                    {id: 'BassInsanity', name: 'Bass Insanity', cost: 20, file: 'BassInsanity.mp3'},
                    {id: 'MaximumAgro', name: 'Maximum Agro', cost: 20, file: 'MaximumAgro.mp3'},
                    {id: 'MetalSlam', name: 'Metal Slam', cost: 20, file: 'MetalSlam.mp3'},
                    {id: 'UltraTwang', name: 'Ultra Twang', cost: 20, file: 'UltraTwang.mp3'},
                    {id: 'ThroatSing', name: 'Throat Sing', cost: 20, file: 'ThroatSing.mp3'},
                    {id: 'Hardstyle_whathappened', name: 'Hardstyle — What Happened', cost: 20, file: 'HardstyleWhat Happened.mp3'},
                    {id: 'EDMWhatHappened', name: 'EDM — What Happened', cost: 20, file: 'EDMWhatHappened.mp3'},
                    {id: 'SimpleAndEasy', name: 'Simple and Easy', cost: 50, file: 'Simple and Easy.mp3'}
                ];
                tracks.forEach(t => {
                    const owned = !!(musicOwned && musicOwned[t.id]);
                    mhtml += `<div class="shop-item" id="shopMusic_${t.id}">`;
                    mhtml += `<div class="shop-item-title">${t.name}</div>`;
                    // image removed for music shop (text + buttons only)
                    mhtml += `<div class="shop-item-info">Cost: <strong>${t.cost}</strong> gems</div>`;
                    mhtml += `<div style="display:flex;gap:8px;align-items:center;margin-top:6px;">`;
                    mhtml += `<button id="buyMusic_${t.id}" style="padding:6px 8px;border-radius:6px;">Buy</button>`;
                    mhtml += `<button id="previewMusic_${t.id}" style="padding:6px 8px;border-radius:6px;">Preview</button>`;
                    mhtml += `<button id="equipMusic_${t.id}" style="padding:6px 8px;border-radius:6px;">Equip</button>`;
                    mhtml += `<div id="shopMusicStatus_${t.id}" style="font-weight:700;color:#000;margin-left:6px;"></div>`;
                    mhtml += `</div></div>`;
                });
                mhtml += '</div>';
                musicContainer.innerHTML = mhtml;
                tracks.forEach(t => {
                    const buyBtn = document.getElementById('buyMusic_' + t.id);
                    const previewBtn = document.getElementById('previewMusic_' + t.id);
                    const equipBtn = document.getElementById('equipMusic_' + t.id);
                    const statusEl = document.getElementById('shopMusicStatus_' + t.id);
                    try {
                        const owned = !!(musicOwned && musicOwned[t.id]);
                        if (buyBtn) { buyBtn.style.display = owned ? 'none' : 'inline-block'; buyBtn.disabled = (diamonds < t.cost); buyBtn.onclick = () => { if (confirm('Buy ' + t.name + ' for ' + t.cost + ' gems?')) { diamonds = (typeof diamonds === 'number' ? diamonds : Number(diamonds) || 0) - t.cost; musicOwned[t.id] = true; saveGame(); updateDisplays(); updateShopUI(); try{ playSfx('audio/purchase.wav'); }catch(e){} } }; }
                        if (previewBtn) previewBtn.onclick = () => {
                            try {
                                // stop any existing preview and clear timers
                                try { if (previewAudio) { try { previewAudio.pause(); } catch (e) {} previewAudio = null; } if (previewTimeout) { clearTimeout(previewTimeout); previewTimeout = null; } } catch (e) {}

                                if (!bgMusicElement) bgMusicElement = document.getElementById('bgMusic');

                                // remember whether bg music was playing and its state
                                let wasBgPlaying = false;
                                let priorBgVolume = 0.5;
                                let priorBgTime = 0;
                                if (bgMusicElement && !bgMusicElement.paused) {
                                    wasBgPlaying = true;
                                    priorBgVolume = (typeof bgMusicElement.volume === 'number') ? bgMusicElement.volume : 0.5;
                                    priorBgTime = bgMusicElement.currentTime || 0;
                                    // fade out quickly then pause
                                    const fadeDur = 300;
                                    const start = Date.now();
                                    const fadeInt = setInterval(() => {
                                        try {
                                            const tnow = (Date.now() - start) / fadeDur;
                                            if (tnow >= 1) { bgMusicElement.volume = 0; clearInterval(fadeInt); try { bgMusicElement.pause(); } catch (e) {} }
                                            else { bgMusicElement.volume = priorBgVolume * (1 - tnow); }
                                        } catch (e) { clearInterval(fadeInt); }
                                    }, 50);
                                }

                                // start preview using separate audio so bg music isn't overwritten
                                previewAudio = new Audio('audio/' + t.file);
                                previewAudio.volume = (typeof musicVolume === 'number') ? Math.max(0, Math.min(1, musicVolume)) : 0.5;
                                previewAudio.muted = !!musicMuted;
                                previewAudio.play().catch(() => {});

                                // restore function: stop preview and fade bg back in if it was playing
                                const restoreBg = () => {
                                    try {
                                        if (previewAudio) { try { previewAudio.pause(); } catch (e) {} previewAudio = null; }
                                        if (previewTimeout) { clearTimeout(previewTimeout); previewTimeout = null; }
                                        if (wasBgPlaying) {
                                            try {
                                                if (!bgMusicElement) bgMusicElement = document.getElementById('bgMusic');
                                                if (bgMusicElement) {
                                                    const file = (currentMusicTrack === 'mainTheme') ? 'mainTheme.mp3' : (currentMusicTrack + '.mp3');
                                                    bgMusicElement.src = 'audio/' + file;
                                                    try { bgMusicElement.currentTime = priorBgTime || 0; } catch (e) {}
                                                    bgMusicElement.volume = 0;
                                                    bgMusicElement.play().catch(() => {});
                                                    // fade in
                                                    const fadeDur2 = 600;
                                                    const start2 = Date.now();
                                                    const fadeInt2 = setInterval(() => {
                                                        try {
                                                            const tnow2 = (Date.now() - start2) / fadeDur2;
                                                            if (tnow2 >= 1) { bgMusicElement.volume = priorBgVolume; clearInterval(fadeInt2); }
                                                            else { bgMusicElement.volume = priorBgVolume * tnow2; }
                                                        } catch (e) { clearInterval(fadeInt2); }
                                                    }, 50);
                                                }
                                            } catch (e) {}
                                        }
                                    } catch (e) {}
                                };

                                previewAudio.onended = restoreBg;
                                previewTimeout = setTimeout(() => { try { restoreBg(); } catch (e) {} }, 15000);
                            } catch (e) {}
                        };
                        if (equipBtn) { equipBtn.onclick = () => { if (!musicOwned[t.id]) { alert('You must buy this track first.'); return; } currentMusicTrack = t.id; try { if (!bgMusicElement) bgMusicElement = document.getElementById('bgMusic'); if (bgMusicElement) { bgMusicElement.src = 'audio/' + t.file; bgMusicElement.play().catch(()=>{}); } } catch(e){} saveGame(); updateShopUI(); updateDisplays(); }; equipBtn.innerText = (currentMusicTrack === t.id) ? 'Equipped' : 'Equip'; equipBtn.disabled = !musicOwned[t.id]; }
                        if (statusEl) statusEl.innerText = (currentMusicTrack === t.id) ? 'equipped' : '';
                    } catch (e) {}
                });
            }
        } catch (e) { console.warn('render shop music tab failed', e); }

        // mark equipped items with a visual outline
        try {
            function refreshShopEquippedOutlines() {
                try {
                    // main tab: match by image filename
                    const equippedSkin = (equippedShopImage || '').split('/').pop();
                    // First, reset all equip buttons to default state based on ownership
                    document.querySelectorAll('#shopTabMain .shop-item').forEach(div => {
                        try {
                            const buyBtn = div.querySelector('button[id^="buy"]');
                            const equipBtn = div.querySelector('button[id^="equip"]');
                            const owned = (!buyBtn) || (buyBtn && (buyBtn.style.display === 'none' || buyBtn.style.display === ''));
                            if (equipBtn) {
                                equipBtn.innerText = 'Equip';
                                equipBtn.disabled = !owned;
                            }
                            div.classList.remove('equipped');
                        } catch (e) {}
                    });
                    // Then mark only the actual equipped skin as equipped
                    document.querySelectorAll('#shopTabMain .shop-item').forEach(div => {
                        try {
                            const img = div.querySelector('img.shop-item-img');
                            if (!img) return;
                            const fname = (img.src || '').split('/').pop();
                            if (fname && equippedSkin && fname === equippedSkin) {
                                div.classList.add('equipped');
                                try {
                                    const equipBtn = div.querySelector('button[id^="equip"]');
                                    if (equipBtn) { equipBtn.innerText = 'Equipped'; equipBtn.disabled = true; }
                                } catch (e) {}
                            }
                        } catch (e) {}
                    });
                    // bg tab: ensure only the equipped background shows equipped state and update equip buttons
                    const equippedBG = (equippedBgImage || '').split('/').pop();
                    // reset all bg equip buttons first
                    document.querySelectorAll('#shopTabBG .shop-item').forEach(div => {
                        try {
                            const buyBtn = div.querySelector('button[id^="buyBg_"]');
                            const equipBtn = div.querySelector('button[id^="equipBg_"]');
                            const owned = (!buyBtn) || (buyBtn && (buyBtn.style.display === 'none' || buyBtn.style.display === ''));
                            if (equipBtn) {
                                equipBtn.innerText = 'Equip';
                                equipBtn.disabled = !owned;
                            }
                            div.classList.remove('equipped');
                        } catch (e) {}
                    });
                    // then mark the actual equipped background
                    document.querySelectorAll('#shopTabBG .shop-item').forEach(div => {
                        try {
                            const img = div.querySelector('img.shop-item-img');
                            if (!img) return;
                            const fname = (img.src || '').split('/').pop();
                            if (fname && equippedBG && fname === equippedBG) {
                                div.classList.add('equipped');
                                try {
                                    const equipBtn = div.querySelector('button[id^="equipBg_"]');
                                    if (equipBtn) { equipBtn.innerText = 'Equipped'; equipBtn.disabled = true; }
                                } catch (e) {}
                            }
                        } catch (e) {}
                    });
                    // music tab: id based matching
                    document.querySelectorAll('#shopTabMusic .shop-item').forEach(div => {
                        try {
                            const id = div.id || '';
                            const m = id.match(/^shopMusic_(.+)$/);
                            if (!m) return;
                            const tid = m[1];
                            div.classList.toggle('equipped', currentMusicTrack === tid);
                        } catch (e) {}
                    });
                } catch (e) {}
            }
            try { refreshShopEquippedOutlines(); } catch (e) {}
        } catch (e) {}
    } catch (e) { console.error('updateShopUI failed', e); }
}

// Duplicate shop-version of buyDivineSpirit removed to avoid overwriting
// the golden-purchase implementation. Use `buyDivineShopItem()` for
// buying the Divine Spirit with gems (diamonds).

function buySilver() {
    if (shopSilverPurchased) return;
    if ((diamonds || 0) < 100) { alert('Not enough gems. Need 100.'); return; }
    diamonds = (typeof diamonds === 'number' ? diamonds : Number(diamonds) || 0) - 100;
    shopSilverPurchased = true;
    saveGame();
    try { playSfx('audio/purchase.wav'); } catch (e) {}
    updateDisplays();
    updateShopUI();
}

function buyGold() {
    if (shopGoldPurchased) return;
    if ((diamonds || 0) < 500) { alert('Not enough gems. Need 500.'); return; }
    diamonds = (typeof diamonds === 'number' ? diamonds : Number(diamonds) || 0) - 500;
    shopGoldPurchased = true;
    saveGame();
    try { playSfx('audio/purchase.wav'); } catch (e) {}
    updateDisplays();
    updateShopUI();
}

function buyCollectionBg() {
    if (shopCollectionBgPurchased) return;
    if ((diamonds || 0) < 20) { alert('Not enough gems. Need 20.'); return; }
    diamonds = (typeof diamonds === 'number' ? diamonds : Number(diamonds) || 0) - 20;
    shopCollectionBgPurchased = true;
    saveGame();
    try { playSfx('audio/purchase.wav'); } catch (e) {}
    updateDisplays();
    updateShopUI();
}

function buyWHBW() {
    if (shopWHBWPurchased) return;
    if ((diamonds || 0) < 5) { alert('Not enough gems. Need 5.'); return; }
    diamonds = (typeof diamonds === 'number' ? diamonds : Number(diamonds) || 0) - 5;
    shopWHBWPurchased = true;
    saveGame();
    try { playSfx('audio/purchase.wav'); } catch (e) {}
    updateDisplays();
    updateShopUI();
}

function buyWHVrill() {
    if (shopWHVrillPurchased) return;
    if ((diamonds || 0) < 50) { alert('Not enough gems. Need 50.'); return; }
    diamonds = (typeof diamonds === 'number' ? diamonds : Number(diamonds) || 0) - 50;
    shopWHVrillPurchased = true;
    saveGame();
    try { playSfx('audio/purchase.wav'); } catch (e) {}
    updateDisplays();
    updateShopUI();
}

function buyMobileMan() {
    if (shopMobileManPurchased) return;
    if ((diamonds || 0) < 50) { alert('Not enough gems. Need 50.'); return; }
    diamonds = (typeof diamonds === 'number' ? diamonds : Number(diamonds) || 0) - 50;
    shopMobileManPurchased = true;
    saveGame();
    try { playSfx('audio/purchase.wav'); } catch (e) {}
    updateDisplays();
    updateShopUI();
}

function buyPlatinum() {
    if (shopPlatinumPurchased) return;
    if ((diamonds || 0) < 100) { alert('Not enough gems. Need 100.'); return; }
    diamonds = (typeof diamonds === 'number' ? diamonds : Number(diamonds) || 0) - 100;
    shopPlatinumPurchased = true;
    saveGame();
    try { playSfx('audio/purchase.wav'); } catch (e) {}
    updateDisplays();
    updateShopUI();
}

function buyDivineWH() {
    if (shopDivineWHPurchased) return;
    if ((diamonds || 0) < 500) { alert('Not enough gems. Need 500.'); return; }
    diamonds = (typeof diamonds === 'number' ? diamonds : Number(diamonds) || 0) - 500;
    shopDivineWHPurchased = true;
    saveGame();
    try { playSfx('audio/purchase.wav'); } catch (e) {}
    updateDisplays();
    updateShopUI();
}

function equipShopItem(filename) {
    if (!filename) return;
    // normalize to mainimage/ prefix if caller passed basename
    const normalized = (typeof filename === 'string' && filename.includes('/')) ? filename : ('mainimage/' + filename);
    const base = ('' + filename).split('/').pop().toLowerCase();
    if (base === 'divinespirit.png' && !shopDivinePurchased) { alert('You must buy this item first.'); return; }
    if (base === 'collectionbg.png' && !shopCollectionBgPurchased) { alert('You must buy this item first.'); return; }
    if (base === 'whblackandwhite.png' && !shopWHBWPurchased) { alert('You must buy this item first.'); return; }
    // accept both original and fixed filenames for silver/gold
    if ((base === 'silverwh.png' || base === 'SilverWH.png') && !shopSilverPurchased) { alert('You must buy this item first.'); return; }
    if ((base === 'goldwh.png' || base === 'GoldWH.png') && !shopGoldPurchased) { alert('You must buy this item first.'); return; }
    if ((base === 'platinumwh.png' || base === 'PlatinumWH.png') && !shopPlatinumPurchased) { alert('You must buy this item first.'); return; }
    if ((base === 'divinewh.png' || base === 'DivineWH.png') && !shopDivineWHPurchased) { alert('You must buy this item first.'); return; }
    if ((base === 'whvrill.png' || base === 'WHVrill.png') && !shopWHVrillPurchased) { alert('You must buy this item first.'); return; }
    if ((base === 'mobilemanskin.png' || base === 'MobileManSkin.png') && !shopMobileManPurchased) { alert('You must buy this item first.'); return; }
    equippedShopImage = normalized;
    // update main image element
    try {
        const img = document.querySelector('.main-image');
        if (img) img.src = normalized;
    } catch (e) {}
    saveGame();
    updateDisplays();
    try { updateShopUI(); } catch (e) {}
}

// Apply equipped background image to the page body
function applyEquippedBackground() {
    try {
        const bg = (typeof equippedBgImage === 'string' && equippedBgImage) ? equippedBgImage : 'mainimage/Mainbg.png';
        document.body.style.backgroundImage = "url('" + bg + "')";
    } catch (e) {}
}

function buyBgImage(filename, cost = 10) {
    if (!filename) return;
    if (shopBgPurchased && shopBgPurchased[filename]) return;
    if ((diamonds || 0) < cost) { alert('Not enough gems. Need ' + cost + '.'); return; }
    diamonds = (typeof diamonds === 'number' ? diamonds : Number(diamonds) || 0) - cost;
    shopBgPurchased = shopBgPurchased || {};
    shopBgPurchased[filename] = true;
    saveGame();
    try { playSfx('audio/purchase.wav'); } catch (e) {}
    updateDisplays();
    updateShopUI();
}

function equipBgImage(filename) {
    if (!filename) return;
    const base = ('' + filename).split('/').pop();
    if (base !== 'Mainbg.png' && !(shopBgPurchased && shopBgPurchased[filename])) { alert('You must buy this item first.'); return; }
    equippedBgImage = filename;
    applyEquippedBackground();
    saveGame();
    updateDisplays();
}

// Secret code redemption helpers
// Preload known codes here. Keys are upper-case.
const SECRET_CODES = {
//put the secret codes here
// DEV: special development-only code granting a huge amount for testing. Remove before production.
"D3V9F4A7C2B1D6E8B0C3A9F1E2D7C8B": { type: 'count', amount: '1e100', message: 'Dev grant: +1e100 What Happeneds (dev only)' },
// Dev diamond grant (testing): use the code below to receive 9,999,999 diamonds
"X9K4M2V7B1Q8R5T3L6Z0P2S9H4D1F": { type: 'diamonds', amount: 9999999, message: 'Dev grant: +9,999,999 diamonds (dev only)' },
// Promo code: redeemable by players to receive gems
"GEMS": { type: 'diamonds', amount: 100, message: 'You received 100 gems!' },

}; // add more codes as needed
const REDEEMED_KEY = 'whathappened_redeemed_codes';

function getRedeemedCodes() {
    try {
        const raw = localStorage.getItem(REDEEMED_KEY);
        if (!raw) return [];
        const arr = JSON.parse(raw);
        return Array.isArray(arr) ? arr : [];
    } catch (e) { return []; }
}

function saveRedeemedCodes(arr) {
    try { localStorage.setItem(REDEEMED_KEY, JSON.stringify(Array.from(new Set(arr)))); } catch (e) {}
}

function showSecretCodeStatus(msg, ok) {
    const el = document.getElementById('secretCodeStatus');
    if (!el) { try { alert(msg); } catch (e) {} return; }
    el.style.color = ok ? '#8f8' : '#f88';
    el.innerText = msg;
    if (!ok) {
        setTimeout(() => { if (el && el.innerText === msg) el.innerText = ''; }, 4000);
    }
}

function redeemSecretCode() {
    const inp = document.getElementById('secretCodeInput');
    if (!inp) return showSecretCodeStatus('Input not found', false);
    const raw = (inp.value || '').trim();
    if (!raw) return showSecretCodeStatus('Please enter a code.', false);
    const code = raw.toUpperCase();
    const redeemed = getRedeemedCodes();
    if (redeemed.includes(code)) return showSecretCodeStatus('Code already redeemed.', false);
    // check against known codes (none preloaded)
    const reward = SECRET_CODES[code];
    if (!reward) return showSecretCodeStatus('Invalid code.', false);
    try {
        // mark redeemed immediately to prevent reuse on errors
        redeemed.push(code);
        saveRedeemedCodes(redeemed);

        // apply reward depending on configured reward object
        if (reward.type === 'count') {
            // add amount to `count` (Decimal-aware)
            const amtRaw = reward.amount;
            try {
                if (hasDecimal) {
                    const add = D(amtRaw);
                    count = (isDecimalInstance(count) ? count : D(count)).plus(add);
                } else {
                    const add = Number(amtRaw);
                    count = (typeof count === 'number' ? count : Number(count) || 0) + (Number.isFinite(add) ? add : 0);
                }
            } catch (e) {
                // fallback: try numeric add
                try { count = (typeof count === 'number' ? count : Number(count) || 0) + Number(amtRaw); } catch (e2) {}
            }
            try { saveGame(); } catch (e) {}
            try { updateDisplays(); } catch (e) {}
            showSecretCodeStatus(reward.message || ('You received ' + amtRaw + ' What Happeneds!'), true);
            inp.value = '';
        } else if (reward.type === 'golden') {
            const amt = Number(reward.amount) || 0;
            try { goldenWhat = (Number(goldenWhat) || 0) + amt; } catch (e) { goldenWhat = amt; }
            try { totalGoldenEver = (Number(totalGoldenEver) || 0) + amt; } catch (e) { totalGoldenEver = amt; }
            if (goldenWhat >= 1) divineUnlocked = true;
            // persist and refresh UI
            try { saveGame(); } catch (e) {}
            try { updateDisplays(); } catch (e) {}
            showSecretCodeStatus(reward.message || ('You received ' + amt + ' golden!'), true);
            inp.value = '';
        } else if (reward.type === 'diamonds') {
            // add diamonds (integer)
            const amt = Number(reward.amount) || 0;
            try { diamonds = (Number(diamonds) || 0) + amt; } catch (e) { diamonds = amt; }
            try { saveGame(); } catch (e) {}
            try { updateDisplays(); } catch (e) {}
            showSecretCodeStatus(reward.message || ('You received ' + amt + ' diamonds!'), true);
            inp.value = '';
        } else {
            // unknown reward type — just acknowledge
            showSecretCodeStatus(reward.message || 'Code accepted — reward applied!', true);
            inp.value = '';
        }
    } catch (e) {
        console.error('Redeem failed', e);
        showSecretCodeStatus('Redemption failed', false);
    }
}

function toggleSection(which) {
    const idMap = {
        op: 'opSection',
        pirate: 'pirateSection',
        goon: 'goonSection',
        diddy: 'diddySection',
        argon: 'argonSection',
        grape: 'grapeSection',
        skippie: 'skippieSection',
        island: 'islandSection',
        tribal: 'tribalSection',
        phonk: 'phonkSection',
        jonathan: 'jonathanSection',
        cr: 'crSection',
        roping: 'ropingSection',
        skibbidi: 'skibbidiSection',
        beats: 'beatsSection',
        ez: 'ezSection',
        scp: 'scpSection',
        goatis: 'goatisSection',
        raw: 'rawSection',
        landon: 'landonSection', theBass: 'theBassSection', goodNoodles: 'goodNoodlesSection', mobileMan38: 'mobileMan38Section', easton: 'eastonSection'
    };
    const sec = document.getElementById(idMap[which]);
    console.log('toggleSection called', { which, id: idMap[which], secExists: !!sec });
    if (!sec) return;
    sec.classList.toggle('open');
    console.log('section new classList', sec.className);
    const toggleId = {
        op: 'opToggle', pirate: 'pirateToggle', goon: 'goonToggle', diddy: 'diddyToggle', argon: 'argonToggle', grape: 'grapeToggle', skippie: 'skippieToggle',
        island: 'islandToggle', tribal: 'tribalToggle', phonk: 'phonkToggle', jonathan: 'jonathanToggle', cr: 'crToggle', roping: 'ropingToggle',
        skibbidi: 'skibbidiToggle', beats: 'beatsToggle', ez: 'ezToggle', scp: 'scpToggle', goatis: 'goatisToggle', raw: 'rawToggle', landon: 'landonToggle', theBass: 'theBassToggle', goodNoodles: 'goodNoodlesToggle', mobileMan38: 'mobileMan38Toggle', easton: 'eastonToggle'
    }[which];
    const btn = document.getElementById(toggleId || null);
    if (btn) btn.innerText = sec.classList.contains('open') ? btn.innerText.replace('▾','▴') : btn.innerText.replace('▴','▾');
}

// Tribal special purchase handlers
function buyTribal1() {
    if (tribal1Purchased) return;
    if (upgrade9Level < 1) { alert('Unlocks at Tribal lvl 1.'); return; }
    if (count >= tribal1Cost) {
        count -= tribal1Cost;
        baseOtherCps += 200000;
        tribal1Purchased = true;
        updateDisplays();
    } else { alert('Not enough What Happeneds — need ' + formatNumber(tribal1Cost) + '.'); }
}

function buyTribal2() {
    if (tribal2Purchased) return;
    if (upgrade9Level < 5) { alert('Unlocks at Tribal lvl 5.'); return; }
    if (count >= tribal2Cost) {
        count -= tribal2Cost;
        if (hasDecimal) tribalOtherMultiplier = (isDecimalInstance(tribalOtherMultiplier) ? tribalOtherMultiplier : D(tribalOtherMultiplier)).times(D(tribal2Multiplier));
        else tribalOtherMultiplier *= tribal2Multiplier;
        tribal2Purchased = true;
        updateDisplays();
    } else { alert('Not enough What Happeneds — need ' + formatNumber(tribal2Cost) + '.'); }
}

function buyTribal3() {
    if (tribal3Purchased) return;
    if (upgrade9Level < 10) { alert('Unlocks at Tribal lvl 10.'); return; }
    if (count >= tribal3Cost) {
        count -= tribal3Cost;
        if (hasDecimal) clickMultiplier = (isDecimalInstance(clickMultiplier) ? clickMultiplier : D(clickMultiplier)).times(D(tribal3Multiplier));
        else clickMultiplier *= tribal3Multiplier;
        tribal3Purchased = true;
        updateDisplays();
    } else { alert('Not enough What Happeneds — need ' + formatNumber(tribal3Cost) + '.'); }
}

function buyTribal4() {
    if (tribal4Purchased) return;
    if (upgrade9Level < 20) { alert('Unlocks at Tribal lvl 20.'); return; }
    if (count >= tribal4Cost) {
        count -= tribal4Cost;
        if (hasDecimal) tribalMultiplier = (isDecimalInstance(tribalMultiplier) ? tribalMultiplier : D(tribalMultiplier)).times(D(tribal4Multiplier));
        else tribalMultiplier *= tribal4Multiplier;
        tribal4Purchased = true;
        updateDisplays();
    } else { alert('Not enough What Happeneds — need ' + formatNumber(tribal4Cost) + '.'); }
}

// ------------------ Save / Load / Reset ------------------
// New stable save key and versioning. Keep legacy key as fallback to avoid
// losing existing saves.
const SAVE_KEY = 'whathappened_save';
const SAVE_KEY_LEGACY = 'whathappened_save_v1';
const SAVE_VERSION = 3;

function saveGame() {
    if (suppressAutosave) return;
    try {
        const save = {
            count,
            baseClickPower,
            clickMultiplier,
            baseOtherCps,
            pirateCps,
            pirateMultiplier,
            goonMultiplier,
            goatisMultiplier,
            diddyMultiplier,
            argonMultiplier,
            grapeMultiplier,
            skippieMultiplier,
            diddyOtherMultiplier,
            argonOtherMultiplier,
            grapeOtherMultiplier,
            skippieOtherMultiplier,
            islandOtherMultiplier,
            // prestige stats
            prestigeTimes,
            totalGoldenEver,
            // upgrades
            upgrade1Cost, upgrade1Level,
            upgrade2Cost, upgrade2Level,
            upgrade3Cost, upgrade3Level,
            upgrade4Cost, upgrade4Level,
            upgrade5Cost, upgrade5Level,
            upgrade6Cost, upgrade6Level,
            upgrade7Cost, upgrade7Level,
            upgrade8Cost, upgrade8Level,
            upgrade9Cost, upgrade9Level,
            upgrade10Cost, upgrade10Level,
            upgrade11Cost, upgrade11Level,
            upgrade12Cost, upgrade12Level,
                upgrade13Cost, upgrade13Level,
                    upgrade15Cost, upgrade15Level,
                    upgrade14Cost, upgrade14Level,
                    upgrade16Cost, upgrade16Level,
                    upgrade17Cost, upgrade17Level,
                    upgrade18Cost, upgrade18Level,
                    upgrade19Cost, upgrade19Level,
                    upgrade20Cost, upgrade20Level,
                    upgrade21Cost, upgrade21Level,
                    upgrade22Cost, upgrade22Level,
                    upgrade23Cost, upgrade23Level,
                    upgrade24Cost, upgrade24Level,
                    // Good Noodles specials state
                    goodNoodles1Purchased, goodNoodles2Purchased, goodNoodles3Purchased,
                    goodNoodles4Purchased,
                    goodNoodlesMultiplier,
                    goodNoodles1Cost, goodNoodles2Cost, goodNoodles3Cost,
                    goodNoodles4Cost,
                    // Mobile Man 38 specials state
                    mobileMan381Purchased, mobileMan382Purchased, mobileMan383Purchased,
                    mobileMan384Purchased,
                    mobileMan38Multiplier,
                    mobileMan381Cost, mobileMan382Cost, mobileMan383Cost,
                    mobileMan384Cost,
                    // Easton Bundy specials state
                    eastonBundy1Purchased, eastonBundy2Purchased, eastonBundy3Purchased,
                    eastonBundy4Purchased,
                    eastonBundyMultiplier,
                    eastonBundy1Cost, eastonBundy2Cost, eastonBundy3Cost,
                    eastonBundy4Cost,
            // phonk state
            phonkBaseCps, phonkOtherMultiplier, phonkMultiplier,
            upgrade10Cost, upgrade10Level,
            // island specials purchased flags
            island1Purchased, island2Purchased, island3Purchased, island4Purchased,
            islandOtherMultiplier, islandMultiplier,
            // special purchased flags
            special1Purchased, special2Purchased, special3Purchased, special4Purchased, special5Purchased,
            special6Purchased, special7Purchased, special8Purchased,
            pirateSpec1Purchased, pirateSpec2Purchased, pirateSpec3Purchased, pirateSpec4Purchased,
            goonSpec1Purchased, goonSpec2Purchased, goonSpec3Purchased, goonSpec4Purchased,
            goatis1Purchased, goatis2Purchased, goatis3Purchased, goatis4Purchased,
            raw1Purchased, raw2Purchased, raw3Purchased, raw4Purchased,
            diddy1Purchased, diddy2Purchased, diddy3Purchased, diddy4Purchased,
            argon1Purchased, argon2Purchased, argon3Purchased, argon4Purchased,
            grape1Purchased, grape2Purchased, grape3Purchased, grape4Purchased,
            skippie1Purchased, skippie2Purchased, skippie3Purchased, skippie4Purchased
        ,
            tribal1Purchased, tribal2Purchased, tribal3Purchased, tribal4Purchased,
            phonk1Purchased, phonk2Purchased, phonk3Purchased, phonk4Purchased, phonk5Purchased,
            // ropingnecurse specials
            roping1Purchased, roping2Purchased, roping3Purchased, roping4Purchased,
            ropingOtherMultiplier,
            // scp specials
            scp1Purchased, scp2Purchased, scp3Purchased, scp4Purchased,
            scpMultiplier,
            // raw liver specials multiplier
            rawMultiplier,
            // The Bass specials
            theBass1Purchased, theBass2Purchased, theBass3Purchased, theBass4Purchased,
            theBassMultiplier,
            // Landon specials
            landon1Purchased, landon2Purchased, landon3Purchased, landon4Purchased,
            landonMultiplier,
            // skibbidi scimitar specials
            skibidi1Purchased, skibidi2Purchased, skibidi3Purchased, skibidi4Purchased,
            skibbidiOtherMultiplier,
            // beats specials
            beats1Purchased, beats2Purchased, beats3Purchased,
            beatsOtherMultiplier,
            // ez villager specials
            ez1Purchased, ez2Purchased, ez3Purchased, ez4Purchased,
            ezOtherMultiplier, ezMultiplier,
            ez1Cost, ez2Cost, ez3Cost, ez4Cost,
            // jonathan purchased flags and state
            jonathan1Purchased, jonathan2Purchased, jonathan3Purchased, jonathan4Purchased,
            jonathanBaseCps, jonathanOtherMultiplier,
            // CR lurker purchased flags and state
            cr1Purchased, cr2Purchased, cr3Purchased, cr4Purchased, cr5Purchased,
            crBaseCps, crOtherMultiplier,
            // prestige
            goldenWhat, goldenThreshold,
            // diamonds collectible currency
            diamonds,
            // clan currency (rewards from clan events, spent in clan shop)
            clanPoints,
            // music settings
            musicVolume,
            musicMuted,
            // music shop state
            musicOwned,
            currentMusicTrack,
            // sfx settings
            sfxVolume,
            sfxMuted,
            // shop state
            shopDivinePurchased,
            shopPlatinumPurchased,
            shopDivineWHPurchased,
            shopWHVrillPurchased,
            shopMobileManPurchased,
            shopSilverPurchased,
            shopGoldPurchased,
            shopCollectionBgPurchased,
            shopBgPurchased,
            shopWHBWPurchased,
            equippedShopImage,
            equippedBgImage,
            // divine Argonian
            divineArgonLevel, divineArgonCost, divineArgonPercent,
            // divine Somalian
            divineSomalianLevel, divineSomalianCost,
            // divine Simple Villager
            divineSimpleVillagerLevel, divineSimpleVillagerCost,
            // divine Spirit
            divineSpiritLevel, divineSpiritCost,
            // divine Collector
            divineCollectorLevel, divineCollectorCost,
            // divine Assassin
            divineAssassinLevel, divineAssassinCost,
            // divine Money Man
            divineMoneyManLevel, divineMoneyManCost,
            // permanent divine unlock
            divineUnlocked,
            lastSaved: Date.now(),
                // save format version
                version: SAVE_VERSION,
            tribalOtherMultiplier, tribalMultiplier,
        };
        // serialize Decimal instances to strings so JSON round-trips
        if (hasDecimal) {
            for (const k in save) {
                try {
                    const v = save[k];
                    if (isDecimalInstance(v)) save[k] = v.toString();
                } catch (e) {}
            }
        }
        // write to the new key; also write to legacy key for backwards compatibility
        const payload = JSON.stringify(save);
        localStorage.setItem(SAVE_KEY, payload);
        try { localStorage.setItem(SAVE_KEY_LEGACY, payload); } catch (e) {}
        // also persist legacy-friendly stat keys
        try { localStorage.setItem('whathappened_prestige_times', String(prestigeTimes || 0)); } catch (e) {}
        try { localStorage.setItem('whathappened_total_golden', String(totalGoldenEver || 0)); } catch (e) {}
    } catch (e) {
        console.error('Save failed', e);
    }
}

function loadGame() {
    try {
        // prefer the new key, but fall back to the legacy key if present
        let raw = localStorage.getItem(SAVE_KEY);
        if (!raw) raw = localStorage.getItem(SAVE_KEY_LEGACY);
        if (!raw) return;
        const s = JSON.parse(raw);
        // ensure save version is present
        if (typeof s.version === 'undefined') s.version = 1;
        if (s.version < SAVE_VERSION) {
            try {
                console.info('Migrating save from version', s.version, 'to', SAVE_VERSION);
                // migration steps for introduced fields in version 2
                if (s.version < 2) {
                    // SCP upgrade and specials introduced in v2 — provide safe defaults
                    if (typeof s.upgrade17Level === 'undefined') s.upgrade17Level = 0;
                    if (typeof s.upgrade17Cost === 'undefined') s.upgrade17Cost = 700000000000;
                    if (typeof s.scp1Purchased === 'undefined') s.scp1Purchased = false;
                    if (typeof s.scp2Purchased === 'undefined') s.scp2Purchased = false;
                    if (typeof s.scp3Purchased === 'undefined') s.scp3Purchased = false;
                    if (typeof s.scp4Purchased === 'undefined') s.scp4Purchased = false;
                    if (typeof s.scpMultiplier === 'undefined') s.scpMultiplier = 1;
                }
                // bump to latest version after migration
                s.version = SAVE_VERSION;
            } catch (e) { console.warn('Save migration failed', e); s.version = SAVE_VERSION; }
        }

        // Helper: normalize numeric values (Decimal-aware). Use current value as fallback
        function normalizeNumericValue(val, fallback) {
            if (typeof fallback === 'undefined') fallback = 0;
            if (hasDecimal) {
                try {
                    const candidate = isDecimalInstance(val) ? val : D(val);
                    if (candidate && typeof candidate.isFinite === 'function') {
                        return candidate.isFinite() ? candidate : (isDecimalInstance(fallback) ? fallback : D(fallback));
                    }
                    return candidate;
                } catch (e) {
                    return (isDecimalInstance(fallback) ? fallback : D(fallback));
                }
            } else {
                const n = Number(val);
                return Number.isFinite(n) ? n : (Number.isFinite(Number(fallback)) ? Number(fallback) : 0);
            }
        }
        // assign values if present (support Decimal-string roundtrip)
        if (typeof s.count === 'string') count = hasDecimal ? D(s.count) : Number(s.count);
        else if (typeof s.count === 'number') count = hasDecimal ? D(s.count) : s.count;
        if (typeof s.baseClickPower === 'string') baseClickPower = hasDecimal ? D(s.baseClickPower) : Number(s.baseClickPower);
        else if (typeof s.baseClickPower === 'number') baseClickPower = hasDecimal ? D(s.baseClickPower) : s.baseClickPower;
        if (typeof s.clickMultiplier === 'string') clickMultiplier = hasDecimal ? D(s.clickMultiplier) : Number(s.clickMultiplier);
        else if (typeof s.clickMultiplier === 'number') clickMultiplier = hasDecimal ? D(s.clickMultiplier) : s.clickMultiplier;
        if (typeof s.baseOtherCps === 'string') baseOtherCps = hasDecimal ? D(s.baseOtherCps) : Number(s.baseOtherCps);
        else if (typeof s.baseOtherCps === 'number') baseOtherCps = hasDecimal ? D(s.baseOtherCps) : s.baseOtherCps;
        if (typeof s.pirateCps === 'string') pirateCps = hasDecimal ? D(s.pirateCps) : Number(s.pirateCps);
        else if (typeof s.pirateCps === 'number') pirateCps = hasDecimal ? D(s.pirateCps) : s.pirateCps;
        if (typeof s.pirateMultiplier === 'string') pirateMultiplier = hasDecimal ? D(s.pirateMultiplier) : Number(s.pirateMultiplier);
        else if (typeof s.pirateMultiplier === 'number') pirateMultiplier = hasDecimal ? D(s.pirateMultiplier) : s.pirateMultiplier;
        if (typeof s.goonMultiplier === 'number') goonMultiplier = s.goonMultiplier;
        if (typeof s.diddyMultiplier === 'number') diddyMultiplier = s.diddyMultiplier;
        if (typeof s.argonMultiplier === 'number') argonMultiplier = s.argonMultiplier;
        if (typeof s.grapeMultiplier === 'number') grapeMultiplier = s.grapeMultiplier;
        if (typeof s.skippieMultiplier === 'number') skippieMultiplier = s.skippieMultiplier;
        if (typeof s.diddyOtherMultiplier === 'number') diddyOtherMultiplier = s.diddyOtherMultiplier;
        if (typeof s.argonOtherMultiplier === 'number') argonOtherMultiplier = s.argonOtherMultiplier;
        if (typeof s.grapeOtherMultiplier === 'number') grapeOtherMultiplier = s.grapeOtherMultiplier;
        if (typeof s.skippieOtherMultiplier === 'number') skippieOtherMultiplier = s.skippieOtherMultiplier;
        if (typeof s.islandOtherMultiplier === 'number') islandOtherMultiplier = s.islandOtherMultiplier;
        if (typeof s.islandMultiplier === 'number') islandMultiplier = s.islandMultiplier;
        if (typeof s.tribalOtherMultiplier === 'number') tribalOtherMultiplier = s.tribalOtherMultiplier;
        if (typeof s.tribalMultiplier === 'number') tribalMultiplier = s.tribalMultiplier;
        // upgrades
        upgrade1Cost = s.upgrade1Cost ?? upgrade1Cost; upgrade1Level = s.upgrade1Level ?? upgrade1Level;
        upgrade2Cost = s.upgrade2Cost ?? upgrade2Cost; upgrade2Level = s.upgrade2Level ?? upgrade2Level;
        upgrade3Cost = s.upgrade3Cost ?? upgrade3Cost; upgrade3Level = s.upgrade3Level ?? upgrade3Level;
        upgrade4Cost = s.upgrade4Cost ?? upgrade4Cost; upgrade4Level = s.upgrade4Level ?? upgrade4Level;
        upgrade5Cost = s.upgrade5Cost ?? upgrade5Cost; upgrade5Level = s.upgrade5Level ?? upgrade5Level;
        upgrade6Cost = s.upgrade6Cost ?? upgrade6Cost; upgrade6Level = s.upgrade6Level ?? upgrade6Level;
        upgrade7Cost = s.upgrade7Cost ?? upgrade7Cost; upgrade7Level = s.upgrade7Level ?? upgrade7Level;
        upgrade8Cost = s.upgrade8Cost ?? upgrade8Cost; upgrade8Level = s.upgrade8Level ?? upgrade8Level;
        upgrade9Cost = s.upgrade9Cost ?? upgrade9Cost; upgrade9Level = s.upgrade9Level ?? upgrade9Level;
        upgrade10Cost = s.upgrade10Cost ?? upgrade10Cost; upgrade10Level = s.upgrade10Level ?? upgrade10Level;
        upgrade11Cost = s.upgrade11Cost ?? upgrade11Cost; upgrade11Level = s.upgrade11Level ?? upgrade11Level;
        upgrade12Cost = s.upgrade12Cost ?? upgrade12Cost; upgrade12Level = s.upgrade12Level ?? upgrade12Level;
        upgrade13Cost = s.upgrade13Cost ?? upgrade13Cost; upgrade13Level = s.upgrade13Level ?? upgrade13Level;
        upgrade14Cost = s.upgrade14Cost ?? upgrade14Cost; upgrade14Level = s.upgrade14Level ?? upgrade14Level;
        upgrade15Cost = s.upgrade15Cost ?? upgrade15Cost; upgrade15Level = s.upgrade15Level ?? upgrade15Level;
        upgrade16Cost = s.upgrade16Cost ?? upgrade16Cost; upgrade16Level = s.upgrade16Level ?? upgrade16Level;
        upgrade17Cost = s.upgrade17Cost ?? upgrade17Cost; upgrade17Level = s.upgrade17Level ?? upgrade17Level;
        upgrade18Cost = s.upgrade18Cost ?? upgrade18Cost; upgrade18Level = s.upgrade18Level ?? upgrade18Level;
        upgrade19Cost = s.upgrade19Cost ?? upgrade19Cost; upgrade19Level = s.upgrade19Level ?? upgrade19Level;
        upgrade20Cost = s.upgrade20Cost ?? upgrade20Cost; upgrade20Level = s.upgrade20Level ?? upgrade20Level;
        upgrade21Cost = s.upgrade21Cost ?? upgrade21Cost; upgrade21Level = s.upgrade21Level ?? upgrade21Level;
        upgrade22Cost = s.upgrade22Cost ?? upgrade22Cost; upgrade22Level = s.upgrade22Level ?? upgrade22Level;
        upgrade23Cost = s.upgrade23Cost ?? upgrade23Cost; upgrade23Level = s.upgrade23Level ?? upgrade23Level;
        upgrade24Cost = s.upgrade24Cost ?? upgrade24Cost; upgrade24Level = s.upgrade24Level ?? upgrade24Level;
        upgrade10Cost = s.upgrade10Cost ?? upgrade10Cost; upgrade10Level = s.upgrade10Level ?? upgrade10Level;
        // handle upgrade cost strings when saved from Decimal mode
        if (hasDecimal) {
            if (typeof s.upgrade1Cost === 'string') upgrade1Cost = D(s.upgrade1Cost);
            if (typeof s.upgrade2Cost === 'string') upgrade2Cost = D(s.upgrade2Cost);
            if (typeof s.upgrade3Cost === 'string') upgrade3Cost = D(s.upgrade3Cost);
            if (typeof s.upgrade4Cost === 'string') upgrade4Cost = D(s.upgrade4Cost);
            if (typeof s.upgrade5Cost === 'string') upgrade5Cost = D(s.upgrade5Cost);
            if (typeof s.upgrade6Cost === 'string') upgrade6Cost = D(s.upgrade6Cost);
            if (typeof s.upgrade7Cost === 'string') upgrade7Cost = D(s.upgrade7Cost);
            if (typeof s.upgrade8Cost === 'string') upgrade8Cost = D(s.upgrade8Cost);
            if (typeof s.upgrade9Cost === 'string') upgrade9Cost = D(s.upgrade9Cost);
            if (typeof s.upgrade10Cost === 'string') upgrade10Cost = D(s.upgrade10Cost);
            if (typeof s.upgrade11Cost === 'string') upgrade11Cost = D(s.upgrade11Cost);
            if (typeof s.upgrade12Cost === 'string') upgrade12Cost = D(s.upgrade12Cost);
            if (typeof s.upgrade13Cost === 'string') upgrade13Cost = D(s.upgrade13Cost);
            if (typeof s.upgrade14Cost === 'string') upgrade14Cost = D(s.upgrade14Cost);
            if (typeof s.upgrade15Cost === 'string') upgrade15Cost = D(s.upgrade15Cost);
            if (typeof s.upgrade16Cost === 'string') upgrade16Cost = D(s.upgrade16Cost);
            if (typeof s.upgrade17Cost === 'string') upgrade17Cost = D(s.upgrade17Cost);
            if (typeof s.upgrade18Cost === 'string') upgrade18Cost = D(s.upgrade18Cost);
            if (typeof s.upgrade19Cost === 'string') upgrade19Cost = D(s.upgrade19Cost);
            if (typeof s.upgrade20Cost === 'string') upgrade20Cost = D(s.upgrade20Cost);
            if (typeof s.upgrade21Cost === 'string') upgrade21Cost = D(s.upgrade21Cost);
            if (typeof s.upgrade22Cost === 'string') upgrade22Cost = D(s.upgrade22Cost);
            if (typeof s.upgrade23Cost === 'string') upgrade23Cost = D(s.upgrade23Cost);
            if (typeof s.upgrade24Cost === 'string') upgrade24Cost = D(s.upgrade24Cost);
            if (typeof s.scpMultiplier === 'string') scpMultiplier = D(s.scpMultiplier);
            if (typeof s.goodNoodlesMultiplier === 'string') goodNoodlesMultiplier = D(s.goodNoodlesMultiplier);
            if (typeof s.goodNoodles1Cost === 'string') goodNoodles1Cost = D(s.goodNoodles1Cost);
            if (typeof s.goodNoodles2Cost === 'string') goodNoodles2Cost = D(s.goodNoodles2Cost);
            if (typeof s.goodNoodles3Cost === 'string') goodNoodles3Cost = D(s.goodNoodles3Cost);
            if (typeof s.mobileMan38Multiplier === 'string') mobileMan38Multiplier = D(s.mobileMan38Multiplier);
            if (typeof s.mobileMan381Cost === 'string') mobileMan381Cost = D(s.mobileMan381Cost);
            if (typeof s.mobileMan382Cost === 'string') mobileMan382Cost = D(s.mobileMan382Cost);
            if (typeof s.mobileMan383Cost === 'string') mobileMan383Cost = D(s.mobileMan383Cost);
            if (typeof s.goatisMultiplier === 'string') goatisMultiplier = D(s.goatisMultiplier);
            if (typeof s.rawMultiplier === 'string') rawMultiplier = D(s.rawMultiplier);
            if (typeof s.upgrade17Cost === 'string') upgrade17Cost = D(s.upgrade17Cost);
            if (typeof s.divineSimpleVillagerCost === 'string') divineSimpleVillagerCost = D(s.divineSimpleVillagerCost);
            if (typeof s.ez1Cost === 'string') ez1Cost = D(s.ez1Cost);
            if (typeof s.ez2Cost === 'string') ez2Cost = D(s.ez2Cost);
            if (typeof s.ez3Cost === 'string') ez3Cost = D(s.ez3Cost);
            if (typeof s.ez4Cost === 'string') ez4Cost = D(s.ez4Cost);
            if (typeof s.ezOtherMultiplier === 'string') ezOtherMultiplier = D(s.ezOtherMultiplier);
            if (typeof s.ezMultiplier === 'string') ezMultiplier = D(s.ezMultiplier);
        } else {
            if (typeof s.upgrade1Cost === 'string') upgrade1Cost = Number(s.upgrade1Cost);
            if (typeof s.upgrade2Cost === 'string') upgrade2Cost = Number(s.upgrade2Cost);
            if (typeof s.upgrade3Cost === 'string') upgrade3Cost = Number(s.upgrade3Cost);
            if (typeof s.upgrade4Cost === 'string') upgrade4Cost = Number(s.upgrade4Cost);
            if (typeof s.upgrade5Cost === 'string') upgrade5Cost = Number(s.upgrade5Cost);
            if (typeof s.upgrade6Cost === 'string') upgrade6Cost = Number(s.upgrade6Cost);
            if (typeof s.upgrade7Cost === 'string') upgrade7Cost = Number(s.upgrade7Cost);
            if (typeof s.upgrade8Cost === 'string') upgrade8Cost = Number(s.upgrade8Cost);
            if (typeof s.upgrade9Cost === 'string') upgrade9Cost = Number(s.upgrade9Cost);
            if (typeof s.upgrade10Cost === 'string') upgrade10Cost = Number(s.upgrade10Cost);
            if (typeof s.upgrade11Cost === 'string') upgrade11Cost = Number(s.upgrade11Cost);
            if (typeof s.upgrade12Cost === 'string') upgrade12Cost = Number(s.upgrade12Cost);
            if (typeof s.upgrade13Cost === 'string') upgrade13Cost = Number(s.upgrade13Cost);
            if (typeof s.upgrade14Cost === 'string') upgrade14Cost = Number(s.upgrade14Cost);
            if (typeof s.upgrade15Cost === 'string') upgrade15Cost = Number(s.upgrade15Cost);
            if (typeof s.divineSimpleVillagerCost === 'string') divineSimpleVillagerCost = Number(s.divineSimpleVillagerCost);
            if (typeof s.goatisMultiplier === 'string') goatisMultiplier = Number(s.goatisMultiplier);
            if (typeof s.landonMultiplier === 'string') landonMultiplier = hasDecimal ? D(s.landonMultiplier) : Number(s.landonMultiplier);
            if (typeof s.upgrade16Cost === 'string') upgrade16Cost = Number(s.upgrade16Cost);
            if (typeof s.upgrade17Cost === 'string') upgrade17Cost = Number(s.upgrade17Cost);
            if (typeof s.upgrade18Cost === 'string') upgrade18Cost = Number(s.upgrade18Cost);
            if (typeof s.upgrade19Cost === 'string') upgrade19Cost = Number(s.upgrade19Cost);
            if (typeof s.upgrade20Cost === 'string') upgrade20Cost = Number(s.upgrade20Cost);
            if (typeof s.scpMultiplier === 'string') scpMultiplier = Number(s.scpMultiplier);
            if (typeof s.rawMultiplier === 'string') rawMultiplier = Number(s.rawMultiplier);
            if (typeof s.upgrade17Cost === 'string') upgrade17Cost = Number(s.upgrade17Cost);
            if (typeof s.ez1Cost === 'string') ez1Cost = Number(s.ez1Cost);
            if (typeof s.ez2Cost === 'string') ez2Cost = Number(s.ez2Cost);
            if (typeof s.ez3Cost === 'string') ez3Cost = Number(s.ez3Cost);
            if (typeof s.ez4Cost === 'string') ez4Cost = Number(s.ez4Cost);
            if (typeof s.ezOtherMultiplier === 'string') ezOtherMultiplier = Number(s.ezOtherMultiplier);
            if (typeof s.ezMultiplier === 'string') ezMultiplier = Number(s.ezMultiplier);
        }
        // purchased flags
        special1Purchased = !!s.special1Purchased; special2Purchased = !!s.special2Purchased; special3Purchased = !!s.special3Purchased; special4Purchased = !!s.special4Purchased; special5Purchased = !!s.special5Purchased;
        special6Purchased = !!s.special6Purchased; special7Purchased = !!s.special7Purchased; special8Purchased = !!s.special8Purchased;
        pirateSpec1Purchased = !!s.pirateSpec1Purchased; pirateSpec2Purchased = !!s.pirateSpec2Purchased; pirateSpec3Purchased = !!s.pirateSpec3Purchased; pirateSpec4Purchased = !!s.pirateSpec4Purchased;
        goonSpec1Purchased = !!s.goonSpec1Purchased; goonSpec2Purchased = !!s.goonSpec2Purchased; goonSpec3Purchased = !!s.goonSpec3Purchased; goonSpec4Purchased = !!s.goonSpec4Purchased;
        diddy1Purchased = !!s.diddy1Purchased; diddy2Purchased = !!s.diddy2Purchased; diddy3Purchased = !!s.diddy3Purchased; diddy4Purchased = !!s.diddy4Purchased;
        argon1Purchased = !!s.argon1Purchased; argon2Purchased = !!s.argon2Purchased; argon3Purchased = !!s.argon3Purchased; argon4Purchased = !!s.argon4Purchased;
        grape1Purchased = !!s.grape1Purchased; grape2Purchased = !!s.grape2Purchased; grape3Purchased = !!s.grape3Purchased; grape4Purchased = !!s.grape4Purchased;
        skippie1Purchased = !!s.skippie1Purchased; skippie2Purchased = !!s.skippie2Purchased; skippie3Purchased = !!s.skippie3Purchased; skippie4Purchased = !!s.skippie4Purchased;
        island1Purchased = !!s.island1Purchased; island2Purchased = !!s.island2Purchased; island3Purchased = !!s.island3Purchased; island4Purchased = !!s.island4Purchased;
        tribal1Purchased = !!s.tribal1Purchased; tribal2Purchased = !!s.tribal2Purchased; tribal3Purchased = !!s.tribal3Purchased; tribal4Purchased = !!s.tribal4Purchased;
        // Good Noodles purchased flags
        goodNoodles1Purchased = !!s.goodNoodles1Purchased; goodNoodles2Purchased = !!s.goodNoodles2Purchased; goodNoodles3Purchased = !!s.goodNoodles3Purchased;
        if (typeof s.goodNoodlesMultiplier === 'number') goodNoodlesMultiplier = s.goodNoodlesMultiplier;
        // Mobile Man 38 purchased flags
        mobileMan381Purchased = !!s.mobileMan381Purchased; mobileMan382Purchased = !!s.mobileMan382Purchased; mobileMan383Purchased = !!s.mobileMan383Purchased;
        if (typeof s.mobileMan38Multiplier === 'number') mobileMan38Multiplier = s.mobileMan38Multiplier;
        // Easton Bundy purchased flags
        eastonBundy1Purchased = !!s.eastonBundy1Purchased; eastonBundy2Purchased = !!s.eastonBundy2Purchased; eastonBundy3Purchased = !!s.eastonBundy3Purchased; eastonBundy4Purchased = !!s.eastonBundy4Purchased;
        // restore eastonBundyMultiplier (supports number or string saved from Decimal mode)
        if (hasDecimal) {
            if (typeof s.eastonBundyMultiplier === 'string') eastonBundyMultiplier = D(s.eastonBundyMultiplier);
            else if (typeof s.eastonBundyMultiplier === 'number') eastonBundyMultiplier = D(s.eastonBundyMultiplier);
        } else {
            if (typeof s.eastonBundyMultiplier === 'string') eastonBundyMultiplier = Number(s.eastonBundyMultiplier);
            else if (typeof s.eastonBundyMultiplier === 'number') eastonBundyMultiplier = s.eastonBundyMultiplier;
        }
        // phonk purchased flags and state
        phonk1Purchased = !!s.phonk1Purchased; phonk2Purchased = !!s.phonk2Purchased; phonk3Purchased = !!s.phonk3Purchased; phonk4Purchased = !!s.phonk4Purchased; phonk5Purchased = !!s.phonk5Purchased;
        if (typeof s.phonkBaseCps === 'string') phonkBaseCps = hasDecimal ? D(s.phonkBaseCps) : Number(s.phonkBaseCps);
        else if (typeof s.phonkBaseCps === 'number') phonkBaseCps = hasDecimal ? D(s.phonkBaseCps) : s.phonkBaseCps;
        if (typeof s.phonkOtherMultiplier === 'number') phonkOtherMultiplier = s.phonkOtherMultiplier;
        if (typeof s.phonkMultiplier === 'number') phonkMultiplier = s.phonkMultiplier;
        // jonathan purchased flags and state
        jonathan1Purchased = !!s.jonathan1Purchased; jonathan2Purchased = !!s.jonathan2Purchased; jonathan3Purchased = !!s.jonathan3Purchased; jonathan4Purchased = !!s.jonathan4Purchased;
        if (typeof s.jonathanBaseCps === 'string') jonathanBaseCps = hasDecimal ? D(s.jonathanBaseCps) : Number(s.jonathanBaseCps);
        else if (typeof s.jonathanBaseCps === 'number') jonathanBaseCps = hasDecimal ? D(s.jonathanBaseCps) : s.jonathanBaseCps;
        if (typeof s.jonathanOtherMultiplier === 'number') jonathanOtherMultiplier = s.jonathanOtherMultiplier;
        // CR lurker purchased flags
        cr1Purchased = !!s.cr1Purchased; cr2Purchased = !!s.cr2Purchased; cr3Purchased = !!s.cr3Purchased; cr4Purchased = !!s.cr4Purchased; cr5Purchased = !!s.cr5Purchased;
        // shop state
        shopDivinePurchased = !!s.shopDivinePurchased;
        shopPlatinumPurchased = !!s.shopPlatinumPurchased;
        shopDivineWHPurchased = !!s.shopDivineWHPurchased;
        shopWHVrillPurchased = !!s.shopWHVrillPurchased;
        shopMobileManPurchased = !!s.shopMobileManPurchased;
        shopSilverPurchased = !!s.shopSilverPurchased;
        shopGoldPurchased = !!s.shopGoldPurchased;
        shopCollectionBgPurchased = !!s.shopCollectionBgPurchased;
        // load background purchases map (ensure defaults)
        shopBgPurchased = (typeof s.shopBgPurchased === 'object' && s.shopBgPurchased !== null) ? s.shopBgPurchased : {};
        try { BG_IMAGES.forEach(fn => { const full = (fn === 'Vrillbg.png') ? ('mainimage/' + fn) : ('bgimages/' + fn); shopBgPurchased[full] = !!shopBgPurchased[full] || !!shopBgPurchased[fn]; }); } catch (e) {}
        shopWHBWPurchased = !!s.shopWHBWPurchased;
        if (typeof s.equippedShopImage === 'string') {
            equippedShopImage = s.equippedShopImage;
            try {
                if (equippedShopImage && typeof equippedShopImage === 'string' && equippedShopImage.indexOf('/') === -1) {
                    equippedShopImage = 'mainimage/' + equippedShopImage;
                }
            } catch (e) {}
        }
        if (typeof s.equippedBgImage === 'string') {
            equippedBgImage = s.equippedBgImage;
            try {
                if (equippedBgImage && typeof equippedBgImage === 'string' && equippedBgImage.indexOf('/') === -1) {
                    // assume background names without a path refer to the mainimage Mainbg.png
                    if (equippedBgImage.toLowerCase() === 'mainbg.png') equippedBgImage = 'mainimage/Mainbg.png';
                    else if (equippedBgImage.toLowerCase() === 'vrillbg.png') equippedBgImage = 'mainimage/Vrillbg.png';
                    else equippedBgImage = 'bgimages/' + equippedBgImage;
                }
            } catch (e) {}
        }
        // diamonds
        if (typeof s.diamonds === 'string') diamonds = Number(s.diamonds);
        else if (typeof s.diamonds === 'number') diamonds = s.diamonds;
        // clan points (clan currency)
        if (typeof s.clanPoints === 'string') clanPoints = Number(s.clanPoints);
        else if (typeof s.clanPoints === 'number') clanPoints = s.clanPoints;
        // music settings
        if (typeof s.musicVolume === 'string') musicVolume = Number(s.musicVolume) || musicVolume;
        else if (typeof s.musicVolume === 'number') musicVolume = s.musicVolume;
        if (typeof s.musicMuted === 'boolean') musicMuted = s.musicMuted;
        else if (typeof s.musicMuted === 'string') musicMuted = (s.musicMuted === 'true');
                
        // music shop state
        if (typeof s.musicOwned === 'object' && s.musicOwned !== null) musicOwned = s.musicOwned;
        // ensure default theme is always owned
        try { if (!musicOwned || typeof musicOwned !== 'object') musicOwned = {}; musicOwned.mainTheme = true; } catch (e) {}
        if (typeof s.currentMusicTrack === 'string') currentMusicTrack = s.currentMusicTrack;
        // sfx settings
        if (typeof s.sfxVolume === 'string') sfxVolume = Number(s.sfxVolume) || sfxVolume;
        else if (typeof s.sfxVolume === 'number') sfxVolume = s.sfxVolume;
        if (typeof s.sfxMuted === 'boolean') sfxMuted = s.sfxMuted;
        else if (typeof s.sfxMuted === 'string') sfxMuted = (s.sfxMuted === 'true');
        // CR lurker state
        if (typeof s.crBaseCps === 'string') crBaseCps = hasDecimal ? D(s.crBaseCps) : Number(s.crBaseCps);
        else if (typeof s.crBaseCps === 'number') crBaseCps = hasDecimal ? D(s.crBaseCps) : s.crBaseCps;
        if (typeof s.crOtherMultiplier === 'number') crOtherMultiplier = s.crOtherMultiplier;
        if (typeof s.jonathanOtherMultiplier === 'number') jonathanOtherMultiplier = s.jonathanOtherMultiplier;
        // prestige keys
        if (typeof s.goldenWhat === 'number') goldenWhat = s.goldenWhat;
                // Mobile Man (upgrade23) effective contribution is calculated
                // later by computeEffectiveCpsParts() during runtime; no local
                // per[] lookup here to avoid scope issues.
        
        // load stats if present (backwards-compatible)
        if (typeof s.prestigeTimes === 'number') prestigeTimes = s.prestigeTimes;
        if (typeof s.totalGoldenEver === 'number') totalGoldenEver = s.totalGoldenEver;
        // fallback to legacy localStorage keys if save didn't include stats
        try {
            if (typeof prestigeTimes === 'undefined' || prestigeTimes === null) {
                const rawP = localStorage.getItem('whathappened_prestige_times');
                if (rawP) prestigeTimes = Number(rawP) || 0;
            }
            if (typeof totalGoldenEver === 'undefined' || totalGoldenEver === null) {
                const rawG = localStorage.getItem('whathappened_total_golden');
                if (rawG) totalGoldenEver = Number(rawG) || 0;
            }
        } catch (e) {}
        if (typeof s.goldenThreshold === 'number') goldenThreshold = s.goldenThreshold;
        // divine unlock (keep unlocked permanently once set); also set if saved goldenWhat >= 1
        if (typeof s.divineUnlocked === 'boolean') divineUnlocked = s.divineUnlocked;
        else if (typeof s.goldenWhat === 'number' && s.goldenWhat >= 1) divineUnlocked = true;
        // divine Argonian keys
        if (typeof s.divineArgonLevel === 'number') divineArgonLevel = s.divineArgonLevel;
        if (typeof s.divineArgonCost === 'number') divineArgonCost = s.divineArgonCost;
        if (typeof s.divineArgonPercent === 'number') divineArgonPercent = s.divineArgonPercent;
        // divine Somalian keys
        if (typeof s.divineSomalianLevel === 'number') divineSomalianLevel = s.divineSomalianLevel;
        if (typeof s.divineSomalianCost === 'number') divineSomalianCost = s.divineSomalianCost;
        // divine Simple Villager keys
        if (typeof s.divineSimpleVillagerLevel === 'number') divineSimpleVillagerLevel = s.divineSimpleVillagerLevel;
        if (typeof s.divineSimpleVillagerCost === 'number') divineSimpleVillagerCost = s.divineSimpleVillagerCost;
        // upgrade13 keys
        if (typeof s.upgrade13Level === 'number') upgrade13Level = s.upgrade13Level;
        if (typeof s.upgrade13Cost === 'number') upgrade13Cost = s.upgrade13Cost;
        // upgrade15 keys
        if (typeof s.upgrade15Level === 'number') upgrade15Level = s.upgrade15Level;
        if (typeof s.upgrade15Cost === 'number') upgrade15Cost = s.upgrade15Cost;
        // upgrade14 keys
        if (typeof s.upgrade14Level === 'number') upgrade14Level = s.upgrade14Level;
        if (typeof s.upgrade14Cost === 'number') upgrade14Cost = s.upgrade14Cost;
        // ropingnecurse specials
        roping1Purchased = !!s.roping1Purchased; roping2Purchased = !!s.roping2Purchased; roping3Purchased = !!s.roping3Purchased; roping4Purchased = !!s.roping4Purchased;
        if (typeof s.ropingOtherMultiplier === 'number') ropingOtherMultiplier = s.ropingOtherMultiplier;
        // goatis specials
        goatis1Purchased = !!s.goatis1Purchased; goatis2Purchased = !!s.goatis2Purchased; goatis3Purchased = !!s.goatis3Purchased; goatis4Purchased = !!s.goatis4Purchased;
        raw1Purchased = !!s.raw1Purchased; raw2Purchased = !!s.raw2Purchased; raw3Purchased = !!s.raw3Purchased; raw4Purchased = !!s.raw4Purchased;
        if (typeof s.goatisMultiplier === 'number') goatisMultiplier = s.goatisMultiplier;
        // Landon specials
        landon1Purchased = !!s.landon1Purchased; landon2Purchased = !!s.landon2Purchased; landon3Purchased = !!s.landon3Purchased; landon4Purchased = !!s.landon4Purchased;
        if (typeof s.landonMultiplier === 'number') landonMultiplier = s.landonMultiplier;
        // The Bass specials (support old save keys for backward compatibility)
        theBass1Purchased = !!(s.theBass1Purchased || s.seabass1Purchased);
        theBass2Purchased = !!(s.theBass2Purchased || s.seabass2Purchased);
        theBass3Purchased = !!(s.theBass3Purchased || s.seabass3Purchased);
        theBass4Purchased = !!(s.theBass4Purchased || s.seabass4Purchased);
        if (typeof s.theBassMultiplier === 'number') theBassMultiplier = s.theBassMultiplier;
        else if (typeof s.seabassMultiplier === 'number') theBassMultiplier = s.seabassMultiplier;
        // scp specials
        scp1Purchased = !!s.scp1Purchased; scp2Purchased = !!s.scp2Purchased; scp3Purchased = !!s.scp3Purchased; scp4Purchased = !!s.scp4Purchased;
        if (typeof s.scpMultiplier === 'number') scpMultiplier = s.scpMultiplier;
        // skibbidi scimitar specials
        skibidi1Purchased = !!s.skibidi1Purchased; skibidi2Purchased = !!s.skibidi2Purchased; skibidi3Purchased = !!s.skibidi3Purchased; skibidi4Purchased = !!s.skibidi4Purchased;
        if (typeof s.skibbidiOtherMultiplier === 'number') skibbidiOtherMultiplier = s.skibbidiOtherMultiplier;
        // beats specials
        beats1Purchased = !!s.beats1Purchased; beats2Purchased = !!s.beats2Purchased; beats3Purchased = !!s.beats3Purchased;
        if (typeof s.beatsOtherMultiplier === 'number') beatsOtherMultiplier = s.beatsOtherMultiplier;
        // ez villager specials
        ez1Purchased = !!s.ez1Purchased; ez2Purchased = !!s.ez2Purchased; ez3Purchased = !!s.ez3Purchased; ez4Purchased = !!s.ez4Purchased;
        if (typeof s.ezOtherMultiplier === 'number') ezOtherMultiplier = s.ezOtherMultiplier;
        if (typeof s.ezMultiplier === 'number') ezMultiplier = s.ezMultiplier;
        if (typeof s.ez1Cost === 'number') ez1Cost = s.ez1Cost; if (typeof s.ez2Cost === 'number') ez2Cost = s.ez2Cost; if (typeof s.ez3Cost === 'number') ez3Cost = s.ez3Cost; if (typeof s.ez4Cost === 'number') ez4Cost = s.ez4Cost;
        // divine Collector keys
        if (typeof s.divineCollectorLevel === 'number') divineCollectorLevel = s.divineCollectorLevel;
        if (typeof s.divineCollectorCost === 'number') divineCollectorCost = s.divineCollectorCost;
        // divine Money Man keys
        if (typeof s.divineMoneyManLevel === 'number') divineMoneyManLevel = s.divineMoneyManLevel;
        if (typeof s.divineMoneyManCost === 'number') divineMoneyManCost = s.divineMoneyManCost;
        // divine Assassin keys
        if (typeof s.divineAssassinLevel === 'number') divineAssassinLevel = s.divineAssassinLevel;
        if (typeof s.divineAssassinCost === 'number') divineAssassinCost = s.divineAssassinCost;
        // divine Somalian keys
        if (typeof s.divineSomalianLevel === 'number') divineSomalianLevel = s.divineSomalianLevel;
        if (typeof s.divineSomalianCost === 'number') divineSomalianCost = s.divineSomalianCost;
        // divine Spirit keys
        if (typeof s.divineSpiritLevel === 'number') divineSpiritLevel = s.divineSpiritLevel;
        if (typeof s.divineSpiritCost === 'number') divineSpiritCost = s.divineSpiritCost;
        // if this save was written by a prestige operation, apply one-time prestige effects (e.g. Divine Money Man)
        try {
            if (s.prestige) {
                if (typeof divineMoneyManLevel === 'number' && divineMoneyManLevel > 0) {
                    const add = DIVINE_MONEYMAN_BASE * Math.pow(10, Math.max(0, divineMoneyManLevel - 1));
                        if (hasBig) addToCount(D(add)); else count = (typeof count === 'number' ? count : 0) + add;
                    try { alert(`Prestige bonus: +${formatNumber(add)} What Happeneds from Divine Money Man (lvl ${divineMoneyManLevel}).`); } catch (e) {}
                }
                // persist current state without the prestige flag so this applies only once
                try { saveGame(); } catch (e) {}
            }
        } catch (e) { /* ignore */ }

        // --- sanitize numeric state to avoid NaN/Infinity from corrupted saves ---
        try {
            // core values
            count = normalizeNumericValue(count, count);
            baseClickPower = normalizeNumericValue(baseClickPower, baseClickPower);
            clickMultiplier = normalizeNumericValue(clickMultiplier, clickMultiplier);
            baseOtherCps = normalizeNumericValue(baseOtherCps, baseOtherCps);
            pirateCps = normalizeNumericValue(pirateCps, pirateCps);
            pirateMultiplier = normalizeNumericValue(pirateMultiplier, pirateMultiplier);
            // multipliers
            goonMultiplier = normalizeNumericValue(goonMultiplier, goonMultiplier);
            goatisMultiplier = normalizeNumericValue(goatisMultiplier, goatisMultiplier);
            diddyMultiplier = normalizeNumericValue(diddyMultiplier, diddyMultiplier);
            argonMultiplier = normalizeNumericValue(argonMultiplier, argonMultiplier);
            grapeMultiplier = normalizeNumericValue(grapeMultiplier, grapeMultiplier);
            skippieMultiplier = normalizeNumericValue(skippieMultiplier, skippieMultiplier);
            // other multipliers
            diddyOtherMultiplier = normalizeNumericValue(diddyOtherMultiplier, diddyOtherMultiplier);
            argonOtherMultiplier = normalizeNumericValue(argonOtherMultiplier, argonOtherMultiplier);
            grapeOtherMultiplier = normalizeNumericValue(grapeOtherMultiplier, grapeOtherMultiplier);
            skippieOtherMultiplier = normalizeNumericValue(skippieOtherMultiplier, skippieOtherMultiplier);
            islandOtherMultiplier = normalizeNumericValue(islandOtherMultiplier, islandOtherMultiplier);
            islandMultiplier = normalizeNumericValue(islandMultiplier, islandMultiplier);
            tribalOtherMultiplier = normalizeNumericValue(tribalOtherMultiplier, tribalOtherMultiplier);
            tribalMultiplier = normalizeNumericValue(tribalMultiplier, tribalMultiplier);
            // upgrade costs & levels
            upgrade1Cost = normalizeNumericValue(upgrade1Cost, upgrade1Cost); upgrade1Level = normalizeNumericValue(upgrade1Level, upgrade1Level);
            upgrade2Cost = normalizeNumericValue(upgrade2Cost, upgrade2Cost); upgrade2Level = normalizeNumericValue(upgrade2Level, upgrade2Level);
            upgrade3Cost = normalizeNumericValue(upgrade3Cost, upgrade3Cost); upgrade3Level = normalizeNumericValue(upgrade3Level, upgrade3Level);
            upgrade4Cost = normalizeNumericValue(upgrade4Cost, upgrade4Cost); upgrade4Level = normalizeNumericValue(upgrade4Level, upgrade4Level);
            upgrade5Cost = normalizeNumericValue(upgrade5Cost, upgrade5Cost); upgrade5Level = normalizeNumericValue(upgrade5Level, upgrade5Level);
            upgrade6Cost = normalizeNumericValue(upgrade6Cost, upgrade6Cost); upgrade6Level = normalizeNumericValue(upgrade6Level, upgrade6Level);
            upgrade7Cost = normalizeNumericValue(upgrade7Cost, upgrade7Cost); upgrade7Level = normalizeNumericValue(upgrade7Level, upgrade7Level);
            upgrade8Cost = normalizeNumericValue(upgrade8Cost, upgrade8Cost); upgrade8Level = normalizeNumericValue(upgrade8Level, upgrade8Level);
            upgrade9Cost = normalizeNumericValue(upgrade9Cost, upgrade9Cost); upgrade9Level = normalizeNumericValue(upgrade9Level, upgrade9Level);
            upgrade10Cost = normalizeNumericValue(upgrade10Cost, upgrade10Cost); upgrade10Level = normalizeNumericValue(upgrade10Level, upgrade10Level);
            upgrade11Cost = normalizeNumericValue(upgrade11Cost, upgrade11Cost); upgrade11Level = normalizeNumericValue(upgrade11Level, upgrade11Level);
            upgrade12Cost = normalizeNumericValue(upgrade12Cost, upgrade12Cost); upgrade12Level = normalizeNumericValue(upgrade12Level, upgrade12Level);
            upgrade13Cost = normalizeNumericValue(upgrade13Cost, upgrade13Cost); upgrade13Level = normalizeNumericValue(upgrade13Level, upgrade13Level);
            upgrade14Cost = normalizeNumericValue(upgrade14Cost, upgrade14Cost); upgrade14Level = normalizeNumericValue(upgrade14Level, upgrade14Level);
            upgrade15Cost = normalizeNumericValue(upgrade15Cost, upgrade15Cost); upgrade15Level = normalizeNumericValue(upgrade15Level, upgrade15Level);
            upgrade16Cost = normalizeNumericValue(upgrade16Cost, upgrade16Cost); upgrade16Level = normalizeNumericValue(upgrade16Level, upgrade16Level);
            upgrade17Cost = normalizeNumericValue(upgrade17Cost, upgrade17Cost); upgrade17Level = normalizeNumericValue(upgrade17Level, upgrade17Level);
            upgrade19Cost = normalizeNumericValue(upgrade19Cost, upgrade19Cost); upgrade19Level = normalizeNumericValue(upgrade19Level, upgrade19Level);
            upgrade20Cost = normalizeNumericValue(upgrade20Cost, upgrade20Cost); upgrade20Level = normalizeNumericValue(upgrade20Level, upgrade20Level);
            // phonk, ez, jonathan, CR
            phonkBaseCps = normalizeNumericValue(phonkBaseCps, phonkBaseCps); phonkOtherMultiplier = normalizeNumericValue(phonkOtherMultiplier, phonkOtherMultiplier); phonkMultiplier = normalizeNumericValue(phonkMultiplier, phonkMultiplier);
            ezOtherMultiplier = normalizeNumericValue(ezOtherMultiplier, ezOtherMultiplier); ezMultiplier = normalizeNumericValue(ezMultiplier, ezMultiplier);
            ez1Cost = normalizeNumericValue(ez1Cost, ez1Cost); ez2Cost = normalizeNumericValue(ez2Cost, ez2Cost); ez3Cost = normalizeNumericValue(ez3Cost, ez3Cost); ez4Cost = normalizeNumericValue(ez4Cost, ez4Cost);
            jonathanBaseCps = normalizeNumericValue(jonathanBaseCps, jonathanBaseCps); jonathanOtherMultiplier = normalizeNumericValue(jonathanOtherMultiplier, jonathanOtherMultiplier);
            crBaseCps = normalizeNumericValue(crBaseCps, crBaseCps); crOtherMultiplier = normalizeNumericValue(crOtherMultiplier, crOtherMultiplier);
            // roping/skibbidi/beats
            ropingOtherMultiplier = normalizeNumericValue(ropingOtherMultiplier, ropingOtherMultiplier);
            skibbidiOtherMultiplier = normalizeNumericValue(skibbidiOtherMultiplier, skibbidiOtherMultiplier);
            beatsOtherMultiplier = normalizeNumericValue(beatsOtherMultiplier, beatsOtherMultiplier);
            scpMultiplier = normalizeNumericValue(scpMultiplier, scpMultiplier);
            landonMultiplier = normalizeNumericValue(landonMultiplier, landonMultiplier);
            // prestige/divine
            goldenWhat = normalizeNumericValue(goldenWhat, goldenWhat); goldenThreshold = normalizeNumericValue(goldenThreshold, goldenThreshold);
            divineArgonLevel = normalizeNumericValue(divineArgonLevel, divineArgonLevel); divineArgonCost = normalizeNumericValue(divineArgonCost, divineArgonCost); divineArgonPercent = normalizeNumericValue(divineArgonPercent, divineArgonPercent);
            divineSomalianLevel = normalizeNumericValue(divineSomalianLevel, divineSomalianLevel); divineSomalianCost = normalizeNumericValue(divineSomalianCost, divineSomalianCost);
            divineSimpleVillagerLevel = normalizeNumericValue(divineSimpleVillagerLevel, divineSimpleVillagerLevel); divineSimpleVillagerCost = normalizeNumericValue(divineSimpleVillagerCost, divineSimpleVillagerCost);
            divineSpiritLevel = normalizeNumericValue(divineSpiritLevel, divineSpiritLevel); divineSpiritCost = normalizeNumericValue(divineSpiritCost, divineSpiritCost);
            divineCollectorLevel = normalizeNumericValue(divineCollectorLevel, divineCollectorLevel); divineCollectorCost = normalizeNumericValue(divineCollectorCost, divineCollectorCost);
            divineMoneyManLevel = normalizeNumericValue(divineMoneyManLevel, divineMoneyManLevel); divineMoneyManCost = normalizeNumericValue(divineMoneyManCost, divineMoneyManCost);
            divineAssassinLevel = normalizeNumericValue(divineAssassinLevel, divineAssassinLevel); divineAssassinCost = normalizeNumericValue(divineAssassinCost, divineAssassinCost);
        } catch (e) { console.warn('Numeric sanitization failed', e); }

        // compute offline gains based on lastSaved
        try {
            const last = s.lastSaved ? Number(s.lastSaved) : null;
            if (last && !isNaN(last)) {
                const elapsedMs = Date.now() - last;
                const elapsedSec = Math.floor(elapsedMs / 1000);
                const MAX_OFFLINE = 60 * 60 * 24; // cap to 24 hours
                const seconds = Math.min(elapsedSec, MAX_OFFLINE);
                if (seconds > 0) {
                    // compute effective components using the per-upgrade multiplier logic
                    const parts = computeEffectiveCpsParts();
                    const pirateEffective = parts.pirateEffective;
                    // Build other contribution the same way as updateDisplays so offline matches live CPS
                    try {
                        if (hasBig) {
                            const nonPhonkOtherBase = D(parts.otherEffective);
                            const jonathanContribution = D(parts.jonathanEffective).times(D(jonathanOtherMultiplier || 1));
                            const crContribution = D(parts.crEffective).times(D(crOtherMultiplier || 1));
                            const phonkContribution = D(phonkBaseCps || 0).times(D(phonkOtherMultiplier || 1));
                            const nonPhonkOther = nonPhonkOtherBase.times(D(diddyOtherMultiplier || 1)).times(D(argonOtherMultiplier || 1)).times(D(grapeOtherMultiplier || 1)).times(D(skippieOtherMultiplier || 1)).times(D(islandOtherMultiplier || 1)).times(D(tribalOtherMultiplier || 1));
                            let otherCps = nonPhonkOther.plus(jonathanContribution).plus(crContribution).plus(phonkContribution);
                            let totalCps = D(pirateEffective).times(D(pirateMultiplier || 1)).plus(otherCps.times(D(typeof goonMultiplier !== 'undefined' ? goonMultiplier : 1)));
                            const mults = [diddyMultiplier, argonMultiplier, grapeMultiplier, skippieMultiplier, islandMultiplier, tribalMultiplier, phonkMultiplier];
                            for (const m of mults) totalCps = totalCps.times(D(typeof m !== 'undefined' ? m : 1));
                            totalCps = totalCps.times(D(1 + (typeof goldenWhat === 'number' ? goldenWhat * 0.1 : 0)));
                            if (typeof divineArgonLevel !== 'undefined' && divineArgonLevel > 0) {
                                const offlineAppliedPercent = DIVINE_ARGON_BASE_PERCENT * Math.pow(2, Math.max(0, divineArgonLevel - 1));
                                totalCps = totalCps.times(D(1 + (offlineAppliedPercent / 100)));
                            }
                            const gainedD = totalCps.times(D(seconds));
                            if (gainedD && (typeof gainedD.gt === 'function' ? gainedD.gt(0) : Number(gainedD) > 0)) {
                                addToCount(gainedD);
                                try { showWelcomeBackModal(gainedD, seconds); } catch (e) {}
                            }
                        } else {
                            const nonPhonkOtherBase = parts.otherEffective;
                            const jonathanContribution = parts.jonathanEffective * (jonathanOtherMultiplier || 1);
                            const crContribution = parts.crEffective * (crOtherMultiplier || 1);
                            const phonkContribution = (phonkBaseCps || 0) * (phonkOtherMultiplier || 1);
                            const nonPhonkOther = nonPhonkOtherBase * (diddyOtherMultiplier || 1) * (argonOtherMultiplier || 1) * (grapeOtherMultiplier || 1) * (skippieOtherMultiplier || 1) * (islandOtherMultiplier || 1) * (tribalOtherMultiplier || 1);
                            let otherCps = nonPhonkOther + jonathanContribution + crContribution + phonkContribution;
                            let totalCps = (pirateEffective * (pirateMultiplier || 1)) + (otherCps * (typeof goonMultiplier !== 'undefined' ? goonMultiplier : 1));
                            totalCps = totalCps * (typeof diddyMultiplier !== 'undefined' ? diddyMultiplier : 1) * (typeof argonMultiplier !== 'undefined' ? argonMultiplier : 1) * (typeof grapeMultiplier !== 'undefined' ? grapeMultiplier : 1) * (typeof skippieMultiplier !== 'undefined' ? skippieMultiplier : 1) * (typeof islandMultiplier !== 'undefined' ? islandMultiplier : 1) * (typeof tribalMultiplier !== 'undefined' ? tribalMultiplier : 1) * (typeof phonkMultiplier !== 'undefined' ? phonkMultiplier : 1);
                            // apply golden prestige multiplier to offline gains
                            const offlineGoldenMult = 1 + (typeof goldenWhat === 'number' ? goldenWhat * 0.1 : 0);
                            totalCps = totalCps * offlineGoldenMult;
                            if (typeof divineArgonLevel !== 'undefined' && divineArgonLevel > 0) {
                                const offlineAppliedPercent = DIVINE_ARGON_BASE_PERCENT * Math.pow(2, Math.max(0, divineArgonLevel - 1));
                                const offlineDivineMult = 1 + (offlineAppliedPercent / 100);
                                totalCps = totalCps * offlineDivineMult;
                            }
                            const gained = totalCps * seconds;
                            if (gained > 0) {
                                count = (typeof count === 'number' ? count : Number(count)) + Number(gained);
                                try { showWelcomeBackModal(gained, seconds); } catch (e) {}
                            }
                        }
                    } catch (e) { console.error('Offline gain calc failed', e); }
                }
            }
        } catch (e) { console.error('Offline gain calc failed', e); }
    } catch (e) {
        console.error('Load failed', e);
    }
}

function resetGame() {
    if (!confirm('Reset all progress?')) return;
    // prevent autosave from writing during the unload/reload
    suppressAutosave = true;
    try {
        // remove main save (both current and legacy keys)
        try { localStorage.removeItem(SAVE_KEY); } catch (e) {}
        try { localStorage.removeItem(SAVE_KEY_LEGACY); } catch (e) {}
    } catch (e) { console.error('resetGame cleanup failed', e); }
    try { localStorage.removeItem(REDEEMED_KEY); } catch (e) {}
    // give browser a moment to persist removal and allow delete to reach server, then reload
    setTimeout(() => location.reload(), 400);
}

// Cookie consent helpers
function initCookieConsent() {
    try {
        const banner = document.getElementById('cookie-consent-banner');
        if (!banner) return;
        const accepted = localStorage.getItem('wh_cookie_consent');
        const acceptBtn = document.getElementById('cookie-accept-btn');
        if (accepted === 'accepted') {
            banner.style.display = 'none';
            return;
        }
        // show banner
        banner.style.display = 'flex';
        if (acceptBtn) {
            acceptBtn.addEventListener('click', () => {
                acceptCookies();
            });
        }
    } catch (e) { console.warn('initCookieConsent failed', e); }
}

function acceptCookies() {
    try { localStorage.setItem('wh_cookie_consent', 'accepted'); } catch (e) {}
    try { const b = document.getElementById('cookie-consent-banner'); if (b) b.style.display = 'none'; } catch (e) {}
}

// wire up on DOM ready
try { document.addEventListener('DOMContentLoaded', initCookieConsent); } catch (e) {}

