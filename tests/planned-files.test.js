const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const {
  extractFromContent,
  extractFromFile,
  isCovered,
  looksLikePath,
  normalizePath,
  pathsMatch
} = require('../src/planned-files');

describe('looksLikePath', () => {
  it('accepts src/foo.ts', () => {
    assert.equal(looksLikePath('src/foo.ts'), true);
  });
  it('accepts bare README.md', () => {
    assert.equal(looksLikePath('README.md'), true);
  });
  it('rejects URLs', () => {
    assert.equal(looksLikePath('https://example.com/foo.ts'), false);
  });
  it('rejects prose words that happen to have a dot', () => {
    assert.equal(looksLikePath('done.it'), false);
    assert.equal(looksLikePath('version.1'), false);
  });
  it('rejects strings with spaces', () => {
    assert.equal(looksLikePath('src/new feature.ts'), false);
  });
  it('rejects unknown extensions', () => {
    assert.equal(looksLikePath('src/foo.xyz123'), false);
  });
});

describe('normalizePath', () => {
  it('converts backslashes to forward', () => {
    assert.equal(normalizePath('src\\foo.ts'), 'src/foo.ts');
  });
  it('strips leading ./', () => {
    assert.equal(normalizePath('./src/foo.ts'), 'src/foo.ts');
  });
  it('strips leading /', () => {
    assert.equal(normalizePath('/src/foo.ts'), 'src/foo.ts');
  });
});

describe('pathsMatch', () => {
  it('exact match', () => {
    assert.equal(pathsMatch('src/app.ts', 'src/app.ts'), true);
  });
  it('suffix match — planned longer', () => {
    assert.equal(pathsMatch('app.ts', 'src/app.ts'), true);
  });
  it('suffix match — target longer', () => {
    assert.equal(pathsMatch('project/src/app.ts', 'src/app.ts'), true);
  });
  it('different paths do not match', () => {
    assert.equal(pathsMatch('src/foo.ts', 'src/bar.ts'), false);
  });
});

describe('extractFromContent', () => {
  it('finds backtick-wrapped paths', () => {
    const files = extractFromContent('Create `src/app.ts` and `src/auth.ts`.');
    assert.ok(files.has('src/app.ts'));
    assert.ok(files.has('src/auth.ts'));
  });

  it('finds free-text paths', () => {
    const files = extractFromContent('Add tests in tests/app.test.js that cover auth.');
    assert.ok(files.has('tests/app.test.js'));
  });

  it('dedupes across mentions', () => {
    const files = extractFromContent('Touch `src/app.ts`. Later, update src/app.ts again.');
    assert.equal(files.size, 1);
    assert.ok(files.has('src/app.ts'));
  });

  it('ignores fenced code block content for the generic scan but still picks up paths from prose', () => {
    const plan = 'Use \`src/app.ts\`. Example:\n\n\`\`\`\nrequire(\'./unrelated.ts\')\n\`\`\`\n\nTest: src/app.ts.';
    const files = extractFromContent(plan);
    assert.ok(files.has('src/app.ts'));
  });

  it('rejects URL-ish content', () => {
    const files = extractFromContent('See https://example.com/docs/foo.md for details.');
    assert.equal(files.size, 0);
  });

  it('returns empty set on pure prose', () => {
    const files = extractFromContent('Build the thing. Test it. Ship it.');
    assert.equal(files.size, 0);
  });
});

describe('extractFromFile', () => {
  it('reads an existing plan and returns files', () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'pe-plan-'));
    const p = path.join(dir, 'plan.md');
    fs.writeFileSync(p, '# Plan\n\n- Create `src/app.ts`\n- Add tests/app.test.js\n');
    const { files, empty } = extractFromFile(p);
    assert.equal(empty, false);
    assert.ok(files.has('src/app.ts'));
    assert.ok(files.has('tests/app.test.js'));
  });

  it('returns empty + warning on missing file', () => {
    const r = extractFromFile('/nonexistent/plan.md');
    assert.equal(r.empty, true);
    assert.ok(r.warning);
  });

  it('returns empty + warning on null path', () => {
    const r = extractFromFile(null);
    assert.equal(r.empty, true);
    assert.ok(r.warning);
  });
});

describe('isCovered', () => {
  it('target in planned set => covered', () => {
    const planned = new Set(['src/app.ts', 'tests/app.test.js']);
    assert.equal(isCovered('src/app.ts', planned, []), true);
  });

  it('target covered by Decision Log row scope', () => {
    const planned = new Set(['src/app.ts']);
    const decisions = [{ scope: 'src/logger.ts' }];
    assert.equal(isCovered('src/logger.ts', planned, decisions), true);
  });

  it('uncovered target returns false', () => {
    const planned = new Set(['src/app.ts']);
    const decisions = [{ scope: 'T1' }]; // scope is a task ref, not path
    assert.equal(isCovered('src/new.ts', planned, decisions), false);
  });

  it('null target treated as covered (no-op for guards)', () => {
    assert.equal(isCovered(null, new Set(), []), true);
    assert.equal(isCovered('', new Set(), []), true);
  });

  it('sibling subtree heuristic covers files under a planned dir (>=2 segments)', () => {
    // Plan scaffolds src/routes/users.ts; a sibling test file in the
    // same directory should pass chain-guard without a D-row.
    const planned = new Set(['src/routes/users.ts']);
    assert.equal(isCovered('src/routes/users.test.ts', planned, []), true);
    assert.equal(isCovered('src/routes/users.helpers.ts', planned, []), true);
  });

  it('sibling heuristic does not cover files in a different subtree', () => {
    const planned = new Set(['src/routes/users.ts']);
    assert.equal(isCovered('src/middleware/auth.ts', planned, []), false);
  });

  it('sibling heuristic does not kick in for a 1-segment parent', () => {
    // Plan scaffolds src/app.ts (parent is just "src"). A single-segment
    // parent is too broad — refuse to cover the whole tree.
    const planned = new Set(['src/app.ts']);
    assert.equal(isCovered('src/new-unrelated.ts', planned, []), false);
  });
});
