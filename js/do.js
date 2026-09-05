/* ── DO ───────────────────────────────────────────────────────────────────────
   Daily checklists + Travel packing lists + Todoist close-on-finish sync.
   Logic is unchanged from complete/index.html. What changed for the merge:
     · everything lives in one IIFE and is published as window.DO, so inline
       handlers read DO.go(...) instead of go(...)
     · DOM lookups go through $id/$one/$all, which are scoped to .ns-do, so the
       ids this app has always used cannot collide with the other three views
     · the screen scroller is the slide, not the window
     · toast() forwards to the shell's single toast
   Storage keys are untouched: do_<date>, travel_state_v2 (and the v1 migration),
   do_todoist_v1. */
window.DO = (function () {
'use strict';

const SCOPE = '.ns-do ';
const view  = document.querySelector('#view-do .view-body');   // the scroll container (Shell wraps it)
const $id   = id  => document.querySelector(SCOPE + '#' + id);
const $one  = sel => document.querySelector(SCOPE + sel);
const $all  = sel => document.querySelectorAll(SCOPE + sel);
const toast = msg => Shell.toast(msg);

/* ── Content ──────────────────────────────────────────────────────────────────
   The routines, the packing categories and the tab layout used to be three
   literals in this file. They live in js/config.js now and are editable from
   Settings → content; these four are refreshed from it on boot and again
   whenever an edit lands. They stay module-level bindings rather than a call at
   every use site, because the rest of the file reads them dozens of times per
   render. */
let ROUTINES, TRAVEL_CATEGORIES, CATEGORY_ORDER, TABS, SECTIONS, MEDIA_LABELS, QUICK_LABEL, HISTORY;
const MEDIA_TAB = 'media';
const SECTION_KEYS = ['blocks', 'routines', 'quick', 'today', 'history'];
const SECTION_NAMES = { blocks:'Block tasks', routines:'Routine cards', quick:'Quick tasks',
                        today:'Today list', history:'Consistency strip' };

function readConfig() {
  ROUTINES          = Config.get('do.routines');
  TRAVEL_CATEGORIES = Config.get('do.travelCategories');
  CATEGORY_ORDER    = Config.get('do.categoryOrder').filter(c => TRAVEL_CATEGORIES[c]);
  // any category added in the editor but missing from the order still shows
  Object.keys(TRAVEL_CATEGORIES).forEach(c => { if (!CATEGORY_ORDER.includes(c)) CATEGORY_ORDER.push(c); });
  TABS = Config.get('do.tabs');
  /* The media tab is drawn from Todoist, not from routines, and an override of
     do.tabs written before it existed will not carry it: put it back, second
     from the left, so the grid always has somewhere to live. Switching it off
     is a DO setting (td.mediaOn), not a tab edit. */
  if (!TABS.some(t => t.id === MEDIA_TAB)) TABS.splice(Math.min(1, TABS.length), 0, { id: MEDIA_TAB, label: 'media', routines: [] });
  MEDIA_LABELS = (Config.get('do.mediaLabels') || []).map(s => String(s).trim().replace(/^@/, '')).filter(Boolean);
  QUICK_LABEL  = String(Config.get('do.quickLabel') || '').trim().replace(/^@/, '');
  HISTORY      = Object.assign({}, Config.defaults('do.history'), Config.get('do.history') || {});
  const want = (Config.get('do.sections') || []).filter(k => SECTION_KEYS.includes(k));
  SECTIONS = want.concat(SECTION_KEYS.filter(k => !want.includes(k)));   // anything missing goes last
}
readConfig();

/* ── Home sections ────────────────────────────────────────────────────────────
   Three siblings under the header; the preferred order is applied by moving
   the real elements, so nothing else has to know about it. The today list and
   the block tasks show only on the first tab — "other" is for the odd
   routines, not for today. */
const SECTION_EL = { blocks:'td-blocks', routines:'home-grid', quick:'td-quick',
                     today:'td-today', history:'do-hist' };
function applySectionOrder() {
  const home = $id('s-home'); if (!home) return;
  SECTIONS.forEach(k => { const el = $id(SECTION_EL[k]); if (el) home.appendChild(el); });
  // the media grid is not one of the ordered sections: it belongs to its own tab and always sits last
  const media = $id('td-media'); if (media) home.appendChild(media);
}

/* Which section is actually first on screen — the sections can be hidden, so
   CSS's :first-child is not it. That one carries no top margin: the gap under
   the title band is the shell's, and it is the same on every app. Called last,
   once the renders below have settled who is hidden. */
function markFirstSection() {
  const home = $id('s-home'); if (!home) return;
  const kids = Array.from(home.children);
  kids.forEach(el => el.classList.remove('first-vis'));
  const first = kids.find(el => !el.classList.contains('hidden'));
  if (first) first.classList.add('first-vis');
}
const onFirstTab = () => currentTab === (TABS[0] || {}).id;
const onMediaTab = () => currentTab === MEDIA_TAB;
function moveSection(key, dir) {
  const i = SECTIONS.indexOf(key), j = i + dir;
  if (i < 0 || j < 0 || j >= SECTIONS.length) return;
  const next = SECTIONS.slice(); [next[i], next[j]] = [next[j], next[i]];
  Config.set('do.sections', next);          // the subscriber re-reads and re-renders
}
function renderSectionOrder() {
  const box = $id('do-sections'); if (!box) return;
  box.innerHTML = SECTIONS.map((k, i) => `<div class="setting-row">
    <span class="setting-lbl">${SECTION_NAMES[k]}</span>
    <span class="app-acts">
      <button class="setting-btn" onclick="DO.moveSection('${k}',-1)"${i === 0 ? ' disabled' : ''} aria-label="move up">↑</button>
      <button class="setting-btn" onclick="DO.moveSection('${k}',1)"${i === SECTIONS.length - 1 ? ' disabled' : ''} aria-label="move down">↓</button>
    </span></div>`).join('');
}

const TRAVEL_KEY = 'travel_state_v2';

/* Local calendar day, from the shell. This was toISOString(), which is UTC: in
   France the checklist did not reset until 01:00 or 02:00, and a tick made in
   that window went into the previous day's record. Both are re-derived by
   rollDay() when midnight passes with the app open. */
let TODAY = Shell.today();
let SK = 'do_' + TODAY;

const routinesOfTab = id => (TABS.find(t => t.id === id) || TABS[0] || { routines: [] })
  .routines.filter(k => ROUTINES[k]);

let state = {};
let currentRoutine = null;
let currentTab = 'daily';
let travel = null;        // { lists:{id:{...}}, order:[id,...] }
let currentList = null;   // id of the open checklist
let editSection = null;
let newCats = new Set();  // categories selected on the new-checklist screen

// Derived from ROUTINES so adding a list never needs this kept in step.
function blankState() {
  return Object.fromEntries(Object.keys(ROUTINES).map(k => [k, {}]));
}

function loadState() {
  try {
    const raw = localStorage.getItem(SK);
    if (raw) { state = JSON.parse(raw); }
    else {
      // TD_KEY is do_-prefixed but is settings, not a day: sweeping it away here
      // cleared the Todoist token on the first load of every new day.
      Object.keys(localStorage).filter(k => k.startsWith('do_') && k !== SK && k !== TD_KEY)
        .forEach(k => { foldDay(k); localStorage.removeItem(k); });
      state = blankState();
    }
  } catch { state = blankState(); }
  loadTravel();
}

/* ── The history the sweep used to throw away ──────────────────────────────────
   Every `do_<date>` record was deleted on the first load of a new day, so DO
   knew nothing about yesterday. Each one is folded into a rolling tally first —
   per routine, done and total — which is what the strip on the home screen and
   the routines row in LOG's reports read.

   The key is `do-stats-v1`, hyphenated deliberately: the sweep above matches
   `do_`, and a summary that the sweep can reach is a summary that lasts one
   day. Same reasoning as LOG's `log-scale-v2`.

   `total` is the routine's length *as it is now*, not as it was on the day —
   the ticks are all that survive, and a routine that has since grown makes an
   old day look worse than it was. A day whose routine has been deleted keeps
   its ticks under the old key and is simply not counted. */
const STATS_KEY = 'do-stats-v1';
const STATS_MAX = 400;                      // days, ~13 months
function readStats() {
  try { const s = JSON.parse(localStorage.getItem(STATS_KEY) || 'null');
        return (s && s.days && typeof s.days === 'object') ? s : { v:1, days:{} }; }
  catch { return { v:1, days:{} }; }
}
function saveStats(s) {
  const keys = Object.keys(s.days).sort();
  while (keys.length > STATS_MAX) delete s.days[keys.shift()];
  try { localStorage.setItem(STATS_KEY, JSON.stringify(s)); } catch {}
}
/* One swept record → one day's row. Called with the storage key, before it is
   removed. A day already folded is left alone: the fold is idempotent so a
   re-import of an old backup cannot double it. */
function foldDay(key) {
  const iso = key.slice(3);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(iso)) return;
  let rec = null;
  try { rec = JSON.parse(localStorage.getItem(key) || 'null'); } catch {}
  if (!rec || typeof rec !== 'object') return;
  const row = dayRow(rec);
  if (!row) return;
  const s = readStats();
  s.days[iso] = row;
  saveStats(s);
}
/* { routineKey: [done, total] }, and nothing for a day with no tick at all —
   an empty row is indistinguishable from a day the app was never opened, and
   the strip says something different about each. */
function dayRow(rec) {
  const row = {};
  let any = 0;
  Object.keys(ROUTINES).forEach(k => {
    const items = ROUTINES[k].items || [];
    if (!items.length) return;
    const done = items.filter(i => rec[k] && rec[k][i]).length;
    if (done) any++;
    row[k] = [done, items.length];
  });
  return any ? row : null;
}
/* Today is not in the tally yet — it is folded when it is swept — so it is
   derived live from the state in hand, and falls back to a folded row where
   there is one: a day restored from a backup has a tally and no record. */
function statsFor(iso) {
  const row = (iso === TODAY ? dayRow(state) : null) || readStats().days[iso];
  if (!row) return null;
  let done = 0, total = 0;
  Object.keys(row).forEach(k => { done += row[k][0] || 0; total += row[k][1] || 0; });
  return { done, total, pct: total ? Math.round(done / total * 100) : 0, routines: row };
}
/* For LOG's weekly and monthly reports: the days that have a record, summed. */
function statsRange(days) {
  let done = 0, total = 0, logged = 0;
  (days || []).forEach(iso => {
    const s = statsFor(iso);
    if (!s || !s.total) return;
    done += s.done; total += s.total; logged++;
  });
  return { done, total, days: logged, pct: total ? Math.round(done / total * 100) : 0 };
}

/* The strip itself: one cell per day, oldest left, today last. It is a fixed
   number of flexed cells rather than a scroller — a row built from Config with
   no fixed width is exactly what lost DO's tabs off the right edge in 2.0. */
function renderHistory() {
  const box = $id('do-hist'); if (!box) return;
  const show = HISTORY.on !== false && onFirstTab();
  box.classList.toggle('hidden', !show);
  if (!show) { box.innerHTML = ''; return; }
  const n = Math.max(3, Math.min(60, +HISTORY.days || 14));
  const days = [];
  for (let i = n - 1; i >= 0; i--) days.push(dayOffset(TODAY, -i));
  const rows = days.map(iso => ({ iso, s: statsFor(iso) }));
  const seen = rows.filter(r => r.s && r.s.total);
  const full = seen.filter(r => r.s.done === r.s.total).length;
  const avg = seen.length ? Math.round(seen.reduce((a, r) => a + r.s.pct, 0) / seen.length) : 0;
  const label = iso => Prefs.formatDate(iso, 'short');
  box.innerHTML = `<div class="tt-head"><span>routines<em>${seen.length ? `${avg}% · ${full} full` : 'no history yet'}</em></span></div>
    <div class="dh-strip">${rows.map(r => {
      const pct = r.s ? r.s.pct : 0;
      const cls = !r.s ? ' none' : r.s.done === r.s.total ? ' full' : '';
      const title = r.s ? `${label(r.iso)} · ${r.s.done}/${r.s.total}` : `${label(r.iso)} · nothing`;
      return `<span class="dh-cell${cls}" title="${esc(title)}" aria-label="${esc(title)}"
        ><i style="height:${Math.max(pct, r.s ? 6 : 0)}%"></i></span>`;
    }).join('')}</div>
    <div class="dh-legend"><span>${esc(label(days[0]))}</span><span>${esc(label(days[days.length - 1]))}</span></div>`;
}
function dayOffset(iso, n) {
  const p = String(iso).split('-').map(Number);
  const d = new Date(p[0], (p[1] || 1) - 1, (p[2] || 1) + n);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}
function toggleHistory() {
  const h = Object.assign({}, HISTORY, { on: HISTORY.on === false });
  Config.set('do.history', h);            // the subscriber re-reads and re-renders
}

function saveState() { localStorage.setItem(SK, JSON.stringify(state)); }

/* Midnight with the app open: move to the new day's record (loadState sweeps
   the old one) and redraw whatever is on screen. */
function rollDay(day) {
  TODAY = day;
  SK = 'do_' + TODAY;
  loadState();
  loadTodoist();          // drops yesterday's closedOn and today-task cache
  renderHome();
  if ($one('#s-checklist.on')) renderChecklist();
}

function loadTravel() {
  try {
    const raw = localStorage.getItem(TRAVEL_KEY);
    if (raw) { travel = JSON.parse(raw); }
  } catch {}
  if (!travel || !travel.lists) {
    travel = { lists:{}, order:[] };
    migrateLegacyTravel();
  }
  travel.lists = travel.lists || {};
  travel.order = travel.order || Object.keys(travel.lists);
}

// pull a single saved checklist out of the old v1 format, if present
function migrateLegacyTravel() {
  let old = null;
  try { old = JSON.parse(localStorage.getItem('travel_state_v1') || 'null'); } catch {}
  if (!old || !old.sections) return;
  const list = newListObj('My Trip');
  const stripPrefix = s => s.replace(/^(x|\d+)\s+/i, '');
  Object.keys(old.sections).forEach(sec => {
    const items = (old.sections[sec] || []).map(stripPrefix);
    list.sections[sec] = items;
    (old.sections[sec] || []).forEach((raw, i) => {
      const name = items[i];
      const k = itemKey(sec, name);
      if (old.checked && old.checked[itemKey(sec, raw)]) list.checked[k] = true;
      const oldCount = (old.counts && old.counts[itemKey(sec, raw)]) ||
                       (raw.match(/^(\d+)\s+/) ? parseInt(raw, 10) : 1);
      if (oldCount > 1) list.counts[k] = oldCount;
    });
  });
  travel.lists[list.id] = list;
  travel.order.push(list.id);
}

function newListObj(name) {
  return { id: 'l' + Date.now() + Math.floor(Math.random()*1000),
           name, created: Date.now(), sections:{}, checked:{}, counts:{} };
}

function saveTravel() { localStorage.setItem(TRAVEL_KEY, JSON.stringify(travel)); }

function toggle(key, item) {
  if (!state[key]) state[key] = {};
  const wasDone = routineDone(key);
  state[key][item] = !state[key][item];
  saveState();
  renderChecklist();
  renderHome();
  if (!wasDone && routineDone(key)) tdAutoPush(key);
}

function go(id) {
  $all('.scr').forEach(s => s.classList.remove('on'));
  $id('s-' + id).classList.add('on');
  if (view) view.scrollTop = 0;
  if (id === 'home') renderHome();
  if (id === 'checklist') renderChecklist();
  if (id === 'travel') renderTravelList();
  if (id === 'travel-new') renderTravelNew();
  if (id === 'travel-cl') renderTravelCl();
  if (id === 'travel-edit') renderTravelEdit();
}

function openRoutine(key) {
  currentRoutine = key;
  $id('cl-title').textContent = ROUTINES[key].label;
  go('checklist');
}

/* The home tab strip is built from Config too, so adding a tab in the editor
   gives you a real tab here rather than an orphaned group of routines. */
function renderTabs() {
  const bar = $id('home-tabs');
  if (!bar) return;
  if (!TABS.some(t => t.id === currentTab)) currentTab = (TABS[0] || {}).id;
  // the media tab is switched off under Settings → do: no chip, and its grid stays hidden
  const shown = TABS.filter(t => t.id !== MEDIA_TAB || td.mediaOn);
  if (!shown.some(t => t.id === currentTab)) currentTab = (shown[0] || {}).id;
  bar.innerHTML = `<div class="tab-glider" id="tab-glider"></div>` + shown.map(t =>
    `<button class="tab${t.id === currentTab ? ' active' : ''}" data-tab="${t.id}"
             onclick="DO.setTab('${t.id}')">${t.label}</button>`).join('');
  // a single tab is not a choice; hide the strip rather than show a lone chip
  bar.classList.toggle('hidden', shown.length < 2);
  positionGlider();
}

/* A routine that is finished can be dropped from the grid rather than greyed:
   on a tab whose routines are all morning ones, the afternoon is otherwise
   spent scrolling past six ticked cards to reach the one that is not. The
   travel card follows the same rule — it is a card on this grid like any
   other. Nothing is *lost*: switching the dial back off brings them all
   straight back, because the state was never touched. */
const hideDone = () => Prefs.get('doHideDone') === true;

function renderHome() {
  $id('date-label').textContent = Prefs.formatDate(TODAY).toUpperCase();   // #date-label is a span inside .h-label

  const minimal = Prefs.get('doCardStyle') === 'minimal';
  const routineCards = routinesOfTab(currentTab).map(key => {
    const r = ROUTINES[key];
    const done = r.items.filter(i => state[key]?.[i]).length;
    const pct  = r.items.length ? Math.round((done / r.items.length) * 100) : 0;
    const isDone = done === r.items.length && r.items.length > 0;
    if (isDone && hideDone()) return '';
    /* The minimal card is the same card with the two things that take height
       taken out: the progress bar, and the "done" line under the name. What
       is left is the name and the ratio on one row — enough to see how far in
       you are, at a third of the height. */
    return `<div class="card${isDone ? ' done' : ''}${minimal ? ' mini' : ''}" onclick="DO.openRoutine('${key}')">
      <div class="card-t">${r.label}</div>
      <div class="card-s">${done} / ${r.items.length}${minimal ? '' : ' done'}</div>
      ${minimal ? '' : `<div class="card-bar"><div class="card-bar-fill" style="width:${pct}%;background:${barColor(pct)}"></div></div>`}
    </div>`;
  }).join('');

  // Travel lives on the last tab, wherever that ends up being
  let travelCard = '';
  if (currentTab === (TABS[TABS.length - 1] || {}).id) {
    const tStat = travelStatsAll();
    const tDone = tStat.done === tStat.total && tStat.total > 0;
    const n = travel.order.length;
    const sub = n === 0 ? 'no checklists yet'
                        : `${n} list${n>1?'s':''} · ${tStat.done} / ${tStat.total}${minimal ? '' : ' packed'}`;
    if (!(tDone && hideDone()))
      travelCard = `<div class="card${tDone ? ' done' : ''}${minimal ? ' mini' : ''}" onclick="DO.go('travel')">
        <div class="card-t">Travel</div>
        <div class="card-s">${sub}</div>
        ${minimal ? '' : `<div class="card-bar"><div class="card-bar-fill" style="width:${tStat.pct}%;background:${barColor(tStat.pct)}"></div></div>`}
      </div>`;
  }

  const grid = $id('home-grid');
  grid.classList.toggle('mini', minimal);
  /* Everything on this tab is finished and the dial says hide it. An empty
     grid with no explanation reads as a bug — worse, as lost data — so the
     grid says what happened and how to get the cards back. */
  grid.innerHTML = (routineCards + travelCard) ||
    (hideDone() && routinesOfTab(currentTab).length
      ? `<div class="grid-clear">all done<em>finished routines are hidden — settings → apps → do</em></div>`
      : '');
  applySectionOrder();
  renderToday();
  renderBlocks();
  renderQuick();
  renderMedia();
  renderHistory();
  markFirstSection();
}

function setTab(tab) {
  if (tab === currentTab) return;
  currentTab = tab;
  $all('#home-tabs .tab').forEach(b => b.classList.toggle('active', b.dataset.tab === tab));
  positionGlider();
  renderHome();
}

function positionGlider() {
  const active = $one('#home-tabs .tab.active');
  const glider = $id('tab-glider');
  if (!active || !glider) return;
  glider.style.width = active.offsetWidth + 'px';
  glider.style.transform = `translateX(${active.offsetLeft}px)`;
  revealTab(active);
}

/* Enough tabs and the strip scrolls, so the selected one can be off its edge —
   on a fresh load as much as after a tap. The strip's own scrollLeft is nudged
   rather than scrollIntoView(): that would also scroll the slide, and each slide
   is meant to stay exactly where you left it. offsetLeft and scrollLeft share an
   origin here (the strip is the glider's offsetParent), so the maths is direct. */
function revealTab(active) {
  const bar = $id('home-tabs');
  if (!bar || bar.scrollWidth <= bar.clientWidth) return;
  const left = active.offsetLeft, right = left + active.offsetWidth;
  if (left < bar.scrollLeft) bar.scrollLeft = left;
  else if (right > bar.scrollLeft + bar.clientWidth) bar.scrollLeft = right - bar.clientWidth;
}

function listStats(list) {
  let done = 0, total = 0;
  Object.keys(list.sections).forEach(sec => {
    (list.sections[sec] || []).forEach(item => {
      total++;
      if (list.checked[itemKey(sec, item)]) done++;
    });
  });
  const pct = total ? Math.round((done / total) * 100) : 0;
  return { done, total, pct };
}

function travelStatsAll() {
  let done = 0, total = 0;
  travel.order.forEach(id => {
    const s = listStats(travel.lists[id]);
    done += s.done; total += s.total;
  });
  const pct = total ? Math.round((done / total) * 100) : 0;
  return { done, total, pct };
}

function itemKey(sec, item) { return sec + '::' + item; }
function sectionOrder(list) {
  const keys = Object.keys(list.sections);
  return keys.sort((a, b) => {
    const ia = CATEGORY_ORDER.indexOf(a), ib = CATEGORY_ORDER.indexOf(b);
    return (ia < 0 ? 99 : ia) - (ib < 0 ? 99 : ib);
  });
}

function renderChecklist() {
  if (!currentRoutine) return;
  const key   = currentRoutine;
  const items = ROUTINES[key].items;
  const done  = items.filter(i => state[key]?.[i]).length;
  const pct   = items.length ? Math.round((done / items.length) * 100) : 0;
  const allDone = done === items.length;

  $id('cl-progress').classList.toggle('all-done', allDone);
  $id('cl-bar-fill').style.width = pct + '%';
  $id('cl-bar-fill').style.background = barColor(pct);
  $id('cl-stats').innerHTML = `<em>${done}</em> / ${items.length}`;
  $id('cl-done-banner').classList.toggle('show', allDone);
  $id('cl-action-btn').textContent = allDone ? 'clear all' : 'mark all';

  $id('cl-items').innerHTML = items.map(item => {
    const checked = !!state[key]?.[item];
    return `<button class="item-btn${checked ? ' checked' : ''}" onclick="DO.toggle('${key}','${attr(item)}')">
      <span>${esc(item)}</span>
      <div class="item-check-ico">
        <svg class="item-check-svg" viewBox="0 0 10 10" fill="none">
          <path d="M1.5 5L4 7.5L8.5 2.5" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"/>
        </svg>
      </div>
    </button>`;
  }).join('');
}

function toggleAll() {
  if (!currentRoutine) return;
  const key   = currentRoutine;
  const items = ROUTINES[key].items;
  const done  = items.filter(i => state[key]?.[i]).length;
  const allDone = done === items.length;
  if (!state[key]) state[key] = {};
  items.forEach(i => { state[key][i] = !allDone; });
  saveState();
  renderChecklist();
  renderHome();
  if (!allDone) tdAutoPush(key);
}

function resetDay() {
  Shell.confirm('Reset all items for today?', () => {
    state = blankState();
    saveState();
    go('home');
  });
}

// ── Travel ────────────────────────────────────────────────────────────────────
function esc(s) { return String(s||'').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;'); }
/* For a value that ends up inside onclick="…('…')": escaped as a JS string
   literal first, then as an HTML attribute, so an apostrophe, a backslash or a
   quote in an item — all of which the editor lets you type — never breaks the
   handler. The browser undoes both layers before the value reaches toggle(),
   so the key round-trips exactly. */
function attr(s) {
  return String(s ?? '').replace(/\\/g, '\\\\').replace(/'/g, "\\'")
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

// list of saved checklists
function renderTravelList() {
  const box = $id('tv-lists');
  if (!travel.order.length) {
    box.innerHTML = `<div class="tv-empty">No checklists yet.<br>Tap “+ new” to create one.</div>`;
    return;
  }
  box.innerHTML = travel.order.map(id => {
    const list = travel.lists[id];
    const s = listStats(list);
    const done = s.done === s.total && s.total > 0;
    return `<div class="tv-list-card${done ? ' done' : ''}" onclick="DO.openList('${id}')">
      <div class="tv-list-head">
        <span class="tv-list-name">${esc(list.name)}</span>
        <button class="tv-list-del" onclick="event.stopPropagation();DO.deleteList('${id}')">✕</button>
      </div>
      <div class="card-s">${s.done} / ${s.total} packed</div>
      <div class="card-bar"><div class="card-bar-fill" style="width:${s.pct}%;background:${barColor(s.pct)}"></div></div>
    </div>`;
  }).join('');
}

function openList(id) { currentList = id; go('travel-cl'); }

function deleteList(id) {
  const list = travel.lists[id];
  Shell.confirm('Delete “' + (list ? list.name : 'this list') + '”?', () => {
    delete travel.lists[id];
    travel.order = travel.order.filter(x => x !== id);
    if (currentList === id) currentList = null;
    saveTravel();
    renderTravelList();
    renderHome();
  });
}

// new-checklist setup: name + category selector
function renderTravelNew() {
  newCats = new Set();
  $id('tv-new-name').value = '';
  $id('tv-cat-select').innerHTML = CATEGORY_ORDER.map(cat => {
    const n = TRAVEL_CATEGORIES[cat].length;
    return `<button class="tv-cat-row" id="cat-${cat}" onclick="DO.toggleCat('${cat}')">
      <span class="tv-cat-name">${cat}</span>
      <span class="tv-cat-count">${n} items</span>
      <div class="tv-check">
        <svg class="tv-check-svg" viewBox="0 0 10 10" fill="none">
          <path d="M1.5 5L4 7.5L8.5 2.5" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"/>
        </svg>
      </div>
    </button>`;
  }).join('');
}

function toggleCat(cat) {
  if (newCats.has(cat)) newCats.delete(cat); else newCats.add(cat);
  const el = $id('cat-' + cat);
  if (el) el.classList.toggle('on', newCats.has(cat));
}

function createList() {
  if (!newCats.size) { toast('pick a category'); return; }
  const name = $id('tv-new-name').value.trim() || 'My Trip';
  const list = newListObj(name);
  CATEGORY_ORDER.forEach(cat => {
    if (newCats.has(cat)) list.sections[cat] = [...TRAVEL_CATEGORIES[cat]];
  });
  travel.lists[list.id] = list;
  travel.order.push(list.id);
  saveTravel();
  currentList = list.id;
  renderHome();
  go('travel-cl');
}

// single checklist
function curList() { return travel.lists[currentList]; }
function itemCount(list, key) { return list.counts[key] ?? 1; }

function renderTravelCl() {
  const list = curList();
  if (!list) { go('travel'); return; }
  $id('tv-cl-title').textContent = list.name;
  const stat = listStats(list);
  const allDone = stat.done === stat.total && stat.total > 0;
  $id('tv-progress').classList.toggle('all-done', allDone);
  $id('tv-bar-fill').style.width = stat.pct + '%';
  $id('tv-bar-fill').style.background = barColor(stat.pct);
  $id('tv-stats').innerHTML = `<em>${stat.done}</em> / ${stat.total}`;
  $id('tv-done-banner').classList.toggle('show', allDone);

  $id('tv-sections').innerHTML = sectionOrder(list).map(sec => {
    const items = list.sections[sec] || [];
    const headAction = `<button class="tv-sec-act" onclick="DO.openTravelEdit('${sec}')">+ add</button>`;
    const rows = items.map(item => {
      const key = itemKey(sec, item);
      const checked = !!list.checked[key];
      const n = itemCount(list, key);
      const decDisabled = n <= 1 ? ' disabled' : '';
      const safeItem = attr(item);
      return `<button class="tv-item${checked ? ' checked' : ''}" onclick="DO.toggleTravel('${sec}','${safeItem}')">
        <span class="tv-count-grp" onclick="event.stopPropagation()">
          <span class="tv-step${decDisabled}" onclick="event.stopPropagation();DO.decCount('${sec}','${safeItem}')">−</span>
          <span class="tv-num">${n}</span>
          <span class="tv-step" onclick="event.stopPropagation();DO.bumpCount('${sec}','${safeItem}')">+</span>
        </span>
        <span class="tv-name">${esc(item)}</span>
        <span class="tv-rm" onclick="event.stopPropagation();DO.removeItem('${sec}','${safeItem}')">✕</span>
        <div class="tv-check">
          <svg class="tv-check-svg" viewBox="0 0 10 10" fill="none">
            <path d="M1.5 5L4 7.5L8.5 2.5" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"/>
          </svg>
        </div>
      </button>`;
    }).join('');
    return `<div class="tv-sec"><span>${sec}</span>${headAction}</div>${rows}`;
  }).join('');
}

function toggleTravel(sec, item) {
  const list = curList(); if (!list) return;
  const key = itemKey(sec, item);
  list.checked[key] = !list.checked[key];
  saveTravel();
  renderTravelCl();
}

function bumpCount(sec, item) {
  const list = curList(); if (!list) return;
  const key = itemKey(sec, item);
  list.counts[key] = itemCount(list, key) + 1;
  saveTravel();
  renderTravelCl();
}

function decCount(sec, item) {
  const list = curList(); if (!list) return;
  const key = itemKey(sec, item);
  const cur = itemCount(list, key);
  if (cur <= 1) return;
  if (cur - 1 <= 1) delete list.counts[key]; else list.counts[key] = cur - 1;
  saveTravel();
  renderTravelCl();
}

function removeItem(sec, item) {
  const list = curList(); if (!list) return;
  const arr = list.sections[sec] || [];
  const idx = arr.indexOf(item);
  if (idx < 0) return;
  arr.splice(idx, 1);
  delete list.checked[itemKey(sec, item)];
  delete list.counts[itemKey(sec, item)];
  saveTravel();
  renderTravelCl();
}

function openTravelEdit(sec) { editSection = sec; go('travel-edit'); }

function renderTravelEdit() {
  const list = curList();
  if (!list) { go('travel'); return; }
  if (!editSection || !list.sections[editSection]) editSection = sectionOrder(list)[0] || 'clothes';
  $id('tv-edit-title').textContent = 'Add to ' + editSection;
  const items = list.sections[editSection] || [];
  $id('tv-edit-list').innerHTML = items.map((item, i) => `
    <div class="tv-edit-item">
      <span class="tv-edit-item-txt">${esc(item)}</span>
      <button class="tv-edit-del" onclick="DO.deleteEditItem(${i})">✕</button>
    </div>`).join('');
  $id('tv-edit-input').value = '';
}

function addEditItem() {
  const list = curList(); if (!list) return;
  const inp = $id('tv-edit-input');
  const txt = inp.value.trim();
  if (!txt) return;
  if (!list.sections[editSection]) list.sections[editSection] = [];
  if (!list.sections[editSection].includes(txt)) list.sections[editSection].push(txt);
  saveTravel();
  renderTravelEdit();
}

function deleteEditItem(i) {
  const list = curList(); if (!list) return;
  const item = list.sections[editSection][i];
  list.sections[editSection].splice(i, 1);
  delete list.checked[itemKey(editSection, item)];
  delete list.counts[itemKey(editSection, item)];
  saveTravel();
  renderTravelEdit();
}

function saveTravelEdit() {
  saveTravel();
  toast(editSection + ' saved');
  go('travel-cl');
}

function resetTravel() {
  Shell.confirm('Delete ALL travel checklists? This cannot be undone.', () => {
    localStorage.removeItem(TRAVEL_KEY);
    localStorage.removeItem('travel_state_v1');
    travel = { lists:{}, order:[] };
    saveTravel();
    currentList = null;
    toast('travel reset');
    go('home');
  });
}

function exportTravelMd() {
  const list = curList();
  if (!list) return;
  const lines = [];
  sectionOrder(list).forEach(sec => {
    lines.push('#### ' + sec);
    (list.sections[sec] || []).forEach(item => {
      const key = itemKey(sec, item);
      const mark = list.checked[key] ? 'x' : ' ';
      const n = itemCount(list, key);
      const body = n > 1 ? `${n} ${item}` : item;   // count hidden when 1
      lines.push(`- [${mark}] ${body}`);
    });
    lines.push('');
  });
  const md = lines.join('\n');
  const date = Shell.today();
  const slug = (list.name || 'travel').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '') || 'travel';
  const filename = `${slug}_${date}.md`;
  const blob = new Blob([md], { type: 'text/markdown' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url; a.download = filename;
  document.body.appendChild(a); a.click();
  document.body.removeChild(a);
  setTimeout(() => URL.revokeObjectURL(url), 1000);
  toast('exported ' + filename);
}

// ─── Todoist sync ─────────────────────────────────────────────────────────────
// Each daily list is one "every day" task in 04 | life › daily routine. Todoist
// keeps a recurring task active and only moves its due date on, so a due date
// past today is the signal it has already been completed for today — that is both
// how a Todoist completion is read back here and the guard against closing twice.
// REST v2 was retired 2026-02-10; everything below targets the unified v1 API.
const TD_KEY    = 'do_todoist_v1';   // outlives the daily state key on purpose
const TD_DIRECT = 'https://api.todoist.com/api/v1';
const TD_PROXY  = 'https://todoist-proxy.hp-qrate.workers.dev/api/v1';
const TD_DEFAULTS = { token:'', project:'04 | life', section:'daily routine',
                      projectId:null, sectionId:null, lastSync:null,
                      endpoint:'direct', autoPush:true, closedOn:{},
                      // today's-tasks block: off until a project is chosen
                      todayOn:false, todayOverdue:true, todayFilter:'',
                      today:{ date:null, tasks:[], fetched:0, missing:[] },
                      // block tasks: every task due today carrying one of PLAN's block labels
                      blocksOn:true, blocksHideDone:false, blocksDone:'day',
                      blocks:{ date:null, tasks:[], fetched:0 },
                      /* the media tab: every open task carrying one of do.mediaLabels, any date.
                         `mediaKind` is the label the list is narrowed to ('' = all) and
                         `mediaSort` is how it is ordered. Both persist: a backlog you come
                         back to twice a day should not have to be narrowed twice a day. */
                      mediaOn:true, mediaHideDone:false, mediaKind:'', mediaSort:'kind',
                      media:{ date:null, tasks:[], fetched:0 },
                      // the quick cards: every open task carrying do.quickLabel, with its subtasks
                      quickOn:true, quickHideDone:false, quickFold:false,
                      quick:{ date:null, tasks:[], fetched:0 } };
let td = { ...TD_DEFAULTS };
let tdBusy = false;

function loadTodoist() {
  try {
    const raw = localStorage.getItem(TD_KEY);
    if (raw) td = Object.assign({ ...TD_DEFAULTS }, JSON.parse(raw));
  } catch { td = { ...TD_DEFAULTS }; }
  if (!td.closedOn || typeof td.closedOn !== 'object') td.closedOn = {};
  const today = tdLocalDate();
  Object.keys(td.closedOn).forEach(k => { if (td.closedOn[k] !== today) delete td.closedOn[k]; });
  // yesterday's task list is not today's
  if (!td.today || td.today.date !== today) td.today = { date:today, tasks:[], fetched:0, missing:[] };
  if (!td.blocks || td.blocks.date !== today) td.blocks = { date:today, tasks:[], fetched:0 };
  /* the media list is a backlog, not a day's list: a new day keeps what is
     still open and only drops the tasks closed yesterday (their untick window
     is over) */
  if (!td.media || !Array.isArray(td.media.tasks)) td.media = { date:today, tasks:[], fetched:0 };
  else if (td.media.date !== today) td.media = { date:today, tasks:td.media.tasks.filter(t => !t.done), fetched:td.media.fetched || 0 };
  // the quick list is a backlog too — same rule, and a parent drops with its subtasks
  if (!td.quick || !Array.isArray(td.quick.tasks)) td.quick = { date:today, tasks:[], fetched:0 };
  else if (td.quick.date !== today) td.quick = { date:today, tasks:td.quick.tasks.filter(t => !t.done), fetched:td.quick.fetched || 0 };
}
/* The key itself lives in Creds now. It is still written back into this app's
   own record on every save so the standalone complete/ app keeps working. */
function tdPersist() { td.token = Creds.token(); localStorage.setItem(TD_KEY, JSON.stringify(td)); }

/* Todoist due dates are local calendar days; so is TODAY now, via the shell. */
function tdLocalDate(d = new Date()) { return Shell.today(d); }

function tdFold(s) {
  return String(s || '').toLowerCase().normalize('NFD')
    .replace(/[̀-ͯ]/g, '');   // drop accents
}
/* "Routine P1", "routine p1" and "ROUTINE-P1" all collapse to the ROUTINES key. */
function tdSlug(s) { return tdFold(s).replace(/[^a-z0-9]+/g, ''); }
/* Looser form for project and section names, where words must stay apart:
   "04 | life" and "04|life" both become "04 life". */
function tdName(s) { return tdFold(s).replace(/[^a-z0-9]+/g, ' ').trim(); }
/* Built on demand, not once at boot: ROUTINES is editable now, and a routine
   renamed or added in Settings has to match its Todoist task without a reload. */
function tdRoutineBySlug() {
  return Object.fromEntries(
    Object.keys(ROUTINES).flatMap(k => [[tdSlug(k), k], [tdSlug(ROUTINES[k].label), k]]));
}

function tdBase() { return td.endpoint === 'proxy' ? TD_PROXY : TD_DIRECT; }

async function tdFetch(path, opts = {}) {
  const tok = Creds.token();
  if (!tok) throw new Error('no Todoist key saved — add one in settings');
  let res;
  try {
    res = await fetch(tdBase() + path, {
      ...opts,
      headers: {
        'Authorization': 'Bearer ' + tok,
        ...(opts.body ? { 'Content-Type': 'application/json' } : {}),
        ...(opts.headers || {}),
      },
    });
  } catch {
    throw new Error(location.protocol === 'file:'
      ? 'blocked by the browser — open DO over http(s), not as a local file'
      : 'network error — try the other endpoint in settings');
  }
  if (res.status === 401 || res.status === 403) throw new Error('token rejected by Todoist (401)');
  if (res.status === 429) throw new Error('rate limited by Todoist — wait a minute');
  if (!res.ok) throw new Error(`Todoist error ${res.status}`);
  const text = await res.text();          // /close answers 204 with no body
  return text ? JSON.parse(text) : null;
}

/* v1 paginates some collections as {results,next_cursor} and returns others as a
   bare array, so unwrap either and follow the cursor when there is one. */
async function tdGetAll(path, params = {}) {
  const out = [];
  let cursor = null;
  do {
    const q = new URLSearchParams({ ...params, limit: '200' });
    if (cursor) q.set('cursor', cursor);
    const page = await tdFetch(`${path}?${q}`);
    if (Array.isArray(page)) { out.push(...page); cursor = null; }
    else { out.push(...(page?.results || [])); cursor = page?.next_cursor || null; }
  } while (cursor);
  return out;
}

/* Resolves "04 | life" / "daily routine" to ids once, then caches them. */
async function tdResolveTarget(force = false) {
  if (!force && td.projectId && td.sectionId) return td;
  const projects = await tdGetAll('/projects');
  const proj = projects.find(p => tdName(p.name) === tdName(td.project));
  if (!proj) throw new Error(`project "${td.project}" not found (${projects.length} projects visible)`);
  const sections = await tdGetAll('/sections', { project_id: proj.id });
  const sec = sections.find(s => tdName(s.name) === tdName(td.section));
  if (!sec) {
    const names = sections.map(s => s.name).join(', ') || 'none';
    throw new Error(`section "${td.section}" not found in ${proj.name} — has: ${names}`);
  }
  td.projectId = proj.id;
  td.sectionId = sec.id;
  tdPersist();
  return td;
}

/* Map of routine key → the active Todoist task that stands for it. */
async function tdRoutineTasks(force = false) {
  const t = await tdResolveTarget(force);
  const tasks = await tdGetAll('/tasks', { project_id: t.projectId, section_id: t.sectionId });
  const byRoutine = new Map();
  const bySlug = tdRoutineBySlug();
  tasks.forEach(task => {
    const key = bySlug[tdSlug(task.content)];
    if (key && !byRoutine.has(key)) byRoutine.set(key, task);
  });
  return byRoutine;
}

function tdDueDate(task) {
  const d = task.due && task.due.date;
  return d ? String(d).slice(0, 10) : null;   // "2026-08-31" or "2026-08-31T09:00:00"
}
/* Already rolled forward = Todoist has it done for today. Dateless tasks can
   only be pushed, never read back, so they count as not done. */
function tdRolled(task, today) {
  const due = tdDueDate(task);
  return !!due && due > today;
}

function routineDone(key) {
  const items = ROUTINES[key]?.items || [];
  return items.length > 0 && items.every(i => state[key]?.[i]);
}
function markRoutineDone(key) {
  if (!state[key]) state[key] = {};
  ROUTINES[key].items.forEach(i => { state[key][i] = true; });
}

async function syncTodoist() {
  if (tdBusy) return;
  if (!Creds.token()) { toast('add a Todoist key in settings'); Shell.settings('do'); return; }
  tdBusy = true; renderTdButtons(); tdStatus('syncing…', 'busy');
  const today = tdLocalDate();
  try {
    const byRoutine = await tdRoutineTasks();
    let pulled = 0, pushed = 0, failed = 0;

    // ── Todoist → DO: a task already due past today was completed over there
    byRoutine.forEach((task, key) => {
      if (!tdRolled(task, today) || routineDone(key)) return;
      markRoutineDone(key);
      td.closedOn[key] = today;   // done on both sides now — never close it again today
      pulled++;
    });
    if (pulled) { saveState(); renderChecklist(); renderHome(); }

    // ── DO → Todoist: close what is finished here and still due today or earlier
    for (const [key, task] of byRoutine) {
      if (!routineDone(key)) continue;
      if (tdRolled(task, today)) continue;        // already done over there
      if (td.closedOn[key] === today) continue;   // we already closed it today
      try {
        await tdFetch(`/tasks/${task.id}/close`, { method: 'POST' });
        td.closedOn[key] = today;
        pushed++;
      } catch { failed++; }
    }

    td.lastSync = Date.now();
    tdPersist();
    renderTodoistSettings();

    const parts = [];
    if (pulled) parts.push(`↓ ${pulled} ticked here`);
    if (pushed) parts.push(`↑ ${pushed} closed`);
    if (failed) parts.push(`${failed} failed`);
    if (!byRoutine.size) parts.push('no matching tasks in that section');
    const msg = parts.length ? parts.join(' · ') : 'already in sync';
    toast(msg);
    tdStatus(msg, failed ? 'bad' : 'good');
  } catch (e) {
    toast('sync failed');
    tdStatus(e.message, 'bad');
  } finally {
    tdBusy = false; renderTdButtons();
  }
}

/* Ticking the last item closes just that one task, so a list finished here does
   not sit around waiting for the next manual sync. */
async function tdAutoPush(key) {
  if (tdBusy || !Creds.token() || !td.autoPush) return;
  const today = tdLocalDate();
  if (td.closedOn[key] === today) return;
  tdBusy = true; renderTdButtons();
  try {
    const task = (await tdRoutineTasks()).get(key);
    if (!task || tdRolled(task, today) || !routineDone(key)) return;
    await tdFetch(`/tasks/${task.id}/close`, { method: 'POST' });
    td.closedOn[key] = today;
    td.lastSync = Date.now();
    tdPersist();
    toast('✓ ' + ROUTINES[key].label + ' closed in todoist');
  } catch (e) {
    toast('todoist: ' + e.message);
  } finally {
    tdBusy = false; renderTdButtons();
  }
}

async function testTodoist() {
  if (tdBusy) return;
  if (!Creds.token()) { tdStatus('add your Todoist key under settings → data first', 'bad'); return; }
  tdBusy = true; renderTdButtons(); tdStatus('checking…', 'busy');
  try {
    const byRoutine = await tdRoutineTasks(true);
    const today = tdLocalDate();
    if (!byRoutine.size) {
      tdStatus(`connected to ${td.section}, but no task there matches a list name`, 'bad');
    } else {
      const names = [...byRoutine.keys()].map(k => ROUTINES[k].label +
        (tdRolled(byRoutine.get(k), today) ? ' ✓' : '')).join(', ');
      tdStatus(`connected — ${byRoutine.size} matched: ${names}`, 'good');
    }
  } catch (e) {
    tdStatus(e.message, 'bad');
  } finally {
    tdBusy = false; renderTdButtons();
  }
}

function renderTdButtons() {
  $all('[data-td-btn]').forEach(b => {
    b.disabled = tdBusy;
    b.textContent = tdBusy ? (b.dataset.tdBusy || 'syncing…') : b.dataset.tdBtn;
  });
}
function tdStatus(msg, kind) {
  const el = $id('td-status');
  if (!el) return;
  el.textContent = msg;
  el.className = 'td-status' + (kind ? ' ' + kind : '');
}

/* The key is set once in Settings › General; this only owns the target. */
function saveTodoistSettings() {
  const proj = $id('td-project').value.trim() || TD_DEFAULTS.project;
  const sec  = $id('td-section').value.trim() || TD_DEFAULTS.section;
  // a changed target invalidates the cached ids
  if (proj !== td.project || sec !== td.section) { td.projectId = null; td.sectionId = null; }
  td.project = proj; td.section = sec;
  tdPersist();
  renderTodoistSettings();
  toast('DO target saved');
}

function toggleAutoPush() { td.autoPush = !td.autoPush; tdPersist(); renderTodoistSettings(); }
function toggleEndpoint() {
  td.endpoint = td.endpoint === 'proxy' ? 'direct' : 'proxy';
  td.projectId = null; td.sectionId = null;
  tdPersist();
  renderTodoistSettings();
}

function renderTodoistSettings() {
  if (!$id('td-project')) return;
  $id('td-project').value = td.project;
  $id('td-section').value = td.section;
  $id('td-auto').textContent = td.autoPush ? 'on' : 'off';
  $id('td-endpoint').textContent = td.endpoint === 'proxy' ? 'proxy' : 'direct';
  $id('td-last').textContent = td.lastSync
    ? 'last sync ' + new Date(td.lastSync).toLocaleString('en-GB',
        { day:'numeric', month:'short', hour:'2-digit', minute:'2-digit' })
    : 'never synced';
  $id('td-file-warn').classList.toggle('hidden', location.protocol !== 'file:');
  // today's tasks
  const on = $id('td-today-on'); if (on) on.textContent = td.todayOn ? 'on' : 'off';
  const ov = $id('td-today-overdue'); if (ov) ov.textContent = td.todayOverdue ? 'on' : 'off';
  const bo = $id('td-blocks-on'); if (bo) bo.textContent = td.blocksOn ? 'on' : 'off';
  const bd = $id('td-blocks-done'); if (bd) bd.textContent = blocksDoneWin();
  const mo = $id('td-media-on'); if (mo) mo.textContent = td.mediaOn ? 'on' : 'off';
  const ml = $id('td-media-labels'); if (ml) ml.textContent = MEDIA_LABELS.map(l => '@' + l).join(' ') || 'none';
  const qo = $id('td-quick-on'); if (qo) qo.textContent = td.quickOn ? 'on' : 'off';
  /* Same rule as the token field and the today filter: refill it only when it
     holds nothing unsaved, or leaving the tab and coming back would wipe what
     was half typed. It commits straight to Config as you type (data-cfg). */
  const ql = $id('td-quick-label');
  if (ql && document.activeElement !== ql && ql.value.trim().replace(/^@/, '') !== QUICK_LABEL) ql.value = QUICK_LABEL;
  const qs = $id('td-quick-status');
  if (qs) {
    const q = tdQuick();
    qs.textContent = !td.quickOn ? 'off' : !QUICK_LABEL ? 'no label set'
      : q.fetched ? `${q.tasks.filter(t => !t.done).length} open · ${q.tasks.reduce((a, t) => a + (t.subs || []).length, 0)} subtasks · fetched ` +
                    new Date(q.fetched).toLocaleTimeString('en-GB', { hour:'2-digit', minute:'2-digit' })
      : 'not fetched yet';
  }
  const ho = $id('do-hist-on'); if (ho) ho.textContent = HISTORY.on === false ? 'off' : 'on';
  const hd = $id('do-hist-days');
  if (hd && document.activeElement !== hd) hd.value = HISTORY.days;
  const hs = $id('do-hist-status');
  if (hs) { const n = Object.keys(readStats().days).length;
            hs.textContent = n ? `${n} day${n === 1 ? '' : 's'} folded in` : 'nothing folded in yet — a day is added when it is swept'; }
  renderSectionOrder();
  const f = $id('td-today-filter');
  if (f && document.activeElement !== f && f.value === '') f.value = td.todayFilter || '';
  ttStatus();
}

// ── Today's tasks from Todoist ────────────────────────────────────────────────
/* A block under the routine cards listing what is due today in the projects
   and sections chosen in settings. Ticking one closes it in Todoist; unticking
   reopens it. The API never returns a completed task, so the day's list is
   cached in do_todoist_v1 with a done flag per task: a task closed here stays
   on the list, ticked, until midnight — which is what makes unticking possible
   at all. A task that comes back from the API is open over there, whatever we
   last did to it here, so the API's word wins on every refresh. */
const TT_STALE = 10 * 60 * 1000;
const TT_PRI = { 4:'p1', 3:'p2', 2:'p3' };     // Todoist: 4 is the most urgent

/* "project > section", one per line; the section is optional. ">" rather than
   "|" because the project names themselves carry a pipe ("04 | life"). */
function ttRules() {
  return String(td.todayFilter || '').split('\n').map(l => l.trim()).filter(Boolean).map(l => {
    const i = l.indexOf('>');
    return i < 0 ? { project:l, section:'' }
                 : { project:l.slice(0, i).trim(), section:l.slice(i + 1).trim() };
  });
}
function ttToday() {
  const today = tdLocalDate();
  if (!td.today || td.today.date !== today) td.today = { date:today, tasks:[], fetched:0, missing:[] };
  return td.today;
}
function ttStatus(msg) {
  const el = $id('td-today-status'); if (!el) return;
  if (msg) { el.textContent = msg; return; }
  if (!td.todayOn) { el.textContent = 'off'; return; }
  const t = ttToday();
  el.textContent = !ttRules().length ? 'no project chosen yet'
    : t.fetched ? `${t.tasks.length} task${t.tasks.length === 1 ? '' : 's'} today · fetched ` +
                  new Date(t.fetched).toLocaleTimeString('en-GB', { hour:'2-digit', minute:'2-digit' }) +
                  (t.missing && t.missing.length ? ' · not found: ' + t.missing.join(', ') : '')
    : 'not fetched yet';
}

/* ── Block tasks ──────────────────────────────────────────────────────────────
   Every open task due today that carries one of PLAN's block labels (@b1 @b2
   @b3 — Config plan.blocks), drawn as tiles in the label's own Todoist colour.
   Ticking closes the task and hands the name to LOG as a completed block for
   the day; unticking reopens it and takes it back. Same cache-per-day rule as
   the today list: a closed task stays, filled, until midnight. */
const TD_COLORS = Todoist.COLORS;   // the shared name → hex table (shell.js)
const blockLabels = () => (Config.get('plan.blocks') || []).map(s => String(s).trim().replace(/^@/, '')).filter(Boolean);
function tdBlocks() {
  const today = tdLocalDate();
  if (!td.blocks || td.blocks.date !== today) td.blocks = { date:today, tasks:[], fetched:0 };
  return td.blocks;
}
async function fetchBlocks(today) {
  const labels = await tdGetAll('/labels');
  Todoist.cacheLabels(labels);              // PLAN and the media tab read the same colours
  const colorOf = name => {
    const l = labels.find(x => tdName(x.name) === tdName(name));
    return (l && TD_COLORS[l.color]) || '#A78BFA';
  };
  const prev = tdBlocks(), got = [];
  const blockSet = new Set(blockLabels().map(tdName));
  const colors = {};                        // the block labels' own colours, for the "→ tomorrow" row
  for (const name of blockLabels()) {
    colors[name] = colorOf(name);
    const tasks = await tdGetAll('/tasks', { label: name });
    tasks.forEach(t => {
      if (tdDueDate(t) !== today) return;
      // the colour is the task's OTHER label — @curate, @home — the block label
      // only says which slot; a task with no other label takes the block's own
      const tl = Array.isArray(t.labels) ? t.labels.map(String) : [];
      const tag = tl.find(l => !blockSet.has(tdName(l))) || '';
      got.push({ id:String(t.id), content:String(t.content || ''), block:name, tag, labels:tl, color:colorOf(tag || name),
                 priority:+t.priority || 1, done:false });
    });
  }
  const seen = new Set(), next = [];
  got.forEach(t => { if (!seen.has(t.id)) { seen.add(t.id); next.push(t); } });
  prev.tasks.forEach(t => { if (t.done && !seen.has(t.id)) next.push(t); });   // closed here: keep, filled
  next.sort((a, b) => a.block.localeCompare(b.block) || a.content.localeCompare(b.content));
  td.blocks = { date:today, tasks:next, fetched:Date.now(), colors };
}

/* ── Blocks → tomorrow ────────────────────────────────────────────────────────
   "→ tomorrow" on the blocks head switches the tiles from tick to select: a
   row of the block labels (b1 b2 b3, each in its Todoist colour) appears under
   the head, you tap the tiles to move, then the slot they go into. Each one
   is rescheduled to tomorrow with that block label in place of its current
   one (its other labels kept), in Todoist, and leaves the list. Selection is
   not persisted — it is a gesture, not state. */
let bkMove = false;
const bkSel = new Set();
function toggleBlockMove() { bkMove = !bkMove; bkSel.clear(); renderBlocks(); }
function selectBlock(id) {
  const t = tdBlocks().tasks.find(x => x.id === id);
  if (!t || t.done) return;
  if (bkSel.has(id)) bkSel.delete(id); else bkSel.add(id);
  Prefs.tap(); renderBlocks();
}
async function moveBlocks(block) {
  if (tdBusy || !bkSel.size) return;
  const b = tdBlocks();
  const picked = b.tasks.filter(t => bkSel.has(t.id) && !t.done);
  if (!picked.length) return;
  const blockSet = new Set(blockLabels().map(tdName));
  tdBusy = true; renderTdButtons();
  let moved = 0, failed = 0;
  try {
    for (const t of picked) {
      const have = Array.isArray(t.labels) ? t.labels : [t.block, t.tag].filter(Boolean);
      const labels = have.filter(l => !blockSet.has(tdName(l))).concat(block);
      try { await tdFetch(`/tasks/${t.id}`, { method:'POST', body: JSON.stringify({ due_string:'tomorrow', labels }) }); t.moved = true; moved++; }
      catch { failed++; }
    }
    b.tasks = b.tasks.filter(t => !t.moved);
    bkSel.clear();
    if (!b.tasks.some(t => !t.done)) bkMove = false;   // nothing left to move: back to ticking
    tdPersist(); renderBlocks(); renderToday();
    if (window.LOG && LOG.renderPlanned) LOG.renderPlanned();
    toast(failed ? `${moved} moved · ${failed} failed` : `${moved} → tomorrow @${block}`);
  } finally { tdBusy = false; renderTdButtons(); }
}
function renderBlocks() {
  const box = $id('td-blocks'); if (!box) return;
  const b = tdBlocks();
  // the earlier days stand on their own: on a morning with nothing fetched yet,
  // a week's window is still an answer to "show done"
  const earlier = td.blocksOn ? earlierBlocks() : [];
  const show = td.blocksOn && (b.tasks.length > 0 || earlier.length > 0) && onFirstTab();
  box.classList.toggle('hidden', !show);
  // hidden is also emptied: a stale tile in a hidden box is still a tile to anything that counts them
  if (!show) { box.innerHTML = ''; bkMove = false; bkSel.clear(); return; }
  const open = b.tasks.filter(x => !x.done).length;
  const shown = td.blocksHideDone ? b.tasks.filter(x => !x.done) : b.tasks;
  if (!open) { bkMove = false; bkSel.clear(); }
  const colors = b.colors || {};
  box.innerHTML = `<div class="tt-head"><span>blocks<em>${open} open</em></span><span class="tt-acts">
      ${open ? `<button class="tt-refresh${bkMove ? ' tt-defer' : ''}" onclick="DO.toggleBlockMove()">${bkMove ? 'cancel' : '→ tomorrow'}</button>` : ''}
      <button class="tt-refresh" onclick="DO.toggleBlocksHideDone()">${td.blocksHideDone ? 'show done' : 'hide done'}</button></span></div>
    ${bkMove ? `<div class="bk-move">${blockLabels().map(l =>
        `<button class="bk-move-b" style="--bk-c:${esc(colors[l] || Todoist.labelColor(l) || '#A78BFA')}" onclick="DO.moveBlocks('${esc(l)}')"${bkSel.size ? '' : ' disabled'}>${esc(l)}</button>`).join('')}
      <span class="bk-move-hint">${bkSel.size ? `${bkSel.size} → tomorrow as` : 'tap a block, then its slot'}</span></div>` : ''}
    ${shown.length || earlier.length ? '' : '<div class="tt-empty">all done</div>'}
    <div class="bk-grid">${shown.map(x => `<button class="bk${x.done ? ' done' : ''}${bkMove && bkSel.has(x.id) ? ' sel' : ''}" style="--bk-c:${esc(x.color)}" onclick="DO.${bkMove ? 'selectBlock' : 'toggleBlockTask'}('${esc(x.id)}')" aria-pressed="${bkMove ? bkSel.has(x.id) : x.done}">
      <span class="bk-tag">@${esc(x.block)}${x.tag ? ` · ${esc(x.tag)}` : ''}</span><span class="bk-name">${esc(x.content)}</span>
      <span class="bk-check"><svg viewBox="0 0 10 10" fill="none"><path d="M1.5 5L4 7.5L8.5 2.5" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"/></svg></span>
    </button>`).join('')}</div>
    ${earlier.length ? `<div class="bk-past"><div class="bk-past-h">earlier this ${esc(blocksDoneWin())}</div>${
      earlier.map(d => `<div class="bk-past-d"><span class="bk-past-date">${esc(Prefs.formatDate(d.date, 'short'))}</span><span class="bk-past-names">${
        d.blocks.map(n => esc(n)).join(' · ')}</span></div>`).join('')}</div>` : ''}`;
}
async function toggleBlockTask(id) {
  const b = tdBlocks();
  const task = b.tasks.find(x => x.id === id); if (!task) return;
  const was = task.done;
  task.done = !was; tdPersist(); renderBlocks(); renderToday(); Prefs.tap();
  if (window.LOG && LOG.setBlock) LOG.setBlock(task.content, task.done);
  try {
    await tdFetch(`/tasks/${id}/${was ? 'reopen' : 'close'}`, { method:'POST' });
    toast((was ? '↺ reopened' : '✓ closed') + ' in todoist');
  } catch (e) {
    task.done = was; tdPersist(); renderBlocks(); renderToday();
    if (window.LOG && LOG.setBlock) LOG.setBlock(task.content, task.done);
    toast('todoist: ' + e.message);
  }
}
function blockTasks() { return td.blocksOn ? tdBlocks().tasks.slice() : []; }
function toggleBlocksHideDone() { td.blocksHideDone = !td.blocksHideDone; tdPersist(); renderBlocks(); }

/* ── How far back "show done" reaches ──────────────────────────────────────────
   "Show done" used to mean today's finished blocks and nothing else, because
   today is all DO holds: `td.blocks` is keyed by date and starts empty every
   morning. But the names do survive — DO's tick calls `LOG.setBlock`, which
   files them under the day in LOG's own record — so a week or a month of them is
   a read away, and "what did I get through this week" is a better question than
   "what did I get through since breakfast".

   The window is a setting rather than a fourth button on the head: it is a
   preference about what the button *means*, not another thing to press. `day`
   is the default and is exactly the old behaviour.

   The earlier days are names, not tasks. They carry no id, no colour and no
   Todoist state — those were today's, and today's are gone — so they are drawn
   as a quiet list under a date rather than as tiles you could try to untick.
   Reopening a block finished last Tuesday is Todoist's job, not DO's. */
const DONE_WINDOWS = ['day', 'week', 'month'];
const DONE_DAYS = { day:0, week:6, month:29 };
function blocksDoneWin() {
  const w = String(td.blocksDone || 'day');
  return DONE_WINDOWS.includes(w) ? w : 'day';
}
function cycleBlocksDone() {
  td.blocksDone = DONE_WINDOWS[(DONE_WINDOWS.indexOf(blocksDoneWin()) + 1) % DONE_WINDOWS.length];
  tdPersist(); renderTodoistSettings(); renderBlocks(); Prefs.tap();
}
function earlierBlocks() {
  const days = DONE_DAYS[blocksDoneWin()];
  if (!days || td.blocksHideDone) return [];
  return (window.LOG && LOG.blocksBefore) ? LOG.blocksBefore(days) : [];
}

/* ── Media ────────────────────────────────────────────────────────────────────
   The media tab: every open task carrying one of do.mediaLabels (@movie @show
   @podcast @music), whatever its date — a watchlist, not a day's list — drawn
   as tiles three across, grouped under the label in the label's own Todoist
   colour. A task's other label (@album / @set / @track under @music) is a small
   chip on the tile. Ticking closes the task and writes the title into today's
   LOG record as media; unticking reopens it and takes it back. A closed task
   stays, ticked, until midnight, same as the block tiles. */
function tdMedia() {
  const today = tdLocalDate();
  if (!td.media || !Array.isArray(td.media.tasks)) td.media = { date:today, tasks:[], fetched:0 };
  else if (td.media.date !== today) td.media = { date:today, tasks:td.media.tasks.filter(t => !t.done), fetched:td.media.fetched || 0 };
  return td.media;
}
async function fetchMedia() {
  const labels = await tdGetAll('/labels');
  Todoist.cacheLabels(labels);
  const colorOf = name => {
    const l = labels.find(x => tdName(x.name) === tdName(name));
    return (l && TD_COLORS[l.color]) || '#A78BFA';
  };
  const prev = tdMedia(), got = [];
  const mediaSet = new Set(MEDIA_LABELS.map(tdName));
  for (const name of MEDIA_LABELS) {
    const tasks = await tdGetAll('/tasks', { label: name });
    tasks.forEach(t => {
      const tl = Array.isArray(t.labels) ? t.labels.map(String) : [];
      // the sub-label is whatever else the task carries — @album, @set, @track — the first one
      const sub = tl.find(l => !mediaSet.has(tdName(l))) || '';
      got.push({ id:String(t.id), content:String(t.content || ''), kind:name, sub, color:colorOf(name),
                 priority:+t.priority || 1, done:false });
    });
  }
  const seen = new Set(), next = [];
  got.forEach(t => { if (!seen.has(t.id)) { seen.add(t.id); next.push(t); } });
  prev.tasks.forEach(t => { if (t.done && !seen.has(t.id)) next.push(t); });   // closed here today: keep, ticked
  const order = k => { const i = MEDIA_LABELS.indexOf(k); return i < 0 ? 99 : i; };
  next.sort((a, b) => order(a.kind) - order(b.kind) || a.content.localeCompare(b.content));
  td.media = { date:tdLocalDate(), tasks:next, fetched:Date.now() };
}
/* ── Drawing the list ─────────────────────────────────────────────────────────
   2.8 drew media as the block tiles: three across, a title inside a 64px box.
   That shape is right for a block — a block is a word ("mixing") standing for
   an hour of work — and wrong for this, because the thing on a media tile is a
   *title*, and a title is long. "The Lord of the Rings: The Fellowship of the
   Ring" in a third of a phone width is four lines of 11px type or an ellipsis,
   and either way the list stopped being readable at exactly the length a
   backlog reaches.

   So: one row per title, full width, the label's colour as a rail down its
   left edge, the kind and the second label as a meta line under the name, and
   the tick on the right where every other tickable row in ROOT keeps it. The
   name gets two lines before it gives up, which covers all but the silliest.

   The three controls above it are what a backlog actually needs, and all three
   are drawn from data that was already being fetched and thrown away:

     kind chips   the list narrowed to @movie, with the open count on each —
                  "what films have I got" was previously a scroll.
     find         a substring match on the title. Only once the list is long
                  enough to need it; on eight items it is furniture.
     sort         by kind (the shipped order, grouped), by name, or by
                  priority — which was fetched from Todoist since 2.8 and had
                  never been shown anywhere.

   And `surprise me`, which is the honest answer to what a watchlist is for:
   the problem with a backlog of forty films is never finding one, it is
   choosing one. It picks from what is filtered and open, so "pick me a
   podcast" is two taps. */
let mediaQ = '';                        // the find box — in memory, never persisted
/* A stored filter can outlive the label it names — the media labels are Config,
   editable under settings → do. A narrowing to a label that is gone would hide
   the whole list behind a chip that is no longer drawn, so it falls back to
   "all" rather than to an empty screen with no way out of it. */
const mediaKind = () => {
  const k = String(td.mediaKind || '');
  return MEDIA_LABELS.includes(k) ? k : '';
};
const mediaSortKey = () => (['kind','name','pri'].includes(td.mediaSort) ? td.mediaSort : 'kind');
const SORT_LABEL = { kind:'by kind', name:'a → z', pri:'by priority' };

/* What the list is showing, after every filter: the hide-done switch, the kind
   chips and the find box. One function, because the head's counts, the rows
   and `surprise me` must never disagree about what is on screen. */
function mediaShown() {
  const q = mediaQ.trim().toLowerCase();
  const kind = mediaKind();
  return tdMedia().tasks.filter(x =>
    (!td.mediaHideDone || !x.done) &&
    (!kind || x.kind === kind) &&
    (!q || x.content.toLowerCase().includes(q)));
}

function mediaRow(x) {
  /* Todoist counts priority upwards (4 is urgent), the UI counts downwards
     (p1 is urgent). 1 is "no priority" and is not drawn — a chip on every row
     is a chip that says nothing. */
  const p = 5 - (+x.priority || 1);
  const meta = [`@${esc(x.kind)}`, x.sub ? esc(x.sub) : ''].filter(Boolean)
    .map(s => `<i>${s}</i>`).join('');
  return `<button class="md-row${x.done ? ' done' : ''}" style="--bk-c:${esc(x.color)}"
            data-md-id="${esc(x.id)}" onclick="DO.toggleMediaTask('${esc(x.id)}')" aria-pressed="${x.done}">
      <span class="md-rail" aria-hidden="true"></span>
      <span class="md-body">
        <span class="md-name">${esc(x.content)}</span>
        <span class="md-meta">${meta}${p <= 3 ? `<i class="md-pri p${p}">p${p}</i>` : ''}</span>
      </span>
      <span class="md-check" aria-hidden="true"><svg viewBox="0 0 10 10" fill="none"><path d="M1.5 5L4 7.5L8.5 2.5" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"/></svg></span>
    </button>`;
}

/* The rows alone. The find box lives in the head and re-rendering the whole
   section on every keystroke would take the focus and the caret with it, so
   typing repaints this and nothing else. */
function renderMediaList() {
  const list = $id('td-media-list'); if (!list) return;
  const m = tdMedia(), shown = mediaShown();
  const when = m.fetched ? new Date(m.fetched).toLocaleTimeString('en-GB', { hour:'2-digit', minute:'2-digit' }) : null;
  if (!shown.length) {
    const why = !MEDIA_LABELS.length ? 'no media labels set — see settings → do'
              : !m.tasks.length ? (when ? 'nothing labelled in todoist' : 'tap refresh to fetch the list')
              : mediaQ.trim() ? `nothing matching “${esc(mediaQ.trim())}”`
              : mediaKind() ? `nothing left under @${esc(mediaKind())}`
              : 'all done';
    list.innerHTML = `<div class="tt-empty">${why}</div>`;
    return;
  }
  if (mediaSortKey() === 'kind') {
    // grouped, in the order the labels are written in Config — the shipped shape
    const groups = MEDIA_LABELS.map(kind => ({ kind, tasks: shown.filter(x => x.kind === kind) }))
      .filter(g => g.tasks.length);
    list.innerHTML = groups.map(g => `<div class="md-group" style="--bk-c:${esc(g.tasks[0].color)}">
      <div class="md-lbl"><span>@${esc(g.kind)}</span><em>${g.tasks.filter(x => !x.done).length}</em></div>
      ${g.tasks.map(mediaRow).join('')}</div>`).join('');
    return;
  }
  const rows = shown.slice().sort(mediaSortKey() === 'name'
    ? (a, b) => a.content.localeCompare(b.content)
    // urgent first, then alphabetical inside a priority — a stable order matters
    // more here than anywhere, because this list is read by scanning it
    : (a, b) => (+b.priority || 1) - (+a.priority || 1) || a.content.localeCompare(b.content));
  list.innerHTML = rows.map(mediaRow).join('');
}

function renderMedia() {
  const box = $id('td-media'); if (!box) return;
  const show = td.mediaOn && onMediaTab();
  box.classList.toggle('hidden', !show);
  if (!show) return;
  const m = tdMedia();
  const open = m.tasks.filter(x => !x.done).length;
  const when = m.fetched ? new Date(m.fetched).toLocaleTimeString('en-GB', { hour:'2-digit', minute:'2-digit' }) : null;
  const kind = mediaKind();
  // the open count under each label, before the find box narrows anything —
  // a chip's number is what tapping it would show, not what is showing now
  const countOf = k => m.tasks.filter(x => !x.done && (!k || x.kind === k)).length;
  const chip = (k, label) => `<button class="md-chip${kind === k ? ' on' : ''}"${
      k ? ` style="--bk-c:${esc((m.tasks.find(x => x.kind === k) || {}).color || 'var(--mu)')}"` : ''}
      onclick="DO.setMediaKind('${esc(k)}')" aria-pressed="${kind === k}">${esc(label)}<em>${countOf(k)}</em></button>`;
  // the find box earns its place once scrolling is the alternative
  const findable = m.tasks.length >= 8;
  box.innerHTML = `<div class="tt-head"><span>media<em>${open} open</em></span>
      <span class="tt-acts">
      ${open ? '<button class="tt-refresh tt-defer" onclick="DO.mediaPick()">surprise me</button>' : ''}
      <button class="tt-refresh" onclick="DO.toggleMediaHideDone()">${td.mediaHideDone ? 'show done' : 'hide done'}</button>
      <button class="tt-refresh" data-td-btn="refresh" data-td-busy="…" onclick="DO.refreshToday()">refresh</button></span></div>
    ${m.tasks.length ? `<div class="md-bar">
      <div class="md-chips">${chip('', 'all')}${MEDIA_LABELS.filter(k => m.tasks.some(x => x.kind === k)).map(k => chip(k, '@' + k)).join('')}</div>
      <div class="md-tools">
        ${findable ? `<input class="md-find" id="td-media-find" type="search" inputmode="search"
             autocomplete="off" autocapitalize="off" spellcheck="false"
             placeholder="find a title" aria-label="find a title" value="${esc(mediaQ)}"
             oninput="DO.setMediaQuery(this.value)">` : ''}
        <button class="md-sort" onclick="DO.cycleMediaSort()">${SORT_LABEL[mediaSortKey()]}</button>
      </div>
    </div>` : ''}
    <div class="md-list" id="td-media-list"></div>
    <div class="tt-status">${when ? 'todoist fetched ' + when : ''}</div>`;
  renderMediaList();
}

function setMediaKind(k) {
  td.mediaKind = mediaKind() === k ? '' : k;    // tapping the live chip clears it
  tdPersist(); Prefs.tap(); renderMedia();
}
function setMediaQuery(v) { mediaQ = String(v == null ? '' : v); renderMediaList(); }
function cycleMediaSort() {
  const order = ['kind', 'name', 'pri'];
  td.mediaSort = order[(order.indexOf(mediaSortKey()) + 1) % order.length];
  tdPersist(); Prefs.tap(); renderMedia();
}

/* One open title from whatever is filtered, chosen at random and shown rather
   than acted on: it names the pick and lights its row, and closing it is still
   the same tick as any other row. Choosing *for* you and closing it would be a
   different app. */
function mediaPick() {
  const pool = mediaShown().filter(x => !x.done);
  if (!pool.length) { toast('nothing open to pick from'); return; }
  const x = pool[Math.floor(Math.random() * pool.length)];
  Prefs.tap();
  toast('→ ' + x.content);
  /* A Todoist id is digits, so the attribute selector is safe as written —
     but window.CSS is not there in every environment the harness runs in, and
     finding the row is not worth throwing over. */
  const rows = document.querySelectorAll('.ns-do .md-row');
  rows.forEach(r => r.classList.remove('picked'));
  const row = [...rows].find(r => r.dataset.mdId === String(x.id));
  if (!row) return;
  row.classList.add('picked');
  try { row.scrollIntoView({ block:'center', behavior:'smooth' }); } catch {}
}
async function toggleMediaTask(id) {
  const m = tdMedia();
  const task = m.tasks.find(x => x.id === id); if (!task) return;
  const was = task.done;
  task.done = !was; tdPersist(); renderMedia(); Prefs.tap();
  if (window.LOG && LOG.setMedia) LOG.setMedia(task, task.done);
  try {
    await tdFetch(`/tasks/${id}/${was ? 'reopen' : 'close'}`, { method:'POST' });
    toast((was ? '↺ reopened' : '✓ closed') + ' in todoist');
  } catch (e) {
    task.done = was; tdPersist(); renderMedia();
    if (window.LOG && LOG.setMedia) LOG.setMedia(task, task.done);
    toast('todoist: ' + e.message);
  }
}
function mediaTasks() { return td.mediaOn ? tdMedia().tasks.slice() : []; }
function toggleMediaHideDone() { td.mediaHideDone = !td.mediaHideDone; tdPersist(); renderMedia(); }
function toggleMedia() {
  td.mediaOn = !td.mediaOn; tdPersist(); renderTodoistSettings(); renderTabs(); renderHome();
  if (td.mediaOn && !tdMedia().fetched) refreshToday(true);
}

/* ── Quick tasks ──────────────────────────────────────────────────────────────
   Every open task carrying `do.quickLabel` (@quick), drawn as cards under the
   routine cards and read the same way: a name, how much of it is done, a bar.
   Two shapes, because a quick task is one of two things:

     no subtasks    one card, and the whole card is the tick. 0 / 1.
     subtasks       the parent names the card and its subtasks are the rows
                    inside it, each its own tick. The parent is closed for you
                    when the last row is ticked (Todoist does not do it), and
                    reopened if one is unticked again — which is what makes the
                    card behave like a routine rather than like a list that has
                    to be finished twice.

   Subtasks do not carry the label themselves, and Todoist has no "children of"
   filter worth relying on, so they are found by fetching each distinct project
   the quick tasks live in — one call, nearly always, since they live together.

   Cache-per-day rule, like the media tiles: a task closed here stays on the
   list, ticked, until midnight, and that is the only way unticking can exist. */
function tdQuick() {
  const today = tdLocalDate();
  if (!td.quick || !Array.isArray(td.quick.tasks)) td.quick = { date:today, tasks:[], fetched:0 };
  else if (td.quick.date !== today) td.quick = { date:today, tasks:td.quick.tasks.filter(t => !t.done), fetched:td.quick.fetched || 0 };
  return td.quick;
}
async function fetchQuick() {
  if (!QUICK_LABEL) return;
  const labels = await tdGetAll('/labels');
  Todoist.cacheLabels(labels);
  const lab = labels.find(x => tdName(x.name) === tdName(QUICK_LABEL));
  const color = (lab && TD_COLORS[lab.color]) || '#A78BFA';
  /* Every label's colour, so a card can wear a colour that is not @quick's.
     @quick is the *filter* — it is on every card by definition, so colouring
     by it says nothing. Whatever else the task carries is what distinguishes
     it, and that is what the card takes its accent from. A task with no second
     label falls back to @quick's own colour. */
  const hex = {};
  labels.forEach(l => { const c = TD_COLORS[l && l.color]; if (c && l.name) hex[tdName(l.name)] = c; });
  const accentOf = t => {
    const other = (t.labels || []).map(String).find(n => tdName(n) !== tdName(QUICK_LABEL));
    return other ? { color: hex[tdName(other)] || color, tag: other } : { color, tag: QUICK_LABEL };
  };
  const parents = await tdGetAll('/tasks', { label: QUICK_LABEL });

  /* The children: every project a quick task sits in, fetched once. A task in
     the inbox has a project id like any other, so there is no special case. */
  const kids = {};
  const projectIds = [...new Set(parents.map(t => t.project_id).filter(Boolean).map(String))];
  for (const pid of projectIds) {
    const all = await tdGetAll('/tasks', { project_id: pid });
    all.forEach(t => {
      const parent = t.parent_id == null ? null : String(t.parent_id);
      if (!parent) return;
      (kids[parent] = kids[parent] || []).push(t);
    });
  }

  const prev = tdQuick(), seen = new Set(), next = [];
  parents.forEach(t => {
    const id = String(t.id);
    if (seen.has(id)) return;
    seen.add(id);
    const was = prev.tasks.find(x => x.id === id);
    const subs = (kids[id] || []).map(s => {
      const sid = String(s.id);
      const oldSub = was && (was.subs || []).find(x => x.id === sid);
      return { id:sid, content:String(s.content || ''), done: oldSub ? !!oldSub.done : false };
    });
    /* A subtask closed here today is not returned by the API any more, so it
       is carried over rather than dropped — otherwise a card would shrink as
       you tick it and "3 / 5" would never be true. */
    if (was) (was.subs || []).forEach(x => { if (x.done && !subs.some(y => y.id === x.id)) subs.push(x); });
    const acc = accentOf(t);
    next.push({ id, content:String(t.content || ''), color: acc.color, tag: acc.tag, priority:+t.priority || 1,
                projectId: t.project_id == null ? null : String(t.project_id),
                subs, done: was ? !!was.done : false });
  });
  // closed here today and no longer returned: keep it, ticked, so it can be unticked
  prev.tasks.forEach(t => { if (t.done && !seen.has(t.id)) next.push(t); });
  next.sort((a, b) => (b.priority - a.priority) || a.content.localeCompare(b.content));
  td.quick = { date:tdLocalDate(), tasks:next, fetched:Date.now(), color };
}

const quickStat = t => {
  const subs = t.subs || [];
  if (!subs.length) return { done: t.done ? 1 : 0, total: 1 };
  return { done: subs.filter(s => s.done).length, total: subs.length };
};

function renderQuick() {
  const box = $id('td-quick'); if (!box) return;
  const q = tdQuick();
  const show = td.quickOn && q.tasks.length > 0 && onFirstTab();
  box.classList.toggle('hidden', !show);
  // hidden is also emptied: a stale card in a hidden box still counts to anything counting cards
  if (!show) { box.innerHTML = ''; return; }
  const open = q.tasks.filter(t => !t.done).length;
  const shown = td.quickHideDone ? q.tasks.filter(t => !t.done) : q.tasks;
  const when = q.fetched ? new Date(q.fetched).toLocaleTimeString('en-GB', { hour:'2-digit', minute:'2-digit' }) : null;
  const card = t => {
    const st = quickStat(t), pct = st.total ? Math.round(st.done / st.total * 100) : 0;
    const subs = t.subs || [];
    return `<div class="qk${t.done ? ' done' : ''}${subs.length ? ' has-sub' : ''}" style="--bk-c:${esc(t.color || '#A78BFA')}">
      <button class="qk-head" onclick="DO.toggleQuickTask('${esc(t.id)}')" aria-pressed="${t.done}">
        <span class="qk-check"><svg viewBox="0 0 10 10" fill="none"><path d="M1.5 5L4 7.5L8.5 2.5" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"/></svg></span>
        <span class="qk-body"><span class="qk-name">${esc(t.content)}</span>
          <span class="qk-sub">${subs.length ? `${st.done} / ${st.total} done` : '@' + esc(t.tag || QUICK_LABEL)}</span></span>
      </button>
      ${subs.length ? `<div class="qk-bar"><div class="qk-bar-fill" style="width:${pct}%;background:${barColor(pct)}"></div></div>
      <div class="qk-list">${subs.map(s => `<button class="qk-item${s.done ? ' checked' : ''}"
          onclick="DO.toggleQuickSub('${esc(t.id)}','${esc(s.id)}')" aria-pressed="${s.done}">
          <span>${esc(s.content)}</span>
          <span class="qk-tick"><svg viewBox="0 0 10 10" fill="none"><path d="M1.5 5L4 7.5L8.5 2.5" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"/></svg></span>
        </button>`).join('')}</div>` : ''}
    </div>`;
  };
  /* The title is a switch. Tapping "quick" folds the cards away and leaves the
     head — so the count is still there, and so is the way back. A section you
     have finished with should be able to get out of the way without being
     switched off in settings, which is a different and more permanent thing. */
  const done = q.tasks.length - open;
  const fold = !!td.quickFold;
  box.classList.toggle('folded', fold);
  box.innerHTML = `<div class="tt-head"><button class="tt-fold" onclick="DO.toggleQuickFold()"
        aria-expanded="${!fold}" aria-controls="td-quick-body">quick<em>${open} open</em>
        <svg class="tt-caret" aria-hidden="true"><use href="#ico-chev-r"/></svg></button><span class="tt-acts">
      ${fold ? '' : `${done ? `<button class="tt-refresh tt-clear" onclick="DO.clearQuickDone()">clear ${done}</button>` : ''}
      <button class="tt-refresh" onclick="DO.toggleQuickHideDone()">${td.quickHideDone ? 'show done' : 'hide done'}</button>
      <button class="tt-refresh" data-td-btn="refresh" data-td-busy="…" onclick="DO.refreshToday()">refresh</button>`}</span></div>
    <div id="td-quick-body"${fold ? ' class="hidden"' : ''}>
      ${shown.length ? `<div class="qk-grid">${shown.map(card).join('')}</div>` : '<div class="tt-empty">all done</div>'}
      <div class="tt-status">${when ? 'todoist fetched ' + when : ''}</div>
    </div>`;
}

function toggleQuickFold() {
  td.quickFold = !td.quickFold;
  tdPersist(); renderQuick(); Prefs.tap();
}

/* ── Clearing what is finished ─────────────────────────────────────────────────
   A quick task closed here stays on the list, ticked, until midnight — that is
   the only way unticking it can exist (the API never returns a closed task
   again). Which is right for the minute after you tick it and wrong for the
   four hours after that, where it is a finished card taking up the screen.
   This drops the ticked cards early, the way PLAN's sent list can be cleared:
   local only, nothing is reopened, and the next refresh does not bring them
   back because Todoist has them closed. */
function clearQuickDone() {
  const q = tdQuick();
  const done = q.tasks.filter(t => t.done).length;
  if (!done) { toast('nothing finished yet'); return; }
  Shell.confirm(`Clear ${done} finished card${done === 1 ? '' : 's'}? They stay closed in Todoist.`, () => {
    q.tasks = q.tasks.filter(t => !t.done);
    tdPersist(); renderQuick();
    toast(`${done} cleared`);
  });
}

/* Optimistic, like every other tick here: the card flips at once and a failed
   request puts it back. A parent with subtasks cannot be ticked directly —
   its rows are the tick — so the head only closes a childless one. */
async function toggleQuickTask(id) {
  const q = tdQuick();
  const t = q.tasks.find(x => x.id === id); if (!t) return;
  if ((t.subs || []).length) { toast('tick its subtasks'); return; }
  const was = t.done;
  t.done = !was; tdPersist(); renderQuick(); Prefs.tap();
  try {
    await tdFetch(`/tasks/${id}/${was ? 'reopen' : 'close'}`, { method:'POST' });
    toast((was ? '↺ reopened' : '✓ closed') + ' in todoist');
  } catch (e) {
    t.done = was; tdPersist(); renderQuick();
    toast('todoist: ' + e.message);
  }
}

/* Ticking the last subtask closes the parent too, and unticking one reopens
   it: Todoist leaves a parent open under finished children, which would mean
   finishing the same quick task twice. */
async function toggleQuickSub(parentId, subId) {
  const q = tdQuick();
  const t = q.tasks.find(x => x.id === parentId); if (!t) return;
  const s = (t.subs || []).find(x => x.id === subId); if (!s) return;
  const was = s.done;
  s.done = !was;
  const all = t.subs.every(x => x.done);
  const parentWas = t.done;
  t.done = all;
  tdPersist(); renderQuick(); Prefs.tap();
  try {
    await tdFetch(`/tasks/${subId}/${was ? 'reopen' : 'close'}`, { method:'POST' });
    if (t.done !== parentWas) {
      await tdFetch(`/tasks/${parentId}/${t.done ? 'close' : 'reopen'}`, { method:'POST' });
      toast(t.done ? '✓ ' + t.content + ' closed in todoist' : '↺ reopened in todoist');
    }
  } catch (e) {
    s.done = was; t.done = parentWas; tdPersist(); renderQuick();
    toast('todoist: ' + e.message);
  }
}
function quickTasks() { return td.quickOn ? tdQuick().tasks.slice() : []; }
function toggleQuickHideDone() { td.quickHideDone = !td.quickHideDone; tdPersist(); renderQuick(); }
function toggleQuick() {
  td.quickOn = !td.quickOn; tdPersist(); renderTodoistSettings(); renderHome();
  if (td.quickOn && !tdQuick().fetched) refreshToday(true);
}

/* Progress bars run from the foreground colour at nothing done to green at
   everything done — a glance says how far along a list is, not just whether
   it is finished. The foreground rather than literal white so the bar is
   still visible on a light theme's white card. */
const barColor = pct => `color-mix(in srgb, var(--gr) ${Math.max(0, Math.min(100, Math.round(pct)))}%, var(--tx))`;
function toggleBlocks() {
  td.blocksOn = !td.blocksOn; tdPersist(); renderTodoistSettings(); renderBlocks(); renderToday();
  if (td.blocksOn && !tdBlocks().fetched) refreshToday(true);
}

async function refreshToday(quiet) {
  if (tdBusy) return;
  const wantToday = td.todayOn && ttRules().length > 0;
  const wantBlocks = td.blocksOn && blockLabels().length > 0;
  const wantMedia = td.mediaOn && MEDIA_LABELS.length > 0;
  const wantQuick = td.quickOn && !!QUICK_LABEL;
  if (!wantToday && !wantBlocks && !wantMedia && !wantQuick) {
    if (!quiet && td.todayOn) { toast('choose a project under settings → do'); Shell.settings('do'); }
    return;
  }
  if (!Creds.token()) { if (!quiet) { toast('add a Todoist key in settings'); Shell.settings('data'); } return; }
  tdBusy = true; renderTdButtons();
  const today = tdLocalDate();
  try {
    if (wantToday) await fetchTodayTasks(today);
    if (wantBlocks) await fetchBlocks(today);
    if (wantMedia) await fetchMedia();
    if (wantQuick) await fetchQuick();
    tdPersist();
    renderToday(); renderBlocks(); renderQuick(); renderMedia(); ttStatus();
    if (window.LOG && LOG.renderPlanned) LOG.renderPlanned();
    const open = todayRows().filter(t => !t.done).length + (wantBlocks ? tdBlocks().tasks.filter(t => !t.done).length : 0);
    if (!quiet) toast(open ? `${open} task${open === 1 ? '' : 's'} due today` : 'nothing due today');
  } catch (e) {
    if (!quiet) toast('todoist: ' + e.message);
    ttStatus(e.message);
    const box = $id('td-today');
    const s = box && box.querySelector('.tt-status'); if (s) s.textContent = e.message;
  } finally { tdBusy = false; renderTdButtons(); }
}

async function fetchTodayTasks(today) {
  const rules = ttRules();
  {
    const projects = await tdGetAll('/projects');
    const got = [], missing = [];
    for (const r of rules) {
      const proj = projects.find(p => tdName(p.name) === tdName(r.project));
      if (!proj) { missing.push(r.project); continue; }
      const params = { project_id: proj.id };
      // the project's sections, always: every row names its section, in the project's colour
      const secs = await tdGetAll('/sections', { project_id: proj.id });
      const secById = Object.fromEntries(secs.map(s => [String(s.id), s.name]));
      if (r.section) {
        const sec = secs.find(s => tdName(s.name) === tdName(r.section));
        if (!sec) { missing.push(r.project + ' > ' + r.section); continue; }
        params.section_id = sec.id;
      }
      const projectColor = TD_COLORS[proj.color] || '';
      const tasks = await tdGetAll('/tasks', params);
      tasks.forEach(t => {
        const due = tdDueDate(t);
        if (!due || due > today) return;
        if (due < today && !td.todayOverdue) return;
        const section = (params.section_id && secById[String(params.section_id)]) || secById[String(t.section_id)] || '';
        got.push({ id:String(t.id), content:String(t.content || ''), labels:Array.isArray(t.labels) ? t.labels.map(String) : [],
                   priority:+t.priority || 1, due, project:proj.name, projectColor, section, done:false });
      });
    }
    const prev = ttToday();
    const seen = new Set();
    const next = [];
    got.forEach(t => { if (!seen.has(t.id)) { seen.add(t.id); next.push(t); } });
    // closed here today and no longer returned: keep it, ticked, so it can be unticked
    prev.tasks.forEach(t => { if (t.done && !seen.has(t.id)) next.push(t); });
    next.sort((a, b) => (a.done - b.done) || (a.due < b.due ? -1 : a.due > b.due ? 1 : 0) ||
                        (b.priority - a.priority) || a.content.localeCompare(b.content));
    td.today = { date:today, tasks:next, fetched:Date.now(), missing };
  }
}

/* The rows are two sources in one list: the plants TEND says are due today
   (drawn from TEND directly, so they show whether or not they were pushed to
   Todoist) and the tasks fetched from the chosen projects. A task TEND pushed
   is dropped from the fetched set by id so it is never listed twice. */
function plantRows() {
  return (window.TEND && TEND.showOnDo && TEND.showOnDo()) ? TEND.todayList().map(x => ({
    id:x.id, content:x.content, labels:x.labels, priority:x.priority, due:x.due, section:'',
    done:x.done, glyph:x.glyph, src:'tend' })) : [];
}
/* The today list and the blocks section are two questions asked of Todoist, and
   a task due today carrying @b1 answered both — so it was drawn twice, counted
   twice in the badge, and could be ticked in one place while the other still
   showed it open. The blocks section is the more specific of the two and it
   already has the tile, the colour and the slot, so the block-labelled tasks
   come out of the list here. Same shape as the TEND dedup beside it: one source
   keeps the row, the other drops it, and neither fetch changes. Switching "show
   block tasks" off hands them straight back to the list rather than hiding them
   altogether. */
function todayRows() {
  const pushed = window.TEND && TEND.pushedIds ? TEND.pushedIds() : new Set();
  const blocked = td.blocksOn ? new Set(blockLabels().map(tdName)) : new Set();
  const isBlock = t => blocked.size > 0 &&
    (Array.isArray(t.labels) ? t.labels : []).some(l => blocked.has(tdName(l)));
  const api = td.todayOn ? ttToday().tasks.filter(x => !pushed.has(String(x.id)) && !isBlock(x)) : [];
  return plantRows().concat(api);
}
function openCount() { return todayRows().filter(x => !x.done).length; }

function renderToday() {
  const box = $id('td-today'); if (!box) return;
  const rowsData = todayRows();
  const open = rowsData.filter(x => !x.done).length;
  // the tab badge and the date line count whatever is still open, wherever it came from
  const total = open + (td.blocksOn ? tdBlocks().tasks.filter(x => !x.done).length : 0);
  if (window.Shell && Shell.badge) Shell.badge('do', total);
  const cnt = $id('today-count'); if (cnt) cnt.textContent = total ? `· ${total} to do` : '';
  const show = (td.todayOn || rowsData.length > 0) && onFirstTab();
  box.classList.toggle('hidden', !show);
  if (!show) return;
  const today = tdLocalDate();
  const t = ttToday();
  const rows = rowsData.map(x => {
    const pri = TT_PRI[x.priority];
    const locked = ttMove && (x.src === 'tend' || x.done);
    return `<button class="tt-row${x.done ? ' done' : ''}${x.due < today && !x.done ? ' late' : ''}${
      ttMove && ttSel.has(x.id) ? ' sel' : ''}${locked ? ' locked' : ''}"
      aria-pressed="${ttMove ? ttSel.has(x.id) : x.done}"
      onclick="DO.${ttMove ? 'selectToday' : 'toggleTodayTask'}('${esc(x.id)}')">
      <span class="tt-check"><svg viewBox="0 0 10 10" fill="none"><path d="M1.5 5L4 7.5L8.5 2.5" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"/></svg></span>
      ${x.glyph ? `<span class="tt-glyph">${esc(x.glyph)}</span>` : ''}
      <span class="tt-body"><span class="tt-name">${esc(x.content)}</span>
        <span class="tt-meta">${pri ? `<span class="tt-pri ${pri}">${pri}</span>` : ''}${
          x.due < today ? `<span class="tt-late">${esc(x.due)}</span>` : ''}${
          x.section ? `<span class="tt-sec"${x.projectColor ? ` style="color:${esc(x.projectColor)};border-color:${esc(x.projectColor)}"` : ''}>${esc(x.section)}</span>` : ''}${
          x.src === 'tend' ? '<span class="tt-src">tend</span>' : ''}</span>
      </span></button>`;
  }).join('');
  const when = t.fetched ? new Date(t.fetched).toLocaleTimeString('en-GB', { hour:'2-digit', minute:'2-digit' }) : null;
  /* "→ tomorrow" works the way the blocks section's does: the head button turns
     the rows from tick to select, you pick what is moving, and one button sends
     it. It is no longer gated on the hour — the old button moved *everything*
     open, so it only made sense late in the evening; choosing what moves makes
     sense at any hour. "all" is still one tap. */
  const apiOpen = td.todayOn ? t.tasks.filter(x => !x.done).length : 0;
  if (!apiOpen) { ttMove = false; ttSel.clear(); }
  const defer = apiOpen
    ? `<button class="tt-refresh${ttMove ? ' tt-defer' : ''}" onclick="DO.toggleTodayMove()">${ttMove ? 'cancel' : '→ tomorrow'}</button>` : '';
  const moveBar = ttMove ? `<div class="bk-move" style="--bk-c:var(--y)">
      <button class="bk-move-b" onclick="DO.deferToday()"${ttSel.size ? '' : ' disabled'}>→ tomorrow</button>
      <button class="bk-move-b" onclick="DO.selectAllToday()">all ${apiOpen}</button>
      <span class="bk-move-hint">${ttSel.size ? `${ttSel.size} → tomorrow` : 'tap the tasks to move'}</span></div>` : '';
  box.innerHTML = `<div class="tt-head"><span>today<em>${open} open</em></span><span class="tt-acts">${defer}
      ${td.todayOn ? '<button class="tt-refresh" data-td-btn="refresh" data-td-busy="…" onclick="DO.refreshToday()">refresh</button>' : ''}</span></div>
    ${moveBar}
    ${rows || `<div class="tt-empty">${when ? 'nothing due today' : 'tap refresh to fetch today\'s tasks'}</div>`}
    <div class="tt-status">${t.missing && t.missing.length ? 'not found: ' + esc(t.missing.join(', ')) : when ? 'todoist fetched ' + when : ''}</div>`;
}

/* The selection is a gesture, not state: never persisted, and dropped whenever
   the list stops having anything to move. A plant row is not selectable —
   TEND owns those, and a missed watering is not something to postpone. */
let ttMove = false;
const ttSel = new Set();
function toggleTodayMove() { ttMove = !ttMove; ttSel.clear(); Prefs.tap(); renderToday(); }
function selectToday(id) {
  if (String(id).startsWith('tend:')) { toast('plants are TEND\'s — not moved from here'); return; }
  const t = (td.todayOn ? ttToday().tasks : []).find(x => x.id === id);
  if (!t || t.done) return;
  if (ttSel.has(id)) ttSel.delete(id); else ttSel.add(id);
  Prefs.tap(); renderToday();
}
function selectAllToday() {
  (td.todayOn ? ttToday().tasks : []).forEach(t => { if (!t.done) ttSel.add(t.id); });
  Prefs.tap(); renderToday();
}

/* Optimistic: the row flips at once, the request follows, a failure flips it
   back. Close and reopen are the two v1 endpoints; a recurring task that is
   closed rolls its due date on in Todoist and simply stops being returned. */
async function toggleTodayTask(id) {
  // a plant row belongs to TEND: it logs the care event and talks to Todoist itself
  if (String(id).startsWith('tend:')) {
    const it = window.TEND && TEND.todayList().find(x => x.id === id);
    if (it) TEND.setDone(it.pid, it.type, !it.done);
    return;
  }
  const t = ttToday();
  const task = t.tasks.find(x => x.id === id); if (!task) return;
  const was = task.done;
  task.done = !was; tdPersist(); renderToday(); Prefs.tap();
  try {
    await tdFetch(`/tasks/${id}/${was ? 'reopen' : 'close'}`, { method:'POST' });
    toast((was ? '↺ reopened' : '✓ closed') + ' in todoist');
  } catch (e) {
    task.done = was; tdPersist(); renderToday();
    toast('todoist: ' + e.message);
  }
}
/* ── Tomorrow ─────────────────────────────────────────────────────────────────
   The today list's "→ tomorrow" turns the rows from tick to select, the way
   the blocks section's does; the picked tasks are rescheduled in Todoist (v1:
   POST /tasks/{id} with a due string) and drop off the list. Plants are not
   touched — TEND owns those, and a missed watering is not something to
   postpone.

   Called with nothing selected it still moves every open task, which is what
   it always did and what any other caller expects; the selection narrows it
   rather than replacing it. */
async function deferToday() {
  if (tdBusy) return;
  const open = (td.todayOn ? ttToday().tasks : []).filter(t => !t.done);
  const picked = ttSel.size ? open.filter(t => ttSel.has(t.id)) : open;
  if (!picked.length) { toast('nothing open'); return; }
  // already async, so it awaits the answer rather than being turned inside out
  if (!await Shell.confirm(`Move ${picked.length} open task${picked.length === 1 ? '' : 's'} to tomorrow?`)) return;
  tdBusy = true; renderTdButtons();
  let moved = 0, failed = 0;
  try {
    for (const t of picked) {
      try { await tdFetch(`/tasks/${t.id}`, { method:'POST', body: JSON.stringify({ due_string: 'tomorrow' }) }); moved++; t.deferred = true; }
      catch { failed++; }
    }
    const tt = ttToday();
    tt.tasks = tt.tasks.filter(t => !t.deferred);
    ttSel.clear();
    if (!tt.tasks.some(t => !t.done)) ttMove = false;   // nothing left to move: back to ticking
    tdPersist(); renderToday();
    toast(failed ? `${moved} moved · ${failed} failed` : `${moved} moved to tomorrow`);
  } finally { tdBusy = false; renderTdButtons(); }
}

/* Silently refetch when the tab comes back and the list is older than ten
   minutes — a task added on the desktop should not need a manual refresh. */
function maybeRefreshToday() {
  const wantToday = td.todayOn && ttRules().length > 0;
  const wantBlocks = td.blocksOn && blockLabels().length > 0;
  const wantMedia = td.mediaOn && MEDIA_LABELS.length > 0;
  const wantQuick = td.quickOn && !!QUICK_LABEL;
  if ((!wantToday && !wantBlocks && !wantMedia && !wantQuick) || !Creds.token()) return;
  const last = Math.min(wantToday ? (ttToday().fetched || 0) : Infinity, wantBlocks ? (tdBlocks().fetched || 0) : Infinity,
                        wantMedia ? (tdMedia().fetched || 0) : Infinity, wantQuick ? (tdQuick().fetched || 0) : Infinity);
  if (Date.now() - last < TT_STALE) return;
  refreshToday(true);
}
function toggleToday() {
  td.todayOn = !td.todayOn; tdPersist(); renderTodoistSettings(); renderToday();
  if (td.todayOn && !ttToday().fetched) refreshToday(true);
}
function toggleTodayOverdue() { td.todayOverdue = !td.todayOverdue; tdPersist(); renderTodoistSettings(); }
function saveTodaySettings() {
  const f = $id('td-today-filter');
  td.todayFilter = f ? f.value.trim() : '';
  td.today = { date:tdLocalDate(), tasks:[], fetched:0, missing:[] };   // a new filter is a new list
  tdPersist(); renderTodoistSettings(); renderToday();
  toast('today filter saved');
  if (td.todayOn) refreshToday(true);
}

// ── Boot ──────────────────────────────────────────────────────────────────────
loadState();
loadTodoist();
renderTabs();
renderHome();
// the glider is measured in px, so it has to be re-measured when the width moves
window.addEventListener('resize', positionGlider);

/* A routine added, renamed or moved to another tab in Settings shows up here at
   once. Progress is keyed by routine id, so an edit never loses today's ticks —
   a routine whose id is gone simply stops being drawn. */
Config.subscribe(path => {
  if (path !== '*' && !String(path).startsWith('do.')) return;
  readConfig();
  Object.keys(ROUTINES).forEach(k => { if (!state[k]) state[k] = {}; });
  renderTabs();
  renderHome();
  renderSectionOrder();
});

Shell.register('do', {
  onShow: () => { renderTabs(); positionGlider(); renderToday(); maybeRefreshToday(); },
  onDayChange: rollDay,
  home: () => go('home'),        // the DO tab tapped while on DO
  /* What search can find in here that Config does not already hold: the travel
     checklists, which live in travel_state_v2 and are named by hand. */
  search: q => travel.order.map(id => travel.lists[id])
    .filter(l => l && String(l.name || '').toLowerCase().includes(q))
    .map(l => { const s = listStats(l);
      return { title: l.name, sub: `travel · ${s.done} / ${s.total} packed`,
               go: () => { Shell.go('do'); openList(l.id); } }; }),
});
// the date label follows Settings → behaviour → dates without a reload
Prefs.subscribe(k => {
  if (k === 'dateFormat' || k === 'doHideDone' || k === 'doCardStyle' || k === '*') renderHome();
});
maybeRefreshToday();

return { go, renderSettings: renderTodoistSettings,
         renderQuick, toggleQuickTask, toggleQuickSub, toggleQuick, toggleQuickHideDone,
         toggleQuickFold, clearQuickDone, quickTasks,
         renderHistory, toggleHistory, statsFor, statsRange,
         toggle, toggleAll, openRoutine, setTab, resetDay,
         openList, deleteList, toggleCat, createList, toggleTravel,
         bumpCount, decCount, removeItem, openTravelEdit, addEditItem,
         deleteEditItem, saveTravelEdit, resetTravel, exportTravelMd,
         syncTodoist, testTodoist, saveTodoistSettings, toggleAutoPush,
         toggleEndpoint,
         refreshToday, toggleTodayTask, toggleToday, toggleTodayOverdue, saveTodaySettings,
         renderToday, renderBlocks, toggleBlockTask, toggleBlocks, toggleBlocksHideDone,
         cycleBlocksDone, blocksDoneWin, blockTasks, moveSection,
         renderMedia, toggleMediaTask, toggleMedia, toggleMediaHideDone, mediaTasks, deferToday,
         setMediaKind, setMediaQuery, cycleMediaSort, mediaPick,
         toggleBlockMove, selectBlock, moveBlocks,
         toggleTodayMove, selectToday, selectAllToday };
})();
