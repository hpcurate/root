/* ── Shell ────────────────────────────────────────────────────────────────────
   The frame the four apps live in: a five-slide horizontal track, the floating
   tab chrome, the shared toast, and the shared Todoist credential. It knows
   nothing about what the apps do — each module registers itself with
   Shell.register() and is otherwise left alone.

   Load order matters. js/prefs.js runs from <head> and has already stamped the
   look onto <html> by the time this file executes; this file then defines
   Creds.token() and Shell.toast(), which every app module needs while booting.
   js/settings.js loads last and owns the settings view.

   What the appearance engine changed here: every behaviour that used to be a
   constant — the toast duration, whether swiping is on and how far it has to go,
   whether the chrome auto-hides, which tab opens — now reads from Prefs on the
   spot rather than being captured at boot, so changing a setting takes effect
   without a reload. */

/* ── Shared Todoist credential ────────────────────────────────────────────────
   DO, PLAN and STORE each used to keep their own copy of the same key. There is
   one now, and every module reads it live through Creds.token() rather than
   caching it, so saving in settings takes effect everywhere without a reload.

   Saving also mirrors the value back into the three original keys, so the
   standalone complete/, plan/ and eat/ apps keep working off the same token. */
window.Creds = (function () {
  'use strict';
  const KEY          = 'root_todoist_v1';
  const LEGACY_DO    = 'do_todoist_v1';
  const LEGACY_PLAN  = 'plan_token';
  const LEGACY_STORE = 'store_state_v1';

  const readJSON = k => { try { return JSON.parse(localStorage.getItem(k) || 'null'); } catch { return null; } };

  function token() { return (readJSON(KEY) || {}).token || ''; }

  /* Whichever app still holds one wins; they are all meant to be the same
     Todoist account key anyway. */
  function legacyToken() {
    const d = readJSON(LEGACY_DO);
    if (d && d.token) return d.token;
    const s = readJSON(LEGACY_STORE);
    if (s && s.todoist && s.todoist.token) return s.todoist.token;
    try { return localStorage.getItem(LEGACY_PLAN) || ''; } catch { return ''; }
  }

  function mirror(tok) {
    try {
      const d = readJSON(LEGACY_DO) || {};
      d.token = tok;
      localStorage.setItem(LEGACY_DO, JSON.stringify(d));
      localStorage.setItem(LEGACY_PLAN, tok);
      const s = readJSON(LEGACY_STORE);
      if (s) {
        s.todoist = Object.assign({}, s.todoist, { token: tok });
        localStorage.setItem(LEGACY_STORE, JSON.stringify(s));
      }
    } catch {}
  }

  function save(tok) {
    try { localStorage.setItem(KEY, JSON.stringify({ token: tok, saved: Date.now() })); } catch {}
    mirror(tok);
  }

  // adopt an existing key on first run, before any module reads it
  if (!token()) { const t = legacyToken(); if (t) save(t); }

  return { token, save };
})();


window.Shell = (function () {
  'use strict';

  const TABS = ['do', 'log', 'plan', 'store', 'settings'];
  const TAB_KEY = 'root_tab';          // last tab, so a reload lands where you left

  const track    = document.getElementById('track');
  const viewport = document.getElementById('views');
  const navEl    = document.getElementById('nav');
  const navBtns  = Array.from(document.querySelectorAll('.tab-b'));
  const arrows   = Array.from(document.querySelectorAll('.nav-arrow'));
  const prevBtn  = document.getElementById('nav-prev');
  const nextBtn  = document.getElementById('nav-next');
  const toastEl  = document.getElementById('toast');

  const pref = (k, fallback) => (window.Prefs ? Prefs.get(k) : fallback);

  let index = 0;
  const apps = {};                     // name → { onShow }

  // ── Toast ───────────────────────────────────────────────────────────────────
  /* One element for all five views. Every module's toast() forwards here, so a
     message from STORE cannot be clobbered by a stale timer from LOG. */
  let toastTimer = null;
  function toast(msg) {
    if (!toastEl) return;
    toastEl.textContent = msg;
    toastEl.classList.add('show');
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => toastEl.classList.remove('show'), pref('toastMs', 1800));
  }

  // ── Floating chrome ─────────────────────────────────────────────────────────
  /* The pill and arrows hover over the content, so they step aside while you
     read and come back the moment you scroll up, stop, or change tab. Turning
     "get out of the way" off in settings pins them permanently. */
  let chromeTimer = null;
  function showChrome() {
    navEl.classList.remove('chrome-off');
    arrows.forEach(a => a.classList.remove('chrome-off'));
  }
  function hideChrome() {
    if (!pref('autoHideChrome', true)) return;
    navEl.classList.add('chrome-off');
    arrows.forEach(a => a.classList.add('chrome-off'));
  }
  function watchScroll(view) {
    let last = 0;
    view.addEventListener('scroll', () => {
      const y = view.scrollTop, dy = y - last;
      last = y;
      clearTimeout(chromeTimer);
      if (y > 72 && dy > 6)      hideChrome();
      else if (dy < -6 || y < 8) showChrome();
      chromeTimer = setTimeout(showChrome, 900);   // idle always brings it back
    }, { passive: true });
  }

  // ── Tabs ────────────────────────────────────────────────────────────────────
  function setTransform(px, animate) {
    track.classList.toggle('dragging', !animate);
    track.style.transform = px === null
      ? `translate3d(${-index * 100}%,0,0)`
      : `translate3d(${px}px,0,0)`;
  }

  function go(name, opts = {}) {
    const i = typeof name === 'number' ? name : TABS.indexOf(name);
    if (i < 0 || i >= TABS.length) return;
    index = i;
    setTransform(null, true);
    navBtns.forEach((b, n) => {
      b.classList.toggle('on', n === i);
      b.setAttribute('aria-selected', n === i ? 'true' : 'false');
    });
    if (prevBtn) prevBtn.disabled = i === 0;
    if (nextBtn) nextBtn.disabled = i === TABS.length - 1;
    showChrome();
    clearTimeout(chromeTimer);
    try { localStorage.setItem(TAB_KEY, TABS[i]); } catch {}
    if (!opts.silent) {
      const h = '#' + TABS[i];
      // replaceState throws on a file:// origin in some browsers; the tab still
      // works, it just cannot be linked to.
      try { if (location.hash !== h) history.replaceState(null, '', h); } catch {}
    }
    const app = apps[TABS[i]];
    if (app && app.onShow) app.onShow();
  }

  /* Every app's "settings" entry point routes here. */
  function settings(panel) {
    go('settings');
    if (window.SET && panel) SET.panel(panel);
  }

  function register(name, api) { apps[name] = api || {}; }

  navBtns.forEach((b, i) => b.addEventListener('click', () => { if (window.Prefs) Prefs.tap(); go(i); }));
  if (prevBtn) prevBtn.addEventListener('click', () => go(index - 1));
  if (nextBtn) nextBtn.addEventListener('click', () => go(index + 1));
  document.querySelectorAll('.view').forEach(watchScroll);

  // ── Swipe ───────────────────────────────────────────────────────────────────
  /* Horizontal drag moves the track live; vertical is left to the browser via
     touch-action:pan-y. A gesture is refused outright when a sheet or modal is
     up, and when it starts inside something that scrolls sideways itself (the
     .md preview panes), where a swipe means "read the rest of this line". */
  const FLICK = 0.45;   // px/ms that commits regardless of distance

  let sx = 0, sy = 0, st = 0, dx = 0;
  let tracking = false, axis = null;

  function overlayOpen() {
    return !!document.querySelector('.sheet-back.on') ||
           !!document.querySelector('.modal-overlay:not(.hidden)');
  }

  function scrollsSideways(node) {
    for (let el = node; el && el !== track; el = el.parentElement) {
      if (el.scrollWidth > el.clientWidth + 2) {
        const ox = getComputedStyle(el).overflowX;
        if (ox === 'auto' || ox === 'scroll') return true;
      }
    }
    return false;
  }

  /* A drag that starts inside a text field belongs to the field. On a phone that
     gesture is how you place the caret and how you reach the paste callout —
     taking it for the tab swipe made the settings view slide away mid-paste, so
     the Todoist key could never be pasted in. */
  function isEditable(node) {
    if (!node || !node.closest) return false;
    return !!node.closest('input,textarea,select,[contenteditable]:not([contenteditable="false"])');
  }

  track.addEventListener('touchstart', e => {
    if (!pref('swipe', true)) { tracking = false; return; }
    if (e.touches.length !== 1 || overlayOpen()) { tracking = false; return; }
    const t = e.touches[0];
    // iOS reserves the left edge for its own back gesture
    if (t.clientX < 22) { tracking = false; return; }
    if (isEditable(e.target) || scrollsSideways(e.target)) { tracking = false; return; }
    sx = t.clientX; sy = t.clientY; st = Date.now();
    dx = 0; axis = null; tracking = true;
  }, { passive: true });

  track.addEventListener('touchmove', e => {
    if (!tracking) return;
    const t = e.touches[0];
    const mx = t.clientX - sx, my = t.clientY - sy;
    if (axis === null) {
      if (Math.abs(mx) < 8 && Math.abs(my) < 8) return;
      axis = Math.abs(mx) > Math.abs(my) * 1.3 ? 'x' : 'y';
      if (axis === 'y') { tracking = false; return; }
      showChrome();
    }
    dx = mx;
    // rubber-band at the two ends so the track never looks broken
    if ((index === 0 && dx > 0) || (index === TABS.length - 1 && dx < 0)) dx *= 0.32;
    setTransform(-index * viewport.clientWidth + dx, false);
  }, { passive: true });

  function endDrag() {
    if (!tracking) return;
    tracking = false;
    if (axis !== 'x') { setTransform(null, true); return; }
    const w = viewport.clientWidth || 1;
    const speed = Math.abs(dx) / Math.max(1, Date.now() - st);
    const far = Math.abs(dx) > w * pref('swipeStrength', 0.22) || speed > FLICK;
    let next = index;
    if (far && dx < 0) next = Math.min(TABS.length - 1, index + 1);
    if (far && dx > 0) next = Math.max(0, index - 1);
    if (next === index) setTransform(null, true);
    else { if (window.Prefs) Prefs.tap(); go(next); }
    dx = 0; axis = null;
  }
  track.addEventListener('touchend', endDrag, { passive: true });
  track.addEventListener('touchcancel', endDrag, { passive: true });

  // A percentage transform re-resolves against the new width on its own; this
  // only matters if the window is resized mid-drag.
  window.addEventListener('resize', () => { if (!tracking) setTransform(null, false); });

  window.addEventListener('hashchange', () => {
    const name = location.hash.replace('#', '');
    if (TABS.includes(name) && TABS[index] !== name) go(name, { silent: true });
  });

  /* ── Keyboard ─────────────────────────────────────────────────────────────
     ROOT is a phone app that also runs on a laptop, where five slides and no
     keyboard route is a real gap. Every binding is ignored while a field has
     focus, so typing never navigates. */
  document.addEventListener('keydown', e => {
    if (!pref('keyboardNav', true)) return;
    if (e.metaKey || e.ctrlKey || e.altKey) return;
    const el = document.activeElement;
    if (el && el.closest && el.closest('input,textarea,select,[contenteditable]')) return;
    if (e.key === 'ArrowRight') { go(index + 1); e.preventDefault(); }
    else if (e.key === 'ArrowLeft') { go(index - 1); e.preventDefault(); }
    else if (e.key >= '1' && e.key <= '5') { go(+e.key - 1); e.preventDefault(); }
    else if (e.key === '/') { settings(); e.preventDefault(); }
  });

  // ── Boot: hash wins, then the start-tab preference, then the last tab ──────
  (function boot() {
    let start = 'do';
    const fromHash = location.hash.replace('#', '');
    const want = pref('startTab', 'last');
    if (TABS.includes(fromHash)) start = fromHash;
    else if (want !== 'last' && TABS.includes(want)) start = want;
    else { try { const s = localStorage.getItem(TAB_KEY); if (TABS.includes(s)) start = s; } catch {} }
    // Land on the opening tab without animating in from DO: park the track there
    // with the transition off and flush it, so go()'s identical transform is a
    // no-op rather than something to animate towards.
    index = TABS.indexOf(start);
    track.classList.add('dragging');
    track.style.transform = `translate3d(${-index * 100}%,0,0)`;
    void track.offsetWidth;
    go(start);
  })();

  /* Turning auto-hide off should bring the chrome back immediately, not at the
     next scroll. */
  if (window.Prefs) Prefs.subscribe(k => {
    if (k === 'autoHideChrome' || k === '*') { if (pref('autoHideChrome', true) === false) showChrome(); }
  });

  return { toast, go, settings, register, showChrome, TABS };
})();
