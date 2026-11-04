/**
 * An in-memory stand-in for the Firestore web SDK, for browser tests only (tests/browser/chat.js serves it in place of
 * https://www.gstatic.com/firebasejs/.../firebase-firestore.js, so nothing reaches the real database). It covers what
 * index.html and clan.html import, simply: documents live in window.__fakeFS (seeded from localStorage '__fake_fs_seed',
 * { "collection/id": data }, timestamps as { "__ms": n }), queries filter, sort and limit, listeners re-run on every write,
 * and every addDoc is recorded in window.__fakeFS.adds.
 */
const SEED_KEY = '__fake_fs_seed';
const FS = window.__fakeFS || (window.__fakeFS = { docs: seed(), subs: new Set(), adds: [], n: 0 });
function seed() { try { return JSON.parse(localStorage.getItem(SEED_KEY) || '{}'); } catch (e) { return {}; } }

const isObj = (v) => !!v && typeof v === 'object' && !Array.isArray(v);
const join = (segs) => segs.flatMap((s) => String(s).split('/')).filter(Boolean).join('/');
const parent = (p) => p.split('/').slice(0, -1).join('/');
const ts = (ms) => ({ __ms: ms, toDate: () => new Date(ms), toMillis: () => ms, seconds: Math.floor(ms / 1000) });
// what a reader sees: { __ms } values become Timestamps
function view(v) {
    if (Array.isArray(v)) return v.map(view);
    if (!isObj(v)) return v;
    if (typeof v.__ms === 'number') return ts(v.__ms);
    const out = {};
    for (const k in v) out[k] = view(v[k]);
    return out;
}
// what is stored: sentinels applied against the current value
function apply(cur, v) {
    if (isObj(v) && v.__fake === 'ts') return { __ms: Date.now() };
    if (isObj(v) && v.__fake === 'inc') return (typeof cur === 'number' ? cur : 0) + v.n;
    if (isObj(v) && v.__fake === 'union') return [...new Set([...(Array.isArray(cur) ? cur : []), ...v.items])];
    if (isObj(v) && v.__fake === 'remove') return (Array.isArray(cur) ? cur : []).filter((x) => !v.items.includes(x));
    if (isObj(v) && typeof v.__ms === 'number') return { __ms: v.__ms };
    if (isObj(v) && typeof v.toMillis === 'function') return { __ms: v.toMillis() };
    if (isObj(v)) { const out = isObj(cur) ? Object.assign({}, cur) : {}; for (const k in v) { const r = apply(out[k], v[k]); if (isObj(v[k]) && v[k].__fake === 'del') delete out[k]; else out[k] = r; } return out; }
    return v;
}
function changed() { setTimeout(() => FS.subs.forEach((s) => { try { s(); } catch (e) { console.warn(e); } }), 0); }

export const getFirestore = () => ({ fake: true });
export const collection = (db, ...segs) => ({ type: 'col', path: join(segs) });
export function doc(a, ...segs) {
    if (a && a.type === 'col') return { type: 'doc', path: join([a.path, ...(segs.length ? segs : ['auto' + (++FS.n) + Date.now().toString(36)])]) };
    const path = join(segs);
    return { type: 'doc', path, id: path.split('/').pop() };
}
export const query = (ref, ...cons) => ({ type: 'query', path: ref.path, cons });
export const where = (f, op, v) => ({ k: 'where', f, op, v });
export const orderBy = (f, dir) => ({ k: 'order', f, dir: dir || 'asc' });
export const limit = (n) => ({ k: 'limit', n });
export const serverTimestamp = () => ({ __fake: 'ts' });
export const increment = (n) => ({ __fake: 'inc', n });
export const arrayUnion = (...items) => ({ __fake: 'union', items });
export const arrayRemove = (...items) => ({ __fake: 'remove', items });
export const deleteField = () => ({ __fake: 'del' });

const field = (d, f) => f.split('.').reduce((o, k) => (o == null ? undefined : o[k]), d);
const cmp = (a, b) => { const x = isObj(a) && a.__ms !== undefined ? a.__ms : a, y = isObj(b) && b.__ms !== undefined ? b.__ms : b; return x < y ? -1 : x > y ? 1 : 0; };
function docSnap(path) {
    const d = FS.docs[path];
    return { id: path.split('/').pop(), ref: { type: 'doc', path }, exists: () => d !== undefined, data: () => (d === undefined ? undefined : view(d)) };
}
function run(q) {
    let rows = Object.keys(FS.docs).filter((p) => parent(p) === q.path).map((p) => ({ p, d: FS.docs[p] }));
    for (const c of q.cons || []) {
        if (c.k === 'where') rows = rows.filter(({ d }) => {
            const v = field(d, c.f);
            switch (c.op) {
                case '==': return cmp(v, c.v) === 0;
                case '!=': return cmp(v, c.v) !== 0;
                case 'in': return c.v.some((x) => cmp(v, x) === 0);
                case 'array-contains': return Array.isArray(v) && v.includes(c.v);
                case '>': return cmp(v, c.v) > 0; case '>=': return cmp(v, c.v) >= 0;
                case '<': return cmp(v, c.v) < 0; case '<=': return cmp(v, c.v) <= 0;
                default: return true;
            }
        });
        if (c.k === 'order') rows.sort((a, b) => cmp(field(a.d, c.f), field(b.d, c.f)) * (c.dir === 'desc' ? -1 : 1));
        if (c.k === 'limit') rows = rows.slice(0, c.n);
    }
    const docs = rows.map(({ p }) => docSnap(p));
    return { docs, size: docs.length, empty: !docs.length, forEach: (fn) => docs.forEach(fn) };
}
export async function getDoc(ref) { return docSnap(ref.path); }
export async function getDocs(q) { return run(q.type === 'col' ? { path: q.path, cons: [] } : q); }
export async function setDoc(ref, data, opts) { FS.docs[ref.path] = apply(opts && opts.merge ? FS.docs[ref.path] : undefined, data); changed(); }
export async function updateDoc(ref, data) {
    if (FS.docs[ref.path] === undefined) throw Object.assign(new Error('not-found'), { code: 'not-found' });
    const cur = Object.assign({}, FS.docs[ref.path]);
    for (const k in data) {
        const keys = k.split('.'), last = keys.pop();
        let o = cur;
        for (const kk of keys) { o[kk] = isObj(o[kk]) ? Object.assign({}, o[kk]) : {}; o = o[kk]; }
        if (isObj(data[k]) && data[k].__fake === 'del') delete o[last]; else o[last] = apply(o[last], data[k]);
    }
    FS.docs[ref.path] = cur; changed();
}
export async function deleteDoc(ref) { delete FS.docs[ref.path]; changed(); }
export async function addDoc(col, data) {
    const ref = doc(col);
    FS.docs[ref.path] = apply(undefined, data);
    FS.adds.push({ path: col.path, data: FS.docs[ref.path] });
    changed();
    return { id: ref.path.split('/').pop(), path: ref.path };
}
export function onSnapshot(ref, cb, onErr) {
    const fire = () => { try { cb(ref.type === 'doc' ? docSnap(ref.path) : run(ref.type === 'col' ? { path: ref.path, cons: [] } : ref)); } catch (e) { if (onErr) onErr(e); } };
    FS.subs.add(fire);
    setTimeout(fire, 0);
    return () => FS.subs.delete(fire);
}
export async function runTransaction(db, fn) {
    return fn({ get: getDoc, set: (r, d, o) => { setDoc(r, d, o); }, update: (r, d) => { updateDoc(r, d); }, delete: (r) => { deleteDoc(r); } });
}
// anything else a page might import
export const enableIndexedDbPersistence = async () => {};
export const Timestamp = { now: () => ts(Date.now()), fromMillis: ts };
