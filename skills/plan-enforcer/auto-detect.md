# Plan Auto-Detection Rules

Plan Enforcer reads any plan file and auto-detects its format to generate a task ledger. Check formats in priority order --- first match wins.

## Detection Priority

| Priority | Format              | Primary Signal                                  | Regex                                           |
|----------|---------------------|-------------------------------------------------|-------------------------------------------------|
| 1        | Superpowers writing  | `### Task N:` headers                           | `^### Task \d+:`                                |
| 2        | GSD phase plan       | File named `PLAN.md` or path has `.planning/`   | filename / path match                           |
| 3        | Markdown checklists  | `- [ ]` or `- [x]` lines                       | `^[\s]*- \[([ x])\]`                            |
| 4        | Numbered lists       | `1.` style items with actionable text           | `^\d+\.\s+\S`                                   |
| 5        | Headers-only         | `## Step`, `### Phase`, `## Task` with numbers  | `^#{2,3}\s+(Step\|Phase\|Task\|Part)\s+\d+`     |
| 6        | Unknown / fallback   | None of the above matched                       | ---                                             |

If a plan contains multiple formats (e.g., checklists inside numbered sections), use the highest-priority match.

---

## Format 1: Superpowers Writing Plans

**Signal:** `### Task N:` headers (regex: `^### Task \d+:`)
**Sub-signal:** `**Step N:**` sub-items under each task

**Extraction:** Each `### Task N:` = ledger group. Each `**Step N:**` = sub-row.

```markdown
### Task 1: Set up project scaffolding
**Step 1:** Initialize repo and install deps
**Step 2:** Configure build pipeline
### Task 2: Implement auth
```

| ID   | Task                          | Status  |
|------|-------------------------------|---------|
| T1   | Set up project scaffolding    | pending |
| T1.1 | Initialize repo and install   | pending |
| T1.2 | Configure build pipeline      | pending |
| T2   | Implement auth                | pending |

---

## Format 2: GSD Phase Plans

**Signal:** File named `PLAN.md` OR path contains `.planning/`
**Sub-signal:** `## Task` or numbered task headers with descriptions

**Extraction:** Each task block = ledger row.

```markdown
## Task 1: Database schema migration
Create tables for users, sessions, and audit log.

## Task 2: API endpoints
REST routes for CRUD operations.
```

| ID   | Task                        | Status  |
|------|-----------------------------|---------|
| T1   | Database schema migration   | pending |
| T2   | API endpoints               | pending |

---

## Format 3: Markdown Checklists

**Signal:** Lines matching `- [ ]` or `- [x]` (regex: `^[\s]*- \[([ x])\]`)

**Extraction:** Each checkbox = ledger row. Indentation creates hierarchy --- top-level items get T{N}, indented items get T{N}.{M}.

```markdown
- [ ] Build login page
  - [ ] Username/password form
  - [ ] OAuth buttons
- [x] Set up CI pipeline
```

| ID   | Task                    | Status   |
|------|-------------------------|----------|
| T1   | Build login page        | pending  |
| T1.1 | Username/password form  | pending  |
| T1.2 | OAuth buttons           | pending  |
| T2   | Set up CI pipeline      | verified |

Pre-checked `[x]` items start as **verified** in the ledger.

---

## Format 4: Numbered Lists

**Signal:** Lines matching `^\d+\.\s+\S` at start with actionable text

**Extraction:** Each numbered item = ledger row. Nested numbered items get hierarchical IDs.

```markdown
1. Design the database schema
2. Implement the API layer
   1. Auth middleware
   2. Route handlers
3. Write integration tests
```

| ID   | Task                       | Status  |
|------|----------------------------|---------|
| T1   | Design the database schema | pending |
| T2   | Implement the API layer    | pending |
| T2.1 | Auth middleware             | pending |
| T2.2 | Route handlers             | pending |
| T3   | Write integration tests    | pending |

---

## Format 5: Headers-Only

**Signal:** Section headers matching `^#{2,3}\s+(Step|Phase|Task|Part)\s+\d+`

**Extraction:** Each matching header = ledger row. First line of body text under header = task description.

```markdown
## Phase 1
Set up infrastructure and deploy skeleton.

## Phase 2
Build core feature set.
```

| ID   | Task                                        | Status  |
|------|---------------------------------------------|---------|
| T1   | Phase 1: Set up infrastructure and deploy   | pending |
| T2   | Phase 2: Build core feature set             | pending |

---

## Format 6: Unknown / Fallback

None of the above matched. Agent asks:

> I couldn't auto-detect the plan format. Which lines represent individual tasks?

User can highlight or describe the pattern, then the agent generates the ledger manually.

---

## Ledger Generation Output

After detection, present:

```
Plan Enforcer detected: {format name}
Found {N} tasks ({M} with sub-steps)
Generated ledger at .plan-enforcer/ledger.md

Please review the task list and confirm:
[Shows task ledger table]

Correct? (yes / edit / re-detect)
```

---

## Re-Detection (Plan Changes Mid-Execution)

If the source plan changes after the ledger exists:

1. Diff new plan against existing ledger
2. Flag: `"Plan changed. {N} new tasks, {M} removed, {K} modified."`
3. New tasks get next available T{N} IDs (never reuse old IDs)
4. Removed tasks get status **superseded** with a Decision Log entry
5. Modified tasks flagged for user review
6. User confirms before any changes are applied to the ledger
