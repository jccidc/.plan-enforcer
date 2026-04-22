const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { execFileSync } = require('child_process');

const HOOK = path.join(__dirname, '..', 'hooks', 'ledger-schema-guard.js');
const {
  taskIdsIn,
  coverageRows,
  isCovered,
  isInitialization,
  detectRowRemoval,
  detectAcrossEdits
} = require('../src/ledger-row-removal');

// ---------- pure module tests ----------

describe('ledger-row-removal — taskIdsIn', () => {
  it('extracts T-row IDs from a block', () => {
    const text = `## Task Ledger\n\n| T1 | a | pending | | | |\n| T2 | b | pending | | | |\n| T10 | c | done | | | |\n`;
    const ids = taskIdsIn(text);
    assert.deepEqual([...ids].sort(), ['T1', 'T10', 'T2']);
  });

  it('returns empty on empty input', () => {
    assert.equal(taskIdsIn('').size, 0);
    assert.equal(taskIdsIn(null).size, 0);
  });
});

// ---------- bash-false-positive regression (v0.1.3) ----------

function mkTinyProject() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'pe-schema-guard-'));
  const enforcer = path.join(dir, '.plan-enforcer');
  fs.mkdirSync(enforcer, { recursive: true });
  const ledger = [
    '# Plan Enforcer Ledger',
    '<!-- schema: v2 -->',
    '<!-- source: docs/plans/demo.md -->',
    '',
    '## Task Ledger',
    '',
    '| ID | Task | Status | Evidence | Chain | Notes |',
    '|----|------|--------|----------|-------|-------|',
    '| T1 | work | pending |  |  |  |',
    '',
    '## Decision Log',
    '',
    '| ID | Type | Scope | Reason | Evidence |',
    '|----|------|-------|--------|----------|',
    '',
    '## Reconciliation History',
    '',
    '| Round | Tasks Checked | Gaps Found | Action Taken |',
    '|-------|---------------|------------|--------------|',
    ''
  ].join('\n');
  fs.writeFileSync(path.join(enforcer, 'ledger.md'), ledger, 'utf8');
  fs.writeFileSync(path.join(enforcer, 'config.md'), '---\ntier: structural\n---\n', 'utf8');
  fs.writeFileSync(path.join(dir, 'package.json'), JSON.stringify({ name: 't' }, null, 2));
  return dir;
}

function runGuard(dir, payload) {
  const stdin = JSON.stringify(payload || {});
  try {
    execFileSync(process.execPath, [HOOK], {
      cwd: dir,
      input: stdin,
      stdio: ['pipe', 'pipe', 'pipe']
    });
    return { code: 0, stderr: '' };
  } catch (e) {
    return { code: e.status, stderr: (e.stderr || Buffer.from('')).toString() };
  }
}

describe('ledger-schema-guard bash heuristic (v0.1.3)', () => {
  it('does not block git commands that merely mention the ledger path and use stderr-to-stdout redirect', () => {
    const dir = mkTinyProject();
    // Previously "2>&1" + path-mention would false-trigger the mutation
    // heuristic even though the command is a git push, not a mutation.
    const command = 'git push origin main --follow-tags 2>&1 # touching .plan-enforcer/ledger.md in message only';
    const result = runGuard(dir, { tool_name: 'Bash', tool_input: { command } });
    assert.equal(result.code, 0, `unexpected block: ${result.stderr}`);
  });

  it('still blocks a real redirect writing to the ledger file', () => {
    const dir = mkTinyProject();
    const command = 'echo garbage > .plan-enforcer/ledger.md';
    const result = runGuard(dir, { tool_name: 'Bash', tool_input: { command } });
    assert.notEqual(result.code, 0, 'real redirect to ledger should still be blocked');
  });

  it('does not block commit commands where the commit message contains stderr-to-stdout tokens', () => {
    const dir = mkTinyProject();
    const command = 'git commit -m "note: pipes 2>&1 and mentions .plan-enforcer/ledger.md in prose"';
    const result = runGuard(dir, { tool_name: 'Bash', tool_input: { command } });
    assert.equal(result.code, 0, `unexpected block: ${result.stderr}`);
  });
});

describe('ledger-row-removal — coverage', () => {
  it('picks up delete/unplanned/deviation rows', () => {
    const text = `| D1 | delete | T6, T7 | scope removed | evidence |\n| D2 | reconcile | T1 | noise | x |\n| D3 | unplanned | T9 | added | y |\n`;
    const rows = coverageRows(text);
    assert.equal(rows.length, 2);
    assert.equal(rows[0].type, 'delete');
    assert.equal(rows[1].type, 'unplanned');
  });

  it('isCovered matches whole-word T-IDs', () => {
    const rows = [{ type: 'delete', scope: 'T6, T7' }];
    assert.equal(isCovered('T6', rows), true);
    assert.equal(isCovered('T7', rows), true);
    assert.equal(isCovered('T70', rows), false); // not covered by T7
    assert.equal(isCovered('T8', rows), false);
  });
});

describe('ledger-row-removal — isInitialization', () => {
  it('old empty => initialization', () => {
    assert.equal(isInitialization('', '<!-- created: now -->\n| T1 | ...'), true);
  });

  it('new header arrives without old header => initialization', () => {
    assert.equal(isInitialization('old ledger no header', '<!-- created: now -->\n| T1 | ...'), true);
  });

  it('both have header => not initialization', () => {
    assert.equal(isInitialization('<!-- created: a -->', '<!-- created: b -->'), false);
  });
});

describe('ledger-row-removal — detectRowRemoval', () => {
  const before = '| T1 | a | pending | | | |\n| T2 | b | pending | | | |\n| T3 | c | pending | | | |\n';

  it('row count unchanged => no removal', () => {
    const r = detectRowRemoval(before, before);
    assert.deepEqual(r.removed, []);
    assert.deepEqual(r.uncovered, []);
  });

  it('row added => no removal', () => {
    const after = before + '| T4 | d | pending | | | |\n';
    const r = detectRowRemoval(before, after);
    assert.deepEqual(r.removed, []);
    assert.deepEqual(r.uncovered, []);
  });

  it('row removed without coverage => uncovered', () => {
    const after = '| T1 | a | pending | | | |\n| T2 | b | pending | | | |\n';
    const r = detectRowRemoval(before, after);
    assert.deepEqual(r.removed, ['T3']);
    assert.deepEqual(r.uncovered, ['T3']);
  });

  it('row removed WITH coverage => covered', () => {
    const after = '| T1 | a | pending | | | |\n| T2 | b | pending | | | |\n\n| D1 | delete | T3 | scope dropped | ok |\n';
    const r = detectRowRemoval(before, after);
    assert.deepEqual(r.removed, ['T3']);
    assert.deepEqual(r.uncovered, []);
  });

  it('multiple removed, partial coverage => uncovered only the bare ones', () => {
    const after = '| T1 | a | pending | | | |\n\n| D1 | delete | T2 | only T2 covered | ok |\n';
    const r = detectRowRemoval(before, after);
    assert.deepEqual(r.removed.sort(), ['T2', 'T3']);
    assert.deepEqual(r.uncovered, ['T3']);
  });

  it('initialization edit => never flagged', () => {
    const r = detectRowRemoval('', '<!-- created: x -->\n| T1 | a | pending | | | |\n');
    assert.deepEqual(r.removed, []);
  });
});

describe('ledger-row-removal — detectAcrossEdits (MultiEdit)', () => {
  it('D-row added in edit #2 covers T-row dropped in edit #1', () => {
    const edits = [
      { old: '| T1 | a | pending | | | |\n| T2 | b | pending | | | |\n', new: '| T1 | a | pending | | | |\n' },
      { old: '| D-end |\n', new: '| D-end |\n| D1 | delete | T2 | scope | ok |\n' }
    ];
    const r = detectAcrossEdits(edits);
    assert.deepEqual(r.removed, ['T2']);
    assert.deepEqual(r.uncovered, []);
  });

  it('no coverage across either edit => uncovered', () => {
    const edits = [
      { old: '| T1 | a | pending | | | |\n| T2 | b | pending | | | |\n', new: '| T1 | a | pending | | | |\n' }
    ];
    const r = detectAcrossEdits(edits);
    assert.deepEqual(r.uncovered, ['T2']);
  });
});

// ---------- end-to-end hook tests ----------

function mkProject(tier, ledgerContent) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'pe-schema-guard-'));
  fs.writeFileSync(path.join(dir, 'package.json'), JSON.stringify({ name: 'test' }));
  const enforcer = path.join(dir, '.plan-enforcer');
  fs.mkdirSync(enforcer);
  fs.writeFileSync(path.join(enforcer, 'config.md'), `---\ntier: ${tier}\n---\n`);
  fs.writeFileSync(path.join(enforcer, 'ledger.md'), ledgerContent);
  return dir;
}

const LEDGER_15 = `# Plan Enforcer Ledger
<!-- schema: v2 -->
<!-- source: docs/plans/plan.md -->
<!-- tier: enforced -->
<!-- created: 2026-04-15T00:00:00Z -->

## Task Ledger

| ID  | Task   | Status  | Evidence | Chain | Notes |
|-----|--------|---------|----------|-------|-------|
${Array.from({ length: 15 }, (_, i) => `| T${i + 1} | task${i + 1} | pending | | | |`).join('\n')}

## Decision Log

| ID | Type | Scope | Reason | Evidence |
|----|------|-------|--------|----------|
`;

function runHook(cwd, toolName, toolInput) {
  const stdinPayload = JSON.stringify({ tool_name: toolName, tool_input: toolInput });
  try {
    const stdout = execFileSync(process.execPath, [HOOK], {
      cwd,
      input: stdinPayload,
      stdio: ['pipe', 'pipe', 'pipe']
    });
    return { code: 0, stdout: stdout.toString(), stderr: '' };
  } catch (e) {
    return {
      code: e.status,
      stdout: (e.stdout || Buffer.from('')).toString(),
      stderr: (e.stderr || Buffer.from('')).toString()
    };
  }
}

describe('ledger-schema-guard — silent pass-through', () => {
  it('no enforcer dir => allow', () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'pe-noguard-'));
    fs.writeFileSync(path.join(dir, 'package.json'), '{"name":"t"}');
    const r = runHook(dir, 'Edit', { file_path: 'anywhere.md', old_string: 'a', new_string: 'b' });
    assert.equal(r.code, 0);
  });

  it('tool not in guarded set => allow', () => {
    const dir = mkProject('enforced', LEDGER_15);
    const r = runHook(dir, 'Read', { file_path: '.plan-enforcer/ledger.md' });
    assert.equal(r.code, 0);
  });

  it('edit targeting a non-ledger file => allow', () => {
    const dir = mkProject('enforced', LEDGER_15);
    const r = runHook(dir, 'Edit', {
      file_path: path.join(dir, 'src/app.ts'),
      old_string: '| T1 |',
      new_string: ''
    });
    assert.equal(r.code, 0);
  });

  it('bash read against ledger => allow', () => {
    const dir = mkProject('enforced', LEDGER_15);
    const r = runHook(dir, 'Bash', {
      command: 'grep "T1" .plan-enforcer/ledger.md'
    });
    assert.equal(r.code, 0);
  });
});

describe('ledger-schema-guard — enforced tier', () => {
  function editLedger(dir, oldStr, newStr) {
    return runHook(dir, 'Edit', {
      file_path: path.join(dir, '.plan-enforcer', 'ledger.md'),
      old_string: oldStr,
      new_string: newStr
    });
  }

  it('row count unchanged => allow', () => {
    const dir = mkProject('enforced', LEDGER_15);
    const r = editLedger(dir,
      '| T5 | task5 | pending | | | |',
      '| T5 | task5 | in-progress | claimed | | |'
    );
    assert.equal(r.code, 0);
  });

  it('row added => allow', () => {
    const dir = mkProject('enforced', LEDGER_15);
    const r = editLedger(dir,
      '| T15 | task15 | pending | | | |',
      '| T15 | task15 | pending | | | |\n| T16 | extra | pending | | | |'
    );
    assert.equal(r.code, 0);
  });

  it('row removed WITH covering delete D-row => allow', () => {
    const dir = mkProject('enforced', LEDGER_15);
    const oldStr = '| T6 | task6 | pending | | | |\n| T7 | task7 | pending | | | |\n';
    const newStr = '| D1 | delete | T6, T7 | scope removed by user | ok |\n';
    const r = editLedger(dir, oldStr, newStr);
    assert.equal(r.code, 0, r.stderr);
  });

  it('row removed WITHOUT coverage => block', () => {
    const dir = mkProject('enforced', LEDGER_15);
    const oldStr = '| T6 | task6 | pending | | | |\n| T7 | task7 | pending | | | |\n';
    const newStr = '| T6 | task6 | pending | | | |\n';
    const r = editLedger(dir, oldStr, newStr);
    assert.equal(r.code, 2, 'should block');
    assert.match(r.stderr, /T7/);
  });

  it('medium/native tampering scenario => block', () => {
    const dir = mkProject('enforced', LEDGER_15);
    const oldStr = Array.from({ length: 15 }, (_, i) => `| T${i + 1} | task${i + 1} | pending | | | |`).join('\n');
    const newStr = Array.from({ length: 5 }, (_, i) => `| T${i + 1} | surviving${i + 1} | verified | evidence | | |`).join('\n');
    const r = editLedger(dir, oldStr, newStr);
    assert.equal(r.code, 2, 'must block the 15->5 compaction');
    assert.match(r.stderr, /T6|T11|10 T-row|uncovered/i);
  });

  it('partial coverage: 2 removed, 1 covered => block', () => {
    const dir = mkProject('enforced', LEDGER_15);
    const oldStr = '| T6 | task6 | pending | | | |\n| T7 | task7 | pending | | | |\n';
    const newStr = '| D1 | delete | T6 | only T6 covered | ok |\n';
    const r = editLedger(dir, oldStr, newStr);
    assert.equal(r.code, 2);
    assert.match(r.stderr, /T7/);
  });

  it('bash shell mutation against ledger => block', () => {
    const dir = mkProject('enforced', LEDGER_15);
    const r = runHook(dir, 'Bash', {
      command: "sed -i '/^| T7 /d' .plan-enforcer/ledger.md"
    });
    assert.equal(r.code, 2);
    assert.match(r.stderr, /T-row|T7|Decision Log/i);
  });

  it('bash redirect overwrite against ledger => block', () => {
    const dir = mkProject('enforced', LEDGER_15);
    const r = runHook(dir, 'Bash', {
      command: "cat > .plan-enforcer/ledger.md <<'EOF'\ntruncated\nEOF"
    });
    assert.equal(r.code, 2);
    assert.match(r.stderr, /T-row|Decision Log/i);
  });

  it('bulk pending -> done sweep => block', () => {
    const dir = mkProject('enforced', LEDGER_15);
    const oldStr = [
      '| T2 | task2 | pending | | | |',
      '| T3 | task3 | pending | | | |',
      '| T4 | task4 | pending | | | |',
      '| T5 | task5 | pending | | | |',
      '| T6 | task6 | pending | | | |'
    ].join('\n');
    const newStr = [
      '| T2 | task2 | done | src/t2.ts | | |',
      '| T3 | task3 | done | src/t3.ts | | |',
      '| T4 | task4 | done | src/t4.ts | | |',
      '| T5 | task5 | done | src/t5.ts | | |',
      '| T6 | task6 | pending | | | |'
    ].join('\n');
    const r = editLedger(dir, oldStr, newStr);
    assert.equal(r.code, 2, 'must block bulk pending closure');
    assert.match(r.stderr, /bulk pending closure|mass-mark/i);
  });
});

describe('ledger-schema-guard — structural tier', () => {
  it('uncovered removal still blocks (matches unlogged_delete matrix)', () => {
    const dir = mkProject('structural', LEDGER_15);
    const r = runHook(dir, 'Edit', {
      file_path: path.join(dir, '.plan-enforcer', 'ledger.md'),
      old_string: '| T6 | task6 | pending | | | |',
      new_string: ''
    });
    assert.equal(r.code, 2);
  });

  it('bulk pending -> done sweep also blocks', () => {
    const dir = mkProject('structural', LEDGER_15);
    const r = runHook(dir, 'Edit', {
      file_path: path.join(dir, '.plan-enforcer', 'ledger.md'),
      old_string: [
        '| T2 | task2 | pending | | | |',
        '| T3 | task3 | pending | | | |',
        '| T4 | task4 | pending | | | |',
        '| T5 | task5 | pending | | | |',
        '| T6 | task6 | pending | | | |'
      ].join('\n'),
      new_string: [
        '| T2 | task2 | done | src/t2.ts | | |',
        '| T3 | task3 | done | src/t3.ts | | |',
        '| T4 | task4 | done | src/t4.ts | | |',
        '| T5 | task5 | done | src/t5.ts | | |',
        '| T6 | task6 | pending | | | |'
      ].join('\n')
    });
    assert.equal(r.code, 2);
  });
});

describe('ledger-schema-guard — advisory tier', () => {
  it('uncovered removal audits, never blocks', () => {
    const dir = mkProject('advisory', LEDGER_15);
    const r = runHook(dir, 'Edit', {
      file_path: path.join(dir, '.plan-enforcer', 'ledger.md'),
      old_string: '| T6 | task6 | pending | | | |',
      new_string: ''
    });
    assert.equal(r.code, 0);
    assert.match(r.stdout, /unlogged deletion|audit/i);
  });

  it('bulk pending -> done sweep audits, never blocks', () => {
    const dir = mkProject('advisory', LEDGER_15);
    const r = runHook(dir, 'Edit', {
      file_path: path.join(dir, '.plan-enforcer', 'ledger.md'),
      old_string: [
        '| T2 | task2 | pending | | | |',
        '| T3 | task3 | pending | | | |',
        '| T4 | task4 | pending | | | |',
        '| T5 | task5 | pending | | | |',
        '| T6 | task6 | pending | | | |'
      ].join('\n'),
      new_string: [
        '| T2 | task2 | done | src/t2.ts | | |',
        '| T3 | task3 | done | src/t3.ts | | |',
        '| T4 | task4 | done | src/t4.ts | | |',
        '| T5 | task5 | done | src/t5.ts | | |',
        '| T6 | task6 | pending | | | |'
      ].join('\n')
    });
    assert.equal(r.code, 0);
    assert.match(r.stdout, /bulk pending closure|audit/i);
  });
});

describe('ledger-schema-guard — Write tool', () => {
  it('Write that reduces row count blocks', () => {
    const dir = mkProject('enforced', LEDGER_15);
    const ledgerPath = path.join(dir, '.plan-enforcer', 'ledger.md');
    const shrunk = `<!-- created: 2026-04-15T00:00:00Z -->\n| T1 | a | verified | done | | |\n`;
    // NOT an initialization because old ledger also had header — we're overwriting.
    const r = runHook(dir, 'Write', { file_path: ledgerPath, content: shrunk });
    assert.equal(r.code, 2, r.stdout + r.stderr);
  });

  it('Write that adds rows does not block', () => {
    const dir = mkProject('enforced', LEDGER_15);
    const ledgerPath = path.join(dir, '.plan-enforcer', 'ledger.md');
    const expanded = fs.readFileSync(ledgerPath, 'utf8') + '\n| T16 | added | pending | | | |\n';
    const r = runHook(dir, 'Write', { file_path: ledgerPath, content: expanded });
    assert.equal(r.code, 0);
  });
});

describe('ledger-schema-guard — MultiEdit correlation', () => {
  it('T-row removed in edit #1, D-row added in edit #2 => allow', () => {
    const dir = mkProject('enforced', LEDGER_15);
    const r = runHook(dir, 'MultiEdit', {
      file_path: path.join(dir, '.plan-enforcer', 'ledger.md'),
      edits: [
        { old_string: '| T6 | task6 | pending | | | |\n', new_string: '' },
        { old_string: '|----|------|-------|--------|----------|\n', new_string: '|----|------|-------|--------|----------|\n| D1 | delete | T6 | scope pruned | ok |\n' }
      ]
    });
    assert.equal(r.code, 0, r.stderr);
  });
});
