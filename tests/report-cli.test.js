const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawnSync } = require('child_process');

describe('report-cli', () => {
  it('prints a summary for an archive directory', () => {
    const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'plan-enforcer-report-cli-'));
    const archiveDir = path.join(tempDir, '.plan-enforcer', 'archive');
    fs.mkdirSync(archiveDir, { recursive: true });

    fs.writeFileSync(path.join(archiveDir, '2026-04-12-run.md'), [
      '---',
      'plan: docs/plans/run.md',
      'tier: structural',
      'tasks: 1',
      'verified: 1',
      'done_unverified: 0',
      'skipped: 0',
      'blocked: 0',
      'decisions: 0',
      'reconciliations: 0',
      'started: 2026-04-11T08:00:00Z',
      'completed: 2026-04-12T12:00:00Z',
      'result: clean',
      '---',
      '',
      '<!-- source: docs/plans/run.md -->',
      '| T1 | One | verified | yes | |'
    ].join('\n'));

    const result = spawnSync(process.execPath, ['src/report-cli.js', archiveDir], {
      cwd: path.resolve(__dirname, '..'),
      encoding: 'utf8'
    });

    assert.equal(result.status, 0);
    assert.match(result.stdout, /Runs: 1/);
    assert.match(result.stdout, /Archived runs:/);
  });

  it('prints a detailed report for a single archive file', () => {
    const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'plan-enforcer-report-file-cli-'));
    const archivePath = path.join(tempDir, '2026-04-12-run.md');

    fs.writeFileSync(archivePath, [
      '---',
      'plan: docs/plans/run.md',
      'tier: enforced',
      'tasks: 2',
      'verified: 1',
      'done_unverified: 1',
      'skipped: 0',
      'blocked: 0',
      'decisions: 1',
      'reconciliations: 0',
      'started: 2026-04-11T08:00:00Z',
      'completed: 2026-04-12T12:00:00Z',
      'result: has_unverified',
      '---',
      '',
      '<!-- source: docs/plans/run.md -->',
      '<!-- tier: enforced -->',
      '<!-- created: 2026-04-11T08:00:00Z -->',
      '| T1 | One | verified | yes | |',
      '| T2 | Two | done | | |',
      '| D1 | T2 | drift | Added extra proof step |'
    ].join('\n'));
    fs.writeFileSync(`${archivePath}.verdict.json`, JSON.stringify({
      pass: false,
      totals: { verified: 1, total_tasks: 2, unfinished: 1 },
      warnings: ['phase proof note missing']
    }, null, 2));
    fs.writeFileSync(`${archivePath}.verdict.md`, '# Phase Verify Report\n');

    const result = spawnSync(process.execPath, ['src/report-cli.js', archivePath], {
      cwd: path.resolve(__dirname, '..'),
      encoding: 'utf8'
    });

    assert.equal(result.status, 0);
    assert.match(result.stdout, /Result: has_unverified/);
    assert.match(result.stdout, /Done but unverified:/);
    assert.match(result.stdout, /Phase verify:/);
    assert.match(result.stdout, /warning: phase proof note missing/);
  });

  it('prints an active report when asked for the live ledger', () => {
    const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'plan-enforcer-report-active-cli-'));
    const enforcerDir = path.join(tempDir, '.plan-enforcer');
    fs.mkdirSync(enforcerDir, { recursive: true });
    fs.writeFileSync(path.join(tempDir, 'package.json'), JSON.stringify({
      name: 'fixture',
      scripts: { test: 'node -e "process.exit(0)"' }
    }, null, 2));
    fs.writeFileSync(path.join(enforcerDir, 'ledger.md'), [
      '# Ledger',
      '<!-- schema: v2 -->',
      '<!-- source: docs/plans/run.md -->',
      '<!-- tier: structural -->',
      '',
      '## Task Ledger',
      '',
      '| ID  | Task | Status | Evidence | Chain | Notes |',
      '|-----|------|--------|----------|-------|-------|',
      '| T1  | Ship proof | verified | package.json | | |',
      '',
      '## Decision Log',
      '| ID | Type | Scope | Reason | Evidence |',
      '|----|------|-------|--------|----------|',
      '',
      '## Reconciliation History',
      '| Round | Tasks Checked | Gaps Found | Action Taken |',
      '|-------|---------------|------------|--------------|'
    ].join('\n'));
    fs.mkdirSync(path.join(enforcerDir, 'checks'), { recursive: true });
    fs.writeFileSync(path.join(enforcerDir, 'checks', 'latest.json'), JSON.stringify({
      T1: {
        taskId: 'T1',
        command: 'npm test',
        ok: true,
        exitCode: 0
      }
    }, null, 2));

    const result = spawnSync(process.execPath, ['src/report-cli.js', '--active', '--ledger', path.join(enforcerDir, 'ledger.md')], {
      cwd: path.resolve(__dirname, '..'),
      encoding: 'utf8'
    });

    assert.equal(result.status, 0);
    assert.match(result.stdout, /Plan Enforcer Active Report/);
    assert.match(result.stdout, /Checks:\s+1 ok/);
    assert.match(result.stdout, /Clean active session/);
  });
});
