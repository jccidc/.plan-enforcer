# Plan Enforcer

[![MIT License](https://img.shields.io/badge/license-MIT-blue.svg)](LICENSE)
[![Works with Claude Code](https://img.shields.io/badge/works%20with-Claude%20Code-orange.svg)](https://claude.ai/code)
[![Node.js >=18](https://img.shields.io/badge/node-%3E%3D18-brightgreen.svg)](https://nodejs.org)

**Chain-of-custody enforcement for AI-assisted software delivery.**

Plan Enforcer is the control and audit layer beneath AI coding workflows.

It captures intent before implementation begins, drives execution through a structured ledger, and preserves the evidence required to verify that the final repository state matches the authorized request.

Keep your planner. Keep your IDE. Keep your workflow.

Plan Enforcer exists to make AI-assisted implementation **traceable, reviewable, and auditable**.

[![Problem and solution](docs/assets/problem-solution.svg)](docs/proof/public-proof.md)

---

## What this makes provable

AI-assisted delivery often breaks down in predictable ways:

- the original request is narrowed during execution
- scope changes are made without a record of why
- resumed work continues from stale or partial context
- completion is claimed before the repository reflects the request
- later reviewers cannot reconstruct why specific changes were made

Plan Enforcer addresses those failures by preserving:

- **ask fidelity** from original request to landed work
- **execution lineage** from plan to implementation to closure
- **decision traceability** when requirements change or tradeoffs are made
- **resume continuity** across interrupted or resumed sessions
- **closure truth** tied to what actually landed in the repository

This is more than prompting discipline. It is a chain-of-custody layer for AI-assisted implementation.

---

## Install in 60 seconds

```bash
git clone https://github.com/jccidc/.plan-enforcer.git
cd .plan-enforcer
./install.sh
