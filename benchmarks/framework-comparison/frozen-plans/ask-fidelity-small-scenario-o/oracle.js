#!/usr/bin/env node
const fs = require('fs');
const path = require('path');

function parseArgs(argv) {
  const args = {};
  for (let i = 0; i < argv.length; i += 1) {
    if (argv[i] === '--artifacts') args.artifacts = argv[++i];
  }
  return args;
}

function walk(root) {
  const out = [];
  if (!fs.existsSync(root)) return out;
  const stack = [root];
  while (stack.length > 0) {
    const current = stack.pop();
    for (const entry of fs.readdirSync(current, { withFileTypes: true })) {
      const full = path.join(current, entry.name);
      if (entry.isDirectory()) stack.push(full);
      else out.push(full);
    }
  }
  return out;
}

function read(filePath) {
  return fs.existsSync(filePath) ? fs.readFileSync(filePath, 'utf8') : '';
}

function normalize(text) {
  return String(text || '')
    .toLowerCase()
    .replace(/\r/g, '')
    .trim();
}

function collectFiles(root) {
  const files = new Map();
  for (const filePath of walk(root)) {
    const rel = path.relative(root, filePath).replace(/\\/g, '/');
    files.set(rel, read(filePath));
  }
  return files;
}

function isHarnessPlanArtifact(rel) {
  return rel === 'docs/plans/shared-execution-plan.md' || /^docs\/plans\/phase-\d+\.md$/.test(rel);
}

function main() {
  const args = parseArgs(process.argv.slice(2));
  if (!args.artifacts || !fs.existsSync(args.artifacts)) {
    process.stderr.write('missing --artifacts path');
    process.exit(2);
  }

  const fixtureRoot = path.join(__dirname, 'fixture-repo');
  const baseline = collectFiles(fixtureRoot);
  const shipped = collectFiles(args.artifacts);
  const findings = [];

  const activePath = 'docs/strategy/product-roadmap.md';
  const archivePath = 'docs/archive/product-roadmap-2026-04-15.md';
  const proofPath = 'docs/strategy/roadmap-regression-proof.md';
  const testPath = 'tests/roadmap-regression.test.js';

  const active = normalize(shipped.get(activePath));
  const archive = shipped.get(archivePath) || '';
  const baselineArchive = baseline.get(archivePath) || '';
  const proof = normalize(shipped.get(proofPath));
  const test = normalize(shipped.get(testPath));

  if (!active.includes('roadmap-regression guard') && !active.includes('roadmap regression guard')) {
    findings.push({ kind: 'oracle_fail', severity: 'high', summary: 'active roadmap does not include roadmap-regression guard item' });
  }
  if (!active.includes('carryover moat is the primary wedge')) {
    findings.push({ kind: 'oracle_fail', severity: 'high', summary: 'active roadmap lost carryover-moat positioning' });
  }
  if (!active.includes('executed verification')) {
    findings.push({ kind: 'oracle_fail', severity: 'high', summary: 'active roadmap lost executed-verification direction' });
  }

  const stalePhrases = [
    'win planning quality first',
    'planning quality is the whole story',
    'benchmarks matter more than closure truth',
    'maybe revisit execution later',
    'maybe add audit after launch'
  ];
  for (const phrase of stalePhrases) {
    if (active.includes(phrase)) {
      findings.push({ kind: 'oracle_fail', severity: 'high', summary: `active roadmap still contains stale phrase: ${phrase}` });
    }
  }

  if (archive !== baselineArchive) {
    findings.push({ kind: 'oracle_fail', severity: 'high', summary: 'archived roadmap changed from baseline' });
  }

  const hasNarrowScopeLanguage = proof.includes('diff') || proof.includes('narrow') || proof.includes('untouched');
  if (!proof.includes('archive') || !proof.includes('stale') || !hasNarrowScopeLanguage) {
    findings.push({ kind: 'oracle_fail', severity: 'high', summary: 'proof note does not clearly explain archive/stale/narrow-scope contract' });
  }
  if (!test.includes('roadmap') || !test.includes('regression') || !test.includes('planning quality is the whole story')) {
    findings.push({ kind: 'oracle_fail', severity: 'high', summary: 'roadmap regression test is missing or too weak' });
  }

  const allowedChanged = new Set([activePath, proofPath, testPath]);
  for (const [rel, text] of shipped.entries()) {
    const before = baseline.get(rel);
    if (before === undefined) {
      if (isHarnessPlanArtifact(rel)) {
        continue;
      }
      if (!allowedChanged.has(rel)) {
        findings.push({ kind: 'oracle_fail', severity: 'high', summary: `unexpected new file outside narrow scope: ${rel}` });
      }
      continue;
    }
    if (text !== before && !allowedChanged.has(rel)) {
      findings.push({ kind: 'oracle_fail', severity: 'high', summary: `unexpected changed file outside narrow scope: ${rel}` });
    }
  }

  for (const rel of baseline.keys()) {
    if (!shipped.has(rel)) {
      findings.push({ kind: 'oracle_fail', severity: 'high', summary: `baseline file missing from shipped artifacts: ${rel}` });
    }
  }

  process.stdout.write(JSON.stringify({ pass: findings.length === 0, findings }));
}

main();
