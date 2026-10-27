/* qurOS — what the records mean.
   Entry  { id, kind:'dump'|'evening', day, at, end, edited, secs, src:'voice'|'typed'|'mixed',
            lang, topic, text, sent }
          topic: null | { sec, item?, label } (a map section or item) | { label } (free tag)
   Day    { date, bad, wake, bed, goals[], chain{}, hyg{}, focus{}, prep{}, scales{}, meals[],
            gym, touched, sent }
          goals[i] { id, text, state:'open'|'done'|'carried'|'dropped', from? }
          chain{stepId: 'full'|'min'}  — a minimum is done, the same as full
   kv     map, mapState{itemKey: 'partial'|'done'}, week:YYYY-Www → goals[], sends[]
   "Unsent" is anything changed since it last went out: an entry with no
   `sent` or edited after it, a day touched after its `sent`. */
(() => {
const Q = window.Q, { uid, slug, norm, dayOf, words } = Q.u;
const db = () => Q.db;

/* ── entries ── */
const entries = () => db().all('entries').sort((a, b) => b.at - a.at);
function saveEntry(o) {
  const have = db().get('entries', o.id);
  const now = Date.now();
  const e = Object.assign({}, have || {}, o, {
    day: (have && have.day) || dayOf(o.at || now),
    at: o.at || now,
    end: (have && have.end) || now,
    sent: have ? have.sent || null : null,
  });
  if (have) e.edited = now;
  e.words = words(e.text);
  return db().put('entries', e);
}
function editEntry(id, patch) {
  const e = db().get('entries', id);
  if (!e) return null;
  Object.assign(e, patch, { edited: Date.now() });
  if ('text' in patch) e.words = words(e.text);
  return db().put('entries', e);
}
const delEntry = id => { const e = db().get('entries', id); if (e) db().del('entries', id); return e; };
const unsentEntry = e => !e.sent || (e.edited || 0) > e.sent;

/* ── days ── */
const blankDay = date => ({ date, bad: false, wake: '', bed: '', goals: [], chain: {}, hyg: {}, focus: {}, prep: {},
  scales: {}, meals: [], gym: null, touched: 0, sent: 0 });
/* never stored until something is written to it */
function day(date) {
  const d = db().get('days', date);
  return d ? Object.assign(blankDay(date), d) : blankDay(date);
}
function saveDay(d) { d.touched = Date.now(); return db().put('days', d); }
function hasData(d) {
  if (!d) return false;
  const any = o => o && Object.values(o).some(Boolean);
  return !!(d.bad || d.wake || d.bed || (d.goals && d.goals.length) || any(d.chain) || any(d.hyg) || any(d.focus) ||
    any(d.prep) || any(d.scales) || (d.meals && d.meals.length) || gymLogged(d.gym));
}
const unsentDay = d => hasData(d) && (d.touched || 0) > (d.sent || 0);
function gymLogged(g) {
  if (!g) return false;
  return !!(g.warm || g.minDone || (g.ex || []).some(x => (x.sets || []).some(s => s.done)));
}

/* ── weekly goals ── */
const weekGoals = wk => db().kv('week:' + wk, []);
const setWeekGoals = (wk, list) => db().setKv('week:' + wk, list);

/* ── the map ───────────────────────────────────────────────────────────────
   A markdown file read as data: headings are sections, list items are the
   things to talk through, a heading that says "Tier N" sets the tier for it
   and what follows. States are filed under the item's key — section and item
   text, slugged — so re-importing an edited map keeps every state whose item
   was not reworded. `[x]` in the file marks done, `[~]` or `[/]` partial. */
function parseMap(text) {
  const lines = String(text || '').replace(/\r/g, '').split('\n');
  let title = '', tier = 99, cur = null;
  const sections = [], seed = {}, seen = new Set();
  const tierOf = s => { const m = /\btier\s*(\d{1,2})\b/i.exec(s); return m ? +m[1] : null; };
  lines.forEach(raw => {
    const h = /^(#{1,6})\s+(.*?)\s*#*\s*$/.exec(raw);
    if (h) {
      const t = h[2].trim(), tn = tierOf(t);
      if (h[1].length === 1 && !title && tn == null) { title = t; return; }
      if (tn != null) tier = tn;
      const name = t.replace(/[-–—:·|(]*\s*\btier\s*\d{1,2}\b\s*\)?\s*[-–—:·|]*/i, ' ').replace(/\s+/g, ' ').trim() || t;
      let key = slug(name);
      while (seen.has(key)) key += '-2';
      seen.add(key);
      cur = { key, title: name, tier: tn != null ? tn : tier, items: [] };
      sections.push(cur);
      return;
    }
    const li = /^\s*(?:[-*+]|\d+[.)])\s+(?:\[([ xX~/-])\]\s*)?(.+)$/.exec(raw);
    if (li && li[2].trim()) {
      if (!cur) { cur = { key: 'general', title: title || 'general', tier, items: [] }; sections.push(cur); seen.add('general'); }
      const itext = li[2].trim();
      const key = itemKey(cur.title, itext);
      if (cur.items.some(x => x.key === key)) return;
      cur.items.push({ key, text: itext });
      if (/[xX]/.test(li[1] || '')) seed[key] = 'done';
      else if (/[~/-]/.test(li[1] || '')) seed[key] = 'partial';
    }
  });
  const list = sections.filter(s => s.items.length);
  return list.length ? { map: { title: title || 'life dump map', sections: list, loaded: Date.now() }, seed } : null;
}
const itemKey = (secTitle, text) => slug(secTitle) + '/' + slug(text);
const map = () => db().kv('map', null);
const setMap = m => db().setKv('map', m);
const states = () => db().kv('mapState', {});
const itemState = k => states()[k] || 'empty';
function setItemState(k, s) {
  const st = Object.assign({}, states());
  if (s === 'empty') delete st[k]; else st[k] = s;
  db().setKv('mapState', st);
}
function loadMapText(text) {
  const r = parseMap(text);
  if (!r) return null;
  const old = map();
  setMap(r.map);
  /* the app's answer is newer than the file's: [x] only fills an item with no state yet */
  const st = Object.assign({}, states());
  Object.keys(r.seed).forEach(k => { if (!st[k]) st[k] = r.seed[k]; });
  db().setKv('mapState', st);
  return { map: r.map, replaced: !!old };
}
const sections = () => (map() ? map().sections.slice().sort((a, b) => a.tier - b.tier) : []);
function mapNext(skip = []) {
  for (const s of sections()) {
    const it = s.items.find(x => itemState(x.key) === 'empty' && !skip.includes(x.key));
    if (it) return { section: s, item: it };
  }
  return null;
}
function mapStats() {
  const all = sections().flatMap(s => s.items);
  const st = states();
  return { items: all.length, done: all.filter(x => st[x.key] === 'done').length,
    partial: all.filter(x => st[x.key] === 'partial').length };
}
function mapToMd() {
  const m = map();
  if (!m) return '';
  const st = states();
  const out = ['# ' + m.title, ''];
  sections().forEach(s => {
    out.push(`## ${s.title}${s.tier < 99 ? ` — Tier ${s.tier}` : ''}`);
    s.items.forEach(x => out.push(`- [${st[x.key] === 'done' ? 'x' : st[x.key] === 'partial' ? '~' : ' '}] ${x.text}`));
    out.push('');
  });
  return out.join('\n');
}
/* editing keeps states and dump topics pointing at the right item */
function mapEdit(fn) {
  const m = JSON.parse(JSON.stringify(map() || { title: 'life dump map', sections: [], loaded: Date.now() }));
  fn(m);
  setMap(m);
  return m;
}
function rekey(oldKey, newKey) {
  if (oldKey === newKey) return;
  const st = Object.assign({}, states());
  if (st[oldKey]) { st[newKey] = st[oldKey]; delete st[oldKey]; db().setKv('mapState', st); }
  db().all('entries').forEach(e => {
    if (e.topic && e.topic.item === oldKey) { e.topic = Object.assign({}, e.topic, { item: newKey }); db().put('entries', e); }
  });
}
const STARTER = `# Life dump map
## Now — Tier 1
- How my days actually go at the moment
- What is weighing on me this month
- What I want the next three months to look like
## Body — Tier 1
- Sleep
- Food and cooking
- Movement and the gym
## Work and study — Tier 2
- The CAP: where I am, what is hard
- Money
## People — Tier 2
- Floor
- Family
- Friends
## Music — Tier 2
- What I am making
- What gets in the way
## Story — Tier 3
- Childhood
- Turning points
- What I believe`;

/* ── topics ── */
function findItem(key) {
  for (const s of sections()) { const it = s.items.find(x => x.key === key); if (it) return { section: s, item: it }; }
  return null;
}
const findSection = key => sections().find(s => s.key === key) || null;
function topicFor(sec, item) {
  if (item) return { sec: sec.key, item: item.key, label: `${sec.title} › ${item.text}` };
  return { sec: sec.key, label: sec.title };
}
function topicLabel(t, kind) {
  if (kind === 'evening' && !t) return 'evening dump';
  if (!t) return 'free dump';
  if (t.item) { const f = findItem(t.item); if (f) return `${f.section.title} › ${f.item.text}`; }
  if (t.sec && !t.item) { const s = findSection(t.sec); if (s) return s.title; }
  return t.label || 'free dump';
}
/* what to talk through, shown under the topic while recording */
function topicPrompt(t, kind) {
  if (kind === 'evening') return ['how did today go?', 'what is still on your mind?', 'what is tomorrow\'s first step?'];
  if (!t || !t.sec || t.item) return [];
  const s = findSection(t.sec);
  return s ? s.items.filter(x => itemState(x.key) !== 'done').slice(0, 6).map(x => x.text + (itemState(x.key) === 'partial' ? ' (started)' : '')) : [];
}
const dumpsFor = key => db().all('entries').filter(e => e.topic && (e.topic.item === key || (e.topic.sec === key && !e.topic.item)));

Q.m = { entries, saveEntry, editEntry, delEntry, unsentEntry, blankDay, day, saveDay, hasData, unsentDay, gymLogged,
  weekGoals, setWeekGoals, parseMap, itemKey, map, setMap, states, itemState, setItemState, loadMapText, sections,
  mapNext, mapStats, mapToMd, mapEdit, rekey, STARTER, findItem, findSection, topicFor, topicLabel, topicPrompt, dumpsFor, norm };
})();
