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

  it('scopes awareness summary to current-package same-day intents', () => {
    const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'plan-enforcer-status-awareness-scope-cli-'));
    const enforcerDir = path.join(tempDir, '.plan-enforcer');
    fs.mkdirSync(enforcerDir, { recursive: true });
    fs.writeFileSync(path.join(enforcerDir, 'ledger.md'), [
      '# Ledger',
      '<!-- schema: v2 -->',
      '<!-- created: 2026-04-20T13:04:04Z -->',
      '',
      '## Task Ledger',
      '',
      '| ID  | Task | Status | Evidence | Chain | Notes |',
      '|-----|------|--------|----------|-------|-------|',
      '| T1  | Current package intent task | verified | current package intent proof | A:I18 | |',
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
      '| I15 | older same-day intent | manual | 2026-04-20 |',
      '| I16 | another older same-day intent | manual | 2026-04-20 |',
      '| I18 | current package intent | manual | 2026-04-20 |',
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

    const result = spawnSync(process.execPath, ['src/status-cli.js', path.join(enforcerDir, 'ledger.md')], {
      cwd: repoRoot,
      encoding: 'utf8'
    });

    assert.equal(result.status, 0);
    assert.match(result.stdout, /Awareness: 1 live\s+\|\s+1 linked\s+\|\s+0 orphan\s+\|\s+0 quote issues/);
    assert.doesNotMatch(result.stdout, /I15|I16/);
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

  it('surfaces executed-verification gaps for verified rows', () => {
    const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'plan-enforcer-status-exec-cli-'));
    const enforcerDir = path.join(tempDir, '.plan-enforcer');
    const checksDir = path.join(enforcerDir, 'checks');
    fs.mkdirSync(checksDir, { recursive: true });
    fs.writeFileSync(path.join(enforcerDir, 'ledger.md'), [
      '# Ledger',
      '<!-- schema: v2 -->',
      '',
      '## Task Ledger',
      '',
      '| ID  | Task | Status | Evidence | Chain | Notes |',
      '|-----|------|--------|----------|-------|-------|',
      '| T1  | Verify CLI output | verified | npm test | | |',
      '',
      '## Decision Log',
      '| ID | Type | Scope | Reason | Evidence |',
      '|----|------|-------|--------|----------|',
      '',
      '## Reconciliation History',
      '| Round | Tasks Checked | Gaps Found | Action Taken |',
      '|-------|---------------|------------|--------------|'
    ].join('\n'));
    fs.writeFileSync(path.join(enforcerDir, 'config.md'), 'tier: structural\n');

    const result = spawnSync(process.execPath, ['src/status-cli.js', path.join(enforcerDir, 'ledger.md')], {
      cwd: repoRoot,
      encoding: 'utf8'
    });

    assert.equal(result.status, 0);
    assert.match(result.stdout, /Executed Verification: 1 gap/);
    assert.match(result.stdout, /T1 missing npm test/);
    assert.match(result.stdout, /next:/);
    assert.match(result.stdout, /rerun T1: npm test/);
    assert.match(result.stdout, /plan-enforcer-config --check-cmd "<cmd>"/);
  });

  it('surfaces undetected executed-verification claims for verified rows', () => {
    const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'plan-enforcer-status-undetected-cli-'));
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
      '| T1  | Verify CLI output | verified | 3 tests passed, 0 failed | | |',
      '',
      '## Decision Log',
      '| ID | Type | Scope | Reason | Evidence |',
      '|----|------|-------|--------|----------|',
      '',
      '## Reconciliation History',
      '| Round | Tasks Checked | Gaps Found | Action Taken |',
      '|-------|---------------|------------|--------------|'
    ].join('\n'));

    const result = spawnSync(process.execPath, ['src/status-cli.js', path.join(enforcerDir, 'ledger.md')], {
      cwd: repoRoot,
      encoding: 'utf8'
    });

    assert.equal(result.status, 0);
    assert.match(result.stdout, /Executed Verification: 1 gap/);
    assert.match(result.stdout, /T1 undetected cite exact command or set check_cmd/);
    assert.match(result.stdout, /fix T1: cite exact command or set check_cmd before verified/);
  });

  it('shows authored-or-import guidance when no active ledger exists', () => {
    const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'plan-enforcer-status-empty-cli-'));
    const result = spawnSync(process.execPath, ['src/status-cli.js', path.join(tempDir, '.plan-enforcer', 'ledger.md')], {
      cwd: repoRoot,
      encoding: 'utf8'
    });

    assert.equal(result.status, 1);
    assert.match(result.stderr, /Start with `plan-enforcer discuss "<ask>"` for a fuzzy request, or import an existing plan with `plan-enforcer import <plan-file>`/);
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

  it('scopes awareness detail to current-package same-day intents', () => {
    const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'plan-enforcer-logs-awareness-scope-cli-'));
    const enforcerDir = path.join(tempDir, '.plan-enforcer');
    fs.mkdirSync(enforcerDir, { recursive: true });
    fs.writeFileSync(path.join(enforcerDir, 'ledger.md'), [
      '# Ledger',
      '<!-- schema: v2 -->',
      '<!-- created: 2026-04-20T13:04:04Z -->',
      '',
      '## Task Ledger',
      '',
      '| ID  | Task | Status | Evidence | Chain | Notes |',
      '|-----|------|--------|----------|-------|-------|',
      '| T1  | Current package intent task | verified | current package intent proof | A:I18 | |',
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
      '| I15 | older same-day intent | manual | 2026-04-20 |',
      '| I16 | another older same-day intent | manual | 2026-04-20 |',
      '| I18 | current package intent | manual | 2026-04-20 |',
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

    const result = spawnSync(process.execPath, ['src/logs-cli.js', path.join(enforcerDir, 'ledger.md')], {
      cwd: repoRoot,
      encoding: 'utf8'
    });

    assert.equal(result.status, 0);
    assert.match(result.stdout, /live=1\s+linked=1\s+orphan=0\s+quote_issues=0/);
    assert.doesNotMatch(result.stdout, /I15|I16/);
  });

  it('surfaces executed-verification stale details for verified rows', () => {
    const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'plan-enforcer-logs-exec-cli-'));
    const enforcerDir = path.join(tempDir, '.plan-enforcer');
    const checksDir = path.join(enforcerDir, 'checks');
    fs.mkdirSync(checksDir, { recursive: true });
    fs.writeFileSync(path.join(enforcerDir, 'ledger.md'), [
      '# Ledger',
      '<!-- schema: v2 -->',
      '',
      '## Task Ledger',
      '',
      '| ID  | Task | Status | Evidence | Chain | Notes |',
      '|-----|------|--------|----------|-------|-------|',
      '| T1  | Verify CLI output | verified | npm test | | |',
      '',
      '## Decision Log',
      '| ID | Type | Scope | Reason | Evidence |',
      '|----|------|-------|--------|----------|',
      '',
      '## Reconciliation History',
      '| Round | Tasks Checked | Gaps Found | Action Taken |',
      '|-------|---------------|------------|--------------|'
    ].join('\n'));
    fs.writeFileSync(path.join(enforcerDir, 'config.md'), 'tier: structural\n');
    fs.writeFileSync(path.join(checksDir, 'latest.json'), JSON.stringify({
      T1: {
        taskId: 'T1',
        ts: '2026-04-19T08:00:00.000Z',
        command: 'npm run lint',
        source: 'evidence',
        ok: true,
        exitCode: 0,
        timedOut: false,
        durationMs: 123,
        logPath: '.plan-enforcer/checks/T1.log',
        jsonPath: '.plan-enforcer/checks/T1.json'
      }
    }, null, 2));

    const result = spawnSync(process.execPath, ['src/logs-cli.js', path.join(enforcerDir, 'ledger.md')], {
      cwd: repoRoot,
      encoding: 'utf8'
    });

    assert.equal(result.status, 0);
    assert.match(result.stdout, /EXECUTED VERIFICATION:/);
    assert.match(result.stdout, /T1\s+stale\s+expected=npm test\s+latest=npm run lint/);
    assert.match(result.stdout, /next:/);
    assert.match(result.stdout, /rerun T1: npm test/);
    assert.match(result.stdout, /plan-enforcer-config --check-cmd "<cmd>"/);
  });

  it('surfaces undetected executed-verification details for verified rows', () => {
    const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'plan-enforcer-logs-undetected-cli-'));
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
      '| T1  | Verify CLI output | verified | 3 tests passed, 0 failed | | |',
      '',
      '## Decision Log',
      '| ID | Type | Scope | Reason | Evidence |',
      '|----|------|-------|--------|----------|',
      '',
      '## Reconciliation History',
      '| Round | Tasks Checked | Gaps Found | Action Taken |',
      '|-------|---------------|------------|--------------|'
    ].join('\n'));

    const result = spawnSync(process.execPath, ['src/logs-cli.js', path.join(enforcerDir, 'ledger.md')], {
      cwd: repoRoot,
      encoding: 'utf8'
    });

    assert.equal(result.status, 0);
    assert.match(result.stdout, /EXECUTED VERIFICATION:/);
    assert.match(result.stdout, /T1\s+undetected\s+action=cite exact command or set check_cmd/);
    assert.match(result.stdout, /fix T1: cite exact command or set check_cmd before verified/);
  });

  it('shows authored-or-import guidance when no active ledger exists', () => {
    const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'plan-enforcer-logs-empty-cli-'));
    const result = spawnSync(process.execPath, ['src/logs-cli.js', path.join(tempDir, '.plan-enforcer', 'ledger.md')], {
      cwd: repoRoot,
      encoding: 'utf8'
    });

    assert.equal(result.status, 1);
    assert.match(result.stderr, /Start with `plan-enforcer discuss "<ask>"` for a fuzzy request, or import an existing plan with `plan-enforcer import <plan-file>`/);
  });
});
