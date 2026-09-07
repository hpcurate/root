/* ── TOOLS ────────────────────────────────────────────────────────────────────
   The small instruments a working day needs and no other app in ROOT is the
   right home for: a pomodoro, a stopwatch, a countdown and a decider.

   ── Why it is one app and not four ──────────────────────────────────────────
   None of these four is an app. Each is one control, one readout and one
   number you keep for the day; a tab per instrument would be four tabs that
   are each empty most of the time. They are one tab with a strip across the
   top — CREATE's strip, for CREATE's reason: what you want is *an instrument*,
   and choosing which is a tap rather than a place to navigate to.

   ── The clock is a timestamp, never a counter ───────────────────────────────
   **Nothing here counts intervals.** Every running thing stores the wall-clock
   moment it ends (or, for the stopwatch, the moment it started plus what was
   already banked) and every readout is `Date.now()` measured against that. A
   `setInterval` that increments a number is wrong on this device for three
   reasons — a background tab is throttled to once a second at best, a phone
   that sleeps stops firing it entirely, and a reload loses it — and all three
   are exactly the case a pomodoro is used in. Timestamps survive all of them:
   come back after twenty minutes on another tab and the timer is where it
   should be, not twenty minutes behind.

   The interval that does exist only *paints*, and it runs whatever tab you are
   on, because a timer that finishes while you are in LOG still has to say so.
   It is a no-op while nothing is running.

   ── What is Config's and what is this file's ────────────────────────────────
     · the pomodoro's four lengths, the countdown's quick chips and the
       decider's lists are Config (`tools.*`), editable in Settings → tools
     · what is running, and the day's tally, are in `tools_v1`

   Markup is in two places (the slide and the settings panel), so every button
   carries `data-act` and one document-level listener filtered on
   `.closest('.ns-tools')` dispatches — TEND's pattern, for TEND's reason: a
   decider list is the user's own text and interpolating it into an inline
   handler is one more thing to get wrong. */
window.TOOLS = (function () {
'use strict';

const SCOPE = '.ns-tools ';
const $id   = id  => document.querySelector(SCOPE + '#' + id);
const view  = document.getElementById('view-tools');
const toast = msg => Shell.toast(msg);
const esc   = s => String(s == null ? '' : s).replace(/[&<>"']/g, c =>
  ({ '&':'&amp;', '<':'&lt;', '>':'&gt;', '"':'&quot;', "'":'&#39;' }[c]));

const KEY = 'tools_v1';

/* ── Content ───────────────────────────────────────────────────────────────── */
let POM, QUICK, DECKS;
function readConfig() {
  POM = Object.assign({ focus:25, short:5, long:15, rounds:4, autoStart:false },
                      Config.get('tools.pomodoro') || {});
  ['focus','short','long'].forEach(k => { POM[k] = Math.max(1, Math.min(180, +POM[k] || 1)); });
  POM.rounds = Math.max(1, Math.min(12, +POM.rounds || 4));
  POM.autoStart = !!POM.autoStart;
  QUICK = (Config.get('tools.timers') || []).map(n => Math.max(1, Math.min(600, +n || 0)))
            .filter(Boolean);
  if (!QUICK.length) QUICK = [5, 10, 25];
  DECKS = Config.get('tools.decks') || {};
}
readConfig();

/* ── State ─────────────────────────────────────────────────────────────────── */
/* `endsAt` is a wall-clock ms stamp and is the only thing that says a phase is
   running. `left` is what is left in ms while it is paused, and the two are
   never both set — a paused thing has no end, and a running thing has nothing
   banked. Every readout asks which of the two is filled. */
const blank = () => ({
  v: 1,
  tool: 'pom',
  pom:   { phase:'focus', round:1, endsAt:0, left:0, days:{} },
  sw:    { startedAt:0, banked:0, laps:[] },
  timer: { endsAt:0, left:0, total:0, label:'' },
  decide:{ deck:'', last:'' },
});

let DB = blank();
function load() {
  let s = null;
  try { s = JSON.parse(localStorage.getItem(KEY) || 'null'); } catch {}
  DB = normalise(s);
}
/* Rebuilt from its known keys, never trusted. The curate cache in CREATE
   earned this rule the hard way (ROOT.md §6): one undefined array out of a
   store nobody validated took out a whole tab. */
function normalise(s) {
  const d = blank();
  if (!s || typeof s !== 'object') return d;
  const p = s.pom || {}, w = s.sw || {}, t = s.timer || {}, dc = s.decide || {};
  d.tool = ['pom','sw','timer','decide'].includes(s.tool) ? s.tool : 'pom';
  d.pom = {
    phase: ['focus','short','long'].includes(p.phase) ? p.phase : 'focus',
    round: Math.max(1, +p.round || 1),
    endsAt: Math.max(0, +p.endsAt || 0),
    left:   Math.max(0, +p.left || 0),
    days: (p.days && typeof p.days === 'object') ? p.days : {},
  };
  d.sw = {
    startedAt: Math.max(0, +w.startedAt || 0),
    banked:    Math.max(0, +w.banked || 0),
    laps: Array.isArray(w.laps) ? w.laps.map(x => Math.max(0, +x || 0)).slice(0, 200) : [],
  };
  d.timer = {
    endsAt: Math.max(0, +t.endsAt || 0),
    left:   Math.max(0, +t.left || 0),
    total:  Math.max(0, +t.total || 0),
    label:  String(t.label == null ? '' : t.label),
  };
  d.decide = { deck: String(dc.deck || ''), last: String(dc.last || '') };
  return d;
}
function save() { try { localStorage.setItem(KEY, JSON.stringify(DB)); } catch {} }
load();

/* ── Time ──────────────────────────────────────────────────────────────────── */
const MIN = 60000;
/* mm:ss, and h:mm:ss once there is an hour to say. Rounded *up* so a timer
   started at 25:00 reads 25:00 rather than 24:59 for its first second. */
function clock(ms) {
  const s = Math.max(0, Math.ceil(ms / 1000));
  const h = Math.floor(s / 3600), m = Math.floor((s % 3600) / 60), x = s % 60;
  const mm = String(m).padStart(2, '0'), ss = String(x).padStart(2, '0');
  return h ? `${h}:${mm}:${ss}` : `${mm}:${ss}`;
}
/* The stopwatch says hundredths, because that is the only reason to use one
   rather than the countdown. */
function clockCs(ms) {
  const cs = Math.max(0, Math.floor(ms / 10));
  const s = Math.floor(cs / 100), h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60), x = s % 60;
  const mm = String(m).padStart(2, '0'), ss = String(x).padStart(2, '0');
  const cc = String(cs % 100).padStart(2, '0');
  return (h ? `${h}:${mm}:${ss}` : `${mm}:${ss}`) + '.' + cc;
}

/* ── The pomodoro ──────────────────────────────────────────────────────────── */
const PHASES = {
  focus: { label:'focus',       mins: () => POM.focus, cls:'focus' },
  short: { label:'short break', mins: () => POM.short, cls:'break' },
  long:  { label:'long break',  mins: () => POM.long,  cls:'break' },
};
const pomPhase  = () => PHASES[DB.pom.phase] || PHASES.focus;
const pomTotal  = () => pomPhase().mins() * MIN;
const pomLeft   = () => DB.pom.endsAt ? Math.max(0, DB.pom.endsAt - Date.now()) : DB.pom.left;
const pomRunning= () => !!DB.pom.endsAt;
/* Today's finished focus rounds. Kept per day so the number on the band is
   "what I have done today" and not a lifetime total nobody acts on. */
const pomToday  = () => Math.max(0, +DB.pom.days[Shell.today()] || 0);

function pomStart() {
  const left = pomLeft() || pomTotal();
  DB.pom.endsAt = Date.now() + left;
  DB.pom.left = 0;
  save(); render();
}
function pomPause() {
  if (!pomRunning()) return;
  DB.pom.left = pomLeft();
  DB.pom.endsAt = 0;
  save(); render();
}
function pomReset() {
  DB.pom.endsAt = 0; DB.pom.left = 0;
  save(); render();
}
/* The next phase in the cycle: `rounds` focuses, each followed by a short
   break, and a long one after the last. The round counter is what says which
   of the two a break is, so it advances on the focus that just ended rather
   than on the break — a break is not a round. */
function pomAdvance(finished) {
  const p = DB.pom;
  if (p.phase === 'focus') {
    if (finished) {
      const k = Shell.today();
      p.days[k] = (+p.days[k] || 0) + 1;
      /* Only the last 90 days are kept: the tally is a "today" number and a
         year of them is a store that only grows. */
      const floor = Object.keys(p.days).sort().slice(-90);
      p.days = floor.reduce((o, d) => { o[d] = p.days[d]; return o; }, {});
    }
    p.phase = (p.round % POM.rounds === 0) ? 'long' : 'short';
  } else {
    if (p.phase === 'long') p.round = 1; else p.round = p.round + 1;
    p.phase = 'focus';
  }
  p.endsAt = 0; p.left = 0;
  if (POM.autoStart) { p.endsAt = Date.now() + pomTotal(); }
  save();
}
function pomSkip() { pomAdvance(false); render(); toast(pomPhase().label); }

/* ── The stopwatch ─────────────────────────────────────────────────────────── */
const swElapsed = () => DB.sw.banked + (DB.sw.startedAt ? Date.now() - DB.sw.startedAt : 0);
const swRunning = () => !!DB.sw.startedAt;
function swToggle() {
  if (swRunning()) { DB.sw.banked = swElapsed(); DB.sw.startedAt = 0; }
  else DB.sw.startedAt = Date.now();
  save(); render();
}
function swLap() {
  if (!swRunning() && !DB.sw.banked) return;
  DB.sw.laps.unshift(swElapsed());
  DB.sw.laps = DB.sw.laps.slice(0, 200);
  save(); render();
}
function swReset() {
  DB.sw = { startedAt:0, banked:0, laps:[] };
  save(); render();
}

/* ── The countdown ─────────────────────────────────────────────────────────── */
const tmLeft    = () => DB.timer.endsAt ? Math.max(0, DB.timer.endsAt - Date.now()) : DB.timer.left;
const tmRunning = () => !!DB.timer.endsAt;
const tmArmed   = () => tmRunning() || DB.timer.left > 0;
function tmSet(mins, label) {
  const ms = Math.max(1, Math.min(600, +mins || 0)) * MIN;
  DB.timer = { endsAt: Date.now() + ms, left:0, total: ms, label: String(label || '') };
  save(); render();
}
function tmToggle() {
  if (tmRunning()) { DB.timer.left = tmLeft(); DB.timer.endsAt = 0; }
  else if (DB.timer.left > 0) { DB.timer.endsAt = Date.now() + DB.timer.left; DB.timer.left = 0; }
  else return;
  save(); render();
}
function tmClear() {
  DB.timer = { endsAt:0, left:0, total:0, label:'' };
  save(); render();
}
function tmCustom() {
  Shell.prompt('How many minutes?\nA whole number, up to 600.', '', v => {
    const n = Math.round(parseFloat(String(v).replace(',', '.')) || 0);
    if (!n) return;
    tmSet(n, '');
  });
}

/* ── The decider ───────────────────────────────────────────────────────────── */
const deckNames = () => Object.keys(DECKS);
function deckKey() {
  const k = DB.decide.deck;
  return DECKS[k] ? k : (deckNames()[0] || '');
}
function decide() {
  const items = (DECKS[deckKey()] || []).filter(Boolean);
  if (!items.length) { toast('that list is empty'); return; }
  /* Never the same answer twice running, unless the list is one item long —
     a decider that repeats itself is a decider you stop believing. */
  let pick = items[Math.floor(Math.random() * items.length)];
  if (items.length > 1 && pick === DB.decide.last) {
    const rest = items.filter(x => x !== DB.decide.last);
    pick = rest[Math.floor(Math.random() * rest.length)];
  }
  DB.decide.last = pick;
  save(); render();
}

/* ── The tick ──────────────────────────────────────────────────────────────────
   One interval for the whole app, running whatever tab is on screen, and doing
   nothing at all when nothing is running. It has two jobs and they are not the
   same job: **finishing** a phase, which must happen wherever you are, and
   **painting** the readout, which only matters if the readout is on screen.

   250ms rather than 1000: the stopwatch shows hundredths, and a second-long
   tick under a hundredths readout is a number that jumps by 25. */
let timer = null;
function needsTick() { return pomRunning() || swRunning() || tmRunning(); }
function syncTick() {
  if (needsTick() && !timer) timer = setInterval(tick, 250);
  else if (!needsTick() && timer) { clearInterval(timer); timer = null; }
}
function tick() {
  let fired = false;
  if (pomRunning() && pomLeft() <= 0) {
    const was = pomPhase().label;
    pomAdvance(true);
    toast(was + ' done · ' + pomPhase().label + ' next');
    fired = true;
  }
  if (tmRunning() && tmLeft() <= 0) {
    const l = DB.timer.label;
    tmClear();                              // clears, saves and re-renders
    toast(l ? l + ' · time' : 'timer done');
    fired = true;
  }
  /* A phase ending changes more than the digits — the ring's colour, the
     button's word, the round — so that is a full draw. Every other tick moves
     the two things that actually moved, because rebuilding the body four
     times a second would take the focus out of anything under a finger. */
  if (fired) { render(); return; }
  if (isOn()) paint();
  syncTick();
}
/* The shell marks the live slide `.cur`, not `.on` — `.on` is a *screen*
   inside a slide, and TOOLS has one of those. */
const isOn = () => !!view && view.classList.contains('cur');

/* ── Screens ───────────────────────────────────────────────────────────────── */
const TOOLS = [
  { key:'pom',    label:'pomodoro' },
  { key:'sw',     label:'stopwatch' },
  { key:'timer',  label:'timer' },
  { key:'decide', label:'decide' },
];
const tool = () => (TOOLS.some(t => t.key === DB.tool) ? DB.tool : 'pom');

/* The strip, the glider and the scroll-into-view are CREATE's, line for line —
   ROOT.md §6 names the pair, because a third copy of a shape is a third thing
   to keep in step. */
function renderTabs() {
  const bar = $id('tl-tabs'); if (!bar) return;
  const sel = tool();
  const sig = TOOLS.map(t => t.key).join('|');
  if (bar.dataset.sig !== sig) {
    bar.dataset.sig = sig;
    bar.innerHTML = `<div class="tl-tglide"></div>` + TOOLS.map(t =>
      `<button class="tl-tab${t.key === sel ? ' active' : ''}" data-act="tool" data-t="${esc(t.key)}"
              >${esc(t.label)}</button>`).join('');
  } else {
    bar.querySelectorAll('.tl-tab').forEach(b => b.classList.toggle('active', b.dataset.t === sel));
  }
  const active = bar.querySelector('.tl-tab.active');
  const glider = bar.querySelector('.tl-tglide');
  if (!active || !glider) return;
  glider.style.width = active.offsetWidth + 'px';
  glider.style.transform = `translateX(${active.offsetLeft}px)`;
  if (bar.scrollWidth <= bar.clientWidth) return;
  const left = active.offsetLeft, right = left + active.offsetWidth;
  if (left < bar.scrollLeft) bar.scrollLeft = left;
  else if (right > bar.scrollLeft + bar.clientWidth) bar.scrollLeft = right - bar.clientWidth;
}

/* The band: what the number opposite the wordmark is counting depends on the
   instrument, because "3" means nothing without it. Focus rounds today, laps
   taken, minutes set, choices on the list. */
function paintBand() {
  const box = $id('tl-daynum'), lab = $id('tl-label');
  const t = tool();
  const n = t === 'pom'  ? pomToday()
          : t === 'sw'   ? DB.sw.laps.length
          : t === 'timer'? Math.round((DB.timer.total || 0) / MIN)
          : (DECKS[deckKey()] || []).length;
  const word = t === 'pom'  ? 'focus rounds today'
             : t === 'sw'   ? 'laps'
             : t === 'timer'? (DB.timer.label || 'minutes set')
             : (deckKey() || 'nothing to choose from');
  if (lab) lab.textContent = word;
  if (box && window.Shell && Shell.rollNum) Shell.rollNum(box, String(n), n);
}

/* ── The big readout ────────────────────────────────────────────────────────
   One shape for all three clocks: a ring that empties, the time inside it, and
   a word under it. It is an SVG circle with a dash offset rather than a
   conic-gradient, so it animates on the property browsers can animate cheaply
   and it is the same drawing at any size. */
const R = 78, CIRC = 2 * Math.PI * R;
function ringHTML(frac, cls, big, sub, note) {
  const off = CIRC * (1 - Math.max(0, Math.min(1, frac)));
  return `<div class="tl-ring ${cls}">
    <svg viewBox="0 0 180 180" aria-hidden="true">
      <circle class="tr" cx="90" cy="90" r="${R}"></circle>
      <circle class="tp" cx="90" cy="90" r="${R}"
              stroke-dasharray="${CIRC.toFixed(1)}" stroke-dashoffset="${off.toFixed(1)}"></circle>
    </svg>
    <div class="tl-read">
      <div class="tl-big" id="tl-big">${esc(big)}</div>
      <div class="tl-sub">${esc(sub)}</div>
    </div>
  </div>${note ? `<div class="tl-note">${esc(note)}</div>` : ''}`;
}

function pomHTML() {
  const total = pomTotal(), left = pomLeft() || total;
  const ph = pomPhase();
  const done = pomToday();
  return ringHTML(left / total, ph.cls, clock(left),
                  ph.label + ' · round ' + DB.pom.round + '/' + POM.rounds,
                  done ? done + ' focus round' + (done === 1 ? '' : 's') + ' finished today'
                       : 'nothing finished yet today') + `
    <div class="tl-acts">
      <button class="tl-go${pomRunning() ? ' on' : ''}" data-act="pom-toggle">${pomRunning() ? 'pause' : 'start'}</button>
      <button class="tl-b" data-act="pom-skip">skip →</button>
      <button class="tl-b" data-act="pom-reset">reset</button>
    </div>
    <div class="tl-hint">${esc(POM.focus)} focus · ${esc(POM.short)} short · ${esc(POM.long)} long, every ${esc(POM.rounds)} rounds${
      POM.autoStart ? ' · rolls straight on' : ''}</div>`;
}

function swHTML() {
  const e = swElapsed();
  const laps = DB.sw.laps;
  return ringHTML(swRunning() ? (e % 60000) / 60000 : 0, 'watch', clockCs(e),
                  swRunning() ? 'running' : e ? 'stopped' : 'ready', '') + `
    <div class="tl-acts">
      <button class="tl-go${swRunning() ? ' on' : ''}" data-act="sw-toggle">${swRunning() ? 'stop' : e ? 'resume' : 'start'}</button>
      <button class="tl-b" data-act="sw-lap"${e ? '' : ' disabled'}>lap</button>
      <button class="tl-b" data-act="sw-reset"${e ? '' : ' disabled'}>reset</button>
    </div>
    ${laps.length ? `<div class="tl-sec"><span>Laps</span><em>${laps.length}</em></div>
      ${laps.map((ms, i) => {
        const prev = laps[i + 1] || 0;
        return `<div class="tl-lap"><span class="n">${laps.length - i}</span>
          <span class="s">+${esc(clockCs(ms - prev))}</span>
          <span class="t">${esc(clockCs(ms))}</span></div>`;
      }).join('')}` : ''}`;
}

function tmHTML() {
  const left = tmLeft(), total = DB.timer.total;
  return ringHTML(total ? left / total : 0, 'timer',
                  total ? clock(left) : '––:––',
                  DB.timer.label || (tmRunning() ? 'running' : total ? 'paused' : 'pick a length'), '') + `
    <div class="tl-acts">
      <button class="tl-go${tmRunning() ? ' on' : ''}" data-act="tm-toggle"${tmArmed() ? '' : ' disabled'}>${
        tmRunning() ? 'pause' : 'start'}</button>
      <button class="tl-b" data-act="tm-clear"${tmArmed() ? '' : ' disabled'}>clear</button>
    </div>
    <div class="tl-sec"><span>Quick</span><em>minutes</em></div>
    <div class="tl-chips">${QUICK.map(n =>
      `<button class="tl-chip" data-act="tm-set" data-m="${n}">${n}</button>`).join('')}
      <button class="tl-chip alt" data-act="tm-custom">other…</button></div>`;
}

function decideHTML() {
  const names = deckNames(), k = deckKey();
  const items = DECKS[k] || [];
  if (!names.length) {
    return `<div class="tl-empty">No lists yet.<br>Settings → tools gives this one something to choose from.</div>`;
  }
  return `${names.length > 1 ? `<div class="tl-chips">${names.map(n =>
      `<button class="tl-chip${n === k ? ' on' : ''}" data-act="deck" data-d="${esc(n)}">${esc(n)}</button>`).join('')}</div>` : ''}
    <div class="tl-pick${DB.decide.last ? ' has' : ''}">${DB.decide.last
      ? esc(DB.decide.last) : 'tap below and stop thinking about it'}</div>
    <div class="tl-acts">
      <button class="tl-go" data-act="decide"${items.length ? '' : ' disabled'}>pick one</button>
    </div>
    <div class="tl-sec"><span>${esc(k)}</span><em>${items.length} option${items.length === 1 ? '' : 's'}</em></div>
    <div class="tl-list">${items.map(i =>
      `<div class="tl-row${i === DB.decide.last ? ' on' : ''}">${esc(i)}</div>`).join('')}</div>`;
}

/* Only the readout is repainted on a tick — rebuilding the whole body four
   times a second would take the focus out of anything under a finger and make
   the lap list flicker. The shape is written once by render(); paint() moves
   the two things that actually change. */
function paint() {
  const t = tool();
  const big = $id('tl-big');
  const ring = view && view.querySelector('.tl-ring .tp');
  let text = '', frac = 0;
  if (t === 'pom')   { const total = pomTotal(), l = pomLeft() || total; text = clock(l); frac = l / total; }
  else if (t === 'sw') { const e = swElapsed(); text = clockCs(e); frac = swRunning() ? (e % 60000) / 60000 : 0; }
  else if (t === 'timer') { const l = tmLeft(); text = DB.timer.total ? clock(l) : '––:––';
                            frac = DB.timer.total ? l / DB.timer.total : 0; }
  else return;
  if (big) big.textContent = text;
  if (ring) ring.setAttribute('stroke-dashoffset',
    (CIRC * (1 - Math.max(0, Math.min(1, frac)))).toFixed(1));
}

function render() {
  renderTabs();
  paintBand();
  const box = $id('tl-body');
  if (box) {
    const t = tool();
    box.className = 'tl-body t-' + t;
    box.innerHTML = t === 'pom' ? pomHTML() : t === 'sw' ? swHTML()
                  : t === 'timer' ? tmHTML() : decideHTML();
  }
  syncTick();
}

/* ── The delegated listener ────────────────────────────────────────────────── */
document.addEventListener('click', ev => {
  if (!ev.target.closest || !ev.target.closest('.ns-tools')) return;
  const t = ev.target.closest('[data-act]');
  const act = t && t.dataset.act;
  if (!act || t.disabled) return;

  if (act === 'tool')       { DB.tool = t.dataset.t; save(); render(); return; }
  if (act === 'pom-toggle') { pomRunning() ? pomPause() : pomStart(); return; }
  if (act === 'pom-skip')   { pomSkip(); return; }
  if (act === 'pom-reset')  { pomReset(); return; }
  if (act === 'sw-toggle')  { swToggle(); return; }
  if (act === 'sw-lap')     { swLap(); return; }
  if (act === 'sw-reset')   { swReset(); return; }
  if (act === 'tm-toggle')  { tmToggle(); return; }
  if (act === 'tm-clear')   { tmClear(); return; }
  if (act === 'tm-set')     { tmSet(t.dataset.m, ''); return; }
  if (act === 'tm-custom')  { tmCustom(); return; }
  if (act === 'deck')       { DB.decide.deck = t.dataset.d; DB.decide.last = ''; save(); render(); return; }
  if (act === 'decide')     { decide(); return; }
  if (act === 'reset')      { resetAll(); return; }
});

/* ── Settings ──────────────────────────────────────────────────────────────── */
function renderSettings() {
  const st = document.querySelector('.ns-tools #tl-status');
  if (!st) return;
  const n = pomToday(), running = [pomRunning() && 'pomodoro', swRunning() && 'stopwatch',
                                   tmRunning() && 'timer'].filter(Boolean);
  st.className = 'settings-status ' + (running.length ? 'ok' : 'idle');
  st.textContent = (running.length ? running.join(' + ') + ' running' : 'nothing running') +
    ' · ' + n + ' focus round' + (n === 1 ? '' : 's') + ' today';
}

function resetAll() {
  Shell.confirm('Reset TOOLS?\nEvery running clock stops and the day’s focus count goes. The lengths and the lists are settings and stay.', () => {
    DB = blank();
    save(); syncTick(); render(); renderSettings();
    toast('tools reset');
  });
}

Config.subscribe(() => { readConfig(); render(); renderSettings(); });

Shell.register('tools', {
  onShow: () => { render(); syncTick(); },
  onDayChange: () => { paintBand(); render(); },
  /* No `home` hook: the tab tapped while you are already on it means "go back
     to the top screen", and TOOLS has one screen. Throwing the strip back to
     the pomodoro would be losing the stopwatch you were watching. */
  search: q => {
    const out = [];
    TOOLS.forEach(t => {
      if (!t.label.includes(q)) return;
      out.push({ title: t.label, sub: 'tools',
                 go: () => { DB.tool = t.key; save();
                             Shell.TABS.includes('tools') ? Shell.go('tools') : Shell.open('tools');
                             render(); } });
    });
    deckNames().forEach(n => {
      if (!n.toLowerCase().includes(q)) return;
      out.push({ title: n, sub: 'tools · decide list',
                 go: () => { DB.tool = 'decide'; DB.decide.deck = n; save();
                             Shell.TABS.includes('tools') ? Shell.go('tools') : Shell.open('tools');
                             render(); } });
    });
    return out;
  },
});

render();

return { render, renderSettings, resetAll,
         /* Re-read what is stored. Only the harness has a reason to ask — the
            app reads once at boot and is the only thing that writes after.
            CREATE's `reload` for CREATE's reason. */
         reload: () => { load(); render(); renderSettings(); },
         state: () => JSON.parse(JSON.stringify(DB)),
         /* read-only, for LOG's note and anything else that wants the day's
            focus time without reaching into the store */
         today: () => ({ rounds: pomToday(), minutes: pomToday() * POM.focus }) };
})();
