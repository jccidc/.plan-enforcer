#!/usr/bin/env node
// Plan Enforcer - UserPromptSubmit capture hook
//
// Appends raw user prompts to .plan-enforcer/.user-messages.jsonl so
// awareness intent rows can prove they are verbatim, not cleaned-up
// paraphrases.

const fs = require('fs');
const os = require('os');
const path = require('path');
const { createEmptyPacket, slugTitle, writeDiscussPacket } = require('../src/discuss-cli');
const { writeConfig } = require('../src/config');

function readContext() {
  try {
    const raw = fs.readFileSync(0, 'utf8');
    return raw ? JSON.parse(raw) : null;
  } catch (_e) {
    return null;
  }
}

function hasEnforcerDir(dir) {
  const enforcerDir = path.join(dir, '.plan-enforcer');
  return (
    fs.existsSync(path.join(enforcerDir, 'config.md')) ||
    fs.existsSync(path.join(enforcerDir, 'ledger.md')) ||
    fs.existsSync(path.join(enforcerDir, 'awareness.md')) ||
    fs.existsSync(path.join(enforcerDir, 'archive'))
  );
}

function findUpEnforcerDir(startDir) {
  let dir = startDir;
  const rootPath = path.parse(dir).root;
  for (let depth = 0; depth < 3 && dir && dir !== rootPath; depth++) {
    const isProjectRoot = fs.existsSync(path.join(dir, '.git')) || fs.existsSync(path.join(dir, 'package.json'));
    if (hasEnforcerDir(dir) && isProjectRoot) return dir;
    if (isProjectRoot || fs.existsSync(path.join(dir, '.plan-enforcer-stop'))) return null;
    const parent = path.dirname(dir);
    if (parent === dir) break;
    dir = parent;
  }
  return null;
}

function findDownEnforcerDir(startDir, maxDepth) {
  const stack = [{ dir: startDir, depth: 0 }];
  while (stack.length > 0) {
    const { dir, depth } = stack.shift();
    if (depth > maxDepth) continue;
    try {
      const entries = fs.readdirSync(dir, { withFileTypes: true });
      for (const entry of entries) {
        if (!entry.isDirectory() || entry.name === 'node_modules' || entry.name === '.git') continue;
        const full = path.join(dir, entry.name);
        if (entry.name === '.plan-enforcer' && hasEnforcerDir(dir)) return dir;
        stack.push({ dir: full, depth: depth + 1 });
      }
    } catch (_e) {}
  }
  return null;
}

function resolveProjectRoot(cwd) {
  if (hasEnforcerDir(cwd)) return cwd;
  return findUpEnforcerDir(cwd) || findDownEnforcerDir(cwd, 3);
}

function resolveBootstrapRoot(startDir) {
  const initial = path.resolve(startDir);
  const rootPath = path.parse(initial).root;
  const homePath = path.resolve(os.homedir());
  let current = initial;

  while (current && current !== rootPath) {
    if (current === homePath || fs.existsSync(path.join(current, '.plan-enforcer-stop'))) break;
    if (fs.existsSync(path.join(current, '.git')) || fs.existsSync(path.join(current, 'package.json'))) {
      return current;
    }
    const parent = path.dirname(current);
    if (parent === current) break;
    current = parent;
  }

  return initial;
}

function ensureBootstrapConfig(projectRoot) {
  const enforcerDir = path.join(projectRoot, '.plan-enforcer');
  const configPath = path.join(enforcerDir, 'config.md');
  fs.mkdirSync(enforcerDir, { recursive: true });
  if (!fs.existsSync(configPath)) {
    writeConfig(configPath, {});
  }
  return { enforcerDir, configPath };
}

function hasActiveLedger(projectRoot) {
  return fs.existsSync(path.join(projectRoot, '.plan-enforcer', 'ledger.md'));
}

function shouldBootstrapDiscuss(prompt) {
  const normalized = String(prompt || '').trim().toLowerCase();
  if (!normalized) return false;
  return [
    /\blet'?s\s+(make|create|draft|start)\s+(a\s+)?plan\b/,
    /\b(make|create|draft|start)\s+(a\s+)?plan\b/,
    /\b(help me|can you)\s+(make|create|draft)\s+(a\s+)?plan\b/,
    /\bplan this\b/,
    /\bfigure out a plan\b/
  ].some((pattern) => pattern.test(normalized));
}

function bootstrapDiscuss(projectRoot, prompt) {
  if (!shouldBootstrapDiscuss(prompt) || hasActiveLedger(projectRoot)) return;
  writeDiscussPacket(createEmptyPacket(prompt, slugTitle(prompt)), {
    cwd: projectRoot,
    source: 'user-message'
  });
}

function countExistingMessages(filePath) {
  if (!fs.existsSync(filePath)) return 0;
  try {
    return fs.readFileSync(filePath, 'utf8')
      .split('\n')
      .map((line) => line.trim())
      .filter(Boolean)
      .length;
  } catch (_e) {
    return 0;
  }
}

function main() {
  const ctx = readContext();
  if (!ctx || ctx.hook_event_name !== 'UserPromptSubmit') process.exit(0);

  const prompt = typeof ctx.prompt === 'string' ? ctx.prompt : '';
  if (!prompt.trim()) process.exit(0);

  const bootstrapAsk = shouldBootstrapDiscuss(prompt);
  const projectRoot = resolveProjectRoot(process.cwd())
    || (bootstrapAsk ? resolveBootstrapRoot(process.cwd()) : null);
  if (!projectRoot) process.exit(0);

  const { enforcerDir } = ensureBootstrapConfig(projectRoot);

  const logPath = path.join(enforcerDir, '.user-messages.jsonl');
  const record = {
    index: countExistingMessages(logPath) + 1,
    ts: new Date().toISOString(),
    session_id: ctx.session_id || null,
    transcript_path: ctx.transcript_path || null,
    cwd: ctx.cwd || process.cwd(),
    prompt
  };

  try {
    fs.appendFileSync(logPath, `${JSON.stringify(record)}\n`);
  } catch (_e) {}

  try {
    bootstrapDiscuss(projectRoot, prompt);
  } catch (_e) {}
}

try {
  main();
} catch (_e) {
  process.exit(0);
}
