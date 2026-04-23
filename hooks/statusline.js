#!/usr/bin/env node

const fs = require('fs');
const path = require('path');
const { spawnSync } = require('child_process');
const { captureStatuslineSessionBridge, inferStatuslineState } = require('../src/statusline-state');

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
    return /inferStatuslineState\s*\(|\.statusline-base-command/i.test(content);
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

function runBaseCommand(command, rawInput, opts = {}) {
  if (!command) return '';
  if (/plan-enforcer[\\/]+hooks[\\/]+statusline\.js/i.test(command)) return '';
  try {
    const env = { ...process.env };
    if (opts.chainEnforcer) {
      env.PLAN_ENFORCER_STATUSLINE_CHAINED = '1';
    }
    const enforcerState = opts.enforcerState || null;
    if (enforcerState && enforcerState.label) {
      env.PLAN_ENFORCER_STATUSLINE_LABEL = String(enforcerState.label);
    }
    if (enforcerState && enforcerState.progress) {
      env.PLAN_ENFORCER_STATUSLINE_PROGRESS = String(enforcerState.progress);
    }
    const result = spawnSync(command, {
      shell: true,
      env,
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

function visibleWidth(text) {
  let width = 0;
  const plain = String(text || '').replace(/\x1b\[[0-9;]*m/g, '');
  for (const char of plain) {
    const codePoint = char.codePointAt(0) || 0;
    if (codePoint >= 0x1F000 || (codePoint >= 0x2600 && codePoint <= 0x27BF)) {
      width += 2;
    } else {
      width += 1;
    }
  }
  return width;
}

function mergeOutputs(segment, baseOutput) {
  if (!segment) return baseOutput;
  if (!baseOutput) return segment;
  const lines = String(baseOutput).split(/\r?\n/);
  if (lines.length === 0) return segment;
  lines[0] = `${segment} ${lines[0]}`;
  if (lines.length > 1) {
    const pad = ' '.repeat(visibleWidth(segment) + 1);
    for (let i = 1; i < lines.length; i++) {
      lines[i] = `${pad}${lines[i]}`;
    }
  }
  return lines.join('\n');
}

function enforcerLabel(state) {
  if (!state || !state.label) return '';
  return `[ENFORCER: ${String(state.label).toUpperCase()}]`;
}

function enforcerProgress(state) {
  if (!state) return '';
  if (Number.isFinite(state.done) && Number.isFinite(state.total)) {
    return `${state.done}/${state.total}`;
  }
  const match = String(state.label || '').match(/(\d+\/\d+)/);
  return match ? match[1] : '';
}

function outputHasEnforcerSegment(text) {
  return /\[ENFORCER:\s*[^\]]+\]/i.test(String(text || '').replace(/\x1b\[[0-9;]*m/g, ''));
}

function replaceEnforcerSegment(baseOutput, state) {
  const label = enforcerLabel(state);
  if (!label) return baseOutput || '';
  const pattern = /((?:\x1b\[[0-9;]*m)*)\[ENFORCER:\s*[^\]]+\]((?:\x1b\[[0-9;]*m)*)/i;
  if (!pattern.test(String(baseOutput || ''))) return '';
  return String(baseOutput).replace(pattern, `$1${label}$2`);
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
  captureStatuslineSessionBridge(payload || {}, { cwd });
  const state = inferStatuslineState({
    cwd,
    sessionId: payload && payload.session_id ? payload.session_id : '',
    transcriptPath: payload && payload.transcript_path ? payload.transcript_path : ''
  });
  const segment = formatSegment(state);
  const baseCommand = process.env.PLAN_ENFORCER_STATUSLINE_CHAINED === '1'
    ? ''
    : (readBaseCommand() || discoverBaseCommand());
  // When chaining, Plan Enforcer owns the Enforcer segment and the base
  // statusline should suppress any independent Enforcer fallback logic.
  const baseOutput = runBaseCommand(baseCommand, rawInput, {
    chainEnforcer: true,
    enforcerState: {
      label: state && state.label ? String(state.label) : '',
      progress: enforcerProgress(state)
    }
  });
  const replaced = replaceEnforcerSegment(baseOutput, state);
  if (replaced) {
    process.stdout.write(replaced);
    return;
  }
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
