# Plan Enforcer Awareness Ledger
<!-- schema: v0-handauthored -->
<!-- created: 2026-04-13 -->
<!-- note: pre-P7 hand-authored. Becomes the self-enforcement + migration fixture when P7 ships. -->
<!-- note: pre-capture rows derived from CLAUDE.md / README.md / ROADMAP.md, not verbatim user text — flagged source: pre-capture so the future verbatim-verification lint skips them. -->

## Project-level intents (pre-capture)

These represent the founding intents of the Plan Enforcer project,
reconstructed from CLAUDE.md, README.md, ROADMAP.md, and prior
session handoffs. They predate the user-message.js hook and so
cannot be verbatim-verified — the design doc's one-way ratchet
explicitly accommodates this via `source: pre-capture`.

| ID | Quote (best-effort summary) | Source | Captured |
|----|------------------------------|--------|----------|
| I1 | ship structural chain of custody for AI-assisted coding — every line traceable back to a plan step or typed Decision Log entry | pre-capture (CLAUDE.md product thesis + README headline) | 2026-04-13 |
| I2 | enforce via hooks, not cooperative prompts — prompt-level "log deviations" gets ignored under context pressure | pre-capture (moat-todo Item 0 + design/plan-enforcer-phase.md) | 2026-04-13 |
| I3 | self-enforcement of the discipline we ship — every edit to this codebase goes through our own enforcer | pre-capture (CLAUDE.md self-enforcing rules) | 2026-04-13 |
| I4 | atomic commits per task, no squashing, deviation commits include a Decision: line | pre-capture (CLAUDE.md commit discipline) | 2026-04-13 |
| I5 | tier-aware behavior everywhere: advisory / structural / enforced — no inline tier branching | pre-capture (CLAUDE.md architecture constraints) | 2026-04-13 |
| I6 | turn the benchmark win from "tied for first" into "clear #1" while shipping the headline chain-of-custody feature nobody else has | pre-capture (ROADMAP.md goal) | 2026-04-13 |
| I7 | finish authorship gap before P5b benchmark rerun — no point rerunning until every piece is in place | pre-capture (P3b ledger context, attributed to user priority call 2026-04-12) | 2026-04-13 |

## This-session intents (legacy verbatim, pre-hook)

Captured from the 2026-04-13 conversation before `user-message.js`
existed. Quotes are still verbatim from the user, but they predate the
capture hook and so fall under the same one-way-ratchet rule as other
pre-hook material: treat them as `source: pre-capture` for verification.

| ID | Quote | Source | Captured |
|----|-------|--------|----------|
| I8 | "okay let's stay on this What do we need to do to tighten things up" | pre-capture (verbatim session-2026-04-13) | 2026-04-13 |
| I9 | "yeah let's go with capture mechanic and then link offering" | pre-capture (verbatim session-2026-04-13) | 2026-04-13 |
| I10 | "lets go with your reccomendation, is self-enforcement plan in place so we can learn as we go?" | pre-capture (verbatim session-2026-04-13) | 2026-04-13 |
| I11 | "retro-capture intents from this repo's session, and run through all open items as you desire, lets knock all this shit out" | pre-capture (verbatim session-2026-04-13) | 2026-04-13 |
| I12 | ship a dogfood playbook for Plan Enforcer work packages with seed capture execute verify audit archive and push cadence | manual | 2026-04-19 |
| I13 | update the README launch surface to link the dogfood playbook and the hard-launch checklist | manual | 2026-04-19 |
| I14 | leave a human-readable dogfood proof note with status verify audit report and archive artifact paths from this repo-local run | manual | 2026-04-19 |
| I15 | restore the README dogfood path and hard-launch checklist so the operator story matches the shipped workflow | manual | 2026-04-20 |
| I16 | guard broken internal markdown links with a regression test so proof surfaces do not silently rot again | manual | 2026-04-20 |
| I17 | repair public proof surfaces so README and proof links resolve to real repo artifacts | manual | 2026-04-20 |
| I18 | prove every referenced verification command ran by executing multi-command evidence sets instead of only one inferred check | manual | 2026-04-20 |
| I19 | work through every single one of these without interruption | manual | 2026-04-20 |
| I20 | executed verification must treat repo-owned verification wrapper scripts as first-class commands | manual | 2026-04-20 |
| I21 | operator consumers must surface missing failed stale script-frontdoor checks clearly | manual | 2026-04-20 |
| I22 | executed verification must preserve explicitly cited verification command arguments | manual | 2026-04-20 |
| I23 | executed verification must preserve repeated explicit runner-command bundles across the remaining high-signal surfaces | manual | 2026-04-20 |
| I24 | parallel todo closure should land as one tracked PE integration run with retained proof and archive artifacts | manual | 2026-04-20 |
| I25 | resolve conflicts while keeping lab as source of truth and launch-safe tags accurate | manual | 2026-04-20 |
| I26 | review worker outputs and merge the bounded lane changes without regressing unrelated surfaces | manual | 2026-04-20 |
| I27 | run targeted verification for each landed lane and then run npm test | manual | 2026-04-20 |
| I28 | retain status verify audit and report artifacts for this integration package | manual | 2026-04-20 |
| I29 | archive the package cleanly and keep follow-on proof artifacts | manual | 2026-04-20 |
| I30 | close executed verification only when claimed checks are either runnable and passing or blocked with explicit repair guidance | manual | 2026-04-20 |
| I31 | close dogfood depth only when repeated real PE work packages and same-loop bug fixes are documented from retained repo artifacts | manual | 2026-04-20 |
| I32 | promote canonical docs only if dogfood depth is honestly closed and remove it from the open stack | manual | 2026-04-20 |
| I33 | Continue autonomously on canonical todo item 3, operator polish, and close real operator-facing gaps without launch-staging edits. | manual | 2026-04-20 |
| I34 | retain proof and reassess archive report operator output and awareness scoping for current package | manual | 2026-04-20 |
| I35 | lock archive report cleanup with regression tests for archive report status and logs surfaces | manual | 2026-04-20 |
| I36 | filter archive report inputs so report ignores verdict sidecars and only counts real archived ledgers | manual | 2026-04-20 |
| I37 | public front-door docs and skills must standardize on discuss -> draft -> review instead of presenting combobulate as the product story | manual | 2026-04-20 |
| I38 | retained proof must show cleaned discuss-flow surfaces, green regressions, and an archived PE package that honestly closes discuss-flow polish | manual | 2026-04-20 |
| I39 | ambiguous or no-plan entry guidance must route through discuss first while preserving compatibility notes for the legacy packet path | manual | 2026-04-20 |
| I40 | enforced final-stretch flow must stop requiring a separate ledger-only claim edit before planned workspace work can begin | manual | 2026-04-20 |
| I41 | runtime guidance must stay leaner and still preserve meaningful guards: one active row at a time, honest verification, and decision logging for deviations | manual | 2026-04-20 |
| I42 | retained proof must show targeted hook regressions, green full suite, and an archived PE package that honestly closes the runtime-tax blocker | manual | 2026-04-20 |
| I43 | report and archive surfaces must point directly at final truth, closure, lineage, and dossier without making a cold reviewer translate raw archive lists | manual | 2026-04-20 |
| I44 | public proof docs and examples must present final truth as one coherent bundle instead of scattered older anchors | manual | 2026-04-20 |
| I45 | close product-visible truth surfaces only when report output docs retained proof and archived package all make the final-truth bundle easier to inspect | manual | 2026-04-20 |
| I46 | archive summary must pick the newest completed clean run instead of the lexicographically first archive filename | manual | 2026-04-20 |
| I47 | close truth-surface work only when default report highlights the newest clean closure without requiring the operator to specify a file path | manual | 2026-04-20 |

## Restate rows

Model paraphrases of the intent rows above. Each `restate` row points
at the intents it summarizes. Prevents silent reinterpretation by
making the paraphrase a separately-typed row that still traces back.

| ID | Summary | Refs | Captured |
|----|---------|------|----------|
| R1 | Plan Enforcer is the structural chain-of-custody product for AI-assisted coding, hook-enforced not cooperative, self-enforced throughout. | I1, I2, I3 | 2026-04-13 |
| R2 | Commit + tier discipline (atomic per-task, no squashing, Decision: lines, advisory/structural/enforced tiers) is universal across the product and our own development. | I4, I5 | 2026-04-13 |
| R3 | The current strategic objective is the benchmark win + headline chain-of-custody feature; authorship work was prioritized to ship before the P5b rerun. | I6, I7 | 2026-04-13 |
| R4 | This session: tighten the awareness-ledger decision doc (capture mechanic + link authoring) then knock out remaining open items including self-enforcement plan. | I8, I9, I10, I11 | 2026-04-13 |

## Correction rows

Active corrections for superseded or narrowed session intents.

| ID | Type | Refs | Note | Captured |
|----|------|------|------|----------|
| C1 | supersede | I33 | replaced by task-specific package intents I34, I35, I36 | 2026-04-20 |

## Notes for the future P7 build

- This file IS the migration fixture. P7's parser must read this v0
  hand-authored shape and either (a) accept it as-is or (b) emit an
  upgrade migration to canonical schema with no data loss.
- Pre-capture rows are exactly the case the verbatim-verification
  lint must skip. Test fixture for that lint should include both a
  pre-capture row (skipped) and a session-captured row (verified).
- Restate rows R1-R4 point at intents but NO chain-token references
  exist yet because no plan/ledger is active in this session. Once
  P7 ships and a future phase seeds, links via Chain `A:I3` style
  tokens become possible.
- Orphan check (when P7 lands) would currently report I1-I7 as
  orphans because no active ledger references them. Correct
  behavior — the orphan signal was meant to surface this kind of
  drift between project-level intent and current-phase scope.


