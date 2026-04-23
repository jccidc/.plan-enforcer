# Changelog

All notable changes to Plan Enforcer are captured here.

## [0.1.6] -- 2026-04-23

### Fixed

- **Chained base statusline no longer double-renders the Enforcer segment.** The Plan Enforcer statusline wrapper auto-discovers and chains to an existing base statusline (typically `~/.claude/hooks/statusline.js`) so that non-Enforcer segments like model, git, and caveman keep rendering. Both sides of that handshake already supported a `PLAN_ENFORCER_STATUSLINE_CHAINED=1` env flag meant to tell the base script "Plan Enforcer owns the Enforcer segment, stand down on your own Enforcer fallback logic" -- but the wrapper never actually set the flag on its base call. That left the base script free to run its own heuristic-based Enforcer rendering in parallel. Those heuristics had independent leakage problems (for example, a find-DOWN walk that picked a child project's `ledger.md` when the cwd was a parent dir, which produced the exact `[ENFORCER: 0/35]` ghost label reported against `~/projects/` after v0.1.5 was already in place). The wrapper now passes `{ chainEnforcer: true }` on its single base-command invocation, the base script's existing suppression path fires, and Plan Enforcer becomes the sole authority for the Enforcer segment in the chained render path. Extended `tests/statusline-hook.test.js` with a regression case that stands up a GSD-like base script emitting `[ENFORCER: 0/35]` when unchained and only `[BASE]` when chained; wrapper output must contain the base marker and no Enforcer segment.

### Note

- Pre-existing Windows-specific spawn-based test failures in `tests/statusline-hook.test.js` (path-escape quirks in `spawnSync` fixtures, not a Plan Enforcer logic issue) continue to fail on this author's machine and are covered under the standing D2 override pattern used across v0.1.1+. The CI matrix on Linux is authoritative for those tests.

## [0.1.5] -- 2026-04-23

### Fixed

- **Statusline no longer leaks state across projects.** When you `cd` from a project with an open plan up to a parent dir (e.g. `~/projects/`), the statusline used to keep rendering the prior project's progress tag (`[ENFORCER: 0/17]` while sitting in an unrelated folder). Two root causes were fixed together:
  - The project-root resolver treated any directory named `.plan-enforcer` as a state dir, even if it held only repo artifacts (`src/`, `package.json`) and no actual plan-enforcer files. A new `isPlanEnforcerStateDir` helper now requires at least one of `config.md`, `ledger.md`, `discuss.md`, `combobulate.md`, `archive/`, or `statusline-state.json` before treating the directory as state. A repo folder that happens to be named `.plan-enforcer` (e.g. the staging repo of this project) is no longer mistaken for a state dir of its parent.
  - The session bridge preserved the prior project's root whenever the new cwd had no local `.plan-enforcer`. That leaked the last-active project into unrelated dirs. The bridge now only preserves when the new cwd is a descendant of the prior project (e.g. `cd src/` inside it). Siblings, parents, and unrelated dirs drop the bridge. `resolveBridgedStatuslinePaths` gained a matching `isInside(cwd, bridgedRoot)` guard so a stray bridge file can't re-enable the tag from a directory the user has already left.
- Added five new cases to `tests/statusline-stage-clears.test.js` covering the ancestor-cwd regression, the state-dir guard, the descendant-cwd preservation, the pure `isInside` helper, and the bare-repo-dir edge case. Full affected suite (97 tests) still green.

## [0.1.4] -- 2026-04-22

### Fixed

- **Closed ledger no longer renders as in-progress.** `inferStatuslineState` now treats a ledger whose every active (non-superseded) row is terminal as a non-witness for the progress tag. When a closed ledger is the only backing artifact on disk, the function returns `null` and the statusline stops rendering `[ENFORCER: N/N verified]` on every new prompt. When a closed ledger AND a discuss packet coexist (new authorship session entered against a prior-session closure), the function falls through to the authorship-stage witness path and renders `[ENFORCER: 1-DISCUSS]` as expected (PI2 fallthrough). All-superseded and empty-active ledgers fall through identically. Render-layer only; no ledger is moved, renamed, or deleted by this change, and v0.1.2's close-transition auto-archive path is preserved. Added six new cases to `tests/statusline-stage-clears.test.js` covering closed-no-discuss, closed-with-discuss, all-terminal-with-blocked, all-superseded, mixed-with-pending, and closed-with-stored-3-EXECUTE permutations.

### Refactored

- **`TERMINAL_STATUSES` is now exported from one canonical location.** `src/ledger-parser.js` is the single source of truth; `hooks/plan-close.js`, `hooks/session-end.js`, `src/abandon-cli.js`, `src/receipt-cli.js`, and `src/statusline-state.js` all import the shared set. Eliminates drift risk of any one site diverging the definition of what "terminal" means for a ledger row.

### Docs

- **`docs/known-issues.md` demoted the closed-ledger entry.** This is the first "issue resolved, demoted from backlog" turn in the repo and establishes the convention: resolved entries leave the tracker and the resolution is captured here instead. A short angle 2 note (the `/plan-enforcer-discuss --retire-prior` opt-in flag) remains in `docs/known-issues.md` as a future candidate; it was evaluated and deliberately not built for this release -- v0.1.4's render-path fix covers the bug at every entry point without action-at-a-distance semantics on discuss.

### Verified

- Commit `00303c7` -- installed skill at `~/.claude/skills/plan-enforcer` re-synced via `install.sh`; `.installed-from` stamp matches HEAD. Live fixture against the installed module returned `null` for the closed-no-discuss permutation and `1-DISCUSS` for the closed-with-discuss fallthrough.

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
