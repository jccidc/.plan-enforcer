// Plan Enforcer — Plan Analyzer
// Objective counts over plan text. Complements subjective judging in
// the benchmark rubric: a plan with zero named file paths, zero test
// assertions, and zero declared dependencies is measurably underspec'd
// regardless of how fluent its prose is.
//
// Pure: takes a string, returns counts + per-task breakdown. CLI layer
// wraps.

// File-path heuristic: any token that looks like a relative path with
// at least one slash and a known extension (or no ext but looks like
// a source path). Keep it strict — "foo/bar" is not enough; must have
// extension OR be in a recognized source dir segment.
const FILE_PATH_RE = /(?:^|[\s`(,'"])((?:(?:src|tests?|lib|hooks|scripts|docs|bench(?:marks)?|fixtures|scenarios|frozen-plans|skills|\.planning|\.plan-enforcer)\/[\w./-]+|(?:[\w.-]+\/)+[\w.-]+\.(?:js|ts|tsx|jsx|mjs|cjs|json|md|yml|yaml|sh|py|rb|go|rs|java|css|html|svg|toml|ini)))\b/g;

// Test-assertion heuristic: lines containing common assertion patterns
// or test function invocations.
const TEST_ASSERTION_RES = [
  // Code-shape: actual assertion / test function calls.
  /\b(assert|expect|should)\s*\.?\s*\w*\(/i,
  /\b(it|test|describe)\s*\(\s*['"`]/i,
  // Runner invocations.
  /\bnode --test\b/i,
  /\bnpm (?:run )?test\b/i,
  /\bjest\b/i,
  /\bmocha\b/i,
  /\bpytest\b/i,
  // Plan-language: kept narrow. "unit tests" alone counts once; a
  // plan-author who writes "unit tests for the X module" gets credit
  // for one test-intent signal, not five.
  /\b(?:unit|integration|regression|e2e|acceptance|smoke)\s+tests?\b/i,
  /\btest\s+(?:that|for|against|coverage|assertions?)\b/i,
  /\bverif(?:y|ication|ied)\s+(?:that|via|with|using|by)\b/i,
  /\bvalidates?\s+that\b/i
];

// Dependency declaration heuristic: explicit ordering language or
// dependency notes.
const DEPENDENCY_RES = [
  /\b(?:depends on|blocked by|requires|prerequisite)\b/i,
  /\bafter (?:task|step|T)\s*\w+/i,
  /\bbefore (?:task|step|T)\s*\w+/i,
  /\b(?:must|should)\s+(?:happen|run|complete)\s+(?:before|after)\b/i,
  /\bsequencing[:\s]/i
];

function countRegex(text, re) {
  const matches = text.match(re) || [];
  return matches.length;
}

function countAny(text, res) {
  return res.reduce((sum, re) => sum + countRegex(text, re), 0);
}

function uniqueFilePaths(text) {
  const hits = new Set();
  let m;
  const re = new RegExp(FILE_PATH_RE.source, 'g');
  while ((m = re.exec(text)) !== null) {
    hits.add(m[1]);
  }
  return Array.from(hits);
}

/**
 * Split a plan into task blocks. Recognizes `### Task N:` and
 * `## Task N:` patterns (mirrors src/plan-review.extractTaskBlocks but
 * self-contained — this module has no plan-review dependency).
 */
function splitTaskBlocks(text) {
  const blocks = [];
  const lines = text.split(/\r?\n/);
  let current = null;
  const headerRe = /^##?#?\s*Task\s+\d+:?\s*(.*)$/i;

  for (let i = 0; i < lines.length; i++) {
    const h = lines[i].match(headerRe);
    if (h) {
      if (current) blocks.push(current);
      current = { title: (h[1] || '').trim(), body: [lines[i]] };
    } else if (current) {
      current.body.push(lines[i]);
    }
  }
  if (current) blocks.push(current);
  return blocks.map((b) => ({ title: b.title, body: b.body.join('\n') }));
}

/**
 * Analyze a plan. Returns per-plan counts + per-task breakdown.
 *
 * @param {string} text - plan markdown
 * @returns {{
 *   file_paths: { total: number, unique: string[] },
 *   test_assertions: number,
 *   dependencies: number,
 *   per_task: Array<{ title: string, file_paths: number, test_assertions: number, dependencies: number }>
 * }}
 */
function analyzePlan(text) {
  const uniq = uniqueFilePaths(text);

  const testCount = countAny(text, TEST_ASSERTION_RES);
  const depCount = countAny(text, DEPENDENCY_RES);

  const blocks = splitTaskBlocks(text);
  const per_task = blocks.map((b) => ({
    title: b.title,
    file_paths: uniqueFilePaths(b.body).length,
    test_assertions: countAny(b.body, TEST_ASSERTION_RES),
    dependencies: countAny(b.body, DEPENDENCY_RES)
  }));

  return {
    file_paths: { total: uniq.length, unique: uniq },
    test_assertions: testCount,
    dependencies: depCount,
    per_task
  };
}

module.exports = {
  analyzePlan,
  splitTaskBlocks,
  uniqueFilePaths,
  FILE_PATH_RE,
  TEST_ASSERTION_RES,
  DEPENDENCY_RES
};
