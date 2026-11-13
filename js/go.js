/* GO — what was asked for from outside, when ROOT comes to the front (5.7.0)

   Hugo, 2026-11-13, of the phone's widgets (CORE): the home-screen ROOT is opened by a Shortcut, and "they don't open in the
   right tab". A Shortcut can't tell a web app where to go, and a link (5.6.0's #log/now, #quros/talk) only ever opens Safari's
   ROOT, never the one on the home screen. So what was asked travels the one way that is already open on both sides: Todoist.

   A tap on a widget tells CORE's laptop; the laptop writes it into one small task, "CORE · go", kept in ROOT's own sync
   section (04 | core › claude/codex) — its description is {"go":"log","at":<ms>}. When ROOT comes to the front (and at its
   start) this reads that task and, when the ask is fresh (two minutes) and not one it has done already, goes there through
   5.6.0's own links: log → #log/now, morning, evening, dump → #quros/talk, write → #quros/write.

   One read of Todoist each time ROOT comes to the front, none without a key. The task's id and the last ask done are kept in
   `root_go_v1`; nothing else is stored, the task is never written from here, and SYNC never reads it (its tasks are "ROOT · …").
   Load after the app modules (their links must be listening). */
window.GO = (function () {
  'use strict';
  const KEY = 'root_go_v1';
  const TITLE = 'CORE · go', PROJECT = '04 | core', SECTION = 'claude/codex';
  const FRESH = 2 * 60 * 1000;      // an ask older than this was for another moment
  const EVERY = 4000;               // coming to the front twice in a row reads once
  const LINK = { log: '#log/now', morning: '#log/morning', evening: '#log/evening', dump: '#quros/talk', write: '#quros/write' };

  const read  = () => { try { return JSON.parse(localStorage.getItem(KEY) || 'null') || {}; } catch { return {}; } };
  const write = o => { try { localStorage.setItem(KEY, JSON.stringify(o)); } catch {} };

  /* the task's description → { go, at }, or null when it isn't an ask */
  function parse(desc) {
    let o = null;
    try { o = JSON.parse(String(desc || '').trim()); } catch { return null; }
    return o && typeof o.go === 'string' && Object.prototype.hasOwnProperty.call(LINK, o.go) && Number.isFinite(+o.at) && +o.at > 0 ? { go: o.go, at: +o.at } : null;
  }
  /* is this ask one to act on now? fresh, and newer than the last one done here */
  const due = (o, done, now) => !!o && o.at > (done || 0) && Math.abs(now - o.at) <= FRESH;

  /* the task: by its id when it is known (one read), else found in the section once */
  async function find(st) {
    if (st.taskId) {
      try { const t = await Todoist.call('/tasks/' + encodeURIComponent(st.taskId)); if (t && t.content === TITLE && !t.checked && !t.is_deleted) return t; } catch {}
    }
    const r = await Todoist.resolve(PROJECT, SECTION);
    const list = await Todoist.getAll('/tasks', { section_id: r.sectionId });
    return list.find(t => t.content === TITLE) || null;
  }

  let busy = false, last = 0;
  async function look(now = Date.now()) {
    if (busy || now - last < EVERY || !Creds.token()) return null;
    busy = true; last = now;
    try {
      const st = read(), t = await find(st);
      if (!t) return null;
      if (String(t.id) !== st.taskId) write({ ...st, taskId: String(t.id) });
      const o = parse(t.description);
      if (!due(o, st.done, Date.now())) return null;
      write({ ...read(), taskId: String(t.id), done: o.at });
      location.hash = LINK[o.go];
      return o.go;
    } catch { return null; }
    finally { busy = false; }
  }

  document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'visible') look(); });
  look();

  return { look, parse, due, LINK, TITLE };
})();
