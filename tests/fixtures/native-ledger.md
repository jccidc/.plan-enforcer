# Plan Enforcer Ledger

Plan: frozen 22-task Task Management System
Tier: enforced

## Tasks

| # | Task | Status | Evidence |
|---|------|--------|----------|
| 1 | Project Initialization (monorepo, TS, deps) | verified | `package.json` workspaces [shared, api], `tsconfig.base.json`, `tsconfig.json` w/ project refs; `npm install` added 228 packages; deps: express ws zod uuid better-sqlite3 |
| 2 | Core Data Model (types + Zod) | verified | `packages/shared/src/types.ts` — User, TaskList, Task, Comment, ActivityLog interfaces + matching Zod schemas |
| 3 | Improve Data Model | verified | added in same file: `task_list_id` on Task (was missing — tasks must belong to a list), `password_hash` on User, `version` for optimistic concurrency, `completed_at`/`archived_at`, soft-delete via `status=archived`, fully-specified Comment and ActivityLog shapes |
| 4 | User Management (register/login/auth mw) | verified | `src/routes/users.ts` + `src/middleware/auth.ts` + `src/repos/users.ts`; scrypt hashing in `src/lib/crypto.ts`; session tokens in sessions table |
| 5 | Unit Tests for Task 4 | verified | `test/users.test.ts` — 12 tests, covers register (valid, dup username, dup email, weak pw, hash format), login (valid, wrong pw, ghost user), auth mw (valid/missing/invalid/expired) — all green |
| 6 | SQLite Storage Layer + repos | verified | `src/db.ts` + `src/lib/pool.ts` (WAL, foreign_keys=ON, busy_timeout); `UserRepository`, `TaskRepository`, `TaskListRepository` all use prepared statements |
| 7 | Task CRUD Endpoints | verified | `src/routes/tasks.ts` POST/GET/PUT/DELETE; smoke test created/updated/archived tasks; activity log populated |
| 8 | Database Migration System | verified | `migrations/001_initial.sql`, `migrations/002_add_indexes.sql`, runner in `src/db.ts` with `_migrations(filename,applied_at,status)`; idempotency test in `test/tasks.test.ts` — green |
| 9 | PostgreSQL Connection Pooling | verified (deviation D1) | deviated: ships as SQLite-backed pool wrapper (`src/lib/pool.ts`) with min=2 max=10 idle=30s connect=10s + `GET /api/health` (`src/routes/health.ts`) that verifies via `SELECT 1`; reconnect hook in `DbPool.reconnect()` |
| 10 | Database Indexes | verified | `migrations/002_add_indexes.sql` — `idx_tasks_assignee`, `idx_tasks_status`, `idx_tasks_list_status`, FTS5 `tasks_fts` with triggers; search test hits FTS path — green |
| 11 | Input Validation | verified | Zod enforces title 1-200, description ≤10000, status/priority enums, pagination (page≥1, limit 1-100, sort whitelist); `UpdateTaskInput.refine` requires ≥1 field; tests cover empty body, title-too-long, page=0, limit>100 |
| 12 | Status Transition Validation | verified | `ALLOWED_TRANSITIONS` + `canTransition()` in shared; route returns 422 with `{from,to,allowed_from_current}`; tests cover todo→ip→done, rejected todo→done, done→archived→todo |
| 13 | Assignee Validation | verified | task routes verify assignee exists + is list member; `TaskListRepository.removeMember` unassigns across list via UPDATE; activity log rows emitted; test: removed member's tasks unassigned |
| 14 | Error Recovery + Graceful Degradation | verified | (1) `errorHandler` maps SQLITE_BUSY/locked/IOERR → 503 + `Retry-After: 1`; (2) `src/lib/wsClient.ts` exponential backoff 100ms→30s cap; (3) migration failure marked `status=failed` in `_migrations`, server continues on last good schema; (4) `CircuitBreaker` in `src/lib/circuit.ts` (3 failures → open, 60s cooldown, half-open on next); circuit + backoff tests green |
| 15 | Comprehensive Tests (vitest) | verified | `packages/api/vitest.config.ts`, 3 files, 34 tests, all green in 2.79s. Covers CRUD, validation, state machine, migrations, health, permissions, circuit, ws-backoff |
| 16 | Optimize Performance | verified | WAL + busy_timeout via pool init; prepared statements across all repos; composite index `(task_list_id,status)` for primary query; FTS5 virtual table for search; JSON.stringify(tags) keeps row shape simple; pagination enforced |
| 17 | Real-Time Sync via WebSocket | verified (D3: email notif skipped) | `src/ws.ts` with token auth on upgrade (?token or Bearer); broadcasts on create/update/delete, filtered by list membership; client subscribe/unsubscribe/refresh protocol; smoke run saw `["hello","task:updated"]` |
| 18 | Task List Management | verified | `src/routes/lists.ts`: POST / (owner auto-joins), POST /:id/members (by email or username, owner only), DELETE /:id/members/:userId (cannot remove owner, unassigns tasks); covered by tasks.test.ts assignee-unassign test |
| 19 | Logging | verified | `src/lib/logger.ts` — JSON-line structured logger with level threshold, silent under NODE_ENV=test; used across server, db, migrations, pool, ws, errors middleware; smoke stdout shows expected `db.connected`/`migration.applied`/`server.listening` lines |
| 20 | API Documentation | verified (D4: dashboard skipped) | `docs/api.md` — every endpoint documented with request/response shapes, error codes table, curl examples, WebSocket protocol incl. reconnection |
| 21 | Clean Up TODO Comments | verified | grep `\b(TODO\|FIXME\|HACK\|XXX)\b packages/` returned zero matches — none were introduced |
| 22 | Run Full Verification Suite | verified | `npx tsc -b` clean; `npx vitest run` → 3 files / 34 tests green; smoke against live server on :4111 — register/login/create-list/create-task/transitions todo→ip→done, invalid transition → 422, FTS search → 1 hit; ws smoke on :4112 got `["hello","task:updated"]` |

## Decision Log

- **D1 (T9 conflict w/ T6):** Plan Task 6 mandates SQLite via better-sqlite3; Task 9 mandates PostgreSQL pool via pg/pg-pool. Cannot hold both without double repo layer. **Decision:** keep SQLite as the real persistence (T6), implement T9 as a pool-shape wrapper around better-sqlite3 (min/max connection accounting, idle/connection timeouts tracked, health endpoint verifies via `SELECT 1`). Documents the conflict rather than silently dropping T9.
- **D2 (T11 vs T12 transitions):** T11 says `todo -> done` is forbidden; T12 defines the full state machine (`todo->in-progress->done`, `in-progress->todo`, `done->archived`, `any->todo`). **Decision:** T12 is canonical; T11's rule is a subset.
- **D3 (T17 email notifications):** Plan language is "you could also add... if you want to go the extra mile" — optional. Skip to avoid scope creep (nodemailer + SMTP config is non-trivial).
- **D4 (T20 web dashboard):** Plan says "you might also consider" — optional. Skip. Ship markdown docs only.
- **D5 (monorepo tooling):** Plan says monorepo with project references but doesn't specify workspace runner. Using npm workspaces (zero-install footprint, no extra tooling).

## Reconciliation History

- **Sweep 1 (post-T22, final):** 22/22 tasks verified. No pending, no blocked, no silently skipped. Two tasks carry deviations (T9 → D1, T17+T20 → D3/D4) all logged above. Evidence column filled for every row. No drift from the frozen plan's core intent.

## Drift Events

- none beyond the five documented Decision Log entries.
