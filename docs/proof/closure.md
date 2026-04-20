# Closure Surface

Closure is where Plan Enforcer stops being workflow advice and becomes
final repo truth.

Current closeout band:

- `plan-enforcer status`
- `plan-enforcer verify --with-awareness`
- `plan-enforcer audit --strict`
- `plan-enforcer report`

If that band is clean, the run is ready to archive as final truth.

## What each surface answers

- `status`: what is still open right now
- `verify --with-awareness`: did must-haves and intent links pass
- `audit --strict`: is the ledger structurally honest
- `report`: what should a handoff or cold reviewer read first
- archive file: what final state actually closed

## Why this matters

The product claim gets stronger when closeout reads like evidence work,
not confidence theater.

## Read next

- [Final truth](final-truth.md)
- [Lineage surface](lineage.md)
- [Dossier surface](dossier.md)
- [Verify, audit, report example](../examples/verify-audit-report.md)
- [CLI guide](../cli.md)
