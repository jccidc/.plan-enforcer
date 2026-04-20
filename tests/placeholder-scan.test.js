const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const { scanPlaceholders, PATTERNS } = require('../src/placeholder-scan');
const { reviewPlanContent } = require('../src/plan-review');

describe('scanPlaceholders — pattern matrix', () => {
  const CASES = [
    { code: 'UNRESOLVED_MARKER',     line: '- [ ] TODO: resolve this' },
    { code: 'UNRESOLVED_MARKER',     line: '- [ ] TBD' },
    { code: 'GENERIC_ERROR_HANDLING',line: '- [ ] Add error handling' },
    { code: 'GENERIC_ERROR_HANDLING',line: '- [ ] Handle errors appropriately' },
    { code: 'SIMILAR_TO_TASK',       line: '- [ ] Similar to Task 3, rebuild the cache' },
    { code: 'VAGUE_CLEANUP',         line: '- [ ] Clean up the module' },
    { code: 'VAGUE_CLEANUP',         line: '- [ ] Refactor the config reader' },
    { code: 'UNQUANTIFIED_PERF',     line: '- [ ] Make it faster' },
    { code: 'UNLISTED_EDGE_CASES',   line: '- [ ] Handle edge cases' },
    { code: 'OPTIONAL_HEDGE',        line: '- [ ] Add logging if needed' },
    { code: 'VERIFY_WITHOUT_METHOD', line: '- [ ] Ensure it works' },
    { code: 'ADVERB_DECORATION',     line: '- [ ] Test the function thoroughly' },
    { code: 'OPEN_ENDED_LIST',       line: '- [ ] Handle timeouts, retries, etc' }
  ];
  for (const c of CASES) {
    it(`flags ${c.code} on "${c.line.slice(0, 45)}"`, () => {
      const findings = scanPlaceholders(c.line);
      assert.ok(
        findings.some((f) => f.code === c.code),
        `expected ${c.code}, got: ${findings.map((f) => f.code).join(', ') || 'none'}`
      );
    });
  }

  it('does not flag concrete verification on task step', () => {
    const findings = scanPlaceholders('- [ ] Verify curl /api/foo returns 200');
    assert.equal(findings.length, 0);
  });

  it('does not flag "Verify targeted test passes"', () => {
    const findings = scanPlaceholders('- [ ] Verify targeted test passes');
    assert.equal(findings.length, 0);
  });

  it('flags VERIFY_VAGUE on "Verify the new flow works" (no evidence token)', () => {
    const findings = scanPlaceholders('- [ ] Verify the new flow works');
    assert.ok(
      findings.some((f) => f.code === 'VERIFY_VAGUE'),
      `expected VERIFY_VAGUE, got: ${findings.map((f) => f.code).join(', ') || 'none'}`
    );
  });

  it('does not flag VERIFY_VAGUE when an evidence token is on the line', () => {
    // "test" on the line is enough evidence to override the vague shape.
    const findings = scanPlaceholders('- [ ] Verify the new flow works via tests/flow.test.ts');
    assert.ok(
      !findings.some((f) => f.code === 'VERIFY_VAGUE'),
      `should not VERIFY_VAGUE when evidence token present; got: ${findings.map((f) => f.code).join(', ')}`
    );
  });

  it('does not double-flag a line already caught by VERIFY_WITHOUT_METHOD', () => {
    const findings = scanPlaceholders('- [ ] Ensure it works');
    const verifyFindings = findings.filter((f) => f.code.startsWith('VERIFY_'));
    assert.equal(verifyFindings.length, 1);
    assert.equal(verifyFindings[0].code, 'VERIFY_WITHOUT_METHOD');
  });

  it('skips fenced code blocks by default', () => {
    const text = [
      '- [ ] real task',
      '```',
      '- [ ] TODO not real',
      '```'
    ].join('\n');
    const findings = scanPlaceholders(text);
    assert.equal(findings.length, 0);
  });

  it('skips plan metadata when executableOnly=true (default)', () => {
    const text = '**Out of scope:** docs cleanup';
    assert.equal(scanPlaceholders(text).length, 0);
  });

  it('scans all lines when executableOnly=false', () => {
    const text = '**Out of scope:** docs cleanup';
    assert.equal(scanPlaceholders(text, { executableOnly: false }).length, 1);
  });

  it('fence-skip still holds under executableOnly=false', () => {
    // Regression guard: fence and executable-only filters are
    // independent; turning off executable-only must not re-expose
    // content inside code fences to the scanner.
    const text = [
      '**Out of scope:** docs cleanup',
      '```',
      '- [ ] TODO not real',
      '```'
    ].join('\n');
    const findings = scanPlaceholders(text, { executableOnly: false });
    assert.equal(findings.length, 1);
    assert.equal(findings[0].code, 'VAGUE_CLEANUP');
  });

  it('skips YAML frontmatter', () => {
    const text = [
      '---',
      'title: TODO plan',
      '---',
      '- [ ] concrete step'
    ].join('\n');
    const findings = scanPlaceholders(text);
    assert.equal(findings.length, 0);
  });

  it('exports exactly the documented patterns', () => {
    const codes = PATTERNS.map((p) => p.code).sort();
    const expected = [
      'ADVERB_DECORATION', 'GENERIC_ERROR_HANDLING', 'OPEN_ENDED_LIST',
      'OPTIONAL_HEDGE', 'SIMILAR_TO_TASK', 'UNLISTED_EDGE_CASES',
      'UNQUANTIFIED_PERF', 'UNRESOLVED_MARKER', 'VAGUE_CLEANUP',
      'VERIFY_WITHOUT_METHOD'
    ];
    assert.deepEqual(codes, expected);
  });
});

describe('plan-review integration', () => {
  it('emits placeholder_ findings with taskRef on a draft with placeholders', () => {
    const plan = [
      '# Plan',
      '',
      '**Assumptions:** x',
      '**Constraints:** y',
      '**Out of scope:** z',
      '',
      '### Task 1: Implement cache',
      '- [ ] Add Redis client setup',
      '- [ ] Handle edge cases',
      '- [ ] Verify cache smoke test passes',
      '',
      '### Task 2: Wire telemetry',
      '- [ ] Make it faster',
      '- [ ] Verify metrics export returns 200'
    ].join('\n');
    const r = reviewPlanContent(plan);
    const placeholderCodes = r.findings
      .filter((f) => f.code.startsWith('placeholder_'))
      .map((f) => ({ code: f.code, task: f.taskRef }));
    assert.ok(
      placeholderCodes.some((f) => f.code === 'placeholder_UNLISTED_EDGE_CASES' && f.task === 'T1'),
      `T1 should carry UNLISTED_EDGE_CASES, got: ${JSON.stringify(placeholderCodes)}`
    );
    assert.ok(
      placeholderCodes.some((f) => f.code === 'placeholder_UNQUANTIFIED_PERF' && f.task === 'T2'),
      `T2 should carry UNQUANTIFIED_PERF, got: ${JSON.stringify(placeholderCodes)}`
    );
  });
});

describe('plan-enforcer-combobulate skill sanity', () => {
  const skillPath = path.join(__dirname, '..', 'skills', 'plan-enforcer-combobulate', 'SKILL.md');
  const content = fs.readFileSync(skillPath, 'utf8');

  it('has YAML frontmatter with name + description', () => {
    assert.match(content, /^---\s*\n/);
    assert.match(content, /^name:\s*plan-enforcer-combobulate/m);
    assert.match(content, /^description:\s*"?\S/m);
  });

  it('points at the shared brief path', () => {
    assert.match(content, /\.plan-enforcer\/combobulate\.md/);
  });

  it('includes bailout / skip guidance', () => {
    assert.match(content, /skip|bailout/i);
  });
});

describe('plan-enforcer-discuss skill sanity', () => {
  const skillPath = path.join(__dirname, '..', 'skills', 'plan-enforcer-discuss', 'SKILL.md');
  const content = fs.readFileSync(skillPath, 'utf8');

  it('has YAML frontmatter with name + description', () => {
    assert.match(content, /^---\s*\n/);
    assert.match(content, /^name:\s*plan-enforcer-discuss/m);
    assert.match(content, /^description:\s*"?\S/m);
  });

  it('points at the public discuss packet path', () => {
    assert.match(content, /\.plan-enforcer\/discuss\.md/);
  });

  it('keeps the compatibility combobulate packet path too', () => {
    assert.match(content, /\.plan-enforcer\/combobulate\.md/);
  });

  it('frames discuss as the first stop and ships inline answer scaffolding', () => {
    const compatPath = path.join(__dirname, '..', 'skills', 'plan-enforcer-combobulate', 'SKILL.md');
    const compat = fs.readFileSync(compatPath, 'utf8');

    assert.match(content, /FIRST stop for plan-making asks/i);
    assert.match(content, /Ask at most 3 unresolved plan-shaping questions per turn/i);
    assert.match(content, /Reply in this format:/);
    assert.match(content, /1\.\s*B/);
    assert.match(content, /3\.\s*skip/i);

    assert.match(compat, /Ask at most 3 unresolved plan-shaping questions per turn/i);
    assert.match(compat, /Reply in this format:/);
  });
});

describe('plan-enforcer-draft discuss routing docs', () => {
  const skillPath = path.join(__dirname, '..', 'skills', 'plan-enforcer-draft', 'SKILL.md');
  const content = fs.readFileSync(skillPath, 'utf8');

  it('routes ambiguous asks to discuss before drafting', () => {
    assert.match(content, /plan-enforcer-discuss/i);
    assert.match(content, /needs `discuss` first/i);
  });

  it('prefers discuss packet and falls back to combobulate packet', () => {
    assert.match(content, /\.plan-enforcer\/discuss\.md/);
    assert.match(content, /\.plan-enforcer\/combobulate\.md/);
  });
});
