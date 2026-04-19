# Enforcement Patterns

The 7 abstract patterns behind Plan Enforcer. Each one addresses a specific failure mode observed in AI agent workflows.

---

## 1. Task Ledger with Ownership

**Problem:** Steps get "forgotten" mid-execution. The agent drifts or context-rotates past incomplete work.

**Pattern:** Every step in the plan becomes a tracked row in an external table with a mandatory status field. Nothing can exist in a liminal "maybe done" state --- it's either pending, in-progress, done, verified, skipped, blocked, or superseded.

**Plan Enforcer implementation:** The ledger file (`.plan-enforcer/ledger.md`) contains a Task Ledger table where every extracted step has an ID, status, evidence, and notes column.

---

## 2. Verification Log (Claim-Evidence Binding)

**Problem:** Agents claim tasks are done without proving it. "I implemented the auth middleware" with no file path, no test output, no evidence.

**Pattern:** Separate the act of completing work from the act of proving it. Claims must declare evidence. The status "done" means "I did the work" while "verified" means "I proved it works and here is the evidence."

**Plan Enforcer implementation:** The `done` vs `verified` status distinction. The Evidence column in the ledger. A task cannot reach `verified` without a linked artifact (file path, test output, URL).

---

## 3. Reconciliation Protocol

**Problem:** The "looks done" problem. An agent completes 8 of 10 tasks but confidently reports completion because it lost track of the remaining 2.

**Pattern:** Periodically audit actual outputs against the plan. Don't trust running totals --- re-read the full state and check every row.

**Plan Enforcer implementation:** Mandatory reconciliation sweep after every batch. The agent re-reads the entire ledger and checks all rows for gaps (missing evidence, stuck statuses, sequencing issues). Gaps are logged in Reconciliation History.

---

## 4. Anti-Skip Mandates

**Problem:** Agents silently skip steps they consider trivial, obvious, or redundant. The loophole: nothing forces them to attempt every step.

**Pattern:** Explicit prohibition at multiple layers. One rule isn't enough --- the agent will rationalize past a single constraint. Stack enforcement at protocol level, output level, and (optionally) automated verification level.

**Plan Enforcer implementation:**

| Layer       | Mechanism                                                  |
|-------------|------------------------------------------------------------|
| Protocol    | Every task must reach a terminal status. Pending = not done. |
| Output      | Reconciliation sweep checks ALL rows after every batch.    |
| Enforcement | At enforced tier, hooks independently verify.              |

Plus: red flag phrases ("this step is unnecessary") trigger stop-and-reconcile behavior.

---

## 5. Externalized Working Memory

**Problem:** Context rot. The agent's internal representation of plan state degrades as the context window fills. By task 15, it has forgotten what happened at task 3.

**Pattern:** Put plan state on disk, not in the context window. Re-read the authoritative state from disk before each batch of work.

**Plan Enforcer implementation:** The ledger file IS the working memory. At structural and enforced tiers, the agent must re-read the ledger before starting each new batch. The agent's in-context memory of plan state is treated as unreliable.

---

## 6. Decision Log

**Problem:** Plan drift becomes invisible. Tasks get skipped or modified without any record. Post-mortem is impossible because nobody knows when or why the plan changed.

**Pattern:** Record every deviation with rationale. Require a formal entry for any skip, scope change, or unplanned addition.

**Plan Enforcer implementation:** The Decision Log table in the ledger. Skipping or superseding a task requires a `D{N}` entry. The Notes column in the Task Ledger cross-references it (`see Decision D1`). Drift count is computed from Decision Log entries.

---

## 7. Vocabulary Policing

**Problem:** Fake certainty. Agents use confidence words ("verified", "all tasks complete") without the evidence to back them up. This trains the user to trust unverified claims.

**Pattern:** Gate confidence words behind evidence. Define a vocabulary where each term has a precise meaning and enforce that meaning.

**Plan Enforcer implementation:**

| Word         | Meaning                                              | Gate                                |
|--------------|------------------------------------------------------|-------------------------------------|
| done         | Work completed, not yet proved                       | None --- claim freely               |
| verified     | Proved working with linked evidence                  | Evidence column must be populated   |
| skipped      | Intentionally not done                               | Decision Log entry required         |
| superseded   | Replaced by different approach                       | Decision Log entry required         |
| "all complete" | Every task at terminal status                      | Ledger must have 0 pending/in-progress |

---

## Research Attribution

These patterns were abstracted from observed failure modes in AI coding agents and informed by the following sources:

**Community failure reports:**
- Claude Code issue [#24129](https://github.com/anthropics/claude-code/issues/24129) --- task skipping in long plans
- Claude Code issue [#32253](https://github.com/anthropics/claude-code/issues/32253) --- premature completion claims
- Claude Code issue [#6159](https://github.com/anthropics/claude-code/issues/6159) --- context rot during multi-step execution
- Claude Code issue [#20024](https://github.com/anthropics/claude-code/issues/20024) --- silent plan drift
- Claude Code issue [#21027](https://github.com/anthropics/claude-code/issues/21027) --- sycophantic "all done" reporting

**Academic research:**
- Liu et al., 2023 --- "Lost in the Middle: How Language Models Use Long Contexts" (positional attention decay explains why middle tasks get dropped)

**Industry writing:**
- Addy Osmani --- "The 80% Problem" (sycophantic shortcutting: agents complete the easy 80% and claim 100%)
