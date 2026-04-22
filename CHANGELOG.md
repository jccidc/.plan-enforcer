# Changelog

All notable changes to Plan Enforcer are captured here. The full commit
history on `main` is preserved intentionally -- this repo dogfoods its
own chain-of-custody discipline, so the log is itself a proof artifact.
This file is the curated launch-facing summary of that history.

Dates are UTC. The full diff for any entry is one click away via the
linked commit SHA on github.com.

## [0.1.0] -- 2026-04-22

First public-facing launch of Plan Enforcer as a chain-of-custody
layer for AI-assisted coding on Claude Code. The system ships as
hooks + skills + CLIs that write a small set of named files into each
project, with three enforcement tiers (advisory / structural /
enforced).

### Added

- **Closure receipts as a runtime feature** ([7ad694a]). Every closed
  plan automatically emits `closure-<plan-slug>-<utc-iso>.md` into
  `.plan-enforcer/proof/`. Each receipt links to its prior closure
  for the same plan, so closures form a walkable audit chain instead
  of a flat directory. Auto-emission fires from a new PostToolUse
  `plan-close.js` hook. Explicit emission is available via
  `plan-enforcer-receipt` CLI / `/plan-enforcer-receipt` skill for
  mid-flight snapshots.
- **Seventh custody stage: RECEIPT** ([0857af9]). The custody chain
  grew from six stages (ASK / PLAN / EXEC / DECIDE / VERIFY / LAND)
  to seven, with RECEIPT appearing after LAND as the auto-emitted
  audit artifact. Figures in the README reflect the new stage.
- **Abandon-plan as a first-class command** ([b3a8fd3]). New
  `plan-enforcer-abandon --reason "<why>"` collapses the previous
  multi-step manual pivot (hand-write a Decision Log row, rewrite
  the ledger, archive it, fight the schema guard) into a single
  invocation. The required `--reason` is sole authorization --
  no confirm prompt, no `--force` flag. Flips remaining tasks to
  superseded, logs the pivot, emits a receipt into the walkable
  chain, archives the full ledger to `.plan-enforcer/archive/`,
  and clears the active slot.
- **Benchmark section on the README** ([17b2065]). New section 06
  surfaces real lab numbers from
  `docs/proof/benchmark-side-by-side.md`: zero integrity-penalty
  points across 26 retained scorecards for Plan Enforcer (GSD 3,
  Superpowers 10) and +35% / +32% on the carryover ladder.

### Changed

- **README and visual system rebuilt** ([e790e1d]). Replaced a
  nine-figure mixed-design-system README with a six-figure terminal-
  native dark system: hero git-log diptych, install terminal
  session, custody-chain ledger rows, three-layers lanes, BYO-plan
  normalizer, and best-fit scored bars. Sized native to GitHub
  render width (~720px effective). Case-file motif stripped to one
  tasteful trace on the hero header band. Full design-system spec
  preserved in the commit diff.
- **README intro block** ([43ce0c3]). Tagline + four-paragraph
  explainer + a pre-hero `intro-drift-vs-fidelity` figure contrast
  drift-compounds vs fidelity-preserved. SVG elements rewritten to
  pass GitHub's inline SVG sanitizer ([08d526b]).
- **Lifecycle section** ([e3b949f], [6a1734c]). Converted the
  workflow-loop figure to the dark design system, integrated
  RECEIPT into the Step 05 card so all seven stages are represented
  in the one-day workflow story.
- **Commands section** ([2cfe3f8]). Section 08 organizes CLIs by
  workflow stage (authorship, execution, mid-flight, close,
  utilities) with each row naming the CLI, what it does, and the
  matching slash command.

### Removed

- **Launch-cut audit** ([5eb3a7c]). Dropped internal artifacts not
  needed for a client-facing launch: four completed implementation
  plans, mockup HTML, playground HTML, internal strategy docs,
  internal redirect README, four uncited proof surface notes,
  internal design-system spec. Kept every externally-cited proof
  artifact; patched `docs/examples/README.md`, `docs/proof/README.md`,
  and `docs/proof/public-proof.md` so no dangling links remain.
- **Readme-playground dead-code chain** ([4e17ad5]). After the HTML
  front end was removed in the launch cut, the supporting server
  (`scripts/readme-playground-server.js`), helper module
  (`src/readme-playground.js`), test file, and
  `package.json "playground:readme"` npm script all became
  orphaned. All four removed together.

### Developer ergonomics

- `docs/cli.md` gained `plan-enforcer-receipt` and
  `plan-enforcer-abandon` sections with usage, exit codes, and
  cross-references. Full CLI reference lives there.
- `install.sh` + `uninstall.sh` now wire the new skills, hooks, and
  bin wrappers for receipts and abandon.
- 46 new tests across `tests/receipt-cli.test.js`,
  `tests/plan-close-hook.test.js`, `tests/receipt-chain.test.js`,
  `tests/abandon-cli.test.js`, `tests/abandon-integration.test.js`,
  `tests/abandon-chain.test.js`. All pass under `node --test`.

---

### Dogfood note

Plan Enforcer ran on itself for every feature in this release. The
commit log on `main` contains the full execution trail -- ledger
state transitions, typed Decision Log entries, reconciliation rounds,
and closure receipts -- because the whole repo is lived-in proof that
the chain of custody survives real work. If you are evaluating the
product, `git log` and `.plan-enforcer/archive/` are both worth a
read.

[0.1.0]: https://github.com/jccidc/.plan-enforcer/releases/tag/v0.1.0
[7ad694a]: https://github.com/jccidc/.plan-enforcer/commit/7ad694a
[0857af9]: https://github.com/jccidc/.plan-enforcer/commit/0857af9
[b3a8fd3]: https://github.com/jccidc/.plan-enforcer/commit/b3a8fd3
[17b2065]: https://github.com/jccidc/.plan-enforcer/commit/17b2065
[e790e1d]: https://github.com/jccidc/.plan-enforcer/commit/e790e1d
[43ce0c3]: https://github.com/jccidc/.plan-enforcer/commit/43ce0c3
[08d526b]: https://github.com/jccidc/.plan-enforcer/commit/08d526b
[e3b949f]: https://github.com/jccidc/.plan-enforcer/commit/e3b949f
[6a1734c]: https://github.com/jccidc/.plan-enforcer/commit/6a1734c
[2cfe3f8]: https://github.com/jccidc/.plan-enforcer/commit/2cfe3f8
[5eb3a7c]: https://github.com/jccidc/.plan-enforcer/commit/5eb3a7c
[4e17ad5]: https://github.com/jccidc/.plan-enforcer/commit/4e17ad5
