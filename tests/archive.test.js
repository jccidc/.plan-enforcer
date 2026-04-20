const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const os = require('os');
const {
  buildArchiveFilename,
  buildFrontmatter,
  archiveLedger,
  cleanupWorkingFiles,
  formatArchiveReport,
  listArchiveReports,
  parseArchiveFile,
  parseArchiveFrontmatter,
  summarizeArchiveReports
} = require('../src/archive');

describe('buildArchiveFilename', () => {
  it('builds date-slug filename', () => {
    const result = buildArchiveFilename('my-plan.md', new Date('2026-04-11'));
    assert.equal(result, '2026-04-11-my-plan.md');
  });

  it('handles paths with directories', () => {
    const result = buildArchiveFilename('docs/plans/big-plan.md', new Date('2026-01-15'));
    assert.equal(result, '2026-01-15-big-plan.md');
  });

  it('sanitizes special characters in filename', () => {
    const result = buildArchiveFilename('my plan (v2).md', new Date('2026-06-01'));
    assert.equal(result, '2026-06-01-my-plan--v2-.md');
  });

  it('lowercases the slug', () => {
    const result = buildArchiveFilename('MyPlan.md', new Date('2026-03-01'));
    assert.equal(result, '2026-03-01-myplan.md');
  });
});

describe('buildFrontmatter', () => {
  it('generates valid YAML frontmatter', () => {
    const fm = buildFrontmatter({
      planSource: 'test-plan.md',
      tier: 'structural',
      totalTasks: 5,
      verified: 4,
      doneUnverified: 1,
      skipped: 0,
      blocked: 0,
      decisions: 2,
      reconciliations: 1,
      createdAt: '2026-04-10T08:00:00Z',
      completedAt: '2026-04-11T12:00:00Z'
    });
    assert.ok(fm.startsWith('---\n'));
    assert.ok(fm.includes('plan: test-plan.md'));
    assert.ok(fm.includes('tier: structural'));
    assert.ok(fm.includes('tasks: 5'));
    assert.ok(fm.includes('verified: 4'));
    assert.ok(fm.includes('done_unverified: 1'));
    assert.ok(fm.includes('result: has_unverified'));
  });

  it('sets result to clean when no unverified', () => {
    const fm = buildFrontmatter({
      planSource: 'p.md', tier: 'enforced', totalTasks: 3,
      verified: 3, doneUnverified: 0, skipped: 0, blocked: 0,
      decisions: 0, reconciliations: 0, createdAt: '', completedAt: ''
    });
    assert.ok(fm.includes('result: clean'));
  });
});

describe('archiveLedger', () => {
  it('creates archive file with frontmatter + ledger content', () => {
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'pe-archive-'));
    const enforcerDir = path.join(tmpDir, '.plan-enforcer');
    fs.mkdirSync(enforcerDir, { recursive: true });

    const ledger = `# Plan Enforcer Ledger
<!-- source: my-test-plan.md -->
<!-- tier: structural -->
<!-- created: 2026-04-10T08:00:00Z -->

## Task Ledger

| ID  | Task    | Status   | Evidence | Notes |
|-----|---------|----------|----------|-------|
| T1  | Do thing | verified | yes      |       |
| T2  | Do more  | verified | yes      |       |

## Decision Log

| ID | Task Ref | Decision | Reason |
|----|----------|----------|--------|

## Reconciliation History

| Round | Tasks Checked | Gaps Found | Action Taken |
|-------|---------------|------------|--------------|
| R1    | T1-T2         | 0          | All clear    |`;

    const stats = { counts: { verified: 2, done: 0, pending: 0, 'in-progress': 0, skipped: 0, blocked: 0, superseded: 0 }, total: 2, doneCount: 2, remaining: 0, drift: 0 };
    const now = new Date('2026-04-11T15:00:00Z');

    try {
      const result = archiveLedger(enforcerDir, ledger, stats, 'structural', now);
      assert.ok(result.archiveName.includes('my-test-plan'));
      assert.ok(fs.existsSync(result.archivePath));
      const content = fs.readFileSync(result.archivePath, 'utf8');
      assert.ok(content.startsWith('---\n'));
      assert.ok(content.includes('plan: my-test-plan.md'));
      assert.ok(content.includes('## Task Ledger'));
    } finally {
      fs.rmSync(tmpDir, { recursive: true, force: true });
    }
  });
});

describe('archive parsing and reports', () => {
  it('parses frontmatter and archive details from an archived ledger', () => {
    const archiveContent = [
      '---',
      'plan: docs/plans/test-plan.md',
      'tier: enforced',
      'tasks: 2',
      'verified: 1',
      'done_unverified: 1',
      'skipped: 0',
      'blocked: 0',
      'decisions: 1',
      'reconciliations: 1',
      'started: 2026-04-10T08:00:00Z',
      'completed: 2026-04-11T12:00:00Z',
      'result: has_unverified',
      '---',
      '',
      '<!-- source: docs/plans/test-plan.md -->',
      '<!-- tier: enforced -->',
      '<!-- created: 2026-04-10T08:00:00Z -->',
      '',
      '## Task Ledger',
      '',
      '| ID  | Task    | Status   | Evidence | Notes |',
      '|-----|---------|----------|----------|-------|',
      '| T1  | Do thing | verified | yes      |       |',
      '| T2  | Do more  | done     |          | needs proof |',
      '',
      '## Decision Log',
      '',
      '| ID | Task Ref | Decision | Reason |',
      '|----|----------|----------|--------|',
      '| D1 | T2       | drift    | Added extra check |',
      '',
      '## Reconciliation History',
      '',
      '| Round | Tasks Checked | Gaps Found | Action Taken |',
      '|-------|---------------|------------|--------------|',
      '| R1    | T1-T2         | 1          | Logged D1    |'
    ].join('\n');

    const parsedFrontmatter = parseArchiveFrontmatter(archiveContent);
    assert.equal(parsedFrontmatter.metadata.plan, 'docs/plans/test-plan.md');

    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'pe-archive-report-'));
    const archivePath = path.join(tmpDir, '2026-04-11-test-plan.md');
    fs.writeFileSync(archivePath, archiveContent);

    try {
      const report = parseArchiveFile(archivePath);
      assert.equal(report.result, 'has_unverified');
      assert.equal(report.decisions.length, 1);
      assert.equal(report.ledger.total, 2);
    } finally {
      fs.rmSync(tmpDir, { recursive: true, force: true });
    }
  });

  it('lists and summarizes archived runs from a directory', () => {
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'pe-archive-summary-'));
    const archiveDir = path.join(tmpDir, 'archive');
    fs.mkdirSync(archiveDir, { recursive: true });

    fs.writeFileSync(path.join(archiveDir, '2026-04-11-clean.md'), [
      '---',
      'plan: docs/plans/clean.md',
      'tier: structural',
      'tasks: 1',
      'verified: 1',
      'done_unverified: 0',
      'skipped: 0',
      'blocked: 0',
      'decisions: 0',
      'reconciliations: 0',
      'started: 2026-04-10T08:00:00Z',
      'completed: 2026-04-11T12:00:00Z',
      'result: clean',
      '---',
      '',
      '<!-- source: docs/plans/clean.md -->',
      '| T1 | Ship cleanly | verified | yes | |'
    ].join('\n'));

    fs.writeFileSync(path.join(archiveDir, '2026-04-12-messy.md'), [
      '---',
      'plan: docs/plans/messy.md',
      'tier: enforced',
      'tasks: 2',
      'verified: 1',
      'done_unverified: 1',
      'skipped: 0',
      'blocked: 0',
      'decisions: 1',
      'reconciliations: 1',
      'started: 2026-04-11T08:00:00Z',
      'completed: 2026-04-12T12:00:00Z',
      'result: has_unverified',
      '---',
      '',
      '<!-- source: docs/plans/messy.md -->',
      '| T1 | One | verified | yes | |',
      '| T2 | Two | done | | |',
      '| D1 | T2 | drift | Extra step |',
      '| R1 | T1-T2 | 1 | Logged D1 |'
    ].join('\n'));
    fs.writeFileSync(path.join(archiveDir, '2026-04-12-messy.md.verdict.md'), '# Verdict sidecar\n');

    try {
      const reports = listArchiveReports(archiveDir);
      const summary = summarizeArchiveReports(reports);
      assert.equal(reports.length, 2);
      assert.equal(summary.clean, 1);
      assert.equal(summary.hasUnverified, 1);
      assert.equal(summary.decisions, 1);
    } finally {
      fs.rmSync(tmpDir, { recursive: true, force: true });
    }
  });

  it('formats directory and single-file archive reports', () => {
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'pe-archive-format-'));
    const archiveDir = path.join(tmpDir, 'archive');
    fs.mkdirSync(archiveDir, { recursive: true });
    const archivePath = path.join(archiveDir, '2026-04-12-run.md');

    fs.writeFileSync(archivePath, [
      '---',
      'plan: docs/plans/run.md',
      'tier: enforced',
      'tasks: 2',
      'verified: 1',
      'done_unverified: 1',
      'skipped: 1',
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
      '| T2 | Two | skipped | | deferred |',
      '| D1 | T2 | drift | Deferred for later |'
    ].join('\n'));
    fs.writeFileSync(`${archivePath}.verdict.md`, '# Phase Verify Report\n');

    try {
      const dirReport = formatArchiveReport(archiveDir);
      const fileReport = formatArchiveReport(archivePath);
      assert.match(dirReport, /Runs: 1/);
      assert.match(dirReport, /Final truth:/);
      assert.match(dirReport, /Lineage roots:/);
      assert.match(dirReport, /Archived runs:/);
      assert.match(dirReport, /\n  2026-04-12-run\.md  has_unverified  1\/2 done  drift=1  source=docs\/plans\/run\.md/);
      assert.match(fileReport, /Source: docs\/plans\/run.md/);
      assert.match(fileReport, /Final truth:/);
      assert.match(fileReport, /Lineage roots:/);
      assert.match(fileReport, /Skipped\/superseded:/);
      assert.match(fileReport, /Decision log:/);
    } finally {
      fs.rmSync(tmpDir, { recursive: true, force: true });
    }
  });

  it('highlights the newest completed clean archive instead of filename order', () => {
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'pe-archive-focus-order-'));
    const archiveDir = path.join(tmpDir, 'archive');
    fs.mkdirSync(archiveDir, { recursive: true });

    fs.writeFileSync(path.join(archiveDir, '2026-04-20-zeta.md'), [
      '---',
      'plan: docs/plans/older.md',
      'tier: structural',
      'tasks: 1',
      'verified: 1',
      'done_unverified: 0',
      'skipped: 0',
      'blocked: 0',
      'decisions: 0',
      'reconciliations: 0',
      'started: 2026-04-20T17:00:00Z',
      'completed: 2026-04-20T18:00:00Z',
      'result: clean',
      '---',
      '',
      '<!-- source: docs/plans/older.md -->',
      '| T1 | Older clean run | verified | yes | |'
    ].join('\n'));

    fs.writeFileSync(path.join(archiveDir, '2026-04-20-alpha.md'), [
      '---',
      'plan: docs/plans/newer.md',
      'tier: structural',
      'tasks: 1',
      'verified: 1',
      'done_unverified: 0',
      'skipped: 0',
      'blocked: 0',
      'decisions: 0',
      'reconciliations: 0',
      'started: 2026-04-20T18:10:00Z',
      'completed: 2026-04-20T18:30:00Z',
      'result: clean',
      '---',
      '',
      '<!-- source: docs/plans/newer.md -->',
      '| T1 | Newer clean run | verified | yes | |'
    ].join('\n'));

    try {
      const dirReport = formatArchiveReport(archiveDir);
      assert.match(dirReport, /archive: .*2026-04-20-alpha\.md/);
      assert.match(dirReport, /source plan: docs\/plans\/newer\.md/);
    } finally {
      fs.rmSync(tmpDir, { recursive: true, force: true });
    }
  });
});

describe('cleanupWorkingFiles', () => {
  it('removes working files without error', () => {
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'pe-cleanup-'));
    const enforcerDir = path.join(tmpDir, '.plan-enforcer');
    fs.mkdirSync(enforcerDir, { recursive: true });

    // Create some working files
    fs.writeFileSync(path.join(enforcerDir, 'ledger.md'), 'test');
    fs.writeFileSync(path.join(enforcerDir, '.tool-count'), '5');
    fs.writeFileSync(path.join(enforcerDir, '.stale-count'), '0');

    try {
      cleanupWorkingFiles(enforcerDir);
      assert.ok(!fs.existsSync(path.join(enforcerDir, 'ledger.md')));
      assert.ok(!fs.existsSync(path.join(enforcerDir, '.tool-count')));
      assert.ok(!fs.existsSync(path.join(enforcerDir, '.stale-count')));
    } finally {
      fs.rmSync(tmpDir, { recursive: true, force: true });
    }
  });

  it('does not throw when files do not exist', () => {
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'pe-cleanup-empty-'));
    const enforcerDir = path.join(tmpDir, '.plan-enforcer');
    fs.mkdirSync(enforcerDir, { recursive: true });

    try {
      assert.doesNotThrow(() => cleanupWorkingFiles(enforcerDir));
    } finally {
      fs.rmSync(tmpDir, { recursive: true, force: true });
    }
  });
});
