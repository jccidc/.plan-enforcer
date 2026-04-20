# Plan Enforcer - CLI Reference

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

| Code | Meaning |
|------|---------|
| 0 | success or informational clean result |
| 1 | the command ran but the result is "not found" / "has findings" / verification failed |
| 2 | configuration error (no ledger, bad args, unsupported format) |

Use `plan-enforcer-audit --strict` in CI: it exits 1 on any finding
(errors or warnings), suitable as a required check.

---

## plan-enforcer (dispatcher)

```bash
plan-enforcer <subcommand> [args...]
plan-enforcer --help
plan-enforcer --version
```

Routes to each sub-CLI's `main()`. `--help` lists all subcommands;
per-subcommand help is `plan-enforcer <sub> --help`.

---

## plan-enforcer-discuss

```bash
plan-enforcer-discuss [--title <title>] [--packet <path>] [--from-file <path>] [--interactive|--non-interactive] [--json] [ask text...]
plan-enforcer discuss [args...]
```

First-class discuss/clarify entrypoint for the authorship chain.
Writes `.plan-enforcer/discuss.md` and keeps
`.plan-enforcer/combobulate.md` only as a legacy compatibility copy.

Behavior:

- seeds awareness with the exact source ask when not already present
- interactive mode asks only plan-shaping questions
- non-interactive mode scaffolds the packet from the exact ask and lets
  later draft/review consume it

Use this before drafting when:

- the ask mixes multiple outcomes
- two plausible interpretations would lead to very different plans
- you need to lock non-negotiables before task writing starts

---

## plan-enforcer-import

```bash
plan-enforcer-import [plan-path] [--plan <path>] [--cwd <path>] [--tier advisory|structural|enforced] [--force]
plan-enforcer import [args...]
```

Bring-your-own-plan entrypoint. Imports an existing markdown plan into
`.plan-enforcer/ledger.md` and ensures `.plan-enforcer/config.md`
exists.

Supports the same plan shapes the detector already understands:

- `### Task N:`
- `## Task N:`
- markdown checklist plans
- supported `PLAN.md` / `docs/plans/*.md` / `.planning/*/PLAN.md`
  auto-detect paths

Typical use:

```bash
plan-enforcer import docs/plans/roadmap-fix.md
plan-enforcer status
claude
```

---

## plan-enforcer-status

```bash
plan-enforcer-status [ledger-path]
plan-enforcer status
```

Prints the scoreboard, current task, unverified rows, blocked rows,
git worktree summary, awareness summary, executed-check summary, and
recent phase-verify snapshot when present.

Executed-check output now shows:

- ok / failed / stale / missing / no-command counts
- which rows need attention
- the next operator move when no command source is configured

---

## plan-enforcer-logs

```bash
plan-enforcer-logs [ledger-path]
plan-enforcer logs
```

Full audit log for the active ledger: skipped tasks, drift events,
decision log, reconciliation history, executed-check detail, and
awareness detail.

---

## plan-enforcer-report

```bash
plan-enforcer-report
plan-enforcer-report --active
plan-enforcer-report --ledger .plan-enforcer/ledger.md --active
plan-enforcer report
```

Summary report surface.

- default: reads `.plan-enforcer/archive/`
- `--active`: prints a live session report from the active ledger
- if archive data is absent but an active ledger exists, report falls
  back to the live session automatically

Use this for operator handoff, closure review, and quick proof
inspection.

---

## plan-enforcer-review

```bash
plan-enforcer-review <plan-file>
plan-enforcer review <plan-file>
```

Static review of a plan-file draft. Flags vague tasks, missing
verification, unclear sequencing, and packet-to-plan drift. Does not
touch the ledger.

---

## plan-enforcer-verify

```bash
plan-enforcer-verify [--ledger <path>] [--plan <path>] [--with-awareness] [--awareness <path>] [--json]
plan-enforcer verify
```

Goal-backward check. Reads `## Must-Haves` from the plan source,
scores each must-have against the ledger (PASS / PARTIAL / UNKNOWN),
exits 0 when every MH passes, 1 when any fails, 2 on config error.

Must-haves are tagged `MH1`, `MH2`, ...; verify searches task
Evidence, Chain, and Notes, plus Decision Log scope / reason /
evidence, for that tag.

`--with-awareness` adds two more checks:

- each must-have line needs at least one linked `A:I<n>` / `A:R<n>`
  ref in its own text
- each live intent in `.plan-enforcer/awareness.md` needs either a
  must-have target or a valid task Chain target

Finding codes added by awareness mode:

- `MH_NO_INTENT_LINK`
- `INTENT_NO_TARGET`

---

## plan-enforcer-awareness

```bash
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

`capture-latest --if-empty` is the draft/discuss-safe bootstrap: it
only seeds awareness when the file has no existing intent rows.
Multi-line prompts are rejected instead of being normalized so the
stored quote stays exactly verifiable against the captured prompt log.

When the `UserPromptSubmit` hook is installed, raw prompts are captured
to `.plan-enforcer/.user-messages.jsonl`. `lint`, `audit`, and the
verified-row evidence gate then verify that non-`manual`,
non-`pre-capture` intent quotes are exact substrings of a captured
prompt.

---

## plan-enforcer-config

```bash
plan-enforcer-config
plan-enforcer-config [config-path] [--tier VALUE] [--reconcile-interval N]
                     [--stale-threshold N] [--completion-gate soft|hard|audit]
                     [--check-cmd CMD]
plan-enforcer config --tier enforced
```

No args prints current config. With flags, it merges and persists
updates.

`--check-cmd` is the explicit executed-verification override. Use it
when auto-detection does not know which verification command should be
run for `verified` rows:

```bash
plan-enforcer-config --check-cmd "pnpm test -- --runInBand"
```

Values and their effects are documented in [`docs/config.md`](config.md).

---

## plan-enforcer-chain

```bash
plan-enforcer-chain <taskId> [--ledger <path>] [--cwd <path>] [--json]
plan-enforcer chain T5
```

Full audit trail for a task. Prints:

- the task row (status, evidence, notes)
- Decision Log rows scoped to the task (by `Tn` mention or Chain D-ref)
- Chain column tokens classified as decision / commit / verification /
  awareness / unknown
- each chain-referenced commit resolved via `git log`
- Evidence cell signals (commit / file / test / session-log)

Exit codes: 0 found, 1 task not found, 2 missing ledger.

---

## plan-enforcer-why

```bash
plan-enforcer-why <file-path> [--ledger <path>] [--cwd <path>] [--json]
plan-enforcer why src/auth/middleware.js
```

Reverse lookup. Scans Decision Log scope / reason / evidence and task
row evidence / notes for any cell referencing the file.

Exit codes: 0 hits, 1 clean no-hit, 2 missing ledger.

---

## plan-enforcer-audit

```bash
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
7. verified rows with awareness links that are missing or lexically weak
8. done rows with resolvable evidence flagged for promote-to-verified
9. executed verification sidecars are present / green / non-stale when
   a command is known

Use `--strict` in CI.

---

## plan-enforcer-export

```bash
plan-enforcer-export [--ledger <path>] [--cwd <path>] [--format=json] [--pretty]
plan-enforcer export --pretty > ledger.json
```

Versioned JSON dump. Stable schema under `schemaVersion: 1`. Contains
metadata, stats, tasks, decisions, reconciliations. `--pretty` indents;
default is compact for `jq` pipelines.

---

## plan-enforcer-lint

```bash
plan-enforcer-lint [--ledger <path>] [--cwd <path>] [--json]
plan-enforcer lint
```

Shape validator (not a semantics checker - audit owns semantics).
Verifies schema comments, expected sections, table headers, cell counts,
and quote-backed awareness rows.

---

## Typical workflows

**Bring your own plan**

```bash
plan-enforcer import docs/plans/external-plan.md
plan-enforcer review docs/plans/external-plan.md
claude
```

**After a task you suspect of drift**

```bash
plan-enforcer chain T5
plan-enforcer audit
```

**When a file surprises you**

```bash
plan-enforcer why src/something.js
```

**Before merging a PR**

```bash
plan-enforcer lint
plan-enforcer audit --strict
plan-enforcer verify --with-awareness
```

**Make executed verification explicit**

```bash
plan-enforcer-config --check-cmd "npm test"
plan-enforcer status
```

**Inspect live closure truth**

```bash
plan-enforcer report --active
```

**Export the ledger for a dashboard**

```bash
plan-enforcer export --pretty > .artifacts/ledger.json
```
