/* qurOS — the microphone and the screen.
   Q.speech wraps the Web Speech API so a dump survives what phones do to it:
   sessions that end after a silence, network drops, and Android Chrome's
   habit of repeating every earlier phrase inside the next result. It emits
   finished phrases and the in-progress tail; the recorder owns the text.
   Q.wake holds a screen wake lock for as many reasons as ask for one, and
   takes it back when the page becomes visible again (the browser drops it
   whenever the tab is hidden). */
(() => {
const Q = window.Q, { norm } = Q.u;

/* ── speech ── */
const SR = () => window.SpeechRecognition || window.webkitSpeechRecognition;
let rec = null, want = false, h = {}, sess = null, fails = 0, timer = 0, lang = '', state = 'idle', ending = null, opening = false;
let carry = null;   // a tail kept at the end of a session, so the next one cannot repeat it

/* ── the microphone (2.0.1, Hugo: "can't use other microphone than the phone microphone, need to use my headset or
   bose earbuds") ── The Web Speech API listens to the system's input and has no device to pick. A mic chosen in
   settings (`mic`, its name in `micName` to find it again if its id changes) is opened for the whole recording and
   handed to start(): desktop Chrome (135+) listens to that track. Chrome on Android ignores the track, but a Bluetooth
   headset's mic held open is the phone switching to the headset's call mic, which its own recogniser may then hear
   through. If the recogniser can't get audio that way, the held mic is let go and the phone's is used for the rest of
   the recording; one that isn't connected falls back the same way. '' = the phone's own, as before. */
let micStream = null, micOff = false;
const md = () => navigator.mediaDevices;
const live = () => micStream && micStream.getAudioTracks().find(t => t.readyState === 'live');
function dropMic() { if (micStream) { micStream.getTracks().forEach(t => { try { t.stop(); } catch {} }); micStream = null; } }
async function inputs() { return md() && md().enumerateDevices ? (await md().enumerateDevices()).filter(d => d.kind === 'audioinput') : []; }
async function micTrack() {
  const s = Q.settings.get();
  if (!s.mic || micOff || !md() || !md().getUserMedia) return null;
  if (live()) return live();
  try {
    const all = await inputs();
    const dev = all.find(d => d.deviceId === s.mic) || (s.micName && all.find(d => d.label === s.micName));
    if (!dev) { micOff = true; if (h.onMic) h.onMic('missing', s.micName); return null; }
    micStream = await md().getUserMedia({ audio: { deviceId: { exact: dev.deviceId } } });
    return live() || null;
  } catch { micOff = true; dropMic(); if (h.onMic) h.onMic('failed', s.micName); return null; }
}

function setState(s, detail) {
  state = s;
  if (h.onState) h.onState(s, detail);
}
/* Android Chrome, continuous mode: results[n] often holds results[n-1]'s
   words plus the new ones. A phrase that extends the previous one replaces
   it; a phrase that equals it is dropped. */
function relation(prev, t) {
  if (!prev) return 'new';
  const a = norm(prev), b = norm(t);
  if (!b || a === b) return 'same';
  if (b.startsWith(a + ' ')) return 'extends';
  return 'new';
}
function phrase(t) {
  const r = relation(sess.last, t);
  if (r === 'same') return;
  sess.last = t;
  if (h.onPhrase) h.onPhrase(t, r === 'extends');
}
function onResult(e) {
  fails = 0;
  if (state !== 'listening') setState('listening');
  let interim = '';
  for (let i = e.resultIndex; i < e.results.length; i++) {
    const r = e.results[i], t = ((r[0] && r[0].transcript) || '').trim();
    if (r.isFinal) {
      if (i < sess.done) continue;
      sess.done = i + 1;
      if (t) phrase(t);
    } else if (t) interim += (interim ? ' ' : '') + t;
  }
  /* the tail repeats the last phrase on the same devices; show only what is new */
  if (interim && sess.last && relation(sess.last, interim) === 'extends') interim = interim.slice(sess.last.length).trim();
  else if (interim && sess.last && relation(sess.last, interim) === 'same') interim = '';
  sess.interim = interim;
  if (h.onInterim) h.onInterim(interim);
  if (h.onActivity) h.onActivity();
}
function onError(e) {
  const code = e && e.error;
  if (code === 'no-speech' || code === 'aborted') return;      // onend restarts
  if (code === 'not-allowed' || code === 'service-not-allowed') { want = false; dropMic(); setState('denied', code); return; }
  if (code === 'language-not-supported') { want = false; setState('lang', code); return; }
  // the chosen mic held open and the recogniser hears nothing through it: the phone's mic from here on
  if (code === 'audio-capture' && micStream) { dropMic(); micOff = true; if (h.onMic) h.onMic('lost', Q.settings.get().micName); return; }
  fails++;
  setState(code === 'network' ? 'offline' : code === 'audio-capture' ? 'nomic' : 'retry', code);
}
function onEnd() {
  /* iOS (and a stop() mid-word) can end a session without finalising its
     tail. Keep it: a half-heard phrase is better than a lost one. */
  if (sess && sess.interim) { phrase(sess.interim); carry = { t: sess.interim, at: Date.now() }; sess.interim = ''; if (h.onInterim) h.onInterim(''); }
  rec = null;
  if (ending) { const f = ending; ending = null; f(); }
  if (want) schedule();
  else { dropMic(); if (!['denied', 'lang'].includes(state)) setState('idle'); }
}
function schedule() {
  clearTimeout(timer);
  const delay = fails ? Math.min(5000, 400 * 2 ** (fails - 1)) : 120;
  if (!fails && state !== 'offline' && state !== 'nomic') setState('restarting');
  timer = setTimeout(open, delay);
}
async function open() {
  clearTimeout(timer);
  if (!want || rec || opening) return;
  const C = SR();
  if (!C) { want = false; setState('unsupported'); return; }
  opening = true;
  const track = await micTrack();
  opening = false;
  if (!want) { dropMic(); return; }
  if (rec) return;
  try {
    rec = new C();
    rec.lang = lang || navigator.language || 'en-GB';
    rec.continuous = true;
    rec.interimResults = true;
    rec.maxAlternatives = 1;
    sess = { done: 0, last: carry && Date.now() - carry.at < 5000 ? carry.t : '', interim: '' };
    carry = null;
    rec.onstart = () => { if (state !== 'listening') setState('listening'); };
    rec.onresult = onResult;
    rec.onerror = onError;
    rec.onend = onEnd;
    rec.onspeechstart = () => h.onActivity && h.onActivity();
    if (track) rec.start(track); else rec.start();
    if (state === 'idle' || state === 'restarting' || state === 'paused') setState('starting');
  } catch {
    rec = null; fails++;
    schedule();
  }
}

Q.speech = {
  supported: () => !!SR(),
  state: () => state,
  start(handlers, language) {
    h = handlers || {};
    lang = language || '';
    want = true; fails = 0; micOff = false;
    if (rec) return;
    setState('starting');
    open();
  },
  /* resolves once the last words are in (or after 1.5 s, whichever is first) */
  stop() {
    want = false;
    clearTimeout(timer);
    if (!rec) { dropMic(); setState('idle'); return Promise.resolve(); }
    return new Promise(res => {
      const t = setTimeout(() => { ending = null; res(); }, 1500);
      ending = () => { clearTimeout(t); res(); };
      try { rec.stop(); } catch { ending = null; clearTimeout(t); rec = null; setState('idle'); res(); }
    });
  },
  abort() {
    want = false; clearTimeout(timer);
    if (rec) { try { rec.onresult = null; rec.abort(); } catch {} rec = null; }
    dropMic();
    setState('idle');
  },
  setLang(l) { lang = l; if (rec) { try { rec.stop(); } catch {} } },
  /* the mics the browser offers, for settings: names show only once the mic has been allowed, so it is asked for once
     and let go at once. The system's own entries ('default', 'communications') are the phone's mic: left out. */
  async mics() {
    if (!md() || !md().enumerateDevices) return null;
    let list = await inputs();
    if (!list.some(d => d.label) && md().getUserMedia) {
      try { const s = await md().getUserMedia({ audio: true }); s.getTracks().forEach(t => t.stop()); list = await inputs(); } catch {}
    }
    return list.filter(d => d.deviceId && !['default', 'communications'].includes(d.deviceId)).map(d => ({ id: d.deviceId, name: d.label || 'microphone' }));
  },
  mic: () => (live() ? Q.settings.get().micName || 'microphone' : ''),
  _relation: relation,
};

/* ── wake lock ── */
let sentinel = null, pending = null, wstate = 'off';
const reasons = new Set(), wl = new Set();
const wset = s => { if (s === wstate) return; wstate = s; wl.forEach(f => f(s)); };
async function acquire() {
  if (sentinel || pending || !reasons.size) return;
  if (!('wakeLock' in navigator)) { wset('unsupported'); return; }
  if (document.visibilityState === 'hidden') return;
  pending = navigator.wakeLock.request('screen').then(s => {
    pending = null;
    if (!reasons.size) { s.release().catch(() => {}); return; }
    sentinel = s;
    wset('on');
    s.addEventListener('release', () => {
      sentinel = null;
      wset(reasons.size ? 'lost' : 'off');
    });
  }).catch(() => { pending = null; wset('blocked'); });
  return pending;
}
document.addEventListener('visibilitychange', () => {
  if (document.visibilityState !== 'visible') return;
  if (reasons.size) acquire();
  /* back on screen: listen again now rather than after the retry back-off */
  if (want && !rec) { fails = 0; open(); }
});
Q.wake = {
  hold(reason) { reasons.add(reason); return acquire(); },
  release(reason) {
    reasons.delete(reason);
    if (!reasons.size) { if (sentinel) { const s = sentinel; sentinel = null; s.release().catch(() => {}); } wset('off'); }
  },
  held: r => reasons.has(r),
  state: () => wstate,
  on: f => wl.add(f),
  supported: () => 'wakeLock' in navigator,
};
})();
