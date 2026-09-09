import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const LOCAL = path.join(ROOT, '.update');
const IGNORED = new Set(['.git', 'node_modules', '.update']);
const APPS = ['do', 'log', 'plan', 'store', 'tend', 'track', 'learn', 'cal', 'create', 'tools'];

export function inventory(root, ignored = IGNORED) {
  const result = Object.create(null);
  function walk(folder, prefix = '') {
    for (const item of fs.readdirSync(folder, { withFileTypes: true })) {
      if (ignored.has(item.name)) continue;
      const file = path.join(folder, item.name), name = prefix + item.name;
      if (item.isSymbolicLink()) result[name] = 'link:' + fs.readlinkSync(file);
      else if (item.isDirectory()) walk(file, name + '/');
      else result[name] = crypto.createHash('sha256').update(fs.readFileSync(file)).digest('hex');
    }
  }
  walk(root);
  return result;
}

export function changedFiles(root, baseline) {
  const before = inventory(baseline), after = inventory(root);
  return [...new Set([...Object.keys(before), ...Object.keys(after)])]
    .filter(file => before[file] !== after[file]).sort();
}

export function createBackup(root) {
  const stamp = new Date().toISOString().replace(/[:.]/g, '-');
  const backup = path.join(path.dirname(root), `${path.basename(root)}-backup-${stamp}`);
  if (fs.existsSync(backup)) throw new Error('Backup destination already exists: ' + backup);
  const before = inventory(root, new Set());
  fs.cpSync(root, backup, { recursive: true, errorOnExist: true, force: false, verbatimSymlinks: true });
  const same = other => {
    const keys = Object.keys(before);
    return keys.length === Object.keys(other).length && keys.every(k => before[k] === other[k]);
  };
  if (!same(inventory(backup, new Set())) || !same(inventory(root, new Set()))) {
    throw new Error('Backup verification failed or source changed while copying: ' + backup);
  }
  return { backup, files: Object.keys(before).length };
}

export function chooseChecks(files, flag = 'auto') {
  if (flag === 'full') return 'full';
  if (!files.length) return 'none';
  if (flag === 'quick') return 'quick';
  if (files.every(f => /\.md$/i.test(f))) return 'docs';
  if (files.some(f => /^css\/(tokens|themes|shell)\.css$/.test(f))) return 'full';
  if (files.every(f => /\.(md|css|png|jpg|jpeg|gif|webp|ico|svg)$/i.test(f))) return 'quick';
  return 'full';
}

export function summarize(output) {
  const lines = output.split(/\r?\n/);
  const failures = lines.filter(l => /^\s*FAIL\b/.test(l));
  const total = lines.findLast(l => /^\d+ passed, \d+ failed$/.test(l));
  return [...failures, total].filter(Boolean).join('\n');
}

function run(args, logName, options = {}) {
  fs.mkdirSync(LOCAL, { recursive: true });
  const result = spawnSync(process.execPath, args, {
    cwd: ROOT, encoding: 'utf8', timeout: 600000, maxBuffer: 16 * 1024 * 1024, ...options,
  });
  const output = (result.stdout || '') + (result.stderr || '') + (result.error ? '\n' + result.error.message : '');
  const log = path.join(LOCAL, logName);
  fs.writeFileSync(log, output);
  if (result.status !== 0) {
    console.error(summarize(output) || output.split(/\r?\n/).slice(-20).join('\n'));
    throw new Error(`Check failed. Details: ${log}`);
  }
  return { output, log };
}

async function smoke() {
  const { JSDOM, ResourceLoader, VirtualConsole } = await import('jsdom');
  const errors = [];
  class LocalLoader extends ResourceLoader {
    fetch(url) {
      const u = new URL(url);
      if (u.origin !== 'http://localhost' || !u.pathname.endsWith('.js')) return Promise.resolve(Buffer.from(''));
      const file = path.resolve(ROOT, '.' + u.pathname);
      if (!file.startsWith(ROOT + path.sep)) return Promise.reject(new Error('Script outside project'));
      return Promise.resolve(fs.readFileSync(file));
    }
  }
  const vc = new VirtualConsole();
  vc.on('jsdomError', e => errors.push(e.detail?.stack || e.message));
  vc.on('error', (...args) => errors.push(args.map(String).join(' ')));
  const dom = new JSDOM(fs.readFileSync(path.join(ROOT, 'index.html'), 'utf8'), {
    url: 'http://localhost/', runScripts: 'dangerously', resources: new LocalLoader(),
    pretendToBeVisual: true, virtualConsole: vc,
    beforeParse(w) {
      w.matchMedia = () => ({ matches: false, addEventListener() {}, removeEventListener() {}, addListener() {} });
      w.HTMLElement.prototype.scrollIntoView = function () {};
      w.fetch = async () => ({ ok: false, status: 599, json: async () => ({}), text: async () => '' });
      w.navigator.vibrate = () => true;
      w.confirm = w.prompt = () => { throw new Error('Unexpected native dialog'); };
    },
  });
  let timeout;
  try {
    await new Promise((resolve, reject) => {
      timeout = setTimeout(() => reject(new Error('App boot timed out')), 10000);
      dom.window.addEventListener('load', resolve, { once: true });
    });
    clearTimeout(timeout);
    const w = dom.window;
    for (const name of ['Prefs', 'Config', 'Shell', 'SET', 'SEARCH', ...APPS.map(a => a.toUpperCase())]) {
      if (!w[name]) throw new Error('Module missing: ' + name);
    }
    for (const app of w.Prefs.APPS) w.Shell.go(app);
    for (const theme of w.Prefs.THEMES) w.Prefs.set('theme', theme.id);
    for (const panel of w.SET.PANELS) w.SET.panel(panel);
    await new Promise(resolve => setTimeout(resolve, 50));
    if (errors.length) throw new Error(errors.join('\n'));
    console.log(`Smoke passed: ${w.Prefs.APPS.length} apps, ${w.Prefs.THEMES.length} themes, ${w.SET.PANELS.length} panels. Layout not tested.`);
  } finally {
    clearTimeout(timeout);
    dom.window.close();
  }
}

function context(area) {
  const shared = ['shell', 'prefs', 'config', 'settings', 'search'];
  if (APPS.includes(area)) {
    console.log(`Read: js/${area}.js, css/${area}.css; search ns-${area} in index.html.`);
    console.log(`Related values/editors: search ${area} in js/config.js, js/prefs.js and js/settings.js as needed.`);
  } else if (shared.includes(area)) console.log(`Read: js/${area}.js; trace only affected callers and settings.`);
  else if (area === 'styles') console.log('Read: css/tokens.css, the affected app stylesheet; css/themes.css for preset overrides.');
  else if (area === 'tests') console.log('Read: test/package.json and the relevant check/setup in test/harness.mjs.');
  else if (area === 'docs') console.log('Read: AGENTS.md, UPDATE.md and the affected section of ROOT.md.');
  else console.log('Start with the owning js/<app>.js function, its CSS and markup. Use UPDATE.md for the file-reading order.');
  console.log('Contracts: ROOT.md §§3–6; PLAN/DAY exports §§8–9. Read relevant sections, not the full history.');
  const git = spawnSync('git', ['status', '--short'], { cwd: ROOT, encoding: 'utf8' });
  if (git.status !== 0) throw new Error('Cannot read Git status: ' + (git.stderr || git.error?.message));
  console.log(git.stdout.trim() || 'Git working tree clean.');
}

async function main(args) {
  const [command, ...rest] = args;
  if (command === '_smoke' && !rest.length) return smoke();
  if (command === 'start') {
    if (rest.length > 1 || (rest[0] && ![...APPS, 'shell', 'prefs', 'config', 'settings', 'search', 'styles', 'tests', 'docs'].includes(rest[0]))) {
      throw new Error('Unknown area. Use an app ID, shell, prefs, config, settings, search, styles, tests or docs.');
    }
    const result = createBackup(ROOT);
    fs.mkdirSync(LOCAL, { recursive: true });
    fs.writeFileSync(path.join(LOCAL, 'session.json'), JSON.stringify({ ...result, started: new Date().toISOString() }, null, 2));
    console.log(`Verified backup: ${result.backup} (${result.files} files).`);
    return context(rest[0]);
  }
  if (command === 'check') {
    let flag = 'auto', base;
    for (let i = 0; i < rest.length; i++) {
      if (['--quick', '--full'].includes(rest[i]) && flag === 'auto') flag = rest[i].slice(2);
      else if (rest[i] === '--base' && rest[i + 1] && !base) base = path.resolve(rest[++i]);
      else throw new Error('Usage: check [--quick | --full] [--base <backup-folder>]');
    }
    if (!base) {
      const session = path.join(LOCAL, 'session.json');
      if (!fs.existsSync(session)) throw new Error('No update baseline. Run start before editing, or use --base with a verified backup.');
      base = JSON.parse(fs.readFileSync(session, 'utf8')).backup;
    }
    if (path.resolve(base) === ROOT || !fs.existsSync(path.join(base, 'index.html'))) throw new Error('Invalid project backup: ' + base);
    const files = changedFiles(ROOT, base), mode = chooseChecks(files, flag);
    console.log(`${files.length} changed files since backup; validation: ${mode}.`);
    console.log(files.join('\n'));
    for (const staged of [false, true]) {
      const git = spawnSync('git', ['-c', 'core.safecrlf=false', 'diff', '--check', ...(staged ? ['--cached'] : [])], { cwd: ROOT, encoding: 'utf8' });
      if (git.status !== 0) throw new Error((git.stdout || '') + (git.stderr || '') + (git.error?.message || ''));
    }
    console.log('Git diff whitespace check passed (staged and unstaged).');
    if (mode === 'none' || mode === 'docs') return;
    const syntaxFiles = mode === 'full'
      ? Object.keys(inventory(ROOT)).filter(f => /\.(js|mjs|cjs)$/.test(f))
      : files.filter(f => /\.(js|mjs|cjs)$/.test(f) && fs.existsSync(path.join(ROOT, f)));
    for (const file of syntaxFiles) run(['--check', path.join(ROOT, file)], 'syntax.log');
    console.log(`Syntax passed: ${syntaxFiles.length} JavaScript files.`);
    const smokeResult = run([fileURLToPath(import.meta.url), '_smoke'], 'smoke.log', { timeout: 20000 });
    console.log(smokeResult.output.trim());
    if (mode === 'full') {
      console.log('Running full behavior harness; details will be saved in .update/full.log.');
      const full = run([path.join(ROOT, 'test/harness.mjs')], 'full.log');
      console.log(summarize(full.output) || 'Full harness exited successfully.');
      console.log('Full log: ' + full.log);
    } else console.log('Quick checks only; full behavior suite not run.');
    const runnerTests = path.join(ROOT, 'test/update.test.mjs');
    if (mode === 'full' && fs.existsSync(runnerTests)) {
      const own = run(['--test', runnerTests], 'runner.log');
      console.log(own.output.split(/\r?\n/).filter(l => /(?:tests|pass|fail) \d+$/.test(l)).join('\n'));
    }
  } else if (!command || ['help', '--help'].includes(command)) {
    console.log('node test/update.mjs start [area]\nnode test/update.mjs check [--quick | --full] [--base <backup-folder>]\nSee UPDATE.md.');
  } else throw new Error('Unknown command. Run node test/update.mjs --help.');
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main(process.argv.slice(2)).catch(error => { console.error(error.stack || error.message); process.exitCode = 1; });
}
