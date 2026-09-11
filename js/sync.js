/* SYNC — the same day, written on two devices
   Two routes, deliberately not one.

   `todoist` carries the things that are not private: DO's routine progress,
   DAY's calendar, CREATE and TEND. It writes one task per day plus one for the
   records that are not day-scoped, in a section kept for it, and reads them
   back. Todoist is not a database; it is the only server that is already
   authenticated on both devices, which is the whole argument.

   `file` carries the things that are: LOG, TRACK and STORE. It writes a `.md`
   you move yourself and reads it back. Nothing about it touches the network.

   The two are the same machine underneath — the same payload shape, the same
   merge, the same overlap sheet. Only the transport differs.

   Sync is the *shell's*, not the apps'. Every module stays exactly as
   networkless as it was: this reads and writes localStorage keys and nothing
   in do.js, cal.js, create.js or tend.js knows it exists. That is what keeps
   CREATE's "the shelf has no network" true (§1) while its shelf still travels.

   Load after the app modules and before settings.js. */
window.SYNC = (function () {
  'use strict';

  const PROJECT = '04 | core';
  const SECTION = 'claude/codex';
  const TITLE   = 'ROOT · ';            // + <iso> | 'state'
  const STAMP   = 'root_sync_v1';       // last push/pull per route, and this device's id
  const BACKUP  = 'root_sync_undo_v1';  // the keys an import overwrote, for one step back
  const TOUCH   = 'root_sync_touch_v1'; // key → when this device last wrote it

  /* How far back "everything I have changed" reaches. A day, because that is
     the unit the request is in: whatever you did since yesterday should be on
     the other device. It is not a dial — a window you can shrink is a window
     that silently stops carrying things. `syncDays` is still the dial, and it
     is about *which days* travel, which is a different question. */
  const SINCE_MS = 24 * 60 * 60 * 1000;

  const readJSON = (k, fb = null) => { try { return JSON.parse(localStorage.getItem(k) || 'null') ?? fb; } catch { return fb; } };
  const writeJSON = (k, v) => { try { localStorage.setItem(k, JSON.stringify(v)); return true; } catch { return false; } };
  const clone = v => (v == null ? v : JSON.parse(JSON.stringify(v)));
  const same  = (a, b) => JSON.stringify(a ?? null) === JSON.stringify(b ?? null);

  /* Which keys belong to which route.

     `do_<iso>` is deliberately **today only**. DO deletes every other `do_`
     day on the first load of a new day and folds it into `do-stats-v1` first
     (do.js loadState/foldDay), so an imported past day would be counted into
     the tally a second time and then swept anyway. The history travels as the
     tally, which is the record that actually survives. */
  const ROUTES = {
    todoist: {
      label: 'todoist',
      apps:  'DO, DAY, CREATE and TEND',
      dayKey: iso => 'do_' + iso,
      todayOnly: true,
      slices: ['cal'],
      state: ['do-stats-v1', 'do_todoist_v1', 'travel_state_v2',
              'create_v1', 'tend.v3', 'tend_todoist_v1'],
    },
    file: {
      label: 'file',
      apps:  'LOG, TRACK and STORE',
      dayKey: iso => 'log_' + iso,
      todayOnly: false,
      slices: [],
      state: ['capTracker.v2', 'capTracker.weeks.v1', 'store_state_v1',
              'log-scale-v2', 'log-alert-seen-v1'],
    },
  };

  const CAL_KEY = 'cal_days_v1';

  /* ── The journal ──────────────────────────────────────────────────────────
     "Anything I do should be kept and then synced" needs an answer to *when*
     each key was last written, and no record carries one: a list is a list, not
     a stamped one. So every write to localStorage is noted here, key → moment,
     and that is what "changed in the last 24h" and "the most recent wins" are
     both computed from.

     It is done by wrapping `Storage.prototype.setItem` once rather than by
     asking each app to report its own writes. That is the same rule the rest of
     this file follows (§10: sync belongs to the shell): no module knows this
     exists, and a new app is carried by being written at all rather than by
     being added to a list.

     The index itself, the undo snapshot and the stamps are skipped — they are
     sync's own bookkeeping, and a journal that journals itself never settles. */
  const OURS = new Set([TOUCH, BACKUP, STAMP]);
  let touch = null;                     // the index, read once and kept
  let touchTimer = 0;

  function touchMap() {
    if (!touch) touch = readJSON(TOUCH, {}) || {};
    return touch;
  }
  function flushTouch() {
    touchTimer = 0;
    if (touch) writeJSON(TOUCH, touch);
  }
  /* Written on a timer because a burst of writes is one change to a person —
     ticking a routine is a dozen setItems — and an index rewritten a dozen
     times is a dozen serialisations of the whole map for one answer. */
  function note(key, at) {
    if (OURS.has(key)) return;
    touchMap()[key] = at || Date.now();
    if (!touchTimer) touchTimer = setTimeout(flushTouch, 1000);
  }

  (function journal() {
    const S = window.Storage && window.Storage.prototype;
    if (!S || S.__rootSyncJournal) return;
    const setItem = S.setItem, removeItem = S.removeItem;
    S.setItem = function (key, value) {
      setItem.call(this, key, value);
      if (this === window.localStorage) note(String(key));
    };
    /* A removal is a change like any other: a list emptied on this device has
       to beat the copy of it still sitting on the other one. */
    S.removeItem = function (key) {
      removeItem.call(this, key);
      if (this === window.localStorage) note(String(key));
    };
    S.__rootSyncJournal = true;
    /* The timer is a second at most, but a tab can close inside that second. */
    window.addEventListener('pagehide', () => { if (touchTimer) { clearTimeout(touchTimer); flushTouch(); } });
  })();

  const touchedAt = key => touchMap()[key] || 0;
  const changedSince = at => Object.keys(touchMap()).filter(k => touchMap()[k] >= at);

  /* ── What is allowed to travel ────────────────────────────────────────────
     Two questions, deliberately separate. **Which group** a key is in answers
     "do I want this carried at all"; **whether it is sensitive** answers "may
     it go over the route that leaves this device".

     The groups are the four the settings section offers. `apps` is everything
     an app wrote; `settings` is the content layer; `style` is the appearance
     engine; `system` is the shell's own bookkeeping — the tab you were on, the
     label colours, the sync stamps — which is the one group that is off by
     default, because it is the only one where the other device's answer is not
     better than yours. */
  const SYSTEM_KEYS = ['root_tab', 'root_theme', 'root_labels_v1', 'root_todoist_v1', STAMP, TOUCH, BACKUP];

  function groupOf(key) {
    const k = String(key);
    if (k === 'root_prefs_v1') return 'style';
    if (k === 'root_config_v1') return 'settings';
    if (SYSTEM_KEYS.includes(k)) return 'system';
    return 'apps';
  }

  /* Private in the sense §10 means it: a journal, a body of coursework and a
     shopping list are yours. These are the keys the Todoist route leaves
     behind while safe transfer is on — the switch is the old route split made
     into a dial rather than a new idea. */
  const SENSITIVE = [/^log_/, /^log-/, /^capTracker\./, /^store_state_/];
  const sensitive = key => SENSITIVE.some(re => re.test(String(key)));

  /* A key that is nothing but a Todoist key travels on no route, by no switch.
     §10: tokens never travel. A record that merely *contains* one still does,
     with the field scrubbed out of it on the way — dropping STORE's whole list
     to hide one field would be the wrong trade. */
  const TOKEN_ONLY = ['plan_token', 'root_todoist_v1'];

  const pref = (name, fallback) => (window.Prefs ? Prefs.get(name) : fallback);
  const groupOn = g => pref('sync' + g[0].toUpperCase() + g.slice(1),
                            g === 'system' ? false : true) !== false;
  const safeTransfer = () => pref('syncSafe', true) !== false;

  /* One rule, asked by everything that builds a payload. `route` is what makes
     it a rule rather than a preference: a file you move yourself can carry a
     journal; a task on someone else's server cannot, unless you say so. */
  function carries(route, key) {
    if (OURS.has(key) || TOKEN_ONLY.includes(key)) return false;
    if (!groupOn(groupOf(key))) return false;
    if (route === 'todoist' && safeTransfer() && sensitive(key)) return false;
    return true;
  }

  /* A Todoist key must never travel in a Todoist task, and has no business in
     a file either. Every record is walked on the way out and any field called
     `token` is dropped; on the way back in the local one is kept whatever
     arrives, so a scrubbed payload can never blank a working key. */
  function scrub(v) {
    if (Array.isArray(v)) return v.map(scrub);
    if (v && typeof v === 'object') {
      const out = {};
      Object.keys(v).forEach(k => { if (k !== 'token') out[k] = scrub(v[k]); });
      return out;
    }
    return v;
  }
  function keepToken(key, merged) {
    const local = readJSON(key);
    if (!local || typeof local !== 'object' || !merged || typeof merged !== 'object') return merged;
    if (typeof local.token === 'string') merged.token = local.token;
    if (local.todoist && typeof local.todoist.token === 'string') {
      merged.todoist = Object.assign({}, merged.todoist, { token: local.todoist.token });
    }
    return merged;
  }

  const deviceId = () => {
    const r = readJSON(STAMP, {}) || {};
    if (r.device) return r.device;
    r.device = Math.random().toString(36).slice(2, 8);
    writeJSON(STAMP, r);
    return r.device;
  };
  function stamp(route, what, extra) {
    const r = readJSON(STAMP, {}) || {};
    r[route] = Object.assign({}, r[route], { [what]: Date.now() }, extra || null);
    writeJSON(STAMP, r);
  }
  const routeStamp = route => (readJSON(STAMP, {}) || {})[route] || {};

  /* "When a device hits sync it should know immediately that the data it is
     importing has already been imported." The payload's id names its contents,
     so this is one string compare against the last one taken in — no merge
     planned, no twenty days walked, nothing written. A push records its own id
     too: a device obviously already holds what it just sent. */
  const alreadySeen = (route, id) => !!id && routeStamp(route).seen === id;
  function lastAt(route, what) {
    const r = readJSON(STAMP, {}) || {};
    return (r[route] && r[route][what]) || 0;
  }

  const iso = d => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
  function window_(days) {
    const out = [];
    const t = new Date();
    for (let i = -days; i <= days; i++) {
      const d = new Date(t.getFullYear(), t.getMonth(), t.getDate() + i);
      out.push(iso(d));
    }
    return out;
  }
  const span = () => (window.Prefs ? +Prefs.get('syncDays') : 10) || 10;

  /* ── Building what goes out ───────────────────────────────────────────── */

  const DAY_KEY = /^(do|log)_\d{4}-\d{2}-\d{2}$/;
  const isDayKey = k => DAY_KEY.test(String(k));

  function dayPayload(route, day) {
    const R = ROUTES[route];
    const out = {};
    const own = R.dayKey(day);
    if ((!R.todayOnly || day === Shell.today()) && carries(route, own)) {
      const rec = readJSON(own);
      if (rec) out.day = scrub(rec);
    }
    /* The *other* route's day, when the two are not being kept apart. Safe
       transfer is what keeps them apart, so with it off the Todoist route
       carries the logged day too — and it is still merged by LOG's own rules,
       because it is a LOG record wherever it travelled. The file route is the
       complete one and takes today's ticks the same way. */
    const guest = route === 'todoist' ? 'log_' + day
                : day === Shell.today() ? 'do_' + day : null;
    if (guest && carries(route, guest)) {
      const rec = readJSON(guest);
      if (rec) out[route === 'todoist' ? 'log' : 'do'] = scrub(rec);
    }
    if (R.slices.includes('cal') && carries(route, CAL_KEY)) {
      const cal = readJSON(CAL_KEY, {}) || {};
      if (cal.days && cal.days[day]) out.cal = scrub(cal.days[day]);
      if (cal.marks && cal.marks[day]) out.marks = scrub(cal.marks[day]);
    }
    return Object.keys(out).length ? out : null;
  }

  /* The route's own records, plus anything else this device has written since
     the window opened. The list is the floor rather than the whole answer: it
     is what a route has always carried, so an install with no journal yet syncs
     exactly what it used to, and the journal is what makes "anything I do"
     true for everything that came after.

     Day records and the calendar are left out on purpose — both travel under
     `days`, where they are merged a piece at a time instead of being chosen
     between whole. */
  function statePayload(route) {
    const out = {};
    const add = k => { const v = readJSON(k); if (v !== null) out[k] = scrub(v); };
    ROUTES[route].state.forEach(k => { if (carries(route, k)) add(k); });
    changedSince(Date.now() - SINCE_MS).forEach(k => {
      if (k in out || isDayKey(k) || k === CAL_KEY) return;
      if (carries(route, k)) add(k);
    });
    return out;
  }

  /* When this device last wrote each record that is travelling. It is what the
     other side compares against its own journal, and the whole of "if an info
     is overlapping, the most recent is used". */
  function touchPayload(state) {
    const out = {};
    Object.keys(state).forEach(k => { const t = touchedAt(k); if (t) out[k] = t; });
    return out;
  }

  /* A name for a payload's *contents* — everything except who wrote it and
     when. Two pushes of an unchanged board have the same id, which is how the
     other device knows it has already taken this in and how a pair of devices
     on a timer stop talking once they agree. */
  function digest(body) {
    const s = JSON.stringify({ days: body.days || {}, state: body.state || {},
                               today: body.today || null });
    let h = 5381;
    for (let i = 0; i < s.length; i++) h = ((h * 33) ^ s.charCodeAt(i)) >>> 0;
    return h.toString(36) + '-' + s.length.toString(36);
  }

  /* Today's private day, carried on the Todoist route on purpose.
     The split (§10) is about what the data *is*, and LOG is a journal — which
     is why it goes by file. But the file is a thing you have to remember to
     move, and the one day you actually want on the other device is the one you
     are in the middle of. So this is opt-in, off by default, and **today
     only**: it is the difference between "my morning is on the laptop" and
     "my journal lives on someone else's server".

     It rides under its own key so an importer that does not want it can drop
     it without unpicking the day, and so it is obvious in the task what it is. */
  function todayPrivate() {
    const iso = Shell.today();
    const out = {};
    const log = readJSON('log_' + iso);
    if (log) out.day = scrub(log);
    return Object.keys(out).length ? out : null;
  }

  function build(route) {
    const days = {};
    window_(span()).forEach(d => { const p = dayPayload(route, d); if (p) days[d] = p; });
    const body = { app: 'root', kind: 'sync', version: 1, route,
                   device: deviceId(), written: Date.now(), days, state: statePayload(route) };
    if (route === 'todoist' && window.Prefs && Prefs.get('syncTodayPrivate')) {
      const p = todayPrivate();
      if (p) { body.today = p; body.todayFor = Shell.today(); }
    }
    body.touch = touchPayload(body.state);
    body.since = SINCE_MS;
    body.id = digest(body);
    return body;
  }

  /* ── The merge ────────────────────────────────────────────────────────── */

  /* Every merge answers with the record to write plus what it did, so the
     caller can report "filled 3, updated 1" and hold the rest back for the
     overlap sheet. `note` is what the sheet shows; `conflict` is what it asks
     about. */
  const has = h => !!(h && h.saved);

  /* Union by value: a list nothing ever rewrites in place. `entries` are
     stamped journal lines, blocks and media are names. Their halves' `saved`
     is not the right question for them — setBlock() and setMedia() (log.js)
     write straight to storage without touching it, so a block ticked from DO
     on the other device would be dropped by a timestamp rule. */
  function unionBy(a, b, keyOf) {
    const out = Array.isArray(a) ? a.slice() : [];
    const seen = new Set(out.map(keyOf));
    (Array.isArray(b) ? b : []).forEach(x => { const k = keyOf(x); if (!seen.has(k)) { seen.add(k); out.push(x); } });
    return out;
  }
  const entryKey = e => `${e && e.time}|${e && e.text}`;
  const mediaKey = m => `${String((m && m.kind) || '').toLowerCase()}::${String((m && m.name) || '').trim().toLowerCase()}`;

  /* LOG's day, merged a half at a time.
     The two halves are written separately and stamped separately (saveMorning
     / saveEvening set m.saved and e.saved), which is exactly the grain the
     problem has: a morning written on the phone and an evening written on the
     desktop are not a conflict, they are one day arriving in two pieces. */
  function mergeLogDay(day, local, incoming) {
    const notes = [], conflicts = [];
    const out = clone(local) || clone(incoming) || null;
    if (!out) return { out: null, notes, conflicts };
    if (!local) { notes.push(`${day} · added`); }

    ['m', 'e'].forEach(half => {
      const L = local && local[half], I = incoming && incoming[half];
      const name = half === 'm' ? 'morning' : 'evening';
      if (!I) return;
      if (!has(I)) return;
      if (!has(L)) { out[half] = clone(I); if (local) notes.push(`${day} · ${name} filled in`); return; }
      if (same(L, I)) return;
      if (I.saved > L.saved) { out[half] = clone(I); notes.push(`${day} · ${name} updated`); return; }
      if (L.saved > I.saved) return;                       // ours is newer, leave it
      conflicts.push({ id: `${day}:${half}`, label: `LOG ${day} · ${name}`,
                       why: 'both were written and they differ',
                       apply: rec => { rec[half] = clone(I); } });
    });

    /* The three append-shaped lists, whatever the halves did. */
    if (incoming) {
      out.entries = unionBy(out.entries, incoming.entries, entryKey);
      out.e = out.e || {};
      const ie = incoming.e || {};
      out.e.blocks = unionBy(out.e.blocks, ie.blocks, String);
      out.e.blocksPlan = unionBy(out.e.blocksPlan, ie.blocksPlan, String);
      out.e.media = unionBy(out.e.media, ie.media, mediaKey);
    }
    return { out, notes, conflicts };
  }

  /* DO's day: a tick map per routine. A tick is a fact, so the two sides are
     unioned rather than compared — nothing here is ever "undone" by the other
     device, and an untick that loses to a tick is the safe way round. */
  function mergeDoDay(day, local, incoming) {
    const notes = [];
    if (!incoming) return { out: local, notes, conflicts: [] };
    if (!local) return { out: clone(incoming), notes: [`${day} · added`], conflicts: [] };
    const out = clone(local);
    let touched = false;
    Object.keys(incoming).forEach(routine => {
      const I = incoming[routine];
      if (!I || typeof I !== 'object') return;
      out[routine] = out[routine] || {};
      Object.keys(I).forEach(item => {
        if (I[item] && !out[routine][item]) { out[routine][item] = I[item]; touched = true; }
      });
    });
    if (touched) notes.push(`${day} · ticks filled in`);
    return { out, notes, conflicts: [] };
  }

  /* DAY's day. cal.js stamps every export with `written`, so this one has a
     real timestamp to compare and does not need to guess. */
  function mergeCalDay(day, local, incoming) {
    const notes = [], conflicts = [];
    if (!incoming) return { out: local, notes, conflicts };
    if (!local) return { out: clone(incoming), notes: [`DAY ${day} · added`], conflicts };
    if (same(local, incoming)) return { out: local, notes, conflicts };
    const lw = +local.written || 0, iw = +incoming.written || 0;
    if (iw > lw) return { out: clone(incoming), notes: [`DAY ${day} · updated`], conflicts };
    if (lw > iw) return { out: local, notes, conflicts };
    conflicts.push({ id: `cal:${day}`, label: `DAY ${day}`, why: 'both were written and they differ',
                     apply: null, value: clone(incoming) });
    return { out: local, notes, conflicts };
  }

  /* Everything that is not day-scoped. There is no timestamp inside these
     records and inventing one would be worse than asking: identical is a
     no-op, missing on one side is taken, and anything else is a question. */
  function mergeState(key, local, incoming, theirs, mine) {
    if (incoming === undefined) return { out: local, notes: [], conflicts: [] };
    if (same(local, incoming)) return { out: local, notes: [], conflicts: [] };
    if (local === null) return { out: clone(incoming), notes: [`${key} · added`], conflicts: [] };
    /* The journal is what turned this from a question into an answer. When both
       devices can say when they last wrote a record, the more recent one is the
       one you meant — that is the rule the request asked for, and it is also
       the only rule an automatic sync can have, since nobody is standing there
       to be asked. Without two timestamps it is still a question. */
    if (theirs && mine && theirs !== mine) {
      return theirs > mine
        ? { out: clone(incoming), notes: [`${key} · updated`], conflicts: [], at: theirs }
        : { out: local, notes: [], conflicts: [] };
    }
    return { out: local, notes: [],
             conflicts: [{ id: `state:${key}`, label: key, why: 'changed on both devices',
                           apply: null, value: clone(incoming) }] };
  }

  /* `do-stats-v1` is the one state record with a shape worth merging rather
     than choosing between: a map of day → tally. A day only one side has is
     taken; a day both have and disagree on is left alone, because the tally is
     derived and the local one matches the local days. */
  function mergeStats(local, incoming) {
    if (!incoming || typeof incoming !== 'object') return { out: local, notes: [], conflicts: [] };
    const out = clone(local) || { days: {} };
    out.days = out.days || {};
    let filled = 0;
    Object.keys(incoming.days || {}).forEach(d => {
      if (!(d in out.days)) { out.days[d] = clone(incoming.days[d]); filled++; }
    });
    return { out, notes: filled ? [`do-stats-v1 · ${filled} day${filled === 1 ? '' : 's'} filled in`] : [],
             conflicts: [] };
  }

  /* Plans the whole import without writing anything. The caller shows what it
     found, and only then is `commit` called. */
  function plan(route, payload) {
    const R = ROUTES[route];
    const writes = [];       // { key, value }
    const notes = [];
    const conflicts = [];
    const bases = {};        // key → the merged record a conflict's answer starts from
    const isLog = route === 'file';

    const calLocal = R.slices.includes('cal') ? (readJSON(CAL_KEY, {}) || {}) : null;
    const calOut = calLocal ? clone(calLocal) : null;
    let calTouched = false;

    /* One day record, merged by the rules of the app that owns it rather than
       by the rules of the route it arrived on. `day` is the route's own; `log`
       and `do` are the guests a route carries when the two are not being kept
       apart, and a guest is still a LOG day or a DO day. */
    const dayInto = (day, key, rec, kind) => {
      const local = readJSON(key);
      const r = kind === 'log' ? mergeLogDay(day, local, rec) : mergeDoDay(day, local, rec);
      notes.push(...r.notes);
      if (r.conflicts.length) bases[key] = clone(r.out);
      r.conflicts.forEach(c => conflicts.push(Object.assign({}, c, { key, applyTo: c.apply })));
      if (r.out && !same(r.out, local)) writes.push({ key, value: r.out });
    };

    Object.keys(payload.days || {}).forEach(day => {
      const inc = payload.days[day] || {};
      if (inc.log) dayInto(day, 'log_' + day, inc.log, 'log');
      if (inc.do)  dayInto(day, 'do_' + day, inc.do, 'do');
      if (inc.day) {
        const key = R.dayKey(day);
        const local = readJSON(key);
        const r = isLog ? mergeLogDay(day, local, inc.day) : mergeDoDay(day, local, inc.day);
        notes.push(...r.notes);
        /* A day can raise two conflicts — a morning and an evening — and both
           may be answered "theirs". Each carries only the change it is about
           and commit() layers them onto one record, so answering the second
           does not undo the first. `bases` is where that record starts. */
        if (r.conflicts.length) bases[key] = clone(r.out);
        r.conflicts.forEach(c => conflicts.push(Object.assign({}, c, { key, applyTo: c.apply })));
        if (r.out && !same(r.out, local)) writes.push({ key, value: r.out });
      }
      if (calOut && (inc.cal || inc.marks)) {
        calOut.days = calOut.days || {};
        calOut.marks = calOut.marks || {};
        if (inc.cal) {
          const r = mergeCalDay(day, calOut.days[day] || null, inc.cal);
          notes.push(...r.notes);
          r.conflicts.forEach(c => conflicts.push(Object.assign({}, c, { key: CAL_KEY, calDay: day })));
          if (r.out && !same(r.out, calOut.days[day])) { calOut.days[day] = r.out; calTouched = true; }
        }
        if (inc.marks) {
          const before = calOut.marks[day];
          const after = unionBy(before, inc.marks, m => `${m && m.at}|${m && m.name}`);
          if (!same(before, after)) { calOut.marks[day] = after; calTouched = true; }
        }
      }
    });

    /* Today's private day, if the push was asked to carry it. It is merged by
       LOG's own rules — per half, arrays unioned — and not by the Todoist
       route's, because it is a LOG record wherever it travelled. */
    if (payload.today && payload.today.day && payload.todayFor) {
      const key = 'log_' + payload.todayFor;
      const local = readJSON(key);
      const r = mergeLogDay(payload.todayFor, local, payload.today.day);
      notes.push(...r.notes);
      if (r.conflicts.length) bases[key] = clone(r.out);
      r.conflicts.forEach(c => conflicts.push(Object.assign({}, c, { key, applyTo: c.apply })));
      if (r.out && !same(r.out, local)) writes.push({ key, value: r.out });
    }

    /* Every record the payload actually carries, not a list kept here. That is
       the difference the journal makes: a key this build has never heard of —
       a new app's, or one an old device still writes — arrives, is merged by
       the same rule as the rest, and is not silently dropped for not being on
       a list. The route's own list is still merged when the payload is an old
       one that carries nothing else. */
    const stateKeys = [];
    const seenKey = new Set();
    [].concat(R.state, Object.keys(payload.state || {})).forEach(k => {
      if (seenKey.has(k) || isDayKey(k) || k === CAL_KEY || OURS.has(k)) return;
      seenKey.add(k); stateKeys.push(k);
    });

    const theirTouch = payload.touch || {};
    stateKeys.forEach(key => {
      const incoming = (payload.state || {})[key];
      const local = readJSON(key);
      const r = key === 'do-stats-v1'
        ? mergeStats(local, incoming)
        : mergeState(key, local, incoming, theirTouch[key], touchedAt(key));
      notes.push(...r.notes);
      r.conflicts.forEach(c => conflicts.push(Object.assign({}, c, { key })));
      if (r.out !== undefined && !same(r.out, local)) {
        writes.push({ key, value: keepToken(key, r.out), at: r.at || 0 });
      }
    });

    if (calTouched) writes.push({ key: CAL_KEY, value: calOut });
    return { writes, notes, conflicts, calOut, bases };
  }

  /* Writes the plan, plus whichever conflicts were answered "theirs". The keys
     it is about to overwrite are copied first, so one step back is possible —
     it is a snapshot, not an edit history, and the next import replaces it. */
  function commit(planned, taken) {
    const byKey = new Map(planned.writes.map(w => [w.key, clone(w.value)]));
    /* When each of those records was *authored*, where the merge knows. */
    const authored = new Map(planned.writes.filter(w => w.at).map(w => [w.key, w.at]));

    (taken || []).forEach(c => {
      if (c.calDay) {
        const cal = byKey.get(CAL_KEY) || clone(planned.calOut) || readJSON(CAL_KEY, {}) || {};
        cal.days = cal.days || {};
        cal.days[c.calDay] = c.value;
        byKey.set(CAL_KEY, cal);
        return;
      }
      /* Layered onto whatever is already staged for this key, so two answers
         about the same day both survive. */
      if (c.applyTo) {
        const rec = byKey.get(c.key) || clone((planned.bases || {})[c.key]) || readJSON(c.key) || {};
        c.applyTo(rec);
        byKey.set(c.key, rec);
        return;
      }
      byKey.set(c.key, keepToken(c.key, clone(c.value)));
    });

    const undo = {};
    byKey.forEach((_, key) => { undo[key] = localStorage.getItem(key); });
    writeJSON(BACKUP, { at: Date.now(), keys: undo });

    let n = 0;
    for (const [key, value] of byKey) {
      if (!writeJSON(key, value)) return { ok: false, written: n };
      /* The journal holds when a record was written, not when it arrived. A
         merge that took the other device's answer keeps the other device's
         moment, so the next sync between the two compares the same two numbers
         this one did instead of one that has just been moved forward. */
      if (authored.has(key)) note(key, authored.get(key));
      n++;
    }
    flushTouch();
    return { ok: true, written: n };
  }

  function canUndo() { const b = readJSON(BACKUP); return !!(b && b.keys && Object.keys(b.keys).length); }
  function undoImport() {
    const b = readJSON(BACKUP);
    if (!b || !b.keys) return false;
    Object.keys(b.keys).forEach(k => {
      const v = b.keys[k];
      if (v === null) localStorage.removeItem(k); else localStorage.setItem(k, v);
    });
    localStorage.removeItem(BACKUP);
    return true;
  }

  /* ── The Todoist transport ────────────────────────────────────────────── */

  /* A payload is fenced inside the description under a line of prose, so the
     task still reads as something in Todoist rather than as a wall of braces.
     The fence is what is parsed; the prose is free to change. */
  const FENCE = '```root';
  function wrap(kind, body) {
    return `ROOT sync · ${kind} · device ${body.device || deviceId()}\n` +
           `Written ${new Date(body.written).toISOString()}. Do not edit by hand.\n\n` +
           `${FENCE}\n${JSON.stringify(body)}\n\`\`\``;
  }
  function unwrap(text) {
    const s = String(text || '');
    const a = s.indexOf(FENCE);
    if (a < 0) return null;
    const b = s.indexOf('```', a + FENCE.length);
    if (b < 0) return null;
    try { return JSON.parse(s.slice(a + FENCE.length, b).trim()); } catch { return null; }
  }

  async function target() {
    const t = await Todoist.resolve(PROJECT, SECTION);
    return t;
  }

  /* One task per day plus one for the state, matched on their titles so a
     second export updates rather than duplicates. No due date: a dated task
     would turn a backup into twenty things to do today. */
  async function pushTodoist() {
    const t = await target();
    const existing = await Todoist.getAll('/tasks', { section_id: t.sectionId });
    const byTitle = new Map(existing.map(x => [String(x.content || '').trim(), x]));
    const body = build('todoist');

    const wanted = [];
    Object.keys(body.days).forEach(day => {
      wanted.push({ title: TITLE + day,
                    text: wrap(day, { app: 'root', kind: 'sync', version: 1, route: 'todoist',
                                      device: body.device, written: body.written,
                                      days: { [day]: body.days[day] }, state: {} }) });
    });
    wanted.push({ title: TITLE + 'state',
                  text: wrap('state', { app: 'root', kind: 'sync', version: 1, route: 'todoist',
                                        device: body.device, written: body.written,
                                        days: {}, state: body.state,
                                        today: body.today, todayFor: body.todayFor }) });

    /* Nothing new to say. The id names the contents, so an unchanged board is
       an unchanged payload, and a pair of devices on a timer stop writing to
       each other the moment they agree instead of trading the same bytes every
       few minutes. */
    if (routeStamp('todoist').sent === body.id && existing.length) {
      return { added: 0, updated: 0, total: wanted.length, unchanged: true };
    }

    let added = 0, updated = 0;
    for (const w of wanted) {
      const found = byTitle.get(w.title);
      if (found) {
        if (String(found.description || '') === w.text) continue;
        await Todoist.call('/tasks/' + found.id, { method: 'POST', body: JSON.stringify({ description: w.text }) });
        updated++;
      } else {
        await Todoist.call('/tasks', { method: 'POST', body: JSON.stringify({
          content: w.title, description: w.text, project_id: t.projectId, section_id: t.sectionId, priority: 1 }) });
        added++;
      }
    }
    stamp('todoist', 'push', { sent: body.id, seen: body.id });
    return { added, updated, total: wanted.length };
  }

  async function pullTodoist() {
    const t = await target();
    const tasks = await Todoist.getAll('/tasks', { section_id: t.sectionId });
    const keep = new Set(window_(span()));
    const merged = { app: 'root', kind: 'sync', version: 1, route: 'todoist',
                     device: '', written: 0, days: {}, state: {}, touch: {} };
    let found = 0;
    tasks.forEach(task => {
      const title = String(task.content || '').trim();
      if (!title.startsWith(TITLE)) return;
      const body = unwrap(task.description);
      if (!body || body.route !== 'todoist') return;
      found++;
      Object.keys(body.days || {}).forEach(d => { if (keep.has(d)) merged.days[d] = body.days[d]; });
      Object.assign(merged.state, body.state || {});
      /* Each record's own moment travels with it, so the newer-wins rule is
         asked about the record rather than about the task it arrived in. */
      Object.keys(body.touch || {}).forEach(k => {
        if (!merged.touch[k] || body.touch[k] > merged.touch[k]) merged.touch[k] = body.touch[k];
      });
      if (body.today && body.todayFor) { merged.today = body.today; merged.todayFor = body.todayFor; }
      if (+body.written > merged.written) { merged.written = +body.written; merged.device = body.device || ''; }
    });
    if (!found) throw new Error(`nothing to import — no "${TITLE.trim()}…" tasks in ${SECTION}`);
    merged.id = digest(merged);
    return merged;
  }

  /* ── One tap ──────────────────────────────────────────────────────────────
     "It should just know whether it is an import or an export." It is both, in
     the only order that is safe: take what is there, merge it, then send what
     this device holds afterwards. Anything else is a device deciding on its own
     that its copy is the good one.

     Three things make that safe enough to also run on a timer. An id says
     whether there is anything to take in at all. The merge settles overlaps by
     which record is newer rather than by asking. And a push whose contents have
     not changed is not sent. Left over are the ties — the same record written
     on both devices in the same moment — and those are the one thing an
     automatic run will not guess: it keeps this device's copy and leaves the
     question for a sync you are standing next to. */
  async function run(opts) {
    const auto_ = !!(opts && opts.auto);
    const out = { route: 'todoist', already: false, imported: 0, notes: [],
                  planned: null, payload: null, pushed: null };

    let payload = null;
    try { payload = await pullTodoist(); }
    catch (err) {
      /* An empty section is not a failure — it is the first sync of a pair. */
      if (!/nothing to import/.test(String((err && err.message) || ''))) throw err;
    }

    if (payload) {
      if (alreadySeen('todoist', payload.id)) out.already = true;
      else {
        const planned = plan('todoist', payload);
        if (planned.conflicts.length && !auto_) {
          out.planned = planned; out.payload = payload;
          return out;                                   // the caller asks, then finishes
        }
        const res = commit(planned, []);
        out.imported = res.written;
        out.notes = planned.notes;
        /* Only a run that had nothing left to ask about can call this payload
           taken in; one that quietly kept its own side of a tie has not. */
        if (!planned.conflicts.length) markPulled('todoist', payload.id);
        else markPulled('todoist');
      }
    }

    out.pushed = await pushTodoist();
    return out;
  }

  /* The refresh, on the dial. 0 is off, and off is the default — a sync that
     starts running the day you install it is one you never chose. Re-read every
     time round rather than captured, so the dial takes effect at the next tick
     instead of at the next reload. */
  let autoTimer = 0;
  function auto(onDone) {
    clearTimeout(autoTimer); autoTimer = 0;
    const mins = Math.max(0, +pref('syncEvery', 0) || 0);
    if (!mins) return;
    autoTimer = setTimeout(async () => {
      let res = null;
      try { res = await run({ auto: true }); } catch { /* offline, no key, no section */ }
      if (res && typeof onDone === 'function') { try { onDone(res); } catch {} }
      auto(onDone);
    }, mins * 60000);
  }

  /* ── The file transport ───────────────────────────────────────────────── */

  function fileText() {
    const body = build('file');
    const days = Object.keys(body.days).sort();
    return (
`# ROOT — ${ROUTES.file.apps}

Private data, moved by hand. Written ${new Date(body.written).toLocaleString()} on device \`${body.device}\`.
${days.length} day${days.length === 1 ? '' : 's'} (${days[0] || '—'} to ${days[days.length - 1] || '—'}) and ${Object.keys(body.state).length} records.

Import it under settings → data → sync. Everything below the fence is the data;
editing it by hand will not end well.

${FENCE}
${JSON.stringify(body)}
\`\`\`
`);
  }

  async function exportFile() {
    const text = fileText();
    const name = `root_private_${Shell.today()}.md`;
    try {
      const file = new File([text], name, { type: 'text/markdown' });
      if (navigator.canShare?.({ files: [file] })) { await navigator.share({ files: [file] }); stamp('file', 'push'); return name; }
      if (navigator.share) { await navigator.share({ title: name, text }); stamp('file', 'push'); return name; }
    } catch (err) { if (err && err.name === 'AbortError') return null; }
    const a = document.createElement('a');
    a.href = URL.createObjectURL(new Blob([text], { type: 'text/markdown' }));
    a.download = name; a.click();
    stamp('file', 'push');
    return name;
  }

  function parseFile(text) {
    const body = unwrap(text);
    if (!body || body.kind !== 'sync') throw new Error('not a ROOT sync file');
    if (body.route !== 'file') throw new Error(`that file is the ${body.route} route, not the private one`);
    return body;
  }

  /* ── Everything ───────────────────────────────────────────────────────────
     Not a route: the whole origin, every key, as one `.md`. The two routes
     above are for keeping two devices in step day to day; this is for moving
     to a new phone, or for a copy you keep somewhere safe.

     Deliberately unfiltered — the same rule the JSON backup follows: a backup
     that silently drops a key is worse than one carrying a few bytes too many.
     So it takes settings, content edits, every logged day, every list, the
     sync stamps, everything. It cannot carry LEARN's decks, which live in
     IndexedDB, and it says so on the page rather than only here.

     The one thing it *does* filter is the Todoist key, and only when asked:
     see `withToken`. A file that goes through a chat app should not carry it
     by default, and the key is two taps to paste back. */
  function allKeys() {
    const out = [];
    for (let i = 0; i < localStorage.length; i++) out.push(localStorage.key(i));
    return out.sort();
  }

  const TOKEN_KEYS = ['root_todoist_v1', 'do_todoist_v1', 'plan_token', 'store_state_v1'];

  function everythingBody(withToken) {
    const data = {};
    allKeys().forEach(k => {
      const raw = localStorage.getItem(k);
      if (withToken || !TOKEN_KEYS.includes(k)) { data[k] = raw; return; }
      /* A record that only *contains* a token keeps everything else — dropping
         STORE's whole state to hide one field would be the wrong trade. */
      let parsed = null;
      try { parsed = JSON.parse(raw); } catch {}
      if (parsed && typeof parsed === 'object') data[k] = JSON.stringify(scrub(parsed));
      else if (k !== 'plan_token') data[k] = raw;
    });
    return { app: 'root', kind: 'everything', version: 1,
             device: deviceId(), written: Date.now(), token: !!withToken, data };
  }

  function everythingText(withToken) {
    const body = everythingBody(withToken);
    const n = Object.keys(body.data).length;
    const bytes = JSON.stringify(body.data).length;
    return (
`# ROOT — everything

Every key this install holds: appearance, behaviour, content edits, logged days,
checklists, the plan queue and its history, the shopping list, the plants, the
curriculum, the calendar, the works in progress and the sync stamps.

- **${n} keys**, about ${Math.round(bytes / 1024)} KB.
- Written ${new Date(body.written).toLocaleString()} on device \`${body.device}\`.
- Todoist key: **${withToken ? 'included' : 'left out'}**.
- LEARN's decks are **not** in here — they live in IndexedDB. Re-import the
  \`.apkg\` on the other device.

Restore it under settings → data → everything. Restoring replaces every key the
file names and leaves the rest alone, then reloads.

${FENCE}
${JSON.stringify(body)}
\`\`\`
`);
  }

  async function exportEverything(withToken) {
    const text = everythingText(withToken);
    const name = `root_everything_${Shell.today()}.md`;
    try {
      const file = new File([text], name, { type: 'text/markdown' });
      if (navigator.canShare?.({ files: [file] })) { await navigator.share({ files: [file] }); return name; }
      if (navigator.share) { await navigator.share({ title: name, text }); return name; }
    } catch (err) { if (err && err.name === 'AbortError') return null; }
    const a = document.createElement('a');
    a.href = URL.createObjectURL(new Blob([text], { type: 'text/markdown' }));
    a.download = name; a.click();
    return name;
  }

  function parseEverything(text) {
    const body = unwrap(text);
    if (!body || body.kind !== 'everything') {
      throw new Error(body && body.kind === 'sync'
        ? 'that is a sync file — import it under sync, not here'
        : 'not a ROOT everything file');
    }
    if (!body.data || typeof body.data !== 'object') throw new Error('nothing in that file');
    return body;
  }

  /* Restoring is the one write in this module that is not a merge: a whole-app
     restore is meant to replace, and pretending otherwise would leave a
     half-and-half install nobody asked for. It still goes through the same
     snapshot, so it can be taken back once. */
  function restoreEverything(body) {
    const keys = Object.keys(body.data);
    const undo = {};
    keys.forEach(k => { undo[k] = localStorage.getItem(k); });
    writeJSON(BACKUP, { at: Date.now(), keys: undo });
    let n = 0;
    for (const k of keys) {
      const v = body.data[k];
      if (typeof v !== 'string') continue;
      try { localStorage.setItem(k, v); } catch { return { ok: false, written: n }; }
      n++;
    }
    return { ok: true, written: n };
  }

  function everythingCount(body) {
    const incoming = Object.keys(body.data);
    const here = new Set(allKeys());
    const over = incoming.filter(k => here.has(k)).length;
    return { total: incoming.length, over, fresh: incoming.length - over };
  }

  const markPulled = (route, id) => stamp(route, 'pull', id ? { seen: id } : null);

  /* Who to tell when an automatic run has done something — the settings panel,
     when it is open, so the section is not stale in front of you. The dial is
     re-read every tick, but a dial that has just been moved should not have to
     wait out the old interval first. */
  let autoDone = null;
  const onAuto = fn => { autoDone = fn; auto(autoDone); };
  if (window.Prefs && Prefs.subscribe) {
    Prefs.subscribe(k => { if (k === 'syncEvery' || k === '*') auto(autoDone); });
  }
  auto(null);

  return { ROUTES, build, plan, commit, canUndo, undoImport, markPulled, todayPrivate,
           run, auto, onAuto, alreadySeen, touchedAt, changedSince, carries, groupOf,
           since: () => SINCE_MS,
           exportEverything, parseEverything, restoreEverything, everythingCount, everythingText,
           pushTodoist, pullTodoist, exportFile, parseFile, fileText,
           lastAt, window: window_, span, unwrap, wrap, deviceId,
           _merge: { mergeLogDay, mergeDoDay, mergeCalDay, mergeState, mergeStats, unionBy, scrub } };
})();
