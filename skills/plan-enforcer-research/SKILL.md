---
name: plan-enforcer-research
description: "Use before `plan-enforcer-draft` on any non-trivial plan to inspect the actual repo (structure, conventions, git history, relevant existing files) and produce a concrete research brief the drafter consumes, so the plan reflects what the codebase is rather than what sounded reasonable from the request alone."
---

# Plan Enforcer Research

Before drafting a plan, read the repo. Most plan quality problems
don't come from bad drafting — they come from drafting against
assumptions about a codebase that doesn't match reality. This skill
spends a few minutes inspecting the actual code and writes down what
it finds, so the drafter has real context to work from.

Distinct from `plan-enforcer:combobulate`: combobulate captures
**user intent** (what the user wants). This skill captures **repo
reality** (what exists, what conventions apply, what's in the way).
Both inputs feed `plan-enforcer-draft`. Each is optional; both
together produce the sharpest plans.

## When to use

Use this when the plan will:

- Modify code in areas of the repo you haven't read yet
- Add to an existing codebase with conventions you don't know
- Touch integration points (routes, models, middleware) where
  consistency matters
- Span more than a handful of tasks (medium + large plans benefit
  most)

Skip this when:

- The request is a trivial fix in code you already know
- The user says "skip research" or "I've briefed you already"
- A recent `.plan-enforcer/research.md` covers the area
  (mtime < 24h, scope overlaps the current request)

## What to inspect

Target the information that actually affects plan shape:

1. **Shape of the repo.** Language(s), framework(s), top-level
   directory conventions. Run `git ls-files | head -50` equivalent
   or list the src/ root. Note build + test commands from
   `package.json`, `Cargo.toml`, `pyproject.toml`, etc.
2. **Existing conventions in the area.** If adding a route, read
   two existing routes and note their shape (Router factory? inline
   app.get? middleware mounting order?). Don't guess.
3. **Recent git history in related files.** `git log --oneline -20`
   on the target files or directory. Patterns here reveal active
   refactors, recent deprecations, and contributor habits.
4. **Test + config constraints.** Which runner? Which lint rules?
   Strict TypeScript? Any jest.config or tsconfig `strict` flags
   that constrain shape?
5. **Gaps and tribal knowledge.** Anything that the drafter would
   need to know that isn't in the filenames — contradictions
   between README and code, TODOs in nearby files, recent commits
   reverting other work.

## Rules

1. Produce one file at `.plan-enforcer/research.md`. One per project;
   overwrite the prior one unless the user says otherwise.
2. Cite actual file paths and line numbers when possible. "src/
   routes/users.ts uses Router factory" is useful; "uses the Router
   pattern" is not.
3. Record what you *didn't* inspect. "Did not read src/db/ because
   out of scope for this plan" is helpful context for the drafter.
4. Do NOT propose tasks. This skill produces context, not plan.
5. Keep output under ~600 words. If you need more, the scope is
   probably multiple plans (split the request).
6. Quote exact strings from the repo when they matter — import
   statements, function signatures, commit subject lines. Don't
   paraphrase convention, show it.

## Recommended brief shape

```md
# Research: <short name for the area>

## Repo shape
<1-2 sentences: stack, top-level structure, build+test commands>

## Conventions in the target area
- <observed pattern with file:line reference>
- <observed pattern>

## Recent history (related files)
- <commit sha + subject> — <one-line what it did>
- <commit sha + subject>

## Constraints discovered
- <test runner, lint rules, strict flags, type guarantees>
- <anything that fails CI if violated>

## Gaps / tribal knowledge
- <contradiction, TODO, recent revert, deprecated pattern>
- <anything the drafter needs to know that isn't in filenames>

## What I did NOT inspect
- <areas explicitly skipped and why>
```

## Anti-patterns

Producing generic advice instead of repo-specific facts is the
failure mode. Smells:

- "Follow existing patterns" with no example — not helpful
- "Write tests" with no reference to existing test style — the
  drafter will invent one
- More than ~600 words — either the scope is too broad, or the
  author is speculating past what they read
- Any statement about behavior without a file or commit to back it
- Numbered task list in the brief — that's the drafter's job

## Handoff

After writing the brief:

- Tell the user the path (`.plan-enforcer/research.md`).
- Summarize the decisions captured in one line per section.
- Offer next step: "want me to draft the plan against this research
  (and the combobulate brief, if present)?" and wait.
