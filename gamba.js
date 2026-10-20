// gamba.js — the casino page: blackjack, slots, the rocket and the daily spin.
// Balances live in the main game save (whathappened_save). A bet is taken from the save when a round starts and the
// payout is written as soon as the outcome is decided (before any animation), so reloading the page can't dodge a loss.

const SAVE_KEY = 'whathappened_save';
const SAVE_KEY_LEGACY = 'whathappened_save_v1';
const GAMBA_ROUND_KEY = 'whathappened_gamba_round';   // blackjack hand in progress
const ROCKET_KEY = 'whathappened_rocket_round';       // rocket in flight
const STATS_KEY = 'whathappened_casino_stats';        // read by achievements-data.js too
const PREFS_KEY = 'whathappened_casino_prefs';        // last game tab, currency and bet

const CUR_LABEL = { count: 'What Happeneds', diamonds: 'Gems', goldenWhat: 'Golden' };
const CUR_SHORT = { count: 'WH', diamonds: 'Gems', goldenWhat: 'Golden' };
const GAME_LABEL = { blackjack: '🃏 Blackjack', slots: '🎰 Slots', rocket: '🚀 Rocket' };

const $ = id => document.getElementById(id);
const sleep = ms => new Promise(r => setTimeout(r, ms));
function pickRandom(arr) { return Array.isArray(arr) && arr.length ? arr[Math.floor(Math.random() * arr.length)] : ''; }
function escapeHtml(s) { return String(s).replace(/[&<>'"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', "'": '&#39;', '"': '&quot;' })[c]); }

// compact number: 1234567 -> "1.23M"
function shortNum(v) {
    const n = Number(v) || 0;
    const units = ['', 'K', 'M', 'B', 'T', 'Q', 'Qi', 'Sx', 'Sp', 'Oc', 'No', 'Dc'];
    let i = 0, x = Math.abs(n);
    while (x >= 1000 && i < units.length - 1) { x /= 1000; i++; }
    if (i === 0) return String(Math.floor(n));
    if (x >= 1000) return n.toExponential(2);
    let digits = x.toFixed(x < 100 ? 2 : 0);
    if (digits.indexOf('.') !== -1) digits = digits.replace(/0+$/, '').replace(/\.$/, '');
    return (n < 0 ? '-' : '') + digits + units[i];
}
const signed = n => (n > 0 ? '+' : n < 0 ? '−' : '') + shortNum(Math.abs(n));

// "2.5k", "1,000", "3M", "1e9" -> number (NaN if it isn't one)
const SUFFIX = { k: 1e3, m: 1e6, b: 1e9, t: 1e12, q: 1e15, qa: 1e15, qi: 1e18, sx: 1e21, sp: 1e24, oc: 1e27, no: 1e30, dc: 1e33 };
function parseAmount(text) {
    const t = String(text || '').trim().toLowerCase().replace(/[,\s_]/g, '');
    const m = t.match(/^(\d*\.?\d+(?:e[+-]?\d+)?)([a-z]*)$/);
    if (!m) return NaN;
    const mult = m[2] ? SUFFIX[m[2]] : 1;
    return mult ? Number(m[1]) * mult : NaN;
}
// bet text for the input box (exact below 1M, short above)
function amountText(n) {
    n = Math.floor(n);
    if (n < 1e6) return String(n);
    const units = ['', 'K', 'M', 'B', 'T', 'Q', 'Qi', 'Sx', 'Sp', 'Oc', 'No', 'Dc'];
    let i = 0, x = n;
    while (x >= 1000 && i < units.length - 1) { x /= 1000; i++; }
    return x >= 1000 ? n.toExponential(3) : (x.toFixed(3).replace(/0+$/, '').replace(/\.$/, '') + units[i]);
}

// ---------- save ----------
function loadSave() {
    try {
        const raw = localStorage.getItem(SAVE_KEY) || localStorage.getItem(SAVE_KEY_LEGACY);
        return raw ? JSON.parse(raw) : null;
    } catch (e) { return null; }
}
// merge keys into the existing save so nothing unrelated is wiped
function persistSave(patch) {
    try {
        let existing = {};
        try { existing = JSON.parse(localStorage.getItem(SAVE_KEY) || localStorage.getItem(SAVE_KEY_LEGACY) || '{}') || {}; } catch (e) { existing = {}; }
        for (const k in patch) existing[k] = patch[k];
        const payload = JSON.stringify(existing);
        localStorage.setItem(SAVE_KEY, payload);
        try { localStorage.setItem(SAVE_KEY_LEGACY, payload); } catch (e) {}
    } catch (e) {}
}
function balanceOf(cur) { const s = loadSave(); return s ? Math.max(0, Number(s[cur]) || 0) : 0; }
function adjustBalance(cur, delta) {
    const next = Math.max(0, balanceOf(cur) + delta);
    persistSave({ [cur]: next });
    return next;
}

function loadPrefs() { try { return JSON.parse(localStorage.getItem(PREFS_KEY) || '{}') || {}; } catch (e) { return {}; } }
function savePrefs(p) { try { localStorage.setItem(PREFS_KEY, JSON.stringify(Object.assign(loadPrefs(), p))); } catch (e) {} }

// ---------- balances ----------
const lastBal = {};
function refreshBalanceDisplay() {
    const s = loadSave() || {};
    [['count', 'balCount'], ['diamonds', 'balGems'], ['goldenWhat', 'balGolden']].forEach(([cur, id]) => {
        const v = Math.max(0, Number(s[cur]) || 0);
        const el = $(id); if (!el) return;
        el.textContent = shortNum(v);
        el.title = v.toLocaleString() + ' ' + CUR_LABEL[cur];
        const chip = el.parentElement;
        if (lastBal[cur] !== undefined && v !== lastBal[cur] && chip) {
            chip.classList.remove('up', 'down'); void chip.offsetWidth;
            chip.classList.add(v > lastBal[cur] ? 'up' : 'down');
            clearTimeout(chip._t); chip._t = setTimeout(() => chip.classList.remove('up', 'down'), 900);
        }
        lastBal[cur] = v;
    });
    updateBetHint();
    updateDoubleButton();
}

// ---------- toasts ----------
function toast(title, sub, ms = 4500) {
    const box = $('casinoToasts'); if (!box) return;
    const el = document.createElement('div');
    el.className = 'c-toast';
    el.innerHTML = `<b>${escapeHtml(title)}</b>${sub ? `<small>${escapeHtml(sub)}</small>` : ''}`;
    el.addEventListener('click', () => el.remove());
    box.appendChild(el);
    setTimeout(() => el.remove(), ms);
}
function showGambaAchievement(title, subtitle) { toast('🏆 ' + title, subtitle); }

// ---------- bet bar ----------
const betAmountEl = $('betAmount');
const betHintEl = $('betAmountDisplay');
let betCur = 'count';

function setBetCurrency(cur) {
    if (!CUR_LABEL[cur]) cur = 'count';
    betCur = cur;
    document.querySelectorAll('.cur-seg [data-cur]').forEach(b => b.setAttribute('aria-checked', String(b.dataset.cur === cur)));
    delete betAmountEl.dataset.exact;
    savePrefs({ cur });
    updateBetHint();
}
// { amount } when the bet is valid, otherwise { error }
function currentBet() {
    const text = betAmountEl.value.trim();
    if (!text) return { error: 'Enter a bet.' };
    const raw = betAmountEl.dataset.exact ? Number(betAmountEl.dataset.exact) : parseAmount(text);
    if (!Number.isFinite(raw) || raw <= 0) return { error: 'That isn\'t a number. Try 500, 2.5K or 1M.' };
    const amount = Math.floor(raw);
    if (amount < 1) return { error: 'The minimum bet is 1.' };
    const bal = balanceOf(betCur);
    if (amount > bal) return { amount, error: bal < 1 ? `You don't have any ${CUR_LABEL[betCur]}.` : `You only have ${shortNum(bal)} ${CUR_LABEL[betCur]}.` };
    return { amount, cur: betCur };
}
function updateBetHint() {
    if (!betHintEl) return;
    const b = currentBet();
    if (b.error) { betHintEl.textContent = b.error; betHintEl.classList.add('bad'); return; }
    const bal = balanceOf(betCur);
    const pct = bal ? (b.amount / bal) * 100 : 0;
    betHintEl.classList.remove('bad');
    betHintEl.textContent = `${b.amount.toLocaleString()} ${CUR_LABEL[betCur]} · ${pct >= 99.995 ? 'all in' : (pct < 0.01 ? '<0.01' : pct.toFixed(pct < 10 ? 2 : 0)) + '% of your balance'}`;
}
function setBetAmount(n, exact) {
    betAmountEl.value = amountText(n);
    if (exact) betAmountEl.dataset.exact = String(Math.floor(n)); else delete betAmountEl.dataset.exact;
    savePrefs({ amt: betAmountEl.value });
    updateBetHint();
}
function badBet(msg) {
    betHintEl.textContent = msg; betHintEl.classList.add('bad');
    betAmountEl.focus();
}
document.querySelectorAll('.cur-seg [data-cur]').forEach(b => b.addEventListener('click', () => setBetCurrency(b.dataset.cur)));
betAmountEl.addEventListener('input', () => { delete betAmountEl.dataset.exact; savePrefs({ amt: betAmountEl.value }); updateBetHint(); });
document.querySelectorAll('.bet-chips [data-chip]').forEach(btn => btn.addEventListener('click', () => {
    const bal = Math.floor(balanceOf(betCur));
    const cur = currentBet().amount || 0;
    const kind = btn.dataset.chip;
    if (bal < 1) { setBetAmount(1); return; }
    if (kind === 'min') setBetAmount(1);
    else if (kind === 'half') setBetAmount(Math.max(1, Math.floor((cur || 2) / 2)));
    else if (kind === 'double') setBetAmount(Math.min(bal, Math.max(1, cur * 2)), Math.max(1, cur * 2) >= bal);
    else if (kind === 'max') setBetAmount(bal, true);
    else setBetAmount(Math.max(1, Math.floor(bal * Number(kind) / 100)));
}));

// ---------- stats + achievements ----------
function loadStats() {
    const d = { rounds: 0, wins: 0, losses: 0, pushes: 0, net: { count: 0, diamonds: 0, goldenWhat: 0 }, best: { count: 0, diamonds: 0, goldenWhat: 0 },
        bjDoubleWins: 0, slotsTriples: 0, slotsJackpots: 0, rocketBest: 0, rocketHistory: [], recent: [] };
    try {
        const s = JSON.parse(localStorage.getItem(STATS_KEY) || 'null');
        if (s && typeof s === 'object') {
            Object.assign(d, s);
            d.net = Object.assign({ count: 0, diamonds: 0, goldenWhat: 0 }, s.net);
            d.best = Object.assign({ count: 0, diamonds: 0, goldenWhat: 0 }, s.best);
            if (!Array.isArray(d.recent)) d.recent = [];
            if (!Array.isArray(d.rocketHistory)) d.rocketHistory = [];
        }
    } catch (e) {}
    return d;
}
function saveStats(s) { try { localStorage.setItem(STATS_KEY, JSON.stringify(s)); } catch (e) {} }
// payout = what came back (0 when the bet was lost, the bet itself on a push)
function recordRound(game, cur, bet, payout, extra = {}) {
    const s = loadStats();
    const profit = payout - bet;
    s.rounds++;
    if (profit > 0) s.wins++; else if (profit < 0) s.losses++; else s.pushes++;
    s.net[cur] = (Number(s.net[cur]) || 0) + profit;
    if (profit > (Number(s.best[cur]) || 0)) s.best[cur] = profit;
    if (extra.doubleWin) s.bjDoubleWins++;
    if (extra.triple) s.slotsTriples++;
    if (extra.jackpot) s.slotsJackpots++;
    if (extra.rocketMult && extra.rocketMult > s.rocketBest) s.rocketBest = extra.rocketMult;
    if (extra.crashAt) s.rocketHistory = [extra.crashAt].concat(s.rocketHistory).slice(0, 14);
    s.recent = [{ g: game, c: cur, b: bet, p: payout, x: extra.note || '', t: Date.now() }].concat(s.recent).slice(0, 8);
    saveStats(s);
}
// refresh everything that shows results; games call this once their reveal animation is over
function afterRound() {
    refreshBalanceDisplay();
    renderRecord();
    checkCasinoAchievements();
}
function checkCasinoAchievements() {
    if (!window.WHA) return;
    try {
        const fresh = window.WHA.checkAll(window.WHA.snapshot());
        fresh.forEach((a, i) => setTimeout(() => toast(`🏆 ${a.name}`, `${a.desc} Title: ${a.title}`), 300 + i * 800));
    } catch (e) {}
}
function renderRecord() {
    const s = loadStats();
    const grid = $('recordGrid'); if (!grid) return;
    const decided = s.wins + s.losses;
    const bestCur = ['count', 'goldenWhat', 'diamonds'].find(c => s.best[c] > 0);
    grid.innerHTML = [
        ['Rounds played', s.rounds.toLocaleString()],
        ['Win rate', decided ? Math.round((s.wins / decided) * 100) + '%' : '—'],
        ['Biggest win', bestCur ? `+${shortNum(s.best[bestCur])} ${CUR_SHORT[bestCur]}` : '—'],
        ['Best rocket', s.rocketBest ? s.rocketBest.toFixed(2) + '×' : '—'],
    ].map(([k, v]) => `<div class="stat"><span>${k}</span><b>${escapeHtml(v)}</b></div>`).join('');
    const net = ['count', 'diamonds', 'goldenWhat'].filter(c => s.net[c]);
    $('recordNet').innerHTML = net.length ? 'Net: ' + net.map(c => `<span class="${s.net[c] > 0 ? 'pos' : 'neg'}">${signed(s.net[c])} ${CUR_SHORT[c]}</span>`).join('') : '';
    const list = $('recentPlays');
    if (!s.recent.length) { list.innerHTML = '<li class="recent-empty" style="background:none">No bets yet. Good luck!</li>'; return; }
    list.innerHTML = s.recent.slice(0, 6).map(r => {
        const profit = r.p - r.b;
        const res = profit > 0 ? `<span class="pos">${signed(profit)}</span>` : profit < 0 ? `<span class="neg">${signed(profit)}</span>` : '<span>Push</span>';
        return `<li><span>${GAME_LABEL[r.g] || r.g} · ${shortNum(r.b)} ${CUR_SHORT[r.c] || ''}${r.x ? ' · ' + escapeHtml(r.x) : ''}</span>${res}</li>`;
    }).join('');
}

// ---------- tabs ----------
function showGame(name) {
    if (!['blackjack', 'slots', 'rocket'].includes(name)) name = 'blackjack';
    document.querySelectorAll('.game-tab').forEach(t => { const on = t.dataset.game === name; t.classList.toggle('active', on); t.setAttribute('aria-selected', String(on)); });
    document.querySelectorAll('.game').forEach(g => { g.hidden = g.id !== 'game-' + name; });
    savePrefs({ tab: name });
    if (name === 'rocket') { sizeRocketCanvas(); drawRocketFrame(); }
}
document.querySelectorAll('.game-tab').forEach(t => t.addEventListener('click', () => showGame(t.dataset.game)));

// =====================================================================
// Blackjack
// =====================================================================
const playerHandEl = $('playerHand'), dealerHandEl = $('dealerHand');
const playerScoreEl = $('playerScore'), dealerScoreEl = $('dealerScore');
const resultEl = $('result');
const btnPlaceBet = $('btnPlaceBet'), btnHit = $('btnHit'), btnStand = $('btnStand'), btnDouble = $('btnDouble');
let bj = null;          // { deck, player, dealer, bet, cur, allIn, doubled } while a hand is in play
let bjBusy = false;     // true while cards are animating
let bjShownDealer = 0, bjHoleShown = false;

function createDeck() {
    const d = [];
    for (const s of ['Hearts', 'Diamonds', 'Clubs', 'Spades']) for (const r of ['2', '3', '4', '5', '6', '7', '8', '9', '10', 'J', 'Q', 'K', 'A']) d.push({ r, s });
    return d;
}
function shuffle(a) { for (let i = a.length - 1; i > 0; i--) { const j = Math.floor(Math.random() * (i + 1)); [a[i], a[j]] = [a[j], a[i]]; } return a; }
function cardValue(card) {
    const r = String(card && card.r || '').toLowerCase();
    if (r === 'a') return 11;
    if (['k', 'q', 'j'].includes(r)) return 10;
    return parseInt(r, 10) || 0;
}
function handInfo(hand) {
    let total = 0, aces = 0;
    for (const c of hand) { total += cardValue(c); if (String(c.r).toLowerCase() === 'a') aces++; }
    while (total > 21 && aces > 0) { total -= 10; aces--; }
    return { total, soft: aces > 0 && total <= 21 };
}
function scoreHand(hand) { return handInfo(hand).total; }
const isNatural = hand => hand.length === 2 && scoreHand(hand) === 21;
function cardImageName(card) {
    const names = { j: 'jack', q: 'queen', k: 'king', a: 'ace' };
    const r = String(card.r).toLowerCase();
    return `${names[r] || r}_of_${String(card.s).toLowerCase()}.png`;
}
function cardImg(card, cls) {
    const img = new Image();
    img.src = card ? 'mainimage/cards/' + cardImageName(card) : 'mainimage/cards/cardback.png';
    img.alt = card ? `${card.r} of ${card.s}` : 'Face-down card';
    if (cls) img.className = cls;
    return img;
}
function drawCard(round) {
    if (!round.deck || !round.deck.length) round.deck = shuffle(createDeck());
    return round.deck.pop();
}

// Dealer chatter
const _dealerMessages = {
    opening: ['Place your bets please', 'Feeling lucky tonight?', 'Fortune favors the bold', 'Every wager leaves a mark', 'Once the cards fall, there is no turning back'],
    inRound: ['Luck is borrowed, and it always comes time to collect', 'The cards chose their master', "I've seen worse bets win big", 'Careful, confidence loses money faster than bad luck', 'You sure about that bet?', "That's a brave bet. Let's see if it pays off."],
    win: ["That's a winning hand. Congratulations.", 'You win.', 'Congratulations. Perhaps another round?', 'Your bet paid off.'],
    lose: ['Chance has a cruel sense of humor.', "Shake it off, next round's yours.", "You're still in it.", "Not a bad call. It just didn't land this time.", "That's one way to go broke.", 'The house is smiling tonight.', 'Oof… tough luck. Maybe next hand.'],
};
let dealerIntervalId = null;
function setDealerText(msg) { const d = $('casinoDealerText'); if (d) d.textContent = String(msg || ''); }
function startDealerInRoundCycle() { stopDealerInRoundCycle(); setDealerText(pickRandom(_dealerMessages.inRound)); dealerIntervalId = setInterval(() => setDealerText(pickRandom(_dealerMessages.inRound)), 4200); }
function stopDealerInRoundCycle() { if (dealerIntervalId) { clearInterval(dealerIntervalId); dealerIntervalId = null; } }

function setBjButtons(mode) {
    btnPlaceBet.disabled = mode !== 'idle';
    btnHit.disabled = mode !== 'play';
    btnStand.disabled = mode !== 'play';
    updateDoubleButton(mode);
}
function updateDoubleButton(mode) {
    if (!btnDouble) return;
    const playing = mode ? mode === 'play' : (bj && !bjBusy);
    btnDouble.disabled = !(playing && bj && bj.player.length === 2 && balanceOf(bj.cur) >= bj.bet);
}
function bjResetTable() {
    playerHandEl.innerHTML = ''; dealerHandEl.innerHTML = '';
    resultEl.innerHTML = '';
    bjShownDealer = 0; bjHoleShown = false;
    $('feltEmpty').hidden = true;
}
function addCard(who, card, faceDown, animate = true) {
    const el = cardImg(faceDown ? null : card, animate ? 'deal-in' : '');
    (who === 'player' ? playerHandEl : dealerHandEl).appendChild(el);
    if (who === 'dealer') bjShownDealer++;
}
function revealHole(round, animate = true) {
    if (bjHoleShown) return;
    const hole = dealerHandEl.children[1];
    if (hole) { const face = cardImg(round.dealer[1], animate ? 'flip-in' : ''); dealerHandEl.replaceChild(face, hole); }
    bjHoleShown = true;
}
function setScores(round, revealDealer) {
    const p = handInfo(round.player);
    playerScoreEl.className = 'score-pill' + (p.total > 21 ? ' bust' : isNatural(round.player) ? ' bj' : '');
    playerScoreEl.textContent = p.total > 21 ? `Bust (${p.total})` : isNatural(round.player) ? 'Blackjack' : (p.soft ? 'Soft ' : '') + p.total;
    if (revealDealer) {
        const shown = round.dealer.slice(0, Math.max(2, bjShownDealer));
        const d = handInfo(shown);
        dealerScoreEl.className = 'score-pill' + (d.total > 21 ? ' bust' : isNatural(round.dealer) ? ' bj' : '');
        dealerScoreEl.textContent = d.total > 21 ? `Bust (${d.total})` : isNatural(round.dealer) ? 'Blackjack' : String(d.total);
    } else {
        dealerScoreEl.className = 'score-pill';
        dealerScoreEl.textContent = round.dealer[0] ? cardValue(round.dealer[0]) + ' + ?' : '';
    }
}
function renderRoundInstant(round) {
    bjResetTable();
    round.player.forEach(c => addCard('player', c, false, false));
    addCard('dealer', round.dealer[0], false, false);
    addCard('dealer', round.dealer[1], true, false);
    setScores(round, false);
}

function saveRoundState() { try { if (bj) localStorage.setItem(GAMBA_ROUND_KEY, JSON.stringify(Object.assign({ v: 2 }, bj))); } catch (e) {} }
function clearRoundState() { try { localStorage.removeItem(GAMBA_ROUND_KEY); } catch (e) {} }
function loadRoundState() {
    try {
        const s = JSON.parse(localStorage.getItem(GAMBA_ROUND_KEY) || 'null');
        if (!s) return null;
        // hands saved by the older casino page
        if (s.v !== 2) {
            if (!s.inRound) return null;
            return { deck: s.deck || [], player: s.playerHand || [], dealer: s.dealerHand || [], bet: Number(s.currentBet) || 0, cur: s.currentCurrency || 'count', allIn: !!s.allIn, doubled: false };
        }
        return { deck: s.deck || [], player: s.player || [], dealer: s.dealer || [], bet: Number(s.bet) || 0, cur: s.cur || 'count', allIn: !!s.allIn, doubled: !!s.doubled };
    } catch (e) { return null; }
}

async function bjDeal() {
    if (bj || bjBusy) return;
    const b = currentBet();
    if (b.error) return badBet(b.error);
    const balBefore = balanceOf(b.cur);
    adjustBalance(b.cur, -b.amount);
    const deck = shuffle(createDeck());
    bj = { deck, player: [], dealer: [], bet: b.amount, cur: b.cur, allIn: b.cur === 'count' && b.amount >= Math.floor(balBefore), doubled: false };
    bj.player.push(deck.pop()); bj.dealer.push(deck.pop()); bj.player.push(deck.pop()); bj.dealer.push(deck.pop());
    saveRoundState();
    refreshBalanceDisplay();
    bjBusy = true; setBjButtons('busy');
    bjResetTable();
    startDealerInRoundCycle();
    const order = [['player', 0], ['dealer', 0], ['player', 1], ['dealer', 1]];
    for (const [who, i] of order) {
        addCard(who, bj[who][i], who === 'dealer' && i === 1);
        await sleep(190);
    }
    setScores(bj, false);
    bjBusy = false;
    if (isNatural(bj.player) || isNatural(bj.dealer)) {
        const both = isNatural(bj.player) && isNatural(bj.dealer);
        return bjFinish(both ? 'push' : isNatural(bj.player) ? 'win' : 'lose', isNatural(bj.player) && !both);
    }
    setBjButtons('play');
}
async function bjHit() {
    if (!bj || bjBusy) return;
    bj.player.push(drawCard(bj));
    saveRoundState();
    bjBusy = true; setBjButtons('busy');
    addCard('player', bj.player[bj.player.length - 1]);
    setScores(bj, false);
    await sleep(260);
    bjBusy = false;
    const p = scoreHand(bj.player);
    if (p > 21) return bjFinish('lose');
    if (p === 21) return bjStand();
    setBjButtons('play');
}
async function bjDouble() {
    if (!bj || bjBusy || bj.player.length !== 2) return;
    if (balanceOf(bj.cur) < bj.bet) return toast('Not enough to double', `Doubling needs another ${shortNum(bj.bet)} ${CUR_LABEL[bj.cur]}.`);
    adjustBalance(bj.cur, -bj.bet);
    bj.bet *= 2; bj.doubled = true;
    bj.player.push(drawCard(bj));
    saveRoundState();
    refreshBalanceDisplay();
    bjBusy = true; setBjButtons('busy');
    addCard('player', bj.player[2]);
    setScores(bj, false);
    await sleep(320);
    bjBusy = false;
    if (scoreHand(bj.player) > 21) return bjFinish('lose');
    return bjStand();
}
function bjStand() {
    if (!bj || bjBusy) return;
    while (scoreHand(bj.dealer) < 17) bj.dealer.push(drawCard(bj));
    const p = scoreHand(bj.player), d = scoreHand(bj.dealer);
    return bjFinish(d > 21 || p > d ? 'win' : p < d ? 'lose' : 'push');
}
// Settle the hand first (balance, stats, achievements), then play out the dealer's cards on screen.
async function bjFinish(outcome, natural = false) {
    const round = bj;
    if (!round) return;
    bj = null;
    clearRoundState();
    stopDealerInRoundCycle();
    const result = settleBlackjack(round, outcome, natural);
    bjBusy = true; setBjButtons('busy');
    const playerBust = scoreHand(round.player) > 21;
    revealHole(round);
    setScores(round, true);
    // the dealer only draws when the player is still standing
    if (!playerBust && !natural) {
        for (let i = bjShownDealer; i < round.dealer.length; i++) {
            await sleep(520);
            addCard('dealer', round.dealer[i]);
            setScores(round, true);
        }
    }
    await sleep(300);
    const label = CUR_SHORT[round.cur];
    let pill;
    if (outcome === 'win') pill = `<span class="result-pill win">${natural ? 'Blackjack! ' : round.doubled ? 'Double win! ' : 'You win! '}+${shortNum(result.winnings)} ${label}</span>`;
    else if (outcome === 'lose') pill = `<span class="result-pill lose">${playerBust ? 'Bust' : isNatural(round.dealer) ? 'Dealer blackjack' : 'Dealer wins'} −${shortNum(round.bet)} ${label}</span>`;
    else pill = '<span class="result-pill">Push. Bet returned</span>';
    resultEl.innerHTML = pill;
    setDealerText(pickRandom(outcome === 'win' ? _dealerMessages.win : outcome === 'lose' ? _dealerMessages.lose : _dealerMessages.opening));
    bjBusy = false;
    setBjButtons('idle');
    afterRound();
}
function settleBlackjack(round, outcome, natural) {
    const winnings = natural ? Math.floor(round.bet * 1.5) : round.bet;
    const payout = outcome === 'win' ? round.bet + winnings : outcome === 'push' ? round.bet : 0;
    if (payout) adjustBalance(round.cur, payout);
    if (outcome === 'win') {
        // blackjack wins: unlock the Casino Dealer skin at 10 (clan challenges count these too)
        try {
            const s = loadSave() || {};
            const wins = (Number(s.casino_total_wins || localStorage.getItem('gamba_total_wins') || 0) || 0) + 1;
            const patch = { casino_total_wins: wins };
            if (wins >= 10) patch.shopCasinoDealerPurchased = true;
            persistSave(patch);
            localStorage.setItem('gamba_total_wins', String(wins));
            if (wins >= 10 && localStorage.getItem('shopCasinoDealerPurchased') !== '1' && !s.shopCasinoDealerPurchased) {
                localStorage.setItem('shopCasinoDealerPurchased', '1');
                showGambaAchievement('Unlocked: Casino Dealer skin', 'Equip it from the Shop.');
            }
        } catch (e) {}
        if (round.allIn) unlockEventAchievement('put_all_on_black');
        if (round.player.length >= 5) unlockEventAchievement('5_card_blackjack');
    }
    recordRound('blackjack', round.cur, round.bet, payout, { doubleWin: round.doubled && outcome === 'win', note: natural ? 'blackjack' : round.doubled ? 'doubled' : '' });
    return { payout, winnings };
}
// achievements that unlock the moment they happen (defined in achievements-data.js)
function unlockEventAchievement(key) {
    try {
        const a = window.WHA && window.WHA.unlock(key);
        if (a) setTimeout(() => toast(`🏆 ${a.name}`, `${a.desc} Title: ${a.title}`), 300);
    } catch (e) {}
}
btnPlaceBet.addEventListener('click', bjDeal);
btnHit.addEventListener('click', bjHit);
btnStand.addEventListener('click', bjStand);
btnDouble.addEventListener('click', bjDouble);

function restoreBlackjack() {
    const round = loadRoundState();
    if (!round || !round.player.length || round.dealer.length < 2 || !round.bet) { clearRoundState(); return; }
    bj = round;
    renderRoundInstant(bj);
    startDealerInRoundCycle();
    if (isNatural(bj.player) || isNatural(bj.dealer)) {
        const both = isNatural(bj.player) && isNatural(bj.dealer);
        bjFinish(both ? 'push' : isNatural(bj.player) ? 'win' : 'lose', isNatural(bj.player) && !both);
    } else if (scoreHand(bj.player) > 21) bjFinish('lose');
    else if (bj.doubled || scoreHand(bj.player) === 21) bjStand();
    else setBjButtons('play');
}

// =====================================================================
// Slots — three reels. Return to player is about 95.7%: 35% of spins pay something, three Goldens pay 500×.
// =====================================================================
const SLOT_SYMBOLS = [
    { id: 'noodles', name: 'Good Noodles', img: 'mainimage/upgrades/thumbs/goodNoodles.webp', w: 6, three: 5, two: 0 },
    { id: 'grape', name: 'Grape God', img: 'mainimage/upgrades/thumbs/grapegod.webp', w: 5, three: 8, two: 1 },
    { id: 'mouse', name: 'OP Mouse', img: 'mainimage/upgrades/thumbs/opmouse.webp', w: 4, three: 15, two: 1 },
    { id: 'pirate', name: 'Somalian Pirate', img: 'mainimage/upgrades/thumbs/somaliflag.webp', w: 3, three: 25, two: 2 },
    { id: 'goat', name: 'The Goatis', img: 'mainimage/upgrades/thumbs/goatis.webp', w: 2, three: 75, two: 2 },
    { id: 'golden', name: 'Golden What Happened', img: 'mainimage/thumbs/goldwh.webp', w: 1, three: 500, two: 10 },
];
const SLOT_WEIGHT = SLOT_SYMBOLS.reduce((a, s) => a + s.w, 0);
const reelEls = Array.from(document.querySelectorAll('#reels .reel'));
let slotBusy = false;
let slotFaces = [0, 1, 2].map(() => SLOT_SYMBOLS[Math.floor(Math.random() * 3)]);

function rollSymbol() {
    let r = Math.random() * SLOT_WEIGHT;
    for (const s of SLOT_SYMBOLS) { if ((r -= s.w) < 0) return s; }
    return SLOT_SYMBOLS[0];
}
// { mult, match: symbol or null, count }
function slotOutcome(syms) {
    const [a, b, c] = syms;
    if (a === b && b === c) return { mult: a.three, match: a, count: 3 };
    const pair = (a === b || a === c) ? a : (b === c ? b : null);
    if (pair && pair.two) return { mult: pair.two, match: pair, count: 2 };
    return { mult: 0, match: null, count: 0 };
}
function cellHtml(sym) { return `<div class="reel-cell"><img src="${sym.img}" alt="${escapeHtml(sym.name)}" draggable="false"></div>`; }
function renderReelsStatic() {
    reelEls.forEach((reel, i) => {
        const strip = reel.querySelector('.reel-strip');
        strip.style.transition = 'none'; strip.style.transform = 'translateY(0)';
        strip.innerHTML = cellHtml(slotFaces[i]);
    });
}
function renderPaytable() {
    $('paytable').innerHTML = SLOT_SYMBOLS.slice().reverse().map(s =>
        `<div class="pay-row" title="${escapeHtml(s.name)}"><img src="${s.img}" alt=""><img src="${s.img}" alt=""><img src="${s.img}" alt=""><b>${s.three}×</b></div>` +
        (s.two ? `<div class="pay-row" title="Two ${escapeHtml(s.name)}"><img src="${s.img}" alt=""><img src="${s.img}" alt=""><small>any two</small><b>${s.two}×</b></div>` : '')
    ).join('');
}
async function slotSpin() {
    if (slotBusy) return;
    const b = currentBet();
    if (b.error) return badBet(b.error);
    slotBusy = true;
    $('slotSpinBtn').disabled = true;
    const syms = [rollSymbol(), rollSymbol(), rollSymbol()];
    const out = slotOutcome(syms);
    const payout = Math.floor(b.amount * out.mult);
    // settle before the reels move
    adjustBalance(b.cur, payout - b.amount);
    recordRound('slots', b.cur, b.amount, payout, { triple: out.count === 3, jackpot: out.count === 3 && out.match.id === 'golden', note: out.count ? `${out.count}× ${out.match.name}` : '' });
    $('slotResult').innerHTML = '';
    reelEls.forEach(r => r.classList.remove('win'));
    const h = reelEls[0].clientHeight || 120;
    await Promise.all(reelEls.map((reel, i) => new Promise(resolve => {
        const strip = reel.querySelector('.reel-strip');
        const spins = 14 + i * 6;
        const cells = [slotFaces[i]];
        for (let k = 0; k < spins; k++) cells.push(SLOT_SYMBOLS[Math.floor(Math.random() * SLOT_SYMBOLS.length)]);
        cells.push(syms[i]);
        strip.innerHTML = cells.map(cellHtml).join('');
        strip.style.transition = 'none';
        strip.style.transform = 'translateY(0)';
        void strip.offsetHeight;
        const dur = 900 + i * 420;
        strip.style.transition = `transform ${dur}ms cubic-bezier(.15,.75,.25,1.03)`;
        strip.style.transform = `translateY(${-(cells.length - 1) * h}px)`;
        setTimeout(resolve, dur + 40);
    })));
    slotFaces = syms;
    renderReelsStatic();
    const label = CUR_SHORT[b.cur];
    if (out.count) syms.forEach((s, i) => { if (s === out.match) reelEls[i].classList.add('win'); });
    let pill;
    if (out.count === 3 && out.match.id === 'golden') pill = `<span class="result-pill win">JACKPOT! +${shortNum(payout - b.amount)} ${label}</span>`;
    else if (out.count === 3) pill = `<span class="result-pill win">Three ${escapeHtml(out.match.name)}! +${shortNum(payout - b.amount)} ${label}</span>`;
    else if (payout > b.amount) pill = `<span class="result-pill win">+${shortNum(payout - b.amount)} ${label}</span>`;
    else if (payout === b.amount) pill = '<span class="result-pill">Money back</span>';
    else pill = `<span class="result-pill lose">No luck. −${shortNum(b.amount)} ${label}</span>`;
    $('slotResult').innerHTML = pill;
    slotBusy = false;
    $('slotSpinBtn').disabled = false;
    afterRound();
}
$('slotSpinBtn').addEventListener('click', slotSpin);

// =====================================================================
// Rocket — the multiplier grows as e^(0.1·seconds) (2× after ~7s, 10× after ~23s) until a crash point drawn
// so that P(reaching m) = 0.97 / m. Cashing out at any target therefore returns 97% on average.
// =====================================================================
const ROCKET_RATE = 0.1;
const ROCKET_MAX = 1000;
const canvas = $('rocketCanvas');
const ctx = canvas.getContext('2d');
const rocketBtn = $('rocketBtn'), rocketMultEl = $('rocketMult'), rocketNoteEl = $('rocketNote'), rocketAutoEl = $('rocketAuto');
const rocketFace = new Image(); rocketFace.src = 'mainimage/whathappened.jpeg';
const stars = Array.from({ length: 70 }, () => ({ x: Math.random(), y: Math.random(), r: Math.random() * 1.4 + 0.3, a: Math.random() * 0.6 + 0.2 }));
let rocket = null;                 // the live round: { bet, cur, crashAt, auto, start }
let flight = { mode: 'idle', start: 0, crashAt: 0, cashedAt: 0 };   // what the canvas shows
let rocketRaf = 0;

const multAt = ms => Math.exp(ROCKET_RATE * Math.max(0, ms) / 1000);
function rocketCrashPoint() {
    const raw = 0.97 / (1 - Math.random());
    return Math.min(ROCKET_MAX, Math.max(1, Math.floor(raw * 100) / 100));
}
function parseAuto() {
    const t = rocketAutoEl.value.trim();
    if (!t) return { auto: 0 };
    const v = Number(t.replace(/x$/i, ''));
    if (!Number.isFinite(v) || v < 1.01) return { error: 'Auto cash out must be at least 1.01×, or leave it empty.' };
    return { auto: Math.floor(v * 100) / 100 };
}
function sizeRocketCanvas() {
    const dpr = window.devicePixelRatio || 1;
    const w = canvas.clientWidth, h = canvas.clientHeight;
    if (!w || !h) return;
    if (canvas.width !== Math.round(w * dpr) || canvas.height !== Math.round(h * dpr)) { canvas.width = Math.round(w * dpr); canvas.height = Math.round(h * dpr); }
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
}
function niceStep(range) { const raw = range / 4; const p = Math.pow(10, Math.floor(Math.log10(raw))); const n = raw / p; return (n < 1.5 ? 1 : n < 3.5 ? 2 : n < 7.5 ? 5 : 10) * p; }
function drawRocketFrame() {
    const w = canvas.clientWidth, h = canvas.clientHeight;
    if (!w || !h) return;
    ctx.clearRect(0, 0, w, h);
    const now = Date.now();
    const mode = flight.mode;
    const endMs = mode === 'crashed' ? Math.log(flight.crashAt) / ROCKET_RATE * 1000 : (mode === 'idle' ? 0 : now - flight.start);
    const m = mode === 'idle' ? 1 : (mode === 'crashed' ? flight.crashAt : multAt(endMs));
    // stars drift down a little as the rocket climbs
    const drift = (endMs / 1000) * 0.012;
    for (const s of stars) {
        ctx.globalAlpha = s.a;
        ctx.fillStyle = '#fff';
        ctx.beginPath(); ctx.arc(s.x * w, ((s.y + drift) % 1) * h, s.r, 0, Math.PI * 2); ctx.fill();
    }
    ctx.globalAlpha = 1;
    const padL = 44, padB = 26, padT = 18, padR = 26;
    const xMax = Math.max(10000, endMs * 1.15);
    const yMax = Math.max(2, 1 + (m - 1) * 1.3);
    const X = t => padL + (t / xMax) * (w - padL - padR);
    const Y = v => h - padB - ((v - 1) / (yMax - 1)) * (h - padB - padT);
    // grid
    ctx.font = '11px Inter, system-ui, sans-serif';
    ctx.fillStyle = 'rgba(255,255,255,0.45)';
    ctx.strokeStyle = 'rgba(255,255,255,0.08)';
    ctx.lineWidth = 1;
    const step = niceStep(yMax - 1);
    for (let v = 1; v <= yMax + 1e-9; v += step) {
        const y = Y(v);
        ctx.beginPath(); ctx.moveTo(padL, y); ctx.lineTo(w - padR, y); ctx.stroke();
        ctx.fillText((Math.round(v * 100) / 100) + '×', 6, y + 4);
    }
    if (mode === 'idle') return;
    // curve
    const pts = [];
    const n = 80;
    for (let i = 0; i <= n; i++) { const t = endMs * i / n; pts.push([X(t), Y(multAt(t))]); }
    const color = mode === 'crashed' ? '#ff5b6b' : (mode === 'ghost' ? 'rgba(255,200,61,0.55)' : '#ffc83d');
    const grad = ctx.createLinearGradient(0, h, 0, 0);
    grad.addColorStop(0, 'rgba(255,154,31,0)');
    grad.addColorStop(1, mode === 'crashed' ? 'rgba(255,91,107,0.25)' : 'rgba(255,200,61,0.22)');
    ctx.beginPath(); ctx.moveTo(pts[0][0], h - padB);
    pts.forEach(p => ctx.lineTo(p[0], p[1]));
    ctx.lineTo(pts[pts.length - 1][0], h - padB); ctx.closePath();
    ctx.fillStyle = grad; ctx.fill();
    ctx.beginPath(); pts.forEach((p, i) => i ? ctx.lineTo(p[0], p[1]) : ctx.moveTo(p[0], p[1]));
    ctx.strokeStyle = color; ctx.lineWidth = 3.5; ctx.lineCap = 'round'; ctx.stroke();
    // cash-out marker
    if (flight.cashedAt) {
        const tc = Math.log(flight.cashedAt) / ROCKET_RATE * 1000;
        if (tc <= endMs) {
            ctx.fillStyle = '#2fd07a';
            ctx.beginPath(); ctx.arc(X(tc), Y(flight.cashedAt), 6, 0, Math.PI * 2); ctx.fill();
        }
    }
    // the rocket (or the explosion) at the tip
    const [tx, ty] = pts[pts.length - 1];
    const [px, py] = pts[Math.max(0, pts.length - 4)];
    const ang = Math.atan2(ty - py, tx - px);
    if (mode === 'crashed') {
        const age = Math.min(1, (now - flight.crashedAtMs) / 600);
        const r = 14 + age * 34;
        const g = ctx.createRadialGradient(tx, ty, 2, tx, ty, r);
        g.addColorStop(0, 'rgba(255,255,220,' + (1 - age * 0.6) + ')');
        g.addColorStop(0.4, 'rgba(255,160,40,' + (0.9 - age * 0.6) + ')');
        g.addColorStop(1, 'rgba(255,60,60,0)');
        ctx.fillStyle = g; ctx.beginPath(); ctx.arc(tx, ty, r, 0, Math.PI * 2); ctx.fill();
        for (let i = 0; i < 10; i++) {
            const a = i / 10 * Math.PI * 2 + 0.3;
            ctx.fillStyle = 'rgba(255,' + (120 + i * 12) + ',60,' + (1 - age) + ')';
            ctx.beginPath(); ctx.arc(tx + Math.cos(a) * r * 1.1, ty + Math.sin(a) * r * 1.1, 3, 0, Math.PI * 2); ctx.fill();
        }
        return;
    }
    ctx.save();
    ctx.translate(tx, ty); ctx.rotate(ang);
    const flick = 0.75 + Math.random() * 0.5;
    const fg = ctx.createLinearGradient(-40 * flick, 0, -10, 0);
    fg.addColorStop(0, 'rgba(255,90,40,0)'); fg.addColorStop(1, 'rgba(255,200,61,0.95)');
    ctx.fillStyle = fg;
    ctx.beginPath(); ctx.moveTo(-12, -7); ctx.lineTo(-40 * flick, 0); ctx.lineTo(-12, 7); ctx.closePath(); ctx.fill();
    ctx.restore();
    ctx.save();
    ctx.beginPath(); ctx.arc(tx, ty, 15, 0, Math.PI * 2); ctx.closePath();
    ctx.fillStyle = '#ffc83d'; ctx.fill();
    ctx.clip();
    if (rocketFace.complete && rocketFace.naturalWidth) ctx.drawImage(rocketFace, tx - 14, ty - 14, 28, 28);
    ctx.restore();
    ctx.strokeStyle = mode === 'ghost' ? 'rgba(255,200,61,0.6)' : '#ffc83d'; ctx.lineWidth = 2;
    ctx.beginPath(); ctx.arc(tx, ty, 15, 0, Math.PI * 2); ctx.stroke();
}
function rocketLoop() {
    cancelAnimationFrame(rocketRaf);
    const tick = () => {
        const now = Date.now();
        if (rocket) {
            const m = multAt(now - rocket.start);
            // both of these start their own loop
            if (rocket.auto && rocket.auto <= rocket.crashAt && m >= rocket.auto) return rocketCashOut(rocket.auto);
            if (m >= rocket.crashAt) return rocketCrash();
            {
                rocketMultEl.textContent = m.toFixed(2) + '×';
                const pay = Math.floor(rocket.bet * Math.floor(m * 100) / 100);
                rocketBtn.textContent = `Cash out ${shortNum(pay)} ${CUR_SHORT[rocket.cur]}`;
            }
        } else if (flight.mode === 'ghost') {
            const m = multAt(now - flight.start);
            if (m >= flight.crashAt) { flight.mode = 'crashed'; flight.crashedAtMs = now; rocketNoteEl.textContent = `You cashed out at ${flight.cashedAt.toFixed(2)}×. It blew up at ${flight.crashAt.toFixed(2)}×.`; }
        }
        drawRocketFrame();
        const animating = rocket || flight.mode === 'ghost' || (flight.mode === 'crashed' && now - flight.crashedAtMs < 700);
        if (animating) rocketRaf = requestAnimationFrame(tick);
    };
    rocketRaf = requestAnimationFrame(tick);
}
function setRocketLive(live) {
    rocketBtn.classList.toggle('cashout', live);
    rocketBtn.classList.toggle('btn-gold', !live);
    if (!live) rocketBtn.textContent = 'Launch';
    rocketAutoEl.disabled = live;
    const tab = document.querySelector('.game-tab[data-game="rocket"]');
    if (tab) {
        let dot = tab.querySelector('.live-dot');
        if (live && !dot) { dot = document.createElement('span'); dot.className = 'live-dot'; dot.title = 'Rocket in flight'; tab.appendChild(dot); }
        if (!live && dot) dot.remove();
    }
}
function rocketLaunch() {
    if (rocket) return rocketCashOut();
    const b = currentBet();
    if (b.error) return badBet(b.error);
    const a = parseAuto();
    if (a.error) { rocketNoteEl.className = 'rocket-note crashed'; rocketNoteEl.textContent = a.error; rocketNoteEl.dataset.err = '1'; rocketAutoEl.focus(); return; }
    delete rocketNoteEl.dataset.err;
    adjustBalance(b.cur, -b.amount);
    rocket = { bet: b.amount, cur: b.cur, crashAt: rocketCrashPoint(), auto: a.auto, start: Date.now() };
    try { localStorage.setItem(ROCKET_KEY, JSON.stringify(rocket)); } catch (e) {}
    savePrefs({ auto: rocketAutoEl.value.trim() });
    refreshBalanceDisplay();
    flight = { mode: 'live', start: rocket.start, crashAt: rocket.crashAt, cashedAt: 0 };
    rocketMultEl.className = 'rocket-mult';
    rocketNoteEl.className = 'rocket-note';
    rocketNoteEl.textContent = a.auto ? `Auto cash out at ${a.auto.toFixed(2)}×` : `Bet ${shortNum(b.amount)} ${CUR_SHORT[b.cur]}`;
    setRocketLive(true);
    sizeRocketCanvas();
    rocketLoop();
}
function rocketCashOut(atMult) {
    if (!rocket) return;
    const r = rocket;
    const m = atMult || multAt(Date.now() - r.start);
    if (m >= r.crashAt) return rocketCrash();
    const mult = Math.floor(m * 100) / 100;
    const payout = Math.floor(r.bet * mult);
    rocket = null;
    try { localStorage.removeItem(ROCKET_KEY); } catch (e) {}
    adjustBalance(r.cur, payout);
    recordRound('rocket', r.cur, r.bet, payout, { rocketMult: mult, crashAt: r.crashAt, note: mult.toFixed(2) + '×' });
    // keep flying (faded) to show where it would have blown up
    flight = { mode: 'ghost', start: r.start, crashAt: r.crashAt, cashedAt: mult };
    rocketMultEl.className = 'rocket-mult cashed';
    rocketMultEl.textContent = mult.toFixed(2) + '×';
    rocketNoteEl.className = 'rocket-note cashed';
    rocketNoteEl.textContent = `Cashed out: +${shortNum(payout - r.bet)} ${CUR_SHORT[r.cur]}`;
    setRocketLive(false);
    renderCrashHistory();
    afterRound();
    rocketLoop();
}
function rocketCrash() {
    const r = rocket;
    if (!r) return;
    rocket = null;
    try { localStorage.removeItem(ROCKET_KEY); } catch (e) {}
    recordRound('rocket', r.cur, r.bet, 0, { crashAt: r.crashAt, note: 'crashed ' + r.crashAt.toFixed(2) + '×' });
    flight = { mode: 'crashed', start: r.start, crashAt: r.crashAt, cashedAt: 0, crashedAtMs: Date.now() };
    rocketMultEl.className = 'rocket-mult crashed';
    rocketMultEl.textContent = r.crashAt.toFixed(2) + '×';
    rocketNoteEl.className = 'rocket-note crashed';
    rocketNoteEl.textContent = `Blew up! What happened? −${shortNum(r.bet)} ${CUR_SHORT[r.cur]}`;
    setRocketLive(false);
    renderCrashHistory();
    afterRound();
    rocketLoop();
}
function renderCrashHistory() {
    const h = loadStats().rocketHistory;
    $('crashHistory').innerHTML = h.map(v => `<span class="${v >= 10 ? 'great' : v >= 2 ? 'good' : ''}">${Number(v).toFixed(2)}×</span>`).join('');
}
function restoreRocket() {
    let r = null;
    try { r = JSON.parse(localStorage.getItem(ROCKET_KEY) || 'null'); } catch (e) {}
    if (!r || !r.bet || !r.start || !r.crashAt) { try { localStorage.removeItem(ROCKET_KEY); } catch (e) {} return; }
    rocket = r;
    const m = multAt(Date.now() - r.start);
    if (r.auto && r.auto <= r.crashAt && m >= r.auto) {
        rocketCashOut(r.auto);
        toast('🚀 Rocket auto cashed out', `It hit ${r.auto.toFixed(2)}× while you were away.`);
    } else if (m >= r.crashAt) {
        rocketCrash();
        toast('🚀 Your rocket blew up', `It went boom at ${r.crashAt.toFixed(2)}× while you were away.`);
    } else {
        flight = { mode: 'live', start: r.start, crashAt: r.crashAt, cashedAt: 0 };
        rocketNoteEl.textContent = r.auto ? `Auto cash out at ${r.auto.toFixed(2)}×` : `Bet ${shortNum(r.bet)} ${CUR_SHORT[r.cur]}`;
        setRocketLive(true);
        showGame('rocket');
        rocketLoop();
    }
}
rocketBtn.addEventListener('click', rocketLaunch);
rocketAutoEl.addEventListener('input', () => { if (rocketNoteEl.dataset.err) { delete rocketNoteEl.dataset.err; rocketNoteEl.className = 'rocket-note'; rocketNoteEl.textContent = ''; } });
window.addEventListener('resize', () => { sizeRocketCanvas(); drawRocketFrame(); });

// =====================================================================
// Daily spin. Buffs won here are stored in the save as `pending` and start counting down when you go back to the game
// (main.js activates them), so a 30-second boost isn't wasted on this page.
// =====================================================================
function getTodayDateStr() {
    const d = new Date();
    return d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0');
}
function loadSpinState() { const s = loadSave(); return (s && s.casinoSpin) || null; }
function canSpin() { const spin = loadSpinState(); return !spin || spin.lastSpinDate !== getTodayDateStr(); }
function fmtWait(ms) {
    const m = Math.max(1, Math.ceil(ms / 60000));
    return m >= 60 ? `${Math.floor(m / 60)}h ${m % 60}m` : `${m}m`;
}
function buffLabel(b) {
    if (!b) return '';
    if (b.type === 'crit') return `+${Math.round((b.value || 0.15) * 100)}% crit chance`;
    if (b.type === 'clickBoost') return `Click power ×${b.mult || 10}`;
    if (b.type === 'cpsBoost') return `CPS ×${b.mult || 10}`;
    if (b.type === 'mystery') return 'Mystery buff';
    return 'Buff';
}
function durText(ms) { const s = Math.round(ms / 1000); return s >= 60 ? `${Math.round(s / 60)} minute${s >= 120 ? 's' : ''}` : `${s} seconds`; }
function updateSpinUI() {
    const btn = $('btnSpin'), info = $('spinInfo'), result = $('spinResult'), buffEl = $('spinBuff');
    if (!btn || !info) return;
    const spin = loadSpinState();
    if (spin && spin.lastSpinDate === getTodayDateStr()) {
        const next = new Date(); next.setHours(24, 0, 0, 0);
        btn.disabled = true;
        info.textContent = `You've spun today. Next spin in ${fmtWait(next - Date.now())}.`;
        if (spin.lastResult) result.textContent = spin.lastResult;
    } else {
        btn.disabled = false;
        info.textContent = 'Spin once per day. Resets at midnight local time.';
        result.textContent = '';
    }
    const b = spin && spin.buff;
    if (b && b.pending) buffEl.textContent = `⏳ ${buffLabel(b)} for ${durText(b.durationMs || 60000)}. Starts when you go back to the game.`;
    else if (b && b.expiresAt && b.expiresAt > Date.now()) buffEl.textContent = `⚡ ${buffLabel(b)} is active in the game: ${fmtWait(b.expiresAt - Date.now())} left.`;
    else buffEl.textContent = '';
}
// 12 slices, matching the wheel art
function getRewardPool() {
    return [
        { type: 'gems', amount: 5 }, { type: 'crit', value: 0.15, durationMin: 30 }, { type: 'gems', amount: 5 }, { type: 'clickBoost', mult: 10, durationSec: 60 },
        { type: 'gems', amount: 5 }, { type: 'cpsBoost', mult: 10, durationSec: 30 }, { type: 'gems', amount: 5 }, { type: 'crit', value: 0.15, durationMin: 30 },
        { type: 'gems', amount: 10 }, { type: 'mystery', durationMin: 5 }, { type: 'gems', amount: 10 }, { type: 'gems', amount: 50, jackpot: true },
    ];
}
function pickReward() { const pool = getRewardPool(); const idx = Math.floor(Math.random() * pool.length); return { index: idx, reward: pool[idx], poolLength: pool.length }; }
function applySpinReward(rewardObj) {
    const reward = rewardObj.reward;
    const spinState = { lastSpinDate: getTodayDateStr(), lastResult: '' };
    // a boost still running from an earlier spin keeps going if this spin pays gems
    const prev = loadSpinState();
    if (prev && prev.buff && !prev.buff.pending && Number(prev.buff.expiresAt) > Date.now()) spinState.buff = prev.buff;
    if (reward.type === 'gems') {
        adjustBalance('diamonds', reward.amount);
        spinState.lastResult = `You won ${reward.amount} Gems${reward.jackpot ? '. JACKPOT!' : '!'}`;
    } else {
        const durationMs = reward.type === 'crit' ? (reward.durationMin || 30) * 60000 : reward.type === 'mystery' ? (reward.durationMin || 5) * 60000 : (reward.durationSec || 60) * 1000;
        spinState.buff = { type: reward.type, value: reward.value, mult: reward.mult, durationMs, pending: true, expiresAt: 0 };
        spinState.lastResult = `You won ${buffLabel(spinState.buff)} for ${durText(durationMs)}!`;
    }
    persistSave({ casinoSpin: spinState });
    updateSpinUI();
    refreshBalanceDisplay();
}
function ensureWheelBuilt() {
    const img = $('spinWheel');
    if (!img || $('spinWheelWrap')) return;
    const wrap = document.createElement('div'); wrap.id = 'spinWheelWrap';
    const size = img.getBoundingClientRect().width || 280;
    Object.assign(wrap.style, { position: 'relative', width: size + 'px', height: size + 'px', margin: '0 auto', display: 'inline-block' });
    const parent = img.parentElement;
    parent.replaceChild(wrap, img);
    Object.assign(img.style, { position: 'absolute', left: '0', top: '0', width: '100%', height: '100%' });
    wrap.appendChild(img);
    const overlay = document.createElement('div'); overlay.id = 'spinWheelOverlay';
    Object.assign(overlay.style, { position: 'absolute', left: '0', top: '0', width: '100%', height: '100%', pointerEvents: 'none' });
    wrap.appendChild(overlay);
    // fixed pointer above the wheel (outside the rotating wrap) that marks the winning slice
    parent.style.position = 'relative';
    const pointer = document.createElement('div'); pointer.id = 'spinWheelPointer';
    Object.assign(pointer.style, { position: 'absolute', top: '-6px', left: '50%', transform: 'translateX(-50%)', width: '0', height: '0',
        borderLeft: '14px solid transparent', borderRight: '14px solid transparent', borderTop: '26px solid #ffd700',
        filter: 'drop-shadow(0 2px 3px rgba(0,0,0,0.6))', zIndex: '2', pointerEvents: 'none' });
    parent.appendChild(pointer);
    buildWheelOverlay();
}
function buildWheelOverlay() {
    const wrap = $('spinWheelWrap'), overlay = $('spinWheelOverlay');
    if (!wrap || !overlay) return;
    overlay.innerHTML = '';
    const pool = getRewardPool();
    const w = wrap.clientWidth || 280;
    const inner = w * 0.13;
    const segAngle = 360 / pool.length;
    pool.forEach((reward, i) => {
        const seg = document.createElement('div');
        seg.className = 'wheel-seg';
        const angle = i * segAngle + segAngle / 2;
        seg.textContent = reward.type === 'gems' ? (reward.jackpot ? 'JACKPOT ' + reward.amount : reward.amount + ' Gems')
            : reward.type === 'crit' ? '+' + Math.round(reward.value * 100) + '% Crit' : reward.type === 'clickBoost' ? 'x' + reward.mult + ' Click'
            : reward.type === 'cpsBoost' ? 'x' + reward.mult + ' CPS' : '???';
        Object.assign(seg.style, { position: 'absolute', left: '50%', top: '50%', whiteSpace: 'nowrap', color: i % 2 ? '#000' : '#fff',
            fontSize: Math.max(9, Math.round(w / 30)) + 'px', fontWeight: '700', padding: '2px 6px' });
        // right half: anchor at the centre and point outward; left half: flip so the text isn't upside down
        if (angle <= 180) {
            seg.style.transformOrigin = '0 50%';
            seg.style.transform = `translateY(-50%) rotate(${angle - 90}deg) translateX(${inner}px)`;
        } else {
            seg.style.left = 'auto'; seg.style.right = '50%';
            seg.style.transformOrigin = '100% 50%';
            seg.style.transform = `translateY(-50%) rotate(${angle + 90}deg) translateX(${-inner}px)`;
        }
        overlay.appendChild(seg);
    });
}
function performSpin() {
    if (!loadSave()) persistSave({ count: 0, diamonds: 0, goldenWhat: 0, version: 3 });
    if (!canSpin()) return updateSpinUI();
    const rewardObj = pickReward();
    // record the spin before the wheel turns so a reload can't re-spin
    persistSave({ casinoSpin: Object.assign({}, loadSpinState() || {}, { lastSpinDate: getTodayDateStr(), lastResult: 'Spinning…' }) });
    ensureWheelBuilt();
    const target = $('spinWheelWrap');
    const btn = $('btnSpin');
    if (!target) return applySpinReward(rewardObj);
    btn.disabled = true;
    target.style.transition = 'none';
    target.style.transform = 'rotate(0deg)';
    void target.offsetWidth;
    const segAngle = 360 / rewardObj.poolLength;
    const finalAngle = rewardObj.index * segAngle + segAngle / 2 + (Math.random() - 0.5) * 2 * segAngle * 0.3;
    // labels sit clockwise from the top; rotating the wheel by (360 - angle) brings that slice under the pointer
    const final = (4 + Math.floor(Math.random() * 4)) * 360 + (360 - finalAngle);
    target.style.transition = 'transform 4s cubic-bezier(.2,.9,.2,1)';
    target.style.transform = 'rotate(' + final + 'deg)';
    let done = false;
    const finish = () => { if (done) return; done = true; applySpinReward(rewardObj); };
    target.addEventListener('transitionend', finish, { once: true });
    setTimeout(finish, 4300);
}
$('btnSpin').addEventListener('click', performSpin);
// a spin interrupted by a reload (date recorded, reward not yet given) is paid out now
(function finishInterruptedSpin() {
    const spin = loadSpinState();
    if (spin && spin.lastSpinDate === getTodayDateStr() && spin.lastResult === 'Spinning…') applySpinReward(pickReward());
})();

// ---------- init ----------
(function init() {
    const prefs = loadPrefs();
    setBetCurrency(prefs.cur || 'count');
    betAmountEl.value = prefs.amt || '';
    if (!betAmountEl.value) { const bal = Math.floor(balanceOf(betCur)); betAmountEl.value = amountText(Math.max(1, Math.floor(bal / 100) || 1)); }
    if (prefs.auto) rocketAutoEl.value = prefs.auto;
    refreshBalanceDisplay();
    renderRecord();
    renderPaytable();
    renderReelsStatic();
    renderCrashHistory();
    showGame(prefs.tab || 'blackjack');
    setDealerText(pickRandom(_dealerMessages.opening));
    setBjButtons('idle');
    restoreBlackjack();
    restoreRocket();
    ensureWheelBuilt();
    updateSpinUI();
    setInterval(updateSpinUI, 30000);
    sizeRocketCanvas(); drawRocketFrame();
    window.addEventListener('resize', buildWheelOverlay);
    // the main game open in another tab can change balances
    window.addEventListener('storage', e => { if (e.key === SAVE_KEY) refreshBalanceDisplay(); });
    checkCasinoAchievements();
})();

// quick helpers for debugging and tests
window.__gamba = { refreshBalanceDisplay, slotOutcome, SLOT_SYMBOLS, multAt, rocketCrashPoint, loadStats, handInfo };
