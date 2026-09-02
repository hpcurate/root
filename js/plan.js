/* ── PLAN ─────────────────────────────────────────────────────────────────────
   Build a queue of tasks against a project/section map, then push the batch to
   Todoist through the worker proxy.

   Reworked in the merge:
     · the six projects were stacked accordions; they are a tile grid now, and
       choosing a section happens in a sheet, so the queue never leaves the screen
     · the Todoist key comes from Creds — one key for DO, PLAN and STORE
     · settings live in the settings tab; this module just renders into that panel
   Storage keys are untouched: plan_queue, plan_mappings, plan_projects,
   plan_sections, plan_token (still mirrored for the standalone plan/ app). */
window.PLAN = (function () {
'use strict';

const SCOPE = '.ns-plan ';
const view  = document.querySelector('#view-plan .view-body');   // the scroll container (Shell wraps it)
const $id   = id  => document.querySelector(SCOPE + '#' + id);
const $all  = sel => document.querySelectorAll(SCOPE + sel);
const toast = msg => Shell.toast(msg);

const PROXY = 'https://todoist-proxy.hp-qrate.workers.dev/api/v1';

/* ── Task types ────────────────────────────────────────────────────────────────
   The project tree used to be a literal here. It lives in js/config.js now and
   is edited from Settings → content. `key` is the identity plan_mappings is
   filed under, so the editor preserves it across a rename. */
let TASK_TYPES = Config.get('plan.types');

function resolveColor(typeKey) {
  return TASK_TYPES.find(t => t.key === typeKey)?.color || '#4a4a4a';
}
function typeOf(key) { return TASK_TYPES.find(t => t.key === key); }

// ── State ─────────────────────────────────────────────────────────────────────
let queue = [];
let formState = { typeKey:null, subType:null, block:null, time:null, priority:2, subtasks:[], hasSub:false };
let todoistProjects = [];
let mappings = {};

function loadState() {
  try { queue = JSON.parse(localStorage.getItem('plan_queue') || '[]'); } catch { queue=[]; }
  try { mappings = JSON.parse(localStorage.getItem('plan_mappings') || '{}'); } catch { mappings={}; }
  try { todoistProjects = JSON.parse(localStorage.getItem('plan_projects') || '[]'); } catch { todoistProjects=[]; }
}

function saveQueue() { localStorage.setItem('plan_queue', JSON.stringify(queue)); }
function saveMappingsStore() { localStorage.setItem('plan_mappings', JSON.stringify(mappings)); }
function saveProjects() { localStorage.setItem('plan_projects', JSON.stringify(todoistProjects)); }

// ── Navigation ────────────────────────────────────────────────────────────────
function go(id) {
  $all('.scr').forEach(s=>s.classList.remove('on'));
  $id('s-'+id).classList.add('on');
  if (view) view.scrollTop = 0;
  if (id==='home')    renderHome();
  if (id==='sending') startSending();
}

// ── Home ──────────────────────────────────────────────────────────────────────
function renderHome() {
  // one date format for the whole app, set under Settings → behaviour
  $id('home-date').textContent = Prefs.formatDate(Shell.today()).toUpperCase();
  renderProjects();
  renderQueue();
}

/* One tile per project. The tile carries the two things worth knowing before
   you tap: how much of the queue is already going there, and whether it is
   mapped at all — an unmapped project used to fail silently at send time. */
/* A project's colour is its Todoist label's when the shared cache knows one
   (curate, home, edu … are labels too, and DO's tiles use the same hue), else
   the colour set in Settings. */
const labelHue = (...names) => names.map(n => window.Todoist && Todoist.labelColor(n)).find(Boolean) || null;

/* ── A project opens in place, and then so does its form ──────────────────────
   Two steps, both inside the tile grid and both a FLIP, so nothing ever leaves
   the home screen:

     tap a project   the tile spans both columns — its name centred and grown
                     to whatever still fits, the colour dot under it — and the
                     other tiles become its section rows (full width, about
                     half a tile tall).
     tap a section   the rows become the task form: a panel two tiles wide and
                     four tall, morphing out of the row you tapped, while the
                     title tile grows again above it.

   The queue below simply slides to wherever the grid now ends. Neither is
   persisted: they are gestures, not state. */
let openKey = null;      // the project whose tile is expanded
let openSub = null;      // the index of the section whose form is open

function renderProjects() {
  const grid = $id('proj-list');
  const open = openKey ? typeOf(openKey) : null;
  const tile = (tt, big) => {
    const color  = labelHue(tt.label, tt.key) || resolveColor(tt.key);
    const mapped = !!(mappings[tt.key] && mappings[tt.key].projectId);
    const queued = queue.filter(q => q.typeKey === tt.key).length;
    const meta = queued ? `<em>${queued} queued</em>`
               : mapped ? `${tt.subs.length} sections`
                        : `<span class="unmapped">not mapped</span>`;
    return `<button class="proj-tile${queued ? ' has' : ''}${big ? ' open' : ''}${big && openSub !== null ? ' wide' : ''}"
              style="--proj-color:${color}" data-flip="p:${tt.key}" aria-expanded="${!!big}"
              onclick="PLAN.openProj('${tt.key}')">
      <span class="proj-head"><span class="proj-dot"></span><span class="proj-name">${tt.label}</span></span>
      <span class="proj-meta">${meta}</span>
    </button>`;
  };
  grid.classList.toggle('open', !!open);
  if (!open) {
    grid.innerHTML = TASK_TYPES.map(tt => tile(tt, false)).join('');
    syncSend();
    return;
  }

  const color = labelHue(open.label, open.key) || resolveColor(open.key);
  /* Sections are addressed by index, never by interpolating their text into an
     onclick — several of them contain "|" and spaces. Each row owns its flip
     key: they are new every time the project opens, so they arrive with the
     reveal in flip() rather than pretending to be the project tiles they
     replaced. */
  // the section list can change under an open form (a Config edit): fall back
  // to the rows rather than drawing a panel for a section that is gone
  if (openSub !== null && !open.subs[openSub]) openSub = null;
  const body = openSub === null
    ? open.subs.map((s, i) =>
        `<button class="proj-sec" style="--proj-color:${color}" data-flip="sec:${i}"
                  onclick="PLAN.pickSub('${open.key}',${i})">${esc(s.display)}<i>→</i></button>`).join('')
    : formPanel(open, open.subs[openSub], openSub, color);

  grid.innerHTML = tile(open, true) + body;
  fitTitle(grid.querySelector('.proj-tile.open .proj-name'));
  if (openSub !== null) { renderFormChips(); paintForm(); }
  syncSend();
}

/* The task form, drawn where the section rows were. The ids are the ones the
   form has always used, so optPick / prioPick / addToQueue are untouched;
   which rows appear is Config (plan.formFields), and every one of them is
   optional except the name. */
function formPanel(tt, s, i, color) {
  const f = Config.get('plan.formFields') || {};
  const sub = f.subtasks ? `
      <div class="f"><label class="lbl">Subtasks</label>
        <div class="tg2" id="tg-sub">
          <button class="tg2-b" onclick="PLAN.setSub(true)">yes</button>
          <button class="tg2-b on" onclick="PLAN.setSub(false)">no</button>
        </div>
      </div>
      <div id="sub-input" class="hidden">
        <div class="f">
          <label class="lbl">Add subtask</label>
          <div class="st-row">
            <input type="text" id="sub-text" placeholder="subtask…">
            <button class="st-add" onclick="PLAN.addSubtask()">+ add</button>
          </div>
          <div class="st-list" id="st-list"></div>
        </div>
      </div>` : '';
  return `<div class="proj-form" style="--proj-color:${color}" data-flip="form:${i}">
    <div class="pf-head">
      <span class="pf-sec">${esc(s.display)}</span>
      <button class="pf-close" onclick="PLAN.closeForm()">cancel</button>
    </div>
    <div class="f">
      <label class="lbl">Task name</label>
      <input type="text" id="task-name" placeholder="describe the task…" oninput="PLAN.nameInput(this)">
    </div>
    ${f.block    ? `<div class="f"><label class="lbl">Block</label><div class="opts" id="opts-block"></div></div>` : ''}
    ${f.time     ? `<div class="f"><label class="lbl">Time</label><div class="opts" id="opts-time" style="gap:5px"></div></div>` : ''}
    ${f.priority ? `<div class="f"><label class="lbl">Priority</label><div class="prio-row" id="opts-prio"></div></div>` : ''}
    ${sub}
    <button class="btn" onclick="PLAN.addToQueue()">+ add to queue</button>
  </div>`;
}

/* The open tile's name, as large as still fits the tile — measured against the
   tile's own inner width, since the name shrink-wraps once it is centred. */
function fitTitle(el) {
  const box = el && el.closest('.proj-tile');
  if (!box || !box.clientWidth || !box.clientHeight) return;      // no layout (jsdom): leave the CSS size
  let pad = 28;
  try { const cs = getComputedStyle(box); pad = parseFloat(cs.paddingLeft) + parseFloat(cs.paddingRight); } catch {}
  const avail = box.clientWidth - pad;
  let size = Math.max(16, Math.min(92, Math.round(box.clientHeight * 0.52)));
  el.style.fontSize = size + 'px';
  while (size > 16 && el.scrollWidth > avail) { size -= 2; el.style.fontSize = size + 'px'; }
}

/* ── The transition ───────────────────────────────────────────────────────────
   Note where every flip-keyed element is, re-render, then move each one from
   where it was. Three cases, and between them they cover opening a project,
   opening a section's form, and folding either back up:

     it was there and is the same shape   translate only — the queue sliding
       up or down to follow the grid's new height.
     it was there and changed shape       translate and scale the box, and
       hold its contents back until the box is nearly settled. Text is never
       shown mid-scale, which is the only way a box that goes from a third of
       the width to full width can look like anything but rubber.
     it is new                            fade up into place, staggered down
       the list.

   What it deliberately no longer does is pretend one element becomes another.
   The section rows used to borrow the flip keys of the tiles they replaced,
   so row 2 flew in from the middle of the grid while being squashed to a
   fifth of its width — the further the tile, the stranger the path, which is
   why the second and third rows looked worst. Rows own their keys now, and
   the only thing that moves is the one thing that genuinely persists: the
   project's own tile, growing. A no-op without layout (jsdom) or Web
   Animations. */
const FLIP_EASE = 'cubic-bezier(.2,.8,.2,1)';
function snap() {
  const m = new Map();
  $all('[data-flip]').forEach(el => m.set(el.dataset.flip, el.getBoundingClientRect()));
  return m;
}
function flip(before) {
  const ms = flipMs();
  if (!before.size || !ms) return;
  let fresh = 0;
  $all('[data-flip]').forEach(el => {
    if (!el.animate) return;
    const b = el.getBoundingClientRect();
    if (!b.width || !b.height) return;
    const a = before.get(el.dataset.flip);

    if (!a || !a.width || !a.height) {                       // new: reveal it
      el.animate([{ opacity:0, transform:'translateY(-7px)' }, { opacity:1, transform:'none' }],
        { duration:Math.round(ms * .6), delay:Math.round(ms * .3) + (fresh++ * 45),
          easing:FLIP_EASE, fill:'backwards' });
      return;
    }

    const dx = a.left - b.left, dy = a.top - b.top;
    const sx = a.width / b.width, sy = a.height / b.height;
    const moved = Math.abs(dx) > .5 || Math.abs(dy) > .5;
    const resized = Math.abs(sx - 1) > .01 || Math.abs(sy - 1) > .01;
    if (!moved && !resized) return;

    if (!resized) {                                          // same box, new place
      el.animate([{ transform:`translate(${dx}px,${dy}px)` }, { transform:'none' }],
        { duration:ms, easing:FLIP_EASE });
      return;
    }
    el.animate([{ transformOrigin:'0 0', transform:`translate(${dx}px,${dy}px) scale(${sx},${sy})` },
                { transformOrigin:'0 0', transform:'none' }], { duration:ms, easing:FLIP_EASE });
    // the contents would be stretched by that scale; keep them out of sight
    // until it has nearly resolved, then fade them in at their true size
    Array.from(el.children).forEach(c => { if (c.animate) c.animate(
      [{ opacity:0 }, { opacity:0, offset:.45 }, { opacity:1 }],
      { duration:ms, easing:'ease-out' }); });
  });
}
/* The shell's own motion duration, so the FLIP keeps step with the tab
   cross-fade and follows the Motion setting (--mo) with it. */
function flipMs() {
  let ms = 680, mo = 1;
  try {
    const cs = getComputedStyle(document.documentElement);
    ms = parseFloat(cs.getPropertyValue('--t-flip')) || 680;
    mo = parseFloat(cs.getPropertyValue('--mo'));
    if (!isFinite(mo)) mo = 1;
  } catch {}
  return Math.max(0, ms * mo);
}

function openProj(key) {
  if (!typeOf(key)) return;
  const before = snap();
  openSub = null;                              // a project change closes any open form
  openKey = openKey === key ? null : key;      // tapping the open tile closes it
  renderProjects();
  flip(before);
}

function closeProj() {
  if (!openKey && openSub === null) return;
  const before = snap();
  openKey = null; openSub = null;
  renderProjects();
  flip(before);
}

/* Back from the form to the section rows, the same way it came. */
function closeForm() {
  if (openSub === null) return;
  const before = snap();
  openSub = null;
  renderProjects();
  flip(before);
}

function pickSub(key, i) {
  const tt = typeOf(key);
  const s = tt && tt.subs[i];
  if (!s) return;
  openForm(key, s.display, s.section, i);
}

// ── Queue ─────────────────────────────────────────────────────────────────────
function renderQueue() {
  const list = $id('queue-list');
  const n = queue.length;

  // an empty queue says so on its own title row — there is no placeholder block
  $id('queue-count').textContent = n ? `${n} task${n!==1?'s':''}` : 'empty';
  $id('queue-clear').classList.toggle('hidden', !n);
  syncSend();

  if (!n) { list.innerHTML = ''; return; }

  list.innerHTML = queue.map((t,i) => {
    const color = resolveColor(t.typeKey);
    const pills = [t.subType, t.block ? `@${t.block}` : null, t.time ? `@${t.time}` : null,
      ['','urgent','mandatory','optional'][t.priority] || null].filter(Boolean);
    const stLine = t.subtasks?.length ? `<div class="q-pill">${t.subtasks.length} subtask${t.subtasks.length!==1?'s':''}</div>` : '';
    return `<div class="q-item" style="--q-color:${color}">
      <span class="q-dot"></span>
      <div class="q-item-body">
        <div class="q-item-name">${esc(t.name)}</div>
        <div class="q-item-meta">
          <div class="q-pill hl">${esc(t.typeKey)}</div>
          ${pills.map(p=>`<div class="q-pill">${esc(p)}</div>`).join('')}
          ${stLine}
        </div>
      </div>
      <button class="q-del" onclick="PLAN.removeFromQueue(${i})">✕</button>
    </div>`;
  }).join('');
}

/* The send button is not a disabled button waiting for work — it is simply
   not there until there is something to send, and it steps out of the way
   while the task form is open rather than sitting under it. */
function syncSend() {
  const wrap = $id('send-wrap'); if (!wrap) return;
  const n = queue.length;
  wrap.classList.toggle('hidden', !n || openSub !== null);
  const b = $id('btn-send');
  if (b && n) b.textContent = `send ${n} task${n !== 1 ? 's' : ''} to todoist`;
}

function removeFromQueue(i) { queue.splice(i,1); saveQueue(); renderQueue(); renderProjects(); }
function clearQueue() {
  if(!Shell.confirm('Clear all queued tasks?')) return;
  queue=[]; saveQueue(); renderQueue(); renderProjects(); toast('Queue cleared');
}

// ── Form ──────────────────────────────────────────────────────────────────────
/* The form is a panel inside the tile grid now, not a screen of its own: this
   only resets the state and asks the grid to redraw, and renderProjects()
   emits the markup and paints it. */
function openForm(typeKey, display, section, i) {
  try {
    const tt = typeOf(typeKey);
    if (!tt) { toast('Unknown project: ' + typeKey); return; }
    const idx = typeof i === 'number' ? i : tt.subs.findIndex(s => s.display === display);
    const before = snap();
    formState = { typeKey, subType: display, section, name: '', block: null, time: null,
                  priority: Config.get('plan.defaultPriority'), subtasks: [], hasSub: false };
    openKey = typeKey;
    openSub = idx >= 0 ? idx : 0;
    renderProjects();
    flip(before);
  } catch(err) { toast('Error: ' + err.message); console.error(err); }
}

/* Put the form's controls back in step with formState. Called on every draw
   of the panel, not just the first, so a re-render (a Config edit landing
   while it is open) never loses what has been typed or picked. */
function paintForm() {
  const nameEl = $id('task-name');
  if (!nameEl) return;
  nameEl.value = formState.name || '';
  resetOpts('opts-block', formState.block);
  resetOpts('opts-time', formState.time);
  const prios = $all('.prio-b');
  if (prios.length) {
    prios.forEach(b => b.classList.remove('on'));
    const at = Config.get('plan.priorities').findIndex(p => p.value === formState.priority);
    const di = at >= 0 ? at : defaultPrioIndex();
    if (prios[di]) prios[di].classList.add('on');
  }
  setSub(formState.hasSub);
  renderSubtasks();
}

function nameInput(el) { formState.name = el.value; }

/* Every row is optional (plan.formFields), so nothing here may assume its
   element is on the page. */
function resetOpts(id, activeVal) {
  const row = $id(id);
  if (!row) return;
  row.querySelectorAll('.opt-b').forEach(b=>{
    const isNone = b.classList.contains('none-opt');
    b.classList.toggle('on', isNone ? activeVal===null : b.textContent===activeVal);
  });
  if (activeVal === null) { const noneBtn = row.querySelector('.none-opt'); if (noneBtn) noneBtn.classList.add('on'); }
}

/* ── Form chips ───────────────────────────────────────────────────────────────
   The block, time and priority rows were three hardcoded lists in index.html.
   They are drawn from Config here, keeping the same classes and the same
   onclick contract, so resetOpts() and optPick() are untouched. */
function renderFormChips() {
  const blocks = Config.get('plan.blocks');
  const times  = Config.get('plan.times');
  const prios  = Config.get('plan.priorities');
  const none   = field => `<button class="opt-b none-opt on" onclick="PLAN.optPick(this,'${field}',null)">none</button>`;

  /* A block chip wears its Todoist label's colour, like DO's block tiles.
     There is no "none" chip on this row: no block is the starting state, and
     tapping the picked one again clears it (see optPick). */
  const ob = $id('opts-block');
  if (ob) ob.innerHTML = blocks.map(b => {
    const c = labelHue(b);
    return `<button class="opt-b${c ? ' lbl' : ''}"${c ? ` style="--c:${esc(c)}"` : ''} onclick="PLAN.optPick(this,'block','${attr(b)}')">${esc(b)}</button>`;
  }).join('');

  const ot = $id('opts-time');
  if (ot) ot.innerHTML = times.map(t =>
    `<button class="opt-b" onclick="PLAN.optPick(this,'time','${attr(t.value)}')">${esc(t.label)}</button>`).join('') + none('time');

  const pr = $id('opts-prio');
  if (pr) pr.innerHTML = prios.map((p, i) =>
    `<button class="prio-b p${i + 1}" onclick="PLAN.prioPick(this,${p.value})">
       <div>${esc(p.label)}</div><div class="prio-label">${esc(p.p)}</div>
     </button>`).join('');
}

/* Which priority button is pre-selected — the default from Config, or the last
   one if that default no longer exists. */
function defaultPrioIndex() {
  const prios = Config.get('plan.priorities');
  const want = Config.get('plan.defaultPriority');
  const i = prios.findIndex(p => p.value === want);
  return i >= 0 ? i : prios.length - 1;
}

/* Tapping the chip that is already on clears the field — which is how the
   block row gets back to "none" now that it has no none chip of its own. */
function optPick(btn, field, val) {
  const row = btn.parentElement;
  const off = val !== null && btn.classList.contains('on');
  row.querySelectorAll('.opt-b').forEach(b=>b.classList.remove('on'));
  if (!off) btn.classList.add('on');
  else { const noneBtn = row.querySelector('.none-opt'); if (noneBtn) noneBtn.classList.add('on'); }
  formState[field] = off ? null : val;
}

function prioPick(btn, val) {
  $all('.prio-b').forEach(b=>b.classList.remove('on'));
  btn.classList.add('on');
  formState.priority = val;
}

function setSub(on) {
  formState.hasSub = on;
  const tg = $id('tg-sub');
  if (tg) tg.querySelectorAll('.tg2-b').forEach((b,i)=> b.classList.toggle('on', on ? i===0 : i===1));
  const box = $id('sub-input');
  if (box) box.classList.toggle('hidden', !on);
}

function addSubtask() {
  const inp = $id('sub-text');
  if (!inp) return;
  const txt = inp.value.trim(); if(!txt) return;
  formState.subtasks.push(txt); inp.value = ''; renderSubtasks();
}

function deleteSubtask(i) { formState.subtasks.splice(i,1); renderSubtasks(); }

function renderSubtasks() {
  const list = $id('st-list');
  if (!list) return;
  list.innerHTML = formState.subtasks.map((s,i)=>`
    <div class="st-item">
      <span class="st-item-txt">${esc(s)}</span>
      <button class="st-del" onclick="PLAN.deleteSubtask(${i})">✕</button>
    </div>`).join('');
}

function addToQueue() {
  const el = $id('task-name');
  const raw = (el ? el.value : formState.name || '').trim();
  const tt = typeOf(formState.typeKey);
  if (!tt) return;
  const name = raw ? raw : formState.subType;
  const map = mappings[formState.typeKey] || {};
  if (!map.projectId) {
    if (!confirm('No project mapped for '+formState.typeKey+'. Add anyway? It will go to inbox.')) return;
  }
  queue.push({ name, typeKey:formState.typeKey, subType:formState.subType, section:formState.section,
    projectLabel:tt.pLabel, projectId:map.projectId||null, block:formState.block, time:formState.time,
    priority:formState.priority, subtasks:[...formState.subtasks] });
  saveQueue();
  toast('Added to queue');
  // fold the whole grid back up: the form, then the project
  const before = snap();
  openSub = null; openKey = null;
  renderProjects(); renderQueue();
  flip(before);
}

// ── Sending ───────────────────────────────────────────────────────────────────
async function startSending() {
  const token = Creds.token();
  if (!token) { toast('No Todoist key'); Shell.settings('data'); return; }
  const log = $id('send-log');
  const backBtn = $id('send-back');
  const doneBtn = $id('send-done-btn');
  const title = $id('send-title');
  log.innerHTML = ''; backBtn.disabled = true; doneBtn.classList.add('hidden');
  title.textContent = 'sending…';
  let sectionMap = {};
  try { sectionMap = JSON.parse(localStorage.getItem('plan_sections') || '{}'); } catch {}
  /* Only what failed stays queued. The queue used to be kept whole after any
     failure, so the next "send" re-created every task that had already gone
     through — duplicates in Todoist for one flaky request. */
  let success = 0, failed = 0;
  const remaining = [];
  for (const task of queue) {
    const labels = [task.projectLabel];
    if (task.block) labels.push(task.block);
    if (task.time) labels.push(task.time);
    const body = { content: task.name, due_string: 'today', priority: task.priority, labels };
    if (task.projectId) body.project_id = task.projectId;
    if (task.projectId && task.section) {
      const sid = sectionMap[task.projectId]?.[task.section];
      if (sid) body.section_id = sid;
    }
    log.innerHTML += `<div class="pending">→ ${esc(task.name)}</div>`;
    log.scrollTop = log.scrollHeight;
    try {
      const res = await fetch(PROXY + '/tasks', {
        method:'POST', headers:{ 'Authorization':'Bearer '+token, 'Content-Type':'application/json' },
        body: JSON.stringify(body),
      });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const created = await res.json();
      success++;
      for (const st of (task.subtasks || [])) {
        const stBody = { content: st, parent_id: created.id, due_string: 'today', priority: task.priority };
        const sr = await fetch(PROXY + '/tasks', {
          method:'POST', headers:{ 'Authorization':'Bearer '+token, 'Content-Type':'application/json' },
          body: JSON.stringify(stBody),
        });
        if (!sr.ok) logLine(log, `  ↳ subtask failed: ${st}`, 'err');
        else logLine(log, `  ↳ ${esc(st)}`, 'ok');
      }
      const lines = log.querySelectorAll('.pending');
      if (lines.length) { const last=lines[lines.length-1]; last.className='ok'; last.textContent='✓ '+task.name; }
    } catch (err) {
      failed++;
      remaining.push(task);
      const lines = log.querySelectorAll('.pending');
      if (lines.length) { const last=lines[lines.length-1]; last.className='err'; last.textContent='✗ '+task.name+' ('+err.message+')'; }
    }
    await sleep(100);
  }
  log.innerHTML += `<div style="margin-top:8px;color:${failed?'var(--re)':'var(--gr)'}">${success} sent${failed?', '+failed+' failed — still in the queue':''}</div>`;
  log.scrollTop = log.scrollHeight;
  title.textContent = failed ? 'done with errors' : 'done';
  backBtn.disabled = false; doneBtn.classList.remove('hidden');
  recordSent(queue.filter(t => !remaining.includes(t)));
  queue = remaining; saveQueue();
}

// ── What was planned today, for LOG ───────────────────────────────────────────
/* Everything sent is due "today", so a task that went through is a plan for
   today — LOG offers it as an extra block on the evening form. Sent tasks are
   kept under plan_sent_v1 for the current day only; the queue counts as
   planned too, since it is what you are about to send. */
const SENT_KEY = 'plan_sent_v1';
function readSent() {
  let s = null;
  try { s = JSON.parse(localStorage.getItem(SENT_KEY) || 'null'); } catch {}
  const today = Shell.today();
  return s && s.date === today && Array.isArray(s.tasks) ? s : { date: today, tasks: [] };
}
function recordSent(tasks) {
  if (!tasks.length) return;
  const s = readSent();
  tasks.forEach(t => s.tasks.push({ name:t.name, typeKey:t.typeKey, block:t.block, time:t.time }));
  try { localStorage.setItem(SENT_KEY, JSON.stringify(s)); } catch {}
}
/* Queue first, then what was sent today; one entry per name, with the
   project's colour so LOG can draw it in the project's hue. */
function plannedToday() {
  const out = [], seen = new Set();
  readSent().tasks.concat(queue).forEach(t => {
    const key = String(t.name || '').trim().toLowerCase();
    if (!key || seen.has(key)) return;
    seen.add(key);
    out.push({ name:t.name, project:t.typeKey, block:t.block || null, time:t.time || null, color:resolveColor(t.typeKey) });
  });
  return out;
}

function logLine(container, text, cls) {
  const div = document.createElement('div');
  div.className = cls; div.textContent = text;
  container.appendChild(div); container.scrollTop = container.scrollHeight;
}

const sleep = ms => new Promise(r=>setTimeout(r,ms));

// ── Settings (rendered into the settings tab) ─────────────────────────────────
function renderSettings() {
  updateConnStatus();
  if (todoistProjects.length) renderMappingRows();
}

function updateConnStatus() {
  const el = $id('conn-status');
  if (!el) return;
  const tok = Creds.token();
  if (!tok) { el.className='settings-status idle'; el.textContent='no Todoist key yet — add one under data'; return; }
  if (todoistProjects.length) {
    el.className='settings-status ok'; el.textContent=`${todoistProjects.length} projects loaded`;
  } else {
    el.className='settings-status idle'; el.textContent='key set · fetch your projects to map them';
  }
}

async function connectTodoist() {
  const tok = Creds.token();
  if (!tok) { toast('add your Todoist key under data first'); Shell.settings('data'); return; }
  const btn = $id('btn-connect');
  btn.textContent = 'fetching…'; btn.disabled = true;
  try {
    const res = await fetch(PROXY + '/projects', { headers:{ 'Authorization':'Bearer '+tok } });
    if (res.status === 401) throw new Error('invalid key — check it under data');
    if (res.status === 403) throw new Error('forbidden — the key may lack permissions');
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const projData = await res.json();
    const projects = Array.isArray(projData) ? projData : (projData.results || projData.projects || []);
    const secRes = await fetch(PROXY + '/sections', { headers:{ 'Authorization':'Bearer '+tok } });
    if (secRes.ok) {
      const secData = await secRes.json();
      const sections = Array.isArray(secData) ? secData : (secData.results || secData.sections || []);
      const sectionMap = {};
      sections.forEach(s => { if (!sectionMap[s.project_id]) sectionMap[s.project_id]={}; sectionMap[s.project_id][s.name]=s.id; });
      localStorage.setItem('plan_sections', JSON.stringify(sectionMap));
    }
    todoistProjects = projects; saveProjects(); updateConnStatus(); renderMappingRows();
    toast('Connected — map your projects');
  } catch(err) {
    const el = $id('conn-status');
    el.className='settings-status err';
    el.textContent = err.message.includes('fetch')
      ? 'network error — check your connection'
      : 'error: '+err.message;
  } finally { btn.textContent='fetch projects'; btn.disabled=false; }
}

function renderMappingRows() {
  const sec = $id('map-sec');
  const rows = $id('map-rows');
  const saveBtn = $id('btn-save-map');
  sec.style.display='block'; rows.style.display='block'; saveBtn.classList.remove('hidden');
  rows.innerHTML = TASK_TYPES.map(tt => {
    const current = mappings[tt.key]?.projectId || '';
    const opts = todoistProjects.map(p=>`<option value="${p.id}" ${p.id===current?'selected':''}>${esc(p.name)}</option>`).join('');
    return `<div class="f"><label class="lbl">${esc(tt.label)}</label>
      <select id="map-${tt.key}"><option value="">— not mapped —</option>${opts}</select></div>`;
  }).join('');
}

function saveMappings() {
  TASK_TYPES.forEach(tt => {
    const sel = $id('map-'+tt.key); if (!sel) return;
    const pid = sel.value;
    if (!pid) { mappings[tt.key] = {}; return; }
    const proj = todoistProjects.find(p=>p.id===pid);
    mappings[tt.key] = { projectId:pid, color:proj?.color||'', name:proj?.name||'' };
  });
  saveMappingsStore(); toast('Mapping saved'); renderProjects();
}

// ── Utils ─────────────────────────────────────────────────────────────────────
function esc(s) { return String(s||'').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;'); }
/* For a Config value inside onclick="…('…')": JS-string escaped, then attribute
   escaped, so a chip value with a quote in it does not break its handler. */
function attr(s) {
  return String(s ?? '').replace(/\\/g, '\\\\').replace(/'/g, "\\'")
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

// ── Boot ──────────────────────────────────────────────────────────────────────
loadState();
renderFormChips();
renderHome();

/* An edited project tree redraws the tiles and the form chips immediately.
   Queued tasks are left alone — they already carry the label, colour and section
   they were built with, so a rename never rewrites something you were about to
   send. */
Config.subscribe(path => {
  if (path !== '*' && !String(path).startsWith('plan.')) return;
  TASK_TYPES = Config.get('plan.types');
  renderFormChips();
  renderHome();
});

// the date label follows Settings → behaviour → dates without a reload
Prefs.subscribe(k => { if (k === 'dateFormat' || k === '*') renderHome(); });

Shell.register('plan', {
  // the PLAN tab tapped while on PLAN: fold the grid first, then go home
  home: () => { if (openKey || openSub !== null) closeProj(); else go('home'); },
  /* The label colours: cached for an hour, refreshed on arrival. The redraw
     used to be skipped unless the home screen was showing, to protect the
     form's chips; the form lives in the grid now and paintForm() puts every
     control back from formState on each draw, so it is safe — and arriving
     on PLAN with a stale palette was the real bug. */
  onShow: () => { if (window.Todoist) Todoist.labels().then(renderProjects); },
});

return { go, renderSettings, openProj, closeProj, closeForm, pickSub, nameInput, syncSend,
         clearQueue, removeFromQueue, optPick, prioPick, setSub, addSubtask,
         deleteSubtask, addToQueue, connectTodoist, saveMappings, plannedToday };
})();
