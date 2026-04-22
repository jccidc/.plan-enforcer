const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { execFileSync } = require('child_process');
const { extractMustHaves, extractMustHaveRows } = require('../src/plan-detector');
const { buildAwarenessCoverage, scoreMustHave, parseArgs } = require('../src/verify-cli');
const { parseTaskRows } = require('../src/ledger-parser');
const { parseAwareness } = require('../src/awareness-parser');

const CLI = path.join(__dirname, '..', 'src', 'verify-cli.js');

const PLAN_WITH_MH = `# Build X

## Must-Haves

- MH1: Users can sign up and log in
- MH2: Posts can be created, read, updated
- **MH3: Full-text search over post bodies**

## Tasks

- Task 1: Setup
`;

function mkProject(planContent, ledgerContent) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'pe-verify-'));
  fs.writeFileSync(path.join(dir, 'package.json'), '{"name":"t"}');
  fs.mkdirSync(path.join(dir, 'docs', 'plans'), { recursive: true });
  fs.writeFileSync(path.join(dir, 'docs', 'plans', 'p.md'), planContent);
  const enforcer = path.join(dir, '.plan-enforcer');
  fs.mkdirSync(enforcer);
  fs.writeFileSync(path.join(enforcer, 'config.md'), '---\ntier: structural\n---\n');
  fs.writeFileSync(path.join(enforcer, 'ledger.md'), ledgerContent);
  return dir;
}

function runCli(cwd, args) {
  try {
    return {
      code: 0,
      stdout: execFileSync(process.execPath, [CLI, ...(args || [])], { cwd, stdio: ['ignore', 'pipe', 'pipe'] }).toString(),
      stderr: ''
    };
  } catch (e) {
    return {
      code: e.status,
      stdout: (e.stdout || Buffer.from('')).toString(),
      stderr: (e.stderr || Buffer.from('')).toString()
    };
  }
}

describe('extractMustHaves', () => {
  it('pulls MH1-MH3 from the fixture', () => {
    const mh = extractMustHaves(PLAN_WITH_MH);
    assert.equal(mh.length, 3);
    assert.match(mh[0], /sign up and log in/);
    assert.match(mh[2], /Full-text search/);
  });

  it('empty when no section', () => {
    assert.deepEqual(extractMustHaves('# Plan\n\nNo must haves here.'), []);
  });

  it('handles "Must Haves" variant (no hyphen)', () => {
    const p = '# Plan\n\n## Must Haves\n\n- MH1: thing one\n- MH2: thing two\n';
    assert.equal(extractMustHaves(p).length, 2);
  });

  it('stops at next ## header', () => {
    const p = '## Must-Haves\n\n- MH1: one\n- MH2: two\n\n## Other\n\n- not an MH\n';
    assert.equal(extractMustHaves(p).length, 2);
  });

  it('stops at next deeper markdown header too', () => {
    const p = '## Must-Haves\n\n- MH1: one\n\n### Task 1: build it\n- [ ] not a must-have\n';
    assert.equal(extractMustHaves(p).length, 1);
  });

  it('parses awareness refs on must-haves', () => {
    const rows = extractMustHaveRows('## Must-Haves\n\n- MH1: thing one A:I1\n- MH2: thing two A:R1\n');
    assert.deepEqual(rows, [
      { tag: 'MH1', text: 'thing one', awarenessRefs: ['I1'] },
      { tag: 'MH2', text: 'thing two', awarenessRefs: ['R1'] }
    ]);
  });
});

describe('scoreMustHave', () => {
  const taskRows = [
    { id: 'T1', status: 'verified', evidence: 'covers MH1, src/auth.ts', notes: '', chain: ['D1'] },
    { id: 'T2', status: 'pending',  evidence: '', notes: 'will address MH2', chain: [] }
  ];
  const decisions = [
    { id: 'D1', type: 'deviation', scope: 'MH1', reason: 'chose bcrypt', evidence: '' }
  ];

  it('PASS when any task row verifies the MH', () => {
    const r = scoreMustHave('Users can sign up', 0, taskRows, decisions);
    assert.equal(r.verdict, 'PASS');
  });

  it('PARTIAL when only non-verified task or decisions touch MH', () => {
    const r = scoreMustHave('Posts CRUD', 1, taskRows, decisions);
    assert.equal(r.verdict, 'PARTIAL');
  });

  it('UNKNOWN when nothing references the MH', () => {
    const r = scoreMustHave('Full-text search', 2, taskRows, decisions);
    assert.equal(r.verdict, 'UNKNOWN');
  });
});

describe('parseArgs', () => {
  it('parses --ledger + --plan + --json + --with-awareness', () => {
    const args = parseArgs(['--ledger', 'l.md', '--plan', 'p.md', '--with-awareness', '--awareness', 'a.md', '--json']);
    assert.equal(args.ledger, 'l.md');
    assert.equal(args.plan, 'p.md');
    assert.equal(args.awareness, 'a.md');
    assert.equal(args.withAwareness, true);
    assert.equal(args.json, true);
  });
});

describe('buildAwarenessCoverage', () => {
  it('reports active intents with no must-have or task target', () => {
    const state = parseAwareness([
      '# Awareness',
      '<!-- schema: v1 -->',
      '',
      '## Project-level intents',
      '',
      '| ID | Quote | Source | Captured |',
      '|----|-------|--------|----------|',
      '| I1 | keep replay honest | test | 2026-04-19 |',
      '| I2 | export explicit closure | test | 2026-04-19 |',
      '',
      '## This-session intents',
      '',
      '| ID | Quote | Source | Captured |',
      '|----|-------|--------|----------|',
      '',
      '## Restate rows',
      '',
      '| ID | Summary | Refs | Captured |',
      '|----|---------|------|----------|',
      '',
      '## Correction rows',
      '',
      '| ID | Type | Refs | Note | Captured |',
      '|----|------|------|------|----------|'
    ].join('\n'));
    const ledger = [
      '# Ledger',
      '<!-- schema: v2 -->',
      '',
      '## Task Ledger',
      '',
      '| ID  | Task | Status | Evidence | Chain | Notes |',
      '|-----|------|--------|----------|-------|-------|',
      '| T1  | Keep replay honest | verified | src/replay.js | A:I1 | |',
      '',
      '## Decision Log',
      '| ID | Type | Scope | Reason | Evidence |',
      '|----|------|-------|--------|----------|',
      ''
    ].join('\n');
    const awareness = buildAwarenessCoverage(
      [{ tag: 'MH1', text: 'Keep replay honest', awarenessRefs: ['I1'] }],
      parseTaskRows(ledger),
      state
    );
    assert.equal(awareness.initialized, true);
    assert.deepEqual(awareness.issues.map((issue) => issue.row), ['I2']);
  });
});

describe('verify-cli end-to-end', () => {
  const LEDGER_SOME_PASS = `# Plan Enforcer Ledger
<!-- schema: v2 -->
<!-- source: docs/plans/p.md -->

## Task Ledger

| ID | Task | Status   | Evidence         | Chain | Notes |
|----|------|----------|------------------|-------|-------|
| T1 | Auth | verified | satisfies MH1    |       |       |
| T2 | CRUD | pending  |                  |       | MH2   |

## Decision Log

| ID | Type | Scope | Reason | Evidence |
|----|------|-------|--------|----------|
`;

  it('exits 1 when some must-haves not PASS', () => {
    const dir = mkProject(PLAN_WITH_MH, LEDGER_SOME_PASS);
    const r = runCli(dir, []);
    assert.equal(r.code, 1);
    assert.match(r.stdout, /must-have/i);
    assert.match(r.stdout, /MH3/);
  });

  it('exits 0 when all PASS', () => {
    const allPass = LEDGER_SOME_PASS.replace(
      '| T2 | CRUD | pending  |                  |       | MH2   |',
      '| T2 | CRUD | verified | MH2 MH3 done     |       |       |'
    );
    const dir = mkProject(PLAN_WITH_MH, allPass);
    const r = runCli(dir, []);
    assert.equal(r.code, 0);
  });

  it('--json emits structured output', () => {
    const dir = mkProject(PLAN_WITH_MH, LEDGER_SOME_PASS);
    const r = runCli(dir, ['--json']);
    const parsed = JSON.parse(r.stdout);
    assert.equal(parsed.total, 3);
    assert.ok(parsed.results.length === 3);
  });

  it('--with-awareness fails when must-haves have no linked intent refs', () => {
    const dir = mkProject(PLAN_WITH_MH, LEDGER_SOME_PASS);
    fs.writeFileSync(path.join(dir, '.plan-enforcer', 'awareness.md'), [
      '# Awareness',
      '<!-- schema: v1 -->',
      '',
      '## Project-level intents',
      '',
      '| ID | Quote | Source | Captured |',
      '|----|-------|--------|----------|',
      '| I1 | users can sign up and log in | test | 2026-04-19 |',
      '',
      '## This-session intents',
      '',
      '| ID | Quote | Source | Captured |',
      '|----|-------|--------|----------|',
      '',
      '## Restate rows',
      '',
      '| ID | Summary | Refs | Captured |',
      '|----|---------|------|----------|',
      '',
      '## Correction rows',
      '',
      '| ID | Type | Refs | Note | Captured |',
      '|----|------|------|------|----------|'
    ].join('\n'));

    const r = runCli(dir, ['--with-awareness', '--json']);
    assert.equal(r.code, 1);
    const parsed = JSON.parse(r.stdout);
    assert.equal(parsed.awareness.initialized, true);
    assert.equal(parsed.results[0].awareness_issues[0].code, 'MH_NO_INTENT_LINK');
  });

  it('--with-awareness surfaces orphan intents as INTENT_NO_TARGET', () => {
    const plan = `# Build X

## Must-Haves

- MH1: Users can sign up and log in A:I1
- MH2: Posts can be created, read, updated A:I2

## Tasks

- Task 1: Setup
`;
    const ledger = `# Plan Enforcer Ledger
<!-- schema: v2 -->
<!-- source: docs/plans/p.md -->

## Task Ledger

| ID | Task | Status   | Evidence      | Chain | Notes |
|----|------|----------|---------------|-------|-------|
| T1 | Auth | verified | satisfies MH1 | A:I1  |       |

## Decision Log

| ID | Type | Scope | Reason | Evidence |
|----|------|-------|--------|----------|
`;
    const dir = mkProject(plan, ledger);
    fs.writeFileSync(path.join(dir, '.plan-enforcer', 'awareness.md'), [
      '# Awareness',
      '<!-- schema: v1 -->',
      '',
      '## Project-level intents',
      '',
      '| ID | Quote | Source | Captured |',
      '|----|-------|--------|----------|',
      '| I1 | users can sign up and log in | test | 2026-04-19 |',
      '| I2 | posts can be created, read, updated | test | 2026-04-19 |',
      '| I3 | full-text search over post bodies | test | 2026-04-19 |',
      '',
      '## This-session intents',
      '',
      '| ID | Quote | Source | Captured |',
      '|----|-------|--------|----------|',
      '',
      '## Restate rows',
      '',
      '| ID | Summary | Refs | Captured |',
      '|----|---------|------|----------|',
      '',
      '## Correction rows',
      '',
      '| ID | Type | Refs | Note | Captured |',
      '|----|------|------|------|----------|'
    ].join('\n'));

    const r = runCli(dir, ['--with-awareness', '--json']);
    assert.equal(r.code, 1);
    const parsed = JSON.parse(r.stdout);
    assert.equal(parsed.awareness.issues[0].code, 'INTENT_NO_TARGET');
    assert.equal(parsed.awareness.issues[0].row, 'I3');
  });

  it('exits 2 when no ledger', () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'pe-verify-none-'));
    fs.writeFileSync(path.join(dir, 'package.json'), '{"name":"t"}');
    const r = runCli(dir, []);
    assert.equal(r.code, 2);
  });
});
