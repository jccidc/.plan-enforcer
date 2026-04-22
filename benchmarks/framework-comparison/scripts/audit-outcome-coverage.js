#!/usr/bin/env node

const fs = require('fs');
const path = require('path');
const { readOutcome, readLegacyOutcome } = require('./extract-outcome');

const RESULTS_ROOT = path.resolve(
  process.cwd(),
  process.argv[2] || 'benchmarks/framework-comparison/results'
);
const STALE_CUTOFF = Date.parse('2026-04-13T00:00:00Z');
const SIZE_ORDER = ['small', 'medium', 'large', 'calculator'];

function isDir(p) {
  try {
    return fs.statSync(p).isDirectory();
  } catch {
    return false;
  }
}

function isFile(p) {
  try {
    return fs.statSync(p).isFile();
  } catch {
    return false;
  }
}

function safeReadJson(p) {
  try {
    return JSON.parse(fs.readFileSync(p, 'utf8'));
  } catch {
    return null;
  }
}

function listCells(rootDir) {
  const cells = [];
  for (const size of fs.existsSync(rootDir) ? fs.readdirSync(rootDir) : []) {
    const sizeDir = path.join(rootDir, size);
    if (!isDir(sizeDir)) continue;
    for (const scenario of fs.readdirSync(sizeDir)) {
      const scenarioDir = path.join(sizeDir, scenario);
      if (!isDir(scenarioDir)) continue;
      for (const system of fs.readdirSync(scenarioDir)) {
        const cellDir = path.join(scenarioDir, system);
        if (!isDir(cellDir)) continue;
        cells.push({ size, scenario, system, cellDir });
      }
    }
  }
  return cells.sort(compareCells);
}

function compareCells(a, b) {
  const sizeCmp = orderIndex(a.size) - orderIndex(b.size);
  if (sizeCmp !== 0) return sizeCmp;
  const scenarioCmp = a.scenario.localeCompare(b.scenario);
  if (scenarioCmp !== 0) return scenarioCmp;
  return a.system.localeCompare(b.system);
}

function orderIndex(size) {
  const idx = SIZE_ORDER.indexOf(size);
  return idx === -1 ? 999 : idx;
}

function inspectCell({ size, scenario, system, cellDir }) {
  const meta = safeReadJson(path.join(cellDir, 'meta.json'));
  const outcome = readOutcome(cellDir);
  const legacy = readLegacyOutcome(cellDir);
  const files = {
    prompt: isFile(path.join(cellDir, 'prompt.txt')),
    output: isFile(path.join(cellDir, 'output.txt')),
    resumed: isFile(path.join(cellDir, 'output-resumed.txt')),
    diff: isFile(path.join(cellDir, 'final.diff')),
    diffStat: isFile(path.join(cellDir, 'final-diff-stat.txt')),
    finalTree: isFile(path.join(cellDir, 'final-tree.txt')),
    scorecard: isFile(path.join(cellDir, 'scorecard.json')),
    objectives: isFile(path.join(cellDir, 'objectives.json'))
  };
  const artifactDirs = fs.readdirSync(cellDir, { withFileTypes: true })
    .filter((entry) => entry.isDirectory())
    .map((entry) => entry.name)
    .filter((name) => name === 'worktree-artifacts' || name.endsWith('-artifacts'));

  const timestamp = meta && meta.timestamp ? Date.parse(meta.timestamp) : null;
  const stale = Number.isFinite(timestamp) && timestamp < STALE_CUTOFF;
  const readyForJudge = !outcome &&
    files.prompt &&
    files.output &&
    files.diff &&
    isFile(path.join(cellDir, 'meta.json')) &&
    (
      artifactDirs.length > 0 ||
      files.finalTree
    ) &&
    (scenario !== 'crash-continuity' || files.resumed);

  const status = outcome
    ? 'outcome-present'
    : readyForJudge
      ? 'ready-for-judge'
      : 'insufficient-artifacts';

  const notes = [];
  if (stale) notes.push('stale-capture');
  if (scenario === 'crash-continuity' && !files.resumed) notes.push('missing-resume-output');
  if (!files.diff) notes.push('missing-final.diff');
  if (!files.prompt) notes.push('missing-prompt');
  if (!files.output) notes.push('missing-output');
  if (!artifactDirs.length && !files.finalTree) notes.push('missing-final-tree-or-artifacts');
  if (!outcome && legacy) notes.push(`legacy-only:${legacy.source}`);

  return {
    size,
    scenario,
    system,
    cellDir,
    status,
    stale,
    timestamp: meta && meta.timestamp ? meta.timestamp : null,
    outcomeCount: outcome ? `${outcome.verified}/${outcome.total}` : 'missing',
    legacyCount: legacy ? `${legacy.verified}/${legacy.total} (${legacy.source})` : 'missing',
    artifactDirs,
    notes
  };
}

function summarize(rows) {
  return rows.reduce((acc, row) => {
    acc.total += 1;
    acc[row.status] = (acc[row.status] || 0) + 1;
    if (row.stale) acc.stale += 1;
    return acc;
  }, { total: 0, stale: 0, 'outcome-present': 0, 'ready-for-judge': 0, 'insufficient-artifacts': 0 });
}

function render(rows) {
  const summary = summarize(rows);
  const lines = [];
  lines.push('# Outcome Coverage Audit');
  lines.push('');
  lines.push(`Generated: ${new Date().toISOString()}`);
  lines.push('');
  lines.push('## Summary');
  lines.push('');
  lines.push(`- Total cells: ${summary.total}`);
  lines.push(`- Outcome present: ${summary['outcome-present']}`);
  lines.push(`- Ready for judge from existing artifacts: ${summary['ready-for-judge']}`);
  lines.push(`- Insufficient artifacts: ${summary['insufficient-artifacts']}`);
  lines.push(`- Stale captures (timestamp before 2026-04-13): ${summary.stale}`);
  lines.push('');
  lines.push('Rule: `ready-for-judge` means no rerun needed for completion counting; strict `outcome.json` can be written from current disk artifacts.');
  lines.push('');
  lines.push('| Cell | Status | Outcome | Legacy | Timestamp | Notes |');
  lines.push('|---|---|---:|---:|---|---|');
  for (const row of rows) {
    const cell = `${row.size} / ${row.scenario} / ${row.system}`;
    const notes = row.notes.length ? row.notes.join(', ') : '';
    lines.push(`| ${cell} | ${row.status} | ${row.outcomeCount} | ${row.legacyCount} | ${row.timestamp || ''} | ${notes} |`);
  }
  return `${lines.join('\n')}\n`;
}

function main() {
  const rows = listCells(RESULTS_ROOT).map(inspectCell);
  process.stdout.write(render(rows));
}

if (require.main === module) {
  main();
}
