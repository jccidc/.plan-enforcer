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

Routes to each sub-CLI's `main()`. `--help` lists all 15 subcommands;
per-subcommand help is `plan-enforcer <sub> --help`.

---

## plan-enforcer-abandon

```
plan-enforcer-abandon --reason "<text>"
```

Retire the active plan in one shot. Marks every non-terminal task row
as `superseded` with evidence `abandoned: <reason>`, appends a
`pivot`-typed Decision Log row citing those T-IDs, emits a closure
receipt that joins the walkable chain for the plan-slug, archives the
transformed ledger to `.plan-enforcer/archive/<utc-iso>-<slug>.md`,
and removes the active `.plan-enforcer/ledger.md` so the next
`discuss` or `import` starts clean.

`--reason` is required and is sole authorization -- there is no
interactive confirm prompt and no `--force` flag. If you cannot name
why, do not abandon. On success both paths are printed to stdout
(`archive: <path>` then `receipt: <path>`).

Exit codes:

- `0` success; archive + receipt written, active ledger removed
- `2` preflight failure (missing ledger, empty ledger, every row
  already terminal, or `--reason` missing); no files mutated
- `1` unexpected failure during transform / archive / receipt

To browse archived plans later, use `plan-enforcer-report` with no
arguments for a summary or `plan-enforcer-report <archive-path>` to
render a specific archive.

---

## plan-enforcer-doctor

```
plan-enforcer-doctor [--json]
plan-enforcer doctor [--json]
```

Install / onboarding self-check.

- confirms Node >= 18
- checks installed skill surfaces under `~/.claude/skills`
- checks copied hook/runtime files for the current tier
- inspects project/global Claude Code hook settings
- reports the next useful step for this repo

Missing `.plan-enforcer/config.md` is onboarding state, not install
failure: `doctor` now points you at `discuss` / `import` first and only
offers rerunning `./install.sh` as an optional local-config shortcut.

`--json` emits the same result as structured machine-readable output.

---

## plan-enforcer-import

```
plan-enforcer-import [--tier advisory|structural|enforced] [--force] <plan-path>
plan-enforcer import <plan-path>
```

Seeds `.plan-enforcer/ledger.md` from an existing markdown plan file
using the same detector/generator path as auto-activation.

- preserves existing config unless `--tier` overrides it
- refuses to overwrite an existing active ledger unless `--force`
- supports checklist / task-header / known imported plan shapes that
  `plan-detector` already understands

## plan-enforcer-status

```
plan-enforcer-status [ledger-path]
plan-enforcer status
```

Prints the scoreboard (counts), current task, unverified rows, blocked
rows, and a short `Operator Next` block for the highest-signal follow-up
action. When awareness is initialized, status also prints a compact
awareness summary: live intents, linked intents, orphan count, and
quote-provenance issue count. Zero args = active ledger at
`.plan-enforcer/ledger.md`.

If no active ledger exists, status tells you how to start one:
`/plan-enforcer <plan-file>` or `plan-enforcer import <plan-file>`.

## plan-enforcer-receipt

```
plan-enforcer-receipt [options]
```

Emits a markdown closure receipt against the active ledger. Every
emission is preserved as its own timestamped file under
`.plan-enforcer/proof/closure-<plan-slug>-<utc-iso>.md`, and each
receipt links to its prior closure for the same plan-slug so the
directory forms a walkable audit chain.

Auto-emission on plan close is handled by the `plan-close.js`
PostToolUse hook; this CLI is for on-demand emission (mid-flight
snapshots, backfills, or explicit audit points). Options:

- `--plan-slug <slug>` override slug derived from ledger metadata
- `--out <path>` write to an explicit path instead of the proof dir
- `--closed-only` exit non-zero if any task is still pending
- `--open-ok` tolerate open ledger (default)
- `--help` print usage

On success the CLI prints the receipt path to stdout and exits 0.

## plan-enforcer-logs

```
plan-enforcer-logs [ledger-path]
plan-enforcer logs
```

Full audit log for the active ledger - skipped tasks, drift events,
reconciliation history, decision log. When awareness is initialized,
logs also prints orphan-intent detail and quote-provenance findings.
If no active ledger exists, logs prints the same explicit start/import
guidance as `status`.

## plan-enforcer-report

```
plan-enforcer-report
plan-enforcer-report --active
plan-enforcer-report [archive-path]
plan-enforcer report
```

Session report surface.

- with an active ledger present, zero args now report current session
- `--active` forces active-session report
- with an archive path, report summarizes archived runs or one archived
  file

Active mode also includes an `Operator Next` block plus the same
executed-verification, git, awareness, and phase-verify summaries shown
by `status`. Use active mode for live operator handoff. Use archive mode
for historical session review.

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

`capture-latest --if-empty` is the `discuss`/draft-safe bootstrap:
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
