# Master To Do

This is the canonical launch-stage to-do list for `Plan Enforcer`.

Use this instead of scattered notes when deciding what matters next.

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

## P0 — Must finish

### 1. Executed verification: move from Partial to Yes

**Why**

This is the biggest remaining moat gap. Evidence quality is much better
than before, but the product still does not prove every referenced
verification command ran and passed across the full surface.

**Done when**

- verification-command detection is broad enough to feel routine, not
  best-effort
- `verified` rows can reliably prove the referenced check actually ran
- red / stale / missing checks are surfaced clearly in operator-facing
  output
- capability matrix row 11 can be honestly upgraded from `Partial` to
  `Yes`

### 2. First-class product surfaces

**Why**

We are ahead only if the product feels like a real system, not a bag of
skills and hidden CLIs.

**Must feel first-class**

- `discuss`
- `draft`
- `review`
- `verify`
- `audit`
- `report`
- bring-your-own-plan
- crash / resume continuity

**Done when**

- each surface has clear public docs and examples
- entrypoints feel intentional, not internal
- ambiguous asks route through `discuss` cleanly
- legacy `combobulate` wording is no longer the public story

### 3. Operator polish

**Why**

Ahead of everybody is not just benchmark truth. It is whether a real
operator can install it, understand it, and recover from mistakes fast.

**Done when**

- install / setup / uninstall are boring and predictable
- status / report / audit output tells the user what to do next
- first-run flow is obvious
- error states are actionable, not just correct

---

## P1 — Next after P0

### 4. Dogfood depth

**Why**

One good dogfood proof is not enough. We need repeated real use on
code-changing work, not just synthetic confidence.

**Done when**

- multiple real repo work packages are completed under PE
- status / verify / audit / archive stay useful over time
- bugs found through dogfood are fixed through the same loop

### 5. Product-visible truth surfaces

**Why**

Lineage, dossier, closure, and final truth are part of the moat. They
should feel like product features, not internal leftovers.

**Done when**

- phase report is easy to read
- lineage is easy to inspect
- dossier / closure / final-truth artifacts are obvious in docs and
  examples
- public story can point at them without extra translation

### 6. Runtime / protocol tax trim

**Why**

We do not need to be the fastest. We do need to stay respectable and
remove ceremony that does not buy truth.

**Done when**

- known low-value ceremony is reduced
- operator friction goes down
- moat behavior stays intact

---

## P2 — Important, but after the above

### 7. Public examples library

Build clearer examples for:

- full authored path
- bring your own plan
- composability (`GSD + PE`, `Superpowers + PE`)
- resume / crash continuity
- verify / audit / report flow

### 8. Imported-plan story

Capability exists in practice but is still too fuzzy publicly.

**Done when**

- import path is documented clearly
- or a dedicated first-class import surface exists

### 9. Broader hybrid proof

Scenario H proved composability. More hybrid depth is useful, but it is
not a first-proof blocker anymore.

### 10. Legacy naming cleanup

Keep compatibility under the hood, but continue reducing public
`combobulate` leakage.

---

## Not first-order right now

Do not let these displace the main list:

- giant new benchmark spree
- more planning-only trap obsession
- roadmap-regression as moat headline
- blanket-superiority positioning
- broad refactors for aesthetic reasons
- more cleanup detours unless they block actual work

---

## If we want to be ahead

The shortest honest answer is:

1. full executed verification
2. first-class product surfaces
3. better operator experience
4. deeper dogfood proof
5. clearer truth surfaces
6. lower runtime / protocol tax

That is the real launch-stage list.
