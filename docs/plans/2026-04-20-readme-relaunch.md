# README Relaunch — Flow, Visuals, Playgrounds

**Goal:** Relaunch `README.md` as a launch-grade conversion surface: rewrite narrative arc, enrich visual pacing, and ship at least one interactive HTML playground in `docs/playground/` that teaches a Plan Enforcer concept (chain-of-custody, authorship handoff, or drift) more clearly than its current static SVG.

**Constraints:**
- ASCII-only in README and committed public copy. No emojis, no unicode box-drawing.
- Brand-protection forbidden-language grep (from global CLAUDE.md) must pass on final README.
- Public claim stays narrow: "chain-of-custody for AI coding." No hype beyond what `docs/proof/*` supports.
- All existing README links (`docs/assets/*.svg`, `docs/proof/*`) must still resolve after relaunch, or be explicitly replaced.
- Install path (`git clone` -> `./install.sh` -> `plan-enforcer doctor`) stays visible in the first or second viewport of the rendered README on GitHub.
- Playgrounds are single-file self-contained HTML. No external build step, no npm install, no CDN-blocking deps, no tracking.
- GitHub does not render arbitrary interactive HTML inline — playgrounds are linked (raw.githack or similar), not embedded. README must hold up unopened.

**Out of scope:**
- Source code behavior changes (hooks, skills, CLIs, ledger format).
- Rewriting proof-pack content under `docs/proof/*`. README links to it unchanged.
- gh-pages / CI publishing infrastructure unless it turns out to be the only viable playground host (decide in Task 3, do not pre-commit).
- Rebranding, new logo, color-system overhaul.
- Translations.
- Adding more than one playground in this plan. A second playground requires explicit user approval before Task 3 expands.

## Must-Haves

- MH1: A cold reader hitting the relaunched README can state within 30 seconds what Plan Enforcer does and who it is for, without scrolling past the first two viewports.
- MH2: At least one interactive playground file exists under `docs/playground/` that is self-contained, opens in a plain browser, teaches a Plan Enforcer concept, and is linked from the relaunched README with a preview image and an "open interactive" link.
- MH3: Every link present in the pre-relaunch `README.md` either still resolves in the new README or has a recorded replacement. No dead links introduced.
- MH4: Brand-protection grep returns zero matches against the final `README.md`.
- MH5: Install path (`git clone` + `./install.sh` + `plan-enforcer doctor`) appears in the first or second viewport of the new README.
- MH6: Pre/post README diff, playground file(s), link-audit notes, and brand-grep output are committed together so reviewers can verify the relaunch on receipts alone.

### Task 1: Lock information architecture before any file changes
- [ ] Read current `README.md` end to end and list each existing section by header with a one-line purpose note.
- [ ] Read `.plan-enforcer/discuss.md` and extract the Non-Negotiables + Forbidden Narrowings into a working note.
- [ ] Draft a new section order in a working file `docs/plans/notes/2026-04-20-readme-ia.md` with columns: new_order | section | purpose | keeps_existing_copy (yes/partial/rewrite) | visual_slot (none/existing-svg/new-svg/playground-link).
- [ ] For every existing section that does not survive into the new IA, record the explicit reason (redundant, merged into X, load-bearing but relocated). No silent drops.
- [ ] Confirm the IA places install (clone + install.sh + doctor) in section 1 or 2.
- [ ] Confirm the IA preserves the "What we do not claim" / narrow-claim credibility anchor.
- [ ] Commit `docs/plans/notes/2026-04-20-readme-ia.md` as the IA lock.
- [ ] Verification: `git log -1 --name-only` shows the IA note committed; `grep -c "^## " docs/plans/notes/2026-04-20-readme-ia.md` matches the number of rows in the IA table.

### Task 2: Inventory the visual layer and identify gaps
- [ ] List every SVG currently referenced by `README.md`: `grep -oE 'docs/assets/[a-z-]+\.svg' README.md | sort -u`.
- [ ] For each SVG, classify against the new IA: keep-as-is | relocate | replace-with-playground | retire. Record in `docs/plans/notes/2026-04-20-readme-visual-inventory.md`.
- [ ] Identify exactly one concept (chain-of-custody OR authorship handoff OR drift detection) that will get a playground in Task 3. Record the choice and the reason it is a better fit for interactivity than its static SVG.
- [ ] Identify any new static SVG needs that flow from the new IA (e.g., hero explainer). Cap at two new SVGs for this plan; list them explicitly if any.
- [ ] Verification: inventory note committed; it names exactly one playground concept and at most two new SVGs; every README SVG appears in the classification table.

### Task 3: Build the single concept playground
- [ ] Create `docs/playground/` directory if absent.
- [ ] Invoke the `playground` skill to build a single-file HTML playground for the concept chosen in Task 2. Output path: `docs/playground/<slug>.html`.
- [ ] At the top of the playground, include a short "What this shows" block naming the Plan Enforcer concept and linking back to the relevant proof-pack doc under `docs/proof/`.
- [ ] Confirm the file opens in a plain browser with no console errors, no missing-asset 404s, and no external network dependencies required for correct rendering: `node -e "const fs=require('fs');const s=fs.readFileSync(process.argv[1],'utf8');const hits=s.match(/(?:src|href)=[\"']https?:\/\/(?!(raw\.githack|cdn\.jsdelivr))[^\"']+/g);if(hits){console.log('EXTERNAL:',hits);process.exit(1)}else{console.log('OK: no external deps')}" docs/playground/<slug>.html` — expected output: `OK: no external deps`.
- [ ] Verification: file exists; `wc -c docs/playground/<slug>.html` shows a single file; the external-deps check above prints `OK: no external deps`; opening the file in a browser shows the working visualization (manual check, record screenshot path in the commit body).

### Task 4: Capture a preview image for the playground link
- [ ] Take one screenshot of the playground in a browser at 1440x900 showing the concept being taught.
- [ ] Save as `docs/assets/playground-<slug>-preview.png` (PNG, under 400 KB — compress if larger).
- [ ] Verification: file exists; `ls -la docs/assets/playground-<slug>-preview.png` reports size <= 400 KB.

### Task 5: Rewrite README.md against the locked IA
- [ ] Create a backup reference: `cp README.md docs/plans/notes/2026-04-20-readme-before.md` (for the diff committed in Task 7; git history alone is sufficient but an explicit before-snapshot simplifies review).
- [ ] Rewrite `README.md` section by section following `docs/plans/notes/2026-04-20-readme-ia.md`. For each section marked `keeps_existing_copy: yes`, copy the existing text; for `partial`, keep the marked sentences; for `rewrite`, write fresh.
- [ ] Integrate the playground link using a clickable preview image: `[![<concept>](docs/assets/playground-<slug>-preview.png)](https://raw.githack.com/jccidc/.planenforcer/main/docs/playground/<slug>.html)` with an adjacent plain-text link `Open interactive: https://raw.githack.com/jccidc/.planenforcer/main/docs/playground/<slug>.html`.
- [ ] Keep install path (clone + `./install.sh` + `plan-enforcer doctor`) visible in section 1 or 2.
- [ ] Keep the "What we do not claim" credibility anchor (may be renamed but the narrow-claim content must remain).
- [ ] Confirm ASCII-only: `python -c "import sys; b=open('README.md','rb').read(); bad=[(i,b[i]) for i in range(len(b)) if b[i]>127]; print('NON_ASCII' if bad else 'ASCII_OK', len(bad))"` — expected output starts with `ASCII_OK`.
- [ ] Verification: `python` ASCII check prints `ASCII_OK 0`; the new README renders in GitHub preview (manual check on github.dev or the push preview) without broken image tags or broken links.

### Task 6: Run the link audit and brand-protection grep
- [ ] Extract old-README link set from the backup: `grep -oE '\]\(([^)]+)\)' docs/plans/notes/2026-04-20-readme-before.md | sort -u > docs/plans/notes/2026-04-20-links-before.txt`.
- [ ] Extract new-README link set: `grep -oE '\]\(([^)]+)\)' README.md | sort -u > docs/plans/notes/2026-04-20-links-after.txt`.
- [ ] Diff the two: `diff docs/plans/notes/2026-04-20-links-before.txt docs/plans/notes/2026-04-20-links-after.txt > docs/plans/notes/2026-04-20-links-diff.txt || true`.
- [ ] For every link in `links-before` missing from `links-after`, record in `docs/plans/notes/2026-04-20-link-audit.md`: original_link | status (retained | replaced_by:<new_link> | intentionally_removed:<reason>). No entry may be left blank.
- [ ] For every local path referenced in the new README, confirm it resolves on disk: `grep -oE '\]\((docs/[^) ]+|\\./[^) ]+)\)' README.md | sed -E 's/.*\]\(//; s/\)$//' | while read p; do [ -e "$p" ] || echo "MISSING: $p"; done` — expected output: empty (no MISSING lines).
- [ ] Run brand-protection grep: `grep -nE "reverse|closed.source|byte.for.byte|disassembler|no public spec|opcode parity|full parity|exact parity|official compiler|libgpc|Swizzy|gpcc|gpcd|gpcf|gpc-dev|Larry|Jimmy CrakCrn" README.md` — expected output: empty (grep returns exit 1 with no output).
- [ ] Verification: link-audit note committed with zero blank status cells; local-path resolver prints no `MISSING:` lines; brand grep prints nothing.

### Task 7: Capture first-viewport proof and commit the relaunch
- [ ] Push branch to a preview or open it locally; capture a screenshot of the relaunched `README.md` as GitHub renders it, cropped to the first viewport (~1440x900). Save as `docs/assets/readme-relaunch-first-viewport.png`, under 400 KB.
- [ ] Write a short one-paragraph "What a cold reader sees in the first viewport" note at the top of `docs/plans/notes/2026-04-20-readme-first-scan.md` describing what is answered (what PE does, who it is for) within that viewport.
- [ ] Stage the commit set: new `README.md`, `docs/playground/<slug>.html`, `docs/assets/playground-<slug>-preview.png`, `docs/assets/readme-relaunch-first-viewport.png`, and the three planning notes under `docs/plans/notes/`.
- [ ] Commit with subject `docs(readme): relaunch flow + playground visual layer` and include in the body: paths of the playground file, the two screenshots, and the link-audit note.
- [ ] Verification: `git log -1 --stat` shows all listed files in the one commit; `git diff HEAD~1 -- README.md | wc -l` is greater than 50 (confirms a real rewrite, not a trivial edit); opening the repo in GitHub web view (or github.dev) shows the new hero + install + playground link within the first viewport (manual check, screenshot already captured this turn).

## Assumptions

- The `playground` skill is functional and produces single-file self-contained HTML per its skill description. If it requires external deps at build time but outputs a self-contained file, that is acceptable; if its output requires a build step at view time, Task 3 stops and we surface the blocker.
- `raw.githack.com` remains a valid host for direct-view HTML from the GitHub repo. If the user prefers gh-pages, the URL format in Task 5 is updated before commit, not after.
- The public GitHub repo is `jccidc/.planenforcer` (per `memory/project_repo_location.md`). If the canonical public host differs at merge time, Task 5's playground URL is corrected before commit.
- `python` is available on PATH for the ASCII check in Task 5. If not, substitute `node -e "const b=require('fs').readFileSync('README.md');let n=0;for(const c of b)if(c>127)n++;console.log(n?'NON_ASCII '+n:'ASCII_OK 0')"` with the same expected output.
