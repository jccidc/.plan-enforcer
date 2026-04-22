---
name: plan-enforcer-report
description: "Use when reviewing archived Plan Enforcer runs --- summarizes clean vs messy completions, drift, decisions, and archived run details."
---

# Report

Use this when the user wants to inspect completed Plan Enforcer runs.

If the installed CLI is available, prefer running `node ~/.claude/skills/plan-enforcer/src/report-cli.js .plan-enforcer/archive` so the output matches the shared formatter exactly.

## Modes

- Archive directory: summarize total runs, clean vs unverified completions, drift events, decisions, and archived run list.
- Single archive file: show source plan, tier, result, skipped items, unverified tasks, and decision log.

## Behavior

- Default to `.plan-enforcer/archive` when no path is provided.
- If no archives exist, say so plainly.
- Preserve archive filenames and task IDs exactly.
- Do not fabricate quality judgments beyond the recorded archive result and ledger contents.
