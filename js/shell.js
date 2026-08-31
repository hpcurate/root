/* ── Shell ────────────────────────────────────────────────────────────────────
   Owns the five-slide track, the floating tab pill and its two arrows, the
   shared toast, the shared Todoist credential, the theme, and the settings view.
   It knows nothing about what the four apps do — each module registers itself
   with Shell.register() and is otherwise left alone.

   Loaded before the app modules, so Shell.toast() and Creds.token() exist by the
   time any of them boots. */

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


/* ── Theme ────────────────────────────────────────────────────────────────── */
window.Theme = (function () {
  'use strict';
  const KEY = 'root_theme';

  const THEMES = [
    { id:'void',  name:'Void',  desc:'the original — near-black, purple',
      sw:['#0e0e0e','#161616','#A78BFA','#dedede'] },
    { id:'ember', name:'Ember', desc:'warm charcoal, amber accent',
      sw:['#100d0b','#191512','#e8a33d','#e6ded3'] },
    { id:'frost', name:'Frost', desc:'cold slate, cyan accent',
      sw:['#0b0f13','#12181e','#5ad4e6','#d6e3ea'] },
    { id:'paper', name:'Paper', desc:'light ground, serif display, soft shadows',
      sw:['#f2ede3','#fffdf7','#6b4df0','#22201c'] },
  ];

  function current() {
    try { const v = localStorage.getItem(KEY); return THEMES.some(t => t.id === v) ? v : 'void'; }
    catch { return 'void'; }
  }

  /* PAPER is the only theme that needs faces we do not already load, so they are
     fetched the first time it is chosen rather than on every cold start. */
  function ensurePaperFonts() {
    if (document.getElementById('paper-fonts')) return;
    const l = document.createElement('link');
    l.id = 'paper-fonts';
    l.rel = 'stylesheet';
    l.href = 'https://fonts.googleapis.com/css2?family=Fraunces:opsz,wght@9..144,600;9..144,800' +
             '&family=IBM+Plex+Mono:wght@400;700&display=swap';
    document.head.appendChild(l);
  }

  function apply(id, opts = {}) {
    const t = THEMES.find(x => x.id === id) ? id : 'void';
    if (t === 'paper') ensurePaperFonts();
    document.documentElement.setAttribute('data-theme', t);
    if (opts.persist !== false) { try { localStorage.setItem(KEY, t); } catch {} }
    // keep the iOS status bar / Android chrome in step with the ground colour
    requestAnimationFrame(() => {
      const bg = getComputedStyle(document.documentElement).getPropertyValue('--bg').trim();
      const meta = document.querySelector('meta[name="theme-color"]');
      if (meta && bg) meta.setAttribute('content', bg);
    });
    return t;
  }

  // index.html sets the attribute inline before first paint; this re-runs the
  // rest of apply() so the theme-color meta matches on a cold start too.
  apply(current(), { persist: false });

  return { THEMES, current, apply };
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

  // ── Floating chrome ─────────────────────────────────────────────────────────
  /* The pill and arrows hover over the content, so they step aside while you
     read and come back the moment you scroll up, stop, or change tab. */
  let chromeTimer = null;
  function showChrome() {
    navEl.classList.remove('chrome-off');
    arrows.forEach(a => a.classList.remove('chrome-off'));
  }
  function hideChrome() {
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

  /* Every app's "settings" entry point routes here now. */
  function settings(panel) {
    go('settings');
    if (window.SET && panel) SET.panel(panel);
  }

  function register(name, api) { apps[name] = api || {}; }

  navBtns.forEach((b, i) => b.addEventListener('click', () => go(i)));
  if (prevBtn) prevBtn.addEventListener('click', () => go(index - 1));
  if (nextBtn) nextBtn.addEventListener('click', () => go(index + 1));
  document.querySelectorAll('.view').forEach(watchScroll);

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

  /* A drag that starts inside a text field belongs to the field. On a phone that
     gesture is how you place the caret and how you reach the paste callout —
     taking it for the tab swipe made the settings view slide away mid-paste, so
     the Todoist key could never be pasted in. */
  function isEditable(node) {
    if (!node || !node.closest) return false;
    return !!node.closest('input,textarea,select,[contenteditable]:not([contenteditable="false"])');
  }

  track.addEventListener('touchstart', e => {
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

  return { toast, go, settings, register, showChrome, TABS };
})();


/* ── Settings view ────────────────────────────────────────────────────────────
   Every app's settings now live here, one panel each, behind a segmented
   control. The panels carry .ns-do / .ns-log / .ns-plan / .ns-store, so each
   app's own stylesheet still dresses its controls and each module's scoped
   $id() still finds them wherever they sit in the document. */
window.SET = (function () {
  'use strict';

  const SCOPE = '.ns-set ';
  const $id = id => document.querySelector(SCOPE + '#' + id);

  const PANELS = ['general', 'do', 'log', 'plan', 'store'];
  let currentPanel = 'general';

  /* Which keys belong to which app. Everything here is read-only bookkeeping —
     the shell never writes to another app's keys. */
  const GROUPS = [
    { name: 'DO',    match: k => k.startsWith('do_') || k.startsWith('travel_state_') },
    { name: 'LOG',   match: k => k.startsWith('log_') || k === 'log-scale-v2' },
    { name: 'PLAN',  match: k => k.startsWith('plan_') },
    { name: 'STORE', match: k => k === 'store_state_v1' || k === 'eat_state_v1' },
    { name: 'ROOT',  match: k => k.startsWith('root_') },
  ];

  const allKeys = () => { try { return Object.keys(localStorage); } catch { return []; } };

  function fmtSize(chars) {
    const kb = chars / 1024;
    return kb < 1 ? chars + ' B' : kb < 1024 ? kb.toFixed(1) + ' KB' : (kb / 1024).toFixed(2) + ' MB';
  }

  // ── Panels ──────────────────────────────────────────────────────────────────
  function panel(name) {
    if (!PANELS.includes(name)) return;
    currentPanel = name;
    document.querySelectorAll(SCOPE + '.set-panel').forEach(p =>
      p.classList.toggle('on', p.dataset.panel === name));
    document.querySelectorAll(SCOPE + '.seg-b').forEach(b =>
      b.classList.toggle('on', b.dataset.seg === name));
    const view = document.getElementById('view-settings');
    if (view) view.scrollTop = 0;
    Shell.showChrome();
    // let each app fill in its own controls when its panel comes up
    ({ do: () => DO.renderSettings(), log: () => LOG.renderDataScreen(),
       plan: () => PLAN.renderSettings(), store: () => STORE.renderSettings() })[name]?.();
    if (name === 'general') renderGeneral();
  }

  // ── General panel ───────────────────────────────────────────────────────────
  function renderThemes() {
    const cur = Theme.current();
    $id('theme-grid').innerHTML = Theme.THEMES.map(t => `
      <button class="theme-card${t.id === cur ? ' on' : ''}" data-theme-id="${t.id}"
              onclick="SET.pickTheme('${t.id}')">
        <span class="theme-swatch">${t.sw.map(c => `<i style="background:${c}"></i>`).join('')}</span>
        <span class="theme-name">${t.name}<span class="tick">✓</span></span>
        <span class="theme-desc">${t.desc}</span>
      </button>`).join('');
  }

  function pickTheme(id) {
    Theme.apply(id);
    renderThemes();
    Shell.toast('theme · ' + (Theme.THEMES.find(t => t.id === id) || {}).name);
  }

  /* onShow re-renders this panel every time the settings tab comes back up, so
     the field is only refilled from storage when it holds nothing the user has
     not saved yet — otherwise leaving the tab and returning wiped a key that had
     been pasted but not saved. */
  function renderToken() {
    const tok = Creds.token();
    const inp = $id('set-td-token');
    if (inp) {
      const unsaved = inp.value && inp.value !== tok;
      if (!unsaved && document.activeElement !== inp) inp.value = tok;
    }
    tdStatus(tok ? 'key saved · used by DO, PLAN and STORE' : 'no key yet', tok ? 'good' : '');
  }

  function tdStatus(msg, kind) {
    const el = $id('set-td-status');
    if (!el) return;
    el.textContent = msg;
    el.className = 'td-status' + (kind ? ' ' + kind : '');
  }

  function saveToken() {
    const tok = $id('set-td-token').value.trim();
    Creds.save(tok);
    renderToken();
    Shell.toast(tok ? 'todoist key saved' : 'todoist key cleared');
  }

  /* A single check against the account, rather than three per-app ones. Each
     app still has its own project/section test in its own panel. */
  async function testToken() {
    const tok = Creds.token();
    if (!tok) { tdStatus('paste your key and save it first', 'bad'); return; }
    const btn = $id('set-td-test');
    btn.disabled = true;
    tdStatus('checking…', 'busy');
    try {
      const res = await fetch('https://api.todoist.com/api/v1/projects?limit=1',
                              { headers: { 'Authorization': 'Bearer ' + tok } });
      if (res.status === 401 || res.status === 403) throw new Error('key rejected by Todoist');
      if (!res.ok) throw new Error('Todoist error ' + res.status);
      tdStatus('key works — DO, PLAN and STORE are all using it', 'good');
    } catch (e) {
      tdStatus(location.protocol === 'file:'
        ? 'blocked by the browser — serve over http(s), not as a local file'
        : e.message, 'bad');
    } finally { btn.disabled = false; }
  }

  function renderStorage() {
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

  function renderGeneral() { renderThemes(); renderToken(); renderStorage(); }

  // ── Backup: every key on this origin, in one file ──────────────────────────
  /* Deliberately not filtered to the known prefixes: a backup that silently
     drops a key is worse than one that carries a few bytes too many. */
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

  document.querySelectorAll(SCOPE + '.seg-b').forEach(b =>
    b.addEventListener('click', () => panel(b.dataset.seg)));

  Shell.register('settings', { onShow: () => { if (currentPanel === 'general') renderGeneral(); } });
  // Shell has already picked the opening tab by the time this file's second half
  // runs, so onShow cannot have fired for a reload that lands here.
  renderGeneral();

  return { panel, pickTheme, saveToken, testToken, renderGeneral, renderStorage,
           exportAll, pickImport, importAll, reload: () => location.reload() };
})();
