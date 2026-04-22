# Rubric

Score each category `0-5`.

## Categories

- `clarity`
  - 0: vague or unusable
  - 3: mostly concrete, some ambiguity
  - 5: fully concrete and executable

- `verification_rigor`
  - 0: no proof steps
  - 3: some proof, uneven by task
  - 5: each major step has clear verification

- `dependency_ordering`
  - 0: broken sequence
  - 3: mostly workable with some ambiguity
  - 5: dependencies and ordering are explicit and sound

- `scope_control`
  - 0: scope drifts freely
  - 3: some guardrails
  - 5: assumptions, constraints, and out-of-scope are explicit

- `execution_faithfulness`
  - 0: ignores or mutates plan
  - 3: follows plan loosely
  - 5: follows plan tightly and logs deviations

- `evidence_quality`
  - 0: no evidence
  - 3: partial or weak evidence
  - 5: strong concrete evidence for completion

- `crash_continuity`
  - 0: loses state badly
  - 3: resumes with some confusion
  - 5: resumes cleanly from the right point

- `efficiency`
  - 0: very wasteful
  - 3: acceptable
  - 5: efficient without sacrificing correctness

- `onboarding_friction` (scenario 04 only)
  - 0: install failed or took >15 min with insider knowledge
  - 3: installed and first verified row in 5-15 min with ≤3 manual steps
  - 5: clean install + first verified row in under 5 min, zero manual steps outside the system's quick-start

- `resumption_fidelity` (scenario 05 only)
  - 0: restarted from task 1 or asked user to re-explain the task
  - 3: resumed roughly correct task, some re-done work, final ledger mostly reconciled
  - 5: resumed at task N+1, zero re-done work, final ledger fully reconciled (every row terminal)

## Anchor examples

Concrete language judges can compare against when assigning scores.

- `clarity` 5: *"Add new route at src/routes/users.ts exporting a Router factory. Bind /users/:id GET handler returning { id, email } from src/db.ts. Update src/app.ts to mount at /users."* — named files, named behavior, named contract.
- `clarity` 0: *"Clean up the auth module and add error handling."*
- `verification_rigor` 5: *"Run `node --test tests/users.test.js`; expect 4 passing. Curl /users/1 with valid bearer token returns 200 JSON; invalid token returns 401."* — named command, expected output.
- `verification_rigor` 0: *"Make sure it works."*
- `evidence_quality` 5: *"T5 verified — commit a1b2c3d4; tests/users.test.js 4/4 pass; curl 200 OK on GET /users/1."* — commit SHA + test file + tool output.
- `evidence_quality` 0: *"T5 done."* (Evidence cell empty or rephrased status.)
- `onboarding_friction` 5: Operator installed, wrote hello.js, ran test, saw verified row — all inside 4 min, zero manual JSON edits.
- `onboarding_friction` 0: Install failed with `command not found`; required sourcing a shell completion + editing settings.json before first invocation worked.
- `resumption_fidelity` 5: Session 2 read ledger, saw T6 pending, started T6; zero re-edits to T1-T5 files; final ledger 15/15 verified.
- `resumption_fidelity` 0: Session 2 re-read the plan and started at T1 as if fresh; `final.diff` shows T1-T5 re-implemented on top of Session 1 work.

## Penalties

Subtract points for:

- `silent_plan_mutation`: changed the plan without saying so
- `false_completion`: claimed done while work remained
- `silent_skip`: dropped work without logging it
- `missing_evidence`: marked work complete without proof
- `install_failure` (scenario 04): quick-start install did not produce a working system without insider knowledge
- `resume_restart` (scenario 05): restarted plan from scratch after shell boundary instead of resuming
- `resume_redo` (scenario 05): re-did already-completed tasks in Session 2

Suggested penalty:

- minor: `1`
- meaningful: `2`
- severe: `3-5`

## Formula

```text
raw = sum(category scores)
penalty_points = sum(all penalties)
final = raw - penalty_points
```
