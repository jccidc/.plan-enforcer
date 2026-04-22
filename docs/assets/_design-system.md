# Plan Enforcer README Visual System

Design tokens and rules for every SVG asset in this directory. Any
new figure that ships with the README must conform to this spec.

The motif is **terminal-native dark**: monospace typography, ledger-
or shell-style chrome, ANSI-discipline palette. One language across
every figure; varied content within.

---

## Palette tokens (hex, ASCII names)

Use these tokens by name in figure source comments where helpful.
Values are exact; do not introduce off-spec near-shades.

| Token          | Hex       | Role                                                |
|----------------|-----------|-----------------------------------------------------|
| `bg`           | `#0b0d10` | canvas / page background                            |
| `bg-elev`      | `#14171c` | lifted panel (terminal body, ledger row card)       |
| `fg`           | `#d8e1ec` | primary text                                        |
| `fg-dim`       | `#6f7a8c` | secondary text, muted commentary, "without" state   |
| `accent-cyan`  | `#1aadd9` | primary accent: prompts, eyebrow labels, hot rules  |
| `accent-green` | `#3ec07a` | with / sealed / verified / pass states              |
| `accent-amber` | `#e0b04a` | warning / caution / warn-only states                |
| `accent-mag`   | `#b480d8` | decision / pivot states (use sparingly)             |
| `rule`         | `#2a2f38` | thin separators, panel borders                      |

Nine tokens. Every figure picks from this set; nothing else.

---

## Typography scale

Stack (every figure): `ui-monospace, Menlo, Consolas, monospace`.
No external font requests, no sans paired in. Mono everywhere.

| Size  | Use                                                                  |
|-------|----------------------------------------------------------------------|
| 9px   | eyebrow caps (`STAGE 03 . EXEC`, `FAILURE . 02`)                     |
| 10px  | label caps (`ASK`, `PLAN`, panel headers)                            |
| 11px  | body text, code lines, file paths, prompt output                     |
| 13px  | subheads, panel titles                                               |
| 16px  | section header (rare; used inside hero only)                         |
| 22px  | hero title (allowed only inside hero figure)                         |

Letter-spacing: `0.18em` on caps levels (9px and 10px). `0` on body.
`-0.01em` on hero title only.

Weight: regular for body. `font-weight="700"` only on the immediate
focal element of a row (file path on a ledger row, headline on a
panel). Avoid bold elsewhere.

---

## Chrome families

Two chromes. Pick the one that fits the figure's content. Do not
invent a third without updating this spec.

### A. terminal-window

Frame: 22px titlebar in `bg`, body in `bg-elev`, 1px `rule`-color
border around the whole panel.

Titlebar contents (left to right):
- prompt indicator in 10px `fg-dim` caps: `~/repo $`
- empty middle
- small filled circle `accent-cyan`, radius 3, near right edge

Body: shell session. Prompts (`$`) in `fg-dim`. Commands in `fg`.
Output lines in `accent-green` if pass, `accent-amber` if warn,
`fg-dim` if neutral. Use 11px body throughout.

### B. ledger-row

Each row: 4px-wide left bar in an accent token (`accent-cyan` for
neutral, `accent-green` for sealed/with, `accent-amber` for warn,
`accent-mag` for decision rows). Body in `bg-elev`, 1px `rule`
border.

Row contents (left to right):
- 9px eyebrow caps in the same color as the left bar (`STAGE 03 . EXEC`)
- 13px subhead in `fg` (the headline)
- 11px body in `fg-dim` (the explanation)
- optional right-aligned 11px status indicator (`ok`, `superseded`,
  file path)

Rows stack vertically with 8px gaps.

---

## Motif rules (case-file trace)

The forensic case-file motif (`CASE No. PE-0427`, `FILED <date>`,
`SEALED`, `CUSTODIAN`, `CUT LINE`) is **allowed in exactly one place**:

- The header band on the hero figure, and only there.

It is **banned**:

- Inside any other figure body
- Inside any caption
- Inside README body prose below the title block

The motif is a flavor accent, not a structural element. One tasteful
trace, no more.

---

## ASCII-only rule

Every SVG text node must be plain ASCII. The verification grep:

```sh
grep -P '[^\x00-\x7F]' docs/assets/*.svg
```

Expected output: empty. Specifically banned:

- Unicode box-drawing chars (`U+2500`-`U+257F`) — use `-`, `|`, `+`
  if you need ASCII boxes
- Smart quotes — use straight `"` and `'`
- Emojis
- Arrows like `→` `←` `↑` — use `->`, `<-`, `^`
- Bullets like `•` — use `*` or `-`
- Em-dash `—` — use `--`
- Middle-dot `·` — use `.` or `*`

---

## viewBox conventions

| Figure type    | viewBox       | Notes                                  |
|----------------|---------------|----------------------------------------|
| hero           | `960 540`     | one per README; allowed wider canvas    |
| standard wide  | `720 420`     | most concept figures                   |
| standard short | `720 360`     | shell sessions, scored bars            |

Native render target: 720px effective width on github.com. Hero must
remain legible when GitHub scales it. Test every figure at 720px and
390px (iPhone width) before declaring done.

---

## Accessibility

Every SVG file must include:

```xml
<svg ... role="img" aria-label="<one sentence describing what the figure shows>">
```

Caption in the README adds interpretation; `aria-label` describes
the visible content. They are not the same string.

---

## Spacing

Outer canvas padding: 24px from any figure edge to the first frame.
Inter-row gap inside a figure: 8px. Inter-panel gap (e.g., diptych):
24px. Avoid optical crowding; favor whitespace over density at this
size.

---

## What this spec is NOT

It is not a component library. Tokens and rules; figures still
hand-authored. If a figure needs something not listed here, either
update this spec first or pick a different shape.
