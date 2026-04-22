// Plan Enforcer — Placeholder Scanner
// Flags the phrases listed in the plan-enforcer-draft anti-
// rationalization table against arbitrary plan text. Pure — takes a
// string, returns findings. Callers layer CLI / review output.
//
// Skips fenced code blocks and the YAML frontmatter block so worked
// examples and metadata don't false-positive.

const PATTERNS = [
  {
    code: 'UNRESOLVED_MARKER',
    re: /\b(TBD|TODO|FIXME|XXX)\b/i,
    message: 'Unresolved marker in plan text',
    suggestion: 'Resolve the decision now (cite the option and why) or hoist to a Decision Log pivot row. Do not ship unknowns embedded in the plan.'
  },
  {
    code: 'GENERIC_ERROR_HANDLING',
    re: /\b(add|handle)\s+(error\s+handling|errors?)\b/i,
    message: '"Add/handle error handling" without enumeration',
    suggestion: 'Name the failure modes (e.g. handle ECONNREFUSED with 3x exponential backoff, surface as 503 to caller).'
  },
  {
    code: 'SIMILAR_TO_TASK',
    re: /\bsimilar to (task|step)\s+\w+/i,
    message: '"Similar to Task N" forces the reader to guess which details transferred',
    suggestion: 'Copy the actual steps. No "similar" references.'
  },
  {
    code: 'VAGUE_CLEANUP',
    re: /\b(clean\s*-?\s*up|cleanup|refactor|tidy|improve|polish)\b/i,
    message: 'Generic cleanup / refactor / improve without a concrete end state',
    suggestion: 'Name the concrete outcome (e.g. extract auth-middleware.js; update 3 call sites in src/routes/*.js).'
  },
  {
    code: 'UNQUANTIFIED_PERF',
    re: /\b(make\s+(it|them|this)?\s*(faster|quicker|snappier)|optimi[sz]e\s+[a-z])/i,
    message: 'Performance goal without a measurement',
    suggestion: 'Cite target and load (e.g. reduce p95 /api/search latency from 420ms to <150ms under 50 rps).'
  },
  {
    code: 'UNLISTED_EDGE_CASES',
    re: /\b(handle|cover|address)\s+edge\s*-?\s*cases?\b/i,
    message: '"Edge cases" without enumeration',
    suggestion: 'List each case as its own sub-step (e.g. empty string, >10k chars, UTF-8 surrogates).'
  },
  {
    code: 'OPTIONAL_HEDGE',
    re: /\b(if\s+needed|as\s+appropriate|where\s+relevant|if\s+applicable)\b/i,
    message: 'Optional hedge ("if needed" / "as appropriate") lets tasks silently disappear',
    suggestion: 'Include or exclude the work explicitly. No conditionals in the plan shape.'
  },
  {
    code: 'VERIFY_WITHOUT_METHOD',
    // Only flag the vague forms: "ensure it works", "verify this is
    // correct", "make sure everything passes". Real verification
    // phrases with concrete objects ("verify targeted test passes",
    // "verify curl returns 200") do not match because the subject is
    // specific, not a pronoun.
    re: /\b(ensure|verify|confirm|make\s+sure)\s+(it|that|this|everything|things|the\s+(thing|feature|code|system))\s+(works?|is\s+correct|succeeds?|passes?)\b/i,
    message: '"Ensure it works" without a named verification method',
    suggestion: 'Name the verification (test file, CLI command, commit SHA, or manual check with expected output).'
  },
  {
    code: 'ADVERB_DECORATION',
    re: /\b(thoroughly|comprehensively|robustly|properly|fully)\b/i,
    message: 'Adverb decoration without concrete bound',
    suggestion: 'Delete the adverb or replace with a measurable constraint.'
  },
  {
    code: 'OPEN_ENDED_LIST',
    re: /(\betc\b\.?|\band\s+so\s+on\b|\.\.\.\s*(?:$|[^-\d]))/i,
    message: '"Etc" / "and so on" / "..." open-ended list',
    suggestion: 'List every case or remove the open-endedness. Every "etc" is a task the executor will silently drop.'
  }
];

/**
 * Scan text for placeholder patterns.
 *
 * @param {string} text - plan markdown
 * @param {object} [opts]
 * @param {boolean} [opts.skipFences=true] - ignore ``` fenced blocks
 * @param {boolean} [opts.skipFrontmatter=true] - ignore leading --- YAML block
 * @returns {Array<{ line: number, col: number, match: string, code: string, message: string, suggestion: string }>}
 */
function scanPlaceholders(text, opts) {
  opts = opts || {};
  const skipFences = opts.skipFences !== false;
  const skipFrontmatter = opts.skipFrontmatter !== false;

  const lines = (text || '').split(/\r?\n/);
  const skipMask = new Array(lines.length).fill(false);

  if (skipFrontmatter && lines.length > 0 && lines[0].trim() === '---') {
    for (let i = 1; i < lines.length; i++) {
      skipMask[i] = true;
      if (lines[i].trim() === '---') { skipMask[i] = true; break; }
    }
    skipMask[0] = true;
  }

  if (skipFences) {
    let inFence = false;
    for (let i = 0; i < lines.length; i++) {
      if (/^\s*```/.test(lines[i])) {
        skipMask[i] = true;
        inFence = !inFence;
        continue;
      }
      if (inFence) skipMask[i] = true;
    }
  }

  // Only scan lines that look like executable plan content: task
  // titles (`### Task N:`), checklist items (`- [ ]` / `- [x]`),
  // bullet lists (`- ` / `* `), or numbered lists. Plan-header text
  // like "**Out of scope:** docs cleanup" is metadata — it should not
  // trigger. `opts.executableOnly` defaults true; pass false to scan
  // every line.
  const executableOnly = opts.executableOnly !== false;
  const EXEC_RE = /^\s*(?:###?\s+Task\s|-\s\[[ xX]\]|[-*]\s|\d+\.\s)/;

  // VERIFY_VAGUE: catch "verify <noun> works/passes" where the line
  // has no concrete evidence token (test file name, curl, node --test,
  // assert, expect, commit SHA, quoted expected output). Complements
  // VERIFY_WITHOUT_METHOD which only catches pronoun subjects.
  // Verb + 1-4 word noun phrase + weak verb ("works/passes/succeeds/
  // is correct"). Widens beyond the pronoun-subject case that
  // VERIFY_WITHOUT_METHOD catches — "Verify the new flow works" hits
  // here. Evidence-token check below overrides on lines that cite a
  // concrete artifact.
  const VERIFY_VAGUE_RE = /\b(verify|ensure|confirm|make\s+sure)\s+(?:\S+\s+){1,4}(works?|passes?|succeeds?|is\s+correct)\b/i;
  const EVIDENCE_TOKEN_RE = /\b(test|spec|curl|node\s+--test|jest|mocha|pytest|assert|expect|commit|sha|returns?\s+\d|status\s*[:=]\s*\d|\.\w+\(|["'`][^"'`]{3,}["'`])/i;

  const findings = [];
  for (let i = 0; i < lines.length; i++) {
    if (skipMask[i]) continue;
    const line = lines[i];
    if (executableOnly && !EXEC_RE.test(line)) continue;
    for (const pat of PATTERNS) {
      const m = line.match(pat.re);
      if (m) {
        findings.push({
          line: i + 1,
          col: (m.index || 0) + 1,
          match: m[0],
          code: pat.code,
          message: pat.message,
          suggestion: pat.suggestion
        });
      }
    }
    // Second pass: the widening case. Only report VERIFY_VAGUE when
    // the line genuinely lacks evidence tokens AND the existing
    // VERIFY_WITHOUT_METHOD didn't already cover it (pronoun subjects
    // are caught above).
    const vagueMatch = line.match(VERIFY_VAGUE_RE);
    if (vagueMatch && !EVIDENCE_TOKEN_RE.test(line)) {
      const alreadyCaught = findings.some(
        (f) => f.line === i + 1 && f.code === 'VERIFY_WITHOUT_METHOD'
      );
      if (!alreadyCaught) {
        findings.push({
          line: i + 1,
          col: (vagueMatch.index || 0) + 1,
          match: vagueMatch[0],
          code: 'VERIFY_VAGUE',
          message: '"Verify <noun> works" with no evidence token on the line',
          suggestion: 'Add a concrete artifact the verification checks against — test file, command, commit SHA, curl, or expected output string.'
        });
      }
    }
  }
  return findings;
}

module.exports = { scanPlaceholders, PATTERNS };
