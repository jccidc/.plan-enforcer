// Plan Enforcer — Planned Files Extractor
//
// Reads a plan markdown file and extracts the set of file paths the plan
// names. Best-effort — plans do not have a formal "planned files" schema,
// so we scan for path-like strings using extension-based heuristics.
//
// The extractor is intentionally permissive: it is better to OVER-include
// planned files (false permits) than UNDER-include (false blocks). A
// downstream chain-guard hook uses tier-aware decisions, so a missed path
// only escalates to a block at enforced tier — even there, the user can
// add a Decision Log row to override.
//
// Returns { files: Set<string>, empty: boolean } where empty=true means
// no paths could be extracted (caller should fall back to audit-only per
// the P1 design option #3).

const fs = require('fs');

// File extensions that matter for source/test/config code paths. Extend as
// needed — keeping the list explicit prevents matching arbitrary prose
// words like "done.it" or "version.1".
const CODE_EXTENSIONS = new Set([
  // JS/TS family
  'js', 'jsx', 'ts', 'tsx', 'mjs', 'cjs',
  // Common backend langs
  'py', 'rb', 'go', 'rs', 'java', 'kt', 'swift', 'c', 'cc', 'cpp', 'h', 'hpp',
  // Shell + tooling
  'sh', 'bash', 'zsh', 'ps1', 'bat', 'cmd',
  // Config + data
  'json', 'yaml', 'yml', 'toml', 'ini', 'env', 'xml',
  // Docs + plans
  'md', 'mdx', 'rst', 'txt',
  // Web
  'html', 'htm', 'css', 'scss', 'sass', 'less',
  // Tests
  'test', 'spec',
  // SQL
  'sql', 'prisma'
]);

/**
 * Decide whether a candidate string looks like a file path we care about.
 * Rules:
 *   - must contain at least one '/' OR start with a recognized filename
 *   - must end with a known code extension
 *   - must not look like a URL (http://, https://, ftp://)
 *   - must not contain spaces (paths with spaces aren't idiomatic in plans)
 * @param {string} candidate
 * @returns {boolean}
 */
function looksLikePath(candidate) {
  if (!candidate) return false;
  const s = candidate.trim();
  if (s.length === 0 || s.length > 200) return false;
  if (/^(?:https?|ftp|file):\/\//.test(s)) return false;
  if (/\s/.test(s)) return false;

  const dot = s.lastIndexOf('.');
  if (dot <= 0 || dot === s.length - 1) return false;
  const ext = s.slice(dot + 1).toLowerCase();
  if (!CODE_EXTENSIONS.has(ext)) return false;

  // Basic shape: either has a slash (path-like) OR is a bare filename at root
  if (s.includes('/')) return true;
  // Allow bare "config.json", "README.md" style
  return /^[A-Za-z0-9_.\-]+$/.test(s);
}

/**
 * Normalize a path string for consistent comparisons:
 *   - Convert backslashes to forward slashes
 *   - Strip leading "./" and leading "/"
 *   - Collapse any embedded "..//" variants is NOT performed — paths in
 *     plans are assumed to be meaningful as-written
 *
 * @param {string} p
 * @returns {string}
 */
function normalizePath(p) {
  let n = p.trim().replace(/\\/g, '/');
  if (n.startsWith('./')) n = n.slice(2);
  if (n.startsWith('/')) n = n.slice(1);
  return n;
}

/**
 * Extract path-like strings from a plan markdown string. Scans:
 *   - Backtick-wrapped inline code: `src/foo.ts`
 *   - Fenced code blocks: ```\n const p = 'src/foo.ts'\n```
 *   - Free-text path mentions: "Create src/foo.ts that..."
 *
 * Duplicates are collapsed. Returns a Set of normalized path strings.
 *
 * @param {string} content
 * @returns {Set<string>}
 */
function extractFromContent(content) {
  if (!content) return new Set();
  const found = new Set();

  // 1. Backtick inline code first — highest-confidence matches
  for (const m of content.matchAll(/`([^`\n]+)`/g)) {
    const candidate = m[1].trim();
    if (looksLikePath(candidate)) {
      found.add(normalizePath(candidate));
    }
  }

  // 2. Free-text scan — any whitespace-bounded token that looks like a path.
  // Strip fenced code blocks AND URLs first so we don't grab
  // example.com/docs/foo.md out of a URL.
  const stripped = content
    .replace(/```[\s\S]*?```/g, ' ')
    .replace(/\b(?:https?|ftp|file):\/\/\S+/gi, ' ');
  for (const m of stripped.matchAll(/[\w\-./]+/g)) {
    const candidate = m[0].trim();
    if (looksLikePath(candidate)) {
      found.add(normalizePath(candidate));
    }
  }

  return found;
}

/**
 * Extract planned files from a plan file at a given path. Returns both the
 * result set and a flag indicating whether extraction found anything.
 *
 * @param {string} planPath - absolute path to plan markdown
 * @returns {{ files: Set<string>, empty: boolean, warning?: string }}
 */
function extractFromFile(planPath) {
  if (!planPath) {
    return { files: new Set(), empty: true, warning: 'No plan path provided' };
  }
  let content;
  try {
    content = fs.readFileSync(planPath, 'utf8');
  } catch (e) {
    return { files: new Set(), empty: true, warning: `Could not read plan: ${planPath}` };
  }
  const files = extractFromContent(content);
  return { files, empty: files.size === 0 };
}

/**
 * Check whether a target file path is covered — either by the planned set
 * or by a Decision Log row whose scope matches the target. Matching is
 * done on normalized paths with a suffix rule: a planned entry "src/foo.ts"
 * covers a target "project/src/foo.ts" and vice-versa. This is deliberately
 * loose — the chain-guard's job is to catch ENTIRELY unplanned edits, not
 * to police exact-path hygiene.
 *
 * @param {string} targetPath
 * @param {Set<string>} plannedFiles
 * @param {Array<{scope: string}>} decisionRows - results of parseDecisionLog
 * @returns {boolean}
 */
function isCovered(targetPath, plannedFiles, decisionRows) {
  if (!targetPath) return true; // no target => nothing to block
  const target = normalizePath(targetPath);

  for (const planned of plannedFiles) {
    if (pathsMatch(target, planned)) return true;
  }
  // Sibling-subtree heuristic: if the plan names any file inside the
  // same directory as the target (at ≥2 segments of depth), treat the
  // target as covered too. A plan that says "add src/routes/users.ts"
  // implicitly covers siblings like "src/routes/users.test.ts". Keeps
  // chain-guard from firing on every file when a plan scaffolds a
  // directory by example.
  //
  // Only kicks in for paths with ≥2 segments (avoids "src/" covering
  // the whole tree). Guarded so fixtures / test scaffolds don't need
  // a D-row per file.
  if (isInPlannedSubtree(target, plannedFiles)) return true;
  for (const row of decisionRows || []) {
    const scope = normalizePath(row.scope || '');
    if (scope && pathsMatch(target, scope)) return true;
  }
  return false;
}

/**
 * True when `target` is a sibling or descendant of any planned file,
 * at a directory with ≥2 path segments. Intentionally narrow.
 * @param {string} target
 * @param {Set<string>} plannedFiles
 */
function isInPlannedSubtree(target, plannedFiles) {
  for (const planned of plannedFiles) {
    const parent = dirOf(planned);
    if (!parent) continue;
    const depth = parent.split('/').filter(Boolean).length;
    if (depth < 2) continue;
    if (target === parent || target.startsWith(`${parent}/`)) return true;
  }
  return false;
}

function dirOf(p) {
  const n = normalizePath(p);
  const i = n.lastIndexOf('/');
  return i < 0 ? '' : n.slice(0, i);
}

function pathsMatch(a, b) {
  if (a === b) return true;
  if (a.endsWith('/' + b)) return true;
  if (b.endsWith('/' + a)) return true;
  return false;
}

module.exports = {
  CODE_EXTENSIONS,
  dirOf,
  extractFromContent,
  extractFromFile,
  isCovered,
  isInPlannedSubtree,
  looksLikePath,
  normalizePath,
  pathsMatch
};
