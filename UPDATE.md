# Update protocol

Aim for a complete, verified change with little repeated reading or output.
Run commands from `root/`. Node and the existing `test/` dependencies are enough.
If dependencies are missing, run `npm install --prefix test` once.

## Start

```powershell
node test/update.mjs start tools
```

Replace `tools` with an app ID, `shell`, `prefs`, `config`, `settings`, `search`,
`styles`, `tests` or `docs`. Omit it for a general update. This command:

- Copies the entire project, including hidden files, Git history, dependencies
  and uncommitted work, into a timestamped sibling folder; verifies file hashes.
- Saves the backup path in ignored `.update/session.json` and prints a file map
  and Git status. Backups are retained; the runner never deletes them.

Run `start` once per new update, before editing. It replaces the active session
pointer, so do not run it again to check progress. If backup verification fails,
stop editing and resolve it. This development backup is separate from the app's
in-browser user-data export.

## Read and implement

Use a compact working note: **outcome / files / contract at risk / validation**.
Keep it in the conversation; a separate planning document is rarely needed.

Start with the relevant `js/<app>.js` function, `css/<app>.css` selectors and
markup in `index.html`. Search Config, Prefs and Settings only when they own a
related value or editor. Read ROOT.md by section: architecture §3, tokens §4,
storage §5, constraints §6, recipes §7, PLAN export §8, DAY §9. Search old
release notes only when a regression needs that history.

Make one coherent change. Reuse the existing patterns and avoid unrelated
cleanup. For a bug, reproduce it and add an outcome-based regression check.
The legacy harness shares state between sections: filtering its printed test
names does **not** safely skip earlier setup.

## Validate

```powershell
node test/update.mjs check --quick
node test/update.mjs check
node test/update.mjs check --full
```

| Change | Default `check` |
| --- | --- |
| Markdown/documentation only | Diff whitespace check |
| App CSS or static images | Syntax where applicable + app boot/theme/panel smoke check |
| JavaScript, HTML, shared CSS (tokens/themes/shell), manifest, tests, dependencies, or unknown file type | Syntax + smoke check + full existing harness |
| No changes since the backup | Reports no changes; does not claim tests passed |

`--quick` runs syntax and smoke checks for iteration; it is not final validation
for behavior changes. `--full` forces the complete path. Use it for uncertain
scope, a regression, or shared changes even when the default selects less.
Comment-only JS edits conservatively select the full suite.

Validation compares against the session backup, including new and deleted files;
it does not confuse earlier uncommitted work with this update. It also checks
staged and unstaged Git diff whitespace. Full logs live in `.update/`; terminal
output shows failures and totals. A failing command returns a nonzero exit code.
For an earlier verified backup: `node test/update.mjs check --base <folder>`.

For visual changes, inspect the affected screen in a browser at the relevant
phone size and theme/density settings. If unavailable, report that limitation.
No jsdom result establishes visual correctness. The checks stub networking;
live Todoist behavior needs separate verification when changed.

## Finish

Review the final diff for accidental changes. Add one brief ROOT.md changelog
entry: result, reason when useful, validation. Report what changed, what passed,
the backup path and any remaining limitation. Stop once the required checks
pass; do not spend tokens restating the plan or dumping successful test lines.
