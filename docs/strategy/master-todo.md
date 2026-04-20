# Master To Do

This is the canonical launch-stage to-do list for `Plan Enforcer`.

Use this instead of scattered notes when deciding what matters next.

## 2026-04-19 landed since the first launch pass

- executed verification is now a first-class product surface:
  - explicit `check_cmd`
  - status / logs / report visibility
  - active report path
- bring-your-own-plan is now first-class:
  - `plan-enforcer import`
  - launch-safe BYO examples
- public examples now exist for:
  - authored path
  - BYO plan
  - composability
  - resume continuity
  - verify / audit / report

That means the remaining list is narrower than when this file was first
written. The main open work is now repetition, polish, and continued
runtime hardening.

## Rule

- If a task does not make the product more **trustworthy**, more
  **first-class**, or more **usable**, it is probably not first-order.
- If a task only creates more benchmark noise without sharpening the
  launch claim, it is not first-order.
- Keep the public claim narrow:
  - execution is credible
  - authorship chain is real
  - carryover is the moat
  - composability is real
  - dogfood is real

---

## Must finish

### 1. Executed verification -> full, not partial

**Why**

This is still the biggest remaining moat gap.

Evidence quality is much better than before, but the product still does
not prove every referenced verification command ran and passed across
the full surface.

**Done when**

- verification-command detection is broad enough to feel routine, not
  best-effort
- `verified` rows can reliably prove the referenced check actually ran
  and passed
- red / stale / missing checks are surfaced clearly in operator-facing
  output
- capability matrix row 11 can be honestly upgraded from `Partial` to
  `Yes`

### 2. More real dogfood

**Why**

One good dogfood proof is not enough.

We need repeated real use on code-changing work, not synthetic-only
confidence.

**Done when**

- multiple real repo work packages are completed under PE
- status / verify / audit / archive stay useful over time
- bugs found through dogfood are fixed through the same loop
- operator loop still feels good after repetition, not just one clean
  demo

### 3. Operator polish

**Why**

Ahead of everybody is not just benchmark truth. It is whether a real
operator can install it, understand it, and recover from mistakes fast.

**Done when**

- install / setup / uninstall are boring and predictable
- first-run flow is obvious
- status / report / audit output tells the user what to do next
- error states are actionable, not just correct
- operator-facing docs match actual runtime behavior

### 4. Discuss flow polish

**Why**

`discuss` is first-class now, but it still needs cleaner routing and
less legacy leakage.

**Done when**

- ambiguous asks route through `discuss` cleanly and predictably
- `draft` is less allowed to guess through ambiguity
- public docs standardize on `discuss`
- legacy `combobulate` wording stays under the hood as compatibility,
  not public story

---

## Should do

### 5. Runtime tax trim

**Why**

We do not need to be the fastest. We do need to stay respectable and
remove ceremony that does not buy truth.

**Done when**

- known low-value ceremony is reduced
- operator friction goes down
- moat behavior stays intact

### 6. More product-visible truth surfaces

**Why**

Lineage, dossier, closure, and final truth are part of the moat. They
should feel like product features, not internal leftovers.

**Done when**

- phase report is easy to read
- lineage is easy to inspect
- dossier / closure / final-truth artifacts are obvious in docs and
  examples
- public story can point at them without extra translation

### 7. Public examples

Build clearer examples for:

- full authored path
- bring your own plan
- composability (`GSD + PE`, `Superpowers + PE`)
- resume / crash continuity
- verify / audit / report flow

---

## Nice to have

### 8. Provider-agnostic benchmark lane later

Not urgent for launch.

Useful later if we want OpenAI / Claude split shown cleanly without
mixing series.

### 9. Retire old naming fully

Keep compatibility under the hood, but continue reducing public
`combobulate` leakage over time.

---

## First-class surfaces still needed

These must feel like real product surfaces, not hidden skill internals:

- `discuss`
- `draft`
- `review`
- `verify`
- `audit`
- `report`
- bring-your-own-plan
- resume / crash continuity

**Done when**

- each surface has clear public docs and examples
- entrypoints feel intentional, not internal
- the public chain reads cleanly:
  - `discuss -> draft -> review -> execute -> verify`

---

## Deepen moat

These are the highest-value trust surfaces to keep sharpening:

- executed verification
- carryover / closure truth
- lineage / dossier

---

## Polish experience

Keep improving:

- install
- onboarding
- runtime tax

---

## What not to waste time on

Do not let these displace the main list:

- giant new benchmark spree
- more cleanup detours
- claiming blanket superiority
- roadmap-regression as moat headline
- planning-only trap obsession

---

## If we want to be ahead

Not more benchmarks.

The real answer is:

1. full executed verification
2. best carryover / chain of custody
3. better real operator experience
4. clean `discuss -> draft -> review` front end
5. dogfood that proves we live in it

---

## Blunt ranking

1. executed verification
2. operator polish
3. dogfood depth
4. runtime trim
5. examples / packaging
6. legacy naming cleanup
