# README + Visuals Rebuild — Terminal-Native Dark System

**Goal:** Replace the 9-figure mixed-design-system README with one cohesive terminal-native dark visual system, sized native to GitHub's render width (~720px effective), containing ≤6 figures and prose paragraphs that carry the reader between them. Substance preserved; case-file motif stripped to one tasteful trace.

**Constraints:**
- ASCII-only in any committed public copy and inside every SVG text node. No emojis, no Unicode box-drawing characters.
- Brand-protection forbidden-language grep (from global CLAUDE.md) must pass on final README.
- Public claim stays narrow: "chain-of-custody for AI coding." No hype beyond what `docs/proof/*` supports.
- Every new figure designed native to ~720px effective width; hero may use viewBox up to 960px wide but must remain legible when scaled by GitHub.
- Pure SVG, no external font requests. System mono stack only: `ui-monospace, Menlo, Consolas, monospace`.
- Single design system across every figure: identical palette tokens, type scale, and chrome family.
- Case-file motif (`CASE No. PE-0427`, `FILED`, `SEALED`, `CUSTODIAN`) limited to one tasteful trace — header band on the hero figure only. Banned inside any other figure body and inside README chrome below the title block.
- All existing README image links replaced with the new asset paths; every `docs/proof/*.md` reference to a deleted SVG either re-pointed or removed (no 404s introduced).
- Total new figure count <= 6 (1 hero + ≤5 standard).
- Zero new dependencies (no fonts, libraries, build steps).
- README prose written as paragraphs, not caveman fragments. Caveman mode is for chat; README is public-facing prose.

**Out of scope:**
- Source code behavior changes (hooks, skills, CLIs, ledger format).
- Rewriting proof-pack content under `docs/proof/*` — only fix references to deleted assets.
- Playground HTML/JS redesign (currently modified files in `docs/playground/`, `scripts/`, `tests/` are a separate workstream; this plan only audits whether they reference soon-deleted SVG paths).
- Logo, favicon, branding work outside README.
- New badges, license content changes, install instruction rewrites.
- New sections describing features that don't exist.

## Must-Haves

- MH1: README reads top-to-bottom with prose paragraphs carrying transitions; no section is just figure + caption A:I48 A:I49
- MH2: All 9 existing SVGs replaced with ≤6 new figures, every one on the same terminal-native dark design system A:I48
- MH3: Every new SVG renders legibly at ~720px GitHub render width and at ~390px iPhone width without zoom for headlines A:I48 A:I49
- MH4: Substance preserved — chain of custody, ledger primitive, three layers, BYO plan, best fit, narrow claim all still represented A:I48
- MH5: Case-file motif appears only as one tasteful trace (header band on hero figure); zero `CASE/FILED/SEALED/CUSTODIAN` strings inside other figure bodies or in README body prose A:I48
- MH6: Forbidden-language grep returns empty against final `README.md` A:I48
- MH7: All image references in README and `docs/proof/*.md` resolve (no broken links, no 404s) A:I48

### Task 1: Define design system spec → docs/assets/_design-system.md A:I48 A:I49

- [ ] Create `docs/assets/_design-system.md` documenting the full token set so any later figure can be checked against it
- [ ] Include explicit hex values for at least these palette tokens: `bg` (canvas), `bg-elev` (lifted panel), `fg` (primary text), `fg-dim` (secondary text), `accent-cyan` (primary accent), `accent-green` (with/sealed states), `accent-amber` (warning/caution), `accent-rule` (thin separators)
- [ ] Document typography scale, mono stack only: 9px (eyebrow caps), 10px (label caps), 11px (body/code), 13px (subhead), 16px (section header), 22px (hero); letter-spacing rules for caps levels
- [ ] Document the two chrome families: (a) `terminal-window` — titlebar with prompt indicator + cyan dot; (b) `ledger-row` — 4px left accent bar + label-eyebrow + body
- [ ] Document motif rules in plain prose: case-file header band ALLOWED on hero figure only; `CASE/FILED/SEALED/CUSTODIAN` strings BANNED inside any other figure body
- [ ] Document the ASCII-only rule for all SVG text content with the verification grep command
- [ ] Document viewBox conventions: hero = 960x540, standard = 720x360 or 720x420
- [ ] Document accessibility line: every SVG has `role="img"` + `aria-label="<sentence>"`
- [ ] Verification: file exists at `docs/assets/_design-system.md`; grep confirms it names at least 6 palette tokens with hex values, both chrome families, the motif/ASCII bans, and the viewBox conventions

### Task 2: Lock the README outline → docs/plans/2026-04-21-readme-outline.md A:I48

- [ ] Write `docs/plans/2026-04-21-readme-outline.md` listing the new section order, which figure (if any) anchors each section, and one-sentence prose plan per section
- [ ] Confirm the outline lands ≤6 figures total (1 hero + ≤5 standard) and each figure earns its slot conceptually
- [ ] Include an explicit map: each current section (01-07) and concept either lands in a new section or is marked consolidated/dropped with reason — no concept silently lost
- [ ] Decide which existing concept(s) become which new figures: hero = git-log diptych reborn; standard slots cover (install/onboarding), (custody chain stages), (three layers), (BYO plan normalization), (best fit scoring)
- [ ] Verification: outline lists ≤6 figures; every section has a one-sentence prose-plan; concept map shows where every current concept lands; no `?`, `TBD`, or `TODO` in the outline

### Task 3: Build hero figure — git-log diptych reborn A:I48

- [ ] Create `docs/assets/hero-git-log.svg` using design system tokens from Task 1; viewBox 960x540
- [ ] Left panel: messy git log — wip / fix / revert / "wip again" pattern in `fg-dim` on `bg-elev`, suggesting the without-state
- [ ] Right panel: clean ledger-rowed git log — named commits with stage tags (`ASK`, `PLAN`, `EXEC`, `DECIDE`, `VERIFY`, `LAND`), each row showing the receipt file path next to it, in `fg` on `bg-elev`, with `accent-green` on the LAND row
- [ ] One header band (the only allowed case-file trace): thin `accent-cyan` rule; `CASE PE-0427` in eyebrow caps left, hero title center, date right
- [ ] Caption-line geometry: panel labels (`WITHOUT` / `WITH PLAN ENFORCER`) sit above each panel in eyebrow caps; one short footer note ties them together
- [ ] Verification: SVG opens standalone in browser at full viewBox; visual check at viewport 720px and 390px (capture `proof/hero-git-log-720.png` and `proof/hero-git-log-390.png` under `.plan-enforcer/proof/`); ASCII-only check via Grep tool with pattern `[\x{2500}-\x{257F}]` and multiline true on the file returns no matches

### Task 4: Build the 5 remaining figures on the established system A:I48

- [ ] Build `docs/assets/install.svg` (viewBox 720x360) — terminal-window chrome around a real shell session: `git clone`, `cd`, `./install.sh` with surface-confirm output (hooks/skills/bin/state), `plan-enforcer doctor` returning ready, `plan-enforcer discuss "..."` start; uses `accent-cyan` for prompts, `accent-green` for ok lines, `fg-dim` for muted explanation
- [ ] Build `docs/assets/custody-chain.svg` (viewBox 720x420) — six ledger rows for `ASK / PLAN / EXEC / DECIDE / VERIFY / LAND`; each row: stage label in eyebrow caps, the receipt file path (`.plan-enforcer/<stage>.md` or equivalent) in mono body, status indicator on right; LAND row gets `accent-green` left bar
- [ ] Build `docs/assets/three-layers.svg` (viewBox 720x420) — three horizontal lanes (Authorship / Execution / Truth) running across the six-stage timeline from custody-chain; each lane shows which stages it owns and the file it produces; ledger-row chrome
- [ ] Build `docs/assets/byo-plan.svg` (viewBox 720x360) — three input plan formats on the left (`gsd`, `superpowers`, `freeform .md`) flowing through one normalizer band into one ledger entry on the right; arrows are simple lines, no decorative gradients
- [ ] Build `docs/assets/best-fit.svg` (viewBox 720x360) — five horizontal scored bars (`duration / risk / auditability / handoff / evidence`) showing two profiles: a strong-fit example with full bars (in `accent-cyan`/`accent-green`), and a less-suited example with empty bars (in `fg-dim`); legend below
- [ ] Each figure has `role="img"` and a one-sentence `aria-label`
- [ ] Verification per figure: opens standalone at its viewBox; ASCII-only grep clean; 720px screenshot captured to `.plan-enforcer/proof/<name>-720.png`; 390px screenshot captured to `.plan-enforcer/proof/<name>-390.png`
- [ ] Verification overall: `Glob docs/assets/*.svg` returns exactly 6 SVG files matching {`hero-git-log.svg`, `install.svg`, `custody-chain.svg`, `three-layers.svg`, `byo-plan.svg`, `best-fit.svg`}

### Task 5: Rewrite README prose end-to-end A:I48 A:I49

- [ ] Replace `README.md` with new content following the Task 2 outline
- [ ] Every numbered section contains at least one prose paragraph in addition to figure + caption (no section is just figure + caption)
- [ ] Captions add interpretation (what to notice / what it proves), not restate the alt text
- [ ] Image references point only to the 6 new SVG paths from Tasks 3-4
- [ ] Title block keeps narrow claim: "chain-of-custody for AI coding"; install section stays in the first or second viewport when rendered on github.com
- [ ] Strip from body prose: any standalone `CASE No. PE-0427`, `FILED`, `CUSTODIAN`, `SEALED` lines below the title block (the only allowed case-file trace is inside the hero figure header band)
- [ ] Verification: `wc -l README.md` returns between 130 and 220 lines (target: under current ~150 + room for paragraphs); Grep for `^## [0-9]+ /` lists every section; for each section, manually confirm at least one non-figure non-caption paragraph follows; `Grep -E 'CASE No\. PE-0427|FILED 2026|CUSTODIAN|SEALED' README.md` returns at most 0 matches in body prose; `Grep -E 'reverse|byte.for.byte|libgpc|Swizzy|Larry|Jimmy CrakCrn' README.md` returns empty (forbidden-language clean)

### Task 6: Delete superseded SVGs and fix every external reference A:I48

- [ ] Delete from `docs/assets/`: `authorship-chain.svg`, `authorship-layer.svg`, `benchmark-summary.svg`, `best-fit.svg` (old), `carryover-ladder.svg`, `chain-of-custody.svg`, `claim.svg`, `execution-layer.svg`, `git-log-diptych.svg`, `install-manifest.svg`, `problem-solution.svg`, `proof-lanes.svg`, `provable-surfaces.svg`, `stack.svg`, `three-layers.svg` (old), `truth-layer.svg`, `what-it-catches.svg`, `without-with.svg`, `workflow.svg`
- [ ] For each deleted filename, run `Grep -r "<filename>"` across the repo (excluding `.git/`); for any match outside `README.md`, repoint to the closest equivalent new asset OR remove the reference with a one-line replacement that explains why
- [ ] Audit `docs/proof/*.md` specifically — every file in that directory grepped for `docs/assets/`; any reference resolved
- [ ] Audit `docs/playground/readme-playground.html` (currently modified per git status) for old SVG references; if any, update to new paths or note as a coordination item to surface to the user before commit
- [ ] Verification: `Glob docs/assets/*.svg` returns exactly the 6 new files; `Grep -rn -E '(authorship-chain|authorship-layer|benchmark-summary|carryover-ladder|chain-of-custody|claim|execution-layer|git-log-diptych|install-manifest|problem-solution|proof-lanes|provable-surfaces|stack|truth-layer|what-it-catches|without-with|workflow)\.svg' .` returns empty (or only matches in this plan file / discuss packet, which is acceptable historical context); `Grep -rn 'best-fit\.svg|three-layers\.svg' .` shows only references to the new versions

### Task 7: Verify rendered README on github.com (mobile + desktop) A:I48

- [ ] Commit Tasks 1-6 to a feature branch (`readme-rebuild` or similar); do NOT merge to main yet
- [ ] Push branch; open the rendered README on github.com
- [ ] Capture desktop screenshot of the full rendered README to `.plan-enforcer/proof/readme-github-desktop.png`
- [ ] Capture mobile screenshot (Chrome devtools at 390px width, full-page) to `.plan-enforcer/proof/readme-github-mobile.png`
- [ ] Walk top-to-bottom on both renders; explicit checks: (a) every image loads (no GitHub broken-image placeholders), (b) every figure's headline is readable without zoom, (c) prose flows section-to-section without orphan figures, (d) install code block visible in the first or second viewport on desktop
- [ ] Verification: both screenshots exist at the named paths; written confirmation that all four checks (a-d) pass; if any fail, raise as a blocker before continuing

### Task 8: Final lint + closure receipt A:I48

- [ ] Run forbidden-language grep on final `README.md`: `Grep -nE 'reverse|byte.for.byte|libgpc|Swizzy|Larry|Jimmy CrakCrn|no public spec|exact parity'` — expect zero matches
- [ ] Run a link-checker against `README.md` (e.g. `npx --yes markdown-link-check README.md` if network allows; otherwise manual check of every link in the file) — expect zero broken links
- [ ] Run Unicode box-char grep across `docs/assets/*.svg` with pattern `[\x{2500}-\x{257F}]` (multiline true) — expect zero matches
- [ ] Write closure receipt to `.plan-enforcer/proof/closure-readme-rebuild.md` listing: deleted SVG files (full list), new SVG files (6), forbidden-grep result, link-check result, ASCII-grep result, mobile + desktop screenshot paths
- [ ] Verification: closure receipt exists; all three lint commands return clean output and the result is recorded inside it

## Assumptions

- The `.plan-enforcer/proof/` directory is the right place for proof artifacts (per Plan Enforcer convention); creating it if missing is fine.
- `docs/playground/readme-playground.html` is being actively edited by the user in a separate workstream; this plan does not commit playground changes, only audits SVG references inside it.
- Yesterday's plan `docs/plans/2026-04-20-readme-relaunch.md` is the predecessor that produced the current 9-figure README; it is not deleted or amended — its outcomes are simply superseded by this plan's outputs in the `docs/assets/` and `README.md` surfaces.
- "Tasteful trace" of the case-file motif means: keep the hero header band as the only place those words appear in any committed asset or README copy. Confirm during review if this reading is wrong.
- GitHub README image scaling behavior is stable enough that designing native to 720px effective width produces legible mobile + desktop renders without per-figure responsive variants.
