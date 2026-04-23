const fs = require('fs');
const os = require('os');
const path = require('path');
const { parseMetadata, parseTaskRows, TERMINAL_STATUSES } = require('./ledger-parser');

const STATUSLINE_STATE_FILE = 'statusline-state.json';
const DISCUSS_PACKET = 'discuss.md';
const LEGACY_DISCUSS_PACKET = 'combobulate.md';
const STATUSLINE_SESSION_BRIDGE = path.join(os.tmpdir(), 'plan-enforcer-statusline-session.json');

function normalizePathForCompare(value) {
  return String(value || '').trim().replace(/\\/g, '/').replace(/\/+$/, '');
}

function resolveProjectHome() {
  try {
    return path.resolve(os.homedir());
  } catch (_error) {
    return '';
  }
}

// A directory named `.plan-enforcer` only counts as a project state dir
// when it actually holds plan-enforcer state artifacts. Prevents a repo
// folder named `.plan-enforcer` from being treated as its parent dir's
// state dir (v0.1.5 fix).
function isPlanEnforcerStateDir(dir) {
  if (!dir) return false;
  const markers = ['config.md', 'ledger.md', 'archive', 'statusline-state.json', 'discuss.md', 'combobulate.md'];
  for (const name of markers) {
    try {
      if (fs.existsSync(path.join(dir, name))) return true;
    } catch (_error) {}
  }
  return false;
}

function hasPlanEnforcerState(dir) {
  return isPlanEnforcerStateDir(path.join(dir, '.plan-enforcer'));
}

function resolveProjectRoot(startDir = process.cwd()) {
  const initial = path.resolve(startDir);
  const homePath = resolveProjectHome();
  let current = initial;
  const rootPath = path.parse(current).root;

  if (hasPlanEnforcerState(current)) {
    return current;
  }

  while (current && current !== rootPath) {
    if (current === homePath || fs.existsSync(path.join(current, '.plan-enforcer-stop'))) {
      break;
    }
    if (
      current !== initial &&
      hasPlanEnforcerState(current)
    ) {
      return current;
    }
    if (
      fs.existsSync(path.join(current, '.git')) ||
      fs.existsSync(path.join(current, 'package.json'))
    ) {
      return current;
    }
    const parent = path.dirname(current);
    if (parent === current) break;
    current = parent;
  }

  return path.resolve(startDir);
}

// Returns true when `cwd` is the same as or a descendant of `root`.
// Used to gate session-bridge preservation and bridged-path rendering:
// once the user cd's to a parent or sibling of the bridged project,
// stop rendering that project's stage (v0.1.5 fix).
function isInside(cwd, root) {
  if (!cwd || !root) return false;
  const a = normalizePathForCompare(cwd);
  const b = normalizePathForCompare(root);
  if (!a || !b) return false;
  if (a === b) return true;
  return a.startsWith(b + '/');
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
    archiveDir: path.join(enforcerDir, 'archive'),
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

function readStatuslineSessionBridge() {
  if (!fs.existsSync(STATUSLINE_SESSION_BRIDGE)) return null;
  try {
    return JSON.parse(fs.readFileSync(STATUSLINE_SESSION_BRIDGE, 'utf8'));
  } catch (_error) {
    return null;
  }
}

function inferSessionMeta(paths, opts = {}) {
  const sessionId = opts.sessionId || opts.session_id || '';
  const transcriptPath = opts.transcriptPath || opts.transcript_path || '';
  if (sessionId || transcriptPath) {
    return {
      sessionId: sessionId || null,
      transcriptPath: transcriptPath || null
    };
  }

  const bridged = readStatuslineSessionBridge();
  if (!bridged) {
    return {
      sessionId: null,
      transcriptPath: null
    };
  }

  const sameProject = normalizePathForCompare(bridged.projectRoot) === normalizePathForCompare(paths.projectRoot);
  if (!sameProject) {
    return {
      sessionId: null,
      transcriptPath: null
    };
  }

  return {
    sessionId: bridged.sessionId || null,
    transcriptPath: bridged.transcriptPath || null
  };
}

function resolveBridgedStatuslinePaths(opts = {}) {
  const sessionId = String(opts.sessionId || opts.session_id || '').trim();
  const transcriptPath = String(opts.transcriptPath || opts.transcript_path || '').trim();
  const bridged = readStatuslineSessionBridge();
  if (!bridged) return null;
  if (sessionId && bridged.sessionId && bridged.sessionId !== sessionId) return null;
  if (transcriptPath && bridged.transcriptPath && bridged.transcriptPath !== transcriptPath) return null;
  const bridgedRoot = normalizePathForCompare(bridged.projectRoot);
  if (!bridgedRoot) return null;
  // v0.1.5: only honor the bridge when cwd is inside the bridged project.
  // Once the user cd's to a parent or unrelated sibling, stop rendering
  // the bridged project's stage -- state from one project must not leak
  // into another.
  const requestedCwd = opts.cwd || opts.currentDir || '';
  if (requestedCwd && !isInside(requestedCwd, bridgedRoot)) return null;
  return resolveStatuslinePaths({ cwd: bridgedRoot });
}

function writeStatuslineState(nextState, opts = {}) {
  const paths = resolveStatuslinePaths(opts);
  fs.mkdirSync(paths.enforcerDir, { recursive: true });
  const previous = readStatuslineState(paths) || {};
  const sessionMeta = inferSessionMeta(paths, opts);
  const merged = {
    ...previous,
    ...nextState,
    projectRoot: paths.projectRoot.replace(/\\/g, '/'),
    sessionId: sessionMeta.sessionId,
    transcriptPath: sessionMeta.transcriptPath,
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
  const meta = parseMetadata(ledger);
  const rows = parseTaskRows(ledger);
  const total = rows.length;
  const completed = rows.filter((row) => (
    row.status === 'done' ||
    row.status === 'verified' ||
    row.status === 'skipped' ||
    row.status === 'superseded'
  )).length;
  const verified = rows.filter((row) => row.status === 'verified').length;
  const doneUnverified = rows.filter((row) => row.status === 'done').length;
  const nextRow = rows.find((row) => row.status === 'in-progress' || row.status === 'pending') || null;
  const prefix = meta.scope && meta.scope.shortLabel ? `${meta.scope.shortLabel} ` : '';
  return {
    stage: 'tasks',
    label: `${prefix}${completed}/${total}`,
    done: completed,
    verified,
    doneUnverified,
    total,
    scope: meta.scope || null,
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

function hasArchivedLedger(paths) {
  if (!paths || !paths.archiveDir || !fs.existsSync(paths.archiveDir)) return false;
  try {
    return fs.readdirSync(paths.archiveDir)
      .some((name) => name.endsWith('.md') && !name.endsWith('.verdict.md'));
  } catch (_error) {
    return false;
  }
}

function resolveDiscussPacketPath(paths) {
  if (fs.existsSync(paths.discussPath)) return paths.discussPath;
  if (fs.existsSync(paths.legacyDiscussPath)) return paths.legacyDiscussPath;
  return '';
}

function readDiscussPacketTitle(packetPath) {
  if (!packetPath || !fs.existsSync(packetPath)) return null;
  try {
    const raw = fs.readFileSync(packetPath, 'utf8');
    const heading = raw.match(/^#\s+(.+)$/m);
    return heading && heading[1] ? heading[1].trim() : null;
  } catch (_error) {
    return null;
  }
}

function readDiscussPacketState(opts = {}) {
  const paths = resolveStatuslinePaths(opts);
  if (hasArchivedLedger(paths)) return null;
  const packetPath = resolveDiscussPacketPath(paths);
  if (!packetPath) return null;
  return {
    stage: 'discuss',
    label: '1-DISCUSS',
    title: readDiscussPacketTitle(packetPath),
    source: 'discuss-packet'
  };
}

function captureStatuslineSessionBridge(payload = {}, opts = {}) {
  const sessionId = payload && payload.session_id ? String(payload.session_id) : '';
  if (!sessionId) return null;
  const cwd = payload && payload.workspace && payload.workspace.current_dir
    ? payload.workspace.current_dir
    : (opts.cwd || process.cwd());
  let paths = resolveStatuslinePaths({ cwd });
  const existing = readStatuslineSessionBridge();
  // v0.1.5: state-dir guard. Prior check used `.plan-enforcer` directory
  // existence alone, which mis-treated a repo named `.plan-enforcer` as a
  // runtime state dir. Now require actual state artifacts.
  const currentHasEnforcer = isPlanEnforcerStateDir(paths.enforcerDir);
  if (!currentHasEnforcer && existing && String(existing.sessionId || '') === sessionId) {
    const existingPaths = resolveStatuslinePaths({ cwd: existing.projectRoot || '' });
    // v0.1.5: only preserve the prior project's bridge when cwd is inside
    // it (e.g. user cd'd into a subdir like `src/`). If cwd is a parent
    // or unrelated sibling, the user has left that project -- drop it.
    if (
      isPlanEnforcerStateDir(existingPaths.enforcerDir) &&
      isInside(paths.cwd, existingPaths.projectRoot)
    ) {
      paths = existingPaths;
    }
  }
  const record = {
    sessionId,
    transcriptPath: payload && payload.transcript_path
      ? String(payload.transcript_path)
      : String(existing && existing.sessionId === sessionId ? (existing.transcriptPath || '') : ''),
    cwd: paths.cwd.replace(/\\/g, '/'),
    projectRoot: paths.projectRoot.replace(/\\/g, '/'),
    updatedAt: new Date().toISOString()
  };
  try {
    fs.writeFileSync(STATUSLINE_SESSION_BRIDGE, JSON.stringify(record, null, 2) + '\n', 'utf8');
    return record;
  } catch (_error) {
    return null;
  }
}

function stateMatchesSession(state, opts = {}) {
  if (!state || !state.stage || !state.label) return false;
  const expectedSessionId = opts.sessionId || opts.session_id || '';
  if (expectedSessionId && state.sessionId && state.sessionId !== expectedSessionId) {
    return false;
  }
  const expectedTranscriptPath = opts.transcriptPath || opts.transcript_path || '';
  if (expectedTranscriptPath && state.transcriptPath && state.transcriptPath !== expectedTranscriptPath) {
    return false;
  }
  return true;
}

function ledgerIsClosed(ledgerContent) {
  const rows = parseTaskRows(ledgerContent);
  const active = rows.filter((row) => row.status !== 'superseded');
  // active-empty = nothing to report (all-superseded OR truly empty table).
  // Treat both as "not a live plan" so the statusline falls through instead
  // of rendering a stale "0/0" or "N/N superseded" tag.
  if (active.length === 0) return true;
  return active.every((row) => TERMINAL_STATUSES.has(row.status));
}

function inferStatuslineState(opts = {}) {
  const paths = resolveStatuslinePaths(opts);

  // 1. Ledger on disk is authoritative -- derive stage from it, UNLESS the
  //    ledger is closed (every active row terminal). A closed ledger is not
  //    a witness for the progress tag; fall through to the authorship-stage
  //    checks below (PI2 fallthrough, v0.1.4).
  if (fs.existsSync(paths.ledgerPath)) {
    try {
      const content = fs.readFileSync(paths.ledgerPath, 'utf8');
      if (!ledgerIsClosed(content)) {
        return buildTaskStatuslineState(content);
      }
    } catch (_error) {}
  }

  // 2. No ledger: only surface a stage if a discuss packet witnesses
  //    active authorship work. statusline-state.json alone is not
  //    sufficient -- without a backing artifact, any label in that file
  //    is stale (plan closed, abandoned, or the packet was manually
  //    cleaned up but the state file was never cleared).
  const localHasDiscuss = fs.existsSync(paths.discussPath) || fs.existsSync(paths.legacyDiscussPath);
  if (localHasDiscuss) {
    const explicit = readStatuslineState(paths);
    if (stateMatchesSession(explicit, opts)) return explicit;
    const localDiscussState = readDiscussPacketState(paths);
    if (localDiscussState) return localDiscussState;
  }

  // 3. Same witness requirement applies to bridged-session paths. A closed
  //    bridged ledger falls through to the bridged-discuss check identically
  //    to the local-ledger branch above.
  const bridgedPaths = resolveBridgedStatuslinePaths(opts);
  if (bridgedPaths && normalizePathForCompare(bridgedPaths.projectRoot) !== normalizePathForCompare(paths.projectRoot)) {
    if (fs.existsSync(bridgedPaths.ledgerPath)) {
      try {
        const bridgedContent = fs.readFileSync(bridgedPaths.ledgerPath, 'utf8');
        if (!ledgerIsClosed(bridgedContent)) {
          return buildTaskStatuslineState(bridgedContent);
        }
      } catch (_error) {}
    }
    const bridgedHasDiscuss = fs.existsSync(bridgedPaths.discussPath) || fs.existsSync(bridgedPaths.legacyDiscussPath);
    if (bridgedHasDiscuss) {
      const bridgedState = readStatuslineState(bridgedPaths);
      if (stateMatchesSession(bridgedState, opts)) return bridgedState;
      const bridgedDiscussState = readDiscussPacketState(bridgedPaths);
      if (bridgedDiscussState) return bridgedDiscussState;
    }
  }

  return null;
}

module.exports = {
  DISCUSS_PACKET,
  LEGACY_DISCUSS_PACKET,
  STATUSLINE_STATE_FILE,
  STATUSLINE_SESSION_BRIDGE,
  buildTaskStatuslineState,
  captureStatuslineSessionBridge,
  clearStatuslineState,
  hasDiscussPacket,
  isInside,
  isPlanEnforcerStateDir,
  ledgerIsClosed,
  readDiscussPacketState,
  inferStatuslineState,
  readStatuslineState,
  readStatuslineSessionBridge,
  resolveProjectRoot,
  resolveStatuslinePaths,
  stateMatchesSession,
  writeNamedStatuslineStage,
  writeStatuslineState,
  writeTaskStatuslineState
};
