# Updating ROOT

Use [UPDATE.md](UPDATE.md) for the workflow. Keep this file short; it is the
entry point, not another changelog.

1. Before editing, run `node test/update.mjs start <area>` from this project.
   It makes and verifies a complete sibling backup, records the starting state,
   and prints the relevant file paths. If this update already has a verified
   backup, reuse that session; do not reset its baseline midway through work.
2. State the intended result and how you will verify it in a few lines. Proceed
   on routine choices; ask only when missing information materially changes scope.
3. Search with `rg`, then read the owning function and its callers. Consult the
   relevant sections of ROOT.md; do not load the whole manifest, changelog or
   test harness by default. Batch independent reads. Reuse what you have learned.
4. Make the smallest complete change. Preserve existing user edits. Keep comments
   for contracts, surprising constraints and reasons; omit code narration and
   release history. Do not add dependencies or general abstractions for one use.
5. During code iteration, use `node test/update.mjs check --quick`. Before finishing,
   run `node test/update.mjs check` for automatic validation. See UPDATE.md for
   visual checks and when the full suite is required. Fix failures; inspect the
   saved log before rerunning. Do not repeat a passing run without a new reason.
6. Add one short entry to ROOT.md's Changelog. Update its current architecture
   sections only when a contract or file layout changes. Report the result,
   checks, backup path and any unverified behavior. Do not commit or publish
   unless the user's request includes it.

## Contracts to preserve

- Static site, no build step. Prefs loads in the head, then Config/Shell before
  app modules; settings/search follow them. Modules register with Shell.
- Scope app lookups and styles to `.ns-<app>`. Shared overlays live outside
  `#track`; the scroll container is `.view-body`.
- Content belongs in Config; appearance/behavior in Prefs. Read preferences live.
  Use shared CSS tokens. Preserve Config's whole-branch override semantics.
- Storage keys, identity keys and LOG's exported field names are contracts.
  Check ROOT.md §§5–6 for migrations; §§8–9 for PLAN/DAY exports.
- DAY's code ID is `cal`. PLAN resolves templates; CAL stores resolved days.
  Follow existing Todoist write boundaries and rollback behavior.
- Add a regression check for a behavior fix. Test outcomes, not exact comments
  or an implementation copied into an assertion. jsdom cannot verify layout.

No agent delegation by default. Use it only when the user requests it.
