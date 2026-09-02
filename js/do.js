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
const view  = document.getElementById('view-do');
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
let ROUTINES, TRAVEL_CATEGORIES, CATEGORY_ORDER, TABS, SECTIONS;
const SECTION_KEYS = ['blocks', 'routines', 'today'];
const SECTION_NAMES = { blocks:'Block tasks', routines:'Routine cards', today:'Today list' };

function readConfig() {
  ROUTINES          = Config.get('do.routines');
  TRAVEL_CATEGORIES = Config.get('do.travelCategories');
  CATEGORY_ORDER    = Config.get('do.categoryOrder').filter(c => TRAVEL_CATEGORIES[c]);
  // any category added in the editor but missing from the order still shows
  Object.keys(TRAVEL_CATEGORIES).forEach(c => { if (!CATEGORY_ORDER.includes(c)) CATEGORY_ORDER.push(c); });
  TABS = Config.get('do.tabs');
  const want = (Config.get('do.sections') || []).filter(k => SECTION_KEYS.includes(k));
  SECTIONS = want.concat(SECTION_KEYS.filter(k => !want.includes(k)));   // anything missing goes last
}
readConfig();

/* ── Home sections ────────────────────────────────────────────────────────────
   Three siblings under the header; the preferred order is applied by moving
   the real elements, so nothing else has to know about it. The today list and
   the block tasks show only on the first tab — "other" is for the odd
   routines, not for today. */
const SECTION_EL = { blocks:'td-blocks', routines:'home-grid', today:'td-today' };
function applySectionOrder() {
  const home = $id('s-home'); if (!home) return;
  SECTIONS.forEach(k => { const el = $id(SECTION_EL[k]); if (el) home.appendChild(el); });
}
const onFirstTab = () => currentTab === (TABS[0] || {}).id;
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
        .forEach(k => localStorage.removeItem(k));
      state = blankState();
    }
  } catch { state = blankState(); }
  loadTravel();
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
  bar.innerHTML = `<div class="tab-glider" id="tab-glider"></div>` + TABS.map(t =>
    `<button class="tab${t.id === currentTab ? ' active' : ''}" data-tab="${t.id}"
             onclick="DO.setTab('${t.id}')">${t.label}</button>`).join('');
  // a single tab is not a choice; hide the strip rather than show a lone chip
  bar.classList.toggle('hidden', TABS.length < 2);
  positionGlider();
}

function renderHome() {
  $id('date-label').textContent = Prefs.formatDate(TODAY).toUpperCase();   // #date-label is a span inside .h-label

  const routineCards = routinesOfTab(currentTab).map(key => {
    const r = ROUTINES[key];
    const done = r.items.filter(i => state[key]?.[i]).length;
    const pct  = r.items.length ? Math.round((done / r.items.length) * 100) : 0;
    const isDone = done === r.items.length;
    return `<div class="card${isDone ? ' done' : ''}" onclick="DO.openRoutine('${key}')">
      <div class="card-t">${r.label}</div>
      <div class="card-s">${done} / ${r.items.length} done</div>
      <div class="card-bar"><div class="card-bar-fill" style="width:${pct}%;background:${barColor(pct)}"></div></div>
    </div>`;
  }).join('');

  // Travel lives on the last tab, wherever that ends up being
  let travelCard = '';
  if (currentTab === (TABS[TABS.length - 1] || {}).id) {
    const tStat = travelStatsAll();
    const tDone = tStat.done === tStat.total && tStat.total > 0;
    const n = travel.order.length;
    const sub = n === 0 ? 'no checklists yet'
                        : `${n} list${n>1?'s':''} · ${tStat.done} / ${tStat.total} packed`;
    travelCard = `<div class="card${tDone ? ' done' : ''}" onclick="DO.go('travel')">
      <div class="card-t">Travel</div>
      <div class="card-s">${sub}</div>
      <div class="card-bar"><div class="card-bar-fill" style="width:${tStat.pct}%;background:${barColor(tStat.pct)}"></div></div>
    </div>`;
  }

  $id('home-grid').innerHTML = routineCards + travelCard;
  applySectionOrder();
  renderToday();
  renderBlocks();
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
  if (!Shell.confirm('Reset all items for today?')) return;
  state = blankState();
  saveState();
  go('home');
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
  if (!Shell.confirm('Delete “' + (list ? list.name : 'this list') + '”?')) return;
  delete travel.lists[id];
  travel.order = travel.order.filter(x => x !== id);
  if (currentList === id) currentList = null;
  saveTravel();
  renderTravelList();
  renderHome();
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
  if (!Shell.confirm('Delete ALL travel checklists? This cannot be undone.')) return;
  localStorage.removeItem(TRAVEL_KEY);
  localStorage.removeItem('travel_state_v1');
  travel = { lists:{}, order:[] };
  saveTravel();
  currentList = null;
  toast('travel reset');
  go('home');
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
                      blocksOn:true, blocksHideDone:false, blocks:{ date:null, tasks:[], fetched:0 } };
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
const TD_COLORS = { berry_red:'#b8256f', red:'#db4035', orange:'#ff9933', yellow:'#fad000', olive_green:'#afb83b',
  lime_green:'#7ecc49', green:'#299438', mint_green:'#6accbc', teal:'#158fad', sky_blue:'#14aaf5', light_blue:'#96c3eb',
  blue:'#4073ff', grape:'#884dff', violet:'#af38eb', lavender:'#eb96eb', magenta:'#e05194', salmon:'#ff8d85',
  charcoal:'#808080', grey:'#b8b8b8', taupe:'#ccac93' };
const blockLabels = () => (Config.get('plan.blocks') || []).map(s => String(s).trim().replace(/^@/, '')).filter(Boolean);
function tdBlocks() {
  const today = tdLocalDate();
  if (!td.blocks || td.blocks.date !== today) td.blocks = { date:today, tasks:[], fetched:0 };
  return td.blocks;
}
async function fetchBlocks(today) {
  const labels = await tdGetAll('/labels');
  const colorOf = name => {
    const l = labels.find(x => tdName(x.name) === tdName(name));
    return (l && TD_COLORS[l.color]) || '#A78BFA';
  };
  const prev = tdBlocks(), got = [];
  const blockSet = new Set(blockLabels().map(tdName));
  for (const name of blockLabels()) {
    const tasks = await tdGetAll('/tasks', { label: name });
    tasks.forEach(t => {
      if (tdDueDate(t) !== today) return;
      // the colour is the task's OTHER label — @curate, @home — the block label
      // only says which slot; a task with no other label takes the block's own
      const labels = Array.isArray(t.labels) ? t.labels.map(String) : [];
      const tag = labels.find(l => !blockSet.has(tdName(l))) || '';
      got.push({ id:String(t.id), content:String(t.content || ''), block:name, tag, color:colorOf(tag || name),
                 priority:+t.priority || 1, done:false });
    });
  }
  const seen = new Set(), next = [];
  got.forEach(t => { if (!seen.has(t.id)) { seen.add(t.id); next.push(t); } });
  prev.tasks.forEach(t => { if (t.done && !seen.has(t.id)) next.push(t); });   // closed here: keep, filled
  next.sort((a, b) => a.block.localeCompare(b.block) || a.content.localeCompare(b.content));
  td.blocks = { date:today, tasks:next, fetched:Date.now() };
}
function renderBlocks() {
  const box = $id('td-blocks'); if (!box) return;
  const b = tdBlocks();
  const show = td.blocksOn && b.tasks.length > 0 && onFirstTab();
  box.classList.toggle('hidden', !show);
  if (!show) return;
  const open = b.tasks.filter(x => !x.done).length;
  const shown = td.blocksHideDone ? b.tasks.filter(x => !x.done) : b.tasks;
  box.innerHTML = `<div class="tt-head"><span>blocks<em>${open} open</em></span>
      <button class="tt-refresh" onclick="DO.toggleBlocksHideDone()">${td.blocksHideDone ? 'show done' : 'hide done'}</button></div>
    ${shown.length ? '' : '<div class="tt-empty">all done</div>'}
    <div class="bk-grid">${shown.map(x => `<button class="bk${x.done ? ' done' : ''}" style="--bk-c:${esc(x.color)}" onclick="DO.toggleBlockTask('${esc(x.id)}')" aria-pressed="${x.done}">
      <span class="bk-tag">@${esc(x.block)}${x.tag ? ` · ${esc(x.tag)}` : ''}</span><span class="bk-name">${esc(x.content)}</span>
      <span class="bk-check"><svg viewBox="0 0 10 10" fill="none"><path d="M1.5 5L4 7.5L8.5 2.5" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"/></svg></span>
    </button>`).join('')}</div>`;
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
  if (!wantToday && !wantBlocks) {
    if (!quiet && td.todayOn) { toast('choose a project under settings → do'); Shell.settings('do'); }
    return;
  }
  if (!Creds.token()) { if (!quiet) { toast('add a Todoist key in settings'); Shell.settings('data'); } return; }
  tdBusy = true; renderTdButtons();
  const today = tdLocalDate();
  try {
    if (wantToday) await fetchTodayTasks(today);
    if (wantBlocks) await fetchBlocks(today);
    tdPersist();
    renderToday(); renderBlocks(); ttStatus();
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
function todayRows() {
  const pushed = window.TEND && TEND.pushedIds ? TEND.pushedIds() : new Set();
  const api = td.todayOn ? ttToday().tasks.filter(x => !pushed.has(String(x.id))) : [];
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
    return `<button class="tt-row${x.done ? ' done' : ''}${x.due < today && !x.done ? ' late' : ''}" onclick="DO.toggleTodayTask('${esc(x.id)}')">
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
  box.innerHTML = `<div class="tt-head"><span>today<em>${open} open</em></span>
      ${td.todayOn ? '<button class="tt-refresh" data-td-btn="refresh" data-td-busy="…" onclick="DO.refreshToday()">refresh</button>' : ''}</div>
    ${rows || `<div class="tt-empty">${when ? 'nothing due today' : 'tap refresh to fetch today\'s tasks'}</div>`}
    <div class="tt-status">${t.missing && t.missing.length ? 'not found: ' + esc(t.missing.join(', ')) : when ? 'todoist fetched ' + when : ''}</div>`;
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
/* Silently refetch when the tab comes back and the list is older than ten
   minutes — a task added on the desktop should not need a manual refresh. */
function maybeRefreshToday() {
  const wantToday = td.todayOn && ttRules().length > 0;
  const wantBlocks = td.blocksOn && blockLabels().length > 0;
  if ((!wantToday && !wantBlocks) || !Creds.token()) return;
  const last = Math.min(wantToday ? (ttToday().fetched || 0) : Infinity, wantBlocks ? (tdBlocks().fetched || 0) : Infinity);
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
});
// the date label follows Settings → behaviour → dates without a reload
Prefs.subscribe(k => { if (k === 'dateFormat' || k === '*') renderHome(); });
maybeRefreshToday();

return { go, renderSettings: renderTodoistSettings,
         toggle, toggleAll, openRoutine, setTab, resetDay,
         openList, deleteList, toggleCat, createList, toggleTravel,
         bumpCount, decCount, removeItem, openTravelEdit, addEditItem,
         deleteEditItem, saveTravelEdit, resetTravel, exportTravelMd,
         syncTodoist, testTodoist, saveTodoistSettings, toggleAutoPush,
         toggleEndpoint,
         refreshToday, toggleTodayTask, toggleToday, toggleTodayOverdue, saveTodaySettings,
         renderToday, renderBlocks, toggleBlockTask, toggleBlocks, toggleBlocksHideDone, blockTasks, moveSection };
})();
