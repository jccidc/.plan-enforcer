# Example - Verify, audit, report

These three commands are the proof surface.

## Goal-backward verify

```bash
plan-enforcer verify --with-awareness
```

Checks:

- every must-have is covered
- awareness intent links are present
- live intents still have a target

## Structural audit

```bash
plan-enforcer audit --strict
```

Checks:

- evidence quality
- chain references
- awareness quote provenance
- executed verification sidecars

## Active or archived report

```bash
plan-enforcer report --active
plan-enforcer report
```

Use `--active` during a live run. Use the default archive report after
closure.
