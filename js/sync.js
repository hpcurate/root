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
  function stamp(route, what) {
    const r = readJSON(STAMP, {}) || {};
    r[route] = Object.assign({}, r[route], { [what]: Date.now() });
    writeJSON(STAMP, r);
  }
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

  function dayPayload(route, day) {
    const R = ROUTES[route];
    const out = {};
    if (!R.todayOnly || day === Shell.today()) {
      const rec = readJSON(R.dayKey(day));
      if (rec) out.day = scrub(rec);
    }
    if (R.slices.includes('cal')) {
      const cal = readJSON(CAL_KEY, {}) || {};
      if (cal.days && cal.days[day]) out.cal = scrub(cal.days[day]);
      if (cal.marks && cal.marks[day]) out.marks = scrub(cal.marks[day]);
    }
    return Object.keys(out).length ? out : null;
  }

  function statePayload(route) {
    const out = {};
    ROUTES[route].state.forEach(k => {
      const v = readJSON(k);
      if (v !== null) out[k] = scrub(v);
    });
    return out;
  }

  function build(route) {
    const days = {};
    window_(span()).forEach(d => { const p = dayPayload(route, d); if (p) days[d] = p; });
    return { app: 'root', kind: 'sync', version: 1, route,
             device: deviceId(), written: Date.now(), days, state: statePayload(route) };
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
  function mergeState(key, local, incoming) {
    if (incoming === undefined) return { out: local, notes: [], conflicts: [] };
    if (same(local, incoming)) return { out: local, notes: [], conflicts: [] };
    if (local === null) return { out: clone(incoming), notes: [`${key} · added`], conflicts: [] };
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

    Object.keys(payload.days || {}).forEach(day => {
      const inc = payload.days[day] || {};
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

    R.state.forEach(key => {
      const incoming = (payload.state || {})[key];
      const local = readJSON(key);
      const r = key === 'do-stats-v1' ? mergeStats(local, incoming) : mergeState(key, local, incoming);
      notes.push(...r.notes);
      r.conflicts.forEach(c => conflicts.push(Object.assign({}, c, { key })));
      if (r.out !== undefined && !same(r.out, local)) writes.push({ key, value: keepToken(key, r.out) });
    });

    if (calTouched) writes.push({ key: CAL_KEY, value: calOut });
    return { writes, notes, conflicts, calOut, bases };
  }

  /* Writes the plan, plus whichever conflicts were answered "theirs". The keys
     it is about to overwrite are copied first, so one step back is possible —
     it is a snapshot, not an edit history, and the next import replaces it. */
  function commit(planned, taken) {
    const byKey = new Map(planned.writes.map(w => [w.key, clone(w.value)]));

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
      n++;
    }
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
                                        days: {}, state: body.state }) });

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
    stamp('todoist', 'push');
    return { added, updated, total: wanted.length };
  }

  async function pullTodoist() {
    const t = await target();
    const tasks = await Todoist.getAll('/tasks', { section_id: t.sectionId });
    const keep = new Set(window_(span()));
    const merged = { app: 'root', kind: 'sync', version: 1, route: 'todoist',
                     device: '', written: 0, days: {}, state: {} };
    let found = 0;
    tasks.forEach(task => {
      const title = String(task.content || '').trim();
      if (!title.startsWith(TITLE)) return;
      const body = unwrap(task.description);
      if (!body || body.route !== 'todoist') return;
      found++;
      Object.keys(body.days || {}).forEach(d => { if (keep.has(d)) merged.days[d] = body.days[d]; });
      Object.assign(merged.state, body.state || {});
      if (+body.written > merged.written) { merged.written = +body.written; merged.device = body.device || ''; }
    });
    if (!found) throw new Error(`nothing to import — no "${TITLE.trim()}…" tasks in ${SECTION}`);
    return merged;
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

  const markPulled = route => stamp(route, 'pull');

  return { ROUTES, build, plan, commit, canUndo, undoImport, markPulled,
           pushTodoist, pullTodoist, exportFile, parseFile, fileText,
           lastAt, window: window_, span, unwrap, wrap, deviceId,
           _merge: { mergeLogDay, mergeDoDay, mergeCalDay, mergeState, mergeStats, unionBy, scrub } };
})();
