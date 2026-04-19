# Plan Enforcer — CLI Reference

Every command below is available two ways:

- as a standalone bin (`plan-enforcer-chain T5`)
- through the unified dispatcher (`plan-enforcer chain T5`)

The dispatcher is the discoverable front door (`plan-enforcer --help`
lists every subcommand). The standalone bins exist for muscle memory
and shell script use.

All commands default to `.plan-enforcer/ledger.md` relative to the
current working directory. Pass `--ledger <path>` or `--cwd <path>`
to target a different project.

## Exit code convention

| Code | Meaning                                                          |
|------|------------------------------------------------------------------|
| 0    | success or informational clean result                            |
| 1    | the command ran but the result is "not found" / "has findings" / verification failed |
| 2    | configuration error (no ledger, bad args, unsupported format)    |

Use `plan-enforcer-audit --strict` in CI: it exits 1 on *any* finding
(errors or warnings), suitable as a required check.

---

## plan-enforcer (dispatcher)

```
plan-enforcer <subcommand> [args...]
plan-enforcer --help
plan-enforcer --version
```

Routes to each sub-CLI's `main()`. `--help` lists all 13 subcommands;
per-subcommand help is `plan-enforcer <sub> --help`.

---

## plan-enforcer-status

```
plan-enforcer-status [ledger-path]
plan-enforcer status
```

Prints the scoreboard (counts), current task, unverified rows, and
blocked rows. When awareness is initialized, status also prints a
compact awareness summary: live intents, linked intents, orphan count,
and quote-provenance issue count. Zero args = active ledger at
`.plan-enforcer/ledger.md`.

## plan-enforcer-logs

```
plan-enforcer-logs [ledger-path]
plan-enforcer logs
```

Full audit log for the active ledger — skipped tasks, drift events,
reconciliation history, decision log. When awareness is initialized,
logs also prints orphan-intent detail and quote-provenance findings.

## plan-enforcer-report

```
plan-enforcer-report
plan-enforcer report
```

End-of-session summary report. Intended for `session-end` hooks or
manual session handoff.

## plan-enforcer-review

```
plan-enforcer-review <plan-file>
plan-enforcer review <plan-file>
```

Static review of a plan-file draft. Flags vague tasks, missing
verification, unclear sequencing. Does not touch the ledger.

## plan-enforcer-verify

```
plan-enforcer-verify [--ledger <path>] [--plan <path>] [--with-awareness] [--awareness <path>] [--json]
plan-enforcer verify
```

Goal-backward check. Reads `## Must-Haves` from the plan source,
scores each must-have against the ledger (PASS / PARTIAL / UNKNOWN),
exits 0 when every MH passes, 1 when any fails, 2 on config error.

Must-haves are tagged `MH1`, `MH2`, …; verify searches task Evidence,
Chain, and Notes, plus Decision Log scope / reason / evidence, for
that tag.

`--with-awareness` adds two more checks:

- each must-have line needs at least one linked `A:I<n>` / `A:R<n>`
  ref in its own text
- each live intent in `.plan-enforcer/awareness.md` needs either a
  must-have target or a valid task Chain target

Finding codes added by awareness mode:
- `MH_NO_INTENT_LINK`
- `INTENT_NO_TARGET`

## plan-enforcer-awareness

```
plan-enforcer-awareness list [--all] [--json] [--cwd <path>] [--awareness <path>]
plan-enforcer-awareness orphans [--json] [--cwd <path>] [--awareness <path>] [--ledger <path>]
plan-enforcer-awareness task <Tn> [--json] [--cwd <path>] [--awareness <path>] [--ledger <path>]
plan-enforcer-awareness capture-latest [--if-empty] [--json] [--cwd <path>] [--awareness <path>] [--user-messages <path>]
plan-enforcer-awareness add --intent "<quote>" [--source <source>] [--json] [--cwd <path>] [--awareness <path>]
plan-enforcer-awareness link <Tn> <Im>[,In] [--json] [--cwd <path>] [--ledger <path>]
plan-enforcer awareness <subcommand> ...
```

Intent-chain tools. `list` shows current live intents, `orphans` shows
intents with no plausibly linked task, `task` resolves the awareness
rows behind one task, `capture-latest` appends the latest raw captured
user prompt as a new intent row, `add` appends a manual this-session
intent row, and `link` appends `A:I<n>` / `A:R<n>` tokens to a task
Chain cell.

`capture-latest --if-empty` is the draft/combobulate-safe bootstrap:
it only seeds awareness when the file has no existing intent rows.
Multi-line prompts are rejected instead of being normalized so the
stored quote stays exactly verifiable against the captured prompt log.

When the `UserPromptSubmit` hook is installed, raw prompts are captured
to `.plan-enforcer/.user-messages.jsonl`. `lint`, `audit`, and the
verified-row evidence gate then verify that non-`manual`,
non-`pre-capture` intent quotes are exact substrings of a captured
prompt.

## plan-enforcer-config

```
plan-enforcer-config
plan-enforcer-config [config-path] [--tier VALUE] [--reconcile-interval N]
                      [--stale-threshold N] [--completion-gate soft|hard|audit]
plan-enforcer config --tier enforced
```

No args = print current config. With flags = merge + persist updates.

Values and their effects documented in [`docs/config.md`](config.md).

---

## plan-enforcer-chain

```
plan-enforcer-chain <taskId> [--ledger <path>] [--cwd <path>] [--json]
plan-enforcer chain T5
```

Full audit trail for a task. Prints:

- the task row (status, evidence, notes)
- Decision Log rows scoped to the task (by `Tn` mention or Chain D-ref)
- Chain column tokens classified as decision / commit / verification / awareness / unknown
- each chain-referenced commit resolved via `git log` (short SHA + date + subject)
- Evidence cell signals (commit / file / test / session-log)

Exit codes: 0 found, 1 task not found, 2 missing ledger.

Example:

```
$ plan-enforcer chain T5
Chain for T5: src/export-cli.js — versioned JSON ledger dump
  status: verified
  ledger: .plan-enforcer/ledger.md (schema v2)

Evidence:
  src/export-cli.js; smoke roundtrip parsed back 13 tasks
    file: src/export-cli.js -> src/export-cli.js

Chain refs:
  commits: 42ce089

Decisions:
  (none — no D-row scopes this task and no D-ref in Chain)

Commits:
  42ce089  2026-04-12  P4 T5: src/export-cli.js — versioned JSON ledger dump
```

## plan-enforcer-why

```
plan-enforcer-why <file-path> [--ledger <path>] [--cwd <path>] [--json]
plan-enforcer why src/auth/middleware.js
```

Reverse lookup. Scans Decision Log scope / reason / evidence and task
row evidence / notes for any cell referencing the file (substring or
basename match).

Exit codes: 0 hits, 1 clean no-hit, 2 missing ledger.

Use when asking "why does this file look like this?"

## plan-enforcer-audit

```
plan-enforcer-audit [--ledger <path>] [--cwd <path>] [--strict] [--json]
plan-enforcer audit --strict
```

Ledger integrity check. Structural checks include:

1. unique task IDs
2. unique decision IDs
3. Chain D-refs resolve to real decisions
4. Chain commit SHAs resolve via `git rev-parse --verify`
5. verified rows carry evidence with at least one resolved signal
6. awareness intent quotes resolve against `.user-messages.jsonl`
   (unless `source: manual` or `source: pre-capture`)
7. verified rows with awareness links that are missing or lexically weak
8. done rows with resolvable evidence flagged for promote-to-verified

Warning codes: `SCHEMA_V1`, `UNRESOLVED_COMMIT`, `UNKNOWN_CHAIN_TOKEN`,
`EVIDENCE_UNRESOLVED`, `AWARENESS_QUOTE_UNVERIFIED`,
`AWARENESS_LINK_MISSING`, `AWARENESS_LINK_WEAK`, `DONE_WITH_REAL_EVIDENCE`.
Error codes: `NO_LEDGER`, `DUPLICATE_TASK_ID`, `DUPLICATE_D_ID`,
`DANGLING_D_REF`, `VERIFIED_WITHOUT_EVIDENCE`.

Exit codes: 0 clean / warnings-only in soft mode, 1 any error or
(`--strict`) any finding, 2 missing ledger.

CI snippet:

```yaml
- run: npx plan-enforcer audit --strict
```

## plan-enforcer-export

```
plan-enforcer-export [--ledger <path>] [--cwd <path>] [--format=json] [--pretty]
plan-enforcer export --pretty > ledger.json
```

Versioned JSON dump. Stable schema under `schemaVersion: 1`. Contains
metadata, stats, tasks, decisions, reconciliations. `--pretty` indents;
default is compact for `jq` pipelines.

Exit codes: 0 success, 2 config error (bad format, missing ledger).

## plan-enforcer-lint

```
plan-enforcer-lint [--ledger <path>] [--cwd <path>] [--json]
plan-enforcer lint
```

Shape validator (not a semantics checker — that's audit). Verifies:

- `<!-- schema: vN -->`, `source`, `tier` metadata comments present
- `## Scoreboard`, `## Task Ledger`, `## Decision Log` sections exist
- Task and Decision Log header rows match the schema version
- Every task row has the expected cell count for the schema
- Every D-row has the expected cell count
- Non-`manual`, non-`pre-capture` awareness quotes appear verbatim in
  `.plan-enforcer/.user-messages.jsonl`

Exit codes: 0 well-formed, 1 any finding, 2 missing ledger.

Finding codes include: `MISSING_SCHEMA_COMMENT`, `MISSING_SECTION`,
`TASK_HEADER_MISMATCH`, `D_HEADER_MISMATCH`, `TASK_ROW_CELL_COUNT`,
`D_ROW_CELL_COUNT`, `AWARENESS_QUOTE_UNVERIFIED`.

---

## Typical workflows

**After a task you suspect of drift:**

```bash
plan-enforcer chain T5        # what did T5 produce?
plan-enforcer audit           # anything structurally off?
```

**When a file surprises you:**

```bash
plan-enforcer why src/something.js
```

**Before merging a PR:**

```bash
plan-enforcer lint && plan-enforcer audit --strict && plan-enforcer verify
```

**Exporting the ledger for a dashboard:**

```bash
plan-enforcer export --pretty > .artifacts/ledger.json
```
