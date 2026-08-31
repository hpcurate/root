/* ── PLAN ─────────────────────────────────────────────────────────────────────
   Build a queue of tasks against a project/section map, then push the batch to
   Todoist through the worker proxy. Logic is unchanged from plan/index.html.
   Merge-only changes: one IIFE published as window.PLAN, DOM lookups scoped to
   .ns-plan, the slide scrolls instead of the window, toast() goes to the shell,
   and the settings button is plain markup rather than one injected on every
   home render. Storage keys are untouched: plan_queue, plan_mappings,
   plan_projects, plan_sections, plan_token. */
window.PLAN = (function () {
'use strict';

const SCOPE = '.ns-plan ';
const view  = document.getElementById('view-plan');
const $id   = id  => document.querySelector(SCOPE + '#' + id);
const $all  = sel => document.querySelectorAll(SCOPE + sel);
const toast = msg => Shell.toast(msg);

// ── Task types ────────────────────────────────────────────────────────────────
const TASK_TYPES = [
  { key:'curate', label:'curate', pLabel:'curate', color:'#A78BFA',
    subs:[
      { display:'mixing',     section:'mixing' },
      { display:'production', section:'production' },
      { display:'socials',    section:'socials' },
    ]},
  { key:'alive',  label:'alive',  pLabel:'alive',  color:'#b8255f',
    subs:[
      { display:'kamo',        section:'kamo' },
      { display:'activities',  section:'activities' },
      { display:'create',      section:'create' },
      { display:'music',       section:'music' },
      { display:'social',      section:'social' },
      { display:'movie | show',section:'movie | show' },
      { display:'raves',       section:'raves' },
      { display:'trip',        section:'trip' },
    ]},
  { key:'admin',  label:'admin',  pLabel:'admin',  color:'#808080',
    subs:[
      { display:'tasks', section:'admin | tasks' },
      { display:'rdv',   section:'admin | rdv' },
      { display:'calls', section:'admin | calls' },
    ]},
  { key:'system', label:'system', pLabel:'system', color:'#158fad',
    subs:[
      { display:'update',   section:'system | update' },
      { display:'projects', section:'system | projects' },
    ]},
  { key:'home',   label:'home',   pLabel:'home',   color:'#4073ff',
    subs:[
      { display:'food',      section:'home | food' },
      { display:'projects',  section:'home | projects' },
      { display:'chores',    section:'home | chores' },
      { display:'groceries', section:'home | groceries' },
    ]},
  { key:'edu',    label:'edu',    pLabel:'edu',    color:'#e05194',
    subs:[
      { display:'study',    section:'study' },
      { display:'practice', section:'practice' },
      { display:'exam',     section:'exam' },
      { display:'rdv',      section:'rdv' },
    ]},
];

function resolveColor(typeKey) {
  return TASK_TYPES.find(t => t.key === typeKey)?.color || '#4a4a4a';
}

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
function getToken() { return localStorage.getItem('plan_token') || ''; }
function saveToken(t) { localStorage.setItem('plan_token', t); }

// ── Navigation ────────────────────────────────────────────────────────────────
function go(id) {
  $all('.scr').forEach(s=>s.classList.remove('on'));
  $id('s-'+id).classList.add('on');
  if (view) view.scrollTop = 0;
  if (id==='home')     renderHome();
  if (id==='form')     renderForm();
  if (id==='settings') renderSettings();
  if (id==='sending')  startSending();
}

// ── Home ──────────────────────────────────────────────────────────────────────
function renderHome() {
  $id('home-date').textContent =
    new Date().toLocaleDateString('en-GB',{weekday:'long',day:'numeric',month:'long',year:'numeric'}).toUpperCase();
  renderProjects();
  renderQueue();
}

function renderProjects() {
  const list = $id('proj-list');
  list.innerHTML = '';
  TASK_TYPES.forEach(tt => {
    const color = resolveColor(tt.key);
    const card = document.createElement('div');
    card.className = 'proj-card';
    card.id = 'proj-' + tt.key;
    card.style.setProperty('--proj-color', color);

    const header = document.createElement('div');
    header.className = 'proj-header';
    header.innerHTML = `<div class="proj-dot"></div><div class="proj-name">${tt.label}</div><div class="proj-arrow">›</div>`;
    header.addEventListener('click', () => toggleProj(tt.key));

    const subs = document.createElement('div');
    subs.className = 'proj-subs';
    tt.subs.forEach(s => {
      const btn = document.createElement('button');
      btn.className = 'sub-btn';
      btn.textContent = s.display;
      btn.addEventListener('click', e => { e.stopPropagation(); openForm(tt.key, s.display, s.section); });
      subs.appendChild(btn);
    });

    card.appendChild(header);
    card.appendChild(subs);
    list.appendChild(card);
  });
}

function toggleProj(key) {
  const card = $id('proj-'+key);
  const wasOpen = card.classList.contains('open');
  $all('.proj-card').forEach(c=>c.classList.remove('open'));
  if (!wasOpen) card.classList.add('open');
}

// ── Queue ─────────────────────────────────────────────────────────────────────
function renderQueue() {
  const section = $id('queue-section');
  const emptyMsg = $id('queue-empty-msg');
  const list = $id('queue-list');
  const sendBtn = $id('btn-send');
  const n = queue.length;

  if (!n) {
    section.classList.add('hidden'); emptyMsg.classList.remove('hidden');
    sendBtn.disabled = true; sendBtn.textContent = 'send to todoist'; return;
  }
  section.classList.remove('hidden'); emptyMsg.classList.add('hidden');
  sendBtn.disabled = false;
  $id('queue-title').textContent = `queue (${n})`;
  sendBtn.textContent = `send ${n} task${n!==1?'s':''} to todoist`;

  list.innerHTML = queue.map((t,i) => {
    const color = resolveColor(t.typeKey);
    const pills = [t.subType, t.block ? `@${t.block}` : null, t.time ? `@${t.time}` : null,
      ['','urgent','mandatory','optional'][t.priority] || null].filter(Boolean);
    const stLine = t.subtasks?.length ? `<div class="q-pill">${t.subtasks.length} subtask${t.subtasks.length!==1?'s':''}</div>` : '';
    return `<div class="q-item">
      <div class="q-item-body">
        <div class="q-item-name">${esc(t.name)}</div>
        <div class="q-item-meta">
          <div class="q-pill hl" style="color:${color}">${t.typeKey}</div>
          ${pills.map(p=>`<div class="q-pill">${esc(p)}</div>`).join('')}
          ${stLine}
        </div>
      </div>
      <button class="q-del" onclick="PLAN.removeFromQueue(${i})">✕</button>
    </div>`;
  }).join('');
}

function removeFromQueue(i) { queue.splice(i,1); saveQueue(); renderQueue(); }
function clearQueue() { if(!confirm('Clear all queued tasks?')) return; queue=[]; saveQueue(); renderQueue(); toast('Queue cleared'); }

// ── Form ──────────────────────────────────────────────────────────────────────
function openForm(typeKey, display, section) {
  try {
    const tt = TASK_TYPES.find(t => t.key === typeKey);
    if (!tt) { toast('Unknown project: ' + typeKey); return; }
    const color = resolveColor(typeKey);
    formState = { typeKey, subType: display, section, block: null, time: null, priority: 2, subtasks: [], hasSub: false };
    $id('s-form').style.setProperty('--proj-color', color);
    $id('form-dot').style.background = color;
    $id('form-ctx-txt').innerHTML = `<em>${tt.label}</em> · ${display}`;
    go('form');
  } catch(err) { toast('Error: ' + err.message); console.error(err); }
}

function renderForm() {
  resetOpts('opts-block', formState.block);
  resetOpts('opts-time', formState.time);
  $all('.prio-b').forEach(b=>b.classList.remove('on'));
  $all('.prio-b')[2].classList.add('on');
  formState.priority = 2;
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
  const tt = TASK_TYPES.find(t=>t.key===formState.typeKey);
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
  const token = getToken();
  if (!token) { toast('No API token'); go('settings'); return; }
  const log = $id('send-log');
  const backBtn = $id('send-back');
  const doneBtn = $id('send-done-btn');
  const title = $id('send-title');
  log.innerHTML = ''; backBtn.disabled = true; doneBtn.classList.add('hidden');
  title.textContent = 'sending…';
  let sectionMap = {};
  try { sectionMap = JSON.parse(localStorage.getItem('plan_sections') || '{}'); } catch {}
  let success = 0, failed = 0;
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
      const res = await fetch('https://todoist-proxy.hp-qrate.workers.dev/api/v1/tasks', {
        method:'POST', headers:{ 'Authorization':'Bearer '+token, 'Content-Type':'application/json' },
        body: JSON.stringify(body),
      });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const created = await res.json();
      success++;
      for (const st of (task.subtasks || [])) {
        const stBody = { content: st, parent_id: created.id, due_string: 'today', priority: task.priority };
        const sr = await fetch('https://todoist-proxy.hp-qrate.workers.dev/api/v1/tasks', {
          method:'POST', headers:{ 'Authorization':'Bearer '+token, 'Content-Type':'application/json' },
          body: JSON.stringify(stBody),
        });
        if (!sr.ok) logLine(log, `  ↳ subtask failed: ${st}`, 'err');
        else logLine(log, `  ↳ ${esc(st)}`, 'ok');
      }
      const lines = log.querySelectorAll('.pending');
      if (lines.length) { const last=lines[lines.length-1]; last.className='ok'; last.textContent='✓ '+esc(task.name); }
    } catch (err) {
      failed++;
      const lines = log.querySelectorAll('.pending');
      if (lines.length) { const last=lines[lines.length-1]; last.className='err'; last.textContent='✗ '+esc(task.name)+' ('+err.message+')'; }
    }
    await sleep(100);
  }
  log.innerHTML += `<div style="margin-top:8px;color:${failed?'var(--re)':'var(--gr)'}">${success} sent${failed?', '+failed+' failed':''}</div>`;
  log.scrollTop = log.scrollHeight;
  title.textContent = failed ? 'done with errors' : 'done';
  backBtn.disabled = false; doneBtn.classList.remove('hidden');
  if (!failed) { queue = []; saveQueue(); }
}

function logLine(container, text, cls) {
  const div = document.createElement('div');
  div.className = cls; div.textContent = text;
  container.appendChild(div); container.scrollTop = container.scrollHeight;
}

const sleep = ms => new Promise(r=>setTimeout(r,ms));

// ── Settings ──────────────────────────────────────────────────────────────────
function renderSettings() {
  const tok = getToken();
  $id('api-token-input').value = tok ? '••••••••••••••••' : '';
  updateConnStatus();
  if (todoistProjects.length) renderMappingRows();
}

function updateConnStatus() {
  const el = $id('conn-status');
  const tok = getToken();
  if (!tok) { el.className='settings-status idle'; el.textContent='not connected'; return; }
  if (todoistProjects.length) {
    el.className='settings-status ok'; el.textContent=`connected · ${todoistProjects.length} projects loaded`;
  } else {
    el.className='settings-status idle'; el.textContent='token set · tap connect to fetch projects';
  }
}

async function connectTodoist() {
  const inp = $id('api-token-input');
  let tok = inp.value.trim();
  if (!tok || tok.startsWith('•')) { tok = getToken(); if (!tok) { toast('Paste your API token first'); return; } }
  const btn = $id('btn-connect');
  btn.textContent = 'fetching…'; btn.disabled = true;
  try {
    const res = await fetch('https://todoist-proxy.hp-qrate.workers.dev/api/v1/projects', {
      headers:{ 'Authorization':'Bearer '+tok }
    });
    if (res.status === 401) throw new Error('invalid token — check and paste again');
    if (res.status === 403) throw new Error('forbidden — token may lack permissions');
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const projData = await res.json();
    const projects = Array.isArray(projData) ? projData : (projData.results || projData.projects || []);
    const secRes = await fetch('https://todoist-proxy.hp-qrate.workers.dev/api/v1/sections', {
      headers:{ 'Authorization':'Bearer '+tok }
    });
    if (secRes.ok) {
      const secData = await secRes.json();
      const sections = Array.isArray(secData) ? secData : (secData.results || secData.sections || []);
      const sectionMap = {};
      sections.forEach(s => { if (!sectionMap[s.project_id]) sectionMap[s.project_id]={}; sectionMap[s.project_id][s.name]=s.id; });
      localStorage.setItem('plan_sections', JSON.stringify(sectionMap));
    }
    saveToken(tok); todoistProjects = projects; saveProjects(); updateConnStatus(); renderMappingRows();
    toast('Connected — map your projects');
  } catch(err) {
    const el = $id('conn-status');
    el.className='settings-status err';
    el.textContent = err.message.includes('fetch')
      ? 'network error — check your connection or try Safari if using another browser'
      : 'error: '+err.message;
  } finally { btn.textContent='connect & fetch projects'; btn.disabled=false; }
}

function renderMappingRows() {
  const sec = $id('map-sec');
  const rows = $id('map-rows');
  const saveBtn = $id('btn-save-map');
  sec.style.display='block'; rows.style.display='block'; saveBtn.classList.remove('hidden');
  rows.innerHTML = TASK_TYPES.map(tt => {
    const current = mappings[tt.key]?.projectId || '';
    const opts = todoistProjects.map(p=>`<option value="${p.id}" ${p.id===current?'selected':''}>${p.name}</option>`).join('');
    return `<div class="f"><label class="lbl">${tt.label}</label>
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

// ── Boot ──────────────────────────────────────────────────────────────────────
loadState();
renderHome();

Shell.register('plan', {});

return { go, clearQueue, removeFromQueue, optPick, prioPick, setSub, addSubtask,
         deleteSubtask, addToQueue, connectTodoist, saveMappings,
         reload: () => location.reload() };
})();
