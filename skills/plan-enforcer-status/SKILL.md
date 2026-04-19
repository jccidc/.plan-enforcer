---
name: plan-enforcer-status
description: "Use when checking Plan Enforcer progress --- shows scoreboard, current task, unverified items, and stale warnings from the active ledger"
---

# Status

Read `.plan-enforcer/ledger.md`. If missing: "No active Plan Enforcer session. Activate with `/plan-enforcer <plan-file>`"

If the installed CLI is available, prefer running `node ~/.claude/skills/plan-enforcer/src/status-cli.js .plan-enforcer/ledger.md` so the output matches the shared formatter exactly.

## Compute

Parse the Task Ledger table. Count rows by status column:

| Metric   | Source                                           |
|----------|--------------------------------------------------|
| done     | status = done OR verified                        |
| verified | status = verified                                |
| skipped  | status = skipped OR superseded                   |
| blocked  | status = blocked                                 |
| total    | all rows                                         |
| drift    | count of Decision Log entries tagged drift/unplanned |
| current  | first row where status = in-progress OR pending  |

## Display

```
---🛡️Plan Enforcer Status ------------------------------
 {done}/{total} tasks  |  {verified} verified  |  {skipped} skipped  |  {blocked} blocked
 Tier: {tier}  |  Drift: {drift}  |  Current: T{N}
---------------------------------------------------------

Current Task: T{N} --- {task description}

Unverified (done but no evidence):
  T3 --- Add session storage
  T6 --- Configure CORS

Blocked:
  T4 --- Write integration tests (DB fixtures unavailable)
---------------------------------------------------------
```

Omit sections with zero items. At advisory tier (no ledger file), generate from conversation context and note the output is from memory, not file.
