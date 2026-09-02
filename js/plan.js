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
  if (id==='form')    renderForm();
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
function renderProjects() {
  $id('proj-list').innerHTML = TASK_TYPES.map(tt => {
    const color  = labelHue(tt.label, tt.key) || resolveColor(tt.key);
    const mapped = !!(mappings[tt.key] && mappings[tt.key].projectId);
    const queued = queue.filter(q => q.typeKey === tt.key).length;
    const meta = queued ? `<em>${queued} queued</em>`
               : mapped ? `${tt.subs.length} sections`
                        : `<span class="unmapped">not mapped</span>`;
    return `<button class="proj-tile${queued ? ' has' : ''}" style="--proj-color:${color}"
              onclick="PLAN.openProj('${tt.key}')">
      <span class="proj-head"><span class="proj-dot"></span><span class="proj-name">${tt.label}</span></span>
      <span class="proj-meta">${meta}</span>
    </button>`;
  }).join('');
}

// ── Section sheet ─────────────────────────────────────────────────────────────
/* Sections are addressed by index, never by interpolating their text into an
   onclick — several of them contain "|" and spaces. */
function openProj(key) {
  const tt = typeOf(key);
  if (!tt) return;
  const color = resolveColor(key);
  const sheet = $id('proj-sheet');
  sheet.style.setProperty('--sheet-color', color);
  $id('proj-sheet-name').textContent = tt.label;
  $id('proj-sheet-subs').innerHTML = tt.subs.map((s, i) =>
    `<button class="sub-btn" onclick="PLAN.pickSub('${key}',${i})">${esc(s.display)}</button>`).join('');
  $id('proj-back').classList.add('on');
  sheet.classList.add('on');
}

function closeProj() {
  $id('proj-back').classList.remove('on');
  $id('proj-sheet').classList.remove('on');
}

function pickSub(key, i) {
  const tt = typeOf(key);
  const s = tt && tt.subs[i];
  if (!s) return;
  closeProj();
  openForm(key, s.display, s.section);
}

// ── Queue ─────────────────────────────────────────────────────────────────────
function renderQueue() {
  const list = $id('queue-list');
  const empty = $id('queue-empty-msg');
  const sendBtn = $id('btn-send');
  const n = queue.length;

  $id('queue-count').textContent = n ? `${n} task${n!==1?'s':''}` : 'empty';
  $id('queue-clear').classList.toggle('hidden', !n);

  if (!n) {
    list.innerHTML = '';
    empty.classList.remove('hidden');
    sendBtn.disabled = true;
    sendBtn.textContent = 'send to todoist';
    return;
  }
  empty.classList.add('hidden');
  sendBtn.disabled = false;
  sendBtn.textContent = `send ${n} task${n!==1?'s':''} to todoist`;

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

function removeFromQueue(i) { queue.splice(i,1); saveQueue(); renderQueue(); renderProjects(); }
function clearQueue() {
  if(!Shell.confirm('Clear all queued tasks?')) return;
  queue=[]; saveQueue(); renderQueue(); renderProjects(); toast('Queue cleared');
}

// ── Form ──────────────────────────────────────────────────────────────────────
function openForm(typeKey, display, section) {
  try {
    const tt = typeOf(typeKey);
    if (!tt) { toast('Unknown project: ' + typeKey); return; }
    const color = resolveColor(typeKey);
    formState = { typeKey, subType: display, section, block: null, time: null, priority: 2, subtasks: [], hasSub: false };
    $id('s-form').style.setProperty('--proj-color', color);
    $id('form-dot').style.background = color;
    $id('form-ctx-txt').innerHTML = `<em>${esc(tt.label)}</em> · ${esc(display)}`;
    go('form');
  } catch(err) { toast('Error: ' + err.message); console.error(err); }
}

function renderForm() {
  resetOpts('opts-block', formState.block);
  resetOpts('opts-time', formState.time);
  const prios = $all('.prio-b');
  prios.forEach(b => b.classList.remove('on'));
  const di = defaultPrioIndex();
  if (prios[di]) prios[di].classList.add('on');
  formState.priority = Config.get('plan.defaultPriority');
  setSub(false);
  formState.subtasks = [];
  renderSubtasks();
  $id('task-name').value = '';
  $id('sub-text').value = '';
}

function resetOpts(id, activeVal) {
  const row = $id(id);
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

  // a block chip wears its Todoist label's colour, like DO's block tiles
  const ob = $id('opts-block');
  if (ob) ob.innerHTML = blocks.map(b => {
    const c = labelHue(b);
    return `<button class="opt-b${c ? ' lbl' : ''}"${c ? ` style="--c:${esc(c)}"` : ''} onclick="PLAN.optPick(this,'block','${attr(b)}')">${esc(b)}</button>`;
  }).join('') + none('block');

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

function optPick(btn, field, val) {
  const row = btn.parentElement;
  row.querySelectorAll('.opt-b').forEach(b=>b.classList.remove('on'));
  btn.classList.add('on');
  formState[field] = val;
}

function prioPick(btn, val) {
  $all('.prio-b').forEach(b=>b.classList.remove('on'));
  btn.classList.add('on');
  formState.priority = val;
}

function setSub(on) {
  formState.hasSub = on;
  $id('tg-sub').querySelectorAll('.tg2-b').forEach((b,i)=>
    b.classList.toggle('on', on ? i===0 : i===1));
  $id('sub-input').classList.toggle('hidden', !on);
}

function addSubtask() {
  const inp = $id('sub-text');
  const txt = inp.value.trim(); if(!txt) return;
  formState.subtasks.push(txt); inp.value = ''; renderSubtasks();
}

function deleteSubtask(i) { formState.subtasks.splice(i,1); renderSubtasks(); }

function renderSubtasks() {
  $id('st-list').innerHTML = formState.subtasks.map((s,i)=>`
    <div class="st-item">
      <span class="st-item-txt">${esc(s)}</span>
      <button class="st-del" onclick="PLAN.deleteSubtask(${i})">✕</button>
    </div>`).join('');
}

function addToQueue() {
  const raw = $id('task-name').value.trim();
  const tt = typeOf(formState.typeKey);
  const name = raw ? raw : formState.subType;
  const map = mappings[formState.typeKey] || {};
  if (!map.projectId) {
    if (!confirm('No project mapped for '+formState.typeKey+'. Add anyway? It will go to inbox.')) return;
  }
  queue.push({ name, typeKey:formState.typeKey, subType:formState.subType, section:formState.section,
    projectLabel:tt.pLabel, projectId:map.projectId||null, block:formState.block, time:formState.time,
    priority:formState.priority, subtasks:[...formState.subtasks] });
  saveQueue(); toast('Added to queue'); go('home');
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
  home: () => go('home'),   // the PLAN tab tapped while on PLAN
  // the label colours: cached for an hour, refreshed here; only the home
  // screen is redrawn (the form's chips would lose their selection)
  onShow: () => { if (window.Todoist) Todoist.labels().then(() => {
    if ($id('s-home').classList.contains('on')) { renderProjects(); renderFormChips(); }
  }); },
});

return { go, renderSettings, openProj, closeProj, pickSub,
         clearQueue, removeFromQueue, optPick, prioPick, setSub, addSubtask,
         deleteSubtask, addToQueue, connectTodoist, saveMappings, plannedToday };
})();
