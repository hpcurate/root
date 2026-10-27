/* qurOS — BRAIN, the PC (ROOT 5.1; Hugo's r261027-qo06 "syncs with root mobile easily" · "todoist tasks integration (with new
   section), also used to sync"; his answer 5: "it would be "brain | dumps" in 04 | core").

   Inside ROOT only (?embed=root): each dump saved here is filed as a Todoist task in 04 | core › brain | dumps — its title the
   topic and the time, its description the words and one line `brain: {…}` (the record BRAIN reads), the rest of a long one in
   comments — and the life-dump map as one task, "brain · map", kept up to date. BRAIN on the PC takes the dumps into Hugo's
   memory in Obsidian and closes their tasks; the map task stays.

   ROOT's own Todoist token (root_todoist_v1, the same site). A dump goes once it has been quiet three minutes (a dump carried
   on with "add more" goes whole); it waits in a queue on this phone while offline or without a token, and goes when it can
   (every minute while qurOS is open, and when it comes back to the front). One sent is never sent again; nothing is ever
   deleted here. The section is made the first time, if it isn't there. */
(() => {
'use strict';
const Q = window.Q;
const BASE = 'https://api.todoist.com/api/v1';
const QUIET = 3 * 60e3, LIMIT = 15000;
const K = { q: 'brainQ', sent: 'brainSent', ids: 'brainIds', map: 'brainMap', last: 'brainLast' };
const kv = (k, d) => Q.db.kv(k, d), setKv = (k, v) => Q.db.setKv(k, v);
const norm = s => String(s || '').toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();
const on = () => !!Q.EMBED;
function token() { try { return (JSON.parse(localStorage.getItem('root_todoist_v1') || 'null') || {}).token || ''; } catch { return ''; } }

async function td(path, opts = {}) {
  const r = await fetch(BASE + path, { ...opts, headers: { Authorization: 'Bearer ' + token(), ...(opts.body ? { 'Content-Type': 'application/json' } : {}) } });
  if (!r.ok) throw new Error('Todoist ' + r.status);
  return r.status === 204 ? null : r.json();
}
const list = j => (Array.isArray(j) ? j : j && Array.isArray(j.results) ? j.results : []);
// 04 | core › brain | dumps — found once (and the section made when it isn't there), kept on this phone
async function where() {
  const have = kv(K.ids, null);
  if (have && have.project && have.section) return have;
  const proj = list(await td('/projects?limit=200')).find(p => norm(p.name) === norm('04 | core'));
  if (!proj) throw new Error('no "04 | core" project in Todoist');
  let sec = list(await td('/sections?limit=200&project_id=' + proj.id)).find(s => norm(s.name) === norm('brain | dumps'));
  if (!sec) sec = await td('/sections', { method: 'POST', body: JSON.stringify({ name: 'brain | dumps', project_id: proj.id }) });
  return setKv(K.ids, { project: proj.id, section: sec.id });
}

/* a dump as a task — the same shape as BRAIN's core/memory.js toTask (its tests read this form) */
const pad = n => String(n).padStart(2, '0');
const stampOf = ms => { const d = new Date(ms); return `${String(d.getFullYear()).slice(2)}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}`; };
function taskOf(e) {
  const label = e.kind === 'evening' && !e.topic ? 'evening dump' : Q.m.topicLabel(e.topic, e.kind);
  const text = String(e.text || '');
  const meta = { id: e.id, at: e.at, end: e.end, secs: e.secs || 0, words: e.words || 0, lang: e.lang || '', kind: e.kind || 'dump', src: 'phone',
    topic: e.topic ? { ...(e.topic.sec ? { sec: e.topic.sec } : {}), ...(e.topic.item ? { item: e.topic.item } : {}), label } : null };
  const rest = [];
  for (let i = LIMIT; i < text.length; i += LIMIT) rest.push(`brain: more ${rest.length + 1}\n` + text.slice(i, i + LIMIT));
  return { content: `${label} · ${stampOf(e.at)}`, description: `${text.slice(0, LIMIT)}\n\n---\nbrain: ${JSON.stringify(meta)}`, comments: rest };
}

/* ── the queue ── */
function queue(id) {
  if (!on() || !id) return;
  const q = kv(K.q, []), sent = kv(K.sent, []);
  if (sent.includes(id) || q.includes(id)) return;
  setKv(K.q, q.concat(id));
}
let busy = false, mapT = null;
async function flush() {
  if (!on() || busy || !navigator.onLine || !token()) return status();
  busy = true;
  try {
    const q = kv(K.q, []), keep = [], sent = kv(K.sent, []);
    let w = null, stop = false;
    for (const id of q) {
      if (stop) { keep.push(id); continue; }                                   // after a failure: the rest waits, in order
      const e = Q.db.get('entries', id);
      if (!e || !String(e.text || '').trim()) continue;                        // gone, or no words: dropped from the queue
      if (Date.now() - Math.max(e.end || 0, e.edited || 0, e.at || 0) < QUIET) { keep.push(id); continue; }   // still being said
      try {
        w = w || await where();
        const t = taskOf(e);
        const task = await td('/tasks', { method: 'POST', body: JSON.stringify({ content: t.content, description: t.description, project_id: w.project, section_id: w.section }) });
        for (const c of t.comments) await td('/comments', { method: 'POST', body: JSON.stringify({ task_id: task.id, content: c }) });
        sent.push(id);
        setKv(K.last, { at: Date.now(), n: (kv(K.last, {}).n || 0) + 1, said: '' });
      } catch (err) { keep.push(id); stop = true; setKv(K.last, { ...kv(K.last, {}), said: err.message }); }
    }
    setKv(K.q, keep);
    setKv(K.sent, sent.slice(-3000));
    if (kv(K.map, {}).dirty) await sendMap(w);
  } finally { busy = false; }
  return status();
}
/* the map: one task "brain · map", its description the map as qurOS writes it ([x] / [~] its states) */
function mapChanged() { if (!on()) return; setKv(K.map, { ...kv(K.map, {}), dirty: true }); clearTimeout(mapT); mapT = setTimeout(flush, 5000); }
async function sendMap(w) {
  const md = Q.m.mapToMd();
  if (!md) { setKv(K.map, { ...kv(K.map, {}), dirty: false }); return; }
  try {
    w = w || await where();
    const m = kv(K.map, {}), description = `${md}\n\n---\nbrain: {"kind":"map"}`;
    let id = m.task;
    if (id) { try { await td('/tasks/' + id, { method: 'POST', body: JSON.stringify({ description }) }); } catch { id = null; } }
    if (!id) {
      const open = list(await td('/tasks?limit=200&section_id=' + w.section)).find(t => t.content === 'brain · map');
      if (open) { id = open.id; await td('/tasks/' + id, { method: 'POST', body: JSON.stringify({ description }) }); }
      else id = (await td('/tasks', { method: 'POST', body: JSON.stringify({ content: 'brain · map', description, project_id: w.project, section_id: w.section }) })).id;
    }
    setKv(K.map, { task: id, dirty: false, at: Date.now() });
  } catch {}
}
function status() {
  const q = kv(K.q, []), last = kv(K.last, null);
  return { on: on(), token: !!token(), waiting: q.length, last, said: last && last.said || '' };
}

if (on()) {
  setInterval(flush, 60e3);
  document.addEventListener('visibilitychange', () => { if (!document.hidden) flush(); });
  window.addEventListener('online', () => flush());
  setTimeout(flush, 4000);
}
Q.brain = { queue, flush, mapChanged, status, taskOf, where };
})();
