/* qurOS — DAY, the day log. The flex rules are requirements, not style:
   nothing turns red or says "failed", there are no streaks (only "X of 7
   this week"), a minimum is done — the same check as full — one next action
   leads, and a bad day collapses everything to its minimums. The two clock
   times are wake and bed; there is no schedule. */
(() => {
const Q = window.Q, { $, esc, icon, today, fmtDay, addDays, weekDays, weekKey, nowHm, minutesOf, slept, fmtMins, uid, vibrate } = Q.u;
const S = () => Q.settings.get();

let cur = null;           // the date on screen
let showAll = false;      // a bad day hides the rest until asked

const getDay = () => Q.m.day(cur);
function save(d) { Q.m.saveDay(d); render(); Q.app.badge(); }
const done = v => v === 'full' || v === 'min';
const weekOf = (date, fn) => weekDays(date).filter(x => x <= today()).filter(x => fn(Q.m.day(x))).length;

/* a step that another log already answers is filled in from it — never
   overwritten once someone has set it by hand */
function autoChain(d, flag, v) {
  const step = S().chain.find(s => s[flag]);
  if (step && !d.chain[step.id]) d.chain[step.id] = v;
}

function nextAction(d) {
  const chain = S().chain;
  for (let i = 0; i < chain.length; i++) if (!d.chain[chain[i].id]) return { type: 'chain', step: chain[i], i, n: chain.length };
  if (!d.bad) { const g = d.goals.find(x => x.state === 'open'); if (g) return { type: 'goal', goal: g }; }
  return null;
}

function carryList() {
  if (cur !== today()) return [];
  const out = [];
  for (let i = 1; i <= 7; i++) {
    const date = addDays(cur, -i), d = Q.db.get('days', date);
    if (d) (d.goals || []).filter(g => g.state === 'open').forEach(g => out.push({ date, g }));
  }
  return out;
}

function render() {
  const el = $('#v-day');
  if (!el) return;
  if (!cur) cur = today();
  const t = today(), d = getDay(), s = S();
  const bad = d.bad && !showAll;
  el.classList.toggle('bad', !!d.bad);
  const chain = s.chain, chainDone = chain.filter(c => done(d.chain[c.id])).length;
  const pom = Object.values(d.focus || {}).reduce((a, b) => a + b, 0);
  const gymWeek = weekOf(cur, x => Q.m.gymLogged(x.gym));
  const [g1, g2] = s.gymTarget;
  const sub = [`${chainDone} of ${chain.length} in the chain`, pom ? `${pom} pomodoro${pom === 1 ? '' : 's'}` : '', `gym ${gymWeek} of ${g1}–${g2} this week`].filter(Boolean).join(' · ');
  const nx = nextAction(d);
  const carry = carryList();
  const prevBed = Q.m.day(addDays(cur, -1)).bed;
  const sl = slept(prevBed, d.wake);

  el.innerHTML = `
  <header class="top">
    <div class="top-row">
      <div class="day-nav">
        <button class="icon-btn" type="button" data-a="prev" aria-label="previous day">${icon('left')}</button>
        <button class="today-btn" type="button" data-a="today">${fmtDay(cur)}${cur === t ? ' · today' : ''}</button>
        <button class="icon-btn" type="button" data-a="next" aria-label="next day" ${cur >= t ? 'disabled' : ''}>${icon('right')}</button>
      </div>
      <button class="bad-btn ${d.bad ? 'on' : ''}" type="button" data-a="bad" aria-pressed="${!!d.bad}">bad day</button>
    </div>
    <h1 class="wm">Day<em>.</em></h1>
    <p class="top-sub">${esc(sub)}</p>
  </header>

  ${d.bad ? `<div class="bad-note">Bad day — minimums only. A minimum counts, the same as full. Nothing here is lost.
    ${showAll ? '<button class="btn sm quiet" type="button" data-a="less">back to minimums</button>' : '<button class="btn sm quiet" type="button" data-a="more">show everything</button>'}</div>` : ''}

  ${carry.length ? `<div class="card carry">
      <div class="label">from before · carry or drop, no penalty either way</div>
      ${carry.map((c, i) => `<div class="row"><div class="row-m"><div class="row-t">${esc(c.g.text)}</div><div class="row-s">${fmtDay(c.date)}</div></div>
        <button class="btn sm go" type="button" data-a="carry" data-i="${i}">carry</button><button class="btn sm" type="button" data-a="drop" data-i="${i}">drop</button></div>`).join('')}
      ${carry.length > 1 ? `<div class="btns end"><button class="btn sm" type="button" data-a="carry-all">carry all</button><button class="btn sm quiet" type="button" data-a="drop-all">drop all</button></div>` : ''}
    </div>` : ''}

  ${nextCard(d, nx)}

  <div class="sec-h">anchors<em>wake target ${esc(s.wakeTarget || '—')}${s.bedTarget ? ' · bed ' + esc(s.bedTarget) : ''}</em></div>
  <div class="anchors">
    <div class="anchor">
      <span class="label">wake</span>
      <input class="a-v field-bare ${d.wake ? '' : 'none'}" type="time" data-f="wake" value="${esc(d.wake)}" aria-label="wake time">
      <div class="a-row"><button class="btn sm" type="button" data-a="now" data-f="wake">now</button>${d.wake ? `<button class="btn sm quiet" type="button" data-a="clear" data-f="wake">clear</button>` : ''}</div>
      <span class="a-s">${sl ? 'slept ' + fmtMins(sl) : prevBed ? 'bed ' + esc(prevBed) + ' last night' : 'one tap when you\'re up'}</span>
    </div>
    <div class="anchor">
      <span class="label">bed${cur === t ? ' · tonight' : ''}</span>
      <input class="a-v field-bare ${d.bed ? '' : 'none'}" type="time" data-f="bed" value="${esc(d.bed)}" aria-label="bed time">
      <div class="a-row"><button class="btn sm" type="button" data-a="now" data-f="bed">now</button>${d.bed ? `<button class="btn sm quiet" type="button" data-a="clear" data-f="bed">clear</button>` : ''}</div>
      <span class="a-s">${s.bedTarget ? 'target ' + esc(s.bedTarget) : 'lights out'}</span>
    </div>
  </div>

  ${bad ? '' : goalsBlock(d)}

  <div class="sec-h">morning chain<em>${chainDone} of ${chain.length}${d.bad ? ' · minimums' : ''}</em></div>
  <div class="chain">${chain.map((c, i) => chainRow(d, c, nx && nx.type === 'chain' && nx.i === i)).join('')}</div>

  <div class="sec-h">hygiene<em>${S().hygiene.filter(h => d.hyg[h.id]).length} of ${S().hygiene.length}${bad ? ' · shower is the minimum' : ''}</em></div>
  <div class="chips">${(bad ? S().hygiene.slice(0, 1) : S().hygiene).map(h => {
    const wk = weekOf(cur, x => x.hyg && x.hyg[h.id]);
    return `<button class="chip ${d.hyg[h.id] ? 'on' : ''}" type="button" data-a="hyg" data-id="${esc(h.id)}">${esc(h.name)}<small>${wk}/7</small></button>`;
  }).join('')}</div>

  ${bad ? '' : focusBlock(d)}

  ${gymBlock(d, gymWeek)}

  ${bad ? '' : mealsBlock(d)}

  <div class="sec-h">check-in<em>1 low · 5 high</em></div>
  ${S().scales.map(sc => `<div class="scale-r"><b>${esc(sc)}</b><div class="dots">${[1, 2, 3, 4, 5].map(n =>
    `<button type="button" data-a="scale" data-k="${esc(sc)}" data-n="${n}" class="${d.scales[sc] === n ? 'on' : ''}" aria-label="${esc(sc)} ${n}">${n}</button>`).join('')}</div></div>`).join('')}

  <div class="sec-h">evening<em>prep for tomorrow, then the dump</em></div>
  ${S().prep.map(p => `<div class="row"><button class="ck ${d.prep[p.id] ? 'on' : ''}" type="button" data-a="prep" data-id="${esc(p.id)}" aria-label="${esc(p.name)}">${icon('check')}</button>
    <div class="row-m"><div class="row-t">${esc(p.name)}</div></div></div>`).join('')}
  <div class="btns">
    <button class="btn go" type="button" data-a="evening">${icon('mic')}evening dump${eveningCount() ? ` · ${eveningCount()}` : ''}</button>
    <button class="btn" type="button" data-a="evening-w">${icon('pen')}write it</button>
  </div>
  `;
}
const eveningCount = () => Q.db.all('entries').filter(e => e.day === cur && e.kind === 'evening').length;

function nextCard(d, nx) {
  if (!nx) {
    return `<div class="next-card calm"><div class="nc-k">next</div>
      <div class="nc-t">${cur === today() ? 'Nothing pressing.' : 'This day is filled in.'}</div>
      <div class="nc-s">${cur === today() ? 'The chain is through. Capture something while it\'s fresh?' : ''}</div>
      ${cur === today() ? `<div class="btns"><button class="btn go sm" type="button" data-a="talk">${icon('mic')}talk</button></div>` : ''}</div>`;
  }
  if (nx.type === 'goal') {
    return `<div class="next-card"><div class="nc-k">next · goal</div><div class="nc-t">${esc(nx.goal.text)}</div>
      <div class="btns"><button class="btn go sm" type="button" data-a="goal" data-id="${esc(nx.goal.id)}">done</button></div></div>`;
  }
  const st = nx.step;
  return `<div class="next-card"><div class="nc-k">next · ${nx.i + 1} of ${nx.n}</div>
    <div class="nc-t">${esc(st.name)}</div>
    <div class="nc-s">${d.bad ? 'minimum: ' + esc(st.min) : `${esc(st.full)}<br>minimum: ${esc(st.min)}`}</div>
    <div class="btns">
      ${st.talk ? `<button class="btn go sm" type="button" data-a="walk-talk">${icon('mic')}talk on the way</button>` : ''}
      ${st.gym ? `<button class="btn go sm" type="button" data-a="gym">${icon('dumbbell')}open gym</button>` : ''}
      ${d.bad ? '' : `<button class="btn sm ${st.talk || st.gym ? '' : 'go'}" type="button" data-a="chain" data-id="${esc(st.id)}" data-v="full">done</button>`}
      <button class="btn sm ${d.bad && !st.talk && !st.gym ? 'go' : ''}" type="button" data-a="chain" data-id="${esc(st.id)}" data-v="min">${d.bad ? 'done (minimum)' : 'minimum'}</button>
      <button class="btn sm" type="button" data-a="chain" data-id="${esc(st.id)}" data-v="skip">not today</button>
    </div></div>`;
}

function chainRow(d, c, isNext) {
  const v = d.chain[c.id];
  const wk = weekOf(cur, x => done(x.chain && x.chain[c.id]));
  const bad = d.bad && !showAll;
  return `<div class="row ${isNext ? 'next' : ''} ${v ? 'marked' : ''}">
    <div class="row-m"><div class="row-t">${esc(c.name)}${isNext ? '<span class="tag">next</span>' : ''}${v === 'skip' ? '<span class="tag ghost">not today</span>' : ''}</div>
      <div class="row-s">${bad ? 'min: ' + esc(c.min) : esc(c.full) + ' · min: ' + esc(c.min)}</div></div>
    <span class="row-r">${wk}/7</span>
    <div class="chain-seg">${bad
      ? `<button type="button" data-a="chain" data-id="${esc(c.id)}" data-v="${done(v) ? v : 'min'}" class="${done(v) ? 'on' : ''}">done</button>`
      : `<button type="button" data-a="chain" data-id="${esc(c.id)}" data-v="full" class="${v === 'full' ? 'on' : ''}">full</button><button type="button" data-a="chain" data-id="${esc(c.id)}" data-v="min" class="${v === 'min' ? 'on' : ''}">min</button>`}</div>
  </div>`;
}

function goalsBlock(d) {
  const wk = weekKey(cur), wg = Q.m.weekGoals(wk);
  const live = d.goals.filter(g => g.state === 'open' || g.state === 'done');
  const doneN = live.filter(g => g.state === 'done').length;
  return `<div class="sec-h">goals<em>${live.length ? `${doneN} of ${live.length} today` : 'up to three, small ones'}</em></div>
  <div class="week-strip">
    ${wg.map(g => `<div class="row"><button class="ck ${g.done ? 'on' : ''}" type="button" data-a="wgoal" data-id="${esc(g.id)}">${icon('check')}</button>
      <div class="row-m"><div class="row-t">${esc(g.text)}</div><div class="row-s">this week</div></div>
      <button class="icon-btn" type="button" data-a="wgoal-x" data-id="${esc(g.id)}" aria-label="remove">${icon('x')}</button></div>`).join('')}
  </div>
  ${d.goals.map(g => `<div class="row ${g.state === 'dropped' || g.state === 'carried' ? 'dim' : ''}">
      <button class="ck ${g.state === 'done' ? 'on' : ''}" type="button" data-a="goal" data-id="${esc(g.id)}" ${g.state === 'carried' ? 'disabled' : ''}>${icon('check')}</button>
      <div class="row-m"><div class="row-t">${esc(g.text)}${g.state === 'dropped' ? '<span class="tag ghost">dropped</span>' : g.state === 'carried' ? '<span class="tag ghost">carried</span>' : ''}</div>${g.from ? `<div class="row-s">carried from ${fmtDay(g.from)}</div>` : ''}</div>
      ${g.state === 'open' ? `<button class="icon-btn" type="button" data-a="goal-drop" data-id="${esc(g.id)}" aria-label="drop">${icon('x')}</button>` : g.state === 'dropped' ? `<button class="icon-btn" type="button" data-a="goal-back" data-id="${esc(g.id)}" aria-label="bring back">${icon('undo')}</button>` : ''}
    </div>`).join('')}
  ${live.length < 3 ? `<div class="goal-add"><input class="field" type="text" data-f="goal" placeholder="a goal for today…" enterkeyhint="done" maxlength="120"><button class="btn go" type="button" data-a="goal-add">${icon('plus')}</button></div>
    <p class="fine">make it small enough to start in two minutes — "1 pomodoro on CAP chapter 1", not "do the CAP".</p>`
    : '<p class="fine">three is the cap — tick one off or drop one to add another.</p>'}
  ${wg.length < 3 ? `<div class="btns"><button class="btn sm quiet" type="button" data-a="wgoal-add">${icon('plus')}week goal (${wg.length} of 3)</button></div>` : ''}`;
}

function focusBlock(d) {
  const areas = S().areas;
  const total = areas.reduce((a, x) => a + (d.focus[x] || 0), 0);
  const wkTotal = x => weekDays(cur).filter(y => y <= today()).reduce((a, y) => a + ((Q.m.day(y).focus || {})[x] || 0), 0);
  return `<div class="sec-h">focus<em>${total} pomodoro${total === 1 ? '' : 's'} today</em></div>
  ${areas.map(x => `<div class="focus-r"><div class="row-m"><b>${esc(x)}</b><div class="row-s">${wkTotal(x)} this week</div></div>
    <div class="stepper"><button type="button" data-a="focus" data-k="${esc(x)}" data-n="-1" aria-label="one less">${icon('minus')}</button><b>${d.focus[x] || 0}</b>
    <button type="button" data-a="focus" data-k="${esc(x)}" data-n="1" aria-label="one more">${icon('plus')}</button></div></div>`).join('')}`;
}

function gymBlock(d, gymWeek) {
  const [g1, g2] = S().gymTarget;
  const moved = weekOf(cur, x => Q.m.gymLogged(x.gym) || done(x.chain && x.chain.walk));
  const g = d.gym, logged = Q.m.gymLogged(g);
  const sug = Q.gym.suggest(cur);
  let big, line;
  if (logged) {
    const sets = (g.ex || []).reduce((a, x) => a + x.sets.filter(s => s.done).length, 0);
    big = g.plan === 'min' ? 'min' : g.plan;
    line = g.plan === 'min' ? 'minimum session — counts' : `day ${g.plan} · ${sets} set${sets === 1 ? '' : 's'} logged`;
  } else {
    big = sug.plan;
    line = sug.last ? `day ${sug.plan} next — ${sug.last.plan} was ${fmtDay(sug.last.date)}` : `day ${sug.plan} to start`;
  }
  return `<div class="sec-h">gym<em>${gymWeek} of ${g1}–${g2} this week · moved ${moved} of 7</em></div>
  <div class="card gym-sum"><span class="gs-big">${esc(big)}</span><div class="row-m"><div class="row-t">${esc(line)}</div>
    <div class="row-s">${logged ? 'tap to see or add sets' : 'a minimum session counts as a gym day'}</div></div>
    <button class="btn ${logged ? '' : 'go'} sm" type="button" data-a="gym">${logged ? 'open' : 'log'}</button></div>`;
}

function mealsBlock(d) {
  return `<div class="sec-h">meals<em>${d.meals.length ? d.meals.length + ' logged' : 'what you ate, roughly'}</em></div>
  <div class="chips meal-chips">${d.meals.map(m => `<span class="chip on">${esc(m.slot ? m.slot + ' · ' : '')}${esc(m.text)}<button class="x icon-btn" style="width:22px;height:22px" type="button" data-a="meal-x" data-id="${esc(m.id)}" aria-label="remove">${icon('x')}</button></span>`).join('')}
  <button class="chip" type="button" data-a="meal">${icon('plus')}meal</button></div>`;
}

function mealSheet() {
  const s = S(), h = new Date().getHours();
  let slot = h < 11 ? s.slots[0] : h < 16 ? s.slots[1] : s.slots[2] || s.slots[0];
  const recent = [];
  Q.db.all('days').sort((a, b) => (a.date < b.date ? 1 : -1)).forEach(x => (x.meals || []).forEach(m => {
    if (recent.length < 14 && !recent.some(r => r.toLowerCase() === m.text.toLowerCase())) recent.push(m.text);
  }));
  const sh = Q.ui.sheet({
    title: 'meal',
    body: `<div class="seg" data-slots>${s.slots.map(x => `<button type="button" data-s="${esc(x)}" class="${x === slot ? 'on' : ''}">${esc(x)}</button>`).join('')}</div>
      <div class="goal-add" style="margin-top:14px"><input class="field" type="text" placeholder="what was it?" enterkeyhint="done" maxlength="100"><button class="btn go" type="button" data-add>${icon('plus')}</button></div>
      ${recent.length ? `<div class="pick-g">again</div><div class="chips">${recent.map((r, i) => `<button class="chip" type="button" data-r="${i}">${esc(r)}</button>`).join('')}</div>` : ''}`,
  });
  const inp = sh.el.querySelector('input');
  const add = text => {
    text = String(text || '').trim();
    if (!text) return;
    const d = getDay();
    d.meals.push({ id: uid('m'), slot, text });
    sh.close(); save(d);
  };
  sh.el.querySelector('[data-slots]').addEventListener('click', e => {
    const b = e.target.closest('[data-s]'); if (!b) return;
    slot = b.dataset.s;
    sh.el.querySelectorAll('[data-s]').forEach(x => x.classList.toggle('on', x === b));
  });
  sh.el.querySelector('[data-add]').onclick = () => add(inp.value);
  inp.addEventListener('keydown', e => { if (e.key === 'Enter') add(inp.value); });
  sh.el.querySelectorAll('[data-r]').forEach(b => { b.onclick = () => add(recent[+b.dataset.r]); });
}

function weekGoalSheet() {
  const sh = Q.ui.sheet({
    title: 'week goal',
    body: `<p class="fine">Up to three for the week (${weekKey(cur)}). They sit above the day's goals.</p>
      <div class="goal-add"><input class="field" type="text" placeholder="a goal for this week…" enterkeyhint="done" maxlength="120"><button class="btn go" type="button" data-add>${icon('plus')}</button></div>`,
  });
  const inp = sh.el.querySelector('input');
  const add = () => {
    const v = inp.value.trim(); if (!v) return;
    const wk = weekKey(cur), list = Q.m.weekGoals(wk).slice();
    if (list.length >= 3) return;
    list.push({ id: uid('w'), text: v, done: false });
    Q.m.setWeekGoals(wk, list);
    sh.close(); render();
  };
  sh.el.querySelector('[data-add]').onclick = add;
  inp.addEventListener('keydown', e => { if (e.key === 'Enter') add(); });
  setTimeout(() => inp.focus(), 250);
}

function onClick(e) {
  const b = e.target.closest('[data-a]');
  const root = $('#v-day');
  if (!b || !root.contains(b)) return;
  const a = b.dataset.a, id = b.dataset.id;
  const d = getDay();
  const t = today();
  switch (a) {
    case 'prev': cur = addDays(cur, -1); showAll = false; render(); root.scrollTop = 0; return;
    case 'next': if (cur < t) { cur = addDays(cur, 1); showAll = false; render(); root.scrollTop = 0; } return;
    case 'today': cur = t; showAll = false; render(); return;
    case 'bad': d.bad = !d.bad; showAll = false; vibrate(15); save(d); return;
    case 'more': showAll = true; render(); return;
    case 'less': showAll = false; render(); return;
    case 'now': setTime(d, b.dataset.f, nowHm()); return;
    case 'clear': d[b.dataset.f] = ''; save(d); return;
    case 'chain': {
      const v = b.dataset.v;
      d.chain[id] = d.chain[id] === v ? undefined : v;
      if (!d.chain[id]) delete d.chain[id];
      if (done(d.chain[id])) vibrate(12);
      save(d); return;
    }
    case 'hyg': {
      d.hyg[id] = !d.hyg[id];
      if (!d.hyg[id]) delete d.hyg[id];
      const req = S().hygiene.filter(h => h.id !== 'shave');
      if (d.hyg[id]) autoChain(d, 'hyg', req.every(h => d.hyg[h.id]) ? 'full' : 'min');
      if (req.every(h => d.hyg[h.id])) { const st = S().chain.find(s => s.hyg); if (st && d.chain[st.id] === 'min') d.chain[st.id] = 'full'; }
      save(d); return;
    }
    case 'focus': {
      const k = b.dataset.k, n = +b.dataset.n;
      d.focus[k] = Math.max(0, (d.focus[k] || 0) + n);
      if (!d.focus[k]) delete d.focus[k];
      if (n > 0) { const st = S().chain.find(s => s.focus === k); if (st && !d.chain[st.id]) d.chain[st.id] = 'full'; }
      save(d); return;
    }
    case 'scale': { const k = b.dataset.k, n = +b.dataset.n; d.scales[k] = d.scales[k] === n ? undefined : n; if (!d.scales[k]) delete d.scales[k]; save(d); return; }
    case 'prep': d.prep[id] = !d.prep[id]; if (!d.prep[id]) delete d.prep[id]; save(d); return;
    case 'goal': {
      const g = d.goals.find(x => x.id === id);
      if (!g || g.state === 'carried') return;
      g.state = g.state === 'done' ? 'open' : 'done';
      if (g.state === 'done') vibrate(12);
      save(d); return;
    }
    case 'goal-drop': { const g = d.goals.find(x => x.id === id); if (g) { g.state = 'dropped'; save(d); } return; }
    case 'goal-back': {
      const g = d.goals.find(x => x.id === id);
      if (g && d.goals.filter(x => x.state === 'open' || x.state === 'done').length < 3) { g.state = 'open'; save(d); }
      else Q.ui.toast('three is the cap for a day');
      return;
    }
    case 'goal-add': addGoal(); return;
    case 'wgoal': case 'wgoal-x': {
      const wk = weekKey(cur), list = Q.m.weekGoals(wk).map(x => Object.assign({}, x));
      const i = list.findIndex(x => x.id === id);
      if (i < 0) return;
      if (a === 'wgoal') list[i].done = !list[i].done; else list.splice(i, 1);
      Q.m.setWeekGoals(wk, list); render(); return;
    }
    case 'wgoal-add': weekGoalSheet(); return;
    case 'carry': case 'drop': resolveCarry([carryList()[+b.dataset.i]], a); return;
    case 'carry-all': resolveCarry(carryList(), 'carry'); return;
    case 'drop-all': resolveCarry(carryList(), 'drop'); return;
    case 'gym': Q.gym.open(cur); return;
    case 'meal': mealSheet(); return;
    case 'meal-x': d.meals = d.meals.filter(m => m.id !== id); save(d); return;
    case 'talk': Q.rec.talk({}); return;
    case 'walk-talk': {
      /* the walk is where the map gets talked through: one tap, the next untouched item */
      const nx = Q.m.mapNext();
      const step = S().chain.find(s => s.talk);
      Q.rec.talk({ topic: nx ? Q.m.topicFor(nx.section, nx.item) : null,
        onSaved: () => { const dd = getDay(); if (step && !dd.chain[step.id]) { dd.chain[step.id] = 'full'; save(dd); } } });
      return;
    }
    case 'evening': Q.rec.talk({ kind: 'evening' }); return;
    case 'evening-w': Q.rec.write({ kind: 'evening' }); return;
  }
}
function setTime(d, f, v) {
  d[f] = v;
  if (f === 'wake' && v) {
    const tgt = minutesOf(S().wakeTarget), m = minutesOf(v);
    autoChain(d, 'wake', tgt != null && m != null && m <= tgt + 15 ? 'full' : 'min');
  }
  save(d);
}
function addGoal() {
  const inp = $('#v-day [data-f="goal"]');
  const v = inp && inp.value.trim();
  if (!v) return;
  const d = getDay();
  if (d.goals.filter(x => x.state === 'open' || x.state === 'done').length >= 3) { Q.ui.toast('three is the cap for a day'); return; }
  d.goals.push({ id: uid('g'), text: v, state: 'open' });
  save(d);
  const again = $('#v-day [data-f="goal"]');
  if (again) again.focus();
}
function resolveCarry(list, how) {
  const d = getDay();
  list.filter(Boolean).forEach(({ date, g }) => {
    const old = Q.m.day(date);
    const og = old.goals.find(x => x.id === g.id);
    if (!og) return;
    og.state = how === 'carry' ? 'carried' : 'dropped';
    Q.m.saveDay(old);
    if (how === 'carry' && d.goals.filter(x => x.state === 'open' || x.state === 'done').length < 3) {
      d.goals.push({ id: uid('g'), text: g.text, state: 'open', from: date });
    } else if (how === 'carry') {
      og.state = 'open'; Q.m.saveDay(old);
      Q.ui.toast('three is the cap for today — it stays where it was');
    }
  });
  save(d);
}
function onChange(e) {
  const f = e.target.dataset && e.target.dataset.f;
  if (!f || !$('#v-day').contains(e.target)) return;
  if (f === 'wake' || f === 'bed') setTime(getDay(), f, e.target.value);
}
function onKey(e) {
  if (e.key === 'Enter' && e.target.dataset && e.target.dataset.f === 'goal') addGoal();
}

Q.day = { render, onClick, onChange, onKey, nextAction, go: date => { cur = date; render(); }, cur: () => cur || today() };
})();
