# Abandon-Plan Feature -- /plan-enforcer-abandon

**Goal:** Ship `plan-enforcer-abandon` as a first-class command so a user can retire an in-flight plan in one shot. The command injects a `pivot` Decision Log row covering all non-terminal T-IDs, flips those rows to `superseded` with evidence `abandoned: <reason>`, emits a closure receipt into the walkable chain, archives the active ledger to `.plan-enforcer/archive/<iso>-<slug>.md`, and removes `.plan-enforcer/ledger.md` so the next discuss or import starts clean.

**Constraints:**
- Pure Node, no new runtime dependencies. Reuse `src/archive.js` (`archiveLedger`, `cleanupWorkingFiles`, `buildArchiveFilename`, `buildFrontmatter`) and `src/receipt-cli.js` (`deriveSlug`, `filenameSafeIso`, `writeReceipt`, `findPriorClosure`) rather than duplicating.
- `--reason "<text>"` is REQUIRED. No default, no fallback, no interactive prompt. The required reason is sole authorization (user confirmed option "a" during discuss).
- Reuse existing Decision Log type `pivot` (already in `VALID_D_TYPES = deviation, unplanned, delete, pivot, override`). Do NOT introduce a new `abandon` type.
- Reuse existing T-row status `superseded` (already in `TERMINAL_STATUSES`). Do NOT introduce a new `abandoned` status.
- Archive filename: existing convention `<iso>-<slug>.md` under `.plan-enforcer/archive/`. No `-abandoned` suffix.
- Closure receipt: existing convention `closure-<slug>-<iso>.md` under `.plan-enforcer/proof/`. No `-abandoned` suffix. Receipt must emit BEFORE the active ledger is removed so `receipt-cli` can read final state.
- ASCII-only in every committed file (CLAUDE.md global rule). No Unicode box-drawing, em-dashes, or smart quotes.
- Brand-protection forbidden-language grep (CLAUDE.md global) must pass on every new file.
- Node test runner is `node --test` (matches existing `tests/*.test.js`).
- Works at every tier (`advisory`, `structural`, `enforced`). Abandon is a ledger transformation, not a hook.
- No companion browse command in this feature -- `plan-enforcer-report` already handles archive listing via `listArchiveReports` / `formatArchiveReport`.

**Out of scope:**
- `/plan-enforcer-history` or dedicated archive-browse command (existing `plan-enforcer-report` covers it).
- Unabandon / resume-from-abandoned semantic. A follow-up plan can `plan-enforcer-import` from an archived path; there is no single-command undo.
- Purge / hard-delete of archived plans. Retention is the whole point.
- Slug-collision handling for repeated abandonment of the same slug. `writeReceipt` already has `-2`, `-3` suffix logic for same-millisecond collisions; `archiveLedger` gets its timestamp from `buildArchiveFilename` which already embeds ISO. Same-second collision is acceptable edge case.
- Multi-phase or phase-level abandon beyond the single active ledger.
- Statusline stage reset on abandon. Next `discuss` / `import` invocation resets stage naturally.
- Confirm-prompt / `--force` flag. User picked option (a) during discuss: `--reason` is sole authorization.
- Pre-existing `tests/statusline-hook.test.js` failures (D2 override from prior plans continues to apply).
- UI dashboard for browsing archives.

## Must-Haves

- MH1: `plan-enforcer-abandon --reason "<text>"` against an in-flight plan (at least one non-terminal row) completes atomically -- archive file written, closure receipt emitted, active ledger removed, both artifact paths printed to stdout, exit 0. A:I52
- MH2: Running without `--reason`, against a missing ledger, or against a fully-closed ledger exits non-zero with a clear stderr message and does NOT mutate any file on disk. A:I52
- MH3: The emitted closure receipt's `## Prior closure` section correctly links to the most recent existing receipt for the same plan-slug (walkable chain survives abandonment), or reads `none (first close of this plan)` when no predecessor exists. A:I52
- MH4: The archived ledger at `.plan-enforcer/archive/<iso>-<slug>.md` is self-contained: a cold reader six months later can open it and answer what the plan was, what got verified, what was not done, and why the user pulled the cord -- no git archaeology needed. A:I53
- MH5: `plan-enforcer-report` (with no args) lists the abandoned archive entry alongside any normal-close archives, and `plan-enforcer-report <archive-path>` renders the abandoned archive's full content. A:I53
- MH6: Schema unchanged -- existing code that reads T-row statuses, Decision Log types, receipt format, and archive frontmatter continues to work. No `grep` across the repo finds any new D-type "abandon" or T-status "abandoned". A:I52
- MH7: Every new committed file passes ASCII-only grep and forbidden-language grep (CLAUDE.md global). A:I52 A:I53

### Task 1: Scaffold `src/abandon-cli.js` with preflight + arg parsing A:I52

- [ ] Create `src/abandon-cli.js` with shebang `#!/usr/bin/env node` and the same file shape as `src/receipt-cli.js`: requires block (`fs`, `path`, `./ledger-parser`, `./archive`, `./receipt-cli`), function definitions, `module.exports`, then `if (require.main === module) process.exit(main(process.argv.slice(2)) \|\| 0);`.
- [ ] Export on `module.exports`: `parseArgs(argv)`, `preflight(projectRoot, opts)`, `markAllNonTerminalSuperseded(ledgerContent, reason)`, `injectAbandonDecisionRow(ledgerContent, taskIds, reason)`, `archiveAndClear(projectRoot, transformedContent)`, `emitAbandonReceipt(projectRoot, transformedContent)`, `main(argv)`.
- [ ] `parseArgs(argv)` handles: `--reason <text>` (required), `--help`. Returns `{ help, reason }`. Unknown flags produce a stderr warning line but do not exit (match `receipt-cli.js` style).
- [ ] `printUsage()` writes a 6-line usage string to stderr and exits 0 when `--help` is passed.
- [ ] `preflight(projectRoot, opts)`: returns `{ ok, ledgerPath, rows, slug, errMsg }`. Fails when: ledger at `.plan-enforcer/ledger.md` missing, `parseTaskRows` returns empty, every non-superseded row is already in `TERMINAL_STATUSES`, `opts.reason` missing or empty-after-trim. Each failure writes one-line stderr message ("plan-enforcer-abandon: no active plan to abandon", "plan-enforcer-abandon: --reason required", etc.) and returns `ok: false`.
- [ ] `main(argv)` wiring: call `parseArgs`, handle `--help`, then call `preflight(process.cwd(), opts)`; on preflight fail return exit code 2; on preflight pass, later tasks fill in the real flow; for now stub to return 0 so the scaffold is runnable.
- [ ] Verification: `node --check src/abandon-cli.js` passes; `node src/abandon-cli.js --help` exits 0 and prints a usage string containing `--reason`; `node src/abandon-cli.js` with no args exits non-zero and stderr contains `--reason`.

### Task 2: Implement the ledger transformation A:I52 A:I53

- [ ] Implement `markAllNonTerminalSuperseded(ledgerContent, reason)`: walks the Task Ledger table line by line using the same regex family as `src/ledger-parser.js#parseTaskRows`, and for every row whose status is not in `TERMINAL_STATUSES = {verified, skipped, blocked, superseded}`, replace the `| Status |` cell with `| superseded |` and the `| Evidence |` cell with `| abandoned: <reason-trimmed-to-40-chars> |`. Return the new content string and an array of mutated T-IDs.
- [ ] Implement `injectAbandonDecisionRow(ledgerContent, taskIds, reason)`: locate the Decision Log table in the content (pattern `## Decision Log` followed by `| ID | Type |`), compute the next `D<N>` id (max-existing + 1; if empty table then D1), build one markdown row with type `pivot`, scope = comma-joined T-IDs, reason = `Plan abandoned: <full reason>`, evidence = `plan-enforcer-abandon invocation 2026-04-22T<iso>`, append it after the last D-row, return new content.
- [ ] Both functions are pure (input -> output string), no file IO. Make them unit-testable in isolation.
- [ ] Add an `assert`-style sanity check inside the CLI main flow AFTER both transformations run: re-parse the result with `parseTaskRows`, verify every returned row is in `TERMINAL_STATUSES`. If not, throw with a descriptive error (indicates a parser-regex mismatch bug and should not silently abandon).
- [ ] Verification: unit tests in Task 6 cover: (1) markAllNonTerminalSuperseded flips pending/in-progress but leaves verified/skipped/blocked/superseded untouched; (2) injectAbandonDecisionRow computes next ID from a ledger with D1-D3 existing (-> D4) and from an empty log (-> D1); (3) the sanity assertion catches a forged malformed transformation (e.g., a row the regex misses).

### Task 3: Wire archive + clear using existing helpers A:I53

- [ ] Implement `archiveAndClear(projectRoot, transformedContent)`: read current ledger metadata via `src/ledger-parser.js#parseMetadata`, compute stats via `parseLedger`, determine tier (read `.plan-enforcer/config.md` via `src/config.js#readConfig` if present, else default `structural`), call `src/archive.js#archiveLedger(enforcerDir, transformedContent, stats, tier, now)` which returns `{ archiveName, archivePath }`. DO NOT write the transformed content to `.plan-enforcer/ledger.md` first -- pass the in-memory transformed string directly. The function also writes the archive frontmatter automatically.
- [ ] After archive write succeeds, call `src/archive.js#cleanupWorkingFiles(enforcerDir)` to remove `ledger.md`, `.tool-count`, `.stale-count`, `.ledger-mtime`, `.activated`, `statusline-state.json` (matches the existing list in archive.js line 110).
- [ ] Return `{ archivePath, archiveName }` for the main flow to print.
- [ ] Verification: integration test (Task 6) runs abandonment against a tmp project, asserts the archive file exists at the expected path, asserts `.plan-enforcer/ledger.md` does NOT exist afterward, asserts the archive file content includes the injected D-row and all rows in superseded state.

### Task 4: Emit the abandonment receipt before removal A:I52

- [ ] Implement `emitAbandonReceipt(projectRoot, transformedContent)`: write the transformed content to `.plan-enforcer/ledger.md` temporarily (the transformed content, NOT the original), call `src/receipt-cli.js#writeReceipt(projectRoot, {})`, capture returned `{ path, filename, slug, iso, planOpen }`. Return that object.
- [ ] Call order inside main flow: transformation -> emitAbandonReceipt (writes temp ledger + receipt) -> archiveAndClear (reads that temp ledger, writes archive frontmatter+content, then removes temp ledger via cleanupWorkingFiles). This preserves the invariant that receipt-cli always reads from the canonical ledger path.
- [ ] Alternative considered (rejected): write temp ledger to a scratch path and point writeReceipt at it -- would require adding a `ledgerPath` override arg to writeReceipt. The current implementation of writeReceipt already accepts `options.ledgerPath`, so actually PREFER that path: emitAbandonReceipt writes the transformed content to a scratch `.plan-enforcer/.abandon-scratch-<pid>.md` and calls `writeReceipt(projectRoot, { ledgerPath: scratchPath })`, then deletes the scratch file. This avoids polluting `.plan-enforcer/ledger.md` at any point.
- [ ] Verify the resulting receipt's `Prior closure` section correctly resolves: `findPriorClosure(proofDir, slug)` returns the latest existing `closure-<slug>-*.md` (or null). The receipt is an ordinary closure-receipt in every other respect -- the abandonment is visible via the task table's all-superseded rows and the D-row pivot reason, not via filename or special headers.
- [ ] Verification: integration test (Task 6) runs a two-step scenario -- first an ordinary close (writes `closure-<slug>-<iso1>.md`), then an abandonment (writes `closure-<slug>-<iso2>.md` with `Prior closure` linking to `<iso1>`). Assert the chain.

### Task 5: Wire CLI + skill + install scripts A:I52

- [ ] Add `"plan-enforcer-abandon": "src/abandon-cli.js"` to the `"bin"` object in [package.json](package.json), inserted alphabetically between `"plan-enforcer"` and `"plan-enforcer-awareness"`.
- [ ] Create `skills/plan-enforcer-abandon/SKILL.md` with frontmatter (name, description) mirroring the style of `skills/plan-enforcer-receipt/SKILL.md`. Description: `"Abandon an in-flight Plan Enforcer plan with a required reason. Use when you have decided to stop working on the active plan. The command archives the full ledger (readable and browsable later), emits a closure receipt into the walkable chain, and clears the active slot so the next discuss or import starts clean. For browsing archived plans, see plan-enforcer-report."`. Body is written as paragraphs (not caveman fragments); names the three-phase flow (archive, receipt, clear), the required `--reason` flag, and points readers at `plan-enforcer-report` for browsing.
- [ ] Update [install.sh](install.sh) skills loop (the `for skill in plan-enforcer plan-enforcer-discuss ...` line near the top) to include `plan-enforcer-abandon`. Update the modules loop (the `for module in archive.js audit.js ...` line) to include `abandon-cli.js`. Update the hooks loop -- no new hook needed, skip.
- [ ] Update [uninstall.sh](uninstall.sh) similarly: add `plan-enforcer-abandon` to its skills list and to its wrapper-binary removal list.
- [ ] Verification: `bash -n install.sh` clean; `bash -n uninstall.sh` clean; `grep -c '"plan-enforcer-abandon"' package.json` returns 1; `ls skills/plan-enforcer-abandon/SKILL.md` succeeds; `grep -q plan-enforcer-abandon install.sh uninstall.sh` succeeds in both.

### Task 6: Tests -- unit + integration + chain + idempotence A:I52 A:I53

- [ ] Create `tests/abandon-cli.test.js`: unit coverage. Tests: parseArgs with missing reason returns missing flag; parseArgs with --help flags help; markAllNonTerminalSuperseded flips only non-terminal rows and preserves evidence formatting; injectAbandonDecisionRow appends exactly one row with correct next-ID and type `pivot`; sanity assertion fires when transformation produces an invalid state (forced via a fixture with malformed row).
- [ ] Create `tests/abandon-integration.test.js`: end-to-end coverage in a tmpdir-per-test pattern (match `tests/plan-close-hook.test.js` / `tests/receipt-cli.test.js`). Tests: (1) happy path -- two pending tasks, one verified, one blocked; run abandon with `--reason "scope changed"`; assert archive file exists, `.plan-enforcer/ledger.md` removed, closure receipt emitted under `.plan-enforcer/proof/`, receipt mentions the D-row reason, verified/blocked rows preserved as-is; (2) missing reason -- exit code non-zero, stderr contains `--reason`, no files mutated; (3) empty ledger -- exit non-zero, stderr contains `no active plan`; (4) already-closed ledger (all rows terminal) -- exit non-zero, stderr contains `no active plan to abandon`; (5) idempotence -- after a successful abandon, running abandon again returns exit non-zero because there is no active ledger.
- [ ] Create `tests/abandon-chain.test.js`: chain-walkability coverage. Test: start with a closed plan + one existing closure receipt for slug X; reopen plan X with fresh tasks; run `plan-enforcer-abandon --reason "..."` on the reopened plan; assert the new abandonment receipt's `Prior closure` section links to the earlier closure receipt (proves the receipt chain survives abandonment), assert both receipts use the same plan-slug.
- [ ] Update `tests/install-parity.test.js` or equivalent if it enumerates installed skills/modules -- add abandon entries to the expected set. If no such test exists, skip with a one-line note in task evidence.
- [ ] Verification: `node --test tests/abandon-cli.test.js tests/abandon-integration.test.js tests/abandon-chain.test.js` reports `pass` for all tests, zero failures. Pre-existing `tests/statusline-hook.test.js` failures remain (covered by standing D2 override).

### Task 7: Documentation updates A:I52 A:I53

- [ ] Add a `## plan-enforcer-abandon` section to [docs/cli.md](docs/cli.md), inserted alphabetically. Content includes: usage block (`plan-enforcer-abandon --reason "<text>"`), body describing the three-phase flow (archive -> receipt -> clear), the required flag, exit codes (0 success, 1 unexpected failure, 2 preflight error), and a "See also" line pointing at `plan-enforcer-report` for browsing archives.
- [ ] Update [README.md](README.md) section 07 Lifecycle prose: add one sentence naming the abandon path as the first-class mid-flight pivot option (e.g., "If you change your mind mid-plan, `plan-enforcer-abandon --reason "<why>"` archives the full ledger so you can look it up later and emits a closure receipt so the chain still lands."). Do NOT add a new figure.
- [ ] `grep -l plan-enforcer-abandon README.md docs/cli.md` returns both files.
- [ ] Verification: `grep -P '[^\x00-\x7F]' README.md docs/cli.md` returns empty (ASCII clean); `grep -E 'reverse|byte.for.byte|libgpc|Swizzy|Larry|Jimmy CrakCrn' README.md docs/cli.md` returns empty (forbidden-language clean).

### Task 8: Self-verify -- abandon a real active plan end-to-end A:I52 A:I53

- [ ] Create a synthetic active plan for self-verification: write `.plan-enforcer/ledger.md` pointing at a fake source plan with three tasks (one verified, two pending). Use a distinct plan-slug like `abandon-self-verify` to avoid colliding with any real history.
- [ ] Run `node src/abandon-cli.js --reason "self-verification of abandon feature"`. Capture both printed paths (archive + receipt) from stdout.
- [ ] Open the archive file at the printed path. Confirm: frontmatter includes `archived`/`archive-reason` fields, Decision Log contains the new pivot row citing the two pending T-IDs, task table shows all rows terminal (one verified + two superseded with `abandoned:` evidence), the receipt filename appears referenced.
- [ ] Open the receipt file at the printed path. Confirm: `## Prior closure` is either a link or `none (first close of this plan)`; `## Status` shows all three rows terminal; Decision Log summary lists the new pivot row; `## Files changed` includes whatever the working tree has.
- [ ] Run `node src/abandon-cli.js --reason "again"` a second time; assert exit non-zero and no new archive file is written (idempotence).
- [ ] Run `node src/report-cli.js` with no args; assert the output lists the synthetic archive file in the summary.
- [ ] Remove the synthetic archive + receipt files at the end of the task so the repo does not accumulate self-verify artifacts. Record the cleanup in task evidence (archive path and receipt path that were produced then removed).
- [ ] Verification: all five confirmation points above pass. Evidence row in ledger cites the archive + receipt paths (pre-cleanup) and the exit codes from each run.

## Assumptions

- `src/archive.js#archiveLedger` handles the frontmatter generation correctly when the ledger content is already in a post-abandonment state (all active rows `superseded`). The existing function counts `skipped/superseded` via regex, so `superseded` rows are counted as `skipped` in the frontmatter -- that is a pre-existing semantic and this feature does not change it.
- `src/receipt-cli.js#writeReceipt` accepts `options.ledgerPath` to point at an alternate ledger file. Verified earlier in this session when building receipt-cli (the `options.ledgerPath \|\| path.join(enforcerDir, 'ledger.md')` line).
- The tier detection fallback in Task 3 (read `.plan-enforcer/config.md` via `src/config.js#readConfig`, else `structural`) uses existing module API; will confirm during implementation.
- Pre-existing `tests/statusline-hook.test.js` failures continue to exist and continue to be covered by the D2 override carried forward across plans.
- `plan-enforcer-report` with no args already lists archive files -- survived from earlier surveys of `src/report-cli.js`. If behavior differs at execution time, Task 7 verification will catch it and a follow-up fix is required (not expected).
