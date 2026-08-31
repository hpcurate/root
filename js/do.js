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

// Daily lists mirror system_tool_do.md. Glyph prefixes match the app's existing
// visual language — the words after them are the file's, verbatim.
const ROUTINES = {
  routinep1: { label: 'Routine P1', items: ['≈ shower','≋ teeth','◡ cream','○ breakfast p1','✚ meds','↑ walk kamo','▲ gym'] },
  routinep2: { label: 'Routine P2', items: ['○ breakfast p2','≡ morning log','≡ log meds','✎ journal entry'] },
  routinep3: { label: 'Routine P3', items: ['◐ lunch p1','✎ journal entry','✦ feed kamo','≈ fill kamo water','◐ lunch p2','↑ kamo walk'] },
  routinep4: { label: 'Routine P4', items: ['≡ evening log','✎ journal entry','▤ plan blocks','▦ schedule','○ cleanup / dishes'] },
  cooldown:  { label: 'Cooldown',   items: ['▭ bed out','≈ fill water','≋ teeth','◇ tongue','◡ cream'] },
  cleanup:   { label: 'Cleanup',    items: ['○ dishes','✿ plants','⟳ vacuum','⊞ tidy up','✕ trash/recycle'] },
  deepclean: { label: 'Deep Clean', items: ['≋ dusting','⟳ vacuum','▧ mop','▭ surfaces','≈ bathroom sink','○ toilet','✕ trash'] },
};

// Travel: master categories. Every item is a counter that starts at 1.
// A new checklist is built by picking which categories to include.
const TRAVEL_CATEGORIES = {
  clothes:     ['shirts','boxers','short socks','long socks','sweatpant','pants','shorts','sweater','swim trunks','rain coat','belt','jacket','packing cubes'],
  toiletries:  ['toothbrush','toothbrush charger','toothpaste','face cream','eye cream','soap tube','facewash tube','shampoo tube','deodorant','gel','towel','nail care','nail file','nail cutter','talc','wash cloth','hygiene wipes','razor','razor charger'],
  meds:        ['lamotrigine','ritalin','caffeine pill','vitamins','biseptine','disenfectant','cottons','sunscreen','band aids'],
  electronics: ['phone','watch','headset','earphones','portable speaker','usb a plug','usb a to c','usb c to c','usb a to micro','watch cable','charge block','usb a fast power','mac','mac charger','laptop','laptop charger','laptop pounch','battery bank small','battery bank big','controller','headphones (dj)'],
  kamo:        ['toys','croquette bag','treats','black leash','long leash','towel','duvet','frontale','harness','poop bag','bowls','cold mat','kamo id'],
  essentials:  ['id','wallet','tissues','chapstick','ecig','ecig juice','water bottle','slippers','sunglasses','extra shoes','hand sanitizer','passport'],
  rave:        ['rave pants','earplugs','stickers','big satchel','rave shirt','bucket hat','spoon','pill','vacuum','polaroid','usb','dummy charger'],
  festival:    ['tent','sardines','party tent','chairs','table','matress','pillows','duvet','bedsheet','cart','cart screws','key','tarp','elastic cables','camelback','water pouch','boots','electric pump','wet wipes','toilet paper','trash bags','lighter','duct tape','rubber mallet'],
};
const CATEGORY_ORDER = ['clothes','toiletries','meds','electronics','kamo','essentials','rave','festival'];
const TRAVEL_KEY = 'travel_state_v2';

const TODAY = new Date().toISOString().split('T')[0];
const SK = 'do_' + TODAY;

// Which routines live under each home tab. Travel is shown under "other".
const TAB_ROUTINES = {
  daily: ['routinep1', 'routinep2', 'routinep3', 'routinep4', 'cooldown', 'cleanup'],
  other: ['deepclean'],
};

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
  if (id === 'settings') renderTodoistSettings();
}

function openRoutine(key) {
  currentRoutine = key;
  $id('cl-title').textContent = ROUTINES[key].label;
  go('checklist');
}

function renderHome() {
  $id('date-label').textContent =
    new Date().toLocaleDateString('en-GB', { weekday:'long', day:'numeric', month:'long', year:'numeric' }).toUpperCase();

  const routineCards = (TAB_ROUTINES[currentTab] || []).map(key => {
    const r = ROUTINES[key];
    const done = r.items.filter(i => state[key]?.[i]).length;
    const pct  = r.items.length ? Math.round((done / r.items.length) * 100) : 0;
    const isDone = done === r.items.length;
    return `<div class="card${isDone ? ' done' : ''}" onclick="DO.openRoutine('${key}')">
      <div class="card-t">${r.label}</div>
      <div class="card-s">${done} / ${r.items.length} done</div>
      <div class="card-bar"><div class="card-bar-fill" style="width:${pct}%"></div></div>
    </div>`;
  }).join('');

  let travelCard = '';
  if (currentTab === 'other') {
    const tStat = travelStatsAll();
    const tDone = tStat.done === tStat.total && tStat.total > 0;
    const n = travel.order.length;
    const sub = n === 0 ? 'no checklists yet'
                        : `${n} list${n>1?'s':''} · ${tStat.done} / ${tStat.total} packed`;
    travelCard = `<div class="card${tDone ? ' done' : ''}" onclick="DO.go('travel')">
      <div class="card-t">Travel</div>
      <div class="card-s">${sub}</div>
      <div class="card-bar"><div class="card-bar-fill" style="width:${tStat.pct}%"></div></div>
    </div>`;
  }

  $id('home-grid').innerHTML = routineCards + travelCard;
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
  $id('cl-stats').innerHTML = `<em>${done}</em> / ${items.length}`;
  $id('cl-done-banner').classList.toggle('show', allDone);
  $id('cl-action-btn').textContent = allDone ? 'clear all' : 'mark all';

  $id('cl-items').innerHTML = items.map(item => {
    const checked = !!state[key]?.[item];
    const safeItem = item.replace(/'/g, "\\'");
    return `<button class="item-btn${checked ? ' checked' : ''}" onclick="DO.toggle('${key}','${safeItem}')">
      <span>${item}</span>
      <div class="item-check-ico">
        <svg class="item-check-svg" viewBox="0 0 10 10" fill="none">
          <path d="M1.5 5L4 7.5L8.5 2.5" stroke="#0e0e0e" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"/>
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
  if (!confirm('Reset all items for today?')) return;
  state = blankState();
  saveState();
  go('home');
}

// ── Travel ────────────────────────────────────────────────────────────────────
function esc(s) { return String(s||'').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;'); }

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
      <div class="card-bar"><div class="card-bar-fill" style="width:${s.pct}%"></div></div>
    </div>`;
  }).join('');
}

function openList(id) { currentList = id; go('travel-cl'); }

function deleteList(id) {
  const list = travel.lists[id];
  if (!confirm('Delete “' + (list ? list.name : 'this list') + '”?')) return;
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
          <path d="M1.5 5L4 7.5L8.5 2.5" stroke="#0e0e0e" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"/>
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
      const safeItem = item.replace(/\\/g, '\\\\').replace(/'/g, "\\'");
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
            <path d="M1.5 5L4 7.5L8.5 2.5" stroke="#0e0e0e" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"/>
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
  if (!confirm('Delete ALL travel checklists? This cannot be undone.')) return;
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
  const date = new Date().toISOString().split('T')[0];
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
                      endpoint:'direct', autoPush:true, closedOn:{} };
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
}
function tdPersist() { localStorage.setItem(TD_KEY, JSON.stringify(td)); }

/* Todoist due dates are local calendar days, so "today" here has to be too —
   the app's own TODAY is UTC and would be a day behind after midnight. */
function tdLocalDate(d = new Date()) {
  return `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}`;
}

function tdFold(s) {
  return String(s || '').toLowerCase().normalize('NFD')
    .replace(/[̀-ͯ]/g, '');   // drop accents
}
/* "Routine P1", "routine p1" and "ROUTINE-P1" all collapse to the ROUTINES key. */
function tdSlug(s) { return tdFold(s).replace(/[^a-z0-9]+/g, ''); }
/* Looser form for project and section names, where words must stay apart:
   "04 | life" and "04|life" both become "04 life". */
function tdName(s) { return tdFold(s).replace(/[^a-z0-9]+/g, ' ').trim(); }
const TD_ROUTINE_BY_SLUG = Object.fromEntries(
  Object.keys(ROUTINES).flatMap(k => [[tdSlug(k), k], [tdSlug(ROUTINES[k].label), k]]));

function tdBase() { return td.endpoint === 'proxy' ? TD_PROXY : TD_DIRECT; }

async function tdFetch(path, opts = {}) {
  if (!td.token) throw new Error('no API token saved — add one in settings');
  let res;
  try {
    res = await fetch(tdBase() + path, {
      ...opts,
      headers: {
        'Authorization': 'Bearer ' + td.token,
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
  tasks.forEach(task => {
    const key = TD_ROUTINE_BY_SLUG[tdSlug(task.content)];
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
  if (!td.token) { toast('add a Todoist token in settings'); go('settings'); return; }
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
  if (tdBusy || !td.token || !td.autoPush) return;
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
  if (!td.token) { tdStatus('add your API token first', 'bad'); return; }
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

function saveTodoistSettings() {
  const tok  = $id('td-token').value.trim();
  const proj = $id('td-project').value.trim() || TD_DEFAULTS.project;
  const sec  = $id('td-section').value.trim() || TD_DEFAULTS.section;
  // a changed target invalidates the cached ids
  if (proj !== td.project || sec !== td.section) { td.projectId = null; td.sectionId = null; }
  td.token = tok; td.project = proj; td.section = sec;
  tdPersist();
  renderTodoistSettings();
  toast(tok ? 'todoist settings saved' : 'todoist token cleared');
}

function toggleAutoPush() { td.autoPush = !td.autoPush; tdPersist(); renderTodoistSettings(); }
function toggleEndpoint() {
  td.endpoint = td.endpoint === 'proxy' ? 'direct' : 'proxy';
  td.projectId = null; td.sectionId = null;
  tdPersist();
  renderTodoistSettings();
}

function renderTodoistSettings() {
  const tok = $id('td-token');
  if (!tok) return;
  tok.value = td.token;
  $id('td-project').value = td.project;
  $id('td-section').value = td.section;
  $id('td-auto').textContent = td.autoPush ? 'on' : 'off';
  $id('td-endpoint').textContent = td.endpoint === 'proxy' ? 'proxy' : 'direct';
  $id('td-last').textContent = td.lastSync
    ? 'last sync ' + new Date(td.lastSync).toLocaleString('en-GB',
        { day:'numeric', month:'short', hour:'2-digit', minute:'2-digit' })
    : 'never synced';
  $id('td-file-warn').classList.toggle('hidden', location.protocol !== 'file:');
}

// ── Boot ──────────────────────────────────────────────────────────────────────
loadState();
loadTodoist();
renderHome();
positionGlider();
// the glider is measured in px, so it has to be re-measured when the width moves
window.addEventListener('resize', positionGlider);

Shell.register('do', { onShow: positionGlider });

return { go, toggle, toggleAll, openRoutine, setTab, resetDay,
         openList, deleteList, toggleCat, createList, toggleTravel,
         bumpCount, decCount, removeItem, openTravelEdit, addEditItem,
         deleteEditItem, saveTravelEdit, resetTravel, exportTravelMd,
         syncTodoist, testTodoist, saveTodoistSettings, toggleAutoPush,
         toggleEndpoint, reload: () => location.reload() };
})();
