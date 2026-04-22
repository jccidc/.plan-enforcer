---
name: plan-enforcer-config
description: "Use when changing Plan Enforcer settings --- switch enforcement tier, adjust reconciliation interval, set completion gate mode, or view current configuration"
---

# Config

Read `.plan-enforcer/config.md`. If missing, create with defaults:

```yaml
---
tier: structural
reconcile_interval: 25
stale_threshold: 10
completion_gate: soft
ledger_path: .plan-enforcer/ledger.md
---
```

## Args

Parse from user message: `--tier`, `--reconcile-interval`, `--stale-threshold`, `--completion-gate`.

| Param              | Values                               | Default    |
|--------------------|--------------------------------------|------------|
| tier               | advisory, structural, enforced       | structural |
| reconcile_interval | tool-call count between sweeps       | 25         |
| stale_threshold    | tool-call count before stale warning | 10         |
| completion_gate    | soft (warn), hard (block completion) | soft       |

## Behavior

- Update only the values the user specified; leave the rest unchanged.
- If the installed CLI is available, prefer running `node ~/.claude/skills/plan-enforcer/src/config-cli.js .plan-enforcer/config.md ...` so the output matches the shared formatter exactly.
- If tier changes to/from **enforced**: explain that hooks will be installed/removed and ask user to confirm before writing.
- After any change, display the full current config.
- If no args provided: display current config, no changes.
