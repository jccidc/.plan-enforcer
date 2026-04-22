# Changelog

All notable changes to Plan Enforcer are captured here.

## [0.1.4] -- 2026-04-22

### Fixed

- **Closed ledger no longer renders as in-progress.** `inferStatuslineState` now treats a ledger whose every active (non-superseded) row is terminal as a non-witness for the progress tag. When a closed ledger is the only backing artifact on disk, the function returns `null` and the statusline stops rendering `[ENFORCER: N/N verified]` on every new prompt. When a closed ledger AND a discuss packet coexist (new authorship session entered against a prior-session closure), the function falls through to the authorship-stage witness path and renders `[ENFORCER: 1-DISCUSS]` as expected (PI2 fallthrough). All-superseded and empty-active ledgers fall through identically. Render-layer only; no ledger is moved, renamed, or deleted by this change, and v0.1.2's close-transition auto-archive path is preserved. Added six new cases to `tests/statusline-stage-clears.test.js` covering closed-no-discuss, closed-with-discuss, all-terminal-with-blocked, all-superseded, mixed-with-pending, and closed-with-stored-3-EXECUTE permutations.

### Refactored

- **`TERMINAL_STATUSES` is now exported from one canonical location.** `src/ledger-parser.js` is the single source of truth; `hooks/plan-close.js`, `hooks/session-end.js`, `src/abandon-cli.js`, `src/receipt-cli.js`, and `src/statusline-state.js` all import the shared set. Eliminates drift risk of any one site diverging the definition of what "terminal" means for a ledger row.

### Docs

- **`docs/known-issues.md` demoted the closed-ledger entry.** This is the first "issue resolved, demoted from backlog" turn in the repo and establishes the convention: resolved entries leave the tracker and the resolution is captured here instead. A short angle 2 note (the `/plan-enforcer-discuss --retire-prior` opt-in flag) remains in `docs/known-issues.md` as a future candidate; it was evaluated and deliberately not built for this release -- v0.1.4's render-path fix covers the bug at every entry point without action-at-a-distance semantics on discuss.

### Verified

- Commit SHA and re-install stamp recorded at close of T8 below.

## [0.1.3] -- 2026-04-22

### Fixed

- **Schema-guard no longer false-positives on stderr-to-stdout redirects.** The `bashLooksLikeLedgerMutation` heuristic used to match any `>` character in a bash command whose text mentioned the ledger path, which meant a plain `git push ... 2>&1` (or any commit whose message string contained the ledger path plus a `2>&1` elsewhere in the command) got blocked as if it were a mutation. The heuristic now requires the redirect target to be a real path (the character after the `>` must not be `&`, so stream combinators like `2>&1` / `1>&2` are ignored). Real redirects to the ledger file are still blocked. Regression test added as three new cases in `tests/ledger-schema-guard.test.js`.

### Docs

- **Scrubbed `docs/proof/benchmark-side-by-side.md`.** The Source map section previously exposed absolute Windows paths under `C:/Users/ls13/...` for both the private lab repo and the product repo, plus a reference to `src/readme-playground.js` which was removed in the v0.1.0 launch-cut. Rewrote the section with safe descriptive references and a markdown link to the public carryover proof. Deleted the "Gap still open" section (internal dev note about automation that hadn't landed yet -- not relevant to a client reader of a proof surface).

## [0.1.2] -- 2026-04-22

### Fixed

- **Closed plans now graduate out of the active slot.** Previously the `plan-close.js` PostToolUse hook emitted a closure receipt on natural close but left `.plan-enforcer/ledger.md` in place, which meant the statusline kept showing the final `N/N verified` count across sessions and the active slot never cleared for the next plan. The hook now mirrors the abandon flow's close behavior: after emitting the receipt, it archives the transformed ledger to `.plan-enforcer/archive/<iso>-<slug>.md` and removes the active ledger via `cleanupWorkingFiles`. The statusline's witness-requirement (v0.1.1) then clears the tag automatically. Added `tests/plan-close-hook.test.js` "archives the ledger and removes active copy on close-transition" asserting the full lifecycle.

## [0.1.1] -- 2026-04-22

### Fixed

- **Statusline stage no longer goes stale.** `inferStatuslineState` now requires a ledger or discuss packet on disk before trusting `statusline-state.json` to name the current stage. Previously, if a plan closed (or was abandoned via the preflight-refuse path, or the discuss packet was manually cleaned up), the `[ENFORCER: 1-DISCUSS]` / `[2-DRAFT]` / `[3-EXECUTE]` tag could persist in the statusline across sessions because nothing cleared the state file. The hook is now defensive: no backing artifact = no stage rendered. Added `tests/statusline-stage-clears.test.js` covering the four permutations (stale state alone, discuss witness, ledger witness, discuss-then-deleted).

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
