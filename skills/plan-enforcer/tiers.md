# Enforcement Tiers

Quick reference, then detailed specs per tier.

## Comparison Table

| Capability                      | Advisory     | Structural         | Enforced                    |
|---------------------------------|--------------|--------------------|-----------------------------|
| Task announcements              | yes          | yes                | yes                         |
| Vocabulary policing             | yes          | yes                | yes                         |
| Self-check at breakpoints       | yes          | yes                | yes                         |
| Decision log                    | in-chat      | on-disk            | on-disk                     |
| Ledger file on disk             | no           | yes                | yes                         |
| Mandatory re-read before batch  | no           | yes                | yes                         |
| Mandatory update after task     | no           | yes                | yes                         |
| Reconciliation sweeps           | manual       | per-batch          | per-batch + periodic        |
| Auto scoreboard                 | on request   | after every update | after every update          |
| Periodic reconciliation hook    | no           | no                 | yes                         |
| Completion gate hook            | no           | no                 | yes                         |
| Drift detection hook            | no           | no                 | yes                         |
| Stale ledger warning hook       | no           | no                 | yes                         |

---

## Advisory

No files created, no hooks active. Pure behavioral protocol.

- Agent announces each task: "Starting T{N}: {name}"
- Vocabulary policing active (done vs verified distinction)
- Self-check at natural batch boundaries: "Have I skipped anything?"
- Decision log maintained in conversation only (not persisted)
- Scoreboard printed only when user asks via `/plan-enforcer:status`
- No ledger file --- agent tracks in memory (vulnerable to context rot)

Best for: lightweight use, non-Claude-Code agents, quick tasks.

---

## Structural

Everything from advisory, plus file-based enforcement.

- Ledger file generated at `.plan-enforcer/ledger.md` on activation
- Agent MUST read ledger (Read tool) before starting each new batch
- Agent MUST update ledger (Edit tool) after completing each task --- status, evidence, notes
- Reconciliation sweep after every batch: read full ledger, check all rows, log any gaps
- Scoreboard auto-prints after every ledger update
- Decision log persisted in ledger file
- `/plan-enforcer:status` reads actual file, not agent memory
- `/plan-enforcer:logs` reads Decision Log + Reconciliation History from file
- The ledger IS the plan now. Original doc = reference. Ledger = working state.

Best for: daily development, most users, the recommended default.

---

## Enforced

Everything from structural, plus automated hook verification.

4 hooks active (installed via `install.sh` or `/plan-enforcer:config --tier enforced`):

- **Periodic reconciliation** (`hooks/reconcile.sh`): fires every N tool calls (default 25), reads ledger, checks for stuck/unverified/sequencing issues.
- **Completion gate** (`hooks/completion-gate.sh`): pattern-matches completion language, blocks if pending items remain. Configurable soft (warning) or hard (blocks).
- **Drift detection** (`hooks/drift-detect.sh`): flags file modifications not referenced in any ledger task.
- **Stale ledger warning** (`hooks/stale-warning.sh`): nudges if ledger unchanged for N tool calls (default 30).

Hook behavior:

- Warning-based (not blocking) except opt-in hard completion gate
- Read-only --- hooks never modify the ledger
- Degrade silently if no ledger exists

Best for: critical work, long multi-phase plans, teams that need accountability.

---

## Tier Selection Guide

```
Quick task, < 5 steps?                              --> advisory
Normal development?                                 --> structural (default)
Mission-critical, 10+ tasks, or known drift problems --> enforced
Non-Claude-Code agent?                              --> advisory (hooks not available)
```

---

## Switching Tiers

Via `/plan-enforcer:config --tier <tier>` or by editing `.plan-enforcer/config.md`.

| Transition              | What happens                                                        |
|-------------------------|---------------------------------------------------------------------|
| Advisory -> Structural  | Generates ledger file from current plan state                       |
| Structural -> Enforced  | Installs hooks into settings.json (user confirms)                   |
| Enforced -> Structural  | Removes hooks (user confirms)                                       |
| Any -> Advisory         | Removes hooks if present, ledger file preserved but optional        |
