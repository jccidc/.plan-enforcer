# Plan Enforcer — Configuration Reference

Plan Enforcer reads its behavior from `.plan-enforcer/config.md` inside
the project root. The file is generated on first activation with sensible
defaults and can be edited directly or through the `plan-enforcer-config`
CLI.

## Keys

| Key                   | Default       | Accepted values                              |
|-----------------------|---------------|----------------------------------------------|
| `tier`                | `structural`  | `advisory`, `structural`, `enforced`         |
| `reconcile_interval`  | `25`          | positive integer (tool calls)                |
| `stale_threshold`     | `10`          | positive integer (minutes)                   |
| `completion_gate`     | `soft`        | `soft`, `hard`, `audit`                      |
| `ledger_path`         | `.plan-enforcer/ledger.md` | file path relative to project root |

## Tier semantics

Three levels of strictness. Same knob used by every hook in the
`chain-guard`, `delete-guard`, `evidence-gate`, and `session-end`
family.

| Tier           | Chain-guard / delete-guard / evidence-gate | Use when                          |
|----------------|---------------------------------------------|-----------------------------------|
| `advisory`     | Audit-only. Every tool call is recorded in the session log; hooks never block or warn. | You want visibility without friction (onboarding, exploration). |
| `structural`   | Warn on soft violations, block on hard integrity breaks (deletions without a `delete` D-row, evidence without a resolvable signal). Default. | Most day-to-day work. Mistakes surface before they drift. |
| `enforced`     | Block on every violation. Unplanned edits, undocumented deletions, and verified rows without evidence signals all stop the tool call until a typed Decision Log row covers the case. | CI runs, production-adjacent repos, or any time you explicitly want the agent to prove its reasoning. |

Flip via CLI:

```
plan-enforcer-config --tier enforced
# or via dispatcher
plan-enforcer config --tier advisory
```

## Reconcile interval

`reconcile_interval` is the number of tool calls between prompted
reconciliation sweeps (the `session-start` / `post-tool` pair surface
the prompt, Claude does the sweep and records an `R<n>` row). Default
25 — low enough to catch drift inside a single feature, high enough
that it doesn't stutter during a dense edit run. Typical overrides:

- Long-session code reviews: raise to `40-50`
- High-stakes compliance work: drop to `15`

## Stale threshold

`stale_threshold` is the minute count used by the stale-ledger
detector in `session-start`. If the ledger's mtime is older than N
minutes *and* the project has newer files in `src/` / `hooks/` /
`tests/`, the detector warns that unreported work exists. Default 10.

## Completion gate

The completion gate governs what `hooks/session-end.js` does when it
sees a session closing with pending / in-progress / done-without-
evidence rows. Three modes:

| Mode    | Intended behavior                                                                                 | Use when                                 |
|---------|---------------------------------------------------------------------------------------------------|------------------------------------------|
| `soft`  | Print a warning listing unfinished rows. Session closes normally. Default.                       | Everyday work, WIP is expected.          |
| `hard`  | Refuse to close the session until every task row is `verified`, `skipped`, or `blocked`. Forces a decision before the agent hands control back. | You explicitly want the agent to either finish or explicitly punt, never leave silent TODO. |
| `audit` | Like `soft` — never blocks — but emits a structured audit record of every unfinished row for CI / dashboard consumption. | CI / compliance contexts where you need a paper trail without blocking developer flow. |

Flip via CLI:

```
plan-enforcer-config --completion-gate hard
plan-enforcer-config --completion-gate audit
plan-enforcer-config --completion-gate soft      # restore default
```

The value is stored in `.plan-enforcer/config.md`, read by
`session-end.js` on every session close, and surfaced by
`plan-enforcer-config` (no argument prints the current config).

**Current implementation status.** All three modes are live in
`hooks/session-end.js`:

- `soft` — existing warn-only behavior; session closes regardless of
  unfinished rows.
- `hard` — scans the ledger on session close; if any row is not in a
  terminal status (`verified`, `skipped`, `blocked`, `superseded`),
  the hook exits 2 and refuses to let the session close. Lists up to
  20 offending rows with their IDs and current status.
- `audit` — same scan but never blocks. Appends a JSON line to
  `.plan-enforcer/.audit-log.jsonl` containing the timestamp, tier,
  gate, ledger path, and the unfinished row list for CI / dashboard
  consumption. Session closes with exit 0.

Gate mode is orthogonal to tier: advisory tier with `completion_gate:
hard` is valid and useful — a team that wants light runtime
enforcement but strict end-of-session discipline.

## Reading the current config

No arguments prints the active state:

```
$ plan-enforcer-config
---Plan Enforcer Config ----------------------------
 tier: structural
 reconcile_interval: 25
 stale_threshold: 10
 completion_gate: soft
 ledger_path: .plan-enforcer/ledger.md
---------------------------------------------------
```

## File format

`.plan-enforcer/config.md` is a YAML frontmatter-style document:

```
---
tier: structural
reconcile_interval: 25
stale_threshold: 10
completion_gate: soft
ledger_path: .plan-enforcer/ledger.md
---
```

Lines are parsed via regex per key, so comments / extra whitespace
above or below the frontmatter block are ignored. Invalid values
(unknown tier, zero interval, etc) cause the CLI to print a usage
banner and exit 1; the existing config is not overwritten.
