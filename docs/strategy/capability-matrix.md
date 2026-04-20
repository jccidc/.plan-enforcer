# Capability Matrix

**Purpose.** Factual product-surface comparison across planning + execution + enforcement + audit capabilities. This is **not** a performance benchmark — it does not measure speed, quality, or elegance. It measures what each system actually provides as a structural guarantee, verifiable from repo artifacts or documented behavior.

**Scope.** Plan Enforcer native is inspected directly from this repo; file/line refs provided. GSD and Superpowers rows are based on observed behavior in the framework-comparison benchmark captures and publicly-documented design. Any uncertain cell is marked `Partial` with a note. Hybrid columns are now partially benchmarked via live Scenario H composability runs; where a row is still not fully proven beyond that narrow hybrid slice, the note says so explicitly.

**Rule:** no cell is `Yes` without a concrete artifact or
implementation reference. Every `Yes` below carries a file path, skill,
or CLI binary reference. `Partial` and `No` are similarly annotated
when possible.

**Values.** `Yes` · `Partial` · `No` · `Pending verification`.

---

## Matrix

| # | Capability | GSD | Superpowers | Plan Enforcer Native | GSD + Plan Enforcer | Superpowers + Plan Enforcer |
|---|------------|-----|-------------|----------------------|---------------------|-----------------------------|
| 1 | Creates explicit on-disk plan | Yes `[G1]` | Yes `[S1]` | Yes `[N1]` | Yes `[H1]` | Yes `[H1]` |
| 2 | Creates explicit on-disk task tracker | Yes `[G2]` | Partial `[S2]` | Yes `[N2]` | Yes `[H2]` | Yes `[H2]` |
| 3 | Tracks task status on disk during execution | Yes `[G2]` | Partial `[S2]` | Yes `[N2]` | Yes `[H2]` | Yes `[H2]` |
| 4 | Persists resume state across fresh session | Yes `[G3]` | Yes `[S3]` | Yes `[N3]` | Yes `[H3]` | Yes `[H3]` |
| 5 | Logs deviations on disk | Partial `[G4]` | Partial `[S4]` | Yes `[N4]` | Yes `[H4]` | Yes `[H4]` |
| 6 | Deviation schema is typed / structured | No `[G5]` | No `[S5]` | Yes `[N5]` | Yes `[H4]` | Yes `[H4]` |
| 7 | Blocks unplanned edits structurally | No `[G6]` | No `[S6]` | Yes `[N6]` | Yes `[H5]` | Yes `[H5]` |
| 8 | Blocks deletions structurally | No `[G7]` | No `[S7]` | Yes `[N7]` | Yes `[H5]` | Yes `[H5]` |
| 9 | Gates completion on unfinished work | No `[G8]` | No `[S8]` | Yes `[N8]` | Yes `[H5]` | Yes `[H5]` |
| 10 | Gates verification on evidence quality | No `[G9]` | No `[S9]` | Partial `[N9]` | Partial `[H5]` | Partial `[H5]` |
| 11 | Executes and validates verification commands | No | No | Yes `[N10]` | Yes `[H5]` | Yes `[H5]` |
| 12 | Audit trail reconstructible from repo artifacts alone | Partial `[G10]` | Partial `[S10]` | Yes `[N11]` | Yes `[H6]` | Yes `[H6]` |
| 13 | Tier-aware enforcement (advisory / structural / enforced) | No `[G11]` | No `[S11]` | Yes `[N12]` | Yes `[H7]` | Yes `[H7]` |
| 14 | Supports imported external plans | Partial `[G12]` | Partial `[S12]` | Yes `[N13]` | Yes `[H10]` | Yes `[H10]` |
| 15 | Exposes audit / query CLI surface | No `[G13]` | No `[S13]` | Yes `[N14]` | Yes `[H8]` | Yes `[H8]` |
| 16 | Can act as additive enforcement layer over another workflow | No `[G14]` | No `[S14]` | Yes `[N15]` | Yes `[H9]` | Yes `[H9]` |

---

## Reading the matrix

- Plan Enforcer native has `Yes` on every enforcement-layer row (7-16) except row 10, which remains a narrower evidence-quality gate. Every other system has `No` on those rows, because they rely on prompt-level discipline rather than hook-level enforcement.
- GSD and Superpowers have `Yes` on planning + tracking + persistence rows (1-4) because that is their core product area.
- The hybrid columns (GSD + Plan Enforcer, Superpowers + Plan
  Enforcer) are no longer design-only. Scenario H composability runs
  now exist for both and prove the additive stack works on a live
  carryover cell. What remains unproven is breadth, not first proof.
- Row 11 (**executes and validates verification commands**) is now `Yes` for Plan Enforcer Native. The product has a first-class explicit path (`check_cmd`) plus evidence/package/session-log detection, blocks red results on verified transitions, and surfaces missing/stale/no-command truth in status/logs/report/audit/session-end instead of leaving it implicit.

## What this matrix is not

- **Not a performance benchmark.** See `benchmarks/framework-comparison/FINAL-REPORT-2026-04-17.md` for the current execution/carryover lane. Capability presence is orthogonal to delivery speed.
- **Not a single-score scoreboard.** Per the reframe doc's rule, do not collapse this to a total or claim a winner. The entries stand on their own.
- **Not marketing copy.** This is an internal reference artifact. The public framing that distills from it lives in the publish-draft docs and should be phrased in buyer language.

## The headline this enables

From Codex's reframe:

> "GSD and Superpowers are planning/execution workflows. Plan Enforcer is an enforcement and audit layer that can run natively or strengthen other workflows."

And:

> "Keep your preferred planner. Add Plan Enforcer as the enforcement and audit layer."

---

## Artifact references

Each reference is a concrete file, CLI binary, or skill that implements or demonstrates the capability.

### Plan Enforcer Native (N-series)

- **[N1]** `skills/plan-enforcer-draft/SKILL.md` — drafter skill produces on-disk plan. `src/plan-detector.js` + `src/plan-analyzer.js` process the result into ledger form.
- **[N2]** `src/ledger-parser.js` schema v2: `.plan-enforcer/ledger.md` with Scoreboard, Task Ledger (pipe table: `ID | Task | Status | Evidence | Chain | Notes`), Decision Log, Reconciliation History sections. `src/plan-detector.js:145` `generateLedger()` emits the format.
- **[N3]** `hooks/session-start.js:150-220` — auto-activation + `<!-- schema: v2 -->` migration + stale-ledger detection all operate on the persisted ledger, allowing resumption across fresh sessions.
- **[N4]** Decision Log table in every ledger; `src/ledger-parser.js:118` `parseDecisionLog()` extracts rows. Typed `type` column: `unplanned`, `delete`, `scope-expand`, `accept-mixed-coverage`, and custom types.
- **[N5]** Typed deviation schema enforced by `src/ledger-parser.js` parser + consumed by `hooks/delete-guard.js:220-230` (`hasDeleteDRow`) and `hooks/chain-guard.js` (`isCovered` path). Not a free-form narrative — an enumerated `type` gates behavior.
- **[N6]** `hooks/chain-guard.js` — fires on PreToolUse for Edit/Write, blocks at structural/enforced tier when the target file isn't in the plan's `planned_files` list and has no covering D-row. Tests: `tests/chain-guard.test.js`.
- **[N7]** `hooks/delete-guard.js` — fires on PreToolUse for Bash (rm, git rm, git clean), Edit (empty new_string), MultiEdit (bulk deletions). Blocks without a typed `delete` D-row. Tests: `tests/delete-guard.test.js`.
- **[N8]** `hooks/session-end.js` — completion-gate assertion. `src/config.js` VALID_GATES = {`soft`, `hard`, `audit`}. `hard` mode blocks session end with open rows. Tests: `tests/session-end.test.js`. **Caveat (2026-04-13 rerun):** gating detection works — `hard` mode reliably blocks false completion emissions. But in practice, native frequently hits this gate, triggers a recovery loop, and only then converges to a terminal ledger. The `Yes` on this row reflects correct *detection* of false completion; first-pass deterministic completion (the model reaching terminal state before the gate fires) is the open gap tracked as moat-todo §9.
- **[N9]** `hooks/evidence-gate.js` — fires on row transitions to `verified` status. `src/evidence.js` exports `VERIFY_WITHOUT_METHOD` + `VERIFY_VAGUE` regex families that require evidence strings to name concrete artifacts (commit SHA, test file, tool output). Tests: `tests/evidence.test.js`, `tests/evidence-edge.test.js`, `tests/evidence-gate.test.js`. **Partial** because it validates the shape of the string, not the execution of the command it describes — see §N10.
- **[N10]** `hooks/evidence-gate.js` executes a resolved verification command on `verified` transitions via `src/executed-verification.js`. Resolution order: explicit `check_cmd` override, evidence-cited command, package/convention fallback, then recent matching session-log verification command. Red result blocks the verification transition and writes `.plan-enforcer/checks/*.log` + `.json` sidecars. `hooks/session-end.js` refuses hard/audit close when the latest executed verification is missing, red, or stale. `src/status-cli.js`, `src/logs-cli.js`, and `src/report-cli.js --active` surface check state and tell the operator when to set `check_cmd`, making the command path first-class instead of best-effort.
- **[N11]** `Chain` column on every ledger row carries `C:<commit-sha>` or `C:harness <source>` tokens linking evidence to authorship. `src/chain-cli.js` (`plan-enforcer-chain`) + `src/why-cli.js` (`plan-enforcer-why`) + `src/audit-cli.js` (`plan-enforcer-audit`) query the trail; `src/export-cli.js` (`plan-enforcer-export`) dumps as JSON for external tooling.
- **[N12]** `src/tier.js:28` `TIERS = ['advisory', 'structural', 'enforced']`. Each hook reads `readTier()` and calls `shouldBlock(action)` → tier-specific behavior. `src/config-cli.js` exposes `plan-enforcer-config --tier advisory|structural|enforced`. Tests: `tests/tier.test.js`, `tests/config.test.js`.
- **[N13]** `src/import-cli.js` ships as `plan-enforcer-import` / `plan-enforcer import`. It imports supported markdown plan shapes into `.plan-enforcer/ledger.md`, writes `.plan-enforcer/config.md`, and makes bring-your-own-plan a first-class documented path (`docs/examples/bring-your-own-plan.md`, `docs/cli.md`).
- **[N14]** `package.json` bin field declares 16 binaries: `plan-enforcer`, `plan-enforcer-awareness`, `plan-enforcer-audit`, `plan-enforcer-chain`, `plan-enforcer-config`, `plan-enforcer-discuss`, `plan-enforcer-export`, `plan-enforcer-import`, `plan-enforcer-lint`, `plan-enforcer-logs`, `plan-enforcer-phase-verify`, `plan-enforcer-report`, `plan-enforcer-review`, `plan-enforcer-status`, `plan-enforcer-verify`, `plan-enforcer-why`. Each wraps a `src/*-cli.js` entry point.
- **[N15]** Hooks in `hooks/*.js` fire on any Claude Code session whose `.claude/settings.json` points at them, regardless of which planner drafted the plan. `benchmarks/framework-comparison/scripts/run-comparison.sh` now drives live `gsd-pe` and `superpowers-pe` cells, converting this from design intent into exercised plumbing.

### Hybrid columns (H-series — live-verified composability)

- **[H1]** Parent workflow still owns plan drafting. Verified 2026-04-19 in `benchmarks/framework-comparison/COMPOSABILITY-SCENARIO-H-COMPARISON.md` with live `gsd-pe` and `superpowers-pe` cells.
- **[H2]** Parent tracker/plan artifacts remain active while Plan Enforcer's ledger coexists. Verified in the same composability run via `docs/plans/*` + `.plan-enforcer/archive/*` artifacts under both hybrid cell dirs.
- **[H3]** Parent persistence plus Plan Enforcer resume/truth artifacts coexist on disk in the live hybrid run outputs.
- **[H4]** Plan Enforcer's Decision Log + typed D-row substrate remains the authoritative deviation/audit record once seeded, regardless of parent planner. Verified by the presence of `.plan-enforcer/archive/*` and phase-verdict sidecars in hybrid cells.
- **[H5]** Plan Enforcer's chain-guard + delete-guard + evidence-gate + session-end hooks are inherited by hybrid runs because the same seeded settings/config path is used for `gsd-pe` and `superpowers-pe` in `run-comparison.sh`. Live cells now exist; this is no longer design-only.
- **[H6]** Chain/audit reconstruction remains queryable from Plan Enforcer artifacts in the hybrid cells, demonstrated by shipped `outcome.json`, `ask-fidelity.json`, archives, and captured worktree artifacts.
- **[H7]** Tier-aware behavior is a property of Plan Enforcer's hooks and config; hybrid cells seed the same structural tier and therefore inherit it.
- **[H8]** The 13 CLI binaries query the Plan Enforcer ledger/truth surfaces and are therefore available against hybrid-produced PE artifacts as well.
- **[H9]** `Plan Enforcer` can act as an additive enforcement layer over another workflow. Verified 2026-04-19 by `COMPOSABILITY-SCENARIO-H-COMPARISON.md`.
- **[H10]** Imported/external-plan support is `Yes` in hybrid mode as well because `plan-enforcer-import` is now a first-class product surface. Hybrid planners can hand Plan Enforcer a markdown plan and land in the same ledger/runtime path.

### GSD (G-series — external, documented or inferred)

- **[G1]** `/gsd-plan-phase`, `/gsd-new-project`, `/gsd-new-milestone` skills produce `.planning/PLAN.md` and related files. Observed in benchmark captures under `benchmarks/framework-comparison/results/*/*/gsd/planning/`.
- **[G2]** `.planning/PROGRESS.md` in benchmark captures carries task-by-task status. Procedural discipline; no schema enforcement.
- **[G3]** PROGRESS.md with "next task" pointers survived multi-session continuity benchmark (session 1 → session 2 resumed cleanly).
- **[G4]** Deviations are captured informally in PLAN.md updates and commit messages. No dedicated typed log. `Partial`.
- **[G5]** No typed schema. Deviations are narrative.
- **[G6]** No structural enforcement. Relies on `/gsd-execute-phase` discipline. Agent can edit any file.
- **[G7]** No delete guard.
- **[G8]** No completion gate. `/gsd-autonomous` finishes when the agent says so.
- **[G9]** No structural verification gate.
- **[G10]** Audit reconstructible from PLAN.md + PROGRESS.md + git log. `Partial` because deviations are narrative, not typed.
- **[G11]** No tier mechanism. One operating mode.
- **[G12]** `/gsd-import` skill exists for importing plans. `Partial` because integration with other frameworks' plan shapes is loose.
- **[G13]** No dedicated audit CLI surface. `/gsd-progress`, `/gsd-stats` exist but are not external-tool queryable.
- **[G14]** Not designed as an additive layer. GSD runs as a whole or not at all.

### Superpowers (S-series — external, documented or inferred)

- **[S1]** `writing-plans` skill produces an on-disk plan document in the worktree.
- **[S2]** In-session tracking via TodoWrite (in-memory) plus `PROGRESS.md` written at key checkpoints. `Partial` because task status is not always on disk during active execution.
- **[S3]** `PROGRESS.md` with "Do NOT redo 1-N" style hints persists; confirmed in multi-session benchmark session 1 artifact.
- **[S4]** Deviations captured in `DEVIATIONS.md` in some runs but not structurally required. `Partial`.
- **[S5]** No typed schema.
- **[S6]** No structural enforcement.
- **[S7]** No delete guard.
- **[S8]** No completion gate. Superpowers' `executing-plans` skill ends when the model declares done.
- **[S9]** No structural verification gate. `verification-before-completion` skill encourages evidence but doesn't block.
- **[S10]** Audit reconstructible from plan docs + PROGRESS.md + DEVIATIONS.md + git log. `Partial`.
- **[S11]** No tier mechanism.
- **[S12]** No explicit import CLI. Plans flow through the `writing-plans` skill. `Partial`.
- **[S13]** No audit CLI surface.
- **[S14]** Not designed as an additive layer.

---

## Verification status

| Column | Status |
|--------|--------|
| Plan Enforcer Native | All `Yes`/`Partial` cells inspected from this repo; refs provided. |
| GSD | **Verified 2026-04-13 via local install inspection** at `~/.claude/skills/gsd-*` (68 skill directories). Each skill is a `SKILL.md` markdown file with YAML frontmatter declaring `allowed-tools` from the standard Claude Code tool set (`Read`, `Write`, `Edit`, `Bash`, `Task`, `TodoWrite`, etc.). No `hooks/`, no `.js` files, no `settings.json` bundled with GSD anywhere in the install tree. GSD is architecturally a **prompt-level workflow plugin** — all guidance reaches the agent through skill instructions, not through pre-tool-use or post-tool-use hook interception. This confirms the `No` on enforcement-layer rows (6-10, 13, 15-16) and the `Partial` on deviation logging (5) and audit reconstructibility (12). |
| Superpowers | **Verified 2026-04-13 via marketplace repo inspection** at `~/.claude/plugins/marketplaces/superpowers-marketplace/` (git clone of the official marketplace) and skill cache at `~/.claude/plugins/cache/temp_git_*/skills/`. Marketplace ships `README.md` + `LICENSE` at top level; skills under the cache path include `writing-plans`, `executing-plans`, `subagent-driven-development`, `verification-before-completion`, `systematic-debugging`, `brainstorming`, and others. No `.js` hook files, no `settings.json` with hook registrations, no `hooks/` directory anywhere in the distribution. Same architectural pattern as GSD: **prompt-level workflow plugin**. The `verification-before-completion` skill is noteworthy — it's a procedural discipline prompt that asks the agent to verify before claiming completion, analogous to Plan Enforcer's evidence-gate but implemented as instruction rather than hook-level block. This confirms `No` on enforcement-layer rows and `Partial` on audit reconstructibility. |
| GSD + Plan Enforcer | **Verified 2026-04-19 on Scenario H.** Hybrid stack completed `16/16` with ask-fidelity pass. This proves additive enforcement works on a live carryover cell; broader hybrid scenario coverage is optional follow-on work, not a first-proof blocker. |
| Superpowers + Plan Enforcer | **Verified 2026-04-19 on Scenario H.** Hybrid stack completed `16/16` with ask-fidelity pass. Same read as GSD hybrid: first proof landed, wider hybrid coverage remains future depth work. |

## Architecture differentiation in one sentence

GSD and Superpowers are **prompt-level** workflow plugins: all behavior is instruction to the agent. Plan Enforcer is a **hook-level** enforcement layer: behavior is mechanical interception of tool calls. The two approaches are not competitors on the same axis — they operate at different layers of the Claude Code stack, which is why the composability benchmark makes sense and why the additive-layer positioning is defensible.

## Next actions this matrix unblocks

1. **Broaden executed-verification coverage further.** The first-class path is now closed, but more command families and repo conventions can still be added over time.
2. **Deepen first-class examples.** Keep BYO-plan, authored-path, resume, and proof-surface examples aligned with the shipped runtime.
3. **Optional wider hybrid coverage.** Scenario H proved first composability. Only add more hybrid scenarios if we need deeper GTM proof.
