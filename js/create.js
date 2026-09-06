/* ── CREATE ───────────────────────────────────────────────────────────────────
   The work being made, and what was done to it.

   The shape of the app, in one sentence: a piece of work sits on a stage, the
   stage asks a checklist of it, and every hour at the desk is written down.
   Three screens — the shelf, one work, the session log — and no network at
   all. CREATE never talks to Todoist: a song is not a task, it is not due, and
   a shelf of unfinished things is the normal state of the room rather than a
   backlog to clear.

   ── Areas ───────────────────────────────────────────────────────────────────
   4.0 is the version that made there be more than one kind of work in here.
   **production** is the songs being made; **mixing** is the DJ sets being
   built. They are not two apps: the machine is identical — a thing on a stage,
   a checklist, hours in the log — and only the vocabulary differs. So an area
   is a block in `create.areas`: its name, its colour, the noun for one of its
   things, the stages it walks and the words its sessions are called. A third
   area needs no code and no CSS.

   Nothing in this file is written for two areas. Everything walks `AREAS`, and
   the home screen is a combined view with the areas as its filter — which is
   the whole reason the shelf can hold both without becoming two shelves.

   What is Config's and what is this file's:
     · the areas, their stages, their checklists and their session words are
       Config (`create.areas`), so the path a work walks is editable in
       Settings → create
     · the works, their ticks, their notes and every session are in `create_v1`
   A stage's `key` is the identity a work's stage and every one of its ticks is
   filed under, and it only has to be unique inside its own area — a tick is
   filed under `areaKey|stageKey|item text`, so both areas may have a stage
   called `idea`. Reordering a checklist keeps every tick and rewording a line
   drops that one line's — the trade written up in ROOT.md §6.

   Markup is in two places (the slide and the settings panel), so every button
   carries `data-act` and one document-level listener filtered on
   `.closest('.ns-create')` dispatches — TEND's pattern, and for TEND's reason:
   a work's name interpolated into an inline handler is one more thing to get
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
let AREAS, HOME, CURATE;
/* The three meta chips a work can carry. An area names which of them it asks
   for — a song has a key, a DJ set does not — and an unnamed field is simply
   not asked: what is already stored is kept and comes back if it is switched
   back on. `log.fields` has worked that way since 2.0 and this is the same
   rule for the same reason. */
const FIELDS = [
  { k:'bpm',  label:'tempo', unit:'bpm', prompt:'Tempo\nIn bpm. Blank if it is not decided.' },
  { k:'key',  label:'key',   unit:'',    prompt:'Key\nHowever you write it — F#m, 6A, whatever the DAW says.' },
  { k:'tags', label:'tags',  unit:'',    prompt:'Tags\nA word or two: the project, the label, the set it is for.' },
];
const FIELD_KEYS = FIELDS.map(f => f.k);
function readConfig() {
  AREAS = (Config.get('create.areas') || []).map(a => {
    const stages = (Array.isArray(a.stages) ? a.stages : []).map(st => Object.assign({}, st, {
      key: String(st.key), label: String(st.label == null ? st.key : st.label),
      items: Array.isArray(st.items) ? st.items.slice() : [],
    }));
    if (!stages.length) stages.push({ key:'idea', label:'idea', color:'#7a8699', items:[], terminal:true });
    if (!stages.some(st => st.terminal)) stages[stages.length - 1].terminal = true;
    return {
      key: String(a.key), label: String(a.label == null ? a.key : a.label),
      noun: String(a.noun || 'thing'), plural: String(a.plural || (a.noun ? a.noun + 's' : 'things')),
      color: a.color || '#7a8699',
      kinds: (Array.isArray(a.kinds) ? a.kinds : []).filter(Boolean),
      /* An area with no `fields` at all is one written before 4.1 (or by hand),
         and it gets all three — the shape it had. */
      fields: Array.isArray(a.fields) ? a.fields.map(String).filter(f => FIELD_KEYS.includes(f))
                                      : FIELD_KEYS.slice(),
      newItem: Object.assign({ stage: stages[0].key, bpm:'', key:'', tags:'' }, a.newItem || {}),
      stages,
    };
  });
  /* An area list edited down to nothing would be a shelf with nowhere to put
     anything, which is not a state the app can draw. One is the floor. */
  if (!AREAS.length) AREAS = [{ key:'work', label:'work', noun:'thing', plural:'things', color:'#7a8699',
    kinds:[], fields:FIELD_KEYS.slice(), newItem:{ stage:'idea', bpm:'', key:'', tags:'' },
    stages:[{ key:'idea', label:'idea', color:'#7a8699', items:[], terminal:true }] }];
  HOME = Object.assign({ sort:'touched', sessionCount:6, weekDays:7 }, Config.get('create.home') || {});
  /* **Merged through the shipped defaults, not read raw.** An override is
     stored whole-branch (ROOT.md §3), so an install that overrode this branch
     while it was `{ label, maxAgeMin }` — which is the shape 4.1.0 shipped for
     one version — shadows the whole thing, and `project` reads as undefined:
     no chip on the strip, a blank field in Settings, and, if the shelf was left
     on the curate tab, a screen with nothing on it. Reading a fixed set of keys
     through the defaults is the same merge `log.meds`, `log.medsOn` and
     `plan.formFields` use, and it is safe for the same reason: no key here can
     be deleted, so a missing one always means "not answered" rather than "gone".

     The stale `label` is not carried over. A label is not a project — there is
     nothing in the old value that answers the new question — so the honest lift
     is back to what ROOT ships with, which is also what the field then shows. */
  CURATE = Object.assign({ project:'', maxAgeMin:60 },
                         Config.defaults('create.curate') || {},
                         Config.get('create.curate') || {});
  CURATE.project = String(CURATE.project || '').trim();
  /* The merge above is what distinguishes the two blanks, and they are not the
     same thing: a key that is *absent* takes the shipped value (a stale
     override, or one written before the key existed), while a key that is
     present and empty is a choice — "blank switches the tab off" — and wins.
     Falling back on emptiness rather than on absence would have taken that
     choice away. */
  delete CURATE.label;
}
readConfig();

/* An area a work sits in that the editor has since deleted falls back to the
   first one, the way a stage does and the way TEND falls back for a plant
   whose type has gone. The work's own `area` is left alone: it may come back. */
const areaIx  = k => { const i = AREAS.findIndex(a => a.key === k); return i < 0 ? 0 : i; };
const areaOf  = w => AREAS[areaIx(w && w.area)];
const stageIx = (area, k) => { const i = area.stages.findIndex(s => s.key === k); return i < 0 ? 0 : i; };
const stageOf = w => { const a = areaOf(w); return a.stages[stageIx(a, w && w.stage)]; };
const isDone  = w => !!stageOf(w).terminal;
const tickKey = (areaKey, stageKey, item) => areaKey + '|' + stageKey + '|' + item;
const colorOf = st => (st && st.color) || '#7a8699';

/* ── State ─────────────────────────────────────────────────────────────────── */
/* `curate` is a *cache*, not data: what the last read of Todoist returned, so
   the tab draws instantly and refetches in the background. Nothing in it is
   ever authored here and losing it costs one network call. */
const blank = () => ({ v:2, works:[], sessions:[], curate:{ fetched:0, project:'', color:'#7a8699', groups:[] },
                       settings:{ sort:null, showDone:false, area:'all' } });
let DB = blank();
let uid = 0;
const newId = p => p + '_' + Date.now().toString(36) + '_' + (uid++).toString(36);

/* ── Reading what is stored ────────────────────────────────────────────────
   A v1 record is a shelf of `songs`, every one of them a production song, and
   its ticks are filed under `stageKey|item` because there was only ever one
   area to file them under. Both are lifted here rather than left to a repair
   flag: the shape is read on every boot anyway, and a migration that runs in
   the reader cannot be skipped by an install that never opens the settings.
   The originals are not kept — `works` is `songs` with one field added, and a
   tick key gains one segment. Nothing is thrown away. */
function normalise(raw) {
  const src = raw || {};
  const db  = Object.assign(blank(), src);
  const first = AREAS[0].key;
  /* Read off `raw`, never off the merged object: `blank()` supplies an empty
     `works`, so asking the merge whether it has one always says yes and a v1
     shelf would be read as an empty v2 one — which is to say, thrown away. */
  const rows = Array.isArray(src.works) ? src.works
             : Array.isArray(src.songs) ? src.songs : [];

  db.works = rows.map(s => {
    const area = String(s.area || first);
    const done = {};
    Object.keys((s.done && typeof s.done === 'object') ? s.done : {}).forEach(k => {
      /* Two segments is a v1 key: it names a stage and an item and assumes the
         area. Three is already ours. */
      done[k.split('|').length < 3 ? area + '|' + k : k] = s.done[k];
    });
    return {
      id:    String(s.id || newId('wk')),
      area,
      name:  String(s.name || 'untitled'),
      stage: String(s.stage || ''),
      bpm:   String(s.bpm == null ? '' : s.bpm),
      key:   String(s.key == null ? '' : s.key),
      tags:  String(s.tags == null ? '' : s.tags),
      notes: String(s.notes == null ? '' : s.notes),
      added: s.added || Shell.today(),
      touched: s.touched || s.added || Shell.today(),
      done,
    };
  });
  delete db.songs;

  db.sessions = (Array.isArray(db.sessions) ? db.sessions : []).map(e => {
    const work = e.work ? String(e.work) : (e.song ? String(e.song) : null);
    const owner = work ? db.works.find(w => w.id === work) : null;
    return {
      id:   String(e.id || newId('se')),
      work,
      /* Denormalised so the log can be filtered and totalled without walking
         the shelf for every row. It follows the work when there is one. */
      area: String(owner ? owner.area : (e.area || first)),
      date: e.date || Shell.today(),
      hours: Math.max(0, +e.hours || 0),
      what: String(e.what == null ? '' : e.what),
    };
  }).sort((a, b) => (a.date < b.date ? 1 : a.date > b.date ? -1 : 0));

  db.settings = Object.assign({ sort:null, showDone:false, area:'all' }, db.settings || {});
  /* ── The curate cache is rebuilt from its known keys, never trusted ────────
     It is the only thing in this record that did not come from the app itself,
     and it is the only thing whose *row shape* has changed between versions —
     4.1 cached label-query rows with no `subs`, 4.1.1 caches project rows that
     have them. A half-written or stale cache must cost a refetch, not a throw.

     It cost a throw. 4.1.1 read `t.subs.length` off a cached 4.1 row, which
     threw inside the module's own IIFE at boot — so `window.CREATE` was never
     assigned and the whole app was gone: an empty slide, and a settings panel
     whose fields are filled by `CREATE.renderSettings()` and so stayed blank.
     One undefined array in a disposable cache took out an entire tab.

     So every field is read through a default and every array is proved to be
     one. Anything the shape does not account for is dropped, and the next visit
     fetches it again — which costs one network call and cannot fail. */
  const cur = (db.curate && typeof db.curate === 'object') ? db.curate : {};
  const curRow = t => ({
    id:       String((t && t.id) || ''),
    content:  String((t && t.content) || ''),
    tags:     Array.isArray(t && t.tags) ? t.tags.map(String) : [],
    priority: +(t && t.priority) || 1,
    due:      (t && t.due) ? String(t.due) : null,
    o:        +(t && t.o) || 0,
    subs:     Array.isArray(t && t.subs) ? t.subs.map(curRow) : [],
  });
  db.curate = {
    fetched: +cur.fetched || 0,
    project: String(cur.project || ''),
    color:   String(cur.color || '#7a8699'),
    groups: (Array.isArray(cur.groups) ? cur.groups : [])
      .filter(g => g && Array.isArray(g.tasks))
      .map(g => ({
        key:     String(g.key || ''),
        section: String(g.section || ''),
        o:       +g.o || 0,
        tasks:   g.tasks.map(curRow),
      })),
  };
  db.v = 2;
  return db;
}
function load() {
  let raw = null;
  try { raw = JSON.parse(localStorage.getItem(KEY) || 'null'); } catch { raw = null; }
  const lifted = !!raw && !Array.isArray(raw.works) && Array.isArray(raw.songs);
  DB = normalise(raw);
  /* Written back the moment it is lifted, rather than left to the next edit.
     Reading is idempotent, so nothing breaks either way — but a shelf nobody
     has touched since the upgrade would sit on disk in the old shape for as
     long as it went untouched, and "when did this actually migrate" is not a
     question worth being able to ask. */
  if (lifted) save();
}
function save() { try { localStorage.setItem(KEY, JSON.stringify(DB)); } catch {} }

const workById = id => DB.works.find(w => w.id === id) || null;
function touch(work) { work.touched = Shell.today(); }

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
function progress(work) {
  const a = areaOf(work), st = stageOf(work);
  const items = st.items || [];
  const done = items.filter(i => work.done[tickKey(a.key, st.key, i)]).length;
  return { done, total: items.length, stage: st, area: a };
}

/* ── Sessions ──────────────────────────────────────────────────────────────── */
const sessionsFor = id => DB.sessions.filter(e => e.work === id);
function weekWindow() {
  const days = Math.max(1, +HOME.weekDays || 7);
  const from = new Date(D(Shell.today()).getTime() - (days - 1) * 864e5);
  const pad = n => String(n).padStart(2, '0');
  return from.getFullYear() + '-' + pad(from.getMonth() + 1) + '-' + pad(from.getDate());
}
/* The hours behind a set of days, split by area and naming what was worked on.
   LOG's note and its two reports are the callers; the shape is theirs to read
   and nothing here is stored on their behalf. */
function rangeStats(days) {
  const want = new Set(days);
  const rows = DB.sessions.filter(e => want.has(e.date));
  if (!rows.length) return null;
  const byArea = AREAS.map(a => ({
    key: a.key, label: a.label,
    hours: rows.filter(e => e.area === a.key).reduce((x, y) => x + y.hours, 0),
  })).filter(r => r.hours > 0);
  const works = [];
  rows.forEach(e => {
    const w = workById(e.work);
    if (!w || works.some(x => x.id === w.id)) return;
    works.push({ id: w.id, name: w.name, area: areaOf(w).label, stage: stageOf(w).label });
  });
  return {
    hours: rows.reduce((x, y) => x + y.hours, 0),
    sessions: rows.length,
    areas: byArea,
    works,
    what: [...new Set(rows.map(e => e.what).filter(Boolean))],
  };
}
function weekStats(areaKey) {
  const from = weekWindow();
  const rows = DB.sessions.filter(e => e.date >= from && (!areaKey || e.area === areaKey));
  return { n: rows.length,
           hours: rows.reduce((a, b) => a + b.hours, 0),
           works: new Set(rows.map(e => e.work).filter(Boolean)).size };
}

/* ── Screens ───────────────────────────────────────────────────────────────── */
let screen = 'home';
let openId = null;
/* The log form's own state, kept here rather than in the DOM so a tick or a
   Config edit can re-render the work's screen underneath it without emptying
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
  if (screen === 'work' && !workById(openId)) { screen = 'home'; openId = null; go('home'); return; }
  /* The band belongs to the slide, not to the home screen — the shell lifts it
     out of #s-home at boot — so it is redrawn on every screen. Moving a work to
     its finished stage happens on the work screen and changes the number. */
  renderBand();
  if (screen === 'home') renderHome();
  if (screen === 'work') renderWork();
  if (screen === 'sessions') renderSessions();
}

/* ── The shelf ─────────────────────────────────────────────────────────────
   One shelf holding every area, with the areas as its filter. That is the
   whole argument for not making mixing its own tab: what is on the desk this
   week is one question, and it stops being answerable the moment the answer
   is split across two screens you have to remember to visit. Narrowing to one
   area is a tap; seeing the lot is the default. */
const sortMode = () => DB.settings.sort || HOME.sort || 'touched';
/* 'all', or an area key. An area the editor has deleted falls back to 'all'
   rather than to an empty shelf that looks like a bug. */
/* An area the editor has deleted falls back to 'all' rather than to an empty
   shelf that looks like a bug — and so does **curate** when there is no project
   set for it. That second half was missing until 4.1.2, and it is what turned a
   stale Config override into a blank screen: the chip had gone from the strip,
   the shelf stayed hidden because the filter still said `curate`, and there was
   nothing left on the page to tap. Anything that can be *selected* has to be
   able to stop existing. */
function areaSel() {
  const s = DB.settings.area || 'all';
  if (s === 'all') return 'all';
  if (s === 'curate') return CURATE.project ? 'curate' : 'all';
  return AREAS.some(a => a.key === s) ? s : 'all';
}
/* CURATE is not an area — nothing on it is a piece of work and none of the
   shelf's machinery applies to it — so it is asked about by name in the two
   places that care rather than being faked into AREAS. */
const onCurate = () => areaSel() === 'curate';
const inSel = w => areaSel() === 'all' || areaOf(w).key === areaSel();
const areasShown = () => areaSel() === 'all' ? AREAS : AREAS.filter(a => a.key === areaSel());
function inProgress() { return DB.works.filter(w => !isDone(w) && inSel(w)); }
function finished() { return DB.works.filter(w => isDone(w) && inSel(w))
  .sort((a, b) => (a.touched < b.touched ? 1 : a.touched > b.touched ? -1 : 0)); }

function sortWorks(rows) {
  const m = sortMode();
  const by = {
    touched: (a, b) => (a.touched < b.touched ? 1 : a.touched > b.touched ? -1 : 0) || (a.name > b.name ? 1 : -1),
    stage:   (a, b) => areaIx(a.area) - areaIx(b.area) ||
                       stageIx(areaOf(a), a.stage) - stageIx(areaOf(b), b.stage) || (a.name > b.name ? 1 : -1),
    name:    (a, b) => (a.name.toLowerCase() > b.name.toLowerCase() ? 1 : -1),
  };
  return rows.slice().sort(by[m] || by.touched);
}

/* ── The tab strip ────────────────────────────────────────────────────────
   DO's DAILY / MEDIA / OTHER selector, in CREATE: one bordered rail, flat
   chips inside it, and a glider that slides under the selected one. The shape
   lives in create.css and is a deliberate copy of `.ns-do .tabs` — ROOT.md §6
   names the pair, because two copies of one shape is two things to keep in
   step.

   `all`, then one chip per area, then **curate** — which is not an area at
   all: it is the Todoist label read as a list. It sits at the end because it
   is a different kind of thing, and it sits in this strip because it answers
   the same question the shelf does. */
/* "02 | curate" is a filing name — the number and the pipe are how it sorts in
   Todoist's sidebar, and neither is worth a chip's width here. The chip wears
   what is after the last pipe. */
const curateChip = () => String(CURATE.project || '').split('|').pop().trim() || CURATE.project;
function tabList() {
  return [{ key:'all', label:'all' }]
    .concat(AREAS.map(a => ({ key:a.key, label:a.label })))
    .concat(CURATE.project ? [{ key:'curate', label:curateChip() }] : []);
}
/* The markup of one strip. Both screens use it — the shelf's filter and the
   session log's — so the two cannot end up as two different controls doing the
   same job, which is what they were until 4.1. */
const stripHTML = (items, sel, act) =>
  `<div class="cr-tglide"></div>` + items.map(t =>
    `<button class="cr-tab${t.key === sel ? ' active' : ''}" data-act="${act}" data-a="${esc(t.key)}"
             >${esc(t.label)}</button>`).join('');

/* **The strip is rebuilt only when the strip changes.** 4.1 redrew the whole
   rail on every selection, which meant the glider was a brand-new element at
   its final position every time and had nothing to transition *from* — so the
   thing whose entire job is to slide did not slide. It moves the class and
   asks the glider to travel now, and the markup is only rewritten when the
   chips themselves are different (an area renamed, added or deleted in
   Settings). DO's `setTab` has always worked this way; this is the same fix,
   arrived at from the other side. */
const stripSig = items => items.map(t => t.key + ':' + t.label).join('|');
function renderTabs() {
  const bar = $id('cr-areas');
  if (!bar) return;
  const items = tabList(), sel = areaSel(), sig = stripSig(items);
  if (bar.dataset.sig !== sig) {
    bar.dataset.sig = sig;
    bar.innerHTML = stripHTML(items, sel, 'area');
  } else {
    bar.querySelectorAll('.cr-tab').forEach(b => b.classList.toggle('active', b.dataset.a === sel));
  }
  // a single chip is not a choice — the same rule DO's strip follows
  bar.classList.toggle('hidden', items.length < 2);
  positionGlider(bar);
}
/* jsdom has no layout, so every offset here is 0 and the glider simply sits at
   the left edge — which is why this can never be the thing that decides what
   is selected. That is the class on the chip. */
function positionGlider(bar) {
  if (!bar) return;
  const active = bar.querySelector('.cr-tab.active');
  const glider = bar.querySelector('.cr-tglide');
  if (!active || !glider) return;
  glider.style.width = active.offsetWidth + 'px';
  glider.style.transform = `translateX(${active.offsetLeft}px)`;
  /* Enough chips and the rail scrolls, so the selected one can be off its
     edge. The rail's own scrollLeft is nudged rather than scrollIntoView(),
     which would also scroll the slide — DO's revealTab(), same reasoning. */
  if (bar.scrollWidth <= bar.clientWidth) return;
  const left = active.offsetLeft, right = left + active.offsetWidth;
  if (left < bar.scrollLeft) bar.scrollLeft = left;
  else if (right > bar.scrollLeft + bar.clientWidth) bar.scrollLeft = right - bar.clientWidth;
}

function renderHome() {
  const sel = areaSel();
  renderTabs();

  /* CURATE takes the whole screen under the strip: it is a list of somebody
     else's records, not a shelf, and none of the shelf's furniture — the
     count, the stage strips, the sort chips, the add buttons, the week —
     means anything about it. */
  const shelf = ['cr-stages','cr-sec-live','cr-sorts','cr-list','cr-add','cr-released','cr-week'];
  shelf.forEach(id => { const el = $id(id); if (el) el.classList.toggle('hidden', onCurate()); });
  const curBox = $id('cr-curate');
  if (curBox) curBox.classList.toggle('hidden', !onCurate());
  if (onCurate()) { renderCurate(); return; }

  const live = inProgress(), done = finished();

  /* One strip per area in view, each a segment per stage that has something on
     it, as wide as the count. On "all" that is both areas one under the other,
     which is the combined view doing the thing it exists to do: two shapes,
     side by side, in one glance. */
  const bar = $id('cr-stages');
  if (bar) bar.innerHTML = areasShown().map(a => {
    const counts = a.stages.map(st => ({ st, n: DB.works.filter(w => areaOf(w).key === a.key && stageOf(w).key === st.key).length }));
    const on = counts.filter(c => c.n > 0);
    if (!on.length) return '';
    const total = on.reduce((s, c) => s + c.n, 0);
    return `<div class="cr-abar" style="--ar-c:${esc(a.color)}">
      ${AREAS.length > 1 ? `<div class="cr-alab"><i></i>${esc(a.label)}<b>${total}</b></div>` : ''}
      <div class="cr-bar">${on.map(c =>
        `<i style="flex:${c.n};--st-c:${esc(colorOf(c.st))}"></i>`).join('')}</div>
      <div class="cr-keys">${on.map(c =>
        `<span class="cr-key"><i style="--st-c:${esc(colorOf(c.st))}"></i>${esc(c.st.label)} <b>${c.n}</b></span>`).join('')}</div>
    </div>`;
  }).join('');

  const cnt = $id('cr-count');
  if (cnt) cnt.textContent = live.length ? sortMode().replace('touched', 'last worked on') : '';

  const sorts = $id('cr-sorts');
  if (sorts) sorts.innerHTML = live.length ? [
    ['touched', 'recent'], ['stage', 'stage'], ['name', 'name'],
  ].map(([k, lb]) => `<button class="cr-sort${sortMode() === k ? ' on' : ''}" data-act="sort" data-s="${k}">${lb}</button>`).join('') : '';

  const list = $id('cr-list');
  if (list) list.innerHTML = live.length
    ? sortWorks(live).map(workRow).join('')
    : `<div class="cr-empty">${sel === 'all'
        ? 'Nothing on the shelf yet.<br>It starts as an idea and a name.'
        : 'Nothing in ' + esc(AREAS[areaIx(sel)].label) + ' yet.'}</div>`;

  /* One button per area in view: on "all" that is one for each, so starting a
     mix is never a thing you have to switch screens to do. */
  const add = $id('cr-add');
  if (add) add.innerHTML = areasShown().map(a =>
    `<button class="cr-add" data-act="add" data-a="${esc(a.key)}" style="--ar-c:${esc(a.color)}">+ new ${esc(a.noun)}</button>`).join('');

  const rel = $id('cr-released');
  if (rel) rel.innerHTML = done.length ? `
    <button class="cr-fold" data-act="fold">
      <span>Finished</span><b>${done.length} · ${DB.settings.showDone ? 'hide' : 'show'}</b>
    </button>
    ${DB.settings.showDone ? done.map(w => `
      <button class="cr-done" data-act="open" data-id="${esc(w.id)}">
        <span class="nm">${esc(w.name)}</span><span class="dt">${esc(fmtDay(w.touched))}</span>
      </button>`).join('') : ''}` : '';

  const days = Math.max(1, +HOME.weekDays || 7);
  const w = weekStats(sel === 'all' ? null : sel);
  /* The split is only worth drawing when there is more than one area to split
     between, and only for the hours — three numbers per area is a table, and a
     table is not what a glance at the week wants to be. */
  const split = sel === 'all' && AREAS.length > 1
    ? AREAS.map(a => ({ a, h: weekStats(a.key).hours })).filter(r => r.h > 0) : [];
  const most = split.reduce((m, r) => Math.max(m, r.h), 0);
  const wk = $id('cr-week');
  if (wk) wk.innerHTML = `
    <div class="cr-sec"><span>Last ${days} days</span>
      <em>${DB.sessions.length ? DB.sessions.length + ' sessions logged' : ''}</em></div>
    <div class="cr-stats">
      <div class="cr-stat card"><div class="v acc">${hrs(w.hours)}</div><div class="k">at the desk</div></div>
      <div class="cr-stat card"><div class="v">${w.n}</div><div class="k">sessions</div></div>
      <div class="cr-stat card"><div class="v">${w.works}</div><div class="k">touched</div></div>
    </div>
    ${split.length ? `<div class="cr-split">${split.map(r => `
      <div class="cr-srow" style="--ar-c:${esc(r.a.color)}">
        <span class="l">${esc(r.a.label)}</span>
        <span class="rail"><i style="width:${Math.round(r.h / most * 100)}%"></i></span>
        <span class="r">${hrs(r.h)}</span>
      </div>`).join('')}</div>` : ''}
    <button class="cr-act" data-act="open-sessions">the whole session log →</button>`;
}

/* ── The band ──────────────────────────────────────────────────────────────
   One number, at the right end of the wordmark's row, in the box LOG's and
   DAY's day numbers live in — and it shuffles the same way, through
   `Shell.rollNum`. The label above the wordmark says what it is counting.

   It was a 74px hero under the band until 4.1.1: most of a phone screen spent
   on one digit, on the screen whose job is to list what is on the shelf. The
   total it also carried is not lost — the "Finished" fold below says how many
   are done, which is the same subtraction. */
function renderBand() {
  const sel = areaSel();
  const box = $id('cr-daynum'), lab = $id('cr-label');
  const n = onCurate() ? curateCount() : inProgress().length;
  if (lab) lab.textContent = onCurate()
    ? (DB.curate.project || CURATE.project || 'curate')
    : (sel === 'all' ? 'in progress' : AREAS[areaIx(sel)].label + ' · in progress');
  /* The count is its own sort key: more than last time rolls one way, fewer
     rolls the other, which is the same agreement between gesture and animation
     the date arrows have. */
  if (box && window.Shell && Shell.rollNum) Shell.rollNum(box, String(n), n);
}

/* One tick per checklist item, filled for done — how far along and out of how
   many, in one shape and with no number beside it. Past LONG_LIST the segments
   would be thinner than the gaps between them, so it falls back to a rail:
   a checklist that long is a fraction again. */
const LONG_LIST = 16;
function progHTML(done, total) {
  if (total > LONG_LIST) {
    return `<div class="cr-prog long" style="--pct:${Math.round(done / total * 100)}%"
                 role="img" aria-label="${done} of ${total} done"></div>`;
  }
  return `<div class="cr-prog${done === total ? ' full' : ''}" role="img" aria-label="${done} of ${total} done">${
    Array.from({ length: total }, (_, i) => `<i${i < done ? ' class="on"' : ''}></i>`).join('')}</div>`;
}

function workRow(w) {
  const p = progress(w);
  const c = colorOf(p.stage);
  const meta = [AREAS.length > 1 ? p.area.label : '', w.bpm ? w.bpm + ' bpm' : '', w.key, w.tags]
    .filter(Boolean).join(' · ');
  return `<button class="cr-work" data-act="open" data-id="${esc(w.id)}"
                  style="--st-c:${esc(c)};--ar-c:${esc(p.area.color)}">
    <div class="t"><span class="nm">${AREAS.length > 1 ? '<i class="ar"></i>' : ''}${esc(w.name)}</span><span class="st">${esc(p.stage.label)}</span></div>
    <div class="mt">${meta ? esc(meta) + ' <s>·</s> ' : ''}<s>${esc(ago(w.touched))}</s></div>
    ${p.total ? progHTML(p.done, p.total) : ''}
  </button>`;
}

/* ── CURATE — the one thing in here that reaches the network ──────────────────
   A whole Todoist **project**, drawn under the sections it is arranged into, in
   the order it is arranged in: section order, then each task's own order inside
   its section, with subtasks nested under the task they belong to. That is what
   "sorted nicely" means — the order you put them in over there, not an order
   invented here.

   **It reads and never writes.** CREATE does not close, move, reschedule or
   create a task: closing a curate task is DO's job and filing one is PLAN's,
   and a third app with an opinion about the same list is how two of them end
   up disagreeing. So there is nothing here that a bad network can lose.

   The shelf has no network at all. This is the exception, kept to one function
   and one cache: that project is the pile of records to find, subscriptions to
   renew and tutorials to watch that a song or a set is *made out of*, which is
   the same question the shelf answers, kept somewhere else.

   The cache is `DB.curate`, drawn immediately on every visit and refreshed
   behind it when it is older than `maxAgeMin`. A first visit with nothing
   cached shows the empty state and the spinner together, which is the honest
   thing for a screen whose content lives on someone else's server. */
let curateBusy = false, curateErr = '';

const curateTasks = () => (DB.curate.groups || []).flatMap(g => g.tasks || []);
const curateCount = () => (DB.curate.groups || [])
  .reduce((n, g) => n + (g.tasks || []).reduce((m, t) => m + 1 + (t.subs || []).length, 0), 0);
const curateAge   = () => Date.now() - (DB.curate.fetched || 0);
const curateStale = () => curateAge() > Math.max(1, +CURATE.maxAgeMin || 60) * 60000;

/* Todoist's v1 collections carry an order under one of two names depending on
   which half of the old API a field came from; both are read, and the name is
   the tie-break so an unordered collection is at least stable. */
const ord = (o, k) => { const v = o && (o[k] != null ? o[k] : o['child_order']); return v == null ? 1e9 : +v; };

async function fetchCurate() {
  if (curateBusy || !CURATE.project) return;
  if (!Creds.token()) { curateErr = 'no Todoist key saved — add one under settings → data'; renderCurate(); return; }
  curateBusy = true; curateErr = ''; renderCurate();
  try {
    /* The project is resolved by folded name, the way PLAN resolves every
       project it sends to — so "02 | curate" and "02curate" are the same one
       and a rename that only moves the punctuation does not break the tab. */
    const projects = await Todoist.getAll('/projects');
    const proj = projects.find(p => Todoist.name(p.name) === Todoist.name(CURATE.project));
    if (!proj) throw new Error('no project called “' + CURATE.project + '” — settings → create');
    const pid = String(proj.id);
    const [tasks, sections] = await Promise.all([
      Todoist.getAll('/tasks', { project_id: pid }),
      Todoist.getAll('/sections', { project_id: pid }),
    ]);

    const secOrder = {};
    sections.forEach(sc => { secOrder[String(sc.id)] = { name: String(sc.name), o: ord(sc, 'section_order') }; });
    const color = Todoist.COLORS[proj.color] || '#7a8699';

    /* Subtasks are their own tasks in the same project, so they arrive in the
       same answer and are simply filed under their parent instead of beside
       it. A subtask whose parent is closed (or lives in another project) has
       nowhere to nest, so it is drawn as a task of its own rather than
       dropped — the alternative is a row that silently is not there. */
    const rows = tasks.map(t => ({
      id: String(t.id),
      content: String(t.content || ''),
      section: t.section_id == null ? '' : String(t.section_id),
      parent: t.parent_id == null ? '' : String(t.parent_id),
      tags: (t.labels || []).map(String),
      priority: +t.priority || 1,
      due: Todoist.due(t),
      o: ord(t, 'order'),
      subs: [],
    }));
    const byId = {};
    rows.forEach(r => { byId[r.id] = r; });
    const top = rows.filter(r => {
      if (r.parent && byId[r.parent]) { byId[r.parent].subs.push(r); return false; }
      return true;
    });
    rows.forEach(r => r.subs.sort((a, b) => a.o - b.o || a.content.localeCompare(b.content)));

    /* One group per section that has something in it, plus the project's own
       unsectioned tasks — which sort first, because that is where Todoist puts
       them. A section with nothing open in it is not drawn: an empty heading
       is a row of furniture saying "nothing here". */
    const groups = new Map();
    top.forEach(r => {
      const sc = secOrder[r.section];
      if (!groups.has(r.section)) groups.set(r.section, {
        key: r.section || '_none',
        section: sc ? sc.name : '',
        o: sc ? sc.o : -1,
        tasks: [],
      });
      groups.get(r.section).tasks.push(r);
    });
    const out = [...groups.values()].sort((a, b) =>
      a.o - b.o || (a.section > b.section ? 1 : a.section < b.section ? -1 : 0));
    out.forEach(g => g.tasks.sort((a, b) => a.o - b.o || a.content.localeCompare(b.content)));

    DB.curate = { fetched: Date.now(), project: String(proj.name), color, groups: out };
    save();
  } catch (e) {
    curateErr = (e && e.message) || 'could not reach Todoist';
  } finally {
    curateBusy = false;
    renderCurate();
    if (onCurate()) renderBand();
  }
}

/* Older than the window, and on screen: refresh behind whatever is cached. */
function maybeFetchCurate() {
  if (!onCurate() || !CURATE.project) return;
  if (curateBusy || !curateStale()) return;
  fetchCurate();
}

const agoMin = ms => {
  const m = Math.round(ms / 60000);
  if (m < 1) return 'just now';
  if (m < 60) return m + ' min ago';
  const h = Math.round(m / 60);
  return h < 24 ? h + 'h ago' : Math.round(h / 24) + 'd ago';
};

function renderCurate() {
  const box = $id('cr-curate'); if (!box) return;
  const groups = DB.curate.groups || [];
  const head = `<div class="cr-sec"><span>${esc(DB.curate.project || CURATE.project)}</span>
    <em>${curateBusy ? 'reading todoist…'
        : DB.curate.fetched ? esc(agoMin(curateAge())) : ''}</em></div>
    <button class="cr-cref" data-act="curate-refresh"${curateBusy ? ' disabled' : ''}>${
      curateBusy ? 'refreshing…' : 'refresh'}</button>`;

  if (curateErr) {
    box.innerHTML = head + `<div class="cr-empty">${esc(curateErr)}</div>` +
      (groups.length ? curateGroups(groups) : '');
    return;
  }
  if (!groups.length) {
    box.innerHTML = head + `<div class="cr-empty">${curateBusy
      ? 'reading todoist…'
      : `Nothing open in ${esc(CURATE.project)}.<br>This tab reads Todoist and never writes to it.`}</div>`;
    return;
  }
  box.innerHTML = head +
    `<div class="cr-cnote">${curateCount()} open · read only — nothing here is ticked or closed from CREATE</div>` +
    curateGroups(groups);
}

/* A row is a record you are going to go and find, so the only thing it does is
   open the task in Todoist. Its labels sit under it because on a list this long
   they are the thing that tells two rows apart. */
const curateRow = (t, sub) => `<a class="cr-ctask${sub ? ' sub' : ''}"
    href="https://app.todoist.com/app/task/${esc(t.id)}" target="_blank" rel="noopener noreferrer">
  <span class="nm">${esc(t.content)}</span>
  ${(t.tags.length || t.due) ? `<span class="tg">${
    [t.due ? fmtDay(t.due) : '', ...t.tags].filter(Boolean).map(x => esc(x)).join(' · ')}</span>` : ''}
</a>`;

const curateGroups = groups => groups.map(g => `
  <div class="cr-cgroup" style="--pr-c:${esc(DB.curate.color || '#7a8699')}">
    <div class="cr-chead">
      <i></i><span class="sc${g.section ? '' : ' none'}">${esc(g.section || 'no section')}</span>
      <b>${g.tasks.reduce((n, t) => n + 1 + t.subs.length, 0)}</b>
    </div>
    ${g.tasks.map(t => curateRow(t, false) + t.subs.map(x => curateRow(x, true)).join('')).join('')}
  </div>`).join('');

/* ── One work ──────────────────────────────────────────────────────────────── */
function renderWork() {
  const w = workById(openId); if (!w) return;
  const a = areaOf(w), st = stageOf(w), c = colorOf(st);
  const title = $id('cr-work-title');
  if (title) title.textContent = w.name;

  const box = $id('cr-work'); if (!box) return;
  const items = st.items || [];
  const chip = (act, label, value, unit) => value
    ? `<button class="cr-mchip" data-act="${act}"><b>${esc(value)}</b>${unit ? ' ' + unit : ''}</button>`
    : `<button class="cr-mchip empty" data-act="${act}">+ ${label}</button>`;

  box.innerHTML = `
    <div class="cr-head" style="--st-c:${esc(c)};--ar-c:${esc(a.color)}">
      ${AREAS.length > 1 ? `<div class="cr-atag"><i></i>${esc(a.label)}</div>` : ''}
      <div class="cr-meta">
        ${chip('edit-name', 'name', w.name, '')}
        ${FIELDS.filter(f => a.fields.includes(f.k))
                .map(f => chip('edit-' + f.k, f.label, w[f.k], f.unit)).join('')}
      </div>
    </div>

    <div class="cr-sec"><span>Stage</span><em>${esc(ago(w.touched))}</em></div>
    <div class="cr-steps">${a.stages.map((x, i) => `
      <button class="cr-step${x.key === st.key ? ' on' : ''}${i < stageIx(a, w.stage) ? ' past' : ''}"
              data-act="stage" data-k="${esc(x.key)}" style="--st-c:${esc(colorOf(x))}">${esc(x.label)}</button>`).join('')}</div>

    <div class="cr-sec"><span>${esc(st.label)}</span><em>${items.length ? progress(w).done + ' / ' + items.length : ''}</em></div>
    <div class="cr-check" style="--st-c:${esc(c)}">
      ${items.length ? items.map(i => {
        const on = !!w.done[tickKey(a.key, st.key, i)];
        return `<button class="cr-item${on ? ' on' : ''}" data-act="tick" data-i="${esc(i)}">
          <span class="bx"></span><span class="lb">${esc(i)}</span></button>`;
      }).join('') : `<div class="cr-check-done">${st.terminal
        ? 'Finished. Nothing more is asked of it.'
        : 'This stage has no checklist. Settings → create gives it one.'}</div>`}
    </div>

    <div class="cr-sec"><span>Notes</span><em>saved as you type</em></div>
    <textarea class="cr-notes" id="cr-note" data-act="note" spellcheck="false"
              placeholder="what it needs, what it is missing, what the reference does that this does not"
              aria-label="notes">${esc(w.notes)}</textarea>

    <div class="cr-sec"><span>Log a session</span><em>hours then minutes — 130 is 1h30</em></div>
    <div class="cr-form">
      <div class="cr-row">
        <input type="text" class="dur" id="cr-hours" data-pad="duration" inputmode="numeric"
               value="${esc(form.hours)}" placeholder="1h30" aria-label="how long">
        <input type="text" id="cr-what" data-pad="off" value="${esc(form.what)}"
               placeholder="what you did" aria-label="what you did">
      </div>
      ${a.kinds.length ? `<div class="cr-kinds">${a.kinds.map(k =>
        `<button class="cr-kind" data-act="kind" data-k="${esc(k)}">${esc(k)}</button>`).join('')}</div>` : ''}
      <button class="cr-go" data-act="log">log it</button>
    </div>

    ${(() => {
      const rows = sessionsFor(w.id).slice(0, Math.max(1, +HOME.sessionCount || 6));
      const total = sessionsFor(w.id).reduce((x, y) => x + y.hours, 0);
      return rows.length ? `
        <div class="cr-sec"><span>Sessions</span><em>${hrs(total)} on this ${esc(a.noun)}</em></div>
        ${rows.map(e => sesRow(e)).join('')}` : '';
    })()}

    <div class="cr-acts">
      <button class="cr-act" data-act="edit-name">rename</button>
      <button class="cr-act danger" data-act="delete">delete this ${esc(a.noun)}</button>
    </div>`;
}

const sesRow = (e, withWork) => `<div class="cr-ses">
  <span class="l">${esc(e.what || 'session')}
    <s>${esc(fmtDay(e.date))}${withWork ? ' · ' + esc((workById(e.work) || { name:'—' }).name) : ''}</s></span>
  <span class="r">${hrs(e.hours)}</span>
  <button class="x" data-act="del-session" data-e="${esc(e.id)}" aria-label="remove session">×</button>
</div>`;

/* ── The session log ───────────────────────────────────────────────────────
   The same filter the shelf has, for the same reason: the hours are one
   number until you want to know which of the two things ate the week. */
let logArea = 'all';
function renderSessions() { renderSessionFilter(); renderSessionBody(); }

/* The strip lives outside the body it filters, and is rewritten only when the
   chips change — same reason as the shelf's: a rail rebuilt on every tap has a
   brand-new glider with nothing to travel from. */
function renderSessionFilter() {
  const bar = $id('cr-log-tabs'); if (!bar) return;
  if (logArea !== 'all' && !AREAS.some(a => a.key === logArea)) logArea = 'all';
  const show = AREAS.length > 1 && DB.sessions.length > 0;
  bar.classList.toggle('hidden', !show);
  if (!show) return;
  const items = [{ key:'all', label:'all' }].concat(AREAS.map(a => ({ key:a.key, label:a.label })));
  const sig = stripSig(items);
  if (bar.dataset.sig !== sig) {
    bar.dataset.sig = sig;
    bar.innerHTML = stripHTML(items, logArea, 'log-area');
  } else {
    bar.querySelectorAll('.cr-tab').forEach(b => b.classList.toggle('active', b.dataset.a === logArea));
  }
  positionGlider(bar);
}

function renderSessionBody() {
  const box = $id('cr-sessions'); if (!box) return;
  if (!DB.sessions.length) {
    box.innerHTML = `<div class="cr-empty">No sessions yet.<br>Open something and log the first one.</div>`;
    return;
  }
  if (logArea !== 'all' && !AREAS.some(a => a.key === logArea)) logArea = 'all';
  const rows  = DB.sessions.filter(e => logArea === 'all' || e.area === logArea);
  const w     = weekStats(logArea === 'all' ? null : logArea);
  const total = rows.reduce((a, b) => a + b.hours, 0);
  const days  = [...new Set(rows.map(e => e.date))];
  box.innerHTML = `
    <div class="cr-stats">
      <div class="cr-stat card"><div class="v acc">${hrs(w.hours)}</div><div class="k">last ${Math.max(1, +HOME.weekDays || 7)} days</div></div>
      <div class="cr-stat card"><div class="v">${hrs(total)}</div><div class="k">all time</div></div>
      <div class="cr-stat card"><div class="v">${rows.length}</div><div class="k">sessions</div></div>
    </div>
    ${days.length ? days.map(d => `<div class="cr-day">${esc(fmtDay(d))} · ${esc(ago(d))}</div>
      ${rows.filter(e => e.date === d).map(e => sesRow(e, true)).join('')}`).join('')
      : `<div class="cr-empty">Nothing logged in ${esc(AREAS[areaIx(logArea)].label)} yet.</div>`}`;
}

/* ── Doing things ──────────────────────────────────────────────────────────── */
function addWork(areaKey) {
  const a = AREAS[areaIx(areaKey)];
  Shell.prompt('Name the ' + a.noun + '\nIt can be a working title — it is renamed from its own screen.', '', name => {
    const nm = String(name || '').trim();
    if (!nm) return;
    const w = {
      id: newId('wk'), area: a.key, name: nm, stage: a.newItem.stage,
      bpm: String(a.newItem.bpm || ''), key: String(a.newItem.key || ''), tags: String(a.newItem.tags || ''),
      notes: '', added: Shell.today(), touched: Shell.today(), done: {},
    };
    DB.works.push(w); save();
    openId = w.id; form = { hours:'', what:'' };
    go('work');
    toast('“' + nm + '” started');
  });
}

function editField(field, label, value) {
  const w = workById(openId); if (!w) return;
  Shell.prompt(label, value, v => {
    const next = String(v == null ? '' : v).trim();
    if (field === 'name' && !next) return;          // a work with no name cannot be found again
    w[field] = next;
    touch(w); save(); render();
  });
}

function setStage(key) {
  const w = workById(openId); if (!w) return;
  if (w.stage === key) return;
  w.stage = key; touch(w); save(); render();
  toast(w.name + ' → ' + stageOf(w).label);
}

function tick(item) {
  const w = workById(openId); if (!w) return;
  const k = tickKey(areaOf(w).key, stageOf(w).key, item);
  if (w.done[k]) delete w.done[k]; else w.done[k] = Shell.today();
  touch(w); save(); renderWork();
}

function logSession() {
  const w = workById(openId); if (!w) return;
  const h = Math.max(0, parseFloat(String(form.hours).replace(',', '.')) || 0);
  if (!h) { toast('how long was it?'); return; }
  DB.sessions.unshift({ id: newId('se'), work: w.id, area: areaOf(w).key, date: Shell.today(),
                        hours: h, what: String(form.what || '').trim() });
  form = { hours:'', what:'' };
  touch(w); save(); renderWork();
  toast(hrs(h) + ' on ' + w.name);
}

function delSession(id) {
  const e = DB.sessions.find(x => x.id === id); if (!e) return;
  DB.sessions = DB.sessions.filter(x => x.id !== id);
  save(); render();
  toast('session removed');
}

function deleteWork() {
  const w = workById(openId); if (!w) return;
  const n = sessionsFor(w.id).length;
  Shell.confirm('Delete “' + w.name + '”?\n' + (n ? 'Its ' + n + ' session' + (n === 1 ? '' : 's') +
    ' go with it. ' : '') + 'This cannot be undone.', () => {
    DB.works = DB.works.filter(x => x.id !== w.id);
    DB.sessions = DB.sessions.filter(e => e.work !== w.id);
    save(); openId = null; go('home');
    toast('“' + w.name + '” deleted');
  });
}

/* ── The delegated listener ────────────────────────────────────────────────── */
document.addEventListener('click', ev => {
  if (!ev.target.closest || !ev.target.closest('.ns-create')) return;
  const t = ev.target.closest('[data-act]');
  const act = t && t.dataset.act;
  if (!act) return;

  if (act === 'home')          { go('home'); return; }
  if (act === 'open')          { openId = t.dataset.id; form = { hours:'', what:'' }; go('work'); return; }
  if (act === 'open-sessions') { go('sessions'); return; }
  if (act === 'add')           { addWork(t.dataset.a); return; }
  if (act === 'area')          { DB.settings.area = t.dataset.a; save(); renderHome(); maybeFetchCurate(); return; }
  if (act === 'curate-refresh'){ fetchCurate(); return; }
  if (act === 'log-area')      { logArea = t.dataset.a; renderSessionFilter(); renderSessionBody(); return; }
  if (act === 'sort')          { DB.settings.sort = t.dataset.s; save(); renderHome(); return; }
  if (act === 'fold')          { DB.settings.showDone = !DB.settings.showDone; save(); renderHome(); return; }
  if (act === 'stage')         { setStage(t.dataset.k); return; }
  if (act === 'tick')          { tick(t.dataset.i); return; }
  if (act === 'log')           { logSession(); return; }
  if (act === 'del-session')   { delSession(t.dataset.e); return; }
  if (act === 'delete')        { deleteWork(); return; }
  if (act === 'kind') {
    /* A chip fills the field rather than replacing what is in it, so "practice"
       and then a word of your own is two taps and a sentence. */
    const el = $id('cr-what');
    const cur = String(form.what || '').trim();
    form.what = cur ? cur + ' · ' + t.dataset.k : t.dataset.k;
    if (el) el.value = form.what;
    return;
  }
  const w = workById(openId);
  if (act === 'edit-name') { editField('name', 'Name', w ? w.name : ''); return; }
  /* One handler for the three optional chips, off the same table the chips are
     drawn from — so an area that does not ask for a field has no button *and*
     no way in, rather than a hidden button with a live handler behind it. */
  const fld = FIELDS.find(f => act === 'edit-' + f.k);
  if (fld) {
    if (w && !areaOf(w).fields.includes(fld.k)) return;
    editField(fld.k, fld.prompt, w ? w[fld.k] : '');
    return;
  }

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
    const w = workById(openId); if (!w) return;
    w.notes = el.value;
    clearTimeout(noteT);
    noteT = setTimeout(() => { touch(w); save(); }, 400);
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
  const lb = document.querySelector('.ns-create #cr-set-project');
  if (lb && document.activeElement !== lb) lb.value = CURATE.project;
  /* What it goes back to if it is emptied — visible in the field rather than
     only in the source, so "blank switches the tab off" is a choice you can see
     you are making. */
  if (lb) lb.placeholder = String((Config.defaults('create.curate') || {}).project || '');
  const ca = document.querySelector('.ns-create #cr-set-curate-age');
  if (ca) ca.value = Math.max(1, +CURATE.maxAgeMin || 60);

  const st = document.querySelector('.ns-create #cr-status');
  if (st) {
    const n = DB.works.length, h = DB.sessions.reduce((a, b) => a + b.hours, 0);
    /* Counted per area, in the area's own noun: "2 songs · 1 mix" says more
       about what is on the shelf than "3 things" ever could. */
    const per = AREAS.map(a => {
      const c = DB.works.filter(w => areaOf(w).key === a.key).length;
      return c ? c + ' ' + (c === 1 ? a.noun : a.plural) : '';
    }).filter(Boolean).join(' · ');
    st.className = 'settings-status ' + (n ? 'ok' : 'idle');
    st.textContent = n
      ? per + ' · ' + DB.sessions.length + ' sessions · ' + hrs(h) + ' logged'
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
    /* A file exported before 4.0 has `songs` and no `works`; both are CREATE
       data and `normalise` lifts either. */
    const rows = Array.isArray(raw && raw.works) ? raw.works
               : Array.isArray(raw && raw.songs) ? raw.songs : null;
    if (!rows) { toast('that file is not CREATE data'); return; }
    /* Not a merge. Two shelves interleaved by id is a guess about which copy of
       a work is the real one, and there is no answer to that question here. */
    Shell.ask({
      title: 'Replace the shelf?',
      body: 'The file holds ' + rows.length + (rows.length === 1 ? ' thing' : ' things') +
            '. Importing replaces everything CREATE currently holds.',
      yes: 'replace', no: 'cancel', danger: true,
      done: ok => {
        if (!ok) return;
        DB = normalise(raw); save(); openId = null; go('home'); renderSettings();
        toast('imported ' + DB.works.length);
      },
    });
  };
  r.readAsText(file);
}

function resetAll() {
  Shell.confirm('Reset CREATE?\nEvery song, every mix, every tick and the whole session log go. The areas and their stages are settings and stay.', () => {
    const was = JSON.parse(JSON.stringify(DB));
    DB = blank(); save(); openId = null; go('home'); renderSettings();
    Shell.undo('CREATE cleared', () => { DB = was; save(); render(); renderSettings(); });
  });
}

/* ── Boot ──────────────────────────────────────────────────────────────────── */
load();
render();

Config.subscribe(path => {
  if (path !== '*' && !String(path).startsWith('create.')) return;
  readConfig(); render(); renderSettings();
});

/* Every offset the glider reads is 0 while the slide is display:none, so a
   strip drawn off-screen lands at the left edge; a visit re-measures. Same for
   a window that changed width under it. */
function reposition() {
  positionGlider($id('cr-areas'));
  positionGlider($id('cr-log-tabs'));
}
window.addEventListener('resize', reposition);

Shell.register('create', {
  /* A visit redraws, and refreshes the curate cache behind what is already on
     screen when it is older than the window. Nothing waits on the network. */
  onShow: () => { render(); reposition(); maybeFetchCurate(); },
  /* The week's numbers and every "3 days ago" move at midnight. */
  onDayChange: render,
  home: () => go('home'),
  /* The works are in create_v1, not in Config, so search asks for them here.
     Tags match too: "for the set" is how a song gets looked for. */
  search: q => DB.works
    .filter(w => [w.name, w.tags, w.key].some(v => String(v || '').toLowerCase().includes(q)))
    .map(w => ({ title: w.name, sub: areaOf(w).noun + ' · ' + stageOf(w).label + (w.tags ? ' · ' + w.tags : ''),
                 go: () => { Shell.TABS.includes('create') ? Shell.go('create') : Shell.open('create');
                             openId = w.id; go('work'); } })),
});

return { render, renderSettings, go, addWork, exportData, importData, resetAll,
         /* Re-read what is stored. Only the harness has a reason to ask — the
            app reads once at boot and is the only thing that writes after. */
         reload: () => { load(); openId = null; render(); renderSettings(); },
         works: () => DB.works.slice(), sessions: () => DB.sessions.slice(),
         areas: () => AREAS.slice(),
         /* ── What LOG reads ──
            One day's work at the desk, and the same over a range. Synchronous
            readers over `create_v1`, the shape TRACK.doneOn and
            LEARN.dailyStats already have: LOG stores nothing of CREATE's, it
            asks at note time and at report time. `null` when nothing was
            logged, so the note's section only appears on a day that had one. */
         dayStats: iso => rangeStats([iso]),
         rangeStats,
         curate: () => ({ fetched: DB.curate.fetched, groups: DB.curate.groups.slice() }),
         /* What the module actually resolved the curate branch to, after the
            merge through the shipped defaults. Only the harness asks. */
         curateSettings: () => Object.assign({}, CURATE),
         refreshCurate: fetchCurate,
         /* The stages of one area, by key; with no key, of the first one. */
         stages: k => AREAS[areaIx(k)].stages.slice(),
         area: k => { DB.settings.area = k; save(); if (screen === 'home') renderHome(); },
         progress, open: id => { openId = id; go('work'); } };
})();
