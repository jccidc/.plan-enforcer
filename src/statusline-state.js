const fs = require('fs');
const path = require('path');
const { parseTaskRows } = require('./ledger-parser');

const STATUSLINE_STATE_FILE = 'statusline-state.json';
const DISCUSS_PACKET = 'discuss.md';
const LEGACY_DISCUSS_PACKET = 'combobulate.md';

function resolveProjectRoot(startDir = process.cwd()) {
  let current = path.resolve(startDir);
  const rootPath = path.parse(current).root;
  let firstProjectRoot = null;

  while (current && current !== rootPath) {
    if (fs.existsSync(path.join(current, '.plan-enforcer'))) {
      return current;
    }
    if (!firstProjectRoot && (
      fs.existsSync(path.join(current, '.git')) ||
      fs.existsSync(path.join(current, 'package.json'))
    )) {
      firstProjectRoot = current;
    }
    const parent = path.dirname(current);
    if (parent === current) break;
    current = parent;
  }

  return firstProjectRoot || path.resolve(startDir);
}

function resolveStatuslinePaths(opts = {}) {
  const cwd = path.resolve(opts.cwd || process.cwd());
  const projectRoot = resolveProjectRoot(cwd);
  const enforcerDir = path.join(projectRoot, '.plan-enforcer');
  return {
    cwd,
    projectRoot,
    enforcerDir,
    statePath: path.join(enforcerDir, STATUSLINE_STATE_FILE),
    ledgerPath: path.join(enforcerDir, 'ledger.md'),
    discussPath: path.join(enforcerDir, DISCUSS_PACKET),
    legacyDiscussPath: path.join(enforcerDir, LEGACY_DISCUSS_PACKET)
  };
}

function readStatuslineState(opts = {}) {
  const paths = resolveStatuslinePaths(opts);
  if (!fs.existsSync(paths.statePath)) return null;
  try {
    return JSON.parse(fs.readFileSync(paths.statePath, 'utf8'));
  } catch (_error) {
    return null;
  }
}

function writeStatuslineState(nextState, opts = {}) {
  const paths = resolveStatuslinePaths(opts);
  fs.mkdirSync(paths.enforcerDir, { recursive: true });
  const previous = readStatuslineState(paths) || {};
  const merged = {
    ...previous,
    ...nextState,
    projectRoot: paths.projectRoot.replace(/\\/g, '/'),
    updatedAt: new Date().toISOString()
  };
  fs.writeFileSync(paths.statePath, JSON.stringify(merged, null, 2) + '\n', 'utf8');
  return { ...paths, state: merged };
}

function clearStatuslineState(opts = {}) {
  const paths = resolveStatuslinePaths(opts);
  try {
    fs.unlinkSync(paths.statePath);
  } catch (_error) {}
}

function buildTaskStatuslineState(ledger) {
  const rows = parseTaskRows(ledger);
  const total = rows.length;
  const completed = rows.filter((row) => (
    row.status === 'done' ||
    row.status === 'verified' ||
    row.status === 'skipped' ||
    row.status === 'superseded'
  )).length;
  const nextRow = rows.find((row) => row.status === 'in-progress' || row.status === 'pending') || null;
  return {
    stage: 'tasks',
    label: `${completed}/${total}`,
    done: completed,
    total,
    taskId: nextRow ? nextRow.id : null,
    taskName: nextRow ? nextRow.name : null,
    taskStatus: nextRow ? nextRow.status : null
  };
}

function writeTaskStatuslineState(ledger, opts = {}) {
  return writeStatuslineState(buildTaskStatuslineState(ledger), opts);
}

function writeNamedStatuslineStage(stage, opts = {}) {
  return writeStatuslineState({
    stage,
    label: opts.label || String(stage || '').toUpperCase(),
    title: opts.title || null,
    source: opts.source || null,
    taskId: opts.taskId || null,
    taskName: opts.taskName || null,
    taskStatus: opts.taskStatus || null,
    done: Number.isFinite(opts.done) ? opts.done : null,
    total: Number.isFinite(opts.total) ? opts.total : null
  }, opts);
}

function hasDiscussPacket(opts = {}) {
  const paths = resolveStatuslinePaths(opts);
  return fs.existsSync(paths.discussPath) || fs.existsSync(paths.legacyDiscussPath);
}

function inferStatuslineState(opts = {}) {
  const paths = resolveStatuslinePaths(opts);
  if (fs.existsSync(paths.ledgerPath)) {
    try {
      return buildTaskStatuslineState(fs.readFileSync(paths.ledgerPath, 'utf8'));
    } catch (_error) {}
  }
  const explicit = readStatuslineState(paths);
  if (explicit && explicit.stage && explicit.label) return explicit;
  if (hasDiscussPacket(paths)) {
    return { stage: 'discuss', label: '1-DISCUSS' };
  }
  return null;
}

module.exports = {
  DISCUSS_PACKET,
  LEGACY_DISCUSS_PACKET,
  STATUSLINE_STATE_FILE,
  buildTaskStatuslineState,
  clearStatuslineState,
  hasDiscussPacket,
  inferStatuslineState,
  readStatuslineState,
  resolveProjectRoot,
  resolveStatuslinePaths,
  writeNamedStatuslineStage,
  writeStatuslineState,
  writeTaskStatuslineState
};
