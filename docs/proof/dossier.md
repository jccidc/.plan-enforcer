# Dossier Surface

`Dossier` here means cold-review bundle: the smallest set of pages and
artifacts a new reviewer needs to reconstruct what happened.

Current honest read:

- the bundle exists today
- archived `*.final-truth.json` is now the machine-readable anchor for
  that bundle
- the bundle is still assembled from repo artifacts, not one giant
  prose file in every run
- public docs should point at that bundle directly

## Minimal cold-review bundle

Read in this order:

1. [`public-proof.md`](public-proof.md)
2. archived `*.final-truth.json`
3. one archive file from `../../.plan-enforcer/archive/`
4. matching phase-verify report sidecar when present
5. [`final-truth.md`](final-truth.md)
6. [`benchmark-summary.md`](benchmark-summary.md)
7. [`carryover-proof.md`](carryover-proof.md)
8. [`closure.md`](closure.md)

## Why this matters

Launch todo explicitly called out:

- dossier / closure / final-truth artifacts should be obvious in docs
  and examples
- public story should point at them without extra translation

This page is that translation layer around the retained manifest and
archive bundle, not a claim that each run emits one giant prose dossier.

## Read next

- public proof map: [public-proof.md](public-proof.md)
- final truth: [final-truth.md](final-truth.md)
- examples: [`../examples/README.md`](../examples/README.md)
- lineage surface: [lineage.md](lineage.md)
