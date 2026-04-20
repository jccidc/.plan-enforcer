#!/usr/bin/env node

const fs = require('fs');
const path = require('path');
const { spawnSync } = require('child_process');
const { inferStatuslineState } = require('../src/statusline-state');

const BASE_COMMAND_FILE = '.statusline-base-command';

function resolveClaudeDir() {
  if (process.env.CLAUDE_CONFIG_DIR) return process.env.CLAUDE_CONFIG_DIR;
  if (process.env.HOME) return path.join(process.env.HOME, '.claude');
  if (process.env.USERPROFILE) return path.join(process.env.USERPROFILE, '.claude');
  return '';
}

function readInput() {
  try {
    return fs.readFileSync(0, 'utf8');
  } catch (_error) {
    return '';
  }
}

function readBaseCommand() {
  const basePath = path.join(__dirname, BASE_COMMAND_FILE);
  if (!fs.existsSync(basePath)) return '';
  try {
    return fs.readFileSync(basePath, 'utf8').trim();
  } catch (_error) {
    return '';
  }
}

function looksLikePlanEnforcerWrapper(filePath) {
  try {
    const content = fs.readFileSync(filePath, 'utf8');
    return /inferStatuslineState|PLAN_ENFORCER_STATUSLINE_CHAINED|statusline-state/i.test(content);
  } catch (_error) {
    return false;
  }
}

function discoverBaseCommand() {
  const claudeDir = resolveClaudeDir();
  if (!claudeDir) return '';
  const candidates = [
    path.join(claudeDir, 'hooks', 'statusline.js'),
    path.join(claudeDir, 'hooks', 'gsd-statusline.js')
  ];
  const selfPath = path.resolve(__filename);
  for (const candidate of candidates) {
    try {
      if (!fs.existsSync(candidate)) continue;
      if (path.resolve(candidate) === selfPath) continue;
      if (looksLikePlanEnforcerWrapper(candidate)) continue;
      return `${process.execPath} "${candidate.replace(/\\/g, '/')}"`;
    } catch (_error) {}
  }
  return '';
}

function runBaseCommand(command, rawInput) {
  if (!command) return '';
  if (/plan-enforcer[\\/]+hooks[\\/]+statusline\.js/i.test(command)) return '';
  try {
    const result = spawnSync(command, {
      shell: true,
      env: {
        ...process.env,
        PLAN_ENFORCER_STATUSLINE_CHAINED: '1'
      },
      input: rawInput,
      encoding: 'utf8',
      timeout: 2000,
      windowsHide: true
    });
    return result.stdout || '';
  } catch (_error) {
    return '';
  }
}

function formatSegment(state) {
  if (!state || !state.label) return '';
  return `\x1b[1;96m[ENFORCER: ${String(state.label).toUpperCase()}]\x1b[0m`;
}

function mergeOutputs(segment, baseOutput) {
  if (!segment) return baseOutput;
  if (!baseOutput) return segment;
  const lines = String(baseOutput).split(/\r?\n/);
  if (lines.length === 0) return segment;
  lines[0] = `${segment} ${lines[0]}`;
  return lines.join('\n');
}

function main() {
  const rawInput = readInput();
  let payload = null;
  try {
    payload = rawInput ? JSON.parse(rawInput) : null;
  } catch (_error) {}

  const cwd = payload && payload.workspace && payload.workspace.current_dir
    ? payload.workspace.current_dir
    : process.cwd();
  const state = inferStatuslineState({ cwd });
  const segment = formatSegment(state);
  const baseCommand = process.env.PLAN_ENFORCER_STATUSLINE_CHAINED === '1'
    ? ''
    : (readBaseCommand() || discoverBaseCommand());
  const baseOutput = runBaseCommand(baseCommand, rawInput);
  const merged = mergeOutputs(segment, baseOutput);
  if (merged) {
    process.stdout.write(merged);
  }
}

try {
  main();
} catch (_error) {
  process.exit(0);
}
