---
name: plan-enforcer-logs
description: "Use when reviewing Plan Enforcer audit trail --- shows skipped tasks, drift events, decision log, reconciliation history, and unverified items"
---

# Logs

Read `.plan-enforcer/ledger.md`. If missing: "No active Plan Enforcer session."

If the installed CLI is available, prefer running `node ~/.claude/skills/plan-enforcer/src/logs-cli.js .plan-enforcer/ledger.md` so the output matches the shared formatter exactly.

## Display

Print every tracking section from the ledger:

```
---🛡️Plan Enforcer Logs --------------------------------

🛡️SKIPPED TASKS:
  T4  Write integration tests --- Blocked on DB fixtures (D1)

🛡️DRIFT EVENTS:
  src/utils/helper.ts modified --- not in any task (D2)

🛡️DECISION LOG:
  D1  T4 skipped --- DB fixture setup blocked, revisit after T12
  D2  T7 expanded --- added helper util, not originally planned

🛡️RECONCILIATION HISTORY:
  R1  T1-T3   0 gaps    Proceeded
  R2  T4-T6   1 gap     Logged D1
  R3  T7-T8   1 drift   Logged D2

🛡️UNVERIFIED (done but no evidence):
  T3  Add session storage --- needs test or artifact link
---------------------------------------------------------
```

Omit sections with zero entries. Preserve original IDs (D1, R1, etc.) from ledger. If a section is missing from the ledger file, skip it silently --- do not fabricate entries.
