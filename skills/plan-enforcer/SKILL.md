---
name: plan-enforcer
description: "Use when executing any implementation plan, before starting work on the first task --- prevents step skipping, plan drift, and premature completion claims through ledger-based tracking with three enforcement tiers (advisory, structural, enforced)."
---

# Plan Enforcer

Plan Enforcer converts implementation plans into an externalized task ledger --- a file on disk tracking every step's status, evidence, and decisions. The agent reads and updates this ledger as it works. Three tiers: advisory (habits only), structural (file-based truth), enforced (hooks verify independently).

## Activation

When a plan file is detected or user runs `/plan-enforcer <plan-path> --tier <tier>`:

1. Read plan file
2. Auto-detect format (see auto-detect.md)
3. Generate ledger at `.plan-enforcer/ledger.md` (see ledger-format.md)
4. Present ledger to user for confirmation
5. Begin execution with tier-appropriate protocol (see tiers.md)

Default tier: **structural** (override in `.plan-enforcer/config.md`).

If the user does not have a plan yet, use `plan-enforcer-draft` first to draft one into `docs/plans/`, then continue with normal enforcement against that file.
If plan quality is uncertain, use `plan-enforcer-review` before execution so weak plans do not flow into enforcement unchanged.

## Execution Loop

For each task in the ledger:

1. **Announce:** "Starting T{N}: {task name}"
2. **Re-read ledger** --- but ONLY if 3+ tool calls since you last read it. If you just updated the ledger, skip the re-read.
3. **Execute** the task
4. **Update ledger:** status, evidence (max 60 chars --- terse!), Chain column (comma-separated refs — D-row IDs, `C:<sha>` for commits, `V<n>` for verification records), notes
5. **Print scoreboard** (always, 2 lines)
6. **Reconciliation sweep:** every 5 tasks for plans with 12+ tasks, every 3 tasks for smaller plans. Re-read the FULL ledger, check every row, log gaps in Reconciliation History. This is NOT optional --- skipping reconciliation is a protocol violation.

## Ledger Schema (v2)

Task Ledger rows have 6 content columns:

| ID | Task | Status | Evidence | Chain | Notes |

**Chain** is machine-parseable breadcrumbs linking a task to what produced it: Decision Log IDs (`D1, D2`), commit SHAs (`C:a1b2c3d`), Verification records (`V1`). Populated as work happens — never left blank on a verified row.

Decision Log rows have 5 content columns:

| ID | Type | Scope | Reason | Evidence |

**Type** is one of: `deviation` (did Y instead of planned X), `unplanned` (edited file not in plan), `delete` (removed code — required for any deletion), `pivot` (jumped tasks out of order), `override` (bypassed a gate with user acknowledgment). Every deviation gets a typed row.

## Evidence Format

Evidence MUST be terse. Max 60 characters. Examples:

- Good: `tests pass (12/12), tsc clean`
- Good: `POST /api/users returns 201`
- Good: `migration runs, tables created`
- Bad: `Created the user registration endpoint with bcrypt hashing at 12 rounds, returns 201 with id, username, email on success, 409 on duplicate`

The ledger is a scoreboard, not a journal. Long evidence wastes context budget and prevents plan completion.

## Scoreboard Format

```
---Plan Enforcer --------------------------------
 {done}/{total} tasks  |  {verified} verified  |  {skipped} skipped  |  {blocked} blocked
 Tier: {tier}  |  Drift: {count}  |  Current: T{N}
-----------------------------------------------------
```

Computed from ledger table. Never manually edited.

## Vocabulary Policing

- **done** = work started but NOT yet proved
- **verified** = proved it works with evidence. If you ran tests, checked output, or confirmed via curl --- that IS verification. Mark it **verified**, not done.
- **skipped** / **superseded** = ONLY with a Decision Log entry. No silent drops.
- NEVER say "all tasks complete" while pending or in-progress items remain in ledger
- **Default to verified.** If you have ANY evidence (test output, commit hash, curl response, file exists), mark verified. Only use done when you genuinely cannot verify.

## Anti-Skip Rules

Triple-layer enforcement:

1. **Protocol level:** Every task must reach a terminal status (verified / skipped / blocked / superseded). Pending items = not done.
2. **Output level:** Reconciliation sweep after every batch checks ALL rows.
3. **Enforcement level:** At enforced tier, hooks independently verify (see hooks/).

## Red Flags --- STOP and Reconcile

These thoughts mean you are about to drift:

- "This step is unnecessary" --- Log a Decision, don't silently skip
- "I can combine these tasks" --- Ask user first, log Decision if approved
- "This is obvious, I'll skip it" --- Do it anyway. Log completion.
- "I'll come back to this later" --- Mark blocked with reason NOW
- "The plan is wrong here" --- Stop. Ask user. Log Decision.
- "I'm almost done, just need to wrap up" --- Check ledger. Count pending items.

## Rationalization Table

| Excuse                              | Reality                                                         |
|-------------------------------------|-----------------------------------------------------------------|
| "Too simple to track"               | Simple tasks get silently dropped most often                    |
| "I already know the status"         | The ledger knows. You might not. Re-read it.                   |
| "Updating the ledger slows me down" | Skipping tasks wastes more time than tracking them              |
| "The plan changed in my head"       | Plans change on disk, with Decision Log entries                 |
| "I'll update the ledger at the end" | Context rot means you'll forget what you skipped                |
| "I'll skip the reconciliation sweep" | Reconciliation is mandatory every 3-4 tasks. No exceptions.    |
| "Everything is done, no need to verify" | If tests passed, mark verified. done without evidence is lazy. |
| "The deviation was minor, no decision needed" | ALL deviations go in the Decision Log. No exceptions.  |

## Supporting Files

- **ledger-format.md** --- ledger structure, status lifecycle, computation rules
- **auto-detect.md** --- plan format detection and ledger generation
- **tiers.md** --- detailed tier behavioral specs

## Surfaces

- `/plan-enforcer:status` --- expanded scoreboard with details
- `/plan-enforcer:logs` --- full audit trail (decisions, drift, reconciliation)
- `/plan-enforcer:config` --- change tier, adjust thresholds
- `plan-enforcer-draft` --- skill-only planner that drafts an enforceable plan file
- `plan-enforcer-review` --- validator skill that checks plan quality before execution
