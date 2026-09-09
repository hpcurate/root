/* TOOLS: the pomodoro and the Wim Hof round.
   Config holds the lengths; tools_v1 holds state and the daily tallies.
   Use wall-clock timestamps so sleep, throttling and reloads preserve elapsed
   time. The interval checks completion across tabs and paints visible readouts.

   4.8 cut this from four instruments to two. The stopwatch and the countdown
   were a phone's own two clocks with a worse readout, and the decider answered
   a question by not answering it. What is left are the two things the phone
   does *not* have: a focus cycle that remembers the day's rounds, and a
   breathing round that writes itself into the day. */
window.TOOLS = (function () {
'use strict';

const SCOPE = '.ns-tools ';
const $id   = id  => document.querySelector(SCOPE + '#' + id);
const view  = document.getElementById('view-tools');
const toast = msg => Shell.toast(msg);
const esc   = s => String(s == null ? '' : s).replace(/[&<>"']/g, c =>
  ({ '&':'&amp;', '<':'&lt;', '>':'&gt;', '"':'&quot;', "'":'&#39;' }[c]));

const KEY = 'tools_v1';

/* Content */
let POM, WHF;
function readConfig() {
  POM = Object.assign({ focus:25, short:5, long:15, rounds:4, autoStart:false },
                      Config.get('tools.pomodoro') || {});
  ['focus','short','long'].forEach(k => { POM[k] = Math.max(1, Math.min(180, +POM[k] || 1)); });
  POM.rounds = Math.max(1, Math.min(12, +POM.rounds || 4));
  POM.autoStart = !!POM.autoStart;

  WHF = Object.assign({ rounds:3, breaths:30, pace:2.2, recovery:15, chime:true, label:'wim hof' },
                      Config.get('tools.wimhof') || {});
  WHF.rounds   = Math.max(1, Math.min(10, +WHF.rounds || 3));
  WHF.breaths  = Math.max(5, Math.min(80, +WHF.breaths || 30));
  /* Seconds for one in-and-out. Below 1s nobody can follow the ring and above
     6s it is not the method any more. */
  WHF.pace     = Math.max(1, Math.min(6, +WHF.pace || 2.2));
  WHF.recovery = Math.max(5, Math.min(60, +WHF.recovery || 15));
  WHF.chime    = !!WHF.chime;
  WHF.label    = String(WHF.label || 'wim hof').slice(0, 40) || 'wim hof';
}
readConfig();

/* State */
/* `endsAt` is a wall-clock ms stamp and is the only thing that says a phase is
   running. `left` is what is left in ms while it is paused, and the two are
   never both set — a paused thing has no end, and a running thing has nothing
   banked. Every readout asks which of the two is filled. */
const blank = () => ({
  v: 2,
  tool: 'pom',
  pom:   { phase:'focus', round:1, endsAt:0, left:0, days:{} },
  /* The breathing round. `phase` is idle until a session starts; `startedAt`
     is when the current phase began, which is what the hold counts up from.
     `holds` collects this session's retention times, and `days` keeps the
     finished sessions per day the way pom.days keeps rounds. */
  whf:   { phase:'idle', round:1, breath:0, startedAt:0, endsAt:0, holds:[], days:{} },
});

let DB = blank();
function load() {
  let s = null;
  try { s = JSON.parse(localStorage.getItem(KEY) || 'null'); } catch {}
  DB = normalise(s);
}
/* Rebuilt from its known keys, never trusted. The curate cache in CREATE
   earned this rule the hard way (ROOT.md §6): one undefined array out of a
   store nobody validated took out a whole tab.

   A v1 record carries `sw`, `timer` and `decide` for instruments that no
   longer exist. They are dropped rather than migrated: there is nowhere for a
   lap list to go. `pom.days` is the one thing in a v1 record worth keeping,
   and it is kept — the day's focus count is the number LOG's note reads. */
function normalise(s) {
  const d = blank();
  if (!s || typeof s !== 'object') return d;
  const p = s.pom || {}, w = s.whf || {};
  d.tool = ['pom','whf'].includes(s.tool) ? s.tool : 'pom';
  d.pom = {
    phase: ['focus','short','long'].includes(p.phase) ? p.phase : 'focus',
    round: Math.max(1, +p.round || 1),
    endsAt: Math.max(0, +p.endsAt || 0),
    left:   Math.max(0, +p.left || 0),
    days: (p.days && typeof p.days === 'object') ? p.days : {},
  };
  d.whf = {
    phase: ['idle','breathe','hold','recover'].includes(w.phase) ? w.phase : 'idle',
    round:  Math.max(1, +w.round || 1),
    breath: Math.max(0, +w.breath || 0),
    startedAt: Math.max(0, +w.startedAt || 0),
    endsAt:    Math.max(0, +w.endsAt || 0),
    holds: Array.isArray(w.holds) ? w.holds.map(x => Math.max(0, +x || 0)).slice(0, 20) : [],
    days: (w.days && typeof w.days === 'object') ? w.days : {},
  };
  return d;
}
function save() { try { localStorage.setItem(KEY, JSON.stringify(DB)); } catch {} }
load();

/* Time */
const MIN = 60000;
/* mm:ss, and h:mm:ss once there is an hour to say. Rounded *up* so a timer
   started at 25:00 reads 25:00 rather than 24:59 for its first second. */
function clock(ms) {
  const s = Math.max(0, Math.ceil(ms / 1000));
  const h = Math.floor(s / 3600), m = Math.floor((s % 3600) / 60), x = s % 60;
  const mm = String(m).padStart(2, '0'), ss = String(x).padStart(2, '0');
  return h ? `${h}:${mm}:${ss}` : `${mm}:${ss}`;
}
const hhmmNow = () => { const d = new Date();
  return String(d.getHours()).padStart(2, '0') + ':' + String(d.getMinutes()).padStart(2, '0'); };
/* A retention is spoken in minutes and seconds and never in hundredths — it is
   a number you tell someone, not one you race. */
const holdText = ms => {
  const s = Math.max(0, Math.floor(ms / 1000));
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
};

/* The pomodoro */
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

/* The Wim Hof round
   Three phases per round, and only two of them have a length:

     breathe   `breaths` breaths at `pace` seconds each. The ring is the breath,
               not the phase — it fills on the way in and empties on the way
               out, so the thing you follow is the thing you do.
     hold      the retention, after the last exhale. It counts **up** and has no
               end: how long you last is the measurement, and a timer that cut
               it off at a guess would be measuring the guess. Tapping ends it.
     recover   `recovery` seconds after the big inhale, counting down.

   A session ends after the last round's recovery and is written down twice —
   into LOG's day as a block and onto DAY's schedule as a mark. Neither app
   grows a feature for it: both already take exactly this. */
const WPHASE = { breathe:'breathe', hold:'hold', recover:'recover' };
const whfOn      = () => DB.whf.phase !== 'idle';
const whfRunning = () => DB.whf.phase === 'breathe' || DB.whf.phase === 'recover';
const whfTotalBreath = () => WHF.breaths * WHF.pace * 1000;
const whfLeft = () => DB.whf.endsAt ? Math.max(0, DB.whf.endsAt - Date.now()) : 0;
const whfHeld = () => DB.whf.startedAt ? Date.now() - DB.whf.startedAt : 0;
const whfToday = () => (DB.whf.days[Shell.today()] || []).length;

function whfStart() {
  DB.whf.phase = 'breathe';
  DB.whf.round = 1;
  DB.whf.breath = 0;
  DB.whf.holds = [];
  DB.whf.startedAt = Date.now();
  DB.whf.endsAt = Date.now() + whfTotalBreath();
  save(); render(); announce('round 1 · breathe');
}
/* The breathing is over; the retention begins and is not timed by us. */
function whfToHold() {
  DB.whf.phase = 'hold';
  DB.whf.endsAt = 0;
  DB.whf.startedAt = Date.now();
  save(); render(); announce('hold');
}
/* The user says when the hold ends, which is the only honest way to end it. */
function whfEndHold() {
  if (DB.whf.phase !== 'hold') return;
  DB.whf.holds.push(whfHeld());
  DB.whf.phase = 'recover';
  DB.whf.startedAt = Date.now();
  DB.whf.endsAt = Date.now() + WHF.recovery * 1000;
  save(); render(); announce('breathe in · hold it');
}
function whfNextRound() {
  if (DB.whf.round >= WHF.rounds) { whfFinish(); return; }
  DB.whf.round += 1;
  DB.whf.breath = 0;
  DB.whf.phase = 'breathe';
  DB.whf.startedAt = Date.now();
  DB.whf.endsAt = Date.now() + whfTotalBreath();
  save(); render(); announce('round ' + DB.whf.round + ' · breathe');
}

/* Writing the session down
   The block goes to LOG and the mark goes to DAY, both through the calls those
   apps already offer to anything that finishes something (LOG.setBlock,
   CAL.markDone). Neither is required to be present: TOOLS works on its own and
   simply records less if an app is switched off. */
function whfFinish() {
  const w = DB.whf;
  const iso = Shell.today();
  const best = w.holds.length ? Math.max(...w.holds) : 0;
  const session = { at: hhmmNow(), rounds: w.holds.length,
                    holds: w.holds.slice(), best, done: Date.now() };
  const list = (w.days[iso] || []).concat([session]);
  w.days[iso] = list.slice(-12);
  const floor = Object.keys(w.days).sort().slice(-90);
  w.days = floor.reduce((o, d) => { o[d] = w.days[d]; return o; }, {});

  w.phase = 'idle'; w.round = 1; w.breath = 0; w.startedAt = 0; w.endsAt = 0; w.holds = [];
  save();

  try { if (window.LOG && LOG.setBlock) LOG.setBlock(WHF.label, true); } catch {}
  try { if (window.CAL && CAL.markDone) CAL.markDone(WHF.label, true); } catch {}

  render(); renderSettings();
  toast(session.rounds
    ? `${session.rounds} round${session.rounds === 1 ? '' : 's'} · best ${holdText(best)} · written to log`
    : 'session done');
}
function whfStop() {
  Shell.confirm('Stop the session?\nNothing is written down — a session counts when it finishes.', () => {
    DB.whf = Object.assign(DB.whf, { phase:'idle', round:1, breath:0, startedAt:0, endsAt:0, holds:[] });
    save(); render();
  });
}
/* Calling out the phase
   The cue is a **toast**, not a tone this module plays. ROOT has exactly one
   place that makes noise and it is shell.js (§3) — an app that reaches for the
   sound engine itself is the thing that rule exists to stop, and a harness
   check fails on it. Shell.toast already sounds, so a toast is the cue *and*
   the instruction, which is the better half of the trade: a breathing round is
   done with your eyes shut, and "breathe in" tells you more than a note does. */
function announce(msg) { if (WHF.chime && msg) toast(msg); }

/* Which breath the round is on, derived from the clock rather than counted, so
   a backgrounded tab comes back to the right number. */
function whfBreathNow() {
  if (DB.whf.phase !== 'breathe') return 0;
  const gone = whfTotalBreath() - whfLeft();
  return Math.min(WHF.breaths, Math.floor(gone / (WHF.pace * 1000)) + 1);
}
/* 0 → 1 → 0 across one breath: in on the first half, out on the second. */
function whfBreathFrac() {
  if (DB.whf.phase !== 'breathe') return 0;
  const per = WHF.pace * 1000;
  const gone = (whfTotalBreath() - whfLeft()) % per;
  const half = per / 2;
  return gone < half ? gone / half : 1 - (gone - half) / half;
}

/* The tick
   One interval for the whole app, running whatever tab is on screen, and doing
   nothing at all when nothing is running. It has two jobs and they are not the
   same job: **finishing** a phase, which must happen wherever you are, and
   **painting** the readout, which only matters if the readout is on screen.

   200ms rather than 1000: the breathing ring is an animation and a second-long
   tick under it would step rather than breathe. */
let timer = null;
function needsTick() { return pomRunning() || whfOn(); }
function syncTick() {
  if (needsTick() && !timer) timer = setInterval(tick, 200);
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
  if (DB.whf.phase === 'breathe' && whfLeft() <= 0) { whfToHold(); return; }
  if (DB.whf.phase === 'recover' && whfLeft() <= 0) { whfNextRound(); return; }
  /* A phase ending changes more than the digits — the ring's colour, the
     button's word, the round — so that is a full draw. Every other tick moves
     the things that actually moved, because rebuilding the body five times a
     second would take the focus out of anything under a finger. */
  if (fired) { render(); return; }
  if (isOn()) paint();
  syncTick();
}
/* The shell marks the live slide `.cur`, not `.on` — `.on` is a *screen*
   inside a slide, and TOOLS has one of those. */
const isOn = () => !!view && view.classList.contains('cur');

/* Screens */
const TOOLS = [
  { key:'pom', label:'pomodoro' },
  { key:'whf', label:'wim hof' },
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
   instrument, because "3" means nothing without it. */
function paintBand() {
  const box = $id('tl-daynum'), lab = $id('tl-label');
  const t = tool();
  const n = t === 'pom' ? pomToday() : whfToday();
  const word = t === 'pom' ? 'focus rounds today'
                           : whfToday() === 1 ? 'session today' : 'sessions today';
  if (lab) lab.textContent = word;
  if (box && window.Shell && Shell.rollNum) Shell.rollNum(box, String(n), n);
}

/* The big readout
   One shape for both instruments: a ring that empties, the time inside it, and
   a word under it. It is an SVG circle with a dash offset rather than a
   conic-gradient, so it animates on the property browsers can animate cheaply
   and it is the same drawing at any size. */
const R = 78, CIRC = 2 * Math.PI * R;
const layout = () => (window.Prefs && Prefs.get('toolsLayout')) || 'ring';

/* The readout, four ways.
   Every layout is handed the same 0-to-1 fraction and the same two strings, and
   every one of them carries `#tl-big`, `#tl-sub` and a `--tl-frac` on its outer
   box — so paint() moves one number and one word and does not care which
   drawing is on screen. That is the whole reason these are four *layouts* and
   not four forks of the instrument.

     ring    the original: an SVG circle emptying anticlockwise.
     bar     a departure board — the time set in big tabular figures, a hairline
             rule under it filling left to right, nothing enclosing anything.
     stack   a column of blocks that fill from the bottom, so the readout has a
             quantity you can see across the room rather than a number to read.
     plain   no container at all: the time, very large, and a word under it.

   `--tl-breath` is separate from `--tl-frac` because the breathing disc swells
   and settles on its own curve — see the note in tools.css. */
function readoutHTML(frac, cls, big, sub, pips, breath) {
  const f = Math.max(0, Math.min(1, frac));
  const lay = layout();
  const vars = `--tl-frac:${f.toFixed(4)}` + (breath == null ? '' : `;--tl-breath:${breath.toFixed(3)}`);
  const inner = `<div class="tl-read">
      <div class="tl-big" id="tl-big">${esc(big)}</div>
      <div class="tl-sub" id="tl-sub">${esc(sub)}</div>
    </div>`;

  if (lay === 'ring') {
    const off = CIRC * (1 - f);
    return `<div class="tl-ring ${cls}" style="${vars}">
      <svg viewBox="0 0 180 180" aria-hidden="true">
        <circle class="tr" cx="90" cy="90" r="${R}"></circle>
        <circle class="tp" cx="90" cy="90" r="${R}"
                stroke-dasharray="${CIRC.toFixed(1)}" stroke-dashoffset="${off.toFixed(1)}"></circle>
      </svg>
      ${inner}
    </div>${pips || ''}`;
  }

  if (lay === 'bar') {
    return `<div class="tl-bar ${cls}" style="${vars}">
      ${inner}
      <div class="tl-rule"><i></i></div>
    </div>${pips || ''}`;
  }

  if (lay === 'stack') {
    /* Twelve blocks is enough to read a fraction at a glance and few enough
       that each one is still a block rather than a stripe. */
    let cells = '';
    for (let i = 0; i < 12; i++) cells += `<i style="--n:${i}"></i>`;
    return `<div class="tl-stack ${cls}" style="${vars}">
      <div class="tl-cells">${cells}</div>
      ${inner}
    </div>${pips || ''}`;
  }

  return `<div class="tl-plain ${cls}" style="${vars}">
    ${inner}
    <div class="tl-underline"><i></i></div>
  </div>${pips || ''}`;
}
/* Kept under its old name so the four call sites read the same as they did. */
const ringHTML = readoutHTML;

/* Rounds as dots rather than "round 2 of 4". A count you read is a count you
   have to do; a row of dots is one you see. */
function pipsHTML(done, total, cls) {
  let out = '';
  for (let i = 0; i < total; i++) out += `<i class="${i < done ? 'on' : ''}"></i>`;
  return `<div class="tl-pips ${cls || ''}">${out}</div>`;
}

function pomHTML() {
  const total = pomTotal(), left = pomLeft() || total;
  const ph = pomPhase();
  const done = pomToday();
  const running = pomRunning();
  return ringHTML(left / total, ph.cls + (running ? ' live' : ''), clock(left), ph.label,
                  pipsHTML(DB.pom.round - 1, POM.rounds, 'focus')) + `
    <div class="tl-main">
      <button class="tl-big-btn${running ? ' on' : ''}" data-act="pom-toggle"
              aria-label="${running ? 'pause' : 'start'}">
        <svg viewBox="0 0 24 24" aria-hidden="true">${running
          ? '<rect x="7" y="5" width="3.5" height="14" rx="1"/><rect x="13.5" y="5" width="3.5" height="14" rx="1"/>'
          : '<path d="M8 5.5v13l11-6.5z"/>'}</svg>
      </button>
    </div>
    <div class="tl-side">
      <button class="tl-icon" data-act="pom-skip" aria-label="skip this phase">
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M5 5l9 7-9 7z"/><line x1="18" y1="5" x2="18" y2="19"/></svg>
        <span>skip</span>
      </button>
      <button class="tl-icon" data-act="pom-reset" aria-label="reset this phase">
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M3 12a9 9 0 1 0 2.6-6.4"/><polyline points="3 4 3 10 9 10"/></svg>
        <span>reset</span>
      </button>
    </div>
    <div class="tl-tally">${done
      ? `<b>${done}</b> focus round${done === 1 ? '' : 's'} today`
      : 'nothing finished yet today'}</div>`;
}

function whfHTML() {
  const w = DB.whf;
  const sessions = DB.whf.days[Shell.today()] || [];

  if (!whfOn()) {
    const best = sessions.reduce((m, s) => Math.max(m, +s.best || 0), 0);
    return ringHTML(0, 'whf ready', String(WHF.rounds), 'rounds ready',
                    pipsHTML(0, WHF.rounds, 'whf')) + `
      <div class="tl-main">
        <button class="tl-big-btn go" data-act="whf-start" aria-label="start the session">
          <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M8 5.5v13l11-6.5z"/></svg>
        </button>
      </div>
      <div class="tl-tally">${esc(WHF.breaths)} breaths · ${esc(WHF.pace)}s each · ${esc(WHF.recovery)}s recovery</div>
      ${sessionsHTML(sessions, best)}`;
  }

  const ph = w.phase;
  if (ph === 'breathe') {
    const n = whfBreathNow();
    const frac = whfBreathFrac();
    const inBreath = frac > 0.02 && (whfTotalBreath() - whfLeft()) % (WHF.pace * 1000) < (WHF.pace * 1000) / 2;
    return ringHTML(frac, 'whf breathe live', String(n), inBreath ? 'breathe in' : 'let go',
                    pipsHTML(w.round - 1, WHF.rounds, 'whf'), frac) + `
      <div class="tl-main">
        <button class="tl-big-btn wide" data-act="whf-hold" aria-label="go to the hold">
          <span>hold now</span>
        </button>
      </div>
      <div class="tl-tally"><b>${esc(n)}</b> of ${esc(WHF.breaths)} · round ${esc(w.round)} of ${esc(WHF.rounds)}</div>
      <div class="tl-side one"><button class="tl-icon" data-act="whf-stop"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><line x1="6" y1="6" x2="18" y2="18"/><line x1="18" y1="6" x2="6" y2="18"/></svg><span>stop</span></button></div>`;
  }

  if (ph === 'hold') {
    const best = w.holds.length ? Math.max(...w.holds) : 0;
    return ringHTML(1, 'whf hold live', holdText(whfHeld()), 'hold',
                    pipsHTML(w.round - 1, WHF.rounds, 'whf')) + `
      <div class="tl-main">
        <button class="tl-big-btn wide go" data-act="whf-breathe" aria-label="end the hold and breathe in">
          <span>breathe in</span>
        </button>
      </div>
      <div class="tl-tally">round ${esc(w.round)} of ${esc(WHF.rounds)}${
        best ? ` · best so far ${esc(holdText(best))}` : ''}</div>
      <div class="tl-side one"><button class="tl-icon" data-act="whf-stop"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><line x1="6" y1="6" x2="18" y2="18"/><line x1="18" y1="6" x2="6" y2="18"/></svg><span>stop</span></button></div>`;
  }

  const left = whfLeft(), tot = WHF.recovery * 1000;
  const last = w.holds[w.holds.length - 1] || 0;
  return ringHTML(left / tot, 'whf recover live', clock(left), 'hold it in',
                  pipsHTML(w.round, WHF.rounds, 'whf')) + `
    <div class="tl-main">
      <button class="tl-big-btn wide" data-act="whf-next" aria-label="skip to the next round">
        <span>${w.round >= WHF.rounds ? 'finish' : 'next round'}</span>
      </button>
    </div>
    <div class="tl-tally">held <b>${esc(holdText(last))}</b> · round ${esc(w.round)} of ${esc(WHF.rounds)}</div>`;
}

/* Today's sessions, and the best hold in them. A session is three numbers and
   a time, so it is a row rather than a card. */
function sessionsHTML(sessions, best) {
  if (!sessions.length) return '';
  return `<div class="tl-sec"><span>Today</span><em>best ${esc(holdText(best))}</em></div>
    ${sessions.slice().reverse().map(s => `<div class="tl-sess">
      <span class="ss-at">${esc(s.at)}</span>
      <span class="ss-holds">${(s.holds || []).map(h =>
        `<b${(+h === +s.best) ? ' class="best"' : ''}>${esc(holdText(h))}</b>`).join('')}</span>
      <span class="ss-n">${esc(s.rounds)}×</span>
    </div>`).join('')}`;
}

/* Only the readout is repainted on a tick — rebuilding the whole body five
   times a second would take the focus out of anything under a finger. The
   shape is written once by render(); paint() moves what actually changes. */
function paint() {
  const t = tool();
  const big = $id('tl-big'), sub = $id('tl-sub');
  const ring = view && view.querySelector('.tl-ring .tp');
  let text = '', frac = 0, word = null;
  if (t === 'pom') {
    const total = pomTotal(), l = pomLeft() || total;
    text = clock(l); frac = l / total;
  } else if (DB.whf.phase === 'breathe') {
    const per = WHF.pace * 1000;
    const gone = (whfTotalBreath() - whfLeft()) % per;
    text = String(whfBreathNow());
    frac = whfBreathFrac();
    word = gone < per / 2 ? 'breathe in' : 'let go';
  } else if (DB.whf.phase === 'hold') {
    text = holdText(whfHeld()); frac = 1;
  } else if (DB.whf.phase === 'recover') {
    const l = whfLeft(); text = clock(l); frac = l / (WHF.recovery * 1000);
  } else return;
  const f = Math.max(0, Math.min(1, frac));
  if (big) big.textContent = text;
  if (word && sub && sub.textContent !== word) sub.textContent = word;
  if (ring) ring.setAttribute('stroke-dashoffset', (CIRC * (1 - f)).toFixed(1));
  /* Every layout reads the fraction off its own box, so this one write drives
     the bar's fill, the stack's blocks and the underline as well as the ring. */
  const box = view && view.querySelector('.tl-ring,.tl-bar,.tl-stack,.tl-plain');
  if (box) {
    box.style.setProperty('--tl-frac', f.toFixed(4));
    if (DB.whf.phase === 'breathe') box.style.setProperty('--tl-breath', f.toFixed(3));
  }
}

function render() {
  renderTabs();
  paintBand();
  const box = $id('tl-body');
  if (box) {
    const t = tool();
    box.className = 'tl-body t-' + t;
    box.innerHTML = t === 'pom' ? pomHTML() : whfHTML();
  }
  syncTick();
}

/* The delegated listener */
document.addEventListener('click', ev => {
  if (!ev.target.closest || !ev.target.closest('.ns-tools')) return;
  const t = ev.target.closest('[data-act]');
  const act = t && t.dataset.act;
  if (!act || t.disabled) return;

  if (act === 'tool')        { DB.tool = t.dataset.t; save(); render(); return; }
  if (act === 'pom-toggle')  { pomRunning() ? pomPause() : pomStart(); return; }
  if (act === 'pom-skip')    { pomSkip(); return; }
  if (act === 'pom-reset')   { pomReset(); return; }
  if (act === 'whf-start')   { whfStart(); return; }
  if (act === 'whf-hold')    { whfToHold(); return; }
  if (act === 'whf-breathe') { whfEndHold(); return; }
  if (act === 'whf-next')    { whfNextRound(); return; }
  if (act === 'whf-stop')    { whfStop(); return; }
  if (act === 'reset')       { resetAll(); return; }
});

/* Settings */
function renderSettings() {
  const st = document.querySelector('.ns-tools #tl-status');
  if (!st) return;
  const n = pomToday(), s = whfToday();
  const running = [pomRunning() && 'pomodoro', whfOn() && 'wim hof'].filter(Boolean);
  st.className = 'settings-status ' + (running.length ? 'ok' : 'idle');
  st.textContent = (running.length ? running.join(' + ') + ' running' : 'nothing running') +
    ` · ${n} focus round${n === 1 ? '' : 's'} · ${s} session${s === 1 ? '' : 's'} today`;
}

function resetAll() {
  Shell.confirm('Reset TOOLS?\nEvery running clock stops and the day’s focus count and sessions go. The lengths are settings and stay.', () => {
    DB = blank();
    save(); syncTick(); render(); renderSettings();
    toast('tools reset');
  });
}

Config.subscribe(() => { readConfig(); render(); renderSettings(); });
/* 4.9 gave TOOLS its first *Prefs* dial (the readout layout) and this was the
   line it needed to go with it: every other app has subscribed to Prefs for
   versions, TOOLS had nothing to subscribe for. Without it the dial was set,
   the chip lit, and the screen carried on drawing the old layout — which is
   what "the new layouts are not selectable" actually was. */
Prefs.subscribe(k => { if (k === '*' || k === 'toolsLayout') render(); });

Shell.register('tools', {
  onShow: () => { render(); syncTick(); },
  onDayChange: () => { paintBand(); render(); },
  /* No `home` hook: the tab tapped while you are already on it means "go back
     to the top screen", and TOOLS has one screen. Throwing the strip back to
     the pomodoro would be losing the round you were in. */
  search: q => TOOLS.filter(t => t.label.includes(q)).map(t => ({
    title: t.label, sub: 'tools',
    go: () => { DB.tool = t.key; save();
                Shell.TABS.includes('tools') ? Shell.go('tools') : Shell.open('tools');
                render(); } })),
});

render();

return { render, renderSettings, resetAll,
         /* Re-read what is stored. Only the harness has a reason to ask — the
            app reads once at boot and is the only thing that writes after.
            CREATE's `reload` for CREATE's reason. */
         reload: () => { load(); render(); renderSettings(); },
         state: () => JSON.parse(JSON.stringify(DB)),
         /* read-only, for LOG's note and anything else that wants the day's
            focus time and breathing without reaching into the store */
         today: () => {
           const s = DB.whf.days[Shell.today()] || [];
           return { rounds: pomToday(), minutes: pomToday() * POM.focus,
                    sessions: s.length,
                    best: s.reduce((m, x) => Math.max(m, +x.best || 0), 0) };
         } };
})();
