/* ── Shell ────────────────────────────────────────────────────────────────────
   Owns the five-slide track, the tab bar, the shared toast and the settings
   view. It knows nothing about what the four apps do — each module registers
   itself with Shell.register() and is otherwise left alone.

   Loaded before the app modules, so Shell.toast() exists by the time any of
   them boots and reports something. */
window.Shell = (function () {
  'use strict';

  const TABS = ['do', 'log', 'plan', 'store', 'settings'];
  const TAB_KEY = 'root_tab';          // last tab, so a reload lands where you left

  const track   = document.getElementById('track');
  const viewport= document.getElementById('views');
  const navBtns = Array.from(document.querySelectorAll('.tab-b'));
  const toastEl = document.getElementById('toast');

  let index = 0;
  const apps = {};                     // name → { onShow }

  // ── Toast ───────────────────────────────────────────────────────────────────
  /* One element for all five views. Each module's toast() forwards here, so a
     message from STORE cannot be clobbered by a stale timer from LOG. */
  let toastTimer = null;
  function toast(msg) {
    if (!toastEl) return;
    toastEl.textContent = msg;
    toastEl.classList.add('show');
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => toastEl.classList.remove('show'), 1800);
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

  function register(name, api) { apps[name] = api || {}; }

  navBtns.forEach((b, i) => b.addEventListener('click', () => go(i)));

  // ── Swipe ───────────────────────────────────────────────────────────────────
  /* Horizontal drag moves the track live; vertical is left to the browser via
     touch-action:pan-y. A gesture is refused outright when a sheet or modal is
     up, and when it starts inside something that scrolls sideways itself (the
     .md preview panes), where a swipe means "read the rest of this line". */
  const THRESHOLD = 0.22;   // fraction of the width that commits to the next tab
  const FLICK     = 0.45;   // px/ms that commits regardless of distance

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

  track.addEventListener('touchstart', e => {
    if (e.touches.length !== 1 || overlayOpen()) { tracking = false; return; }
    const t = e.touches[0];
    // iOS reserves the left edge for its own back gesture
    if (t.clientX < 22) { tracking = false; return; }
    if (scrollsSideways(e.target)) { tracking = false; return; }
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
    const far = Math.abs(dx) > w * THRESHOLD || speed > FLICK;
    let next = index;
    if (far && dx < 0) next = Math.min(TABS.length - 1, index + 1);
    if (far && dx > 0) next = Math.max(0, index - 1);
    if (next === index) setTransform(null, true); else go(next);
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

  // ── Boot: hash wins, then the last tab used, then DO ───────────────────────
  (function boot() {
    let start = 'do';
    const fromHash = location.hash.replace('#', '');
    if (TABS.includes(fromHash)) start = fromHash;
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

  return { toast, go, register, TABS };
})();


/* ── Settings view ────────────────────────────────────────────────────────────
   General housekeeping plus a jump into each app's own settings screen. The
   per-app screens were deliberately left where they are: moving that markup out
   of its slide would have broken each app's own go('settings') navigation. */
window.SET = (function () {
  'use strict';

  const SCOPE = '.ns-set ';
  const $id = id => document.querySelector(SCOPE + '#' + id);

  /* Which keys belong to which app. Everything here is read-only bookkeeping —
     the shell never writes to another app's keys. */
  const GROUPS = [
    { name: 'DO',    match: k => k.startsWith('do_') || k.startsWith('travel_state_') },
    { name: 'LOG',   match: k => k.startsWith('log_') || k === 'log-scale-v2' },
    { name: 'PLAN',  match: k => k.startsWith('plan_') },
    { name: 'STORE', match: k => k === 'store_state_v1' || k === 'eat_state_v1' },
  ];

  function allKeys() {
    try { return Object.keys(localStorage); } catch { return []; }
  }

  function fmtSize(chars) {
    const kb = chars / 1024;
    return kb < 1 ? chars + ' B' : kb < 1024 ? kb.toFixed(1) + ' KB' : (kb / 1024).toFixed(2) + ' MB';
  }

  function render() {
    const keys = allKeys();
    let total = 0;
    const sizes = {};
    keys.forEach(k => {
      const v = localStorage.getItem(k) || '';
      const n = k.length + v.length;
      total += n;
      const g = GROUPS.find(g => g.match(k));
      if (g) sizes[g.name] = (sizes[g.name] || 0) + n;
    });
    const rows = GROUPS.map(g => {
      const n = keys.filter(g.match).length;
      return `<div class="data-stat">
        <span class="data-stat-k">${g.name}</span>
        <span class="data-stat-v">${n} key${n === 1 ? '' : 's'} · ${fmtSize(sizes[g.name] || 0)}</span>
      </div>`;
    }).join('');
    $id('set-storage').innerHTML = rows +
      `<div class="data-stat"><span class="data-stat-k">All keys on this origin</span>
       <span class="data-stat-v">${keys.length} · ${fmtSize(total)}</span></div>`;
  }

  function jump(app) {
    Shell.go(app);
    const opener = { do: () => DO.go('settings'), log: () => LOG.go('datascreen'),
                     plan: () => PLAN.go('settings'), store: () => STORE.go('settings') }[app];
    if (opener) opener();
  }

  // ── Backup: every key on this origin, in one file ──────────────────────────
  /* Deliberately not filtered to the four prefixes: a backup that silently drops
     a key is worse than one that carries a few bytes too many. */
  async function exportAll() {
    const keys = allKeys();
    if (!keys.length) { Shell.toast('nothing stored yet'); return; }
    const data = {};
    keys.forEach(k => { data[k] = localStorage.getItem(k); });
    const payload = { app: 'root', version: 1, exported: new Date().toISOString(), data };
    const json = JSON.stringify(payload);
    const d = new Date();
    const stamp = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
    const filename = `root_backup_${stamp}.json`;
    try {
      const file = new File([json], filename, { type: 'application/json' });
      if (navigator.canShare?.({ files: [file] })) { await navigator.share({ files: [file] }); return; }
      if (navigator.share) { await navigator.share({ title: filename, text: json }); return; }
    } catch (err) { if (err.name === 'AbortError') return; }
    const a = document.createElement('a');
    a.href = URL.createObjectURL(new Blob([json], { type: 'application/json' }));
    a.download = filename; a.click();
    Shell.toast(`exported ${keys.length} keys`);
  }

  function pickImport() { $id('set-import-file').click(); }

  function importAll(event) {
    const file = event.target.files?.[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = () => {
      event.target.value = '';
      let payload;
      try { payload = JSON.parse(reader.result); } catch { Shell.toast('invalid file'); return; }
      const data = payload && typeof payload.data === 'object' ? payload.data : null;
      if (!data) { Shell.toast('not a root backup'); return; }
      const incoming = Object.keys(data);
      if (!incoming.length) { Shell.toast('nothing in that file'); return; }
      const existing = new Set(allKeys());
      const overwrite = incoming.filter(k => existing.has(k)).length;
      const msg = `Restore ${incoming.length} key${incoming.length !== 1 ? 's' : ''}?\n\n`
                + `${incoming.length - overwrite} new · ${overwrite} will overwrite what is here.\n\n`
                + `The app reloads afterwards.`;
      if (!confirm(msg)) return;
      try {
        incoming.forEach(k => { if (typeof data[k] === 'string') localStorage.setItem(k, data[k]); });
      } catch { Shell.toast('storage full — nothing changed'); return; }
      location.reload();
    };
    reader.readAsText(file);
  }

  Shell.register('settings', { onShow: render });
  // Shell has already picked the opening tab by the time this file's second half
  // runs, so onShow cannot have fired for a reload that lands here.
  render();

  return { render, jump, exportAll, pickImport, importAll,
           reload: () => location.reload() };
})();
