---
name: plan-enforcer-review
description: "Use when reviewing an implementation plan before execution --- finds vague tasks, missing verification, sequencing gaps, and dependency risks so bad plans do not flow into enforcement unchanged."
---

# Plan Enforcer Review

Use this before execution when the user wants a plan quality check.

## Goal

Review a plan file or plan text and answer one question:

**Is this plan safe enough to enforce as-is?**

Plan Enforcer should not blindly enforce weak plans. Review first when quality is uncertain.

## What To Check

Look for:
- vague tasks ("cleanup", "improve", "refactor" without a concrete target)
- missing verification steps
- tasks that are too broad or hide multiple changes
- sequencing risks (ship/deploy before verification)
- migration/integration work without explicit dependencies
- missing guardrails such as assumptions, constraints, or out-of-scope notes
- docs/examples that look like plan tasks but are not meant to execute
- drift from `.plan-enforcer/discuss.md` (or legacy
  `.plan-enforcer/combobulate.md`) when an intent packet exists:
  - dropped non-negotiables
  - missing proof requirements
  - forbidden narrowings adopted by the plan
  - goal text that no longer preserves the normalized goal

## Output Shape

Start with a verdict:
- `pass` -- safe to execute
- `weak` -- executable, but needs edits first
- `unsafe` -- do not execute yet

Then list findings in severity order with concrete fixes.

Preferred structure:

```text
Verdict: weak

Findings:
- T2 is vague: "Improve backend" -> name the exact subsystem and intended behavior
- T3 has no verification step -> add a concrete check, test, or manual proof
- Deploy appears before verification -> move release after the proving step

Auto-repair suggestions:
- Rewrite T2 as: "Update the Express auth middleware to reject expired sessions."
- Add under T3: "- [ ] Verify `npm test -- auth` passes"

Suggested repair block:
<small rewritten task block or concise guidance>
```

## Behavior

- If the user provides a path, read that plan.
- If the user provides inline plan text, review it directly.
- If the installed CLI is available, prefer running `node ~/.claude/skills/plan-enforcer/src/review-cli.js <plan-path>` so the verdict, findings, and repair block match the shared formatter exactly.
- When reviewing a file path, first look for
  `.plan-enforcer/discuss.md`, then fall back to the legacy
  `.plan-enforcer/combobulate.md` near the repo root, and treat
  packet-to-plan drift as a first-class review finding.
- If the plan is weak or unsafe, propose the minimum repair needed.
- Prefer specific replacement text over abstract advice when you can.
- If one or two tasks are broken, rewrite just those tasks.
- If the whole plan is weak, provide a short repair block the user can paste back into the plan.
- Always include a `Suggested repair block:` section when the verdict is `weak` or `unsafe`.
- Do not execute the plan while reviewing it unless the user explicitly asks for both review and execution.

## Positioning

This is not a heavyweight planning framework.
It is a guardrail:
- planner drafts the plan
- review checks the plan
- enforcer keeps execution honest
