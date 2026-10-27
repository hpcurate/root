/* qurOS — settings. Everything content-like (the chain, its minimums, the
   lists, the gym program, the export's instructions) is editable here and
   saved as you type. */
(() => {
const Q = window.Q, { esc, icon, slug, uid, fmtNum } = Q.u;
const S = () => Q.settings.get();

const LANGS = [['', 'device default'], ['en-GB', 'English (UK)'], ['en-US', 'English (US)'], ['fr-FR', 'Français'], ['nl-NL', 'Nederlands'],
  ['de-DE', 'Deutsch'], ['es-ES', 'Español']];
const ACCENTS = ['#A78BFA', '#7C9CFF', '#5CE1E6', '#C6F432', '#FFB547', '#FF7A59', '#FF6FB5', '#E8E8E8'];

const toggle = (k, on) => `<button class="toggle ${on ? 'on' : ''}" type="button" data-t="${k}" aria-pressed="${!!on}"></button>`;
const num = (k, v, min, max) => `<input class="field" type="number" inputmode="numeric" min="${min}" max="${max}" data-n="${k}" value="${esc(v)}">`;
const lnum = (i, k, v, min, max) => `<input class="field" type="number" inputmode="numeric" min="${min}" max="${max}" data-i="${i}" data-k="${k}" value="${esc(v)}">`;
/* the microphone (2.0.1): the phone's own, or one the browser lists — the saved one stays listed until 'find mics' reads them */
const micOptions = (s, list) => [`<option value="">the phone's own</option>`].concat((list || (s.mic ? [{ id: s.mic, name: s.micName || 'microphone' }] : []))
  .map(m => `<option value="${esc(m.id)}" ${s.mic === m.id ? 'selected' : ''}>${esc(m.name)}</option>`)).join('');
const row = (label, sub, ctl) => `<div class="set-row"><span>${label}${sub ? `<small>${sub}</small>` : ''}</span>${ctl}</div>`;

/* a list of objects, each a few text/number fields; `wrap` adapts string lists */
const LISTS = {
  chain: { title: 'morning chain', fields: [['name', 'step'], ['full', 'full', 'sm'], ['min', 'minimum', 'sm']], make: () => ({ id: uid('c'), name: '', full: '', min: '' }) },
  hygiene: { title: 'hygiene chain', fields: [['name', 'step']], make: () => ({ id: uid('h'), name: '' }) },
  prep: { title: 'evening prep', fields: [['name', 'item']], make: () => ({ id: uid('p'), name: '' }) },
  areas: { title: 'focus areas', fields: [['name', 'area']], str: true },
  slots: { title: 'meal slots', fields: [['name', 'slot']], str: true },
  scales: { title: 'check-in scales', fields: [['name', 'scale (1–5)']], str: true },
  'program.A': { title: 'day A', gym: true },
  'program.B': { title: 'day B', gym: true },
};
function getList(key) {
  if (key.startsWith('program.')) return S().program[key.split('.')[1]];
  const v = S()[key];
  return LISTS[key].str ? v.map(name => ({ name })) : v;
}
function setList(key, list) {
  if (key.startsWith('program.')) { const p = Object.assign({}, S().program, { [key.split('.')[1]]: list }); Q.settings.set({ program: p }); return; }
  Q.settings.set({ [key]: LISTS[key].str ? list.map(x => x.name).filter(x => x.trim()) : list });
}
function listHtml(key) {
  const L = LISTS[key], list = getList(key);
  return `<div class="list-ed" data-list="${key}">
    ${list.map((it, i) => `<div class="le-r">
      <div class="le-f">${L.gym ? `
        <input class="field" type="text" data-i="${i}" data-k="name" value="${esc(it.name)}" placeholder="exercise">
        <div class="le-nums">${lnum(i, 'sets', it.sets, 1, 10)} sets × ${lnum(i, 'lo', it.lo, 1, 600)} – ${lnum(i, 'hi', it.hi, 1, 600)}
          <select class="field" style="width:auto;padding:6px 8px" data-i="${i}" data-k="unit"><option value="reps" ${it.unit !== 's' ? 'selected' : ''}>reps</option><option value="s" ${it.unit === 's' ? 'selected' : ''}>sec</option></select></div>`
        : L.fields.map(([k, ph, cls]) => {
          const inp = `<input class="field ${cls || ''}" type="text" data-i="${i}" data-k="${k}" value="${esc(it[k] || '')}" placeholder="${esc(ph)}" aria-label="${esc(ph)}">`;
          return cls ? `<label class="le-lab"><i>${esc(ph)}</i>${inp}</label>` : inp;
        }).join('')}
      </div>
      <div class="le-a">
        <button class="icon-btn" type="button" data-le="up" data-i="${i}" aria-label="move up" ${i ? '' : 'disabled'}>${icon('up')}</button>
        <button class="icon-btn" type="button" data-le="del" data-i="${i}" aria-label="remove">${icon('trash')}</button>
      </div>
    </div>`).join('')}
    <div class="btns"><button class="btn sm" type="button" data-le="add">${icon('plus')}add</button><button class="btn sm quiet" type="button" data-le="reset">reset to default</button></div>
  </div>`;
}

/* 5.1: where the dumps stand on their way to BRAIN (js/brain.js) — never red: a reason, and they wait */
function brainLine() {
  const s = Q.brain.status();
  if (!s.token) return 'each dump goes to BRAIN on the PC through Todoist (04 | core › brain | dumps) — it needs the Todoist key in ROOT → settings';
  const last = s.last && s.last.at ? `the last one went ${Q.u.hm(s.last.at)}` : 'none sent yet';
  return `each dump goes to BRAIN on the PC, in Todoist's 04 | core › brain | dumps · ${s.waiting ? s.waiting + ' waiting · ' : ''}${last}${s.said ? ' · ' + esc(s.said) : ''}`;
}
function body() {
  const s = S();
  return `
  <div class="sec-h">voice<em>talking, the lock, the screen</em></div>
  ${row('speech language', 'what the phone listens for', `<select class="field" data-s="lang">${LANGS.concat(s.langs.filter(l => !LANGS.some(x => x[0] === l)).map(l => [l, l])).map(([v, l]) => `<option value="${v}" ${s.lang === v ? 'selected' : ''}>${esc(l)}</option>`).join('')}</select>`)}
  ${row('quick switch', 'the EN/FR button while recording — codes, comma-separated', `<input class="field" type="text" data-s="langs" value="${esc(s.langs.join(', '))}">`)}
  ${row('microphone', "the phone's own, or a headset — Bluetooth earbuds are listed while they're connected; tap find mics", `<span class="mic-pick"><select class="field" data-s="mic">${micOptions(s)}</select><button class="btn sm quiet" type="button" data-x="mics">find mics</button></span>`)}
  ${row('lock when talking starts', 'the screen locks as soon as a voice dump starts; slide to unlock', toggle('lockOnStart', s.lockOnStart))}
  ${row('lock again after', 'seconds unlocked without a touch while still listening; 0 = never', num('relockAfter', s.relockAfter, 0, 600))}
  ${row('dim after', 'seconds locked without a touch before the screen dims to near-black; 0 = never', num('dimAfter', s.dimAfter, 0, 600))}
  ${row('words on the lock screen', 'off keeps what you say off the screen', toggle('liveText', s.liveText))}
  ${row('new paragraph after', 'seconds of silence', num('paraGap', s.paraGap, 2, 120))}
  ${row('voice commands', 'say "new paragraph" or "new line"', toggle('commands', s.commands))}

  <div class="sec-h">day<em>two clock times, no schedule</em></div>
  ${row('wake target', '', `<input class="field" type="time" data-s="wakeTarget" value="${esc(s.wakeTarget)}">`)}
  ${row('bed target', 'optional', `<input class="field" type="time" data-s="bedTarget" value="${esc(s.bedTarget)}">`)}
  ${row('a day ends at', 'hour (0–6); anything before it belongs to the day before', num('rollover', s.rollover, 0, 6))}

  ${['chain', 'hygiene', 'areas', 'prep', 'slots', 'scales'].map(k => `<div class="sec-h">${LISTS[k].title}<em>${k === 'chain' ? 'every step has a full version and a minimum' : ''}</em></div>${listHtml(k)}`).join('')}

  <div class="sec-h">gym program<em>alternates A and B</em></div>
  <div class="pick-g">day A</div>${listHtml('program.A')}
  <div class="pick-g">day B</div>${listHtml('program.B')}
  ${row('warm-up', '', `<input class="field" type="text" data-p="warm" value="${esc(s.program.warm)}">`)}
  ${row('minimum session', '', `<input class="field" type="text" data-p="min" value="${esc(s.program.min)}">`)}
  ${row('sessions a week', 'shown as "X of 3–4"', `<span style="display:flex;gap:6px;align-items:center">${num('gymT0', s.gymTarget[0], 0, 14)}–${num('gymT1', s.gymTarget[1], 0, 14)}</span>`)}
  ${row('rest timer', 'seconds', num('rest', s.rest, 10, 600))}
  ${row('weight unit', '', `<select class="field" data-s="unit"><option ${s.unit === 'kg' ? 'selected' : ''}>kg</option><option ${s.unit === 'lb' ? 'selected' : ''}>lb</option></select>`)}
  ${row('keep the screen on in the gym', '', toggle('gymAwake', s.gymAwake))}

  <div class="sec-h">export<em>the note at the top of every export</em></div>
  <textarea class="field" rows="9" data-s="prompt">${esc(s.prompt)}</textarea>
  <div class="btns"><button class="btn sm quiet" type="button" data-x="prompt-reset">reset to default</button></div>

  <div class="sec-h">look</div>
  <div class="swatches">${ACCENTS.map(c => `<button type="button" data-c="${c}" style="--c:${c}" class="${s.accent.toLowerCase() === c.toLowerCase() ? 'on' : ''}" aria-label="accent ${c}"></button>`).join('')}</div>

  ${Q.EMBED && Q.brain ? `<div class="sec-h">BRAIN<em>the PC, through Todoist</em></div><div class="fine">${brainLine()}</div>` : ''}

  <div class="sec-h">data<em>on this phone only</em></div>
  <div data-store class="fine">checking storage…</div>
  <div class="btns">
    <button class="btn sm" type="button" data-x="backup">${icon('down')}download backup</button>
    <button class="btn sm quiet" type="button" data-x="wipe">${icon('trash')}erase everything</button>
  </div>

  <div class="about">${Q.EMBED ? `brain, ROOT's capture (qurOS ${esc(Q.VERSION)} inside) · its dumps go to BRAIN on the PC.` : `qurOS ${esc(Q.VERSION)} · a capture app for the qurOS knowledge base.`}<br>
  Records stay on this device (IndexedDB) until you send or back them up. Speech-to-text is the browser's own: on most phones the audio goes to the phone maker's speech service, as with the keyboard's mic.</div>`;
}

function open() {
  /* text edits save 300 ms after the last keystroke, one timer per field, and
     everything pending is written before a list changes shape or the screen closes */
  const timers = {}, pending = {};
  const later = (k, fn) => { clearTimeout(timers[k]); pending[k] = fn; timers[k] = setTimeout(() => { delete pending[k]; fn(); }, 300); };
  const flush = () => Object.keys(pending).forEach(k => { clearTimeout(timers[k]); const fn = pending[k]; delete pending[k]; fn(); });
  Q.ui.screen('settings', {
    title: 'Settings',
    sub: 'saved as you go',
    onClose: () => { flush(); Q.app.refresh(); },
    render(scr) {
      scr.body.innerHTML = body();
      storage(scr.body.querySelector('[data-store]'));
      /* a list is saved from all of its inputs at once, so two quick edits in a row both land */
      const saveList = key => {
        const el = scr.body.querySelector(`[data-list="${key}"]`);
        if (!el) return;
        const list = getList(key).map(x => Object.assign({}, x));
        el.querySelectorAll('[data-i][data-k]').forEach(inp => {
          const it = list[+inp.dataset.i];
          if (!it) return;
          let v = inp.value;
          if (['sets', 'lo', 'hi'].includes(inp.dataset.k)) v = Math.max(1, Math.round(+v) || +it[inp.dataset.k] || 1);
          it[inp.dataset.k] = v;
          if (!LISTS[key].str && !it.id) it.id = slug(it.name) + '-' + uid('i').slice(-4);
        });
        setList(key, list);
      };
      const redrawList = key => {
        const el = scr.body.querySelector(`[data-list="${key}"]`);
        if (el) el.outerHTML = listHtml(key);
      };
      scr.body.addEventListener('click', e => {
        const b = e.target.closest('button');
        if (!b) return;
        flush();
        if (b.dataset.t) {
          const k = b.dataset.t, v = !S()[k];
          Q.settings.set({ [k]: v });
          b.classList.toggle('on', v); b.setAttribute('aria-pressed', v);
        } else if (b.dataset.c) {
          Q.settings.set({ accent: b.dataset.c });
          Q.app.applyAccent();
          scr.body.querySelectorAll('[data-c]').forEach(x => x.classList.toggle('on', x === b));
        } else if (b.dataset.le) {
          const key = b.closest('[data-list]').dataset.list, i = +b.dataset.i;
          const list = getList(key).map(x => Object.assign({}, x));
          if (b.dataset.le === 'add') list.push(LISTS[key].gym ? { id: uid('x'), name: '', sets: 3, lo: 8, hi: 12, unit: 'reps' } : LISTS[key].make ? LISTS[key].make() : { name: '' });
          else if (b.dataset.le === 'del') list.splice(i, 1);
          else if (b.dataset.le === 'up' && i > 0) [list[i - 1], list[i]] = [list[i], list[i - 1]];
          else if (b.dataset.le === 'reset') {
            Q.ui.confirm(`Reset ${LISTS[key].title} to the default?`, 'reset', () => {
              if (key.startsWith('program.')) setList(key, JSON.parse(JSON.stringify(Q.settings.DEFAULTS.program[key.split('.')[1]])));
              else Q.settings.reset(key);
              redrawList(key);
            });
            return;
          }
          setList(key, list);
          redrawList(key);
          if (b.dataset.le === 'add') { const inps = scr.body.querySelectorAll(`[data-list="${key}"] .le-r:last-of-type input`); if (inps[0]) inps[0].focus(); }
        } else if (b.dataset.x === 'prompt-reset') {
          Q.settings.reset('prompt');
          scr.body.querySelector('[data-s="prompt"]').value = S().prompt;
        } else if (b.dataset.x === 'backup') Q.send.backup();
        else if (b.dataset.x === 'wipe') wipe(scr);
        else if (b.dataset.x === 'mics') findMics(scr.body.querySelector('[data-s="mic"]'));
      });
      const onEdit = e => {
        const t = e.target, d = t.dataset || {};
        if (d.s) {
          const k = d.s;
          if (k === 'langs') later(k, () => Q.settings.set({ langs: t.value.split(/[,\s]+/).map(x => x.trim()).filter(Boolean) }));
          else if (k === 'prompt') later(k, () => Q.settings.set({ prompt: t.value.trim() || Q.settings.DEFAULTS.prompt }));
          else if (k === 'mic') Q.settings.set({ mic: t.value, micName: t.value && t.selectedOptions[0] ? t.selectedOptions[0].textContent : '' });
          else Q.settings.set({ [k]: t.value });
        } else if (d.n) {
          if (t.value === '') return;
          const v = Math.max(+t.min, Math.min(+t.max, Math.round(+t.value)));
          if (d.n === 'gymT0' || d.n === 'gymT1') {
            const g = S().gymTarget.slice(); g[d.n === 'gymT0' ? 0 : 1] = v;
            Q.settings.set({ gymTarget: [Math.min(g[0], g[1]), Math.max(g[0], g[1])] });
          } else Q.settings.set({ [d.n]: v });
        } else if (d.p) {
          later('p:' + d.p, () => Q.settings.set({ program: Object.assign({}, S().program, { [d.p]: t.value }) }));
        } else if (d.k !== undefined && d.i !== undefined) {
          const key = t.closest('[data-list]').dataset.list;
          later('list:' + key, () => saveList(key));
        }
      };
      scr.body.addEventListener('input', e => { if (e.target.tagName !== 'SELECT') onEdit(e); });
      scr.body.addEventListener('change', e => { if (e.target.tagName === 'SELECT' || e.target.type === 'time') onEdit(e); });
    },
  });
}

async function findMics(sel) {
  const list = await Q.speech.mics();
  if (!list) { Q.ui.toast("this browser can't list its mics"); return; }
  sel.innerHTML = micOptions(S(), list);
  Q.ui.toast(list.length ? list.length + ' mic' + (list.length === 1 ? '' : 's') + ' found' : "only the phone's own mic for now");
}
async function storage(el) {
  if (!el) return;
  const p = await Q.db.persisted();
  const n = Q.db.all('entries').length, d = Q.db.all('days').filter(x => Q.m.hasData(Q.m.day(x.date))).length;
  const last = Q.db.kv('lastBackup', 0);
  el.innerHTML = `${fmtNum(n)} dumps · ${fmtNum(d)} logged days · ${Q.db.mode() === 'idb' ? 'IndexedDB' : 'local storage (fallback)'}<br>
    ${p === true ? 'storage is <b>persistent</b> — the browser will not clear it to free space' : p === false ? 'storage is not marked persistent yet — install the app to the home screen, or keep a backup' : ''}<br>
    ${last ? 'last backup ' + Q.u.fmtDay(Q.u.dayOf(last)) : 'no backup yet'}`;
}

function wipe(scr) {
  Q.ui.confirm('Erase every dump, day, map and send on this phone?', 'erase', () => {
    Q.ui.confirm('Really? This cannot be undone. Download a backup first if in doubt.', 'erase everything', () => {
      Q.db.load({ entries: [], days: [], kv: [] }, 'replace');
      Q.db.draft.clear();
      scr.close();
      Q.app.refresh();
      Q.ui.toast('erased');
    });
  });
}

Q.settingsUI = { open };
})();
