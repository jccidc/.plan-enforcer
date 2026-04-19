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

| ID | Quote (verbatim) | Source | Captured |
|----|-------------------|--------|----------|
| I8 | "okay let's stay on this What do we need to do to tighten things up" | pre-capture (verbatim session-2026-04-13) | 2026-04-13 |
| I9 | "yeah let's go with capture mechanic and then link offering" | pre-capture (verbatim session-2026-04-13) | 2026-04-13 |
| I10 | "lets go with your reccomendation, is self-enforcement plan in place so we can learn as we go?" | pre-capture (verbatim session-2026-04-13) | 2026-04-13 |
| I11 | "retro-capture intents from this repo's session, and run through all open items as you desire, lets knock all this shit out" | pre-capture (verbatim session-2026-04-13) | 2026-04-13 |
| I12 | ship a dogfood playbook for Plan Enforcer work packages with seed capture execute verify audit archive and push cadence | manual | 2026-04-19 |
| I13 | update the README launch surface to link the dogfood playbook and the hard-launch checklist | manual | 2026-04-19 |
| I14 | leave a human-readable dogfood proof note with status verify audit report and archive artifact paths from this repo-local run | manual | 2026-04-19 |

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

None yet. Reserved table for future `supersede` (intent withdrawn) or
`narrow` (scope reduced) refinements.

| ID | Type | Refs | Note | Captured |
|----|------|------|------|----------|

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
