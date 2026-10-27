/* qurOS — records.
   IndexedDB database `qurOS`, three stores, all loaded into memory at boot
   (the whole record is text and small) and written through on every change:
     entries  keyPath id    — dumps and notes
     days     keyPath date  — the day log, one record per YYYY-MM-DD
     kv       keyPath k     — the map, map states, weekly goals, send history
   When IndexedDB is unavailable (some private modes, the test runner) the
   same data goes to one localStorage key instead. The app shares an origin
   with root on GitHub Pages, so every name here is qurOS's own. */
(() => {
const Q = window.Q;
const NAME = 'qurOS', VERSION = 1, LS = 'qos_data_v1';
const KEY = { entries: 'id', days: 'date', kv: 'k' };
const mem = { entries: new Map(), days: new Map(), kv: new Map() };
let idb = null, mode = 'none', lsTimer = 0;
const failed = new Set();

function openIdb() {
  return new Promise((res, rej) => {
    const r = indexedDB.open(NAME, VERSION);
    r.onupgradeneeded = () => {
      const d = r.result;
      Object.keys(KEY).forEach(s => { if (!d.objectStoreNames.contains(s)) d.createObjectStore(s, { keyPath: KEY[s] }); });
    };
    r.onsuccess = () => res(r.result);
    r.onerror = () => rej(r.error);
    r.onblocked = () => rej(new Error('blocked'));
  });
}
const getAll = s => new Promise((res, rej) => {
  const q = idb.transaction(s).objectStore(s).getAll();
  q.onsuccess = () => res(q.result || []);
  q.onerror = () => rej(q.error);
});

async function init() {
  try {
    if (!window.indexedDB) throw new Error('no indexedDB');
    idb = await openIdb();
    idb.onversionchange = () => idb.close();
    for (const s of Object.keys(KEY)) (await getAll(s)).forEach(o => mem[s].set(o[KEY[s]], o));
    mode = 'idb';
  } catch {
    idb = null; mode = 'ls';
    try {
      const d = JSON.parse(localStorage.getItem(LS) || '{}');
      Object.keys(KEY).forEach(s => (d[s] || []).forEach(o => mem[s].set(o[KEY[s]], o)));
    } catch {}
  }
  return mode;
}

function writeLs() {
  clearTimeout(lsTimer);
  lsTimer = setTimeout(() => {
    const d = {};
    Object.keys(KEY).forEach(s => { d[s] = [...mem[s].values()]; });
    try { localStorage.setItem(LS, JSON.stringify(d)); }
    catch { Q.ui && Q.ui.toast('could not save — the browser\'s storage is full'); }
  }, 60);
}
function tx(store, fn) {
  if (mode !== 'idb') { writeLs(); return; }
  try {
    const t = idb.transaction(store, 'readwrite');
    fn(t.objectStore(store));
    t.onerror = () => {
      /* keep the change in memory; say so once per store rather than per keystroke */
      if (!failed.has(store)) { failed.add(store); Q.ui && Q.ui.toast('could not save to storage — make a backup in SEND'); }
    };
    t.oncomplete = () => failed.delete(store);
  } catch { writeLs(); }
}

const db = {
  init,
  mode: () => mode,
  get: (s, k) => mem[s].get(k),
  all: s => [...mem[s].values()],
  put(s, o) { mem[s].set(o[KEY[s]], o); tx(s, st => st.put(o)); return o; },
  del(s, k) { mem[s].delete(k); tx(s, st => st.delete(k)); },
  kv(k, def) { const r = mem.kv.get(k); return r ? r.v : def; },
  setKv(k, v) { db.put('kv', { k, v, t: Date.now() }); return v; },
  /* restore: replace every store, or merge (the newer of two copies wins) */
  load(data, how) {
    Object.keys(KEY).forEach(s => {
      if (how === 'replace') { mem[s].clear(); tx(s, st => st.clear()); }
      (data[s] || []).forEach(o => {
        const k = o && o[KEY[s]];
        if (k == null) return;
        const have = mem[s].get(k);
        if (how !== 'replace' && have && stamp(have) > stamp(o)) return;
        db.put(s, o);
      });
    });
  },
  dump() { const d = {}; Object.keys(KEY).forEach(s => { d[s] = db.all(s); }); return d; },
  async persist() {
    try { if (navigator.storage && navigator.storage.persist) return await navigator.storage.persist(); } catch {}
    return false;
  },
  async persisted() {
    try { if (navigator.storage && navigator.storage.persisted) return await navigator.storage.persisted(); } catch {}
    return null;
  },
};
const stamp = o => Math.max(o.edited || 0, o.touched || 0, o.at || 0, o.t || 0);

/* ── the draft ───────────────────────────────────────────────────────────
   A dump in progress is written to localStorage on every phrase. localStorage
   is synchronous, so the words are on disk before the browser can kill the
   tab — a phone that runs out of battery mid-walk loses nothing. */
const DRAFT = 'qos_draft';
db.draft = {
  save(d) { try { localStorage.setItem(DRAFT, JSON.stringify(d)); } catch {} },
  get() { try { return JSON.parse(localStorage.getItem(DRAFT) || 'null'); } catch { return null; } },
  clear() { try { localStorage.removeItem(DRAFT); } catch {} },
};

Q.db = db;
})();
