/* qurOS — SEND: everything captured, as one file for a qurOS chat.
   The markdown export is the contract with the chat that processes it:
   front matter (schema, range, counts), the instruction block, the map's
   state, then one section per day — the day log, then its dumps in order.
   Keep its shape stable; `schema` goes up if it ever has to change.
   JSON is the same selection as data, and the full backup is every record. */
(() => {
const Q = window.Q, { $, esc, icon, today, addDays, fmtDay, fmtDayLong, hm, fmtNum, durWords, words, slept, fmtMins, weekKey } = Q.u;
const S = () => Q.settings.get();
const SCHEMA = 2;

let opt = { range: 'unsent', from: '', to: '', dumps: true, days: true, map: true, fmt: 'md' };
let expanded = false;

/* ── selection ── */
function select(o = opt) {
  const t = today();
  let inRange;
  if (o.range === 'today') inRange = d => d === t;
  else if (o.range === 'week') { const a = addDays(t, -6); inRange = d => d >= a && d <= t; }
  else if (o.range === 'custom') inRange = d => (!o.from || d >= o.from) && (!o.to || d <= o.to);
  else if (o.range === 'all') inRange = () => true;
  else inRange = null;   // unsent
  const entries = o.dumps === false ? [] : Q.db.all('entries')
    .filter(e => (inRange ? inRange(e.day) : Q.m.unsentEntry(e)) && e.text && e.text.trim())
    .sort((a, b) => a.at - b.at);
  const days = o.days === false ? [] : Q.db.all('days')
    .map(d => Q.m.day(d.date))
    .filter(d => Q.m.hasData(d) && (inRange ? inRange(d.date) : Q.m.unsentDay(d)))
    .sort((a, b) => (a.date < b.date ? -1 : 1));
  const dates = [...new Set(entries.map(e => e.day).concat(days.map(d => d.date)))].sort();
  return { entries, days, dates, from: dates[0] || '', to: dates[dates.length - 1] || '' };
}

/* ── markdown ── */
const SRC = { voice: 'voice', typed: 'typed', mixed: 'voice + typed' };
const STATE = { open: 'open', done: 'done', carried: 'carried to the next day', dropped: 'dropped' };
function dayLines(d) {
  const s = S(), L = [];
  const prevBed = Q.m.day(addDays(d.date, -1)).bed, sl = slept(prevBed, d.wake);
  const anchors = [d.wake ? `woke ${d.wake}${s.wakeTarget ? ` (target ${s.wakeTarget})` : ''}` : '', sl ? `slept ${fmtMins(sl)}` : '', d.bed ? `bed ${d.bed}` : ''].filter(Boolean);
  if (anchors.length) L.push(`- **Anchors:** ${anchors.join(' · ')}`);
  if (d.bad) L.push('- **Bad day:** yes — minimums only (neutral, logged for patterns)');
  const sc = Object.entries(d.scales || {}).filter(([, v]) => v);
  if (sc.length) L.push(`- **Check-in:** ${sc.map(([k, v]) => `${k} ${v}/5`).join(' · ')}`);
  const wg = Q.m.weekGoals(weekKey(d.date));
  if (d.goals.length) L.push(`- **Goals:** ${d.goals.map(g => `${g.text} — ${STATE[g.state] || g.state}${g.from ? ` (from ${fmtDay(g.from)})` : ''}`).join('; ')}`);
  if (wg.length && d.goals.length) L.push(`- **Week goals (${weekKey(d.date)}):** ${wg.map(g => `${g.text} — ${g.done ? 'done' : 'open'}`).join('; ')}`);
  const ch = s.chain.filter(c => d.chain[c.id]);
  if (ch.length) L.push(`- **Morning chain:** ${s.chain.map(c => `${c.name} ${d.chain[c.id] === 'full' ? '✓ full' : d.chain[c.id] === 'min' ? '✓ minimum' : d.chain[c.id] === 'skip' ? '— not today' : '—'}`).join(' · ')}`);
  const hy = s.hygiene.filter(h => d.hyg[h.id]);
  if (hy.length) L.push(`- **Hygiene:** ${hy.map(h => h.name).join(', ')} (${hy.length} of ${s.hygiene.length})`);
  const fo = Object.entries(d.focus || {}).filter(([, n]) => n);
  if (fo.length) L.push(`- **Focus (pomodoros):** ${fo.map(([k, n]) => `${k} ${n}`).join(' · ')} — ${fo.reduce((a, [, n]) => a + n, 0)} total`);
  if (Q.m.gymLogged(d.gym)) {
    const g = d.gym;
    L.push(`- **Gym:** ${g.plan === 'min' ? `minimum session${g.minDone ? ` (${s.program.min})` : ''}` : `day ${g.plan}${g.warm ? ' · warm-up ✓' : ''}`}`);
    (g.ex || []).forEach(x => {
      const done = x.sets.filter(st => st.done);
      if (done.length) L.push(`  - ${x.name}: ${done.map(st => x.unit === 's' ? `${st.r} s` : `${st.w ? st.w + ' ' + s.unit + ' × ' : ''}${st.r}`).join(', ')}`);
    });
    if (g.note) L.push(`  - note: ${g.note.replace(/\s+/g, ' ').trim()}`);
  }
  if (d.meals.length) L.push(`- **Meals:** ${d.meals.map(m => (m.slot ? m.slot + ': ' : '') + m.text).join(' · ')}`);
  const pr = s.prep.filter(p => d.prep[p.id]);
  if (pr.length) L.push(`- **Evening prep:** ${pr.map(p => p.name).join(', ')}`);
  return L;
}
function entryHead(e) {
  const bits = [hm(e.at), e.kind === 'evening' ? 'evening dump' : 'dump', Q.m.topicLabel(e.topic, e.kind) !== 'free dump' && e.kind !== 'evening' ? 'topic: ' + Q.m.topicLabel(e.topic, e.kind) : e.kind === 'evening' && e.topic ? 'topic: ' + Q.m.topicLabel(e.topic) : '',
    e.secs ? durWords(e.secs) : '', SRC[e.src] || '', e.lang || '', `${fmtNum(e.words || words(e.text))} words`,
    e.sent && (e.edited || 0) > e.sent ? 'updated since the last export' : ''];
  return `#### ${bits.filter(Boolean).join(' · ')}`;
}
function mapLines() {
  const m = Q.m.map();
  if (!m) return [];
  const st = Q.m.states(), stats = Q.m.mapStats(), nx = Q.m.mapNext();
  const L = ['## Life-dump map', '', `${stats.done} of ${stats.items} items covered, ${stats.partial} started.${nx ? ` Next untouched: **${nx.section.title} › ${nx.item.text}**.` : ''}`, ''];
  Q.m.sections().forEach(s => {
    const by = k => s.items.filter(x => (st[x.key] || 'empty') === k).map(x => x.text);
    const [d, p, e] = [by('done'), by('partial'), by('empty')];
    L.push(`- ${s.tier < 99 ? `Tier ${s.tier} · ` : ''}**${s.title}** — ${d.length}/${s.items.length} covered${p.length ? ` · started: ${p.join(', ')}` : ''}${e.length ? ` · untouched: ${e.join(', ')}` : ''}`);
  });
  L.push('');
  return L;
}
function markdown(sel = select(), o = opt) {
  const t = today();
  const nWords = sel.entries.reduce((a, e) => a + (e.words || words(e.text)), 0);
  const secs = sel.entries.reduce((a, e) => a + (e.secs || 0), 0);
  const span = !sel.from ? fmtDay(t) : sel.from === sel.to ? fmtDayLong(sel.from) : `${fmtDayLong(sel.from)} → ${fmtDayLong(sel.to)}`;
  const L = [
    '---',
    'app: qurOS',
    `schema: ${SCHEMA}`,
    `exported: ${new Date().toISOString()}`,
    `range: ${o.range === 'unsent' ? 'everything new since the last export' : o.range}${sel.from ? ` (${sel.from} → ${sel.to})` : ''}`,
    `dumps: ${sel.entries.length}`,
    `words: ${nWords}`,
    `day_logs: ${sel.days.length}`,
    '---',
    '',
    `# qurOS export — ${span}`,
    '',
    ...S().prompt.split('\n').map(l => '> ' + l),
    '',
    `**In this export:** ${sel.entries.length} dump${sel.entries.length === 1 ? '' : 's'} (${fmtNum(nWords)} words${secs ? `, ${durWords(secs)} of talking` : ''}) · ${sel.days.length} day log${sel.days.length === 1 ? '' : 's'}`,
    '',
  ];
  if (o.map !== false) L.push(...mapLines());
  sel.dates.forEach(date => {
    const d = sel.days.find(x => x.date === date);
    const es = sel.entries.filter(e => e.day === date);
    L.push(`## ${fmtDayLong(date)}`, '');
    if (d) { L.push('### Day log', ...dayLines(d), ''); }
    if (es.length) {
      L.push('### Dumps', '');
      es.forEach(e => L.push(entryHead(e), '', e.text.trim(), ''));
    }
  });
  if (!sel.dates.length) L.push('_Nothing new since the last export._', '');
  return L.join('\n').replace(/\n{3,}/g, '\n\n');
}
function entryMd(e) {
  return [`# qurOS dump — ${fmtDayLong(e.day)}`, '', entryHead(e), '', e.text.trim(), ''].join('\n');
}
function json(sel = select(), o = opt) {
  return JSON.stringify({
    app: 'qurOS', schema: SCHEMA, kind: 'export', exported: new Date().toISOString(), range: o.range, from: sel.from, to: sel.to,
    instructions: S().prompt,
    map: o.map !== false && Q.m.map() ? { title: Q.m.map().title, sections: Q.m.sections().map(s => ({ title: s.title, tier: s.tier < 99 ? s.tier : null, items: s.items.map(x => ({ text: x.text, state: Q.m.itemState(x.key) })) })) } : undefined,
    days: sel.days.map(d => Object.assign({}, d, { touched: undefined, sent: undefined })),
    dumps: sel.entries.map(e => ({ id: e.id, day: e.day, at: new Date(e.at).toISOString(), kind: e.kind, topic: Q.m.topicLabel(e.topic, e.kind), secs: e.secs, src: e.src, lang: e.lang, words: e.words, text: e.text })),
  }, null, 2);
}
const fileName = (sel, fmt) => `qurOS-${sel.from && sel.to && sel.from !== sel.to ? sel.from + '_' + sel.to : sel.from || today()}.${fmt === 'json' ? 'json' : 'md'}`;

/* ── marking sent ── */
function markSent(sel, how, body) {
  const now = Date.now();
  const undo = { entries: sel.entries.map(e => [e.id, e.sent]), days: sel.days.map(d => [d.date, d.sent]) };
  sel.entries.forEach(e => { const x = Q.db.get('entries', e.id); if (x) { x.sent = now; Q.db.put('entries', x); } });
  sel.days.forEach(d => { const x = Q.db.get('days', d.date); if (x) { x.sent = now; Q.db.put('days', x); } });
  const sends = Q.db.kv('sends', []).slice(0, 29);
  sends.unshift({ id: 's' + now, at: now, how, from: sel.from, to: sel.to, dumps: sel.entries.length, days: sel.days.length,
    words: sel.entries.reduce((a, e) => a + (e.words || 0), 0), name: fileName(sel, opt.fmt), body: body.length < 400000 ? body : '' });
  Q.db.setKv('sends', sends);
  Q.app.refresh();
  return () => {
    undo.entries.forEach(([id, s]) => { const x = Q.db.get('entries', id); if (x) { x.sent = s; Q.db.put('entries', x); } });
    undo.days.forEach(([date, s]) => { const x = Q.db.get('days', date); if (x) { x.sent = s; Q.db.put('days', x); } });
    Q.db.setKv('sends', Q.db.kv('sends', []).filter(x => x.at !== now));
    Q.app.refresh();
  };
}
const unsentCount = () => Q.db.all('entries').filter(Q.m.unsentEntry).length + Q.db.all('days').filter(d => Q.m.unsentDay(Q.m.day(d.date))).length;

/* ── the tab ── */
function render() {
  const el = $('#v-send');
  if (!el) return;
  const sel = select();
  const body = opt.fmt === 'json' ? json(sel) : markdown(sel);
  const nWords = sel.entries.reduce((a, e) => a + (e.words || 0), 0);
  const sends = Q.db.kv('sends', []);
  const empty = !sel.entries.length && !sel.days.length;
  el.innerHTML = `
  <header class="top">
    <div class="top-row"><span class="top-meta">${sends.length ? `last export ${fmtDay(Q.u.dayOf(sends[0].at))} ${hm(sends[0].at)}` : 'nothing exported yet'}</span>
      <button class="icon-btn" type="button" data-a="settings" aria-label="settings">${icon('gear')}</button></div>
    <h1 class="wm">Send<em>.</em></h1>
    <p class="top-sub">one file for qurOS — share it straight into the chat, or copy and paste.</p>
  </header>

  <div class="send-stats">
    <div><b>${sel.entries.length}</b><span>dump${sel.entries.length === 1 ? '' : 's'}</span></div>
    <div><b>${fmtNum(nWords)}</b><span>words</span></div>
    <div><b>${sel.days.length}</b><span>day log${sel.days.length === 1 ? '' : 's'}</span></div>
  </div>

  <div class="sec-h">what<em>${opt.range === 'unsent' ? 'everything new since the last export' : ''}</em></div>
  <div class="seg" data-a="range">${[['unsent', 'new'], ['today', 'today'], ['week', '7 days'], ['all', 'all'], ['custom', 'dates']].map(([k, l]) =>
    `<button type="button" data-v="${k}" class="${opt.range === k ? 'on' : ''}">${l}</button>`).join('')}</div>
  ${opt.range === 'custom' ? `<div class="anchors" style="margin-top:10px"><label class="anchor"><span class="label">from</span><input class="field" type="date" data-o="from" value="${esc(opt.from)}"></label>
    <label class="anchor"><span class="label">to</span><input class="field" type="date" data-o="to" value="${esc(opt.to)}"></label></div>` : ''}
  <div class="card" style="margin-top:12px;padding:4px 14px">
    ${[['dumps', 'dumps', 'what you said or wrote'], ['days', 'day logs', 'anchors, chain, goals, focus, gym, meals'], ['map', 'map status', 'what is covered, what is next']].map(([k, l, s]) =>
      `<div class="opt-r"><span>${l}<small>${s}</small></span><button class="toggle ${opt[k] !== false ? 'on' : ''}" type="button" data-a="opt" data-k="${k}" aria-pressed="${opt[k] !== false}"></button></div>`).join('')}
    <div class="opt-r"><span>format<small>${opt.fmt === 'md' ? 'markdown reads best in a chat' : 'JSON for tools and scripts'}</small></span>
      <div class="seg" data-a="fmt"><button type="button" data-v="md" class="${opt.fmt === 'md' ? 'on' : ''}">.md</button><button type="button" data-v="json" class="${opt.fmt === 'json' ? 'on' : ''}">.json</button></div></div>
  </div>

  <div class="send-acts">
    <button class="btn go" type="button" data-a="share" ${empty ? 'disabled' : ''}>${icon('share')}share</button>
    <button class="btn" type="button" data-a="copy" ${empty ? 'disabled' : ''}>${icon('copy')}copy</button>
    <button class="btn" type="button" data-a="file" ${empty ? 'disabled' : ''}>${icon('down')}file</button>
  </div>
  <p class="fine">${empty ? (opt.range === 'unsent' ? 'Nothing new since the last export.' : 'Nothing in that range.') : 'Sharing marks these as sent, with an undo. After a copy or a file you choose.'}</p>

  <div class="sec-h">preview<em>${fmtNum(body.length)} characters</em><button class="sec-a" type="button" data-a="expand">${expanded ? 'less' : 'all'}</button></div>
  <pre class="preview ${expanded ? 'open' : ''}">${esc(expanded ? body : body.slice(0, 4000) + (body.length > 4000 ? '\n…' : ''))}</pre>

  ${sends.length ? `<div class="sec-h">sent<em>${sends.length}</em></div>
    ${sends.slice(0, 10).map(x => `<div class="row"><div class="row-m"><div class="row-t">${fmtDay(Q.u.dayOf(x.at))} ${hm(x.at)} · ${x.how}</div>
      <div class="row-s">${x.dumps} dumps · ${fmtNum(x.words || 0)} words · ${x.days} day logs${x.from ? ` · ${x.from === x.to ? x.from : x.from + ' → ' + x.to}` : ''}</div></div>
      ${x.body ? `<button class="icon-btn" type="button" data-a="resend" data-id="${esc(x.id)}" aria-label="share again">${icon('share')}</button>` : ''}</div>`).join('')}` : ''}

  <div class="sec-h">backup<em>every record, settings included</em></div>
  <p class="fine">Everything lives on this phone only. A backup moves it to another device or keeps it safe — restore merges, the newer copy of anything wins.</p>
  <div class="btns">
    <button class="btn sm" type="button" data-a="backup">${icon('down')}download backup</button>
    <button class="btn sm" type="button" data-a="restore">${icon('up')}restore</button>
  </div>
  `;
}

async function deliver(how) {
  const sel = select();
  const body = opt.fmt === 'json' ? json(sel) : markdown(sel);
  const name = fileName(sel, opt.fmt);
  if (how === 'share') {
    const r = await Q.ui.share(name, body, 'qurOS export');
    if (r === 'shared') { const undo = markSent(sel, 'shared', body); Q.ui.toast('shared · marked as sent', { action: 'undo', run: undo }); return; }
    if (r === 'cancelled') return;
    how = 'copy';
    Q.ui.toast('no share sheet here — copying instead');
  }
  if (how === 'copy') {
    if (!(await Q.ui.copy(body))) { Q.ui.toast('copy blocked — use file instead'); return; }
  } else Q.ui.download(name, body, opt.fmt === 'json' ? 'application/json' : 'text/markdown');
  Q.ui.toast(how === 'copy' ? 'copied' : 'file saved', { action: 'mark sent', ms: 9000, run: () => {
    const undo = markSent(sel, how === 'copy' ? 'copied' : 'file', body);
    Q.ui.toast('marked as sent', { action: 'undo', run: undo });
  } });
}

function backup() {
  const data = Object.assign({ app: 'qurOS', schema: SCHEMA, kind: 'backup', version: Q.VERSION, exported: new Date().toISOString(),
    settings: S() }, Q.db.dump());
  Q.ui.download(`qurOS-backup-${today()}.json`, JSON.stringify(data), 'application/json');
  Q.db.setKv('lastBackup', Date.now());
}
async function restore() {
  const f = await Q.ui.readFile('.json,application/json');
  if (!f) return;
  let data;
  try { data = JSON.parse(f.text); } catch { Q.ui.toast('that file is not JSON'); return; }
  if (!data || data.app !== 'qurOS' || data.kind !== 'backup') { Q.ui.toast('not a qurOS backup (an export can\'t be restored)'); return; }
  const n = (data.entries || []).length, d = (data.days || []).length;
  Q.ui.choose(`Restore ${n} dumps and ${d} days from ${f.name}?`, [
    { label: 'merge with what is here', go: true, run: () => { Q.db.load(data, 'merge'); done(); } },
    { label: 'replace everything here', run: () => Q.ui.confirm('Replace everything on this phone with the backup? Anything not in the file is gone.', 'replace', () => { Q.db.load(data, 'replace'); if (data.settings) Q.settings.replace(data.settings); done(); }) },
  ], { note: 'Merge keeps both; where the same record is in both, the newer one wins.' });
  function done() { Q.app.refresh(); Q.ui.toast('restored'); }
}

function onClick(e) {
  const b = e.target.closest('[data-a], [data-v]');
  const root = $('#v-send');
  if (!b || !root.contains(b)) return;
  const seg = b.closest('[data-a="range"], [data-a="fmt"]');
  if (seg && b.dataset.v) {
    if (seg.dataset.a === 'range') opt.range = b.dataset.v; else opt.fmt = b.dataset.v;
    if (opt.range === 'custom' && !opt.from) { opt.to = today(); opt.from = addDays(opt.to, -6); }
    render(); return;
  }
  const a = b.dataset.a;
  if (a === 'opt') { opt[b.dataset.k] = opt[b.dataset.k] === false; render(); }
  else if (a === 'share' || a === 'copy' || a === 'file') deliver(a);
  else if (a === 'expand') { expanded = !expanded; render(); }
  else if (a === 'backup') backup();
  else if (a === 'restore') restore();
  else if (a === 'settings') Q.settingsUI.open();
  else if (a === 'resend') {
    const x = Q.db.kv('sends', []).find(y => y.id === b.dataset.id);
    if (x && x.body) Q.ui.share(x.name, x.body, 'qurOS export').then(async r => { if (r === 'unsupported') Q.ui.toast(await Q.ui.copy(x.body) ? 'copied' : 'copy blocked'); });
  }
}
function onChange(e) {
  const k = e.target.dataset && e.target.dataset.o;
  if (!k || !$('#v-send').contains(e.target)) return;
  opt[k] = e.target.value; render();
}

Q.send = { select, markdown, json, entryMd, markSent, unsentCount, render, onClick, onChange, backup, SCHEMA, _opt: () => opt };
})();
