# Plan Enforcer

[![MIT License](https://img.shields.io/badge/license-MIT-blue.svg)](LICENSE)
[![Works with Claude Code](https://img.shields.io/badge/works%20with-Claude%20Code-orange.svg)](https://claude.ai/code)
[![Node.js >=18](https://img.shields.io/badge/node-%3E%3D18-brightgreen.svg)](https://nodejs.org)

`CHAIN-OF-CUSTODY LAYER` `V0.1` `MIT`

Plan Enforcer is ledger, decision trail, and chain of custody underneath AI-assisted coding, from original ask to repo state that shipped.

`CASE No. PE-0427`  
`FILED 2026-04-21`  
`CUSTODIAN jccidc/.plan-enforcer`

[![Problem and solution](docs/assets/problem-solution.svg)](docs/proof/public-proof.md)

> FIG.01 Drift compounds by default. Plan Enforcer makes chain explicit.

## 01 / Install

Sixty seconds. One ledger.

Requires [Claude Code](https://claude.ai/code) and [Node.js >= 18](https://nodejs.org). Installs hooks and skills. Default tier: `structural`.

```bash
git clone https://github.com/jccidc/.plan-enforcer.git
cd .plan-enforcer
./install.sh
plan-enforcer doctor
plan-enforcer discuss "..."
```

If `doctor` reports missing project config, that is onboarding state, not broken install. First `discuss` or `import` bootstraps repo-local `.plan-enforcer/` state.

| Without | With Plan Enforcer |
| --- | --- |
| scope silently narrows | `ask -> plan -> exec -> verify -> land` |
| decisions go unrecorded | ledger kept on disk |
| resumes start from stale context | resume continuity is first-class |

## 02 / What This Makes Provable

Plan Enforcer is built for moments where AI coding gets slippery: ask narrowing, mid-flight plan mutation, stale-context resumes, and "done" declared before repo truth catches up.

Those failure modes stop being invisible. They become reviewable.

| Surface | What stays reconstructible |
| --- | --- |
| Ask fidelity | original ask -> landed work |
| Lineage | plan -> implementation -> closure |
| Decisions | scope changes and tradeoffs |
| Resume | continuity across sessions |
| Closure | tied to repo state |

## 03 / Three Layers. One Custody Chain.

`ASK -> PLAN -> EXEC -> DECIDE -> VERIFY -> LAND`

[![Chain of custody](docs/assets/chain-of-custody.svg)](docs/assets/chain-of-custody.svg)

| Layer | Purpose | Surfaces |
| --- | --- | --- |
| 01 | Capture intent before drift starts | `discuss`, `draft`, `review`, `import` |
| 02 | Constrain execution while work is happening | ledger, phase gates, hooks, resume |
| 03 | Preserve truth after model stops talking | `verify`, `audit`, `report`, lineage |

Operator view:
- [Authorship chain](docs/assets/authorship-chain.svg)
- [Workflow](docs/assets/workflow.svg)
- [Stack](docs/assets/stack.svg)

## 04 / What It Catches

| No. | Failure mode | Surface | Status |
| --- | --- | --- | --- |
| 001 | silent narrowing of original request | ask fidelity | caught |
| 002 | phase drift and plan erosion during long execution | ledger | caught |
| 003 | undocumented scope changes | decision log | caught |
| 004 | incomplete closure masked as completion | verify | caught |
| 005 | stale-context resumes | resume | caught |
| 006 | missing carryover between sessions | carryover | caught |
| 007 | changes that landed without a defensible trail | audit | caught |

## 05 / Bring Your Own Plan

Not planner lock-in.

Front door:
`discuss -> draft -> review -> execute -> verify`

Bring plans from:
- GSD
- Superpowers
- markdown checklists
- your own workflow

```bash
plan-enforcer import docs/plans/my-plan.md
```

Same ledger. Same enforcement layer. Same audit surface. Same closure truth.

Proof pack:
- [Public proof map](docs/proof/public-proof.md)
- [Proof pack index](docs/proof/README.md)
- [Benchmark summary](docs/proof/benchmark-summary.md)
- [Carryover proof](docs/proof/carryover-proof.md)
- [Composability proof](docs/proof/composability-proof.md)
- [Dogfood proof](docs/proof/dogfood-proof.md)
- [Roadmap regression](docs/proof/roadmap-regression.md)

Visual proof surfaces:
- [Benchmark summary chart](docs/assets/benchmark-summary.svg)
- [Carryover ladder](docs/assets/carryover-ladder.svg)
- [Proof lanes](docs/assets/proof-lanes.svg)

## 06 / Best Fit

Strong fit:
- long-running agent work where drift compounds over time
- regulated or auditable engineering
- migrations, auth, payments, infra, and other high-risk changes
- work with handoffs, resumes, and late requirement mutation
- teams that need evidence, not just output

Less suited:
- one-shot throwaway scripting where audit does not matter
- workflows optimized purely for raw speed
- teams fine with commit messages as the only explanation layer

## 07 / Claim, Stated Narrowly

> When AI implementation has to survive scrutiny, mutation, interruption, and final review, Plan Enforcer provides the chain of custody.

Not better prompting. Fidelity under mutation. Continuity under interruption. Truth under review.

Open issues and PRs are welcome. If your workflow has a real failure mode not represented in proof pack yet, open issue with receipts.

MIT. See [LICENSE](LICENSE).
