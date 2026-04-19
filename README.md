# Plan Enforcer

[![MIT License](https://img.shields.io/badge/license-MIT-blue.svg)](LICENSE)
[![Works with Claude Code](https://img.shields.io/badge/works%20with-Claude%20Code-orange.svg)](https://claude.ai/code)
[![Node.js ≥18](https://img.shields.io/badge/node-%E2%89%A518-brightgreen.svg)](https://nodejs.org)

**The enforcement and audit layer that makes AI coding auditable.**

Keep your planner. Keep your IDE. Plan Enforcer sits underneath the tool-call surface, where "done" means a ledger row with evidence, not a confident sentence from the model.

```bash
git clone https://github.com/jccidc/.planenforcer.git
cd .planenforcer && ./install.sh
```

**Requires [Claude Code](https://claude.ai/code) and Node.js ≥ 18.**

---

## The problem

Your agent said it shipped the feature. It did not.

Every team running long-running agent work has seen one or more of these:

- **Silent narrowing.** You asked for "clean up auth flow." The model shipped a rename and declared victory. The contract you signed up for is gone, and nobody can tell you when it slipped.
- **Fake completion.** The ledger says 24/24. The feature on disk is 18/24. The numbers came from the agent's self-report, not from what actually landed.
- **Lost contract after mutation.** You added a requirement halfway through. Execution continued. The repaired contract is nowhere in the final commit.
- **Unrecoverable resume.** The session died. The next session read a stale plan and rebuilt finished work, or skipped work that wasn't.
- **Cold-review failure.** Someone opens the repo six months later and cannot reconstruct why any given change exists.

The common cause: agents operate at the **prompt layer**. They can be reminded, nudged, and asked nicely. They cannot be blocked.

Plan Enforcer operates at the **tool-call layer**. It does not ask. It blocks.

---

## How it works

![Plan Enforcer workflow](docs/assets/workflow.svg)

Every `Edit`, `Write`, and `Delete` the agent attempts is intercepted by a Claude Code hook that looks up the plan ledger on disk. If the edit traces to an approved plan row or a typed Decision Log deviation, it passes. If it does not, it is rejected — and the agent is told why, in a machine-readable response the next tool call can act on. The ledger survives session death. The decision log is typed and queryable. The chain of custody is reconstructible from the repo alone, six months later, by someone who was not in the room.

![Plan Enforcer stack](docs/assets/stack.svg)

---

## The numbers

Three systems, same prompt, same fixtures, judged by an out-of-process `outcome.json` scorer that reads shipped files — not self-reports.

### Carryover — the repeated moat

Each scenario adds a mutation after the plan was already drafted and partially executed. The classic "requirements changed mid-build" fail case.

| Scenario | Pressure                              | Plan Enforcer | GSD         | Superpowers |
|----------|---------------------------------------|--------------:|------------:|------------:|
| H        | first carryover separator             |     **16/16** | 13/16 (81%) | 12/16 (75%) |
| I        | medium repeat                         |     **24/24** | 15/24 (63%) | 15/24 (63%) |
| J        | late mutation                         |     **28/28** | 15/28 (54%) | 16/28 (57%) |
| K        | double mutation                       |     **32/32** | 23/32 (72%) | 23/32 (72%) |
| K resume | double mutation + crash + resume      |     **32/32** | 24/32 (75%) | 25/32 (78%) |
| L        | triple mutation after resume          |     **40/40** | 32/40 (80%) | 34/40 (85%) |
| **Total**|                                       | **172 / 172** | 122 / 172   | 125 / 172   |
| **Rate** |                                       |      **100%** |       71%   |       73%   |

When the contract changes mid-build, the other two systems still ship *a* feature. They do not ship *your* repaired feature. Plan Enforcer does, under repeated mutation and interruption, 172 times in a row.

[![Plan Enforcer carryover ladder](docs/assets/carryover-ladder.svg)](docs/proof/carryover-proof.md)

Source: `benchmarks/framework-comparison/ASK-FIDELITY-*-COMPARISON.md` — one file per scenario, each backed by `outcome.json` + `ask-fidelity.json`.

### Large phased execution — 98 tasks, 14 phases

| System                 | Completion | Wall clock    | Tokens      | Cost (USD)   | Audit replay |
|------------------------|-----------:|--------------:|------------:|-------------:|-------------:|
| **Plan Enforcer**      |  **98/98** |  **92m 52s**  |  68.3M      |  $66.30      |     **1.00** |
| GSD                    |      98/98 |     116m 49s  |  53.9M      |  $50.22      |         0.75 |
| Superpowers            |      98/98 |     125m 06s  |  67.9M      |  $65.37      |         0.75 |

Plan Enforcer ships in ~20% less wall clock than GSD and ~26% less than Superpowers on a 98-task trust pack, with the strongest audit-replay score of the three (1.00 vs 0.75). GSD is cheaper by ~$16 on this run; we are not the cheapest runtime, and we say so.

Source: `benchmarks/framework-comparison/PHASED-LARGE-TRUST-COMPARISON.md`.

### Planning quality under ambiguity

Scenario B forces a real interpretation fork between safe replay and a weaker retry framing.

| System            | Interpretation | Plan | Review | Result   |
|-------------------|---------------:|-----:|-------:|---------:|
| **Plan Enforcer** |       **pass** | pass |   pass | **pass** |
| GSD               |           fail | pass |   pass |     fail |
| Superpowers       |           pass | pass |   fail |     fail |

Only Plan Enforcer's `Discuss → draft → review` chain preserves the full semantic defense of the original ask.

Source: `benchmarks/framework-comparison/PLANNING-QUALITY-SCENARIO-B-COMPARISON.md`.

### Small phased — table stakes

| System            | Completion | Wall clock  | Cost (USD)  |
|-------------------|-----------:|------------:|------------:|
| **Plan Enforcer** |  **24/24** | 23m 11s     | $9.53       |
| GSD               |      24/24 | 20m 57s     | $9.01       |
| Superpowers       |      24/24 | 28m 39s     | $11.11      |

On bounded 24-task phased work, all three ship. Plan Enforcer lands mid-pack on speed and cost. This is **parity**, not a moat — and that is the point. The moat shows up the moment the contract changes.

[![Plan Enforcer benchmark summary](docs/assets/benchmark-summary.svg)](docs/proof/benchmark-summary.md)

---

## What you get

### Authorship layer — meaning survives into execution

- **Discuss** — turns a fuzzy ask ("clean up auth flow") into an intent-defense packet with verbatim user quotes, non-negotiables, and forbidden narrowings. The anchor every downstream stage is measured against.
- **Draft** — writes the concrete executable plan into `docs/plans/<slug>.md`: repo-aware, proof-aware, phased.
- **Review** — scans the draft against the packet for drift. Flags missing proof, dropped constraints, bad narrowings. Runs a structural scanner and an adversarial pass.
- **Bring your own plan** — the whole stack works on GSD plans, Superpowers plans, or hand-written checklists. The authorship chain is optional; enforcement is not.

### Execution layer — phase-first runtime

- **Bounded phases.** Large work is cut into phases. Each phase has its own verifier output.
- **Single-file ledger.** `.plan-enforcer/ledger.md` holds every task, status, evidence pointer, and chain-of-custody reference. Human-readable, machine-parseable, git-diffable.
- **Tier dial.** Three intensity levels you choose: `advisory` (logs, no blocks), `structural` (default: warns on drift, blocks hard breaks), `enforced` (CI-grade: blocks every unplanned edit until logged).
- **Crash-proof.** Session dies? `SessionStart` hook reads the ledger on next launch, knows which tasks are verified and which are pending, and resumes at the right row.

### Truth layer — cold-reviewable proof

- **Typed Decision Log.** Every deviation is typed: `unplanned`, `delete`, `scope-expand`, `accept-mixed-coverage`. Free-form narratives are rejected; the types are what the hooks key off.
- **Chain of custody per edit.** Every change traces to a plan row or a typed D-row. No orphan edits.
- **Audit CLIs.** `plan-enforcer-chain T5` shows the full custody for task T5. `plan-enforcer-why src/auth/middleware.ts` shows why the file was touched. `plan-enforcer-audit` dumps the entire trail.
- **Final-truth closure.** Cross-phase sign-off with attestation. The thing you sign off on is what actually landed.

---

## Capability matrix

Every `Yes` below is backed by a concrete file reference in [`docs/strategy/capability-matrix.md`](docs/strategy/capability-matrix.md). No marketing-only claims.

| Capability                                            | GSD     | Superpowers | Plan Enforcer |
|-------------------------------------------------------|:-------:|:-----------:|:-------------:|
| On-disk plan                                          |   Yes   |     Yes     |      Yes      |
| On-disk task tracker                                  |   Yes   |   Partial   |      Yes      |
| Resume state across fresh session                     |   Yes   |     Yes     |      Yes      |
| Typed / structured deviation schema                   |   No    |     No      |    **Yes**    |
| Blocks unplanned edits structurally                   |   No    |     No      |    **Yes**    |
| Blocks deletions structurally                         |   No    |     No      |    **Yes**    |
| Gates completion on unfinished work                   |   No    |     No      |    **Yes**    |
| Audit trail reconstructible from repo alone           | Partial |   Partial   |    **Yes**    |
| Tier-aware enforcement (advisory/structural/enforced) |   No    |     No      |    **Yes**    |
| Audit / query CLI surface                             |   No    |     No      |    **Yes**    |
| Additive enforcement layer over another workflow      |   No    |     No      |    **Yes**    |

GSD and Superpowers are planning + execution workflows. Plan Enforcer is an **enforcement and audit layer that runs natively or strengthens other workflows.** Those are not competing categories. They stack.

[![Plan Enforcer public proof lanes](docs/assets/proof-lanes.svg)](docs/proof/public-proof.md)

---

## Install

**Prerequisites:** [Claude Code](https://claude.ai/code), Node.js ≥ 18.

```bash
git clone https://github.com/jccidc/.planenforcer.git
cd .planenforcer
./install.sh
```

Installs as Claude Code skills and hooks. Works with any project. Default tier is `structural`. Flip to `advisory` to learn, `enforced` for CI.

```bash
plan-enforcer-config                   # show current tier and settings
plan-enforcer-config --tier enforced   # switch tier
plan-enforcer-status                   # scoreboard, current task, unverified items
plan-enforcer-chain T5                 # custody chain for task T5
plan-enforcer-why src/auth.ts          # why was this file touched
plan-enforcer-audit                    # full trail
```

Uninstall: `./uninstall.sh`. Hooks are removed; ledgers stay on disk as historical records.

---

## Try it in 60 seconds

Open any project that already has a plan file. Start Claude Code and tell it to execute:

```
Execute docs/plans/<your-plan-file>.md
```

The `SessionStart` hook auto-detects the plan, generates the ledger, and injects the enforcement protocol. Every subsequent edit is traced.

**No plan file yet?** Start a Discuss session in Claude Code:

```
Use plan-enforcer-discuss to work through: "Add rate limiting to the login endpoint"
```

Then draft and review it before execution:

```
Use plan-enforcer-draft to write the plan
Use plan-enforcer-review on docs/plans/<generated-plan>.md
```

**Already using GSD or Superpowers?** Point Plan Enforcer at an existing plan file. The enforcement layer runs regardless of who drafted the plan.

---

## Who this is for

**Best fit:**

- Teams running long-lived agent workflows where drift compounds across sessions.
- Regulated or auditable engineering orgs where "the agent said it was done" is not a defense.
- Platform teams running fleets of Claude Code sessions at scale.
- High-risk change flows — migrations, auth, payments, anything where silent narrowing is expensive.
- Work with handoffs, resumes, or late mutations, especially across timezones.
- Teams that need **proof**, not just output.

**Not the first wedge:**

- Pure speed-only users running one-shot greenfield scripts.
- Teams where a 20-minute task that ships wrong and gets rerun tomorrow is fine.
- Workflows where "audit" means "check the commit message."

---

## What we do not claim

We stay honest. These are not proven:

- Blanket superiority over GSD on every axis.
- Fastest runtime — we are not the cheapest on several cells.
- That planning-only pressure reliably breaks every competitor.

The correct claim is narrow and strong:

> Plan Enforcer is repeatedly stronger on **carryover durability, chain of custody, and final-truth closure** — the failure modes that make agent-driven engineering unshippable in regulated and long-running contexts.

---

## Proof pack

Every table above has a backing file. Open any of them and you will find the per-cell `outcome.json`, token counts, wall clock, and judging rubric.

**Benchmark truth:**

- [`FINAL-REPORT-2026-04-17.md`](benchmarks/framework-comparison/FINAL-REPORT-2026-04-17.md) — current authoritative summary
- [`CANONICAL-COMPLETION.md`](benchmarks/framework-comparison/CANONICAL-COMPLETION.md) — single-source-of-truth completion numbers
- [`COST-COMPARISON.md`](benchmarks/framework-comparison/COST-COMPARISON.md) — per-cell token and dollar breakdown

**Carryover lane (the moat):**

- [`ASK-FIDELITY-SCENARIO-H-COMPARISON.md`](benchmarks/framework-comparison/ASK-FIDELITY-SCENARIO-H-COMPARISON.md)
- [`ASK-FIDELITY-MEDIUM-SCENARIO-I-COMPARISON.md`](benchmarks/framework-comparison/ASK-FIDELITY-MEDIUM-SCENARIO-I-COMPARISON.md)
- [`ASK-FIDELITY-MEDIUM-SCENARIO-J-COMPARISON.md`](benchmarks/framework-comparison/ASK-FIDELITY-MEDIUM-SCENARIO-J-COMPARISON.md)
- [`ASK-FIDELITY-MEDIUM-SCENARIO-K-COMPARISON.md`](benchmarks/framework-comparison/ASK-FIDELITY-MEDIUM-SCENARIO-K-COMPARISON.md)
- [`ASK-FIDELITY-MEDIUM-SCENARIO-K-RESUME-COMPARISON.md`](benchmarks/framework-comparison/ASK-FIDELITY-MEDIUM-SCENARIO-K-RESUME-COMPARISON.md)
- [`ASK-FIDELITY-MEDIUM-SCENARIO-L-COMPARISON.md`](benchmarks/framework-comparison/ASK-FIDELITY-MEDIUM-SCENARIO-L-COMPARISON.md)

**Phased execution:**

- [`PHASED-SMALL-COMPARISON.md`](benchmarks/framework-comparison/PHASED-SMALL-COMPARISON.md)
- [`PHASED-LARGE-TRUST-COMPARISON.md`](benchmarks/framework-comparison/PHASED-LARGE-TRUST-COMPARISON.md)

**Planning quality:**

- [`PLANNING-QUALITY-SCENARIO-B-COMPARISON.md`](benchmarks/framework-comparison/PLANNING-QUALITY-SCENARIO-B-COMPARISON.md)
- [`PLANNING-QUALITY-SMALL-COMPARISON.md`](benchmarks/framework-comparison/PLANNING-QUALITY-SMALL-COMPARISON.md)
- [`PLANNING-QUALITY-MEDIUM-SCENARIO-C-COMPARISON.md`](benchmarks/framework-comparison/PLANNING-QUALITY-MEDIUM-SCENARIO-C-COMPARISON.md) through `-G-COMPARISON.md`

**Methodology and judging:**

- [`METHODOLOGY.md`](benchmarks/framework-comparison/METHODOLOGY.md)
- [`JUDGING-BRIEF.md`](benchmarks/framework-comparison/JUDGING-BRIEF.md)
- [`OPERATING.md`](benchmarks/framework-comparison/OPERATING.md)
- [`capability-matrix.md`](docs/strategy/capability-matrix.md)

**Curated proof docs:**

- [Benchmark summary](docs/proof/benchmark-summary.md)
- [Carryover proof](docs/proof/carryover-proof.md)
- [Composability proof](docs/proof/composability-proof.md)
- [Dogfood proof](docs/proof/dogfood-proof.md)
- [Roadmap regression proof lane](docs/proof/roadmap-regression.md)
- [Public proof frames](docs/proof/public-proof.md)

---

## Common questions

**"Is this a replacement for GSD / Superpowers / my existing workflow?"**
No. It is an enforcement and audit layer. Keep your planner. Add Plan Enforcer so the plan actually gets enforced.

**"Does it slow the agent down?"**
At `advisory` tier, it is pure logging. At `structural` (default), the only blocks are on edits with no plan row and no D-row — which is the thing you want blocked. At `enforced`, CI-grade blocking. The ~25% wall-clock advantage on 98-task trust (vs the nearest competitor) shows it does not cost you speed on real work.

**"Does it need a server?"**
No. Ledger is a markdown file. Decision Log is a markdown table. Hooks are local. Nothing phones home.

**"Does it work with Cursor / Windsurf / non-Claude?"**
The enforcement hooks are built on Claude Code's `PreToolUse` and `SessionStart` APIs. Other surfaces get the authorship chain and audit CLIs, but without tool-call blocking. The full moat requires Claude Code today.

**"What is the moat vs just writing better prompts?"**
Prompts are advice. Hooks are walls. You cannot prompt your way to an auditable ledger.

---

## Contributing

Open issues and PRs are welcome. If your workflow has a fail mode that is not already in the benchmark set, open an issue describing it — that is how Scenario L got added.

---

## License

MIT. See [LICENSE](LICENSE).

---

**Execution is credible. Planning is competitive. Carryover plus chain of custody is the moat.**
