'use strict';
/**
 * In-memory stand-ins for the browser and Firestore, so several "devices" can sync against one account.
 *
 * FakeAccountStore mimics the saves/{uid} document and enforces the same rev rule as firestore-saves.rules, so a sync
 * engine that wrote a rev the real rules would refuse fails here too.
 */
const Progress = require('../../core/progress');

class MemoryStorage {
    constructor(initial = {}) { this.map = new Map(Object.entries(initial)); }
    get length() { return this.map.size; }
    key(i) { return Array.from(this.map.keys())[i] ?? null; }
    getItem(k) { return this.map.has(k) ? this.map.get(k) : null; }
    setItem(k, v) { this.map.set(k, String(v)); }
    removeItem(k) { this.map.delete(k); }
}

class FakeAccountStore {
    constructor() { this.docs = new Map(); this.clock = 1_700_000_000_000; this.writes = []; this.reads = 0; }
    // what Firestore would hold for a uid, as the sync engine reads it
    peek(uid) { return this.docs.get(uid) || null; }
    remoteFor(uid) {
        return {
            fetch: async (u) => { this.reads++; const d = this.docs.get(u); return d ? { ...d } : null; },
            transaction: async (u, decide) => {
                if (u !== uid) throw Object.assign(new Error('permission-denied'), { code: 'permission-denied' });
                const cur = this.docs.get(u) || null;
                const next = decide(cur ? { ...cur } : null);
                this.checkRules(cur, next);
                this.clock += 1000;
                this.docs.set(u, { ...next, updatedAt: this.clock });
                this.writes.push({ uid: u, rev: next.rev });
                return next.rev;
            },
        };
    }
    // firestore-saves.rules: exact fields, v == 1, rev == 1 on create and previous rev + 1 on update, payload <= 900000
    checkRules(cur, next) {
        const deny = (why) => { throw Object.assign(new Error('permission-denied: ' + why), { code: 'permission-denied' }); };
        const keys = Object.keys(next).sort().join();
        if (keys !== 'device,payload,rev,summary,v') deny('fields ' + keys);
        if (next.v !== 1) deny('v');
        if (!Number.isInteger(next.rev)) deny('rev type');
        if (typeof next.payload !== 'string' || next.payload.length > 900000) deny('payload');
        if (typeof next.device !== 'string' || next.device.length > 64) deny('device');
        if (!next.summary || typeof next.summary !== 'object') deny('summary');
        if (!cur && next.rev !== 1) deny('create must be rev 1');
        if (cur && next.rev !== cur.rev + 1) deny(`update must be rev ${cur.rev + 1}, got ${next.rev}`);
    }
}

let tick = 1_700_000_000_000;
/** One browser profile signed in as `uid`. play() edits progress the way the game would. */
function makeDevice(account, uid, { label = 'Test device', start = tick } = {}) {
    const store = new MemoryStorage();
    let now = start;
    const events = [];
    const engine = Progress.create({
        store, now: () => now, deviceLabel: () => label,
        beforeReplace: () => events.push('beforeReplace'),
        remote: account.remoteFor(uid),
    });
    const user = { uid };
    const device = {
        store, engine, user, events, label,
        advance(ms) { now += ms; },
        /** write progress: main save fields plus play time */
        play(save, extra = {}) {
            const cur = JSON.parse(store.getItem('whathappened_save') || '{}');
            store.setItem('whathappened_save', JSON.stringify({ version: 3, ...cur, ...save }));
            for (const [k, v] of Object.entries(extra)) store.setItem(k, v);
        },
        signInAs(otherUid) { return Object.assign(device, { user: { uid: otherUid }, engine: Progress.create({ store, now: () => now, deviceLabel: () => label, beforeReplace: () => events.push('beforeReplace'), remote: account.remoteFor(otherUid) }) }); },
        save() { const raw = store.getItem('whathappened_save'); return raw ? JSON.parse(raw) : null; },
        reconcile(choice) {
            const asked = [];
            return device.engine.reconcile(device.user, async (local, cloud) => { asked.push({ local, cloud }); return choice || 'later'; })
                .then((res) => Object.assign(res, { asked }));
        },
    };
    return device;
}

module.exports = { MemoryStorage, FakeAccountStore, makeDevice };
