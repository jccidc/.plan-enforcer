const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawnSync } = require('child_process');
const reportBin = path.resolve(__dirname, '..', 'src', 'report-cli.js');

describe('report-cli', () => {
  it('defaults to active-session report when an active ledger exists', () => {
    const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'plan-enforcer-report-active-cli-'));
    const enforcerDir = path.join(tempDir, '.plan-enforcer');
    fs.mkdirSync(enforcerDir, { recursive: true });
    fs.writeFileSync(path.join(enforcerDir, 'ledger.md'), [
      '# Ledger',
      '<!-- schema: v2 -->',
      '<!-- source: docs/plans/run.md -->',
      '<!-- tier: structural -->',
      '<!-- created: 2026-04-11T08:00:00Z -->',
      '',
      '## Task Ledger',
      '',
      '| ID  | Task | Status | Evidence | Chain | Notes |',
      '|-----|------|--------|----------|-------|-------|',
      '| T1  | One | verified | npm test | | |',
      '| T2  | Two | pending | | | |',
      '',
      '## Decision Log',
      '| ID | Type | Scope | Reason | Evidence |',
      '|----|------|-------|--------|----------|',
      '',
      '## Reconciliation History',
      '| Round | Tasks Checked | Gaps Found | Action Taken |',
      '|-------|---------------|------------|--------------|'
    ].join('\n'));

    const result = spawnSync(process.execPath, [reportBin], {
      cwd: tempDir,
      encoding: 'utf8'
    });

    assert.equal(result.status, 0);
    assert.match(result.stdout, /Plan Enforcer Active Report/);
    assert.match(result.stdout, /Source: docs\/plans\/run.md/);
    assert.match(result.stdout, /Current: T2 - Two/);
    assert.match(result.stdout, /Truth surfaces:/);
    assert.match(result.stdout, /phase report: .*phase-report\.md \(not written yet\)/);
    assert.match(result.stdout, /Lineage roots:/);
    assert.match(result.stdout, /source plan: docs\/plans\/run\.md/);
    assert.match(result.stdout, /Executed Verification: 1 gap/);
    assert.match(result.stdout, /rerun T1: npm test/);
  });

  it('supports explicit --active mode', () => {
    const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'plan-enforcer-report-active-flag-cli-'));
    const enforcerDir = path.join(tempDir, '.plan-enforcer');
    fs.mkdirSync(enforcerDir, { recursive: true });
    fs.writeFileSync(path.join(enforcerDir, 'ledger.md'), [
      '# Ledger',
      '<!-- schema: v2 -->',
      '<!-- source: docs/plans/run.md -->',
      '<!-- tier: structural -->',
      '<!-- created: 2026-04-11T08:00:00Z -->',
      '',
      '## Task Ledger',
      '',
      '| ID  | Task | Status | Evidence | Chain | Notes |',
      '|-----|------|--------|----------|-------|-------|',
      '| T1  | One | verified | npm test | | |',
      '',
      '## Decision Log',
      '| ID | Type | Scope | Reason | Evidence |',
      '|----|------|-------|--------|----------|',
      '',
      '## Reconciliation History',
      '| Round | Tasks Checked | Gaps Found | Action Taken |',
      '|-------|---------------|------------|--------------|'
    ].join('\n'));

    const result = spawnSync(process.execPath, [reportBin, '--active'], {
      cwd: tempDir,
      encoding: 'utf8'
    });

    assert.equal(result.status, 0);
    assert.match(result.stdout, /Plan Enforcer Active Report/);
  });

  it('scopes active-report awareness summary to current-package same-day intents', () => {
    const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'plan-enforcer-report-awareness-scope-cli-'));
    const enforcerDir = path.join(tempDir, '.plan-enforcer');
    fs.mkdirSync(enforcerDir, { recursive: true });
    fs.writeFileSync(path.join(enforcerDir, 'ledger.md'), [
      '# Ledger',
      '<!-- schema: v2 -->',
      '<!-- source: docs/plans/run.md -->',
      '<!-- tier: structural -->',
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

    const result = spawnSync(process.execPath, [reportBin, '--active'], {
      cwd: tempDir,
      encoding: 'utf8'
    });

    assert.equal(result.status, 0);
    assert.match(result.stdout, /Awareness: 1 live\s+\|\s+1 linked\s+\|\s+0 orphan\s+\|\s+0 quote issues/);
    assert.doesNotMatch(result.stdout, /I15|I16/);
  });

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
    fs.writeFileSync(path.join(archiveDir, '2026-04-12-run.md.verdict.md'), '# Phase Verify Report\n');

    const result = spawnSync(process.execPath, [reportBin, archiveDir], {
      cwd: path.resolve(__dirname, '..'),
      encoding: 'utf8'
    });

    assert.equal(result.status, 0);
    assert.match(result.stdout, /Runs: 1/);
    assert.match(result.stdout, /Final truth:/);
    assert.match(result.stdout, /phase verify report:/);
    assert.match(result.stdout, /Lineage roots:/);
    assert.match(result.stdout, /source plan: docs\/plans\/run\.md/);
    assert.match(result.stdout, /Archived runs:/);
    assert.match(result.stdout, /\n  2026-04-12-run\.md  clean  1\/1 done  drift=0  source=docs\/plans\/run\.md/);
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

    const result = spawnSync(process.execPath, [reportBin, archivePath], {
      cwd: path.resolve(__dirname, '..'),
      encoding: 'utf8'
    });

    assert.equal(result.status, 0);
    assert.match(result.stdout, /Result: has_unverified/);
    assert.match(result.stdout, /Final truth:/);
    assert.match(result.stdout, /phase verify report:/);
    assert.match(result.stdout, /Lineage roots:/);
    assert.match(result.stdout, /source plan: docs\/plans\/run\.md/);
    assert.match(result.stdout, /Done but unverified:/);
    assert.match(result.stdout, /Phase verify:/);
    assert.match(result.stdout, /warning: phase proof note missing/);
  });

  it('shows authored-or-import guidance when no active session or archive exists', () => {
    const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'plan-enforcer-report-empty-cli-'));
    const result = spawnSync(process.execPath, [reportBin], {
      cwd: tempDir,
      encoding: 'utf8'
    });

    assert.equal(result.status, 1);
    assert.match(result.stderr, /Start with `\/plan-enforcer <plan-file>` or import an existing plan with `plan-enforcer import <plan-file>`/);
    assert.match(result.stderr, /No archive reports found yet/);
  });
});
