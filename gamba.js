// gamba.js — simplified blackjack + daily spin
// Features: blackjack, Decimal-aware balances, daily spin with wheel animation, persistence merged into main save

const SAVE_KEY = 'whathappened_save';
const SAVE_KEY_LEGACY = 'whathappened_save_v1';
const hasDecimal = (typeof D === 'function');

// minimal save helpers used by the casino page (merge into existing save to avoid overwriting)
function loadSave(){
    try{
        let raw = localStorage.getItem(SAVE_KEY);
        if(!raw) raw = localStorage.getItem(SAVE_KEY_LEGACY);
        if(!raw) return null;
        return JSON.parse(raw);
    }catch(e){ return null; }
}

function persistSave(saveObj){
    try{
        const existingRaw = localStorage.getItem(SAVE_KEY) || localStorage.getItem(SAVE_KEY_LEGACY);
        let existing = {};
        if(existingRaw){
            try{ existing = JSON.parse(existingRaw) || {}; }catch(e){ existing = {}; }
        }
        // shallow merge keys from saveObj into existing to avoid wiping unrelated fields
        for(const k in saveObj){ try{ existing[k] = saveObj[k]; }catch(e){} }
        const payload = JSON.stringify(existing);
        localStorage.setItem(SAVE_KEY, payload);
        try{ localStorage.setItem(SAVE_KEY_LEGACY, payload); }catch(e){}
    }catch(e){}
}

// UI refs
const betCurrencyEl = document.getElementById('betCurrency');
const betAmountEl = document.getElementById('betAmount');
const btnPlaceBet = document.getElementById('btnPlaceBet');
const balanceRow = document.getElementById('balanceRow');
const gambaCpsEl = document.getElementById('gambaCps');
const gambaClickEl = document.getElementById('gambaClickPower');
const gameArea = document.getElementById('gameArea');
const playerHandEl = document.getElementById('playerHand');
const dealerHandEl = document.getElementById('dealerHand');
const playerScoreEl = document.getElementById('playerScore');
const dealerScoreEl = document.getElementById('dealerScore');
const resultEl = document.getElementById('result');
const btnHit = document.getElementById('btnHit');
const btnStand = document.getElementById('btnStand');
const btnMaxBet = document.getElementById('btnMaxBet');
const betDisplayEl = document.getElementById('betAmountDisplay');
const spinBtn = document.getElementById('btnSpin');
const spinResultEl = document.getElementById('spinResult');
const spinInfoEl = document.getElementById('spinInfo');
const spinWheel = document.getElementById('spinWheel');

let deck = [], playerHand = [], dealerHand = [];
let currentBet = null, currentCurrency = 'count';
// ensure baseline globals exist so buffs can modify them
if (typeof window.cps === 'undefined') window.cps = 0;
if (typeof window.clickPower === 'undefined') window.clickPower = 1;

// Fallback spawnFallingImage for mystery buff when main.js not loaded (e.g. on casino page)
if (typeof spawnFallingImage !== 'function') {
    window.spawnFallingImage = function(isCrit = false) {
        try {
            const img = document.createElement('img');
            img.src = (typeof equippedShopImage === 'string' && equippedShopImage) ? equippedShopImage : 'mainimage/whathappened.jpeg';
            img.className = 'falling-image';
            const baseSize = 40 + Math.floor(Math.random() * 30);
            const critScale = isCrit ? (1.6 + Math.random() * 0.6) : 1;
            const size = Math.round(baseSize * critScale);
            img.style.cssText = 'position:fixed;width:' + size + 'px;left:' + Math.floor(Math.random() * Math.max(1, window.innerWidth - size)) + 'px;top:-140px;opacity:1;z-index:2000;pointer-events:none;transition:transform 700ms linear,opacity 300ms linear;';
            if (isCrit) img.style.filter = 'drop-shadow(0 0 10px gold) saturate(1.4)';
            const container = document.getElementById('falling-container');
            (container || document.body).appendChild(img);
            requestAnimationFrame(() => {
                const travel = window.innerHeight + 240 + Math.random() * 120;
                const duration = isCrit ? 1000 + Math.floor(Math.random() * 800) : 700 + Math.floor(Math.random() * 800);
                img.style.transform = 'translateY(' + travel + 'px) rotate(' + (Math.random() * 80 - 40) + 'deg)';
                setTimeout(() => { img.style.opacity = '0'; }, duration - 300);
            });
            img.addEventListener('transitionend', () => { try { img.remove(); } catch (e) {} });
        } catch (e) {}
    };
}

function setGlobalClickPower(val){
    try{
        if (typeof clickPower !== 'undefined') {
            try {
                if (hasDecimal) {
                    clickPower = (val && typeof val.plus === 'function') ? val : D(val);
                } else {
                    clickPower = Number(val);
                }
            } catch(e) { clickPower = val; }
        }
    }catch(e){}
    try{ window.clickPower = val; }catch(e){}
    try{ updateCpsClickDisplay(); }catch(e){}
}
function setGlobalCps(val){
    try{
        if (typeof cps !== 'undefined') {
            try {
                if (hasDecimal) {
                    cps = (val && typeof val.plus === 'function') ? val : D(val);
                } else {
                    cps = Number(val);
                }
            } catch(e) { cps = val; }
        }
    }catch(e){}
    try{ window.cps = val; }catch(e){}
    try{ updateCpsClickDisplay(); }catch(e){}
}

function formatVal(v){ try{ if (hasDecimal && v && typeof v.toString==='function') return String(v); }catch(e){} return String(v||0); }

function updateCpsClickDisplay(){
    try{
        if (gambaCpsEl) gambaCpsEl.innerText = formatVal(window.cps);
        if (gambaClickEl) gambaClickEl.innerText = formatVal(window.clickPower);
    }catch(e){}
}
function createDeck(){
    const suits=['Hearts','Diamonds','Clubs','Spades'];
    const ranks=['2','3','4','5','6','7','8','9','10','J','Q','K','A'];
    const d=[]; for(const s of suits) for(const r of ranks) d.push({r,s}); return d;
}
function shuffle(a){ for(let i=a.length-1;i>0;i--){ const j=Math.floor(Math.random()*(i+1)); [a[i],a[j]]=[a[j],a[i]];} return a; }
function cardValue(card){ if(!card) return 0; const rank = (card.r||card.rank||'').toString().toLowerCase(); if (rank==='a'||rank==='ace') return 11; if (['k','q','j','king','queen','jack'].includes(rank)) return 10; const n = parseInt(rank,10); return Number.isFinite(n)?n:0; }
function scoreHand(hand){ let total=0, aces=0; for(const c of hand){ const v=cardValue(c); total+=v; const r=(c.r||c.rank||'').toString().toLowerCase(); if(r==='a'||r==='ace') aces++; } while(total>21 && aces>0){ total-=10; aces--; } return total; }
function cardImageName(card){ if(!card) return null; const r=(card.r||card.rank||'').toString().toLowerCase(); const s=(card.s||card.suit||'').toString().toLowerCase(); let rank=r; if(rank==='j') rank='jack'; if(rank==='q') rank='queen'; if(rank==='k') rank='king'; if(rank==='a') rank='ace'; return `${rank}_of_${s}.png`; }
const CARD_IMG_HEIGHT = 88;
function cardImgHtml(card){ const name=cardImageName(card); if(!name) return '<span>[?]</span>'; const path='mainimage/cards/'+name; return `<img src="${path}" alt="${name}" style="height:${CARD_IMG_HEIGHT}px;display:inline-block;margin-right:8px;">`; }
function cardBackHtml(){ const path='mainimage/cards/cardback.png'; return `<img src="${path}" alt="card back" style="height:${CARD_IMG_HEIGHT}px;display:inline-block;margin-right:8px;">`; }
function handToHtml(hand){ return hand.map(c=>cardImgHtml(c)).join(''); }

function readBalanceField(s, field){
    if (!s) return (hasDecimal ? D(0) : 0);
    const v = s[field];
    if (hasDecimal) {
        try {
            if (typeof v === 'string') return D(v);
            if (typeof v === 'number') return D(v);
            if (v && typeof v.plus === 'function') return v;
        } catch (e) { return D(0); }
        return D(0);
    } else {
        if (typeof v === 'string') return Number(v) || 0;
        if (typeof v === 'number') return v;
        return 0;
    }
}

function writeBalanceField(s, field, newVal){
    if (!s) return;
    if (hasDecimal) {
        // if newVal is Decimal-like, store as string for round-trip
        try {
            if (newVal && typeof newVal.toString === 'function') {
                s[field] = String(newVal.toString());
                return;
            }
        } catch (e) {}
        // otherwise store numeric string
        s[field] = String(newVal);
    } else {
        if (typeof s[field] === 'string') s[field] = String(newVal);
        else s[field] = Number(newVal);
    }
}

function refreshBalanceDisplay(){
    saveObj = loadSave();
    if (!saveObj) { balanceRow.innerText = 'No save found.'; return; }
    const cnt = readBalanceField(saveObj, 'count');
    const gems = readBalanceField(saveObj, 'diamonds');
    const golden = readBalanceField(saveObj, 'goldenWhat');
    const fmt = v => {
        try { if (hasDecimal && v && typeof v.toString === 'function') return v.toString(); } catch (e) {}
        return String(v || 0);
    };
    balanceRow.innerText = `Balance — What Happeneds: ${fmt(cnt)} | Gems: ${fmt(gems)} | Golden: ${fmt(golden)}`;
    try { updateBetSliderMax(); } catch(e){}
    try { updateCpsClickDisplay(); } catch(e){}
}

function safeNumberFromVal(v){
    try{
        if (typeof v === 'number') return v;
        if (!v) return 0;
        // try Decimal-aware conversion
        if (hasDecimal && v && typeof v.toString === 'function') return Number(String(v));
        return Number(v);
    }catch(e){ return 0; }
}

function updateBetSliderMax(){
    try{
        if (!betAmountEl) return;
        const saveObj = loadSave(); if(!saveObj) return;
        const currency = (betCurrencyEl && betCurrencyEl.value) ? betCurrencyEl.value : 'count';
        const field = (currency==='count') ? 'count' : (currency==='diamonds') ? 'diamonds' : 'goldenWhat';
        const bal = readBalanceField(saveObj, field);
        const maxVal = Math.max(0, safeNumberFromVal(bal));
        // ensure slider attributes are numeric; clamp current value
        betAmountEl.max = String(Math.floor(maxVal));
        // min should be 0 or 1 depending on balance
        betAmountEl.min = (maxVal > 0) ? '1' : '0';
        if (Number(betAmountEl.value) > Number(betAmountEl.max)) betAmountEl.value = betAmountEl.max;
        if (Number(betAmountEl.value) < Number(betAmountEl.min)) betAmountEl.value = betAmountEl.min;
        // update display
        if (betDisplayEl) betDisplayEl.innerText = betAmountEl.value;
    }catch(e){ /* ignore */ }
}

// update display when currency changes
if (betCurrencyEl) betCurrencyEl.addEventListener('change', ()=>{ try{ updateBetSliderMax(); }catch(e){} });

// update display when slider moves
if (betAmountEl) betAmountEl.addEventListener('input', ()=>{ try{ if (betDisplayEl) betDisplayEl.innerText = betAmountEl.value; }catch(e){} });

// Max button behavior
if (btnMaxBet) btnMaxBet.addEventListener('click', ()=>{
    try{
        updateBetSliderMax();
        betAmountEl.value = betAmountEl.max || betAmountEl.value || '0';
        if (betDisplayEl) betDisplayEl.innerText = betAmountEl.value;
    }catch(e){}
});

function startNewRound(){
    deck = shuffle(createDeck());
    playerHand = [deck.pop(), deck.pop()];
    dealerHand = [deck.pop(), deck.pop()];
    updateUI();
    saveRoundState();
}

function updateUI(revealDealer=false){
    playerHandEl.innerHTML = handToHtml(playerHand);
    playerScoreEl.innerText = 'Score: ' + scoreHand(playerHand);
    if (revealDealer) {
        dealerHandEl.innerHTML = handToHtml(dealerHand);
        dealerScoreEl.innerText = 'Score: ' + scoreHand(dealerHand);
    } else {
        // show dealer first card face-up and second card as back
        const first = dealerHand[0];
        const second = dealerHand[1];
        let html = '';
        if (first) html += cardImgHtml(first);
        if (second) html += cardBackHtml();
        dealerHandEl.innerHTML = html;
        dealerScoreEl.innerText = '';
    }
}

function endRound(outcome){
    // outcome: 'win','lose','push'
    // stop in-round dealer message cycling
    try { if (typeof stopDealerInRoundCycle === 'function') stopDealerInRoundCycle(); } catch (e) {}
    // prepare human-readable result message (include bet amount and currency label)
    try {
        const label = (currentCurrency === 'count') ? 'What Happeneds' : (currentCurrency === 'diamonds') ? 'Gems' : 'Golden';
        if (outcome === 'win') {
            const betStr = (hasDecimal ? String(currentBet) : String(currentBet));
            resultEl.innerText = `You win! +${betStr} ${label}`;
        } else if (outcome === 'lose') {
            const betStr = (hasDecimal ? String(currentBet) : String(currentBet));
            resultEl.innerText = `You lose. -${betStr} ${label}`;
        } else {
            resultEl.innerText = 'Push (tie). Bet returned.';
        }
    } catch (e) {
        resultEl.innerText = (outcome==='win') ? 'You win!' : (outcome==='lose') ? 'You lose.' : 'Push (tie).';
    }
    // modify save
    saveObj = loadSave(); if (!saveObj) return;
    const field = (currentCurrency==='count') ? 'count' : (currentCurrency==='diamonds') ? 'diamonds' : 'goldenWhat';
    let bal = readBalanceField(saveObj, field);
    if (hasDecimal) {
        try {
            const betD = D(currentBet);
            if (!bal || typeof bal.plus !== 'function') bal = D(bal || 0);
            if (outcome === 'win') bal = bal.plus(betD);
            else if (outcome === 'lose') bal = bal.minus(betD);
        } catch (e) { /* fallback to numeric */ bal = Number(bal || 0); if (outcome==='win') bal += Number(currentBet); else if (outcome==='lose') bal -= Number(currentBet); }
    } else {
        bal = Number(bal || 0);
        if (outcome === 'win') bal += Number(currentBet);
        else if (outcome === 'lose') bal -= Number(currentBet);
    }
    // push = no change
    writeBalanceField(saveObj, field, bal);
    // persist
    persistSave(saveObj);
    // Achievement: Put it all on black — bet all What Happeneds and win
    try {
        if (currentCurrency === 'count' && outcome === 'win') {
            let betAll = false;
            try {
                const balBefore = readBalanceField(loadSave(), 'count');
                if (hasDecimal) {
                    const betD = D(currentBet);
                    if (balBefore && typeof balBefore.equals === 'function') betAll = balBefore.equals(betD);
                    else betAll = Number(balBefore) === Number(betD);
                } else {
                    betAll = Number(currentBet) === Number(balBefore);
                }
            } catch (e) { betAll = false; }
            if (betAll) {
                try {
                    const already = localStorage.getItem('ach_put_all_on_black') === '1';
                    if (!already) {
                        localStorage.setItem('ach_put_all_on_black', '1');
                        try { showGambaAchievement('put it all on black', 'Title: High Roller (rare)'); } catch (e) {}
                    }
                } catch (e) {}
                // add title 'High Roller' (rare) to unlocked_titles if not present
                try {
                    const raw = localStorage.getItem('unlocked_titles');
                    let arr = [];
                    if (raw) {
                        try { arr = JSON.parse(raw) || []; } catch (e) { arr = []; }
                    }
                    const found = arr.find(a => (typeof a === 'string' ? a : a.name) === 'High Roller');
                    if (!found) {
                        arr.push({ name: 'High Roller', rarity: 'rare' });
                        localStorage.setItem('unlocked_titles', JSON.stringify(arr));
                        try { showGambaAchievement('New Title: High Roller', 'Rarity: rare'); } catch (e) {}
                    }
                } catch (e) {}
            }
        }
    } catch (e) {}
    // Track total casino wins and unlock dealer skin at 10 wins
    try {
        if (outcome === 'win') {
            // read existing saved wins (from merged save) or fallback to dedicated key
            let s = loadSave() || {};
            let wins = Number(s.casino_total_wins || localStorage.getItem('gamba_total_wins') || 0) || 0;
            wins = Number(wins) + 1;
            try { persistSave({ casino_total_wins: wins }); } catch (e) { try { localStorage.setItem('gamba_total_wins', String(wins)); } catch (e) {} }
            try { localStorage.setItem('gamba_total_wins', String(wins)); } catch (e) {}
            if (wins >= 10) {
                // unlock the casino dealer main-image skin (do NOT auto-equip). Show achievement only once.
                try {
                    const alreadyUnlocked = !!(s && s.shopCasinoDealerPurchased) || (localStorage.getItem('shopCasinoDealerPurchased') === '1');
                    const savePatch = { shopCasinoDealerPurchased: true, casino_total_wins: wins };
                    persistSave(savePatch);
                    try { localStorage.setItem('shopCasinoDealerPurchased', '1'); } catch (e) {}
                    if (!alreadyUnlocked) {
                        try { showGambaAchievement('Unlocked: Casino Dealer Skin', 'Unlocked — equip from Shop'); } catch (e) {}
                    }
                } catch (e) {}
            }
        }
    } catch (e) {}
    // Achievement: 5-card blackjack — have 5 cards in hand and win
    try {
        if (outcome === 'win' && Array.isArray(playerHand) && playerHand.length >= 5) {
            try {
                const already5 = localStorage.getItem('ach_5_card_blackjack') === '1';
                if (!already5) {
                    localStorage.setItem('ach_5_card_blackjack', '1');
                    try { showGambaAchievement('5 card blackjack', 'Title: playing with fire (epic)'); } catch (e) {}
                }
            } catch (e) {}
            // add title 'playing with fire' (epic) to unlocked_titles if not present
            try {
                const raw2 = localStorage.getItem('unlocked_titles');
                let arr2 = [];
                if (raw2) {
                    try { arr2 = JSON.parse(raw2) || []; } catch (e) { arr2 = []; }
                }
                const found2 = arr2.find(a => (typeof a === 'string' ? a : a.name) === 'playing with fire');
                if (!found2) {
                    arr2.push({ name: 'playing with fire', rarity: 'epic' });
                    localStorage.setItem('unlocked_titles', JSON.stringify(arr2));
                    try { showGambaAchievement('New Title: playing with fire', 'Rarity: epic'); } catch (e) {}
                }
            } catch (e) {}
        }
    } catch (e) {}
    // update dealer final line based on outcome
    try {
        if (outcome === 'win') setDealerText(pickRandom(_dealerMessages.win));
        else if (outcome === 'lose') setDealerText(pickRandom(_dealerMessages.lose));
        else setDealerText(pickRandom(_dealerMessages.opening));
    } catch (e) {}
    // reset UI
    btnHit.disabled = true; btnStand.disabled = true; btnPlaceBet.disabled = false; if (btnMaxBet) btnMaxBet.disabled = false;
    // clear persisted round state — round finished
    clearRoundState();
    // keep the in-round UI visible so final hands remain displayed for player review
    // clear current bet and UI input
    try {
        // show persistent win overlay for wins
        if (outcome === 'win') {
            try {
                const betStr = (hasDecimal ? String(currentBet) : String(currentBet));
                const label = (currentCurrency === 'count') ? 'What Happeneds' : (currentCurrency === 'diamonds') ? 'Gems' : 'Golden';
                window._gambaWinPersistent = true;
                showWinOverlay(`You won ${betStr} ${label}`);
            } catch (e) {}
        }
        // clear current bet and input, but leave card UI intact
        currentBet = null; if (betAmountEl) betAmountEl.value = ''; 
    } catch (e) {}
    setTimeout(()=>{ refreshBalanceDisplay(); }, 120);
}

// Dealer message system
const _dealerMessages = {
    opening: [
        'Place your bets please',
        'Feeling lucky tonight?',
        'Fortune favors the bold',
        'Every wager leaves a mark',
        'Once the cards fall, there is no turning back'
    ],
    inRound: [
        'Luck is borrowed, and it always comes time to collect',
        'The cards chose their master',
        "I've seen worse bets win big",
        'Careful, confidence loses money faster than bad luck',
        'You sure about that bet',
        "That's a brave bet. Let's see if it pays off."
    ],
    win: [
        "That's a winning hand. Congratulations.",
        'You Win',
        'Congratulations. Perhaps another round?',
        'Your bet paid off.'
    ],
    lose: [
        'Chance has a cruel sense of humor.',
        'Shake it off, next round\'s yours.',
        'You\'re still in it.',
        'Not a bad call—just didn\'t land this time.',
        'That\'s one way to go broke.',
        'The house is smiling tonight.',
        'Oof… tough luck. Maybe next hand.'
    ]
};

function pickRandom(arr){ if(!Array.isArray(arr)||arr.length===0) return ''; return arr[Math.floor(Math.random()*arr.length)]; }

let dealerIntervalId = null;
function setDealerText(msg){ try{ const d = document.getElementById('casinoDealerText'); if(d) d.innerText = String(msg || ''); }catch(e){} }
function startDealerInRoundCycle(){ try{ stopDealerInRoundCycle(); setDealerText(pickRandom(_dealerMessages.inRound)); dealerIntervalId = setInterval(()=>{ try{ setDealerText(pickRandom(_dealerMessages.inRound)); }catch(e){} }, 3200 + Math.floor(Math.random()*2200)); }catch(e){} }
function stopDealerInRoundCycle(){ try{ if(dealerIntervalId){ clearInterval(dealerIntervalId); dealerIntervalId = null; } }catch(e){}
}

// ensure initial dealer text on page entry and hook round lifecycle
try{
    // prefer banner element; if not present use inline dealer area
    const dealerTextEl = document.getElementById('casinoDealerText');
    if (dealerTextEl) setDealerText(pickRandom(_dealerMessages.opening));
}catch(e){}

function showWinOverlay(msg){
    try {
        // remove existing timeout
        if (winTimeoutId) { clearTimeout(winTimeoutId); winTimeoutId = null; }
        let el = document.getElementById('gambaWinOverlay');
        if (!el) {
            el = document.createElement('div'); el.id = 'gambaWinOverlay';
            Object.assign(el.style, {
                position: 'fixed', left: '50%', top: '20%', transform: 'translateX(-50%)',
                background: 'rgba(255, 215, 0, 0.95)', color: '#000', padding: '16px 22px',
                borderRadius: '8px', boxShadow: '0 6px 18px rgba(0,0,0,0.4)', zIndex: 9999,
                fontSize: '18px', fontWeight: '700'
            });
            document.body.appendChild(el);
        }
        el.innerText = msg || 'You win!';
        el.style.display = 'block';
        // by default auto-hide after 5s; callers may set persistent overlay by setting window._gambaWinPersistent=true
        if (!window._gambaWinPersistent) {
            winTimeoutId = setTimeout(()=>{ try { hideWinOverlay(); } catch(e){} }, 5000);
        }
    } catch (e) { /* ignore overlay failures */ }
}

// small achievement popup shown on the casino page when an achievement/title is newly unlocked
function showGambaAchievement(title, subtitle){
    try{
        let el = document.getElementById('gambaAchOverlay');
        if(!el){
            el = document.createElement('div'); el.id = 'gambaAchOverlay';
            Object.assign(el.style, {
                position: 'fixed', left: '50%', top: '8%', transform: 'translateX(-50%)',
                background: 'linear-gradient(180deg,#ffd966,#ffb84d)', color: '#000', padding: '10px 14px',
                borderRadius: '8px', boxShadow: '0 8px 30px rgba(0,0,0,0.45)', zIndex: 9999, textAlign: 'center', minWidth: '220px', fontWeight: 800
            });
            document.body.appendChild(el);
        }
        el.innerHTML = `<div style="font-size:15px;margin-bottom:4px">${String(title||'Achievement')}</div><div style="font-size:13px;color:#111">${String(subtitle||'')}</div>`;
        el.style.display = 'block';
        if (el._timeout) { clearTimeout(el._timeout); el._timeout = null; }
        el._timeout = setTimeout(()=>{ try{ el.style.display = 'none'; }catch(e){} }, 4200);
    }catch(e){ try{ console.warn('showGambaAchievement failed', e); }catch(e){} }
}

function hideWinOverlay(){
    try {
        if (winTimeoutId) { clearTimeout(winTimeoutId); winTimeoutId = null; }
        const el = document.getElementById('gambaWinOverlay');
        if (el) { el.style.display = 'none'; }
    } catch (e) {}
}

// Mystery buff implementation (extracted to top-level so it can be restored on reload)
function startMysteryBuff(expiresAt){
    try{
        if(window._gambaMystery && window._gambaMystery.active) return;
        window._gambaMystery = { active:true, timers:[] };
        const endAt = expiresAt || (Date.now() + 5*60*1000);
        // add glitchy CSS (one-time)
        try{
            const styleId = 'gamba-mystery-style';
            if(!document.getElementById(styleId)){
                const st = document.createElement('style'); st.id = styleId;
                st.innerHTML = `@keyframes gamba-glitch{0%{filter:none;transform:none}20%{filter:contrast(2) hue-rotate(20deg) blur(1px);transform:translate(2px, -1px)}40%{filter:invert(.2) hue-rotate(-20deg);transform:translate(-3px,1px)}60%{filter:sepia(.3) hue-rotate(60deg);transform:translate(1px,-2px)}80%{filter:saturate(1.8) hue-rotate(120deg);transform:translate(-1px,2px)}100%{filter:none;transform:none}}.mystery-glitch{animation:gamba-glitch 300ms infinite;} .mystery-flash{background:linear-gradient(90deg, rgba(255,255,255,0.03), rgba(255,0,0,0.02));}`;
                document.head.appendChild(st);
            }
            document.body.classList.add('mystery-glitch');
        }catch(e){}

        // CPS ramp: choose a randomized peak between 3x and 6x
        const dur = Math.max(10000, endAt - Date.now());
        const start = Date.now();
        const peak = 3 + Math.random() * 3; // 3.0 - 6.0
        // backup base values
        if(typeof window.cps !== 'undefined') window._gambaMystery.baseCps = window._gambaMystery.baseCps || window.cps;
        if(typeof window.clickPower !== 'undefined') window._gambaMystery.baseClick = window._gambaMystery.baseClick || window.clickPower;

        // progressive CPS increase: ramp from 1x to peak over duration, with small jitter
        window._gambaMystery.cpsInterval = setInterval(()=>{
            try{
                const now = Date.now();
                const tRaw = Math.min(1, (now - start)/dur);
                const t = tRaw * tRaw * (3 - 2 * tRaw);
                const mult = 1 + t * (peak - 1);
                    if((typeof window.cps !== 'undefined' || typeof cps !== 'undefined') && window._gambaMystery.baseCps !== undefined){
                        const jitter = 1 + ((Math.random()*2-1) * 0.05);
                        const finalMult = mult * jitter;
                        const base = window._gambaMystery.baseCps;
                        try{ setGlobalCps(hasDecimal ? D(base).times(finalMult) : Number(base) * finalMult); }catch(e){}
                    }
            }catch(e){}
        }, 1000);
        window._gambaMystery.timers.push(window._gambaMystery.cpsInterval);

        // occasional click power spikes/reductions: chance every 1.5s to apply a temporary ±30% change
        window._gambaMystery.clickSpikeInterval = setInterval(()=>{
            try{
                if(typeof window.clickPower === 'undefined' || window._gambaMystery.baseClick === undefined) return;
                if(Math.random() > 0.45) return;
                const r = 1 + ((Math.random()*2-1) * 0.3);
                            try{ setGlobalClickPower(hasDecimal ? D(window._gambaMystery.baseClick).times(r) : Number(window._gambaMystery.baseClick) * r); }catch(e){}
                const spikeDur = 300 + Math.floor(Math.random()*1100);
                const restore = setTimeout(()=>{
                    try{ setGlobalClickPower(window._gambaMystery.baseClick); }catch(e){}
                    try{ updateCpsClickDisplay(); }catch(e){}
                }, spikeDur);
                window._gambaMystery.timers.push(restore);
            }catch(e){}
        }, 1500);
        window._gambaMystery.timers.push(window._gambaMystery.clickSpikeInterval);

        // falling-image bursts
        window._gambaMystery.fallMasterInterval = setInterval(()=>{
            try{
                if(Math.random() > 0.35) return;
                const burstDur = 1000 + Math.floor(Math.random() * 14000);
                const burstInterval = setInterval(()=>{
                    try{
                        if(typeof spawnFallingImage === 'function'){
                            const count = (Math.random() < 0.2) ? 3 + Math.floor(Math.random()*5) : 1;
                            for(let i=0;i<count;i++){
                                try{ spawnFallingImage(Math.random() < 0.18); }catch(e){}
                            }
                        }
                    }catch(e){}
                }, 60 + Math.floor(Math.random()*140));
                window._gambaMystery.timers.push(burstInterval);
                const stopBurst = setTimeout(()=>{ try{ clearInterval(burstInterval); }catch(e){} }, burstDur);
                window._gambaMystery.timers.push(stopBurst);
            }catch(e){}
        }, 3000 + Math.floor(Math.random()*2000));
        window._gambaMystery.timers.push(window._gambaMystery.fallMasterInterval);

        try{
            let fc = document.getElementById('falling-container');
            if(!fc){ fc = document.createElement('div'); fc.id = 'falling-container'; document.body.appendChild(fc); }
            fc.style.position = 'fixed'; fc.style.left = '0'; fc.style.top = '0'; fc.style.width = '100%'; fc.style.height = '100%';
            fc.style.pointerEvents = 'none'; fc.style.overflow = 'hidden'; fc.style.zIndex = '2000';
        }catch(e){}

        try{
            if(typeof spawnFallingImage === 'function'){
                for(let i=0;i<300;i++){ try{ spawnFallingImage(Math.random() < 0.18); }catch(e){} }
            }
        }catch(e){}
        window._gambaMystery.intenseFallInterval = setInterval(()=>{
            try{
                if(typeof spawnFallingImage === 'function'){
                    for(let i=0;i<25;i++){ try{ spawnFallingImage(Math.random() < 0.18); }catch(e){} }
                }
            }catch(e){}
        }, 50);
        window._gambaMystery.timers.push(window._gambaMystery.intenseFallInterval);

        try{ updateCpsClickDisplay(); }catch(e){}

        window._gambaMystery.clickBurstHandler = function(ev){
            try{ if (ev && ev.isTrusted === false) return; }catch(e){}
            try{
                if(Math.random() > 0.40) return;
                const burstDur = 1000 + Math.floor(Math.random()*14000);
                const burstInterval = setInterval(()=>{
                    try{
                        for(let i=0;i<50;i++){
                            try{ spawnFallingImage(Math.random() < 0.18); }catch(e){}
                        }
                    }catch(e){}
                }, 50);
                window._gambaMystery.timers.push(burstInterval);
                const stopB = setTimeout(()=>{ try{ clearInterval(burstInterval); }catch(e){} }, burstDur);
                window._gambaMystery.timers.push(stopB);
            }catch(e){}
        };
        document.addEventListener('click', window._gambaMystery.clickBurstHandler, true);
        window._gambaMystery.timers.push(window._gambaMystery.clickBurstHandler);

        window._gambaMystery.clickHandler = function(ev){
            try { if (ev && ev.isTrusted === false) return; } catch(e) {}
            try{
                if(Math.random() > 0.30) return;
                const repeats = 2 + Math.floor(Math.random()*4);
                for(let i=0;i<repeats;i++){
                    setTimeout(()=>{ try{ ev.target.click(); }catch(e){} }, 30 * (i+1));
                }
            }catch(e){}
        };
        document.addEventListener('click', window._gambaMystery.clickHandler, true);
        window._gambaMystery.timers.push(window._gambaMystery.clickHandler);

        const remaining = endAt - Date.now();
        window._gambaMystery.stopTimeout = setTimeout(()=>{ stopMysteryBuff(); }, remaining+500);
        window._gambaMystery.timers.push(window._gambaMystery.stopTimeout);
    }catch(e){console.error('startMysteryBuff failed',e);}    
}

function stopMysteryBuff(){
    try{
        if(!window._gambaMystery) return;
        try{ if(window._gambaMystery.cpsInterval) clearInterval(window._gambaMystery.cpsInterval); }catch(e){}
        try{ if(window._gambaMystery.clickSpikeInterval) clearInterval(window._gambaMystery.clickSpikeInterval); }catch(e){}
        try{ if(window._gambaMystery.fallMasterInterval) clearInterval(window._gambaMystery.fallMasterInterval); }catch(e){}
        try{
            if(Array.isArray(window._gambaMystery.timers)){
                window._gambaMystery.timers.forEach(t=>{
                    try{ clearInterval(t); }catch(e){}
                    try{ clearTimeout(t); }catch(e){}
                });
            }
        }catch(e){}
        try{ if(window._gambaMystery.clickHandler) document.removeEventListener('click', window._gambaMystery.clickHandler, true); }catch(e){}
        try{ if(window._gambaMystery.clickBurstHandler) document.removeEventListener('click', window._gambaMystery.clickBurstHandler, true); }catch(e){}
        try{ if(window._gambaMystery.intenseFallInterval) clearInterval(window._gambaMystery.intenseFallInterval); }catch(e){}
        try{ if(window._gambaMystery.baseCps !== undefined) setGlobalCps(window._gambaMystery.baseCps); }catch(e){}
        try{ if(window._gambaMystery.baseClick !== undefined) setGlobalClickPower(window._gambaMystery.baseClick); }catch(e){}
        try{ updateCpsClickDisplay(); }catch(e){}
        try{ document.body.classList.remove('mystery-glitch'); }catch(e){}
        window._gambaMystery = null;
    }catch(e){console.error('stopMysteryBuff failed',e);}    
}

// Restore any active spin buffs from saved state (called at startup)
function restoreSpinBuffs(){
    try{
        const spin = loadSpinState(); if (!spin || !spin.buff) return;
        const buff = spin.buff;
        const now = Date.now();
        if (buff.expiresAt && Number(buff.expiresAt) <= now) return; // already expired
        const remaining = buff.expiresAt ? Math.max(0, Number(buff.expiresAt) - now) : null;
        if (buff.type === 'crit'){
            try{ window.casinoCritBonus = buff.value || 0.15; window.casinoCritExpires = buff.expiresAt; }catch(e){}
            if (remaining) setTimeout(()=>{ try{ if(window.casinoCritExpires && Date.now()>=window.casinoCritExpires){ window.casinoCritBonus = 0; window.casinoCritExpires = null; } }catch(e){} }, remaining+500);
        } else if (buff.type === 'clickBoost'){
            try{
                window._gambaClickBackup = window._gambaClickBackup || {};
                if (!window._gambaClickBackup.hasOwnProperty('clickPower')){
                    try { window._gambaClickBackup.clickPower = (typeof clickPower !== 'undefined') ? clickPower : window.clickPower; } catch(e) { window._gambaClickBackup.clickPower = window.clickPower; }
                    try{ setGlobalClickPower(hasDecimal ? D(window._gambaClickBackup.clickPower).times(buff.mult || 10) : Number(window._gambaClickBackup.clickPower) * (buff.mult || 10)); }catch(e){}
                }
            }catch(e){}
            if (remaining) setTimeout(()=>{ try{ if (window._gambaClickBackup && window._gambaClickBackup.clickPower !== undefined){ setGlobalClickPower(window._gambaClickBackup.clickPower); delete window._gambaClickBackup.clickPower; } }catch(e){} try{ updateCpsClickDisplay(); }catch(e){} }, remaining+500);
        } else if (buff.type === 'cpsBoost'){
            try{
                window._gambaCpsBackup = window._gambaCpsBackup || {};
                if (!window._gambaCpsBackup.hasOwnProperty('cps')){
                    try { window._gambaCpsBackup.cps = (typeof cps !== 'undefined') ? cps : window.cps; } catch(e) { window._gambaCpsBackup.cps = window.cps; }
                    try{ setGlobalCps(hasDecimal ? D(window._gambaCpsBackup.cps).times(buff.mult || 10) : Number(window._gambaCpsBackup.cps) * (buff.mult || 10)); }catch(e){}
                }
            }catch(e){}
            if (remaining) setTimeout(()=>{ try{ if (window._gambaCpsBackup && window._gambaCpsBackup.cps !== undefined){ setGlobalCps(window._gambaCpsBackup.cps); delete window._gambaCpsBackup.cps; } }catch(e){} try{ updateCpsClickDisplay(); }catch(e){} }, remaining+500);
        } else if (buff.type === 'mystery'){
            try{ startMysteryBuff(buff.expiresAt); }catch(e){}
        }
        try{ updateCpsClickDisplay(); }catch(e){}
        try{ const res = document.getElementById('spinResult'); if (res && spin.lastResult) res.innerText = spin.lastResult; }catch(e){}
    }catch(e){ console.error('restoreSpinBuffs', e); }
}

function dealerPlay(){
    while(scoreHand(dealerHand) < 17) dealerHand.push(deck.pop());
}

function saveRoundState(){
    try {
        const state = {
            inRound: (gameArea && gameArea.style.display === 'block'),
            deck: deck || [],
            playerHand: playerHand || [],
            dealerHand: dealerHand || [],
            currentBet: currentBet || null,
            currentCurrency: currentCurrency || 'count',
            ts: Date.now()
        };
        localStorage.setItem(GAMBA_ROUND_KEY, JSON.stringify(state));
    } catch (e) { /* ignore */ }
}

function clearRoundState(){
    try { localStorage.removeItem(GAMBA_ROUND_KEY); } catch (e) {}
}

function loadRoundState(){
    try {
        const raw = localStorage.getItem(GAMBA_ROUND_KEY);
        if (!raw) return false;
        const s = JSON.parse(raw);
        if (!s || !s.inRound) return false;
        deck = Array.isArray(s.deck) ? s.deck.slice() : createDeck();
        playerHand = Array.isArray(s.playerHand) ? s.playerHand.slice() : [];
        dealerHand = Array.isArray(s.dealerHand) ? s.dealerHand.slice() : [];
        currentBet = s.currentBet ?? currentBet;
        currentCurrency = s.currentCurrency || currentCurrency || 'count';
        // restore UI state
        try { if (betAmountEl && currentBet != null) betAmountEl.value = String(currentBet); } catch (e) {}
        gameArea.style.display = 'block';
        btnPlaceBet.disabled = true; btnHit.disabled = false; btnStand.disabled = false; if (btnMaxBet) btnMaxBet.disabled = true;
        updateUI(false);
        return true;
    } catch (e) { return false; }
}

btnPlaceBet.addEventListener('click', ()=>{
    const amtRaw = betAmountEl.value.trim();
    if (!amtRaw) return alert('Enter bet amount');
    saveObj = loadSave(); if (!saveObj) return alert('No save found');
    currentCurrency = betCurrencyEl.value;
    const field = (currentCurrency==='count') ? 'count' : (currentCurrency==='diamonds') ? 'diamonds' : 'goldenWhat';
    const bal = readBalanceField(saveObj, field);
    // parse and validate amount with Decimal support
    if (hasDecimal) {
        let amtD;
        try { amtD = D(amtRaw); if (!amtD.isFinite() || amtD.lte(0)) return alert('Invalid bet amount'); } catch (e) { return alert('Invalid bet amount'); }
        try { if (bal && typeof bal.lt === 'function' && bal.lt(amtD)) return alert('Insufficient funds'); } catch (e) { if (Number(bal) < Number(amtD)) return alert('Insufficient funds'); }
        currentBet = amtD.toString();
    } else {
        const amt = Number(amtRaw);
        if (!Number.isFinite(amt) || amt <= 0) return alert('Invalid bet amount');
        if (amt > bal) return alert('Insufficient funds');
        currentBet = amt;
    }
    // lock UI and start round
    btnPlaceBet.disabled = true; btnHit.disabled = false; btnStand.disabled = false; if (btnMaxBet) btnMaxBet.disabled = true; resultEl.innerText = '';
    gameArea.style.display = 'block';
    startNewRound();
    // start dealer in-round messages
    try { startDealerInRoundCycle(); } catch (e) {}
    // immediate blackjack check
    const pScore = scoreHand(playerHand);
    if (pScore === 21) {
        // player blackjack -> immediate win
        updateUI(true);
        endRound('win');
        return;
    }
});
// Hit / Stand handlers
if (btnHit) btnHit.addEventListener('click', ()=>{
    try{
        if (!deck || deck.length === 0) deck = shuffle(createDeck());
        playerHand.push(deck.pop());
        updateUI();
        const p = scoreHand(playerHand);
        if (p > 21) {
            // player busted
            updateUI(true);
            endRound('lose');
        }
    }catch(e){console.error('Hit failed',e);}    
});
if (btnStand) btnStand.addEventListener('click', ()=>{
    try{
        dealerPlay();
        updateUI(true);
        const p = scoreHand(playerHand);
        const d = scoreHand(dealerHand);
        let outcome = 'push';
        if (d > 21) outcome = 'win';
        else if (p > d) outcome = 'win';
        else if (p < d) outcome = 'lose';
        endRound(outcome);
    }catch(e){console.error('Stand failed',e);}    
});
// init
    // --- Daily Spin system ---
    function getTodayDateStr(){
        const d = new Date();
        // produce local date string for daily reset at local midnight (00:00)
        return d.getFullYear() + '-' + String(d.getMonth()+1).padStart(2,'0') + '-' + String(d.getDate()).padStart(2,'0');
    }

    function loadSpinState(){
        try {
            const s = loadSave(); if (!s) return null;
            return s.casinoSpin || null;
        } catch (e) { return null; }
    }

    function ensureSaveExists(){
        try {
            let s = loadSave();
            if (s) return s;
            s = {};
            // initialize minimal required fields so casino can operate
            try { writeBalanceField(s, 'count', hasDecimal ? D(0).toString() : 0); } catch(e) { s.count = hasDecimal ? String(D(0)) : 0; }
            try { writeBalanceField(s, 'diamonds', hasDecimal ? D(0).toString() : 0); } catch(e) { s.diamonds = hasDecimal ? String(D(0)) : 0; }
            s.goldenWhat = 0;
            s.version = 3;
            persistSave(s);
            try { localStorage.setItem(SAVE_KEY_LEGACY, JSON.stringify(s)); } catch (e) {}
            return s;
        } catch (e) { return null; }
    }

    function canSpin(){
        const spin = loadSpinState();
        const today = getTodayDateStr();
        if (!spin || !spin.lastSpinDate) return true;
        return spin.lastSpinDate !== today;
    }

    function updateSpinUI(){
        try {
            const btn = document.getElementById('btnSpin');
            const info = document.getElementById('spinInfo');
            const result = document.getElementById('spinResult');
            if (!btn || !info || !result) return;
            const spin = loadSpinState();
            const today = getTodayDateStr();
            if (!spin || !spin.lastSpinDate) {
                btn.disabled = false; info.innerText = 'Spin once per day. Resets at 12:00 AM local time.'; result.innerText = '';
                return;
            }
            if (spin.lastSpinDate === today) {
                btn.disabled = true; info.innerText = 'You have spun today. Come back tomorrow.';
                if (spin.lastResult) result.innerText = spin.lastResult;
                return;
            }
            btn.disabled = false; info.innerText = 'Spin once per day. Resets at 12:00 AM local time.'; result.innerText = '';
        } catch (e) {}
    }

    function persistSpin(saveObj, spinObj){
        try { saveObj.casinoSpin = spinObj; persistSave(saveObj); } catch (e) {}
    }

    function pickReward(){
        const pool = getRewardPool();
        const idx = Math.floor(Math.random()*pool.length);
        return { index: idx, reward: pool[idx], poolLength: pool.length };
    }

    function getRewardPool(){
        // create exactly 12 segments to match the wheel graphic
        const pool = [];
        // distribution (12): 4x 5 gems, 2x 10 gems, 2x crit(+15% 30m), 1x click x10 (1m), 1x cps x10 (30s), 1x mystery, 1x jackpot 50
        // order chosen to alternate visually
        pool.push({type:'gems',amount:5});
        pool.push({type:'crit',value:0.15,durationMin:30});
        pool.push({type:'gems',amount:5});
        pool.push({type:'clickBoost',mult:10,durationSec:60});
        pool.push({type:'gems',amount:5});
        pool.push({type:'cpsBoost',mult:10,durationSec:30});
        pool.push({type:'gems',amount:5});
        pool.push({type:'crit',value:0.15,durationMin:30});
        pool.push({type:'gems',amount:10});
        pool.push({type:'mystery',durationMin:5});
        pool.push({type:'gems',amount:10});
        pool.push({type:'gems',amount:50,jackpot:true});
        return pool;
    }

    function ensureWheelBuilt(){
        try{
            const img = document.getElementById('spinWheel');
            if(!img) return;
            if(document.getElementById('spinWheelWrap')) return;
            const wrap = document.createElement('div'); wrap.id = 'spinWheelWrap';
            wrap.style.position = 'relative';
            wrap.style.width = img.width ? img.width + 'px' : (img.style.width || '420px');
            wrap.style.height = img.height ? img.height + 'px' : (img.style.height || '420px');
            wrap.style.margin = '0 auto';
            wrap.style.display = 'inline-block';
            const parent = img.parentElement;
            if(!parent) return;
            parent.replaceChild(wrap, img);
            img.style.position = 'absolute'; img.style.left = '0'; img.style.top = '0'; img.style.width = '100%'; img.style.height = '100%';
            wrap.appendChild(img);
            const overlay = document.createElement('div'); overlay.id = 'spinWheelOverlay';
            overlay.style.position = 'absolute'; overlay.style.left = '0'; overlay.style.top = '0'; overlay.style.width = '100%'; overlay.style.height = '100%'; overlay.style.pointerEvents = 'none';
            wrap.appendChild(overlay);
            buildWheelOverlay();
        }catch(e){console.error('ensureWheelBuilt',e);}    
    }

    function buildWheelOverlay(){
        try{
            const wrap = document.getElementById('spinWheelWrap');
            const overlay = document.getElementById('spinWheelOverlay');
            const img = document.getElementById('spinWheel');
            if(!wrap || !overlay || !img) return;
            overlay.innerHTML = '';
            const pool = getRewardPool();
            const segments = pool.length || 16;
            const w = wrap.clientWidth || parseInt(w.style.width) || 220;
            const radius = (w/2) - 48;
            const segmentAngle = 360 / segments;
            for(let i=0;i<segments;i++){
                const seg = document.createElement('div');
                seg.className = 'wheel-seg';
                seg.style.position = 'absolute';
                seg.style.left = '50%'; seg.style.top = '50%';
                // center the label within its segment by offsetting by half a segment
                const angle = i * segmentAngle + (segmentAngle/2);
                const reward = pool[i];
                let txt = '';
                if(reward.type === 'gems') txt = (reward.jackpot ? reward.amount + ' Gems (JACKPOT)' : reward.amount + ' Gems');
                else if(reward.type === 'crit') txt = '+' + Math.round((reward.value||0.15)*100) + '% crit';
                else if(reward.type === 'clickBoost') txt = 'x' + (reward.mult||10) + ' click';
                else if(reward.type === 'cpsBoost') txt = 'x' + (reward.mult||10) + ' CPS';
                else if(reward.type === 'mystery') txt = '???';
                seg.innerText = txt;
                seg.style.whiteSpace = 'nowrap';
                // alternate text color so labels are readable on alternating wheel backgrounds
                // assume wheel sections alternate (index 0 = dark/red, 1 = light/white)
                seg.style.color = (i % 2 === 1) ? '#000' : '#fff';
                seg.style.fontSize = '11px';
                seg.style.fontWeight = '700';
                seg.style.textAlign = 'center';
                seg.style.padding = '2px 6px';
                seg.style.transform = `rotate(${angle}deg) translateY(-${radius}px) rotate(${-angle}deg)`;
                // alternate text color so labels are readable on alternating wheel backgrounds
                seg.style.color = (i % 2 === 1) ? '#000' : '#fff';
                overlay.appendChild(seg);
            }
        }catch(e){console.error('buildWheelOverlay failed',e);}    
    }

    function performSpin(){
        try {
            saveObj = loadSave(); if (!saveObj) saveObj = ensureSaveExists();
            if (!saveObj) return alert('No save found');
            if (!canSpin()) return alert('You already spun today');
            const rewardObj = pickReward();
            // animate the wheel first, then apply the reward
            try { animateWheelThenApply(rewardObj); } catch (e) { applyRewardImmediate(rewardObj); }
            return;
        } catch (e) { console.error('Spin failed', e); }
    }

    function applyRewardImmediate(rewardObj){
        try {
            saveObj = loadSave(); if (!saveObj) return;
            const today = getTodayDateStr();
            const spinState = { lastSpinDate: today, lastResult: '' };
            const reward = rewardObj && rewardObj.reward ? rewardObj.reward : rewardObj;
            if (reward.type === 'gems'){
                const gems = readBalanceField(saveObj,'diamonds');
                if (hasDecimal) {
                    const newG = (typeof gems.plus === 'function') ? gems.plus(D(reward.amount)) : D(Number(gems||0)).plus(D(reward.amount));
                    writeBalanceField(saveObj,'diamonds',newG);
                } else {
                    const newG = Number(gems||0) + Number(reward.amount);
                    writeBalanceField(saveObj,'diamonds',newG);
                }
                spinState.lastResult = `Gained ${reward.amount} Gems${reward.jackpot? ' (JACKPOT!)' : ''}`;
                persistSpin(saveObj, spinState);
                persistSave(saveObj);
                refreshBalanceDisplay();
                document.getElementById('spinResult').innerText = spinState.lastResult;
                updateSpinUI();
                return;
            }
            
            // Mystery buff handled by top-level startMysteryBuff/stopMysteryBuff so it can be restored on load
            // new reward types: crit, clickBoost, cpsBoost, mystery
            if (reward.type === 'crit'){
                const durMin = reward.durationMin || 30;
                const expiresAt = Date.now() + durMin*60*1000;
                spinState.buff = { type:'crit', value: reward.value || 0.15, expiresAt };
                spinState.lastResult = `Crit chance +${Math.round((reward.value||0.15)*100)}% for ${durMin} minutes`;
                // apply runtime flag
                try { window.casinoCritBonus = reward.value || 0.15; window.casinoCritExpires = expiresAt; } catch(e){}
                try { saveObj.casinoSpin = spinState; persistSave(saveObj); } catch(e){}
                document.getElementById('spinResult').innerText = spinState.lastResult;
                persistSpin(saveObj, spinState);
                // schedule clear
                setTimeout(()=>{ try{ if(window.casinoCritExpires && Date.now()>=window.casinoCritExpires){ window.casinoCritBonus = 0; window.casinoCritExpires = null; } }catch(e){} }, (durMin*60*1000)+500);
                updateSpinUI();
                return;
            }
            if (reward.type === 'clickBoost'){
                const durSec = reward.durationSec || 60;
                const expiresAt = Date.now() + durSec*1000;
                spinState.buff = { type:'clickBoost', mult: reward.mult || 10, multiplier: reward.mult || 10, expiresAt };
                spinState.lastResult = `Click power x${reward.mult || 10} for ${Math.round(durSec/60)} minute(s)`;
                // apply immediate multiplier by adjusting global clickPower and recording original
                try{
                    window._gambaClickBackup = window._gambaClickBackup || {};
                    if (!window._gambaClickBackup.hasOwnProperty('clickPower')){
                        try { window._gambaClickBackup.clickPower = (typeof clickPower !== 'undefined') ? clickPower : window.clickPower; } catch(e) { window._gambaClickBackup.clickPower = window.clickPower; }
                        try{ setGlobalClickPower(hasDecimal ? D(window._gambaClickBackup.clickPower).times(reward.mult || 10) : Number(window._gambaClickBackup.clickPower) * (reward.mult || 10)); }catch(e){}
                    }
                    try{ updateCpsClickDisplay(); }catch(e){}
                }catch(e){}
                try { saveObj.casinoSpin = spinState; persistSave(saveObj); } catch(e){}
                document.getElementById('spinResult').innerText = spinState.lastResult;
                persistSpin(saveObj, spinState);
                // restore after duration
                setTimeout(()=>{
                    try{ if (window._gambaClickBackup && window._gambaClickBackup.clickPower !== undefined){ setGlobalClickPower(window._gambaClickBackup.clickPower); delete window._gambaClickBackup.clickPower; } }catch(e){}
                    try{ updateCpsClickDisplay(); }catch(e){}
                }, durSec*1000 + 500);
                updateSpinUI();
                return;
            }
            if (reward.type === 'cpsBoost'){
                const durSec = reward.durationSec || 30;
                const expiresAt = Date.now() + durSec*1000;
                spinState.buff = { type:'cpsBoost', mult: reward.mult || 10, multiplier: reward.mult || 10, expiresAt };
                spinState.lastResult = `CPS x${reward.mult || 10} for ${durSec} seconds`;
                try{
                    window._gambaCpsBackup = window._gambaCpsBackup || {};
                    if (!window._gambaCpsBackup.hasOwnProperty('cps')){
                        try { window._gambaCpsBackup.cps = (typeof cps !== 'undefined') ? cps : window.cps; } catch(e) { window._gambaCpsBackup.cps = window.cps; }
                        try{ setGlobalCps(hasDecimal ? D(window._gambaCpsBackup.cps).times(reward.mult || 10) : Number(window._gambaCpsBackup.cps) * (reward.mult || 10)); }catch(e){}
                    }
                    try{ updateCpsClickDisplay(); }catch(e){}
                }catch(e){}
                try { saveObj.casinoSpin = spinState; persistSave(saveObj); } catch(e){}
                document.getElementById('spinResult').innerText = spinState.lastResult;
                persistSpin(saveObj, spinState);
                setTimeout(()=>{
                    try{ if (window._gambaCpsBackup && window._gambaCpsBackup.cps !== undefined){ setGlobalCps(window._gambaCpsBackup.cps); delete window._gambaCpsBackup.cps; } }catch(e){}
                    try{ updateCpsClickDisplay(); }catch(e){}
                }, durSec*1000 + 500);
                updateSpinUI();
                return;
            }
            if (reward.type === 'mystery'){
                // complex rare buff lasting 2 minutes
                const durMin = reward.durationMin || 2;
                const expiresAt = Date.now() + durMin*60*1000;
                spinState.buff = { type:'mystery', expiresAt };
                spinState.lastResult = `MYSTERY BUFF! Effects for ${durMin} minutes`;
                try { saveObj.casinoSpin = spinState; persistSave(saveObj); } catch(e){}
                document.getElementById('spinResult').innerText = spinState.lastResult;
                persistSpin(saveObj, spinState);
                // start mystery effects
                startMysteryBuff(expiresAt);
                updateSpinUI();
                return;
            }
        } catch (e) { console.error('applyRewardImmediate failed', e); }
    }

    function animateWheelThenApply(rewardObj){
        ensureWheelBuilt();
        const wrap = document.getElementById('spinWheelWrap');
        const wheel = document.getElementById('spinWheel');
        const btn = document.getElementById('btnSpin');
        const target = wrap || wheel;
        if (!target) { applyRewardImmediate(rewardObj); return; }
        try {
            if (btn) btn.disabled = true;
            // reset any existing transition
            target.style.transition = 'none';
            target.style.transform = 'rotate(0deg)';
            // force reflow
            void target.offsetWidth;
            // compute target based on index/segments
            const idx = (typeof rewardObj.index === 'number') ? rewardObj.index : 0;
            const segments = rewardObj.poolLength || 16;
            const segmentAngle = 360 / segments;
            // center of the target segment
            const centerAngle = idx * segmentAngle + (segmentAngle / 2);
            // random offset within +/-30% of segment to feel natural
            const within = (segmentAngle * 0.3);
            const randOff = (Math.random() - 0.5) * 2 * within;
            const finalAngle = centerAngle + randOff;
            const extraSpins = 4 + Math.floor(Math.random()*4);
            const final = extraSpins * 360 + finalAngle;
            target.style.transition = 'transform 4s cubic-bezier(.2,.9,.2,1)';
            target.style.transform = 'rotate(' + final + 'deg)';
            const onEnd = function(){
                try { target.removeEventListener('transitionend', onEnd); } catch (e) {}
                try { applyRewardImmediate(rewardObj); } catch (e) { console.error(e); }
                setTimeout(()=>{ try { updateSpinUI(); if (btn) btn.disabled = !canSpin(); } catch(e){} }, 120);
            };
            target.addEventListener('transitionend', onEnd);
        } catch (e) { console.error('animateWheel failed', e); applyRewardImmediate(rewardObj); }
    }

    // attach spin button
    try { const sb = document.getElementById('btnSpin'); if (sb) sb.addEventListener('click', ()=>{ performSpin(); updateSpinUI(); }); } catch (e) {}

    // try to restore any in-progress round before showing balances
    const _restoredRound = loadRoundState();
    // if a round was restored, start the dealer in-round message cycle
    try{ if (gameArea && gameArea.style.display === 'block') { startDealerInRoundCycle(); } }catch(e){}
    updateSpinUI();
    refreshBalanceDisplay();
refreshBalanceDisplay();
// build wheel overlay labels
ensureWheelBuilt();
try{ restoreSpinBuffs(); }catch(e){}
window.addEventListener('resize', ()=>{ try{ buildWheelOverlay(); }catch(e){} });

    // schedule a refresh at the next local midnight so the daily spin availability updates correctly
    function scheduleSpinReset(){
        try{
            const now = new Date();
            const next = new Date(now.getFullYear(), now.getMonth(), now.getDate() + 1);
            const ms = next.getTime() - now.getTime();
            setTimeout(()=>{
                try{ updateSpinUI(); scheduleSpinReset(); }catch(e){}
            }, ms + 50);
        }catch(e){}
    }
    scheduleSpinReset();

// persist round state on unload so reloads restore mid-round
window.addEventListener('beforeunload', () => {
    try {
        // only save if a round is active (gameArea visible)
        if (gameArea && gameArea.style.display === 'block') saveRoundState();
        else clearRoundState();
    } catch (e) {}
});

// expose quick helpers for debugging
window.__gamba = { refreshBalanceDisplay };
