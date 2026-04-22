# README Outline — Terminal-Native Rebuild

Companion to `2026-04-21-readme-visuals-rebuild.md`. Locks the new
section order, the figure anchoring each section, and a one-sentence
prose plan per section before any prose is written.

Total figures: **6** (1 hero + 5 standard). At the cap from the plan.

---

## Section order and anchors

### Title block
- **Figure:** `hero-git-log.svg` (the only place the case-file motif
  appears)
- **Prose plan (1 sentence):** Open with the strongest contrast we
  have — same week of work, two git logs; one is recoverable, one
  isn't.

### 01 / Install
- **Figure:** `install.svg` — terminal session: clone, install,
  doctor, discuss. The four wired surfaces visible in output lines.
- **Prose plan (1 sentence):** Sixty seconds; one ledger; nothing
  written outside the repo.

### 02 / The Custody Chain
- **Figure:** `custody-chain.svg` — six ledger rows, one per stage
  (`ASK / PLAN / EXEC / DECIDE / VERIFY / LAND`), each row showing
  the receipt file path and status indicator.
- **Prose plan (1 sentence):** Every stage leaves a file; the chain
  is what links the original ask to the repo state that shipped.

### 03 / Three Layers
- **Figure:** `three-layers.svg` — three horizontal lanes
  (Authorship / Execution / Truth) crossing the six-stage timeline,
  each lane labeled with the file it owns.
- **Prose plan (1 sentence):** Where the chain actually comes from —
  three layers, one custody.

### 04 / Bring Your Own Plan
- **Figure:** `byo-plan.svg` — three input plan formats (`gsd`,
  `superpowers`, freeform `.md`) flowing through one normalizer band
  into one ledger entry.
- **Prose plan (1 sentence):** Whichever plan format you bring, the
  ledger row at the end has one shape — and that shape is what
  audits.

### 05 / Best Fit
- **Figure:** `best-fit.svg` — five scored horizontal bars
  (`duration / risk / auditability / handoff / evidence`); strong-fit
  example on top with full bars, less-suited example below with
  empty bars.
- **Prose plan (1 sentence):** When the bars fill, you are already
  paying the cost of custody somewhere; when they stay empty, this
  is overhead you don't need.

### 06 / Claim
- **Figure:** none (text alone closes).
- **Prose plan (1 sentence):** Claim stated narrowly — chain of
  custody for AI coding, scoped to the four moments where AI work
  gets slippery (mutation, interruption, scrutiny, final review).

### Footer
- **Figure:** none.
- **Contents:** proof pack links (current `docs/proof/*.md` set),
  contribution note, MIT license link.

---

## Concept map — every current concept lands somewhere

| Current README slot                            | New home                                    |
|------------------------------------------------|---------------------------------------------|
| 01 Install (code block)                        | New 01                                      |
| 01 Without/With table                          | folded into hero diptych                    |
| 02 What This Makes Provable (provable-surfaces fig) | folded into New 02 (custody chain)     |
| 03 Three Layers (three-layers fig)             | New 03                                      |
| 04 What It Catches (what-it-catches fig)       | folded into New 02 + hero                   |
| 04 git-log diptych                             | becomes hero                                |
| 05 Bring Your Own Plan (stack + workflow figs) | New 04                                      |
| 05 Proof pack links                            | moved to footer back-matter                 |
| 05 Visual proof surfaces links                 | moved to footer back-matter                 |
| 06 Best Fit (best-fit fig)                     | New 05                                      |
| 07 Claim (claim fig)                           | New 06 (no fig; text-only close)            |

Nothing dropped. Three current concepts (provable-surfaces, what-it-
catches, claim) lose their dedicated figure because their substance
is already carried by the custody-chain figure or the hero. The
written prose still names them.

---

## Figure-to-concept inventory (6 final figures)

| File                        | Concept                                  | viewBox    |
|-----------------------------|------------------------------------------|------------|
| `hero-git-log.svg`          | before/after git log; the whole pitch    | 960 540    |
| `install.svg`               | terminal session: clone + install + doctor + discuss | 720 360 |
| `custody-chain.svg`         | six stages of custody as ledger rows     | 720 420    |
| `three-layers.svg`          | three layers crossing the timeline       | 720 420    |
| `byo-plan.svg`              | three plan formats normalized to one row | 720 360    |
| `best-fit.svg`              | five scored bars; strong-fit vs less-suited | 720 360 |

---

## Prose density rule

Every numbered section ends up with at least one prose paragraph in
addition to figure + caption. No section is just figure + caption.
Captions add interpretation (what to notice / what it proves), not a
restatement of the alt text.

---

## What this outline is NOT

It is not the prose itself. The prose lands in Task 5 of the plan.
This document only locks the structure so prose can be written
against a frozen target.
