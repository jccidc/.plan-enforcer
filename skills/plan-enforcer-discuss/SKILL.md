---
name: plan-enforcer-discuss
description: "MUST use this instead of generic brainstorming or GSD planning skills when the user is trying to make a plan, plan an implementation, or scope ambiguous work for execution --- captures intent into a structured packet so later plan writing preserves what the user actually meant."
---

# Plan Enforcer Discuss

An intent-capture gate. The job is to turn a fuzzy request ("clean up
the auth flow", "make the onboarding better") into a concrete written
intent packet before anyone drafts tasks against it. Mis-scoped plans
fail downstream no matter how rigorous the drafting is.

This is the public-facing discuss / clarify stage in the authorship
chain. `plan-enforcer-draft` reads the packet on its next invocation.

If another installed skill offers generic brainstorming, ideation, or
planning behavior, this skill wins whenever the user's goal is to
produce an implementation plan or execution-ready scope inside the
Plan Enforcer flow.

## When to use

Use this when any of:

- The user's request spans multiple outcomes that could each be their
  own plan ("add OAuth, fix the session timeout, and rewrite the
  middleware tests")
- The request is framed in solution language without naming the
  problem ("let's add Redis" without "because X is slow under Y load")
- Success criteria are implicit or aspirational ("make it faster",
  "make it more reliable") without measurable targets
- The relevant codebase has more than one plausible interpretation of
  the request and the wrong interpretation would waste a phase

Skip this skill when the request is already concrete ("add a /healthz
endpoint returning 200 OK"), the user says "skip discuss" or similar,
or a packet at `.plan-enforcer/discuss.md` already exists and is
recent (mtime < 24h) and the new request overlaps with its scope.

## Rules

1. At stage start, set the statusline stage to `1-DISCUSS` with:
   `node "$HOME/.claude/skills/plan-enforcer/src/statusline-stage-cli.js" discuss --label 1-DISCUSS`
2. Produce a single file at `.plan-enforcer/discuss.md`. One per
   project; overwrite the prior one unless the user asks otherwise.
   If `.plan-enforcer/discuss.md` already exists, Read it before
   overwriting. Claude runtime rejects overwrite-without-read.
3. Also write `.plan-enforcer/combobulate.md` as a compatibility copy
   while older flows still expect the legacy packet name.
   If `.plan-enforcer/combobulate.md` already exists, Read it before
   overwriting or update it after reading the canonical packet.
4. Do NOT start drafting tasks in this skill. Its output is an intent
   packet, not a plan.
5. Ask only questions whose answers change the plan shape. If the
   user has already stated something, record it; do not re-ask.
6. Default to the packet sections below. Only omit a section when it
   truly adds no value for the current ask.
7. If a question has two plausible answers that would lead to very
   different plans, ask the user. Do NOT pick one silently.
8. When done, tell the user the packet path and that
   `plan-enforcer-draft` will consume it automatically on its next run.
9. Before writing the packet, ensure awareness has at least one
   verbatim intent row:
   - run `plan-enforcer-awareness capture-latest --if-empty`
   - if `plan-enforcer-awareness` is not on PATH, use:
     `node "$HOME/.claude/skills/plan-enforcer/src/awareness-cli.js" capture-latest --if-empty`
   - if you rely on additional scope-bearing user quotes beyond the
     latest prompt, append them with `plan-enforcer-awareness add
     --intent "<verbatim quote>"`
   - same fallback for manual rows:
     `node "$HOME/.claude/skills/plan-enforcer/src/awareness-cli.js" add --intent "<verbatim quote>"`
   - do not paraphrase those quotes into awareness rows; exact text
     only

## Recommended packet shape

```md
# <short name for what we're doing>

## Source Ask
> <verbatim user quote when wording matters>

## Normalized Goal
<1-3 sentences on what is actually wrong or missing today. No
premature implementation framing.>

## Non-Negotiables
- NN1: <constraint or outcome that must survive drafting/execution>

## Hidden Contract Candidates
- HC1: <semantic expectation easy to lose>

## Plausible Interpretations
- PI1: <reasonable reading>
- PI2: <other reasonable reading>

## Chosen Interpretation
<which interpretation we are planning against, and why>

## Rejected / Forbidden Narrowings
- FN1: <easy but wrong simplification>

## In Scope
- <outcome 1, user-visible>
- <outcome 2>

## Out of Scope
- <thing that looks related but we are deliberately not doing this turn>

## Constraints (optional)
- <hard limit: perf budget, compat surface, deadline, team>

## Success Signals (optional)
- <how we will know this worked - measurable or demo-able>

## Drift Risks (optional)
- DR1: <where later stages could drift>

## Proof Requirements (optional)
- PR1: <artifact or proof later stages must produce>

## Draft Handoff (optional)
- phase shape hint: <likely decomposition>
- planning red lines: <what draft must not silently change>
```

## Recommended method

Run in three passes:

1. Ask capture
   - preserve the source ask
   - normalize the goal
   - extract obvious constraints and scope
2. Meaning defense
   - list plausible interpretations
   - choose one or ask the user
   - name forbidden narrowings and drift risks
3. Draft handoff
   - define success signals
   - define proof requirements
   - suggest phase shape without turning it into tasks

## Anti-patterns

Producing a packet that looks like a plan is the failure mode. Smells:

- Numbered task list in the packet -> stop, this is the drafter's job
- Time estimates or file paths in the packet -> stop, too early
- More than ~600 words with no real ambiguity handling -> too much
  summary, not enough structure
- Success signals that are aspirational ("make it feel fast") rather
  than observable ("p95 under 200ms under 50 rps")
- Missing `Rejected / Forbidden Narrowings` on a risky or fuzzy ask
- Missing `Proof Requirements` when later verification will matter

## Handoff

After writing the packet:

- Tell the user the path (`.plan-enforcer/discuss.md`).
- Summarize the key decisions captured in one line per major section.
- Offer next step: "want me to draft the plan against this packet?"
  and wait. Do not auto-invoke the drafter.
