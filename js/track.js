/* ── TRACK ────────────────────────────────────────────────────────────────────
   The CAP Électricien tracker. 54 topics ticked with a completion date; the
   pace is derived from those dates over a rolling window, and everything else —
   projected finish, the January squeeze, the chart, the milestones — is derived
   from the pace against the exam, the internship and the revision buffer.

   Ported from track/index.html for 2.2:
     · the curriculum, the phase names, the level label, the PSE row and the
       revision reminders moved to js/config.js (see the note there on why the
       curriculum has no editor: the topic ids are what the ticks are filed under)
     · the pace window and the "next up" count are Config fields, edited from
       Settings → track alongside the dates
     · the date settings render into that panel; the start date, which the
       standalone app kept but never exposed, is editable there too
     · "today" is Shell.today(), the whole view re-renders on the day rollover,
       and the reset goes through Shell.confirm
   Storage is untouched: capTracker.v2 (ticks, dates, open levels). The legacy
   capTracker.weeks.v1 is still surfaced and still never migrated — a weekly
   count cannot be attributed to specific topics. */
window.TRACK = (function () {
'use strict';

const SCOPE = '.ns-track ';
const view  = document.getElementById('view-track');
const $id   = id  => document.querySelector(SCOPE + '#' + id);
const $all  = sel => document.querySelectorAll(SCOPE + sel);
const toast = msg => Shell.toast(msg);
const esc   = s => String(s == null ? '' : s).replace(/[&<>"']/g, c =>
  ({ '&':'&amp;', '<':'&lt;', '>':'&gt;', '"':'&quot;', "'":'&#39;' }[c]));

const KEY = 'capTracker.v2', LEGACY_KEY = 'capTracker.weeks.v1';

/* ── Content ───────────────────────────────────────────────────────────────── */
let C, PHASES, LEVEL_LABEL, PSE, REVISION, PACE_WIN, NEXT_N, TOTAL, N_EX, N_TH, LEVELS;
function readConfig() {
  C = (Config.get('track.curriculum') || []).map(c => Object.assign({}, c, { ex:!!c.ex, lv:+c.lv || 1 }));
  PHASES = Config.get('track.phases') || {};
  LEVEL_LABEL = String(Config.get('track.levelLabel') || 'Level');
  PSE = Object.assign({ label:'PSE', note:'' }, Config.get('track.pse') || {});
  REVISION = Config.get('track.revision') || [];
  const pace = Object.assign({ window:4, nextCount:3 }, Config.get('track.pace') || {});
  PACE_WIN = Math.max(1, +pace.window || 4);
  NEXT_N = Math.max(1, +pace.nextCount || 3);
  TOTAL = C.length;
  N_EX = C.filter(c => c.ex).length; N_TH = TOTAL - N_EX;
  LEVELS = [...new Set(C.map(c => c.lv))].sort((a, b) => a - b);
}
readConfig();

/* ── State ─────────────────────────────────────────────────────────────────── */
const DEF = {
  startDate:'2026-09-01', examDate:'2027-05-15', stageStart:'2027-01-04', stageEnd:'2027-06-30',
  /* The day tracking began. Ticks dated before it are the progress you already
     had when you set the app up — counted as done, but kept out of the pace and
     the trend, because they are not progress this app watched you make and
     counting them made the first week read as a sprint. Null falls back to
     startDate, so an install that never sets it behaves exactly as before. */
  trackFrom:null,
  revisionWeeks:4, applyLead:8, stageFactor:0.4,
  done:{},                             // topic id -> 'YYYY-MM-DD'
  pse:null,
  open:{},                             // level -> bool
};
let S = load();

function load() {
  let s;
  try { s = JSON.parse(localStorage.getItem(KEY) || 'null'); } catch { s = null; }
  return Object.assign({}, DEF, s || {}, { done:(s && s.done) || {}, open:(s && s.open) || {} });
}
function save() { try { localStorage.setItem(KEY, JSON.stringify(S)); } catch {} }

/* ── Dates ─────────────────────────────────────────────────────────────────── */
const WK = 7 * 864e5;
const isISO = s => /^\d{4}-\d{2}-\d{2}$/.test(String(s || ''));
function D(s) { const p = String(s).split('-').map(Number); return new Date(p[0], p[1] - 1, p[2], 12, 0, 0); }
function today() { return D(Shell.today()); }
function wks(a, b) { return (b - a) / WK; }
function addW(d, w) { return new Date(d.getTime() + w * WK); }
function fmt(d)  { return d.toLocaleDateString('en-GB', { day:'numeric', month:'short' }); }
function fmtY(d) { return d.toLocaleDateString('en-GB', { day:'numeric', month:'short', year:'2-digit' }); }
function n1(x)   { return (Math.round(x * 10) / 10).toFixed(1); }

/* ── Derived ───────────────────────────────────────────────────────────────── */
const doneCount = () => C.filter(c => S.done[c.id]).length;
const lvlItems  = lv => C.filter(c => c.lv === lv);
/* Every tick that carries a date. */
const allDoneDates = () => C.filter(c => S.done[c.id] && isISO(S.done[c.id])).map(c => D(S.done[c.id])).sort((a, b) => a - b);
const trackFromISO = () => (isISO(S.trackFrom) ? S.trackFrom : S.startDate);
/* Split at the tracking start: what came before is the baseline, what came on
   or after it is what the pace and the trend are made of. */
const baseCount = () => { const f = D(trackFromISO()); return allDoneDates().filter(d => d < f).length; };
const doneDates = () => { const f = D(trackFromISO()); return allDoneDates().filter(d => d >= f); };

function paceNow() {
  const ds = doneDates();
  if (ds.length < 2) return null;
  const t = today(), span = wks(ds[0], t);
  if (span < 1) return null;                          // not enough history to be honest
  if (span >= PACE_WIN) {
    const cut = addW(t, -PACE_WIN);
    return ds.filter(d => d >= cut).length / PACE_WIN;   // rolling
  }
  return ds.length / span;                            // early days: overall
}

function project() {
  const t = today(), rem = TOTAL - doneCount(), p = paceNow();
  const stage = D(S.stageStart), exam = D(S.examDate);
  const theoryDL = addW(exam, -S.revisionWeeks);
  const f = S.stageFactor;
  const wPre  = Math.max(0, wks(t, stage));
  const wPost = Math.max(0, wks(new Date(Math.max(stage, t)), theoryDL));
  const capacity = wPre + f * wPost;

  let finish = null;                                  // Date | 'done' | null
  if (rem <= 0) finish = 'done';
  else if (p > 0) {
    const pre = p * wPre;
    finish = pre >= rem ? addW(t, rem / p) : (f > 0 ? addW(stage, (rem - pre) / (p * f)) : null);
  }
  const atStage = p > 0 ? Math.min(TOTAL, doneCount() + p * wPre) : doneCount();

  return {
    rem, p, finish, stage, exam, theoryDL, wPre, wPost, atStage,
    needPre : rem > 0 && wPre > 0     ? rem / wPre     : null,   // all of it before the internship
    needReq : rem > 0 && capacity > 0 ? rem / capacity : null,   // enough of it to revise in time
  };
}

function verdict(j) {
  if (j.rem <= 0)             return ['g', 'Plan complete'];
  if (j.p == null)            return ['n', 'Tick two topics a week apart'];
  if (j.p <= 0)               return ['r', 'Stalled — nothing in ' + PACE_WIN + ' weeks'];
  if (!(j.finish instanceof Date)) return ['r', 'No capacity during the internship'];
  if (j.finish <= j.stage)    return ['g', 'Clear before the internship'];
  if (j.finish <= j.theoryDL) return ['g', 'Done before revision'];
  if (j.finish <= j.exam)     return ['a', 'Tight — eats your revision'];
  return ['r', 'Finishing after the exam'];
}

/* ── Render ────────────────────────────────────────────────────────────────── */
function render() {
  if (!$id('cum')) return;
  const j = project(), done = doneCount();

  $id('cum').textContent = done;
  $id('totalOf').textContent = '/' + TOTAL;
  $id('cTheory').textContent = C.filter(c => !c.ex && S.done[c.id]).length + '/' + N_TH;
  $id('cPrac').textContent   = C.filter(c =>  c.ex && S.done[c.id]).length + '/' + N_EX;
  const pseEl = $id('cPse');
  pseEl.textContent = S.pse ? '✓' : '—';
  pseEl.style.color = S.pse ? 'var(--gr)' : '';

  const [cls, txt] = verdict(j);
  const pill = $id('pill');
  pill.className = 'pill ' + cls; pill.textContent = txt;

  $id('pace').textContent = j.p != null ? n1(j.p) : '—';
  const fEl = $id('finish');
  fEl.className = 'v ' + (cls === 'n' ? '' : cls);
  fEl.textContent = j.finish === 'done' ? 'Done' : j.finish instanceof Date ? fmt(j.finish) : '—';
  const nEl = $id('needed');
  nEl.className = 'v acc';
  nEl.textContent = j.rem <= 0 ? '✓' : j.needReq != null ? n1(j.needReq) : '—';

  renderSqueeze(j); drawChart(j); renderMiles(j); renderNext(); renderLevels(); renderExtras(); renderSettings();
  $id('planCount').textContent = done + ' of ' + TOTAL;
}

function renderSqueeze(j) {
  const set = (id, v) => { $id(id).innerHTML = v; };
  set('sqPre', (j.needPre != null ? n1(j.needPre) : '—') + '<small>/wk</small>');
  set('sqReq', (j.needReq != null ? n1(j.needReq) : '—') + '<small>/wk</small>');
  $id('sqPreW').textContent =
    j.wPre > 0 ? Math.round(j.wPre) + ' weeks left before ' + fmt(j.stage) : 'the internship has started';
  $id('sqReqW').textContent = 'counting the internship at ' + Math.round(S.stageFactor * 100) + '% pace';
  set('sqAt', Math.round(j.atStage) + '<small> /' + TOTAL + '</small>');

  const left = TOTAL - Math.round(j.atStage);
  let note;
  if (j.rem <= 0) note = 'The plan is done. Everything from here is revision and the bench.';
  else if (j.p == null) note = 'Tick topics as you finish them and this fills in. Two ticks a week apart is enough to start projecting.';
  else if (j.p <= 0) note = 'Nothing ticked in the last ' + PACE_WIN + ' weeks, so there is no pace to project from. The two rates above are what it now takes.';
  else if (left <= 0) note = 'At this pace you finish the whole plan before you start. Everything after the internship starts is revision — that is the position you want.';
  else note = 'At this pace you walk into the internship with <b>' + left + ' topics still open</b>, and you have to clear them at ' +
              n1(S.stageFactor * j.p) + '/wk around a full-time placement — with the exam landing mid-way through it.';
  $id('sqNote').innerHTML = note;
}

function drawChart(j) {
  const W = 360, H = 240, padL = 26, padR = 12, padT = 12, padB = 32;
  const ds = doneDates();
  /* The line starts at the baseline height on the day tracking began, and only
     counted ticks move it — so the topics ticked during setup show as where you
     started rather than as a vertical cliff in week one. */
  const base = baseCount();
  const a0 = isISO(trackFromISO()) ? D(trackFromISO()) : today();
  const anchor = ds.length && ds[0] < a0 ? ds[0] : a0;
  const t = today();
  const ends = [wks(anchor, j.exam), wks(anchor, t)];
  if (j.finish instanceof Date) ends.push(wks(anchor, j.finish));
  const maxWk = Math.max(1, Math.max.apply(null, ends) + 1.5);
  const x = w => padL + (Math.max(0, Math.min(w, maxWk)) / maxWk) * (W - padL - padR);
  const y = v => H - padB - (v / Math.max(1, TOTAL)) * (H - padT - padB);
  const wk = d => wks(anchor, d);
  let s = '';

  // goal + axes
  s += `<line x1="${padL}" y1="${y(TOTAL)}" x2="${W - padR}" y2="${y(TOTAL)}" stroke="var(--bd-2)" stroke-width="1" stroke-dasharray="2 3"/>`;
  s += `<text x="${W - padR}" y="${y(TOTAL) - 4}" fill="var(--bd-2)" font-size="8" text-anchor="end">${TOTAL} PLAN</text>`;
  s += `<line x1="${padL}" y1="${y(0)}" x2="${W - padR}" y2="${y(0)}" stroke="var(--bd)"/>`;
  s += `<line x1="${padL}" y1="${padT}" x2="${padL}" y2="${y(0)}" stroke="var(--bd)"/>`;
  [0, Math.round(TOTAL / 2), TOTAL].forEach(v => {
    s += `<text x="${padL - 5}" y="${y(v) + 3}" fill="var(--tx-2)" font-size="8" text-anchor="end">${v}</text>`; });

  // internship band
  const bs = x(wk(j.stage)), be = x(wk(isISO(S.stageEnd) ? D(S.stageEnd) : j.stage));
  if (be > bs) s += `<rect x="${bs}" y="${padT}" width="${be - bs}" height="${y(0) - padT}" fill="var(--gr)" opacity=".055"/>`;

  // milestone verticals
  const marks = [
    [wk(addW(j.stage, -S.applyLead)), 'APPLY',  'var(--y)'],
    [wk(j.stage),                     'STAGE',  'var(--gr)'],
    [wk(j.theoryDL),                  'REVISE', 'var(--or)'],
    [wk(j.exam),                      'EXAM',   'var(--re)'],
  ];
  marks.forEach((m, i) => {
    if (m[0] < 0 || m[0] > maxWk) return;
    s += `<line x1="${x(m[0])}" y1="${padT}" x2="${x(m[0])}" y2="${y(0)}" stroke="${m[2]}" stroke-width="1" stroke-dasharray="2 4" opacity=".5"/>`;
    s += `<text x="${x(m[0])}" y="${H - (i % 2 ? 6 : 18)}" fill="${m[2]}" font-size="7.5" text-anchor="middle" opacity=".9">${m[1]}</text>`;
  });

  // required line — two slopes, bending at the internship
  if (j.rem > 0 && j.needReq != null) {
    const dn = doneCount(), r = j.needReq;
    const mid = Math.min(TOTAL, dn + r * j.wPre);
    s += `<polyline points="${x(wk(t))},${y(dn)} ${x(wk(j.stage))},${y(mid)} ${x(wk(j.theoryDL))},${y(TOTAL)}" fill="none" stroke="var(--gr)" stroke-width="1.5" stroke-dasharray="4 4" opacity=".75"/>`;
  }

  // actual
  const pts = [[0, base]]; let run = base;
  ds.forEach(d => { run++; pts.push([wk(d), run]); });
  const nReal = pts.length - 1;                                          // dots mark completions only
  if (pts.length > 1 && wk(t) > pts[pts.length - 1][0]) pts.push([wk(t), run]);  // flat line up to today
  s += `<polyline points="${pts.map(p => x(p[0]) + ',' + y(p[1])).join(' ')}" fill="none" stroke="var(--y)" stroke-width="2.5" stroke-linejoin="round" stroke-linecap="round"/>`;

  // projection — bends at the internship too
  if (j.finish instanceof Date && j.p > 0) {
    const dn = doneCount(), sw = wk(j.stage), fw = wk(j.finish), nw = wk(t);
    const seg = fw <= sw ? [[nw, dn], [fw, TOTAL]]
                         : [[nw, dn], [sw, Math.min(TOTAL, dn + j.p * j.wPre)], [fw, TOTAL]];
    s += `<polyline points="${seg.map(p => x(p[0]) + ',' + y(p[1])).join(' ')}" fill="none" stroke="var(--y)" stroke-width="1.5" stroke-dasharray="2 4" opacity=".5"/>`;
  }
  pts.slice(1, 1 + nReal).forEach(p => { s += `<circle cx="${x(p[0])}" cy="${y(p[1])}" r="2.4" fill="var(--bg)" stroke="var(--y)" stroke-width="1.8"/>`; });

  $id('chart').innerHTML = s;
  $id('trajRange').textContent = fmt(anchor) + ' → ' + fmtY(j.exam);
}

function renderMiles(j) {
  const t = today();
  const rows = [
    ['Apply for the internship', addW(j.stage, -S.applyLead), 'send applications'],
    ['Internship starts',        j.stage,                     'pace drops to ' + Math.round(S.stageFactor * 100) + '%'],
    ['Plan finished',            j.theoryDL,                  'to leave ' + S.revisionWeeks + ' weeks of revision'],
    ['Exam',                     j.exam,                      'during the internship'],
  ];
  let hot = false;
  $id('miles').innerHTML = rows.map(r => {
    const w = wks(t, r[1]), past = w < 0;
    const isHot = !past && !hot; if (isHot) hot = true;
    return `<div class="mile card${isHot ? ' hot' : ''}${past ? ' past' : ''}">
      <div class="ml"><div class="mn">${esc(r[0])}</div><div class="md">${esc(r[2])}</div></div>
      <div class="mr">${past ? 'passed' : Math.round(w) + ' wk'}<small>${fmtY(r[1])}</small></div></div>`;
  }).join('');
}

function renderNext() {
  const up = C.filter(c => !S.done[c.id]).slice(0, NEXT_N);
  const el = $id('next');
  if (!up.length) { el.innerHTML = '<div class="nextEmpty">Every topic ticked. Revise.</div>'; return; }
  el.innerHTML = up.map(c => `<div class="nextRow row${c.ex ? ' ex' : ''}" data-id="${esc(c.id)}">
      <div class="tick">✓</div>
      <div class="nt">${esc(c.t)}${c.ex ? '<span class="badge">bench</span>' : ''}
        <div class="nm">${esc(LEVEL_LABEL)} ${c.lv} · ${esc(c.dom)}</div></div></div>`).join('');
}

function renderLevels() {
  let html = '';
  LEVELS.forEach(lv => {
    const items = lvlItems(lv), n = items.filter(c => S.done[c.id]).length;
    const pct = items.length ? Math.round(n / items.length * 100) : 0;
    const open = S.open[lv];
    html += `<div class="lvl card${open ? ' open' : ''}${n === items.length ? ' done' : ''}">
      <div class="lvlHead" data-lv="${lv}">
        <div class="lh"><div class="ln">${esc(LEVEL_LABEL)} ${lv}</div>
          <div class="lc">${n}/${items.length} · ${pct}%</div>
          <div class="bar"><i style="width:${pct}%"></i></div></div>
        <div class="lx">›</div></div>
      <div class="lvlBody">`;
    let ph = null, dom = null;
    items.forEach(c => {
      if (c.ph !== ph) { ph = c.ph; dom = null; html += `<div class="phase">${esc(PHASES[ph] || ph)}</div>`; }
      if (c.dom !== dom) { dom = c.dom; html += `<div class="dom">${esc(dom)}</div>`; }
      const d = S.done[c.id];
      html += `<div class="row${d ? ' on' : ''}${c.ex ? ' ex' : ''}" data-id="${esc(c.id)}">
        <div class="tick">✓</div>
        <div class="t">${esc(c.t)}${c.ex ? '<span class="badge">bench</span>' : ''}</div>
        ${d ? `<button class="when" data-when="${esc(c.id)}" aria-label="edit date">${isISO(d) ? fmt(D(d)) : d}</button>` : ''}</div>`;
    });
    html += '</div></div>';
  });
  $id('levels').innerHTML = html;
}

function renderExtras() {
  $id('extras').innerHTML = `
    <div class="lvlBody" style="padding-top:12px">
      <div class="row${S.pse ? ' on' : ''}" id="pseRow"><div class="tick">✓</div>
        <div class="t">${esc(PSE.label)}<span class="badge">subject</span>
          ${PSE.note ? `<div class="extraNote">${esc(PSE.note)}</div>` : ''}</div></div>
      ${REVISION.length ? `<div class="dom" style="margin-top:14px">Révisions avant examen — every level</div>
      <div class="revList">${REVISION.map(l => '+ ' + esc(l)).join('<br>')}</div>` : ''}
    </div>`;
}

/* ── Settings panel ────────────────────────────────────────────────────────── */
function renderSettings() {
  if (!$id('setExam')) return;
  const fill = (id, v) => { const el = $id(id); if (el && document.activeElement !== el) el.value = v; };
  fill('setStart', S.startDate);
  fill('setTrackFrom', trackFromISO());
  const bn = $id('baseNote');
  if (bn) {
    const n = baseCount();
    bn.textContent = n
      ? `${n} tick${n === 1 ? '' : 's'} before that date — counted as done, kept out of the pace`
      : 'nothing ticked before that date yet';
  }
  fill('setExam', S.examDate);
  fill('setStageStart', S.stageStart);
  fill('setStageEnd', S.stageEnd);
  fill('setRev', S.revisionWeeks);
  fill('setLead', S.applyLead);
  fill('setFactor', Math.round(S.stageFactor * 100));
  $id('setFactorV').textContent = Math.round(S.stageFactor * 100) + '%';
  $all('[data-cfg="track.pace"]').forEach(i => {
    if (document.activeElement !== i) i.value = i.dataset.sub === 'window' ? PACE_WIN : NEXT_N;
  });
}

function exportData() {
  const blob = new Blob([JSON.stringify(S, null, 2)], { type:'application/json' });
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = 'cap-tracker-' + Shell.today() + '.json';
  a.click(); setTimeout(() => URL.revokeObjectURL(a.href), 1000);
  toast('exported');
}
function pickImport() { $id('fileIn').click(); }
async function importData(e) {
  const f = e.target.files && e.target.files[0]; e.target.value = '';
  if (!f) return;
  try {
    const o = JSON.parse(await f.text());
    if (!o || typeof o !== 'object' || !o.done) throw new Error('bad file');
    S = Object.assign({}, DEF, o, { done:o.done || {}, open:o.open || {} });
    save(); render(); toast('imported');
  } catch { toast('could not read that file'); }
}
function resetAll() {
  if (!Shell.confirm('Reset every tick and every date? This cannot be undone.')) return;
  S = Object.assign({}, DEF, { done:{}, open:{} }); save(); render(); toast('reset');
}

/* ── Interaction ───────────────────────────────────────────────────────────── */
function toggle(id) {
  if (S.done[id]) delete S.done[id]; else S.done[id] = Shell.today();
  save(); render(); Prefs.tap();
}

view.addEventListener('click', e => {
  const when = e.target.closest('[data-when]');
  if (when) {
    e.stopPropagation();
    const id = when.dataset.when;
    const v = window.prompt('Date finished (YYYY-MM-DD):', S.done[id]);
    if (v && isISO(v.trim())) { S.done[id] = v.trim(); save(); render(); }
    else if (v !== null) toast('use YYYY-MM-DD');
    return;
  }
  const head = e.target.closest('.lvlHead');
  if (head) { const lv = head.dataset.lv; S.open[lv] = !S.open[lv]; save(); render(); return; }
  if (e.target.closest('#pseRow')) { S.pse = S.pse ? null : Shell.today(); save(); render(); return; }
  const row = e.target.closest('.row[data-id]');
  if (row) toggle(row.dataset.id);
});

const bind = (id, ev, fn) => { const el = $id(id); if (el) el.addEventListener(ev, fn); };
bind('setStart',      'change', e => { if (isISO(e.target.value)) { S.startDate  = e.target.value; save(); render(); } });
bind('setTrackFrom',  'change', e => { if (isISO(e.target.value)) { S.trackFrom  = e.target.value; save(); render(); } });
bind('setExam',       'change', e => { if (isISO(e.target.value)) { S.examDate   = e.target.value; save(); render(); } });
bind('setStageStart', 'change', e => { if (isISO(e.target.value)) { S.stageStart = e.target.value; save(); render(); } });
bind('setStageEnd',   'change', e => { if (isISO(e.target.value)) { S.stageEnd   = e.target.value; save(); render(); } });
bind('setRev',  'change', e => { S.revisionWeeks = Math.max(0, +e.target.value || 0); save(); render(); });
bind('setLead', 'change', e => { S.applyLead     = Math.max(0, +e.target.value || 0); save(); render(); });
bind('setFactor', 'input', e => {
  S.stageFactor = Math.max(0, Math.min(1, (+e.target.value || 0) / 100));
  $id('setFactorV').textContent = Math.round(S.stageFactor * 100) + '%';
  save(); render();
});

/* legacy weekly log — preserved, never migrated: a weekly count cannot be
   attributed to specific topics, and guessing would poison the timeline. */
(function legacy() {
  let w = null;
  try { w = JSON.parse(localStorage.getItem(LEGACY_KEY) || 'null'); } catch {}
  if (!Array.isArray(w) || !w.length) return;
  const el = $id('legacy'); if (!el) return;
  el.style.display = 'block';
  el.innerHTML = '<b>Old weekly log found</b> — ' + w.length + ' weeks, ' + w.reduce((a, b) => a + b, 0) +
    ' cours. Left untouched in storage under <code>' + LEGACY_KEY + '</code>. It is not migrated: a weekly count ' +
    'cannot be attributed to specific topics. Tick what you have actually finished below.' +
    '<br><button type="button" id="legacyX">Dismiss</button>';
  $id('legacyX').onclick = () => { el.style.display = 'none'; };
})();

/* ── Boot ──────────────────────────────────────────────────────────────────── */
if (!Object.keys(S.open).length) {                 // open the first unfinished level
  const lv = (C.find(c => !S.done[c.id]) || { lv:LEVELS[0] || 1 }).lv;
  S.open[lv] = true;
}
render();

Config.subscribe(path => {
  if (path !== '*' && !String(path).startsWith('track.')) return;
  readConfig(); render();
});

Shell.register('track', { onShow: render, onDayChange: render });

/* For LOG's daily note: the topics finished on a given day, and where the plan
   stands. Read straight from state so it works for any past day too. */
function doneOn(iso) {
  return C.filter(c => S.done[c.id] === iso).map(c => ({ id:c.id, title:c.t, level:c.lv, bench:c.ex }));
}
function progress() { return { done:doneCount(), total:TOTAL, pse:!!S.pse }; }

/* "Everything ticked so far is where I am starting from." Moves the tracking
   start to tomorrow, so every tick that exists today falls behind it. No dates
   are rewritten — which is what makes this safe to press twice, and what keeps
   the record of when each topic was actually ticked. */
function baselineNow() {
  const t = today();
  const d = new Date(t.getFullYear(), t.getMonth(), t.getDate() + 1);
  S.trackFrom = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
  save(); render();
  const n = baseCount();
  toast(n ? `${n} topic${n === 1 ? '' : 's'} set as your starting point` : 'tracking starts tomorrow');
}

return { render, renderSettings, toggle, exportData, pickImport, importData, resetAll, project,
         doneOn, progress, baselineNow, baseCount, trackFrom: trackFromISO };
})();
