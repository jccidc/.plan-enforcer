# Changelog

All notable changes to Plan Enforcer are captured here.

## [0.1.0] -- 2026-04-22

First public release.

### Shipped

- **Chain-of-custody layer for AI-assisted coding on Claude Code.** Installs as hooks + skills + CLIs that write a small set of named files into each project. Three enforcement tiers (advisory / structural / enforced).
- **Seven-stage custody chain:** ASK, PLAN, EXEC, DECIDE, VERIFY, LAND, RECEIPT. Every stage produces a named file on disk.
- **Closure receipts as a runtime feature.** Every closed plan automatically emits `.plan-enforcer/proof/closure-<plan-slug>-<utc-iso>.md`. Each receipt links to its prior closure for the same plan, so closures form a walkable audit chain instead of a flat directory. Auto-emission fires from the `plan-close.js` PostToolUse hook. On-demand emission via `plan-enforcer-receipt` CLI or `/plan-enforcer-receipt` skill.
- **`plan-enforcer-abandon --reason "<why>"`** retires an in-flight plan in one command: marks remaining rows superseded, logs the pivot to the Decision Log, emits a closure receipt into the walkable chain, archives the full ledger to `.plan-enforcer/archive/`, and clears the active slot. The required `--reason` is sole authorization.
- **Authorship chain:** `plan-enforcer-discuss` captures intent into `.plan-enforcer/discuss.md` before drafting; `plan-enforcer-draft` writes a concrete plan under `docs/plans/`; `plan-enforcer-review` validates plan quality before execution.
- **Bring-your-own-plan normalizer.** `plan-enforcer-import` seeds the ledger from a GSD phase, a Superpowers plan, or a freeform markdown checklist. One normalized row shape regardless of source.
- **Archive + browse surface.** Closed or abandoned ledgers land in `.plan-enforcer/archive/<utc-iso>-<slug>.md` with frontmatter describing the close. `plan-enforcer-report` with no arguments lists archive entries; pass an archive path to render a specific one.
- **Terminal-native README** with seven figures across a single dark design system: drift-vs-fidelity intro, git-log diptych, install terminal session, custody-chain ledger rows, three-layers lanes, BYO-plan normalizer, best-fit scored bars, benchmark moats, lifecycle.
- **Benchmark evidence.** Across 26 retained scorecards in the framework-comparison lab, Plan Enforcer carries zero integrity-penalty points (GSD 3, Superpowers 10) and +35% / +32% ahead on the carryover ladder. Full side-by-side: [docs/proof/benchmark-side-by-side.md](docs/proof/benchmark-side-by-side.md).
