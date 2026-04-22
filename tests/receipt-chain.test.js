const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');

const receipt = require('../src/receipt-cli');

function mkProject() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'pe-chain-'));
  const enforcer = path.join(dir, '.plan-enforcer');
  fs.mkdirSync(enforcer, { recursive: true });
  fs.mkdirSync(path.join(enforcer, 'proof'), { recursive: true });
  fs.mkdirSync(path.join(dir, 'docs', 'plans'), { recursive: true });
  return dir;
}

function writeClosedLedger(dir, source) {
  const content = `# Plan Enforcer Ledger
<!-- schema: v2 -->
<!-- source: ${source} -->
<!-- tier: structural -->

## Task Ledger

| ID | Task | Status | Evidence | Chain | Notes |
|----|------|--------|----------|-------|-------|
| T1 | one | verified | built |  |  |

## Decision Log

| ID | Type | Scope | Reason | Evidence |
|----|------|-------|--------|----------|

## Reconciliation History

| Round | Tasks Checked | Gaps Found | Action Taken |
|-------|---------------|------------|--------------|
`;
  fs.writeFileSync(path.join(dir, '.plan-enforcer', 'ledger.md'), content, 'utf8');
}

describe('receipt chain walkability', () => {
  it('first receipt reads none; second receipt links to first', () => {
    const dir = mkProject();
    writeClosedLedger(dir, 'docs/plans/2026-04-22-chainy.md');
    const first = receipt.writeReceipt(dir, { now: new Date('2026-04-22T10:00:00.000Z') });
    const firstBody = fs.readFileSync(first.path, 'utf8');
    assert.match(firstBody, /## Prior closure\n- none \(first close of this plan\)/);

    // Simulate a reopen + second close
    writeClosedLedger(dir, 'docs/plans/2026-04-22-chainy.md');
    const second = receipt.writeReceipt(dir, { now: new Date('2026-04-22T11:00:00.000Z') });
    const secondBody = fs.readFileSync(second.path, 'utf8');
    const firstFilename = path.basename(first.path);
    assert.match(secondBody, new RegExp(`## Prior closure\\n- \\[${firstFilename}\\]\\(\\./${firstFilename}\\)`));
  });

  it('third receipt links to the latest (second), not the first', () => {
    const dir = mkProject();
    writeClosedLedger(dir, 'docs/plans/2026-04-22-chainy.md');
    const first = receipt.writeReceipt(dir, { now: new Date('2026-04-22T10:00:00.000Z') });
    const second = receipt.writeReceipt(dir, { now: new Date('2026-04-22T11:00:00.000Z') });
    const third = receipt.writeReceipt(dir, { now: new Date('2026-04-22T12:00:00.000Z') });
    const thirdBody = fs.readFileSync(third.path, 'utf8');
    const secondFilename = path.basename(second.path);
    const firstFilename = path.basename(first.path);
    // Isolate the Prior closure section to test the chain link, ignoring
    // Proof artifacts which legitimately lists every receipt in the dir.
    const priorMatch = thirdBody.match(/## Prior closure\n([\s\S]*?)\n\n## /);
    assert.ok(priorMatch, 'Prior closure section must be present');
    assert.ok(priorMatch[1].includes(secondFilename), 'Prior closure links to second');
    assert.ok(!priorMatch[1].includes(firstFilename), 'Prior closure does not reference first');
  });

  it('chain isolates per plan-slug', () => {
    const dir = mkProject();
    writeClosedLedger(dir, 'docs/plans/2026-04-22-alpha.md');
    receipt.writeReceipt(dir, { now: new Date('2026-04-22T10:00:00.000Z') });
    writeClosedLedger(dir, 'docs/plans/2026-04-22-beta.md');
    const betaFirst = receipt.writeReceipt(dir, { now: new Date('2026-04-22T11:00:00.000Z') });
    const betaBody = fs.readFileSync(betaFirst.path, 'utf8');
    assert.match(betaBody, /## Prior closure\n- none \(first close of this plan\)/);
  });
});
