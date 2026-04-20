const { spawnSync } = require('child_process');
const fs = require('fs');
const path = require('path');
const GIT_STATUS_TIMEOUT_MS = 1000;

function normalizePathFromPorcelain(raw) {
  const text = String(raw || '').trim();
  if (!text) return '';
  const arrow = text.lastIndexOf(' -> ');
  return arrow === -1 ? text : text.slice(arrow + 4).trim();
}

function parsePorcelainLine(line) {
  const raw = String(line || '');
  if (!raw.trim()) return null;
  const xy = raw.slice(0, 2);
  const filePath = normalizePathFromPorcelain(raw.slice(3));
  if (!filePath) return null;

  const untracked = xy === '??';
  const staged = xy[0] !== ' ' && xy[0] !== '?';
  const unstaged = !untracked && xy[1] !== ' ';

  return { xy, path: filePath, staged, unstaged, untracked };
}

function shouldIgnoreWorktreePath(filePath) {
  const normalized = String(filePath || '').replace(/\\/g, '/');
  return normalized === '.plan-enforcer/ledger.md' ||
    normalized === '.plan-enforcer/config.md' ||
    normalized.startsWith('.plan-enforcer/checks/') ||
    normalized.startsWith('.plan-enforcer/proof/') ||
    normalized === '.plan-enforcer/.session-log.jsonl' ||
    normalized === '.plan-enforcer/.tool-count' ||
    normalized === '.plan-enforcer/.stale-count' ||
    normalized === '.plan-enforcer/.ledger-mtime' ||
    normalized === '.plan-enforcer/.activated';
}

function hasDirectGitMarker(projectRoot) {
  return fs.existsSync(path.join(projectRoot, '.git'));
}

function summarizeGitWorktree(projectRoot, opts = {}) {
  const maxFiles = Number.isInteger(opts.maxFiles) && opts.maxFiles > 0 ? opts.maxFiles : 6;
  const searchParents = opts.searchParents === true;

  if (!searchParents && !hasDirectGitMarker(projectRoot)) return null;

  const top = spawnSync('git', ['rev-parse', '--show-toplevel'], {
    cwd: projectRoot,
    encoding: 'utf8',
    timeout: GIT_STATUS_TIMEOUT_MS,
    windowsHide: true
  });
  if (top.status !== 0) return null;

  const status = spawnSync('git', ['status', '--porcelain=v1', '-uall'], {
    cwd: projectRoot,
    encoding: 'utf8',
    timeout: GIT_STATUS_TIMEOUT_MS,
    windowsHide: true
  });
  if (status.status !== 0) return null;

  const seen = new Map();
  let staged = 0;
  let unstaged = 0;
  let untracked = 0;

  for (const line of String(status.stdout || '').split(/\r?\n/)) {
    const parsed = parsePorcelainLine(line);
    if (!parsed) continue;
    if (shouldIgnoreWorktreePath(parsed.path)) continue;
    if (!seen.has(parsed.path)) seen.set(parsed.path, parsed);
    else {
      const prior = seen.get(parsed.path);
      seen.set(parsed.path, {
        ...prior,
        staged: prior.staged || parsed.staged,
        unstaged: prior.unstaged || parsed.unstaged,
        untracked: prior.untracked || parsed.untracked
      });
    }
  }

  for (const entry of seen.values()) {
    if (entry.staged) staged += 1;
    if (entry.unstaged) unstaged += 1;
    if (entry.untracked) untracked += 1;
  }

  return {
    root: String(top.stdout || '').trim(),
    total: seen.size,
    staged,
    unstaged,
    untracked,
    files: Array.from(seen.keys()).slice(0, maxFiles)
  };
}

function formatGitWorktreeSummary(summary) {
  if (!summary) return '';
  const noun = summary.total === 1 ? 'file' : 'files';
  const lines = [
    '',
    `Git: ${summary.total} uncommitted ${noun}  |  ${summary.staged} staged  |  ${summary.unstaged} unstaged  |  ${summary.untracked} untracked`
  ];
  if (summary.files.length > 0) {
    lines.push(`  files: ${summary.files.join(', ')}`);
  }
  return lines.join('\n');
}

module.exports = {
  formatGitWorktreeSummary,
  hasDirectGitMarker,
  normalizePathFromPorcelain,
  parsePorcelainLine,
  shouldIgnoreWorktreePath,
  summarizeGitWorktree,
  GIT_STATUS_TIMEOUT_MS
};
