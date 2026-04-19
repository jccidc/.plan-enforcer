#!/usr/bin/env node

const fs = require('fs');
const path = require('path');
const { reviewPlanContent } = require('../../../src/plan-review');

function readJson(filePath) {
  return JSON.parse(fs.readFileSync(filePath, 'utf8'));
}

function safeRead(filePath) {
  if (!fs.existsSync(filePath)) return '';
  return fs.readFileSync(filePath, 'utf8');
}

function findRecursiveMarkdown(rootDir, targetName) {
  if (!rootDir || !fs.existsSync(rootDir)) return [];
  const matches = [];
  const stack = [rootDir];

  while (stack.length > 0) {
    const current = stack.pop();
    const entries = fs.readdirSync(current, { withFileTypes: true });
    for (const entry of entries) {
      const fullPath = path.join(current, entry.name);
      if (entry.isDirectory()) {
        stack.push(fullPath);
      } else if (entry.isFile() && entry.name === targetName) {
        matches.push(fullPath);
      }
    }
  }

  return matches;
}

function normalize(value) {
  return String(value || '')
    .toLowerCase()
    .replace(/[`*_>#:"'()[\],.-]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function includesSignal(text, signal) {
  const normalizedText = normalize(text);
  const normalizedSignal = normalize(signal);
  if (normalizedText.includes(normalizedSignal)) return true;

  const synonyms = {
    verify: ['verification', 'test', 'proof'],
    verification: ['verify', 'test', 'proof'],
    proof: ['verify', 'verification', 'test'],
    'analyst safe preview': ['analyst preview', 'preview'],
    'stored delivery snapshot': ['stored snapshot', 'deliverysnapshot', 'delivery snapshot'],
    'response shape stable': ['response body stays byte stable', 'byte stable', 'response body stable', 'leave existing response untouched', 'unchanged response body', 'response bytes unchanged', 'compat guard', 'compatibility surface', 'frozen api', 'untouched', 'response shape byte stable', 'response shape frozen', 'response shape is frozen', 'response frozen'],
    'separate route': ['own route', 'own endpoint', 'separate endpoint', 'two new routes', 'two routes', 'routes live in', 'new file src routes replay ts', 'replay preview route', 'replay preview lives at', 'replay preview lives on its own route', 'replay preview', 'distinct route', 'distinct handler', 'distinct url'],
    'effective replay decision': ['policy overlay', 'policy decision is a separate overlay', 'effective decision', 'current replay policy decision', 'current policy block', 'current replay decision', 'currentreplaydecision'],
    'historical delivery outcome': ['historical outcome', 'delivery outcome immutable', 'immutable historical outcome', 'never rewrites historical delivery outcome'],
    'source of truth': ['canonical source', 'authoritative source', 'single source of truth', 'source-of-truth'],
    'superseded stale note': ['stale runbook', 'legacy note', 'outdated guidance', 'obsolete note', 'superseded guidance', 'superseded runbook', 'superseded note', 'superseded stale', 'superseded stale guidance', 'superseded stale file', 'stale file'],
    'contract lineage': ['semantic lineage', 'status lineage', 'lineage map', 'truth lineage', 'lineage correction', 'reconstructable lineage', 'lineage is reconstructable', 'audit trail', 'cold reviewer can reconstruct', 'lineage later'],
    'out of scope': ['non goals', 'non goal', 'scope creep'],
    'same payload building path': [
      'shared payload builder',
      'same builder',
      'same payload building function',
      'one payload building function',
      'single payload building function',
      'single payload shaping path',
      'single payload shaping function',
      'shared payload shaping path',
      'single source of replay payload shape',
      'one payload building code path',
      'share one payload building code path',
      'shared builder'
    ]
  };
  for (const synonym of synonyms[normalizedSignal] || []) {
    if (normalizedText.includes(synonym)) return true;
  }
  return false;
}

function appearsInOutOfScopeSection(text, signal) {
  const normalizedSignal = normalize(signal);
  const lines = String(text || '').split(/\r?\n/);
  let inOutOfScope = false;

  for (const rawLine of lines) {
    const line = normalize(rawLine);
    if (!line) continue;
    if (line.includes('out of scope')) {
      inOutOfScope = true;
      continue;
    }
    if (/^(task|verification|assumptions|goal|constraints|risks|stop gate)\b/.test(line)) {
      inOutOfScope = false;
    }
    if (inOutOfScope && line.includes(normalizedSignal)) {
      return true;
    }
  }
  return false;
}

function hasUnnegatedSignal(text, signal) {
  const normalizedSignal = normalize(signal);
  const lines = String(text || '').split(/\r?\n/);
  let inOutOfScope = false;

  for (const rawLine of lines) {
    const line = normalize(rawLine);
    if (!line) continue;
    if (line.includes('out of scope')) {
      inOutOfScope = true;
      continue;
    }
    if (/^(task|verification|assumptions|goal|constraints|risks|stop gate)\b/.test(line)) {
      inOutOfScope = false;
    }
    if (!line.includes(normalizedSignal)) continue;
    if (inOutOfScope) continue;
    if (
      line.includes('must not') ||
      line.includes('do not') ||
      line.includes('avoid') ||
      line.includes('forbidden') ||
      line.includes('blocklist') ||
      line.includes('archived') ||
      line.includes('snapback') ||
      line.includes('regression') ||
      line.includes('stale') ||
      line.includes('reinstating') ||
      line.includes('demoting') ||
      line.includes('guard') ||
      line.includes('snapback signature') ||
      line.includes('stale context')
    ) {
      continue;
    }
    return true;
  }
  return false;
}

function findPlanArtifact(cellDir) {
  const candidates = [
    path.join(cellDir, 'worktree-artifacts', '.plan-enforcer', 'plan.md'),
    path.join(cellDir, 'worktree-artifacts', 'PLAN.md'),
    path.join(cellDir, 'worktree-artifacts', '.planning', 'PLAN.md'),
    path.join(cellDir, 'planning', 'PLAN.md'),
    path.join(cellDir, 'worktree-artifacts', '.planning', 'milestones', 'm1-export', 'phases', '1-export-planning', 'PLAN.md'),
    path.join(cellDir, 'planning', 'milestones', 'm1-export', 'phases', '1-export-planning', 'PLAN.md')
  ];

  const docsPlansDir = path.join(cellDir, 'worktree-artifacts', 'docs', 'plans');
  if (fs.existsSync(docsPlansDir)) {
    const docsPlans = fs.readdirSync(docsPlansDir)
      .filter((name) =>
        name.endsWith('.md') &&
        name.toLowerCase() !== 'interpretation.md' &&
        !name.toLowerCase().includes('review')
      )
      .map((name) => path.join(docsPlansDir, name));
    candidates.push(...docsPlans);
  }

  candidates.push(
    ...findRecursiveMarkdown(path.join(cellDir, 'worktree-artifacts', '.planning'), 'PLAN.md'),
    ...findRecursiveMarkdown(path.join(cellDir, 'planning', '.planning'), 'PLAN.md'),
    ...findRecursiveMarkdown(path.join(cellDir, 'planning', 'phases'), 'PLAN.md')
  );

  return candidates.find((candidate) => fs.existsSync(candidate)) || null;
}

function findInterpretationArtifact(cellDir) {
  const candidates = [
    path.join(cellDir, 'worktree-artifacts', '.plan-enforcer', 'combobulate.md'),
    path.join(cellDir, 'worktree-artifacts', 'docs', 'plans', 'interpretation.md'),
    path.join(cellDir, 'worktree-artifacts', 'docs', 'planning', 'interpretation.md'),
    path.join(cellDir, 'planning', 'interpretation.md')
  ];
  return candidates.find((candidate) => fs.existsSync(candidate)) || null;
}

function findReviewArtifact(cellDir) {
  const candidates = [
    path.join(cellDir, 'worktree-artifacts', '.plan-enforcer', 'review.txt'),
    path.join(cellDir, 'worktree-artifacts', 'docs', 'plans', 'REVIEW.md'),
    path.join(cellDir, 'worktree-artifacts', 'docs', 'plans', 'seeded-replay-review.md'),
    path.join(cellDir, 'worktree-artifacts', '.planning', 'REVIEW.md'),
    path.join(cellDir, 'planning', 'REVIEW.md'),
    path.join(cellDir, 'worktree-artifacts', '.planning', 'milestones', 'm1-export', 'phases', '1-export-planning', 'REVIEW.md'),
    path.join(cellDir, 'planning', 'milestones', 'm1-export', 'phases', '1-export-planning', 'REVIEW.md'),
    path.join(cellDir, 'review.txt')
  ];
  candidates.push(
    ...findRecursiveMarkdown(path.join(cellDir, 'worktree-artifacts', '.planning'), 'REVIEW.md'),
    ...findRecursiveMarkdown(path.join(cellDir, 'planning', '.planning'), 'REVIEW.md'),
    ...findRecursiveMarkdown(path.join(cellDir, 'planning', 'phases'), 'REVIEW.md'),
    ...findRecursiveMarkdown(path.join(cellDir, 'worktree-artifacts', '.planning'), 'PLAN-CHECK.md'),
    ...findRecursiveMarkdown(path.join(cellDir, 'planning', '.planning'), 'PLAN-CHECK.md'),
    path.join(cellDir, 'output.txt')
  );
  return candidates.find((candidate) => fs.existsSync(candidate)) || null;
}

function scoreSignals(text, signals) {
  if (!signals || signals.length === 0) return { matched: [], missing: [] };
  const matched = [];
  const missing = [];
  signals.forEach((signal) => {
    if (includesSignal(text, signal)) matched.push(signal);
    else missing.push(signal);
  });
  return { matched, missing };
}

function packetReviewForPlan(planText, interpretationText) {
  if (!planText) return null;
  const packetLike = interpretationText || '';
  return reviewPlanContent(planText, { packetContent: packetLike });
}

function buildJudgment(cellDir, fixtureDir) {
  const spec = readJson(path.join(fixtureDir, 'judge-spec.json'));
  const originalAsk = safeRead(path.join(fixtureDir, 'original-ask.md'));
  const evaluatorContract = safeRead(path.join(fixtureDir, 'evaluator-contract.md'));
  const planPath = findPlanArtifact(cellDir);
  const interpretationPath = findInterpretationArtifact(cellDir);
  const reviewPath = findReviewArtifact(cellDir);
  const planText = planPath ? safeRead(planPath) : '';
  const interpretationText = interpretationPath ? safeRead(interpretationPath) : '';
  const reviewText = reviewPath ? safeRead(reviewPath) : '';

  const interpretationSignals = scoreSignals(interpretationText, spec.required_interpretation_signals || []);
  const planSignals = scoreSignals(planText, spec.required_plan_signals || []);
  const reviewSignals = scoreSignals(reviewText, spec.required_review_signals || []);
  const forbiddenHits = (spec.forbidden_narrowings || []).filter((signal) =>
    hasUnnegatedSignal(planText, signal)
  );

  const reviewReplay = packetReviewForPlan(planText, interpretationText);

  const interpretationPass = Boolean(interpretationText) && interpretationSignals.missing.length <= 1;
  const planPass = Boolean(planText) && planSignals.missing.length === 0 && forbiddenHits.length === 0;
  const reviewPass = Boolean(reviewText) && reviewSignals.missing.length === 0;
  const packetDriftWarnings = (reviewReplay?.findings || []).filter((finding) =>
    String(finding.code || '').startsWith('packet_')
  );

  const overallPass = interpretationPass && planPass && reviewPass;

  return {
    judge: 'planning-quality@v0',
    result: overallPass ? 'pass' : 'fail',
    original_ask_path: path.join(fixtureDir, 'original-ask.md'),
    evaluator_contract_path: path.join(fixtureDir, 'evaluator-contract.md'),
    interpretation: {
      path: interpretationPath,
      present: Boolean(interpretationText),
      matched: interpretationSignals.matched,
      missing: interpretationSignals.missing,
      passed: interpretationPass
    },
    plan: {
      path: planPath,
      present: Boolean(planText),
      matched: planSignals.matched,
      missing: planSignals.missing,
      forbidden_hits: forbiddenHits,
      passed: planPass
    },
    review: {
      path: reviewPath,
      present: Boolean(reviewText),
      matched: reviewSignals.matched,
      missing: reviewSignals.missing,
      passed: reviewPass
    },
    packet_drift_findings: packetDriftWarnings.map((finding) => ({
      code: finding.code,
      message: finding.message
    })),
    notes: {
      original_ask_excerpt: originalAsk.split(/\r?\n/).slice(0, 10),
      evaluator_contract_excerpt: evaluatorContract.split(/\r?\n/).slice(0, 10)
    }
  };
}

function main(argv = process.argv.slice(2)) {
  let cellDir = null;
  let fixtureDir = null;
  let write = false;
  let jsonStdout = false;

  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === '--cell-dir') cellDir = argv[++i];
    else if (arg === '--fixture-dir') fixtureDir = argv[++i];
    else if (arg === '--write') write = true;
    else if (arg === '--json') jsonStdout = true;
  }

  if (!cellDir || !fixtureDir) {
    console.error('Usage: judge-planning-quality.js --cell-dir <dir> --fixture-dir <dir> [--write] [--json]');
    process.exit(1);
  }

  const judgment = buildJudgment(path.resolve(cellDir), path.resolve(fixtureDir));
  if (write) {
    fs.writeFileSync(
      path.join(path.resolve(cellDir), 'planning-quality.json'),
      `${JSON.stringify(judgment, null, 2)}\n`,
      'utf8'
    );
  }
  if (jsonStdout || !write) {
    process.stdout.write(`${JSON.stringify(judgment, null, 2)}\n`);
  }
  process.exit(judgment.result === 'pass' ? 0 : 2);
}

if (require.main === module) {
  main();
}

module.exports = {
  buildJudgment,
  findInterpretationArtifact,
  findPlanArtifact,
  findReviewArtifact,
  scoreSignals
};
