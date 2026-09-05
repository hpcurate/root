/* ── CREATE ───────────────────────────────────────────────────────────────────
   The songs being made, and what was done to them.

   The shape of the app, in one sentence: a song sits on a stage, a stage asks
   a checklist of it, and every hour at the desk is written down. Three screens
   — the shelf, one song, the session log — and no network at all. CREATE never
   talks to Todoist: a song is not a task, it is not due, and a backlog of them
   is the normal state of things rather than something to clear.

   What is Config's and what is this file's:
     · the stages, their colours and their checklists are Config (`create.*`),
       so the path a song walks is editable from Settings → create
     · the songs, their ticks, their notes and every session are in `create_v1`
   A stage's `key` is the identity a song's stage and every one of its ticks is
   filed under. A tick is filed under `stageKey|item text`, so reordering a
   checklist keeps every tick and rewording a line drops that one line's — the
   trade written up in ROOT.md §6.

   Markup is in two places (the slide and the settings panel), so every button
   carries `data-act` and one document-level listener filtered on
   `.closest('.ns-create')` dispatches — TEND's pattern, and for TEND's reason:
   a song's name interpolated into an inline handler is one more thing to get
   wrong. */
window.CREATE = (function () {
'use strict';

const SCOPE = '.ns-create ';
const $id   = id  => document.querySelector(SCOPE + '#' + id);
const toast = msg => Shell.toast(msg);
/* Quotes included: everything here is interpolated into attributes as well as
   into text, and a song called 5" is a name someone will type. */
const esc   = s => String(s == null ? '' : s).replace(/[&<>"']/g, c =>
  ({ '&':'&amp;', '<':'&lt;', '>':'&gt;', '"':'&quot;', "'":'&#39;' }[c]));

const KEY = 'create_v1';

/* ── Content ───────────────────────────────────────────────────────────────── */
let STAGES, NEWT, HOME, KINDS;
function readConfig() {
  STAGES = (Config.get('create.stages') || []).map(st => Object.assign({}, st, {
    key: String(st.key), label: String(st.label == null ? st.key : st.label),
    items: Array.isArray(st.items) ? st.items.slice() : [],
  }));
  if (!STAGES.length) STAGES = [{ key:'idea', label:'idea', color:'#7a8699', items:[], terminal:true }];
  if (!STAGES.some(st => st.terminal)) STAGES[STAGES.length - 1].terminal = true;
  NEWT  = Object.assign({ stage:STAGES[0].key, bpm:'', key:'', tags:'' }, Config.get('create.newTrack') || {});
  HOME  = Object.assign({ sort:'touched', sessionCount:6, weekDays:7 }, Config.get('create.home') || {});
  KINDS = (Config.get('create.sessionKinds') || []).filter(Boolean);
}
readConfig();

const stageAt   = i => STAGES[Math.max(0, Math.min(STAGES.length - 1, i))];
const stageIx   = k => { const i = STAGES.findIndex(s => s.key === k); return i < 0 ? 0 : i; };
/* A stage a song sits on that the editor has since deleted falls back to the
   first one, the way TEND falls back for a plant whose type has gone. The
   song's own `stage` is left alone: the stage may come back. */
const stageOf   = s => STAGES[stageIx(s && s.stage)];
const isDone    = s => !!stageOf(s).terminal;
const tickKey   = (k, item) => k + '|' + item;
const colorOf   = st => (st && st.color) || '#7a8699';

/* ── State ─────────────────────────────────────────────────────────────────── */
const blank = () => ({ v:1, songs:[], sessions:[], settings:{ sort:null, showDone:false } });
let DB = blank();
let uid = 0;
const newId = p => p + '_' + Date.now().toString(36) + '_' + (uid++).toString(36);

function normalise(raw) {
  const db = Object.assign(blank(), raw || {});
  db.songs = (Array.isArray(db.songs) ? db.songs : []).map(s => ({
    id:    String(s.id || newId('sg')),
    name:  String(s.name || 'untitled'),
    stage: String(s.stage || NEWT.stage),
    bpm:   String(s.bpm == null ? '' : s.bpm),
    key:   String(s.key == null ? '' : s.key),
    tags:  String(s.tags == null ? '' : s.tags),
    notes: String(s.notes == null ? '' : s.notes),
    added: s.added || Shell.today(),
    touched: s.touched || s.added || Shell.today(),
    done:  (s.done && typeof s.done === 'object') ? s.done : {},
  }));
  db.sessions = (Array.isArray(db.sessions) ? db.sessions : []).map(e => ({
    id:   String(e.id || newId('se')),
    song: e.song ? String(e.song) : null,
    date: e.date || Shell.today(),
    hours: Math.max(0, +e.hours || 0),
    what: String(e.what == null ? '' : e.what),
  })).sort((a, b) => (a.date < b.date ? 1 : a.date > b.date ? -1 : 0));
  db.settings = Object.assign({ sort:null, showDone:false }, db.settings || {});
  return db;
}
function load() {
  let raw = null;
  try { raw = JSON.parse(localStorage.getItem(KEY) || 'null'); } catch { raw = null; }
  DB = normalise(raw);
}
function save() { try { localStorage.setItem(KEY, JSON.stringify(DB)); } catch {} }

const songById = id => DB.songs.find(s => s.id === id) || null;
function touch(song) { song.touched = Shell.today(); }

/* ── Dates ─────────────────────────────────────────────────────────────────── */
const D = s => { const p = String(s).split('-').map(Number); return new Date(p[0], p[1] - 1, p[2], 12, 0, 0); };
const isISO = s => /^\d{4}-\d{2}-\d{2}$/.test(String(s || ''));
const daysAgo = iso => isISO(iso) ? Math.round((D(Shell.today()) - D(iso)) / 864e5) : null;
const fmtDay = iso => isISO(iso) ? D(iso).toLocaleDateString('en-GB', { day:'numeric', month:'short' }) : '';
function ago(iso) {
  const n = daysAgo(iso);
  if (n === null) return '';
  return n <= 0 ? 'today' : n === 1 ? 'yesterday' : n < 14 ? n + ' days ago' :
         n < 60 ? Math.round(n / 7) + ' weeks ago' : fmtDay(iso);
}
/* 1.5 reads as 1h30. A session is written in hours because the numpad's
   duration kind hands back hours — see ROOT.md §6 on `data-pad`. */
function hrs(h) {
  const n = Math.max(0, +h || 0);
  const whole = Math.floor(n), m = Math.round((n - whole) * 60);
  return m ? whole + 'h' + String(m).padStart(2, '0') : whole + 'h';
}

/* ── Progress ──────────────────────────────────────────────────────────────── */
function progress(song) {
  const st = stageOf(song);
  const items = st.items || [];
  const done = items.filter(i => song.done[tickKey(st.key, i)]).length;
  return { done, total: items.length, stage: st };
}

/* ── Sessions ──────────────────────────────────────────────────────────────── */
const sessionsFor = id => DB.sessions.filter(e => e.song === id);
function weekWindow() {
  const days = Math.max(1, +HOME.weekDays || 7);
  const from = new Date(D(Shell.today()).getTime() - (days - 1) * 864e5);
  const pad = n => String(n).padStart(2, '0');
  return from.getFullYear() + '-' + pad(from.getMonth() + 1) + '-' + pad(from.getDate());
}
function weekStats() {
  const from = weekWindow();
  const rows = DB.sessions.filter(e => e.date >= from);
  return { n: rows.length,
           hours: rows.reduce((a, b) => a + b.hours, 0),
           songs: new Set(rows.map(e => e.song).filter(Boolean)).size };
}

/* ── Screens ───────────────────────────────────────────────────────────────── */
let screen = 'home';
let openId = null;
/* The log form's own state, kept here rather than in the DOM so a tick or a
   Config edit can re-render the song's screen underneath it without emptying
   the field someone is halfway through. PLAN's form does the same. */
let form = { hours:'', what:'' };

function go(name) {
  screen = name;
  const view = document.getElementById('view-create');
  if (view) view.querySelectorAll('.scr').forEach(s => s.classList.toggle('on', s.id === 's-' + name));
  const body = document.querySelector('#view-create .view-body');
  if (body) body.scrollTop = 0;
  if (window.Shell && Shell.showChrome) Shell.showChrome();
  render();
}

function render() {
  if (screen === 'song' && !songById(openId)) { screen = 'home'; openId = null; go('home'); return; }
  if (screen === 'home') renderHome();
  if (screen === 'song') renderSong();
  if (screen === 'sessions') renderSessions();
}

/* ── The shelf ─────────────────────────────────────────────────────────────── */
const sortMode = () => DB.settings.sort || HOME.sort || 'touched';
function inFlight() { return DB.songs.filter(s => !isDone(s)); }
function released() { return DB.songs.filter(isDone)
  .sort((a, b) => (a.touched < b.touched ? 1 : a.touched > b.touched ? -1 : 0)); }

function sortSongs(rows) {
  const m = sortMode();
  const by = {
    touched: (a, b) => (a.touched < b.touched ? 1 : a.touched > b.touched ? -1 : 0) || (a.name > b.name ? 1 : -1),
    stage:   (a, b) => stageIx(a.stage) - stageIx(b.stage) || (a.name > b.name ? 1 : -1),
    name:    (a, b) => (a.name.toLowerCase() > b.name.toLowerCase() ? 1 : -1),
  };
  return rows.slice().sort(by[m] || by.touched);
}

function renderHome() {
  const flight = inFlight(), done = released();

  const hero = $id('cr-hero');
  if (hero) hero.innerHTML =
    `<div class="n">${flight.length}<span class="of">/${DB.songs.length}</span></div>
     <div class="k">${flight.length === 1 ? 'song in flight' : 'songs in flight'}</div>`;

  /* The strip is one segment per stage that has something on it, as wide as
     the count. Built from Config, so it has no fixed number of parts — see
     ROOT.md §6 on anything built from Config having no fixed width. */
  const counts = STAGES.map(st => ({ st, n: DB.songs.filter(s => stageOf(s).key === st.key).length }));
  const live = counts.filter(c => c.n > 0);
  const bar = $id('cr-stages');
  if (bar) bar.innerHTML = live.length
    ? `<div class="cr-bar">${live.map(c =>
         `<i style="flex:${c.n};--st-c:${esc(colorOf(c.st))}"></i>`).join('')}</div>
       <div class="cr-keys">${live.map(c =>
         `<span class="cr-key"><i style="--st-c:${esc(colorOf(c.st))}"></i>${esc(c.st.label)} <b>${c.n}</b></span>`).join('')}</div>`
    : '';

  const cnt = $id('cr-count');
  if (cnt) cnt.textContent = flight.length ? sortMode().replace('touched', 'last worked on') : '';

  const sorts = $id('cr-sorts');
  if (sorts) sorts.innerHTML = flight.length ? [
    ['touched', 'recent'], ['stage', 'stage'], ['name', 'name'],
  ].map(([k, lb]) => `<button class="cr-sort${sortMode() === k ? ' on' : ''}" data-act="sort" data-s="${k}">${lb}</button>`).join('') : '';

  const list = $id('cr-list');
  if (list) list.innerHTML = flight.length
    ? sortSongs(flight).map(songRow).join('')
    : `<div class="cr-empty">Nothing on the shelf yet.<br>A song starts as an idea and a name.</div>`;

  const rel = $id('cr-released');
  if (rel) rel.innerHTML = done.length ? `
    <button class="cr-fold" data-act="fold">
      <span>Released</span><b>${done.length} · ${DB.settings.showDone ? 'hide' : 'show'}</b>
    </button>
    ${DB.settings.showDone ? done.map(s => `
      <button class="cr-done" data-act="open" data-id="${esc(s.id)}">
        <span class="nm">${esc(s.name)}</span><span class="dt">${esc(fmtDay(s.touched))}</span>
      </button>`).join('') : ''}` : '';

  const w = weekStats();
  const wk = $id('cr-week');
  if (wk) wk.innerHTML = `
    <div class="cr-sec"><span>Last ${Math.max(1, +HOME.weekDays || 7)} days</span>
      <em>${DB.sessions.length ? DB.sessions.length + ' sessions logged' : ''}</em></div>
    <div class="cr-stats">
      <div class="cr-stat card"><div class="v acc">${hrs(w.hours)}</div><div class="k">at the desk</div></div>
      <div class="cr-stat card"><div class="v">${w.n}</div><div class="k">sessions</div></div>
      <div class="cr-stat card"><div class="v">${w.songs}</div><div class="k">songs touched</div></div>
    </div>
    <button class="cr-act" data-act="open-sessions">the whole session log →</button>`;
}

function songRow(s) {
  const p = progress(s);
  const c = colorOf(p.stage);
  const meta = [s.bpm ? s.bpm + ' bpm' : '', s.key, s.tags].filter(Boolean).join(' · ');
  return `<button class="cr-song" data-act="open" data-id="${esc(s.id)}" style="--st-c:${esc(c)}">
    <div class="t"><span class="nm">${esc(s.name)}</span><span class="st">${esc(p.stage.label)}</span></div>
    <div class="mt">${meta ? esc(meta) + ' <s>·</s> ' : ''}<s>${esc(ago(s.touched))}</s></div>
    ${p.total ? `<div class="cr-prog">
      <span class="rail"><i style="width:${Math.round(p.done / p.total * 100)}%"></i></span>
      <span class="v">${p.done} / ${p.total}</span></div>` : ''}
  </button>`;
}

/* ── One song ──────────────────────────────────────────────────────────────── */
function renderSong() {
  const s = songById(openId); if (!s) return;
  const st = stageOf(s), c = colorOf(st);
  const title = $id('cr-song-title');
  if (title) title.textContent = s.name;

  const box = $id('cr-song'); if (!box) return;
  const items = st.items || [];
  const chip = (act, label, value, unit) => value
    ? `<button class="cr-mchip" data-act="${act}"><b>${esc(value)}</b>${unit ? ' ' + unit : ''}</button>`
    : `<button class="cr-mchip empty" data-act="${act}">+ ${label}</button>`;

  box.innerHTML = `
    <div class="cr-head" style="--st-c:${esc(c)}">
      <div class="cr-meta">
        ${chip('edit-name', 'name', s.name, '')}
        ${chip('edit-bpm', 'tempo', s.bpm, 'bpm')}
        ${chip('edit-key', 'key', s.key, '')}
        ${chip('edit-tags', 'tags', s.tags, '')}
      </div>
    </div>

    <div class="cr-sec"><span>Stage</span><em>${esc(ago(s.touched))}</em></div>
    <div class="cr-steps">${STAGES.map((x, i) => `
      <button class="cr-step${x.key === st.key ? ' on' : ''}${i < stageIx(s.stage) ? ' past' : ''}"
              data-act="stage" data-k="${esc(x.key)}" style="--st-c:${esc(colorOf(x))}">${esc(x.label)}</button>`).join('')}</div>

    <div class="cr-sec"><span>${esc(st.label)}</span><em>${items.length ? progress(s).done + ' / ' + items.length : ''}</em></div>
    <div class="cr-check" style="--st-c:${esc(c)}">
      ${items.length ? items.map(i => {
        const on = !!s.done[tickKey(st.key, i)];
        return `<button class="cr-item${on ? ' on' : ''}" data-act="tick" data-i="${esc(i)}">
          <span class="bx"></span><span class="lb">${esc(i)}</span></button>`;
      }).join('') : `<div class="cr-check-done">${st.terminal
        ? 'Released. Nothing more is asked of it.'
        : 'This stage has no checklist. Settings → create gives it one.'}</div>`}
    </div>

    <div class="cr-sec"><span>Notes</span><em>saved as you type</em></div>
    <textarea class="cr-notes" id="cr-note" data-act="note" spellcheck="false"
              placeholder="what it needs, what it is missing, what the reference does that this does not"
              aria-label="notes">${esc(s.notes)}</textarea>

    <div class="cr-sec"><span>Log a session</span><em>hours then minutes — 130 is 1h30</em></div>
    <div class="cr-form">
      <div class="cr-row">
        <input type="text" class="dur" id="cr-hours" data-pad="duration" inputmode="numeric"
               value="${esc(form.hours)}" placeholder="1h30" aria-label="how long">
        <input type="text" id="cr-what" data-pad="off" value="${esc(form.what)}"
               placeholder="what you did" aria-label="what you did">
      </div>
      ${KINDS.length ? `<div class="cr-kinds">${KINDS.map(k =>
        `<button class="cr-kind" data-act="kind" data-k="${esc(k)}">${esc(k)}</button>`).join('')}</div>` : ''}
      <button class="cr-go" data-act="log">log it</button>
    </div>

    ${(() => {
      const rows = sessionsFor(s.id).slice(0, Math.max(1, +HOME.sessionCount || 6));
      const total = sessionsFor(s.id).reduce((a, b) => a + b.hours, 0);
      return rows.length ? `
        <div class="cr-sec"><span>Sessions</span><em>${hrs(total)} on this song</em></div>
        ${rows.map(sesRow).join('')}` : '';
    })()}

    <div class="cr-acts">
      <button class="cr-act" data-act="edit-name">rename</button>
      <button class="cr-act danger" data-act="delete">delete this song</button>
    </div>`;
}

const sesRow = (e, withSong) => `<div class="cr-ses">
  <span class="l">${esc(e.what || 'session')}
    <s>${esc(fmtDay(e.date))}${withSong ? ' · ' + esc((songById(e.song) || { name:'—' }).name) : ''}</s></span>
  <span class="r">${hrs(e.hours)}</span>
  <button class="x" data-act="del-session" data-e="${esc(e.id)}" aria-label="remove session">×</button>
</div>`;

/* ── The session log ───────────────────────────────────────────────────────── */
function renderSessions() {
  const box = $id('cr-sessions'); if (!box) return;
  if (!DB.sessions.length) {
    box.innerHTML = `<div class="cr-empty">No sessions yet.<br>Open a song and log the first one.</div>`;
    return;
  }
  const w = weekStats();
  const total = DB.sessions.reduce((a, b) => a + b.hours, 0);
  const days = [...new Set(DB.sessions.map(e => e.date))];
  box.innerHTML = `
    <div class="cr-stats">
      <div class="cr-stat card"><div class="v acc">${hrs(w.hours)}</div><div class="k">last ${Math.max(1, +HOME.weekDays || 7)} days</div></div>
      <div class="cr-stat card"><div class="v">${hrs(total)}</div><div class="k">all time</div></div>
      <div class="cr-stat card"><div class="v">${DB.sessions.length}</div><div class="k">sessions</div></div>
    </div>
    ${days.map(d => `<div class="cr-day">${esc(fmtDay(d))} · ${esc(ago(d))}</div>
      ${DB.sessions.filter(e => e.date === d).map(e => sesRow(e, true)).join('')}`).join('')}`;
}

/* ── Doing things ──────────────────────────────────────────────────────────── */
function addSong() {
  Shell.prompt('Name the song\nIt can be a working title — it is renamed from its own screen.', '', name => {
    const nm = String(name || '').trim();
    if (!nm) return;
    const s = {
      id: newId('sg'), name: nm, stage: NEWT.stage,
      bpm: String(NEWT.bpm || ''), key: String(NEWT.key || ''), tags: String(NEWT.tags || ''),
      notes: '', added: Shell.today(), touched: Shell.today(), done: {},
    };
    DB.songs.push(s); save();
    openId = s.id; form = { hours:'', what:'' };
    go('song');
    toast('“' + nm + '” started');
  });
}

function editField(field, label, value) {
  const s = songById(openId); if (!s) return;
  Shell.prompt(label, value, v => {
    const next = String(v == null ? '' : v).trim();
    if (field === 'name' && !next) return;          // a song with no name cannot be found again
    s[field] = next;
    touch(s); save(); render();
  });
}

function setStage(key) {
  const s = songById(openId); if (!s) return;
  if (s.stage === key) return;
  s.stage = key; touch(s); save(); render();
  toast(s.name + ' → ' + stageOf(s).label);
}

function tick(item) {
  const s = songById(openId); if (!s) return;
  const k = tickKey(stageOf(s).key, item);
  if (s.done[k]) delete s.done[k]; else s.done[k] = Shell.today();
  touch(s); save(); renderSong();
}

function logSession() {
  const s = songById(openId); if (!s) return;
  const h = Math.max(0, parseFloat(String(form.hours).replace(',', '.')) || 0);
  if (!h) { toast('how long was it?'); return; }
  DB.sessions.unshift({ id: newId('se'), song: s.id, date: Shell.today(), hours: h,
                        what: String(form.what || '').trim() });
  form = { hours:'', what:'' };
  touch(s); save(); renderSong();
  toast(hrs(h) + ' on ' + s.name);
}

function delSession(id) {
  const e = DB.sessions.find(x => x.id === id); if (!e) return;
  DB.sessions = DB.sessions.filter(x => x.id !== id);
  save(); render();
  toast('session removed');
}

function deleteSong() {
  const s = songById(openId); if (!s) return;
  const n = sessionsFor(s.id).length;
  Shell.confirm('Delete “' + s.name + '”?\n' + (n ? 'Its ' + n + ' session' + (n === 1 ? '' : 's') +
    ' go with it. ' : '') + 'This cannot be undone.', () => {
    DB.songs = DB.songs.filter(x => x.id !== s.id);
    DB.sessions = DB.sessions.filter(e => e.song !== s.id);
    save(); openId = null; go('home');
    toast('“' + s.name + '” deleted');
  });
}

/* ── The delegated listener ────────────────────────────────────────────────── */
document.addEventListener('click', ev => {
  if (!ev.target.closest || !ev.target.closest('.ns-create')) return;
  const t = ev.target.closest('[data-act]');
  const act = t && t.dataset.act;
  if (!act) return;

  if (act === 'home')          { go('home'); return; }
  if (act === 'open')          { openId = t.dataset.id; form = { hours:'', what:'' }; go('song'); return; }
  if (act === 'open-sessions') { go('sessions'); return; }
  if (act === 'add')           { addSong(); return; }
  if (act === 'sort')          { DB.settings.sort = t.dataset.s; save(); renderHome(); return; }
  if (act === 'fold')          { DB.settings.showDone = !DB.settings.showDone; save(); renderHome(); return; }
  if (act === 'stage')         { setStage(t.dataset.k); return; }
  if (act === 'tick')          { tick(t.dataset.i); return; }
  if (act === 'log')           { logSession(); return; }
  if (act === 'del-session')   { delSession(t.dataset.e); return; }
  if (act === 'delete')        { deleteSong(); return; }
  if (act === 'kind') {
    /* A chip fills the field rather than replacing what is in it, so "mixing"
       and then a word of your own is two taps and a sentence. */
    const el = $id('cr-what');
    const cur = String(form.what || '').trim();
    form.what = cur ? cur + ' · ' + t.dataset.k : t.dataset.k;
    if (el) el.value = form.what;
    return;
  }
  const s = songById(openId);
  if (act === 'edit-name') { editField('name', 'Name', s ? s.name : ''); return; }
  if (act === 'edit-bpm')  { editField('bpm',  'Tempo\nIn bpm. Blank if it is not decided.', s ? s.bpm : ''); return; }
  if (act === 'edit-key')  { editField('key',  'Key\nHowever you write it — F#m, 6A, whatever the DAW says.', s ? s.key : ''); return; }
  if (act === 'edit-tags') { editField('tags', 'Tags\nA word or two: the project, the label, the set it is for.', s ? s.tags : ''); return; }

  if (act === 'export')      { exportData(); return; }
  if (act === 'pick-import') { const f = $id('cr-file'); if (f) f.click(); return; }
  if (act === 'reset')       { resetAll(); return; }
});

/* Typing never re-renders: the notes and the two log fields hold the caret. */
let noteT = null;
document.addEventListener('input', ev => {
  const el = ev.target;
  if (!el.closest || !el.closest('.ns-create')) return;
  if (el.id === 'cr-hours') { form.hours = el.value; return; }
  if (el.id === 'cr-what')  { form.what  = el.value; return; }
  if (el.id === 'cr-note') {
    const s = songById(openId); if (!s) return;
    s.notes = el.value;
    clearTimeout(noteT);
    noteT = setTimeout(() => { touch(s); save(); }, 400);
  }
});
document.addEventListener('change', ev => {
  const el = ev.target;
  if (!el.closest || !el.closest('.ns-create')) return;
  if (el.id === 'cr-file') importData(ev);
});

/* ── Settings ──────────────────────────────────────────────────────────────── */
function renderSettings() {
  /* The panel's three fields are declared in index.html and written by
     settings.js's data-cfg listener; what is filled in here is what they
     currently say, since the markup is static and Config is not. */
  const sort = document.querySelector('.ns-create #cr-set-sort');
  if (sort) sort.value = HOME.sort || 'touched';
  const ses = document.querySelector('.ns-create #cr-set-sessions');
  if (ses) ses.value = Math.max(1, +HOME.sessionCount || 6);
  const wk = document.querySelector('.ns-create #cr-set-week');
  if (wk) wk.value = Math.max(1, +HOME.weekDays || 7);

  const st = document.querySelector('.ns-create #cr-status');
  if (st) {
    const n = DB.songs.length, h = DB.sessions.reduce((a, b) => a + b.hours, 0);
    st.className = 'settings-status ' + (n ? 'ok' : 'idle');
    st.textContent = n
      ? n + (n === 1 ? ' song' : ' songs') + ' · ' + DB.sessions.length + ' sessions · ' + hrs(h) + ' logged'
      : 'nothing on the shelf yet';
  }
}

function exportData() {
  const blob = new Blob([JSON.stringify(DB, null, 2)], { type:'application/json' });
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = 'create-' + Shell.today() + '.json';
  a.click();
  setTimeout(() => URL.revokeObjectURL(a.href), 1000);
  toast('exported');
}

function importData(ev) {
  const file = ev.target.files && ev.target.files[0];
  ev.target.value = '';
  if (!file) return;
  const r = new FileReader();
  r.onload = () => {
    let raw = null;
    try { raw = JSON.parse(r.result); } catch { toast('that file is not CREATE data'); return; }
    if (!raw || !Array.isArray(raw.songs)) { toast('that file is not CREATE data'); return; }
    /* Not a merge. Two shelves interleaved by id is a guess about which copy of
       a song is the real one, and there is no answer to that question here. */
    Shell.ask({
      title: 'Replace the shelf?',
      body: 'The file holds ' + raw.songs.length + ' song' + (raw.songs.length === 1 ? '' : 's') +
            '. Importing replaces everything CREATE currently holds.',
      yes: 'replace', no: 'cancel', danger: true,
      done: ok => {
        if (!ok) return;
        DB = normalise(raw); save(); openId = null; go('home'); renderSettings();
        toast('imported ' + DB.songs.length + ' songs');
      },
    });
  };
  r.readAsText(file);
}

function resetAll() {
  Shell.confirm('Reset CREATE?\nEvery song, every tick, every note and the whole session log go. The stages themselves are settings and stay.', () => {
    DB = blank(); save(); openId = null; go('home'); renderSettings();
    toast('CREATE reset');
  });
}

/* ── Boot ──────────────────────────────────────────────────────────────────── */
load();
render();

Config.subscribe(path => {
  if (path !== '*' && !String(path).startsWith('create.')) return;
  readConfig(); render(); renderSettings();
});

Shell.register('create', {
  onShow: render,
  /* The week's numbers and every "3 days ago" move at midnight. */
  onDayChange: render,
  home: () => go('home'),
  /* The songs are in create_v1, not in Config, so search asks for them here.
     Tags match too: "for the set" is how a song gets looked for. */
  search: q => DB.songs
    .filter(s => [s.name, s.tags, s.key].some(v => String(v || '').toLowerCase().includes(q)))
    .map(s => ({ title: s.name, sub: 'song · ' + stageOf(s).label + (s.tags ? ' · ' + s.tags : ''),
                 go: () => { Shell.TABS.includes('create') ? Shell.go('create') : Shell.open('create');
                             openId = s.id; go('song'); } })),
});

return { render, renderSettings, go, addSong, exportData, importData, resetAll,
         songs: () => DB.songs.slice(), sessions: () => DB.sessions.slice(),
         progress, stages: () => STAGES.slice(), open: id => { openId = id; go('song'); } };
})();
