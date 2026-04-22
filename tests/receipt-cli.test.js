const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');

const receipt = require('../src/receipt-cli');

function mkProject() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'pe-rcpt-'));
  const enforcer = path.join(dir, '.plan-enforcer');
  fs.mkdirSync(enforcer, { recursive: true });
  fs.mkdirSync(path.join(enforcer, 'proof'), { recursive: true });
  const plans = path.join(dir, 'docs', 'plans');
  fs.mkdirSync(plans, { recursive: true });
  return { dir, enforcer };
}

function writeLedger(enforcer, options) {
  options = options || {};
  const source = options.source || 'docs/plans/2026-04-22-sample-plan.md';
  const taskRows = (options.tasks || [
    { id: 'T1', name: 'first task', status: 'verified', evidence: 'src/a.js built' },
    { id: 'T2', name: 'second task', status: 'verified', evidence: 'src/b.js built' }
  ]).map((t) => `| ${t.id} | ${t.name} | ${t.status} | ${t.evidence || ''} |  |  |`).join('\n');
  const decisions = (options.decisions || []).map((d) => `| ${d.id} | ${d.type} | ${d.scope} | ${d.reason} | ${d.evidence || ''} |`).join('\n');
  const recon = (options.reconciliations || []).map((r) => `| ${r.round} | ${r.tasks} | ${r.gaps} | ${r.action} |`).join('\n');
  const content = `# Plan Enforcer Ledger
<!-- schema: v2 -->
<!-- source: ${source} -->
<!-- tier: structural -->

## Scoreboard
 ${(options.tasks || []).length || 2} total  |  0 done  |  2 verified  |  0 skipped  |  0 blocked  |  0 remaining

## Task Ledger

| ID | Task | Status | Evidence | Chain | Notes |
|----|------|--------|----------|-------|-------|
${taskRows}

## Decision Log

| ID | Type | Scope | Reason | Evidence |
|----|------|-------|--------|----------|
${decisions}

## Reconciliation History

| Round | Tasks Checked | Gaps Found | Action Taken |
|-------|---------------|------------|--------------|
${recon}
`;
  fs.writeFileSync(path.join(enforcer, 'ledger.md'), content, 'utf8');
  return content;
}

describe('deriveSlug', () => {
  it('strips date prefix and extension', () => {
    assert.equal(receipt.deriveSlug('docs/plans/2026-04-22-foo-bar.md'), 'foo-bar');
  });
  it('handles bare filename without date', () => {
    assert.equal(receipt.deriveSlug('docs/plans/foo-bar.md'), 'foo-bar');
  });
  it('handles undefined input', () => {
    assert.equal(receipt.deriveSlug(null), 'unknown-plan');
    assert.equal(receipt.deriveSlug(undefined), 'unknown-plan');
  });
  it('handles non-dated basename in nested path', () => {
    assert.equal(receipt.deriveSlug('some/other/dir/myplan.md'), 'myplan');
  });
});

describe('filenameSafeIso', () => {
  it('produces colon-free iso with Z suffix', () => {
    const iso = receipt.filenameSafeIso(new Date('2026-04-22T03:45:12.345Z'));
    assert.equal(iso, '2026-04-22T03-45-12Z');
    assert.ok(!iso.includes(':'));
  });
  it('defaults to now when given no argument', () => {
    const iso = receipt.filenameSafeIso();
    assert.match(iso, /^\d{4}-\d{2}-\d{2}T\d{2}-\d{2}-\d{2}Z$/);
  });
});

describe('findPriorClosure', () => {
  it('returns latest by ISO sort', () => {
    const { enforcer } = mkProject();
    const proofDir = path.join(enforcer, 'proof');
    fs.writeFileSync(path.join(proofDir, 'closure-demo-2026-04-20T01-00-00Z.md'), '');
    fs.writeFileSync(path.join(proofDir, 'closure-demo-2026-04-22T03-00-00Z.md'), '');
    fs.writeFileSync(path.join(proofDir, 'closure-demo-2026-04-21T01-00-00Z.md'), '');
    const prior = receipt.findPriorClosure(proofDir, 'demo');
    assert.equal(prior, 'closure-demo-2026-04-22T03-00-00Z.md');
  });
  it('returns null when no prior exists', () => {
    const { enforcer } = mkProject();
    assert.equal(receipt.findPriorClosure(path.join(enforcer, 'proof'), 'demo'), null);
  });
  it('does not match other plans', () => {
    const { enforcer } = mkProject();
    const proofDir = path.join(enforcer, 'proof');
    fs.writeFileSync(path.join(proofDir, 'closure-otherplan-2026-04-22T03-00-00Z.md'), '');
    assert.equal(receipt.findPriorClosure(proofDir, 'demo'), null);
  });
});

describe('renderReceipt', () => {
  it('emits all SECTION_ORDER sections (header first, Prior closure second)', () => {
    const { enforcer } = mkProject();
    writeLedger(enforcer);
    const state = receipt.loadLedgerState(path.join(enforcer, 'ledger.md'));
    const body = receipt.renderReceipt(state, {
      slug: 'sample-plan',
      gitInfo: { available: false, reason: 'test env' },
      priorClosureFilename: null,
      proofDir: path.join(enforcer, 'proof'),
      selfFilename: 'closure-sample-plan-TEST.md',
      planExtras: null,
      closedAt: '2026-04-22T03:45:12.345Z'
    });
    assert.match(body, /^# Closure Receipt -- sample-plan/);
    assert.match(body, /\n## Prior closure\n- none \(first close of this plan\)/);
    assert.match(body, /\n## Status\n```/);
    assert.match(body, /\n## Task ledger\n\| ID \| Task/);
    assert.match(body, /\n## Decision Log summary\n/);
    assert.match(body, /\n## Reconciliation history\n/);
    assert.match(body, /\n## Files changed\n/);
    assert.match(body, /\n## Blocked \/ open coordination\n/);
    assert.match(body, /\n## Proof artifacts\n/);
  });
  it('omits Plan-specific extras when plan lacks them', () => {
    const { enforcer } = mkProject();
    writeLedger(enforcer);
    const state = receipt.loadLedgerState(path.join(enforcer, 'ledger.md'));
    const body = receipt.renderReceipt(state, {
      slug: 'sample-plan',
      gitInfo: { available: false, reason: 'x' },
      priorClosureFilename: null,
      proofDir: path.join(enforcer, 'proof'),
      selfFilename: 'self.md',
      planExtras: null
    });
    assert.ok(!body.includes('## Plan-specific extras'));
  });
  it('renders Prior closure as link when predecessor exists', () => {
    const { enforcer } = mkProject();
    writeLedger(enforcer);
    const state = receipt.loadLedgerState(path.join(enforcer, 'ledger.md'));
    const body = receipt.renderReceipt(state, {
      slug: 'sample-plan',
      gitInfo: { available: false, reason: 'x' },
      priorClosureFilename: 'closure-sample-plan-2026-04-21T01-00-00Z.md',
      proofDir: path.join(enforcer, 'proof'),
      selfFilename: 'self.md',
      planExtras: null
    });
    assert.match(body, /\[closure-sample-plan-2026-04-21T01-00-00Z\.md\]\(\.\/closure-sample-plan-2026-04-21T01-00-00Z\.md\)/);
  });
  it('output is ASCII only', () => {
    const { enforcer } = mkProject();
    writeLedger(enforcer);
    const state = receipt.loadLedgerState(path.join(enforcer, 'ledger.md'));
    const body = receipt.renderReceipt(state, {
      slug: 'sample-plan',
      gitInfo: { available: true, headSha: 'abc123', diffStat: 'src/a.js | 1 +' },
      priorClosureFilename: null,
      proofDir: path.join(enforcer, 'proof'),
      selfFilename: 'self.md',
      planExtras: null,
      closedAt: '2026-04-22T03:45:12.345Z'
    });
    // Any non-ASCII character would fail this
    for (let i = 0; i < body.length; i += 1) {
      const code = body.charCodeAt(i);
      assert.ok(code < 128, `non-ASCII char ${code.toString(16)} at index ${i}: ${body.slice(Math.max(0, i - 20), i + 20)}`);
    }
  });
});

describe('writeReceipt', () => {
  it('writes to proof dir with derived filename and never overwrites', () => {
    const { dir, enforcer } = mkProject();
    writeLedger(enforcer, { source: 'docs/plans/2026-04-22-demo.md' });
    const first = receipt.writeReceipt(dir, { now: new Date('2026-04-22T05:10:00.000Z') });
    assert.ok(fs.existsSync(first.path));
    assert.equal(first.slug, 'demo');
    const second = receipt.writeReceipt(dir, { now: new Date('2026-04-22T05:10:00.000Z') });
    assert.notEqual(first.path, second.path);
    assert.match(path.basename(second.path), /-2\.md$/);
  });
  it('reports planOpen=true when rows still pending', () => {
    const { dir, enforcer } = mkProject();
    writeLedger(enforcer, { source: 'docs/plans/demo.md', tasks: [
      { id: 'T1', name: 'open', status: 'pending' }
    ]});
    const result = receipt.writeReceipt(dir, {});
    assert.equal(result.planOpen, true);
  });
  it('planOpen=false when every active row is terminal', () => {
    const { dir, enforcer } = mkProject();
    writeLedger(enforcer, { source: 'docs/plans/demo.md', tasks: [
      { id: 'T1', name: 'done', status: 'verified', evidence: 'ok' },
      { id: 'T2', name: 'skipped work', status: 'superseded' }
    ]});
    const result = receipt.writeReceipt(dir, {});
    assert.equal(result.planOpen, false);
  });
});

describe('section renderers handle empty input', () => {
  it('renderDecisionLog on empty decisions', () => {
    const out = receipt.renderDecisionLog({ decisions: [] });
    assert.match(out, /_\(no decision log entries\)_/);
  });
  it('renderReconciliation on empty history', () => {
    const out = receipt.renderReconciliation({ reconciliations: [] });
    assert.match(out, /_\(no reconciliation rounds recorded\)_/);
  });
  it('renderBlocked on no blocked rows', () => {
    const out = receipt.renderBlocked({ rows: [] });
    assert.match(out, /_\(nothing blocked\)_/);
  });
  it('renderTaskLedger on all-superseded', () => {
    const out = receipt.renderTaskLedger({ rows: [{ id: 'T1', name: 'old', status: 'superseded', evidence: '' }] });
    assert.match(out, /_\(no active tasks\)_/);
  });
  it('renderFilesChanged when git unavailable', () => {
    const out = receipt.renderFilesChanged({ available: false, reason: 'test' });
    assert.match(out, /_files changed: unavailable \(test\)_/);
  });
});
