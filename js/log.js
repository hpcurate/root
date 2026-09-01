/* ── LOG ──────────────────────────────────────────────────────────────────────
   Daily life tracker: morning/evening data, journal entries, history, weekly
   and monthly reports, JSON backup. Logic is unchanged from log/index.html.
   Merge-only changes: one IIFE published as window.LOG, DOM lookups scoped to
   .ns-log, the slide scrolls instead of the window, toast() goes to the shell.
   Storage keys are untouched: log_<date> and log-scale-v2. */
window.LOG = (function () {
'use strict';

const SCOPE = '.ns-log ';
const view  = document.getElementById('view-log');
const $id   = id  => document.querySelector(SCOPE + '#' + id);
const $all  = sel => document.querySelectorAll(SCOPE + sel);
const toast = msg => Shell.toast(msg);

// ── Dates ─────────────────────────────────────────────────────────────────────
function localISO(d) {
  return `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}`;
}
const REAL_TODAY = localISO(new Date());
let TODAY = REAL_TODAY;

function dateOffset(base, n) {
  const d = new Date(base + 'T00:00:00');
  d.setDate(d.getDate() + n);
  return localISO(d);
}

function shiftDate(delta) { TODAY = dateOffset(TODAY, delta); initData(); refreshHome(); }
function resetDate()       { TODAY = REAL_TODAY; initData(); refreshHome(); }

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

function fresh() {
  return {
    date: TODAY,
    scale: 5,          // ratings are 1–5; older days are stamped by migrateScales()
    m: { wt:'', sl:'', nrg:'', mood:'', cs_on:null, cs:'', wkg:'', km:'', wo:'', tkg:'', tmin:'' },
    e: { kme:'', nrg:'', mood:'', stress:'', meds_lam:false, meds_rit:false, meals:[],
         caf_c:0, caf_ed:0, cur_mix:0, cur_prod:0, cur_cont:0, blocks:[] },
    entries: []
  };
}

/* Readers that understand both the old and new shapes, so days logged before
   this change still render, export and report correctly.
   Old: e.meds = 'yes'|'no' (both drugs at once), e.bmix = mixing blocks. */
function medsOf(e = {}) {
  if (e.meds_lam !== undefined || e.meds_rit !== undefined) {
    return { lam: !!e.meds_lam, rit: !!e.meds_rit };
  }
  const legacy = e.meds === 'yes';
  return { lam: legacy, rit: legacy };
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
    if (!Array.isArray(data.e.meals))        data.e.meals  = [];
    if (typeof data.e.caf_c  !== 'number')   data.e.caf_c  = 0;
    if (typeof data.e.caf_ed !== 'number')   data.e.caf_ed = 0;
    if (data.m.cs_on === undefined)          data.m.cs_on  = null;
    // fold the legacy shapes forward once, on read
    const meds = medsOf(data.e);
    data.e.meds_lam = meds.lam;
    data.e.meds_rit = meds.rit;
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

function goBack() {
  if (dirty && !confirm('Go back without saving?')) return;
  go('home');
}

// ── Home ──────────────────────────────────────────────────────────────────────
function calcStreak() {
  let streak = 0, d = REAL_TODAY;
  while (true) {
    let day;
    try { day = JSON.parse(localStorage.getItem('log_' + d)); } catch {}
    if (!day?.m?.wt || !day?.e?.kme) break;
    streak++;
    d = dateOffset(d, -1);
  }
  return streak;
}

function refreshHome() {
  // one date format for the whole app, set under Settings → behaviour
  $id('home-date').textContent = Prefs.formatDate(TODAY);
  $id('btn-today').classList.toggle('hidden', TODAY === REAL_TODAY);
  $id('card-m').classList.toggle('done', !!data.m.wt);
  $id('card-e').classList.toggle('done', !!data.e.kme);
  const ec = data.entries.length;
  $id('en-ct').textContent = ec ? `${ec} entr${ec===1?'y':'ies'}` : 'no entries yet';
  const s = calcStreak();
  const el = $id('h-streak');
  el.innerHTML = s >= 2 ? `streak · <em>${s} days</em>` : '';
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
  dirty = true;
  const k = which === 'lam' ? 'meds_lam' : 'meds_rit';
  data.e[k] = !data.e[k];
  syncMedsUI();
}
function syncMedsUI() {
  [['lam','meds_lam'], ['rit','meds_rit']].forEach(([id, k]) => {
    const on = !!data.e[k];
    $id('med-' + id).classList.toggle('on', on);
    $id('med-' + id + '-s').textContent = on ? 'yes' : 'no';
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
}
function syncBlocks() {
  $all('.blk-b').forEach(b => b.classList.toggle('on', data.e.blocks.includes(b.textContent.trim())));
}

/* ── Config-driven form furniture ─────────────────────────────────────────────
   The evening and morning forms used to be nine hardcoded block buttons, two
   named medications, four meals and three curate counters written straight into
   index.html. They are built from Config here instead, keeping the exact ids and
   classes the sync* functions already look for, so nothing downstream changed.

   A colour is turned into the two custom properties each control expects; the
   translucent variant is mixed in CSS rather than hand-written as an rgba(). */
function tint(hex, pct) { return `color-mix(in srgb, ${hex} ${pct}%, transparent)`; }

function renderForms() {
  const cfg = {
    blocks: Config.get('log.blocks'),
    meds:   Config.get('log.meds'),
    meals:  Config.get('log.mealCount'),
    mealLabel: Config.get('log.mealLabel'),
    caf:    Config.get('log.caffeine'),
    curate: Config.get('log.curate'),
    scales: Config.get('log.scales'),
    workouts: Config.get('log.workouts'),
  };

  // workout types
  const wo = $id('wo4');
  if (wo) wo.innerHTML = cfg.workouts.map(w =>
    `<button class="wo4-b" onclick="LOG.setWo(this,'${esc(w)}')">${esc(w)}</button>`).join('');

  // meds — two fixed slots, free labels
  const medG = $id('med-g');
  if (medG) medG.innerHTML = ['lam','rit'].map(k =>
    `<button class="med-b ${k}" id="med-${k}" onclick="LOG.toggleMed('${k}')">
       <span class="med-name">${esc(cfg.meds[k])}</span>
       <span class="med-state" id="med-${k}-s">no</span>
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
    `<button class="blk-b" onclick="LOG.toggleBlock(this,'${esc(b.name)}')"
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

function saveMorning() {
  const cs_on = data.m.cs_on;
  data.m = { wt:$id('m-wt').value, sl:$id('m-sl').value,
             nrg:scGet('sc-nrg-m'), mood:scGet('sc-mood-m'), cs_on,
             cs: cs_on ? $id('m-cs').value : '',
             wkg:$id('m-wkg').value, km:$id('m-km').value,
             wo:woGet(), tkg:$id('m-tkg').value, tmin:$id('m-tmin').value };
  save(); toast('Morning saved'); go('home');
}

// ── Evening ───────────────────────────────────────────────────────────────────
function popE() {
  const e = data.e;
  $id('e-kme').value = e.kme || '';
  scSet('sc-nrg-e', e.nrg); scSet('sc-mood-e', e.mood); scSet('sc-stress', e.stress);
  syncMedsUI(); syncMealsUI(); syncCafUI(); syncCurUI(); syncBlocks();
}

function saveEvening() {
  data.e.kme    = $id('e-kme').value;
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
| meds_lam      | ${meds.lam?'yes':'no'} |
| meds_rit      | ${meds.rit?'yes':'no'} |
| meals         | ${mealsCell} |
| meals_count   | ${meals.length} |
| caffeine      | ${caf} |

#### curate output

| data          | ans |
| ------------- | --: |
| curate_mix    | ${cur.mix} |
| curate_prod   | ${cur.prod} |
| curate_cont   | ${cur.cont} |
| curate_total  | ${cur.mix + cur.prod + cur.cont} |`);
}

// ── Output ────────────────────────────────────────────────────────────────────
function renderOutput() {
  const note = buildNote();
  $id('out-pre').textContent = note;
  const tags = $id('out-tags'); tags.innerHTML = '';
  const tag = (label,ok) => { const t=document.createElement('span'); t.className=`out-tag ${ok?'ok':'no'}`; t.textContent=label; tags.appendChild(t); };
  tag('morning', !!data.m.wt); tag('evening', !!data.e.kme);
  const ec=data.entries.length; tag(`${ec} entr${ec===1?'y':'ies'}`, ec>0);
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
const KM_TARGET = 6;        // target km per day
const DAY_LBL = ['M','T','W','T','F','S','S'];

function dayTotalKm(iso) {
  let d; try { d = JSON.parse(localStorage.getItem('log_' + iso)); } catch {}
  if (!d) return null;
  const hasKm = d.m?.km || d.e?.kme;
  if (!hasKm) return null;
  return (parseFloat(d.m?.km) || 0) + (parseFloat(d.e?.kme) || 0);
}

function renderKmChart() {
  const mon = weekMonday(REAL_TODAY);
  const days = [];
  for (let i = 0; i < 7; i++) {
    const iso = dateOffset(mon, i);
    days.push({ iso, km: dayTotalKm(iso), future: iso > REAL_TODAY, today: iso === REAL_TODAY });
  }
  const logged   = days.filter(d => d.km !== null);
  const weekTot  = logged.reduce((s, d) => s + d.km, 0);
  const weekGoal = KM_TARGET * 7;
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
        <span class="hist-pill ${meds.lam?'y':''}">lam: ${meds.lam?'yes':'no'}</span>
        <span class="hist-pill ${meds.rit?'y':''}">rit: ${meds.rit?'yes':'no'}</span>
        <span class="hist-pill ${meals.length?'y':''}">${meals.length} meals</span>
        <span class="hist-pill">${m.wo||'—'}</span>
        <span class="hist-pill">${kmTot}</span>
        <span class="hist-pill">${caf}</span>
        <span class="hist-pill ${curT?'y':''}">curate: ${curT}</span>
        <span class="hist-pill y">${blocks}</span>
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

  // Meds: new per-drug rows, falling back to the old combined "meds" row
  const lamRaw = tableVal('meds_lam', content), ritRaw = tableVal('meds_rit', content);
  if (lamRaw !== '' || ritRaw !== '') {
    d.e.meds_lam = lamRaw === 'yes';
    d.e.meds_rit = ritRaw === 'yes';
  } else {
    const legacy = tableVal('meds', content) === 'yes';
    d.e.meds_lam = legacy; d.e.meds_rit = legacy;
  }

  // Meals: "1,2,3" or "-"
  const mealsRaw = tableVal('meals', content);
  d.e.meals = mealsRaw && mealsRaw !== '-'
    ? mealsRaw.split(/[,\s]+/).map(n => parseInt(n, 10)).filter(n => n >= 1 && n <= 4)
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
  const lamDays=dd.filter(d=>medsOf(d.e).lam).length;
  const ritDays=dd.filter(d=>medsOf(d.e).rit).length;
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
| lamotrigine | ${lamDays} / 7 |
| ritalin | ${ritDays} / 7 |
| meals | ${totalMeals} total · ${loggedE?(totalMeals/loggedE).toFixed(1):'—'} / day |
| cold showers | ${csDays} / 7 |
| avg sleep | ${avg(sleeps)||'—'} h |
| total km | ${totalKm} |
| caffeine | ${totalCafC}c ${totalCafEd}ed |

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
  const lamDays=dd.filter(d=>medsOf(d.e).lam).length;
  const ritDays=dd.filter(d=>medsOf(d.e).rit).length;
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

  const weekRows=Object.entries(weeks).map(([wk,wdays])=>{
    const wdd=wdays.map(x=>x.data);
    const wNrg=avg(wdd.map(d=>d.m?.nrg||null).filter(Boolean));
    const wMood=avg(wdd.map(d=>d.m?.mood||null).filter(Boolean));
    const wStress=avg(wdd.map(d=>d.e?.stress||null).filter(Boolean));
    const wKm=wdd.map(d=>{const m=d.m||{},e=d.e||{};return(m.km||e.kme)?((parseFloat(m.km)||0)+(parseFloat(e.kme)||0)):0;}).reduce((a,b)=>a+b,0).toFixed(1);
    const wMeds=wdd.filter(d=>{const md=medsOf(d.e);return md.lam&&md.rit;}).length;
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
| **month** | ${avg(nrgs)||'—'} | ${avg(moods)||'—'} | ${avg(stresses)||'—'} | ${totalKm} | ${Math.min(lamDays,ritDays)}/${loggedDays} | ${curMix+curProd+curCont} |

## habits

| metric | result |
| --- | --- |
| days logged | ${loggedDays} / ${daysInMonth} |
| lamotrigine | ${lamDays} / ${loggedDays} |
| ritalin | ${ritDays} / ${loggedDays} |
| meals | ${totalMeals} total · ${loggedE?(totalMeals/loggedE).toFixed(1):'—'} / day |
| cold showers | ${csDays} / ${loggedDays} |
| avg sleep | ${avg(sleeps)||'—'} h |
| total km | ${totalKm} |
| caffeine | ${totalCafC}c ${totalCafEd}ed |

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
${blockRows}`);
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
    if (!confirm(msg)) return;

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
  if (!confirm('Clear all data for selected day?')) return;
  data=fresh(); save(); refreshHome(); toast('Cleared');
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
});

Shell.register('log', {});

return { go, goBack, markDirty, shiftDate, resetDate, sc, setColdShower, setWo,
         toggleMed, toggleMeal, incCaf, resetCaf, incCur, resetCur, toggleBlock,
         saveMorning, saveEvening, addEntry, deleteEntry, shareFile, copyAll,
         parseNotes, resetPaste, backToPick, loadReportLocal, shareReport, copyReport,
         clearDay, renderDataScreen, exportAllData, pickImport, importAllData,
         openDeleteModal, closeModal, confirmDeleteAll };
})();
