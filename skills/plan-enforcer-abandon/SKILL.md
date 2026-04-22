---
name: plan-enforcer-abandon
description: "Abandon the active Plan Enforcer plan in one command. Use when you have decided to stop working on the current plan (scope changed, priorities moved, you pivoted). The command records the abandonment in the Decision Log, emits a closure receipt into the walkable audit chain, archives the full ledger so you can look it up months later, and clears the active slot so the next discuss or import starts clean."
---

# Abandon Plan

Retire the active Plan Enforcer plan cleanly. When you are mid-plan and you change your mind, this replaces the multi-step manual dance (hand-write a Decision Log row covering every non-terminal task, rewrite the ledger, move it to the archive dir, fight the schema guard) with a single command.

## When to use

Invoke this skill when:

- You are mid-plan and decide to stop working on it entirely.
- A higher-priority pivot has appeared and the current plan is not going to land.
- The plan was misconceived and needs to be abandoned cleanly before a new plan is drafted.
- You want an audit-grade record of why the plan stopped, preserved on disk for future reference.

Skip this skill when the plan is already fully closed (use the normal close flow; abandon refuses on a fully-terminal ledger) or when you only want to reorder remaining tasks (edit the ledger directly; abandon is for ending the plan, not reshaping it).

## How it runs

Prefer the installed CLI when available:

```
plan-enforcer-abandon --reason "scope changed -- pivoting to auth migration"
```

If the installed wrapper is not on PATH, invoke the CLI directly:

```
node "$HOME/.claude/skills/plan-enforcer/src/abandon-cli.js" --reason "<why>"
```

The `--reason` flag is required. The required reason is sole authorization -- there is no `--force` flag and no interactive confirm prompt. The reason is the act of abandonment being logged; if you cannot state why, do not abandon.

Exit codes:

- `0` success. Two paths printed to stdout: `archive: <path>` and `receipt: <path>`.
- `2` preflight failure. Stderr names the specific reason (no ledger, empty ledger, all rows already terminal, or `--reason` missing).
- `1` unexpected failure during transformation, archive, or receipt. Stderr carries the message.

## What the command does

In order:

1. **Preflight.** Confirms an active ledger exists, that at least one row is still non-terminal, and that `--reason` is provided.
2. **Mark remaining rows superseded.** Every non-terminal task row is flipped to `superseded` with evidence `abandoned: <reason>`. Already-terminal rows (verified, skipped, blocked) are left unchanged as part of the historical record.
3. **Log the pivot.** A new Decision Log row with type `pivot` is appended, scoped to the list of T-IDs that were flipped, with reason `Plan abandoned: <reason>`.
4. **Emit a closure receipt.** The shipped receipt pipeline runs against the transformed content. The resulting receipt lands at `.plan-enforcer/proof/closure-<slug>-<utc-iso>.md` and its `Prior closure` section links to any earlier receipt for the same plan-slug, preserving the walkable chain.
5. **Archive the ledger.** The full transformed ledger is written to `.plan-enforcer/archive/<utc-iso>-<slug>.md` with frontmatter fields describing the close.
6. **Clear the active slot.** `.plan-enforcer/ledger.md` and transient sidecar files are removed via the existing `cleanupWorkingFiles` helper.

## After abandonment

The archive file is the audit record. Six months later you can answer "I wonder what that plan was" without git archaeology:

- Open `.plan-enforcer/archive/<iso>-<slug>.md` directly. The file is the full human-readable ledger: scoreboard, task table, Decision Log (including the abandonment row), reconciliation history, and frontmatter describing the close.
- Run `plan-enforcer-report` with no arguments for a summary of every archive entry, or `plan-enforcer-report <archive-path>` to render a specific archive.

To pick up related work later, draft a new plan via `/plan-enforcer-discuss` and `/plan-enforcer-draft` referencing the archive path. There is no "unabandon" command -- the archive is the full history and a new plan is a cleaner restart.

## Anti-patterns

- Running `plan-enforcer-abandon` when you actually want to close the plan normally. A plan that is mostly complete should ride the normal auto-emission path through the plan-close hook; abandon is for stopping work, not for finishing it.
- Providing a vague reason. `--reason "done"` defeats the purpose; use the reason slot to record the actual pivot context so the audit record is useful to a future reviewer.
- Editing the archive file after creation. Archives are point-in-time records; if you need to annotate, open a new plan that references the archive path.
- Using the same reason repeatedly across different abandons. Each reason is its own row in the audit trail; reuse hides the actual history.

## See also

- `plan-enforcer-report` -- browse archive entries and render specific archives.
- `plan-enforcer-receipt` -- the underlying closure-receipt surface; abandon uses it internally.
- `plan-enforcer-discuss` / `plan-enforcer-draft` -- start a fresh plan after abandonment.
