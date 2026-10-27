/* qurOS — shared UI: toast, bottom sheet, confirm, full-screen sub-screens,
   and the back button. Every layer (sheet, screen, recorder) pushes a history
   entry, so Android's back gesture closes the top layer instead of leaving
   the app; a layer can refuse (the locked recorder does). */
(() => {
const Q = window.Q, { $, esc, icon } = Q.u;

/* ── layers & back ── */
const layers = [];
let skip = 0;
function pushLayer(name, close, guard) {
  layers.push({ name, close, guard });
  try { history.pushState({ qos: layers.length }, ''); } catch {}
}
function closeLayer(name) {
  let i = layers.length - 1;
  while (i >= 0 && layers[i].name !== name) i--;
  if (i < 0) return false;
  const [l] = layers.splice(i, 1);
  l.close();
  skip++;
  try { history.back(); } catch { skip--; }
  return true;
}
window.addEventListener('popstate', () => {
  if (skip) { skip--; return; }
  const top = layers[layers.length - 1];
  if (!top) return;
  if (top.guard && top.guard()) { try { history.pushState({ qos: layers.length }, ''); } catch {} return; }
  layers.pop();
  top.close();
});

/* ── toast ── */
let toastTimer = 0;
function toast(msg, opt = {}) {
  const el = $('#toast');
  if (!el) return;
  el.innerHTML = `<span>${esc(msg)}</span>` + (opt.action ? `<button type="button">${esc(opt.action)}</button>` : '');
  if (opt.action) el.querySelector('button').onclick = () => { hideToast(); opt.run && opt.run(); };
  el.classList.add('on');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(hideToast, opt.ms || (opt.action ? 6000 : 2600));
}
function hideToast() { const el = $('#toast'); if (el) el.classList.remove('on'); }

/* ── sheet ── */
let sheetSeq = 0;
function sheet({ title = '', body = '', cls = '', onClose, onOpen } = {}) {
  const wrap = document.createElement('div');
  const name = 'sheet' + (++sheetSeq);
  wrap.className = 'sheet-wrap';
  wrap.innerHTML = `<div class="sheet-scrim"></div>
    <div class="sheet ${cls}" role="dialog" aria-modal="true" aria-label="${esc(title)}">
      <div class="sheet-grip"></div>
      ${title ? `<div class="sheet-h"><span>${esc(title)}</span><button class="icon-btn" type="button" data-x aria-label="close">${icon('x')}</button></div>` : ''}
      <div class="sheet-b">${body}</div>
    </div>`;
  document.body.appendChild(wrap);
  requestAnimationFrame(() => wrap.classList.add('on'));
  const api = {
    el: wrap.querySelector('.sheet'),
    close: () => closeLayer(name),
  };
  pushLayer(name, () => {
    wrap.classList.remove('on');
    setTimeout(() => wrap.remove(), 220);
    if (onClose) onClose();
  });
  wrap.querySelector('.sheet-scrim').onclick = api.close;
  const x = wrap.querySelector('[data-x]');
  if (x) x.onclick = api.close;
  if (onOpen) onOpen(api);
  return api;
}
function confirm(text, ok, fn, { cancel = 'cancel', note = '' } = {}) {
  const s = sheet({
    body: `<p class="sheet-q">${esc(text)}</p>${note ? `<p class="fine">${esc(note)}</p>` : ''}
      <div class="sheet-acts"><button class="btn" type="button" data-no>${esc(cancel)}</button>
      <button class="btn go" type="button" data-ok>${esc(ok)}</button></div>`,
  });
  s.el.querySelector('[data-no]').onclick = s.close;
  s.el.querySelector('[data-ok]').onclick = () => { s.close(); fn(); };
  return s;
}
/* a choice between several answers, each {label, run, go?} */
function choose(text, options, { note = '' } = {}) {
  const s = sheet({
    body: `<p class="sheet-q">${esc(text)}</p>${note ? `<p class="fine">${esc(note)}</p>` : ''}
      <div class="sheet-col">${options.map((o, i) => `<button class="btn wide ${o.go ? 'go' : ''}" type="button" data-i="${i}">${esc(o.label)}</button>`).join('')}</div>`,
  });
  s.el.querySelectorAll('[data-i]').forEach(b => { b.onclick = () => { s.close(); const o = options[+b.dataset.i]; o.run && o.run(); }; });
  return s;
}

/* ── full-screen sub-screens (settings, gym, an entry) ── */
function screen(name, { title, sub = '', render, onClose, cls = '' }) {
  const el = document.createElement('section');
  el.className = 'screen ' + cls;
  el.dataset.screen = name;
  el.innerHTML = `<header class="scr-h">
      <button class="back" type="button" aria-label="back">${icon('left')}</button>
      <div class="scr-t"><b>${esc(title)}</b>${sub ? `<span>${esc(sub)}</span>` : ''}</div>
      <div class="scr-acts"></div>
    </header><div class="scr-b"></div>`;
  document.body.appendChild(el);
  requestAnimationFrame(() => el.classList.add('on'));
  const api = {
    el, body: el.querySelector('.scr-b'), acts: el.querySelector('.scr-acts'),
    close: () => closeLayer('screen:' + name),
    setSub(s) { const sp = el.querySelector('.scr-t span'); if (sp) sp.textContent = s; },
  };
  pushLayer('screen:' + name, () => {
    el.classList.remove('on');
    setTimeout(() => el.remove(), 240);
    if (onClose) onClose();
  });
  el.querySelector('.back').onclick = api.close;
  if (render) render(api);
  return api;
}

/* a <textarea> that grows with its text */
function autosize(ta) {
  const fit = () => { ta.style.height = 'auto'; ta.style.height = ta.scrollHeight + 'px'; };
  ta.addEventListener('input', fit);
  requestAnimationFrame(fit);
  return fit;
}

async function copy(text) {
  try { await navigator.clipboard.writeText(text); return true; }
  catch {
    const ta = document.createElement('textarea');
    ta.value = text; ta.setAttribute('readonly', ''); ta.style.position = 'fixed'; ta.style.opacity = '0';
    document.body.appendChild(ta); ta.select();
    let ok = false; try { ok = document.execCommand('copy'); } catch {}
    ta.remove();
    return ok;
  }
}
function download(name, text, type = 'text/markdown') {
  const url = URL.createObjectURL(new Blob([text], { type: type + ';charset=utf-8' }));
  const a = document.createElement('a');
  a.href = url; a.download = name;
  document.body.appendChild(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 4000);
}
/* the share sheet with a file when the browser can, plain text otherwise.
   Resolves 'shared' | 'cancelled' | 'unsupported'. */
async function share(name, text, title) {
  if (!navigator.share) return 'unsupported';
  try {
    const file = typeof File === 'function' ? new File([text], name, { type: 'text/plain' }) : null;
    if (file && navigator.canShare && navigator.canShare({ files: [file] })) await navigator.share({ files: [file], title });
    else await navigator.share({ title, text });
    return 'shared';
  } catch (e) {
    return e && e.name === 'AbortError' ? 'cancelled' : 'unsupported';
  }
}
function readFile(accept) {
  return new Promise(res => {
    const inp = document.createElement('input');
    inp.type = 'file'; inp.accept = accept;
    inp.onchange = () => {
      const f = inp.files && inp.files[0];
      if (!f) return res(null);
      const r = new FileReader();
      r.onload = () => res({ name: f.name, text: String(r.result || '') });
      r.onerror = () => res(null);
      r.readAsText(f);
    };
    inp.click();
  });
}

Q.ui = { toast, hideToast, sheet, confirm, choose, screen, pushLayer, closeLayer, layers: () => layers.map(l => l.name),
  autosize, copy, download, share, readFile };
})();
