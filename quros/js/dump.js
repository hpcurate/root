/* qurOS — DUMP, the home tab: talk or write, a topic for it, what is next on
   the map, and everything captured so far. */
(() => {
const Q = window.Q, { $, esc, icon, hm, today, fmtDay, addDays, words, fmtNum, durWords } = Q.u;
const S = () => Q.settings.get();

let next = { topic: null, kind: 'dump' };   // the topic the next capture gets; reset after a save
let showAll = false;
const skipped = [];                          // map items passed over this session

const kindLabel = (t, kind) => Q.m.topicLabel(t, kind);
const SRC = { voice: 'voice', typed: 'typed', mixed: 'voice + typed' };

function entRow(e) {
  const free = !e.topic && e.kind !== 'evening';
  const unsent = Q.m.unsentEntry(e);
  const excerpt = e.text.replace(/\s+/g, ' ').slice(0, 240);
  return `<button class="ent" type="button" data-a="open" data-id="${esc(e.id)}">
    <span class="ent-time">${hm(e.at)}</span>
    <span class="ent-m">
      <span class="ent-topic ${free ? 'free' : ''}">${esc(kindLabel(e.topic, e.kind))}</span>
      <span class="ent-x">${esc(excerpt)}</span>
      <span class="ent-meta"><span>${fmtNum(e.words || words(e.text))} words</span>${e.secs ? `<span>${durWords(e.secs)}</span>` : ''}<span>${SRC[e.src] || e.src || ''}</span>${unsent ? `<span class="unsent">${e.sent ? 'edited since sent' : 'unsent'}</span>` : '<span>sent</span>'}</span>
    </span>
  </button>`;
}

function render() {
  const el = $('#v-dump');
  if (!el) return;
  const t = today(), s = S();
  const all = Q.m.entries();
  const todays = all.filter(e => e.day === t);
  const earlier = all.filter(e => e.day !== t);
  const nx = Q.m.map() ? Q.m.mapNext(skipped) : null;
  const h = new Date().getHours();
  const evening = (h >= 18 || h < s.rollover) && !todays.some(e => e.kind === 'evening');
  const speech = Q.speech.supported();
  const nWords = todays.reduce((a, e) => a + (e.words || 0), 0);

  const cutoff = addDays(t, -14);
  const shown = showAll ? earlier : earlier.filter(e => e.day >= cutoff);
  const byDay = new Map();
  shown.forEach(e => { if (!byDay.has(e.day)) byDay.set(e.day, []); byDay.get(e.day).push(e); });

  el.innerHTML = `
  <header class="top">
    <div class="top-row">
      <span class="top-meta">${fmtDay(t)} · ${todays.length ? `<b>${todays.length}</b> dump${todays.length === 1 ? '' : 's'} today` : 'nothing yet today'}</span>
      <button class="icon-btn" type="button" data-a="settings" aria-label="settings">${icon('gear')}</button>
    </div>
    <h1 class="wm">Dump<em>.</em></h1>
    <p class="top-sub">say it while it's fresh — it all goes to qurOS later.</p>
  </header>

  <div class="hero">
    <button class="topic-pill ${next.topic || next.kind === 'evening' ? 'set' : ''}" type="button" data-a="topic"><span>topic ·</span><b>${esc(kindLabel(next.topic, next.kind))}</b>${icon('chev')}</button>
    <div class="hero-row">
      <button class="talk-btn" type="button" data-a="talk" aria-label="talk">${icon('mic')}<b>TALK</b></button>
      <div class="hero-bar">
        <button class="write-btn" type="button" data-a="write" aria-label="write">${icon('pen')}<b>WRITE</b></button>
        <p class="hero-note">${speech
          ? `the screen stays on while you capture${s.lockOnStart ? ' · it <b>locks</b> when you talk' : ''}`
          : 'no speech-to-text in this browser — <b>write</b> works with your keyboard\'s mic, screen on'}</p>
      </div>
    </div>
  </div>

  ${evening ? `<div class="card next-map" style="margin-top:6px">
      <div class="nm-k">evening</div>
      <div class="nm-t">How did today go?</div>
      <p class="fine">one dump before bed — what happened, what's still on your mind, tomorrow's first step.</p>
      <div class="btns"><button class="btn go sm" type="button" data-a="evening">${icon('mic')}evening dump</button>
      <button class="btn sm" type="button" data-a="evening-w">${icon('pen')}write it</button></div>
    </div>` : ''}

  ${nx ? `<div class="sec-h">next on the map<em>${nx.section.tier < 99 ? 'tier ' + nx.section.tier + ' · ' : ''}${esc(nx.section.title)}</em></div>
    <div class="card next-map">
      <div class="nm-k">${esc(nx.section.title)}</div>
      <div class="nm-t">${esc(nx.item.text)}</div>
      <div class="btns">
        <button class="btn go sm" type="button" data-a="map-talk" data-k="${esc(nx.item.key)}">${icon('mic')}talk about this</button>
        <button class="btn sm" type="button" data-a="map-skip" data-k="${esc(nx.item.key)}">not now</button>
        <button class="btn sm quiet" type="button" data-a="map-done" data-k="${esc(nx.item.key)}">covered</button>
      </div>
    </div>`
    : !Q.m.map() && all.length < 5 ? `<p class="fine" style="margin-top:22px">Tip: load your life-dump map in <b>MAP</b> and each walk gets a topic — the next untouched one shows up here.</p>` : ''}

  <div class="sec-h">today<em>${todays.length ? `${todays.length} · ${fmtNum(nWords)} words` : ''}</em></div>
  ${todays.length ? todays.map(entRow).join('') : '<p class="empty">Nothing captured yet today. Tap <b>talk</b> and say whatever is on your mind.</p>'}

  ${earlier.length ? `<div class="sec-h">earlier<em>${fmtNum(earlier.length)} dump${earlier.length === 1 ? '' : 's'}</em></div>
    ${[...byDay].map(([d, list]) => `<div class="day-h"><span>${fmtDay(d)}</span><span>${list.length} · ${fmtNum(list.reduce((a, e) => a + (e.words || 0), 0))} words</span></div>${list.map(entRow).join('')}`).join('')}
    ${!showAll && shown.length < earlier.length ? `<div class="btns"><button class="btn sm" type="button" data-a="all">show all ${fmtNum(earlier.length)}</button></div>` : ''}` : ''}
  `;
}

function onClick(e) {
  const b = e.target.closest('[data-a]');
  if (!b || !$('#v-dump').contains(b)) return;
  const a = b.dataset.a, k = b.dataset.k;
  if (a === 'talk') Q.rec.talk({ topic: next.topic, kind: next.kind });
  else if (a === 'write') Q.rec.write({ topic: next.topic, kind: next.kind });
  else if (a === 'evening') Q.rec.talk({ kind: 'evening' });
  else if (a === 'evening-w') Q.rec.write({ kind: 'evening' });
  else if (a === 'topic') pickTopic(next.topic, next.kind, (t, kind) => { next = { topic: t, kind }; render(); });
  else if (a === 'settings') Q.settingsUI.open();
  else if (a === 'open') openEntry(b.dataset.id);
  else if (a === 'all') { showAll = true; render(); }
  else if (a === 'map-talk' || a === 'map-done' || a === 'map-skip') {
    const f = Q.m.findItem(k);
    if (!f) return;
    if (a === 'map-talk') Q.rec.talk({ topic: Q.m.topicFor(f.section, f.item) });
    else if (a === 'map-skip') { skipped.push(k); render(); }
    else { Q.m.setItemState(k, 'done'); Q.app.refresh(); Q.ui.toast(`${f.item.text} · covered`, { action: 'undo', run: () => { Q.m.setItemState(k, 'empty'); Q.app.refresh(); } }); }
  }
}

/* ── topic picker ── */
function pickTopic(cur, curKind, cb) {
  const tags = [];
  Q.m.entries().forEach(e => {
    if (e.topic && !e.topic.sec && e.topic.label && !tags.includes(e.topic.label) && tags.length < 6) tags.push(e.topic.label);
  });
  const st = Q.m.states();
  const isCur = t => cur && ((t.item && cur.item === t.item) || (!t.item && t.sec && cur.sec === t.sec && !cur.item));
  const secs = Q.m.sections();
  const body = `<div class="pick">
    <button type="button" data-t="free" class="${!cur && curKind !== 'evening' ? 'on' : ''}">free dump</button>
    <button type="button" data-t="evening" class="${curKind === 'evening' ? 'on' : ''}">evening dump</button>
    ${tags.map((l, i) => `<button type="button" data-tag="${i}" class="${cur && !cur.sec && cur.label === l ? 'on' : ''}">${esc(l)}</button>`).join('')}
    ${secs.map(s => {
      const done = s.items.filter(x => st[x.key] === 'done').length;
      return `<div class="pick-g">${esc(s.title)}<em>${s.tier < 99 ? 'tier ' + s.tier + ' · ' : ''}${done}/${s.items.length}</em></div>
        <button type="button" class="sec ${isCur({ sec: s.key }) ? 'on' : ''}" data-sec="${esc(s.key)}">the whole section<small>${s.items.length - done} open</small></button>
        ${s.items.map(x => `<button type="button" data-item="${esc(x.key)}" class="${isCur({ item: x.key }) ? 'on' : ''}"><span class="st" data-s="${st[x.key] || 'empty'}"></span>${esc(x.text)}</button>`).join('')}`;
    }).join('')}
    ${!secs.length ? '<p class="fine">Load your life-dump map in MAP to pick a section or item here.</p>' : ''}
  </div>
  <div class="pick-new"><input class="field" type="text" placeholder="or name a topic…" enterkeyhint="done" maxlength="80">
  <button class="btn go" type="button" data-new>use</button></div>`;
  const sh = Q.ui.sheet({ title: 'topic', body });
  const pick = (t, kind = 'dump') => { sh.close(); cb(t, kind); };
  sh.el.querySelector('.pick').addEventListener('click', e => {
    const b = e.target.closest('button');
    if (!b) return;
    if (b.dataset.t === 'free') pick(null);
    else if (b.dataset.t === 'evening') pick(null, 'evening');
    else if (b.dataset.tag) pick({ label: tags[+b.dataset.tag] });
    else if (b.dataset.sec) { const s = Q.m.findSection(b.dataset.sec); if (s) pick(Q.m.topicFor(s)); }
    else if (b.dataset.item) { const f = Q.m.findItem(b.dataset.item); if (f) pick(Q.m.topicFor(f.section, f.item)); }
  });
  const inp = sh.el.querySelector('.pick-new input');
  const useNew = () => { const v = inp.value.trim(); if (v) pick({ label: v }); };
  sh.el.querySelector('[data-new]').onclick = useNew;
  inp.addEventListener('keydown', e => { if (e.key === 'Enter') useNew(); });
}

/* ── after a save: the map learns what was covered ── */
function afterSave(e, wasEdit) {
  next = { topic: null, kind: 'dump' };
  Q.app.refresh();
  const n = fmtNum(e.words || words(e.text));
  if (e.topic && e.topic.item) {
    const f = Q.m.findItem(e.topic.item);
    const stt = Q.m.itemState(e.topic.item);
    if (f && stt === 'empty') {
      Q.m.setItemState(e.topic.item, 'partial');
      Q.app.refresh();
      Q.ui.toast(`saved · ${f.item.text} → started`, { action: 'covered it', run: () => { Q.m.setItemState(e.topic.item, 'done'); Q.app.refresh(); } });
      return;
    }
    if (f && stt === 'partial') {
      Q.ui.toast(`saved · ${n} words`, { action: 'covered it', run: () => { Q.m.setItemState(e.topic.item, 'done'); Q.app.refresh(); } });
      return;
    }
  }
  Q.ui.toast(wasEdit ? `updated · ${n} words` : `saved · ${n} words`);
  if (!wasEdit) Q.db.persist();
}

/* ── one entry ── */
function openEntry(id) {
  const e = Q.db.get('entries', id);
  if (!e) return;
  let timer = 0, ta = null;
  const flush = () => {
    clearTimeout(timer);
    const cur = Q.db.get('entries', id);
    if (ta && cur && ta.value !== cur.text) Q.m.editEntry(id, { text: ta.value });
  };
  const meta = () => {
    const c = Q.db.get('entries', id) || e;
    const sentTxt = !c.sent ? 'not sent yet' : (c.edited || 0) > c.sent ? `sent ${fmtDay(Q.u.dayOf(c.sent))} · edited since` : `sent ${fmtDay(Q.u.dayOf(c.sent))} ${hm(c.sent)}`;
    return `<span>${fmtNum(words(ta ? ta.value : c.text))} words</span>${c.secs ? `<span>${durWords(c.secs)} talking</span>` : ''}<span>${SRC[c.src] || ''}</span>${c.lang ? `<span>${esc(c.lang)}</span>` : ''}<span>${sentTxt}</span>`;
  };
  Q.ui.screen('entry', {
    title: e.kind === 'evening' ? 'Evening' : 'Dump',
    sub: `${fmtDay(e.day)} · ${hm(e.at)}`,
    onClose: () => { flush(); Q.app.refresh(); },
    render(scr) {
      scr.acts.innerHTML = `<button class="icon-btn" type="button" data-x="share" aria-label="share">${icon('share')}</button>`;
      scr.body.innerHTML = `
        <div style="margin-top:14px"><button class="topic-pill set" type="button" data-x="topic"><span>topic ·</span><b>${esc(kindLabel(e.topic, e.kind))}</b>${icon('chev')}</button></div>
        <textarea class="entry-text" spellcheck="true">${esc(e.text)}</textarea>
        <div class="entry-meta">${meta()}</div>
        <div class="btns">
          <button class="btn go" type="button" data-x="talk">${icon('mic')}keep talking</button>
          <button class="btn" type="button" data-x="copy">${icon('copy')}copy</button>
          <button class="btn quiet" type="button" data-x="del">${icon('trash')}delete</button>
        </div>`;
      ta = scr.body.querySelector('.entry-text');
      Q.ui.autosize(ta);
      ta.addEventListener('input', () => {
        clearTimeout(timer);
        timer = setTimeout(flush, 500);
        scr.body.querySelector('.entry-meta').innerHTML = meta();
      });
      scr.el.addEventListener('click', async ev => {
        const b = ev.target.closest('[data-x]');
        if (!b) return;
        const x = b.dataset.x;
        flush();
        const cur = Q.db.get('entries', id);
        if (!cur) return;
        if (x === 'topic') {
          pickTopic(cur.topic, cur.kind, (t, kind) => {
            Q.m.editEntry(id, { topic: t, kind });
            b.innerHTML = `<span>topic ·</span><b>${esc(kindLabel(t, kind))}</b>${icon('chev')}`;
          });
        } else if (x === 'talk') {
          scr.close();
          setTimeout(() => Q.rec.talk({ entry: Q.db.get('entries', id) }), 30);
        } else if (x === 'copy') {
          Q.ui.toast(await Q.ui.copy(Q.send.entryMd(cur)) ? 'copied' : 'copy blocked — select the text instead');
        } else if (x === 'share') {
          const r = await Q.ui.share(`qurOS-${cur.day}-${hm(cur.at).replace(':', '')}.md`, Q.send.entryMd(cur), 'qurOS dump');
          if (r === 'unsupported') Q.ui.toast(await Q.ui.copy(Q.send.entryMd(cur)) ? 'no share sheet here — copied instead' : 'sharing is not available here');
        } else if (x === 'del') {
          Q.ui.confirm(`Delete this dump? (${fmtNum(words(cur.text))} words)`, 'delete', () => {
            const gone = Q.m.delEntry(id);
            ta = null;
            scr.close();
            Q.ui.toast('deleted', { action: 'undo', run: () => { Q.db.put('entries', gone); Q.app.refresh(); } });
          });
        }
      });
    },
  });
}

/* a dump left behind by a closed tab or a dead battery: saved as it was */
function rescue(d) {
  Q.db.draft.clear();
  if (!d || !d.text || !d.text.trim() || (d.base && d.base.text === d.text)) return null;
  const e = Q.m.saveEntry({ id: d.id, kind: d.kind, topic: d.topic, text: d.text.trim(), at: d.at, lang: d.lang,
    secs: Math.round((d.base ? d.base.secs || 0 : 0) + (d.secs || 0)), src: d.usedVoice && d.usedType ? 'mixed' : d.usedVoice ? 'voice' : 'typed' });
  Q.ui.toast('an unsaved dump was kept · ' + fmtNum(e.words) + ' words');
  return e;
}
function offerRecovery() {
  const d = Q.db.draft.get();
  if (!d || !d.text || !d.text.trim() || Q.rec.isOpen()) return;
  if (d.base && d.base.text === d.text) { Q.db.draft.clear(); return; }
  Q.ui.choose(`An unsaved ${d.kind === 'evening' ? 'evening dump' : 'dump'} from ${fmtDay(Q.u.dayOf(d.at))} ${hm(d.saved || d.at)} — ${fmtNum(words(d.text))} words.`, [
    { label: 'save it', go: true, run: () => { rescue(d); Q.app.refresh(); Q.ui.toast('recovered and saved'); } },
    { label: 'open it', run: () => Q.rec.resume(d) },
    { label: 'throw it away', run: () => Q.db.draft.clear() },
  ], { note: 'It was kept on this phone while you were capturing.' });
}

Q.dump = { render, onClick, pickTopic, afterSave, openEntry, offerRecovery, rescue, setNext: (t, kind = 'dump') => { next = { topic: t, kind }; } };
})();
