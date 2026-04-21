# Final Truth

Final truth is the smallest cold-review bundle that answers:

- what actually closed
- what phase verify said
- what command evidence exists
- which plan and lineage roots produced that state

## What makes up final truth

For a clean Plan Enforcer run, inspect these in order:

1. `plan-enforcer report`
2. archived `*.final-truth.json` manifest beside the archive
3. archive file in `.plan-enforcer/archive/`
4. phase-verify report sidecar when present
5. executed-check sidecars in `.plan-enforcer/checks/`

The runtime now surfaces that bundle directly instead of leaving a cold
reviewer to translate raw archive lists by hand.

That manifest now retains:

- closure snapshot: task rows, decision log, reconciliation summary
- dossier bundle refs: archive, manifest, phase verify, checks root
- lineage roots: source plan, discuss packet, awareness

## Why this matters

Launch-facing proof should not require a reviewer to infer final truth
from internal-only retained artifact paths.

The honest product claim is narrower and stronger:

> Plan Enforcer leaves a cold-reviewable final-truth bundle on disk and
> now surfaces the main entry points directly in runtime report output.

## Read next

- closure surface: [closure.md](closure.md)
- lineage surface: [lineage.md](lineage.md)
- dossier surface: [dossier.md](dossier.md)
