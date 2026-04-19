# Try It

Want to see Plan Enforcer in action before using it on real work? After installing, open any project that has a plan file and start Claude Code:

```bash
cd your-project/
claude
```

That's it. The SessionStart hook auto-detects your plan, generates the ledger, and injects the protocol. Just tell Claude to execute the plan:

```
Execute docs/plans/<plan-file>.md
```

No special commands. No configuration. Plan Enforcer handles the rest -- you'll see the Plan Enforcer scoreboard appear after each task completes.

## Don't have a plan file yet?

Use the optional built-in planner or one of the included benchmarks to test drive.

### Planner flow

Discuss the ask first when it is fuzzy, mixed, or likely to drift:

```bash
plan-enforcer discuss "Keep roadmap edits narrow and do not snap back to stale archived text"
```

Draft a plan from a goal:

```text
Use the `plan-enforcer-draft` skill to create a plan for "<goal>" in docs/plans/
```

Review the draft before execution:

```text
Use plan-enforcer-review on docs/plans/<generated-plan>.md
```

Or run the shared formatter directly:

```bash
plan-enforcer-review docs/plans/<generated-plan>.md
```

Then execute the generated file:

```text
Execute docs/plans/<generated-plan>.md
```

### Benchmark plan flow

```bash
# Copy a sample plan into any project
cp path/to/plan-enforcer/benchmarks/plans/simple-8-tasks.md ./docs/plans/

# Start Claude Code
claude
```

Then tell it: `Execute docs/plans/simple-8-tasks.md`

## Shared CLI commands

For active ledgers, the shared commands are:

```bash
plan-enforcer-status
plan-enforcer-logs
plan-enforcer-config
```

To update config from the CLI:

```bash
plan-enforcer-config --tier enforced --completion-gate hard
```
