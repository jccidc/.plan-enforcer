# Benchmark Side-by-Side

Direct category comparison for `Plan Enforcer`, `GSD`, and `Superpowers`.

This page separates:

- comparable **judge rows** from retained benchmark `scorecard.json`
- **native-only internal process rows** from retained `objectives.json`

That keeps the comparison honest:

- judge penalties are apples-to-apples
- native catch / recovery metrics are product-internal signals, not competitor judge rows

## At a glance

- retained scorecards in lab: `26`
- total integrity penalty points:
  - `Plan Enforcer`: `0`
  - `GSD`: `3`
  - `Superpowers`: `10`
- full retained carryover ladder total:
  - `Plan Enforcer`: `276`
  - `GSD`: `205`
  - `Superpowers`: `209`

## Integrity matrix

All rows below come from retained lab `scorecard.json` artifacts.

Lower is better for penalty rows.

| Category | Plan Enforcer native | GSD | Superpowers | Read |
|---|---:|---:|---:|---|
| Retained scorecards | `10` | `8` | `8` | Coverage denominator for current retained lab slice |
| Clean retained scorecards | `10 / 10` | `6 / 8` | `4 / 8` | Cells with zero retained judge penalty hits |
| Total integrity penalty points | `0` | `3` | `10` | Sum of the four retained penalty buckets below |
| Silent plan mutation | `0` | `0` | `0` | Present in rubric, but not surfacing as a retained quantified separator in the current scorecard slice |
| False completion | `0` | `0` | `1` | Only retained judge hit is on `medium / execute-frozen-plan / superpowers` |
| Silent skip | `0` | `1` | `6` | Largest retained competitor leak |
| Missing evidence | `0` | `2` | `3` | Evidence discipline remains weaker on competitors in the retained slice |

## Headline benchmark categories

These are the current headline comparison categories already surfacing in launch-facing materials or chart inputs.

| Category | Plan Enforcer | GSD | Superpowers | Read |
|---|---:|---:|---:|---|
| Bounded work execution parity | `24 / 24` | `24 / 24` | `24 / 24` | Small phased benchmark; bounded work is not the main separator |
| Planning ambiguity score | `3` | `2` | `2` | Current README card framing: competitive, not blanket best |
| Large trust runtime | `92m 52s` | `116m 49s` | `125m 06s` | Lower is better; all three still finish `98 / 98` on the cited trust pack |
| Current README carryover aggregate | `172` | `122` | `125` | Current shipped aggregate used by the README chart |
| Full retained carryover ladder total | `276` | `205` | `209` | `H` through `N` summed from retained final report ladder |

## Carryover ladder by scenario

Outcome counts below come from the retained lab final report.

| Scenario | Plan Enforcer | GSD | Superpowers | Ask-fidelity read |
|---|---:|---:|---:|---|
| `H` | `16 / 16` | `13 / 16` | `12 / 16` | all pass |
| `I` | `24 / 24` | `15 / 24` | `15 / 24` | all pass |
| `J` | `28 / 28` | `15 / 28` | `16 / 28` | all pass |
| `K` | `32 / 32` | `23 / 32` | `23 / 32` | all pass |
| `K resume` | `32 / 32` | `24 / 32` | `25 / 32` | Superpowers partial, others pass |
| `L` | `40 / 40` | `32 / 40` | `34 / 40` | all pass |
| `M` | `48 / 48` | `40 / 48` | `37 / 48` | all pass |
| `N` | `56 / 56` | `43 / 56` | `47 / 56` | all pass |

## Native internal signals

These are real numbers, but not directly comparable judge rows.

They come from retained native `objectives.json` and describe what the product had to catch or repair internally.

| Internal native signal | Plan Enforcer native | GSD | Superpowers | Read |
|---|---:|---:|---:|---|
| Hard-gate silent completion catches | `7` | `n/a` | `n/a` | Product catch signal, not competitor judge score |
| Recovery passes | `11` | `n/a` | `n/a` | Operator-cost and convergence signal inside native execution |
| First-pass-clean cells | `4 / 10` | `n/a` | `n/a` | Includes plan-only cells, so execution-only cleanliness is lower than this headline suggests |
| Average ledger-op ratio | `47.8%` | `n/a` | `n/a` | Across the four retained execution or crash cells that logged it |

## Penalty cells

### GSD

- `small / execute-frozen-plan`
  - `silent_skip = 1`
  - `missing_evidence = 1`
  - subdir trap plus unresolved `T4` vs `T8` contradiction
- `large / crash-continuity`
  - `missing_evidence = 1`
  - strong artifact depth, but proof trail still judged thinner than native

### Superpowers

- `medium / execute-frozen-plan`
  - `false_completion = 1`
  - `silent_skip = 1`
  - `missing_evidence = 1`
  - `T14` declared effectively done without the refactor pass really landing
- `medium / crash-continuity`
  - `silent_skip = 3`
  - `missing_evidence = 1`
  - explicit skip of tests and docs against the frozen plan
- `small / execute-frozen-plan`
  - `silent_skip = 1`
  - `missing_evidence = 1`
  - same subdir trap pattern as `GSD`, plus weaker retained proof trail
- `large / crash-continuity`
  - `silent_skip = 1`
  - broader resume claim without per-task enumeration made silent-skip audit weaker

## What this says right now

- `Plan Enforcer` is clean in the retained **judge penalty** rows.
- `GSD` is relatively clean, but shows weaker proof discipline and one frozen-plan skip case.
- `Superpowers` carries most of the retained `silent_skip` pain and the only retained `false_completion` hit.
- The strongest repeated moat is still the **carryover ladder**, not bounded work parity.
- The biggest honest self-critique for `Plan Enforcer` is not judge penalties; it is native internal cost:
  - `7` hard-gate catches
  - `11` recovery passes
  - `47.8%` average ledger-op ratio on logged execution/crash cells

## Source map

- **Lab results tree** (private framework-comparison lab, not distributed): retained `scorecard.json` artifacts per scenario and `objectives.json` for internal native signals.
- **Lab final report** (private): the 2026-04-17 framework-comparison run report, which is the source of the numbers on this page.
- **Public product proof**: [carryover-proof.md](carryover-proof.md) for the per-scenario ask-fidelity breakdown.
