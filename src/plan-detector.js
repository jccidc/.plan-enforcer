// Plan Enforcer — Plan Detector
// Scans project directories for plan files and extracts tasks from them.

const fs = require('fs');
const path = require('path');

/**
 * List files in a directory, returning [] on error.
 * @param {string} dir
 * @returns {string[]}
 */
function scanDir(dir) {
  try { return fs.readdirSync(dir); } catch (e) { return []; }
}

/**
 * Remove fenced code blocks so task extraction ignores examples/snippets.
 * @param {string} content
 * @returns {string}
 */
function stripFencedCodeBlocks(content) {
  return content.replace(/```[\s\S]*?```/g, '');
}

function normalizeAwarenessRef(ref) {
  const value = String(ref || '').trim().toUpperCase();
  return /^(I\d+|R\d+)$/.test(value) ? value : '';
}

function extractInlineAwarenessRefs(text) {
  const refs = [];
  const input = String(text || '');
  for (const match of input.matchAll(/A:\s*(I\d+|R\d+)((?:\s*,\s*(?:I\d+|R\d+))*)/gi)) {
    refs.push(normalizeAwarenessRef(match[1]));
    const rest = String(match[2] || '')
      .split(',')
      .map((value) => normalizeAwarenessRef(value))
      .filter(Boolean);
    refs.push(...rest);
  }
  return Array.from(new Set(refs.filter(Boolean)));
}

function stripInlineAwarenessRefs(text) {
  let stripped = String(text || '');
  stripped = stripped.replace(/\[\s*A:\s*(?:I\d+|R\d+)(?:\s*,\s*(?:I\d+|R\d+))*\s*\]/gi, ' ');
  stripped = stripped.replace(/\(\s*A:\s*(?:I\d+|R\d+)(?:\s*,\s*(?:I\d+|R\d+))*\s*\)/gi, ' ');
  stripped = stripped.replace(/\s*A:\s*(?:I\d+|R\d+)(?:\s*,\s*(?:I\d+|R\d+))*/gi, ' ');
  stripped = stripped.replace(/\s{2,}/g, ' ').trim();
  stripped = stripped.replace(/\s+([:.)\]])/g, '$1');
  return stripped.trim();
}

function normalizeTaskEntry(task) {
  const rawName = typeof task === 'string'
    ? task
    : (task && (task.name || task.task || task.title)) || '';
  const name = stripInlineAwarenessRefs(rawName);
  const refs = Array.isArray(task && task.awarenessRefs)
    ? task.awarenessRefs.map((ref) => normalizeAwarenessRef(ref)).filter(Boolean)
    : [];
  const inlineRefs = extractInlineAwarenessRefs(rawName);
  return {
    name,
    awarenessRefs: Array.from(new Set([...refs, ...inlineRefs]))
  };
}

function finalizeTaskExtraction(format, rawTasks) {
  const taskRows = rawTasks
    .map((task) => normalizeTaskEntry(task))
    .filter((task) => task.name);
  return {
    tasks: taskRows.map((task) => task.name),
    taskRows,
    format
  };
}

/**
 * Check whether markdown content looks like a structured implementation plan.
 * @param {string} content
 * @returns {boolean}
 */
function isPlanContent(content) {
  const normalized = stripFencedCodeBlocks(content);
  const result = extractTasksFromContent(normalized);
  if (result.format === 'unknown') return false;
  if (result.format === 'numbered') return false;
  return true;
}

// Find a plan file in the given project root.
// Checks: PLAN.md, docs/plans/*.md, docs/PLAN.md, .planning/*/PLAN.md
// Returns relative path to plan file, or null.
function findPlanFile(projectRoot) {
  const candidates = [];

  for (const f of ['PLAN.md', 'plan.md']) {
    if (fs.existsSync(path.join(projectRoot, f))) candidates.push(f);
  }

  const plansDir = path.join(projectRoot, 'docs', 'plans');
  for (const f of scanDir(plansDir)) {
    if (f.endsWith('.md')) candidates.push(path.join('docs', 'plans', f));
  }

  if (fs.existsSync(path.join(projectRoot, 'docs', 'PLAN.md'))) {
    candidates.push('docs/PLAN.md');
  }

  const planningDir = path.join(projectRoot, '.planning');
  for (const phase of scanDir(planningDir)) {
    const planPath = path.join('.planning', phase, 'PLAN.md');
    if (fs.existsSync(path.join(projectRoot, planPath))) candidates.push(planPath);
  }

  for (const f of candidates) {
    try {
      const content = fs.readFileSync(path.join(projectRoot, f), 'utf8').slice(0, 2000);
      if (isPlanContent(content)) {
        return f;
      }
    } catch (e) {}
  }

  return null;
}

// Extract tasks from a plan file. Tries 5 formats in order.
function extractTasks(filePath) {
  const content = fs.readFileSync(filePath, 'utf8');
  return extractTasksFromContent(content);
}

// Extract the Must-Haves section from a plan. Looks for `## Must-Haves`
// or `## Must Haves` headers (case-insensitive) and collects each bulleted
// item underneath until the next `##` header.
//
// Returns array of strings, one per must-have. Empty when no section.
function extractMustHaveRows(content) {
  if (!content) return [];
  const lines = content.split(/\r?\n/);
  const items = [];
  let inSection = false;
  for (const line of lines) {
    if (/^##\s+Must[\s-]?Haves?\s*$/i.test(line)) {
      inSection = true;
      continue;
    }
    if (inSection && /^#{2,}\s/.test(line)) break;
    if (!inSection) continue;
    const bullet = line.match(/^\s*[-*]\s*(?:\[[ x]\]\s*)?(.+?)\s*$/);
    if (!bullet || !bullet[1]) continue;
    let body = bullet[1].trim();
    body = body.replace(/^\*\*(.*)\*\*$/, '$1').trim();
    if (!body) continue;

    const tagMatch = body.match(/^(MH\d+)\s*[:.)-]?\s*(.*)$/i);
    const tag = tagMatch ? tagMatch[1].toUpperCase() : `MH${items.length + 1}`;
    const rawText = tagMatch ? tagMatch[2] : body;
    const awarenessRefs = extractInlineAwarenessRefs(rawText);
    const text = stripInlineAwarenessRefs(rawText);
    if (!text) continue;
    items.push({ tag, text, awarenessRefs });
  }
  return items;
}

function extractMustHaves(content) {
  return extractMustHaveRows(content).map((row) => row.text);
}

// Extract tasks from plan content string. Tries 5 formats in order.
function extractTasksFromContent(content) {
  const normalized = stripFencedCodeBlocks(content);
  const tasks = [];

  // Format 1: Superpowers (### Task N:)
  for (const m of normalized.matchAll(/^### Task [^\n:]*:\s*(.+)$/gm)) tasks.push(m[1].trim());
  if (tasks.length > 0) return finalizeTaskExtraction('superpowers', tasks);

  // Format 2: GSD (## Task)
  for (const m of normalized.matchAll(/^## Task[^:\n]*:\s*(.+)$/gm)) tasks.push(m[1].trim());
  if (tasks.length > 0) return finalizeTaskExtraction('gsd', tasks);

  // Format 3: Checklists
  for (const m of normalized.matchAll(/^- \[[ x]\]\s*(.+)/gm)) tasks.push(m[1].trim());
  if (tasks.length > 0) return finalizeTaskExtraction('checklist', tasks);

  // Format 4: Numbered
  for (const m of normalized.matchAll(/^\d+\.\s+(.+)/gm)) tasks.push(m[1].trim());
  if (tasks.length > 0) return finalizeTaskExtraction('numbered', tasks);

  // Format 5: Headers
  for (const m of normalized.matchAll(/^#{2,3}\s+(Step|Phase|Task|Part)\s+\d+[.:]*\s*(.*)/gim)) {
    tasks.push(m[0].replace(/^#+\s*/, '').trim());
  }
  if (tasks.length > 0) return finalizeTaskExtraction('headers', tasks);

  return { tasks: [], taskRows: [], format: 'unknown' };
}

/**
 * Generate a new ledger from extracted tasks.
 * @param {string} planPath
 * @param {string[]} tasks
 * @param {string} tier
 * @param {Date} [now]
 * @returns {string}
 */
function generateLedger(planPath, tasks, tier, now) {
  const timestamp = (now || new Date()).toISOString().replace(/\.\d+Z$/, 'Z');
  const taskRows = (tasks || [])
    .map((task) => normalizeTaskEntry(task))
    .filter((task) => task.name);
  const count = taskRows.length;

  // v2 task rows: | ID | Task | Status | Evidence | Chain | Notes |
  // Chain cell is blank at creation; populated as agents log decisions
  // and commits against the task.
  let rows = '';
  taskRows.forEach((task, i) => {
    const id = `T${i + 1}`;
    const padId = id.padEnd(3);
    const padName = task.name.substring(0, 40).padEnd(40);
    const chain = task.awarenessRefs.map((ref) => `A:${ref}`).join(', ');
    rows += `| ${padId} | ${padName} | pending |          | ${chain.padEnd(5)} |       |\n`;
  });

  return `# Plan Enforcer Ledger
<!-- schema: v2 -->
<!-- source: ${planPath} -->
<!-- tier: ${tier} -->
<!-- created: ${timestamp} -->

## Scoreboard
 ${count} total  |  0 done  |  0 verified  |  0 skipped  |  0 blocked  |  ${count} remaining
 Drift: 0  |  Last reconcile: none  |  Tier: ${tier}

## Task Ledger

| ID  | Task                                     | Status  | Evidence | Chain | Notes |
|-----|------------------------------------------|---------|----------|-------|-------|
${rows}
## Decision Log

| ID | Type      | Scope | Reason | Evidence |
|----|-----------|-------|--------|----------|

## Reconciliation History

| Round | Tasks Checked | Gaps Found | Action Taken |
|-------|---------------|------------|--------------|
`;
}

module.exports = {
  extractInlineAwarenessRefs,
  extractMustHaveRows,
  extractMustHaves,
  extractTasks,
  extractTasksFromContent,
  findPlanFile,
  generateLedger,
  isPlanContent,
  normalizeTaskEntry,
  scanDir,
  stripFencedCodeBlocks,
  stripInlineAwarenessRefs
};
