# Plan Enforcer

Preserve the real contract from ask to code to final audit truth.

`Plan Enforcer` is an enforcement and truth layer for long-running
agent work. It helps teams keep a real plan in view, execute in bounded
phases, survive interruption, and leave behind proof that a cold
reviewer can inspect later.

![Plan Enforcer workflow](docs/assets/workflow.svg)

## What it is

`Plan Enforcer` is strongest when the requirement is not only:

- make a plan
- write code
- say it is done

It is strongest when the real requirement is:

- preserve the original ask
- preserve repaired contract through execution
- survive mutation, interruption, and handoff
- leave durable proof, lineage, and final truth afterward

## Workflow

The working loop is a chained path, not one prompt pretending to be a
system:

1. discuss intent
2. draft the executable plan
3. review the plan against the ask
4. execute in bounded phases
5. verify each phase
6. close with archiveable final truth

See:

- [docs/try-it.md](docs/try-it.md)
- [docs/cli.md](docs/cli.md)
- [docs/config.md](docs/config.md)

## Authorship chain

The planning moat is not "write a nicer plan." It is making later
stages work harder to quietly replace the original ask with something
easier.

![Plan Enforcer authorship chain](docs/assets/authorship-chain.svg)

## Product stack

The system has 3 aligned layers:

- authorship
- execution
- truth

That alignment is where the value comes from.

![Plan Enforcer stack](docs/assets/stack.svg)

## Entry modes

You can start with:

- the full authored path:
  - `discuss -> draft -> review -> execute -> verify`
- or **bring your own plan**:
  - hand-written markdown
  - imported checklist
  - plan drafted by another workflow

Both routes converge on the same execution and truth path:

- bounded execution
- durable artifacts
- verifier output
- chain of custody
- final truth closure

## Chain of custody

This is one of the clearest differentiators. The visible feature can
still ship in many systems. What usually does not survive as well is:

- repaired-plan carryover
- explicit mutation lineage
- dossier depth
- cold-review reconstruction
- final truth closure

![Plan Enforcer chain of custody](docs/assets/chain-of-custody.svg)

## What is proven right now

![Plan Enforcer benchmark summary](docs/assets/benchmark-summary.svg)

- Native execution is credible.
- The authorship chain is a real product surface.
- Carryover is the clearest repeated moat.
- Composability is real: additive enforcement on top of other planning
  flows works.
- Dogfooding is real: the product is usable on its own repo work.

Proof pack:

- [Benchmark summary](docs/proof/benchmark-summary.md)
- [Carryover proof](docs/proof/carryover-proof.md)
- [Composability proof](docs/proof/composability-proof.md)
- [Dogfood proof](docs/proof/dogfood-proof.md)
- [Roadmap regression proof lane](docs/proof/roadmap-regression.md)

## What we do not claim

We stay narrow on purpose.

Not claimed:

- blanket superiority over every competitor
- fastest runtime
- semantic-code superiority on every benchmark
- that planning-only pressure reliably breaks every other workflow

Current strong claim:

**Plan Enforcer is repeatedly stronger on carryover durability, chain of
custody, and final-truth closure.**

## Best-fit users

Best fit:

- long-running agent workflows
- regulated or auditable teams
- high-risk change flows
- work with handoffs, resumes, or late mutations
- teams that need proof, not just output

Less ideal first wedge:

- pure speed-only users
- one-shot tasks where audit and carryover barely matter

## Repo layout

This repo is the launch-staging mirror, not the full internal lab.

Kept here:

- product code (`src/`, `hooks/`, `skills/`)
- tests
- install/setup surface
- examples
- curated proof docs
- benchmark helper scripts needed by tests

Left in the lab:

- full benchmark harness history
- raw result archives
- dated strategy scratch docs
- research and retro clutter

## Next

The launch-staging priorities are:

1. deepen executed verification
2. keep trimming runtime and operator friction
3. keep adding real dogfood evidence on code-changing work
