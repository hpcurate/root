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


/* ── Shared Todoist client ────────────────────────────────────────────────────
   The unified v1 API, direct. DO keeps its own copy because it also offers the
   worker proxy as an endpoint; TEND (and anything added later) uses this one.
   getAll follows the {results,next_cursor} pagination v1 uses on some
   collections and accepts the bare arrays it returns on others. */
window.Todoist = (function () {
  'use strict';
  const BASE = 'https://api.todoist.com/api/v1';
  async function call(path, opts = {}) {
    const tok = Creds.token();
    if (!tok) throw new Error('no Todoist key saved — add one under settings → data');
    let res;
    try {
      res = await fetch(BASE + path, {
        ...opts,
        headers: { 'Authorization': 'Bearer ' + tok,
                   ...(opts.body ? { 'Content-Type': 'application/json' } : {}), ...(opts.headers || {}) },
      });
    } catch {
      throw new Error(location.protocol === 'file:'
        ? 'blocked by the browser — serve over http(s), not as a local file'
        : 'network error');
    }
    if (res.status === 401 || res.status === 403) throw new Error('token rejected by Todoist');
    if (res.status === 429) throw new Error('rate limited by Todoist — wait a minute');
    if (!res.ok) throw new Error('Todoist error ' + res.status);
    const text = await res.text();          // /close and /reopen answer 204 with no body
    return text ? JSON.parse(text) : null;
  }
  async function getAll(path, params = {}) {
    const out = [];
    let cursor = null;
    do {
      const q = new URLSearchParams({ ...params, limit: '200' });
      if (cursor) q.set('cursor', cursor);
      const page = await call(`${path}?${q}`);
      if (Array.isArray(page)) { out.push(...page); cursor = null; }
      else { out.push(...((page && page.results) || [])); cursor = (page && page.next_cursor) || null; }
    } while (cursor);
    return out;
  }
  /* "04 | life" and "04|life" are the same project. */
  const name = s => String(s || '').toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '')
                      .replace(/[^a-z0-9]+/g, ' ').trim();
  async function resolve(project, section) {
    const projects = await getAll('/projects');
    const proj = projects.find(p => name(p.name) === name(project));
    if (!proj) throw new Error(`project "${project}" not found (${projects.length} visible)`);
    if (!section) return { projectId: proj.id, projectName: proj.name, sectionId: null, sectionName: '' };
    const sections = await getAll('/sections', { project_id: proj.id });
    const sec = sections.find(s => name(s.name) === name(section));
    if (!sec) throw new Error(`section "${section}" not found in ${proj.name} — has: ${sections.map(s => s.name).join(', ') || 'none'}`);
    return { projectId: proj.id, projectName: proj.name, sectionId: sec.id, sectionName: sec.name };
  }
  const due = task => { const d = task && task.due && task.due.date; return d ? String(d).slice(0, 10) : null; };

  /* Todoist's twenty colour names, as hex. */
  const COLORS = { berry_red:'#b8256f', red:'#db4035', orange:'#ff9933', yellow:'#fad000', olive_green:'#afb83b',
    lime_green:'#7ecc49', green:'#299438', mint_green:'#6accbc', teal:'#158fad', sky_blue:'#14aaf5', light_blue:'#96c3eb',
    blue:'#4073ff', grape:'#884dff', violet:'#af38eb', lavender:'#eb96eb', magenta:'#e05194', salmon:'#ff8d85',
    charcoal:'#808080', grey:'#b8b8b8', taupe:'#ccac93' };

  /* ── Label colours, shared ──
     Every app that draws a Todoist label in its colour reads this one cache
     (root_labels_v1: { fetched, colors:{ <folded name>: hex } }). DO fills it
     as a side effect of its own /labels calls; PLAN asks labels() on show,
     which refreshes it when it is older than an hour, single-flight. */
  const LKEY = 'root_labels_v1';
  let labelsBusy = null;
  const readLabels = () => { try { return JSON.parse(localStorage.getItem(LKEY) || 'null') || null; } catch { return null; } };
  function cacheLabels(list) {
    const colors = {};
    (list || []).forEach(l => { const hex = COLORS[l && l.color]; if (hex && l.name) colors[name(l.name)] = hex; });
    try { localStorage.setItem(LKEY, JSON.stringify({ fetched: Date.now(), colors })); } catch {}
    return colors;
  }
  function labelColors() { const r = readLabels(); return (r && r.colors) || {}; }
  function labelColor(n) { return labelColors()[name(n)] || null; }
  async function labels(maxAge = 60 * 60 * 1000) {
    const rec = readLabels();
    if (rec && Date.now() - (rec.fetched || 0) < maxAge) return rec.colors || {};
    if (!Creds.token()) return (rec && rec.colors) || {};
    if (!labelsBusy) labelsBusy = getAll('/labels').then(cacheLabels).catch(() => (rec && rec.colors) || {}).finally(() => { labelsBusy = null; });
    return labelsBusy;
  }
  return { call, getAll, name, resolve, due, COLORS, cacheLabels, labelColors, labelColor, labels };
})();


window.Shell = (function () {
  'use strict';

  /* Every app the markup carries, and the tabs actually shown. TABS is rebuilt
     from Settings → layout → "apps in the bar" (Prefs `apps`): the chosen apps
     in the chosen order, then settings. It is mutated in place, never replaced,
     so the reference handed out below stays live. */
  const APPS = (window.Prefs && Prefs.APPS) || ['do', 'log', 'plan', 'store', 'tend', 'track', 'learn'];
  const TABS = [];
  const TAB_KEY = 'root_tab';          // last tab, so a reload lands where you left

  const track    = document.getElementById('track');
  const viewport = document.getElementById('views');
  const navEl    = document.getElementById('nav');
  const arrows   = Array.from(document.querySelectorAll('.nav-arrow'));
  const prevBtn  = document.getElementById('nav-prev');
  const nextBtn  = document.getElementById('nav-next');
  const toastEl  = document.getElementById('toast');
  let transient  = null;               // an app kept out of the bar, opened from settings — see open()

  const pref = (k, fallback) => (window.Prefs ? Prefs.get(k) : fallback);

  let index = 0;
  const apps = {};                     // name → { onShow, onDayChange, home }

  const viewOf = n => document.getElementById('view-' + n);
  const btnOf  = n => navEl.querySelector('.tab-b[data-app="' + n + '"]');

  /* ── The title band ─────────────────────────────────────────────────────────
     Each slide is a column: the home's .h-top as a fixed band at the top
     (its own status-bar padding), then .view-body — the scroll container —
     holding every screen. The band is not sticky inside the scroller, it is
     outside it, so it never moves with the rubber-band and content starts
     exactly under it. Done here, before the modules boot, so their scoped
     lookups still find the header inside the view and their scrollTop writes
     go to the body. A sub-screen hides the band (shell.css, :has) and brings
     its own .hd. */
  document.querySelectorAll('#track .view').forEach(v => {
    const body = document.createElement('div');
    body.className = 'view-body';
    while (v.firstChild) body.appendChild(v.firstChild);
    v.appendChild(body);
    const head = body.querySelector('#s-home > .h-top');
    if (head) v.insertBefore(head, body);
  });
  const bodyOf = n => { const v = viewOf(n); return v ? (v.querySelector('.view-body') || v) : null; };

  /* Order the slides and the tab buttons to match the preference, and hide the
     apps that are switched off. A hidden .view is display:none, so the flex
     track still moves by whole visible slides and index arithmetic holds. */
  function rebuild() {
    const want = (pref('apps', APPS) || APPS).filter(a => APPS.includes(a));
    TABS.length = 0;
    TABS.push(...want, 'settings');
    transient = null;
    /* Moving a node out of the document and back resets its scroll position,
       and this runs while the settings slide is scrolled down to the app list
       — every switch there used to throw the page back to the top. Remember
       where each slide was and put it back. */
    const scrolls = APPS.concat('settings').map(bodyOf).filter(Boolean).map(v => [v, v.scrollTop]);
    TABS.forEach(n => {
      const v = viewOf(n), b = btnOf(n);
      if (v) track.appendChild(v);
      if (b) navEl.appendChild(b);
    });
    APPS.forEach(a => {
      const on = want.includes(a);
      const v = viewOf(a), b = btnOf(a);
      if (v) v.classList.toggle('hidden', !on);
      if (b) {
        b.classList.toggle('hidden', !on);
        // a button that leaves the list leaves go()'s reach too: clear its state
        // here or a hidden tab stays "selected" forever
        if (!on) { b.classList.remove('on'); b.setAttribute('aria-selected', 'false'); }
      }
    });
    scrolls.forEach(([v, y]) => { if (y && v.scrollTop !== y) v.scrollTop = y; });
  }

  /* The apps switched off in the bar. Their slides are still in the track,
     hidden; the settings home lists them and open() shows one on demand. */
  function hidden() {
    const want = (pref('apps', APPS) || APPS);
    return APPS.filter(a => !want.includes(a));
  }

  // ── Dates ───────────────────────────────────────────────────────────────────
  /* The local calendar day as YYYY-MM-DD, and the one definition of it. Every
     module used to derive "today" its own way — DO and STORE through
     toISOString(), which is UTC and so a day behind until 01:00 or 02:00 in
     France, while Todoist due dates and LOG's records are local days. */
  function today(d = new Date()) {
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
  }

  /* A phone keeps ROOT open for days at a time. Each module captured "today"
     once at boot, so a tick made after midnight went into yesterday's record
     until someone reloaded. The shell re-checks the date whenever the page
     comes back, on every tab change and once a minute, and tells each module
     that registered an onDayChange hook. */
  let dayNow = today();
  function checkDay() {
    const d = today();
    if (d === dayNow) return false;
    dayNow = d;
    Object.values(apps).forEach(a => {
      if (a.onDayChange) { try { a.onDayChange(d); } catch (e) { console.error(e); } }
    });
    return true;
  }
  /* The same tick serves anything that has to notice the clock moving without
     being on screen — LOG's alert icon, which turns on at 10:00 and at 21:00.
     One timer, so there is one thing to keep in step rather than one per app. */
  function minute() {
    checkDay();
    Object.values(apps).forEach(a => {
      if (a.onMinute) { try { a.onMinute(); } catch (e) { console.error(e); } }
    });
  }
  document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'visible') minute(); });
  window.addEventListener('focus', minute);
  setInterval(minute, 60 * 1000);

  /* ── Asking, inside the app ─────────────────────────────────────────────────
     `window.confirm` and `window.prompt` are the *system's* dialogs, not this
     app's. They arrive in the platform's typeface at the top of the screen,
     they ignore every dial in Settings, and on a phone they read as the
     browser interrupting rather than as the app asking a question. One
     overlay does both jobs now, and it is a `.modal-overlay` so Escape and the
     keyboard suppression the shell already does for sheets reach it for free.

     The cost is that asking can no longer be synchronous. `Shell.confirm` takes
     *what to do* instead of answering:

         Shell.confirm('Clear the list?', () => { … })

     There is no return value to test, and every call site in every app was
     rewritten. With "confirm before clearing" off the callback runs straight
     away, which is exactly what that setting has always meant.

     The window.* fallbacks below are for a page whose overlay markup is missing
     — losing the action outright would be worse than a system box. */
  const askEl    = document.getElementById('ask');
  const askTitle = document.getElementById('ask-title');
  const askBody  = document.getElementById('ask-body');
  const askField = document.getElementById('ask-field');
  const askInput = document.getElementById('ask-input');
  const askYes   = document.getElementById('ask-yes');
  const askNo    = document.getElementById('ask-no');
  let askDone = null;

  /* One string in, a title and a body out: the question is the title and
     whatever follows it is the detail. Keeps every existing message readable
     without rewriting thirty of them. */
  function splitAsk(msg) {
    const s = String(msg == null ? '' : msg).trim();
    const nl = s.indexOf('\n');
    if (nl > 0) return { title: s.slice(0, nl).trim(), body: s.slice(nl).trim() };
    const q = s.indexOf('? ');
    if (q > 0) return { title: s.slice(0, q + 1), body: s.slice(q + 2).trim() };
    return { title: s, body: '' };
  }

  function askSettle(answer) {
    const fn = askDone;
    askDone = null;
    if (askEl) askEl.classList.add('hidden');
    if (fn) { try { fn(answer); } catch (e) { console.error(e); } }
  }

  function ask(o) {
    const opt = o || {};
    const hasInput = typeof opt.input === 'string';
    if (!askEl || !askYes || !askNo) {                 // no markup: do not lose the action
      const a = hasInput ? window.prompt(opt.title || '', opt.input)
                         : (window.confirm([opt.title, opt.body].filter(Boolean).join('\n\n')) || null);
      if (opt.done) opt.done(hasInput ? a : (a ? true : null));
      return;
    }
    askSettle(null);                                   // never stack two questions
    askDone = opt.done || null;
    if (askTitle) askTitle.textContent = opt.title || '';
    if (askBody)  { askBody.textContent = opt.body || ''; askBody.classList.toggle('hidden', !opt.body); }
    if (askField) askField.classList.toggle('hidden', !hasInput);
    if (askInput) {
      askInput.value = hasInput ? opt.input : '';
      askInput.placeholder = opt.placeholder || '';
    }
    askYes.textContent = opt.yes || (hasInput ? 'save' : 'confirm');
    askYes.classList.toggle('danger', opt.danger !== false && !hasInput);
    askNo.textContent = opt.no || 'cancel';
    askEl.classList.remove('hidden');
    // a text question wants the field; a yes/no wants neither field nor keyboard
    setTimeout(() => { try { (hasInput ? askInput : askYes).focus(); } catch {} }, 0);
  }

  if (askYes) askYes.addEventListener('click', () =>
    askSettle(askInput && askField && !askField.classList.contains('hidden') ? askInput.value : true));
  if (askNo)  askNo.addEventListener('click', () => askSettle(null));
  if (askEl)  askEl.addEventListener('keydown', e => {
    if (e.key === 'Enter' && askYes) { e.preventDefault(); askYes.click(); }
  });

  /* Honours Settings → behaviour → "confirm before clearing". Every reset and
     clear button in the eight apps routes here; the preference used to be read
     only by the settings view's own buttons, so turning it off did nothing
     where it mattered.

     Two shapes, because the call sites come in two shapes:

       Shell.confirm(msg, () => { … })   the common one — a button handler
       await Shell.confirm(msg)          inside something already async

     The second exists so an async function that asks part-way through does not
     have to be turned inside out; it answers true or false and nothing else. */
  function confirmAction(msg, onOk) {
    if (typeof onOk !== 'function') {
      return new Promise(resolve => {
        if (pref('confirmDestructive', true) === false) { resolve(true); return; }
        const { title, body } = splitAsk(msg);
        ask({ title, body, danger: true, done: a => resolve(!!a) });
      });
    }
    if (pref('confirmDestructive', true) === false) { onOk(); return; }
    const { title, body } = splitAsk(msg);
    ask({ title, body, danger: true, done: a => { if (a) onOk(); } });
  }
  /* The same overlay with a field in it — the four places that asked for a
     name or a date through window.prompt. Cancel answers null, never ''. */
  function promptAction(msg, value, onOk) {
    const { title, body } = splitAsk(msg);
    ask({ title, body, input: String(value == null ? '' : value),
          done: a => { if (a !== null && typeof onOk === 'function') onOk(a); } });
  }

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
  /* The slides are stacked, not side by side, and a tab change is a cross-fade
     rather than a page slide: the slide for `index` takes .cur (opaque, and the
     only one that takes a tap), the one it replaces keeps .leaving while it
     fades out. The incoming slide also gets .morph for a beat, which is what
     plays its title in — its wordmark on a home, or the header of whichever
     sub-screen it was left on. With animate off (boot, and whenever TABS
     changes shape underneath) the classes flip under #track.still, which is
     dropped again once the change has been flushed. */
  let curView = null, leaveTimer = null;
  /* `dir` is +1 moving right through the tabs and -1 moving left; the titles
     slide with it (the incoming one in from that side, the outgoing one out
     the other), which is the only part of the change that carries a
     direction — the pages themselves just cross-fade. */
  function show(animate, dir) {
    const next = viewOf(TABS[index]);
    if (!next) return;
    if (!animate) track.classList.add('still');
    document.querySelectorAll('#track .view.leaving').forEach(v => v.classList.remove('leaving'));
    const changed = next !== curView;
    const d = dir === -1 ? -1 : 1;
    if (curView && changed) {
      curView.style.setProperty('--dir', d);
      curView.classList.remove('cur');
      if (animate) curView.classList.add('leaving');
    }
    next.style.setProperty('--dir', d);
    next.classList.add('cur');
    if (animate && changed) { next.classList.remove('morph'); void next.offsetWidth; next.classList.add('morph'); }
    curView = next;
    if (!animate) { void track.offsetWidth; track.classList.remove('still'); }
    clearTimeout(leaveTimer);
    leaveTimer = setTimeout(() =>
      document.querySelectorAll('#track .view.leaving').forEach(v => v.classList.remove('leaving')), 900);
  }

  /* The tab buttons and arrows follow TABS by name, never by a cached list:
     open() and retire() change TABS under them. */
  function paintNav() {
    // on an app opened from settings, the settings button wears that app's
    // icon and lights up — tapping it still goes to the settings home
    const onT = !!transient && TABS[index] === transient;
    TABS.forEach((n, i) => {
      const b = btnOf(n); if (!b) return;
      const on = i === index || (n === 'settings' && onT);
      b.classList.toggle('on', on);
      b.setAttribute('aria-selected', on ? 'true' : 'false');
    });
    const sb = btnOf('settings');
    if (sb) {
      const use = sb.querySelector('use'), lbl = sb.querySelector('.tb-l');
      if (use) use.setAttribute('href', onT ? '#tab-' + transient : '#tab-set');
      if (lbl) lbl.textContent = onT ? transient : 'set';
      sb.setAttribute('aria-label', onT ? transient.toUpperCase() + ' · settings' : 'Settings');
    }
    if (nextBtn) nextBtn.disabled = index === TABS.length - 1;
    updateBack();
  }

  /* ── Back, on the left arrow ──────────────────────────────────────────────
     Inside an app's sub-screen — a checklist, the evening form, a settings
     category — the "← back" button sits top-left, the far corner of a phone.
     Whenever the current slide is showing a sub-screen that has one, the left
     arrow becomes that back button. A class change on any .scr is the signal,
     and one observer on the track sees every app's without per-app wiring. */
  function backTarget() {
    const v = viewOf(TABS[index]); if (!v) return null;
    const scr = v.querySelector('.scr.on');
    if (!scr || scr.id === 's-home') return null;
    return scr.querySelector('.hd-back');
  }
  function updateBack() {
    if (!prevBtn) return;
    const b = backTarget();
    prevBtn.classList.toggle('is-back', !!b);
    prevBtn.setAttribute('aria-label', b ? 'Back' : 'Previous tab');
    prevBtn.disabled = b ? false : index === 0;
  }
  new MutationObserver(updateBack).observe(track, { attributes: true, subtree: true, attributeFilter: ['class'] });

  /* Tapping the tab you are on goes to that app's home — its own hook where
     it registered one, else its sub-screen's back button pressed until there
     is none — and, already home, back to the top of the slide. */
  function homeOf(name) {
    const v = bodyOf(name);
    const wasHome = !backTarget();
    const app = apps[name];
    if (app && app.home) app.home();
    else for (let i = 0; i < 6 && backTarget(); i++) backTarget().click();
    if (wasHome && v) { if (typeof v.scrollTo === 'function') v.scrollTo({ top: 0, behavior: 'smooth' }); else v.scrollTop = 0; }
  }

  /* Show the slide for the current index with no transition. Used at boot and
     whenever TABS changes shape under the current slide. */
  function park() { show(false); }

  function go(name, opts = {}) {
    const i = typeof name === 'number' ? name : TABS.indexOf(name);
    if (i < 0 || i >= TABS.length) return;
    checkDay();
    const dir = i < index ? -1 : 1;      // which way the titles slide
    index = i;
    show(true, dir);
    paintNav();
    // leaving an app opened from settings: take its slide out again once the move has played
    if (transient && TABS[i] !== transient) setTimeout(retire, 340);
    showChrome();
    clearTimeout(chromeTimer);
    try { localStorage.setItem(TAB_KEY, TABS[i]); } catch {}
    if (!opts.silent) {
      const h = '#' + TABS[i];
      // replaceState throws on a file:// origin in some browsers; the tab still
      // works, it just cannot be linked to. A settings deep link
      // (#settings/data) keeps its panel segment.
      const keep = TABS[i] === 'settings' && location.hash.startsWith(h + '/');
      try { if (location.hash !== h && !keep) history.replaceState(null, '', h); } catch {}
    }
    const app = apps[TABS[i]];
    if (app && app.onShow) app.onShow();
  }

  /* An app switched off in the bar keeps its slide, hidden. The settings home
     lists those apps, and opening one puts its slide back into the track just
     before settings — no tab button — for as long as you stay on it. Leaving
     it retires the slide once the move has played out, so the bar and the
     track stay exactly what the app list says. */
  function open(name) {
    if (!APPS.includes(name)) return;
    if (TABS.includes(name)) { go(name); return; }
    if (transient) retire(true);
    const v = viewOf(name); if (!v) return;
    const cur = TABS[index];
    transient = name;
    TABS.splice(TABS.length - 1, 0, name);
    track.insertBefore(v, viewOf('settings'));
    v.classList.remove('hidden');
    // settings moved one slide to the right: re-park on it before animating away
    index = TABS.indexOf(cur);
    park();
    go(name);
  }
  function retire(force) {
    if (!transient) return;
    if (!force && TABS[index] === transient) return;   // came back to it before the timer fired
    const name = transient, cur = TABS[index];
    transient = null;
    const v = viewOf(name);
    TABS.splice(TABS.indexOf(name), 1);
    if (v) v.classList.add('hidden');
    index = Math.max(0, TABS.indexOf(cur === name ? 'settings' : cur));
    park();
    paintNav();
  }

  /* Every app's "settings" entry point routes here. */
  function settings(panel) {
    go('settings');
    if (panel === 'general') panel = 'data';   // the 1.0 name for the key panel
    if (window.SET && panel) SET.panel(panel);
  }

  /* Escape closes whatever sheet or modal is up. Each overlay's backdrop and
     cancel button already know how to close their own sheet, so the shell just
     presses them rather than knowing which module owns what. */
  function closeOverlays() {
    document.querySelectorAll('.sheet-back.on').forEach(b => b.click());
    document.querySelectorAll('.modal-overlay:not(.hidden) .modal-cancel').forEach(b => b.click());
  }

  function register(name, api) { apps[name] = api || {}; }

  /* A count on an app's tab button — DO uses it for what is still open today.
     Zero removes it. The span is created on first use so the markup does not
     have to know which apps count things. */
  function badge(name, n) {
    const b = btnOf(name); if (!b) return;
    let el = b.querySelector('.tb-badge');
    b.classList.toggle('has-badge', !!n);     // on the active tab the count replaces the icon
    if (!n) { if (el) el.remove(); return; }
    if (!el) { el = document.createElement('span'); el.className = 'tb-badge'; b.appendChild(el); }
    el.textContent = n > 99 ? '99+' : String(n);
  }

  /* A "!" in place of an app's icon — LOG uses it when a half of the day is
     still unwritten past its hour. Like badge(), this is the shell's to write:
     an app that reaches into the nav itself is an app that fights paintNav.
     The icon goes back to the app's own the moment the reason clears. */
  function alert(name, on, why) {
    const b = btnOf(name); if (!b) return;
    b.classList.toggle('has-alert', !!on);
    const use = b.querySelector('use');
    if (use) use.setAttribute('href', on ? '#tab-alert' : '#tab-' + name);
    b.setAttribute('aria-label', on ? `${name.toUpperCase()} · ${why || 'needs attention'}` : name.toUpperCase());
  }

  // bound by name, not position: the order is the user's to change
  Array.from(navEl.querySelectorAll('.tab-b')).forEach(b =>
    b.addEventListener('click', () => {
      if (window.Prefs) Prefs.tap();
      const name = b.dataset.app, cur = TABS[index];
      // the settings button wearing a hidden app's icon: back to the settings home
      if (name === 'settings' && transient && cur === transient) { if (window.SET) SET.home(); go('settings'); return; }
      if (name === cur) homeOf(name); else go(name);
    }));
  if (prevBtn) prevBtn.addEventListener('click', () => {
    const b = backTarget();
    if (b) { if (window.Prefs) Prefs.tap(); b.click(); } else go(index - 1);
  });
  if (nextBtn) nextBtn.addEventListener('click', () => go(index + 1));
  document.querySelectorAll('.view-body').forEach(watchScroll);

  // ── Swipe ───────────────────────────────────────────────────────────────────
  /* A horizontal drag picks the next or previous tab once it is far or fast
     enough; the slide itself does not follow the finger, since a tab change
     is a cross-fade. Vertical is left to the browser via touch-action:pan-y.
     A gesture is refused outright when a sheet or modal is up, and when it
     starts inside something that scrolls sideways itself (the .md preview
     panes), where a swipe means "read the rest of this line". */
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
  }, { passive: true });

  /* The slide does not follow the finger any more — a tab change is a
     cross-fade — so the drag only picks the next or previous tab once it is
     far enough or fast enough, and does nothing at all otherwise. */
  function endDrag() {
    if (!tracking) return;
    tracking = false;
    if (axis !== 'x') return;
    const w = viewport.clientWidth || 1;
    const speed = Math.abs(dx) / Math.max(1, Date.now() - st);
    const far = Math.abs(dx) > w * pref('swipeStrength', 0.22) || speed > FLICK;
    let next = index;
    if (far && dx < 0) next = Math.min(TABS.length - 1, index + 1);
    if (far && dx > 0) next = Math.max(0, index - 1);
    if (next !== index) { if (window.Prefs) Prefs.tap(); go(next); }
    dx = 0; axis = null;
  }
  track.addEventListener('touchend', endDrag, { passive: true });
  track.addEventListener('touchcancel', endDrag, { passive: true });

  /* #do … #settings select a tab; #settings/<panel> lands on one panel. */
  function hashTarget() {
    const [name, sub] = location.hash.replace('#', '').split('/');
    return { name: TABS.includes(name) ? name : null, sub: sub || null };
  }
  window.addEventListener('hashchange', () => {
    const { name, sub } = hashTarget();
    if (!name) { const raw = location.hash.replace('#', '').split('/')[0]; if (hidden().includes(raw)) open(raw); return; }
    if (TABS[index] !== name) go(name, { silent: true });
    if (name === 'settings' && sub && window.SET) SET.panel(sub);
  });

  /* ── Keyboard ─────────────────────────────────────────────────────────────
     ROOT is a phone app that also runs on a laptop, where five slides and no
     keyboard route is a real gap. Every binding is ignored while a field has
     focus, so typing never navigates, and while a sheet is up, because a sheet
     owns the keyboard — STORE's numpad reads digits, and "3" used to type a 3
     AND jump to PLAN. */
  document.addEventListener('keydown', e => {
    if (e.key === 'Escape' && overlayOpen()) { closeOverlays(); return; }
    if (!pref('keyboardNav', true)) return;
    if (e.metaKey || e.ctrlKey || e.altKey) return;
    if (overlayOpen()) return;
    const el = document.activeElement;
    if (el && el.closest && el.closest('input,textarea,select,[contenteditable]')) return;
    if (e.key === 'ArrowRight') { go(index + 1); e.preventDefault(); }
    else if (e.key === 'ArrowLeft') { go(index - 1); e.preventDefault(); }
    else if (e.key >= '1' && e.key <= '9') { go(+e.key - 1); e.preventDefault(); }
    /* "/" is search now. It used to open settings, which was a shortcut to a
       menu rather than to a thing; search reaches the same panels by name, and
       everything else besides. Without the search module it still opens
       settings, so the key is never dead. */
    else if (e.key === '/') { if (window.SEARCH) SEARCH.open(); else settings(); e.preventDefault(); }
  });

  /* Where the platform allows it (Android, installed), actually lock the
     orientation; everywhere else the CSS curtain does the job. */
  function lockPortrait() {
    try {
      if (!pref('lockPortrait', true) || !screen.orientation || !screen.orientation.lock) return;
      screen.orientation.lock('portrait').catch(() => {});
    } catch {}
  }
  lockPortrait();
  if (window.Prefs) Prefs.subscribe(k => {
    if (k !== 'lockPortrait' && k !== '*') return;
    if (pref('lockPortrait', true)) lockPortrait();
    else { try { screen.orientation && screen.orientation.unlock && screen.orientation.unlock(); } catch {} }
  });

  /* ── Decimal fields ────────────────────────────────────────────────────────
     A French keyboard's decimal keypad offers "," and iOS refuses a comma in a
     type=number field outright, so weight, sleep and km could not be typed on
     the phone at all. Those fields are type=text + inputmode=decimal now, and
     this one rule turns the comma into a dot as it is typed, keeping the caret
     where it was. Any module reading them gets a parseFloat-able string. */
  document.addEventListener('input', e => {
    const el = e.target;
    if (!el || el.tagName !== 'INPUT' || el.type !== 'text' || el.getAttribute('inputmode') !== 'decimal') return;
    if (!el.value.includes(',')) return;
    const pos = el.selectionStart;
    el.value = el.value.replace(/,/g, '.');
    try { if (pos !== null) el.setSelectionRange(pos, pos); } catch {}
  }, true);

  /* ── The numpad ────────────────────────────────────────────────────────────
     A field that only ever takes a number has no business raising the system
     keyboard: two thirds of it are letters, it covers half the screen, and it
     is the platform's chrome landing in the middle of the app. Every numeric
     field in ROOT is answered by one pad instead — a field that takes *text*
     still gets the system keyboard, which is the whole distinction.

     Which fields, and what a digit means in them:

       int        a count. `type=number`, or `inputmode=numeric`.
       decimal    a measurement. `inputmode=decimal`, or a fractional `step`.
       duration   hours and minutes typed as digits: 720 is 7h20m, and 7.33 is
                  what lands in the field, because that is what the .md wants.
       clock      a wall-clock time: 930 is 09:30.
       off        `data-pad="off"` — hands the field back to the keyboard.

     `data-pad` on the element wins over all of that; the two shapes that
     cannot be inferred (duration, clock) are declared in the markup.

     Suppressing the keyboard is `inputmode="none"`, set on pointerdown —
     before focus, which is the only moment early enough. The field's own
     inputmode is remembered in `data-pad-im`, so switching the pad off in
     settings gives every field its keyboard back without a reload. */
  const npadEl    = document.getElementById('npad');
  const npadBack  = document.getElementById('npad-back');
  const npadLabel = document.getElementById('npad-label');
  const npadVal   = document.getElementById('npad-val');
  const npadNote  = document.getElementById('npad-note');
  const PAD_KINDS = ['int', 'decimal', 'duration', 'clock'];

  let padTarget = null, padKind = 'int', padBuf = '', padFresh = true;

  function padKindOf(el) {
    if (!el || el.tagName !== 'INPUT' || el.disabled || el.readOnly) return null;
    const d = el.dataset.pad;
    if (d === 'off') return null;
    if (d && PAD_KINDS.includes(d)) return d;
    // once armed the live inputmode is "none"; the original is what classifies
    const im = el.dataset.padIm !== undefined ? el.dataset.padIm : (el.getAttribute('inputmode') || '');
    if (el.type === 'number') {
      const step = parseFloat(el.getAttribute('step'));
      return im === 'decimal' || (isFinite(step) && step % 1 !== 0) ? 'decimal' : 'int';
    }
    if (el.type === 'text' || el.type === 'tel') {
      if (im === 'decimal') return 'decimal';
      if (im === 'numeric') return 'int';
    }
    return null;
  }

  /* auto is the honest default: the system keyboard is only in the way where
     it is a *virtual* keyboard, and a laptop's number field is fine as it is. */
  function padWanted() {
    const m = pref('numpad', 'auto');
    if (m === 'off') return false;
    if (m === 'always') return true;
    try { return !!(window.matchMedia && window.matchMedia('(pointer:coarse)').matches); }
    catch { return false; }
  }

  function padArm(el) {
    const kind = padKindOf(el);
    if (!kind) return null;
    if (el.dataset.padIm === undefined) el.dataset.padIm = el.getAttribute('inputmode') || '';
    if (padWanted()) el.setAttribute('inputmode', 'none');
    else if (el.dataset.padIm) el.setAttribute('inputmode', el.dataset.padIm);
    else el.removeAttribute('inputmode');
    return kind;
  }

  /* What the field already holds, back as keystrokes — so opening the pad on a
     filled field continues it rather than starting again. */
  function padSeed(el, kind) {
    const v = String(el.value == null ? '' : el.value).trim().replace(',', '.');
    if (!v) return '';
    if (kind === 'duration') {
      const n = parseFloat(v);
      if (!isFinite(n) || n < 0) return '';
      const h = Math.floor(n), m = Math.round((n - h) * 60);
      return m ? String(h) + String(m).padStart(2, '0') : String(h);
    }
    if (kind === 'clock') return v.replace(/\D/g, '').slice(0, 4);
    if (kind === 'int')   return v.replace(/[^\d]/g, '').slice(0, 9);
    return v.replace(/[^\d.]/g, '').slice(0, 12);
  }

  /* The buffer, read two ways: what goes in the field, and what the pad says
     it means. They are the same for a plain number and deliberately different
     for a duration — you type 720 and the note says 7h20m · 7.33. */
  function padRead(kind, buf) {
    if (kind === 'duration') {
      const s = buf.replace(/\D/g, '');
      if (!s) return { value: '', read: '', note: 'hours then minutes — 720 is 7h20m' };
      const h = s.length <= 2 ? +s : +s.slice(0, -2);
      const m = s.length <= 2 ? 0  : +s.slice(-2);
      if (m > 59) return { value: '', read: s, note: 'minutes only go up to 59', bad: true };
      const dec = Math.round((h + m / 60) * 100) / 100;
      return { value: String(dec), read: `${h}h${String(m).padStart(2, '0')}m`,
               note: `saved as ${dec}` };
    }
    if (kind === 'clock') {
      const s = buf.replace(/\D/g, '');
      if (!s) return { value: '', read: '', note: 'hours then minutes — 930 is 09:30' };
      const p = s.padStart(3, '0');
      const h = +p.slice(0, p.length - 2), m = +p.slice(-2);
      if (h > 23 || m > 59) return { value: '', read: s, note: 'not a time of day', bad: true };
      const t = String(h).padStart(2, '0') + ':' + String(m).padStart(2, '0');
      return { value: t, read: t, note: '' };
    }
    return { value: buf, read: buf, note: '' };
  }

  /* The label the field is asking under, so the pad says what it is for. */
  function padLabelOf(el) {
    const box = el.closest('.f,.setting-row,.slider-row,.field,.ed-toggle,.ed-grid > div,.ed-pair > div');
    const lbl = box && box.querySelector('label,.lbl,.setting-lbl');
    const txt = (lbl && lbl.textContent) || el.getAttribute('aria-label') || el.placeholder || 'number';
    return String(txt).replace(/\s+/g, ' ').trim().slice(0, 42);
  }

  function padPaint() {
    const r = padRead(padKind, padBuf);
    if (npadVal) {
      npadVal.textContent = r.read || '0';
      npadVal.classList.toggle('empty', !r.read);
      npadVal.classList.toggle('bad', !!r.bad);
    }
    if (npadNote) npadNote.textContent = r.note || '';
    const dot = npadEl && npadEl.querySelector('[data-npad="."]');
    if (dot) dot.disabled = padKind !== 'decimal';
    return r;
  }

  function padCommit() {
    const r = padPaint();
    if (!padTarget || r.bad) return;
    padTarget.value = r.value;
    padTarget.dispatchEvent(new Event('input', { bubbles: true }));
  }

  function padOpen(el, kind) {
    padTarget = el; padKind = kind; padBuf = padSeed(el, kind); padFresh = true;
    if (npadLabel) npadLabel.textContent = padLabelOf(el);
    padPaint();
    if (npadBack) npadBack.classList.add('on');
    if (npadEl) npadEl.classList.add('on');
  }
  function padClose() {
    if (padTarget) { padTarget.dispatchEvent(new Event('change', { bubbles: true })); padTarget = null; }
    padBuf = '';
    if (npadBack) npadBack.classList.remove('on');
    if (npadEl) npadEl.classList.remove('on');
  }
  const padIsOpen = () => !!padTarget;

  /* The first digit after the pad opens *replaces* what was there, the way
     typing over a selected field does — you tap sleep to answer today's, not
     to append four digits to yesterday's, and on a capped field like a clock
     appending simply did nothing at all. Backspace and the dot are edits, not
     answers, so they keep the seeded value and continue from it. */
  function padKey(k) {
    if (!padTarget) return;
    if (k === 'back')       { padBuf = padBuf.slice(0, -1); padFresh = false; }
    else if (k === 'clear') { padBuf = ''; padFresh = false; }
    else if (k === '.') {
      padFresh = false;
      if (padKind !== 'decimal' || padBuf.includes('.')) return;
      padBuf = (padBuf || '0') + '.';
    } else {
      if (padFresh) { padBuf = ''; padFresh = false; }
      const cap = padKind === 'clock' ? 4 : padKind === 'duration' ? 4 : 9;
      if (padBuf.replace('.', '').length >= cap) return;
      padBuf = (padKind === 'clock' || padKind === 'duration' || padBuf !== '0') ? padBuf + k : k;
    }
    if (window.Prefs) Prefs.tap();
    padCommit();
  }

  /* pointerdown, not click: preventDefault here keeps the focus on the field
     while the pad is used, so the caret and the field's own styling stay put. */
  if (npadEl) {
    npadEl.addEventListener('pointerdown', e => { if (e.target.closest('[data-npad]')) e.preventDefault(); });
    npadEl.addEventListener('click', e => {
      const b = e.target.closest('[data-npad]');
      if (!b || b.disabled) return;
      if (b.dataset.npad === 'done') { const t = padTarget; padClose(); if (t) try { t.blur(); } catch {} return; }
      padKey(b.dataset.npad);
    });
  }
  if (npadBack) npadBack.addEventListener('click', padClose);

  // arm before focus, so the keyboard never gets its chance to come up
  document.addEventListener('pointerdown', e => {
    const el = e.target;
    if (el && el.tagName === 'INPUT') padArm(el);
  }, true);
  document.addEventListener('focusin', e => {
    const el = e.target;
    if (npadEl && el && el.closest && el.closest('#npad')) return;   // the pad's own buttons
    const kind = padArm(el);
    if (kind && padWanted()) padOpen(el, kind);
    else if (padIsOpen() && el !== padTarget) padClose();
  });
  /* Typed into directly — a physical keyboard, or a module writing the field.
     The buffer follows the field rather than fighting it. */
  document.addEventListener('input', e => {
    if (!padIsOpen() || e.target !== padTarget) return;
    const seeded = padRead(padKind, padBuf).value;
    if (String(padTarget.value) !== String(seeded)) { padBuf = padSeed(padTarget, padKind); padPaint(); }
  });
  /* Tapping something that takes no focus blurs the field without a focusin
     anywhere, which would leave the pad up over a field it no longer edits. */
  document.addEventListener('focusout', e => {
    if (e.target !== padTarget) return;
    setTimeout(() => { if (padIsOpen() && document.activeElement !== padTarget) padClose(); }, 0);
  });
  document.addEventListener('keydown', e => {
    if (!padIsOpen()) return;
    if (e.key === 'Escape') { const t = padTarget; padClose(); if (t) try { t.blur(); } catch {} }
  });
  // switching the pad off in settings hands every armed field its keyboard back
  if (window.Prefs) Prefs.subscribe(k => {
    if (k !== 'numpad' && k !== '*') return;
    if (!padWanted()) padClose();
    document.querySelectorAll('input[data-pad-im]').forEach(padArm);
  });

  // ── Boot: hash wins, then the start-tab preference, then the last tab ──────
  (function boot() {
    rebuild();
    let start = TABS[0];
    const fromHash = hashTarget().name;
    const want = pref('startTab', 'last');
    if (fromHash) start = fromHash;
    else if (want !== 'last' && TABS.includes(want)) start = want;
    else { try { const s = localStorage.getItem(TAB_KEY); if (TABS.includes(s)) start = s; } catch {} }
    // Land on the opening tab without animating in from DO: park the track there
    // with the transition off and flush it, so go()'s identical transform is a
    // no-op rather than something to animate towards.
    index = TABS.indexOf(start);
    park();
    go(start);
    // a link to an app that is out of the bar (#tend) still opens it
    const raw = location.hash.replace('#', '').split('/')[0];
    if (!fromHash && hidden().includes(raw)) open(raw);
  })();

  /* Turning auto-hide off should bring the chrome back immediately, not at the
     next scroll. */
  if (window.Prefs) Prefs.subscribe(k => {
    if (k === 'autoHideChrome' || k === '*') { if (pref('autoHideChrome', true) === false) showChrome(); }
    /* the app list changed: re-order the slides and stay on the same app if it
       is still shown, otherwise land on the first one */
    if (k === 'apps' || k === '*') {
      const cur = TABS[index];
      rebuild();
      go(TABS.includes(cur) ? cur : TABS[0]);
    }
  });

  /* What each app answers when search asks. Registered through register()'s
     `search` hook, so an app that has nothing to offer simply has none. */
  function searchApps(q) {
    const out = [];
    Object.keys(apps).forEach(name => {
      const fn = apps[name].search;
      if (!fn) return;
      // the app's own name is the row's kind unless the hook says otherwise
      try { (fn(q) || []).forEach(r => out.push(Object.assign({ app: name, kind: name }, r))); }
      catch (e) { console.error(e); }
    });
    return out;
  }

  return { toast, go, open, hidden, settings, register, badge, alert, showChrome, TABS, APPS,
           today, checkDay, confirm: confirmAction, prompt: promptAction, ask,
           hashTarget, searchApps,
           numpad: { open: padOpen, close: padClose, key: padKey, kindOf: padKindOf,
                     isOpen: padIsOpen, target: () => padTarget } };
})();
