/* ── TEND ─────────────────────────────────────────────────────────────────────
   Plant care. Plants hold summer-baseline intervals; a separate append-only
   EVENT LOG holds what actually happened, and every "when is this due" answer
   is derived from the log — which is what makes undo, history and the
   observed-interval nudge possible.

   Ported from tend/index.html for 2.2:
     · the vocabulary (plant types, task names, growth curve, seasons, round
       thresholds, new-plant defaults, starter list) moved to js/config.js and is
       edited from Settings → content / Settings → tend
     · the detail and editor sheets are the frame's .sheet-back/.sheet pair and
       live outside #track; the fixed "add plant" bar is a sticky one inside the
       slide; the toast is Shell.toast; the undo pill is a sibling of #toast
     · "today" is Shell.today(), and the round re-renders on the day rollover
     · every confirm goes through Shell.confirm
   Storage is untouched: tend.v3, with tend.plants.v2 migrated once on read, so
   the standalone app keeps working off the same data. */
window.TEND = (function () {
'use strict';

const SCOPE = '.ns-tend ';
const view  = document.getElementById('view-tend');
const $id   = id  => document.querySelector(SCOPE + '#' + id);
const $all  = sel => document.querySelectorAll(SCOPE + sel);
const toast = msg => Shell.toast(msg);
const esc   = s => String(s == null ? '' : s).replace(/[&<>"']/g, c =>
  ({ '&':'&amp;', '<':'&lt;', '>':'&gt;', '"':'&quot;', "'":'&#39;' }[c]));

const STORE_KEY = 'tend.v3', LEGACY = 'tend.plants.v2';
const TASK_KEYS = ['water', 'feed', 'repot'];        // the log is filed under these

/* ── Content ───────────────────────────────────────────────────────────────── */
let GROUPS, TASKS, GROWTH, SEASONS, FEED_FLOOR, ROUND, NEWP;
function readConfig() {
  GROUPS = Config.get('tend.groups') || [];
  const t = Config.get('tend.tasks') || {};
  TASKS = TASK_KEYS.map(k => ({ key:k, label:(t[k] && t[k].label) || k, verb:(t[k] && t[k].verb) || k }));
  GROWTH = Config.get('tend.growth') || [];
  SEASONS = Config.get('tend.seasons') || [];
  FEED_FLOOR = Math.max(0, Math.min(1, parseFloat(Config.get('tend.feedFloor')) || 0));
  ROUND = Object.assign({ soonAt:0.75, overdueAfter:2, soonCount:6, undoSec:7, historyCount:10 }, Config.get('tend.round') || {});
  NEWP  = Object.assign({ group:'tropical', water:7, feed:21, repot:12, glyph:'🌿' }, Config.get('tend.newPlant') || {});
}
readConfig();

/* A curve with a missing or malformed month reads as full growth rather than
   throwing the whole app into winter. */
const growthAt = m => { const g = parseFloat(GROWTH[m]); return isFinite(g) ? Math.max(0, Math.min(1, g)) : 1; };
const seasonAt = m => SEASONS[m] || '';
const groupOf  = key => GROUPS.find(g => g.key === key) || GROUPS.find(g => g.key === NEWP.group) ||
                        GROUPS[0] || { key:'plant', label:'plant', season:1, note:'' };
const groupKey = key => GROUPS.some(g => g.key === key) ? key : groupOf(key).key;
const taskOf   = key => TASKS.find(t => t.key === key);

/* ── Dates — local, through the shell ─────────────────────────────────────── */
const pad = n => String(n).padStart(2, '0');
const isoOf = d => d.getFullYear() + '-' + pad(d.getMonth() + 1) + '-' + pad(d.getDate());
const todayISO = () => Shell.today();
const D = s => { const p = String(s).split('-').map(Number); return new Date(p[0], p[1] - 1, p[2], 12, 0, 0); };
const isISO = s => /^\d{4}-\d{2}-\d{2}$/.test(String(s || ''));
const daysBetween = (a, b) => Math.round((D(b) - D(a)) / 864e5);
const fmtDay = s => D(s).toLocaleDateString('en-GB', { day:'numeric', month:'short' });

/* ── State ─────────────────────────────────────────────────────────────────── */
const blank = () => ({ v:3, plants:[], events:[], settings:{ seasonSensitivity:1, sort:'room' } });
let DB = blank();
let uid = 0;
const newId = p => p + '_' + Date.now().toString(36) + '_' + (uid++).toString(36);

function seedPlants() {
  return (Config.get('tend.starter') || []).map(s => ({
    id:newId('p'), name:String(s[0]), species:String(s[1] || ''), group:groupKey(s[2]),
    glyph:String(s[4] || NEWP.glyph).slice(0, 2), room:String(s[5] || ''),
    every:{ water:Math.max(1, parseInt(s[3]) || NEWP.water),
            feed: s[2] === 'succulent' ? 0 : NEWP.feed, repot:NEWP.repot },
    notes:'', added:todayISO(),
  }));
}

/* v2 stored one `last` date per plant. Each becomes a single water event so the
   log starts truthful rather than pretending to a history it lacks. */
function migrate(old) {
  const plants = [], events = [];
  old.forEach(p => {
    const id = newId('p'), hasLast = isISO(p.last);
    plants.push({
      id, name:String(p.name || 'Plant'), species:String(p.species || ''), group:groupKey(p.group),
      glyph:String(p.glyph || NEWP.glyph).slice(0, 2), room:'',
      every:{ water:Math.max(1, parseInt(p.interval) || NEWP.water), feed:p.group === 'succulent' ? 0 : NEWP.feed, repot:NEWP.repot },
      notes:'', added:hasLast ? p.last : todayISO(),
    });
    if (hasLast) events.push({ id:newId('e'), plant:id, type:'water', date:p.last });
  });
  return { v:3, plants, events, settings:{ seasonSensitivity:1, sort:'room' } };
}

function normalise(raw) {
  const s = Object.assign({ seasonSensitivity:1, sort:'room' }, raw.settings || {});
  s.seasonSensitivity = Math.max(0, Math.min(2, +s.seasonSensitivity || 0));
  if (!['room', 'thirst', 'type'].includes(s.sort)) s.sort = 'room';
  const plants = raw.plants.filter(p => p && p.name).map(p => ({
    id:String(p.id || newId('p')), name:String(p.name), species:String(p.species || ''),
    group:groupKey(p.group), glyph:String(p.glyph || NEWP.glyph).slice(0, 2), room:String(p.room || ''),
    every:{
      water:Math.max(1, parseInt(p.every && p.every.water) || parseInt(p.interval) || NEWP.water),
      feed: Math.max(0, parseInt(p.every && p.every.feed)  || 0),
      repot:Math.max(0, parseInt(p.every && p.every.repot) || 0),
    },
    notes:String(p.notes || ''),
    added:isISO(p.added) ? p.added : todayISO(),
  }));
  const ids = new Set(plants.map(p => p.id));
  const events = (Array.isArray(raw.events) ? raw.events : []).filter(e =>
    e && ids.has(e.plant) && TASK_KEYS.includes(e.type) && isISO(e.date)
  ).map(e => ({ id:String(e.id || newId('e')), plant:e.plant, type:e.type, date:e.date, note:e.note ? String(e.note) : '' }));
  return { v:3, plants, events, settings:s };
}

function load() {
  let raw = null;
  try { raw = JSON.parse(localStorage.getItem(STORE_KEY) || 'null'); } catch {}
  // normalise, then write straight back so storage never keeps rows the app
  // has already decided to ignore (orphaned events, unknown care types)
  if (raw && Array.isArray(raw.plants)) { DB = normalise(raw); save(); return; }
  let old = null;
  try { old = JSON.parse(localStorage.getItem(LEGACY) || 'null'); } catch {}
  if (Array.isArray(old) && old.length) { DB = migrate(old); save(); toast('brought ' + old.length + ' plants across'); return; }
  DB = blank(); DB.plants = seedPlants(); save();
}
function save() { try { localStorage.setItem(STORE_KEY, JSON.stringify(DB)); } catch {} }

/* ── Season ────────────────────────────────────────────────────────────────── */
const growthOf = d => growthAt((d || new Date()).getMonth());
function waterStretch(group, date) {
  // 1.0 in summer, up to ~1.8 in deep winter, weighted by how seasonal the type is
  const raw = 1 / (0.5 + 0.5 * growthOf(date));
  const g = groupOf(group);
  return 1 + (raw - 1) * DB.settings.seasonSensitivity * (parseFloat(g.season) || 0);
}
function effEvery(p, type, date) {
  const base = p.every[type] || 0;
  if (!base) return 0;                                       // 0 = not tracked
  if (type === 'water') return Math.max(1, Math.round(base * waterStretch(p.group, date)));
  if (type === 'feed') {
    const g = growthOf(date);
    if (g < FEED_FLOOR) return -1;                           // -1 = suspended for the season
    return Math.max(7, Math.round(base / Math.max(g, 0.01)));
  }
  return base * 30;                                          // repot: months → days
}

/* ── Derived ───────────────────────────────────────────────────────────────── */
const eventsFor = (pid, type) => DB.events.filter(e => e.plant === pid && e.type === type)
                                          .sort((a, b) => a.date < b.date ? 1 : -1);
const lastOf = (pid, type) => { const e = eventsFor(pid, type)[0]; return e ? e.date : null; };

function status(p, type) {
  const every = effEvery(p, type);
  if (every === 0)  return { tracked:false };
  if (every === -1) return { tracked:true, suspended:true, state:'off' };
  // No event of this type yet? Count from the day the plant entered the app.
  // Claiming it was watered then would be a lie; starting its clock then is not,
  // and it keeps a fresh install from opening with everything screaming overdue.
  const logged = lastOf(p.id, type);
  const last = logged || p.added || todayISO();
  const days = daysBetween(last, todayISO());
  const ratio = days / every;
  return { tracked:true, last, logged:!!logged, every, days, ratio,
           over:Math.max(0, days - every), left:every - days,
           state:ratio >= 1 ? 'due' : ratio >= ROUND.soonAt ? 'soon' : 'fine' };
}
function tasksIn(state) {
  const out = [];
  DB.plants.forEach(p => TASKS.forEach(t => {
    const st = status(p, t.key);
    if (st.tracked && !st.suspended && st.state === state) out.push({ p, t, st });
  }));
  return out;
}
const dueTasks  = () => tasksIn('due').sort((a, b) => (b.st.over - a.st.over) || (a.p.name > b.p.name ? 1 : -1));
const soonTasks = () => tasksIn('soon').sort((a, b) => a.st.left - b.st.left);

function observedEvery(pid, type) {
  const ds = eventsFor(pid, type).map(e => e.date);
  if (ds.length < 3) return null;
  const gaps = [];
  for (let i = 0; i < Math.min(ds.length - 1, 6); i++) gaps.push(daysBetween(ds[i + 1], ds[i]));
  gaps.sort((a, b) => a - b);
  return gaps[Math.floor(gaps.length / 2)];
}
const roomsList = () => [...new Set(DB.plants.map(p => p.room).filter(Boolean))].sort();
const roomName  = r => r || 'unsorted';

/* ── Actions ───────────────────────────────────────────────────────────────── */
let lastBatch = null, undoT = null;
function logCare(pid, type, date, note) {
  const ev = { id:newId('e'), plant:pid, type, date:date || todayISO(), note:note || '' };
  DB.events.push(ev);
  return ev.id;
}
function doTasks(items, label) {
  const ids = items.map(it => logCare(it.p.id, it.t.key, todayISO()));
  save(); render(); offerUndo(label, ids);
  items.forEach(it => ttClose(it.p.id, it.t.key));
  Prefs.tap();
}
function offerUndo(label, ids) {
  lastBatch = ids;
  const bar = $id('undo');
  if (!bar) return;
  $id('undo-txt').textContent = label;
  bar.classList.add('on');
  clearTimeout(undoT);
  undoT = setTimeout(() => bar.classList.remove('on'), Math.max(1, +ROUND.undoSec || 7) * 1000);
}
function undoLast() {
  if (!lastBatch) return;
  const s = new Set(lastBatch);
  const gone = DB.events.filter(e => s.has(e.id));
  DB.events = DB.events.filter(e => !s.has(e.id));
  lastBatch = null; save(); render();
  gone.forEach(e => { if (e.date === todayISO()) ttReopen(e.plant, e.type); });
  if (detailId) renderDetail();
  const bar = $id('undo'); if (bar) bar.classList.remove('on');
  toast('undone');
}

/* ── Render ────────────────────────────────────────────────────────────────── */
let sub = 'round';

function render() {
  const now = new Date();
  const dl = $id('date-label');
  if (dl) dl.textContent = Prefs.formatDate(todayISO()).toUpperCase();

  const g = growthOf(now), stretch = 1 / (0.5 + 0.5 * g);
  const pct = Math.round((stretch - 1) * 100 * DB.settings.seasonSensitivity);
  const season = $id('season');
  if (season) season.innerHTML =
    '<span class="sdot"></span><span>' + esc(seasonAt(now.getMonth())) + ' — intervals ' +
    (pct <= 0 ? '<b>at summer length</b>' : 'stretched <b>+' + pct + '%</b>') +
    (g < FEED_FLOOR ? ', feeding <b>paused</b>' : '') + '</span>';

  $all('.tabs .tab').forEach(t => t.classList.toggle('on', t.dataset.view === sub));
  const r = $id('sub-round'), s = $id('sub-shelf');
  if (r) r.classList.toggle('on', sub === 'round');
  if (s) s.classList.toggle('on', sub === 'shelf');
  if (sub === 'round') renderRound(); else renderShelf();
}

function renderRound() {
  const host = $id('sub-round'); if (!host) return;
  const due = dueTasks(), soon = soonTasks();
  let h = '<div class="hero"><div class="n' + (due.length ? '' : ' zero') + '">' + due.length + '</div>' +
          '<div class="k">' + (due.length === 1 ? 'thing to do' : 'things to do') + '</div>';
  if (!due.length && soon.length) h += '<div class="sub2">next in ' + soon[0].st.left + ' day' + (soon[0].st.left === 1 ? '' : 's') + '</div>';
  h += '</div>';

  if (!due.length) {
    h += '<div class="emptyRound card"><div class="e1">Nothing needs you today.</div>' +
         '<div class="e2">' + (DB.plants.length ? 'All ' + DB.plants.length + ' plants are within their window.' : 'Add a plant to get started.') + '</div></div>';
  } else {
    const byRoom = {};
    due.forEach(it => { const r = roomName(it.p.room); (byRoom[r] = byRoom[r] || []).push(it); });
    Object.keys(byRoom).sort().forEach(r => {
      const items = byRoom[r];
      h += '<div class="roomHead"><h2>' + esc(r) + '</h2>' +
           (items.length > 1 ? '<button class="doAll" data-act="do-room" data-room="' + esc(r) + '">do all ' + items.length + '</button>' : '') +
           '</div>';
      items.forEach(it => {
        const od = it.st.over;
        h += '<div class="task card' + (od > ROUND.overdueAfter ? ' overdue' : '') + '" data-act="do-task" data-p="' + esc(it.p.id) + '" data-t="' + it.t.key + '">' +
               '<div class="tick">✓</div>' +
               '<div class="glyph">' + esc(it.p.glyph) + '</div>' +
               '<div class="tmeta"><div class="tname">' + esc(it.p.name) + '</div>' +
                 '<div class="twhat"><span class="k ' + it.t.key + '">' + esc(it.t.label) + '</span>' +
                 (od > 0 ? '<span class="od">' + od + 'd overdue</span>' : '<span>due today</span>') +
                 (it.st.logged ? '' : '<span class="nh">no history</span>') +
                 '</div></div>' +
               '<button class="more" data-act="open-detail" data-p="' + esc(it.p.id) + '" aria-label="details">›</button>' +
             '</div>';
      });
    });
  }

  if (soon.length) {
    h += '<div class="soonWrap"><div class="soonHead">coming up</div>';
    soon.slice(0, Math.max(0, +ROUND.soonCount || 0)).forEach(it => {
      h += '<div class="soon card" data-act="open-detail" data-p="' + esc(it.p.id) + '">' +
             '<span class="sg">' + esc(it.p.glyph) + '</span>' +
             '<span class="sn">' + esc(it.p.name) + '</span>' +
             '<span class="sd">' + esc(it.t.label) + ' in ' + it.st.left + 'd</span></div>';
    });
    h += '</div>';
  }
  host.innerHTML = h;
}

function renderShelf() {
  const host = $id('sub-shelf'); if (!host) return;
  const sort = DB.settings.sort;
  let h = '<div class="shelfBar">' +
    ['room', 'thirst', 'type'].map(s => '<button class="sortBtn' + (sort === s ? ' on' : '') + '" data-act="sort" data-s="' + s + '">by ' + s + '</button>').join('') +
    '</div>';

  if (!DB.plants.length) {
    h += '<div class="emptyRound card"><div class="e1">No plants yet.</div><div class="e2">Tap <em>add plant</em> below.</div></div>';
    host.innerHTML = h; return;
  }

  const rows = DB.plants.map(p => ({ p, st:status(p, 'water') }));
  let groups;
  if (sort === 'thirst') {
    rows.sort((a, b) => (b.st.ratio || 0) - (a.st.ratio || 0));
    groups = [['', rows]];
  } else if (sort === 'type') {
    groups = GROUPS.map(g => [g.label, rows.filter(r => r.p.group === g.key)]).filter(x => x[1].length);
    const known = new Set(GROUPS.map(g => g.key));
    const rest = rows.filter(r => !known.has(r.p.group));
    if (rest.length) groups.push(['other', rest]);
  } else {
    const m = {};
    rows.forEach(r => { const k = roomName(r.p.room); (m[k] = m[k] || []).push(r); });
    groups = Object.keys(m).sort().map(k => [k, m[k].sort((a, b) => (b.st.ratio || 0) - (a.st.ratio || 0))]);
  }

  groups.forEach(([label, items]) => {
    if (label) h += '<div class="roomHead"><h2>' + esc(label) + '</h2><span class="cnt-n">' + items.length + '</span></div>';
    items.forEach(({ p, st }) => {
      const fill = st.tracked ? Math.max(0, Math.min(100, Math.round((1 - (st.ratio || 0)) * 100))) : 0;
      const cls = st.state === 'due' ? 'due' : st.state === 'soon' ? 'soon' : '';
      const day = !st.tracked ? '—' : st.state === 'due' ? (st.over ? '+' + st.over : '0') : st.left;
      const lbl = !st.tracked ? '' : st.state === 'due' ? (st.over ? 'days over' : 'today') : 'days left';
      h += '<div class="row card" data-act="open-detail" data-p="' + esc(p.id) + '">' +
             '<div class="glyph">' + esc(p.glyph) + '</div>' +
             '<div class="rmeta"><div class="rname">' + esc(p.name) + '</div>' +
               (p.species ? '<div class="rspec">' + esc(p.species) + '</div>' : '') +
               '<div class="meter"><i class="' + cls + '" data-fill="' + fill + '"></i></div></div>' +
             '<div class="rday ' + cls + '"><b>' + day + '</b>' + lbl + '</div>' +
           '</div>';
    });
  });
  host.innerHTML = h;
  // set widths on the next frame so the meters actually animate in
  requestAnimationFrame(() => host.querySelectorAll('.meter i[data-fill]')
    .forEach(el => { el.style.width = el.dataset.fill + '%'; }));
}

/* ── Sheets ────────────────────────────────────────────────────────────────── */
function openSheet(name) {
  const back = $id(name + '-back'), sheet = $id('sheet-' + name);
  if (back) back.classList.add('on');
  if (sheet) { sheet.classList.add('on'); sheet.scrollTop = 0; }
}
function closeSheet(name) {
  const back = $id(name + '-back'), sheet = $id('sheet-' + name);
  if (back) back.classList.remove('on');
  if (sheet) sheet.classList.remove('on');
  if (name === 'edit') editingId = null;
  if (name === 'detail') detailId = null;
}

/* ── Detail ────────────────────────────────────────────────────────────────── */
let detailId = null;
function openDetail(id) {
  detailId = id; renderDetail(); openSheet('detail');
}
function renderDetail() {
  const p = DB.plants.find(x => x.id === detailId); if (!p) return;
  const grp = groupOf(p.group);
  let h = '<div class="dHead"><div class="glyph">' + esc(p.glyph) + '</div><div style="min-width:0">' +
          '<div class="dName">' + esc(p.name) + '</div>' +
          (p.species ? '<div class="dSpec">' + esc(p.species) + '</div>' : '') +
          '<div class="dRoom">' + esc(roomName(p.room)) + ' · ' + esc(grp.label) + '</div></div></div>';

  h += '<div class="careGrid">';
  TASKS.forEach(t => {
    const st = status(p, t.key);
    let v, e, cls = '';
    if (!st.tracked)      { v = '—'; e = 'not tracked'; cls = 'off'; }
    else if (st.suspended){ v = '—'; e = 'paused for the season'; cls = 'off'; }
    else { v = st.state === 'due' ? (st.over ? '+' + st.over : '0') : st.left;
           e = st.logged ? 'every ' + st.every + 'd' : 'since added';
           cls = st.state === 'due' ? 'due' : st.state === 'soon' ? 'soon' : ''; }
    h += '<div class="care ' + cls + '"><div class="cv">' + v + '</div><div class="ck">' + esc(t.label) + '</div><div class="ce">' + e + '</div></div>';
  });
  h += '</div>';

  h += '<input class="logDate" type="date" id="log-date" value="' + todayISO() + '" max="' + todayISO() + '" aria-label="log date">';
  h += '<div class="logRow">' + TASKS.map(t => {
         const st = status(p, t.key);
         const off = !st.tracked || st.suspended;
         return '<button class="logBtn' + (off ? ' off' : '') + '" data-act="log" data-t="' + t.key + '">' + esc(t.verb) + '</button>';
       }).join('') + '</div>';

  // observed-vs-set nudge — compared like for like, at today's season
  const obs = observedEvery(p.id, 'water');
  if (obs) {
    const eff = effEvery(p, 'water');
    if (eff > 0 && Math.abs(obs - eff) / eff > 0.3) {
      const suggest = Math.max(1, Math.round(obs / waterStretch(p.group)));
      h += '<div class="sug">You actually ' + esc(taskOf('water').label) + ' this about every <b>' + obs + ' days</b>, but it is set to ' + eff +
           ' for right now. Adjusting the summer baseline to <b>' + suggest + 'd</b> would match what you really do.' +
           '<br><button data-act="accept-suggest" data-v="' + suggest + '">use ' + suggest + 'd</button></div>';
    }
  }

  if (p.notes) h += '<div class="secLbl">notes</div><div class="notes">' + esc(p.notes) + '</div>';

  h += '<div class="secLbl">history</div>';
  const hist = DB.events.filter(e => e.plant === p.id).sort((a, b) => a.date < b.date ? 1 : -1)
                        .slice(0, Math.max(1, +ROUND.historyCount || 10));
  if (!hist.length) h += '<div class="histEmpty">Nothing logged yet.</div>';
  else hist.forEach(e => {
    const t = taskOf(e.type) || { label:e.type };
    const ago = daysBetween(e.date, todayISO());
    h += '<div class="hist"><span class="ht ' + e.type + '">' + esc(t.label) + '</span>' +
         '<span class="hd">' + fmtDay(e.date) + ' · ' + (ago === 0 ? 'today' : ago === 1 ? 'yesterday' : ago + 'd ago') + '</span>' +
         '<button class="hx" data-act="del-event" data-e="' + esc(e.id) + '" aria-label="remove entry">×</button></div>';
  });

  h += '<div class="acts" style="margin-top:20px">' +
       '<button class="btn" data-act="close-detail">close</button>' +
       '<button class="btn primary" data-act="edit-plant">edit</button></div>';
  $id('detail-body').innerHTML = h;
}

/* ── Editor ────────────────────────────────────────────────────────────────── */
let editingId = null;
function openEditor(id) {
  editingId = id || null;
  const sel = $id('f-group');
  sel.innerHTML = GROUPS.map(g => '<option value="' + esc(g.key) + '">' + esc(g.label) + '</option>').join('');
  $id('tend-roomlist').innerHTML = roomsList().map(r => '<option value="' + esc(r) + '">').join('');
  if (editingId) {
    const p = DB.plants.find(x => x.id === editingId);
    if (!p) { editingId = null; return openEditor(); }
    $id('edit-title').textContent = 'edit plant';
    $id('f-name').value = p.name; $id('f-species').value = p.species; $id('f-room').value = p.room;
    $id('f-glyph').value = p.glyph; $id('f-group').value = groupKey(p.group);
    $id('f-water').value = p.every.water; $id('f-feed').value = p.every.feed; $id('f-repot').value = p.every.repot;
    $id('f-last').value = lastOf(p.id, 'water') || '';
    $id('f-notes').value = p.notes;
    $id('delete-row').classList.remove('hidden');
  } else {
    $id('edit-title').textContent = 'add plant';
    $id('f-name').value = ''; $id('f-species').value = ''; $id('f-room').value = '';
    $id('f-glyph').value = NEWP.glyph; $id('f-group').value = groupKey(NEWP.group);
    $id('f-water').value = NEWP.water; $id('f-feed').value = NEWP.feed; $id('f-repot').value = NEWP.repot;
    $id('f-last').value = todayISO(); $id('f-notes').value = '';
    $id('delete-row').classList.add('hidden');
  }
  groupNote();
  openSheet('edit');
}
function groupNote() {
  const g = GROUPS.find(x => x.key === $id('f-group').value);
  $id('groupNote').textContent = g ? g.note : '';
}
function saveEditor() {
  const name = $id('f-name').value.trim();
  if (!name) { $id('f-name').focus(); toast('give it a name'); return; }
  const data = {
    name, species:$id('f-species').value.trim(), room:$id('f-room').value.trim().toLowerCase(),
    glyph:$id('f-glyph').value.trim().slice(0, 2) || NEWP.glyph, group:groupKey($id('f-group').value),
    every:{ water:Math.max(1, parseInt($id('f-water').value) || NEWP.water),
            feed: Math.max(0, parseInt($id('f-feed').value)  || 0),
            repot:Math.max(0, parseInt($id('f-repot').value) || 0) },
    notes:$id('f-notes').value.trim(),
  };
  const last = $id('f-last').value;
  if (editingId) {
    const p = DB.plants.find(x => x.id === editingId);
    Object.assign(p, data);
    // editing the "last watered" field rewrites the most recent water event
    // rather than appending, so correcting a date doesn't invent a watering
    if (isISO(last)) {
      const ev = eventsFor(p.id, 'water')[0];
      if (ev) ev.date = last; else logCare(p.id, 'water', last);
    }
  } else {
    const id = newId('p');
    DB.plants.push(Object.assign({ id, added:todayISO() }, data));
    if (isISO(last)) logCare(id, 'water', last);
  }
  const was = editingId;
  save(); render(); closeSheet('edit');
  if (detailId) renderDetail();
  toast(was ? 'saved' : 'added');
}
function deletePlant() {
  if (!editingId) return;
  if (!Shell.confirm('Delete this plant and its whole history?')) return;
  DB.plants = DB.plants.filter(x => x.id !== editingId);
  DB.events = DB.events.filter(e => e.plant !== editingId);
  save(); render(); closeSheet('edit'); closeSheet('detail');
  toast('deleted');
}

/* ── Settings panel ─────────────────────────────────────────────────────────
   Rendered into Settings → tend. The season dial and the default sort are kept
   in tend.v3 (the standalone app reads them too); the round thresholds and the
   new-plant defaults are Config fields the settings view commits itself. */
function renderSettings() {
  const sl = $id('f-season');
  if (sl && document.activeElement !== sl) sl.value = Math.round(DB.settings.seasonSensitivity * 100);
  renderSeason();
  $all('[data-act="sortdef"]').forEach(b => b.classList.toggle('on', b.dataset.s === DB.settings.sort));
  const gsel = $id('np-group');
  if (gsel) {
    gsel.innerHTML = GROUPS.map(g => '<option value="' + esc(g.key) + '">' + esc(g.label) + '</option>').join('');
    gsel.value = groupKey(NEWP.group);
  }
  $all('[data-cfg="tend.round"]').forEach(i => { if (document.activeElement !== i) i.value = ROUND[i.dataset.sub]; });
  $all('[data-cfg="tend.newPlant"]').forEach(i => { if (document.activeElement !== i && i.id !== 'np-group') i.value = NEWP[i.dataset.sub]; });
  const box = $id('import-box'); if (box && document.activeElement !== box) box.value = '';
  renderTtSettings();
}
function renderSeason() {
  const s = DB.settings.seasonSensitivity, m = new Date().getMonth();
  const val = $id('seasonVal'); if (val) val.textContent = Math.round(s * 100) + '%';
  const note = $id('seasonNote');
  if (note) note.textContent = s === 0
    ? 'Off — every month treated as summer.'
    : 'At ' + Math.round(s * 100) + '% — the slowest month stretches a fully seasonal plant to ' +
      Math.round((1 / (0.5 + 0.5 * Math.min(...GROWTH.map((_, i) => growthAt(i)))) - 1) * 100 * s) + '% longer than summer.';
  const stretch = Array.from({ length:12 }, (_, i) => 1 + (1 / (0.5 + 0.5 * growthAt(i)) - 1) * s);
  const max = Math.max.apply(null, stretch);
  const curve = $id('curve');
  if (curve) curve.innerHTML = stretch.map((v, i) =>
    '<div class="' + (i === m ? 'now' : '') + '" style="height:' + Math.max(6, (v / max) * 100) + '%"></div>').join('');
  const cx = $id('curveX');
  if (cx) cx.innerHTML = ['J','F','M','A','M','J','J','A','S','O','N','D'].map(l => '<span>' + l + '</span>').join('');
}
function exportText() { return JSON.stringify(DB, null, 2); }
function applyImport(txt) {
  let raw;
  try { raw = JSON.parse(txt); } catch { toast('not valid JSON'); return; }
  if (Array.isArray(raw)) raw = migrate(raw);                      // a v2 backup
  if (!raw || !Array.isArray(raw.plants) || !raw.plants.length) { toast('no plants in that file'); return; }
  DB = normalise(raw); save(); render(); renderSettings();
  toast('imported ' + DB.plants.length + ' plants');
}
function download() {
  const b = new Blob([exportText()], { type:'application/json' });
  const a = document.createElement('a');
  a.href = URL.createObjectURL(b); a.download = 'tend-' + todayISO() + '.json';
  a.click(); setTimeout(() => URL.revokeObjectURL(a.href), 1000); toast('downloaded');
}
async function copy() {
  try { await navigator.clipboard.writeText(exportText()); toast('copied'); }
  catch { toast('could not copy'); }
}

/* ── Todoist ────────────────────────────────────────────────────────────────
   Each plant due today is one task — "water basil" — in a project and section
   of your choosing, with a label, a priority and today's due date. The pushed
   task ids live in tend_todoist_v1 (NOT inside tend.v3: both apps' normalise()
   rebuilds that record from its known keys and would drop them). A tick in
   TEND, on DO's today block or in Todoist closes the task everywhere:
     · here → Todoist: doTasks / setDone / the detail sheet call ttClose;
       undo, a deleted entry or an untick call ttReopen
     · Todoist → here: on sync, a task pushed today that is no longer open and
       that we did not close ourselves was completed over there, so the care
       event is logged
   Sync only ever adds and closes; it never deletes a task. */
const TT_KEY = 'tend_todoist_v1';
const TT_DEF = { project:'04 | life', section:'home | chores', label:'home', priority:3,
                 push:true, showOnDo:true, projectId:null, sectionId:null, pushed:{}, lastSync:0 };
const TT_STALE = 10 * 60 * 1000;
let tt = { ...TT_DEF };
let ttBusy = false;

function ttLoad() {
  try { tt = Object.assign({ ...TT_DEF }, JSON.parse(localStorage.getItem(TT_KEY) || '{}') || {}); } catch { tt = { ...TT_DEF }; }
  if (!tt.pushed || typeof tt.pushed !== 'object') tt.pushed = {};
  ttPrune();
}
function ttPersist() { try { localStorage.setItem(TT_KEY, JSON.stringify(tt)); } catch {} }
// yesterday's pushed tasks are yesterday's: forget them, they are not ours to touch any more
function ttPrune() { const today = todayISO(); Object.keys(tt.pushed).forEach(k => { if (!tt.pushed[k] || tt.pushed[k].date !== today) delete tt.pushed[k]; }); }
const ttKey = (pid, type) => pid + ':' + type + ':' + todayISO();
const taskContent = (p, t) => t.label + ' ' + p.name.toLowerCase();
const loggedToday = (pid, type) => DB.events.some(e => e.plant === pid && e.type === type && e.date === todayISO());
const addDaysISO = (s, n) => { const d = D(s); d.setDate(d.getDate() + n); return isoOf(d); };

/* What DO's today block draws: everything due today (not yet done) and
   everything done today (so it can be unticked), in DO's row shape. */
function todayList() {
  const today = todayISO(), out = [];
  DB.plants.forEach(p => TASKS.forEach(t => {
    const st = status(p, t.key);
    const done = loggedToday(p.id, t.key);
    if (!done && !(st.tracked && !st.suspended && st.state === 'due')) return;
    const late = !done && st.over > 0;
    out.push({ id:'tend:' + p.id + ':' + t.key, pid:p.id, type:t.key, content:taskContent(p, t),
               glyph:p.glyph, room:roomName(p.room), done, late,
               due: late ? addDaysISO(today, -st.over) : today,
               labels: tt.label ? [tt.label] : [], priority: +tt.priority || 1,
               pushedId: (tt.pushed[ttKey(p.id, t.key)] || {}).id || null });
  }));
  out.sort((a, b) => (a.done - b.done) || (b.late - a.late) || a.content.localeCompare(b.content));
  return out;
}
function pushedIds() { ttPrune(); return new Set(Object.values(tt.pushed).map(r => String(r.id))); }
const showOnDo = () => !!tt.showOnDo;
function notifyDo() { if (window.DO && DO.renderToday) DO.renderToday(); }

async function ttClose(pid, type) {
  const rec = tt.pushed[ttKey(pid, type)];
  if (!rec || rec.closed || !Creds.token()) { notifyDo(); return; }
  try { await Todoist.call(`/tasks/${rec.id}/close`, { method:'POST' }); rec.closed = true; ttPersist(); }
  catch (e) { toast('todoist: ' + e.message); }
  notifyDo();
}
async function ttReopen(pid, type) {
  const rec = tt.pushed[ttKey(pid, type)];
  if (!rec || !rec.closed || !Creds.token()) { notifyDo(); return; }
  try { await Todoist.call(`/tasks/${rec.id}/reopen`, { method:'POST' }); rec.closed = false; ttPersist(); }
  catch (e) { toast('todoist: ' + e.message); }
  notifyDo();
}

/* DO's today block lands here. Done = log today's care event (once) and close
   the task; undone = drop today's event(s) of that kind and reopen it. */
function setDone(pid, type, done) {
  const p = DB.plants.find(x => x.id === pid), t = taskOf(type);
  if (!p || !t) return;
  if (done) {
    if (!loggedToday(pid, type)) {
      const id = logCare(pid, type, todayISO());
      save(); render(); offerUndo(t.verb + ' ' + p.name.toLowerCase(), [id]);
    }
    ttClose(pid, type);
  } else {
    DB.events = DB.events.filter(e => !(e.plant === pid && e.type === type && e.date === todayISO()));
    save(); render(); ttReopen(pid, type);
  }
  if (detailId) renderDetail();
  notifyDo();
}

async function ttResolve(force) {
  if (!force && tt.projectId && tt.sectionId) return;
  const r = await Todoist.resolve(tt.project, tt.section);
  tt.projectId = r.projectId; tt.sectionId = r.sectionId; ttPersist();
}

async function syncTodoist(quiet) {
  if (ttBusy) return;
  if (!Creds.token()) { if (!quiet) { toast('add a Todoist key in settings'); Shell.settings('data'); } return; }
  ttBusy = true; renderTtButtons(); ttStatus('syncing…', 'busy');
  const today = todayISO();
  try {
    await ttResolve();
    ttPrune();
    const open = await Todoist.getAll('/tasks', { project_id: tt.projectId, section_id: tt.sectionId });
    const openIds = new Set(open.map(t => String(t.id)));
    let pulled = 0, pushed = 0, closed = 0;

    // ── Todoist → TEND: pushed today, no longer open, not closed by us
    for (const key of Object.keys(tt.pushed)) {
      const rec = tt.pushed[key];
      if (rec.closed || openIds.has(String(rec.id))) continue;
      const [pid, type] = key.split(':');
      if (DB.plants.some(p => p.id === pid) && TASK_KEYS.includes(type) && !loggedToday(pid, type)) {
        logCare(pid, type, today); pulled++;
      }
      rec.closed = true;
    }
    if (pulled) { save(); render(); if (detailId) renderDetail(); }

    // ── TEND → Todoist: add what is due and not there yet, close what is done here
    if (tt.push) {
      for (const it of todayList()) {
        const key = ttKey(it.pid, it.type), rec = tt.pushed[key];
        if (it.done) {
          if (rec && !rec.closed) { await Todoist.call(`/tasks/${rec.id}/close`, { method:'POST' }); rec.closed = true; closed++; }
          continue;
        }
        if (rec) continue;
        const body = { content: it.content, project_id: tt.projectId, section_id: tt.sectionId,
                       due_string:'today', priority: +tt.priority || 1 };
        if (tt.label) body.labels = [tt.label];
        const made = await Todoist.call('/tasks', { method:'POST', body: JSON.stringify(body) });
        tt.pushed[key] = { id: String(made && made.id), date: today, closed:false };
        pushed++;
      }
    }
    tt.lastSync = Date.now(); ttPersist();
    notifyDo(); renderTtSettings();
    const parts = [];
    if (pushed) parts.push(`↑ ${pushed} added`);
    if (pulled) parts.push(`↓ ${pulled} logged here`);
    if (closed) parts.push(`✓ ${closed} closed`);
    const msg = parts.length ? parts.join(' · ') : 'already in sync';
    if (!quiet) toast(msg);
    ttStatus(msg, 'good');
  } catch (e) {
    if (!quiet) toast('todoist: ' + e.message);
    ttStatus(e.message, 'bad');
  } finally { ttBusy = false; renderTtButtons(); }
}
async function testTodoist() {
  if (ttBusy) return;
  if (!Creds.token()) { ttStatus('add your Todoist key under settings → data first', 'bad'); return; }
  ttBusy = true; renderTtButtons(); ttStatus('checking…', 'busy');
  try {
    await ttResolve(true);
    const open = await Todoist.getAll('/tasks', { project_id: tt.projectId, section_id: tt.sectionId });
    ttStatus(`connected — ${tt.project} › ${tt.section}, ${open.length} open task${open.length === 1 ? '' : 's'} there`, 'good');
  } catch (e) { ttStatus(e.message, 'bad'); }
  finally { ttBusy = false; renderTtButtons(); }
}
function maybeSync() {
  if (!tt.push || !Creds.token() || ttBusy) return;
  if (Date.now() - (tt.lastSync || 0) < TT_STALE) return;
  syncTodoist(true);
}
function saveTtSettings() {
  const v = id => { const el = $id(id); return el ? el.value.trim() : ''; };
  const project = v('tt-project') || TT_DEF.project, section = v('tt-section') || TT_DEF.section;
  if (project !== tt.project || section !== tt.section) { tt.projectId = null; tt.sectionId = null; }
  tt.project = project; tt.section = section;
  tt.label = v('tt-label').replace(/^@/, '');
  tt.priority = Math.max(1, Math.min(4, parseInt(v('tt-priority'), 10) || 1));
  ttPersist(); renderTtSettings(); notifyDo();
  toast('TEND target saved');
}
function ttStatus(msg, kind) {
  const el = $id('tt-status'); if (!el) return;
  el.textContent = msg; el.className = 'td-status' + (kind ? ' ' + kind : '');
}
function renderTtButtons() {
  $all('[data-td-btn]').forEach(b => { b.disabled = ttBusy; b.textContent = ttBusy ? (b.dataset.tdBusy || 'syncing…') : b.dataset.tdBtn; });
}
function renderTtSettings() {
  if (!$id('tt-project')) return;
  const fill = (id, val) => { const el = $id(id); if (el && document.activeElement !== el) el.value = val; };
  fill('tt-project', tt.project); fill('tt-section', tt.section); fill('tt-label', tt.label); fill('tt-priority', String(tt.priority));
  $id('tt-push').textContent = tt.push ? 'on' : 'off';
  $id('tt-show').textContent = tt.showOnDo ? 'on' : 'off';
  $id('tt-last').textContent = tt.lastSync
    ? 'last sync ' + new Date(tt.lastSync).toLocaleString('en-GB', { day:'numeric', month:'short', hour:'2-digit', minute:'2-digit' })
    : 'never synced';
}

/* ── One delegated listener ─────────────────────────────────────────────────
   Every button carries data-act; nothing user-supplied is ever interpolated
   into an attribute the browser will execute. The listener is on the document
   because TEND's markup is in three places — the slide, the overlays and the
   settings panel — and each carries .ns-tend. */
document.addEventListener('click', ev => {
  if (!ev.target.closest || !ev.target.closest('.ns-tend')) return;
  const t = ev.target.closest('[data-act]');
  const act = t && t.dataset.act;
  if (!act) return;

  if (act === 'open-detail') { ev.stopPropagation(); openDetail(t.dataset.p); return; }
  if (act === 'tab') { sub = t.dataset.view; render(); return; }
  if (act === 'add') { openEditor(); return; }
  if (act === 'do-task') {
    const p = DB.plants.find(x => x.id === t.dataset.p);
    const task = taskOf(t.dataset.t);
    if (p && task) doTasks([{ p, t:task }], task.verb + ' ' + p.name.toLowerCase());
    return;
  }
  if (act === 'do-room') {
    const room = t.dataset.room;
    const items = dueTasks().filter(it => roomName(it.p.room) === room);
    if (items.length) doTasks(items, 'did ' + items.length + ' in ' + room);
    return;
  }
  if (act === 'sort' || act === 'sortdef') {
    DB.settings.sort = t.dataset.s; save(); render();
    if (act === 'sortdef') renderSettings();
    return;
  }
  if (act === 'log') {
    const p = DB.plants.find(x => x.id === detailId);
    const d = $id('log-date').value || todayISO();
    const task = taskOf(t.dataset.t);
    if (p && task) { const id = logCare(p.id, task.key, d); save(); render(); renderDetail();
                     offerUndo(task.verb + ' ' + p.name.toLowerCase(), [id]);
                     if (d === todayISO()) ttClose(p.id, task.key); }
    return;
  }
  if (act === 'del-event') {
    const ev = DB.events.find(e => e.id === t.dataset.e);
    DB.events = DB.events.filter(e => e.id !== t.dataset.e);
    save(); render(); renderDetail(); toast('entry removed');
    if (ev && ev.date === todayISO()) ttReopen(ev.plant, ev.type);
    return;
  }
  if (act === 'tt-sync') { syncTodoist(); return; }
  if (act === 'tt-test') { testTodoist(); return; }
  if (act === 'tt-save') { saveTtSettings(); return; }
  if (act === 'tt-push') { tt.push = !tt.push; ttPersist(); renderTtSettings(); if (tt.push) syncTodoist(true); return; }
  if (act === 'tt-show') { tt.showOnDo = !tt.showOnDo; ttPersist(); renderTtSettings(); notifyDo(); return; }
  if (act === 'accept-suggest') {
    const p = DB.plants.find(x => x.id === detailId);
    if (p) { p.every.water = parseInt(t.dataset.v) || p.every.water; save(); render(); renderDetail(); toast('baseline updated'); }
    return;
  }
  if (act === 'edit-plant')   { openEditor(detailId); return; }
  if (act === 'close-detail') { closeSheet('detail'); return; }
  if (act === 'close-edit')   { closeSheet('edit'); return; }
  if (act === 'save-edit')    { saveEditor(); return; }
  if (act === 'delete-plant') { deletePlant(); return; }
  if (act === 'undo')         { undoLast(); return; }
  if (act === 'copy')         { copy(); return; }
  if (act === 'download')     { download(); return; }
  if (act === 'import') {
    const v = $id('import-box').value.trim();
    if (!v) { toast('nothing to import'); return; }
    applyImport(v); return;
  }
  if (act === 'reseed') {
    if (!Shell.confirm('Replace every plant and the whole care history with the starter plants?')) return;
    DB = blank(); DB.plants = seedPlants(); save(); render(); renderSettings(); toast('reset to starter plants'); return;
  }
  if (act === 'wipe') {
    if (!Shell.confirm('Delete every plant and the whole care history?')) return;
    DB = blank(); save(); render(); renderSettings(); toast('all plants deleted'); return;
  }
});

document.addEventListener('change', ev => {
  const el = ev.target;
  if (!el.closest || !el.closest('.ns-tend')) return;
  if (el.id === 'f-group') { groupNote(); return; }
  if (el.id === 'f-file') {
    const f = el.files && el.files[0]; el.value = '';
    if (!f) return;
    const r = new FileReader();
    r.onload = () => applyImport(String(r.result));
    r.onerror = () => toast('could not read that file');
    r.readAsText(f);
  }
});
document.addEventListener('input', ev => {
  const el = ev.target;
  if (el.id === 'f-season' && el.closest && el.closest('.ns-tend')) {
    DB.settings.seasonSensitivity = Math.max(0, Math.min(2, (+el.value || 0) / 100));
    save(); renderSeason(); render();
  }
});

/* ── Boot ──────────────────────────────────────────────────────────────────── */
load();
ttLoad();
render();
// DO booted first and drew its today block before TEND existed; tell it now
setTimeout(() => { notifyDo(); maybeSync(); }, 0);

/* Edited vocabulary redraws the round, the open sheet and the settings curve.
   Plants keep their group key; one whose type was deleted falls back to the
   default type for its season maths and shows under "other" on the shelf. */
Config.subscribe(path => {
  if (path !== '*' && !String(path).startsWith('tend.')) return;
  readConfig();
  render();
  renderSeason();
  if (detailId) renderDetail();
});
Prefs.subscribe(k => { if (k === 'dateFormat' || k === '*') render(); });

Shell.register('tend', {
  onShow: () => { render(); maybeSync(); },
  onDayChange: () => { ttPrune(); ttPersist(); render(); notifyDo(); },
});

return { render, renderSettings, openDetail, openEditor, closeSheet, undoLast,
         exportText, applyImport, status,
         todayList, setDone, pushedIds, showOnDo, syncTodoist, testTodoist };
})();
