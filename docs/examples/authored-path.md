# Example - Authored path

Use this when you want Plan Enforcer to own the whole authorship chain.

## Flow

```bash
plan-enforcer discuss "Keep roadmap edits narrow and preserve the active source of truth"
```

Then in Claude Code:

```text
Use `plan-enforcer-draft` to write a plan in docs/plans/
Use `plan-enforcer-review` on the generated file
Execute the reviewed plan
```

## What you get

- `.plan-enforcer/discuss.md`
- `.plan-enforcer/ledger.md`
- Decision Log + Reconciliation History
- `plan-enforcer verify --with-awareness`
- `plan-enforcer audit --strict`
- `plan-enforcer report --active`

Use this path when the ask is fuzzy, mutation-prone, or high-risk.
