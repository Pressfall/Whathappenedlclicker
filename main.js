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
let mainImageMaxWidth = 560;

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

// Short-scale suffixes, one per power of 1000 starting at thousand (Q = quadrillion, Qi = quintillion, ...)
const NUMBER_SUFFIXES = ['K', 'M', 'B', 'T', 'Q', 'Qi', 'Sx', 'Sp', 'Oc', 'No', 'Dc', 'Ud', 'Dd', 'Td', 'Qad', 'Qid'];

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
            const units = NUMBER_SUFFIXES;
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
    const units = NUMBER_SUFFIXES;
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

// Non-blocking toast for routine messages ("not enough", "unlocks at ..."). alert() froze the game until dismissed.
function notify(message, durationMs) {
    try {
        const text = String(message);
        const ms = durationMs || 2600;
        let box = document.getElementById('toastContainer');
        if (!box) {
            box = document.createElement('div');
            box.id = 'toastContainer';
            box.setAttribute('role', 'status');
            box.setAttribute('aria-live', 'polite');
            document.body.appendChild(box);
        }
        // collapse repeats (e.g. spam-clicking an upgrade you can't afford) into one toast with a counter
        const last = box.lastElementChild;
        if (last && last.dataset.msg === text) {
            last.dataset.repeat = String((Number(last.dataset.repeat) || 1) + 1);
            last.textContent = text + ' (x' + last.dataset.repeat + ')';
            clearTimeout(last._hideTimer);
            last._hideTimer = setTimeout(() => last.remove(), ms);
            return;
        }
        const toast = document.createElement('div');
        toast.className = 'toast';
        toast.dataset.msg = text;
        toast.textContent = text;
        box.appendChild(toast);
        while (box.children.length > 4) box.firstElementChild.remove();
        toast._hideTimer = setTimeout(() => toast.remove(), ms);
    } catch (e) { try { console.warn(message); } catch (e2) {} }
}

// Cost text for "not enough" messages, with how long current CPS needs to earn the difference
function needText(cost) {
    const need = Number(cost) || 0;
    const missing = need - (Number(count) || 0);
    const rate = Number(cps) || 0;
    const eta = (missing > 0 && rate > 0) ? ' (~' + formatSecondsHuman(Math.ceil(missing / rate)) + ' at your CPS)' : '';
    return formatNumber(need) + eta;
}

// ========== Achievements (popups, playtime, CPS, click power, upgrade levels) ==========
// Achievement popups stack in the top-right corner. Calls are collected for a moment so a burst (e.g. several unlocks
// on load) shows at most two popups plus a "+N more" summary instead of a wall of them.
let _achPopupQueue = [];
let _achPopupTimer = null;
function showAchievementPopup(title, message) {
    _achPopupQueue.push({ title: String(title || ''), message: String(message || '') });
    if (!_achPopupTimer) _achPopupTimer = setTimeout(flushAchievementPopups, 250);
}
function flushAchievementPopups() {
    _achPopupTimer = null;
    const batch = _achPopupQueue.splice(0);
    if (!batch.length) return;
    const shown = batch.length > 3 ? batch.slice(0, 2) : batch;
    shown.forEach((b, i) => setTimeout(() => renderAchievementPopup(b.title, b.message), i * 500));
    if (batch.length > 3) {
        const rest = batch.slice(2);
        setTimeout(() => renderAchievementPopup(`+${rest.length} more achievements`, rest.map(b => b.title).join(', ') + '. See them all on the Achievements page.', true), 1000);
    }
}
function renderAchievementPopup(title, message, summary) {
    try {
        let container = document.getElementById('achievementPopupContainer');
        if (!container) {
            container = document.createElement('div');
            container.id = 'achievementPopupContainer';
            container.setAttribute('aria-live', 'polite');
            document.body.appendChild(container);
        }
        // never more than 4 on screen: drop the oldest
        while (container.children.length >= 4) container.firstElementChild.remove();
        const popup = document.createElement('a');
        popup.className = 'achievement-popup' + (summary ? ' achievement-popup--summary' : '');
        popup.href = 'achievements.html';
        popup.title = 'Open achievements';
        const rarity = (window.WHA && window.WHA.titleRarity(title)) || TITLE_RARITIES[title] || null;
        const esc = t => String(t).replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]);
        popup.innerHTML = `<span class="ap-kicker">🏆 Achievement</span><span class="ap-title"${rarity ? ` style="color:${RARITY_COLORS[rarity]}"` : ''}>${esc(title)}</span><span class="ap-msg">${esc(message)}</span>`;
        container.appendChild(popup);
        requestAnimationFrame(() => popup.classList.add('in'));
        setTimeout(() => { popup.classList.remove('in'); setTimeout(() => { try { popup.remove(); } catch (e) {} }, 300); }, summary ? 7000 : 5000);
    } catch (e) { try { console.warn('achievement popup failed', e); } catch (e2) {} }
}
// Unlock an event achievement (crit, click count...) by its key in achievements-data.js and announce it
function unlockAchievement(key) {
    try {
        const a = window.WHA && window.WHA.unlock(key);
        if (a) { showAchievementPopup(a.name, `${a.desc} Title: ${a.title}`); try { populateTitleSelect(); } catch (e) {} }
    } catch (e) {}
}

// All achievements live in achievements-data.js; check them against the live game every couple of seconds.
let _lastDataAchCheck = 0;
function checkDataAchievements(force) {
    if (!window.WHA) return;
    const now = Date.now();
    if (!force && now - _lastDataAchCheck < 2000) return;
    _lastDataAchCheck = now;
    try {
        const upgrades = [0];
        for (let i = 1; i <= 24; i++) upgrades.push(numericLevel(getUpgradeLevel(i)));
        const owned = (window.SPECIAL_UPGRADES || []).filter(sp => { try { return !!(new Function('return ' + sp.owned))(); } catch (e) { return false; } }).length;
        const live = {
            cps: Number(cps) || 0, clickPower: Number(clickPower) || 0,
            prestiges: Number(prestigeTimes) || 0, goldenEver: Math.max(Number(totalGoldenEver) || 0, Number(goldenWhat) || 0), gems: Number(diamonds) || 0,
            upgrades,
            divineArgon: Number(divineArgonLevel) || 0, divineSomalian: Number(divineSomalianLevel) || 0,
            divineAssassin: Number(divineAssassinLevel) || 0, divineCollector: Number(divineCollectorLevel) || 0,
            divineMoneyMan: Number(divineMoneyManLevel) || 0, divineSpirit: Number(divineSpiritLevel) || 0,
            divineVillager: Number(divineSimpleVillagerLevel) || 0,
        };
        if (window.SPECIAL_UPGRADES) { live.specialsOwned = owned; live.specialsTotal = window.SPECIAL_UPGRADES.length; }
        const fresh = window.WHA.checkAll(window.WHA.snapshot(live));
        fresh.forEach(a => showAchievementPopup(a.name, `${a.desc} Title: ${a.title}`));
        if (fresh.length) { try { populateTitleSelect(); } catch (e) {} }
    } catch (e) { try { console.warn('checkDataAchievements failed', e); } catch (e2) {} }
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

// every achievement title (achievements-data.js) gets its rarity here too, so chat and lists color them correctly
try { if (window.WHA) window.WHA.ACHIEVEMENTS.forEach(a => { if (a.title && !TITLE_RARITIES[a.title]) TITLE_RARITIES[a.title] = a.rarity; }); } catch (e) {}

// Color map for rarities
const RARITY_COLORS = {
    common: '#bfc7c9',
    uncommon: '#6bd26b',
    rare: '#4da6ff',
    epic: '#b86cff',
    legendary: '#ffb84d',
    mythic: '#ff5bd0'
};

function normalizeTitleObj(item) {
    // accept either a string (legacy) or an object {name,rarity}
    if (!item) return null;
    if (typeof item === 'string') {
        return { name: item, rarity: (window.WHA && window.WHA.titleRarity(item)) || TITLE_RARITIES[item] || 'common' };
    }
    if (typeof item === 'object' && item.name) {
        return { name: item.name, rarity: (window.WHA && window.WHA.titleRarity(item.name)) || item.rarity || TITLE_RARITIES[item.name] || 'common' };
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

// Display names for upgrades 1..24 (index 0 unused), used in the left-bar button labels
const UPGRADE_NAMES = [null, 'OP mouse', 'Somalian Pirate', 'Goonsaw Man', 'Diddy blud', 'Argonian Autist', 'Grape God', 'Skippie Toilet', 'Mysterious Island',
    'Tribal Camp', 'The Phonk Man', 'Jonathan', 'CR lurker', 'ropingnecurse', 'skibbidi scimitar', 'What Happened Beats', 'ez villager', 'scp wish I knew.',
    'The Goatis', 'goatises raw liver', 'The Landon Stream', 'The Bass', 'Good Noodles', 'Mobile Man 38', 'Easton Bundy'];

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
                const goldenMultLocal = D(1).plus(D(getGoldenBonusCount()).times(D(0.1)));
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
                const goldenMultLocal = 1 + (getGoldenBonusCount() * 0.1);
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
        {id: 'goldenCount', text: 'Golden What Happeneds: each one you hold adds +10% CPS and click power. Spending them on Divine upgrades or followers lowers that bonus.'},
        {id: 'cps', text: 'CPS: What Happeneds per second (passive income).'},
        {id: 'clickPower', text: 'Click Power: how much each manual click gives you.'},
        {id: 'leaderboardTopBtn', text: 'Open the global leaderboard to view top players.'},
        {id: 'submitLeaderboardBtn', text: 'Submit your current score to the global leaderboard.'},
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
            const goldenMult = D(1).plus(D(getGoldenBonusCount()).times(D(0.1)));

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
            const goldenMult = 1 + getGoldenBonusCount() * 0.1;

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
// Priced like the other late-game tiers: 2x / 8x / 30x / 120x the base upgrade cost (1Q)
let landon1Cost = 2000000000000000; // 2Q
let landon2Cost = 8000000000000000; // 8Q
let landon3Cost = 30000000000000000; // 30Q
let landon4Cost = 120000000000000000; // 120Q
let landon1Purchased = false;
let landon2Purchased = false;
let landon3Purchased = false;
let landon4Purchased = false;
let landonMultiplier = 1;
// The Bass specials (one-time multipliers that apply to upgrade21 contribution)
// 2x / 8x / 30x / 120x the base upgrade cost (200Q)
let theBass1Cost = 400000000000000000; // 400Q
let theBass2Cost = 1600000000000000000; // 1,600Q
let theBass3Cost = 6000000000000000000; // 6,000Q
let theBass4Cost = 24000000000000000000; // 24,000Q
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
let goatis1Cost = 10000000000000; // 10T (2x base upgrade cost)
let goatis1Purchased = false;
const goatis1Multiplier = 1.5;

let goatis2Cost = 40000000000000; // 40T
let goatis2Purchased = false;
const goatis2Multiplier = 2;

let goatis3Cost = 150000000000000; // 150T
let goatis3Purchased = false;
const goatis3Multiplier = 2;

let goatis4Cost = 600000000000000; // 600T
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
let raw1Cost = 400000000000000; // 400T (2x base upgrade cost)
let raw1Purchased = false;
const raw1Multiplier = 1.5;

let raw2Cost = 1600000000000000; // 1.6Q
let raw2Purchased = false;
const raw2Multiplier = 2;

let raw3Cost = 6000000000000000; // 6Q
let raw3Purchased = false;
const raw3Multiplier = 2;

let raw4Cost = 24000000000000000; // 24Q
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
let goldenMultiplier = 1; // computed as 1 + getGoldenBonusCount() * 0.1
// Each Golden you are holding adds +10% to CPS and click power, so spending Golden trades some of that bonus away.
function getGoldenBonusCount() { return Math.max(0, Number(goldenWhat) || 0); }

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
let previewTimeout = null;
// Music shop tracks: id is the save key, file is the exact (case-sensitive) name in audio/
const MUSIC_TRACKS = [
    { id: 'mainTheme', name: 'Default Theme', cost: 0, file: 'maintheme.mp3' },
    { id: 'BassInsanity', name: 'Bass Insanity', cost: 20, file: 'bassinsanity.mp3' },
    { id: 'MaximumAgro', name: 'Maximum Agro', cost: 20, file: 'maximumagro.mp3' },
    { id: 'MetalSlam', name: 'Metal Slam', cost: 20, file: 'metalslam.mp3' },
    { id: 'UltraTwang', name: 'Ultra Twang', cost: 20, file: 'ultratwang.mp3' },
    { id: 'ThroatSing', name: 'Throat Sing', cost: 20, file: 'throatsing.mp3' },
    { id: 'Hardstyle_whathappened', name: 'Hardstyle — What Happened', cost: 20, file: 'HardstyleWhat Happened.mp3' },
    { id: 'EDMWhatHappened', name: 'EDM — What Happened', cost: 20, file: 'EDMWhatHappened.mp3' },
    { id: 'SimpleAndEasy', name: 'Simple and Easy', cost: 50, file: 'Simple and Easy.mp3' }
];
function musicSrcFor(trackId) {
    const t = MUSIC_TRACKS.find(x => x.id === trackId) || MUSIC_TRACKS[0];
    return 'audio/' + t.file;
}
// Music shop state
let musicOwned = { mainTheme: true, BassInsanity: false, MaximumAgro: false, MetalSlam: false, UltraTwang: false, ThroatSing: false, Hardstyle_whathappened: false, EDMWhatHappened: false, SimpleAndEasy: false };
let currentMusicTrack = 'mainTheme';
// backup to restore volume after muting via button
let musicVolumeBackup = null;
// SFX settings
let sfxVolume = 0.8;
let sfxMuted = false;
// audio pool for rapid sounds (e.g. click sounds) to prevent GC thrashing and audio element leaks
const _sfxPool = {};
function playSfx(src) {
    try {
        if (!src) return;
        if (sfxMuted) return;
        const finalSrc = (typeof src === 'string' && src.indexOf('/') === -1) ? ('audio/' + src) : src;
        // reuse audio element from a small pool (size 6) to avoid creating dozens of Audio instances per second
        if (!_sfxPool[finalSrc]) {
            _sfxPool[finalSrc] = { index: 0, pool: [] };
        }
        const bucket = _sfxPool[finalSrc];
        let a;
        if (bucket.pool.length < 6) {
            a = new Audio(finalSrc);
            bucket.pool.push(a);
        } else {
            a = bucket.pool[bucket.index];
            bucket.index = (bucket.index + 1) % bucket.pool.length;
            if (!a.paused) {
                try { a.currentTime = 0; } catch (e) {}
            }
        }
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
// WH Nature skin (whnature.webp)
let shopWHNaturePurchased = false;
// voidWH, fireWH, iceWH skins (mainimage)
let shopVoidWHPurchased = false;
let shopFireWHPurchased = false;
let shopIceWHPurchased = false;
// WHhacker, WHchad, WHbread, WHlightning skins (mainimage)
let shopWHhackerPurchased = false;
let shopWHchadPurchased = false;
let shopWHbreadPurchased = false;
let shopWHlightningPurchased = false;
// Mobile Man skin (new)
let shopMobileManPurchased = false;
// Shop: collection background purchase state (collectionbg.png)
let shopCollectionBgPurchased = false;
// Shop: WH black & white skin purchase state (WHblackandwhite.png)
let shopWHBWPurchased = false;
// Shop: Silver and Gold WH skins
let shopSilverPurchased = false;
let shopGoldPurchased = false;
// Casino Dealer skin: unlocked by winning 10 blackjack hands (gamba.js sets it in the save), not sold for gems
let shopCasinoDealerPurchased = false;
// currently equipped main-image filename (defaults to original)
const DEFAULT_SHOP_IMAGE = 'mainimage/whathappened.jpeg';
let equippedShopImage = DEFAULT_SHOP_IMAGE;
// Main-image skins sold in the shop. `owned`/`grant` wrap the save flags above so the shop renders from this table.
// `path` must match the file name exactly (web hosts are case-sensitive); `color` tints the placeholder if the image is missing.
const SHOP_SKINS = [
    { id: 'Divine', title: 'Divine Spirit', path: 'mainimage/divinespirit.png', cost: 20, color: '#b9a3ff', owned: () => shopDivinePurchased, grant: () => { shopDivinePurchased = true; } },
    { id: 'Collection', title: 'Collection Background', path: 'mainimage/collectionbg.png', cost: 20, color: '#d0d0d0', owned: () => shopCollectionBgPurchased, grant: () => { shopCollectionBgPurchased = true; } },
    { id: 'WHBW', title: 'WH Black & White', path: 'mainimage/whblackandwhite.png', cost: 5, color: '#888888', owned: () => shopWHBWPurchased, grant: () => { shopWHBWPurchased = true; } },
    { id: 'WHVrill', title: 'WH Vrill', path: 'mainimage/whvrill.png', cost: 50, color: '#90c0ff', owned: () => shopWHVrillPurchased, grant: () => { shopWHVrillPurchased = true; } },
    { id: 'MobileMan', title: 'Mobile Man Skin', path: 'mainimage/mobilemanskin.png', cost: 50, color: '#f0f0f0', owned: () => shopMobileManPurchased, grant: () => { shopMobileManPurchased = true; } },
    { id: 'Silver', title: 'Silver WH', path: 'mainimage/silverwh.png', cost: 100, color: '#c0c0c0', owned: () => shopSilverPurchased, grant: () => { shopSilverPurchased = true; } },
    { id: 'Platinum', title: 'Platinum WH', path: 'mainimage/platinumwh.png', cost: 100, color: '#e5e4e2', owned: () => shopPlatinumPurchased, grant: () => { shopPlatinumPurchased = true; } },
    { id: 'DivineWH', title: 'Divine WH', path: 'mainimage/divinewh.png', cost: 500, color: '#ffd700', owned: () => shopDivineWHPurchased, grant: () => { shopDivineWHPurchased = true; } },
    { id: 'Gold', title: 'Gold WH', path: 'mainimage/goldwh.png', cost: 500, color: '#ffd700', owned: () => shopGoldPurchased, grant: () => { shopGoldPurchased = true; } },
    { id: 'WHNature', title: 'WH Nature', path: 'mainimage/whnature.webp', cost: 20, color: '#80c080', owned: () => shopWHNaturePurchased, grant: () => { shopWHNaturePurchased = true; } },
    { id: 'VoidWH', title: 'Void WH', path: 'mainimage/voidWH.png', cost: 75, color: '#1a0a2e', owned: () => shopVoidWHPurchased, grant: () => { shopVoidWHPurchased = true; } },
    { id: 'FireWH', title: 'Fire WH', path: 'mainimage/FireWH.png', cost: 75, color: '#cc3300', owned: () => shopFireWHPurchased, grant: () => { shopFireWHPurchased = true; } },
    { id: 'IceWH', title: 'Ice WH', path: 'mainimage/WHice.png', cost: 75, color: '#aad4ee', owned: () => shopIceWHPurchased, grant: () => { shopIceWHPurchased = true; } },
    { id: 'WHhacker', title: 'WH Hacker', path: 'mainimage/WHhacker.png', cost: 50, color: '#003300', owned: () => shopWHhackerPurchased, grant: () => { shopWHhackerPurchased = true; } },
    { id: 'WHchad', title: 'WH Chad', path: 'mainimage/WHchad.png', cost: 50, color: '#f0e68c', owned: () => shopWHchadPurchased, grant: () => { shopWHchadPurchased = true; } },
    { id: 'WHbread', title: 'WH Bread', path: 'mainimage/WHbread.png', cost: 50, color: '#deb887', owned: () => shopWHbreadPurchased, grant: () => { shopWHbreadPurchased = true; } },
    { id: 'WHlightning', title: 'WH Lightning', path: 'mainimage/WHlightning.png', cost: 50, color: '#2a2a4a', owned: () => shopWHlightningPurchased, grant: () => { shopWHlightningPurchased = true; } },
    { id: 'CasinoDealer', title: 'Casino Dealer', path: 'mainimage/casinoDeal.png', cost: null, unlockText: 'Win 10 blackjack hands', color: '#8b0000', owned: () => shopCasinoDealerPurchased, grant: () => { shopCasinoDealerPurchased = true; } }
];
function findShopSkin(path) {
    const base = String(path || '').split('/').pop().toLowerCase();
    return SHOP_SKINS.find(s => s.path.split('/').pop().toLowerCase() === base) || null;
}
// Older saves stored skin paths with different letter case; map them to the real file
function canonicalSkinPath(path) {
    const skin = findShopSkin(path);
    return skin ? skin.path : DEFAULT_SHOP_IMAGE;
}
// Background shop images (folder: bgimages, except vrillbg which lives in mainimage)
const BG_IMAGES = [
    'cloudtreefield.png',
    'grassyfieldbg.png',
    'mountainsbg.png',
    'multipletreesbg.png',
    'oceanviewbg.png',
    'stonghengebg.png',
    'treesbg.png',
    'vrillbg.png',
    'stormbg.png',
    'volcanobg.png',
    'blizardbg.png',
    'burningcitybg.png'
];
const DEFAULT_BG_IMAGE = 'mainimage/mainbg.png';
function bgPathFor(fn) { return (fn === 'vrillbg.png') ? ('mainimage/' + fn) : ('bgimages/' + fn); }
function bgCostFor(fn) {
    if (fn === 'vrillbg.png') return 20;
    if (fn === 'stormbg.png' || fn === 'volcanobg.png' || fn === 'blizardbg.png' || fn === 'burningcitybg.png') return 50;
    return 10;
}
// Map a saved background path (any letter case, with or without folder) to the real file path
function canonicalBgPath(path) {
    const base = String(path || '').split('/').pop().toLowerCase();
    const fn = BG_IMAGES.find(f => f.toLowerCase() === base);
    return fn ? bgPathFor(fn) : DEFAULT_BG_IMAGE;
}
// purchased state for background images (keyed by path)
let shopBgPurchased = {};
// currently equipped background image (defaults to mainbg.png used by CSS)
let equippedBgImage = DEFAULT_BG_IMAGE;

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
// Golden cost of the next level of each Divine upgrade, from its current level.
//  Argonian / Somalian: x3 per level (each level roughly doubles CPS / multiplies click power by 5)
//  Assassin: level n costs n (+5% crit chance per level, max 19). It used to double, so the last levels cost 260K+.
//  Collector / Simple Villager: x1.6 per level (their bonuses are additive and shrink relative to what you have)
//  Money Man: 1, 2, 3, 5, 9, 17... (each level is a x10 bigger head start)
//  Spirit: Fibonacci 1, 2, 3, 5, 8... (each level doubles crit damage)
function divineCostFor(kind, level) {
    const L = Math.max(0, Math.floor(Number(level) || 0));
    switch (kind) {
        case 'argon': case 'somalian': return Math.pow(3, L);
        case 'assassin': return L + 1;
        case 'collector': case 'villager': return Math.ceil(Math.pow(1.6, L));
        case 'moneyMan': return L === 0 ? 1 : Math.pow(2, L - 1) + 1;
        case 'spirit': return fibNumber(L + 1);
        default: return 1;
    }
}
// Recompute every next-cost from the levels (fixes saves made under the old cost curves)
function syncDivineCostsFromLevels() {
    divineArgonCost = divineCostFor('argon', divineArgonLevel);
    divineSomalianCost = divineCostFor('somalian', divineSomalianLevel);
    divineAssassinCost = divineCostFor('assassin', divineAssassinLevel);
    divineCollectorCost = divineCostFor('collector', divineCollectorLevel);
    divineSimpleVillagerCost = divineCostFor('villager', divineSimpleVillagerLevel);
    divineMoneyManCost = divineCostFor('moneyMan', divineMoneyManLevel);
    divineSpiritCost = divineCostFor('spirit', divineSpiritLevel);
}
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

// bulk purchase amount (1,5,10,25,50,100) or 'max' (as many levels as affordable)
let purchaseBatch = 1;
function parseBulkValue(v) { return (String(v) === 'max') ? 'max' : (Number(v) || 1); }
// iterations a buy function attempts; buy loops stop at the first level the player can't afford
function bulkLoopCount() { return purchaseBatch === 'max' ? 100000 : purchaseBatch; }
// levels the next purchase covers (for labels): the selected batch, or the affordable count in Max mode
function bulkLevelsFor(currentCost, rate) {
    if (purchaseBatch !== 'max') return purchaseBatch;
    const mult = getSimpleVillagerMultiplier();
    const have = Number(count) || 0;
    let n = 0, total = 0, temp = Number(currentCost) || 0;
    while (n < 1000) {
        total += temp * mult;
        if (total > have) break;
        temp = Math.ceil(temp * rate);
        n++;
    }
    return Math.max(1, n);
}

function setBulkPurchase(v) {
    purchaseBatch = parseBulkValue(v);
    // reflect selection in localStorage for persistence
    try { localStorage.setItem('whathappened_bulk', String(purchaseBatch)); } catch (e) {}
    try { updateDisplays(); } catch (e) {}
    // update any bulk button UI
    try{
        const btns = document.querySelectorAll('.bulk-btn');
        btns.forEach(b=>{
            try{ b.classList.toggle('active', String(b.dataset.value) === String(purchaseBatch)); }catch(e){}
        });
    }catch(e){}
}

// restore bulk selection on load (if available)
try {
    const bv = localStorage.getItem('whathappened_bulk');
    if (bv) purchaseBatch = parseBulkValue(bv);
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

// Clan level perks: % bonus to CPS, click power and event gem rewards.
// Keep in sync with CLAN_LEVEL_BONUSES (the text shown on clan.html).
const CLAN_LEVEL_PERKS = [
    null,
    { cps: 0, click: 0, event: 0 },
    { cps: 2, click: 0, event: 0 },
    { cps: 2, click: 2, event: 0 },
    { cps: 4, click: 2, event: 1 },
    { cps: 5, click: 2, event: 1 },
    { cps: 6, click: 3, event: 2 },
    { cps: 8, click: 4, event: 2 },
    { cps: 10, click: 5, event: 3 },
    { cps: 12, click: 6, event: 3 },
    { cps: 15, click: 8, event: 5 },
    { cps: 18, click: 10, event: 5 },
    { cps: 20, click: 12, event: 6 },
    { cps: 24, click: 14, event: 6 },
    { cps: 28, click: 16, event: 8 },
    { cps: 32, click: 18, event: 8 },
    { cps: 36, click: 20, event: 10 },
    { cps: 40, click: 22, event: 10 },
    { cps: 45, click: 25, event: 12 },
    { cps: 50, click: 28, event: 12 },
    { cps: 55, click: 30, event: 15 }
];
// Same curve as clan.html: level 2 needs 200 XP, each further level costs 1.55x the previous one, max level 20
function clanLevelFromXp(clanXp) {
    let need = 200, total = 0, level = 1;
    const xp = Number(clanXp) || 0;
    while (level < 20 && xp >= total + need) { total += need; need *= 1.55; level++; }
    return level;
}
function getClanLevelPerk() {
    try {
        if (!localStorage.getItem('player_clanId')) return CLAN_LEVEL_PERKS[1];
        const lvl = Number(window.clanLevel || localStorage.getItem('whathappened_clan_level')) || 1;
        return CLAN_LEVEL_PERKS[Math.max(1, Math.min(20, Math.floor(lvl)))];
    } catch (e) { return CLAN_LEVEL_PERKS[1]; }
}

// The casino page records the active daily-spin buff in the save. Re-read it at most every 2s
// instead of parsing the whole save on every UI refresh.
let _casinoBuffCache = { at: 0, buff: null };
// ---------- Followers (followers.html): equipped followers give permanent buffs on every page ----------
// Bonuses are percentages (crit chance in percentage points); see computeBonuses in followers-data.js.
const NO_FOLLOWER_BONUS = { cps: 0, click: 0, offline: 0, critChance: 0, critDmg: 0, gems: 0, golden: 0, count: 0 };
let _followerBonusCache = { at: 0, bonus: NO_FOLLOWER_BONUS };
function getFollowerBonuses() {
    const now = Date.now();
    if (now - _followerBonusCache.at > 3000) {
        let bonus = NO_FOLLOWER_BONUS;
        try { if (window.WHF) bonus = window.WHF.computeBonuses(window.WHF.loadState()); } catch (e) { bonus = NO_FOLLOWER_BONUS; }
        _followerBonusCache = { at: now, bonus };
    }
    return _followerBonusCache.bonus;
}
// ---------- Items (items.js): equipped charms (percent bonuses) and running consumables (cpsMult / clickMult) ----------
const NO_ITEM_BONUS = { cps: 0, click: 0, critChance: 0, critDmg: 0, gems: 0, boxRate: 0, offline: 0, cpsMult: 1, clickMult: 1 };
function getItemBonuses() {
    try { return (window.WHI && window.WHI.bonuses()) || NO_ITEM_BONUS; } catch (e) { return NO_ITEM_BONUS; }
}
// Equipped followers + their totals under the stats card; only rebuilt when the team changes.
let _followerStripKey = null;
function renderFollowerStrip() {
    const strip = document.getElementById('followerStrip');
    if (!strip || !window.WHF) return;
    let st;
    try { st = window.WHF.loadState(); } catch (e) { return; }
    const team = window.WHF.equippedFollowers(st);
    const eggsReady = (st.nursery || []).filter(window.WHF.eggReady).length;
    const key = team.map(f => f.id + ':' + f.lvl + ':' + f.sp).join(',') + '|' + st.slots + '|' + st.list.length + '|' + eggsReady;
    if (key === _followerStripKey) return;
    _followerStripKey = key;
    // (the Followers nav badge for ready eggs comes from site.js)
    const eggNote = eggsReady ? ` <span class="fs-egg">🐣 ${eggsReady} egg${eggsReady > 1 ? 's' : ''} ready</span>` : '';
    const avatars = document.getElementById('followerStripAvatars');
    const text = document.getElementById('followerStripText');
    if (!team.length) {
        strip.classList.add('is-empty');
        if (avatars) avatars.innerHTML = '';
        if (text) text.innerHTML = (st.list.length ? 'No followers on your team. <b>Equip some →</b>' : '🦎 Get <b>followers</b> with Golden for permanent buffs →') + eggNote;
        return;
    }
    strip.classList.remove('is-empty');
    if (avatars) avatars.innerHTML = team.map(f => {
        const sp = window.WHF.SPECIES_BY_ID[f.sp];
        return `<span class="fs-avatar" style="--rc:${window.WHF.RARITIES[sp.rarity].color}" title="${sp.name} (Lv ${f.lvl})">${window.WHF.art(f.sp, { shiny: f.shiny })}</span>`;
    }).join('');
    const b = window.WHF.computeBonuses(st);
    const pctTxt = v => (v < 1e6 ? Math.round(v).toLocaleString() : formatNumber(v));
    const parts = [];
    if (b.cps) parts.push(`+${pctTxt(b.cps)}% CPS`);
    if (b.click) parts.push(`+${pctTxt(b.click)}% click`);
    if (b.offline) parts.push(`+${pctTxt(b.offline)}% offline`);
    if (b.critChance) parts.push(`+${Math.round(b.critChance * 10) / 10}% crit`);
    if (b.critDmg) parts.push(`+${pctTxt(b.critDmg)}% crit dmg`);
    if (b.gems) parts.push(`+${pctTxt(b.gems)}% gems`);
    if (b.golden) parts.push(`+${pctTxt(b.golden)}% Golden`);
    if (text) text.innerHTML = `Followers: <b>${parts.join(' · ')}</b>${eggNote}`;
}
// Followers page in another tab: pick up team changes, and apply Golden it spent so our autosave
// doesn't write the old Golden count back over it.
const _appliedGoldenDeltas = new Set();
try {
    window.addEventListener('storage', (ev) => {
        if (!window.WHF) return;
        if (ev.key === window.WHF.STORAGE_KEY) {
            _followerBonusCache.at = 0; _followerStripKey = null;
            try { updateDisplays(); } catch (e) {}
        } else if (ev.key === window.WHF.GOLDEN_DELTA_KEY && ev.newValue) {
            try {
                const d = JSON.parse(ev.newValue);
                if (!d || !d.id || _appliedGoldenDeltas.has(d.id)) return;
                _appliedGoldenDeltas.add(d.id);
                goldenWhat = Math.max(0, (Number(goldenWhat) || 0) + (Number(d.delta) || 0));
                updateDisplays();
            } catch (e) {}
        }
    });
} catch (e) {}
// Returning with the browser Back button can restore this page from the back/forward cache with the
// Golden and other values from before the visit to another page. Reload instead, without saving the stale copy.
try {
    window.addEventListener('pageshow', (ev) => {
        if (ev.persisted) { suppressAutosave = true; location.reload(); }
    });
} catch (e) {}
// Accounts (cloud.js): progress from the account is about to replace this device's, so nothing may save the game's
// in-memory state over it before the page reloads
function freezeSavesForReload() { suppressAutosave = true; }
// ...and when that happens in another tab (account page or another game tab), reload this one without saving
try {
    window.addEventListener('storage', (ev) => {
        if (ev.key === 'whathappened_cloud_applied' && ev.newValue) { suppressAutosave = true; location.reload(); }
    });
} catch (e) {}

function getActiveCasinoBuff() {
    const now = Date.now();
    if (now - _casinoBuffCache.at > 2000) {
        let buff = null;
        try {
            const raw = localStorage.getItem(SAVE_KEY) || localStorage.getItem(SAVE_KEY_LEGACY);
            const s = raw ? JSON.parse(raw) : null;
            buff = (s && s.casinoSpin && s.casinoSpin.buff) || null;
            // daily-spin boosts won on the casino page start counting down when you come back to the game
            if (buff && buff.pending) {
                buff = Object.assign({}, buff, { pending: false, expiresAt: now + (Number(buff.durationMs) || 60000) });
                s.casinoSpin.buff = buff;
                const out = JSON.stringify(s);
                localStorage.setItem(SAVE_KEY, out);
                try { localStorage.setItem(SAVE_KEY_LEGACY, out); } catch (e2) {}
            }
        } catch (e) { buff = null; }
        _casinoBuffCache = { at: now, buff };
    }
    const b = _casinoBuffCache.buff;
    return (b && b.expiresAt && Number(b.expiresAt) > now) ? b : null;
}

// Label markup for a Divine upgrade card: name + level badge, what it does now/next, and the golden cost
function divineCardHtml(name, lvl, effect, cost) {
    const costHtml = (cost === null) ? '<span class="up-cost up-cost--max">MAX</span>' : `<span class="up-cost up-cost--gold">${formatNumber(cost)} Golden</span>`;
    return `<span class="up-name">${name}</span><span class="up-effect">${effect}</span>` +
        `<span class="up-meta">${costHtml}<span class="up-level">Lv ${lvl}</span></span>`;
}
// Only touch the DOM when the label actually changed (keeps hover states stable)
function setHtmlIfChanged(el, html) { if (el && el.innerHTML !== html) el.innerHTML = html; }

function updateDisplays() {
    // updateDisplays: UI refresh (debug logs removed)
    document.getElementById('goonCount').innerText = formatNumber(count);
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
        const nonPhonkOtherBase = parts.otherEffective;
        const jonathanContribution = parts.jonathanEffective.times(D(jonathanOtherMultiplier || 1));
        const crContribution = parts.crEffective.times(D(crOtherMultiplier || 1));
        const phonkContribution = D(phonkBaseCps).times(D(phonkOtherMultiplier || 1));
        // apply section multipliers to non-phonk other
        const nonPhonkOther = nonPhonkOtherBase.times(D(diddyOtherMultiplier || 1)).times(D(argonOtherMultiplier || 1)).times(D(grapeOtherMultiplier || 1)).times(D(skippieOtherMultiplier || 1)).times(D(islandOtherMultiplier || 1)).times(D(tribalOtherMultiplier || 1));
        let otherCps = nonPhonkOther.plus(jonathanContribution).plus(crContribution).plus(phonkContribution);
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
        goldenMultiplier = D(1).plus(D(getGoldenBonusCount()).times(D(0.1)));

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
        const nonPhonkOtherBase = parts.otherEffective;
        const jonathanContribution = parts.jonathanEffective * (jonathanOtherMultiplier || 1);
        const crContribution = parts.crEffective * (crOtherMultiplier || 1);
        const phonkContribution = phonkBaseCps * phonkOtherMultiplier;
        // apply section multipliers to non-phonk other
        const nonPhonkOther = nonPhonkOtherBase * diddyOtherMultiplier * argonOtherMultiplier * grapeOtherMultiplier * skippieOtherMultiplier * islandOtherMultiplier * tribalOtherMultiplier;
        let otherCps = nonPhonkOther + jonathanContribution + crContribution + phonkContribution;
        // apply prestige golden multiplier (10% per golden by default)
        goldenMultiplier = 1 + (getGoldenBonusCount() * 0.1);

        // recompute pirate effective value now
        const pirateEffective = parts.pirateEffective;
        // recompute total cps from pirate and other sources, then apply golden multiplier and section multipliers
        cps = (pirateEffective * pirateMultiplier + otherCps * (typeof goonMultiplier !== 'undefined' ? goonMultiplier : 1));
        cps = cps * (typeof diddyMultiplier !== 'undefined' ? diddyMultiplier : 1) * (typeof argonMultiplier !== 'undefined' ? argonMultiplier : 1) * (typeof grapeMultiplier !== 'undefined' ? grapeMultiplier : 1) * (typeof skippieMultiplier !== 'undefined' ? skippieMultiplier : 1) * (typeof islandMultiplier !== 'undefined' ? islandMultiplier : 1) * (typeof tribalMultiplier !== 'undefined' ? tribalMultiplier : 1) * (typeof phonkMultiplier !== 'undefined' ? phonkMultiplier : 1);
    }
    try { renderGemBalances(); } catch (e) {}
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
    // Clan buff (temporary, bought in the clan shop) and clan level perks (permanent, from clan XP)
    try {
        applyClanBuffMults();
        const cpsMult = (typeof window.clanBuffCpsMult === 'number' && window.clanBuffCpsMult > 0) ? window.clanBuffCpsMult : 1;
        const clickMult = (typeof window.clanBuffClickMult === 'number' && window.clanBuffClickMult > 0) ? window.clanBuffClickMult : 1;
        const perk = getClanLevelPerk();
        const totalCpsMult = cpsMult * (1 + perk.cps / 100);
        const totalClickMult = clickMult * (1 + perk.click / 100);
        if (hasDecimal) {
            cps = cps.times(D(totalCpsMult));
            clickPower = clickPower.times(D(totalClickMult));
        } else {
            cps = cps * totalCpsMult;
            clickPower = clickPower * totalClickMult;
        }
    } catch (e) {}
    // Casino buff: apply the active daily-spin buff (clickBoost/cpsBoost/crit) recorded in the save by the casino page
    try {
        const buff = getActiveCasinoBuff();
        if (buff && buff.type === 'crit') {
            window.casinoCritBonus = buff.value || 0.15;
            window.casinoCritExpires = buff.expiresAt;
        } else if (window.casinoCritExpires && Number(window.casinoCritExpires) <= Date.now()) {
            window.casinoCritBonus = 0;
            window.casinoCritExpires = null;
        }
        if (buff && buff.type === 'clickBoost') {
            if (hasDecimal) clickPower = (isDecimalInstance(clickPower) ? clickPower : D(clickPower)).times(D(buff.mult || 10));
            else clickPower = clickPower * (buff.mult || 10);
        }
        if (buff && buff.type === 'cpsBoost') {
            if (hasDecimal) cps = (isDecimalInstance(cps) ? cps : D(cps)).times(D(buff.mult || 10));
            else cps = cps * (buff.mult || 10);
        }
    } catch (e) {}
    // Mystery buff (the "???" daily-spin prize): index.html updates these multipliers while it is active
    try {
        const mysteryCps = Number(window._mysteryCpsMult) || 1;
        const mysteryClick = Number(window._mysteryClickMult) || 1;
        if (hasDecimal) {
            cps = cps.times(D(mysteryCps));
            clickPower = clickPower.times(D(mysteryClick));
        } else {
            cps = cps * mysteryCps;
            clickPower = clickPower * mysteryClick;
        }
    } catch (e) {}
    // Followers: equipped followers' CPS and click power bonuses
    try {
        const fb = getFollowerBonuses();
        const fCps = 1 + (fb.cps || 0) / 100, fClick = 1 + (fb.click || 0) / 100;
        if (hasDecimal) {
            cps = cps.times(D(fCps));
            clickPower = clickPower.times(D(fClick));
        } else {
            cps = cps * fCps;
            clickPower = clickPower * fClick;
        }
    } catch (e) {}
    // Items: equipped charms and running consumable boosts
    try {
        const ib = getItemBonuses();
        const iCps = (1 + (ib.cps || 0) / 100) * (ib.cpsMult || 1), iClick = (1 + (ib.click || 0) / 100) * (ib.clickMult || 1);
        if (hasDecimal) {
            cps = cps.times(D(iCps));
            clickPower = clickPower.times(D(iClick));
        } else {
            cps = cps * iCps;
            clickPower = clickPower * iClick;
        }
    } catch (e) {}
    try { renderFollowerStrip(); } catch (e) {}
    // persist latest cps for achievements UI to read when opened in separate tab
    // (written at most once a second: updateDisplays runs many times a second and localStorage writes are slow)
    if (Date.now() - (window._lastRatePersist || 0) > 1000) {
        window._lastRatePersist = Date.now();
        try { localStorage.setItem('whathappened_current_cps', String(isDecimalInstance(cps) ? cps.toNumber() : Number(cps) || 0)); } catch (e) {}
        try { localStorage.setItem('whathappened_current_clickpower', String(isDecimalInstance(clickPower) ? clickPower.toNumber() : Number(clickPower) || 0)); } catch (e) {}
    }
    try { checkDataAchievements(); } catch (e) {}
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
            setHtmlIfChanged(labelEl, divineCardHtml('Divine Somalian', divineSomalianLevel || 0, `Click power x${formatNumber(curMult)} → x${formatNumber(nextMult)}`, divineSomalianCost || 1));
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
            if (labelEl) labelEl.innerHTML = `<span class="up-name">${UPGRADE_NAMES[19]}</span><span class="up-meta"><span class="up-cost" id="upgrade19Cost">${formattedCost}</span><span class="up-level">Lv ${formatNumber(upgrade19Level)}</span></span>`;
            // reveal upgrade19 when upgrade18 has been purchased at least once
            try { up19Btn.style.display = (numericLevel(upgrade18Level) >= 1) ? '' : 'none'; } catch (e) {}
        }
    } catch (e) {}
    // Special upgrades menu (specials.js): tiles, ready count, and window.__nextSpecialFor for upgrade tooltips
    try { if (typeof updateSpecialsMenu === 'function') updateSpecialsMenu(); } catch (e) {}
    // update Divine Assassin button label and cost display if present
    try {
        const asnBtn = document.getElementById('divineAssassinBtn');
        if (asnBtn) {
            const lvl = typeof divineAssassinLevel === 'number' ? divineAssassinLevel : 0;
            const baseChance = (typeof DIVINE_ASSASSIN_BASE_CHANCE !== 'undefined') ? DIVINE_ASSASSIN_BASE_CHANCE : 0.05;
            const chance = Math.min(1, baseChance * lvl);
            const chanceStr = String(+(chance * 100).toFixed(2)); // "5" not "5.00"
            const labelEl2 = asnBtn.querySelector('.upgrade-label');
            if (labelEl2) {
                if (lvl >= 19) {
                    setHtmlIfChanged(labelEl2, divineCardHtml('Divine Assassin', lvl, `Crit chance ${chanceStr}%`, null));
                } else {
                    setHtmlIfChanged(labelEl2, divineCardHtml('Divine Assassin', lvl, `Crit chance ${chanceStr}% → ${(Math.min(1, baseChance * (lvl + 1)) * 100).toFixed(0)}%`, divineAssassinCost || 1));
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
                setHtmlIfChanged(labelEl, divineCardHtml('Divine Spirit', lvl, `Crits deal x${formatNumber(10 * Math.pow(2, lvl))} → x${formatNumber(10 * Math.pow(2, lvl + 1))}${(typeof divineAssassinLevel === 'number' && divineAssassinLevel > 0) ? '' : ' (needs crit chance)'}`, cost));
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
            setHtmlIfChanged(labelEl3, divineCardHtml('Divine Collector', lvl, `+${Math.round(bonus)}% Golden from prestige → +${Math.round((lvl + 1) * DIVINE_COLLECTOR_PER_LEVEL * 100)}%`, divineCollectorCost || 1));
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
            setHtmlIfChanged(labelEl4, divineCardHtml('Divine Money Man', lvl, lvl > 0 ? `Start runs with ${formatNumber(startAmount)} → ${formatNumber(startAmount * 10)}` : `Start each run with ${formatNumber(DIVINE_MONEYMAN_BASE)}`, divineMoneyManCost || 1));
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
            setHtmlIfChanged(labelEl, divineCardHtml('Divine Simple Villager', lvl, `Upgrades ${currentPct}% cheaper → ${nextPct}%`, divineSimpleVillagerCost || 1));
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
    // show what one click actually earns right now (includes clan, casino and mystery buffs)
    document.getElementById('clickPower').innerText = formatNumber(hasDecimal ? D(clickPower).times(D(goldenMultiplier)) : clickPower * goldenMultiplier);
    // Upgrade button labels (preserve images inside buttons)
    const setLabel = (btnId, text) => {
        const labelEl = document.querySelector(`#${btnId} .upgrade-label`);
        if (labelEl) labelEl.innerText = text;
        else {
            const btn = document.getElementById(btnId);
            if (btn) btn.innerText = text;
        }
    };
    // Card layout for a left-bar upgrade: name, level badge and cost. Only rewrites the DOM when the text changed.
    const setUpgradeCard = (btnId, name, costText, lvl) => {
        const labelEl = document.querySelector(`#${btnId} .upgrade-label`);
        if (!labelEl) return;
        const key = name + '|' + costText + '|' + lvl;
        if (labelEl.dataset.key === key) return;
        labelEl.dataset.key = key;
        labelEl.innerHTML = `<span class="up-name">${name}</span>` +
            `<span class="up-meta"><span class="up-cost">${costText}</span>${lvl ? `<span class="up-level">Lv ${formatNumber(lvl)}</span>` : '<span class="up-level up-level--new">New</span>'}</span>`;
    };
    // show batch cost for the selected bulk amount (in Max mode: as many levels as the player can afford)
    const upgradeCosts = [null, upgrade1Cost, upgrade2Cost, upgrade3Cost, upgrade4Cost, upgrade5Cost, upgrade6Cost, upgrade7Cost, upgrade8Cost, upgrade9Cost, upgrade10Cost, upgrade11Cost, upgrade12Cost,
        upgrade13Cost, upgrade14Cost, upgrade15Cost, upgrade16Cost, upgrade17Cost, upgrade18Cost, upgrade19Cost, upgrade20Cost, upgrade21Cost, upgrade22Cost, upgrade23Cost, upgrade24Cost];
    for (let i = 1; i <= 24; i++) {
        const rate = (i <= 10) ? 1.1 : 1.15;
        const levels = bulkLevelsFor(upgradeCosts[i], rate);
        const batchCost = computeBatchCostWithSimpleVillager(upgradeCosts[i], levels, rate);
        const lvl = getUpgradeLevel(i);
        setUpgradeCard('upgrade' + i, UPGRADE_NAMES[i], (purchaseBatch === 1 ? '' : (purchaseBatch === 'max' ? `Max ×${levels} ` : `×${levels} `)) + formatNumber(batchCost), lvl);
        // dim upgrades the player can't afford yet (unlike `disabled`, this keeps the hover tooltip working)
        try { document.getElementById('upgrade' + i).classList.toggle('cant-afford', !canAfford(effectiveUpgradeCost(upgradeCosts[i]))); } catch (e) {}
    }

    // no left-bar prestige info; golden count shown under click power

    // Top-row (now left-bar) upgrades visibility: only show next upgrade after previous has at least 1 level
    const leftBar = document.getElementById('leftBar');
    const divineLeftBar = document.getElementById('divineLeftBar');
    // keep menuButtons visible at all times; only hide the normal leftBar list when in divineMode
    if (divineMode) {
        if (leftBar) leftBar.style.display = 'none';
        if (divineLeftBar) divineLeftBar.style.display = 'flex';
    } else {
        if (leftBar) leftBar.style.display = 'flex';
        if (divineLeftBar) divineLeftBar.style.display = 'none';
    }
    // when normal menu is visible, update the visibility of individual upgrade buttons
    if (!divineMode) {
        document.getElementById('upgrade1').style.display = 'flex';
        document.getElementById('upgrade2').style.display = (upgrade1Level >= 1) ? 'flex' : 'none';
        document.getElementById('upgrade3').style.display = (upgrade2Level >= 1) ? 'flex' : 'none';
        document.getElementById('upgrade4').style.display = (upgrade3Level >= 1) ? 'flex' : 'none';
        document.getElementById('upgrade5').style.display = (upgrade4Level >= 1) ? 'flex' : 'none';
        document.getElementById('upgrade6').style.display = (upgrade5Level >= 1) ? 'flex' : 'none';
        document.getElementById('upgrade7').style.display = (upgrade6Level >= 1) ? 'flex' : 'none';
        document.getElementById('upgrade8').style.display = (upgrade7Level >= 1) ? 'flex' : 'none';
        document.getElementById('upgrade9').style.display = (upgrade8Level >= 1) ? 'flex' : 'none';
        document.getElementById('upgrade10').style.display = (upgrade9Level >= 1) ? 'flex' : 'none';
        document.getElementById('upgrade11').style.display = (upgrade10Level >= 1) ? 'flex' : 'none';
        document.getElementById('upgrade12').style.display = (upgrade11Level >= 1) ? 'flex' : 'none';
        document.getElementById('upgrade13').style.display = (numericLevel(upgrade12Level) >= 1) ? 'flex' : 'none';
        document.getElementById('upgrade14').style.display = (upgrade13Level >= 1) ? 'flex' : 'none';
        document.getElementById('upgrade15').style.display = (upgrade14Level >= 1) ? 'flex' : 'none';
        // reveal ez villager (upgrade16) once What Happened Beats (upgrade15) is purchased
        try { document.getElementById('upgrade16').style.display = (upgrade15Level >= 1) ? 'flex' : 'none'; } catch (e) {}
        try { document.getElementById('upgrade17').style.display = (upgrade16Level >= 1) ? 'flex' : 'none'; } catch (e) {}
        try { document.getElementById('upgrade18').style.display = (upgrade17Level >= 1) ? 'flex' : 'none'; } catch (e) {}
        try { document.getElementById('upgrade19').style.display = (upgrade18Level >= 1) ? 'flex' : 'none'; } catch (e) {}
        try { document.getElementById('upgrade20').style.display = (upgrade19Level >= 1) ? 'flex' : 'none'; } catch (e) {}
        try { document.getElementById('upgrade21').style.display = (upgrade20Level >= 1) ? 'flex' : 'none'; } catch (e) {}
        try { document.getElementById('upgrade22').style.display = (upgrade21Level >= 1) ? 'flex' : 'none'; } catch (e) {}
        try { document.getElementById('upgrade23').style.display = (upgrade22Level >= 1) ? 'flex' : 'none'; } catch (e) {}
        try { document.getElementById('upgrade24').style.display = (upgrade23Level >= 1) ? 'flex' : 'none'; } catch (e) {}
    }

    // prestige UI visibility (unlocked at CR lvl 150) - top-left button
    // show the golden payout on the buttons; `buyPrestige()` validates and explains if not eligible
    // with nothing to claim yet the button shows progress toward the first Golden instead of "+0"
    const prestigeAwards = getPotentialPrestigeAwards();
    const prestigeLevels = getTotalUpgradeLevels();
    const prestigeLabel = prestigeAwards > 0
        ? `Prestige <span class="btn-chip">+${formatNumber(prestigeAwards)} Golden</span>`
        : `Prestige <span class="btn-chip">${formatNumber(prestigeLevels)} / ${formatNumber(LEVELS_PER_GOLDEN)} levels</span>`;
    const prestigeTopBtn = document.getElementById('prestigeTopBtn');
    if (prestigeTopBtn) {
        prestigeTopBtn.style.display = (numericLevel(upgrade12Level) >= 150) ? '' : 'none';
        if (prestigeTopBtn.innerHTML !== prestigeLabel) prestigeTopBtn.innerHTML = prestigeLabel;
        prestigeTopBtn.classList.toggle('btn-gold', prestigeAwards > 0);
        prestigeTopBtn.classList.toggle('btn-ghost', prestigeAwards <= 0);
        const toNext = LEVELS_PER_GOLDEN - (prestigeLevels % LEVELS_PER_GOLDEN);
        const tip = prestigeAwards > 0
            ? `Reset your run for ${prestigeAwards} Golden. About ${toNext} more upgrade levels earns another.`
            : `Every ${LEVELS_PER_GOLDEN} total upgrade levels earns a Golden when you prestige. ${toNext} to go.`;
        if (prestigeTopBtn.title !== tip) prestigeTopBtn.title = tip;
        prestigeTopBtn.disabled = false;
    }
    // CR section prestige button (mirror of top-left prestige button)
    const prestigeBtnCr = document.getElementById('prestigeBtnCr');
    if (prestigeBtnCr) {
        prestigeBtnCr.style.display = (numericLevel(upgrade12Level) >= 150) ? 'block' : 'none';
        if (prestigeBtnCr.innerHTML !== prestigeLabel) prestigeBtnCr.innerHTML = prestigeLabel;
        prestigeBtnCr.disabled = false;
    }

    // Divine toggle button: visible only if player has at least one golden and not in divineMode
    // Auto-unlock divine if player has any golden what happeneds
    if (Number(goldenWhat || 0) >= 1) divineUnlocked = true;
    const divineMenuBtn = document.getElementById('divineMenuBtn');
    const normalMenuBtn = document.getElementById('normalMenuBtn');
    if (divineMenuBtn) divineMenuBtn.style.display = divineUnlocked ? '' : 'none';
    // highlight the active menu tab (both copies: the normal bar and the divine bar each have a pair)
    for (const id of ['normalMenuBtn', 'normalMenuBtn_clone']) { const b = document.getElementById(id); if (b) b.classList.toggle('active', !divineMode); }
    for (const id of ['divineMenuBtn', 'divineMenuBtn_clone']) { const b = document.getElementById(id); if (b) b.classList.toggle('active', !!divineMode); }

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
        const imgHtml = `<img class="upgrade-img" src="mainimage/divineargonian.png" alt="" width="56" height="56">`;
        const html = imgHtml + '<span class="upgrade-label">' + divineCardHtml('Divine Argonian', divineArgonLevel, `CPS +${formatNumber(appliedPercent)}% → +${formatNumber(nextPercent)}%`, divineArgonCost) + '</span>';
        setHtmlIfChanged(divineArgBtn, html);
        // always show the divine button inside divine menu but disable if not affordable or locked
        divineArgBtn.style.display = '';
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
                const fb = getFollowerBonuses(), ib = getItemBonuses();
                const chance = Math.min(1, (hasAssassin ? DIVINE_ASSASSIN_BASE_CHANCE * divineAssassinLevel : 0) + (fb.critChance || 0) / 100 + (ib.critChance || 0) / 100);
                const critMult = chance > 0 ? 10 * Math.pow(2, (typeof divineSpiritLevel === 'number' ? divineSpiritLevel : 0)) * (1 + (fb.critDmg || 0) / 100) * (1 + (ib.critDmg || 0) / 100) : 0;
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
// --- In-memory click counters (flushed to localStorage periodically, not per-click) ---
// These are initialised from localStorage once (in init / loadGame) and written back
// every few seconds by _flushClickCounters(), avoiding the expensive synchronous
// localStorage round-trip on every single click.
let _memAchClicks = null;       // lazy-init on first click
let _memLifetimeClicks = null;
let _memClicksSincePrestige = null;
let _memClanId = null;          // cached clan check
let _memClanUsername = null;
let _clickCountersDirty = false;

function _ensureClickCountersLoaded() {
    if (_memAchClicks === null) {
        try { _memAchClicks = Number(localStorage.getItem('ach_clicks') || 0) || 0; } catch (e) { _memAchClicks = 0; }
        try { _memLifetimeClicks = Number(localStorage.getItem('whathappened_lifetime_clicks') || 0) || 0; } catch (e) { _memLifetimeClicks = 0; }
        try { _memClicksSincePrestige = Number(localStorage.getItem('whathappened_clicks_since_prestige') || 0) || 0; } catch (e) { _memClicksSincePrestige = 0; }
        try { _memClanId = localStorage.getItem('player_clanId') || ''; } catch (e) { _memClanId = ''; }
        try { _memClanUsername = localStorage.getItem('player_username') || ''; } catch (e) { _memClanUsername = ''; }
    }
}

// Persist the in-memory click counters to localStorage (called every ~2s, not per click)
function _flushClickCounters() {
    if (!_clickCountersDirty) return;
    _clickCountersDirty = false;
    try { localStorage.setItem('ach_clicks', String(_memAchClicks)); } catch (e) {}
    try { localStorage.setItem('whathappened_lifetime_clicks', String(_memLifetimeClicks)); } catch (e) {}
    try { localStorage.setItem('whathappened_clicks_since_prestige', String(_memClicksSincePrestige)); } catch (e) {}
}
// flush click counters every 2 seconds instead of writing localStorage per click
setInterval(_flushClickCounters, 2000);
// also flush on page unload so nothing is lost
try { window.addEventListener('beforeunload', _flushClickCounters); } catch (e) {}
try { document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'hidden') _flushClickCounters(); }); } catch (e) {}

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
        // Followers and items (charms, Loaded Dice): extra crit chance (percentage points)
        chance += (getFollowerBonuses().critChance || 0) / 100;
        chance += (getItemBonuses().critChance || 0) / 100;
        chance = Math.min(1, chance);
        if (chance > 0 && Math.random() < chance) {
                // compute crit multiplier: base 10x, scaled by Divine Spirit levels (doubles per level)
                let critMult = 10;
                // each Divine Spirit level doubles crit damage (level 1 = x20); the old formula made level 1 do nothing
                if (typeof divineSpiritLevel === 'number' && divineSpiritLevel > 0) critMult = 10 * Math.pow(2, divineSpiritLevel);
                // Followers and charms: crit damage bonus
                critMult *= 1 + (getFollowerBonuses().critDmg || 0) / 100;
                critMult *= 1 + (getItemBonuses().critDmg || 0) / 100;
                if (hasDecimal) reward = (isDecimalInstance(reward) ? reward : D(reward)).times(D(critMult));
                else reward *= critMult;
                // optional visual feedback: spawn extra falling image with crit effects (skipped on Low performance)
                if (window._perfCritFalling !== false) { try { spawnFallingImage(true); } catch (e) {} }
                // show a temporary critical indicator (skipped on Low performance)
                if (window._perfCritIndicator !== false) try {
                    const indicator = document.createElement('div');
                    indicator.className = 'crit-indicator';
                    indicator.innerText = 'CRIT!';
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
                    setTimeout(() => { try { indicator.remove(); } catch (e) {} }, 900);
                } catch (e) {}
                // always track crit for achievements and consecutive counter
                try {
                    critOccurred = true;
                    unlockAchievement('gotCrit');
                    try {
                        const lastWas = localStorage.getItem('last_was_crit') === '1';
                        const prev = Number(localStorage.getItem('consecutive_crits')||0) || 0;
                        const next = lastWas ? (prev + 1) : 1;
                        try { localStorage.setItem('consecutive_crits', String(next)); } catch (e) {}
                        try { localStorage.setItem('last_was_crit','1'); } catch (e) {}
                        if (next >= 2) unlockAchievement('stat_unlikely');
                    } catch (e) {}
                } catch (e) {}
            }
    } catch (e) {}
    try { spawnClickFloat(reward, critOccurred); } catch (e) {}
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
    // rare gem drop: 1 in 2500 chance per click (Glitch followers and gem charms raise it); the gem flies into the top-bar counter
    try {
        if (Math.random() < (1/2500) * (1 + (getFollowerBonuses().gems || 0) / 100) * (1 + (getItemBonuses().gems || 0) / 100)) addGems(1);
    } catch (e) {}
    try {
        const str = formatNumber(count);
        const el = window._goonCountElClick || document.getElementById('goonCount');
        if (el) { el.innerText = str; window._goonCountElClick = el; }
    } catch (e) {}
    const now = Date.now();
    if (!window._lastIncrementUpdateDisplays || now - window._lastIncrementUpdateDisplays > 150) {
        window._lastIncrementUpdateDisplays = now;
        updateDisplays();
    }
    // spawn a falling image effect (throttled; disabled on Low performance)
    try {
        const throttle = (typeof window._perfFallingThrottleMs === 'number') ? window._perfFallingThrottleMs : 80;
        if (throttle > 0 && (!window._lastFallingSpawn || now - window._lastFallingSpawn > throttle)) {
            window._lastFallingSpawn = now;
            spawnFallingImage(false);
        }
    } catch (e) { /* ignore if animation fails */ }
    // visual: briefly pulsate the main image on click (throttled to avoid forced reflows)
    try {
        if (!window._lastPulsateAt || now - window._lastPulsateAt > 120) {
            window._lastPulsateAt = now;
            const img = window._mainImageCached || (window._mainImageCached = document.querySelector('.main-image'));
            if (img) {
                img.classList.remove('pulsate');
                // force reflow to restart animation
                void img.offsetWidth;
                img.classList.add('pulsate');
                // clear pulsate class after the animation finishes (only need one pending timeout)
                clearTimeout(window._pulsateTimeout);
                window._pulsateTimeout = setTimeout(() => { try { img.classList.remove('pulsate'); } catch (e) {} }, 700);
            }
        }
    } catch (e) {}

    // Achievement & click counters: update in-memory only (flushed to localStorage periodically)
    try {
        _ensureClickCountersLoaded();
        _memAchClicks++;
        _memLifetimeClicks++;
        _memClicksSincePrestige++;
        _clickCountersDirty = true;
        // the click-count achievements unlock straight away instead of waiting for the next periodic check
        if (_memAchClicks === 10) unlockAchievement('gettingStarted');
        if (_memAchClicks === 1000) unlockAchievement('somethingHappened');
    } catch (e) {}

    // Clan events: count the click locally. flushClanClicks() sends the total to Firestore every few seconds
    // (one write per click was slow, costly, and over Firestore's ~1 write/sec per-document limit).
    try {
        if (_memClanId && _memClanUsername) {
            window._pendingClanClicks = (window._pendingClanClicks || 0) + 1;
            window._bossfightPending = (window._bossfightPending || 0) + 1;
        }
    } catch (e) {}
}

// Add the clicks counted since the last flush to this member's `mainClicks` (used by clan-v-clan events)
async function flushClanClicks() {
    const pending = window._pendingClanClicks || 0;
    if (pending <= 0) return;
    const clanId = localStorage.getItem('player_clanId');
    const username = localStorage.getItem('player_username');
    if (!clanId || !username) { window._pendingClanClicks = 0; return; }
    if (typeof doc !== 'function' || typeof db === 'undefined' || typeof setDoc !== 'function') return;
    window._pendingClanClicks = 0;
    try {
        const memberRef = doc(db, 'clans', String(clanId), 'members', String(username));
        if (typeof window.firestoreIncrement === 'function') {
            await setDoc(memberRef, { mainClicks: window.firestoreIncrement(pending) }, { merge: true });
        } else {
            const s = await getDoc(memberRef);
            const cur = (s && s.exists() && Number(s.data().mainClicks)) || 0;
            await setDoc(memberRef, { mainClicks: cur + pending }, { merge: true });
        }
    } catch (e) {
        // keep the clicks so the next flush retries them
        window._pendingClanClicks = (window._pendingClanClicks || 0) + pending;
        console.warn('flushClanClicks failed', e);
    }
}

// create a falling image from a random x at the top to the bottom, then remove it
function spawnFallingImage(isCrit = false) {
    // cap falling images to prevent DOM bloat during rapid clicking
    const container = document.getElementById('falling-container');
    const parent = container || document.body;
    const MAX_FALLING = 15;
    if (parent.querySelectorAll('.falling-image').length >= MAX_FALLING) return;

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
    parent.appendChild(img);

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

    // remove when transition finishes; also hard-cap removal in case transitionend never fires
    const cleanup = () => { try { img.remove(); } catch (e) {} };
    img.addEventListener('transitionend', cleanup, { once: true });
    setTimeout(cleanup, 2500);
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
    // run periodically so UI updates reflect affordability (interval depends on Performance setting)
    function scheduleDisabledClasses() {
        const ms = (typeof window._perfDisabledClassIntervalMs === 'number') ? window._perfDisabledClassIntervalMs : 500;
        window._perfDisabledClassTimeout = setTimeout(function() { try { updateDisabledClasses(); } catch (e) {} scheduleDisabledClasses(); }, ms);
    }
    scheduleDisabledClasses();

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
    // a quick refresh isn't "coming back"; only greet players who were away at least a minute
    if (!(Number(seconds) >= 60)) return;
    try {
        const modal = document.getElementById('welcomeBackModal');
        const gainedEl = document.getElementById('welcomeBackGained');
        const forEl = document.getElementById('welcomeBackFor');
        const okBtn = document.getElementById('welcomeBackOk');
        const closeBtn = document.getElementById('welcomeBackClose');
        if (!modal) return;
        const formattedAmount = (typeof formatNumber === 'function') ? formatNumber(amount) : String(amount);
        const formattedTime = (typeof formatSecondsHuman === 'function') ? formatSecondsHuman(Number(seconds || 0)) : (String(seconds) + 's');
        const s = Math.floor(Number(seconds) || 0), d = Math.floor(s / 86400), h = Math.floor((s % 86400) / 3600), m = Math.floor((s % 3600) / 60);
        const away = d ? `${d}d ${h}h` : h ? `${h}h ${m}m` : `${m}m`;
        if (gainedEl) gainedEl.innerHTML = `<span class="wb-amount">+${formattedAmount}</span><span class="wb-label">What Happeneds earned while you were away</span>`;
        if (forEl) forEl.innerHTML = `Away for <strong title="${formattedTime}">${away}</strong>`;
        modal.style.display = 'block';
        const hide = () => { try { modal.style.display = 'none'; } catch (e) {} };
        if (okBtn) okBtn.addEventListener('click', hide, { once: true });
        if (closeBtn) closeBtn.addEventListener('click', hide, { once: true });
        // auto-hide after 8 seconds
        setTimeout(hide, 8000);
    } catch (e) {}
}

function buyUpgrade1() {
    const btn = document.getElementById('upgrade1');
    let bought = 0;
    for (let i = 0; i < bulkLoopCount(); i++) {
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
    else notify('Not enough What Happeneds — need ' + needText(computeBatchCostWithSimpleVillager(upgrade1Cost, purchaseBatch || 1, 1.1)) + '.');
}

function buyUpgrade2() {
    const btn = document.getElementById('upgrade2');
    let bought = 0;
    for (let i = 0; i < bulkLoopCount(); i++) {
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
    else notify('Not enough What Happeneds — need ' + needText(computeBatchCostWithSimpleVillager(upgrade2Cost, purchaseBatch || 1, 1.1)) + '.');
}

function buyUpgrade3() {
    const btn = document.getElementById('upgrade3');
    let bought = 0;
    for (let i = 0; i < bulkLoopCount(); i++) {
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
    else notify('Not enough What Happeneds — need ' + needText(computeBatchCostWithSimpleVillager(upgrade3Cost, purchaseBatch || 1, 1.1)) + '.');
}

function buyUpgrade4() {
    const btn = document.getElementById('upgrade4');
    let bought = 0;
    for (let i = 0; i < bulkLoopCount(); i++) {
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
    else notify('Not enough What Happeneds — need ' + needText(computeBatchCostWithSimpleVillager(upgrade4Cost, purchaseBatch || 1, 1.1)) + '.');
}

function buyUpgrade5() {
    const btn = document.getElementById('upgrade5');
    let bought = 0;
    for (let i = 0; i < bulkLoopCount(); i++) {
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
    else notify('Not enough What Happeneds — need ' + needText(computeBatchCostWithSimpleVillager(upgrade5Cost, purchaseBatch || 1, 1.1)) + '.');
}

function buyUpgrade6() {
    const btn = document.getElementById('upgrade6');
    let bought = 0;
    for (let i = 0; i < bulkLoopCount(); i++) {
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
    else notify('Not enough What Happeneds — need ' + needText(computeBatchCostWithSimpleVillager(upgrade6Cost, purchaseBatch || 1, 1.1)) + '.');
}

function buyUpgrade7() {
    const btn = document.getElementById('upgrade7');
    let bought = 0;
    for (let i = 0; i < bulkLoopCount(); i++) {
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
    else notify('Not enough What Happeneds — need ' + needText(computeBatchCostWithSimpleVillager(upgrade7Cost, purchaseBatch || 1, 1.1)) + '.');
}

function buyUpgrade8() {
    const btn = document.getElementById('upgrade8');
    let bought = 0;
    for (let i = 0; i < bulkLoopCount(); i++) {
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
    else notify('Not enough What Happeneds — need ' + needText(computeBatchCostWithSimpleVillager(upgrade8Cost, purchaseBatch || 1, 1.1)) + '.');
}

function buyUpgrade9() {
    const btn = document.getElementById('upgrade9');
    let bought = 0;
    for (let i = 0; i < bulkLoopCount(); i++) {
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
    else notify('Not enough What Happeneds — need ' + needText(computeBatchCostWithSimpleVillager(upgrade9Cost, purchaseBatch || 1, 1.1)) + '.');
}

function buyUpgrade10() {
    const btn = document.getElementById('upgrade10');
    let bought = 0;
    for (let i = 0; i < bulkLoopCount(); i++) {
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
    else notify('Not enough What Happeneds — need ' + needText(computeBatchCostWithSimpleVillager(upgrade10Cost, purchaseBatch || 1, 1.1)) + '.');
}

function buyUpgrade11() {
    const btn = document.getElementById('upgrade11');
    let bought = 0;
    for (let i = 0; i < bulkLoopCount(); i++) {
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
    else notify('Not enough What Happeneds — need ' + needText(computeBatchCostWithSimpleVillager(upgrade11Cost, purchaseBatch || 1, 1.15)) + '.');
}

function buyUpgrade12() {
    const btn = document.getElementById('upgrade12');
    let bought = 0;
    for (let i = 0; i < bulkLoopCount(); i++) {
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
    else notify('Not enough What Happeneds — need ' + needText(computeBatchCostWithSimpleVillager(upgrade12Cost, purchaseBatch || 1, 1.15)) + '.');
}

function buyUpgrade13() {
    const btn = document.getElementById('upgrade13');
    let bought = 0;
    for (let i = 0; i < bulkLoopCount(); i++) {
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
    else notify('Not enough What Happeneds — need ' + needText(computeBatchCostWithSimpleVillager(upgrade13Cost, purchaseBatch || 1, 1.15)) + '.');
}

function buyUpgrade14() {
    const btn = document.getElementById('upgrade14');
    let bought = 0;
    for (let i = 0; i < bulkLoopCount(); i++) {
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
    else notify('Not enough What Happeneds — need ' + needText(computeBatchCostWithSimpleVillager(upgrade14Cost, purchaseBatch || 1, 1.15)) + '.');
}

function buyUpgrade15() {
    const btn = document.getElementById('upgrade15');
    let bought = 0;
    for (let i = 0; i < bulkLoopCount(); i++) {
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
    else notify('Not enough What Happeneds — need ' + needText(computeBatchCostWithSimpleVillager(upgrade15Cost, purchaseBatch || 1, 1.15)) + '.');
}

function buyUpgrade16() {
    const btn = document.getElementById('upgrade16');
    let bought = 0;
    for (let i = 0; i < bulkLoopCount(); i++) {
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
    else notify('Not enough What Happeneds — need ' + needText(computeBatchCostWithSimpleVillager(upgrade16Cost, purchaseBatch || 1, 1.15)) + '.');
}

function buyUpgrade17() {
    const btn = document.getElementById('upgrade17');
    let bought = 0;
    for (let i = 0; i < bulkLoopCount(); i++) {
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
    else notify('Not enough What Happeneds — need ' + needText(computeBatchCostWithSimpleVillager(upgrade17Cost, purchaseBatch || 1, 1.15)) + '.');
}

function buyUpgrade18() {
    const btn = document.getElementById('upgrade18');
    let bought = 0;
    for (let i = 0; i < bulkLoopCount(); i++) {
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
    else notify('Not enough What Happeneds — need ' + needText(computeBatchCostWithSimpleVillager(upgrade18Cost, purchaseBatch || 1, 1.15)) + '.');
}

function buyUpgrade19() {
    const btn = document.getElementById('upgrade19');
    let bought = 0;
    for (let i = 0; i < bulkLoopCount(); i++) {
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
    else notify('Not enough What Happeneds — need ' + needText(computeBatchCostWithSimpleVillager(typeof upgrade19Cost !== 'undefined' ? upgrade19Cost : 200000000000000, purchaseBatch || 1, 1.15)) + '.');
}

function buyUpgrade20() {
    const btn = document.getElementById('upgrade20');
    let bought = 0;
    for (let i = 0; i < bulkLoopCount(); i++) {
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
    else notify('Not enough What Happeneds — need ' + needText(computeBatchCostWithSimpleVillager(typeof upgrade20Cost !== 'undefined' ? upgrade20Cost : 1000000000000000, purchaseBatch || 1, 1.15)) + '.');
}

function buyUpgrade21() {
    const btn = document.getElementById('upgrade21');
    let bought = 0;
    for (let i = 0; i < bulkLoopCount(); i++) {
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
    else notify('Not enough What Happeneds — need ' + needText(computeBatchCostWithSimpleVillager(typeof upgrade21Cost !== 'undefined' ? upgrade21Cost : 200000000000000000, purchaseBatch || 1, 1.15)) + '.');
}

function buyUpgrade22() {
    const btn = document.getElementById('upgrade22');
    let bought = 0;
    for (let i = 0; i < bulkLoopCount(); i++) {
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
    else notify('Not enough What Happeneds — need ' + needText(computeBatchCostWithSimpleVillager(typeof upgrade22Cost !== 'undefined' ? upgrade22Cost : 1000000000000000000, purchaseBatch || 1, 1.15)) + '.');
}

function buyUpgrade23() {
    const btn = document.getElementById('upgrade23');
    let bought = 0;
    for (let i = 0; i < bulkLoopCount(); i++) {
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
    else notify('Not enough What Happeneds — need ' + needText(computeBatchCostWithSimpleVillager(typeof upgrade23Cost !== 'undefined' ? upgrade23Cost : 5000000000000000000, purchaseBatch || 1, 1.15)) + '.');
}

function buyUpgrade24() {
    const btn = document.getElementById('upgrade24');
    let bought = 0;
    for (let i = 0; i < bulkLoopCount(); i++) {
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
    else notify('Not enough What Happeneds — need ' + needText(computeBatchCostWithSimpleVillager(typeof upgrade24Cost !== 'undefined' ? upgrade24Cost : 30000000000000000000, purchaseBatch || 1, 1.15)) + '.');
}

// SCP special purchases (each doubles SCP contribution)
function buyScp1() {
    if (numericLevel(upgrade17Level) < 10) { notify('Unlocks at SCP level 10'); return; }
    if (scp1Purchased) { notify('Already purchased'); return; }
    if (hasDecimal) {
        if ((isDecimalInstance(count) ? count : D(count)).gte(D(scp1Cost))) {
            count = (isDecimalInstance(count) ? count : D(count)).minus(D(scp1Cost));
            scp1Purchased = true;
            if (hasDecimal) scpMultiplier = (isDecimalInstance(scpMultiplier) ? scpMultiplier.times(D(2)) : D(scpMultiplier).times(D(2))); else scpMultiplier = scpMultiplier * 2;
            updateDisplays();
        } else notify('Not enough What Happeneds');
    } else {
        if (count >= scp1Cost) {
            count -= scp1Cost; scp1Purchased = true; scpMultiplier = scpMultiplier * 2; updateDisplays();
        } else notify('Not enough What Happeneds');
    }
}

function buyScp2() {
    if (numericLevel(upgrade17Level) < 25) { notify('Unlocks at SCP level 25'); return; }
    if (scp2Purchased) { notify('Already purchased'); return; }
    if (hasDecimal) {
        if ((isDecimalInstance(count) ? count : D(count)).gte(D(scp2Cost))) {
            count = (isDecimalInstance(count) ? count : D(count)).minus(D(scp2Cost));
            scp2Purchased = true;
            if (hasDecimal) scpMultiplier = (isDecimalInstance(scpMultiplier) ? scpMultiplier.times(D(2)) : D(scpMultiplier).times(D(2))); else scpMultiplier = scpMultiplier * 2;
            updateDisplays();
        } else notify('Not enough What Happeneds');
    } else {
        if (count >= scp2Cost) {
            count -= scp2Cost; scp2Purchased = true; scpMultiplier = scpMultiplier * 2; updateDisplays();
        } else notify('Not enough What Happeneds');
    }
}

function buyScp3() {
    if (numericLevel(upgrade17Level) < 50) { notify('Unlocks at SCP level 50'); return; }
    if (scp3Purchased) { notify('Already purchased'); return; }
    if (hasDecimal) {
        if ((isDecimalInstance(count) ? count : D(count)).gte(D(scp3Cost))) {
            count = (isDecimalInstance(count) ? count : D(count)).minus(D(scp3Cost));
            scp3Purchased = true;
            if (hasDecimal) scpMultiplier = (isDecimalInstance(scpMultiplier) ? scpMultiplier.times(D(2)) : D(scpMultiplier).times(D(2))); else scpMultiplier = scpMultiplier * 2;
            updateDisplays();
        } else notify('Not enough What Happeneds');
    } else {
        if (count >= scp3Cost) {
            count -= scp3Cost; scp3Purchased = true; scpMultiplier = scpMultiplier * 2; updateDisplays();
        } else notify('Not enough What Happeneds');
    }
}

function buyScp4() {
    if (numericLevel(upgrade17Level) < 75) { notify('Unlocks at SCP level 75'); return; }
    if (scp4Purchased) { notify('Already purchased'); return; }
    if (hasDecimal) {
        if ((isDecimalInstance(count) ? count : D(count)).gte(D(scp4Cost))) {
            count = (isDecimalInstance(count) ? count : D(count)).minus(D(scp4Cost));
            scp4Purchased = true;
            if (hasDecimal) scpMultiplier = (isDecimalInstance(scpMultiplier) ? scpMultiplier.times(D(2)) : D(scpMultiplier).times(D(2))); else scpMultiplier = scpMultiplier * 2;
            updateDisplays();
        } else notify('Not enough What Happeneds');
    } else {
        if (count >= scp4Cost) {
            count -= scp4Cost; scp4Purchased = true; scpMultiplier = scpMultiplier * 2; updateDisplays();
        } else notify('Not enough What Happeneds');
    }
}

// Good Noodles specials (one-time multipliers applied to upgrade22 contribution)
function buyGoodNoodles1() {
    if (goodNoodles1Purchased) { notify('Already purchased.'); return; }
    if (numericLevel(upgrade22Level) < 10) { notify('Unlocks at Good Noodles lvl 10.'); return; }
    if (hasDecimal) {
        if ((isDecimalInstance(count) ? count : D(count)).lt(D(goodNoodles1Cost))) { notify('Not enough What Happeneds — need ' + needText(goodNoodles1Cost) + '.'); return; }
        count = (isDecimalInstance(count) ? count : D(count)).minus(D(goodNoodles1Cost));
    } else {
        if (count < goodNoodles1Cost) { notify('Not enough What Happeneds — need ' + needText(goodNoodles1Cost) + '.'); return; }
        count -= goodNoodles1Cost;
    }
    goodNoodles1Purchased = true;
    if (hasDecimal) goodNoodlesMultiplier = (isDecimalInstance(goodNoodlesMultiplier) ? goodNoodlesMultiplier : D(goodNoodlesMultiplier)).times(D(1.5));
    else goodNoodlesMultiplier *= 1.5;
    saveGame(); try { playSfx('audio/purchase.wav'); } catch (e) {} updateDisplays();
}

function buyGoodNoodles2() {
    if (goodNoodles2Purchased) { notify('Already purchased.'); return; }
    if (numericLevel(upgrade22Level) < 25) { notify('Unlocks at Good Noodles lvl 25.'); return; }
    if (hasDecimal) {
        if ((isDecimalInstance(count) ? count : D(count)).lt(D(goodNoodles2Cost))) { notify('Not enough What Happeneds — need ' + needText(goodNoodles2Cost) + '.'); return; }
        count = (isDecimalInstance(count) ? count : D(count)).minus(D(goodNoodles2Cost));
    } else {
        if (count < goodNoodles2Cost) { notify('Not enough What Happeneds — need ' + needText(goodNoodles2Cost) + '.'); return; }
        count -= goodNoodles2Cost;
    }
    goodNoodles2Purchased = true;
    if (hasDecimal) goodNoodlesMultiplier = (isDecimalInstance(goodNoodlesMultiplier) ? goodNoodlesMultiplier : D(goodNoodlesMultiplier)).times(D(2));
    else goodNoodlesMultiplier *= 2;
    saveGame(); try { playSfx('audio/purchase.wav'); } catch (e) {} updateDisplays();
}

function buyGoodNoodles3() {
    if (goodNoodles3Purchased) { notify('Already purchased.'); return; }
    if (numericLevel(upgrade22Level) < 50) { notify('Unlocks at Good Noodles lvl 50.'); return; }
    if (hasDecimal) {
        if ((isDecimalInstance(count) ? count : D(count)).lt(D(goodNoodles3Cost))) { notify('Not enough What Happeneds — need ' + needText(goodNoodles3Cost) + '.'); return; }
        count = (isDecimalInstance(count) ? count : D(count)).minus(D(goodNoodles3Cost));
    } else {
        if (count < goodNoodles3Cost) { notify('Not enough What Happeneds — need ' + needText(goodNoodles3Cost) + '.'); return; }
        count -= goodNoodles3Cost;
    }
    goodNoodles3Purchased = true;
    if (hasDecimal) goodNoodlesMultiplier = (isDecimalInstance(goodNoodlesMultiplier) ? goodNoodlesMultiplier : D(goodNoodlesMultiplier)).times(D(2.5));
    else goodNoodlesMultiplier *= 2.5;
    saveGame(); try { playSfx('audio/purchase.wav'); } catch (e) {} updateDisplays();
}

function buyGoodNoodles4() {
    if (goodNoodles4Purchased) { notify('Already purchased.'); return; }
    if (numericLevel(upgrade22Level) < 100) { notify('Unlocks at Good Noodles lvl 100.'); return; }
    if (hasDecimal) {
        if ((isDecimalInstance(count) ? count : D(count)).lt(D(goodNoodles4Cost))) { notify('Not enough What Happeneds — need ' + needText(goodNoodles4Cost) + '.'); return; }
        count = (isDecimalInstance(count) ? count : D(count)).minus(D(goodNoodles4Cost));
    } else {
        if (count < goodNoodles4Cost) { notify('Not enough What Happeneds — need ' + needText(goodNoodles4Cost) + '.'); return; }
        count -= goodNoodles4Cost;
    }
    goodNoodles4Purchased = true;
    if (hasDecimal) goodNoodlesMultiplier = (isDecimalInstance(goodNoodlesMultiplier) ? goodNoodlesMultiplier : D(goodNoodlesMultiplier)).times(D(3));
    else goodNoodlesMultiplier *= 3;
    saveGame(); try { playSfx('audio/purchase.wav'); } catch (e) {} updateDisplays();
}

// Mobile Man 38 specials (one-time multipliers applied to upgrade23 contribution)
function buyMobileMan381() {
    if (mobileMan381Purchased) { notify('Already purchased.'); return; }
    if (numericLevel(upgrade23Level) < 10) { notify('Unlocks at Mobile Man 38 lvl 10.'); return; }
    if (hasDecimal) {
        if ((isDecimalInstance(count) ? count : D(count)).lt(D(mobileMan381Cost))) { notify('Not enough What Happeneds — need ' + needText(mobileMan381Cost) + '.'); return; }
        count = (isDecimalInstance(count) ? count : D(count)).minus(D(mobileMan381Cost));
    } else {
        if (count < mobileMan381Cost) { notify('Not enough What Happeneds — need ' + needText(mobileMan381Cost) + '.'); return; }
        count -= mobileMan381Cost;
    }
    mobileMan381Purchased = true;
    if (hasDecimal) mobileMan38Multiplier = (isDecimalInstance(mobileMan38Multiplier) ? mobileMan38Multiplier : D(mobileMan38Multiplier)).times(D(1.5));
    else mobileMan38Multiplier *= 1.5;
    saveGame(); try { playSfx('audio/purchase.wav'); } catch (e) {} updateDisplays();
}

function buyMobileMan382() {
    if (mobileMan382Purchased) { notify('Already purchased.'); return; }
    if (numericLevel(upgrade23Level) < 25) { notify('Unlocks at Mobile Man 38 lvl 25.'); return; }
    if (hasDecimal) {
        if ((isDecimalInstance(count) ? count : D(count)).lt(D(mobileMan382Cost))) { notify('Not enough What Happeneds — need ' + needText(mobileMan382Cost) + '.'); return; }
        count = (isDecimalInstance(count) ? count : D(count)).minus(D(mobileMan382Cost));
    } else {
        if (count < mobileMan382Cost) { notify('Not enough What Happeneds — need ' + needText(mobileMan382Cost) + '.'); return; }
        count -= mobileMan382Cost;
    }
    mobileMan382Purchased = true;
    if (hasDecimal) mobileMan38Multiplier = (isDecimalInstance(mobileMan38Multiplier) ? mobileMan38Multiplier : D(mobileMan38Multiplier)).times(D(2));
    else mobileMan38Multiplier *= 2;
    saveGame(); try { playSfx('audio/purchase.wav'); } catch (e) {} updateDisplays();
}

function buyMobileMan383() {
    if (mobileMan383Purchased) { notify('Already purchased.'); return; }
    if (numericLevel(upgrade23Level) < 50) { notify('Unlocks at Mobile Man 38 lvl 50.'); return; }
    if (hasDecimal) {
        if ((isDecimalInstance(count) ? count : D(count)).lt(D(mobileMan383Cost))) { notify('Not enough What Happeneds — need ' + needText(mobileMan383Cost) + '.'); return; }
        count = (isDecimalInstance(count) ? count : D(count)).minus(D(mobileMan383Cost));
    } else {
        if (count < mobileMan383Cost) { notify('Not enough What Happeneds — need ' + needText(mobileMan383Cost) + '.'); return; }
        count -= mobileMan383Cost;
    }
    mobileMan383Purchased = true;
    if (hasDecimal) mobileMan38Multiplier = (isDecimalInstance(mobileMan38Multiplier) ? mobileMan38Multiplier : D(mobileMan38Multiplier)).times(D(2.5));
    else mobileMan38Multiplier *= 2.5;
    saveGame(); try { playSfx('audio/purchase.wav'); } catch (e) {} updateDisplays();
}

function buyMobileMan384() {
    if (mobileMan384Purchased) { notify('Already purchased.'); return; }
    if (numericLevel(upgrade23Level) < 100) { notify('Unlocks at Mobile Man 38 lvl 100.'); return; }
    if (hasDecimal) {
        if ((isDecimalInstance(count) ? count : D(count)).lt(D(mobileMan384Cost))) { notify('Not enough What Happeneds — need ' + needText(mobileMan384Cost) + '.'); return; }
        count = (isDecimalInstance(count) ? count : D(count)).minus(D(mobileMan384Cost));
    } else {
        if (count < mobileMan384Cost) { notify('Not enough What Happeneds — need ' + needText(mobileMan384Cost) + '.'); return; }
        count -= mobileMan384Cost;
    }
    mobileMan384Purchased = true;
    if (hasDecimal) mobileMan38Multiplier = (isDecimalInstance(mobileMan38Multiplier) ? mobileMan38Multiplier : D(mobileMan38Multiplier)).times(D(3));
    else mobileMan38Multiplier *= 3;
    saveGame(); try { playSfx('audio/purchase.wav'); } catch (e) {} updateDisplays();
}

// Easton Bundy special purchases (one-time multipliers applied to upgrade24 contribution)
function buyEastonBundy1() {
    if (eastonBundy1Purchased) { notify('Already purchased.'); return; }
    if (numericLevel(upgrade24Level) < 10) { notify('Unlocks at Easton Bundy level 10.'); return; }
    if (hasDecimal) {
        if ((isDecimalInstance(count) ? count : D(count)).lt(D(eastonBundy1Cost))) { notify('Not enough What Happeneds — need ' + needText(eastonBundy1Cost) + '.'); return; }
        count = (isDecimalInstance(count) ? count : D(count)).minus(D(eastonBundy1Cost));
    } else {
        if (count < eastonBundy1Cost) { notify('Not enough What Happeneds — need ' + needText(eastonBundy1Cost) + '.'); return; }
        count -= eastonBundy1Cost;
    }
    eastonBundy1Purchased = true;
    if (hasDecimal) eastonBundyMultiplier = (isDecimalInstance(eastonBundyMultiplier) ? eastonBundyMultiplier : D(eastonBundyMultiplier)).times(D(1.5));
    else eastonBundyMultiplier *= 1.5;
    saveGame(); try { playSfx('audio/purchase.wav'); } catch (e) {} updateDisplays();
}

function buyEastonBundy2() {
    if (eastonBundy2Purchased) { notify('Already purchased.'); return; }
    if (numericLevel(upgrade24Level) < 25) { notify('Unlocks at Easton Bundy level 25.'); return; }
    if (hasDecimal) {
        if ((isDecimalInstance(count) ? count : D(count)).lt(D(eastonBundy2Cost))) { notify('Not enough What Happeneds — need ' + needText(eastonBundy2Cost) + '.'); return; }
        count = (isDecimalInstance(count) ? count : D(count)).minus(D(eastonBundy2Cost));
    } else {
        if (count < eastonBundy2Cost) { notify('Not enough What Happeneds — need ' + needText(eastonBundy2Cost) + '.'); return; }
        count -= eastonBundy2Cost;
    }
    eastonBundy2Purchased = true;
    if (hasDecimal) eastonBundyMultiplier = (isDecimalInstance(eastonBundyMultiplier) ? eastonBundyMultiplier : D(eastonBundyMultiplier)).times(D(2));
    else eastonBundyMultiplier *= 2;
    saveGame(); try { playSfx('audio/purchase.wav'); } catch (e) {} updateDisplays();
}

function buyEastonBundy3() {
    if (eastonBundy3Purchased) { notify('Already purchased.'); return; }
    if (numericLevel(upgrade24Level) < 50) { notify('Unlocks at Easton Bundy level 50.'); return; }
    if (hasDecimal) {
        if ((isDecimalInstance(count) ? count : D(count)).lt(D(eastonBundy3Cost))) { notify('Not enough What Happeneds — need ' + needText(eastonBundy3Cost) + '.'); return; }
        count = (isDecimalInstance(count) ? count : D(count)).minus(D(eastonBundy3Cost));
    } else {
        if (count < eastonBundy3Cost) { notify('Not enough What Happeneds — need ' + needText(eastonBundy3Cost) + '.'); return; }
        count -= eastonBundy3Cost;
    }
    eastonBundy3Purchased = true;
    if (hasDecimal) eastonBundyMultiplier = (isDecimalInstance(eastonBundyMultiplier) ? eastonBundyMultiplier : D(eastonBundyMultiplier)).times(D(2.5));
    else eastonBundyMultiplier *= 2.5;
    saveGame(); try { playSfx('audio/purchase.wav'); } catch (e) {} updateDisplays();
}

function buyEastonBundy4() {
    if (eastonBundy4Purchased) { notify('Already purchased.'); return; }
    if (numericLevel(upgrade24Level) < 100) { notify('Unlocks at Easton Bundy level 100.'); return; }
    if (hasDecimal) {
        if ((isDecimalInstance(count) ? count : D(count)).lt(D(eastonBundy4Cost))) { notify('Not enough What Happeneds — need ' + needText(eastonBundy4Cost) + '.'); return; }
        count = (isDecimalInstance(count) ? count : D(count)).minus(D(eastonBundy4Cost));
    } else {
        if (count < eastonBundy4Cost) { notify('Not enough What Happeneds — need ' + needText(eastonBundy4Cost) + '.'); return; }
        count -= eastonBundy4Cost;
    }
    eastonBundy4Purchased = true;
    if (hasDecimal) eastonBundyMultiplier = (isDecimalInstance(eastonBundyMultiplier) ? eastonBundyMultiplier : D(eastonBundyMultiplier)).times(D(3));
    else eastonBundyMultiplier *= 3;
    saveGame(); try { playSfx('audio/purchase.wav'); } catch (e) {} updateDisplays();
}

// Ropingnecurse special purchases (one-time multipliers applied to upgrade13 contribution)
function buyRoping1() {
    if (roping1Purchased) { notify('Already purchased.'); return; }
    if (upgrade13Level < 10) { notify('Unlocks at ropingnecurse level 10.'); return; }
    if (hasDecimal) {
        if ((isDecimalInstance(count) ? count : D(count)).lt(D(roping1Cost))) { notify('Not enough What Happeneds — need ' + needText(roping1Cost) + '.'); return; }
        count = (isDecimalInstance(count) ? count : D(count)).minus(D(roping1Cost));
    } else {
        if (count < roping1Cost) { notify('Not enough What Happeneds — need ' + needText(roping1Cost) + '.'); return; }
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
    if (ez1Purchased) { notify('Already purchased.'); return; }
    if (upgrade16Level < 10) { notify('Unlocks at ez villager level 10.'); return; }
    if (hasDecimal) {
        if ((isDecimalInstance(count) ? count : D(count)).lt(D(ez1Cost))) { notify('Not enough What Happeneds — need ' + needText(ez1Cost) + '.'); return; }
        count = (isDecimalInstance(count) ? count : D(count)).minus(D(ez1Cost));
    } else {
        if (count < ez1Cost) { notify('Not enough What Happeneds — need ' + needText(ez1Cost) + '.'); return; }
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
    if (ez2Purchased) { notify('Already purchased.'); return; }
    if (upgrade16Level < 25) { notify('Unlocks at ez villager level 25.'); return; }
    if (hasDecimal) {
        if ((isDecimalInstance(count) ? count : D(count)).lt(D(ez2Cost))) { notify('Not enough What Happeneds — need ' + needText(ez2Cost) + '.'); return; }
        count = (isDecimalInstance(count) ? count : D(count)).minus(D(ez2Cost));
    } else {
        if (count < ez2Cost) { notify('Not enough What Happeneds — need ' + needText(ez2Cost) + '.'); return; }
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
    if (ez3Purchased) { notify('Already purchased.'); return; }
    if (upgrade16Level < 50) { notify('Unlocks at ez villager level 50.'); return; }
    if (hasDecimal) {
        if ((isDecimalInstance(count) ? count : D(count)).lt(D(ez3Cost))) { notify('Not enough What Happeneds — need ' + needText(ez3Cost) + '.'); return; }
        count = (isDecimalInstance(count) ? count : D(count)).minus(D(ez3Cost));
        ez3Purchased = true;
        ezOtherMultiplier = (isDecimalInstance(ezOtherMultiplier) ? ezOtherMultiplier : D(ezOtherMultiplier)).times(D(ez3Multiplier));
    } else {
        if (count < ez3Cost) { notify('Not enough What Happeneds — need ' + needText(ez3Cost) + '.'); return; }
        count -= ez3Cost;
        ez3Purchased = true;
        if (hasDecimal) ezOtherMultiplier = (isDecimalInstance(ezOtherMultiplier) ? ezOtherMultiplier : D(ezOtherMultiplier)).times(D(ez3Multiplier));
        else ezOtherMultiplier *= ez3Multiplier;
    }
    saveGame(); try { playSfx('purchase.wav'); } catch (e) {} updateDisplays();
}

function buyEz4() {
    if (ez4Purchased) { notify('Already purchased.'); return; }
    if (upgrade16Level < 100) { notify('Unlocks at ez villager level 100.'); return; }
    if (hasDecimal) {
        if ((isDecimalInstance(count) ? count : D(count)).lt(D(ez4Cost))) { notify('Not enough What Happeneds — need ' + needText(ez4Cost) + '.'); return; }
        count = (isDecimalInstance(count) ? count : D(count)).minus(D(ez4Cost));
    } else {
        if (count < ez4Cost) { notify('Not enough What Happeneds — need ' + needText(ez4Cost) + '.'); return; }
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
    if (roping2Purchased) { notify('Already purchased.'); return; }
    if (upgrade13Level < 25) { notify('Unlocks at ropingnecurse level 25.'); return; }
    if (hasDecimal) {
        if ((isDecimalInstance(count) ? count : D(count)).lt(D(roping2Cost))) { notify('Not enough What Happeneds — need ' + needText(roping2Cost) + '.'); return; }
        count = (isDecimalInstance(count) ? count : D(count)).minus(D(roping2Cost));
    } else {
        if (count < roping2Cost) { notify('Not enough What Happeneds — need ' + needText(roping2Cost) + '.'); return; }
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
    if (roping3Purchased) { notify('Already purchased.'); return; }
    if (upgrade13Level < 50) { notify('Unlocks at ropingnecurse level 50.'); return; }
    if (hasDecimal) {
        if ((isDecimalInstance(count) ? count : D(count)).lt(D(roping3Cost))) { notify('Not enough What Happeneds — need ' + needText(roping3Cost) + '.'); return; }
        count = (isDecimalInstance(count) ? count : D(count)).minus(D(roping3Cost));
    } else {
        if (count < roping3Cost) { notify('Not enough What Happeneds — need ' + needText(roping3Cost) + '.'); return; }
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
    if (roping4Purchased) { notify('Already purchased.'); return; }
    if (upgrade13Level < 75) { notify('Unlocks at ropingnecurse level 75.'); return; }
    if (hasDecimal) {
        if ((isDecimalInstance(count) ? count : D(count)).lt(D(roping4Cost))) { notify('Not enough What Happeneds — need ' + needText(roping4Cost) + '.'); return; }
        count = (isDecimalInstance(count) ? count : D(count)).minus(D(roping4Cost));
    } else {
        if (count < roping4Cost) { notify('Not enough What Happeneds — need ' + needText(roping4Cost) + '.'); return; }
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
    if (skibidi1Purchased) { notify('Already purchased.'); return; }
    if (upgrade14Level < 10) { notify('Unlocks at skibbidi scimitar level 10.'); return; }
    if (hasDecimal) {
        if ((isDecimalInstance(count) ? count : D(count)).lt(D(skibidi1Cost))) { notify('Not enough What Happeneds — need ' + needText(skibidi1Cost) + '.'); return; }
        count = (isDecimalInstance(count) ? count : D(count)).minus(D(skibidi1Cost));
    } else {
        if (count < skibidi1Cost) { notify('Not enough What Happeneds — need ' + needText(skibidi1Cost) + '.'); return; }
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
    if (skibidi2Purchased) { notify('Already purchased.'); return; }
    if (upgrade14Level < 25) { notify('Unlocks at skibbidi scimitar level 25.'); return; }
    if (hasDecimal) {
        if ((isDecimalInstance(count) ? count : D(count)).lt(D(skibidi2Cost))) { notify('Not enough What Happeneds — need ' + needText(skibidi2Cost) + '.'); return; }
        count = (isDecimalInstance(count) ? count : D(count)).minus(D(skibidi2Cost));
    } else {
        if (count < skibidi2Cost) { notify('Not enough What Happeneds — need ' + needText(skibidi2Cost) + '.'); return; }
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
    if (skibidi3Purchased) { notify('Already purchased.'); return; }
    if (upgrade14Level < 50) { notify('Unlocks at skibbidi scimitar level 50.'); return; }
    if (hasDecimal) {
        if ((isDecimalInstance(count) ? count : D(count)).lt(D(skibidi3Cost))) { notify('Not enough What Happeneds — need ' + needText(skibidi3Cost) + '.'); return; }
        count = (isDecimalInstance(count) ? count : D(count)).minus(D(skibidi3Cost));
    } else {
        if (count < skibidi3Cost) { notify('Not enough What Happeneds — need ' + needText(skibidi3Cost) + '.'); return; }
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
    if (skibidi4Purchased) { notify('Already purchased.'); return; }
    if (upgrade14Level < 75) { notify('Unlocks at skibbidi scimitar level 75.'); return; }
    if (hasDecimal) {
        if ((isDecimalInstance(count) ? count : D(count)).lt(D(skibidi4Cost))) { notify('Not enough What Happeneds — need ' + needText(skibidi4Cost) + '.'); return; }
        count = (isDecimalInstance(count) ? count : D(count)).minus(D(skibidi4Cost));
    } else {
        if (count < skibidi4Cost) { notify('Not enough What Happeneds — need ' + needText(skibidi4Cost) + '.'); return; }
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
    if (beats1Purchased) { notify('Already purchased.'); return; }
    if (upgrade15Level < 10) { notify('Unlocks at What Happened Beats level 10.'); return; }
    if (hasDecimal) {
        if ((isDecimalInstance(count) ? count : D(count)).lt(D(beats1Cost))) { notify('Not enough What Happeneds — need ' + needText(beats1Cost) + '.'); return; }
        count = (isDecimalInstance(count) ? count : D(count)).minus(D(beats1Cost));
    } else {
        if (count < beats1Cost) { notify('Not enough What Happeneds — need ' + needText(beats1Cost) + '.'); return; }
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
    if (beats2Purchased) { notify('Already purchased.'); return; }
    if (upgrade15Level < 25) { notify('Unlocks at What Happened Beats level 25.'); return; }
    if (hasDecimal) {
        if ((isDecimalInstance(count) ? count : D(count)).lt(D(beats2Cost))) { notify('Not enough What Happeneds — need ' + needText(beats2Cost) + '.'); return; }
        count = (isDecimalInstance(count) ? count : D(count)).minus(D(beats2Cost));
    } else {
        if (count < beats2Cost) { notify('Not enough What Happeneds — need ' + needText(beats2Cost) + '.'); return; }
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
    if (beats3Purchased) { notify('Already purchased.'); return; }
    if (upgrade15Level < 50) { notify('Unlocks at What Happened Beats level 50.'); return; }
    if (hasDecimal) {
        if ((isDecimalInstance(count) ? count : D(count)).lt(D(beats3Cost))) { notify('Not enough What Happeneds — need ' + needText(beats3Cost) + '.'); return; }
        count = (isDecimalInstance(count) ? count : D(count)).minus(D(beats3Cost));
        beats3Purchased = true;
        beatsOtherMultiplier = (isDecimalInstance(beatsOtherMultiplier) ? beatsOtherMultiplier : D(beatsOtherMultiplier)).times(D(beats3Multiplier));
    } else {
        if (count < beats3Cost) { notify('Not enough What Happeneds — need ' + needText(beats3Cost) + '.'); return; }
        count -= beats3Cost;
        beats3Purchased = true;
        if (hasDecimal) beatsOtherMultiplier = (isDecimalInstance(beatsOtherMultiplier) ? beatsOtherMultiplier : D(beatsOtherMultiplier)).times(D(beats3Multiplier));
        else beatsOtherMultiplier *= beats3Multiplier;
    }
    saveGame(); try { playSfx('purchase.wav'); } catch (e) {} updateDisplays();
}

function buyDivineArgon() {
    if (goldenWhat < divineArgonCost) {
        notify('Not enough Golden What Happeneds — need ' + divineArgonCost + '.');
        return;
    }
    // spend golden currency
    goldenWhat -= divineArgonCost;
    divineArgonLevel += 1;
    // next cost multiplies by 3
    divineArgonCost = divineCostFor('argon', divineArgonLevel);
    saveGame();
    updateDisplays();
    try { updateShopUI(); } catch (e) {}
}

function buyDivineSomalian() {
    if (goldenWhat < divineSomalianCost) {
        notify('Not enough Golden What Happeneds — need ' + divineSomalianCost + '.');
        return;
    }
    // spend golden currency
    goldenWhat -= divineSomalianCost;
    divineSomalianLevel += 1;
    // next cost multiplies by 3
    divineSomalianCost = divineCostFor('somalian', divineSomalianLevel);
    saveGame();
    updateDisplays();
}

function buyDivineAssassin() {
    // enforce max level cap
    if (typeof divineAssassinLevel === 'number' && divineAssassinLevel >= 19) {
        notify('Divine Assassin is already at max level (19).');
        return;
    }
    if (goldenWhat < divineAssassinCost) {
        notify('Not enough Golden What Happeneds — need ' + divineAssassinCost + '.');
        return;
    }
    goldenWhat -= divineAssassinCost;
    divineAssassinLevel = (typeof divineAssassinLevel === 'number' ? divineAssassinLevel : 0) + 1;
    // cost doubles each purchase
    divineAssassinCost = divineCostFor('assassin', divineAssassinLevel);
    saveGame();
    updateDisplays();
}

function buyDivineCollector() {
    if (typeof divineCollectorCost === 'undefined') divineCollectorCost = 1;
    if (goldenWhat < divineCollectorCost) {
        notify('Not enough Golden What Happeneds — need ' + divineCollectorCost + '.');
        return;
    }
    goldenWhat -= divineCollectorCost;
    divineCollectorLevel += 1;
    // cost doubles each purchase
    divineCollectorCost = divineCostFor('collector', divineCollectorLevel);
    saveGame();
    updateDisplays();
}

function buyDivineMoneyMan() {
    if (typeof divineMoneyManCost === 'undefined') divineMoneyManCost = 1;
    if (goldenWhat < divineMoneyManCost) {
        notify('Not enough Golden What Happeneds — need ' + divineMoneyManCost + '.');
        return;
    }
    goldenWhat -= divineMoneyManCost;
    divineMoneyManLevel += 1;
    // cost progression: first -> 1, next -> 2, after that -> prev*2 - 1
    divineMoneyManCost = divineCostFor('moneyMan', divineMoneyManLevel);
    saveGame();
    updateDisplays();
}

function buyDivineSpirit() {
    try {
        console.log('Attempting buyDivineSpirit', { goldenWhat, divineSpiritCost, hasDecimal });
        if (typeof divineSpiritCost === 'undefined') divineSpiritCost = (hasDecimal ? D(1) : 1);
        if (!goldenCanAfford(divineSpiritCost)) {
            console.warn('buyDivineSpirit: insufficient golden', { goldenWhat, cost: divineSpiritCost });
            notify('Not enough Golden What Happeneds — need ' + (typeof divineSpiritCost === 'object' && typeof divineSpiritCost.toString === 'function' ? divineSpiritCost.toString() : String(divineSpiritCost)) + '.');
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
        notify('Something went wrong buying Divine Spirit. Try again.');
    }
}

function buyDivineSimpleVillager() {
    if (typeof divineSimpleVillagerCost === 'undefined') divineSimpleVillagerCost = 1;
    if (goldenWhat < divineSimpleVillagerCost) {
        notify('Not enough Golden What Happeneds — need ' + divineSimpleVillagerCost + '.');
        return;
    }
    // spend golden and increase level
    goldenWhat -= divineSimpleVillagerCost;
    divineSimpleVillagerLevel = (typeof divineSimpleVillagerLevel === 'number' ? divineSimpleVillagerLevel : 0) + 1;
    // the discount itself is applied by getSimpleVillagerMultiplier() when prices are shown/charged;
    // stored costs are not reduced here (doing both applied the discount twice)
    divineSimpleVillagerCost = divineCostFor('villager', divineSimpleVillagerLevel);
    saveGame(); try { playSfx('purchase.wav'); } catch (e) {} updateDisplays();
}

function buySpecial1() {
    if (special1Purchased) return;
    if (upgrade1Level < 10) { notify('Unlocks at OP mouse level 10.'); return; }
    if (hasDecimal) {
        if ((isDecimalInstance(count) ? count : D(count)).gte(D(special1Cost))) {
            count = (isDecimalInstance(count) ? count : D(count)).minus(D(special1Cost));
            clickMultiplier = (isDecimalInstance(clickMultiplier) ? clickMultiplier : D(clickMultiplier)).times(D(special1Multiplier));
            special1Purchased = true;
            updateDisplays();
        } else notify('Not enough What Happeneds — need ' + needText(special1Cost) + '.');
    } else {
        if (count >= special1Cost) {
            count -= special1Cost;
            if (hasDecimal) clickMultiplier = (isDecimalInstance(clickMultiplier) ? clickMultiplier : D(clickMultiplier)).times(D(special1Multiplier));
            else clickMultiplier *= special1Multiplier;
            special1Purchased = true;
            updateDisplays();
        } else notify('Not enough What Happeneds — need ' + needText(special1Cost) + '.');
    }
}

function buySpecial2() {
    if (special2Purchased) return;
    if (upgrade1Level < 25) { notify('Unlocks at OP mouse level 25.'); return; }
    if (hasDecimal) {
        if ((isDecimalInstance(count) ? count : D(count)).gte(D(special2Cost))) {
            count = (isDecimalInstance(count) ? count : D(count)).minus(D(special2Cost));
            clickMultiplier = (isDecimalInstance(clickMultiplier) ? clickMultiplier : D(clickMultiplier)).times(D(special2Multiplier));
            special2Purchased = true;
            updateDisplays();
        } else notify('Not enough What Happeneds — need ' + needText(special2Cost) + '.');
    } else {
        if (count >= special2Cost) {
            count -= special2Cost;
            if (hasDecimal) clickMultiplier = (isDecimalInstance(clickMultiplier) ? clickMultiplier : D(clickMultiplier)).times(D(special2Multiplier));
            else clickMultiplier *= special2Multiplier;
            special2Purchased = true;
            updateDisplays();
        } else notify('Not enough What Happeneds — need ' + needText(special2Cost) + '.');
    }
}

function buySpecial3() {
    if (special3Purchased) return;
    if (upgrade1Level < 50) { notify('Unlocks at OP mouse level 50.'); return; }
    if (hasDecimal) {
        if ((isDecimalInstance(count) ? count : D(count)).gte(D(special3Cost))) {
            count = (isDecimalInstance(count) ? count : D(count)).minus(D(special3Cost));
            clickMultiplier = (isDecimalInstance(clickMultiplier) ? clickMultiplier : D(clickMultiplier)).times(D(special3Multiplier));
            special3Purchased = true;
            updateDisplays();
        } else notify('Not enough What Happeneds — need ' + needText(special3Cost) + '.');
    } else {
        if (count >= special3Cost) {
            count -= special3Cost;
            if (hasDecimal) clickMultiplier = (isDecimalInstance(clickMultiplier) ? clickMultiplier : D(clickMultiplier)).times(D(special3Multiplier));
            else clickMultiplier *= special3Multiplier;
            special3Purchased = true;
            updateDisplays();
        } else notify('Not enough What Happeneds — need ' + needText(special3Cost) + '.');
    }
}

function buySpecial4() {
    if (special4Purchased) return;
    if (upgrade1Level < 100) { notify('Unlocks at OP mouse level 100.'); return; }
    if (hasDecimal) {
        if ((isDecimalInstance(count) ? count : D(count)).gte(D(special4Cost))) {
            count = (isDecimalInstance(count) ? count : D(count)).minus(D(special4Cost));
            clickMultiplier = (isDecimalInstance(clickMultiplier) ? clickMultiplier : D(clickMultiplier)).times(D(special4Multiplier));
            special4Purchased = true;
            updateDisplays();
        } else notify('Not enough What Happeneds — need ' + needText(special4Cost) + '.');
    } else {
        if (count >= special4Cost) {
            count -= special4Cost;
            if (hasDecimal) clickMultiplier = (isDecimalInstance(clickMultiplier) ? clickMultiplier : D(clickMultiplier)).times(D(special4Multiplier));
            else clickMultiplier *= special4Multiplier;
            special4Purchased = true;
            updateDisplays();
        } else notify('Not enough What Happeneds — need ' + needText(special4Cost) + '.');
    }
}

function buySpecial5() {
    if (special5Purchased) return;
    if (upgrade1Level < 150) { notify('Unlocks at OP mouse level 150.'); return; }
    if (hasDecimal) {
        if ((isDecimalInstance(count) ? count : D(count)).gte(D(special5Cost))) {
            count = (isDecimalInstance(count) ? count : D(count)).minus(D(special5Cost));
            clickMultiplier = (isDecimalInstance(clickMultiplier) ? clickMultiplier : D(clickMultiplier)).times(D(special5Multiplier));
            special5Purchased = true;
            updateDisplays();
        } else notify('Not enough What Happeneds — need ' + needText(special5Cost) + '.');
    } else {
        if (count >= special5Cost) {
            count -= special5Cost;
            if (hasDecimal) clickMultiplier = (isDecimalInstance(clickMultiplier) ? clickMultiplier : D(clickMultiplier)).times(D(special5Multiplier));
            else clickMultiplier *= special5Multiplier;
            special5Purchased = true;
            updateDisplays();
        } else notify('Not enough What Happeneds — need ' + needText(special5Cost) + '.');
    }
}

function buySpecial6() {
    if (special6Purchased) return;
    if (upgrade1Level < 200) { notify('Unlocks at OP mouse level 200.'); return; }
    if (hasDecimal) {
        if ((isDecimalInstance(count) ? count : D(count)).gte(D(special6Cost))) {
            count = (isDecimalInstance(count) ? count : D(count)).minus(D(special6Cost));
            clickMultiplier = (isDecimalInstance(clickMultiplier) ? clickMultiplier : D(clickMultiplier)).times(D(special6Multiplier));
            special6Purchased = true;
            updateDisplays();
        } else { notify('Not enough What Happeneds — need ' + needText(special6Cost) + '.'); }
    } else { if (count >= special6Cost) { count -= special6Cost; if (hasDecimal) clickMultiplier = (isDecimalInstance(clickMultiplier) ? clickMultiplier : D(clickMultiplier)).times(D(special6Multiplier)); else clickMultiplier *= special6Multiplier; special6Purchased = true; updateDisplays(); } else { notify('Not enough What Happeneds — need ' + needText(special6Cost) + '.'); } }
}

function buySpecial7() {
    if (special7Purchased) return;
    if (upgrade1Level < 250) { notify('Unlocks at OP mouse level 250.'); return; }
    if (hasDecimal) {
        if ((isDecimalInstance(count) ? count : D(count)).gte(D(special7Cost))) {
            count = (isDecimalInstance(count) ? count : D(count)).minus(D(special7Cost));
            clickMultiplier = (isDecimalInstance(clickMultiplier) ? clickMultiplier : D(clickMultiplier)).times(D(special7Multiplier));
            special7Purchased = true;
            updateDisplays();
        } else { notify('Not enough What Happeneds — need ' + needText(special7Cost) + '.'); }
    } else { if (count >= special7Cost) { count -= special7Cost; if (hasDecimal) clickMultiplier = (isDecimalInstance(clickMultiplier) ? clickMultiplier : D(clickMultiplier)).times(D(special7Multiplier)); else clickMultiplier *= special7Multiplier; special7Purchased = true; updateDisplays(); } else { notify('Not enough What Happeneds — need ' + needText(special7Cost) + '.'); } }
}

function buySpecial8() {
    if (special8Purchased) return;
    if (upgrade1Level < 300) { notify('Unlocks at OP mouse level 300.'); return; }
    if (hasDecimal) {
        if ((isDecimalInstance(count) ? count : D(count)).gte(D(special8Cost))) {
            count = (isDecimalInstance(count) ? count : D(count)).minus(D(special8Cost));
            clickMultiplier = (isDecimalInstance(clickMultiplier) ? clickMultiplier : D(clickMultiplier)).times(D(special8Multiplier));
            special8Purchased = true;
            updateDisplays();
        } else { notify('Not enough What Happeneds — need ' + needText(special8Cost) + '.'); }
    } else { if (count >= special8Cost) { count -= special8Cost; if (hasDecimal) clickMultiplier = (isDecimalInstance(clickMultiplier) ? clickMultiplier : D(clickMultiplier)).times(D(special8Multiplier)); else clickMultiplier *= special8Multiplier; special8Purchased = true; updateDisplays(); } else { notify('Not enough What Happeneds — need ' + needText(special8Cost) + '.'); } }
}

function buyJonathan1() {
    if (jonathan1Purchased) return;
    if (upgrade11Level < 10) { notify('Unlocks at Jonathan lvl 10.'); return; }
    if (hasDecimal) {
        if ((isDecimalInstance(count) ? count : D(count)).gte(D(jonathan1Cost))) {
            count = (isDecimalInstance(count) ? count : D(count)).minus(D(jonathan1Cost));
            jonathanOtherMultiplier = (isDecimalInstance(jonathanOtherMultiplier) ? jonathanOtherMultiplier : D(jonathanOtherMultiplier)).times(D(jonathan1Multiplier));
            jonathan1Purchased = true;
            updateDisplays();
        } else { notify('Not enough What Happeneds — need ' + needText(jonathan1Cost) + '.'); }
    } else {
        if (count >= jonathan1Cost) {
            count -= jonathan1Cost;
            if (hasDecimal) jonathanOtherMultiplier = (isDecimalInstance(jonathanOtherMultiplier) ? jonathanOtherMultiplier : D(jonathanOtherMultiplier)).times(D(jonathan1Multiplier));
            else jonathanOtherMultiplier *= jonathan1Multiplier;
            jonathan1Purchased = true;
            updateDisplays();
        } else { notify('Not enough What Happeneds — need ' + needText(jonathan1Cost) + '.'); }
    }
}

function buyJonathan2() {
    if (jonathan2Purchased) return;
    if (upgrade11Level < 25) { notify('Unlocks at Jonathan lvl 25.'); return; }
    if (hasDecimal) {
        if ((isDecimalInstance(count) ? count : D(count)).gte(D(jonathan2Cost))) {
            count = (isDecimalInstance(count) ? count : D(count)).minus(D(jonathan2Cost));
            jonathanOtherMultiplier = (isDecimalInstance(jonathanOtherMultiplier) ? jonathanOtherMultiplier : D(jonathanOtherMultiplier)).times(D(jonathan2Multiplier));
            jonathan2Purchased = true;
            updateDisplays();
        } else { notify('Not enough What Happeneds — need ' + needText(jonathan2Cost) + '.'); }
    } else {
        if (count >= jonathan2Cost) {
            count -= jonathan2Cost;
            if (hasDecimal) jonathanOtherMultiplier = (isDecimalInstance(jonathanOtherMultiplier) ? jonathanOtherMultiplier : D(jonathanOtherMultiplier)).times(D(jonathan2Multiplier));
            else jonathanOtherMultiplier *= jonathan2Multiplier;
            jonathan2Purchased = true;
            updateDisplays();
        } else { notify('Not enough What Happeneds — need ' + needText(jonathan2Cost) + '.'); }
    }
}

function buyJonathan3() {
    if (jonathan3Purchased) return;
    if (upgrade11Level < 50) { notify('Unlocks at Jonathan lvl 50.'); return; }
    if (hasDecimal) {
        if ((isDecimalInstance(count) ? count : D(count)).gte(D(jonathan3Cost))) {
            count = (isDecimalInstance(count) ? count : D(count)).minus(D(jonathan3Cost));
            clickMultiplier = (isDecimalInstance(clickMultiplier) ? clickMultiplier : D(clickMultiplier)).times(D(jonathan3Multiplier));
            jonathan3Purchased = true;
            updateDisplays();
        } else { notify('Not enough What Happeneds — need ' + needText(jonathan3Cost) + '.'); }
    } else {
        if (count >= jonathan3Cost) {
            count -= jonathan3Cost;
            if (hasDecimal) clickMultiplier = (isDecimalInstance(clickMultiplier) ? clickMultiplier : D(clickMultiplier)).times(D(jonathan3Multiplier));
            else clickMultiplier *= jonathan3Multiplier;
            jonathan3Purchased = true;
            updateDisplays();
        } else { notify('Not enough What Happeneds — need ' + needText(jonathan3Cost) + '.'); }
    }
}

function buyJonathan4() {
    if (jonathan4Purchased) return;
    if (upgrade11Level < 75) { notify('Unlocks at Jonathan lvl 75.'); return; }
    if (hasDecimal) {
        if ((isDecimalInstance(count) ? count : D(count)).gte(D(jonathan4Cost))) {
            count = (isDecimalInstance(count) ? count : D(count)).minus(D(jonathan4Cost));
            jonathanOtherMultiplier = (isDecimalInstance(jonathanOtherMultiplier) ? jonathanOtherMultiplier : D(jonathanOtherMultiplier)).times(D(jonathan4Multiplier));
            jonathan4Purchased = true;
            updateDisplays();
        } else { notify('Not enough What Happeneds — need ' + needText(jonathan4Cost) + '.'); }
    } else {
        if (count >= jonathan4Cost) {
            count -= jonathan4Cost;
            if (hasDecimal) jonathanOtherMultiplier = (isDecimalInstance(jonathanOtherMultiplier) ? jonathanOtherMultiplier : D(jonathanOtherMultiplier)).times(D(jonathan4Multiplier));
            else jonathanOtherMultiplier *= jonathan4Multiplier;
            jonathan4Purchased = true;
            updateDisplays();
        } else { notify('Not enough What Happeneds — need ' + needText(jonathan4Cost) + '.'); }
    }
}

function buyCr1() {
    if (cr1Purchased) return;
    if (numericLevel(upgrade12Level) < 10) { notify('Unlocks at CR lvl 10.'); return; }
    if (count >= cr1Cost) {
        count -= cr1Cost;
        if (hasDecimal) crOtherMultiplier = (isDecimalInstance(crOtherMultiplier) ? crOtherMultiplier : D(crOtherMultiplier)).times(D(cr1Multiplier));
        else crOtherMultiplier *= cr1Multiplier;
        cr1Purchased = true;
        saveGame(); try { playSfx('purchase.wav'); } catch (e) {} updateDisplays();
    } else { notify('Not enough What Happeneds — need ' + needText(cr1Cost) + '.'); }
}

function buyCr2() {
    if (cr2Purchased) return;
    if (numericLevel(upgrade12Level) < 25) { notify('Unlocks at CR lvl 25.'); return; }
    if (count >= cr2Cost) {
        count -= cr2Cost;
        if (hasDecimal) crOtherMultiplier = (isDecimalInstance(crOtherMultiplier) ? crOtherMultiplier : D(crOtherMultiplier)).times(D(cr2Multiplier));
        else crOtherMultiplier *= cr2Multiplier;
        cr2Purchased = true;
        saveGame(); try { playSfx('purchase.wav'); } catch (e) {} updateDisplays();
    } else { notify('Not enough What Happeneds — need ' + needText(cr2Cost) + '.'); }
}

function buyCr3() {
    if (cr3Purchased) return;
    if (numericLevel(upgrade12Level) < 50) { notify('Unlocks at CR lvl 50.'); return; }
    if (count >= cr3Cost) {
        count -= cr3Cost;
        if (hasDecimal) clickMultiplier = (isDecimalInstance(clickMultiplier) ? clickMultiplier : D(clickMultiplier)).times(D(cr3Multiplier));
        else clickMultiplier *= cr3Multiplier;
        cr3Purchased = true;
        saveGame(); try { playSfx('purchase.wav'); } catch (e) {} updateDisplays();
    } else { notify('Not enough What Happeneds — need ' + needText(cr3Cost) + '.'); }
}

function buyCr4() {
    if (cr4Purchased) return;
    if (numericLevel(upgrade12Level) < 75) { notify('Unlocks at CR lvl 75.'); return; }
    if (count >= cr4Cost) {
        count -= cr4Cost;
        if (hasDecimal) crOtherMultiplier = (isDecimalInstance(crOtherMultiplier) ? crOtherMultiplier : D(crOtherMultiplier)).times(D(cr4Multiplier));
        else crOtherMultiplier *= cr4Multiplier;
        cr4Purchased = true;
        saveGame(); try { playSfx('purchase.wav'); } catch (e) {} updateDisplays();
    } else { notify('Not enough What Happeneds — need ' + needText(cr4Cost) + '.'); }
}

function buyCr5() {
    if (cr5Purchased) return;
    if (numericLevel(upgrade12Level) < 100) { notify('Unlocks at CR lvl 100.'); return; }
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
    } else { notify('Not enough What Happeneds — need ' + needText(cr5Cost) + '.'); }
}

// Prestige / golden claim handler
// Sum of levels across all 24 normal upgrades (what prestige awards are based on)
function getTotalUpgradeLevels() {
    let total = 0;
    for (let i = 1; i <= 24; i++) {
        try { total += numericLevel(getUpgradeLevel(i)); } catch (e) { }
    }
    return total;
}
// Compute how many golden awards the player would receive if they prestiged now
function getPotentialPrestigeAwards() {
    try {
        let awards = Math.floor(getTotalUpgradeLevels() / LEVELS_PER_GOLDEN);
        if (typeof divineCollectorLevel !== 'undefined' && divineCollectorLevel > 0) {
            awards = Math.floor(awards * (1 + DIVINE_COLLECTOR_PER_LEVEL * divineCollectorLevel));
        }
        // Followers: Void followers give extra Golden from prestige
        const fGolden = getFollowerBonuses().golden || 0;
        if (fGolden > 0) awards = Math.floor(awards * (1 + fGolden / 100));
        return awards;
    } catch (e) { return 0; }
}

function buyPrestige() {
    if (numericLevel(upgrade12Level) < 150) { notify('Prestige unlocks when CR lurker reaches level 150.'); return; }

    // awards are based on the total combined levels of all normal upgrades
    const totalLevels = getTotalUpgradeLevels();
    const awards = Math.floor(totalLevels / LEVELS_PER_GOLDEN);
    if (awards === 0) {
        notify(`You need at least ${LEVELS_PER_GOLDEN} total upgrade levels per Golden. You have ${totalLevels}.`);
        return;
    }

    // apply Divine Collector bonus to awards (+25% per level)
    const finalAwards = getPotentialPrestigeAwards();

    if (!confirm(`Gain ${finalAwards} Golden What Happeneds for ${totalLevels} upgrade levels? This will reset your progress.`)) return;

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
            shopPlatinumPurchased, shopDivineWHPurchased, shopWHVrillPurchased, shopWHNaturePurchased, shopVoidWHPurchased, shopFireWHPurchased, shopIceWHPurchased, shopWHhackerPurchased, shopWHchadPurchased, shopWHbreadPurchased, shopWHlightningPurchased, shopSilverPurchased, shopGoldPurchased,
            shopMobileManPurchased, shopCasinoDealerPurchased,
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
        // keep casino state written by gamba.js (daily spin + active buff, win count); dropping it let players re-spin the same day
        try {
            const existing = JSON.parse(localStorage.getItem(SAVE_KEY) || localStorage.getItem(SAVE_KEY_LEGACY) || '{}') || {};
            if (existing.casinoSpin && typeof existing.casinoSpin === 'object') prestigeSave.casinoSpin = existing.casinoSpin;
            if (existing.casino_total_wins) prestigeSave.casino_total_wins = existing.casino_total_wins;
            if (existing.shopCasinoDealerPurchased) prestigeSave.shopCasinoDealerPurchased = true;
        } catch (e) {}
        localStorage.setItem(SAVE_KEY, JSON.stringify(prestigeSave));
        try { localStorage.setItem(SAVE_KEY_LEGACY, JSON.stringify(prestigeSave)); } catch (e) {}
        try { localStorage.setItem('whathappened_prestige_times', String(prestigeTimes || 0)); } catch (e) {}
        try { localStorage.setItem('whathappened_total_golden', String(totalGoldenEver || 0)); } catch (e) {}
        try { localStorage.setItem('whathappened_clicks_since_prestige', '0'); } catch (e) {}
        try { localStorage.setItem('whathappened_last_prestige_ts', String(Date.now())); } catch (e) {}
    } catch (e) { console.error('Failed to persist prestige', e); }
    // reload to perform a full reset (load will pick up golden keys)
    setTimeout(() => location.reload(), 100);
}

// Pirate special purchase handlers
function buyPirate1() {
    if (pirateSpec1Purchased) return;
    if (upgrade2Level < 10) { notify('Unlocks at Somalian Pirate level 10.'); return; }
    if (hasDecimal) {
        if ((isDecimalInstance(count) ? count : D(count)).gte(D(pirateSpec1Cost))) {
            count = (isDecimalInstance(count) ? count : D(count)).minus(D(pirateSpec1Cost));
            pirateMultiplier = (isDecimalInstance(pirateMultiplier) ? pirateMultiplier : D(pirateMultiplier)).times(D(pirateSpec1Multiplier));
            pirateSpec1Purchased = true;
            updateDisplays();
        } else { notify('Not enough What Happeneds — need ' + needText(pirateSpec1Cost) + '.'); }
    } else {
        if (count >= pirateSpec1Cost) {
            count -= pirateSpec1Cost;
            if (hasDecimal) pirateMultiplier = (isDecimalInstance(pirateMultiplier) ? pirateMultiplier : D(pirateMultiplier)).times(D(pirateSpec1Multiplier));
            else pirateMultiplier *= pirateSpec1Multiplier;
            pirateSpec1Purchased = true;
            updateDisplays();
        } else { notify('Not enough What Happeneds — need ' + needText(pirateSpec1Cost) + '.'); }
    }
}

function buyPirate2() {
    if (pirateSpec2Purchased) return;
    if (upgrade2Level < 25) { notify('Unlocks at Somalian Pirate level 25.'); return; }
    if (hasDecimal) {
        if ((isDecimalInstance(count) ? count : D(count)).gte(D(pirateSpec2Cost))) {
            count = (isDecimalInstance(count) ? count : D(count)).minus(D(pirateSpec2Cost));
            pirateMultiplier = (isDecimalInstance(pirateMultiplier) ? pirateMultiplier : D(pirateMultiplier)).times(D(pirateSpec2Multiplier));
            pirateSpec2Purchased = true;
            updateDisplays();
        } else { notify('Not enough What Happeneds — need ' + needText(pirateSpec2Cost) + '.'); }
    } else {
        if (count >= pirateSpec2Cost) {
            count -= pirateSpec2Cost;
            if (hasDecimal) pirateMultiplier = (isDecimalInstance(pirateMultiplier) ? pirateMultiplier : D(pirateMultiplier)).times(D(pirateSpec2Multiplier));
            else pirateMultiplier *= pirateSpec2Multiplier;
            pirateSpec2Purchased = true;
            updateDisplays();
        } else { notify('Not enough What Happeneds — need ' + needText(pirateSpec2Cost) + '.'); }
    }
}

function buyPirate3() {
    if (pirateSpec3Purchased) return;
    if (upgrade2Level < 50) { notify('Unlocks at Somalian Pirate level 50.'); return; }
    if (hasDecimal) {
        if ((isDecimalInstance(count) ? count : D(count)).gte(D(pirateSpec3Cost))) {
            count = (isDecimalInstance(count) ? count : D(count)).minus(D(pirateSpec3Cost));
            pirateMultiplier = (isDecimalInstance(pirateMultiplier) ? pirateMultiplier : D(pirateMultiplier)).times(D(pirateSpec3Multiplier));
            pirateSpec3Purchased = true;
            updateDisplays();
        } else { notify('Not enough What Happeneds — need ' + needText(pirateSpec3Cost) + '.'); }
    } else {
        if (count >= pirateSpec3Cost) {
            count -= pirateSpec3Cost;
            if (hasDecimal) pirateMultiplier = (isDecimalInstance(pirateMultiplier) ? pirateMultiplier : D(pirateMultiplier)).times(D(pirateSpec3Multiplier));
            else pirateMultiplier *= pirateSpec3Multiplier;
            pirateSpec3Purchased = true;
            updateDisplays();
        } else { notify('Not enough What Happeneds — need ' + needText(pirateSpec3Cost) + '.'); }
    }
}

function buyPirate4() {
    if (pirateSpec4Purchased) return;
    if (upgrade2Level < 100) { notify('Unlocks at Somalian Pirate level 100.'); return; }
    if (hasDecimal) {
        if ((isDecimalInstance(count) ? count : D(count)).gte(D(pirateSpec4Cost))) {
            count = (isDecimalInstance(count) ? count : D(count)).minus(D(pirateSpec4Cost));
            pirateMultiplier = (isDecimalInstance(pirateMultiplier) ? pirateMultiplier : D(pirateMultiplier)).times(D(pirateSpec4Multiplier));
            pirateSpec4Purchased = true;
            updateDisplays();
        } else { notify('Not enough What Happeneds — need ' + needText(pirateSpec4Cost) + '.'); }
    } else {
        if (count >= pirateSpec4Cost) {
            count -= pirateSpec4Cost;
            if (hasDecimal) pirateMultiplier = (isDecimalInstance(pirateMultiplier) ? pirateMultiplier : D(pirateMultiplier)).times(D(pirateSpec4Multiplier));
            else pirateMultiplier *= pirateSpec4Multiplier;
            pirateSpec4Purchased = true;
            updateDisplays();
        } else { notify('Not enough What Happeneds — need ' + needText(pirateSpec4Cost) + '.'); }
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
    if (upgrade3Level < 10) { notify('Unlocks at Goonsaw level 10.'); return; }
    if (hasDecimal) {
        if ((isDecimalInstance(count) ? count : D(count)).gte(D(goonSpec1Cost))) {
            count = (isDecimalInstance(count) ? count : D(count)).minus(D(goonSpec1Cost));
            goonMultiplier = (isDecimalInstance(goonMultiplier) ? goonMultiplier : D(goonMultiplier)).times(D(goonSpec1Multiplier));
            goonSpec1Purchased = true;
            updateDisplays();
        } else { notify('Not enough What Happeneds — need ' + needText(goonSpec1Cost) + '.'); }
    } else {
        if (count >= goonSpec1Cost) {
            count -= goonSpec1Cost;
            if (hasDecimal) goonMultiplier = (isDecimalInstance(goonMultiplier) ? goonMultiplier : D(goonMultiplier)).times(D(goonSpec1Multiplier));
            else goonMultiplier *= goonSpec1Multiplier;
            goonSpec1Purchased = true;
            updateDisplays();
        } else { notify('Not enough What Happeneds — need ' + needText(goonSpec1Cost) + '.'); }
    }
}

function buyGoon2() {
    if (goonSpec2Purchased) return;
    if (upgrade3Level < 25) { notify('Unlocks at Goonsaw level 25.'); return; }
    if (hasDecimal) {
        if ((isDecimalInstance(count) ? count : D(count)).gte(D(goonSpec2Cost))) {
            count = (isDecimalInstance(count) ? count : D(count)).minus(D(goonSpec2Cost));
            goonMultiplier = (isDecimalInstance(goonMultiplier) ? goonMultiplier : D(goonMultiplier)).times(D(goonSpec2Multiplier));
            goonSpec2Purchased = true;
            updateDisplays();
        } else { notify('Not enough What Happeneds — need ' + needText(goonSpec2Cost) + '.'); }
    } else {
        if (count >= goonSpec2Cost) {
            count -= goonSpec2Cost;
            if (hasDecimal) goonMultiplier = (isDecimalInstance(goonMultiplier) ? goonMultiplier : D(goonMultiplier)).times(D(goonSpec2Multiplier));
            else goonMultiplier *= goonSpec2Multiplier;
            goonSpec2Purchased = true;
            updateDisplays();
        } else { notify('Not enough What Happeneds — need ' + needText(goonSpec2Cost) + '.'); }
    }
}

function buyGoon3() {
    if (goonSpec3Purchased) return;
    if (upgrade3Level < 50) { notify('Unlocks at Goonsaw level 50.'); return; }
    if (hasDecimal) {
        if ((isDecimalInstance(count) ? count : D(count)).gte(D(goonSpec3Cost))) {
            count = (isDecimalInstance(count) ? count : D(count)).minus(D(goonSpec3Cost));
            goonMultiplier = (isDecimalInstance(goonMultiplier) ? goonMultiplier : D(goonMultiplier)).times(D(goonSpec3Multiplier));
            goonSpec3Purchased = true;
            updateDisplays();
        } else { notify('Not enough What Happeneds — need ' + needText(goonSpec3Cost) + '.'); }
    } else {
        if (count >= goonSpec3Cost) {
            count -= goonSpec3Cost;
            if (hasDecimal) goonMultiplier = (isDecimalInstance(goonMultiplier) ? goonMultiplier : D(goonMultiplier)).times(D(goonSpec3Multiplier));
            else goonMultiplier *= goonSpec3Multiplier;
            goonSpec3Purchased = true;
            updateDisplays();
        } else { notify('Not enough What Happeneds — need ' + needText(goonSpec3Cost) + '.'); }
    }
}

function buyGoon4() {
    if (goonSpec4Purchased) return;
    if (upgrade3Level < 100) { notify('Unlocks at Goonsaw level 100.'); return; }
    if (hasDecimal) {
        if ((isDecimalInstance(count) ? count : D(count)).gte(D(goonSpec4Cost))) {
            count = (isDecimalInstance(count) ? count : D(count)).minus(D(goonSpec4Cost));
            goonMultiplier = (isDecimalInstance(goonMultiplier) ? goonMultiplier : D(goonMultiplier)).times(D(goonSpec4Multiplier));
            goonSpec4Purchased = true;
            updateDisplays();
        } else { notify('Not enough What Happeneds — need ' + needText(goonSpec4Cost) + '.'); }
    } else {
        if (count >= goonSpec4Cost) {
            count -= goonSpec4Cost;
            if (hasDecimal) goonMultiplier = (isDecimalInstance(goonMultiplier) ? goonMultiplier : D(goonMultiplier)).times(D(goonSpec4Multiplier));
            else goonMultiplier *= goonSpec4Multiplier;
            goonSpec4Purchased = true;
            updateDisplays();
        } else { notify('Not enough What Happeneds — need ' + needText(goonSpec4Cost) + '.'); }
    }
}

// The Goatis purchase handlers
function buyGoatis1() {
    if (goatis1Purchased) return;
    if (upgrade18Level < 10) { notify('Unlocks at The Goatis level 10.'); return; }
    if (hasDecimal) {
        if ((isDecimalInstance(count) ? count : D(count)).gte(D(goatis1Cost))) {
            count = (isDecimalInstance(count) ? count : D(count)).minus(D(goatis1Cost));
            goatisMultiplier = (isDecimalInstance(goatisMultiplier) ? goatisMultiplier : D(goatisMultiplier)).times(D(goatis1Multiplier));
            goatis1Purchased = true;
            updateDisplays();
        } else { notify('Not enough What Happeneds — need ' + needText(goatis1Cost) + '.'); }
    } else {
        if (count >= goatis1Cost) {
            count -= goatis1Cost;
            if (hasDecimal) goatisMultiplier = (isDecimalInstance(goatisMultiplier) ? goatisMultiplier : D(goatisMultiplier)).times(D(goatis1Multiplier));
            else goatisMultiplier *= goatis1Multiplier;
            goatis1Purchased = true;
            updateDisplays();
        } else { notify('Not enough What Happeneds — need ' + needText(goatis1Cost) + '.'); }
    }
}

function buyGoatis2() {
    if (goatis2Purchased) return;
    if (upgrade18Level < 25) { notify('Unlocks at The Goatis level 25.'); return; }
    if (hasDecimal) {
        if ((isDecimalInstance(count) ? count : D(count)).gte(D(goatis2Cost))) {
            count = (isDecimalInstance(count) ? count : D(count)).minus(D(goatis2Cost));
            goatisMultiplier = (isDecimalInstance(goatisMultiplier) ? goatisMultiplier : D(goatisMultiplier)).times(D(goatis2Multiplier));
            goatis2Purchased = true;
            updateDisplays();
        } else { notify('Not enough What Happeneds — need ' + needText(goatis2Cost) + '.'); }
    } else {
        if (count >= goatis2Cost) {
            count -= goatis2Cost;
            if (hasDecimal) goatisMultiplier = (isDecimalInstance(goatisMultiplier) ? goatisMultiplier : D(goatisMultiplier)).times(D(goatis2Multiplier));
            else goatisMultiplier *= goatis2Multiplier;
            goatis2Purchased = true;
            updateDisplays();
        } else { notify('Not enough What Happeneds — need ' + needText(goatis2Cost) + '.'); }
    }
}

function buyGoatis3() {
    if (goatis3Purchased) return;
    if (upgrade18Level < 50) { notify('Unlocks at The Goatis level 50.'); return; }
    if (hasDecimal) {
        if ((isDecimalInstance(count) ? count : D(count)).gte(D(goatis3Cost))) {
            count = (isDecimalInstance(count) ? count : D(count)).minus(D(goatis3Cost));
            goatisMultiplier = (isDecimalInstance(goatisMultiplier) ? goatisMultiplier : D(goatisMultiplier)).times(D(goatis3Multiplier));
            goatis3Purchased = true;
            updateDisplays();
        } else { notify('Not enough What Happeneds — need ' + needText(goatis3Cost) + '.'); }
    } else {
        if (count >= goatis3Cost) {
            count -= goatis3Cost;
            if (hasDecimal) goatisMultiplier = (isDecimalInstance(goatisMultiplier) ? goatisMultiplier : D(goatisMultiplier)).times(D(goatis3Multiplier));
            else goatisMultiplier *= goatis3Multiplier;
            goatis3Purchased = true;
            updateDisplays();
        } else { notify('Not enough What Happeneds — need ' + needText(goatis3Cost) + '.'); }
    }
}

function buyGoatis4() {
    if (goatis4Purchased) return;
    if (upgrade18Level < 100) { notify('Unlocks at The Goatis level 100.'); return; }
    if (hasDecimal) {
        if ((isDecimalInstance(count) ? count : D(count)).gte(D(goatis4Cost))) {
            count = (isDecimalInstance(count) ? count : D(count)).minus(D(goatis4Cost));
            goatisMultiplier = (isDecimalInstance(goatisMultiplier) ? goatisMultiplier : D(goatisMultiplier)).times(D(goatis4Multiplier));
            goatis4Purchased = true;
            updateDisplays();
        } else { notify('Not enough What Happeneds — need ' + needText(goatis4Cost) + '.'); }
    } else {
        if (count >= goatis4Cost) {
            count -= goatis4Cost;
            if (hasDecimal) goatisMultiplier = (isDecimalInstance(goatisMultiplier) ? goatisMultiplier : D(goatisMultiplier)).times(D(goatis4Multiplier));
            else goatisMultiplier *= goatis4Multiplier;
            goatis4Purchased = true;
            updateDisplays();
        } else { notify('Not enough What Happeneds — need ' + needText(goatis4Cost) + '.'); }
    }
}

// goatises raw liver specials (upgrade19)
function buyRaw1() {
    if (raw1Purchased) return;
    if (upgrade19Level < 10) { notify('Unlocks at goatises raw liver level 10.'); return; }
    if (hasDecimal) {
        if ((isDecimalInstance(count) ? count : D(count)).gte(D(raw1Cost))) {
            count = (isDecimalInstance(count) ? count : D(count)).minus(D(raw1Cost));
            rawMultiplier = (isDecimalInstance(rawMultiplier) ? rawMultiplier : D(rawMultiplier)).times(D(raw1Multiplier));
            raw1Purchased = true;
            updateDisplays();
        } else { notify('Not enough What Happeneds — need ' + needText(raw1Cost) + '.'); }
    } else {
        if (count >= raw1Cost) {
            count -= raw1Cost;
            rawMultiplier *= raw1Multiplier;
            raw1Purchased = true;
            updateDisplays();
        } else { notify('Not enough What Happeneds — need ' + needText(raw1Cost) + '.'); }
    }
}

function buyRaw2() {
    if (raw2Purchased) return;
    if (upgrade19Level < 25) { notify('Unlocks at goatises raw liver level 25.'); return; }
    if (hasDecimal) {
        if ((isDecimalInstance(count) ? count : D(count)).gte(D(raw2Cost))) {
            count = (isDecimalInstance(count) ? count : D(count)).minus(D(raw2Cost));
            rawMultiplier = (isDecimalInstance(rawMultiplier) ? rawMultiplier : D(rawMultiplier)).times(D(raw2Multiplier));
            raw2Purchased = true;
            updateDisplays();
        } else { notify('Not enough What Happeneds — need ' + needText(raw2Cost) + '.'); }
    } else {
        if (count >= raw2Cost) {
            count -= raw2Cost;
            rawMultiplier *= raw2Multiplier;
            raw2Purchased = true;
            updateDisplays();
        } else { notify('Not enough What Happeneds — need ' + needText(raw2Cost) + '.'); }
    }
}

function buyRaw3() {
    if (raw3Purchased) return;
    if (upgrade19Level < 50) { notify('Unlocks at goatises raw liver level 50.'); return; }
    if (hasDecimal) {
        if ((isDecimalInstance(count) ? count : D(count)).gte(D(raw3Cost))) {
            count = (isDecimalInstance(count) ? count : D(count)).minus(D(raw3Cost));
            rawMultiplier = (isDecimalInstance(rawMultiplier) ? rawMultiplier : D(rawMultiplier)).times(D(raw3Multiplier));
            raw3Purchased = true;
            updateDisplays();
        } else { notify('Not enough What Happeneds — need ' + needText(raw3Cost) + '.'); }
    } else {
        if (count >= raw3Cost) {
            count -= raw3Cost;
            rawMultiplier *= raw3Multiplier;
            raw3Purchased = true;
            updateDisplays();
        } else { notify('Not enough What Happeneds — need ' + needText(raw3Cost) + '.'); }
    }
}

function buyRaw4() {
    if (raw4Purchased) return;
    if (upgrade19Level < 100) { notify('Unlocks at goatises raw liver level 100.'); return; }
    if (hasDecimal) {
        if ((isDecimalInstance(count) ? count : D(count)).gte(D(raw4Cost))) {
            count = (isDecimalInstance(count) ? count : D(count)).minus(D(raw4Cost));
            rawMultiplier = (isDecimalInstance(rawMultiplier) ? rawMultiplier : D(rawMultiplier)).times(D(raw4Multiplier));
            raw4Purchased = true;
            updateDisplays();
        } else { notify('Not enough What Happeneds — need ' + needText(raw4Cost) + '.'); }
    } else {
        if (count >= raw4Cost) {
            count -= raw4Cost;
            rawMultiplier *= raw4Multiplier;
            raw4Purchased = true;
            updateDisplays();
        } else { notify('Not enough What Happeneds — need ' + needText(raw4Cost) + '.'); }
    }
}

// Landon Stream specials (upgrade20)
function buyLandon1() {
    if (landon1Purchased) return;
    if (numericLevel(upgrade20Level) < 10) { notify('Unlocks at The Landon Stream level 10.'); return; }
    if (hasDecimal) {
        if ((isDecimalInstance(count) ? count : D(count)).gte(D(landon1Cost))) {
            count = (isDecimalInstance(count) ? count : D(count)).minus(D(landon1Cost));
            landonMultiplier = (isDecimalInstance(landonMultiplier) ? landonMultiplier : D(landonMultiplier)).times(D(landon1Multiplier));
            landon1Purchased = true;
            updateDisplays();
        } else { notify('Not enough What Happeneds — need ' + needText(landon1Cost) + '.'); }
    } else {
        if (count >= landon1Cost) {
            count -= landon1Cost;
            if (hasDecimal) landonMultiplier = (isDecimalInstance(landonMultiplier) ? landonMultiplier : D(landonMultiplier)).times(D(landon1Multiplier));
            else landonMultiplier *= landon1Multiplier;
            landon1Purchased = true;
            updateDisplays();
        } else { notify('Not enough What Happeneds — need ' + needText(landon1Cost) + '.'); }
    }
}

function buyLandon2() {
    if (landon2Purchased) return;
    if (numericLevel(upgrade20Level) < 25) { notify('Unlocks at The Landon Stream level 25.'); return; }
    if (hasDecimal) {
        if ((isDecimalInstance(count) ? count : D(count)).gte(D(landon2Cost))) {
            count = (isDecimalInstance(count) ? count : D(count)).minus(D(landon2Cost));
            landonMultiplier = (isDecimalInstance(landonMultiplier) ? landonMultiplier : D(landonMultiplier)).times(D(landon2Multiplier));
            landon2Purchased = true;
            updateDisplays();
        } else { notify('Not enough What Happeneds — need ' + needText(landon2Cost) + '.'); }
    } else {
        if (count >= landon2Cost) {
            count -= landon2Cost;
            if (hasDecimal) landonMultiplier = (isDecimalInstance(landonMultiplier) ? landonMultiplier : D(landonMultiplier)).times(D(landon2Multiplier));
            else landonMultiplier *= landon2Multiplier;
            landon2Purchased = true;
            updateDisplays();
        } else { notify('Not enough What Happeneds — need ' + needText(landon2Cost) + '.'); }
    }
}

function buyLandon3() {
    if (landon3Purchased) return;
    if (numericLevel(upgrade20Level) < 50) { notify('Unlocks at The Landon Stream level 50.'); return; }
    if (hasDecimal) {
        if ((isDecimalInstance(count) ? count : D(count)).gte(D(landon3Cost))) {
            count = (isDecimalInstance(count) ? count : D(count)).minus(D(landon3Cost));
            landonMultiplier = (isDecimalInstance(landonMultiplier) ? landonMultiplier : D(landonMultiplier)).times(D(landon3Multiplier));
            landon3Purchased = true;
            updateDisplays();
        } else { notify('Not enough What Happeneds — need ' + needText(landon3Cost) + '.'); }
    } else {
        if (count >= landon3Cost) {
            count -= landon3Cost;
            if (hasDecimal) landonMultiplier = (isDecimalInstance(landonMultiplier) ? landonMultiplier : D(landonMultiplier)).times(D(landon3Multiplier));
            else landonMultiplier *= landon3Multiplier;
            landon3Purchased = true;
            updateDisplays();
        } else { notify('Not enough What Happeneds — need ' + needText(landon3Cost) + '.'); }
    }
}

function buyLandon4() {
    if (landon4Purchased) return;
    if (numericLevel(upgrade20Level) < 100) { notify('Unlocks at The Landon Stream level 100.'); return; }
    if (hasDecimal) {
        if ((isDecimalInstance(count) ? count : D(count)).gte(D(landon4Cost))) {
            count = (isDecimalInstance(count) ? count : D(count)).minus(D(landon4Cost));
            landonMultiplier = (isDecimalInstance(landonMultiplier) ? landonMultiplier : D(landonMultiplier)).times(D(landon4Multiplier));
            landon4Purchased = true;
            updateDisplays();
        } else { notify('Not enough What Happeneds — need ' + needText(landon4Cost) + '.'); }
    } else {
        if (count >= landon4Cost) {
            count -= landon4Cost;
            if (hasDecimal) landonMultiplier = (isDecimalInstance(landonMultiplier) ? landonMultiplier : D(landonMultiplier)).times(D(landon4Multiplier));
            else landonMultiplier *= landon4Multiplier;
            landon4Purchased = true;
            updateDisplays();
        } else { notify('Not enough What Happeneds — need ' + needText(landon4Cost) + '.'); }
    }
}

// The Bass specials (upgrade21)
function buyTheBass1() {
    if (theBass1Purchased) return;
    if (numericLevel(upgrade21Level) < 10) { notify('Unlocks at The Bass level 10.'); return; }
    if (hasDecimal) {
        if ((isDecimalInstance(count) ? count : D(count)).gte(D(theBass1Cost))) {
            count = (isDecimalInstance(count) ? count : D(count)).minus(D(theBass1Cost));
            theBassMultiplier = (isDecimalInstance(theBassMultiplier) ? theBassMultiplier : D(theBassMultiplier)).times(D(theBass1Multiplier));
            theBass1Purchased = true;
            updateDisplays();
        } else { notify('Not enough What Happeneds — need ' + needText(theBass1Cost) + '.'); }
    } else {
        if (count >= theBass1Cost) {
            count -= theBass1Cost;
            if (hasDecimal) theBassMultiplier = (isDecimalInstance(theBassMultiplier) ? theBassMultiplier : D(theBassMultiplier)).times(D(theBass1Multiplier));
            else theBassMultiplier *= theBass1Multiplier;
            theBass1Purchased = true;
            updateDisplays();
        } else { notify('Not enough What Happeneds — need ' + needText(theBass1Cost) + '.'); }
    }
}

function buyTheBass2() {
    if (theBass2Purchased) return;
    if (numericLevel(upgrade21Level) < 25) { notify('Unlocks at The Bass level 25.'); return; }
    if (hasDecimal) {
        if ((isDecimalInstance(count) ? count : D(count)).gte(D(theBass2Cost))) {
            count = (isDecimalInstance(count) ? count : D(count)).minus(D(theBass2Cost));
            theBassMultiplier = (isDecimalInstance(theBassMultiplier) ? theBassMultiplier : D(theBassMultiplier)).times(D(theBass2Multiplier));
            theBass2Purchased = true;
            updateDisplays();
        } else { notify('Not enough What Happeneds — need ' + needText(theBass2Cost) + '.'); }
    } else {
        if (count >= theBass2Cost) {
            count -= theBass2Cost;
            if (hasDecimal) theBassMultiplier = (isDecimalInstance(theBassMultiplier) ? theBassMultiplier : D(theBassMultiplier)).times(D(theBass2Multiplier));
            else theBassMultiplier *= theBass2Multiplier;
            theBass2Purchased = true;
            updateDisplays();
        } else { notify('Not enough What Happeneds — need ' + needText(theBass2Cost) + '.'); }
    }
}

function buyTheBass3() {
    if (theBass3Purchased) return;
    if (numericLevel(upgrade21Level) < 50) { notify('Unlocks at The Bass level 50.'); return; }
    if (hasDecimal) {
        if ((isDecimalInstance(count) ? count : D(count)).gte(D(theBass3Cost))) {
            count = (isDecimalInstance(count) ? count : D(count)).minus(D(theBass3Cost));
            theBassMultiplier = (isDecimalInstance(theBassMultiplier) ? theBassMultiplier : D(theBassMultiplier)).times(D(theBass3Multiplier));
            theBass3Purchased = true;
            updateDisplays();
        } else { notify('Not enough What Happeneds — need ' + needText(theBass3Cost) + '.'); }
    } else {
        if (count >= theBass3Cost) {
            count -= theBass3Cost;
            if (hasDecimal) theBassMultiplier = (isDecimalInstance(theBassMultiplier) ? theBassMultiplier : D(theBassMultiplier)).times(D(theBass3Multiplier));
            else theBassMultiplier *= theBass3Multiplier;
            theBass3Purchased = true;
            updateDisplays();
        } else { notify('Not enough What Happeneds — need ' + needText(theBass3Cost) + '.'); }
    }
}

function buyTheBass4() {
    if (theBass4Purchased) return;
    if (numericLevel(upgrade21Level) < 100) { notify('Unlocks at The Bass level 100.'); return; }
    if (hasDecimal) {
        if ((isDecimalInstance(count) ? count : D(count)).gte(D(theBass4Cost))) {
            count = (isDecimalInstance(count) ? count : D(count)).minus(D(theBass4Cost));
            theBassMultiplier = (isDecimalInstance(theBassMultiplier) ? theBassMultiplier : D(theBassMultiplier)).times(D(theBass4Multiplier));
            theBass4Purchased = true;
            updateDisplays();
        } else { notify('Not enough What Happeneds — need ' + needText(theBass4Cost) + '.'); }
    } else {
        if (count >= theBass4Cost) {
            count -= theBass4Cost;
            if (hasDecimal) theBassMultiplier = (isDecimalInstance(theBassMultiplier) ? theBassMultiplier : D(theBassMultiplier)).times(D(theBass4Multiplier));
            else theBassMultiplier *= theBass4Multiplier;
            theBass4Purchased = true;
            updateDisplays();
        } else { notify('Not enough What Happeneds — need ' + needText(theBass4Cost) + '.'); }
    }
}

// Diddy Blud purchase handlers
function buyDiddy1() {
    if (diddy1Purchased) return;
    if (upgrade4Level < 10) { notify('Unlocks at Diddy lvl 10.'); return; }
    if (hasDecimal) {
        if ((isDecimalInstance(count) ? count : D(count)).gte(D(diddy1Cost))) {
            count = (isDecimalInstance(count) ? count : D(count)).minus(D(diddy1Cost));
            baseOtherCps = (isDecimalInstance(baseOtherCps) ? baseOtherCps : D(baseOtherCps)).plus(D(50));
            diddy1Purchased = true;
            updateDisplays();
        } else { notify('Not enough What Happeneds — need ' + needText(diddy1Cost) + '.'); }
    } else {
        if (count >= diddy1Cost) {
            count -= diddy1Cost;
            baseOtherCps += 50;
            diddy1Purchased = true;
            updateDisplays();
        } else { notify('Not enough What Happeneds — need ' + needText(diddy1Cost) + '.'); }
    }
}

function buyDiddy2() {
    if (diddy2Purchased) return;
    if (upgrade4Level < 25) { notify('Unlocks at Diddy lvl 25.'); return; }
    if (hasDecimal) {
        if ((isDecimalInstance(count) ? count : D(count)).gte(D(diddy2Cost))) {
            count = (isDecimalInstance(count) ? count : D(count)).minus(D(diddy2Cost));
            diddyOtherMultiplier = (isDecimalInstance(diddyOtherMultiplier) ? diddyOtherMultiplier : D(diddyOtherMultiplier)).times(D(2));
            diddy2Purchased = true;
            updateDisplays();
        } else { notify('Not enough What Happeneds — need ' + needText(diddy2Cost) + '.'); }
    } else {
        if (count >= diddy2Cost) {
            count -= diddy2Cost;
            if (hasDecimal) diddyOtherMultiplier = (isDecimalInstance(diddyOtherMultiplier) ? diddyOtherMultiplier : D(diddyOtherMultiplier)).times(D(2));
            else diddyOtherMultiplier *= 2;
            diddy2Purchased = true;
            updateDisplays();
        } else { notify('Not enough What Happeneds — need ' + needText(diddy2Cost) + '.'); }
    }
}

function buyDiddy3() {
    if (diddy3Purchased) return;
    if (upgrade4Level < 50) { notify('Unlocks at Diddy lvl 50.'); return; }
    if (hasDecimal) {
        if ((isDecimalInstance(count) ? count : D(count)).gte(D(diddy3Cost))) {
            count = (isDecimalInstance(count) ? count : D(count)).minus(D(diddy3Cost));
            clickMultiplier = (isDecimalInstance(clickMultiplier) ? clickMultiplier : D(clickMultiplier)).times(D(1.5));
            diddy3Purchased = true;
            updateDisplays();
        } else { notify('Not enough What Happeneds — need ' + needText(diddy3Cost) + '.'); }
    } else {
        if (count >= diddy3Cost) {
            count -= diddy3Cost;
            if (hasDecimal) clickMultiplier = (isDecimalInstance(clickMultiplier) ? clickMultiplier : D(clickMultiplier)).times(D(1.5));
            else clickMultiplier *= 1.5;
            diddy3Purchased = true;
            updateDisplays();
        } else { notify('Not enough What Happeneds — need ' + needText(diddy3Cost) + '.'); }
    }
}

function buyDiddy4() {
    if (diddy4Purchased) return;
    if (upgrade4Level < 100) { notify('Unlocks at Diddy lvl 100.'); return; }
    if (hasDecimal) {
        if ((isDecimalInstance(count) ? count : D(count)).gte(D(diddy4Cost))) {
            count = (isDecimalInstance(count) ? count : D(count)).minus(D(diddy4Cost));
            diddyMultiplier = (isDecimalInstance(diddyMultiplier) ? diddyMultiplier : D(diddyMultiplier)).times(D(1.25));
            diddy4Purchased = true;
            updateDisplays();
        } else { notify('Not enough What Happeneds — need ' + needText(diddy4Cost) + '.'); }
    } else {
        if (count >= diddy4Cost) {
            count -= diddy4Cost;
            if (hasDecimal) diddyMultiplier = (isDecimalInstance(diddyMultiplier) ? diddyMultiplier : D(diddyMultiplier)).times(D(1.25));
            else diddyMultiplier *= 1.25;
            diddy4Purchased = true;
            updateDisplays();
        } else { notify('Not enough What Happeneds — need ' + needText(diddy4Cost) + '.'); }
    }
}

// Argonian special purchase handlers
function buyArgon1() {
    if (argon1Purchased) return;
    if (upgrade5Level < 10) { notify('Unlocks at Argonian level 10.'); return; }
    if (hasDecimal) {
        if ((isDecimalInstance(count) ? count : D(count)).gte(D(argon1Cost))) {
            count = (isDecimalInstance(count) ? count : D(count)).minus(D(argon1Cost));
            clickMultiplier = (isDecimalInstance(clickMultiplier) ? clickMultiplier : D(clickMultiplier)).times(D(argon1Multiplier));
            argon1Purchased = true;
            updateDisplays();
        } else { notify('Not enough What Happeneds — need ' + needText(argon1Cost) + '.'); }
    } else {
        if (count >= argon1Cost) {
            count -= argon1Cost;
            if (hasDecimal) clickMultiplier = (isDecimalInstance(clickMultiplier) ? clickMultiplier : D(clickMultiplier)).times(D(argon1Multiplier));
            else clickMultiplier *= argon1Multiplier;
            argon1Purchased = true;
            updateDisplays();
        } else { notify('Not enough What Happeneds — need ' + needText(argon1Cost) + '.'); }
    }
}

function buyArgon2() {
    if (argon2Purchased) return;
    if (upgrade5Level < 25) { notify('Unlocks at Argonian level 25.'); return; }
    if (hasDecimal) {
        if ((isDecimalInstance(count) ? count : D(count)).gte(D(argon2Cost))) {
            count = (isDecimalInstance(count) ? count : D(count)).minus(D(argon2Cost));
            argonOtherMultiplier = (isDecimalInstance(argonOtherMultiplier) ? argonOtherMultiplier : D(argonOtherMultiplier)).times(D(argon2Multiplier));
            argon2Purchased = true;
            updateDisplays();
        } else { notify('Not enough What Happeneds — need ' + needText(argon2Cost) + '.'); }
    } else {
        if (count >= argon2Cost) {
            count -= argon2Cost;
            if (hasDecimal) argonOtherMultiplier = (isDecimalInstance(argonOtherMultiplier) ? argonOtherMultiplier : D(argonOtherMultiplier)).times(D(argon2Multiplier));
            else argonOtherMultiplier *= argon2Multiplier;
            argon2Purchased = true;
            updateDisplays();
        } else { notify('Not enough What Happeneds — need ' + needText(argon2Cost) + '.'); }
    }
}

function buyArgon3() {
    if (argon3Purchased) return;
    if (upgrade5Level < 50) { notify('Unlocks at Argonian level 50.'); return; }
    if (hasDecimal) {
        if ((isDecimalInstance(count) ? count : D(count)).gte(D(argon3Cost))) {
            count = (isDecimalInstance(count) ? count : D(count)).minus(D(argon3Cost));
            clickMultiplier = (isDecimalInstance(clickMultiplier) ? clickMultiplier : D(clickMultiplier)).times(D(argon3Multiplier));
            argon3Purchased = true;
            updateDisplays();
        } else { notify('Not enough What Happeneds — need ' + needText(argon3Cost) + '.'); }
    } else {
        if (count >= argon3Cost) {
            count -= argon3Cost;
            if (hasDecimal) clickMultiplier = (isDecimalInstance(clickMultiplier) ? clickMultiplier : D(clickMultiplier)).times(D(argon3Multiplier));
            else clickMultiplier *= argon3Multiplier;
            argon3Purchased = true;
            updateDisplays();
        } else { notify('Not enough What Happeneds — need ' + needText(argon3Cost) + '.'); }
    }
}

function buyArgon4() {
    if (argon4Purchased) return;
    if (upgrade5Level < 100) { notify('Unlocks at Argonian level 100.'); return; }
    if (hasDecimal) {
        if ((isDecimalInstance(count) ? count : D(count)).gte(D(argon4Cost))) {
            count = (isDecimalInstance(count) ? count : D(count)).minus(D(argon4Cost));
            argonMultiplier = (isDecimalInstance(argonMultiplier) ? argonMultiplier : D(argonMultiplier)).times(D(argon4Multiplier));
            argon4Purchased = true;
            updateDisplays();
        } else { notify('Not enough What Happeneds — need ' + needText(argon4Cost) + '.'); }
    } else {
        if (count >= argon4Cost) {
            count -= argon4Cost;
            if (hasDecimal) argonMultiplier = (isDecimalInstance(argonMultiplier) ? argonMultiplier : D(argonMultiplier)).times(D(argon4Multiplier));
            else argonMultiplier *= argon4Multiplier;
            argon4Purchased = true;
            updateDisplays();
        } else { notify('Not enough What Happeneds — need ' + needText(argon4Cost) + '.'); }
    }
}

// Grape special purchase handlers
function buyGrape1() {
    if (grape1Purchased) return;
    if (upgrade6Level < 10) { notify('Unlocks at Grape lvl 10.'); return; }
    if (hasDecimal) {
        if ((isDecimalInstance(count) ? count : D(count)).gte(D(grape1Cost))) {
            count = (isDecimalInstance(count) ? count : D(count)).minus(D(grape1Cost));
            baseOtherCps = (isDecimalInstance(baseOtherCps) ? baseOtherCps : D(baseOtherCps)).plus(D(1000));
            grape1Purchased = true;
            updateDisplays();
        } else { notify('Not enough What Happeneds — need ' + needText(grape1Cost) + '.'); }
    } else {
        if (count >= grape1Cost) {
            count -= grape1Cost;
            baseOtherCps += 1000;
            grape1Purchased = true;
            updateDisplays();
        } else { notify('Not enough What Happeneds — need ' + needText(grape1Cost) + '.'); }
    }
}

function buyGrape2() {
    if (grape2Purchased) return;
    if (upgrade6Level < 25) { notify('Unlocks at Grape lvl 25.'); return; }
    if (hasDecimal) {
        if ((isDecimalInstance(count) ? count : D(count)).gte(D(grape2Cost))) {
            count = (isDecimalInstance(count) ? count : D(count)).minus(D(grape2Cost));
            grapeOtherMultiplier = (isDecimalInstance(grapeOtherMultiplier) ? grapeOtherMultiplier : D(grapeOtherMultiplier)).times(D(grape2Multiplier));
            grape2Purchased = true;
            updateDisplays();
        } else { notify('Not enough What Happeneds — need ' + needText(grape2Cost) + '.'); }
    } else {
        if (count >= grape2Cost) {
            count -= grape2Cost;
            if (hasDecimal) grapeOtherMultiplier = (isDecimalInstance(grapeOtherMultiplier) ? grapeOtherMultiplier : D(grapeOtherMultiplier)).times(D(grape2Multiplier));
            else grapeOtherMultiplier *= grape2Multiplier;
            grape2Purchased = true;
            updateDisplays();
        } else { notify('Not enough What Happeneds — need ' + needText(grape2Cost) + '.'); }
    }
}

function buyGrape3() {
    if (grape3Purchased) return;
    if (upgrade6Level < 50) { notify('Unlocks at Grape lvl 50.'); return; }
    if (hasDecimal) {
        if ((isDecimalInstance(count) ? count : D(count)).gte(D(grape3Cost))) {
            count = (isDecimalInstance(count) ? count : D(count)).minus(D(grape3Cost));
            clickMultiplier = (isDecimalInstance(clickMultiplier) ? clickMultiplier : D(clickMultiplier)).times(D(grape3Multiplier));
            grape3Purchased = true;
            updateDisplays();
        } else { notify('Not enough What Happeneds — need ' + needText(grape3Cost) + '.'); }
    } else {
        if (count >= grape3Cost) {
            count -= grape3Cost;
            if (hasDecimal) clickMultiplier = (isDecimalInstance(clickMultiplier) ? clickMultiplier : D(clickMultiplier)).times(D(grape3Multiplier));
            else clickMultiplier *= grape3Multiplier;
            grape3Purchased = true;
            updateDisplays();
        } else { notify('Not enough What Happeneds — need ' + needText(grape3Cost) + '.'); }
    }
}

function buyGrape4() {
    if (grape4Purchased) return;
    if (upgrade6Level < 100) { notify('Unlocks at Grape lvl 100.'); return; }
    if (hasDecimal) {
        if ((isDecimalInstance(count) ? count : D(count)).gte(D(grape4Cost))) {
            count = (isDecimalInstance(count) ? count : D(count)).minus(D(grape4Cost));
            grapeMultiplier = (isDecimalInstance(grapeMultiplier) ? grapeMultiplier : D(grapeMultiplier)).times(D(grape4Multiplier));
            grape4Purchased = true;
            updateDisplays();
        } else { notify('Not enough What Happeneds — need ' + needText(grape4Cost) + '.'); }
    } else {
        if (count >= grape4Cost) {
            count -= grape4Cost;
            if (hasDecimal) grapeMultiplier = (isDecimalInstance(grapeMultiplier) ? grapeMultiplier : D(grapeMultiplier)).times(D(grape4Multiplier));
            else grapeMultiplier *= grape4Multiplier;
            grape4Purchased = true;
            updateDisplays();
        } else { notify('Not enough What Happeneds — need ' + needText(grape4Cost) + '.'); }
    }
}

// Skippie special purchase handlers
function buySkippie1() {
    if (skippie1Purchased) return;
    if (upgrade7Level < 10) { notify('Unlocks at Skippie lvl 10.'); return; }
    if (hasDecimal) {
        if ((isDecimalInstance(count) ? count : D(count)).gte(D(skippie1Cost))) {
            count = (isDecimalInstance(count) ? count : D(count)).minus(D(skippie1Cost));
            baseOtherCps = (isDecimalInstance(baseOtherCps) ? baseOtherCps : D(baseOtherCps)).plus(D(5000));
            skippie1Purchased = true;
            updateDisplays();
        } else { notify('Not enough What Happeneds — need ' + needText(skippie1Cost) + '.'); }
    } else {
        if (count >= skippie1Cost) {
            count -= skippie1Cost;
            baseOtherCps += 5000;
            skippie1Purchased = true;
            updateDisplays();
        } else { notify('Not enough What Happeneds — need ' + needText(skippie1Cost) + '.'); }
    }
}

function buySkippie2() {
    if (skippie2Purchased) return;
    if (upgrade7Level < 25) { notify('Unlocks at Skippie lvl 25.'); return; }
    if (hasDecimal) {
        if ((isDecimalInstance(count) ? count : D(count)).gte(D(skippie2Cost))) {
            count = (isDecimalInstance(count) ? count : D(count)).minus(D(skippie2Cost));
            skippieOtherMultiplier = (isDecimalInstance(skippieOtherMultiplier) ? skippieOtherMultiplier : D(skippieOtherMultiplier)).times(D(skippie2Multiplier));
            skippie2Purchased = true;
            updateDisplays();
        } else { notify('Not enough What Happeneds — need ' + needText(skippie2Cost) + '.'); }
    } else {
        if (count >= skippie2Cost) {
            count -= skippie2Cost;
            if (hasDecimal) skippieOtherMultiplier = (isDecimalInstance(skippieOtherMultiplier) ? skippieOtherMultiplier : D(skippieOtherMultiplier)).times(D(skippie2Multiplier));
            else skippieOtherMultiplier *= skippie2Multiplier;
            skippie2Purchased = true;
            updateDisplays();
        } else { notify('Not enough What Happeneds — need ' + needText(skippie2Cost) + '.'); }
    }
}

function buySkippie3() {
    if (skippie3Purchased) return;
    if (upgrade7Level < 50) { notify('Unlocks at Skippie lvl 50.'); return; }
    if (hasDecimal) {
        if ((isDecimalInstance(count) ? count : D(count)).gte(D(skippie3Cost))) {
            count = (isDecimalInstance(count) ? count : D(count)).minus(D(skippie3Cost));
            clickMultiplier = (isDecimalInstance(clickMultiplier) ? clickMultiplier : D(clickMultiplier)).times(D(skippie3Multiplier));
            skippie3Purchased = true;
            updateDisplays();
        } else { notify('Not enough What Happeneds — need ' + needText(skippie3Cost) + '.'); }
    } else {
        if (count >= skippie3Cost) {
            count -= skippie3Cost;
            if (hasDecimal) clickMultiplier = (isDecimalInstance(clickMultiplier) ? clickMultiplier : D(clickMultiplier)).times(D(skippie3Multiplier));
            else clickMultiplier *= skippie3Multiplier;
            skippie3Purchased = true;
            updateDisplays();
        } else { notify('Not enough What Happeneds — need ' + needText(skippie3Cost) + '.'); }
    }
}

function buySkippie4() {
    if (skippie4Purchased) return;
    if (upgrade7Level < 100) { notify('Unlocks at Skippie lvl 100.'); return; }
    if (hasDecimal) {
        if ((isDecimalInstance(count) ? count : D(count)).gte(D(skippie4Cost))) {
            count = (isDecimalInstance(count) ? count : D(count)).minus(D(skippie4Cost));
            skippieMultiplier = (isDecimalInstance(skippieMultiplier) ? skippieMultiplier : D(skippieMultiplier)).times(D(skippie4Multiplier));
            skippie4Purchased = true;
            updateDisplays();
        } else { notify('Not enough What Happeneds — need ' + needText(skippie4Cost) + '.'); }
    } else {
        if (count >= skippie4Cost) {
            count -= skippie4Cost;
            if (hasDecimal) skippieMultiplier = (isDecimalInstance(skippieMultiplier) ? skippieMultiplier : D(skippieMultiplier)).times(D(skippie4Multiplier));
            else skippieMultiplier *= skippie4Multiplier;
            skippie4Purchased = true;
            updateDisplays();
        } else { notify('Not enough What Happeneds — need ' + needText(skippie4Cost) + '.'); }
    }
}

// Island special purchase handlers
function buyIsland1() {
    if (island1Purchased) return;
    if (upgrade8Level < 10) { notify('Unlocks at Island lvl 10.'); return; }
    if (count >= island1Cost) {
        count -= island1Cost;
        baseOtherCps += 50000;
        island1Purchased = true;
        updateDisplays();
    } else { notify('Not enough What Happeneds — need ' + needText(island1Cost) + '.'); }
}

function buyIsland2() {
    if (island2Purchased) return;
    if (upgrade8Level < 25) { notify('Unlocks at Island lvl 25.'); return; }
    if (count >= island2Cost) {
        count -= island2Cost;
        if (hasDecimal) islandOtherMultiplier = (isDecimalInstance(islandOtherMultiplier) ? islandOtherMultiplier : D(islandOtherMultiplier)).times(D(island2Multiplier));
        else islandOtherMultiplier *= island2Multiplier;
        island2Purchased = true;
        updateDisplays();
    } else { notify('Not enough What Happeneds — need ' + needText(island2Cost) + '.'); }
}

function buyIsland3() {
    if (island3Purchased) return;
    if (upgrade8Level < 50) { notify('Unlocks at Island lvl 50.'); return; }
    if (count >= island3Cost) {
        count -= island3Cost;
        if (hasDecimal) clickMultiplier = (isDecimalInstance(clickMultiplier) ? clickMultiplier : D(clickMultiplier)).times(D(island3Multiplier));
        else clickMultiplier *= island3Multiplier;
        island3Purchased = true;
        updateDisplays();
    } else { notify('Not enough What Happeneds — need ' + needText(island3Cost) + '.'); }
}

function buyIsland4() {
    if (island4Purchased) return;
    if (upgrade8Level < 100) { notify('Unlocks at Island lvl 100.'); return; }
    if (count >= island4Cost) {
        count -= island4Cost;
        if (hasDecimal) islandMultiplier = (isDecimalInstance(islandMultiplier) ? islandMultiplier : D(islandMultiplier)).times(D(island4Multiplier));
        else islandMultiplier *= island4Multiplier;
        island4Purchased = true;
        updateDisplays();
    } else { notify('Not enough What Happeneds — need ' + needText(island4Cost) + '.'); }
}

// Phonk special purchase handlers
let phonk1Purchased = false;
let phonk2Purchased = false;
let phonk3Purchased = false;
let phonk4Purchased = false;
let phonk5Purchased = false;

function buyPhonk1() {
    if (phonk1Purchased) return;
    if (upgrade10Level < 10) { notify('Unlocks at Phonk lvl 10.'); return; }
    if (count >= phonk1Cost) {
        count -= phonk1Cost;
        if (hasDecimal) phonkMultiplier = (isDecimalInstance(phonkMultiplier) ? phonkMultiplier : D(phonkMultiplier)).times(D(phonk1Multiplier));
        else phonkMultiplier *= phonk1Multiplier;
        phonk1Purchased = true;
        saveGame(); try { playSfx('purchase.wav'); } catch (e) {} updateDisplays();
    } else { notify('Not enough What Happeneds — need ' + needText(phonk1Cost) + '.'); }
}

function buyPhonk2() {
    if (phonk2Purchased) return;
    if (upgrade10Level < 25) { notify('Unlocks at Phonk lvl 25.'); return; }
    if (count >= phonk2Cost) {
        count -= phonk2Cost;
        if (hasDecimal) phonkMultiplier = (isDecimalInstance(phonkMultiplier) ? phonkMultiplier : D(phonkMultiplier)).times(D(phonk2Multiplier));
        else phonkMultiplier *= phonk2Multiplier;
        phonk2Purchased = true;
        saveGame(); try { playSfx('purchase.wav'); } catch (e) {} updateDisplays();
    } else { notify('Not enough What Happeneds — need ' + needText(phonk2Cost) + '.'); }
}

function buyPhonk3() {
    if (phonk3Purchased) return;
    if (upgrade10Level < 50) { notify('Unlocks at Phonk lvl 50.'); return; }
    if (count >= phonk3Cost) {
        count -= phonk3Cost;
        if (hasDecimal) phonkMultiplier = (isDecimalInstance(phonkMultiplier) ? phonkMultiplier : D(phonkMultiplier)).times(D(phonk3Multiplier));
        else phonkMultiplier *= phonk3Multiplier;
        phonk3Purchased = true;
        saveGame(); try { playSfx('purchase.wav'); } catch (e) {} updateDisplays();
    } else { notify('Not enough What Happeneds — need ' + needText(phonk3Cost) + '.'); }
}

function buyPhonk4() {
    if (phonk4Purchased) return;
    if (upgrade10Level < 75) { notify('Unlocks at Phonk lvl 75.'); return; }
    if (count >= phonk4Cost) {
        count -= phonk4Cost;
        if (hasDecimal) phonkOtherMultiplier = (isDecimalInstance(phonkOtherMultiplier) ? phonkOtherMultiplier : D(phonkOtherMultiplier)).times(D(phonk4Multiplier));
        else phonkOtherMultiplier *= phonk4Multiplier;
        phonk4Purchased = true;
        saveGame(); try { playSfx('purchase.wav'); } catch (e) {} updateDisplays();
    } else { notify('Not enough What Happeneds — need ' + needText(phonk4Cost) + '.'); }
}

function buyPhonk5() {
    if (phonk5Purchased) return;
    if (upgrade10Level < 100) { notify('Unlocks at Phonk lvl 100.'); return; }
    if (count >= phonk5Cost) {
        count -= phonk5Cost;
        if (hasDecimal) phonkMultiplier = (isDecimalInstance(phonkMultiplier) ? phonkMultiplier : D(phonkMultiplier)).times(D(phonk5Multiplier));
        else phonkMultiplier *= phonk5Multiplier;
        phonk5Purchased = true;
        saveGame(); try { playSfx('purchase.wav'); } catch (e) {} updateDisplays();
    } else { notify('Not enough What Happeneds — need ' + needText(phonk5Cost) + '.'); }
}

// Fetch active clan buff from Firestore and set window.clanBuffCpsMult / clanBuffClickMult for updateDisplays
async function refreshClanBuff() {
    try {
        var clanId = localStorage.getItem('player_clanId');
        if (!clanId) { window.clanActiveBuffs = []; window.clanBuffCpsMult = 1; window.clanBuffClickMult = 1; return; }
        var dbVal = typeof window !== 'undefined' && window.db;
        var docFn = typeof window !== 'undefined' && window.doc;
        var getDocFn = typeof window !== 'undefined' && window.getDoc;
        if (!dbVal || !docFn || typeof getDocFn !== 'function') return;
        var snap = await getDocFn(docFn(dbVal, 'clans', clanId));
        if (!snap.exists()) { window.clanActiveBuffs = []; window.clanBuffCpsMult = 1; window.clanBuffClickMult = 1; return; }
        var d = snap.data();
        // clan level perks (applied in updateDisplays); cache the level so offline gains can use it on the next load
        window.clanLevel = clanLevelFromXp(d.clanXp);
        try { localStorage.setItem('whathappened_clan_level', String(window.clanLevel)); } catch (e) {}
        // several clan buffs can run at once (activeBuffs); clans that haven't bought one since then only have activeBuff
        var toMs = function (v) { return typeof v === 'number' ? v : (v && v.toMillis ? v.toMillis() : 0); };
        var NAMES = { cps_double_1h: 'Double CPS', click_double_30m: 'Double Click Power', both_triple_20m: 'Triple Everything' };
        var list = [];
        var map = (d.activeBuffs && typeof d.activeBuffs === 'object') ? d.activeBuffs : {};
        Object.keys(map).forEach(function (id) { var b = map[id]; if (b) list.push({ id: id, name: NAMES[id] || 'Clan buff', cpsMult: Number(b.cpsMult) || 1, clickMult: Number(b.clickMult) || 1, expiresAt: toMs(b.expiresAt) }); });
        var ab = d.activeBuff;
        if (ab && ab.id && !map[ab.id]) list.push({ id: ab.id, name: NAMES[ab.id] || 'Clan buff', cpsMult: Number(ab.cpsMult) || 1, clickMult: Number(ab.clickMult) || 1, expiresAt: toMs(ab.expiresAt) });
        window.clanActiveBuffs = list.filter(function (b) { return b.expiresAt > Date.now(); });
        applyClanBuffMults();
    } catch (e) { try { window.clanActiveBuffs = []; window.clanBuffCpsMult = 1; window.clanBuffClickMult = 1; } catch (e2) {} }
}
// Multiply every clan buff that hasn't expired yet (re-run each frame so a buff stops exactly when it runs out)
function applyClanBuffMults() {
    var cpsM = 1, clickM = 1, now = Date.now();
    (window.clanActiveBuffs || []).forEach(function (b) { if (b.expiresAt > now) { cpsM *= b.cpsMult; clickM *= b.clickMult; } });
    window.clanBuffCpsMult = cpsM;
    window.clanBuffClickMult = clickM;
}

// Ensure buttons and displays show initial values on load
function initApp() {
    try {
        console.log('initApp: start');
    // load saved game (if any) then update displays
    loadGame();
    try { syncDivineCostsFromLevels(); } catch (e) {}
    // saves are only allowed once the real save has been read, so an early click can't overwrite it
    window._saveLoaded = true;
    // the Firebase module may still be downloading (it no longer delays startup), so wait for it
    whenFirebaseReady(() => { try { refreshClanBuff(); } catch (e) {} });
    updateDisplays();
    try { updateShopUI(); } catch (e) {}
    // initialize hover tooltips for upgrades
    try { initTooltips(); } catch (e) {}
    // Performance mode: high = quality, low = frame rate. Drives full-update interval and falling-image throttle.
    function getPerformanceMode() { try { return localStorage.getItem('whathappened_performance') || 'high'; } catch (e) { return 'high'; } }
    function applyPerformanceMode(mode) {
        if (mode === 'low') {
            window._perfFullUpdateMs = 1500;
            window._perfFallingThrottleMs = 0;
            window._perfClickUpdateThrottleMs = 200;
            window._perfDisabledClassIntervalMs = 1000;
            window._perfCpsTickMs = 150;
            window._perfCritFalling = false;
            window._perfCritIndicator = false;
        } else if (mode === 'medium') {
            window._perfFullUpdateMs = 1000;
            window._perfFallingThrottleMs = 120;
            window._perfClickUpdateThrottleMs = 150;
            window._perfDisabledClassIntervalMs = 750;
            window._perfCpsTickMs = 100;
            window._perfCritFalling = true;
            window._perfCritIndicator = true;
        } else {
            window._perfFullUpdateMs = 750;
            window._perfFallingThrottleMs = 80;
            window._perfClickUpdateThrottleMs = 150;
            window._perfDisabledClassIntervalMs = 500;
            window._perfCpsTickMs = 100;
            window._perfCritFalling = true;
            window._perfCritIndicator = true;
        }
    }
    applyPerformanceMode(getPerformanceMode());
    try {
        const perfSel = document.getElementById('performanceSelect');
        if (perfSel) {
            perfSel.value = getPerformanceMode();
            perfSel.onchange = function() { const v = perfSel.value; try { localStorage.setItem('whathappened_performance', v); } catch (e) {} applyPerformanceMode(v); };
        }
    } catch (e) {}
    // auto-increment by cps (tick interval depends on Performance: High/Medium 100ms, Low 150ms). Full UI refresh runs on configurable interval.
    let _goonCountEl = null;
    const getGoonCountEl = () => { if (!_goonCountEl) _goonCountEl = document.getElementById('goonCount'); return _goonCountEl; };
    let _lastGoonCountStr = '';
    // Income uses real elapsed time: browsers throttle timers in background tabs (1/sec or slower),
    // so a fixed per-tick amount silently lost most of the CPS while the tab was hidden.
    let _lastCpsTickAt = Date.now();
    const MAX_TICK_GAP_MS = 24 * 60 * 60 * 1000; // same 24h cap as offline gains
    function scheduleCpsTick() {
        const ms = (typeof window._perfCpsTickMs === 'number') ? window._perfCpsTickMs : 100;
        window._perfCpsTickTimeout = setTimeout(() => {
            try {
                const now = Date.now();
                const elapsedMs = Math.min(MAX_TICK_GAP_MS, Math.max(0, now - _lastCpsTickAt));
                _lastCpsTickAt = now;
                const frac = elapsedMs / 1000; // so total per second = cps
                // a long gap means the computer slept with the tab open: report it like offline gains
                if (elapsedMs > 5 * 60000 && Number(cps) > 0) {
                    try { showWelcomeBackModal(Number(cps) * frac, Math.floor(frac)); } catch (e) {}
                }
                if (hasBig) {
                    const cpsVal = D(cps);
                    const isPositive = (typeof cpsVal === 'number' && cpsVal > 0) || (cpsVal && typeof cpsVal.gt === 'function' ? cpsVal.gt(0) : Number(cpsVal) > 0);
                    if (isPositive) {
                        const inc = (typeof cpsVal.times === 'function') ? cpsVal.times(frac) : D(Number(cpsVal) * frac);
                        addToCount(inc);
                        const str = formatNumber(count);
                        if (str !== _lastGoonCountStr) { _lastGoonCountStr = str; const el = getGoonCountEl(); if (el) el.innerText = str; }
                    }
                } else {
                    if (cps > 0) {
                        count = (typeof count === 'number' ? count : Number(count)) + Number(cps) * frac;
                        const str = formatNumber(count);
                        if (str !== _lastGoonCountStr) { _lastGoonCountStr = str; const el = getGoonCountEl(); if (el) el.innerText = str; }
                    }
                }
            } catch (e) {}
            scheduleCpsTick();
        }, ms);
    }
    scheduleCpsTick();
    function scheduleFullUpdate() {
        const ms = (typeof window._perfFullUpdateMs === 'number') ? window._perfFullUpdateMs : 750;
        window._perfFullUpdateTimeout = setTimeout(function() { try { updateDisplays(); _lastGoonCountStr = ''; } catch (e) {} scheduleFullUpdate(); }, ms);
    }
    scheduleFullUpdate();
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
                const trackSrc = musicSrcFor(currentMusicTrack);
                if (!audio.src || decodeURIComponent(audio.src).indexOf(trackSrc) === -1) audio.src = trackSrc;
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
            mainImg.addEventListener('click', () => { try { playSfx('whclick.wav'); } catch (e) {} });
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
    // mobile browsers often kill a backgrounded tab without firing beforeunload: save whenever the tab is hidden
    document.addEventListener('visibilitychange', () => {
        if (document.visibilityState === 'hidden') {
            try { saveGame(); } catch (e) {}
            try { flushClanClicks(); } catch (e) {}
        }
    });
    // clan-event clicks are batched; send them every 3s
    setInterval(() => { try { flushClanClicks(); } catch (e) {} }, 3000);
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
            btns.forEach(b=>{ try{ b.classList.toggle('active', String(b.dataset.value) === String(purchaseBatch)); }catch(e){} });
        }catch(e){}
    } catch (e) {}
    // Playtime tracking: accumulate seconds played and check achievements
    try {
        const PLAY_KEY = 'whathappened_playtime_seconds';
        let lastPlayTick = Date.now();
        // ensure numeric storage exists
        try { if (!localStorage.getItem(PLAY_KEY)) localStorage.setItem(PLAY_KEY, String(0)); } catch (e) {}
        // initial check
        // update every 10 seconds (checkDataAchievements picks up the playtime achievements)
        setInterval(() => {
            try {
                const now = Date.now();
                const deltaSec = Math.floor((now - lastPlayTick) / 1000);
                if (deltaSec > 0) {
                    lastPlayTick = now;
                    const current = Number(localStorage.getItem(PLAY_KEY) || 0) || 0;
                    const next = current + deltaSec;
                    try { localStorage.setItem(PLAY_KEY, String(next)); } catch (e) {}
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
        whenFirebaseReady(() => { try { window.writeProfile().catch(() => {}); } catch (e) {} });
        console.log('initApp: finished (overlay hidden)');
    }
}

// Run fn once the Firebase module in index.html has set its globals (gives up after ~60s, e.g. when blocked).
function whenFirebaseReady(fn, tries = 120) {
    if (window.db && typeof window.writeProfile === 'function') { fn(); return; }
    if (tries > 0) setTimeout(() => whenFirebaseReady(fn, tries - 1), 500);
}

// Start as soon as the HTML is parsed. DOMContentLoaded also waits for the Firebase module to download,
// which on slow or filtered networks left the game showing a blank save for several seconds.
function initAppOnce() {
    if (initAppOnce.done) return;
    initAppOnce.done = true;
    initApp();
}
if (document.readyState === 'loading') {
    document.addEventListener('readystatechange', () => { if (document.readyState !== 'loading') initAppOnce(); });
    document.addEventListener('DOMContentLoaded', initAppOnce);
} else {
    initAppOnce();
}

// "+N" that floats up from where you clicked (skipped on Low performance; at most 14 on screen)
function spawnClickFloat(amount, crit) {
    if (window._perfCritIndicator === false) return;
    let layer = document.getElementById('clickFloatLayer');
    if (!layer) { layer = document.createElement('div'); layer.id = 'clickFloatLayer'; layer.setAttribute('aria-hidden', 'true'); document.body.appendChild(layer); }
    while (layer.childElementCount >= 14) layer.firstElementChild.remove();
    const p = window._lastClickPoint;
    let x, y;
    if (p && Date.now() - p.t < 500) { x = p.x; y = p.y; }
    else {
        const btn = document.querySelector('.main-image-btn');
        const r = btn ? btn.getBoundingClientRect() : { left: innerWidth / 2, top: innerHeight / 2, width: 0, height: 0 };
        x = r.left + r.width / 2; y = r.top + r.height / 2;
    }
    const el = document.createElement('span');
    el.className = 'click-float' + (crit ? ' crit' : '');
    el.textContent = '+' + formatNumber(amount);
    el.style.left = (x + Math.random() * 36 - 18) + 'px';
    el.style.top = (y - 8) + 'px';
    layer.appendChild(el);
    setTimeout(() => el.remove(), crit ? 1200 : 900);
}
document.addEventListener('pointerdown', e => {
    if (e.target && e.target.closest && e.target.closest('.main-image-btn')) window._lastClickPoint = { x: e.clientX, y: e.clientY, t: Date.now() };
}, true);

// Esc closes the topmost open menu or dialog
document.addEventListener('keydown', e => {
    if (e.key !== 'Escape' || e.defaultPrevented) return;
    // items.js: gem purchase dialog, lootbox reveal, Items menu
    if (window.WHI && window.WHI.handleEscape()) return;
    const byId = id => document.getElementById(id);
    const shown = el => !!el && !!el.style.display && el.style.display !== 'none';
    const open = id => !!byId(id) && byId(id).classList.contains('open');
    if (shown(byId('welcomeBackModal'))) { const b = byId('welcomeBackOk'); if (b) b.click(); return; }
    if (shown(byId('statsPanel'))) return toggleStats();
    if (open('shopMenu')) return toggleShopMenu();
    if (open('settingsMenu')) return toggleSettingsMenu();
    if (open('specialMenu')) return toggleSpecialMenu();
    if (open('navSideBar')) return closeNavSideBar();
    const side = byId('sidePanel');
    if (side && side.style.transform && String(side.style.transform).indexOf('100%') === -1 && byId('sidePanelClose')) return byId('sidePanelClose').click();
    if (open('leftBar') || open('divineLeftBar')) return toggleLeftBar();
});

function toggleSpecialMenu() {
    const el = document.getElementById('specialMenu');
    if (!el) return;
    if (!el.classList.contains('open')) {
        try { closeNavSideBar(); } catch (e) {}
    }
    el.classList.toggle('open');
    el.setAttribute('aria-hidden', el.classList.contains('open') ? 'false' : 'true');
    const btn = document.getElementById('specialMenuBtn');
    if (btn) btn.classList.toggle('active', el.classList.contains('open'));
    if (!el.classList.contains('open')) { try { hideSpecialTip(); } catch (e) {} }
    try { updateDisplays(); } catch (e) {}
}

function toggleNavSideBar() {
    const bar = document.getElementById('navSideBar');
    if (!bar) return;
    if (bar.classList.contains('open')) closeNavSideBar();
    else openNavSideBar();
}
window.toggleNavSideBar = toggleNavSideBar;
window.toggleNavMenu = toggleNavSideBar;

function openNavSideBar() {
    const bar = document.getElementById('navSideBar');
    const overlay = document.getElementById('navSideBarOverlay');
    const btn = document.getElementById('navMenuToggle');
    if (!bar) return;
    const sm = document.getElementById('specialMenu');
    if (sm && sm.classList.contains('open')) {
        try { toggleSpecialMenu(); } catch (e) {}
    }
    bar.classList.add('open');
    bar.setAttribute('aria-hidden', 'false');
    if (overlay) overlay.classList.add('active');
    if (btn) btn.classList.add('active');
}
window.openNavSideBar = openNavSideBar;

function closeNavSideBar() {
    const bar = document.getElementById('navSideBar');
    const overlay = document.getElementById('navSideBarOverlay');
    const btn = document.getElementById('navMenuToggle');
    if (!bar) return;
    bar.classList.remove('open');
    bar.setAttribute('aria-hidden', 'true');
    if (overlay) overlay.classList.remove('active');
    if (btn) btn.classList.remove('active');
}
window.closeNavSideBar = closeNavSideBar;

function toggleSettingsMenu() {
    const el = document.getElementById('settingsMenu');
    if (!el) return;
    el.classList.toggle('open');
    const overlay = document.getElementById('settingsOverlay');
    if (overlay) overlay.classList.toggle('open');
    const btn = document.getElementById('settingsToggle');
    if (btn) btn.classList.toggle('active', el.classList.contains('open'));
    try {
        if (el.classList.contains('open')) {
            document.body.classList.add('overlay-open-settings');
            try { closeNavSideBar(); } catch (e) {}
        } else {
            document.body.classList.remove('overlay-open-settings');
        }
    } catch (e) {}
}

// toggle the Stats panel (modal in index.html)
function toggleStats() {
    try {
        const el = document.getElementById('statsPanel');
        if (!el) return;
        el.style.display = (el.style.display === 'none' || !el.style.display) ? 'block' : 'none';
        if (el.style.display === 'block') renderExtraStats();
    } catch (e) {}
}
// "Around the game": achievements, followers, casino and clan numbers, read from what those pages saved
function renderExtraStats() {
    const box = document.getElementById('statsExtra');
    if (!box) return;
    const readJSON = k => { try { return JSON.parse(localStorage.getItem(k) || 'null'); } catch (e) { return null; } };
    const rows = [];
    try { if (window.WHA) rows.push(['🎖️ Achievements', `${window.WHA.unlockedCount()} / ${window.WHA.ACHIEVEMENTS.length}`, 'achievements.html']); } catch (e) {}
    rows.push(['🏷️ Titles unlocked', String(getUnlockedTitles().length), 'achievements.html']);
    const f = readJSON('whathappened_followers');
    if (f && Array.isArray(f.list)) rows.push(['🦎 Followers', `${f.list.length} owned · ${(f.equipped || []).filter(Boolean).length}/${f.slots || 2} on your team`, 'followers.html']);
    rows.push(['💎 Gems', formatNumber(getGems()), null]);
    try {
        if (window.WHI) {
            const it = window.WHI.summary();
            rows.push(['🎁 Lootboxes', `${formatNumber(it.opened)} opened · ${formatNumber(it.boxes)} waiting`, null]);
            rows.push(['🧿 Charms found', `${it.charms} / ${it.charmsTotal}`, null]);
        }
    } catch (e) {}
    const cs = readJSON('whathappened_casino_stats');
    if (cs && cs.rounds) {
        const decided = (cs.wins || 0) + (cs.losses || 0);
        rows.push(['🎰 Casino rounds', `${formatNumber(cs.rounds)}${decided ? ' · ' + Math.round((cs.wins || 0) / decided * 100) + '% won' : ''}${cs.rocketBest ? ' · best rocket ' + Number(cs.rocketBest).toFixed(2) + '×' : ''}`, 'gamba.html']);
    }
    const clanId = localStorage.getItem('player_clanId');
    if (clanId && clanId !== 'undefined') {
        const ck = readJSON('whathappened_clan_checkin') || {};
        const lvl = Number(localStorage.getItem('whathappened_clan_level')) || 1;
        rows.push(['🛡️ Clan', `${localStorage.getItem('player_clanName') || 'Your clan'} · level ${lvl}${ck.streak ? ' · ' + ck.streak + '-day streak' : ''}`, 'clan.html']);
    }
    box.innerHTML = '<h4>Around the game</h4>' + rows.map(([k, v, href]) =>
        `<div class="stats-extra-row"><span>${k}</span>${href ? `<a href="${href}">${v}</a>` : `<b>${v}</b>`}</div>`).join('');
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

// ---------- Gems: the premium currency (main.js `diamonds`; items.js draws the counter, burst and purchase dialog) ----------
function getGems() { return Math.max(0, Math.floor(Number(diamonds) || 0)); }
function gemPriceHtml(n) {
    return `<span class="gem-price"><img src="mainimage/gem.png" alt="" class="gem-ico">${formatNumber(n)}<span class="sr-only"> gems</span></span>`;
}
// Every place that shows the gem balance (top-bar counter, shop header, Items menu)
function renderGemBalances() {
    if (window.WHI) { window.WHI.renderHud(); return; }
    const el = document.getElementById('gemCount');
    if (el) el.innerText = formatNumber(getGems());
}
// Give gems. They fly from `from` ({x, y}, default: the last click) into the top-bar counter.
// quiet: credit only (items.js animates them itself later).
function addGems(n, from, quiet) {
    const amt = Math.max(0, Math.floor(Number(n) || 0));
    if (!amt) return;
    diamonds = getGems() + amt;
    try { saveGame(); } catch (e) {}
    if (!quiet) {
        if (window.WHI) { try { window.WHI.gemBurst(amt, from); } catch (e) {} }
        else notify('+' + amt + (amt === 1 ? ' gem' : ' gems'));
    }
    try { updateDisplays(); } catch (e) {}
}
function notifyNotEnoughGems(cost) {
    notify('Not enough gems. You need ' + formatNumber(cost - getGems()) + ' more.');
    try { if (window.WHI) window.WHI.shakeChip(); } catch (e) {}
}
// Every gem purchase goes through here: the confirm dialog (items.js), then the gems are taken.
// details: { title, desc, img (url) or art (html) }. Resolves true once paid; the caller then grants the purchase.
function spendGems(cost, details) {
    const price = Math.max(0, Math.floor(Number(cost) || 0));
    const d = details || {};
    if (getGems() < price) { notifyNotEnoughGems(price); return Promise.resolve(false); }
    const ask = (window.WHI && typeof window.WHI.confirmSpend === 'function')
        ? window.WHI.confirmSpend(Object.assign({}, d, { cost: price }))
        : Promise.resolve(confirm('Spend ' + price + ' gems on ' + (d.title || 'this') + '?'));
    return ask.then(ok => {
        if (!ok) return false;
        // the balance can change while the dialog is open (a gem drop, a purchase in another tab)
        if (getGems() < price) { notifyNotEnoughGems(price); return false; }
        diamonds = getGems() - price;
        try { saveGame(); } catch (e) {}
        try { playSfx('audio/purchase.wav'); } catch (e) {}
        try { updateDisplays(); } catch (e) {}
        return true;
    });
}
// Rewards from items.js consumables
// Instantly earn `seconds` of the current CPS. Returns the amount added.
function addCpsSeconds(seconds) {
    const gain = hasDecimal ? (isDecimalInstance(cps) ? cps : D(cps)).times(Number(seconds) || 0) : (Number(cps) || 0) * (Number(seconds) || 0);
    addToCount(gain);
    try { updateDisplays(); } catch (e) {}
    return gain;
}
function addGolden(n) {
    const amt = Math.max(0, Number(n) || 0);
    goldenWhat = (Number(goldenWhat) || 0) + amt;
    totalGoldenEver = (Number(totalGoldenEver) || 0) + amt;
    if (goldenWhat >= 1) divineUnlocked = true;
    try { saveGame(); } catch (e) {}
    try { updateDisplays(); } catch (e) {}
}

// Shop menu toggle (tab: which tab to open on, default the skins)
function toggleShopMenu(tab) {
    const menu = document.getElementById('shopMenu');
    const overlay = document.getElementById('shopOverlay');
    if (!menu || !overlay) return;
    const open = !menu.classList.contains('open');
    if (open) {
        menu.classList.add('open');
        overlay.classList.add('open');
        try { closeNavSideBar(); } catch (e) {}
        try { updateShopUI(); } catch (e) {}
        try { showShopTab(typeof tab === 'string' ? tab : 'main'); } catch (e) {}
        try { document.body.classList.add('overlay-open-shop'); } catch (e) {}
    } else {
        menu.classList.remove('open');
        overlay.classList.remove('open');
        try { document.body.classList.remove('overlay-open-shop'); } catch (e) {}
    }
    try { renderGemBalances(); } catch (e) {}
}
// Open the shop on a tab (or switch to it if the shop is already open)
function openShop(tab) {
    const menu = document.getElementById('shopMenu');
    if (menu && menu.classList.contains('open')) showShopTab(tab || 'main');
    else toggleShopMenu(tab || 'main');
}

// Shop tabs: [content id, tab button id]
const SHOP_TABS = {
    treasury: ['shopTabTreasury', 'shopTabBtnTreasury'],
    main: ['shopTabMain', 'shopTabBtnMain'],
    bg: ['shopTabBG', 'shopTabBtnBG'],
    music: ['shopTabMusic', 'shopTabBtnMusic'],
};
let currentShopTab = 'main';
// Show the requested shop tab. Handles a short opacity transition.
function showShopTab(tab) {
    try {
        if (!SHOP_TABS[tab]) tab = 'main';
        const pane = k => document.getElementById(SHOP_TABS[k][0]);
        const showEl = pane(tab);
        if (!showEl) return;
        // fast-path if already showing
        if (currentShopTab === tab && showEl.style.display !== 'none') return;
        currentShopTab = tab;
        // prepare shown element, start the hide animation for the others
        showEl.style.display = 'block';
        showEl.style.opacity = '0';
        for (const k in SHOP_TABS) {
            const btn = document.getElementById(SHOP_TABS[k][1]);
            if (btn) btn.classList.toggle('active', k === tab);
            if (k !== tab && pane(k)) pane(k).style.opacity = '0';
        }
        // after a tick, fade in the shown element; after the transition, hide whatever isn't the current tab
        requestAnimationFrame(() => { showEl.style.opacity = '1'; });
        setTimeout(() => { for (const k in SHOP_TABS) if (k !== currentShopTab && pane(k)) pane(k).style.display = 'none'; }, 240);
    } catch (e) { console.warn('showShopTab error', e); }
}

// Render/update shop UI controls inside the shop menu
// Shop previews use the small WebP copies in thumbs/ folders (the full image only loads once you equip it)
const NO_THUMB = /^(whathappened|mainbg|gem|shop|lbicon|wheel|divineargonian|divinesimplevillager)$/;
function thumbFor(path) {
    const m = String(path || '').match(/^(mainimage|bgimages)\/([^/]+)\.(png|jpe?g|webp)$/i);
    return (m && !NO_THUMB.test(m[2])) ? `${m[1]}/thumbs/${m[2]}.webp` : path;
}
function updateShopUI() {
    try {
        // render the main-image skins into the main tab container from SHOP_SKINS
        const container = document.getElementById('shopTabMain');
        if (!container) return;
        const placeholder = (skin) => "data:image/svg+xml;utf8," + encodeURIComponent(
            `<svg xmlns="http://www.w3.org/2000/svg" width="256" height="256"><rect width="100%" height="100%" fill="${skin.color}"/>` +
            `<text x="50%" y="50%" font-size="22" dominant-baseline="middle" text-anchor="middle" fill="#fff" stroke="#000" stroke-width="0.6">${skin.title}</text></svg>`);
        let html = '<div class="shop-items-row">';
        html += `<div class="shop-item" id="shopDefaultItem">
                <div class="shop-item-title">WH classic</div>
                <img id="shopPreviewImage" src="${DEFAULT_SHOP_IMAGE}" alt="Default" class="shop-item-img" style="cursor:pointer;" />
                <div class="shop-item-info">Cost: <strong>Free</strong></div>
                <div style="display:flex;gap:8px;align-items:center;margin-top:6px;">
                    <button id="equipDefaultBtn" style="padding:6px 8px;border-radius:6px;">Equip</button>
                </div>
            </div>`;
        for (const skin of SHOP_SKINS) {
            const costHtml = (skin.cost === null) ? `Unlock: <strong>${skin.unlockText}</strong>` : (skin.owned() ? '<strong>Owned</strong>' : `Price: ${gemPriceHtml(skin.cost)}`);
            html += `<div class="shop-item" id="shop${skin.id}Item">
                <div class="shop-item-title">${skin.title}</div>
                <img id="shop${skin.id}Img" src="${thumbFor(skin.path)}" alt="${skin.title}" class="shop-item-img" style="cursor:pointer;" decoding="async" data-full="${skin.path}" data-fallback="${placeholder(skin)}" />
                <div class="shop-item-info">${costHtml}</div>
                <div style="display:flex;gap:8px;align-items:center;margin-top:6px;">
                    ${skin.cost === null ? '' : `<button id="buy${skin.id}Btn" style="padding:6px 8px;border-radius:6px;" aria-label="Buy ${skin.title} for ${skin.cost} gems">Buy ${gemPriceHtml(skin.cost)}</button>`}
                    <button id="equip${skin.id}Btn" style="padding:6px 8px;border-radius:6px;">Equip</button>
                </div>
            </div>`;
        }
        html += '</div>';
        container.innerHTML = html;

        const isEquipped = (path) => equippedShopImage === path;
        // clicking an owned skin (button or image) toggles it; clicking the equipped one goes back to the default
        const toggleSkin = (skin) => { equipShopItem(isEquipped(skin.path) ? DEFAULT_SHOP_IMAGE : skin.path); };
        container.querySelectorAll('img[data-fallback]').forEach(img => {
            // thumbnail missing -> full image -> coloured placeholder
            img.addEventListener('error', function onErr() {
                if (img.dataset.full && !img.src.endsWith(img.dataset.full)) { img.src = img.dataset.full; return; }
                img.removeEventListener('error', onErr);
                img.src = img.dataset.fallback;
            });
        });
        const equipDefault = () => equipShopItem(DEFAULT_SHOP_IMAGE);
        document.getElementById('equipDefaultBtn').onclick = equipDefault;
        document.getElementById('shopPreviewImage').onclick = equipDefault;
        for (const skin of SHOP_SKINS) {
            const buyBtn = document.getElementById('buy' + skin.id + 'Btn');
            const equipBtn = document.getElementById('equip' + skin.id + 'Btn');
            const img = document.getElementById('shop' + skin.id + 'Img');
            if (buyBtn) buyBtn.onclick = () => buyShopSkin(skin);
            if (equipBtn) equipBtn.onclick = () => { if (skin.owned()) toggleSkin(skin); else notify('You must buy this item first.'); };
            if (img) img.onclick = () => {
                if (skin.owned()) toggleSkin(skin);
                else if (skin.cost === null) notify('Unlock: ' + skin.unlockText + '.');
                else buyShopSkin(skin);
            };
            const owned = skin.owned();
            const equipped = isEquipped(skin.path);
            if (buyBtn) { buyBtn.style.display = owned ? 'none' : ''; buyBtn.disabled = (Number(diamonds) || 0) < skin.cost; }
            if (equipBtn) { equipBtn.disabled = !owned; equipBtn.innerText = equipped ? 'Unequip' : 'Equip'; }
            if (equipped) document.getElementById('shop' + skin.id + 'Item').classList.add('equipped');
        }
        const defaultEquipped = !findShopSkin(equippedShopImage);
        const defBtn = document.getElementById('equipDefaultBtn');
        defBtn.disabled = defaultEquipped;
        defBtn.innerText = defaultEquipped ? 'Equipped' : 'Equip';
        if (defaultEquipped) document.getElementById('shopDefaultItem').classList.add('equipped');
        try { renderGemBalances(); } catch (e) {}
        // Treasury tab (lootboxes, lure, charm slots) is drawn by items.js
        try { const tre = document.getElementById('shopTabTreasury'); if (tre && window.WHI) window.WHI.renderTreasury(tre); } catch (e) { console.warn('render treasury failed', e); }

        // render background images into BG tab
        try {
            const bgContainer = document.getElementById('shopTabBG');
            if (bgContainer) {
                let bgHtml = '<div class="shop-items-row">';
                bgHtml += `<div class="shop-item"><div class="shop-item-title">Default Background</div><img src="${DEFAULT_BG_IMAGE}" class="shop-item-img" /><div class="shop-item-info">Cost: <strong>Free</strong></div><div style="display:flex;gap:8px;align-items:center;margin-top:6px;"><button id="equipDefaultBgBtn" style="padding:6px 8px;border-radius:6px;">Equip</button></div></div>`;
                BG_IMAGES.forEach(fn => {
                    const id = fn.replace(/\W+/g, '_');
                    // display friendly name: drop the trailing 'bg.png' / '.png' and capitalise
                    let displayName = fn.replace(/bg\.png$/i, '').replace(/\.png$/i, '').replace(/_/g, ' ');
                    displayName = displayName.charAt(0).toUpperCase() + displayName.slice(1);
                    bgHtml += `<div class="shop-item" id="shopBgItem_${id}">`;
                    bgHtml += `<div class="shop-item-title">${displayName}</div>`;
                    bgHtml += `<img id="shopBgImg_${id}" src="${thumbFor(bgPathFor(fn))}" alt="${displayName}" class="shop-item-img" style="cursor:pointer;" decoding="async" onerror="if(!this.dataset.retry){this.dataset.retry=1;this.src='${bgPathFor(fn)}';}" />`;
                    bgHtml += `<div class="shop-item-info">${(shopBgPurchased && shopBgPurchased[bgPathFor(fn)]) ? '<strong>Owned</strong>' : 'Price: ' + gemPriceHtml(bgCostFor(fn))}</div>`;
                    bgHtml += `<div style="display:flex;gap:8px;align-items:center;margin-top:6px;">`;
                    bgHtml += `<button id="buyBg_${id}" style="padding:6px 8px;border-radius:6px;" aria-label="Buy the ${displayName} background for ${bgCostFor(fn)} gems">Buy ${gemPriceHtml(bgCostFor(fn))}</button>`;
                    bgHtml += `<button id="equipBg_${id}" style="padding:6px 8px;border-radius:6px;">Equip</button>`;
                    bgHtml += `</div></div>`;
                });
                bgHtml += '</div>';
                bgContainer.innerHTML = bgHtml;
                try { document.getElementById('equipDefaultBgBtn').onclick = () => { equipBgImage(DEFAULT_BG_IMAGE); updateShopUI(); }; } catch (e) {}
                BG_IMAGES.forEach(fn => {
                    const id = fn.replace(/\W+/g, '_');
                    const cost = bgCostFor(fn);
                    const path = bgPathFor(fn);
                    const owned = () => !!(shopBgPurchased && shopBgPurchased[path]);
                    const buyBtn = document.getElementById('buyBg_' + id);
                    const equipBtn = document.getElementById('equipBg_' + id);
                    const imgEl = document.getElementById('shopBgImg_' + id);
                    if (buyBtn) buyBtn.onclick = () => { buyBgImage(path, cost); };
                    if (equipBtn) equipBtn.onclick = () => { equipBgImage(path); updateShopUI(); };
                    if (imgEl) imgEl.onclick = () => { if (owned()) { equipBgImage(path); updateShopUI(); } else buyBgImage(path, cost); };
                    const equipped = equippedBgImage === path;
                    if (buyBtn) { buyBtn.style.display = owned() ? 'none' : ''; buyBtn.disabled = (Number(diamonds) || 0) < cost; }
                    if (equipBtn) { equipBtn.disabled = !owned() || equipped; equipBtn.innerText = equipped ? 'Equipped' : 'Equip'; }
                    if (equipped) document.getElementById('shopBgItem_' + id).classList.add('equipped');
                });
                const defBgBtn = document.getElementById('equipDefaultBgBtn');
                if (defBgBtn) { const eq = equippedBgImage === DEFAULT_BG_IMAGE; defBgBtn.disabled = eq; defBgBtn.innerText = eq ? 'Equipped' : 'Equip'; if (eq) defBgBtn.closest('.shop-item').classList.add('equipped'); }
            }
        } catch (e) { console.warn('render shop bg tab failed', e); }
        // render music shop into Music tab
        try {
            const musicContainer = document.getElementById('shopTabMusic');
            if (musicContainer) {
                let mhtml = '<div class="shop-items-row">';
                // defines the tracks available in the shop
                const tracks = MUSIC_TRACKS;
                tracks.forEach(t => {
                    const owned = !!(musicOwned && musicOwned[t.id]);
                    mhtml += `<div class="shop-item" id="shopMusic_${t.id}">`;
                    mhtml += `<div class="shop-item-title">${t.name}</div>`;
                    // image removed for music shop (text + buttons only)
                    mhtml += `<div class="shop-item-info">${owned ? '<strong>Owned</strong>' : 'Price: ' + gemPriceHtml(t.cost)}</div>`;
                    mhtml += `<div style="display:flex;gap:8px;align-items:center;margin-top:6px;">`;
                    mhtml += `<button id="buyMusic_${t.id}" style="padding:6px 8px;border-radius:6px;" aria-label="Buy ${t.name} for ${t.cost} gems">Buy ${gemPriceHtml(t.cost)}</button>`;
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
                        if (buyBtn) { buyBtn.style.display = owned ? 'none' : 'inline-flex'; buyBtn.disabled = (getGems() < t.cost); buyBtn.onclick = () => buyMusicTrack(t); }
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
                                                    bgMusicElement.src = musicSrcFor(currentMusicTrack);
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
                        if (equipBtn) { equipBtn.onclick = () => { if (!musicOwned[t.id]) { notify('You must buy this track first.'); return; } currentMusicTrack = t.id; try { if (!bgMusicElement) bgMusicElement = document.getElementById('bgMusic'); if (bgMusicElement) { bgMusicElement.src = 'audio/' + t.file; bgMusicElement.play().catch(()=>{}); } } catch(e){} saveGame(); updateShopUI(); updateDisplays(); }; equipBtn.innerText = (currentMusicTrack === t.id) ? 'Equipped' : 'Equip'; equipBtn.disabled = !musicOwned[t.id]; }
                        if (statusEl) statusEl.innerText = (currentMusicTrack === t.id) ? 'equipped' : '';
                    } catch (e) {}
                });
            }
        } catch (e) { console.warn('render shop music tab failed', e); }

        // music tab: outline the equipped track
        document.querySelectorAll('#shopTabMusic .shop-item').forEach(div => {
            const m = (div.id || '').match(/^shopMusic_(.+)$/);
            if (m) div.classList.toggle('equipped', currentMusicTrack === m[1]);
        });
    } catch (e) { console.error('updateShopUI failed', e); }
}

// Buy a main-image skin from SHOP_SKINS with gems (skins with cost null are unlocked elsewhere)
function buyShopSkin(skin) {
    if (!skin || skin.owned() || skin.cost === null) return;
    spendGems(skin.cost, { title: skin.title, desc: 'Main image skin. Yours to keep, even through prestige.', img: thumbFor(skin.path) }).then(ok => {
        if (!ok) return;
        skin.grant();
        saveGame();
        updateDisplays();
        updateShopUI();
    });
}

function buyMusicTrack(t) {
    if (!t || (musicOwned && musicOwned[t.id])) return;
    spendGems(t.cost, { title: t.name, desc: 'Music track. Equip it in the Music tab.', art: '🎵' }).then(ok => {
        if (!ok) return;
        musicOwned[t.id] = true;
        saveGame();
        updateDisplays();
        updateShopUI();
    });
}

function equipShopItem(filename) {
    if (!filename) return;
    const skin = findShopSkin(filename);
    if (skin && !skin.owned()) { notify('You must buy this item first.'); return; }
    equippedShopImage = skin ? skin.path : DEFAULT_SHOP_IMAGE;
    // update main image element
    try {
        const img = document.querySelector('.main-image');
        if (img) img.src = equippedShopImage;
    } catch (e) {}
    saveGame();
    updateDisplays();
    try { updateShopUI(); } catch (e) {}
}

// Apply equipped background image to the page body
function applyEquippedBackground() {
    try {
        const bg = (typeof equippedBgImage === 'string' && equippedBgImage) ? equippedBgImage : DEFAULT_BG_IMAGE;
        document.body.style.backgroundImage = "url('" + bg + "')";
    } catch (e) {}
}

function buyBgImage(path, cost = 10) {
    if (!path) return;
    if (shopBgPurchased && shopBgPurchased[path]) return;
    const name = String(path).split('/').pop().replace(/bg\.png$/i, '').replace(/\.png$/i, '');
    spendGems(cost, { title: name.charAt(0).toUpperCase() + name.slice(1) + ' background', desc: 'Background image. Yours to keep, even through prestige.', img: thumbFor(path) }).then(ok => {
        if (!ok) return;
        shopBgPurchased = shopBgPurchased || {};
        shopBgPurchased[path] = true;
        saveGame();
        updateDisplays();
        updateShopUI();
    });
}

function equipBgImage(path) {
    if (!path) return;
    if (path !== DEFAULT_BG_IMAGE && !(shopBgPurchased && shopBgPurchased[path])) { notify('You must buy this item first.'); return; }
    equippedBgImage = path;
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
            // add gems (integer); they fly from the Redeem button into the counter
            const amt = Number(reward.amount) || 0;
            let from = null;
            try { const r = inp.getBoundingClientRect(); if (r.width) from = { x: r.left + r.width / 2, y: r.top + r.height / 2 }; } catch (e) {}
            addGems(amt, from);
            showSecretCodeStatus(reward.message || ('You received ' + amt + ' gems!'), true);
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

// Tribal special purchase handlers
function buyTribal1() {
    if (tribal1Purchased) return;
    if (upgrade9Level < 10) { notify('Unlocks at Tribal lvl 10.'); return; }
    if (count >= tribal1Cost) {
        count -= tribal1Cost;
        baseOtherCps += 200000;
        tribal1Purchased = true;
        updateDisplays();
    } else { notify('Not enough What Happeneds — need ' + needText(tribal1Cost) + '.'); }
}

function buyTribal2() {
    if (tribal2Purchased) return;
    if (upgrade9Level < 25) { notify('Unlocks at Tribal lvl 25.'); return; }
    if (count >= tribal2Cost) {
        count -= tribal2Cost;
        if (hasDecimal) tribalOtherMultiplier = (isDecimalInstance(tribalOtherMultiplier) ? tribalOtherMultiplier : D(tribalOtherMultiplier)).times(D(tribal2Multiplier));
        else tribalOtherMultiplier *= tribal2Multiplier;
        tribal2Purchased = true;
        updateDisplays();
    } else { notify('Not enough What Happeneds — need ' + needText(tribal2Cost) + '.'); }
}

function buyTribal3() {
    if (tribal3Purchased) return;
    if (upgrade9Level < 50) { notify('Unlocks at Tribal lvl 50.'); return; }
    if (count >= tribal3Cost) {
        count -= tribal3Cost;
        if (hasDecimal) clickMultiplier = (isDecimalInstance(clickMultiplier) ? clickMultiplier : D(clickMultiplier)).times(D(tribal3Multiplier));
        else clickMultiplier *= tribal3Multiplier;
        tribal3Purchased = true;
        updateDisplays();
    } else { notify('Not enough What Happeneds — need ' + needText(tribal3Cost) + '.'); }
}

function buyTribal4() {
    if (tribal4Purchased) return;
    if (upgrade9Level < 100) { notify('Unlocks at Tribal lvl 100.'); return; }
    if (count >= tribal4Cost) {
        count -= tribal4Cost;
        if (hasDecimal) tribalMultiplier = (isDecimalInstance(tribalMultiplier) ? tribalMultiplier : D(tribalMultiplier)).times(D(tribal4Multiplier));
        else tribalMultiplier *= tribal4Multiplier;
        tribal4Purchased = true;
        updateDisplays();
    } else { notify('Not enough What Happeneds — need ' + needText(tribal4Cost) + '.'); }
}

// ------------------ Save / Load / Reset ------------------
// New stable save key and versioning. Keep legacy key as fallback to avoid
// losing existing saves.
const SAVE_KEY = 'whathappened_save';
const SAVE_KEY_LEGACY = 'whathappened_save_v1';
const SAVE_VERSION = 3;

function saveGame() {
    if (suppressAutosave || !window._saveLoaded) return;
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
            shopWHNaturePurchased,
            shopVoidWHPurchased,
            shopFireWHPurchased,
            shopIceWHPurchased,
            shopWHhackerPurchased,
            shopWHchadPurchased,
            shopWHbreadPurchased,
            shopWHlightningPurchased,
            shopMobileManPurchased,
            shopCasinoDealerPurchased,
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
        // preserve casino/daily spin state from existing save so main game never overwrites it
        try {
            const existingRaw = localStorage.getItem(SAVE_KEY) || localStorage.getItem(SAVE_KEY_LEGACY);
            if (existingRaw) {
                const existing = JSON.parse(existingRaw);
                if (existing && typeof existing.casinoSpin === 'object' && existing.casinoSpin !== null) {
                    save.casinoSpin = existing.casinoSpin;
                }
                // casino win count (used by the casino dealer unlock and clan challenges) is also owned by gamba.js
                if (existing && existing.casino_total_wins) save.casino_total_wins = existing.casino_total_wins;
            }
        } catch (e) {}
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
        goodNoodles1Purchased = !!s.goodNoodles1Purchased; goodNoodles2Purchased = !!s.goodNoodles2Purchased; goodNoodles3Purchased = !!s.goodNoodles3Purchased; goodNoodles4Purchased = !!s.goodNoodles4Purchased;
        if (typeof s.goodNoodlesMultiplier === 'number') goodNoodlesMultiplier = s.goodNoodlesMultiplier;
        // Mobile Man 38 purchased flags
        mobileMan381Purchased = !!s.mobileMan381Purchased; mobileMan382Purchased = !!s.mobileMan382Purchased; mobileMan383Purchased = !!s.mobileMan383Purchased; mobileMan384Purchased = !!s.mobileMan384Purchased;
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
        shopWHNaturePurchased = !!s.shopWHNaturePurchased;
        shopVoidWHPurchased = !!s.shopVoidWHPurchased;
        shopFireWHPurchased = !!s.shopFireWHPurchased;
        shopIceWHPurchased = !!s.shopIceWHPurchased;
        shopWHhackerPurchased = !!s.shopWHhackerPurchased;
        shopWHchadPurchased = !!s.shopWHchadPurchased;
        shopWHbreadPurchased = !!s.shopWHbreadPurchased;
        shopWHlightningPurchased = !!s.shopWHlightningPurchased;
        shopMobileManPurchased = !!s.shopMobileManPurchased;
        shopSilverPurchased = !!s.shopSilverPurchased;
        shopGoldPurchased = !!s.shopGoldPurchased;
        shopCollectionBgPurchased = !!s.shopCollectionBgPurchased;
        // the casino page sets this after 10 blackjack wins (also mirrored to its own localStorage key)
        shopCasinoDealerPurchased = !!s.shopCasinoDealerPurchased || localStorage.getItem('shopCasinoDealerPurchased') === '1';
        // load background purchases; older saves keyed them by bare filename or with different letter case
        const savedBg = (typeof s.shopBgPurchased === 'object' && s.shopBgPurchased !== null) ? s.shopBgPurchased : {};
        shopBgPurchased = {};
        Object.keys(savedBg).forEach(k => { if (savedBg[k]) shopBgPurchased[canonicalBgPath(k)] = true; });
        delete shopBgPurchased[DEFAULT_BG_IMAGE];
        shopWHBWPurchased = !!s.shopWHBWPurchased;
        if (typeof s.equippedShopImage === 'string') equippedShopImage = canonicalSkinPath(s.equippedShopImage);
        if (typeof s.equippedBgImage === 'string') equippedBgImage = canonicalBgPath(s.equippedBgImage);
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
                    try { notify(`Prestige bonus: +${formatNumber(add)} What Happeneds from Divine Money Man (lvl ${divineMoneyManLevel}).`, 6000); } catch (e) {}
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
                            totalCps = totalCps.times(D(1 + getGoldenBonusCount() * 0.1));
                            if (typeof divineArgonLevel !== 'undefined' && divineArgonLevel > 0) {
                                const offlineAppliedPercent = DIVINE_ARGON_BASE_PERCENT * Math.pow(2, Math.max(0, divineArgonLevel - 1));
                                totalCps = totalCps.times(D(1 + (offlineAppliedPercent / 100)));
                            }
                            // Followers: CPS bonus applies offline too, plus the offline earnings bonus
                            try { const fb = getFollowerBonuses(); totalCps = totalCps.times(D((1 + fb.cps / 100) * (1 + fb.offline / 100))); } catch (e) {}
                            // Items: equipped charms' CPS and offline bonuses (consumable boosts don't run while you're away)
                            try { const ib = getItemBonuses(); totalCps = totalCps.times(D((1 + ib.cps / 100) * (1 + ib.offline / 100))); } catch (e) {}
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
                            const offlineGoldenMult = 1 + getGoldenBonusCount() * 0.1;
                            totalCps = totalCps * offlineGoldenMult;
                            if (typeof divineArgonLevel !== 'undefined' && divineArgonLevel > 0) {
                                const offlineAppliedPercent = DIVINE_ARGON_BASE_PERCENT * Math.pow(2, Math.max(0, divineArgonLevel - 1));
                                const offlineDivineMult = 1 + (offlineAppliedPercent / 100);
                                totalCps = totalCps * offlineDivineMult;
                            }
                            // permanent clan level perk (level cached by refreshClanBuff on the last visit)
                            totalCps = totalCps * (1 + getClanLevelPerk().cps / 100);
                            // Followers: CPS bonus applies offline too, plus the offline earnings bonus
                            try { const fb = getFollowerBonuses(); totalCps = totalCps * (1 + fb.cps / 100) * (1 + fb.offline / 100); } catch (e) {}
                            // Items: equipped charms' CPS and offline bonuses (consumable boosts don't run while you're away)
                            try { const ib = getItemBonuses(); totalCps = totalCps * (1 + ib.cps / 100) * (1 + ib.offline / 100); } catch (e) {}
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
    try { if (window.WHF) localStorage.removeItem(window.WHF.STORAGE_KEY); } catch (e) {}
    try { if (window.WHI) localStorage.removeItem(window.WHI.STORAGE_KEY); } catch (e) {}
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

