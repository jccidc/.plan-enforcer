# Lineage Surface

Lineage is the answer to `why is this code here` after the original chat
is gone.

Current honest read:

- typed decisions, task rows, awareness links, verification artifacts,
  and archives already make lineage reconstructible from repo artifacts
- the substrate is real
- `plan-enforcer report` now surfaces the source plan and awareness
  roots directly so the lineage trail is easier to start from
- archived `*.final-truth.json` now retains a compact lineage/closure
  snapshot instead of pointing only at live mutable roots

## What makes up lineage

Plan Enforcer's lineage chain is:

1. user intent and awareness rows
2. plan source
3. task row in `.plan-enforcer/ledger.md`
4. typed Decision Log entries when scope changes
5. verification evidence and executed-check sidecars
6. archived `*.final-truth.json` snapshot after close
7. archive markdown beside that manifest

Useful operator queries:

- `plan-enforcer chain T5`
- `plan-enforcer why src/file.js`
- `plan-enforcer audit`
- `plan-enforcer report`

Reference doc:

- CLI surface: [`../cli.md`](../cli.md)

## What this page is not claiming

This is not a promise that every repo already has a single polished
`lineage.md` markdown output file.

The truthful claim is narrower:

> the lineage substrate is already on disk and queryable, and archived
> final-truth manifests now retain one compact machine-readable lineage
> anchor instead of leaving cold review to live roots alone

## Read next

- closure surface: [closure.md](closure.md)
- final truth: [final-truth.md](final-truth.md)
- public proof map: [public-proof.md](public-proof.md)
- dossier surface: [dossier.md](dossier.md)
