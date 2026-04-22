# Closure Receipt Feature — First-Class Plan Enforcer

## Source Ask

> 100% make it skill level. and a command / plan-enforcer-recipt to call whenever

> Wait, what made you generate the closure recipt? thats awesome

User confirmations on three load-bearing calls (a/b/a):
- trigger: hook-based auto-emission when last non-terminal row flips to terminal
- filename: `closure-<plan-slug>-<utc-iso>.md` -- every emission preserved as its own file (audit purposes)
- "plan closed" definition: all rows in TERMINAL_STATUSES (verified / skipped / blocked / superseded)

Template content default accepted: standardized sections derived from ledger structure, plan-specific extras (must-haves, custom lint results) added opportunistically when present in the plan, not required.

## Normalized Goal

The closure-receipt artifact today is per-plan: it only exists when a plan author remembers to add a "write closure receipt" task. That makes it a pattern, not a feature -- bad plans forget it, runs without one are indistinguishable from runs that didn't happen. Promote receipt emission to the runtime so every closed plan leaves an audit-grade summary on disk, regardless of whether the plan asked for it.

## Non-Negotiables

- NN1: receipts emit automatically when a plan closes -- no plan-author opt-in required
- NN2: a `plan-enforcer-receipt` CLI / `/plan-enforcer-receipt` skill command exists for explicit on-demand emission against the current ledger
- NN3: every receipt is preserved as its own file (`closure-<plan-slug>-<utc-iso>.md`); never overwritten, never silently coalesced
- NN4: receipts land in `.plan-enforcer/proof/` (existing convention preserved)
- NN5: enforcement is hook-based (matches the project's "enforce via hooks not cooperative prompts" philosophy from CLAUDE.md / I2)
- NN6: receipt content is derived from ledger state -- no plan-author authoring required for the standard sections
- NN7: ASCII-only inside generated receipts (CLAUDE.md global rule); no Unicode box-drawing
- NN8: forbidden-language rule (CLAUDE.md) applies to any user-facing copy in receipts and CLI output
- NN9: receipts must NOT introduce new dependencies (system Node only, like every other CLI in this repo)
- NN10: existing skill / CLI / hook conventions preserved -- new code matches the shape of `report-cli.js`, `status-cli.js`, `plan-enforcer-status` skill, etc.

## Hidden Contract Candidates

- HC1: the receipt is itself a Plan Enforcer artifact and should be replayable -- a future operator reading it should be able to reconstruct the plan's outcome without re-reading ledger.md
- HC2: receipts are durable audit trail; should be tracked in git by default (not gitignored under `.plan-enforcer/.*`)
- HC3: the auto-emission hook must be idempotent for the same closed-state ledger -- accidental re-saves of the same ledger should not spam new receipts. The "first transition into all-terminal" event triggers exactly one auto-emission per close.
- HC4: explicit `plan-enforcer-receipt` invocation is independent -- always emits a fresh file regardless of close state, lets users snapshot mid-flight (with appropriate "plan still open" framing inside the receipt)
- HC5: receipt content must survive the playground test -- accurate even if the receipt is the only file a reviewer reads
- HC6: when the last non-terminal row flips to a terminal state, the hook reads the ledger AFTER the edit committed (PostToolUse), not the pre-edit state
- HC7: existing "session close" behavior (`hooks/session-end.js`) stays unchanged; new receipt logic is a separate emission, not a replacement for the session-end gate
- HC8: each receipt references its prior closure receipt for the same plan (if one exists in `.plan-enforcer/proof/`), turning the audit trail from "N loose files in a directory" into a walkable chain. Latest receipt links to the immediately-prior one; the first-ever closure for a plan writes "Prior closure -- none (first close of this plan)". Mirrors the project's chain-of-custody thesis applied to its own audit artifacts.

## Plausible Interpretations

- PI1 (hook-based trigger): PostToolUse hook on ledger.md edits inspects the new state. If the last non-terminal row flipped to terminal in this edit, emit receipt. Existing `hooks/post-tool.js` is the natural extension point, OR a dedicated `hooks/plan-close.js` hook installed via settings. *Chosen by user (a).*
- PI2 (skill-prompt trigger): `plan-enforcer` executor skill includes a "if no pending rows, emit receipt" instruction. *Rejected by user.*
- PI3 (hybrid): skill asks, hook backstops. *Rejected.*

- PI4 (filename = `closure-<plan-slug>-<utc-iso>.md`): every emission its own file, fully ordered, no collisions. *Chosen by user (b).*
- PI5 (filename = `closure-<plan-slug>.md` overwrite): canonical per-plan, history in git. *Rejected.*
- PI6 (filename = `closure.md` always-overwrite): only latest survives. *Rejected.*

- PI7 ("closed" = all TERMINAL_STATUSES): includes blocked. Plan can close with a known limitation. *Chosen by user (a).*
- PI8 ("closed" = verified or skipped): blocked counts as open. *Rejected.*
- PI9 ("closed" = verified only): strictest. *Rejected.*

## Chosen Interpretation

PI1 + PI4 + PI7, plus the HC8 chain enhancement. A new PostToolUse hook (or extension to `hooks/post-tool.js`) watches ledger.md edits. When the edit transitions the active task set into all-terminal status (`verified | skipped | blocked | superseded`), the hook calls a new `src/receipt-cli.js` to emit `closure-<plan-slug>-<utc-iso>.md` to `.plan-enforcer/proof/`. The same CLI is exposed as `bin/plan-enforcer-receipt` and as a `skills/plan-enforcer-receipt/SKILL.md` skill so the user can fire it on demand. The receipt content is derived from ledger state (scoreboard, task table, decision log, reconciliation history, blocked-row coordination items) plus opportunistic extras when the source plan provides them (must-have coverage, lint results citing real verifying-tool outputs). Every receipt includes a "Prior closure" header section that either links to the immediately-prior receipt for this plan-slug or states "none (first close of this plan)" -- making the closure log a walkable chain rather than a flat directory.

## Rejected / Forbidden Narrowings

- FN1: skill-prompt-only -- user explicitly chose hook-based; do not silently fall back
- FN2: overwriting receipts -- user chose preserve-each; do not coalesce
- FN3: receipts inside per-plan task list as "default tasks" -- the whole point is making this skill-level
- FN4: emitting receipts on every ledger edit -- only on close-transition, exactly once per close (HC3 idempotence)
- FN5: receipts that re-render on every status query -- emission is a discrete event, not a derived view (status-cli already exists for the live view)
- FN6: hard dependency on `git` for "files changed" section -- if `git` is absent or repo state is dirty in surprising ways, the section degrades gracefully (notes the limitation), does not fail the receipt
- FN7: auto-emission breaking out-of-band ledger edits -- hook must distinguish a true close-transition from a no-op edit on an already-closed ledger
- FN8: tying receipt schema to README-rebuild template -- that template was plan-specific; the standard schema is ledger-derived
- FN9: writing receipts outside `.plan-enforcer/proof/` -- preserve the convention
- FN10: new deps (templating libraries, markdown formatters) -- everything builds with system Node and the existing src/ helpers (ledger-parser, archive, etc.)

## In Scope

- Add `src/receipt-cli.js` -- pure ledger-derived emission, takes optional `--plan-slug` and `--out` overrides, defaults derive from current `.plan-enforcer/ledger.md` source metadata
- Add `bin: { plan-enforcer-receipt: "src/receipt-cli.js" }` to package.json
- Add `skills/plan-enforcer-receipt/SKILL.md` (slash command surface). Skill description: "Emit a closure receipt against the current ledger, or check whether a plan-close auto-emission already exists."
- Add hook trigger logic for PostToolUse-on-ledger-edit close-transition detection. Either as a new `hooks/plan-close.js` registered in settings, or by extending `hooks/post-tool.js` with a close-detection branch -- pick during draft based on what the existing post-tool already does
- Update `install.sh` if it lists hook files explicitly so the new hook gets wired
- Update `hooks/session-end.js` only if the receipt emission interacts with its existing "ledger missing at session end" gate (likely no change, but verify)
- Add tests for: receipt emission on close-transition, idempotence on no-op ledger edit, explicit CLI invocation against an open ledger, filename slug + ISO derivation
- Update relevant documentation: top-level README.md surface mentions the new skill if applicable; add `plan-enforcer-receipt` to whatever surfaces enumerate the public skill set (CLAUDE.md, ROADMAP.md, docs/)

## Out of Scope

- Per-plan receipt customization beyond what already exists (Proof Requirements section in discuss.md / plan)
- Receipt templating language or theme system (one standard template; if users want custom they can keep writing per-plan tasks like the README rebuild did)
- Migration / regeneration of historical closed plans -- the feature applies to plans that close after the install
- HTML / PDF / non-markdown receipt formats
- Notifications, webhooks, slack integration
- Auto-merging / auto-PR creation on close
- README rebuild plan (separate workstream; T30 still blocked awaiting browser visual verification on github.com)
- Statusline / playground workstream (still in user's hands; D2 override applies)

## Constraints

- Pure Node, no new dependencies (matches package.json shape: only system Node + repo's own helpers)
- ASCII only in receipt body and CLI output; no Unicode box-drawing
- File path conventions: `.plan-enforcer/proof/closure-<plan-slug>-<utc-iso>.md`
- Plan slug derivation: from the source plan's path basename minus extension and date-prefix where present (e.g. `docs/plans/2026-04-21-readme-visuals-rebuild.md` -> `readme-visuals-rebuild`)
- UTC ISO timestamp normalized to filename-safe form (e.g. `2026-04-22T03-45-00Z` -- colons replaced with hyphens)
- Hook must not regress hot-path performance of normal ledger edits (close-transition detection is O(rows) at most)
- Hook errors must not block ledger edits; they degrade gracefully (warn, do not error-fail the user's edit)
- All new files match existing project style (module.exports patterns, error formatting, CLI usage strings, etc.)

## Success Signals

- Closing any plan emits exactly one new receipt file under `.plan-enforcer/proof/closure-<plan-slug>-<utc-iso>.md` without any plan-author action
- Editing an already-closed ledger (no transition) emits zero new receipts
- `plan-enforcer-receipt` CLI run mid-flight produces a receipt with a clear "plan still open: N pending" header and a partial summary, without erroring
- Existing `plan-enforcer` (executor) flow runs unchanged for plans that don't close in this session
- All existing tests stay green (modulo D2-noted pre-existing statusline failures)
- New tests covering close-transition, idempotence, and explicit CLI all pass on first install
- A reader who only opens the receipt file (no other context) can answer: what plan, what shipped, what files changed, what was decided, what (if anything) is still open
- A reader who wants the full history opens the latest receipt and walks backward via the "Prior closure" link, reconstructing every prior close of the same plan without touching git
- `grep -rE 'reverse|byte.for.byte|libgpc|Swizzy|Larry|Jimmy CrakCrn'` clean against any new committed file

## Drift Risks

- DR1: drafter packages auto-emission AND the `/plan-enforcer-receipt` command into one CLI invocation only, missing the hook side -- both surfaces are required
- DR2: drafter writes the auto-emission as a `plan-enforcer` executor-skill prompt step ("when all tasks done, emit receipt") instead of a hook -- contradicts NN5 and the user's a/b/a choice
- DR3: drafter coalesces receipts (overwrite same filename on each emission), violating NN3 and the user's audit-purpose intent
- DR4: drafter conflates this work with a per-plan template -- this is a runtime feature, not a plan task
- DR5: receipt content drifts toward the README-rebuild template specifically, losing portability across other plans
- DR6: drafter forgets idempotence (HC3) and emits a new receipt on every ledger edit
- DR7: drafter forgets the `plan-enforcer-receipt` CLI / skill surface and only ships the hook
- DR8: drafter introduces external deps (markdown libs, templating) violating NN9
- DR9: drafter modifies `hooks/session-end.js` semantics in passing, breaking the existing "ledger missing at session end" gate
- DR10: drafter writes new tests using a different test runner than the existing suite (it uses `node --test` per the test failures we already saw)
- DR11: drafter writes the receipt skill prose in caveman fragments instead of paragraphs (skill SKILL.md files are public documentation, not chat)
- DR12: drafter ships the per-emission filename but forgets the "Prior closure" link inside the receipt body, breaking HC8 -- the feature then produces an audit directory instead of an audit chain

## Proof Requirements

- PR1: on this repo, after the receipt feature is installed, the next plan that closes (or a synthetic test plan that closes) produces a receipt file without any plan-author task
- PR2: the receipt's "files changed" section accurately reflects what shipped (verified by spot-checking against `git diff --stat`)
- PR3: idempotence test: edit ledger.md without flipping a task to terminal, confirm zero new receipts
- PR4: explicit `plan-enforcer-receipt` CLI run against an open ledger writes a receipt and prints its path to stdout; exit code 0
- PR5: hook degradation test: `git` absent or unparseable diff -> receipt emits with a "files changed: unavailable" note, no failure
- PR6: documentation diff -- updates to README.md (or wherever the public skill surface is enumerated) reference the new skill / CLI
- PR7: install.sh + uninstall.sh handle the new hook (install adds the wiring, uninstall removes it)
- PR8: tests pass: `node --test tests/<new-receipt-tests>.js` green
- PR9: `grep -P '[^\x00-\x7F]'` returns zero matches across new files (ASCII discipline)
- PR10: forbidden-language grep clean against new committed files (CLAUDE.md global rule)
- PR11: chain-walkability test -- after emitting two receipts for the same plan-slug (first close, reopen, second close), confirm the second receipt's "Prior closure" section links to the first receipt's filename and the first receipt's "Prior closure" section reads "none (first close of this plan)"

## Draft Handoff

Phase shape hint (drafter is free to refine):

1. **Receipt CLI** -- write `src/receipt-cli.js` first. Pure ledger-in, markdown-receipt-out. Accepts `--plan-slug`, `--out`, derives both from current ledger if absent. This is the testable nucleus.
2. **Standardized template** -- inside the CLI, define the receipt sections derived from ledger state: header (plan path + close timestamp + scoreboard snapshot), **Prior closure** (link to immediately-prior receipt for this plan-slug, or "none (first close of this plan)"), task table, decision log summary, reconciliation history, blocked-row coordination, files-changed (`git diff --stat` against the ledger's first task SHA or the prior closure's SHA), known limitations, proof artifacts list. Opportunistic extras when source plan exposes Must-Haves or Proof Requirements.
3. **bin + skill** -- wire `plan-enforcer-receipt` into package.json bin and create `skills/plan-enforcer-receipt/SKILL.md` that prefers the installed CLI (matches the pattern in `plan-enforcer-status`).
4. **Auto-emission hook** -- close-transition detection in `hooks/post-tool.js` (preferred -- one less hook to install) OR new `hooks/plan-close.js`. Decision in draft based on what post-tool already shoulders.
5. **install.sh / uninstall.sh wiring** -- if hooks are listed explicitly, add the new entry. Update `plan-enforcer doctor` if it enumerates expected hook surfaces.
6. **Tests** -- close-transition, idempotence, explicit CLI, hook degradation, slug+timestamp filename derivation.
7. **Documentation** -- update README.md to mention the new skill in the public surface section (we just rewrote it; the addition is a single line). Update CLAUDE.md / ROADMAP.md if they enumerate the skill set. Update `docs/proof/` if any proof file references receipts as a per-plan thing.
8. **Verify on this repo** -- after install, confirm a real or synthetic close-transition produces a receipt, run forbidden-language + ASCII grep on new files, and stash the new receipt path in the closure receipt for THIS feature work (recursive; the new feature should generate the receipt for its own closure).

Planning red lines (drafter must NOT silently change):

- both deliverables (auto-emission AND `plan-enforcer-receipt` CLI/skill) must ship together
- auto-emission MUST be hook-based, not skill-prompt-based
- filename MUST be `closure-<plan-slug>-<utc-iso>.md` -- never overwrite
- "plan closed" MUST include blocked rows in the terminal set
- no new dependencies
- ASCII only inside receipts and CLI stdout
- existing `hooks/session-end.js` semantics preserved
- receipt content derived from ledger; per-plan extras opportunistic, not required
- every receipt MUST include a "Prior closure" section linking to the immediately-prior receipt for the same plan-slug, or stating "none (first close of this plan)" -- the chain is non-negotiable
