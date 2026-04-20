# Plan Enforcer

[![MIT License](https://img.shields.io/badge/license-MIT-blue.svg)](LICENSE)
[![Works with Claude Code](https://img.shields.io/badge/works%20with-Claude%20Code-orange.svg)](https://claude.ai/code)
[![Node.js >=18](https://img.shields.io/badge/node-%3E%3D18-brightgreen.svg)](https://nodejs.org)

**The enforcement and audit layer for AI coding.**

Keep your planner. Keep your IDE. Plan Enforcer sits under the tool-call
surface, where "done" means a ledger row with evidence, not a confident
sentence from the model.

[![Problem and solution](docs/assets/problem-solution.svg)](docs/proof/public-proof.md)

---

## Install in 60 seconds

```bash
git clone https://github.com/jccidc/.plan-enforcer.git
cd .plan-enforcer
./install.sh
```

**Requires [Claude Code](https://claude.ai/code) and Node.js >= 18.**

Start here:

- [Try it](docs/try-it.md)
- [CLI guide](docs/cli.md)
- [Public proof](docs/proof/public-proof.md)

---

## Why this exists

Teams keep running into the same failures:

- the model narrows the ask and nobody sees it happen
- the agent says work is done when the repo says otherwise
- a late requirement change never survives into final code
- a resumed session reads stale context and rebuilds the wrong thing
- six months later nobody can explain why a file changed

Plan Enforcer exists to make those failures visible, blockable, and
cold-reviewable.

---

## The product

### Authorship layer

[![Authorship layer](docs/assets/authorship-layer.svg)](docs/assets/authorship-chain.svg)

- `discuss` captures intent before drift starts
- `draft` turns that intent into an executable plan
- `review` checks for drift, weak proof, and bad narrowing
- bring your own plan still works through the same enforcement stack

### Execution layer

[![Execution layer](docs/assets/execution-layer.svg)](docs/assets/workflow.svg)

- large work runs phase-first, not as one giant wish
- `.plan-enforcer/ledger.md` stays human-readable and machine-parseable
- structural and enforced tiers block real integrity failures
- crash and resume continuity are built into the runtime

### Truth layer

[![Truth layer](docs/assets/truth-layer.svg)](docs/assets/chain-of-custody.svg)

- verify, audit, and report are first-class product surfaces
- ask-fidelity, carryover, and closure truth live in the same proof lane
- lineage and chain of custody stay reconstructible from the repo alone
- final sign-off is tied to what actually landed

---

## Bring your own plan

Plan Enforcer is not planner lock-in.

Use the built-in chain:

- `discuss -> draft -> review -> execute -> verify`

Or bring a plan from:

- GSD
- Superpowers
- a markdown checklist
- your own planning workflow

Same enforcement. Same truth layer. Same audit surface.

---

## Why believe it

[![Benchmark summary](docs/assets/benchmark-summary.svg)](docs/proof/benchmark-summary.md)

[![Carryover ladder](docs/assets/carryover-ladder.svg)](docs/proof/carryover-proof.md)

[![Public proof lanes](docs/assets/proof-lanes.svg)](docs/proof/public-proof.md)

Read the curated proof pack:

- [Benchmark summary](docs/proof/benchmark-summary.md)
- [Carryover proof](docs/proof/carryover-proof.md)
- [Composability proof](docs/proof/composability-proof.md)
- [Dogfood proof](docs/proof/dogfood-proof.md)
- [Roadmap regression proof lane](docs/proof/roadmap-regression.md)
- [Public proof frames](docs/proof/public-proof.md)

For full receipts:

- [Final report](benchmarks/framework-comparison/FINAL-REPORT-2026-04-17.md)
- [Canonical completion](benchmarks/framework-comparison/CANONICAL-COMPLETION.md)
- [Methodology](benchmarks/framework-comparison/METHODOLOGY.md)
- [Capability matrix](docs/strategy/capability-matrix.md)

---

## See the whole system

[![Workflow](docs/assets/workflow.svg)](docs/assets/workflow.svg)

[![Stack](docs/assets/stack.svg)](docs/assets/stack.svg)

[![Chain of custody](docs/assets/chain-of-custody.svg)](docs/assets/chain-of-custody.svg)

[![Authorship chain](docs/assets/authorship-chain.svg)](docs/assets/authorship-chain.svg)

---

## Best fit

- long-running agent work where drift compounds over time
- regulated or auditable engineering teams
- migrations, auth, payments, and other high-risk changes
- work with handoffs, resumes, and late mutations
- teams that need proof, not just output

Not the first wedge:

- pure speed-only one-shot script users
- teams fine with re-running wrong work tomorrow
- workflows where "audit" means "read the commit message"

---

## Common questions

**Is this a replacement for GSD or Superpowers?**  
No. It is an enforcement and truth layer. Keep your planner if you want.

**Does it need a server?**  
No. Ledger, decision log, archive, and proof stay on disk.

**Does it only work with Claude Code?**  
Full tool-call blocking requires Claude Code hooks today. Other surfaces
still get authorship and audit tooling.

**What is the moat versus better prompting?**  
Prompts are advice. Hooks are walls.

---

## What we do not claim

- blanket superiority on every axis
- cheapest runtime in every benchmark
- that planning-only pressure breaks every competitor

The honest public claim is narrower:

> Plan Enforcer is strongest where agent work usually becomes
> unshippable: repaired-contract carryover, chain of custody, and final
> truth.

---

## Contributing

Open issues and PRs are welcome. If your workflow has a real failure
mode that is not in the proof pack yet, open an issue describing it.

---

## License

MIT. See [LICENSE](LICENSE).
