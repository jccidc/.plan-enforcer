# Ledger Format Specification

Reference for `.plan-enforcer/ledger.md` structure, status lifecycle, and computation rules.

## File Location

Default: `.plan-enforcer/ledger.md` in project root. Override via `ledger_path` in `.plan-enforcer/config.md`.

## HTML Comment Header

```markdown
<!-- source: docs/implementation-plan.md -->
<!-- tier: structural -->
<!-- created: 2026-04-10T14:30:00Z -->
```

All three fields required. `source` = path to original plan file. `tier` = `advisory|structural|enforced`. `created` = ISO 8601.

## Scoreboard

```markdown
## Scoreboard

 6 total  |  1 done  |  2 verified  |  1 skipped  |  1 blocked  |  1 remaining
 Drift: 0  |  Last reconcile: T4  |  Tier: structural
```

Computed from the Task Ledger table. Agent must recount rows by status every time it updates the scoreboard. Never edit scoreboard values manually.

## Task Ledger

```markdown
## Task Ledger

| ID   | Task                        | Status      | Evidence                     | Notes                     |
|------|-----------------------------|-------------|------------------------------|---------------------------|
| T1   | Setup auth middleware        | verified    | src/middleware/auth.ts        |                           |
| T2   | Create user model           | verified    | src/models/user.ts           |                           |
| T3   | Implement login endpoint    | done        | src/routes/auth.ts           | needs integration test    |
| T4   | Implement registration      | in-progress |                              |                           |
| T5   | Add password reset          | skipped     |                              | see Decision D1           |
| T6   | Add rate limiting           | blocked     |                              | waiting on redis setup    |
```

Column rules:

- **ID** --- `T1`, `T2`, `T3`... Sub-steps: `T1.1`, `T1.2`...
- **Task** --- short description from the plan
- **Status** --- one of the lifecycle values below
- **Evidence** --- file path, test output, URL, or empty
- **Notes** --- free text. `see Decision D{N}` required for skip/supersede
- **Alignment** --- all columns padded to align (dyslexia accommodation)

## Status Lifecycle

```
pending -> in-progress -> done -> verified
                       -> skipped     (requires Decision Log entry D{N})
                       -> blocked     (requires reason in Notes)
                       -> superseded  (requires Decision Log entry D{N})
```

| Category | Statuses                                  |
|----------|-------------------------------------------|
| Active   | pending, in-progress, done                |
| Terminal | verified, skipped, blocked, superseded    |

`done` is NOT terminal. It means work is complete but unverified. A task is only finished when it reaches a terminal status.

## Decision Log

```markdown
## Decision Log

| ID   | Task Ref | Decision                          | Reason                                              |
|------|----------|-----------------------------------|-----------------------------------------------------|
| D1   | T5       | Skip password reset               | MVP scope --- defer to Phase 2 per user direction    |
| D2   | T4       | Added email verification sub-step | Security review required it; not in original plan    |
```

Column rules:

- **ID** --- `D1`, `D2`, `D3`...
- **Task Ref** --- which task ID this decision affects
- **Decision** --- what was decided
- **Reason** --- WHY, not a restatement of the decision

Required for every skip, supersede, drift event, or plan change.

## Reconciliation History

```markdown
## Reconciliation History

| Round | Tasks Checked | Gaps Found        | Action Taken                               |
|-------|---------------|-------------------|--------------------------------------------|
| R1    | T1-T3         | 1 (T2 no evidence) | Added test output as evidence for T2       |
| R2    | T1-T6         | 0                 | No gaps                                    |
```

Column rules:

- **Round** --- `R1`, `R2`, `R3`...
- **Tasks Checked** --- range or list of task IDs checked
- **Gaps Found** --- count + task IDs, or `0`
- **Action Taken** --- what was done about the gaps

Logged after every reconciliation sweep.

## Scoreboard Computation Rules

| Field     | Formula                                                              |
|-----------|----------------------------------------------------------------------|
| total     | count all Task Ledger rows (exclude sub-steps if parent row exists)  |
| done      | rows with status `done` (NOT `verified`)                             |
| verified  | rows with status `verified`                                          |
| skipped   | rows with status `skipped`                                           |
| blocked   | rows with status `blocked`                                           |
| remaining | total - done - verified - skipped - blocked - superseded             |
| drift     | count Decision Log entries where Decision contains "drift" or "unplanned" |

## Full Example

A realistic auth system implementation: 6 tasks, 2 verified, 1 done, 1 in-progress, 1 skipped, 1 blocked.

```markdown
<!-- source: docs/auth-implementation-plan.md -->
<!-- tier: structural -->
<!-- created: 2026-04-10T09:00:00Z -->

## Scoreboard

 6 total  |  1 done  |  2 verified  |  1 skipped  |  1 blocked  |  1 remaining
 Drift: 1  |  Last reconcile: T6  |  Tier: structural

## Task Ledger

| ID   | Task                        | Status      | Evidence                          | Notes                     |
|------|-----------------------------|-------------|-----------------------------------|---------------------------|
| T1   | Setup auth middleware        | verified    | src/middleware/auth.ts             | JWT validation working    |
| T2   | Create user model           | verified    | tests/models/user.test.ts passing | 12 tests green            |
| T3   | Implement login endpoint    | done        | src/routes/auth.ts                | needs integration test    |
| T4   | Implement registration      | in-progress |                                   | added email verification  |
| T4.1 | Email verification flow     | pending     |                                   | see Decision D2           |
| T5   | Add password reset          | skipped     |                                   | see Decision D1           |
| T6   | Add rate limiting           | blocked     |                                   | waiting on redis setup    |

## Decision Log

| ID   | Task Ref | Decision                                  | Reason                                                 |
|------|----------|-------------------------------------------|--------------------------------------------------------|
| D1   | T5       | Skip password reset                       | MVP scope --- defer to Phase 2 per user direction      |
| D2   | T4       | Unplanned: added email verification step  | Security review flagged registration without verify    |

## Reconciliation History

| Round | Tasks Checked | Gaps Found          | Action Taken                                |
|-------|---------------|---------------------|---------------------------------------------|
| R1    | T1-T3         | 1 (T2 no evidence) | Ran test suite, linked passing test output  |
| R2    | T1-T6         | 1 (T3 unverified)  | Noted --- integration test still needed     |
```

### Verification: example scoreboard matches table

- **total** = 6 (T1-T6; T4.1 excluded because parent T4 exists)
- **done** = 1 (T3)
- **verified** = 2 (T1, T2)
- **skipped** = 1 (T5)
- **blocked** = 1 (T6)
- **remaining** = 6 - 1 - 2 - 1 - 1 - 0 = 1 (T4, which is in-progress)
- **drift** = 1 (D2 contains "Unplanned")
