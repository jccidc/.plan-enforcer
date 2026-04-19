#!/usr/bin/env node
const fs = require('fs');
const path = require('path');

function statePath(cellDir) {
  return path.join(cellDir, '.phased-session-state.json');
}

function normalizeState(raw) {
  const invocations = Array.isArray(raw?.invocations)
    ? raw.invocations
        .map((item) => ({
          wall_clock_ms: Number(item?.wall_clock_ms) || 0,
          start_phase: Number(item?.start_phase) || 0,
          end_phase: Number(item?.end_phase) || 0,
          interrupted: Boolean(item?.interrupted)
        }))
        .filter((item) => item.wall_clock_ms >= 0)
    : [];
  return { invocations };
}

function loadState(cellDir) {
  const file = statePath(cellDir);
  if (!fs.existsSync(file)) return { invocations: [] };
  try {
    return normalizeState(JSON.parse(fs.readFileSync(file, 'utf8')));
  } catch {
    return { invocations: [] };
  }
}

function saveState(cellDir, state) {
  fs.writeFileSync(statePath(cellDir), JSON.stringify(normalizeState(state), null, 2) + '\n', 'utf8');
}

function appendInvocation(cellDir, invocation) {
  const state = loadState(cellDir);
  state.invocations.push({
    wall_clock_ms: Number(invocation.wall_clock_ms) || 0,
    start_phase: Number(invocation.start_phase) || 0,
    end_phase: Number(invocation.end_phase) || 0,
    interrupted: Boolean(invocation.interrupted)
  });
  saveState(cellDir, state);
  return state;
}

function summarizeState(state) {
  const invocations = normalizeState(state).invocations;
  return {
    sessions_counted: invocations.length,
    wall_clock_ms: invocations.reduce((sum, item) => sum + item.wall_clock_ms, 0),
    session_1_wall_clock_ms: invocations[0]?.wall_clock_ms ?? null,
    session_2_wall_clock_ms: invocations[1]?.wall_clock_ms ?? null,
    interrupted: invocations.some((item) => item.interrupted),
    invocations
  };
}

function removeState(cellDir) {
  const file = statePath(cellDir);
  if (fs.existsSync(file)) fs.unlinkSync(file);
}

function parseArgs(argv) {
  const args = {};
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (arg === '--cell-dir') args.cellDir = argv[++i];
    else if (arg === '--wall-clock-ms') args.wallClockMs = argv[++i];
    else if (arg === '--start-phase') args.startPhase = argv[++i];
    else if (arg === '--end-phase') args.endPhase = argv[++i];
    else if (arg === '--interrupted') args.interrupted = true;
    else if (arg === '--help' || arg === '-h') args.help = true;
    else if (!args.command) args.command = arg;
  }
  return args;
}

function usage() {
  return [
    'Usage:',
    '  node phased-session-state.js record --cell-dir <dir> --wall-clock-ms <n> --start-phase <n> --end-phase <n> [--interrupted]',
    '  node phased-session-state.js summary --cell-dir <dir>',
    '  node phased-session-state.js clear --cell-dir <dir>'
  ].join('\n');
}

function main(argv = process.argv.slice(2)) {
  const args = parseArgs(argv);
  if (args.help || !args.command || !args.cellDir) {
    console.log(usage());
    return args.help ? 0 : 2;
  }
  if (args.command === 'record') {
    const state = appendInvocation(args.cellDir, {
      wall_clock_ms: args.wallClockMs,
      start_phase: args.startPhase,
      end_phase: args.endPhase,
      interrupted: args.interrupted
    });
    console.log(JSON.stringify(summarizeState(state), null, 2));
    return 0;
  }
  if (args.command === 'summary') {
    console.log(JSON.stringify(summarizeState(loadState(args.cellDir)), null, 2));
    return 0;
  }
  if (args.command === 'clear') {
    removeState(args.cellDir);
    return 0;
  }
  console.log(usage());
  return 2;
}

if (require.main === module) {
  process.exit(main());
}

module.exports = {
  statePath,
  loadState,
  saveState,
  appendInvocation,
  summarizeState,
  removeState
};
