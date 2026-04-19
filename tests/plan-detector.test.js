const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const {
  extractInlineAwarenessRefs,
  extractMustHaveRows,
  extractTasksFromContent,
  findPlanFile,
  isPlanContent,
  stripInlineAwarenessRefs
} = require('../src/plan-detector');

const fixture = (name) => fs.readFileSync(path.join(__dirname, 'fixtures', name), 'utf8');

function withTempProject(setup) {
  const projectRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'plan-detector-'));
  try {
    setup(projectRoot);
    return projectRoot;
  } catch (error) {
    fs.rmSync(projectRoot, { recursive: true, force: true });
    throw error;
  }
}

function writeFile(root, relativePath, content) {
  const fullPath = path.join(root, relativePath);
  fs.mkdirSync(path.dirname(fullPath), { recursive: true });
  fs.writeFileSync(fullPath, content, 'utf8');
}

describe('extractTasksFromContent', () => {
  it('detects superpowers format (### Task N:)', () => {
    const result = extractTasksFromContent(fixture('plan-superpowers.md'));
    assert.equal(result.format, 'superpowers');
    assert.equal(result.tasks.length, 3);
    assert.equal(result.tasks[0], 'Setup database');
    assert.equal(result.tasks[1], 'Build API');
    assert.equal(result.tasks[2], 'Add tests');
  });

  it('detects GSD format (## Task N:)', () => {
    const result = extractTasksFromContent(fixture('plan-gsd.md'));
    assert.equal(result.format, 'gsd');
    assert.equal(result.tasks.length, 3);
    assert.equal(result.tasks[0], 'Create widget schema');
  });

  it('detects checklist format (- [ ] / - [x])', () => {
    const result = extractTasksFromContent(fixture('plan-checklist.md'));
    assert.equal(result.format, 'checklist');
    assert.equal(result.tasks.length, 4);
    assert.equal(result.tasks[0], 'Setup project');
    assert.equal(result.tasks[2], 'Create README');
  });

  it('detects numbered format (1. 2. 3.)', () => {
    const result = extractTasksFromContent(fixture('plan-numbered.md'));
    assert.equal(result.format, 'numbered');
    assert.equal(result.tasks.length, 5);
    assert.equal(result.tasks[0], 'Initialize the repository');
    assert.equal(result.tasks[4], 'Release v1.0');
  });

  it('detects headers format (## Step N:)', () => {
    const result = extractTasksFromContent(fixture('plan-headers.md'));
    assert.equal(result.format, 'headers');
    assert.equal(result.tasks.length, 3);
    assert.ok(result.tasks[0].includes('Research'));
  });

  it('returns unknown format for unstructured content', () => {
    const result = extractTasksFromContent(fixture('plan-unknown.md'));
    assert.equal(result.format, 'unknown');
    assert.equal(result.tasks.length, 0);
  });

  it('returns unknown for empty string', () => {
    const result = extractTasksFromContent('');
    assert.equal(result.format, 'unknown');
    assert.equal(result.tasks.length, 0);
  });

  it('prioritizes superpowers over numbered when both present', () => {
    const mixed = '### Task 1: Setup\n\n1. Sub-step one\n2. Sub-step two\n';
    const result = extractTasksFromContent(mixed);
    assert.equal(result.format, 'superpowers');
    assert.equal(result.tasks.length, 1);
  });

  it('ignores task-looking examples inside fenced code blocks', () => {
    const content = [
      '# Design Doc',
      '',
      '```md',
      '### Task 1: Fake task',
      '- [ ] Example only',
      '```',
      '',
      '## Notes',
      'Not an execution plan.'
    ].join('\n');
    const result = extractTasksFromContent(content);
    assert.equal(result.format, 'unknown');
    assert.equal(result.tasks.length, 0);
  });

  it('strips inline awareness refs from task names and preserves them in taskRows', () => {
    const content = '### Task 1: Ship explicit closure A:I1, I2\n';
    const result = extractTasksFromContent(content);
    assert.equal(result.tasks[0], 'Ship explicit closure');
    assert.deepEqual(result.taskRows[0].awarenessRefs, ['I1', 'I2']);
  });

  it('does not let GSD-style detection bleed across newlines into checklist awareness refs', () => {
    const content = [
      '## Tasks',
      '',
      '- [ ] Draft `docs/strategy/dogfood-playbook-2026-04-19.md`. A:I1,I2,I3',
      '- [ ] Update `README.md`. A:I1,I3,I6'
    ].join('\n');
    const result = extractTasksFromContent(content);
    assert.equal(result.format, 'checklist');
    assert.deepEqual(result.tasks, [
      'Draft `docs/strategy/dogfood-playbook-2026-04-19.md`.',
      'Update `README.md`.'
    ]);
    assert.deepEqual(result.taskRows[0].awarenessRefs, ['I1', 'I2', 'I3']);
    assert.deepEqual(result.taskRows[1].awarenessRefs, ['I1', 'I3', 'I6']);
  });
});

describe('awareness inline parsing helpers', () => {
  it('extracts refs from A:I1,I2 / A:R1 syntax', () => {
    assert.deepEqual(
      extractInlineAwarenessRefs('Ship explicit closure [A:I1, I2] A:R1'),
      ['I1', 'I2', 'R1']
    );
  });

  it('strips inline awareness refs from visible text', () => {
    assert.equal(
      stripInlineAwarenessRefs('Ship explicit closure [A:I1, I2]'),
      'Ship explicit closure'
    );
  });
});

describe('extractMustHaveRows', () => {
  it('parses must-have tags and awareness refs', () => {
    const rows = extractMustHaveRows([
      '## Must-Haves',
      '',
      '- MH1: Users can sign up A:I1',
      '- **MH2: Search works A:R1**',
      ''
    ].join('\n'));
    assert.deepEqual(rows, [
      { tag: 'MH1', text: 'Users can sign up', awarenessRefs: ['I1'] },
      { tag: 'MH2', text: 'Search works', awarenessRefs: ['R1'] }
    ]);
  });
});

describe('isPlanContent', () => {
  it('detects checklist plans as auto-activatable', () => {
    assert.equal(isPlanContent('- [ ] Step one\n- [ ] Step two\n'), true);
  });

  it('does not auto-activate arbitrary numbered documentation', () => {
    const content = [
      '# Design Doc',
      '',
      '1. Copies skill files to ~/.claude/skills/plan-enforcer/',
      '2. Detects tier setting',
      '3. Creates config stub'
    ].join('\n');
    assert.equal(isPlanContent(content), false);
  });
});

describe('findPlanFile', () => {
  it('finds plan in docs/plans/', () => {
    const projectRoot = withTempProject((root) => {
      writeFile(root, 'docs/plans/example.md', fixture('plan-gsd.md'));
    });
    try {
      const result = findPlanFile(projectRoot);
      assert.equal(result.replace(/\\/g, '/'), 'docs/plans/example.md');
    } finally {
      fs.rmSync(projectRoot, { recursive: true, force: true });
    }
  });

  it('finds plan in root PLAN.md first', () => {
    const projectRoot = withTempProject((root) => {
      writeFile(root, 'PLAN.md', fixture('plan-superpowers.md'));
      writeFile(root, 'docs/plans/example.md', fixture('plan-gsd.md'));
    });
    try {
      const result = findPlanFile(projectRoot);
      assert.equal(result.replace(/\\/g, '/'), 'PLAN.md');
    } finally {
      fs.rmSync(projectRoot, { recursive: true, force: true });
    }
  });

  it('finds plan in .planning phase directories', () => {
    const projectRoot = withTempProject((root) => {
      writeFile(root, '.planning/milestone-01/PLAN.md', fixture('plan-superpowers.md'));
    });
    try {
      const result = findPlanFile(projectRoot);
      assert.equal(result.replace(/\\/g, '/'), '.planning/milestone-01/PLAN.md');
    } finally {
      fs.rmSync(projectRoot, { recursive: true, force: true });
    }
  });

  it('returns null for directory with no plans', () => {
    const result = findPlanFile(path.join(__dirname, 'fixtures'));
    assert.equal(result, null);
  });
});
