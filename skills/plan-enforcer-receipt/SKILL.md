---
name: plan-enforcer-receipt
description: "Emit a Plan Enforcer closure receipt against the current ledger. Use when you want an on-demand receipt (plan still open or already closed), or to snapshot progress mid-flight. Auto-emission on plan close is handled by the post-tool-use plan-close hook; this skill is for explicit requests."
---

# Closure Receipt

Emit a markdown closure receipt against the current Plan Enforcer ledger. Receipts are standardized audit artifacts derived from `.plan-enforcer/ledger.md`. Every emission is preserved as its own timestamped file under `.plan-enforcer/proof/closure-<plan-slug>-<utc-iso>.md`, and each receipt references its prior closure for the same plan-slug so the directory forms a walkable audit chain.

## When to use

Invoke this skill in any of these cases:

- The user wants a receipt right now against the current ledger state -- whether the plan is closed or still in flight.
- The user wants to snapshot mid-flight progress as a durable artifact (for example, before a long interruption).
- The auto-emission hook failed to fire (for whatever reason) and a closed plan needs its receipt backfilled.
- The user explicitly requested an on-demand emission via `/plan-enforcer-receipt` or by asking for a closure receipt.

Skip this skill when the plan is actively closing under normal execution and the `hooks/plan-close.js` auto-emission path will fire. That path produces the canonical on-close receipt without explicit invocation.

## How it runs

Prefer the installed CLI when available:

```
plan-enforcer-receipt
```

If the installed wrapper is not on PATH, fall back to invoking the CLI directly:

```
node "$HOME/.claude/skills/plan-enforcer/src/receipt-cli.js"
```

The CLI accepts:

- `--plan-slug <slug>` to override the slug derived from the ledger's source plan path.
- `--out <path>` to write the receipt to an explicit path rather than the default proof directory.
- `--closed-only` to exit non-zero when any task is still pending (useful for CI-style guards that only want receipts against closed plans).
- `--open-ok` (default behavior) to tolerate an open ledger and emit a mid-flight snapshot.
- `--help` for the usage string.

On success the CLI prints the receipt's absolute path to stdout and exits 0. On a malformed or missing ledger it prints a single-line error to stderr and exits non-zero.

## What the receipt contains

Every receipt is assembled from the ledger and follows one standardized section order. The sections are, in order:

1. Header with plan source, close timestamp, and tier.
2. **Prior closure** -- either a markdown link to the immediately-prior receipt for the same plan-slug, or the literal text "none (first close of this plan)". This is the walkable-chain entry point.
3. Status scoreboard snapshot.
4. Task ledger (every non-superseded row with ID, task name, status, evidence).
5. Decision Log summary (every D-row with ID, type, scope, short reason).
6. Reconciliation history (every R-row).
7. Files changed (`git diff --stat HEAD` output, or an "unavailable" note when git is absent).
8. Blocked / open coordination (every blocked row with notes).
9. Proof artifacts (every existing file under `.plan-enforcer/proof/` at emission time).
10. Plan-specific extras (only populated when the source plan exposes a Must-Haves or Proof Requirements section; otherwise skipped).

The receipt is ASCII-only. No unicode box-drawing, no smart quotes, no em-dashes -- hyphens and `--` are used throughout.

## Interaction with auto-emission

The `hooks/plan-close.js` PostToolUse hook watches the ledger for close-transition edits. When the last non-terminal task flips to a terminal status (verified, skipped, blocked, or superseded), the hook calls the same CLI automatically. A successful auto-emission records the closure hash at `.plan-enforcer/.last-close-hash` so a subsequent no-op edit on the already-closed ledger does not emit a duplicate receipt.

Explicit invocations through this skill are independent of the auto-emission idempotence -- every `/plan-enforcer-receipt` call emits a fresh file. If the user wants to capture an intermediate snapshot after a close has already been auto-recorded, this skill is the correct path.

## Anti-patterns

- Editing an existing receipt to reflect a later state. Receipts are point-in-time artifacts; emit a new one for the later state and let the Prior closure chain connect them.
- Overwriting a receipt filename to collapse history. If the CLI detects a same-millisecond filename collision, it appends `-2`, `-3`, and so on to preserve every emission.
- Manually copying receipts out of `.plan-enforcer/proof/`. The audit chain assumes receipts live there so that `findPriorClosure` can walk the directory. Relocate only after the plan is truly retired.
