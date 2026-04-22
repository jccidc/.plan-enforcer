# v0.1.4 -- Closed Ledger Should Not Hog Statusline (Angle 1)

**Goal:** Teach `src/statusline-state.js#inferStatuslineState` to treat a ledger whose every active (non-superseded) row is terminal as a non-witness for the progress tag. When a closed ledger is the only thing on disk, the function returns `null` and no `[ENFORCER: ...]` segment is rendered. When a closed ledger AND a discuss packet are both on disk, the function falls through to the authorship-stage witness path (PI2) and the statusline renders `[ENFORCER: 1-DISCUSS]` as expected. Render-layer fix only; ledger file is not moved, renamed, or deleted.

**Constraints:**
- Pure Node, no new runtime dependencies.
- Test runner: `node --test` matching `tests/*.test.js`.
- ASCII-only everywhere. No Unicode box-drawing, em-dashes, or smart quotes.
- Brand-protection forbidden-language grep (CLAUDE.md) clean on every new committed file.
- `TERMINAL_STATUSES` must live in exactly one canonical location after this patch. Hook(s) and CLI(s) that currently define the set locally must import it instead.
- No state mutation. No file is archived, moved, renamed, or deleted by any code path in this patch.
- `hooks/plan-close.js` semantics (v0.1.2 on-edit auto-archive) remain unchanged.
- `hooks/session-end.js`, `src/abandon-cli.js`, `src/statusline-state.js` share the same `TERMINAL_STATUSES` definition post-patch.
- Commit messages must avoid the v0.1.3-era schema-guard false-positive pattern (do not combine a literal mention of the active-ledger path with a shell redirect like `2>&1` in the same bash invocation).
- Version bumps to 0.1.4 and a matching CHANGELOG entry ship as part of this plan.

**Out of scope:**
- Angle 2 (discuss auto-archives closed plans on new session entry). Logged as a future opt-in flag possibility only.
- Any change to `hooks/plan-close.js`, `src/abandon-cli.js`, `hooks/ledger-schema-guard.js`, `hooks/evidence-gate.js`, or other hooks' behavior.
- Any change to `plan-enforcer` (executor), `plan-enforcer-discuss`, `plan-enforcer-draft`, `plan-enforcer-review`, or `plan-enforcer-receipt` skills / CLIs.
- README prose changes. The lifecycle narrative does not promise a specific rendering for closed-but-retained ledgers and does not need an edit.
- New slash commands, CLI surfaces, config toggles, or tier-specific behavior.
- Retroactive changes to archived ledgers or proof receipts.
- Refactor of `src/statusline-state.js` beyond the targeted change and the shared-constant reuse.

## Must-Haves

- MH1: A Plan Enforcer ledger that exists on disk with every active (non-superseded) row in a terminal status (`verified`, `skipped`, `blocked`, or `superseded`) and at least one such row results in `inferStatuslineState` returning `null` when no discuss packet exists alongside it. The `statusline` hook therefore renders no `[ENFORCER: ...]` segment on a fresh prompt. A:I2
- MH2: A closed ledger on disk alongside a valid `discuss.md` packet results in `inferStatuslineState` returning the authorship-stage state (e.g. `1-DISCUSS`). PI2 fallthrough preserved -- the closed ledger is skipped, the authorship witness wins. A:I2 A:I3
- MH3: A ledger with at least one non-terminal row (e.g. `pending`, `in-progress`) continues to return the derived active state from the ledger. No regression to existing v0.1.0 / v0.1.1 / v0.1.2 / v0.1.3 statusline behavior. A:I2
- MH4: The `TERMINAL_STATUSES` set has exactly one canonical definition in the codebase after this patch. `hooks/plan-close.js`, `hooks/session-end.js`, `src/abandon-cli.js`, and `src/statusline-state.js` all import it from the same module. A `grep -RE "new Set\(\\['verified', 'skipped', 'blocked', 'superseded'\\]\)"` returns one match. A:I2
- MH5: No code path added or touched by this patch mutates the ledger file on disk. The statusline-state module reads only; the shared-constant refactor only adds an export and updates call-site imports. Render-only guarantee preserved. A:I2
- MH6: Ships as v0.1.4 with a matching `CHANGELOG.md` entry describing user-visible behavior change. The `docs/known-issues.md` entry covering this bug is demoted out of the tracker. Angle 2 noted as a future opt-in flag possibility (either in the CHANGELOG tail or a trimmed known-issues entry, author's call). A:I2 A:I3

### Task 1: Export `TERMINAL_STATUSES` from one canonical location A:I2

- [ ] Add `const TERMINAL_STATUSES = new Set(['verified', 'skipped', 'blocked', 'superseded']);` to `src/ledger-parser.js` near the top of the file (next to the existing `VALID_D_TYPES` constant, which is the established convention for ledger-shape constants).
- [ ] Add `TERMINAL_STATUSES` to the `module.exports` block at the bottom of `src/ledger-parser.js`, preserving alphabetical-ish order with the surrounding exports.
- [ ] Do NOT touch any other logic in `src/ledger-parser.js`; this is an additive change only.
- [ ] Verification: `node --check src/ledger-parser.js` passes; `node -e "console.log([...require('./src/ledger-parser').TERMINAL_STATUSES].sort().join(','))"` prints `blocked,skipped,superseded,verified`.

### Task 2: Replace local `TERMINAL_STATUSES` definitions with the shared import A:I2 A:I3

- [ ] In `hooks/plan-close.js`, remove the local `const TERMINAL_STATUSES = new Set([...])` declaration and replace with `const { TERMINAL_STATUSES } = require('../src/ledger-parser');` adjacent to the other `require` lines near the top of the file. No behavior change; the set content is identical.
- [ ] In `hooks/session-end.js`, do the same -- remove the local declaration, import from `../src/ledger-parser`.
- [ ] In `src/abandon-cli.js`, do the same -- remove the local declaration, import from `./ledger-parser`.
- [ ] Confirm the imports resolve correctly from both the repo-local path (during test runs) and the installed-at-home path (`~/.claude/skills/plan-enforcer/src/ledger-parser.js`). The `plan-close.js` hook already has a home-fallback pattern for `archive.js` and `ledger-parser.js` inside `archiveClosedLedger`; that same fallback already covers the `require('./ledger-parser')` at the top of the file, which is evaluated against the hook's own `__dirname`. No new fallback logic is required for Task 2 because the runtime copies `hooks/*.js` and `src/*.js` into the same installed tree -- the relative `../src/ledger-parser` path resolves against whichever copy is loaded.
- [ ] Verification: `node --check hooks/plan-close.js hooks/session-end.js src/abandon-cli.js` all pass. `node --test tests/plan-close-hook.test.js tests/abandon-cli.test.js tests/abandon-integration.test.js tests/abandon-chain.test.js` reports zero failures (the full existing terminal-set behavior still works because the imported set is byte-identical to the prior local set).
- [ ] Verification: `grep -R "new Set(\['verified', 'skipped', 'blocked', 'superseded'\])" src/ hooks/` returns exactly one match (`src/ledger-parser.js`). Any other match means a call site was missed.

### Task 3: Implement the closed-ledger fallthrough in `inferStatuslineState` A:I2 A:I3

- [ ] At the top of `src/statusline-state.js`, add `TERMINAL_STATUSES` to the existing destructured import from `./ledger-parser` so the module uses the same canonical set as Tasks 1-2. Do not redefine it locally.
- [ ] Add a small pure helper `function ledgerIsClosed(ledgerContent)` to `src/statusline-state.js` (can be unexported or exported; exported makes unit testing cleaner). Logic: parse the rows via the existing `parseTaskRows`, filter out rows whose status is `superseded`, and return `true` iff the remaining set is non-empty AND every remaining row's status is in `TERMINAL_STATUSES`. Empty-ledger (`rows.length === 0`) returns `false` -- an empty table is "not a closed plan", it's "not a plan at all", and should not trigger the fallthrough.
- [ ] Inside `inferStatuslineState`, in the existing `if (fs.existsSync(paths.ledgerPath)) { ... }` branch, read the ledger content once, check `ledgerIsClosed(content)` FIRST, and if true, DO NOT return `buildTaskStatuslineState(content)` -- just fall through to the subsequent local-discuss / bridged checks (which already exist and already implement the PI2 fallthrough shape).
- [ ] Preserve the existing "unreadable ledger -> continue" behavior: if `fs.readFileSync` throws, fall through the same as today (do not crash).
- [ ] Mirror the same treatment in the bridged-paths branch further down in `inferStatuslineState`. A bridged ledger that is closed must also fall through to the bridged-discuss check, not short-circuit.
- [ ] Verification: `node --check src/statusline-state.js` passes. `node -e "const s=require('./src/statusline-state'); const fs=require('fs'); const os=require('os'); const path=require('path'); const d=fs.mkdtempSync(path.join(os.tmpdir(),'v014-')); fs.mkdirSync(path.join(d,'.plan-enforcer')); fs.writeFileSync(path.join(d,'.plan-enforcer','ledger.md'),'# t\n\n## Task Ledger\n\n| ID | Task | Status | Evidence | Chain | Notes |\n|----|------|--------|----------|-------|-------|\n| T1 | a | verified | ok |  |  |\n\n## Decision Log\n\n| ID | Type | Scope | Reason | Evidence |\n|----|------|-------|--------|----------|\n\n## Reconciliation History\n\n| Round | Tasks Checked | Gaps Found | Action Taken |\n|-------|---------------|------------|--------------|\n'); console.log('state=', s.inferStatuslineState({cwd:d, sessionId:'x'}));"` prints `state= null` (one-liner smoke test demonstrating MH1 for the closed-no-discuss case).

### Task 4: Extend `tests/statusline-stage-clears.test.js` with six new cases A:I2 A:I3

- [ ] Reuse the existing `mkProject`, `writeState`, `writeDiscuss`, `writeLedger` helpers at the top of the file. Do not duplicate fixture logic.
- [ ] Write a new `describe('closed-ledger witness handling (v0.1.4)', ...)` suite or extend the existing top-level describe with the following six `it` cases:
  - (a) All-verified ledger on disk, no discuss packet, no statusline-state.json. Assert `inferStatuslineState` returns `null`. This is MH1 in a test.
  - (b) All-verified ledger on disk AND a discuss packet on disk. Assert `inferStatuslineState` returns a non-null state whose label matches the authorship stage (e.g. `1-DISCUSS`). This is MH2 in a test (the PI2 fallthrough).
  - (c) Ledger with mixed statuses where all active rows are terminal but include a `blocked` row (e.g. one row `verified`, one row `blocked`). Assert `inferStatuslineState` returns `null`. Guards against the drift risk of excluding `blocked` from the "closed" definition.
  - (d) Ledger whose rows are all `superseded`. Assert `inferStatuslineState` returns `null` (HC2 edge -- active set after filtering superseded is empty, which means "no active plan", which means no stage).
  - (e) Ledger with at least one `pending` row (plus other terminal rows). Assert `inferStatuslineState` returns a non-null state reflecting the active plan. This is MH3 regression guard.
  - (f) Ledger with a `verified` row AND a valid statusline-state.json saying `3-EXECUTE`. Assert the returned label reflects the DERIVED state (from the ledger), not the stored `3-EXECUTE` label. This validates that the closed-ledger fallthrough does not accidentally re-enable the v0.1.1-blocked stale-state path when a ledger exists but is closed.
- [ ] Each test uses the existing `mkProject` helper and the `writeLedger` / `writeDiscuss` / `writeState` helpers already in the file; no new fixture scaffolding.
- [ ] Verification: `node --test tests/statusline-stage-clears.test.js` reports all tests pass (the existing 4 + the new 6 = 10 total). `node --test tests/statusline-stage-clears.test.js tests/plan-close-hook.test.js tests/abandon-cli.test.js tests/abandon-integration.test.js tests/abandon-chain.test.js tests/ledger-schema-guard.test.js` runs the affected slice of the suite and reports zero regressions.

### Task 5: Version bump + CHANGELOG entry A:I2

- [ ] Edit `package.json` to bump `"version"` from `"0.1.3"` to `"0.1.4"`. No other changes to `package.json`.
- [ ] Prepend a new `## [0.1.4] -- 2026-04-22` section to `CHANGELOG.md` directly after the top-of-file preamble (i.e. immediately before the existing `## [0.1.3]` section). Shape matches prior entries: a short header description, a `### Fixed` block describing the closed-ledger rendering behavior change, and one sentence naming the `ledgerIsClosed` helper + `TERMINAL_STATUSES` single-source-of-truth refactor. The entry also names the `docs/known-issues.md` demotion so the changelog links outwards to the resolution pattern.
- [ ] Add at the tail of the v0.1.4 `### Fixed` block (or as a short `### Notes` block) one sentence noting that angle 2 (discuss auto-archives closed plans on session entry) is NOT built in this release and remains a candidate future opt-in flag. Keeps the design decision visible.
- [ ] Verification: `grep -c "## \[0.1.4\]" CHANGELOG.md` returns 1. `node -e "console.log(require('./package.json').version)"` prints `0.1.4`.

### Task 6: Demote `docs/known-issues.md` entry A:I2 A:I3

- [ ] Remove the entire `## Closed ledger hogs the statusline until manually removed` section (from its `## ...` heading through the end of its block, including the `---` separators if they are part of its visual delimiting). Do NOT leave a "Resolved in v0.1.4" stub -- the CHANGELOG captures the resolution.
- [ ] If removing the entry empties the file below the preamble, either (a) leave the preamble + a short "No open issues at this time." line so the file remains a living tracker, or (b) replace the body with a single "No open issues at this time." line. The preamble line "Tracked gaps ... moves to CHANGELOG.md and out of this file" stays regardless.
- [ ] Add a single short line at the very bottom of the file (below the "No open issues" note) noting the angle 2 opt-in flag as a future candidate (e.g. "Future candidate: `/plan-enforcer-discuss --retire-prior` flag to auto-archive a closed ledger on new authorship session entry."). This preserves the angle 2 decision trail without leaving it documented as a bug.
- [ ] Verification: `grep -c "Closed ledger hogs the statusline" docs/known-issues.md` returns 0. `grep -c "retire-prior" docs/known-issues.md` returns 1.

### Task 7: Commit, tag, push A:I2

- [ ] Stage exactly these paths: `src/ledger-parser.js`, `src/statusline-state.js`, `src/abandon-cli.js`, `hooks/plan-close.js`, `hooks/session-end.js`, `tests/statusline-stage-clears.test.js`, `package.json`, `CHANGELOG.md`, `docs/known-issues.md`. Do NOT stage `.plan-enforcer/*` runtime artifacts.
- [ ] `git status --short` must show exactly the 9 files above as staged / modified. If anything else appears, stop and investigate before committing.
- [ ] Commit message subject: `fix(statusline): closed ledger no longer renders as in-progress`. Commit message body describes: the rendering gap, the PI2 fallthrough choice, the shared-constant refactor, and the known-issues demotion. Body must NOT contain the literal phrase `.plan-enforcer/ledger.md` adjacent to any `>` redirect character to avoid the v0.1.3-tightened-but-still-heuristic schema-guard false-positive. The v0.1.3 fix addresses the case but stays a heuristic; the safe-authoring habit is cheap insurance.
- [ ] Annotated tag: `git tag -a v0.1.4 -m "v0.1.4 -- closed ledger no longer renders as in-progress"`. Tag message may be short; just long enough to match prior tag messages (v0.1.1, v0.1.2, v0.1.3 for shape reference).
- [ ] Push main + tags: `git push origin main --follow-tags`. Do NOT use `--force`. Push output must show `[new tag] v0.1.4 -> v0.1.4`.
- [ ] Verification: `git log --oneline -3` shows the new commit as HEAD. `git tag -l v0.1.4` returns `v0.1.4`. On `origin`, the commit and tag are visible (curl or gh can confirm; manual verification via the GitHub UI is also acceptable if done live).

### Task 8: Re-install locally and live-verify A:I2 A:I3

- [ ] Run `./install.sh` from the repo root. Confirm terminal output shows `repo commit: <HEAD-short-sha>` matching `git rev-parse --short HEAD` (which should match the new `v0.1.4` commit).
- [ ] In a project with an existing closed ledger on disk (or a synthetic one created under `/tmp`), confirm the statusline hook renders no `[ENFORCER: ...]` segment on a fresh prompt. Use the one-liner from Task 3 verification to exercise the code path from the installed skill dir: `node -e "const s=require(process.env.HOME + '/.claude/skills/plan-enforcer/src/statusline-state'); ...closed-ledger fixture... ; console.log(s.inferStatuslineState({cwd:d}));"` should print `null`.
- [ ] In the same fixture, add a `discuss.md` packet and confirm `inferStatuslineState` now returns an authorship-state object whose label is the authorship stage (not `null`, not the ledger's final scoreboard). This is the live PI2 verification that matches MH2.
- [ ] Document the verification outcome in a single line at the end of the v0.1.4 CHANGELOG entry under `### Verified`, naming the commit SHA that passed live testing. This matches the product's "receipt -> proof" discipline without needing a receipt file for a patch this small.
- [ ] Verification: `$HOME/.claude/skills/plan-enforcer/.installed-from` content matches `git rev-parse --short HEAD`. The live-verify terminal output + synthetic fixture output together constitute the proof for MH1 + MH2 on the installed bundle.

## Assumptions

- `src/ledger-parser.js` is the right canonical home for `TERMINAL_STATUSES`. It already exports related ledger-shape constants (`VALID_D_TYPES`), it is imported by every file that currently owns its own copy of `TERMINAL_STATUSES`, and no circular-import concern exists. If implementation reveals a circular-import issue (none expected), fall back to a new minimal file `src/plan-status.js` exporting just the set. Either choice satisfies MH4.
- The existing `tests/statusline-stage-clears.test.js` helpers (`mkProject`, `writeState`, `writeDiscuss`, `writeLedger`) accept the schema used throughout the file. The new cases can be written without extending the helpers.
- Pre-existing `tests/statusline-hook.test.js` failures (covered by the standing D2 override pattern across this session's plans) remain as-is and do not grow as a side effect of this patch. The new tests live in `tests/statusline-stage-clears.test.js`, which is a separate file added in v0.1.1.
- `hooks/session-end.js` currently defines `TERMINAL_STATUSES` locally per an earlier survey. If its Task 2 update reveals a different definition (e.g. a subset, or a superset including `done`), surface that as a Decision Log row and halt before committing the refactor; do not silently reconcile.
- GitHub remote push permissions and `.installed-from` write permissions remain the same as the v0.1.3 run earlier today; no new environmental setup is expected.

## Related artifacts

- Discuss packet: `.plan-enforcer/discuss.md` (canonical) and `.plan-enforcer/combobulate.md` (compat copy).
- Prior shipped patches in this session: v0.1.0 (initial release + readme + receipts + abandon), v0.1.1 (statusline witness-requirement), v0.1.2 (close-transition auto-archive), v0.1.3 (schema-guard tightening + proof-doc scrub).
- Known-issues tracker: `docs/known-issues.md` (targeted for demotion of the closed-ledger entry by Task 6).
- Changelog: `CHANGELOG.md` (v0.1.4 entry added by Task 5, verification addendum by Task 8).
- Angle 2 (rejected for this release): `plan-enforcer-discuss --retire-prior` opt-in flag. Documented as a future candidate in `docs/known-issues.md` tail by Task 6, not built.
