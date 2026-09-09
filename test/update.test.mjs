import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { createBackup, changedFiles, chooseChecks, inventory, summarize } from './update.mjs';

function fixture(t) {
  const folder = fs.mkdtempSync(path.join(os.tmpdir(), 'root-update-test-'));
  t.after(() => {
    assert.equal(path.dirname(folder), path.resolve(os.tmpdir()));
    assert.ok(path.basename(folder).startsWith('root-update-test-'));
    fs.rmSync(folder, { recursive: true, force: true });
  });
  const root = path.join(folder, 'root');
  fs.mkdirSync(root);
  return root;
}

test('backup includes hidden files, dependencies and uncommitted files', t => {
  const root = fixture(t);
  for (const dir of ['.git', 'node_modules', 'js']) fs.mkdirSync(path.join(root, dir));
  for (const file of ['.git/HEAD', 'node_modules/dependency.js', 'js/new.js', '.hidden']) {
    fs.writeFileSync(path.join(root, file), file);
  }
  const { backup, files } = createBackup(root);
  assert.equal(files, 4);
  assert.deepEqual(inventory(backup, new Set()), inventory(root, new Set()));
  fs.writeFileSync(path.join(root, 'js/new.js'), 'changed');
  assert.equal(fs.readFileSync(path.join(backup, 'js/new.js'), 'utf8'), 'js/new.js');
});

test('session diff finds edits, additions and deletions without Git or dependency noise', t => {
  const root = fixture(t);
  fs.writeFileSync(path.join(root, 'edited.js'), 'before');
  fs.writeFileSync(path.join(root, 'deleted.css'), 'before');
  const { backup } = createBackup(root);
  fs.writeFileSync(path.join(root, 'edited.js'), 'after');
  fs.writeFileSync(path.join(root, 'added.md'), 'new');
  fs.unlinkSync(path.join(root, 'deleted.css'));
  fs.mkdirSync(path.join(root, '.update'));
  fs.writeFileSync(path.join(root, '.update/noise.log'), 'ignored');
  assert.deepEqual(changedFiles(root, backup), ['added.md', 'deleted.css', 'edited.js']);
});

test('validation expands for executable or uncertain changes and allows explicit full checks', () => {
  assert.equal(chooseChecks([]), 'none');
  assert.equal(chooseChecks([], 'full'), 'full');
  assert.equal(chooseChecks(['ROOT.md']), 'docs');
  assert.equal(chooseChecks(['css/tools.css', 'favicon.png']), 'quick');
  for (const file of ['js/tools.js', 'index.html', 'css/tokens.css', 'css/themes.css', 'css/shell.css', 'manifest.webmanifest', 'test/package.json', '.gitignore']) {
    assert.equal(chooseChecks([file]), 'full');
  }
  assert.equal(chooseChecks(['js/tools.js'], 'quick'), 'quick');
});

test('summary hides success lines while preserving failures and totals', () => {
  const output = '  ok   one\r\n  FAIL two — expected 2\r\n1 passed, 1 failed\r\n';
  assert.equal(summarize(output), '  FAIL two — expected 2\n1 passed, 1 failed');
  assert.equal(summarize('1 passed, 0 failed\n'), '1 passed, 0 failed');
  assert.equal(summarize('SyntaxError: broken\n'), '');
});

test('invalid CLI input fails before creating a backup', () => {
  const result = spawnSync(process.execPath, [fileURLToPath(new URL('./update.mjs', import.meta.url)), 'start', 'unknown-area'], { encoding: 'utf8' });
  assert.equal(result.status, 1);
  assert.match(result.stderr, /Unknown area/);
});

test('CLI session skips app tests for docs and propagates syntax failures', t => {
  const root = fixture(t);
  fs.mkdirSync(path.join(root, 'test'));
  const runner = path.join(root, 'test/update.mjs');
  fs.copyFileSync(fileURLToPath(new URL('./update.mjs', import.meta.url)), runner);
  fs.writeFileSync(path.join(root, 'index.html'), '<!doctype html><title>fixture</title>');
  const git = spawnSync('git', ['init', '--quiet', root], { encoding: 'utf8' });
  assert.equal(git.status, 0, git.stderr);
  const start = spawnSync(process.execPath, [runner, 'start', 'docs'], { encoding: 'utf8' });
  assert.equal(start.status, 0, start.stderr);
  const session = JSON.parse(fs.readFileSync(path.join(root, '.update/session.json'), 'utf8'));
  assert.ok(fs.existsSync(path.join(session.backup, 'index.html')));
  fs.writeFileSync(path.join(root, 'notes.md'), 'A documentation change.\n');
  const check = spawnSync(process.execPath, [runner, 'check'], { encoding: 'utf8' });
  assert.equal(check.status, 0, check.stderr);
  assert.match(check.stdout, /validation: docs/);
  assert.doesNotMatch(check.stdout, /Smoke passed|passed, 0 failed/);
  fs.writeFileSync(path.join(root, 'broken.js'), 'const = ;');
  const broken = spawnSync(process.execPath, [runner, 'check', '--quick'], { encoding: 'utf8' });
  assert.equal(broken.status, 1);
  assert.match(broken.stderr, /Check failed/);
  assert.match(fs.readFileSync(path.join(root, '.update/syntax.log'), 'utf8'), /SyntaxError/);
  assert.doesNotMatch(broken.stdout, /Smoke passed/);
});
