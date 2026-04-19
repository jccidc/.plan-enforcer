# Roadmap Regression Proof Lane

This proof lane was built from a real operator complaint:

- roadmap text can get mangled
- a coherent-looking older version can creep back in
- the workflow can still look successful enough to continue

## What now exists

Two probes:

- planning-only roadmap regression (`Scenario H`)
- execution-time roadmap regression (`Scenario O`)

## Current result

### Scenario H

- `Plan Enforcer`: pass
- `GSD`: pass
- `Superpowers`: fail

### Scenario O

- `Plan Enforcer`: `16/16`, ask-fidelity pass
- `GSD`: `16/16`, ask-fidelity pass
- `Superpowers`: `16/16`, ask-fidelity pass

## Honest read

Roadmap regression is a real operator pain.

But right now it is **not** a current moat separator.

That means this proof lane should be kept available and maintained,
without overstating it as the next wedge.

