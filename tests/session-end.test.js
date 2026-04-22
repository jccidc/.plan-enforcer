const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawnSync } = require('child_process');

const HOOK = path.join(__dirname, '..', 'hooks', 'session-end.js');

function mkTmp(prefix) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), prefix));
  fs.writeFileSync(path.join(dir, 'package.json'), '{"name":"test"}');
  return dir;
}

function runHook(cwd) {
  const result = spawnSync(process.execPath, [HOOK], {
    cwd,
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'pipe']
  });
  return {
    code: result.status,
    stdout: result.stdout || '',
    stderr: result.stderr || ''
  };
}

function writeAwareness(cwd, rows) {
  const enf = path.join(cwd, '.plan-enforcer');
  fs.writeFileSync(path.join(enf, 'awareness.md'), [
    '# Awareness',
    '<!-- schema: v1 -->',
    '',
    '## Project-level intents',
    '',
    '| ID | Quote | Source | Captured |',
    '|----|-------|--------|----------|',
    ...rows,
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
}

describe('session-end hook', () => {
  it('no-ops when no enforcer dir present', () => {
    const cwd = mkTmp('pe-end-noop-');
    const res = runHook(cwd);
    assert.equal(res.code, 0);
    assert.equal(res.stderr, '');
  });

  it('no-ops when tier is not enforced', () => {
    const cwd = mkTmp('pe-end-struct-');
    const enf = path.join(cwd, '.plan-enforcer');
    fs.mkdirSync(enf);
    fs.writeFileSync(path.join(enf, 'config.md'), '---\ntier: structural\n---\n');
    const res = runHook(cwd);
    assert.equal(res.code, 0);
    assert.equal(res.stderr, '');
  });

  it('no-ops when ledger exists', () => {
    const cwd = mkTmp('pe-end-live-');
    const enf = path.join(cwd, '.plan-enforcer');
    fs.mkdirSync(enf);
    fs.writeFileSync(path.join(enf, 'config.md'), '---\ntier: enforced\n---\n');
    fs.writeFileSync(path.join(enf, 'ledger.md'), '# Ledger\n');
    const res = runHook(cwd);
    assert.equal(res.code, 0);
    assert.equal(res.stderr, '');
  });

  it('no-ops when an archived ledger exists', () => {
    const cwd = mkTmp('pe-end-archived-');
    const enf = path.join(cwd, '.plan-enforcer');
    fs.mkdirSync(path.join(enf, 'archive'), { recursive: true });
    fs.writeFileSync(path.join(enf, 'config.md'), '---\ntier: enforced\n---\n');
    fs.writeFileSync(path.join(enf, 'archive', '2026-04-01-done.md'), '# Done\n');
    const res = runHook(cwd);
    assert.equal(res.code, 0);
    assert.equal(res.stderr, '');
  });

  it('fails loud when enforced tier has no ledger and no archive', () => {
    const cwd = mkTmp('pe-end-fail-');
    const enf = path.join(cwd, '.plan-enforcer');
    fs.mkdirSync(enf);
    fs.writeFileSync(path.join(enf, 'config.md'), '---\ntier: enforced\n---\n');
    const res = runHook(cwd);
    assert.equal(res.code, 2);
    assert.match(res.stderr, /ENFORCED-TIER RUN-END FAILURE/);
    assert.equal(res.stdout, '');
  });

  it('chain integrity: verified row with empty Chain blocks at enforced', () => {
    const cwd = mkTmp('pe-end-chain-fail-');
    const enf = path.join(cwd, '.plan-enforcer');
    fs.mkdirSync(enf);
    fs.writeFileSync(path.join(enf, 'config.md'), '---\ntier: enforced\n---\n');
    fs.writeFileSync(path.join(enf, 'ledger.md'), `# Plan Enforcer Ledger
<!-- schema: v2 -->

## Task Ledger

| ID  | Task  | Status   | Evidence | Chain | Notes |
|-----|-------|----------|----------|-------|-------|
| T1  | Build | verified | done     |       |       |
| T2  | Ship  | skipped  |          |       |       |

## Decision Log

| ID | Type | Scope | Reason | Evidence |
|----|------|-------|--------|----------|
`);
    const res = runHook(cwd);
    assert.equal(res.code, 2);
    assert.match(res.stderr, /CHAIN INTEGRITY WARNING/);
    assert.equal(res.stdout, '');
    assert.match(res.stderr, /T1 - Build/);
  });

  it('chain integrity: verified row with Chain present passes', () => {
    const cwd = mkTmp('pe-end-chain-ok-');
    const enf = path.join(cwd, '.plan-enforcer');
    fs.mkdirSync(enf);
    fs.writeFileSync(path.join(enf, 'config.md'), '---\ntier: enforced\n---\n');
    fs.writeFileSync(path.join(enf, 'ledger.md'), `# Plan Enforcer Ledger
<!-- schema: v2 -->

## Task Ledger

| ID  | Task  | Status   | Evidence    | Chain          | Notes |
|-----|-------|----------|-------------|----------------|-------|
| T1  | Build | verified | commit a1b  | D1, C:a1b2c3d  |       |
| T2  | Ship  | skipped  |             |                |       |

## Decision Log

| ID | Type      | Scope | Reason | Evidence |
|----|-----------|-------|--------|----------|
| D1 | deviation | T1    | just 'cause | commit a1b |
`);
    const res = runHook(cwd);
    assert.equal(res.code, 0);
    assert.equal(res.stderr, '');
  });

  it('chain integrity: v1 ledger skips the chain check (schema N/A)', () => {
    const cwd = mkTmp('pe-end-v1-');
    const enf = path.join(cwd, '.plan-enforcer');
    fs.mkdirSync(enf);
    fs.writeFileSync(path.join(enf, 'config.md'), '---\ntier: enforced\n---\n');
    // v1 ledger: no schema marker, no Chain column
    fs.writeFileSync(path.join(enf, 'ledger.md'), `# Plan Enforcer Ledger

## Task Ledger

| ID  | Task  | Status   | Evidence | Notes |
|-----|-------|----------|----------|-------|
| T1  | Build | verified | done     |       |

## Decision Log

| ID | Task Ref | Decision | Reason |
|----|----------|----------|--------|
`);
    const res = runHook(cwd);
    assert.equal(res.code, 0, 'v1 ledger should not trigger the chain check');
    assert.equal(res.stderr, '');
  });
});

function writeProject(cwd, tier, gate, tasks) {
  const enf = path.join(cwd, '.plan-enforcer');
  fs.mkdirSync(enf, { recursive: true });
  fs.writeFileSync(path.join(enf, 'config.md'),
    `---\ntier: ${tier}\nreconcile_interval: 25\nstale_threshold: 10\ncompletion_gate: ${gate}\nledger_path: .plan-enforcer/ledger.md\n---\n`);
  const rows = tasks.map((t) =>
    `| ${t.id}  | ${t.name} | ${t.status} | ${t.evidence || ''} | ${t.chain || ''} | |`
  ).join('\n');
  fs.writeFileSync(path.join(enf, 'ledger.md'), `# Plan Enforcer Ledger
<!-- schema: v2 -->
<!-- source: p.md -->
<!-- tier: ${tier} -->

## Scoreboard
 ${tasks.length} total  |  0 done  |  0 verified  |  0 skipped  |  0 blocked

## Task Ledger

| ID  | Task | Status | Evidence | Chain | Notes |
|-----|------|--------|----------|-------|-------|
${rows}

## Decision Log

| ID | Type | Scope | Reason | Evidence |
|----|------|-------|--------|----------|
`);
  return enf;
}

describe('session-end completion_gate modes', () => {
  it('hard gate blocks session close when any row is pending', () => {
    const cwd = mkTmp('pe-end-hard-pending-');
    const enf = writeProject(cwd, 'structural', 'hard', [
      { id: 'T1', name: 'do it', status: 'verified', evidence: 'src/a.js', chain: 'C:abc1234' },
      { id: 'T2', name: 'do more', status: 'pending' }
    ]);
    const res = runHook(cwd);
    assert.equal(res.code, 2);
    assert.match(res.stderr, /hard gate/);
    assert.match(res.stderr, /T2/);
    assert.ok(fs.existsSync(path.join(enf, 'resume.md')), 'resume snapshot should exist');
  });

  it('hard gate allows close when every row is terminal', () => {
    const cwd = mkTmp('pe-end-hard-clean-');
    writeProject(cwd, 'structural', 'hard', [
      { id: 'T1', name: 'do it', status: 'verified', evidence: 'src/a.js', chain: 'C:abc1234' },
      { id: 'T2', name: 'skipped one', status: 'skipped' },
      { id: 'T3', name: 'blocked one', status: 'blocked' }
    ]);
    const res = runHook(cwd);
    assert.equal(res.code, 0);
  });

  it('audit gate never blocks but writes JSONL record', () => {
    const cwd = mkTmp('pe-end-audit-');
    const enf = writeProject(cwd, 'structural', 'audit', [
      { id: 'T1', name: 'do it', status: 'verified', evidence: 'src/a.js', chain: 'C:abc1234' },
      { id: 'T2', name: 'still going', status: 'in-progress' }
    ]);
    const res = runHook(cwd);
    assert.equal(res.code, 0);
    const logPath = path.join(enf, '.audit-log.jsonl');
    assert.ok(fs.existsSync(logPath), 'audit log should exist');
    const raw = fs.readFileSync(logPath, 'utf8').trim();
    const record = JSON.parse(raw);
    assert.equal(record.event, 'session_end_unfinished_rows');
    assert.equal(record.completion_gate, 'audit');
    assert.ok(record.unfinished.some((r) => r.id === 'T2'));
  });

  it('soft gate (default) takes no gate action when rows are pending', () => {
    const cwd = mkTmp('pe-end-soft-');
    const enf = writeProject(cwd, 'structural', 'soft', [
      { id: 'T1', name: 'pending', status: 'pending' }
    ]);
    const res = runHook(cwd);
    assert.equal(res.code, 0);
    assert.ok(!fs.existsSync(path.join(enf, '.audit-log.jsonl')));
    // No gate banner in stderr
    assert.ok(!/hard gate|audit mode/.test(res.stderr));
  });

  it('enforced tier honors configured soft gate without silent upgrade', () => {
    const cwd = mkTmp('pe-end-enforced-soft-');
    const enf = writeProject(cwd, 'enforced', 'soft', [
      { id: 'T1', name: 'pending', status: 'pending' }
    ]);
    const res = runHook(cwd);
    assert.equal(res.code, 0);
    assert.ok(!fs.existsSync(path.join(enf, '.audit-log.jsonl')));
    assert.ok(!/hard gate|audit mode/.test(res.stderr));
  });

  it('hard gate blocks when verified row expects executed check but none exists', () => {
    const cwd = mkTmp('pe-end-hard-missing-check-');
    const enf = writeProject(cwd, 'structural', 'hard', [
      { id: 'T1', name: 'do it', status: 'verified', evidence: 'package.json', chain: 'C:abc1234' }
    ]);
    fs.writeFileSync(path.join(cwd, 'package.json'), JSON.stringify({
      name: 'test',
      scripts: { test: 'node -e "process.exit(0)"' }
    }, null, 2));
    const res = runHook(cwd);
    assert.equal(res.code, 2);
    assert.match(res.stderr, /executed verification incomplete/i);
    assert.match(res.stderr, /T1/);
    assert.match(res.stderr, /no check sidecar exists/i);
  });

  it('audit gate logs executed-verification gaps without blocking', () => {
    const cwd = mkTmp('pe-end-audit-missing-check-');
    const enf = writeProject(cwd, 'structural', 'audit', [
      { id: 'T1', name: 'do it', status: 'verified', evidence: 'package.json', chain: 'C:abc1234' }
    ]);
    fs.writeFileSync(path.join(cwd, 'package.json'), JSON.stringify({
      name: 'test',
      scripts: { test: 'node -e "process.exit(0)"' }
    }, null, 2));
    const res = runHook(cwd);
    assert.equal(res.code, 0);
    const raw = fs.readFileSync(path.join(enf, '.audit-log.jsonl'), 'utf8').trim().split('\n').pop();
    const record = JSON.parse(raw);
    assert.equal(record.event, 'session_end_executed_verification_gap');
    assert.equal(record.rows[0].id, 'T1');
  });

  it('enforced tier blocks when awareness has orphan intents', () => {
    const cwd = mkTmp('pe-end-enforced-awareness-orphan-');
    writeProject(cwd, 'enforced', 'soft', [
      { id: 'T1', name: 'do it', status: 'verified', evidence: 'src/a.js', chain: 'C:abc1234' }
    ]);
    writeAwareness(cwd, ['| I1 | keep replay dossier explicit | manual | 2026-04-19 |']);
    const res = runHook(cwd);
    assert.equal(res.code, 2);
    assert.match(res.stderr, /orphan user intent/i);
    assert.match(res.stderr, /I1/);
  });

  it('audit gate logs orphan awareness intents without blocking', () => {
    const cwd = mkTmp('pe-end-audit-awareness-orphan-');
    const enf = writeProject(cwd, 'structural', 'audit', [
      { id: 'T1', name: 'do it', status: 'verified', evidence: 'src/a.js', chain: 'C:abc1234' }
    ]);
    writeAwareness(cwd, ['| I1 | keep replay dossier explicit | manual | 2026-04-19 |']);
    const res = runHook(cwd);
    assert.equal(res.code, 0);
    const raw = fs.readFileSync(path.join(enf, '.audit-log.jsonl'), 'utf8').trim().split('\n').pop();
    const record = JSON.parse(raw);
    assert.equal(record.event, 'session_end_orphan_intents');
    assert.equal(record.intents[0].id, 'I1');
  });

  it('structural tier warns on orphan awareness intents without blocking', () => {
    const cwd = mkTmp('pe-end-struct-awareness-orphan-');
    writeProject(cwd, 'structural', 'soft', [
      { id: 'T1', name: 'do it', status: 'verified', evidence: 'src/a.js', chain: 'C:abc1234' }
    ]);
    writeAwareness(cwd, ['| I1 | keep replay dossier explicit | manual | 2026-04-19 |']);
    const res = runHook(cwd);
    assert.equal(res.code, 0);
    assert.match(res.stderr, /\[warn\]/);
    assert.match(res.stderr, /orphan user intent/i);
  });
});
