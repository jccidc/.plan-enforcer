---
name: plan-enforcer-draft
description: "Use when the user wants Plan Enforcer to create an implementation plan first --- drafts a concrete markdown plan in docs/plans/ that can immediately flow into Plan Enforcer's normal ledger and execution path."
---

# Plan Enforcer Planner

Use this when the user does not already have a plan file and wants Plan Enforcer to generate one before execution.

## Goal

Create a normal markdown execution plan that:
- lives in `docs/plans/`
- is readable by a human
- can be enforced by the existing Plan Enforcer flow without translation

This is an optional on-ramp, not a replacement for GSD, Superpowers, or user-authored plans.

## Planning Rules

When drafting the plan:

1. Write the plan to `docs/plans/<date>-<slug>.md` unless the user names a path.
2. Use concrete, ordered tasks.
3. Each task must be specific enough to execute without guesswork.
4. Include a verification method for each task or subtask.
5. Include explicit assumptions and out-of-scope notes when they matter.
6. Prefer a format already supported by Plan Enforcer auto-detection:
   - `### Task N:`
   - `## Task N:`
   - Markdown checklist
7. Do not execute the plan while drafting it unless the user explicitly asks for execution too.
8. Include a `## Must-Haves` section before the tasks. Must-haves are the user-visible outcomes the plan must deliver for the phase to be considered done. They are goal-backward: if every task ran to completion, do the must-haves actually hold?
   - Label each as `MH1`, `MH2`, ... so downstream tasks can cite them in Evidence/Chain cells
   - Keep them user-outcome framed (not implementation detail)
   - 3-7 must-haves per plan is typical; fewer means under-specified, more means the plan is probably two plans
   - `plan-enforcer-verify` reads this section at phase close to check each MH is covered by at least one verified task row
   - if awareness is active, append `A:I<n>` / `A:R<n>` refs to each must-have line so verify can trace the outcome back to captured intent
9. Before drafting, run `plan-enforcer-awareness capture-latest --if-empty` so a concrete request always seeds at least one intent row.
10. If awareness is active, annotate each task title with the same `A:I<n>` / `A:R<n>` refs it is meant to satisfy. These inline refs are for ledger seeding, not prose decoration.

## Recommended Output Shape

Prefer this structure:

```md
# <Plan Title>

**Goal:** <what changes>
**Constraints:** <important limits>
**Out of scope:** <what is not included>

## Must-Haves

- MH1: <what the finished plan must deliver - user-visible outcome> A:I1
- MH2: <next must-have> A:I2
- MH3: <next must-have> A:R1

### Task 1: <task name> A:I1
- [ ] <step>
- [ ] <verification>

### Task 2: <task name> A:I2
- [ ] <step>
- [ ] <verification>
```

This keeps the plan compatible with existing detectors while staying easy to review.

## Handoff To Enforcement

After writing the plan:
- tell the user the plan path
- explain that they can now execute that plan with Plan Enforcer
- if they asked for an end-to-end flow, proceed into execution against that exact file

## Consume the combobulate packet

Before drafting, check for `.plan-enforcer/combobulate.md`. If it
exists and is recent (mtime < 24h) and the current request overlaps
with its scope:

- Read it first. Treat it as an intent packet, not a loose summary.
- Mirror packet intent into the plan header:
  - `Normalized Goal` -> `Goal`
  - `Constraints` -> `Constraints`
  - `Out of Scope` -> `Out of scope`
- Preserve `Non-Negotiables` by covering them in `Must-Haves` and
  task verification.
- Preserve `Rejected / Forbidden Narrowings` by avoiding task sets
  that silently simplify the ask.
- Preserve `Proof Requirements` by mapping them into concrete
  verification steps or evidence rows.
- Use `Draft Handoff` only as shape guidance. It is not already a
  task list.
- Do not silently change scope decisions the packet made. If the
  request needs to change scope, surface it and ask.
- If the packet does not exist or is stale, proceed without it; do
  not block on combobulate when the request is already concrete.

## Anti-rationalization table

A draft fails review if any task reads like the LEFT column. Rewrite
into the RIGHT column shape before handing off. `plan-enforcer-review`
will flag these patterns and block phase close in `--strict`.

| Disqualifying phrase (stop and rewrite) | Fix shape |
|------------------------------------------|-----------|
| "TBD" / "TODO" / "?" as a task step | Either resolve the decision now (cite which option and why) or hoist to a Decision Log pivot row - never ship with the unknown embedded in the plan |
| "Add error handling" | Name the failure modes: `handle ECONNREFUSED with 3x exponential backoff, surface as 503 to caller`. Error handling without enumeration is decoration. |
| "Similar to Task N" | Copy the actual steps. "Similar" means the reader has to compare two places and guess which details transferred. |
| "Clean up" / "refactor" / "improve" with no target | Name the concrete end state: `extract auth-middleware.js; replace 3 call sites in src/routes/*.js` |
| "Make it faster" / "optimize X" | Cite the measurement: `reduce p95 /api/search latency from 420ms to <150ms under 50 rps`. No number = not a task. |
| "Handle edge cases" | List them: `empty string input, input longer than 10k chars, UTF-8 surrogates`. "Edges" are fog; each case is a sub-step. |
| "If needed" / "as appropriate" / "where relevant" | Delete the conditional and either include or exclude the work explicitly. Optional tasks are how plans silently shrink. |
| "Ensure X works" / "verify X is correct" without a method | Name the verification: test file, CLI command, commit SHA, or manual check with expected output. |
| "Thoroughly" / "comprehensively" / "robustly" | Decoration. Delete the adverb or replace with a concrete bound. |
| "Etc" / "and so on" / "..." | List every case or cut the open-endedness. Every "etc" is a task the executor will silently drop. |

### Positive shape examples

Not this:
> Task 2: Clean up the auth middleware and add proper error handling.
> - [ ] Refactor for readability
> - [ ] Handle edge cases
> - [ ] Ensure it works with existing tests

This:
> Task 2: Extract token-verify into src/auth/verify-token.js
> - [ ] Move `verifyJwt()` out of `src/auth/middleware.js` into new file `src/auth/verify-token.js`
> - [ ] Export as `{ verifyToken }`; update 3 call sites in `src/routes/{api,admin,webhooks}.js`
> - [ ] Extend `verifyToken` to surface `jwt.TokenExpiredError` as HTTP 401 with `{ code: 'token_expired' }` (currently rethrows as 500)
> - [ ] Verification: `node --test tests/auth/verify-token.test.js` passes; existing middleware tests green

## Guardrails

- Do not build a heavyweight project management structure
- Do not invent phases, rituals, or roleplay unless the user asked for them
- Do not silently trim requirements to make the plan easier
- If the request is too vague, surface assumptions clearly in the plan
