# README + Visuals Rebuild

## Source Ask

> this readme needs help.. these svgs are tough to read and the look is odd, it has no flow, what do you suggest

> rebuild, dark theme, get creative with the svgs

User confirmations on three load-bearing calls (a/a/b):
- width: design native to GitHub render (~720px effective)
- scope: replace every SVG (9 assets)
- aesthetic: terminal-native — ledger-output framing, monospace, ANSI palette discipline

## Normalized Goal

The current README has nine figures across two competing design systems (terminal-forensic vs. IBM-Plex-stack), a heavy "CASE No. PE-0427 / FILED / SEALED" motif that fatigues across length, micro typography that goes unreadable at GitHub render width, and prose so terse there is no narrative carrying the reader between figures. Rebuild it as a single terminal-native visual system, sized native to GitHub width, with prose that earns the figures around it. Keep the substance (chain of custody, ledger, three layers, best fit); strip the courtroom theater to a tasteful trace.

## Non-Negotiables

- NN1: dark theme across every figure
- NN2: terminal-native aesthetic — monospace type, CLI/ledger framing, ANSI-discipline palette
- NN3: every figure legible at ~720px effective width (GitHub default) and at iPhone width (~390px) for hero/title figures
- NN4: every existing SVG replaced — no mixed design systems
- NN5: substance preserved — chain of custody, ledger primitive, three layers, BYO plan, best fit, narrow claim
- NN6: ASCII only inside SVG text (CLAUDE.md global rule); no Unicode box-drawing characters
- NN7: forbidden-language rule (CLAUDE.md) applies to every line of public README copy

## Hidden Contract Candidates

- HC1: figures must hold up when opened standalone at full size, not just thumbnail-readable. Audit-grade identity means information survives zoom in either direction.
- HC2: alt text + captions remain accessible reading paths; figures cannot be the only carrier of meaning
- HC3: file paths shown in figures must match real repo paths (`.plan-enforcer/decisions.md`, etc.) — README is itself a proof artifact for what it describes
- HC4: README must continue to demonstrate the discipline it sells (chain-of-custody behavior visible in commits + ledger), not drift from what the codebase actually does

## Plausible Interpretations

- PI1: light-touch terminal — keep the current `install-manifest.svg` palette/type and just retheme the rest to match it
- PI2: heavy terminal-native — every figure is a literal shell session, prompt chars, ASCII boxes, ANSI color comments, "output" framing; no abstract diagrams
- PI3: terminal-as-frame — terminal chrome wraps every figure, but contents can be either CLI-output OR conceptual diagram drawn in the same monospace + cyan/green palette. Pure CLI for some, framed diagram for others. Avoids monotony across 5-6 figures while keeping cohesion.

## Chosen Interpretation

**PI3 — terminal-as-frame.** Every figure shares: dark canvas, mono typography stack, the same accent palette (cyan primary, green for "with"/sealed states, amber for warnings, dimmed text for muted), and a thin terminal-window or ledger-row chrome. Inside that frame, figure content varies by what the concept actually needs: a CLI session for the install figure, a comparative diptych for git-log, a scored bar chart for best-fit, a flow diagram for layers. One language, multiple expressions.

## Rejected / Forbidden Narrowings

- FN1: reskinning current SVGs in place — user said rebuild, not retheme
- FN2: nine fresh figures, one-to-one with current set — figure count is part of the flow problem; consolidate
- FN3: erasing the case-file motif entirely — user said "tasteful trace"; keep ONE signature usage (header band on hero only) and strip every `CASE PE-0427`, `FILED`, `SEALED`, `CUSTODIAN`, `CUT LINE` reference inside figure bodies and inside README chrome below the title block
- FN4: designing wide canvas (1200px+) and relying on GitHub to scale — user picked native ~720px
- FN5: rewriting README into longer marketing copy — flow improvement is the goal, not length growth
- FN6: pure-screenshot terminal where every figure is shell output — kills the variety needed across 5-6 figures
- FN7: dropping or rewriting Plan Enforcer's substance — figures and prose change, the product story does not

## In Scope

- README rewritten end-to-end with prose paragraphs that carry the reader between figures
- All 9 existing SVGs replaced with a new ~5-6 figure set on one terminal-native design system
- Section structure preserved as the default arc, with permission to consolidate where the figure count drops (e.g., merging 02 + 03 + 04 if one strong artifact replaces three weak ones)
- Case-file motif stripped to one tasteful trace (header band on hero figure only)
- Captions rewritten to add interpretation, not just restate the alt text
- Hero figure: git-log diptych concept reborn in the new system (strongest current asset, conceptually earns hero slot)
- Old SVG files deleted from `docs/assets/` after the new ones replace them in the README and any other referencing surface

## Out of Scope

- Changing what Plan Enforcer does (no code, hook, or skill behavior changes)
- Updates to `docs/proof/*.md` content beyond fixing dead image references if any figure path changes
- Playground HTML/JS redesign (separate concern)
- Logo, favicon, or branding work outside the README
- New badges, new license content, new install instructions

## Constraints

- Effective width target: ~720px (GitHub render); design at viewBox 720x* with explicit scaling-friendly geometry
- Hero figure may use viewBox up to 960x* but must remain legible when GitHub scales it down
- Pure SVG, no external font requests; use system mono stack only (`ui-monospace, Menlo, Consolas, monospace`) and system sans for any non-mono accents
- ASCII only in text content (no `─ │ ┌ └ ─ ┐ ┘`)
- Total new figure count target: 5 figures, +1 hero = 6 max
- Hard ceiling: zero new dependencies (no fonts, no libraries, no build steps)

## Success Signals

- README scrolls top-to-bottom in under 3 minutes with continuous comprehension; no figure leaves the reader confused or under-explained
- Every figure passes a 390px-width legibility check (headline + key labels readable without zoom)
- One design system across all figures: identical palette tokens, identical type scale, identical chrome family
- Zero Unicode box-drawing characters in any new SVG (`grep -P '[\x{2500}-\x{257F}]' docs/assets/*.svg` returns empty)
- Every section has at least one prose paragraph (not just figure + caption)
- New figure count <= 6
- All forbidden-language terms absent from final README (`grep -E 'reverse|byte.for.byte|libgpc|Swizzy|Larry|Jimmy CrakCrn' README.md` returns empty)

## Drift Risks

- DR1: drafter writes 9 figures matching one-to-one with current set instead of consolidating to 5-6
- DR2: terminal-native interpreted as "literal screenshot" only, producing 5 nearly-identical shell sessions
- DR3: caveman-mode bleed-over into README prose — output reads as fragments instead of flowing paragraphs (README needs prose, not chat-style)
- DR4: case-file motif creeps back in mid-build (CASE/FILED/SEALED/CUSTODIAN) — explicit prohibition required in plan
- DR5: figures designed at 1200px and assumed to "scale down fine" — must design native to 720px
- DR6: forbidden language sneaks in through marketing flourish
- DR7: `docs/proof/*.md` quietly broken when source SVGs deleted — every reference must be re-pointed or the asset kept under a new name
- DR8: `docs/playground/readme-playground.html` (currently modified per git status) references current README state — coordinate or freeze its expectations

## Proof Requirements

- PR1: every new SVG opens standalone at its viewBox dimensions and renders legibly without external fonts
- PR2: README rendered on github.com (mobile + desktop) visually verified before declaring done; screenshots stashed in `.plan-enforcer/proof/` for the closure receipt
- PR3: every image link in README resolves (link-checker run, no 404s); every link in `docs/proof/README.md` and `docs/proof/public-proof.md` still resolves
- PR4: design-system spec written to `docs/assets/_design-system.md` (palette tokens, type scale, chrome rules, motif rules) so any future figure stays in-system
- PR5: deleted SVG files listed in the closure receipt with reason
- PR6: forbidden-language grep returns clean; recorded in closure
- PR7: 720px legibility check screenshots for each figure stashed in `.plan-enforcer/proof/`

## Draft Handoff

Phase shape hint (drafter is free to refine):

1. **Design system + section outline** — write `docs/assets/_design-system.md` with palette/type/chrome tokens; sketch the new README outline (sections, where figures land, what prose carries between)
2. **Hero figure** — `git-log-diptych` concept rebuilt terminal-native at hero size; this anchors the visual language for everything else
3. **Remaining figures** — build the other 4-5 figures against the established system in one batch
4. **Prose pass** — rewrite README prose section-by-section with the new figures in place
5. **Cleanup** — delete superseded SVGs, fix any `docs/proof/*.md` references, run forbidden-language grep, run link check
6. **Verify** — push to a branch, view on github.com (mobile + desktop), capture proof screenshots, then merge

Planning red lines (drafter must NOT silently change):

- figure count must end <= 6
- every figure designed native to ~720px effective width (hero may go to 960px)
- terminal-native aesthetic across every figure; one design system
- case-file motif limited to ONE tasteful trace (header band on hero); no `CASE PE-0427 / FILED / SEALED / CUSTODIAN` text inside other figures
- ASCII only inside SVG text content
- no new sections describing features that don't exist
- no forbidden-language terms in final README
- README prose written as paragraphs, not caveman fragments
