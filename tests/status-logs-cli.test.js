const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawnSync } = require('child_process');

const repoRoot = path.resolve(__dirname, '..');

function fixture(name) {
  return fs.readFileSync(path.join(__dirname, 'fixtures', name), 'utf8');
}

describe('status-cli', () => {
  it('prints formatted status report for an active ledger', () => {
    const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'plan-enforcer-status-cli-'));
    const ledgerPath = path.join(tempDir, 'ledger.md');
    fs.writeFileSync(ledgerPath, fixture('sample-ledger.md'));

    const result = spawnSync(process.execPath, ['src/status-cli.js', ledgerPath], {
      cwd: repoRoot,
      encoding: 'utf8'
    });

    assert.equal(result.status, 0);
    assert.match(result.stdout, /Plan Enforcer Status/);
    assert.match(result.stdout, /Current Task: T5 - Add authentication/);
  });

  it('includes recent phase verify summary when phase-report exists', () => {
    const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'plan-enforcer-status-phase-cli-'));
    const enforcerDir = path.join(tempDir, '.plan-enforcer');
    fs.mkdirSync(enforcerDir, { recursive: true });
    const ledgerPath = path.join(enforcerDir, 'ledger.md');
    fs.writeFileSync(ledgerPath, fixture('sample-ledger.md'));
    fs.writeFileSync(path.join(enforcerDir, 'phase-report.md'), [
      '# Phase Verify Report',
      '',
      '- Archive: .plan-enforcer/archive/2026-04-17-test.md',
      '- Result: pass',
      '- Verified rows: 4/4',
      '- Unfinished rows: 0',
      '- Focus files: src/app.js; test/app.test.js',
      '- Verification: npm test'
    ].join('\n'));

    const result = spawnSync(process.execPath, ['src/status-cli.js', path.join(enforcerDir, 'ledger.md')], {
      cwd: repoRoot,
      encoding: 'utf8'
    });

    assert.equal(result.status, 0);
    assert.match(result.stdout, /Recent Phase Verify:/);
    assert.match(result.stdout, /Result: pass/);
    assert.match(result.stdout, /Verified rows: 4\/4/);
  });

  it('includes awareness summary when awareness is initialized', () => {
    const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'plan-enforcer-status-awareness-cli-'));
    const enforcerDir = path.join(tempDir, '.plan-enforcer');
    fs.mkdirSync(enforcerDir, { recursive: true });
    fs.writeFileSync(path.join(enforcerDir, 'ledger.md'), [
      '# Ledger',
      '<!-- schema: v2 -->',
      '',
      '## Task Ledger',
      '',
      '| ID  | Task | Status | Evidence | Chain | Notes |',
      '|-----|------|--------|----------|-------|-------|',
      '| T1  | Keep replay honest bundle | verified | src/replay.js | A:I1 | |',
      '',
      '## Decision Log',
      '| ID | Type | Scope | Reason | Evidence |',
      '|----|------|-------|--------|----------|',
      '',
      '## Reconciliation History',
      '| Round | Tasks Checked | Gaps Found | Action Taken |',
      '|-------|---------------|------------|--------------|'
    ].join('\n'));
    fs.writeFileSync(path.join(enforcerDir, 'awareness.md'), [
      '# Awareness',
      '<!-- schema: v1 -->',
      '',
      '## Project-level intents',
      '',
      '| ID | Quote | Source | Captured |',
      '|----|-------|--------|----------|',
      '| I1 | keep replay honest | session-2026-04-19 | 2026-04-19 |',
      '| I2 | export explicit closure | session-2026-04-19 | 2026-04-19 |',
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
    fs.writeFileSync(path.join(enforcerDir, '.user-messages.jsonl'), [
      JSON.stringify({ index: 1, prompt: 'please keep replay honest in the final result' })
    ].join('\n') + '\n');

    const result = spawnSync(process.execPath, ['src/status-cli.js', path.join(enforcerDir, 'ledger.md')], {
      cwd: repoRoot,
      encoding: 'utf8'
    });

    assert.equal(result.status, 0);
    assert.match(result.stdout, /Awareness: 2 live\s+\|\s+1 linked\s+\|\s+1 orphan\s+\|\s+1 quote issue/);
    assert.match(result.stdout, /orphans: I2/);
    assert.match(result.stdout, /quote issues: I2/);
  });

  it('shows uncommitted git files instead of only raw untracked state', () => {
    const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'plan-enforcer-status-git-cli-'));
    const enforcerDir = path.join(tempDir, '.plan-enforcer');
    fs.mkdirSync(enforcerDir, { recursive: true });
    fs.writeFileSync(path.join(enforcerDir, 'ledger.md'), fixture('sample-ledger.md'));

    const gitEnv = { cwd: tempDir, encoding: 'utf8' };
    assert.equal(spawnSync('git', ['init', '-q'], gitEnv).status, 0);
    fs.writeFileSync(path.join(tempDir, 'README.md'), 'tracked\n');
    assert.equal(spawnSync('git', ['add', 'README.md'], gitEnv).status, 0);
    assert.equal(spawnSync('git', ['-c', 'user.email=test@local', '-c', 'user.name=test', 'commit', '-q', '-m', 'init'], gitEnv).status, 0);
    fs.writeFileSync(path.join(tempDir, 'README.md'), 'tracked changed\n');
    fs.mkdirSync(path.join(tempDir, 'docs'), { recursive: true });
    fs.writeFileSync(path.join(tempDir, 'docs', 'note.md'), 'untracked\n');

    const result = spawnSync(process.execPath, ['src/status-cli.js', path.join(enforcerDir, 'ledger.md')], {
      cwd: repoRoot,
      encoding: 'utf8'
    });

    assert.equal(result.status, 0);
    assert.match(result.stdout, /Git: 2 uncommitted files/);
    assert.match(result.stdout, /files: README.md, docs\/note.md|files: docs\/note.md, README.md/);
  });
});

describe('logs-cli', () => {
  it('prints formatted audit log report for an active ledger', () => {
    const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'plan-enforcer-logs-cli-'));
    const ledgerPath = path.join(tempDir, 'ledger.md');
    fs.writeFileSync(ledgerPath, fixture('sample-ledger.md'));

    const result = spawnSync(process.execPath, ['src/logs-cli.js', ledgerPath], {
      cwd: repoRoot,
      encoding: 'utf8'
    });

    assert.equal(result.status, 0);
    assert.match(result.stdout, /Plan Enforcer Logs/);
    assert.match(result.stdout, /DECISION LOG:/);
    assert.match(result.stdout, /RECONCILIATION HISTORY:/);
  });

  it('includes awareness detail block when awareness is initialized', () => {
    const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'plan-enforcer-logs-awareness-cli-'));
    const enforcerDir = path.join(tempDir, '.plan-enforcer');
    fs.mkdirSync(enforcerDir, { recursive: true });
    fs.writeFileSync(path.join(enforcerDir, 'ledger.md'), [
      '# Ledger',
      '<!-- schema: v2 -->',
      '',
      '## Task Ledger',
      '',
      '| ID  | Task | Status | Evidence | Chain | Notes |',
      '|-----|------|--------|----------|-------|-------|',
      '| T1  | Keep replay honest bundle | verified | src/replay.js | A:I1 | |',
      '',
      '## Decision Log',
      '| ID | Type | Scope | Reason | Evidence |',
      '|----|------|-------|--------|----------|',
      '',
      '## Reconciliation History',
      '| Round | Tasks Checked | Gaps Found | Action Taken |',
      '|-------|---------------|------------|--------------|'
    ].join('\n'));
    fs.writeFileSync(path.join(enforcerDir, 'awareness.md'), [
      '# Awareness',
      '<!-- schema: v1 -->',
      '',
      '## Project-level intents',
      '',
      '| ID | Quote | Source | Captured |',
      '|----|-------|--------|----------|',
      '| I1 | keep replay honest | session-2026-04-19 | 2026-04-19 |',
      '| I2 | export explicit closure | session-2026-04-19 | 2026-04-19 |',
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
    fs.writeFileSync(path.join(enforcerDir, '.user-messages.jsonl'), [
      JSON.stringify({ index: 1, prompt: 'please keep replay honest in the final result' })
    ].join('\n') + '\n');

    const result = spawnSync(process.execPath, ['src/logs-cli.js', path.join(enforcerDir, 'ledger.md')], {
      cwd: repoRoot,
      encoding: 'utf8'
    });

    assert.equal(result.status, 0);
    assert.match(result.stdout, /AWARENESS:/);
    assert.match(result.stdout, /live=2\s+linked=1\s+orphan=1\s+quote_issues=1/);
    assert.match(result.stdout, /orphan intents:/);
    assert.match(result.stdout, /I2  export explicit closure/);
    assert.match(result.stdout, /quote issues:/);
  });
});
