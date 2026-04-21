# Closure Surface

Closure is where Plan Enforcer stops being workflow advice and becomes
final repo truth.

Current close-out band:

- `plan-enforcer status`
- `plan-enforcer verify --with-awareness`
- `plan-enforcer audit --strict`
- `plan-enforcer report`

If that band is clean, the run can archive as final truth.

`plan-enforcer report` now surfaces the same close-out bundle directly:

- latest clean archive or active ledger
- retained final-truth manifest path
- phase-verify report path when present
- checks root for executed-command truth
- source plan, discuss packet, and awareness roots for lineage context
- dossier bundle / closure snapshot for colder review

## What each surface answers

- `status`: what is still open right now
- `verify --with-awareness`: did must-haves and intent links pass
- `audit --strict`: is the ledger structurally honest
- `report`: what should a handoff or cold reviewer read first
- archive file: what final state was actually closed

## Why this matters

Public launch docs should make the close-out band easy to understand
without depending on lab-only retained artifact paths.

In a live installed repo, `report` and the archive surfaces point at the
retained manifest, archive markdown, and verification sidecars directly.

## Read next

- CLI details: [`../cli.md`](../cli.md)
- final truth: [final-truth.md](final-truth.md)
- lineage surface: [lineage.md](lineage.md)
- dossier surface: [dossier.md](dossier.md)
