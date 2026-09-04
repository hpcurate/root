/* ── LOG ──────────────────────────────────────────────────────────────────────
   Daily life tracker: morning/evening data, journal entries, history, weekly
   and monthly reports, JSON backup. Logic is unchanged from log/index.html.
   Merge-only changes: one IIFE published as window.LOG, DOM lookups scoped to
   .ns-log, the slide scrolls instead of the window, toast() goes to the shell.
   Storage keys are untouched: log_<date> and log-scale-v2. */
window.LOG = (function () {
'use strict';

const SCOPE = '.ns-log ';
const view  = document.querySelector('#view-log .view-body');   // the scroll container (Shell wraps it)
const $id   = id  => document.querySelector(SCOPE + '#' + id);
const $all  = sel => document.querySelectorAll(SCOPE + sel);
const toast = msg => Shell.toast(msg);

// ── Dates ─────────────────────────────────────────────────────────────────────
function localISO(d) {
  return `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}`;
}
let REAL_TODAY = localISO(new Date());
let TODAY = REAL_TODAY;

function dateOffset(base, n) {
  const d = new Date(base + 'T00:00:00');
  d.setDate(d.getDate() + n);
  return localISO(d);
}

function shiftDate(delta) { TODAY = dateOffset(TODAY, delta); initData(); refreshHome(); }
function resetDate()       { TODAY = REAL_TODAY; monthAnchor = null; initData(); refreshHome(); }
/* The month grid picks a day directly — the same selection the two arrows in
   the band move one step at a time. A day in the future is not offered. */
function pickDate(iso) {
  if (!iso || iso > REAL_TODAY) return;
  Prefs.tap();
  TODAY = iso; initData(); refreshHome();
}

/* Midnight with the app open. The selected day follows the calendar only when
   it was already "today" AND no form is open: an evening being written at
   00:10 belongs to the day that just ended, so the form keeps its day and the
   "today" button simply appears once you are back on the home screen. */
function rollDay(day) {
  const open = $all('.scr.on')[0];
  const id = open ? open.id.replace('s-', '') : 'home';
  const editing = ['morning', 'evening', 'entries'].includes(id);
  const follow = TODAY === REAL_TODAY && !editing;
  REAL_TODAY = day;
  if (follow) { TODAY = day; initData(); }
  ({ home: refreshHome, output: renderOutput, history: renderHistory })[id]?.();
}

function fmtDateShort(iso) {
  const d = new Date(iso + 'T00:00:00');
  return d.toLocaleDateString('en-GB', { day:'numeric', month:'short' }).toLowerCase();
}
function fmtDateLong(iso) {
  const d = new Date(iso + 'T00:00:00');
  return d.toLocaleDateString('en-GB', { weekday:'short', day:'numeric', month:'short' }).toUpperCase();
}
function fmtFilename(iso) {
  const [y,m,d] = iso.split('-');
  return `${y.slice(2)}.${m}.${d}`;
}

const MONTHS = ['jan','feb','mar','apr','may','jun','jul','aug','sep','oct','nov','dec'];

function isoWeekNum(iso) {
  const d = new Date(iso + 'T00:00:00');
  d.setDate(d.getDate() + 3 - (d.getDay() + 6) % 7);
  const w1 = new Date(d.getFullYear(), 0, 4);
  return 1 + Math.round(((d - w1) / 86400000 - 3 + (w1.getDay() + 6) % 7) / 7);
}

function weekMonday(iso) {
  const d = new Date(iso + 'T00:00:00');
  const day = d.getDay();
  const diff = day === 0 ? -6 : 1 - day;
  d.setDate(d.getDate() + diff);
  return localISO(d);
}

// ── Storage ───────────────────────────────────────────────────────────────────
const SK = () => 'log_' + TODAY;

/* One `meds_<key>` per configured slot, all false. A function declaration and
   a guard on purpose: fresh() can run while the module is still initialising,
   before medsCfg() below exists. */
function medFields() {
  const out = {};
  try { medKeys().forEach(k => { out['meds_' + k] = false; }); }
  catch { out.meds_lam = false; out.meds_rit = false; }
  return out;
}

function fresh() {
  return {
    date: TODAY,
    scale: 5,          // ratings are 1–5; older days are stamped by migrateScales()
    m: { wt:'', sl:'', nrg:'', mood:'', cs_on:null, cs:'', wkg:'', km:'', wo:'', tkg:'', tmin:'' },
    e: Object.assign(medFields(), { kme:'', nrg:'', mood:'', stress:'', meals:[],
         caf_c:0, caf_ed:0, cur_mix:0, cur_prod:0, cur_cont:0, blocks:[],
         /* what was finished on DO's media tab: { name, kind, sub } — a title,
            its label (movie / show / podcast / music) and the second label if any */
         media:[] }),
    entries: []
  };
}
const mediaOf = (e = {}) => Array.isArray(e.media) ? e.media : [];

/* Readers that understand both the old and new shapes, so days logged before
   this change still render, export and report correctly.
   Old: e.meds = 'yes'|'no' (both drugs at once), e.bmix = mixing blocks. */
/* The slots are Config's, read through the shipped record so an override
   written before a slot existed still shows it — the same merge plan.formFields
   uses, and safe for the same reason: a fixed set of keys with no deletion to
   express. */
const medsCfg = () => Object.assign({}, Config.defaults('log.meds'), Config.get('log.meds') || {});
const medKeys = () => Object.keys(medsCfg());
/* Which slots the *form* asks about. Every other reader — the record, the .md,
   the parser, the history pills, both reports — still walks medKeys(): a key is
   the contract and switching a slot off is a question you stop being asked, not
   a column that disappears. Exactly the rule §6 already states for log.fields.
   Merged through the defaults so an override written before a slot existed has
   no answer for it and reads as the shipped one. */
const medsOnCfg = () => Object.assign({}, Config.defaults('log.medsOn'), Config.get('log.medsOn') || {});
const medsShown = () => { const on = medsOnCfg(); return medKeys().filter(k => on[k] !== false); };
const medColor  = k => (Config.get('log.medColors') || {})[k] || 'var(--y)';
function medsOf(e = {}) {
  const keys = medKeys();
  const any = keys.some(k => e['meds_' + k] !== undefined);
  if (any) {
    const out = {};
    keys.forEach(k => { out[k] = !!e['meds_' + k]; });
    return out;
  }
  // Old: e.meds = 'yes'|'no', both drugs at once. A slot added since is not
  // something that day can answer for, so it stays false.
  const legacy = e.meds === 'yes';
  const out = {};
  keys.forEach(k => { out[k] = (k === 'lam' || k === 'rit') ? legacy : false; });
  return out;
}
function mealsOf(e = {}) { return Array.isArray(e.meals) ? e.meals : []; }
function curOf(e = {}) {
  return { mix: e.cur_mix ?? e.bmix ?? 0, prod: e.cur_prod ?? 0, cont: e.cur_cont ?? 0 };
}
function curTotal(e = {}) { const c = curOf(e); return c.mix + c.prod + c.cont; }

// ── 1–3 → 1–5 rescale ─────────────────────────────────────────────────────────
/* Energy, mood and stress moved from a 1–3 scale to 1–5. Old values are spread
   across the new range (low/mid/high keep their meaning) so averages and trend
   arrows stay comparable across the change. 4 and 5 are left alone, which makes
   this safe to run over already-converted data. */
const SCALE_MAP = { '1':'1', '2':'3', '3':'5' };
const SCALE_FLAG = 'log-scale-v2';   // NOT log_-prefixed: allLogKeys() would treat it as a day

/* Each day carries its own `scale` stamp, so converting is safe to attempt any
   number of times. A global flag alone would not be: mapping 3→5 a second time
   would silently inflate a rating the user actually entered on the new scale. */
function rescaleDay(d) {
  if (!d || Number(d.scale) >= 5) return 0;   // already on 1–5
  let changed = 0;
  const bump = (o, f) => {
    if (!o) return;
    const s = String(o[f] ?? '').trim();
    const next = SCALE_MAP[s];
    if (next === undefined || next === s) return;
    o[f] = next; changed++;
  };
  bump(d.m, 'nrg'); bump(d.m, 'mood');
  bump(d.e, 'nrg'); bump(d.e, 'mood'); bump(d.e, 'stress');
  d.scale = 5;
  return changed;
}

// One-time pass over everything already on this device. The flag is only a fast
// path — the per-day stamp is what actually guarantees this runs once.
function migrateScales() {
  if (localStorage.getItem(SCALE_FLAG)) return 0;
  let days = 0;
  allLogKeys().forEach(k => {
    let d; try { d = JSON.parse(localStorage.getItem(k)); } catch { return; }
    if (!d || Number(d.scale) >= 5) return;
    const changed = rescaleDay(d);
    localStorage.setItem(k, JSON.stringify(d));   // persist the stamp either way
    if (changed) days++;
  });
  localStorage.setItem(SCALE_FLAG, '1');
  return days;
}

let data;

function initData() {
  try {
    const raw = localStorage.getItem(SK());
    if (!raw) { data = fresh(); return; }
    data = JSON.parse(raw);
    if (!Array.isArray(data.e.blocks))       data.e.blocks = [];
    if (!Array.isArray(data.e.media))        data.e.media  = [];
    if (!Array.isArray(data.e.meals))        data.e.meals  = [];
    if (typeof data.e.caf_c  !== 'number')   data.e.caf_c  = 0;
    if (typeof data.e.caf_ed !== 'number')   data.e.caf_ed = 0;
    if (data.m.cs_on === undefined)          data.m.cs_on  = null;
    // fold the legacy shapes forward once, on read
    const meds = medsOf(data.e);
    Object.keys(meds).forEach(k => { data.e['meds_' + k] = meds[k]; });
    const cur = curOf(data.e);
    data.e.cur_mix = cur.mix; data.e.cur_prod = cur.prod; data.e.cur_cont = cur.cont;
  } catch { data = fresh(); }
}

function save() { localStorage.setItem(SK(), JSON.stringify(data)); }

function allLogKeys() {
  return Object.keys(localStorage).filter(k => k.startsWith('log_')).sort();
}

// ── Navigation ────────────────────────────────────────────────────────────────
let dirty = false;
function markDirty() { dirty = true; }

function go(id) {
  dirty = false;
  $all('.scr').forEach(s => s.classList.remove('on'));
  $id('s-' + id).classList.add('on');
  if (view) view.scrollTop = 0;
  ({ home:refreshHome, morning:popM, evening:popE, entries:renderEntries,
     output:renderOutput, history:renderHistory, reports:renderReports })[id]?.();
}

/* The one question that is not about clearing: it guards unsaved input, so it
   is asked even with "confirm before clearing" off — Shell.ask, not
   Shell.confirm. In the app's own dialog now like every other question. */
function goBack() {
  if (!dirty) { go('home'); return; }
  Shell.ask({ title: 'Go back without saving?', body: 'What you have typed on this form is lost.',
              yes: 'discard', danger: true, done: a => { if (a) go('home'); } });
}

// ── Home ──────────────────────────────────────────────────────────────────────
/* "Has this half of the day been logged?" used to mean "has a wake time" and
   "has an evening km figure". 2.0 made both fields optional, and with either
   switched off the card could never turn green and the streak could never
   grow. Any recorded value in that half now counts. */
const has = v => v !== '' && v !== null && v !== undefined && v !== false && v !== 0 &&
                 !(Array.isArray(v) && !v.length);
function morningLogged(d) {
  const m = d?.m;
  return !!m && (['wt','sl','nrg','mood','wkg','km','wo','tkg','tmin'].some(k => has(m[k])) ||
                 m.cs_on === true || m.cs_on === false);
}
function eveningLogged(d) {
  const e = d?.e;
  return !!e && (['kme','nrg','mood','stress','meals','blocks',
                  'caf_c','caf_ed','cur_mix','cur_prod','cur_cont','bmix'].some(k => has(e[k])) ||
                 medKeys().some(k => has(e['meds_' + k])) ||
                 e.meds === 'yes');
}
/* What a day needs before it extends the streak — Settings → content. */
function dayLogged(d) {
  const req = Config.get('log.streakRequires') || 'both';
  if (req === 'morning') return morningLogged(d);
  if (req === 'evening') return eveningLogged(d);
  return morningLogged(d) && eveningLogged(d);
}
function readDay(iso) {
  try { return JSON.parse(localStorage.getItem('log_' + iso)); } catch { return null; }
}
function calcStreak() {
  let streak = 0, d = REAL_TODAY;
  // today not being finished yet does not break a streak: start from yesterday
  if (!dayLogged(readDay(d))) d = dateOffset(d, -1);
  while (dayLogged(readDay(d))) { streak++; d = dateOffset(d, -1); }
  return streak;
}

function refreshHome() {
  // one date format for the whole app, set under Settings → behaviour
  $id('home-date').textContent = Prefs.formatDate(TODAY);
  $id('btn-today').classList.toggle('hidden', TODAY === REAL_TODAY);
  $id('card-m').classList.toggle('done', morningLogged(data));
  $id('card-e').classList.toggle('done', eveningLogged(data));
  const ec = data.entries.length;
  $id('en-ct').textContent = ec ? `${ec} entr${ec===1?'y':'ies'}` : 'no entries yet';
  const s = calcStreak();
  const el = $id('h-streak');
  el.innerHTML = s >= 2 ? `streak · <em>${s} days</em>` : '';
  renderMonth();
  refreshAlert();
}

/* ── The month, and the fortnight ──────────────────────────────────────────────
   LOG's home was six cards and a streak line, and the six cards are the least
   interesting thing on it: they are doors, and you already know where they go.
   What was missing was the answer to "how am I doing" — which needed opening
   History and scrolling.

   So the doors moved down and this took the space above them: a month of days,
   each drawn by how much of it was written, and a fortnight of energy and mood
   as two lines. Both are read straight out of the day records; nothing new is
   stored and nothing is derived that the reports do not already derive.

   A cell is also a control: tapping one selects that day, which is the same
   selection the two arrows in the band move by one. That is what makes it a
   calendar rather than a picture of one — a day three weeks ago used to be
   twenty taps away. */
let monthAnchor = null;              // the ISO day whose month is on screen
let trendBig = false;                // the fortnight, opened over the month

/* The chart takes the month's place rather than sitting under a squeezed one:
   at the height it has beside the calendar it can carry three lines and no
   labels, and labels are most of what makes a chart answerable. Tapping it
   again gives the month back. */
function toggleTrend() {
  if (!$id('log-cal')) return;
  trendBig = !trendBig;
  Prefs.tap();
  renderMonth();
}

function monthShift(n) {
  const base = monthAnchor || REAL_TODAY;
  const d = new Date(base + 'T00:00:00');
  d.setDate(1); d.setMonth(d.getMonth() + n);
  const next = localISO(d);
  // never past the current month: there is nothing to look at in the future
  if (next.slice(0, 7) > REAL_TODAY.slice(0, 7)) return;
  monthAnchor = next;
  Prefs.tap();
  renderMonth();
}

/* How much of a day was written, as 0–2. Morning and evening are the two halves
   the whole app is built around, so they are what the cell shows. */
function dayFill(iso) {
  const d = readDay(iso);
  if (!d) return 0;
  return (morningLogged(d) ? 1 : 0) + (eveningLogged(d) ? 1 : 0);
}

function renderMonth() {
  const box = $id('log-cal');
  if (!box) return;
  const anchor = monthAnchor || TODAY;
  const first = new Date(anchor + 'T00:00:00'); first.setDate(1);
  const y = first.getFullYear(), m = first.getMonth();
  const days = new Date(y, m + 1, 0).getDate();
  // Monday-first unless the week-start dial says otherwise — the same dial the
  // km chart reads, so the two never disagree about which column is which
  const sunFirst = Prefs.get('weekStart') === 'sun';
  const lead = (first.getDay() - (sunFirst ? 0 : 1) + 7) % 7;
  const heads = (sunFirst ? ['s','m','t','w','t','f','s'] : ['m','t','w','t','f','s','s'])
    .map(h => `<span class="lc-h">${h}</span>`).join('');

  const cells = [];
  for (let i = 0; i < lead; i++) cells.push('<span class="lc-c pad"></span>');
  for (let day = 1; day <= days; day++) {
    const iso = `${y}-${String(m + 1).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
    const future = iso > REAL_TODAY;
    const cls = ['lc-c', 'f' + (future ? 0 : dayFill(iso))];
    if (future) cls.push('future');
    if (iso === REAL_TODAY) cls.push('today');
    if (iso === TODAY) cls.push('sel');
    cells.push(`<button class="${cls.join(' ')}"${future ? ' disabled' : ''}
      data-day="${iso}" aria-label="${iso}">${day}</button>`);
  }

  const label = first.toLocaleDateString('en-GB', { month:'long', year:'numeric' });
  const atNow = `${y}-${String(m + 1).padStart(2, '0')}` >= REAL_TODAY.slice(0, 7);
  const month = `
    <div class="lc-head">
      <button class="lc-arr" data-month="-1" aria-label="previous month">
        <svg aria-hidden="true"><use href="#ico-chev-l"/></svg></button>
      <span class="lc-month">${esc(label)}</span>
      <button class="lc-arr" data-month="1"${atNow ? ' disabled' : ''} aria-label="next month">
        <svg aria-hidden="true"><use href="#ico-chev-r"/></svg></button>
    </div>
    <div class="lc-grid">${heads}${cells.join('')}</div>`;
  box.classList.toggle('big', trendBig);
  box.innerHTML = (trendBig ? '' : month) + trendHTML();
}

/* Fourteen days of energy, mood and stress, as three lines with a dot on every
   day that has a value. Stress is the third: it is recorded in the evening
   beside the other two, and reading the three together is most of what a
   fortnight is *for* — a good mood at high stress is a different fortnight from
   a good mood at low stress, and the two lines alone could not say so.

   The dots matter as much as the lines. A bare line says which way it went; a
   line of dots also says how often you actually answered, and a fortnight with
   four readings draws the same line as one with fourteen. */
function trendHTML() {
  const N = 14;
  const days = Array.from({ length: N }, (_, i) => readDay(dateOffset(REAL_TODAY, -(N - 1 - i))));
  // energy and mood are morning fields, stress is an evening one
  const series = (half, k) => days.map(d => (d && d[half] && +d[half][k]) || null);
  const nrg = series('m', 'nrg'), mood = series('m', 'mood'), stress = series('e', 'stress');
  const has = v => v.some(x => x);
  if (!has(nrg) && !has(mood) && !has(stress)) {
    return `<div class="lc-trend empty">two weeks of energy, mood and stress appear here once there is something to draw</div>`;
  }
  /* 1–5 up the box, one step per day across it. The line is joined only where
     consecutive days both have a value; a gap in the data is drawn as a gap,
     never as a line straight through it.

     The box is stretched (`preserveAspectRatio="none"`) so a fortnight always
     fills the width, whatever the phone — which means a `<circle>` in it would
     be drawn as an ellipse, wider than it is tall. So a dot is a **zero-length
     path with a round cap** and `vector-effect:non-scaling-stroke`: the cap is
     a circle whose diameter is the stroke width in *screen* pixels, so it is
     immune to the viewBox's scaling in both axes. Each is drawn twice, a
     surface-coloured halo under the colour, so three series crossing on the
     same day still read as three dots.

     PAD insets the plot from both ends. Half of the first and last dot used to
     hang over the edge, and — more to the point — the big chart's axis labels
     are placed at the same fractions, so they need somewhere to sit. */
  const W = 100, H = 40, PAD = 4;
  const x = i => PAD + (i / (N - 1)) * (W - PAD * 2);
  const y = v => H - (Math.max(1, Math.min(5, v)) - 1) / 4 * H;
  const path = vals => {
    let d = '', pen = false;
    vals.forEach((v, i) => {
      if (!v) { pen = false; return; }
      d += (pen ? 'L' : 'M') + x(i).toFixed(1) + ' ' + y(v).toFixed(1) + ' ';
      pen = true;
    });
    return d.trim();
  };
  const dots = (vals, cls) => vals.map((v, i) => {
    if (!v) return '';
    const d = `M${x(i).toFixed(1)} ${y(v).toFixed(1)}l.01 0`;
    return `<path class="lc-dh" d="${d}"/><path class="lc-d ${cls}" d="${d}"/>`;
  }).join('');
  const avg = v => { const f = v.filter(Boolean); return f.length ? (f.reduce((a, b) => a + b, 0) / f.length).toFixed(1) : '—'; };
  const line = (vals, cls) => has(vals)
    ? `<path class="lc-l ${cls}" d="${path(vals)}"/>${dots(vals, cls)}` : '';

  /* ── Opened up ───────────────────────────────────────────────────────────
     The axes only appear here, because they only fit here. Both are HTML
     rather than SVG text: the viewBox is stretched, so a <text> in it would be
     stretched too, and a label that is 1.4× as wide as it is tall is a label
     you have to work at. Each is absolutely placed at the same fraction the
     plot uses, so they line up by construction rather than by eye. */
  const scale = trendBig ? [5, 4, 3, 2, 1].map(v =>
    `<span style="top:${((5 - v) / 4 * 100).toFixed(2)}%">${v}</span>`).join('') : '';
  // the row sits under the plot and is inset by the same gutter, so a label at
  // x% of it is under the point at x% of the chart
  const xLabels = trendBig ? Array.from({ length: N }, (_, i) => {
    const iso = dateOffset(REAL_TODAY, -(N - 1 - i));
    return `<span style="left:${x(i).toFixed(2)}%">${+iso.slice(8)}</span>`;
  }).join('') : '';
  const grid = trendBig ? [1, 2, 3, 4, 5].map(v =>
    `<path class="lc-g" d="M${PAD} ${y(v).toFixed(1)}H${W - PAD}"/>`).join('') : '';

  return `<div class="lc-trend${trendBig ? ' big' : ''}" data-trend
      role="button" tabindex="0" aria-expanded="${trendBig}"
      aria-label="${trendBig ? 'close the trend' : 'open the trend'}">
    <div class="lc-plot">
      ${trendBig ? `<div class="lc-yax" aria-hidden="true">${scale}</div>` : ''}
      <svg class="lc-spark" viewBox="0 0 ${W} ${H}" preserveAspectRatio="none" aria-hidden="true">
        ${grid}${line(stress, 'stress')}${line(mood, 'mood')}${line(nrg, 'nrg')}
      </svg>
    </div>
    ${trendBig ? `<div class="lc-xax" aria-hidden="true">${xLabels}</div>` : ''}
    <div class="lc-key">
      <span class="lc-kk nrg">energy <b>${avg(nrg)}</b></span>
      <span class="lc-kk mood">mood <b>${avg(mood)}</b></span>
      <span class="lc-kk stress">stress <b>${avg(stress)}</b></span>
      <span class="lc-kn">${trendBig ? 'close' : '14d'}</span>
    </div>
  </div>`;
}

/* ── The tab alert ─────────────────────────────────────────────────────────────
   A log is only worth anything if it is written, and the two halves of the day
   have an hour by which they should be. Past that hour with the half still
   empty, LOG's tab icon becomes a "!" — the shell owns the nav, so this only
   ever asks it (Shell.alert), never touches a button itself.

   Three rules, each with its own hour under settings → apps → log:

     morning   nothing recorded in the morning half, past 10:00
     evening   nothing recorded in the evening half, past 21:00
     plan      nothing planned for tomorrow, past 21:00 — PLAN's queue and its
               sent history, counting only tasks that carry a block, because
               "planned" here means the blocks the day is built out of

   The state is derived, never stored: it is recomputed on the shell's minute
   tick, on every save, and whenever the day rolls. `alertTest` pins it to one
   rule for the preview in settings, and is the only thing that can make it
   lie — deliberately, so the icon can be seen without waiting for 21:00. */
const alertCfg = () => Object.assign({}, Config.defaults('log.alerts'), Config.get('log.alerts') || {});
const HHMM = /^(\d{1,2}):([0-5]\d)$/;
let alertTest = null;

/* ── The one flag that can be answered by looking ─────────────────────────────
   LOG's two rules clear themselves: writing the morning is what makes "morning
   not written" stop being true, so the flag going out *is* the work being done.
   PLAN's does not. "Nothing planned for tomorrow" is a prompt, and the honest
   answer to it is often "I know — I looked, and there is nothing to plan": you
   open PLAN, you see the empty queue, and the "!" is still there telling you
   something you have just checked.

   So opening PLAN while it is flagged dismisses it, for that day only. Stored
   rather than derived — the one piece of alert state that is — because "I have
   seen this" is a fact about you and cannot be recomputed from the record. It
   is keyed by the day it was dismissed on, so tomorrow's prompt is a new
   prompt; the key is hyphenated so `allLogKeys()` never mistakes it for a day,
   the same reason `log-scale-v2` is. */
const SEEN_KEY = 'log-alert-seen-v1';
function alertSeen() {
  try { return JSON.parse(localStorage.getItem(SEEN_KEY) || '{}') || {}; } catch { return {}; }
}
function dismissAlert(rule) {
  if (rule !== 'plan') return;                       // only the prompt is dismissible
  if (alertTest) return;                             // the settings preview outranks it
  if (!alertReasons().includes(rule)) return;        // nothing to dismiss
  const seen = alertSeen();
  seen[rule] = REAL_TODAY;
  try { localStorage.setItem(SEEN_KEY, JSON.stringify(seen)); } catch {}
  refreshAlert();
}

/* Minutes since local midnight for "HH:MM", or null when the rule is off. */
function hourOf(v) {
  const m = HHMM.exec(String(v || '').trim());
  return m ? +m[1] * 60 + +m[2] : null;
}
const nowMin = () => { const d = new Date(); return d.getHours() * 60 + d.getMinutes(); };

/* How much is planned for a day, from PLAN. Zero when PLAN is not there — a
   missing app is not a reason to nag. */
function plannedBlocks(iso) {
  const p = window.PLAN && PLAN.plannedOn ? PLAN.plannedOn(iso) : null;
  return p ? p.blocks : 1;
}

/* Which rule is firing, or null. The real today, always: the alert is about
   now, not about whichever day the history is being read on. */
/* Every rule that is firing, not just the first: the three no longer share one
   tab, so they can no longer share one answer. `alertReason()` is still the
   first of them, which is what the settings line reports. */
function alertReasons() {
  if (alertTest) return [alertTest];
  const a = alertCfg();
  if (a.on === false) return [];
  const now = nowMin(), rec = readDay(REAL_TODAY);
  const m = hourOf(a.morning), e = hourOf(a.evening), p = hourOf(a.plan);
  const out = [];
  if (m !== null && now >= m && !morningLogged(rec)) out.push('morning');
  if (e !== null && now >= e && !eveningLogged(rec)) out.push('evening');
  if (p !== null && now >= p && !plannedBlocks(dateOffset(REAL_TODAY, 1))) out.push('plan');
  return out;
}
/* What the tabs actually wear: every firing rule, less any that has been seen
   and dismissed today. Kept out of alertReasons() on purpose — dismissAlert()
   asks that one whether the rule is *true*, which is a different question from
   whether it is still worth showing. */
function alertShown() {
  if (alertTest) return alertReasons();              // the preview is meant to lie
  const seen = alertSeen();
  return alertReasons().filter(r => seen[r] !== REAL_TODAY);
}
function alertReason() { return alertReasons()[0] || null; }

const ALERT_SAYS = { morning: 'morning log not written', evening: 'evening log not written',
                     plan: 'nothing planned for tomorrow' };
/* ── Which tab wears which flag ───────────────────────────────────────────────
   An unwritten morning or evening is LOG's business and flags LOG. **An
   unplanned tomorrow is PLAN's**, and flags PLAN — it was on LOG only because
   LOG happens to own the rule, and a "!" on the log tab that means "go and use
   the other app" is a signpost pointing at the wrong door.

   LOG still owns all three: it holds the hours, the preview and the settings,
   and it is the only caller of Shell.alert for either tab. The two are
   independent now — a morning can be unwritten while tomorrow is planned, and
   both tabs answer for themselves. */
function refreshAlert() {
  const all = alertShown();
  const logWhy  = all.find(r => r === 'morning' || r === 'evening') || null;
  const planWhy = all.includes('plan') ? 'plan' : null;
  if (window.Shell && Shell.alert) {
    Shell.alert('log',  !!logWhy,  logWhy  ? ALERT_SAYS[logWhy]  : '');
    Shell.alert('plan', !!planWhy, planWhy ? ALERT_SAYS[planWhy] : '');
  }
  renderAlertSettings();
  return alertReason();
}

/* ── Settings ── */
function renderAlertSettings() {
  if (!$id('al-on')) return;
  const a = alertCfg();
  $id('al-on').textContent = a.on === false ? 'off' : 'on';
  [['al-morning','morning'], ['al-evening','evening'], ['al-plan','plan']].forEach(([id, k]) => {
    const el = $id(id);
    if (el && document.activeElement !== el) el.value = a[k] || '';
  });
  const why = alertTest || alertReason();
  const st = $id('al-status');
  if (st) {
    st.textContent = alertTest ? `preview · ${ALERT_SAYS[alertTest]} — the tab is showing a "!"`
                   : why ? `right now: ${ALERT_SAYS[why]}` : 'right now: nothing to flag';
    st.className = 'td-status' + (alertTest ? ' busy' : why ? ' bad' : ' good');
  }
  $all('[data-al-test]').forEach(b => b.classList.toggle('on', b.dataset.alTest === (alertTest || '')));
}
function toggleAlerts() {
  const a = alertCfg();
  Config.set('log.alerts', Object.assign(a, { on: a.on === false }));
  refreshAlert();
}
/* The hours are three text fields rather than <input type=time>: the native
   picker is a wheel for something typed in four keystrokes, and an empty field
   has to mean "never" — which a time input cannot express on every platform. */
function saveAlerts() {
  const a = alertCfg();
  ['morning','evening','plan'].forEach(k => {
    const el = $id('al-' + k); if (!el) return;
    const v = el.value.trim();
    a[k] = (v === '' || HHMM.test(v)) ? v : a[k];
  });
  Config.set('log.alerts', a);
  refreshAlert();
  toast('alert hours saved');
}
/* The preview: pins the icon to one rule so it can be looked at now. It stays
   pinned until it is switched off, and says so in the panel — an alert that
   silently un-pinned itself would be worse than one that has to be cleared. */
function testAlert(which) {
  alertTest = ['morning','evening','plan'].includes(which) ? which : null;
  const why = refreshAlert();
  toast(alertTest ? `previewing · ${ALERT_SAYS[alertTest]}` : why ? 'preview off · ' + ALERT_SAYS[why] : 'preview off');
}

// ── Scale / toggles ───────────────────────────────────────────────────────────
function sc(btn, id) {
  dirty = true;
  $id(id).querySelectorAll('.sc-b').forEach(b => b.classList.remove('on'));
  btn.classList.add('on');
  $id(id).dataset.v = btn.textContent.trim();
}
function scGet(id) { return $id(id)?.dataset.v || ''; }
function scSet(id, val) {
  if (!val) return;
  const row = $id(id); if (!row) return;
  row.dataset.v = String(val);
  row.querySelectorAll('.sc-b').forEach(b => b.classList.toggle('on', b.textContent.trim() === String(val)));
}

// ── Meds: selected = taken, unselected = not taken ────────────────────────────
function toggleMed(which) {
  if (!medKeys().includes(which)) return;
  dirty = true;
  data.e['meds_' + which] = !data.e['meds_' + which];
  syncMedsUI();
}
function syncMedsUI() {
  medKeys().map(id => [id, 'meds_' + id]).forEach(([id, k]) => {
    const on = !!data.e[k];
    // a slot added since the form was last drawn has no button yet
    const btn = $id('med-' + id), st = $id('med-' + id + '-s');
    if (btn) btn.classList.toggle('on', on);
    if (st) st.textContent = on ? 'yes' : 'no';
  });
}

// ── Meals: same yes/no behaviour, tracked per meal number ─────────────────────
function toggleMeal(n) {
  dirty = true;
  const i = data.e.meals.indexOf(n);
  if (i >= 0) data.e.meals.splice(i, 1); else data.e.meals.push(n);
  data.e.meals.sort((a, b) => a - b);
  syncMealsUI();
}
function syncMealsUI() {
  $all('#meal-g .meal-b').forEach((b, i) =>
    b.classList.toggle('on', data.e.meals.includes(i + 1)));
}

function setColdShower(on) {
  dirty = true; data.m.cs_on = on;
  $id('cs-tog').querySelectorAll('.cs-tog-b').forEach((b,i) => b.classList.toggle('on', on ? i===0 : i===1));
  $id('cs-sec').classList.toggle('hidden', !on);
  if (!on) $id('m-cs').value = '';
}
function syncColdShower(on, sec) {
  if (on === null) { $id('cs-tog').querySelectorAll('.cs-tog-b').forEach(b => b.classList.remove('on')); $id('cs-sec').classList.add('hidden'); return; }
  $id('cs-tog').querySelectorAll('.cs-tog-b').forEach((b,i) => b.classList.toggle('on', on ? i===0 : i===1));
  $id('cs-sec').classList.toggle('hidden', !on);
  $id('m-cs').value = sec || '';
}

function setWo(btn, val) {
  dirty = true;
  $id('wo4').querySelectorAll('.wo4-b').forEach(b => b.classList.remove('on','rest-on'));
  btn.classList.add(val === 'rest' ? 'rest-on' : 'on');
  $id('wo4').dataset.v = val;
  $id('wo-fields').classList.toggle('hidden', val === 'rest');
}
function woGet() { return $id('wo4')?.dataset.v || ''; }
function woSet(val) {
  if (!val) return;
  const row = $id('wo4'); if (!row) return;
  row.dataset.v = val;
  row.querySelectorAll('.wo4-b').forEach(b => {
    b.classList.remove('on','rest-on');
    if (b.textContent.trim() === val) b.classList.add(val === 'rest' ? 'rest-on' : 'on');
  });
  $id('wo-fields').classList.toggle('hidden', val === 'rest');
}

// ── Counters ──────────────────────────────────────────────────────────────────
function syncCafUI() {
  const c = data.e.caf_c, ed = data.e.caf_ed;
  $id('caf-c-n').textContent  = c;
  $id('caf-ed-n').textContent = ed;
  $id('caf-c-btn').classList.toggle('on', c > 0);
  $id('caf-ed-btn').classList.toggle('on', ed > 0);
}
function incCaf(t) { dirty=true; if(t==='c') data.e.caf_c++; else data.e.caf_ed++; syncCafUI(); }
function resetCaf() { data.e.caf_c=0; data.e.caf_ed=0; syncCafUI(); }

const CUR_KEYS = { mix:'cur_mix', prod:'cur_prod', cont:'cur_cont' };
function syncCurUI() {
  Object.entries(CUR_KEYS).forEach(([id, k]) => {
    const n = data.e[k] || 0;
    $id('cur-' + id + '-n').textContent = n;
    $id('cur-' + id + '-btn').classList.toggle('on', n > 0);
  });
}
function incCur(id)  { dirty = true; data.e[CUR_KEYS[id]] = (data.e[CUR_KEYS[id]] || 0) + 1; syncCurUI(); }
function resetCur()  { Object.values(CUR_KEYS).forEach(k => data.e[k] = 0); syncCurUI(); }

/* The cap used to be a constant; it is a setting now. Read it live rather than
   caching, so raising it in Settings takes effect without a reload. */
const maxBlocks = () => Config.get('log.maxBlocks') || 6;

/* The exported .md has always written six block columns and the Obsidian side
   parses that shape, so six is the floor: lowering the cap keeps the table
   identical (the extra columns come out empty, as they always did on a light
   day), and only deliberately raising it past six widens the table. */
const EXPORT_BLOCK_FLOOR = 6;
const exportBlockCols = () => Math.max(EXPORT_BLOCK_FLOOR, maxBlocks());

function toggleBlock(btn, name) {
  dirty=true;
  const idx = data.e.blocks.indexOf(name);
  if (idx >= 0) { data.e.blocks.splice(idx,1); btn.classList.remove('on'); }
  else { const m = maxBlocks();
         if(data.e.blocks.length>=m){toast(`max ${m} blocks`);return;}
         data.e.blocks.push(name); btn.classList.add('on'); }
  syncBlocks();   // the same name can sit in both strips
}
/* Matched on data-name, not the text: a planned chip also carries its project
   and time block as a caption. */
function syncBlocks() {
  $all('.blk-b').forEach(b => b.classList.toggle('on', data.e.blocks.includes(b.dataset.name ?? b.textContent.trim())));
}

/* ── Blocks planned in PLAN ───────────────────────────────────────────────────
   What PLAN queued or sent today, offered under the block buttons as extra
   blocks in the project's colour. Ticking one records the task name like any
   other block, so it lands in the .md block table and in the reports' block
   counts. Only drawn for the real today: a plan is for the day it was made. */
function renderPlanned() {
  const wrap = $id('blk-plan-wrap'), grid = $id('blk-plan');
  if (!wrap || !grid) return;
  const isToday = TODAY === REAL_TODAY;
  // PLAN's queue and what it sent, then the block-labelled tasks DO fetched
  // from Todoist (already ticked ones arrive selected, see setBlock)
  const fromPlan = (isToday && window.PLAN && PLAN.plannedToday) ? PLAN.plannedToday() : [];
  const fromDo = (isToday && window.DO && DO.blockTasks) ? DO.blockTasks().map(t =>
    ({ name:t.content, project:'todoist', block:t.block, time:null, color:t.color })) : [];
  const seen = new Set(), planned = [];
  fromDo.concat(fromPlan).forEach(p => {
    const k = String(p.name).trim().toLowerCase();
    if (!k || seen.has(k)) return;
    seen.add(k); planned.push(p);
  });
  wrap.classList.toggle('hidden', !planned.length);
  grid.innerHTML = planned.map(p => {
    const cap = [p.project, p.block, p.time].filter(Boolean).join(' · ');
    return `<button class="blk-b plan" data-name="${attrEsc(p.name)}" onclick="LOG.toggleBlock(this,'${attr(p.name)}')"
             style="--blk-c:${esc(p.color)};--blk-bg:${tint(p.color, 14)}">${esc(p.name)}${cap ? `<small>${esc(cap)}</small>` : ''}</button>`;
  }).join('');
  syncBlocks();
}

/* A block task ticked on DO's today view lands here as a completed block for
   the real today — written straight to the day record, so it is in the note
   whether or not the evening form is ever opened; unticking takes it out. The
   cap still applies on the way in. */
function setBlock(name, on) {
  name = String(name || '').trim();
  if (!name) return;
  const isToday = TODAY === REAL_TODAY;
  // today's record: the live one if that is the selected day, else straight from storage
  const rec = isToday ? data : (readDay(REAL_TODAY) || Object.assign(fresh(), { date: REAL_TODAY }));
  if (!Array.isArray(rec.e.blocks)) rec.e.blocks = [];
  const i = rec.e.blocks.indexOf(name);
  if (on && i < 0) {
    if (rec.e.blocks.length >= maxBlocks()) { toast(`max ${maxBlocks()} blocks`); return; }
    rec.e.blocks.push(name);
  } else if (!on && i >= 0) rec.e.blocks.splice(i, 1);
  else return;
  localStorage.setItem('log_' + REAL_TODAY, JSON.stringify(rec));
  if (!isToday) return;
  const open = $all('.scr.on')[0];
  const id = open ? open.id.replace('s-', '') : 'home';
  if (id === 'evening') { renderPlanned(); syncBlocks(); }
  if (id === 'home') refreshHome();
}

/* ── Media, from DO's media tab ───────────────────────────────────────────────
   A media task ticked on DO lands in the real today's record as a finished
   title — straight to storage, like a block — and comes out again on untick.
   Matched on title + label, since the Todoist id is not kept in the record. */
const mediaKey = m => `${String(m.kind || '').toLowerCase()}::${String(m.name || m.content || '').trim().toLowerCase()}`;
function setMedia(task, on) {
  const item = { name: String(task.content ?? task.name ?? '').trim(), kind: String(task.kind || '').trim(), sub: String(task.sub || '').trim() };
  if (!item.name) return;
  const isToday = TODAY === REAL_TODAY;
  const rec = isToday ? data : (readDay(REAL_TODAY) || Object.assign(fresh(), { date: REAL_TODAY }));
  if (!Array.isArray(rec.e.media)) rec.e.media = [];
  const i = rec.e.media.findIndex(m => mediaKey(m) === mediaKey(item));
  if (on && i < 0) rec.e.media.push(item);
  else if (!on && i >= 0) rec.e.media.splice(i, 1);
  else return;
  localStorage.setItem('log_' + REAL_TODAY, JSON.stringify(rec));
  // nothing on the forms shows it — it is in the note, the reports and the
  // history, and DO's own tile is where it is ticked
}

/* ── Config-driven form furniture ─────────────────────────────────────────────
   The evening and morning forms used to be nine hardcoded block buttons, two
   named medications, four meals and three curate counters written straight into
   index.html. They are built from Config here instead, keeping the exact ids and
   classes the sync* functions already look for, so nothing downstream changed.

   A colour is turned into the two custom properties each control expects; the
   translucent variant is mixed in CSS rather than hand-written as an rgba(). */
function tint(hex, pct) { return `color-mix(in srgb, ${hex} ${pct}%, transparent)`; }

/* For a Config value that ends up inside onclick="…('…')": JS-string escaped,
   then attribute escaped. A block called "it's" used to be a syntax error. */
function attr(s) {
  return String(s ?? '').replace(/\\/g, '\\\\').replace(/'/g, "\\'")
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}
/* For a plain attribute value (data-name): esc() leaves quotes alone, which is
   fine for text and fatal inside data-name="…". */
function attrEsc(s) { return esc(s ?? '').replace(/"/g, '&quot;'); }

function renderForms() {
  const cfg = {
    blocks: Config.get('log.blocks'),
    meds:   medsCfg(),
    // the editor's number field can be emptied mid-edit; never draw zero meals
    meals:  Math.max(1, Math.min(12, parseInt(Config.get('log.mealCount'), 10) || 4)),
    mealLabel: Config.get('log.mealLabel'),
    caf:    Config.get('log.caffeine'),
    curate: Config.get('log.curate'),
    scales: Config.get('log.scales'),
    workouts: Config.get('log.workouts'),
  };

  // workout types
  const wo = $id('wo4');
  if (wo) wo.innerHTML = cfg.workouts.map(w =>
    `<button class="wo4-b" onclick="LOG.setWo(this,'${attr(w)}')">${esc(w)}</button>`).join('');

  /* meds — fixed keys, free labels, as many as Config holds, and only the ones
     switched on. Its colour rides on --med-c rather than on a selector per key,
     so a slot added later reads as itself without a line of CSS. */
  const medG = $id('med-g');
  if (medG) medG.innerHTML = medsShown().map(k =>
    `<button class="med-b ${esc(k)}" id="med-${esc(k)}" style="--med-c:${esc(medColor(k))}"
             onclick="LOG.toggleMed('${attr(k)}')">
       <span class="med-name">${esc(cfg.meds[k])}</span>
       <span class="med-state" id="med-${esc(k)}-s">no</span>
     </button>`).join('');

  // meals — count is a setting
  const mealG = $id('meal-g');
  if (mealG) mealG.innerHTML = Array.from({ length: cfg.meals }, (_, i) =>
    `<button class="meal-b" onclick="LOG.toggleMeal(${i + 1})">${esc(cfg.mealLabel)} ${i + 1}</button>`).join('');

  // caffeine — two fixed counters, free labels
  const cafR = $id('caf-row');
  if (cafR) cafR.innerHTML = ['c','ed'].map(k =>
    `<button class="caf-b" id="caf-${k}-btn" onclick="LOG.incCaf('${k}')">
       <span class="cnt-n" id="caf-${k}-n">0</span>
       <span class="cnt-l">${esc(cfg.caf[k])}</span>
     </button>`).join('');

  // blocks
  const blkG = $id('blk-g');
  if (blkG) blkG.innerHTML = cfg.blocks.map(b =>
    `<button class="blk-b" data-name="${attrEsc(b.name)}" onclick="LOG.toggleBlock(this,'${attr(b.name)}')"
             style="--blk-c:${esc(b.color)};--blk-bg:${tint(b.color, 14)}">${esc(b.name)}</button>`).join('');
  const hint = $id('blk-max-hint');
  if (hint) hint.textContent = `(max ${maxBlocks()})`;

  // curate — three fixed counters, free labels and colours
  const curG = $id('cur-g');
  if (curG) curG.innerHTML = ['mix','prod','cont'].map(k =>
    `<button class="cur-b" id="cur-${k}-btn" onclick="LOG.incCur('${k}')"
             style="--cur-c:${esc(cfg.curate[k].color)};--cur-bg:${tint(cfg.curate[k].color, 13)}">
       <span class="cnt-n" id="cur-${k}-n">0</span>
       <span class="cnt-l">${esc(cfg.curate[k].label)}</span>
     </button>`).join('');

  // scale endpoints
  $all('.sc-ends[data-scale]').forEach(row => {
    const s = cfg.scales[row.dataset.scale];
    if (!s) return;
    const spans = row.querySelectorAll('span');
    if (spans[0]) spans[0].textContent = s.low;
    if (spans[1]) spans[1].textContent = s.high;
  });

  applyFieldVisibility();
}

/* Hiding a field never touches what is already recorded: the input keeps its
   value, save* still reads it, and the .md export still writes the column. Turn
   the field back on and yesterday's number is exactly where it was. */
function applyFieldVisibility() {
  const f = Config.get('log.fields') || {};
  $all('[data-field]').forEach(el => {
    const on = f[el.dataset.field] !== false;
    el.classList.toggle('hidden', !on);
  });
  // the workout detail block is only shown when a non-rest workout is picked
  if (f.workout !== false) $id('wo-fields')?.classList.toggle('hidden', woGet() === 'rest');
}

// ── Last weight ───────────────────────────────────────────────────────────────
function lastWeight() {
  for (let i=1; i<=30; i++) {
    try { const d = JSON.parse(localStorage.getItem('log_'+dateOffset(TODAY,-i))); if(d?.m?.wkg) return d.m.wkg; } catch {}
  }
  return null;
}

// ── Morning ───────────────────────────────────────────────────────────────────
function popM() {
  const m = data.m;
  $id('m-wt').value  = m.wt  || '';
  $id('m-sl').value  = m.sl  || '';
  scSet('sc-nrg-m', m.nrg); scSet('sc-mood-m', m.mood);
  syncColdShower(m.cs_on, m.cs);
  $id('m-wkg').value = m.wkg || '';
  $id('m-km').value  = m.km  || '';
  woSet(m.wo);
  $id('m-tkg').value  = m.tkg  || '';
  $id('m-tmin').value = m.tmin || '';
  const lw = lastWeight();
  $id('last-weight').textContent = lw ? `last: ${lw} kg` : '';
}

/* Decimal fields are free text (see the note in index.html); the shell already
   swaps the comma for a dot as you type, this is the belt to that brace. */
const num = v => String(v ?? '').trim().replace(/,/g, '.');

function saveMorning() {
  const cs_on = data.m.cs_on;
  data.m = { wt:$id('m-wt').value, sl:num($id('m-sl').value),
             nrg:scGet('sc-nrg-m'), mood:scGet('sc-mood-m'), cs_on,
             cs: cs_on ? $id('m-cs').value : '',
             wkg:num($id('m-wkg').value), km:num($id('m-km').value),
             wo:woGet(), tkg:$id('m-tkg').value, tmin:$id('m-tmin').value };
  save(); toast('Morning saved'); go('home');
}

// ── Evening ───────────────────────────────────────────────────────────────────
function popE() {
  const e = data.e;
  $id('e-kme').value = e.kme || '';
  scSet('sc-nrg-e', e.nrg); scSet('sc-mood-e', e.mood); scSet('sc-stress', e.stress);
  syncMedsUI(); syncMealsUI(); syncCafUI(); syncCurUI(); renderPlanned(); syncBlocks();
}

function saveEvening() {
  data.e.kme    = num($id('e-kme').value);
  data.e.nrg    = scGet('sc-nrg-e');
  data.e.mood   = scGet('sc-mood-e');
  data.e.stress = scGet('sc-stress');
  save(); toast('Evening saved'); go('home');
}

// ── Entries ───────────────────────────────────────────────────────────────────
function addEntry() {
  const ta = $id('et'), txt = ta.value.trim(); if(!txt) return;
  const now = new Date();
  data.entries.push({ time:`${String(now.getHours()).padStart(2,'0')}:${String(now.getMinutes()).padStart(2,'0')}`, text:txt });
  save(); ta.value=''; dirty=false; renderEntries(); toast('Entry saved');
}

function deleteEntry(idx) {
  data.entries.splice(idx,1); save(); renderEntries(); toast('Entry deleted');
}

function renderEntries() {
  const list = $id('e-list');
  if (!data.entries.length) { list.innerHTML='<div class="e-none">no entries yet</div>'; return; }
  list.innerHTML = data.entries.map((en,i) => `
    <div class="e-item">
      <div class="e-body"><div class="e-time">${en.time}</div><div class="e-txt">${esc(en.text)}</div></div>
      <button class="e-del" onclick="LOG.deleteEntry(${i})">✕</button>
    </div>`).reverse().join('');
}

// ── Build daily note ──────────────────────────────────────────────────────────
function buildNote() {
  const m=data.m, e=data.e;
  const bl=e.blocks||[], b=Array.from({length:exportBlockCols()},(_,i)=>bl[i]||'');
  const ents = data.entries.map(en=>` > ${en.time} - ${en.text}`).join('\n\n');
  const kmM=parseFloat(m.km)||0, kmE=parseFloat(e.kme)||0;
  const kmTot = (m.km!==''||e.kme!=='') ? (kmM+kmE).toFixed(1) : '';
  const cafParts=[]; if(e.caf_c>0) cafParts.push(`${e.caf_c}c`); if(e.caf_ed>0) cafParts.push(`${e.caf_ed}ed`);
  const caf = cafParts.length ? cafParts.join(' ') : '-';
  const meds = medsOf(e), cur = curOf(e);
  const meals = mealsOf(e);
  const mealsCell = meals.length ? meals.join(',') : '-';
  const csVal = m.cs_on===true ? (m.cs||'0') : m.cs_on===false ? '0' : '';
  const isRest = m.wo==='rest';
  const woRows = isRest ? `| workout_focus | rest |` : `| workout_focus | ${m.wo||''} |\n| total_kg      | ${m.tkg||''} |\n| time_min      | ${m.tmin||''} |`;
  const st = studyOf(TODAY);
  const studyRows = st ? `

#### study

| data          | ans |
| ------------- | --: |
| cap_topics    | ${st.topics.length} |
| cap_done      | ${st.topics.map(t => t.title).join('; ') || '-'} |
| cap_progress  | ${st.progress.done}/${st.progress.total} |
| anki_rated    | ${st.rated} |
| anki_acquired | ${st.acquired} |
| anki_decks    | ${Object.entries(st.decks).map(([d, n]) => `${d} ${n}`).join(', ') || '-'} |` : '';
  const mediaRows = mediaNoteRows(mediaOf(e));
  return (
`*:LiCalendar: ${TODAY}*
## planning

#### blocks

|    #     | ${b.map((_, i) => 'block ' + (i + 1)).join(' | ')} |
| :------: | ${b.map(() => ':-----:').join(' | ')} |
| activity | ${b.join(' | ')} |

#### workout

| item          |   r |
| ------------- | --: |
${woRows}

## journal

#### entries

${ents}

## data
#### morning data

| data          | ans |
| ------------- | --: |
| wakeup_time   | ${m.wt||''} |
| sleep_hours   | ${m.sl||''} |
| nrg_morning   | ${m.nrg||''} |
| mood_morning  | ${m.mood||''} |
| cold_shower_s | ${csVal} |
| weight_kg     | ${m.wkg||''} |
| km_walked_m   | ${m.km||''} |
| scale         | 1-5 |

#### evening data

| data          | ans |
| ------------- | --: |
| km_walked_e   | ${e.kme||''} |
| km_walked_tot | ${kmTot} |
| nrg_evening   | ${e.nrg||''} |
| mood_evening  | ${e.mood||''} |
| stress        | ${e.stress||''} |
${Object.keys(meds).map(k => `| ${('meds_' + k).padEnd(13)} | ${meds[k]?'yes':'no'} |`).join('\n')}
| meals         | ${mealsCell} |
| meals_count   | ${meals.length} |
| caffeine      | ${caf} |

#### curate output

| data          | ans |
| ------------- | --: |
| curate_mix    | ${cur.mix} |
| curate_prod   | ${cur.prod} |
| curate_cont   | ${cur.cont} |
| curate_total  | ${cur.mix + cur.prod + cur.cont} |${studyRows}${mediaRows}`);
}

/* ── Media in the note ────────────────────────────────────────────────────────
   Only on a day something was finished, so older notes are untouched and the
   parser (which looks rows up by key) reads it as additive. One row per label
   present — media_movie, media_music … — titles joined by "; ", the second
   label in brackets: `Blonde (album)`. */
function mediaNoteRows(list) {
  if (!list.length) return '';
  const byKind = {};
  list.forEach(m => { const k = String(m.kind || 'other').toLowerCase(); (byKind[k] = byKind[k] || []).push(m); });
  const cell = m => m.name.replace(/;/g, ',') + (m.sub ? ` (${m.sub})` : '');
  return `

#### media

| data          | ans |
| ------------- | --: |
| media_count   | ${list.length} |
${Object.keys(byKind).map(k => `| media_${k.replace(/[^a-z0-9_]/g, '_')} | ${byKind[k].map(cell).join('; ')} |`).join('\n')}`;
}
/* The inverse, for the report parser: every media_<kind> row back into items. */
function parseMediaRows(content) {
  const out = [];
  const re = /^[^\S\n]*\|[^\S\n]*media_([a-z0-9_]+)[^\S\n]*\|(.*)\|[^\S\n]*$/gim;
  let m;
  while ((m = re.exec(content)) !== null) {
    if (m[1] === 'count') continue;
    m[2].split(';').map(s => s.trim()).filter(Boolean).forEach(s => {
      const sub = (s.match(/\(([^()]*)\)\s*$/) || [])[1] || '';
      out.push({ name: s.replace(/\s*\([^()]*\)\s*$/, '').trim(), kind: m[1], sub: sub.trim() });
    });
  }
  return out;
}

/* ── Study, from TRACK and LEARN ──────────────────────────────────────────────
   The CAP topics ticked on that day and the Anki cards rated on it. Both apps
   expose a synchronous reader over their own storage; LOG stores nothing, it
   only reads at note time. Null when the day had neither, so the section only
   appears on a day that was actually a study day — the parser ignores rows it
   does not know, so an extra section is additive. */
function studyOf(iso) {
  const topics = window.TRACK && TRACK.doneOn ? TRACK.doneOn(iso) : [];
  const progress = window.TRACK && TRACK.progress ? TRACK.progress() : { done:0, total:0 };
  const st = window.LEARN && LEARN.dailyStats ? LEARN.dailyStats(iso) : { rated:0, acquired:0, decks:{} };
  if (!topics.length && !st.rated) return null;
  return { topics, progress, rated:st.rated, acquired:st.acquired, decks:st.decks };
}

// ── Output ────────────────────────────────────────────────────────────────────
function renderOutput() {
  const note = buildNote();
  $id('out-pre').textContent = note;
  const tags = $id('out-tags'); tags.innerHTML = '';
  const tag = (label,ok) => { const t=document.createElement('span'); t.className=`out-tag ${ok?'ok':'no'}`; t.textContent=label; tags.appendChild(t); };
  tag('morning', morningLogged(data)); tag('evening', eveningLogged(data));
  const ec=data.entries.length; tag(`${ec} entr${ec===1?'y':'ies'}`, ec>0);
  const st = studyOf(TODAY);
  if (st) {
    if (st.topics.length) tag(`${st.topics.length} topic${st.topics.length===1?'':'s'}`, true);
    if (st.rated) tag(`${st.rated} card${st.rated===1?'':'s'}`, true);
  }
  const md = mediaOf(data.e).length;
  if (md) tag(`${md} media`, true);
}

async function shareFile() {
  const note=buildNote(), filename=fmtFilename(TODAY)+'.md';
  try {
    const file=new File([note],filename,{type:'text/plain'});
    if(navigator.canShare?.({files:[file]})){await navigator.share({files:[file]});return;}
    if(navigator.share){await navigator.share({title:filename,text:note});return;}
  } catch(err){if(err.name==='AbortError') return;}
  const a=document.createElement('a');
  a.href=URL.createObjectURL(new Blob([note],{type:'text/plain'}));
  a.download=filename; a.click();
}

async function copyAll() {
  const btn=$id('btn-copy'), note=buildNote();
  try{await navigator.clipboard.writeText(note);}
  catch{const ta=Object.assign(document.createElement('textarea'),{value:note});ta.style.cssText='position:fixed;opacity:0;top:0;left:0';document.body.appendChild(ta);ta.select();document.execCommand('copy');document.body.removeChild(ta);}
  btn.textContent='✓ copied'; btn.classList.add('ok');
  setTimeout(()=>{btn.textContent='copy all';btn.classList.remove('ok');},2200);
}

// ── Trend indicator helper ────────────────────────────────────────────────────
// higher_is_better: if true, up = positive; if false (stress), down = positive
function trendBadge(curr, prev, higherIsBetter=true) {
  if (!curr || !prev) return `<div class="ti neu">—</div>`;
  const c=parseFloat(curr), p=parseFloat(prev);
  if (isNaN(c)||isNaN(p)||c===p) return `<div class="ti neu">—</div>`;
  const up = c > p;
  const positive = higherIsBetter ? up : !up;
  return `<div class="ti ${positive?'pos':'neg'}">${up?'▲':'▼'}</div>`;
}

// ── Weekly km chart ───────────────────────────────────────────────────────────
/* The daily target was a constant; it is Settings → content now. Read live. */
const kmTarget = () => Number(Config.get('log.kmTarget')) || 6;
const DAY_LBL = ['M','T','W','T','F','S','S'];

/* First day of the week that holds `iso`, honouring Settings → behaviour →
   "week starts on". Only the km chart uses it: the reports keep ISO weeks,
   because their "wk 36" numbering is ISO and ISO weeks start on Monday. */
function weekStartOf(iso) {
  if ((Prefs.get('weekStart') || 'mon') === 'sun') {
    const d = new Date(iso + 'T00:00:00');
    d.setDate(d.getDate() - d.getDay());
    return localISO(d);
  }
  return weekMonday(iso);
}

function dayTotalKm(iso) {
  let d; try { d = JSON.parse(localStorage.getItem('log_' + iso)); } catch {}
  if (!d) return null;
  const hasKm = d.m?.km || d.e?.kme;
  if (!hasKm) return null;
  return (parseFloat(d.m?.km) || 0) + (parseFloat(d.e?.kme) || 0);
}

function renderKmChart() {
  const KM_TARGET = kmTarget();
  const mon = weekStartOf(REAL_TODAY);
  const days = [];
  for (let i = 0; i < 7; i++) {
    const iso = dateOffset(mon, i);
    days.push({ iso, km: dayTotalKm(iso), future: iso > REAL_TODAY, today: iso === REAL_TODAY });
  }
  const logged   = days.filter(d => d.km !== null);
  const weekTot  = logged.reduce((s, d) => s + d.km, 0);
  const weekGoal = Math.round(KM_TARGET * 7 * 10) / 10;
  const hitDays  = logged.filter(d => d.km >= KM_TARGET).length;

  // scale so both the tallest bar and the target line stay visible
  const maxKm   = Math.max(0, ...days.map(d => d.km || 0));
  const usable  = 104;        // px of bar area below the value-label gutter
  const scale   = Math.max(KM_TARGET * 1.25, maxKm * 1.08, 4);
  const targetPx = (KM_TARGET / scale) * usable;

  const cols = days.map(d => {
    if (d.km === null) {
      return `<div class="kmc-col"><div class="kmc-bar" style="height:2px;opacity:${d.future?'.25':'.45'}"></div></div>`;
    }
    const h = Math.max(2, Math.round((d.km / scale) * usable));
    const cls = `kmc-bar${d.km >= KM_TARGET ? ' hit' : ''}`;
    return `<div class="kmc-col">
      <div class="kmc-val">${d.km.toFixed(1)}</div>
      <div class="${cls}" style="height:${h}px"></div>
    </div>`;
  }).join('');

  return `<div class="kmc">
    <div class="kmc-head">
      <span class="kmc-title">walked · this week</span>
      <span class="kmc-sub">wk ${String(isoWeekNum(REAL_TODAY)).padStart(2,'0')}</span>
    </div>
    <div class="kmc-total">${weekTot.toFixed(1)}<em> / ${weekGoal} km</em></div>
    <div class="kmc-goal">target <b>${KM_TARGET} km/day</b> · ${hitDays}/7 days hit</div>
    <div class="kmc-chart">
      <div class="kmc-target" style="bottom:${targetPx.toFixed(1)}px"><span class="kmc-target-lbl">${KM_TARGET}</span></div>
      ${cols}
    </div>
    <div class="kmc-days">${days.map(d => `<span class="kmc-day${d.today?' now':''}">${DAY_LBL[(new Date(d.iso+'T00:00:00').getDay()+6)%7]}</span>`).join('')}</div>
  </div>`;
}

// ── History ───────────────────────────────────────────────────────────────────
function renderHistory() {
  const container=$id('hist-list');
  const rows = [];
  for (let i=1; i<=14; i++) {
    const date=dateOffset(REAL_TODAY,-i), prev=dateOffset(REAL_TODAY,-i-1);
    let d, dp;
    try{d=JSON.parse(localStorage.getItem('log_'+date));}catch{}
    try{dp=JSON.parse(localStorage.getItem('log_'+prev));}catch{}
    if(!d){rows.push(`<div class="hist-day"><div class="hist-date">${fmtDateLong(date)}</div><div style="color:var(--mu);font-size:11px">no data</div></div>`);continue;}

    const m=d.m||{}, e=d.e||{};
    const pm=dp?.m||{}, pe=dp?.e||{};
    const cafParts=[]; if((e.caf_c||0)>0)cafParts.push(`${e.caf_c}c`);if((e.caf_ed||0)>0)cafParts.push(`${e.caf_ed}ed`);
    const caf=cafParts.join(' ')||'-';
    const kmM=parseFloat(m.km)||0, kmE=parseFloat(e.kme)||0;
    const kmTot=(m.km||e.kme)?(kmM+kmE).toFixed(1)+'km':'—';
    const prevKm=((parseFloat(pm.km)||0)+(parseFloat(pe.kme)||0))||null;
    const blocks=(e.blocks||[]).join(' · ')||'—';
    const meds=medsOf(e), meals=mealsOf(e), curT=curTotal(e);
    const media=mediaOf(e);

    rows.push(`<div class="hist-day">
      <div class="hist-date">${fmtDateLong(date)}</div>
      <div class="hist-metrics">
        <div class="hist-cell">
          <div class="hist-cell-top"><span class="hist-val">${m.nrg||'—'}</span>${trendBadge(m.nrg,pm.nrg,true)}</div>
          <div class="hist-key">nrg ↑</div>
        </div>
        <div class="hist-cell">
          <div class="hist-cell-top"><span class="hist-val">${m.mood||'—'}</span>${trendBadge(m.mood,pm.mood,true)}</div>
          <div class="hist-key">mood ↑</div>
        </div>
        <div class="hist-cell">
          <div class="hist-cell-top"><span class="hist-val">${e.stress||'—'}</span>${trendBadge(e.stress,pe.stress,false)}</div>
          <div class="hist-key">stress ↓</div>
        </div>
        <div class="hist-cell">
          <div class="hist-cell-top"><span class="hist-val">${m.wkg||'—'}</span>${trendBadge(m.wkg,pm.wkg,false)}</div>
          <div class="hist-key">kg</div>
        </div>
      </div>
      <div class="hist-row">
        ${Object.keys(meds).map(k =>
          `<span class="hist-pill ${meds[k]?'y':''}">${esc(k)}: ${meds[k]?'yes':'no'}</span>`).join('')}
        <span class="hist-pill ${meals.length?'y':''}">${meals.length} meals</span>
        <span class="hist-pill">${m.wo||'—'}</span>
        <span class="hist-pill">${kmTot}</span>
        <span class="hist-pill">${caf}</span>
        <span class="hist-pill ${curT?'y':''}">curate: ${curT}</span>
        <span class="hist-pill y">${blocks}</span>
        ${media.length ? `<span class="hist-pill y">media: ${media.map(x => esc(x.name)).join(' · ')}</span>` : ''}
      </div>
    </div>`);
  }
  container.innerHTML = renderKmChart() + (rows.join('') || '<div class="hist-empty">no history yet</div>');
}

// ── Reports ───────────────────────────────────────────────────────────────────
let _repContent = '', _repFilename = '';
let _parsedData = null; // map of { 'YYYY-MM-DD': dayObj } from pasted notes

// ── Parse merged notes from Obsidian ─────────────────────────────────────────
function parseMergedNotes(text) {
  // Split on the LiCalendar date header — handles both with and without filenames
  const parts = text.split(/\*:LiCalendar:\s*(\d{4}-\d{2}-\d{2})\*/);
  // parts: [pre, date1, content1, date2, content2, ...]
  const result = {};
  for (let i = 1; i < parts.length; i += 2) {
    const date = parts[i].trim();
    const content = parts[i+1] || '';
    result[date] = parseDayContent(date, content);
  }
  return result;
}

function tableVal(key, text) {
  const re = new RegExp('\\|\\s*' + key + '\\s*\\|\\s*([^|\\n]*?)\\s*\\|', 'i');
  const m = text.match(re);
  return m ? m[1].trim() : '';
}

function parseDayContent(date, content) {
  const d = { date, m: {}, e: {}, entries: [] };

  // Morning
  d.m.wt   = tableVal('wakeup_time',   content);
  d.m.sl   = tableVal('sleep_hours',   content);
  d.m.nrg  = tableVal('nrg_morning',   content);
  d.m.mood = tableVal('mood_morning',  content);
  d.m.wkg  = tableVal('weight_kg',     content);
  d.m.km   = tableVal('km_walked_m',   content);
  const csRaw = tableVal('cold_shower_s', content);
  d.m.cs   = csRaw;
  d.m.cs_on = csRaw === '' ? null : parseInt(csRaw) > 0 ? true : false;

  // Workout
  d.m.wo   = tableVal('workout_focus', content);
  d.m.tkg  = tableVal('total_kg',      content);
  d.m.tmin = tableVal('time_min',      content);

  // Evening
  d.e.kme    = tableVal('km_walked_e',   content);
  d.e.nrg    = tableVal('nrg_evening',   content);
  d.e.mood   = tableVal('mood_evening',  content);
  d.e.stress = tableVal('stress',        content);

  /* Meds: one row per slot, falling back to the old combined "meds" row. A
     note written before a slot existed simply has no row for it — the parser
     looks rows up by name, so an added slot is additive and older notes read
     exactly as they did. */
  const keys = medKeys();
  const raw = {};
  keys.forEach(k => { raw[k] = tableVal('meds_' + k, content); });
  if (keys.some(k => raw[k] !== '')) {
    keys.forEach(k => { d.e['meds_' + k] = raw[k] === 'yes'; });
  } else {
    const legacy = tableVal('meds', content) === 'yes';
    keys.forEach(k => { d.e['meds_' + k] = (k === 'lam' || k === 'rit') ? legacy : false; });
  }

  // Meals: "1,2,3" or "-"
  const mealsRaw = tableVal('meals', content);
  // the meal count is a setting now (up to 8), so the old cap of 4 would have
  // silently dropped meals 5–8 out of every report
  d.e.meals = mealsRaw && mealsRaw !== '-'
    ? mealsRaw.split(/[,\s]+/).map(n => parseInt(n, 10)).filter(n => n >= 1 && n <= 12)
    : [];

  // Curate output: new three-way split, falling back to the old blocks_mix row
  const cm = tableVal('curate_mix', content);
  if (cm !== '') {
    d.e.cur_mix  = parseInt(cm) || 0;
    d.e.cur_prod = parseInt(tableVal('curate_prod', content)) || 0;
    d.e.cur_cont = parseInt(tableVal('curate_cont', content)) || 0;
  } else {
    d.e.cur_mix  = parseInt(tableVal('blocks_mix', content)) || 0;
    d.e.cur_prod = 0; d.e.cur_cont = 0;
  }

  // Caffeine: "2c 1ed" or "-"
  const cafStr = tableVal('caffeine', content);
  d.e.caf_c  = parseInt((cafStr.match(/(\d+)c/) || [])[1] || 0);
  d.e.caf_ed = parseInt((cafStr.match(/(\d+)ed/) || [])[1] || 0);

  // Study (2.3+): only present on a study day
  const capT = tableVal('cap_topics', content), ankiR = tableVal('anki_rated', content);
  if (capT !== '' || ankiR !== '') {
    const titles = tableVal('cap_done', content);
    d.s = { topics: parseInt(capT, 10) || 0,
            titles: titles && titles !== '-' ? titles.split(';').map(s => s.trim()).filter(Boolean) : [],
            cards: parseInt(ankiR, 10) || 0, acquired: parseInt(tableVal('anki_acquired', content), 10) || 0 };
  }

  // Media (2.8+): only present on a day something was finished on DO's media tab
  d.e.media = parseMediaRows(content);

  // Blocks: whole planning activity row, however many columns it has (older
  // notes carry 3, current ones 6) — take every non-empty cell after "activity"
  const blkRow = content.match(/^[^\S\n]*\|[^\S\n]*activity[^\S\n]*\|(.*)$/im);
  d.e.blocks = blkRow
    ? blkRow[1].split('|').map(s => s.trim()).filter(Boolean)
    : [];

  // Journal entries: ` > HH:MM - text`
  const entryRe = /^\s*>\s*(\d{2}:\d{2})\s*-\s*(.+)$/gm;
  let em;
  while ((em = entryRe.exec(content)) !== null) {
    d.entries.push({ time: em[1], text: em[2].trim() });
  }

  // Notes written before the 1–5 change carry no scale marker — convert them so a
  // report spanning the switch isn't averaging two different scales together.
  if (tableVal('scale', content) === '') rescaleDay(d); else d.scale = 5;

  return d;
}

// ── Reports UI flow ───────────────────────────────────────────────────────────
function renderReports() {
  const mon = weekMonday(TODAY), sun = dateOffset(mon, 6);
  const wk = isoWeekNum(TODAY);
  const [y, m] = TODAY.split('-');
  $id('rep-week-label').textContent = `wk ${String(wk).padStart(2,'0')} · ${fmtDateShort(mon)} – ${fmtDateShort(sun)}`;
  $id('rep-month-label').textContent = `${MONTHS[parseInt(m)-1]} ${y}`;
  // Reset to step 1 but keep parsed data if already parsed
  if (!_parsedData) {
    showRepStep('paste');
  } else {
    showRepStep('pick');
  }
}

function showRepStep(step) {
  $id('rep-step-paste').classList.toggle('hidden', step !== 'paste');
  $id('rep-step-pick').classList.toggle('hidden', step !== 'pick');
  $id('rep-preview').classList.toggle('hidden', step !== 'preview');
}

function parseNotes() {
  const text = $id('rep-paste').value.trim();
  if (!text) { toast('Nothing to parse'); return; }

  const parsed = parseMergedNotes(text);
  const count = Object.keys(parsed).length;
  if (!count) { toast('No daily notes found'); return; }

  _parsedData = parsed;
  renderPickStep();
  showRepStep('pick');
}

function renderPickStep() {
  const dates = Object.keys(_parsedData).sort();
  $id('rep-parsed-info').textContent =
    `${dates.length} days parsed · ${fmtDateShort(dates[0])} – ${fmtDateShort(dates[dates.length-1])}`;

  // Find all weeks represented
  const weekSet = {}, monthSet = {};
  dates.forEach(d => {
    const wk = isoWeekNum(d);
    const [y, m] = d.split('-');
    const wKey = `${y}-W${String(wk).padStart(2,'0')}`;
    const mKey = `${y}-${m}`;
    if (!weekSet[wKey]) weekSet[wKey] = [];
    if (!monthSet[mKey]) monthSet[mKey] = [];
    weekSet[wKey].push(d);
    monthSet[mKey].push(d);
  });

  // Week buttons
  const wContainer = $id('rep-week-btns');
  wContainer.innerHTML = '';
  Object.entries(weekSet).sort().reverse().forEach(([wKey, wDates]) => {
    const [y, w] = wKey.split('-W');
    const mon = weekMonday(wDates[0]);
    const sun = dateOffset(mon, 6);
    const btn = document.createElement('button');
    btn.className = 'rep-btn';
    btn.innerHTML = `<span>wk ${w} · ${y}</span><span>${fmtDateShort(mon)} – ${fmtDateShort(sun)}</span>`;
    btn.onclick = () => loadReportParsed('weekly', wKey);
    wContainer.appendChild(btn);
  });
  if (!Object.keys(weekSet).length) wContainer.innerHTML = '<div style="color:var(--mu);font-size:11px;padding:8px 0">no weeks found</div>';

  // Month buttons
  const mContainer = $id('rep-month-btns');
  mContainer.innerHTML = '';
  Object.entries(monthSet).sort().reverse().forEach(([mKey]) => {
    const [y, m] = mKey.split('-');
    const btn = document.createElement('button');
    btn.className = 'rep-btn';
    btn.innerHTML = `<span>${MONTHS[parseInt(m)-1]} ${y}</span><span>${Object.keys(weekSet).filter(k=>k.startsWith(y)).length} wks</span>`;
    btn.onclick = () => loadReportParsed('monthly', mKey);
    mContainer.appendChild(btn);
  });
  if (!Object.keys(monthSet).length) mContainer.innerHTML = '<div style="color:var(--mu);font-size:11px;padding:8px 0">no months found</div>';
}

function resetPaste() {
  _parsedData = null;
  $id('rep-paste').value = '';
  showRepStep('paste');
}

function backToPick() {
  showRepStep(_parsedData ? 'pick' : 'paste');
}

// ── Load report from parsed Obsidian data ─────────────────────────────────────
function loadReportParsed(type, key) {
  const getDay = iso => _parsedData[iso] || {};

  let content, filename;
  if (type === 'weekly') {
    const [y, w] = key.split('-W');
    // Find a date in this week to anchor weekMonday
    const anchor = Object.keys(_parsedData).find(d => isoWeekNum(d) === parseInt(w) && d.startsWith(y));
    if (!anchor) { toast('No data for this week'); return; }
    const mon = weekMonday(anchor);
    const days = Array.from({length:7}, (_,i) => dateOffset(mon, i));
    content = buildWeeklyReport(days, getDay);
    filename = `review_weekly_${y.slice(2)}.${w}.md`;
  } else {
    const [y, m] = key.split('-');
    const daysInMonth = new Date(parseInt(y), parseInt(m), 0).getDate();
    const days = Array.from({length:daysInMonth}, (_,i) => `${y}-${m}-${String(i+1).padStart(2,'0')}`);
    content = buildMonthlyReport(days, getDay);
    filename = `review_monthly_${y.slice(2)}.${m}.md`;
  }

  _repContent = content;
  _repFilename = filename;
  $id('rep-pre').textContent = content;
  showRepStep('preview');
}

// ── Load report from localStorage (phone-only fallback) ───────────────────────
function loadReportLocal(type) {
  const getDay = iso => { try { return JSON.parse(localStorage.getItem('log_'+iso)) || {}; } catch { return {}; } };
  const [y, m] = TODAY.split('-');
  const wk = String(isoWeekNum(TODAY)).padStart(2,'0');

  let content, filename;
  if (type === 'weekly') {
    const mon = weekMonday(TODAY);
    const days = Array.from({length:7}, (_,i) => dateOffset(mon, i));
    content = buildWeeklyReport(days, getDay);
    filename = `review_weekly_${TODAY.slice(2,4)}.${wk}.md`;
  } else {
    const daysInMonth = new Date(parseInt(y), parseInt(m), 0).getDate();
    const days = Array.from({length:daysInMonth}, (_,i) => `${y}-${m}-${String(i+1).padStart(2,'0')}`);
    content = buildMonthlyReport(days, getDay);
    filename = `review_monthly_${TODAY.slice(2,4)}.${m}.md`;
  }

  _repContent = content;
  _repFilename = filename;
  $id('rep-pre').textContent = content;
  showRepStep('preview');
}

function avg(arr) {
  const nums = arr.filter(x => x!==null && x!=='' && !isNaN(parseFloat(x))).map(Number);
  if (!nums.length) return null;
  return (nums.reduce((a,b)=>a+b,0)/nums.length).toFixed(1);
}

/* Study for one report day: the parsed note's rows when the day came from
   Obsidian, otherwise TRACK and LEARN directly (they keep their own history). */
function studyDay(iso, d) {
  if (d && d.s) return d.s;
  const st = studyOf(iso);
  return st ? { topics: st.topics.length, titles: st.topics.map(t => t.title), cards: st.rated, acquired: st.acquired }
            : { topics: 0, titles: [], cards: 0, acquired: 0 };
}
function studyTotals(days, dd) {
  const per = days.map((iso, i) => studyDay(iso, dd[i]));
  return { topics: per.reduce((a, s) => a + s.topics, 0), cards: per.reduce((a, s) => a + s.cards, 0),
           acquired: per.reduce((a, s) => a + s.acquired, 0), titles: per.flatMap(s => s.titles) };
}
/* Routines over a report's days, from DO's own folded history — the ticks are
   not in the note, so a report built from pasted Obsidian notes on another
   device has nothing to show here and says so rather than guessing. */
function routineTotals(days) {
  const r = window.DO && DO.statsRange ? DO.statsRange(days) : null;
  return (r && r.days) ? r : null;
}
const routineRow = r => r ? `| routines | ${r.pct}% ticked · ${r.days} day${r.days === 1 ? '' : 's'} |`
                          : '| routines | — |';

/* Media over a report's days: how many titles per label, and the titles. */
function mediaTotals(dd) {
  const items = dd.flatMap(d => mediaOf(d.e));
  const byKind = {};
  items.forEach(m => { const k = m.kind || 'other'; byKind[k] = (byKind[k] || 0) + 1; });
  return { count: items.length, byKind, items };
}
const mediaSection = m => `## media

| type | finished |
| --- | --- |
${Object.entries(m.byKind).map(([k, n]) => `| ${k} | ${n} |`).join('\n') || '| — | — |'}

${m.items.map(x => `- ${x.kind}${x.sub ? ' · ' + x.sub : ''} · ${x.name}`).join('\n') || '—'}`;

const studySection = s => `## study

| metric | result |
| --- | --- |
| topics finished | ${s.topics} |
| cards rated | ${s.cards} · ${s.acquired} acquired |

${s.titles.map(t => '- ' + t).join('\n') || '—'}`;

// ── Report builders (accept days array + getDay function) ─────────────────────
function buildWeeklyReport(days, getDay) {
  const dd = days.map(getDay);
  const [y] = days[0].split('-');
  const wk = String(isoWeekNum(days[0])).padStart(2,'0');
  const sun = days[6];

  const dayRow = (d, i) => {
    const m=d.m||{}, e=d.e||{};
    const dow=['mon','tue','wed','thu','fri','sat','sun'][i];
    const kmM=parseFloat(m.km)||0, kmE=parseFloat(e.kme)||0;
    const km=(m.km||e.kme)?(kmM+kmE).toFixed(1):'—';
    return `| ${dow} ${fmtDateShort(days[i])} | ${m.nrg||'—'} | ${m.mood||'—'} | ${e.stress||'—'} | ${m.wkg||'—'} | ${m.sl||'—'} | ${km} |`;
  };

  const nrgs=dd.map(d=>d.m?.nrg||null), moods=dd.map(d=>d.m?.mood||null), stresses=dd.map(d=>d.e?.stress||null);
  const weights=dd.map(d=>d.m?.wkg||null), sleeps=dd.map(d=>d.m?.sl||null);
  const allKm=dd.map(d=>{const m=d.m||{},e=d.e||{};return(m.km||e.kme)?((parseFloat(m.km)||0)+(parseFloat(e.kme)||0)):null;});
  const totalKm=allKm.filter(Boolean).reduce((a,b)=>a+b,0).toFixed(1);
  // one tally per configured slot, so a slot added later reports itself
  const medLbl=medsCfg(); const medDays={};
  Object.keys(medLbl).forEach(k=>{medDays[k]=dd.filter(d=>medsOf(d.e)[k]).length;});
  const loggedE=dd.filter(d=>d.e?.kme).length;
  const totalMeals=dd.reduce((a,d)=>a+mealsOf(d.e).length,0);
  const csDays=dd.filter(d=>d.m?.cs_on===true).length;
  const curMix=dd.reduce((a,d)=>a+curOf(d.e).mix,0);
  const curProd=dd.reduce((a,d)=>a+curOf(d.e).prod,0);
  const curCont=dd.reduce((a,d)=>a+curOf(d.e).cont,0);
  const totalCafC=dd.reduce((a,d)=>a+(d.e?.caf_c||0),0);
  const totalCafEd=dd.reduce((a,d)=>a+(d.e?.caf_ed||0),0);

  const woRows=dd.map((d,i)=>{
    const m=d.m||{}; if(!m.wo) return null;
    const dow=['mon','tue','wed','thu','fri','sat','sun'][i];
    return m.wo==='rest' ? `| ${dow} | rest | — | — |` : `| ${dow} | ${m.wo} | ${m.tkg||'—'} | ${m.tmin||'—'} |`;
  }).filter(Boolean).join('\n');

  const blockCounts={};
  dd.forEach(d=>(d.e?.blocks||[]).forEach(b=>{blockCounts[b]=(blockCounts[b]||0)+1;}));
  const blockRows=Object.entries(blockCounts).map(([b,c])=>`| ${b} | ${c} |`).join('\n')||'| — | — |';

  const allEntries=[];
  dd.forEach((d,i)=>(d.entries||[]).forEach(en=>allEntries.push({date:days[i],time:en.time,text:en.text})));
  const entryLines=allEntries.map(en=>` > ${en.time} - ${en.text}`).join('\n\n')||'—';
  const study=studyTotals(days,dd);
  const media=mediaTotals(dd);
  const routines=routineTotals(days);

  return (
`*weekly review — week ${wk} · ${y}*
*${fmtDateShort(days[0])} – ${fmtDateShort(sun)} ${y}*

---

## mood & energy

| day | nrg ↑ | mood ↑ | stress ↓ | weight | sleep h | km |
| --- | ----- | ------ | -------- | ------ | ------- | -- |
${days.map((d,i)=>dayRow(dd[i],i)).join('\n')}
| **avg** | ${avg(nrgs)||'—'} | ${avg(moods)||'—'} | ${avg(stresses)||'—'} | ${avg(weights)||'—'} | ${avg(sleeps)||'—'} | ${(parseFloat(totalKm)/7).toFixed(1)} |

## habits

| metric | result |
| --- | --- |
${Object.keys(medLbl).map(k=>`| ${medLbl[k]} | ${medDays[k]} / 7 |`).join('\n')}
| meals | ${totalMeals} total · ${loggedE?(totalMeals/loggedE).toFixed(1):'—'} / day |
| cold showers | ${csDays} / 7 |
| avg sleep | ${avg(sleeps)||'—'} h |
| total km | ${totalKm} |
| caffeine | ${totalCafC}c ${totalCafEd}ed |
| study | ${study.topics} topics · ${study.cards} cards |
| media | ${media.count} finished |
${routineRow(routines)}

## workouts

| day | focus | kg | min |
| --- | ----- | -- | --- |
${woRows||'| — | — | — | — |'}

## curate output

| stream | total |
| --- | --- |
| mix | ${curMix} |
| prod | ${curProd} |
| cont | ${curCont} |
| **total** | ${curMix+curProd+curCont} |

## blocks

| block | count |
| --- | --- |
${blockRows}

${studySection(study)}

${mediaSection(media)}

## journal entries

${entryLines}`);
}

function buildMonthlyReport(days, getDay) {
  const dd = days.map(getDay);
  const [y, mo] = days[0].split('-');
  const monthIdx = parseInt(mo)-1;
  const daysInMonth = days.length;

  const weeks={};
  days.forEach((d,i)=>{
    const wk=isoWeekNum(d);
    if(!weeks[wk]) weeks[wk]=[];
    weeks[wk].push({date:d,data:dd[i]});
  });

  const nrgs=dd.map(d=>d.m?.nrg||null).filter(Boolean);
  const moods=dd.map(d=>d.m?.mood||null).filter(Boolean);
  const stresses=dd.map(d=>d.e?.stress||null).filter(Boolean);
  const weights=dd.map(d=>d.m?.wkg||null).filter(Boolean);
  const sleeps=dd.map(d=>d.m?.sl||null).filter(Boolean);
  const allKm=dd.map(d=>{const m=d.m||{},e=d.e||{};return(m.km||e.kme)?((parseFloat(m.km)||0)+(parseFloat(e.kme)||0)):null;}).filter(Boolean);
  const totalKm=allKm.reduce((a,b)=>a+b,0).toFixed(1);
  // one tally per configured slot, so a slot added later reports itself
  const medLbl=medsCfg(); const medDays={};
  Object.keys(medLbl).forEach(k=>{medDays[k]=dd.filter(d=>medsOf(d.e)[k]).length;});
  const loggedDays=dd.filter(d=>d.m?.wt||d.e?.kme).length;
  const loggedE=dd.filter(d=>d.e?.kme).length;
  const totalMeals=dd.reduce((a,d)=>a+mealsOf(d.e).length,0);
  const csDays=dd.filter(d=>d.m?.cs_on===true).length;
  const curMix=dd.reduce((a,d)=>a+curOf(d.e).mix,0);
  const curProd=dd.reduce((a,d)=>a+curOf(d.e).prod,0);
  const curCont=dd.reduce((a,d)=>a+curOf(d.e).cont,0);
  const totalCafC=dd.reduce((a,d)=>a+(d.e?.caf_c||0),0);
  const totalCafEd=dd.reduce((a,d)=>a+(d.e?.caf_ed||0),0);

  const woCounts={};
  dd.forEach(d=>{if(d.m?.wo){const w=d.m.wo;woCounts[w]=(woCounts[w]||0)+1;}});
  const woRows=Object.entries(woCounts).map(([w,c])=>`| ${w} | ${c} |`).join('\n')||'| — | — |';

  const blockCounts={};
  dd.forEach(d=>(d.e?.blocks||[]).forEach(b=>{blockCounts[b]=(blockCounts[b]||0)+1;}));
  const blockRows=Object.entries(blockCounts).map(([b,c])=>`| ${b} | ${c} |`).join('\n')||'| — | — |';
  const study=studyTotals(days,dd);
  const media=mediaTotals(dd);
  const routines=routineTotals(days);

  const weekRows=Object.entries(weeks).map(([wk,wdays])=>{
    const wdd=wdays.map(x=>x.data);
    const wNrg=avg(wdd.map(d=>d.m?.nrg||null).filter(Boolean));
    const wMood=avg(wdd.map(d=>d.m?.mood||null).filter(Boolean));
    const wStress=avg(wdd.map(d=>d.e?.stress||null).filter(Boolean));
    const wKm=wdd.map(d=>{const m=d.m||{},e=d.e||{};return(m.km||e.kme)?((parseFloat(m.km)||0)+(parseFloat(e.kme)||0)):0;}).reduce((a,b)=>a+b,0).toFixed(1);
    const wMeds=wdd.filter(d=>{const md=medsOf(d.e);return Object.keys(medLbl).every(k=>md[k]);}).length;
    const wCur=wdd.reduce((a,d)=>a+curTotal(d.e),0);
    return `| wk ${String(wk).padStart(2,'0')} | ${wNrg||'—'} | ${wMood||'—'} | ${wStress||'—'} | ${wKm} | ${wMeds}/${wdays.length} | ${wCur} |`;
  }).join('\n');

  return (
`*monthly review — ${MONTHS[monthIdx]} ${y}*

---

## overview by week

| week | avg nrg | avg mood | avg stress | km | meds | curate |
| ---- | ------- | -------- | ---------- | -- | ---- | ------ |
${weekRows}
| **month** | ${avg(nrgs)||'—'} | ${avg(moods)||'—'} | ${avg(stresses)||'—'} | ${totalKm} | ${Math.min.apply(null,Object.keys(medLbl).map(k=>medDays[k]))}/${loggedDays} | ${curMix+curProd+curCont} |

## habits

| metric | result |
| --- | --- |
| days logged | ${loggedDays} / ${daysInMonth} |
${Object.keys(medLbl).map(k=>`| ${medLbl[k]} | ${medDays[k]} / ${loggedDays} |`).join('\n')}
| meals | ${totalMeals} total · ${loggedE?(totalMeals/loggedE).toFixed(1):'—'} / day |
| cold showers | ${csDays} / ${loggedDays} |
| avg sleep | ${avg(sleeps)||'—'} h |
| total km | ${totalKm} |
| caffeine | ${totalCafC}c ${totalCafEd}ed |
| study | ${study.topics} topics · ${study.cards} cards |
| media | ${media.count} finished |
${routineRow(routines)}

## workouts

| type | sessions |
| --- | --- |
${woRows}

## curate output

| stream | total |
| --- | --- |
| mix | ${curMix} |
| prod | ${curProd} |
| cont | ${curCont} |
| **total** | ${curMix+curProd+curCont} |

## blocks

| block | count |
| --- | --- |
${blockRows}

${studySection(study)}

${mediaSection(media)}`);
}

async function shareReport() {
  try {
    const file=new File([_repContent],_repFilename,{type:'text/plain'});
    if(navigator.canShare?.({files:[file]})){await navigator.share({files:[file]});return;}
    if(navigator.share){await navigator.share({title:_repFilename,text:_repContent});return;}
  } catch(err){if(err.name==='AbortError') return;}
  const a=document.createElement('a');
  a.href=URL.createObjectURL(new Blob([_repContent],{type:'text/plain'}));
  a.download=_repFilename; a.click();
}

async function copyReport() {
  const btn=$id('rep-copy-btn');
  try{await navigator.clipboard.writeText(_repContent);}
  catch{const ta=Object.assign(document.createElement('textarea'),{value:_repContent});ta.style.cssText='position:fixed;opacity:0;top:0;left:0';document.body.appendChild(ta);ta.select();document.execCommand('copy');document.body.removeChild(ta);}
  btn.textContent='✓ copied'; btn.classList.add('ok');
  setTimeout(()=>{btn.textContent='copy';btn.classList.remove('ok');},2200);
}

// ── Data screen ───────────────────────────────────────────────────────────────
function renderDataScreen() {
  const keys = allLogKeys();
  const totalEntries = keys.reduce((a,k)=>{
    try{return a+(JSON.parse(localStorage.getItem(k))?.entries?.length||0);}catch{return a;}
  },0);
  const earliest = keys.length ? fmtFilename(keys[0].replace('log_','')) : '—';
  $id('ds-days').textContent    = keys.length;
  $id('ds-entries').textContent = totalEntries;
  $id('ds-earliest').textContent = earliest;
  renderAlertSettings();
}

// ── Backup: export / import all days ──────────────────────────────────────────
async function exportAllData() {
  const keys = allLogKeys();
  if (!keys.length) { toast('No data to export'); return; }
  const days = {};
  keys.forEach(k => { try { days[k.replace('log_','')] = JSON.parse(localStorage.getItem(k)); } catch {} });
  // version 2 = energy/mood/stress are on the 1–5 scale
  const payload = { app:'log', version:2, exported:new Date().toISOString(), days };
  const json = JSON.stringify(payload);
  const filename = `log_backup_${REAL_TODAY}.json`;
  try {
    const file = new File([json], filename, { type:'application/json' });
    if (navigator.canShare?.({ files:[file] })) { await navigator.share({ files:[file] }); return; }
    if (navigator.share) { await navigator.share({ title:filename, text:json }); return; }
  } catch (err) { if (err.name === 'AbortError') return; }
  const a = document.createElement('a');
  a.href = URL.createObjectURL(new Blob([json], { type:'application/json' }));
  a.download = filename; a.click();
  toast(`Exported ${keys.length} day${keys.length!==1?'s':''}`);
}

function pickImport() { $id('import-file').click(); }

function importAllData(event) {
  const file = event.target.files?.[0];
  if (!file) return;
  const reader = new FileReader();
  reader.onload = () => {
    event.target.value = '';          // allow re-importing the same file later
    let payload;
    try { payload = JSON.parse(reader.result); } catch { toast('Invalid file'); return; }
    const days = payload && typeof payload.days === 'object' ? payload.days : null;
    if (!days) { toast('Not a log backup'); return; }
    const incoming = Object.keys(days).filter(d => /^\d{4}-\d{2}-\d{2}$/.test(d));
    if (!incoming.length) { toast('No days in file'); return; }

    const existing = new Set(allLogKeys().map(k => k.replace('log_','')));
    const overlap = incoming.filter(d => existing.has(d)).length;
    const added   = incoming.length - overlap;
    // a pre-1–5 backup gets converted on the way in
    const needsRescale = (parseInt(payload.version, 10) || 1) < 2;
    const msg = `Import ${incoming.length} day${incoming.length!==1?'s':''}?\n\n`
              + `${added} new · ${overlap} will overwrite existing day${overlap!==1?'s':''}.`
              + (needsRescale ? '\n\nOlder backup — ratings will be rescaled to 1–5.' : '');
    /* Not routed through Shell.confirm: overwriting days is exactly the kind of
       thing "confirm before clearing" must not be able to wave through. It is
       the app's own dialog either way. */
    Shell.ask({ title: `Import ${incoming.length} day${incoming.length!==1?'s':''}?`,
                body: msg.split('\n\n').slice(1).join(' '), yes: 'import', danger: true,
                done: a => {
      if (!a) return;
      incoming.forEach(d => {
        try {
          if (needsRescale) rescaleDay(days[d]);
          localStorage.setItem('log_'+d, JSON.stringify(days[d]));
        } catch {}
      });
      initData();           // refresh the currently-viewed day in case it changed
      renderDataScreen();
      refreshHome();
      toast(`Imported ${incoming.length} day${incoming.length!==1?'s':''}`);
    } });
  };
  reader.readAsText(file);
}

function openDeleteModal() {
  const n = allLogKeys().length;
  $id('modal-count').textContent = `${n} day${n!==1?'s':''} will be deleted`;
  $id('modal').classList.remove('hidden');
}

function closeModal() {
  $id('modal').classList.add('hidden');
}

function confirmDeleteAll() {
  allLogKeys().forEach(k => localStorage.removeItem(k));
  closeModal();
  data = fresh();
  toast('All data deleted');
  go('home');
}

// ── Utils ─────────────────────────────────────────────────────────────────────
function clearDay() {
  Shell.confirm('Clear all data for selected day?', () => {
    data=fresh(); save(); refreshHome(); toast('Cleared');
  });
}

function esc(s) {
  return String(s).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;');
}

// ── Boot ──────────────────────────────────────────────────────────────────────
const _rescaled = migrateScales();
renderForms();          // build the Config-driven controls before anything fills them
initData();
refreshHome();
if (_rescaled) toast(`rescaled ${_rescaled} day${_rescaled !== 1 ? 's' : ''} to 1–5`);

/* An edit in Settings → content rebuilds the controls and refills whichever
   screen is open, so a renamed block or an extra meal appears immediately
   rather than after a reload. */
Config.subscribe(path => {
  if (path !== '*' && !String(path).startsWith('log.')) return;
  renderForms();
  const open = $all('.scr.on')[0];
  const id = open ? open.id.replace('s-', '') : 'home';
  ({ morning: popM, evening: popE, home: refreshHome })[id]?.();
  refreshAlert();          // an edited hour takes effect without waiting a minute
});

/* The date format and the week start are preferences; the home date and the
   km chart follow them without a reload. */
Prefs.subscribe(k => {
  if (k !== '*' && k !== 'dateFormat' && k !== 'weekStart') return;
  const open = $all('.scr.on')[0];
  const id = open ? open.id.replace('s-', '') : 'home';
  ({ home: refreshHome, history: renderHistory })[id]?.();
});

/* The month grid is generated, so it is wired by delegation rather than by an
   inline handler per cell — 31 interpolated dates is 31 chances to get attr()
   escaping wrong, and a date needs none of it. */
const calBox = document.querySelector('.ns-log #log-cal');
if (calBox) calBox.addEventListener('click', e => {
  const arr = e.target.closest('[data-month]');
  if (arr) { if (!arr.disabled) monthShift(+arr.dataset.month); return; }
  const cell = e.target.closest('[data-day]');
  if (cell && !cell.disabled) { pickDate(cell.dataset.day); return; }
  if (e.target.closest('[data-trend]')) toggleTrend();
});
// the chart is a button, so it answers the keyboard like one
if (calBox) calBox.addEventListener('keydown', e => {
  if (e.key !== 'Enter' && e.key !== ' ') return;
  if (!e.target.closest || !e.target.closest('[data-trend]')) return;
  e.preventDefault(); toggleTrend();
});

// `home`: the tab button tapped while on LOG — same as ← back, unsaved-input check included
/* onMinute is the shell's own minute tick, the one that already watches for
   midnight: the alert wants re-deriving as 10:00 and 21:00 pass, and a second
   timer for it would be a second thing to keep in step. */
Shell.register('log', { onDayChange: iso => { rollDay(iso); refreshAlert(); },
                        onMinute: refreshAlert, home: goBack });
refreshAlert();

return { go, goBack, markDirty, shiftDate, resetDate, pickDate, monthShift, renderMonth,
         toggleTrend, sc, setColdShower, setWo,
         toggleMed, toggleMeal, incCaf, resetCaf, incCur, resetCur, toggleBlock,
         saveMorning, saveEvening, addEntry, deleteEntry, shareFile, copyAll,
         parseNotes, resetPaste, backToPick, loadReportLocal, shareReport, copyReport,
         clearDay, renderDataScreen, exportAllData, pickImport, importAllData,
         openDeleteModal, closeModal, confirmDeleteAll, renderPlanned, setBlock, buildNote,
         setMedia, toggleAlerts, saveAlerts, testAlert, refreshAlert, alertReason,
         alertShown, dismissAlert };
})();
