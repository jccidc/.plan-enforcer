# Plan Enforcer Ledger (ARCHIVED)
<!-- schema: v2 -->
<!-- source: docs/plans/2026-04-21-readme-visuals-rebuild.md -->
<!-- prior-source: docs/plans/2026-04-20-readme-layout-variant-playground.md -->
<!-- tier: structural -->
<!-- created: 2026-04-21T03:43:27Z -->
<!-- pivoted: 2026-04-21T (current session) -->
<!-- archived: 2026-04-22T04-00-00Z -->
<!-- archive-reason: pivot to docs/plans/2026-04-22-closure-receipt-feature.md (see D6) -->

## Scoreboard
 31 total  |  0 done  |  7 verified  |  23 superseded  |  1 blocked  |  0 remaining
 Drift: 1  |  Last reconcile: R2 after T29  |  Tier: structural  |  Current: T30 (blocked, awaits user)

## Task Ledger

| ID  | Task                                     | Status     | Evidence | Chain | Notes |
|-----|------------------------------------------|------------|----------|-------|-------|
| T1  | Enumerate content blocks and verbatim-ca | superseded | new plan | D1    | prior plan archived |
| T2  | Flag duplication candidates and record r | superseded | new plan | D1    | prior plan archived |
| T3  | Declare the layout-variant set and recor | superseded | new plan | D1    | prior plan archived |
| T4  | Inventory and classify SVG assets agains | superseded | new plan | D1    | prior plan archived |
| T5  | Scaffold the playground file and the var | superseded | new plan | D1    | prior plan archived |
| T6  | Inline content blocks and variant orderi | superseded | new plan | D1    | prior plan archived |
| T7  | Wire rendering and copy-out affordance   | superseded | new plan | D1    | prior plan archived |
| T8  | Run external-dependency check on the pla | superseded | new plan | D1    | prior plan archived |
| T9  | Capture per-variant playground screensho | superseded | new plan | D1    | prior plan archived |
| T10 | Export per-variant markdown and byte-for | superseded | new plan | D1    | prior plan archived |
| T11 | Pick the winning variant and record the  | superseded | new plan | D1    | prior plan archived |
| T12 | Overwrite README.md with the chosen vari | superseded | new plan | D1    | prior plan archived |
| T13 | Verify install block position on the new | superseded | new plan | D1    | prior plan archived |
| T14 | Verify entry-paths list and narrow-claim | superseded | new plan | D1    | prior plan archived |
| T15 | Verify discuss-chain framing above impor | superseded | new plan | D1    | prior plan archived |
| T16 | ASCII-only check on the new README and t | superseded | new plan | D1    | prior plan archived |
| T17 | Extract link sets before and after the r | superseded | new plan | D1    | prior plan archived |
| T18 | Diff link sets and produce the link-audi | superseded | new plan | D1    | prior plan archived |
| T19 | Resolve local paths and run the link-reg | superseded | new plan | D1    | prior plan archived |
| T20 | Run the forbidden brand-language grep on | superseded | new plan | D1    | prior plan archived |
| T21 | Capture first-viewport proof of the new  | superseded | new plan | D1    | prior plan archived |
| T22 | Stage the commit set for the relaunch pa | superseded | new plan | D1    | prior plan archived |
| T23 | Commit the relaunch package with proof-l | superseded | new plan | D1    | prior plan archived |
| T24 | Design system spec -> docs/assets/_design-system.md | verified   | docs/assets/_design-system.md (9 tokens, 2 chromes) | A:I48, A:I49 |       |
| T25 | Lock README outline doc                  | verified   | docs/plans/2026-04-21-readme-outline.md (6 figs locked) | A:I48, A:I49, D2 |       |
| T26 | Hero figure: git-log diptych reborn      | verified   | docs/assets/hero-git-log.svg ASCII clean, 6 stages | A:I48, A:I49, D2 |       |
| T27 | Build 5 standard figures (install, custody-chain, three-layers, byo-plan, best-fit) | verified   | docs/assets/install.svg + 4 more, ASCII OK | A:I48, A:I49, D2 |       |
| T28 | Rewrite README prose end-to-end          | verified   | README.md (117 lines, ASCII OK, motif clean) | A:I48, A:I49, D2, D3 |       |
| T29 | Delete 19 superseded SVGs + fix references | verified   | docs/proof/public-proof.md fixed; docs/assets/hero-git-log.svg + 5 (17 old removed) | A:I48, A:I49, D2, D4, D5 | 17 deleted (not 19; 2 names repurposed for new figs); playground refs surfaced |
| T30 | Verify rendered README on github.com (mobile + desktop) | blocked    | needs user action: push branch + capture screenshots | A:I48, A:I49, D2 | hand-off doc to follow in closure receipt |
| T31 | Final lint + closure receipt             | verified   | .plan-enforcer/proof/closure-readme-rebuild.md (lints clean) | A:I48, A:I49, D2 |       |

## Decision Log

| ID | Type      | Scope          | Reason | Evidence |
|----|-----------|----------------|--------|----------|
| D1 | pivot     | T1-T23         | User pivoted from playground-variant work to README + visuals rebuild after critiquing current README/SVG state. Prior plan superseded. | docs/plans/2026-04-21-readme-visuals-rebuild.md; .plan-enforcer/discuss.md |
| D2 | override  | T24-T31 evidence-gate npm-test signal | Pre-existing failures in tests/statusline-hook.test.js from in-flight uncommitted statusline/playground workstream (separate work). Explicitly out-of-scope per plan "Out of scope" section. README rebuild plan does not modify statusline or playground code; gate-flagged failures predate this plan. User authorized override 2026-04-22. | tests/statusline-hook.test.js; .plan-enforcer/checks/T25-2026-04-22T03-20-02.160Z.log; user ack in-session 2026-04-22 |
| D3 | deviation | T28 README line count below 130 verification floor (actual: 117 lines) | Plan task verification line floor was sized assuming current ~150 lines plus added paragraphs. Reducing figure count from 9 to 6 (per MH2) cut natural length; padding prose to hit a line target would dilute readability and contradict NN3 (legibility) and the discuss-packet drift risk DR3 (caveman bleed-over avoidance via flowing prose without bloat). All MH1-MH7 are met independently of the line count. | README.md (117 lines); MH1-MH7 self-checked; alt-text em-dash compliance fixed |
| D4 | delete    | docs/assets/{authorship-chain,authorship-layer,benchmark-summary,carryover-ladder,chain-of-custody,claim,execution-layer,git-log-diptych,install-manifest,problem-solution,proof-lanes,provable-surfaces,stack,truth-layer,what-it-catches,without-with,workflow}.svg (17 files) | Per plan T29: superseded SVGs from prior 9-figure design system replaced by 6-figure terminal-native set. best-fit.svg and three-layers.svg names retained but rewritten with new design-compliant content (not deletions). | docs/assets/ Glob now returns exactly 6 SVGs (best-fit, byo-plan, custody-chain, hero-git-log, install, three-layers) |
| D5 | delete    | docs/proof/public-proof.md | Removed the 3-line "Supporting visual" block (heading + bullet linking docs/assets/proof-lanes.svg + blank line). proof-lanes.svg was deleted under D4 and has no equivalent in the new 6-figure set; the hero figure linked from README is the canonical visual entry point. | docs/proof/public-proof.md edit (lines 14-16 removed); link no longer 404s after D4 deletion |
| D6 | delete    | T1, T2, T3, T4, T5, T6, T7, T8, T9, T10, T11, T12, T13, T14, T15, T16, T17, T18, T19, T20, T21, T22, T23, T24, T25, T26, T27, T28, T29, T30, T31 | Pivot to new plan docs/plans/2026-04-22-closure-receipt-feature.md. Current ledger's T1-T31 rows are archived to this file before the active ledger is rewritten to track the new plan. Every prior T-row's terminal status (verified/blocked/superseded) is preserved here for audit. T30 remains at blocked awaiting user-driven github.com visual verification; it can be flipped directly in this archive or referenced by a later plan. No T-rows are discarded -- only relocated to archive. | .plan-enforcer/archive/2026-04-22T04-00-00Z-readme-visuals-rebuild.md (this file); docs/plans/2026-04-22-closure-receipt-feature.md (new plan source) |

## Reconciliation History

| Round | Tasks Checked | Gaps Found | Action Taken |
|-------|---------------|------------|--------------|
| R1    | T24, T25, T26 (active set first 3) | 0 -- all three verified with file-path evidence and awareness refs; 23 prior rows superseded under D1; gate noise covered by D2 | none |
| R2    | T27, T28, T29 (active set next 3)  | 1 logged (D3 README line-count below soft floor; MH-coverage intact); 2 deletion sets logged (D4, D5); playground dangling refs surfaced as user coordination item per plan T29 instruction | logged D3-D5; surfaced playground refs |
