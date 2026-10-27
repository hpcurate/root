/* qurOS — MAP, what the knowledge base knows. The life-dump map is a list of
   sections (by tier) and the things to talk through in each; every item is
   untouched, started or covered. A dump on an item marks it started; you say
   when it is covered. Rule from the planning sessions: one section per dump,
   tier 1 first — so the next untouched item is always one tap away. */
(() => {
const Q = window.Q, { $, esc, icon, fmtDay, fmtNum } = Q.u;
const open = new Set();          // sections unfolded on screen
let editing = false;

const NEXT_STATE = { empty: 'partial', partial: 'done', done: 'empty' };
const STATE_WORD = { empty: 'untouched', partial: 'started', done: 'covered' };

function render() {
  const el = $('#v-map');
  if (!el) return;
  const m = Q.m.map(), secs = Q.m.sections(), st = Q.m.states();
  const stats = Q.m.mapStats();
  const nx = Q.m.mapNext();
  const pct = n => stats.items ? (n / stats.items * 100).toFixed(2) + '%' : '0';
  if (nx && !open.size) open.add(nx.section.key);

  el.innerHTML = `
  <header class="top">
    <div class="top-row">
      <span class="top-meta">${m ? `<b>${stats.done}</b> of ${stats.items} covered · ${stats.partial} started` : 'knowledge base'}</span>
      <button class="icon-btn" type="button" data-a="menu" aria-label="map options">${icon('dots')}</button>
    </div>
    <h1 class="wm">Map<em>.</em></h1>
    <p class="top-sub">${m ? esc(m.title) : 'what qurOS knows about you, and what is still to talk through.'}</p>
  </header>

  ${m ? `
    <div class="map-prog" aria-hidden="true"><i style="width:${pct(stats.done)}"></i><i class="p" style="width:${pct(stats.partial)}"></i></div>
    <p class="fine">${fmtNum(stats.items - stats.done - stats.partial)} untouched · tap a dot to change it · tap an item for its dumps</p>
    ${nx ? `<div class="sec-h">next<em>${nx.section.tier < 99 ? 'tier ' + nx.section.tier + ' · ' : ''}${esc(nx.section.title)}</em></div>
      <div class="card next-map"><div class="nm-k">${esc(nx.section.title)}</div><div class="nm-t">${esc(nx.item.text)}</div>
        <div class="btns"><button class="btn go sm" type="button" data-a="talk-item" data-k="${esc(nx.item.key)}">${icon('mic')}talk about this</button>
        <button class="btn sm" type="button" data-a="talk-sec" data-s="${esc(nx.section.key)}">the whole section</button></div></div>`
      : `<div class="card" style="margin-top:18px"><b>Everything on the map has been talked through.</b><p class="fine">Add new items, or send it all to qurOS and ask what's missing.</p></div>`}
    <div class="sec-h">sections<em>${secs.length}</em><button class="sec-a" type="button" data-a="edit">${icon(editing ? 'check' : 'edit')}${editing ? 'done' : 'edit'}</button></div>
    ${secs.map(s => section(s, st)).join('')}
    ${editing ? `<div class="btns"><button class="btn sm" type="button" data-a="sec-add">${icon('plus')}section</button></div>` : ''}
  ` : `
    <div class="card" style="margin-top:22px">
      <b>No map yet.</b>
      <p class="fine">Load the life-dump map qurOS made for you — a markdown file: headings are sections ("Tier 1" in a heading sets the tier), list items are the things to talk through. <b>[x]</b> marks one covered, <b>[~]</b> started.</p>
      <div class="btns">
        <button class="btn go sm" type="button" data-a="import">${icon('file')}load .md file</button>
        <button class="btn sm" type="button" data-a="paste">paste it</button>
        <button class="btn sm quiet" type="button" data-a="starter">use a starter map</button>
      </div>
    </div>`}
  `;
}

function section(s, st) {
  const done = s.items.filter(x => st[x.key] === 'done').length;
  const part = s.items.filter(x => st[x.key] === 'partial').length;
  const isOpen = open.has(s.key) || editing;
  return `<div class="msec ${isOpen ? 'open' : ''}" data-sec="${esc(s.key)}">
    <button class="msec-h" type="button" data-a="fold" data-s="${esc(s.key)}">
      ${s.tier < 99 ? `<span class="tier">T${s.tier}</span>` : ''}<b>${esc(s.title)}</b>
      <span class="cnt">${done}/${s.items.length}${part ? ` · ${part}◐` : ''}</span>${icon('chev')}
    </button>
    <div class="msec-b">
      ${s.items.map(x => {
        const v = st[x.key] || 'empty', n = Q.m.dumpsFor(x.key);
        const lastD = n.length ? n.sort((a, b) => b.at - a.at)[0].day : null;
        return `<div class="mitem ${v}">
          <button class="st" type="button" data-a="state" data-k="${esc(x.key)}" data-s="${v}" aria-label="${esc(x.text)}: ${STATE_WORD[v]}"></button>
          <div class="row-m" data-a="item" data-k="${esc(x.key)}"><div class="row-t">${esc(x.text)}</div>
            <div class="row-s">${STATE_WORD[v]}${n.length ? ` · ${n.length} dump${n.length === 1 ? '' : 's'} · ${fmtDay(lastD)}` : ''}</div></div>
          ${editing ? `<button class="icon-btn" type="button" data-a="item-edit" data-k="${esc(x.key)}" data-s="${esc(s.key)}" aria-label="edit">${icon('edit')}</button>`
            : `<button class="icon-btn" type="button" data-a="talk-item" data-k="${esc(x.key)}" aria-label="talk about ${esc(x.text)}">${icon('mic')}</button>`}
        </div>`;
      }).join('')}
      <div class="btns">
        ${editing ? `<button class="btn sm" type="button" data-a="item-add" data-s="${esc(s.key)}">${icon('plus')}item</button>
          <button class="btn sm quiet" type="button" data-a="sec-edit" data-s="${esc(s.key)}">${icon('edit')}section</button>`
          : `<button class="btn sm" type="button" data-a="talk-sec" data-s="${esc(s.key)}">${icon('mic')}talk through this section</button>`}
      </div>
    </div>
  </div>`;
}

function onClick(e) {
  const b = e.target.closest('[data-a]');
  if (!b || !$('#v-map').contains(b)) return;
  const a = b.dataset.a, k = b.dataset.k, sk = b.dataset.s;
  if (a === 'fold') { open.has(sk) ? open.delete(sk) : open.add(sk); render(); }
  else if (a === 'state') { Q.m.setItemState(k, NEXT_STATE[Q.m.itemState(k)]); Q.u.vibrate(10); Q.app.refresh(); }
  else if (a === 'talk-item') { const f = Q.m.findItem(k); if (f) Q.rec.talk({ topic: Q.m.topicFor(f.section, f.item) }); }
  else if (a === 'talk-sec') { const s = Q.m.findSection(sk); if (s) Q.rec.talk({ topic: Q.m.topicFor(s) }); }
  else if (a === 'item') itemSheet(k);
  else if (a === 'edit') { editing = !editing; render(); }
  else if (a === 'import') importFile();
  else if (a === 'paste') pasteSheet();
  else if (a === 'starter') { Q.m.loadMapText(Q.m.STARTER); render(); Q.ui.toast('starter map loaded — edit it to make it yours'); }
  else if (a === 'menu') menu();
  else if (a === 'sec-add') textSheet('new section', '', { tier: 1 }, (v, tier) => {
    Q.m.mapEdit(m => { let key = Q.u.slug(v); while (m.sections.some(s => s.key === key)) key += '-2'; m.sections.push({ key, title: v, tier, items: [] }); open.add(key); });
    render();
  });
  else if (a === 'sec-edit') {
    const s = Q.m.findSection(sk);
    textSheet('section', s.title, { tier: s.tier < 99 ? s.tier : '', del: true }, (v, tier) => {
      const old = s.items.map(x => x.key);
      Q.m.mapEdit(m => { const x = m.sections.find(y => y.key === sk); x.title = v; x.tier = tier || 99; x.items.forEach(it => { it.key = Q.m.itemKey(v, it.text); }); });
      const now = Q.m.findSection(sk).items.map(x => x.key);
      old.forEach((o, i) => Q.m.rekey(o, now[i]));
      render();
    }, () => Q.ui.confirm(`Remove the section "${s.title}" and its ${s.items.length} items? Dumps about them stay.`, 'remove', () => {
      Q.m.mapEdit(m => { m.sections = m.sections.filter(y => y.key !== sk); }); render();
    }));
  }
  else if (a === 'item-add') {
    const s = Q.m.findSection(sk);
    textSheet('new item in ' + s.title, '', {}, v => {
      Q.m.mapEdit(m => { const x = m.sections.find(y => y.key === sk); const key = Q.m.itemKey(x.title, v); if (!x.items.some(i => i.key === key)) x.items.push({ key, text: v }); });
      render();
    });
  }
  else if (a === 'item-edit') {
    const f = Q.m.findItem(k);
    textSheet('item', f.item.text, { del: true }, v => {
      const nk = Q.m.itemKey(f.section.title, v);
      Q.m.mapEdit(m => { const it = m.sections.find(y => y.key === sk).items.find(i => i.key === k); it.text = v; it.key = nk; });
      Q.m.rekey(k, nk);
      render();
    }, () => { Q.m.mapEdit(m => { const x = m.sections.find(y => y.key === sk); x.items = x.items.filter(i => i.key !== k); }); render(); });
  }
}

function textSheet(title, value, { tier, del } = {}, ok, onDel) {
  const sh = Q.ui.sheet({
    title,
    body: `<input class="field" type="text" value="${esc(value)}" maxlength="120" enterkeyhint="done">
      ${tier !== undefined ? `<div class="set-row"><span>tier<small>lower is talked through first; empty = no tier</small></span><input class="field" type="number" min="1" max="20" value="${esc(tier)}" data-tier></div>` : ''}
      <div class="sheet-acts">${del ? `<button class="btn quiet" type="button" data-del>${icon('trash')}remove</button>` : ''}<button class="btn go" type="button" data-ok>save</button></div>`,
  });
  const inp = sh.el.querySelector('input');
  const go = () => {
    const v = inp.value.trim(); if (!v) return;
    const tEl = sh.el.querySelector('[data-tier]');
    sh.close(); ok(v, tEl && tEl.value ? Math.max(1, +tEl.value) : 99);
  };
  sh.el.querySelector('[data-ok]').onclick = go;
  inp.addEventListener('keydown', e => { if (e.key === 'Enter') go(); });
  const d = sh.el.querySelector('[data-del]');
  if (d) d.onclick = () => { sh.close(); onDel(); };
  setTimeout(() => inp.focus(), 250);
}

function itemSheet(k) {
  const f = Q.m.findItem(k);
  if (!f) return;
  const list = Q.m.dumpsFor(k).sort((a, b) => b.at - a.at);
  const v = Q.m.itemState(k);
  const sh = Q.ui.sheet({
    title: f.section.title,
    body: `<p class="sheet-q">${esc(f.item.text)}</p>
      <div class="seg" data-states>${['empty', 'partial', 'done'].map(s => `<button type="button" data-st="${s}" class="${v === s ? 'on' : ''}">${STATE_WORD[s]}</button>`).join('')}</div>
      <div class="pick-g" style="margin-top:20px">dumps<em>${list.length}</em></div>
      ${list.length ? list.map(e => `<button class="ent" type="button" data-id="${esc(e.id)}"><span class="ent-time">${fmtDay(e.day).split(' ').slice(1).join(' ')}</span><span class="ent-m"><span class="ent-x">${esc(e.text.slice(0, 200))}</span><span class="ent-meta"><span>${fmtNum(e.words || 0)} words</span></span></span></button>`).join('')
        : '<p class="fine">Nothing said about this yet.</p>'}
      <div class="sheet-acts"><button class="btn go" type="button" data-talk>${icon('mic')}talk about this</button></div>`,
  });
  sh.el.querySelector('[data-states]').addEventListener('click', e => {
    const b = e.target.closest('[data-st]'); if (!b) return;
    Q.m.setItemState(k, b.dataset.st);
    sh.el.querySelectorAll('[data-st]').forEach(x => x.classList.toggle('on', x === b));
    Q.app.refresh();
  });
  sh.el.querySelectorAll('.ent').forEach(b => { b.onclick = () => { sh.close(); setTimeout(() => Q.dump.openEntry(b.dataset.id), 60); }; });
  sh.el.querySelector('[data-talk]').onclick = () => { sh.close(); setTimeout(() => Q.rec.talk({ topic: Q.m.topicFor(f.section, f.item) }), 60); };
}

async function importFile() {
  const f = await Q.ui.readFile('.md,.markdown,.txt,text/markdown,text/plain');
  if (!f) return;
  loaded(Q.m.loadMapText(f.text), f.name);
}
function pasteSheet() {
  const sh = Q.ui.sheet({
    title: 'paste the map',
    body: `<textarea class="field" rows="10" placeholder="# Life dump map&#10;## Family — Tier 1&#10;- Childhood&#10;- Grandparents"></textarea>
      <div class="sheet-acts"><button class="btn go" type="button" data-ok>load</button></div>`,
  });
  const ta = sh.el.querySelector('textarea');
  sh.el.querySelector('[data-ok]').onclick = () => { const r = Q.m.loadMapText(ta.value); if (r) sh.close(); loaded(r, 'pasted text'); };
}
function loaded(r, what) {
  if (!r) { Q.ui.toast('no sections with list items found in ' + what); return; }
  const n = r.map.sections.reduce((a, s) => a + s.items.length, 0);
  open.clear();
  Q.app.refresh();
  Q.ui.toast(`map ${r.replaced ? 'updated' : 'loaded'} · ${r.map.sections.length} sections · ${n} items`);
}
function menu() {
  const m = Q.m.map();
  Q.ui.choose('The map', [
    { label: 'load / update from a .md file', go: !m, run: importFile },
    { label: 'paste it', run: pasteSheet },
    ...(m ? [
      { label: 'save the map as .md (with states)', run: () => Q.ui.download('qurOS-life-dump-map.md', Q.m.mapToMd()) },
      { label: 'copy the map', run: async () => Q.ui.toast(await Q.ui.copy(Q.m.mapToMd()) ? 'map copied' : 'copy blocked') },
      { label: 'remove the map', run: () => Q.ui.confirm('Remove the map? The states are kept and come back if you load it again; dumps are untouched.', 'remove', () => { Q.m.setMap(null); Q.app.refresh(); }) },
    ] : [{ label: 'use a starter map', run: () => { Q.m.loadMapText(Q.m.STARTER); Q.app.refresh(); } }]),
  ], { note: 'Updating from a file keeps every state whose item was not reworded.' });
}

Q.mapUI = { render, onClick };
})();
