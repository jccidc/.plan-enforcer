#!/usr/bin/env node
const fs = require('fs');
const path = require('path');

const STOPWORDS = new Set([
  'the', 'and', 'for', 'with', 'from', 'that', 'this', 'then', 'into', 'must',
  'will', 'have', 'has', 'had', 'not', 'just', 'only', 'than', 'when', 'what',
  'where', 'while', 'does', 'doesnt', 'should', 'could', 'would', 'after',
  'before', 'through', 'make', 'makes', 'made', 'using', 'used', 'user',
  'users', 'task', 'phase', 'add', 'create', 'write', 'record', 'capture',
  'prove', 'final', 'small', 'page', 'app', 'note', 'taskboard'
]);

function parseArgs(argv) {
  const args = { json: false, write: false };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--cell-dir') args.cellDir = argv[++i];
    else if (a === '--json') args.json = true;
    else if (a === '--write') args.write = true;
    else if (a === '--help' || a === '-h') args.help = true;
  }
  return args;
}

function usage() {
  return [
    'Usage: node benchmarks/framework-comparison/scripts/judge-phased-cell.js --cell-dir <dir> [--json] [--write]',
    '',
    'Heuristic shipped-task judge for phased benchmark cells using phase plans and shipped worktree artifacts.'
  ].join('\n');
}

function isFile(filePath) {
  try {
    return fs.statSync(filePath).isFile();
  } catch {
    return false;
  }
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

function readTextSafe(filePath) {
  try {
    if (filePath.endsWith('.json')) {
      return JSON.stringify(JSON.parse(fs.readFileSync(filePath, 'utf8')), null, 2);
    }
    return fs.readFileSync(filePath, 'utf8');
  } catch {
    return '';
  }
}

function collectArtifacts(cellDir) {
  const shippedRoot = path.join(cellDir, 'worktree-artifacts');
  const root = fs.existsSync(shippedRoot) ? shippedRoot : cellDir;
  return walk(root)
    .filter((filePath) => /\.(md|txt|json|js|mjs|ts|tsx|jsx|html|css)$/i.test(filePath))
    .filter((filePath) => !/[/\\]docs[/\\]plans[/\\]/i.test(filePath))
    .map((filePath) => ({
      path: path.relative(cellDir, filePath).replace(/\\/g, '/'),
      fullPath: filePath,
      text: readTextSafe(filePath).toLowerCase()
    }));
}

function extractSectionItems(content, heading) {
  const lines = String(content || '').split(/\r?\n/);
  const items = [];
  let active = false;
  const headerRe = new RegExp(`^##\\s+${heading}\\s*$`, 'i');
  for (const line of lines) {
    if (headerRe.test(line.trim())) {
      active = true;
      continue;
    }
    if (active && /^##\s+/.test(line)) break;
    if (!active) continue;
    const bullet = line.match(/^\s*[-*]\s+(.+)$/);
    if (bullet && bullet[1].trim()) items.push(bullet[1].trim());
  }
  return items;
}

function extractTaskTitles(content) {
  const explicit = [...String(content || '').matchAll(/^###\s+Task\s+\d+:\s+(.+)$/gm)].map((m) => m[1].trim());
  if (explicit.length > 0) return explicit;

  const lines = String(content || '').split(/\r?\n/);
  const items = [];
  let active = false;
  for (const line of lines) {
    const trimmed = line.trim();
    if (/^##\s+Tasks\s*$/i.test(trimmed)) {
      active = true;
      continue;
    }
    if (active && /^##\s+/.test(trimmed)) break;
    if (!active) continue;
    const numbered = trimmed.match(/^\d+\.\s+(.+)$/);
    if (numbered && numbered[1].trim()) items.push(numbered[1].trim());
  }
  return items;
}

function extractCodeSpans(text) {
  return [...String(text || '').matchAll(/`([^`]+)`/g)].map((m) => m[1].trim());
}

function extractArtifactRefs(text) {
  return [...new Set(
    extractCodeSpans(text).flatMap((span) => (
      span.match(/\b(?:README\.md|package\.json|[\w.-]+\/[\w./-]+\.[A-Za-z0-9_-]+)\b/g) || []
    ))
  )];
}

function tokenize(text) {
  return [...new Set(
    String(text || '')
      .toLowerCase()
      .replace(/[^a-z0-9_./ -]+/g, ' ')
      .split(/\s+/)
      .map((token) => token.trim())
      .filter((token) => token.length >= 4 && !STOPWORDS.has(token))
  )];
}

function findArtifact(cellArtifacts, relPath) {
  const normalized = relPath.replace(/\\/g, '/');
  return cellArtifacts.find((artifact) => artifact.path.endsWith(normalized)) || null;
}

function scoreTask(taskTitle, outputItem, artifacts) {
  const refs = extractArtifactRefs(outputItem || '');
  const refHits = refs.map((relPath) => findArtifact(artifacts, relPath)).filter(Boolean);
  const hasExplicitRefs = refs.length > 0;

  const tokens = tokenize(`${taskTitle} ${outputItem || ''}`);
  let best = null;
  for (const artifact of artifacts) {
    const text = `${artifact.path.toLowerCase()}\n${artifact.text}`;
    const hits = tokens.filter((token) => text.includes(token));
    if (!best || hits.length > best.hits.length) {
      best = { artifact, hits };
    }
  }

  const proofHit = /\b(proof|verification|coverage|test)\b/i.test(`${taskTitle} ${outputItem || ''}`)
    ? artifacts.find((artifact) => /[/\\]test[s]?[/\\]|\.test\.[a-z]+$/i.test(artifact.path) || /\btest\b/.test(artifact.text))
    : null;
  const noteHit = /\b(note|contract|audit|deviation|doc|document)\b/i.test(`${taskTitle} ${outputItem || ''}`)
    ? artifacts.find((artifact) => /[/\\]docs[/\\].+\.md$/i.test(artifact.path))
    : null;

  const optional = /\bif needed\b/i.test(outputItem || taskTitle);
  const shipped = hasExplicitRefs
    ? refHits.length > 0
    : (
      (best && best.hits.length >= 2) ||
      Boolean(proofHit) ||
      Boolean(noteHit) ||
      (optional && artifacts.some((artifact) => /deviation/i.test(artifact.path) || /deviation/i.test(artifact.text)))
    );
  const evidence = [...new Set([
    ...refHits.map((artifact) => artifact.path),
    ...(!hasExplicitRefs && best && best.hits.length >= 2 ? [best.artifact.path] : []),
    ...(!hasExplicitRefs && proofHit ? [proofHit.path] : []),
    ...(!hasExplicitRefs && noteHit ? [noteHit.path] : [])
  ])];

  return {
    shipped,
    evidence,
    refs
  };
}

function listPhaseDirs(cellDir) {
  return fs.readdirSync(cellDir, { withFileTypes: true })
    .filter((entry) => entry.isDirectory() && /^phase-\d+$/i.test(entry.name))
    .map((entry) => path.join(cellDir, entry.name))
    .sort();
}

function buildOutcome(cellDir) {
  const artifacts = collectArtifacts(cellDir);
  const phaseDirs = listPhaseDirs(cellDir);
  if (phaseDirs.length === 0) {
    throw new Error(`No phase-* directories found under ${cellDir}`);
  }

  const perTask = [];
  for (const phaseDir of phaseDirs) {
    const planPath = path.join(phaseDir, 'plan.md');
    if (!isFile(planPath)) continue;
    const plan = fs.readFileSync(planPath, 'utf8');
    const tasks = extractTaskTitles(plan);
    const outputs = extractSectionItems(plan, 'Outputs');
    for (let i = 0; i < tasks.length; i++) {
      const taskTitle = tasks[i];
      const outputItem = outputs[i] || '';
      const judged = scoreTask(taskTitle, outputItem, artifacts);
      perTask.push({
        id: `P${path.basename(phaseDir)}-T${i + 1}`,
        phase: path.basename(phaseDir),
        task: taskTitle,
        shipped: judged.shipped,
        evidence: judged.evidence.join('; '),
        judge: 'phased-artifact-judge@v0'
      });
    }
  }

  return {
    judge: 'phased-artifact-judge@v0',
    total_tasks: perTask.length,
    verified: perTask.filter((task) => task.shipped).length,
    per_task: perTask
  };
}

function writeOutcome(cellDir, outcome) {
  const outPath = path.join(cellDir, 'outcome.json');
  fs.writeFileSync(outPath, JSON.stringify(outcome, null, 2) + '\n', 'utf8');
  return outPath;
}

function main(argv) {
  const args = parseArgs(argv || process.argv.slice(2));
  if (args.help || !args.cellDir) {
    console.log(usage());
    return args.help ? 0 : 2;
  }
  const outcome = buildOutcome(args.cellDir);
  const written = args.write ? writeOutcome(args.cellDir, outcome) : null;
  if (args.json) {
    console.log(JSON.stringify(written ? { ...outcome, written } : outcome, null, 2));
  } else {
    console.log(`Phased shipped-task judge: ${outcome.verified}/${outcome.total_tasks}`);
    if (written) console.log(`Wrote: ${written}`);
  }
  return outcome.verified === outcome.total_tasks ? 0 : 1;
}

if (require.main === module) {
  process.exit(main());
}

module.exports = {
  buildOutcome,
  collectArtifacts,
  extractArtifactRefs,
  extractSectionItems,
  extractTaskTitles,
  main,
  scoreTask,
  tokenize,
  writeOutcome
};
