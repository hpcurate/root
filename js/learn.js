/* ── LEARN ────────────────────────────────────────────────────────────────────
   Anki study on the go. An .apkg/.colpkg is unpacked in the browser — JSZip
   for the archive, sql.js for the collection database, fzstd for the newer
   zstd-compressed one — and its cards go into IndexedDB. Sessions are a flat
   queue: rate each card, read the scoreboard, drill what needs work. One-way:
   nothing syncs back to desktop Anki.

   Ported from learn/index.html for 2.2:
     · the three libraries are fetched only when an import starts, so ROOT stays
       a no-dependency site until you actually bring a deck in
     · the rating labels and the session shape (cap, card text size, back-first,
       tags) moved to js/config.js; the shuffle flag stays in learn_settings
       because the standalone app reads it
     · the settings screen became Settings → learn; every confirm goes through
       Shell.confirm; the toast is Shell.toast
     · IndexedDB is treated as optional: where it is missing (a test harness, a
       locked-down browser) the home screen says so instead of throwing
   Storage is untouched: IndexedDB `learn_v1` (decks, cards, media) and the
   `learn_settings` key. Decks are NOT in the ROOT backup file — it carries
   localStorage only — so a new device needs the .apkg again. */
window.LEARN = (function () {
'use strict';

const SCOPE = '.ns-learn ';
const view  = document.querySelector('#view-learn .view-body');   // the scroll container (Shell wraps it)
const $id   = id  => document.querySelector(SCOPE + '#' + id);
const $all  = sel => document.querySelectorAll(SCOPE + sel);
const toast = msg => Shell.toast(msg);
const esc   = s => String(s == null ? '' : s).replace(/[&<>"']/g, c =>
  ({ '&':'&amp;', '<':'&lt;', '>':'&gt;', '"':'&quot;', "'":'&#39;' }[c]));
const stripHtml = s => String(s).replace(/<[^>]+>/g, '').replace(/&nbsp;/g, ' ');

/* ── Content ───────────────────────────────────────────────────────────────── */
const RATING_DEF = ['revision', 'shaky', 'almost', 'acquired'];
let RATINGS, STUDY;
function readConfig() {
  const r = Config.get('learn.ratings');
  RATINGS = RATING_DEF.map((d, i) => (Array.isArray(r) && r[i] && String(r[i]).trim()) || d);
  STUDY = Object.assign({ sessionCap:0, cardScale:1, flip:false, showTags:false }, Config.get('learn.study') || {});
  STUDY.cardScale = Math.max(0.6, Math.min(2, parseFloat(STUDY.cardScale) || 1));
  if (view) view.style.setProperty('--learn-scale', STUDY.cardScale);
}
readConfig();

/* ── Libraries, on demand ──────────────────────────────────────────────────── */
const LIBS = [
  { global:'JSZip',     src:'https://cdn.jsdelivr.net/npm/jszip@3.10.1/dist/jszip.min.js' },
  { global:'initSqlJs', src:'https://cdnjs.cloudflare.com/ajax/libs/sql.js/1.10.3/sql-wasm.js' },
  { global:'fzstd',     src:'https://cdn.jsdelivr.net/npm/fzstd@0.1.1/umd/index.js' },
];
const SQL_WASM = 'https://cdnjs.cloudflare.com/ajax/libs/sql.js/1.10.3/';
function loadScript(src) {
  return new Promise((res, rej) => {
    const s = document.createElement('script');
    s.src = src; s.onload = res; s.onerror = () => rej(new Error('could not load ' + src.split('/').pop()));
    document.head.appendChild(s);
  });
}
async function ensureLibs() {
  for (const l of LIBS) if (typeof window[l.global] === 'undefined') await loadScript(l.src);
}
let SQL = null;
async function ensureSQL() {
  if (SQL) return SQL;
  SQL = await window.initSqlJs({ locateFile: f => SQL_WASM + f });
  return SQL;
}

/* ── IndexedDB ─────────────────────────────────────────────────────────────── */
const DB_NAME = 'learn_v1', DB_VER = 2;
const hasIDB = typeof indexedDB !== 'undefined' && indexedDB !== null;
let _db;
function db() {
  if (_db) return Promise.resolve(_db);
  if (!hasIDB) return Promise.reject(new Error('IndexedDB is not available here'));
  return new Promise((res, rej) => {
    const r = indexedDB.open(DB_NAME, DB_VER);
    r.onupgradeneeded = () => {
      const d = r.result;
      if (!d.objectStoreNames.contains('decks')) d.createObjectStore('decks', { keyPath:'id' });
      if (!d.objectStoreNames.contains('cards')) {
        const s = d.createObjectStore('cards', { keyPath:'id' });
        s.createIndex('deck', 'deckId', { unique:false });
      }
      if (!d.objectStoreNames.contains('media'))   d.createObjectStore('media', { keyPath:'key' });
      if (!d.objectStoreNames.contains('sources')) d.createObjectStore('sources', { keyPath:'deckId' });
    };
    r.onsuccess = () => { _db = r.result; res(_db); };
    r.onerror = () => rej(r.error);
  });
}
const tx = (stores, mode = 'readonly') => db().then(d => d.transaction(stores, mode));
const req = (t, fn) => new Promise((res, rej) => { const r = fn(t); r.onsuccess = () => res(r.result); r.onerror = () => rej(r.error); });
const put    = (store, val)  => tx([store], 'readwrite').then(t => req(t, t => t.objectStore(store).put(val)));
const getAll = store         => tx([store]).then(t => req(t, t => t.objectStore(store).getAll()));
const get1   = (store, key)  => tx([store]).then(t => req(t, t => t.objectStore(store).get(key)));
const del1   = (store, key)  => tx([store], 'readwrite').then(t => req(t, t => t.objectStore(store).delete(key)));
const getByIndex = (store, index, value) => tx([store]).then(t =>
  req(t, t => t.objectStore(store).index(index).getAll(IDBKeyRange.only(value))));
function delByIndex(store, index, value) {
  return tx([store], 'readwrite').then(t => new Promise((res, rej) => {
    const r = t.objectStore(store).index(index).openCursor(IDBKeyRange.only(value));
    r.onsuccess = () => { const c = r.result; if (c) { c.delete(); c.continue(); } else res(); };
    r.onerror = () => rej(r.error);
  }));
}
function bulkPut(store, items) {
  return tx([store], 'readwrite').then(t => new Promise((res, rej) => {
    const s = t.objectStore(store);
    items.forEach(it => s.put(it));
    t.oncomplete = () => res(); t.onerror = () => rej(t.error);
  }));
}

/* ── State ─────────────────────────────────────────────────────────────────── */
let currentDeckId = null;
const session = { queue:[], idx:0, total:0, current:null, shown:false, counts:{ 1:0, 2:0, 3:0, 4:0 }, needsWork:[] };
const settings = { shuffle:true };
let mediaCache = {};               // name -> blob URL (active deck)

function loadSettings() {
  try { Object.assign(settings, JSON.parse(localStorage.getItem('learn_settings') || '{}')); } catch {}
}
function saveSettings() { try { localStorage.setItem('learn_settings', JSON.stringify(settings)); } catch {} }

/* ── Routing ───────────────────────────────────────────────────────────────── */
function go(id) {
  $all('.scr').forEach(s => s.classList.toggle('on', s.id === 's-' + id));
  if (view) view.scrollTop = 0;
  if (id === 'home') renderHome();
}

/* ── Minimal protobuf reader — top-level string fields of a blob. Used to pull
   q_format (field 1) / a_format (field 2) out of TemplateConfig in the new
   Anki schema. ───────────────────────────────────────────────────────────── */
function readVarint(bytes, pos) {
  let val = 0, shift = 0;
  while (pos < bytes.length && shift < 32) {
    const b = bytes[pos++];
    val |= (b & 0x7F) << shift;
    if ((b & 0x80) === 0) return [val >>> 0, pos];
    shift += 7;
  }
  return [val >>> 0, pos];
}
function readProtoStrings(bytes) {
  const out = {};
  if (!bytes || !bytes.length) return out;
  const td = new TextDecoder('utf-8', { fatal:false });
  let pos = 0;
  while (pos < bytes.length) {
    const [tag, p1] = readVarint(bytes, pos); pos = p1;
    const wire = tag & 0x07, num = tag >>> 3;
    if (wire === 0) { const [, p2] = readVarint(bytes, pos); pos = p2; }
    else if (wire === 1) pos += 8;
    else if (wire === 2) {
      const [len, p2] = readVarint(bytes, pos);
      const sub = bytes.subarray(p2, p2 + len);
      pos = p2 + len;
      if (!(num in out)) out[num] = td.decode(sub);
    }
    else if (wire === 5) pos += 4;
    else break;
  }
  return out;
}

/* ── .apkg import ──────────────────────────────────────────────────────────── */
async function handleFile(file) {
  const t = $id('iz-t'), s = $id('iz-s');
  const origT = t.innerHTML, origS = s.textContent;
  t.innerHTML = '<span class="spinner"></span>Importing';
  s.textContent = file.name;
  try {
    await ensureLibs();
    await ensureSQL();
    const buf = await file.arrayBuffer();
    const zip = await window.JSZip.loadAsync(buf);

    // Priority: .anki21b (new, zstd) > .anki21 > .anki2. A new-format .apkg also
    // carries a stub .anki2 with just a "please update Anki" note, so .anki21b
    // MUST be checked first.
    let dbFile, needsZstd = false;
    if (zip.file('collection.anki21b'))     { dbFile = zip.file('collection.anki21b'); needsZstd = true; }
    else if (zip.file('collection.anki21')) dbFile = zip.file('collection.anki21');
    else if (zip.file('collection.anki2'))  dbFile = zip.file('collection.anki2');
    if (!dbFile) throw new Error('No collection database found in this .apkg');

    let dbBuf = await dbFile.async('uint8array');
    if (needsZstd) dbBuf = window.fzstd.decompress(dbBuf);
    const adb = new SQL.Database(dbBuf);

    // New schema (Anki 2.1.50+): models & decks in their own tables, templates.config protobuf-encoded.
    const newSchema = adb.exec("SELECT name FROM sqlite_master WHERE type='table' AND name='notetypes'").length > 0;

    let decksJson, modelsJson;
    if (newSchema) {
      modelsJson = {};
      const ntq = adb.exec('SELECT id, name FROM notetypes');
      if (ntq[0]) for (const [id, name] of ntq[0].values) modelsJson[String(id)] = { id:String(id), name, flds:[], tmpls:[], type:0 };
      const fq = adb.exec('SELECT ntid, ord, name FROM fields ORDER BY ntid, ord');
      if (fq[0]) for (const [ntid, ord, name] of fq[0].values) { const m = modelsJson[String(ntid)]; if (m) m.flds[ord] = { name }; }
      const tq = adb.exec('SELECT ntid, ord, name, config FROM templates ORDER BY ntid, ord');
      if (tq[0]) for (const [ntid, ord, name, config] of tq[0].values) {
        const cfg = readProtoStrings(config);
        const m = modelsJson[String(ntid)];
        if (m) {
          m.tmpls[ord] = { name, qfmt:cfg[1] || '', afmt:cfg[2] || '' };
          if (cfg[1] && cfg[1].includes('{{cloze:')) m.type = 1;
        }
      }
      decksJson = {};
      const dq = adb.exec('SELECT id, name FROM decks');
      if (dq[0]) for (const [id, name] of dq[0].values) decksJson[String(id)] = { name };
    } else {
      const colRow = adb.exec('SELECT decks, models FROM col LIMIT 1')[0];
      if (!colRow) throw new Error('Empty Anki collection');
      decksJson  = JSON.parse(colRow.values[0][0] || '{}');
      modelsJson = JSON.parse(colRow.values[0][1] || '{}');
    }

    const notes = {};
    const nr = adb.exec('SELECT id, mid, flds, tags FROM notes');
    if (nr[0]) nr[0].values.forEach(r => {
      notes[String(r[0])] = { mid:String(r[1]), flds:String(r[2] || '').split('\x1f'), tags:String(r[3] || '') };
    });
    const cr = adb.exec('SELECT id, nid, did, ord FROM cards');
    const ankiCards = cr[0] ? cr[0].values : [];
    adb.close();
    if (!ankiCards.length) throw new Error('No cards found in this file');

    // deck name: the deck with the most cards
    let defaultName = file.name.replace(/\.(apkg|colpkg)$/i, '');
    const dCounts = {};
    ankiCards.forEach(r => { const d = String(r[2]); dCounts[d] = (dCounts[d] || 0) + 1; });
    let best = null, max = -1;
    Object.entries(dCounts).forEach(([d, c]) => { if (c > max) { max = c; best = d; } });
    if (best && decksJson[best]) defaultName = (decksJson[best].name || '').split('::').pop() || defaultName;

    const deckId = 'dk_' + Date.now().toString(36) + '_' + Math.random().toString(36).slice(2, 7);
    const cards = [];
    for (const r of ankiCards) {
      const [aid, nid, , ord] = r;
      const note = notes[String(nid)];
      if (!note) continue;
      const model = modelsJson[note.mid];
      if (!model || !model.tmpls || !model.tmpls.length) continue;
      const tmpl = model.tmpls[ord] || model.tmpls[0];
      if (!tmpl) continue;
      cards.push({
        id:deckId + '_' + aid, deckId, ankiId:String(aid),
        front:tmpl.qfmt, back:tmpl.afmt, fields:note.flds,
        fieldNames:(model.flds || []).map(f => f ? f.name : ''),
        tags:note.tags.trim(), modelName:model.name || '', modelType:model.type || 0,   // 0 standard, 1 cloze
        rating:null, ratedAt:null,                                                    // 1 = lowest .. 4 = acquired
      });
    }
    if (!cards.length) throw new Error('No usable cards found (templates missing)');

    let mediaMap = {};
    const mediaF = zip.file('media');
    if (mediaF) { try { mediaMap = JSON.parse(await mediaF.async('string')); } catch {} }

    const deck = { id:deckId, name:defaultName, createdAt:Date.now(), totalCards:cards.length, mediaCount:Object.keys(mediaMap).length };
    await put('decks', deck);
    await bulkPut('cards', cards);
    for (const [num, name] of Object.entries(mediaMap)) {      // skip files over 5 MB each
      const mf = zip.file(num);
      if (!mf) continue;
      const blob = await mf.async('blob');
      if (blob.size > 5 * 1024 * 1024) continue;
      await put('media', { key:deckId + '/' + name, blob });
    }

    t.innerHTML = origT; s.textContent = origS;
    toast('imported ' + cards.length + ' cards');
    await renderHome();
  } catch (err) {
    console.error(err);
    t.innerHTML = origT; s.textContent = origS;
    toast(err.message || 'import failed');
  }
}

/* ── Home ──────────────────────────────────────────────────────────────────── */
/* What search can see. The decks are in IndexedDB and every read of them is
   async, so the home screen — which runs at boot and on every visit — leaves
   the names behind for a synchronous reader. Empty until it has run once, and
   empty for good where there is no IndexedDB at all. */
let deckNames = [];
function deckList() { return deckNames.slice(); }

async function renderHome() {
  const list = $id('deck-list'); if (!list) return;
  let decks;
  try { decks = await getAll('decks'); }
  catch (e) {
    list.innerHTML = `<div class="empty-state">Decks cannot be stored here.<br>${esc(e.message || 'IndexedDB unavailable')}</div>`;
    deckNames = [];
    return;
  }
  deckNames = decks.map(d => ({ id: d.id, name: d.name }));
  if (!decks.length) {
    list.innerHTML = '<div class="empty-state">No decks yet.<br>Tap <em>import</em> above to bring your Anki deck in.</div>';
    return;
  }
  decks.sort((a, b) => b.createdAt - a.createdAt);
  const html = ['<div class="list-label">your decks</div>'];
  for (const d of decks) {
    const cards = await getByIndex('cards', 'deck', d.id);
    const acq = cards.filter(c => c.rating === 4).length;
    const work = cards.filter(c => c.rating != null && c.rating < 4).length;
    html.push(`<div class="deck card${work > 0 ? ' has-due' : ''}" onclick="LEARN.goDeck('${esc(d.id)}')">
        <div><div class="deck-name">${esc(d.name)}</div>
          <div class="deck-meta">${cards.length} cards · <em>${acq}</em> ${esc(RATINGS[3])} · <span class="ml">${work}</span> needs work</div></div>
        <div class="deck-arrow">→</div></div>`);
  }
  list.innerHTML = html.join('');
}

/* ── Deck ──────────────────────────────────────────────────────────────────── */
async function goDeck(id) {
  currentDeckId = id;
  let d;
  try { d = await get1('decks', id); } catch { d = null; }
  if (!d) { toast('deck missing'); go('home'); return; }
  $id('deck-title').textContent = d.name.toUpperCase();
  const cards = await getByIndex('cards', 'deck', id);
  const total = cards.length;
  const acq = cards.filter(c => c.rating === 4).length;
  const work = cards.filter(c => c.rating != null && c.rating < 4).length;
  setStat('total', total); setStat('acq', acq); setStat('work', work);
  $id('stat-acq-l').textContent = RATINGS[3];
  const btnAll = $id('btn-study');
  btnAll.disabled = total === 0;
  btnAll.textContent = total ? `Study all cards (${total})` : 'No cards';
  const btnWork = $id('btn-study-work');
  btnWork.disabled = work === 0;
  btnWork.textContent = work ? `Study needs-work only (${work})` : 'Study needs-work only';
  go('deck');
}
function setStat(kind, n) {
  $id('stat-' + kind).textContent = n;
  $id('stat-' + kind + '-box').classList.toggle('has', n > 0);
}
function backToDeck() { if (currentDeckId) goDeck(currentDeckId); else go('home'); }

async function resetDeckProgress() {
  if (!currentDeckId) return;
  if (!await Shell.confirm('Clear all ratings for this deck?')) return;
  const cards = await getByIndex('cards', 'deck', currentDeckId);
  for (const c of cards) { c.rating = null; c.ratedAt = null; }
  await bulkPut('cards', cards);
  toast('ratings cleared');
  goDeck(currentDeckId);
}
async function renameDeck() {
  if (!currentDeckId) return;
  const d = await get1('decks', currentDeckId);
  Shell.prompt('Deck name?', d.name, async name => {
    if (!name.trim()) return;
    d.name = name.trim();
    await put('decks', d);
    $id('deck-title').textContent = d.name.toUpperCase();
    toast('renamed');
  });
}
async function deleteCurrentDeck() {
  if (!currentDeckId) return;
  if (!await Shell.confirm('Delete this deck and all its progress? This cannot be undone.')) return;
  await delByIndex('cards', 'deck', currentDeckId);
  const media = await getAll('media');
  const prefix = currentDeckId + '/';
  for (const m of media) if (m.key.startsWith(prefix)) await del1('media', m.key);
  try { await del1('sources', currentDeckId); } catch {}
  await del1('decks', currentDeckId);
  currentDeckId = null;
  toast('deck deleted');
  go('home');
}

/* ── Media (blob URLs scoped to the active deck) ───────────────────────────── */
function freeMediaCache() {
  Object.values(mediaCache).forEach(u => { try { URL.revokeObjectURL(u); } catch {} });
  mediaCache = {};
}
async function loadMediaForDeck(deckId) {
  freeMediaCache();
  const all = await getAll('media');
  const pref = deckId + '/';
  for (const m of all) if (m.key.startsWith(pref)) mediaCache[m.key.slice(pref.length)] = URL.createObjectURL(m.blob);
}
function rewriteMedia(html) {
  html = html.replace(/<img\s+([^>]*?)src=(["'])([^"']+)\2/gi, (m, pre, q, src) => {
    let u = mediaCache[src];
    if (!u) { try { u = mediaCache[decodeURIComponent(src)]; } catch {} }
    return u ? `<img ${pre}src=${q}${u}${q}` : m;
  });
  html = html.replace(/\[sound:([^\]]+)\]/g, (m, name) => {
    const u = mediaCache[name];
    return u ? `<audio controls src="${u}"></audio>` : '';
  });
  return html;
}

/* ── Card templates (Mustache-ish, the Anki subset) ────────────────────────── */
function fieldVal(card, name) {
  name = name.trim();
  const idx = card.fieldNames.indexOf(name);
  return idx >= 0 ? (card.fields[idx] || '') : '';
}
function renderTemplate(tmpl, card, isAnswer, frontHtml) {
  let out = tmpl || '';
  out = out.replace(/\{\{cloze:([^}]+)\}\}/g, (m, fname) => renderCloze(fieldVal(card, fname), isAnswer));
  if (card.modelType === 1) out = out.replace(/\{\{c\d+::[^}]*\}\}/g, m => renderCloze(m, isAnswer));
  for (let i = 0; i < 3; i++) {   // conditionals, no nesting
    out = out.replace(/\{\{#([^}]+)\}\}([\s\S]*?)\{\{\/\1\}\}/g, (m, name, body) => stripHtml(fieldVal(card, name)).trim() ? body : '');
    out = out.replace(/\{\{\^([^}]+)\}\}([\s\S]*?)\{\{\/\1\}\}/g, (m, name, body) => stripHtml(fieldVal(card, name)).trim() ? '' : body);
  }
  out = out.replace(/\{\{type:([^}]+)\}\}/g, (m, name) => {
    const v = fieldVal(card, name);
    return isAnswer ? `<div class="type-ans">${esc(stripHtml(v))}</div>` : '<div class="type-ask">[type the answer]</div>';
  });
  out = out.replace(/\{\{(?:text|hint):([^}]+)\}\}/g, (m, name) => fieldVal(card, name));
  out = out.replace(/\{\{FrontSide\}\}/g, frontHtml || '');
  out = out.replace(/\{\{([^}]+)\}\}/g, (m, name) => {
    if (/^[#^/]/.test(name)) return '';
    if (/^(cloze|type|text|hint):/.test(name)) return '';
    return fieldVal(card, name);
  });
  return out;
}
function renderCloze(s, reveal) {
  return String(s).replace(/\{\{c(\d+)::([^}]*?)(?:::([^}]*?))?\}\}/g, (m, n, ans, hint) =>
    reveal ? `<span class="cloze-on">${ans}</span>` : `<span class="cloze-off">[${hint || '...'}]</span>`);
}

/* ── Study session — flat queue, rate-and-tally ────────────────────────────── */
function shuffle(a) { for (let i = a.length - 1; i > 0; i--) { const j = Math.floor(Math.random() * (i + 1)); [a[i], a[j]] = [a[j], a[i]]; } return a; }
function cardLabel(c) {
  const first = (c.fields && c.fields[0]) || '';
  const s = stripHtml(first).trim().replace(/\s+/g, ' ');
  return s.slice(0, 80) || c.modelName || String(c.ankiId || 'card');
}

async function startStudy(mode) {
  if (!currentDeckId) return;
  const cards = await getByIndex('cards', 'deck', currentDeckId);
  let queue;
  if (mode === 'work') {
    queue = cards.filter(c => c.rating != null && c.rating < 4);
    if (!queue.length) { toast('nothing flagged needs-work'); return; }
  } else {
    queue = cards.slice();
    if (!queue.length) { toast('no cards in this deck'); return; }
  }
  if (settings.shuffle) shuffle(queue);
  const cap = Math.max(0, parseInt(STUDY.sessionCap) || 0);
  if (cap > 0 && queue.length > cap) queue = queue.slice(0, cap);

  session.queue = queue; session.idx = 0; session.total = queue.length;
  session.current = null; session.shown = false;
  session.counts = { 1:0, 2:0, 3:0, 4:0 }; session.needsWork = [];

  const d = await get1('decks', currentDeckId);
  session.deckName = d ? d.name : 'deck';
  $id('study-deck-title').textContent = (d ? d.name : 'STUDY').toUpperCase();
  await loadMediaForDeck(currentDeckId);
  renderAnswerRow();
  go('study');
  nextCard();
}
function renderAnswerRow() {
  const row = $id('answer-row'); if (!row) return;
  row.innerHTML = ['again', 'hard', 'good', 'easy'].map((cls, i) =>
    `<button class="ans ${cls}" onclick="LEARN.answer(${i + 1})"><span class="ans-l">${esc(RATINGS[i])}</span></button>`).join('');
}
function refreshSessionStats() {
  $id('cnt-pos').textContent = Math.min(session.idx + 1, session.total);
  $id('cnt-total').textContent = session.total;
  $id('cnt-acq').textContent = session.counts[4];
  $id('cnt-acq-l').textContent = RATINGS[3];
  $id('cnt-work').textContent = session.counts[1] + session.counts[2] + session.counts[3];
}
/* Back-first swaps the two faces: the question is the back template with no
   FrontSide, and the reveal is the front. */
function faces(c) {
  const frontHtml = renderTemplate(c.front, c, false, '');
  if (STUDY.flip) return { ask:renderTemplate(c.back, c, true, ''), tell:frontHtml };
  return { ask:frontHtml, tell:renderTemplate(c.back, c, true, frontHtml) };
}
function showFace(html, c) {
  const tags = STUDY.showTags && c.tags ? `<div class="card-tags">${esc(c.tags)}</div>` : '';
  $id('card-face').innerHTML = `<div>${rewriteMedia(html)}${tags}</div>`;
}
function nextCard() {
  if (session.idx >= session.queue.length) { sessionDone(); return; }
  session.current = session.queue[session.idx];
  session.shown = false;
  showFace(faces(session.current).ask, session.current);
  $id('reveal-btn').classList.remove('hidden');
  $id('answer-row').classList.add('hidden');
  refreshSessionStats();
}
function reveal() {
  const c = session.current; if (!c) return;
  showFace(faces(c).tell, c);
  $id('reveal-btn').classList.add('hidden');
  $id('answer-row').classList.remove('hidden');
  session.shown = true;
}
async function answer(rating) {
  if (!session.shown) return;
  const c = session.current; if (!c) return;
  c.rating = rating; c.ratedAt = Date.now();
  session.counts[rating] = (session.counts[rating] || 0) + 1;
  if (rating < 4) session.needsWork.push({ label:cardLabel(c), rating });
  recordRating(rating, session.deckName);
  try { await put('cards', c); } catch {}
  session.idx++;
  Prefs.tap();
  nextCard();
}

/* ── Daily tally, for LOG's note ──────────────────────────────────────────────
   The cards are in IndexedDB and LOG builds its note synchronously, so each
   rating also bumps a small per-day record in localStorage: how many cards were
   rated, how many reached the top rating, and which decks. Sixty days are
   kept. */
const DAILY_KEY = 'learn_daily_v1';
function readDaily() {
  try { const d = JSON.parse(localStorage.getItem(DAILY_KEY) || '{}'); return d && typeof d === 'object' ? d : {}; }
  catch { return {}; }
}
function recordRating(rating, deckName) {
  const all = readDaily(), today = Shell.today();
  const day = all[today] || { rated:0, acquired:0, decks:{} };
  day.rated++;
  if (rating === 4) day.acquired++;
  const dn = String(deckName || 'deck');
  day.decks[dn] = (day.decks[dn] || 0) + 1;
  all[today] = day;
  Object.keys(all).sort().slice(0, -60).forEach(k => delete all[k]);
  try { localStorage.setItem(DAILY_KEY, JSON.stringify(all)); } catch {}
}
function dailyStats(iso) {
  const d = readDaily()[iso];
  return d ? { rated:d.rated || 0, acquired:d.acquired || 0, decks:d.decks || {} } : { rated:0, acquired:0, decks:{} };
}
function skipCard() {
  if (session.idx >= session.queue.length) return;
  const c = session.queue.splice(session.idx, 1)[0];
  session.queue.push(c);
  nextCard();
}
function exitStudy() { freeMediaCache(); go('home'); }

function sessionDone() {
  freeMediaCache();
  $id('sc-acq').textContent = session.counts[4];
  $id('sc-alm').textContent = session.counts[3];
  $id('sc-shk').textContent = session.counts[2];
  $id('sc-rev').textContent = session.counts[1];
  $id('sc-acq-l').textContent = RATINGS[3]; $id('sc-alm-l').textContent = RATINGS[2];
  $id('sc-shk-l').textContent = RATINGS[1]; $id('sc-rev-l').textContent = RATINGS[0];

  const totalRated = session.counts[1] + session.counts[2] + session.counts[3] + session.counts[4];
  $id('done-msg').textContent = totalRated
    ? `You rated ${totalRated} card${totalRated === 1 ? '' : 's'} this session.`
    : 'No cards rated this session.';

  const sec = $id('needs-work-section'), list = $id('needs-work-list');
  if (session.needsWork.length) {
    sec.classList.remove('hidden');
    const order = session.needsWork.slice().sort((a, b) => a.rating - b.rating);
    list.innerHTML = order.map(item => {
      const tagCls = item.rating === 1 ? 'rev' : item.rating === 2 ? 'shk' : 'alm';
      return `<div class="nw-item"><div class="nw-text">${esc(item.label)}</div><span class="nw-tag ${tagCls}">${esc(RATINGS[item.rating - 1])}</span></div>`;
    }).join('');
  } else { sec.classList.add('hidden'); list.innerHTML = ''; }

  $id('btn-study-work-again').disabled = session.needsWork.length === 0;
  go('done');
}

/* ── Bulk data actions (Settings → learn) ──────────────────────────────────── */
async function resetAllProgress() {
  if (!await Shell.confirm('Clear all ratings for ALL decks?')) return;
  try {
    const all = await getAll('cards');
    for (const c of all) { c.rating = null; c.ratedAt = null; }
    await bulkPut('cards', all);
    toast('ratings cleared');
  } catch (e) { toast(e.message || 'could not reach the decks'); }
  go('home'); renderSettings();
}
async function wipeAll() {
  if (!await Shell.confirm('Delete ALL decks and progress? This cannot be undone.')) return;
  try {
    const decks = await getAll('decks');
    for (const d of decks) {
      await delByIndex('cards', 'deck', d.id);
      try { await del1('sources', d.id); } catch {}
      await del1('decks', d.id);
    }
    const media = await getAll('media');
    for (const m of media) await del1('media', m.key);
    toast('all decks deleted');
  } catch (e) { toast(e.message || 'could not reach the decks'); }
  currentDeckId = null;
  go('home'); renderSettings();
}

/* How much is in IndexedDB — shown in the panel and in the storage report,
   because the ROOT backup file cannot carry it. */
async function deckStats() {
  try {
    const decks = await getAll('decks');
    const cards = await getAll('cards');
    const media = await getAll('media');
    const bytes = media.reduce((a, m) => a + (m.blob && m.blob.size || 0), 0);
    return { ok:true, decks:decks.length, cards:cards.length, media:media.length, bytes,
             acquired:cards.filter(c => c.rating === 4).length };
  } catch (e) { return { ok:false, error:e.message || 'IndexedDB unavailable', decks:0, cards:0, media:0, bytes:0, acquired:0 }; }
}

/* ── Settings panel ────────────────────────────────────────────────────────── */
function renderSettings() {
  const sh = $id('set-shuffle');
  if (sh) { sh.classList.toggle('on', !!settings.shuffle); sh.setAttribute('aria-checked', String(!!settings.shuffle)); }
  $all('[data-cfg="learn.study"]').forEach(i => { if (document.activeElement !== i) i.value = STUDY[i.dataset.sub]; });
  const sv = $id('learn-scale-val'); if (sv) sv.textContent = Math.round(STUDY.cardScale * 100) + '%';
  $all('[data-cfg-toggle^="learn.study."]').forEach(b => {
    const on = !!STUDY[b.dataset.cfgToggle.split('.').pop()];
    b.classList.toggle('on', on); b.setAttribute('aria-checked', String(on));
  });
  const st = $id('learn-stats');
  if (st) deckStats().then(s => {
    st.innerHTML = s.ok
      ? `<div class="data-stat"><span class="data-stat-k">Decks</span><span class="data-stat-v">${s.decks}</span></div>
         <div class="data-stat"><span class="data-stat-k">Cards</span><span class="data-stat-v">${s.cards} · ${s.acquired} ${esc(RATINGS[3])}</span></div>
         <div class="data-stat"><span class="data-stat-k">Media</span><span class="data-stat-v">${s.media} files · ${(s.bytes / 1048576).toFixed(1)} MB</span></div>`
      : `<div class="data-stat"><span class="data-stat-k">Decks</span><span class="data-stat-v">${esc(s.error)}</span></div>`;
  });
}
function toggleShuffle() {
  settings.shuffle = !settings.shuffle;
  saveSettings(); renderSettings(); Prefs.tap();
}

/* ── Wiring ────────────────────────────────────────────────────────────────── */
const fileInput = $id('file-input');
if (fileInput) fileInput.addEventListener('change', e => { const f = e.target.files[0]; if (f) handleFile(f); e.target.value = ''; });
const iz = $id('import-zone');
if (iz) {
  ['dragenter', 'dragover'].forEach(ev => iz.addEventListener(ev, e => { e.preventDefault(); iz.classList.add('over'); }));
  ['dragleave', 'drop'].forEach(ev => iz.addEventListener(ev, e => { e.preventDefault(); iz.classList.remove('over'); }));
  iz.addEventListener('drop', e => { const f = e.dataTransfer.files[0]; if (f) handleFile(f); });
}
// the card-size slider's readout follows the thumb; the settings view commits the value
document.addEventListener('input', e => {
  const el = e.target;
  if (el.dataset && el.dataset.cfg === 'learn.study' && el.dataset.sub === 'cardScale') {
    const sv = $id('learn-scale-val'); if (sv) sv.textContent = Math.round(parseFloat(el.value) * 100) + '%';
  }
});

/* ── Boot ──────────────────────────────────────────────────────────────────── */
loadSettings();
renderAnswerRow();
renderHome();

Config.subscribe(path => {
  if (path !== '*' && !String(path).startsWith('learn.')) return;
  readConfig(); renderAnswerRow(); renderSettings();
  if ($id('s-home').classList.contains('on')) renderHome();
});

Shell.register('learn', {
  onShow: () => { if ($id('s-home').classList.contains('on')) renderHome(); },
  // the LEARN tab tapped while on LEARN: a study session is left properly
  home: () => { if ($id('s-study').classList.contains('on')) exitStudy(); else go('home'); },
  search: q => deckList().filter(d => String(d.name || '').toLowerCase().includes(q))
    .map(d => ({ title: d.name, sub:'anki deck',
                 go: () => { Shell.TABS.includes('learn') ? Shell.go('learn') : Shell.open('learn'); goDeck(d.id); } })),
});

return { go, goDeck, backToDeck, startStudy, reveal, answer, skipCard, exitStudy,
         resetDeckProgress, renameDeck, deleteCurrentDeck, resetAllProgress, wipeAll,
         renderSettings, toggleShuffle, deckStats, handleFile, dailyStats, recordRating, deckList };
})();
