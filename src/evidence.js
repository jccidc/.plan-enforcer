// Plan Enforcer — Evidence Validator
//
// Validates that an Evidence cell on a verified ledger row contains at
// least one structural signal that resolves against this session's
// artifacts. Turns "verified" from a prose claim into a checkable signal.
//
// Four signal types recognized:
//   commit  — 7-40 hex chars that resolves to a real commit on current branch
//   file    — a path that exists under the project root
//   test    — a test name / title that appears in a real test file
//   tool    — a tool name + detail that matches a record in .session-log.jsonl
//
// The validator is permissive on ambiguous prose: it extracts candidate
// signals and confirms them. An Evidence cell with zero resolvable
// signals is flagged; at least one resolvable signal = valid.
//
// Consumers (P2 T2 evidence-gate hook, P4 audit CLI) decide how to act
// on invalid evidence based on tier.

const fs = require('fs');
const path = require('path');
const { execSync } = require('child_process');

// Identifiers that need confirmation to count. Regex intentionally loose —
// validators below do the real check.
const COMMIT_RE = /\b[0-9a-f]{7,40}\b/g;
const FILE_CANDIDATE_RE = /(?:\b|^)([A-Za-z0-9_\-./]+\.[A-Za-z0-9]+)(?:\b|$)/g;
const TEST_NAME_RE = /['"`]([^'"`]{3,120})['"`]/g;
const TOOL_HINT_RE = /\b(npm test|npx vitest|pytest|go test|cargo test|Bash|Edit|Write|Read|MultiEdit)\b/g;

/**
 * Check whether a short hex string resolves to a real commit under repoRoot.
 * Returns the expanded SHA on hit, null on miss. Silent on git failure.
 * @param {string} short
 * @param {string} repoRoot
 * @returns {string | null}
 */
function resolveCommit(short, repoRoot) {
  if (!repoRoot) return null;
  try {
    // cat-file -e is more portable across shells than rev-parse ^{commit}
    // (the ^ glyph is an escape char on cmd.exe). Fall back to rev-parse
    // for the resolved SHA if cat-file confirms existence.
    execSync(`git cat-file -e ${short}`, {
      cwd: repoRoot,
      stdio: ['ignore', 'ignore', 'ignore']
    });
    const out = execSync(`git rev-parse ${short}`, {
      cwd: repoRoot,
      stdio: ['ignore', 'pipe', 'ignore']
    }).toString().trim();
    return out || null;
  } catch (e) {
    return null;
  }
}

/**
 * Check whether a candidate path exists relative to projectRoot.
 * Accepts absolute or relative paths.
 * @param {string} candidate
 * @param {string} projectRoot
 * @returns {string | null} - normalized relative path on hit, null on miss
 */
function resolveFile(candidate, projectRoot) {
  if (!candidate || !projectRoot) return null;
  const norm = candidate.replace(/^\.\//, '').replace(/\\/g, '/');
  const abs = path.isAbsolute(norm) ? norm : path.join(projectRoot, norm);
  try {
    if (fs.existsSync(abs) && fs.statSync(abs).isFile()) {
      return path.relative(projectRoot, abs).replace(/\\/g, '/');
    }
  } catch (e) { /* ignore */ }
  return null;
}

/**
 * Scan test files under projectRoot for a test name match. Returns the
 * file path on hit, null on miss.
 *
 * Only searches conventional test directories to bound the cost.
 * @param {string} name
 * @param {string} projectRoot
 * @returns {string | null}
 */
function resolveTestName(name, projectRoot) {
  if (!name || !projectRoot) return null;
  const testDirs = ['tests', 'test', '__tests__', 'spec'];
  const escaped = name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const nameRe = new RegExp(`(it|test|describe)\\s*\\(\\s*['"\`]${escaped}`);
  for (const dir of testDirs) {
    const abs = path.join(projectRoot, dir);
    if (!fs.existsSync(abs)) continue;
    const hit = walkForMatch(abs, nameRe);
    if (hit) return path.relative(projectRoot, hit).replace(/\\/g, '/');
  }
  return null;
}

function walkForMatch(dir, re, maxDepth) {
  maxDepth = maxDepth == null ? 6 : maxDepth;
  if (maxDepth < 0) return null;
  let entries;
  try { entries = fs.readdirSync(dir, { withFileTypes: true }); }
  catch (e) { return null; }
  for (const entry of entries) {
    if (entry.name.startsWith('.') || entry.name === 'node_modules') continue;
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      const nested = walkForMatch(full, re, maxDepth - 1);
      if (nested) return nested;
      continue;
    }
    if (!/\.(js|ts|jsx|tsx|mjs|cjs|py|go|rb)$/i.test(entry.name)) continue;
    try {
      const content = fs.readFileSync(full, 'utf8');
      if (re.test(content)) return full;
    } catch (e) { /* ignore */ }
  }
  return null;
}

/**
 * Check session log JSONL for a record whose tool + input/response
 * plausibly matches the evidence text. Returns the matching record
 * (first hit) or null.
 * @param {string} evidenceText
 * @param {string} sessionLogPath
 * @returns {object | null}
 */
function resolveSessionLog(evidenceText, sessionLogPath) {
  if (!evidenceText || !sessionLogPath) return null;
  if (!fs.existsSync(sessionLogPath)) return null;
  let raw;
  try { raw = fs.readFileSync(sessionLogPath, 'utf8'); }
  catch (e) { return null; }
  const needleLower = evidenceText.toLowerCase();

  // Build candidate phrases from the evidence: split on non-alphanumeric
  // then join contiguous 3+ alphanumeric runs into phrases. Match on any
  // phrase >= 10 chars that appears in the record blob. This is stricter
  // than a raw substring check (avoids single-word false positives) but
  // tolerant of prose wrapping around a real tool-output fragment.
  const phrases = [];
  for (const phrase of needleLower.split(/[^\w ]+/)) {
    const trimmed = phrase.trim();
    if (trimmed.length >= 10) phrases.push(trimmed);
  }
  if (phrases.length === 0) return null;

  const lines = raw.split('\n').filter(Boolean);
  for (let i = lines.length - 1; i >= 0; i--) {
    let record;
    try { record = JSON.parse(lines[i]); } catch (e) { continue; }
    const blob = JSON.stringify({ tool: record.tool, input: record.input, response: record.response }).toLowerCase();
    for (const phrase of phrases) {
      if (blob.includes(phrase)) return record;
    }
  }
  return null;
}

/**
 * Validate an Evidence cell against session artifacts. Returns a structured
 * result with the signals found and a valid/invalid verdict.
 *
 * @param {string} evidenceText
 * @param {{ projectRoot?: string, sessionLogPath?: string, enforcerDir?: string }} context
 * @returns {{ valid: boolean, signals: Array<{type: string, value: string, resolution: string}>, warnings: string[] }}
 */
function validateEvidence(evidenceText, context) {
  context = context || {};
  const projectRoot = context.projectRoot || null;
  const sessionLogPath = context.sessionLogPath
    || (context.enforcerDir ? path.join(context.enforcerDir, '.session-log.jsonl') : null);

  const signals = [];
  const warnings = [];

  if (!evidenceText || !evidenceText.trim()) {
    return { valid: false, signals, warnings: ['Evidence cell is empty'] };
  }

  const text = evidenceText;

  // 1. Commit SHAs
  const commitHits = text.match(COMMIT_RE) || [];
  for (const hit of new Set(commitHits)) {
    const resolved = resolveCommit(hit, projectRoot);
    if (resolved) {
      signals.push({ type: 'commit', value: hit, resolution: resolved });
    }
  }

  // 2. File paths
  const fileHits = [];
  let m;
  while ((m = FILE_CANDIDATE_RE.exec(text)) !== null) fileHits.push(m[1]);
  for (const hit of new Set(fileHits)) {
    if (/\b(https?|ftp):/.test(hit)) continue;
    const resolved = resolveFile(hit, projectRoot);
    if (resolved) {
      signals.push({ type: 'file', value: hit, resolution: resolved });
    }
  }

  // 3. Test names
  const testHits = [];
  while ((m = TEST_NAME_RE.exec(text)) !== null) testHits.push(m[1]);
  for (const hit of new Set(testHits)) {
    const resolved = resolveTestName(hit, projectRoot);
    if (resolved) {
      signals.push({ type: 'test', value: hit, resolution: resolved });
    }
  }

  // 4. Session-log tool matches (catches "tests pass", "curl 200 OK")
  const sessionMatch = resolveSessionLog(text, sessionLogPath);
  if (sessionMatch) {
    signals.push({
      type: 'tool',
      value: sessionMatch.tool,
      resolution: `session-log @ ${sessionMatch.ts}`
    });
  }

  if (signals.length === 0) {
    warnings.push('No structural signal in evidence could be resolved. Cite a commit SHA, a real file path, a test name in quotes, or run a verifying tool in this session before claiming verified.');
  }

  return { valid: signals.length > 0, signals, warnings };
}

module.exports = {
  COMMIT_RE,
  FILE_CANDIDATE_RE,
  TEST_NAME_RE,
  TOOL_HINT_RE,
  resolveCommit,
  resolveFile,
  resolveSessionLog,
  resolveTestName,
  validateEvidence
};
