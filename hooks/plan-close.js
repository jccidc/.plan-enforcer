#!/usr/bin/env node
// Plan Enforcer -- PostToolUse close-transition detector.
//
// Fires after ledger edits. When the last non-terminal row flips to a
// terminal status (verified / skipped / blocked / superseded), the hook
// spawns src/receipt-cli.js to emit a closure receipt. Idempotent on no-op
// edits via a .last-close-hash sidecar. Hook errors never block the user's
// ledger edit -- catastrophic failures log to stderr and exit 0.

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const TERMINAL_STATUSES = new Set(['verified', 'skipped', 'blocked', 'superseded']);

function safeExit(code) {
  try {
    process.exit(code);
  } catch (_err) {
    // ignore
  }
}

function readStdinJson() {
  try {
    const raw = fs.readFileSync(0, 'utf8');
    if (!raw) return null;
    return JSON.parse(raw);
  } catch (_err) {
    return null;
  }
}

function isLedgerPath(filePath) {
  if (!filePath) return false;
  const normalized = String(filePath).replace(/\\/g, '/');
  return normalized.endsWith('/.plan-enforcer/ledger.md');
}

function findUpEnforcerDir(startDir) {
  let dir = startDir;
  const rootPath = path.parse(dir).root;
  for (let depth = 0; depth < 3 && dir && dir !== rootPath; depth += 1) {
    const candidate = path.join(dir, '.plan-enforcer');
    const hasLedger = fs.existsSync(path.join(candidate, 'ledger.md'))
      || fs.existsSync(path.join(candidate, 'archive'));
    const isProjectRoot = fs.existsSync(path.join(dir, '.git'))
      || fs.existsSync(path.join(dir, 'package.json'));
    if (hasLedger && isProjectRoot) return dir;
    if (isProjectRoot || fs.existsSync(path.join(dir, '.plan-enforcer-stop'))) return null;
    const parent = path.dirname(dir);
    if (parent === dir) break;
    dir = parent;
  }
  return null;
}

function resolveProjectRoot(filePath) {
  if (filePath) {
    const normalized = String(filePath).replace(/\\/g, '/');
    const marker = '/.plan-enforcer/ledger.md';
    const idx = normalized.indexOf(marker);
    if (idx >= 0) {
      const candidate = normalized.slice(0, idx);
      if (fs.existsSync(path.join(candidate, '.plan-enforcer', 'ledger.md'))) {
        return candidate;
      }
    }
  }
  const cwd = process.cwd();
  const cwdLedger = path.join(cwd, '.plan-enforcer', 'ledger.md');
  if (fs.existsSync(cwdLedger)) return cwd;
  return findUpEnforcerDir(cwd);
}

function parseTaskRowStatuses(content) {
  const lines = content.split(/\r?\n/);
  const rows = [];
  for (const line of lines) {
    const m = line.match(/^\|\s*(T\d+)\s*\|[^|]+\|\s*([a-z-]+)\s*\|/i);
    if (m) rows.push({ id: m[1], status: m[2].toLowerCase() });
  }
  return rows;
}

function isPlanClosed(rows) {
  const active = rows.filter((r) => r.status !== 'superseded');
  if (active.length === 0) return false; // empty ledger is not "closed"
  return active.every((r) => TERMINAL_STATUSES.has(r.status));
}

function sha256Short(content) {
  return crypto.createHash('sha256').update(content || '').digest('hex').slice(0, 16);
}

function readHashFile(hashPath) {
  try {
    return fs.readFileSync(hashPath, 'utf8').trim();
  } catch (_err) {
    return null;
  }
}

function writeHashFile(hashPath, hash) {
  try {
    fs.mkdirSync(path.dirname(hashPath), { recursive: true });
    fs.writeFileSync(hashPath, hash + '\n', 'utf8');
  } catch (_err) {
    // best effort; never block
  }
}

function emitReceipt(projectRoot) {
  try {
    // Prefer the installed skill location, fall back to repo-local for tests.
    const homeCli = path.join(
      process.env.HOME || process.env.USERPROFILE || '',
      '.claude', 'skills', 'plan-enforcer', 'src', 'receipt-cli.js'
    );
    const localCli = path.join(projectRoot, 'src', 'receipt-cli.js');
    const cliPath = fs.existsSync(homeCli) ? homeCli : localCli;
    if (!fs.existsSync(cliPath)) {
      process.stderr.write(`plan-close: receipt-cli not found at ${homeCli} or ${localCli}\n`);
      return null;
    }
    // Direct require + in-process call. Avoids spawn flakiness and keeps the
    // hook a single sync operation. The hook itself runs after the ledger
    // edit (PostToolUse), so running receipt render inline does not block
    // the user's edit.
    const savedCwd = process.cwd();
    try {
      const receipt = require(cliPath);
      return receipt.writeReceipt(projectRoot, {});
    } finally {
      if (process.cwd() !== savedCwd) {
        try { process.chdir(savedCwd); } catch (_e) { /* ignore */ }
      }
    }
  } catch (err) {
    process.stderr.write(`plan-close: emit failed: ${err.message || err}\n`);
    return null;
  }
}

function main() {
  const ctx = readStdinJson();
  if (!ctx) return 0;
  const toolName = ctx.tool_name || ctx.tool || '';
  const filePath = (ctx.tool_input && (ctx.tool_input.file_path || ctx.tool_input.filePath))
    || ctx.file_path
    || '';
  if (!['Edit', 'Write', 'MultiEdit', 'NotebookEdit'].includes(toolName)) return 0;
  if (!isLedgerPath(filePath)) return 0;

  const projectRoot = resolveProjectRoot(filePath);
  if (!projectRoot) return 0;

  const ledgerPath = path.join(projectRoot, '.plan-enforcer', 'ledger.md');
  let content;
  try {
    content = fs.readFileSync(ledgerPath, 'utf8');
  } catch (err) {
    process.stderr.write(`plan-close: cannot read ledger: ${err.message || err}\n`);
    return 0;
  }

  let rows;
  try {
    rows = parseTaskRowStatuses(content);
  } catch (err) {
    process.stderr.write(`plan-close: cannot parse ledger: ${err.message || err}\n`);
    return 0;
  }

  if (!isPlanClosed(rows)) return 0;

  const hashPath = path.join(projectRoot, '.plan-enforcer', '.last-close-hash');
  const currentHash = sha256Short(content);
  const priorHash = readHashFile(hashPath);
  if (priorHash === currentHash) return 0; // idempotent on no-op re-save

  emitReceipt(projectRoot);
  writeHashFile(hashPath, currentHash);
  return 0;
}

module.exports = {
  TERMINAL_STATUSES,
  isLedgerPath,
  findUpEnforcerDir,
  resolveProjectRoot,
  parseTaskRowStatuses,
  isPlanClosed,
  sha256Short,
  readHashFile,
  writeHashFile,
  emitReceipt,
  main
};

if (require.main === module) {
  safeExit(main() || 0);
}
