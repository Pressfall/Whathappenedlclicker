/**
 * Chat safety, shared by every chat in the game: the main game's global and clan chat (index.html), the clan page
 * (clan.html) and the Wilds (speech bubbles and the chat log). All of it runs in the reader's or sender's own browser, so it
 * keeps chat readable and slows a casual spammer; it is not moderation (a modified page or a reload gets round the send
 * limits, and nothing here removes a message from the database).
 *
 * - Swear filter ("safe mode"): ON unless the player turned it off. Stored in localStorage 'chat_safe_mode': '1' on,
 *   '0' off; unset (a new visitor, or someone who never touched the toggle) counts as on.
 * - display(text, safe): what to show for a message: long walls of one repeated character or chunk squashed, then swear
 *   words hidden when safe is on. Always applied when showing a message, never to what is stored.
 * - limiter(): per-channel send limits for the sender's own page (a short gap, a burst cap, no exact repeats soon after).
 * - collapse(list): consecutive identical messages from one sender shown once, with a count.
 *
 * Works in a browser (<script src="core/chat-safety.js"> sets window.WHChatSafety) and in Node (require).
 */
(function (root, factory) {
    if (typeof module === 'object' && module.exports) module.exports = factory();
    else root.WHChatSafety = factory();
}(typeof self !== 'undefined' ? self : this, function () {
    'use strict';

    const KEY = 'chat_safe_mode';
    // whole words, any case
    const WORDS = ['damn', 'hell', 'crap', 'ass', 'bastard', 'bitch', 'shit', 'shitty', 'fuck', 'fucking', 'fucker', 'fucked', 'wtf', 'stfu',
        'dick', 'dumbass', 'bullshit', 'piss', 'pissed', 'slut', 'whore', 'cunt', 'nigger', 'nigga', 'fag', 'faggot', 'retard', 'retarded', 'rape', 'raped'];
    const WORD_RE = new RegExp('\\b(' + WORDS.join('|') + ')\\b', 'gi');
    // the same character or short chunk 8+ times in a row: kept to 3 and a "…"
    const RUN_RE = /([\s\S]{1,12}?)\1{7,}/gu;
    const LIMITS = { gapMs: 1500, burst: 5, burstMs: 20000, repeatMs: 60000 };

    // Is the swear filter on? (storage: localStorage or anything with getItem)
    function isOn(storage) {
        try { return storage.getItem(KEY) !== '0'; } catch (e) { return true; }
    }
    function setOn(storage, on) {
        try { storage.setItem(KEY, on ? '1' : '0'); } catch (e) {}
    }
    function censor(text) { return String(text == null ? '' : text).replace(WORD_RE, '***'); }
    function squash(text) { return String(text == null ? '' : text).replace(RUN_RE, (m, unit) => unit + unit + unit + '…'); }
    // the Wilds draws bubbles every frame: remember the last few results
    const memo = new Map();
    function display(text, safe) {
        const s = String(text == null ? '' : text), key = (safe ? '1' : '0') + s;
        let out = memo.get(key);
        if (out === undefined) {
            out = safe ? censor(squash(s)) : squash(s);
            if (memo.size > 300) memo.clear();
            memo.set(key, out);
        }
        return out;
    }
    // for comparing messages: case and spacing don't make a message new
    function norm(text) { return String(text == null ? '' : text).toLowerCase().replace(/\s+/g, ' ').trim(); }

    // Send limits for one page. check(channel, text, now) -> { ok: true } or { ok: false, reason: 'fast'|'burst'|'repeat', waitMs, message }.
    // Call note(channel, text, now) once a message is actually sent.
    function limiter(opts) {
        const L = Object.assign({}, LIMITS, opts || {});
        const chans = new Map();
        const ch = (c) => { let v = chans.get(c); if (!v) { v = { times: [], last: [] }; chans.set(c, v); } return v; };
        return {
            check(channel, text, now) {
                const c = ch(channel), n = norm(text);
                c.times = c.times.filter(t => now - t < L.burstMs);
                c.last = c.last.filter(x => now - x.t < L.repeatMs);
                const prev = c.times[c.times.length - 1];
                if (prev !== undefined && now - prev < L.gapMs) return { ok: false, reason: 'fast', waitMs: L.gapMs - (now - prev), message: 'Slow down a little before sending again.' };
                if (c.times.length >= L.burst) return { ok: false, reason: 'burst', waitMs: L.burstMs - (now - c.times[0]), message: 'That\'s a lot of messages at once. Wait a few seconds.' };
                if (n && c.last.some(x => x.n === n)) return { ok: false, reason: 'repeat', waitMs: 0, message: 'You just sent that. Say something new.' };
                return { ok: true };
            },
            note(channel, text, now) {
                const c = ch(channel);
                c.times.push(now);
                c.last.push({ n: norm(text), t: now });
            },
            // the last noted message didn't go out after all (sending failed): don't hold it against a retry
            undo(channel) {
                const c = ch(channel);
                c.times.pop(); c.last.pop();
            },
        };
    }

    // Consecutive messages from the same sender with the same text become one entry with repeat = how many.
    // get(item) -> { name, message } picks the fields; returns [{ item, repeat }] in order.
    function collapse(list, get) {
        const out = [];
        for (const item of list || []) {
            const f = get ? get(item) : item, prev = out[out.length - 1];
            const key = String(f && f.name) + '\u0000' + norm(f && f.message);
            if (prev && prev.key === key) { prev.repeat++; prev.item = item; continue; } // keep the newest (its time)
            out.push({ item, repeat: 1, key });
        }
        return out.map(x => ({ item: x.item, repeat: x.repeat }));
    }

    return { KEY, WORDS, LIMITS, isOn, setOn, censor, squash, display, norm, limiter, collapse };
}));
