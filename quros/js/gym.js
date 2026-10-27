/* qurOS — GYM, a sub-screen of DAY. The A/B program alternates: the day
   after A suggests B. Each set is prefilled from the last time that exercise
   was done, so a repeat is one tap; "add weight" shows when every set hit the
   top of the range last time. A minimum session counts as a gym day. The
   session is written as you go — leaving the screen never loses a set. */
(() => {
const Q = window.Q, { esc, icon, fmtDay, weekDays, today, uid, vibrate, slug, dur } = Q.u;
const S = () => Q.settings.get();

function sessions(beforeDate) {
  return Q.db.all('days').filter(d => d.date < beforeDate && Q.m.gymLogged(d.gym)).sort((a, b) => (a.date < b.date ? 1 : -1));
}
function suggest(date) {
  const last = sessions(date).find(d => d.gym.plan === 'A' || d.gym.plan === 'B');
  return { plan: last ? (last.gym.plan === 'A' ? 'B' : 'A') : 'A', last: last ? { plan: last.gym.plan, date: last.date } : null };
}
/* the last time this exercise had sets done, matched by name */
function lastFor(name, beforeDate) {
  const k = slug(name);
  for (const d of sessions(beforeDate)) {
    const x = (d.gym.ex || []).find(e => slug(e.name) === k);
    if (x && x.sets.some(s => s.done)) return { date: d.date, ex: x, sets: x.sets.filter(s => s.done) };
  }
  return null;
}
const topped = (last, ex) => last && last.sets.length >= ex.sets.length && last.sets.every(s => +s.r >= +ex.hi);
const fromProgram = plan => (S().program[plan] || []).map(p => ({ id: uid('x'), name: p.name, unit: p.unit || 'reps', lo: p.lo, hi: p.hi,
  sets: Array.from({ length: Math.max(1, +p.sets || 3) }, () => ({ w: '', r: '', done: false })) }));
const range = x => `${x.sets.length} × ${x.lo === x.hi ? x.lo : x.lo + '–' + x.hi}${x.unit === 's' ? ' s' : ''}`;

let rest = { end: 0, timer: 0, total: 0 };

function open(date) {
  const day = Q.m.day(date);
  if (!day.gym) day.gym = { plan: suggest(date).plan, at: Date.now(), warm: false, minDone: false, ex: fromProgram(suggest(date).plan), note: '' };
  let g = day.gym;
  const persist = () => {
    const d = Q.m.day(date);
    const was = Q.m.gymLogged(d.gym);
    d.gym = g;
    if (Q.m.gymLogged(g)) {
      const step = S().chain.find(s => s.gym);
      if (step && !d.chain[step.id] && !was) d.chain[step.id] = g.plan === 'min' ? 'min' : 'full';
      Q.m.saveDay(d);
    } else if (was || Q.db.get('days', date)) Q.m.saveDay(d);
  };
  if (S().gymAwake) Q.wake.hold('gym');

  Q.ui.screen('gym', {
    title: 'Gym',
    sub: fmtDay(date),
    onClose: () => { stopRest(); Q.wake.release('gym'); Q.app.refresh(); },
    render(scr) {
      const draw = () => {
        const [g1, g2] = S().gymTarget;
        const wk = weekDays(date).filter(x => x <= today()).filter(x => Q.m.gymLogged(Q.m.day(x).gym) || (x === date && Q.m.gymLogged(g))).length;
        const sug = suggest(date);
        scr.setSub(`${fmtDay(date)} · ${wk} of ${g1}–${g2} this week`);
        const prog = S().program;
        const exList = g.ex.map((x, xi) => {
          const last = lastFor(x.name, date);
          const lastTxt = last ? last.sets.map(s => x.unit === 's' ? `${s.r}s` : `${s.w || '–'}×${s.r}`).join(' · ') : 'first time';
          const hint = topped(last, x) ? `<span class="ex-hint">${icon('up')}${x.unit === 's' ? 'add time' : 'add weight'}</span>` : '';
          return `<div class="card ex">
            <div class="ex-h"><b>${esc(x.name)}</b><span>${range(x)}</span>
              <button class="icon-btn" style="width:28px;height:28px" type="button" data-g="ex-x" data-x="${xi}" aria-label="remove exercise">${icon('x')}</button></div>
            <div class="ex-last">last: ${esc(lastTxt)}${last ? ` <span>(${fmtDay(last.date)})</span>` : ''} ${hint}</div>
            ${x.sets.map((s, si) => {
              const ls = last && (last.sets[si] || last.sets[last.sets.length - 1]);
              const pw = ls ? ls.w : '', pr = ls ? ls.r : x.hi;
              return `<div class="set-r ${s.done ? 'done' : ''}">
                <span class="set-n">set ${si + 1}</span>
                ${x.unit === 's' ? '<span class="unit"></span><span></span>' : `<input type="text" inputmode="decimal" data-g="w" data-x="${xi}" data-s="${si}" value="${esc(s.w)}" placeholder="${esc(pw || S().unit)}" aria-label="weight">
                <span class="x">×</span>`}
                <input type="text" inputmode="numeric" data-g="r" data-x="${xi}" data-s="${si}" value="${esc(s.r)}" placeholder="${esc(pr)}" aria-label="${x.unit === 's' ? 'seconds' : 'reps'}">
                <button class="ck ${s.done ? 'on' : ''}" type="button" data-g="set" data-x="${xi}" data-s="${si}" aria-label="set done">${icon('check')}</button>
              </div>`;
            }).join('')}
            <div class="btns"><button class="btn sm quiet" type="button" data-g="set-add" data-x="${xi}">${icon('plus')}set</button></div>
          </div>`;
        }).join('');
        scr.body.innerHTML = `
          <div style="margin-top:16px;display:flex;align-items:center;gap:12px;flex-wrap:wrap">
            <div class="seg">${['A', 'B', 'min'].map(p => `<button type="button" data-g="plan" data-p="${p}" class="${g.plan === p ? 'on' : ''}">${p === 'min' ? 'minimum' : 'day ' + p}</button>`).join('')}</div>
            <span class="fine" style="margin:0">${sug.last ? `${sug.plan} is next · ${sug.last.plan} was ${fmtDay(sug.last.date)}` : `${sug.plan} to start`}</span>
          </div>
          <div class="row" style="margin-top:10px">
            <button class="ck ${g.plan === 'min' ? (g.minDone ? 'on' : '') : (g.warm ? 'on' : '')}" type="button" data-g="${g.plan === 'min' ? 'min' : 'warm'}">${icon('check')}</button>
            <div class="row-m"><div class="row-t">${g.plan === 'min' ? esc(prog.min) : 'warm-up'}</div><div class="row-s">${g.plan === 'min' ? 'the minimum — it counts as a gym day' : esc(prog.warm)}</div></div>
          </div>
          ${g.plan === 'min' ? '<p class="fine">and one exercise, any of them:</p>' : ''}
          ${exList}
          <div class="btns"><button class="btn sm" type="button" data-g="ex-add">${icon('plus')}exercise</button></div>
          <div class="sec-h">note<em>how it felt, anything to change</em></div>
          <textarea class="field" data-g="note" placeholder="optional" rows="3">${esc(g.note || '')}</textarea>
          <div class="btns end"><button class="btn go" type="button" data-g="finish">${icon('check')}finished</button></div>
          <div class="rest-bar" ${rest.end ? '' : 'hidden'}><span class="label">rest</span><b data-rest>0:00</b>
            <button class="btn sm" type="button" data-g="rest-m">−15</button><button class="btn sm" type="button" data-g="rest-p">+15</button>
            <button class="btn sm go" type="button" data-g="rest-x">skip</button></div>`;
        Q.ui.autosize(scr.body.querySelector('[data-g="note"]'));
        tickRest(scr);
      };
      scr.draw = draw;
      draw();

      scr.body.addEventListener('click', e => {
        const b = e.target.closest('[data-g]');
        if (!b || b.tagName === 'INPUT' || b.tagName === 'TEXTAREA') return;
        const a = b.dataset.g, xi = +b.dataset.x, si = +b.dataset.s;
        if (a === 'plan') {
          const p = b.dataset.p;
          if (p === g.plan) return;
          const keep = g.ex.filter(x => x.sets.some(s => s.done));
          const base = p === 'min' ? fromProgram(suggest(date).plan) : fromProgram(p);
          g.plan = p;
          g.ex = keep.concat(base.filter(x => !keep.some(k => slug(k.name) === slug(x.name))));
          persist(); draw();
        } else if (a === 'warm') { g.warm = !g.warm; persist(); draw(); }
        else if (a === 'min') { g.minDone = !g.minDone; persist(); draw(); }
        else if (a === 'set') {
          const x = g.ex[xi], s = x.sets[si];
          if (s.done) { s.done = false; }
          else {
            const row = b.closest('.set-r');
            const wi = row.querySelector('[data-g="w"]'), ri = row.querySelector('[data-g="r"]');
            s.w = wi ? (wi.value.trim() || (wi.placeholder !== S().unit ? wi.placeholder : '')) : '';
            s.r = ri.value.trim() || ri.placeholder;
            s.done = true;
            vibrate(15);
            startRest(scr, S().rest);
          }
          persist(); draw();
        } else if (a === 'set-add') { const x = g.ex[xi]; x.sets.push({ w: '', r: '', done: false }); persist(); draw(); }
        else if (a === 'ex-x') {
          const x = g.ex[xi];
          const drop = () => { g.ex.splice(xi, 1); persist(); draw(); };
          if (x.sets.some(s => s.done)) Q.ui.confirm(`Remove ${x.name} from today? Its logged sets go with it.`, 'remove', drop); else drop();
        } else if (a === 'ex-add') addExercise(name => { g.ex.push({ id: uid('x'), name, unit: 'reps', lo: 8, hi: 12, sets: [0, 1, 2].map(() => ({ w: '', r: '', done: false })) }); persist(); draw(); });
        else if (a === 'rest-m') { rest.end -= 15000; tickRest(scr); }
        else if (a === 'rest-p') { rest.end += 15000; rest.total += 15; tickRest(scr); }
        else if (a === 'rest-x') { stopRest(); draw(); }
        else if (a === 'finish') {
          persist();
          scr.close();
          Q.ui.toast(Q.m.gymLogged(g) ? 'session saved' : 'nothing logged — that\'s fine');
        }
      });
      scr.body.addEventListener('input', e => {
        const t = e.target, a = t.dataset && t.dataset.g;
        if (a === 'note') { g.note = t.value; persist(); return; }
        if (a === 'w' || a === 'r') {
          const s = g.ex[+t.dataset.x].sets[+t.dataset.s];
          s[a] = t.value.trim();
          if (s.done) persist();
        }
      });
    },
  });
}

function addExercise(cb) {
  const sh = Q.ui.sheet({
    title: 'exercise',
    body: `<p class="fine">Just for today. To change the program for good: settings → gym program.</p>
      <div class="goal-add"><input class="field" type="text" placeholder="exercise name" maxlength="60" enterkeyhint="done"><button class="btn go" type="button" data-add>${icon('plus')}</button></div>`,
  });
  const inp = sh.el.querySelector('input');
  const add = () => { const v = inp.value.trim(); if (v) { sh.close(); cb(v); } };
  sh.el.querySelector('[data-add]').onclick = add;
  inp.addEventListener('keydown', e => { if (e.key === 'Enter') add(); });
  setTimeout(() => inp.focus(), 250);
}

/* the rest timer runs off a wall-clock end time, so a throttled tab still
   shows the right number when it wakes */
function startRest(scr, secs) {
  rest.end = Date.now() + secs * 1000;
  rest.total = secs;
  rest.buzzed = false;
  clearInterval(rest.timer);
  rest.timer = setInterval(() => tickRest(scr), 250);
}
function stopRest() { clearInterval(rest.timer); rest = { end: 0, timer: 0, total: 0 }; }
function tickRest(scr) {
  const bar = scr.body.querySelector('.rest-bar');
  if (!bar) return;
  if (!rest.end) { bar.hidden = true; return; }
  bar.hidden = false;
  const left = (rest.end - Date.now()) / 1000;
  const b = bar.querySelector('[data-rest]');
  if (left > 0) {
    b.textContent = dur(Math.ceil(left)).replace(/^0/, '');
    bar.classList.remove('over');
    bar.style.setProperty('--p', (1 - left / rest.total).toFixed(3));
  } else {
    b.textContent = 'go · +' + dur(-left).replace(/^0/, '');
    bar.classList.add('over');
    bar.style.setProperty('--p', 1);
    if (!rest.buzzed) { rest.buzzed = true; vibrate([180, 90, 180]); }
    if (-left > 90) stopRest(), (bar.hidden = true);
  }
}

Q.gym = { suggest, lastFor, open, topped };
})();
