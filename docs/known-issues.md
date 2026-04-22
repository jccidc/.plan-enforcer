# Known Issues

Tracked gaps and candidate fixes for upcoming patches. Each entry names the problem, the evidence that surfaced it, and the proposed fix direction. When one ships, it moves to `CHANGELOG.md` and out of this file.

---

## Closed ledger hogs the statusline until manually removed

**Surfaced:** 2026-04-22, during v0.1.2 smoke testing on a live session.

**Problem.** After a plan closes naturally, `hooks/plan-close.js` (v0.1.2+) archives the ledger and clears the active slot — but only when the ledger actually gets edited while in all-terminal state. If the close happened at the end of a prior session and no subsequent edit touches the ledger, the active `.plan-enforcer/ledger.md` stays on disk indefinitely. The statusline hook sees the ledger as the primary witness and keeps rendering `[ENFORCER: N/N verified]` on every new session, even though the plan is effectively retired.

**Evidence.**
- Opening a fresh terminal session in a project whose last plan closed in a prior session still shows the final scoreboard tag.
- `/plan-enforcer-abandon` correctly refuses (preflight: "every row already terminal") — it is not the right surface for already-closed plans.
- Invoking `/plan-enforcer-discuss` writes `discuss.md` but does not touch `ledger.md`, so the stale ledger still wins `inferStatuslineState` priority.
- Workaround today: `rm .plan-enforcer/ledger.md` manually, or invoke `plan-enforcer-import` / the executor (which rewrites the ledger).

**Fix direction (candidate v0.1.4).** Two independent angles, either or both:

1. **Statusline side.** Extend `inferStatuslineState` so a ledger where every active row is terminal and `remaining === 0` is treated as "idle" — either render nothing, or render a distinct closed-state tag that users read as "no active plan" rather than "plan in progress at N/N".
2. **Discuss side.** When `/plan-enforcer-discuss` writes a new packet and finds an existing all-terminal ledger on disk, auto-archive the closed ledger to `.plan-enforcer/archive/` (same `archiveClosedLedger` helper shipped in v0.1.2) before writing `discuss.md`. That graduates the old plan into the archive the moment a new authorship session starts.

Angle 1 is the narrower fix (statusline-only, no file mutation). Angle 2 is the deeper fix that matches the lifecycle's intent (a new plan's arrival implicitly retires the prior one). Likely ship both — angle 1 for cosmetic cleanup at any entry point, angle 2 for true state transition.

**Scope.** ~1 hour. Small patch to `src/statusline-state.js` (angle 1) and/or the discuss CLI / entry point that writes `discuss.md` (angle 2). New tests in `tests/statusline-stage-clears.test.js` covering the closed-ledger-is-idle case.
