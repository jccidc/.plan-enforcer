# Try It

Want to see Plan Enforcer in action before using it on real work?
After installing, open any project that has a plan file and start
Claude Code:

```bash
cd your-project/
claude
```

Then tell Claude:

```text
Execute docs/plans/<plan-file>.md
```

That is enough for the normal path. SessionStart auto-detects the plan,
generates the ledger, and injects the runtime protocol.

## Fast start options

### 1. Bring your own plan

If you already have a markdown plan from GSD, Superpowers, or your own
workflow:

```bash
plan-enforcer import docs/plans/my-plan.md
plan-enforcer review docs/plans/my-plan.md
claude
```

Then tell Claude:

```text
Execute docs/plans/my-plan.md
```

### 2. Use the authored path

Discuss first when the ask is fuzzy, mixed, or likely to drift:

```bash
plan-enforcer discuss "Keep roadmap edits narrow and do not snap back to stale archived text"
```

Draft a plan from the goal:

```text
Use the `plan-enforcer-draft` skill to create a plan for "<goal>" in docs/plans/
```

If the goal is still ambiguous, the drafter should stop and route
through `plan-enforcer discuss` first instead of silently guessing.

Review before execution:

```bash
plan-enforcer review docs/plans/<generated-plan>.md
```

Then execute the generated file:

```text
Execute docs/plans/<generated-plan>.md
```

## Shared CLI commands

For active ledgers, the shared commands are:

```bash
plan-enforcer-status
plan-enforcer-logs
plan-enforcer-report --active
plan-enforcer-config
```

To update config from the CLI:

```bash
plan-enforcer-config --tier enforced --completion-gate hard
plan-enforcer-config --check-cmd "npm test"
```

## More examples

See [docs/examples/README.md](examples/README.md) for:

- full authored path
- bring your own plan
- composability
- resume continuity
- verify / audit / report flow
