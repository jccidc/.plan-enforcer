# Final Truth

Final truth is the smallest cold-review bundle that answers:

- what actually closed
- what verification said
- what command evidence exists
- which lineage roots produced that state

## What makes up final truth

For a clean Plan Enforcer run, inspect these in order:

1. `plan-enforcer report`
2. the archived closeout file in `.plan-enforcer/archive/`
3. phase-verify sidecars when present
4. executed-check sidecars in `.plan-enforcer/checks/`
5. the source plan and awareness roots for lineage context

The runtime report surface now points at that bundle directly instead of
only listing archive files.

## Why this matters

Launch-facing proof should not force a reviewer to reconstruct final
truth from scattered notes.

The narrower and stronger claim is this:

> Plan Enforcer leaves a cold-reviewable final-truth bundle on disk and
> now surfaces the main entry points directly in report output.

## Read next

- [Closure surface](closure.md)
- [Lineage surface](lineage.md)
- [Dossier surface](dossier.md)
- [Verify, audit, report example](../examples/verify-audit-report.md)
- [CLI guide](../cli.md)
