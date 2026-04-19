// Tests for P4 CLIs: chain, why, audit, export, lint, dispatcher.
// Each CLI gets happy-path + one edge case per roadmap P4 T9.

const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { execFileSync } = require('child_process');

const SRC = path.join(__dirname, '..', 'src');
const BINS = {
  chain: path.join(SRC, 'chain-cli.js'),
  why: path.join(SRC, 'why-cli.js'),
  audit: path.join(SRC, 'audit-cli.js'),
  export: path.join(SRC, 'export-cli.js'),
  lint: path.join(SRC, 'lint-cli.js'),
  dispatcher: path.join(SRC, 'plan-enforcer-cli.js')
};

// Canonical clean v2 ledger used by happy-path tests. Schema + three
// sections, one verified task row with a resolvable file-path evidence
// cell, one pivot D-row that mentions T1.
const CLEAN_LEDGER = `# Plan Enforcer Ledger
<!-- schema: v2 -->
<!-- source: docs/plans/test.md -->
<!-- tier: structural -->
<!-- created: 2026-04-12T00:00:00Z -->

## Scoreboard
 1 total  |  0 done  |  1 verified  |  0 skipped  |  0 blocked  |  0 remaining
 Drift: 0  |  Last reconcile: none  |  Tier: structural

## Task Ledger

| ID  | Task      | Status   | Evidence            | Chain | Notes |
|-----|-----------|----------|---------------------|-------|-------|
| T1  | do a thing | verified | wired.js is present |       |       |

## Decision Log

| ID | Type  | Scope      | Reason      | Evidence     |
|----|-------|------------|-------------|--------------|
| D1 | pivot | T1; ROADMAP | testing pivot | eye-witness |

## Reconciliation History

| Round | Tasks Checked | Gaps Found | Action Taken |
|-------|---------------|------------|--------------|
`;

function mkProject(ledger) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'pe-p4-'));
  fs.writeFileSync(path.join(dir, 'package.json'), '{"name":"t"}');
  const enforcer = path.join(dir, '.plan-enforcer');
  fs.mkdirSync(enforcer);
  fs.writeFileSync(path.join(enforcer, 'ledger.md'), ledger);
  // Seed the evidence-referenced file so file-path signals resolve.
  fs.writeFileSync(path.join(dir, 'wired.js'), '// test fixture\n');
  return dir;
}

function run(bin, args, cwd) {
  try {
    const stdout = execFileSync(process.execPath, [bin, ...(args || [])], {
      cwd,
      stdio: ['ignore', 'pipe', 'pipe']
    }).toString();
    return { code: 0, stdout, stderr: '' };
  } catch (e) {
    return {
      code: e.status,
      stdout: (e.stdout || Buffer.from('')).toString(),
      stderr: (e.stderr || Buffer.from('')).toString()
    };
  }
}

describe('plan-enforcer-chain', () => {
  it('happy: prints chain for a task and exits 0', () => {
    const dir = mkProject(CLEAN_LEDGER);
    const r = run(BINS.chain, ['T1'], dir);
    assert.equal(r.code, 0);
    assert.match(r.stdout, /Chain for T1/);
    assert.match(r.stdout, /do a thing/);
    // D1 scopes T1 via Scope cell
    assert.match(r.stdout, /D1/);
  });

  it('edge: unknown task exits 1 with not-found', () => {
    const dir = mkProject(CLEAN_LEDGER);
    const r = run(BINS.chain, ['T999'], dir);
    assert.equal(r.code, 1);
    assert.match(r.stderr, /not found/i);
  });
});

describe('plan-enforcer-why', () => {
  it('happy: finds ledger hit on a file referenced by a task row', () => {
    const dir = mkProject(CLEAN_LEDGER);
    const r = run(BINS.why, ['wired.js'], dir);
    assert.equal(r.code, 0);
    assert.match(r.stdout, /T1/);
  });

  it('edge: file with zero hits exits 1 cleanly', () => {
    const dir = mkProject(CLEAN_LEDGER);
    const r = run(BINS.why, ['no-such-file.js'], dir);
    assert.equal(r.code, 1);
    assert.match(r.stdout, /no D-row scopes this file|No ledger row references/);
  });
});

describe('plan-enforcer-audit', () => {
  it('happy: clean ledger audits with zero findings', () => {
    const dir = mkProject(CLEAN_LEDGER);
    const r = run(BINS.audit, [], dir);
    assert.equal(r.code, 0);
    assert.match(r.stdout, /Clean\. No integrity issues/);
  });

  it('edge: dangling D-ref in Chain → error + strict exits 1', () => {
    const bad = CLEAN_LEDGER.replace(
      '| T1  | do a thing | verified | wired.js is present |       |       |',
      '| T1  | do a thing | verified | wired.js is present | D99   |       |'
    );
    const dir = mkProject(bad);
    const r = run(BINS.audit, ['--strict'], dir);
    assert.equal(r.code, 1);
    assert.match(r.stdout, /DANGLING_D_REF/);
  });

  it('edge: failed executed verification sidecar surfaces as audit error', () => {
    const dir = mkProject(CLEAN_LEDGER);
    const checksDir = path.join(dir, '.plan-enforcer', 'checks');
    fs.mkdirSync(checksDir, { recursive: true });
    fs.writeFileSync(path.join(dir, '.plan-enforcer', 'config.md'), '---\ncheck_cmd: npm test\n---\n');
    fs.writeFileSync(path.join(checksDir, 'latest.json'), JSON.stringify({
      T1: {
        taskId: 'T1',
        command: 'npm test',
        ok: false,
        exitCode: 1
      }
    }, null, 2));
    const r = run(BINS.audit, ['--strict'], dir);
    assert.equal(r.code, 1);
    assert.match(r.stdout, /EXECUTED_VERIFICATION_FAILED/);
    assert.match(r.stdout, /npm test/);
  });

  it('edge: missing executed verification sidecar surfaces as audit error', () => {
    const dir = mkProject(CLEAN_LEDGER);
    fs.writeFileSync(path.join(dir, '.plan-enforcer', 'config.md'), '---\ncheck_cmd: npm test\n---\n');
    const r = run(BINS.audit, ['--strict'], dir);
    assert.equal(r.code, 1);
    assert.match(r.stdout, /EXECUTED_VERIFICATION_MISSING/);
    assert.match(r.stdout, /npm test/);
  });

  it('edge: awareness quote without captured prompt surfaces in audit', () => {
    const aware = CLEAN_LEDGER.replace(
      '| T1  | do a thing | verified | wired.js is present |       |       |',
      '| T1  | keep replay dossier explicit | verified | wired.js is present | A:I1 |       |'
    );
    const dir = mkProject(aware);
    fs.writeFileSync(path.join(dir, '.plan-enforcer', 'awareness.md'), [
      '# Awareness',
      '<!-- schema: v1 -->',
      '',
      '## Project-level intents',
      '',
      '| ID | Quote | Source | Captured |',
      '|----|-------|--------|----------|',
      '| I1 | keep replay dossier explicit | session-2026-04-19 | 2026-04-19 |',
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
    const r = run(BINS.audit, ['--strict'], dir);
    assert.equal(r.code, 1);
    assert.match(r.stdout, /AWARENESS_QUOTE_UNVERIFIED/);
  });
});

describe('plan-enforcer-export', () => {
  it('happy: emits parseable JSON with expected shape', () => {
    const dir = mkProject(CLEAN_LEDGER);
    const r = run(BINS.export, ['--pretty'], dir);
    assert.equal(r.code, 0);
    const payload = JSON.parse(r.stdout);
    assert.equal(payload.schemaVersion, 1);
    assert.equal(payload.tasks.length, 1);
    assert.equal(payload.tasks[0].id, 'T1');
    assert.equal(payload.decisions.length, 1);
    assert.equal(payload.decisions[0].type, 'pivot');
  });

  it('edge: unknown --format exits 2', () => {
    const dir = mkProject(CLEAN_LEDGER);
    const r = run(BINS.export, ['--format=yaml'], dir);
    assert.equal(r.code, 2);
    assert.match(r.stderr, /Unsupported --format/);
  });
});

describe('plan-enforcer-lint', () => {
  it('happy: clean ledger lints with zero findings', () => {
    const dir = mkProject(CLEAN_LEDGER);
    const r = run(BINS.lint, [], dir);
    assert.equal(r.code, 0);
    assert.match(r.stdout, /well-formed/);
  });

  it('edge: missing Decision Log section → exit 1 with MISSING_SECTION', () => {
    const broken = CLEAN_LEDGER.replace(/## Decision Log[\s\S]*?(?=## Reconciliation)/, '');
    const dir = mkProject(broken);
    const r = run(BINS.lint, [], dir);
    assert.equal(r.code, 1);
    assert.match(r.stdout, /MISSING_SECTION/);
  });
});

describe('plan-enforcer-lint awareness', () => {
  it('edge: awareness quote without captured prompt surfaces in lint', () => {
    const dir = mkProject(CLEAN_LEDGER);
    fs.writeFileSync(path.join(dir, '.plan-enforcer', 'awareness.md'), [
      '# Awareness',
      '<!-- schema: v1 -->',
      '',
      '## Project-level intents',
      '',
      '| ID | Quote | Source | Captured |',
      '|----|-------|--------|----------|',
      '| I1 | keep replay dossier explicit | session-2026-04-19 | 2026-04-19 |',
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
    const r = run(BINS.lint, [], dir);
    assert.equal(r.code, 1);
    assert.match(r.stdout, /AWARENESS_QUOTE_UNVERIFIED/);
  });
});

describe('plan-enforcer (dispatcher)', () => {
  it('happy: --help lists all subcommands', () => {
    const dir = mkProject(CLEAN_LEDGER);
    const r = run(BINS.dispatcher, ['--help'], dir);
    assert.equal(r.code, 0);
    for (const name of ['awareness', 'status', 'chain', 'why', 'audit', 'export', 'lint', 'verify', 'config']) {
      assert.match(r.stdout, new RegExp(`\\b${name}\\b`), `--help missing ${name}`);
    }
  });

  it('edge: unknown subcommand exits 2', () => {
    const dir = mkProject(CLEAN_LEDGER);
    const r = run(BINS.dispatcher, ['nonsense'], dir);
    assert.equal(r.code, 2);
    assert.match(r.stderr, /Unknown subcommand/);
  });
});
