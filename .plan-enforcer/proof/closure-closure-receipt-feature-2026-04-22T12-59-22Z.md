# Closure Receipt -- closure-receipt-feature (plan still open at emission time -- mid-flight snapshot)

**Plan source:** docs/plans/2026-04-22-closure-receipt-feature.md
**Closed at (UTC):** 2026-04-22T12:59:22.231Z
**Tier:** structural

## Prior closure
- none (first close of this plan)

## Status
```
0/8 verified  |  0 blocked  |  0 skipped  |  0 superseded  |  8 remaining
drift: 0
```

## Task ledger
| ID | Task | Status | Evidence |
|----|------|--------|----------|
| T1 | Write src/receipt-cli.js (ledger-in, markdown-receipt-out) | pending |  |
| T2 | Lock standardized receipt SECTION_ORDER layout inside receipt-cli | pending |  |
| T3 | Wire plan-enforcer-receipt as CLI (package.json bin) + skill (SKILL.md) | pending |  |
| T4 | Write hooks/plan-close.js (PostToolUse close-transition detector) | pending |  |
| T5 | Wire new hook into install.sh + uninstall.sh (structural + enforced) | pending |  |
| T6 | Tests (node --test): receipt-cli, plan-close-hook, receipt-chain | pending |  |
| T7 | Documentation updates (README, CLAUDE.md, ROADMAP.md grep-first) | pending |  |
| T8 | Self-verify: plan's own close auto-emits its own closure receipt | pending |  |

## Decision Log summary
| ID | Type | Scope | Reason (short) |
|----|------|-------|----------------|
| D1 | delete | T1, T2, T3, T4, T5, T6, T7, T8, T9, T10, T11, T12, T13, T14, | README rebuild plan (2026-04-21) closed for active tracking and archived at .plan-enforcer/archive/2026-04-22T04-00-00Z- |

## Reconciliation history
_(no reconciliation rounds recorded)_

## Files changed
```
HEAD: e790e1d

.plan-enforcer/awareness.md            |   2 +
 .plan-enforcer/discuss.md              | 207 ++++++++++++++++++++-------------
 docs/playground/readme-playground.html |  77 +++++++++---
 scripts/readme-playground-server.js    |  26 ++++-
 tests/readme-playground.test.js        |  21 ++++
 5 files changed, 229 insertions(+), 104 deletions(-)
```

## Blocked / open coordination
_(nothing blocked; plan is closed)_

## Proof artifacts
- [closure-readme-rebuild.md](./closure-readme-rebuild.md)

## Plan-specific extras
### Must-Haves (from plan)

- MH1: When the last non-terminal task in an active ledger flips to a terminal status (verified / skipped / blocked / superseded), a closure receipt file is automatically written to `.plan-enforcer/proof/closure-<plan-slug>-<utc-iso>.md` with no plan-author action. A:I50 A:I51
- MH2: A `plan-enforcer-receipt` CLI (via `bin/`) and a `/plan-enforcer-receipt` slash command (via `skills/plan-enforcer-receipt/SKILL.md`) both emit a fresh receipt against the current ledger on demand, whether the plan is closed or still open (mid-flight snapshots allowed). A:I50
- MH3: Every receipt is its own file (per-emission timestamped filename) and is never overwritten. Repeated closures of the same plan (after reopen) produce a chronologically ordered series of files. A:I50
- MH4: Every receipt includes a "Prior closure" section whose value is either a markdown link to the most recent prior receipt for the same plan-slug or the literal text "none (first close of this plan)". The value is computed by listing existing `closure-<plan-slug>-*.md` files in `.plan-enforcer/proof/` and picking the one with the latest ISO timestamp. A:I50
- MH5: Auto-emission failure modes degrade gracefully. Specifically: missing `git` -> receipt still emits with "files changed: unavailable (git not present)"; malformed ledger -> hook logs a warning via `stderr`, exits with code 0, does not block the triggering ledger edit; write permission failure -> same. A:I50
- MH6: Existing Plan Enforcer flows continue to work unchanged. `plan-enforcer` (executor), `plan-enforcer-status`, `plan-enforcer-report`, `hooks/session-end.js`, `hooks/post-tool.js`, and `hooks/evidence-gate.js` all produce identical output and behavior on plans that do NOT trigger a close-transition during the tested edit. A:I50

### Task 1: Write `src/receipt-cli.js` -- pure ledger-in, markdown-receipt-out A:I50

- [ ] Create `src/receipt-cli.js` with the standard project shape: shebang, `require`s of `./ledger-parser` (for `parseMetadata`, `parseLedger`, `parseTaskRows`, `parseDecisionLog`), `./archive` for reconciliation parsing, `fs`, `path`, `child_process`.
- [ ] Export at least the following functions on `module.exports` so tests can import them: `deriveSlug(planSourcePath)`, `filenameSafeIso(date)`, `findPriorClosure(proofDir, slug)`, `renderReceipt(ledgerState, gitInfo, priorClosurePath)`, `writeReceipt(projectRoot, ledgerState, options)`, `main(argv)`.
- [ ] `deriveSlug(planSourcePath)`: from a path like `docs/plans/2026-04-22-closure-receipt-feature.md`, return `closure-receipt-feature`. Strip `docs/plans/` prefix, `.md` suffix, leading `NNNN-NN-NN-` date prefix when present.
- [ ] `filenameSafeIso(date)`: return UTC ISO like `2026-04-22T03-45-00Z` -- colons replaced with hyphens, milliseconds dropped. Input: `Date` object; output: string.
- [ ] `findPriorClosure(proofDir, slug)`: read `proofDir`, filter filenames matching `closure-<slug>-*.md`, sort lexically descending (ISO-8601 sorts correctly), return first entry's basename OR `null` if none.
- [ ] `renderReceipt(ledgerState, gitInfo, priorClosurePath)`: produce markdown following the section layout in Task 2. Include a leading `## Prior closure` section whose value is either `[closure-<slug>-<prev-iso>.md](./closure-<slug>-<prev-iso>.md)` or `none (first close of this plan)`. Never include Unicode.
- [ ] `writeReceipt(projectRoot, ledgerState, options)`: assemble output filename via `deriveSlug` + `filenameSafeIso(new Date())`, ensure `.plan-enforcer/proof/` exists via `fs.mkdirSync({ recursive: true })`, write the rendered receipt. Return `{ path, slug, iso }`. Never overwrite: if the exact target filename already exists (same millisecond collision), append `-2`, `-3`, etc. until a fresh path is found.
- [ ] `main(argv)`: parse `--plan-slug <slug>`, `--out <path>`, `--open-ok` (tolerate open ledger, default true), `--closed-only` (exit non-zero if plan not closed). Without flags: read `.plan-enforcer/ledger.md`, call `writeReceipt`, print resulting path to stdout, exit 0.
- [ ] Handle git absence: wrap `execSync('git diff --stat ...')` in try/catch; on failure, populate `gitInfo.changedFilesAvailable = false` and receipt prints "files changed: unavailable (git not present or repo not in git state)".
- [ ] CLI usage string (`--help`) names every flag and exits 0.
- [ ] Verification: file exists at `src/receipt-cli.js`; running `node src/receipt-cli.js --help` exits 0 and prints the usage string containing the four flags; `node --check src/receipt-cli.js` passes (no syntax errors).

### Task 2: Lock the standardized receipt section layout A:I50

- [ ] Inside `src/receipt-cli.js`, define `SECTION_ORDER` as the ordered list of section headings the receipt renders. Exact order (no omissions):
  1. `# Closure Receipt -- <plan title or slug>`
  2. `## Prior closure` (MH4 requirement)
  3. `## Status` (scoreboard snapshot: N/total tasks, verified, skipped, blocked, superseded, drift, tier, closed-at UTC ISO)
  4. `## Task ledger` (table of every non-superseded task: ID, name, status, evidence)
  5. `## Decision Log summary` (table of every D-row: ID, type, scope, one-line reason)
  6. `## Reconciliation history` (every R-row, ordered)
  7. `## Files changed` (`git diff --stat` output between plan start SHA and HEAD, OR "unavailable" note)
  8. `## Blocked / open coordination` (every blocked row with its notes; plus any TODO coordination items surfaced in notes)
  9. `## Proof artifacts` (list of every file under `.plan-enforcer/proof/` existing at emission time, with short descriptions)
  10. `## Plan-specific extras` (only if the source plan exposed a `Must-Haves` section or `Proof Requirements`; else skip)
- [ ] Each section is implemented as a named renderer (`renderPriorClosure`, `renderStatus`, ...) so tests can unit-test rendering in isolation.
- [ ] For `## Plan-specific extras`: read the source plan file via the ledger metadata `<!-- source: docs/plans/<file>.md -->`; if parseable, extract `## Must-Haves` and `## Proof Requirements` sections verbatim and include them. If the plan file is missing or unparseable, skip this section silently (do not error).
- [ ] All output text is ASCII; no em-dashes, no smart quotes, no Unicode arrows. Use `--` for em-dash substitutes, `->` for arrows.
- [ ] Verification: unit tests in Task 6 cover each renderer individually against a fixed ledger fixture; running `node src/receipt-cli.js --out /tmp/test.md` against a sample ledger produces a file whose sections match `SECTION_ORDER` exactly in that order.

### Task 3: Wire `plan-enforcer-receipt` as CLI + skill A:I50

- [ ] Add `"plan-enforcer-receipt": "src/receipt-cli.js"` to the `"bin"` object in [package.json](package.json). Keep alphabetical ordering of other bin entries (between `plan-enforcer-phase-verify` and `plan-enforcer-status`).
- [ ] Create `skills/plan-enforcer-receipt/SKILL.md`. Frontmatter: `name: plan-enforcer-receipt`, `description: "Emit a Plan Enforcer closure receipt against the current ledger. Use when you want an on-demand receipt (plan open or closed), or to snapshot progress mid-flight. Auto-emission on close is handled by the post-tool hook; this skill is for explicit requests."`. Body: written as paragraphs (not caveman fragments), names the receipt path convention, says the command prefers the installed CLI (`plan-enforcer-receipt`) when available and falls back to `node "$HOME/.claude/skills/plan-enforcer/src/receipt-cli.js"`.
- [ ] Update [install.sh](install.sh) lines 72 (skills loop), 87 (hooks loop), 100 (modules loop) as follows: append `plan-enforcer-receipt` to the skills-loop list; append `plan-close.js` (see Task 4) to the hooks-loop list; append `receipt-cli.js` to the modules loop list.
- [ ] Update [uninstall.sh](uninstall.sh) to remove the same three entries when uninstalling.
- [ ] Verification: `grep -c '"plan-enforcer-receipt"' package.json` returns 1; `ls skills/plan-enforcer-receipt/SKILL.md` succeeds; `grep -q plan-enforcer-receipt install.sh` succeeds; `grep -q plan-enforcer-receipt uninstall.sh` succeeds.

### Task 4: Write `hooks/plan-close.js` -- PostToolUse close-transition detector A:I50

- [ ] Create `hooks/plan-close.js` modeled on `hooks/post-tool.js`'s existing project-root resolution logic (reuse `findUpEnforcerDir` / `findDownEnforcerDir` via require, or copy the pattern verbatim if they aren't exported yet -- prefer refactor-to-export if the tests in Task 6 need both hooks reading the same logic).
- [ ] The hook receives `toolContext` from stdin (same JSON shape as `post-tool.js` at lines 31-35). Inspect `toolContext.tool_name` and `toolContext.tool_input.file_path`. If the edit target is not `.plan-enforcer/ledger.md`, exit 0 immediately.
- [ ] Parse the post-edit ledger via `parseTaskRows`. Let `activeRows` = rows whose status is NOT `superseded`. Let `pendingRows` = activeRows whose status is NOT in `TERMINAL_STATUSES = {verified, skipped, blocked}` (superseded is already excluded from active). If `pendingRows.length > 0`, plan is not closed -- exit 0.
- [ ] If `pendingRows.length === 0` AND activeRows.length > 0 (avoid firing on an empty ledger): compare with the PRE-edit ledger state via `toolContext.tool_input.old_string` OR by reading a cached previous-state marker at `.plan-enforcer/.last-close-hash`. If pre-edit ledger had pending rows OR `.last-close-hash` does not match the current all-terminal state, this is a close-transition -- fire emission. Otherwise (no-op edit on already-closed ledger), exit 0 silently (HC3 idempotence).
- [ ] On close-transition: spawn `src/receipt-cli.js` as a child process, passing the project root's ledger explicitly. Do NOT block -- use `spawn` with `detached: false` but do not wait on its completion (synchronously start, asynchronously complete; hook exits after spawn). Wrap spawn in try/catch and on error log to stderr and exit 0. Never block the user's ledger edit.
- [ ] Update `.plan-enforcer/.last-close-hash` to the sha256 of the new ledger content on successful transition detection. This prevents repeat emissions on no-op re-saves.
- [ ] Exit code: always 0 unless catastrophic (e.g., node itself crashes). Hook errors never block ledger edits.
- [ ] Verification: Task 6 tests exercise: (a) edit that closes the plan emits receipt, (b) edit that does not close (still pending) emits nothing, (c) second edit on already-closed ledger emits nothing, (d) malformed ledger causes stderr warning but exit 0, (e) `.last-close-hash` file is created and updated correctly.

### Task 5: Wire the new hook into install.sh settings.json logic A:I50

- [ ] In `merge_with_node_structural` (install.sh lines 207-319): add a `planCloseCmd = node "${hooksDir}/plan-close.js"` constant after the other `*Cmd` constants (around line 253). In the PostToolUse section (around line 299), add the new command via the same `addHook` pattern used in `merge_with_node` (OR use the inline "existingPostToolCmds" Set pattern if the structural function doesn't yet have `addHook`). Add a `console.log` line reporting the newly-enabled hook.
- [ ] In `merge_with_node` (install.sh lines 321-399): add the same `planCloseCmd` constant and add it via `addHook('PostToolUse', planCloseCmd)` after the existing `post-tool.js` hook registration.
- [ ] In the manual-install fallback sections (install.sh lines 446-459 for structural; lines 455-459 for enforced): update the printed JSON examples to include the new `plan-close.js` entry in PostToolUse.
- [ ] Same treatment in `uninstall.sh` -- the hook entry must be removed when uninstalling.
- [ ] Verification: after running `install.sh --tier structural` in a clean test directory, `cat .claude/settings.json | python3 -c "import json,sys; d=json.load(sys.stdin); print(any('plan-close.js' in h.get('command','') for e in d['hooks']['PostToolUse'] for h in e.get('hooks',[])))"` prints `True`. Same check for `--tier enforced`.

### Task 6: Tests using `node --test` matching existing `tests/` convention A:I50

- [ ] Create `tests/receipt-cli.test.js`. Cover: `deriveSlug` pulls slug from path variants (`docs/plans/YYYY-MM-DD-foo.md`, `docs/plans/foo.md`, `foo.md`); `filenameSafeIso` produces colon-free string; `findPriorClosure` returns latest ISO basename; `renderReceipt` emits the SECTION_ORDER in order; `writeReceipt` writes to the computed path, never overwrites; each of the ten section renderers handles empty input without throwing.
- [ ] Create `tests/plan-close-hook.test.js`. Cover: close-transition fires emission (spawn called with correct argv); non-closing edit does not fire; no-op on already-closed does not fire (idempotent); malformed ledger produces stderr warning and exit 0; missing `git` produces receipt with "unavailable" in files-changed section; hook never exits non-zero. Use a tmpdir-per-test pattern matching `tests/chain-guard.test.js` or `tests/evidence-gate.test.js`.
- [ ] Create `tests/receipt-chain.test.js`. Cover (PR11 chain-walkability): close a plan -> receipt 1 emitted with "none (first close)"; reopen same plan (add new task), close again -> receipt 2 emitted with "Prior closure" linking to receipt 1's basename. Read both files, assert the link text matches receipt 1's filename exactly.
- [ ] Update `tests/install-parity.test.js` (or similar install-verifying test if one exists) to expect the new hook in both structural and enforced tier outputs.
- [ ] Verification: `node --test tests/receipt-cli.test.js tests/plan-close-hook.test.js tests/receipt-chain.test.js` -- all three files pass (look for `pass 100%` or exit code 0). Pre-existing `tests/statusline-hook.test.js` failures remain (D2 override from prior plan still in effect).

### Task 7: Documentation updates A:I50

- [ ] Update [README.md](README.md) section 02 (The Custody Chain) OR add a footnote / inline reference naming the new skill `plan-enforcer-receipt` in the list of surfaces. Keep prose style matching the just-rewritten terminal-native voice (paragraphs, not fragments). Do NOT add a new figure.
- [ ] Update [CLAUDE.md](CLAUDE.md) if it enumerates the public skill set. Grep first: `grep -l plan-enforcer-status CLAUDE.md docs/` -- wherever the list exists, add the new skill. If there is no enumerated list anywhere, skip this sub-step with a one-line note in the task evidence.
- [ ] Update [ROADMAP.md](ROADMAP.md) if it lists skill surfaces; same grep-first approach. Skip with evidence note if no list.
- [ ] Add an entry in `docs/assets/_design-system.md` ONLY if receipts reference any of the new assets. They don't, so skip -- include this null-entry in evidence to prove it was considered.
- [ ] Verification: `grep -l plan-enforcer-receipt README.md` returns README.md (at minimum); `grep -E 'reverse|byte.for.byte|libgpc|Swizzy|Larry|Jimmy CrakCrn' README.md CLAUDE.md ROADMAP.md 2>/dev/null` returns empty (forbidden language); `grep -P '[^\x00-\x7F]' README.md` returns empty.

### Task 8: Self-verify -- the feature generates its own closure receipt when this plan closes A:I50 A:I51

- [ ] After Tasks 1-7 land and tests pass, the executor will itself close this plan by flipping the last task to verified. The new hook must detect that transition and auto-emit a receipt at `.plan-enforcer/proof/closure-closure-receipt-feature-<iso>.md`.
- [ ] Verification: `ls .plan-enforcer/proof/closure-closure-receipt-feature-*.md` returns exactly one new file matching the closure-transition timestamp (within a few minutes of ledger flip); the file's "Prior closure" section reads "none (first close of this plan)" (no prior closure for this slug exists); the file's "Files changed" section accurately reflects the 10+ new / modified files from Tasks 1-7 (`src/receipt-cli.js`, `hooks/plan-close.js`, `skills/plan-enforcer-receipt/SKILL.md`, `package.json` diff, `install.sh` diff, tests, README diff).
- [ ] If the auto-emission fails to trigger (e.g., hook not wired correctly), fall back to running `plan-enforcer-receipt` explicitly and mark Task 4 or Task 5 as the regression source in the ledger. Do NOT silently skip the self-verification.
- [ ] Record the closure receipt's path in the final ledger evidence so it is traceable from the ledger back to the receipt that closed the work.
