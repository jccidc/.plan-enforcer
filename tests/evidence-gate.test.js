const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { execFileSync, execSync } = require('child_process');

const HOOK = path.join(__dirname, '..', 'hooks', 'evidence-gate.js');

function mkProject(tier, taskRow, evidence, scripts, extraConfig) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'pe-evg-'));
  fs.writeFileSync(path.join(dir, 'package.json'), JSON.stringify({
    name: 't',
    scripts: scripts || {}
  }, null, 2));
  execSync('git init -q', { cwd: dir });
  execSync('git -c user.email=t@t -c user.name=t add -A && git -c user.email=t@t -c user.name=t commit -q -m init', { cwd: dir });
  const enforcer = path.join(dir, '.plan-enforcer');
  fs.mkdirSync(enforcer);
  const extra = extraConfig ? `${extraConfig}\n` : '';
  fs.writeFileSync(path.join(enforcer, 'config.md'), `---\ntier: ${tier}\n${extra}---\n`);
  const ledger = `# Plan Enforcer Ledger
<!-- schema: v2 -->
<!-- source: docs/plans/p.md -->

## Task Ledger

| ID | Task  | Status   | Evidence  | Chain | Notes |
|----|-------|----------|-----------|-------|-------|
${taskRow || `| T1 | Build | verified | ${evidence || ''} |       |       |`}

## Decision Log

| ID | Type | Scope | Reason | Evidence |
|----|------|-------|--------|----------|

## Reconciliation History

| Round | Tasks Checked | Gaps Found | Action Taken |
|-------|---------------|------------|--------------|
`;
  fs.writeFileSync(path.join(enforcer, 'ledger.md'), ledger);
  return dir;
}

function runHook(cwd, payload) {
  const stdin = JSON.stringify(payload);
  try {
    const stdout = execFileSync(process.execPath, [HOOK], { cwd, input: stdin, stdio: ['pipe', 'pipe', 'pipe'] });
    return { code: 0, stdout: stdout.toString(), stderr: '' };
  } catch (e) {
    return { code: e.status, stdout: (e.stdout || Buffer.from('')).toString(), stderr: (e.stderr || Buffer.from('')).toString() };
  }
}

function writeAwareness(dir, rows) {
  const enforcer = path.join(dir, '.plan-enforcer');
  fs.writeFileSync(path.join(enforcer, 'awareness.md'), [
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

describe('evidence-gate - silent pass-through', () => {
  it('non-ledger edit is allowed', () => {
    const dir = mkProject('enforced', null, 'claim');
    const r = runHook(dir, { tool_name: 'Edit', tool_input: { file_path: 'src/app.ts' } });
    assert.equal(r.code, 0);
  });

  it('read/bash/other tools are allowed', () => {
    const dir = mkProject('enforced', null, 'claim');
    const r = runHook(dir, { tool_name: 'Read', tool_input: { file_path: '.plan-enforcer/ledger.md' } });
    assert.equal(r.code, 0);
  });

  it('no enforcer dir is allowed', () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'pe-evg-none-'));
    fs.writeFileSync(path.join(dir, 'package.json'), '{"name":"t"}');
    const r = runHook(dir, { tool_name: 'Edit', tool_input: { file_path: '.plan-enforcer/ledger.md' } });
    assert.equal(r.code, 0);
  });
});

describe('evidence-gate - verification with real signal', () => {
  it('existing file in evidence: allowed at enforced', () => {
    const dir = mkProject('enforced', null, 'package.json');
    const r = runHook(dir, {
      tool_name: 'Write',
      tool_input: { file_path: path.join(dir, '.plan-enforcer', 'ledger.md') }
    });
    assert.equal(r.code, 0, `expected allow, got stderr=${r.stderr}`);
  });

  it('runs executed verification when package test exists and writes sidecar', () => {
    const dir = mkProject('enforced', null, 'package.json', {
      test: 'node -e "process.exit(0)"'
    });
    const r = runHook(dir, {
      tool_name: 'Write',
      tool_input: { file_path: path.join(dir, '.plan-enforcer', 'ledger.md') }
    });
    assert.equal(r.code, 0, r.stderr);
    const latestPath = path.join(dir, '.plan-enforcer', 'checks', 'latest.json');
    assert.ok(fs.existsSync(latestPath), 'expected executed verification sidecar index');
    const latest = JSON.parse(fs.readFileSync(latestPath, 'utf8'));
    assert.equal(latest.T1.ok, true);
    assert.equal(latest.T1.command, 'npm test');
  });

  it('runs every evidence-cited verification command before config fallback', () => {
    const dir = mkProject('enforced', null, 'package.json and verified after npm run lint then npm test', {
      test: 'node -e "process.exit(0)"',
      lint: 'node -e "process.exit(0)"',
      verify: 'node -e "process.exit(1)"'
    }, 'check_cmd: npm run verify');
    const r = runHook(dir, {
      tool_name: 'Write',
      tool_input: { file_path: path.join(dir, '.plan-enforcer', 'ledger.md') }
    });
    assert.equal(r.code, 0, r.stderr);
    const latest = JSON.parse(fs.readFileSync(path.join(dir, '.plan-enforcer', 'checks', 'latest.json'), 'utf8'));
    assert.equal(latest.T1.ok, true);
    assert.equal(latest.T1.command, 'npm run lint && npm test');
    assert.deepEqual(latest.T1.commands, ['npm run lint', 'npm test']);
    assert.equal(latest.T1.runs.length, 2);
  });

  it('runs executed verification when evidence cites a node wrapper script', () => {
    const dir = mkProject('enforced', null, 'verified after node scripts/verify.js --quick');
    fs.mkdirSync(path.join(dir, 'scripts'), { recursive: true });
    fs.writeFileSync(
      path.join(dir, 'scripts', 'verify.js'),
      "console.log('verify wrapper');\nprocess.exit(0);\n"
    );
    const r = runHook(dir, {
      tool_name: 'Write',
      tool_input: { file_path: path.join(dir, '.plan-enforcer', 'ledger.md') }
    });
    assert.equal(r.code, 0, r.stderr);
    const latest = JSON.parse(fs.readFileSync(path.join(dir, '.plan-enforcer', 'checks', 'latest.json'), 'utf8'));
    assert.equal(latest.T1.ok, true);
    assert.equal(latest.T1.command, 'node ./scripts/verify.js --quick');
  });

  it('real commit SHA in evidence: allowed at enforced', () => {
    const dir = mkProject('enforced');
    const sha = execSync('git rev-parse --short HEAD', { cwd: dir }).toString().trim();
    const ledgerPath = path.join(dir, '.plan-enforcer', 'ledger.md');
    const ledger = fs.readFileSync(ledgerPath, 'utf8')
      .replace(/^\| T1 \| Build \| verified \|[^|]*\|/m, `| T1 | Build | verified | commit ${sha} |`);
    fs.writeFileSync(ledgerPath, ledger);
    const r = runHook(dir, {
      tool_name: 'Write',
      tool_input: { file_path: path.join(dir, '.plan-enforcer', 'ledger.md') }
    });
    assert.equal(r.code, 0);
  });
});

describe('evidence-gate - missing evidence by tier', () => {
  it('enforced blocks when evidence is empty', () => {
    const dir = mkProject('enforced', null, '');
    const r = runHook(dir, {
      tool_name: 'Write',
      tool_input: { file_path: path.join(dir, '.plan-enforcer', 'ledger.md') }
    });
    assert.equal(r.code, 2);
    assert.match(r.stderr, /\[block\]/);
    assert.match(r.stderr, /T1/);
  });

  it('enforced blocks when evidence is prose-only', () => {
    const dir = mkProject('enforced', null, 'everything looks good');
    const r = runHook(dir, {
      tool_name: 'Write',
      tool_input: { file_path: path.join(dir, '.plan-enforcer', 'ledger.md') }
    });
    assert.equal(r.code, 2);
  });

  it('structural also blocks missing_evidence (hard integrity break)', () => {
    const dir = mkProject('structural', null, 'tests pass');
    const r = runHook(dir, {
      tool_name: 'Write',
      tool_input: { file_path: path.join(dir, '.plan-enforcer', 'ledger.md') }
    });
    assert.equal(r.code, 2);
  });

  it('advisory audits but does not block', () => {
    const dir = mkProject('advisory', null, 'looks fine');
    const r = runHook(dir, {
      tool_name: 'Write',
      tool_input: { file_path: path.join(dir, '.plan-enforcer', 'ledger.md') }
    });
    assert.equal(r.code, 0);
    assert.match(r.stdout, /\[audit\]/);
  });

  it('blocks verified transition when executed verification command fails', () => {
    const dir = mkProject('enforced', null, 'package.json', {
      test: 'node -e "process.exit(1)"'
    });
    const r = runHook(dir, {
      tool_name: 'Write',
      tool_input: { file_path: path.join(dir, '.plan-enforcer', 'ledger.md') }
    });
    assert.equal(r.code, 2);
    assert.match(r.stderr, /Executed verification failed/);
    assert.match(r.stderr, /npm test/);
    const latest = JSON.parse(fs.readFileSync(path.join(dir, '.plan-enforcer', 'checks', 'latest.json'), 'utf8'));
    assert.equal(latest.T1.ok, false);
  });

  it('blocks when evidence claims tests passed but no runnable command can be detected', () => {
    const dir = mkProject('enforced', null, 'package.json, 3 tests passed, 0 failed');
    const r = runHook(dir, {
      tool_name: 'Write',
      tool_input: { file_path: path.join(dir, '.plan-enforcer', 'ledger.md') }
    });
    assert.equal(r.code, 2);
    assert.match(r.stderr, /no runnable command could be detected/i);
    assert.match(r.stderr, /set check_cmd/i);
  });

  it('still allows artifact-only verified evidence when no command is claimed', () => {
    const dir = mkProject('enforced', null, 'package.json');
    const r = runHook(dir, {
      tool_name: 'Write',
      tool_input: { file_path: path.join(dir, '.plan-enforcer', 'ledger.md') }
    });
    assert.equal(r.code, 0, r.stderr);
  });
});

describe('evidence-gate awareness links', () => {
  it('blocks when awareness is active but the verified row has no active A: link', () => {
    const dir = mkProject('enforced', null, 'package.json');
    writeAwareness(dir, ['| I1 | keep replay dossier explicit | manual | 2026-04-19 |']);
    const r = runHook(dir, {
      tool_name: 'Write',
      tool_input: { file_path: path.join(dir, '.plan-enforcer', 'ledger.md') }
    });
    assert.equal(r.code, 2);
    assert.match(r.stderr, /missing awareness link/i);
    assert.match(r.stderr, /no awareness link in Chain/i);
  });

  it('allows a verified row with an active awareness link', () => {
    const taskRow = '| T1 | Build replay dossier | verified | package.json | A:I1 |       |';
    const dir = mkProject('enforced', taskRow);
    writeAwareness(dir, ['| I1 | keep replay dossier explicit | manual | 2026-04-19 |']);
    const r = runHook(dir, {
      tool_name: 'Write',
      tool_input: { file_path: path.join(dir, '.plan-enforcer', 'ledger.md') }
    });
    assert.equal(r.code, 0, r.stderr);
  });

  it('warns instead of blocking at structural tier when awareness link is missing', () => {
    const dir = mkProject('structural', null, 'package.json');
    writeAwareness(dir, ['| I1 | keep replay dossier explicit | manual | 2026-04-19 |']);
    const r = runHook(dir, {
      tool_name: 'Write',
      tool_input: { file_path: path.join(dir, '.plan-enforcer', 'ledger.md') }
    });
    assert.equal(r.code, 0);
    assert.match(r.stdout, /\[warn\]/);
    assert.match(r.stdout, /no awareness link in Chain/i);
  });

  it('blocks when the awareness link is present but lexically weak', () => {
    const taskRow = '| T1 | Refactor session middleware | verified | package.json | A:I1 |       |';
    const dir = mkProject('enforced', taskRow);
    writeAwareness(dir, ['| I1 | keep replay dossier explicit | manual | 2026-04-19 |']);
    const r = runHook(dir, {
      tool_name: 'Write',
      tool_input: { file_path: path.join(dir, '.plan-enforcer', 'ledger.md') }
    });
    assert.equal(r.code, 2);
    assert.match(r.stderr, /awareness link/i);
    assert.match(r.stderr, /weak/i);
  });

  it('blocks when awareness quote cannot be verified against user-message log', () => {
    const taskRow = '| T1 | Keep replay dossier explicit | verified | package.json | A:I1 |       |';
    const dir = mkProject('enforced', taskRow);
    writeAwareness(dir, ['| I1 | keep replay dossier explicit | session-2026-04-19 | 2026-04-19 |']);
    const r = runHook(dir, {
      tool_name: 'Write',
      tool_input: { file_path: path.join(dir, '.plan-enforcer', 'ledger.md') }
    });
    assert.equal(r.code, 2);
    assert.match(r.stderr, /unverified awareness quote/i);
    assert.match(r.stderr, /AWARENESS/i);
  });

  it('allows verified row when matching user-message capture exists', () => {
    const taskRow = '| T1 | Keep replay dossier explicit | verified | package.json | A:I1 |       |';
    const dir = mkProject('enforced', taskRow);
    writeAwareness(dir, ['| I1 | keep replay dossier explicit | session-2026-04-19 | 2026-04-19 |']);
    fs.writeFileSync(path.join(dir, '.plan-enforcer', '.user-messages.jsonl'), `${JSON.stringify({
      index: 1,
      prompt: 'please keep replay dossier explicit in the shipped output'
    })}\n`);
    const r = runHook(dir, {
      tool_name: 'Write',
      tool_input: { file_path: path.join(dir, '.plan-enforcer', 'ledger.md') }
    });
    assert.equal(r.code, 0, r.stderr);
  });
});

describe('evidence-gate - Edit flips', () => {
  it('Edit that flips pending -> verified triggers validation', () => {
    const dir = mkProject('enforced', null, 'prose');
    const oldRow = '| T1 | Build | pending  |            |       |       |';
    const r = runHook(dir, {
      tool_name: 'Edit',
      tool_input: {
        file_path: path.join(dir, '.plan-enforcer', 'ledger.md'),
        old_string: oldRow,
        new_string: '| T1 | Build | verified | prose      |       |       |'
      }
    });
    assert.equal(r.code, 2);
  });

  it('Edit that does not touch T1 leaves it alone (already verified, no flip)', () => {
    const dir = mkProject('enforced', null, 'irrelevant');
    const r = runHook(dir, {
      tool_name: 'Edit',
      tool_input: {
        file_path: path.join(dir, '.plan-enforcer', 'ledger.md'),
        old_string: '## Reconciliation History',
        new_string: '## Reconciliation History'
      }
    });
    assert.equal(r.code, 0);
  });
});

describe('evidence-gate - v1 ledger exempt', () => {
  it('v1 schema skips the gate', () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'pe-evg-v1-'));
    fs.writeFileSync(path.join(dir, 'package.json'), '{"name":"t"}');
    const enforcer = path.join(dir, '.plan-enforcer');
    fs.mkdirSync(enforcer);
    fs.writeFileSync(path.join(enforcer, 'config.md'), '---\ntier: enforced\n---\n');
    fs.writeFileSync(path.join(enforcer, 'ledger.md'), `# Plan Enforcer Ledger

## Task Ledger

| ID | Task | Status | Evidence | Notes |
|----|------|--------|----------|-------|
| T1 | X | verified | prose | |
`);
    const r = runHook(dir, {
      tool_name: 'Write',
      tool_input: { file_path: path.join(dir, '.plan-enforcer', 'ledger.md') }
    });
    assert.equal(r.code, 0);
  });
});
