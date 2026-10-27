/* qurOS — the recorder.
   One full-screen overlay for every capture: talk (speech-to-text) or write
   (the keyboard, including its own mic). While it is open the screen is kept
   on. A voice dump can be LOCKED: every touch is swallowed except a slide
   along the bottom track, the back gesture is refused, and after a while the
   screen dims to near-black (and drifts a few pixels, against burn-in) — so
   the phone can ride in a hand or a pocket on a walk while it listens.

   The words are the draft's `text`. Speech appends finished phrases to it;
   when the recognizer re-sends a longer version of its last phrase (Android),
   the tail is replaced in place. The draft is written to localStorage on
   every phrase, so a dead battery or a killed tab loses nothing (db.js). */
(() => {
const Q = window.Q, { $, esc, icon, words, dur, fmtNum, vibrate, clamp, uid, dayOf } = Q.u;
const S = () => Q.settings.get();

const R = {
  open: false, locked: false, voice: false, st: 'idle', d: null,
  last: null, lastFinalAt: 0, interim: '', acc: 0, runAt: 0,
  timers: {}, dimmed: false, fs: false, usedVoice: false, usedType: false,
};
let el = null, q = null;   // the overlay and its parts

const SHAPE = { listening: 'circle', starting: 'circle', restarting: 'circle', idle: 'square', paused: 'square',
  retry: 'tri', offline: 'tri', nomic: 'tri', denied: 'tri', unsupported: 'tri', lang: 'tri' };
const STATUS = { listening: 'listening', starting: 'listening', restarting: 'listening', retry: 'reconnecting…',
  offline: 'no connection · still trying', nomic: 'no mic input · retrying', denied: 'microphone blocked',
  unsupported: 'no speech-to-text in this browser', lang: 'language not available', idle: 'paused', paused: 'paused' };
const MSG = {
  denied: 'The microphone is blocked for this site. Allow it in the browser\'s site settings — or type, the keyboard\'s own mic works here too.',
  unsupported: 'This browser has no speech-to-text. Type instead — your keyboard\'s mic button works here, and the screen still stays on.',
  lang: 'Speech-to-text does not have this language here. Pick another one, or type.',
  offline: 'Speech-to-text needs a connection on most phones. Everything so far is saved; it picks up again on its own.',
};

function build() {
  el = $('#rec');
  el.innerHTML = `
  <div class="rec-shift">
    <div class="rec-top">
      <span class="rec-wake" data-w="off">${icon('sun')}<i>screen</i></span>
      <span class="rec-st"><b></b><i>paused</i></span>
      <button class="rec-lang" type="button" aria-label="speech language">EN</button>
    </div>
    <button class="rec-topic" type="button"></button>
    <div class="rec-prompt"></div>
    <div class="rec-orb-wrap">
      <span class="rec-ring"></span>
      <button class="rec-orb" type="button" aria-label="talk or pause">
        <b class="rec-time">00:00</b><span class="rec-words">0 words</span>
      </button>
    </div>
    <p class="rec-msg"></p>
    <div class="rec-live" aria-live="polite"><p><span class="rec-final"></span><span class="rec-interim"></span></p></div>
    <textarea class="rec-text" placeholder="type, or use your keyboard's mic…" spellcheck="true"></textarea>
  </div>
  <div class="rec-ctl">
    <button type="button" data-r="discard">${icon('x')}<span>discard</span></button>
    <button type="button" data-r="mic">${icon('pause')}<span>pause</span></button>
    <button type="button" data-r="lock">${icon('lock')}<span>lock</span></button>
    <button type="button" data-r="done" class="go">${icon('check')}<span>done</span></button>
  </div>
  <div class="rec-slide">
    <div class="rec-track"><span class="rec-hint">slide to unlock</span>
      <span class="rec-knob" role="slider" aria-label="slide to unlock" aria-valuemin="0" aria-valuemax="100" aria-valuenow="0">${icon('lock')}</span>
    </div>
  </div>`;
  q = {
    shift: el.querySelector('.rec-shift'), wake: el.querySelector('.rec-wake'), st: el.querySelector('.rec-st i'),
    lang: el.querySelector('.rec-lang'), topic: el.querySelector('.rec-topic'), prompt: el.querySelector('.rec-prompt'),
    orb: el.querySelector('.rec-orb'), ring: el.querySelector('.rec-ring'), time: el.querySelector('.rec-time'),
    words: el.querySelector('.rec-words'), msg: el.querySelector('.rec-msg'), live: el.querySelector('.rec-live'),
    fin: el.querySelector('.rec-final'), int: el.querySelector('.rec-interim'), ta: el.querySelector('.rec-text'),
    ctl: el.querySelector('.rec-ctl'), mic: el.querySelector('[data-r="mic"]'), track: el.querySelector('.rec-track'),
    knob: el.querySelector('.rec-knob'), hint: el.querySelector('.rec-hint'),
  };
  q.ctl.addEventListener('click', e => {
    const b = e.target.closest('[data-r]');
    if (!b || R.locked) return;
    ({ discard, mic: toggleVoice, lock, done })[b.dataset.r]();
  });
  q.orb.addEventListener('click', () => { if (!R.locked) toggleVoice(); });
  q.lang.addEventListener('click', () => { if (!R.locked) cycleLang(); });
  q.topic.addEventListener('click', () => {
    if (R.locked || !Q.dump) return;
    Q.dump.pickTopic(R.d.topic, R.d.kind, (t, kind) => { R.d.topic = t; R.d.kind = kind; saveDraft(); paint(); });
  });
  q.ta.addEventListener('input', () => {
    R.d.text = q.ta.value; R.last = null; R.usedType = true;
    paintCounts(); saveDraft(); poke();
  });
  Q.wake.on(paintWake);
  wireLock();
}

/* ── lock: swallow everything but the slider ── */
function wireLock() {
  const block = e => {
    if (!R.open) return;
    poke();
    if (!R.locked) return;
    if (e.type === 'contextmenu') { e.preventDefault(); return; }
    if (q.knob.contains(e.target)) return;
    if (e.cancelable) e.preventDefault();
    e.stopPropagation();
    if (e.type === 'pointerdown' || e.type === 'touchstart') nudgeHint();
  };
  ['touchstart', 'touchmove', 'touchend', 'pointerdown', 'pointerup', 'click', 'dblclick', 'contextmenu', 'wheel']
    .forEach(t => el.addEventListener(t, block, { capture: true, passive: false }));
  /* a key on a desktop keyboard is a deliberate act, but not a gesture for the
     lock — only the slider unlocks */
  document.addEventListener('keydown', e => { if (R.open && R.locked) { e.preventDefault(); e.stopPropagation(); poke(); } }, true);

  let drag = null;
  const max = () => Math.max(1, q.track.clientWidth - q.knob.offsetWidth - 8);
  const setX = x => {
    q.knob.style.transform = `translateX(${x}px)`;
    const p = clamp(x / max(), 0, 1);
    q.track.style.setProperty('--p', p.toFixed(3));
    q.knob.setAttribute('aria-valuenow', Math.round(p * 100));
  };
  q.knob.addEventListener('pointerdown', e => {
    if (!R.locked) return;
    e.preventDefault();
    drag = { x0: e.clientX, id: e.pointerId, x: 0 };
    try { q.knob.setPointerCapture(e.pointerId); } catch {}
    q.knob.classList.add('drag');
    undim();
  });
  q.knob.addEventListener('pointermove', e => {
    if (!drag || e.pointerId !== drag.id) return;
    drag.x = clamp(e.clientX - drag.x0, 0, max());
    setX(drag.x);
  });
  const end = e => {
    if (!drag || (e && e.pointerId !== drag.id)) return;
    const ok = drag.x >= max() * 0.88;
    drag = null;
    q.knob.classList.remove('drag');
    if (ok) unlock();
    setX(0);
  };
  q.knob.addEventListener('pointerup', end);
  q.knob.addEventListener('pointercancel', end);
  R.slide = { setX, max };
}
function nudgeHint() {
  q.hint.classList.remove('nudge');
  void q.hint.offsetWidth;
  q.hint.classList.add('nudge');
}

function lock() {
  if (!R.open || R.locked) return;
  if (!R.voice && !startVoice()) return;
  R.locked = true;
  if (document.activeElement && document.activeElement.blur) document.activeElement.blur();
  el.dataset.lock = '1';
  document.documentElement.classList.add('rec-locked');
  vibrate(25);
  clearTimeout(R.timers.relock);
  undim();
  clearInterval(R.timers.shift);
  R.timers.shift = setInterval(() => {
    const r = () => Math.round(Math.random() * 12 - 6);
    q.shift.style.translate = `${r()}px ${r()}px`;
  }, 30000);
  paint();
}
function unlock() {
  if (!R.locked) return;
  R.locked = false;
  el.dataset.lock = '0';
  document.documentElement.classList.remove('rec-locked');
  clearInterval(R.timers.shift);
  clearTimeout(R.timers.dim);
  q.shift.style.translate = '';
  R.dimmed = false; el.classList.remove('dim');
  vibrate([15, 40, 15]);
  poke();
  paint();
}
/* any touch: wake from dim (locked) or restart the re-lock countdown (unlocked) */
function poke() {
  if (!R.open) return;
  if (R.locked) { undim(); return; }
  clearTimeout(R.timers.relock);
  const after = +S().relockAfter;
  /* not while a sheet (the topic picker, a question) sits on top of the recorder */
  if (R.voice && after > 0) R.timers.relock = setTimeout(() => { if (R.voice && !R.locked && Q.ui.layers().slice(-1)[0] === 'rec') lock(); }, after * 1000);
}
function undim() {
  if (R.dimmed) { R.dimmed = false; el.classList.remove('dim'); }
  clearTimeout(R.timers.dim);
  const after = +S().dimAfter;
  if (R.locked && after > 0) R.timers.dim = setTimeout(() => { R.dimmed = true; el.classList.add('dim'); }, after * 1000);
}

/* ── voice ── */
function startVoice() {
  if (!Q.speech.supported()) { R.st = 'unsupported'; paint(); return false; }
  R.voice = true; R.usedVoice = true;
  R.runAt = Date.now();
  R.lastFinalAt = 0;   // the first phrase after a pause never opens with a paragraph gap it did not hear
  Q.speech.start({ onPhrase, onInterim, onState, onMic, onActivity: pulse }, R.d.lang || S().lang);
  poke();
  paint();
  return true;
}
async function stopVoice() {
  if (!R.voice) return;
  R.acc += (Date.now() - R.runAt) / 1000;
  R.voice = false;
  clearTimeout(R.timers.relock);
  await Q.speech.stop();
  R.interim = '';
  saveDraft();
  paint();
}
function toggleVoice() { if (R.voice) stopVoice(); else { startVoice(); } }
const secs = () => R.acc + (R.voice ? (Date.now() - R.runAt) / 1000 : 0);

const CMDS = [
  [/\s*\b(?:new paragraph|nouveau paragraphe)\b[.,]?\s*/gi, '\n\n'],
  [/\s*\b(?:new line|à la ligne|a la ligne)\b[.,]?\s*/gi, '\n'],
];
function commands(t) {
  if (!S().commands) return t;
  CMDS.forEach(([re, to]) => { t = t.replace(re, to); });
  return t;
}
const cap = t => t.replace(/^(\s*)(\p{Ll})/u, (m, s, c) => s + c.toUpperCase());
/* a voice command mid-phrase starts a new line: capitalise after it too */
const capLines = t => t.replace(/(\n\s*)(\p{Ll})/gu, (m, s, c) => s + c.toUpperCase());
/* Add one finished phrase; `replace` swaps it in for the previous one. */
function addPhrase(raw, replace) {
  const d = R.d;
  const t = capLines(commands(raw.trim()));
  if (replace && R.last && d.text.length >= R.last.pos) {
    d.text = d.text.slice(0, R.last.pos) + (R.last.cap ? cap(t) : t);
  } else {
    const now = Date.now();
    let sep = '';
    if (d.text && !/\n\s*$/.test(d.text) && !/^\n/.test(t)) {
      sep = R.lastFinalAt && now - R.lastFinalAt > S().paraGap * 1000 ? '\n\n' : (/\s$/.test(d.text) ? '' : ' ');
    }
    const head = !d.text.trim() || sep === '\n\n' || /[.!?…]\s*$/.test(d.text) || /\n\s*$/.test(d.text);
    const pos = d.text.length + sep.length;
    d.text += sep + (head ? cap(t) : t);
    R.last = { pos, cap: head };
  }
  R.lastFinalAt = Date.now();
}
function onPhrase(t, replace) {
  if (!R.open || !R.d) return;
  addPhrase(t, replace);
  R.interim = '';
  saveDraft();
  paintText();
  paintCounts();
}
/* the mic chosen in settings couldn't be used: the phone's mic listens instead, and says so (2.0.1) */
function onMic(why, name) {
  const n = name || 'the chosen mic';
  Q.ui.toast(why === 'missing' ? n + " isn't connected · the phone's mic" : why === 'lost' ? "no sound through " + n + " · the phone's mic" : n + " didn't open · the phone's mic");
}
function onInterim(t) { R.interim = t; if (R.open) q.int.textContent = t ? ' ' + t : ''; }
function onState(s) {
  if (!R.open) return;
  const was = R.st;
  R.st = s;
  if (['denied', 'unsupported', 'lang'].includes(s)) {
    if (R.voice) { R.acc += (Date.now() - R.runAt) / 1000; R.voice = false; }
    if (R.locked) { vibrate([200, 100, 200]); unlock(); }
  }
  if (s === 'offline' && was !== 'offline' && R.locked) vibrate([60, 60, 60]);
  paint();
}
function pulse() {
  if (!q) return;
  q.ring.classList.remove('go');
  void q.ring.offsetWidth;
  q.ring.classList.add('go');
}

function cycleLang() {
  const list = S().langs.filter(Boolean);
  if (!list.length) return;
  const curL = R.d.lang || S().lang || list[0];
  const next = list[(list.indexOf(curL) + 1) % list.length];
  R.d.lang = next;
  if (R.voice) Q.speech.setLang(next);
  saveDraft(); paint();
  Q.ui.toast('speech language · ' + next);
}

/* ── paint ── */
function paintWake(s) {
  if (!q) return;
  q.wake.dataset.w = s;
  q.wake.querySelector('i').textContent = s === 'on' ? 'screen stays on' : s === 'off' ? 'screen' :
    s === 'lost' ? 'screen lock lost' : 'screen may sleep';
}
function paintText() {
  const t = R.d.text;
  if (R.voice || R.locked) {
    q.fin.textContent = R.locked ? t.slice(-420) : t;
    q.int.textContent = R.interim ? ' ' + R.interim : '';
    if (!R.locked) q.live.scrollTop = q.live.scrollHeight;
  } else if (q.ta.value !== t) {
    q.ta.value = t;
  }
}
function paintCounts() {
  const n = words(R.d.text);
  q.words.textContent = `${fmtNum(n)} word${n === 1 ? '' : 's'}`;
  q.time.textContent = dur(secs());
}
function paint() {
  if (!R.open) return;
  const st = R.voice ? (R.st === 'idle' ? 'starting' : R.st) : (['denied', 'unsupported', 'lang'].includes(R.st) ? R.st : 'paused');
  el.dataset.voice = R.voice ? 'on' : 'off';
  el.dataset.st = st;
  el.dataset.shape = SHAPE[st] || 'square';
  el.dataset.live = S().liveText ? '1' : '0';
  q.st.textContent = STATUS[st] || st;
  q.msg.textContent = MSG[st] || '';
  q.topic.innerHTML = `<span>${esc(Q.m.topicLabel(R.d.topic, R.d.kind))}</span>` + (R.locked ? '' : icon('chev'));
  const pr = Q.m.topicPrompt(R.d.topic, R.d.kind);
  q.prompt.innerHTML = pr.length ? pr.map(x => `<span>${esc(x)}</span>`).join('') : '';
  const lang = R.d.lang || S().lang || navigator.language || 'en';
  q.lang.textContent = lang.slice(0, 2).toUpperCase();
  q.lang.hidden = !Q.speech.supported();
  const micB = q.mic;
  micB.innerHTML = R.voice ? `${icon('pause')}<span>pause</span>` : `${icon('mic')}<span>${R.usedVoice ? 'resume' : 'talk'}</span>`;
  micB.hidden = !Q.speech.supported();
  el.querySelector('[data-r="lock"]').hidden = !Q.speech.supported();
  el.querySelector('[data-r="discard"] span').textContent = R.d.base ? 'undo new' : 'discard';
  paintText();
  paintCounts();
}

/* ── open / close ── */
function openRec({ voice, topic = null, kind = 'dump', entry = null, draft = null, onSaved = null, focus = true }) {
  if (R.open) return;
  if (!el) build();
  /* words left behind by a dead tab are saved before a new draft can replace them */
  const orphan = Q.db.draft.get();
  if (orphan && !(draft && draft.id === orphan.id) && Q.dump) Q.dump.rescue(orphan);
  R.onSaved = onSaved;
  Q.ui.hideToast();
  const base = entry ? JSON.parse(JSON.stringify(entry)) : null;
  R.d = draft ? Object.assign({}, draft) : {
    id: entry ? entry.id : uid('e'),
    kind: entry ? entry.kind : kind,
    topic: entry ? entry.topic : topic,
    text: entry ? entry.text : '',
    at: entry ? entry.at : Date.now(),
    lang: entry ? entry.lang || '' : '',
    base,
  };
  R.acc = draft ? draft.secs || 0 : 0;
  R.open = true; R.locked = false; R.voice = false; R.st = 'idle'; R.last = null; R.interim = '';
  R.usedVoice = !!(draft && draft.usedVoice); R.usedType = !!(draft && draft.usedType);
  R.lastFinalAt = 0;
  el.hidden = false;
  el.setAttribute('aria-hidden', 'false');
  el.dataset.lock = '0';
  el.classList.remove('dim');
  document.documentElement.classList.add('rec-open');
  q.ta.value = R.d.text;
  Q.ui.pushLayer('rec', () => teardown(), guard);
  Q.wake.hold('rec');
  paintWake(Q.wake.state());
  enterFullscreen();
  R.timers.tick = setInterval(() => {
    if (!R.open) return;
    paintCounts();
    if (R.voice && Math.round(secs()) % 5 === 0) saveDraft();
  }, 1000);
  requestAnimationFrame(() => el.classList.add('on'));
  if (voice && startVoice()) {
    if (S().lockOnStart) lock();
  } else {
    paint();
    if (focus || !Q.speech.supported()) setTimeout(() => { if (R.open && !R.voice) q.ta.focus(); }, 60);
  }
  saveDraft();
}
/* back gesture: refused while locked; otherwise ask before leaving words behind */
function guard() {
  if (R.locked) { nudgeHint(); vibrate(20); return true; }
  if (R.d && R.d.text.trim() && (!R.d.base || R.d.text !== R.d.base.text)) {
    Q.ui.choose('Save this?', [
      { label: 'save', go: true, run: done },
      { label: 'keep going', run: () => {} },
      { label: R.d.base ? 'undo the new words' : 'discard it', run: () => finish(false) },
    ]);
    return true;
  }
  return false;
}
function teardown() {
  R.open = false;
  /* a draft with nothing new in it is not worth a recovery prompt */
  if (R.d && (!R.d.text.trim() || (R.d.base && R.d.text === R.d.base.text))) Q.db.draft.clear();
  if (R.voice) { R.voice = false; Q.speech.abort(); }
  Object.values(R.timers).forEach(t => { clearTimeout(t); clearInterval(t); });
  R.locked = false;
  Q.wake.release('rec');
  exitFullscreen();
  el.classList.remove('on', 'dim');
  el.dataset.lock = '0';
  document.documentElement.classList.remove('rec-open', 'rec-locked');
  setTimeout(() => { if (!R.open) { el.hidden = true; el.setAttribute('aria-hidden', 'true'); } }, 200);
}
function enterFullscreen() {
  const d = document.documentElement;
  R.fs = false;
  if (!document.fullscreenEnabled || document.fullscreenElement || !d.requestFullscreen) return;
  try { d.requestFullscreen({ navigationUI: 'hide' }).then(() => { R.fs = true; }).catch(() => {}); } catch {}
}
function exitFullscreen() {
  if (R.fs && document.fullscreenElement && document.exitFullscreen) document.exitFullscreen().catch(() => {});
  R.fs = false;
}

function saveDraft() {
  if (!R.d) return;
  Q.db.draft.save(Object.assign({}, R.d, { secs: secs(), usedVoice: R.usedVoice, usedType: R.usedType, saved: Date.now() }));
}
async function done() {
  if (!R.open) return;
  if (R.voice) await stopVoice();
  const d = R.d, text = d.text.replace(/[ \t]+\n/g, '\n').trim();
  if (!text) { finish(false); Q.ui.toast('nothing to save'); return; }
  const parts = new Set(d.base ? (d.base.src === 'mixed' ? ['voice', 'typed'] : [d.base.src || 'typed']) : []);
  if (R.usedVoice) parts.add('voice');
  if (R.usedType || !parts.size) parts.add('typed');
  const e = Q.m.saveEntry({
    id: d.id, kind: d.kind, topic: d.topic, text, at: d.at, lang: d.lang,
    secs: Math.round((d.base ? d.base.secs || 0 : 0) + secs()), src: parts.size > 1 ? 'mixed' : [...parts][0],
  });
  const cb = R.onSaved;
  finish(true);
  if (Q.dump) Q.dump.afterSave(e, !!d.base);
  if (cb) cb(e);
}
function discard() {
  const n = words(R.d.text);
  if (!n || (R.d.base && R.d.text === R.d.base.text)) { finish(false); return; }
  Q.ui.confirm(R.d.base ? 'Undo the words added just now?' : `Discard this dump? (${fmtNum(n)} words)`, R.d.base ? 'undo them' : 'discard', () => finish(false));
}
function finish(saved) {
  if (!R.open) return;
  if (R.voice) { R.voice = false; Q.speech.abort(); }
  Q.db.draft.clear();
  Q.ui.closeLayer('rec');
  if (Q.app) Q.app.refresh();
  return saved;
}

Q.rec = {
  talk: (o = {}) => openRec(Object.assign({}, o, { voice: true })),
  write: (o = {}) => openRec(Object.assign({}, o, { voice: false })),
  resume: draft => openRec({ voice: false, draft }),
  /* open, not listening yet: a microphone wants a tap to start */
  ready: (o = {}) => openRec(Object.assign({}, o, { voice: false, focus: false })),
  isOpen: () => R.open,
  isLocked: () => R.locked,
  lock, unlock, done, discard, toggleVoice,
  _R: R, _addPhrase: addPhrase,
};
})();
