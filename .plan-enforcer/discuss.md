# Abandon-Plan Feature — First-Class /plan-enforcer-abandon

## Source Ask

> sometimes I'll be in the middle of a plan or whatever and I changed my mind right... There really is no slash command to cleanly archive that plan. Any thoughts on this

> six months down the road I changed my mind and I'm like oh I wonder what that plan was. The fact that I can have an archive and you know look up what that plan was is probably pretty important too

User confirmed "build the full feature" after a brief discussion of alternatives. Walkthrough of pain: user has hit this personally and I hit it manually earlier today when pivoting from the README rebuild plan to the closure-receipt-feature plan (D6 in the closed ledger captures the manual dance).

## Normalized Goal

Plan Enforcer has no clean way to abandon an in-flight plan. Today it requires the user (or me) to manually add a Decision Log row covering all non-terminal T-IDs, rewrite the ledger, write an archive file, and fight the schema-guard along the way. Collapse that into one command: `plan-enforcer-abandon --reason "<why>"` marks remaining rows superseded, logs the pivot, triggers the shipped auto-emission hook so a closure receipt fires, archives the active ledger, and clears the active slot. The archive must stay human-readable and discoverable months later so "I wonder what that plan was" is answerable without git archaeology.

## Non-Negotiables

- NN1: single command (`plan-enforcer-abandon` / `/plan-enforcer-abandon`) does the whole flow atomically -- no manual Decision-Log authoring, no manual archive writing
- NN2: `--reason "<text>"` is REQUIRED -- the command refuses to run without a reason, same discipline the Decision Log enforces on every row
- NN3: integrates with the shipped receipt feature -- the plan-close.js hook's auto-emission must fire, the resulting receipt joins the walkable Prior-closure chain for that plan-slug
- NN4: archive file lands at `.plan-enforcer/archive/<iso>-<slug>.md` matching the convention already established by `src/archive.js` and the existing archive entry
- NN5: archived file retains the full human-readable ledger format (scoreboard, task table with every row and its final status, Decision Log including the abandon entry, reconciliation history, archive-frontmatter noting the abandonment)
- NN6: archives must be easy to browse later -- `plan-enforcer-report` with no args already lists/reads archive files, this feature must not regress that path
- NN7: no new dependencies; reuse existing helpers in `src/archive.js` (`archiveLedger`, `buildArchiveFilename`, `parseArchiveFile`, `listArchiveReports`)
- NN8: ASCII only inside CLI output and skill prose (CLAUDE.md global rule)
- NN9: forbidden-language rule (CLAUDE.md) applies to any new committed file
- NN10: existing conventions preserved -- CLI / bin / skill / hook patterns match the shape of the receipt feature we just shipped

## Hidden Contract Candidates

- HC1: idempotence -- running `plan-enforcer-abandon` twice in a row against the same state must NOT double-archive or emit two abandonment receipts; the second invocation errors cleanly because there is no active plan to abandon
- HC2: safety against "accidental abandon" -- the command must require `--reason`, and ideally also print a short "this will abandon N pending tasks, confirm" prompt (or `--force` to skip). Abandoning is cheap to recover from (archive preserves everything) but still deserves a guard.
- HC3: audit integrity -- after abandonment, the archived ledger file must be sufficient alone to reconstruct what the plan was, what was verified before abandon, which rows were not done, and why the user pulled the cord. No "you had to be there" gaps.
- HC4: discoverable archive -- `.plan-enforcer/archive/` directory listing + filename convention + frontmatter inside each archive must let a six-months-later user run `plan-enforcer-report` (or `ls` + grep) and find the plan by slug, date, or reason keyword
- HC5: abandonment receipt chain -- the emitted closure receipt goes to `.plan-enforcer/proof/closure-<slug>-<iso>.md` as usual; its "Prior closure" link is whatever the plan-slug had before; the plan-slug stays the same so the chain survives
- HC6: active-plan precondition -- abandon refuses if no active plan (no `.plan-enforcer/ledger.md`) OR if the plan is already fully closed (no non-terminal rows). Edge case handled with a clear error message.
- HC7: fresh-ledger ready -- after abandonment, `.plan-enforcer/ledger.md` is removed (OR reset to empty state) so the next `plan-enforcer discuss` / `plan-enforcer import` starts cleanly without needing manual intervention

## Plausible Interpretations

- PI1 (new D-row type "abandon"): introduce a new Decision Log type. Pros: semantically explicit. Cons: schema change ripples through `VALID_D_TYPES`, ledger-schema-guard, renderers.
- PI2 (reuse type "pivot"): abandon IS a pivot away from the plan. Existing type, no schema change. My pick.
- PI3 (reuse type "delete"): wrong fit -- delete is for removing rows/code, not the plan itself. Rejected.

- PI4 (filename `-abandoned` suffix): `closure-<slug>-<iso>-abandoned.md` and `<iso>-<slug>-abandoned.md`. Pros: visible at `ls`. Cons: breaks alignment with established archive naming and receipt chain (receipts look for `closure-<slug>-*.md` when resolving prior closure).
- PI5 (no suffix): use existing conventions; content (D-row reason + all rows superseded in the task table) tells you it is an abandonment. My pick.

- PI6 (bundle companion browse command in this feature): add `/plan-enforcer-history` skill that lists archive entries nicely. Pros: one-stop. Cons: `plan-enforcer-report` already does this via the `[archive-path]` arg default; a wrapper may be redundant.
- PI7 (rely on existing `plan-enforcer-report`): document the browse path in the abandon skill's "See also" and in the proof pack, do not ship a new browse skill in this feature. My pick.

- PI8 (introduce new "abandoned" T-row status): would add a terminal status variant. Pros: explicit. Cons: changes `TERMINAL_STATUSES` in multiple files (hooks/session-end, hooks/plan-close, src/ledger-parser, receipt renderer), and the reason is already captured in the D-row evidence + archive frontmatter.
- PI9 (reuse existing "superseded" status): no schema change, receipt renderer already treats superseded correctly, the D-row carries the abandonment reason. My pick.

- PI10 (require in-flight plan only): abandon only runs if at least one non-terminal row exists. Already-closed plans do not need abandoning; they can archive via the existing close + archive path. Edge-case: abandon on empty / missing ledger errors with a clear message. My pick.
- PI11 (allow on any state): abandon would archive regardless. Looser but lets user use one command for "retire this plan even if closed". Rejected -- confusing semantics; retiring a closed plan is a different operation.

## Chosen Interpretation

PI2 + PI5 + PI7 + PI9 + PI10. A new `src/abandon-cli.js` performs the full flow against the active ledger: preflight (non-terminal rows exist, reason present), inject a `pivot`-typed Decision Log row citing every non-terminal T-ID and the user's reason, flip every non-terminal row to `superseded` with evidence `abandoned: <reason>`, call the existing `archiveLedger` helper in `src/archive.js` to write `.plan-enforcer/archive/<iso>-<slug>.md` with frontmatter naming the abandonment, remove `.plan-enforcer/ledger.md`, and return the emitted receipt path (the shipped plan-close.js hook would normally fire, but since we are deleting the active ledger after close, the abandonment flow calls `receipt-cli.js` directly to guarantee the receipt emits and gets its Prior-closure link resolved before the ledger is removed). Companion browse is delegated to the already-existing `plan-enforcer-report` CLI.

## Rejected / Forbidden Narrowings

- FN1: skipping the Decision Log row ("just clear the ledger") -- violates the whole custody story; abandonment is itself a decision that must be recorded
- FN2: allowing `--reason` to be empty or defaulted -- the required reason is the point; defaulting weakens discipline
- FN3: silent archive -- the command must print the archive path AND the receipt path to stdout so the user can follow up
- FN4: making this a hard-delete flow -- no content is ever destroyed; archive keeps the full ledger
- FN5: tying this to a specific tier -- abandon is a ledger transformation, not a hook, works at every tier
- FN6: changing the archive filename convention for abandonment -- stay aligned with existing files
- FN7: introducing a new D-row type or T-row status (PI1, PI8 rejected)
- FN8: shipping a second browse command alongside this (PI6 rejected in favor of existing `plan-enforcer-report`)
- FN9: requiring the user to hand-edit ledger.md anywhere in the flow -- one command does everything
- FN10: emitting the receipt after archive removal -- receipt must fire against the final abandoned state of ledger.md, not against a deleted file

## In Scope

- Add `src/abandon-cli.js` with exported functions (testable): `preflight(projectRoot, opts)`, `markAllNonTerminalSuperseded(ledgerContent, reason)`, `injectAbandonDecisionRow(ledgerContent, taskIds, reason)`, `archiveAndClear(projectRoot, ledgerContent, slug)`, `emitAbandonReceipt(projectRoot, slug)`, `main(argv)`
- Add `"plan-enforcer-abandon": "src/abandon-cli.js"` to `package.json` bin
- Add `skills/plan-enforcer-abandon/SKILL.md` -- slash command, prose paragraphs explaining when and how to use
- Wire the new skill + module into `install.sh` (skills loop line 72, modules loop line 100) and mirror into `uninstall.sh`
- Tests under `tests/` (node --test): `abandon-cli.test.js` unit tests for the exported functions; `abandon-integration.test.js` end-to-end in a tmp project fixture exercising preflight, full run, idempotence, missing-reason error, receipt chain preservation
- Update `docs/cli.md` with a `plan-enforcer-abandon` section next to `plan-enforcer-receipt`
- Update root `README.md` section 06 Lifecycle (or 04/05) to mention the abandon path as the mid-flight pivot option

## Out of Scope

- Companion browse / list command (`plan-enforcer-report` already handles it)
- "Unabandon" / resume-abandoned -- a follow-up plan can reference the archive path and re-import relevant tasks; there is no undo semantic
- Recycling the plan-slug across abandon and re-start -- each new plan gets its own slug, same-slug collisions are user's call
- Purge / hard-delete of archived plans -- the whole point is retention
- Multi-plan or phase-level abandon beyond the active ledger
- UI / dashboard for browsing archives -- CLI + markdown is enough for launch
- Statusline stage change on abandon (stage reset is a nice-to-have, handled by the next discuss call automatically)

## Constraints

- Pure Node, no new runtime dependencies
- CLI must exit 0 on success, non-zero on preflight failure with the specific reason printed to stderr
- ASCII only in every new committed file
- Filename: `.plan-enforcer/archive/<utc-iso>-<slug>.md`; ISO minus colons (matches existing); slug derived from source plan path or `<!-- source: -->` metadata (same helper `deriveSlug` the receipt-cli uses -- expose/reuse, do not duplicate)
- Archived file's frontmatter must include `<!-- archived: <iso> -->` AND `<!-- archive-reason: <reason> -->` AND the source plan path; build on `src/archive.js#buildFrontmatter` (already exists)
- Works at all three tiers (advisory / structural / enforced)
- Existing tests green after install (modulo the pre-existing statusline-hook failures under D2 override)

## Success Signals

- Running `plan-enforcer-abandon --reason "scope changed"` against an in-flight plan returns in one command: writes archive file, emits closure receipt, removes active ledger, prints both paths to stdout
- Running it on a closed or empty ledger errors cleanly (exit non-zero, stderr "no active plan to abandon")
- Running it without `--reason` errors cleanly (exit non-zero, stderr "--reason required")
- The emitted receipt's Prior-closure link correctly references the previous closure for the same plan-slug if one exists (walkable chain preserved)
- Archive file opens standalone and a cold reader can answer: what was the plan, what got verified before abandon, what was left, what reason the user gave
- `plan-enforcer-report` with no args lists the new abandoned archive entry alongside any normal-close archives
- All new tests pass under `node --test`
- Forbidden-language grep clean on every new committed file
- ASCII grep clean on every new committed file

## Drift Risks

- DR1: drafter introduces a new D-row type "abandon" anyway (violates PI2 choice)
- DR2: drafter introduces a new T-row status "abandoned" (violates PI9 choice)
- DR3: drafter puts `-abandoned` suffix on archive or receipt filenames (breaks conventions)
- DR4: drafter ships a separate browse command (violates PI7 choice)
- DR5: drafter emits the receipt AFTER removing the ledger, breaking the receipt-cli input path
- DR6: drafter allows abandonment without reason via a default or fallback (NN2 violation)
- DR7: drafter forgets `docs/cli.md` update so the CLI reference does not list the command
- DR8: drafter does not reuse `deriveSlug` from receipt-cli, duplicates logic
- DR9: drafter skips the idempotence test (HC1) -- second-invocation double-archive is a silent regression
- DR10: drafter breaks `plan-enforcer-report` archive browsing because the new archive file lacks required frontmatter fields
- DR11: drafter writes the skill SKILL.md in caveman fragments instead of paragraph prose (the skill file is public documentation)

## Proof Requirements

- PR1: real end-to-end run in this repo (or a synthetic test plan) produces a valid archive file + closure receipt in one invocation
- PR2: idempotence test: second invocation against the (now cleared) ledger errors cleanly instead of emitting a duplicate archive
- PR3: missing-reason test: exit non-zero, stderr names the flag
- PR4: chain-walkability test: when a plan has been closed-then-abandoned (two closures for the same slug), the abandonment receipt's Prior closure links to the first closure receipt -- proving the chain crosses close AND abandon
- PR5: `plan-enforcer-report` with no args lists the abandoned archive entry and `plan-enforcer-report <archive-file>` renders its content correctly
- PR6: every new committed file passes forbidden-language grep (CLAUDE.md) and ASCII grep
- PR7: `install.sh` end-to-end on a fresh tmp directory wires the new skill, module, and bin wrapper correctly
- PR8: tests pass: `node --test tests/abandon-cli.test.js tests/abandon-integration.test.js` green
- PR9: the skill SKILL.md names the command's three-phase behavior (archive, receipt, clear) and points the reader at `plan-enforcer-report` for browse

## Draft Handoff

Phase shape hint (drafter is free to refine):

1. **Preflight helpers + CLI skeleton** -- `src/abandon-cli.js` with arg parsing (`--reason <text>`, `--help`), preflight (active ledger present, at least one non-terminal row, reason non-empty); printable error messages; no-op main() returning 2 without args
2. **Core transformation** -- implement the three ledger edits: inject Decision Log pivot row citing all non-terminal T-IDs + user reason; flip every non-terminal row to `superseded` with evidence `abandoned: <reason>`; sanity-check resulting content parses back into the same T-IDs with all-terminal states
3. **Archive + clear** -- call existing `archiveLedger` from `src/archive.js` with the transformed content (passes frontmatter through), then remove active `.plan-enforcer/ledger.md`
4. **Receipt emission** -- directly call `writeReceipt` from `src/receipt-cli.js` against the transformed content (not the removed file); print both paths
5. **bin + skill + install wiring** -- package.json bin entry; skills/plan-enforcer-abandon/SKILL.md with paragraph prose + usage + "see also: plan-enforcer-report" section; install.sh + uninstall.sh list updates
6. **Tests** -- unit + integration covering every success signal and drift risk; tmp-project pattern matching tests/plan-close-hook.test.js and tests/receipt-cli.test.js
7. **Documentation** -- docs/cli.md entry; README section update naming the pivot path; forbidden-language + ASCII discipline grep clean
8. **Self-verify** -- run the command against a dummy active plan in this repo or a tmp project, confirm the archive + receipt both land, confirm `plan-enforcer-report` lists the archive entry

Planning red lines (drafter must NOT silently change):

- reuse existing D-row type `pivot` and existing T-row status `superseded` -- no schema changes
- filename conventions for archive and closure receipt match current formats -- no `-abandoned` suffix
- companion browse command is NOT shipped in this feature -- `plan-enforcer-report` already exists
- `--reason` is REQUIRED -- no default, no fallback
- receipt must emit BEFORE ledger removal
- reuse `deriveSlug` / `filenameSafeIso` / `findPriorClosure` from receipt-cli rather than duplicating
- Must preserve the walkable chain: the abandonment receipt's Prior-closure link is computed from existing receipts for the same plan-slug, not fabricated
- no new dependencies
- ASCII only inside CLI stdout, skill prose, tests, archive file content
- skill SKILL.md written as paragraphs, not caveman fragments (it is public documentation)
